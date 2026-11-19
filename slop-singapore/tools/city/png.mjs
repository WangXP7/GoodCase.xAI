// tools/city/png.mjs — a minimal PNG encoder (8-bit greyscale, RGB or RGBA, no colour profile): enough for the data
// images the city tools write (tools/city/landuse.mjs), read back as raw values by the browser (js/png-decode.js)
import zlib from 'node:zlib';

const CRC = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** PNG bytes of a w × h image, `channels` (1, 3 or 4) bytes a pixel, rows top first */
export function encodePNG(pixels, w, h, channels = 3) {
  const stride = w * channels;
  // each row filtered by the one above (filter 2, "Up"): the large even areas of a data image compress to almost nothing
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 2;
    for (let x = 0; x < stride; x++) {
      const v = pixels[y * stride + x];
      const up = y ? pixels[(y - 1) * stride + x] : 0;
      raw[y * (stride + 1) + 1 + x] = (v - up) & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = { 1: 0, 3: 2, 4: 6 }[channels];
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/** The pixels of a PNG written by encodePNG (for tests): { w, h, channels, pixels } */
export function decodePNG(buf) {
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  const channels = { 0: 1, 2: 3, 6: 4 }[buf[25]];
  const idat = [];
  for (let o = 8; o < buf.length;) {
    const len = buf.readUInt32BE(o);
    if (buf.toString('ascii', o + 4, o + 8) === 'IDAT') idat.push(buf.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const pixels = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const up = y ? pixels[(y - 1) * stride + x] : 0;
      if (f === 2) pixels[y * stride + x] = (v + up) & 255;
      else if (f === 0) pixels[y * stride + x] = v;
      else throw new Error(`PNG filter ${f}`);
    }
  }
  return { w, h, channels, pixels };
}
