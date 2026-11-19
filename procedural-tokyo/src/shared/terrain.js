// Height grid sampling shared by the compiler and the client.
// A grid is { x0, z0, step, w, h, data: Float32Array } with rows running along +z (north -> south).

// Bilinear height at world (x, z), clamped to the grid edges.
export function sampleGrid(g, x, z) {
  const fx = Math.min(Math.max((x - g.x0) / g.step, 0), g.w - 1.001);
  const fz = Math.min(Math.max((z - g.z0) / g.step, 0), g.h - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  const d = g.data, w = g.w;
  return (d[j * w + i] * (1 - tx) + d[j * w + i + 1] * tx) * (1 - tz) +
    (d[(j + 1) * w + i] * (1 - tx) + d[(j + 1) * w + i + 1] * tx) * tz;
}
