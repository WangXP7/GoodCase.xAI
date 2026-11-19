// The lot's history as data for the ground material: where oil soaked in, where wheels polished
// the surface, where it was dug up and patched, where it cracked. Painted once at load on the CPU
// (no DOM, no renderer: tests can run it) into two maps covering MASK_RECT:
//
//   detail  SIZE^2 RGBA8, mip-mapped
//     r  stain potential: smooth hills; the material cuts tide-mark rings out of them with its own
//        fine noise. Below about 0.38 it is dirt (darker, no film); above, oil and fuel.
//     g  wheel polish: tyre tracks and the bands forty thousand cars have worn
//     b  patch repairs: 0 outside, 1 inside, a ramp RAMP metres either side of the saw cut (0.5)
//     a  crack corridor: 0.5 = none, toward 0 = an open crack nearby, toward 1 = a tar-sealed one;
//        the distance from 0.5 is the crack's strength there (trunks strong, tips and twigs weak)
//   crack   CSIZE^2 RG8, no mips
//     rg offset from the texel to the nearest point on a crack centre line, +-CRACK_RANGE metres.
//        An offset interpolates exactly across a line (a distance does not: it never reaches zero
//        between texels), so the material can draw a hairline a millimetre wide from 2.5 cm texels.
//   blood   BSIZE^2 R8, mip-mapped, over its own small rectangle (BLOOD_RECT): what was spilled
//        and dragged. The material cuts its edge with fine noise and lets the rain thin it.
//
// Shapes are noise-warped strokes and hills, never stamps: no two stains, tracks or cracks repeat.

export const MASK_RECT = [-24, -32, 24, 26]; // minX, minZ, maxX, maxZ: the lot and the heads of the drives
export const BLOOD_RECT = [-21, -0.5, -6, 14.5]; // from the saloon's door to the dark by the west fence
export const CRACK_RANGE = 0.06;
const SIZE = 1024, CSIZE = 2048, BSIZE = 1024;
const RAMP = 0.08; // metres from the saw cut to full patch / no patch
const CORRIDOR = [0.035, 0.085]; // full strength within, gone beyond (metres from the centre line)

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function valueNoise(rng) {
  const n = 128;
  const v = new Float32Array(n * n);
  for (let i = 0; i < v.length; i++) v[i] = rng.next();
  const one = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const x0 = xi & 127, x1 = (xi + 1) & 127, y0 = (yi & 127) * n, y1 = ((yi + 1) & 127) * n;
    const a = v[y0 + x0], b = v[y0 + x1], c = v[y1 + x0], d = v[y1 + x1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  // two octaves, mean 0.5
  return (x, y) => (one(x, y) * 2 + one(x * 2.13 + 17.7, y * 2.13 + 9.1)) / 3;
}

export function createMaskPainter(rng, rect = MASK_RECT, bloodRect = BLOOD_RECT) {
  const [X0, Z0, X1, Z1] = rect;
  const sx = SIZE / (X1 - X0), sz = SIZE / (Z1 - Z0);
  const cx = CSIZE / (X1 - X0), cz = CSIZE / (Z1 - Z0);
  const N = SIZE * SIZE;
  const stain = new Uint8Array(N), polish = new Uint8Array(N), patch = new Uint8Array(N), open = new Uint8Array(N), seal = new Uint8Array(N);
  const cdist = new Float32Array(CSIZE * CSIZE).fill(1e9);
  const cvec = new Uint8Array(CSIZE * CSIZE * 2).fill(255);
  const fbm = valueNoise(rng.fork('noise'));
  const cracks = []; // every crack centre line drawn, for tests and for anything that wants to follow one
  const blood = new Uint8Array(BSIZE * BSIZE);
  const bsx = BSIZE / (bloodRect[2] - bloodRect[0]), bsz = BSIZE / (bloodRect[3] - bloodRect[1]);

  // visit the texels of a map inside a world box (one texel in from the border: the border stays
  // neutral, so the clamped lookup outside the map finds nothing)
  const visit = (gx, gz, kx, kz, n) => (ax, az, bx, bz, fn) => {
    const i0 = Math.max(1, Math.floor((ax - gx) * kx)), i1 = Math.min(n - 2, Math.ceil((bx - gx) * kx));
    const j0 = Math.max(1, Math.floor((az - gz) * kz)), j1 = Math.min(n - 2, Math.ceil((bz - gz) * kz));
    for (let j = j0; j <= j1; j++) {
      const z = gz + (j + 0.5) / kz;
      for (let i = i0; i <= i1; i++) fn(gx + (i + 0.5) / kx, z, j * n + i);
    }
  };
  const each = visit(X0, Z0, sx, sz, SIZE);
  const eachBlood = visit(bloodRect[0], bloodRect[1], bsx, bsz, BSIZE);
  const put = (arr, k, v) => { const b = v >= 1 ? 255 : (v * 255 + 0.5) | 0; if (b > arr[k]) arr[k] = b; };

  const P = {
    rect, cracks,

    // A soak: a broad faint halo, a body, a dark core that sits off centre, all one smooth hill
    // warped by noise so its contours wander. r is the body's radius; amount caps the hill (keep
    // it under 0.38 for dirt that should never show a film).
    stain(x, z, r, o = {}) {
      const amount = o.amount ?? 1, ang = o.rot ?? rng.range(0, 6.283), stretch = o.stretch ?? rng.range(1.0, 1.6);
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const ox = rng.range(0, 90), oz = rng.range(0, 90);
      const kx = rng.range(-0.3, 0.3) * r, kz = rng.range(-0.3, 0.3) * r; // where the sump sat
      const f1 = 0.9 / Math.max(0.35, r), R = r * 1.9 * stretch;
      each(x - R, z - R, x + R, z + R, (px, pz, k) => {
        const dx = px - x, dz = pz - z;
        const u = (dx * ca + dz * sa) / stretch, v = dz * ca - dx * sa;
        const d0 = Math.hypot(u, v) / r;
        if (d0 > 1.9) return;
        const n = fbm((px + ox) * f1, (pz + oz) * f1) - 0.5;
        const d = d0 + n * 0.8;
        const dc = Math.hypot(u - kx, v - kz) / r + n * 0.5;
        // halo 0..0.3, body to 0.62, core to 1
        const hill = 0.3 * (1 - sstep(0.55, 1.5, d)) + 0.32 * (1 - sstep(0.25, 0.95, d)) + 0.38 * (1 - sstep(0.05, 0.5, dc));
        put(stain, k, hill * amount);
      });
      return P;
    },
    // Drops shaken off along a line: sparse, clustered, none of them round.
    drips(ax, az, bx, bz, n, o = {}) {
      const spread = o.spread ?? 0.22;
      let t = rng.next() * 0.1;
      for (let i = 0; i < n; i++) {
        t += rng.next() < 0.35 ? rng.range(0.005, 0.03) : rng.range(0.03, 0.22); // in runs, then a gap
        if (t > 1) break;
        const x = ax + (bx - ax) * t + rng.range(-spread, spread), z = az + (bz - az) * t + rng.range(-spread, spread);
        P.stain(x, z, rng.range(0.035, 0.11) * (o.size ?? 1), { amount: rng.range(0.5, 0.95), stretch: rng.range(1, 2.2) });
      }
      return P;
    },
    // A stroke of the same stuff along a path: a spill running down the fall of the slab, grime
    // along a kerb. half is the half-width; the edge wanders and the strength breaks up along it.
    smear(pts, half, o = {}) {
      const amount = o.amount ?? 0.8, soft = o.soft ?? half * 0.8, seed = rng.range(0, 90), side = o.side ?? 0;
      let s0 = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
        const len = Math.hypot(bx - ax, bz - az) || 1e-6, tx = (bx - ax) / len, tz = (bz - az) / len;
        const R = half + soft + 0.1;
        each(Math.min(ax, bx) - R, Math.min(az, bz) - R, Math.max(ax, bx) + R, Math.max(az, bz) + R, (px, pz, k) => {
          const t = Math.min(len, Math.max(0, (px - ax) * tx + (pz - az) * tz));
          const qx = ax + tx * t, qz = az + tz * t;
          const across = (px - ax) * tz - (pz - az) * tx; // + on the left of the direction of travel
          if (side && across * side < -0.02) return; // one-sided: grime lies against the kerb, not on it
          const d = Math.hypot(px - qx, pz - qz);
          const n = fbm(px * 2.6 + seed, pz * 2.6) - 0.5, m = fbm((s0 + t) * 0.7 + seed, seed * 0.37);
          const w = half * (0.55 + 0.9 * m) + n * half * 0.9;
          put(stain, k, amount * (0.45 + 0.75 * m) * (1 - sstep(w - soft * 0.4, w + soft, d)));
        });
        s0 += len;
      }
      return P;
    },

    // Tyre tracks along a path (waypoints [[x, z], ...], smoothed). Two bands a gauge apart (four
    // for dual wheels), soft-edged, each coming and going on its own: no rhythm anywhere.
    track(way, o = {}) {
      const gauge = o.gauge ?? 1.5, bw = o.width ?? 0.2, amount = o.amount ?? 0.7, soft = o.soft ?? 0.05;
      const bands = o.dual ? [-gauge / 2 - 0.17, -gauge / 2 + 0.17, gauge / 2 - 0.17, gauge / 2 + 0.17] : [-gauge / 2, gauge / 2];
      const seeds = bands.map(() => rng.range(0, 90));
      const gain = bands.map(() => rng.range(0.7, 1));
      const pts = smoothPath(way, 0.45);
      const total = pts[pts.length - 1].s;
      const fadeIn = o.fadeIn ?? Math.min(2.5, total * 0.25), fadeOut = o.fadeOut ?? Math.min(3.5, total * 0.35);
      const hold = o.gaps ?? 0.5; // 0 = continuous, 1 = mostly missing
      const reach = bw / 2 + soft + 0.04;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const len = b.s - a.s;
        if (len < 1e-6) continue;
        const tx = (b.x - a.x) / len, tz = (b.z - a.z) / len;
        for (let q = 0; q < bands.length; q++) {
          // this band's own strip of the segment
          const o0 = bands[q], ax = a.x + tz * o0, az = a.z - tx * o0, bx = b.x + tz * o0, bz = b.z - tx * o0;
          each(Math.min(ax, bx) - reach, Math.min(az, bz) - reach, Math.max(ax, bx) + reach, Math.max(az, bz) + reach, (px, pz, k) => {
            const along = ((px - ax) * tx + (pz - az) * tz) / len;
            if (along < -0.35 || along > 1.35) return; // a little overlap closes the wedge on the outside of a bend
            const e = Math.abs((px - ax) * tz - (pz - az) * tx);
            if (e > reach) return;
            const sAt = a.s + Math.min(1, Math.max(0, along)) * len;
            const env = sstep(0, fadeIn, sAt) * (1 - sstep(total - fadeOut, total, sAt));
            if (env <= 0) return;
            const present = sstep(hold * 0.62, hold * 0.62 + 0.25, fbm(sAt * 0.31 + seeds[q], seeds[q] * 0.71)); // long gaps
            if (present <= 0) return;
            const body = 0.7 + 0.3 * fbm(sAt * 1.1 + seeds[q], 3.3 + q);
            const edge = (fbm(px * 4.1 + seeds[q], pz * 4.1) - 0.5) * 0.06;
            put(polish, k, gain[q] * present * body * env * amount * (1 - sstep(bw / 2 - soft, bw / 2 + soft, e + edge)));
          });
        }
      }
      return P;
    },

    // A repair: a saw-cut rectangle (hx, hz half-sizes, rot as yaw: +x toward north), or with
    // `blob` a thrown-and-rolled pothole fill with no straight edge at all.
    patch(x, z, hx, hz, rot = 0, o = {}) {
      const c = Math.cos(rot), s = Math.sin(rot), ox = rng.range(0, 90), R = Math.hypot(hx, hz) + 0.3;
      const rad = o.corner ?? 0.12;
      each(x - R, z - R, x + R, z + R, (px, pz, k) => {
        const dx = px - x, dz = pz - z;
        const u = dx * c - dz * s, v = dx * s + dz * c;
        let sd;
        if (o.blob) sd = (Math.hypot(u / hx, v / hz) - 1) * Math.min(hx, hz) + (fbm(px * 1.7 + ox, pz * 1.7) - 0.5) * Math.min(hx, hz) * 0.9;
        else {
          const qx = Math.abs(u) - hx + rad, qz = Math.abs(v) - hz + rad;
          sd = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - rad + (fbm(px * 0.8 + ox, pz * 0.8) - 0.5) * 0.11;
        }
        if (sd < RAMP) put(patch, k, Math.min(1, 0.5 - sd / (2 * RAMP)));
      });
      return P;
    },

    // A crack: a jagged walk from (x, z) on a heading, straight runs with abrupt turns, tapering
    // to nothing, throwing off branches. o: sealed (tar poured over it), strength, branch (chance
    // per run), wander (how hard it turns).
    crack(x, z, heading, length, o = {}, depth = 0) {
      const strength = o.strength ?? 1, wander = o.wander ?? 0.5, branch = o.branch ?? 0.15;
      const line = [{ x, z, w: strength }];
      let h = heading, base = heading, done = 0;
      while (done < length) {
        const run = Math.min(length - done, rng.range(0.1, 0.45));
        base += rng.range(-0.08, 0.08);
        h = base + rng.range(-1, 1) * wander * (rng.next() < 0.25 ? 1.5 : 0.7);
        x += Math.cos(h) * run; z -= Math.sin(h) * run; done += run;
        const t = done / length;
        line.push({ x, z, w: strength * (1 - 0.75 * t * t) });
        if (depth < 2 && done < length * 0.85 && rng.next() < branch) {
          const turn = rng.range(0.45, 1.45) * (rng.next() < 0.5 ? -1 : 1);
          P.crack(x, z, h + turn, (length - done) * rng.range(0.25, 0.6), { ...o, strength: strength * (1 - 0.75 * t * t) * 0.75, branch: branch * 0.6 }, depth + 1);
        }
      }
      cracks.push({ sealed: !!o.sealed, pts: line });
      const into = o.sealed ? seal : open;
      for (let i = 0; i < line.length - 1; i++) {
        const a = line[i], b = line[i + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z) || 1e-6, tx = (b.x - a.x) / len, tz = (b.z - a.z) / len;
        // the corridor, coarse
        const R = CORRIDOR[1];
        each(Math.min(a.x, b.x) - R, Math.min(a.z, b.z) - R, Math.max(a.x, b.x) + R, Math.max(a.z, b.z) + R, (px, pz, k) => {
          const t = Math.min(len, Math.max(0, (px - a.x) * tx + (pz - a.z) * tz));
          const d = Math.hypot(px - a.x - tx * t, pz - a.z - tz * t);
          if (d < R) put(into, k, (a.w + (b.w - a.w) * (t / len)) * (1 - sstep(CORRIDOR[0], R, d)));
        });
        // the centre line, fine: offset to the nearest point
        const Rv = CRACK_RANGE * 1.5;
        const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - Rv - X0) * cx)), i1 = Math.min(CSIZE - 1, Math.ceil((Math.max(a.x, b.x) + Rv - X0) * cx));
        const j0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - Rv - Z0) * cz)), j1 = Math.min(CSIZE - 1, Math.ceil((Math.max(a.z, b.z) + Rv - Z0) * cz));
        for (let j = j0; j <= j1; j++) {
          const pz = Z0 + (j + 0.5) / cz;
          for (let ii = i0; ii <= i1; ii++) {
            const px = X0 + (ii + 0.5) / cx;
            const t = Math.min(len, Math.max(0, (px - a.x) * tx + (pz - a.z) * tz));
            const vx = a.x + tx * t - px, vz = a.z + tz * t - pz;
            const d = Math.hypot(vx, vz), k = j * CSIZE + ii;
            if (d >= cdist[k] || d > Rv) continue;
            cdist[k] = d;
            cvec[k * 2] = Math.min(255, Math.max(1, Math.round(128 + (vx / CRACK_RANGE) * 127)));
            cvec[k * 2 + 1] = Math.min(255, Math.max(1, Math.round(128 + (vz / CRACK_RANGE) * 127)));
          }
        }
      }
      return P;
    },
    // Fatigue cracking where heavy axles turn: a knot of short cracks crossing each other.
    alligator(x, z, r, n = 9) {
      for (let i = 0; i < n; i++) {
        const a = rng.range(0, 6.283), d = r * Math.sqrt(rng.next());
        P.crack(x + Math.cos(a) * d, z + Math.sin(a) * d, rng.range(0, 6.283), rng.range(0.5, 1.5) * Math.min(1.6, r), { strength: rng.range(0.5, 0.9), branch: 0.5, wander: 0.8 });
      }
      return P;
    },

    // Blood. pool: where it ran out and lay; a hill like a stain, cut hard by the material.
    bloodPool(x, z, r, amount = 1) {
      const ox = rng.range(0, 90);
      eachBlood(x - r * 1.8, z - r * 1.8, x + r * 1.8, z + r * 1.8, (px, pz, k) => {
        const d = Math.hypot(px - x, pz - z) / r + (fbm(px * 1.4 / Math.max(r, 0.2) * 0.4 + ox, pz * 1.4 / Math.max(r, 0.2) * 0.4) - 0.5) * 1.5;
        put(blood, k, amount * (1 - sstep(0.2, 1.3, d)));
      });
      return P;
    },
    // drag: something heavy and wet pulled along a path. Not stripes: a sheaf of thin streaks that
    // wander across one another, each starting and giving out where it likes, over a faint smear,
    // and all of it running dry toward the end except where the load was set down for a moment.
    bloodDrag(way, o = {}) {
      const width = o.width ?? 0.5, n = o.streaks ?? 16;
      const pts = smoothPath(way, 0.3);
      const total = pts[pts.length - 1].s;
      const streaks = [];
      for (let q = 0; q < n; q++) {
        const from = rng.range(-0.1, 0.8) * total;
        streaks.push({ off: rng.range(-0.5, 0.5) * width, half: rng.range(0.006, 0.03), seed: rng.range(0, 90), gain: rng.range(0.7, 1), from, to: from + rng.range(0.8, 3.6) });
      }
      const rests = o.rests || [];
      const reach = width / 2 + 0.22;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const len = b.s - a.s;
        if (len < 1e-6) continue;
        const tx = (b.x - a.x) / len, tz = (b.z - a.z) / len;
        eachBlood(Math.min(a.x, b.x) - reach, Math.min(a.z, b.z) - reach, Math.max(a.x, b.x) + reach, Math.max(a.z, b.z) + reach, (px, pz, k) => {
          const along = ((px - a.x) * tx + (pz - a.z) * tz) / len;
          if (along < -0.3 || along > 1.3) return;
          const across = (px - a.x) * tz - (pz - a.z) * tx;
          if (Math.abs(across) > reach) return;
          const sAt = a.s + Math.min(1, Math.max(0, along)) * len;
          // it runs out: strong at the start, a trace by the end, wetter again after each rest
          let supply = 1 - 0.6 * sstep(0, total * 0.8, sAt);
          for (const r of rests) if (sAt > r) supply = Math.max(supply, 1 - 0.6 * sstep(0, total * 0.35, sAt - r));
          let v = 0;
          for (const st of streaks) {
            if (sAt < st.from || sAt > st.to) continue;
            const sway = (fbm(sAt * 0.45 + st.seed, 1.7) - 0.5) * 0.4;
            const e = Math.abs(across - st.off - sway);
            const w = st.half * (0.3 + 1.4 * fbm(sAt * 2.3 + st.seed, 9.1));
            if (e > w + 0.02) continue;
            const ends = sstep(st.from, st.from + 0.25, sAt) * (1 - sstep(st.to - 0.5, st.to, sAt));
            v = Math.max(v, st.gain * ends * (0.55 + 0.45 * fbm(sAt * 3.1 + st.seed, 4.4)) * (1 - sstep(w * 0.3, w + 0.015, e)));
          }
          // the smear the bulk of it left: patchy, never an even band
          const body = sstep(0.38, 0.62, fbm(px * 1.9 + 7, pz * 1.9)) * sstep(0.3, 0.55, fbm(sAt * 0.7 + 11, 2.2));
          v = Math.max(v, 0.4 * body * (1 - sstep(width * 0.2, width * 0.5 + 0.06, Math.abs(across) + (fbm(px * 3 + 7, pz * 3) - 0.5) * 0.25)));
          if (v > 0) put(blood, k, v * supply);
        });
      }
      return P;
    },
    // Spatter thrown off round a point.
    bloodSpots(x, z, r, n) {
      for (let i = 0; i < n; i++) {
        const a = rng.range(0, 6.283), d = r * (0.25 + 0.75 * rng.next());
        P.bloodPool(x + Math.cos(a) * d, z + Math.sin(a) * d, rng.range(0.012, 0.05), rng.range(0.6, 1));
      }
      return P;
    },

    // -> { rect, size, data (RGBA8), crackSize, crack (RG8), crackRange, bloodRect, bloodSize, blood (R8) }
    finish() {
      const data = new Uint8Array(N * 4);
      for (let k = 0; k < N; k++) {
        data[k * 4] = stain[k]; data[k * 4 + 1] = polish[k]; data[k * 4 + 2] = patch[k];
        data[k * 4 + 3] = seal[k] > open[k] ? 128 + Math.round(seal[k] * 127 / 255) : 127 - Math.round(open[k] * 127 / 255);
      }
      return { rect, size: SIZE, data, crackSize: CSIZE, crack: cvec, crackRange: CRACK_RANGE, bloodRect, bloodSize: BSIZE, blood };
    },
  };
  return P;
}

// Catmull-Rom through the waypoints, resampled every `step` metres: [{ x, z, s }], s = distance run.
function smoothPath(way, step) {
  const out = [];
  const at = (i) => way[Math.min(way.length - 1, Math.max(0, i))];
  let s = 0, last = null;
  for (let i = 0; i < way.length - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let k = i ? 1 : 0; k <= n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
      const x = f(p0[0], p1[0], p2[0], p3[0]), z = f(p0[1], p1[1], p2[1], p3[1]);
      if (last) s += Math.hypot(x - last.x, z - last.z);
      last = { x, z, s };
      out.push(last);
    }
  }
  return out;
}
