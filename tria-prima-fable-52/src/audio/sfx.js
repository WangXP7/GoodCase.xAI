// Every one-shot in the game. A recipe schedules its sound on `out` starting at `t` and returns its
// length in seconds. Recipes are layered from noise, tones and struck resonators, and each trigger
// re-rolls its details so nothing repeats exactly.
//
// meta: wet   reverb send 0..1            ref   distance (m) at which a spatial sound is at full level
//       range beyond this it is not played bus   'sfx' | 'ui'
//       prio  0 expendable .. 2 never stolen     gap   least seconds between two triggers
//       k     level trim, set from the measurements of tools/audio-check.mjs
import { mtof } from './dsp.js';
import { chime, bigBell, chord, choirNote, anvil } from './instruments.js';
import { SFX_K } from './levels.js';

export const SFX = {};
function def(name, meta, fn) {
  SFX[name] = { wet: 0.2, ref: 3, range: 60, bus: 'sfx', prio: 1, gap: 0.03, ...meta, k: SFX_K[name] ?? 1, fn };
}
const P = (S, o, j = 0.05) => (o.pitch || 1) * S.jit(1, j);

// --- shared gestures ---------------------------------------------------------------------------
/** A shard of glass, two bottles touching. */
export function clink(S, out, t, f, g, d = 0.12, pan = 0) {
  S.modal(out, t, { parts: [[f, g, d], [f * S.range(1.4, 1.6), g * 0.5, d * 0.7], [f * S.range(2.2, 2.9), g * 0.25, d * 0.45]], a: 0.0006, pan });
}
/** Wood struck. */
function knock(S, out, t, f, g, d = 0.09, pan = 0) {
  S.modal(out, t, { parts: [[f, g, d], [f * 1.83, g * 0.45, d * 0.65], [f * 2.9, g * 0.2, d * 0.4]], a: 0.001, pan });
  S.nz(out, t, { k: 'pink', d: 0.02, a: 0.0008, f: f * 6, q: 0.7, g: g * 0.35, pan });
}
/** Stone on stone. */
function clack(S, out, t, f, g, d = 0.06, pan = 0) {
  S.modal(out, t, { parts: [[f, g, d], [f * 2.37, g * 0.55, d * 0.6], [f * 3.86, g * 0.3, d * 0.45], [f * 5.1, g * 0.15, d * 0.3]], a: 0.0005, pan });
  S.nz(out, t, { k: 'white', d: 0.012, a: 0.0004, ft: 'none', hp: 1800, g: g * 0.5, pan });
}
/** One bubble. */
export function blip(S, out, t, f0, f1, d, g, pan = 0) {
  S.tn(out, t, { f: f0, f1, d, a: 0.004, g, pan });
}
/** A gain stage that shivers between 1 - depth and 1: flame, paper, anything that is never steady. */
export function shiver(S, t, dur, depth = 0.5, rate = 24) {
  const g = S.gain(1 - depth);
  S.drift(g.gain, depth, rate, t, 'pos', dur + 0.1);
  return g;
}
export function flutter(S, out, t, dur, depth = 0.5, rate = 24) {
  const g = shiver(S, t, dur, depth, rate);
  g.connect(out);
  return g;
}
/** Stick-slip: timber, leather, a briar forcing its way up. */
export function creak(S, out, t, f0, f1, d, g, res = 900) {
  const osc = S.osc('sawtooth', f0, t, d + 0.03);
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(f1, t + d);
  const rough = shiver(S, t, d, 0.85, S.range(26, 40));
  const env = S.gain(0);
  S.env(env.gain, t, 0, [[Math.min(0.03, d * 0.2), g], [d * 0.55, g * 0.8], [d * 0.42, 0, 'e']]);
  const mix = S.gain(2.4);
  osc.connect(rough);
  for (const [hz, q] of [[res, 6], [res * 1.9, 7], [res * 3.1, 6]]) S.chain(rough, S.bq('bandpass', hz, q), mix);
  S.chain(mix, env, out);
}
/** The lake-ice sound: a chirp that falls two octaves in a blink. */
function pew(S, out, t, f0, f1, d, g) {
  S.tn(out, t, { f: f0, f1, d, a: 0.0015, g });
  S.tn(out, t + 0.004, { f: f0 * 1.31, f1: f1 * 1.2, d: d * 0.8, a: 0.0015, g: g * 0.4 });
}
const semis = (o) => Math.round(12 * Math.log2(o.pitch || 1));

// --- interface ---------------------------------------------------------------------------------
def('ui_hover', { bus: 'ui', wet: 0, prio: 0, gap: 0.04 }, (S, out, t, o) => {
  S.nz(out, t, { k: 'pink', d: 0.03, a: 0.002, f: 2600, q: 2, g: 0.12 });
  S.tn(out, t, { f: 1900 * P(S, o, 0.02), d: 0.04, a: 0.003, g: 0.03 });
  return 0.06;
});
def('ui_click', { bus: 'ui', wet: 0.05, gap: 0.04 }, (S, out, t, o) => {
  const p = P(S, o, 0.03);
  knock(S, out, t, 520 * p, 0.3, 0.05);
  clack(S, out, t, 1400 * p, 0.08, 0.03);
  return 0.1;
});
def('ui_open', { bus: 'ui', wet: 0.1 }, (S, out, t) => {
  S.nz(out, t, { k: 'pink', d: 0.28, a: 0.05, f: 500, f1: 1800, q: 0.8, g: 0.3 });
  S.nz(out, t, { k: 'white', d: 0.2, a: 0.06, ft: 'none', hp: 2500, g: 0.08 });
  S.tn(out, t, { f: 110, f1: 70, d: 0.12, a: 0.004, g: 0.25 });
  return 0.35;
});
def('ui_close', { bus: 'ui', wet: 0.1 }, (S, out, t) => {
  S.nz(out, t, { k: 'pink', d: 0.22, a: 0.02, f: 1500, f1: 400, q: 0.8, g: 0.28 });
  S.tn(out, t + 0.12, { f: 95, f1: 60, d: 0.14, a: 0.003, g: 0.4 });
  S.nz(out, t + 0.12, { k: 'brown', d: 0.1, a: 0.002, f: 300, ft: 'lowpass', g: 0.3 });
  return 0.35;
});
def('page', { bus: 'ui', wet: 0.08, gap: 0.08 }, (S, out, t) => {
  const fl = flutter(S, out, t, 0.3, 0.6, 46);
  S.nz(fl, t, { k: 'white', d: 0.26, a: 0.04, f: 3000, f1: 5200, q: 0.8, g: 0.24 });
  S.nz(fl, t, { k: 'pink', d: 0.2, a: 0.05, f: 900, q: 0.6, g: 0.1 });
  S.nz(out, t + 0.2, { k: 'white', d: 0.03, a: 0.002, ft: 'none', hp: 4000, g: 0.12 });
  return 0.34;
});
def('toast', { bus: 'ui', wet: 0.35, gap: 0.15 }, (S, out, t, o) => {
  const p = o.pitch || 1;
  S.modal(out, t, { parts: [[587.3 * p, 0.12, 0.8], [1174.7 * p, 0.04, 0.4], [880 * p, 0.05, 0.55]], a: 0.004 });
  return 0.85;
});
def('discover', { bus: 'ui', wet: 0.5, prio: 2 }, (S, out, t, o) => {
  const s = semis(o);
  [69, 74, 77].forEach((m, i) => chime(S, out, t + i * 0.17, m + s, 0.5 + i * 0.1, { dk: 2.6 }));
  S.nz(out, t, { k: 'white', d: 0.9, a: 0.3, f: 6000, q: 2, g: 0.03 });
  return 3.2;
});
def('quest', { bus: 'ui', wet: 0.6, prio: 2 }, (S, out, t) => {
  // a hand bell, twice, over a low bare fifth: something has been written in the journal
  chime(S, out, t, 74, 0.7, { dk: 3.2 });
  chime(S, out, t + 0.42, 69, 0.55, { dk: 3.6 });
  chord(S, out, t + 0.1, [38, 45], 1.0, 0.45, { a: 0.5, r: 1.8, voices: false, bright: 0.3 });
  return 4.8;
});

// --- gathering, carrying -----------------------------------------------------------------------
def('pickup', { wet: 0.1 }, (S, out, t, o) => {
  const p = P(S, o, 0.1);
  S.nz(out, t, { k: 'white', d: 0.035, a: 0.001, f: 2400 * p, q: 1.5, g: 0.45 });
  S.nz(out, t + 0.01, { k: 'pink', d: 0.14, a: 0.02, f: 900, f1: 1600, q: 0.8, g: 0.2 });
  S.tn(out, t, { f: 320 * p, f1: 520 * p, d: 0.07, a: 0.003, g: 0.12 });
  return 0.2;
});
def('pickup_rare', { wet: 0.35 }, (S, out, t, o) => {
  const p = P(S, o, 0.06);
  clack(S, out, t, 1100 * p, 0.3, 0.05);
  [2100, 3300, 5200].forEach((f, i) => clink(S, out, t + 0.02 + i * 0.035, f * p, 0.12 - i * 0.025, 0.9 - i * 0.2));
  return 1.1;
});
def('grab', { wet: 0.05, prio: 0 }, (S, out, t, o) => {
  S.nz(out, t, { k: 'pink', d: 0.08, a: 0.012, f: 1100, q: 0.8, g: 0.14 });
  knock(S, out, t + 0.01, 300 * P(S, o, 0.1), 0.08, 0.04);
  return 0.12;
});
def('impact_soft', { wet: 0.15, prio: 0, gap: 0.05 }, (S, out, t, o) => {
  knock(S, out, t, 150 * P(S, o, 0.18), 0.6, 0.11);
  S.nz(out, t, { k: 'brown', d: 0.09, a: 0.002, f: 700, ft: 'lowpass', g: 0.45 });
  return 0.2;
});
def('impact_hard', { wet: 0.2, prio: 0, gap: 0.05 }, (S, out, t, o) => {
  const p = P(S, o, 0.2);
  clack(S, out, t, 640 * p, 0.55, 0.07);
  S.tn(out, t, { f: 180 * p, f1: 120 * p, d: 0.05, a: 0.002, g: 0.2 });
  return 0.15;
});

// --- potions -----------------------------------------------------------------------------------
def('throw', { wet: 0.05, prio: 0 }, (S, out, t, o) => {
  const p = P(S, o, 0.08);
  S.nz(out, t, { k: 'pink', d: 0.32, a: 0.07, f: 450 * p, f1: 1500 * p, tf: 0.16, q: 1.2, g: 0.35 });
  S.nz(out, t, { k: 'white', d: 0.1, a: 0.03, ft: 'none', hp: 3000, g: 0.05 });
  return 0.35;
});
def('shatter', { wet: 0.3, ref: 4, range: 80 }, (S, out, t, o) => {
  const p = P(S, o, 0.08);
  S.nz(out, t, { k: 'white', d: 0.04, a: 0.0005, ft: 'none', hp: 2500, g: 0.9 });
  S.nz(out, t, { k: 'white', d: 0.22, a: 0.002, f: 5200 * p, q: 0.7, g: 0.5 });
  S.nz(out, t, { k: 'pink', d: 0.25, a: 0.004, f: 900, f1: 400, q: 0.9, g: 0.2 });
  // the large shards one by one, the dust of small ones as a texture (a flask breaks on the busiest
  // frame the game has: this is the part of the sound that must stay cheap to build)
  S.scatter(S.int(9, 12), t + 0.004, 0.32, (tt, i, u) => clink(S, out, tt, S.range(2200, 9500) * p, 0.27 - u * 0.17, S.range(0.04, 0.16), S.range(-0.5, 0.5)), 1.7);
  S.tx(out, t + 0.004, 'grit', { d: 0.34, a: 0.002, hp: 3200, g: 0.3, rate: S.range(0.9, 1.3) });
  S.scatter(S.int(2, 4), t + 0.25, 0.4, (tt) => clink(S, out, tt, S.range(3000, 7000) * p, S.range(0.05, 0.11), S.range(0.08, 0.2), S.range(-0.6, 0.6)));
  return 0.95;
});
def('ember_burst', { wet: 0.3, ref: 5, range: 110, prio: 2 }, (S, out, t, o) => {
  const p = P(S, o, 0.05);
  S.tn(out, t, { f: 92 * p, f1: 44, d: 0.45, a: 0.004, g: 0.8 });
  S.nz(out, t, { k: 'pink', d: 0.95, a: 0.02, f: 2500, f1: 300, ft: 'lowpass', g: 0.7 });
  S.nz(out, t, { k: 'brown', d: 0.6, a: 0.01, f: 500, ft: 'lowpass', g: 0.5 });
  S.tx(flutter(S, out, t, 1.4, 0.4, 18), t + 0.05, 'crackle', { d: 1.3, a: 0.05, g: 0.5, hp: 900 });
  S.tx(out, t + 0.05, 'crackleDense', { d: 0.8, a: 0.03, g: 0.25, hp: 1800 });
  return 1.5;
});
def('rime_burst', { wet: 0.45, ref: 5, range: 110, prio: 2 }, (S, out, t, o) => {
  const p = P(S, o, 0.05);
  S.nz(out, t, { k: 'brown', d: 0.25, a: 0.003, f: 300, ft: 'lowpass', g: 0.6 });
  S.nz(out, t, { k: 'white', d: 0.7, a: 0.12, ft: 'none', hp: 5000, g: 0.16 });
  S.tx(out, t, 'grit', { d: 0.9, a: 0.02, g: 0.4, hp: 3500, rate: 1.3 });
  S.tx(out, t, 'crackle', { d: 0.9, a: 0.01, g: 0.35, hp: 2500, rate: 1.6 });
  // crystals closing over: pings that start fast and thin out, falling in pitch
  S.scatter(S.int(9, 13), t + 0.02, 0.85, (tt, i, u) => clink(S, out, tt, (5200 - u * 2800) * p * S.jit(1, 0.12), 0.11 - u * 0.05, 0.25 + u * 0.3, S.range(-0.5, 0.5)), 1.6);
  pew(S, out, t + 0.06, 2600 * p, 420, 0.16, 0.08);
  return 1.5;
});
def('verdance_burst', { wet: 0.3, ref: 5, range: 100, prio: 2 }, (S, out, t, o) => {
  const p = P(S, o, 0.06);
  S.nz(out, t, { k: 'brown', d: 0.2, a: 0.004, f: 420, ft: 'lowpass', g: 0.7 });
  S.nz(out, t, { k: 'pink', d: 0.32, a: 0.015, f: 800, f1: 1500, q: 0.8, g: 0.35 });
  S.scatter(5, t + 0.08, 0.7, (tt, i, u) => creak(S, out, tt, S.range(70, 110) * p, S.range(150, 230) * p, S.range(0.14, 0.26), 0.14, S.range(600, 1100)));
  const fl = flutter(S, out, t, 1.1, 0.7, 28);
  S.nz(fl, t + 0.1, { k: 'pink', d: 0.95, a: 0.25, f: 2300, q: 0.6, g: 0.16 });
  S.scatter(4, t + 0.2, 0.6, (tt) => blip(S, out, tt, S.range(420, 700), S.range(800, 1100), 0.04, 0.08));
  return 1.3;
});
def('fulminate_burst', { wet: 0.5, ref: 9, range: 320, prio: 2 }, (S, out, t, o) => {
  const p = P(S, o, 0.04);
  // the crack, through a hard edge
  const bite = S.shaper('drive');
  bite.connect(out);
  S.nz(bite, t, { k: 'white', d: 0.055, a: 0.0003, ft: 'none', g: 1.0 });
  S.tn(out, t, { f: 120 * p, f1: 28, tf: 0.5, d: 1.2, a: 0.002, g: 1.0 });
  S.tn(out, t, { f: 60 * p, f1: 38, d: 1.5, a: 0.004, g: 0.5 });
  // the body feeds two slaps coming back off the hills
  const body = S.gain(1);
  body.connect(out);
  S.nz(body, t, { k: 'brown', d: 1.8, a: 0.004, f: 1400, f1: 140, ft: 'lowpass', g: 0.9 });
  S.nz(body, t, { k: 'pink', d: 0.5, a: 0.003, f: 350, q: 0.8, g: 0.6 });
  S.chain(body, S.delay(0.27), S.bq('lowpass', 900), S.gain(0.28), out);
  S.chain(body, S.delay(0.61), S.bq('lowpass', 600), S.gain(0.18), out);
  S.tx(out, t + 0.12, 'crackle', { d: 1.7, a: 0.18, g: 0.35, hp: 1200 });
  S.nz(out, t + 0.1, { k: 'brown', d: 3.6, a: 0.15, f: 180, ft: 'lowpass', g: 0.45 });
  return 4.2;
});
def('levity_burst', { wet: 0.55, ref: 5, range: 100, prio: 2 }, (S, out, t, o) => {
  const p = P(S, o, 0.04);
  [330, 440, 554, 660, 880, 1109].forEach((f, i) => {
    S.tn(out, t + i * 0.05, { f: f * p, f1: f * p * 2, tf: 1.25, d: 1.5, a: 0.35, g: 0.07, pan: (i % 2 ? 1 : -1) * 0.4 });
  });
  S.nz(out, t, { k: 'white', d: 1.4, a: 0.5, f: 3000, f1: 8000, q: 1.2, g: 0.08 });
  S.tn(out, t, { f: 58, f1: 92, d: 0.9, a: 0.25, g: 0.3 });
  S.scatter(6, t + 0.3, 1.0, (tt, i, u) => clink(S, out, tt, (3000 + u * 4000) * p, 0.03, 0.4, S.range(-0.6, 0.6)));
  return 1.9;
});
def('spire_rise', { wet: 0.35, ref: 5, range: 110, prio: 2 }, (S, out, t, o) => {
  const p = P(S, o, 0.05);
  S.nz(out, t, { k: 'brown', d: 1.7, a: 0.5, h: 0.6, f: 150, ft: 'lowpass', g: 0.8 });
  S.tx(out, t, 'grit', { d: 1.6, a: 0.7, h: 0.5, g: 0.5, f: 2400 * p, q: 0.5 });
  S.tx(out, t, 'crackle', { d: 1.6, a: 0.5, h: 0.6, g: 0.4, hp: 1500, rate: 1.4 });
  S.nz(out, t, { k: 'pink', d: 1.5, a: 0.6, h: 0.5, f: 210 * p, f1: 520 * p, q: 14, g: 0.9 });
  S.scatter(7, t + 0.2, 1.3, (tt, i, u) => clink(S, out, tt, S.range(1800, 4200) * p, 0.05, 0.2));
  clack(S, out, t + 1.62, 240 * p, 0.5, 0.14);
  S.tn(out, t + 1.62, { f: 80, f1: 50, d: 0.25, a: 0.003, g: 0.4 });
  return 2.0;
});
def('spire_crumble', { wet: 0.35, ref: 5, range: 100 }, (S, out, t, o) => {
  const p = P(S, o, 0.06);
  S.scatter(11, t, 0.9, (tt, i, u) => clack(S, out, tt, (900 - u * 500) * p * S.jit(1, 0.2), 0.3 - u * 0.15, 0.06, S.range(-0.4, 0.4)), 1.3);
  S.tx(out, t, 'grit', { d: 1.5, a: 0.05, g: 0.5, f: 2200, q: 0.5 });
  S.nz(out, t + 0.5, { k: 'brown', d: 0.5, a: 0.01, f: 320, ft: 'lowpass', g: 0.6 });
  S.tn(out, t + 0.5, { f: 75, f1: 42, d: 0.3, a: 0.004, g: 0.4 });
  S.nz(out, t + 0.3, { k: 'pink', d: 1.4, a: 0.3, f: 3200, q: 0.5, g: 0.07 });
  return 1.8;
});

// --- the body ----------------------------------------------------------------------------------
def('drink', { wet: 0.05 }, (S, out, t, o) => {
  const p = P(S, o, 0.05);
  for (let i = 0; i < 3; i++) {
    const tt = t + i * 0.19;
    S.tn(out, tt, { f: 172 * p, f1: (i % 2 ? 128 : 236) * p, d: 0.11, a: 0.012, g: 0.4 });
    S.nz(out, tt, { k: 'pink', d: 0.08, a: 0.01, f: 500, q: 2, g: 0.06 });
  }
  S.nz(out, t + 0.62, { k: 'pink', d: 0.35, a: 0.08, f: 1300, q: 0.8, g: 0.07 });
  return 1.0;
});
def('heal', { wet: 0.6 }, (S, out, t) => {
  chord(S, out, t, [57, 64, 69], 1.0, 0.5, { a: 0.5, r: 1.6 });
  S.scatter(6, t + 0.2, 1.0, (tt) => clink(S, out, tt, S.range(3000, 6000), 0.03, 0.5, S.range(-0.5, 0.5)));
  return 3.6;
});
def('hurt', { wet: 0.15, gap: 0.2, prio: 2 }, (S, out, t, o) => {
  const p = P(S, o, 0.06);
  S.tn(out, t, { f: 130 * p, f1: 55, d: 0.16, a: 0.002, g: 0.7 });
  S.nz(out, t, { k: 'pink', d: 0.12, a: 0.002, f: 650, q: 1, g: 0.5 });
  S.tn(out, t, { w: 'sawtooth', f: 220 * p, d: 0.28, a: 0.005, g: 0.12, lp: 1200 });
  S.tn(out, t, { w: 'sawtooth', f: 233 * p, d: 0.28, a: 0.005, g: 0.12, lp: 1200 });
  return 0.35;
});
def('death', { wet: 0.7, prio: 2 }, (S, out, t) => {
  S.tn(out, t, { w: 'sawtooth', f: 110, f1: 31, d: 3.2, a: 0.3, g: 0.3, lp: 900, lp1: 120, det: -9 });
  S.tn(out, t, { w: 'sawtooth', f: 110, f1: 31, d: 3.2, a: 0.3, g: 0.3, lp: 900, lp1: 120, det: 10 });
  S.nz(out, t, { k: 'brown', d: 3.5, a: 0.8, f: 400, f1: 80, ft: 'lowpass', g: 0.5 });
  bigBell(S, out, t + 0.15, 73.42, 0.7, 5);
  choirNote(S, out, t + 0.1, 50, 1.6, 0.3, { a: 0.6, r: 2.4, v0: 'oh', v1: 'oo' });
  choirNote(S, out, t + 0.1, 51, 1.6, 0.25, { a: 0.6, r: 2.4, v0: 'oh', v1: 'oo' });
  return 6.5;
});
def('respawn', { wet: 0.6, prio: 2 }, (S, out, t) => {
  S.nz(out, t, { k: 'pink', d: 1.8, a: 1.2, f: 300, f1: 1800, tf: 1.4, q: 0.8, g: 0.3 });
  chord(S, out, t + 0.3, [50, 57], 1.2, 0.3, { a: 0.8, r: 2.0 });
  chime(S, out, t + 1.2, 69, 0.5, { dk: 3.5 });
  return 5.0;
});
def('jump', { wet: 0.03, prio: 0 }, (S, out, t) => {
  S.nz(out, t, { k: 'pink', d: 0.13, a: 0.025, f: 1200, q: 0.9, g: 0.14 });
  S.tn(out, t, { f: 90, f1: 70, d: 0.07, a: 0.004, g: 0.12 });
  return 0.15;
});
def('land', { wet: 0.08, gap: 0.1 }, (S, out, t, o) => {
  const p = P(S, o, 0.06);
  S.tn(out, t, { f: 88 * p, f1: 48, d: 0.14, a: 0.002, g: 0.6 });
  S.nz(out, t, { k: 'brown', d: 0.12, a: 0.002, f: 520, ft: 'lowpass', g: 0.55 });
  S.nz(out, t, { k: 'pink', d: 0.07, a: 0.004, f: 1500, q: 0.8, g: 0.1 });
  // the bottles on the belt
  S.scatter(S.int(2, 3), t + 0.02, 0.08, (tt) => clink(S, out, tt, S.range(2500, 4200), S.range(0.025, 0.04), 0.08));
  return 0.3;
});

// --- water, the cauldron -----------------------------------------------------------------------
def('splash', { wet: 0.25, ref: 4, range: 80 }, (S, out, t, o) => {
  const p = P(S, o, 0.08);
  S.nz(out, t, { k: 'pink', d: 0.5, a: 0.012, f: 600 * p, f1: 2200 * p, tf: 0.1, q: 0.7, g: 0.6 });
  S.nz(out, t, { k: 'brown', d: 0.2, a: 0.004, f: 400, ft: 'lowpass', g: 0.5 });
  S.nz(out, t + 0.05, { k: 'white', d: 0.6, a: 0.08, ft: 'none', hp: 3200, g: 0.1 });
  S.scatter(S.int(6, 10), t + 0.03, 0.35, (tt) => blip(S, out, tt, S.range(300, 900) * p, S.range(500, 1500) * p, S.range(0.03, 0.07), S.range(0.06, 0.16), S.range(-0.4, 0.4)));
  S.tx(out, t + 0.3, 'drops', { d: 0.8, a: 0.05, g: 0.12, rate: 0.8 });
  return 1.15;
});
def('drop_in', { wet: 0.15 }, (S, out, t, o) => {
  const p = P(S, o, 0.1);
  blip(S, out, t, 250 * p, 520 * p, 0.09, 0.45);
  S.nz(out, t, { k: 'pink', d: 0.16, a: 0.004, f: 1100, f1: 500, q: 0.9, g: 0.22 });
  S.scatter(3, t + 0.08, 0.22, (tt) => blip(S, out, tt, S.range(400, 900), S.range(600, 1300), 0.05, 0.1));
  S.modal(out, t, { parts: [[180, 0.05, 0.25], [410, 0.03, 0.2]], a: 0.002 });
  return 0.45;
});
def('bellows', { wet: 0.1, gap: 0.2 }, (S, out, t, o) => {
  const p = P(S, o, 0.05);
  S.nz(out, t, { k: 'pink', d: 0.85, a: 0.22, h: 0.2, f: 420 * p, f1: 820 * p, tf: 0.3, q: 0.7, g: 0.4 });
  S.nz(out, t, { k: 'white', d: 0.7, a: 0.25, ft: 'none', hp: 2400, g: 0.06 });
  creak(S, out, t, 70 * p, 105 * p, 0.3, 0.1, 800);
  S.nz(out, t + 0.2, { k: 'brown', d: 0.9, a: 0.35, f: 600, ft: 'lowpass', g: 0.3 });
  return 1.15;
});
def('bottle_fill', { wet: 0.1 }, (S, out, t, o) => {
  const p = P(S, o, 0.05);
  // the note of a filling bottle climbs as the air in it shrinks
  S.nz(out, t, { k: 'pink', d: 1.15, a: 0.06, h: 0.9, f: 420 * p, f1: 1900 * p, tf: 1.05, q: 5, g: 0.5 });
  S.tx(out, t, 'gurgle', { d: 1.1, a: 0.05, h: 0.9, g: 0.25, f: 900, q: 0.7 });
  clink(S, out, t + 1.15, 3200 * p, 0.06, 0.15);
  return 1.4;
});
def('cork', { wet: 0.08 }, (S, out, t, o) => {
  const p = P(S, o, 0.06);
  S.nz(out, t, { k: 'white', d: 0.09, a: 0.01, f: 1600 * p, f1: 2700 * p, q: 18, g: 0.5 });
  knock(S, out, t + 0.09, 640 * p, 0.4, 0.05);
  S.tn(out, t + 0.09, { f: 300 * p, f1: 180 * p, d: 0.05, a: 0.002, g: 0.2 });
  return 0.2;
});
def('brew_ready', { wet: 0.6, prio: 2 }, (S, out, t) => {
  [62, 69, 74].forEach((m, i) => chime(S, out, t + i * 0.07, m, i ? 0.5 : 0.7, { dk: 4 }));
  // a small bell: the deep one is kept for the Primes and the Great Work
  bigBell(S, out, t, 146.83, 0.5, 3.5);
  S.nz(out, t, { k: 'white', d: 1.6, a: 0.5, f: 5000, q: 1.5, g: 0.04 });
  chord(S, out, t + 0.05, [50, 57, 62], 1.0, 0.25, { a: 0.6, r: 2.2 });
  return 5.5;
});
def('brew_fail', { wet: 0.2 }, (S, out, t) => {
  S.nz(out, t, { k: 'white', d: 0.9, a: 0.01, f: 5000, f1: 700, ft: 'highpass', g: 0.3 });
  S.tx(out, t, 'crackleDense', { d: 0.8, a: 0.02, g: 0.25, hp: 1500 });
  S.tn(out, t, { w: 'triangle', f: 233, f1: 196, d: 0.5, a: 0.01, g: 0.12 });
  S.tn(out, t, { w: 'triangle', f: 247, f1: 185, d: 0.5, a: 0.01, g: 0.1 });
  return 1.0;
});

// --- fire --------------------------------------------------------------------------------------
def('ignite', { wet: 0.2, ref: 4, range: 80 }, (S, out, t, o) => {
  const p = P(S, o, 0.06);
  S.nz(out, t, { k: 'pink', d: 0.7, a: 0.05, f: 250, f1: 3200, tf: 0.16, ft: 'lowpass', g: 0.55 });
  S.tn(out, t, { f: 95 * p, f1: 55, d: 0.3, a: 0.01, g: 0.4 });
  S.tx(out, t + 0.1, 'crackle', { d: 1.0, a: 0.1, g: 0.3, hp: 900 });
  return 1.2;
});
def('extinguish', { wet: 0.2, ref: 4, range: 70 }, (S, out, t) => {
  S.nz(out, t, { k: 'white', d: 1.0, a: 0.01, f: 2800, ft: 'highpass', g: 0.35 });
  S.nz(out, t, { k: 'pink', d: 0.18, a: 0.01, f: 600, q: 1, g: 0.3 });
  S.tx(out, t, 'crackleDense', { d: 0.6, a: 0.01, g: 0.12, hp: 2500 });
  return 1.1;
});
def('briar_burn', { wet: 0.25, ref: 7, range: 130, prio: 2 }, (S, out, t, o) => {
  S.nz(out, t, { k: 'brown', d: 3.2, a: 0.5, h: 1.4, f: 600, ft: 'lowpass', g: 0.6 });
  const fl = flutter(S, out, t, 3.2, 0.45, 30);
  S.nz(fl, t, { k: 'pink', d: 3.0, a: 0.6, h: 1.2, f: 700, q: 0.6, g: 0.35 });
  S.tx(out, t, 'crackle', { d: 3.2, a: 0.2, h: 1.8, g: 0.7, hp: 700 });
  S.tx(out, t, 'crackleDense', { d: 2.8, a: 0.4, h: 1.2, g: 0.35, hp: 1500 });
  S.scatter(9, t + 0.2, 2.5, (tt) => {
    S.nz(out, tt, { k: 'white', d: 0.03, a: 0.0006, f: S.range(1800, 3200), q: 2, g: 0.4 });
    S.tn(out, tt, { f: S.range(350, 480), f1: 200, d: 0.03, a: 0.001, g: 0.2 });
  });
  return 3.4;
});
def('steam', { wet: 0.3, ref: 5, range: 90 }, (S, out, t) => {
  S.nz(out, t, { k: 'white', d: 2.0, a: 0.03, f: 2200, ft: 'highpass', g: 0.45 });
  const fl = flutter(S, out, t, 1.7, 0.35, 24);
  S.nz(fl, t, { k: 'white', d: 1.6, a: 0.02, f: 4800, q: 1.2, g: 0.3 });
  S.tx(out, t, 'crackleDense', { d: 1.2, a: 0.02, g: 0.3, hp: 1800 });
  S.nz(out, t, { k: 'brown', d: 0.8, a: 0.02, f: 240, ft: 'lowpass', g: 0.3 });
  return 2.1;
});

// --- growing, breaking, freezing ---------------------------------------------------------------
def('vine_grow', { wet: 0.3, ref: 6, range: 100, prio: 2 }, (S, out, t, o) => {
  const p = P(S, o, 0.05);
  S.scatter(6, t, 2.1, (tt, i, u) => creak(S, out, tt, S.range(60, 100) * p * (1 + u * 0.6), S.range(120, 210) * p * (1 + u * 0.6), S.range(0.25, 0.5), 0.12, S.range(500, 1100)));
  const fl = flutter(S, out, t, 2.5, 0.7, 26);
  S.nz(fl, t, { k: 'pink', d: 2.4, a: 0.6, h: 1.0, f: 2200, q: 0.6, g: 0.12 });
  S.nz(out, t, { k: 'brown', d: 2.2, a: 0.5, f: 160, ft: 'lowpass', g: 0.3 });
  S.scatter(4, t + 0.6, 1.6, (tt) => blip(S, out, tt, S.range(480, 620), S.range(800, 1000), 0.04, 0.08));
  S.tn(out, t, { w: 'triangle', f: 110 * p, f1: 220 * p, d: 2.4, a: 1.0, g: 0.05, lp: 600 });
  return 2.8;
});
def('rock_crack', { wet: 0.35, ref: 6, range: 110 }, (S, out, t, o) => {
  const p = P(S, o, 0.08);
  S.nz(out, t, { k: 'white', d: 0.05, a: 0.0004, ft: 'none', g: 0.9 });
  clack(S, out, t, 380 * p, 0.5, 0.1);
  clack(S, out, t + 0.004, 900 * p, 0.3, 0.06);
  S.nz(out, t, { k: 'brown', d: 0.25, a: 0.002, f: 400, ft: 'lowpass', g: 0.5 });
  S.scatter(8, t + 0.05, 0.6, (tt) => clack(S, out, tt, S.range(500, 1800) * p, S.range(0.06, 0.15), 0.03, S.range(-0.5, 0.5)), 1.5);
  return 0.8;
});
def('rock_break', { wet: 0.4, ref: 9, range: 160, prio: 2 }, (S, out, t, o) => {
  const p = P(S, o, 0.05);
  S.nz(out, t, { k: 'white', d: 0.04, a: 0.0004, ft: 'none', g: 0.7 });
  S.tn(out, t, { f: 80 * p, f1: 36, d: 0.6, a: 0.003, g: 0.8 });
  S.nz(out, t, { k: 'brown', d: 1.4, a: 0.004, f: 700, f1: 150, ft: 'lowpass', g: 0.8 });
  S.scatter(13, t + 0.03, 1.9, (tt, i, u) => clack(S, out, tt, S.range(160, 700) * p, 0.35 * (1 - u) + 0.05, S.range(0.05, 0.12), S.range(-0.6, 0.6)), 1.4);
  S.tx(out, t, 'grit', { d: 2.2, a: 0.15, h: 0.5, g: 0.25, f: 2500, q: 0.5 });
  S.nz(out, t, { k: 'pink', d: 2.4, a: 0.4, f: 3500, q: 0.5, g: 0.06 });
  return 2.8;
});
def('ice_form', { wet: 0.45, ref: 6, range: 110, prio: 2 }, (S, out, t, o) => {
  const p = P(S, o, 0.05);
  [0, 0.3, 0.7].forEach((dt) => {
    const f = S.range(500, 900) * p;
    S.nz(out, t + dt, { k: 'white', d: 0.5, a: 0.05, f, f1: f * 2.5, q: 22, g: 0.5 });
  });
  S.tx(out, t, 'grit', { d: 1.4, a: 0.2, h: 0.5, g: 0.3, hp: 3500 });
  S.tx(out, t, 'crackle', { d: 1.5, a: 0.1, g: 0.3, hp: 2500, rate: 1.5 });
  pew(S, out, t + 0.5, 2400 * p, 420, 0.16, 0.12);
  pew(S, out, t + 1.1, 1900 * p, 340, 0.2, 0.1);
  S.tn(out, t + 0.2, { f: 85, f1: 52, d: 0.9, a: 0.02, g: 0.3 });
  S.scatter(5, t + 0.2, 1.3, (tt) => clink(S, out, tt, S.range(2500, 5000) * p, 0.05, 0.3, S.range(-0.5, 0.5)));
  return 2.0;
});
def('ice_crack', { wet: 0.5, ref: 6, range: 120 }, (S, out, t, o) => {
  const p = P(S, o, 0.08);
  S.nz(out, t, { k: 'white', d: 0.035, a: 0.0004, ft: 'none', g: 0.8 });
  pew(S, out, t, 3000 * p, 380, 0.14, 0.2);
  pew(S, out, t + 0.03, 2200 * p, 300, 0.2, 0.14);
  pew(S, out, t + 0.11, 1700 * p, 260, 0.25, 0.1);
  S.nz(out, t, { k: 'brown', d: 0.6, a: 0.005, f: 300, ft: 'lowpass', g: 0.5 });
  S.nz(out, t + 0.15, { k: 'pink', d: 0.3, a: 0.05, f: 900, f1: 500, q: 0.8, g: 0.12 });
  S.scatter(4, t + 0.05, 0.4, (tt) => clink(S, out, tt, S.range(2800, 5500) * p, 0.06, 0.15, S.range(-0.5, 0.5)));
  return 0.9;
});
def('lid_slide', { wet: 0.4, ref: 5, range: 90 }, (S, out, t, o) => {
  const p = P(S, o, 0.05);
  const slow = flutter(S, out, t, 1.9, 0.7, 34),
    fast = flutter(S, out, t, 1.9, 0.8, 40);
  S.nz(slow, t, { k: 'brown', d: 1.8, a: 0.12, h: 1.3, f: 320 * p, q: 0.8, g: 0.9 });
  S.nz(fast, t, { k: 'pink', d: 1.7, a: 0.15, h: 1.2, f: 900 * p, q: 2, g: 0.3 });
  S.nz(slow, t, { k: 'white', d: 1.7, a: 0.2, h: 1.1, f: 560 * p, f1: 610 * p, q: 30, g: 0.6 });
  S.tx(out, t, 'grit', { d: 1.7, a: 0.1, h: 1.2, g: 0.2, f: 1800, q: 0.6 });
  knock(S, out, t + 1.8, 110 * p, 0.5, 0.2);
  S.nz(out, t + 1.8, { k: 'brown', d: 0.15, a: 0.003, f: 300, ft: 'lowpass', g: 0.5 });
  return 2.2;
});

// --- the Gloom ---------------------------------------------------------------------------------
def('shade_hit', { wet: 0.5, ref: 6, range: 100 }, (S, out, t, o) => {
  const p = P(S, o, 0.08);
  S.fm(out, t, { f: 720 * p, f1: 290 * p, ratio: 1.41, idx: 4, idx1: 1, d: 0.5, a: 0.004, g: 0.3 });
  S.fm(out, t, { f: 1080 * p, f1: 410 * p, ratio: 2.33, idx: 3, idx1: 0.6, d: 0.38, a: 0.004, g: 0.16 });
  S.nz(out, t, { k: 'pink', d: 0.45, a: 0.004, f: 1800, f1: 700, q: 2, g: 0.35 });
  S.nz(out, t + 0.3, { k: 'white', d: 0.28, a: 0.22, f: 400, f1: 2400, tf: 0.25, q: 3, g: 0.2, c: 'l' });
  return 0.7;
});
def('shade_die', { wet: 0.7, ref: 8, range: 140, prio: 2 }, (S, out, t, o) => {
  const p = P(S, o, 0.05);
  S.fm(out, t, { f: 520 * p, f1: 110 * p, ratio: 1.5, idx: 3, idx1: 0.3, d: 2.4, a: 0.02, g: 0.3 });
  S.fm(out, t, { f: 780 * p, f1: 160 * p, ratio: 1.33, idx: 2.5, idx1: 0.3, d: 2.1, a: 0.03, g: 0.18 });
  S.scatter(8, t + 0.1, 2.1, (tt) => {
    const f = S.range(900, 2600);
    S.nz(out, tt, { k: 'pink', d: S.range(0.4, 0.8), a: 0.15, f, f1: f * S.range(0.6, 1.5), q: 4, g: 0.12, pan: S.range(-0.8, 0.8) });
  });
  S.tn(out, t, { f: 70, f1: 30, d: 1.4, a: 0.01, g: 0.5 });
  S.nz(out, t, { k: 'white', d: 2.6, a: 0.9, f: 3000, ft: 'highpass', g: 0.1 });
  return 3.2;
});
def('gloom_lift', { wet: 0.8, prio: 2 }, (S, out, t) => {
  S.nz(out, t, { k: 'brown', d: 4.5, a: 0.3, f: 400, f1: 60, ft: 'lowpass', g: 0.7 });
  S.nz(out, t, { k: 'pink', d: 5, a: 2.2, f: 300, f1: 3200, tf: 3.5, q: 0.6, g: 0.3 });
  chord(S, out, t + 1.5, [50, 57, 62, 66], 2.8, 0.45, { a: 1.6, r: 3.2 });
  chime(S, out, t + 2.6, 74, 0.4, { dk: 5 });
  chime(S, out, t + 3.4, 81, 0.3, { dk: 5 });
  return 9.5;
});

// --- places and moments ------------------------------------------------------------------------
def('lantern_lit', { wet: 0.7, ref: 8, range: 140, prio: 2 }, (S, out, t, o) => {
  S.nz(out, t, { k: 'pink', d: 0.8, a: 0.06, f: 250, f1: 2800, tf: 0.2, ft: 'lowpass', g: 0.45 });
  S.tn(out, t, { f: 90, f1: 55, d: 0.3, a: 0.01, g: 0.35 });
  S.tx(out, t + 0.1, 'crackle', { d: 1.2, a: 0.1, g: 0.2, hp: 900 });
  // the lantern answers
  bigBell(S, out, t + 0.25, 220 * (o.pitch || 1), 0.55, 6);
  chord(S, out, t + 0.3, [57, 64], 1.4, 0.3, { a: 0.9, r: 2.4 });
  return 7.5;
});
def('travel', { wet: 0.7, prio: 2 }, (S, out, t) => {
  S.nz(out, t, { k: 'pink', d: 1.3, a: 1.15, f: 200, f1: 2600, tf: 1.2, q: 0.8, g: 0.5, c: 'l' });
  [220, 330, 440, 660].forEach((f) => S.tn(out, t, { f, f1: f * 2, tf: 1.2, d: 1.25, a: 1.0, g: 0.07, c: 'l' }));
  S.tn(out, t + 1.25, { f: 75, f1: 35, d: 1.2, a: 0.004, g: 0.6 });
  S.nz(out, t + 1.25, { k: 'brown', d: 0.8, a: 0.004, f: 500, ft: 'lowpass', g: 0.4 });
  chime(S, out, t + 1.27, 74, 0.4, { dk: 4 });
  return 5.6;
});
def('shrine_open', { wet: 0.5, ref: 7, range: 120, prio: 2 }, (S, out, t, o) => {
  const p = P(S, o, 0.04);
  const slow = flutter(S, out, t, 1.7, 0.7, 30);
  S.nz(slow, t, { k: 'brown', d: 1.6, a: 0.15, h: 1.1, f: 260 * p, q: 0.8, g: 0.9 });
  S.nz(slow, t, { k: 'white', d: 1.5, a: 0.2, h: 1.0, f: 430 * p, f1: 470 * p, q: 30, g: 0.5 });
  S.tx(out, t, 'grit', { d: 1.6, a: 0.1, h: 1.1, g: 0.2, f: 1700, q: 0.6 });
  S.scatter(6, t + 0.2, 1.3, (tt) => clink(S, out, tt, S.range(900, 1600), 0.05, 0.05));
  clack(S, out, t + 1.7, 220 * p, 0.6, 0.15);
  knock(S, out, t + 1.7, 140 * p, 0.5, 0.2);
  S.tn(out, t + 1.75, { f: 62, f1: 40, d: 1.2, a: 0.01, g: 0.5 });
  return 3.0;
});
def('prime_get', { wet: 0.8, prio: 2 }, (S, out, t) => {
  bigBell(S, out, t, 110, 0.9, 7);
  chord(S, out, t + 0.1, [50, 57, 62, 69], 2.6, 0.45, { a: 1.2, r: 3.0 });
  S.scatter(10, t + 0.3, 2.5, (tt) => clink(S, out, tt, S.range(2800, 6500), 0.03, 0.6, S.range(-0.7, 0.7)));
  S.tn(out, t, { f: 55, d: 3.0, a: 1.2, g: 0.25, c: 't' });
  // the theme of the three Primes, slowly, high above the bell
  [81, 86, 89].forEach((m, i) => chime(S, out, t + 1.3 + i * 0.6, m, 0.4, { dk: 4.5 }));
  return 8.5;
});
def('opus_stage', { wet: 0.7, prio: 2 }, (S, out, t, o) => {
  const s = semis(o);
  bigBell(S, out, t, 73.42 * Math.pow(2, s / 12), 0.8, 6);
  chord(S, out, t + 0.05, [50 + s, 57 + s], 1.4, 0.4, { a: 0.7, r: 2.4 });
  S.nz(out, t, { k: 'white', d: 1.4, a: 0.4, f: 6000, q: 1.5, g: 0.04 });
  // a hammer on the anvil, then the fire takes a breath and climbs: what sets a stage of the Work
  // apart from a potion binding
  anvil(S, out, t, 0.7);
  anvil(S, out, t + 0.34, 0.4);
  S.nz(out, t + 0.1, { k: 'pink', d: 2.6, a: 1.1, f: 300, f1: 1500, q: 0.9, g: 0.3 });
  return 7.0;
});
def('stone_form', { wet: 0.8, prio: 2 }, (S, out, t) => {
  // many voices far apart, drawn into one note
  for (let i = 0; i < 7; i++) {
    const tgt = mtof(i % 2 ? 62 : 50);
    const f0 = tgt * Math.pow(2, S.range(-7, 7) / 12);
    S.tn(out, t, { w: 'sawtooth', f: f0, f1: tgt, tf: 2.6, d: 4.2, a: 1.2, g: 0.07, lp: 500, lp1: 2600, pan: S.range(-0.7, 0.7) });
  }
  const t1 = t + 2.6;
  chime(S, out, t1, 86, 0.5, { dk: 4 });
  chime(S, out, t1 + 0.04, 81, 0.4, { dk: 4 });
  S.scatter(8, t1, 0.8, (tt) => clink(S, out, tt, S.range(3000, 7000), 0.04, 0.5, S.range(-0.7, 0.7)));
  S.tn(out, t1, { f: 110, f1: 36, d: 2.2, a: 0.01, g: 0.6 });
  chord(S, out, t1, [38, 50, 57, 62, 69], 3.0, 0.5, { a: 0.3, r: 3.5, v0: 'ah', v1: 'oo' });
  bigBell(S, out, t1 + 0.02, 146.83, 0.6, 7);
  return 11.0;
});
def('bell', { wet: 0.6, ref: 14, range: 400, prio: 2, gap: 0.3 }, (S, out, t, o) => {
  bigBell(S, out, t, 130.81 * (o.pitch || 1), 1, 10);
  return 10.5;
});
def('crow', { wet: 0.35, ref: 8, range: 170, gap: 0.2 }, (S, out, t, o) => {
  const n = o.count || S.pick([1, 2, 2, 3]);
  const base = 520 * P(S, o, 0.08);
  let tt = t;
  for (let i = 0; i < n; i++) {
    const d = S.range(0.24, 0.34),
      f = base * (1 - i * 0.03) * S.jit(1, 0.03);
    const src = S.gain(1);
    for (const [type, mul, lvl] of [['sawtooth', 1, 0.6], ['sawtooth', 1.007, 0.5], ['square', 0.5, 0.3]]) {
      const osc = S.osc(type, f * mul, tt, d + 0.03);
      osc.frequency.setValueAtTime(f * mul * 0.92, tt);
      osc.frequency.linearRampToValueAtTime(f * mul * 1.08, tt + d * 0.18);
      osc.frequency.linearRampToValueAtTime(f * mul * 0.8, tt + d);
      S.chain(osc, S.gain(lvl), src);
    }
    // the rasp: the throat chops the tone
    const rasp = S.gain(0.45);
    S.chain(S.osc('sawtooth', S.range(68, 96), tt, d + 0.03), S.gain(0.55)).connect(rasp.gain);
    src.connect(rasp);
    S.chain(S.noise('pink', tt, d + 0.03), S.gain(0.5), rasp);
    const env = S.gain(0);
    S.env(env.gain, tt, 0, [[0.025, 1], [d - 0.1, 0.85], [0.075, 0]]);
    const mix = S.gain(1);
    for (const [hz, q, lvl] of [[1250, 4, 1], [2300, 6, 0.7], [3400, 6, 0.3]]) S.chain(rasp, S.bq('bandpass', hz * S.jit(1, 0.04), q), S.gain(lvl), mix);
    S.chain(mix, env, out);
    tt += d + S.range(0.1, 0.2);
  }
  return tt - t + 0.1;
});

// --- footsteps ---------------------------------------------------------------------------------
const heel = (S, out, t, g, f = 80) => S.tn(out, t, { f, f1: f * 0.6, d: 0.07, a: 0.003, g });
const STEPS = {
  grass(S, out, t) {
    heel(S, out, t, 0.18);
    S.nz(out, t, { k: 'pink', d: 0.11, a: 0.008, f: 1700, ft: 'lowpass', g: 0.3 });
    S.nz(out, t, { k: 'white', d: 0.09, a: 0.015, f: 4200, q: 0.7, g: 0.07 });
    S.nz(out, t + 0.07, { k: 'pink', d: 0.06, a: 0.008, f: 1400, ft: 'lowpass', g: 0.1 });
  },
  dirt(S, out, t) {
    heel(S, out, t, 0.3);
    S.nz(out, t, { k: 'pink', d: 0.09, a: 0.004, f: 700, q: 0.6, g: 0.35 });
    S.tx(out, t, 'grit', { d: 0.1, a: 0.01, g: 0.2, f: 1500, q: 0.6 });
  },
  stone(S, out, t, p) {
    clack(S, out, t, 520 * p, 0.22, 0.04);
    heel(S, out, t, 0.22, 110);
    S.nz(out, t + 0.03, { k: 'pink', d: 0.06, a: 0.01, f: 2200, q: 0.7, g: 0.07 });
  },
  sand(S, out, t) {
    S.nz(out, t, { k: 'pink', d: 0.17, a: 0.02, f: 1700, q: 0.5, g: 0.26 });
    heel(S, out, t, 0.1);
  },
  wood(S, out, t, p) {
    knock(S, out, t, 175 * p, 0.45, 0.12);
    heel(S, out, t, 0.2, 70);
    if (S.chance(0.16)) creak(S, out, t + 0.03, 180, 240, 0.18, 0.05, 1200);
  },
  water(S, out, t, p) {
    S.nz(out, t, { k: 'pink', d: 0.26, a: 0.012, f: 700 * p, f1: 1900 * p, tf: 0.08, q: 0.8, g: 0.4 });
    S.nz(out, t, { k: 'white', d: 0.2, a: 0.03, ft: 'none', hp: 3500, g: 0.06 });
    S.scatter(3, t + 0.02, 0.15, (tt) => blip(S, out, tt, S.range(350, 800), S.range(600, 1300), 0.04, 0.1));
  },
  snow(S, out, t) {
    const fl = flutter(S, out, t, 0.2, 0.6, 60);
    S.nz(fl, t, { k: 'pink', d: 0.19, a: 0.012, f: 1250, q: 1.4, g: 0.4 });
    S.tx(out, t, 'grit', { d: 0.16, a: 0.01, g: 0.14, hp: 2000 });
    heel(S, out, t, 0.12);
  },
  ash(S, out, t) {
    S.nz(out, t, { k: 'pink', d: 0.15, a: 0.015, f: 850, ft: 'lowpass', g: 0.32 });
    S.tx(out, t, 'grit', { d: 0.08, a: 0.01, g: 0.05, hp: 2500 });
  },
  salt(S, out, t, p) {
    S.tx(out, t, 'grit', { d: 0.1, a: 0.003, g: 0.5, hp: 2600 });
    S.nz(out, t, { k: 'white', d: 0.07, a: 0.004, f: 3200, q: 0.8, g: 0.14 });
    S.scatter(2, t, 0.06, (tt) => clink(S, out, tt, S.range(4000, 7000) * p, 0.03, 0.04));
    heel(S, out, t, 0.12);
  },
};
export const SURFACES = Object.keys(STEPS);
for (const s of SURFACES) {
  def('step_' + s, { wet: 0.06, prio: 0, gap: 0.08 }, (S, out, t, o) => {
    S._foot = !S._foot;
    const side = S.pan(S._foot ? 0.1 : -0.1);
    side.connect(out);
    STEPS[s](S, side, t, P(S, o, 0.08));
    return 0.35;
  });
}

/** The names the game may ask for (footsteps are reached through audio.footstep). */
export const SFX_NAMES = Object.keys(SFX).filter((n) => !n.startsWith('step_'));
