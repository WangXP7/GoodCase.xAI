// The Chapel of the Athanor: a roofless gothic ruin on a knoll. The player's home, the first thing
// they walk to and the last thing they see. Built stone by stone so the ruin can lose them.
//
// Layout (model space, +Z = south = the door):
//   nave   inside x -4.5..4.5, z -6.8..13.2, floor at y = 0.3
//   apse   half an octagon north of the chancel arch (z = -6.8), floor at y = 0.45
//   walls  0.9 thick, door 2.2 wide in the south wall, stair turret at the south-west corner
import { Builder, Rng, Noise, MAT, PAL, TAU, THREE, paint, xf, box, cyl, tube, lathe, torus, dome, merge } from '../kit.js';
import { register } from '../registry.js';
import {
  Mesher,
  makeStone,
  wall,
  wallFrame,
  wallColliders,
  profile,
  archRing,
  archPoint,
  openApex,
  blockBox,
  blockCyl,
  paving,
  looseStone,
  rubble,
  plank,
  strut,
  bar,
  chain,
  ironSpec,
  stoneSpec,
  copperSpec,
  bronzeSpec,
} from './_shared.js';

const FY = 0.3; // nave floor
const FA = 0.45; // apse floor, one step up
const T = 0.9; // wall thickness
const HW = 4.5; // half the inside width
const ZS = 13.2; // inner face of the south (door) wall
const ZN = -6.8; // the chancel arch
const TAN = Math.tan(Math.PI / 8);
const OCT = HW * TAN;
const ZC = ZN - OCT; // centre of the apse octagon
const AC = HW + T / 2; // apothem of the wall centreline
const SC = AC * TAN;
const EXT = (T / 2) * TAN;
const _c1 = new THREE.Color();

/** A stepped buttress in a wall's frame, standing out from z = z0. hTop = how high the wall still stands there. */
function buttress(M, x, z0, hTop, seed, st, { w = 0.95, k = 1 } = {}) {
  const R = new Rng(seed * 97 + 1);
  const stages = [
    [0, 3.3 * k, 1.25],
    [3.3 * k, 6.1 * k, 0.92],
    [6.1 * k, 8.0 * k, 0.56],
  ];
  blockBox(w + 0.12, 2, stages[0][2] + 0.06, { y0: -2, at: [x, 0, z0 + stages[0][2] / 2 + 0.03], sides: [1, 1, 0, 1], top: true, seed: seed * 5 + 9, stone: st, M, build: false, courseH: 2, blockL: 1.0 });
  for (let i = 0; i < stages.length; i++) {
    const [ya, yb, dep] = stages[i];
    if (hTop + 0.25 < ya) break;
    const cut = hTop + R.range(-0.15, 0.3) < yb;
    const y1 = cut ? Math.max(ya + 0.4, Math.min(yb, hTop + R.range(-0.4, 0.15))) : yb;
    blockBox(w, y1 - ya, dep, { y0: ya, at: [x, 0, z0 + dep / 2], sides: [1, 1, 0, 1], top: cut, seed: seed * 5 + i, stone: st, M, build: false, courseH: 0.44, blockL: 0.8 });
    if (cut) break;
    const depN = i < stages.length - 1 ? stages[i + 1][2] : 0;
    const sl = (dep - depN) * (i < stages.length - 1 ? 0.85 : 1.3);
    const zf = z0 + dep,
      zb = z0 + depN,
      xl = x - w / 2,
      xr = x + w / 2;
    st.top(R, x, yb, z0, _c1);
    M.face([xl, yb, zf], [xr, yb, zf], [xr, yb + sl, zb], [xl, yb + sl, zb], [0, 0.7, 0.7], _c1);
    M.tri([xl, yb, zf], [xl, yb + sl, zb], [xl, yb, zb], [-1, 0, 0], _c1);
    M.tri([xr, yb, zf], [xr, yb + sl, zb], [xr, yb, zb], [1, 0, 0], _c1);
  }
}

/** What is left of a window's stone tracery: a mullion and two branches, mostly stumps. Wall frame. */
function tracery(op, topFn, R) {
  const out = [];
  const apex = openApex(op);
  const hL = topFn(op.x - op.w / 2 - 0.2),
    hR = topFn(op.x + op.w / 2 + 0.2),
    hC = topFn(op.x);
  const whole = hC > apex + 0.3 && hL > apex && hR > apex;
  const span = op.y1 - op.y0;
  const full = whole && R.chance(0.4);
  const mullH = full ? span : Math.min(Math.max(0.2, Math.min(hL, hR) - op.y0), span * R.range(0.18, 0.55));
  const lights = op.big ? [-0.5, 0.5] : [0];
  const Rr = op.k * op.w;
  const bars = [];
  for (const u of lights) {
    const mx = op.x + u * (op.w / 3) * (op.big ? 1 : 0);
    const mh = op.big && u > 0 ? Math.min(mullH, span * 0.35) : mullH;
    bars.push(
      tube(
        [
          [mx, op.y0, 0],
          [mx + R.range(-0.01, 0.01), op.y0 + mh, 0],
        ],
        op.big ? 0.11 : 0.078,
        4
      )
    );
  }
  if (whole && !op.big) {
    for (const s of [1, -1]) {
      const pts = [];
      const A = Math.acos((Rr - op.w / 2) / Rr);
      for (let i = 0; i <= 12; i++) {
        const t = (i / 12) * 1.4;
        const x = op.x + s * (Rr - Rr * Math.cos(A * t)),
          y = op.y1 + Rr * Math.sin(A * t);
        const cxr = op.x - s * (Rr - op.w / 2);
        if ((x - cxr) * (x - cxr) + (y - op.y1) * (y - op.y1) > Rr * Rr) break;
        pts.push([x, y, 0]);
      }
      if (pts.length < 3) continue;
      const use = full ? pts : pts.slice(Math.floor(pts.length * R.range(0.5, 0.75)));
      if (use.length >= 2) bars.push(tube(use, 0.06, 4, { samples: Math.max(2, use.length) }));
    }
  }
  if (bars.length) out.push(paint(merge(bars), stoneSpec(PAL.stoneLight, op.x * 1.7, 0.8)));
  // iron saddle bars
  const hJ = Math.min(hL, hR);
  for (const f of op.big ? [] : [0.34, 0.72]) {
    const y = op.y0 + span * f;
    if (y < hJ - 0.2 && R.chance(0.8)) {
      out.push(
        bar(
          [
            [op.x - op.w / 2 - 0.03, y, 0],
            [op.x + op.w / 2 + 0.03, y + R.range(-0.02, 0.02), 0],
          ],
          0.014,
          { rust: 0.8, seed: op.x }
        )
      );
    }
  }
  return out;
}

/** The portal around the door, in the south wall's frame (door centre at x = 5.4). */
function portal(st) {
  const out = [];
  const sp = FY + 2.5;
  out.push(archRing({ cx: 5.4, w: 2.92, k: 2.56 / 2.92, spring: sp, depth: 0.27, thick: 0.36, zc: T / 2 + 0.06, seed: 77, stone: st, n: 8 }));
  const hood = [];
  for (const s of [1, -1]) {
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const p = archPoint(5.4, 3.56, 2.88 / 3.56, sp, i / 8, s);
      pts.push([p[0], p[1], T / 2 + 0.22]);
    }
    hood.push(tube(pts, 0.055, 5, { samples: 10 }));
  }
  const dress = [merge(hood)];
  for (const s of [1, -1]) {
    const x = 5.4 + s * 1.28,
      z = T / 2 + 0.12;
    const sh = cyl(0.095, 0.105, 2.08, 8);
    sh.translate(x, FY + 0.22 + 1.04, z);
    const cap = lathe(
      [
        [0.105, 0],
        [0.13, 0.05],
        [0.2, 0.18, 'hard'],
        [0.215, 0.18, 'hard'],
        [0.215, 0.26, 'hard'],
        [0.1, 0.26],
      ],
      8
    );
    cap.translate(x, sp - 0.24, z);
    const base = lathe(
      [
        [0.19, 0],
        [0.19, 0.1, 'hard'],
        [0.115, 0.24],
      ],
      8
    );
    base.translate(x, FY - 0.02, z);
    const pier = box(0.3, 2.5, 0.4);
    pier.translate(5.4 + s * 1.6, FY + 1.25, T / 2 + 0.04);
    dress.push(sh, cap, base, pier);
  }
  out.push(paint(merge(dress.map((g) => paint(g, {}))), stoneSpec(PAL.stoneLight, 7.7, 0.82)));
  return out;
}

/** A door leaf of oak planks: hinge edge on x = 0, standing on y = 0, `w` wide. */
function doorLeaf(R, w, h, { char = 0 } = {}) {
  const out = [];
  const n = 5,
    pw = w / n;
  for (let i = 0; i < n; i++) {
    const ph = h * (char > 0.3 ? R.range(0.55, 1) : R.range(0.93, 1));
    const p = plank(ph, pw - 0.008, 0.07, { seed: R.int(1, 9999), tone: PAL.woodDark, char: char * R.range(0.5, 1), worn: 0.5 });
    p.translate(pw * (i + 0.5), 0, 0);
    out.push(p);
  }
  for (const y of [0.35, h * 0.52, h * 0.86]) {
    const s = paint(box(w * 0.94, 0.075, 0.014), ironSpec(0.7, y));
    s.translate(w * 0.48, y, 0.042);
    out.push(s);
  }
  const ring = torus(0.07, 0.012, 4, 10);
  ring.rotateX(Math.PI / 2);
  ring.translate(w * 0.82, h * 0.47, 0.06);
  out.push(paint(ring, ironSpec(0.6, 2)));
  return merge(out);
}

register(
  'chapel',
  () => {
    const b = new Builder();
    const R = new Rng(4242);
    const nzS = new Noise(5);
    const sootIn = (x, y) => Math.min(1, Math.max(0, (y - 5.5) / 4)) * (0.12 + 0.3 * (nzS.fbm2(x * 0.5, y * 0.4, 2) * 0.5 + 0.5));
    const stOut = makeStone({ seed: 11, moss: 0.65, lichen: 0.5, damp: 0.45 });
    const stIn = makeStone({ seed: 12, moss: 0.2, lichen: 0.06, damp: 0.5, dark: 0.9, soot: sootIn, y0: FY });
    const stDress = makeStone({ seed: 13, moss: 0.25, lichen: 0.35, damp: 0.2, warm: 0.34, base: PAL.stoneLight, vary: 0.55, dark: 0.9 });
    const stFloor = makeStone({ seed: 14, moss: 0.3, lichen: 0.04, damp: 0, dark: 0.8, warm: 0.26 });
    const dressSpec = (i) => stoneSpec(PAL.stoneLight, i * 3.1 + 1, 0.66);

    // ------------------------------------------------------------------ outer walls
    const WIN = (x, o = {}) => ({ x, w: 1.3, y0: 3.0, y1: 5.9, k: 1.25, ...o });
    const zE = ZC - SC - EXT; // north end of the long walls
    const vE = [AC, ZC - SC],
      vNE = [SC, ZC - AC],
      vNW = [-SC, ZC - AC],
      vW = [-AC, ZC - SC];
    const ext = (p, q) => {
      const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const ux = (q[0] - p[0]) / l,
        uz = (q[1] - p[1]) / l;
      return [
        [p[0] - ux * EXT, p[1] - uz * EXT],
        [q[0] + ux * EXT, q[1] + uz * EXT],
      ];
    };
    const apseL = Math.hypot(vNE[0] - vE[0], vNE[1] - vE[1]) + 2 * EXT;
    const AW = (o = {}) => [WIN(apseL / 2, { w: 1.2, y0: 3.2, ...o })];
    const defs = [
      {
        id: 'south',
        ab: [
          [-(HW + T), ZS + T / 2],
          [HW + T, ZS + T / 2],
        ],
        seed: 21,
        inner: FY,
        top: profile(
          [
            [0, 9.4],
            [1.5, 10.3],
            [3.5, 11.9],
            [4.9, 12.6],
            [5.6, 11.4],
            [6.4, 9.2],
            [7.4, 7.9],
            [8.6, 6.6],
            [10.8, 6.2],
          ],
          { jag: 0.4, seed: 21 }
        ),
        openings: [
          { x: 5.4, w: 2.2, y0: FY, y1: FY + 2.5, k: 1, door: true },
          { x: 5.4, w: 3.0, y0: 5.6, y1: 7.7, k: 1, big: true },
        ],
        butt: [2.75, 8.05],
      },
      {
        id: 'east',
        ab: [
          [AC, ZS + 0.05],
          [AC, zE],
        ],
        seed: 22,
        inner: FY,
        top: profile(
          [
            [0, 8.6],
            [3.5, 9.1],
            [5.8, 8.8],
            [7.0, 6.4],
            [8.4, 5.2],
            [9.6, 7.0],
            [10.8, 9.0],
            [16, 9.1],
            [19, 8.7],
            [21.5, 9.0],
            [24.2, 8.6],
          ],
          { jag: 0.35, seed: 22 }
        ),
        openings: [2.55, 7.55, 12.55, 17.55].map((x) => WIN(x)),
        butt: [5.05, 10.05, 15.05, 20.05],
      },
      {
        id: 'west',
        ab: [
          [-AC, zE],
          [-AC, ZS + 0.05],
        ],
        seed: 23,
        inner: FY,
        top: profile(
          [
            [0, 8.7],
            [4, 8.9],
            [6.0, 8.2],
            [8.2, 6.3],
            [9.6, 4.2],
            [10.6, 2.9],
            [12.6, 2.5],
            [14.0, 3.4],
            [15.2, 5.2],
            [16.2, 7.6],
            [18, 8.6],
            [24.2, 9.0],
          ],
          { jag: 0.35, seed: 23 }
        ),
        openings: [6.6, 11.6, 16.6, 21.6].map((x) => WIN(x)),
        butt: [4.1, 9.1, 14.1, 19.1],
      },
      {
        id: 'ne',
        ab: ext(vE, vNE),
        seed: 24,
        inner: FA,
        top: profile(
          [
            [0, 8.8],
            [2.2, 8.3],
            [4.5, 8.6],
          ],
          { jag: 0.3, seed: 24 }
        ),
        openings: AW(),
        butt: [],
      },
      {
        id: 'north',
        ab: ext(vNE, vNW),
        seed: 25,
        inner: FA,
        top: profile(
          [
            [0, 8.6],
            [1.5, 7.7],
            [2.4, 7.0],
            [3.3, 7.8],
            [4.5, 8.7],
          ],
          { jag: 0.3, seed: 25 }
        ),
        openings: AW(),
        butt: [],
      },
      {
        id: 'nw',
        ab: ext(vNW, vW),
        seed: 26,
        inner: FA,
        top: profile(
          [
            [0, 8.7],
            [2.5, 8.9],
            [4.5, 8.7],
          ],
          { jag: 0.3, seed: 26 }
        ),
        openings: AW(),
        butt: [],
      },
    ];
    for (const D of defs) {
      const F = wallFrame(D.ab[0][0], D.ab[0][1], D.ab[1][0], D.ab[1][1]);
      const W = wall({
        length: F.len,
        thick: T,
        top: D.top,
        base: -2,
        foundation: 2,
        plinth: { h: 0.62, out: 0.13 },
        openings: D.openings,
        seed: D.seed,
        stone: stOut,
        stoneIn: stIn,
        innerFrom: D.inner,
        courseH: 0.38,
        blockL: 0.78,
      });
      const local = [W.geo];
      const keep = (x, y) => y < D.top(x) + 0.1;
      D.openings.forEach((op, i) => {
        local.push(archRing({ cx: op.x, w: op.w, k: op.k, spring: op.y1, depth: op.door || op.big ? 0.36 : 0.3, thick: T + 0.07, seed: D.seed * 10 + i, stone: stDress, keep }));
        if (op.door) return;
        const stands = Math.min(D.top(op.x - op.w / 2), D.top(op.x), D.top(op.x + op.w / 2)) > op.y0 + 0.25;
        if (!stands) return;
        const sill = paint(box(op.w + 0.34, 0.16, T + 0.26), dressSpec(i));
        sill.translate(op.x, op.y0 - 0.07, 0.01);
        local.push(sill, ...tracery(op, D.top, R));
      });
      if (D.id === 'south') local.push(...portal(stDress));
      // buttresses
      const Mb = new Mesher();
      const small = D.id === 'south';
      for (const x of D.butt) {
        const hT = Math.min(D.top(x - 0.4), D.top(x), D.top(x + 0.4));
        buttress(Mb, x, T / 2, hT, D.seed * 31 + Math.round(x * 10), stOut, small ? { k: 0.78, w: 0.85 } : {});
        const topC = Math.min(3.3 * (small ? 0.78 : 1), hT);
        const c = F.pt(x, (topC - 2) / 2, T / 2 + 0.62);
        b.boxCollider(c[0], c[1], c[2], small ? 0.43 : 0.48, (topC + 2) / 2, 0.63, F.th);
      }
      const bg = Mb.build({ rough: 0.96 });
      if (bg) local.push(bg);
      // string course under the sills and a corbel table under the eaves, where the wall still stands
      if (D.id === 'east' || D.id === 'west') {
        const dress = [];
        let run = null;
        for (let x = 0; x <= F.len + 0.01; x += 0.5) {
          const ok = x < F.len && Math.min(D.top(x), D.top(x + 0.5)) > 3.3;
          if (ok && run === null) run = x;
          if (!ok && run !== null) {
            const g = box(x - run, 0.11, 0.1);
            g.translate((x + run) / 2, 2.83, T / 2 + 0.045);
            dress.push(g);
            run = null;
          }
        }
        for (let x = 0.5; x < F.len - 0.3; x += 0.78) {
          if (D.top(x) < 8.95 || D.top(x - 0.3) < 8.9 || D.top(x + 0.3) < 8.9) continue;
          const g = box(0.2, 0.24, 0.22);
          g.translate(x, 8.42, T / 2 + 0.1);
          dress.push(g);
        }
        if (dress.length) local.push(paint(merge(dress.map((g) => paint(g, {}))), dressSpec(D.seed)));
      }
      // stones left lying on the broken wall heads
      for (let i = 0, n = Math.round(F.len / 2.2); i < n; i++) {
        const x = R.range(0.5, F.len - 0.5);
        const y = W.topAt(x);
        if (y < 1) continue;
        const s = R.range(0.3, 0.62);
        const g = looseStone(R, [s, s * R.range(0.5, 0.7), s * R.range(0.6, 0.9)], stOut, i);
        xf(g, { r: [R.range(-0.25, 0.25), R.range(0, TAU), R.range(-0.25, 0.25)], t: [x, y - 0.04, R.range(-0.22, 0.22)] });
        local.push(g);
      }
      // the door leaf that still hangs: swung in against the wall, west of the door
      if (D.id === 'south') {
        const leaf = doorLeaf(R, 1.08, 2.85);
        leaf.scale(-1, 1, 1); // extend toward -x from the hinge (the winding flips, the material is double sided)
        leaf.rotateY(-0.13);
        leaf.translate(5.4 - 1.1, FY + 0.03, -T / 2 - 0.06);
        local.push(leaf);
      }
      b.add(F.place(merge(local)));
      wallColliders(b, W.spec, F, { yMin: -2 });
    }

    // diagonal buttresses on the apse corners and the south-east corner
    {
      const Mb = new Mesher();
      const cornerB = (v, nx, nz, hT, seed, inset) => {
        const l = Math.hypot(nx, nz);
        nx /= l;
        nz /= l;
        // a frame whose outer direction is (nx, nz), its x = 0.5 on the corner
        const dx = nz,
          dz = -nx;
        const cx = v[0] + nx * inset,
          cz = v[1] + nz * inset;
        const F = wallFrame(cx - dx * 0.5, cz - dz * 0.5, cx + dx * 0.5, cz + dz * 0.5);
        const M2 = new Mesher();
        buttress(M2, 0.5, 0, hT, seed, stOut, { w: 0.9 });
        b.add(F.place(M2.build({ rough: 0.96 })));
        const c = F.pt(0.5, 0.65, 0.6);
        b.boxCollider(c[0], c[1], c[2], 0.46, 2.65, 0.62, F.th);
      };
      cornerB(vE, 0.924, -0.383, 8.6, 301, 0.3);
      cornerB(vNE, 0.383, -0.924, 8.2, 302, 0.3);
      cornerB(vNW, -0.383, -0.924, 8.4, 303, 0.3);
      cornerB(vW, -0.924, -0.383, 8.6, 304, 0.3);
      cornerB([HW + T, ZS + T], 1, 1, 6.0, 305, -0.2);
      void Mb;
    }

    // ------------------------------------------------------------------ chancel arch
    {
      const L = 2 * HW + 0.2;
      const F = wallFrame(-HW - 0.1, ZN, HW + 0.1, ZN);
      const top = profile(
        [
          [0, 9.7],
          [1.5, 10.6],
          [3.0, 12.0],
          [4.6, 12.9],
          [5.7, 12.5],
          [6.7, 11.2],
          [7.7, 10.3],
          [9.2, 9.4],
        ],
        { jag: 0.3, seed: 27 }
      );
      const openings = [{ x: L / 2, w: 7.0, y0: FY, y1: 5.6, k: 1, margin: 0.3 }];
      const W = wall({ length: L, thick: 1.0, top, base: FY, openings, seed: 27, stone: stIn, stoneIn: stIn, courseH: 0.38, blockL: 0.8, pockets: 0.012, wobble: 0.03 });
      const local = [W.geo];
      local.push(archRing({ cx: L / 2, w: 7.0, k: 1, spring: 5.6, depth: 0.56, thick: 1.12, seed: 271, stone: stDress, n: 15, keep: (x, y) => y < top(x) + 0.2 }));
      for (const x of [0.55, L - 0.55]) {
        const imp = paint(box(1.22, 0.26, 1.24), dressSpec(x));
        imp.translate(x, 5.5, 0);
        const neck = paint(box(1.14, 0.12, 1.14), dressSpec(x + 1));
        neck.translate(x, 5.32, 0);
        local.push(imp, neck);
      }
      for (let i = 0; i < 4; i++) {
        const x = R.range(0.4, L - 0.4);
        const y = W.topAt(x);
        if (y < 6) continue;
        const s = R.range(0.3, 0.55);
        const g = looseStone(R, [s, s * 0.6, s * 0.8], stIn, i + 20);
        xf(g, { r: [R.range(-0.2, 0.2), R.range(0, TAU), R.range(-0.2, 0.2)], t: [x, y - 0.04, R.range(-0.2, 0.2)] });
        local.push(g);
      }
      b.add(F.place(merge(local)));
      wallColliders(b, W.spec, F, { yMin: FY, step: 1.2 });
    }

    // ------------------------------------------------------------------ roof ribs and their wall shafts
    {
      const shaft = (x, z, h, cap = true) => {
        const parts = [];
        const s = cyl(0.17, 0.19, h - FY - 0.2, 8);
        s.translate(x, FY + 0.2 + (h - FY - 0.2) / 2, z);
        const base = lathe(
          [
            [0.3, 0],
            [0.3, 0.14, 'hard'],
            [0.2, 0.3],
          ],
          8
        );
        base.translate(x, FY, z);
        parts.push(s, base);
        if (cap) {
          const c = lathe(
            [
              [0.19, 0],
              [0.22, 0.08],
              [0.34, 0.3, 'hard'],
              [0.37, 0.3, 'hard'],
              [0.37, 0.44, 'hard'],
              [0.19, 0.44],
            ],
            8
          );
          c.translate(x, h - 0.44, z);
          parts.push(c);
        }
        return paint(merge(parts.map((g) => paint(g, {}))), dressSpec(z + x));
      };
      const rib = (z, seed, keep) => {
        const F = wallFrame(-HW, z, HW, z);
        const g = archRing({ cx: HW, w: 2 * HW, k: 0.74, spring: 6.6, depth: 0.44, thick: 0.52, seed, stone: stDress, n: 17, keep });
        b.add(F.place(g));
      };
      rib(8.2, 61, null);
      rib(3.2, 62, (x) => x > 8.25);
      rib(-1.8, 63, (x) => x > 7.5);
      b.add(shaft(-HW + 0.04, 8.2, 6.6), shaft(HW - 0.04, 8.2, 6.6), shaft(HW - 0.04, 3.2, 6.6), shaft(HW - 0.04, -1.8, 6.6), shaft(-HW + 0.04, -1.8, 4.3, false));
    }

    // ------------------------------------------------------------------ stair turret, south-west corner
    const TX = -5.62,
      TZ = 14.32;
    {
      const nzT = new Noise(77);
      const topT = (a) => 13.0 + 1.55 * Math.cos(a - 3.9) + nzT.fbm2(a * 2.3, 1.7, 2) * 0.55;
      b.add(blockCyl(1.5, { y0: -2, seg: 24, per: 3, round: true, top: 1.6, cap: false, courseH: 1.6, seed: 30, stone: stOut, at: [TX, 0, TZ] }));
      b.add(
        blockCyl((y) => (y < 3.6 ? 1.43 : 1.27), {
          y0: -0.4,
          seg: 24,
          per: 2,
          round: true,
          top: topT,
          ri: 0.86,
          innerFrom: 10.4,
          cap: false,
          courseH: 0.37,
          seed: 31,
          stone: stOut,
          at: [TX, 0, TZ],
        })
      );
      const floor = paint(new THREE.CircleGeometry(0.9, 12).rotateX(-Math.PI / 2), { color: '#0b0a09', rough: 1, mat: MAT.STONE });
      floor.translate(TX, 10.05, TZ);
      b.add(floor);
      const bands = [];
      for (const [y, r, out] of [
        [3.6, 1.3, 0.14],
        [9.3, 1.27, 0.09],
      ]) {
        const band = lathe(
          [
            [r, 0, 'hard'],
            [r + out, 0.05, 'hard'],
            [r + out, 0.17, 'hard'],
            [r, 0.3, 'hard'],
          ],
          24
        );
        band.rotateY(Math.PI / 24);
        band.translate(TX, y, TZ);
        bands.push(paint(band, {}));
      }
      b.add(paint(merge(bands), dressSpec(3)));
      // arrow slits with dressed surrounds
      for (const [a, y] of [
        [0.39, 2.3],
        [0.39, 7.0],
        [5.1, 5.2],
        [1.96, 6.0],
        [3.4, 11.0],
      ]) {
        const s = paint(box(0.12, 1.25, 0.06), { color: '#050505', rough: 1, mat: MAT.STONE });
        const fr = [box(0.1, 1.5, 0.07), box(0.1, 1.5, 0.07), box(0.42, 0.13, 0.08), box(0.42, 0.13, 0.08)];
        fr[0].translate(-0.13, 0, 0);
        fr[1].translate(0.13, 0, 0);
        fr[2].translate(0, 0.72, 0);
        fr[3].translate(0, -0.72, 0);
        const g = merge(s, paint(merge(fr.map((q) => paint(q, {}))), dressSpec(a + y)));
        g.translate(0, y, 1.255);
        g.rotateY(a);
        g.translate(TX, 0, TZ);
        b.add(g);
      }
      b.cylCollider(TX, 4.5, TZ, 1.36, 13);
    }

    // ------------------------------------------------------------------ floors and steps
    {
      const Mf = new Mesher();
      paving(Mf, -HW - 0.15, ZN, HW + 0.15, ZS + 0.15, { y: FY, slab: 0.95, seed: 41, stone: stFloor, missing: 0.018 });
      const inApse = (x, z) => z > ZC - HW - 0.2 && Math.abs(x) < HW + 0.2 && Math.abs(x) + (ZC - z) < HW + OCT + 0.25;
      paving(Mf, -HW - 0.1, ZC - HW - 0.1, HW + 0.1, ZN, { y: FA, slab: 0.7, seed: 42, stone: stFloor, mask: inApse, missing: 0.02 });
      stFloor.core(R, 0, FY, ZN, _c1);
      Mf.face([-3.6, FY, ZN], [3.6, FY, ZN], [3.6, FA, ZN], [-3.6, FA, ZN], [0, 0, 1], _c1);
      b.add(Mf.build({ rough: 0.9 }));
      // two steps down from the threshold
      const z0 = ZS + T + 0.1;
      b.add(blockBox(3.5, 1.2, 0.5, { y0: -1.0, at: [0, 0, z0 + 0.25], courseH: 1.2, blockL: 0.9, top: 0.85, seed: 43, stone: stFloor, sides: [1, 1, 0, 1] }));
      b.add(blockBox(4.1, 1.1, 0.5, { y0: -1.0, at: [0, 0, z0 + 0.72], courseH: 1.1, blockL: 0.9, top: 0.85, seed: 44, stone: stFloor, sides: [1, 1, 0, 1] }));
      b.boxCollider(0, (FY - 2) / 2, (ZN + ZS + T) / 2, HW + T, (FY + 2) / 2, (ZS + T - ZN) / 2);
      b.boxCollider(0, (FA - 2) / 2, (ZC - HW + ZN) / 2 - 0.2, HW + 0.4, (FA + 2) / 2, (ZN - (ZC - HW)) / 2 + 0.2);
      b.boxCollider(0, -0.4, z0 + 0.25, 1.75, 0.6, 0.25);
      b.boxCollider(0, -0.45, z0 + 0.72, 2.05, 0.55, 0.25);
    }

    // ------------------------------------------------------------------ what fell
    {
      // the breach in the west wall spilled inside and out
      const heap = (x, y, z, r, h, seed) => {
        const m = dome(r, 12, 4, h / r);
        const nz = new Noise(seed);
        const pos = m.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const k = 1 + nz.fbm2(pos.getX(i) * 1.3, pos.getZ(i) * 1.3, 3) * 0.35;
          pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * (k * 0.9));
        }
        m.computeVertexNormals();
        paint(m, { color: (v) => _c1.set('#2b2622').multiplyScalar(0.7 + 0.5 * (nz.n2(v.x * 3, v.z * 3) * 0.5 + 0.5)), rough: 1, mat: MAT.STONE });
        m.translate(x, y - 0.03, z);
        const g = rubble(new Rng(seed), 16, r * 1.15, stOut, { size: [0.22, 0.55], pile: h * 0.9 });
        g.translate(x, y, z);
        b.add(m, g);
      };
      heap(-3.45, FY, 1.3, 1.5, 0.6, 51);
      heap(-6.6, 0, 1.2, 1.9, 0.7, 52);
      b.sphereCollider(-3.45, FY - 1.85, 1.3, 2.4);
      b.sphereCollider(-6.6, -2.2, 1.2, 2.85);
      // big blocks
      const big = [
        [-2.6, FY, 2.7, 0.95, 0.5, 0.62, 0.5],
        [-3.0, FY, -0.5, 0.8, 0.45, 0.6, -0.9],
        [-7.7, 0, 2.9, 1.0, 0.52, 0.7, 0.3],
        [2.9, FY, 6.9, 0.7, 0.4, 0.5, 1.1],
        [6.6, 0, 5.6, 0.9, 0.5, 0.65, -0.4],
        [5.0, 0, 16.2, 0.8, 0.42, 0.55, 0.7],
      ];
      big.forEach(([x, y, z, sx, sy, sz, ry], i) => {
        const g = looseStone(R, [sx, sy, sz], stOut, i * 7 + 3);
        xf(g, { r: [0, ry, 0], t: [x, y - 0.03, z] });
        b.add(g);
        b.boxCollider(x, y + sy / 2 - 0.03, z, sx / 2, sy / 2, sz / 2, ry);
      });
      b.add(xf(rubble(R, 9, 1.6, stOut, { size: [0.18, 0.4] }), { t: [6.4, 0, 5.2] }));
      b.add(xf(rubble(R, 6, 1.0, stOut, { size: [0.15, 0.32] }), { t: [3.2, FY, 6.4] }));
      b.add(xf(rubble(R, 7, 1.4, stOut, { size: [0.18, 0.4] }), { t: [4.4, 0, 15.8] }));

      // charred roof timbers
      const beam = (a, c, w, t, seed) => b.add(strut(a, c, (len) => plank(len, w, t, { seed, tone: PAL.woodDark, char: 0.62, rough: 0.03 }), seed));
      beam([-2.7, FY + 0.14, 7.5], [2.9, FY + 0.16, 5.3], 0.26, 0.24, 5);
      beam([1.5, FY + 0.1, 3.9], [4.15, 8.5, 1.9], 0.24, 0.22, 6);
      beam([-3.9, FY + 0.5, 0.2], [-1.7, FY + 0.12, 3.6], 0.22, 0.2, 7);
      beam([3.2, FY + 0.12, 6.7], [4.45, 5.5, 4.9], 0.2, 0.2, 8);

      // the fallen door leaf, burnt, flat on the flags
      const leaf = doorLeaf(R, 1.08, 2.85, { char: 0.85 });
      leaf.rotateX(-Math.PI / 2);
      leaf.rotateY(0.45);
      leaf.translate(0.5, FY + 0.05, 11.9);
      b.add(leaf);

      // the iron corona that hung over the nave
      const cor = [];
      const ringG = torus(0.78, 0.028, 5, 20);
      cor.push(ringG);
      for (let i = 0; i < 8; i++) {
        const cup = cyl(0.04, 0.03, 0.05, 6);
        const a = (i / 8) * TAU;
        cup.translate(Math.cos(a) * 0.78, 0.045, Math.sin(a) * 0.78);
        cor.push(cup);
        const sp = cyl(0.004, 0.012, 0.09, 4);
        sp.translate(Math.cos(a + 0.39) * 0.78, 0.06, Math.sin(a + 0.39) * 0.78);
        cor.push(sp);
      }
      const corona = paint(merge(cor.map((g) => paint(g, {}))), ironSpec(0.75, 4));
      xf(corona, { r: [0.16, 0.4, 0.07], t: [1.7, FY + 0.12, 9.3] });
      b.add(corona);
      b.add(chain([1.2, FY + 0.16, 9.0], [0.2, FY + 0.03, 8.4], { sag: 0, link: 0.13, seed: 3 }));
      b.add(chain([2.3, FY + 0.1, 9.7], [2.9, FY + 0.03, 10.6], { sag: 0, link: 0.13, seed: 4 }));

      // the bell, down from the turret, cracked
      const bell = lathe(
        [
          [0.47, 0],
          [0.44, 0.04],
          [0.4, 0.1],
          [0.33, 0.3],
          [0.27, 0.52],
          [0.24, 0.66],
          [0.17, 0.75],
          [0.06, 0.79],
          [0, 0.8],
        ],
        14
      );
      const bellIn = lathe(
        [
          [0.2, 0.62],
          [0.3, 0.3],
          [0.4, 0.06],
          [0.44, 0.0],
        ],
        14
      );
      const bl = merge(paint(bell, bronzeSpec(0.55, 5)), paint(bellIn, { color: '#1d1a14', rough: 0.9, metal: 0.3, mat: MAT.METAL }));
      bl.rotateX(1.94); // on its side, resting on the lip and the shoulder
      bl.rotateY(2.21);
      bl.translate(-3.25, FY + 0.44, 11.3);
      b.add(bl);
      b.sphereCollider(-3.1, FY + 0.33, 11.2, 0.5);
    }

    // ------------------------------------------------------------------ ledges for candles
    const ledge = (x, y, z, ry) => {
      const top = box(0.44, 0.1, 0.3);
      top.translate(0, -0.05, 0.15);
      const br = box(0.2, 0.2, 0.2);
      br.translate(0, -0.2, 0.1);
      const g = paint(merge(paint(top, {}), paint(br, {})), dressSpec(x + z));
      xf(g, { r: [0, ry, 0], t: [x, y, z] });
      b.add(g);
    };
    ledge(-HW + 0.02, 1.5, 6.0, Math.PI / 2);
    ledge(HW - 0.02, 1.5, 1.0, -Math.PI / 2);

    // ------------------------------------------------------------------ dead ivy, gone to wire
    {
      const F = wallFrame(AC, ZS + 0.05, AC, zE); // the east wall, by the south-east corner
      const stems = [];
      for (let i = 0; i < 5; i++) {
        let x = R.range(0.4, 4.2),
          y = -0.1;
        const pts = [[x, y, T / 2 + 0.03]];
        const h = R.range(3.5, 7.6);
        while (y < h) {
          y += R.range(0.35, 0.8);
          x += R.range(-0.28, 0.28);
          pts.push([x, y, T / 2 + 0.03 + R.range(0, 0.03)]);
        }
        stems.push(tube(pts, (t) => 0.016 - 0.011 * t, 3, { samples: pts.length * 2 }));
        for (let k = 0; k < 3; k++) {
          const p = pts[R.int(1, pts.length - 2)];
          const s = R.sign();
          stems.push(
            tube(
              [
                p,
                [p[0] + s * R.range(0.2, 0.5), p[1] + R.range(0.1, 0.45), p[2]],
                [p[0] + s * R.range(0.5, 1.0), p[1] + R.range(0.3, 0.9), p[2]],
              ],
              (t) => 0.008 - 0.005 * t,
              3,
              { samples: 4 }
            )
          );
        }
      }
      const ivy = paint(merge(stems.map((g) => paint(g, {}))), { color: '#1c1611', rough: 1, mat: MAT.WOOD });
      b.add(F.place(ivy));
    }

    // ------------------------------------------------------------------ anchors
    b.anchor('athanor', 0, FA, ZC - 1.6);
    b.anchor('cauldron', 0, FY, 0.0);
    b.anchor('workbench', -3.85, FY, -4.2);
    b.anchor('shelf', 4.2, FY, -3.7);
    b.anchor('lectern', 2.7, FY, 10.4);
    b.anchor('spawn', 0, FY, 11.2);
    b.anchor('door', 0, 0, ZS + T + 3.0);
    b.anchor('candles1', -HW + 0.17, 1.5, 6.0);
    b.anchor('candles2', HW - 0.17, 1.5, 1.0);
    b.anchor('candles3', -2.9, FA, -11.2);
    b.anchor('candles4', 3.9, FY, 12.6);
    return b.build();
  },
  {
    kind: 'structure',
    variants: 1,
    floorY: FY,
    apseFloorY: FA,
    // turn a +Z-fronted model by this much (radians, about Y) when it is placed on the anchor
    yaw: { athanor: 0, cauldron: 0, workbench: Math.PI / 2, shelf: -Math.PI / 2, lectern: -0.75, spawn: Math.PI },
  }
);
