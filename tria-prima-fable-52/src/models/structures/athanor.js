// The Athanor: the great furnace in the apse of the chapel. Cold, sooted, patched with iron.
// Stone foot, a brick firebox with an arched mouth facing +Z, an iron-banded brick drum,
// a copper hood and a crooked iron chimney. 3 m wide, 6.5 m tall.
import { Builder, Rng, MAT, PAL, TAU, THREE, paint, box, cyl, tube, lathe, torus, dome, rock, merge } from '../kit.js';
import { register } from '../registry.js';
import { Mesher, makeStone, wall, wallFrame, archRing, blockBox, blockCyl, rubble, hoop, rivets, bar, ironSpec, copperSpec, brassSpec, stoneSpec, glyph } from './_shared.js';

const MOUTH_Y = 1.2; // centre of the firebox mouth
const MOUTH_W = 0.7;
const FRONT = 1.25; // z of the firebox front

register(
  'athanor',
  () => {
    const b = new Builder();
    const R = new Rng(907);
    // smoke has licked out of the mouth and up the front for a very long time
    const sootFront = (x, y) => {
      const dx = Math.abs(x - 1.24);
      return Math.max(0, 1 - dx / 0.8) * Math.max(0, Math.min(1, (y - 0.95) / 0.45)) * Math.max(0.3, 1 - (y - 1.6) / 1.7) * 0.85;
    };
    const stFoot = makeStone({ seed: 51, moss: 0.3, lichen: 0.2, damp: 0.5, dark: 0.8 });
    const BRICK = '#4c3530'; // old fire-brick: more soot than red
    const brickFront = makeStone({ seed: 52, base: BRICK, moss: 0.04, lichen: 0, damp: 0.2, warm: 0, vary: 0.85, dark: 0.82, soot: sootFront, streak: 0.9 });
    const brickSide = makeStone({ seed: 53, base: BRICK, moss: 0.08, lichen: 0, damp: 0.2, warm: 0, vary: 0.85, dark: 0.82, soot: (x, y) => 0.08 + Math.max(0, (y - 3.6) / 1.6) * 0.6, streak: 0.9 });
    const stSoot = makeStone({ seed: 54, base: '#16130f', moss: 0, lichen: 0, damp: 0, warm: 0, vary: 0.3, streak: 0 });
    const stDress = makeStone({ seed: 55, base: PAL.stoneLight, moss: 0.05, lichen: 0.1, damp: 0, dark: 0.5, vary: 0.5, soot: (x, y) => (y > 1.2 ? 0.55 : 0.2) });
    const dress = (i, k = 0.6) => stoneSpec(PAL.stoneLight, i * 2.3 + 0.7, k);

    // ---------------------------------------------------------------- foot
    b.add(blockBox(3.0, 1.0, 3.0, { y0: -1.0, courseH: 1.0, blockL: 1.3, top: false, seed: 61, stone: stFoot }));
    b.add(blockBox(3.0, 0.42, 3.0, { y0: 0, courseH: 0.42, blockL: 0.85, top: true, seed: 62, stone: stFoot }));
    b.add(blockBox(2.74, 0.38, 2.74, { y0: 0.42, courseH: 0.38, blockL: 0.7, top: true, seed: 63, stone: stFoot }));

    // ---------------------------------------------------------------- firebox (brick)
    b.add(blockBox(2.5, 1.65, 2.5, { y0: 0.8, sides: [0, 1, 1, 1], top: false, courseH: 0.165, blockL: 0.4, seed: 64, stone: brickSide, bulge: 0.008 }));
    for (const [sx, sz] of [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ])
      b.add(blockBox(0.44, 1.65, 0.44, { y0: 0.8, at: [sx * 1.12, 0, sz * 1.12], courseH: 0.33, blockL: 0.5, top: false, seed: 70 + sx + sz * 3, stone: stFoot, bulge: 0.02 }));
    const F = wallFrame(-1.24, FRONT - 0.2, 1.24, FRONT - 0.2);
    const fw = wall({
      length: 2.48,
      thick: 0.4,
      top: () => 2.46,
      base: 0.8,
      courseH: 0.165,
      blockL: 0.4,
      openings: [{ x: 1.24, w: MOUTH_W, y0: 0.85, y1: MOUTH_Y, k: 0.5, margin: 0.12 }],
      seed: 65,
      stone: brickFront,
      stoneIn: stSoot,
      broken: 0,
      pockets: 0.04,
      wobble: 0,
      key: 0,
      bulge: 0.008,
    });
    const ring = archRing({ cx: 1.24, w: MOUTH_W, k: 0.5, spring: MOUTH_Y, depth: 0.2, thick: 0.46, zc: 0.02, seed: 66, stone: stDress, n: 4, key: 0 });
    b.add(F.place(merge(fw.geo, ring)));
    const jambs = [];
    for (const s of [-1, 1]) {
      const j = box(0.2, 0.36, 0.46);
      j.translate(s * 0.45, 1.03, FRONT - 0.18);
      jambs.push(paint(j, {}));
    }
    const hearth = box(1.04, 0.1, 0.76, 0.015, 1);
    hearth.translate(0, 0.8, 1.16);
    jambs.push(paint(hearth, {}));
    b.add(paint(merge(jambs), dress(1, 0.36)));

    // the inside of the firebox: a black chamber behind the mouth
    {
      const M = new Mesher();
      const c0 = new THREE.Color('#0b0a09'),
        c1 = new THREE.Color('#1d1916');
      const X0 = -0.62,
        X1 = 0.62,
        Y0 = 0.85,
        Y1 = 1.95,
        Z0 = 0.12,
        Z1 = 0.86;
      M.face([X0, Y0, Z0], [X1, Y0, Z0], [X1, Y1, Z0], [X0, Y1, Z0], [0, 0, 1], c0);
      M.face([X0, Y0, Z0], [X0, Y0, Z1], [X0, Y1, Z1], [X0, Y1, Z0], [1, 0, 0], c0);
      M.face([X1, Y0, Z0], [X1, Y0, Z1], [X1, Y1, Z1], [X1, Y1, Z0], [-1, 0, 0], c0);
      M.face([X0, Y0, Z0], [X1, Y0, Z0], [X1, Y0, Z1], [X0, Y0, Z1], [0, 1, 0], c1);
      M.face([X0, Y1, Z0], [X1, Y1, Z0], [X1, Y1, Z1], [X0, Y1, Z1], [0, -1, 0], c0);
      b.add(M.build({ rough: 1 }));
      // iron fire bars across the bottom of the mouth
      const bars = [];
      for (let i = 0; i < 5; i++) {
        const g = box(0.022, 0.2, 0.022);
        g.translate(-0.24 + i * 0.12, 0.95, FRONT - 0.3);
        bars.push(paint(g, {}));
      }
      const rail = box(0.7, 0.03, 0.03);
      rail.translate(0, 1.04, FRONT - 0.3);
      bars.push(paint(rail, {}));
      b.add(paint(merge(bars), ironSpec(0.8, 2)));
    }

    // the coal bed: dead and grey (the game lights it)
    {
      const lumps = [];
      const bed = dome(0.4, 9, 2, 0.22);
      bed.scale(0.85, 1, 1.05);
      bed.translate(0, 0.85, 0.6);
      lumps.push(paint(bed, { color: '#3b3835', rough: 1, mat: MAT.STONE }));
      const tones = ['#2a2725', '#454240', '#1c1a19', '#56524e', '#33302d'];
      for (let i = 0; i < 18; i++) {
        const a = R.range(0, TAU),
          d = Math.sqrt(R.next()) * 0.34;
        const r = R.range(0.045, 0.085);
        const g = rock(r, { seed: 300 + i, detail: 0, rough: 0.3, squash: [1, 0.72, 1], facet: true });
        g.translate(Math.sin(a) * d * 0.85, 0.85 + 0.03 + 0.09 * (1 - d / 0.34) + r * 0.3, 0.6 + Math.cos(a) * d);
        lumps.push(paint(g, { color: R.pick(tones), rough: 1, mat: MAT.STONE }));
      }
      b.part('coals', merge(lumps));
      const ash = dome(0.15, 8, 2, 0.2);
      ash.scale(1.5, 1, 0.8);
      ash.translate(0.1, 0.85, 1.36);
      b.add(paint(ash, { color: '#34312e', rough: 1, mat: MAT.STONE }));
    }

    // ---------------------------------------------------------------- the three signs, cut in a stone band over the mouth
    {
      const names = ['sulfur', 'mercury', 'salt'];
      names.forEach((n, i) => {
        const w = [0.56, 0.6, 0.54][i];
        const x = -0.585 + i * 0.585;
        const st = box(w, 0.4 + (i === 1 ? 0.04 : 0), 0.12, 0.014, 1);
        st.translate(x, 2.1 + (i === 1 ? 0.02 : 0), FRONT + 0.03);
        b.add(paint(st, dress(4 + i * 3, [0.36, 0.42, 0.33][i])));
        const g = glyph(n, 0.25, { width: 0.09, depth: 0.014, color: '#070605' });
        g.translate(x, 2.1 + (i === 1 ? 0.02 : 0), FRONT + 0.084);
        b.add(g);
      });
    }

    // ---------------------------------------------------------------- the cradle: an iron claw at chest height, right of the mouth
    const PZ = 1.34; // front face of the corner piers
    const SX = 1.1,
      SY = 1.42,
      SZ = PZ + 0.3;
    {
      const parts = [];
      const plate = box(0.2, 0.36, 0.024);
      plate.translate(SX, SY - 0.04, PZ + 0.012);
      parts.push(plate);
      for (const dy of [0.1, -0.18]) {
        const bolt = cyl(0.022, 0.022, 0.03, 6);
        bolt.rotateX(Math.PI / 2);
        bolt.translate(SX, SY - 0.04 + dy + 0.04, PZ + 0.03);
        parts.push(bolt);
      }
      parts.push(
        tube(
          [
            [SX, SY - 0.12, PZ + 0.02],
            [SX, SY - 0.15, PZ + 0.16],
            [SX, SY - 0.1, SZ - 0.04],
            [SX, SY - 0.045, SZ],
          ],
          0.022,
          5,
          { samples: 8 }
        )
      );
      parts.push(
        tube(
          [
            [SX, SY - 0.26, PZ + 0.02],
            [SX, SY - 0.18, PZ + 0.14],
          ],
          0.014,
          4
        )
      );
      const dish = lathe(
        [
          [0, -0.05],
          [0.045, -0.045],
          [0.075, -0.012],
          [0.082, 0.0, 'hard'],
          [0.07, 0.0, 'hard'],
          [0.04, -0.03],
          [0, -0.034],
        ],
        10
      );
      dish.translate(SX, SY, SZ);
      parts.push(dish);
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + (i / 4) * TAU;
        const sx = Math.sin(a),
          cz = Math.cos(a);
        parts.push(
          tube(
            [
              [SX + sx * 0.074, SY - 0.01, SZ + cz * 0.074],
              [SX + sx * 0.088, SY + 0.05, SZ + cz * 0.088],
              [SX + sx * 0.07, SY + 0.1, SZ + cz * 0.07],
              [SX + sx * 0.04, SY + 0.125, SZ + cz * 0.04],
            ],
            (t) => 0.011 - 0.007 * t,
            4,
            { samples: 6 }
          )
        );
      }
      b.add(paint(merge(parts.map((g) => paint(g, {}))), ironSpec(0.55, 7, 14)));
    }

    // ---------------------------------------------------------------- the gauge: brass, its face cracked, the needle dead
    const GX = -1.1,
      GY = 1.52;
    {
      const body = cyl(0.17, 0.17, 0.08, 14);
      body.rotateX(Math.PI / 2);
      body.translate(GX, GY, PZ + 0.04);
      const rim = torus(0.165, 0.02, 5, 14);
      rim.rotateX(Math.PI / 2);
      rim.translate(GX, GY, PZ + 0.082);
      b.add(paint(merge(paint(body, {}), paint(rim, {})), brassSpec(3)));
      const face = new THREE.CircleGeometry(0.15, 14);
      face.translate(GX, GY, PZ + 0.083);
      b.add(paint(face, { color: '#7d745c', rough: 0.6, mat: MAT.PLAIN }));
      const marks = [];
      for (let i = 0; i < 9; i++) {
        const a = -2.2 + (i / 8) * 4.4;
        const t = box(0.008, i % 4 === 0 ? 0.035 : 0.02, 0.002);
        t.translate(0, 0.118, 0);
        t.rotateZ(-a);
        t.translate(GX, GY, PZ + 0.085);
        marks.push(paint(t, {}));
      }
      const needle = box(0.009, 0.125, 0.003);
      needle.translate(0, 0.045, 0);
      needle.rotateZ(2.05);
      needle.translate(GX, GY, PZ + 0.088);
      marks.push(paint(needle, {}));
      // the crack
      const crack = [
        [-0.13, 0.07],
        [-0.06, 0.03],
        [-0.03, -0.04],
        [0.04, -0.05],
        [0.07, -0.11],
      ];
      for (let i = 0; i < crack.length - 1; i++) {
        const [x0, y0] = crack[i],
          [x1, y1] = crack[i + 1];
        const g = box(Math.hypot(x1 - x0, y1 - y0) + 0.004, 0.006, 0.002);
        g.rotateZ(Math.atan2(y1 - y0, x1 - x0));
        g.translate(GX + (x0 + x1) / 2, GY + (y0 + y1) / 2, PZ + 0.086);
        marks.push(paint(g, {}));
      }
      const hub = cyl(0.016, 0.016, 0.012, 6);
      hub.rotateX(Math.PI / 2);
      hub.translate(GX, GY, PZ + 0.09);
      marks.push(paint(hub, {}));
      b.add(paint(merge(marks), { color: '#14110e', rough: 0.7, mat: MAT.PLAIN }));
      // its pipes
      const pipes = [
        tube(
          [
            [GX, GY + 0.16, PZ + 0.05],
            [GX, GY + 0.3, PZ + 0.07],
            [GX - 0.03, 2.15, PZ + 0.07],
            [GX - 0.03, 2.34, PZ - 0.03],
          ],
          0.028,
          6,
          { samples: 8 }
        ),
        tube(
          [
            [GX, GY - 0.16, PZ + 0.05],
            [GX + 0.02, 1.1, PZ + 0.07],
            [GX + 0.02, 0.95, PZ + 0.06],
            [GX + 0.02, 0.84, PZ - 0.05],
          ],
          0.028,
          6,
          { samples: 8 }
        ),
      ];
      b.add(paint(merge(pipes.map((g) => paint(g, {}))), copperSpec(0.6, 4, { yLo: 0.8, yHi: 2.5 })));
    }

    // ---------------------------------------------------------------- cornice and drum
    b.add(blockBox(2.78, 0.2, 2.78, { y0: 2.45, courseH: 0.2, blockL: 0.72, top: true, bottom: true, seed: 67, stone: stFoot }));
    const DR = 1.08,
      DY = 2.65,
      DH = 2.0;
    b.add(blockCyl(DR, { y0: DY, seg: 16, per: 1, round: true, top: DH, courseH: 0.2, seed: 68, stone: brickSide, bulge: 0.01 }));
    {
      const flat = DR * Math.cos(Math.PI / 16);
      const iron = [];
      for (const y of [DY + 0.14, DY + 0.95, DY + 1.8]) {
        const h = hoop(DR + 0.004, 0.11, { t: 0.022, seg: 16, y });
        h.rotateY(Math.PI / 16);
        iron.push(h, rivets(flat + 0.03, y, 16, { size: 0.022 }));
      }
      for (let i = 0; i < 4; i++) {
        const s = box(0.08, DH - 0.2, 0.018);
        s.translate(0, DY + DH / 2, flat + 0.012);
        s.rotateY(Math.PI / 4 + (i * Math.PI) / 2);
        iron.push(paint(s, ironSpec(0.7, i + 1)));
      }
      // a small charging hatch in the drum
      const hatch = [];
      const door = box(0.34, 0.46, 0.03);
      door.translate(0, DY + 1.38, flat + 0.02);
      hatch.push(door);
      for (const dy of [-0.14, 0.14]) {
        const hg = box(0.14, 0.04, 0.02);
        hg.translate(-0.17, DY + 1.38 + dy, flat + 0.04);
        hatch.push(hg);
      }
      const hr = torus(0.045, 0.01, 4, 8);
      hr.rotateX(Math.PI / 2);
      hr.translate(0.09, DY + 1.34, flat + 0.045);
      hatch.push(hr);
      iron.push(paint(merge(hatch.map((g) => paint(g, {}))), ironSpec(0.75, 9)));
      b.add(iron);
    }

    // ---------------------------------------------------------------- hood and chimney
    {
      const hood = lathe(
        [
          [DR + 0.09, DY + DH - 0.03, 'hard'],
          [DR + 0.09, DY + DH + 0.05, 'hard'],
          [0.98, DY + DH + 0.16],
          [0.66, DY + DH + 0.52],
          [0.42, DY + DH + 0.86],
          [0.36, DY + DH + 1.0],
        ],
        16
      );
      hood.rotateY(Math.PI / 16);
      b.add(paint(hood, copperSpec(0.62, 3, { yLo: DY + DH, yHi: DY + DH + 1.6, f: 2.6 })));
      b.add(rivets((DR + 0.09) * Math.cos(Math.PI / 16) + 0.01, DY + DH + 0.01, 16, { size: 0.02 }));
      const y0 = DY + DH + 0.96; // 5.61
      const ch = lathe(
        [
          [0.39, y0, 'hard'],
          [0.39, y0 + 0.09, 'hard'],
          [0.3, y0 + 0.09, 'hard'],
          [0.3, y0 + 0.55],
          [0.33, y0 + 0.55, 'hard'],
          [0.33, y0 + 0.64, 'hard'],
          [0.3, y0 + 0.64, 'hard'],
          [0.3, 6.42],
          [0.37, 6.5, 'hard'],
          [0.3, 6.5, 'hard'],
          [0.25, 6.2],
        ],
        12
      );
      ch.translate(0, -y0, 0);
      ch.rotateZ(0.04);
      ch.rotateX(-0.025);
      ch.translate(0, y0, 0);
      b.add(paint(ch, ironSpec(0.8, 11, 3)));
      const dark = new THREE.CircleGeometry(0.26, 10).rotateX(-Math.PI / 2);
      dark.translate(-0.025, 6.22, -0.015);
      b.add(paint(dark, { color: '#050505', rough: 1, mat: MAT.PLAIN }));
    }

    // ---------------------------------------------------------------- plumbing: a feed pipe with a valve, a copper still-pot
    {
      const px = DR + 0.24;
      const pipe = tube(
        [
          [DR - 0.05, DY + 1.6, 0.25],
          [px - 0.06, DY + 1.62, 0.25],
          [px, DY + 1.45, 0.25],
          [px, DY + 0.5, 0.25],
          [px - 0.04, DY + 0.16, 0.25],
          [px - 0.12, DY - 0.02, 0.25],
        ],
        0.048,
        7,
        { samples: 14 }
      );
      const collars = [];
      for (const y of [DY + 1.3, DY + 0.55]) {
        const c = cyl(0.062, 0.062, 0.05, 7);
        c.translate(px, y, 0.25);
        collars.push(paint(c, {}));
      }
      b.add(paint(merge(paint(pipe, {}), ...collars), copperSpec(0.55, 6, { yLo: DY, yHi: DY + 1.7 })));
      // the valve wheel
      const wheel = [];
      const rim = torus(0.115, 0.014, 4, 10);
      rim.rotateZ(Math.PI / 2);
      wheel.push(rim);
      for (const a of [0, Math.PI / 2]) {
        const sp = box(0.012, 0.22, 0.012);
        sp.rotateX(a);
        wheel.push(sp);
      }
      const stem = box(0.12, 0.022, 0.022);
      stem.translate(-0.06, 0, 0);
      wheel.push(stem);
      const wg = merge(wheel.map((g) => paint(g, {})));
      wg.rotateX(0.5);
      wg.translate(px + 0.13, DY + 0.95, 0.25);
      b.add(paint(wg, ironSpec(0.7, 13, 12)));

      // still-pot on the left flank
      const tx = -(DR + 0.2);
      const pot = lathe(
        [
          [0, 0],
          [0.17, 0.01],
          [0.26, 0.12],
          [0.28, 0.3],
          [0.25, 0.5],
          [0.15, 0.66],
          [0.07, 0.72],
          [0.07, 0.8],
        ],
        10
      );
      pot.translate(tx, DY + 0.5, -0.1);
      const neck = tube(
        [
          [tx, DY + 1.28, -0.1],
          [tx + 0.01, DY + 1.5, -0.1],
          [tx + 0.14, DY + 1.66, -0.1],
          [tx + 0.34, DY + 1.68, -0.1],
        ],
        0.05,
        6,
        { samples: 8 }
      );
      b.add(paint(merge(paint(pot, {}), paint(neck, {})), copperSpec(0.7, 8, { yLo: DY + 0.5, yHi: DY + 1.7 })));
      const brk = [];
      const shelfB = box(0.5, 0.03, 0.4);
      shelfB.translate(tx + 0.06, DY + 0.49, -0.1);
      brk.push(shelfB);
      brk.push(
        tube(
          [
            [tx - 0.16, DY + 0.48, -0.1],
            [tx + 0.2, DY + 0.1, -0.1],
          ],
          0.016,
          4
        )
      );
      const strap = torus(0.285, 0.012, 4, 12);
      strap.translate(tx, DY + 0.82, -0.1);
      brk.push(strap);
      b.add(paint(merge(brk.map((g) => paint(g, {}))), ironSpec(0.75, 15, 8)));
    }

    // ---------------------------------------------------------------- what has fallen off it
    {
      // the firebox door, off its hinges, leaning on the foot
      const door = [];
      const leaf = box(0.72, 0.8, 0.03);
      door.push(leaf);
      for (const y of [-0.24, 0.22]) {
        const st = box(0.78, 0.06, 0.012);
        st.translate(0.03, y, 0.02);
        door.push(st);
      }
      const latch = torus(0.05, 0.01, 4, 8);
      latch.rotateX(Math.PI / 2);
      latch.translate(-0.22, 0, 0.03);
      door.push(latch);
      const dg = merge(door.map((g) => paint(g, {})));
      dg.translate(0, 0.4, 0);
      dg.rotateX(-0.42);
      dg.rotateY(0.25);
      dg.translate(-0.92, 0.0, 1.72);
      b.add(paint(dg, ironSpec(0.6, 17, 4)));
      const br = rubble(R, 7, 0.55, brickSide, { size: [0.14, 0.26] });
      br.translate(1.25, 0, 1.85);
      b.add(br);
    }

    b.boxCollider(0, -0.1, 0, 1.5, 0.9, 1.5);
    b.boxCollider(0, 1.72, 0, 1.3, 0.93, 1.3);
    b.cylCollider(0, 3.95, 0, DR + 0.06, 2.6);
    b.cylCollider(0, 5.9, 0, 0.38, 1.3);
    b.anchor('mouth', 0, MOUTH_Y, FRONT);
    b.anchor('socket', SX, SY, SZ);
    b.anchor('chimney', 0, 6.5, 0);
    b.anchor('front', 0, 0, 3.5);
    return b.build();
  },
  { kind: 'structure', variants: 1, mouth: { width: MOUTH_W, height: 0.7, depth: 1.1 } }
);
