// What stands on the island: where the story places are, the rules that scatter trees, rocks
// and bones round them, and the sites built by hand. Deterministic: the same island every time.
import { Rng, seedFromString } from '../core/rng.js';
import { Noise } from '../core/noise.js';
import { clamp, lerp, smoothstep } from '../core/math.js';
import { hasModel } from '../models/index.js';
import { GATE, ISLET, MERE, SCAR, PEAK, WORLD } from './heightmap.js';
import { placeCollider } from '../physics/collide.js';

const N = new Noise(9173);

/** March from a point in a direction until the ground crosses a level; returns the distance. */
function march(T, x, z, dx, dz, level, max = 200, step = 0.5) {
  const below = T.heightAt(x, z) < level;
  for (let d = step; d < max; d += step) if (T.heightAt(x + dx * d, z + dz * d) < level !== below) return d;
  return max;
}

/** Fixed places: computed from the land so they always sit right on it. */
export function planLayout(T) {
  const L = {};
  const at = (x, z) => ({ x, z, y: T.heightAt(x, z) });

  // the landing on the south shore, below the path
  {
    const d = march(T, 0, 250, 0, 1, 0.0, 120);
    L.shore = { x: 0, z: 250 + d, y: 0 };
    L.dock = { x: 0, z: 250 + d, y: 0, ry: 0 };
    L.start = { x: 0, z: 250 + d + 5.5, y: 1.0, heading: 0 };
  }
  L.chapel = { ...T.flat('chapel'), ry: 0 };
  L.lanterns = [
    { id: 'chapel', ...T.flat('lanternChapel') },
    { id: 'saltwood', ...T.flat('lanternSaltwood') },
    { id: 'mere', ...T.flat('lanternMere') },
    { id: 'scar', ...T.flat('lanternScar') },
  ];
  L.graves = T.flat('graves');
  L.village = T.flat('village');
  L.circle = T.flat('circle');
  L.tower = T.flat('tower');
  L.hollow = T.flat('hollow');
  L.gate = { ...at(GATE.x, GATE.z), ry: Math.PI / 2 };
  L.islet = at(ISLET.x, ISLET.z);

  // the causeway from the Mere's west shore to the islet: whole while the water is shallow, then
  // two gaps a jump will cross, then two that only ice will.
  {
    const a = L.lanterns[2];
    const dx = ISLET.x - a.x,
      dz = ISLET.z - a.z,
      len = Math.hypot(dx, dz),
      ux = dx / len,
      uz = dz / len;
    const hAt = (t) => T.heightAt(a.x + ux * t, a.z + uz * t);
    let t0 = 0,
      t1 = len;
    for (let t = 0; t < len; t += 0.25)
      if (hAt(t) < 0.5) {
        t0 = t;
        break;
      }
    for (let t = len; t > 0; t -= 0.25)
      if (hAt(t) < 0.1) {
        t1 = t;
        break;
      }
    const ry = Math.atan2(ux, uz);
    const piers = [];
    const P = (t) => piers.push({ x: a.x + ux * t, z: a.z + uz * t, ry, t });
    // unbroken run through the shallows
    let t = t0 + 0.9;
    while (hAt(t + 1.3) > -1.25) {
      P(t);
      t += 2.6;
    }
    P(t);
    // two short gaps, then split what remains into two long ones
    t += 2.6 + 1.5;
    P(t);
    t += 2.6 + 2.9;
    P(t);
    const rest = t1 - (t + 1.3);
    P(t + 1.3 + rest / 2);
    L.causeway = { piers, from: { x: a.x + ux * t0, z: a.z + uz * t0 }, to: { x: a.x + ux * t1, z: a.z + uz * t1 }, ux, uz, ry, gap: rest / 2 - 1.3 };
  }
  // the drowned bell tower, out in the deep of the Mere
  L.bell = at(MERE.x + 26, MERE.z - 22);

  // the Scar: a rockfall plugs the canyon; the sulphur shrine stands on the island in the lava
  {
    const c = T.canyon;
    const o = c.at(c.len * 0.42, {});
    L.rockfall = { ...at(o.x, o.z), ry: Math.atan2(o.tx, o.tz) + Math.PI / 2, tx: o.tx, tz: o.tz };
    L.scarIsland = at(SCAR.x, SCAR.z);
    const m = c.at(c.len, {});
    L.scarMouth = { ...at(m.x, m.z), tx: m.tx, tz: m.tz };
    // stepping stones from where the canyon opens toward the island
    const dx = SCAR.x - m.x,
      dz = SCAR.z - m.z,
      l = Math.hypot(dx, dz);
    L.scarStones = [22, 14.2].map((r) => ({ x: SCAR.x - (dx / l) * r, z: SCAR.z - (dz / l) * r, y: WORLD.lava }));
    L.scarApproach = { ux: dx / l, uz: dz / l };
  }

  // the bridge where the north road meets the river
  {
    const road = T.paths[2];
    let best = null;
    for (let s = 0; s < road.len; s += 0.5) {
      const o = road.at(s, {});
      const d = T.riverDist(o.x, o.z);
      if (!best || d < best.d) best = { d, s, x: o.x, z: o.z, tx: o.tx, tz: o.tz };
    }
    const ry = Math.atan2(best.tx, best.tz);
    const e0 = T.heightAt(best.x - best.tx * 8, best.z - best.tz * 8),
      e1 = T.heightAt(best.x + best.tx * 8, best.z + best.tz * 8);
    L.bridge = { x: best.x, z: best.z, y: Math.max(e0, e1) - 0.05, ry, tx: best.tx, tz: best.tz, e0, e1 };
  }
  L.peak = at(PEAK.x, PEAK.z);
  return L;
}

/** Exclusion discs round everything built, so scatter keeps clear. */
function keepOuts(T, L) {
  const k = [];
  for (const f of T.flats) k.push([f.x, f.z, f.name.startsWith('lantern') ? 3.4 : f.r + 1.5]);
  k.push([L.dock.x, L.dock.z, 10], [L.start.x, L.start.z, 6]);
  k.push([L.gate.x, L.gate.z, 10], [L.rockfall.x, L.rockfall.z, 10], [L.bridge.x, L.bridge.z, 11]);
  k.push([L.bell.x, L.bell.z, 9]);
  for (const p of L.causeway.piers) k.push([p.x, p.z, 5]);
  k.push([L.causeway.from.x, L.causeway.from.z, 6], [L.causeway.to.x, L.causeway.to.z, 5]);
  for (const s of L.scarStones) k.push([s.x, s.z, 4]);
  return k;
}

/**
 * Scatter rules. Each: m [name, seeds], spacing (m, jittered grid), want(ctx) -> probability 0..1,
 * scale [min, max], optional sink, tilt, slopeMax, collide, clear (m kept free of other big
 * things), path (m kept off the paths).
 */
function rules() {
  const grove = (c, f, o) => smoothstep(0.02, 0.3, N.fbm2(c.x / f + o, c.z / f - o, 3));
  return [
    // ---- sea stacks on the reefs
    { m: ['rock_spire', 6], spacing: 13, want: (c) => (c.L < -14 && c.h > -2.2 && c.h < 3 ? 0.85 : 0), scale: [1.2, 2.9], sink: 1.2, collide: true, clear: 6, path: 0 },
    { m: ['rock_boulder', 6], spacing: 9, want: (c) => (c.L < -8 && c.h > -1.6 && c.h < 2.5 ? 0.6 : 0), scale: [0.9, 2.2], sink: 0.5, collide: true, clear: 3, path: 0 },

    // ---- the Vale: bare moor with thin groves
    { m: ['tree_dead', 6], spacing: 15, want: (c) => (c.region === 'vale' || c.region === 'shore' ? 0.16 + 0.5 * grove(c, 70, 3) : 0) * c.soil, scale: [0.85, 1.5], sink: 0.2, collide: true, clear: 3.5, path: 3.2, slopeMax: 0.3 },
    { m: ['tree_birch', 5], spacing: 8, want: (c) => (c.region === 'vale' ? grove(c, 55, 40) * smoothstep(90, 25, c.river) * 0.75 + grove(c, 38, 77) * 0.25 : 0) * c.soil, scale: [0.8, 1.35], sink: 0.2, collide: true, clear: 2.4, path: 3, slopeMax: 0.3 },
    { m: ['shrub_heather', 4], spacing: 2.6, want: (c) => (c.region === 'vale' || c.region === 'heights' || c.region === 'shore' ? smoothstep(0.55, 0.9, c.mask.heather) * 0.7 * c.soil : 0), scale: [0.7, 1.4], path: 1.6, slopeMax: 0.4 },
    { m: ['shrub_thorn', 4], spacing: 9, want: (c) => (c.region === 'vale' || c.region === 'shore' ? 0.22 + 0.4 * grove(c, 40, 11) : c.region === 'scar' ? 0.08 : 0) * c.soil, scale: [0.8, 1.5], path: 2.2, slopeMax: 0.45, clear: 1.2 },
    { m: ['fern_dead', 4], spacing: 4.2, want: (c) => (c.region === 'vale' ? 0.12 + 0.6 * grove(c, 55, 40) * smoothstep(90, 25, c.river) : c.region === 'mere' ? 0.3 : 0) * c.soil, scale: [0.7, 1.3], path: 1.4, slopeMax: 0.4 },
    { m: ['grass_tall', 4], spacing: 3.6, want: (c) => (c.region !== 'scar' && c.region !== 'saltwood' ? 0.3 + 0.4 * c.mask.wet : 0.04) * c.soil, scale: [0.8, 1.5], path: 1.2, slopeMax: 0.4 },
    { m: ['mushrooms', 4], spacing: 11, want: (c) => (c.region === 'vale' || c.region === 'mere' ? 0.3 * grove(c, 55, 40) + 0.1 : 0) * c.soil, scale: [0.8, 1.4], path: 1 },
    { m: ['stump', 3], spacing: 22, want: (c) => (c.region === 'vale' ? 0.5 * grove(c, 55, 40) + 0.1 : 0) * c.soil, scale: [0.8, 1.3], collide: true, clear: 1.5, path: 2.5 },
    { m: ['log', 3], spacing: 26, want: (c) => (c.region === 'vale' || c.region === 'heights' ? 0.4 * grove(c, 55, 40) + 0.08 : 0) * c.soil, scale: [0.8, 1.3], collide: true, clear: 2.5, path: 3, slopeMax: 0.25 },

    // ---- rock everywhere, more where it is steep
    { m: ['rock_boulder', 6], spacing: 17, want: (c) => (c.L > 6 && c.region !== 'saltwood' ? 0.12 + smoothstep(0.1, 0.4, c.mask.slope) * 0.6 : 0), scale: [0.6, 2.4], sink: 0.35, tilt: 0.2, collide: true, clear: 2.2, path: 3 },
    { m: ['rock_slab', 6], spacing: 21, want: (c) => (c.L > 6 && c.region !== 'saltwood' ? smoothstep(0.16, 0.42, c.mask.slope) * 0.6 : 0), scale: [0.8, 2.2], sink: 0.3, collide: true, clear: 2.4, path: 3.5 },
    { m: ['rock_small', 6], spacing: 5.5, want: (c) => (c.L > 2 ? 0.1 + smoothstep(0.08, 0.3, c.mask.slope) * 0.35 + c.mask.ash * 0.2 + (c.h < 2.6 ? 0.25 : 0) : c.L > -4 ? 0.3 : 0), scale: [0.5, 1.6], sink: 0.06, tilt: 0.3, path: 1.1 },
    { m: ['bones', 3], spacing: 40, want: (c) => (c.region === 'scar' || c.region === 'saltwood' ? 0.6 : c.region === 'shore' ? 0.3 : 0.14) * (c.L > 3 ? 1 : 0), scale: [0.9, 1.3], path: 1 },

    // ---- the Heights: gaunt pines up to the tree line, then bare rock
    { m: ['tree_pine', 5], spacing: 8.5, want: (c) => (c.region === 'heights' || (c.region === 'vale' && c.h > 24) ? smoothstep(72, 52, c.h) * (0.25 + 0.6 * grove(c, 46, 90)) : 0) * c.soil, scale: [0.8, 1.5], sink: 0.25, collide: true, clear: 2.4, path: 3, slopeMax: 0.5 },
    { m: ['rock_spire', 6], spacing: 34, want: (c) => (c.region === 'heights' && c.h > 40 ? 0.4 : 0), scale: [1.0, 2.4], sink: 0.8, collide: true, clear: 4, path: 4 },

    // ---- the Saltwood: a dead forest turned to salt
    { m: ['tree_salt', 6], spacing: 7, want: (c) => (c.region === 'saltwood' ? 0.25 + 0.55 * grove(c, 44, 21) : 0) * (c.h > 5.75 ? 1 : 0.12), scale: [0.85, 1.5], sink: 0.2, collide: true, clear: 2.3, path: 3.2, slopeMax: 0.4 },
    { m: ['salt_crystal', 6], spacing: 11, want: (c) => (c.region === 'saltwood' ? 0.2 + 0.45 * grove(c, 30, 60) : 0), scale: [0.7, 2.0], sink: 0.1, collide: true, clear: 1.8, path: 2.4 },
    { m: ['statue_salt', 6], spacing: 30, want: (c) => (c.region === 'saltwood' ? 0.55 : 0), scale: [1, 1.08], sink: 0.05, collide: true, clear: 2, path: 2.2, slopeMax: 0.2 },

    // ---- the Mere: willows on the shore, reeds in the shallows
    { m: ['tree_willow', 5], spacing: 13, want: (c) => (c.region === 'mere' && c.h > 0.5 && c.h < 5 ? 0.6 : 0), scale: [0.85, 1.4], sink: 0.2, collide: true, clear: 4, path: 4 },
    { m: ['reeds', 4], spacing: 1.9, want: (c) => (c.region === 'mere' && c.h > -0.55 && c.h < 0.5 ? 0.62 : c.river < 9 && c.riverLvl != null && c.h > c.riverLvl - 0.4 && c.h < c.riverLvl + 0.4 ? 0.4 : 0), scale: [0.8, 1.5], path: 2.2 },

    // ---- the Scar: charred trunks, basalt and glass
    { m: ['tree_charred', 6], spacing: 9.5, want: (c) => (c.region === 'scar' && c.scar > 70 ? 0.2 + 0.4 * grove(c, 40, 5) : 0), scale: [0.8, 1.5], sink: 0.15, collide: true, clear: 2, path: 3, slopeMax: 0.5 },
    { m: ['rock_basalt', 6], spacing: 14, want: (c) => (c.region === 'scar' ? (c.scar < 60 ? (c.scar > 36 ? 0.75 : 0) : 0.3) : 0), scale: [0.9, 2.3], sink: 0.5, collide: true, clear: 2.6, path: 3.6 },
    { m: ['rock_obsidian', 6], spacing: 12, want: (c) => (c.region === 'scar' ? (c.scar < 58 ? (c.scar > 33 ? 0.5 : 0) : 0.2) : 0), scale: [0.6, 1.8], sink: 0.2, collide: true, clear: 2, path: 3 },
  ];
}

/**
 * Everything the world holds besides the land. `world` supplies T, scatter, collision and
 * place(); the result is the layout plus lists the game turns into things you can touch.
 */
export async function populate(world, tick = async () => {}) {
  const T = world.T,
    scatter = world.scatter,
    collision = world.collision;
  const L = planLayout(T);
  const rng = new Rng(seedFromString('morne'));
  const keep = keepOuts(T, L);
  const stats = {};
  const spots = { ingredients: [], lore: [], props: [], shades: [], crows: [], scorch: [] };

  // ---------------------------------------------------------------- helpers
  const occ = new Map(); // coarse occupancy for big things
  const OC = 4;
  const blocked = (x, z, r) => {
    const n = Math.ceil((r + 4) / OC);
    const ci = Math.floor(x / OC),
      cj = Math.floor(z / OC);
    for (let i = ci - n; i <= ci + n; i++)
      for (let j = cj - n; j <= cj + n; j++) {
        const list = occ.get(i * 4096 + j);
        if (!list) continue;
        for (const o of list) if (Math.hypot(o[0] - x, o[1] - z) < r + o[2]) return true;
      }
    return false;
  };
  const claim = (x, z, r) => {
    const k = Math.floor(x / OC) * 4096 + Math.floor(z / OC);
    let list = occ.get(k);
    if (!list) occ.set(k, (list = []));
    list.push([x, z, r]);
  };
  const inKeep = (x, z, pad) => {
    for (const k of keep) if (Math.hypot(k[0] - x, k[1] - z) < k[2] + pad) return true;
    return false;
  };
  const H = (x, z) => T.heightAt(x, z);
  /** One instanced thing with its colliders. y null = on the ground. */
  const put = (name, seed, x, z, ry = 0, scale = 1, { y = null, sink = 0, tilt = 0, tdir = 0, collide = true, tag = null } = {}) => {
    const yy = (y == null ? H(x, z) : y) - sink * scale;
    if (!scatter.add(name, seed, x, yy, z, ry, scale, tilt, tdir)) return false;
    if (collide) for (const c of scatter.colliders(name, seed)) collision.add(tag ? Object.assign(placeCollider(c, x, yy, z, ry, scale), { tag }) : placeCollider(c, x, yy, z, ry, scale));
    stats[name] = (stats[name] || 0) + 1;
    return true;
  };
  const ing = (kind, x, z, o = {}) => {
    const y = o.y != null ? o.y : H(x, z);
    spots.ingredients.push({ id: kind + ':' + spots.ingredients.length, kind, x, y, z, ry: rng.range(0, 6.283), seed: 1 + Math.floor(rng.next() * 4), scale: o.scale || rng.range(0.95, 1.25) });
  };
  /** n spots round a point, kept apart, on ground that passes `ok`. */
  const ringOf = (n, cx, cz, r0, r1, fn, ok = null, apart = 1.4) => {
    const got = [];
    for (let tries = 0; got.length < n && tries < n * 40; tries++) {
      const a = rng.range(0, 6.283),
        r = Math.sqrt(rng.range(r0 * r0, r1 * r1));
      const x = cx + Math.cos(a) * r,
        z = cz + Math.sin(a) * r;
      if (ok && !ok(x, z)) continue;
      if (got.some((g) => Math.hypot(g[0] - x, g[1] - z) < apart)) continue;
      got.push([x, z]);
      fn(x, z, got.length - 1);
    }
    return got;
  };
  const dry = (x, z) => H(x, z) > 0.6 && T.mask(x, z).slope < 0.3;

  // ---------------------------------------------------------------- the sites (they claim ground first)
  const named = (world.named = {});
  const P = (key, name, x, y, z, ry = 0, o = {}) => {
    if (!hasModel(name)) return null;
    const p = world.place(name, x, y, z, ry, o);
    if (key) named[key] = p;
    return p;
  };

  // --- the landing
  P('dock', 'dock', L.dock.x, 0, L.dock.z, 0, { tag: 'dock' });
  P('boat', 'boat', L.dock.x + 2.7, -0.16, L.dock.z + 4.6, 0.12);
  spots.props.push({ model: 'crate', x: L.dock.x - 0.7, z: L.dock.z - 5.2, y: 1.02, seed: 1 }, { model: 'barrel', x: L.dock.x + 0.75, z: L.dock.z - 6.4, y: 1.02, seed: 2 }, { model: 'crate', x: L.dock.x - 3.2, z: L.dock.z - 11, seed: 2 });
  P('waymark0', 'waymark', 2.6, H(2.6, L.dock.z - 14), L.dock.z - 14, 0.3);

  // --- the chapel and what is in it
  const ch = P('chapel', 'chapel', L.chapel.x, L.chapel.y, L.chapel.z, 0, { tag: 'chapel' });
  if (ch) {
    const A = (n) => ch.anchor(n);
    const a = A('athanor');
    if (a) P('athanor', 'athanor', a.x, a.y, a.z, 0, { tag: 'athanor' });
    const c = A('cauldron');
    if (c) {
      P('cauldron', 'cauldron', c.x, c.y, c.z, 0, { tag: 'cauldron' });
      P('bellows', 'bellows', c.x + 1.25, c.y, c.z + 0.2, -Math.PI / 2);
    }
    const w = A('workbench');
    if (w) {
      P('workbench', 'workbench', w.x, w.y, w.z, Math.PI / 2);
      P('alembic', 'alembic', w.x + 0.15, w.y, w.z - 1.9, Math.PI / 2);
      P('bookpile', 'bookpile', w.x + 0.1, w.y, w.z + 1.7, 0.7);
    }
    const s = A('shelf');
    if (s) {
      P('shelf', 'shelf', s.x, s.y, s.z, -Math.PI / 2);
      P('chest', 'chest', s.x - 0.25, s.y, s.z + 1.9, -Math.PI / 2 + 0.15);
      P('sack', 'sack', s.x - 0.2, s.y, s.z - 1.6, 1.1);
    }
    const l = A('lectern');
    if (l) P('lectern', 'lectern', l.x, l.y, l.z, 0);
    for (let i = 1; i <= 4; i++) {
      const p = A('candles' + i);
      if (p) P('candles' + i, 'candles', p.x, p.y, p.z, i * 1.3, { seed: i });
    }
    L.spawn = A('spawn') || { x: L.chapel.x, y: L.chapel.y + 0.4, z: L.chapel.z + 8 };
    L.door = A('door') || { x: L.chapel.x, y: L.chapel.y, z: L.chapel.z + 19 };
  } else {
    L.spawn = { x: L.chapel.x, y: L.chapel.y, z: L.chapel.z + 8 };
    L.door = { x: L.chapel.x, y: L.chapel.y, z: L.chapel.z + 19 };
  }
  // the pyre ground below the chapel, where the first Cinderblooms grow
  {
    const px = -30,
      pz = 96;
    L.pyre = { x: px, z: pz, y: H(px, pz) };
    keep.push([px, pz, 7]);
    spots.scorch.push([px, pz, 7.5, 1]);
    put('tree_charred', 2, px + 1.2, pz - 0.6, 0.4, 1.25, { sink: 0.15 });
    put('log', 1, px - 1.6, pz + 1.2, 1.1, 0.9);
    put('log', 2, px + 0.4, pz + 2.2, 2.6, 0.8);
    put('bones', 1, px - 0.5, pz - 2.1, 0.5, 1);
    ringOf(6, px, pz, 1.6, 5.6, (x, z) => ing('cinderbloom', x, z), dry, 1.5);
  }

  // --- lanterns of the dead
  L.lanterns.forEach((ln, i) => {
    ln.placed = P('lantern:' + ln.id, 'lantern', ln.x, ln.y, ln.z, [Math.PI, Math.PI / 2, -Math.PI / 2, 0][i], { tag: 'lantern' });
  });

  // --- the graveyard
  {
    const g = L.graves;
    const r = rng.fork(11);
    // crypt at the back, graves in ragged rows, a fence with a gate toward the chapel road
    P('crypt', 'crypt', g.x - 5.5, g.y, g.z - 6.5, 0.5);
    claim(g.x - 5.5, g.z - 6.5, 4.2);
    let k = 0;
    for (let row = 0; row < 4; row++)
      for (let c = 0; c < 6; c++) {
        const x = g.x - 6.5 + c * 2.7 + r.range(-0.4, 0.4),
          z = g.z - 2.2 + row * 3.0 + r.range(-0.4, 0.4);
        if (Math.hypot(x - g.x, z - g.z) > g.r - 1.6 || r.chance(0.16) || blocked(x, z, 0.8)) continue;
        put('grave', 1 + (k++ % 8), x, z, Math.PI + r.range(-0.2, 0.2), r.range(0.9, 1.15), { tilt: r.range(0, 0.12), tdir: r.range(0, 6.28) });
        claim(x, z, 0.9);
      }
    const n = 26,
      R = g.r - 0.4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = g.x + Math.cos(a) * R,
        z = g.z + Math.sin(a) * R;
      // gap for the gate: the east side, facing the chapel
      if (Math.abs(a) < 0.24 || Math.abs(a - Math.PI * 2) < 0.24) continue;
      if (r.chance(0.12)) continue;
      put('fence_iron', 1 + (i % 3), x, z, -a + Math.PI / 2, (2 * Math.PI * R) / n / 3);
    }
    P('gate_graves', 'gate_iron', g.x + R, H(g.x + R, g.z), g.z, Math.PI / 2);
    put('tree_dead', 3, g.x + 4.5, g.z - 7.5, 1.3, 1.5, { sink: 0.2 });
    claim(g.x + 4.5, g.z - 7.5, 3);
    ringOf(8, g.x, g.z, 2, g.r - 2, (x, z) => ing('saltwort', x, z), (x, z) => !blocked(x, z, 0.5), 1.6);
    spots.lore.push({ id: 'green', x: g.x - 3.6, z: g.z - 3.9, ry: 0.9 });
    spots.props.push({ model: 'skull', x: g.x + 2.2, z: g.z + 6.5, seed: 1 }, { model: 'skull', x: g.x - 6.8, z: g.z + 1.5, seed: 2 });
    spots.crows.push([g.x + 4.5, g.y + 6.5, g.z - 7.5], [g.x - 5.5, g.y + 3.4, g.z - 6.5]);
  }

  // --- the dead village
  {
    const v = L.village;
    const houses = [
      [-11, -9, 0.5, 1],
      [9, -12, -0.4, 2],
      [14, 4, -1.7, 3],
      [-13, 7, 1.9, 2],
      [1, 14, 3.0, 1],
    ];
    for (const [dx, dz, ry, seed] of houses) {
      const x = v.x + dx,
        z = v.z + dz;
      P(null, 'ruin_house', x, H(x, z), z, ry, { seed });
      claim(x, z, 5.5);
    }
    P('well', 'well', v.x, v.y, v.z, 0.4);
    claim(v.x, v.z, 2);
    P('cart', 'cart', v.x + 4.4, H(v.x + 4.4, v.z + 3.2), v.z + 3.2, 2.2);
    P('scarecrow', 'scarecrow', v.x - 18, H(v.x - 18, v.z - 1), v.z - 1, 1.0);
    P(null, 'ruin_wall', v.x - 3, H(v.x - 3, v.z - 17), v.z - 17, 0.2, { seed: 2 });
    P(null, 'ruin_wall', v.x + 19, H(v.x + 19, v.z - 5), v.z - 5, 1.5, { seed: 4 });
    spots.props.push({ model: 'barrel', x: v.x - 7.2, z: v.z - 5.2, seed: 1 }, { model: 'crate', x: v.x - 6.2, z: v.z - 6.0, seed: 3 }, { model: 'barrel', x: v.x + 10.5, z: v.z + 0.6, seed: 3 }, { model: 'crate', x: v.x + 2.5, z: v.z + 9.5, seed: 1 });
    spots.lore.push({ id: 'mending', x: v.x + 1.6, z: v.z - 1.3, ry: 2.2 });
    spots.scorch.push([v.x - 11, v.z - 9, 6, 0.8], [v.x + 14, v.z + 4, 6, 0.8], [v.x + 1, v.z + 14, 5, 0.7]);
    ringOf(5, v.x, v.z, 5, 20, (x, z) => ing('cinderbloom', x, z), (x, z) => !blocked(x, z, 0.5), 3);
    ringOf(3, v.x, v.z, 1.5, 3.2, (x, z) => ing('weepcap', x, z), null, 1);
    ringOf(4, v.x, v.z, 14, 23, (x, z) => ing('saltwort', x, z), (x, z) => !blocked(x, z, 0.5), 3);
    spots.crows.push([v.x - 11, v.y + 5.8, v.z - 9], [v.x + 14, v.y + 5.8, v.z + 4], [v.x - 18, v.y + 2.3, v.z - 1]);
  }

  // --- the stone circle on the windy hill
  {
    const c = L.circle;
    const glyphs = ['sulfur', null, 'mercury', null, 'salt', null, null];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.2;
      const x = c.x + Math.cos(a) * 7.2,
        z = c.z + Math.sin(a) * 7.2;
      const o = glyphs[i] ? { opts: { glyph: glyphs[i] }, seed: 1 + i } : { seed: 1 + (i % 6) };
      P(null, 'standing_stone', x, H(x, z), z, -a - Math.PI / 2, o);
      claim(x, z, 1.2);
    }
    spots.lore.push({ id: 'thunder', x: c.x + 0.6, z: c.z - 0.4, ry: 0.4 });
    ringOf(6, c.x, c.z, 9, 19, (x, z) => ing('stormthistle', x, z), dry, 3);
    spots.crows.push([c.x + 7.2, c.y + 3.6, c.z + 1.4]);
  }

  // --- the watchtower
  {
    const t = L.tower;
    P('tower', 'ruin_tower', t.x, t.y, t.z, 2.2);
    claim(t.x, t.z, 5.5);
    spots.lore.push({ id: 'gloom', x: t.x + 0.4, z: t.z + 0.2, ry: 1.2 });
    spots.scorch.push([t.x + 7, t.z + 6, 4.5, 0.8]);
    ringOf(4, t.x + 7, t.z + 6, 0.8, 3.8, (x, z) => ing('cinderbloom', x, z), dry, 1.4);
    spots.crows.push([t.x, t.y + 10.5, t.z]);
  }

  // --- the bridge
  {
    const b = L.bridge;
    P('bridge', 'bridge', b.x, b.y, b.z, b.ry);
    ringOf(3, b.x + 9, b.z + 10, 1, 5, (x, z) => ing('weepcap', x, z), dry, 1.5);
  }

  // --- the briar gate into the Saltwood
  {
    const g = L.gate;
    P('gate', 'briar_wall', g.x, g.y - 0.15, g.z, g.ry, { scale: 1.3, tag: 'briar' });
    P(null, 'ruin_arch', g.x + 7, H(g.x + 7, g.z), g.z, g.ry);
    spots.lore.push({ id: 'standing', x: -160, z: 53.5, ry: 2.0 });
  }

  // --- the Elder Hollow
  {
    const h = L.hollow;
    const s = P('shrineSalt', 'shrine_salt', h.x, h.y, h.z, 0, { tag: 'shrine' });
    if (s) {
      const v = s.anchor('vine');
      if (v) {
        v.y = H(v.x, v.z);
        P('seed', 'seed_mound', v.x, v.y, v.z, 0);
        L.vine = { x: v.x, y: v.y, z: v.z, top: s.anchor('ledge') };
      }
      L.primeSalt = s.anchor('prime');
    }
    claim(h.x, h.z, 6);
    ringOf(7, h.x, h.z, 5, 16, (x, z) => ing('halite', x, z), (x, z) => !blocked(x, z, 0.6) && T.pathDist(x, z) > 1.5, 2.4);
  }
  // halite seams through the wood
  for (const [x, z] of [
    [-170, 62],
    [-188, 30],
    [-206, 58],
    [-214, 18],
  ])
    ringOf(2, x, z, 0, 5, (px, pz) => ing('halite', px, pz), dry, 2);

  // --- Quickmere: the causeway, the islet shrine, the drowned belfry
  {
    const cw = L.causeway;
    cw.piers.forEach((p, i) => P(null, 'causeway_pier', p.x, 0, p.z, p.ry, { seed: 1 + (i % 4), tag: 'pier' }));
    put('causeway_rubble', 1, cw.from.x - cw.ux * 0.6, cw.from.z - cw.uz * 0.6, cw.ry, 1, { y: 0.35, collide: false });
    const is = L.islet;
    const s = P('shrineMercury', 'shrine_mercury', is.x + 0.5, is.y, is.z, -1.2, { tag: 'shrine' });
    if (s) L.primeMercury = s.anchor('prime');
    claim(is.x, is.z, 3.4);
    ringOf(4, is.x, is.z, 3.6, 5.6, (x, z) => ing('quicksilver', x, z), (x, z) => H(x, z) > 0.9, 2);
    P('bell', 'bell_tower', L.bell.x, L.bell.y, L.bell.z, 0.7);
    put('ruin_pillar', 1, 205, 92, 0.3, 1.2);
    put('ruin_pillar', 3, 163, 30, 1.3, 1.1);
    // lilies in the black shallows round the west and south shores
    let n = 0;
    const lr = rng.fork(77);
    for (let tries = 0; n < 14 && tries < 6000; tries++) {
      const a = lr.range(1.2, 4.6),
        r = lr.range(MERE.r - 34, MERE.r + 10);
      const x = MERE.x + Math.cos(a) * r,
        z = MERE.z + Math.sin(a) * r;
      const d = H(x, z);
      if (d > -0.3 || d < -0.9) continue;
      if (spots.ingredients.some((s2) => s2.kind === 'mirrorlily' && Math.hypot(s2.x - x, s2.z - z) < 7)) continue;
      if (Math.hypot(x - cw.from.x, z - cw.from.z) < 6) continue;
      ing('mirrorlily', x, z, { y: 0, scale: lr.range(1.0, 1.35) });
      n++;
    }
    const m = L.lanterns[2];
    spots.lore.push({ id: 'stillness', x: m.x + 4.5, z: m.z + 2.5, ry: 0.5 }, { id: 'rising', x: 149, z: 100, ry: 2.4 });
    ringOf(4, m.x, m.z, 5, 14, (x, z) => ing('saltwort', x, z), dry, 3);
    ringOf(3, 150, 98, 1, 6, (x, z) => ing('weepcap', x, z), dry, 2);
  }

  // --- the Scar: the rockfall, the stepping stones, the shrine and its braziers
  {
    const rf = L.rockfall;
    P('rockfall', 'rock_cracked', rf.x, rf.y - 0.2, rf.z, rf.ry, { scale: 1.18, tag: 'rockfall' });
    L.scarStones.forEach((s, i) => P(null, 'stepping_stone', s.x, s.y, s.z, i * 1.7, { seed: 1 + i, tag: 'stone' }));
    const is = L.scarIsland;
    const sh = P('shrineSulfur', 'shrine_sulfur', is.x, is.y, is.z, Math.atan2(-L.scarApproach.ux, -L.scarApproach.uz), { tag: 'shrine' });
    L.braziers = [];
    if (sh) {
      L.primeSulfur = sh.anchor('prime');
      for (let i = 1; i <= 3; i++) {
        const p = sh.anchor('brazier' + i);
        if (!p) continue;
        const b = P('brazier' + i, 'brazier', p.x, p.y, p.z, i * 2.1, { tag: 'brazier' });
        L.braziers.push({ id: i, x: p.x, y: p.y, z: p.z, placed: b });
      }
    }
    // brimstone round the vents on the shore terrace, stormthistle on the ridge below
    const br = rng.fork(5);
    let n = 0;
    for (let tries = 0; n < 9 && tries < 3000; tries++) {
      const a = br.range(0, 6.283),
        r = br.range(SCAR.lava + 3, SCAR.lava + 13);
      const x = SCAR.x + Math.cos(a) * r,
        z = SCAR.z + Math.sin(a) * r;
      if (H(x, z) < WORLD.lava + 0.25 || T.mask(x, z).slope > 0.2) continue;
      if (spots.ingredients.some((s2) => s2.kind === 'brimstone' && Math.hypot(s2.x - x, s2.z - z) < 9)) continue;
      if (Math.hypot(x - L.scarMouth.x, z - L.scarMouth.z) < 5) continue;
      ing('brimstone', x, z);
      keep.push([x, z, 1.5]);
      n++;
    }
    const sm = L.lanterns[3];
    ringOf(5, sm.x - 16, sm.z + 8, 2, 16, (x, z) => ing('stormthistle', x, z), dry, 4);
    ringOf(3, sm.x + 3, sm.z + 14, 1, 6, (x, z) => ing('cinderbloom', x, z), dry, 2);
    spots.scorch.push([sm.x + 3, sm.z + 14, 5, 0.8]);
    spots.lore.push({ id: 'work', x: L.scarMouth.x - L.scarMouth.tz * 3.2 + L.scarMouth.tx * 4, z: L.scarMouth.z + L.scarMouth.tx * 3.2 + L.scarMouth.tz * 4, ry: 1.0 });
    P('gibbet', 'gibbet', sm.x - 5.5, H(sm.x - 5.5, sm.z + 5), sm.z + 5, 0.8);
  }

  // --- the summit
  {
    const pk = L.peak;
    P('cairn_peak', 'cairn', pk.x + 1.2, H(pk.x + 1.2, pk.z + 0.8), pk.z + 0.8, 0, { seed: 2 });
    spots.lore.push({ id: 'last', x: pk.x - 0.4, z: pk.z + 1.6, ry: 0.3 });
  }

  // --- roadside things
  for (const [x, z, ry, name, seed] of [
    [-5, 196, 0.3, 'waymark', 1],
    [-12, 132, -0.4, 'cairn', 1],
    [-70, 68, 1.2, 'waymark', 1],
    [60, 76, 2.4, 'waymark', 1],
    [26, -62, 0.5, 'cairn', 3],
    [34, -100, 1.9, 'gibbet', 1],
    [-36, -12, 0.2, 'cairn', 2],
    [98, 70, 2.9, 'cairn', 1],
    [-190, 49, 1.0, 'cairn', 3],
  ]) {
    if (T.pathDist(x, z) < 1.9) continue;
    P(null, name, x, H(x, z), z, ry, { seed });
    claim(x, z, 1.2);
  }
  await tick(0.2);

  // ---------------------------------------------------------------- ingredients that follow the land
  {
    const r = rng.fork(404);
    // weepcap along the river banks
    let n = 0;
    for (let s = 30; s < T.river.len - 20 && n < 12; s += r.range(22, 40)) {
      const o = T.river.at(s, {});
      const side = r.sign();
      for (let d = 2.5; d < 9; d += 0.5) {
        const x = o.x - o.tz * d * side,
          z = o.z + o.tx * d * side;
        const lvl = T.riverLevel(x, z);
        if (lvl == null || H(x, z) > lvl + 0.35) {
          if (H(x, z) > 1 && !inKeep(x, z, 1)) {
            ing('weepcap', x, z);
            keep.push([x, z, 1]);
            n++;
          }
          break;
        }
      }
    }
    // saltwort on the south shore
    for (let i = 0; i < 7; i++) {
      const x = -90 + i * 30 + r.range(-8, 8);
      const d = march(T, x, 250, 0, 1, 1.6, 120);
      const z = 250 + d - r.range(1, 5);
      if (H(x, z) > 1.2 && !inKeep(x, z, 1)) ing('saltwort', x, z);
    }
    // corpselight and saltwort in the Saltwood, off the path
    let c = 0;
    for (let tries = 0; c < 13 && tries < 6000; tries++) {
      const x = r.range(-330, -125),
        z = r.range(-60, 130);
      if (T.regionAt(x, z) !== 'saltwood' || H(x, z) < 6 || T.mask(x, z).slope > 0.25) continue;
      const pd = T.pathDist(x, z);
      if (pd < 3 || pd > 46 || inKeep(x, z, 2)) continue;
      if (spots.ingredients.some((s2) => s2.kind === 'corpselight' && Math.hypot(s2.x - x, s2.z - z) < 16)) continue;
      ing('corpselight', x, z);
      keep.push([x, z, 1.2]);
      if (c % 3 === 0) ing('saltwort', x + 2.5, z + 1.5);
      c++;
    }
    // stormthistle high on Greyhorn
    let t = 0;
    for (let tries = 0; t < 4 && tries < 4000; tries++) {
      const x = PEAK.x + r.range(-90, 110),
        z = PEAK.z + r.range(-20, 150);
      const h = H(x, z);
      if (h < 46 || h > 80 || T.mask(x, z).slope > 0.22 || T.landDist(x, z) < 12) continue;
      if (spots.ingredients.some((s2) => s2.kind === 'stormthistle' && Math.hypot(s2.x - x, s2.z - z) < 30)) continue;
      ing('stormthistle', x, z);
      t++;
    }
  }

  // ---------------------------------------------------------------- where the Shades wait
  {
    const r = rng.fork(909);
    const want = { saltwood: 8, mere: 4, scar: 5 };
    const box = { saltwood: [-330, -128, -70, 140], mere: [130, 300, -30, 140], scar: [0, 140, -320, -150] };
    for (const region of Object.keys(want)) {
      let n = 0;
      const b = box[region];
      for (let tries = 0; n < want[region] && tries < 8000; tries++) {
        const x = r.range(b[0], b[1]),
          z = r.range(b[2], b[3]);
        const h = H(x, z);
        if (T.regionAt(x, z) !== region || h < 0.8 || T.mask(x, z).slope > 0.3) continue;
        const sd = Math.hypot(x - SCAR.x, z - SCAR.z);
        if (region === 'scar' && (sd < SCAR.lava + 4 || sd > 46) && T.canyonDist(x, z) > 3.5) continue;
        if (L.lanterns.some((l) => Math.hypot(l.x - x, l.z - z) < 26)) continue;
        if (spots.shades.some((s) => Math.hypot(s.x - x, s.z - z) < 30)) continue;
        spots.shades.push({ id: region + ':' + n, region, x, z });
        n++;
      }
    }
    spots.shades.push({ id: 'saltwood:keeper', region: 'saltwood', x: L.hollow.x + 9, z: L.hollow.z + 9 });
  }

  // ---------------------------------------------------------------- the scatter
  const half = WORLD.half - 6;
  const nrm = [0, 1, 0];
  const list = rules();
  for (let ri = 0; ri < list.length; ri++) {
    const rule = list[ri];
    const [name, seeds] = rule.m;
    if (!hasModel(name)) continue;
    const sp = rule.spacing;
    const r2 = rng.fork(seedFromString(name) + (sp | 0));
    for (let gz = -half; gz < half; gz += sp)
      for (let gx = -half; gx < half; gx += sp) {
        const x = gx + r2.next() * sp,
          z = gz + r2.next() * sp;
        const roll = r2.next(),
          rs = r2.next(),
          ra = r2.next(),
          rv = r2.next();
        const h = H(x, z);
        if (h < -3) continue;
        const mask = T.mask(x, z);
        if (rule.slopeMax != null && mask.slope > rule.slopeMax) continue;
        const ctx = { x, z, h, L: T.landDist(x, z), mask, region: T.regionAt(x, z), river: T.riverDist(x, z), riverLvl: null, scar: Math.hypot(x - SCAR.x, z - SCAR.z), soil: 0 };
        if (ctx.river < 12) ctx.riverLvl = T.riverLevel(x, z);
        // "soil": dry ground a plant can stand in
        ctx.soil = h > 1.4 && mask.snow < 0.5 && (ctx.riverLvl == null || h > ctx.riverLvl + 0.25) ? 1 : 0;
        if (!(rule.want(ctx) > roll)) continue;
        if (rule.path && T.pathDist(x, z) < rule.path) continue;
        if (T.canyonDist(x, z) < 5.2) continue;
        if (ctx.region === 'scar' && ctx.scar < SCAR.lava + 2) continue;
        if (inKeep(x, z, rule.clear ? 1 : 0)) continue;
        if (rule.clear && blocked(x, z, rule.clear)) continue;
        const scale = lerp(rule.scale[0], rule.scale[1], rs * rs);
        const seed = 1 + Math.floor(rv * seeds);
        let tilt = 0,
          tdir = 0;
        if (rule.tilt) {
          T.normalAt(x, z, nrm);
          tilt = Math.acos(clamp(nrm[1], 0, 1)) * 0.6 + (rv - 0.5) * rule.tilt;
          tdir = Math.atan2(nrm[2], nrm[0]);
        }
        if (!put(name, seed, x, z, ra * Math.PI * 2, scale, { sink: rule.sink || 0, tilt, tdir, collide: !!rule.collide })) continue;
        if (rule.clear) claim(x, z, rule.clear);
      }
    if (ri % 4 === 3) await tick(0.2 + (0.8 * (ri + 1)) / list.length);
  }

  world.layout = L;
  world.spots = spots;
  world.popStats = stats;
  return L;
}
