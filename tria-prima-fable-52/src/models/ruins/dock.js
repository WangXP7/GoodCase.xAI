// The rotting pier and the tarred boat.
import { Builder, Rng, Noise, MAT, PAL, THREE, paint, xf, col, mixc, tube, lathe, TAU } from '../kit.js';
import { register } from '../registry.js';
import { Tris, V3, lerp, sstep, timber, pole, iron, aim, dist3, rope, lantern, waterStain, ROPE } from './_shared.js';

// a timber built along +Y laid flat: its length along +X, its width along Z, its thickness up
const FLAT = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0));

register(
  'dock',
  (seed) => {
    const R = new Rng(seed * 811 + 19);
    const b = new Builder();
    const HWD = 1.3,
      TOP = 1.0,
      END = 6.4; // beyond this the deck has mostly gone into the water
    const wet = (g) => waterStain(g, 0.12);
    const grey = () => mixc(PAL.woodGrey, PAL.barkPale, R.range(0, 0.35));

    // bents: two piles and a cap beam every 2.2 m
    const NB = 8;
    const posts = { 1: [-1], 3: [1], 5: [-1], 6: [1], 7: [-1, 1] };
    for (let i = 0; i < NB; i++) {
      const z = -7.7 + (15.4 / (NB - 1)) * i;
      const lost = i === NB - 1 ? R.sign() : 0; // one pile of the last bent has snapped at the water
      for (const side of [-1, 1]) {
        const moor = (posts[i] || []).includes(side) && lost !== side;
        const topY = lost === side ? R.range(0.1, 0.4) : moor ? R.range(1.75, 2.0) : 0.66;
        const g = pole(topY + 3, 0.12, { rng: R, radial: 7, hseg: 3, taper: 0.84, crook: 0.03, color: mixc(PAL.woodGrey, PAL.woodDark, 0.45), rot: 0.25 });
        const px = side * (1.14 + R.range(-0.03, 0.03)),
          lx = R.range(-0.025, 0.025) + (i === NB - 1 ? 0.05 : 0),
          lz = R.range(-0.03, 0.03) - side * 0.01;
        xf(g, { r: [lx, R.range(0, TAU), lz], t: [px, -3, z] });
        b.add(wet(g));
        if (moor) {
          // rope turns worn into the post, an iron band at its head
          const hx = px - lz * (topY + 3),
            hz = z + lx * (topY + 3);
          const turns = [];
          for (let k = 0; k < 3; k++) turns.push([0.118, 1.325 + k * 0.036], [0.142, 1.343 + k * 0.036]);
          turns.push([0.118, 1.325 + 3 * 0.036]);
          const wrap = lathe(turns, 7);
          xf(wrap, { r: [R.range(-0.05, 0.05), R.range(0, TAU), R.range(-0.05, 0.05)], t: [hx, 0, hz] });
          b.add(paint(wrap, { color: (v) => ROPE.clone().multiplyScalar(0.75 + 0.35 * Math.abs(Math.sin(v.y * 87))), rough: 0.95, mat: MAT.CLOTH }));
          const band = new THREE.CylinderGeometry(0.112, 0.114, 0.05, 7, 1, true);
          band.translate(hx, topY - 0.09, hz);
          b.add(iron(band, R, 0.4));
          if (z < END) b.cylCollider(hx, 1.45, hz, 0.15, 0.95);
          if (i === 3 || i === 7) {
            // a line left made fast, hanging into the water
            const o = side * 0.16;
            b.add(rope([[hx + o, 1.38, hz], [hx + o * 1.7, 1.0, hz + 0.12], [hx + o * 1.9, 0.2, hz + 0.2], [hx + o * 1.9, -0.7, hz + 0.24]], 0.018, { sway: 0.25 }));
          }
        }
      }
      if (lost) continue;
      b.add(aim(timber(2.72, 0.19, 0.2, { rng: R, color: PAL.woodGrey, rot: 0.3 }), [-1.36, 0.75, z], [1.36, 0.75, z]));
      if (R.chance(0.75)) {
        const d = i % 2 ? 1 : -1;
        const a = [-1.12 * d, -0.55, z + 0.14],
          e = [1.12 * d, 0.52, z + 0.14];
        b.add(wet(aim(timber(dist3(a, e), 0.13, 0.04, { rng: R, color: PAL.woodGrey, rot: 0.4, broken: R.chance(0.3) ? 1 : 0 }), a, e)));
      }
    }
    // stringers under the planks, their seaward ends broken off short
    for (const x of [-1.05, 0, 1.05]) {
      const zEnd = R.range(6.6, 7.6);
      const mid = R.range(-1.5, 1.5);
      b.add(aim(timber(mid + 7.95, 0.12, 0.13, { rng: R, color: PAL.woodGrey, rot: 0.3 }), [x, 0.9, -7.95], [x, 0.9, mid]));
      b.add(aim(timber(zEnd - mid, 0.12, 0.13, { rng: R, color: PAL.woodGrey, rot: 0.3, broken: 1 }), [x + 0.01, 0.9, mid], [x, 0.9 - (zEnd - END) * 0.05, zEnd]));
    }
    // the planking: every board its own width, grey and split; some gone, some broken short
    let z = -7.97,
      gone = true;
    while (z < 7.7) {
      const w = R.range(0.2, 0.29);
      const zc = z + w / 2;
      z += w + R.range(0.008, 0.024);
      const far = zc > END;
      if ((far && R.chance(0.72)) || (!far && !gone && zc > -7 && R.chance(0.09))) {
        gone = true;
        continue;
      }
      gone = false;
      const short = !far && R.chance(0.08);
      const len = short ? R.range(1.3, 1.9) : 2.6 + R.range(-0.06, 0.14);
      const g = timber(len, w, 0.045, { rng: R, color: grey(), broken: short || far ? 1 : R.chance(0.15) ? 1 : 0, bow: R.chance(0.3) ? R.range(0.01, 0.03) : 0, rot: R.range(0, 0.3) });
      g.applyMatrix4(FLAT);
      const flip = R.chance(0.5);
      if (flip) g.rotateY(Math.PI);
      xf(g, { r: [R.range(-0.02, 0.02), R.range(-0.012, 0.012), far ? R.range(-0.12, 0.12) : R.range(-0.012, 0.012)], t: [(flip ? 1 : -1) * (short ? HWD : len / 2) + (short ? 0 : R.range(-0.03, 0.03)), TOP - 0.0225 - (far ? R.range(0, 0.05) : 0), zc] });
      b.add(g);
    }
    // a coil of rope left on the boards
    for (let k = 0; k < 3; k++) {
      const t = new THREE.TorusGeometry(0.2 - k * 0.015, 0.022, 3, 9);
      t.rotateX(Math.PI / 2);
      t.translate(0.75, TOP + 0.022 + k * 0.04, -2.6);
      b.add(paint(t, { color: ROPE.clone().multiplyScalar(R.range(0.8, 1.05)), rough: 0.95, mat: MAT.CLOTH }));
    }

    b.boxCollider(0, TOP - 0.13, (END - 8) / 2, HWD, 0.13, (END + 8) / 2);
    return b.build();
  },
  { kind: 'structure' }
);

// ---------------------------------------------------------------------------------------------
// A clinker-built rowing boat, tarred black, oars shipped, a dead lantern on an iron crook at the bow.
// The bow points to +Z. The origin is at the waterline: the keel sits 0.12 below it.
// ---------------------------------------------------------------------------------------------
register(
  'boat',
  (seed) => {
    const R = new Rng(seed * 97 + 41);
    const nz = new Noise(seed * 61 + 8);
    const b = new Builder();
    const HEEL = 0.07,
      DRAFT = 0.12;
    // hull lines. t runs stern (0) to bow (1).
    const zAt = (t) => lerp(-1.92, 2.0, t);
    const beam = (t) => (t < 0.42 ? lerp(0.45, 0.68, sstep(-0.1, 0.42, t)) : 0.68 * (1 - Math.pow((t - 0.42) / 0.58, 2.3)));
    const sheer = (t) => 0.47 + 0.17 * Math.pow(t, 2.6) + 0.05 * Math.pow(1 - t, 2);
    const keel = (t) => 0.05 * Math.pow(2 * t - 1, 2) + (t > 0.86 ? Math.pow((t - 0.86) / 0.14, 2) * (sheer(1) - 0.05) : 0);
    const sect = (t, s) => {
      const B = beam(t),
        K = keel(t),
        S = sheer(t);
      return [B * Math.pow(Math.sin((s * Math.PI) / 2), 0.75), K + (S - K) * Math.pow(s, 1.6)];
    };
    // the hull is written lying on its back axis (length along local Y) so the grain runs with the planks
    const place = new THREE.Matrix4().makeRotationZ(HEEL).multiply(new THREE.Matrix4().makeTranslation(0, -DRAFT, 0));
    const T = new Tris({ mat: MAT.WOOD, rough: 0.78 });
    T.mx = place.clone().multiply(new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)));
    const L = (x, y, zz) => V3(x, -zz, y); // boat space (x, up, z) -> local
    const tar = col('#17130f'),
      worn = col(PAL.woodGrey);
    const cAt = (x, y, zz) => tar.clone().lerp(worn, Math.max(0, Math.min(0.75, nz.fbm3(x * 3, y * 5, zz * 1.5, 3) * 0.9 + (y - 0.3) * 0.5)));
    const NS = 10,
      NK = 4;
    for (const side of [-1, 1]) {
      for (let j = 0; j < NK; j++) {
        T.grain(R);
        for (let i = 0; i < NS - 1; i++) {
          const ta = i / (NS - 1),
            tb = (i + 1) / (NS - 1);
          const lap = 0.014; // each strake's lower edge stands proud of the one below
          const p = (t, s, out) => {
            const [x, y] = sect(t, s);
            return L(side * (x + out), y - out * 0.4, zAt(t));
          };
          const a = p(ta, j / NK, lap),
            c = p(tb, j / NK, lap),
            d = p(tb, (j + 1) / NK, 0),
            e = p(ta, (j + 1) / NK, 0);
          const k = j === NK - 1 ? 1.15 : 1;
          T.quadOut(a, c, d, e, L(side, 0.3, 0), cAt(a.x, a.z, a.y).multiplyScalar(0.7), cAt(c.x, c.z, c.y).multiplyScalar(0.7), cAt(d.x, d.z, d.y).multiplyScalar(k), cAt(e.x, e.z, e.y).multiplyScalar(k));
        }
      }
    }
    // transom
    for (let j = 0; j < NK; j++) {
      const [xa, ya] = sect(0, j / NK),
        [xb, yb] = sect(0, (j + 1) / NK);
      T.quadOut(L(-xa, ya, zAt(0)), L(xa, ya, zAt(0)), L(xb, yb, zAt(0)), L(-xb, yb, zAt(0)), L(0, 0, -1), cAt(xa, ya, -2), cAt(xa, ya, -2), cAt(xb, yb, -2), cAt(xb, yb, -2));
    }
    b.add(T.build());

    const put = (g) => {
      g.applyMatrix4(place);
      return g;
    };
    const wood = (g, c = PAL.woodDark, k = 0.6) => paint(g, { color: mixc(c, '#17130f', k).multiplyScalar(R.range(0.85, 1.1)), rough: 0.85, mat: MAT.WOOD });
    // gunwales, keel and stem
    for (const side of [-1, 1]) {
      const pts = [];
      for (let i = 0; i < NS; i++) {
        const t = i / (NS - 1),
          [x, y] = sect(t, 1);
        pts.push([side * (x + 0.012), y + 0.012, zAt(t)]);
      }
      b.add(put(wood(tube(pts, 0.024, 4, { samples: 14 }), PAL.woodGrey, 0.35)));
    }
    const kp = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      kp.push([0, keel(t) - 0.02 + (t > 0.9 ? 0.05 : 0), zAt(t) + (t > 0.9 ? 0.03 : 0)]);
    }
    b.add(put(wood(tube(kp, 0.03, 4, { samples: 16 }))));
    // ribs
    for (const t of [0.14, 0.3, 0.46, 0.62, 0.78]) {
      const pts = [];
      for (let k = -4; k <= 4; k++) {
        const [x, y] = sect(t, Math.abs(k) / 4);
        pts.push([Math.sign(k) * Math.max(0, x - 0.016), y + 0.014, zAt(t)]);
      }
      b.add(put(wood(tube(pts, 0.014, 3, { samples: 10, caps: false }), PAL.woodGrey, 0.5)));
    }
    // thwarts and stern sheet
    const seats = [
      [0.07, 0.3],
      [0.36, 0.2],
      [0.63, 0.2],
    ];
    const seatY = (t) => sheer(t) - 0.15;
    for (const [t, d] of seats) {
      const w = beam(t) * 2 * Math.pow(Math.sin((0.78 * Math.PI) / 2), 0.75) - 0.02;
      const g = new THREE.BoxGeometry(w, 0.03, d);
      g.translate(0, seatY(t), zAt(t));
      b.add(put(wood(g, PAL.woodGrey, 0.3)));
    }
    // the oars, shipped: lying along the thwarts, blades aft
    for (const side of [-1, 1]) {
      const a = [side * 0.2, seatY(0.36) + 0.04, -1.0],
        e = [side * (0.17 + R.range(0, 0.08)), seatY(0.63) + 0.055 + R.range(0, 0.03), 1.2];
      const shaft = new THREE.CylinderGeometry(0.02, 0.024, dist3(a, e), 6);
      shaft.translate(0, dist3(a, e) / 2, 0);
      b.add(put(aim(wood(shaft, PAL.woodGrey, 0.15), a, e)));
      const blade = new THREE.BoxGeometry(0.11, 0.6, 0.016);
      blade.translate(0, -0.26, 0);
      b.add(put(aim(wood(blade, PAL.woodGrey, 0.2), a, e)));
    }
    // an iron crook stepped in the bow, the lantern hanging dead from it
    const bowY = sheer(0.93),
      bz = zAt(0.93);
    const crook = tube(
      [
        [0, bowY - 0.25, bz],
        [0, bowY + 0.45, bz + 0.02],
        [0, bowY + 0.62, bz + 0.1],
        [0, bowY + 0.6, bz + 0.24],
        [0, bowY + 0.54, bz + 0.27],
      ],
      0.011,
      4,
      { samples: 12 }
    );
    b.add(put(iron(crook, R, 0.35)));
    const lan = lantern(R, { w: 0.12, h: 0.19, rust: 0.35, sway: 0.2 });
    for (const g of lan.geos) {
      g.translate(0, bowY + 0.54, bz + 0.27);
      b.add(put(g));
    }
    // the painter, coiled in the bow and trailing over the side
    b.add(
      put(
        paint(
          tube(
            [
              [0.05, bowY - 0.05, bz - 0.1],
              [0.2, seatY(0.8) - 0.1, zAt(0.8)],
              [beam(0.7) + 0.02, sheer(0.7) + 0.02, zAt(0.7)],
              [beam(0.68) + 0.06, 0.2, zAt(0.66)],
              [beam(0.66) + 0.05, -0.02, zAt(0.63)],
            ],
            0.013,
            4,
            { samples: 14 }
          ),
          { color: ROPE, rough: 0.95, mat: MAT.CLOTH }
        )
      )
    );
    b.boxCollider(0, 0.2, 0, 0.72, 0.36, 2.0);
    return b.build();
  },
  { kind: 'prop' }
);
