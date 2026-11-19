// js/png-decode.js
// Reads a PNG's raw pixels in the browser (or a worker, or Node), for the data images the city tools write
// (tools/city/png.mjs): 8-bit greyscale, RGB or RGBA, not interlaced. Raw values, untouched by the colour management,
// premultiplied alpha and resampling an <img> or ImageBitmap would apply. Inflated with DecompressionStream.
// decodePNG(bytes) -> Promise<{ w, h, channels, pixels (Uint8Array, rows top first) }>

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function decodePNG(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let k = 0; k < 8; k++) if (b[k] !== sig[k]) throw new Error('not a PNG');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let w = 0, h = 0, channels = 0;
  const idat = [];
  let size = 0;
  for (let o = 8; o + 8 <= b.length;) {
    const len = dv.getUint32(o);
    const type = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
    if (type === 'IHDR') {
      w = dv.getUint32(o + 8);
      h = dv.getUint32(o + 12);
      if (b[o + 16] !== 8 || b[o + 20] !== 0) throw new Error('PNG: only 8-bit, not interlaced');
      channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[b[o + 17]];
      if (!channels) throw new Error(`PNG colour type ${b[o + 17]}`);
    } else if (type === 'IDAT') {
      idat.push(b.subarray(o + 8, o + 8 + len));
      size += len;
    } else if (type === 'IEND') break;
    o += 12 + len;
  }
  const z = new Uint8Array(size);
  let at = 0;
  for (const part of idat) { z.set(part, at); at += part.length; }
  const raw = await inflate(z);
  const stride = w * channels;
  const px = new Uint8Array(stride * h);
  const bpp = channels;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const row = y * stride, prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x];
      const a = x >= bpp ? px[row + x - bpp] : 0;
      const up = y ? px[prev + x] : 0;
      const c = x >= bpp && y ? px[prev + x - bpp] : 0;
      let out;
      if (f === 0) out = v;
      else if (f === 1) out = v + a;
      else if (f === 2) out = v + up;
      else if (f === 3) out = v + ((a + up) >> 1);
      else if (f === 4) {
        const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
        out = v + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c);
      } else throw new Error(`PNG filter ${f}`);
      px[row + x] = out & 255;
    }
  }
  return { w, h, channels, pixels: px };
}

export { decodePNG };
