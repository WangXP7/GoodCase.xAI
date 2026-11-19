// Headless server host module for Deno
// Implements Host_Init_Server and Host_ServerFrame without rendering

import { Sys_Printf, Sys_FloatTime } from './sys_server.ts';
import { COM_LoadFile, COM_LoadFileAsString } from './pak_server.ts';
import {
	WT_Init,
	WT_Listen,
	WT_Shutdown,
	WT_CheckNewConnections,
	WT_QGetMessage,
	WT_QSendMessage,
	WT_SendUnreliableMessage,
	WT_CanSendMessage,
	WT_Close,
	WT_SearchForHosts,
	WT_Connect,
	WT_CanSendUnreliableMessage,
	net_message,
	type qsocket_t,
} from './net_webtransport_server.ts';

// Re-export net_message for other modules
export { net_message };

// Server configuration
export interface ServerConfig {
	maxClients: number;
	port: number;
	tickRate: number;
	defaultMap: string;
}

// Server state
interface ServerState {
	active: boolean;
	paused: boolean;
	time: number;
	frametime: number;
	name: string; // Current map name
	worldmodel: unknown | null;
	model_precache: (string | null)[];
	sound_precache: (string | null)[];
	lightstyles: (string | null)[];
	num_edicts: number;
	edicts: unknown[] | null;
}

interface ServerStatic {
	maxclients: number;
	maxclientslimit: number;
	clients: ClientState[];
	serverflags: number;
	changelevel_issued: boolean;
}

interface ClientState {
	active: boolean;
	spawned: boolean;
	dropasap: boolean;
	netconnection: qsocket_t | null;
	name: string;
	colors: number;
	old_frags: number;
	edict: unknown | null;
	message: {
		data: Uint8Array;
		cursize: number;
		maxsize: number;
	};
	spawn_parms: number[];
}

// Global server state
export const sv: ServerState = {
	active: false,
	paused: false,
	time: 0,
	frametime: 0,
	name: '',
	worldmodel: null,
	model_precache: new Array(256).fill(null),
	sound_precache: new Array(256).fill(null),
	lightstyles: new Array(64).fill(null),
	num_edicts: 0,
	edicts: null,
};

export const svs: ServerStatic = {
	maxclients: 1,
	maxclientslimit: 16,
	clients: [],
	serverflags: 0,
	changelevel_issued: false,
};

// Current host client being processed
export let host_client: ClientState | null = null;
export let host_frametime = 0;
export let host_time = 0;

// Network driver registration
interface NetDriver {
	name: string;
	initialized: boolean;
	Init: () => number;
	Shutdown: () => void;
	Listen: (state: boolean) => void | Promise<void>;
	SearchForHosts: (xmit: boolean) => void;
	Connect: (host: string) => qsocket_t | null;
	CheckNewConnections: () => qsocket_t | null;
	QGetMessage: (sock: qsocket_t) => number;
	QSendMessage: (
		sock: qsocket_t,
		data: { data: Uint8Array; cursize: number }
	) => number;
	SendUnreliableMessage: (
		sock: qsocket_t,
		data: { data: Uint8Array; cursize: number }
	) => number;
	CanSendMessage: (sock: qsocket_t) => boolean;
	CanSendUnreliableMessage: (sock: qsocket_t) => boolean;
	Close: (sock: qsocket_t) => void;
}

const net_drivers: NetDriver[] = [];
let net_numdrivers = 0;

// Protocol constants for disconnect notifications
const svc_updatename = 13;
const svc_updatefrags = 14;
const svc_updatecolors = 17;

// Message writing helpers
function MSG_WriteByte(msg: { data: Uint8Array; cursize: number }, val: number): void {
	msg.data[msg.cursize++] = val & 0xff;
}

function MSG_WriteShort(msg: { data: Uint8Array; cursize: number }, val: number): void {
	msg.data[msg.cursize++] = val & 0xff;
	msg.data[msg.cursize++] = (val >> 8) & 0xff;
}

function MSG_WriteString(msg: { data: Uint8Array; cursize: number }, s: string): void {
	for (let i = 0; i < s.length; i++) {
		msg.data[msg.cursize++] = s.charCodeAt(i);
	}
	msg.data[msg.cursize++] = 0; // null terminator
}

/**
 * Initialize the server-side network
 */
function NET_Init_Server(): void {
	// Register WebTransport driver
	net_drivers[0] = {
		name: 'WebTransport',
		initialized: false,
		Init: WT_Init,
		Shutdown: WT_Shutdown,
		Listen: WT_Listen,
		SearchForHosts: WT_SearchForHosts,
		Connect: WT_Connect,
		CheckNewConnections: WT_CheckNewConnections,
		QGetMessage: WT_QGetMessage,
		QSendMessage: WT_QSendMessage,
		SendUnreliableMessage: WT_SendUnreliableMessage,
		CanSendMessage: WT_CanSendMessage,
		CanSendUnreliableMessage: WT_CanSendUnreliableMessage,
		Close: WT_Close,
	};

	net_numdrivers = 1;

	// Initialize driver
	const result = net_drivers[0].Init();
	if (result !== -1) {
		net_drivers[0].initialized = true;
	}

	Sys_Printf('NET_Init_Server: %d drivers\n', net_numdrivers);
}

/**
 * Initialize the dedicated server (no rendering)
 */
export async function Host_Init_Server(config: ServerConfig): Promise<void> {
	Sys_Printf('Host_Init_Server starting...\n');

	// Initialize server static
	svs.maxclients = config.maxClients;
	svs.maxclientslimit = config.maxClients;
	svs.clients = [];

	// Allocate client slots
	for (let i = 0; i < svs.maxclientslimit; i++) {
		svs.clients[i] = {
			active: false,
			spawned: false,
			dropasap: false,
			netconnection: null,
			name: '',
			colors: 0,
			old_frags: 0,
			edict: null,
			message: {
				data: new Uint8Array(8192),
				cursize: 0,
				maxsize: 8192,
			},
			spawn_parms: new Array(16).fill(0),
		};
	}

	// Initialize network
	NET_Init_Server();

	// Start listening for connections
	await net_drivers[0].Listen(true);

	host_time = 1.0; // So a think at time 0 won't get called

	Sys_Printf('Host_Init_Server complete\n');
}

/**
 * Shutdown the server
 */
export function Host_Shutdown_Server(): void {
	Sys_Printf('Host_Shutdown_Server...\n');

	// Drop all clients (crash=true since server is going down)
	for (let i = 0; i < svs.clients.length; i++) {
		const client = svs.clients[i];
		if (client.active) {
			SV_DropClient(i, true);
		}
	}

	// Stop listening
	net_drivers[0].Listen(false);
	net_drivers[0].Shutdown();

	sv.active = false;

	Sys_Printf('Host_Shutdown_Server complete\n');
}

/**
 * Check for new client connections
 */
function SV_CheckForNewClients(): void {
	while (true) {
		const sock = net_drivers[0].CheckNewConnections();
		if (!sock) break;

		// Find a free client slot
		let clientNum = -1;
		for (let i = 0; i < svs.maxclients; i++) {
			if (!svs.clients[i].active) {
				clientNum = i;
				break;
			}
		}

		if (clientNum === -1) {
			Sys_Printf('Server is full, rejecting connection\n');
			net_drivers[0].Close(sock);
			continue;
		}

		const client = svs.clients[clientNum];
		client.active = true;
		client.spawned = false;
		client.netconnection = sock;
		client.name = 'unnamed';
		client.colors = 0;
		client.message.cursize = 0;

		Sys_Printf('Client %d connected: %s\n', clientNum, sock.address);

		// TODO: Send signon messages
		// This will be implemented when the full protocol is integrated
	}
}

/**
 * Drop a client - called when client disconnects or is kicked
 * @param clientNum The client slot number
 * @param crash If true, don't bother sending signoff messages
 */
function SV_DropClient(clientNum: number, crash: boolean): void {
	const client = svs.clients[clientNum];
	if (client == null || !client.active) return;

	if (!crash) {
		Sys_Printf('Client %s removed\n', client.name);
	}

	// Close the net connection
	if (client.netconnection != null) {
		net_drivers[0].Close(client.netconnection);
		client.netconnection = null;
	}

	// Free the client (the body stays around)
	client.active = false;
	client.name = '';
	client.old_frags = -999999;
	client.spawned = false;
	client.dropasap = false;

	// Send notification to all other clients
	for (let i = 0; i < svs.maxclients; i++) {
		const other = svs.clients[i];
		if (!other.active) continue;

		MSG_WriteByte(other.message, svc_updatename);
		MSG_WriteByte(other.message, clientNum);
		MSG_WriteString(other.message, '');

		MSG_WriteByte(other.message, svc_updatefrags);
		MSG_WriteByte(other.message, clientNum);
		MSG_WriteShort(other.message, 0);

		MSG_WriteByte(other.message, svc_updatecolors);
		MSG_WriteByte(other.message, clientNum);
		MSG_WriteByte(other.message, 0);
	}
}

/**
 * Read and process client messages
 */
function SV_RunClients(): void {
	for (let i = 0; i < svs.maxclients; i++) {
		const client = svs.clients[i];
		if (!client.active) continue;

		host_client = client;

		if (client.netconnection == null) continue;

		// Read messages from client
		let ret: number;
		while ((ret = net_drivers[0].QGetMessage(client.netconnection)) > 0) {
			// Process the message in net_message
			// TODO: Parse client commands (clc_move, clc_stringcmd, etc.)
			// This will be implemented when the full protocol is integrated
		}

		if (ret === -1) {
			// Client disconnected
			SV_DropClient(i, false);
		}
	}

	host_client = null;
}

/**
 * Send messages to all clients
 */
function SV_SendClientMessages(): void {
	for (let i = 0; i < svs.maxclients; i++) {
		const client = svs.clients[i];
		if (!client.active) continue;
		if (!client.netconnection) continue;
		if (!client.spawned) continue;

		// Check if we can send
		if (!net_drivers[0].CanSendMessage(client.netconnection)) continue;

		// Send reliable message if any
		if (client.message.cursize > 0) {
			const result = net_drivers[0].QSendMessage(
				client.netconnection,
				client.message
			);
			if (result === -1) {
				// Send failed, mark for drop
				client.dropasap = true;
			}
			client.message.cursize = 0;
		}

		// TODO: Send unreliable entity updates
		// This will be implemented when the full protocol is integrated
	}

	// Drop clients marked for dropping
	for (let i = 0; i < svs.maxclients; i++) {
		const client = svs.clients[i];
		if (client.dropasap) {
			SV_DropClient(i, false);
		}
	}
}

/**
 * Run physics simulation
 */
function SV_Physics(): void {
	// TODO: Integrate full physics from sv_phys.js
	// For now, just advance time
	sv.time += sv.frametime;
}

/**
 * Run a single server frame
 */
export function Host_ServerFrame(frametime: number): void {
	if (!sv.active) return;

	host_frametime = frametime;
	sv.frametime = frametime;

	// Check for new clients
	SV_CheckForNewClients();

	// Read client messages and process commands
	SV_RunClients();

	// Run physics (if not paused)
	if (!sv.paused) {
		SV_Physics();
	}

	// Send messages to clients
	SV_SendClientMessages();

	host_time += frametime;
}

/**
 * Spawn a new server with the given map
 */
export async function SV_SpawnServer(mapName: string): Promise<boolean> {
	Sys_Printf('SpawnServer: %s\n', mapName);

	// TODO: Load BSP file
	// TODO: Load progs.dat
	// TODO: Initialize entities
	// This requires the headless model loader (mod_server.ts)

	sv.active = true;
	sv.paused = false;
	sv.time = 1.0;
	sv.name = mapName;

	// Initialize precache arrays
	sv.model_precache.fill(null);
	sv.sound_precache.fill(null);
	sv.lightstyles.fill(null);

	// Set up first precache slot (world model)
	sv.model_precache[0] = '';
	sv.model_precache[1] = 'maps/' + mapName + '.bsp';

	Sys_Printf('Server spawned: %s\n', mapName);

	return true;
}

/**
 * Get active client count
 */
export function SV_GetClientCount(): number {
	let count = 0;
	for (const client of svs.clients) {
		if (client.active && client.spawned) count++;
	}
	return count;
}

/**
 * Get server info string
 */
export function SV_GetServerInfo(): string {
	return (
		'map: ' +
		sv.name +
		', clients: ' +
		SV_GetClientCount() +
		'/' +
		svs.maxclients
	);
}
