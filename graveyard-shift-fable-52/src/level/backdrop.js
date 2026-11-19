// Everything beyond the fence: verge and embankment terrain, the highway with its stalled traffic
// and lamps, the treeline, utility poles, a ridge on the horizon with a few distant lights.
import { BufferGeometry, BufferAttribute } from 'three';
import { M, box, boxUp, cylUp, extrude, roundPoly, sphere, tube, quadUV, rgb } from './build.js';
import { buildJam, buildEmbankment, buildDistantLights } from './props/highway.js';
import { buildLamp } from './props/lamp.js';
import { treeGeometry, shrubGeometry, grassGeometry } from './props/foliage.js';

export const HIGHWAY = { y: 2.6, z0: 34, z1: 46 }; // low enough that the stalled traffic is seen from the lot

// cheap deterministic 2D value noise for terrain and silhouettes
function makeNoise(rng) {
  const n = 64;
  const v = new Float32Array(n * n);
  for (let i = 0; i < v.length; i++) v[i] = rng.next();
  const at = (x, y) => v[(((y % n) + n) % n) * n + (((x % n) + n) % n)];
  const one = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  return (x, y, oct = 3) => { let s = 0, a = 0.5, t = 0; for (let o = 0; o < oct; o++) { s += a * one(x + o * 17.1, y + o * 9.3); t += a; a *= 0.5; x *= 2.07; y *= 2.07; } return s / t; };
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Ground the rest of the map stands on: the diner, the motel and the garage, with a margin
// for the spawn points outside their walls. Flat like the lot, and kept clear of trees.
export const FLATS = [
  { x0: 6, z0: -34.5, x1: 27.5, z1: -19.5 },
  { x0: 22, z0: -47.2, x1: 68.8, z1: -1 },
  { x0: 22, z0: -3, x1: 68.8, z1: 25.6 },
];
const inRect = (r, x, z, pad) => x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad;
const rectDist = (r, x, z) => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));

// lot: { x0, x1, z0, z1 } asphalt rectangle; drives: [[x0, x1]] driveway strips running south
export function terrainHeight(x, z, lot, drives, noise) {
  const inLot = x > lot.x0 - 0.3 && x < lot.x1 + 0.3 && z > lot.z0 - 0.3 && z < lot.z1 + 0.3;
  if (inLot) return -0.06;
  for (const f of FLATS) if (inRect(f, x, z, 0.3)) return -0.06;
  const onDrive = drives.some((d) => x > d[0] - 0.3 && x < d[1] + 0.3) && z >= lot.z1 && z < 27;
  if (onDrive) return -0.06;
  // distance outside the lot and the other flat ground
  const dx = Math.max(lot.x0 - x, 0, x - lot.x1), dz = Math.max(lot.z0 - z, 0, z - lot.z1);
  let d = Math.hypot(dx, dz);
  for (const f of FLATS) d = Math.min(d, rectDist(f, x, z));
  let h = 0.05 + smooth(0, 3, d) * 0.12 + smooth(6, 60, d) * (noise(x * 0.02, z * 0.02) * 9 - 2.5) + (noise(x * 0.15, z * 0.15, 2) - 0.5) * 0.5 * smooth(1, 6, d);
  // embankment up to the highway deck and down the far side
  const up = smooth(25, HIGHWAY.z0 - 0.5, z) * (1 - smooth(HIGHWAY.z1 + 0.5, HIGHWAY.z1 + 14, z));
  h = h * (1 - up) + HIGHWAY.y * up - (up > 0.98 ? 0.08 : 0);
  return h;
}

function buildTerrain(B, lot, drives, noise) {
  const N = 100, S = 300;
  const pos = [], col = [], idx = [];
  // denser near the lot: warp a regular grid toward the centre
  const warp = (u) => { const t = u * 2 - 1; return (Math.sign(t) * (0.35 * Math.abs(t) + 0.65 * t * t)) * (S / 2); };
  const hs = [];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const x = warp(i / N), z = warp(j / N) + 6;
    const h = terrainHeight(x, z, lot, drives, noise);
    hs.push(h);
    pos.push(x, h, z);
    const onDrive = drives.some((d) => x > d[0] - 0.6 && x < d[1] + 0.6) && z > lot.z1 && z < HIGHWAY.z0 + 1;
    const deck = z > HIGHWAY.z0 - 0.6 && z < HIGHWAY.z1 + 0.6;
    const n = noise(x * 0.3, z * 0.3, 2);
    let c;
    if (deck || onDrive) { const w = 0.75 + 0.6 * noise(x * 0.5 + 9, z * 0.5, 2); c = [0.03 * w, 0.03 * w, 0.033 * w]; } // worn tarmac, patchy
    else {
      // verge: rank grass with bare earth showing through in patches, and a paler worn strip along the fence
      const g = 0.5 + 1.0 * n;
      const bare = smooth(0.55, 0.75, noise(x * 0.9 + 40, z * 0.9, 2));
      c = [0.034 * g + 0.03 * (1 - n), 0.05 * g, 0.022 * g];
      c = [c[0] + (0.06 - c[0]) * bare, c[1] + (0.05 - c[1]) * bare, c[2] + (0.038 - c[2]) * bare];
    }
    col.push(c[0], c[1], c[2]);
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * (N + 1) + i;
    idx.push(a, a + N + 1, a + 1, a + 1, a + N + 1, a + N + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // add() wants a colour per call: write the per-vertex colours afterwards
  const b0 = B.buckets.get('vcTerrain');
  const start = b0 ? b0.count : 0;
  B.add('vcTerrain', g, { color: [1, 1, 1] });
  const b = B.buckets.get('vcTerrain');
  for (let i = 0; i < col.length; i++) b.col[start * 3 + i] = col[i];
}

function buildHighway(B, rng) {
  const { y, z0, z1 } = HIGHWAY;
  const A = B.atlas;
  // lane paint
  for (let x = -100; x < 100; x += 9) for (const z of [z0 + 4, z1 - 4]) B.add('vcMatte', box(3, 0.01, 0.14), { m: M(x, y - 0.07, z), color: rgb(0x6c6a60) });
  for (const z of [z0 + 0.7, z1 - 0.7, (z0 + z1) / 2]) B.add('vcMatte', box(200, 0.01, 0.14), { m: M(0, y - 0.07, z), color: z === (z0 + z1) / 2 ? rgb(0x6a5410) : rgb(0x6c6a60) });
  // guard rail both sides: W-beam on posts
  const beam = roundPoly([[0, 0.0, 0], [0.05, 0.04, 0.02], [0.0, 0.1, 0.02], [0.0, 0.2, 0.02], [0.05, 0.26, 0.02], [0, 0.3, 0], [-0.012, 0.3, 0], [0.035, 0.26, 0.02], [-0.012, 0.2, 0.02], [-0.012, 0.1, 0.02], [0.035, 0.04, 0.02], [-0.012, 0, 0]], 2);
  for (const [z, s] of [[z0 + 0.15, -1], [z1 - 0.15, 1]]) {
    B.add('paintGalv', extrude(beam, 200, { smooth: false }).rotateY(Math.PI / 2), { m: M(0, y + 0.35, z, 0, s > 0 ? Math.PI : 0, 0) });
    for (let x = -100; x <= 100; x += 3.8) B.add('paintGalv', boxUp(0.1, 0.75, 0.14), { m: M(x, y - 0.1, z + s * 0.08) });
  }
  // the jam: coach, vans, the folded artic, the cars (props/highway.js)
  buildJam(B, rng.fork('jam'), HIGHWAY);
  // overhead sign on a truss
  B.at(M(5.5, y, 0), () => {
    for (const z of [z0 - 0.6, z1 + 0.6]) B.add('paintGalv', cylUp(0.16, 0.2, 7.4, 8), { m: M(0, -0.5, z) });
    for (const yy of [6.2, 6.9]) B.add('paintGalv', box(0.12, 0.12, z1 - z0 + 1.2), { m: M(0, yy, (z0 + z1) / 2) });
    for (let i = 0; i < 12; i++) B.add('paintGalv', box(0.05, 0.9, 0.05), { m: M(0, 6.55, z0 + i * 1.1, (i % 2 ? 1 : -1) * 0.7, 0, 0) });
    B.add('vcMatte', box(0.08, 2.6, 5.7), { m: M(-0.12, 6.4, z0 + 3.6), color: rgb(0x0a2a18) });
    B.add('atlasGlowVc', quadUV(5.6, 2.52, A.uv('highway')), { m: M(-0.17, 6.4, z0 + 3.6, 0, -Math.PI / 2, 0), color: [1.3, 1.3, 1.3] });
    // sign lighting on outriggers under the board: two fixtures, one dead
    for (const [dz, on] of [[2.2, 1], [5.0, 0]]) {
      B.add('paintGalv', box(0.9, 0.05, 0.05), { m: M(-0.55, 5.0, z0 + dz) });
      B.add(on ? 'vcGlow' : 'vcGloss', box(0.3, 0.08, 0.5), { m: M(-0.95, 5.02, z0 + dz, 0, 0, 0.5), color: on ? rgb(0xfff2d8, 30) : rgb(0x1a1814) });
    }
  });
  // highway lamps on the far verge
  const states = ['dead', 'on', 'dead', 'on', 'flicker', 'on', 'on']; // lit over the coach, the artic and the stretch seen east from the lot
  states.forEach((state, i) => B.at(M(-78 + i * 26, y - 0.1, z1 + 1.2, 0, Math.PI / 2, 0), () => { B.far = true; buildLamp(B, { height: 10.5, reach: 2.6, state: state === 'flicker' ? 'on' : state }); B.far = false; }));
}

// opts: { lot, drives, clear: [{ x, z, r }] (spawn pockets and other places to keep open) }
// Returns { instanced: [{ key, geometry, matrices }] } for the level to turn into InstancedMeshes.
export function buildBackdrop(B, opts) {
  const rng = B.rng.fork('backdrop');
  const noise = makeNoise(rng.fork('noise'));
  const { lot, drives, clear } = opts;
  buildTerrain(B, lot, drives, noise);
  buildHighway(B, rng.fork('highway'));
  buildEmbankment(B, rng.fork('bank'), HIGHWAY, (x, z) => terrainHeight(x, z, lot, drives, noise), drives);
  buildDistantLights(B, rng.fork('distant'), HIGHWAY);

  // ---- utility poles down the west side, wires sagging between them
  const poles = [[-24.6, -34], [-24.4, -11], [-24.7, 13], [-24.5, 36]];
  poles.forEach(([x, z], i) => {
    B.add('vcMatte', cylUp(0.1, 0.15, 9.5, 7), { m: M(x, -0.2, z, 0.015 * (i % 2 ? 1 : -1), 0, 0.02), color: rgb(0x1a130c), shadow: true });
    B.add('vcMatte', box(2.2, 0.1, 0.12), { m: M(x, 8.6, z), color: rgb(0x1a130c) });
    for (const dx of [-1, 0, 1]) B.add('vcGloss', cylUp(0.035, 0.045, 0.14, 6), { m: M(x + dx, 8.65, z), color: rgb(0x2a3a3a) });
    if (i === 1) B.add('paintGalv', cylUp(0.28, 0.28, 0.8, 12), { m: M(x + 0.4, 7.3, z), shadow: true });
    if (i < poles.length - 1) {
      const [x2, z2] = poles[i + 1];
      for (const dx of [-1, 0, 1]) {
        const pts = [];
        for (let k = 0; k <= 8; k++) { const t = k / 8; pts.push([x + dx + (x2 - x) * t, 8.78 - Math.sin(t * Math.PI) * (0.9 + 0.15 * dx), z + (z2 - z) * t]); }
        B.add('vcMatte', tube(pts, 0.012, 3, 2), { color: rgb(0x050505) });
      }
    }
  });

  // ---- radio mast with marker beacons, far to the north-west
  B.at(M(-95, 0, -150), () => {
    for (const [x, z] of [[-1.2, -0.7], [1.2, -0.7], [0, 1.4]]) B.add('vcFar', cylUp(0.1, 0.16, 70, 4), { m: M(x, 0, z, -z * 0.012, 0, x * 0.012), color: [1, 1, 1] });
    for (let i = 0; i < 16; i++) B.add('vcFar', box(2.6 - i * 0.12, 0.1, 0.1), { m: M(0, 4 + i * 4.2, -0.6), color: [1, 1, 1] });
    for (const yy of [70.5, 47, 24]) B.add('blinkB', sphere(0.5, 6, 4), { m: M(0, yy, 0) });
  });

  // ---- ridge on the horizon: a ragged band, darker than the sky glow behind it
  {
    const R = 210, seg = 200;
    const pos = [], idx = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const hgt = 9 + noise(Math.cos(a) * 3 + 5, Math.sin(a) * 3 + 5, 4) * 30 + noise(i * 0.9, 3, 2) * 3;
      pos.push(Math.cos(a) * R, -6, Math.sin(a) * R, Math.cos(a) * R, hgt, Math.sin(a) * R);
      if (i < seg) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    B.add('vcFar', g, { color: [1, 1, 1] });
    // a scatter of lights where a town would be, east along the valley
    for (let i = 0; i < 46; i++) {
      const a = -0.5 + rng.range(-0.55, 0.75);
      const r = R - 4;
      const warm = rng.next() < 0.7;
      B.add('vcGlow', box(0.5, 0.35, 0.5), { m: M(Math.cos(a) * r, 2 + rng.range(0, 7), Math.sin(a) * r), color: warm ? rgb(0xffa040, rng.range(4, 14)) : rgb(0xd0e4ff, rng.range(3, 9)) });
    }
  }

  // ---- treeline and undergrowth: alpha cards, all in one bucket
  const blocked = (x, z, pad) => {
    if (x > lot.x0 - pad && x < lot.x1 + pad && z > lot.z0 - pad && z < lot.z1 + pad) return true;
    if (z > 25 && z < HIGHWAY.z1 + 3) return true; // embankment and carriageway stay clear
    if (z > lot.z1 - 1 && z <= 25 && drives.some((d) => x > d[0] - 2.5 && x < d[1] + 2.5)) return true;
    return clear.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + pad * 0.4);
  };
  const tr = rng.fork('trees');
  let nTrees = 0;
  // A wood, not a hedge: stands of spruce with pine pushing through, clearings between them,
  // a taller rank further back, and young trees along the edge where the light gets in.
  for (let i = 0; i < 3400 && nTrees < 470; i++) {
    const x = tr.range(-84, 84), z = tr.range(-78, 84);
    if (blocked(x, z, 2.6)) continue;
    const dEdge = Math.max(lot.x0 - x, x - lot.x1, lot.z0 - z, z - lot.z1);
    const stand = noise(x * 0.045 + 31, z * 0.045 + 7, 2); // 0..1: where the wood is thick
    if (stand < 0.4 && tr.next() < 0.85) continue; // clearings and rides
    if (dEdge > 16 && tr.next() < 0.4) continue; // thin out with distance: only silhouettes matter there
    const near = dEdge < 13;
    const pick = tr.next();
    const sapling = dEdge < 7 && pick > 0.72;
    const kind = sapling ? 'A' : pick < 0.5 + 0.3 * stand ? 'A' : pick < 0.93 ? 'B' : 'C';
    const back = smooth(8, 30, dEdge); // taller the further back
    const hgt = sapling ? tr.range(2.6, 5.5) : kind === 'A' ? tr.range(8, 14) + back * tr.range(2, 9) : kind === 'B' ? tr.range(12, 18) + back * tr.range(3, 10) : tr.range(5, 11);
    const ty = terrainHeight(x, z, lot, drives, noise) - 0.3;
    // Behind the store and the diner only the tops of the trees clear the roof. Trees standing just
    // behind the wall showed as a row of separate little firs along the parapet (their top two
    // metres, crisp, sky between them). So nothing grows in the first rank there, and what stands
    // further back is tall: seen from the lot it is one dark wood rising behind the roof.
    const behindStore = z < lot.z0 && x > -27 && x < 27;
    const geo = treeGeometry(tr, kind, hgt, near); // (always built: the stream must not depend on what is kept)
    const tilt = [tr.range(-0.03, 0.03), tr.range(-0.03, 0.03)];
    if (FLATS.some((f) => inRect(f, x, z, 2.6))) { nTrees++; continue; } // the rest of the map stands here
    if (behindStore && z > -47) { nTrees++; continue; }
    if (behindStore) {
      const tall = Math.min(Math.max(hgt, 19 + 5 * noise(x * 0.21 + 3, z * 0.21, 2)), 24);
      B.add('uvFoliage', treeGeometry(tr.fork(`north${i}`), kind === 'C' ? 'B' : kind, tall, false), { m: M(x, ty, z, tilt[0], 0, tilt[1]) });
      nTrees++;
      continue;
    }
    B.add('uvFoliage', geo, { m: M(x, ty, z, tilt[0], 0, tilt[1]) });
    // in a puddle a tree is a dark spire against the sky: two crossed triangles stand in for it
    if (dEdge < 40) {
      const hw = hgt * (kind === 'C' ? 0.1 : 0.19);
      const tri = new BufferGeometry();
      tri.setAttribute('position', new BufferAttribute(new Float32Array([-hw, 0, 0, hw, 0, 0, 0, hgt, 0, 0, 0, -hw, 0, 0, hw, 0, hgt, 0]), 3));
      tri.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0]), 3));
      B.add('vcRefl', tri, { m: M(x, ty, z), color: [0.003, 0.004, 0.0035] });
    }
    nTrees++;
  }
  // the wood behind the buildings, closed up: two staggered ranks of tall spruce and pine
  const tn = rng.fork('treesNorth');
  for (let row = 0; row < 2; row++) {
    for (let x = -34 + row * 1.3; x < 34; x += tn.range(2.0, 3.1)) {
      const z = -48.5 - row * 5 + tn.range(-1.5, 1.5);
      const kind = tn.next() < 0.7 ? 'A' : 'B';
      const hgt = (kind === 'A' ? tn.range(19, 23) : tn.range(21, 24)) + row * 2;
      B.add('uvFoliage', treeGeometry(tn, kind, hgt, false), { m: M(x, terrainHeight(x, z, lot, drives, noise) - 0.3, z, tn.range(-0.03, 0.03), 0, tn.range(-0.03, 0.03)) });
    }
  }
  // the wood behind the motel and east of the garage, closed up the same way (its own stream: the
  // trees round the forecourt are not moved by it)
  const te = rng.fork('treesEast');
  const edge = [
    ...Array.from({ length: 20 }, (_, i) => [35 + i * 1.95, -50.0]), // behind the north wing (the rows above reach x 34)
    ...Array.from({ length: 34 }, (_, i) => [72.0, -48 + i * 2.15]), // east of the motel and the garage
  ];
  for (const [ex, ez] of edge) {
    for (let row = 0; row < 2; row++) {
      const x = ex + (ez > -49 ? row * 4.5 : te.range(-0.8, 0.8)), z = ez - (ez > -49 ? te.range(-0.8, 0.8) : row * 4.5);
      const kind = te.next() < 0.7 ? 'A' : 'B';
      const hgt = (kind === 'A' ? te.range(15, 21) : te.range(17, 23)) + row * 2;
      B.add('uvFoliage', treeGeometry(te, kind, hgt, row === 0), { m: M(x, terrainHeight(x, z, lot, drives, noise) - 0.3, z, te.range(-0.03, 0.03), 0, te.range(-0.03, 0.03)) });
    }
  }
  const br = rng.fork('shrubs');
  let nShrub = 0;
  for (let i = 0; i < 4000 && nShrub < 420; i++) {
    const x = br.range(-42, 42), z = br.range(-44, 30);
    if (blocked(x, z, 0.5)) continue;
    const dEdge = Math.max(lot.x0 - x, x - lot.x1, lot.z0 - z, z - lot.z1);
    if (dEdge > 6 && br.next() < 0.7) continue;
    const shrub = shrubGeometry(br, br.range(0.7, 1.6));
    nShrub++;
    if (FLATS.some((f) => inRect(f, x, z, 0.5))) { shrub.dispose(); continue; }
    B.add('uvFoliage', shrub, { m: M(x, terrainHeight(x, z, lot, drives, noise), z) });
  }
  // weeds and grass: thick on the verge, and coming up along the fence line and through the kerbs
  const gr = rng.fork('grass');
  let nGrass = 0;
  for (let i = 0; i < 9000 && nGrass < 1500; i++) {
    const x = gr.range(-34, 34), z = gr.range(-38, 27);
    const dEdge = Math.max(lot.x0 - x, x - lot.x1, lot.z0 - z, z - lot.z1);
    if (dEdge < 0.15 || dEdge > 9 || (z > 25) || (z > lot.z1 - 1 && drives.some((d) => x > d[0] - 0.8 && x < d[1] + 0.8))) continue;
    if (dEdge > 3 && gr.next() < 0.6) continue;
    const grass = grassGeometry(gr, gr.range(0.8, 1.5), gr.next() < 0.45);
    nGrass++;
    if (FLATS.some((f) => inRect(f, x, z, 0.2))) { grass.dispose(); continue; }
    B.add('uvFoliage', grass, { m: M(x, terrainHeight(x, z, lot, drives, noise) - 0.02, z) });
  }
  // weeds inside the wire, where nobody has sprayed for a while
  for (const [x0, z0, x1, z1, n] of opts.weeds || []) {
    for (let i = 0; i < n; i++) {
      const t = gr.next();
      B.add('uvFoliage', grassGeometry(gr, gr.range(0.6, 1.2), gr.next() < 0.35), { m: M(x0 + (x1 - x0) * t + gr.range(-0.12, 0.12), -0.02, z0 + (z1 - z0) * t + gr.range(-0.12, 0.12)) });
    }
  }
  return { noise };
}
