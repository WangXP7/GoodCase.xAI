// Ambience: rain beds (open asphalt, under the steel canopy), lamp buzz, distant thunder, and the
// generated impulse responses for the two reverb spaces. Generators are pure; createAmbience is the
// Web Audio runtime that loops the beds and crossfades them by area.
import {
  samples, filt, noise, normalize, fadeEdges, dcBlock, loopify, wobble, grain, bubble, impulseResponse, Biquad,
} from './synth.js';

const LOOP = 10, XF = 0.6;

// Rain on open wet asphalt: fine broadband hiss, dense tiny ticks, sparse splashes and bubble plinks,
// a low distant wash. Two decorrelated channels.
// Generators (function*) yield between stages so the synthesis queue can spread them across frames.
function* rainAsphalt(sr, rng) {
  const dur = LOOP + XF;
  const chans = [];
  for (let c = 0; c < 2; c++) {
    const L = samples(sr, dur), n = L.length;
    const hiss = noise(sr, dur, rng);
    filt(hiss, 'highpass', 700, 0.7, sr);
    yield;
    filt(hiss, 'lowpass', 9000, 0.7, sr);
    yield;
    const sw = wobble(n, sr, 0.5, rng);
    const wash = noise(sr, dur, rng);
    filt(wash, 'lowpass', 320, 0.7, sr, 2);
    yield;
    const ex = new Float32Array(n);
    const ticks = Math.round(1800 * dur);
    yield;
    for (let k = 0; k < ticks; k++) {
      const i = Math.floor(rng.next() * n);
      ex[i] += (rng.next() < 0.5 ? -1 : 1) * (0.03 + Math.pow(rng.next(), 5));
    }
    filt(ex, 'bandpass', 3800, 0.7, sr);
    yield;
    for (let i = 0; i < n; i++) L[i] = hiss[i] * 0.2 * (1 + 0.15 * sw[i]) + wash[i] * 0.5 + ex[i] * 0.9;
    yield;
    const splats = Math.round(35 * dur);
    for (let k = 0; k < splats; k++) {
      const at = rng.next() * (n - 0.1 * sr);
      if (rng.next() < 0.6) bubble(sr, L, at, { freq: rng.range(1300, 4200), tau: rng.range(0.003, 0.009), amp: rng.range(0.01, 0.06), rise: rng.range(0.15, 0.6) });
      else grain(sr, rng, L, at, { freq: rng.range(2000, 7000), q: 0.8, tau: rng.range(0.002, 0.006), amp: rng.range(0.03, 0.12) });
    }
    chans.push(loopify(dcBlock(L, sr), sr, XF));
    yield;
  }
  return normalize(chans, 0.5);
}

// Rain drumming on the steel canopy deck overhead, plus heavy drips off its edge into puddles.
function* rainCanopy(sr, rng) {
  const dur = LOOP + XF;
  const chans = [];
  for (let c = 0; c < 2; c++) {
    const n = Math.ceil(dur * sr), L = new Float32Array(n);
    const ex = new Float32Array(n);
    const hits = Math.round(2600 * dur);
    for (let k = 0; k < hits; k++) {
      const i = Math.floor(rng.next() * n);
      ex[i] += (rng.next() < 0.5 ? -1 : 1) * (0.05 + Math.pow(rng.next(), 3));
    }
    const res = [[300, 5, 1.0], [505, 7, 0.9], [830, 7, 0.75], [1340, 5, 0.6], [2150, 3, 0.45], [4200, 1.2, 0.3]]
      .map(([f, q, g]) => ({ b: new Biquad('bandpass', f * rng.range(0.97, 1.03), q, sr), g }));
    yield;
    const roar = noise(sr, dur, rng);
    filt(roar, 'bandpass', 650, 0.5, sr);
    const rw = wobble(n, sr, 0.35, rng);
    yield;
    for (let i = 0; i < n; i++) {
      let y = 0;
      for (const r of res) y += r.b.process(ex[i]) * r.g;
      L[i] = y * 0.7 + roar[i] * 0.12 * (1 + 0.2 * rw[i]);
      if (i % 60000 === 59999) yield;
    }
    const drips = Math.round(5 * dur);
    for (let k = 0; k < drips; k++) {
      const at = rng.next() * (n - 0.2 * sr);
      bubble(sr, L, at, { freq: rng.range(700, 1500), tau: rng.range(0.012, 0.025), amp: rng.range(0.05, 0.14), rise: 0.35 });
      grain(sr, rng, L, at, { freq: 220, q: 0.7, tau: 0.012, amp: rng.range(0.1, 0.25), type: 'lowpass' });
      grain(sr, rng, L, at, { freq: 2500, q: 0.6, tau: 0.01, amp: rng.range(0.05, 0.12), type: 'highpass' });
    }
    chans.push(loopify(dcBlock(L, sr), sr, XF));
    yield;
  }
  return normalize(chans, 0.5);
}

// Distant thunder: no crack (too far), several rolling low-frequency bursts over 5-7 s.
function* thunder(sr, rng) {
  const dur = rng.range(6.5, 8);
  const bumps = [];
  let t = rng.range(0.2, 0.5);
  const count = 5 + Math.floor(rng.next() * 4);
  for (let k = 0; k < count; k++) {
    bumps.push([t, rng.range(0.15, 0.6), (k === 0 ? 0.6 : 1) * rng.range(0.4, 1) * Math.exp(-k * 0.18)]);
    t += rng.range(0.2, 0.9);
  }
  const chans = [];
  for (let c = 0; c < 2; c++) {
    const low = noise(sr, dur, rng), mid = noise(sr, dur, rng);
    filt(low, 'lowpass', 140, 0.7, sr, 2);
    yield;
    filt(mid, 'lowpass', 750, 0.7, sr, 2);
    filt(mid, 'highpass', 120, 0.7, sr);
    yield;
    const flick = wobble(low.length, sr, 6, rng);
    const L = new Float32Array(low.length);
    let e = 0;
    for (let i = 0; i < L.length; i++) {
      if ((i & 63) === 0) {
        const x = i / sr;
        e = 0;
        for (const [c, w, a] of bumps) {
          const d = (x - c) / w;
          e += a * (d < 0 ? Math.exp(-d * d * 4) : Math.exp(-d * 0.9));
        }
      }
      L[i] = (low[i] * 1.2 + mid[i] * 1.1 * (0.5 + 0.5 * flick[i])) * e;
    }
    yield;
    chans.push(fadeEdges(dcBlock(L, sr), sr, 0.05, 0.8));
    yield;
  }
  return normalize(chans, 0.9);
}

// Sodium lamp / canopy ballast: 120 Hz hum with odd harmonics from magnetostriction and a faint
// arc hiss. 4 s = 480 whole cycles, so the tonal part loops seamlessly.
function lampBuzz(sr, rng) {
  const dur = 4;
  const hiss = noise(sr, dur + 0.3, rng);
  filt(hiss, 'bandpass', 5200, 0.8, sr);
  const hl = loopify(hiss, sr, 0.3);
  const L = samples(sr, dur), flick = wobble(L.length, sr, 3, rng);
  const T = 2 * Math.PI * 120;
  for (let i = 0; i < L.length; i++) {
    const t = i / sr;
    const s = Math.sin(T * t);
    L[i] = 0.35 * s + 0.25 * Math.sin(2 * T * t) + 0.25 * Math.tanh(7 * s) * 0.6 + 0.08 * Math.sin(3 * T * t + 0.4) + hl[i] * 0.06;
    L[i] *= 1 + 0.06 * flick[i];
  }
  filt(L, 'highpass', 90, 0.7, sr);
  // The first samples of a high-pass carry a transient; smooth it so the loop point is clean.
  for (let i = 0; i < 0.01 * sr; i++) L[i] = L[i + Math.round(sr / 120) * 4] * (1 - i / (0.01 * sr)) + L[i] * (i / (0.01 * sr));
  return normalize(L, 0.8);
}

// Rain on a roof overhead, heard from inside: a dull, dense patter with the top gone, a few drips
// from a leak somewhere in the room.
function* rainRoof(sr, rng) {
  const dur = LOOP + XF, chans = [];
  for (let c = 0; c < 2; c++) {
    const n = Math.ceil(dur * sr), L = new Float32Array(n), ex = new Float32Array(n);
    const hits = Math.round(3200 * dur);
    for (let k = 0; k < hits; k++) ex[Math.floor(rng.next() * n)] += (rng.next() < 0.5 ? -1 : 1) * (0.05 + Math.pow(rng.next(), 3));
    yield;
    const res = [[140, 3, 1.0], [260, 4, 0.8], [520, 3, 0.5], [900, 2, 0.25]].map(([f, q, g]) => ({ b: new Biquad('bandpass', f * rng.range(0.97, 1.03), q, sr), g }));
    for (let i = 0; i < n; i++) {
      let y = 0;
      for (const r of res) y += r.b.process(ex[i]) * r.g;
      L[i] = y;
      if (i % 60000 === 59999) yield;
    }
    filt(L, 'lowpass', 1400, 0.7, sr);
    for (let k = 0; k < Math.round(1.5 * dur); k++) bubble(sr, L, rng.next() * (n - 0.1 * sr), { freq: rng.range(900, 1500), tau: 0.015, amp: rng.range(0.04, 0.08), rise: 0.3 });
    chans.push(loopify(dcBlock(L, sr), sr, XF));
    yield;
  }
  return normalize(chans, 0.5);
}

// Rain on the tin roof of the motel's walkway: thin, bright ringing patter.
function* rainTin(sr, rng) {
  const dur = LOOP + XF, chans = [];
  for (let c = 0; c < 2; c++) {
    const n = Math.ceil(dur * sr), L = new Float32Array(n), ex = new Float32Array(n);
    const hits = Math.round(2200 * dur);
    for (let k = 0; k < hits; k++) ex[Math.floor(rng.next() * n)] += (rng.next() < 0.5 ? -1 : 1) * (0.05 + Math.pow(rng.next(), 3));
    yield;
    const res = [[620, 12, 0.6], [1180, 14, 0.7], [1930, 12, 0.6], [2870, 10, 0.5], [4300, 6, 0.4], [6100, 3, 0.3]].map(([f, q, g]) => ({ b: new Biquad('bandpass', f * rng.range(0.97, 1.03), q, sr), g }));
    for (let i = 0; i < n; i++) {
      let y = 0;
      for (const r of res) y += r.b.process(ex[i]) * r.g;
      L[i] = y;
      if (i % 60000 === 59999) yield;
    }
    for (let k = 0; k < Math.round(4 * dur); k++) grain(sr, rng, L, rng.next() * (n - 0.05 * sr), { freq: 2500, q: 0.6, tau: 0.008, amp: rng.range(0.05, 0.1), type: 'highpass' });
    chans.push(loopify(dcBlock(L, sr), sr, XF));
    yield;
  }
  return normalize(chans, 0.5);
}

// Rain on a car body: hollow drumming on thin steel panels and ticking on glass (mono: played at
// the nearest car).
function* rainCar(sr, rng) {
  const dur = 6 + XF, n = Math.ceil(dur * sr), L = new Float32Array(n), ex = new Float32Array(n);
  for (let k = 0; k < Math.round(1500 * dur); k++) ex[Math.floor(rng.next() * n)] += (rng.next() < 0.5 ? -1 : 1) * (0.05 + Math.pow(rng.next(), 3));
  yield;
  const res = [[180, 6, 1.0], [340, 8, 0.8], [610, 8, 0.6], [1050, 6, 0.4], [3800, 2, 0.5]].map(([f, q, g]) => ({ b: new Biquad('bandpass', f * rng.range(0.97, 1.03), q, sr), g }));
  for (let i = 0; i < n; i++) {
    let y = 0;
    for (const r of res) y += r.b.process(ex[i]) * r.g;
    L[i] = y;
    if (i % 60000 === 59999) yield;
  }
  return normalize(loopify(dcBlock(L, sr), sr, XF), 0.6);
}

// Neon tubes once the power is on: a thinner, higher buzz than the sodium ballasts, with a crackle.
function neonBuzz(sr, rng) {
  const dur = 4, L = samples(sr, dur), T = 2 * Math.PI * 120, flick = wobble(L.length, sr, 7, rng);
  for (let i = 0; i < L.length; i++) {
    const t = i / sr, s = Math.sin(T * t);
    L[i] = 0.2 * s + 0.3 * Math.sin(2 * T * t) + 0.25 * Math.sin(4 * T * t + 0.3) + 0.15 * Math.sign(s) * 0.4;
    L[i] *= 1 + 0.1 * flick[i];
  }
  for (let k = 0; k < 10; k++) grain(sr, rng, L, rng.next() * (L.length - 0.01 * sr), { freq: 5000, q: 0.8, tau: 0.0008, amp: 0.4 });
  filt(L, 'highpass', 100, 0.7, sr);
  for (let i = 0; i < 0.01 * sr; i++) L[i] = L[i + Math.round(sr / 120) * 4] * (1 - i / (0.01 * sr)) + L[i] * (i / (0.01 * sr));
  return normalize(L, 0.8);
}

const ir = (o) => ({ variants: 1, gen: (sr, rng) => impulseResponse(sr, rng, o) });

export const AMBIENCE = {
  rain_asphalt: { variants: 1, gen: (sr, rng) => rainAsphalt(sr, rng) },
  rain_canopy: { variants: 1, gen: (sr, rng) => rainCanopy(sr, rng) },
  rain_roof: { variants: 1, gen: (sr, rng) => rainRoof(sr, rng) },
  rain_tin: { variants: 1, gen: (sr, rng) => rainTin(sr, rng) },
  rain_car: { variants: 1, gen: (sr, rng) => rainCar(sr, rng) },
  thunder: { variants: 2, gen: (sr, rng) => thunder(sr, rng) },
  lamp_buzz: { variants: 1, gen: (sr, rng) => lampBuzz(sr, rng) },
  neon_buzz: { variants: 1, gen: (sr, rng) => neonBuzz(sr, rng) },
  ir_open: ir({
    seconds: 2.4, t60: 1.7, predelay: 0.02, build: 0.08, bright: 0.1, earlyHz: 900,
    early: [[0.034, 0.4], [0.07, 0.3], [0.112, 0.25], [0.16, 0.2], [0.24, 0.14], [0.35, 0.08]],
  }),
  ir_canopy: ir({
    seconds: 1.4, t60: 0.95, predelay: 0.004, build: 0.01, bright: 0.3, earlyHz: 1200,
    early: [[0.012, 0.5], [0.029, 0.45], [0.041, 0.3], [0.058, 0.3], [0.087, 0.2]],
    flutter: { period: 0.029, gain: 0.45 },
  }),
  // Diner dining room: 13 x 11 m, tile floor, glass front, vinyl booths: lively but not long.
  ir_diner: ir({
    seconds: 1.2, t60: 0.85, predelay: 0.006, build: 0.012, bright: 0.45, earlyHz: 1800,
    early: [[0.009, 0.6], [0.017, 0.5], [0.026, 0.45], [0.034, 0.35], [0.049, 0.3], [0.065, 0.2]],
  }),
  // Kitchen: small, hard, steel everywhere: bright, short, a ring.
  ir_kitchen: ir({
    seconds: 0.9, t60: 0.6, predelay: 0.003, build: 0.006, bright: 0.6, earlyHz: 2600,
    early: [[0.005, 0.6], [0.011, 0.55], [0.016, 0.45], [0.023, 0.4], [0.031, 0.3]],
    flutter: { period: 0.017, gain: 0.25 },
  }),
  // Motel room: small, carpet and bed, soft furnishings: dead and dark.
  ir_motelRoom: ir({
    seconds: 0.6, t60: 0.32, predelay: 0.002, build: 0.004, bright: 0.1, earlyHz: 900,
    early: [[0.004, 0.5], [0.008, 0.4], [0.013, 0.3], [0.019, 0.2]],
  }),
  // Under the walkway: a concrete slab overhead, open to the lot on one side.
  ir_walkway: ir({
    seconds: 1.3, t60: 0.9, predelay: 0.004, build: 0.01, bright: 0.25, earlyHz: 1300,
    early: [[0.006, 0.55], [0.017, 0.45], [0.03, 0.3], [0.05, 0.25], [0.09, 0.12]],
    flutter: { period: 0.017, gain: 0.3 },
  }),
  // The garage bays: a big steel shed, long and boomy.
  ir_garage: ir({
    seconds: 2.4, t60: 1.9, predelay: 0.012, build: 0.03, bright: 0.25, earlyHz: 1000,
    early: [[0.022, 0.5], [0.041, 0.45], [0.063, 0.35], [0.09, 0.3], [0.13, 0.2], [0.19, 0.12]],
  }),
  // The scrapyard: open air hemmed in by stacks of steel: discrete metallic slaps, quick decay.
  ir_scrapyard: ir({
    seconds: 1.9, t60: 1.3, predelay: 0.015, build: 0.05, bright: 0.2, earlyHz: 1400,
    early: [[0.028, 0.45], [0.047, 0.4], [0.081, 0.35], [0.12, 0.25], [0.17, 0.2], [0.26, 0.1]],
  }),
};

// The eight acoustic spaces. ir: the convolver's response; ret: reverb return level; tail: which
// gunshot tail family plays there; floor: footsteps when the step reports no surface of its own;
// beds: gain per ambience bed (before BED_GAIN); lp: low-pass on the ambience (what comes in from
// outside through walls and glass).
export const AREAS = {
  open: { ir: 'ir_open', ret: 0.55, tail: 'open', floor: 'asphalt', lp: 20000, beds: { rain_asphalt: 1.0, rain_canopy: 0.14 } },
  canopy: { ir: 'ir_canopy', ret: 0.55, tail: 'canopy', floor: 'concrete', lp: 20000, beds: { rain_asphalt: 0.5, rain_canopy: 1.0, lamp_buzz: 1.0 } },
  diner: { ir: 'ir_diner', ret: 0.5, tail: 'room', floor: 'tile', lp: 1800, beds: { rain_asphalt: 0.35, rain_roof: 1.0, neon_buzz: 0.5 } },
  kitchen: { ir: 'ir_kitchen', ret: 0.45, tail: 'room', floor: 'tile', lp: 1500, beds: { rain_asphalt: 0.25, rain_roof: 0.9, neon_buzz: 0.2 } },
  motelRoom: { ir: 'ir_motelRoom', ret: 0.4, tail: 'room', floor: 'carpet', lp: 1200, beds: { rain_asphalt: 0.3, rain_roof: 0.8 } },
  walkway: { ir: 'ir_walkway', ret: 0.5, tail: 'canopy', floor: 'concrete', lp: 20000, beds: { rain_asphalt: 0.7, rain_tin: 1.0 } },
  garage: { ir: 'ir_garage', ret: 0.55, tail: 'room', floor: 'concrete', lp: 2200, beds: { rain_asphalt: 0.3, rain_canopy: 0.55, rain_roof: 0.5 } },
  scrapyard: { ir: 'ir_scrapyard', ret: 0.5, tail: 'open', floor: 'dirt', lp: 20000, beds: { rain_asphalt: 1.0, rain_canopy: 0.1 } },
};
export const AREA_NAMES = Object.keys(AREAS);

// Bed levels (linear, before the ambience bus).
const BED_GAIN = { rain_asphalt: 0.14, rain_canopy: 0.13, rain_roof: 0.2, rain_tin: 0.08, lamp_buzz: 0.006, neon_buzz: 0.008 };
const BEDS = Object.keys(BED_GAIN);

// Runtime. getBuffer(name) -> AudioBuffer|null (null while still synthesising). Beds start once their
// buffer exists, cross-fade by area in 0.3 s, and the neon bed only plays with the power on.
export function createAmbience(ctx, out, getBuffer, rng, { autoThunder = true, playThunder }) {
  const beds = {};
  let area = 'open', power = false;
  let nextThunder = rng.range(12, 25);
  // what comes in from outside is low-passed indoors
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 20000; lp.Q.value = 0.5;
  lp.connect(out);
  const level = (name, a) => BED_GAIN[name] * (AREAS[a].beds[name] || 0) * (name === 'neon_buzz' && !power ? 0 : 1);
  // beds that come from overhead or inside the room bypass the outside low-pass
  const inside = (name) => name === 'rain_roof' || name === 'rain_tin' || name === 'lamp_buzz' || name === 'neon_buzz';

  function startBeds(when, fade = 0.8) {
    for (let k = 0; k < BEDS.length; k++) {
      const name = BEDS[k];
      if (beds[name]) continue;
      const buf = getBuffer(name);
      if (!buf) continue;
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.setTargetAtTime(level(name, area), when, fade);
      src.connect(g).connect(inside(name) ? out : lp);
      src.start(when, rng.next() * buf.duration);
      beds[name] = { src, g };
    }
  }
  function apply(when, tau) {
    for (const name in beds) {
      const b = beds[name];
      b.g.gain.cancelScheduledValues(when);
      b.g.gain.setTargetAtTime(level(name, area), when, tau);
    }
    lp.frequency.cancelScheduledValues(when);
    lp.frequency.setTargetAtTime(AREAS[area].lp, when, tau);
  }

  return {
    get area() { return area; },
    start(when = ctx.currentTime, fade = 0.8) { startBeds(when, fade); },
    setArea(a, when = ctx.currentTime) {
      if (!AREAS[a]) return;
      area = a;
      apply(when, 0.1); // about 0.3 s to settle
    },
    setPower(on, when = ctx.currentTime) {
      if (power === !!on) return;
      power = !!on;
      apply(when + (on ? 0.6 : 0), on ? 0.4 : 0.05);
    },
    update(now) {
      startBeds(now); // picks up beds whose buffers finished synthesising after start
      if (autoThunder && now >= nextThunder) {
        playThunder(now);
        nextThunder = now + rng.range(25, 60);
      }
    },
    stop() { for (const name in beds) { try { beds[name].src.stop(); } catch { /* already stopped */ } } },
  };
}
