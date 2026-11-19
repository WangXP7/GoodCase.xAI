// Renders a compiled area top-down to data/preview/<area>.png, reading only the compiled output
// (so it checks what the client will get). Terrain hillshade, road surfaces, buildings shaded by
// height, the OSM graph (motorways orange, tunnels dashed-off, bridges red) and railways.
// Usage: node tools/pipeline/preview.mjs [--area=shibuya] [--scale=2]   (metres per pixel)
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { resolveArea, ROOT } from './config.mjs';
import { decodeTile, AREA } from '../../src/shared/tileformat.js';

const area = resolveArea();
const SCALE = Number(process.argv.find((a) => a.startsWith('--scale='))?.split('=')[1] ?? 2);
const dir = area.outDir;
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const { minX, maxX, minZ, maxZ } = manifest.bounds;
const W = Math.ceil((maxX - minX) / SCALE), H = Math.ceil((maxZ - minZ) / SCALE);
const png = new PNG({ width: W, height: H });
const px = (x) => (x - minX) / SCALE, pz = (z) => (z - minZ) / SCALE;

function blend(i, [r, g, b], a = 1) {
  const o = i * 4, d = png.data, c = (v) => Math.max(0, Math.min(255, v));
  d[o] = c(d[o] * (1 - a) + r * a); d[o + 1] = c(d[o + 1] * (1 - a) + g * a); d[o + 2] = c(d[o + 2] * (1 - a) + b * a); d[o + 3] = 255;
}

// Even-odd scanline fill of a polygon given as rings of Float32Array [x, z, ...] in world metres.
function fill(rings, color, alpha = 1) {
  let y0 = Infinity, y1 = -Infinity;
  for (const r of rings) for (let i = 1; i < r.length; i += 2) { y0 = Math.min(y0, pz(r[i])); y1 = Math.max(y1, pz(r[i])); }
  for (let y = Math.max(0, Math.ceil(y0 - 0.5)); y <= Math.min(H - 1, Math.floor(y1 - 0.5)); y++) {
    const yc = y + 0.5, xs = [];
    for (const r of rings) {
      const n = r.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, ya = pz(r[i * 2 + 1]), yb = pz(r[j * 2 + 1]);
        if ((ya <= yc) !== (yb <= yc)) {
          const xa = px(r[i * 2]), xb = px(r[j * 2]);
          xs.push(xa + ((yc - ya) / (yb - ya)) * (xb - xa));
        }
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2)
      for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x <= Math.min(W - 1, Math.floor(xs[k + 1] - 0.5)); x++) blend(y * W + x, color, alpha);
  }
}

// Polyline of [x, y, z, ...] triples; `width` in pixels.
function line(pts, color, width = 1, alpha = 1) {
  const r = width / 2;
  for (let i = 3; i < pts.length; i += 3) {
    const ax = px(pts[i - 3]), az = pz(pts[i - 1]), bx = px(pts[i]), bz = pz(pts[i + 2]);
    const steps = Math.ceil(Math.hypot(bx - ax, bz - az) * 2) + 1;
    for (let s = 0; s <= steps; s++) {
      const cx = ax + ((bx - ax) * s) / steps, cz = az + ((bz - az) * s) / steps;
      for (let y = Math.floor(cz - r); y <= Math.ceil(cz + r); y++)
        for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
          if (x >= 0 && y >= 0 && x < W && y < H && Math.hypot(x + 0.5 - cx, y + 0.5 - cz) <= r) blend(y * W + x, color, alpha);
    }
  }
}

// terrain: elevation tint + hillshade
const t = manifest.terrain;
const hgt = new Float32Array(fs.readFileSync(path.join(dir, t.file)).buffer.slice(0));
const hAt = (x, z) => {
  const i = Math.min(t.w - 1, Math.max(0, Math.round((x - t.x0) / t.step))), j = Math.min(t.h - 1, Math.max(0, Math.round((z - t.z0) / t.step)));
  return hgt[j * t.w + i];
};
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const wx = minX + (x + 0.5) * SCALE, wz = minZ + (y + 0.5) * SCALE;
    const e = (hAt(wx, wz) - t.min) / (t.max - t.min);
    const dx = hAt(wx + t.step, wz) - hAt(wx - t.step, wz), dz = hAt(wx, wz + t.step) - hAt(wx, wz - t.step);
    const shade = Math.max(0.55, Math.min(1.25, 1 + (-dx + dz) * 0.15));
    blend(y * W + x, [(170 + 50 * e) * shade, (185 + 30 * e) * shade, (160 - 10 * e) * shade]);
  }

const AREA_COLOR = {
  [AREA.ROAD]: [92, 92, 98], [AREA.CARRIAGEWAY]: [62, 62, 70], [AREA.SIDEWALK]: [150, 146, 140],
  [AREA.ISLAND]: [90, 140, 80], [AREA.OTHER]: [120, 110, 120],
};
const heightColor = (h) => {
  const k = Math.min(1, Math.log(1 + h) / Math.log(220));
  return [240 - 170 * k, 236 - 186 * k, 228 - 128 * k]; // pale (low) -> deep blue (tall)
};

let nB = 0;
const decoded = manifest.tiles.map((tl) => decodeTile(new Uint8Array(fs.readFileSync(path.join(dir, tl.file))).buffer));
for (const tile of decoded) for (const a of tile.areas) if (a.kind === AREA.ROAD) for (const p of a.polygons) fill(p, AREA_COLOR[a.kind]);
for (const tile of decoded) for (const a of tile.areas) if (a.kind !== AREA.ROAD) for (const p of a.polygons) fill(p, AREA_COLOR[a.kind]);
const all = decoded.flatMap((tl) => tl.buildings).sort((a, b) => a.height - b.height);
for (const b of all) { nB++; for (const p of b.polygons) fill(p, heightColor(b.height)); }

const rails = JSON.parse(fs.readFileSync(path.join(dir, manifest.rails), 'utf8'));
for (const r of rails) line(r.pts, r.bridge ? [150, 40, 160] : [90, 40, 110], 2);
const roads = JSON.parse(fs.readFileSync(path.join(dir, manifest.roads), 'utf8'));
const ROAD_COLOR = { motorway: [255, 140, 0], trunk: [230, 80, 40], primary: [240, 200, 40], secondary: [250, 230, 120] };
for (const e of roads.edges) {
  if (e.tunnel) continue;
  const c = e.bridge ? [220, 30, 30] : ROAD_COLOR[e.highway.replace('_link', '')] ?? [255, 255, 255];
  line(e.pts, c, e.bridge || ROAD_COLOR[e.highway.replace('_link', '')] ? 2 : 1, 0.85);
}
// tile grid
for (let x = Math.ceil(minX / manifest.tileSize) * manifest.tileSize; x < maxX; x += manifest.tileSize) line([x, 0, minZ, x, 0, maxZ], [0, 0, 0], 1, 0.15);
for (let z = Math.ceil(minZ / manifest.tileSize) * manifest.tileSize; z < maxZ; z += manifest.tileSize) line([minX, 0, z, maxX, 0, z], [0, 0, 0], 1, 0.15);
// origin marker
line([-6, 0, 0, 6, 0, 0], [0, 120, 255], 3); line([0, 0, -6, 0, 0, 6], [0, 120, 255], 3);

const out = path.join(ROOT, 'data/preview', `${area.id}.png`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, PNG.sync.write(png));
console.log(`${W} x ${H} px (${SCALE} m/px), ${nB} buildings, ${roads.edges.length} road edges, ${rails.length} railways -> ${path.relative(process.cwd(), out)}`);
