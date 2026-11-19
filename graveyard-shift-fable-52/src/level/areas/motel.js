// The Larkspur Motel: an L of rooms on two floors round a parking lot, an upper walkway
// with a rail and standing water, two stairs, the office, eight rooms to go into (each left
// differently), abandoned cars, and the sign on the roof that stays dead until the power is on.
// Long sight lines across the lot, short ones in the rooms.
//
// Structure, doors, windows, stairs and every fixed position are worldLayout's. The shell
// draws the structure; the fronts, the rooms and the dressing are one art mesh (mats/interior.js).
import { PlaneGeometry } from 'three';
import { createRng } from '../../core/rng.js';
import { M, box, cyl, cylUp, rgb, sphere, torus } from '../build.js';
import { createArt, LIGHT } from '../../mats/interior.js';
import { shellStructure } from '../props/stairs.js';
import { buildRoom, buildBay, roomLights, ROOM_STYLES } from '../props/motelRoom.js';
import { buildStandIn } from '../props/kitchen.js';
import { boardWindow } from '../props/boards.js';
import { buildBarrier } from '../props/barrier.js';
import { buildCar } from '../props/car.js';
import { treeGeometry, shrubGeometry, grassGeometry } from '../props/foliage.js';

const UP = 3.04;
const STUCCO = rgb(0xa8987a, 0.6);
const TUBE_GLOW = [0.8 * 20, 1.0 * 20, 0.9 * 20];
const NUM = { n1: '101', n2: '103', n3: '201', n4: '203', e1: '106', e2: '107', e3: '206', e4: '207' };
const CONTAINER = [0x7a2a1c, 0x1f4a5a, 0x5a5a52, 0x8a6a1a, 0x2a4a2a, 0x6a2a22];

export function buildMotel(B, W) {
  const rng = createRng(1108).fork('motel');
  const A = createArt(B, 'motel');
  A.rng = rng;
  const pp = B.prepass;
  B.prepass = null;
  try {
    // ---- shell: wings, walkway, stairs, rails, posts; the container wall drawn as containers ----
    shellStructure(B, W, 'motel', { wall: STUCCO, solid: STUCCO, roof: rgb(0x242426, 0.6), floor: rgb(0x77746e, 0.55), stair: rgb(0x8a877f, 0.6), stairBase: rgb(0x4a4844, 0.6) }, (s) => s.kind === 'block');
    B.inZone('shell', () => {
      let k = 0;
      for (const s of W.structure) {
        if (s.zone !== 'motel' || s.kind !== 'block') continue;
        const [x0, y0, z0] = s.min, [x1, y1, z1] = s.max;
        const tiers = Math.max(1, Math.round((y1 - y0) / 2.6)), n = Math.max(1, Math.round((x1 - x0) / 6.1)), w = (x1 - x0) / n;
        for (let t = 0; t < tiers; t++) for (let i = 0; i < n; i++, k++) {
          const th = (y1 - y0) / tiers;
          const c = rgb(CONTAINER[(k * 5 + t * 3) % CONTAINER.length], 0.55), cx = x0 + w * (i + 0.5), cy = y0 + th * (t + 0.5);
          B.add('vcMatte', box(w - 0.04, th - 0.04, z1 - z0 - 0.04), { m: M(cx, cy, (z0 + z1) / 2), color: c, shadow: true });
          for (const z of [z0, z1]) for (let r = -w / 2 + 0.3; r < w / 2 - 0.1; r += 0.42) B.add('vcMatte', box(0.14, th - 0.3, 0.05), { m: M(cx + r, cy, z), color: [c[0] * 0.8, c[1] * 0.8, c[2] * 0.8] });
          for (const z of [z0 - 0.01, z1 + 0.01]) for (const y of [cy - th / 2 + 0.06, cy + th / 2 - 0.06]) B.add('vcMatte', box(w - 0.02, 0.1, 0.07), { m: M(cx, y, z), color: [c[0] * 0.6, c[1] * 0.6, c[2] * 0.6] });
        }
      }
    });
    // ---- ground: the lot's wet asphalt (the forecourt's material), the yard
    const slab = (x0, z0, x1, z1) => B.add('asphalt', new PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2), { m: M((x0 + x1) / 2, 0, (z0 + z1) / 2) });
    slab(26.45, -38, 60, -3.2); slab(60, -17, 66.2, -3.2);

    const win = (id) => W.windows.find((w) => w.id === id);
    const d5 = W.doors.find((d) => d.id === 'd5'), d3 = W.doors.find((d) => d.id === 'd3');
    const frame = (r) => (r.wing === 'n' ? M(r.a0, r.floor ? UP : 0, -38) : M(60, r.floor ? UP : 0, r.a0, 0, -Math.PI / 2, 0));

    // ---- the fronts, the walkway and the lot: one light group, lit by what hangs under the walkway
    A.part('lot');
    A.room('lot');
    const vfx = W.fixtures.find((f) => f.zone === 'motel' && f.kind === 'neon');
    const tfx = W.fixtures.find((f) => f.zone === 'motel' && f.kind === 'tube');
    A.light({ pos: tfx.pos, lm: 1500, fx: true, power: true, range: 8, reach: 7 });
    const soffit = [[29.5, -37.2], [35.5, -37.2], [47.0, -37.2], [52.5, -37.2], [57.5, -37.2], [59.2, -33.5], [59.2, -28.2], [59.2, -22.0]];
    for (const [x, z] of soffit) A.light({ pos: [x, 2.72, z], lm: 1300, power: true, reach: 7, amb: 0.001 });
    const upLamps = [[41.65, UP + 1.86, -37.9], [51.65, UP + 1.86, -37.9], [55.5, UP + 1.86, -37.9], [28.5, UP + 1.86, -37.9], [34.9, UP + 1.86, -37.9], [59.9, UP + 1.86, -27.35], [59.9, UP + 1.86, -20.35], [59.9, UP + 1.86, -33.0]];
    for (const p of upLamps) A.light({ pos: p, lm: 330, color: LIGHT.warm, power: true, reach: 5, amb: 0.0008, noShadow: true });
    A.light({ pos: vfx.pos, lm: 1100, color: LIGHT.amber, fx: true, power: true, range: 12, reach: 8, amb: 0.001 });

    // battery emergency lights: the only light on the stairs and at the alley gate without the power
    const EMERGENCY = [[32.4, UP + 2.3, -37.9, 0, 1], [38.2, 2.35, -37.9, 0, 1], [59.9, 2.35, -15.0, -1, 0], [59.9, UP + 2.3, -18.2, -1, 0], [27.0, 2.6, -9.6, 0, -1]];
    for (const [x, y, z] of EMERGENCY) A.light({ pos: [x, y, z + (z < -37 ? 0.15 : 0)], lm: 240, reach: 7, amb: 0.0006 });
    // the sheds that close the lot's west side: a lamp over each sign when the power is on
    for (const z of [-16.4, -6.2]) A.light({ pos: [27.5, 4.4, z], lm: 1500, color: LIGHT.warm, power: true, reach: 8, amb: 0.0006, down: 0.7 });
    westSide(A, B, rng);
    stairArt(A, W);
    // walkway: wet concrete on top, a painted soffit with its tubes below, a fascia on the lot edge
    for (const w of W.walkway) {
      A.quad('concrete', [w.x0, UP + 0.004, w.z1], [w.x1 - w.x0, 0, 0], [0, 0, w.z0 - w.z1], rgb(0x8a877f), { wet: 1, cell: 0.5, ao: true });
      A.quad('paint', [w.x0, UP - 0.204, w.z0], [w.x1 - w.x0, 0, 0], [0, 0, w.z1 - w.z0], rgb(0xa8a08a), { cell: 0.5 });
      A.quad('concrete', [w.x0, 0.006, w.z1], [w.x1 - w.x0, 0, 0], [0, 0, w.z0 - w.z1], rgb(0x6a6862), { wet: 0.25, cell: 0.5, ao: true });
    }
    A.wall('paint', '+z', -36.386, 26.6, 58.4, UP - 0.2, UP + 0.02, rgb(0x1d4a44), { par: 1, cell: 1 });
    A.wall('paint', '-x', 58.386, -36.4, -17, UP - 0.2, UP + 0.02, rgb(0x1d4a44), { par: 1, cell: 1 });
    const tubeFit = (x, z, alongX) => {
      A.box('paint', alongX ? [x - 0.65, UP - 0.26, z - 0.07] : [x - 0.07, UP - 0.26, z - 0.65], alongX ? [x + 0.65, UP - 0.204, z + 0.07] : [x + 0.07, UP - 0.204, z + 0.65], rgb(0xc8c4b4), { par: 1 });
      A.add('glow', cyl(0.018, 0.018, 1.2, 6).rotateZ(Math.PI / 2), { m: M(x, UP - 0.28, z, 0, alongX ? 0 : Math.PI / 2, 0), color: [0.4, 0.42, 0.4], glow: TUBE_GLOW, power: true });
    };
    for (const [x, y, z, nx, nz] of EMERGENCY) {
      A.box('paint', [x - 0.14 - Math.abs(nx) * -0.08, y - 0.06, z - 0.14 + Math.abs(nx) * 0.0], [x + 0.14 - Math.abs(nx) * 0.08, y + 0.06, z + 0.14], rgb(0xb9b4a0), { par: 1 });
      for (const k of [-0.07, 0.07]) A.add('glow', cylUp(0.035, 0.035, 0.03, 8), { m: M(x + nx * 0.1 + (nx ? 0 : k), y - 0.02, z + nz * 0.1 + (nx ? k : 0), nz * 1.2, 0, -nx * 1.2), color: [0.5, 0.5, 0.5], glow: [9, 11, 10] });
    }
    tubeFit(tfx.pos[0], tfx.pos[2], true);
    soffit.forEach(([x, z], i) => tubeFit(x, z, i < 5));

    // the bays of each wing, both floors
    const bays = [
      // north wing, ground: the office, the ice alcove behind the stair, 101..104
      { wing: 'n', a0: 26.9, W: 4.7, floor: 0, door: [3.25, 4.45], win: [0.5, 2.7], number: '', lamp: true, glow: true, gap: true, curtain: 0x8a7a5a },
      { wing: 'n', a0: 31.6, W: 7.4, floor: 0, ice: true },
      { wing: 'n', a0: 39, W: 5, floor: 0, room: 'n1', win: [2.9, 4.4], curtain: 0x7a3a2a },
      { wing: 'n', a0: 44, W: 5, floor: 0, fake: [1.2, 2.15], win: [2.9, 4.4], number: '102', curtain: 0x4a5a4a },
      { wing: 'n', a0: 49, W: 5, floor: 0, room: 'n2', win: [2.9, 4.4], curtain: 0x2f5a52, glow: true },
      { wing: 'n', a0: 54, W: 6, floor: 0, fake: [1.2, 2.15], win: [2.9, 4.4], number: '104', curtain: 0x6a5a3a },
      // north wing, upper
      { wing: 'n', a0: 26.9, W: 6.1, floor: 1, fake: [1.2, 2.15], win: [2.9, 4.4], number: '209', curtain: 0x5a4a3a },
      { wing: 'n', a0: 33.0, W: 6, floor: 1, fake: [1.5, 2.45], win: [3.2, 4.7], number: '208', curtain: 0x4a3a4a, glow: true },
      { wing: 'n', a0: 39, W: 5, floor: 1, room: 'n3', win: [2.9, 4.4], curtain: 0x6a4a6a },
      { wing: 'n', a0: 44, W: 5, floor: 1 }, // the wall buy hangs here: left bare
      { wing: 'n', a0: 49, W: 5, floor: 1, room: 'n4', win: [2.9, 4.4], curtain: 0xa88a3a },
      { wing: 'n', a0: 54, W: 6, floor: 1, fake: [1.2, 2.15], win: [2.9, 4.4], number: '204', curtain: 0x3a4a5a },
      // east wing, both floors
      ...[0, 1].flatMap((floor) => [
        { wing: 'e', a0: -38, W: 7, floor, fake: [4.5, 5.45], win: [2.2, 3.7], number: floor ? '205' : '105', curtain: 0x5a3a2a, glow: !floor },
        { wing: 'e', a0: -31, W: 5, floor, room: floor ? 'e3' : 'e1', win: [0.35, 1.85], curtain: floor ? 0x4a6a3a : 0x8a8478 },
        { wing: 'e', a0: -26, W: 2, floor },
        { wing: 'e', a0: -24, W: 5, floor, room: floor ? 'e4' : 'e2', win: [0.35, 1.85], curtain: floor ? 0x3a4a7a : 0xa8562a, glow: !!floor },
        { wing: 'e', a0: -19, W: 2, floor },
      ]),
    ];
    for (const b of bays) {
      const room = b.room ? W.rooms.find((r) => r.id === b.room) : null;
      B.at(frame(b), () => {
        const H = b.floor ? 3.26 : UP - 0.2;
        const door = room ? [room.door[0] - room.a0, room.door[1] - room.a0] : b.door || null;
        buildBay(A, { W: b.W, H, door, fake: b.fake, win: b.win, number: room ? NUM[b.room] : b.number, wet: b.floor ? 0.7 : 0.12, lamp: b.floor === 1 && !!(room || b.fake) && b.number !== '204', glow: b.glow, gap: b.gap, curtain: b.curtain, doorColor: b.floor ? 0x1f5a52 : 0x8f2a1c });
        if (b.ice) {
          // the alcove behind the stair: an ice machine let into the wall, its sign, a rate card
          A.box('metal', [2.6, 0.05, 0.014], [3.9, 1.85, 0.16], rgb(0x8a9094), { par: 0.4, bevel: 0.02 });
          A.box('paint', [2.7, 0.9, 0.16], [3.8, 1.5, 0.175], rgb(0x1a2226), { par: 1 });
          A.sign('ice', [2.85, 1.02, 0.18], [0.8, 0, 0], [0, 0.42, 0], { glow: [1.6, 2.0, 2.4], power: true, color: [0.4, 0.4, 0.4] });
          A.box('metal', [2.8, 0.3, 0.16], [3.7, 0.75, 0.19], rgb(0x6a6e72), { par: 0.5 });
          A.sign('rates', [5.6, 1.2, 0.02], [0.5, 0, 0], [0, 0.61, 0]);
        }
      });
    }
    // the office's sign over its door; the scrawls
    A.box('paint', [29.9, 2.24, -37.97], [31.6, 2.72, -37.9], rgb(0x101412));
    A.sign('office', [30.0, 2.28, -37.895], [1.5, 0, 0], [0, 0.375, 0], { glow: [0.5, 4.2, 3.4], power: true, color: [0.12, 0.12, 0.12] });
    A.sign('scrawl', [60 - 0.02, 0.9, -25.9], [0, 0, 1.75], [0, 0.62, 0], { color: [0.3, 0.02, 0.015] });
    A.sign('help', [54.3, UP + 1.3, -37.975], [1.6, 0, 0], [0, 0.64, 0], { color: [0.55, 0.5, 0.4] });

    // the sign on the roof: the name and, beside it, VACANCY with its NO long dead
    {
      const y = 6.55, x0 = 27.6, w = 7.4, h = w * 224 / 1280, z = -37.75;
      A.box('paint', [x0 - 0.08, y - 0.08, z - 0.2], [x0 + w + 0.08, y + h + 0.08, z - 0.01], rgb(0x101412), { shadow: true });
      A.sign('motel', [x0, y, z], [w, 0, 0], [0, h, 0], { glow: [2.4, 2.2, 1.7], power: true, color: [0.1, 0.1, 0.1] });
      const vx = x0 + w + 0.35, vw = 3.0, vh = 0.6;
      A.box('paint', [vx - 0.06, y - 0.06, z - 0.16], [vx + vw + 0.06, y + vh + 0.06, z - 0.01], rgb(0x101412), { shadow: true });
      A.sign('vacancy', [vx, y, z], [vw * 0.27, 0, 0], [0, vh, 0], { sub: [0, 0, 0.27, 1], color: [0.1, 0.1, 0.1] });
      A.sign('vacancy', [vx + vw * 0.27, y, z], [vw * 0.73, 0, 0], [0, vh, 0], { sub: [0.27, 0, 1, 1], glow: [5.5, 0.8, 0.5], power: true, color: [0.1, 0.1, 0.1] });
      for (const x of [x0 + 0.6, x0 + w - 0.6, vx + vw / 2]) { A.box('metal', [x - 0.04, 6.3, z - 0.14], [x + 0.04, y, z - 0.06], rgb(0x5a5e60)); A.box('metal', [x - 0.03, 6.3, z - 1.2], [x + 0.03, 6.36, z - 0.1], rgb(0x5a5e60)); A.add('metal', cyl(0.02, 0.02, 1.5, 5), { m: M(x, 6.9, z - 0.65, -0.72, 0, 0), color: rgb(0x5a5e60) }); }
    }
    // door lamps of the upper floor are in the bays; gutters and downpipes at the posts
    for (const x of [38.6, 50.6]) A.add('metal', cyl(0.04, 0.04, 3.2, 8), { m: M(x, UP + 1.6, -37.93), color: rgb(0x5a5e60), par: 0.5 });

    // parking: worn bay lines and wheel stops along both wings
    for (let x = 38.9; x < 57.5; x += 2.75) A.quad('mark', [x, 0.007, -31.6], [0.1, 0, 0], [0, 0, -4.6], rgb(0xb9b4a0), { par: 1, cell: 1.2 });
    for (let z = -33.5; z < -17.5; z += 2.75) A.quad('mark', [53.7, 0.007, z + 0.1], [4.6, 0, 0], [0, 0, -0.1], rgb(0xb9b4a0), { par: 1, cell: 1.2 });
    A.detail(() => {
      for (let x = 40.3; x < 57; x += 2.75) A.box('concrete', [x - 0.8, 0, -36.25], [x + 0.8, 0.11, -36.05], rgb(0x8a877f), { bevel: 0.02, wet: 0.5 });
      for (let z = -32.1; z < -18; z += 2.75) A.box('concrete', [58.0, 0, z - 0.8], [58.2, 0.11, z + 0.8], rgb(0x8a877f), { bevel: 0.02, wet: 0.5 });
      // what was dropped on the way to the cars; a trail to 103
      // a case burst open on its back, another standing where it was put down, what spilled out of the first
      B.at(M(45.55, 0, -30.7, 0, 0.5, 0), () => {
        A.box('vinyl', [-0.38, 0, -0.25], [0.38, 0.14, 0.25], rgb(0x2a3a5a), { bevel: 0.035 });
        A.box('vinyl', [-0.38, 0.0, -0.3], [0.38, 0.12, -0.25], rgb(0x2a3a5a), { bevel: 0.03, rx: -1.25 }); // the lid, thrown back
        A.box('paint', [-0.36, 0.14, -0.23], [0.36, 0.15, 0.23], rgb(0x0c0d10));
        for (const [x, z, c, sc] of [[-0.15, 0.0, 0x8a8478, 1], [0.12, 0.05, 0x7a2a2a, 0.8], [0.0, -0.12, 0x3a4a6a, 0.7]]) A.add('curtain', sphere(0.17, 8, 5), { m: M(x, 0.16, z, 0, x * 9, 0, sc * 1.2, 0.4, sc), color: rgb(c) });
        for (const sx of [-0.25, 0.25]) A.box('metal', [sx - 0.025, 0.06, 0.25], [sx + 0.025, 0.11, 0.262], rgb(0xb89a48));
      });
      B.at(M(46.5, 0, -32.2, 0, -0.3, 0), () => {
        A.box('vinyl', [-0.24, 0.02, -0.1], [0.24, 0.62, 0.1], rgb(0x6a2a22), { bevel: 0.035 });
        for (const y of [0.14, 0.5]) A.box('paint', [-0.245, y, -0.105], [0.245, y + 0.03, 0.105], rgb(0x2a1210));
        A.add('metal', torus(0.06, 0.01, 5, 10, Math.PI), { m: M(0, 0.62, 0), color: rgb(0x1a1a1a) });
        for (const sx of [-0.2, 0.2]) A.add('paint', cyl(0.025, 0.025, 0.03, 8).rotateX(Math.PI / 2), { m: M(sx, 0.025, 0.09), color: rgb(0x0a0a0a) });
      });
      for (let i = 0; i < 7; i++) {
        const cx = 46.1 + rng.range(-1.1, 1.5), cz = -31.5 + rng.range(-0.9, 0.8), sc = rng.range(0.7, 1.2);
        A.add('curtain', sphere(0.2, 8, 5), { m: M(cx, 0.03, cz, 0, rng.range(0, 3), 0, sc * 1.3, 0.22, sc * 0.8), color: rgb([0x8a8478, 0x3a4a6a, 0x7a2a2a, 0x2f5a52][i % 4]) });
      }
      for (const [x, z, ry] of [[47.4, -30.6, 0.3], [47.62, -30.52, 1.4]]) { A.box('vinyl', [x - 0.05, 0, z - 0.14], [x + 0.05, 0.07, z + 0.14], rgb(0x1a1210), { bevel: 0.02, ry }); }
      for (let i = 0; i < 9; i++) A.sign('splat', [48.6 + i * 0.28 + rng.range(-0.1, 0.1), 0.008, -31.0 - i * 0.75], [0.5 + 0.3 * rng.next(), 0, 0], [0, 0, -0.5 - 0.3 * rng.next()], { color: [0.12, 0.006, 0.005], par: 1 });
      A.sign('smear', [50.3, 0.009, -36.6], [1.0, 0, -1.4], [0.5, 0, 0.4], { color: [0.12, 0.006, 0.005], par: 1 });
    });
    // the yard behind the east wing: condensers on their pads
    for (const x of [61.3, 62.7]) {
      A.box('concrete', [x - 0.55, 0, -16.9], [x + 0.55, 0.08, -15.9], rgb(0x8a877f), { wet: 0.6 });
      A.box('metal', [x - 0.45, 0.08, -16.8], [x + 0.45, 0.88, -16.05], rgb(0x7a7e80), { par: 0.6, bevel: 0.02, shadow: true });
      for (let i = 0; i < 7; i++) A.box('paint', [x - 0.4, 0.16 + i * 0.09, -16.05], [x + 0.4, 0.2 + i * 0.09, -16.04], rgb(0x101010));
      B.tag('motel:condenser', () => B.collide([x - 0.45, 0, -16.8], [x + 0.45, 0.88, -16.05], 'metal'));
    }
    const sIn = (id, o) => buildStandIn(A, W.searchables.find((s) => s.id === id), W.standIns[id], o);
    sIn('s-bin-m1'); sIn('s-bin-m2', { color: rgb(0x4a4d50) });

    // ---- the rooms -----------------------------------------------------------------------------
    for (const r of W.rooms) {
      if (r.id === 'office') continue;
      const st = ROOM_STYLES[r.id], q = r.window ? win(r.window) : null;
      const flip = r.wing === 'e';
      const o = { id: r.id, W: r.a1 - r.a0, H: r.floor ? 2.96 : UP - 0.2, door: [r.door[0] - r.a0, r.door[1] - r.a0], style: st, flip, window: q ? { x: q.pos[0] - r.a0, w: q.w, sill: q.sill, head: q.head } : null };
      A.part('rooms');
      A.room(`room:${r.id}`);
      B.at(frame(r), () => {
        roomLights(A, { ...o, window: o.window ? o.window.x : null });
        buildRoom(A, o);
        if (q) A.glass([o.window.x - q.w / 2, q.sill, -5.69], [q.w, 0, 0], [0, q.head - q.sill, 0], { broken: true });
        if (q) for (const [x0, x1, y0, y1] of [[o.window.x - 0.66, o.window.x + 0.66, q.sill - 0.06, q.sill], [o.window.x - 0.66, o.window.x + 0.66, q.head, q.head + 0.06], [o.window.x - 0.66, o.window.x - 0.6, q.sill, q.head], [o.window.x + 0.6, o.window.x + 0.66, q.sill, q.head]]) A.box('paint', [x0, y0, -5.75], [x1, y1, -5.66], rgb(0xbdb39a), { par: 1 });
      });
      sIn(`s-${r.id}`, { face: r.wing === 'n' ? [0, 1] : [-1, 0], color: rgb([0x4a3020, 0x5a3a22, 0x3a2a3a, 0x2a3a2a][r.a0 & 3]) });
      if (q) boardWindow(A, q);
    }
    // the office: counter desk, key board, the guest book, a dead television
    {
      const r = W.rooms.find((x) => x.id === 'office'), Wd = r.a1 - r.a0, H = UP - 0.2;
      A.part('rooms');
      A.room('room:office');
      B.at(frame(r), () => {
        A.light({ pos: [Wd / 2, H - 0.12, -3.0], lm: 1700, power: true, real: true, range: 7, amb: 0.004 });
        A.light({ pos: [3.85, 2.3, -0.5], lm: 60, color: LIGHT.red, amb: 0.003, noShadow: true });
        A.light({ pos: [1.6, 1.5, -0.45], lm: 260, color: LIGHT.sodium, amb: 0, r0: 0.6, reach: 6 }); // the lot's lamp through the blinds
        A.light({ pos: [2.55, 1.02, -3.95], lm: 320, color: [0.7, 1.5, 0.6], power: true, amb: 0.001, noShadow: true, r0: 0.3 }); // the desk lamp
        A.quad('linoleum', [0, 0.004, -0.3], [Wd, 0, 0], [0, 0, -5.4], rgb(0x6a5a40), { cell: 0.25, ao: true, wetAt: (x, y, z) => Math.max(0, 1 - Math.hypot(x - 30.75, z + 38.3) / 2.5) });
        A.quad('ceiling', [0, H - 0.004, -5.7], [Wd, 0, 0], [0, 0, 5.4], rgb(0xbdb6a0), { cell: 0.6 });
        const door = [r.door[0] - r.a0, r.door[1] - r.a0], wopt = { ao: true, cell: 0.35 }, wc = rgb(0x8a9a8a, 0.75);
        for (const [face, c, a0, a1, hs] of [['+z', -5.688, 0, Wd, []], ['-z', -0.312, 0, Wd, [{ a: door[0], b: door[1], y0: 0, y1: 2.1 }]], ['+x', 0.012, -5.7, -0.3, []], ['-x', Wd - 0.012, -5.7, -0.3, []]]) {
          A.wall('wood', face, c, a0, a1, 0, 1.0, rgb(0x4a3020), { ...wopt, par: 2 }, hs);
          A.wall('plaster', face, c, a0, a1, 1.0, H, wc, wopt, hs);
        }
        A.sign('exit', [door[1] - 0.1, 2.16, -0.33], [-0.44, 0, 0], [0, 0.22, 0], { glow: [7, 0.6, 0.35], color: [0.4, 0.4, 0.4] });
        fittingO(A, Wd / 2, H, -3.0);
        A.sign('keys', [0.9, 1.25, -5.68], [1.6, 0, 0], [0, 0.8, 0]);
        A.sign('rates', [2.9, 1.3, -5.68], [0.55, 0, 0], [0, 0.67, 0]);
        A.sign('calendar', [0.02, 1.4, -1.2], [0, 0, -0.4], [0, 0.55, 0]);
        A.sign('art2', [Wd - 0.02, 1.45, -2.4], [0, 0, 0.8], [0, 0.6, 0]);
        officeDressing(A, B, Wd, H, rng);
        // waiting chairs by the window, a rack of leaflets
        for (const cz of [-1.0, -1.7]) { A.box('vinyl', [0.1, 0.3, cz - 0.28], [0.65, 0.44, cz + 0.28], rgb(0x7a5a2a), { bevel: 0.04 }); A.box('vinyl', [0.06, 0.44, cz - 0.28], [0.16, 0.95, cz + 0.28], rgb(0x7a5a2a), { bevel: 0.04 }); for (const lx of [0.14, 0.6]) for (const lz of [-0.24, 0.24]) A.box('metal', [lx - 0.015, 0, cz + lz - 0.015], [lx + 0.015, 0.3, cz + lz + 0.015], rgb(0x9a9ea2)); }
        B.blob(1.2, 1.6, 0.4, -1.35);
        B.tag('motel:chairs', () => { B.collide([0.06, 0, -1.98], [0.66, 0.46, -0.72], 'cloth'); B.collide([0.04, 0.44, -1.98], [0.18, 0.95, -0.72], 'cloth'); });
        A.detail(() => {
          A.sign('guest', [1.9, 0.86, -3.95], [0.42, 0, 0.05], [-0.04, 0, -0.3]);
          A.add('metal', cylUp(0.05, 0.06, 0.04, 10), { m: M(2.75, 0.83, -3.95), color: rgb(0xb89a48) });
          for (let i = 0; i < 8; i++) A.sign('ticket', [1.0 + rng.next() * 2.6, 0.008, -1.0 - rng.next() * 2.2], [0.15, 0, 0.05], [-0.07, 0, -0.24]);
        });
      });
      sIn('s-desk', { desk: true, face: [0, 1] });
    }

    // ---- cars left in the lot (the vehicle layer draws them; boots open when searched)
    const car = (id, x, z, yaw, o) => B.at(M(x, 0, z, 0, yaw, 0), () => B.tag(`search:${id}`, () => buildCar(B, { id: `motel-${id}`, prop: id, ...o })));
    car('s-car-m1', 35.85, -29.5, 0, { type: 'hatch', paint: 'paintCarF', plate: 'plateD', doorAjar: 1.1, dome: true, dirt: 0.6, rust: 0.4 });
    car('s-car-m2', 48.0, -29.75, Math.PI / 2, { type: 'wagon', paint: 'paintCarB', plate: 'plateA', tail: true, dirt: 0.5, rust: 0.3, brokenGlass: ['fl'] });
    car('s-car-m3', 51.95, -11.0, 0, { type: 'sedan', paint: 'paintCarA', plate: 'plateC', flat: 'rl', dirt: 0.7, rust: 0.6, damage: 0.3 });

    buildBarrier(A, d5); buildBarrier(A, d3);
    A.part('lot');
    beyond(B, rng);
    A.shot('motel-lot', [29.6, 1.7, -7.5, -0.62, 0.06]);
    A.shot('motel-lot2', [56.5, 1.7, -8.0, 0.75, 0.08]);
    A.shot('motel-room', [41.0, 1.65, -38.6, -0.35, -0.12]);
    A.shot('motel-room-e', [60.6, 1.65, -28.4, -1.35, -0.12]);
    A.shot('motel-stairs', [39.6, 1.7, -33.6, 1.05, 0.22]);
    A.shot('motel-walkway', [57.6, UP + 1.7, -36.95, 1.78, -0.27]);
    A.shot('motel-upper', [50.9, UP + 1.65, -38.6, -0.4, -0.12]);
    A.shot('motel-office', [30.6, 1.65, -38.7, 0.45, -0.1]);
    A.shot('motel-front', [45.5, 1.7, -30.5, 0.25, 0.12]);
    A.shot('motel-back-to-forecourt', [40.0, UP + 1.7, -37.0, 1.9, -0.05]);
    A.finish();
  } finally { B.prepass = pp; }
  return { real: true, id: 'motel' };
}

// The west side of the lot: the cold store and the tyre shed that stand between the motel and the
// forecourt, and the roller box over the alley gate. world.js draws them as plain blocks (they are
// the forecourt's); their faces to the lot are dressed here, a little proud of the blocks.
function westSide(A, B, rng) {
  const X = 26.6 + 0.014, STEELC = rgb(0x8a8e92), DARKC = rgb(0x15171a);
  const face = (kind, z0, z1, y0, y1, col, opts, holes) => A.wall(kind, '+x', X, z0, z1, y0, y1, col, { cell: 0.7, ao: true, ...opts }, holes);
  // cold store: painted render, a strip of blue, the name in faded paint, an insulated door
  face('stucco', -20, -12.75, 0.5, 5.0, rgb(0xaab0ac, 0.7), { wet: 0.6 });
  face('stucco', -20, -12.75, 0, 0.5, rgb(0x2a4a66, 0.8), { wet: 0.4 });
  A.sign('coldstore', [X + 0.004, 3.55, -13.4], [0, 0, -6.0], [0, 1.25, 0], { color: [0.09, 0.2, 0.34] });
  A.box('metal', [X, 0.06, -17.9], [X + 0.1, 2.45, -16.1], rgb(0x9a9ea2), { par: 0.35, bevel: 0.02 });
  for (const y of [0.5, 1.9]) A.box('metal', [X + 0.1, y, -17.86], [X + 0.14, y + 0.14, -17.6], rgb(0xc8ccd0));
  A.box('metal', [X + 0.1, 1.15, -16.5], [X + 0.2, 1.22, -16.2], rgb(0xc8ccd0));
  A.box('paint', [X, 0, -18.0], [X + 0.06, 2.55, -17.9], DARKC); A.box('paint', [X, 0, -16.1], [X + 0.06, 2.55, -16.0], DARKC); A.box('paint', [X, 2.45, -18.0], [X + 0.06, 2.55, -16.0], DARKC);
  A.box('concrete', [X, 0, -18.3], [X + 0.9, 0.1, -15.7], rgb(0x8a877f), { wet: 0.8, bevel: 0.02 });
  // its plant: a condenser on brackets, pipes down the wall, ice where it leaks
  A.box('metal', [X, 2.9, -15.2], [X + 0.6, 3.7, -13.9], STEELC, { par: 0.6, bevel: 0.02, shadow: true });
  for (let i = 0; i < 6; i++) A.box('paint', [X + 0.6, 2.98 + i * 0.11, -15.12], [X + 0.615, 3.03 + i * 0.11, -13.98], DARKC);
  for (const z of [-15.0, -14.1]) A.box('metal', [X, 2.82, z - 0.03], [X + 0.55, 2.9, z + 0.03], rgb(0x4a4d50));
  for (const z of [-14.3, -14.42]) A.add('metal', cyl(0.022, 0.022, 2.9, 6), { m: M(X + 0.05, 1.45, z), color: rgb(0x8a6a4a), par: 0.4 });
  A.sign('splat', [X + 0.006, 0.0, -14.9], [0, 0, 1.0], [0, 1.0, 0], { color: [0.5, 0.56, 0.6] });
  // tyre shed: ribbed sheet, a roller door that has not been up in a while, the name, stacks of tyres
  face('clad', -10.25, -2.0, 0.3, 5.0, rgb(0x7f4a3a, 0.7), { par: 1, wet: 0.5 });
  face('concrete', -10.25, -2.0, 0, 0.3, rgb(0x6a6862), { wet: 0.5 });
  A.sign('tyres', [X + 0.004, 3.6, -3.2], [0, 0, -4.6], [0, 1.15, 0], { color: [0.75, 0.7, 0.55] });
  A.box('paint', [X, 0, -9.1], [X + 0.08, 3.2, -8.95], DARKC); A.box('paint', [X, 0, -5.55], [X + 0.08, 3.2, -5.4], DARKC); A.box('metal', [X, 3.05, -9.1], [X + 0.3, 3.4, -5.4], rgb(0x5a5e60), { par: 0.5 });
  for (let y = 0.04; y < 3.04; y += 0.1) A.box('metal', [X, y, -8.95], [X + 0.035 + (Math.round(y * 10) % 2) * 0.012, y + 0.09, -5.55], rgb(0x6f7472), { par: 0.55 });
  A.box('paint', [X + 0.03, 0.0, -8.95], [X + 0.07, 0.1, -5.55], rgb(0xc9a416), { par: 1 });
  A.sign('scrawl', [X + 0.056, 1.2, -6.0], [0, 0, -2.4], [0, 0.86, 0], { color: [0.7, 0.68, 0.6], sub: [0, 0.55, 1, 1] });
  for (const [z, n, lean] of [[-4.55, 4, 0.02], [-3.75, 3, -0.03], [-9.7, 2, 0.0]]) {
    for (let i = 0; i < n; i++) A.add('vinyl', torus(0.24, 0.115, 7, 14).rotateX(Math.PI / 2), { m: M(X + 0.4 + (i % 2) * 0.03, 0.115 + i * 0.225, z + i * lean, 0, 0, 0), color: rgb(0x0e0e0f) });
    B.tag('motel:tyres', () => B.collide([26.62, 0, z - 0.36], [27.38, n * 0.225 + 0.01, z + 0.36], 'cloth'));
  }
  A.detail(() => {
    A.add('vinyl', torus(0.24, 0.115, 7, 14), { m: M(X + 0.14, 0.36, -2.9, 0, Math.PI / 2, 0.2), color: rgb(0x0e0e0f) });
    A.add('vinyl', torus(0.24, 0.115, 7, 14).rotateX(Math.PI / 2), { m: M(X + 1.3, 0.115, -4.2), color: rgb(0x0e0e0f) });
    for (let i = 0; i < 5; i++) A.sign('splat', [X + 0.3 + rng.range(0, 1.2), 0.008, -8.6 + i * 0.7], [0.5 + rng.range(0, 0.5), 0, 0], [0, 0, -0.5 - rng.range(0, 0.4)], { color: [0.012, 0.012, 0.014], par: 1 });
  });
  // goose-neck lamps over the two names
  for (const z of [-16.4, -6.2]) {
    A.add('metal', cyl(0.018, 0.018, 0.75, 6).rotateZ(Math.PI / 2), { m: M(X + 0.37, 4.95, z), color: rgb(0x2a2c2e) });
    A.add('paint', cylUp(0.2, 0.05, 0.14, 12), { m: M(X + 0.8, 4.8, z), color: rgb(0x1d4a44), par: 1 });
    A.add('glow', sphere(0.06, 8, 6), { m: M(X + 0.8, 4.79, z), color: [0.4, 0.34, 0.22], glow: [22, 15, 7], power: true });
  }
  // the roller box over the alley gate, hazard stripes on its lip; the parapet's coping
  A.box('metal', [26.75, 3.0, -12.75], [26.79, 5.0, -10.25], rgb(0x5a5e60), { par: 0.6 });
  for (let i = 0; i < 10; i++) A.box('paint', [26.79, 3.0, -12.75 + i * 0.25], [26.8, 3.16, -12.5 + i * 0.25], i % 2 ? rgb(0xc9a416) : DARKC, { par: 1 });
  A.box('metal', [26.5, 5.2, -20], [26.68, 5.26, -2.0], STEELC, { par: 0.5 });
  for (const z of [-19.6, -11.0, -2.4]) A.add('metal', cyl(0.05, 0.05, 5.0, 8), { m: M(X + 0.06, 2.6, z), color: rgb(0x4a4d50), par: 0.5 });
}

// The two stairs, in the art mesh over the shell's steps so the lamps under the walkway and the
// battery lights reach them: concrete treads and risers, the closed sides under the rails.
function stairArt(A, W) {
  const CONC = rgb(0x8f8c84), SIDE = rgb(0x7a776f);
  for (const id of ['s-west', 's-east']) {
    const steps = W.structure.filter((s) => s.kind === 'stair' && s.stair === id);
    let prev = 0;
    for (const s of steps) {
      const [x0, , z0] = s.min, [x1, y1, z1] = s.max;
      if (id === 's-west') {
        A.quad('concrete', [x0, y1 + 0.003, z1], [x1 - x0 + 0.012, 0, 0], [0, 0, z0 - z1], CONC, { wet: 0.5, cell: 0.7 });
        A.quad('concrete', [x1 + 0.013, prev, z1], [0, 0, z0 - z1], [0, y1 - prev, 0], SIDE, { cell: 0.7 });
        A.quad('concrete', [x0, 0, -34.985], [x1 - x0, 0, 0], [0, y1, 0], SIDE, { cell: 0.8, wet: 0.2 });
        A.quad('concrete', [x1, 0, z0 - 0.012], [x0 - x1, 0, 0], [0, y1, 0], SIDE, { cell: 0.8 });
      } else {
        A.quad('concrete', [x0, y1 + 0.003, z1 + 0.012], [x1 - x0, 0, 0], [0, 0, z0 - z1 - 0.012], CONC, { wet: 0.8, cell: 0.7 });
        A.quad('concrete', [x0, prev, z1 + 0.013], [x1 - x0, 0, 0], [0, y1 - prev, 0], SIDE, { cell: 0.7 });
        A.quad('concrete', [58.285, 0, z0], [0, 0, z1 - z0], [0, y1, 0], SIDE, { cell: 0.8, wet: 0.2 });
        A.quad('concrete', [60.115, 0, z1], [0, 0, z0 - z1], [0, y1, 0], SIDE, { cell: 0.8, wet: 0.2 });
      }
      prev = y1;
    }
  }
}

// The office behind its counter desk (the desk is the searchable): blinds with the lot's lamp behind
// them, the night clerk's chair gone over, a cabinet with its drawers out, what guests waited with.
function officeDressing(A, B, Wd, H, rng) {
  const BRASS = rgb(0xb89a48), DARKC = rgb(0x141412), STEELC = rgb(0x8a8e92);
  // the front window from inside: its frame, the lamp-lit night behind venetian blinds, some bent
  {
    const a = 0.5, b = 2.7, y0 = 0.9, y1 = 2.05, z = -0.312;
    A.quad('glow', [b, y0, z - 0.004], [a - b, 0, 0], [0, y1 - y0, 0], [0.02, 0.012, 0.004], { cell: 9, glow: [1.5, 0.72, 0.13] });
    for (let i = 0; i < 21; i++) {
      const y = y0 + 0.03 + i * 0.053, bent = i === 7 || i === 8 || i === 13;
      A.box('paint', [a + 0.01, y, z - 0.03], [b - 0.01, y + 0.036, z - 0.022], rgb(0xb9b4a0), { rx: bent ? 0.9 : 0.35, rz: bent ? (i - 9) * 0.012 : 0 });
    }
    for (const [x0, x1, ya, yb] of [[a - 0.06, b + 0.06, y0 - 0.06, y0], [a - 0.06, b + 0.06, y1, y1 + 0.06], [a - 0.06, a, y0, y1], [b, b + 0.06, y0, y1]]) A.box('paint', [x0, ya, z - 0.05], [x1, yb, z], rgb(0xbdb39a), { par: 1 });
    A.box('paint', [a - 0.1, y0 - 0.1, z - 0.14], [b + 0.1, y0 - 0.06, z], rgb(0xbdb39a), { par: 1 });
    A.add('paint', cyl(0.004, 0.004, 1.0, 4), { m: M(b - 0.08, 1.5, z - 0.05), color: rgb(0xd8d4c6) });
  }
  // a rug in front of the desk, the clerk's chair on its back behind it, blood from there to the door
  A.quad('carpet', [1.0, 0.007, -1.5], [2.4, 0, 0], [0, 0, -1.7], rgb(0x5a1f1a), { par: 1, cell: 0.4 });
  B.at(M(1.9, 0, -5.05, 0, 0.4, 0), () => {
    A.box('vinyl', [-0.26, 0.02, -0.3], [0.26, 0.12, 0.26], rgb(0x1c1a18), { bevel: 0.04 });
    A.box('vinyl', [-0.24, 0.02, 0.26], [0.24, 0.5, 0.36], rgb(0x1c1a18), { bevel: 0.04 });
    A.add('metal', cyl(0.025, 0.025, 0.4, 8).rotateX(Math.PI / 2), { m: M(0, 0.3, -0.48), color: STEELC });
    for (let i = 0; i < 5; i++) A.box('metal', [-0.012, 0.3, -0.7], [0.012, 0.56, -0.67], STEELC, { rz: i * 1.2566 });
    B.tag('motel:office', () => B.collide([-0.3, 0, -0.72], [0.3, 0.52, 0.38], 'cloth'));
  });
  // filing cabinet in the corner, the top drawer out and rifled
  B.at(M(Wd - 0.33, 0, -5.38), () => {
    A.box('metal', [-0.26, 0, -0.3], [0.26, 1.34, 0.3], rgb(0x5a6468), { par: 0.3, bevel: 0.012, shadow: true });
    for (let i = 0; i < 4; i++) { const out = i === 3 ? 0.3 : i === 1 ? 0.06 : 0; A.box('metal', [-0.24, 0.05 + i * 0.32, 0.3 + out - 0.3 * (out > 0.1 ? 1 : 0)], [0.24, 0.34 + i * 0.32, 0.31 + out], rgb(0x66717a), { par: 0.3 }); A.box('metal', [-0.07, 0.22 + i * 0.32, 0.31 + out], [0.07, 0.24 + i * 0.32, 0.335 + out], rgb(0xc8ccd0)); }
    A.box('paint', [-0.2, 1.3, 0.32], [0.2, 1.33, 0.58], rgb(0xb9a878), { rz: 0.04 });
    B.tag('motel:office', () => B.collide([-0.26, 0, -0.3], [0.26, 1.34, 0.32], 'metal'));
  });
  // on the desk: the lamp, the telephone off its hook, the bell
  B.at(M(2.1, 0.8, -3.9), () => {
    A.add('metal', cylUp(0.07, 0.085, 0.02, 12), { m: M(0.45, 0, -0.12), color: BRASS });
    A.add('metal', cylUp(0.01, 0.01, 0.2, 6), { m: M(0.45, 0.02, -0.12), color: BRASS });
    A.add('paint', cyl(0.045, 0.045, 0.26, 10, true).rotateZ(Math.PI / 2), { m: M(0.45, 0.24, -0.1), color: rgb(0x1a5a2a), par: 1 });
    A.box('glow', [0.33, 0.2, -0.13], [0.57, 0.215, -0.07], [0.3, 0.4, 0.25], { glow: [5, 9, 4], power: true });
    A.box('paint', [-0.55, 0, -0.15], [-0.33, 0.07, 0.05], rgb(0x101010), { par: 1, bevel: 0.015 });
    A.add('paint', cyl(0.022, 0.022, 0.2, 6).rotateZ(Math.PI / 2), { m: M(-0.2, 0.025, 0.16, 0, 0.5, 0), color: rgb(0x101010), par: 1 });
    A.detail(() => { for (let i = 0; i < 4; i++) A.sign('ticket', [-0.15 + i * 0.13, 0.004 + i * 0.001, -0.2 + (i % 2) * 0.08], [0.12, 0, 0.03], [-0.03, 0, -0.2]); });
  });
  A.detail(() => {
    // pigeonholes for mail and keys over the key board's side, a dead plant, the water cooler, cards in a rack
    B.at(M(3.3, 1.15, -5.688), () => {
      A.box('wood', [0, 0, 0], [0.9, 0.9, 0.16], rgb(0x4a3020), { par: 0 });
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { A.box('paint', [0.03 + c * 0.215, 0.03 + r * 0.215, 0.16], [0.225 + c * 0.215, 0.225 + r * 0.215, 0.163], rgb(0x0a0806)); if ((r * 5 + c * 3) % 4 === 0) A.box('paint', [0.06 + c * 0.215, 0.04 + r * 0.215, 0.1], [0.2 + c * 0.215, 0.06 + r * 0.215, 0.17], rgb(0xd8d4c6)); }
    });
    A.add('paint', cylUp(0.16, 0.12, 0.3, 10), { m: M(0.3, 0, -2.6), color: rgb(0x7a3a22) });
    for (let i = 0; i < 7; i++) A.add('wood', cyl(0.006, 0.01, 0.7 + 0.3 * rng.next(), 4), { m: M(0.3, 0.6, -2.6, rng.range(-0.35, 0.35), 0, rng.range(-0.35, 0.35)), color: rgb(0x5a4a22) });
    A.box('paint', [0.05, 0, -3.75], [0.4, 0.95, -3.4], rgb(0xcfcabb), { par: 1, bevel: 0.02 });
    A.add('paint', cylUp(0.14, 0.14, 0.4, 12), { m: M(0.225, 0.95, -3.575), color: rgb(0x3a6a8a), par: 1 });
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) A.box('paint', [Wd - 0.06, 0.9 + r * 0.26, -1.3 + c * 0.2], [Wd - 0.03, 1.1 + r * 0.26, -1.14 + c * 0.2], rgb([0xc8281c, 0xe8b023, 0x1f4fa6, 0x2c8a43, 0xf0ece0][(r * 3 + c) % 5], 0.8), { rz: -0.12 });
    A.sign('clock', [0.016, 2.0, -3.1], [0, 0, -0.42], [0, 0.42, 0]);
    A.sign('smear', [2.3, 0.009, -4.9], [1.5, 0, 2.9], [0.32, 0, -0.14], { color: [0.07, 0.004, 0.003], par: 1 });
    A.sign('splat', [1.5, 0.009, -4.6], [1.3, 0, 0], [0, 0, -1.0], { color: [0.12, 0.006, 0.005], par: 1 });
    A.sign('hand', [Wd - 0.016, 1.1, -0.75], [0, 0, 0.2], [0, 0.25, 0], { color: [0.14, 0.007, 0.005], par: 1 });
    A.sign('hand', [1.2, 0.86, -3.57], [0.14, 0, 0], [0, 0.0, -0.18], { color: [0.14, 0.007, 0.005], par: 1 });
  });
  B.tag('motel:office', () => B.collide([0.05, 0, -3.75], [0.4, 1.35, -3.4], 'metal'));
  void H; void DARKC;
}

// Beyond the edge: the road in from the west, jammed for a long way back, and the thicket behind the
// north wing that the dead come out of. Nobody can reach any of it: no colliders.
function beyond(B, rng) {
  B.inZone('shell', () => {
    const car = (id, x, z, yaw, o) => B.at(M(x, 0, z, 0, yaw, 0), () => buildCar(B, { id: `motel-${id}`, noCollide: true, far: true, ...o }));
    car('jam1', 22.2, -33.5, 0.12, { type: 'sedan', colour: 3 });
    car('jam2', 21.6, -36.3, Math.PI - 0.2, { type: 'pickup', colour: 1 });
    car('jam3', 16.2, -34.9, 0.05, { type: 'wagon', colour: 4 });
  });
  B.inZone('forecourt', () => { // in the bucket the forecourt's own brush is in (always drawn, like the tree line): no draw call of its own
    // the thicket hard against the north wing's back wall: brush and long grass to the sills, young
    // firs behind, thickest round the two windows they climb in by
    const tr = rng.fork('thicket');
    for (let x = 28; x < 65.5; x += 1.9) {
      const near = Math.min(Math.abs(x - 41.5), Math.abs(x - 51.5)) < 3.2;
      const sx = x + tr.range(-0.6, 0.6);
      B.add('uvFoliage', shrubGeometry(tr, tr.range(1.0, 1.9)), { m: M(sx, -0.05, -45.1 - tr.range(0, 1.4), 0, tr.range(0, 3), 0) });
      if (near) B.add('uvFoliage', shrubGeometry(tr, tr.range(0.8, 1.3)), { m: M(sx + 0.9, -0.05, -44.7 - tr.range(0, 0.5), 0, tr.range(0, 3), 0) });
      for (let k = 0; k < 2; k++) B.add('uvFoliage', grassGeometry(tr, tr.range(0.8, 1.4), true), { m: M(sx + tr.range(-0.9, 0.9), -0.02, -44.4 - tr.range(0, 1.2), 0, tr.range(0, 3), 0) });
    }
    for (let x = 29; x < 66; x += 4.3) B.add('uvFoliage', treeGeometry(tr.fork(`t${x}`), x % 2 > 1 ? 'A' : 'B', tr.range(7, 11), false), { m: M(x + tr.range(-1, 1), -0.3, -47.6 - tr.range(0, 2.5), tr.range(-0.03, 0.03), 0, tr.range(-0.03, 0.03)) });
  });
}

function fittingO(A, x, H, z) {
  A.box('paint', [x - 0.68, H - 0.08, z - 0.16], [x + 0.68, H, z + 0.16], rgb(0xc8c4b4), { par: 1 });
  for (const dz of [-0.07, 0.07]) A.add('glow', cyl(0.018, 0.018, 1.22, 6).rotateZ(Math.PI / 2), { m: M(x, H - 0.1, z + dz), color: [0.4, 0.42, 0.4], glow: TUBE_GLOW, power: true });
}

export { cylUp };
