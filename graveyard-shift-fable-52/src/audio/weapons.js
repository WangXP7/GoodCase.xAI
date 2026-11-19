// Weapon sounds: a shot per weapon built from the same layers (supersonic crack, muzzle
// blast, body resonance, low thump, mechanism) with different numbers so the ten read apart; tails by
// size and space; reload foley as short parts scheduled across the reload (so a cancel can stop the
// rest); melee, throwables, explosions, fire, the flare's flight and the Jumper's arc.
// Generators are pure (sampleRate, rng, variant) -> Float32Array | [L, R], like sfx.js.
import {
  samples, white, filt, sweep, noise, envAD, mixInto, normalize, saturate, fadeEdges, dcBlock,
  modal, chirp, grain, wobble, loopify, click, friction, whoosh, tone,
} from './synth.js';

const exp = Math.exp;

// ---------------------------------------------------------------- the shot

// P: dur; crack {crackHz, crackTau, crack}; blast {blastTau, blastLP, blastPk, blast}; body {bodyHz,
// bodyQ, bodyTau, body}; low {lowHz, lowTau, low}; thump {thump, thumpStart, thumpEnd, thumpSweep,
// thumpTau}; drive; mech [[at, base, amp, thud]]; extra(out, sr, rng).
function gun(sr, rng, P) {
  const out = samples(sr, P.dur), n = out.length;
  const crack = new Float32Array(n), blast = new Float32Array(n), body = new Float32Array(n), low = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    crack[i] = white(rng) * exp(-t / P.crackTau);
    blast[i] = white(rng) * envAD(t, 0.0008, P.blastTau);
    body[i] = white(rng) * envAD(t, 0.0005, P.bodyTau);
    low[i] = white(rng) * envAD(t, 0.002, P.lowTau);
  }
  filt(crack, 'highpass', P.crackHz, 0.7, sr, 2);
  filt(blast, 'lowpass', P.blastLP, 0.7, sr);
  filt(blast, 'peaking', P.blastPk ?? 1200, 0.8, sr, 1, 4);
  filt(body, 'bandpass', P.bodyHz * rng.range(0.96, 1.04), P.bodyQ ?? 1.4, sr);
  filt(low, 'lowpass', P.lowHz, 0.8, sr, 2);
  filt(low, 'highpass', 40, 0.7, sr);
  mixInto(out, crack, 0, P.crack);
  mixInto(out, blast, 0, P.blast);
  mixInto(out, body, 0, P.body);
  mixInto(out, low, 0, P.low);
  const fs = P.thumpStart * rng.range(0.92, 1.08);
  chirp(sr, Math.min(P.dur, 0.4), (t) => P.thumpEnd + fs * exp(-t / P.thumpSweep), (t) => P.thump * envAD(t, 0.0008, P.thumpTau), out);
  normalize(out, 1);
  saturate(out, P.drive);
  for (const [at, base, amp, thud] of P.mech || []) click(sr, rng, out, at + rng.range(0, 0.003), base * rng.range(0.95, 1.05), amp, thud || 0);
  if (P.extra) P.extra(out, sr, rng);
  dcBlock(out, sr);
  fadeEdges(out, sr, 0, Math.min(0.08, P.dur * 0.3));
  return normalize(out, 0.95);
}

const SHOTS = {
  // Marlow .44: big, slow, a long boom; only a cylinder tick for a mechanism.
  revolver: {
    dur: 0.65, crackHz: 2200, crackTau: 0.002, crack: 3.5, blastTau: 0.03, blastLP: 3500, blast: 1.3,
    bodyHz: 170, bodyQ: 1.2, bodyTau: 0.08, body: 4.5, lowHz: 120, lowTau: 0.18, low: 1.0,
    thump: 0.45, thumpStart: 200, thumpEnd: 90, thumpSweep: 0.02, thumpTau: 0.07, drive: 2.2,
    mech: [[0.12, 1500, 0.06]],
  },
  // Hollis 12: the heaviest low end, a broad blast, little crack, then the pump racked back and home.
  pump: {
    dur: 0.9, crackHz: 1800, crackTau: 0.0025, crack: 2.2, blastTau: 0.04, blastLP: 2600, blast: 1.6,
    bodyHz: 120, bodyQ: 1.0, bodyTau: 0.1, body: 4.0, lowHz: 100, lowTau: 0.22, low: 1.6,
    thump: 0.55, thumpStart: 160, thumpEnd: 60, thumpSweep: 0.03, thumpTau: 0.09, drive: 2.5,
    extra(out, sr, rng) {
      friction(sr, rng, out, 0.42, 0.07, 1100, 0.18);
      click(sr, rng, out, 0.49, 900, 0.22, 0.5);
      friction(sr, rng, out, 0.56, 0.06, 1400, 0.16);
      click(sr, rng, out, 0.62, 1150, 0.28, 0.7);
    },
  },
  // Brandt 12: shotgun weight, shorter, the gas bolt clacking straight back.
  autoShotgun: {
    dur: 0.4, crackHz: 2000, crackTau: 0.002, crack: 2.6, blastTau: 0.03, blastLP: 3000, blast: 1.5,
    bodyHz: 140, bodyQ: 1.1, bodyTau: 0.07, body: 4.0, lowHz: 110, lowTau: 0.14, low: 1.3,
    thump: 0.5, thumpStart: 180, thumpEnd: 70, thumpSweep: 0.02, thumpTau: 0.06, drive: 2.4,
    mech: [[0.035, 1300, 0.2, 0.4], [0.062, 1800, 0.14]],
  },
  // Pike 45: subsonic, so almost no crack; a dull pop with a bright bolt clatter, very short.
  smg: {
    dur: 0.17, crackHz: 3000, crackTau: 0.001, crack: 0.6, blastTau: 0.012, blastLP: 2500, blastPk: 700, blast: 1.4,
    bodyHz: 330, bodyQ: 1.8, bodyTau: 0.025, body: 4.0, lowHz: 150, lowTau: 0.04, low: 0.5,
    thump: 0.25, thumpStart: 220, thumpEnd: 140, thumpSweep: 0.008, thumpTau: 0.02, drive: 2.0,
    mech: [[0.012, 2900, 0.12], [0.04, 2400, 0.1]],
  },
  // Calder 556: the sharpest crack, a light body, and the buffer spring's ring.
  rifle: {
    dur: 0.32, crackHz: 3600, crackTau: 0.0014, crack: 5.0, blastTau: 0.016, blastLP: 6000, blastPk: 2000, blast: 1.0,
    bodyHz: 420, bodyQ: 1.5, bodyTau: 0.035, body: 3.5, lowHz: 140, lowTau: 0.08, low: 0.5,
    thump: 0.25, thumpStart: 240, thumpEnd: 120, thumpSweep: 0.01, thumpTau: 0.03, drive: 1.8,
    extra(out, sr, rng) { modal(sr, 0, [[3800 * rng.range(0.97, 1.03), 0.05, 0.05], [5200, 0.035, 0.03], [2300, 0.06, 0.03]], rng, out, Math.round(0.028 * sr)); },
  },
  // Ostrander 308: a full-power crack with real weight behind it and a longer boom.
  battleRifle: {
    dur: 0.5, crackHz: 3000, crackTau: 0.0018, crack: 5.0, blastTau: 0.025, blastLP: 4500, blast: 1.3,
    bodyHz: 260, bodyQ: 1.3, bodyTau: 0.055, body: 4.0, lowHz: 120, lowTau: 0.14, low: 1.0,
    thump: 0.4, thumpStart: 200, thumpEnd: 80, thumpSweep: 0.015, thumpTau: 0.05, drive: 2.1,
    mech: [[0.03, 1600, 0.15, 0.3]],
  },
  // Dray 762: heavy rifle round, a heavy bolt and the belt's links jingling through the feed.
  lmg: {
    dur: 0.32, crackHz: 2800, crackTau: 0.0018, crack: 4.5, blastTau: 0.022, blastLP: 4000, blast: 1.4,
    bodyHz: 210, bodyQ: 1.2, bodyTau: 0.05, body: 4.2, lowHz: 110, lowTau: 0.11, low: 1.1,
    thump: 0.4, thumpStart: 190, thumpEnd: 75, thumpSweep: 0.015, thumpTau: 0.045, drive: 2.3,
    mech: [[0.022, 1100, 0.18, 0.5]],
    extra(out, sr, rng) {
      for (let k = 0; k < 7; k++) {
        const at = Math.round(rng.range(0.03, 0.13) * sr), f = rng.range(2600, 5200);
        modal(sr, 0, [[f, 0.012, 0.05], [f * 1.63, 0.008, 0.03]], rng, out, at);
      }
    },
  },
};

// The Jumper: a short charge whine, the snap of the discharge, then a buzzing sizzle.
function jumper(sr, rng) {
  const out = samples(sr, 0.75), n = out.length;
  const ch = 0.07;
  chirp(sr, ch + 0.01, (t) => 300 + 2400 * Math.pow(t / ch, 1.6), (t) => 0.25 * Math.min(1, t / ch) ** 2, out);
  chirp(sr, ch + 0.01, (t) => 2 * (300 + 2400 * Math.pow(t / ch, 1.6)), (t) => 0.08 * Math.min(1, t / ch) ** 2, out);
  const at = Math.round(ch * sr);
  const snap = new Float32Array(n), zap = new Float32Array(n), sizzle = new Float32Array(n);
  for (let i = at; i < n; i++) {
    const t = (i - at) / sr;
    snap[i] = white(rng) * exp(-t / 0.0022);
    const am = (Math.sin(2 * Math.PI * 92 * t) > 0 ? 1 : 0.25);
    zap[i] = white(rng) * envAD(t, 0.0005, 0.06) * am;
    sizzle[i] = white(rng) * envAD(t, 0.01, 0.16) * (0.5 + 0.5 * Math.abs(Math.sin(2 * Math.PI * 60 * t)));
  }
  filt(snap, 'highpass', 3500, 0.7, sr, 2);
  filt(zap, 'bandpass', 2600, 1.2, sr);
  filt(sizzle, 'highpass', 3200, 0.7, sr);
  mixInto(out, snap, 0, 4.5);
  mixInto(out, zap, 0, 2.2);
  mixInto(out, sizzle, 0, 0.5);
  grain(sr, rng, out, at, { freq: 600, q: 0.8, tau: 0.012, amp: 1.5, type: 'lowpass' });
  for (let k = 0; k < 26; k++) grain(sr, rng, out, at + Math.pow(rng.next(), 1.5) * 0.55 * sr, { freq: rng.range(3000, 9000), q: 1, tau: 0.0007, amp: rng.range(0.1, 0.5) });
  saturate(normalize(out, 1), 1.6);
  dcBlock(out, sr);
  return normalize(fadeEdges(out, sr, 0.002, 0.1), 0.95);
}

// The Roadflare: a low launcher thoomp and the motor catching (its flight is flare_whoosh).
function flareShot(sr, rng) {
  const out = samples(sr, 0.55), n = out.length;
  chirp(sr, 0.3, (t) => 70 + 130 * exp(-t / 0.025), (t) => 0.9 * envAD(t, 0.001, 0.06), out);
  const pop = new Float32Array(n), hiss = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    pop[i] = white(rng) * envAD(t, 0.0008, 0.02);
    hiss[i] = white(rng) * envAD(t - 0.03, 0.06, 0.2);
  }
  filt(pop, 'lowpass', 1600, 0.7, sr);
  sweep(hiss, 'bandpass', (u) => 1800 + 2600 * u, 1.5, sr);
  mixInto(out, pop, 0, 2.5);
  mixInto(out, hiss, 0, 0.5);
  click(sr, rng, out, 0.006, 1400, 0.15, 0.3);
  dcBlock(out, sr);
  return normalize(fadeEdges(out, sr, 0.002, 0.08), 0.95);
}

// ---------------------------------------------------------------- tails

// Outdoors: rolling, low-passed slapback off the buildings, trucks and treeline. size scales length and weight.
function tailOpen(sr, rng, size) {
  const S = size === 'heavy' ? { dur: 2.2, tau: 0.26, rum: 3.0, mid: 0.8, lp: 2000 } : { dur: 1.7, tau: 0.19, rum: 2.4, mid: 0.9, lp: 2400 };
  const chans = [0, 1].map((c) => {
    const L = samples(sr, S.dur);
    const rumble = noise(sr, S.dur, rng), mid = noise(sr, S.dur, rng);
    filt(rumble, 'lowpass', 150, 0.7, sr, 2);
    sweep(mid, 'lowpass', (u) => S.lp * exp(-u * 3.2) + 220, 0.7, sr);
    const wob = wobble(L.length, sr, 12, rng);
    for (let i = 0; i < L.length; i++) {
      const t = i / sr, e = envAD(t - 0.014, 0.06, S.tau) * (0.8 + 0.2 * wob[i]);
      L[i] = rumble[i] * S.rum * e + mid[i] * S.mid * e;
    }
    for (const [d, a] of [[0.07, 0.55], [0.13, 0.42], [0.2, 0.36], [0.31, 0.24], [0.46, 0.16], [0.66, 0.1], [0.9, 0.05]]) {
      grain(sr, rng, L, (d + rng.range(-0.01, 0.01) + c * 0.007) * sr, { freq: rng.range(450, 850), q: 0.5, tau: 0.024, amp: a * 1.3, type: 'lowpass' });
    }
    fadeEdges(L, sr, 0.004, 0.3);
    return L;
  });
  return normalize(chans, 0.9);
}

// Indoors: a dense burst of early reflections off walls a few metres away, then a short bright decay.
function tailRoom(sr, rng, size) {
  const S = size === 'heavy' ? { dur: 0.75, tau: 0.11, n: 26 } : { dur: 0.5, tau: 0.07, n: 18 };
  const chans = [0, 1].map(() => {
    const L = samples(sr, S.dur);
    for (let k = 0; k < S.n; k++) {
      const d = 0.003 + Math.pow(rng.next(), 1.3) * 0.06;
      grain(sr, rng, L, d * sr, { freq: rng.range(900, 3200), q: 0.6, tau: 0.003, amp: rng.range(0.3, 1) * exp(-d / 0.04) });
    }
    const diff = noise(sr, S.dur, rng);
    sweep(diff, 'lowpass', (u) => 4200 * exp(-u * 2.2) + 500, 0.7, sr);
    for (let i = 0; i < L.length; i++) L[i] += diff[i] * envAD(i / sr - 0.004, 0.012, S.tau) * 0.6;
    filt(L, 'highpass', 120, 0.7, sr);
    fadeEdges(L, sr, 0.002, 0.15);
    return L;
  });
  return normalize(chans, 0.9);
}

// ---------------------------------------------------------------- layers on a shot

// Upgraded: a short energised ring and a rising shimmer over the shot.
function upgradeZing(sr, rng) {
  const out = samples(sr, 0.4);
  modal(sr, 0, [[2200, 0.12, 0.5], [3310, 0.1, 0.4], [4960, 0.07, 0.3], [6600, 0.05, 0.2]], rng, out, 0);
  tone(sr, out, 0, 0.3, 900, 0.25, { fEnd: 3600, tau: 0.08, attack: 0.002 });
  const sh = noise(sr, 0.3, rng);
  filt(sh, 'highpass', 5000, 0.7, sr);
  for (let i = 0; i < sh.length; i++) sh[i] *= envAD(i / sr, 0.004, 0.06);
  mixInto(out, sh, 0, 0.4);
  return normalize(fadeEdges(dcBlock(out, sr), sr, 0.001, 0.06), 0.9);
}

// Suppressed: what is left is a dull puff, the gas spit and the action.
function suppressorPuff(sr, rng) {
  const out = samples(sr, 0.18);
  grain(sr, rng, out, 0, { freq: 420, q: 0.8, tau: 0.018, amp: 3, type: 'lowpass' });
  grain(sr, rng, out, 0, { freq: 1900, q: 1.1, tau: 0.004, amp: 1.0 });
  chirp(sr, 0.1, (t) => 120 + 90 * exp(-t / 0.01), (t) => 0.4 * envAD(t, 0.001, 0.02), out);
  click(sr, rng, out, 0.025, 2200, 0.25);
  return normalize(fadeEdges(dcBlock(out, sr), sr, 0.0005, 0.04), 0.9);
}

// ---------------------------------------------------------------- reload and handling foley

function part(sr, rng, dur, fn) { const out = samples(sr, dur); fn(out); return normalize(fadeEdges(dcBlock(out, sr), sr, 0.001, 0.02), 0.9); }

const FOLEY = {
  mag_out: (sr, rng) => part(sr, rng, 0.32, (o) => { click(sr, rng, o, 0.01, 2600, 0.4); friction(sr, rng, o, 0.05, 0.13, 1800, 0.3); click(sr, rng, o, 0.2, 1500, 0.12, 0.5); }),
  mag_in: (sr, rng) => part(sr, rng, 0.3, (o) => { friction(sr, rng, o, 0.0, 0.11, 2200, 0.3); click(sr, rng, o, 0.12, 1900, 0.55, 1.2); }),
  slide_rack: (sr, rng) => part(sr, rng, 0.35, (o) => { friction(sr, rng, o, 0.0, 0.12, 3000, 0.25); click(sr, rng, o, 0.13, 2300, 0.35); click(sr, rng, o, 0.24, 1700, 0.6, 1.0); }),
  bolt_rack: (sr, rng) => part(sr, rng, 0.38, (o) => { click(sr, rng, o, 0.0, 1500, 0.3, 0.3); friction(sr, rng, o, 0.02, 0.12, 1600, 0.3); click(sr, rng, o, 0.15, 1200, 0.4, 0.6); click(sr, rng, o, 0.27, 1050, 0.6, 1.1); }),
  shell_in: (sr, rng) => part(sr, rng, 0.24, (o) => { friction(sr, rng, o, 0.0, 0.08, 900, 0.35, 0.7); click(sr, rng, o, 0.085, 1300, 0.35, 0.7); grain(sr, rng, o, 0.09 * sr, { freq: 700, q: 1, tau: 0.01, amp: 0.4 }); }),
  pump_rack: (sr, rng) => part(sr, rng, 0.42, (o) => { friction(sr, rng, o, 0.0, 0.08, 1100, 0.3); click(sr, rng, o, 0.08, 900, 0.4, 0.8); friction(sr, rng, o, 0.16, 0.07, 1400, 0.25); click(sr, rng, o, 0.24, 1150, 0.5, 1.0); }),
  cyl_open: (sr, rng) => part(sr, rng, 0.22, (o) => { click(sr, rng, o, 0.0, 2100, 0.35); friction(sr, rng, o, 0.03, 0.08, 2600, 0.2); click(sr, rng, o, 0.11, 1600, 0.3, 0.3); }),
  cyl_eject: (sr, rng) => part(sr, rng, 0.7, (o) => {
    friction(sr, rng, o, 0.0, 0.06, 1800, 0.3);
    for (let k = 0; k < 6; k++) {
      const at = Math.round(rng.range(0.08, 0.5) * sr), f = rng.range(2700, 3600);
      modal(sr, 0, [[f, 0.04, 0.3], [f * 2.76, 0.02, 0.15]], rng, o, at);
    }
  }),
  speed_load: (sr, rng) => part(sr, rng, 0.28, (o) => { friction(sr, rng, o, 0.0, 0.12, 2000, 0.3); click(sr, rng, o, 0.13, 1800, 0.3); click(sr, rng, o, 0.17, 1600, 0.25); }),
  cyl_close: (sr, rng) => part(sr, rng, 0.22, (o) => { click(sr, rng, o, 0.0, 1700, 0.6, 0.6); friction(sr, rng, o, 0.03, 0.12, 3500, 0.12, 2); }),
  cover_open: (sr, rng) => part(sr, rng, 0.35, (o) => { click(sr, rng, o, 0.0, 1200, 0.4, 0.4); friction(sr, rng, o, 0.03, 0.12, 900, 0.25); click(sr, rng, o, 0.17, 800, 0.5, 0.9); }),
  belt: (sr, rng) => part(sr, rng, 0.6, (o) => {
    for (let k = 0; k < 22; k++) {
      const at = Math.round((0.02 + Math.pow(rng.next(), 0.8) * 0.5) * sr), f = rng.range(2400, 5000);
      modal(sr, 0, [[f, 0.015, 0.2], [f * 1.6, 0.01, 0.12]], rng, o, at);
    }
    friction(sr, rng, o, 0.05, 0.4, 1500, 0.15);
  }),
  cover_close: (sr, rng) => part(sr, rng, 0.3, (o) => { click(sr, rng, o, 0.0, 900, 0.8, 1.4); grain(sr, rng, o, 0, { freq: 180, q: 0.8, tau: 0.03, amp: 0.8, type: 'lowpass' }); }),
  cell_out: (sr, rng) => part(sr, rng, 0.4, (o) => {
    click(sr, rng, o, 0.0, 1800, 0.4);
    const h = noise(sr, 0.3, rng); filt(h, 'highpass', 3000, 0.7, sr);
    for (let i = 0; i < h.length; i++) h[i] *= envAD(i / sr, 0.005, 0.08);
    mixInto(o, h, 0.02 * sr, 0.5);
    friction(sr, rng, o, 0.15, 0.12, 1200, 0.3);
  }),
  cell_in: (sr, rng) => part(sr, rng, 0.75, (o) => {
    friction(sr, rng, o, 0.0, 0.1, 1300, 0.3); click(sr, rng, o, 0.11, 1400, 0.6, 0.9);
    tone(sr, o, 0.16, 0.55, 220, 0.25, { fEnd: 1900, tau: 0.6, attack: 0.3 });
    tone(sr, o, 0.16, 0.55, 440, 0.08, { fEnd: 3800, tau: 0.6, attack: 0.3 });
  }),
  flare_break: (sr, rng) => part(sr, rng, 0.45, (o) => { click(sr, rng, o, 0.0, 1300, 0.45, 0.5); friction(sr, rng, o, 0.04, 0.12, 900, 0.2); grain(sr, rng, o, 0.2 * sr, { freq: 600, q: 1, tau: 0.01, amp: 0.4 }); modal(sr, 0, [[1900, 0.03, 0.2]], rng, o, Math.round(0.25 * sr)); }),
  flare_close: (sr, rng) => part(sr, rng, 0.22, (o) => { click(sr, rng, o, 0.0, 1100, 0.7, 0.9); }),
  weapon_draw: (sr, rng) => part(sr, rng, 0.32, (o) => { friction(sr, rng, o, 0.0, 0.16, 700, 0.25, 0.6); click(sr, rng, o, 0.17, 1900, 0.3, 0.2); click(sr, rng, o, 0.23, 2400, 0.2); }),
};

// ---------------------------------------------------------------- melee and throwables

const swing = (sr, rng, axe) => part(sr, rng, axe ? 0.45 : 0.28, (o) => whoosh(sr, rng, o, 0, axe ? 0.42 : 0.25, axe ? 250 : 500, axe ? 1100 : 2400, 1, axe ? 1 : 1.6));

function meleeHit(sr, rng, axe) {
  const out = samples(sr, axe ? 0.45 : 0.32);
  grain(sr, rng, out, 0, { freq: axe ? 260 : 420, q: 0.8, tau: axe ? 0.04 : 0.02, amp: 3, type: 'lowpass' });
  const sq = noise(sr, 0.15, rng);
  sweep(sq, 'bandpass', (u) => (axe ? 1400 : 2400) * exp(-u * 5) + 300, 3, sr);
  for (let i = 0; i < sq.length; i++) sq[i] *= envAD(i / sr, 0.004, 0.04);
  mixInto(out, sq, 0.004 * sr, 1.6);
  if (axe) for (let g = 0; g < 10; g++) grain(sr, rng, out, (0.002 + rng.next() * 0.05) * sr, { freq: rng.range(1200, 3500), q: 1.5, tau: 0.002, amp: rng.range(0.2, 0.6) });
  else grain(sr, rng, out, 0, { freq: 3500, q: 1, tau: 0.002, amp: 0.7 });
  return normalize(fadeEdges(dcBlock(out, sr), sr, 0.0005, 0.05), 0.9);
}

const THROW = {
  throw_whoosh: (sr, rng) => part(sr, rng, 0.35, (o) => { friction(sr, rng, o, 0.0, 0.1, 600, 0.15, 0.6); whoosh(sr, rng, o, 0.05, 0.28, 300, 1500, 1); }),
  pin_pull: (sr, rng) => part(sr, rng, 0.35, (o) => { click(sr, rng, o, 0.0, 2400, 0.4); modal(sr, 0, [[3100, 0.15, 0.25], [4900, 0.09, 0.15], [7300, 0.05, 0.1]], rng, o, Math.round(0.03 * sr)); }),
  bottle_slosh: (sr, rng) => part(sr, rng, 0.5, (o) => {
    modal(sr, 0, [[1800, 0.08, 0.3], [2900, 0.05, 0.2]], rng, o, 0);
    for (let k = 0; k < 12; k++) grain(sr, rng, o, rng.range(0.05, 0.4) * sr, { freq: rng.range(400, 1200), q: 2, tau: 0.01, amp: rng.range(0.1, 0.3) });
  }),
  decoy_arm: (sr, rng) => part(sr, rng, 0.4, (o) => { tone(sr, o, 0.0, 0.08, 1400, 0.3, { tau: 0.2, attack: 0.003 }); tone(sr, o, 0.14, 0.08, 1400, 0.3, { tau: 0.2, attack: 0.003 }); click(sr, rng, o, 0.0, 2000, 0.2); }),
  glass_smash: (sr, rng) => {
    const out = samples(sr, 0.9);
    grain(sr, rng, out, 0, { freq: 2600, q: 0.5, tau: 0.003, amp: 1.5, type: 'highpass' });
    grain(sr, rng, out, 0, { freq: 400, q: 0.8, tau: 0.02, amp: 1.2, type: 'lowpass' });
    for (let s = 0; s < 60; s++) {
      const at = Math.round(Math.pow(rng.next(), 1.6) * 0.6 * sr), f = rng.range(2500, 9000);
      modal(sr, 0, [[f, rng.range(0.008, 0.03), rng.range(0.05, 0.3) * (1 - at / sr / 0.8)]], rng, out, at);
    }
    return normalize(fadeEdges(dcBlock(out, sr), sr, 0.0005, 0.1), 0.9);
  },
};

// ---------------------------------------------------------------- explosions and fire

function* explosion(sr, rng) {
  const dur = 2.8;
  const chans = [];
  for (let c = 0; c < 2; c++) {
    yield;
    chans.push((() => {
    const L = samples(sr, dur), n = L.length;
    const crack = new Float32Array(n), roar = new Float32Array(n), rum = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      crack[i] = white(rng) * exp(-t / 0.004);
      roar[i] = white(rng) * envAD(t, 0.003, 0.12);
      rum[i] = white(rng) * envAD(t, 0.03, 0.55);
    }
    filt(crack, 'highpass', 1500, 0.7, sr);
    sweep(roar, 'lowpass', (u) => 5000 * exp(-u * 18) + 300, 0.7, sr);
    filt(rum, 'lowpass', 110, 0.7, sr, 2);
    mixInto(L, crack, 0, 2.5);
    mixInto(L, roar, 0, 2.2);
    mixInto(L, rum, 0, 3.0);
    chirp(sr, 0.8, (t) => 32 + 110 * exp(-t / 0.05), (t) => 1.1 * envAD(t, 0.002, 0.18), L);
    // debris raining back: grit, metal and glass
    for (let g = 0; g < 70; g++) {
      const at = (0.15 + Math.pow(rng.next(), 1.3) * 1.6) * sr;
      if (rng.next() < 0.2) modal(sr, 0, [[rng.range(1500, 4000), 0.03, rng.range(0.03, 0.1)]], rng, L, Math.round(at));
      else grain(sr, rng, L, at, { freq: rng.range(1500, 5000), q: 1.5, tau: rng.range(0.001, 0.004), amp: rng.range(0.05, 0.25) * (1 - at / sr / 2) });
    }
    return fadeEdges(dcBlock(L, sr), sr, 0.0005, 0.6);
    })());
  }
  normalize(chans, 1);
  for (const c of chans) saturate(c, 1.6);
  return normalize(chans, 0.95);
}

// Heard from across the lot: the boom arrives without its top, and rolls.
function* explosionFar(sr, rng) {
  const dur = 3.2;
  const chans = [];
  for (let c = 0; c < 2; c++) {
    const L = noise(sr, dur, rng);
    filt(L, 'lowpass', 220, 0.7, sr, 2);
    yield;
    const wob = wobble(L.length, sr, 5, rng);
    for (let i = 0; i < L.length; i++) L[i] *= envAD(i / sr, 0.05, 0.7) * (0.7 + 0.3 * wob[i]);
    chans.push(fadeEdges(dcBlock(L, sr), sr, 0.01, 0.8));
  }
  return normalize(chans, 0.9);
}

function explosionSmall(sr, rng) {
  const out = samples(sr, 0.7);
  grain(sr, rng, out, 0, { freq: 1800, q: 0.6, tau: 0.003, amp: 1.5, type: 'highpass' });
  grain(sr, rng, out, 0, { freq: 500, q: 0.7, tau: 0.04, amp: 3, type: 'lowpass' });
  chirp(sr, 0.4, (t) => 60 + 120 * exp(-t / 0.03), (t) => 0.6 * envAD(t, 0.001, 0.08), out);
  for (let g = 0; g < 20; g++) grain(sr, rng, out, rng.range(0.05, 0.5) * sr, { freq: rng.range(2000, 6000), q: 1.5, tau: 0.0015, amp: rng.range(0.05, 0.2) });
  return normalize(fadeEdges(dcBlock(out, sr), sr, 0.0005, 0.15), 0.9);
}

function fireIgnite(sr, rng) {
  const out = samples(sr, 1.2), n = out.length;
  const s = noise(sr, 1.2, rng);
  sweep(s, 'lowpass', (u) => 300 + 2600 * Math.sin(Math.PI * Math.min(1, u * 2.2)), 0.8, sr);
  for (let i = 0; i < n; i++) out[i] = s[i] * envAD(i / sr, 0.08, 0.35);
  chirp(sr, 0.6, (t) => 50 + 40 * t, (t) => 0.35 * envAD(t, 0.05, 0.2), out);
  for (let g = 0; g < 30; g++) grain(sr, rng, out, rng.range(0.1, 1.0) * sr, { freq: rng.range(1500, 5000), q: 1.2, tau: 0.001, amp: rng.range(0.05, 0.25) });
  return normalize(fadeEdges(dcBlock(out, sr), sr, 0.002, 0.3), 0.9);
}

// A burning pool: low roar, flutter and crackle. Loops (the last 0.4 s cross-fades into the start).
function* fireLoop(sr, rng) {
  const dur = 4.4;
  const out = samples(sr, dur), n = out.length;
  const roar = noise(sr, dur, rng);
  filt(roar, 'lowpass', 700, 0.7, sr, 2);
  yield;
  const flut = wobble(n, sr, 9, rng), slow = wobble(n, sr, 1.3, rng);
  const hiss = noise(sr, dur, rng);
  filt(hiss, 'bandpass', 3000, 0.6, sr);
  yield;
  for (let i = 0; i < n; i++) out[i] = roar[i] * 1.6 * (0.75 + 0.25 * flut[i]) * (0.85 + 0.15 * slow[i]) + hiss[i] * 0.12 * (0.6 + 0.4 * flut[i]);
  for (let g = 0; g < 150; g++) grain(sr, rng, out, rng.next() * (n - 0.02 * sr), { freq: rng.range(1500, 6000), q: 1.2, tau: rng.range(0.0005, 0.002), amp: rng.range(0.1, 0.6) });
  yield;
  return normalize(loopify(dcBlock(out, sr), sr, 0.4), 0.8);
}

// The flare in flight: a fizzing hiss with a fast flutter. Loops.
function flareWhoosh(sr, rng) {
  const dur = 2.3;
  const s = noise(sr, dur, rng), n = s.length;
  filt(s, 'bandpass', 3200, 0.8, sr);
  const fl = wobble(n, sr, 22, rng);
  for (let i = 0; i < n; i++) s[i] *= 0.7 + 0.3 * fl[i];
  for (let g = 0; g < 60; g++) grain(sr, rng, s, rng.next() * (n - 0.01 * sr), { freq: rng.range(2000, 6000), q: 1, tau: 0.0008, amp: rng.range(0.1, 0.4) });
  return normalize(loopify(dcBlock(s, sr), sr, 0.3), 0.8);
}

function flareBurst(sr, rng) {
  const out = samples(sr, 1.1);
  grain(sr, rng, out, 0, { freq: 700, q: 0.7, tau: 0.03, amp: 2.5, type: 'lowpass' });
  grain(sr, rng, out, 0, { freq: 2500, q: 0.6, tau: 0.005, amp: 1.2 });
  const s = noise(sr, 1.0, rng);
  filt(s, 'highpass', 2200, 0.7, sr);
  for (let i = 0; i < s.length; i++) s[i] *= envAD(i / sr, 0.02, 0.35);
  mixInto(out, s, 0.01 * sr, 0.5);
  return normalize(fadeEdges(dcBlock(out, sr), sr, 0.0005, 0.2), 0.9);
}

// One link of the Jumper's chain landing on a body: a crackling zap.
function arcZap(sr, rng) {
  const out = samples(sr, 0.3), n = out.length;
  const z = noise(sr, 0.3, rng);
  filt(z, 'bandpass', 3000, 1, sr);
  for (let i = 0; i < n; i++) { const t = i / sr; z[i] *= envAD(t, 0.001, 0.05) * (Math.sin(2 * Math.PI * 110 * t) > -0.2 ? 1 : 0.2); }
  mixInto(out, z, 0, 1.5);
  for (let g = 0; g < 18; g++) grain(sr, rng, out, Math.pow(rng.next(), 2) * 0.25 * sr, { freq: rng.range(3000, 9000), q: 1, tau: 0.0006, amp: rng.range(0.2, 0.8) });
  return normalize(fadeEdges(dcBlock(out, sr), sr, 0.0005, 0.05), 0.9);
}

// The decoy calling: a pulsing beep and a garbled radio voice under static. Loops.
function decoyChatter(sr, rng) {
  const dur = 3.3;
  const out = samples(sr, dur), n = out.length;
  for (let k = 0; k < 6; k++) tone(sr, out, k * 0.5, 0.09, k % 2 ? 1180 : 1560, 0.25, { tau: 0.4, attack: 0.004 });
  const st = noise(sr, dur, rng);
  filt(st, 'bandpass', 2000, 0.7, sr);
  const talk = noise(sr, dur, rng);
  const syl = wobble(n, sr, 6, rng), f = wobble(n, sr, 3, rng);
  sweep(talk, 'bandpass', (u) => 900 + 500 * f[Math.min(n - 1, Math.floor(u * n))], 4, sr);
  for (let i = 0; i < n; i++) out[i] += st[i] * 0.04 + talk[i] * 0.5 * Math.max(0, syl[i]);
  filt(out, 'highpass', 300, 0.7, sr);
  filt(out, 'lowpass', 3500, 0.7, sr);
  return normalize(loopify(dcBlock(out, sr), sr, 0.3), 0.8);
}

// ---------------------------------------------------------------- tables

export const WEAPON_SFX = {
  ...Object.fromEntries(Object.entries(SHOTS).map(([id, P]) => [`shot_${id}`, { variants: 2, gen: (sr, rng) => gun(sr, rng, P) }])),
  shot_jumper: { variants: 2, gen: (sr, rng) => jumper(sr, rng) },
  shot_flare: { variants: 2, gen: (sr, rng) => flareShot(sr, rng) },
  tail_open_medium: { variants: 2, gen: (sr, rng) => tailOpen(sr, rng, 'medium') },
  tail_open_heavy: { variants: 2, gen: (sr, rng) => tailOpen(sr, rng, 'heavy') },
  tail_room_light: { variants: 2, gen: (sr, rng) => tailRoom(sr, rng, 'light') },
  tail_room_heavy: { variants: 2, gen: (sr, rng) => tailRoom(sr, rng, 'heavy') },
  upgrade_zing: { variants: 1, gen: (sr, rng) => upgradeZing(sr, rng) },
  suppressor_puff: { variants: 2, gen: (sr, rng) => suppressorPuff(sr, rng) },
  ...Object.fromEntries(Object.entries(FOLEY).map(([k, g]) => [k, { variants: 1, gen: g }])),
  swing_knife: { variants: 2, gen: (sr, rng) => swing(sr, rng, false) },
  swing_axe: { variants: 2, gen: (sr, rng) => swing(sr, rng, true) },
  melee_stab: { variants: 2, gen: (sr, rng) => meleeHit(sr, rng, false) },
  melee_chop: { variants: 2, gen: (sr, rng) => meleeHit(sr, rng, true) },
  ...Object.fromEntries(Object.entries(THROW).map(([k, g]) => [k, { variants: 1, gen: g }])),
  explosion: { variants: 2, gen: (sr, rng) => explosion(sr, rng) },
  explosion_far: { variants: 1, gen: (sr, rng) => explosionFar(sr, rng) },
  explosion_small: { variants: 1, gen: (sr, rng) => explosionSmall(sr, rng) },
  fire_ignite: { variants: 1, gen: (sr, rng) => fireIgnite(sr, rng) },
  fire_loop: { variants: 1, gen: (sr, rng) => fireLoop(sr, rng) },
  flare_whoosh: { variants: 1, gen: (sr, rng) => flareWhoosh(sr, rng) },
  flare_burst: { variants: 1, gen: (sr, rng) => flareBurst(sr, rng) },
  arc_zap: { variants: 3, gen: (sr, rng) => arcZap(sr, rng) },
  decoy_chatter: { variants: 1, gen: (sr, rng) => decoyChatter(sr, rng) },
};

// Per weapon: the shot buffer, its tail size, the dry-fire pitch, and the reload as parts at fractions
// of the reload time (`shell` kinds: `start` once, `each` per shell at shellStart + k * per-shell time,
// `end` after the last). `reload` is the fallback time in seconds when G.weapon.def is not there.
export const WEAPON_PLAN = {
  pistol: { shot: 'pistol', size: 'light', tail: 'pistol_tail_open', room: 'tail_room_light', dry: 1, reload: 1.6, parts: [['mag_out', 0.05], ['mag_in', 0.48], ['slide_rack', 0.76]] },
  revolver: { shot: 'shot_revolver', size: 'heavy', tail: 'tail_open_heavy', room: 'tail_room_heavy', dry: 0.85, reload: 2.4, parts: [['cyl_open', 0.02], ['cyl_eject', 0.12], ['speed_load', 0.52], ['cyl_close', 0.82]] },
  pump: { shot: 'shot_pump', size: 'heavy', tail: 'tail_open_heavy', room: 'tail_room_heavy', dry: 0.75, reload: 0.55, shellStart: 0.3, shell: { each: 'shell_in', end: 'pump_rack' } },
  autoShotgun: { shot: 'shot_autoShotgun', size: 'heavy', tail: 'tail_open_heavy', room: 'tail_room_heavy', dry: 0.8, reload: 0.45, shellStart: 0.5, shell: { each: 'shell_in', end: 'bolt_rack' } },
  smg: { shot: 'shot_smg', size: 'light', tail: 'pistol_tail_open', room: 'tail_room_light', dry: 1.1, reload: 1.9, parts: [['mag_out', 0.06], ['mag_in', 0.5], ['bolt_rack', 0.78, 1.15]] },
  rifle: { shot: 'shot_rifle', size: 'medium', tail: 'tail_open_medium', room: 'tail_room_light', dry: 1, reload: 2.2, parts: [['mag_out', 0.06], ['mag_in', 0.5], ['bolt_rack', 0.8]] },
  battleRifle: { shot: 'shot_battleRifle', size: 'heavy', tail: 'tail_open_heavy', room: 'tail_room_heavy', dry: 0.9, reload: 2.5, parts: [['mag_out', 0.06, 0.9], ['mag_in', 0.52, 0.9], ['bolt_rack', 0.82, 0.9]] },
  lmg: { shot: 'shot_lmg', size: 'heavy', tail: 'tail_open_heavy', room: 'tail_room_heavy', dry: 0.8, reload: 4.6, parts: [['cover_open', 0.05], ['belt', 0.28], ['belt', 0.44, 0.95], ['cover_close', 0.68], ['bolt_rack', 0.86, 0.8]] },
  jumper: { shot: 'shot_jumper', size: 'medium', tail: 'tail_open_medium', room: 'tail_room_light', dry: 1.3, reload: 2.8, parts: [['cell_out', 0.05], ['cell_in', 0.45]] },
  flare: { shot: 'shot_flare', size: 'light', tail: 'pistol_tail_open', room: 'tail_room_light', dry: 0.9, reload: 1.7, parts: [['flare_break', 0.05], ['shell_in', 0.5, 0.8], ['flare_close', 0.8]] },
};
export const WEAPON_IDS = Object.keys(WEAPON_PLAN);

// Public sound names -> { base buffer, pitch, gain, lowpass (Hz), layers to play with it }. Every weapon
// has <id>:shot, :shot:upgraded, :shot:suppressed, :tail-open, :tail-room, :dry and :reload-<part>.
export const WEAPON_ALIASES = {};
for (const [id, W] of Object.entries(WEAPON_PLAN)) {
  WEAPON_ALIASES[`${id}:shot`] = { base: W.shot };
  WEAPON_ALIASES[`${id}:shot:upgraded`] = { base: W.shot, pitch: 0.96, gain: 1.1, layers: ['upgrade_zing'] };
  WEAPON_ALIASES[`${id}:shot:suppressed`] = { base: W.shot, gain: 0.45, lowpass: 1500, layers: ['suppressor_puff'] };
  WEAPON_ALIASES[`${id}:tail-open`] = { base: W.tail };
  WEAPON_ALIASES[`${id}:tail-room`] = { base: W.room };
  WEAPON_ALIASES[`${id}:dry`] = { base: 'dry_fire', pitch: W.dry };
  const parts = W.parts ? W.parts.map((p) => p[0]) : [W.shell.each, W.shell.end];
  for (const p of parts) WEAPON_ALIASES[`${id}:reload-${p}`] = { base: p };
}
