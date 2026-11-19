// One-shot sound effects: weapon, foley, impacts, zombie voices, UI. Each entry is a pure generator
// (sampleRate, rng, variantIndex) -> Float32Array (mono, positional) or [L, R] (stereo, non-positional).
import {
  samples, white, filt, sweep, noise, envAD, mixInto, normalize, saturate, fadeEdges, dcBlock,
  modal, chirp, grain, bubble, voice, VOWELS, lerpVowel, wobble, Biquad,
} from './synth.js';

const exp = Math.exp;

// ---------------------------------------------------------------- weapon

// Pistol, dry layers only: supersonic crack, muzzle blast body, low thump, slide mechanics.
// The environment tail is a separate buffer (open lot vs under the canopy) so it follows the area.
function pistol(sr, rng) {
  const out = samples(sr, 0.42);
  const n = out.length;
  const crack = new Float32Array(n), blast = new Float32Array(n), body = new Float32Array(n), low = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr, w = white(rng);
    crack[i] = w * exp(-t / 0.0016);
    blast[i] = white(rng) * envAD(t, 0.0008, 0.018);
    body[i] = white(rng) * envAD(t, 0.0005, 0.05);
    low[i] = white(rng) * envAD(t, 0.002, 0.11);
  }
  filt(crack, 'highpass', 2600, 0.7, sr, 2);
  filt(blast, 'lowpass', 4500, 0.7, sr);
  filt(blast, 'peaking', 1200, 0.8, sr, 1, 4);
  filt(body, 'bandpass', rng.range(230, 290), 1.4, sr);
  filt(low, 'lowpass', 140, 0.8, sr, 2);
  filt(low, 'highpass', 60, 0.7, sr);
  mixInto(out, crack, 0, 4.0);
  mixInto(out, blast, 0, 1.0);
  mixInto(out, body, 0, 4.5);
  mixInto(out, low, 0, 0.5);
  // Pressure thump: fast downward pitch sweep through the body range.
  const f0 = rng.range(160, 200);
  chirp(sr, 0.3, (t) => 150 + f0 * exp(-t / 0.012), (t) => 0.3 * envAD(t, 0.0008, 0.035), out);
  normalize(out, 1);
  saturate(out, 1.8);
  // Slide cycling: back (~9 ms) and into battery (~48 ms), small steel clicks.
  const click = (at, base, amp) => {
    modal(sr, 0, [[base, 0.006, 1], [base * 1.58, 0.005, 0.7], [base * 2.27, 0.004, 0.5], [base * 3.1, 0.003, 0.35]], rng, out, Math.round(at * sr), amp);
    grain(sr, rng, out, at * sr, { freq: 5000, q: 0.6, tau: 0.0008, amp: amp * 1.5 });
  };
  click(0.009 + rng.range(0, 0.002), rng.range(2200, 2600), 0.09);
  click(0.046 + rng.range(0, 0.004), rng.range(1800, 2100), 0.11);
  dcBlock(out, sr);
  fadeEdges(out, sr, 0, 0.08);
  return normalize(out, 0.95);
}

// Outdoor tail: rolling, low-passed slapback from the store front, trucks and treeline.
function tailOpen(sr, rng) {
  const dur = 1.6;
  const chans = [0, 1].map((c) => {
    const L = samples(sr, dur);
    const rumble = noise(sr, dur, rng), mid = noise(sr, dur, rng);
    filt(rumble, 'lowpass', 160, 0.7, sr, 2);
    sweep(mid, 'lowpass', (u) => 2400 * exp(-u * 3.2) + 250, 0.7, sr);
    const wob = wobble(L.length, sr, 14, rng);
    for (let i = 0; i < L.length; i++) {
      const t = i / sr, e = envAD(t - 0.012, 0.05, 0.17) * (0.8 + 0.2 * wob[i]);
      L[i] = rumble[i] * 2.2 * e + mid[i] * 0.9 * e;
    }
    // Discrete echoes off nearby surfaces.
    const echoes = [[0.068, 0.55], [0.124, 0.4], [0.19, 0.35], [0.29, 0.22], [0.43, 0.14], [0.61, 0.08]];
    for (const [d, a] of echoes) {
      const at = (d + rng.range(-0.008, 0.008) + c * 0.006) * sr;
      grain(sr, rng, L, at, { freq: rng.range(500, 900), q: 0.5, tau: 0.02, amp: a * 1.3, type: 'lowpass' });
    }
    fadeEdges(L, sr, 0.004, 0.25);
    return L;
  });
  return normalize(chans, 0.9);
}

// Under the canopy: flutter echo between wet concrete and the metal roof (~5 m), metallic ring.
function tailCanopy(sr, rng) {
  const dur = 1.2;
  const chans = [0, 1].map((c) => {
    const L = samples(sr, dur);
    const ex = samples(sr, dur);
    for (let i = 0; i < 0.006 * sr; i++) ex[i] = white(rng) * exp(-i / (0.0015 * sr));
    filt(ex, 'bandpass', 1400, 0.5, sr);
    const D = Math.round((0.029 + c * 0.0011) * sr), g = 0.8, lp = new Biquad('lowpass', 2800, 0.6, sr);
    for (let i = 0; i < L.length; i++) L[i] = ex[i] + (i >= D ? lp.process(L[i - D]) * g : 0);
    const diffuse = noise(sr, dur, rng);
    sweep(diffuse, 'lowpass', (u) => 3500 * exp(-u * 2.5) + 400, 0.7, sr);
    for (let i = 0; i < L.length; i++) L[i] += diffuse[i] * envAD(i / sr - 0.005, 0.02, 0.13) * 0.35;
    modal(sr, dur, [[rng.range(170, 190), 0.25, 0.05], [rng.range(400, 430), 0.18, 0.04], [rng.range(680, 720), 0.12, 0.03]], rng, L);
    fadeEdges(L, sr, 0.002, 0.2);
    return L;
  });
  return normalize(chans, 0.9);
}

function dryFire(sr, rng) {
  const out = samples(sr, 0.18);
  // Trigger pull: soft plastic tick, then hammer/striker fall on an empty chamber.
  grain(sr, rng, out, 0, { freq: 2800, q: 1.2, tau: 0.0015, amp: 0.25 });
  const at = rng.range(0.028, 0.036) * sr;
  modal(sr, 0, [[3100, 0.008, 1], [4700, 0.006, 0.7], [6900, 0.004, 0.5], [1250, 0.012, 0.4]], rng, out, Math.round(at), 0.5);
  grain(sr, rng, out, at, { freq: 6000, q: 0.5, tau: 0.0007, amp: 1.2 });
  grain(sr, rng, out, at, { freq: 260, q: 1, tau: 0.01, amp: 0.8, type: 'lowpass' });
  return normalize(dcBlock(out, sr), 0.9);
}

// Reload foley, 1.6 s to match tuning.pistol.reload: release, mag out, handling, mag in, seat, slide.
function reload(sr, rng) {
  const out = samples(sr, 1.6);
  const friction = (at, dur, f, amp) => {
    const s = noise(sr, dur, rng);
    filt(s, 'bandpass', f, 0.9, sr);
    const wob = wobble(s.length, sr, 60, rng);
    for (let i = 0; i < s.length; i++) { const u = i / s.length; s[i] *= Math.sin(Math.PI * u) * (0.6 + 0.4 * wob[i]); }
    mixInto(out, s, at * sr, amp);
  };
  const click = (at, base, amp, thud = 0) => {
    modal(sr, 0, [[base, 0.007, 1], [base * 1.47, 0.006, 0.8], [base * 2.15, 0.004, 0.6], [base * 3.3, 0.003, 0.4]], rng, out, Math.round(at * sr), amp);
    grain(sr, rng, out, at * sr, { freq: 5500, q: 0.6, tau: 0.0006, amp: amp * 1.2 });
    if (thud) grain(sr, rng, out, at * sr, { freq: 220, q: 0.8, tau: 0.018, amp: thud, type: 'lowpass' });
  };
  click(0.08, 2600, 0.35);                       // magazine release
  friction(0.12, 0.13, 1800, 0.25);              // magazine slides out
  click(0.25, 1500, 0.15, 0.6);                  // falls clear / caught
  friction(0.45, 0.22, 900, 0.08);               // cloth / hand
  friction(0.72, 0.11, 2200, 0.25);              // new magazine in
  click(0.84, 1900, 0.45, 1.2);                  // seats
  friction(1.12, 0.15, 3000, 0.22);              // slide pulled back
  click(1.27, 2300, 0.3);                        // slide at rear
  click(1.4, 1700, 0.6, 1.0);                    // slide slams forward
  return normalize(dcBlock(out, sr), 0.9);
}

// Brass casing on wet asphalt: a few damped bounces with free-bar mode ratios, then a short roll.
function casing(sr, rng) {
  const out = samples(sr, 0.7);
  const base = rng.range(2900, 3500);
  let t = rng.range(0, 0.01), amp = 1, gap = rng.range(0.1, 0.13);
  for (let b = 0; b < 5; b++) {
    const k = rng.range(0.97, 1.03);
    modal(sr, 0, [[base * k, 0.045, 1], [base * 2.76 * k, 0.022, 0.6], [base * 5.4 * k, 0.01, 0.35]], rng, out, Math.round(t * sr), amp);
    grain(sr, rng, out, t * sr, { freq: 7000, q: 0.7, tau: 0.0005, amp: amp * 0.8 });
    t += gap; gap *= rng.range(0.6, 0.72); amp *= rng.range(0.45, 0.6);
  }
  for (let r = 0; r < 8; r++) grain(sr, rng, out, (t + r * 0.018) * sr, { freq: base * 1.1, q: 4, tau: 0.004, amp: 0.05 });
  return normalize(out, 0.9);
}

// ---------------------------------------------------------------- footsteps

function footstep(sr, rng, surface) {
  const wet = surface === 'asphalt' ? 1 : 0.3;
  const out = samples(sr, 0.32);
  const n = out.length;
  const heel = new Float32Array(n), scuff = new Float32Array(n), spray = new Float32Array(n);
  const toe = rng.range(0.055, 0.085);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    heel[i] = white(rng) * envAD(t, 0.001, surface === 'concrete' ? 0.008 : 0.013);
    scuff[i] = white(rng) * (envAD(t, 0.003, 0.022) + 0.6 * envAD(t - toe, 0.004, 0.03));
    spray[i] = white(rng) * envAD(t - 0.004, 0.004, 0.045);
  }
  filt(heel, 'lowpass', surface === 'concrete' ? 420 : 280, 0.9, sr, 2);
  filt(scuff, 'bandpass', surface === 'concrete' ? 1600 : 2400, 0.8, sr);
  filt(spray, 'highpass', 1400, 0.7, sr);
  mixInto(out, heel, 0, 9);
  mixInto(out, scuff, 0, surface === 'concrete' ? 0.55 : 0.35);
  mixInto(out, spray, 0, 0.1 * wet);
  const thumpF = rng.range(85, 110);
  chirp(sr, 0.08, () => thumpF, (t) => 0.3 * envAD(t, 0.001, 0.018), out);
  if (surface === 'concrete') grain(sr, rng, out, 0, { freq: 3500, q: 0.8, tau: 0.0007, amp: 0.3 });
  // Water: small drops and bubble plinks thrown up by the sole.
  const drops = Math.round((surface === 'asphalt' ? 14 : 4) + rng.range(0, 6));
  for (let d = 0; d < drops; d++) {
    const at = (0.004 + Math.pow(rng.next(), 2) * 0.14) * sr;
    if (rng.next() < 0.5) bubble(sr, out, at, { freq: rng.range(1200, 3200), tau: rng.range(0.004, 0.01), amp: rng.range(0.03, 0.08) * wet, rise: rng.range(0.15, 0.5) });
    else grain(sr, rng, out, at, { freq: rng.range(1800, 4500), q: 1.5, tau: 0.0012, amp: rng.range(0.04, 0.12) * wet });
  }
  return normalize(dcBlock(out, sr), 0.9);
}

// ---------------------------------------------------------------- impacts

function impactHard(sr, rng, i) {
  const out = samples(sr, i === 3 ? 0.55 : 0.35);
  grain(sr, rng, out, 0, { freq: 3200, q: 0.6, tau: 0.0018, amp: 1.6 });
  grain(sr, rng, out, 0, { freq: 520, q: 0.8, tau: 0.012, amp: 5, type: 'lowpass' });
  grain(sr, rng, out, 0, { freq: 1100, q: 1.2, tau: 0.006, amp: 1.2 });
  // Debris: chips and grit falling back.
  const grains = 18 + Math.round(rng.range(0, 14));
  for (let g = 0; g < grains; g++) {
    const at = (0.006 + Math.pow(rng.next(), 1.6) * 0.25) * sr;
    grain(sr, rng, out, at, { freq: rng.range(1500, 5000), q: 2, tau: rng.range(0.001, 0.003), amp: rng.range(0.05, 0.25) * (1 - at / sr / 0.3) });
  }
  const dust = noise(sr, 0.3, rng);
  filt(dust, 'bandpass', 3500, 0.7, sr);
  for (let k = 0; k < dust.length; k++) dust[k] *= envAD(k / sr, 0.005, 0.06) * 0.12;
  mixInto(out, dust, 0);
  if (i === 3) {
    // Ricochet whine.
    const f0 = rng.range(2400, 3000);
    chirp(sr, 0.5, (t) => f0 * (1 - 0.35 * t) + 25 * Math.sin(t * 90), (t) => 0.1 * envAD(t - 0.01, 0.04, 0.14), out);
  }
  return normalize(dcBlock(out, sr), 0.9);
}

function impactMetal(sr, rng) {
  const out = samples(sr, 0.9);
  const b = rng.range(850, 1300);
  grain(sr, rng, out, 0, { freq: 2500, q: 0.5, tau: 0.0015, amp: 1.2, type: 'highpass' });
  modal(sr, 0, [[b, 0.32, 0.6], [b * 1.58, 0.2, 0.5], [b * 2.31, 0.14, 0.45], [b * 3.17, 0.09, 0.35], [b * 4.4, 0.05, 0.3], [b * 0.43, 0.18, 0.4]], rng, out);
  grain(sr, rng, out, 0, { freq: 300, q: 0.7, tau: 0.02, amp: 0.7, type: 'lowpass' });
  return normalize(dcBlock(out, sr), 0.9);
}

function impactGlass(sr, rng) {
  const out = samples(sr, 0.8);
  grain(sr, rng, out, 0, { freq: 3000, q: 0.5, tau: 0.002, amp: 1.3, type: 'highpass' });
  const shards = 45;
  for (let s = 0; s < shards; s++) {
    const at = Math.round((Math.pow(rng.next(), 1.4) * 0.55) * sr);
    const f = rng.range(2800, 9500), a = rng.range(0.05, 0.3) * (1 - at / sr / 0.7);
    modal(sr, 0, [[f, rng.range(0.008, 0.035), a], [f * 1.7, 0.01, a * 0.5]], rng, out, at);
  }
  return normalize(dcBlock(out, sr), 0.9);
}

// Bullet into a body: wet slap, low thud, squelch sweep. Head hits add a bone crack and crunch.
function impactFlesh(sr, rng, head) {
  const out = samples(sr, 0.35);
  const n = out.length;
  const thud = new Float32Array(n), slap = new Float32Array(n), sq = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    thud[i] = white(rng) * envAD(t, 0.001, 0.03);
    slap[i] = white(rng) * envAD(t, 0.0005, 0.009);
    sq[i] = white(rng) * envAD(t - 0.006, 0.006, 0.045);
  }
  filt(thud, 'lowpass', 380, 0.8, sr, 2);
  filt(slap, 'bandpass', 1300, 0.7, sr);
  const f0 = rng.range(1800, 2600);
  sweep(sq, 'bandpass', (u) => f0 * exp(-u * 6) + 350, 3, sr);
  mixInto(out, thud, 0, 4);
  mixInto(out, slap, 0, 2.6);
  mixInto(out, sq, 0, 1.8);
  chirp(sr, 0.15, (t) => 90 + 80 * exp(-t / 0.02), (t) => 0.18 * envAD(t, 0.001, 0.035), out);
  if (head) {
    // Bone: a hard, bright crack and crunching fragments.
    grain(sr, rng, out, 0, { freq: 3200, q: 0.7, tau: 0.0018, amp: 2.4 });
    grain(sr, rng, out, 0, { freq: 1500, q: 1.5, tau: 0.004, amp: 1.2 });
    for (let g = 0; g < 14; g++) grain(sr, rng, out, (0.003 + rng.next() * 0.06) * sr, { freq: rng.range(1500, 4000), q: 1.5, tau: 0.002, amp: rng.range(0.2, 0.5) });
  }
  return normalize(dcBlock(out, sr), 0.9);
}

// ---------------------------------------------------------------- zombie voices
// Large, damaged vocal tract (formants scaled down), irregular glottis (jitter, shimmer, period
// doubling, creak) and lots of breath. Variants differ in vowel path, pitch contour and roughness.

const tractOf = (rng) => rng.range(0.78, 0.9);
const vowelPath = (path, k) => (u) => {
  const seg = Math.min(path.length - 2, Math.floor(u * (path.length - 1)));
  const t = u * (path.length - 1) - seg;
  const s = t * t * (3 - 2 * t);
  return lerpVowel(VOWELS[path[seg]], VOWELS[path[seg + 1]], s).map((f) => f * k);
};
const withBw = (fs, bws, gains) => fs.map((f, i) => [f, bws[i], gains[i]]);

function groan(sr, rng, i) {
  const paths = [['uh', 'aa', 'oh'], ['oo', 'uh', 'aa', 'uh'], ['er', 'aa', 'oh', 'oo'], ['aa', 'oh', 'uh'], ['uh', 'er', 'aa']];
  const k = tractOf(rng), vp = vowelPath(paths[i % paths.length], k);
  const f0a = rng.range(62, 85), dur = rng.range(1.4, 2.3), wob = rng.range(0.08, 0.2);
  const out = voice(sr, rng, {
    dur,
    f0: (u) => f0a * (1 + wob * Math.sin(u * Math.PI) - 0.25 * u * u),
    amp: (u) => Math.min(1, u / 0.15) * (u > 0.75 ? Math.max(0, (1 - u) / 0.25) : 1),
    formants: (u) => withBw(vp(u), [110, 140, 200, 260], [0, -4, -9, -14]),
    breath: (u) => 0.3 + 0.35 * u,
    sub: rng.range(0.25, 0.55), jitter: 0.06, shimmer: 0.3, creak: 0.12, fry: 0.5, fryRate: rng.range(18, 34), drive: 2.5,
  });
  // Inhaled rattle at the end on some variants: unsettling, not human-polite.
  if (i % 2 === 1) {
    const rat = voice(sr, rng, {
      dur: 0.45, f0: () => rng.range(40, 50), amp: (u) => Math.sin(Math.PI * u) * 0.5,
      formants: () => withBw(VOWELS.oh.map((f) => f * k), [200, 250, 300, 400], [0, -6, -12, -18]),
      breath: () => 0.85, sub: 0.6, jitter: 0.1, creak: 0.3, fry: 0.8, drive: 3,
    });
    const both = new Float32Array(out.length + rat.length + Math.round(0.08 * sr));
    both.set(out); mixInto(both, rat, out.length + 0.08 * sr, 0.8);
    return normalize(fadeEdges(both, sr, 0.01, 0.06), 0.9);
  }
  return normalize(fadeEdges(out, sr, 0.01, 0.06), 0.9);
}

function snarl(sr, rng, i) {
  const paths = [['ae', 'aa'], ['eh', 'ae', 'uh'], ['aa', 'ae'], ['er', 'ae', 'aa'], ['ae', 'uh']];
  const k = tractOf(rng) * 1.05, vp = vowelPath(paths[i % paths.length], k);
  const f0a = rng.range(140, 210), dur = rng.range(0.55, 0.85);
  const out = voice(sr, rng, {
    dur,
    f0: (u) => f0a * (1 + 0.35 * Math.sin(u * Math.PI * 0.9)) * (u > 0.7 ? 1 - (u - 0.7) : 1),
    amp: (u) => Math.min(1, u / 0.06) * (u > 0.65 ? Math.max(0, (1 - u) / 0.35) : 1),
    formants: (u) => withBw(vp(u), [130, 160, 220, 300], [0, -2, -6, -10]),
    breath: () => 0.55, sub: rng.range(0.3, 0.5), jitter: 0.09, shimmer: 0.35, creak: 0.08, fry: 0.45, fryRate: rng.range(30, 50), drive: 4,
  });
  return normalize(fadeEdges(out, sr, 0.004, 0.04), 0.9);
}

function pain(sr, rng, i) {
  const paths = [['aa', 'uh'], ['eh', 'uh'], ['ae', 'er'], ['uh', 'oh'], ['aa', 'er']];
  const k = tractOf(rng), vp = vowelPath(paths[i % paths.length], k);
  const f0a = rng.range(120, 170), dur = rng.range(0.25, 0.42);
  const out = voice(sr, rng, {
    dur,
    f0: (u) => f0a * (1.25 - 0.5 * u),
    amp: (u) => Math.min(1, u / 0.04) * Math.max(0, 1 - Math.pow(u, 1.5)),
    formants: (u) => withBw(vp(u), [120, 150, 220, 300], [0, -3, -8, -12]),
    breath: () => 0.45, sub: 0.35, jitter: 0.07, shimmer: 0.3, fry: 0.3, drive: 3,
  });
  return normalize(fadeEdges(out, sr, 0.003, 0.03), 0.9);
}

function death(sr, rng, i) {
  const paths = [['aa', 'uh', 'oo'], ['ae', 'aa', 'oh'], ['uh', 'aa', 'er', 'oo'], ['eh', 'aa', 'uh']];
  const k = tractOf(rng), vp = vowelPath(paths[i % paths.length], k);
  const f0a = rng.range(110, 150), dur = rng.range(1.2, 1.7);
  const gurgle = wobble(Math.ceil(dur * sr), sr, rng.range(9, 14), rng);
  const out = voice(sr, rng, {
    dur,
    f0: (u) => f0a * (1.15 - 0.6 * u),
    amp: (u) => Math.min(1, u / 0.03) * Math.pow(Math.max(0, 1 - u), 1.2),
    formants: (u) => withBw(vp(u), [130, 170, 240, 320], [0, -4, -9, -14]),
    breath: (u) => 0.35 + 0.5 * u,
    sub: 0.45, jitter: 0.1, shimmer: 0.4, creak: 0.2, fry: 0.55, fryRate: 22, drive: 3,
  });
  // Gurgle: choppy amplitude in the second half (fluid in the throat).
  for (let j = 0; j < out.length; j++) {
    const u = j / out.length;
    if (u > 0.35) out[j] *= 1 - Math.min(0.85, (u - 0.35) * 2) * Math.max(0, gurgle[j]);
  }
  // Body hitting the wet ground.
  const fall = samples(sr, 0.3);
  grain(sr, rng, fall, 0, { freq: 300, q: 0.8, tau: 0.03, amp: 2.5, type: 'lowpass' });
  for (let d = 0; d < 10; d++) bubble(sr, fall, rng.range(0.002, 0.08) * sr, { freq: rng.range(1200, 3000), tau: 0.008, amp: 0.15, rise: 0.3 });
  const both = new Float32Array(out.length + Math.round(0.25 * sr));
  both.set(out);
  mixInto(both, fall, (dur * rng.range(0.55, 0.75)) * sr, 0.6);
  return normalize(fadeEdges(both, sr, 0.003, 0.08), 0.9);
}

// Player hit: muffled body thud plus a short clenched grunt.
function playerHurt(sr, rng) {
  const out = samples(sr, 0.4);
  grain(sr, rng, out, 0, { freq: 320, q: 0.8, tau: 0.03, amp: 2.5, type: 'lowpass' });
  chirp(sr, 0.2, (t) => 70 + 50 * exp(-t / 0.02), (t) => 0.25 * envAD(t, 0.001, 0.04), out);
  const g = voice(sr, rng, {
    dur: 0.2, f0: (u) => rng.range(105, 125) * (1 - 0.2 * u), amp: (u) => Math.sin(Math.PI * Math.min(1, u * 1.2)),
    formants: () => withBw(VOWELS.uh, [90, 120, 180, 250], [0, -5, -12, -18]), breath: () => 0.35, jitter: 0.02, drive: 2,
  });
  mixInto(out, g, 0.015 * sr, 0.9);
  return normalize(dcBlock(out, sr), 0.9);
}

// ---------------------------------------------------------------- UI and stings

// Struck bell with a minor-third hum tone: ominous, not musical-score.
function bell(sr, rng, out, at, f, amp, len = 3) {
  const partials = [[0.5, 2.2, 0.5], [1, 1.6, 1], [1.19, 1.2, 0.6], [1.5, 0.9, 0.45], [2, 0.7, 0.5], [2.52, 0.5, 0.3], [3.01, 0.35, 0.25], [4.16, 0.2, 0.15]];
  modal(sr, 0, partials.map(([r, tau, a]) => [f * r * rng.range(0.998, 1.002), tau * len / 3, a]), rng, out, Math.round(at * sr), amp);
  grain(sr, rng, out, at * sr, { freq: f * 6, q: 0.7, tau: 0.003, amp: amp * 0.6 });
}

function drone(sr, rng, out, f, start, end, amp) {
  const n = out.length;
  const s = new Float32Array(n);
  let p1 = 0, p2 = 0, p3 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    p1 += f / sr; p2 += (f * 1.004) / sr; p3 += (f * 1.498) / sr;
    const saw = (p) => 2 * (p % 1) - 1;
    const e = t < start ? 0 : t < (start + end) / 2 ? (t - start) / ((end - start) / 2) : Math.max(0, (end - t) / ((end - start) / 2));
    s[i] = (saw(p1) + saw(p2) + 0.5 * saw(p3)) * e * e;
  }
  filt(s, 'lowpass', 320, 0.9, sr, 2);
  mixInto(out, s, 0, amp);
}

function* stingStart(sr, rng) {
  const L = samples(sr, 4.2), R = samples(sr, 4.2);
  // Rising breath of noise into the strike.
  const rise = noise(sr, 0.5, rng);
  sweep(rise, 'bandpass', (u) => 600 + 5000 * u * u, 1.2, sr);
  for (let i = 0; i < rise.length; i++) rise[i] *= Math.pow(i / rise.length, 3) * 0.6;
  for (const C of [L, R]) {
    mixInto(C, rise, 0);
    bell(sr, rng, C, 0.5, 146.8, 0.9, 3.4);
    yield;
    drone(sr, rng, C, 73.4, 0.4, 4.1, 0.25);
    yield;
  }
  bell(sr, rng, R, 0.5, 146.8 * 1.003, 0.4, 3.4); // slight beating between channels
  for (const C of [L, R]) fadeEdges(dcBlock(C, sr), sr, 0.005, 0.3);
  return normalize([L, R], 0.9);
}

function* stingEnd(sr, rng) {
  const L = samples(sr, 4.4), R = samples(sr, 4.4);
  for (const C of [L, R]) {
    bell(sr, rng, C, 0, 164.8, 0.7, 2.6);
    bell(sr, rng, C, 0.7, 123.5, 0.8, 3.4);
    yield;
    drone(sr, rng, C, 61.7, 0.5, 4.3, 0.2);
    yield;
  }
  for (const C of [L, R]) fadeEdges(dcBlock(C, sr), sr, 0.002, 0.4);
  return normalize([L, R], 0.9);
}

function purchase(sr, rng) {
  const out = samples(sr, 0.9);
  // Coin-slot clack, then two bright chime tones a fourth apart.
  modal(sr, 0, [[1900, 0.01, 1], [3100, 0.008, 0.7], [700, 0.02, 0.5]], rng, out, 0, 0.6);
  for (const [at, f] of [[0.07, 1318.5], [0.17, 1760]]) {
    modal(sr, 0, [[f, 0.32, 1], [f * 2, 0.12, 0.35], [f * 3.01, 0.06, 0.15]], rng, out, Math.round(at * sr), 0.5);
  }
  return normalize(out, 0.85);
}

function denied(sr, rng) {
  const out = samples(sr, 0.4);
  for (const at of [0, 0.16]) {
    const s = samples(sr, 0.13);
    let p = 0, q = 0;
    for (let i = 0; i < s.length; i++) {
      p += 196 / sr; q += 199 / sr;
      s[i] = ((p % 1) < 0.5 ? 1 : -1) * 0.5 + ((q % 1) < 0.5 ? 1 : -1) * 0.5;
    }
    filt(s, 'lowpass', 1100, 0.8, sr, 2);
    fadeEdges(s, sr, 0.003, 0.02);
    mixInto(out, s, at * sr);
  }
  return normalize(out, 0.75);
}

// name -> { variants, gen(sr, rng, i) }
export const SFX = {
  pistol: { variants: 3, gen: (sr, rng) => pistol(sr, rng) },
  pistol_tail_open: { variants: 2, gen: (sr, rng) => tailOpen(sr, rng) },
  pistol_tail_canopy: { variants: 2, gen: (sr, rng) => tailCanopy(sr, rng) },
  dry_fire: { variants: 1, gen: (sr, rng) => dryFire(sr, rng) },
  reload: { variants: 1, gen: (sr, rng) => reload(sr, rng) },
  casing: { variants: 4, gen: (sr, rng) => casing(sr, rng) },
  step_asphalt: { variants: 6, gen: (sr, rng) => footstep(sr, rng, 'asphalt') },
  step_concrete: { variants: 6, gen: (sr, rng) => footstep(sr, rng, 'concrete') },
  impact_hard: { variants: 4, gen: impactHard },
  impact_metal: { variants: 3, gen: (sr, rng) => impactMetal(sr, rng) },
  impact_glass: { variants: 2, gen: (sr, rng) => impactGlass(sr, rng) },
  impact_flesh: { variants: 5, gen: (sr, rng) => impactFlesh(sr, rng, false) },
  impact_head: { variants: 3, gen: (sr, rng) => impactFlesh(sr, rng, true) },
  zombie_groan: { variants: 5, gen: groan },
  zombie_snarl: { variants: 4, gen: snarl },
  zombie_pain: { variants: 5, gen: pain },
  zombie_death: { variants: 4, gen: death },
  player_hurt: { variants: 3, gen: (sr, rng) => playerHurt(sr, rng) },
  sting_round_start: { variants: 1, gen: (sr, rng) => stingStart(sr, rng) },
  sting_round_end: { variants: 1, gen: (sr, rng) => stingEnd(sr, rng) },
  purchase: { variants: 1, gen: (sr, rng) => purchase(sr, rng) },
  denied: { variants: 1, gen: (sr, rng) => denied(sr, rng) },
};
