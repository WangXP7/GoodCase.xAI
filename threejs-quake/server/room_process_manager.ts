// Room Process Manager for Three-Quake
// Spawns and manages isolated Deno processes for each game room
// This matches how original Quake handled multiple games: separate server processes

import { Sys_Printf } from './sys_server.ts';

// Port range for room servers (main lobby is on 4433)
const BASE_PORT = 4434;
const MAX_ROOMS = 10;
const ROOM_STARTUP_GRACE_MS = 30 * 1000;
const ROOM_WATCHDOG_TIMEOUT_MS = 30 * 1000;
const ROOM_JOIN_STALE_MS = 12 * 1000;

interface RoomProcess {
	id: string;
	map: string;
	port: number;
	maxPlayers: number;
	hostName: string;
	process: Deno.ChildProcess;
	createdAt: number;
	playerCount: number;
	lastActiveTime: number;  // Last time room had players (for idle cleanup)
	lastOutputTime: number;  // Last stdout/stderr line seen from room process
	lastWatchdogTime: number; // Last watchdog tick seen from room stderr
}

function isRoomResponsive( room: RoomProcess, now: number ): boolean {
	// Give freshly-created rooms time to boot before enforcing watchdog freshness.
	if ( now - room.createdAt < ROOM_STARTUP_GRACE_MS ) {
		return true;
	}

	return ( now - room.lastWatchdogTime ) <= ROOM_JOIN_STALE_MS;
}

// Active room processes
const roomProcesses = new Map<string, RoomProcess>();

// Track which ports are in use
const usedPorts = new Set<number>();

// Configuration (set by main server)
let certFile = '/etc/letsencrypt/live/wts.mrdoob.com/fullchain.pem';
let keyFile = '/etc/letsencrypt/live/wts.mrdoob.com/privkey.pem';
let pakPath = '/opt/three-quake/pak0.pak';
let denoPath = '/root/.deno/bin/deno';

/**
 * Configure paths for room servers
 */
export function RoomManager_SetConfig( config: {
	certFile?: string;
	keyFile?: string;
	pakPath?: string;
	denoPath?: string;
} ): void {
	if ( config.certFile != null ) certFile = config.certFile;
	if ( config.keyFile != null ) keyFile = config.keyFile;
	if ( config.pakPath != null ) pakPath = config.pakPath;
	if ( config.denoPath != null ) denoPath = config.denoPath;
}

/**
 * Generate a short room ID
 */
function generateRoomId(): string {
	const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	let id = '';
	for ( let i = 0; i < 6; i++ ) {
		id += chars[ Math.floor( Math.random() * chars.length ) ];
	}
	return id;
}

/**
 * Find an available port
 */
function findAvailablePort(): number | null {
	for ( let i = 0; i < MAX_ROOMS; i++ ) {
		const port = BASE_PORT + i;
		if ( ! usedPorts.has( port ) ) {
			return port;
		}
	}
	return null;
}

/**
 * Create a new room by spawning a dedicated server process
 * If specificId is provided, use that ID instead of generating a random one
 */
export async function RoomManager_CreateRoom( config: {
	map: string;
	maxPlayers: number;
	hostName: string;
	specificId?: string;
} ): Promise<{ id: string; port: number } | null> {
	// Reclaim any frozen rooms before enforcing limits/port availability.
	RoomManager_CleanupUnhealthyRooms();

	// Check room limit
	if ( roomProcesses.size >= MAX_ROOMS ) {
		Sys_Printf( 'Room limit reached (%d), rejecting room creation\n', MAX_ROOMS );
		return null;
	}

	// Find available port
	const port = findAvailablePort();
	if ( port === null ) {
		Sys_Printf( 'No available ports for new room\n' );
		return null;
	}

	// Mark port as used immediately (will be freed on failure)
	usedPorts.add( port );

	// Generate unique room ID (or use specificId if provided)
	let id: string;
	if ( config.specificId != null && config.specificId.length > 0 ) {
		// Check if specific ID is already in use
		if ( roomProcesses.has( config.specificId.toUpperCase() ) ) {
			Sys_Printf( 'Room ID %s already exists\n', config.specificId );
			usedPorts.delete( port );
			return null;
		}
		id = config.specificId.toUpperCase();
	} else {
		id = generateRoomId();
		while ( roomProcesses.has( id ) ) {
			id = generateRoomId();
		}
	}

	Sys_Printf( 'Creating room %s on port %d (map: %s)\n', id, port, config.map );

	try {
		// Find the path to the game server script
		const serverDir = new URL( '.', import.meta.url ).pathname;
		const gameServerPath = serverDir + 'game_server.js';
		const denoJsonPath = serverDir.replace( /server\/$/, 'deno.json' );

		// Validate map name - only allow alphanumeric and underscore
		const safeMap = config.map.replace( /[^a-zA-Z0-9_]/g, '' );
		if ( safeMap !== config.map || safeMap.length === 0 ) {
			Sys_Printf( 'Invalid map name: %s\n', config.map );
			usedPorts.delete( port );
			return null;
		}

		// Spawn dedicated server process for this room
		const command = new Deno.Command( denoPath, {
			args: [
				'run',
				'--allow-net',
				'--allow-read',
				'--unstable-net',
				'--config', denoJsonPath,
				gameServerPath,
				'-port', String( port ),
				'-maxclients', String( config.maxPlayers ),
				'-map', safeMap,
				'-pak', pakPath,
				'-cert', certFile,
				'-key', keyFile,
				'-room', id,  // Pass room ID so process can identify itself
			],
			stdout: 'piped',
			stderr: 'piped',
		} );

		const process = command.spawn();

		// Store room info
		const now = Date.now();
		const roomInfo: RoomProcess = {
			id,
			map: safeMap,
			port,
			maxPlayers: config.maxPlayers,
			hostName: config.hostName,
			process,
			createdAt: now,
			playerCount: 0,
			lastActiveTime: now,  // Initialize to creation time
			lastOutputTime: now,
			lastWatchdogTime: now,
		};
		roomProcesses.set( id, roomInfo );

		// Create a promise that resolves when we detect the server is listening
		// This is much more robust than a fixed timeout
		const STARTUP_TIMEOUT_MS = 15000;
		let serverReady = false;
		let serverStartError: Error | null = null;
		const serverReadyPromise = ( async () => {
			while ( serverReady === false ) {
				if ( serverStartError !== null ) {
					throw serverStartError;
				}
				await new Promise( resolve => setTimeout( resolve, 25 ) );
			}
		} )();

		// Pipe stdout/stderr to main server console with prefix
		// Also detect when server is ready and parse heartbeat messages
		( async () => {
			const reader = process.stdout.getReader();
			const decoder = new TextDecoder();
			try {
				while ( true ) {
					const { value, done } = await reader.read();
					if ( done ) break;
					const text = decoder.decode( value );
					for ( const line of text.split( '\n' ) ) {
						if ( line.trim() !== '' ) {
							Sys_Printf( '[Room %s] %s\n', id, line );
							const room = roomProcesses.get( id );
							if ( room !== undefined ) {
								room.lastOutputTime = Date.now();
							}

							// Detect when WebTransport server is actually listening
							// This is the signal that clients can now connect
							if ( line.includes( 'WebTransport server listening' ) ) {
								serverReady = true;
							}

							// Parse heartbeat messages: "[Heartbeat] time=X frames=Y players=Z"
							const heartbeatMatch = line.match( /\[Heartbeat\].*players=(\d+)/ );
							if ( heartbeatMatch !== null ) {
								const playerCount = parseInt( heartbeatMatch[ 1 ], 10 );
								const room = roomProcesses.get( id );
								if ( room !== undefined ) {
									room.playerCount = playerCount;
									if ( playerCount > 0 ) {
										room.lastActiveTime = Date.now();
									}
								}
							}

							// Parse player connect/disconnect for immediate updates
							// "Client X connected" - player joined
							if ( line.includes( ' connected' ) && line.includes( 'Client ' ) ) {
								const room = roomProcesses.get( id );
								if ( room !== undefined ) {
									room.playerCount++;
									room.lastActiveTime = Date.now();
								}
							}
							// "Client player removed" - player left
							if ( line.includes( 'removed' ) && line.includes( 'Client ' ) ) {
								const room = roomProcesses.get( id );
								if ( room !== undefined && room.playerCount > 0 ) {
									room.playerCount--;
								}
							}
						}
					}
				}
			} catch { /* ignore */ }
			// If stdout closes without seeing "listening", reject the promise
			if ( serverReady === false && serverStartError === null ) {
				serverStartError = new Error( 'Process stdout closed before server was ready' );
			}
		} )();

		( async () => {
			const reader = process.stderr.getReader();
			const decoder = new TextDecoder();
			try {
				while ( true ) {
					const { value, done } = await reader.read();
					if ( done ) break;
					const text = decoder.decode( value );
					for ( const line of text.split( '\n' ) ) {
						if ( line.trim() !== '' ) {
							Sys_Printf( '[Room %s ERR] %s\n', id, line );
							const room = roomProcesses.get( id );
							if ( room !== undefined ) {
								const now = Date.now();
								room.lastOutputTime = now;
								if ( line.includes( '[WATCHDOG]' ) ) {
									room.lastWatchdogTime = now;
								}
							}
						}
					}
				}
			} catch { /* ignore */ }
		} )();

		// Monitor process exit
		process.status.then( ( status ) => {
			Sys_Printf( 'Room %s process exited with code %d\n', id, status.code );
			usedPorts.delete( port );
			roomProcesses.delete( id );
			// If process exits before ready, reject
			if ( serverReady === false && serverStartError === null ) {
				serverStartError = new Error( 'Process exited with code ' + status.code );
			}
		} );

		// Wait for the server to signal it's ready (or timeout)
		const timeoutPromise = new Promise<never>( ( _, reject ) => {
			setTimeout( () => reject( new Error( 'Server startup timeout' ) ), STARTUP_TIMEOUT_MS );
		} );

		try {
			await Promise.race( [ serverReadyPromise, timeoutPromise ] );
		} catch ( startupError ) {
			Sys_Printf( 'Room %s failed to start: %s\n', id, ( startupError as Error ).message );
			try {
				process.kill( 'SIGTERM' );
			} catch { /* process may have already exited */ }
			usedPorts.delete( port );
			roomProcesses.delete( id );
			return null;
		}

		Sys_Printf( 'Room %s created successfully on port %d\n', id, port );

		return { id, port };

	} catch ( error ) {
		Sys_Printf( 'Failed to create room: %s\n', ( error as Error ).message );
		usedPorts.delete( port );  // Free the port on failure
		return null;
	}
}

/**
 * Get info about a room
 */
export function RoomManager_GetRoom( id: string ): {
	id: string;
	map: string;
	port: number;
	maxPlayers: number;
	hostName: string;
	playerCount: number;
	createdAt: number;
} | null {
	RoomManager_CleanupUnhealthyRooms();

	const room = roomProcesses.get( id.toUpperCase() );
	if ( room == null ) return null;
	if ( isRoomResponsive( room, Date.now() ) === false ) return null;

	return {
		id: room.id,
		map: room.map,
		port: room.port,
		maxPlayers: room.maxPlayers,
		hostName: room.hostName,
		playerCount: room.playerCount,
		createdAt: room.createdAt,
	};
}

/**
 * List all active rooms
 */
export function RoomManager_ListRooms(): Array<{
	id: string;
	name: string;
	map: string;
	port: number;
	maxPlayers: number;
	playerCount: number;
}> {
	RoomManager_CleanupUnhealthyRooms();
	const now = Date.now();

	const rooms: Array<{
		id: string;
		name: string;
		map: string;
		port: number;
		maxPlayers: number;
		playerCount: number;
	}> = [];

	for ( const room of roomProcesses.values() ) {
		if ( isRoomResponsive( room, now ) === false ) {
			continue;
		}

		rooms.push( {
			id: room.id,
			name: room.hostName + "'s Game",
			map: room.map,
			port: room.port,
			maxPlayers: room.maxPlayers,
			playerCount: room.playerCount,
		} );
	}

	return rooms;
}

/**
 * Clean up unhealthy rooms (event loop freeze / no watchdog output).
 * Room servers emit watchdog lines every 5s. If we stop receiving watchdog
 * ticks for too long after startup, the process is considered wedged.
 */
export function RoomManager_CleanupUnhealthyRooms(): number {
	const now = Date.now();
	let cleaned = 0;

	for ( const [ id, room ] of roomProcesses ) {
		// Allow time for startup before enforcing watchdog checks.
		if ( now - room.createdAt < ROOM_STARTUP_GRACE_MS ) {
			continue;
		}

		const watchdogGapMs = now - room.lastWatchdogTime;
		if ( watchdogGapMs > ROOM_WATCHDOG_TIMEOUT_MS ) {
			Sys_Printf(
				'Room %s has no watchdog output for %ds, terminating stuck process\n',
				id,
				Math.floor( watchdogGapMs / 1000 )
			);
			RoomManager_TerminateRoom( id );
			cleaned++;
		}
	}

	return cleaned;
}

/**
 * Update player count for a room (called via IPC or health check)
 */
export function RoomManager_UpdatePlayerCount( id: string, count: number ): void {
	const room = roomProcesses.get( id );
	if ( room != null ) {
		room.playerCount = count;
		if ( count > 0 ) {
			room.lastActiveTime = Date.now();
		}
	}
}

/**
 * Terminate a room
 */
export function RoomManager_TerminateRoom( id: string ): boolean {
	const room = roomProcesses.get( id );
	if ( room == null ) return false;

	Sys_Printf( 'Terminating room %s\n', id );

	try {
		room.process.kill( 'SIGTERM' );
	} catch {
		// Process may have already exited
	}

	usedPorts.delete( room.port );
	roomProcesses.delete( id );

	return true;
}

/**
 * Clean up idle rooms (rooms with 0 players for too long)
 */
export function RoomManager_CleanupIdleRooms( maxIdleMs: number = 5 * 60 * 1000 ): number {
	RoomManager_CleanupUnhealthyRooms();

	const now = Date.now();
	let cleaned = 0;

	for ( const [ id, room ] of roomProcesses ) {
		// Check if room has been idle (0 players) for too long
		// Uses lastActiveTime which tracks when room last had players
		const idleTime = now - room.lastActiveTime;
		if ( room.playerCount === 0 && idleTime > maxIdleMs ) {
			Sys_Printf( 'Room %s idle for %ds, terminating\n', id, Math.floor( idleTime / 1000 ) );
			RoomManager_TerminateRoom( id );
			cleaned++;
		}
	}

	return cleaned;
}

/**
 * Get room count
 */
export function RoomManager_GetRoomCount(): number {
	return roomProcesses.size;
}

/**
 * Shutdown all rooms
 */
export function RoomManager_ShutdownAll(): void {
	Sys_Printf( 'Shutting down all room processes...\n' );

	for ( const id of roomProcesses.keys() ) {
		RoomManager_TerminateRoom( id );
	}
}
