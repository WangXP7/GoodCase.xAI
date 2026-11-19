// Headless model loader for Deno server
// Loads BSP models without Three.js dependencies
// Only loads collision data (planes, clipnodes, hulls) needed for server physics

import { Sys_Printf, Sys_Error } from './sys_server.ts';
import { COM_LoadFile } from './pak_server.ts';

// BSP format constants (from bspfile.js)
const BSPVERSION = 29;

// Lump indices
const LUMP_ENTITIES = 0;
const LUMP_PLANES = 1;
const LUMP_TEXTURES = 2;
const LUMP_VERTEXES = 3;
const LUMP_VISIBILITY = 4;
const LUMP_NODES = 5;
const LUMP_TEXINFO = 6;
const LUMP_FACES = 7;
const LUMP_LIGHTING = 8;
const LUMP_CLIPNODES = 9;
const LUMP_LEAFS = 10;
const LUMP_MARKSURFACES = 11;
const LUMP_EDGES = 12;
const LUMP_SURFEDGES = 13;
const LUMP_MODELS = 14;
const HEADER_LUMPS = 15;

// Map limits
const MAX_MAP_HULLS = 4;
const MAX_MAP_LEAFS = 8192;

// Contents
const CONTENTS_EMPTY = -1;
const CONTENTS_SOLID = -2;
const CONTENTS_WATER = -3;
const CONTENTS_SLIME = -4;
const CONTENTS_LAVA = -5;
const CONTENTS_SKY = -6;

// Model types
const mod_brush = 0;
const mod_sprite = 1;
const mod_alias = 2;

// ============================================================================
// In-memory model structures
// ============================================================================

export class mplane_t {
	normal = new Float32Array(3);
	dist = 0;
	type = 0;
	signbits = 0;
}

export class mclipnode_t {
	planenum = 0;
	children: [number, number] = [0, 0]; // negative numbers are contents
}

export class hull_t {
	clipnodes: mclipnode_t[] | null = null;
	planes: mplane_t[] | null = null;
	firstclipnode = 0;
	lastclipnode = 0;
	clip_mins = new Float32Array(3);
	clip_maxs = new Float32Array(3);
}

export class mnode_t {
	contents = 0; // 0 for nodes, < 0 for leafs
	visframe = 0;
	mins = new Float32Array(3);
	maxs = new Float32Array(3);
	parent: mnode_t | null = null;
	plane: mplane_t | null = null;
	children: [mnode_t | mleaf_t | null, mnode_t | mleaf_t | null] = [
		null,
		null,
	];
	firstsurface = 0;
	numsurfaces = 0;
}

export class mleaf_t {
	contents = 0;
	visframe = 0;
	mins = new Float32Array(3);
	maxs = new Float32Array(3);
	parent: mnode_t | null = null;
	compressed_vis: Uint8Array | null = null;
	efrags = null;
	firstmarksurface = 0;
	nummarksurfaces = 0;
	key = 0;
	ambient_sound_level = new Uint8Array(4);
}

export class dmodel_t {
	mins = new Float32Array(3);
	maxs = new Float32Array(3);
	origin = new Float32Array(3);
	headnode: number[] = new Array(MAX_MAP_HULLS).fill(0);
	visleafs = 0;
	firstface = 0;
	numfaces = 0;
}

export class model_t {
	name = '';
	needload = 0;
	type = mod_brush;
	numframes = 0;
	synctype = 0;
	flags = 0;

	// Volume
	mins = new Float32Array(3);
	maxs = new Float32Array(3);
	radius = 0;

	// Brush model data
	firstmodelsurface = 0;
	nummodelsurfaces = 0;
	numsubmodels = 0;
	submodels: dmodel_t[] = [];

	numplanes = 0;
	planes: mplane_t[] = [];

	numleafs = 0;
	leafs: mleaf_t[] = [];

	numvertexes = 0;
	vertexes: Float32Array | null = null; // [numvertexes * 3]

	numclipnodes = 0;
	clipnodes: mclipnode_t[] = [];

	numnodes = 0;
	nodes: mnode_t[] = [];

	// Hulls for collision
	hulls: hull_t[] = [];

	// Entity string
	entities = '';

	// Visibility data (for PVS)
	visdata: Uint8Array | null = null;

	// For caching
	loaded = false;
}

// Model cache
const mod_known: model_t[] = [];
let mod_numknown = 0;
const MAX_MOD_KNOWN = 512;

// Currently loading model
let loadmodel: model_t | null = null;
let mod_base: Uint8Array | null = null;

// ============================================================================
// Model Loading Functions
// ============================================================================

/**
 * Initialize the model system
 */
export function Mod_Init(): void {
	for (let i = 0; i < MAX_MOD_KNOWN; i++) {
		mod_known[i] = new model_t();
	}
	mod_numknown = 0;
}

/**
 * Clear all loaded models
 */
export function Mod_ClearAll(): void {
	for (let i = 0; i < mod_numknown; i++) {
		mod_known[i].loaded = false;
	}
}

/**
 * Find a model slot for the given name
 */
export function Mod_FindName(name: string): model_t | null {
	if (!name || name.length === 0) {
		Sys_Error('Mod_FindName: NULL name');
	}

	// Search for existing
	for (let i = 0; i < mod_numknown; i++) {
		if (mod_known[i].name === name) {
			return mod_known[i];
		}
	}

	// Find a free slot
	if (mod_numknown >= MAX_MOD_KNOWN) {
		Sys_Error('mod_numknown >= MAX_MOD_KNOWN');
	}

	const mod = mod_known[mod_numknown];
	mod.name = name;
	mod_numknown++;

	return mod;
}

/**
 * Load a model by name
 */
export function Mod_ForName(name: string, crash: boolean): model_t | null {
	const mod = Mod_FindName(name);
	if (!mod) return null;

	return Mod_LoadModel(mod, crash);
}

/**
 * Load a model's data
 */
export function Mod_LoadModel(mod: model_t, crash: boolean): model_t | null {
	if (mod.loaded) {
		return mod;
	}

	// Load the file
	const buf = COM_LoadFile(mod.name);
	if (!buf) {
		if (crash) {
			Sys_Error('Mod_LoadModel: ' + mod.name + ' not found');
		}
		return null;
	}

	loadmodel = mod;
	mod_base = new Uint8Array(buf);

	// Determine model type from magic number
	const view = new DataView(buf);
	const magic = view.getInt32(0, true);

	if (magic === BSPVERSION) {
		Mod_LoadBrushModel(mod, buf);
	} else {
		// Alias and sprite models not needed on server for collision
		// But we still mark them as loaded
		Sys_Printf('Mod_LoadModel: skipping non-BSP model %s\n', mod.name);
		mod.type = mod.name.endsWith('.spr') ? mod_sprite : mod_alias;
	}

	mod.loaded = true;
	return mod;
}

/**
 * Load a BSP brush model
 */
function Mod_LoadBrushModel(mod: model_t, buffer: ArrayBuffer): void {
	mod.type = mod_brush;
	const view = new DataView(buffer);

	const version = view.getInt32(0, true);
	if (version !== BSPVERSION) {
		Sys_Error('Mod_LoadBrushModel: ' + mod.name + ' has wrong version');
	}

	// Read lump directory
	const lumps: Array<{ fileofs: number; filelen: number }> = [];
	for (let i = 0; i < HEADER_LUMPS; i++) {
		const offset = 4 + i * 8;
		lumps[i] = {
			fileofs: view.getInt32(offset, true),
			filelen: view.getInt32(offset + 4, true),
		};
	}

	// Load collision data (order matters for some dependencies)
	Mod_LoadPlanes(mod, lumps[LUMP_PLANES].fileofs, lumps[LUMP_PLANES].filelen);
	Mod_LoadVertexes(
		mod,
		lumps[LUMP_VERTEXES].fileofs,
		lumps[LUMP_VERTEXES].filelen
	);
	Mod_LoadVisibility(
		mod,
		lumps[LUMP_VISIBILITY].fileofs,
		lumps[LUMP_VISIBILITY].filelen
	);
	Mod_LoadLeafs(mod, lumps[LUMP_LEAFS].fileofs, lumps[LUMP_LEAFS].filelen);
	Mod_LoadNodes(mod, lumps[LUMP_NODES].fileofs, lumps[LUMP_NODES].filelen);
	Mod_LoadClipnodes(
		mod,
		lumps[LUMP_CLIPNODES].fileofs,
		lumps[LUMP_CLIPNODES].filelen
	);
	Mod_LoadEntities(
		mod,
		lumps[LUMP_ENTITIES].fileofs,
		lumps[LUMP_ENTITIES].filelen
	);
	Mod_LoadSubmodels(
		mod,
		lumps[LUMP_MODELS].fileofs,
		lumps[LUMP_MODELS].filelen
	);

	// Build hulls
	Mod_MakeHull0(mod);

	// Set model bounds from submodel 0
	if (mod.submodels.length > 0) {
		mod.mins.set(mod.submodels[0].mins);
		mod.maxs.set(mod.submodels[0].maxs);
	}

	Sys_Printf('Loaded BSP model: %s\n', mod.name);
}

/**
 * Load planes
 */
function Mod_LoadPlanes(mod: model_t, fileofs: number, filelen: number): void {
	if (!mod_base) return;

	const view = new DataView(mod_base.buffer, fileofs, filelen);
	const count = Math.floor(filelen / 20); // dplane_t is 20 bytes

	mod.planes = [];
	mod.numplanes = count;

	for (let i = 0; i < count; i++) {
		const plane = new mplane_t();
		const offset = i * 20;

		plane.normal[0] = view.getFloat32(offset + 0, true);
		plane.normal[1] = view.getFloat32(offset + 4, true);
		plane.normal[2] = view.getFloat32(offset + 8, true);
		plane.dist = view.getFloat32(offset + 12, true);
		plane.type = view.getInt32(offset + 16, true);

		// Calculate signbits
		let bits = 0;
		for (let j = 0; j < 3; j++) {
			if (plane.normal[j] < 0) bits |= 1 << j;
		}
		plane.signbits = bits;

		mod.planes.push(plane);
	}
}

/**
 * Load vertexes (needed for some collision calculations)
 */
function Mod_LoadVertexes(
	mod: model_t,
	fileofs: number,
	filelen: number
): void {
	if (!mod_base) return;

	const view = new DataView(mod_base.buffer, fileofs, filelen);
	const count = Math.floor(filelen / 12); // dvertex_t is 12 bytes (3 floats)

	mod.numvertexes = count;
	mod.vertexes = new Float32Array(count * 3);

	for (let i = 0; i < count; i++) {
		const offset = i * 12;
		mod.vertexes[i * 3 + 0] = view.getFloat32(offset + 0, true);
		mod.vertexes[i * 3 + 1] = view.getFloat32(offset + 4, true);
		mod.vertexes[i * 3 + 2] = view.getFloat32(offset + 8, true);
	}
}

/**
 * Load visibility data
 */
function Mod_LoadVisibility(
	mod: model_t,
	fileofs: number,
	filelen: number
): void {
	if (!mod_base) return;

	if (filelen === 0) {
		mod.visdata = null;
		return;
	}

	mod.visdata = new Uint8Array(filelen);
	mod.visdata.set(mod_base.subarray(fileofs, fileofs + filelen));
}

/**
 * Load leafs
 */
function Mod_LoadLeafs(mod: model_t, fileofs: number, filelen: number): void {
	if (!mod_base) return;

	const view = new DataView(mod_base.buffer, fileofs, filelen);
	const count = Math.floor(filelen / 28); // dleaf_t is 28 bytes

	mod.leafs = [];
	mod.numleafs = count;

	for (let i = 0; i < count; i++) {
		const leaf = new mleaf_t();
		const offset = i * 28;

		leaf.contents = view.getInt32(offset + 0, true);

		const visofs = view.getInt32(offset + 4, true);
		if (visofs !== -1 && mod.visdata) {
			leaf.compressed_vis = mod.visdata.subarray(visofs);
		}

		// Bounding box
		leaf.mins[0] = view.getInt16(offset + 8, true);
		leaf.mins[1] = view.getInt16(offset + 10, true);
		leaf.mins[2] = view.getInt16(offset + 12, true);
		leaf.maxs[0] = view.getInt16(offset + 14, true);
		leaf.maxs[1] = view.getInt16(offset + 16, true);
		leaf.maxs[2] = view.getInt16(offset + 18, true);

		leaf.firstmarksurface = view.getUint16(offset + 20, true);
		leaf.nummarksurfaces = view.getUint16(offset + 22, true);

		// Ambient sound levels
		for (let j = 0; j < 4; j++) {
			leaf.ambient_sound_level[j] = mod_base[fileofs + offset + 24 + j];
		}

		mod.leafs.push(leaf);
	}
}

/**
 * Load nodes
 */
function Mod_LoadNodes(mod: model_t, fileofs: number, filelen: number): void {
	if (!mod_base) return;

	const view = new DataView(mod_base.buffer, fileofs, filelen);
	const count = Math.floor(filelen / 24); // dnode_t is 24 bytes

	mod.nodes = [];
	mod.numnodes = count;

	// First pass: create all nodes
	for (let i = 0; i < count; i++) {
		mod.nodes.push(new mnode_t());
	}

	// Second pass: fill in data
	for (let i = 0; i < count; i++) {
		const node = mod.nodes[i];
		const offset = i * 24;

		const planenum = view.getInt32(offset + 0, true);
		node.plane = mod.planes[planenum];

		// Children
		for (let j = 0; j < 2; j++) {
			const child = view.getInt16(offset + 4 + j * 2, true);
			if (child >= 0) {
				node.children[j] = mod.nodes[child];
			} else {
				// Negative = leaf index
				node.children[j] = mod.leafs[~child];
			}
		}

		// Bounding box
		node.mins[0] = view.getInt16(offset + 8, true);
		node.mins[1] = view.getInt16(offset + 10, true);
		node.mins[2] = view.getInt16(offset + 12, true);
		node.maxs[0] = view.getInt16(offset + 14, true);
		node.maxs[1] = view.getInt16(offset + 16, true);
		node.maxs[2] = view.getInt16(offset + 18, true);

		node.firstsurface = view.getUint16(offset + 20, true);
		node.numsurfaces = view.getUint16(offset + 22, true);
	}

	// Set parent pointers
	Mod_SetParent(mod.nodes[0], null);
}

/**
 * Set parent pointers for node tree
 */
function Mod_SetParent(
	node: mnode_t | mleaf_t | null,
	parent: mnode_t | null
): void {
	if (!node) return;

	node.parent = parent;

	// Nodes have contents = 0, leafs have contents < 0
	if (node.contents < 0) return; // It's a leaf

	const n = node as mnode_t;
	Mod_SetParent(n.children[0] as mnode_t | mleaf_t, n);
	Mod_SetParent(n.children[1] as mnode_t | mleaf_t, n);
}

/**
 * Load clipnodes
 */
function Mod_LoadClipnodes(
	mod: model_t,
	fileofs: number,
	filelen: number
): void {
	if (!mod_base) return;

	const view = new DataView(mod_base.buffer, fileofs, filelen);
	const count = Math.floor(filelen / 8); // dclipnode_t is 8 bytes

	mod.clipnodes = [];
	mod.numclipnodes = count;

	// Create hull structures
	mod.hulls = [];
	for (let i = 0; i < MAX_MAP_HULLS; i++) {
		mod.hulls.push(new hull_t());
	}

	// Hull 1 (player standing)
	mod.hulls[1].clipnodes = mod.clipnodes;
	mod.hulls[1].planes = mod.planes;
	mod.hulls[1].clip_mins[0] = -16;
	mod.hulls[1].clip_mins[1] = -16;
	mod.hulls[1].clip_mins[2] = -24;
	mod.hulls[1].clip_maxs[0] = 16;
	mod.hulls[1].clip_maxs[1] = 16;
	mod.hulls[1].clip_maxs[2] = 32;

	// Hull 2 (player crouching / shamblers)
	mod.hulls[2].clipnodes = mod.clipnodes;
	mod.hulls[2].planes = mod.planes;
	mod.hulls[2].clip_mins[0] = -32;
	mod.hulls[2].clip_mins[1] = -32;
	mod.hulls[2].clip_mins[2] = -24;
	mod.hulls[2].clip_maxs[0] = 32;
	mod.hulls[2].clip_maxs[1] = 32;
	mod.hulls[2].clip_maxs[2] = 64;

	for (let i = 0; i < count; i++) {
		const clipnode = new mclipnode_t();
		const offset = i * 8;

		clipnode.planenum = view.getInt32(offset + 0, true);
		clipnode.children[0] = view.getInt16(offset + 4, true);
		clipnode.children[1] = view.getInt16(offset + 6, true);

		mod.clipnodes.push(clipnode);
	}
}

/**
 * Load entity string
 */
function Mod_LoadEntities(
	mod: model_t,
	fileofs: number,
	filelen: number
): void {
	if (!mod_base) return;

	if (filelen === 0) {
		mod.entities = '';
		return;
	}

	// Convert to string
	let str = '';
	for (let i = 0; i < filelen - 1; i++) {
		// -1 to skip null terminator
		str += String.fromCharCode(mod_base[fileofs + i]);
	}
	mod.entities = str;
}

/**
 * Load submodels
 */
function Mod_LoadSubmodels(
	mod: model_t,
	fileofs: number,
	filelen: number
): void {
	if (!mod_base) return;

	const view = new DataView(mod_base.buffer, fileofs, filelen);
	const count = Math.floor(filelen / 64); // dmodel_t is 64 bytes

	mod.submodels = [];
	mod.numsubmodels = count;

	for (let i = 0; i < count; i++) {
		const submodel = new dmodel_t();
		const offset = i * 64;

		// Bounding box
		submodel.mins[0] = view.getFloat32(offset + 0, true);
		submodel.mins[1] = view.getFloat32(offset + 4, true);
		submodel.mins[2] = view.getFloat32(offset + 8, true);
		submodel.maxs[0] = view.getFloat32(offset + 12, true);
		submodel.maxs[1] = view.getFloat32(offset + 16, true);
		submodel.maxs[2] = view.getFloat32(offset + 20, true);

		// Origin
		submodel.origin[0] = view.getFloat32(offset + 24, true);
		submodel.origin[1] = view.getFloat32(offset + 28, true);
		submodel.origin[2] = view.getFloat32(offset + 32, true);

		// Headnodes for each hull
		for (let j = 0; j < MAX_MAP_HULLS; j++) {
			submodel.headnode[j] = view.getInt32(offset + 36 + j * 4, true);
		}

		submodel.visleafs = view.getInt32(offset + 52, true);
		submodel.firstface = view.getInt32(offset + 56, true);
		submodel.numfaces = view.getInt32(offset + 60, true);

		mod.submodels.push(submodel);
	}
}

/**
 * Create hull 0 from nodes (for point-sized collision)
 */
function Mod_MakeHull0(mod: model_t): void {
	// Hull 0 uses the BSP nodes directly (converted to clipnodes format)
	const hull = mod.hulls[0];
	hull.planes = mod.planes;
	hull.firstclipnode = 0;
	hull.lastclipnode = mod.numnodes - 1;

	// Create clipnodes from nodes
	const clipnodes: mclipnode_t[] = [];
	for (let i = 0; i < mod.numnodes; i++) {
		const node = mod.nodes[i];
		const out = new mclipnode_t();

		out.planenum = mod.planes.indexOf(node.plane!);

		for (let j = 0; j < 2; j++) {
			const child = node.children[j];
			if (!child) {
				out.children[j] = CONTENTS_SOLID;
			} else if (child.contents < 0) {
				// Leaf
				out.children[j] = child.contents;
			} else {
				// Node
				out.children[j] = mod.nodes.indexOf(child as mnode_t);
			}
		}

		clipnodes.push(out);
	}

	hull.clipnodes = clipnodes;
}

// Export for use by physics code
export { CONTENTS_EMPTY, CONTENTS_SOLID, CONTENTS_WATER };
export { CONTENTS_SLIME, CONTENTS_LAVA, CONTENTS_SKY };
export { mod_brush, mod_sprite, mod_alias };
