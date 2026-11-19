import { PROP, DECAL } from '../shared/tileformat.js';

export const DECAL_COLS = 4, DECAL_ROWS = 3;
const size = (v) => (v <= DECAL.THROUGH_RIGHT ? [1.7, 5] : v === DECAL.STOP ? [1.6, 5.4] : [2.1, 4.6]);

// Road arrows, stop text and speed numbers share the road's triangulation. UVs are interpolated
// when a symbol crosses a terrain triangle so the atlas stays continuous over slopes and crests.
export function decalMesh(props, drape) {
  const position = [], normal = [], uv = [];
  for (const p of props) {
    if (p.kind !== PROP.DECAL) continue;
    const [w, len] = size(p.variant), dx = Math.sin(p.rot), dz = Math.cos(p.rot);
    const u0 = (p.variant % DECAL_COLS) / DECAL_COLS, v1 = 1 - Math.floor(p.variant / DECAL_COLS) / DECAL_ROWS;
    const corner = (s, t) => [
      p.x - dz * s * w / 2 + dx * (t - 0.5) * len,
      p.z + dx * s * w / 2 + dz * (t - 0.5) * len,
      u0 + ((s + 1) / 2) / DECAL_COLS, v1 - (1 - t) / DECAL_ROWS,
    ];
    const emit = (...vertices) => {
      for (const v of vertices) {
        position.push(v[0], drape.height(v[0], v[1]) + 0.17, v[1]);
        normal.push(0, 1, 0);
        uv.push(v[2], v[3]);
      }
    };
    const a = corner(-1, 0), b = corner(1, 0), c = corner(1, 1), d = corner(-1, 1);
    drape.triangle(a, b, c, emit);
    drape.triangle(a, c, d, emit);
  }
  return { position: Float32Array.from(position), normal: Float32Array.from(normal), uv: Float32Array.from(uv) };
}
