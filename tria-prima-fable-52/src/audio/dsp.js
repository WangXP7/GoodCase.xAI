// Synthesis toolkit. One Synth is bound to one BaseAudioContext (the live one, or an
// OfflineAudioContext when sounds are rendered for checking), so every recipe in this folder runs
// unchanged on both. Nothing here touches files: noise, textures, plucked strings and the reverb
// impulse are all computed.

export const EPS = 1e-4;
export const TAU = Math.PI * 2;
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** 'D2', 'Bb3', 'Cs4' -> MIDI number (C4 = 60). */
export function midi(name) {
  const m = /^([A-G])([sb#]?)(-?\d)$/.exec(name);
  if (!m) throw new Error('bad note name: ' + name);
  return SEMI[m[1]] + (m[2] === 's' || m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) + 1) * 12;
}

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// Computed buffers are plain data, so they are shared by every context with the same sample rate.
const BUFFERS = new Map();
const CURVES = new Map();

function normaliseRms(d, target) {
  let s = 0;
  for (let i = 0; i < d.length; i++) s += d[i] * d[i];
  const k = target / Math.sqrt(s / d.length || 1);
  for (let i = 0; i < d.length; i++) d[i] *= k;
}
function normalisePeak(d, target) {
  let p = 0;
  for (let i = 0; i < d.length; i++) p = Math.max(p, Math.abs(d[i]));
  const k = target / (p || 1);
  for (let i = 0; i < d.length; i++) d[i] *= k;
}

function fillNoise(kind) {
  return (d, sr, r) => {
    const n = d.length,
      xf = Math.floor(sr * 0.25),
      tmp = new Float32Array(n + xf);
    if (kind === 'white') {
      for (let i = 0; i < tmp.length; i++) tmp[i] = r() * 2 - 1;
    } else if (kind === 'pink') {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < tmp.length; i++) {
        const w = r() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        tmp[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
        b6 = w * 0.115926;
      }
    } else {
      // brown: flat below ~55 Hz, -6 dB per octave above, no DC
      const leak = Math.exp((-TAU * 55) / sr);
      const hp = Math.exp((-TAU * 18) / sr);
      let b = 0, dc = 0;
      for (let i = 0; i < tmp.length; i++) {
        b = b * leak + (r() * 2 - 1);
        dc = dc * hp + b * (1 - hp);
        tmp[i] = b - dc;
      }
    }
    for (let i = 0; i < n; i++) d[i] = tmp[i];
    // fold the overshoot back over the start so the loop point is seamless
    for (let i = 0; i < xf; i++) {
      const a = i / xf;
      d[i] = tmp[i] * Math.sqrt(a) + tmp[n + i] * Math.sqrt(1 - a);
    }
    normaliseRms(d, 0.5);
  };
}

// Smooth random control signal, exactly periodic over the buffer.
function fillWander(d, sr, r) {
  const n = d.length;
  for (const cyc of [2, 3, 5, 7, 9, 12, 16, 21, 27, 34]) {
    // one sine per cycle count, advanced by rotation (this buffer is built on the unlock click)
    const w = (TAU * cyc) / n,
      cw = Math.cos(w),
      sw = Math.sin(w),
      amp = 1 / Math.sqrt(cyc),
      ph = r() * TAU;
    let s = Math.sin(ph) * amp,
      c = Math.cos(ph) * amp;
    for (let i = 0; i < n; i++) {
      d[i] += s;
      const ns = s * cw + c * sw;
      c = c * cw - s * sw;
      s = ns;
    }
  }
  normalisePeak(d, 1);
}

// Sparse damped clicks: sap popping in a fire, grit, hail on stone.
function fillCrackle(perSec, popShare, fLo, fHi) {
  return (d, sr, r) => {
    const n = d.length,
      count = Math.floor((perSec * n) / sr);
    for (let k = 0; k < count; k++) {
      const at = Math.floor(r() * n);
      const pop = r() < popShare;
      const f = pop ? 220 + r() * 520 : fLo + r() * r() * (fHi - fLo);
      const tau = (pop ? 0.004 + r() * 0.007 : 0.00025 + r() * 0.0018) * sr;
      const amp = (pop ? 0.9 : 0.12 + 0.88 * Math.pow(r(), 3)) * (r() < 0.5 ? -1 : 1);
      const len = Math.floor(tau * 7);
      const w = (TAU * f) / sr;
      for (let i = 0; i < len; i++) d[(at + i) % n] += amp * Math.exp(-i / tau) * Math.cos(w * i);
    }
    normalisePeak(d, 0.9);
  };
}

// Bubbles: short sine chirps. `rise` is how far the pitch climbs over the life of one bubble.
function fillBubbles(perSec, fLo, fHi, durLo, durHi, rise, pop = 0) {
  return (d, sr, r) => {
    const n = d.length,
      count = Math.floor((perSec * n) / sr);
    for (let k = 0; k < count; k++) {
      const at = Math.floor(r() * n);
      const f0 = fLo * Math.pow(fHi / fLo, r());
      const len = Math.floor((durLo + r() * (durHi - durLo)) * sr);
      const amp = 0.25 + 0.75 * r() * r();
      const up = rise * (0.6 + 0.8 * r());
      const att = 0.004 * sr;
      let ph = 0;
      for (let i = 0; i < len; i++) {
        const u = i / len;
        ph += (TAU * f0 * (1 + up * u * u)) / sr;
        d[(at + i) % n] += amp * Math.min(1, i / att) * Math.exp(-3.6 * u) * Math.sin(ph);
      }
      if (pop && r() < pop) {
        // the skin bursting: a tiny burst of noise at the end
        const pl = Math.floor(0.012 * sr);
        for (let i = 0; i < pl; i++) d[(at + len + i) % n] += amp * 0.5 * (r() * 2 - 1) * Math.exp((-5 * i) / pl);
      }
    }
    normalisePeak(d, 0.9);
  };
}

// An endlessly rising tone (Shepard glide): octave partials under a fixed bell-shaped loudness.
// It is by far the longest buffer to compute (eight partials over eight seconds), so it can also be
// built a partial at a time: see Synth.warmJobs.
const SHEPARD_PARTIALS = 8;
function shepardPartial(d, sr, k, glide) {
  const n = d.length,
    T = n / sr,
    M = Math.round((55 * T) / Math.LN2),
    f0 = (M * Math.LN2) / T,
    oct0 = Math.log2(f0) - Math.log2(820);
  const turns = (TAU * f0 * Math.pow(2, k) * T) / Math.LN2; // a whole number of cycles over the buffer
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const z = (oct0 + k + u) / 1.25;
    let a = Math.exp(-0.5 * z * z);
    if (k === 0) a *= u;
    if (k === SHEPARD_PARTIALS - 1) a *= 1 - u;
    d[i] += a * Math.sin(turns * glide[i]);
  }
}
function shepardGlide(n) {
  const glide = new Float64Array(n);
  for (let i = 0; i < n; i++) glide[i] = Math.pow(2, i / n) - 1;
  return glide;
}
function fillShepard(d, sr) {
  const glide = shepardGlide(d.length);
  for (let k = 0; k < SHEPARD_PARTIALS; k++) shepardPartial(d, sr, k, glide);
  normalisePeak(d, 0.9);
}

const TEXTURES = {
  crackle: [4, fillCrackle(11, 0.07, 900, 5200)],
  crackleDense: [4, fillCrackle(70, 0.02, 1200, 6000)],
  grit: [3, fillCrackle(260, 0, 1500, 7000)],
  drops: [4, fillCrackle(46, 0, 2400, 7500)],
  bubLo: [6, fillBubbles(3.2, 170, 420, 0.06, 0.12, 0.7)],
  bubMid: [6, fillBubbles(11, 280, 820, 0.04, 0.09, 0.6)],
  bubHi: [6, fillBubbles(34, 380, 1500, 0.025, 0.06, 0.5)],
  gurgle: [6, fillBubbles(15, 320, 1150, 0.025, 0.07, 0.35)],
  glop: [8, fillBubbles(0.9, 52, 115, 0.22, 0.42, 0.5, 0.8)],
  shepard: [8, fillShepard],
};

const CURVE_FN = {
  soft: (x) => Math.tanh(1.6 * x) / Math.tanh(1.6),
  drive: (x) => Math.tanh(4 * x),
  rect: (x) => (x <= 0.1 ? 0 : Math.pow((x - 0.1) / 0.9, 1.4)),
  abs: (x) => Math.abs(x),
  pos: (x) => (x + 1) / 2,
};

export class Synth {
  constructor(ctx, seed = 1) {
    this.ctx = ctx;
    this.sr = ctx.sampleRate;
    this.rnd = mulberry(seed);
    this.live = 0; // sources started and not yet ended
    this.made = 0; // sources ever started
    this.collect = null; // while set to an array, every source started is also pushed here
    this.sways = []; // slow movements kept going by pump()
  }
  get now() {
    return this.ctx.currentTime;
  }
  range(a, b) {
    return a + (b - a) * this.rnd();
  }
  int(a, b) {
    return Math.floor(this.range(a, b + 1));
  }
  pick(arr) {
    return arr[Math.floor(this.rnd() * arr.length)];
  }
  chance(p) {
    return this.rnd() < p;
  }
  jit(v, amt = 0.06) {
    return v * (1 + (this.rnd() * 2 - 1) * amt);
  }

  // --- computed buffers -------------------------------------------------------------------------
  buffer(key, seconds, fill, sampleRate = this.sr, channels = 1) {
    const id = `${key}@${sampleRate}`;
    let b = BUFFERS.get(id);
    if (!b) {
      b = new AudioBuffer({ length: Math.max(2, Math.floor(seconds * sampleRate)), sampleRate, numberOfChannels: channels });
      const r = mulberry(hashStr(key) ^ 0x9e3779b9);
      for (let c = 0; c < channels; c++) fill(b.getChannelData(c), sampleRate, r, c);
      BUFFERS.set(id, b);
    }
    return b;
  }
  noiseBuffer(kind) {
    return this.buffer('noise:' + kind, 4, fillNoise(kind));
  }
  wanderBuffer() {
    return this.buffer('wander', 48, fillWander, 8000);
  }
  texture(name) {
    const t = TEXTURES[name];
    return this.buffer('tex:' + name, t[0], t[1]);
  }
  /** Names of every lazily computed texture. */
  static get textureNames() {
    return Object.keys(TEXTURES);
  }
  /**
   * Jobs that compute every shared buffer, none longer than a frame or two: run one per timer tick
   * after start, so that the first use of a texture does not stall the game. Anything asked for
   * before its job has run is simply computed on the spot.
   */
  warmJobs() {
    const jobs = [() => this.wanderBuffer(), ...['white', 'pink', 'brown'].map((k) => () => this.noiseBuffer(k))];
    for (const name of Object.keys(TEXTURES)) {
      if (name !== 'shepard') {
        jobs.push(() => this.texture(name));
        continue;
      }
      const sr = this.sr,
        id = `tex:shepard@${sr}`,
        n = Math.max(2, Math.floor(TEXTURES.shepard[0] * sr));
      let d = null,
        glide = null;
      jobs.push(() => {
        if (BUFFERS.has(id)) return;
        d = new Float32Array(n);
        glide = shepardGlide(n);
      });
      for (let k = 0; k < SHEPARD_PARTIALS; k++) jobs.push(() => d && !BUFFERS.has(id) && shepardPartial(d, sr, k, glide));
      jobs.push(() => {
        if (!d || BUFFERS.has(id)) return;
        normalisePeak(d, 0.9);
        const b = new AudioBuffer({ length: n, sampleRate: sr, numberOfChannels: 1 });
        b.getChannelData(0).set(d);
        BUFFERS.set(id, b);
        d = glide = null;
      });
    }
    return jobs;
  }

  /**
   * Karplus-Strong string, two courses a few cents apart (a dulcimer or a harp, not a guitar).
   * Computed at 24 kHz whatever the context runs at: every pluck is played through a low-pass below
   * 9 kHz, and this way a new note costs half as much to make (it is made on the frame that first
   * needs it) and to keep. The two constants tuned per sample at 48 kHz are converted.
   */
  pluckBuffer(m, bright = 0.5, rate = 24000) {
    const f = mtof(m);
    const secs = clamp(4.2 - (m - 40) * 0.045, 1.5, 4.2);
    const k = rate / 48000;
    return this.buffer(`ks:${m}:${Math.round(bright * 4)}${rate === 24000 ? '' : ':' + rate}`, secs, (d, sr, r) => {
      const s48 = 0.5 - 0.2 * bright; // loop low-pass: 0.5 is the dullest
      const s = (1 - Math.sqrt(Math.max(0, 1 - 4 * s48 * (1 - s48) * k * k))) / 2;
      for (let pass = 0; pass < 2; pass++) {
        const ff = f * (pass ? 1.0016 : 0.9989);
        const P = sr / ff;
        const L = Math.max(2, Math.floor(P - s - 0.1));
        const frac = P - s - L;
        const C = (1 - frac) / (1 + frac);
        const line = new Float32Array(L);
        let lp = 0;
        const a = 1 - Math.pow(1 - (0.16 + 0.78 * bright), 1 / k);
        for (let i = 0; i < L; i++) {
          lp += (r() * 2 - 1 - lp) * a;
          line[i] = lp;
        }
        const tmp = line.slice(),
          comb = Math.max(1, Math.floor(L * 0.21));
        let mean = 0;
        for (let i = 0; i < L; i++) {
          line[i] = tmp[i] - 0.7 * tmp[(i + comb) % L];
          mean += line[i];
        }
        mean /= L;
        for (let i = 0; i < L; i++) line[i] -= mean;
        const t60 = clamp(6.0 - (m - 36) * 0.065, 1.3, 6.0);
        const rho = Math.pow(0.001, 1 / (ff * t60));
        let ptr = 0, lastX = 0, lastLp = 0, lastAp = 0;
        for (let i = 0; i < d.length; i++) {
          const x = line[ptr];
          const l = (1 - s) * x + s * lastX;
          lastX = x;
          const ap = C * (l - lastAp) + lastLp;
          lastLp = l;
          lastAp = ap;
          line[ptr] = ap * rho;
          ptr = ptr + 1 === L ? 0 : ptr + 1;
          d[i] += x;
        }
      }
      const fade = Math.floor(sr * 0.25);
      for (let i = 0; i < fade; i++) d[d.length - 1 - i] *= i / fade;
      const on = Math.floor(sr * 0.0015);
      for (let i = 0; i < on; i++) d[i] *= i / on;
      normalisePeak(d, 0.9);
    }, rate);
  }

  /** Stereo reverb impulse: sparse early taps, then noise whose highs die first. */
  impulse(seconds = 3.4, decay = 3.2, damp = 0.6) {
    return this.buffer(
      `ir:${seconds}:${decay}:${damp}`,
      seconds,
      (d, sr, r) => {
        const n = d.length,
          pre = Math.floor(0.018 * sr),
          bloom = Math.floor(0.03 * sr);
        let lp = 0;
        for (let i = pre; i < n; i++) {
          const t = (i - pre) / sr;
          const env = Math.pow(10, (-3 * t) / decay);
          const a = 1 - damp * Math.min(1, t / (decay * 0.6)) * 0.95;
          lp += (r() * 2 - 1 - lp) * a;
          // the low-pass also takes level away: give most of it back so the tail keeps its length
          const makeup = Math.min(3, 1 / Math.sqrt(a / (2 - a)));
          d[i] = lp * env * Math.min(1, (i - pre) / bloom) * makeup * 0.5;
        }
        for (let k = 0; k < 8; k++) {
          const i = pre + Math.floor((0.003 + r() * 0.075) * sr);
          d[i] += (r() < 0.5 ? -1 : 1) * (0.75 - k * 0.07);
        }
        const fade = Math.floor(sr * 0.2);
        for (let i = 0; i < fade; i++) d[n - 1 - i] *= i / fade;
      },
      this.sr,
      2
    );
  }

  curve(kind) {
    let c = CURVES.get(kind);
    if (!c) {
      const n = 2048,
        fn = CURVE_FN[kind];
      c = new Float32Array(n);
      for (let i = 0; i < n; i++) c[i] = fn((i / (n - 1)) * 2 - 1);
      CURVES.set(kind, c);
    }
    return c;
  }

  // --- nodes ------------------------------------------------------------------------------------
  gain(v = 1) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }
  /** Biquad. For lowpass / highpass the Web Audio "Q" is a resonance in dB, so it defaults to flat. */
  bq(type, f, q, g = 0) {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = clamp(f, 10, this.sr * 0.46);
    b.Q.value = q ?? (type === 'lowpass' || type === 'highpass' ? 0 : 1);
    if (g) b.gain.value = g;
    // A swept filter would otherwise work out its coefficients for every sample. Once per block
    // (2.7 ms) is as smooth as any sweep here needs, and several times cheaper.
    try {
      b.frequency.automationRate = b.Q.automationRate = b.gain.automationRate = b.detune.automationRate = 'k-rate';
    } catch (e) {
      /* an old browser: it stays sample-accurate */
    }
    return b;
  }
  pan(p) {
    const n = this.ctx.createStereoPanner();
    n.pan.value = p;
    return n;
  }
  delay(time, max = 1) {
    const d = this.ctx.createDelay(max);
    d.delayTime.value = time;
    return d;
  }
  shaper(kind, oversample = 'none') {
    const w = this.ctx.createWaveShaper();
    w.curve = this.curve(kind);
    w.oversample = oversample;
    return w;
  }
  /** Connect nodes in series, return the last one. */
  chain(...nodes) {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
    return nodes[nodes.length - 1];
  }
  to(node, out, pan) {
    if (pan) {
      const p = this.pan(clamp(pan, -1, 1));
      node.connect(p);
      p.connect(out);
    } else node.connect(out);
    return node;
  }

  // --- sources (started here, counted while alive) -------------------------------------------------
  _track(node) {
    this.live++;
    this.made++;
    if (this.collect) this.collect.push(node);
    node.onended = () => {
      this.live--;
    };
    return node;
  }
  osc(type, f, t, dur, det = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = clamp(f, 0.01, this.sr * 0.49);
    if (det) o.detune.value = det;
    this._track(o);
    o.start(t);
    if (dur != null && isFinite(dur)) o.stop(t + dur);
    return o;
  }
  play(buffer, t, { dur = null, rate = 1, loop = false, offset = 0 } = {}) {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = loop;
    s.playbackRate.value = rate;
    this._track(s);
    s.start(t, offset);
    if (dur != null && isFinite(dur)) s.stop(t + dur);
    return s;
  }
  noise(kind, t, dur, rate = 1) {
    const b = this.noiseBuffer(kind);
    return this.play(b, t, { dur, rate, loop: true, offset: this.rnd() * (b.duration - 0.3) });
  }
  tex(name, t, dur, rate = 1) {
    const b = this.texture(name);
    return this.play(b, t, { dur, rate, loop: true, offset: this.rnd() * (b.duration - 0.3) });
  }
  /** A slow random control signal in -1..1 that never repeats within a minute. Connect it to params. */
  wander(rate = 1, t = this.now, dur = null) {
    const b = this.wanderBuffer();
    return this.play(b, t, { dur, rate, loop: true, offset: this.rnd() * (b.duration - 0.5) });
  }
  /** wander -> scaled -> param (adds to the param's own value). Returns the source so it can be stopped. */
  drift(param, depth, rate = 1, t = this.now, shape = null, dur = null) {
    const w = this.wander(rate, t, dur);
    const g = this.gain(depth);
    if (shape) this.chain(w, this.shaper(shape), g);
    else w.connect(g);
    g.connect(param);
    return w;
  }

  // --- slow movement, written from the main thread ------------------------------------------------
  /**
   * Let params wander around their values for as long as the sound lives. A source playing the
   * wander buffer does the same, but each one costs about as much as six noise generators, and the
   * beds and loops need dozens. So this is a few slow sines with random phases, written into the
   * params as short ramps by pump(): free on the audio thread.
   *   targets: [param, base, depth, shape?] or a list of those; one signal moves them all
   *            (a gust is louder and higher at the same time)
   *   shape:   null -1..1 | 'pos' 0..1 | 'abs' | 'rect' 0..1, only the crests, rarely near 1 |
   *            'crest' 0..1, only the crests, and every strong one reaches 1
   * Returns the movement; set its `until` to end it.
   */
  sway(targets, rate = 1, shape = null, t = this.now) {
    const m = {
      targets: Array.isArray(targets[0]) ? targets : [targets],
      shape,
      w: [0.07, 0.19, 0.43].map((f) => TAU * f * rate * this.range(0.8, 1.25)),
      ph: [this.rnd() * TAU, this.rnd() * TAU, this.rnd() * TAU],
      step: clamp(0.4 / rate, 0.03, 0.25),
      next: t,
      until: Infinity,
    };
    this._sway(m, t, true);
    m.next = t + m.step;
    this.sways.push(m);
    return m;
  }
  _sway(m, t, first) {
    const raw = (Math.sin(m.w[0] * t + m.ph[0]) + 0.6 * Math.sin(m.w[1] * t + m.ph[1]) + 0.35 * Math.sin(m.w[2] * t + m.ph[2])) / 1.95;
    for (const [p, base, depth, own] of m.targets) {
      const shape = own === undefined ? m.shape : own;
      let v = raw;
      if (shape === 'pos') v = (raw + 1) / 2;
      else if (shape === 'abs') v = Math.abs(raw);
      else if (shape === 'rect') v = raw <= 0.1 ? 0 : Math.pow((raw - 0.1) / 0.9, 1.4);
      else if (shape === 'crest') {
        const u = clamp((raw - 0.05) / 0.5, 0, 1);
        v = u * u * (3 - 2 * u);
      }
      if (first) p.setValueAtTime(base + depth * v, t);
      else p.linearRampToValueAtTime(base + depth * v, t);
    }
  }
  /** Write every movement up to `until`. Once a frame when live; once, before an offline render. */
  pump(until, now = this.now) {
    const list = this.sways;
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (m.next < now) m.next = now + 0.01; // the clock ran on without us: pick up from here
      const end = Math.min(until, m.until);
      while (m.next < end) {
        this._sway(m, m.next, false);
        m.next += m.step;
      }
      if (m.until <= until) list.splice(i, 1);
    }
  }
  /** Ask for a param to be read once per block: for vibrato and sweeps that do not need more. */
  slow(param) {
    try {
      param.automationRate = 'k-rate';
    } catch (e) {
      /* stays sample-accurate */
    }
    return param;
  }

  // --- envelopes --------------------------------------------------------------------------------
  /**
   * Schedule a piecewise envelope. segs: [[seconds, value, kind]], times are relative to the
   * previous point. kind: 'l' linear (default), 'e' exponential, 't' approach (time constant =
   * seconds / 4), 's' step. Returns the time of the last point.
   */
  env(p, t, v0, segs) {
    let cur = v0,
      tt = t;
    p.setValueAtTime(v0, t);
    for (const [dt, v, kind] of segs) {
      const prev = tt;
      tt += Math.max(dt, 1e-4);
      if (kind === 'e') {
        if (cur < EPS) p.setValueAtTime(EPS, prev);
        p.exponentialRampToValueAtTime(Math.max(v, EPS), tt);
        cur = Math.max(v, EPS);
        if (v <= 0) {
          p.setValueAtTime(0, tt);
          cur = 0;
        }
      } else if (kind === 't') {
        p.setTargetAtTime(v, prev, (tt - prev) / 4);
        cur = v + (cur - v) * Math.exp(-4);
        p.setValueAtTime(cur, tt);
      } else if (kind === 's') {
        p.setValueAtTime(v, tt);
        cur = v;
      } else {
        p.linearRampToValueAtTime(v, tt);
        cur = v;
      }
    }
    return tt;
  }
  /** Slow swell: rise toward `peak`, hold for `dur`, then fall. Returns the time it reaches silence. */
  swell(p, t, peak, a, dur, r) {
    const ta = a / 3.2,
      tr = r / 3.2,
      tail = r * 1.5;
    p.setValueAtTime(0, t);
    p.setTargetAtTime(peak, t, ta);
    const v1 = peak * (1 - Math.exp(-dur / ta));
    p.setTargetAtTime(0, t + dur, tr);
    const end = t + dur + tail;
    p.setValueAtTime(v1 * Math.exp(-(tail - 0.06) / tr), end - 0.06);
    p.linearRampToValueAtTime(0, end);
    return end;
  }

  // --- compound one-shot voices -----------------------------------------------------------------
  _ahd(g, t, o, d) {
    const a = Math.min(o.a ?? 0.003, d * 0.8);
    const h = Math.min(o.h || 0, Math.max(0, d - a - 0.01));
    const peak = o.g ?? 0.5;
    const segs = [[a, peak]];
    if (h) segs.push([h, peak]);
    if (o.c === 't') segs.push([d - a - h - 0.03, 0, 't'], [0.03, 0]);
    else segs.push([d - a - h, 0, o.c || 'e']);
    this.env(g.gain, t, 0, segs);
  }
  /** Filtered noise burst. o: k d a h g ft f f1 tf q hp lp pan c rate */
  nz(out, t, o) {
    const d = o.d ?? 0.3;
    let n = this.noise(o.k || 'white', t, d + 0.03, o.rate || 1);
    if (o.f && o.ft !== 'none') {
      const fl = this.bq(o.ft || 'bandpass', o.f, o.q);
      if (o.f1) {
        fl.frequency.setValueAtTime(clamp(o.f, 10, this.sr * 0.46), t);
        fl.frequency.exponentialRampToValueAtTime(clamp(o.f1, 10, this.sr * 0.46), t + (o.tf || d));
      }
      n.connect(fl);
      n = fl;
    }
    if (o.hp) n = this.chain(n, this.bq('highpass', o.hp));
    if (o.lp) n = this.chain(n, this.bq('lowpass', o.lp));
    const g = this.gain(0);
    this._ahd(g, t, o, d);
    n.connect(g);
    return this.to(g, out, o.pan);
  }
  /** A stretch of a computed texture (crackle, grit, bubbles) under an envelope. o: d a h g hp lp f q rate pan c */
  tx(out, t, name, o) {
    const d = o.d ?? 0.5;
    let n = this.tex(name, t, d + 0.03, o.rate || 1);
    if (o.f) n = this.chain(n, this.bq(o.ft || 'bandpass', o.f, o.q));
    if (o.hp) n = this.chain(n, this.bq('highpass', o.hp));
    if (o.lp) n = this.chain(n, this.bq('lowpass', o.lp));
    const g = this.gain(0);
    this._ahd(g, t, o, d);
    n.connect(g);
    return this.to(g, out, o.pan);
  }
  /** Pitched tone with an optional glide. o: w f f1 tf d a h g det lp lp1 q vib pan c */
  tn(out, t, o) {
    const d = o.d ?? 0.3;
    const osc = this.osc(o.w || 'sine', o.f, t, d + 0.03, o.det || 0);
    if (o.f1) {
      osc.frequency.setValueAtTime(o.f, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + (o.tf || d));
    }
    if (o.vib) {
      const l = this.osc('sine', o.vib[0], t, d + 0.03);
      const lg = this.gain(o.vib[1]);
      l.connect(lg);
      lg.connect(osc.detune);
    }
    let n = osc;
    if (o.lp) {
      const f = this.bq('lowpass', o.lp, o.q);
      if (o.lp1) {
        f.frequency.setValueAtTime(o.lp, t);
        f.frequency.exponentialRampToValueAtTime(o.lp1, t + d);
      }
      n = this.chain(n, f);
    }
    const g = this.gain(0);
    this._ahd(g, t, o, d);
    n.connect(g);
    return this.to(g, out, o.pan);
  }
  /** Struck resonator: decaying partials. o: f (multiplier) parts [[hz, gain, seconds]] g a dk w det pan */
  modal(out, t, o) {
    const sum = this.gain(o.g ?? 1);
    const a = o.a ?? 0.001,
      k = o.f ?? 1,
      dk = o.dk ?? 1;
    let end = 0;
    for (const [hz, g, secs] of o.parts) {
      const f = hz * k;
      if (f > this.sr * 0.45 || f < 16) continue;
      const dur = Math.max(0.02, secs * dk);
      const osc = this.osc(o.w || 'sine', f, t, dur + 0.02, o.det ? this.range(-o.det, o.det) : 0);
      const e = this.gain(0);
      this.env(e.gain, t, 0, [
        [Math.min(a, dur * 0.3), g],
        [dur - Math.min(a, dur * 0.3), 0, 'e'],
      ]);
      osc.connect(e);
      e.connect(sum);
      end = Math.max(end, dur);
    }
    this.to(sum, out, o.pan);
    return end;
  }
  /** Two-operator FM. o: f f1 ratio idx idx1 d a h g pan c */
  fm(out, t, o) {
    const d = o.d ?? 0.3;
    const car = this.osc('sine', o.f, t, d + 0.03);
    const mod = this.osc('sine', o.f * (o.ratio ?? 2), t, d + 0.03);
    const mg = this.gain(0);
    const dev0 = o.f * (o.ratio ?? 2) * (o.idx ?? 2),
      dev1 = o.f * (o.ratio ?? 2) * (o.idx1 ?? 0.1);
    mg.gain.setValueAtTime(dev0, t);
    mg.gain.exponentialRampToValueAtTime(Math.max(dev1, EPS), t + d);
    mod.connect(mg);
    mg.connect(car.frequency);
    if (o.f1) {
      const r = o.f1 / o.f;
      car.frequency.setValueAtTime(o.f, t);
      car.frequency.exponentialRampToValueAtTime(o.f1, t + d);
      mod.frequency.setValueAtTime(o.f * (o.ratio ?? 2), t);
      mod.frequency.exponentialRampToValueAtTime(o.f * (o.ratio ?? 2) * r, t + d);
    }
    const g = this.gain(0);
    this._ahd(g, t, o, d);
    car.connect(g);
    return this.to(g, out, o.pan);
  }
  /** Call fn(time, index, 0..1) for n moments scattered over `span` seconds; pow > 1 crowds them early. */
  scatter(n, t, span, fn, pow = 1) {
    for (let i = 0; i < n; i++) {
      const u = Math.pow(this.rnd(), pow);
      fn(t + u * span, i, u);
    }
  }
}
