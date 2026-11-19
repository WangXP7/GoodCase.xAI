// The burial ground: grave markers, the iron fence round it and its gate.
// Plain stone only: weather has taken the names, and nobody on Morne carved symbols on a grave.
import { Builder, Rng, Noise, PAL, THREE, xf, col, mixc, rock, deform, tube, TAU } from '../kit.js';
import { register } from '../registry.js';
import { Tris, V3, lerp, weathering, stoneTone, stonePaint, placed, looseStone, hewn, shaft4, spear, iron, aim, dist3, courses, courseLevels, masonry, prismFaces } from './_shared.js';

const levels = (y0, y1, n) => Array.from({ length: n + 1 }, (_, i) => lerp(y0, y1, i / n));

/**
 * An upright slab written on a Tris. `ys` are heights from the bottom up, xl(y) and xr(y) its edges.
 * The faces are grids, so weathering has vertices to hold on to; the arrises are chamfered; the top
 * is closed when the outline does not come to a point.
 *   t: thickness (number or (y) => number)      warp(p): move a finished vertex (a jagged break)
 *   capBottom: close the underside too (a piece that lies on the ground)
 *   chamTop: false = a broken top, no chamfer   capTone: brightness of top and bottom faces
 */
function stele(T, o) {
  const { ys, xl, xr, t, cols = 4, cham = 0.012, color, shadeAt = null, nz = null, erode = 0.005, capBottom = false, warp = null, chamTop = true, capTone = 0.85, sky = 1 } = o;
  const n = ys.length;
  const world = new THREE.Vector3();
  const upOf = (v) => Math.max(0, T.mx ? v.clone().transformDirection(T.mx).y : v.y) * sky;
  const cAt = (p, k, up) => {
    const c = color.clone().multiplyScalar(k);
    if (shadeAt) shadeAt(T.mx ? world.copy(p).applyMatrix4(T.mx) : p, c, up);
    return c;
  };
  const flatTop = xr(ys[n - 1]) - xl(ys[n - 1]) > 0.03;
  const F = [],
    B = [];
  for (let j = 0; j < n; j++) {
    const y = ys[j],
      a = xl(y),
      w = Math.max(1e-5, xr(y) - a);
    const e = Math.min(0.5 / cols, cham / w);
    const th = (typeof t === 'function' ? t(y) : t) / 2;
    const topRow = j === n - 1 && flatTop && chamTop;
    const rf = [],
      rb = [];
    for (let i = 0; i <= cols + 2; i++) {
      const s = i === 0 ? 0 : i === 1 ? e : i === cols + 1 ? 1 - e : i === cols + 2 ? 1 : (i - 1) / cols;
      const x = a + w * s;
      const edge = i === 0 || i === cols + 2 || topRow;
      const pf = V3(x, y, th + (edge ? -cham : nz ? nz.fbm2(x * 5.3 + 17, y * 5.3, 2) * erode : 0));
      const pb = V3(x, y, -th - (edge ? -cham : nz ? nz.fbm2(x * 5.3 - 40, y * 5.3 + 9, 2) * erode : 0));
      if (warp) {
        warp(pf);
        warp(pb);
      }
      rf.push(pf);
      rb.push(pb);
    }
    F.push(rf);
    B.push(rb);
  }
  const oF = V3(0, 0, 1),
    oB = V3(0, 0, -1),
    oU = V3(0, 1, 0),
    oD = V3(0, -1, 0);
  const upF = upOf(oF),
    upB = upOf(oB);
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < cols + 2; i++) {
      let a = F[j][i],
        b = F[j][i + 1],
        c = F[j + 1][i + 1],
        d = F[j + 1][i];
      T.quadOut(a, b, c, d, oF, cAt(a, 1, upF), cAt(b, 1, upF), cAt(c, 1, upF), cAt(d, 1, upF));
      a = B[j][i];
      b = B[j][i + 1];
      c = B[j + 1][i + 1];
      d = B[j + 1][i];
      T.quadOut(a, b, c, d, oB, cAt(a, 0.94, upB), cAt(b, 0.94, upB), cAt(c, 0.94, upB), cAt(d, 0.94, upB));
    }
    for (const [i, sgn] of [
      [0, -1],
      [cols + 2, 1],
    ]) {
      const a = F[j][i],
        b = F[j + 1][i],
        c = B[j + 1][i],
        d = B[j][i];
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const out = sgn < 0 ? V3(-dy, dx, 0) : V3(dy, -dx, 0);
      if (out.lengthSq() < 1e-10) continue;
      const up = upOf(out.normalize());
      T.quadOut(a, b, c, d, out, cAt(a, 0.85, up), cAt(b, 0.85, up), cAt(c, 0.85, up), cAt(d, 0.85, up));
    }
  }
  for (const [on, row, out] of [
    [flatTop, n - 1, oU],
    [capBottom, 0, oD],
  ]) {
    if (!on) continue;
    const up = upOf(out);
    for (let i = 0; i < cols + 2; i++) {
      const a = F[row][i],
        b = F[row][i + 1],
        c = B[row][i + 1],
        d = B[row][i];
      T.quadOut(a, b, c, d, out, cAt(a, capTone, up), cAt(b, capTone, up), cAt(c, capTone, up), cAt(d, capTone, up));
    }
  }
}

/** What is left of an inscription: rows of short worn strokes, many of them gone. */
function inscribe(T, { lines, half, z, color, rng, worn = 0.35 }) {
  const out = V3(0, 0, 1);
  for (const [y, k] of lines) {
    const hw = half(y);
    if (hw < 0.07) continue;
    let x = -hw + rng.range(0, hw * 0.35);
    const end = hw - rng.range(0, hw * 0.35);
    while (x < end) {
      const l = rng.range(0.02, 0.06) * k,
        h = rng.range(0.014, 0.02) * k;
      if (x + l > end) break;
      if (!rng.chance(worn)) T.quadOut(V3(x, y, z), V3(x + l, y, z), V3(x + l, y + h, z), V3(x, y + h, z), out, color);
      x += l + rng.range(0.012, 0.03) * k;
    }
  }
}

/** A stone ring: the head of a wheel-head marker. Centre (0, cy), in the plane of the stele. */
function ringStone(T, { cy, ro, ri, t, n = 14, cham = 0.014, color, shadeAt, rng }) {
  const world = new THREE.Vector3();
  const cAt = (p, k, up = 0) => {
    const c = color.clone().multiplyScalar(k);
    if (shadeAt) shadeAt(T.mx ? world.copy(p).applyMatrix4(T.mx) : p, c, up);
    return c;
  };
  const jo = [],
    ji = [];
  for (let i = 0; i < n; i++) {
    jo.push(1 + rng.range(-0.025, 0.025));
    ji.push(1 + rng.range(-0.04, 0.04));
  }
  const pt = (i, r, z) => {
    const a = (i / n) * TAU;
    return V3(Math.cos(a) * r, cy + Math.sin(a) * r, z);
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const am = ((i + 0.5) / n) * TAU;
    const rad = V3(Math.cos(am), Math.sin(am), 0);
    const up = Math.max(0, rad.y);
    for (const s of [1, -1]) {
      const zf = (s * t) / 2,
        out = V3(0, 0, s);
      const a = pt(i, ri * ji[i], zf),
        b = pt(i, ro * jo[i] - cham, zf),
        c = pt(j, ro * jo[j] - cham, zf),
        d = pt(j, ri * ji[j], zf);
      T.quadOut(a, b, c, d, out, cAt(a, 0.8), cAt(b, 1), cAt(c, 1), cAt(d, 0.8));
      const e = pt(i, ro * jo[i], zf - s * cham),
        f = pt(j, ro * jo[j], zf - s * cham);
      T.quadOut(b, e, f, c, out, cAt(b, 0.95, up), cAt(e, 0.9, up), cAt(f, 0.9, up), cAt(c, 0.95, up));
    }
    const o0 = pt(i, ro * jo[i], t / 2 - cham),
      o1 = pt(j, ro * jo[j], t / 2 - cham),
      o2 = pt(j, ro * jo[j], -t / 2 + cham),
      o3 = pt(i, ro * jo[i], -t / 2 + cham);
    T.quadOut(o0, o1, o2, o3, rad, cAt(o0, 0.88, up), cAt(o1, 0.88, up), cAt(o2, 0.88, up), cAt(o3, 0.88, up));
    const i0 = pt(i, ri * ji[i], t / 2),
      i1 = pt(j, ri * ji[j], t / 2),
      i2 = pt(j, ri * ji[j], -t / 2),
      i3 = pt(i, ri * ji[i], -t / 2);
    const dn = Math.max(0, -rad.y);
    T.quadOut(i0, i1, i2, i3, rad.clone().negate(), cAt(i0, 0.62, dn), cAt(i1, 0.62, dn), cAt(i2, 0.62, dn), cAt(i3, 0.62, dn));
  }
}

// outlines of standing stones: { ys, hw(y), H }
function roundTop(W, yS, { y0 = -0.3, rows = 4, arc = 6, k = 1 } = {}) {
  const r = W / 2;
  const ys = levels(y0, yS, rows);
  for (let i = 1; i <= arc; i++) ys.push(yS + r * k * Math.sin(((i / arc) * Math.PI) / 2));
  return { ys, H: yS + r * k, hw: (y) => (y <= yS ? r : r * Math.sqrt(Math.max(0, 1 - Math.pow((y - yS) / (r * k), 2)))) };
}
function pointTop(W, yS, { y0 = -0.3, rows = 5, arc = 6, k = 1, shoulder = 0.035 } = {}) {
  const a = W / 2 - shoulder,
    c = k * a,
    rr = a + c,
    rise = Math.sqrt(rr * rr - c * c);
  const ys = levels(y0, yS, rows);
  ys.push(yS + 0.012);
  for (let i = 1; i <= arc; i++) ys.push(yS + 0.012 + rise * Math.sin(((i / arc) * Math.PI) / 2));
  return {
    ys,
    H: yS + 0.012 + rise,
    hw: (y) => {
      if (y <= yS + 1e-6) return W / 2;
      const dy = y - yS - 0.012;
      return Math.max(0, -c + Math.sqrt(Math.max(0, rr * rr - dy * dy)));
    },
  };
}

register(
  'grave',
  (seed) => {
    const variant = (((seed - 1) % 8) + 8) % 8;
    const R = new Rng(seed * 577 + 3);
    const nz = new Noise(seed * 29 + 5);
    const b = new Builder();
    const T = new Tris();
    const shade = weathering({ seed: seed + 91, moss: 0.7, mossTop: 0.75, lichen: 0.75, grime: 0.7 });
    const out = [];
    const stone = (g, c) => out.push(stonePaint(g, { color: c, shadeAt: shade }));
    const bases = [PAL.stone, PAL.stoneLight, PAL.stoneWarm, mixc(PAL.slate, PAL.stone, 0.45), PAL.stone, PAL.stoneLight, mixc(PAL.slate, PAL.stone, 0.6), PAL.stoneWarm];
    const tone = stoneTone(R, { base: bases[variant], vary: 0.05 });
    const ink = tone.clone().multiplyScalar(0.5);
    const wob = (y, k) => 1 + nz.n2(y * 3.1, k * 7.7) * 0.025; // no edge is quite straight any more
    const chips = (list) => (y, side) => {
      let d = 0;
      for (const [s, yc, depth, size] of list) if (s === side) d += depth * Math.max(0, 1 - Math.abs(y - yc) / size);
      return d;
    };
    const pebbles = (spots) => {
      for (const [x, z, s] of spots) {
        const g = rock(s, { seed: R.int(1, 9999), detail: 1, rough: 0.25, squash: [1, 0.6, R.range(0.7, 1)], facet: true });
        xf(g, { r: [0, R.range(0, TAU), 0], t: [x, s * 0.2, z] });
        stone(g, stoneTone(R));
      }
    };

    if (variant === 0) {
      // a ledger slab on kerb stones, cracked across; the smaller half has settled
      const W = 0.92,
        L = 1.9,
        t = 0.13,
        top = 0.25,
        gap = 0.014;
      const zig = (x) => 0.16 + 0.3 * x + 0.05 * Math.sin(x * 9 + seed) + nz.n2(x * 6, 3.1) * 0.04;
      const HA = L / 2 - 0.16,
        HB = L / 2 + 0.16;
      const edge = (k) => (y) => (W / 2) * wob(y, k);
      placed(T, [0, top - t / 2, L / 2], [-Math.PI / 2, 0, 0], () => {
        stele(T, { ys: levels(0, HA, 4), xl: (y) => -edge(1)(y), xr: edge(2), t, cols: 5, color: tone, shadeAt: shade, nz, sky: 0.3, capBottom: true, chamTop: false, capTone: 0.5, warp: (p) => (p.y *= (L / 2 - zig(p.x) - gap / 2) / HA) });
        inscribe(T, { lines: [0.2, 0.29, 0.38, 0.47, 0.56].map((y) => [y, 1.15]), half: () => W / 2 - 0.12, z: t / 2 + 0.004, color: ink, rng: R, worn: 0.45 });
      });
      placed(T, [R.range(-0.015, 0.015), top - t / 2 - 0.035, -L / 2 - 0.01], [-Math.PI / 2 - 0.045, R.range(-0.02, 0.02), Math.PI + R.range(-0.025, 0.025)], () => {
        stele(T, { ys: levels(0, HB, 5), xl: (y) => -edge(3)(y), xr: edge(4), t, cols: 5, color: tone, shadeAt: shade, nz, sky: 0.45, capBottom: true, chamTop: false, capTone: 0.5, warp: (p) => (p.y *= (zig(-p.x) + L / 2 - gap / 2) / HB) });
        inscribe(T, { lines: [0.45, 0.55, 0.65, 0.75].map((y) => [y, 1.15]), half: () => W / 2 - 0.12, z: t / 2 + 0.004, color: ink, rng: R, worn: 0.6 });
      });
      for (const [x, z] of [
        [-0.36, 0.78],
        [0.38, 0.8],
        [-0.4, 0.05],
        [0.4, -0.1],
        [-0.36, -0.8],
        [0.37, -0.78],
      ]) {
        placed(T, [x + R.range(-0.04, 0.04), 0.03, z], [R.range(-0.06, 0.06), R.range(-0.3, 0.3), R.range(-0.06, 0.06)], () => looseStone(T, R.range(0.26, 0.36), 0.2, R.range(0.2, 0.3), { rng: R, color: stoneTone(R), shadeAt: shade }));
      }
      b.boxCollider(0, top / 2, 0, W / 2, top / 2, L / 2);
    } else if (variant === 1) {
      // a round-topped headstone, leaning back and aside
      const o = roundTop(0.6, 0.74);
      const chip = chips([[1, 0.86, 0.07, 0.1]]);
      placed(T, [0, 0, 0], [-0.15, 0.06, 0.07], () => {
        stele(T, { ys: o.ys, xl: (y) => -o.hw(y) * wob(y, 1), xr: (y) => Math.max(0, o.hw(y) * wob(y, 2) - chip(y, 1)), t: 0.11, color: tone, shadeAt: shade, nz });
        inscribe(T, { lines: [[0.8, 1.5], [0.7, 1], [0.62, 1], [0.54, 1], [0.46, 1], [0.38, 1]], half: (y) => o.hw(y) - 0.07, z: 0.059, color: ink, rng: R });
      });
      pebbles([
        [0.34, 0.08, 0.09],
        [-0.3, -0.12, 0.07],
      ]);
      b.boxCollider(0.03, 0.5, -0.08, 0.32, 0.5, 0.13);
    } else if (variant === 2) {
      // an obelisk on a stepped plinth; its point is gone
      const parts = [];
      const add = (g, y) => {
        g.translate(0, y, 0);
        parts.push(g);
      };
      add(hewn(0.78, 0.5, 0.78, R, { j: 0.02 }), -0.14);
      add(hewn(0.6, 0.15, 0.6, R), 0.185);
      add(hewn(0.43, 0.4, 0.43, R, { seg: 3 }), 0.46);
      add(hewn(0.51, 0.07, 0.51, R), 0.695);
      add(shaft4(0.33, 0.21, 0.92, 4), 0.73);
      const broken = R.chance(0.6);
      const tip = shaft4(0.21, broken ? 0.09 : 0, broken ? 0.09 : 0.17, 1);
      if (broken) deform(tip, (p) => (p.y > 0.05 ? (p.y += (p.x + p.z) * 0.25) : 0));
      add(tip, 1.65);
      const lean = [R.range(-0.03, 0.03), R.range(-0.1, 0.1), R.range(-0.035, 0.035)];
      for (const g of parts) stone(xf(g, { r: lean }), tone);
      placed(T, [0, 0, 0], lean, () => inscribe(T, { lines: [[0.56, 1], [0.49, 1], [0.42, 1], [0.35, 1]], half: () => 0.16, z: 0.222, color: ink, rng: R, worn: 0.4 }));
      if (broken) pebbles([[0.42, 0.3, 0.08]]);
      b.boxCollider(0, 0.9, 0, 0.31, 0.9, 0.31);
    } else if (variant === 3) {
      // a wheel-head: a ring of stone on a tapering shaft
      const H = 1.04;
      placed(T, [0, 0, 0], [-0.06, 0.04, 0.08], () => {
        stele(T, { ys: levels(-0.3, H, 6), xl: (y) => -lerp(0.2, 0.125, y / H) * wob(y, 1), xr: (y) => lerp(0.2, 0.125, y / H) * wob(y, 2), t: (y) => lerp(0.17, 0.14, y / H), cols: 3, color: tone, shadeAt: shade, nz });
        ringStone(T, { cy: H + 0.24, ro: 0.31, ri: 0.125, t: 0.13, color: tone, shadeAt: shade, rng: R });
        stele(T, { ys: [H - 0.06, H + 0.03], xl: () => -0.165, xr: () => 0.165, t: 0.17, cols: 2, color: tone, shadeAt: shade, capBottom: true });
        inscribe(T, { lines: [[0.7, 0.9], [0.62, 0.9], [0.54, 0.9]], half: (y) => lerp(0.2, 0.125, y / H) - 0.04, z: 0.085, color: ink, rng: R, worn: 0.5 });
      });
      pebbles([[-0.28, 0.1, 0.08]]);
      b.boxCollider(0.05, 0.78, -0.03, 0.31, 0.78, 0.12);
    } else if (variant === 4) {
      // snapped off a hand above the ground; the rest lies where it fell
      const W = 0.56,
        t = 0.12,
        hb = 0.3;
      const jag = (x, z) => 0.07 * Math.sin(x * 11 + seed) + nz.n2(x * 9, 1.7) * 0.06 + (z > 0 ? 0.035 : -0.02);
      placed(T, [0, 0, 0], [0.05, 0, -0.03], () => {
        stele(T, { ys: levels(-0.3, hb, 4), xl: (y) => (-W / 2) * wob(y, 1), xr: (y) => (W / 2) * wob(y, 2), t, color: tone, shadeAt: shade, nz, chamTop: false, capTone: 1.1, warp: (p) => (p.y > 0 ? (p.y += Math.pow(p.y / hb, 2) * jag(p.x, p.z)) : 0) });
        inscribe(T, { lines: [[0.14, 1], [0.06, 1]], half: () => W / 2 - 0.07, z: t / 2 + 0.004, color: ink, rng: R });
      });
      const o = roundTop(W, 0.58, { y0: 0, rows: 4 });
      placed(T, [0.12, 0.075, 0.3], [-Math.PI / 2 + 0.06, 0.03, Math.PI + 0.3], () => {
        stele(T, { ys: o.ys, xl: (y) => -o.hw(y) * wob(y, 3), xr: (y) => o.hw(y) * wob(y, 4), t, color: tone, shadeAt: shade, nz, sky: 0.3, capBottom: true, capTone: 1.1, warp: (p) => (p.y += Math.pow(Math.max(0, 1 - p.y / 0.3), 2) * jag(-p.x, -p.z)) });
        inscribe(T, { lines: [[0.66, 1.5], [0.56, 1], [0.48, 1], [0.4, 1], [0.32, 1]], half: (y) => o.hw(y) - 0.07, z: t / 2 + 0.004, color: ink, rng: R });
      });
      pebbles([
        [-0.3, 0.2, 0.07],
        [0.36, 0.16, 0.06],
        [-0.12, 0.24, 0.05],
      ]);
      b.boxCollider(0, 0.17, 0, 0.3, 0.17, 0.1);
    } else if (variant === 5) {
      // a table tomb: a chest of slabs under a heavy lid that something has shoved aside
      const dark = col('#0b0b0c');
      let g = hewn(1.08, 0.34, 2.18, R, { j: 0.02 });
      g.translate(0, -0.09, 0);
      stone(g, stoneTone(R, { base: PAL.stoneDark }));
      for (const s of [-1, 1]) {
        g = hewn(0.74, 0.5, 0.09, R, { seg: 3 });
        g.translate(0, 0.33, s * 0.88);
        stone(g, tone);
      }
      g = hewn(0.09, 0.5, 1.84, R, { seg: 3 });
      g.translate(-0.4, 0.33, 0);
      stone(g, tone);
      // the other long side has fallen outward and lets the dark out
      g = hewn(0.09, 0.5, 1.84, R, { seg: 3 });
      g.translate(0, 0.25, 0);
      xf(g, { r: [0, 0.03, -0.42], t: [0.4, 0.08, 0.02] });
      stone(g, tone);
      g = new THREE.BoxGeometry(0.66, 0.46, 1.7);
      g.translate(0, 0.33, 0);
      out.push(stonePaint(g, { color: dark }));
      const lidAt = [0.06, 0.585, -0.07],
        lidR = [0.012, 0.075, -0.035];
      g = hewn(0.9, 0.045, 1.96, R);
      xf(g, { r: lidR, t: [lidAt[0], lidAt[1] + 0.022, lidAt[2]] });
      stone(g, tone);
      g = hewn(1.0, 0.12, 2.06, R, { seg: 4 });
      xf(g, { r: lidR, t: [lidAt[0], lidAt[1] + 0.105, lidAt[2]] });
      stone(g, tone);
      placed(T, [lidAt[0], lidAt[1] + 0.105, lidAt[2]], lidR, () =>
        placed(T, [0, 0.07, 0], [-Math.PI / 2, 0, 0], () => inscribe(T, { lines: [0.55, 0.43, 0.31, 0.19, 0.07, -0.05].map((y) => [y, 1.3]), half: () => 0.34, z: 0, color: ink, rng: R, worn: 0.5 }))
      );
      placed(T, [0.78, 0.07, 0.72], [0.2, 0.7, 0.1], () => looseStone(T, 0.3, 0.12, 0.22, { rng: R, color: tone, shadeAt: shade }));
      b.boxCollider(0, 0.36, 0, 0.56, 0.37, 1.08);
    } else if (variant === 6) {
      // tall and thin with a pointed head, pitching forward
      const o = pointTop(0.5, 1.02);
      const chip = chips([[-1, 1.02, 0.05, 0.09]]);
      placed(T, [0, 0, -0.06], [0.2, -0.05, -0.05], () => {
        stele(T, { ys: o.ys, xl: (y) => -Math.max(0, o.hw(y) * wob(y, 1) - chip(y, -1)), xr: (y) => o.hw(y) * wob(y, 2), t: 0.085, color: tone, shadeAt: shade, nz });
        inscribe(T, { lines: [[1.0, 1.4], [0.9, 1], [0.82, 1], [0.74, 1], [0.66, 1], [0.58, 1], [0.5, 1]], half: (y) => o.hw(y) - 0.06, z: 0.047, color: ink, rng: R, worn: 0.45 });
      });
      pebbles([[0.3, -0.1, 0.07]]);
      b.boxCollider(0, 0.7, 0.1, 0.27, 0.7, 0.2);
    } else {
      // a poor grave: a fieldstone set on end, the plot marked out with stones from the beach
      let g = rock(0.36, { seed: seed * 7 + 1, detail: 2, rough: 0.3, freq: 1.7, squash: [0.95, 1.45, 0.42], facet: true });
      xf(g, { r: [-0.1, 0.2, 0.08], t: [0, 0.3, -0.8] });
      stone(g, tone);
      g = rock(0.17, { seed: seed * 7 + 2, detail: 1, rough: 0.2, squash: [1.1, 0.9, 0.5], facet: true });
      xf(g, { r: [0.1, -0.1, 0], t: [0.03, 0.06, 0.86] });
      stone(g, stoneTone(R));
      for (const s of [-1, 1]) {
        for (let z = -0.55; z < 0.8; z += R.range(0.24, 0.34)) {
          if (R.chance(0.2)) continue;
          const r = R.range(0.085, 0.14);
          g = rock(r, { seed: R.int(1, 9999), detail: 1, rough: 0.22, squash: [1, 0.62, R.range(0.75, 1.1)], facet: true });
          xf(g, { r: [0, R.range(0, TAU), 0], t: [s * (0.42 + R.range(-0.05, 0.05)), r * 0.22, z] });
          stone(g, stoneTone(R));
        }
      }
      b.boxCollider(0, 0.4, -0.8, 0.34, 0.4, 0.17);
    }
    b.add(T.build(), out);
    return b.build();
  },
  { kind: 'prop', variants: 8 }
);

// ---------------------------------------------------------------------------------------------
// Three metres of spear-topped fence along X. The bars run on into the ground so a run of it can
// follow a slope. One post at the -X end: the next piece brings the next post.
// ---------------------------------------------------------------------------------------------
register(
  'fence_iron',
  (seed) => {
    const variant = (((seed - 1) % 3) + 3) % 3;
    const R = new Rng(seed * 313 + 11);
    const b = new Builder();
    const N = 20,
      pitch = 3 / N,
      rust = [0.28, 0.4, 0.5][variant];
    const RAIL0 = 0.22,
      RAIL1 = 1.0,
      TOP = 1.14;
    const geos = [];
    const missing = variant === 2 ? new Set([6, 7, 8, 14]) : new Set();
    const xAt = (i) => -1.5 + pitch * (i + 0.5);
    const bar = (len, y0, pointed = true) => {
      const g = [];
      const s = new THREE.BoxGeometry(0.017, len, 0.017);
      s.translate(0, y0 + len / 2, 0);
      g.push(iron(s, R, rust));
      if (pointed) {
        const sp = spear(R.range(0.15, 0.17), 0.027);
        if (R.chance(0.12)) xf(sp, { r: [R.range(-0.5, 0.5), 0, R.range(-0.5, 0.5)] }); // a point knocked askew
        sp.translate(0, y0 + len, 0);
        g.push(iron(sp, R, rust));
      }
      return g;
    };
    for (let i = 0; i < N; i++) {
      if (missing.has(i)) continue;
      const r = [R.range(-0.015, 0.015), R.range(-0.3, 0.3), R.range(-0.02, 0.02)];
      for (const g of bar(TOP + 0.26, -0.26)) geos.push(xf(g, { r, t: [xAt(i), 0, 0] }));
    }
    const rail = (xa, xb, y) => {
      const g = new THREE.BoxGeometry(xb - xa, 0.034, 0.014, Math.max(1, Math.round((xb - xa) / pitch)), 1, 1);
      g.translate((xa + xb) / 2, y, 0);
      return iron(g, R, rust);
    };
    geos.push(rail(-1.5, 1.5, RAIL0));
    if (variant === 2) {
      // the top rail has parted where the bars went; one end hangs
      geos.push(rail(-1.5, xAt(5) + 0.05, RAIL1), rail(xAt(9) - 0.05, 1.5, RAIL1));
      const stub = new THREE.BoxGeometry(0.42, 0.034, 0.014);
      stub.translate(0.21, 0, 0);
      geos.push(iron(xf(stub, { r: [0.25, 0.2, -0.95], t: [xAt(5) + 0.05, RAIL1, 0] }), R, rust));
      // a bar that dropped out lies in the grass, another leans in the gap
      for (const g of bar(1.3, 0)) geos.push(xf(g, { r: [Math.PI / 2 - 0.04, 0, 0.5], t: [xAt(7) - 0.5, 0.03, 0.22] }));
      for (const g of bar(TOP + 0.2, -0.2)) geos.push(xf(g, { r: [0.5, 0, -0.16], t: [xAt(7), 0, -0.02] }));
    } else geos.push(rail(-1.5, 1.5, RAIL1));

    if (variant === 1) {
      // something heavy came through here: the bars are folded outward over the bottom rail
      const x0 = R.range(-0.3, 0.5),
        dir = R.sign();
      for (const g of geos) {
        deform(g, (p) => {
          const k = Math.exp(-Math.pow((p.x - x0) / 0.5, 2));
          const h = p.y - RAIL0,
            th = 0.85 * k * dir;
          if (h <= 0 || k < 1e-3) return;
          const c = Math.cos(th),
            s = Math.sin(th);
          const y = h * c - p.z * s,
            z = h * s + p.z * c;
          p.y = RAIL0 + y;
          p.z = z;
          p.x -= (p.x - x0) * 0.07 * k * (h / 0.9);
        });
      }
    }
    // the whole run has settled a little out of plumb
    const lean = [R.range(-0.04, 0.04), 0, R.range(-0.008, 0.008)];
    for (const g of geos) b.add(xf(g, { r: lean }));

    // the post
    const post = new THREE.BoxGeometry(0.05, 1.56, 0.05);
    post.translate(0, 0.4, 0);
    const fin = spear(0.18, 0.045);
    fin.translate(0, 1.18, 0);
    const collar = new THREE.BoxGeometry(0.075, 0.03, 0.075);
    collar.translate(0, 1.17, 0);
    const pr = [lean[0], 0.2, R.range(-0.02, 0.02)];
    for (const g of [post, fin, collar]) b.add(iron(xf(g, { r: pr, t: [-1.5, 0, 0] }), R, rust));
    b.boxCollider(0, 0.65, 0, 1.5, 0.65, 0.05);
    return b.build();
  },
  { kind: 'prop', variants: 3 }
);

// ---------------------------------------------------------------------------------------------
// The cemetery gate: two ashlar piers, an iron overthrow between them, one leaf left hanging open
// on its lower hinge. The other leaf is gone. The way between the piers is clear.
// ---------------------------------------------------------------------------------------------
register(
  'gate_iron',
  (seed) => {
    const R = new Rng(seed * 419 + 7);
    const b = new Builder();
    const T = new Tris();
    const shade = weathering({ seed: seed + 57, moss: 0.65, mossTop: 0.9, lichen: 0.6 });
    const PX = 1.36,
      HWP = 0.31,
      HP = 2.15;
    const out = [];
    const stone = (g, c = null) => out.push(stonePaint(g, { color: c || stoneTone(R, { base: PAL.stone, vary: 0.08 }), shadeAt: shade }));
    const ballDown = R.sign(); // the pier that has lost its finial
    for (const side of [-1, 1]) {
      // one pier has begun to go over
      const M = new THREE.Matrix4()
        .makeTranslation(side * PX, 0, 0)
        .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(R.range(-0.02, 0.02), 0, side === ballDown ? side * -0.045 : R.range(-0.012, 0.012))))
        .multiply(new THREE.Matrix4().makeTranslation(-side * PX, 0, 0));
      const post = (p) => p.applyMatrix4(M);
      const put = (g, y) => {
        g.translate(side * PX, y, 0);
        g.applyMatrix4(M);
        return g;
      };
      stone(put(hewn(0.8, 0.9, 0.8, R, { j: 0.025 }), -0.36), stoneTone(R, { base: PAL.stoneDark }));
      stone(put(hewn(0.72, 0.24, 0.72, R), 0.2));
      const lv = courseLevels({ v0: 0.32, v1: HP, course: [0.3, 0.38], rng: R });
      prismFaces(side * PX - HWP, side * PX + HWP, -HWP, HWP, post).forEach((f) => {
        const rows = courses({ u0: f.u0, u1: f.u1, len: [0.2, 0.62], rng: R, levels: lv });
        masonry(T, rows, { map: f.map, wF: 0, wB: -HWP, rng: R, shadeAt: shade, base: 0.32, chip: 0, ridge: false, pockets: 0.05, bump: 0.02, solid: (u) => u < f.u0 || u > f.u1 });
      });
      stone(put(hewn(0.78, 0.11, 0.78, R), HP + 0.055), stoneTone(R, { base: PAL.stoneLight, vary: 0.06 }));
      stone(put(shaft4(0.66, 0.16, 0.26, 2), HP + 0.11));
      if (side !== ballDown) {
        stone(put(new THREE.IcosahedronGeometry(0.11, 1), HP + 0.45));
      } else {
        const ball = new THREE.IcosahedronGeometry(0.11, 1);
        ball.translate(side * (PX + 0.75), 0.07, 0.5);
        stone(ball);
      }
      // hinge pintles on the inner face
      for (const y of [0.42, 1.62]) {
        const pin = new THREE.BoxGeometry(0.07, 0.035, 0.035);
        pin.translate(side * (PX - HWP - 0.03), y, 0.04);
        pin.applyMatrix4(M);
        b.add(iron(pin, R, 0.6));
      }
      b.boxCollider(side * PX, 1.1, 0, 0.36, 1.1, 0.36);
    }
    b.add(T.build(), out);

    // the overthrow: two arcs of iron and a crest of spears, sagging at one end
    const IX = PX - HWP; // inner face of a pier
    const sag = ballDown;
    const arc = (lift) => {
      const pts = [];
      for (let i = 0; i <= 8; i++) {
        const x = lerp(-IX, IX, i / 8);
        const k = Math.max(0, (x * sag) / IX);
        pts.push([x, 1.92 + lift + 0.42 * Math.cos(((x / IX) * Math.PI) / 2) - k * k * 0.12, k * 0.05]);
      }
      return pts;
    };
    const lo = arc(0),
      hi = arc(0.16);
    b.add(iron(tube(lo, 0.013, 4, { samples: 16 }), R, 0.4), iron(tube(hi, 0.013, 4, { samples: 16 }), R, 0.4));
    for (let i = 1; i < 8; i++) {
      const a = lo[i],
        e = [hi[i][0], hi[i][1] + (i === 4 ? 0.16 : 0.06), hi[i][2]];
      const s = new THREE.BoxGeometry(0.014, dist3(a, e), 0.014);
      s.translate(0, dist3(a, e) / 2, 0);
      b.add(iron(aim(s, a, e), R, 0.4));
      const sp = spear(i === 4 ? 0.2 : 0.13, i === 4 ? 0.032 : 0.022);
      b.add(iron(aim(sp, e, [e[0], e[1] + 1, e[2]]), R, 0.4));
    }

    // the leaf: hinge stile at x = 0, built flat, then sagged on its one hinge and swung inward
    const LW = 0.98;
    const topY = (x) => 1.68 + 0.3 * (x / LW);
    const leaf = [];
    const stick = (a, e, t = 0.02, w = t) => {
      const g = new THREE.BoxGeometry(w, dist3(a, e), t);
      g.translate(0, dist3(a, e) / 2, 0);
      leaf.push(iron(aim(g, a, e), R, 0.42));
    };
    stick([0.015, 0.1, 0], [0.015, topY(0) + 0.02, 0], 0.034);
    stick([LW, 0.1, 0], [LW, topY(LW) + 0.02, 0], 0.034);
    stick([0, 0.24, 0], [LW, 0.24, 0], 0.014, 0.04);
    stick([0, 0.96, 0], [LW, 0.96, 0], 0.014, 0.04);
    stick([0, topY(0), 0], [LW, topY(LW), 0], 0.014, 0.04);
    stick([0.02, 0.26, 0.012], [LW - 0.02, 0.94, 0.012], 0.008, 0.03);
    for (let i = 1; i <= 6; i++) {
      const x = (LW * i) / 7;
      stick([x, 0.12, 0], [x, topY(x) + 0.14, 0], 0.016);
      const sp = spear(0.15, 0.025);
      sp.translate(x, topY(x) + 0.14, 0);
      leaf.push(iron(sp, R, 0.42));
    }
    for (let i = 0; i < 7; i++) {
      const x = (LW * (i + 0.5)) / 7;
      stick([x, 0.24, 0], [x, 0.62, 0], 0.012);
      const sp = spear(0.1, 0.02);
      sp.translate(x, 0.62, 0);
      leaf.push(iron(sp, R, 0.42));
    }
    const ring = new THREE.TorusGeometry(0.05, 0.008, 4, 8);
    ring.translate(LW - 0.06, 1.02, 0.02);
    leaf.push(iron(ring, R, 0.42));
    const open = R.range(1.05, 1.3);
    for (const g of leaf) {
      g.translate(0, -0.42, 0); // pivot on the lower hinge
      xf(g, { r: [0.05, 0, -0.085] });
      xf(g, { r: [0, open, 0], t: [-IX + 0.035, 0.42, 0.04] });
      b.add(g);
    }
    return b.build();
  },
  { kind: 'structure' }
);
