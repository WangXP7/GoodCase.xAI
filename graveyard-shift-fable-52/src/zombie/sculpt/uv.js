// The UV atlases. Every cage region owns one rectangle; left and right limbs share theirs (the
// right side is the mirror image, and slopes baked per UV direction mirror with it). Rectangles are
// authored on a 1000 x 1000 grid and returned in 0..1 with v up.
//
// BODY: the skin atlas (normalAo, albedoRough, thicknessCavity are all laid out like this).
// CLOTH: the garment atlas (fold slopes, occlusion, seams).
export const GUTTER = 5 / 1024;       // more than 4 texels at every atlas size used (1024, 2048)

const R = (x, y, w, h) => [x / 1000, y / 1000, (x + w) / 1000, (y + h) / 1000];
export const BODY = {
  head: R(0, 0, 500, 470),
  torso: R(500, 0, 500, 470),
  leg: R(0, 470, 230, 360),
  arm: R(230, 470, 170, 360),
  palm: R(400, 470, 250, 150),
  foot: R(650, 470, 180, 150),
  ear: R(830, 470, 170, 150),
  index: R(400, 620, 120, 210), middle: R(520, 620, 120, 210), ring: R(640, 620, 120, 210), pinky: R(760, 620, 120, 210), thumb: R(880, 620, 120, 210),
  misc: R(0, 830, 1000, 170),         // nothing baked: teeth, mouth, eyes, stumps park their UVs here
};

// uv of grid cell (i of nR rows, j of cols columns) inside a rectangle, gutter kept clear
export function rectUV(rect, i, nR, j, cols, out) {
  const g = GUTTER;
  out[0] = rect[0] + g + (rect[2] - rect[0] - 2 * g) * (cols > 1 ? j / (cols - 1) : 0.5);
  out[1] = rect[1] + g + (rect[3] - rect[1] - 2 * g) * (nR > 1 ? i / (nR - 1) : 0.5);
  return out;
}

// Garment rectangles are handed out by a shelf packer: each garment asks for (width, height) in
// metres of cloth and gets a rectangle at `density` texels per metre of a 2048 atlas.
export function createPacker(density = 620, size = 2048) {
  let x = 0, y = 0, shelf = 0;
  const rects = new Map();
  return {
    rects,
    take(name, wM, hM) {
      if (rects.has(name)) return rects.get(name);
      const w = Math.min(1, Math.max(24, Math.ceil(wM * density)) / size + 2 * GUTTER);
      const h = Math.min(1, Math.max(24, Math.ceil(hM * density)) / size + 2 * GUTTER);
      if (x + w > 1) { x = 0; y += shelf; shelf = 0; }
      if (y + h > 1) throw new Error(`garment atlas is full at ${name}`);
      const r = [x, y, x + w, y + h];
      x += w; shelf = Math.max(shelf, h);
      rects.set(name, r);
      return r;
    },
    get used() { return y + shelf; },
  };
}
