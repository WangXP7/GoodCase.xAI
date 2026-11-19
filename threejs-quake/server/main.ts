// Three-Quake Dedicated Server Entry Point
// Runs the Quake server headlessly using Deno

import { Sys_Printf, Sys_FloatTime } from './sys_server.ts';
import {
	COM_LoadPackFromFile,
	COM_AddPack,
} from './pak_server.ts';
import {
	WT_SetConfig,
	WT_SetRoomResolver,
} from './net_webtransport_server.ts';
import {
	Host_Init_Server,
	Host_ServerFrame,
	Host_Shutdown_Server,
	SV_SpawnServer,
	sv,
	svs,
} from './host_server.ts';
import { Mod_Init } from './mod_server.ts';
import {
	createRoom,
	getRoom,
	listRooms,
	updateRoomPlayerCount,
	deleteRoom,
	cleanupRooms,
	getRoomCount,
	type Room,
} from './rooms.ts';

// Server configuration
const CONFIG = {
	pakPath: '../pak0.pak',
	port: 4433,
	certFile: 'cert.pem',
	keyFile: 'key.pem',
	tickRate: 72, // Server tick rate in Hz
	maxClients: 16,
	defaultMap: 'start',
	roomCleanupInterval: 60000, // Clean up stale rooms every 60s
};

// Parse command line arguments
function parseArgs(): void {
	const args = Deno.args;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		if (arg === '-port' && args[i + 1]) {
			CONFIG.port = parseInt(args[++i], 10);
		} else if (arg === '-maxclients' && args[i + 1]) {
			CONFIG.maxClients = parseInt(args[++i], 10);
		} else if (arg === '-map' && args[i + 1]) {
			CONFIG.defaultMap = args[++i];
		} else if (arg === '-pak' && args[i + 1]) {
			CONFIG.pakPath = args[++i];
		} else if (arg === '-cert' && args[i + 1]) {
			CONFIG.certFile = args[++i];
		} else if (arg === '-key' && args[i + 1]) {
			CONFIG.keyFile = args[++i];
		} else if (arg === '-tickrate' && args[i + 1]) {
			CONFIG.tickRate = parseInt(args[++i], 10);
		} else if (arg === '-help' || arg === '--help' || arg === '-h') {
			printUsage();
			Deno.exit(0);
		}
	}
}

function printUsage(): void {
	console.log(`
Three-Quake Dedicated Server

Usage: deno run --allow-net --allow-read --allow-env server/main.ts [options]

Options:
  -port <port>         WebTransport port (default: 4433)
  -maxclients <num>    Maximum clients per room (default: 16)
  -map <mapname>       Starting map (default: start)
  -pak <path>          Path to pak0.pak (default: ../pak0.pak)
  -cert <path>         TLS certificate file (default: cert.pem)
  -key <path>          TLS key file (default: key.pem)
  -tickrate <hz>       Server tick rate (default: 72)
  -help                Show this help

Example:
  deno run --allow-net --allow-read server/main.ts -port 4433 -map e1m1
`);
}


/**
 * Initialize the server
 */
async function initServer(): Promise<boolean> {
	Sys_Printf('\n');
	Sys_Printf('========================================\n');
	Sys_Printf('Three-Quake Dedicated Server v1.0\n');
	Sys_Printf('========================================\n');
	Sys_Printf('\n');

	// Load PAK file
	Sys_Printf('Loading game data...\n');
	const pak = await COM_LoadPackFromFile(CONFIG.pakPath);
	if (!pak) {
		Sys_Printf('ERROR: Failed to load ' + CONFIG.pakPath + '\n');
		Sys_Printf('Make sure pak0.pak is in the correct location.\n');
		return false;
	}
	COM_AddPack(pak);

	// Initialize model system
	Mod_Init();

	// Configure WebTransport server
	Sys_Printf('Configuring network...\n');
	WT_SetConfig({
		port: CONFIG.port,
		certFile: CONFIG.certFile,
		keyFile: CONFIG.keyFile,
	});

	// Initialize the server
	try {
		await Host_Init_Server({
			maxClients: CONFIG.maxClients,
			port: CONFIG.port,
			tickRate: CONFIG.tickRate,
			defaultMap: CONFIG.defaultMap,
		});
	} catch (error) {
		Sys_Printf(
			'ERROR: Failed to initialize server: ' +
				(error as Error).message +
				'\n'
		);
		Sys_Printf('\nMake sure you have valid TLS certificates.\n');
		Sys_Printf('To generate self-signed certificates for development:\n');
		Sys_Printf(
			'  openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes\n'
		);
		return false;
	}

	// Spawn the default map
	await SV_SpawnServer(CONFIG.defaultMap);

	Sys_Printf('\n');
	Sys_Printf('Server initialized successfully!\n');
	Sys_Printf('  Port: ' + CONFIG.port + '\n');
	Sys_Printf('  Max clients: ' + CONFIG.maxClients + '\n');
	Sys_Printf('  Tick rate: ' + CONFIG.tickRate + ' Hz\n');
	Sys_Printf('  Map: ' + CONFIG.defaultMap + '\n');
	Sys_Printf('\n');
	Sys_Printf('Waiting for connections...\n');
	Sys_Printf('\n');

	return true;
}

/**
 * Run a single server frame
 */
function serverFrame(deltaTime: number): void {
	if (!sv.active) return;

	Host_ServerFrame(deltaTime);
}

/**
 * Main server loop
 */
async function runServerLoop(): Promise<void> {
	const tickInterval = 1000 / CONFIG.tickRate;
	let lastTime = Sys_FloatTime();

	Sys_Printf('Starting server loop at ' + CONFIG.tickRate + ' Hz...\n');

	// Use setInterval for consistent tick rate
	const intervalId = setInterval(() => {
		const currentTime = Sys_FloatTime();
		const deltaTime = currentTime - lastTime;
		lastTime = currentTime;

		serverFrame(deltaTime);
	}, tickInterval);

	// Handle shutdown signals
	const handleShutdown = () => {
		Sys_Printf('\nShutting down server...\n');
		clearInterval(intervalId);
		Host_Shutdown_Server();
		Sys_Printf('Server stopped.\n');
		Deno.exit(0);
	};

	// Register signal handlers
	Deno.addSignalListener('SIGINT', handleShutdown);
	Deno.addSignalListener('SIGTERM', handleShutdown);

	// Keep the process running
	await new Promise(() => {});
}

/**
 * Entry point
 */
async function main(): Promise<void> {
	parseArgs();

	const success = await initServer();
	if (!success) {
		Deno.exit(1);
	}

	// Periodic room cleanup
	setInterval(() => {
		cleanupRooms();
	}, CONFIG.roomCleanupInterval);

	await runServerLoop();
}

// Run the server
main().catch((error) => {
	console.error('Fatal error:', error);
	Deno.exit(1);
});
