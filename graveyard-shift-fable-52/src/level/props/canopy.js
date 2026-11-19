// Fuel canopy (deck, fascia, soffit, downlight housings, columns with guards) and the price sign.
import { M, box, boxUp, cyl, cylUp, quadUV, rgb, sphere } from '../build.js';

const SEAM = rgb(0x3a3d3f);
const DARK = rgb(0x121416);
const RED = rgb(0x8a0f0c);
const WHITE = rgb(0xd6d4cb, 0.7);

// c: { x0, x1, z0, z1, under (soffit height), lights: [{ x, z, state: 'on'|'dead'|'flicker' }], logos }
// smooth value noise for the water stains on the soffit
const hash = (i, j) => { const v = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return v - Math.floor(v); };
function stainNoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  return (hash(xi, zi) * (1 - u) + hash(xi + 1, zi) * u) * (1 - v) + (hash(xi, zi + 1) * (1 - u) + hash(xi + 1, zi + 1) * u) * v;
}

export function buildCanopy(B, c) {
  const w = c.x1 - c.x0, d = c.z1 - c.z0, cx = (c.x0 + c.x1) / 2, cz = (c.z0 + c.z1) / 2;
  const u = c.under;
  // deck; the soffit is a separate skin carrying baked bounce light from the lit ground below
  B.add('paintCanopy', box(w - 0.1, 0.7, d - 0.1), { m: M(cx, u + 0.41, cz), shadow: true });
  B.refl([c.x0 + 0.05, u + 0.06, c.z0 + 0.05], [c.x1 - 0.05, u + 0.76, c.z1 - 0.05], WHITE);
  {
    const nx = Math.round(w / 0.25), nz = Math.round(d / 0.25); // fine enough to hold a tide mark
    const pos = [], col = [], idx = [];
    const live = c.lights.filter((l) => l.state !== 'dead');
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const x = c.x0 + 0.05 + ((w - 0.1) * i) / nx, z = c.z0 + 0.05 + ((d - 0.1) * j) / nz;
      let e = 0.006;
      for (const l of live) { const r2 = (x - l.x) ** 2 + (z - l.z) ** 2; e += (l.state === 'flicker' ? 0.03 : 0.085) / (1 + r2 / 9) ** 1.5; }
      // the edges see the dark lot as well as the lit pad
      const edge = Math.min(x - c.x0, c.x1 - x, z - c.z0, c.z1 - z);
      e *= 0.55 + 0.45 * Math.min(1, edge / 2.5);
      // water gets in at the seams: tide marks spreading from the edges and round the dead fixtures
      // (a broad field of damp, heaviest toward the edges and along the west fascia where the gutter
      // has failed, cut into patches by a finer one; each patch dries from its rim inward and
      // leaves a brown line where it stopped)
      const wet = stainNoise(x * 0.42, z * 0.42) * 0.7 + stainNoise(x * 1.7 + 9, z * 1.7) * 0.3;
      const reach = 0.74 + 0.5 * Math.max(0, 1 - edge / 3.2) + 0.4 * Math.max(0, 1 - (x - c.x0) / 6);
      let stain = Math.max(0, wet * reach - 0.36) * 3;
      for (const l of c.lights) if (l.state === 'dead') stain = Math.max(stain, 1.1 * Math.max(0, 1 - Math.hypot(x - l.x, z - l.z) / 1.6) * (0.45 + stainNoise(x * 2, z * 2)));
      stain = Math.min(1, stain);
      const rim = Math.max(0, 1 - Math.abs(stain - 0.22) / 0.14) + 0.6 * Math.max(0, 1 - Math.abs(stain - 0.62) / 0.1); // tide lines
      const dark = 1 - 0.58 * stain - 0.38 * Math.min(1, rim) * Math.min(1, stain * 4);
      const rust = Math.min(1, 0.6 * stain + 0.5 * rim * Math.min(1, stain * 4)); // brown where it dried
      e *= dark;
      pos.push(x, u + 0.055, z);
      col.push(e * (0.93 + 0.1 * rust), e * (1.0 - 0.12 * rust), e * (0.94 - 0.34 * rust));
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a0 = j * (nx + 1) + i; idx.push(a0, a0 + 1, a0 + nx + 1, a0 + 1, a0 + nx + 2, a0 + nx + 1); }
    B.addRaw('vcGlow', pos, idx, col, [0, -1, 0]);
  }
  for (let x = c.x0 + 0.6; x < c.x1 - 0.3; x += 0.6) B.add('vcMatte', box(0.018, 0.004, d - 0.3), { m: M(x, u + 0.052, cz), color: SEAM });
  for (const z of [c.z0 + 3.25, cz, c.z1 - 3.25]) B.add('vcMatte', box(w - 0.3, 0.004, 0.03), { m: M(cx, u + 0.051, z), color: SEAM }); // panel ends
  // box gutters inside the long fascias, falling to a downpipe on two of the columns
  for (const z of [c.z0 + 0.16, c.z1 - 0.16]) B.add('paintGalv', box(w - 0.3, 0.09, 0.2, 0.01, 1), { m: M(cx, u + 0.005, z) });
  // CCTV. Two pendant domes on drop poles over the lanes (a smoked bubble under a white housing,
  // a red recording lamp still lit on one), and a bullet camera on the store side.
  for (const [x, z, on] of [[c.x0 + 5.6, cz + 0.1, true], [cx + 3.4, cz - 2.6, false]]) {
    B.add('paintCanopy', cyl(0.07, 0.07, 0.03, 10), { m: M(x, u + 0.035, z) });
    B.add('paintCanopy', cyl(0.022, 0.022, 0.5, 8), { m: M(x, u - 0.2, z) });
    B.add('paintCanopy', cyl(0.15, 0.11, 0.16, 14), { m: M(x, u - 0.5, z), shadow: true });
    B.add('vcGloss', sphere(0.135, 14, 10), { m: M(x, u - 0.58, z, 0, 0, 0, 1, 0.8, 1), color: rgb(0x050607) });
    B.add('vcGlow', sphere(0.014, 6, 4), { m: M(x - 0.13, u - 0.52, z + 0.06), color: on ? [9, 0.25, 0.1] : [0.02, 0.004, 0.004] });
    // the cable run back along the soffit to the store side
    B.add('vcMatte', box(0.025, 0.02, z - c.z0 - 0.3), { m: M(x + 0.09, u + 0.04, (z + c.z0 + 0.3) / 2), color: rgb(0x55534c) });
  }
  B.add('paintCanopy', box(0.08, 0.1, 0.24, 0.02, 1), { m: M(c.x0 + 2.2, u - 0.06, c.z0 + 0.5, 0.35, 0.5, 0) });
  B.add('vcMatte', cyl(0.012, 0.012, 0.12, 5), { m: M(c.x0 + 2.2, u, c.z0 + 0.5), color: DARK });
  // fascia: trim, white band, back-lit colour band in panels (a few have failed), LED pinstripe, cap
  const rng = B.rng.fork('fascia');
  const side = (len, m, lit) => {
    B.add('chrome', box(len, 0.05, 0.1, 0.012, 1), { m: m.clone().multiply(M(0, u + 0.025, 0)) });
    B.add('paintCanopy', box(len, 0.3, 0.07, 0.01, 1), { m: m.clone().multiply(M(0, u + 0.2, 0)) });
    B.add('paintTeal', box(len, 0.46, 0.07, 0.012, 1), { m: m.clone().multiply(M(0, u + 0.57, -0.005)), shadow: true });
    const n = Math.round(len / 2.2), pl = len / n;
    for (let i = 0; i < n; i++) {
      const dead = !lit || rng.next() < 0.14;
      B.add('vcGlow', box(pl - 0.03, 0.4, 0.02), { m: m.clone().multiply(M(-len / 2 + (i + 0.5) * pl, u + 0.57, 0.034)), color: dead ? rgb(0x0c7f79, 0.02) : rgb(0x0c8f86, rng.range(0.9, 1.25)) });
      B.add('vcGlow', box(pl - 0.03, 0.05, 0.03), { m: m.clone().multiply(M(-len / 2 + (i + 0.5) * pl, u + 0.325, 0.034)), color: dead ? rgb(0xf5a31a, 0.03) : rgb(0xf5a31a, 5) });
    }
    B.add('paintCanopy', box(len + 0.04, 0.1, 0.14, 0.02, 1), { m: m.clone().multiply(M(0, u + 0.84, -0.01)) });
  };
  side(w + 0.1, M(cx, 0, c.z1, 0, 0, 0), true);
  side(w + 0.1, M(cx, 0, c.z0, 0, Math.PI, 0), true);
  side(d + 0.1, M(c.x1, 0, cz, 0, Math.PI / 2, 0), false);
  side(d + 0.1, M(c.x0, 0, cz, 0, -Math.PI / 2, 0), true);
  // back-lit brand boxes on the fascia
  for (const l of c.logos || []) {
    B.add('vcMatte', box(3.5, 0.98, 0.16, 0.02, 1), { m: M(l.x, u + 0.47, l.z, 0, l.ry, 0), color: DARK });
    B.add('atlasGlowVc', quadUV(3.36, 0.924, B.atlas.uv('logo')), { m: M(l.x, u + 0.47, l.z, 0, l.ry, 0).multiply(M(0, 0, 0.083)), color: [l.nits, l.nits, l.nits] });
  }
  // downlight housings, recessed in the soffit: a trim ring, the dark throat of the can, the lens up inside it
  for (const l of c.lights) {
    B.add('paintCanopy', box(0.7, 0.03, 0.7, 0.012, 1), { m: M(l.x, u + 0.04, l.z) });
    for (const [dx, dz, sx, sz] of [[0.31, 0, 0.035, 0.6], [-0.31, 0, 0.035, 0.6], [0, 0.31, 0.6, 0.035], [0, -0.31, 0.6, 0.035]]) B.add('paintCanopy', box(sx, 0.07, sz), { m: M(l.x + dx, u + 0.02, l.z + dz) });
    B.add('vcMatte', box(0.5, 0.03, 0.5), { m: M(l.x, u + 0.03, l.z), color: DARK });
    const on = l.state === 'on';
    if (l.state === 'flicker') B.add('flickA', box(0.44, 0.02, 0.44), { m: M(l.x, u + 0.018, l.z) });
    else B.add(on ? 'vcGlow' : 'vcGloss', box(0.44, 0.02, 0.44), { m: M(l.x, u + 0.018, l.z), color: on ? B.glow.canopy : rgb(0x1c2022) });
    if (l.state !== 'dead') B.fixtures.push({ kind: 'canopy', pos: [l.x, u - 0.02, l.z], flicker: l.state === 'flicker' });
  }
  // gutter outlets and downpipes at two corners
  for (const [x, z] of [[c.x0 + 0.25, c.z0 + 0.25], [c.x1 - 0.25, c.z1 - 0.25]]) B.add('paintCanopy', cyl(0.05, 0.05, 0.5, 8), { m: M(x, u - 0.2, z) });
  B.shelter([c.x0, u, c.z0], [c.x1, u + 0.9, c.z1]);
  B.collide([c.x0, u, c.z0], [c.x1, u + 0.9, c.z1], 'metal');
}

// Column standing on an island. Local origin on the island top. o: { number, extinguisher, shutoff, towel }
export function buildColumn(B, height, o = {}) {
  B.add('paintCanopy', boxUp(0.42, height, 0.42, 0.03, 2), { shadow: true });
  // concrete-filled steel sleeve: the bit that actually stops a bumper
  B.add('paintYellow', boxUp(0.6, 0.95, 0.6, 0.04, 2), { shadow: true });
  B.add('vcMatte', boxUp(0.5, 0.02, 0.5), { m: M(0, 0.95, 0), color: rgb(0x55534c) });
  // where bumpers have found it: paint scraped back to steel in bands, a corner knocked off
  for (const [y, hgt, dx, f] of [[0.42, 0.07, 0.02, 1], [0.5, 0.035, -0.06, 1], [0.36, 0.05, 0.1, -1], [0.58, 0.03, 0.0, -1]]) {
    B.add('vcGloss', box(0.5, hgt, 0.012), { m: M(dx * f, y, f * 0.303), color: rgb(0x2a2c2e) });
    B.add('vcMatte', box(0.3, hgt * 0.5, 0.013), { m: M(dx * f + 0.05, y - hgt * 0.1, f * 0.304), color: rgb(0x6a2a12) });
  }
  B.add('vcMatte', box(0.14, 0.16, 0.14), { m: M(0.26, 0.9, 0.26, 0.4, 0.78, 0.3), color: rgb(0x77746b) });
  if (o.pipe) {
    B.add('paintGalv', cyl(0.045, 0.045, height - 0.25, 8), { m: M(0.16, height / 2 + 0.1, -0.255), shadow: true });
    B.add('paintGalv', cyl(0.045, 0.045, 0.28, 8), { m: M(0.16, 0.2, -0.33, -0.9, 0, 0) });
    for (const y of [1.3, 2.6, 3.9]) B.add('paintGalv', box(0.14, 0.03, 0.06), { m: M(0.16, y, -0.23) });
  }
  B.add('chrome', box(0.46, 0.05, 0.46, 0.01, 1), { m: M(0, height - 0.1, 0) });
  for (const f of [1, -1]) {
    const face = (x, y, z) => M(f * x, y, f * z, 0, f > 0 ? 0 : Math.PI, 0);
    if (o.number) {
      B.add('vcMatte', box(0.56, 0.56, 0.03, 0.01, 1), { m: face(0, 3.1, 0.23), color: DARK });
      B.add('atlasLit', quadUV(0.5, 0.5, B.atlas.sub('numbers', (o.number - 1) / 8, 0, o.number / 8, 1)), { m: face(0, 3.1, 0.2465) });
    }
  }
  if (o.extinguisher) {
    B.add('vcGloss', boxUp(0.3, 0.62, 0.2, 0.02, 1), { m: M(0.31, 1.15, 0), color: RED });
    B.add('vcGloss', cylUp(0.065, 0.065, 0.42, 10), { m: M(0.44, 1.2, 0), color: rgb(0xb3130f) });
  }
  if (o.shutoff) B.add('atlasLit', quadUV(0.42, 0.24, B.atlas.uv('shutoff')), { m: M(-0.215, 1.75, 0, 0, -Math.PI / 2, 0) });
  if (o.towel) {
    // towel dispenser and squeegee bucket
    B.add('vcGloss', boxUp(0.3, 0.36, 0.14, 0.02, 1), { m: M(-0.3, 1.25, 0, 0, Math.PI / 2, 0), color: rgb(0x1d3f6e) });
    B.add('vcGloss', boxUp(0.26, 0.42, 0.22, 0.03, 2), { m: M(-0.36, 0.0, 0.0), color: rgb(0x16181a), shadow: true });
    B.add('vcGloss', cyl(0.012, 0.012, 0.6, 6), { m: M(-0.36, 0.6, 0.02, 0.25, 0, 0.12), color: rgb(0x8a6a14) });
  }
  B.refl([-0.21, 0.95, -0.21], [0.21, height, 0.21], WHITE);
  B.refl([-0.3, 0, -0.3], [0.3, 0.95, 0.3], rgb(0xd7a50d, 0.7));
  B.collide([-0.31, 0, -0.31], [0.31, height, 0.31], 'metal');
}

// Price sign: two legs, a cabinet with the brand and three price boards, both faces lit.
// Local origin on the ground between the legs; faces look along +z and -z.
export function buildPriceSign(B, o = {}) {
  const W = 2.7;
  for (const s of [1, -1]) {
    B.add('paintTeal', boxUp(0.26, 8.0, 0.34, 0.03, 2), { m: M(s * (W / 2 + 0.05), 0, 0), shadow: true });
    B.add('concrete', boxUp(0.7, 0.4, 0.7, 0.03, 1), { m: M(s * (W / 2 + 0.05), 0, 0), shadow: true });
    B.collide([s * (W / 2 + 0.05) - 0.35, 0, -0.35], [s * (W / 2 + 0.05) + 0.35, 8, 0.35], 'metal');
  }
  B.add('vcMatte', box(W - 0.1, 5.3, 0.42), { m: M(0, 5.25, 0), color: DARK, shadow: true });
  B.refl([-W / 2 + 0.05, 2.6, -0.2], [W / 2 - 0.05, 7.9, 0.2], DARK);
  for (const s of [1, -1]) B.refl([s * (W / 2 + 0.05) - 0.13, 0, -0.17], [s * (W / 2 + 0.05) + 0.13, 8, 0.17], rgb(0x0c7f79, 0.8));
  B.add('paintTeal', box(W + 0.36, 0.14, 0.5, 0.03, 1), { m: M(0, 7.98, 0) });
  const rows = [['logo', 0.74, 6], ['priceRegular', 0.78, 4.5], ['pricePlus', 0.78, o.dimPlus ? 1.2 : 4.5], ['priceDiesel', 0.78, 4.5], ['signExtras', 0.6, 2.5]];
  for (const f of [1, -1]) {
    let y = 7.86;
    for (const [name, h, nits] of rows) {
      const m = M(0, y - h / 2, f * 0.215, 0, f > 0 ? 0 : Math.PI, 0);
      B.add('atlasGlowVc', quadUV(W - 0.16, h - 0.04, B.atlas.uv(name)), { m, color: [nits, nits, nits] });
      y -= h + 0.06;
      B.add('paintTeal', box(W - 0.06, 0.06, 0.03, 0.008, 1), { m: M(0, y + 0.03, f * 0.215) });
    }
    B.add('atlasLit', quadUV(0.5, 0.7, B.atlas.uv('airWater')), { m: M(0, 1.9, f * 0.01, 0, f > 0 ? 0 : Math.PI, 0) });
  }
  // planter kerb round the legs
  B.add('concreteKerb', boxUp(W + 1.3, 0.16, 1.3, 0.03, 1), { shadow: true });
  B.collide([-W / 2 - 0.65, 0, -0.65], [W / 2 + 0.65, 0.16, 0.65], 'concrete');
  B.fixtures.push({ kind: 'sign', pos: B.point(0, 5.0, 1.2) }, { kind: 'sign', pos: B.point(0, 5.0, -1.2) });
}
