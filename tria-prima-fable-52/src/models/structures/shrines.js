// The three shrines of the Primes: Salt on a dead tree, Mercury under a stone lid, Sulfur caged on basalt.
import { Builder, Rng, Noise, MAT, PAL, TAU, THREE, paint, box, lathe, tube, rock, merge } from '../kit.js';
import { register } from '../registry.js';
import { Mesher } from './_shared.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (t) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};
const DEG = Math.PI / 180;
const angDiff = (a, b) => {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};
const mix3 = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
const _c = new THREE.Color(),
  _k = new THREE.Color();
const WHITE = new THREE.Color(1, 1, 1);

// =============================================================================================
// Salt: the shell of a colossal dead tree, crusted white. Its broken top is the ledge the Prime
// rests on; a stone-hard bracket fungus on the south side is where a climber steps off.
// Angles run from +Z (south, the front) toward +X.
// =============================================================================================
register(
  'shrine_salt',
  () => {
    const b = new Builder();
    const R = new Rng(4111);
    const nz = new Noise(617);
    const TOP = 7.3,
      SOUTH = 2.45, // the south face stands plumb at this z, so a vine can hang straight
      AC = 300 * DEG; // where the trunk has split open
    const rb = (y) => 2.1 + 0.35 * Math.exp(-Math.max(0, y) / 1.3) + 0.12 * smooth((y - 6.2) / 1.1) - 0.09 * Math.max(0, y - TOP);
    const cz = (y) => SOUTH - rb(clamp(y, 0, TOP));
    const ROOTS = [
      [55, 0.85, 0.2],
      [115, 1.0, 0.24],
      [170, 0.75, 0.2],
      [225, 0.95, 0.25],
      [266, 0.8, 0.17],
      [332, 0.85, 0.18],
    ];
    const rootBump = (a, y) => {
      let s = 0;
      const yy = Math.max(0, y);
      for (const [deg, k, w] of ROOTS) {
        const d = angDiff(a, deg * DEG) / w;
        s += k * Math.exp(-d * d) * Math.exp(-yy / (0.7 + 0.35 * k));
      }
      return s;
    };
    const twist = (a, y) => a + 0.075 * y;
    const ridge = (a, y) => Math.sin(twist(a, y) * 11) * 0.75 + nz.n2(twist(a, y) * 7, y * 0.25) * 0.5;
    const CLEFT_H = 5.4;
    const cleftW = (y) => (y < CLEFT_H ? 0.33 * Math.pow(1 - Math.max(0, y) / CLEFT_H, 0.7) * (0.82 + 0.36 * nz.n2(y * 1.1, 4.4)) : 0);
    // a slot through the shell: steep sides, the dark behind them
    const cleft = (a, y) => {
      const w = cleftW(y);
      if (w <= 0) return 0;
      const d = Math.abs(angDiff(a, AC)) / w;
      return d < 1 ? smooth((1 - d) / 0.16) : 0;
    };
    const rAt = (a, y) => {
      const cl = cleft(a, y);
      const flute = 0.11 * Math.sin(a * 5 + 1.2) * Math.exp(-Math.max(0, y) / 4.5);
      return rb(Math.max(0, y)) + rootBump(a, y) + flute + 0.13 * ridge(a, y) * (1 - 0.7 * cl) + 0.22 * nz.fbm3(Math.sin(a) * 1.3, y * 0.33, Math.cos(a) * 1.3, 3) - 1.7 * cl;
    };
    const P = (a, y, dr = 0) => {
      const r = rAt(a, y) + dr;
      return [Math.sin(a) * r, y, cz(y) + Math.cos(a) * r];
    };

    // columns: even all round, finer across the split
    const cols = [];
    const NA = 72;
    for (let j = 0; j < NA; j++) {
      const a = (j / NA) * TAU;
      if (Math.abs(angDiff(a, AC)) > 0.43) cols.push(a);
    }
    for (let k = -10; k <= 10; k++) cols.push(AC + k * 0.04);
    cols.sort((p, q) => p - q);
    const NC = cols.length;
    const ys = [-1.0, 0, 0.22, 0.5, 0.85, 1.25, 1.7, 2.2, 2.75, 3.3, 3.85, 4.4, 4.9, 5.4, 5.9, 6.4, 6.9, TOP];

    const grid = (rows) => {
      const pos = [],
        idx = [];
      const n = rows.length;
      for (let i = 0; i < n; i++) for (let j = 0; j < NC; j++) pos.push(...rows[i](cols[j], j));
      for (let i = 0; i < n - 1; i++)
        for (let j = 0; j < NC; j++) {
          const a = i * NC + j,
            q = i * NC + ((j + 1) % NC),
            c = (i + 1) * NC + ((j + 1) % NC),
            d = (i + 1) * NC + j;
          idx.push(a, q, c, a, c, d);
        }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };

    // bark and salt
    const cBark = new THREE.Color('#4a443d'),
      cBarkD = new THREE.Color('#231f1b'),
      cPale = new THREE.Color('#7d756a'),
      cSalt = new THREE.Color(PAL.salt),
      cSaltD = new THREE.Color('#b3a7a1'),
      cHollow = new THREE.Color('#060505'),
      cHeart = new THREE.Color('#85796a');
    const saltAt = (v, a, up) => {
      const low = smooth(1 - v.y / 2.6);
      const high = 0.6 * smooth((v.y - (TOP - 3)) / 3.0);
      const n = nz.fbm3(v.x * 0.8 + 9, v.y * 0.3, v.z * 0.8 - 4, 3);
      const st = nz.fbm2(twist(a, v.y) * 4.5 + 30, v.y * 0.1 + 7, 2);
      return smooth((low * 0.95 + high + up * 1.3 + n * 0.55 + st * 0.55 + Math.max(0, ridge(a, v.y)) * 0.3 - 0.24) / 0.4);
    };
    const barkSpec = {
      color: (v) => {
        const rx = v.x,
          rz = v.z - cz(v.y);
        const a = Math.atan2(rx, rz);
        const rl = Math.hypot(rx, rz) || 1;
        const outward = (v.nx * rx + v.nz * rz) / rl;
        const g = ridge(a, v.y);
        const m = nz.fbm3(v.x * 2.1, v.y * 0.6, v.z * 2.1, 2);
        _c.copy(cBark)
          .lerp(cBarkD, clamp(0.45 - g * 0.5 + m * 0.3, 0, 1))
          .lerp(cPale, clamp(g * 0.45 + m * 0.4, 0, 0.6));
        if (outward < -0.25) _c.copy(cHeart).multiplyScalar(0.62 + 0.3 * m);
        const s = saltAt(v, a, Math.max(0, v.ny));
        _c.lerp(_k.copy(cSalt).lerp(cSaltD, clamp(0.5 + m, 0, 1) * 0.7), s * 0.95);
        // the split: pale torn lips, black inside
        const w = cleftW(v.y);
        if (w > 0) {
          const dN = Math.abs(angDiff(a, AC)) / w;
          const lip = smooth((1.3 - dN) / 0.28);
          if (lip > 0) _c.lerp(_k.copy(cHeart).multiplyScalar(0.9 + 0.3 * m), lip * 0.9);
          const cl = cleft(a, v.y);
          if (cl > 0) _c.lerp(cHollow, clamp(cl * 1.5, 0, 0.98));
        }
        return _c;
      },
      rough: 0.92,
      metal: 0,
      mat: MAT.WOOD,
    };

    b.add(paint(grid(ys.map((y) => (a) => P(a, y))), barkSpec));

    // the break: a floor of torn heartwood under drifted salt
    {
      const cTop = [0, TOP, cz(TOP)];
      const fr = [0.0, 0.3, 0.6, 0.85, 1];
      const g = grid(
        fr
          .slice()
          .reverse()
          .map((f) => (a) => {
            const p = mix3(cTop, P(a, TOP), f);
            if (f < 1) p[1] += nz.n2(p[0] * 2.3, p[2] * 2.3) * 0.03 * (1 - f) + 0.05 * (1 - f);
            return p;
          })
      );
      paint(g, {
        color: (v) => {
          const rx = v.x,
            rz = v.z - cTop[2];
          const rr = Math.hypot(rx, rz);
          const n = nz.fbm2(rx * 0.9 + 3, rz * 0.9, 3);
          _c.copy(cHeart).multiplyScalar(0.5 + 0.3 * (0.5 + 0.5 * Math.sin(rr * 15 + n * 4)));
          const s = smooth((n + 0.22 + (rr > 1.7 ? 0.35 : 0) + (rr < 0.7 ? 0.3 : 0)) / 0.3);
          return _c.lerp(_k.copy(cSalt).lerp(cSaltD, clamp(0.5 - n, 0, 1) * 0.6), s * 0.95);
        },
        rough: 0.9,
        metal: 0,
        // (stone, not wood: the wood shader draws its growth rings from noise, and on a cut face this
        //  wide they read as worm-tracks; the rings here are painted, round the heart)
        mat: MAT.STONE,
      });
      b.add(g);
    }

    // the crown: on the north the shell still stands as a tall sliver, torn ragged along its edge
    const HC = 202 * DEG,
      HW = 1.5;
    {
      const MS = new Mesher();
      const hCol = cols.map((a) => {
        const d = Math.abs(angDiff(a, HC)) / HW;
        if (d >= 1) return 0;
        const jag = R.chance(0.16) ? R.range(0.25, 0.5) : R.range(0.6, 1);
        return Math.pow(Math.cos((d * Math.PI) / 2), 0.75) * 2.35 * jag;
      });
      const thick = (t) => 0.36 - 0.26 * t;
      for (let j = 0; j < NC; j++) {
        const j1 = (j + 1) % NC;
        const h0 = hCol[j],
          h1 = hCol[j1];
        if (h0 <= 0 && h1 <= 0) continue;
        const a0 = cols[j],
          a1 = cols[j1],
          am = a0 + angDiff(a1, a0) / 2;
        const out = [Math.sin(am), 0, Math.cos(am)],
          inn = [-out[0], 0, -out[2]];
        const lv = [0, 0.5, 1];
        for (let k = 0; k < 2; k++) {
          const ya0 = TOP + h0 * lv[k],
            ya1 = TOP + h1 * lv[k],
            yb0 = TOP + h0 * lv[k + 1],
            yb1 = TOP + h1 * lv[k + 1];
          MS.face(P(a0, ya0), P(a1, ya1), P(a1, yb1), P(a0, yb0), out, WHITE);
          MS.face(P(a0, ya0, -thick(lv[k])), P(a1, ya1, -thick(lv[k])), P(a1, yb1, -thick(lv[k + 1])), P(a0, yb0, -thick(lv[k + 1])), inn, WHITE);
        }
        MS.face(P(a0, TOP + h0), P(a1, TOP + h1), P(a1, TOP + h1, -thick(1)), P(a0, TOP + h0, -thick(1)), [0, 1, 0], WHITE);
      }
      // low splinters round the rest of the rim, none where the climber comes up
      const GAP = 0.85;
      const ring = [];
      for (let j = 0; j < NC; j++) if (Math.abs(angDiff(cols[j], 0)) > GAP && hCol[j] <= 0) ring.push(j);
      let q = 0;
      while (q < ring.length - 1) {
        const wdt = Math.min(ring.length - 1 - q, R.int(1, 3));
        const ks = ring.slice(q, q + wdt + 1);
        q += wdt;
        if (ks[ks.length - 1] - ks[0] !== wdt || R.chance(0.3)) continue;
        const aMid = (cols[ks[0]] + cols[ks[ks.length - 1]]) / 2;
        const h = R.range(0.12, 0.5);
        const outer = ks.map((k) => P(cols[k], TOP));
        const inner = ks.map((k) => P(cols[k], TOP, -0.3));
        const m = mix3(outer[0], outer[outer.length - 1], R.range(0.25, 0.75));
        const ln = R.range(-0.08, 0.2);
        const apex = [m[0] - Math.sin(aMid) * ln, TOP + h, m[2] - Math.cos(aMid) * ln];
        const out = [Math.sin(aMid), 0.2, Math.cos(aMid)],
          inn = [-Math.sin(aMid), 0.2, -Math.cos(aMid)],
          tan = [Math.cos(aMid), 0, -Math.sin(aMid)];
        for (let k = 0; k < wdt; k++) {
          MS.tri(outer[k], outer[k + 1], apex, out, WHITE);
          MS.tri(inner[k + 1], inner[k], apex, inn, WHITE);
        }
        MS.tri(inner[0], outer[0], apex, [-tan[0], 0, -tan[2]], WHITE);
        MS.tri(outer[wdt], inner[wdt], apex, tan, WHITE);
      }
      // long thin splinters standing off the sliver
      for (let i = 0; i < 12; i++) {
        const a = HC + R.range(-1.35, 1.35);
        const env = Math.cos(((Math.abs(angDiff(a, HC)) / HW) * Math.PI) / 2);
        const y0 = TOP + env * R.range(0.5, 1.9);
        const h = R.range(0.5, 1.3);
        const base = P(a, y0, -R.range(0.05, 0.2));
        const w = R.range(0.05, 0.11);
        const tan = [Math.cos(a), 0, -Math.sin(a)],
          rad = [Math.sin(a), 0, Math.cos(a)];
        const p0 = [base[0] - tan[0] * w, y0 - 0.3, base[2] - tan[2] * w],
          p1 = [base[0] + tan[0] * w, y0 - 0.3, base[2] + tan[2] * w],
          p2 = [base[0] - rad[0] * w * 1.4, y0 - 0.3, base[2] - rad[2] * w * 1.4];
        const ap = [base[0] + R.range(-0.14, 0.14), y0 + h, base[2] + R.range(-0.14, 0.14)];
        MS.tri(p0, p1, ap, rad, WHITE);
        MS.tri(p1, p2, ap, [tan[0] - rad[0], 0, tan[2] - rad[2]], WHITE);
        MS.tri(p2, p0, ap, [-tan[0] - rad[0], 0, -tan[2] - rad[2]], WHITE);
      }
      b.add(paint(MS.build({ rough: 0.92, mat: MAT.WOOD }), barkSpec));
    }

    // dead limbs and the roots that still grip the ground
    {
      const limbs = [];
      const cone = (tip, dir, r, len) => {
        const g = new THREE.ConeGeometry(r, len, 5);
        g.translate(0, len / 2, 0);
        const qn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dir[0], dir[1], dir[2]).normalize());
        g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(tip[0], tip[1], tip[2]), qn, new THREE.Vector3(1, 1, 1)));
        limbs.push(g);
      };
      const limb = (aDeg, y0, len, r0, rise, bend) => {
        const a = aDeg * DEG;
        const dir = [Math.sin(a), 0, Math.cos(a)],
          tan = [Math.cos(a), 0, -Math.sin(a)];
        const base = P(a, y0, -0.7);
        const pts = [];
        const NP = 6;
        for (let k = 0; k <= NP; k++) {
          const t = k / NP,
            d = t * (len + 0.7);
          const wob = k > 1 ? R.range(-0.09, 0.09) * len : 0;
          pts.push([base[0] + dir[0] * d + tan[0] * (bend * t * t + wob), base[1] + rise * len * t * (0.3 + 0.7 * t) + (k > 1 ? R.range(-0.05, 0.05) * len : 0), base[2] + dir[2] * d + tan[2] * (bend * t * t + wob)]);
        }
        const rEnd = r0 * 0.42;
        limbs.push(tube(pts, (t) => r0 * (1 - 0.58 * t) * (1 + 0.6 * Math.max(0, 0.2 - t)), 7, { samples: 12 }));
        // the torn end
        const e0 = pts[NP],
          e1 = pts[NP - 1];
        const dv = [e0[0] - e1[0], e0[1] - e1[1], e0[2] - e1[2]];
        for (let k = 0; k < 4; k++) {
          const o = [R.range(-0.6, 0.6) * rEnd, R.range(-0.6, 0.6) * rEnd, R.range(-0.6, 0.6) * rEnd];
          cone([e0[0] + o[0] - dv[0] * 0.3, e0[1] + o[1] - dv[1] * 0.3, e0[2] + o[2] - dv[2] * 0.3], [dv[0] + o[0] * 0.5, dv[1] + o[1] * 0.5, dv[2] + o[2] * 0.5], rEnd * R.range(0.22, 0.4), rEnd * R.range(1.3, 2.6));
        }
        return pts;
      };
      const twig = (s0, d, len, r) => {
        const pts = [s0, [s0[0] + d[0] * len * 0.5 + R.range(-0.1, 0.1), s0[1] + d[1] * len * 0.5, s0[2] + d[2] * len * 0.5 + R.range(-0.1, 0.1)], [s0[0] + d[0] * len, s0[1] + d[1] * len + 0.1, s0[2] + d[2] * len]];
        limbs.push(tube(pts, (t) => r * (1 - 0.7 * t), 5, { samples: 5 }));
      };
      const a1 = limb(236, 5.9, 3.2, 0.5, 0.42, 0.9);
      twig(a1[4], [-0.45, 0.85, -0.2], 1.5, 0.2);
      twig(a1[5], [-0.2, 0.3, 0.9], 0.9, 0.12);
      const a2 = limb(128, 4.9, 2.4, 0.42, 0.3, -0.6);
      twig(a2[4], [0.3, 0.9, 0.1], 1.1, 0.15);
      limb(82, 3.4, 1.0, 0.33, 0.15, 0.2);
      limb(20, 5.6, 0.7, 0.26, 0.2, 0.1);
      // roots
      for (const [deg, k] of ROOTS) {
        const a = deg * DEG + R.range(-0.06, 0.06);
        const dir = [Math.sin(a), 0, Math.cos(a)],
          tan = [Math.cos(a), 0, -Math.sin(a)];
        const r0 = rAt(a, 0.35) - 0.5;
        const wig = (R.chance(0.5) ? 1 : -1) * R.range(0.35, 0.8);
        const pts = [];
        for (let i = 0; i <= 5; i++) {
          const t = i / 5;
          const d = r0 + t * (1.25 + 0.45 * k);
          const sw = wig * Math.sin(t * 3.4) * (0.25 + 0.5 * t);
          pts.push([dir[0] * d + tan[0] * sw, 0.5 - 0.25 * t - 0.75 * t * t, cz(0) + dir[2] * d + tan[2] * sw]);
        }
        limbs.push(tube(pts, (t) => 0.4 * k * (1 - 0.5 * t), 7, { samples: 9 }));
      }
      const cBk = new THREE.Color('#3b352f'),
        cBkD = new THREE.Color('#1d1916');
      b.add(
        paint(merge(limbs.map((g) => paint(g, {}))), {
          color: (v) => {
            const m = nz.fbm3(v.x * 2.3, v.y * 2.3, v.z * 2.3, 2);
            _c.copy(cBk).lerp(cBkD, clamp(0.5 + m * 0.6 - v.ny * 0.35, 0, 1));
            const lowSalt = smooth(1 - v.y / 1.2);
            const s = smooth((v.ny + 0.05 + lowSalt * 0.3) / 0.5) * smooth((m + 0.5 + lowSalt * 0.4) / 0.35);
            return _c.lerp(_k.copy(cSalt).lerp(cSaltD, clamp(0.5 + m, 0, 1) * 0.7), s * 0.95);
          },
          rough: 0.92,
          metal: 0,
          mat: MAT.WOOD,
        })
      );
    }

    // bracket fungi turned to stone; the great one at the top is the ledge
    {
      const fungi = [];
      const bracket = (aDeg, y, s, T = 0.42 * s) => {
        const g = lathe(
          [
            [0.03, -T],
            [0.55 * s, -T * 0.55],
            [0.92 * s, -T * 0.12],
            [s, -0.025 * s],
            [0.97 * s, 0, 'hard'],
            [0, 0],
          ],
          10,
          { arc: Math.PI }
        );
        g.rotateY(Math.PI + aDeg * DEG);
        const p = P(aDeg * DEG, y - T * 0.5, -0.12);
        g.translate(p[0], y, p[2]);
        fungi.push(g);
      };
      bracket(0, TOP, 1.02, 0.5);
      bracket(27, 6.1, 0.42);
      bracket(338, 4.9, 0.5);
      bracket(349, 4.45, 0.3);
      bracket(62, 3.9, 0.55);
      bracket(150, 5.6, 0.6);
      bracket(205, 3.1, 0.5);
      bracket(255, 4.4, 0.45);
      bracket(40, 2.3, 0.36);
      bracket(172, 6.6, 0.4);
      const cF = new THREE.Color('#6a5f52'),
        cFd = new THREE.Color('#2b241e');
      const g = merge(fungi.map((q) => paint(q, {})));
      paint(g, {
        color: (v) => {
          const n = nz.fbm3(v.x * 3, v.y * 3, v.z * 3, 2);
          const rx = v.x,
            rz = v.z - cz(v.y);
          const band = 0.5 + 0.5 * Math.sin(Math.hypot(rx, rz) * 22);
          if (v.ny < 0.3) return _c.copy(cFd).lerp(cF, clamp(0.55 + n * 0.5 + v.ny * 0.5, 0, 1)).lerp(cSalt, smooth((n - 0.05) / 0.3) * 0.6);
          _c.copy(cF).multiplyScalar(0.7 + 0.35 * band);
          return _c.lerp(cSalt, smooth((n + 0.35) / 0.4) * 0.92);
        },
        rough: 0.85,
        metal: 0,
        mat: MAT.STONE,
      });
      b.add(g);
    }

    // salt: cubes grown in clusters, crust heaped at the foot, icicles under everything that overhangs
    {
      const cubes = [];
      const cube = (x, y, z, s) => {
        const g = box(s, s * R.range(0.8, 1.25), s * R.range(0.8, 1.2));
        g.rotateX(R.range(-0.5, 0.5));
        g.rotateY(R.range(0, TAU));
        g.rotateZ(R.range(-0.5, 0.5));
        g.translate(x, y + s * 0.22, z);
        cubes.push(g);
      };
      const cluster = (x, y, z, n, s, spread) => {
        for (let i = 0; i < n; i++) cube(x + R.range(-spread, spread), y, z + R.range(-spread, spread), s * R.range(0.45, 1.2));
      };
      // at the foot, between the roots
      for (const [deg, d, n, s] of [
        [20, 0.35, 5, 0.3],
        [-28, 0.3, 4, 0.24],
        [88, 0.5, 5, 0.34],
        [142, 0.45, 4, 0.3],
        [198, 0.4, 5, 0.36],
        [245, 0.55, 4, 0.28],
        [304, 0.9, 5, 0.3],
      ]) {
        const p = P(deg * DEG, 0, d);
        cluster(p[0], 0, p[2], n, s, 0.3);
      }
      // the nest the Prime lies in
      const nest = [0, TOP + 0.03, cz(TOP) - 0.25];
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * TAU + R.range(-0.2, 0.2);
        cube(nest[0] + Math.sin(a) * 0.42, nest[1], nest[2] + Math.cos(a) * 0.42, R.range(0.12, 0.26));
      }
      cluster(-1.3, TOP + 0.02, cz(TOP) - 0.9, 4, 0.2, 0.25);
      cluster(1.25, TOP + 0.02, cz(TOP) + 0.3, 3, 0.16, 0.2);
      const cg = merge(cubes.map((q) => paint(q, {})));
      const cA = new THREE.Color(PAL.salt),
        cB = new THREE.Color('#c9bcc4');
      paint(cg, { color: (v) => _c.copy(cA).lerp(cB, clamp(0.5 + nz.n3(v.x * 4, v.y * 4, v.z * 4), 0, 1)), rough: 0.3, metal: 0, mat: MAT.CRYSTAL });
      b.add(cg);

      const crust = [];
      for (const [deg, d, r] of [
        [8, 0.15, 0.75],
        [70, 0.25, 0.9],
        [130, 0.6, 0.8],
        [185, 0.3, 1.0],
        [240, 0.7, 0.85],
        [292, -0.5, 1.0],
        [338, 0.3, 0.8],
      ]) {
        const p = P(deg * DEG, 0, d);
        const g = rock(r * R.range(0.6, 1.15), { seed: 300 + deg, detail: 2, rough: 0.34, freq: 2.2, squash: [R.range(1.1, 1.6), R.range(0.16, 0.3), R.range(0.9, 1.3)], sink: 0.4 });
        g.rotateY(deg * DEG + 0.5);
        g.translate(p[0], -0.04, p[2]);
        crust.push(g);
      }
      // icicles
      const drip = (x, y, z, h) => {
        const g = new THREE.ConeGeometry(0.035 + h * 0.07, h, 5);
        g.rotateX(Math.PI);
        g.translate(x, y - h / 2, z);
        crust.push(g);
      };
      for (const [a, d, h] of [
        [0.95, 0.9, 0.95],
        [1.15, 0.8, 0.5],
        [0.7, 0.95, 0.3],
        [-1.2, 0.85, 0.4],
        [-0.3, 0.97, 0.16],
      ])
        drip(Math.sin(a) * d, TOP - 0.06 - (1 - d) * 0.35, SOUTH - 0.1 + Math.cos(a) * d, h);
      // salt grown inside the split
      {
        const p = P(AC, 0, 0.35);
        for (let i = 0; i < 6; i++) cube(p[0] + R.range(-0.4, 0.4), R.range(0, 0.2), p[2] + R.range(-0.4, 0.4), R.range(0.16, 0.36));
      }
      const cs = merge(crust.map((q) => paint(q, {})));
      const cGround = new THREE.Color('#6f6861');
      paint(cs, {
        color: (v) =>
          _c
            .copy(cSalt)
            .lerp(cSaltD, clamp(0.4 + nz.fbm3(v.x * 2, v.y * 2, v.z * 2, 2), 0, 1) * 0.8)
            .lerp(cGround, v.y < 0.4 ? clamp(1 - v.y / 0.1, 0, 0.85) : 0),
        rough: 0.7,
        metal: 0,
        mat: MAT.STONE,
      });
      b.add(cs);
    }

    // colliders: the trunk (its flat top is the ledge), the root flare, the fungus step, the standing sliver
    const zc = cz(TOP);
    b.cylCollider(0, (TOP - 1) / 2, zc, 2.2, TOP + 1);
    b.cylCollider(0, 0.6, -0.1, 2.6, 1.2);
    b.boxCollider(0, TOP - 0.2, SOUTH + 0.4, 0.6, 0.2, 0.44);
    for (const deg of [128, 165, 202, 239, 276]) {
      const a = deg * DEG;
      b.boxCollider(Math.sin(a) * 2.0, TOP + 0.6, zc + Math.cos(a) * 2.0, 0.75, 0.6, 0.16, a);
    }
    b.anchor('prime', 0, TOP + 0.4, zc - 0.25);
    b.anchor('ledge', 0, TOP, SOUTH + 0.5);
    b.anchor('vine', 0, 0, SOUTH + 0.5);
    return b.build();
  },
  { kind: 'structure', variants: 1, topY: 7.3, topRadius: 2.2 }
);
