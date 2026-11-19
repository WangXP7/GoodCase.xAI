// PLATEAU's photo textures for the LOD2 buildings (cut from aerial photographs; one roof image and one wall
// image per building), packed into two atlases per tile. The roofs are sharp and are shown as they are. The
// walls, seen at a slant from the air, are smeared: the client shows them from a distance and blends to the
// generated facade close up, which is painted in the average colour of the wall photo.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const MAX = 2048;  // roof atlas pixels along a side
const WALLS = 1024; // wall atlas: seen from a distance only
const SMALL = 512;  // the small version of each atlas ("_s"), which is what far tiles show
const PAD = 2;    // pixels of the photo kept around each piece, against bleeding

const cache = new Map();
async function image(file) {
  if (!cache.has(file)) {
    if (cache.size > 64) cache.clear();
    cache.set(file, fs.existsSync(file) ? sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true }).then(({ data, info }) => ({ data, w: info.width, h: info.height })).catch(() => null) : null);
  }
  return cache.get(file);
}

// The part of each image that the given surfaces use: [{ img, list: surfaces, x0, y0, w, h }].
async function piecesOf(surfaces, dir) {
  const byImage = new Map(), out = [];
  for (const s of surfaces) { if (!byImage.has(s.image)) byImage.set(s.image, []); byImage.get(s.image).push(s); }
  for (const [name, list] of byImage) {
    const img = await image(path.join(dir, name));
    if (!img) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of list) for (const uv of s.photo) for (let i = 0; i < uv.length; i += 2) {
      const x = uv[i] * img.w, y = (1 - uv[i + 1]) * img.h;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    x0 = Math.max(0, Math.floor(x0) - PAD); y0 = Math.max(0, Math.floor(y0) - PAD); x1 = Math.min(img.w, Math.ceil(x1) + PAD); y1 = Math.min(img.h, Math.ceil(y1) + PAD);
    if (x1 - x0 >= 1 && y1 - y0 >= 1) out.push({ img, list, x0, y0, w: x1 - x0, h: y1 - y0 });
  }
  return out;
}

// Shelf-packs the pieces into one image (shrunk together until they fit), writes it and a small version of
// it, and sets surface.uv (atlas coordinates, v up) on every surface in it. Returns the size of the files.
async function pack(pieces, out, MAX) {
  pieces.sort((a, b) => b.h - a.h);
  let scale = 1, width, height;
  for (;; scale *= 0.85) {
    const total = pieces.reduce((s, p) => s + Math.ceil(p.w * scale) * Math.ceil(p.h * scale), 0);
    width = Math.min(MAX, 2 ** Math.ceil(Math.log2(Math.max(64, Math.sqrt(total * 1.15), ...pieces.map((p) => Math.ceil(p.w * scale))))));
    let x = 0, y = 0, shelf = 0, fits = true;
    for (const p of pieces) {
      const w = Math.max(1, Math.ceil(p.w * scale)), h = Math.max(1, Math.ceil(p.h * scale));
      if (w > width) { fits = false; break; }
      if (x + w > width) { x = 0; y += shelf; shelf = 0; }
      p.ax = x; p.ay = y; p.aw = w; p.ah = h;
      x += w; shelf = Math.max(shelf, h);
    }
    height = 2 ** Math.ceil(Math.log2(Math.max(64, y + shelf)));
    if (fits && height <= MAX) break;
  }
  const layers = await Promise.all(pieces.map(async (p) => ({
    input: await sharp(p.img.data, { raw: { width: p.img.w, height: p.img.h, channels: 3 } }).extract({ left: p.x0, top: p.y0, width: p.w, height: p.h }).resize(p.aw, p.ah, { fit: 'fill' }).png().toBuffer(),
    left: p.ax, top: p.ay,
  })));
  const atlas = await sharp({ create: { width, height, channels: 3, background: { r: 128, g: 128, b: 126 } } }).composite(layers).jpeg({ quality: 82 }).toBuffer();
  const small = out.replace(/\.jpg$/, '_s.jpg'), k = Math.min(1, SMALL / Math.max(width, height));
  fs.writeFileSync(out, atlas);
  await sharp(atlas).resize(Math.round(width * k), Math.round(height * k)).jpeg({ quality: 80 }).toFile(small);
  for (const p of pieces) for (const s of p.list) {
    s.uv = s.photo.map((uv) => uv.map((c, i) => (i % 2 === 0
      ? (p.ax + ((c * p.img.w - p.x0) * p.aw) / p.w) / width
      : 1 - (p.ay + (((1 - c) * p.img.h - p.y0) * p.ah) / p.h) / height)));
  }
  return atlas.length + fs.statSync(small).size;
}

// t: a tile of the compiler, its buildings carrying surfaces with { image, photo: [[u, v, ...] per ring] }.
// Writes the atlases `roofFile` and `wallFile` (where the tile has any), sets surface.uv on the surfaces in
// them and building.hint (the wall colour). Returns { roofs, walls: buildings in each atlas, colours, bytes }.
export async function bakePhotos(t, dir, roofFile, wallFile) {
  const roofs = [], walls = [];
  let colours = 0;
  for (const b of t.buildings) {
    // ---- wall colour: the photo under the middle of every wall face, weighted by the size of the face
    let r = 0, g = 0, bl = 0, n = 0;
    for (const s of b.surfaces ?? []) {
      if (s.roof || !s.photo) continue;
      const img = await image(path.join(dir, s.image));
      if (!img) continue;
      const uv = s.photo[0], ring = s.rings[0], m = uv.length / 2;
      let cu = 0, cv = 0, nx = 0, ny = 0, nz = 0;
      for (let i = 0; i < m; i++) {
        cu += uv[i * 2] / m; cv += uv[i * 2 + 1] / m;
        const p = ring[i], q = ring[(i + 1) % m];
        nx += (p[1] - q[1]) * (p[2] + q[2]); ny += (p[2] - q[2]) * (p[0] + q[0]); nz += (p[0] - q[0]) * (p[1] + q[1]);
      }
      const area = Math.hypot(nx, ny, nz) / 2;
      // the middle, and halfway from it to each corner
      for (let i = -1; i < m; i++) {
        const u = i < 0 ? cu : (cu + uv[i * 2]) / 2, v = i < 0 ? cv : (cv + uv[i * 2 + 1]) / 2;
        const px = Math.min(img.w - 1, Math.max(0, Math.floor(u * img.w))), py = Math.min(img.h - 1, Math.max(0, Math.floor((1 - v) * img.h)));
        const o = (py * img.w + px) * 3, wgt = area / (m + 1);
        r += img.data[o] * wgt; g += img.data[o + 1] * wgt; bl += img.data[o + 2] * wgt; n += wgt;
      }
    }
    if (n > 0 && !b.hint) {
      // aerial photos are hazy and their walls in shade: lift the colour towards what one sees from the street
      const lift = (c) => Math.round(255 * Math.min(1, (c / n / 255) ** 0.8 * 1.08));
      b.hint = (0x80000000 | (lift(r) << 16) | (lift(g) << 8) | lift(bl)) >>> 0;
      colours++;
    }
    const textured = (b.surfaces ?? []).filter((s) => s.photo);
    roofs.push(...await piecesOf(textured.filter((s) => s.roof), dir));
    walls.push(...await piecesOf(textured.filter((s) => !s.roof), dir));
  }
  let bytes = 0;
  if (roofs.length) bytes += await pack(roofs, roofFile, MAX);
  if (walls.length) bytes += await pack(walls, wallFile, WALLS);
  return { roofs: roofs.length, walls: walls.length, colours, bytes };
}
