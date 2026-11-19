// Binary city tile: the compiler writes it, the client reads it. One format, one file.
//
// All numbers little-endian. Coordinates are world metres (see geo.js), stored as f32.
//
//   header   u32 magic 'TKY1' | u16 version | u16 reserved | i32 tx | i32 tz
//            | u32 nBuildings | u32 nAreas | u32 nProps | u32 nWires | u32 nWalls | u32 nSigns
//   building u16 usage | u8 storeys | u8 flags | f32 base | f32 height | f32 measuredHeight | u32 hint | polygons
//            (hint, from OSM tags: bits 0-23 wall colour 0xRRGGBB if bit 31 is set; bits 24-27 material, see MATERIAL)
//            | u16 nSurfaces | per surface: u8 roof (1) or wall (0) | u8 nRings | per ring: u16 nPts | nPts * (f32 x, y, z)
//            (the LOD2 shell where PLATEAU has one: real walls and roof planes; empty otherwise)
//   area     u8 kind | u8 reserved | u16 code | polygons
//   prop     u8 kind | u8 variant | u16 rotation (0..65535 = 0..2 pi, about +y) | f32 x | f32 z | f32 scale
//   wire     f32 x1 | f32 z1 | f32 x2 | f32 z2        (a span between two utility poles)
//   wall     f32 x1 | f32 z1 | f32 x2 | f32 z2 | f32 deck   (a parapet along the edge of bridge deck `deck`;
//            deck < 0: a barrier of type -deck on the ground, see BARRIER)
//   sign     u8 style | u8 colour | u16 reserved | f32 x | f32 y | f32 z | f32 nx | f32 nz | f32 w | f32 h
//            | u16 byte length | UTF-8 text       (x, y, z: centre; nx, nz: outward normal of the wall)
//   polygons u16 nPolys | per polygon: u16 nRings | per ring: u32 nPts | nPts * (f32 x, f32 z)
//
// The first ring of a polygon is its outline (counter-clockwise seen from above), the others holes
// (clockwise). Rings are open: the last point does not repeat the first.

export const MAGIC = 0x31594b54; // 'TKY1'
export const VERSION = 7;

// Wall material from OSM's building:material, in a building's hint (0 = not mapped).
export const MATERIAL = { NONE: 0, TILE: 1, CONCRETE: 2, PLASTER: 3, BRICK: 4, METAL: 5, GLASS: 6 };

export const BFLAG = { LOD2: 1, NO_SOLID: 2, LATTICE: 4 }; // LATTICE: a steel lattice tower (OSM tower:construction)

// Ground surface kinds. For roads, `code` keeps the PLATEAU function code for finer styling later.
export const AREA = { ROAD: 0, CARRIAGEWAY: 1, SIDEWALK: 2, ISLAND: 3, OTHER: 4, PARK: 5, WOOD: 6, WATER: 7, PITCH: 8, MARK_WHITE: 9, MARK_YELLOW: 10,
  // footpaths (code 1: unpaved), outdoor stairs, car parks, tactile paving, swimming pools, pedestrian plazas
  PATH: 11, STEPS: 12, PARKING: 13, TACTILE: 14, POOL: 15, PLAZA: 16,
};
// PITCH areas carry the sport in `code`.
export const SPORT = { OTHER: 0, TENNIS: 1, TURF: 2, DIRT: 3 };
// Barriers travel in the wall list with a negative type instead of a deck index.
export const BARRIER = { FENCE: 2, WALL: 3, RETAINING: 4, HEDGE: 5, GUARD_RAIL: 6 };

// Point objects placed by the compiler; the client instances a model per kind.
export const PROP = {
  TREE: 0, POLE: 1, LIGHT: 2, VENDING: 3, SIGNAL: 4, DECAL: 5,
  // mapped street furniture (tools/pipeline/furniture.mjs)
  BUS_STOP: 6, BENCH: 7, BOLLARD: 8, POST_BOX: 9, PHONE: 10, SUBWAY: 11, STATUE: 12, BIKES: 13, SHRINE: 14,
  // tools/pipeline/extras.mjs. PARKED: variant = vehicle type + 4 * colour.
  PARKED: 15, HYDRANT: 16, INFO: 17, TABLE: 18, PLAY: 19, TORII: 20, RAIL_CROSSING: 21,
};

// Painted symbols on the road (PROP.DECAL variants). `rot` is the direction of travel that reads them.
export const DECAL = {
  THROUGH: 0, LEFT: 1, RIGHT: 2, THROUGH_LEFT: 3, THROUGH_RIGHT: 4,
  STOP: 5,                                              // 止まれ
  SPEED_20: 6, SPEED_30: 7, SPEED_40: 8, SPEED_50: 9, SPEED_60: 10,
};

class Writer {
  constructor(size = 1 << 16) { this.buf = new ArrayBuffer(size); this.dv = new DataView(this.buf); this.o = 0; }
  need(n) {
    if (this.o + n <= this.buf.byteLength) return;
    let size = this.buf.byteLength * 2;
    while (size < this.o + n) size *= 2;
    const next = new ArrayBuffer(size);
    new Uint8Array(next).set(new Uint8Array(this.buf, 0, this.o));
    this.buf = next; this.dv = new DataView(next);
  }
  u8(v) { this.need(1); this.dv.setUint8(this.o, v); this.o += 1; }
  u16(v) { this.need(2); this.dv.setUint16(this.o, v, true); this.o += 2; }
  u32(v) { this.need(4); this.dv.setUint32(this.o, v, true); this.o += 4; }
  i32(v) { this.need(4); this.dv.setInt32(this.o, v, true); this.o += 4; }
  f32(v) { this.need(4); this.dv.setFloat32(this.o, v, true); this.o += 4; }
  str(s) { const b = new TextEncoder().encode(s); this.u16(b.length); this.need(b.length); new Uint8Array(this.buf, this.o, b.length).set(b); this.o += b.length; }
  polygons(polys) {
    this.u16(polys.length);
    for (const rings of polys) {
      this.u16(rings.length);
      for (const ring of rings) {
        this.u32(ring.length);
        for (const [x, z] of ring) { this.f32(x); this.f32(z); }
      }
    }
  }
  bytes() { return new Uint8Array(this.buf, 0, this.o); }
}

const clampInt = (v, max) => Math.max(0, Math.min(max, Math.round(v || 0)));

export function encodeTile({ tx, tz, buildings, areas, props = [], wires = [], walls = [], signs = [] }) {
  const w = new Writer();
  w.u32(MAGIC); w.u16(VERSION); w.u16(0);
  w.i32(tx); w.i32(tz);
  w.u32(buildings.length); w.u32(areas.length); w.u32(props.length); w.u32(wires.length); w.u32(walls.length); w.u32(signs.length);
  for (const b of buildings) {
    w.u16(clampInt(b.usage, 65535)); w.u8(clampInt(b.storeys, 255)); w.u8(b.flags || 0);
    w.f32(b.base); w.f32(b.height); w.f32(b.measuredHeight ?? -1); w.u32((b.hint ?? 0) >>> 0);
    w.polygons(b.polygons);
    const surfaces = b.surfaces ?? [];
    w.u16(surfaces.length);
    for (const s of surfaces) {
      // s.uv: per ring, [u, v, ...] in the tile's roof photo atlas (0..1), where the surface has a photo
      w.u8((s.roof ? 1 : 0) | (s.uv ? 2 : 0)); w.u8(s.rings.length);
      s.rings.forEach((ring, r) => {
        w.u16(ring.length);
        for (const [x, y, z] of ring) { w.f32(x); w.f32(y); w.f32(z); }
        if (s.uv) for (const c of s.uv[r]) w.u16(clampInt(c * 65535, 65535));
      });
    }
  }
  for (const a of areas) {
    w.u8(a.kind); w.u8(0); w.u16(clampInt(a.code, 65535));
    w.polygons(a.polygons);
  }
  const TAU = Math.PI * 2;
  for (const p of props) {
    w.u8(p.kind); w.u8(p.variant || 0);
    w.u16(Math.round(((((p.rot || 0) % TAU) + TAU) % TAU) / TAU * 65535));
    w.f32(p.x); w.f32(p.z); w.f32(p.scale ?? 1);
  }
  for (const [x1, z1, x2, z2] of wires) { w.f32(x1); w.f32(z1); w.f32(x2); w.f32(z2); }
  for (const wall of walls) for (const v of wall) w.f32(v);
  for (const s of signs) {
    w.u8(s.style); w.u8(s.color); w.u16(0);
    for (const v of [s.x, s.y, s.z, s.nx, s.nz, s.w, s.h]) w.f32(v);
    w.str(s.text);
  }
  return w.bytes();
}

// Decodes into plain objects with rings as Float32Array [x0, z0, x1, z1, ...] (zero-copy friendly for meshing).
export function decodeTile(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  let o = 0;
  const u8 = () => dv.getUint8(o++);
  const u16 = () => { const v = dv.getUint16(o, true); o += 2; return v; };
  const u32 = () => { const v = dv.getUint32(o, true); o += 4; return v; };
  const i32 = () => { const v = dv.getInt32(o, true); o += 4; return v; };
  const f32 = () => { const v = dv.getFloat32(o, true); o += 4; return v; };
  const polygons = () => {
    const polys = new Array(u16());
    for (let p = 0; p < polys.length; p++) {
      const rings = new Array(u16());
      for (let r = 0; r < rings.length; r++) {
        const n = u32(), ring = new Float32Array(n * 2);
        for (let i = 0; i < n * 2; i++) ring[i] = f32();
        rings[r] = ring;
      }
      polys[p] = rings;
    }
    return polys;
  };

  if (u32() !== MAGIC) throw new Error('not a TKY1 tile');
  const version = u16(); u16();
  if (version !== VERSION) throw new Error(`tile version ${version}, expected ${VERSION}`);
  const tx = i32(), tz = i32(), nB = u32(), nA = u32(), nP = u32(), nW = u32(), nWalls = u32(), nSigns = u32();
  const buildings = new Array(nB);
  for (let i = 0; i < nB; i++) {
    const usage = u16(), storeys = u8(), flags = u8();
    const base = f32(), height = f32(), measuredHeight = f32(), hint = u32();
    const b = { usage, storeys, flags, base, height, measuredHeight, hint, polygons: polygons(), surfaces: new Array(u16()) };
    for (let s = 0; s < b.surfaces.length; s++) {
      const bits = u8(), roof = (bits & 1) === 1, rings = new Array(u8()), uv = bits & 2 ? new Array(rings.length) : null;
      for (let r = 0; r < rings.length; r++) {
        const n = u16(), ring = new Float32Array(n * 3);
        for (let k = 0; k < n * 3; k++) ring[k] = f32();
        rings[r] = ring;
        if (uv) { uv[r] = new Float32Array(n * 2); for (let k = 0; k < n * 2; k++) uv[r][k] = u16() / 65535; }
      }
      b.surfaces[s] = { roof, rings, uv };
    }
    buildings[i] = b;
  }
  const areas = new Array(nA);
  for (let i = 0; i < nA; i++) {
    const kind = u8(); u8(); const code = u16();
    areas[i] = { kind, code, polygons: polygons() };
  }
  const props = new Array(nP);
  for (let i = 0; i < nP; i++) {
    const kind = u8(), variant = u8(), rot = (u16() / 65535) * Math.PI * 2;
    props[i] = { kind, variant, rot, x: f32(), z: f32(), scale: f32() };
  }
  const wires = new Float32Array(nW * 4);
  for (let i = 0; i < nW * 4; i++) wires[i] = f32();
  const walls = new Float32Array(nWalls * 5);
  for (let i = 0; i < nWalls * 5; i++) walls[i] = f32();
  const signs = new Array(nSigns), utf8 = new TextDecoder();
  for (let i = 0; i < nSigns; i++) {
    const style = u8(), color = u8(); u16();
    const s = { style, color, x: f32(), y: f32(), z: f32(), nx: f32(), nz: f32(), w: f32(), h: f32() };
    const n = u16();
    s.text = utf8.decode(new Uint8Array(arrayBuffer, o, n)); o += n;
    signs[i] = s;
  }
  return { tx, tz, buildings, areas, props, wires, walls, signs };
}
