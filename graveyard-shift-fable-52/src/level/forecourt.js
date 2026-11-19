// The forecourt: a highway truck stop at night. buildForecourt() authors geometry and colliders
// (no renderer needed, so tests can run it) into the builder's 'forecourt' zone, with the diner
// door's dressing in its own zone ('door:d1', hidden when the door is bought); world.js assembles it
// with the other areas, turns the zones into meshes (meshesFor), registers the light fixtures
// (registerLights) and exposes the level contract as G.level.
import {
  Mesh, MeshStandardMaterial, MeshLambertMaterial, MeshBasicMaterial, Color, DoubleSide, CanvasTexture, RepeatWrapping,
  LinearMipmapLinearFilter, LinearFilter, Group, PlaneGeometry, Vector3, BufferGeometry, BufferAttribute,
  DataTexture, RGBAFormat, RGFormat, RedFormat, UnsignedByteType, ClampToEdgeWrapping,
} from 'three';
import { createBuilder, M, box, boxUp, rgb, cylUp, quadUV } from './build.js';
import { createAtlas } from './atlas.js';
import { createDecals } from './decals.js';
import { buildGroundDetail, paintGroundMask } from './props/ground.js';
import { createMaskPainter } from './groundMask.js';
import { createCollision } from './collision.js';
import * as L from './layout.js';
import { DRIVE_CLOSE_Z, DRIVE_GAPS, doors as WORLD_DOORS } from './worldLayout.js';
import { buildCar, CAR_PAINT } from './props/car.js';
import { buildTractor, buildTrailer, cargoBox, TRACTOR, TRAILER } from './props/truck.js';
import { buildIsland, ISLAND } from './props/pump.js';
import { buildCanopy, buildColumn, buildPriceSign } from './props/canopy.js';
import { buildLamp } from './props/lamp.js';
import { buildStore, buildDiner, DINER } from './props/store.js';
import { buildFence, fenceSign } from './props/fence.js';
import * as C from './props/clutter.js';
import { buildBackdrop, HIGHWAY } from './backdrop.js';
import { createFoliageTexture } from './props/foliage.js';

// several semantic names share one material (and so one draw call)
const ALIAS = {
  paintAlu: 'paintGalv', paintWhite: 'paintPump', paintNews: 'paintDrum',
  paintRed: 'paintCarA', paintAmber: 'paintYellow',
};

// lamp colours, chromaticity normalised to luminance 1 (same as render/lights.js), times radiance
const chroma = (r, g, b, k) => { const y = r * 0.2126 + g * 0.7152 + b * 0.0722; return [(r / y) * k, (g / y) * k, (b / y) * k]; };
const GLOW = {
  sodium: chroma(1.0, 0.46, 0.075, 90),
  canopy: chroma(0.74, 1.0, 0.84, 60),
  tube: chroma(0.8, 1.0, 0.9, 26),
  awning: chroma(1.0, 0.86, 0.62, 40),
};

export function buildForecourt({ rng, atlas, decals, builder }) {
  const B = builder || createBuilder();
  B.zone('forecourt');
  const rawAdd = B.add;
  B.add = (key, geo, opts) => rawAdd(ALIAS[key] || key, geo, opts);
  Object.assign(B, { rng, atlas, decals: decals || createDecals(rng.fork('decals')), glow: GLOW, fixtures: [], far: false, baseY: 0 });
  // everything opaque with a costly material also goes into one depth-only mesh drawn first, so
  // those materials shade each pixel once however the merged buckets happen to overlap
  B.prepass = (key) => /^(paint|chrome|rubber|concrete|wallStore|vcMatte|vcGloss|neonOff)/.test(key);
  const r = rng.fork('forecourt');

  // ---- ground
  const slab = (x0, z0, x1, z1) => B.add('asphalt', new PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2), { m: M((x0 + x1) / 2, 0, (z0 + z1) / 2) });
  slab(L.LOT.x0, L.LOT.z0, L.LOT.x1, L.LOT.z1);
  for (const d of L.DRIVES) slab(d[0] - 0.5, L.LOT.z1, d[1] + 0.5, 31);

  // ---- north side
  buildStore(B);
  buildDinerFront(B);

  // ---- canopy, islands, columns
  const lightStates = ['on', 'dead', 'on', 'on', 'on', 'flicker', 'dead', 'on', 'dead', 'on', 'on', 'dead'];
  const lights = [];
  [-8.4, -3.5, 1.3].forEach((z, j) => [-10.4, -4.6, 0.6, 6.4].forEach((x, i) => lights.push({ x, z, state: lightStates[j * 4 + i] })));
  buildCanopy(B, {
    ...L.CANOPY, lights,
    logos: [{ x: -2, z: L.CANOPY.z1 + 0.06, ry: 0, nits: 5 }, { x: L.CANOPY.x0 - 0.06, z: -3.5, ry: -Math.PI / 2, nits: 5 }, { x: L.CANOPY.x1 + 0.06, z: -3.5, ry: Math.PI / 2, nits: 0.06 }],
  });
  const pumpOpts = [
    [{ lcd: 'pumpLcdIdle', number: 1 }, { lcd: null, number: 2, dead: true }],
    [{ lcd: 'pumpLcdIdle', number: 3 }, { lcd: 'pumpLcd', number: 4 }],
    // pump 6: the hose is still in the red saloon's filler
    [{ lcd: 'pumpLcdIdle', number: 5, out: [{ face: -1, side: 1, to: [0.9, -0.12, -1.25], lay: true }] }, { lcd: 'pumpLcd', number: 6, out: [{ face: 1, side: -1, to: [-0.84, 0.6, 1.2] }] }],
    [{ lcd: null, number: 7, dead: true }, { lcd: 'pumpLcdIdle', number: 8 }],
  ];
  L.ISLANDS.forEach(([x, z], i) => {
    B.at(M(x, 0, z), () => {
      buildIsland(B, { pumps: pumpOpts[i] });
      B.at(M(0, ISLAND.height, 0), () => buildColumn(B, L.CANOPY.under - ISLAND.height + 0.06, { number: i + 1, extinguisher: i % 2 === 0, shutoff: i === 1 || i === 2, towel: true, pipe: i === 0 || i === 3 }));
      // pump numbers on blades hung from the soffit, back-lit so a driver finds his pump from the lane
      pumpOpts[i].forEach((p, k) => {
        const px = k ? 1.75 : -1.75, y = L.CANOPY.under - 0.5;
        // a lit box sign on a bracket: a channel bolted up to the soffit, two square drops, the cabinet
        B.add('paintGalv', box(0.66, 0.035, 0.16, 0.008, 1), { m: M(px, L.CANOPY.under + 0.035, 0) });
        for (const dx of [-0.2, 0.2]) {
          B.add('paintGalv', box(0.04, 0.24, 0.04), { m: M(px + dx, y + 0.39, 0) });
          B.add('paintGalv', box(0.09, 0.03, 0.12, 0.006, 1), { m: M(px + dx, y + 0.285, 0) });
        }
        B.add('paintGalv', box(0.03, 0.03, 0.03), { m: M(px, y + 0.4, 0, 0, 0, 0.78) }); // the cable gland
        B.add('vcMatte', box(0.6, 0.6, 0.13, 0.025, 2), { m: M(px, y, 0), color: rgb(0x0b1c1c), shadow: true });
        const uv = atlas.sub('numbers', (p.number - 1) / 8, 0, p.number / 8, 1);
        for (const f of [1, -1]) {
          B.add('atlasGlowVc', quadUV(0.5, 0.5, uv), { m: M(px, y, f * 0.067, 0, f > 0 ? 0 : Math.PI, 0), color: p.dead ? [0.05, 0.05, 0.05] : [0.9, 0.9, 0.9] });
          // the face sits in a rebate: a frame standing proud of it all round
          for (const [ex, ey, ew, eh] of [[0, 0.27, 0.6, 0.06], [0, -0.27, 0.6, 0.06], [0.27, 0, 0.06, 0.6], [-0.27, 0, 0.06, 0.6]]) B.add('vcMatte', box(ew, eh, 0.02), { m: M(px + ex, y + ey, f * 0.07), color: rgb(0x0b1c1c) });
        }
      });
      // forecourt bin on the island
      B.add('vcGloss', boxUp(0.42, 0.9, 0.42, 0.04, 2), { m: M(0.75, ISLAND.height, 0), color: rgb(0x1a2422), shadow: true });
      B.add('vcMatte', box(0.3, 0.1, 0.02), { m: M(0.75, ISLAND.height + 0.72, 0.212), color: rgb(0x050505) });
    });
  });

  // the pad under the canopy: slab joints, and a slot drain along its downhill edge
  const CN = L.CANOPY;
  const JOINT = rgb(0x0b0b0c);
  for (let x = CN.x0 + 1; x < CN.x1; x += 4) B.add('vcMatte', box(0.022, 0.004, CN.z1 - CN.z0 - 0.6), { m: M(x, 0.002, (CN.z0 + CN.z1) / 2), color: JOINT });
  for (const z of [CN.z0 + 0.3, -3.5, CN.z1 - 0.3]) B.add('vcMatte', box(CN.x1 - CN.x0 - 0.6, 0.004, 0.022), { m: M((CN.x0 + CN.x1) / 2, 0.002, z), color: JOINT });
  B.add('vcMatte', box(CN.x1 - CN.x0 - 2, 0.01, 0.2), { m: M((CN.x0 + CN.x1) / 2, 0.003, CN.z1 + 0.5), color: rgb(0x1b1c1d) });
  for (let x = CN.x0 + 1.2; x < CN.x1 - 1; x += 0.09) B.add('vcMatte', box(0.035, 0.012, 0.15), { m: M(x, 0.004, CN.z1 + 0.5), color: rgb(0x050505) });

  // ---- vehicles
  for (const v of L.vehicles) B.at(M(v.x, 0, v.z, 0, v.yaw, 0), () => buildCar(B, v));

  // jack-knifed lorry: trailer across the south-east, tractor folded back toward the pumps
  const psi = L.LORRY.yaw;
  const tx = L.LORRY.x, tz = L.LORRY.z;
  B.at(M(tx, 0, tz, 0, psi, 0), () => buildTrailer(B, { doorOpen: 1.9, cargo: true }));
  const kx = tx + Math.cos(psi) * TRAILER.kingpinX, kz = tz - Math.sin(psi) * TRAILER.kingpinX;
  const tyaw = psi + L.LORRY.fold;
  B.at(M(kx - Math.cos(tyaw) * TRACTOR.fifthX, 0, kz + Math.sin(tyaw) * TRACTOR.fifthX, 0, tyaw, 0), () => buildTractor(B, { doorAjar: 1.2, cabLight: 1, parking: true }));
  // cases dragged out of the back
  const rx = tx - Math.cos(psi) * (TRAILER.L / 2), rz = tz + Math.sin(psi) * (TRAILER.L / 2);
  for (const [dx, dz, ry, tint, tip] of [[1.0, 0.9, 0.4, 1, 0], [1.7, 0.2, 1.3, 0.85, 0], [0.5, 1.9, 2.2, 0.95, 0], [1.9, 1.5, 0.2, 0.8, 1], [1.05, 0.85, 0.9, 0.9, 2]]) {
    B.at(M(rx + dx, tip === 2 ? 0.45 : 0, rz + dz, tip === 1 ? 1.57 : 0, ry, 0), () => cargoBox(B, tint, tip !== 1));
  }

  // ---- lamp poles: three lit, one failing, one dead
  const lamp = (x, z, ry, state) => B.at(M(x, 0, z, 0, ry, 0), () => buildLamp(B, { state }));
  lamp(-19.6, 16.2, Math.PI / 4, 'on');
  lamp(20.8, -5.0, Math.PI, 'on');
  lamp(-22.75, -14.2, -0.39, 'on'); // just outside the wire by the north-west gap: whatever comes through is backlit
  lamp(0.5, 19.3, Math.PI / 2, 'flicker');
  lamp(20.8, -15.8, Math.PI, 'dead');

  B.at(M(-16.6, 0, 17.6, 0, 0.55, 0), () => buildPriceSign(B, { dimPlus: true }));

  // ---- fences. The torn panels are where zombies squeeze in (0.5 m: not the player); the sags are
  // the climb-over points. The east fence is the garage's and the alley's side now: open at the
  // alley's mouth, the scrapyard gate (d4) in its frame. The drives are fenced up to the barriers.
  const F = L.FENCE;
  const clean = { torn: false };
  buildFence(B, [F.w, F.alley], [F.w, F.s], { out: 1, ...L.fenceCuts('west', F.alley) });
  buildFence(B, [F.e, -20], [F.e, F.s], { out: -1, gaps: [L.EAST_CUTS.alley, L.EAST_CUTS.gate].map(([z0, z1]) => [z0 + 20, z1 + 20, clean]) });
  buildFence(B, [F.w, F.s], [F.e, F.s], { out: 1, gaps: L.DRIVES.map(([x0, x1]) => [x0 - 0.5 - F.w, x1 + 0.5 - F.w, clean]) });
  for (const [x0, x1] of L.DRIVES) {
    buildFence(B, [x0 - 0.5, F.s], [x0 - 0.5, DRIVE_CLOSE_Z], { out: 1 });
    buildFence(B, [x1 + 0.5, F.s], [x1 + 0.5, DRIVE_CLOSE_Z], { out: -1 });
  }
  buildFence(B, [F.w, F.alley], [-15, F.alley], { out: -1, ...L.fenceCuts('alley', F.w) });
  fenceSign(B, F.w + 0.03, -6.5, Math.PI / 2, 'noTrespass', 0.7, 0.5);
  fenceSign(B, 0.5, F.s - 0.03, Math.PI, 'noTrespass', 0.7, 0.5);
  // something to climb from, and what got left on the wire
  B.at(M(F.w - 0.5, 0, 3.4, 0, Math.PI / 2, 0), () => C.pallet(B, -1.25));
  B.add('vcMatte', box(0.7, 0.5, 0.03, 0.01, 1), { m: M(F.w + 0.3, 1.55, 2.7, 0.2, Math.PI / 2, 0.1), color: rgb(0x4a1512) });
  B.add('vcMatte', box(0.6, 0.45, 0.03, 0.01, 1), { m: M(F.e - 0.33, 1.52, 1.9, 0.25, Math.PI / 2, -0.12), color: rgb(0x26303a) });
  // ---- drives: closed by jersey barriers two high, a wreck shoved against them from the road side,
  // and one 0.5 m gap (a zombie turns sideways through it; the player does not fit). Trestles and
  // cones from before the barriers came.
  L.DRIVES.forEach(([x0, x1], k) => {
    const cx = (x0 + x1) / 2;
    const a = x0 - 0.5, b = x1 + 0.5, g = DRIVE_GAPS[k];
    for (const [p, q] of [[a, g - 0.25], [g + 0.25, b]]) {
      const n = Math.max(1, Math.round((q - p) / 2.2));
      const w = (q - p) / n;
      for (let i = 0; i < n; i++) {
        const ux = p + w * (i + 0.5);
        const edge = (i === 0 && p > a) || (i === n - 1 && q < b); // the units either side of the gap stay square to it
        B.at(M(ux, 0, DRIVE_CLOSE_Z, 0, edge ? 0 : (i % 2 ? 0.015 : -0.012), 0), () => C.barrier(B, w - 0.02));
        B.at(M(ux + (edge ? 0 : (i % 2 ? 0.06 : -0.05)), 0.82, DRIVE_CLOSE_Z, 0, edge ? 0 : (i % 2 ? -0.02 : 0.018), 0), () => C.barrier(B, w - (edge ? 0.02 : 0.2)));
      }
    }
    const wx = k === 0 ? -13.6 : 11.8;
    B.at(M(wx, 0, DRIVE_CLOSE_Z + 1.75, 0, k === 0 ? 0.1 : Math.PI - 0.08, 0), () => buildCar(B, { id: `wreck${k}`, type: 'sedan', paint: k ? 'paintCarC' : 'paintCarE', plate: 'plateC', flat: 'fl' }));
    // The trestle and the cones stand on the road side, where whoever closed the drive left them:
    // inside, a cone (0.28 m, a step) is a way up onto the trestle and the trestle onto the barriers.
    const away = g <= cx ? 1 : -1; // the side of the drive away from the gap: the way in stays clear
    B.at(M(cx + away * 1.6, 0, DRIVE_CLOSE_Z + 3.6, 0, 0.12, 0), () => C.trestle(B, 2.3));
    B.at(M(cx - away * 2.4, 0, DRIVE_CLOSE_Z + 3.1, 0, -0.5, 0), () => C.cone(B, false));
    B.at(M(cx + away * 3.2, 0, DRIVE_CLOSE_Z + 2.4, 0, 0, 0), () => C.cone(B, true));
  });

  // ---- alley: bins, pallets, drums
  B.at(M(-20.2, 0, -24.2, 0, Math.PI / 2 + 0.06, 0), () => C.dumpster(B, 1.2));
  B.at(M(-20.4, 0, -27.0, 0, Math.PI / 2 - 0.04, 0), () => C.dumpster(B, 0.1));
  B.at(M(-16.4, 0, -22.3), () => C.pallet(B));
  B.at(M(-16.4, 0.14, -22.3, 0, 0.3, 0), () => C.pallet(B));
  B.at(M(-15.5, 0.2, -25.5, 0, 0, 0), () => C.pallet(B, -1.35));
  B.at(M(-16.2, 0, -28.2), () => C.drum(B));
  B.at(M(-16.9, 0, -28.6), () => C.drum(B));
  B.at(M(-17.2, 0, -26.9, 0, 0.7, 0), () => C.drum(B, 'paintDrum', true));
  B.at(M(-21.3, 0, -21.3), () => C.tyreStack(B, 4, r));

  // ---- forecourt clutter
  for (const x of [-11.3, -8.7, -6.1, 2.3, 4.9]) B.at(M(x, 0, -16.75), () => C.parkingStop(B));
  for (const [x, z] of L.DRAINS) B.at(M(x, 0, z), () => C.drain(B));
  B.at(M(13.5, 0, -3.5), () => C.manhole(B));
  B.at(M(-17.5, 0, -1.5), () => C.manhole(B));
  // tank filler covers by the canopy
  [[10.6, 0.2, 0x7a1010], [11.5, 0.9, 0x0f3a7a], [10.5, 1.5, 0x7a6a10]].forEach(([x, z, c]) => B.add('vcGloss', cylUp(0.16, 0.16, 0.02, 12), { m: M(x, 0, z), color: rgb(c) }));
  // cones someone set out round the lorry, most of them knocked flat
  for (const [x, z, tip] of [[5.0, 8.6, 0], [3.2, 13.2, 1], [6.6, 14.2, 0], [9.4, 15.2, 1], [1.5, 10.4, 0]]) B.at(M(x, 0, z, 0, r.range(0, 6), 0), () => C.cone(B, !!tip));
  for (const [x, z, tip] of [[-16.8, 8.3, 0], [-19.2, 6.8, 1]]) B.at(M(x, 0, z, 0, r.range(0, 6), 0), () => C.cone(B, !!tip));
  // flares put down behind the trailer: one still burning
  B.at(M(19.5, 0, 15.6, 0, 0.8, 0), () => C.flare(B, true));
  B.at(M(17.2, 0, 18.3, 0, 2.2, 0), () => C.flare(B, false));
  B.at(M(4.6, 0, 12.6, 0, -0.6, 0), () => C.flare(B, false));
  B.at(M(-2.6, 0, 9.6, 0, 0.7, 0), () => C.duffel(B, r));
  B.at(M(-10.4, 0, 4.1, 0, -0.4, 0), () => C.suitcase(B));
  B.at(M(-0.6, 0.15, -18.3, 0, 0.8, 0), () => C.shoppingBasket(B));
  // what was dragged in front of the diner door before whoever it was gave up on it
  B.at(M(12.7, 0, -16.45, 0, 0.05, 0), () => C.barricade(B, r));
  B.at(M(-5.6, 0, -14.8, 0, 0.7, 0), () => C.trolley(B));
  B.at(M(16.2, 0, 17.6), () => C.tyreStack(B, 2, r));
  for (const [x, z, n, rad] of [[-3, -14, 8, 3], [-9, 3.5, 6, 2.5], [6, -3.5, 5, 3], [17.5, 16.5, 12, 2.5], [-19.5, 5, 6, 2], [12, -16, 6, 2.5], [-19, -24, 14, 3]]) {
    B.at(M(x, 0, z), () => C.litter(B, r, n, rad));
  }

  buildGroundDetail(B, r.fork('ground'));

  // ---- beyond the fence
  const F2 = L.FENCE;
  buildBackdrop(B, {
    lot: L.LOT, drives: L.DRIVES, clear: L.clearings,
    weeds: [
      [F2.w + 0.25, -19, F2.w + 0.25, 20, 70], [F2.e - 0.25, -19, F2.e - 0.25, 20, 60], [F2.w + 0.4, F2.s - 0.25, -14.5, F2.s - 0.25, 14],
      [-6.5, F2.s - 0.25, 4.5, F2.s - 0.25, 18], [12.5, F2.s - 0.25, F2.e, F2.s - 0.25, 16], [F2.w + 0.3, -29.6, -15.3, -29.6, 14],
      [-15.2, -29, -15.2, -20.5, 10], [-18, 17.2, -15, 18.4, 8], [19, -16.8, 22, -17, 6],
    ],
  });

  return { B, colliders: B.colliders, fixtures: B.fixtures, rainOccluders: B.rainOccluders, decals: B.decals };
}

// The diner's front (props/store.js) with the structural edits, made from outside that file:
// a real doorway for d1 (the facade wall and the chrome ribs across it are cut round the opening),
// everything nailed or stacked in the opening (plywood, planks, chain, the dark recess, the
// sandbags and their collider) built into the door's own zone 'door:d1' so it goes when the door is
// bought, no east end wall (the kitchen runs on to x 26.6) and no solid block behind the facade
// (the diner is a room: worldLayout's structure has its walls).
const _c = new Vector3();
function buildDinerFront(B) {
  const d1 = WORLD_DOORS.find((d) => d.id === 'd1');
  const { x0, x1, zf, zb, h } = DINER;
  const ox0 = d1.rect.x0, ox1 = d1.rect.x1, oh = d1.h;
  const add = B.add, collide = B.collide;
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  const inDoor = (c) => c.x > ox0 + 0.05 && c.x < ox1 - 0.05 && c.y < oh - 0.05 && c.z > zf - 0.35 && c.z < zf + 1.0;
  const centreOf = (geo, m) => { geo.computeBoundingBox(); geo.boundingBox.getCenter(_c); return _c.applyMatrix4(m ? B.matrix().multiply(m) : B.matrix()); };
  const piece = (key, a, b, ya, yb, z, d, extra = {}) => { if (b - a > 1e-3 && yb - ya > 1e-3) add(key, box(b - a, yb - ya, d), { ...extra, m: M((a + b) / 2, (ya + yb) / 2, z) }); };
  B.add = (key, geo, opts = {}) => {
    const p = geo.parameters || {};
    if (key === 'paintDiner' && near(p.width, x1 - x0) && near(p.depth, 0.3)) { // the front wall
      geo.dispose();
      const z = zf - 0.15;
      piece(key, x0, ox0, 0, h, z, 0.3, { shadow: true });
      piece(key, ox1, x1, 0, h, z, 0.3, { shadow: true });
      piece(key, ox0, ox1, oh, h, z, 0.3, { shadow: true });
      collide([x0, 0, zf - 0.3], [ox0, h, zf]);
      collide([ox1, 0, zf - 0.3], [x1, h, zf]);
      collide([ox0, oh, zf - 0.3], [ox1, h, zf]);
      return B;
    }
    if (key === 'paintDiner' && near(p.width, 0.3) && near(p.depth, zf - zb)) { geo.dispose(); return B; } // the end wall
    if (key === 'chrome' && near(p.width, x1 - x0) && near(p.height, 0.03) && opts.m) { // a rib across the doorway
      const e = opts.m.elements, y = e[13], z = e[14];
      geo.dispose();
      if (y < oh) {
        add(key, box(ox0 - x0, 0.03, 0.03, 0.01, 1), { m: M((x0 + ox0) / 2, y, z) });
        add(key, box(x1 - ox1, 0.03, 0.03, 0.01, 1), { m: M((ox1 + x1) / 2, y, z) });
      } else add(key, box(x1 - x0, 0.03, 0.03, 0.01, 1), { m: M((x0 + x1) / 2, y, z) });
      return B;
    }
    if (inDoor(centreOf(geo, opts.m))) {
      // the door's own group: no depth pre-pass copy (one draw call fewer while it stands)
      const pp = B.prepass;
      B.prepass = null;
      try { return B.inZone('door:d1', () => add(key, geo, opts)); } finally { B.prepass = pp; }
    }
    return add(key, geo, opts);
  };
  B.collide = (mn, mx, surface, slice) => {
    if (near(mn[2], zb) && near(mx[2], zf) && near(mn[0], x0)) return B; // the solid block behind the facade
    _c.set((mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2).applyMatrix4(B.matrix());
    if (inDoor(_c)) {
      const before = B.colliders.length;
      B.tag('door:d1', () => collide(mn, mx, surface, slice));
      for (let i = before; i < B.colliders.length; i++) B.colliders[i].door = 'd1';
      return B;
    }
    return collide(mn, mx, surface, slice);
  };
  try { buildDiner(B); } finally { B.add = add; B.collide = collide; }
}

// Chain-link pattern: two sets of diagonal wires, as an alpha texture that tiles once per diamond.
function fenceTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  g.clearRect(0, 0, S, S);
  g.strokeStyle = '#fff'; g.lineWidth = 6.5; g.lineCap = 'square';
  for (const o of [-S, 0, S]) {
    g.beginPath(); g.moveTo(o - 4, -4); g.lineTo(o + S + 4, S + 4); g.stroke();
    g.beginPath(); g.moveTo(o + S + 4, -4); g.lineTo(o - 4, S + 4); g.stroke();
  }
  const t = new CanvasTexture(c);
  t.wrapS = RepeatWrapping; t.wrapT = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter;
  t.anisotropy = 1; // anisotropic sampling keeps the weave sharp at a slant, which is exactly where it moires
  return t;
}

// Soft rounded-rectangle falloff for contact shadows.
function blobTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = Math.abs((x + 0.5) / S - 0.5) * 2, v = Math.abs((y + 0.5) / S - 0.5) * 2;
    const d = Math.max(0, 1 - Math.hypot(Math.max(0, u - 0.45), Math.max(0, v - 0.45)) / 0.55);
    const a = d * d * (3 - 2 * d);
    const k = (y * S + x) * 4;
    img.data[k] = 255; img.data[k + 1] = 255; img.data[k + 2] = 255; img.data[k + 3] = Math.round(255 * a);
  }
  g.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.minFilter = LinearFilter; t.magFilter = LinearFilter; t.generateMipmaps = false;
  return t;
}

// foliage cards: sharpen the alpha edge so mipped needles stay solid instead of fading to a haze
function foliageMaterial(map) {
  const mat = new MeshLambertMaterial({ map, alphaTest: 0.08, alphaToCoverage: true }); // diffuse only: no sky sheen on edge-on cards
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>',
      'diffuseColor.a = clamp((diffuseColor.a - 0.2) / max(fwidth(diffuseColor.a) * 1.5, 0.08) + 0.5, 0.0, 1.0);\n#include <alphatest_fragment>')
      // the far side of a tree is hidden by the tree: cards there must not show the light that falls on it
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\ndiffuseColor.rgb *= mix(0.1, 1.0, smoothstep(-0.2, 0.4, dot(normal, normalize(vViewPosition))));')
      // A Lambert material takes nothing from the sky's environment, so away from the lamps grass and
      // trees were pure black. The night sky's fill, as radiance per unit albedo (cool, about what
      // the environment gives the standard materials beside them).
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(0.17, 0.22, 0.3);');
  };
  mat.customProgramCacheKey = () => 'level:foliage';
  return mat;
}

// The plain vertex-coloured props (cardboard, the trailer's liner, frames, trims, plinths) were one
// flat colour each beside the worn pumps. This gives the matte bucket a surface without giving it a
// draw call: tonal blotches and grain, scuffed pale edges, drip streaks down upright faces, a damp
// darker crown on what faces the rain, and dirt thrown up along the foot. All of it from the
// load-time noise volumes (four fetches), placed in world space.
function worn(mat, noise) {
  if (!noise || !noise.tNzA || !noise.tNzB) return mat;
  const u = { tNzA: { value: noise.tNzA }, tNzB: { value: noise.tNzB } };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWornP;\nvarying vec3 vWornN;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWornP = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWornN = mat3(modelMatrix) * objectNormal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform highp sampler3D tNzA;\nuniform highp sampler3D tNzB;\nvarying vec3 vWornP;\nvarying vec3 vWornN;\nfloat gWornRough = 0.0;')
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
{
  vec3 wn = normalize(vWornN);
  float lum = dot(diffuseColor.rgb, vec3(0.3, 0.6, 0.1));
  float blotch = texture(tNzA, vWornP * 0.14).x;                 // about a metre across
  float grain = texture(tNzA, vWornP * 3.1 + 0.37).x;            // a few centimetres
  float up = smoothstep(0.5, 0.9, wn.y);
  float wall = 1.0 - smoothstep(0.2, 0.6, abs(wn.y));
  // streaks: noise stretched down the face
  float streak = texture(tNzB, vec3(vWornP.x * 1.7 + vWornP.z * 1.3, vWornP.y * 0.06, vWornP.z * 1.7 - vWornP.x * 1.3)).a;
  float mid = texture(tNzA, vWornP * 0.75 + 0.11).x;              // a hand's width: scuffs, water marks
  vec3 c = diffuseColor.rgb * (0.72 + 0.56 * blotch) * (0.74 + 0.52 * mid) * (0.9 + 0.2 * grain);
  c *= 1.0 - 0.3 * wall * smoothstep(0.52, 0.75, streak);
  // scuffed edges: where the normal turns within a pixel or two (the bevels), the surface is rubbed pale
  float edge = smoothstep(0.03, 0.25, length(fwidth(wn))) * smoothstep(0.35, 0.6, grain + 0.25 * blotch);
  c = mix(c, c * 1.5 + 0.035 * smoothstep(0.02, 0.15, lum), 0.55 * edge);
  // rain: what faces up is soaked darker in patches and shines; dirt is thrown up along the foot
  float soak = up * smoothstep(0.3, 0.6, blotch + 0.3 * grain);
  c *= 1.0 - 0.32 * soak;
  float foot = (1.0 - smoothstep(0.03, 0.3, vWornP.y)) * wall * (0.4 + 0.6 * grain);
  c = mix(c, c * 0.55 + vec3(0.006, 0.005, 0.004), 0.6 * foot);
  diffuseColor.rgb = c;
  gWornRough = -0.35 * soak + 0.1 * foot;
}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + gWornRough, 0.25, 1.0);');
  };
  mat.customProgramCacheKey = () => 'level:worn';
  return mat;
}

// The lot's history for the ground material (stains, wheel polish, patches, cracks): painted on
// the CPU by props/ground.js, uploaded as the two maps mats/ground.js documents under `detail`.
function groundDetail(rng) {
  const P = createMaskPainter(rng.fork('mask'));
  paintGroundMask(P, rng.fork('paint'));
  const m = P.finish();
  const tex = (data, size, format, mips) => {
    const t = new DataTexture(data, size, size, format, UnsignedByteType);
    t.wrapS = ClampToEdgeWrapping; t.wrapT = ClampToEdgeWrapping;
    t.magFilter = LinearFilter; t.minFilter = mips ? LinearMipmapLinearFilter : LinearFilter;
    t.generateMipmaps = mips; t.anisotropy = mips ? 4 : 1;
    t.needsUpdate = true;
    return t;
  };
  return {
    map: tex(m.data, m.size, RGBAFormat, true), crackMap: tex(m.crack, m.crackSize, RGFormat, false), rect: m.rect, crackRange: m.crackRange,
    bloodMap: tex(m.blood, m.bloodSize, RedFormat, true), bloodRect: m.bloodRect,
  };
}

function makeMaterials(G, atlas, decals) {
  const m = G.mats;
  const paint = (color, o = {}) => m.paintedMetal({ color, wear: 0.35, rust: 0.4, dirt: 0.5, ...o });
  const std = (o) => new MeshStandardMaterial({ vertexColors: true, ...o });
  const glow = (o = {}) => new MeshBasicMaterial({ toneMapped: false, fog: false, ...o });
  const fenceTex = fenceTexture();
  const uvPaint = new MeshStandardMaterial({ map: decals.lit, transparent: true, depthWrite: false, alphaTest: 0.02, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  return {
    asphalt: m.asphalt({ ...L.ground, detail: groundDetail(G.rng.fork('ground')) }),
    concrete: m.concrete({ color: 0x8a877f, age: 0.65 }),
    concreteKerb: m.concrete({ color: 0x8a877f, age: 0.6, paint: 0xc9a416, paintWear: 0.6 }),
    wallStore: m.concrete({ color: 0x9a968a, panel: [0.4, 0.2], paint: 0xcabfa2, paintWear: 0.32, age: 0.55, shelter: 0.25 }),
    paintCanopy: paint(0xd6d4cb, { wear: 0.12, rust: 0.35, dirt: 0.5, roughness: 0.42, shelter: 0.5 }),
    // every painted metal in one draw (see foldBuckets). Made here, among the paints: three draws
    // opaque meshes of one render order by material id, so the fold keeps the paints' place in that order
    paintFold: paintFoldMaterial(m),
    paintTeal: paint(0x0c7f79, { wear: 0.3, shelter: 0.3 }),
    paintPump: paint(0xcfcdc3, { wear: 0.3, dirt: 0.55, shelter: 0.85 }),
    paintYellow: paint(0xd7a50d, { wear: 0.42, rust: 0.5 }),
    paintGalv: paint(0x767c80, { wear: 0.18, rust: 0.5, roughness: 0.42 }),
    paintDiner: paint(0xa7abae, { wear: 0.22, rust: 0.5, roughness: 0.28, dirt: 0.6 }),
    paintDumpster: paint(0x1f4632, { wear: 0.7, rust: 0.7, dirt: 0.7 }),
    paintDoor: paint(0x232c29, { wear: 0.12, rust: 0.3, dirt: 0.45, roughness: 0.5, shelter: 0.7 }),
    paintDrum: paint(0x1c4384, { wear: 0.55, rust: 0.6 }),
    paintCarA: paint(CAR_PAINT.paintCarA, { wear: 0.12, rust: 0.25, roughness: 0.18, dirt: 0.35 }),
    paintCarB: paint(CAR_PAINT.paintCarB, { wear: 0.16, rust: 0.4, roughness: 0.22, dirt: 0.5 }),
    paintCarC: paint(CAR_PAINT.paintCarC, { wear: 0.14, rust: 0.3, roughness: 0.2, dirt: 0.4 }),
    paintCarD: paint(CAR_PAINT.paintCarD, { wear: 0.08, rust: 0.2, roughness: 0.14, dirt: 0.35 }),
    paintCarE: paint(CAR_PAINT.paintCarE, { wear: 0.3, rust: 0.55, roughness: 0.28, dirt: 0.5 }),
    paintCarF: paint(CAR_PAINT.paintCarF, { wear: 0.15, rust: 0.3, roughness: 0.2 }),
    paintTruck: paint(0x9a3a12, { wear: 0.1, rust: 0.25, roughness: 0.2, dirt: 0.4 }), // burnt orange: a navy cab was a hole in the night
    paintTrailer: paint(0xd3d1c8, { wear: 0.2, rust: 0.5, roughness: 0.4, dirt: 0.8 }),
    rubber: m.rubber({}),
    chrome: m.chrome({ roughness: 0.12, age: 0.45 }),
    glassCar: m.glass({ tint: 0x05080a, opacity: 0.88, dirt: 0.04, mist: 0 }),
    // shop glazing: dark tinted float glass, grimy toward the sill, hardly misted: the room is seen
    // through it, dimmed, and the forecourt's lamps show on it; it must never read as a white card
    glassStore: m.glass({ tint: 0x33423e, opacity: 0.36, dirt: 0.5, mist: 0.1, shelter: 0.6 }),
    neonOff: m.neon({ color: 0xff2a3a, on: 0 }),
    vcMatte: worn(std({ roughness: 0.85 }), m.noise),
    vcGloss: std({ roughness: 0.3 }),
    vcJam: std({ roughness: 0.34 }), // the highway's traffic: plain, far away, no depth pre-pass
    vcTerrain: std({ roughness: 0.96 }),
    uvFoliage: foliageMaterial(createFoliageTexture(G.rng.fork('foliage'))),
    vcGlow: glow({ vertexColors: true }),
    glowFold: glowFoldMaterial(), // every plain glow in one draw (see foldBuckets), in the static glow's place in the draw order
    vcFar: glow({ color: new Color(0.0035, 0.0048, 0.006) }),
    atlasLit: new MeshStandardMaterial({ map: atlas.texture, alphaTest: 0.25, alphaToCoverage: true, roughness: 0.65, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    atlasGlowVc: glow({ map: atlas.texture, vertexColors: true }),
    // what lies on the ground rather than being part of it: worn paint, leaves, litter (uvPaint),
    // and the same sheet for the handprints on the saloon's glass (uvPaintGlass, drawn after glass)
    uvPaint,
    uvPaintGlass: uvPaint,
    uvFence: new MeshStandardMaterial({ color: 0x8f969a, map: fenceTex, alphaTest: 0.04, alphaToCoverage: true, side: DoubleSide, roughness: 0.45, metalness: 0.75 }),
    blinkA: glow({ color: 0x000000 }), blinkB: glow({ color: 0x000000 }), blinkC: glow({ color: 0x000000 }), blinkD: glow({ color: 0x000000 }),
    vcBuzz: glow({ vertexColors: true }),
    flickA: glow({ color: 0x000000 }), flickB: glow({ color: 0x000000 }), flickC: glow({ color: 0x000000 }), flickD: glow({ color: 0x000000 }), flickE: glow({ color: 0x000000 }),
    uvBlob: new MeshBasicMaterial({ map: blobTexture(), color: 0x000000, transparent: true, opacity: 0.8, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    vcRefl: new MeshLambertMaterial({ vertexColors: true, side: DoubleSide }),
    shadow: new MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
    depth: new MeshBasicMaterial({ colorWrite: false }),
  };
}

// ---- folded buckets ------------------------------------------------------------------------------
// One bucket is one draw call. The plain glows (the static vcGlow, the hazard blinkers and beacon,
// the lamp faces that follow a fixture's flicker, the OPEN sign's buzz) differ only in a colour
// that update() rewrites each frame, and the painted metals only in their paint's uniforms. So each
// family is drawn as one mesh: the glows with a per-vertex group index into an array of those very
// colours (the trick mats/interior.js uses for its light groups), the paints with their colour,
// wear, rust, roughness, dirt and shelter carried per vertex. Same pixels, one draw each, in the
// main view and in the puddle reflection.
const GLOW_KEYS = ['vcGlow', 'blinkA', 'blinkB', 'blinkC', 'blinkD', 'flickA', 'flickB', 'flickC', 'flickD', 'flickE', 'vcBuzz'];
const PAINT_KEYS = ['paintGalv', 'paintCanopy', 'paintTeal', 'paintPump', 'paintYellow', 'paintDiner', 'paintDumpster', 'paintDoor', 'paintDrum',
  'paintCarA', 'paintCarB', 'paintCarC', 'paintCarD', 'paintCarE', 'paintCarF', 'paintTruck', 'paintTrailer'];
const WHITE = new Color(1, 1, 1);

function glowFoldMaterial() {
  const mat = new MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false });
  const gains = { value: GLOW_KEYS.map(() => WHITE) }; // filled with the live colours by bindGlowFold
  mat.userData.gains = gains;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = gains;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float aGlow;\nuniform vec3 uGlow[${GLOW_KEYS.length}];\nvarying vec3 vGlowGain;`)
      .replace('#include <color_vertex>', '#include <color_vertex>\nvGlowGain = uGlow[int(aGlow + 0.5)];');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGlowGain;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vGlowGain;');
  };
  mat.customProgramCacheKey = () => 'level:glowFold';
  return mat;
}
// the folded glow reads the very Color objects update() writes (a group's material colour times its
// vertex colour, as the separate buckets drew it; the static glow's group is plain white)
function bindGlowFold(mats) {
  const g = mats.glowFold.userData.gains;
  g.value = GLOW_KEYS.map((k) => (k === 'vcGlow' ? WHITE : mats[k].color));
}

function paintFoldMaterial(m) {
  const mat = m.paintedMetal({ color: 0xffffff });
  const base = mat.onBeforeCompile;
  const PER_VERTEX = [['vec3', 'uPColor', 'aPColor'], ['float', 'uPWear', 'aPWear'], ['float', 'uPRust', 'aPRust'], ['float', 'uPRough', 'aPRough'], ['float', 'uPDirt', 'aPDirt'], ['float', 'uShelter', 'aPShelter']];
  mat.onBeforeCompile = (shader, renderer) => {
    base(shader, renderer);
    let v = shader.vertexShader, f = shader.fragmentShader;
    const decl = PER_VERTEX.map(([t, u, a]) => `attribute ${t} ${a};\nvarying ${t} v${a};`).join('\n');
    const copy = PER_VERTEX.map(([, , a]) => `v${a} = ${a};`).join('\n');
    v = v.replace('#include <common>', `#include <common>\n${decl}`).replace('#include <project_vertex>', `#include <project_vertex>\n${copy}`);
    for (const [t, u, a] of PER_VERTEX) {
      const was = `uniform ${t} ${u};`;
      if (!f.includes(was)) throw new Error(`level: paintFold cannot find "${was}" in the paint program`);
      f = f.replace(was, `varying ${t} v${a};\n#define ${u} v${a}`);
    }
    shader.vertexShader = v; shader.fragmentShader = f;
  };
  mat.customProgramCacheKey = () => 'surf:paintedMetal:fold';
  return mat;
}

// A zone's buckets with the glow and paint families each merged into one geometry (keys 'glowFold'
// and 'paintFold') carrying what tells its members apart. A family with one member is folded too
// (it costs nothing and keeps one program per family). Returns a new Map; the inputs are disposed.
function foldBuckets(geos, mats) {
  const out = new Map();
  const glow = [], paint = [];
  for (const [key, geo] of geos) {
    if (GLOW_KEYS.includes(key)) glow.push([key, geo]);
    else if (PAINT_KEYS.includes(key) && mats[key] && mats[key].surf) paint.push([key, geo]);
    else out.set(key, geo);
  }
  // within a fold the members go in the order three drew them as separate meshes (material id), so a
  // face that met another family member face-on comes out the same way round
  const byId = (p, q) => mats[p[0]].id - mats[q[0]].id;
  glow.sort(byId); paint.sort(byId);
  if (glow.length) {
    out.set('glowFold', mergeFamily(glow, (key, n) => {
      const col = new Float32Array(n * 3).fill(1), grp = new Float32Array(n).fill(GLOW_KEYS.indexOf(key));
      return { aGlow: new BufferAttribute(grp, 1), ...(n ? { color: new BufferAttribute(col, 3) } : {}) };
    }, (geo) => geo.getAttribute('color')));
  }
  if (paint.length) {
    out.set('paintFold', mergeFamily(paint, (key, n) => {
      const u = mats[key].surf;
      const fill = (size, vals) => { const a = new Float32Array(n * size); for (let i = 0; i < n; i++) for (let k = 0; k < size; k++) a[i * size + k] = vals[k]; return new BufferAttribute(a, size); };
      const c = u.uPColor.value;
      return { aPColor: fill(3, [c.r, c.g, c.b]), aPWear: fill(1, [u.uPWear.value]), aPRust: fill(1, [u.uPRust.value]), aPRough: fill(1, [u.uPRough.value]), aPDirt: fill(1, [u.uPDirt.value]), aPShelter: fill(1, [u.uShelter.value]) };
    }));
  }
  return out;
}
// Merge [key, geometry] pairs (indexed, position + normal at least) into one indexed geometry, with
// per-member attributes from attrs(key, vertexCount); keepColor(geo) returns a member's own colour
// attribute to use in place of the default one attrs made.
function mergeFamily(list, attrs, keepColor = () => null) {
  let nv = 0, ni = 0;
  for (const [, g] of list) { nv += g.getAttribute('position').count; ni += g.index.count; }
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  const extra = {};
  let v = 0, i = 0;
  for (const [key, g] of list) {
    const n = g.getAttribute('position').count;
    pos.set(g.getAttribute('position').array, v * 3);
    nrm.set(g.getAttribute('normal').array, v * 3);
    const ix = g.index.array;
    for (let k = 0; k < ix.length; k++) idx[i + k] = ix[k] + v;
    const a = attrs(key, n);
    const own = keepColor(g);
    if (own) a.color = own;
    for (const [name, attr] of Object.entries(a)) {
      if (!extra[name]) extra[name] = new Float32Array(nv * attr.itemSize);
      extra[name].set(attr.array, v * attr.itemSize);
    }
    v += n; i += ix.length;
    g.dispose();
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('normal', new BufferAttribute(nrm, 3));
  for (const [name, arr] of Object.entries(extra)) geo.setAttribute(name, new BufferAttribute(arr, arr.length / nv));
  geo.setIndex(new BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

const TRANSPARENT = new Set(['glassCar', 'glassStore']);
// What the puddle reflection draws: the cheap stand-ins (vcRefl: cars, lorry, pumps, canopy deck,
// store shell, tree spires as plain lit boxes) and everything that emits light. Nothing else.
const REFLECT = /^(vcRefl|vcGlow|vcBuzz|atlasGlow|blink|flick|vcFar|glowFold)/;
const HIDE = [1, -1]; // a draw range three skips before it issues a draw call
// Is this draw the puddle reflection's mirrored view? Asked by the stand-ins, which are drawn in
// that view only. Three answers, strongest first, so no one convention has to hold:
//   1. the reflection pass says so: `camera.userData.reflection === true` on its mirrored camera,
//      or `level.reflecting` set true for the duration of its draw (the documented hook; either
//      is enough, neither exists in the pass yet: see the notes on the hint system);
//   2. the camera is below the ground plane: only a camera mirrored in the ground can be, since
//      the player's never is;
//   3. the render target's texture is named 'reflection' (what the pass does today).
// If all three fail the stand-ins simply stay hidden: puddles lose the cars and the canopy but
// keep every lamp and sign, and nothing is ever drawn into the main view by mistake.
function isReflection(renderer, camera, level) {
  if (camera && camera.userData && camera.userData.reflection === true) return true;
  if (level && level.reflecting === true) return true;
  if (camera && camera.matrixWorld.elements[13] < GROUND_Y - 0.02) return true;
  const t = renderer.getRenderTarget();
  return !!t && !!t.texture && t.texture.name === 'reflection';
}
const GROUND_Y = 0;

function registerLights(G, fixtures) {
  const Lt = G.lights;
  const c = Lt.colors;
  const out = { hazards: [], hazardsFar: { C: [], D: [] }, flick: {} };
  // Each fixture draws its flicker phase from one shared stream as it is added, so the order is part
  // of the look: fixtures added to the level later (LATE) are registered after everything else and
  // leave every earlier lamp's flicker, and so every earlier still, exactly as it was.
  const LATE = new Set(['storeFlood', 'trailerWork']);
  const ordered = [...fixtures.filter((f) => !LATE.has(f.kind)), ...fixtures.filter((f) => LATE.has(f.kind))];
  for (const f of ordered) {
    switch (f.kind) {
      case 'canopy': {
        const h = Lt.add({ type: 'spot', pos: f.pos, dir: [0, -1, 0], color: c.canopy, lumens: 8200, range: 15, cone: 1.27, penumbra: 0.6, size: 0.28, castShadow: true, flicker: f.flicker ? { amount: 0.9, speed: 2.6, kind: 'stutter' } : 0 });
        if (f.flicker) out.flick.flickA = { h, color: GLOW.canopy };
        break;
      }
      case 'sodium': {
        const h = Lt.add({ type: 'spot', pos: f.pos, dir: f.dir, color: c.sodium, lumens: 26000, range: 24, cone: 0.98, penumbra: 0.4, size: 0.3, castShadow: true, flicker: f.flicker ? { amount: 0.85, speed: 1.7, kind: 'stutter' } : 0.04 });
        if (f.flicker) out.flick.flickB = { h, color: GLOW.sodium };
        break;
      }
      case 'sodiumFar':
        Lt.add({ type: 'spot', pos: f.pos, dir: f.dir, color: c.sodium, lumens: 26000, range: 22, cone: 1.0, penumbra: 0.5, groundY: HIGHWAY.y - 0.08, priority: 0.05, flicker: 0.04 });
        break;
      case 'awning':
        Lt.add({ type: 'spot', pos: f.pos, dir: [0, -1, 0.12], color: [1.0, 0.86, 0.62], lumens: 1500, range: 7, cone: 0.95, penumbra: 0.6, size: 0.12, priority: 0.8 });
        break;
      case 'storeSpill': {
        // the store's own light, leaving through the glazing only (see props/store.js)
        const h = Lt.add({ type: 'spot', pos: f.pos, dir: f.dir, color: c.fluorescent, lumens: 1100, range: 9, cone: 0.62, penumbra: 0.7, size: 0.5, priority: 0.9, flicker: f.flicker ? { amount: 0.6, speed: 2.2, kind: 'stutter' } : 0.03 });
        if (f.flicker) out.flick.flickC = { h, color: GLOW.tube };
        break;
      }
      case 'wallLamp':
        // the sign lamp over the wall buy: small, warm, and worth a slot when the player is near it
        Lt.add({ type: 'spot', pos: f.pos, dir: f.dir, color: [1.0, 0.78, 0.5], lumens: 700, range: 6, cone: 0.8, penumbra: 0.6, size: 0.1, priority: 1.3 });
        break;
      case 'storeFlood':
        // 180 scene cd: over the 150 the rain needs to hang drops in a lamp's beam. Unshadowed.
        Lt.add({ type: 'spot', pos: f.pos, dir: f.dir, color: [1.0, 0.9, 0.72], lumens: 2700, range: 12, cone: 0.7, penumbra: 0.6, size: 0.15, priority: 0.9, flicker: 0.03 });
        break;
      case 'trailerWork':
        // about 60 scene cd, straight down the back of the trailer. Unshadowed.
        Lt.add({ type: 'spot', pos: f.pos, dir: f.dir, color: c.fluorescent, lumens: 1150, range: 8, cone: 0.8, penumbra: 0.7, size: 0.1, priority: 1.0, flicker: 0.05 });
        break;
      case 'trailerLamp':
        Lt.add({ type: 'point', pos: f.pos, color: c.fluorescent, lumens: 750, range: 8, pool: false, priority: 1.3, flicker: 0.06 });
        break;
      case 'sign':
        Lt.add({ type: 'point', pos: f.pos, color: [1.0, 0.72, 0.36], lumens: 1500, range: 9, priority: 0.7 });
        break;
      case 'headlight':
        Lt.add({ type: 'spot', pos: f.pos, dir: f.dir, color: [1.0, 0.9, 0.72], lumens: 1100 * f.level, range: 24, cone: 0.42, penumbra: 0.7, size: 0.08, castShadow: true, pool: false, priority: 1.6, flicker: { amount: 0.25, speed: 0.6, kind: 'waver' } });
        break;
      case 'bulkhead': {
        const h = Lt.add({ type: 'point', pos: f.pos, color: [1.0, 0.5, 0.22], lumens: 420, range: 7, pool: false, priority: 1.1, flicker: { amount: 0.45, speed: 1.1, kind: 'stutter' } });
        out.flick.flickD = { h, color: chroma(1.0, 0.5, 0.22, 14) };
        break;
      }
      case 'flare': {
        // A flare is a small source at ground level with no shadow slot: at its old 1400 lm / 11 m it
        // drew a red line along every rib, post and rail in the lane (they face it, the panels between
        // do not). Kept to what a flare does: a pool on the tarmac and a glow on what stands next to it.
        const h = Lt.add({ type: 'point', pos: f.pos, color: [1.0, 0.16, 0.06], lumens: 520, range: 6, pool: true, priority: 1.4, flicker: { amount: 0.4, speed: 9, kind: 'waver' } });
        out.flick.flickE = { h, color: [140, 22, 10] };
        break;
      }
      case 'dome':
        Lt.add({ type: 'point', pos: f.pos, color: [1.0, 0.8, 0.55], lumens: 90, range: 3.5, pool: false, priority: 0.6 });
        break;
      case 'hazardFar':
        // a flashing vehicle up on the highway: a point of amber the rain and the road can carry
        out.hazardsFar[f.group].push(Lt.add({ type: 'point', pos: f.pos, color: [1.0, 0.5, 0.08], lumens: 520, range: 9, pool: true, groundY: HIGHWAY.y - 0.08, priority: 0.35 }));
        break;
      case 'headlightFar':
        // the car left against the rail with its lights on, shining down the bank toward the lot
        Lt.add({ type: 'spot', pos: f.pos, dir: f.dir, color: [1.0, 0.9, 0.72], lumens: 1500, range: 30, cone: 0.5, penumbra: 0.7, size: 0.1, pool: false, priority: 0.7, flicker: { amount: 0.2, speed: 0.5, kind: 'waver' } });
        break;
      case 'hazard':
        out.hazards.push(Lt.add({ type: 'point', pos: f.pos, color: [1.0, 0.5, 0.08], lumens: 260, range: 6, pool: true, priority: 0.5 }));
        break;
      default:
    }
  }
  return out;
}

// One mesh per bucket of a zone's geometry, set up the way the level draws (render order,
// shadows, reflection stand-ins, the shadow proxy hidden from the main view). Returns { meshes }.
export function meshesFor(G, geos, mats, group) {
  const meshes = {};
  if (mats.glowFold && mats.paintFold) { geos = foldBuckets(geos, mats); bindGlowFold(mats); }
  for (const [key, geo] of geos) {
    const mat = mats[key];
    if (!mat) throw new Error(`level: no material for bucket "${key}"`);
    const mesh = new Mesh(geo, mat);
    mesh.name = key;
    mesh.castShadow = key === 'shadow';
    mesh.receiveShadow = key !== 'shadow' && key !== 'depth' && !key.includes('Glow') && key !== 'vcFar' && key !== 'uvBlob' && key !== 'vcRefl';
    mesh.frustumCulled = true; // three's own test on the bucket's bounds: most span the level and are always drawn, a zone's or a local one's are not
    if (TRANSPARENT.has(key)) mesh.renderOrder = 10;
    if (key === 'uvBlob') mesh.renderOrder = 6; // after the light pools (5), so it also darkens ground lit by pool-only lamps
    if (key === 'atlasLit' || key === 'uvFence' || key === 'uvFoliage') mesh.renderOrder = 2;
    if (key === 'uvPaint') mesh.renderOrder = 7; // blended, after the contact shadows it lies on
    if (key === 'uvPaintGlass') mesh.renderOrder = 11;
    if (key === 'depth') mesh.renderOrder = -10;
    // the puddle reflection redraws the scene: give it the lamps, signs and stand-in shapes only
    // (the ground is left unmarked: the pass finds it by its material and hides it itself)
    if (!REFLECT.test(key) && key !== 'asphalt') mesh.userData.noReflect = true;
    // ...and the stand-ins are drawn nowhere else
    if (key === 'vcRefl') mesh.onBeforeRender = (renderer, s, c, g) => { if (isReflection(renderer, c, G.level)) g.setDrawRange(0, Infinity); else g.setDrawRange(...HIDE); };
    // the shadow proxy only has to exist in the shadow passes (which do not call these hooks)
    if (key === 'shadow') {
      mesh.onBeforeRender = (renderer, s, c, g) => g.setDrawRange(...HIDE);
      mesh.onAfterRender = (renderer, s, c, g) => g.setDrawRange(0, Infinity);
    }
    if (key === 'asphalt' || key === 'vcTerrain') mesh.renderOrder = 1; // ground last: its shader is the dearest, so let everything else occlude it first
    if (group) group.add(mesh);
    meshes[key] = mesh;
  }
  return { meshes };
}

// The forecourt's per-frame look (hazard flashers, beacons, the OPEN sign's buzz, lamp faces
// following their fixture's flicker). No allocation.
export function createForecourtUpdate(G, mats, lit) {
  const amber = new Color(...chroma(1.0, 0.45, 0.06, 1));
  const red = new Color(1, 0.04, 0.02);
  const flickKeys = Object.keys(lit.flick); // fixed at build: the per-frame update must not list them again
  return function update() {
    const t = G.time.t;
    // hazard flashers: on for a little under half of each 1.1 s cycle
    const blink = (t % 1.1) < 0.48 ? 1 : 0;
    mats.blinkA.color.copy(amber).multiplyScalar(blink * 14);
    for (const h of lit.hazards) if (h.enabled !== !!blink) h.set({ enabled: !!blink });
    // the flashers up on the highway run on their own relays: never in step with each other
    const farC = ((t + 0.37) % 0.93) < 0.42, farD = ((t + 0.61) % 1.27) < 0.56;
    mats.blinkC.color.copy(amber).multiplyScalar(farC ? 42 : 0);
    for (const h of lit.hazardsFar.C) if (h.enabled !== farC) h.set({ enabled: farC });
    mats.blinkD.color.copy(amber).multiplyScalar(farD ? 42 : 0);
    for (const h of lit.hazardsFar.D) if (h.enabled !== farD) h.set({ enabled: farD });
    // mast beacons breathe slowly
    const b = Math.max(0, Math.sin(t * 2.1)) ** 3;
    mats.blinkB.color.copy(red).multiplyScalar(0.4 + b * 16);
    // the OPEN sign buzzes: mostly lit, dropping out for a few frames at a time, now and then for longer
    const buzz = Math.sin(t * 2.3) + Math.sin(t * 7.1 + 1.3) > 1.55 || (t % 9.5) > 8.7 ? 0.06 + 0.2 * Math.max(0, Math.sin(t * 61)) : 1;
    mats.vcBuzz.color.setScalar(buzz);
    // lamp faces follow the flicker of the fixture behind them
    for (let i = 0; i < flickKeys.length; i++) {
      const key = flickKeys[i];
      const f = lit.flick[key];
      mats[key].color.setRGB(f.color[0], f.color[1], f.color[2]).multiplyScalar(0.03 + 0.97 * f.h.gain);
    }
  };
}

export { makeMaterials, registerLights, GLOW, chroma };
