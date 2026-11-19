// Tokyo Tower-type steel lattice tower, built member by member: four legs that lean together under arches,
// the braced shaft above them, the two observation decks and the antenna mast. The data gives where it
// stands, how it is turned, the width of its foot and its height (PLATEAU's shell is a closed pyramid and
// is not drawn); the proportions in between are the tower's own.
// No three.js here: the caller supplies quad(p, q, r, s, outward, colour) (src/world/meshing.js).

const ORANGE = [0.47, 0.1, 0.036], WHITE = [0.72, 0.72, 0.69], GLASS = [0.05, 0.07, 0.09]; // linear RGB
// Lamps: colours brighter than 1 mark them for the shader, which lights them at night (materials.js).
const BEACON = [6.0, 0.25, 0.12], BULB = [5.0, 3.3, 1.5];
const FLASHER = [6.0, 0.2, 0.1]; // the aircraft warning lights at the top: they flash (the shader tells them by their colour)

// Half-width of the tower at a fraction t of its height, as a fraction of the half-width of the foot.
const PROFILE = [[0, 1], [0.04, 0.86], [0.08, 0.73], [0.12, 0.62], [0.2, 0.46], [0.3, 0.33], [0.4, 0.25], [0.45, 0.22], [0.6, 0.14], [0.75, 0.085], [0.84, 0.06]];
const LEGS = 0.12;               // up to here the four legs stand apart
const MAIN = [0.415, 0.455], TOP = [0.74, 0.765]; // the decks
function profile(t) {
  for (let i = 1; i < PROFILE.length; i++) if (t <= PROFILE[i][0]) {
    const [t0, r0] = PROFILE[i - 1], [t1, r1] = PROFILE[i];
    return r0 + ((r1 - r0) * (t - t0)) / (t1 - t0);
  }
  return PROFILE.at(-1)[1];
}
// international orange and white: orange up to the main deck, then alternating
const paint = (t) => (t < 0.415 || (t > 0.455 && t < 0.57) || (t > 0.63 && t < 0.73) || t > 0.84 ? ORANGE : WHITE);

// x, z: the axis; y0: the foot; H: height; R: half the width of the foot; angle: direction of one face's width.
export function buildTower({ x, z, y0, H, R, angle }, quad) {
  const e1 = [Math.cos(angle), Math.sin(angle)], e2 = [-e1[1], e1[0]];
  const P = (u, w, h) => [x + e1[0] * u + e2[0] * w, y0 + h, z + e1[1] * u + e2[1] * w];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

  // a steel member of square section from p to q
  const beam = (p, q, thick, colour) => {
    const d = unit(sub(q, p)), a = unit(cross(d, Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0])), b = cross(d, a), k = thick / 2;
    const at = (o, sa, sb) => [o[0] + (a[0] * sa + b[0] * sb) * k, o[1] + (a[1] * sa + b[1] * sb) * k, o[2] + (a[2] * sa + b[2] * sb) * k];
    for (const [n, c1, c2] of [[a, [1, -1], [1, 1]], [b, [1, 1], [-1, 1]], [[-a[0], -a[1], -a[2]], [-1, 1], [-1, -1]], [[-b[0], -b[1], -b[2]], [-1, -1], [1, -1]]])
      quad(at(p, ...c1), at(q, ...c1), at(q, ...c2), at(p, ...c2), n, colour);
  };
  // a closed box around the axis: half-width `half`, from h0 to h1
  const box = (h0, h1, half, colour) => {
    const c = (su, sw, h) => P(su * half, sw * half, h), ring = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    ring.forEach(([u, w], i) => {
      const [u2, w2] = ring[(i + 1) % 4], n = sub(P((u + u2) / 2, (w + w2) / 2, 0), P(0, 0, 0));
      quad(c(u, w, h0), c(u2, w2, h0), c(u2, w2, h1), c(u, w, h1), unit(n), colour);
    });
    quad(c(-1, -1, h1), c(1, -1, h1), c(1, 1, h1), c(-1, 1, h1), [0, 1, 0], colour);
    quad(c(-1, -1, h0), c(1, -1, h0), c(1, 1, h0), c(-1, 1, h0), [0, -1, 0], colour);
  };

  // A braced column of square section. square(h) -> [u0, w0, u1, w1], its extent at height h. Each side is
  // split into panels of about 9 m; every panel between two levels is cross-braced.
  const panels = (side) => Math.max(1, Math.min(6, Math.round(side / 9)));
  const column = (h0, h1, square, thick) => {
    const levels = [];
    for (let h = h0; h < h1 - 0.5;) {
      levels.push(h);
      const [u0, , u1] = square(h), side = Math.abs(u1 - u0), div = panels(side);
      h += Math.min(Math.max(3.2, (side / div) * 1.05), h1 - h > 4 ? Infinity : h1 - h);
    }
    levels.push(h1);
    const ringAt = (h) => {
      const [u0, w0, u1, w1] = square(h), corners = [[u0, w0], [u1, w0], [u1, w1], [u0, w1]], side = Math.abs(u1 - u0), div = panels(side), pts = [];
      corners.forEach((a, i) => { const b = corners[(i + 1) % 4]; for (let j = 0; j < div; j++) pts.push(P(a[0] + ((b[0] - a[0]) * j) / div, a[1] + ((b[1] - a[1]) * j) / div, h)); });
      return { pts, div, t: thick(side) };
    };
    let below = null;
    for (const h of levels) {
      const ring = ringAt(h), n = ring.pts.length, colour = paint(h / H);
      for (let i = 0; i < n; i++) beam(ring.pts[i], ring.pts[(i + 1) % n], ring.t * 0.6, colour);        // horizontal struts
      if (below && below.pts.length === n) for (let i = 0; i < n; i++) {
        const c = paint((h + below.h) / 2 / H), corner = i % ring.div === 0;
        beam(below.pts[i], ring.pts[i], corner ? ring.t : ring.t * 0.6, c);                                // chords
        beam(below.pts[i], ring.pts[(i + 1) % n], ring.t * 0.45, c);                                       // cross-bracing
        beam(below.pts[(i + 1) % n], ring.pts[i], ring.t * 0.45, c);
      } else if (below) { // the panel count changes here: chords at the corners only
        for (let k = 0; k < 4; k++) beam(below.pts[k * below.div], ring.pts[k * ring.div], ring.t, colour);
      }
      below = { ...ring, h };
    }
  };
  const thick = (side) => Math.min(1.5, 0.3 + side * 0.035);

  // ---- the four legs, each a column leaning in; their inner edges meet where the shaft begins
  const hLegs = LEGS * H, r = (h) => R * profile(h / H);
  const legSide = (h) => { const k = h / hLegs; return R * 0.27 * (1 - k) + r(hLegs) * k; };
  for (const su of [-1, 1]) for (const sw of [-1, 1])
    column(0, hLegs, (h) => { const o = r(h), i = o - legSide(h); return [su > 0 ? i : -o, sw > 0 ? i : -o, su > 0 ? o : -i, sw > 0 ? o : -i]; }, thick);

  // ---- the arches between the legs: a curved chord from leg to leg under the first ring of the shaft
  const archFoot = 0.035 * H, archTop = hLegs * 0.9;
  for (let face = 0; face < 4; face++) {
    const at = (f, h) => { const u = f * (r(h) - legSide(h)), w = r(h); return face === 0 ? P(u, w, h) : face === 1 ? P(w, -u, h) : face === 2 ? P(-u, -w, h) : P(-w, u, h); };
    const top = (f) => { const u = f * r(hLegs) * 0.92, w = r(hLegs); return face === 0 ? P(u, w, hLegs) : face === 1 ? P(w, -u, hLegs) : face === 2 ? P(-u, -w, hLegs) : P(-w, u, hLegs); };
    const N = 12, hOf = (f) => archFoot + (archTop - archFoot) * (1 - f * f);
    for (let i = 0; i < N; i++) {
      const f0 = -1 + (2 * i) / N, f1 = -1 + (2 * (i + 1)) / N, a = at(f0, hOf(f0)), b = at(f1, hOf(f1));
      beam(a, b, 0.9, ORANGE);
      if (i > 0) beam(a, top(f0), 0.45, ORANGE);                      // spandrel struts up to the ring
      beam(i % 2 ? a : b, top(i % 2 ? f1 : f0), 0.4, ORANGE);        // and their bracing
    }
  }

  // ---- the shaft, up to the foot of the antenna
  column(hLegs, PROFILE.at(-1)[0] * H, (h) => { const o = r(h); return [-o, -o, o, o]; }, thick);

  // ---- observation decks: white, with a band of glass
  for (const [[t0, t1], half] of [[MAIN, R * 0.36], [TOP, R * 0.15]]) {
    const h0 = t0 * H, h1 = t1 * H, g0 = h0 + (h1 - h0) * 0.35, g1 = h0 + (h1 - h0) * 0.8;
    box(h0, g0, half, WHITE); box(g0, g1, half * 0.98, GLASS); box(g1, h1, half, WHITE);
    box(h0 - (h1 - h0) * 0.5, h0, half * 0.8, WHITE); // the tapering underside
  }

  // ---- lights: warm bulbs up the four corners, red obstruction beacons at the top and on the decks
  const lamp = (u, w, h, size, colour) => {
    const c = P(u, w, h), k = size / 2, v = (sx, sy, sz) => [c[0] + sx * k, c[1] + sy * k, c[2] + sz * k];
    quad(v(-1, 1, -1), v(1, 1, -1), v(1, 1, 1), v(-1, 1, 1), [0, 1, 0], colour);
    quad(v(-1, -1, -1), v(1, -1, -1), v(1, -1, 1), v(-1, -1, 1), [0, -1, 0], colour);
    quad(v(-1, -1, -1), v(1, -1, -1), v(1, 1, -1), v(-1, 1, -1), [0, 0, -1], colour);
    quad(v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1), [0, 0, 1], colour);
    quad(v(-1, -1, -1), v(-1, -1, 1), v(-1, 1, 1), v(-1, 1, -1), [-1, 0, 0], colour);
    quad(v(1, -1, -1), v(1, -1, 1), v(1, 1, 1), v(1, 1, -1), [1, 0, 0], colour);
  };
  // (the bulbs are what lights the tower at night: close together up the corners, and up the middle of each face)
  for (let h = 6; h < 0.84 * H; h += 5.5) for (const su of [-1, 1]) for (const sw of [-1, 1]) lamp(su * (r(h) + 0.5), sw * (r(h) + 0.5), h, 0.9, BULB);
  for (let h = 8.75; h < 0.84 * H; h += 11) for (const [su, sw] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) lamp(su * (r(h) + 0.5), sw * (r(h) + 0.5), h, 0.8, BULB);
  for (const t of [MAIN[1], TOP[1], 0.3, 0.6]) for (const su of [-1, 1]) for (const sw of [-1, 1]) {
    const half = t === MAIN[1] ? R * 0.36 : t === TOP[1] ? R * 0.15 : r(t * H) + 0.8;
    lamp(su * half, sw * half, t * H + 0.8, 1.3, BEACON);
  }
  lamp(0, 0, H + 0.8, 1.6, FLASHER);
  lamp(0, 0, 0.94 * H + 0.5, 1.3, FLASHER);

  // ---- antenna: a drum, then the mast in two steps
  box(0.84 * H, 0.86 * H, R * 0.075, ORANGE);
  box(0.86 * H, 0.94 * H, R * 0.035, ORANGE);
  box(0.94 * H, H, R * 0.016, WHITE);
}
