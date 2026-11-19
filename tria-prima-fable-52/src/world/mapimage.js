// Draws the island as an engraved chart on a canvas: the map page of the book.
import { WORLD } from './heightmap.js';

/** terrain -> HTMLCanvasElement (size x size). North is up. */
export function drawMap(T, size = 1024) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const d = img.data;
  const { half, size: W } = WORLD;
  const px = W / size;
  const lx = -0.62,
    lz = -0.62,
    ly = 0.48; // light from the north-west
  for (let j = 0; j < size; j++) {
    const z = (j + 0.5) * px - half;
    for (let i = 0; i < size; i++) {
      const x = (i + 0.5) * px - half;
      const h = T.heightAt(x, z);
      const k = (j * size + i) * 4;
      let r, gg, b;
      if (h < 0) {
        // water: dark, with faint depth rings
        const ring = 0.5 + 0.5 * Math.cos(Math.max(-14, h) * 1.9);
        const v = 15 + ring * 5 * Math.min(1, -h / 2);
        r = v * 0.82;
        gg = v * 0.95;
        b = v * 1.12;
      } else {
        const e = px;
        const dx = T.heightAt(x + e, z) - T.heightAt(x - e, z),
          dz = T.heightAt(x, z + e) - T.heightAt(x, z - e);
        const l = Math.hypot(dx, 2 * e, dz);
        const sh = Math.max(0, (-dx * lx + 2 * e * ly - dz * lz) / l);
        const m = T.mask(x, z);
        // base ink by ground
        let br = 92,
          bg = 84,
          bb = 68;
        const mix = (cr, cg, cb, t) => {
          br += (cr - br) * t;
          bg += (cg - bg) * t;
          bb += (cb - bb) * t;
        };
        mix(150, 142, 136, m.salt * 0.9);
        mix(58, 44, 40, m.ash);
        mix(168, 170, 176, m.snow);
        mix(70, 72, 66, Math.min(1, m.slope * 2.2));
        const tone = 0.42 + sh * 0.95;
        // contour lines every 10 m
        const cl = Math.abs(((h / 10) % 1) - 0.5) * 2;
        const line = Math.min(1, Math.max(0, (cl - 0.9) * 10)) * Math.min(1, m.slope * 14);
        const shore = h < 0.5 ? 0.6 : 1;
        r = br * tone * shore * (1 - line * 0.45);
        gg = bg * tone * shore * (1 - line * 0.45);
        b = bb * tone * shore * (1 - line * 0.45);
      }
      d[k] = r;
      d[k + 1] = gg;
      d[k + 2] = b;
      d[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);

  const P = (x, z) => [((x + half) / W) * size, ((z + half) / W) * size];
  // river
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(20,24,30,0.95)';
  g.lineWidth = size / 190;
  g.beginPath();
  T.river.p.forEach((p, i) => (i ? g.lineTo(...P(p[0], p[1])) : g.moveTo(...P(p[0], p[1]))));
  g.stroke();
  // paths
  g.strokeStyle = 'rgba(214,200,168,0.5)';
  g.lineWidth = size / 560;
  g.setLineDash([size / 170, size / 150]);
  for (const path of T.paths) {
    g.beginPath();
    path.p.forEach((p, i) => (i ? g.lineTo(...P(p[0], p[1])) : g.moveTo(...P(p[0], p[1]))));
    g.stroke();
  }
  g.setLineDash([]);
  // edge burn
  const v = g.createRadialGradient(size / 2, size / 2, size * 0.36, size / 2, size / 2, size * 0.74);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.72)');
  g.fillStyle = v;
  g.fillRect(0, 0, size, size);
  return c;
}
