// Zombie voices and bodies by type: runner screams and panting, the armoured one muffled
// behind its mask with gear rattling, the bloater wet and gurgling (and the swell before it bursts),
// the brute's low roar, growl, footfalls and slam, the crawler's drag; severing; boards torn and
// hammered back; a body climbing through a window. Walkers keep the original voices in sfx.js.
import {
  samples, white, filt, sweep, noise, envAD, mixInto, normalize, saturate, fadeEdges, dcBlock,
  modal, chirp, grain, bubble, voice, VOWELS, lerpVowel, wobble, loopify, click, friction,
} from './synth.js';

const exp = Math.exp;
const vowelPath = (path, k) => (u) => {
  const seg = Math.min(path.length - 2, Math.floor(u * (path.length - 1)));
  const t = u * (path.length - 1) - seg, s = t * t * (3 - 2 * t);
  return lerpVowel(VOWELS[path[seg]], VOWELS[path[seg + 1]], s).map((f) => f * k);
};
const withBw = (fs, bws, gains) => fs.map((f, i) => [f, bws[i], gains[i]]);
const done = (out, sr, a = 0.004, r = 0.05) => normalize(fadeEdges(dcBlock(out, sr), sr, a, r), 0.9);

// Runner: a strained, rising scream that cracks; a shorter tract, open vowels, hard drive.
function runnerScream(sr, rng, i) {
  const paths = [['ae', 'aa', 'ae'], ['eh', 'ae', 'aa'], ['aa', 'ae', 'er']];
  const k = rng.range(0.92, 1.02), vp = vowelPath(paths[i % paths.length], k);
  const f0a = rng.range(230, 300), dur = rng.range(0.75, 1.05);
  const out = voice(sr, rng, {
    dur,
    f0: (u) => f0a * (1 + 0.45 * Math.sin(Math.PI * Math.min(1, u * 1.3))) * (u > 0.8 ? 1 - (u - 0.8) * 1.5 : 1),
    amp: (u) => Math.min(1, u / 0.05) * (u > 0.7 ? Math.max(0, (1 - u) / 0.3) : 1),
    formants: (u) => withBw(vp(u), [140, 170, 240, 320], [0, -1, -4, -8]),
    breath: () => 0.5, sub: rng.range(0.15, 0.35), jitter: 0.1, shimmer: 0.4, creak: 0.05, fry: 0.3, fryRate: 45, drive: 5,
  });
  return done(out, sr, 0.003, 0.05);
}

// Runner at a run: ragged rasping breaths, a pair per stride.
function runnerPant(sr, rng) {
  const out = samples(sr, 1.3);
  for (let k = 0; k < 4; k++) {
    const at = k * 0.3 + rng.range(0, 0.03);
    const fb = rng.range(150, 190);
    const b = voice(sr, rng, {
      dur: 0.2, f0: () => fb, amp: (u) => Math.sin(Math.PI * u),
      formants: () => withBw(VOWELS[k % 2 ? 'uh' : 'ae'].map((f) => f * 0.95), [200, 240, 300, 400], [0, -4, -9, -14]),
      breath: () => 0.85, sub: 0.3, jitter: 0.12, creak: 0.2, fry: 0.6, drive: 3,
    });
    mixInto(out, b, at * sr, k % 2 ? 0.6 : 1);
  }
  return done(out, sr);
}

// Armoured: a walker's groan heard through a mask: no top, a boxy resonance.
function armouredGroan(sr, rng, i) {
  const paths = [['uh', 'oh', 'oo'], ['er', 'uh', 'oh'], ['oo', 'uh', 'er']];
  const k = rng.range(0.8, 0.88), vp = vowelPath(paths[i % paths.length], k);
  const f0a = rng.range(70, 90), dur = rng.range(1.2, 1.8);
  const out = voice(sr, rng, {
    dur,
    f0: (u) => f0a * (1 + 0.12 * Math.sin(u * Math.PI) - 0.2 * u * u),
    amp: (u) => Math.min(1, u / 0.12) * (u > 0.75 ? Math.max(0, (1 - u) / 0.25) : 1),
    formants: (u) => withBw(vp(u), [110, 140, 200, 260], [0, -4, -9, -14]),
    breath: (u) => 0.35 + 0.3 * u, sub: 0.4, jitter: 0.06, shimmer: 0.3, creak: 0.1, fry: 0.5, drive: 2.5,
  });
  filt(out, 'lowpass', 850, 0.7, sr, 2);
  filt(out, 'peaking', 420, 4, sr, 1, 9); // the mask's cavity
  return done(out, sr, 0.01, 0.06);
}

// Gear: buckles, plates and a dangling chain. Played with the armoured one's voice and its steps.
function gearRattle(sr, rng) {
  const out = samples(sr, 0.45);
  for (let k = 0; k < 14; k++) {
    const at = Math.round(Math.pow(rng.next(), 1.2) * 0.32 * sr), f = rng.range(1400, 4200);
    modal(sr, 0, [[f, rng.range(0.01, 0.03), rng.range(0.1, 0.4)], [f * 1.53, 0.01, 0.15]], rng, out, at);
  }
  grain(sr, rng, out, 0, { freq: 350, q: 0.8, tau: 0.02, amp: 0.8, type: 'lowpass' });
  return done(out, sr, 0.001, 0.04);
}

// Bloater: a wet, bubbling croak.
function bloaterGurgle(sr, rng, i) {
  const k = rng.range(0.75, 0.85), vp = vowelPath(i % 2 ? ['oo', 'uh', 'oh'] : ['oh', 'oo', 'uh'], k);
  const dur = rng.range(1.2, 1.7);
  const g = wobble(Math.ceil(dur * sr), sr, rng.range(10, 16), rng);
  const fg = rng.range(60, 75);
  const out = voice(sr, rng, {
    dur, f0: (u) => fg * (1 - 0.15 * u), amp: (u) => Math.min(1, u / 0.1) * Math.max(0, 1 - Math.pow(u, 2)),
    formants: (u) => withBw(vp(u), [120, 150, 220, 300], [0, -5, -11, -16]),
    breath: () => 0.4, sub: 0.55, jitter: 0.1, shimmer: 0.4, creak: 0.25, fry: 0.7, fryRate: 16, drive: 2.5,
  });
  for (let j = 0; j < out.length; j++) out[j] *= 1 - 0.7 * Math.max(0, g[j]);
  for (let b = 0; b < 40; b++) bubble(sr, out, rng.next() * out.length * 0.9, { freq: rng.range(300, 1400), tau: rng.range(0.006, 0.02), amp: rng.range(0.03, 0.12), rise: rng.range(0.2, 0.6) });
  return done(out, sr, 0.01, 0.08);
}

// The swell before the burst: gurgling that rises in pitch and density, the skin creaking (0.8 s).
function bloaterSwell(sr, rng) {
  const dur = 0.85, out = samples(sr, dur), n = out.length;
  const s = noise(sr, dur, rng);
  sweep(s, 'bandpass', (u) => 200 + 900 * u * u, 3, sr);
  for (let i = 0; i < n; i++) out[i] = s[i] * (0.3 + 0.7 * (i / n)) * 0.6;
  for (let b = 0; b < 90; b++) {
    const u = Math.sqrt(rng.next());
    bubble(sr, out, u * (n - 0.03 * sr), { freq: 300 + 1600 * u * rng.range(0.7, 1.3), tau: rng.range(0.005, 0.015), amp: 0.05 + 0.15 * u, rise: 0.5 });
  }
  chirp(sr, dur, (t) => 70 + 160 * (t / dur) ** 2, (t) => 0.25 * (t / dur), out);
  for (let c = 0; c < 6; c++) friction(sr, rng, out, rng.range(0.2, 0.75), 0.05, rng.range(500, 900), 0.15, 4);
  return done(out, sr, 0.02, 0.01);
}

// The burst: a wet bang, a splash of matter and liquid falling back.
function bloaterBurst(sr, rng) {
  const out = samples(sr, 1.3);
  grain(sr, rng, out, 0, { freq: 320, q: 0.7, tau: 0.05, amp: 4, type: 'lowpass' });
  grain(sr, rng, out, 0, { freq: 1500, q: 0.6, tau: 0.008, amp: 1.5 });
  chirp(sr, 0.4, (t) => 45 + 90 * exp(-t / 0.03), (t) => 0.8 * envAD(t, 0.001, 0.1), out);
  const sq = noise(sr, 0.4, rng);
  sweep(sq, 'bandpass', (u) => 2200 * exp(-u * 4) + 300, 2.5, sr);
  for (let i = 0; i < sq.length; i++) sq[i] *= envAD(i / sr, 0.004, 0.1);
  mixInto(out, sq, 0, 1.5);
  for (let s = 0; s < 70; s++) {
    const at = (0.08 + Math.pow(rng.next(), 1.5) * 0.9) * sr;
    if (rng.next() < 0.5) bubble(sr, out, at, { freq: rng.range(600, 2500), tau: rng.range(0.004, 0.012), amp: rng.range(0.03, 0.15), rise: 0.4 });
    else grain(sr, rng, out, at, { freq: rng.range(300, 900), q: 1, tau: rng.range(0.004, 0.012), amp: rng.range(0.1, 0.4), type: 'lowpass' });
  }
  saturate(normalize(out, 1), 1.5);
  return done(out, sr, 0.0005, 0.2);
}

// The cloud it leaves: a long gas hiss (loops while the cloud lasts).
function gasHiss(sr, rng) {
  const s = noise(sr, 2.4, rng);
  filt(s, 'bandpass', 4200, 0.6, sr);
  const w = wobble(s.length, sr, 2, rng);
  for (let i = 0; i < s.length; i++) s[i] *= 0.7 + 0.3 * w[i];
  for (let b = 0; b < 12; b++) bubble(sr, s, rng.next() * (s.length - 0.05 * sr), { freq: rng.range(400, 900), tau: 0.012, amp: 0.15, rise: 0.3 });
  return normalize(loopify(dcBlock(s, sr), sr, 0.3), 0.8);
}

// Brute: a huge tract and a low, rough roar with a sub layer.
function bruteRoar(sr, rng, i) {
  const k = rng.range(0.6, 0.68), vp = vowelPath(i % 2 ? ['uh', 'aa', 'oh'] : ['oh', 'aa', 'uh', 'oo'], k);
  const dur = rng.range(1.6, 2.0), f0a = rng.range(48, 60);
  const out = voice(sr, rng, {
    dur, f0: (u) => f0a * (1 + 0.35 * Math.sin(Math.PI * Math.min(1, u * 1.4))),
    amp: (u) => Math.min(1, u / 0.08) * (u > 0.7 ? Math.max(0, (1 - u) / 0.3) : 1),
    formants: (u) => withBw(vp(u), [130, 160, 230, 300], [0, -3, -8, -12]),
    breath: () => 0.45, sub: 0.5, jitter: 0.08, shimmer: 0.35, creak: 0.1, fry: 0.6, fryRate: 20, drive: 4.5,
  });
  chirp(sr, dur, (t) => f0a * 0.5 * (1 + 0.35 * Math.sin(Math.PI * Math.min(1, t / dur * 1.4))), (t) => 0.3 * Math.min(1, t / 0.15) * Math.max(0, 1 - t / dur), out);
  return done(out, sr, 0.01, 0.1);
}

function bruteGrowl(sr, rng, i) {
  const k = rng.range(0.6, 0.68), vp = vowelPath(i % 2 ? ['uh', 'oh'] : ['er', 'uh'], k);
  const fg = rng.range(42, 52);
  const out = voice(sr, rng, {
    dur: rng.range(1.2, 1.6), f0: (u) => fg * (1 - 0.1 * u),
    amp: (u) => Math.min(1, u / 0.2) * Math.max(0, 1 - Math.pow(u, 3)),
    formants: (u) => withBw(vp(u), [120, 150, 220, 300], [0, -5, -11, -16]),
    breath: () => 0.4, sub: 0.6, jitter: 0.07, creak: 0.2, fry: 0.8, fryRate: 14, drive: 3,
  });
  return done(out, sr, 0.02, 0.1);
}

// A brute's footfall: a heavy thud through the ground, grit and water thrown up.
function bruteStep(sr, rng) {
  const out = samples(sr, 0.45);
  grain(sr, rng, out, 0, { freq: 140, q: 0.8, tau: 0.04, amp: 5, type: 'lowpass' });
  chirp(sr, 0.3, (t) => 38 + 40 * exp(-t / 0.02), (t) => 0.7 * envAD(t, 0.002, 0.07), out);
  for (let d = 0; d < 14; d++) grain(sr, rng, out, (0.005 + Math.pow(rng.next(), 2) * 0.15) * sr, { freq: rng.range(1500, 4000), q: 1.5, tau: 0.0015, amp: rng.range(0.05, 0.2) });
  return done(out, sr, 0.001, 0.08);
}

// The slam: both fists into the ground, a crack and a thump that shakes the lot.
function bruteSlam(sr, rng) {
  const out = samples(sr, 1.3);
  grain(sr, rng, out, 0, { freq: 2500, q: 0.5, tau: 0.004, amp: 1.5, type: 'highpass' });
  grain(sr, rng, out, 0, { freq: 200, q: 0.7, tau: 0.07, amp: 6, type: 'lowpass' });
  chirp(sr, 0.9, (t) => 30 + 70 * exp(-t / 0.04), (t) => 1.0 * envAD(t, 0.002, 0.2), out);
  for (let g = 0; g < 50; g++) grain(sr, rng, out, (0.01 + Math.pow(rng.next(), 1.5) * 0.8) * sr, { freq: rng.range(800, 4500), q: 1.5, tau: rng.range(0.001, 0.004), amp: rng.range(0.05, 0.3) });
  saturate(normalize(out, 1), 1.6);
  return done(out, sr, 0.0005, 0.25);
}

// A crawler dragging itself on: cloth and skin scraping wet ground, a hand slapping down.
function crawlerDrag(sr, rng) {
  const out = samples(sr, 0.75);
  friction(sr, rng, out, 0.0, 0.5, rng.range(600, 900), 0.6, 0.6);
  friction(sr, rng, out, 0.1, 0.4, 2500, 0.15, 0.8);
  grain(sr, rng, out, 0, { freq: 300, q: 0.8, tau: 0.02, amp: 1.5, type: 'lowpass' });
  for (let d = 0; d < 6; d++) bubble(sr, out, rng.range(0.0, 0.1) * sr, { freq: rng.range(1200, 2800), tau: 0.006, amp: 0.08, rise: 0.4 });
  return done(out, sr, 0.003, 0.08);
}

// A limb coming off: a wet rip and a bone snapping.
function sever(sr, rng) {
  const out = samples(sr, 0.5);
  const rip = noise(sr, 0.18, rng);
  sweep(rip, 'bandpass', (u) => 800 + 2500 * u, 2, sr);
  for (let i = 0; i < rip.length; i++) rip[i] *= envAD(i / sr, 0.01, 0.06) * (0.5 + 0.5 * Math.abs(white(rng)));
  mixInto(out, rip, 0, 1.4);
  grain(sr, rng, out, 0.03 * sr, { freq: 3200, q: 0.7, tau: 0.002, amp: 2.2 });
  grain(sr, rng, out, 0.03 * sr, { freq: 350, q: 0.8, tau: 0.02, amp: 2, type: 'lowpass' });
  for (let d = 0; d < 12; d++) bubble(sr, out, rng.range(0.04, 0.3) * sr, { freq: rng.range(900, 2400), tau: 0.008, amp: 0.1, rise: 0.4 });
  return done(out, sr, 0.002, 0.08);
}

// A board torn off a window: the plank cracking, nails shrieking out, the wood clattering down.
function boardBreak(sr, rng) {
  const out = samples(sr, 0.9);
  // nail screech: a narrow, fast-wobbling squeal
  const f0 = rng.range(1800, 2600);
  chirp(sr, 0.18, (t) => f0 * (1 + 0.15 * Math.sin(2 * Math.PI * 38 * t)) * (1 - 0.3 * t), (t) => 0.18 * envAD(t, 0.01, 0.08), out);
  for (let c = 0; c < 5; c++) grain(sr, rng, out, (0.08 + c * 0.012 + rng.range(0, 0.01)) * sr, { freq: rng.range(900, 2600), q: 1.2, tau: 0.004, amp: rng.range(0.6, 1.3) });
  grain(sr, rng, out, 0.09 * sr, { freq: 400, q: 0.7, tau: 0.03, amp: 2.5, type: 'lowpass' });
  modal(sr, 0, [[rng.range(320, 420), 0.05, 0.6], [rng.range(700, 900), 0.03, 0.4]], rng, out, Math.round(0.5 * sr));
  grain(sr, rng, out, 0.5 * sr, { freq: 250, q: 0.7, tau: 0.02, amp: 1.2, type: 'lowpass' });
  return done(out, sr, 0.002, 0.1);
}

// Hammering a board back: plank set against the frame, two nail strikes.
function boardHammer(sr, rng) {
  const out = samples(sr, 0.7);
  grain(sr, rng, out, 0, { freq: 300, q: 0.7, tau: 0.02, amp: 1.2, type: 'lowpass' });
  modal(sr, 0, [[rng.range(330, 380), 0.04, 0.4]], rng, out, 0);
  for (const at of [0.22, 0.45]) {
    modal(sr, 0, [[rng.range(2400, 2800), 0.03, 0.6], [3900, 0.02, 0.3], [600, 0.03, 0.5]], rng, out, Math.round(at * sr));
    grain(sr, rng, out, at * sr, { freq: 5000, q: 0.6, tau: 0.0008, amp: 1.2 });
    grain(sr, rng, out, at * sr, { freq: 250, q: 0.8, tau: 0.015, amp: 1.5, type: 'lowpass' });
  }
  return done(out, sr, 0.001, 0.08);
}

// A body coming over a sill: wood scraped, broken glass crunched, a heavy landing.
function windowClimb(sr, rng) {
  const out = samples(sr, 1.0);
  friction(sr, rng, out, 0.0, 0.45, 700, 0.5, 0.7);
  for (let g = 0; g < 14; g++) modal(sr, 0, [[rng.range(3000, 8000), 0.01, rng.range(0.05, 0.2)]], rng, out, Math.round(rng.range(0.05, 0.4) * sr));
  grain(sr, rng, out, 0.6 * sr, { freq: 220, q: 0.8, tau: 0.04, amp: 3, type: 'lowpass' });
  chirp(sr, 0.2, (t) => 60 + 50 * exp(-t / 0.02), (t) => 0.4 * envAD(t, 0.002, 0.04), out, Math.round(0.6 * sr));
  return done(out, sr, 0.01, 0.1);
}

export const VOICE_SFX = {
  runner_scream: { variants: 3, gen: runnerScream },
  runner_pant: { variants: 2, gen: (sr, rng) => runnerPant(sr, rng) },
  armoured_groan: { variants: 3, gen: armouredGroan },
  gear_rattle: { variants: 3, gen: (sr, rng) => gearRattle(sr, rng) },
  bloater_gurgle: { variants: 3, gen: bloaterGurgle },
  bloater_swell: { variants: 1, gen: (sr, rng) => bloaterSwell(sr, rng) },
  bloater_burst: { variants: 2, gen: (sr, rng) => bloaterBurst(sr, rng) },
  gas_hiss: { variants: 1, gen: (sr, rng) => gasHiss(sr, rng) },
  brute_roar: { variants: 2, gen: bruteRoar },
  brute_growl: { variants: 2, gen: bruteGrowl },
  brute_step: { variants: 3, gen: (sr, rng) => bruteStep(sr, rng) },
  brute_slam: { variants: 1, gen: (sr, rng) => bruteSlam(sr, rng) },
  crawler_drag: { variants: 3, gen: (sr, rng) => crawlerDrag(sr, rng) },
  sever: { variants: 3, gen: (sr, rng) => sever(sr, rng) },
  board_break: { variants: 3, gen: (sr, rng) => boardBreak(sr, rng) },
  board_hammer: { variants: 2, gen: (sr, rng) => boardHammer(sr, rng) },
  window_climb: { variants: 2, gen: (sr, rng) => windowClimb(sr, rng) },
};

// Which voice a zombie type uses for each moment (walker: the original sounds).
export const TYPE_VOICE = {
  walker: { idle: 'zombie_groan', attack: 'zombie_snarl', spawn: 'zombie_groan' },
  runner: { idle: 'runner_pant', attack: 'runner_scream', spawn: 'runner_scream' },
  armoured: { idle: 'armoured_groan', attack: 'armoured_groan', spawn: 'armoured_groan', layer: 'gear_rattle' },
  bloater: { idle: 'bloater_gurgle', attack: 'bloater_gurgle', spawn: 'bloater_gurgle' },
  brute: { idle: 'brute_growl', attack: 'brute_roar', spawn: 'brute_roar' },
};
