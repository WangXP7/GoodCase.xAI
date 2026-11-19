#!/usr/bin/env node
/**
 * Minimal PNG statistics — histogram, mean/percentile luma, blown-pixel share.
 *
 * The art-direction reviews judge frames on measured numbers (median luma, p95,
 * the share of pixels clipped to white), and reading a WebGL canvas back through
 * a 2D context returns an empty buffer because the renderer runs without
 * `preserveDrawingBuffer`. Screenshots are the honest source, so this decodes
 * them directly rather than guessing from a thumbnail.
 *
 * Handles the only case Playwright emits: non-interlaced 8-bit RGB/RGBA.
 *
 * Usage:
 *   node scripts/pnginfo.mjs verify/06-battle.png [--crop x0,y0,x1,y1]
 */

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const file = process.argv[2];
if (!file) {
  console.error('usage: pnginfo.mjs <file.png> [--crop x0,y0,x1,y1]');
  process.exit(1);
}
const cropArg = process.argv.indexOf('--crop');
const crop = cropArg > 0 ? process.argv[cropArg + 1].split(',').map(Number) : null;

const buf = readFileSync(file);
let pos = 8; // skip signature
let width = 0;
let height = 0;
let bitDepth = 0;
let colorType = 0;
const idat = [];

while (pos < buf.length) {
  const len = buf.readUInt32BE(pos);
  const type = buf.toString('ascii', pos + 4, pos + 8);
  const data = buf.subarray(pos + 8, pos + 8 + len);
  if (type === 'IHDR') {
    width = data.readUInt32BE(0);
    height = data.readUInt32BE(4);
    bitDepth = data[8];
    colorType = data[9];
    if (data[12] !== 0) throw new Error('interlaced PNG not supported');
  } else if (type === 'IDAT') {
    idat.push(data);
  } else if (type === 'IEND') break;
  pos += 12 + len;
}

if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
if (!channels) throw new Error(`unsupported colour type ${colorType}`);

const raw = inflateSync(Buffer.concat(idat));
const stride = width * channels;
const out = Buffer.alloc(height * stride);

// Undo the per-scanline filters (PNG spec section 9).
let rp = 0;
for (let y = 0; y < height; y++) {
  const filter = raw[rp++];
  const row = raw.subarray(rp, rp + stride);
  rp += stride;
  const cur = out.subarray(y * stride, (y + 1) * stride);
  const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
  for (let x = 0; x < stride; x++) {
    const a = x >= channels ? cur[x - channels] : 0;
    const b = prev ? prev[x] : 0;
    const c = prev && x >= channels ? prev[x - channels] : 0;
    let v = row[x];
    switch (filter) {
      case 0: break;
      case 1: v += a; break;
      case 2: v += b; break;
      case 3: v += (a + b) >> 1; break;
      case 4: {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        break;
      }
      default: throw new Error(`bad filter ${filter}`);
    }
    cur[x] = v & 0xff;
  }
}

const [x0, y0, x1, y1] = crop ?? [0, 0, width, height];
const lumas = [];
let blown = 0;
let sum = 0;
for (let y = y0; y < y1; y++) {
  for (let x = x0; x < x1; x++) {
    const i = y * stride + x * channels;
    // Rec.709 luma on the sRGB-encoded bytes — comparable across screenshots.
    const l = (0.2126 * out[i] + 0.7152 * out[i + 1] + 0.0722 * out[i + 2]) / 255;
    lumas.push(l);
    sum += l;
    if (l > 0.96) blown++;
  }
}
lumas.sort((a, b) => a - b);
const pct = (p) => lumas[Math.min(lumas.length - 1, Math.floor(lumas.length * p))].toFixed(3);

console.log(JSON.stringify({
  file,
  size: [width, height],
  n: lumas.length,
  mean: +(sum / lumas.length).toFixed(3),
  p01: +pct(0.01), p05: +pct(0.05), median: +pct(0.5), p95: +pct(0.95), p99: +pct(0.99),
  blownPct: +((blown / lumas.length) * 100).toFixed(2),
  darkPct: +((lumas.filter((l) => l < 0.06).length / lumas.length) * 100).toFixed(2),
}));
