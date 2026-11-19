// Adaptive music bed (first in the cut order): three sparse loops, not a tune. A low drone
// (always under the round), a muffled pulse that comes in as the lot fills, and a thin high cluster
// for the last quarter of a round. Intensity follows alive / maxAlive and the round's last quarter.
// Off by default on the `mobile` tier. G.audio.music = { intensity, enabled }.
import { samples, filt, noise, normalize, dcBlock, loopify, wobble, chirp, envAD, grain, modal, Biquad } from './synth.js';

const LOOP = 12, XF = 0.8;

// A1 and E2 detuned saws, low-passed, the filter breathing slowly.
function* drone(sr, rng) {
  const dur = LOOP + XF, n = Math.ceil(dur * sr), out = new Float32Array(n);
  const fs = [55, 55.25, 82.4, 82.1, 110.2];
  const ph = fs.map(() => rng.next());
  for (let i = 0; i < n; i++) {
    let y = 0;
    for (let k = 0; k < fs.length; k++) { ph[k] += fs[k] / sr; y += (2 * (ph[k] % 1) - 1) * (k === 4 ? 0.3 : 1); }
    out[i] = y * 0.2;
  }
  yield;
  const w = wobble(n, sr, 0.15, rng);
  const lfoLP = (u) => 180 + 140 * (0.5 + 0.5 * w[Math.min(n - 1, Math.floor(u * n))]);
  // swept low-pass, twice for a steeper slope
  for (let pass = 0; pass < 2; pass++) {
    const b = new Biquad('lowpass', lfoLP(0), 0.9, sr);
    for (let i = 0; i < n; i++) { if ((i & 63) === 0) b.set(lfoLP(i / n)); out[i] = b.process(out[i]); }
    yield;
  }
  const br = noise(sr, dur, rng);
  filt(br, 'bandpass', 400, 0.5, sr);
  for (let i = 0; i < n; i++) out[i] += br[i] * 0.02;
  return normalize(loopify(dcBlock(out, sr), sr, XF), 0.7);
}

// A heartbeat through a wall at 80 bpm (16 beats in 12 s), with a faint metal tick between.
function pulse(sr, rng) {
  const dur = LOOP + XF, out = samples(sr, dur);
  const beat = 0.75;
  for (let b = 0; b * beat < dur; b++) {
    for (const [off, a] of [[0, 1], [0.22, 0.6]]) chirp(sr, 0.25, (t) => 48 + 30 * Math.exp(-t / 0.02), (t) => a * envAD(t, 0.004, 0.06), out, Math.round((b * beat + off) * sr));
    if (b % 2 === 1) modal(sr, 0, [[rng.range(2100, 2300), 0.05, 0.04], [3500, 0.03, 0.02]], rng, out, Math.round((b * beat + beat / 2) * sr));
  }
  filt(out, 'lowpass', 900, 0.7, sr);
  return normalize(loopify(dcBlock(out, sr), sr, XF), 0.7);
}

// Three close high partials with a slow tremolo: a held breath.
function high(sr, rng) {
  const dur = LOOP + XF, out = samples(sr, dur), n = out.length;
  const w = wobble(n, sr, 0.3, rng);
  for (const f of [880, 933, 1047]) {
    let ph = rng.next() * 6.28;
    for (let i = 0; i < n; i++) { ph += (2 * Math.PI * f * (1 + 0.002 * w[i])) / sr; out[i] += Math.sin(ph) * 0.2 * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.25 * i / sr + f)); }
  }
  for (let k = 0; k < 20; k++) grain(sr, rng, out, rng.next() * (n - 0.05 * sr), { freq: rng.range(4000, 7000), q: 2, tau: 0.01, amp: 0.02 });
  return normalize(loopify(dcBlock(out, sr), sr, XF), 0.5);
}

export const MUSIC_SFX = {
  music_drone: { variants: 1, gen: (sr, rng) => drone(sr, rng) },
  music_pulse: { variants: 1, gen: (sr, rng) => pulse(sr, rng) },
  music_high: { variants: 1, gen: (sr, rng) => high(sr, rng) },
};
export const MUSIC_NAMES = Object.keys(MUSIC_SFX);

const LEVEL = { music_drone: 0.08, music_pulse: 0.07, music_high: 0.025 };
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// The bed's gains for an intensity 0..1 and the last-quarter flag (pure; tested).
export function musicMix(intensity, lastQuarter, out = {}) {
  const i = Math.max(0, Math.min(1, intensity || 0));
  out.music_drone = 0.5 + 0.5 * i;
  out.music_pulse = smooth(0.25, 0.75, i);
  out.music_high = lastQuarter ? 0.5 + 0.5 * i : 0.4 * smooth(0.8, 1, i);
  return out;
}

// Intensity from the game: alive / maxAlive, raised in the round's last quarter (pure; tested).
export function musicIntensity(alive, maxAlive, killed, total) {
  const crowd = maxAlive > 0 ? Math.min(1, (alive || 0) / maxAlive) : 0;
  const late = total > 0 && killed / total >= 0.75;
  return { intensity: late ? Math.max(crowd, 0.5) : crowd, lastQuarter: late };
}

// Runtime: loops start when their buffers exist and `enabled`; gains glide (2 s) to the mix.
export function createMusic(ctx, out, getBuffer) {
  const loops = {};
  const mix = {};
  const bus = ctx.createGain();
  bus.gain.value = 0;
  bus.connect(out);
  let on = false;
  return {
    bus,
    update(now, enabled, playing, intensity, lastQuarter) {
      const want = enabled && playing;
      if (want !== on) { on = want; bus.gain.cancelScheduledValues(now); bus.gain.setTargetAtTime(want ? 1 : 0, now, want ? 1.5 : 0.4); }
      if (!enabled) return;
      musicMix(intensity, lastQuarter, mix);
      for (let k = 0; k < MUSIC_NAMES.length; k++) {
        const name = MUSIC_NAMES[k];
        let l = loops[name];
        if (!l) {
          const buf = getBuffer(name);
          if (!buf) continue;
          const src = ctx.createBufferSource();
          src.buffer = buf; src.loop = true;
          const g = ctx.createGain(); g.gain.value = 0;
          src.connect(g).connect(bus);
          src.start(now);
          l = loops[name] = { g, target: -1 };
        }
        const target = LEVEL[name] * mix[name];
        if (Math.abs(target - l.target) > 0.002) { l.target = target; l.g.gain.setTargetAtTime(target, now, 2); }
      }
    },
  };
}
