// Audition board and measuring bench for the audio engine.
//   dev/audio.html      a board for ears: every one-shot, loop, the ambience and the score
//   window.AUD          the bench: offline renders, measurements, spectrograms, a real-time stress
//                       run. tools/audio-check.mjs drives it in headless Chromium.
import { createAudio, MASTER } from '../src/audio/index.js';
import { SFX } from '../src/audio/sfx.js';
import { LOOPS } from '../src/audio/loops.js';
import { MOOD_K } from '../src/audio/levels.js';
import { DEV } from '../src/audio/music.js';
import { PIECES } from '../src/audio/score.js';

const SR = 48000;
const NAMES = createAudio().names();
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const dB = (x) => (x > 1e-10 ? 20 * Math.log10(x) : -200);
const r1 = (x) => Math.round(x * 10) / 10;
const r3 = (x) => Math.round(x * 1000) / 1000;

// --- how loud things should be --------------------------------------------------------------------
// One-shots: the loudest 50 ms, in dBFS, heard alone, close, before the limiter and without reverb.
const CLASS_DB = { q: -36, s: -30, m: -25, l: -20, h: -14 };
const SFX_CLASS = {
  q: 'ui_hover grab throw jump',
  s: 'ui_click page pickup cork impact_soft drink bottle_fill drop_in bellows',
  m: 'ui_open ui_close toast pickup_rare impact_hard land splash ignite extinguish steam hurt heal brew_fail vine_grow ice_form lid_slide crow',
  l: 'shatter discover quest brew_ready ember_burst rime_burst verdance_burst levity_burst spire_rise spire_crumble briar_burn rock_crack ice_crack shade_hit shade_die lantern_lit travel shrine_open death respawn bell gloom_lift opus_stage prime_get',
  h: 'fulminate_burst rock_break stone_form',
};
const STEP_DB = -31; // a running step; walking is quieter
const SFX_DB = {};
for (const [c, list] of Object.entries(SFX_CLASS)) for (const n of list.split(' ')) SFX_DB[n] = CLASS_DB[c];
for (const s of NAMES.surfaces) SFX_DB['step_' + s] = STEP_DB;
// Loops: steady RMS at full parameter, at the reference distance.
const LOOP_DB = { fire: -23, bubble: -25, stir: -28, river: -25, waterfall: -21, lava: -23, vent: -25, athanor: -18, shade: -23, rain: -25, levity: -28 };
const PARAM_LOOPS = new Set(['fire', 'bubble', 'stir', 'athanor', 'shade']);
// Music: the loudest three seconds of the first minute and a half at intensity 0.7, which is
// long enough to reach the fullest strain of every piece.
const MOOD_SECS = 90;
const MOOD_DB = { title: -18, vale: -19.5, saltwood: -21, mere: -20, scar: -18, heights: -20.5, night: -22, gloom: -18.5, brew: -21, opus: -16, ending: -17 };

const AMBIENCES = {
  calm: { region: 'vale', wind: 0, height: 20 },
  shore_day: { region: 'shore', wind: 0.4, water: 1, height: 2 },
  vale_night: { region: 'vale', night: 1, wind: 0.25, water: 0.1, height: 20 },
  vale_storm: { region: 'vale', night: 0.3, wind: 1, rain: 1, height: 20 },
  saltwood: { region: 'saltwood', wind: 0.5, height: 25 },
  mere: { region: 'mere', night: 0.5, wind: 0.15, water: 0.8, height: 5 },
  scar: { region: 'scar', wind: 0.3, height: 40 },
  heights: { region: 'heights', wind: 0.8, height: 95 },
  gloom: { region: 'vale', gloom: 1, wind: 0.3, height: 20 },
};
const LOUDEST = 'fulminate_burst rock_break stone_form shatter ember_burst rime_burst bell verdance_burst levity_burst spire_rise briar_burn ice_crack rock_crack shade_die death prime_get quest discover spire_crumble lantern_lit'.split(' ');

// --- offline rendering ----------------------------------------------------------------------------
/** Run the real engine on an OfflineAudioContext. setup(audio) asks for the sounds. */
async function render(seconds, setup, o = {}) {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SR), SR);
  const a = createAudio({ context: ctx, seed: o.seed ?? 7, mute: o.mute || [], bypassLimiter: !!o.raw });
  a.setVolumes({ master: 1, music: 1, sfx: 1 });
  setup(a);
  // o.step: schedule the way the game does, a few seconds ahead of the clock, so that a long piece
  // of music does not sit in the graph all at once
  if (o.step) {
    a.advance(o.step + 2);
    for (let t = o.step; t < seconds; t += o.step) {
      ctx.suspend(t).then(() => {
        a.advance(t + o.step + 2);
        ctx.resume();
      });
    }
  } else a.advance(seconds);
  const before = a.debug();
  const buf = await ctx.startRendering();
  return { buf, debug: o.step ? a.debug() : before };
}

// --- measuring ------------------------------------------------------------------------------------
const FFTS = new Map();
function fft(n) {
  if (FFTS.has(n)) return FFTS.get(n);
  const bits = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2),
    sin = new Float64Array(n / 2),
    win = new Float64Array(n);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = -Math.sin((2 * Math.PI * i) / n);
  }
  for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  const re = new Float64Array(n),
    im = new Float64Array(n);
  const F = {
    n,
    /** Magnitudes of the Hann-windowed n samples of x that start at `at`, into out[0 .. n/2). */
    mag(x, at, out) {
      for (let i = 0; i < n; i++) {
        const j = at + i;
        re[rev[i]] = j >= 0 && j < x.length ? x[j] * win[i] : 0;
        im[rev[i]] = 0;
      }
      for (let len = 2; len <= n; len <<= 1) {
        const half = len >> 1,
          step = n / len;
        for (let i = 0; i < n; i += len) {
          for (let k = 0, t = 0; k < half; k++, t += step) {
            const a = i + k,
              b = a + half;
            const vr = re[b] * cos[t] - im[b] * sin[t],
              vi = re[b] * sin[t] + im[b] * cos[t];
            re[b] = re[a] - vr;
            im[b] = im[a] - vi;
            re[a] += vr;
            im[a] += vi;
          }
        }
      }
      for (let i = 0; i < n / 2; i++) out[i] = Math.hypot(re[i], im[i]);
    },
  };
  FFTS.set(n, F);
  return F;
}

const SLICES = 6,
  BANDS = 16;
/**
 * Numbers that describe a render. By default they cover the part that is not silent;
 * { from, to, window: true } measures exactly that stretch instead.
 */
function analyse(buf, o = {}) {
  const sr = buf.sampleRate;
  const L = buf.getChannelData(0),
    R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const n = L.length;
  const i0 = Math.max(0, Math.floor((o.from ?? 0) * sr)),
    i1 = Math.min(n, Math.ceil((o.to ?? n / sr) * sr));
  const m = new Float32Array(n);
  const pw = new Float64Array(n + 1);
  let peak = 0,
    nan = 0,
    dc = 0,
    first = -1,
    last = -1;
  for (let i = 0; i < n; i++) {
    let l = L[i],
      r = R[i];
    if (!Number.isFinite(l) || !Number.isFinite(r)) {
      nan++;
      l = r = 0;
    }
    m[i] = (l + r) * 0.5;
    pw[i + 1] = pw[i] + (l * l + r * r) * 0.5;
    if (i < i0 || i >= i1) continue;
    const a = Math.max(Math.abs(l), Math.abs(r));
    if (a > peak) peak = a;
    dc += m[i];
    if (a > 0.0005) {
      if (first < 0) first = i;
      last = i;
    }
  }
  const active = first >= 0;
  const a0 = o.window || !active ? i0 : first,
    a1 = o.window || !active ? i1 : last + 1;
  const rms = Math.sqrt((pw[a1] - pw[a0]) / Math.max(1, a1 - a0));
  /** Loudest stretch of `secs`; a sound shorter than that is averaged with the silence around it. */
  const loudest = (secs) => {
    const w = Math.floor(secs * sr),
      hop = Math.max(1, Math.floor(w / 5));
    let best = 0;
    for (let i = Math.max(0, a0 - w + hop); i < a1; i += hop) best = Math.max(best, pw[Math.min(n, i + w)] - pw[i]);
    return Math.sqrt(best / w);
  };
  // long-term spectrum, and a coarse picture of how the spectrum moves over the life of the sound
  const N = 2048,
    F = fft(N),
    mag = new Float64Array(N / 2),
    avg = new Float64Array(N / 2),
    feat = new Float64Array(SLICES * BANDS);
  const span = Math.max(1, a1 - a0),
    hop = Math.max(256, Math.floor(span / 300));
  for (let at = a0 - N / 2; at < a1 - N / 2; at += hop) {
    F.mag(m, at, mag);
    const slice = clamp(Math.floor(((at + N / 2 - a0) / span) * SLICES), 0, SLICES - 1);
    for (let k = 1; k < N / 2; k++) {
      const p = mag[k] * mag[k],
        f = (k * sr) / N;
      avg[k] += p;
      if (f >= 60 && f < 16000) feat[slice * BANDS + Math.min(BANDS - 1, Math.floor((Math.log2(f / 60) / Math.log2(16000 / 60)) * BANDS))] += p;
    }
  }
  let num = 0,
    den = 0;
  for (let k = 1; k < N / 2; k++) {
    const a = Math.sqrt(avg[k]);
    num += ((k * sr) / N) * a;
    den += a;
  }
  let fmax = 0;
  for (const v of feat) fmax = Math.max(fmax, v);
  const shape = Array.from(feat, (v) => Math.round(clamp(10 * Math.log10(v / (fmax || 1) + 1e-12) + 50, 0, 50)));
  return {
    dur: active ? r3((last - first + 1) / sr) : 0,
    onset: active ? r3(first / sr) : -1,
    end: active ? r3((last + 1) / sr) : 0,
    peak: r3(peak),
    peakDb: r1(dB(peak)),
    rmsDb: r1(dB(rms)),
    loudDb: r1(dB(loudest(0.05))),
    loud3Db: r1(dB(loudest(3))),
    crestDb: r1(dB(peak) - dB(rms)),
    dc: r3(dc / Math.max(1, i1 - i0)),
    centroid: Math.round(den > 0 ? num / den : 0),
    nan,
    shape,
  };
}

// --- the bench ------------------------------------------------------------------------------------
const DRY = { raw: true, mute: ['amb', 'music', 'reverb'] };
// The compressor node fades in over the first 0.2 s of a context; renders through it start after that.
const START = 0.3;
const trigger = (a, name, o = {}) => (name.startsWith('step_') ? a.footstep(name.slice(5), 1) : a.sfx(name, o));

async function sfxStats(name, o = {}) {
  const { buf, debug } = await render(o.secs || 14, (a) => trigger(a, name), { ...DRY, seed: o.seed });
  const st = analyse(buf);
  return { name, k: SFX[name].k, target: SFX_DB[name] ?? null, declared: r3(debug.lastDur), ...st, end: r3(Math.max(0, st.end - 0.02)) };
}
async function loopStats(name) {
  const p = PARAM_LOOPS.has(name);
  const { buf } = await render(6, (a) => a.loop(name, { param: p ? 0.15 : 0.5 }).set({ param: p ? 1 : 0.5 }, 3), DRY);
  return { name, k: LOOPS[name].k, target: LOOP_DB[name] ?? null, param: p, low: analyse(buf, { from: 1.2, to: 3, window: true }), high: analyse(buf, { from: 4.2, to: 6, window: true }) };
}
/** One mood alone. solo: the name of one player of it, to hear how that one sits in the band. */
async function moodStats(mood, secs = MOOD_SECS, intensity = 0.7, seed = 7, solo = null) {
  const t0 = performance.now();
  DEV.solo = solo;
  try {
    const { buf, debug } = await render(secs, (a) => a.setMusic(mood, { intensity }), { raw: true, mute: ['amb'], seed, step: 4 });
    return { name: solo || mood, k: MOOD_K[mood] ?? 1, target: MOOD_DB[mood] ?? null, ms: Math.round(performance.now() - t0), sources: debug.made, ...analyse(buf, { window: true }), above150Db: rmsAbove(buf, 150) };
  } finally {
    DEV.solo = null;
  }
}
/** Every player of a mood (or only the named ones), each alone: the balance of the band, in numbers. */
async function players(mood, secs = MOOD_SECS, intensity = 1, only = null) {
  const out = [];
  for (const name of Object.keys(PIECES[mood].tracks)) {
    if (only && !only.includes(name)) continue;
    out.push({ from: PIECES[mood].tracks[name].from || 0, ...(await moodStats(mood, secs, intensity, 7, name)), shape: undefined });
  }
  return out;
}
/** RMS in dB of what is left above `hz` (two one-pole high-passes): the part small speakers can play. */
function rmsAbove(buf, hz, from = 0) {
  const L = buf.getChannelData(0),
    R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L,
    k = Math.exp((-2 * Math.PI * hz) / buf.sampleRate);
  let l1 = 0,
    l2 = 0,
    sum = 0,
    n = 0;
  for (let i = Math.floor(from * buf.sampleRate); i < L.length; i++) {
    const x = (L[i] + R[i]) * 0.5;
    l1 = l1 * k + x * (1 - k);
    const h1 = x - l1;
    l2 = l2 * k + h1 * (1 - k);
    const y = h1 - l2;
    sum += y * y;
    n++;
  }
  return r1(10 * Math.log10(sum / Math.max(1, n) + 1e-20));
}
async function ambStats(name, secs = 20) {
  const { buf } = await render(secs, (a) => a.setAmbience(AMBIENCES[name]), { raw: true, mute: ['music'] });
  return { name, ...analyse(buf, { from: 1, window: true }), above150Db: rmsAbove(buf, 150, 1), above1kDb: rmsAbove(buf, 1000, 1) };
}
/** Many of the loudest one-shots on top of each other, through the limiter. */
async function burst(n = 30, spread = 0.3) {
  const t0 = performance.now();
  const { buf, debug } = await render(7, (a) => {
    for (let i = 0; i < n; i++) a.sfx(LOUDEST[i % LOUDEST.length], { at: START + (i * spread) / n, gain: 1 });
  }, { mute: ['amb', 'music'] });
  return { name: `burst of ${n}`, n, voices: debug.voices, ms: Math.round(performance.now() - t0), ...analyse(buf) };
}
/** The worst the game can do at once: full score, a storm, furnaces, and a fight on top. */
function mixScene(a) {
  a.setMusic('opus', { intensity: 1 });
  a.setAmbience({ region: 'vale', wind: 1, rain: 1, gloom: 0.3, water: 0.5, height: 60 });
  a.loop('athanor', { param: 1 });
  a.loop('fire', { param: 1, pos: [2, 0, -2] });
  a.loop('bubble', { param: 1, pos: [-1, 0, -1] });
  a.loop('waterfall', { pos: [6, 0, 3] });
  a.loop('shade', { param: 1, pos: [-3, 0, 2] });
  for (let i = 0; i < 20; i++) a.sfx(LOUDEST[i % LOUDEST.length], { at: 5 + i * 0.04, pos: [Math.sin(i) * 5, 1, Math.cos(i) * 5] });
  a.sfx('fulminate_burst', { at: 6.5 });
  a.sfx('bell', { at: 6.6 });
}
async function mix(secs = 12) {
  const t0 = performance.now();
  const { buf, debug } = await render(secs, mixScene, {});
  return { name: 'worst-case mix', ms: Math.round(performance.now() - t0), sources: debug.made, ...analyse(buf, { window: true }) };
}
/** Gain of the master chain for a quiet signal: should be the ceiling and nothing else. */
async function chain() {
  const set = (a) => a.sfx('pickup', { gain: 0.02, at: START });
  const energy = (buf) => {
    let s = 0;
    for (const v of buf.getChannelData(0)) s += v * v;
    return s;
  };
  const raw = energy((await render(2, set, { raw: true, mute: ['amb', 'music', 'reverb'] })).buf);
  const full = energy((await render(2, set, { mute: ['amb', 'music', 'reverb'] })).buf);
  return { rawDb: r1(10 * Math.log10(raw)), gainDb: r1(10 * Math.log10(full / raw)), expectedDb: r1(dB(MASTER.CEILING)) };
}
/** What the compressor node adds on its own to a signal far below its threshold. */
async function makeup() {
  const ctx = new OfflineAudioContext(1, SR, SR);
  const osc = ctx.createOscillator(),
    g = ctx.createGain(),
    c = ctx.createDynamicsCompressor();
  osc.frequency.value = 1000;
  g.gain.value = 0.01;
  for (const k of Object.keys(MASTER.COMP)) c[k].value = MASTER.COMP[k];
  osc.connect(g).connect(c).connect(ctx.destination);
  osc.start();
  const d = (await ctx.startRendering()).getChannelData(0);
  let s = 0;
  for (let i = SR / 2; i < SR; i++) s += d[i] * d[i];
  const measured = Math.sqrt(s / (SR / 2)) / (0.01 / Math.SQRT2);
  return { measured: r3(measured), used: MASTER.COMP_MAKEUP };
}
/** Energy of the reverb against the dry sound, for a send of 1. */
async function reverb() {
  const set = (a) => a.sfx('shatter');
  const energy = (buf) => {
    let s = 0;
    for (let c = 0; c < 2; c++) for (const v of buf.getChannelData(c)) s += v * v;
    return s;
  };
  const dry = energy((await render(8, set, DRY)).buf);
  const both = energy((await render(8, set, { raw: true, mute: ['amb', 'music'] })).buf);
  const send = SFX.shatter.wet;
  return { send, wetDb: r1(10 * Math.log10(Math.max(1e-12, both - dry) / dry)), atSendOneDb: r1(10 * Math.log10(Math.max(1e-12, both - dry) / dry / (send * send))) };
}
/** What setPaused(true) does to the mix: the score and the world step back, the interface does not. */
async function pause() {
  const scene = (a) => {
    a.setMusic('title', { intensity: 0.7 });
    a.setAmbience(AMBIENCES.shore_day);
    a.loop('fire', { param: 0.8 });
  };
  const click = (a) => a.sfx('ui_click', { at: START });
  const run = async (set, paused, secs, from, mute) => analyse((await render(secs, (a) => {
    a.setPaused(paused);
    set(a);
  }, { raw: true, mute })).buf, { from, window: true });
  const world = await run(scene, false, 12, 2),
    worldPaused = await run(scene, true, 12, 2),
    ui = await run(click, false, 1.5, 0, ['amb', 'music']),
    uiPaused = await run(click, true, 1.5, 0, ['amb', 'music']);
  return { worldDb: world.rmsDb, worldPausedDb: worldPaused.rmsDb, centroid: world.centroid, centroidPaused: worldPaused.centroid, uiDb: ui.peakDb, uiPausedDb: uiPaused.peakDb };
}
/** Level in dB of one channel of a render between two times. */
function chanDb(buf, ch, from, to) {
  const d = buf.getChannelData(ch);
  const i0 = Math.floor(from * buf.sampleRate),
    i1 = Math.min(d.length, Math.ceil(to * buf.sampleRate));
  let s = 0;
  for (let i = i0; i < i1; i++) s += d[i] * d[i];
  return 10 * Math.log10(s / Math.max(1, i1 - i0) + 1e-20);
}
/**
 * Is a sound where it should be? A steady loop heard from every side and from farther and farther
 * away, then the listener turns once around on the spot: the sound must cross from ear to ear
 * without a step, and moving the listener must cost next to nothing.
 */
async function placing() {
  const name = 'waterfall'; // steady and broad; reference distance 10 m
  const lr = async (lis, pos) => {
    const { buf } = await render(3, (a) => {
      a.setListener(...lis);
      a.loop(name, { pos });
    }, DRY);
    const l = chanDb(buf, 0, 1.5, 3),
      r = chanDb(buf, 1, 1.5, 3);
    return { l: r1(l), r: r1(r), side: r1(r - l), both: r1(10 * Math.log10((10 ** (l / 10) + 10 ** (r / 10)) / 2)) };
  };
  const north = [0, 0, 0, 0, 0, -1],
    east = [0, 0, 0, 1, 0, 0];
  const out = {
    name,
    right: await lr(north, [40, 0, 0]),
    left: await lr(north, [-40, 0, 0]),
    front: await lr(north, [0, 0, -40]),
    behind: await lr(north, [0, 0, 40]),
    above: await lr(north, [0, 40, 0]),
    nearRight: await lr(north, [10, 0, 0]), // at its reference distance a source is wide
    atHand: await lr(north, [0.2, 0, 0]),
    turnedRight: await lr(east, [0, 0, 40]), // facing +x, the right hand points to +z
    turnedLeft: await lr(east, [0, 0, -40]),
    moved: await lr([100, 5, -40, 0, 0, -1], [140, 5, -40]),
    at10: await lr(north, [0, 0, -10]),
    at20: await lr(north, [0, 0, -20]),
    at40: await lr(north, [0, 0, -40]),
    outOfEarshot: await lr(north, [0, 0, -400]),
  };
  // one turn on the spot in four seconds, the listener set every 16 ms as a game does
  const SECS = 6,
    FRAME = 768 / SR;
  const turn = async (moving, n) => {
    const ctx = new OfflineAudioContext(2, SECS * SR, SR);
    const a = createAudio({ context: ctx, seed: 7, mute: ['amb', 'music', 'reverb'], bypassLimiter: true });
    a.setVolumes({ master: 1, music: 1, sfx: 1 });
    a.setListener(0, 0, 0, 0, 0, -1);
    a.loop(name, { pos: [40, 0, 0] });
    for (let i = 1; i < n; i++) a.loop(['fire', 'bubble', 'river', 'lava', 'vent', 'levity', 'stir'][i % 7], { pos: [Math.cos(i) * 6, 0, Math.sin(i) * 6], param: 0.6 });
    a.advance(SECS);
    // the render stops at every frame either way, so that only the moving itself is compared
    for (let k = 1; k * FRAME < SECS; k++) {
      const t = k * FRAME;
      ctx.suspend(t).then(() => {
        const ang = moving ? (Math.min(Math.max(t - 1, 0), 4) / 4) * 2 * Math.PI : 0; // clockwise seen from above
        a.setListener(0, 0, 0, Math.sin(ang), 0, -Math.cos(ang));
        ctx.resume();
      });
    }
    const t0 = performance.now();
    const buf = await ctx.startRendering();
    return { buf, ms: performance.now() - t0 };
  };
  const one = await turn(true, 1);
  const trace = [];
  for (let t = 1; t + 0.05 <= 5; t += 0.05) trace.push(chanDb(one.buf, 1, t, t + 0.05) - chanDb(one.buf, 0, t, t + 0.05));
  let jump = 0;
  for (let i = 1; i < trace.length; i++) jump = Math.max(jump, Math.abs(trace[i] - trace[i - 1]));
  out.turn = { start: r1(trace[0]), quarter: r1(trace[20]), half: r1(trace[40]), threeQuarters: r1(trace[60]), end: r1(trace[trace.length - 1]), min: r1(Math.min(...trace)), max: r1(Math.max(...trace)), jump: r1(jump) };
  // what the moving costs: fourteen loops, the listener still and turning
  const still = [],
    moving = [];
  for (let k = 0; k < 4; k++) {
    still.push((await turn(false, 14)).ms);
    moving.push((await turn(true, 14)).ms);
  }
  out.cost = { loops: 14, stillMs: Math.round(Math.min(...still)), movingMs: Math.round(Math.min(...moving)), extraShare: r3((Math.min(...moving) - Math.min(...still)) / (SECS * 1000)) };
  return out;
}
/** A long stretch of one mood: the level every five seconds, to see the strains come and go. */
async function long(mood, secs = 600, intensity = 0.6, seed = 11) {
  const t0 = performance.now();
  // scheduled the way the game does it, a little ahead of the clock, so that the graph stays small
  const AHEAD = 4;
  const ctx = new OfflineAudioContext(2, Math.ceil(secs * SR), SR);
  const a = createAudio({ context: ctx, seed, mute: ['amb'], bypassLimiter: true });
  a.setVolumes({ master: 1, music: 1, sfx: 1 });
  a.setMusic(mood, { intensity });
  a.advance(AHEAD + 2);
  for (let t = AHEAD; t < secs; t += AHEAD) {
    ctx.suspend(t).then(() => {
      a.advance(t + AHEAD + 2);
      ctx.resume();
    });
  }
  const buf = await ctx.startRendering();
  const debug = a.debug();
  const L = buf.getChannelData(0),
    R = buf.getChannelData(1);
  const win = 5 * SR;
  const trace = [];
  let peak = 0,
    nan = 0,
    power = 0;
  for (let i0 = 0; i0 + win <= L.length; i0 += win) {
    let p = 0;
    for (let i = i0; i < i0 + win; i++) {
      const l = L[i],
        r = R[i];
      if (!Number.isFinite(l) || !Number.isFinite(r)) {
        nan++;
        continue;
      }
      const m = Math.max(Math.abs(l), Math.abs(r));
      if (m > peak) peak = m;
      p += (l * l + r * r) * 0.5;
    }
    power += p;
    trace.push(r1(dB(Math.sqrt(p / win))));
  }
  const st = { peakDb: r1(dB(peak)), rmsDb: r1(dB(Math.sqrt(power / Math.max(1, trace.length * win)))), nan };
  const sorted = [...trace].sort((a, b) => a - b);
  return {
    name: mood, secs, ms: Math.round(performance.now() - t0), sources: debug.made, peakDb: st.peakDb, rmsDb: st.rmsDb, nan: st.nan,
    medianDb: sorted[sorted.length >> 1],
    quietShare: r3(trace.filter((v) => v < sorted[sorted.length - 1] - 12).length / trace.length),
    // how far the fuller stretches stand above the thinner ones: the tenth of the time that is loudest against the tenth that is quietest
    spanDb: r1(sorted[Math.floor(sorted.length * 0.9)] - sorted[Math.floor(sorted.length * 0.1)]),
    firstHalfDb: r1(trace.slice(0, trace.length >> 1).reduce((a, b) => a + b, 0) / (trace.length >> 1)),
    secondHalfDb: r1(trace.slice(trace.length >> 1).reduce((a, b) => a + b, 0) / (trace.length - (trace.length >> 1))),
    trace,
  };
}

/** Render something the way it is heard. kind: sfx | loop | mood | amb | burst | mix */
async function heard(kind, name, o = {}) {
  if (kind === 'sfx') {
    const probe = createAudio({ context: new OfflineAudioContext(2, 8, SR), seed: o.seed ?? 7 });
    trigger(probe, name);
    const secs = Math.min(18, probe.debug().lastDur + START + 3);
    return (await render(secs, (a) => trigger(a, name, { at: START }), { mute: ['amb', 'music'], seed: o.seed })).buf;
  }
  if (kind === 'loop') {
    // the parameter climbs from nothing to everything, then the loop is let go
    return (await render(o.secs || 9, (a) => {
      const h = a.loop(name, { param: PARAM_LOOPS.has(name) ? 0 : 0.5 });
      if (PARAM_LOOPS.has(name)) for (let i = 1; i <= 12; i++) h.set({ param: i / 12 }, 0.5 + i * 0.5);
      h.stop(1, 7.5);
    }, { mute: ['amb', 'music'] })).buf;
  }
  if (kind === 'mood') return (await render(o.secs || 60, (a) => a.setMusic(name, { intensity: o.intensity ?? 0.7 }), { mute: ['amb'], seed: o.seed, step: 4 })).buf;
  if (kind === 'amb') return (await render(o.secs || 30, (a) => a.setAmbience(AMBIENCES[name]), { mute: ['music'], seed: o.seed })).buf;
  if (kind === 'burst') return (await render(7, (a) => {
    for (let i = 0; i < 30; i++) a.sfx(LOUDEST[i % LOUDEST.length], { at: START + i * 0.01 });
  }, { mute: ['amb', 'music'] })).buf;
  if (kind === 'mix') return (await render(o.secs || 12, mixScene, {})).buf;
  throw new Error('unknown kind ' + kind);
}

// --- pictures -------------------------------------------------------------------------------------
const MAGMA = [[0, 0, 4], [28, 16, 68], [79, 18, 123], [129, 37, 129], [181, 54, 122], [229, 80, 100], [251, 135, 97], [254, 194, 135], [252, 253, 191]];
function drawSpectrogram(canvas, buf, title) {
  const W = 1200,
    H = 600,
    x0 = 56,
    y0 = 34,
    w = 1120,
    h = 400,
    wy = y0 + h + 34,
    wh = 96;
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  g.fillStyle = '#0c0d10';
  g.fillRect(0, 0, W, H);
  const sr = buf.sampleRate,
    L = buf.getChannelData(0),
    R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L,
    len = L.length;
  const m = new Float32Array(len);
  for (let i = 0; i < len; i++) m[i] = (L[i] + R[i]) * 0.5;
  const n = buf.duration > 14 ? 8192 : buf.duration > 3 ? 4096 : 2048;
  const F = fft(n),
    mag = new Float64Array(n / 2);
  const fmin = 30,
    fmax = 16000;
  const edge = new Float64Array(h + 1);
  for (let y = 0; y <= h; y++) edge[y] = (fmin * Math.pow(fmax / fmin, 1 - y / h) * n) / sr;
  const img = g.createImageData(w, h);
  for (let x = 0; x < w; x++) {
    F.mag(m, Math.floor(((x + 0.5) / w) * len) - n / 2, mag);
    for (let y = 0; y < h; y++) {
      const b0 = edge[y + 1],
        b1 = edge[y];
      let v = 0;
      if (b1 - b0 < 1) {
        const c = (b0 + b1) / 2,
          k = Math.floor(c);
        v = mag[k] * (1 - (c - k)) + mag[Math.min(n / 2 - 1, k + 1)] * (c - k);
      } else for (let k = Math.ceil(b0); k <= b1 && k < n / 2; k++) v = Math.max(v, mag[k]);
      const u = clamp((dB(v / (n / 4)) + 100) / 88, 0, 0.9999) * (MAGMA.length - 1);
      const a = MAGMA[Math.floor(u)],
        b = MAGMA[Math.floor(u) + 1],
        f = u - Math.floor(u),
        p = (y * w + x) * 4;
      img.data[p] = a[0] + (b[0] - a[0]) * f;
      img.data[p + 1] = a[1] + (b[1] - a[1]) * f;
      img.data[p + 2] = a[2] + (b[2] - a[2]) * f;
      img.data[p + 3] = 255;
    }
  }
  g.putImageData(img, x0, y0);
  g.font = '12px system-ui, sans-serif';
  g.fillStyle = '#8b8678';
  g.strokeStyle = 'rgba(255,255,255,0.12)';
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
    const y = y0 + h * (1 - Math.log(f / fmin) / Math.log(fmax / fmin));
    g.fillText(f >= 1000 ? f / 1000 + 'k' : String(f), x0 - 8, y);
    g.beginPath();
    g.moveTo(x0, y + 0.5);
    g.lineTo(x0 + w, y + 0.5);
    g.stroke();
  }
  const step = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 30, 60].find((s) => buf.duration / s <= 14) || 120;
  g.textAlign = 'center';
  g.textBaseline = 'top';
  for (let t = 0; t <= buf.duration + 1e-6; t += step) {
    const x = x0 + (t / buf.duration) * w;
    g.fillText(r1(t) + ' s', x, y0 + h + 6);
    g.beginPath();
    g.moveTo(x + 0.5, y0);
    g.lineTo(x + 0.5, y0 + h);
    g.stroke();
  }
  // wave
  g.fillStyle = '#15171c';
  g.fillRect(x0, wy, w, wh);
  g.fillStyle = '#c9a45c';
  for (let x = 0; x < w; x++) {
    const i0 = Math.floor((x / w) * len),
      i1 = Math.max(i0 + 1, Math.floor(((x + 1) / w) * len));
    let lo = 0,
      hi = 0;
    for (let i = i0; i < i1 && i < len; i++) {
      if (m[i] < lo) lo = m[i];
      if (m[i] > hi) hi = m[i];
    }
    g.fillRect(x0 + x, wy + wh / 2 - hi * (wh / 2), 1, Math.max(1, (hi - lo) * (wh / 2)));
  }
  const st = analyse(buf);
  g.fillStyle = '#d4cdbd';
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.font = '15px system-ui, sans-serif';
  g.fillText(`${title}    ${r1(buf.duration)} s    peak ${st.peakDb} dBFS    RMS ${st.rmsDb} dBFS    centroid ${st.centroid} Hz`, x0, 22);
  return st;
}
async function shot(kind, name, o = {}) {
  const buf = await heard(kind, name, o);
  const canvas = document.createElement('canvas');
  const st = drawSpectrogram(canvas, buf, `${kind}: ${name}`);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  const file = `audio_${kind}_${name}`.replace(/[^a-zA-Z0-9_]/g, '_');
  const res = await fetch('/__shot?name=' + file, { method: 'POST', body: blob });
  return { file: (await res.json()).file, ...st, shape: undefined };
}
function encodeWav(buf) {
  const ch = buf.numberOfChannels,
    n = buf.length,
    out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  out.setUint32(4, 36 + n * ch * 2, true);
  str(8, 'WAVEfmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, ch, true);
  out.setUint32(24, buf.sampleRate, true);
  out.setUint32(28, buf.sampleRate * ch * 2, true);
  out.setUint16(32, ch * 2, true);
  out.setUint16(34, 16, true);
  str(36, 'data');
  out.setUint32(40, n * ch * 2, true);
  const data = [];
  for (let c = 0; c < ch; c++) data.push(buf.getChannelData(c));
  for (let i = 0, p = 44; i < n; i++) for (let c = 0; c < ch; c++, p += 2) out.setInt16(p, Math.round(clamp(data[c][i], -1, 1) * 32767), true);
  return new Blob([out.buffer], { type: 'audio/wav' });
}
async function wav(kind, name, o = {}) {
  const file = `audio_${kind}_${name}.wav`.replace(/[^a-zA-Z0-9_.]/g, '_');
  const res = await fetch('/__save?name=' + file, { method: 'POST', body: encodeWav(await heard(kind, name, o)) });
  return (await res.json()).file;
}

// --- the real-time path ---------------------------------------------------------------------------
const errors = [];
const warnings = [];
addEventListener('error', (e) => errors.push(String(e.message || e)));
addEventListener('unhandledrejection', (e) => errors.push('rejection: ' + String(e.reason)));
const warn0 = console.warn.bind(console);
console.warn = (...a) => {
  if (a[0] === '[audio]') warnings.push(a.slice(1).map(String).join(' '));
  if (a[0] !== '[audio]' || !window.AUD_QUIET) warn0(...a);
};
const SETTLE_MS = 16000; // long enough for the last pad release and the last crossfade to end

/** Unlock a real context and lean on it: a burst, loops on and off, every mood, pause, bad names. */
async function live() {
  errors.length = warnings.length = 0;
  const a = createAudio();
  // before unlock: nothing may throw, nothing may exist
  a.sfx('bell');
  a.setMusic('title', { intensity: 0.5 });
  a.setAmbience({ region: 'vale', wind: 0.5, night: 0.6, water: 0.3, height: 20 });
  a.setListener(0, 1.7, 0, 0, 0, -1);
  a.update(0.016);
  const early = a.loop('fire', { pos: [2, 0, -3], param: 0.6 });
  const before = { unlocked: a.unlocked, context: a.context };
  const t0 = performance.now();
  a.unlock();
  const unlockMs = Math.round(performance.now() - t0);
  a.setVolumes({ master: 1, music: 1, sfx: 1 });
  let prev = performance.now();
  const seen = { live: 0, voices: 0, loops: 0, peak: 0, slowestUpdateMs: 0, updates: 0 };
  const frame = () => {
    const now = performance.now();
    a.setListener(Math.sin(now / 900) * 2, 1.7, 0, Math.sin(now / 1300), 0, -Math.cos(now / 1300));
    a.update((now - prev) / 1000);
    seen.slowestUpdateMs = Math.max(seen.slowestUpdateMs, performance.now() - now);
    prev = now;
    const d = a.debug();
    seen.live = Math.max(seen.live, d.live);
    seen.voices = Math.max(seen.voices, d.voices);
    seen.loops = Math.max(seen.loops, d.loops);
    seen.peak = Math.max(seen.peak, a.meter().peak);
    seen.updates++;
  };
  let timer = setInterval(frame, 16);
  const snap = () => {
    const d = a.debug();
    return { state: d.state, t: r1(d.time), voices: d.voices, loops: d.loops, handles: d.handles, live: d.live, made: d.made, mood: d.mood };
  };
  const log = {};
  await wait(2500);
  log.started = snap();
  // forty one-shots in half a second, all around
  for (let i = 0; i < 40; i++) setTimeout(() => a.sfx(NAMES.sfx[(i * 7) % NAMES.sfx.length], { pos: [Math.sin(i) * 12, 1, Math.cos(i * 1.7) * 12] }), i * 12);
  await wait(650);
  log.afterBurst = snap();
  // every loop on, pushed around, off again
  const hs = NAMES.loops.map((n, i) => a.loop(n, { pos: [Math.cos(i) * 5, 1, Math.sin(i) * 5], param: 0.3 }));
  hs.push(...NAMES.loops.map((n, i) => a.loop(n, { pos: [Math.cos(i) * 900, 1, 900], param: 0.3 }))); // far away: must stay virtual
  await wait(700);
  log.loopsOn = snap();
  for (let k = 0; k < 20; k++) {
    hs.forEach((h, i) => h.set({ param: k / 20, pitch: 1 + 0.01 * k, gain: 0.8, pos: [Math.cos(i + k * 0.1) * 5, 1, Math.sin(i + k * 0.1) * 5] }));
    await wait(30);
  }
  hs.forEach((h) => h.stop(0.3));
  early.stop(0.2);
  early.set({ param: 1 }); // a stopped handle must stay quiet about it
  await wait(1200);
  log.loopsOff = snap();
  // every mood in quick succession: crossfades on top of crossfades
  for (const m of NAMES.moods) {
    a.setMusic(m, { intensity: Math.random() });
    await wait(300);
  }
  a.setMusic('opus', { intensity: 1 });
  await wait(4000);
  log.inMusic = snap();
  a.setMusic('none');
  // pause: everything steps back, nothing stops, and sounds asked for meanwhile are still played
  a.setPaused(true);
  await wait(400);
  const v0 = a.debug().voices;
  a.sfx('ui_click');
  a.sfx('pickup');
  log.paused = { ...snap(), played: a.debug().voices - v0 };
  a.setPaused(false);
  await wait(400);
  log.resumed = snap();
  // a hidden page: the context stands still until the page is shown again
  const hide = (h) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    document.dispatchEvent(new Event('visibilitychange'));
  };
  hide(true);
  await wait(400);
  const v1 = a.debug().voices;
  a.sfx('bell'); // dropped: nothing is queued while the context stands still
  log.hidden = { ...snap(), played: a.debug().voices - v1 };
  hide(false);
  delete document.hidden;
  await wait(400);
  log.shown = snap();
  // the game stops calling update() (its loop is paused, a menu is open): the engine keeps time
  // by itself, so a mood asked for now still begins and a one-shot is still cleared away
  clearInterval(timer);
  await wait(400);
  const made0 = a.debug().made;
  a.setMusic('brew', { intensity: 0.8 });
  a.sfx('pickup');
  await wait(2600);
  log.unfed = { ...snap(), scheduled: a.debug().made - made0 };
  a.setMusic('none');
  prev = performance.now();
  timer = setInterval(frame, 16);
  // names nobody knows: one warning each, no sound, no throw
  a.sfx('no_such_sound');
  a.sfx('no_such_sound');
  a.loop('no_such_loop').set({ gain: 1 });
  a.setMusic('polka');
  a.footstep('lava', 2);
  a.footstep('lava', 2);
  a.setAmbience({ region: 'nowhere' });
  a.sfx('pickup', { pos: [NaN, 0, 0] });
  await wait(SETTLE_MS);
  log.settled = snap();
  clearInterval(timer);
  a.dispose();
  return { before, unlockMs, seen: { ...seen, peak: r3(seen.peak), slowestUpdateMs: r1(seen.slowestUpdateMs) }, log, warnings: [...warnings], errors: [...errors] };
}

/**
 * A long real-time session, the game as played but busier: a new place, mood, weather and set of
 * loops every twelve seconds, footsteps and one-shots all the time. Looks for anything that only
 * ever grows: sources, movements, the time update() takes, memory.
 */
async function soak(seconds = 180) {
  errors.length = warnings.length = 0;
  const a = createAudio();
  a.unlock();
  a.setVolumes({ master: 1, music: 1, sfx: 1 });
  const moods = NAMES.moods.filter((m) => m !== 'none');
  const heap = () => (performance.memory ? r1(performance.memory.usedJSHeapSize / 1048576) : null);
  const snap = (el) => {
    const d = a.debug();
    return { t: Math.round(el), state: d.state, live: d.live, voices: d.voices, loops: d.loops, dying: d.dying, sways: d.sways, heapMb: heap() };
  };
  const seen = { slowestUpdateMs: 0, totalUpdateMs: 0, updates: 0, slowestCallsMs: 0, peak: 0, voices: 0, loops: 0, live: 0 };
  const samples = [];
  const slow = []; // the five longest update() calls: when, how long, and whether a scene had just changed
  let loops = [];
  let prev = performance.now(),
    scene = -1,
    nextStep = 0,
    nextFx = 0,
    nextSample = 5,
    running = false;
  let t0 = prev;
  const tick = () => {
    const now = performance.now(),
      el = (now - t0) / 1000,
      ang = el * 0.2,
      px = Math.cos(ang) * 20,
      pz = Math.sin(ang) * 20;
    let changed = false;
    a.setListener(px, 1.7, pz, -Math.sin(ang), 0, Math.cos(ang));
    if (running) {
      const sc = Math.floor(el / 12);
      if (sc !== scene) {
        scene = sc;
        changed = true;
        a.setMusic(moods[sc % moods.length], { intensity: Math.random() });
        a.setAmbience({ region: NAMES.regions[sc % NAMES.regions.length], night: Math.random(), wind: Math.random(), rain: sc % 3 === 0 ? Math.random() : 0, gloom: sc % 4 === 3 ? Math.random() : 0, water: Math.random(), height: Math.random() * 100 });
        loops.forEach((h) => h.stop(0.5));
        loops = [0, 1, 2, 3, 4].map((i) => a.loop(NAMES.loops[(sc * 5 + i) % NAMES.loops.length], { pos: [px + Math.cos(i * 1.3) * (3 + i * 4), 1, pz + Math.sin(i * 1.3) * (3 + i * 4)], param: Math.random() }));
        for (let i = 0; i < 6; i++) a.sfx(LOUDEST[(sc + i) % LOUDEST.length], { pos: [px + (Math.random() - 0.5) * 30, 1, pz + (Math.random() - 0.5) * 30] });
      }
      if (el >= nextStep) {
        nextStep = el + 0.42;
        a.footstep(NAMES.surfaces[sc % NAMES.surfaces.length], 0.6);
      }
      if (el >= nextFx) {
        nextFx = el + 0.3 + Math.random() * 0.9;
        a.sfx(NAMES.sfx[Math.floor(Math.random() * NAMES.sfx.length)], Math.random() < 0.7 ? { pos: [px + (Math.random() - 0.5) * 80, 1, pz + (Math.random() - 0.5) * 80] } : {});
      }
      loops.forEach((h, i) => h.set({ param: 0.5 + 0.5 * Math.sin(el * 0.7 + i), gain: 0.6 + 0.4 * Math.sin(el * 0.3 + i) }));
    }
    const u0 = performance.now();
    seen.slowestCallsMs = Math.max(seen.slowestCallsMs, u0 - now); // everything the game asked for this frame
    a.update((now - prev) / 1000);
    const cost = performance.now() - u0;
    prev = now;
    seen.slowestUpdateMs = Math.max(seen.slowestUpdateMs, cost);
    seen.totalUpdateMs += cost;
    seen.updates++;
    if (slow.length < 5 || cost > slow[slow.length - 1].ms) {
      slow.push({ t: r1(el), ms: r1(cost), scene: changed, mood: a.debug().mood });
      slow.sort((x, y) => y.ms - x.ms);
      slow.length = Math.min(slow.length, 5);
    }
    const d = a.debug();
    seen.live = Math.max(seen.live, d.live);
    seen.voices = Math.max(seen.voices, d.voices);
    seen.loops = Math.max(seen.loops, d.loops);
    seen.peak = Math.max(seen.peak, a.meter().peak);
    if (running && el >= nextSample) {
      nextSample += 5;
      samples.push(snap(el));
    }
  };
  const timer = setInterval(tick, 16);
  // the beds alone, before anything is asked for: what must be left when everything has stopped
  await wait(2500);
  const base = snap(0);
  t0 = prev = performance.now();
  running = true;
  await wait(seconds * 1000);
  running = false;
  loops.forEach((h) => h.stop(0.5));
  a.setMusic('none');
  a.setAmbience({ region: 'vale', night: 0, wind: 0.3, rain: 0, gloom: 0, water: 0, height: 20 });
  await wait(SETTLE_MS);
  const settled = snap(seconds);
  clearInterval(timer);
  a.dispose();
  const third = Math.max(1, Math.floor(samples.length / 3));
  const mean = (list, k) => r1(list.reduce((s, x) => s + x[k], 0) / Math.max(1, list.length));
  return {
    seconds, base, settled, samples, slow,
    seen: { ...seen, peak: r3(seen.peak), slowestUpdateMs: r1(seen.slowestUpdateMs), slowestCallsMs: r1(seen.slowestCallsMs), meanUpdateMs: r3(seen.totalUpdateMs / Math.max(1, seen.updates)), totalUpdateMs: undefined },
    liveFirst: mean(samples.slice(0, third), 'live'),
    liveLast: mean(samples.slice(-third), 'live'),
    swaysFirst: mean(samples.slice(0, third), 'sways'),
    swaysLast: mean(samples.slice(-third), 'sways'),
    warnings: [...warnings],
    errors: [...errors],
  };
}

window.AUD = { NAMES, AMBIENCES, SFX_DB, LOOP_DB, MOOD_DB, MOOD_SECS, MASTER, render, analyse, sfxStats, loopStats, moodStats, players, ambStats, burst, mix, chain, makeup, reverb, pause, placing, long, heard, shot, wav, live, soak, errors, warnings };

// --- the board ------------------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};
const audio = createAudio();
window.audio = audio;
addEventListener('pointerdown', () => audio.unlock(), true);

function slider(parent, label, min, max, step, value, onInput, fmt = (v) => v.toFixed(2)) {
  const out = el('output', { textContent: fmt(value) });
  const input = el('input', { type: 'range', min, max, step, value });
  input.addEventListener('input', () => {
    out.textContent = fmt(+input.value);
    onInput(+input.value);
  });
  parent.append(el('label', { className: 'row' }, label, input, out));
  return input;
}

// volumes
const vols = { master: 0.8, music: 0.7, sfx: 0.9 };
for (const k of Object.keys(vols)) slider($('volumes'), k, 0, 1, 0.01, vols[k], (v) => audio.setVolumes({ [k]: v }));

// one-shots
const GROUPS = {
  Interface: 'ui_hover ui_click ui_open ui_close page toast discover quest',
  Hands: 'pickup pickup_rare grab throw drop_in cork bottle_fill drink bellows',
  Flasks: 'shatter ember_burst rime_burst verdance_burst fulminate_burst levity_burst spire_rise spire_crumble',
  Body: 'jump land splash hurt heal death respawn',
  'The Work': 'brew_ready brew_fail opus_stage stone_form prime_get',
  World: 'ignite extinguish briar_burn vine_grow rock_crack rock_break ice_form ice_crack steam impact_soft impact_hard lid_slide',
  'Shades and lanterns': 'shade_hit shade_die lantern_lit gloom_lift travel shrine_open',
  'Far off': 'bell crow',
};
const where = () => {
  if (!$('spatial').checked) return undefined;
  const d = +$('dist').value,
    b = (+$('bearing').value * Math.PI) / 180;
  return [Math.sin(b) * d, 0, -Math.cos(b) * d];
};
const play = (name) => audio.sfx(name, { pos: where(), gain: +$('gain').value, pitch: +$('pitch').value });
const grouped = new Set();
for (const [title, list] of Object.entries(GROUPS)) {
  const row = el('div');
  for (const n of list.split(' ')) {
    if (!NAMES.sfx.includes(n)) continue;
    grouped.add(n);
    row.append(el('button', { textContent: n, onclick: () => play(n) }));
  }
  $('sfx').append(el('h3', { textContent: title }), row);
}
const rest = NAMES.sfx.filter((n) => !grouped.has(n));
if (rest.length) $('sfx').append(el('h3', { textContent: 'Other' }), el('div', {}, ...rest.map((n) => el('button', { textContent: n, onclick: () => play(n) }))));
$('dist').oninput = () => ($('distOut').textContent = $('dist').value + ' m');
$('bearing').oninput = () => ($('bearingOut').textContent = $('bearing').value + '°');

// footsteps
let surface = 'grass';
let walking = null;
for (const s of NAMES.surfaces) {
  $('steps').append(el('button', {
    textContent: s,
    onclick: () => {
      surface = s;
      audio.footstep(s, +$('speed').value);
    },
  }));
}
$('walk').onclick = () => {
  $('walk').classList.toggle('on');
  if (walking) return (walking = clearTimeout(walking) || null);
  const stepOn = () => {
    const sp = +$('speed').value;
    audio.footstep(surface, sp);
    walking = setTimeout(stepOn, 620 - 320 * sp);
  };
  stepOn();
};

// loops
for (const [i, name] of NAMES.loops.entries()) {
  let h = null;
  const param = el('input', { type: 'range', min: 0, max: 1, step: 0.01, value: 0.5 }),
    gain = el('input', { type: 'range', min: 0, max: 2, step: 0.01, value: 1 }),
    dist = el('input', { type: 'range', min: 0, max: 140, step: 0.5, value: 3 });
  const pos = () => {
    const b = i * 0.9 - 2;
    return +dist.value === 0 ? undefined : [Math.sin(b) * +dist.value, 0, -Math.cos(b) * +dist.value];
  };
  const btn = el('button', {
    textContent: name,
    onclick: () => {
      btn.classList.toggle('on');
      if (h) h = h.stop(0.5) || null;
      else h = audio.loop(name, { pos: pos(), gain: +gain.value, param: +param.value });
    },
  });
  param.oninput = () => h && h.set({ param: +param.value });
  gain.oninput = () => h && h.set({ gain: +gain.value });
  dist.oninput = () => h && pos() && h.set({ pos: pos() });
  $('loops').append(el('div', { className: 'loop' }, btn, el('label', {}, 'param', param), el('label', {}, 'gain', gain), el('label', {}, 'dist', dist)));
}

// ambience
const amb = { region: 'vale', night: 0, wind: 0.3, rain: 0, gloom: 0, water: 0, height: 20 };
for (const r of NAMES.regions) $('region').append(el('option', { value: r, textContent: r, selected: r === amb.region }));
$('region').onchange = () => audio.setAmbience({ region: (amb.region = $('region').value) });
for (const k of ['night', 'wind', 'rain', 'gloom', 'water']) slider($('ambience'), k, 0, 1, 0.01, amb[k], (v) => audio.setAmbience({ [k]: (amb[k] = v) }));
slider($('ambience'), 'height (m)', 0, 120, 1, amb.height, (v) => audio.setAmbience({ height: (amb.height = v) }), (v) => v.toFixed(0));
audio.setAmbience(amb);

// music
let mood = 'none';
const moodButtons = NAMES.moods.map((m) => el('button', {
  textContent: m,
  className: m === mood ? 'on' : '',
  onclick: () => {
    mood = m;
    moodButtons.forEach((b) => b.classList.toggle('on', b.textContent === m));
    audio.setMusic(m, { intensity: +$('intensity').value });
  },
}));
$('moods').append(...moodButtons);
$('intensity').oninput = () => {
  $('intensityOut').textContent = (+$('intensity').value).toFixed(2);
  audio.setMusic(mood, { intensity: +$('intensity').value });
};

// transport
$('start').onclick = () => audio.unlock();
let paused = false;
$('pause').onclick = () => {
  paused = !paused;
  $('pause').classList.toggle('on', paused);
  audio.setPaused(paused);
};
$('burst').onclick = () => {
  for (let i = 0; i < 40; i++) setTimeout(() => audio.sfx(NAMES.sfx[(i * 7) % NAMES.sfx.length], { pos: [Math.sin(i) * 10, 1, Math.cos(i * 1.7) * 10] }), i * 12);
};
// the listener stands at the origin facing north; "Turn around" turns it clockwise, once in ten seconds
let turning = false,
  heading = 0;
$('turn').onclick = () => {
  turning = !turning;
  $('turn').classList.toggle('on', turning);
};
let last = performance.now();
let hold = 0;
function frame(now) {
  if (turning) {
    heading += ((now - last) / 1000) * ((2 * Math.PI) / 10);
    audio.setListener(0, 0, 0, Math.sin(heading), 0, -Math.cos(heading));
  }
  audio.update((now - last) / 1000);
  last = now;
  const d = audio.debug();
  if (d.unlocked) {
    const m = audio.meter();
    hold = Math.max(m.peak, hold * 0.94);
    $('status').textContent = `${d.state}   t ${d.time.toFixed(1)}   voices ${d.voices}   loops ${d.loops}/${d.handles}   sources ${d.live}   mood ${d.mood}   peak ${dB(hold).toFixed(1)} dBFS`;
    $('meter').firstElementChild.style.width = clamp((dB(hold) + 60) / 60, 0, 1) * 100 + '%';
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// bench
const picks = [...NAMES.sfx.map((n) => ['sfx', n]), ...NAMES.surfaces.map((s) => ['sfx', 'step_' + s]), ...NAMES.loops.map((n) => ['loop', n]), ...NAMES.moods.filter((m) => m !== 'none').map((n) => ['mood', n]), ...Object.keys(AMBIENCES).map((n) => ['amb', n]), ['burst', 'thirty'], ['mix', 'worst']];
for (const [k, n] of picks) $('benchPick').append(el('option', { value: k + ':' + n, textContent: k + ': ' + n }));
let benchBuf = null;
$('benchRender').onclick = async () => {
  const [k, n] = $('benchPick').value.split(':');
  $('benchOut').textContent = 'rendering...';
  benchBuf = await heard(k, n);
  const st = drawSpectrogram($('spec'), benchBuf, `${k}: ${n}`);
  $('benchOut').textContent = JSON.stringify({ ...st, shape: undefined });
};
$('benchWav').onclick = async () => {
  if (!benchBuf) await $('benchRender').onclick();
  const a = el('a', { href: URL.createObjectURL(encodeWav(benchBuf)), download: $('benchPick').value.replace(':', '_') + '.wav' });
  a.click();
};

window.AUD.ready = true;
