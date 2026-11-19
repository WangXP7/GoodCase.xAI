// The instruments of the score. They are also borrowed by a few one-shots (a lantern answering,
// a Prime taken), so they live apart from the music scheduler. Every function schedules one note on
// `out` at time `t` and returns the time at which it has gone silent.
import { mtof, clamp } from './dsp.js';

// Formants [hz, gain, Q] of a low mixed choir.
const VOWELS = {
  oo: [[325, 1.0, 5], [700, 0.28, 8], [2530, 0.05, 10]],
  oh: [[450, 1.0, 5], [800, 0.42, 8], [2830, 0.07, 10]],
  ah: [[700, 1.0, 5], [1150, 0.6, 8], [2600, 0.16, 10]],
  eh: [[480, 1.0, 5], [1750, 0.35, 9], [2450, 0.2, 10]],
  mm: [[260, 1.0, 4], [620, 0.12, 6], [2200, 0.02, 8]],
};

/** A bowed string section holding one note. o: a r bright thin */
export function padNote(S, out, t, m, dur, vel = 1, o = {}) {
  const f = mtof(m);
  const a = o.a ?? 2.4,
    r = o.r ?? 3.6,
    bright = o.bright ?? 0.5;
  dur = Math.max(dur, a * 0.6);
  const g = S.gain(0);
  const end = S.swell(g.gain, t, vel, a, dur, r);
  const life = end - t + 0.05;
  const sum = S.gain(o.thin ? 0.42 : 0.3);
  const lfo = S.osc('sine', S.range(4.3, 5.4), t, life);
  const lfoG = S.gain(0);
  lfoG.gain.setValueAtTime(0, t);
  lfoG.gain.linearRampToValueAtTime(o.thin ? 3 : 6, t + a + 1.5);
  lfo.connect(lfoG);
  const voices = o.thin
    ? [['triangle', 1, -4, 1], ['sine', 2, 5, 0.25]]
    : [['sawtooth', 1, -9, 1], ['sawtooth', 1, 7, 1], ['sawtooth', bright > 0.6 ? 2 : 1, 1, bright > 0.6 ? 0.4 : 0.8]];
  for (const [type, mul, det, lvl] of voices) {
    const osc = S.osc(type, f * mul, t, life, det + S.range(-3, 3));
    lfoG.connect(S.slow(osc.detune));
    if (lvl === 1) osc.connect(sum);
    else S.chain(osc, S.gain(lvl), sum);
  }
  // a little rosin: breath of the bow around the second harmonic
  S.chain(S.noise('pink', t, life), S.bq('bandpass', Math.min(f * 2, 3000), 1.5), S.gain(o.thin ? 0.05 : 0.035), sum);
  const cut0 = Math.min(f * 1.5 + 110, 2400),
    cut1 = Math.min(f * (2.2 + bright * 3.4) + 240, 5200);
  const lp = S.bq('lowpass', cut0);
  lp.frequency.setValueAtTime(cut0, t);
  lp.frequency.linearRampToValueAtTime(cut1, t + a);
  lp.frequency.setTargetAtTime(cut0, t + Math.max(dur, a + 0.05), r / 3);
  S.chain(sum, lp, g, out);
  return end;
}

/** Two singers on one note, the vowel drifting from v0 to v1. o: a r v0 v1 */
export function choirNote(S, out, t, m, dur, vel = 1, o = {}) {
  const f = mtof(m);
  const a = o.a ?? 2.0,
    r = o.r ?? 3.2;
  const v0 = VOWELS[o.v0 || 'oo'],
    v1 = VOWELS[o.v1 || o.v0 || 'oo'];
  const shift = m > 66 ? 1.16 : m > 59 ? 1.07 : 1;
  dur = Math.max(dur, a * 0.6);
  const g = S.gain(0);
  const end = S.swell(g.gain, t, vel, a, dur, r);
  const life = end - t + 0.05;
  const src = S.gain(1);
  for (let i = 0; i < 2; i++) {
    const osc = S.osc('sawtooth', f, t, life, (i ? 8 : -7) + S.range(-4, 4));
    const vib = S.osc('sine', S.range(4.7, 5.9), t, life);
    const vg = S.gain(0);
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(S.range(9, 16), t + a + 0.8);
    S.chain(vib, vg);
    vg.connect(S.slow(osc.detune));
    osc.connect(src);
  }
  S.chain(S.noise('pink', t, life), S.gain(0.35), src);
  const mix = S.gain(2.2);
  for (let k = 0; k < 3; k++) {
    const bp = S.bq('bandpass', v0[k][0] * shift, v0[k][2]);
    bp.frequency.setValueAtTime(v0[k][0] * shift, t);
    bp.frequency.linearRampToValueAtTime(v1[k][0] * shift, t + dur);
    const fg = S.gain(v0[k][1]);
    fg.gain.setValueAtTime(v0[k][1], t);
    fg.gain.linearRampToValueAtTime(v1[k][1], t + dur);
    S.chain(src, bp, fg, mix);
  }
  S.chain(mix, S.bq('lowpass', 3600), g, out);
  return end;
}

// Partials [ratio, gain, decay share] of a small dark bell.
const CHIME = [[0.5, 0.22, 1.3], [1, 1, 1], [2, 0.42, 0.62], [2.42, 0.2, 0.5], [3.0, 0.16, 0.4], [4.08, 0.1, 0.3], [5.4, 0.05, 0.2]];
/** A hand bell or a struck glass: the rare single notes of the score. o: dk (seconds of ring) */
export function chime(S, out, t, m, vel = 1, o = {}) {
  const f = mtof(m),
    base = o.dk ?? 5.5;
  S.nz(out, t, { k: 'white', d: 0.03, a: 0.001, f: Math.min(f * 4, 6000), q: 1.2, g: 0.1 * vel });
  return t + S.modal(out, t, { f, parts: CHIME.map(([r, g, d]) => [r, g * vel * 0.3, base * d]), a: 0.004, det: 2 });
}

// Partials of a cast church bell: hum, prime, tierce (the minor third that makes it mournful), quint, nominal...
const BELL = [[0.5, 0.4, 1.0], [1, 0.8, 0.8], [1.19, 0.55, 0.6], [1.5, 0.35, 0.42], [2, 0.7, 0.48], [2.51, 0.28, 0.26], [3.01, 0.22, 0.2], [4.07, 0.15, 0.14], [5.32, 0.1, 0.09], [6.71, 0.06, 0.06]];
/** A great bell. f is the pitch of its prime; ring is the length of the hum in seconds. */
export function bigBell(S, out, t, f, vel = 1, ring = 9) {
  const parts = [];
  for (const [r, g, d] of BELL) {
    parts.push([r * f, g * vel * 0.24, ring * d]);
    // real bells are never round: each low mode is a close pair that beats slowly
    if (r <= 2) parts.push([r * f + S.range(0.35, 1.1), g * vel * 0.14, ring * d * 0.9]);
  }
  S.nz(out, t, { k: 'white', d: 0.035, a: 0.0008, f: 2100, q: 0.9, g: 0.3 * vel });
  S.tn(out, t, { f: 95, f1: 58, d: 0.09, a: 0.002, g: 0.3 * vel });
  return t + S.modal(out, t, { parts, a: 0.003 });
}

/** A plucked or hammered string. Buffers are computed for every third semitone and re-tuned. o: bright */
export function pluck(S, out, t, m, vel = 1, o = {}) {
  const bright = o.bright ?? 0.5;
  const base = 3 * Math.round(m / 3);
  const buf = S.pluckBuffer(base, bright);
  const rate = Math.pow(2, (m - base) / 12);
  const src = S.play(buf, t, { rate });
  const lp = S.bq('lowpass', clamp(mtof(m) * (3 + 7 * bright), 900, 9000));
  // the sound box: a broad low resonance
  const body = S.bq('peaking', 240, 1.2, 4);
  S.chain(src, lp, body, S.gain(vel * 0.5), out);
  return t + buf.duration / rate;
}

/**
 * The skin of a drum: its own soft clip. The first instant of the blow is rounded and what rings
 * after it is lifted, so a drum can be heard without standing 20 dB over the band for a moment.
 * `drive` is set so that the hardest blow just reaches the top of the curve. Returns where to play.
 */
function skin(S, out, drive = 1) {
  const pre = S.gain(drive);
  S.chain(pre, S.shaper('soft'), S.gain(0.6 / drive), out);
  return pre;
}

/** A very large, very slack drum, far away. */
export function drum(S, out, t, vel = 1) {
  const to = skin(S, out, 1.3);
  S.tn(to, t, { f: 72, f1: 39, tf: 0.3, d: 1.5, a: 0.004, g: 0.6 * vel });
  S.tn(to, t, { f: 104, f1: 60, tf: 0.12, d: 0.4, a: 0.003, g: 0.35 * vel });
  // the knock of the skin, an octave up: what is left of the drum on small speakers
  S.tn(to, t, { f: 176, f1: 112, tf: 0.09, d: 0.24, a: 0.004, g: 0.3 * vel });
  S.nz(to, t, { k: 'brown', d: 0.32, a: 0.003, f: 240, ft: 'lowpass', g: 0.7 * vel });
  S.nz(out, t, { k: 'pink', d: 0.03, a: 0.001, f: 900, q: 0.8, g: 0.09 * vel });
  return t + 1.6;
}

/** Bowed metal: noise ringing in a handful of narrow, unrelated resonances, swelling and gone. */
export function scrape(S, out, t, dur, vel = 1, hz = 420) {
  const g = S.gain(0);
  S.env(g.gain, t, 0, [[dur * 0.6, vel, 't'], [dur * 0.4, 0, 't'], [0.3, 0]]);
  const src = S.noise('pink', t, dur + 0.4);
  const mix = S.gain(5);
  for (const r of [1, 1.47, 2.09, 2.56, 3.22]) {
    const bp = S.bq('bandpass', hz * r, 45);
    bp.frequency.setValueAtTime(hz * r, t);
    bp.frequency.linearRampToValueAtTime(hz * r * S.range(1.01, 1.05), t + dur);
    S.chain(src, bp, S.bq('bandpass', hz * r, 20), mix);
  }
  S.chain(mix, g, out);
  return t + dur + 0.4;
}

/** A low reed growl: two rough saws opening and closing. */
export function growl(S, out, t, dur, vel = 1, m = 33) {
  const f = mtof(m);
  const g = S.gain(0);
  const end = S.swell(g.gain, t, vel, dur * 0.45, dur * 0.5, dur * 0.4);
  const life = end - t + 0.05;
  const pre = S.gain(1.4);
  S.osc('sawtooth', f, t, life, -12).connect(pre);
  S.osc('sawtooth', f, t, life, 11).connect(pre);
  S.chain(S.osc('sawtooth', f * 0.5, t, life, 3), S.gain(0.6), pre);
  const lp = S.bq('lowpass', 110, 4);
  lp.frequency.setValueAtTime(110, t);
  lp.frequency.linearRampToValueAtTime(330, t + dur * 0.5);
  lp.frequency.linearRampToValueAtTime(120, t + dur);
  S.chain(pre, S.shaper('drive'), lp, g, out);
  return end;
}

/** A held chord on choir and strings together: the swell under the big moments. */
export function chord(S, out, t, midis, dur, vel = 1, o = {}) {
  let end = t;
  for (const m of midis) {
    if (o.strings !== false) end = Math.max(end, padNote(S, out, t, m, dur, vel * 0.5, { a: o.a ?? 0.8, r: o.r ?? 2.2, bright: o.bright ?? 0.6 }));
    if (o.voices !== false && m >= 48) end = Math.max(end, choirNote(S, out, t, m, dur, vel * 0.5, { a: o.a ?? 0.8, r: o.r ?? 2.2, v0: o.v0 || 'oo', v1: o.v1 || 'ah' }));
  }
  return end;
}

// --- the players of the written score (score.js) -------------------------------------------------

/**
 * One bow on one string: a vielle carrying a tune. A step from the note before is slid into, any
 * other note is found from just below, and the vibrato only comes once the note is held.
 * o: a r vib bright from (the note before, when this one is joined to it)
 */
export function viol(S, out, t, m, dur, vel = 1, o = {}) {
  const f = mtof(m);
  const a = o.a ?? 0.08,
    r = o.r ?? 0.26,
    bright = o.bright ?? 0.5;
  dur = Math.max(dur, a + 0.05);
  const body = dur - a;
  const g = S.gain(0);
  // the bow bites, leans into the note, eases, and lets go
  const end = S.env(g.gain, t, 0, [[a, vel * 0.78], [body * 0.42, vel], [body * 0.58, vel * 0.64], [r, 0, 't'], [0.04, 0]]);
  const life = end - t + 0.03;
  const step = o.from != null ? o.from - m : 0;
  const slid = step !== 0 && Math.abs(step) <= 4;
  const bend = slid ? step * 38 : -26,
    glide = slid ? 0.085 : 0.06;
  const vib = S.osc('sine', S.range(5.1, 5.9), t, life);
  const vg = S.gain(0);
  const late = Math.min(0.22, dur * 0.35);
  vg.gain.setValueAtTime(0, t + late);
  vg.gain.linearRampToValueAtTime(o.vib ?? 15, t + late + 0.35);
  vib.connect(vg);
  const sum = S.gain(0.34);
  for (const det of [-3, 6]) {
    const osc = S.osc('sawtooth', f, t, life, det);
    S.slow(osc.detune);
    osc.detune.setValueAtTime(det + bend, t);
    osc.detune.linearRampToValueAtTime(det, t + glide);
    vg.connect(osc.detune);
    osc.connect(sum);
  }
  // rosin
  S.chain(S.noise('pink', t, life), S.bq('bandpass', Math.min(f * 3, 3600), 1.2), S.gain(0.05), sum);
  const cut0 = Math.min(f * 2 + 300, 3000),
    cut1 = Math.min(f * (3 + 5 * bright) + 600, 6500);
  const lp = S.bq('lowpass', cut0);
  lp.frequency.setValueAtTime(cut0, t);
  lp.frequency.linearRampToValueAtTime(cut1, t + a + body * 0.42);
  lp.frequency.setTargetAtTime(cut0, t + dur, r / 3);
  // the box: the three resonances that make a fiddle a fiddle
  S.chain(sum, lp, S.bq('peaking', 290, 1.6, 4), S.bq('peaking', 1150, 2, 6), S.bq('peaking', 2500, 2.2, 3), S.bq('highpass', 90), g, out);
  return end;
}

/** A wooden flute: nearly a pure tone with breath around it, a little sharp as it speaks. o: a r vib breath */
export function flute(S, out, t, m, dur, vel = 1, o = {}) {
  const f = mtof(m);
  const a = o.a ?? 0.07,
    r = o.r ?? 0.17,
    breath = o.breath ?? 1;
  dur = Math.max(dur, a + 0.04);
  const body = dur - a;
  const g = S.gain(0);
  const end = S.env(g.gain, t, 0, [[a, vel], [body * 0.5, vel * 0.86], [body * 0.5, vel * 0.72], [r, 0, 't'], [0.04, 0]]);
  const life = end - t + 0.03;
  const vib = S.osc('sine', S.range(4.6, 5.4), t, life);
  const vg = S.gain(0);
  const late = Math.min(0.2, dur * 0.4);
  vg.gain.setValueAtTime(0, t + late);
  vg.gain.linearRampToValueAtTime(o.vib ?? 11, t + late + 0.3);
  vib.connect(vg);
  const sum = S.gain(0.5);
  for (const [mul, lvl] of [[1, 1], [2, 0.3], [3, 0.1], [4, 0.035]]) {
    if (f * mul > 9000) continue;
    const osc = S.osc('sine', f * mul, t, life);
    S.slow(osc.detune);
    osc.detune.setValueAtTime(17, t);
    osc.detune.linearRampToValueAtTime(0, t + 0.06);
    vg.connect(osc.detune);
    if (lvl === 1) osc.connect(sum);
    else S.chain(osc, S.gain(lvl), sum);
  }
  // breath: a puff as the note speaks, then air along with the tone
  const bg = S.gain(0);
  S.env(bg.gain, t, 0, [[0.015, 0.5 * breath], [0.07, 0.11 * breath], [Math.max(0.01, dur - 0.085), 0.08 * breath], [r, 0]]);
  S.chain(S.noise('white', t, life), S.bq('bandpass', Math.min(f * 2.2, 6000), 1.4), bg, sum);
  S.chain(sum, S.bq('lowpass', Math.min(f * 5, 7000)), g, out);
  return end;
}

/** A small organ: stopped pipes at five pitches, a cough of air as they speak, no vibrato. o: a r full */
export function organ(S, out, t, m, dur, vel = 1, o = {}) {
  const f = mtof(m);
  const a = o.a ?? 0.05,
    r = o.r ?? 0.24;
  dur = Math.max(dur, a + 0.03);
  const g = S.gain(0);
  const end = S.env(g.gain, t, 0, [[a, vel], [dur - a, vel], [r, 0, 't'], [0.04, 0]]);
  const life = end - t + 0.03;
  const sum = S.gain(0.3);
  // the sixteen-foot, eight-foot, four-foot, the twelfth and the two-foot ranks
  const ranks = [[0.5, 0.5], [1, 1], [2, 0.5], [3, 0.2], [4, 0.26]];
  if (o.full) ranks.push([6, 0.1], [8, 0.08]);
  for (const [mul, lvl] of ranks) if (f * mul < 9000) S.chain(S.osc('sine', f * mul, t, life, S.range(-3, 3)), S.gain(lvl), sum);
  S.chain(S.osc('triangle', f, t, life, 4), S.gain(0.35), sum);
  S.nz(sum, t, { k: 'white', d: 0.07, a: 0.004, f: Math.min(f * 3, 5000), q: 2, g: 0.25 });
  S.chain(sum, S.bq('lowpass', 4200), g, out);
  return end;
}

/** A war horn: the harder it is blown, the more it opens. o: a r */
export function horn(S, out, t, m, dur, vel = 1, o = {}) {
  const f = mtof(m);
  const a = o.a ?? clamp(0.16 - 0.06 * vel, 0.07, 0.16),
    r = o.r ?? 0.45;
  dur = Math.max(dur, a + 0.05);
  const body = dur - a;
  const g = S.gain(0);
  const end = S.env(g.gain, t, 0, [[a, vel], [body * 0.4, vel * 0.9], [body * 0.6, vel * 0.75], [r, 0, 't'], [0.05, 0]]);
  const life = end - t + 0.03;
  const sum = S.gain(0.4);
  for (const det of [-5, 4]) {
    const osc = S.osc('sawtooth', f, t, life, det);
    S.slow(osc.detune);
    // the lip finds the note from below
    osc.detune.setValueAtTime(det - 30, t);
    osc.detune.linearRampToValueAtTime(det, t + 0.07);
    osc.connect(sum);
  }
  const shut = f * 1.4,
    top = clamp(f * (3 + 3.5 * vel), 300, 2600),
    open = Math.min(a * 1.5, dur);
  const lp = S.bq('lowpass', shut, 2);
  lp.frequency.setValueAtTime(shut, t);
  lp.frequency.linearRampToValueAtTime(top, t + open);
  lp.frequency.setTargetAtTime(top * 0.7, t + open, 0.6);
  lp.frequency.setTargetAtTime(shut, t + dur, r / 3);
  S.chain(sum, lp, S.bq('peaking', 480, 1.2, 4), g, out);
  return end;
}

/** Low strings, bowed. With `bite` the bow is short and hard and the string rasps. o: a r bite */
export function bass(S, out, t, m, dur, vel = 1, o = {}) {
  const f = mtof(m);
  const a = o.a ?? 0.1,
    r = o.r ?? 0.35;
  dur = Math.max(dur, a + 0.04);
  const g = S.gain(0);
  const end = S.env(g.gain, t, 0, [[a, vel], [dur - a, vel * 0.8], [r, 0, 't'], [0.05, 0]]);
  const life = end - t + 0.03;
  const sum = S.gain(0.5);
  S.osc('sawtooth', f, t, life, -3).connect(sum);
  S.chain(S.osc('sine', f, t, life), S.gain(0.5), sum);
  S.chain(S.osc('triangle', f * 2, t, life, 4), S.gain(0.45), sum);
  // what a small speaker can play of a low string is its overtones: they are kept
  const cut = o.bite ? clamp(f * 9, 500, 1500) : clamp(f * 6, 260, 800);
  const lp = S.bq('lowpass', cut * 0.6);
  lp.frequency.setValueAtTime(cut * 0.6, t);
  lp.frequency.linearRampToValueAtTime(cut, t + a);
  if (o.bite) lp.frequency.setTargetAtTime(cut * 0.5, t + a, Math.max(0.05, dur / 2));
  S.chain(sum, lp, g, out);
  return end;
}

/** A frame drum: the open stroke in the middle of the skin (deep), or the rim. */
export function frame(S, out, t, vel = 1, deep = true) {
  if (deep) {
    const to = skin(S, out, 0.7);
    S.tn(to, t, { f: 118, f1: 76, tf: 0.12, d: 0.5, a: 0.002, g: 0.7 * vel });
    S.tn(to, t, { f: 236, f1: 170, tf: 0.05, d: 0.16, a: 0.002, g: 0.2 * vel });
    S.nz(out, t, { k: 'pink', d: 0.07, a: 0.001, f: 700, q: 0.7, g: 0.22 * vel });
    return t + 0.55;
  }
  S.nz(out, t, { k: 'white', d: 0.06, a: 0.001, f: 1900, q: 1.1, g: 0.3 * vel });
  S.tn(out, t, { w: 'triangle', f: 340, f1: 300, d: 0.09, a: 0.001, g: 0.2 * vel });
  return t + 0.12;
}

/** A war drum: a tight skin on a big shell, close by. */
export function warDrum(S, out, t, vel = 1) {
  const to = skin(S, out, 0.85);
  S.tn(to, t, { f: 96, f1: 48, tf: 0.2, d: 1.1, a: 0.003, g: 0.62 * vel });
  S.tn(to, t, { f: 150, f1: 82, tf: 0.08, d: 0.3, a: 0.002, g: 0.45 * vel });
  // the shell, an octave over the skin: the part of the blow that small speakers can play
  S.tn(to, t, { f: 240, f1: 132, tf: 0.07, d: 0.22, a: 0.002, g: 0.36 * vel });
  S.nz(to, t, { k: 'brown', d: 0.22, a: 0.002, f: 320, ft: 'lowpass', g: 0.8 * vel });
  S.nz(out, t, { k: 'pink', d: 0.05, a: 0.001, f: 1300, q: 0.8, g: 0.3 * vel });
  return t + 1.2;
}

/** A rattle of bone and seed. */
export function rattle(S, out, t, vel = 1) {
  S.tx(out, t, 'grit', { d: 0.09, a: 0.004, g: 0.3 * vel, hp: 2500 });
  return t + 0.12;
}

// Partials [hz, gain, seconds] of a hammer on an anvil: bright, unrelated, soon gone.
const ANVIL = [[523, 0.3, 0.9], [1187, 0.34, 0.7], [1870, 0.26, 0.55], [2740, 0.2, 0.42], [3610, 0.13, 0.3], [5200, 0.07, 0.22]];
export function anvil(S, out, t, vel = 1) {
  S.nz(out, t, { k: 'white', d: 0.025, a: 0.0006, f: 3800, q: 0.8, g: 0.3 * vel });
  return t + S.modal(out, t, { parts: ANVIL.map(([hz, g, secs]) => [hz, g * vel, secs]), a: 0.0008, det: 6 });
}
