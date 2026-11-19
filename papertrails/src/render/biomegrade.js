// OWNER: render agent. Per-biome light + grade, composed with the day / night blend.
//
// One writer for the look tunables: every frame daynight.js asks this module for
//     value = lerp( sum_b w_b * DAY[b],  sum_b w_b * NIGHT[b],  nightAmount )
// and writes the result into CONFIG (lights.js / post.js / materials.js read CONFIG every frame, so no other
// module has to know about biomes). w_b = biomeWeights around the traveller (smoothed in time).
//   DAY[heartland]  = the pristine CONFIG values (the start area keeps its look exactly)
//   DAY[other]      = pristine values overridden by GRADE[biome].day
//   NIGHT[b]        = NIGHT_BASE overridden by GRADE[biome].night (keys in neither table keep DAY[b])
// Colours are blended in linear RGB. Live edits of GRADE / NIGHT_BASE need a reload (tables are baked at boot).
import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { BIOMES, biomeWeights } from '../core/biomes.js';

/** Night look shared by all biomes (fixer pass): dark navy ambient, the moon key carries the shapes and the shadows,
 * warm only at the lights (glow + spill). Back-lit translucency turns cool so green cards stop going magenta. */
export const NIGHT_BASE = {
  lights: {
    key: { color: '#8fb0f0', intensity: 1.05, elevationDeg: 50, azimuthDeg: -62 }, // moon: casts the soft shadows, rims the cards
    fill: { color: '#3a58ac', intensity: 0.38, elevationDeg: 20 },
    hemi: { sky: '#4666c8', ground: '#16285c', intensity: 0.5 }, // fixer pass: 0.33 -> 0.5, bluer: the unlit plane of a cross tree stays a mid blue, not a black wedge
    lantern: { intensity: 2.3, distance: 5.6 },
    paper: { wrap: 0.42, translucency: 0.12, translucencyTint: '#7fa0d8', fibreCloud: 0.05 }, // fixer pass: wrap 0.16 -> 0.42 at night (faces turned from the moon keep their colour)
    gobo: { key: 0.2, tint: 0.05 },
    fade: { color: '#070c2a', colorRight: '#060922', start: 5.0, end: 11.5, amount: 0.92 },
    shadow: { leak: '#16286a', lightSize: 0.22 },
    background: '#070a24',
  },
  post: {
    exposure: 0.92, bloom: 0.3, spill: 7.5, bloomThreshold: 1.25, tint: [0.82, 0.97, 1.2], shadowTint: '#091638', shadowLift: 0.042,
    saturation: 0.74, contrast: 1.1, vignette: 0.34, aoTint: '#081030', greenDesat: 0.45, split: 0.02,
    edgeRim: 0.6, edgeRimColor: '#fbf6ea', aoRadius: 0.22, grain: 0.02, ao: 1.0,
  },
  dof: { ramp: 0.42, maxBlurPx: 16, nearGain: 1.2 },
  assets: { glowIntensity: 9 },
};

/**
 * Per-biome overrides. Starting points from ref/style2/STYLE.md sec. 3, tuned against captures.
 * heartland has no entry on purpose (identity).
 */
export const GRADE = {
  desert: {
    day: {
      lights: {
        key: { color: '#fff0d2', intensity: 3.5, elevationDeg: 54, azimuthDeg: -58 }, // white-hot; gold pass: higher sun, short soft shadows
        fill: { color: '#d8b0b4', intensity: 0.95 }, // dusty rose-violet
        hemi: { sky: '#ffe9c8', ground: '#c08c94', intensity: 0.5 },
        gobo: { key: 0.16, tint: 0.08 },
        shadow: { lightSize: 0.28, leak: '#8c6470' },
        fade: { color: '#c0905c', colorRight: '#b08668', start: 7.0, end: 14.0, amount: 0.7 },
        background: '#b4885a',
      },
      post: { exposure: 0.73, contrast: 1.1, saturation: 1.04, tint: [1.02, 0.975, 0.94], shadowTint: '#2c1434', aoTint: '#5a3038', vignette: 0.1 },
      dof: { farGain: 0.68, focusBand: 0.32 }, // fixer pass: open country, the next landmark up the page stays readable
    },
    night: {
      lights: { fade: { color: '#0c0c2c', colorRight: '#0a0a24' }, background: '#0a0a28' },
    },
  },
  snow: {
    day: {
      lights: {
        key: { color: '#fbf0e0', intensity: 2.8, elevationDeg: 52 }, // near neutral, slightly warm (gold pass: higher)
        fill: { color: '#a4bbe0', intensity: 1.3 }, // cold blue
        hemi: { sky: '#dce8ff', ground: '#96aedc', intensity: 0.55 },
        gobo: { key: 0.14, tint: 0.03 },
        shadow: { lightSize: 0.32, leak: '#6c84b0' },
        fade: { color: '#aab4c8', colorRight: '#9aa6be', start: 6.5, end: 13.5, amount: 0.72 },
        background: '#a2aec4',
      },
      post: { exposure: 0.75, contrast: 1.08, saturation: 1.0, tint: [0.98, 1.0, 1.03], shadowTint: '#0a1c3a', aoTint: '#3a5078', vignette: 0.1, split: 0.02 },
      assets: { glowIntensity: 4.2 }, // a few warm windows read even by day
    },
    night: {
      lights: { hemi: { intensity: 0.36 }, key: { intensity: 0.8 }, fade: { color: '#0a1434', colorRight: '#08102a' }, background: '#09112e' },
      post: { exposure: 0.88, saturation: 0.68 },
    },
  },
  blossom: {
    day: {
      lights: {
        key: { color: '#ffe6cc', intensity: 2.9, elevationDeg: 62 }, // soft peach
        fill: { color: '#c9b9da', intensity: 1.15 }, // lilac
        hemi: { sky: '#fff1ec', ground: '#c4a6b8', intensity: 0.5 },
        gobo: { key: 0.18, tint: 0.09 },
        shadow: { lightSize: 0.32, leak: '#8c6c88' },
        fade: { color: '#bc9ea4', colorRight: '#ac94a2', start: 6.5, end: 13.5, amount: 0.7 },
        background: '#b0969e',
      },
      post: { exposure: 0.8, contrast: 1.05, saturation: 1.05, tint: [1.03, 0.98, 0.97], shadowTint: '#2a1832', aoTint: '#5a3848', greenDesat: 0.3, vignette: 0.1 },
    },
    night: {
      lights: { fade: { color: '#0b0d2e', colorRight: '#090a26' }, background: '#0a0b28' },
      post: { saturation: 0.68 },
    },
  },
  pinewood: {
    day: {
      lights: {
        key: { color: '#f8e2b6', intensity: 2.8, elevationDeg: 60 }, // weak warm sun breaking through the canopy
        fill: { color: '#62857f', intensity: 1.05 }, // teal
        hemi: { sky: '#c0d6cc', ground: '#55786e', intensity: 0.6 },
        gobo: { key: 0.14, tint: 0.03 },
        shadow: { lightSize: 0.4, leak: '#44685c' },
        fade: { color: '#788e84', colorRight: '#6c8480', start: 4.8, end: 11.5, amount: 0.82 }, // mist: shorter view than elsewhere
        background: '#748a82',
      },
      post: { exposure: 0.86, contrast: 1.08, saturation: 0.98, tint: [0.99, 1.0, 0.97], shadowTint: '#0a2420', aoTint: '#2c4c44', greenDesat: 0.4, vignette: 0.13, split: 0.02 },
      assets: { glowIntensity: 4.2 },
      dof: { farGain: 0.75, focusBand: 0.3 },
    },
    night: {
      lights: {
        key: { color: '#86a8e8', intensity: 0.95 }, fill: { color: '#3a64a8', intensity: 0.5 }, hemi: { sky: '#4a74c0', ground: '#1a3c60', intensity: 0.85 }, // fixer pass: dark pine cards were solid black
        fade: { color: '#0b2238', colorRight: '#0a1c30', start: 4.6, end: 10.5, amount: 0.86 }, background: '#06162a',
      },
      post: { tint: [0.84, 0.99, 1.16] },
    },
  },
};

const isHex = (v) => typeof v === 'string' && v[0] === '#';
const _c = new THREE.Color();

function leaves(tree, path, out) {
  for (const k of Object.keys(tree)) {
    const v = tree[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) leaves(v, path.concat(k), out);
    else out.set(path.concat(k).join('.'), v);
  }
  return out;
}

/** hex -> linear rgb triple, array -> copy, number -> number */
function enc(v) {
  if (isHex(v)) { _c.set(v); return [_c.r, _c.g, _c.b]; }
  return Array.isArray(v) ? v.slice() : v;
}

/**
 * @param {number} [soft] blend half-width (tiles) of the biome cross-fade
 * @returns {{ update(dt:number, seed:number, x:number, z:number, night:number):boolean, weights:Float32Array, force(id:string|null):void }}
 */
export function createBiomeGrade({ soft = 2.0 } = {}) {
  const nb = BIOMES.length;
  const nightBase = leaves(NIGHT_BASE, [], new Map());
  const dayMaps = BIOMES.map((b) => leaves((GRADE[b] && GRADE[b].day) || {}, [], new Map()));
  const nightMaps = BIOMES.map((b) => leaves((GRADE[b] && GRADE[b].night) || {}, [], new Map()));
  const paths = new Set(nightBase.keys());
  for (const m of dayMaps) for (const k of m.keys()) paths.add(k);
  for (const m of nightMaps) for (const k of m.keys()) paths.add(k);

  const items = [];
  for (const path of paths) {
    const parts = path.split('.');
    let obj = CONFIG;
    for (let i = 0; i < parts.length - 1 && obj; i++) obj = obj[parts[i]];
    const k = parts[parts.length - 1];
    if (!obj || obj[k] === undefined) continue;
    const base = obj[k];
    const kind = isHex(base) ? 2 : Array.isArray(base) ? 1 : 0;
    const day = []; const night = [];
    for (let b = 0; b < nb; b++) {
      const d = dayMaps[b].has(path) ? dayMaps[b].get(path) : base;
      const n = nightMaps[b].has(path) ? nightMaps[b].get(path) : nightBase.has(path) ? nightBase.get(path) : d;
      day.push(enc(d)); night.push(enc(n));
    }
    items.push({ obj, k, kind, base, day, night, acc: kind ? [0, 0, 0] : 0, hasNight: nightBase.has(path) || nightMaps.some((m) => m.has(path)) });
  }

  const target = new Float32Array(nb);
  const w = new Float32Array(nb);
  const sm = new Float32Array(nb); // smoothed, unquantised
  sm[0] = 1;
  const applied = new Float32Array(nb).fill(-1);
  let appliedNight = -1;
  let first = true;
  let forced = -1;
  w[0] = 1;

  function write(e) {
    const pureHeartDay = e === 0 && w[0] === 1;
    for (const it of items) {
      if (pureHeartDay) { it.obj[it.k] = it.kind === 1 ? it.base.slice() : it.base; continue; }
      if (it.kind === 0) {
        let d = 0; let n = 0;
        for (let b = 0; b < nb; b++) { d += w[b] * it.day[b]; n += w[b] * it.night[b]; }
        it.obj[it.k] = d + (n - d) * e;
      } else {
        const a = it.acc;
        const len = it.kind === 2 ? 3 : it.base.length;
        for (let i = 0; i < len; i++) {
          let d = 0; let n = 0;
          for (let b = 0; b < nb; b++) { d += w[b] * it.day[b][i]; n += w[b] * it.night[b][i]; }
          a[i] = d + (n - d) * e;
        }
        if (it.kind === 2) it.obj[it.k] = '#' + _c.setRGB(a[0], a[1], a[2]).getHexString();
        else it.obj[it.k] = a.slice(0, len);
      }
    }
  }

  return {
    weights: w,
    /** Debug / captures: pin the grade to one biome (null = follow the traveller). */
    force(id) { forced = id == null ? -1 : BIOMES.indexOf(id); first = true; },
    /**
     * @param {number} dt seconds (0 = snap, used by teleports / captures)
     * @param {number} x world x / TILE_SIZE  @param {number} z world z / TILE_SIZE
     * @param {number} night eased 0..1
     * @returns {boolean} true when CONFIG was rewritten
     */
    update(dt, seed, x, z, night) {
      if (forced >= 0) { target.fill(0); target[forced] = 1; }
      else biomeWeights(seed, x, z, target, soft);
      // drop the long exponential tails (deep inside a biome the grade is exactly that biome's), renormalise
      let sum = 0;
      for (let b = 0; b < nb; b++) { target[b] = Math.max(0, target[b] - 0.03); sum += target[b]; }
      const k = first || dt <= 0 ? 1 : 1 - Math.exp(-dt * 2.2);
      first = false;
      let changed = night !== appliedNight;
      let wsum = 0;
      for (let b = 0; b < nb; b++) {
        sm[b] += (target[b] / sum - sm[b]) * k;
        // quantise so a standing traveller stops rewriting CONFIG (and re-parsing colours)
        w[b] = Math.round(sm[b] * 512) / 512;
        wsum += w[b];
      }
      for (let b = 0; b < nb; b++) { w[b] = wsum > 0 ? w[b] / wsum : +(b === 0); if (Math.abs(w[b] - applied[b]) > 1e-4) changed = true; }
      if (!changed) return false;
      applied.set(w); appliedNight = night;
      write(night);
      return true;
    },
  };
}
