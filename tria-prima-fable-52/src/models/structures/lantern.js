// The Lantern of the Dead: a slender eight-sided stone tower on three steps, with an open lamp
// chamber under a stone cap. Cold: the game lights it at the `flame` anchor.
import { Builder, Rng, Noise, MAT, PAL, TAU, THREE, paint, box, lathe, torus, tube, rock, strokes, merge } from '../kit.js';
import { register } from '../registry.js';
import { Mesher, makeStone, ironSpec, woodSpec, chain, skull } from './_shared.js';

const N = 8;
const UP = [0, 1, 0],
  DOWN = [0, -1, 0];
const _cm = new THREE.Color(),
  _ce = new THREE.Color(),
  _t = new THREE.Color();

/** Corner k of the regular N-gon with corner radius r at height y. A face is centred on +Z. */
export function corner(k, r, y, n = N) {
  const a = Math.PI / n + (k / n) * TAU;
  return [Math.sin(a) * r, y, Math.cos(a) * r];
}
const mix3 = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];

/**
 * One cushioned stone face on a flat panel: a = bottom left, b = bottom right, c = top right,
 * d = top left, seen from outside. An open side has no joint: the stone carries on round the corner.
 */
export function piece(M, a, b, c, d, cm, ce, bulge, openL = false, openR = false) {
  let nx = (b[1] - a[1]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[1] - a[1]);
  let ny = (b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]);
  let nz = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l;
  ny /= l;
  nz /= l;
  const mx = (a[0] + b[0] + c[0] + d[0]) / 4,
    my = (a[1] + b[1] + c[1] + d[1]) / 4,
    mz = (a[2] + b[2] + c[2] + d[2]) / 4;
  const i0 = M._v([mx + nx * bulge, my + ny * bulge, mz + nz * bulge], nx, ny, nz, cm);
  const pts = [a, b, c, d],
    open = [openL, openR, openR, openL];
  for (let k = 0; k < 4; k++) {
    const q = pts[k];
    let dx = q[0] - mx,
      dy = q[1] - my,
      dz = q[2] - mz;
    if (open[k]) {
      // only the bed joint shows here: lean the normal up or down, keep most of the face colour
      dx = 0;
      dz = 0;
    }
    const dl = Math.hypot(dx, dy, dz) || 1;
    const ex = nx + (dx / dl) * 0.42,
      ey = ny + (dy / dl) * 0.42,
      ez = nz + (dz / dl) * 0.42;
    const s = 1 / Math.hypot(ex, ey, ez);
    M._v(q, ex * s, ey * s, ez * s, open[k] ? _t.copy(cm).lerp(ce, 0.4) : ce);
  }
  M.i.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3, i0, i0 + 3, i0 + 4, i0, i0 + 4, i0 + 1);
}

/**
 * One course of an n-sided shaft: corner radius ra at ya, rb at yb. `joints` are perimeter positions
 * (side index + fraction along that side) where one stone ends and the next begins, so a stone may
 * wrap a corner.
 */
export function polyRing(M, R, stone, { n = N, ra, rb = ra, ya, yb, joints, key = 0, bulge = 0.014, dark = 1, at = [0, 0] }) {
  const js = joints.slice().sort((p, q) => p - q);
  const m = js.length;
  const off = (p) => [p[0] + at[0], p[1], p[2] + at[1]];
  for (let s = 0; s < m; s++) {
    const u0 = js[s],
      u1 = s + 1 < m ? js[s + 1] : js[0] + n;
    const am = Math.PI / n + ((u0 + u1) / 2 / n) * TAU;
    stone.face(R, Math.sin(am) * ra * 3 + key + at[0], (ya + yb) / 2, Math.cos(am) * ra * 3 + key + at[1], _cm, _ce);
    if (dark !== 1) {
      _cm.multiplyScalar(dark);
      _ce.multiplyScalar(dark);
    }
    const bg = R.range(0.004, bulge);
    for (let i = Math.floor(u0 + 1e-9); i < u1 - 1e-9; i++) {
      const t0 = Math.max(0, u0 - i),
        t1 = Math.min(1, u1 - i);
      if (t1 - t0 < 1e-6) continue;
      const A0 = off(corner(i, ra, ya, n)),
        A1 = off(corner(i + 1, ra, ya, n)),
        B0 = off(corner(i, rb, yb, n)),
        B1 = off(corner(i + 1, rb, yb, n));
      piece(M, mix3(A0, A1, t0), mix3(A0, A1, t1), mix3(B0, B1, t1), mix3(B0, B1, t0), _cm, _ce, bg, u0 < i - 1e-9, u1 > i + 1 + 1e-9);
    }
  }
}
/** Joints for big blocks: every corner is one stone wrapping round, with a filler in the middle of each side. */
export const quoinJoints = (R, n = N) => {
  const out = [];
  for (let i = 0; i < n; i++) out.push(i + R.range(0.2, 0.36), i + R.range(0.64, 0.8));
  return out;
};
/** `per` stones in the course, each wrapping a corner or two; shift turns the pattern for the next course. */
export const wrapJoints = (R, per, shift = 0, n = N) => {
  const out = [];
  for (let s = 0; s < per; s++) {
    const u = (s + R.range(0.3, 0.7)) * (n / per) + shift;
    const f = Math.min(0.76, Math.max(0.24, u - Math.floor(u)));
    out.push((((Math.floor(u) + f) % n) + n) % n);
  }
  return out;
};

/** A flat ring of slabs (a tread) between corner radius r0 and r1 at height y. */
export function polyTop(M, R, stone, { n = N, r0, r1, y, key = 0, split = 2, dark = 0.9, hint = UP, at = [0, 0] }) {
  const off = (p) => [p[0] + at[0], p[1], p[2] + at[1]];
  for (let i = 0; i < n; i++) {
    const cuts = [0];
    for (let s = 1; s < split; s++) cuts.push((s + R.range(-0.25, 0.25)) / split);
    cuts.push(1);
    const O0 = off(corner(i, r1, y, n)),
      O1 = off(corner(i + 1, r1, y, n)),
      I0 = off(corner(i, r0, y, n)),
      I1 = off(corner(i + 1, r0, y, n));
    for (let s = 0; s < cuts.length - 1; s++) {
      const a = mix3(O0, O1, cuts[s]),
        b = mix3(O0, O1, cuts[s + 1]);
      stone.top(R, (a[0] + b[0]) * 0.5 + key, y, (a[2] + b[2]) * 0.5, _cm);
      _cm.multiplyScalar(dark);
      _ce.copy(_cm).multiplyScalar(0.62);
      M.face(a, b, mix3(I0, I1, cuts[s + 1]), mix3(I0, I1, cuts[s]), hint, _cm, _ce, R.range(0.002, 0.01), 0.35);
    }
  }
}

// how far the tower has settled out of plumb, per metre of height above the steps
const KX = 0.02,
  KZ = -0.012,
  Y_LEAN = 0.6;
function lean(g) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y > Y_LEAN) p.setXYZ(i, p.getX(i) + (y - Y_LEAN) * KX, y, p.getZ(i) + (y - Y_LEAN) * KZ);
  }
  return g;
}

/** The lamp chamber: corner posts and one carved head stone per side with a pointed opening. */
function chamber(M, R, stone, { y0, spring, top, ro, ri, broken = -1 }) {
  const L = 2 * ro * Math.sin(Math.PI / N);
  const w = L - 0.15;
  const Rr = 0.95 * w,
    off = Rr - w / 2,
    A = Math.acos(off / Rr);
  const SEG = 3;
  const arch = []; // [t along the side, y], left springing -> point -> right springing
  for (let j = 0; j <= SEG; j++) {
    const th = (A * j) / SEG;
    arch.push([0.5 - (-off + Rr * Math.cos(th)) / L, spring + Rr * Math.sin(th)]);
  }
  for (let j = SEG - 1; j >= 0; j--) {
    const th = (A * j) / SEG;
    arch.push([0.5 + (-off + Rr * Math.cos(th)) / L, spring + Rr * Math.sin(th)]);
  }
  const t0 = arch[0][0],
    t1 = arch[arch.length - 1][0];
  // one colour per corner post, one per head stone
  const post = [],
    postE = [],
    head = [];
  for (let k = 0; k < N; k++) {
    const c = corner(k, ro, y0);
    stone.face(R, c[0] * 3 + 5, y0 + 0.2, c[2] * 3, _cm, _ce);
    post.push(_cm.clone());
    postE.push(_ce.clone());
    stone.face(R, c[0] * 3 + 9, top, c[2] * 3 + 4, _cm, _ce);
    head.push(_cm.clone().multiplyScalar(0.95));
  }
  const soot = (c, k = 0.3) => _t.copy(c).multiplyScalar(k).clone();
  for (let i = 0; i < N; i++) {
    const am = Math.PI / N + ((i + 0.5) / N) * TAU;
    const nm = [Math.sin(am), 0, Math.cos(am)],
      nin = [-nm[0], 0, -nm[2]];
    const P = (t, y, r) => mix3(corner(i, r, y), corner(i + 1, r, y), t);
    const c0 = corner(i, 1, 0),
      c1 = corner(i + 1, 1, 0);
    const dl = Math.hypot(c1[0] - c0[0], c1[2] - c0[2]);
    const dir = [(c1[0] - c0[0]) / dl, 0, (c1[2] - c0[2]) / dl],
      rid = [-dir[0], 0, -dir[2]];
    const kL = i,
      kR = (i + 1) % N;
    // the two half posts on this side
    piece(M, P(0, y0, ro), P(t0, y0, ro), P(t0, spring, ro), P(0, spring, ro), post[kL], postE[kL], 0.006, true, false);
    piece(M, P(t1, y0, ro), P(1, y0, ro), P(1, spring, ro), P(t1, spring, ro), post[kR], postE[kR], 0.006, false, true);
    M.face(P(0, y0, ri), P(t0, y0, ri), P(t0, spring, ri), P(0, spring, ri), nin, soot(post[kL]));
    M.face(P(t1, y0, ri), P(1, y0, ri), P(1, spring, ri), P(t1, spring, ri), nin, soot(post[kR]));
    M.face(P(t0, y0, ro), P(t0, y0, ri), P(t0, spring, ri), P(t0, spring, ro), dir, soot(post[kL], 0.5));
    M.face(P(t1, y0, ro), P(t1, y0, ri), P(t1, spring, ri), P(t1, spring, ro), rid, soot(post[kR], 0.5));
    if (i !== broken) {
      const hc = head[i],
        hs = soot(hc, 0.28),
        hr = soot(hc, 0.42);
      M.face(P(0, spring, ro), P(t0, spring, ro), P(t0, top, ro), P(0, top, ro), nm, hc);
      M.face(P(t1, spring, ro), P(1, spring, ro), P(1, top, ro), P(t1, top, ro), nm, hc);
      M.face(P(0, spring, ri), P(t0, spring, ri), P(t0, top, ri), P(0, top, ri), nin, hs);
      M.face(P(t1, spring, ri), P(1, spring, ri), P(1, top, ri), P(t1, top, ri), nin, hs);
      const cen = P(0.5, spring - 0.05, (ro + ri) / 2);
      for (let j = 0; j < arch.length - 1; j++) {
        const [ta, ya] = arch[j],
          [tb, yb] = arch[j + 1];
        M.face(P(ta, ya, ro), P(tb, yb, ro), P(tb, top, ro), P(ta, top, ro), nm, hc);
        M.face(P(ta, ya, ri), P(tb, yb, ri), P(tb, top, ri), P(ta, top, ri), nin, hs);
        const mid = P((ta + tb) / 2, (ya + yb) / 2, (ro + ri) / 2);
        M.face(P(ta, ya, ro), P(tb, yb, ro), P(tb, yb, ri), P(ta, ya, ri), [cen[0] - mid[0], cen[1] - mid[1], cen[2] - mid[2]], hr);
      }
    } else {
      // this head stone has fallen out: close what it leaves bare
      const core = soot(head[i], 0.5);
      M.face(P(0, spring, ro), P(t0, spring, ro), P(t0, spring, ri), P(0, spring, ri), UP, core);
      M.face(P(t1, spring, ro), P(1, spring, ro), P(1, spring, ri), P(t1, spring, ri), UP, core);
      M.face(P(0, spring, ro), P(0, spring, ri), P(0, top, ri), P(0, top, ro), dir, core);
      M.face(P(1, spring, ro), P(1, spring, ri), P(1, top, ri), P(1, top, ro), rid, core);
      M.face(P(0, top, ro), P(1, top, ro), P(1, top, ri), P(0, top, ri), DOWN, soot(head[i], 0.3));
    }
  }
}

register(
  'lantern',
  () => {
    const b = new Builder();
    const R = new Rng(907);
    const stone = makeStone({ seed: 23, moss: 0.8, lichen: 0.7, damp: 0.5, warm: 0.1 });
    const M = new Mesher();

    // foundation and three steps
    const STEPS = [
      [1.36, 0.2],
      [1.08, 0.4],
      [0.82, 0.6],
    ];
    polyRing(M, R, stone, { ra: 1.42, rb: 1.37, ya: -0.7, yb: 0, joints: quoinJoints(R), key: 1, dark: 0.7 });
    STEPS.forEach(([r, top], k) => {
      polyRing(M, R, stone, { ra: r + 0.012, rb: r, ya: top - 0.2, yb: top, joints: quoinJoints(R), key: 10 + k * 13, bulge: 0.02 });
      polyTop(M, R, stone, { r0: k < 2 ? STEPS[k + 1][0] - 0.03 : 0.5, r1: r, y: top, key: k * 7 + 3 });
    });
    // plinth with a weathered offset
    polyRing(M, R, stone, { ra: 0.59, rb: 0.58, ya: 0.6, yb: 0.98, joints: wrapJoints(R, 4, 0), key: 40 });
    polyRing(M, R, stone, { ra: 0.58, rb: 0.425, ya: 0.98, yb: 1.1, joints: wrapJoints(R, 4, 1), key: 44 });
    // the shaft, tapering
    const Y0 = 1.1,
      Y1 = 3.72;
    const rS = (y) => 0.41 - ((y - Y0) / (Y1 - Y0)) * 0.065;
    let y = Y0,
      c = 0;
    while (y < Y1 - 1e-6) {
      let h = R.range(0.3, 0.48);
      if (Y1 - (y + h) < 0.22) h = Y1 - y;
      polyRing(M, R, stone, { ra: rS(y), rb: rS(y + h), ya: y, yb: y + h, joints: wrapJoints(R, c % 3 === 2 ? 3 : 4, c % 2), key: 50 + c * 3.1 });
      y += h;
      c++;
    }
    // the corbelled floor of the chamber
    const RO = 0.46,
      RI = 0.35,
      CH0 = 4.0,
      SPRING = 4.42,
      CH1 = 4.8;
    polyRing(M, R, stone, { ra: rS(Y1), rb: 0.53, ya: Y1, yb: 3.9, joints: wrapJoints(R, 4, 0), key: 80 });
    polyRing(M, R, stone, { ra: 0.53, rb: 0.53, ya: 3.9, yb: CH0, joints: wrapJoints(R, 4, 1), key: 84 });
    {
      const pts = [];
      for (let k = 0; k < N; k++) pts.push(corner(k, 0.53, CH0));
      stone.top(R, 3, CH0, 2, _cm);
      M.fan(pts, UP, _t.copy(_cm).multiplyScalar(0.25).clone(), _cm.clone(), 0, 0);
    }
    chamber(M, R, stone, { y0: CH0, spring: SPRING, top: CH1, ro: RO, ri: RI, broken: 6 });
    {
      // soot-black ceiling
      const pts = [];
      for (let k = 0; k < N; k++) pts.push(corner(k, RI, CH1));
      M.fan(pts, DOWN, _t.set('#0b0a0a').clone(), _t.clone(), 0, 0);
    }
    // cornice and cap
    polyRing(M, R, stone, { ra: RO, rb: 0.57, ya: CH1, yb: 4.9, joints: wrapJoints(R, 4, 0), key: 90 });
    polyTop(M, R, stone, { r0: 0.55, r1: 0.615, y: 4.885, key: 95, split: 1, hint: DOWN, dark: 0.5 });
    polyRing(M, R, stone, { ra: 0.615, rb: 0.61, ya: 4.885, yb: 4.96, joints: wrapJoints(R, 4, 1), key: 96 });
    const CAP = [
      [0.61, 4.96],
      [0.44, 5.13],
      [0.27, 5.3],
      [0.1, 5.47],
    ];
    for (let k = 0; k < CAP.length - 1; k++) polyRing(M, R, stone, { ra: CAP[k][0], rb: CAP[k + 1][0], ya: CAP[k][1], yb: CAP[k + 1][1], joints: wrapJoints(R, k === 2 ? 2 : 4, k % 2), key: 100 + k * 5, bulge: 0.01 });
    b.add(lean(M.build({ rough: 0.96, mat: MAT.STONE })));

    // the broken stump of the finial
    {
      const g = rock(0.11, { seed: 31, detail: 1, rough: 0.35, squash: [0.85, 1.25, 0.85], facet: true });
      g.translate(0, 5.5, 0);
      stone.top(R, 0, 5.5, 0, _cm);
      const cc = _cm.clone();
      b.add(lean(paint(g, { color: cc, rough: 0.97, mat: MAT.STONE })));
    }

    // the cold lamp: an iron fire pan on a stem
    {
      const pan = lathe(
        [
          [0.07, 0, 'hard'],
          [0.085, 0.015],
          [0.03, 0.04],
          [0.026, 0.15],
          [0.1, 0.24],
          [0.14, 0.3, 'hard'],
          [0.125, 0.3, 'hard'],
          [0.09, 0.25],
          [0, 0.22],
        ],
        8
      );
      pan.translate(0, CH0, 0);
      const coal = [];
      for (let i = 0; i < 5; i++) {
        const g = rock(R.range(0.025, 0.04), { seed: 60 + i, detail: 0, rough: 0.3, facet: true });
        g.translate(R.range(-0.06, 0.06), CH0 + 0.25, R.range(-0.06, 0.06));
        coal.push(paint(g, { color: R.pick(['#1a1817', '#2c2927', '#3a3633']), rough: 1, mat: MAT.STONE }));
      }
      b.add(lean(paint(pan, ironSpec(0.75, 4, 14))), lean(merge(coal)));
    }

    // the hoist chain, hanging from a ring under the chamber
    {
      const ax = 0.2,
        az = 0.52;
      const ring = torus(0.032, 0.007, 4, 8);
      ring.rotateX(Math.PI / 2);
      ring.rotateY(0.4);
      ring.translate(ax, 3.9, az);
      b.add(lean(paint(ring, ironSpec(0.8, 2, 12))));
      b.add(lean(chain([ax, 3.87, az], [ax + 0.03, 2.75, az - 0.02], { sag: 0, link: 0.105, wire: 0.008, rust: 0.8, seed: 5 })));
      const hook = torus(0.035, 0.008, 4, 8, Math.PI * 1.3);
      hook.rotateX(Math.PI / 2);
      hook.rotateZ(-0.4);
      hook.translate(ax + 0.03, 2.71, az - 0.02);
      b.add(lean(paint(hook, ironSpec(0.8, 6, 12))));
    }

    // the little iron door the keeper reached the lamp rope through
    {
      const ya = 1.34,
        hgt = 0.46,
        zf = rS(1.57) * Math.cos(Math.PI / N);
      const hole = box(0.25, hgt + 0.05, 0.012);
      hole.translate(0, ya + hgt / 2, zf);
      b.add(lean(paint(hole, { color: '#080707', rough: 1, mat: MAT.PLAIN })));
      const leaf = [];
      const plate = box(0.21, hgt, 0.014);
      plate.translate(0.105, 0, 0);
      leaf.push(plate);
      for (const yy of [-0.14, 0.14]) {
        const strap = box(0.19, 0.03, 0.008);
        strap.translate(0.1, yy, 0.011);
        leaf.push(strap);
      }
      const pull = torus(0.022, 0.006, 4, 8);
      pull.translate(0.17, 0, 0.022);
      leaf.push(pull);
      const g = merge(leaf.map((q) => paint(q, {})));
      g.rotateY(-0.5); // ajar
      g.translate(-0.105, ya + hgt / 2, zf + 0.012);
      b.add(lean(paint(g, ironSpec(0.85, 7, 16))));
    }

    // what has been left at its foot
    {
      const sk = skull(0.2, { seed: 4, jaw: false });
      const cl = sk.attributes.color;
      for (let i = 0; i < cl.count; i++) cl.setXYZ(i, cl.getX(i) * 0.5, cl.getY(i) * 0.47, cl.getZ(i) * 0.38);
      sk.rotateZ(0.28);
      sk.rotateY(0.9);
      sk.translate(0.42, 0.6, 0.58);
      b.add(sk);
      // fallen fragments: the head stone of the broken opening and what it took with it
      const nzF = new Noise(5);
      const frags = [
        [0.2, [1.5, 0.55, 1.0], [-0.98, 0.2, 0.5], 0.6, 0.3],
        [0.12, [1.2, 0.6, 0.9], [-0.66, 0.4, 0.66], 2.1, 0.25],
        [0.24, [1.3, 0.6, 1.0], [-1.55, 0, 0.95], 1.2, 0.45],
        [0.13, [1, 0.7, 1.2], [0.25, 0.2, -1.12], 0.3, 0.3],
        [0.17, [1.4, 0.5, 0.9], [1.5, 0, -0.9], 2.6, 0.45],
        [0.09, [1, 0.8, 1], [-1.2, 0, 1.45], 0.2, 0.4],
      ];
      frags.forEach(([r, sq, t, ry, sink], i) => {
        const g = rock(r, { seed: 70 + i, detail: 1, rough: 0.28, squash: sq, facet: true, sink });
        g.rotateY(ry);
        g.translate(t[0], t[1], t[2]);
        stone.face(R, t[0] * 4, t[1] + 0.3, t[2] * 4, _cm, _ce);
        const cc = _cm.clone(),
          cd = _ce.clone();
        b.add(paint(g, { color: (v) => _t.copy(cc).lerp(cd, 0.5 + 0.5 * nzF.fbm3(v.x * 9, v.y * 9, v.z * 9, 2)), rough: 0.97, mat: MAT.STONE }));
      });
    }

    // a dead creeper up the north side
    {
      const stems = [];
      const ap = (yy) => (yy < 0.2 ? 1.27 : yy < 0.4 ? 1.01 : yy < 0.6 ? 0.77 : yy < 1.0 ? 0.545 : rS(Math.min(Y1, yy)) * Math.cos(Math.PI / N) + 0.005);
      const R2 = new Rng(77);
      for (const [x0, top, r0] of [
        [-0.1, 3.3, 0.02],
        [0.13, 2.2, 0.015],
      ]) {
        const pts = [[x0 * 2.2, 0, -1.34]];
        let x = x0;
        for (const yy of [0.2, 0.21, 0.4, 0.41, 0.6, 0.62, 1.0]) {
          const onTop = Math.round(yy * 100) % 20 !== 0;
          pts.push([x * (onTop ? 1.3 : 1.5), yy, -(onTop ? ap(yy + 0.05) + 0.02 : ap(yy - 0.05) + 0.015)]);
        }
        for (let yy = 1.25; yy < top; yy += 0.3) {
          x += R2.range(-0.07, 0.07);
          x = Math.max(-0.13, Math.min(0.13, x));
          pts.push([x, yy, -ap(yy) - 0.012]);
        }
        stems.push(tube(pts, (t) => r0 * (1 - 0.75 * t), 4, { samples: pts.length * 2 }));
        // dry side shoots
        for (let k = 0; k < 4; k++) {
          const q = pts[8 + k * 2] || pts[pts.length - 2];
          const sgn = k % 2 ? 1 : -1;
          stems.push(
            tube(
              [
                [q[0], q[1], q[2]],
                [q[0] + sgn * 0.09, q[1] + 0.12, q[2] + 0.004],
                [q[0] + sgn * 0.13, q[1] + 0.3, q[2] + 0.012],
              ],
              (t) => r0 * 0.45 * (1 - 0.7 * t),
              3,
              { samples: 4 }
            )
          );
        }
      }
      const g = merge(stems.map((q) => paint(q, {})));
      b.add(lean(paint(g, woodSpec(PAL.barkPale || PAL.bark, 3, { worn: 0.6 }))));
    }

    // a crack running up from the door
    {
      const zc = (yy) => rS(yy) * Math.cos(Math.PI / N) + 0.0015;
      const path = [
        [0.03, 0],
        [0.055, 0.16],
        [0.02, 0.3],
        [0.05, 0.5],
        [0.012, 0.66],
        [0.04, 0.9],
        [0.0, 1.05],
      ];
      const g = strokes([path, [path[3], [0.11, 0.6], [0.1, 0.74]]], 0.012, 0.004);
      g.rotateX(-0.0235);
      g.translate(0, 1.84, zc(1.84));
      b.add(lean(paint(g, { color: '#0d0c0c', rough: 1, mat: MAT.STONE })));
    }

    b.cylCollider(0, 0.1, 0, 1.3, 0.2);
    b.cylCollider(0, 0.3, 0, 1.03, 0.2);
    b.cylCollider(0, 0.5, 0, 0.78, 0.2);
    b.cylCollider(0.045, 3.1, -0.027, 0.5, 5.0);
    b.anchor('flame', (4.4 - Y_LEAN) * KX, 4.4, (4.4 - Y_LEAN) * KZ);
    b.anchor('base', 0, 0, 1.6);
    return b.build();
  },
  { kind: 'structure', variants: 1 }
);
