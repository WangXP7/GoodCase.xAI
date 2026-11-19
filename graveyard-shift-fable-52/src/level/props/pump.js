// Fuel dispenser, pump island and its impact guards. Pump local space: x along the island, the two
// customer faces look along +z and -z, y = 0 is the island top.
import { M, box, boxUp, cyl, cylUp, extrude, roundPoly, quadUV, rgb, tube, torus } from '../build.js';

const BLACK = rgb(0x060607);
const DARK = rgb(0x15171a);
const GRIPS = [rgb(0x101010), rgb(0x0c5a22), rgb(0x8a1010), rgb(0x0f2c7a)];

export const ISLAND = { length: 6.4, width: 1.25, height: 0.18 };

// A nozzle: spout, body, lever guard. Local origin at the grip, spout pointing along -y/+z.
function nozzle(B, m, grip) {
  B.add('vcGloss', box(0.055, 0.2, 0.075, 0.02, 2), { m: m.clone().multiply(M(0, 0, 0)), color: grip });
  B.add('chrome', cyl(0.014, 0.016, 0.24, 8), { m: m.clone().multiply(M(0, -0.16, 0.06, 0.9, 0, 0)) });
  B.add('chrome', box(0.04, 0.07, 0.06, 0.015, 1), { m: m.clone().multiply(M(0, -0.09, 0.02)) });
  B.add('vcGloss', torus(0.07, 0.008, 5, 10, Math.PI).rotateY(Math.PI / 2), { m: m.clone().multiply(M(0, 0.0, -0.045, 0, 0, Math.PI / 2)), color: BLACK });
}

// o: { lcd: 'pumpLcd'|'pumpLcdIdle'|null (dead display), number, out: [{ face: 1|-1, side: 1|-1, to: [x,y,z], lay }] }
export function buildPump(B, o = {}) {
  const W = 1.08;
  B.add('vcMatte', boxUp(W + 0.06, 0.1, 0.62, 0.015, 1), { color: BLACK });
  B.add('paintTeal', boxUp(W, 0.86, 0.56, 0.03, 2), { m: M(0, 0.1, 0), shadow: true });
  B.add('paintPump', boxUp(W, 0.7, 0.46, 0.025, 2), { m: M(0, 0.96, 0), shadow: true });
  B.add('paintPump', boxUp(W + 0.04, 0.42, 0.54, 0.035, 2), { m: M(0, 1.64, 0), shadow: true });
  B.add('paintTeal', boxUp(W + 0.1, 0.24, 0.34, 0.03, 2), { m: M(0, 2.06, 0), shadow: true });
  for (const f of [1, -1]) {
    const ry = f > 0 ? 0 : Math.PI;
    const face = (x, y, z) => M(f * x, y, f * z, 0, ry, 0);
    // kick plate, cabinet door seam, vent slats
    B.add('chrome', box(W - 0.06, 0.07, 0.01, 0.003, 1), { m: face(0, 0.17, 0.282) });
    B.add('vcMatte', box(0.008, 0.72, 0.006), { m: face(0, 0.56, 0.281), color: BLACK });
    for (let i = 0; i < 5; i++) B.add('vcMatte', box(0.3, 0.012, 0.006), { m: face(-0.27, 0.74 + i * 0.03, 0.281), color: BLACK });
    B.add('chrome', cyl(0.02, 0.02, 0.012, 10).rotateX(Math.PI / 2), { m: face(0.06, 0.58, 0.283) });
    // centre panel: card reader, keypad, grade buttons, brand
    B.add('atlasLit', quadUV(0.5, 0.69, B.atlas.uv('pumpFace')), { m: face(0, 1.31, 0.2325) });
    // display
    B.add('vcMatte', box(0.5, 0.26, 0.012, 0.004, 1), { m: face(0, 1.85, 0.272), color: BLACK });
    if (o.lcd) B.add('atlasGlowVc', quadUV(0.42, 0.21, B.atlas.uv(o.lcd)), { m: face(0, 1.85, 0.2795), color: [2.2, 2.2, 2.2] });
    // lit brand valance
    B.add('atlasGlowVc', quadUV(W - 0.02, (W - 0.02) * 0.275, B.atlas.uv('logo')), { m: face(0, 2.18, 0.1715), color: o.dead ? [0.04, 0.04, 0.04] : [2.6, 2.6, 2.6] });
    if (o.number) B.add('atlasLit', quadUV(0.17, 0.17, B.atlas.sub('numbers', (o.number - 1) / 8, 0, o.number / 8, 1)), { m: face(-0.42, 1.94, 0.2715) });
    // nozzle bays either side of the panel
    for (const s of [1, -1]) {
      const bx = s * 0.4;
      B.add('vcMatte', box(0.2, 0.56, 0.008), { m: face(bx, 1.3, 0.2315), color: BLACK });
      B.add('vcGloss', box(0.13, 0.1, 0.09, 0.02, 1), { m: face(bx, 1.12, 0.265), color: DARK });
      const grip = GRIPS[(s > 0 ? 0 : 2) + (f > 0 ? 0 : 1)];
      const out = (o.out || []).find((q) => q.face === f && q.side === s);
      // hose: out of the head, down in a loop, back up to the nozzle (or away to wherever it was left)
      const top = [f * (bx + s * 0.1), 1.62, f * 0.3];
      let end, pts;
      if (out) {
        end = out.to;
        const midx = (top[0] + end[0]) / 2, midz = (top[2] + end[2]) / 2;
        pts = [top, [top[0], 1.3, top[2] + f * 0.12], [top[0] * 0.7 + end[0] * 0.3, out.lay ? 0.02 - (B.baseY || 0) : 0.45, top[2] * 0.7 + end[2] * 0.3 + f * 0.25],
          [midx, out.lay ? 0.0 - (B.baseY || 0) + 0.02 : 0.4, midz + f * 0.2], [end[0] * 0.85 + top[0] * 0.15, out.lay ? 0.02 - (B.baseY || 0) : end[1] - 0.15, end[2] * 0.85 + top[2] * 0.15], end];
        const dx = end[0] - midx, dz = end[2] - midz;
        nozzle(B, M(end[0], end[1], end[2], out.lay ? Math.PI / 2 : 0.3, Math.atan2(dx, dz), 0), grip);
      } else {
        end = [f * bx, 1.3, f * 0.31];
        pts = [top, [top[0] + f * s * 0.03, 1.2, top[2] + f * 0.14], [top[0] + f * s * 0.02, 0.62, top[2] + f * 0.2], [(top[0] + end[0]) / 2, 0.42, f * 0.46], [end[0] - f * s * 0.02, 0.7, f * 0.44], [end[0], 1.1, f * 0.37], end];
        nozzle(B, face(bx, 1.34, 0.3).multiply(M(0, 0, 0, -0.5, 0, 0)), grip);
      }
      B.add('rubber', tube(pts, 0.017, 6, 5));
    }
  }
  B.refl([-W / 2, 0, -0.28], [W / 2, 0.96, 0.28], rgb(0x0c7f79, 0.8));
  B.refl([-W / 2, 0.96, -0.25], [W / 2, 2.06, 0.25], rgb(0xcfcdc3, 0.75));
  B.refl([-W / 2 - 0.05, 2.06, -0.16], [W / 2 + 0.05, 2.3, 0.16], rgb(0x0c7f79, 0.8));
  B.collide([-W / 2 - 0.03, 0, -0.3], [W / 2 + 0.03, 2.3, 0.3], 'metal', 0.4);
}

// Hooped steel impact guard. Local: hoop spans x, origin on the ground at its centre.
export function buildHoop(B, w = 0.9, h = 1.0) {
  const r = 0.2;
  const pts = [[-w / 2, -0.1, 0], [-w / 2, h - r, 0]];
  for (let i = 1; i <= 5; i++) { const a = (i / 6) * (Math.PI / 2); pts.push([-w / 2 + r - Math.cos(a) * r, h - r + Math.sin(a) * r, 0]); }
  pts.push([0, h, 0]);
  for (let i = 5; i >= 1; i--) { const a = (i / 6) * (Math.PI / 2); pts.push([w / 2 - r + Math.cos(a) * r, h - r + Math.sin(a) * r, 0]); }
  pts.push([w / 2, h - r, 0], [w / 2, -0.1, 0]);
  B.add('paintYellow', tube(pts, 0.055, 8, 3), { shadow: true });
  for (const x of [-w / 2, w / 2]) B.add('vcMatte', cylUp(0.09, 0.09, 0.02, 10), { m: M(x, 0, 0), color: DARK });
  B.collide([-w / 2 - 0.06, 0, -0.07], [w / 2 + 0.06, h, 0.07], 'metal', 0.3);
}

// Island: raised concrete with a painted kerb, two dispensers, a guard hoop at each end.
// Local: island runs along x, origin on the road at its centre. o: { pumps: [optsA, optsB], bin }
export function buildIsland(B, o = {}) {
  const { length: L, width: W, height: H } = ISLAND;
  const r = W / 2 - 0.02;
  const outline = roundPoly([[-L / 2, -W / 2, r], [L / 2, -W / 2, r], [L / 2, W / 2, r], [-L / 2, W / 2, r]], 8);
  const inner = roundPoly([[-L / 2 + 0.09, -W / 2 + 0.09, r - 0.09], [L / 2 - 0.09, -W / 2 + 0.09, r - 0.09], [L / 2 - 0.09, W / 2 - 0.09, r - 0.09], [-L / 2 + 0.09, W / 2 - 0.09, r - 0.09]], 8);
  // extrusions run along z: turn them so the outline lies on the ground
  const lay = (g, y) => g.rotateX(-Math.PI / 2).translate(0, y, 0);
  B.add('concreteKerb', lay(extrude(outline.map((p) => [p[0], -p[1]]), H, { bevel: 0.025, bevelSeg: 2, holes: [inner.map((p) => [p[0], -p[1]]).reverse()] }), H / 2), { shadow: true });
  B.add('concrete', lay(extrude(inner.map((p) => [p[0], -p[1]]), H - 0.01, { smooth: false }), (H - 0.01) / 2));
  B.collide([-L / 2 + 0.3, 0, -W / 2], [L / 2 - 0.3, H, W / 2], 'concrete');
  B.collide([-L / 2, 0, -W / 2 + 0.25], [L / 2, H, W / 2 - 0.25], 'concrete');
  B.blob(L + 1.1, W + 1.0);
  const pumps = o.pumps || [{}, {}];
  B.baseY = H;
  B.at(M(-1.75, H, 0), () => buildPump(B, pumps[0]));
  B.at(M(1.75, H, 0), () => buildPump(B, pumps[1]));
  B.baseY = 0;
  for (const s of [1, -1]) B.at(M(s * (L / 2 + 0.38), 0, 0, 0, Math.PI / 2, 0), () => buildHoop(B, 1.0, 1.05));
}
