// What the lot has been through. Two halves:
//   paintGroundMask: stains, wheel tracks, patch repairs and cracks, painted into the maps the
//     ground material reads (../groundMask.js), so they are part of the asphalt: under the puddles,
//     in the reflections, lit like the rest.
//   buildGroundDetail: the few things that really do lie on top (worn paint, leaves and rubbish
//     against the wire), as flat lit quads from the decal sheet (../decals.js).
import { M, quadUV } from '../build.js';
import * as L from '../layout.js';
import { ISLAND } from './pump.js';

const UP = -Math.PI / 2;
const BAYS = [-11.3, -8.7, -6.1, 2.3, 4.9];

// P: a mask painter. Headings and rotations are yaw, as everywhere: 0 = +x (east), + toward north.
export function paintGroundMask(P, rng) {
  const fwd = (yaw) => [Math.cos(yaw), -Math.sin(yaw)];
  const KERB = 0.3; // dirt only: under the level where the material starts a film

  // ---- the pad: a soak at every fuelling position, drops down the lanes, dirt against the kerbs
  for (const [ix, iz] of L.ISLANDS) {
    for (const f of [1, -1]) {
      const z = iz + f * (ISLAND.width / 2 + 1.0);
      for (const dx of [-1.75, 1.75]) {
        const x = ix + dx + rng.range(-0.3, 0.7);
        P.stain(x, z + rng.range(-0.15, 0.3), rng.range(0.5, 0.85), { amount: rng.range(0.8, 1) });
        if (rng.next() < 0.7) P.stain(x + rng.range(-0.9, 0.9), z + rng.range(-0.3, 0.5), rng.range(0.2, 0.36), { amount: rng.range(0.55, 0.9) });
      }
      P.drips(ix - 3.6, z + f * 0.15, ix + 3.8, z + f * 0.1, rng.int(10, 18), { spread: 0.32 });
      P.smear([[ix - ISLAND.length / 2 - 0.1, iz + f * (ISLAND.width / 2 + 0.04)], [ix, iz + f * (ISLAND.width / 2 + 0.04)], [ix + ISLAND.length / 2 + 0.1, iz + f * (ISLAND.width / 2 + 0.04)]], 0.2, { amount: KERB, side: -f });
    }
  }
  // ---- parking bays: where each engine sat, and what dripped on the way in
  for (const x of BAYS) {
    P.stain(x + rng.range(-0.2, 0.2), -15.6 + rng.range(-0.3, 0.3), rng.range(0.55, 0.8), { amount: rng.range(0.75, 1) });
    P.drips(x + rng.range(-0.2, 0.2), -15.0, x + rng.range(-0.3, 0.3), -12.4, rng.int(4, 9), { spread: 0.16 });
  }
  // ---- under and behind every vehicle, and the long stain a parked artic leaves
  for (const v of L.vehicles) {
    const [fx, fz] = fwd(v.yaw);
    P.stain(v.x + fx * 1.25, v.z + fz * 1.25, rng.range(0.6, 0.85), { amount: 1, rot: v.yaw });
    P.drips(v.x - fx * 1.8, v.z - fz * 1.8, v.x - fx * 5.2, v.z - fz * 5.2, rng.int(5, 9), { spread: 0.14 });
  }
  {
    const t = L.LORRY, [fx, fz] = fwd(t.yaw);
    P.stain(t.x + fx * 7.6, t.z + fz * 7.6, 1.0, { amount: 1, stretch: 1.5, rot: t.yaw });
    P.stain(t.x - fx * 4.6, t.z - fz * 4.6, 0.75, { amount: 0.9 });
  }
  for (const [x, z, r] of [[16.2, 3.2, 0.85], [12.6, -13.6, 0.65], [19.4, -12.2, 0.7], [-18.6, -14.6, 0.6], [-3.2, 6.2, 0.55], [8.6, 10.4, 0.7], [-19.6, 12.6, 0.5], [6.5, 10.5, 0.8], [-13.6, 10.0, 0.5]]) {
    P.stain(x, z, r, { amount: rng.range(0.7, 1) });
  }
  // ---- fuel from the nozzle left running at pump 5: a tongue down the fall of the slab
  P.smear([[-8.9, -1.72], [-8.2, -1.85], [-7.5, -2.35], [-6.8, -2.5], [-6.0, -2.95]], 0.26, { amount: 0.95, soft: 0.12 });
  P.stain(-8.8, -1.75, 0.42, { amount: 1 });
  P.stain(-5.95, -2.95, 0.3, { amount: 0.9 });
  // ---- dirt: along the store kerb, washed toward the drains, banked against the wire
  for (let x = -22.6; x < 22; x += 5.6) P.smear([[x, -17.24], [x + 2.9, -17.24], [x + 5.8, -17.24]], 0.3, { amount: KERB, side: -1 });
  for (const [x, z] of L.DRAINS) {
    P.stain(x, z, 0.7, { amount: 0.36 });
    for (let i = 0; i < 6; i++) { const a = rng.range(0, 6.283), d = rng.range(1.1, 2.1); P.smear([[x + Math.cos(a) * d, z + Math.sin(a) * d], [x + Math.cos(a + 0.2) * d * 0.5, z + Math.sin(a + 0.2) * d * 0.5], [x, z]], 0.12, { amount: 0.26 }); }
  }
  const F = L.FENCE;
  for (let z = -19; z < F.s - 4; z += 6.4) {
    P.smear([[F.w + 0.1, z], [F.w + 0.1, z + 3.3], [F.w + 0.1, z + 6.6]], 0.34, { amount: 0.24 });
    P.smear([[F.e - 0.1, z], [F.e - 0.1, z + 3.3], [F.e - 0.1, z + 6.6]], 0.34, { amount: 0.24 });
  }
  for (let x = F.w; x < F.e - 3; x += 6.4) P.smear([[x, F.s - 0.1], [x + 3.3, F.s - 0.1], [x + 6.6, F.s - 0.1]], 0.34, { amount: 0.24 });

  // ---- wheels. First what years of the same manoeuvre have polished in the pump lanes: broad, faint
  for (const z of [-8.4, -3.5, 1.45]) P.track([[-19.5, z + 0.7], [-13.5, z], [-2, z + 0.05], [9.5, z], [14.8, z + 0.6]], { gauge: 1.55, width: 0.46, soft: 0.16, amount: 0.7, gaps: 0.1, fadeIn: 3, fadeOut: 3 });
  // then single passes, each its own line, breaking up and fading
  const car = { gauge: 1.5, width: 0.2 };
  P.track([[-10.3, 25.8], [-10.4, 20.5], [-10.7, 15], [-11.9, 9.6], [-15.2, 3.8], [-17.6, -2.4], [-17.4, -8], [-14.6, -11], [-9, -11.6], [-2, -11.9]], { ...car, amount: 0.8, gaps: 0.45 });
  P.track([[-15.4, -9.2], [-11, -8.3], [-3, -8.5], [5, -8.3], [9.6, -8.2], [13.4, -7.2]], { ...car, amount: 0.85, gaps: 0.5 });
  P.track([[13.2, -3.0], [7, -3.65], [-2, -3.4], [-11, -3.6], [-16.8, -2.4]], { ...car, amount: 0.85, gaps: 0.5 });
  P.track([[-14.6, 2.5], [-10.5, 1.55], [-1, 1.3], [7.6, 1.5], [12.4, 2.5], [15.8, 5.4]], { ...car, amount: 0.8, gaps: 0.55 });
  P.track([[-13, 5.9], [-5, 5.1], [1.6, 5.4], [6.0, 8.0], [8.1, 12.6], [8.7, 19], [8.4, 25.8]], { ...car, amount: 0.8, gaps: 0.4 });
  P.track([[-18.6, -12], [-18.7, -5], [-18.4, 2.5], [-16.6, 8.6]], { ...car, amount: 0.6, gaps: 0.6 });
  P.track([[12.4, -11.4], [6, -11.8], [-3, -11.5], [-12.6, -11.5]], { ...car, amount: 0.65, gaps: 0.55 });
  for (const x of [-8.7, 2.3, 4.9]) P.track([[x + 3.2, -11.5], [x + 1.2, -12.2], [x + 0.1, -13.8], [x, -16.2]], { ...car, amount: 0.6, gaps: 0.3, fadeIn: 1, fadeOut: 0.8 });
  // the truck side: dual wheels down the east fence, and where the artic came round before it folded
  const artic = { dual: true, gauge: 1.85, width: 0.24 };
  P.track([[19.3, -15.5], [19.6, -7], [19.5, 1], [18.9, 7.5]], { ...artic, amount: 0.75, gaps: 0.35 });
  P.track([[9.0, 25.8], [9.1, 21.5], [10.8, 17.4], [14.2, 15.4], [18.2, 15.6]], { ...artic, amount: 0.85, gaps: 0.25, fadeOut: 1.5 });
  P.track([[17.6, -3.6], [16.6, 1.6], [13.6, 5.2], [9.6, 7.0]], { ...artic, amount: 0.7, gaps: 0.45 });

  // ---- patch repairs and service trenches
  P.patch(-13.4, 5.6, 2.1, 1.3, 0.05);
  P.patch(-8.0, 11.4, 1.2, 1.2, 0.22);
  P.patch(-16.5, -9.3, 1.8, 1.15, 0.08);
  P.patch(19.6, 10.6, 1.1, 1.1, -0.06);
  P.patch(14.2, -12.6, 1.3, 1.3, 0.3);
  P.patch(2.5, 16.6, 2.0, 1.25, -0.12);
  P.patch(-18.6, 8.6, 3.7, 0.5, 0.2);
  P.patch(14.6, -8.6, 3.6, 0.5, Math.PI / 2 - 0.05);
  P.patch(-3.5, -11.9, 3.9, 0.5, 0.03);
  for (const [x, z, a, b] of [[5.6, 9.4, 0.55, 0.4], [-19.3, 14.4, 0.45, 0.35], [12.4, -4.4, 0.5, 0.42], [-4.4, 15.6, 0.4, 0.5], [17.6, 18.0, 0.6, 0.45]]) P.patch(x, z, a, b, rng.range(0, 3), { blob: true });

  // ---- cracks: long ones across the open lot, a few of them sealed years ago; the edges of the
  // trenches reflecting through; fatigue where the heavy axles turn
  const from = (x, z, len, rot) => [x - Math.cos(rot) * len / 2, z + Math.sin(rot) * len / 2, rot, len];
  for (const [x, z, len, rot] of [
    [-4.5, 7.6, 9, 0.35], [-16.6, 15.6, 7, -0.6], [2.2, 11.6, 8, -0.25], [-6.0, 13.2, 8, 0.9], [20.3, 14.4, 7, 1.45], [12.2, -12.2, 8, 0.5],
    [-14.2, -12.3, 7, -0.2], [-19.4, -3.2, 7, 1.2], [15.6, 3.4, 9, 0.7], [6.4, 6.8, 6, -0.9], [-1.0, 18.4, 8, 0.08], [18.4, -13.4, 6, -0.5],
    [-12.4, 17.6, 5, 0.3], [-20.4, 18.2, 4, -0.9],
  ]) P.crack(...from(x, z, len, rot), { strength: rng.range(0.75, 1) });
  for (const [x, z, len, rot] of [[-10.6, 14.7, 7, -0.3], [-1.6, 15.4, 8, 0.12], [-18.2, 3.6, 6, 1.3], [-17.2, -11.2, 7, 1.2], [10.4, 5.2, 7, -0.55], [17.4, -2.2, 6, 0.2], [7.6, 18.2, 6, 0.3]]) {
    P.crack(...from(x, z, len, rot), { sealed: true, strength: 1, branch: 0.1, wander: 0.35 });
  }
  P.crack(-22.0, 9.75, 0.2, 3.2, { strength: 0.7, branch: 0.3 });
  P.crack(-14.9, 8.2, 0.25, 2.6, { strength: 0.7 });
  P.crack(14.05, -12.2, Math.PI / 2, 2.4, { strength: 0.6 });
  P.crack(-11.3, 6.95, 0.6, 2.2, { strength: 0.6 });
  P.alligator(16.4, 4.6, 1.3, 10);
  P.alligator(-10.4, 19.0, 1.0, 7);
  P.alligator(18.9, -9.8, 0.9, 6);

  // ---- the pad again, heavier: it read as new concrete. Years of standing engines at each pump
  // (a wide old soak under the fresh one, and a second where the next car in the queue waited),
  // black arcs where tyres turned out of the lanes on dry concrete, and the slab cracking from
  // its joints and from the corners of the islands. (Own stream: nothing above is reshuffled.)
  const pad = rng.fork('pad');
  for (const [ix, iz] of L.ISLANDS) {
    for (const f of [1, -1]) {
      const z = iz + f * (ISLAND.width / 2 + 1.15);
      for (const dx of [-1.75, 1.75]) {
        P.stain(ix + dx + pad.range(-0.5, 0.5), z + pad.range(-0.2, 0.35), pad.range(0.95, 1.35), { amount: pad.range(0.9, 1), stretch: 1.4, rot: pad.range(-0.3, 0.3) });
        P.stain(ix + dx + pad.range(-2.6, -1.8), z + f * pad.range(0.1, 0.5), pad.range(0.35, 0.6), { amount: pad.range(0.7, 1) });
      }
      P.drips(ix - 4.4, z + f * 0.5, ix + 4.4, z + f * 0.45, pad.int(18, 28), { spread: 0.6 });
      P.crack(ix + f * (ISLAND.length / 2 + 0.05), iz + f * ISLAND.width / 2, f > 0 ? pad.range(-0.9, -0.4) : pad.range(2.3, 2.8), pad.range(1.6, 2.6), { strength: pad.range(0.7, 0.95), branch: 0.25 });
    }
  }
  for (const [x, z, rot, len] of [[-11.2, -5.2, 0.5, 3.4], [-2.6, -9.6, 1.35, 2.8], [0.4, 0.6, -0.4, 3.8], [6.6, -4.4, 1.7, 3.0], [-5.8, 2.2, 0.15, 2.6], [-12.4, -1.2, 1.1, 2.2]]) {
    P.crack(x, z, rot, len, { strength: pad.range(0.7, 1), branch: 0.3, wander: 0.4 });
  }
  const scuff = { gauge: 1.5, width: 0.17, soft: 0.05 };
  P.track([[-13.2, -3.3], [-11.6, -3.0], [-10.4, -2.0], [-9.9, -0.4]], { ...scuff, amount: 1, gaps: 0.2, fadeIn: 0.6, fadeOut: 0.8 });
  P.track([[8.8, -8.5], [7.0, -8.0], [5.9, -6.9], [5.6, -5.4]], { ...scuff, amount: 1, gaps: 0.25, fadeIn: 0.5, fadeOut: 0.8 });
  P.track([[-3.2, 1.4], [-1.4, 1.1], [0.2, 0.0], [0.9, -1.6]], { ...scuff, amount: 0.95, gaps: 0.3, fadeIn: 0.5, fadeOut: 0.7 });
  P.track([[-6.4, -8.3], [-4.6, -8.0], [-3.3, -7.0], [-2.9, -5.6]], { ...scuff, amount: 0.9, gaps: 0.3, fadeIn: 0.5, fadeOut: 0.7 });

  // ---- what happened here: it lay by the saloon's open door long enough to pool, then it was
  // dragged out of the canopy light toward the dark by the west fence, set down twice on the way
  P.bloodPool(-8.95, 3.0, 0.48);
  P.bloodPool(-9.45, 3.5, 0.2, 0.9);
  P.bloodSpots(-8.9, 3.0, 1.1, 26);
  P.bloodDrag([[-9.1, 3.2], [-10.6, 4.3], [-12.6, 5.9], [-14.3, 7.5], [-16.4, 8.9], [-18.6, 10.7]], { rests: [4.6, 8.4] });
  P.bloodPool(-12.75, 6.05, 0.26, 0.85);
  P.bloodPool(-15.9, 8.6, 0.22, 0.8);
  P.bloodSpots(-12.7, 6.0, 0.5, 8);
}

export function buildGroundDetail(B, rng) {
  const D = B.decals;
  // A decal lying on the ground. length runs along the decal's own x (the texture's u); width
  // defaults to the cell's aspect; rot is yaw, like every other prop.
  const put = (name, x, z, length, rot = 0, o = {}) => {
    const uv = o.uv ? D.uv(name, ...o.uv) : D.uv(name);
    const width = o.width ?? length / (o.aspect ?? D.aspect(name));
    B.add('uvPaint', quadUV(length, width, uv).rotateX(UP), { m: M(x, (o.y ?? 0) + 0.009, z, 0, rot, 0) });
  };

  // ---- parking bays: the bay number worn half away
  BAYS.forEach((x, i) => put('numbers', x, -12.72, 0.62, 0, { uv: [i / 6, 0, (i + 1) / 6, 1], aspect: 1 }));
  put('noPark', -1.4, -13.45, 2.9, 0);
  // rubbish and leaves along the store kerb, where the wind leaves them
  for (const [x, len] of [[-13.2, 3.0], [-7.4, 2.6], [-0.9, 3.2], [3.6, 2.4], [9.8, 3.0], [15.4, 2.8], [20.6, 3.2]]) put(rng.next() < 0.5 ? 'leavesA' : 'leavesB', x, -17.3 + 0.42, len, rng.range(-0.03, 0.03));
  for (const [x, len] of [[-2.0, 2.4], [1.2, 2.0], [6.4, 2.2], [11.6, 2.6]]) put(rng.next() < 0.5 ? 'debrisA' : 'debrisB', x, -17.3 + 0.34, len, 0);
  // and on the pavement itself, by the doors and the bins
  for (const [x, z, len, rot] of [[-1.5, -19.2, 2.2, 0.1], [0.9, -19.55, 1.8, Math.PI], [5.4, -19.5, 1.8, Math.PI + 0.1], [-12.4, -19.4, 2.2, Math.PI], [10.4, -19.6, 2.4, Math.PI], [16.8, -19.6, 2.6, Math.PI]]) put(rng.next() < 0.6 ? 'debrisA' : 'leavesB', x, z, len, rot, { y: 0.15 });

  // ---- paint that nobody has renewed
  put('slow', 8.5, 13.2, 3.1, Math.PI);
  put('trucks', 16.4, -3.6, 3.8, 0.52);

  // ---- along the wire: leaves banked against the fence base, rubbish caught in them
  const F = L.FENCE;
  const open = (name, c) => (L.OPENINGS[name].gaps || []).some((g) => Math.abs(c - g) < 2.2);
  for (let z = -18.6; z < F.s - 1.2; z += 3.1) {
    if (!open('west', z)) { put(rng.next() < 0.5 ? 'leavesA' : 'leavesB', F.w + 0.62, z + rng.range(-0.4, 0.4), 3.2, Math.PI / 2); if (rng.next() < 0.35) put('debrisA', F.w + 0.5, z + 1.2, 2.2, Math.PI / 2); }
    if (!open('east', z)) { put(rng.next() < 0.5 ? 'leavesA' : 'leavesB', F.e - 0.62, z + rng.range(-0.4, 0.4), 3.2, -Math.PI / 2); if (rng.next() < 0.35) put('debrisB', F.e - 0.5, z + 1.2, 2.2, -Math.PI / 2); }
  }
  for (let x = F.w + 1.8; x < F.e - 1.2; x += 3.1) {
    if (L.DRIVES.some(([x0, x1]) => x > x0 - 1.8 && x < x1 + 1.8)) continue;
    put(rng.next() < 0.5 ? 'leavesA' : 'leavesB', x + rng.range(-0.4, 0.4), F.s - 0.62, 3.2, Math.PI);
    if (rng.next() < 0.4) put('debrisB', x + 1.3, F.s - 0.5, 2.2, Math.PI);
  }
}
