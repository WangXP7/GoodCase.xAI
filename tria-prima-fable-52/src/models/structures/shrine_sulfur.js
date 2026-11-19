// Sulfur: a dais of black basalt columns, two steps, a stone bowl on a stack of columns caged in iron.
// Behind it the columns rise into a broken wall. Angles run from +Z (the front) toward +X. Owner: MODELS-B.
import { Builder, Rng, Noise, MAT, PAL, TAU, THREE, paint, box, lathe, tube, crystal, rock, merge } from '../kit.js';
import { register } from '../registry.js';
import { Mesher, ironSpec, hoop, rivets, glyph, hewn, skull } from './_shared.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (t) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};
const angDiff = (a, b) => {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};
const _c = new THREE.Color(),
  _e = new THREE.Color();
const UP = [0, 1, 0];

const S = 0.26; // circumradius of one column
const SQ3 = Math.sqrt(3);
const STEP1 = 0.25,
  STEP2 = 0.5; // tops of the two steps
const R1 = 2.5,
  R2 = 1.72;
const PED = 1.0; // top of the middle column, where the bowl stands
const DEEP = -0.7;
const CAGE = { radius: 0.84, baseY: STEP2, topY: 2.34, sink: 1.95 };
const BR = 2.12; // the braziers stand this far out
const BRAZ = [0, -120, 120].map((deg) => [Math.sin(deg * DEG) * BR, Math.cos(deg * DEG) * BR]);
// where the fumes come up: [x, z, y]
const VENTS = [
  [Math.sin(168 * DEG) * 1.82, Math.cos(168 * DEG) * 1.82, STEP2],
  [Math.sin(203 * DEG) * 1.9, Math.cos(203 * DEG) * 1.9, STEP1],
  [Math.sin(-38 * DEG) * 0.95, Math.cos(-38 * DEG) * 0.95, STEP2],
];

register(
  'shrine_sulfur',
  () => {
    const b = new Builder();
    const R = new Rng(5151);
    const nz = new Noise(303);

    const cBas = new THREE.Color('#26262b'),
      cSlate = new THREE.Color(PAL.slate),
      cBrown = new THREE.Color('#3b2b21'),
      cSulf = new THREE.Color(PAL.sulfur).lerp(new THREE.Color('#b7ab7a'), 0.4).multiplyScalar(0.8),
      cPale = new THREE.Color('#bdb283'),
      cSoot = new THREE.Color(PAL.soot);
    const sulfurAt = (x, y, z) => {
      let s = 0.7 * Math.exp(-Math.hypot(x, z) / 0.8) * Math.exp(-Math.max(0, y - 1.5) / 0.6);
      for (const v of VENTS) s += 0.95 * Math.exp(-Math.hypot(x - v[0], z - v[1]) / 0.42) * Math.exp(-Math.max(0, y - v[2]) / 1.1);
      return s;
    };
    // `edge` is the colour of a joint: darker, and the first place the yellow crust settles
    const basalt = (out, x, y, z, tone, up, edge = false) => {
      out.copy(cBas).multiplyScalar(tone);
      if (up) out.lerp(cSlate, 0.22);
      const w = nz.fbm3(x * 0.9 + 3, y * 0.5, z * 0.9, 3);
      if (w > 0.12) out.lerp(cBrown, Math.min(0.55, (w - 0.12) * 1.3));
      if (edge) out.multiplyScalar(0.4);
      const s = sulfurAt(x, y, z) + 0.45 * nz.fbm3(x * 1.7 + 9, y * 1.1, z * 1.7 - 4, 3) - (edge ? 0.26 : 0.6);
      if (s > 0) out.lerp(edge && s > 0.5 ? cPale : cSulf, Math.min(edge ? 0.85 : 0.3, s * 1.5));
      for (const p of BRAZ) {
        const dd = Math.hypot(x - p[0], z - p[1]);
        if (dd < 0.8 && y < 0.6) out.lerp(cSoot, 0.75 * (1 - dd / 0.8));
      }
      return out;
    };

    // ------------------------------------------------------------------------------------------
    // The columns: a honeycomb whose corners have wandered, every cell a prism of its own height
    // ------------------------------------------------------------------------------------------
    const key = (q, r) => q + ',' + r;
    const cells = new Map();
    for (let r = -13; r <= 13; r++)
      for (let q = -16; q <= 16; q++) {
        const x = S * SQ3 * (q + r / 2),
          z = S * 1.5 * r;
        const d = Math.hypot(x, z);
        if (d > 2.92) continue;
        const ang = Math.atan2(x, z);
        const north = Math.abs(angDiff(ang, Math.PI)) / DEG;
        let nb = 9;
        for (const p of BRAZ) nb = Math.min(nb, Math.hypot(x - p[0], z - p[1]));
        const Rc = new Rng(7000 + (q + 20) * 131 + (r + 20) * 17);
        let h,
          slope = Rc.range(0, 0.035),
          kind = 'floor';
        if (d < 0.01) {
          h = PED;
          kind = 'ped';
          slope = 0;
        } else if (d < 0.5) {
          // the six round the middle one climb like a stair
          h = 0.6 + 0.3 * (((ang + Math.PI * 1.3) % TAU) / TAU) + Rc.range(-0.02, 0.02);
          kind = 'ped';
          slope = Rc.range(0.04, 0.14);
        } else if (d < R2) h = STEP2 + Rc.range(-0.03, 0.012);
        else if (d < R1) h = STEP1 + Rc.range(-0.03, 0.012);
        else if (north < 46 || Rc.chance(0.4)) {
          h = Rc.range(0.04, 0.2);
          kind = 'stub';
          slope = Rc.range(0.05, 0.25);
        } else continue;
        if (nb < 0.55) {
          h = STEP1;
          slope = 0;
        } else if (d > 2.25 && d < R1 && north > 50 && Rc.chance(0.2)) {
          h = Rc.range(0.07, 0.16);
          kind = 'stub';
          slope = Rc.range(0.05, 0.25);
        }
        if (north < 44 && d > 1.96 && nb > 0.62) {
          const w = 1 - Math.pow(north / 44, 1.6);
          const outer = smooth((d - 1.96) / 0.5);
          h = 0.5 + (0.45 + 2.6 * w) * (0.4 + 0.6 * outer) * Rc.range(0.7, 1.05);
          slope = Rc.range(0.15, 0.62);
          kind = 'wall';
        }
        const ta = Rc.range(0, TAU);
        const joints = [];
        for (let y = 0.3 + Rc.range(0, 0.6); y < h - 0.3; y += Rc.range(0.5, 1.3)) joints.push(y);
        cells.set(key(q, r), { q, r, x, z, d, h, kind, sx: Math.cos(ta) * slope, sz: Math.sin(ta) * slope, tone: Rc.range(0.8, 1.25), joints, Rc, pc: [], hc: [] });
      }
    const J = 0.085;
    for (const c of cells.values())
      for (let k = 0; k < 6; k++) {
        const a = (30 + 60 * k) * DEG;
        const cx = c.x + S * Math.cos(a),
          cz = c.z + S * Math.sin(a);
        const p = [cx + nz.n2(cx * 2.7 + 11.3, cz * 2.7 - 3.1) * J, cz + nz.n2(cx * 2.7 - 7.9, cz * 2.7 + 5.3) * J];
        c.pc.push(p);
        c.hc.push(c.h + (p[0] - c.x) * c.sx + (p[1] - c.z) * c.sz);
      }
    const W = (x, y, z) => {
      const u = y - 0.55;
      if (u <= 0) return [x, y, z];
      const d = Math.hypot(x, z) || 1;
      const push = 0.05 * Math.pow(u, 1.4),
        sway = 0.04 * u * nz.n2(x * 0.7 + 3, z * 0.7);
      return [x + (x / d) * push + (z / d) * sway, y, z + (z / d) * push - (x / d) * sway];
    };
    const heightAt = (n, p) => {
      let best = 0,
        bd = 1e9;
      for (let k = 0; k < 6; k++) {
        const dd = Math.hypot(n.pc[k][0] - p[0], n.pc[k][1] - p[1]);
        if (dd < bd) {
          bd = dd;
          best = k;
        }
      }
      return n.hc[best];
    };
    {
      const M = new Mesher();
      for (const c of cells.values()) {
        const wall = c.kind === 'wall';
        // the top
        basalt(_c, c.x, c.h, c.z, c.tone * (wall ? 1.1 : 1), true);
        basalt(_e, c.x, c.h, c.z, c.tone, true, true);
        M.fan(
          c.pc.map((p, k) => W(p[0], c.hc[k], p[1])),
          UP,
          _c,
          _e,
          wall || c.kind === 'stub' ? c.Rc.range(-0.03, 0.045) : c.Rc.range(-0.012, 0.014),
          0.35
        );
        // the sides that show
        for (let k = 0; k < 6; k++) {
          const k2 = (k + 1) % 6;
          const A = c.pc[k],
            B = c.pc[k2];
          const dir = (60 + 60 * k) * DEG;
          const nx = c.x + S * SQ3 * Math.cos(dir),
            nzc = c.z + S * SQ3 * Math.sin(dir);
          const nr = Math.round(nzc / (1.5 * S));
          const n = cells.get(key(Math.round(nx / (S * SQ3) - nr / 2), nr));
          let ya = DEEP,
            yb = DEEP;
          if (n) {
            ya = heightAt(n, A);
            yb = heightAt(n, B);
            if (c.hc[k] <= ya + 0.004 && c.hc[k2] <= yb + 0.004) continue;
            ya = Math.min(ya, c.hc[k]);
            yb = Math.min(yb, c.hc[k2]);
          }
          const hint = [Math.cos(dir), 0, Math.sin(dir)];
          const lo = Math.max(ya, yb),
            hi = Math.min(c.hc[k], c.hc[k2]);
          const cuts = c.joints.filter((j) => j > lo + 0.08 && j < hi - 0.08);
          let pa = ya,
            pb = yb;
          for (let s = 0; s <= cuts.length; s++) {
            const last = s === cuts.length;
            const ta = last ? c.hc[k] : cuts[s],
              tb = last ? c.hc[k2] : cuts[s];
            const ym = (pa + pb + ta + tb) / 4;
            const tn = c.tone * (0.92 + 0.16 * c.Rc.next()) * (0.55 + 0.45 * smooth((ym + 0.2) / 0.9));
            const mx = (A[0] + B[0]) / 2,
              mz = (A[1] + B[1]) / 2;
            basalt(_c, mx, ym, mz, tn, false);
            const q = [W(A[0], pa, A[1]), W(B[0], pb, B[1]), W(B[0], tb, B[1]), W(A[0], ta, A[1])];
            if (ta - pa > 0.3 || tb - pb > 0.3) {
              basalt(_e, mx, ym, mz, tn, false, true);
              M.face(q[0], q[1], q[2], q[3], hint, _c, _e, 0.007, 0.25);
            } else M.face(q[0], q[1], q[2], q[3], hint, _c);
            pa = ta;
            pb = tb;
          }
        }
      }
      // broken lengths of column lying where they fell
      const prism = (m, len, tone) => {
        const P = [];
        for (let e = 0; e < 2; e++)
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * TAU;
            const rr = S * (0.9 + 0.12 * nz.n2(k * 3.3 + len * 7, e * 5.1));
            P.push(new THREE.Vector3(Math.cos(a) * rr, e ? len : 0, Math.sin(a) * rr).applyMatrix4(m));
          }
        const ctr = new THREE.Vector3(0, len / 2, 0).applyMatrix4(m);
        const arr = (v) => [v.x, v.y, v.z];
        for (let k = 0; k < 6; k++) {
          const k2 = (k + 1) % 6;
          const mid = P[k]
            .clone()
            .add(P[k2])
            .add(P[6 + k])
            .add(P[6 + k2])
            .multiplyScalar(0.25);
          basalt(_c, mid.x, 0.6, mid.z, tone * (0.85 + 0.3 * R.next()), false);
          _e.copy(_c).multiplyScalar(0.6);
          M.face(arr(P[k]), arr(P[k2]), arr(P[6 + k2]), arr(P[6 + k]), arr(mid.sub(ctr)), _c, _e, 0.01, 0.3);
        }
        for (let e = 0; e < 2; e++) {
          const pts = [];
          for (let k = 0; k < 6; k++) pts.push(arr(P[e * 6 + k]));
          const end = new THREE.Vector3(0, e ? len : 0, 0).applyMatrix4(m);
          basalt(_c, end.x, 0.6, end.z, tone * 1.25, true);
          _e.copy(_c).multiplyScalar(0.6);
          M.fan(pts, arr(end.clone().sub(ctr)), _c, _e, e ? 0.03 : -0.02, 0.35);
        }
      };
      const lying = [
        // [x, z, len, yaw, pitch off the horizontal, lift]
        [Math.sin(150 * DEG) * 3.25, Math.cos(150 * DEG) * 3.25, 1.15, 0.7, 0.05, 0.2],
        [Math.sin(207 * DEG) * 3.45, Math.cos(207 * DEG) * 3.45, 0.8, 2.2, -0.08, 0.2],
        [Math.sin(186 * DEG) * 3.3, Math.cos(186 * DEG) * 3.3, 0.55, 1.3, 0.5, 0.16],
        [Math.sin(118 * DEG) * 2.95, Math.cos(118 * DEG) * 2.95, 0.6, -0.4, 0.02, 0.2],
      ];
      for (const [x, z, len, yaw, pitch, lift] of lying) {
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 - pitch, yaw, 0, 'YXZ'));
        const m = new THREE.Matrix4().compose(new THREE.Vector3(x, lift, z), q, new THREE.Vector3(1, 1, 1));
        m.multiply(new THREE.Matrix4().makeTranslation(0, -len / 2, 0));
        prism(m, len, R.range(0.85, 1.15));
      }
      b.add(M.build({ rough: 0.9, mat: MAT.STONE }));
    }

    // ------------------------------------------------------------------------------------------
    // Sulfur: crust and needles where the fumes come up
    // ------------------------------------------------------------------------------------------
    {
      const needles = [],
        crust = [];
      const cluster = (x, y, z, n, size) => {
        const m = rock(size * 1.5, { seed: Math.round(x * 91 + z * 37) + 500, detail: 1, rough: 0.3, freq: 2, squash: [1, 0.3, 1], facet: false, sink: 0.5 });
        m.translate(x, y + size * 0.1, z);
        crust.push(m);
        for (let i = 0; i < n; i++) {
          const hgt = size * R.range(0.6, 1.7);
          const g = crystal(hgt * R.range(0.1, 0.17), hgt, { sides: 5, tip: R.range(0.3, 0.6), foot: 0.7, irregular: 0.25, rng: R });
          g.rotateZ(R.range(-0.5, 0.5));
          g.rotateX(R.range(-0.5, 0.5));
          g.rotateY(R.range(0, TAU));
          g.translate(x + R.range(-1, 1) * size, y + size * 0.12, z + R.range(-1, 1) * size);
          needles.push(g);
        }
      };
      for (const v of VENTS) cluster(v[0], v[2], v[1], 7, 0.13);
      cluster(Math.sin(1.9) * 0.78, STEP2, Math.cos(1.9) * 0.78, 4, 0.08);
      cluster(Math.sin(3.6) * 0.8, STEP2, Math.cos(3.6) * 0.8, 3, 0.07);
      cluster(Math.sin(185 * DEG) * 2.2, 1.55, Math.cos(185 * DEG) * 2.2, 4, 0.09);
      const cY = new THREE.Color(PAL.sulfur),
        cO = new THREE.Color('#a8791c'),
        cW = new THREE.Color('#d9cf9a');
      b.add(
        paint(merge(needles.map((g) => paint(g, {}))), {
          color: (v) => _c.copy(cY).lerp(cO, clamp(0.5 - nz.fbm3(v.x * 9, v.y * 9, v.z * 9, 2), 0, 0.8)),
          rough: 0.4,
          metal: 0,
          mat: MAT.CRYSTAL,
        })
      );
      b.add(
        paint(merge(crust.map((g) => paint(g, {}))), {
          color: (v) => _c.copy(cY).multiplyScalar(0.8).lerp(cW, clamp(nz.fbm3(v.x * 6, v.y * 6, v.z * 6, 3) + 0.3, 0, 0.8)),
          rough: 0.95,
          metal: 0,
          mat: MAT.STONE,
        })
      );
      b.emitter('smoke', VENTS[0][0], VENTS[0][2] + 0.1, VENTS[0][1], { color: '#b9b08a', size: 0.7, rate: 0.5 });
    }

    // what is left of someone who reached through the bars
    {
      const sk = skull(0.2, { seed: 4, jaw: false });
      sk.rotateX(-0.35);
      sk.rotateZ(0.5);
      sk.rotateY(2.3);
      sk.translate(Math.sin(0.95) * 1.12, STEP2 + 0.075, Math.cos(0.95) * 1.12);
      const ca = sk.attributes.color;
      for (let i = 0; i < ca.count; i++) ca.setXYZ(i, ca.getX(i) * 0.42, ca.getY(i) * 0.37, ca.getZ(i) * 0.26);
      b.add(sk);
      const bones = [];
      for (const [x, z, yaw, len] of [
        [Math.sin(1.2) * 1.3, Math.cos(1.2) * 1.3, 0.4, 0.34],
        [Math.sin(0.72) * 1.36, Math.cos(0.72) * 1.36, 2.0, 0.27],
        [Math.sin(1.05) * 1.52, Math.cos(1.05) * 1.52, 1.1, 0.22],
      ]) {
        const g = tube(
          [
            [-len / 2, 0, 0],
            [-len / 4, 0.004, 0.004],
            [len / 4, 0.002, -0.004],
            [len / 2, 0, 0],
          ],
          (t) => 0.009 + 0.007 * Math.pow(Math.abs(t - 0.5) * 2, 4),
          5,
          { samples: 6 }
        );
        g.rotateY(yaw);
        g.translate(x, STEP2 + 0.02, z);
        bones.push(g);
      }
      b.add(paint(merge(bones.map((g) => paint(g, {}))), { color: (v) => _c.set(PAL.boneOld).multiplyScalar(0.45 + 0.2 * nz.n3(v.x * 20, v.y * 20, v.z * 20)), rough: 0.9, metal: 0, mat: MAT.PLAIN }));
    }

    // ------------------------------------------------------------------------------------------
    // The bowl
    // ------------------------------------------------------------------------------------------
    {
      const RAD = 20;
      const y0 = PED - 0.01;
      const g = lathe(
        [
          [0.17, y0, 'hard'],
          [0.2, y0 + 0.05],
          [0.19, y0 + 0.09],
          [0.3, y0 + 0.14],
          [0.4, y0 + 0.25],
          [0.435, y0 + 0.36],
          [0.43, y0 + 0.4, 'hard'],
          [0.375, y0 + 0.405, 'hard'],
          [0.345, y0 + 0.32],
          [0.26, y0 + 0.23],
          [0.12, y0 + 0.185],
          [0, y0 + 0.18],
        ],
        RAD
      );
      hewn(g, RAD, { amp: 0.016, freq: 4, seed: 5, squash: 0.025 });
      const cB = new THREE.Color(PAL.stoneDark).lerp(new THREE.Color(PAL.stoneWarm), 0.4),
        cD = new THREE.Color(PAL.stoneDark),
        cY = new THREE.Color(PAL.sulfur).multiplyScalar(0.85),
        cW = new THREE.Color('#cfc48e');
      paint(g, {
        color: (v) => {
          const rr = Math.hypot(v.x, v.z) || 1;
          const a = Math.atan2(v.x, v.z);
          const inside = (v.nx * v.x + v.nz * v.z) / rr < -0.05 || (v.ny > 0.6 && rr < 0.37);
          const n = nz.fbm3(v.x * 5, v.y * 5, v.z * 5, 3);
          _c.copy(cB).lerp(cD, clamp(0.35 + 0.5 * n, 0, 0.8));
          if (inside) {
            // baked crust, burnt black in the bottom
            _c.lerp(cY, clamp(0.5 + 0.6 * n, 0, 0.85)).lerp(cW, clamp(nz.fbm3(v.x * 11, v.y * 11, v.z * 11, 2) * 0.8, 0, 0.45));
            _c.lerp(cSoot, clamp(1.2 - rr / 0.24, 0, 0.9));
          } else {
            // runs of it down the outside, soot under the belly
            const run = nz.fbm2(a * 4, 3.3, 2) * 0.5 + 0.5;
            const reach = y0 + 0.415 - run * run * 0.3;
            if (v.y > reach) _c.lerp(cY, clamp((v.y - reach) / 0.05, 0, 0.7));
            _c.lerp(cSoot, clamp(0.7 - (v.y - y0) / 0.22, 0, 0.75));
          }
          return _c;
        },
        rough: 0.92,
        metal: 0,
        mat: MAT.STONE,
      });
      b.add(g);
    }

    // ------------------------------------------------------------------------------------------
    // The cage: sixteen bars round the bowl, every other one a talon bent in over it
    // ------------------------------------------------------------------------------------------
    {
      const RC = CAGE.radius;
      const Rb = new Rng(881);
      const bars = [];
      const NB = 16;
      for (let i = 0; i < NB; i++) {
        const a = ((i + 0.5) / NB) * TAU;
        const sx = Math.sin(a),
          cz = Math.cos(a);
        const bow = i === 5 ? 0.09 : i === 12 ? -0.05 : Rb.range(-0.012, 0.012); // one has been levered at
        const at = (r, y) => [sx * r, y, cz * r];
        if (i % 2 === 0) {
          const top = 1.76 + Rb.range(-0.03, 0.03);
          bars.push(
            tube([at(RC, 0.2), at(RC + bow * 0.5, 0.7), at(RC + bow, 1.2), at(RC, top), at(RC - 0.035, top + 0.24), at(RC - 0.13, top + 0.43), at(RC - 0.26, top + 0.55), at(RC - 0.35, top + 0.52)], (t) => (t < 0.82 ? 0.026 : 0.003 + 0.023 * (1 - (t - 0.82) / 0.18)), 4, { samples: 14 })
          );
        } else {
          const top = 2.1 + Rb.range(-0.08, 0.08);
          bars.push(tube([at(RC, 0.2), at(RC + bow * 0.5, 0.7), at(RC + bow, 1.2), at(RC, top - 0.25), at(RC, top)], (t) => (t < 0.9 ? 0.022 : 0.002 + 0.02 * (1 - (t - 0.9) / 0.1)), 4, { samples: 8 }));
        }
      }
      const iron = [paint(merge(bars.map((g) => paint(g, {}))), ironSpec(0.75, 4, 7))];
      iron.push(hoop(RC + 0.012, 0.07, { t: 0.014, seg: 32, rust: 0.8, seed: 3, y: STEP2 + 0.075 }));
      iron.push(hoop(RC + 0.012, 0.05, { t: 0.012, seg: 32, rust: 0.7, seed: 6, y: 1.17 }));
      iron.push(hoop(RC + 0.012, 0.05, { t: 0.012, seg: 32, rust: 0.85, seed: 9, y: 1.74 }));
      iron.push(rivets(RC + 0.026, 1.17, NB, { size: 0.016, rust: 0.7, a0: TAU / NB / 2 }));
      iron.push(rivets(RC + 0.026, 1.74, NB, { size: 0.016, rust: 0.7, a0: TAU / NB / 2 }));
      // a plate with the sign of the Prime, hung on the front bars and gone askew
      {
        const plate = paint(box(0.3, 0.37, 0.012), ironSpec(0.6, 12, 6));
        const sign = glyph('sulfur', 0.25, { color: '#8a6f1c', width: 0.07, depth: 0.012 });
        sign.translate(0, 0, 0.007);
        const g = merge(plate, sign);
        g.rotateZ(0.07);
        g.translate(0.02, 1.46, RC + 0.035);
        g.rotateY(0.59);
        iron.push(g);
      }
      b.part('cage', ...iron);
    }

    // ------------------------------------------------------------------------------------------
    // Colliders and anchors
    // ------------------------------------------------------------------------------------------
    b.cylCollider(0, (STEP1 + DEEP) / 2, 0, R1 - 0.05, STEP1 - DEEP);
    b.cylCollider(0, (STEP1 + STEP2) / 2, 0, R2 - 0.02, STEP2 - STEP1);
    b.cylCollider(0, (STEP2 + PED + 0.4) / 2, 0, 0.72, PED + 0.4 - STEP2);
    // the wall of columns, as three boxes on its arc
    for (const deg of [152, 180, 208]) {
      let top = 0;
      for (const c of cells.values()) if (c.kind === 'wall' && Math.abs(angDiff(Math.atan2(c.x, c.z), deg * DEG)) < 14 * DEG) top = Math.max(top, c.h);
      const hgt = top * 0.88;
      b.boxCollider(Math.sin(deg * DEG) * 2.42, hgt / 2, Math.cos(deg * DEG) * 2.42, 0.62, hgt / 2, 0.42, deg * DEG);
    }
    b.anchor('prime', 0, 1.3, 0);
    BRAZ.forEach((p, i) => b.anchor('brazier' + (i + 1), p[0], STEP1, p[1]));
    return b.build();
  },
  { kind: 'structure', variants: 1, cage: CAGE, steps: [STEP1, STEP2], stepRadii: [R1, R2] }
);
