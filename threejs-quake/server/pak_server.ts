// Server-side PAK file loader for Deno
// Loads PAK files from the filesystem instead of fetch()

import { Sys_Printf, Sys_Error } from './sys_server.ts';

const MAX_FILES_IN_PACK = 2048;

interface PackFile {
	name: string;
	filepos: number;
	filelen: number;
}

interface Pack {
	filename: string;
	files: PackFile[];
	data: ArrayBuffer;
}

interface SearchPath {
	pack: Pack | null;
	path: string | null;
}

// Search paths
const com_searchpaths: SearchPath[] = [];

// Loaded packs
const loadedPacks: Pack[] = [];

/**
 * Load a PAK file from the filesystem
 */
export async function COM_LoadPackFromFile(path: string): Promise<Pack | null> {
	Sys_Printf('Loading pack file: ' + path + '\n');

	try {
		const data = await Deno.readFile(path);
		const buffer = data.buffer as ArrayBuffer;
		return COM_LoadPackFile(path, buffer);
	} catch (error) {
		Sys_Printf('Failed to load pack file: ' + (error as Error).message + '\n');
		return null;
	}
}

/**
 * Parse a PAK file from an ArrayBuffer
 */
export function COM_LoadPackFile(filename: string, buffer: ArrayBuffer): Pack | null {
	const view = new DataView(buffer);

	// Check header
	const id0 = view.getUint8(0);
	const id1 = view.getUint8(1);
	const id2 = view.getUint8(2);
	const id3 = view.getUint8(3);

	if (id0 !== 0x50 || id1 !== 0x41 || id2 !== 0x43 || id3 !== 0x4B) {
		// 'PACK'
		Sys_Error(filename + ' is not a packfile');
	}

	const dirofs = view.getInt32(4, true);
	const dirlen = view.getInt32(8, true);

	const numpackfiles = Math.floor(dirlen / 64);

	if (numpackfiles > MAX_FILES_IN_PACK) {
		Sys_Error(filename + ' has too many files (' + numpackfiles + ')');
	}

	const pack: Pack = {
		filename: filename,
		files: [],
		data: buffer,
	};

	const bytes = new Uint8Array(buffer);

	for (let i = 0; i < numpackfiles; i++) {
		const entryOffset = dirofs + i * 64;

		// Read filename (56 bytes, null terminated)
		let name = '';
		for (let j = 0; j < 56; j++) {
			const c = bytes[entryOffset + j];
			if (c === 0) break;
			name += String.fromCharCode(c);
		}

		const file: PackFile = {
			name: name.toLowerCase(),
			filepos: view.getInt32(entryOffset + 56, true),
			filelen: view.getInt32(entryOffset + 60, true),
		};

		pack.files.push(file);
	}

	Sys_Printf('Added packfile ' + filename + ' (' + numpackfiles + ' files)\n');

	loadedPacks.push(pack);

	return pack;
}

/**
 * Add a game directory to the search path
 */
export function COM_AddGameDirectory(dir: string): void {
	com_searchpaths.push({ pack: null, path: dir });
}

/**
 * Add a loaded pack to the search path
 */
export function COM_AddPack(pack: Pack): void {
	com_searchpaths.unshift({ pack: pack, path: null });
}

/**
 * Find a file in the search paths
 */
export function COM_FindFile(
	filename: string
): { data: Uint8Array; size: number } | null {
	const search = filename.toLowerCase();

	// Search through loaded packs
	for (const sp of com_searchpaths) {
		if (!sp.pack) continue;

		const pack = sp.pack;
		for (const file of pack.files) {
			if (file.name === search) {
				const data = new Uint8Array(pack.data, file.filepos, file.filelen);
				return { data: data, size: file.filelen };
			}
		}
	}

	return null;
}

/**
 * Load a file and return its contents as an ArrayBuffer
 */
export function COM_LoadFile(filename: string): ArrayBuffer | null {
	const result = COM_FindFile(filename);
	if (!result) return null;

	// Return a copy of the data
	const buf = new ArrayBuffer(result.size);
	const dest = new Uint8Array(buf);
	dest.set(result.data);
	return buf;
}

/**
 * Load a file and return its contents as a string
 */
export function COM_LoadFileAsString(filename: string): string | null {
	const result = COM_FindFile(filename);
	if (!result) return null;

	let str = '';
	for (let i = 0; i < result.size; i++) {
		str += String.fromCharCode(result.data[i]);
	}

	return str;
}
