/* ============================================================
   PROCEDURAL IMAGERY
   ------------------------------------------------------------
   Everything the sky and the ground need, generated at load.

   This exists so the repository ships with no third-party imagery at all.
   Earth subtends about two degrees from the Moon — roughly forty pixels on a
   1080p screen — and the lunar albedo map is only ever sampled at a 2.4 km
   repeat as low-frequency mottling. Neither needs a photograph, and not
   needing one means there is nothing to license.

   If you would rather use real imagery, drop equirectangular files into
   assets/tex/ as earth-2k.jpg, earth-night-2k.jpg, earth-clouds-2k.jpg and
   moon-2k.jpg — they are picked up automatically and these are ignored.
   ============================================================ */
import * as THREE from 'three';
import { fbm, ridged, vnoise, makeRNG, clamp, sstep, lerp } from '../core/rng.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function toTexture(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  return t;
}

/** Land/sea mask on the sphere, sampled in 3D so it wraps at the seam. */
function landAt(lon, lat) {
  const cl = Math.cos(lat);
  const x = cl * Math.cos(lon), y = Math.sin(lat), z = cl * Math.sin(lon);
  // two octave sets at different scales: continents, then coastal detail
  const a = fbm(x * 1.35 + 4, z * 1.35 - 2, 4, 2.1, 0.52, 21) +
            fbm(y * 1.35 + 9, x * 1.35 + 3, 3, 2.1, 0.5, 57) * 0.55;
  const b = ridged(x * 4.2 + 1, z * 4.2 + 6, 3, 2.1, 0.5, 88) * 0.22;
  // bias landmass toward the northern hemisphere, as on the real thing
  return a / 1.55 + b + Math.max(0, y) * 0.07;
}

/* ---------------- Earth: day, night and cloud deck ---------------- */
export function makeEarthTextures(W = 1024, H = 512) {
  const day = canvas(W, H), night = canvas(W, H), cloud = canvas(W, H);
  const dg = day.getContext('2d'), ng = night.getContext('2d'), cg = cloud.getContext('2d');
  const di = dg.createImageData(W, H), ni = ng.createImageData(W, H), ci = cg.createImageData(W, H);
  const rng = makeRNG(0x3A12);

  for (let j = 0; j < H; j++) {
    const lat = (0.5 - j / H) * Math.PI;              // +pi/2 .. -pi/2
    const alat = Math.abs(lat) / (Math.PI / 2);
    for (let i = 0; i < W; i++) {
      const lon = (i / W) * Math.PI * 2;
      const o = (j * W + i) * 4;
      const land = landAt(lon, lat);
      const isLand = sstep(0.50, 0.54, land);

      /* ---- day ---- */
      // ocean deepens away from the shelf
      const depth = clamp((0.52 - land) * 7, 0, 1);
      let r = lerp(26, 8, depth), g = lerp(58, 26, depth), b = lerp(96, 58, depth);
      if (isLand > 0) {
        // biome by latitude: desert belts near 25 deg, green in between
        const desert = Math.exp(-Math.pow((alat - 0.30) / 0.14, 2));
        const tundra = sstep(0.62, 0.82, alat);
        const veg = vnoise(lon * 9 + 3, lat * 9 - 5, 404);
        const lr = lerp(lerp(74, 150, desert), 108, tundra);
        const lg = lerp(lerp(92, 126, desert), 104, tundra);
        const lb = lerp(lerp(56, 84, desert), 92, tundra);
        const k = 0.86 + 0.28 * veg;
        r = lerp(r, lr * k, isLand); g = lerp(g, lg * k, isLand); b = lerp(b, lb * k, isLand);
      }
      // ice caps
      const ice = sstep(0.80, 0.93, alat + vnoise(lon * 6, lat * 6, 77) * 0.06);
      r = lerp(r, 236, ice); g = lerp(g, 242, ice); b = lerp(b, 248, ice);
      di.data[o] = r; di.data[o + 1] = g; di.data[o + 2] = b; di.data[o + 3] = 255;

      /* ---- night: settlement light, only on land, thinning toward the poles ---- */
      let lit = 0;
      if (isLand > 0.5 && ice < 0.5) {
        const dens = vnoise(lon * 22 + 11, lat * 22 + 4, 913);
        const belt = Math.exp(-Math.pow((alat - 0.42) / 0.30, 2));   // temperate band
        if (dens > 0.76 && rng() < 0.35) lit = (dens - 0.76) * 4.2 * belt;
      }
      const L = clamp(lit, 0, 1) * 255;
      ni.data[o] = L; ni.data[o + 1] = L * 0.84; ni.data[o + 2] = L * 0.55; ni.data[o + 3] = 255;

      /* ---- clouds: banded, with cyclonic swirl in the mid latitudes ---- */
      const swirl = Math.sin(lat * 6.0) * 0.35;
      const cx = lon * 2.6 + swirl, cy = lat * 3.4;
      let cl = fbm(cx, cy, 5, 2.15, 0.55, 303);
      const band = 0.55 + 0.45 * Math.cos(lat * 7.5);   // ITCZ + mid-latitude storm tracks
      cl = clamp((cl - 0.44) * 3.0 * band, 0, 1);
      cl *= 1 - sstep(0.86, 1.0, alat) * 0.5;
      const C = cl * 255;
      ci.data[o] = C; ci.data[o + 1] = C; ci.data[o + 2] = C; ci.data[o + 3] = 255;
    }
  }
  dg.putImageData(di, 0, 0); ng.putImageData(ni, 0, 0); cg.putImageData(ci, 0, 0);
  return {
    earthDay: toTexture(day, true),
    earthNight: toTexture(night, true),
    earthClouds: toTexture(cloud, false)
  };
}

/* ---------------- lunar albedo: mare / highland mottling ---------------- */
export function makeMoonAlbedo(N = 512) {
  const c = canvas(N, N);
  const g = c.getContext('2d');
  const img = g.createImageData(N, N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = i / N * 6, y = j / N * 6;
    // broad dark maria over a brighter highland background, plus fine speckle
    const mare = sstep(0.42, 0.58, fbm(x, y, 4, 2.07, 0.55, 5));
    const fine = fbm(x * 5.3 + 2, y * 5.3 - 1, 3, 2.1, 0.5, 61);
    const v = lerp(190, 96, mare) * (0.86 + 0.28 * fine);
    const o = (j * N + i) * 4;
    img.data[o] = v; img.data[o + 1] = v * 0.98; img.data[o + 2] = v * 0.94; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = toTexture(c, true);
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

void ridged;
