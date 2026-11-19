// Rudy's garage and the scrapyard behind the forecourt's east fence.
//
// The yard: lanes between stacks of pressed cars under one sodium lamp, four wrecks worth a look in
// the boot, a crane over the south fence. The garage: three open bays (a car up on the first lift,
// the rework bench in the second, the lockers and a freight crate in the third), the office in the
// corner with the main switch on its wall. Without the power the bays are lit by a trouble lamp and
// what the yard's lamp throws through the doors; with it every batten, the roof sign, the floods
// over the yard and the machines come on.
//
// Structure, doors, lanes and every fixed position are worldLayout's. The shell draws the
// structure boxes; everything else is the zone's art mesh (mats/interior.js), the vehicle layer
// (wrecks, stacks) and the object mesh (mats/yard.js): machines, the box, wall-buy boards, the
// switch and the signs, for every zone of the map, since nothing else draws them.
import { createRng } from '../../core/rng.js';
import { M, box, cyl, cylUp, rgb } from '../build.js';
import { createArt, LIGHT, onInstall } from '../../mats/interior.js';
import { shellStructure } from '../props/stairs.js';
import { buildBarrier } from '../props/barrier.js';
import { buildCar, carGeometry } from '../props/car.js';
import { registerVehicle, VBuf, FAR } from '../props/vehicleParts.js';
import { buildStacks, buildCrane, tyrePile, looseScrap, stackGeometries } from '../props/scrapStack.js';
import { createCarMats } from '../../mats/carPaint.js';
import { Mesh } from 'three';
import { buildLift, buildBatten, buildToolWall, buildTyreRack, buildDrum, buildOffice } from '../props/bay.js';
import { placePowerSwitch } from '../props/powerSwitch.js';
import { placeGarageSign, placePowerNeon } from '../props/neonSign.js';
import * as L from '../layout.js';
import { buildContainer } from '../objects/container.js';
import { placeMachine } from '../objects/machine.js';
import { placeBox } from '../objects/box.js';
import { buildBenchArt, placeBench } from '../objects/bench.js';
import { placeWallBuy } from '../objects/wallBuy.js';
import { installLoot } from '../objects/pickup.js';
import { YARD, channel, createObj, createYardMats, resetChannels } from '../../mats/yard.js';
import { economy as TE } from '../../game/tuning/economy.js';

const BX0 = 46, BX1 = 66, BZ0 = 4, BZ1 = 20, WALL = 0.3, CEIL = 6.2;
const IX0 = BX0 + WALL, IX1 = BX1 - WALL, IZ0 = BZ0 + WALL, IZ1 = BZ1 - WALL;
const DOORS = [5.0, 10.2, 15.4].map((a) => ({ a, b: a + 3.6, y0: 0, y1: 4.2 }));
const CLAD = rgb(0x5f6b68), CLAD_IN = rgb(0x8f8c80), DADO = rgb(0x3a2620), STEEL = rgb(0x8a8e92), DARK = rgb(0x0e0e0f), YELLOW = rgb(0xb8860f);
// which way each machine and wall-buy board faces (worldLayout gives the spot; the wall is behind it)
const MACHINE_YAW = { jumpStart: 0, secondHelping: -Math.PI / 2, shortOrder: 0, longHaul: Math.PI };
const WALLBUY_N = { 'wall-hollis12': [0, 1], 'wall-pike45': [1, 0], 'wall-calder556': [0, 1], 'wall-brandt12': [0, -1] };
const BOX_YAW = { 'box-diner': 0, 'box-motel': Math.PI / 2, 'box-garage': Math.PI / 2 };

// true on a tier that thins optional dressing (the vehicle layer builds after the tier is known)
const thin = () => { const q = typeof globalThis !== 'undefined' && globalThis.__G && globalThis.__G.quality; return !!(q && Number.isFinite(q.propDensity) && q.propDensity < 1); };
// what the last build left for the install: the object meshes, the live objects, the lights to tune
const REG = { geos: new Map(), list: [], power: 1, noPower: 2, lights: [], stackCars: [] };

export function buildGarage(B, W) {
  const rng = createRng(1112).fork('garage');
  resetChannels();
  REG.geos = new Map(); REG.list = []; REG.lights = [];
  const power = REG.power = channel(), noPower = REG.noPower = channel();
  const stat = new Map();
  const ctx = { B, stat(zone) { if (!stat.has(zone)) stat.set(zone, createObj()); return stat.get(zone); }, reg(d) { REG.list.push(d); } };
  const A = createArt(B, 'garage');
  A.rng = rng;
  const O = ctx.stat('garage');
  const pp = B.prepass;
  B.prepass = null;
  try {
    shellStructure(B, W, 'garage', { wall: rgb(0x55605d, 0.6), roof: rgb(0x1c1c1e, 0.6), solid: rgb(0x55605d, 0.6) }, (s) => s.kind === 'stack');
    const d4 = W.doors.find((d) => d.id === 'd4');
    const sIn = (id, o) => buildContainer(A, W.searchables.find((s) => s.id === id), W.standIns[id], o);

    // ================= the yard ====================================================================
    A.part('yard');
    A.room('yard');
    // the lit sign and the lamps over the bay doors reach the apron when the power is on
    A.light({ pos: [44.6, 6.9, 12], lm: 5200, color: LIGHT.red, power: true, reach: 16, amb: 0.0004, noShadow: true });
    for (const d of DOORS) A.light({ pos: [45.45, 4.5, (d.a + d.b) / 2], lm: 2400, color: LIGHT.warm, power: true, reach: 9, amb: 0.0004, down: 0.6 });
    A.light({ pos: [57.5, 2.6, 2.9], lm: 1500, color: LIGHT.amber, power: true, reach: 7, amb: 0.0003 });
    // ground: oiled hardcore, wet; darker in the lanes where the loader runs
    const lane = (x, z) => (Math.abs(z - 10.5) < 1.6 || Math.abs(z - 16) < 1.2 || Math.abs(x - 24) < 1.3 || Math.abs(x - 45) < 1.2 ? 0.8 : 1);
    const ground = (x, y, z) => { const k = lane(x, z) * (0.82 + 0.3 * rng.next()); return [YARD.oilConcrete.color[0] * k, YARD.oilConcrete.color[1] * k * 0.98, YARD.oilConcrete.color[2] * k * 0.94]; };
    const wetAt = (x, y, z) => 0.34 + 0.4 * (1 - lane(x, z)) + 0.12 * Math.sin(x * 0.7) * Math.sin(z * 0.9);
    A.quad('concrete', [22.4, 0.0, 23.5], [BX0 - 22.4, 0, 0], [0, 0, -0.8 - 23.5], ground, { wetAt, cell: 1.1 });
    A.quad('concrete', [BX0, 0.0, BZ0], [BX1 - BX0, 0, 0], [0, 0, -0.8 - BZ0], ground, { wetAt, cell: 1.1 });
    A.quad('concrete', [BX0, 0.0, 23.5], [BX1 - BX0, 0, 0], [0, 0, BZ1 - 23.5], ground, { wetAt, cell: 1.1 });
    // oil where things were drained, rust washed out from under the stacks
    A.detail(() => {
      for (let i = 0; i < 26; i++) {
        const x = rng.range(24, 45), z = rng.range(0.5, 22.5), r = rng.range(0.5, 1.6);
        A.quad('mark', [x - r, 0.006, z + r], [2 * r, 0, 0], [0, 0, -2 * r * rng.range(0.6, 1)], i % 3 ? rgb(0x0a0908) : rgb(0x24120a), { cell: 9, par: 0 });
      }
      for (const s of W.stacks) A.quad('mark', [s.x0 - 0.5, 0.005, s.z1 + 0.6], [s.x1 - s.x0 + 1, 0, 0], [0, 0, -(s.z1 - s.z0) - 1.2], rgb(0x1c0e07), { cell: 9, par: 0.6 });
    });
    // the containers that close the yard's north side (the motel's blocks, drawn plain by its shell):
    // two tiers of ribbed boxes in their lines' colours, doors on some ends
    {
      const TINT = [0x5a2418, 0x1f3f5a, 0x3a4a34, 0x6a5a3a, 0x4a4e52, 0x5a2418, 0x23384a];
      let k = 0;
      for (const [xa, xb] of [[26.6, 42.5], [45.5, BX1]]) {
        const n = Math.round((xb - xa) / 6.06);
        for (let i = 0; i < n; i++) for (let t = 0; t < 2; t++) {
          const x0 = xa + ((xb - xa) * i) / n, x1 = xa + ((xb - xa) * (i + 1)) / n;
          A.wall('clad', '+z', -0.8 + 0.012, x0 + 0.03, x1 - 0.03, t * 2.6 + 0.03, t * 2.6 + 2.57, rgb(TINT[(k++ * 3 + t) % TINT.length], 0.7), { par: 1, wet: 0.5, cell: 2 });
          A.box('metal', [x0, t * 2.6, -0.8], [x0 + 0.06, t * 2.6 + 2.6, -0.76], rgb(0x2a2420), { par: 1.2 });
        }
      }
      A.wall('clad', '+z', -0.8 + 0.012, 42.5, 45.5, 3.23, 5.17, rgb(0x4a4e52, 0.7), { par: 1, wet: 0.5, cell: 2 });
    }
    REG.stackCars = buildStacks(A, W, rng);
    // loose scrap at the stacks' ends and along their feet, clear of the lanes' middles
    A.detail(() => {
      const KINDS = ['door', 'wheel', 'axle', 'bonnet', 'wheel', 'engine', 'door', 'wheel'];
      W.stacks.forEach((s, i) => {
        for (let k = 0; k < 4; k++) {
          const x = rng.range(s.x0 + 0.4, s.x1 - 0.4), side = k % 2 ? 1 : -1;
          B.at(M(x, 0, (side > 0 ? s.z1 : s.z0) + side * rng.range(0.12, 0.3), 0, rng.range(-0.4, 0.4) + (side > 0 ? 0 : Math.PI), 0), () => looseScrap(A, rng, KINDS[(i * 3 + k) % KINDS.length]));
        }
        B.at(M(s.x1 + 0.38, 0, (s.z0 + s.z1) / 2 + rng.range(-0.4, 0.4)), () => tyrePile(A, 2 + (i % 3), rng));
      });
    });
    // the four wrecks worth searching: on their rims, glass gone, one with a door hanging
    const car = (id, type, o) => {
      const c = W.standInCars[id];
      B.at(M(c.x, 0, c.z, 0, c.yaw, 0), () => B.tag(`search:${id}`, () => buildCar(B, { id: `yard-${id}`, prop: W.searchables.find((s) => s.id === id).prop, type, ...o })));
    };
    car('s-scrap1', 'hatch', { paint: 'paintCarE', rust: 0.8, dirt: 0.7, damage: 0.6, flat: 'fl', brokenGlass: ['ws', 'fl', 'rl'], crumple: 'fr' });
    car('s-scrap2', 'hatch', { paint: 0x6b5a3a, rust: 0.9, dirt: 0.8, damage: 0.8, flat: 'rr', brokenGlass: ['ws', 'rw', 'fr'] });
    car('s-scrap3', 'hatch', { paint: 'paintCarA', rust: 0.7, dirt: 0.8, damage: 0.5, flat: 'fr', doorAjar: 0.9, brokenGlass: ['fl', 'fr'] });
    car('s-scrap4', 'hatch', { paint: 'paintCarB', rust: 0.9, dirt: 0.9, damage: 0.7, flat: 'rl', brokenGlass: ['ws', 'rw', 'rl', 'rr'], crumple: 'fl' });
    sIn('s-barrel-g1', { color: rgb(0x6a3a10) }); sIn('s-barrel-g2', { color: rgb(0x1f4a3a) }); sIn('s-crate-g');
    buildCrane(A, { base: [40.5, 27.4], h: 14, reach: 12.5, hang: 8.2 });
    buildBarrier(A, d4);
    // beyond the south fence the yard goes on: a rank of pressed cars against the bank (out of reach)
    B.inZone('garage', () => {
      for (let i = 0; i < 9; i++) {
        const x = 24.5 + i * 4.9 + rng.range(-0.2, 0.2);
        for (let k = 0; k < 2 + (i % 2); k++) B.at(M(x, k * 0.66 - 0.1, 26.3 + rng.range(-0.15, 0.15), 0, rng.range(-0.05, 0.05) + (i % 2 ? Math.PI : 0), 0), () => {
          const type = ['sedan', 'wagon', 'hatch'][(i + k) % 3], paint = [0x5a2a1e, 0x8a8c86, 0x24403f, 0x34405a, 0x6b5a3a][(i + k * 2) % 5];
          // (left out where the tier thins the dressing: a phone keeps its triangles for the lanes)
          registerVehicle(B, { kind: 'car', id: `yard-far-${i}-${k}`, far: true, build: () => (thin() ? { body: new VBuf(), wheels: [], plates: [] } : carGeometry(type, { paint, rust: 0.8, dirt: 0.8 }, FAR)) });
        });
      }
    });

    // ================= the garage from outside ====================================================
    A.room('front'); // (same part as the yard: they are always seen together)
    A.light({ pos: [44.6, 6.9, 12], lm: 5200, color: LIGHT.red, power: true, reach: 14, amb: 0.0006, noShadow: true });
    for (const d of DOORS) A.light({ pos: [45.45, 4.5, (d.a + d.b) / 2], lm: 2400, color: LIGHT.warm, power: true, reach: 8, amb: 0.0006, down: 0.5 });
    A.light({ pos: [57.5, 2.6, 2.9], lm: 1500, color: LIGHT.amber, power: true, reach: 7, amb: 0.0004 });
    A.light({ pos: [34, 7.2, 10.5], lm: 9000, color: LIGHT.sodium, reach: 18, amb: 0, noShadow: true, r0: 2 }); // the yard's lamp on the west face (the pool's real light does not reach every panel)
    const outer = (face, c, a0, a1, holes) => {
      A.wall('concrete', face, c, a0, a1, 0, 0.55, rgb(0x55534e), { cell: 1.2 }, holes);
      A.wall('clad', face, c, a0, a1, 0.55, 4.7, CLAD, { par: 1, wet: 0.6, cell: 1.2 }, holes);
      A.wall('clad', face, c, a0, a1, 4.7, CEIL + 0.3, rgb(0x4a5552), { par: 0, wet: 0.5, cell: 1.2 });
    };
    outer('-x', BX0 - 0.012, BZ0, BZ1, DOORS);
    outer('-z', BZ0 - 0.012, BX0, BX1);
    outer('+z', BZ1 + 0.012, BX0, BX1);
    // bay doors: steel jamb guards in hazard paint, the rolled door's box and its last slats over each
    for (const d of DOORS) {
      for (const z of [d.a, d.b]) {
        A.box('paint', [BX0 - 0.05, 0, z - 0.06], [BX0 + WALL + 0.02, 4.2, z + 0.06], YELLOW, { par: 1 });
        for (let y = 0.15; y < 1.5; y += 0.3) A.box('paint', [BX0 - 0.056, y, z - 0.066], [BX0 + 0.02, y + 0.15, z + 0.066], DARK);
      }
      A.box('metal', [BX0 - 0.3, 4.2, d.a - 0.15], [BX0 - 0.012, 4.68, d.b + 0.15], rgb(0x6a6e6c), { par: 0.7 });
      for (let i = 0; i < 3; i++) A.box('metal', [BX0 + 0.1, 3.86 + i * 0.11, d.a], [BX0 + 0.14, 3.95 + i * 0.11, d.b], rgb(0x7a7e7c), { par: 0.6 });
      const zc = (d.a + d.b) / 2;
      // a gooseneck lamp over the door
      A.add('metal', cyl(0.015, 0.015, 0.5, 6).rotateZ(Math.PI / 2), { m: M(BX0 - 0.26, 5.0, zc), color: STEEL });
      A.add('paint', cylUp(0.16, 0.03, 0.12, 12), { m: M(BX0 - 0.5, 4.86, zc), color: rgb(0x1f3a30), par: 1 });
      A.add('glow', cylUp(0.05, 0.05, 0.03, 8), { m: M(BX0 - 0.5, 4.84, zc), color: [0.4, 0.3, 0.2], glow: [30, 21, 11], power: true });
      // bay number on the pier
      A.box('paint', [BX0 - 0.02, 2.5, d.b + 0.3], [BX0 - 0.012, 3.1, d.b + 0.9], rgb(0xcfc8b4), { par: 0 });
    }
    A.detail(() => {
      for (const z of [BZ0 + 0.2, BZ1 - 0.2]) { A.add('metal', cylUp(0.05, 0.05, CEIL, 8), { m: M(BX0 - 0.07, 0, z), color: rgb(0x4a4e4c), par: 0.9 }); }
      A.box('metal', [BX0 - 0.16, CEIL + 0.05, BZ0], [BX0 - 0.012, CEIL + 0.17, BZ1], rgb(0x4a4e4c), { par: 0.9 });
      // the north side: meter cupboard and conduit where the supply comes in, a vent, pallets
      A.box('metal', [63.6, 0.9, BZ0 - 0.2], [64.4, 2.0, BZ0 - 0.012], rgb(0x5a625e), { par: 0.6, bevel: 0.01 });
      A.add('metal', cylUp(0.035, 0.035, 4.2, 6), { m: M(64, 2.0, BZ0 - 0.06), color: STEEL, par: 0.6 });
      A.box('metal', [49, 3.4, BZ0 - 0.06], [50, 4.1, BZ0 - 0.012], rgb(0x4a4e4c), { par: 0.9 });
      for (let i = 0; i < 4; i++) A.box('wood', [60.4, i * 0.14, BZ0 - 1.25], [61.6, i * 0.14 + 0.12, BZ0 - 0.25], rgb([0x6b5236, 0x54412c][i % 2]), { par: 0, ry: (i % 2) * 0.06 });
      // the south side: a row of dead batteries, tyres against the wall
      for (let i = 0; i < 6; i++) A.box('paint', [48 + i * 0.36, 0, BZ1 + 0.05], [48.3 + i * 0.36, 0.22, BZ1 + 0.23], rgb(0x16181a), { par: 1, bevel: 0.01 });
      for (const x of [52.5, 53.2, 59.8]) B.at(M(x, 0, BZ1 + 0.45), () => tyrePile(A, 3 + Math.floor(x) % 2, rng));
    });
    const sign = placeGarageSign(A, O, power);
    O.quad([BX0 - 0.02, 2.1, 8.75], [0, 0, 1.3], [0, 0.27, 0], { tex: 'salvage', color: [0.7, 0.7, 0.7] });
    // powered light for the whole yard: the sign's red, two floods under the eaves
    B.fixture({ kind: 'neon', pos: sign.pos, needsPower: true });
    REG.lights.push({ pos: sign.pos, color: [1.0, 0.2, 0.1], lumens: 4200, range: 16, priority: 1.1 });
    for (const z of [9.4, 14.6]) {
      const pos = [BX0 - 0.45, 5.9, z], dir = [-0.82, -0.56, z < 12 ? -0.1 : 0.1];
      B.fixture({ kind: 'sodium', pos, dir, needsPower: true });
      REG.lights.push({ pos, color: [0.85, 0.95, 1.0], lumens: 11000, range: 30, priority: 1.0 });
      A.box('paint', [BX0 - 0.5, 5.86, z - 0.16], [BX0 - 0.3, 6.08, z + 0.16], rgb(0x23262a), { par: 1, rz: 0.5 });
      A.box('metal', [BX0 - 0.3, 5.9, z - 0.02], [BX0 - 0.012, 5.94, z + 0.02], STEEL);
      A.box('glow', [BX0 - 0.53, 5.83, z - 0.13], [BX0 - 0.49, 5.99, z + 0.13], [0.3, 0.3, 0.3], { glow: [50, 56, 60], power: true, rz: 0.5 });
    }

    // ================= the bays ====================================================================
    A.part('bays');
    A.room('bays');
    const tubes = W.fixtures.filter((f) => f.zone === 'garage' && f.kind === 'tube');
    // without the power: the trouble lamp under the car on the lift, the exit sign's battery, what
    // the yard's lamp throws in through the doors
    A.light({ pos: [51.2, 1.25, 7.9], lm: 420, color: LIGHT.warm, amb: 0.0012, r0: 0.3, reach: 9 });
    A.light({ pos: [IX0 + 0.2, 4.45, 12], lm: 70, color: LIGHT.red, amb: 0.001, reach: 6 });
    for (const d of DOORS) A.light({ pos: [BX0 - 0.6, 2.6, (d.a + d.b) / 2], lm: 1300, color: LIGHT.sodium, amb: 0, r0: 1.2, reach: 12 });
    // with it: two rows of battens
    const battens = [[50.5, 6.8], [57.5, 6.8], [50.5, 12], [57.5, 12], [63, 11.6], [50.5, 17.2], [57.5, 17.2], [63, 17.2]];
    tubes.forEach((f) => A.light({ pos: f.pos, lm: 2600, fx: true, power: true, range: 11, amb: 0.003, reach: 12 }));
    for (const [x, z] of battens) A.light({ pos: [x, 4.55, z], lm: 5200, power: true, amb: 0.0015, reach: 11 });
    A.light({ pos: [55.35, 1.8, 12], lm: 900, color: LIGHT.warm, power: true, amb: 0, down: 0.7, reach: 5 }); // the bench's lamp
    const wetIn = (x, y, z) => Math.max(0, 1 - (x - BX0) / 3.2) * (DOORS.some((d) => z > d.a - 0.4 && z < d.b + 0.4) ? 1 : 0.3);
    const floorCol = (x, y, z) => { const k = 0.8 + 0.35 * rng.next(); return [0.2 * k, 0.195 * k, 0.185 * k]; };
    A.quad('concrete', [IX0 - WALL, 0.004, IZ1], [IX1 - IX0 + WALL, 0, 0], [0, 0, IZ0 - IZ1], floorCol, { wetAt: wetIn, cell: 0.8, ao: true });
    A.quad('metal', [IX0, CEIL - 0.01, IZ0], [IX1 - IX0, 0, 0], [0, 0, IZ1 - IZ0], rgb(0x2a2c2c), { cell: 2, par: 0.8 });
    const inner = (face, c, a0, a1, holes, top = CEIL) => {
      A.wall('paint', face, c, a0, a1, 0, 1.4, DADO, { par: 1, ao: true, cell: 0.7 }, holes);
      A.wall('plaster', face, c, a0, a1, 1.4, top, CLAD_IN, { cell: 0.9 }, holes);
    };
    inner('+x', IX0 + 0.012, IZ0, IZ1, DOORS);
    inner('+z', IZ0 + 0.012, IX0, 61);
    inner('-z', IZ1 - 0.012, IX0, IX1);
    inner('-x', IX1 - 0.012, 8.7, IZ1, W.rollers.map((r) => ({ a: r.z0, b: r.z1, y0: 0, y1: 4.2 })));
    // roof steel: trusses across the bays, purlins along them
    for (const x of [49.5, 53.5, 57.5, 61.5]) {
      A.box('paint', [x - 0.07, 5.55, IZ0], [x + 0.07, 5.75, IZ1], rgb(0x4a1f14), { par: 0 });
      A.box('paint', [x - 0.05, 6.0, IZ0], [x + 0.05, 6.12, IZ1], rgb(0x4a1f14), { par: 0 });
      for (let z = IZ0 + 0.6; z < IZ1 - 0.5; z += 1.3) A.box('paint', [x - 0.025, 5.74, z - 0.025], [x + 0.025, 6.02, z + 0.025], rgb(0x4a1f14), { rx: (Math.round(z / 1.3) % 2 ? 0.75 : -0.75) });
    }
    battens.forEach(([x, z], i) => buildBatten(A, x, 4.6, z, CEIL, i === 4 ? 'dead' : 'power'));
    // roller tracks and the bottom of each raised door, seen from inside
    for (const d of DOORS) for (const z of [d.a - 0.06, d.b + 0.06]) A.box('metal', [IX0, 0, z - 0.04], [IX0 + 0.07, 4.9, z + 0.04], rgb(0x5a5e5c), { par: 0.7 });
    // the dropped and the stuck roller in the back wall: frames, a chain hoist, light under the stuck one
    for (const r of W.rollers) {
      for (const z of [r.z0 - 0.07, r.z1 + 0.07]) A.box('metal', [IX1 - 0.09, 0, z - 0.05], [IX1 - 0.01, 4.4, z + 0.05], rgb(0x5a5e5c), { par: 0.7 });
      A.box('metal', [IX1 - 0.34, 4.2, r.z0 - 0.15], [IX1 - 0.01, 4.66, r.z1 + 0.15], rgb(0x5a5e5c), { par: 0.7 });
      A.add('metal', cyl(0.006, 0.006, 3.0, 4), { m: M(IX1 - 0.12, 2.7, r.z1 + 0.2), color: STEEL });
      if (r.gap > 0) A.light({ pos: [IX1 + 0.5, 0.3, (r.z0 + r.z1) / 2], lm: 160, color: LIGHT.moon, amb: 0, r0: 0.4, reach: 6 });
    }
    A.sign('exit', [IX0 + 0.02, 4.32, 12 - 0.3], [0, 0, 0.6], [0, 0.3, 0], { glow: [7, 0.6, 0.35], color: [0.4, 0.4, 0.4] });
    // painted bay lines and numbers' boxes on the floor
    for (const d of DOORS) for (const z of [d.a + 0.25, d.b - 0.25]) A.quad('paint', [IX0 + 0.4, 0.007, z + 0.05], [9.5, 0, 0], [0, 0, -0.1], YELLOW, { cell: 9 });
    // bay 1: a saloon up on the lift with the trouble lamp under it; bay 2: the bench, a low lift
    buildLift(A, 52.4, 6.8, { lift: 0.62, car: { type: 'sedan', paint: 'paintCarE', brokenGlass: ['fl'], flat: 'fl' } });
    A.add('metal', cyl(0.004, 0.004, 0.5, 4), { m: M(51.2, 1.5, 7.9), color: DARK });
    A.add('paint', cylUp(0.03, 0.03, 0.2, 8), { m: M(51.2, 1.1, 7.9), color: rgb(0xb8860f), par: 1 });
    A.add('glow', cylUp(0.024, 0.024, 0.1, 8), { m: M(51.2, 1.14, 7.9), color: [0.5, 0.4, 0.3], glow: [26, 18, 9] });
    buildLift(A, 61.6, 11.9, { lift: 0.12, color: rgb(0x7a1a14) });
    const bench = W.benchSpot;
    B.at(M(bench.pos[0], 0, bench.pos[2], 0, -Math.PI / 2, 0), () => buildBenchArt(A, rng));
    placeBench(ctx, bench, -Math.PI / 2, power);
    // the office's outside: the tool wall on its south face, a window in its west one
    A.part('bays');
    inner('-x', 61 - 0.012, IZ0, 8.7, [{ a: 5.65, b: 6.85, y0: 0, y1: 2.1 }], 3.0);
    inner('+z', 8.7 + 0.012, 61, IX1, [], 3.0);
    for (const z of [5.65, 6.85]) A.box('paint', [60.97, 0, z - 0.04], [61.23, 2.1, z + 0.04], rgb(0x23262a), { par: 1 });
    A.box('paint', [60.97, 2.1, 5.61], [61.23, 2.18, 6.89], rgb(0x23262a), { par: 1 });
    A.box('paint', [60.95, 3.0, IZ0], [61.25, 3.12, 8.72], rgb(0x23262a)); A.box('paint', [61, 3.0, 8.45], [IX1, 3.12, 8.75], rgb(0x23262a));
    buildToolWall(A, [61.7, 1.25, 8.712], [1, 0, 0], 3.2, 1.2, rng);
    A.detail(() => {
      // what is kept on the office roof: boxes, an exhaust, tyres
      for (let i = 0; i < 5; i++) A.box('wood', [61.5 + i * 0.8, 3.12, 5 + (i % 2) * 1.6], [62.1 + i * 0.8, 3.5 + (i % 3) * 0.12, 5.6 + (i % 2) * 1.6], rgb([0x6b5236, 0x7a6a50, 0x54412c][i % 3]), { par: 0, ry: i * 0.2 });
      B.at(M(61.6, 3.12, 7.9), () => tyrePile(A, 3, rng));
      A.add('metal', cyl(0.04, 0.04, 2.2, 8).rotateX(Math.PI / 2), { m: M(63.2, 3.2, 7.4, 0, 0.3, 0), color: rgb(0x4a2a1a), par: 1.5 });
    });
    // partition between bays 2 and 3
    inner('-z', 14.5 - 0.012, 58.5, IX1, [], 2.4); inner('+z', 14.7 + 0.012, 58.5, IX1, [], 2.4);
    A.box('paint', [58.48, 0, 14.48], [58.5, 2.4, 14.72], DADO); A.box('paint', [58.45, 2.4, 14.46], [IX1, 2.46, 14.74], rgb(0x23262a));
    // bay 3: lockers on the south wall, tyres racked beside them, drums, the freight crate
    for (let i = 1; i <= 4; i++) sIn(`s-locker${i}`, { face: [0, -1], color: [rgb(0x3f4c50), rgb(0x46524a), rgb(0x3f4c50), rgb(0x4a4440)][i - 1], coat: [rgb(0x2a3a4a), rgb(0x5a3a1a), rgb(0x1f3a2a), rgb(0x3a3a3a)][i - 1] });
    sIn('s-toolchest', { face: [0, -1] });
    B.at(M(51.5, 0, IZ1 - 0.7), () => { buildTyreRack(A, 7, rng); B.tag('garage:tyres', () => B.collide([-0.05, 0, 0], [7 * 0.24 + 0.05, 2.3, 0.68], 'cloth')); });
    for (const [x, z, c] of [[47.0, 19.1, 0x1c3f7a], [47.65, 19.2, 0x6a3a10]]) B.at(M(x, 0, z), () => { buildDrum(A, rgb(c)); B.tag('garage:drum', () => B.collide([-0.29, 0, -0.29], [0.29, 0.88, 0.29], 'metal')); });
    A.detail(() => {
      // hose reels, a compressor in the corner of bay 2's back, blood where somebody was dragged out
      B.at(M(64.6, 0, 9.5), () => { A.add('paint', cyl(0.3, 0.3, 0.9, 12).rotateX(Math.PI / 2), { m: M(0, 0.55, 0), color: rgb(0x8a1c14), par: 1, shadow: true }); A.box('metal', [-0.2, 0.85, -0.2], [0.2, 1.1, 0.2], rgb(0x2a2c2e), { par: 0.5 }); for (const s of [-1, 1]) A.box('metal', [-0.25, 0, s * 0.35 - 0.03], [0.25, 0.26, s * 0.35 + 0.03], DARK); });
      A.add('paint', cyl(0.22, 0.22, 0.1, 14).rotateX(Math.PI / 2), { m: M(55, 3.2, IZ0 + 0.1), color: rgb(0xb84a10), par: 1 });
      A.add('paint', cyl(0.22, 0.22, 0.1, 14).rotateZ(Math.PI / 2), { m: M(IX0 + 0.1, 3.0, 9.4), color: rgb(0x1c3f7a), par: 1 });
      A.sign('smear', [48.5, 0.009, 16.6], [5.2, 0, 0.9], [0.3, 0, 1.0], { color: [0.13, 0.007, 0.005], par: 1 });
      A.sign('splat', [56.6, 0.009, 18.0], [1.3, 0, 0], [0, 0, -1.3], { color: [0.12, 0.006, 0.005], par: 1 });
      A.sign('hand', [IX0 + 0.014, 1.2, 9.3], [0, 0, 0.26], [0, 0.32, 0], { color: [0.13, 0.007, 0.005], par: 1 });
      A.sign('calendar', [58.0, 1.6, IZ0 + 0.014], [0.4, 0, 0], [0, 0.55, 0]);
      A.sign('clock', [IX1 - 0.014, 3.4, 9.6], [0, 0, -0.5], [0, 0.5, 0]);
      for (const [x, z] of [[49.2, 12.7], [56.0, 6.2], [59.2, 17.6], [53.0, 8.2]]) A.sign('splat', [x - 0.8, 0.008, z + 0.8], [1.6, 0, 0], [0, 0, -1.6], { color: [0.012, 0.011, 0.01], par: 1 });
    });

    // ================= the office ==================================================================
    A.part('bays');
    A.room('office');
    A.light({ pos: [63.4, 2.85, 6.4], lm: 2400, power: true, amb: 0.004, reach: 7 });
    A.light({ pos: [65.2, 1.15, 6.45], lm: 420, color: LIGHT.warm, power: true, amb: 0.001, reach: 5 });
    A.light({ pos: [63.66, 1.9, 4.6], lm: 26, color: LIGHT.red, amb: 0.0015, r0: 0.05, reach: 4 }); // the switch's pilot lamp
    A.light({ pos: [60.6, 2.0, 6.25], lm: 380, color: LIGHT.sodium, amb: 0, r0: 0.8, reach: 7 }); // the bays' gloom through the door
    A.quad('linoleum', [61.2, 0.006, 8.5], [IX1 - 61.2, 0, 0], [0, 0, IZ0 - 8.5], rgb(0x4a4a3a), { cell: 0.5, ao: true });
    A.quad('ceiling', [61.2, 2.99, IZ0], [IX1 - 61.2, 0, 0], [0, 0, 8.5 - IZ0], rgb(0xa9a48c), { cell: 0.8 });
    const off = (face, c, a0, a1, holes) => { A.wall('wood', face, c, a0, a1, 0, 1.0, rgb(0x4a3020), { par: 1, ao: true, cell: 0.4 }, holes); A.wall('plaster', face, c, a0, a1, 1.0, 3.0, rgb(0xa89a78), { cell: 0.5 }, holes); };
    off('+x', 61.2 + 0.012, IZ0, 8.5, [{ a: 5.65, b: 6.85, y0: 0, y1: 2.1 }]);
    off('+z', IZ0 + 0.013, 61.2, IX1); off('-z', 8.5 - 0.012, 61.2, IX1); off('-x', IX1 - 0.013, IZ0, 8.5);
    buildBatten(A, 63.4, 2.9, 6.4, 2.99, 'power', 1.2);
    buildOffice(A, 61.2, IX1, IZ0, 8.5, 3.0, rng);
    A.sign('calendar', [IX1 - 0.016, 1.5, 5.3], [0, 0, -0.4], [0, 0.55, 0]);
    O.quad([62.0, 1.35, 8.5 - 0.016], [-0.9, 0, 0], [0, 0.72, 0], { tex: 'orders', color: [0.7, 0.7, 0.7], glow: [0.05, 0.05, 0.05] });
    placePowerSwitch(ctx, 'garage', [W.power.pos[0], W.power.pos[1], IZ0 + 0.014], [0, 1], power, noPower);

    // ================= machines, boxes and wall-buy boards, in every zone ==========================
    for (const s of W.machineSpots) placeMachine(ctx, s, MACHINE_YAW[s.id] ?? s.yaw ?? 0);
    for (const s of W.boxSpots) placeBox(ctx, s, BOX_YAW[s.id] ?? s.yaw ?? 0);
    for (const s of W.wallBuys) placeWallBuy(ctx, s, WALLBUY_N[s.id] || [0, 1], TE.wallBuys[s.weapon] || s.weapon, power);

    // ================= the power on the rest of the map ===========================================
    for (const l of placePowerNeon(ctx, L, W, power)) { B.inZone(l.zone || 'forecourt', () => B.fixture({ kind: 'neon', pos: l.pos, needsPower: true, zone: l.zone || 'forecourt' })); REG.lights.push(l); }

    // ================= shots =========================================================================
    A.shot('yard-lane', [24.6, 1.7, 10.4, -1.5708, 0.03]);
    A.shot('yard-stacks', [36.4, 1.7, 16.0, 0.95, 0.1]);
    A.shot('yard-crane', [24.2, 1.7, 16.0, -1.643, 0.44]);
    A.shot('garage-ext', [36.2, 1.7, 10.6, -1.45, 0.16]);
    A.shot('garage-bays', [47.1, 1.75, 5.3, -2.31, 0.04]);
    A.shot('garage-bays2', [64.6, 1.75, 19.0, 0.87, 0.05]);
    A.shot('garage-office', [61.7, 1.6, 7.9, -0.594, -0.02]);
    A.shot('garage-north', [47.5, 1.7, 1.4, -1.5708, 0.05]);
    A.shot('power-off', [35.6, 1.75, 10.5, -1.5708, 0.17]);
    A.shot('power-on', [35.6, 1.75, 10.5, -1.5708, 0.17]);
    A.shot('obj-box', [52.7, 1.5, 15.5, -2.156, -0.25]);
    A.shot('obj-bench', [52.6, 1.6, 10.7, -2.05, -0.14]);
    A.shot('obj-machines', [56.3, 1.6, 1.0, -2.66, 0.0]);
    A.shot('obj-switch', [63.3, 1.5, 6.2, -0.37, -0.02]);
    A.shot('obj-wallbuy', [51.3, 1.6, 1.9, -2.79, 0.0]);
    A.shot('obj-pickups', [36.6, 1.6, 10.9, -1.5708, -0.12]);
    A.shot('obj-loot', [50.0, 1.6, 16.4, 3.0, -0.1]);
    A.shot('obj-toolchest', [59.6, 1.5, 12.2, -2.76, -0.25]);
    A.shot('obj-machine-diner', [23.6, 1.6, -22.9, -2.0, 0.0]);
    A.shot('obj-machine-motel', [29.0, 1.6, -34.8, 0.37, 0.0]);
    A.shot('obj-machine-store', [-1.4, 1.75, -15.4, 0.55, 0.0]);
    A.shot('obj-box-diner', [11.3, 1.6, -28.8, 0.785, -0.3]);
    A.shot('obj-box-motel', [41.6, 1.6, -18.0, -0.9, -0.3]);
    A.finish();
    // one object mesh a zone
    for (const [zone, o] of stat) {
      if (!o.count) continue;
      const geo = o.geometry();
      geo.setDrawRange(0, 0); // nothing until the install has put the material on
      REG.geos.set(geo, zone);
      B.inZone(zone, () => B.instance(`obj:${zone}`, geo, 'yardObject'));
    }
  } finally { B.prepass = pp; }
  return { real: true, id: 'garage' };
}

// what the last build registered (tests): ids of the live objects, in order
export const objectIds = () => REG.list.map((d) => d.id);
export const objectRecords = () => REG.list;

// ---- the install: the object material on the object meshes, the live objects, the powered lights ----
function install(G, layer) {
  const level = G.level;
  if (!level || !level.groups) return;
  const mats = createYardMats(G);
  for (const zone of Object.keys(level.groups)) {
    level.groups[zone].traverse((c) => {
      if (!c.geometry || !REG.geos.has(c.geometry)) return;
      c.material = mats.object; c.name = `obj:${zone}`;
      c.geometry.setDrawRange(0, Infinity);
      c.castShadow = false; c.receiveShadow = true;
      if (c.computeBoundingSphere) c.computeBoundingSphere();
      c.frustumCulled = true;
    });
  }
  const live = [];
  for (const d of REG.list) {
    const obj = d.make(G, mats);
    if (!obj) continue;
    obj.zone = d.zone;
    const g = level.groups[d.zone];
    if (obj.group && g) { g.add(obj.group); obj.group.updateMatrixWorld(true); }
    if (level.objects) level.objects[d.id] = obj;
    live.push({ obj, group: g });
  }
  // the fixtures this file registered as plain kinds: their real colour and output
  const fx = G.lights && G.lights.fixtures;
  if (fx) for (const l of REG.lights) for (const f of fx) if (Math.abs(f.pos.x - l.pos[0]) + Math.abs(f.pos.y - l.pos[1]) + Math.abs(f.pos.z - l.pos[2]) < 0.02) f.set({ color: l.color, lumens: l.lumens, range: l.range, priority: l.priority });
  const ev = G.events;
  const boxes = (level.boxSpots || []).map((s) => level.objects && level.objects[s.id]).filter(Boolean);
  if (ev) {
    ev.on('box:result', (e) => { for (const b of boxes) if (b.setWeapon) b.setWeapon(e && e.weapon); });
    ev.on('box:move', (e) => { for (const s of level.boxSpots || []) { const b = level.objects[s.id]; if (b && e && s.id !== e.to && s.id !== e.from && b.state !== 'gone') b.setState('gone'); } });
  }
  // harness: ?box=<state>[&boxgun=<weapon>], ?machines=<state> put every box / machine in a state
  const q = typeof window !== 'undefined' && window.location ? window.location.search : '';
  const arg = (k) => { const m = new RegExp(`[?&]${k}=([\\w-]+)`).exec(q); return m ? m[1] : null; };
  const forced = { box: arg('box'), gun: arg('boxgun'), machines: arg('machines') };
  const force = () => {
    for (const { obj } of live) {
      if (obj.kind === 'box' && forced.box) { obj.setState(forced.box); if (forced.gun) obj.setWeapon(forced.gun); }
      if (obj.kind === 'machine' && forced.machines) obj.setState(forced.machines);
    }
  };
  force();
  const loot = installLoot(G, mats, level);
  // the stacks: one mesh in the vehicle layer's body material (made once that layer is up, or with
  // a body material of our own if it never comes), full near the yard and cheap from across the lot
  const yard = level.groups.garage;
  const stacks = { full: null, low: null, tries: 0, near: true };
  const makeStacks = () => {
    const V = typeof window !== 'undefined' ? window.__vehicles : null;
    if (!(V && V.mats && V.mats.body) && stacks.tries++ < 90) return;
    const body = V && V.mats && V.mats.body ? V.mats.body : createCarMats(G).body;
    const geo = stackGeometries(REG.stackCars);
    for (const k of ['full', 'low']) {
      const m = new Mesh(geo[k], body);
      m.name = `stacks:${k}`; m.receiveShadow = true; m.castShadow = false; m.userData.noReflect = true; m.frustumCulled = true;
      yard.add(m); stacks[k] = m;
    }
  };
  let bays, baysOn = true;
  const blades = live.filter((l) => l.obj.kind === 'power' || l.obj.kind === 'box');
  const gain = mats.gain;
  let was = false, tOn = -10, n = 0;
  layer.updaters.push((dt, t) => {
    const on = !!(level.power && level.power.on);
    if (on && !was) tOn = t;
    was = on;
    const a = t - tOn;
    // neon strikes: a second of stutter, then steady with a breath of mains flicker
    gain[REG.power] = !on ? 0 : a < 1.1 ? (Math.sin(t * 61) * Math.sin(t * 23) > 0.1 - a ? 1 : 0.08) : 0.96 + 0.04 * Math.sin(t * 100);
    gain[REG.noPower] = on ? 0 : 1;
    mats.lift.value = on ? 0.05 : 0.016; // what the rooms' own light puts on a thing standing in them
    if (forced.box || forced.machines) { if (n < 4) { force(); n++; } }
    for (let i = 0; i < live.length; i++) { const l = live[i]; l.obj.update(dt, t, !l.group || l.group.visible); }
    if (loot) loot.update(dt, t);
    if (yard && REG.stackCars.length) {
      if (!stacks.full) makeStacks();
      else if (yard.visible) {
        const c = G.camera && G.camera.position;
        const dx = c ? Math.max(25.5 - c.x, 0, c.x - 44) : 0, dz = c ? Math.max(2.5 - c.z, 0, c.z - 19.5) : 0;
        const d = Math.hypot(dx, dz);
        stacks.near = d < (stacks.near ? 17 : 14);
        stacks.full.visible = stacks.near; stacks.low.visible = !stacks.near;
        // the bays' inside is not drawn from the far side of the forecourt (their doors are a few pixels there)
        if (bays === undefined) { bays = null; yard.traverse((o) => { if (o.name === 'art:garage:bays') bays = o; }); }
        if (bays && c) { const far = Math.hypot(Math.max(46 - c.x, 0), Math.max(4 - c.z, 0, c.z - 20)); baysOn = far < (baysOn ? 48 : 44); bays.visible = baysOn; }
      }
    }
    // small moving parts are not drawn from another zone (a draw call each, for nothing seen)
    const zone = level.zone;
    for (let i = 0; i < blades.length; i++) { const l = blades[i]; if (l.obj.group) l.obj.group.visible = l.obj.zone === zone || l.obj.state === 'rolling' || l.obj.state === 'offering'; }
  });
  if (typeof window !== 'undefined') window.__objects = { live, mats, loot };
}
onInstall(install);
void box;
