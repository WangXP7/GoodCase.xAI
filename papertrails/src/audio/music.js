// Calm felt-piano background: a composed 16-bar piece (C major, flowing left hand, singing right hand) played with
// small per-cycle variations. The note sequence is deterministic.
// Voice: each pitch is synthesised once in JS as a sample (inharmonic partials, two detuned strings per partial that
// beat slowly, two-stage decay, higher partials die faster, soft hammer thump), then played through a velocity
// dependent low-pass, a pitch-based pan and a dark hall reverb.
import { CONFIG } from '../core/config.js';

const BEATS = 4;
// left hand per bar: [bass, t1, t2, t3] (MIDI)
const LEFT = [
  [36, 43, 52, 55], [35, 43, 50, 55], [33, 40, 48, 52], [29, 41, 45, 52],
  [29, 36, 45, 48], [40, 48, 52, 55], [38, 45, 53, 57], [31, 38, 48, 50],
  [33, 40, 48, 52], [31, 40, 47, 52], [29, 36, 45, 48], [28, 40, 48, 55],
  [38, 45, 50, 53], [36, 45, 48, 52], [29, 41, 45, 52], [31, 38, 47, 50],
];
// right hand per bar: [beat, midi, velocity scale]
const RIGHT = [
  [[0, 76, 1], [2, 79, 0.85]],
  [[0, 74, 0.95], [3, 71, 0.7]],
  [[0, 72, 0.95], [2, 76, 0.85]],
  [[0, 69, 0.9], [3, 72, 0.65]],
  [[0, 69, 0.8], [1, 72, 0.85], [2, 77, 1]],
  [[0, 76, 0.95], [2.5, 67, 0.65]],
  [[0, 77, 0.95], [1.5, 76, 0.8], [2, 74, 0.85]],
  [[0, 74, 0.85], [2, 71, 0.7]],
  [[0, 72, 0.85], [1, 76, 0.9], [2, 81, 1]],
  [[0, 79, 0.95], [2, 76, 0.8], [3, 74, 0.75]],
  [[0, 72, 0.9], [2, 69, 0.75]],
  [[0, 67, 0.75], [2, 72, 0.85], [3, 76, 0.9]],
  [[0, 77, 1], [2, 74, 0.8]],
  [[0, 76, 0.9], [2, 72, 0.75]],
  [[0, 69, 0.8], [1.5, 72, 0.8], [3, 74, 0.85]],
  [[0, 74, 0.8]],
];
const LEFT_BEATS = [0, 0.5, 1, 1.5, 2.5, 3.5];
const LEFT_IDX = [0, 1, 2, 3, 2, 1];
const NOTE_SR = 24000;

function hash(a, b) {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Notes of one bar: [{ beat, midi, vel }] */
function barNotes(bar) {
  const i = ((bar % 16) + 16) % 16;
  const cycle = Math.floor(bar / 16);
  const r = (k) => hash(bar, k);
  const out = [];
  const lh = LEFT[i];
  const sparse = cycle % 3 === 2; // every third time through: the left hand thins out
  for (let k = 0; k < LEFT_BEATS.length; k++) {
    if (k > 0 && sparse && k % 2 === 1) continue;
    if (k >= 4 && r(k) < 0.3) continue;
    const vel = (k === 0 ? 0.3 : 0.15 + 0.03 * (k === 2)) * (0.9 + r(10 + k) * 0.2);
    out.push({ beat: LEFT_BEATS[k] + (k ? (r(20 + k) - 0.5) * 0.035 : 0), midi: lh[LEFT_IDX[k]], vel });
  }
  // right hand: first time through as written, then alternately an octave lower / with a few notes left out
  const low = cycle % 2 === 1;
  for (let k = 0; k < RIGHT[i].length; k++) {
    const [b, m, v] = RIGHT[i][k];
    if (cycle > 0 && k > 0 && r(40 + k) < 0.22) continue;
    out.push({ beat: b + 0.015 + (r(50 + k) - 0.5) * 0.04, midi: m - 12, vel: (low ? 0.2 : 0.24) * v * (0.9 + r(60 + k) * 0.2) });
  }
  // a soft octave bell on the last bar of each section
  return out;
}

/** One piano note as mono samples at NOTE_SR, peak-normalised. */
function synthNote(midi) {
  const sr = NOTE_SR;
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  const dur = Math.max(3.2, Math.min(7.5, 7.5 - (midi - 36) * 0.075));
  const n = Math.floor(sr * dur);
  const out = new Float32Array(n);
  const B = 0.00008 * Math.pow(2, (midi - 40) / 12); // string stiffness: partials stretch sharp
  const d0 = 0.55 + Math.max(0, midi - 40) * 0.022; // slow decay rate (1/s), higher notes die sooner
  const maxK = Math.max(2, Math.min(12, Math.floor(2800 / f)));
  for (let k = 1; k <= maxK; k++) {
    const fk = f * k * Math.sqrt(1 + B * k * k);
    if (fk > sr * 0.45) break;
    // felt hammer: steep roll-off; struck at ~1/8 of the string (weak 8th partial)
    const amp = Math.pow(k, -2.4) * Math.abs(Math.sin((Math.PI * k) / 8.3)) / Math.abs(Math.sin(Math.PI / 8.3));
    const dk = d0 * (1 + 0.42 * (k - 1));
    const rFast = Math.exp((-dk * 3.2) / sr);
    const rSlow = Math.exp((-dk * 0.7) / sr);
    for (let s = 0; s < 2; s++) {
      const cents = (s ? 1 : -1) * (0.5 + 0.12 * k);
      const w = (2 * Math.PI * fk * Math.pow(2, cents / 1200)) / sr;
      const c2 = 2 * Math.cos(w);
      const ph = hash(midi, k * 2 + s) * 6.283;
      let y1 = Math.sin(ph - w);
      let y2 = Math.sin(ph - 2 * w);
      let eF = 0.6 * amp * 0.5;
      let eS = 0.4 * amp * 0.5;
      for (let i = 0; i < n; i++) {
        const y = c2 * y1 - y2;
        y2 = y1; y1 = y;
        out[i] += y * (eF + eS);
        eF *= rFast; eS *= rSlow;
      }
    }
  }
  // soft hammer thump (low-passed noise, ~25 ms) + attack + release fade
  let seed = (midi * 2654435761) >>> 0;
  let lp = 0;
  const thump = 0.025 * Math.min(1, 200 / f + 0.3);
  const att = Math.floor(sr * 0.006);
  const rel = Math.floor(sr * 0.5);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    if (i < sr * 0.04) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      lp += ((seed / 2147483648 - 1) - lp) * 0.12;
      out[i] += lp * thump * Math.exp(-i / (sr * 0.008));
    }
    if (i < att) out[i] *= i / att;
    if (i > n - rel) out[i] *= (n - i) / rel;
    const a = Math.abs(out[i]);
    if (a > peak) peak = a;
  }
  const g = 1 / (peak || 1);
  for (let i = 0; i < n; i++) out[i] *= g;
  return out;
}

const ALL_NOTES = (() => {
  const s = new Set();
  for (const l of LEFT) for (const m of l) s.add(m);
  for (const b of RIGHT) for (const [, m] of b) { s.add(m); s.add(m - 12); }
  s.add(79); s.add(83);
  return [...s].sort((a, b) => a - b);
})();
const sampleCache = new Map(); // midi -> Float32Array
const samples = (midi) => { let d = sampleCache.get(midi); if (!d) { d = synthNote(midi); sampleCache.set(midi, d); } return d; };

function makeReverb(ctx) {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * 4);
  const buf = ctx.createBuffer(2, n, sr);
  let s = 12345;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2147483648 - 1);
  const pre = Math.floor(sr * 0.022);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      lp += (rnd() - lp) * (0.03 + 0.12 * Math.exp(-t * 2.2)); // the tail gets darker
      d[i] = lp * Math.exp(-t * 1.7) * Math.min(1, t / 0.03);
    }
  }
  return buf;
}

function buildBus(ctx) {
  const M = CONFIG.audio.music;
  const out = ctx.createGain();
  out.gain.value = 0;
  out.connect(ctx.destination);
  const dry = ctx.createGain();
  dry.connect(out);
  const conv = ctx.createConvolver();
  conv.buffer = makeReverb(ctx);
  const wet = ctx.createGain();
  wet.gain.value = M.reverb;
  dry.connect(conv); conv.connect(wet); wet.connect(out);
  return { out, dry, buffers: new Map() };
}

function bufferFor(ctx, bus, midi) {
  let b = bus.buffers.get(midi);
  if (!b) {
    const d = samples(midi);
    b = ctx.createBuffer(1, d.length, NOTE_SR);
    b.getChannelData(0).set(d);
    bus.buffers.set(midi, b);
  }
  return b;
}

function playNote(ctx, bus, t, midi, vel) {
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  const src = ctx.createBufferSource();
  src.buffer = bufferFor(ctx, bus, midi);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.Q.value = 0.5;
  lp.frequency.value = Math.max(350, Math.min(1900, f * (1.3 + vel * 5))); // softer = darker
  const g = ctx.createGain();
  g.gain.value = vel;
  src.connect(lp); lp.connect(g);
  if (ctx.createStereoPanner) {
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-0.45, Math.min(0.45, (midi - 60) / 55));
    g.connect(pan); pan.connect(bus.dry);
  } else g.connect(bus.dry);
  src.start(t);
}

/** Schedule every note whose onset lies in [t0, t1) (music time = ctx time - origin). */
function schedule(ctx, bus, origin, t0, t1) {
  const beat = 60 / CONFIG.audio.music.bpm;
  const barLen = beat * BEATS;
  const b0 = Math.max(0, Math.floor((t0 - 0.2) / barLen) - 1);
  const b1 = Math.floor(t1 / barLen);
  for (let bar = b0; bar <= b1; bar++) {
    // a breath at the end of each 8-bar phrase: the last beats stretch a little
    const i = bar % 8;
    for (const n of barNotes(bar)) {
      const rub = i === 7 && n.beat > 1.9 ? (n.beat - 1.9) * 0.05 : 0;
      const t = bar * barLen + (n.beat + rub) * beat + 0.1;
      if (t >= t0 && t < t1) playNote(ctx, bus, origin + t, n.midi, n.vel);
    }
  }
}

export function createMusic({ audio }) {
  const M = CONFIG.audio.music;
  let ctx = null;
  let bus = null;
  let origin = 0;
  let done = 0;
  let on = M.gain > 0;
  let warm = 0; // notes synthesised so far (a few per tick, so the frame rate never hitches)

  function level() {
    if (!bus) return;
    const t = ctx.currentTime;
    bus.out.gain.cancelScheduledValues(t);
    bus.out.gain.setTargetAtTime(on && !audio.muted ? M.gain : 0, t, on ? M.fadeIn / 3 : 0.25);
  }
  function tick() {
    if (warm < ALL_NOTES.length) { samples(ALL_NOTES[warm++]); return; }
    const c = audio.context;
    if (!c || c.state !== 'running') return;
    if (!bus) { ctx = c; bus = buildBus(ctx); origin = ctx.currentTime + 0.3; done = 0; level(); }
    if (!on) { done = Math.max(done, ctx.currentTime - origin); return; }
    const until = ctx.currentTime - origin + 1.2;
    if (until > done) { schedule(ctx, bus, origin, done, until); done = until; }
  }
  const timer = setInterval(tick, 60);
  // ---- chime (gameplay feedback): one quiet note of the same felt piano, taken from the chord of the bar that is
  // sounding, so it always harmonises. Goes through the music bus: M / mute silence it. Only pitches that are
  // already synthesised are used (no hitch); before the audio context exists it does nothing.
  const CHIME = {
    scrap: { lo: 76, hi: 84, vel: 0.15, notes: 1 }, // single high soft note
    lantern: { lo: 43, hi: 57, vel: 0.2, notes: 1 }, // single low warm note
    stamp: { lo: 60, hi: 79, vel: 0.16, notes: 2, gap: 0.17 }, // two-note rising figure
  };
  const chimeCand = [];
  let chimeAt = -1;
  let chimeTurn = 0;
  function chime(kind = 'scrap') {
    const k = CHIME[kind] || CHIME.scrap;
    if (!bus || !ctx || ctx.state !== 'running' || !on || audio.muted || M.gain <= 0) return false;
    const now = ctx.currentTime;
    if (now - chimeAt < 0.25) return false;
    const beat = 60 / M.bpm;
    const bar = Math.max(0, Math.floor((now - origin - 0.1) / (beat * BEATS)));
    const chord = LEFT[bar % 16];
    chimeCand.length = 0;
    for (let i = 0; i < ALL_NOTES.length; i++) {
      const m = ALL_NOTES[i];
      if (m < k.lo || m > k.hi || !sampleCache.has(m)) continue;
      for (let j = 0; j < chord.length; j++) if ((m - chord[j]) % 12 === 0) { chimeCand.push(m); break; }
    }
    if (chimeCand.length === 0) return false;
    chimeAt = now;
    chimeTurn++;
    if (k.notes === 1) {
      playNote(ctx, bus, now + 0.02, chimeCand[(chimeTurn * 2) % chimeCand.length], k.vel);
    } else {
      const a = chimeCand.length > 1 ? chimeTurn % (chimeCand.length - 1) : 0;
      playNote(ctx, bus, now + 0.02, chimeCand[a], k.vel);
      if (chimeCand.length > 1) playNote(ctx, bus, now + 0.02 + k.gap, chimeCand[a + 1], k.vel * 1.1);
    }
    return true;
  }

  return {
    get on() { return on; },
    /** Gameplay feedback: chime('stamp' | 'scrap' | 'lantern'). Quiet, in the current chord, rate-limited. @returns true if it sounded */
    chime,
    toggle() { on = !on; level(); return on; },
    refresh: level,
    dispose() { clearInterval(timer); if (bus) bus.out.disconnect(); },
  };
}
