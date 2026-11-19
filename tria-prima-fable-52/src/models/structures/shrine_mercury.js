// Mercury: a round stone basin brimming with quicksilver under a carved lid, inside a ring of four
// leaning pillars hung with rusted chain. Owner: MODELS-B.
import { Builder, Rng, Noise, MAT, PAL, TAU, THREE, paint, tint, deform, flat, box, sphere, dome, lathe, torus, tube, rock, merge } from '../kit.js';
import { register } from '../registry.js';
import { Mesher, makeStone, blockCyl, blockBox, pavingDisc, ironSpec, hoop, rivets, chain, glyph } from './_shared.js';

const DEG = Math.PI / 180;
const angDiff = (a, b) => {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};
const _c = new THREE.Color();

const FY = 0.14; // the terrace the basin stands on
const LID = { radius: 1.1, thickness: 0.3, y: 1.15, bottom: 1.0, top: 1.3 };
const POOL = 0.8; // the quicksilver stands a hand below the rim, so that what floats on it clears the lid
// When the lid is lifted it drifts up and out toward (1.9, 3.45, 0.6): the pillars stand either side of
// that bearing and lean away from it, and the chain across it hangs low.
const GAP = Math.atan2(1.9, 0.6) / DEG;

/** A deformed lathe has a crease where its first and last columns meet: average the normals there. */
function seamNormals(g, radial) {
  const nor = g.attributes.normal,
    cols = radial + 1;
  for (let j = 0; (j + 1) * cols <= nor.count; j++) {
    const a = j * cols,
      b = a + radial;
    const x = nor.getX(a) + nor.getX(b),
      y = nor.getY(a) + nor.getY(b),
      z = nor.getZ(a) + nor.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    nor.setXYZ(a, x / l, y / l, z / l);
    nor.setXYZ(b, x / l, y / l, z / l);
  }
  return g;
}

register(
  'shrine_mercury',
  () => {
    const b = new Builder();
    const R = new Rng(2207);
    const nz = new Noise(88);
    const stone = makeStone({ seed: 61, moss: 0.6, lichen: 0.45, damp: 0.55, warm: 0.08, y0: FY });
    const cm = new THREE.Color(),
      ce = new THREE.Color();

    // terrace: a kerb of blocks and three rings of flags; then plinth, drum and rim of the basin
    {
      const M = new Mesher();
      blockCyl(3.6, { y0: -0.8, top: 0.8 + FY, seg: 56, per: 2, round: true, ri: 3.3, innerFrom: 1e9, courseH: 0.47, seed: 3, stone, M, build: false });
      pavingDisc(M, 1.3, 3.3, { y: FY, slab: 0.68, seed: 5, stone, dark: 0.8 });
      blockCyl(1.34, { y0: FY, top: 0.16, seg: 36, per: 3, round: true, ri: 1.19, innerFrom: 1e9, courseH: 0.16, seed: 7, stone, M, build: false });
      blockCyl(1.2, { y0: FY + 0.16, top: 0.54, seg: 36, per: 2, round: true, ri: 0.955, innerFrom: POOL - 0.1 - FY - 0.16, courseH: 0.27, seed: 9, stone, M, build: false });
      const NR = 18;
      for (let k = 0; k < NR; k++) {
        const a0 = ((k + 0.37) / NR) * TAU,
          a1 = ((k + 1.37) / NR) * TAU;
        const Q = (r, y, a) => [Math.sin(a) * r, y, Math.cos(a) * r];
        const P = [0.95, 1.275].map((r) => [0.84, 1.0].map((y) => [Q(r, y, a0), Q(r, y, a1)]));
        stone.face(R, Math.sin(a0) * 4 + 7, 0.95, Math.cos(a0) * 4, cm, ce);
        cm.multiplyScalar(1.08);
        M.hexa(P, cm, ce, 0.012, [1, 1, 2, 1, 0, 0]);
      }
      b.add(M.build({ rough: 0.95, mat: MAT.STONE }));
    }
    // iron bands round the drum, and the sign of the Prime cut into its face
    b.add(hoop(1.205, 0.07, { t: 0.014, seg: 36, rust: 0.8, seed: 2, y: 0.42 }), hoop(1.205, 0.06, { t: 0.014, seg: 36, rust: 0.75, seed: 4, y: 0.74 }));
    b.add(rivets(1.215, 0.42, 14, { size: 0.02, rust: 0.7, a0: 0.1 }), rivets(1.215, 0.74, 14, { size: 0.02, rust: 0.7, a0: 0.3 }));
    {
      const g = glyph('mercury', 0.24, { width: 0.07, depth: 0.02 });
      g.translate(0, 0.58, 1.212);
      b.add(g);
    }

    // the quicksilver
    {
      const g = dome(0.955, 24, 3, 0.03);
      g.translate(0, POOL - 0.02, 0);
      b.part('pool', paint(g, { color: PAL.quick, rough: 0.04, metal: 1, mat: MAT.PLAIN }));

    }

    // the lid
    {
      const L = LID;
      const body = lathe(
        [
          [0, L.bottom + 0.2],
          [0.6, L.bottom + 0.2],
          [0.79, L.bottom + 0.07],
          [0.84, L.bottom, 'hard'],
          [L.radius - 0.03, L.bottom, 'hard'],
          [L.radius, L.bottom + 0.04],
          [L.radius, L.top - 0.12, 'hard'],
          [L.radius - 0.1, L.top - 0.02, 'hard'],
          [0.74, L.top, 'hard'],
          [0.7, L.top - 0.035, 'hard'],
          [0, L.top - 0.035],
        ],
        28
      );
      const cS = new THREE.Color(PAL.stoneDark).lerp(new THREE.Color(PAL.stone), 0.55),
        cD = new THREE.Color('#1c1c1e'),
        cL = new THREE.Color(PAL.lichen);
      paint(body, {
        color: (v) => {
          const a = Math.atan2(v.x, v.z),
            rr = Math.hypot(v.x, v.z);
          const n = nz.fbm3(v.x * 2.2, v.y * 2.2, v.z * 2.2, 3);
          _c.copy(cS).multiplyScalar(0.85 + 0.3 * n);
          // rain has pooled in the sunk field; a crack runs out from the middle
          if (v.y > L.top - 0.05 && rr < 0.72) _c.multiplyScalar(0.72);
          const crack = Math.abs(angDiff(a, 2.2 + 0.25 * Math.sin(rr * 5)));
          if (crack < 0.07 && rr > 0.15) _c.lerp(cD, 0.75);
          const li = nz.fbm2(v.x * 1.4 + 5, v.z * 1.4, 3);
          if (li > 0.15) _c.lerp(cL, Math.min(0.4, (li - 0.15) * 1.4));
          return _c;
        },
        rough: 0.93,
        metal: 0,
        mat: MAT.STONE,
      });
      const sign = glyph('mercury', 0.95, { width: 0.07, depth: 0.03 });
      sign.rotateX(-Math.PI / 2);
      sign.translate(0, L.top - 0.035, 0);
      paint(sign, { color: '#59636b', rough: 0.3, metal: 0.92, mat: MAT.METAL });
      // four iron clamps over the edge
      const iron = [];
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * TAU + 0.5;
        const over = box(0.09, 0.022, 0.3);
        over.translate(0, L.top - 0.03, L.radius - 0.17);
        over.rotateX(0.22);
        over.translate(0, 0.045, 0.012);
        const down = box(0.09, 0.3, 0.022);
        down.translate(0, L.bottom + 0.06, L.radius + 0.012);
        const nut = box(0.06, 0.06, 0.03);
        nut.translate(0, L.bottom - 0.04, L.radius + 0.03);
        for (const g of [over, down, nut]) {
          g.rotateY(a);
          iron.push(g);
        }
      }
      b.part('lid', body, sign, paint(merge(iron.map((g) => paint(g, {}))), ironSpec(0.8, 5, 9)));
    }

    // ------------------------------------------------------------------------------------------
    // The four pillars
    // ------------------------------------------------------------------------------------------
    const cS = new THREE.Color(PAL.stone),
      cW = new THREE.Color(PAL.stoneWarm),
      cMo = new THREE.Color(PAL.moss).lerp(new THREE.Color(PAL.stoneDark), 0.35),
      cLi = new THREE.Color(PAL.lichen);
    // weathered ashlar: rain streaks, damp and moss at the foot, lichen higher up
    const weather = (seed, tone = 1, mossy = 1) => ({
      color: (v) => {
        const a = Math.atan2(v.x, v.z);
        const n = nz.fbm3(v.x * 3 + seed * 5, v.y * 1.3, v.z * 3, 3);
        _c.copy(cS)
          .lerp(cW, 0.2 + 0.2 * nz.n2(seed * 3.1, v.y * 0.6))
          .multiplyScalar(tone * (0.86 + 0.28 * n));
        const st = nz.fbm2(a * 5 + seed * 2, v.y * 0.35 + 7, 2);
        if (st > 0.1 && v.ny < 0.5) _c.multiplyScalar(1 - Math.min(0.3, (st - 0.1) * 0.6));
        _c.multiplyScalar(1 - 0.3 * mossy * Math.max(0, 1 - v.y / 1.1));
        const m = (nz.fbm2(a * 1.3 + seed, v.y * 0.7, 3) - v.y * 0.3 + 0.25) * mossy;
        if (m > 0) _c.lerp(cMo, Math.min(0.65, m * 1.5));
        const l = nz.fbm2(a * 2 + 9 + seed, v.y * 1.1 + 3, 3);
        if (l > 0.22) _c.lerp(cLi, Math.min(0.35, (l - 0.22) * 1.5));
        return _c;
      },
      rough: 0.95,
      metal: 0,
      mat: MAT.STONE,
    });
    const RAD = 12;
    // one drum of a shaft, worn out of round, its arrises chipped; local y runs 0..h. The beds are dark.
    const drum = (r0, r1, h, seed) => {
      const c = 0.016;
      const g = lathe(
        [
          [0, 0],
          [r0 - c, 0, 'hard'],
          [r0, c],
          [(r0 + r1) / 2, h / 2],
          [r1, h - c],
          [r1 - c, h, 'hard'],
          [0, h],
        ],
        RAD
      );
      deform(g, (p) => {
        const rr = Math.hypot(p.x, p.z);
        if (rr < 1e-4) return;
        const edge = Math.max(0, 1 - Math.min(p.y, h - p.y) / 0.05);
        const chip = Math.max(0, nz.fbm3(p.x * 6 + seed * 7.3, p.y * 6, p.z * 6, 2) - 0.1) * 0.17 * edge;
        const wear = 0.014 * nz.fbm3(p.x * 2.3 + seed, p.y * 2.3, p.z * 2.3 + seed * 3, 2);
        const k = 1 - (chip + wear) / rr;
        p.x *= k;
        p.z *= k;
        if (chip > 0) p.y += (p.y < h / 2 ? 1 : -1) * chip * 0.5;
      });
      return seamNormals(g, RAD);
    };
    const beds = (g) =>
      tint(g, (v) => {
        const row = Math.floor(v.i / (RAD + 1));
        return row <= 2 || row >= 6 ? 0.42 : 1;
      });
    // a square slab cut from a lathe so that its corners can be knocked off: half-width w, thickness t
    const slab = (w, t, seed, breaks) => {
      const g = lathe(
        [
          [0, 0],
          [w - 0.07, 0, 'hard'],
          [w, 0.07, 'hard'],
          [w, t, 'hard'],
          [0, t],
        ],
        16
      );
      deform(
        g,
        (p) => {
          const rr = Math.hypot(p.x, p.z);
          if (rr < 1e-4) return;
          const a = Math.atan2(p.z, p.x);
          let k = 1 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
          for (const [ca, depth] of breaks) {
            const d = Math.abs(angDiff(a, ca));
            if (d < 0.1) {
              k *= 1 - depth;
              if (p.y > t * 0.5) p.y -= depth * 0.3;
            } else if (d < 0.45) k *= 1 - depth * 0.2;
          }
          p.x *= k;
          p.z *= k;
          p.y += 0.012 * nz.n3(p.x * 4 + seed, p.y * 4, p.z * 4);
        },
        false
      );
      return flat(g);
    };
    const rS = (y) => 0.305 - 0.014 * (y - 0.48);

    // A pillar standing at the origin. Returns the geometry and the top of its axis.
    const pillar = (H, seed, whole, breaks) => {
      const Rp = new Rng(seed * 77 + 5);
      const out = [];
      out.push(blockBox(0.86, 0.3, 0.86, { y0: 0, seed: seed * 3 + 1, stone, courseH: 0.3, blockL: 0.95, top: true, bulge: 0.02 }));
      const base = lathe(
        [
          [0.385, 0.3, 'hard'],
          [0.4, 0.35],
          [0.375, 0.4],
          [0.335, 0.425],
          [0.325, 0.48, 'hard'],
          [0, 0.48],
        ],
        RAD
      );
      out.push(paint(base, weather(seed, 0.9)));
      let y = 0.48,
        k = 0,
        ox = 0,
        oz = 0;
      while (y < H - 0.01) {
        let h = Rp.range(0.44, 0.72);
        if (H - (y + h) < 0.32) h = H - y;
        const f = Rp.range(0.975, 1.02);
        const g = drum(rS(y) * f, rS(y + h) * f, h, seed * 10 + k);
        g.rotateY(Rp.range(0, TAU));
        // the drums have crept on their beds
        ox += Rp.range(-0.024, 0.024);
        oz += Rp.range(-0.024, 0.024);
        g.translate(ox, y, oz);
        out.push(beds(paint(g, weather(seed, Rp.range(0.9, 1.06)))));
        y += h;
        k++;
      }
      if (whole) {
        // necking, bell and a heavy abacus with a corner or two knocked off
        const r = rS(H);
        const bell = lathe(
          [
            [r, H, 'hard'],
            [r + 0.035, H + 0.03],
            [r + 0.005, H + 0.065],
            [0.33, H + 0.2],
            [0.43, H + 0.33, 'hard'],
            [0, H + 0.33],
          ],
          RAD
        );
        bell.translate(ox, 0, oz);
        out.push(paint(bell, weather(seed, 0.94)));
        const ab = slab(0.47, 0.2, seed, breaks);
        ab.rotateY(Rp.range(-0.1, 0.1));
        ab.translate(ox, H + 0.33, oz);
        out.push(paint(ab, weather(seed + 3, 1.02)));
        // an iron collar round the necking: the chains hang from it
        const col = hoop(r + 0.032, 0.07, { t: 0.014, seg: RAD, rust: 0.85, seed: seed + 20, y: H + 0.105 });
        col.translate(ox, 0, oz);
        out.push(col);
      } else {
        // the break
        const br = rock(rS(H) * 0.9, { seed: seed * 9 + 4, detail: 1, rough: 0.4, freq: 2.4, squash: [1, 0.46, 0.86], facet: true });
        br.rotateZ(0.3);
        br.rotateY(2.1);
        br.translate(ox + 0.02, H - 0.06, oz - 0.03);
        out.push(paint(br, weather(seed, 1.16, 0.3)));
      }
      return { geo: merge(out), top: [ox, H, oz] };
    };

    const PR = 2.85;
    const Q = Math.PI / 4;
    const defs = [
      { deg: GAP - 45, H: 3.3, lean: 0.085, toward: 350, whole: true, breaks: [[Q, 0.26]] },
      { deg: GAP + 45, H: 3.62, lean: 0.125, toward: 200, whole: true, breaks: [] },
      {
        deg: GAP + 135,
        H: 3.08,
        lean: 0.06,
        toward: 300,
        whole: true,
        breaks: [
          [-Q, 0.3],
          [3 * Q, 0.16],
        ],
      },
      { deg: GAP + 225, H: 1.32, lean: 0.045, toward: 20, whole: false, breaks: [] },
    ];
    const necks = [];
    defs.forEach((d, i) => {
      const a = d.deg * DEG,
        t = d.toward * DEG;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(Math.cos(t), 0, -Math.sin(t)).normalize(), d.lean);
      const pos = new THREE.Vector3(Math.sin(a) * PR, FY - 0.07, Math.cos(a) * PR);
      const m = new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1));
      const p = pillar(d.H, i + 1, d.whole, d.breaks);
      p.geo.applyMatrix4(m);
      paint(p.geo, { uvw: true });
      b.add(p.geo);
      necks.push(new THREE.Vector3(p.top[0], d.H + 0.105, p.top[2]).applyMatrix4(m));
      // colliders cannot lean, so a tall pillar gets two
      const full = d.H + (d.whole ? 0.53 : 0.1);
      const n = d.whole ? 2 : 1;
      for (let s = 0; s < n; s++) {
        const y0 = (full * s) / n,
          y1 = (full * (s + 1)) / n;
        const c = new THREE.Vector3(p.top[0] * 0.5, (y0 + y1) / 2, p.top[2] * 0.5).applyMatrix4(m);
        b.cylCollider(c.x, c.y, c.z, 0.43, y1 - y0 + 0.1);
      }
    });

    // chains from collar to collar; the south one has parted, and the stump holds nothing
    {
      const hook = (c, toward) => {
        const d = new THREE.Vector3(toward.x - c.x, 0, toward.z - c.z).normalize();
        const p = [c.x + d.x * 0.4, c.y, c.z + d.z * 0.4];
        const ring = torus(0.075, 0.017, 4, 8);
        ring.rotateX(Math.PI / 2);
        ring.rotateY(Math.atan2(d.x, d.z) + Math.PI / 2);
        ring.translate(p[0], p[1], p[2]);
        b.add(paint(ring, ironSpec(0.85, 3, 10)));
        return [p[0], p[1] - 0.075, p[2]];
      };
      const CH = { link: 0.34, wire: 0.03, rust: 0.85 };
      b.add(chain(hook(necks[0], necks[1]), hook(necks[1], necks[0]), { ...CH, sag: 1.5, seed: 1 }));
      b.add(chain(hook(necks[1], necks[2]), hook(necks[2], necks[1]), { ...CH, sag: 1.0, seed: 2 }));
      // hanging ends
      const h0 = hook(necks[0], necks[3]);
      b.add(chain(h0, [h0[0] - 0.1, FY + 0.9, h0[2] + 0.04], { ...CH, sag: 0, seed: 3 }));
      const h2 = hook(necks[2], necks[3]);
      b.add(chain(h2, [h2[0] + 0.04, FY + 0.3, h2[2] + 0.1], { ...CH, sag: 0, seed: 4 }));
      b.add(chain([h2[0] + 0.1, FY + 0.03, h2[2] + 0.3], [h2[0] + 0.55, FY + 0.03, h2[2] + 1.45], { ...CH, sag: 0, seed: 5 }));
    }

    // the fallen top of the fourth pillar: one drum on the terrace, the rest gone over the kerb
    {
      const SA = GAP + 225; // where the stump stands
      const polar = (deg, r) => [Math.sin(deg * DEG) * r, Math.cos(deg * DEG) * r];
      const lay = (g, r, yaw, x, z, y0, roll = 0) => {
        g.rotateY(roll);
        g.rotateZ(Math.PI / 2);
        g.computeBoundingBox();
        g.translate(-(g.boundingBox.min.x + g.boundingBox.max.x) / 2, r - 0.04, 0);
        g.rotateY(yaw);
        g.translate(x, y0, z);
        tint(g, (v) => (v.ny < -0.3 ? 0.55 : v.y - y0 < 0.1 ? 0.75 : 1));
        return paint(g, { uvw: true });
      };
      const d1 = beds(paint(drum(0.285, 0.278, 0.62, 41), weather(4, 1.0, 0.25)));
      const p1 = polar(SA - 18, 2.95);
      b.add(lay(d1, 0.28, 0.5, p1[0], p1[1], FY, 1.1));
      b.boxCollider(p1[0], FY + 0.27, p1[1], 0.33, 0.27, 0.3, 0.5);
      const d2 = beds(paint(drum(0.275, 0.268, 0.55, 42), weather(4, 0.94, 0.25)));
      const p2 = polar(SA + 7, 4.08);
      b.add(lay(d2, 0.27, -0.45, p2[0], p2[1], -0.05, 2.3));
      b.boxCollider(p2[0], 0.24, p2[1], 0.3, 0.26, 0.29, -0.45);
      // the capital, face down in the dirt against the kerb
      {
        const bell = lathe(
          [
            [0.285, 0, 'hard'],
            [0.32, 0.03],
            [0.29, 0.065],
            [0.33, 0.2],
            [0.43, 0.33, 'hard'],
            [0, 0.33],
          ],
          RAD
        );
        const ab = slab(0.47, 0.2, 9, [
          [Q, 0.34],
          [-3 * Q, 0.2],
        ]);
        ab.translate(0, 0.33, 0);
        const g = merge(paint(bell, weather(4, 0.92, 0.25)), paint(ab, weather(7, 1.0, 0.25)));
        // on its edge, the bell pointing away from the terrace
        g.translate(0, -0.43, 0);
        g.rotateY(0.6);
        g.rotateZ(Math.PI / 2 + 0.3);
        g.translate(0, 0.36, 0);
        g.rotateY((SA - 15) * DEG + Math.PI / 2);
        const p3 = polar(SA - 15, 4.2);
        g.translate(p3[0], 0, p3[1]);
        tint(g, (v) => (v.y < 0.14 ? 0.6 : 1));
        b.add(paint(g, { uvw: true }));
        b.boxCollider(p3[0], 0.3, p3[1], 0.4, 0.32, 0.45, (SA - 15) * DEG);
      }
      // shards
      for (let i = 0; i < 11; i++) {
        const r = i < 3 ? R.range(0.13, 0.2) : R.range(0.05, 0.11);
        const g = rock(r, { seed: 300 + i * 7, detail: i < 3 ? 1 : 0, rough: 0.3, freq: 2, squash: [1, R.range(0.45, 0.7), R.range(0.7, 1)], facet: true, sink: 0.4 });
        g.rotateY(R.range(0, TAU));
        const an = (SA + R.range(-24, 20)) * DEG,
          rr = R.range(2.2, 4.5);
        const x = Math.sin(an) * rr,
          z = Math.cos(an) * rr;
        if (Math.abs(rr - 3.6) < r + 0.05) continue;
        g.translate(x, (rr < 3.6 ? FY : 0) + r * 0.22, z);
        stone.face(R, x * 3, 0.5, z * 3, cm, ce);
        const cc = cm.clone().multiplyScalar(1.1),
          cd = ce.clone();
        b.add(paint(g, { color: (v) => _c.copy(cc).lerp(cd, 0.5 + 0.5 * nz.fbm3(v.x * 5, v.y * 5, v.z * 5, 2)), rough: 0.95, metal: 0, mat: MAT.STONE }));
      }
    }

    // beads of quicksilver that have crept out under the lid
    {
      const beads = [];
      for (let i = 0; i < 16; i++) {
        const a = R.range(-1.1, 1.5);
        const d = i < 5 ? 1.36 + R.range(0, 0.06) : R.range(1.42, 2.3);
        const r = i < 3 ? R.range(0.07, 0.11) : R.range(0.02, 0.055);
        const g = sphere(r, 8, 5);
        g.scale(1, 0.62, 1);
        g.translate(Math.sin(a) * d, FY + r * 0.5, Math.cos(a) * d);
        beads.push(g);
      }
      // a dribble over the rim, ending in a drop that has not yet fallen
      const at = (r, y) => [Math.sin(0.28) * r, y, Math.cos(0.28) * r];
      beads.push(tube([at(1.13, 1.002), at(1.24, 1.004), at(1.281, 0.985), at(1.284, 0.9), at(1.283, 0.845)], 0.011, 5, { samples: 8 }));
      const hang = sphere(0.027, 8, 6);
      hang.scale(1, 1.35, 1);
      const ph = at(1.283, 0.825);
      hang.translate(ph[0], ph[1], ph[2]);
      beads.push(hang);
      const drop = sphere(0.045, 8, 5);
      drop.scale(1, 0.5, 1);
      const pd = at(1.39, FY + 0.16 + 0.02);
      drop.translate(pd[0], pd[1], pd[2]);
      beads.push(drop);
      b.add(paint(merge(beads.map((g) => paint(g, {}))), { color: PAL.quick, rough: 0.05, metal: 1, mat: MAT.PLAIN }));
    }

    b.cylCollider(0, (FY - 0.8) / 2, 0, 3.6, FY + 0.8);
    b.cylCollider(0, (FY + 1.0) / 2, 0, 1.3, 1.0 - FY);
    b.anchor('prime', 0, POOL + 0.02, 0);
    return b.build();
  },
  { kind: 'structure', variants: 1, lid: LID, poolY: POOL, floorY: FY }
);
