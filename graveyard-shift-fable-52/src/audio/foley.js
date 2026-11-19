// World, economy and interface sounds: footsteps on every floor, the power switch, door
// barriers, searching (a rummage loop per kind, the opening, a short result per reward), blood, the
// weapon box, machines, the bench, pickups, power-ups, stings, hints and UI. All original: struck
// metal, wood, glass and short tonal figures, no melodies from anywhere.
import {
  samples, white, filt, sweep, noise, envAD, mixInto, normalize, saturate, fadeEdges, dcBlock,
  modal, chirp, grain, bubble, wobble, loopify, click, friction, whoosh, tone,
} from './synth.js';

const exp = Math.exp;
const done = (out, sr, a = 0.002, r = 0.05, peak = 0.9) => normalize(fadeEdges(dcBlock(out, sr), sr, a, r), peak);

// ---------------------------------------------------------------- footsteps

// Heel and toe on a floor: [heel low-pass Hz, heel tau, scuff band Hz, scuff amp, ring modes, grit].
const FLOORS = {
  tile: { heel: 520, tau: 0.006, scuff: 2800, sAmp: 0.35, ring: [[1900, 0.012, 0.25], [3300, 0.008, 0.15]], grit: 0.15, clack: 0.5 },
  wood: { heel: 300, tau: 0.012, scuff: 1300, sAmp: 0.3, ring: [[180, 0.03, 0.35], [410, 0.02, 0.2]], grit: 0.05, creak: true },
  carpet: { heel: 220, tau: 0.016, scuff: 900, sAmp: 0.18, ring: [], grit: 0, soft: true },
  metal: { heel: 380, tau: 0.008, scuff: 2200, sAmp: 0.2, ring: [[310, 0.09, 0.35], [520, 0.07, 0.3], [870, 0.05, 0.25], [1430, 0.035, 0.2]], grit: 0.1, clack: 0.3 },
  dirt: { heel: 240, tau: 0.018, scuff: 1700, sAmp: 0.45, ring: [], grit: 0.6, wet: 0.6 },
};
function step(sr, rng, kind) {
  const F = FLOORS[kind];
  const out = samples(sr, 0.3), n = out.length;
  const heel = new Float32Array(n), scuff = new Float32Array(n);
  const toe = rng.range(0.055, 0.085);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    heel[i] = white(rng) * envAD(t, F.soft ? 0.004 : 0.001, F.tau);
    scuff[i] = white(rng) * (envAD(t, 0.003, 0.02) + 0.6 * envAD(t - toe, 0.004, 0.028));
  }
  filt(heel, 'lowpass', F.heel, 0.9, sr, 2);
  filt(scuff, 'bandpass', F.scuff, 0.8, sr);
  mixInto(out, heel, 0, 9);
  mixInto(out, scuff, 0, F.sAmp);
  const fThump = rng.range(80, 110), fCreak = rng.range(260, 340);
  chirp(sr, 0.08, () => fThump, (t) => 0.25 * envAD(t, 0.001, 0.018), out);
  if (F.ring.length) {
    modal(sr, 0, F.ring.map(([f, tau, a]) => [f * rng.range(0.95, 1.05), tau, a]), rng, out, 0, 0.6);
    modal(sr, 0, F.ring.map(([f, tau, a]) => [f * rng.range(0.95, 1.05), tau, a * 0.5]), rng, out, Math.round(toe * sr), 0.6);
  }
  if (F.clack) grain(sr, rng, out, 0, { freq: 4000, q: 0.8, tau: 0.0007, amp: F.clack });
  if (F.creak && rng.next() < 0.6) chirp(sr, 0.12, (t) => fCreak * (1 + 0.3 * t), (t) => 0.05 * Math.sin(Math.PI * Math.min(1, t / 0.12)), out, Math.round(0.03 * sr));
  for (let d = 0; d < Math.round(F.grit * 20); d++) grain(sr, rng, out, (0.004 + Math.pow(rng.next(), 2) * 0.12) * sr, { freq: rng.range(1800, 5000), q: 1.5, tau: 0.001, amp: rng.range(0.03, 0.1) });
  if (F.wet) for (let d = 0; d < 6; d++) bubble(sr, out, (0.005 + rng.next() * 0.1) * sr, { freq: rng.range(900, 2400), tau: 0.008, amp: 0.05 * F.wet, rise: 0.3 });
  return done(out, sr, 0.0005, 0.04);
}

// ---------------------------------------------------------------- power, neon, doors

// The knife switch: a heavy lever thrown home, an arc spark, relays clacking down the line.
function knifeSwitch(sr, rng) {
  const out = samples(sr, 1.4);
  friction(sr, rng, out, 0.0, 0.18, 800, 0.4);
  click(sr, rng, out, 0.18, 700, 1.0, 2.0);
  const arc = noise(sr, 0.12, rng);
  filt(arc, 'highpass', 2500, 0.7, sr);
  for (let i = 0; i < arc.length; i++) arc[i] *= envAD(i / sr, 0.001, 0.03) * (Math.sin(2 * Math.PI * 120 * i / sr) > 0 ? 1 : 0.2);
  mixInto(out, arc, 0.18 * sr, 1.2);
  for (const [at, f] of [[0.45, 1500], [0.62, 1300], [0.78, 1700], [0.9, 1200]]) click(sr, rng, out, at, f, 0.4, 0.4);
  return done(out, sr, 0.002, 0.15);
}

// The current coming up: a mains hum rising into pitch.
function powerHum(sr, rng) {
  const dur = 2.5, out = samples(sr, dur);
  for (const [h, a] of [[1, 0.5], [2, 0.3], [3, 0.15], [5, 0.06]]) tone(sr, out, 0, dur, 30 * h, a, { fEnd: 60 * h, attack: 1.4, tau: 1.2 });
  filt(out, 'highpass', 45, 0.7, sr);
  return done(out, sr, 0.05, 0.4);
}

function doorBoarded(sr, rng) {
  const out = samples(sr, 1.5);
  for (let k = 0; k < 4; k++) {
    const at = k * 0.22 + rng.range(0, 0.05);
    for (let c = 0; c < 4; c++) grain(sr, rng, out, (at + c * 0.01) * sr, { freq: rng.range(900, 2500), q: 1.2, tau: 0.004, amp: rng.range(0.5, 1) });
    const fn = rng.range(1800, 2400);
    chirp(sr, 0.1, (t) => fn * (1 - 0.3 * t), (t) => 0.08 * envAD(t, 0.005, 0.04), out, Math.round(at * sr));
    modal(sr, 0, [[rng.range(300, 420), 0.05, 0.5]], rng, out, Math.round((at + 0.4) * sr));
  }
  grain(sr, rng, out, 1.0 * sr, { freq: 220, q: 0.8, tau: 0.04, amp: 2.5, type: 'lowpass' });
  return done(out, sr, 0.002, 0.15);
}

function doorSheet(sr, rng) {
  const out = samples(sr, 1.8);
  click(sr, rng, out, 0.0, 1100, 0.5, 0.5); // padlock and chain
  for (let k = 0; k < 5; k++) modal(sr, 0, [[rng.range(2000, 3500), 0.02, 0.2]], rng, out, Math.round(rng.range(0.02, 0.2) * sr));
  friction(sr, rng, out, 0.25, 1.0, 600, 0.6, 0.7);
  const sq = noise(sr, 1.0, rng);
  sweep(sq, 'bandpass', (u) => 900 + 300 * Math.sin(u * 9), 8, sr);
  mixInto(out, sq, 0.25 * sr, 0.15);
  modal(sr, 0, [[95, 0.4, 0.5], [210, 0.3, 0.4], [455, 0.2, 0.3], [800, 0.12, 0.2]], rng, out, Math.round(1.3 * sr));
  grain(sr, rng, out, 1.3 * sr, { freq: 2500, q: 0.6, tau: 0.003, amp: 0.8 });
  return done(out, sr, 0.002, 0.2);
}

function doorRoller(sr, rng) {
  const out = samples(sr, 2.4), n = out.length;
  click(sr, rng, out, 0.0, 900, 0.6, 0.6);
  const rat = new Float32Array(n);
  for (let k = 0; k < 90; k++) {
    const at = 0.15 + k * 0.022 + rng.range(-0.003, 0.003);
    if (at > 2.1) break;
    grain(sr, rng, rat, at * sr, { freq: rng.range(600, 1400), q: 2, tau: 0.004, amp: rng.range(0.4, 0.8) });
  }
  mixInto(out, rat, 0, 1);
  friction(sr, rng, out, 0.15, 1.95, 400, 0.4, 0.5);
  click(sr, rng, out, 2.15, 700, 0.8, 1.2);
  return done(out, sr, 0.002, 0.15);
}

// ---------------------------------------------------------------- searching

// Rummage loops by what is searched, for the 1.5 s hold; they stop dead on a cancel.
function rummage(sr, rng, kind) {
  const dur = 1.8, out = samples(sr, dur), n = out.length;
  const R = {
    car: { f: 900, hits: 22, ring: [700, 1400] },
    drawer: { f: 2400, hits: 30, ring: [1800, 3500] },
    lid: { f: 1300, hits: 26, ring: [900, 2200] },
    locker: { f: 1800, hits: 26, ring: [2200, 5000] },
  }[kind];
  const s = noise(sr, dur, rng);
  filt(s, 'bandpass', R.f, 0.7, sr);
  const w = wobble(n, sr, 7, rng);
  for (let i = 0; i < n; i++) out[i] = s[i] * 0.15 * Math.max(0, w[i]);
  for (let k = 0; k < R.hits; k++) {
    const at = rng.next() * (n - 0.05 * sr);
    if (rng.next() < 0.5) modal(sr, 0, [[rng.range(R.ring[0], R.ring[1]), 0.015, rng.range(0.1, 0.35)]], rng, out, Math.round(at));
    else grain(sr, rng, out, at, { freq: rng.range(R.f * 0.6, R.f * 2), q: 1.2, tau: 0.003, amp: rng.range(0.2, 0.6) });
  }
  return normalize(loopify(dcBlock(out, sr), sr, 0.3), 0.85);
}

const OPENS = {
  car: (sr, rng) => { const o = samples(sr, 0.9); click(sr, rng, o, 0, 1200, 0.5, 0.5); chirp(sr, 0.35, (t) => 380 + 200 * t, (t) => 0.06 * Math.sin(Math.PI * t / 0.35), o, Math.round(0.08 * sr)); grain(sr, rng, o, 0.45 * sr, { freq: 160, q: 0.8, tau: 0.04, amp: 2, type: 'lowpass' }); modal(sr, 0, [[140, 0.15, 0.3], [330, 0.1, 0.2]], rng, o, Math.round(0.45 * sr)); return done(o, sr); },
  drawer: (sr, rng) => { const o = samples(sr, 0.6); friction(sr, rng, o, 0, 0.3, 1100, 0.5); click(sr, rng, o, 0.3, 800, 0.4, 0.8); return done(o, sr); },
  lid: (sr, rng) => { const o = samples(sr, 0.7); click(sr, rng, o, 0, 1500, 0.4); grain(sr, rng, o, 0.15 * sr, { freq: 300, q: 0.8, tau: 0.03, amp: 2, type: 'lowpass' }); modal(sr, 0, [[520, 0.08, 0.3], [1100, 0.05, 0.2]], rng, o, Math.round(0.15 * sr)); return done(o, sr); },
  locker: (sr, rng) => { const o = samples(sr, 1.0); click(sr, rng, o, 0, 1900, 0.4); chirp(sr, 0.4, (t) => 600 * (1 + 0.1 * Math.sin(t * 40)), (t) => 0.05 * Math.sin(Math.PI * t / 0.4), o, Math.round(0.05 * sr)); modal(sr, 0, [[260, 0.25, 0.5], [610, 0.18, 0.4], [1240, 0.1, 0.3]], rng, o, Math.round(0.5 * sr)); return done(o, sr); },
};

// What was found: short, each its own material, none of them a chime; 'nothing' is flat and dull.
const REWARDS = {
  reward_ammo: (sr, rng) => { const o = samples(sr, 0.5); for (let k = 0; k < 9; k++) modal(sr, 0, [[rng.range(2600, 3600), 0.03, 0.3]], rng, o, Math.round(rng.range(0, 0.25) * sr)); grain(sr, rng, o, 0, { freq: 300, q: 0.8, tau: 0.02, amp: 1, type: 'lowpass' }); return done(o, sr); },
  reward_points: (sr, rng) => { const o = samples(sr, 0.6); for (let k = 0; k < 7; k++) modal(sr, 0, [[rng.range(3500, 5200), 0.06, 0.3], [rng.range(7000, 9000), 0.03, 0.15]], rng, o, Math.round((k * 0.035 + rng.range(0, 0.01)) * sr)); friction(sr, rng, o, 0.0, 0.15, 4000, 0.1); return done(o, sr); },
  reward_medkit: (sr, rng) => { const o = samples(sr, 0.6); const z = noise(sr, 0.25, rng); sweep(z, 'bandpass', (u) => 1500 + 2500 * u, 3, sr); for (let i = 0; i < z.length; i++) z[i] *= Math.sin(Math.PI * i / z.length) * (0.6 + 0.4 * Math.sin(i / sr * 2 * Math.PI * 70)); mixInto(o, z, 0, 0.5); for (let k = 0; k < 8; k++) modal(sr, 0, [[rng.range(1800, 2600), 0.01, 0.3]], rng, o, Math.round(rng.range(0.3, 0.45) * sr)); return done(o, sr); },
  reward_throwable: (sr, rng) => { const o = samples(sr, 0.4); grain(sr, rng, o, 0, { freq: 400, q: 0.8, tau: 0.02, amp: 2, type: 'lowpass' }); modal(sr, 0, [[1700, 0.05, 0.4], [2900, 0.03, 0.25]], rng, o, 0); return done(o, sr); },
  reward_plate: (sr, rng) => { const o = samples(sr, 0.6); friction(sr, rng, o, 0, 0.2, 1500, 0.4); modal(sr, 0, [[900, 0.12, 0.4], [1650, 0.08, 0.3], [2700, 0.05, 0.2]], rng, o, Math.round(0.2 * sr)); grain(sr, rng, o, 0.2 * sr, { freq: 250, q: 0.8, tau: 0.03, amp: 1.5, type: 'lowpass' }); return done(o, sr); },
  reward_powerup: (sr, rng) => { const o = samples(sr, 0.8); for (const [at, f] of [[0, 660], [0.08, 990], [0.16, 1320]]) modal(sr, 0, [[f, 0.3, 0.4], [f * 2.76, 0.1, 0.1]], rng, o, Math.round(at * sr)); return done(o, sr); },
  reward_attachment: (sr, rng) => { const o = samples(sr, 0.4); click(sr, rng, o, 0, 2200, 0.5); click(sr, rng, o, 0.09, 1700, 0.6, 0.4); return done(o, sr); },
  reward_weapon: (sr, rng) => { const o = samples(sr, 0.6); click(sr, rng, o, 0, 1300, 0.6, 1.0); modal(sr, 0, [[800, 0.08, 0.4], [1900, 0.05, 0.3]], rng, o, Math.round(0.02 * sr)); click(sr, rng, o, 0.2, 1700, 0.5, 0.5); return done(o, sr); },
  reward_nothing: (sr, rng) => { const o = samples(sr, 0.35); grain(sr, rng, o, 0, { freq: 220, q: 0.7, tau: 0.03, amp: 2, type: 'lowpass' }); friction(sr, rng, o, 0.02, 0.15, 500, 0.15, 0.6); return done(o, sr); },
};

// ---------------------------------------------------------------- blood

function drip(sr, rng) { const o = samples(sr, 0.18); bubble(sr, o, 0, { freq: rng.range(900, 1600), tau: 0.012, amp: 0.6, rise: 0.4 }); grain(sr, rng, o, 0, { freq: 300, q: 1, tau: 0.004, amp: 0.4, type: 'lowpass' }); return done(o, sr, 0.0005, 0.03); }

function headBurst(sr, rng) {
  const o = samples(sr, 0.6);
  grain(sr, rng, o, 0, { freq: 2800, q: 0.7, tau: 0.002, amp: 2 });
  grain(sr, rng, o, 0, { freq: 500, q: 0.7, tau: 0.03, amp: 3, type: 'lowpass' });
  const sq = noise(sr, 0.3, rng);
  sweep(sq, 'bandpass', (u) => 2500 * exp(-u * 5) + 400, 2.5, sr);
  for (let i = 0; i < sq.length; i++) sq[i] *= envAD(i / sr, 0.003, 0.06);
  mixInto(o, sq, 0, 1.8);
  for (let d = 0; d < 30; d++) bubble(sr, o, (0.02 + Math.pow(rng.next(), 1.5) * 0.4) * sr, { freq: rng.range(800, 2600), tau: 0.006, amp: rng.range(0.05, 0.15), rise: 0.4 });
  return done(o, sr, 0.0005, 0.1);
}

// ---------------------------------------------------------------- the box, machines, bench

// The box rolling: a pawl clicking over a ratchet wheel, slowing, with a tone rising under it
// across the 3.5 s roll (a plain glide in fifths, no tune).
function* boxRoll(sr, rng) {
  const dur = 3.6, out = samples(sr, dur);
  let t = 0.05, gap = 0.045;
  while (t < 3.3) {
    click(sr, rng, out, t, rng.range(2000, 2300), 0.25, 0.15);
    t += gap; gap *= 1.022;
  }
  yield;
  tone(sr, out, 0, 3.4, 110, 0.12, { fEnd: 330, attack: 0.6, tau: 3, vib: 0.006, vibHz: 4 });
  tone(sr, out, 0, 3.4, 165, 0.08, { fEnd: 495, attack: 0.9, tau: 3, vib: 0.006, vibHz: 4.3 });
  yield;
  click(sr, rng, out, 3.35, 900, 0.6, 1.0);
  return done(out, sr, 0.01, 0.15);
}
const boxReveal = (sr, rng) => { const o = samples(sr, 0.9); click(sr, rng, o, 0, 800, 0.7, 1.2); modal(sr, 0, [[220, 0.4, 0.4], [330, 0.35, 0.3], [440, 0.3, 0.25], [660, 0.2, 0.15]], rng, o, Math.round(0.02 * sr)); return done(o, sr); };
const boxTake = (sr, rng) => { const o = samples(sr, 0.4); friction(sr, rng, o, 0, 0.12, 900, 0.4); click(sr, rng, o, 0.13, 1500, 0.6, 0.6); return done(o, sr); };
const boxExpire = (sr, rng) => { const o = samples(sr, 1.4); tone(sr, o, 0, 1.2, 330, 0.3, { fEnd: 140, attack: 0.02, tau: 0.6 }); tone(sr, o, 0, 1.2, 334, 0.2, { fEnd: 138, attack: 0.02, tau: 0.6 }); click(sr, rng, o, 1.1, 700, 0.6, 1.0); return done(o, sr); };
function boxMove(sr, rng) {
  const o = samples(sr, 2.2);
  chirp(sr, 1.0, (t) => 240 * (1 + 0.08 * Math.sin(t * 30)), (t) => 0.08 * Math.sin(Math.PI * t), o); // hinge creak
  for (let k = 0; k < 18; k++) modal(sr, 0, [[rng.range(1800, 3200), 0.03, 0.15]], rng, o, Math.round(rng.range(0.3, 1.1) * sr)); // chain
  whoosh(sr, rng, o, 0.9, 0.8, 150, 600, 0.6);
  grain(sr, rng, o, 1.7 * sr, { freq: 160, q: 0.8, tau: 0.05, amp: 2.5, type: 'lowpass' });
  return done(o, sr, 0.01, 0.2);
}

// A machine bought: coins dropping through, the vend mechanism thumping, a bottle clinking out and opened.
function machineBuy(sr, rng) {
  const o = samples(sr, 1.6);
  for (let k = 0; k < 3; k++) modal(sr, 0, [[rng.range(3000, 4200), 0.05, 0.3]], rng, o, Math.round((0.03 + k * 0.07) * sr));
  for (let k = 0; k < 3; k++) grain(sr, rng, o, (0.35 + k * 0.12) * sr, { freq: 140, q: 0.8, tau: 0.03, amp: 1.5, type: 'lowpass' });
  modal(sr, 0, [[1250, 0.15, 0.4], [2700, 0.08, 0.25]], rng, o, Math.round(0.8 * sr));
  grain(sr, rng, o, 0.8 * sr, { freq: 300, q: 0.8, tau: 0.02, amp: 1, type: 'lowpass' });
  const fz = noise(sr, 0.4, rng); filt(fz, 'highpass', 3500, 0.7, sr);
  for (let i = 0; i < fz.length; i++) fz[i] *= envAD(i / sr, 0.002, 0.12);
  mixInto(o, fz, 1.15 * sr, 0.6);
  return done(o, sr, 0.002, 0.1);
}

// The bench: a grinder spun up, the weapon put to the wheel, spun down.
function* benchGrind(sr, rng) {
  const dur = 2.8, out = samples(sr, dur), n = out.length;
  const rpm = (t) => (t < 0.5 ? t / 0.5 : t > 2.3 ? Math.max(0, (dur - t) / 0.5) : 1);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, r = rpm(t);
    ph += (2 * Math.PI * (55 + 45 * r)) / sr;
    out[i] = (Math.sin(ph) * 0.3 + Math.sin(ph * 2) * 0.15 + Math.sin(ph * 7) * 0.04) * r;
  }
  yield;
  const sp = noise(sr, 1.6, rng);
  filt(sp, 'bandpass', 3800, 1.5, sr);
  const w = wobble(sp.length, sr, 8, rng);
  for (let i = 0; i < sp.length; i++) sp[i] *= Math.sin(Math.PI * i / sp.length) * (0.7 + 0.3 * w[i]);
  mixInto(out, sp, 0.6 * sr, 0.8);
  yield;
  return done(out, sr, 0.02, 0.2);
}

const pickup = (sr, rng) => { const o = samples(sr, 0.45); friction(sr, rng, o, 0, 0.1, 800, 0.3); click(sr, rng, o, 0.1, 1400, 0.6, 0.8); click(sr, rng, o, 0.22, 2100, 0.35); return done(o, sr); };
const armorPlate = (sr, rng) => { const o = samples(sr, 0.5); friction(sr, rng, o, 0, 0.18, 2600, 0.3, 2); grain(sr, rng, o, 0.2 * sr, { freq: 260, q: 0.8, tau: 0.03, amp: 2, type: 'lowpass' }); modal(sr, 0, [[750, 0.06, 0.3], [1400, 0.04, 0.2]], rng, o, Math.round(0.2 * sr)); return done(o, sr); };
// Revived: a heartbeat thump, a gasp of breath.
function revive(sr, rng) {
  const o = samples(sr, 1.2);
  for (const at of [0, 0.28]) chirp(sr, 0.2, (t) => 55 + 30 * exp(-t / 0.02), (t) => 0.9 * envAD(t, 0.003, 0.05), o, Math.round(at * sr));
  const g = noise(sr, 0.5, rng); sweep(g, 'bandpass', (u) => 700 + 1400 * u, 1.5, sr);
  for (let i = 0; i < g.length; i++) g[i] *= Math.sin(Math.PI * i / g.length);
  mixInto(o, g, 0.6 * sr, 0.5);
  return done(o, sr);
}

// ---------------------------------------------------------------- power-ups

const shimmer = (sr, rng) => { const o = samples(sr, 1.0); for (let k = 0; k < 10; k++) modal(sr, 0, [[rng.range(2500, 6000), 0.15, 0.2]], rng, o, Math.round(rng.range(0, 0.5) * sr)); return done(o, sr, 0.01, 0.3); };
// Each power-up its own figure: Resupply a low struck crate and a rising pair; One-Tap a single
// hard knock with a high ring; Double Time two quick taps up a fourth; Flashover a rushing ignition.
const STINGS = {
  sting_resupply: (sr, rng) => { const o = samples(sr, 1.4); grain(sr, rng, o, 0, { freq: 200, q: 0.8, tau: 0.04, amp: 2, type: 'lowpass' }); for (const [at, f] of [[0.1, 196], [0.3, 294]]) modal(sr, 0, [[f, 0.6, 0.5], [f * 2, 0.3, 0.25], [f * 3.01, 0.15, 0.12]], rng, o, Math.round(at * sr)); return done(o, sr, 0.002, 0.3); },
  sting_oneTap: (sr, rng) => { const o = samples(sr, 1.3); grain(sr, rng, o, 0, { freq: 900, q: 0.8, tau: 0.01, amp: 2 }); modal(sr, 0, [[1760, 0.5, 0.5], [2640, 0.3, 0.3], [4180, 0.15, 0.15]], rng, o, 0); chirp(sr, 0.3, (t) => 90 + 60 * exp(-t / 0.02), (t) => 0.5 * envAD(t, 0.001, 0.06), o); return done(o, sr, 0.001, 0.3); },
  sting_doubleTime: (sr, rng) => { const o = samples(sr, 1.1); for (const [at, f] of [[0, 523], [0.12, 698], [0.24, 698]]) modal(sr, 0, [[f, 0.35, 0.5], [f * 2.01, 0.15, 0.2]], rng, o, Math.round(at * sr)); return done(o, sr, 0.001, 0.3); },
  sting_flashover: (sr, rng) => { const o = samples(sr, 1.6); whoosh(sr, rng, o, 0, 1.1, 200, 3000, 1, 0.8); chirp(sr, 1.0, (t) => 60 + 50 * t, (t) => 0.4 * envAD(t, 0.15, 0.4), o); return done(o, sr, 0.01, 0.3); },
};
const powerupEnd = (sr, rng) => { const o = samples(sr, 0.9); modal(sr, 0, [[880, 0.25, 0.4], [1320, 0.2, 0.25]], rng, o, 0); modal(sr, 0, [[659, 0.35, 0.4], [988, 0.25, 0.25]], rng, o, Math.round(0.15 * sr)); return done(o, sr); };
const powerupLapse = (sr, rng) => { const o = samples(sr, 0.7); const z = noise(sr, 0.6, rng); sweep(z, 'bandpass', (u) => 3000 * exp(-u * 2.5), 2, sr); for (let i = 0; i < z.length; i++) z[i] *= envAD(i / sr, 0.01, 0.15); mixInto(o, z, 0, 0.8); return done(o, sr); };

// ---------------------------------------------------------------- stings, UI

function bell(sr, rng, out, at, f, amp, len = 3) {
  const partials = [[0.5, 2.2, 0.5], [1, 1.6, 1], [1.19, 1.2, 0.6], [1.5, 0.9, 0.45], [2, 0.7, 0.5], [2.52, 0.5, 0.3], [3.01, 0.35, 0.25], [4.16, 0.2, 0.15]];
  modal(sr, 0, partials.map(([r, tau, a]) => [f * r * rng.range(0.998, 1.002), tau * len / 3, a]), rng, out, Math.round(at * sr), amp);
}

// The boss round: a low swell of bowed metal under a cluster of struck bells a tritone apart.
function* stingBoss(sr, rng) {
  const dur = 5.2, L = samples(sr, dur), R = samples(sr, dur);
  for (const C of [L, R]) {
    const sw = noise(sr, dur, rng);
    filt(sw, 'bandpass', 110, 6, sr); filt(sw, 'bandpass', 110, 6, sr);
    for (let i = 0; i < sw.length; i++) sw[i] *= envAD(i / sr, 1.2, 1.6);
    mixInto(C, sw, 0, 6);
    yield;
    bell(sr, rng, C, 1.1, 98, 0.9, 3.5);
    bell(sr, rng, C, 1.12, 138.6, 0.6, 3.0);
    chirp(sr, dur, (t) => 49 * (1 + 0.003 * Math.sin(t * 3)), (t) => 0.35 * envAD(t - 1.0, 0.05, 1.6), C);
    yield;
  }
  for (const C of [L, R]) { dcBlock(C, sr); fadeEdges(C, sr, 0.01, 0.5); }
  return normalize([L, R], 0.9);
}

const hintBlip = (sr, rng) => { const o = samples(sr, 0.3); modal(sr, 0, [[1175, 0.08, 0.5], [2350, 0.04, 0.2]], rng, o, 0); modal(sr, 0, [[1568, 0.1, 0.5], [3136, 0.05, 0.2]], rng, o, Math.round(0.07 * sr)); return done(o, sr, 0.001, 0.05, 0.8); };
const uiTick = (sr, rng) => { const o = samples(sr, 0.08); click(sr, rng, o, 0, 2600, 0.6); return done(o, sr, 0.0005, 0.02, 0.8); };

// Purchase (less beepy than the original): a register's drawer knock and one soft struck bar.
const purchase2 = (sr, rng) => { const o = samples(sr, 0.7); click(sr, rng, o, 0, 900, 0.5, 1.0); modal(sr, 0, [[1047, 0.22, 0.35], [2093, 0.08, 0.1], [3140, 0.04, 0.05]], rng, o, Math.round(0.05 * sr)); for (let k = 0; k < 3; k++) modal(sr, 0, [[rng.range(3500, 4800), 0.04, 0.12]], rng, o, Math.round((0.08 + k * 0.03) * sr)); return done(o, sr, 0.001, 0.08, 0.85); };
// Denied: a dull wooden knock twice, no buzzer.
const denied2 = (sr, rng) => { const o = samples(sr, 0.35); for (const at of [0, 0.12]) { grain(sr, rng, o, at * sr, { freq: 320, q: 0.8, tau: 0.015, amp: 2, type: 'lowpass' }); modal(sr, 0, [[rng.range(190, 210), 0.04, 0.4], [430, 0.02, 0.2]], rng, o, Math.round(at * sr)); } return done(o, sr, 0.001, 0.04, 0.8); };

export const FOLEY_SFX = {
  ...Object.fromEntries(Object.keys(FLOORS).map((k) => [`step_${k}`, { variants: 4, gen: (sr, rng) => step(sr, rng, k) }])),
  knife_switch: { variants: 1, gen: (sr, rng) => knifeSwitch(sr, rng) },
  power_hum: { variants: 1, gen: (sr, rng) => powerHum(sr, rng) },
  door_boarded: { variants: 1, gen: (sr, rng) => doorBoarded(sr, rng) },
  door_sheet: { variants: 1, gen: (sr, rng) => doorSheet(sr, rng) },
  door_roller: { variants: 1, gen: (sr, rng) => doorRoller(sr, rng) },
  ...Object.fromEntries(['car', 'drawer', 'lid', 'locker'].map((k) => [`rummage_${k}`, { variants: 1, gen: (sr, rng) => rummage(sr, rng, k) }])),
  ...Object.fromEntries(Object.entries(OPENS).map(([k, g]) => [`open_${k}`, { variants: 1, gen: g }])),
  ...Object.fromEntries(Object.entries(REWARDS).map(([k, g]) => [k, { variants: 1, gen: g }])),
  drip: { variants: 3, gen: (sr, rng) => drip(sr, rng) },
  head_burst: { variants: 2, gen: (sr, rng) => headBurst(sr, rng) },
  box_roll: { variants: 1, gen: (sr, rng) => boxRoll(sr, rng) },
  box_reveal: { variants: 1, gen: boxReveal },
  box_take: { variants: 1, gen: boxTake },
  box_expire: { variants: 1, gen: boxExpire },
  box_move: { variants: 1, gen: (sr, rng) => boxMove(sr, rng) },
  machine_buy: { variants: 1, gen: (sr, rng) => machineBuy(sr, rng) },
  bench_grind: { variants: 1, gen: (sr, rng) => benchGrind(sr, rng) },
  pickup: { variants: 1, gen: pickup },
  armor_plate: { variants: 1, gen: armorPlate },
  revive: { variants: 1, gen: (sr, rng) => revive(sr, rng) },
  powerup_drop: { variants: 1, gen: (sr, rng) => shimmer(sr, rng) },
  ...Object.fromEntries(Object.entries(STINGS).map(([k, g]) => [k, { variants: 1, gen: g }])),
  powerup_end: { variants: 1, gen: powerupEnd },
  powerup_lapse: { variants: 1, gen: powerupLapse },
  sting_boss: { variants: 1, gen: (sr, rng) => stingBoss(sr, rng) },
  hint_blip: { variants: 1, gen: hintBlip },
  ui_tick: { variants: 1, gen: uiTick },
  purchase2: { variants: 1, gen: purchase2 },
  denied2: { variants: 1, gen: denied2 },
};

// A searchable's kind -> its rummage and opening sound.
export const SEARCH_KIND = { car: 'car', icebox: 'lid', bin: 'lid', barrel: 'lid', crate: 'lid', locker: 'locker', toolchest: 'locker' };
export const searchSound = (kind) => SEARCH_KIND[kind] || 'drawer';
