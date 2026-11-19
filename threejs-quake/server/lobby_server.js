// Three-Quake Lobby Server for Deno
// Lightweight server that only handles room management
// Spawns separate game server processes for each room
//
// Usage: deno run --allow-net --allow-read --allow-run --unstable-net lobby_server.js

import { Sys_Printf } from './sys_server.ts';

// Reduce log write volume in production. Keep only allowlisted lines.
globalThis.__THREE_QUAKE_QUIET_LOGS = true;

// Global unhandled rejection handler - prevent server crashes from async errors
globalThis.addEventListener( 'unhandledrejection', ( event ) => {
	Sys_Printf( 'Unhandled promise rejection: %s\n', String( event.reason ) );
	event.preventDefault(); // Prevent default crash behavior
} );
import {
	RoomManager_SetConfig,
	RoomManager_CreateRoom,
	RoomManager_GetRoom,
	RoomManager_ListRooms,
	RoomManager_CleanupIdleRooms,
	RoomManager_CleanupUnhealthyRooms,
	RoomManager_ShutdownAll,
} from './room_process_manager.ts';

// Server configuration
const CONFIG = {
	port: 4433,
	certFile: '/etc/letsencrypt/live/wts.mrdoob.com/fullchain.pem',
	keyFile: '/etc/letsencrypt/live/wts.mrdoob.com/privkey.pem',
	pakPath: '/opt/three-quake/pak0.pak',
};

// Parse command line arguments
function parseArgs() {
	const args = Deno.args;
	for ( let i = 0; i < args.length; i++ ) {
		const arg = args[ i ];
		if ( arg === '-port' && args[ i + 1 ] ) {
			CONFIG.port = parseInt( args[ ++i ], 10 );
		} else if ( arg === '-cert' && args[ i + 1 ] ) {
			CONFIG.certFile = args[ ++i ];
		} else if ( arg === '-key' && args[ i + 1 ] ) {
			CONFIG.keyFile = args[ ++i ];
		} else if ( arg === '-pak' && args[ i + 1 ] ) {
			CONFIG.pakPath = args[ ++i ];
		}
	}
}

// Lobby message types
const LOBBY_LIST = 0x01;
const LOBBY_JOIN = 0x02;
const LOBBY_CREATE = 0x03;
const LOBBY_ROOMS = 0x81;
const LOBBY_ERROR = 0x82;
const ROOM_ID_PATTERN = /^[A-Z0-9]{6}$/;

// QUIC endpoint
let quicEndpoint = null;

// Per-reader buffer storage for leftover bytes
const _readerBuffers = new WeakMap();

function _getReaderBuffer( reader ) {
	let buf = _readerBuffers.get( reader );
	if ( buf == null ) {
		buf = { data: null, offset: 0 };
		_readerBuffers.set( reader, buf );
	}
	return buf;
}

/**
 * Read exactly n bytes from a reader, with proper buffering
 */
async function readExact( reader, n ) {
	const result = new Uint8Array( n );
	let offset = 0;
	const buf = _getReaderBuffer( reader );

	// First, use any leftover bytes from previous read
	if ( buf.data !== null && buf.offset < buf.data.length ) {
		const available = buf.data.length - buf.offset;
		const bytesToCopy = Math.min( available, n );
		result.set( buf.data.subarray( buf.offset, buf.offset + bytesToCopy ), 0 );
		offset = bytesToCopy;
		buf.offset += bytesToCopy;

		// Clear buffer if fully consumed
		if ( buf.offset >= buf.data.length ) {
			buf.data = null;
			buf.offset = 0;
		}
	}

	// Read more if needed
	while ( offset < n ) {
		const { value, done } = await reader.read();
		if ( done ) return null;

		const bytesToCopy = Math.min( value.length, n - offset );
		result.set( value.subarray( 0, bytesToCopy ), offset );
		offset += bytesToCopy;

		// Save leftover bytes for next read
		if ( bytesToCopy < value.length ) {
			buf.data = value;
			buf.offset = bytesToCopy;
		}
	}

	return result;
}

/**
 * Read a framed message: [type:1][length:2][data:N]
 */
async function readFramedMessage( reader ) {
	const header = await readExact( reader, 3 );
	if ( header === null ) return null;

	const type = header[ 0 ];
	const length = header[ 1 ] | ( header[ 2 ] << 8 );

	if ( length === 0 ) {
		return { type, data: new Uint8Array( 0 ) };
	}

	const data = await readExact( reader, length );
	if ( data === null ) return null;

	return { type, data };
}

/**
 * Send a framed message
 */
async function sendFramedMessage( writer, type, data ) {
	const frame = new Uint8Array( 3 + data.length );
	frame[ 0 ] = type;
	frame[ 1 ] = data.length & 0xff;
	frame[ 2 ] = ( data.length >> 8 ) & 0xff;
	frame.set( data, 3 );
	await writer.write( frame );
}

/**
 * Handle a WebTransport session
 */
async function handleSession( wt, address ) {
	Sys_Printf( 'Lobby connection from %s\n', address );

	try {
		await wt.ready;
		Sys_Printf( 'Session ready for %s, waiting for stream...\n', address );

		// Accept bidirectional stream with timeout
		const streamReader = wt.incomingBidirectionalStreams.getReader();
		const streamPromise = streamReader.read();
		const timeoutPromise = new Promise( ( _, reject ) =>
			setTimeout( () => reject( new Error( 'Stream accept timeout' ) ), 30000 )
		);

		let stream;
		let done;
		try {
			const result = await Promise.race( [ streamPromise, timeoutPromise ] );
			stream = result.value;
			done = result.done;
		} catch ( e ) {
			streamReader.releaseLock();
			throw e;
		}
		streamReader.releaseLock();

		if ( done || stream == null ) {
			Sys_Printf( 'No stream received from %s\n', address );
			wt.close();
			return;
		}

		Sys_Printf( 'Stream received from %s, reading message...\n', address );

		const writer = stream.writable.getWriter();
		const reader = stream.readable.getReader();

		// Read lobby message with timeout
		const msgPromise = readFramedMessage( reader );
		const msgTimeoutPromise = new Promise( ( _, reject ) =>
			setTimeout( () => reject( new Error( 'Message read timeout' ) ), 10000 )
		);

		let msg;
		try {
			msg = await Promise.race( [ msgPromise, msgTimeoutPromise ] );
		} catch ( e ) {
			Sys_Printf( 'Message read error from %s: %s\n', address, e.message );
			wt.close();
			return;
		}

		if ( msg === null ) {
			Sys_Printf( 'Empty message from %s\n', address );
			wt.close();
			return;
		}

		Sys_Printf( 'Received message type %d from %s\n', msg.type, address );

		switch ( msg.type ) {
			case LOBBY_LIST: {
				// Send room list
				const rooms = RoomManager_ListRooms();
				const json = JSON.stringify( rooms );
				const data = new TextEncoder().encode( json );
				await sendFramedMessage( writer, LOBBY_ROOMS, data );
				Sys_Printf( 'Sent room list to %s (%d rooms)\n', address, rooms.length );
				break;
			}

			case LOBBY_CREATE: {
				// Create new room
				const configJson = new TextDecoder().decode( msg.data );
				try {
					const config = JSON.parse( configJson );
					const result = await RoomManager_CreateRoom( {
						map: config.map || 'rapture1',
						maxPlayers: config.maxPlayers || 4,
						hostName: config.hostName || 'Player',
					} );

					if ( result === null ) {
						const errorMsg = 'Server room limit reached. Try again later.';
						const errorData = new TextEncoder().encode( errorMsg );
						await sendFramedMessage( writer, LOBBY_ERROR, errorData );
						Sys_Printf( 'Room creation failed for %s (limit reached)\n', address );
					} else {
						// Get the actual room info (with sanitized map name)
						const room = RoomManager_GetRoom( result.id );
						const roomInfo = {
							id: result.id,
							port: result.port,
							map: room !== null ? room.map : ( config.map || 'rapture1' ),
							maxPlayers: room !== null ? room.maxPlayers : ( config.maxPlayers || 4 ),
							hostName: room !== null ? room.hostName : ( config.hostName || 'Player' ),
						};
						const json = JSON.stringify( roomInfo );
						const data = new TextEncoder().encode( json );
						await sendFramedMessage( writer, LOBBY_ROOMS, data );
						Sys_Printf( 'Room %s created on port %d for %s\n', result.id, result.port, address );
					}
				} catch ( e ) {
					const errorData = new TextEncoder().encode( 'Invalid room config' );
					await sendFramedMessage( writer, LOBBY_ERROR, errorData );
					Sys_Printf( 'Invalid room config from %s: %s\n', address, e.message );
				}
				break;
			}

			case LOBBY_JOIN: {
				// Get room info so client knows which port to connect to
				const roomId = new TextDecoder().decode( msg.data ).trim().toUpperCase();
				let room = RoomManager_GetRoom( roomId );
				let attemptedRoomAutocreate = false;
				let roomCreateResult = null;

				// If a valid room ID link points to an expired room, auto-create it.
				if ( room === null && ROOM_ID_PATTERN.test( roomId ) ) {
					attemptedRoomAutocreate = true;
					Sys_Printf( 'Auto-creating room for link ID: %s\n', roomId );
					roomCreateResult = await RoomManager_CreateRoom( {
						map: 'rapture1',
						maxPlayers: 4,
						hostName: 'Shared',
						specificId: roomId,
					} );
					// Re-check room either way:
					// - create succeeded (new room)
					// - create raced with another join and room already exists
					room = RoomManager_GetRoom( roomId );
				}

				if ( room === null ) {
					let errorMsg = 'Room not found. The game may have ended.';
					if ( attemptedRoomAutocreate === true ) {
						if ( RoomManager_ListRooms().length >= 10 ) {
							errorMsg = 'Server room limit reached. Try again later.';
						} else if ( roomCreateResult === null ) {
							errorMsg = 'Unable to create room right now. Please try again.';
						}
					}
					const errorData = new TextEncoder().encode( errorMsg );
					await sendFramedMessage( writer, LOBBY_ERROR, errorData );
					Sys_Printf( 'Room %s unavailable for %s (%s)\n', roomId, address, errorMsg );
				} else if ( room.playerCount >= room.maxPlayers ) {
					// Room is full
					const errorMsg = 'Room is full (' + room.playerCount + '/' + room.maxPlayers + ' players)';
					const errorData = new TextEncoder().encode( errorMsg );
					await sendFramedMessage( writer, LOBBY_ERROR, errorData );
					Sys_Printf( 'Room %s is full (%d/%d) - rejecting %s\n', roomId, room.playerCount, room.maxPlayers, address );
				} else {
					// Send room info with port
					const roomInfo = {
						id: room.id,
						port: room.port,
						map: room.map,
						maxPlayers: room.maxPlayers,
						hostName: room.hostName,
					};
					const json = JSON.stringify( roomInfo );
					const data = new TextEncoder().encode( json );
					await sendFramedMessage( writer, LOBBY_ROOMS, data );
					Sys_Printf( 'Sent room %s info (port %d) to %s\n', room.id, room.port, address );
				}
				break;
			}

			default:
				Sys_Printf( 'Unknown lobby message type %d from %s\n', msg.type, address );
		}

		// Close connection after handling lobby request
		try {
			await writer.close();
		} catch { /* ignore */ }
		await new Promise( resolve => setTimeout( resolve, 100 ) );
		wt.close();

	} catch ( error ) {
		Sys_Printf( 'Session error from %s: %s\n', address, error.message );
		try { wt.close(); } catch { /* ignore */ }
	}
}

/**
 * Accept connections
 */
async function acceptConnections( listener ) {
	while ( quicEndpoint !== null ) {
		try {
			const conn = await listener.accept();
			const remoteAddr = conn.remoteAddr;
			const address = remoteAddr.hostname + ':' + remoteAddr.port;

			// Handle in background
			( async () => {
				try {
					const wt = await Deno.upgradeWebTransport( conn );
					await handleSession( wt, address );
				} catch ( error ) {
					Sys_Printf( 'Connection error from %s: %s\n', address, error.message );
					try { conn.close(); } catch { /* ignore */ }
				}
			} )();

		} catch ( error ) {
			if ( quicEndpoint !== null ) {
				Sys_Printf( 'Accept error: %s\n', error.message );
				// Delay before retrying to prevent 100% CPU spin if accept() fails repeatedly
				await new Promise( resolve => setTimeout( resolve, 100 ) );
			}
		}
	}
}

/**
 * Start the lobby server
 */
async function startServer() {
	Sys_Printf( '========================================\n' );
	Sys_Printf( 'Three-Quake Lobby Server v1.0\n' );
	Sys_Printf( '========================================\n\n' );

	// Configure room manager
	RoomManager_SetConfig( {
		certFile: CONFIG.certFile,
		keyFile: CONFIG.keyFile,
		pakPath: CONFIG.pakPath,
	} );

	// Read TLS certificates
	const cert = await Deno.readTextFile( CONFIG.certFile );
	const key = await Deno.readTextFile( CONFIG.keyFile );

	// Create QUIC endpoint
	quicEndpoint = new Deno.QuicEndpoint( {
		hostname: '0.0.0.0',
		port: CONFIG.port,
	} );

	const listener = quicEndpoint.listen( {
		cert,
		key,
		alpnProtocols: [ 'h3' ],
	} );

	Sys_Printf( 'Lobby server listening on port %d\n', CONFIG.port );
	Sys_Printf( 'Rooms will spawn on ports 4434-4443\n\n' );

	// Start cleanup timer (every 5 minutes)
	setInterval( () => {
		const unhealthy = RoomManager_CleanupUnhealthyRooms();
		if ( unhealthy > 0 ) {
			Sys_Printf( 'Cleaned up %d unhealthy rooms\n', unhealthy );
		}

		const cleaned = RoomManager_CleanupIdleRooms();
		if ( cleaned > 0 ) {
			Sys_Printf( 'Cleaned up %d idle rooms\n', cleaned );
		}
	}, 5 * 60 * 1000 );

	// Accept connections
	await acceptConnections( listener );
}

/**
 * Main entry point
 */
async function main() {
	parseArgs();

	// Handle shutdown
	Deno.addSignalListener( 'SIGTERM', () => {
		Sys_Printf( 'Received SIGTERM, shutting down...\n' );
		RoomManager_ShutdownAll();
		if ( quicEndpoint !== null ) {
			quicEndpoint.close();
			quicEndpoint = null;
		}
		Deno.exit( 0 );
	} );

	try {
		await startServer();
	} catch ( error ) {
		console.error( 'Fatal error:', error );
		Deno.exit( 1 );
	}
}

main();
