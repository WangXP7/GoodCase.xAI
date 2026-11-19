// The whole map as data: four zones in a ring, the doors between them, windows, stairs,
// the perimeter and its breaches, spawn points, and the fixed positions of everything the game
// systems place (searchables, wall buys, machines, box spots, the bench, the power switch).
// Pure: no three.js, no DOM. +x east, +z south, y up, metres; yaw 0 looks north (-z), +yaw turns
// left (west). The forecourt keeps its own detailed layout in layout.js; this file adds the rest
// and the structure (`structure`: every wall, floor, roof, stair and rail of the new buildings as
// boxes) that the greybox draws and the area art dresses.
//
//          x=-23        x=7            x=26.6                          x=60     x=66
//  z=-44                               +------ motel north wing --------+------+
//                                      | office   N1/N3     N2/N4       |  E   |
//  z=-38                    +----------+=========== walkway ============+  wing|
//  z=-32    store   +-------+ diner (rear windows)   |                  |  E1  |
//                   | dining  counter | kitchen  d2>  |  motel lot       |  E2  |
//  z=-20  ======+===+=======d1========+---+----------+                  +--+---+
//               | forecourt           |B1 |                          stair | yard (fence, climbs)
//  z=-11.5      |                  alley==d5==>                           |
//               |                     |B2 |=========== containers ==d3===+=====+
//  z=-2         |                     +---+  scrapyard (stacks)   | bays (power, bench) |
//  z=10.1       |                   d4 gate                       |   roller doors      |
//  z=20.3  =====+==drive====drive=====+---- south fence (climbs) ---+------------------+  z=23.5
import { world as T } from '../game/tuning/world.js';
import * as F from './layout.js';

const UP = T.floors.upper; // 3.04: the motel's upper floor
const RISE = T.floors.rise, TREAD = T.floors.tread;
const SLAB = 0.2; // floor slab thickness under the upper floor
const WALL = 0.3;

export const WORLD = { x0: -23, x1: 67, z0: -45, z1: 25 };
// collision and navigation cover the world and a margin round it (the spawn points stand outside)
export const bounds = { min: [-34, -2, -52], max: [74, 16, 34] };

// ---- zones --------------------------------------------------------------------------------------
// rects split at the middle of each doorway, so a body is in one zone or the other, never neither.
// reverb names the audio engine knows: open, canopy, diner, kitchen, motelRoom, walkway, garage, scrapyard.
export const zones = {
  forecourt: {
    floor: 'asphalt', reverb: 'open',
    rects: [
      { x0: -22.3, z0: -20.15, x1: 22.3, z1: 20.3 }, // the lot, pavement to south fence
      { x0: -22.3, z0: -30, x1: -15, z1: -20.15 }, // the alley behind the store's west end
      { x0: -14.5, z0: 20.3, x1: -6.5, z1: 25.4 }, { x0: 4.5, z0: 20.3, x1: 12.5, z1: 25.4 }, // the drives up to the barriers
      { x0: 22.3, z0: -12.75, x1: 26.6, z1: -10.25 }, // the service alley, up to its gate (d5)
    ],
    playable: { min: [F.FENCE.w, 0, -20], max: [F.FENCE.e, 6, F.FENCE.s] },
  },
  diner: {
    floor: 'tile', reverb: 'diner',
    rects: [{ x0: 7, z0: -32, x1: 26.45, z1: -20.15 }],
    playable: { min: [7.3, 0, -31.7], max: [26.3, 4, -20.3] },
  },
  motel: {
    floor: 'asphalt', reverb: 'open',
    rects: [
      { x0: 26.45, z0: -38, x1: 60, z1: -2 }, // the lot
      { x0: 60, z0: -17, x1: 66, z1: -2 }, // the yard by the back fence
      { x0: 26.45, z0: -44, x1: 60, z1: -38 }, { x0: 60, z0: -44, x1: 66, z1: -17 }, // the wings (rooms, both floors)
    ],
    playable: { min: [26.6, 0, -44], max: [66, 7, -2] },
  },
  garage: {
    floor: 'concrete', reverb: 'scrapyard',
    rects: [{ x0: 22.3, z0: -2, x1: 66, z1: 23.5 }],
    playable: { min: [22.3, 0, -2], max: [66, 7, 23.5] },
  },
};
export const ZONE_NAMES = Object.keys(zones);

export function zoneAt(x, z) {
  for (const name of ZONE_NAMES) for (const r of zones[name].rects) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return name;
  return null;
}

// ---- doors --------------------------------------------------------------------------------------
// rect: the opening the barrier fills (x0, z0, x1, z1 and its height h); look: what the
// buildBarrier draws there. Costs live in tuning.world.doors.
export const doors = [
  { id: 'd1', a: 'forecourt', b: 'diner', pos: [12.2, 1.2, -20.15], rect: { x0: 11.05, z0: -20.3, x1: 13.35, z1: -20.0 }, h: 2.65, look: 'boarded', label: 'Diner' },
  { id: 'd2', a: 'diner', b: 'motel', pos: [26.45, 1.2, -27.25], rect: { x0: 26.3, z0: -27.85, x1: 26.6, z1: -26.65 }, h: 2.2, look: 'boarded', label: 'Back door' },
  { id: 'd3', a: 'motel', b: 'garage', pos: [44, 1.2, -2], rect: { x0: 42.5, z0: -2.15, x1: 45.5, z1: -1.85 }, h: 3.2, look: 'sheet', label: 'Yard gate' },
  { id: 'd4', a: 'garage', b: 'forecourt', pos: [22.3, 1.2, 10.1], rect: { x0: 22.22, z0: 8.9, x1: 22.38, z1: 11.3 }, h: 2.4, look: 'sheet', label: 'Scrapyard gate' },
  { id: 'd5', a: 'forecourt', b: 'motel', pos: [26.6, 1.2, -11.5], rect: { x0: 26.45, z0: -12.75, x1: 26.75, z1: -10.25 }, h: 3.0, look: 'roller', label: 'Alley gate' },
].map((d) => ({ ...d, cost: T.doors[d.id] }));

// Zone pairs that see each other across their boundary whatever the doors: the forecourt's east
// fence is chain-link, so the scrapyard's lamp, stacks and cars show through it (createWorldState
// draws the one whenever the player is in, or looks through an open door into, the other).
export const seeThrough = [['forecourt', 'garage']];

// ---- windows (boarded; zombies tear in, the player rebuilds) -----------------------------------
// pos: centre of the opening; normal: outward; w, sill, head: the opening.
export const windows = [
  ...[10.5, 14.5, 18.0, 23.3].map((x, i) => ({ id: `w-d${i + 1}`, zone: 'diner', pos: [x, 1.55, -31.85], normal: [0, 0, -1], w: 1.4, sill: 0.9, head: 2.2 })),
  ...[41.5, 51.5].map((x, i) => ({ id: `w-m${i + 1}`, zone: 'motel', pos: [x, 1.45, -43.85], normal: [0, 0, -1], w: 1.2, sill: 0.9, head: 2.0 })),
].map((w) => ({ ...w, max: T.boards.max }));

// Openings a body walks through are 1.2 m wide and centred on a nav cell (centres at .25 and .75):
// with the 0.35 m clearance a narrower one would be shut to the zombies' grid.

// ---- stairs -------------------------------------------------------------------------------------
// foot: centre of the first riser; dir: uphill (axis-aligned); 16 steps, the last a landing.
export const stairs = [
  { id: 's-west', zone: 'motel', foot: [37.5, -35.7], dir: [-1, 0], width: 1.4, steps: 16, rise: RISE, tread: TREAD, landing: 1.2 },
  { id: 's-east', zone: 'motel', foot: [59.2, -11.3], dir: [0, -1], width: 1.6, steps: 16, rise: RISE, tread: TREAD, landing: 1.2 },
];
// the boxes of one stair, step by step (solid from the ground: nothing walks under them)
export function stairSteps(s) {
  const out = [];
  const [ux, uz] = s.dir, half = s.width / 2;
  for (let k = 0; k < s.steps; k++) {
    const a = k * s.tread, b = k < s.steps - 1 ? a + s.tread : a + s.landing;
    const ax = s.foot[0] + ux * a, az = s.foot[1] + uz * a, bx = s.foot[0] + ux * b, bz = s.foot[1] + uz * b;
    const x0 = Math.min(ax, bx) - (ux === 0 ? half : 0), x1 = Math.max(ax, bx) + (ux === 0 ? half : 0);
    const z0 = Math.min(az, bz) - (uz === 0 ? half : 0), z1 = Math.max(az, bz) + (uz === 0 ? half : 0);
    out.push({ k, min: [x0, 0, z0], max: [x1, (k + 1) * s.rise, z1], top: (k + 1) * s.rise, a, b });
  }
  return out;
}

// ---- the structure: every wall, floor, roof, rail and stair of the new buildings ----------------
// { min, max, zone, kind: 'wall'|'floor'|'roof'|'solid'|'rail'|'post'|'stair'|'block'|'table', surface }
// The greybox draws each as plain concrete with a matching collider; an area's art builder may draw
// them itself instead (they are where they are: do not move them, ask).
export const structure = [];
const S = (zone, kind, x0, y0, z0, x1, y1, z1, extra) => structure.push({ zone, kind, min: [x0, y0, z0], max: [x1, y1, z1], surface: 'concrete', ...extra });
// A wall along x (axis 'x': spans x0..x1 at z0..z1) or along z, from y0 to y1, with holes
// [{ a, b, y0, y1 }] cut along its length.
function wall(zone, axis, a0, a1, c0, c1, y0, y1, holes = [], kind = 'wall', extra) {
  const put = (p, q, ya, yb) => {
    if (q - p < 1e-3 || yb - ya < 1e-3) return;
    if (axis === 'x') S(zone, kind, p, ya, c0, q, yb, c1, extra); else S(zone, kind, c0, ya, p, c1, yb, q, extra);
  };
  const hs = holes.slice().sort((h, g) => h.a - g.a);
  let at = a0;
  for (const h of hs) {
    put(at, h.a, y0, y1);
    put(h.a, h.b, y0, Math.max(y0, h.y0)); // below the hole
    put(h.a, h.b, Math.min(y1, h.y1), y1); // above it
    at = h.b;
  }
  put(at, a1, y0, y1);
}

// -- diner: x 7..26.6, z -32..-20.3. The front wall is the forecourt's facade (store.js), cut for d1
// in forecourt.js; the kitchen's stretch of it east of the facade is here.
const DH = 3.9; // diner wall height (the facade's)
const DIN = { x0: 7, x1: 26.6, zb: -32, zf: -20.3, div: 20 };
wall('diner', 'x', DIN.x0, DIN.x1, DIN.zb, DIN.zb + WALL, 0, DH, windows.filter((w) => w.zone === 'diner').map((w) => ({ a: w.pos[0] - w.w / 2, b: w.pos[0] + w.w / 2, y0: w.sill, y1: w.head })));
wall('diner', 'z', DIN.zb + WALL, DIN.zf, DIN.x0, DIN.x0 + WALL, 0, DH); // west, against the store
wall('diner', 'z', DIN.zb + WALL, DIN.zf, DIN.x1 - WALL, DIN.x1, 0, DH, [{ a: -27.85, b: -26.65, y0: 0, y1: 2.2 }]); // east, with d2
wall('diner', 'x', 24, DIN.x1, DIN.zf, DIN.zf + WALL, 0, DH); // kitchen front, beyond the facade
wall('diner', 'z', DIN.zb + WALL, DIN.zf, DIN.div, DIN.div + 0.3, 0, DH, [{ a: -24.85, b: -23.65, y0: 0, y1: 2.2 }], 'wall'); // dining | kitchen, with a door
// ceiling where the facade's roof slab (x 7.05..23.95, z -29.9..-20.3 at 3.55..3.85) does not reach
S('diner', 'roof', 23.95, 3.55, DIN.zb, DIN.x1, 3.85, DIN.zf, { shelter: true });
S('diner', 'roof', DIN.x0, 3.55, DIN.zb, 23.95, 3.85, -29.9, { shelter: true });
S('diner', 'table', 11.5, 0, -27.0, 16.5, 1.05, -25.8); // the counter, with room to circle it
S('diner', 'table', 21.6, 0, -25.6, 24.4, 0.95, -24.6); // kitchen prep table

// -- the two blocks between the forecourt's east fence and the motel, either side of the alley
S('forecourt', 'block', 22.6, 0, -20.0, 26.6, 5.0, -12.75); // cold store behind the diner's kitchen
S('forecourt', 'block', 22.6, 0, -10.25, 26.6, 5.0, -2.0); // tyre shed
S('forecourt', 'roof', 22.6, 5.0, -20.0, 26.6, 5.2, -2.0, { shelter: true }); // their shared parapet roof
// the alley's gateway frame above d5 (the roller box)
S('motel', 'wall', 26.45, 3.0, -12.75, 26.75, 5.0, -10.25);

// -- motel wings (two floors). Rooms are hollow; every other stretch of a wing is solid.
const NW = { a0: 26.6, a1: 60, back: -44, front: -38 }; // north wing, along x
const EW = { a0: -44, a1: -17, back: 66, front: 60 }; // east wing, along z
export const rooms = [
  { id: 'office', wing: 'n', floor: 0, a0: 26.9, a1: 31.6, door: [30.15, 31.35] },
  { id: 'n1', wing: 'n', floor: 0, a0: 39, a1: 44, door: [40.15, 41.35], window: 'w-m1' },
  { id: 'n2', wing: 'n', floor: 0, a0: 49, a1: 54, door: [50.15, 51.35], window: 'w-m2' },
  { id: 'n3', wing: 'n', floor: 1, a0: 39, a1: 44, door: [40.15, 41.35] },
  { id: 'n4', wing: 'n', floor: 1, a0: 49, a1: 54, door: [50.15, 51.35] },
  { id: 'e1', wing: 'e', floor: 0, a0: -31, a1: -26, door: [-28.85, -27.65] },
  { id: 'e2', wing: 'e', floor: 0, a0: -24, a1: -19, door: [-21.85, -20.65] },
  { id: 'e3', wing: 'e', floor: 1, a0: -31, a1: -26, door: [-28.85, -27.65] },
  { id: 'e4', wing: 'e', floor: 1, a0: -24, a1: -19, door: [-21.85, -20.65] },
];
const ROOF = 6.3;
function buildWing(W, axis, wingId) {
  const sgn = Math.sign(W.front - W.back); // across: from the back toward the front
  const backIn = W.back + sgn * WALL, frontIn = W.front - sgn * WALL;
  const lo = (a, b) => Math.min(a, b), hi = (a, b) => Math.max(a, b);
  const box = (a0, a1, c0, c1, y0, y1, kind, extra) => (axis === 'x'
    ? S('motel', kind, a0, y0, lo(c0, c1), a1, y1, hi(c0, c1), extra)
    : S('motel', kind, lo(c0, c1), y0, a0, hi(c0, c1), y1, a1, extra));
  for (const floor of [0, 1]) {
    const y0 = floor ? UP : 0, y1 = floor ? ROOF : UP;
    const rs = rooms.filter((r) => r.wing === wingId && r.floor === floor).sort((r, q) => r.a0 - q.a0);
    let at = W.a0;
    for (const r of rs) {
      if (r.a0 > at) box(at, r.a0, W.back, W.front, y0, y1, 'solid');
      // back wall (a window in a ground-floor room on the perimeter), front wall with the door
      const win = r.window ? windows.find((w) => w.id === r.window) : null;
      const along = axis === 'x' ? 0 : 2;
      const holesB = win ? [{ a: win.pos[along] - win.w / 2, b: win.pos[along] + win.w / 2, y0: y0 + win.sill, y1: y0 + win.head }] : [];
      wall('motel', axis, r.a0, r.a1, lo(W.back, backIn), hi(W.back, backIn), y0, y1 - (floor ? 0.3 : SLAB), holesB);
      wall('motel', axis, r.a0, r.a1, lo(frontIn, W.front), hi(frontIn, W.front), y0, y1 - (floor ? 0.3 : SLAB), [{ a: r.door[0], b: r.door[1], y0, y1: y0 + 2.1 }]);
      // the room's ceiling: the upper floor's slab, or the roof
      box(r.a0, r.a1, W.back, W.front, y1 - (floor ? 0.3 : SLAB), y1, floor ? 'roof' : 'floor', { shelter: true });
      at = r.a1;
    }
    if (at < W.a1) box(at, W.a1, W.back, W.front, y0, y1, 'solid');
  }
}
buildWing(NW, 'x', 'n');
buildWing(EW, 'z', 'e');
for (const s of structure) if (s.kind === 'solid' && s.max[1] >= ROOF - 1e-6) s.shelter = true;

// walkway: along the north wing's front (z -38..-36.4) and the east wing's (x 58.4..60), down the
// east stair's landing; a rail on the lot side, open where the west stair's landing meets it.
export const walkway = [
  { x0: 26.6, z0: -38, x1: 60, z1: -36.4 },
  { x0: 58.4, z0: -38, x1: 60, z1: -17 },
];
for (const w of walkway) S('motel', 'floor', w.x0, UP - SLAB, w.z0, w.x1, UP, w.z1);
const RAIL = 1.2; // above the floor: higher than a jump reaches (0.77 m + the 0.32 m step)
S('motel', 'rail', 26.6, UP, -38, 26.7, UP + RAIL, -36.4); // west end
S('motel', 'rail', 26.6, UP, -36.5, 31.8, UP + RAIL, -36.4);
S('motel', 'rail', 33.0, UP, -36.5, 58.5, UP + RAIL, -36.4);
S('motel', 'rail', 58.4, UP, -36.4, 58.5, UP + RAIL, -17);
// posts under the walkway's lot edge (clear of the west stair and its landing)
for (const x of [27.2, 31.0, 38.6, 42.6, 46.6, 50.6, 54.6, 58.45]) S('motel', 'post', x - 0.1, 0, -36.6, x + 0.1, UP - SLAB, -36.4);
for (const z of [-32.4, -28.4, -24.4, -20.4, -17.2]) S('motel', 'post', 58.4, 0, z - 0.1, 58.6, UP - SLAB, z + 0.1);
// stairs: the steps, and a rail on each open side and the landing's open end
for (const s of stairs) {
  for (const st of stairSteps(s)) {
    structure.push({ zone: 'motel', kind: 'stair', min: st.min, max: st.max, surface: 'concrete', stair: s.id });
    const top = st.top + RAIL;
    if (s.id === 's-west') S('motel', 'rail', st.min[0], 0, -35.1, st.max[0], top, -35.0);
    else {
      S('motel', 'rail', 58.3, 0, st.min[2], 58.4, top, st.max[2]);
      S('motel', 'rail', 60.0, 0, st.min[2], 60.1, top, st.max[2]);
    }
  }
}
S('motel', 'rail', 31.7, 0, -36.4, 31.8, UP + RAIL, -35.0); // west landing's far end
S('motel', 'rail', 60.0, UP, -17, 60.1, UP + RAIL, -15.8); // east landing beside the yard

// boundary between the motel and the garage: two-high containers, a gateway over d3
S('motel', 'block', 26.6, 0, -3.2, 42.5, 5.2, -0.8);
S('motel', 'block', 45.5, 0, -3.2, 66, 5.2, -0.8);
S('motel', 'block', 42.5, 3.2, -3.2, 45.5, 5.2, -0.8);
// motel west boundary south of the diner: the blocks' faces close it; nothing else needed

// -- garage: bays building x 46..66, z 4..20, open to the scrapyard through three bay doors
const BAY = { x0: 46, x1: 66, z0: 4, z1: 20, h: 6.2 };
export const rollers = [
  { id: 'roller-dropped', z0: 10.0, z1: 13.6, gap: 0 }, // dropped to the floor: a wall
  { id: 'roller-half', z0: 15.3, z1: 18.9, gap: 0.6 }, // stuck 0.6 m up: they come in underneath
];
wall('garage', 'x', BAY.x0, BAY.x1, BAY.z0, BAY.z0 + WALL, 0, BAY.h); // north
wall('garage', 'x', BAY.x0, BAY.x1, BAY.z1 - WALL, BAY.z1, 0, BAY.h); // south
wall('garage', 'z', BAY.z0 + WALL, BAY.z1 - WALL, BAY.x0, BAY.x0 + WALL, 0, BAY.h, [5.0, 10.2, 15.4].map((a) => ({ a, b: a + 3.6, y0: 0, y1: 4.2 }))); // west: bay doors, up
wall('garage', 'z', BAY.z0 + WALL, BAY.z1 - WALL, BAY.x1 - WALL, BAY.x1, 0, BAY.h, rollers.filter((r) => r.gap > 0).map((r) => ({ a: r.z0, b: r.z1, y0: 0, y1: r.gap }))); // east
S('garage', 'roof', BAY.x0, BAY.h, BAY.z0, BAY.x1, BAY.h + 0.3, BAY.z1, { shelter: true });
// office in the corner of bay 1 (the power switch is on its north wall), bay partitions
wall('garage', 'z', BAY.z0 + WALL, 8.5, 61, 61.2, 0, 3.0, [{ a: 5.65, b: 6.85, y0: 0, y1: 2.1 }]);
S('garage', 'wall', 61, 0, 8.5, BAY.x1 - WALL, 3.0, 8.7);
S('garage', 'roof', 61, 3.0, BAY.z0 + WALL, BAY.x1 - WALL, 3.1, 8.7);
S('garage', 'wall', 58.5, 0, 14.5, BAY.x1 - WALL, 2.4, 14.7); // between bays 2 and 3 (half depth)
// scrapyard: stacks of crushed cars, lanes between them
export const stacks = [
  { x0: 25.5, z0: 2.5, x1: 35, z1: 4.5, h: 2.8 }, { x0: 38, z0: 2.5, x1: 44, z1: 4.5, h: 4.2 },
  { x0: 25.5, z0: 6.5, x1: 31, z1: 8.5, h: 2.8 }, { x0: 34, z0: 6.5, x1: 44, z1: 8.5, h: 1.4 },
  { x0: 25.5, z0: 12.5, x1: 34, z1: 14.5, h: 4.2 }, { x0: 37, z0: 12.5, x1: 44, z1: 14.5, h: 2.8 },
  { x0: 27, z0: 17.5, x1: 40, z1: 19.5, h: 2.8 },
];
for (const s of stacks) S('garage', 'stack', s.x0, 0, s.z0, s.x1, s.h, s.z1, { surface: 'metal' });

// ---- the upper floor, for navigation: the walkway, the landings, the upper rooms ---------------
export const upperFloors = [
  ...walkway,
  ...rooms.filter((r) => r.floor === 1).map((r) => (r.wing === 'n'
    ? { x0: r.a0, z0: NW.back + WALL, x1: r.a1, z1: NW.front }
    : { x0: EW.front, z0: r.a0, x1: EW.back - WALL, z1: r.a1 })),
];

// ---- perimeter ----------------------------------------------------------------------------------
// A closed loop round the four zones. barrier: fenceChained | jersey | wreck | embankment |
// thicket | wall | roller. A segment with `breach` is where that spawn point's zombies come in.
const seg = [];
let segN = 0;
// run of segments along a straight line from p to q, cut where breaches sit: cuts [{ at (0..len), w, breach }]
function run(zone, barrier, p, q, cuts = []) {
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const ux = (q[0] - p[0]) / len, uz = (q[1] - p[1]) / len;
  const pt = (d) => [+(p[0] + ux * d).toFixed(4), +(p[1] + uz * d).toFixed(4)];
  let at = 0;
  for (const c of cuts.slice().sort((a, b) => a.at - b.at)) {
    const a = c.at - c.w / 2, b = c.at + c.w / 2;
    if (a > at + 1e-6) seg.push({ id: `p${++segN}`, zone, from: pt(at), to: pt(a), barrier });
    seg.push({ id: `p${++segN}`, zone, from: pt(a), to: pt(b), barrier: c.barrier || barrier, breach: c.breach });
    at = b;
  }
  if (len > at + 1e-6) seg.push({ id: `p${++segN}`, zone, from: pt(at), to: pt(len), barrier });
}
const Fw = F.FENCE.w, Fs = F.FENCE.s;
const DRV = F.DRIVES.map(([x0, x1]) => [x0 - 0.5, x1 + 0.5]); // the drives' fenced sides
export const DRIVE_CLOSE_Z = 25.4; // the jersey line across each drive
export const DRIVE_GAPS = [-10.5, 8.75]; // where a 0.5 m gap is left in it
// forecourt west fence, north from the south-west corner (gaps 0.5 m: a torn panel; the sag: a climb)
run('forecourt', 'fenceChained', [Fw, Fs], [Fw, F.FENCE.alley], [
  { at: Fs - 11.5, w: 0.5, breach: 'sp-f1' }, { at: Fs - 3, w: 1.0, breach: 'sp-f2' }, { at: Fs + 12.7, w: 0.5, breach: 'sp-f3' },
]);
run('forecourt', 'fenceChained', [Fw, F.FENCE.alley], [-15, F.FENCE.alley], [{ at: -18.7 - Fw, w: 0.5, breach: 'sp-f4' }]);
run('forecourt', 'wall', [-15, -30], [7, -30]); // the store's back wall
run('diner', 'wall', [7, -30], [7, -32]);
run('diner', 'wall', [7, -32], [26.6, -32], windows.filter((w) => w.zone === 'diner').map((w) => ({ at: w.pos[0] - 7, w: w.w, breach: `sp-${w.id}` })));
run('motel', 'wreck', [26.6, -32], [26.6, -38], [{ at: 3, w: 0.5, breach: 'sp-m1' }]); // the motel's road in, jammed
run('motel', 'wall', [26.6, -38], [26.6, -44]);
run('motel', 'wall', [26.6, -44], [66, -44], windows.filter((w) => w.zone === 'motel').map((w) => ({ at: w.pos[0] - 26.6, w: w.w, breach: `sp-${w.id}` })));
run('motel', 'wall', [66, -44], [66, -17]);
export const MOTEL_GATE = { z0: -8.4, z1: -6.4 }; // padlocked gate in the back fence: the service road beyond
run('motel', 'fenceChained', [66, -17], [66, -2], [{ at: 2, w: 1, breach: 'sp-m4' }, { at: 6.5, w: 1, breach: 'sp-m5' }, { at: 13.5, w: 1, breach: 'sp-m6' }]);
run('garage', 'fenceChained', [66, -2], [66, 4], [{ at: 3, w: 0.5, breach: 'sp-g1' }]); // the east gap
run('garage', 'wall', [66, 4], [66, 20], rollers.map((r) => ({ at: r.z0 - 4 + (r.z1 - r.z0) / 2, w: r.z1 - r.z0, barrier: 'roller', breach: r.gap > 0 ? 'sp-g2' : undefined })));
run('garage', 'fenceChained', [66, 20], [66, 23.5]);
run('garage', 'fenceChained', [66, 23.5], [22.3, 23.5], [{ at: 66 - 56, w: 1, breach: 'sp-g3' }, { at: 66 - 30, w: 1, breach: 'sp-g4' }]);
run('garage', 'fenceChained', [22.3, 23.5], [22.3, Fs]);
run('forecourt', 'fenceChained', [22.3, Fs], [DRV[1][1], Fs]);
run('forecourt', 'fenceChained', [DRV[1][1], Fs], [DRV[1][1], DRIVE_CLOSE_Z]);
run('forecourt', 'jersey', [DRV[1][1], DRIVE_CLOSE_Z], [DRV[1][0], DRIVE_CLOSE_Z], [{ at: DRV[1][1] - DRIVE_GAPS[1], w: 0.5, breach: 'sp-f6' }]);
run('forecourt', 'fenceChained', [DRV[1][0], DRIVE_CLOSE_Z], [DRV[1][0], Fs]);
run('forecourt', 'fenceChained', [DRV[1][0], Fs], [DRV[0][1], Fs]);
run('forecourt', 'fenceChained', [DRV[0][1], Fs], [DRV[0][1], DRIVE_CLOSE_Z]);
run('forecourt', 'jersey', [DRV[0][1], DRIVE_CLOSE_Z], [DRV[0][0], DRIVE_CLOSE_Z], [{ at: DRV[0][1] - DRIVE_GAPS[0], w: 0.5, breach: 'sp-f5' }]);
run('forecourt', 'fenceChained', [DRV[0][0], DRIVE_CLOSE_Z], [DRV[0][0], Fs]);
run('forecourt', 'fenceChained', [DRV[0][0], Fs], [Fw, Fs]);
export const perimeter = seg;
export const polygon = perimeter.map((s) => s.from);

// point in the playable polygon (even-odd)
export function insidePolygon(x, z) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i], [xj, zj] = polygon[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// ---- spawn points: each stands outside its breach and climbs, squeezes or crawls in -------------
// kind 'fence' keeps the original climb-in (manager.js); breach says what it climbs through; top is
// the height it goes over (or under); to is where it lands inside.
const sp = (id, zone, breach, pos, to, top, extra) => ({ id, zone, kind: 'fence', breach, pos, to, top, segment: perimeter.find((s) => s.breach === id).id, ...extra });
export const spawnPoints = [
  sp('sp-f1', 'forecourt', 'panel', [Fw - 2.1, 0, 11.5], [Fw + 1.3, 0, 11.5], 0.5),
  sp('sp-f2', 'forecourt', 'rail', [Fw - 1.4, 0, 3], [Fw + 1.1, 0, 3], F.SAG.top),
  sp('sp-f3', 'forecourt', 'panel', [Fw - 2.1, 0, -12.7], [Fw + 1.3, 0, -12.7], 0.5),
  sp('sp-f4', 'forecourt', 'panel', [-18.7, 0, -32.1], [-18.7, 0, -28.6], 0.5),
  sp('sp-f5', 'forecourt', 'gap', [DRIVE_GAPS[0], 0, 27.6], [DRIVE_GAPS[0], 0, 23.9], 0.4),
  sp('sp-f6', 'forecourt', 'gap', [DRIVE_GAPS[1], 0, 27.6], [DRIVE_GAPS[1], 0, 23.9], 0.4),
  ...windows.filter((w) => w.zone === 'diner').map((w) => sp(`sp-${w.id}`, 'diner', 'window', [w.pos[0], 0, -33.9], [w.pos[0], 0, -30.5], w.sill, { window: w.id })),
  sp('sp-m1', 'motel', 'gap', [24.4, 0, -35], [28.2, 0, -35], 0.4),
  ...windows.filter((w) => w.zone === 'motel').map((w) => sp(`sp-${w.id}`, 'motel', 'window', [w.pos[0], 0, -45.9], [w.pos[0], 0, -42.4], w.sill, { window: w.id })),
  sp('sp-m4', 'motel', 'rail', [67.4, 0, -15], [64.6, 0, -15], F.SAG.top),
  sp('sp-m5', 'motel', 'rail', [67.4, 0, -10.5], [64.6, 0, -10.5], F.SAG.top),
  sp('sp-m6', 'motel', 'rail', [67.4, 0, -3.5], [64.6, 0, -3.5], F.SAG.top),
  sp('sp-g1', 'garage', 'gap', [68.0, 0, 1], [64.3, 0, 1], 0.4),
  sp('sp-g2', 'garage', 'roller', [68.0, 0, 17.1], [64.2, 0, 17.1], 0.6),
  sp('sp-g3', 'garage', 'rail', [56, 0, 24.9], [56, 0, 22.2], F.SAG.top),
  sp('sp-g4', 'garage', 'rail', [30, 0, 24.9], [30, 0, 22.2], F.SAG.top),
];

// ---- places the game systems use ----------------------------------------------------------------
export const power = { pos: [64, 1.4, 4.34], zone: 'garage' };
// machine kinds are the economy's names
export const machineSpots = [
  { id: 'jumpStart', zone: 'forecourt', pos: [-3, 0.15, -18.1], yaw: 0 },
  { id: 'secondHelping', zone: 'diner', pos: [25.75, 0, -21.6], yaw: -Math.PI / 2 },
  { id: 'shortOrder', zone: 'motel', pos: [28.0, 0, -37.55], yaw: 0 },
  { id: 'longHaul', zone: 'garage', pos: [57.5, 0, 3.55], yaw: 0 },
];
// weapon ids are this layout's names, lower-cased (the weapon table maps them to its defs)
export const wallBuys = [
  { id: 'wall-hollis12', zone: 'forecourt', weapon: 'hollis12', pos: [-12, 1.4, -19.5], yaw: 0 },
  { id: 'wall-pike45', zone: 'diner', weapon: 'pike45', pos: [7.32, 1.4, -26.0], yaw: -Math.PI / 2 },
  { id: 'wall-calder556', zone: 'motel', weapon: 'calder556', pos: [46.5, UP + 1.4, -37.98], yaw: 0 },
  { id: 'wall-brandt12', zone: 'garage', weapon: 'brandt12', pos: [52, 1.5, 3.98], yaw: 0 },
];
export const boxSpots = [
  { id: 'box-diner', zone: 'diner', pos: [9.2, 0, -30.9], yaw: Math.PI },
  { id: 'box-motel', zone: 'motel', pos: [44, 0, -20], yaw: Math.PI / 2 },
  { id: 'box-garage', zone: 'garage', pos: [55, 0, 17.2], yaw: Math.PI / 2 },
];
export const benchSpot = { id: 'bench', zone: 'garage', pos: [55, 0, 12.0], yaw: Math.PI / 2 };

// ---- searchables (46): fixed, never random ------------------------------------------------------
// pos: where the hand goes (the boot of a car, a lid, a drawer front), outside the prop's collider;
// prop: which drawn prop it is (the object builders bind setState / setSearched to it).
const boot = (v, L) => {
  const nx = Math.cos(v.yaw), nz = -Math.sin(v.yaw);
  return [+(v.x - nx * (L / 2 + 0.9)).toFixed(3), 0.9, +(v.z - nz * (L / 2 + 0.9)).toFixed(3)];
};
const CAR_L = { sedan: 4.72, hatch: 4.05, suv: 4.85, pickup: 5.5, wagon: 4.9 };
// the lorry's cab: from the trailer's centre and the fold, as forecourt.js places it
const TRAILER_KING = 12.2 / 2 - 0.95, FIFTH = -2.75;
const kx = F.LORRY.x + Math.cos(F.LORRY.yaw) * TRAILER_KING, kz = F.LORRY.z - Math.sin(F.LORRY.yaw) * TRAILER_KING;
const tyaw = F.LORRY.yaw + F.LORRY.fold;
export const cab = { x: kx - Math.cos(tyaw) * FIFTH, z: kz + Math.sin(tyaw) * FIFTH, yaw: tyaw };
const local = (o, lx, lz, y) => [+(o.x + Math.cos(o.yaw) * lx + Math.sin(o.yaw) * lz).toFixed(3), y, +(o.z - Math.sin(o.yaw) * lx + Math.cos(o.yaw) * lz).toFixed(3)];
const srch = (id, zone, kind, pos, yaw, prop) => ({ id, zone, kind, pos, yaw, prop: prop || id });
// rooms: a dresser against the back wall, or a suitcase on the floor at the foot of the bed
const roomItem = (r, i) => {
  const y = r.floor ? UP : 0;
  const mid = (r.a0 + r.a1) / 2;
  const kind = i % 2 ? 'suitcase' : 'dresser';
  if (r.wing === 'n') return srch(`s-${r.id}`, 'motel', kind, kind === 'dresser' ? [mid + 1.2, y + 0.9, NW.back + WALL + 0.62] : [mid - 1.0, y + 0.35, -40.6], 0, `${kind}:${r.id}`);
  return srch(`s-${r.id}`, 'motel', kind, kind === 'dresser' ? [EW.back - WALL - 0.62, y + 0.9, mid + 1.2] : [63.4, y + 0.35, mid - 1.0], Math.PI / 2, `${kind}:${r.id}`);
};
export const searchables = [
  // forecourt (12)
  ...F.vehicles.map((v) => srch(`s-car-${v.id}`, 'forecourt', 'car', boot(v, CAR_L[v.type]), v.yaw, `car:${v.id}`)),
  srch('s-cab', 'forecourt', 'car', local(cab, 0.1, -1.95, 1.2), cab.yaw, 'lorry:cab'),
  srch('s-icebox', 'forecourt', 'icebox', [-14.0, 1.0, -18.93], Math.PI, 'store:icebox'),
  srch('s-bin-store1', 'forecourt', 'bin', [-3.2, 1.12, -19.5], 0, 'store:bin1'),
  srch('s-bin-store2', 'forecourt', 'bin', [0.5, 1.12, -19.5], 0, 'store:bin2'),
  srch('s-drum-alley', 'forecourt', 'barrel', [-16.2, 0.97, -28.2], 0, 'clutter:drum'),
  srch('s-crate-lorry', 'forecourt', 'crate', [19.05, 0.95, 16.97], 0, 'lorry:case'),
  // diner (8)
  srch('s-crate-k1', 'diner', 'crate', [20.95, 0.7, -31.05], 0),
  srch('s-crate-k2', 'diner', 'crate', [21.75, 0.7, -31.05], 0),
  srch('s-crate-k3', 'diner', 'crate', [25.6, 0.7, -31.05], 0),
  srch('s-bin-kitchen', 'diner', 'bin', [20.9, 1.0, -20.95], 0),
  srch('s-bin-dining', 'diner', 'bin', [7.85, 1.0, -21.0], 0),
  srch('s-till', 'diner', 'crate', [14.0, 1.2, -25.65], Math.PI, 'diner:till'),
  srch('s-barrel-back1', 'diner', 'barrel', [25.8, 0.97, -29.2], 0),
  srch('s-barrel-back2', 'diner', 'barrel', [25.8, 0.97, -28.4], 0),
  // motel (14): one in each room, three cars in the lot, two bins, the office desk
  ...rooms.filter((r) => r.id !== 'office').map(roomItem),
  srch('s-car-m1', 'motel', 'car', [33.6, 0.9, -29.5], 0),
  srch('s-car-m2', 'motel', 'car', [48.0, 0.9, -27.1], Math.PI / 2),
  srch('s-car-m3', 'motel', 'car', [49.4, 0.9, -11.0], 0),
  srch('s-bin-m1', 'motel', 'bin', [44.6, 1.0, -36.55], 0),
  srch('s-bin-m2', 'motel', 'bin', [57.6, 1.0, -26.0], 0),
  srch('s-desk', 'motel', 'crate', [29.0, 0.95, -41.4], 0, 'motel:desk'),
  // garage (12): lockers, scrap cars, barrels, the tool chest, a crate
  ...[48.4, 49.2, 50.0, 50.8].map((x, i) => srch(`s-locker${i + 1}`, 'garage', 'locker', [x, 1.0, 19.08], Math.PI)),
  srch('s-scrap1', 'garage', 'car', [26.6, 0.9, 11.6], 0),
  srch('s-scrap2', 'garage', 'car', [38.6, 0.9, 9.4], 0),
  srch('s-scrap3', 'garage', 'car', [30.6, 0.9, 20.5], 0),
  srch('s-scrap4', 'garage', 'car', [39.1, 0.9, 22.4], 0),
  srch('s-barrel-g1', 'garage', 'barrel', [24.6, 0.97, 22.4], 0),
  srch('s-barrel-g2', 'garage', 'barrel', [45.0, 0.97, 0.3], 0),
  srch('s-toolchest', 'garage', 'toolchest', [60.4, 1.0, 13.85], Math.PI),
  srch('s-crate-g', 'garage', 'crate', [36.2, 0.7, 22.4], 0),
];

// stand-ins the greybox draws for searchables that no other prop draws yet (x, z: centre; w, d, h)
export const standIns = {
  's-crate-k1': [20.95, -31.35, 0.6, 0.5, 0.6], 's-crate-k2': [21.75, -31.35, 0.6, 0.5, 0.6], 's-crate-k3': [25.6, -31.35, 0.6, 0.5, 0.6],
  's-bin-kitchen': [20.9, -20.65, 0.5, 0.5, 0.9], 's-bin-dining': [7.85, -20.7, 0.5, 0.5, 0.9],
  's-barrel-back1': [26.0, -29.2, 0.58, 0.58, 0.89], 's-barrel-back2': [26.0, -28.4, 0.58, 0.58, 0.89],
  's-bin-m1': [44.6, -36.9, 0.5, 0.5, 0.9], 's-bin-m2': [58.0, -26.0, 0.5, 0.5, 0.9],
  's-desk': [29.0, -41.9, 1.4, 0.7, 0.8],
  's-locker1': [48.4, 19.4, 0.75, 0.5, 1.9], 's-locker2': [49.2, 19.4, 0.75, 0.5, 1.9], 's-locker3': [50.0, 19.4, 0.75, 0.5, 1.9], 's-locker4': [50.8, 19.4, 0.75, 0.5, 1.9],
  's-barrel-g1': [24.6, 22.4, 0.58, 0.58, 0.89], 's-barrel-g2': [45.0, 0.3, 0.58, 0.58, 0.89],
  's-toolchest': [60.4, 14.25, 1.0, 0.6, 0.95], 's-crate-g': [36.2, 22.4, 0.7, 0.7, 0.6],
};
// cars the greybox stands in (until the vehicle layer replaces them): centre, yaw, length, width, height
export const standInCars = {
  's-car-m1': { x: 36.0, z: -29.5, yaw: 0, L: 4.6, W: 1.8, H: 1.45 },
  's-car-m2': { x: 48.0, z: -29.6, yaw: Math.PI / 2, L: 4.6, W: 1.8, H: 1.45 },
  's-car-m3': { x: 51.8, z: -11.0, yaw: 0, L: 4.4, W: 1.8, H: 1.45 },
  's-scrap1': { x: 29.0, z: 11.6, yaw: 0, L: 4.2, W: 1.8, H: 1.3 },
  's-scrap2': { x: 41.0, z: 9.4, yaw: 0, L: 4.2, W: 1.8, H: 1.3 },
  's-scrap3': { x: 33.0, z: 20.5, yaw: 0, L: 4.2, W: 1.8, H: 1.3 },
  's-scrap4': { x: 41.5, z: 22.4, yaw: 0, L: 4.2, W: 1.8, H: 1.3 },
};
// room furniture the greybox stands in for the room searchables
for (const r of rooms) {
  if (r.id === 'office') continue;
  const s = searchables.find((q) => q.id === `s-${r.id}`);
  const y = r.floor ? UP : 0;
  if (r.wing === 'n') standIns[s.id] = s.kind === 'dresser' ? [s.pos[0], NW.back + WALL + 0.27, 1.2, 0.5, 0.85, y] : [s.pos[0], s.pos[2] - 0.15, 0.7, 0.25, 0.3, y];
  else standIns[s.id] = s.kind === 'dresser' ? [EW.back - WALL - 0.27, s.pos[2], 0.5, 1.2, 0.85, y] : [s.pos[0] - 0.15, s.pos[2], 0.25, 0.7, 0.3, y];
}

// ---- lights the greybox registers (zone: culled with it; needsPower: dark until the switch) ----
export const fixtures = [
  { zone: 'diner', kind: 'tube', pos: [13.5, 3.45, -26.4], needsPower: false, flicker: true },
  { zone: 'diner', kind: 'tube', pos: [23.3, 3.45, -26.0], needsPower: true },
  { zone: 'motel', kind: 'sodium', pos: [44, 7.6, -24], dir: [0, -1, 0.1], needsPower: false },
  { zone: 'motel', kind: 'neon', pos: [33, 6.9, -36.2], needsPower: true },
  { zone: 'motel', kind: 'tube', pos: [41.5, 2.6, -37.2], needsPower: true },
  { zone: 'garage', kind: 'sodium', pos: [34, 7.6, 10.5], dir: [0.1, -1, 0], needsPower: false },
  { zone: 'garage', kind: 'tube', pos: [56, 5.8, 9.5], needsPower: true },
  { zone: 'garage', kind: 'tube', pos: [56, 5.8, 16.5], needsPower: true },
];

// audio and rain areas (covered volumes) beyond the forecourt's own
export const areas = [
  { name: 'diner', min: [7.3, 0, -31.7], max: [20, 3.55, -20.3] },
  { name: 'kitchen', min: [20.3, 0, -31.7], max: [26.3, 3.55, -20.3] },
  ...rooms.map((r) => ({ name: 'motelRoom', id: r.id, min: r.wing === 'n' ? [r.a0, r.floor ? UP : 0, -43.7] : [60.3, r.floor ? UP : 0, r.a0], max: r.wing === 'n' ? [r.a1, r.floor ? 6.0 : 2.84, -38.3] : [65.7, r.floor ? 6.0 : 2.84, r.a1] })),
  { name: 'garage', min: [46.3, 0, 4.3], max: [65.7, 6.2, 19.7] },
];

// ---- enclosed cells (what world.js culls by portal) ----------------------------------------------
// A room with walls and a ceiling: from inside it nothing beyond can be seen except through its
// openings. box: the room's inside (min, max); portals: every opening in its walls, shut doors and
// boarded windows included (their barriers and boards have gaps, and the jambs behind them show),
// as world boxes { min, max }. Seen from inside the box, a mesh outside it is drawn only if it shows
// through one of these openings (world.js createPortalCull).
const opening = (x0, y0, z0, x1, y1, z1) => ({ min: [x0, y0, z0], max: [x1, y1, z1] });
const doorById = (id) => doors.find((d) => d.id === id);
const doorOpening = (id) => { const d = doorById(id); return opening(d.rect.x0, 0, d.rect.z0, d.rect.x1, d.h, d.rect.z1); };
const windowOpening = (w, y0 = 0) => (w.normal[0] === 0
  ? opening(w.pos[0] - w.w / 2, y0 + w.sill, w.pos[2] - 0.2, w.pos[0] + w.w / 2, y0 + w.head, w.pos[2] + 0.2)
  : opening(w.pos[0] - 0.2, y0 + w.sill, w.pos[2] - w.w / 2, w.pos[0] + 0.2, y0 + w.head, w.pos[2] + w.w / 2));
export const cells = [
  {
    id: 'diner', zone: 'diner', box: { min: [DIN.x0 + WALL, -0.5, DIN.zb + WALL], max: [DIN.x1 - WALL, 3.55, DIN.zf] },
    portals: [doorOpening('d1'), doorOpening('d2'), ...windows.filter((w) => w.zone === 'diner').map((w) => windowOpening(w))],
  },
  ...rooms.map((r) => {
    const y0 = r.floor ? UP : 0, y1 = r.floor ? ROOF - 0.3 : UP - SLAB;
    const win = r.window ? windows.find((w) => w.id === r.window) : null;
    const n = r.wing === 'n';
    return {
      id: `room-${r.id}`, zone: 'motel',
      box: n ? { min: [r.a0, y0 - 0.5, NW.back + WALL], max: [r.a1, y1, NW.front - WALL] } : { min: [EW.front + WALL, y0 - 0.5, r.a0], max: [EW.back - WALL, y1, r.a1] },
      portals: [
        n ? opening(r.door[0], y0, NW.front - WALL, r.door[1], y0 + 2.1, NW.front) : opening(EW.front, y0, r.door[0], EW.front + WALL, y0 + 2.1, r.door[1]),
        ...(win ? [windowOpening(win, y0)] : []),
      ],
    };
  }),
  {
    id: 'bays', zone: 'garage', box: { min: [BAY.x0 + WALL, -0.5, BAY.z0 + WALL], max: [BAY.x1 - WALL, BAY.h, BAY.z1 - WALL] },
    portals: [
      ...[5.0, 10.2, 15.4].map((a) => opening(BAY.x0, 0, a, BAY.x0 + WALL, 4.2, a + 3.6)),
      ...rollers.filter((r) => r.gap > 0).map((r) => opening(BAY.x1 - WALL, 0, r.z0, BAY.x1, r.gap, r.z1)),
    ],
  },
];

// the player starts in each zone here (zone=<name> harness param)
export const zoneStarts = {
  forecourt: F.playerStart,
  diner: { pos: [10, 0, -23], yaw: Math.PI * 0.5 },
  motel: { pos: [40, 0, -18], yaw: 0.3 },
  garage: { pos: [38, 0, 10.5], yaw: -Math.PI / 2 },
};

// navigation: the upper floor and the stairs (grid.js options)
export const navOptions = {
  layers: [{ y: 0 }, { y: UP, floors: upperFloors }],
  ramps: stairs.map((s) => ({ foot: s.foot, dir: s.dir, width: s.width, steps: s.steps, rise: s.rise, tread: s.tread, landing: s.landing })),
};

// shots of the new areas (cam: x, y, z, yaw, pitch)
export const shots = {
  'p2-grey-diner': { cam: [8.2, 1.7, -21.2, -0.93, -0.05], fov: 70 },
  'p2-grey-motel': { cam: [30.5, 1.7, -6.5, -0.65, 0.05], fov: 70 },
  'p2-grey-garage': { cam: [23.5, 1.7, 10.1, -1.5708, 0.0], fov: 70 },
  'p2-grey-top': { cam: [22, 120, -10, 0, -1.5708], fov: 50 },
  'p2-walkway': { cam: [27.4, UP + 1.7, -37.2, -1.5708, -0.08], fov: 70 },
  // the scrapyard through the forecourt's east fence (doors shut and open must match),
  // the back fence's sagging rail and its wire, the east stair and its rails, the road wrecks
  'p2-east-fence': { cam: [17.5, 1.7, 6.5, -1.35, 0.02], fov: 70 },
  'p2-sag': { cam: [62.6, 1.7, -12.4, -1.19, 0.06], fov: 60 },
  'p2-stairs': { cam: [59.2, UP + 1.7, -23, 3.1416, -0.25], fov: 70 },
  'p2-wrecks': { cam: [30.5, 1.7, -35, 1.5708, 0.02], fov: 70 },
};
