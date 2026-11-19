// tools/city/preview.mjs — renders a city's geodata (js/<city>-geodata.js) as a PNG map to check a build by eye:
// water, land, parks, blocks with their lot rects (frontage-frame lots turned into place), trees, the road graph by level
// usage: node tools/city/preview.mjs <city> <out.png> [--mpp 4] [--crop x0,z0,x1,z1]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pts = (flat) => {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
};

class Canvas {
  constructor(x0, z0, x1, z1, mpp) {
    Object.assign(this, { x0, z0, mpp });
    this.w = Math.ceil((x1 - x0) / mpp);
    this.h = Math.ceil((z1 - z0) / mpp);
    this.px = new Uint8Array(this.w * this.h * 3);
  }
  fill(rgb) {
    for (let k = 0; k < this.w * this.h; k++) this.px.set(rgb, k * 3);
  }
  // even-odd scanline fill of world rings
  polygon(rings, rgb) {
    const { w, h, x0, z0, mpp } = this;
    let jy0 = Infinity, jy1 = -Infinity;
    const scr = rings.map((r) => r.map(([x, z]) => [(x - x0) / mpp, (z - z0) / mpp]));
    for (const r of scr) for (const [, y] of r) { jy0 = Math.min(jy0, y); jy1 = Math.max(jy1, y); }
    jy0 = Math.max(0, Math.floor(jy0)); jy1 = Math.min(h - 1, Math.ceil(jy1));
    const xs = [];
    for (let j = jy0; j <= jy1; j++) {
      const y = j + 0.5;
      xs.length = 0;
      for (const r of scr) {
        for (let i = 0, k = r.length - 1; i < r.length; k = i++) {
          const [xa, ya] = r[k], [xb, yb] = r[i];
          if ((ya > y) !== (yb > y)) xs.push(xa + ((y - ya) * (xb - xa)) / (yb - ya));
        }
      }
      xs.sort((a, b) => a - b);
      for (let n = 0; n + 1 < xs.length; n += 2) {
        const i0 = Math.max(0, Math.ceil(xs[n] - 0.5)), i1 = Math.min(w - 1, Math.floor(xs[n + 1] - 0.5));
        for (let i = i0; i <= i1; i++) this.px.set(rgb, (j * w + i) * 3);
      }
    }
  }
  // a polyline `width` metres wide (at least one pixel)
  line(p, width, rgb) {
    const { w, h, x0, z0, mpp } = this;
    const r = Math.max(0.5, width / mpp / 2);
    for (let k = 0; k + 1 < p.length; k++) {
      const ax = (p[k][0] - x0) / mpp, ay = (p[k][1] - z0) / mpp, bx = (p[k + 1][0] - x0) / mpp, by = (p[k + 1][1] - z0) / mpp;
      const i0 = Math.max(0, Math.floor(Math.min(ax, bx) - r)), i1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + r));
      const j0 = Math.max(0, Math.floor(Math.min(ay, by) - r)), j1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + r));
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-9;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          let t = ((i + 0.5 - ax) * dx + (j + 0.5 - ay) * dy) / L2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = ax + t * dx - i - 0.5, ey = ay + t * dy - j - 0.5;
          if (ex * ex + ey * ey <= r * r) this.px.set(rgb, (j * w + i) * 3);
        }
      }
    }
  }
  png() {
    const { w, h, px } = this;
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let j = 0; j < h; j++) Buffer.from(px.buffer, j * w * 3, w * 3).copy(raw, j * (w * 3 + 1) + 1);
    const chunk = (type, data) => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length);
      const td = Buffer.concat([Buffer.from(type), data]);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(td));
      return Buffer.concat([len, td, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // truecolour
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  }
}

let CRC;
function crc32(buf) {
  if (!CRC) {
    CRC = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const C = {
  water: [156, 195, 224], land: [240, 236, 226], park: [185, 220, 160], block: [214, 208, 198], blockPark: [160, 205, 140],
  lot: [178, 164, 150], frameLot: [190, 150, 130], tree: [70, 140, 60], road: [70, 70, 70], bridge: [200, 90, 40], tunnel: [150, 150, 210], detail: [220, 30, 30]
};

export function renderPreview(GEO, { mpp = 4, crop } = {}) {
  let [x0, z0, x1, z1] = crop || [];
  if (!crop) {
    const d = pts(GEO.detail);
    x0 = Math.min(...d.map((p) => p[0])) - 200; x1 = Math.max(...d.map((p) => p[0])) + 200;
    z0 = Math.min(...d.map((p) => p[1])) - 200; z1 = Math.max(...d.map((p) => p[1])) + 200;
  }
  const cv = new Canvas(x0, z0, x1, z1, mpp);
  cv.fill(C.water);
  for (const rings of GEO.land) cv.polygon(rings.map(pts), C.land);
  for (const w of GEO.water) cv.polygon([pts(w.ring)], C.water);
  for (const p of GEO.parks) cv.polygon(p.rings.map(pts), C.park);
  for (const [outline, rects, park, , , frames] of GEO.blocks) {
    cv.polygon([pts(outline)], park > 0.6 ? C.blockPark : C.block);
    if (park > 0.6) continue;
    for (const [a, b, c, d] of rects) cv.polygon([[[a, c], [b, c], [b, d], [a, d]]], C.lot);
    // frame lots: world = p + R_y(θ)·(local − p)
    for (const [th, px, pz, rs] of frames || []) {
      const cs = Math.cos(th), sn = Math.sin(th);
      const toW = ([u, v]) => [px + (u - px) * cs + (v - pz) * sn, pz - (u - px) * sn + (v - pz) * cs];
      for (const [a, b, c, d] of rs) cv.polygon([[[a, c], [b, c], [b, d], [a, d]].map(toW)], C.frameLot);
    }
  }
  if (GEO.trees) {
    let x = 0, z = 0;
    GEO.trees.heights.forEach((h, i) => {
      x += GEO.trees.xz[i * 2] / 10;
      z += GEO.trees.xz[i * 2 + 1] / 10;
      cv.line([[x, z], [x + 0.1, z]], Math.max(mpp * 1.2, h * 0.4), C.tree);
    });
  }
  const RG = GEO.roadGraph;
  const node = (i) => [RG.nodes[i * 2], RG.nodes[i * 2 + 1]];
  // tunnels under, at-grade, then bridges on top
  for (const pass of [-1, 0, 1]) {
    for (const l of RG.links) {
      const level = l[8];
      if (Math.sign(level) !== pass) continue;
      const line = [node(l[0]), ...pts(l[6]), node(l[1])];
      cv.line(line, Math.max(1.5, l[3] * 0.35), pass < 0 ? C.tunnel : pass > 0 ? C.bridge : C.road);
    }
  }
  cv.line([...pts(GEO.detail), pts(GEO.detail)[0]], mpp * 1.5, C.detail);
  return cv.png();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [id, out] = process.argv.slice(2);
  if (!id || !out) throw new Error('usage: node tools/city/preview.mjs <city> <out.png> [--mpp 4] [--crop x0,z0,x1,z1]');
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const file = fileURLToPath(new URL(`../../js/${id}-geodata.js`, import.meta.url));
  const { GEO } = await import(pathToFileURL(file).href);
  const crop = arg('--crop') ? arg('--crop').split(',').map(Number) : undefined;
  fs.writeFileSync(out, renderPreview(GEO, { mpp: Number(arg('--mpp') || 4), crop }));
  console.log(`[preview] wrote ${out}`);
}
