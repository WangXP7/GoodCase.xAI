// Room management for multiplayer WebTransport server
// Handles multiple game instances with unique room IDs

import { Sys_Printf } from './sys_server.ts';

// Server limits
export const MAX_ROOMS = 10;

// Room configuration
export interface RoomConfig {
	maxPlayers: number;
	map: string;
	hostName: string;
}

// Room state
export interface Room {
	id: string;
	name: string;
	map: string;
	maxPlayers: number;
	playerCount: number;
	hostName: string;
	createdAt: number;
	lastActivity: number;
}

// In-memory room storage
const rooms = new Map<string, Room>();

// Room ID generation
function generateRoomId(): string {
	// Generate a short, readable room code (6 chars)
	const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude confusing chars
	let id = '';
	for (let i = 0; i < 6; i++) {
		id += chars[Math.floor(Math.random() * chars.length)];
	}
	return id;
}

/**
 * Create a new room
 * Returns null if room limit is reached
 */
export function createRoom(config: RoomConfig): Room | null {
	// Check room limit
	if (rooms.size >= MAX_ROOMS) {
		Sys_Printf('Room limit reached (%d), rejecting room creation\n', MAX_ROOMS);
		return null;
	}

	// Generate unique ID
	let id = generateRoomId();
	while (rooms.has(id)) {
		id = generateRoomId();
	}

	const room: Room = {
		id,
		name: `${config.hostName}'s Game`,
		map: config.map,
		maxPlayers: config.maxPlayers,
		playerCount: 0,
		hostName: config.hostName,
		createdAt: Date.now(),
		lastActivity: Date.now(),
	};

	rooms.set(id, room);
	Sys_Printf('Room created: %s (map: %s, max: %d) [%d/%d rooms]\n', id, config.map, config.maxPlayers, rooms.size, MAX_ROOMS);

	return room;
}

/**
 * Create a room with a specific ID (for shared links)
 * Returns null if room limit is reached
 */
export function createRoomWithId(id: string, config: RoomConfig): Room | null {
	// Check room limit
	if (rooms.size >= MAX_ROOMS) {
		Sys_Printf('Room limit reached (%d), rejecting room creation\n', MAX_ROOMS);
		return null;
	}

	// Check if room already exists
	if (rooms.has(id.toUpperCase())) {
		return rooms.get(id.toUpperCase())!;
	}

	const room: Room = {
		id: id.toUpperCase(),
		name: `Shared Game`,
		map: config.map,
		maxPlayers: config.maxPlayers,
		playerCount: 0,
		hostName: config.hostName,
		createdAt: Date.now(),
		lastActivity: Date.now(),
	};

	rooms.set(id.toUpperCase(), room);
	Sys_Printf('Room auto-created: %s (map: %s, max: %d) [%d/%d rooms]\n', id, config.map, config.maxPlayers, rooms.size, MAX_ROOMS);

	return room;
}

/**
 * Get a room by ID
 */
export function getRoom(id: string): Room | undefined {
	return rooms.get(id.toUpperCase());
}

/**
 * List all active rooms
 */
export function listRooms(): Room[] {
	return Array.from(rooms.values());
}

/**
 * Update room player count
 */
export function updateRoomPlayerCount(id: string, count: number): void {
	const room = rooms.get(id);
	if (room) {
		room.playerCount = count;
		room.lastActivity = Date.now();
	}
}

/**
 * Delete a room
 */
export function deleteRoom(id: string): boolean {
	const deleted = rooms.delete(id);
	if (deleted) {
		Sys_Printf('Room deleted: %s\n', id);
	}
	return deleted;
}

/**
 * Clean up empty/stale rooms
 */
export function cleanupRooms(maxIdleMs: number = 5 * 60 * 1000): number {
	const now = Date.now();
	let cleaned = 0;

	for (const [id, room] of rooms) {
		// Delete rooms that are empty and idle for too long
		if (room.playerCount === 0 && (now - room.lastActivity) > maxIdleMs) {
			rooms.delete(id);
			Sys_Printf('Room expired: %s (idle for %ds)\n', id, Math.floor((now - room.lastActivity) / 1000));
			cleaned++;
		}
	}

	return cleaned;
}

/**
 * Get room count
 */
export function getRoomCount(): number {
	return rooms.size;
}
