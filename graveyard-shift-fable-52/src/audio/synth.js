// DSP primitives for offline synthesis. Pure: every function works on Float32Arrays from a sample
// rate and a seeded rng ({next()}), so the same code runs in the browser and in Node.
export const SR = 48000;
const TAU = Math.PI * 2;

export const white = (rng) => rng.next() * 2 - 1;
export const samples = (sr, seconds) => new Float32Array(Math.max(1, Math.ceil(seconds * sr)));
export const db = (d) => Math.pow(10, d / 20);

// RBJ cookbook biquad. Coefficients can be changed while running (set()).
export class Biquad {
  constructor(type, freq, q = 0.707, sr = SR, gainDb = 0) {
    this.type = type; this.sr = sr;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
    this.set(freq, q, gainDb);
  }
  set(freq, q = this.q, gainDb = this.g) {
    this.q = q; this.g = gainDb;
    const f = Math.min(Math.max(freq, 5), this.sr * 0.49);
    const w = (TAU * f) / this.sr, c = Math.cos(w), s = Math.sin(w), a = s / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    switch (this.type) {
      case 'lowpass': b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; a0 = 1 + a; a1 = -2 * c; a2 = 1 - a; break;
      case 'highpass': b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; a0 = 1 + a; a1 = -2 * c; a2 = 1 - a; break;
      case 'bandpass': b0 = a; b1 = 0; b2 = -a; a0 = 1 + a; a1 = -2 * c; a2 = 1 - a; break;
      case 'peaking': {
        const A = Math.pow(10, gainDb / 40);
        b0 = 1 + a * A; b1 = -2 * c; b2 = 1 - a * A; a0 = 1 + a / A; a1 = -2 * c; a2 = 1 - a / A; break;
      }
      default: throw new Error(`biquad type ${this.type}`);
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  process(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

// Filter a whole array in place with a static biquad (optionally cascaded `order` times).
export function filt(arr, type, freq, q = 0.707, sr = SR, order = 1, gainDb = 0) {
  for (let k = 0; k < order; k++) {
    const b = new Biquad(type, freq, q, sr, gainDb);
    for (let i = 0; i < arr.length; i++) arr[i] = b.process(arr[i]);
  }
  return arr;
}

// Filter with a cutoff that follows freqAt(u), u = 0..1 over the array; coefficients every 32 samples.
export function sweep(arr, type, freqAt, q = 0.707, sr = SR) {
  const b = new Biquad(type, freqAt(0), q, sr);
  const n = arr.length;
  for (let i = 0; i < n; i++) {
    if ((i & 31) === 0) b.set(freqAt(i / n), q);
    arr[i] = b.process(arr[i]);
  }
  return arr;
}

export function noise(sr, seconds, rng) {
  const a = samples(sr, seconds);
  for (let i = 0; i < a.length; i++) a[i] = white(rng);
  return a;
}

// Smoothed random walk in [-1,1] (control signal), rate in Hz.
export function wobble(n, sr, rateHz, rng) {
  const out = new Float32Array(n);
  const step = Math.max(1, Math.round(sr / rateHz));
  let a = white(rng), b = white(rng);
  for (let i = 0; i < n; i++) {
    const k = i % step;
    if (k === 0 && i > 0) { a = b; b = white(rng); }
    const t = k / step, s = t * t * (3 - 2 * t);
    out[i] = a + (b - a) * s;
  }
  return out;
}

// Envelope: linear-ish attack (seconds), exponential decay (tau seconds), starting at t0.
export function envAD(t, attack, tau) {
  if (t < 0) return 0;
  const a = attack > 0 ? Math.min(1, t / attack) : 1;
  return a * a * (3 - 2 * a) * Math.exp(-Math.max(0, t - attack) / tau);
}

// dst[offset..] += src * gain (bounds-safe).
export function mixInto(dst, src, offset = 0, gain = 1) {
  const o = Math.round(offset);
  const start = Math.max(0, -o), end = Math.min(src.length, dst.length - o);
  for (let i = start; i < end; i++) dst[i + o] += src[i] * gain;
  return dst;
}

export function peakOf(arr) {
  let p = 0;
  for (let i = 0; i < arr.length; i++) { const v = Math.abs(arr[i]); if (v > p) p = v; }
  return p;
}

export function normalize(arr, peak = 0.9) {
  const chans = Array.isArray(arr) ? arr : [arr];
  let p = 0;
  for (const c of chans) p = Math.max(p, peakOf(c));
  if (p > 0) { const g = peak / p; for (const c of chans) for (let i = 0; i < c.length; i++) c[i] *= g; }
  return arr;
}

export function scale(arr, g) { for (let i = 0; i < arr.length; i++) arr[i] *= g; return arr; }

// Soft saturation; full scale stays at full scale, quieter parts are lifted (density, weight).
export function saturate(arr, drive = 2) {
  const k = 1 / Math.tanh(drive);
  for (let i = 0; i < arr.length; i++) arr[i] = Math.tanh(arr[i] * drive) * k;
  return arr;
}

export function fadeEdges(arr, sr, inSec = 0.001, outSec = 0.02) {
  const ni = Math.min(arr.length, Math.round(inSec * sr)), no = Math.min(arr.length, Math.round(outSec * sr));
  for (let i = 0; i < ni; i++) arr[i] *= i / ni;
  for (let i = 0; i < no; i++) arr[arr.length - 1 - i] *= i / no;
  return arr;
}

// Remove DC with a gentle 20 Hz high-pass (synthesised thumps leave offsets).
export const dcBlock = (arr, sr = SR) => filt(arr, 'highpass', 20, 0.707, sr);

// Make a seamless loop: the extra `xfade` seconds at the end are cross-faded into the start.
export function loopify(arr, sr, xfade) {
  const nx = Math.round(xfade * sr), n = arr.length - nx;
  const out = new Float32Array(n);
  out.set(arr.subarray(0, n));
  for (let i = 0; i < nx; i++) {
    const t = i / nx, a = Math.sqrt(t), b = Math.sqrt(1 - t);
    out[i] = arr[i] * a + arr[n + i] * b;
  }
  return out;
}

// Sum of exponentially decaying sinusoids (struck object). modes: [[freq, tau, amp], ...].
export function modal(sr, seconds, modes, rng, out = samples(sr, seconds), offset = 0, gain = 1) {
  for (const [f, tau, amp] of modes) {
    if (f >= sr * 0.45) continue;
    const w = (TAU * f) / sr, ph = rng ? rng.next() * TAU : 0;
    const len = Math.min(out.length - offset, Math.ceil(tau * 7 * sr));
    const d = Math.exp(-1 / (tau * sr));
    // Recursive oscillator: cheap and stable for these lengths.
    let c = Math.cos(ph), s = Math.sin(ph), e = amp * gain;
    const cw = Math.cos(w), sw = Math.sin(w);
    for (let i = 0; i < len; i++) {
      out[offset + i] += s * e;
      const c2 = c * cw - s * sw; s = s * cw + c * sw; c = c2; e *= d;
    }
  }
  return out;
}

// Sine with a frequency function f(t) and amplitude function a(t), t in seconds.
export function chirp(sr, seconds, fAt, aAt, out = samples(sr, seconds), offset = 0) {
  let ph = 0;
  const n = Math.min(out.length - offset, Math.ceil(seconds * sr));
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (TAU * fAt(t)) / sr;
    out[offset + i] += Math.sin(ph) * aAt(t);
  }
  return out;
}

// Short noise grain, band-limited, decaying (debris, drips, ticks).
export function grain(sr, rng, out, offset, { freq = 3000, q = 1, tau = 0.002, amp = 1, type = 'bandpass' }) {
  const len = Math.min(out.length - Math.round(offset), Math.ceil(tau * 6 * sr));
  if (len <= 0) return out;
  const b = new Biquad(type, freq, q, sr);
  const o = Math.round(offset);
  for (let i = 0; i < len; i++) out[o + i] += b.process(white(rng) * Math.exp(-i / (tau * sr))) * amp;
  return out;
}

// Air-bubble resonance (Minnaert): slightly rising chirp, fast decay. The "plink" of drops into water.
// rise = fractional pitch rise over the bubble's life (0.1-0.6 is natural).
export function bubble(sr, out, offset, { freq = 2500, tau = 0.008, amp = 0.3, rise = 0.3 }) {
  return chirp(sr, tau * 6, (t) => freq * (1 + rise * t / (tau * 6)), (t) => amp * Math.exp(-t / tau), out, Math.round(offset));
}

// Voiced formant synthesis: glottal pulse train with jitter/shimmer/subharmonics + aspiration,
// through a parallel bank of time-varying formant resonators, with optional vocal-fry roughness.
// o.f0(u), o.amp(u), o.formants(u) -> [[freq, bw, gainDb]...], o.breath(u) are functions of u = 0..1.
export function voice(sr, rng, o) {
  const n = Math.ceil(o.dur * sr);
  const out = new Float32Array(n);
  const forms = o.formants(0).map(([f, bw]) => new Biquad('bandpass', f, f / bw, sr));
  const asp = new Biquad('highpass', 900, 0.6, sr);
  const jit = wobble(n, sr, 18, rng), shim = wobble(n, sr, 9, rng), fryW = wobble(n, sr, o.fryRate ?? 30, rng);
  const sub = o.sub ?? 0, jitter = o.jitter ?? 0.03, shimmer = o.shimmer ?? 0.15, drive = o.drive ?? 1.5;
  const Op = o.open ?? 0.55, Oc = o.close ?? 0.12;
  let phase = 0, prevG = 0, cycle = 0, cycAmp = 1, gains = [], breath = 0, f0 = 100, amp = 0;
  const kd = 1 / Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    if ((i & 31) === 0) {
      const u = i / n;
      const fs = o.formants(u);
      gains = fs.map(([, , g]) => db(g));
      for (let k = 0; k < forms.length; k++) forms[k].set(fs[k][0], fs[k][0] / fs[k][1]);
      breath = o.breath(u); amp = o.amp(u);
      f0 = o.f0(u) * (1 + jitter * jit[i]);
    }
    phase += f0 / sr;
    if (phase >= 1) {
      phase -= 1; cycle++;
      cycAmp = (1 + shimmer * shim[i]) * (sub > 0 && (cycle & 1) ? 1 - sub : 1);
      // Irregular "creak": occasional skipped or doubled pulses.
      if (o.creak && rng.next() < o.creak) cycAmp *= rng.next() * 0.5;
    }
    let g;
    if (phase < Op) g = 0.5 * (1 - Math.cos((Math.PI * phase) / Op));
    else if (phase < Op + Oc) g = Math.cos((Math.PI / 2) * (phase - Op) / Oc);
    else g = 0;
    const dg = (g - prevG) * (sr / Math.max(40, f0)) * 0.08;
    prevG = g;
    const src = dg * cycAmp * (1 - breath * 0.7) + asp.process(white(rng)) * breath * (0.35 + 0.65 * g);
    let y = 0;
    for (let k = 0; k < forms.length; k++) y += forms[k].process(src) * gains[k];
    if (o.fry) y *= 1 - o.fry * (0.5 + 0.5 * fryW[i]);
    out[i] = (Math.tanh(y * drive) * kd) * amp;
  }
  return dcBlock(out, sr);
}

// Vowel formant tables (adult male, Hz): [F1, F2, F3, F4]. Scaled by tract length per voice.
export const VOWELS = {
  uh: [620, 1100, 2450, 3300], aa: [760, 1180, 2500, 3400], oh: [520, 860, 2400, 3300],
  oo: [360, 760, 2300, 3200], ae: [800, 1650, 2550, 3400], eh: [580, 1750, 2500, 3400], er: [480, 1300, 1650, 3200],
};
export function lerpVowel(a, b, t) { return a.map((v, i) => v + (b[i] - v) * t); }

// Generated impulse response (stereo). Early reflections as discrete taps, then a decorrelated noise
// tail with frequency-dependent decay (high frequencies die faster) and optional flutter echo.
// A generator (yields between bands) so it can be spread across frames; run to completion with
// the synthesis queue.
export function* impulseResponse(sr, rng, o) {
  const n = Math.ceil(o.seconds * sr);
  const chans = [new Float32Array(n), new Float32Array(n)];
  const tau = o.t60 / 6.91;
  for (let c = 0; c < 2; c++) {
    const L = chans[c];
    // Late tail: three bands with different decay rates, summed.
    const bands = [
      { type: 'lowpass', f: 500, tau: tau * 1.15, g: 1.0 },
      { type: 'bandpass', f: 1800, tau: tau * 0.8, g: 0.7 },
      { type: 'highpass', f: 4500, tau: tau * 0.45, g: o.bright ?? 0.4 },
    ];
    const pre = Math.round((o.predelay ?? 0.01) * sr);
    for (const b of bands) {
      const bq = new Biquad(b.type, b.f, b.type === 'bandpass' ? 0.7 : 0.707, sr);
      for (let i = pre; i < n; i++) {
        const t = (i - pre) / sr;
        const att = Math.min(1, t / (o.build ?? 0.02));
        L[i] += bq.process(white(rng)) * b.g * att * Math.exp(-t / b.tau);
      }
      yield;
    }
    for (const [d, a] of o.early || []) {
      const at = Math.round((d + rng.range(-0.002, 0.002)) * sr);
      if (at < n) grain(sr, rng, L, at, { freq: o.earlyHz ?? 1500, q: 0.5, tau: 0.0015, amp: a * 6 });
    }
    if (o.flutter) {
      const D = Math.round(o.flutter.period * (1 + (c ? 0.02 : -0.02)) * sr);
      const g = o.flutter.gain, lp = new Biquad('lowpass', 3500, 0.7, sr);
      for (let i = D; i < n; i++) L[i] += lp.process(L[i - D]) * g;
    }
  }
  normalize(chans, 0.9);
  for (const L of chans) fadeEdges(L, sr, 0, 0.05);
  return chans;
}

// ---------------------------------------------------------------- foley helpers (shared)

// Small steel click: free-bar modes plus a bright tick; `thud` adds a low body knock.
export function click(sr, rng, out, at, base, amp, thud = 0) {
  modal(sr, 0, [[base, 0.007, 1], [base * 1.47, 0.006, 0.8], [base * 2.15, 0.004, 0.6], [base * 3.3, 0.003, 0.4]], rng, out, Math.round(at * sr), amp);
  grain(sr, rng, out, at * sr, { freq: 5500, q: 0.6, tau: 0.0006, amp: amp * 1.2 });
  if (thud) grain(sr, rng, out, at * sr, { freq: 220, q: 0.8, tau: 0.018, amp: thud, type: 'lowpass' });
  return out;
}

// Sliding contact: band-limited noise under a half-sine with a rough texture.
export function friction(sr, rng, out, at, dur, f, amp, q = 0.9) {
  const s = noise(sr, dur, rng);
  filt(s, 'bandpass', f, q, sr);
  const wob = wobble(s.length, sr, 60, rng);
  for (let i = 0; i < s.length; i++) { const u = i / s.length; s[i] *= Math.sin(Math.PI * u) * (0.6 + 0.4 * wob[i]); }
  return mixInto(out, s, at * sr, amp);
}

// Air moved past the ear: noise through a band-pass whose centre rises then falls, under a bell.
export function whoosh(sr, rng, out, at, dur, lo, hi, amp, q = 1.2) {
  const s = noise(sr, dur, rng);
  sweep(s, 'bandpass', (u) => lo + (hi - lo) * Math.sin(Math.PI * Math.min(1, u * 1.1)), q, sr);
  for (let i = 0; i < s.length; i++) { const u = i / s.length; s[i] *= Math.pow(Math.sin(Math.PI * u), 1.5); }
  return mixInto(out, s, at * sr, amp);
}

// Tonal partial with an attack/decay envelope (for stings, tones, hums).
export function tone(sr, out, at, dur, f, amp, { attack = 0.005, tau = dur / 3, fEnd = f, vib = 0, vibHz = 5 } = {}) {
  return chirp(sr, dur, (t) => f + (fEnd - f) * (t / dur) + vib * f * Math.sin(2 * Math.PI * vibHz * t), (t) => amp * envAD(t, attack, tau), out, Math.round(at * sr));
}
