// What a zombie's type changes, as pure functions over tuning.zombies (the stats table lives there).
// No three.js, no DOM: manager.js applies them to records, crowd slots and bodies.
//
//   typeDef(type)                         the type's row (unknown -> walker)
//   partScale(type, part, dir, yaw)       damage multiplier for a hit on part (head x3; armour)
//   attackDamage(type, crawling, armsMissing)
//   animState(animator, want)             the state to ask the animator for (falls back by kind)
//   poolPlan(count)                       which bodies the pool builds (kind + buildZombie opts)
//   bodyKind(type)                        the pool kind a type takes its body from
//   explosionLimbs(rng, limbs, out)       the limbs a killing blast takes (1..3 still attached)
import { tuning } from '../game/tuning.js';

const Z = tuning.zombies;
export const TYPE_IDS = Z.ids;
export const LIMB_PARTS = ['armL', 'armR', 'legL', 'legR'];

export function typeDef(type) { return Z.types[type] || Z.types.walker; }
export function isType(type) { return !!Z.types[type]; }

// Damage multiplier for a hit on `part`. dir: the direction the hit travels ([x,y,z] or {x,y,z},
// optional); yaw: the zombie's facing (forward = (sin yaw, cos yaw)). Armour: a torso hit travelling
// against the facing (from the front) takes `front`, one along it (from behind) `back`; arms and legs
// take `limbs`; a hit with no direction (fire) is not stopped by armour.
export function partScale(type, part, dir, yaw) {
  if (part === 'head') return tuning.walker.headMultiplier;
  const a = typeDef(type).armour;
  if (!a) return 1;
  if (part === 'torso') {
    if (!dir) return 1;
    const dx = dir.x ?? dir[0], dz = dir.z ?? dir[2];
    if (!Number.isFinite(dx) || !Number.isFinite(dz) || (dx === 0 && dz === 0)) return 1;
    return dx * Math.sin(yaw) + dz * Math.cos(yaw) < 0 ? a.front : a.back;
  }
  if (part === 'armL' || part === 'armR' || part === 'legL' || part === 'legR') return a.limbs;
  return 1;
}

// Damage of a landed swing: the type's (a crawler's is its own), halved for each missing arm.
export function attackDamage(type, crawling, armsMissing) {
  const base = crawling ? Z.crawler.attack : typeDef(type).attack;
  return base * Z.limbs.armScale ** (armsMissing || 0);
}

// Animator states. The animator adds run, crawl, slam, window, tear and burst and lists them in
// `animator.states`; until then (no list, or the state is not in it) each falls back to the nearest
// original state.
export const BASE_STATES = ['idle', 'walk', 'attack', 'stagger', 'climb', 'dead'];
const FALLBACK = { run: 'walk', crawl: 'walk', slam: 'attack', tear: 'attack', window: 'climb', burst: 'attack' };
export function animState(animator, want) {
  const list = (animator && animator.states) || BASE_STATES;
  if (list.includes(want)) return want;
  const f = FALLBACK[want] || 'walk';
  return list.includes(f) ? f : 'walk';
}

export function bodyKind(type) {
  return type === 'brute' ? 'brute' : type === 'bloater' ? 'bloater' : type === 'armoured' ? 'armoured' : 'civilian';
}

// The pool: tuning.zombies.pool special bodies, the rest civilians (variant picked by the caller's
// rng from pool.civilians). Returns [{kind, opts}], specials first.
export function poolPlan(count, pick) {
  const P = Z.pool;
  const out = [];
  const add = (kind, n, opts) => { for (let k = 0; k < n && out.length < count; k++) out.push({ kind, opts: typeof opts === 'function' ? opts() : opts }); };
  add('brute', P.brute, { build: 'brute', sex: 'm' });
  add('bloater', P.bloater, { build: 'bloated', sex: 'm' });
  add('armoured', P.armoured, { variant: 'trooper' });
  add('civilian', count - out.length, () => ({ variant: pick ? pick(P.civilians) : P.civilians[0] }));
  return out;
}

// A killing explosion takes 1..3 of the limbs still attached. limbs: {armL, armR, legL, legR} (true =
// attached); out: an array to fill (cleared first). Returns out.
export function explosionLimbs(rng, limbs, out) {
  out.length = 0;
  for (const p of LIMB_PARTS) if (limbs[p]) out.push(p);
  const [lo, hi] = Z.limbs.explosion;
  const n = Math.min(out.length, rng.int(lo, hi));
  // a partial shuffle: the first n are the ones taken
  for (let k = 0; k < n; k++) { const j = k + Math.floor(rng.next() * (out.length - k)); const t = out[k]; out[k] = out[j]; out[j] = t; }
  out.length = n;
  return out;
}
