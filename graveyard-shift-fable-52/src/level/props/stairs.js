// The structure of an area as the level's shell draws it, and the motel's stairs and rails.
// shellStructure(): every worldLayout.structure box of a zone, drawn in the always-drawn shell (so a
// culled zone is never a hole) with a collider at exactly that box. Rails, posts and stairs get real
// shapes inside their boxes.
import { M, box, cyl, rgb } from '../build.js';

const GALV = 'paintGalv';

// colors: { wall, solid, roof, floor, block, ... } linear rgb by structure kind; skip(s) -> true to
// leave a box undrawn here (the caller draws it; the collider is still made).
export function shellStructure(B, W, zone, colors, skip = () => false) {
  B.inZone('shell', () => {
    for (const s of W.structure) {
      if (s.zone !== zone) continue;
      const [x0, y0, z0] = s.min, [x1, y1, z1] = s.max;
      const mid = M((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      if (!skip(s)) {
        if (s.kind === 'rail') rail(B, s);
        else if (s.kind === 'post') {
          B.add(GALV, box(0.12, y1 - y0, 0.12, 0.012, 1), { m: mid, shadow: true });
          B.add(GALV, box(0.24, 0.02, 0.24), { m: M((x0 + x1) / 2, y0 + 0.01, (z0 + z1) / 2) });
          B.add(GALV, box(0.22, 0.14, 0.22, 0.01, 1), { m: M((x0 + x1) / 2, y1 - 0.07, (z0 + z1) / 2) });
        } else if (s.kind === 'stair') {
          // the tread with a nosing, on a solid stringer-coloured base
          B.add('vcMatte', box(x1 - x0, y1 - y0 - 0.04, z1 - z0), { m: M((x0 + x1) / 2, (y0 + y1) / 2 - 0.02, (z0 + z1) / 2), color: colors.stairBase || colors.stair });
          B.add('vcMatte', box(x1 - x0 + 0.02, 0.045, z1 - z0 + 0.02, 0.01, 1), { m: M((x0 + x1) / 2, y1 - 0.0225, (z0 + z1) / 2), color: colors.stair, shadow: true });
        } else {
          const big = s.kind === 'wall' || s.kind === 'solid' || s.kind === 'block' || s.kind === 'roof' || s.kind === 'floor';
          B.add('vcMatte', box(x1 - x0, y1 - y0, z1 - z0), { m: mid, color: colors[s.kind] || colors.wall, shadow: big });
        }
      }
      B.tag(`${zone}:${s.kind}`, () => B.collide(s.min, s.max, s.surface));
      if (s.kind === 'stair') B.colliders[B.colliders.length - 1].stair = s.stair;
      if (s.shelter) B.rainOccluders.push({ min: s.min.slice(), max: s.max.slice() });
    }
  });
}

// A rail inside its structure box: top and mid rails, a toe bar, and pickets. The box of a stair
// rail runs from the ground: only its top 1.2 m is rail, the rest is the stair's closed side.
function rail(B, s) {
  const [x0, y0, z0] = s.min, [x1, y1, z1] = s.max;
  const alongX = x1 - x0 > z1 - z0;
  const len = alongX ? x1 - x0 : z1 - z0;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const h = Math.min(1.2, y1 - y0), yb = y1 - h;
  // plain boxes and four-sided pickets: the rails are in the always-drawn shell, on every tier
  const bar = (y, t) => B.add(GALV, alongX ? box(len, t, 0.05) : box(0.05, t, len), { m: M(cx, y, cz) });
  bar(y1 - 0.025, 0.05); bar(yb + h * 0.5, 0.03); bar(yb + 0.1, 0.03);
  const n = Math.max(1, Math.round(len / 0.14));
  for (let i = 0; i <= n; i++) {
    const a = -len / 2 + (len * i) / n;
    B.add(GALV, cyl(0.0125, 0.0125, h - 0.1, 4, true), { m: M(cx + (alongX ? a : 0), yb + h / 2 + 0.02, cz + (alongX ? 0 : a), 0, Math.PI / 4, 0) });
  }
  if (yb - y0 > 0.05) B.add('vcMatte', alongX ? box(len, yb - y0, 0.08) : box(0.08, yb - y0, len), { m: M(cx, (y0 + yb) / 2, cz), color: rgb(0x6f6c66, 0.6), shadow: true });
}

// a round handrail post cap, for the ends of rail runs (dressing only)
export function railCap(B, x, y, z) {
  B.add(GALV, cyl(0.035, 0.035, 0.06, 8), { m: M(x, y, z) });
}
