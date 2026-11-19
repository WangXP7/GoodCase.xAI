// The Isle of Morne as a height field: one deterministic function, sampled onto a grid at load.
// X east, Y up, Z south. Sea and lake level is y = 0.
import { Noise } from '../core/noise.js';
import { clamp, saturate, lerp, smoothstep, smin, distToSegment2 } from '../core/math.js';

export const WORLD = { size: 768, half: 384, n: 513, cell: 1.5, sea: 0, lava: 20.2 };

const N1 = new Noise(7001),
  N2 = new Noise(7002),
  N3 = new Noise(7003);

// ---- the fixed geography ---------------------------------------------------------------------
const LAND = [
  [0, 25, 235],
  [-150, -190, 165],
  [70, -205, 145],
  [205, 45, 140],
  [-215, 45, 135],
  [0, 235, 80],
];
export const PEAK = { x: -170, z: -255 };
export const SCAR = { x: 70, z: -255, rim: 62, lava: 30 };
export const MERE = { x: 215, z: 50, r: 76 };
export const ISLET = { x: 184, z: 52 };
export const GATE = { x: -118, z: 60 };
export const CHAPEL = { x: -10, z: 70 };
export const HOLLOW = { x: -245, z: 30 };

const RIDGE_PTS = [
  [-114, -208],
  [-97, -150],
  [-100, -90],
  [-108, -30],
  [-118, 60],
  [-112, 150],
  [-98, 250],
  [-92, 330],
];
const RIVER_PTS = [
  [-72, -182],
  [-52, -134],
  [-36, -90],
  [-10, -52],
  [20, -26],
  [64, -4],
  [108, 18],
  [146, 34],
  [162, 40],
];
const CANYON_PTS = [
  [41.5, -130],
  [49, -163],
  [64, -212],
];
// Sites that need level ground: [name, x, z, inner radius, outer radius, mound lifted first, weight]
const FLATS = [
  ['chapel', CHAPEL.x, CHAPEL.z, 17, 38, 8.5, 1],
  ['graves', -54, 104, 13, 26, 2, 0.75],
  ['village', 66, 130, 24, 44, 0, 0.7],
  ['circle', 112, -80, 10, 44, 11, 1],
  ['hollow', HOLLOW.x, HOLLOW.z, 11, 26, 1.5, 1],
  ['lanternChapel', 12, 104, 4, 10, 0, 1],
  ['lanternSaltwood', -152, 50, 4, 10, 0, 1],
  ['lanternMere', 124, 66, 4, 10, 0, 1],
  ['lanternScar', 30, -122, 4, 10, 0, 1],
  ['tower', -64, -30, 7, 16, 3, 1],
];

function catmull(points, sub = 8) {
  const out = [];
  const P = (i) => points[Math.max(0, Math.min(points.length - 1, i))];
  const f = (a, b, c, d, t) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = P(i - 1),
      p1 = P(i),
      p2 = P(i + 1),
      p3 = P(i + 2);
    for (let k = 0; k < sub; k++) {
      const t = k / sub;
      out.push([f(p0[0], p1[0], p2[0], p3[0], t), f(p0[1], p1[1], p2[1], p3[1], t)]);
    }
  }
  out.push(points[points.length - 1].slice());
  return out;
}

/** A polyline with fast "distance to me" queries. */
export class Poly {
  constructor(pts, margin = 40) {
    this.p = pts;
    this.s = [0];
    let x0 = 1e9,
      x1 = -1e9,
      z0 = 1e9,
      z1 = -1e9;
    for (let i = 0; i < pts.length; i++) {
      if (i) this.s.push(this.s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      x0 = Math.min(x0, pts[i][0]);
      x1 = Math.max(x1, pts[i][0]);
      z0 = Math.min(z0, pts[i][1]);
      z1 = Math.max(z1, pts[i][1]);
    }
    this.len = this.s[this.s.length - 1];
    this.box = [x0 - margin, x1 + margin, z0 - margin, z1 + margin];
    this._o = { t: 0, x: 0, z: 0 };
  }
  /** Distance to the line; fills out.s (arc length) and out.i (segment). Infinity when far outside. */
  dist(x, z, out) {
    const b = this.box;
    if (x < b[0] || x > b[1] || z < b[2] || z > b[3]) return Infinity;
    const p = this.p,
      o = this._o;
    let best = Infinity;
    for (let i = 0; i < p.length - 1; i++) {
      const d = distToSegment2(x, z, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1], o);
      if (d < best) {
        best = d;
        if (out) {
          out.s = this.s[i] + o.t * (this.s[i + 1] - this.s[i]);
          out.i = i;
          out.t = o.t;
        }
      }
    }
    return best;
  }
  /** Point and unit tangent at arc length s. */
  at(s, out = {}) {
    const S = this.s,
      p = this.p;
    s = clamp(s, 0, this.len);
    let i = 0;
    while (i < S.length - 2 && S[i + 1] < s) i++;
    const t = (s - S[i]) / Math.max(1e-6, S[i + 1] - S[i]);
    out.x = lerp(p[i][0], p[i + 1][0], t);
    out.z = lerp(p[i][1], p[i + 1][1], t);
    const dx = p[i + 1][0] - p[i][0],
      dz = p[i + 1][1] - p[i][1],
      l = Math.hypot(dx, dz) || 1;
    out.tx = dx / l;
    out.tz = dz / l;
    out.i = i;
    out.t = t;
    return out;
  }
}

const RIDGE = new Poly(catmull(RIDGE_PTS, 6), 60);
export const RIVER = new Poly(catmull(RIVER_PTS, 7), 80);
const CANYON = new Poly(CANYON_PTS, 30);
const _q = { s: 0, i: 0, t: 0 };

function ridgeX(z) {
  const p = RIDGE.p;
  if (z <= p[0][1]) return p[0][0];
  for (let i = 0; i < p.length - 1; i++) if (z <= p[i + 1][1]) return lerp(p[i][0], p[i + 1][0], (z - p[i][1]) / (p[i + 1][1] - p[i][1]));
  return p[p.length - 1][0];
}

const PATHS = [
  [
    [0, 300],
    [3, 262],
    [-6, 214],
    [-2, 160],
    [-9, 118],
    [-10, 92],
  ],
  [
    [-28, 68],
    [-62, 66],
    [-96, 61],
    [-118, 60],
    [-152, 56],
    [-200, 44],
    [-236, 33],
  ],
  [
    [-2, 52],
    [6, 16],
    [16, -8],
    [22, -34],
    [30, -84],
    [36, -116],
    [41.5, -130],
    [49, -163],
    [64, -212],
  ],
  [
    [6, 74],
    [42, 78],
    [84, 70],
    [112, 66],
    [126, 64],
  ],
  [
    [6, 16],
    [-28, -6],
    [-64, -30],
  ],
  [
    [42, 78],
    [58, 104],
    [66, 128],
  ],
].map((p) => new Poly(catmull(p, 5), 24));
function pathDist(x, z) {
  let d = Infinity;
  for (let i = 0; i < PATHS.length; i++) d = Math.min(d, PATHS[i].dist(x, z));
  return d;
}

/** Signed distance to the coast in metres, positive inland. */
export function landDist(x, z) {
  const wx = x + N1.fbm2(x / 130, z / 130, 4) * 31 + N1.fbm2(x / 37 + 11, z / 37, 2) * 8,
    wz = z + N1.fbm2(x / 130 + 40, z / 130 - 17, 4) * 31 + N1.fbm2(x / 37 - 5, z / 37 + 23, 2) * 8;
  let d = 1e9;
  for (let i = 0; i < LAND.length; i++) d = smin(d, Math.hypot(wx - LAND[i][0], wz - LAND[i][1]) - LAND[i][2], 55);
  return -d;
}

/** How much of the Saltwood a point is: 0 east of the ridge, 1 well inside. */
function saltwoodWeight(x, z) {
  return smoothstep(-6, -42, x - ridgeX(z)) * smoothstep(-150, -80, z);
}
function scarDist(x, z) {
  return Math.hypot(x - SCAR.x, z - SCAR.z) + N3.fbm2(x / 30, z / 30, 2) * 3 + N3.fbm2(x / 75 + 4, z / 75, 2) * 6;
}
function mereDist(x, z) {
  const a = Math.hypot(x - MERE.x, z - MERE.z),
    b = Math.hypot(x - (MERE.x + 34), z - (MERE.z + 52)) + 34;
  // keep the west shore, where the causeway runs, regular
  const wob = N1.fbm2(x / 50 + 3, z / 50, 3) * 13 * smoothstep(MERE.x - 60, MERE.x - 20, x);
  return smin(a, b, 26) + wob;
}

/** Everything except the river, the levelled sites and the fine surface noise. */
function rawHeight(x, z) {
  const L = landDist(x, z);
  let h;
  if (L < 0) {
    h = Math.max(-16, L * 0.13) + N2.fbm2(x / 40, z / 40, 2) * 0.5 * saturate(-L / 20);
    // skerries: teeth of rock off the coast
    if (L > -90) {
      const sk = N3.fbm2(x / 17 + 3, z / 17, 3) - 0.3 - 0.24 * N1.fbm2(x / 90 + 7, z / 90, 2);
      // stacks with broken flat tops, not needles
      // low wave-washed reefs; the tall stacks are rock models set on top (see scatter)
      if (sk > 0) h = Math.min(h + Math.pow(sk, 1.1) * 78 * smoothstep(-90, -30, L) * smoothstep(-3, -16, L), Math.max(h, -0.5 + N2.fbm2(x / 7, z / 7, 3) * 2.6 + sk * 5));
    }
  } else h = 1.3 * saturate(L / 10) + 10.5 * smoothstep(6, 85, L);
  const inl = smoothstep(4, 70, L);
  h += inl * (N2.fbm2(x / 150, z / 150, 4) * 12 + N2.fbm2(x / 48 + 9, z / 48, 3) * 3.4);
  // tors: knuckles of rock on the moor, kept off the paths
  if (L > 20) {
    const tor = N3.fbm2(x / 21 + 50, z / 21, 3) - 0.2 - 0.26 * N1.fbm2(x / 110 - 9, z / 110 + 31, 2);
    if (tor > 0) h += Math.pow(tor, 1.25) * 34 * inl * smoothstep(5, 20, pathDist(x, z));
  }

  // the Saltwood: a low pale basin with dead-flat salt pans
  const sw = saltwoodWeight(x, z) * smoothstep(0, 30, L);
  if (sw > 0) {
    const pan = smoothstep(0.08, -0.22, N2.fbm2(x / 70 + 5, z / 70 + 3, 2));
    const basin = lerp(6.4 + N2.fbm2(x / 60, z / 60, 3) * 2.2, 5.3, pan * 0.85);
    h = lerp(h, basin, sw * 0.9);
  }

  // Greyhorn
  const dm = Math.hypot(x - PEAK.x, z - PEAK.z);
  if (dm < 180) {
    const mm = Math.pow(smoothstep(178, 0, dm), 1.7);
    const rg = N3.ridged2(x / 95, z / 95, 5);
    h += mm * (56 + 72 * rg) * smoothstep(-30, 30, L);
  }
  const d2 = Math.hypot(x + 96, z + 292);
  if (d2 < 95) h += Math.pow(smoothstep(95, 0, d2), 1.5) * (34 + 40 * N3.ridged2(x / 60 + 7, z / 60, 4)) * smoothstep(-30, 30, L);

  // the ridge that walls the Saltwood off, with one slot through it at the gate
  const rd = RIDGE.dist(x, z, _q);
  if (rd < 40) {
    const along = N2.fbm2(_q.s / 55, 3.3, 2);
    const wide = 1 + along * 0.28;
    const rr = rd / wide + N3.fbm2(x / 13, z / 13, 2) * 2.2;
    let ridge = (23 + along * 7) * (0.22 * smoothstep(34, 17, rr) + 0.78 * smoothstep(17, 8.5, rr)) + smoothstep(13, 4, rr) * N3.ridged2(x / 21, z / 21, 3) * 9;
    const dx = Math.abs(x - GATE.x);
    if (dx < 46) ridge *= lerp(smoothstep(3.4, 9.5, Math.abs(z - GATE.z)), 1, smoothstep(34, 46, dx));
    h += ridge;
  }

  // the Brimstone Scar: a cone with a crest no one climbs, a bowl, a lava lake, an island in it
  const ds = scarDist(x, z);
  if (ds < 130) {
    const lf = smoothstep(-40, 20, L);
    const outer = (36 * smoothstep(126, 64, ds) + 13 * smoothstep(77, 66, ds)) * lf;
    if (ds >= SCAR.rim) h += outer;
    else {
      const rimH = h + outer;
      let inner = lerp(20.6, rimH, smoothstep(44, SCAR.rim, ds));
      inner = lerp(inner, 16.2, smoothstep(SCAR.lava + 1.5, SCAR.lava - 4, ds));
      inner = lerp(inner, 20.7, smoothstep(9.5, 6.5, ds));
      h = inner;
    }
    // the canyon in
    const cd = CANYON.dist(x, z, _q);
    if (cd < 10) {
      const floor = lerp(CANYON.h0, 20.6, smoothstep(0, CANYON.len, _q.s));
      h = lerp(h, floor, smoothstep(9.5, 4.2, cd));
    }
  }

  // Quickmere
  const dl = mereDist(x, z);
  if (dl < MERE.r + 30) {
    const bed = -0.9 - 5.4 * smoothstep(MERE.r - 6, MERE.r - 46, dl);
    h = lerp(h, bed, smoothstep(MERE.r + 28, MERE.r - 4, dl));
    const di = Math.hypot(x - ISLET.x, z - ISLET.z);
    h = lerp(h, 1.5, smoothstep(12.5, 6.5, di));
  }
  return h;
}
CANYON.h0 = 0; // set below, once rawHeight can run without the canyon
CANYON.h0 = (() => {
  const b = CANYON.box;
  CANYON.box = [1e9, 1e9, 1e9, 1e9];
  const v = rawHeight(CANYON_PTS[0][0], CANYON_PTS[0][1]);
  CANYON.box = b;
  return v;
})();

// River bed profile: follow the land down, never uphill.
const RIVER_BED = [],
  RIVER_SURF = [];
{
  let bed = rawHeight(RIVER.p[0][0], RIVER.p[0][1]) - 0.5;
  for (let i = 0; i < RIVER.p.length; i++) {
    const seg = i ? RIVER.s[i] - RIVER.s[i - 1] : 0;
    bed = Math.min(bed - seg * 0.012, rawHeight(RIVER.p[i][0], RIVER.p[i][1]) - 1.25);
    RIVER_BED.push(bed);
  }
  // ease the last stretch into the lake so the surface arrives at y = 0
  for (let i = 0; i < RIVER.p.length; i++) {
    const end = smoothstep(RIVER.len - 70, RIVER.len - 8, RIVER.s[i]);
    RIVER_BED[i] = lerp(RIVER_BED[i], Math.min(RIVER_BED[i], -0.9), end);
    RIVER_SURF.push(Math.max(0, RIVER_BED[i] + 0.8));
  }
}
function riverAt(q) {
  const i = q.i;
  return [lerp(RIVER_BED[i], RIVER_BED[i + 1], q.t), lerp(RIVER_SURF[i], RIVER_SURF[i + 1], q.t)];
}

const FLAT_H = FLATS.map((f) => {
  let h = rawHeight(f[1], f[2]) + f[5];
  return Math.max(h, 1.2);
});

/** The finished height of the land at any point. */
export function heightFn(x, z) {
  let h = rawHeight(x, z);
  let level = 0;
  for (let i = 0; i < FLATS.length; i++) {
    const f = FLATS[i];
    let d = Math.hypot(x - f[1], z - f[2]);
    if (d > f[4] * 1.25) continue;
    if (d > f[3]) d += N1.fbm2(x / 17, z / 17, 2) * (d - f[3]) * 0.55;
    if (d > f[4]) continue;
    if (f[5]) h += f[5] * smoothstep(f[4], f[3] * 0.8, d);
    const w = smoothstep(f[4] * 0.72, f[3], d) * f[6];
    h = lerp(h, FLAT_H[i], w);
    level = Math.max(level, w);
  }
  const rv = RIVER.dist(x, z, _q);
  if (rv < 75) h -= 3.6 * smoothstep(75, 12, rv) * smoothstep(-1, 4, h) * smoothstep(RIVER.len - 40, RIVER.len - 110, _q.s);
  if (rv < 9) {
    const [bed] = riverAt(_q);
    h = Math.min(h, lerp(h, bed, smoothstep(8.5, 2.8, rv)));
  }
  h += N3.fbm2(x / 9, z / 9, 2) * 0.24 * (1 - level) * smoothstep(-2, 1.5, h);
  return h;
}



export function regionOf(x, z, h) {
  if (Math.hypot(x - SCAR.x, z - SCAR.z) < 128 || CANYON.dist(x, z) < 12) return 'scar';
  if (h > 46 || Math.hypot(x - PEAK.x, z - PEAK.z) < 105) return 'heights';
  if (saltwoodWeight(x, z) > 0.45) return 'saltwood';
  if (Math.hypot(x - MERE.x, z - MERE.z) < MERE.r + 42) return 'mere';
  if (z > 205) return 'shore';
  return 'vale';
}

/**
 * Sample the island onto its grid. Async so the loading screen can draw between slices.
 * Returns the terrain object every other system reads.
 */
export async function generateTerrain(tick = null) {
  const { n, cell, half } = WORLD;
  const h = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    const z = j * cell - half;
    for (let i = 0; i < n; i++) h[j * n + i] = heightFn(i * cell - half, z);
    if (tick && j % 24 === 0) await tick((j / n) * 0.8);
  }

  // cavity: how far a point sits below its surroundings (box blur, two radii)
  const blur = (src, r) => {
    const tmp = new Float32Array(n * n),
      out = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += src[j * n + clamp(i, 0, n - 1)];
      for (let i = 0; i < n; i++) {
        tmp[j * n + i] = acc / (2 * r + 1);
        acc += src[j * n + Math.min(n - 1, i + r + 1)] - src[j * n + Math.max(0, i - r)];
      }
    }
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let j = -r; j <= r; j++) acc += tmp[clamp(j, 0, n - 1) * n + i];
      for (let j = 0; j < n; j++) {
        out[j * n + i] = acc / (2 * r + 1);
        acc += tmp[Math.min(n - 1, j + r + 1) * n + i] - tmp[Math.max(0, j - r) * n + i];
      }
    }
    return out;
  };
  const b1 = blur(h, 3),
    b2 = blur(h, 10);
  if (tick) await tick(0.86);

  const nrm = new Uint8Array(n * n * 4); // nx, nz (0..255 -> -1..1), ao, slope
  const maskA = new Uint8Array(n * n * 4); // salt, ash, path, grass density
  const maskB = new Uint8Array(n * n * 4); // wet, snow, heather patches, built ground
  const q = { s: 0, i: 0, t: 0 };
  for (let j = 0; j < n; j++) {
    const z = j * cell - half;
    for (let i = 0; i < n; i++) {
      const x = i * cell - half,
        k = j * n + i,
        y = h[k];
      const hx = h[j * n + Math.min(n - 1, i + 1)] - h[j * n + Math.max(0, i - 1)];
      const hz = h[Math.min(n - 1, j + 1) * n + i] - h[Math.max(0, j - 1) * n + i];
      let nx = -hx,
        ny = 2 * cell,
        nz = -hz;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const slope = 1 - ny;
      const cav = (b1[k] - y) * 0.5 + (b2[k] - y) * 0.16;
      nrm[k * 4] = (nx * 0.5 + 0.5) * 255;
      nrm[k * 4 + 1] = (nz * 0.5 + 0.5) * 255;
      nrm[k * 4 + 2] = saturate(1 - cav * 0.5) * 255;
      nrm[k * 4 + 3] = saturate(slope * 2) * 255;

      const L = landDist(x, z);
      const sw = saltwoodWeight(x, z) * smoothstep(0, 30, L);
      const ds = scarDist(x, z);
      const ash = Math.max(smoothstep(132, 96, ds), smoothstep(14, 7, CANYON.dist(x, z)));
      let path = 0;
      for (const p of PATHS) path = Math.max(path, smoothstep(2.7, 1.1, p.dist(x, z) + N3.n2(x / 3, z / 3) * 0.7));
      let built = 0;
      built = Math.max(built, smoothstep(15, 12, Math.hypot(x - CHAPEL.x, z - CHAPEL.z)));
      const rv = RIVER.dist(x, z, q);
      const wetRiver = rv < 12 ? smoothstep(9, 3.5, rv) : 0;
      const dl = mereDist(x, z);
      const wet = Math.max(wetRiver, smoothstep(2.2, 0.2, y) * smoothstep(-40, 0, L + 40) * (dl < MERE.r + 34 ? 1 : 0.0), smoothstep(MERE.r + 16, MERE.r + 2, dl));
      const snow = smoothstep(80, 97, y + N2.fbm2(x / 30, z / 30, 2) * 9) * smoothstep(0.45, 0.2, slope);
      const heather = saturate(N2.fbm2(x / 34 + 80, z / 34 - 20, 3) * 1.6 + 0.2);
      let grass = 1;
      grass *= 1 - path;
      grass *= smoothstep(0.34, 0.2, slope);
      grass *= smoothstep(2.3, 4.2, y + N2.fbm2(x / 11, z / 11, 2) * 1.2);
      grass *= 1 - smoothstep(60, 82, y);
      grass *= 1 - ash * 0.97;
      grass *= lerp(1, 0.28, sw) * (sw > 0.2 && y < 5.75 ? 0.15 : 1);
      grass *= 1 - built;
      grass *= 1 - wetRiver * 0.8;
      grass *= 0.72 + 0.28 * saturate(N2.fbm2(x / 16, z / 16, 2) + 0.6);
      maskA[k * 4] = sw * 255;
      maskA[k * 4 + 1] = ash * 255;
      maskA[k * 4 + 2] = Math.max(path, built * 0.8) * 255;
      maskA[k * 4 + 3] = saturate(grass) * 255;
      maskB[k * 4] = saturate(wet) * 255;
      maskB[k * 4 + 1] = snow * 255;
      maskB[k * 4 + 2] = heather * 255;
      maskB[k * 4 + 3] = built * 255;
    }
    if (tick && j % 48 === 0) await tick(0.86 + (j / n) * 0.14);
  }

  const T = { ...WORLD, h, nrm, maskA, maskB, river: RIVER, riverBed: RIVER_BED, riverSurf: RIVER_SURF, paths: PATHS, canyon: CANYON };
  const cl = (v) => (v < 0 ? 0 : v > n - 1.001 ? n - 1.001 : v);
  T.heightAt = (x, z) => {
    const fx = cl((x + half) / cell),
      fz = cl((z + half) / cell);
    const i = fx | 0,
      j = fz | 0,
      u = fx - i,
      v = fz - j,
      k = j * n + i;
    return (h[k] * (1 - u) + h[k + 1] * u) * (1 - v) + (h[k + n] * (1 - u) + h[k + n + 1] * u) * v;
  };
  /** Unit normal of the land at a point, into out[0..2]. */
  T.normalAt = (x, z, out = [0, 1, 0]) => {
    const e = 0.75;
    const dx = T.heightAt(x + e, z) - T.heightAt(x - e, z),
      dz = T.heightAt(x, z + e) - T.heightAt(x, z - e);
    const l = Math.hypot(dx, 2 * e, dz);
    out[0] = -dx / l;
    out[1] = (2 * e) / l;
    out[2] = -dz / l;
    return out;
  };
  const samp = (arr, x, z, c) => {
    const i = Math.round(cl((x + half) / cell)),
      j = Math.round(cl((z + half) / cell));
    return arr[(j * n + i) * 4 + c] / 255;
  };
  T.mask = (x, z) => ({
    salt: samp(maskA, x, z, 0),
    ash: samp(maskA, x, z, 1),
    path: samp(maskA, x, z, 2),
    grass: samp(maskA, x, z, 3),
    wet: samp(maskB, x, z, 0),
    snow: samp(maskB, x, z, 1),
    heather: samp(maskB, x, z, 2),
    built: samp(maskB, x, z, 3),
    slope: samp(nrm, x, z, 3) * 0.5,
  });
  T.regionAt = (x, z) => regionOf(x, z, T.heightAt(x, z));
  /** What is underfoot, for footsteps. */
  T.surfaceAt = (x, z) => {
    const y = T.heightAt(x, z);
    if (y < -0.08) return 'water';
    const m = T.mask(x, z);
    if (m.snow > 0.5) return 'snow';
    if (m.slope > 0.3) return 'stone';
    if (m.ash > 0.5) return 'ash';
    if (m.salt > 0.55) return 'salt';
    if (m.path > 0.5) return 'dirt';
    if (y < 1.5 && landDist(x, z) < 22) return 'sand';
    return 'grass';
  };
  /** Level of the river surface near a point, or null away from the river. */
  T.riverLevel = (x, z) => {
    const d = RIVER.dist(x, z, q);
    if (d > 7) return null;
    return riverAt(q)[1];
  };
  T.landDist = landDist;
  T.pathDist = pathDist;
  T.saltwood = saltwoodWeight;
  T.mereDist = mereDist;
  T.scarDist = scarDist;
  T.canyonDist = (x, z) => CANYON.dist(x, z);
  T.riverDist = (x, z) => RIVER.dist(x, z);
  T.flats = FLATS.map((f) => ({ name: f[0], x: f[1], z: f[2], r: f[3], rOut: f[4] }));
  T.flat = (name) => {
    const i = FLATS.findIndex((f) => f[0] === name);
    return i < 0 ? null : { x: FLATS[i][1], z: FLATS[i][2], y: T.heightAt(FLATS[i][1], FLATS[i][2]), r: FLATS[i][3] };
  };
  if (tick) await tick(1);
  return T;
}
