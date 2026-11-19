// Audio engine: synthesises every buffer from the seeded RNG (spread across tasks after boot), builds
// the Web Audio graph on the first user gesture, plays positional one-shots under a voice budget,
// runs the ambience, reverb and music, and reacts to game events (events.js). The same graph code
// renders offline (OfflineAudioContext) for measurement (scripts/audio-render.mjs).
import { createRng } from '../core/rng.js';
import { SR, fadeEdges } from './synth.js';
import { SFX } from './sfx.js';
import { AMBIENCE, AREAS, createAmbience } from './ambience.js';
import { WEAPON_SFX, WEAPON_ALIASES } from './weapons.js';
import { VOICE_SFX } from './voices.js';
import { FOLEY_SFX } from './foley.js';
import { MUSIC_SFX, MUSIC_NAMES, createMusic, musicIntensity } from './music.js';
import { makeHandlers, EVENTS, TEST_SCRIPT, createWorldState } from './events.js';

const DEFS = { ...SFX, ...AMBIENCE, ...WEAPON_SFX, ...VOICE_SFX, ...FOLEY_SFX, ...MUSIC_SFX };
delete DEFS.reload; // the original single pistol reload: replaced by the scheduled parts in weapons.js
// Memory on phones: buffers whose content sits well below 12 kHz are synthesised at 24 kHz (rain on a
// roof, thunder, the music, voices, tails, stings) and the broadband rain at 32 kHz. 24 kHz is the
// lowest rate every browser's createBuffer takes. Impulse responses stay at the context's rate
// (a convolver needs it) and are resampled when the context runs at another rate.
const RATE = {
  rain_asphalt: 32000, fire_loop: 32000, box_roll: 32000,
  ...Object.fromEntries(['rain_canopy', 'rain_roof', 'rain_tin', 'rain_car', 'lamp_buzz', 'neon_buzz', 'thunder', 'music_drone', 'music_pulse',
    'music_high', 'explosion_far', 'power_hum', 'decoy_chatter', 'gas_hiss', 'sting_round_start', 'sting_round_end', 'sting_boss',
    'pistol_tail_open', 'tail_open_medium', 'tail_open_heavy', 'zombie_groan', 'zombie_death', 'zombie_pain', 'zombie_snarl',
    'runner_pant', 'armoured_groan', 'bloater_gurgle', 'bloater_swell', 'brute_roar', 'brute_growl', 'bench_grind', 'box_move',
    'door_roller', 'door_sheet', 'power_hum'].map((k) => [k, 24000])),
};
for (const k of Object.keys(RATE)) if (DEFS[k]) DEFS[k] = { ...DEFS[k], sr: RATE[k] };
export const rateOf = (name) => (DEFS[name] && DEFS[name].sr) || SR;
const ALIASES = { ...WEAPON_ALIASES };

// Synthesis priority: what is heard first (title-screen rain, the starting pistol) goes first; the
// music bed last (and not at all on a tier that has it off, until it is switched on).
const ORDER = [
  'rain_asphalt', 'ir_open', 'pistol', 'pistol_tail_open', 'dry_fire', 'ir_canopy', 'rain_canopy', 'lamp_buzz',
  'pistol_tail_canopy', 'mag_out', 'mag_in', 'slide_rack', 'weapon_draw', 'casing', 'step_asphalt', 'step_concrete',
  'impact_hard', 'impact_flesh', 'impact_head', 'zombie_groan', 'zombie_snarl', 'zombie_pain', 'zombie_death',
  'tail_room_light', 'ir_diner', 'ir_kitchen', 'ir_motelRoom', 'ir_walkway', 'ir_garage', 'ir_scrapyard', 'rain_roof',
  'rain_tin', 'sting_round_start', 'sting_round_end', 'purchase2', 'denied2', 'hint_blip', 'player_hurt',
];
const LAST = new Set(MUSIC_NAMES);
// Buffers that loop (seamless by construction: no edge fades on them).
const LOOPED = /^(rain_|lamp_buzz|neon_buzz|fire_loop|flare_whoosh|decoy_chatter|gas_hiss|rummage_|music_)/;

// Mix table by buffer: gain, reverb send, per-name voices, pitch spread (+/- fraction), priority
// (3 the player's own: never stolen; 2 threats: never stolen; 1 world; 0 detail), steal (a new one
// takes the oldest of the same name when its limit is reached), bus ('ui' is heard while paused,
// 'hero' is not ducked by the brute).
const P3 = { prio: 3 }, UI = { prio: 3, bus: 'ui', send: 0 };
const SHOT_GAIN = { smg: 0.6, lmg: 0.62, pump: 0.72, revolver: 0.72, jumper: 0.6, flare: 0.55 };
const MIX = {
  // weapons
  pistol: { gain: 0.7, send: 0.3, voices: 4, jitter: 0.025, prio: 3, steal: true },
  ...Object.fromEntries(['revolver', 'pump', 'autoShotgun', 'smg', 'rifle', 'battleRifle', 'lmg', 'jumper', 'flare'].map((id) => [`shot_${id}`, { gain: SHOT_GAIN[id] ?? 0.66, send: 0.3, voices: 4, jitter: 0.02, prio: 3, steal: true }])),
  pistol_tail_open: { gain: 0.3, send: 0, voices: 3, jitter: 0.03, prio: 3, steal: true },
  pistol_tail_canopy: { gain: 0.28, send: 0, voices: 3, jitter: 0.03, prio: 3, steal: true },
  tail_open_medium: { gain: 0.32, send: 0, voices: 3, jitter: 0.03, prio: 3, steal: true },
  tail_open_heavy: { gain: 0.36, send: 0, voices: 3, jitter: 0.03, prio: 3, steal: true },
  tail_room_light: { gain: 0.24, send: 0, voices: 3, jitter: 0.03, prio: 3, steal: true },
  tail_room_heavy: { gain: 0.28, send: 0, voices: 3, jitter: 0.03, prio: 3, steal: true },
  upgrade_zing: { gain: 0.16, send: 0.2, voices: 2, prio: 3, steal: true },
  suppressor_puff: { gain: 0.35, send: 0.1, voices: 3, prio: 3, steal: true },
  dry_fire: { gain: 0.15, send: 0.08, voices: 2, ...P3 },
  ...Object.fromEntries(['mag_out', 'mag_in', 'slide_rack', 'bolt_rack', 'shell_in', 'pump_rack', 'cyl_open', 'cyl_eject', 'speed_load', 'cyl_close', 'cover_open', 'belt', 'cover_close', 'cell_out', 'cell_in', 'flare_break', 'flare_close'].map((k) => [k, { gain: 0.2, send: 0.08, voices: 3, jitter: 0.02, ...P3 }])),
  weapon_draw: { gain: 0.14, send: 0.05, voices: 2, ...P3 },
  casing: { gain: 0.07, send: 0.15, voices: 4, jitter: 0.04, prio: 0, steal: true },
  swing_knife: { gain: 0.25, send: 0.05, voices: 2, ...P3 },
  swing_axe: { gain: 0.3, send: 0.05, voices: 2, ...P3 },
  melee_stab: { gain: 0.45, send: 0.15, voices: 3, prio: 3 },
  melee_chop: { gain: 0.5, send: 0.15, voices: 3, prio: 3 },
  throw_whoosh: { gain: 0.2, send: 0.05, voices: 2, ...P3 },
  pin_pull: { gain: 0.14, send: 0.05, voices: 2, ...P3 },
  bottle_slosh: { gain: 0.14, send: 0.05, voices: 2, ...P3 },
  decoy_arm: { gain: 0.1, send: 0.05, voices: 2, ...P3 },
  glass_smash: { gain: 0.4, send: 0.3, voices: 2, prio: 2 },
  explosion: { gain: 0.9, send: 0.35, voices: 3, prio: 2, jitter: 0.04 },
  explosion_far: { gain: 0.45, send: 0.3, voices: 2, prio: 1 },
  explosion_small: { gain: 0.5, send: 0.3, voices: 2, prio: 2 },
  fire_ignite: { gain: 0.4, send: 0.3, voices: 3, prio: 2 },
  fire_loop: { gain: 0.25, send: 0.3, voices: 4, prio: 1, jitter: 0.05 },
  flare_whoosh: { gain: 0.3, send: 0.2, voices: 2, prio: 3 },
  flare_burst: { gain: 0.4, send: 0.3, voices: 2, prio: 2 },
  arc_zap: { gain: 0.35, send: 0.2, voices: 6, prio: 3, steal: true },
  decoy_chatter: { gain: 0.25, send: 0.3, voices: 2, prio: 1 },
  // impacts
  impact_hard: { gain: 0.8, send: 0.35, voices: 6, steal: true },
  impact_metal: { gain: 0.6, send: 0.35, voices: 4, steal: true },
  impact_glass: { gain: 0.5, send: 0.35, voices: 3 },
  impact_flesh: { gain: 0.5, send: 0.2, voices: 6, steal: true },
  impact_head: { gain: 0.6, send: 0.2, voices: 4, prio: 2 },
  head_burst: { gain: 0.4, send: 0.2, voices: 2, prio: 2 },
  drip: { gain: 0.1, send: 0.2, voices: 4, prio: 0, jitter: 0.1 },
  // zombies
  zombie_groan: { gain: 0.7, send: 0.45, voices: 6, jitter: 0.07 },
  zombie_snarl: { gain: 0.3, send: 0.35, voices: 4, jitter: 0.06, prio: 2 },
  zombie_pain: { gain: 0.4, send: 0.3, voices: 4, jitter: 0.08 },
  zombie_death: { gain: 0.35, send: 0.4, voices: 4, jitter: 0.06 },
  runner_scream: { gain: 0.32, send: 0.4, voices: 3, jitter: 0.06, prio: 2 },
  runner_pant: { gain: 0.3, send: 0.3, voices: 3, jitter: 0.08, prio: 0 },
  armoured_groan: { gain: 0.8, send: 0.4, voices: 3, jitter: 0.05 },
  gear_rattle: { gain: 0.18, send: 0.2, voices: 3, jitter: 0.08, prio: 0 },
  bloater_gurgle: { gain: 0.55, send: 0.4, voices: 2, jitter: 0.06 },
  bloater_swell: { gain: 0.6, send: 0.3, voices: 2, prio: 2 },
  bloater_burst: { gain: 0.8, send: 0.4, voices: 2, prio: 2 },
  gas_hiss: { gain: 0.12, send: 0.2, voices: 2, prio: 0 },
  brute_roar: { gain: 0.85, send: 0.45, voices: 2, prio: 2, bus: 'hero', jitter: 0.04 },
  brute_growl: { gain: 0.6, send: 0.4, voices: 2, prio: 1, jitter: 0.05 },
  brute_step: { gain: 0.5, send: 0.3, voices: 4, prio: 1, jitter: 0.06 },
  brute_slam: { gain: 0.9, send: 0.4, voices: 1, prio: 2, bus: 'hero' },
  crawler_drag: { gain: 0.3, send: 0.2, voices: 3, prio: 0, jitter: 0.08 },
  sever: { gain: 0.4, send: 0.25, voices: 3 },
  board_break: { gain: 0.45, send: 0.3, voices: 3, jitter: 0.05 },
  board_hammer: { gain: 0.35, send: 0.25, voices: 2, ...P3 },
  window_climb: { gain: 0.4, send: 0.3, voices: 2 },
  player_hurt: { gain: 0.35, send: 0.05, voices: 2, ...P3 },
  // footsteps
  ...Object.fromEntries(['asphalt', 'concrete', 'tile', 'wood', 'carpet', 'metal', 'dirt'].map((k) => [`step_${k}`, { gain: k === 'carpet' ? 0.08 : 0.1, send: 0.08, voices: 4, jitter: 0.06, prio: 1, steal: true }])),
  // world
  knife_switch: { gain: 0.5, send: 0.3, voices: 1, ...P3 },
  power_hum: { gain: 0.2, send: 0.2, voices: 1 },
  door_boarded: { gain: 0.45, send: 0.3, voices: 2, ...P3 },
  door_sheet: { gain: 0.45, send: 0.3, voices: 2, ...P3 },
  door_roller: { gain: 0.45, send: 0.3, voices: 2, ...P3 },
  ...Object.fromEntries(['car', 'drawer', 'lid', 'locker'].map((k) => [`rummage_${k}`, { gain: 0.25, send: 0.1, voices: 1, jitter: 0, ...P3 }])),
  ...Object.fromEntries(['car', 'drawer', 'lid', 'locker'].map((k) => [`open_${k}`, { gain: 0.35, send: 0.15, voices: 1, ...P3 }])),
  ...Object.fromEntries(['ammo', 'points', 'medkit', 'throwable', 'plate', 'powerup', 'attachment', 'weapon', 'nothing'].map((k) => [`reward_${k}`, { gain: 0.25, send: 0.1, voices: 1, jitter: 0, ...P3 }])),
  box_roll: { gain: 0.3, send: 0.2, voices: 1, jitter: 0, ...P3 },
  box_reveal: { gain: 0.3, send: 0.2, voices: 1, jitter: 0, ...P3 },
  box_take: { gain: 0.25, send: 0.1, voices: 1, ...P3 },
  box_expire: { gain: 0.25, send: 0.2, voices: 1, jitter: 0, ...P3 },
  box_move: { gain: 0.35, send: 0.3, voices: 1, jitter: 0 },
  machine_buy: { gain: 0.3, send: 0.15, voices: 1, ...P3 },
  bench_grind: { gain: 0.3, send: 0.2, voices: 1, jitter: 0, ...P3 },
  pickup: { gain: 0.25, send: 0.1, voices: 2, ...P3 },
  armor_plate: { gain: 0.25, send: 0.05, voices: 1, ...P3 },
  revive: { gain: 0.3, send: 0.05, voices: 1, ...P3 },
  powerup_drop: { gain: 0.2, send: 0.3, voices: 2 },
  sting_resupply: { gain: 0.2, voices: 1, jitter: 0, ...UI },
  sting_oneTap: { gain: 0.2, voices: 1, jitter: 0, ...UI },
  sting_doubleTime: { gain: 0.2, voices: 1, jitter: 0, ...UI },
  sting_flashover: { gain: 0.2, voices: 1, jitter: 0, ...UI },
  powerup_end: { gain: 0.16, voices: 1, jitter: 0, ...UI },
  powerup_lapse: { gain: 0.14, send: 0.2, voices: 2, jitter: 0 },
  sting_round_start: { gain: 0.16, send: 0.25, voices: 1, jitter: 0, prio: 3 },
  sting_round_end: { gain: 0.14, send: 0.25, voices: 1, jitter: 0, prio: 3 },
  sting_boss: { gain: 0.2, send: 0.25, voices: 1, jitter: 0, prio: 3 },
  hint_blip: { gain: 0.1, voices: 1, jitter: 0, ...UI },
  ui_tick: { gain: 0.08, voices: 2, jitter: 0, ...UI },
  purchase: { gain: 0.12, send: 0.1, voices: 2, jitter: 0, ...UI },
  denied: { gain: 0.12, send: 0.05, voices: 2, jitter: 0, ...UI },
  purchase2: { gain: 0.16, voices: 2, jitter: 0, ...UI },
  denied2: { gain: 0.16, voices: 2, jitter: 0, ...UI },
  thunder: { gain: 0.13, send: 0.2, voices: 2, jitter: 0.05, prio: 1 },
};

// Hard caps on simultaneous voices (ambience beds and music are not voices): 32, 24 on the phone tier.
// G.quality.audioVoices wins when a tier sets it.
export const VOICE_CAP = { desktop: 32, mobile: 24 };
const POOL = 48; // records: the cap plus room for G.quality.audioVoices up to 48
export const voiceCapFor = (q) => Math.min(POOL, q && Number.isFinite(q.audioVoices) ? q.audioVoices : q && q.tier === 'mobile' ? VOICE_CAP.mobile : VOICE_CAP.desktop);
// HRTF costs a convolution per voice: the phone tier pans with equal power.
export const panningFor = (q) => (q && q.tier === 'mobile' ? 'equalpower' : 'HRTF');
// The music bed starts off on the phone tier.
export const musicDefaultFor = (q) => !(q && q.tier === 'mobile');

// Inverse distance model: full level within 2 m, about -12 dB at 9 m, -19 dB at 20 m.
const REF_DIST = 2, ROLLOFF = 0.9;
// Occlusion levels: 1 = a wall with openings (glass, a doorway), 2 = a closed wall between zones.
const OCCL = [null, { lp: 2200, gain: 0.6, send: 0.6 }, { lp: 700, gain: 0.32, send: 0.35 }];

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
export const toArr = (p) => (!p ? null : Array.isArray(p) || ArrayBuffer.isView(p) ? p : [p.x ?? 0, p.y ?? 0, p.z ?? 0]);
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const known = (n) => typeof n === 'string' && (hasOwn(DEFS, n) || hasOwn(ALIASES, n));

// ------------------------------------------------------------------ synthesis store

function createStore(rng, { skip = () => false } = {}) {
  const data = new Map(); // 'name.i' -> Float32Array[] (channels)
  const queue = [];
  const dropped = new Set();
  const held = []; // skipped for now (music on a tier that has it off); enqueue() releases them
  const push = (name) => { for (let i = 0; i < DEFS[name].variants; i++) (skip(name) ? held : queue).push([name, i]); };
  for (const name of ORDER) push(name);
  for (const name of Object.keys(DEFS)) if (!ORDER.includes(name) && !LAST.has(name)) push(name);
  for (const name of LAST) push(name);
  const stats = { count: 0, totalMs: 0, maxMs: 0, maxName: '', wallMs: 0, jobs: {}, maxSliceMs: 0, maxSliceKey: '', bytes: 0 };
  let resolveReady;
  const ready = new Promise((r) => { resolveReady = r; });
  const t0 = now();

  // A generator may be a plain function returning a buffer, or a function* that yields between
  // stages (large beds); `active` holds the one in progress so run() can resume it next slice.
  let active = null; // { key, it, ms }
  function save(key, r, ms) {
    const ch = Array.isArray(r) ? r : [r];
    // No click where a one-shot starts or stops: 0.4 ms in (the attack stays under a millisecond), 3 ms out.
    const name = key.slice(0, key.lastIndexOf('.'));
    if (!LOOPED.test(name) && !name.startsWith('ir_')) for (const c of ch) { fadeEdges(c, rateOf(name), 0.0004, 0.003); zeroMean(c); }
    data.set(key, ch);
    stats.count++; stats.totalMs += ms; stats.jobs[key] = ms; stats.bytes += ch.length * ch[0].length * 4;
    if (ms > stats.maxMs) { stats.maxMs = ms; stats.maxName = key; }
  }
  function step(name, i, deadline) {
    const key = `${name}.${i}`;
    if (data.has(key)) return true;
    let s = now();
    if (!active || active.key !== key) {
      const r = DEFS[name].gen(rateOf(name), rng.fork(`audio:${key}`), i);
      if (!r || typeof r.next !== 'function') { save(key, r, now() - s); return true; }
      active = { key, it: r, ms: now() - s };
      s = now();
    }
    for (;;) {
      const { value, done } = active.it.next();
      if (done) { save(key, value, active.ms + now() - s); active = null; return true; }
      if (now() >= deadline) { active.ms += now() - s; return false; }
    }
  }
  const synth = (name, i) => step(name, i, Infinity);
  function finishIfDone() {
    if (queue.length === 0 && resolveReady) { stats.wallMs = now() - t0; resolveReady(stats); resolveReady = null; }
  }
  function run(budgetMs) {
    const start = now(), end = start + budgetMs;
    let last = '';
    while (queue.length) {
      const [name, i] = queue[0];
      last = `${name}.${i}`;
      if (!step(name, i, end)) break;
      queue.shift();
      if (now() >= end) break;
    }
    const ms = now() - start;
    if (budgetMs < 1e6 && ms > stats.maxSliceMs) { stats.maxSliceMs = ms; stats.maxSliceKey = last; }
    finishIfDone();
  }
  const store = {
    stats, ready, run,
    pending: () => queue.length,
    has: (key) => data.has(key),
    // The live graph keeps its own AudioBuffer: the synthesised copy can go (halves the memory).
    drop(key) { data.delete(key); dropped.add(key); },
    dropped: (key) => dropped.has(key),
    // Release held jobs (the music bed switched on): they run in the next slices.
    enqueue() { while (held.length) queue.push(held.shift()); },
    get(key) {
      if (!data.has(key)) {
        // Needed before its turn: synthesise now (rare; a few ms) and drop it from the queue.
        const dot = key.lastIndexOf('.');
        const name = key.slice(0, dot), i = Number(key.slice(dot + 1));
        if (!DEFS[name]) return null;
        const qi = queue.findIndex(([n, v]) => n === name && v === i);
        if (qi >= 0) queue.splice(qi, 1);
        const hi = held.findIndex(([n, v]) => n === name && v === i);
        if (hi >= 0) held.splice(hi, 1);
        if (active && active.key !== key) { const keep = active; active = null; synth(name, i); active = keep; } else synth(name, i);
        finishIfDone();
      }
      return data.get(key);
    },
    synthAll() { store.enqueue(); while (queue.length) run(1e9); finishIfDone(); return stats; },
  };
  return store;
}

// ------------------------------------------------------------------ graph (live or offline)

// A one-shot whose samples do not sum to zero leaves a DC step in the mix when it is played fast and
// often (an LMG's burst). Remove the mean in proportion to the sound's own envelope, so no constant
// pedestal (and no click) is added where it is silent.
function zeroMean(c) {
  let m = 0, e = 0, ws = 0;
  for (let i = 0; i < c.length; i++) m += c[i];
  m /= c.length;
  if (Math.abs(m) < 1e-7) return;
  const w = new Float32Array(c.length), k = 0.002;
  for (let i = 0; i < c.length; i++) { e += (Math.abs(c[i]) - e) * k; w[i] = e; }
  for (let i = c.length - 1, f = 0; i >= 0; i--) { f += (Math.abs(c[i]) - f) * k; w[i] = Math.min(w[i], f) + 1e-9; ws += w[i]; }
  const g = (m * c.length) / ws;
  for (let i = 0; i < c.length; i++) c[i] -= g * w[i];
}

// Linear-interpolation resample (impulse responses only, once per space).
function resample(src, from, to) {
  const n = Math.max(1, Math.round((src.length * to) / from)), out = new Float32Array(n), k = from / to;
  for (let i = 0; i < n; i++) { const x = i * k, j = Math.floor(x), f = x - j; out[i] = (src[j] || 0) * (1 - f) + (src[j + 1] || 0) * f; }
  return out;
}

function softClipCurve() {
  const n = 4096, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1, a = Math.abs(x);
    c[i] = Math.sign(x) * (a < 0.7 ? a : 0.7 + 0.27 * Math.tanh((a - 0.7) / 0.27));
  }
  return c;
}

function createGraph(ctx, store, rng, { autoThunder = true, onThunder = null, voiceCap = () => VOICE_CAP.desktop, panning = () => 'HRTF', lazy = false, cache = new Map() } = {}) {
  // A one-shot is synthesised on demand if it is needed before its turn (a few ms).
  function getNow(key) {
    if (cache.has(key)) return cache.get(key);
    const d = store.get(key);
    if (!d) return null;
    const name = key.slice(0, key.lastIndexOf('.'));
    let rate = rateOf(name), chans = d;
    // a convolver's response must run at the context's rate
    if (name.startsWith('ir_') && rate !== ctx.sampleRate) { chans = d.map((c) => resample(c, rate, ctx.sampleRate)); rate = ctx.sampleRate; }
    const b = ctx.createBuffer(chans.length, chans[0].length, rate);
    chans.forEach((ch, i) => b.copyToChannel(ch, i));
    cache.set(key, b);
    if (lazy) store.drop(key);
    return b;
  }
  // Beds, impulse responses and music wait for their turn live (never stall a frame on a long one).
  const getBuffer = (key) => (cache.has(key) ? cache.get(key) : lazy && !store.has(key) ? null : getNow(key));

  // Buses: dry and ambience (ducked by the brute) and the reverb return make the world; the world is
  // silenced by the pause and muffled by death; ui is heard always. Then volume, compressor, clipper.
  const master = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12; comp.knee.value = 6; comp.ratio.value = 4; comp.attack.value = 0.002; comp.release.value = 0.2;
  const makeup = ctx.createGain(); makeup.gain.value = 1.1;
  const clip = ctx.createWaveShaper(); clip.curve = softClipCurve(); clip.oversample = 'none';
  // the clipper turns an asymmetric burst (gunfire) into a little DC: a 12 Hz high-pass after it
  const dcOut = ctx.createBiquadFilter(); dcOut.type = 'highpass'; dcOut.frequency.value = 12; dcOut.Q.value = 0.5;
  master.connect(comp).connect(makeup).connect(clip).connect(dcOut).connect(ctx.destination);
  const world = ctx.createGain();
  const muffle = ctx.createBiquadFilter();
  muffle.type = 'lowpass'; muffle.frequency.value = 20000; muffle.Q.value = 0.5;
  world.connect(muffle).connect(master);
  const ui = ctx.createGain(); ui.connect(master);
  const duck = ctx.createGain(); duck.connect(world); // the brute's roar ducks everything under it
  const dry = ctx.createGain(); dry.connect(duck);
  const hero = ctx.createGain(); hero.connect(world);
  const amb = ctx.createGain(); amb.connect(duck);
  const reverbIn = ctx.createGain();
  const revReturn = ctx.createGain(); revReturn.gain.value = AREAS.open.ret; revReturn.connect(duck);
  // two convolver slots cross-faded on an area change (0.3 s); a new space loads into the silent one
  const slots = [0, 1].map(() => { const g = ctx.createGain(); g.gain.value = 0; g.connect(revReturn); return { g, node: null, ir: '' }; });
  let cur = 0;
  function loadSlot(s, ir) {
    const b = getBuffer(`${ir}.0`);
    if (!b) return false;
    if (s.node) { try { reverbIn.disconnect(s.node); s.node.disconnect(); } catch (e) { /* already */ } }
    const node = ctx.createConvolver();
    node.buffer = b;
    reverbIn.connect(node).connect(s.g);
    s.node = node; s.ir = ir;
    return true;
  }
  slots[0].g.gain.value = 1;
  let wantIR = AREAS.open.ir;
  // the current slot's response, once it is synthesised (called every frame; loads only on a change)
  function loadIRs() { const s = slots[cur]; if (s.ir !== wantIR) loadSlot(s, wantIR); }
  loadIRs();

  const listener = { pos: [0, 0, 0] };
  // Voice records (fixed pool, reused): bookkeeping by end time works the same live and offline.
  const recs = Array.from({ length: POOL }, () => ({ on: false, name: '', prio: 0, end: 0, t0: 0, id: 0, src: null, g: null }));
  let nextId = 1;
  const lastVariant = new Map();
  let area = 'open';
  const count = { stolen: 0, dropped: 0, droppedTop: 0, peak: 0 };

  function prune(when) { let n = 0; for (const r of recs) { if (r.on && r.end <= when) { r.on = false; r.src = null; r.g = null; } if (r.on) n++; } return n; }
  function release(r, when, fade = 0.012) {
    if (!r.on) return;
    try { r.g.gain.cancelScheduledValues(when); r.g.gain.setTargetAtTime(0, when, fade / 3); r.src.stop(when + fade * 2); } catch (e) { /* stopped */ }
    r.on = false; r.src = null; r.g = null; r.end = when;
  }
  // no back-to-back repeat of a variant
  function pickVariant(base, n) {
    if (n <= 1) return 0;
    const last = lastVariant.get(base);
    let v = rng.int(0, n - (last === undefined ? 1 : 2));
    if (last !== undefined && v >= last) v++;
    lastVariant.set(base, v);
    return v;
  }

  // play(name, {pos, gain, pitch, variant, prio, occl, loop, seconds, send, lowpass, fadeIn, offset}, when) -> handle | null
  function play(name, opts = {}, when = ctx.currentTime) {
    const alias = ALIASES[name];
    const base = alias ? alias.base : name;
    const def = DEFS[base];
    if (!def) return null;
    const m = MIX[base] || {};
    const variant = opts.variant ?? pickVariant(base, def.variants);
    const buf = opts.loop ? getBuffer(`${base}.${variant}`) : getNow(`${base}.${variant}`);
    if (!buf) return null;
    const pos = toArr(opts.pos);
    let d = 0;
    if (pos) d = Math.hypot(pos[0] - listener.pos[0], pos[1] - listener.pos[1], pos[2] - listener.pos[2]);
    let prio = opts.prio ?? m.prio ?? 1;
    if (pos && prio < 3) { if (prio === 2 && d > 22) prio = 1; else if (prio < 2 && d > 22) prio = 0; }
    // Budget: per-name limit (steal the oldest of the same name, or drop), then the hard cap (steal
    // the lowest-priority, oldest voice below priority 2 and below this one, or drop).
    const active = prune(when);
    let same = 0, oldestSame = null;
    for (const r of recs) if (r.on && r.name === base) { same++; if (!oldestSame || r.t0 < oldestSame.t0) oldestSame = r; }
    let victim = null;
    if (same >= (m.voices ?? 8)) {
      if (m.steal && oldestSame) victim = oldestSame; else { count.dropped++; return null; }
    } else if (active >= voiceCap()) {
      for (const r of recs) if (r.on && r.prio < 2 && r.prio < prio && (!victim || r.prio < victim.prio || (r.prio === victim.prio && r.t0 < victim.t0))) victim = r;
      if (!victim) { count.dropped++; if (prio >= 2) count.droppedTop++; return null; }
    }
    if (victim) { release(victim, when); count.stolen++; }
    let rec = null;
    for (const r of recs) if (!r.on) { rec = r; break; }
    if (!rec) { count.dropped++; return null; }

    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (opts.loop) src.loop = true;
    const rate = (opts.pitch ?? 1) * (alias?.pitch ?? 1) * (1 + (m.jitter ?? 0.02) * (rng.next() * 2 - 1));
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    const occl = OCCL[opts.occl | 0];
    const level = (m.gain ?? 1) * (opts.gain ?? 1) * (alias?.gain ?? 1) * (occl ? occl.gain : 1);
    const t = Math.max(when, 0);
    if (opts.fadeIn) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + opts.fadeIn); } else g.gain.value = level;
    src.connect(g);
    let head = g;
    const lpHz = Math.min(alias?.lowpass ?? 20000, opts.lowpass ?? 20000, pos ? Math.max(900, 18000 * Math.exp(-d / 18)) : 20000, occl ? occl.lp : 20000);
    if (lpHz < 19000) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.Q.value = 0.5; lp.frequency.value = lpHz;
      head = head.connect(lp);
    }
    const out = m.bus === 'ui' ? ui : m.bus === 'hero' ? hero : dry;
    const sendAmt = (m.send ?? 0.2) * (opts.send ?? 1) * (occl ? occl.send : 1);
    let pan = null;
    if (pos) {
      pan = ctx.createPanner();
      pan.panningModel = panning(); pan.distanceModel = 'inverse';
      pan.refDistance = REF_DIST; pan.rolloffFactor = ROLLOFF; pan.maxDistance = 100;
      pan.positionX.value = pos[0]; pan.positionY.value = pos[1]; pan.positionZ.value = pos[2];
      head.connect(pan).connect(out);
      if (sendAmt > 0) {
        // Reverb falls off slower than the direct sound: far sounds are wetter.
        const send = ctx.createGain();
        const att = REF_DIST / (REF_DIST + ROLLOFF * Math.max(0, d - REF_DIST));
        send.gain.value = sendAmt * Math.sqrt(att);
        head.connect(send).connect(reverbIn);
      }
    } else {
      head.connect(out);
      if (sendAmt > 0) { const send = ctx.createGain(); send.gain.value = sendAmt; head.connect(send).connect(reverbIn); }
    }
    src.start(t, opts.offset ? opts.offset % buf.duration : 0);
    rec.on = true; rec.name = base; rec.prio = prio; rec.t0 = t; rec.id = nextId++; rec.src = src; rec.g = g;
    rec.end = opts.loop ? Infinity : t + buf.duration / rate;
    const handle = { rec, id: rec.id, pan };
    if (opts.loop && opts.seconds > 0) stop(handle, t + opts.seconds, 0.4);
    const n = prune(t); if (n > count.peak) count.peak = n;
    // layers (an upgraded shot's ring, a suppressed shot's puff) play with it as voices of their own
    if (alias && alias.layers) for (const l of alias.layers) play(l, { pos: opts.pos, gain: opts.gain }, when);
    return handle;
  }
  // Stop a handle (fade in seconds). A handle whose voice was stolen or ended is ignored.
  function stop(h, when = ctx.currentTime, fade = 0.012) {
    if (!h || !h.rec || h.rec.id !== h.id || !h.rec.on) return;
    const r = h.rec;
    if (fade > 0.05) {
      try { r.g.gain.cancelScheduledValues(when); r.g.gain.setTargetAtTime(0, when, fade / 3); r.src.stop(when + fade * 2); } catch (e) { /* stopped */ }
      r.end = when + fade * 2;
    } else release(r, when, fade);
  }
  // Move a positional handle (loops that follow something); no allocation.
  function setPos(h, x, y, z, when = ctx.currentTime) {
    if (!h || !h.pan || !h.rec || h.rec.id !== h.id || !h.rec.on) return;
    h.pan.positionX.setTargetAtTime(x, when, 0.03); h.pan.positionY.setTargetAtTime(y, when, 0.03); h.pan.positionZ.setTargetAtTime(z, when, 0.03);
  }

  const thunderRng = rng.fork('thunder');
  const ambience = createAmbience(ctx, amb, (n) => getBuffer(`${n}.0`), rng.fork('ambience'), {
    autoThunder,
    // The flash comes first and the sound follows by the distance of the strike (1 to 3 s: about
    // 350 m to a kilometre off). onThunder(delay) fires the flash; the offline render has none.
    playThunder: (when) => {
      const delay = onThunder ? thunderRng.range(1, 3) : 0;
      if (onThunder) onThunder(delay);
      play('thunder', { gain: onThunder ? 1.15 - 0.15 * delay : 1 }, when + delay);
    },
  });
  const music = createMusic(ctx, dry, (n) => getBuffer(`${n}.0`));

  function setArea(a, when = ctx.currentTime) {
    if (!AREAS[a] || a === area) return;
    area = a;
    ambience.setArea(a, when);
    const A = AREAS[a];
    revReturn.gain.setTargetAtTime(A.ret, when, 0.1);
    wantIR = A.ir;
    if (slots[cur].ir === wantIR) return;
    const nx = 1 - cur;
    if (slots[nx].ir !== wantIR && !loadSlot(slots[nx], wantIR)) return; // not synthesised yet: loadIRs fills the current slot later
    const a0 = slots[cur].g.gain, a1 = slots[nx].g.gain;
    a0.cancelScheduledValues(when); a0.setValueAtTime(a0.value, when); a0.linearRampToValueAtTime(0, when + 0.3);
    a1.cancelScheduledValues(when); a1.setValueAtTime(0, when); a1.linearRampToValueAtTime(1, when + 0.3);
    cur = nx;
  }

  // paused: the world is silent (UI still plays); dead: muffled and lower.
  function setState(state, when = ctx.currentTime) {
    const muf = state === 'dead' ? 600 : 20000;
    const vol = state === 'paused' ? 0 : state === 'dead' ? 0.7 : 1;
    muffle.frequency.setTargetAtTime(muf, when, 0.15);
    world.gain.setTargetAtTime(vol, when, state === 'paused' ? 0.04 : 0.15);
  }
  // The brute's roar: everything else dips under it, then comes back.
  function duckFor(seconds, when = ctx.currentTime, depth = 0.45) {
    duck.gain.cancelScheduledValues(when);
    duck.gain.setTargetAtTime(depth, when, 0.04);
    duck.gain.setTargetAtTime(1, when + seconds, 0.35);
  }

  return {
    ctx, master, listener, play, stop, setPos, setArea, setState, duckFor, ambience, music, loadIRs, count,
    activeVoices: () => prune(ctx.currentTime),
    get area() { return area; },
  };
}

// ------------------------------------------------------------------ where the listener is

// Boxes listed for the arcade under the motel walkway (no level record exists for them).
export const WALKWAY = [
  { name: 'walkway', min: [26.6, 0, -38], max: [60, 2.84, -36.4] },
  { name: 'walkway', min: [58.4, 0, -38], max: [60, 2.84, -17] },
];
const AREA_OF = { canopy: 'canopy', awning: 'canopy', diner: 'diner', kitchen: 'kitchen', motelRoom: 'motelRoom', garage: 'garage', walkway: 'walkway' };
const inBox = (a, p) => !!(a && a.min && a.max && p[0] >= a.min[0] && p[0] <= a.max[0] && p[2] >= a.min[2] && p[2] <= a.max[2] && p[1] >= (a.min[1] || 0) - 0.5 && p[1] <= a.max[1]);

// The acoustic space at pos ([x,y,z]): a covered box from the level (canopy, awning, diner, kitchen,
// a motel room, the garage bays), the arcade under the walkway, the scrapyard (the zone whose reverb
// is 'scrapyard'), else 'open'. Unknown covered boxes are 'canopy'. No allocation.
export function areaAt(areas, pos, level) {
  if (!pos) return 'open';
  if (Array.isArray(areas)) for (let i = 0; i < areas.length; i++) { const a = areas[i]; if (inBox(a, pos)) return AREA_OF[a.name] || 'canopy'; }
  for (let i = 0; i < WALKWAY.length; i++) if (inBox(WALKWAY[i], pos)) return 'walkway';
  if (level && typeof level.zoneAt === 'function' && level.zones) {
    const z = level.zoneAt(pos[0], pos[2]);
    const rec = z && level.zones[z];
    if (rec && rec.reverb === 'scrapyard') return 'scrapyard';
  }
  return 'open';
}

// What a sound at spos goes through to reach a listener at lpos: 0 the same space, 1 a wall with
// openings (an interior and the air around it, or two zones joined by an open door), 2 a closed
// wall (two zones with no open door between them).
export function occlusionAt(level, areas, lpos, spos) {
  if (!lpos || !spos) return 0;
  if (level && typeof level.zoneAt === 'function') {
    const lz = level.zoneAt(lpos[0], lpos[2]), sz = level.zoneAt(spos[0], spos[2]);
    if (lz && sz && lz !== sz) {
      const doors = level.doors;
      if (Array.isArray(doors)) for (let i = 0; i < doors.length; i++) {
        const d = doors[i];
        if (d && d.open && ((d.a === lz && d.b === sz) || (d.a === sz && d.b === lz))) return 1;
      }
      return 2;
    }
  }
  const la = areaAt(areas, lpos, level), sa = areaAt(areas, spos, level);
  const inside = (a) => a === 'diner' || a === 'kitchen' || a === 'motelRoom' || a === 'garage';
  return la !== sa && (inside(la) || inside(sa)) ? 1 : 0;
}

// ------------------------------------------------------------------ public module

export function createAudio(G = {}) {
  const rng = G.rng && G.rng.fork ? G.rng.fork('audio') : createRng(1);
  const hasWindow = typeof window !== 'undefined';
  let musicOn = musicDefaultFor(G.quality);
  const store = createStore(rng.fork('synth'), { skip: (n) => LAST.has(n) && !musicOn });
  let live = null;     // { gr, world, handlers }
  let camera = G.camera || null;
  let volume = 1;
  let area = 'open';
  let testQueue = null;
  let musicPin = null; // an intensity set by hand (harness), else computed
  const musicNow = { intensity: 0, lastQuarter: false };
  const prng = rng.fork('play');
  const offlineCache = new Map();
  const warned = new Set();
  const warnOnce = (name) => { if (warned.has(name)) return; warned.add(name); console.warn(`[audio] unknown sound "${name}"`); };
  const reportOnce = (msg) => { if (warned.has(msg)) return; warned.add(msg); console.warn(`[audio] ${msg}`); };

  // Progressive synthesis: a few ms per task so boot and the title screen keep their frame rate.
  let ticking = false;
  // While a round is being played the slices are smaller and spaced a frame apart.
  const tick = () => {
    const busy = G.game && G.game.state === 'playing';
    try { store.run(busy ? 4 : 8); } catch (e) { reportOnce(`synthesis: ${e && e.message}`); }
    if (store.pending() > 0) setTimeout(tick, busy ? 16 : 0); else ticking = false;
  };
  const kick = () => { if (hasWindow && typeof setTimeout === 'function' && !ticking && store.pending() > 0) { ticking = true; setTimeout(tick, 0); } };
  kick();

  const zlist = () => { const z = G.zombies; return Array.isArray(z?.list) ? z.list : Array.isArray(z?.alive) ? z.alive : null; };
  const findRec = (id) => { const l = zlist(); if (!l) return null; for (let i = 0; i < l.length; i++) if (l[i] && l[i].id === id) return l[i]; return null; };

  // Phones: iOS starts (and after a call, a lock or the app switcher, leaves) the context
  // 'suspended' or 'interrupted', and only a gesture lets it run. Every gesture therefore calls
  // unlock(): the first creates the context; every later one resumes it if it is not running and
  // starts a one-sample silent buffer inside the gesture (what iOS needs to route audio). Nothing
  // here may throw: a refused resume() rejects its promise, which is swallowed.
  const swallow = () => {};
  const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
  function wake(ctx) {
    try {
      const b = ctx.createBuffer(1, 1, ctx.sampleRate);
      const s = ctx.createBufferSource();
      s.buffer = b; s.connect(ctx.destination); s.start(0);
    } catch (e) { /* closed or not allowed: the next gesture tries again */ }
    try { if (ctx.state !== 'running' && ctx.state !== 'closed') { const p = ctx.resume(); if (p && p.catch) p.catch(swallow); } } catch (e) { /* ditto */ }
  }
  function newContext(AC) {
    try { return new AC({ sampleRate: SR, latencyHint: 'interactive' }); } catch (e) { /* old Safari: no options */ }
    return new AC();
  }
  function unlock() {
    if (!hasWindow) return;
    if (live) { if (!hidden()) wake(live.gr.ctx); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      const ctx = newContext(AC);
      wake(ctx);
      const gr = createGraph(ctx, store, prng, {
        autoThunder: true, lazy: true,
        voiceCap: () => voiceCapFor(G.quality),
        panning: () => panningFor(G.quality),
        // nearer strikes are brighter
        onThunder: (delay) => { if (G.sky && typeof G.sky.lightning === 'function') G.sky.lightning(1.1 - 0.22 * delay); },
      });
      gr.master.gain.value = volume;
      gr.setArea(area, ctx.currentTime);
      gr.ambience.start(ctx.currentTime + 0.05);
      if (G.level && G.level.power && G.level.power.on) gr.ambience.setPower(true, ctx.currentTime);
      if (G.game && G.game.state) gr.setState(G.game.state, ctx.currentTime);
      const world = createWorldState();
      live = { gr, world, handlers: makeHandlers({ gr, rng: prng, G, findRec, world, occl, surfaceAt }) };
      const q = new URLSearchParams(window.location.search).get('audiotest');
      if (q && q !== '0') testQueue = TEST_SCRIPT.map((e) => ({ ...e, at: ctx.currentTime + 0.5 + e.t }));
    } catch (e) {
      console.warn('[audio] unlock failed', e);
      live = null;
    }
  }
  if (hasWindow) {
    // Listeners stay on for the whole visit: any gesture may be the one that brings a suspended or
    // interrupted context back. touchend and click are the gestures iOS accepts; pointerdown,
    // touchstart and keydown are the earliest elsewhere.
    const onGesture = () => { try { unlock(); } catch (e) { /* never into an input handler */ } };
    for (const ev of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'click', 'keydown']) window.addEventListener(ev, onGesture, { capture: true, passive: true });
    // Backgrounded: suspend (no sound behind a lock screen or another app, no battery spent).
    // Back: resume; where the browser refuses without a gesture, the next gesture does it.
    const onVisible = () => {
      if (!live) return;
      const ctx = live.gr.ctx;
      try {
        if (hidden()) { if (ctx.state === 'running') { const p = ctx.suspend(); if (p && p.catch) p.catch(swallow); } } else wake(ctx);
      } catch (e) { /* ignore */ }
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    window.addEventListener('focus', onVisible);
  }

  // where a sound is heard from, for occlusion and footsteps
  const levelAreas = () => (G.level && G.level.areas) || null;
  function occl(pos) {
    if (!live) return 0;
    try { return occlusionAt(G.level, levelAreas(), live.gr.listener.pos, toArr(pos)); } catch (e) { return 0; }
  }
  function surfaceAt(pos, given) {
    if (given === 'metal' || given === 'wood' || given === 'tile' || given === 'carpet' || given === 'dirt') return given;
    const p = toArr(pos);
    if (!p) return given === 'concrete' ? 'concrete' : 'asphalt';
    const a = areaAt(levelAreas(), p, G.level);
    if (a === 'open') {
      // the motel's upper walkway (a steel deck) and its stairs (timber treads)
      if (p[1] > 2.6) return 'metal';
      const z = G.level && typeof G.level.zoneAt === 'function' ? G.level.zoneAt(p[0], p[2]) : null;
      if (z === 'motel' && p[1] > 0.15) return 'wood';
      return given === 'concrete' ? 'concrete' : 'asphalt';
    }
    return AREAS[a].floor;
  }

  if (G.events) {
    for (const ev of EVENTS) {
      G.events.on(ev, (p) => {
        if (!live) return;
        try { live.handlers[ev](p, live.gr.ctx.currentTime); } catch (e) { reportOnce(`handler ${ev}: ${e && e.message}`); }
      });
    }
  }

  function updateListener() {
    if (!camera) return;
    const L = live.gr.ctx.listener;
    if (camera.updateMatrixWorld) camera.updateMatrixWorld();
    const e = camera.matrixWorld && camera.matrixWorld.elements;
    if (!e) return;
    const p = live.gr.listener.pos; // reused: no allocation per frame
    p[0] = e[12]; p[1] = e[13]; p[2] = e[14];
    if (L.positionX) {
      const t = live.gr.ctx.currentTime;
      L.positionX.setValueAtTime(p[0], t); L.positionY.setValueAtTime(p[1], t); L.positionZ.setValueAtTime(p[2], t);
      L.forwardX.setValueAtTime(-e[8], t); L.forwardY.setValueAtTime(-e[9], t); L.forwardZ.setValueAtTime(-e[10], t);
      L.upX.setValueAtTime(e[4], t); L.upY.setValueAtTime(e[5], t); L.upZ.setValueAtTime(e[6], t);
    } else {
      L.setPosition(p[0], p[1], p[2]);
      L.setOrientation(-e[8], -e[9], -e[10], e[4], e[5], e[6]);
    }
  }

  // The acoustic space follows the listener every frame; setArea only on a change.
  function followArea() {
    if (testQueue) return; // the audio test script sets areas itself
    const next = areaAt(levelAreas(), live.gr.listener.pos, G.level);
    if (next !== area) api.setArea(next);
  }

  function runTestScript(t) {
    const base = live.gr.listener.pos;
    const rel = (p) => (p ? [p[0] + base[0], p[1] + base[1] - 1.6, p[2] + base[2]] : p);
    while (testQueue.length && testQueue[0].at <= t) {
      const e = testQueue.shift();
      if (e.area) api.setArea(e.area);
      else if (e.sound) api.play(e.sound, { ...e.opts, pos: rel(e.opts.pos) });
      else if (e.ev) {
        const p = e.p ? { ...e.p, pos: rel(e.p.pos) } : undefined;
        if (G.events) G.events.emit(e.ev, p); else live.handlers[e.ev](p, t);
      }
    }
    if (!testQueue.length) testQueue = null;
  }

  function updateMusic(t) {
    const g = G.game, d = g && g.director, z = G.zombies;
    if (musicPin !== null) { musicNow.intensity = musicPin; musicNow.lastQuarter = musicPin > 0.75; } else if (d && z) {
      const alive = Array.isArray(z.alive) ? z.alive.length : Number(z.alive) || 0;
      const r = musicIntensity(alive, 24, Math.max(0, (d.spawned || 0) - alive), d.total || 0);
      musicNow.intensity = r.intensity; musicNow.lastQuarter = r.lastQuarter;
    } else { musicNow.intensity = 0; musicNow.lastQuarter = false; }
    live.gr.music.update(t, musicOn, !g || g.state === 'playing', musicNow.intensity, musicNow.lastQuarter);
  }

  const music = {
    get intensity() { return musicNow.intensity; },
    set intensity(v) { musicPin = v === null || v === undefined ? null : Math.max(0, Math.min(1, Number(v) || 0)); },
    get enabled() { return musicOn; },
    set enabled(v) { musicOn = !!v; if (musicOn) { store.enqueue(); kick(); } },
  };

  const api = {
    get ready() { return !!live; },
    // Harness/debug view: context state and time, voices playing, buffers still to synthesise.
    stats() {
      return {
        state: live ? live.gr.ctx.state : 'locked', time: live ? live.gr.ctx.currentTime : 0,
        voices: live ? live.gr.activeVoices() : 0, pending: store.pending(), synthMs: Math.round(store.stats.totalMs),
        testRemaining: testQueue ? testQueue.length : 0, cap: voiceCapFor(G.quality), area,
        stolen: live ? live.gr.count.stolen : 0, dropped: live ? live.gr.count.dropped : 0, peak: live ? live.gr.count.peak : 0,
        mb: Math.round(store.stats.bytes / 1e5) / 10, music: musicOn,
      };
    },
    // The live AudioContext (null before the first gesture): harness and phone checks only.
    get context() { return live ? live.gr.ctx : null; },
    get master() { return volume; },
    set master(v) {
      volume = Math.max(0, Math.min(1, Number(v) || 0));
      if (live) live.gr.master.gain.setTargetAtTime(volume, live.gr.ctx.currentTime, 0.05);
    },
    setVolume(v) { api.master = v; },
    music,
    synth: store,
    unlock,
    setListener(cam) { camera = cam; },
    // Silent no-op before the first gesture or before the buffer exists; an unknown name warns once.
    play(name, opts = {}, delay = 0) {
      if (!known(name)) { warnOnce(name); return null; }
      if (!live) return null;
      try { return live.gr.play(name, opts, live.gr.ctx.currentTime + delay); } catch (e) { reportOnce(`play ${name}: ${e && e.message}`); return null; }
    },
    stop(handle, fade = 0.012) { if (live) try { live.gr.stop(handle, live.gr.ctx.currentTime, fade); } catch (e) { /* never throws */ } },
    // 'open', 'canopy', 'diner', 'kitchen', 'motelRoom', 'walkway', 'garage', 'scrapyard'
    setArea(a) {
      if (!AREAS[a]) return;
      area = a;
      if (live) try { live.gr.setArea(a, live.gr.ctx.currentTime); } catch (e) { /* ignore */ }
    },
    get area() { return area; },
    thunder(delay = 0) { return api.play('thunder', {}, delay); },
    update() {
      if (!live) return;
      try {
        const t = live.gr.ctx.currentTime;
        updateListener(); // the loop runs audio after player, so this is this frame's camera
        followArea();
        live.gr.loadIRs();
        live.gr.ambience.update(t);
        live.handlers.update(t);
        updateMusic(t);
        if (testQueue) runTestScript(t);
      } catch (e) { reportOnce(`update: ${e && e.message}`); }
    },
    // Render a scripted sequence through the real graph offline. Listener at the origin facing -Z.
    // script: [{t, ev, p} | {t, sound, opts} | {t, area} | {t, power}]. zombies: records the
    // per-frame update sees (idle voices, steps). music: an intensity (or fn of t) for the bed.
    async renderOffline({ seconds = 20, script = TEST_SCRIPT, ambience = true, seed = 7, cap, music: mus = null, zombies = null } = {}) {
      store.synthAll();
      const OAC = globalThis.OfflineAudioContext;
      const ctx = new OAC(2, Math.ceil(seconds * SR), SR);
      const orng = createRng(seed);
      // AudioBuffers belong to no context: offline renders share one set (memory across many renders)
      const gr = createGraph(ctx, store, orng, { autoThunder: false, voiceCap: () => cap ?? VOICE_CAP.desktop, cache: offlineCache });
      // Player standing at the origin, ears at 1.6 m, facing -Z (the Web Audio default orientation).
      gr.listener.pos = [0, 1.6, 0];
      if (ctx.listener.positionY) ctx.listener.positionY.value = 1.6; else ctx.listener.setPosition(0, 1.6, 0);
      if (ambience) gr.ambience.start(0, 0.01);
      const OG = { zombies: zombies ? { list: zombies } : null };
      const h = makeHandlers({
        gr, rng: orng, G: OG, world: createWorldState(),
        findRec: (id) => (zombies || []).find((z) => z.id === id) || null,
        occl: (p) => (p && p.occl) | 0, surfaceAt: (p, s) => s || 'asphalt',
      });
      const evs = [...script].sort((a, b) => a.t - b.t);
      const frames = zombies ? Math.ceil(seconds / 0.05) : 0;
      let k = 0;
      // events and the per-frame update in time order (update every 50 ms when zombies are given)
      for (let f = 0; f <= frames || k < evs.length; f++) {
        const tf = zombies ? f * 0.05 : Infinity;
        while (k < evs.length && evs[k].t <= tf) {
          const e = evs[k++];
          if (e.area) gr.setArea(e.area, e.t);
          else if (e.sound) gr.play(e.sound, e.opts || {}, e.t);
          else if (e.power) gr.ambience.setPower(true, e.t);
          else if (h[e.ev]) h[e.ev](e.p, e.t);
        }
        if (zombies && f <= frames) h.update(tf);
        if (!zombies && k >= evs.length) break;
      }
      if (mus !== null) for (let t = 0; t < seconds; t += 0.5) gr.music.update(t, true, true, typeof mus === 'function' ? mus(t) : mus, false);
      const buf = await ctx.startRendering();
      api.lastOffline = { peak: gr.count.peak, stolen: gr.count.stolen, dropped: gr.count.dropped, droppedTop: gr.count.droppedTop };
      return [buf.getChannelData(0), buf.getChannelData(1)];
    },
  };
  return api;
}

export const SOUND_NAMES = [...Object.keys(DEFS), ...Object.keys(ALIASES)];
export { DEFS, MIX, ALIASES, TEST_SCRIPT, EVENTS };
