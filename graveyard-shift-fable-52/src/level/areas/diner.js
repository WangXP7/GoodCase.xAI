// Mae's diner: the room behind the forecourt's boarded front. A counter to circle with
// stools, booths under the front windows, the kitchen through the divider with its shuttered pass,
// the back door to the motel lot. One tube over the counter still stutters without the power;
// everything else (the other tubes, the pendants, the neon, the menu board, the jukebox) is dead
// until the switch in the garage is thrown. Zombies come in through the four boarded rear windows:
// the floor inside each is kept clear.
//
// Structure, doors, windows and every fixed position are worldLayout's. The shell draws
// the structure boxes; everything else is one art mesh (mats/interior.js) in the zone's group.
import { createRng } from '../../core/rng.js';
import { M, box, cyl, cylUp, lathe, rgb, sphere, torus, tube } from '../build.js';
import { createArt, LIGHT } from '../../mats/interior.js';
import { shellStructure } from '../props/stairs.js';
import { buildBooth, buildStool } from '../props/booth.js';
import { buildCounter } from '../props/counter.js';
import { buildKitchen, buildStandIn, passHatch } from '../props/kitchen.js';
import { boardWindow } from '../props/boards.js';
import { buildBarrier } from '../props/barrier.js';

const X0 = 7.3, X1 = 26.3, ZB = -31.7, ZF = -20.3, DIV = 20, CEIL = 3.5;
const CHROME = rgb(0xb9bec2);
const CREAM = rgb(0xcfc4a2), TEAL = rgb(0x1d5a52), RED = rgb(0x8f1c16), DARK = rgb(0x121210);
const TUBE_GLOW = [0.8 * 24, 1.0 * 24, 0.9 * 24];

export function buildDiner(B, W) {
  const rng = createRng(1107).fork('diner');
  const A = createArt(B, 'diner');
  A.rng = rng;
  const pp = B.prepass;
  B.prepass = null; // nothing here is drawn through the costly forecourt materials
  try {
    const counter = W.structure.find((s) => s.zone === 'diner' && s.kind === 'table' && s.min[0] < 15);
    const prep = W.structure.find((s) => s.zone === 'diner' && s.kind === 'table' && s.min[0] > 20);
    shellStructure(B, W, 'diner', { wall: rgb(0x6f6a5e, 0.6), roof: rgb(0x2a2a2c, 0.6) }, (s) => s.kind === 'table');
    B.rainOccluders.push({ min: [7, 3.55, -32], max: [26.6, 3.85, -20.3] }); // the facade's roof slab keeps no rain off by itself
    const wins = W.windows.filter((w) => w.zone === 'diner');
    const holes = wins.map((w) => ({ a: w.pos[0] - w.w / 2, b: w.pos[0] + w.w / 2, y0: w.sill, y1: w.head }));
    const d1 = W.doors.find((d) => d.id === 'd1'), d2 = W.doors.find((d) => d.id === 'd2');
    const till = W.searchables.find((s) => s.id === 's-till');

    // ---- the dining room ------------------------------------------------------------------------
    A.room('dining');
    // Without the power: one failing tube over the counter, the exit sign on its battery, the
    // forecourt's light through the gaps in the front boards and the night through the rear ones.
    const fx = W.fixtures.find((f) => f.zone === 'diner' && !f.needsPower);
    A.light({ pos: fx.pos, lm: 800, fx: true, range: 7.5, flicker: { amount: 0.7, speed: 2.4, kind: 'stutter' }, priority: 1.2, amb: 0.001 });
    A.light({ pos: [d1.pos[0], 2.85, ZF - 0.25], lm: 60, color: LIGHT.red, amb: 0.003 }); // the exit sign runs on its battery
    const tubes = [[9.6, -23.4, 1], [17.2, -23.2, 1], [9.6, -29.3, 0], [17.2, -29.3, 1]]; // x, z, alive
    const booths = [[9.2, 'meal'], [15.3, 'blood'], [17.5, 'meal']];
    for (const [x] of booths) A.light({ pos: [x, 1.75, ZF - 0.12], lm: 130, color: LIGHT.tube, amb: 0, r0: 0.5, reach: 6 });
    for (const q of wins) if (q.pos[0] < DIV) A.light({ pos: [q.pos[0], 1.6, ZB + 0.1], lm: 70, color: LIGHT.moon, amb: 0, r0: 0.5, reach: 6 });
    // With it: every tube, the pendants over the booths, the neon, the menu board, the jukebox.
    for (const [x, z, alive] of tubes) if (alive) A.light({ pos: [x, 3.36, z], lm: 2500, power: true, amb: 0.004 });
    A.light({ pos: [13.5, 3.36, -26.4], lm: 2200, power: true, amb: 0.004 }); // the counter's tube steadies
    for (const [x] of booths) A.light({ pos: [x, 2.1, ZF - 0.55], lm: 520, color: LIGHT.warm, power: true, down: 0.9, amb: 0.003 });
    A.light({ pos: [17.4, 2.75, ZF - 0.3], lm: 420, color: LIGHT.pink, power: true, amb: 0.004 });
    A.light({ pos: [9.2, 2.75, ZF - 0.3], lm: 380, color: LIGHT.teal, power: true, amb: 0.004 });
    A.light({ pos: [14, 2.8, -25.9], lm: 1100, power: true, amb: 0.004 });
    A.light({ pos: [8.1, 1.2, -23.6], lm: 420, color: LIGHT.amber, power: true, amb: 0.002 });

    // floor: teal and cream checks, water tracked in from the door and blown in under the boards
    const wetAt = (x, y, z) => {
      let w = Math.max(0, 1 - Math.hypot(x - d1.pos[0], z - ZF) / 5.5);
      for (const q of wins) w = Math.max(w, 1 - Math.hypot(x - q.pos[0], z - ZB) / 2.2);
      return Math.min(1, Math.max(0, w));
    };
    A.quad('tile', [X0, 0.004, ZF], [DIV - X0, 0, 0], [0, 0, ZB - ZF], TEAL, { wetAt, cell: 0.2, ao: true });
    A.quad('metal', [DIV, 0.006, -23.65], [0.3, 0, 0], [0, 0, -1.2], rgb(0x8a8e92));
    A.quad('ceiling', [X0, CEIL, ZB], [X1 - X0, 0, 0], [0, 0, ZF - ZB], rgb(0xbdb6a0), { cell: 0.8 });
    // walls: gloss teal boarding to the chrome rail, cream plaster above
    const wallSet = (face, c, a0, a1, hs) => {
      A.wall('paint', face, c, a0, a1, 0, 1.0, rgb(0x1a4a44), { par: 1, ao: true, cell: 0.25 }, hs);
      A.wall('plaster', face, c, a0, a1, 1.0, CEIL, CREAM, { ao: true, cell: 0.4 }, hs);
    };
    wallSet('+x', X0 + 0.012, ZB, ZF);
    wallSet('+z', ZB + 0.012, X0, DIV, holes);
    wallSet('-z', ZF - 0.012, X0, DIV, [{ a: d1.rect.x0, b: d1.rect.x1, y0: 0, y1: d1.h }]);
    wallSet('-x', DIV - 0.012, ZB, ZF, [{ a: -24.85, b: -23.65, y0: 0, y1: 2.2 }]);
    A.add('metal', cyl(0.018, 0.018, ZF - ZB, 6).rotateX(Math.PI / 2), { m: M(X0 + 0.03, 1.02, (ZB + ZF) / 2), color: CHROME });
    A.box('metal', [X0, 1.0, ZB + 0.012], [DIV, 1.04, ZB + 0.03], CHROME);
    A.box('metal', [X0, 1.0, ZF - 0.03], [d1.rect.x0, 1.04, ZF - 0.012], CHROME);
    A.box('metal', [d1.rect.x1, 1.0, ZF - 0.03], [DIV, 1.04, ZF - 0.012], CHROME);
    // the front door's frame from inside, and the kitchen doorway's
    for (const x of [d1.rect.x0, d1.rect.x1]) A.box('metal', [x - 0.05, 0, ZF - 0.05], [x + 0.05, d1.h, ZF + 0.02], CHROME, { bevel: 0.015 });
    A.box('metal', [d1.rect.x0 - 0.05, d1.h, ZF - 0.05], [d1.rect.x1 + 0.05, d1.h + 0.1, ZF + 0.02], CHROME, { bevel: 0.015 });
    A.sign('exit', [d1.pos[0] + 0.22, d1.h + 0.16, ZF - 0.03], [-0.44, 0, 0], [0, 0.22, 0], { glow: [7, 0.6, 0.35], color: [0.4, 0.4, 0.4] });
    for (const z of [-24.85, -23.65]) A.box('paint', [DIV - 0.03, 0, z - 0.04], [DIV + 0.33, 2.2, z + 0.04], rgb(0x2a2420), { par: 1 });
    A.box('paint', [DIV - 0.03, 2.2, -24.89], [DIV + 0.33, 2.28, -23.61], rgb(0x2a2420), { par: 1 });
    // the swing door, pushed back against the dining side of the wall, its porthole dark
    A.box('paint', [DIV - 0.075, 0.08, -23.6], [DIV - 0.03, 2.1, -22.5], rgb(0x6a2a20), { par: 1 });
    A.add('metal', cyl(0.2, 0.2, 0.012, 16).rotateZ(Math.PI / 2), { m: M(DIV - 0.08, 1.5, -23.05), color: CHROME });
    A.add('paint', cyl(0.16, 0.16, 0.014, 16).rotateZ(Math.PI / 2), { m: M(DIV - 0.082, 1.5, -23.05), color: rgb(0x050607), par: 1 });
    A.box('metal', [DIV - 0.085, 0.08, -23.6], [DIV - 0.075, 0.5, -22.5], CHROME);

    // front windows from inside: glass over the backs of the boards, light leaking between them
    for (const [x] of booths) {
      const w = 1.9, y0 = 1.2, y1 = 2.35, z = ZF - 0.014;
      A.quad('paint', [x + w / 2, y0, z], [-w, 0, 0], [0, y1 - y0, 0], rgb(0x040506), { cell: 9, lit: 0.2, par: 1 });
      // what shows between the boards nailed up outside: the forecourt's light, in wedges, never in even lines
      A.quad('glow', [x + w / 2, y0, z - 0.002], [-w, 0, 0], [0, y1 - y0, 0], DARK, { cell: 9, glow: [0.5, 0.62, 0.55] });
      let ya = y0 - 0.02;
      for (let i = 0; ya < y1 - 0.02; i++) {
        const bh = rng.range(0.15, 0.27), tilt = rng.range(-0.035, 0.035), gap = i % 3 === 1 ? rng.range(0.012, 0.03) : rng.range(0.0, 0.008);
        A.box('wood', [x - w / 2 - 0.03, ya, z - 0.014], [x + w / 2 + 0.03, Math.min(y1 + 0.02, ya + bh), z - 0.004], rgb([0x3a2c1c, 0x4a3826, 0x2e2418][i % 3], 0.6), { par: 0, lit: 0.5, rz: tilt });
        ya += bh + gap;
      }
      A.box('wood', [x - 0.75, y0 + 0.5, z - 0.02], [x + 0.75, y0 + 0.66, z - 0.012], rgb(0x33271a, 0.6), { par: 0, lit: 0.5, rz: i3(x) });
      A.glass([x + w / 2, y0, z - 0.03], [-w, 0, 0], [0, y1 - y0, 0]);
      for (const [fx0, fx1, fy0, fy1] of [[-w / 2 - 0.05, w / 2 + 0.05, y0 - 0.05, y0], [-w / 2 - 0.05, w / 2 + 0.05, y1, y1 + 0.05], [-w / 2 - 0.05, -w / 2, y0, y1], [w / 2, w / 2 + 0.05, y0, y1], [-0.02, 0.02, y0, y1]]) A.box('metal', [x + fx0, fy0, z - 0.04], [x + fx1, fy1, z], CHROME);
      A.box('laminate', [x - w / 2 - 0.08, y0 - 0.08, z - 0.12], [x + w / 2 + 0.08, y0 - 0.05, z], rgb(0xb9b09a));
    }
    // rear windows: frames round the openings the boards cover from outside, slats of the blinds
    for (const q of wins) {
      if (q.pos[0] > DIV) continue;
      const a = q.pos[0] - q.w / 2, b = q.pos[0] + q.w / 2, z = ZB + 0.012;
      for (const [fx0, fx1, fy0, fy1] of [[a - 0.06, b + 0.06, q.sill - 0.06, q.sill], [a - 0.06, b + 0.06, q.head, q.head + 0.06], [a - 0.06, a, q.sill, q.head], [b, b + 0.06, q.sill, q.head]]) A.box('metal', [fx0, fy0, z - 0.05], [fx1, fy1, z + 0.03], CHROME);
      A.box('laminate', [a - 0.08, q.sill - 0.09, z], [b + 0.08, q.sill - 0.06, z + 0.12], rgb(0xb9b09a));
      A.glass([a, q.sill, z + 0.008], [q.w, 0, 0], [0, q.head - q.sill, 0], { broken: true }); // they came through it
      A.detail(() => {
        for (let i = 0; i < 4; i++) A.box('paint', [a + 0.02, q.head - 0.05 - i * 0.045, z - 0.03], [b - 0.02, q.head - 0.046 - i * 0.045, z + 0.0], rgb(0x9a947e), { rz: (rng.next() - 0.5) * 0.03 });
        A.box('paint', [a + 0.1, q.head - 0.9, z - 0.02], [a + 0.9, q.head - 0.895, z + 0.01], rgb(0x9a947e), { rz: -0.6 });
        for (let i = 0; i < 9; i++) { const sx = a + rng.range(-0.2, q.w + 0.2), sz = z + rng.range(0.15, 1.0); A.box('paint', [sx, 0.006, sz], [sx + rng.range(0.03, 0.1), 0.009, sz + rng.range(0.03, 0.08)], rgb(0x9fb0b0), { par: 1, ry: rng.range(0, 3) }); }
      });
    }

    // counter, stools, booths
    buildCounter(A, counter, { till, menu: true });
    const zs = counter.max[2] + 0.36;
    [[12.0, 0], [12.75, 0.2], [15.05, 0], [15.8, -0.15], [16.2, 9]].forEach(([x, tilt]) => {
      if (tilt === 9) return;
      B.at(M(x, 0, zs), () => buildStool(A, { tilt }));
    });
    booths.forEach(([x, table], i) => B.at(M(x, 0, ZF - 0.012, 0, Math.PI, 0), () => buildBooth(A, { table, lamp: true, rng, vinyl: i === 1 ? rgb(0x7a1814) : RED })));

    // ceiling: tube fittings (one alive without power, one dead for good), two fans
    const fitting = (x, z, state) => {
      A.box('paint', [x - 0.68, 3.42, z - 0.16], [x + 0.68, CEIL, z + 0.16], rgb(0xc8c4b4), { par: 1 });
      for (const dz of [-0.07, 0.07]) {
        const g = cyl(0.018, 0.018, 1.22, 6).rotateZ(Math.PI / 2);
        if (state === 'dead') A.add('paint', g, { m: M(x, 3.4, z + dz), color: rgb(0x55584f), par: 1 });
        else A.add('glow', g, { m: M(x, 3.4, z + dz), color: [0.4, 0.42, 0.4], glow: TUBE_GLOW, power: state === 'power' });
      }
    };
    fitting(fx.pos[0], fx.pos[2], 'always');
    for (const [x, z, alive] of tubes) fitting(x, z, alive ? 'power' : 'dead');
    A.detail(() => {
      for (const [x, z] of [[10.4, -26.3], [17.6, -26.3]]) {
        A.add('paint', cyl(0.02, 0.02, 0.35, 6), { m: M(x, CEIL - 0.17, z), color: DARK });
        A.add('paint', cylUp(0.1, 0.08, 0.12, 10), { m: M(x, CEIL - 0.45, z), color: rgb(0x3a3630), par: 1 });
        for (let i = 0; i < 4; i++) B.at(M(x, CEIL - 0.4, z, 0, 0.4 + i * Math.PI / 2, 0), () => A.box('wood', [0.08, -0.008, -0.07], [0.78, 0.008, 0.07], rgb(0x3a2a1c), { par: 0, rz: -0.06 }));
      }
    });

    // west wall: the jukebox, the specials' frame is on the menu; a clock, pictures
    B.at(M(X0 + 0.02, 0, -23.6, 0, Math.PI / 2, 0), () => {
      A.box('wood', [-0.43, 0, 0], [0.43, 1.0, 0.56], rgb(0x4a2a18), { par: 2, shadow: true });
      A.add('wood', cyl(0.43, 0.43, 0.56, 16, false).rotateX(Math.PI / 2), { m: M(0, 1.0, 0.28), color: rgb(0x4a2a18), par: 2 });
      A.sign('juke', [-0.4, 0.06, 0.565], [0.8, 0, 0], [0, 1.34, 0], { glow: [2.2, 1.6, 1.0], power: true, color: [0.35, 0.35, 0.35] });
      A.box('metal', [-0.45, 0, 0.5], [0.45, 0.06, 0.6], CHROME);
      B.tag('diner:jukebox', () => B.collide([-0.43, 0, 0], [0.43, 1.43, 0.58], 'cloth'));
    });
    A.sign('clock', [X0 + 0.02, 2.5, -24.95], [0, 0, -0.5], [0, 0.5, 0]);
    A.sign('art1', [X0 + 0.02, 1.7, -27.9], [0, 0, -0.8], [0, 0.6, 0]);
    A.sign('calendar', [X0 + 0.02, 1.5, -29.6], [0, 0, -0.4], [0, 0.55, 0]);
    // front wall: neon in the windows' piers, dead until the power is on
    A.box('paint', [16.72, 2.52, ZF - 0.05], [18.08, 3.08, ZF - 0.02], DARK);
    A.sign('pie', [18.05, 2.55, ZF - 0.052], [-1.3, 0, 0], [0, 0.52, 0], { glow: [5, 0.9, 2.2], power: true, color: [0.12, 0.12, 0.12] });
    A.box('paint', [8.52, 2.52, ZF - 0.05], [9.88, 3.08, ZF - 0.02], DARK);
    A.sign('coffee', [9.85, 2.55, ZF - 0.052], [-1.3, 0, 0], [0, 0.52, 0], { glow: [0.6, 4.6, 3.6], power: true, color: [0.12, 0.12, 0.12] });
    // divider: the shuttered pass, pictures
    passHatch(A, DIV, -1, -29.0, -26.2);
    A.sign('art2', [DIV - 0.02, 1.75, -22.2], [0, 0, 0.8], [0, 0.6, 0]);
    A.sign('art3', [DIV - 0.02, 2.2, -30.6], [0, 0, 0.5], [0, 0.67, 0]);
    // back wall between the windows: a dead pie case, coat hooks
    B.at(M(12.5, 0, ZB + 0.012), () => {
      A.box('metal', [-0.6, 0, 0], [0.6, 0.5, 0.56], rgb(0x8a8e92), { shadow: true });
      A.box('paint', [-0.58, 0.5, 0.02], [0.58, 1.45, 0.06], rgb(0x1a1c1c));
      for (const y of [0.5, 0.82, 1.14, 1.45]) A.box('metal', [-0.6, y, 0], [0.6, y + 0.02, 0.56], CHROME);
      for (const x of [-0.59, 0.59]) for (const z of [0.02, 0.54]) A.box('metal', [x - 0.012, 0.5, z - 0.012], [x + 0.012, 1.45, z + 0.012], CHROME);
      A.box('glow', [-0.56, 1.42, 0.08], [0.56, 1.44, 0.14], [0.3, 0.3, 0.3], { glow: [7, 8.5, 8], power: true });
      A.detail(() => { for (const [px, y] of [[-0.3, 0.52], [0.25, 0.84], [-0.1, 1.16]]) A.add('paint', cylUp(0.14, 0.15, 0.045, 12), { m: M(px, y + 0.02, 0.3), color: rgb(0x7a4a1c) }); });
      B.tag('diner:piecase', () => B.collide([-0.6, 0, 0], [0.6, 1.47, 0.56], 'glass'));
    });
    A.detail(() => {
      A.box('wood', [15.6, 1.65, ZB + 0.012], [16.9, 1.75, ZB + 0.035], rgb(0x4a3020), { par: 0 });
      for (let i = 0; i < 5; i++) A.add('metal', cyl(0.008, 0.008, 0.07, 5).rotateX(1.2), { m: M(15.75 + i * 0.25, 1.68, ZB + 0.06), color: CHROME });
      A.box('curtain', [16.15, 1.0, ZB + 0.04], [16.5, 1.68, ZB + 0.1], rgb(0x3a4a3a), { bevel: 0.03 });
      // please seat yourself, on its stand by the door; the wet-floor board, knocked flat
      A.add('metal', cylUp(0.015, 0.015, 1.2, 6), { m: M(13.85, 0, -22.0), color: CHROME });
      A.add('metal', cylUp(0.16, 0.18, 0.02, 12), { m: M(13.85, 0, -22.0), color: CHROME });
      A.sign('wait', [13.65, 1.05, -22.0], [0.4, 0, 0.12], [0, 0.52, 0]);
      A.sign('wetfloor', [10.3, 0.012, -22.4], [0.36, 0, 0.2], [-0.25, 0, 0.45]);
      // boot prints in from the door, a dragged smear from the second booth to the kitchen
      for (let i = 0; i < 11; i++) {
        const t = i / 10, px = d1.pos[0] + 0.2 * (i % 2 ? 1 : -1) + t * 1.0, pz = ZF - 0.5 - t * 4.4;
        A.sign('boot', [px - 0.06, 0.008, pz + 0.14], [0.12, 0, 0.02], [0.02, 0, -0.29], { color: [0.02, 0.022, 0.02], par: 1 });
      }
      A.sign('smear', [15.6, 0.009, -22.2], [3.6, 0, -1.3], [0.4, 0, 1.1], { color: [0.13, 0.007, 0.005], par: 1 });
      A.sign('smear', [19.0, 0.009, -23.7], [1.6, 0, -0.2], [0.1, 0, 0.8], { color: [0.13, 0.007, 0.005], par: 1 });
      A.sign('splat', [14.0, 0.009, -30.0], [1.3, 0, 0], [0, 0, -1.3], { color: [0.12, 0.006, 0.005], par: 1 });
    });

    // the dining room's bin, by the door
    const sIn = (id, o) => buildStandIn(A, W.searchables.find((s) => s.id === id), W.standIns[id], { noBlob: true, ...o });
    sIn('s-bin-dining');

    // ---- the kitchen ------------------------------------------------------------------------------
    A.room('kitchen');
    const kfx = W.fixtures.find((f) => f.zone === 'diner' && f.needsPower);
    A.light({ pos: kfx.pos, lm: 3000, fx: true, power: true, range: 9, amb: 0.004 });
    A.light({ pos: [23.3, 3.38, -29.9], lm: 2600, power: true, amb: 0.004 });
    A.light({ pos: [26.1, 2.45, d2.pos[2]], lm: 80, color: LIGHT.red, amb: 0.004 });
    A.light({ pos: [23.3, 1.6, ZB + 0.1], lm: 80, color: LIGHT.moon, amb: 0, r0: 0.5, reach: 6 }); // the night through the broken window
    A.light({ pos: [23.36, 1.0, -20.52], lm: 45, color: [0.35, 0.6, 2.6], amb: 0, r0: 0.05, reach: 4 }); // a burner nobody turned off
    for (const lx of [22.4, 24.0]) A.light({ pos: [lx, 1.98, -20.75], lm: 420, color: LIGHT.warm, power: true, amb: 0.001, down: 0.8 });
    A.quad('tile', [DIV + 0.3, 0.004, ZF], [X1 - DIV - 0.3, 0, 0], [0, 0, ZB - ZF], rgb(0x55291e), { par: 1, cell: 0.2, ao: true, wetAt: (x, y, z) => Math.max(0, 1 - Math.hypot(x - 23.3, z - ZB) / 2.4, 1 - Math.hypot(x - X1, z - d2.pos[2]) / 2.5) });
    const kWall = (face, c, a0, a1, hs) => {
      A.wall('tile', face, c, a0, a1, 0, 2.0, rgb(0xb9b4a0), { par: 2, ao: true, cell: 0.25 }, hs);
      A.wall('plaster', face, c, a0, a1, 2.0, CEIL, rgb(0xa9a48c), { cell: 0.5 }, hs);
    };
    kWall('+x', DIV + 0.312, ZB, ZF, [{ a: -24.85, b: -23.65, y0: 0, y1: 2.2 }]);
    kWall('+z', ZB + 0.012, DIV + 0.3, X1, holes);
    kWall('-z', ZF - 0.012, DIV + 0.3, X1);
    kWall('-x', X1 - 0.012, ZB, ZF, [{ a: d2.rect.z0, b: d2.rect.z1, y0: 0, y1: d2.h }]);
    for (const z of [d2.rect.z0, d2.rect.z1]) A.box('paint', [X1 - 0.03, 0, z - 0.04], [X1 + 0.32, d2.h, z + 0.04], rgb(0x3a3e3c), { par: 1 });
    A.box('paint', [X1 - 0.03, d2.h, d2.rect.z0 - 0.04], [X1 + 0.32, d2.h + 0.08, d2.rect.z1 + 0.04], rgb(0x3a3e3c), { par: 1 });
    A.sign('exit', [X1 - 0.03, d2.h + 0.14, d2.pos[2] - 0.22], [0, 0, 0.44], [0, 0.22, 0], { glow: [7, 0.6, 0.35], color: [0.4, 0.4, 0.4] });
    {
      const q = wins.find((w) => w.pos[0] > DIV), a = q.pos[0] - q.w / 2, b = q.pos[0] + q.w / 2, z = ZB + 0.012;
      for (const [fx0, fx1, fy0, fy1] of [[a - 0.06, b + 0.06, q.sill - 0.06, q.sill], [a - 0.06, b + 0.06, q.head, q.head + 0.06], [a - 0.06, a, q.sill, q.head], [b, b + 0.06, q.sill, q.head]]) A.box('metal', [fx0, fy0, z - 0.05], [fx1, fy1, z + 0.03], rgb(0x9a9ea2));
      A.glass([a, q.sill, z + 0.008], [q.w, 0, 0], [0, q.head - q.sill, 0], { broken: true });
    }
    fittingK(A, kfx.pos[0], kfx.pos[2], true);
    fittingK(A, 23.3, -29.9, true);
    buildKitchen(A, prep);
    for (const id of ['s-crate-k1', 's-crate-k2', 's-crate-k3', 's-bin-kitchen', 's-barrel-back1', 's-barrel-back2']) sIn(id, id === 's-bin-kitchen' ? { color: rgb(0x4a4d50) } : {});
    A.detail(() => {
      A.sign('smear', [20.4, 0.009, -24.0], [4.6, 0, -2.6], [0.5, 0, 0.9], { color: [0.13, 0.007, 0.005], par: 1 });
      A.sign('splat', [25.0, 0.009, -26.6], [1.2, 0, 0], [0, 0, -1.2], { color: [0.13, 0.007, 0.005], par: 1 });
      A.sign('splat', [X1 - 0.014, 0.5, -26.2], [0, 0, 1.0], [0, 1.0, 0], { color: [0.13, 0.007, 0.005], par: 1 });
    });

    // ---- the rear windows' boards, the shots -------------------------------------------------------
    for (const q of wins) boardWindow(A, q);
    buildBarrier(A, d2);
    dinerOutside(A, B, W, rng);
    A.shot('diner-in', [12.3, 1.7, -20.75, -0.22, -0.06]);
    A.shot('diner-counter', [9.9, 1.55, -24.3, -1.02, -0.07]);
    A.shot('diner-kitchen', [20.95, 1.7, -30.9, -2.55, -0.12]);
    A.shot('diner-window', [13.2, 1.6, -27.6, 0.3, 0.02]);
    A.shot('diner-booths', [19.2, 1.6, -24.6, 2.35, -0.1]);
    A.shot('diner-ext', [12.0, 1.7, -14.2, 0.0, 0.06]);
    A.shot('diner-back', [31.5, 1.7, -26.2, 1.42, 0.03]);
    A.finish();
  } finally { B.prepass = pp; }
  return { real: true, id: 'diner' };
}

const i3 = (x) => ((Math.round(x * 10) % 7) - 3) * 0.045; // a fixed small tilt from a position

// The diner from the motel's side: the east wall with the back door and the service yard along it,
// the rear wall the windows are in, and the roof as the motel's walkway sees it. Same enamel panels,
// teal fascia and chrome trim as the front (store.js), dirtier.
function dinerOutside(A, B, W, rng) {
  const d2 = W.doors.find((d) => d.id === 'd2');
  const wins = W.windows.filter((w) => w.zone === 'diner');
  const XE = 26.6, ZN = -32, TOP = 3.9, PANEL = rgb(0xb4b8b6, 0.75), TEAL2 = rgb(0x1d5a52), PLINTH = rgb(0x6a6862), STEELC = rgb(0x8a8e92);
  A.room('yard');
  // the lamp over the back door when the power is on, its battery
  // pack beside it for when it is not, a sign lamp on the rear wall, the night on the roof
  A.light({ pos: [XE + 0.32, 2.72, d2.pos[2]], lm: 1900, color: LIGHT.warm, power: true, reach: 9, amb: 0.0006 }); // baked only: a pool light here shone through the wall onto the kitchen's ceiling
  A.light({ pos: [XE + 0.2, 2.5, -25.6], lm: 260, reach: 7, amb: 0.0004 });
  A.light({ pos: [XE + 0.3, 3.1, -21.6], lm: 600, color: LIGHT.tube, power: true, reach: 7, amb: 0.0004 });
  A.light({ pos: [17, 14, -27], lm: 800, color: LIGHT.moon, noShadow: true, amb: 0.0005, reach: 1 });
  const wallE = (kind, y0, y1, col, opts) => A.wall(kind, '+x', XE + 0.014, ZN, ZF, y0, y1, col, { ao: true, cell: 0.5, ...opts }, [{ a: d2.rect.z0, b: d2.rect.z1, y0: 0, y1: d2.h }]);
  wallE('concrete', 0, 0.42, PLINTH, { wet: 0.5 });
  wallE('clad', 0.42, 3.2, PANEL, { wet: 0.6 });
  wallE('paint', 3.2, TOP, TEAL2, { par: 1 });
  const holesN = wins.map((w) => ({ a: w.pos[0] - w.w / 2, b: w.pos[0] + w.w / 2, y0: w.sill, y1: w.head }));
  const wallN = (kind, y0, y1, col, opts) => A.wall(kind, '-z', ZN - 0.008, 7, XE, y0, y1, col, { cell: 0.7, ...opts }, holesN);
  wallN('concrete', 0, 0.42, PLINTH, { wet: 0.5 });
  wallN('clad', 0.42, 3.2, PANEL, { wet: 0.7 });
  wallN('paint', 3.2, TOP, TEAL2, { par: 1 });
  // chrome ribs under the fascia and a coping on the parapet, as on the front
  for (const y of [3.2, 3.32]) { A.box('metal', [XE + 0.014, y - 0.02, ZN], [XE + 0.05, y + 0.02, ZF], CHROME); A.box('metal', [7, y - 0.02, ZN - 0.045], [XE + 0.05, y + 0.02, ZN - 0.008], CHROME); }
  A.box('metal', [XE - 0.32, TOP, ZN - 0.03], [XE + 0.06, TOP + 0.05, ZF], STEELC, { par: 0.4 });
  A.box('metal', [7, TOP, ZN - 0.06], [XE + 0.06, TOP + 0.05, ZN + 0.32], STEELC, { par: 0.4 });
  // corner trims and downpipes
  for (const z of [ZN + 0.02, ZF - 0.02]) A.box('metal', [XE + 0.01, 0, z - 0.04], [XE + 0.04, 3.2, z + 0.04], CHROME);
  for (const z of [ZN + 0.5, ZF - 0.45]) { A.add('metal', cyl(0.05, 0.05, 3.6, 8), { m: M(XE + 0.08, 1.9, z), color: rgb(0x5a5e60), par: 0.5 }); A.box('metal', [XE + 0.014, 3.6, z - 0.08], [XE + 0.16, 3.74, z + 0.08], rgb(0x5a5e60), { par: 0.5 }); }
  // the back door's frame, threshold and step, a steel canopy over it, the lamp in its cage
  const z0 = d2.rect.z0, z1 = d2.rect.z1, zc = d2.pos[2], h = d2.h;
  for (const z of [z0, z1]) A.box('paint', [XE - 0.02, 0, z - 0.07], [XE + 0.06, h + 0.07, z + 0.01 + (z === z1 ? 0.06 : -0.02)], rgb(0x2c3432), { par: 1, bevel: 0.01 });
  A.box('paint', [XE - 0.02, h, z0 - 0.07], [XE + 0.06, h + 0.09, z1 + 0.07], rgb(0x2c3432), { par: 1, bevel: 0.01 });
  A.box('concrete', [XE, 0, z0 - 0.25], [XE + 0.75, 0.07, z1 + 0.25], rgb(0x8a877f), { wet: 0.8, bevel: 0.015 });
  A.box('metal', [XE - 0.02, 0.07, z0], [XE + 0.1, 0.085, z1], rgb(0x9a9ea2));
  A.box('metal', [XE + 0.014, h + 0.28, z0 - 0.35], [XE + 0.8, h + 0.32, z1 + 0.35], STEELC, { par: 0.5, rz: -0.12, shadow: true });
  for (const z of [z0 - 0.3, z1 + 0.3]) A.add('metal', cyl(0.012, 0.012, 0.85, 5), { m: M(XE + 0.4, h + 0.55, z, 0, 0, 0.95), color: rgb(0x5a5e60) });
  A.box('paint', [XE + 0.014, 2.62, zc - 0.11], [XE + 0.1, 2.84, zc + 0.11], rgb(0x2c3432), { par: 1 });
  A.add('glow', cylUp(0.07, 0.085, 0.16, 10), { m: M(XE + 0.2, 2.64, zc, 0, 0, -1.5708), color: [0.4, 0.34, 0.24], glow: [14, 9.6, 4.6], power: true });
  for (let i = 0; i < 4; i++) A.add('metal', torus(0.1, 0.006, 4, 12), { m: M(XE + 0.12 + i * 0.05, 2.72, zc, 0, Math.PI / 2, 0), color: rgb(0x3a3e40) });
  A.box('paint', [XE + 0.014, 2.38, -25.76], [XE + 0.12, 2.56, -25.44], rgb(0xb9b4a0), { par: 1, bevel: 0.01 });
  for (const k of [-0.09, 0.09]) A.add('glow', cylUp(0.04, 0.04, 0.03, 8), { m: M(XE + 0.13, 2.47, -25.6 + k, 0, 0, -1.2), color: [0.5, 0.5, 0.5], glow: [9, 11, 10] });
  A.sign('deliveries', [XE + 0.018, 1.62, z0 - 0.35], [0, 0, -1.5], [0, 0.375, 0], { color: [0.75, 0.72, 0.62] });
  A.sign('exit', [XE + 0.02, h + 0.12, zc + 0.22], [0, 0, -0.44], [0, 0.2, 0], { color: [0.25, 0.25, 0.25] });
  // the yard along the wall: a concrete apron, the grease drums, crates and trays, the bin store
  A.quad('concrete', [XE + 0.014, 0.012, ZF], [2.4, 0, 0], [0, 0, ZN - ZF], rgb(0x77746e), { wet: 0.9, cell: 0.5, ao: true });
  A.box('concrete', [XE + 2.4, 0, ZN], [XE + 2.52, 0.05, ZF], rgb(0x8a877f), { wet: 0.6 });
  // extractor: the kitchen's fan box high on the wall, its louvre and the grease it has thrown down the panels
  A.box('metal', [XE + 0.014, 2.3, -22.9], [XE + 0.5, 3.05, -21.9], STEELC, { par: 0.6, bevel: 0.02, shadow: true });
  for (let i = 0; i < 7; i++) A.box('paint', [XE + 0.5, 2.38 + i * 0.09, -22.82], [XE + 0.52, 2.43 + i * 0.09, -21.98], rgb(0x101214), { rz: 0.0 });
  A.sign('smear', [XE + 0.02, 2.3, -22.75], [0, 0, 0.7], [0, -1.7, 0], { color: [0.05, 0.035, 0.02], par: 1 });
  // meters and conduit by the corner; a gas pipe along the plinth into the kitchen
  A.box('metal', [XE + 0.014, 1.0, -21.2], [XE + 0.2, 1.55, -20.8], rgb(0x6a6e72), { par: 0.5, bevel: 0.015 });
  A.add('paint', cyl(0.07, 0.07, 0.03, 12).rotateZ(Math.PI / 2), { m: M(XE + 0.215, 1.34, -21.0), color: rgb(0xd8d4c6), par: 1 });
  A.add('metal', cyl(0.018, 0.018, 1.7, 6), { m: M(XE + 0.06, 2.4, -21.0), color: rgb(0x5a5e60) });
  A.add('paint', cyl(0.025, 0.025, 4.9, 6).rotateX(Math.PI / 2), { m: M(XE + 0.06, 0.55, -23.65), color: rgb(0xb89a16), par: 1 });
  A.add('paint', cyl(0.025, 0.025, 0.55, 6), { m: M(XE + 0.06, 0.28, -21.2), color: rgb(0xb89a16), par: 1 });
  // grease drums north of the door, one on its side
  for (const [dz, col] of [[-30.6, 0x23262a], [-29.85, 0x3a2a1c]]) {
    A.add('paint', lathe([[0, 0], [0.285, 0], [0.285, 0.28], [0.298, 0.3], [0.285, 0.32], [0.285, 0.58], [0.298, 0.6], [0.285, 0.62], [0.285, 0.85], [0.29, 0.87], [0, 0.86]], 14), { m: M(XE + 0.42, 0.012, dz), color: rgb(col), par: 1, shadow: true });
    B.tag('diner:yard', () => B.collide([XE + 0.13, 0, dz - 0.29], [XE + 0.71, 0.87, dz + 0.29], 'metal'));
  }
  A.sign('splat', [XE + 0.2, 0.014, -29.4], [1.3, 0, 0], [0, 0, -1.5], { color: [0.02, 0.016, 0.01], par: 1 });
  // bread trays and milk crates stacked south of the door
  B.at(M(XE + 0.36, 0.012, -25.1), () => {
    const cols = [0x1f4fa6, 0xc8281c, 0x1f4fa6, 0x23352a];
    for (let i = 0; i < 4; i++) {
      A.box('paint', [-0.2, i * 0.3, -0.2], [0.2, i * 0.3 + 0.28, 0.2], rgb(cols[i], 0.8), { ry: (i % 2) * 0.12 - 0.05 });
      A.box('paint', [-0.17, i * 0.3 + 0.24, -0.17], [0.17, i * 0.3 + 0.285, 0.17], rgb(0x08090a), { ry: (i % 2) * 0.12 - 0.05 });
    }
    for (let i = 0; i < 5; i++) A.box('paint', [-0.3, i * 0.11, 0.32], [0.3, i * 0.11 + 0.09, 0.98], rgb(i % 2 ? 0x8a6a40 : 0x7a7e80, 0.8), { ry: (i - 2) * 0.03 });
    B.tag('diner:yard', () => B.collide([-0.24, 0, -0.24], [0.32, 1.2, 1.0], 'cloth'));
  });
  // the bin store: a skip with one lid thrown back, bags beside it
  B.at(M(XE + 0.62, 0.012, -23.3), () => {
    const G1 = rgb(0x24493a);
    A.box('paint', [-0.5, 0.12, -0.9], [0.5, 1.12, 0.9], G1, { par: 0.4, bevel: 0.03, shadow: true });
    for (const z of [-0.6, 0, 0.6]) A.box('paint', [0.5, 0.2, z - 0.04], [0.54, 1.05, z + 0.04], [G1[0] * 0.7, G1[1] * 0.7, G1[2] * 0.7]);
    A.box('paint', [-0.52, 1.12, -0.92], [0.52, 1.16, 0.0], rgb(0x15171a), { par: 1 });
    A.box('paint', [-0.52, 1.14, 0.0], [0.52, 1.18, 0.92], rgb(0x15171a), { par: 1, rx: 0, rz: 1.25 });
    for (const [x, z] of [[-0.4, -0.75], [0.4, -0.75], [-0.4, 0.75], [0.4, 0.75]]) A.add('paint', cyl(0.07, 0.07, 0.05, 8).rotateX(Math.PI / 2), { m: M(x, 0.07, z), color: rgb(0x0a0a0a) });
    A.detail(() => {
      for (const [x, y, z, sc] of [[0.1, 1.2, 0.4, 1], [-0.15, 1.16, 0.62, 0.8], [0.72, 0.22, 1.05, 1.1], [0.35, 0.2, 1.3, 0.9]]) A.add('vinyl', sphere(0.26, 8, 6), { m: M(x, y, z, 0, sc, 0, sc, 0.8 * sc, sc), color: rgb(0x0c0d0e) });
    });
    B.tag('diner:yard', () => B.collide([-0.52, 0, -0.92], [0.54, 1.16, 0.92], 'metal'));
  });
  A.detail(() => {
    // a mop bucket by the step, flattened boxes, cigarette ends where the cook stood
    A.add('paint', cylUp(0.16, 0.13, 0.28, 10, true), { m: M(XE + 0.3, 0.012, z1 + 0.55), color: rgb(0xc9a416), par: 1 });
    A.add('wood', cyl(0.014, 0.014, 1.3, 5), { m: M(XE + 0.2, 0.66, z1 + 0.62, 0.12, 0, 0.16), color: rgb(0x7a6040) });
    for (let i = 0; i < 4; i++) A.box('paint', [XE + 0.2, 0.014 + i * 0.012, -28.9 - i * 0.05], [XE + 1.1, 0.024 + i * 0.012, -28.2], rgb(0x7a6a50, 0.8), { ry: (i - 1.5) * 0.08 });
    for (let i = 0; i < 9; i++) { const cx = XE + 0.9 + rng.range(-0.3, 0.3), cz = zc + rng.range(-0.9, 0.9); A.box('paint', [cx, 0.013, cz], [cx + 0.06, 0.02, cz + 0.014], rgb(0xd8d4c6), { ry: rng.range(0, 3) }); }
    A.sign('smear', [XE + 0.1, 0.014, zc - 0.3], [1.5, 0, 0.2], [0, 0, 0.6], { color: [0.12, 0.006, 0.005], par: 1 });
    A.sign('boot', [XE + 0.9, 0.014, zc + 0.3], [0.12, 0, 0.03], [0.29, 0, -0.03], { color: [0.1, 0.006, 0.005], par: 1 });
    A.sign('boot', [XE + 1.5, 0.014, zc - 0.1], [0.12, 0, 0.02], [0.29, 0, 0.06], { color: [0.08, 0.005, 0.004], par: 1 });
  });
  // the rear wall: vents, the box of the kitchen's cooler plant, a dead sign lamp
  A.box('metal', [21.2, 0.42, ZN - 0.5], [22.5, 1.3, ZN - 0.008], STEELC, { par: 0.6, bevel: 0.02 });
  for (let i = 0; i < 7; i++) A.box('paint', [21.28, 0.52 + i * 0.1, ZN - 0.51], [22.42, 0.56 + i * 0.1, ZN - 0.5], rgb(0x101214));
  for (const x of [8.4, 12.5, 16.2]) { A.box('metal', [x - 0.25, 2.5, ZN - 0.04], [x + 0.25, 2.9, ZN - 0.008], STEELC, { par: 0.5 }); for (let i = 0; i < 4; i++) A.box('paint', [x - 0.21, 2.55 + i * 0.085, ZN - 0.046], [x + 0.21, 2.59 + i * 0.085, ZN - 0.04], rgb(0x101214)); }
  for (const q of wins) {
    const a = q.pos[0] - q.w / 2, b = q.pos[0] + q.w / 2;
    for (const [fx0, fx1, fy0, fy1] of [[a - 0.07, b + 0.07, q.sill - 0.07, q.sill], [a - 0.07, b + 0.07, q.head, q.head + 0.07], [a - 0.07, a, q.sill, q.head], [b, b + 0.07, q.sill, q.head]]) A.box('metal', [fx0, fy0, ZN - 0.012], [fx1, fy1, ZN + 0.02], CHROME);
  }
  // the roof: wet felt inside the parapet, the kitchen's extract cowl, two condensers, a vent stack
  A.quad('concrete', [7.3, 3.862, ZF], [XE - 0.3 - 7.3, 0, 0], [0, 0, ZN + 0.3 - ZF], rgb(0x2a2b2c), { wet: 1, cell: 1.2 });
  A.detail(() => {
    A.box('metal', [22.6, 3.86, -22.0], [23.8, 4.5, -20.9], STEELC, { par: 0.6, bevel: 0.03 });
    A.add('metal', cylUp(0.34, 0.26, 0.3, 12), { m: M(23.2, 4.5, -21.45), color: rgb(0x6a6e72), par: 0.6 });
    A.add('metal', cylUp(0.5, 0.5, 0.05, 12), { m: M(23.2, 4.86, -21.45), color: rgb(0x6a6e72), par: 0.6 });
    for (const [x, z] of [[10.5, -28.5], [16.5, -24.0]]) {
      A.box('metal', [x - 0.7, 3.95, z - 0.5], [x + 0.7, 4.7, z + 0.5], rgb(0x7a7e80), { par: 0.6, bevel: 0.03 });
      A.add('paint', cyl(0.36, 0.36, 0.02, 14), { m: M(x, 4.71, z), color: rgb(0x0c0d0e) });
      for (const sx of [-0.6, 0.6]) A.box('metal', [x + sx - 0.05, 3.86, z - 0.45], [x + sx + 0.05, 3.95, z + 0.45], rgb(0x4a4d50));
    }
    for (const [x, z] of [[19.6, -30.6], [13.2, -22.2], [25.4, -29.5]]) { A.add('metal', cylUp(0.06, 0.06, 0.6, 8), { m: M(x, 3.86, z), color: rgb(0x5a5e60), par: 0.5 }); A.add('metal', cylUp(0.11, 0.02, 0.1, 8), { m: M(x, 4.46, z), color: rgb(0x5a5e60), par: 0.5 }); }
  });
}

function fittingK(A, x, z, power) {
  A.box('paint', [x - 0.68, 3.42, z - 0.16], [x + 0.68, CEIL, z + 0.16], rgb(0xc8c4b4), { par: 1 });
  for (const dz of [-0.07, 0.07]) A.add('glow', cyl(0.018, 0.018, 1.22, 6).rotateZ(Math.PI / 2), { m: M(x, 3.4, z + dz), color: [0.4, 0.42, 0.4], glow: TUBE_GLOW, power });
}

export { box, lathe, sphere, tube, cylUp };
