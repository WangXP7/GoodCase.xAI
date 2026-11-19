// Procedural paper sounds for folding tiles and traveller footsteps.
//
// How a sound is made
//   Every flap / footstep is SYNTHESISED PER EVENT in plain JS into a mono buffer (no oscillators):
//     - a "brush" bed: white noise, lumpy decaying envelope, broad band-pass            (card moving through air / over the page)
//     - crackle grains: dozens of 0.1-1.5 ms enveloped noise bursts at random times,
//       denser at the start, fed through three very short card-body resonances (1-6 kHz)  (fibres in the crease giving way)
//     - an onset snap (grain cluster in the first 3 ms), a smaller tick when the card meets its stop,
//       and for large flaps a faint noise-excited low body thump
//   Pitch factor (deterministic, seeded from the tile position) scales every filter frequency and
//   grain time; flap size sets duration, brightness, grain count, thump and level.
// How it is played
//   One AudioBufferSourceNode per sound into a fixed pool of voice slots (gain + stereo panner),
//   then bus -> early-reflection convolver (table + small room) -> soft-knee limiter -> master.
//   The live engine includes voice stealing, rate limiting and density ducking.
import { CONFIG } from '../core/config.js';
import { bus } from '../core/events.js';
import { mulberry32, hash2 } from '../core/rng.js';
import { distanceFor } from '../core/state.js';

const MAX_SOUND_SECONDS = 0.34;

// ------------------------------------------------------------------------------------------------
// Small DSP toolbox (pure JS, deterministic)
// ------------------------------------------------------------------------------------------------
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };

/** RBJ biquad coefficients, normalised: [b0, b1, b2, a1, a2]. type: 'lp' | 'hp' | 'bp' (0 dB peak). */
function biquad(type, f, q, sr) {
  const w0 = (2 * Math.PI * clamp(f, 20, sr * 0.45)) / sr;
  const cs = Math.cos(w0);
  const al = Math.sin(w0) / (2 * q);
  const a0 = 1 + al;
  let b0; let b1; let b2;
  if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; } else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; } else { b0 = al; b1 = 0; b2 = -al; }
  return [b0 / a0, b1 / a0, b2 / a0, (-2 * cs) / a0, (1 - al) / a0];
}

const NO_BQ = [0, 0, 0, 0, 0];

/**
 * The whole filter stage of one sound in ONE pass (8 filter sections fused: ~2.5x faster than separate passes, and
 * no intermediate float32 buffers, so no denormals):
 *   out = HP( LP( LP( tilt( gBed * BP_bed(bed) + gDirect * gr + sum_k gRes[k] * BP_res[k](gr) ) ) ) ) + gLow * BP_low(low)
 * K: { bed, gBed, res: [c, c, c], gRes: [g, g, g], gDirect, tiltHz (0 = none), lp, hp, low, gLow }; `low` buffer may be null
 */
function shape(out, n, bed, gr, low, K, sr) {
  const cb = K.bed; const b0 = cb[0] * K.gBed; const b2 = cb[2] * K.gBed; const ba1 = cb[3]; const ba2 = cb[4];
  const c1 = K.res[0] || NO_BQ; const c2 = K.res[1] || NO_BQ; const c3 = K.res[2] || NO_BQ;
  const p0 = c1[0] * (K.gRes[0] || 0); const p2 = c1[2] * (K.gRes[0] || 0); const pa1 = c1[3]; const pa2 = c1[4];
  const q0 = c2[0] * (K.gRes[1] || 0); const q2 = c2[2] * (K.gRes[1] || 0); const qa1 = c2[3]; const qa2 = c2[4];
  const r0 = c3[0] * (K.gRes[2] || 0); const r2 = c3[2] * (K.gRes[2] || 0); const ra1 = c3[3]; const ra2 = c3[4];
  const gd = K.gDirect;
  const aT = K.tiltHz > 0 ? 1 - Math.exp((-2 * Math.PI * Math.min(K.tiltHz, sr * 0.45)) / sr) : 1;
  const L = K.lp; const l0 = L[0]; const l1 = L[1]; const l2 = L[2]; const la1 = L[3]; const la2 = L[4];
  const H = K.hp; const h0 = H[0]; const h1 = H[1]; const h2 = H[2]; const ha1 = H[3]; const ha2 = H[4];
  const cw = K.low || NO_BQ; const w0 = cw[0] * (K.gLow || 0); const w2 = cw[2] * (K.gLow || 0); const wa1 = cw[3]; const wa2 = cw[4];
  const hasLow = !!low;
  // states (transposed direct form II); the band-passes have b1 = 0
  let bz1 = 0; let bz2 = 0; let pz1 = 0; let pz2 = 0; let qz1 = 0; let qz2 = 0; let rz1 = 0; let rz2 = 0;
  let t = 0; let az1 = 0; let az2 = 0; let cz1 = 0; let cz2 = 0; let hz1 = 0; let hz2 = 0; let wz1 = 0; let wz2 = 0;
  for (let i = 0; i < n; i++) {
    const xb = bed[i]; const xg = gr[i];
    const yb = b0 * xb + bz1; bz1 = -ba1 * yb + bz2; bz2 = b2 * xb - ba2 * yb;
    const yp = p0 * xg + pz1; pz1 = -pa1 * yp + pz2; pz2 = p2 * xg - pa2 * yp;
    const yq = q0 * xg + qz1; qz1 = -qa1 * yq + qz2; qz2 = q2 * xg - qa2 * yq;
    const yr = r0 * xg + rz1; rz1 = -ra1 * yr + rz2; rz2 = r2 * xg - ra2 * yr;
    t += aT * (yb + yp + yq + yr + gd * xg - t);
    const ya = l0 * t + az1; az1 = l1 * t - la1 * ya + az2; az2 = l2 * t - la2 * ya;
    const yc = l0 * ya + cz1; cz1 = l1 * ya - la1 * yc + cz2; cz2 = l2 * ya - la2 * yc;
    let y = h0 * yc + hz1; hz1 = h1 * yc - ha1 * y + hz2; hz2 = h2 * yc - ha2 * y;
    if (hasLow) { const xw = low[i]; const yw = w0 * xw + wz1; wz1 = -wa1 * yw + wz2; wz2 = w2 * xw - wa2 * yw; y += yw; }
    out[i] = y;
  }
  out[n] = 0; out[n + 1] = 0;
}

/** Fast per-sample white noise (xorshift32), seeded from the parameter rng. */
function makeNoise(rng) {
  let s = ((rng() * 4294967296) >>> 0) | 1;
  return function noise() {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return (s | 0) / 2147483648;
  };
}

/** One crackle grain: enveloped noise burst (3-sample attack, exponential decay tau seconds). */
let grainSeed = 0x9e3779b9; // xorshift32 state of the grain noise (re-seeded per sound by seedGrains)
function seedGrains(rng) { grainSeed = ((rng() * 4294967296) >>> 0) | 1; }
function addGrain(buf, n, sr, noise, t, amp, tau) {
  const i0 = Math.floor(t * sr);
  if (i0 < 0 || i0 + 4 >= n) return;
  const d = Math.exp(-1 / Math.max(1, tau * sr));
  const end = Math.min(n, i0 + Math.ceil(tau * sr * 5.5) + 4);
  let e = amp;
  let s = grainSeed;
  // 3-sample fade-in, then the plain decay (noise generator inlined: this is the second-hottest loop)
  for (let j = 0; j < 3; j++) {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    buf[i0 + j] += ((s | 0) / 2147483648) * e * (j === 0 ? 0.15 : j === 1 ? 0.5 : 0.85);
    e *= d;
  }
  for (let i = i0 + 3; i < end; i++) {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    buf[i] += ((s | 0) / 2147483648) * e;
    e *= d;
  }
  grainSeed = s;
}

// scratch buffers shared by all synth calls (synthesis is synchronous, so this is safe)
let scrLen = 0; let scrA = null; let scrB = null; let scrC = null;
function scratch(n) {
  if (n > scrLen) { scrLen = n; scrA = new Float32Array(n); scrB = new Float32Array(n); scrC = new Float32Array(n); }
  scrA.fill(0, 0, n); scrB.fill(0, 0, n); scrC.fill(0, 0, n);
}

/** Smooth (smoothstep) fade-in / fade-out, peak-early enforcement and normalisation. Returns n. */
function finish(out, n, sr, T, attack, peakWithin, tailFrom, refCrest, kneeRel = 0.45, loud = 0.5, gLo = 0.86, gHi = 1.2) {
  const na = Math.max(2, Math.round(attack * sr));
  for (let i = 0; i < na && i < n; i++) { const u = i / na; out[i] *= u * u * (3 - 2 * u); }
  // tail: everything after tailFrom * T fades to exactly 0 (no cut-off click)
  const f0 = Math.max(0, Math.floor(T * tailFrom * sr));
  const nf = n - f0;
  for (let i = f0; i < n; i++) { const u = 1 - (i - f0) / nf; out[i] *= u * u * (3 - 2 * u); }
  out[n - 1] = 0;
  // the loudest sample must sit in the onset (attack <= 8 ms): softly hold later samples below the early peak
  const np = Math.min(n, Math.round(peakWithin * sr));
  let early = 0;
  for (let i = 0; i < np; i++) { const a = Math.abs(out[i]); if (a > early) early = a; }
  early = Math.max(early, 1e-6);
  const knee = early * kneeRel; const room = early * Math.min(0.17, 0.97 - kneeRel);
  let sq = 0;
  for (let i = 0; i < n; i++) {
    let v = out[i];
    if (i >= np) {
      const a = Math.abs(v);
      if (a > knee) { v = (v < 0 ? -1 : 1) * (knee + room * Math.tanh((a - knee) / room)); out[i] = v; }
    }
    sq += v * v;
  }
  // normalise between peak (loud = 0) and loudness (loud = 1): peak = 1 at the reference crest factor, clamped around it
  const rms = Math.sqrt(sq / Math.max(1, Math.round(T * sr)));
  const crest = early / Math.max(rms, 1e-9);
  const g = (1 / early) * clamp(Math.pow(crest / refCrest, loud), gLo, gHi);
  for (let i = 0; i < n; i++) out[i] *= g;
  return n;
}

/**
 * Synthesise one flap into out[0..n). P: { up, size 0..1, pitch, dur (s to -40 dB), tick 0..1 }.
 * Returns the number of samples written.
 */
function synthFlap(out, sr, P, rng) {
  const F = CONFIG.audio.flap;
  const up = P.up;
  const s = P.size;
  const T = P.dur;
  const n = Math.min(out.length - 2, Math.ceil((T + 0.012) * sr));
  scratch(n);
  const bed = scrA; const gr = scrB; const th = scrC;
  // card identity first: body modes depend on the card, not on the fold direction
  const resF = []; const resG = [];
  for (let k = 0; k < F.resHz.length; k++) { resF.push(1 + (rng() * 2 - 1) * F.resJitter); resG.push(1 + (rng() * 2 - 1) * F.resGainJitter); }
  const noise = makeNoise(rng);
  seedGrains(rng);
  const big01 = smooth((s - F.brightFrom) / (F.brightTo - F.brightFrom)); // 0 = small bright card, 1 = large dull card
  const bright = F.brightSmall * Math.pow(F.brightLarge / F.brightSmall, big01) * (up ? 1 : F.downBright);
  const air = clamp(P.air ?? 0, 0, 1); // 0 = at the listener, 1 = at the edge of earshot: far flaps are softer on top
  const tiltHz = (up ? F.tiltSmall * Math.pow(F.tiltLarge / F.tiltSmall, big01) : F.tiltSmallDown * Math.pow(F.tiltLargeDown / F.tiltSmallDown, big01)) * Math.pow(P.pitch, F.tiltTrack) * (1 - F.airTilt * air);
  const fs = P.pitch * bright; // master frequency scale
  const ts = 1 / Math.sqrt(fs); // grain time scale (lower pitch = slightly longer grains)
  const tick = (P.tick ?? 1) * F.tick;

  // ---- brush bed: crackly fizz = noise * decay * random lumps * heavy-tailed micro gate ------------
  // (plain enveloped noise is a snare; paper is impulsive, so the bed itself is gated by a fast random process)
  const tauE = T / F.decayNepers; // slow part of the decay (grains and bed share the envelope)
  const tauF = T / F.decayFast; // fast part: the release burst
  const mixF = F.decayFastMix;
  const kBed = Math.exp(-1 / (tauE * (up ? 1 : F.bedDecayDown) * sr));
  const kFast = Math.exp(-1 / (tauF * sr));
  const segs = Math.max(4, Math.round((T / F.lumpEvery) * (0.8 + rng() * 0.4)));
  const segLen = Math.ceil(n / segs);
  const gateEvery = Math.max(2, Math.round((F.gateEvery * sr) / fs));
  const gSmooth = 1 - Math.exp(-2.2 / gateEvery);
  let env = 1 - mixF; let envF = mixF; let gate = 1; let gTarget = 1;
  let ns = ((rng() * 4294967296) >>> 0) | 1; // xorshift32 state, inlined in the hot loop
  let gateLeft = 0;
  let v0 = up ? 0.7 + rng() * 0.3 : 0.5 + rng() * 0.3;
  // fold-down starts as a soft rustle that swells (the card is let go and falls), fold-up starts at once
  const kSw = up ? 0 : Math.exp(-1 / (F.downSwell * sr)); let sw = up ? 0 : 1 - F.downSwellFrom;
  for (let sgi = 0, i = 0; sgi < segs; sgi++) {
    const v1 = F.lumpMin + rng() * (1 - F.lumpMin);
    const end = Math.min(n, i + segLen);
    const inv = 1 / segLen;
    for (let j = 0; i < end; i++, j++) {
      if (--gateLeft <= 0) {
        gateLeft = gateEvery;
        ns ^= ns << 13; ns ^= ns >>> 17; ns ^= ns << 5;
        const r = (ns | 0) / 2147483648; const r2 = r * r; gTarget = F.bedSmooth + (1 - F.bedSmooth) * 5 * r2 * r2;
      }
      gate += gSmooth * (gTarget - gate);
      const u = j * inv;
      ns ^= ns << 13; ns ^= ns >>> 17; ns ^= ns << 5;
      bed[i] = ((ns | 0) / 2147483648) * (env + envF) * (v0 + (v1 - v0) * u * u * (3 - 2 * u)) * gate * (1 - sw);
      env *= kBed; envF *= kFast; sw *= kSw;
    }
    v0 = v1;
  }

  // ---- crackle grains ----------------------------------------------------------------------------
  const E = (t) => (1 - mixF) * Math.exp(-t / tauE) + mixF * Math.exp(-t / tauF);
  // onset snap: the card lets go of the page
  // (a handful of grains over ~4 ms, not one spike: a soft "fp", not a click)
  const nOn = up ? F.onsetGrains : F.onsetGrains - 1;
  for (let k = 0; k < nOn; k++) {
    const t = (up ? 0.0008 : 0.0014) + rng() * (up ? 0.0034 : 0.0036);
    addGrain(gr, n, sr, noise, t, tick * (k === 0 ? 1 : 0.5 + rng() * 0.45) * (up ? 1 : F.downTick), (up ? 0.0005 + rng() * 0.0008 : 0.001 + rng() * 0.001) * ts);
  }
  // crackle: fibres give way in little clusters, thinning out as the card slows down
  const dens = up ? 1 : F.downGrains;
  const nMac = Math.round(lerp(F.grainsMin, F.grainsMax, s) * dens);
  const kd = F.grainThin;
  const span = 1 - Math.exp(-kd);
  const thin = () => (-Math.log(1 - rng() * span) / kd) * T * 0.84;
  const tStop = T * (up ? 0.38 + rng() * 0.24 : F.downStop + rng() * 0.16);
  let left = nMac;
  while (left > 0) {
    // most crackle happens as the card lets go; a second, smaller flurry as it reaches its stop
    const tc = rng() < F.stopShare ? Math.max(0.003, tStop + (rng() + rng() - 1) * T * 0.11) : 0.003 + thin();
    const inCl = Math.min(left, 1 + Math.floor(rng() * rng() * 7)); // mostly 1-3, sometimes a run of 6-7
    const width = 0.0012 + rng() * 0.006;
    const r = rng();
    const ac = F.grainAmp * (0.14 + r * r * r) * E(tc);
    let tg = tc;
    for (let k = 0; k < inCl; k++) {
      addGrain(gr, n, sr, noise, tg, ac * (0.45 + 0.55 * rng()), (0.00015 + rng() * 0.0008) * ts);
      tg += (-Math.log(1 - rng() * 0.95) * width) / 2.2;
    }
    left -= inCl;
  }
  // micro crackles: a fine fizz of tiny grains
  const nMic = Math.round(lerp(F.microMin, F.microMax, s) * dens);
  for (let k = 0; k < nMic; k++) {
    const t = 0.001 + thin() * 1.1;
    addGrain(gr, n, sr, noise, t, F.microAmp * (0.2 + rng()) * E(t), (0.0001 + rng() * 0.0003) * ts);
  }
  // the card meets its stop (up: a crisp little cluster) / lands flat on the page (down: a duller pat, via the bed band)
  const nSt = up ? 3 + Math.floor(rng() * 3) : 2 + Math.floor(rng() * 2);
  for (let k = 0; k < nSt; k++) {
    const t = tStop + (k === 0 ? 0 : rng() * (up ? 0.006 : 0.004));
    const a = tick * F.stopTick * (k === 0 ? 1 : 0.25 + rng() * 0.5);
    if (up) addGrain(gr, n, sr, noise, t, a, (0.00025 + rng() * 0.0005) * ts);
    else addGrain(bed, n, sr, noise, t, a * F.patGain, (0.0012 + rng() * 0.0014) * ts);
  }
  // quiver after the stop
  const nQ = 2 + Math.floor(rng() * 4);
  for (let k = 0; k < nQ; k++) { const t = tStop + 0.007 + rng() * Math.max(0.001, T * 0.88 - tStop); addGrain(gr, n, sr, noise, t, F.grainAmp * (0.25 + rng() * 0.5) * E(t), (0.0002 + rng() * 0.0004) * ts); }

  // ---- low body thump (large flaps only) ----------------------------------------------------------
  const big = clamp((s - 0.3) / 0.7, 0, 1);
  const thAmp = F.thump * Math.pow(big, 1.4);
  if (thAmp > 0.002) {
    const tau = 0.0035;
    addGrain(th, n, sr, noise, up ? 0.0012 : tStop, thAmp * (up ? 1 : F.thumpDown), tau);
    if (up) addGrain(th, n, sr, noise, tStop + 0.001, thAmp * 0.55, tau);
  }

  // ---- filters (one fused pass) --------------------------------------------------------------------
  // bed band + card-body modes + direct grains -> tilt that follows the pitch -> fixed band limit -> low cut (+ thump)
  shape(out, n, bed, gr, thAmp > 0.002 ? th : null, {
    bed: biquad('bp', F.bedHz * fs, F.bedQ, sr), gBed: up ? F.bedGain : F.bedGainDown,
    res: [biquad('bp', F.resHz[0] * fs * resF[0], F.resQ[0], sr), biquad('bp', F.resHz[1] * fs * resF[1], F.resQ[1], sr), biquad('bp', F.resHz[2] * fs * resF[2], F.resQ[2], sr)],
    gRes: [F.resGain[0] * resG[0], F.resGain[1] * resG[1], F.resGain[2] * resG[2]],
    gDirect: F.grainDirect,
    tiltHz,
    lp: biquad('lp', F.lpHz * (1 - F.airLp * air), 0.6, sr),
    hp: biquad('hp', F.hpHz * Math.sqrt(fs) * (up ? 1 : F.downHp), 0.7, sr),
    low: biquad('bp', (F.thumpHz * P.pitch) / (0.8 + 0.4 * s), F.thumpQ, sr), gLow: F.thumpGain,
  }, sr);
  // ---- air "whoosh" (the card moving: a 0.6-2 kHz noise swell) + low body thump of large flaps, added un-tilted ----
  {
    const fA = 2 * Math.sin((Math.PI * F.airHz * Math.pow(P.pitch, 0.5) * (up ? 1 : F.downBright)) / sr); const qA = 1 / F.airQ;
    const fT = 2 * Math.sin((Math.PI * F.lowHz * Math.pow(P.pitch, 0.5)) / (sr * (0.8 + 0.4 * s))); const qT = 1 / F.lowQ;
    const tr = (up ? F.airRise : F.airRiseDown) * (0.8 + 0.4 * rng()) * (0.7 + 0.6 * s); // the swell peaks here ...
    const kA = Math.exp(-1 / (tr * sr)); // ... envelope = (t / tr) * exp(1 - t / tr), from two cascaded one-poles
    const gA = (up ? F.airGain : F.airGainDown) * lerp(F.airSmall, 1, big01) * Math.E * (1 - kA);
    const lowAmp = F.lowGain * Math.pow(clamp((s - F.lowFrom) / (1 - F.lowFrom), 0, 1), 0.8) * (up ? 1 : F.lowDown);
    const iT = Math.floor((up ? 0.0015 : tStop) * sr); const kT = Math.exp(-1 / (F.lowTau * sr));
    const aL = 1 - Math.exp((-2 * Math.PI * F.airLpHz * Math.pow(P.pitch, 0.5)) / sr); // keeps the swell out of the top octave
    let e1 = 1; let e2 = 0; let eT = 0; let al = 0; let ab = 0; let aw = 0; let tl = 0; let tb = 0;
    for (let i = 0; i < n; i++) {
      ns ^= ns << 13; ns ^= ns >>> 17; ns ^= ns << 5;
      const x = (ns | 0) / 2147483648;
      e2 = e2 * kA + e1; e1 *= kA; // e2 ~ (i + 1) * kA^i
      al += fA * ab; ab += fA * (x - al - qA * ab);
      aw += aL * (ab - aw);
      let y = aw * e2 * gA;
      if (lowAmp > 0) {
        if (i === iT) eT = lowAmp;
        tl += fT * tb; tb += fT * (x * eT - tl - qT * tb); eT *= kT;
        y += tb;
      }
      out[i] += y;
    }
  }
  return finish(out, n, sr, T, up ? F.attackUp : F.attackDown, 0.0055, F.tailFrom, F.refCrest, F.peakKnee, F.loudNorm, F.normLo, F.normHi);
}

/** Synthesise one footstep. P: { surface, pitch, dur }. */
function synthStep(out, sr, P, rng) {
  const S = CONFIG.audio.step;
  const V = S.surfaces[P.surface] || S.surfaces.grass;
  const T = P.dur;
  const n = Math.min(out.length - 2, Math.ceil((T + 0.008) * sr));
  scratch(n);
  const bed = scrA; const gr = scrB; const kn = scrC;
  const noise = makeNoise(rng);
  seedGrains(rng);
  const fs = P.pitch;
  const kBed = Math.exp(-1 / ((T / 4.6) * sr));
  let env = 1;
  for (let i = 0; i < n; i++) { bed[i] = noise() * env; env *= kBed; }
  // the tap itself
  addGrain(gr, n, sr, noise, 0.0006 + rng() * 0.0008, 1, (0.0005 + rng() * 0.0006) / fs);
  addGrain(gr, n, sr, noise, 0.0018 + rng() * 0.0016, 0.5 + rng() * 0.3, (0.0004 + rng() * 0.0006) / fs);
  // scuff grains (grass has more of them)
  for (let k = 0; k < V.grains; k++) {
    const t = 0.003 + rng() * T * 0.6;
    addGrain(gr, n, sr, noise, t, (0.12 + 0.3 * rng()) * Math.exp((-t / T) * 3), (0.0002 + rng() * 0.0006) / fs);
  }
  if (V.knock > 0) addGrain(kn, n, sr, noise, 0.0008, V.knock, 0.003); // hollow card deck of the bridge
  shape(out, n, bed, gr, V.knock > 0 ? kn : null, {
    bed: biquad('bp', V.bedHz * fs, V.bedQ, sr), gBed: V.bedGain,
    res: V.resHz.map((f, k) => biquad('bp', f * fs * (0.92 + rng() * 0.16), V.resQ[k], sr)),
    gRes: V.resHz.map(() => V.grain),
    gDirect: 0.25 * V.grain,
    tiltHz: 0,
    lp: biquad('lp', V.lpHz * fs, 0.62, sr),
    hp: biquad('hp', 300, 0.7, sr),
    low: biquad('bp', 560 * fs, 2.6, sr), gLow: 5,
  }, sr);
  return finish(out, n, sr, T, 0.0016, 0.0045, 0.7, S.refCrest);
}

// ------------------------------------------------------------------------------------------------
// Static buffers: early-reflection impulse response, limiter curve, room tone
// ------------------------------------------------------------------------------------------------
function makeRoomIR(ctx) {
  const R = CONFIG.audio.room;
  const sr = ctx.sampleRate;
  const n = Math.ceil(R.length * sr);
  const ir = ctx.createBuffer(2, n, sr);
  const rng = mulberry32(0x7ab1e);
  const lpA = 1 - Math.exp((-2 * Math.PI * R.tailLpHz) / sr);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    // diffuse tail (decorrelated per channel), low-passed so the room is warm
    let y = 0;
    const i0 = Math.floor(0.003 * sr);
    for (let i = i0; i < n; i++) {
      const t = (i - i0) / sr;
      y += lpA * ((rng() * 2 - 1) - y);
      d[i] = y * R.tail * Math.exp(-t / R.tailDecay) * Math.min(1, (i - i0) / (0.002 * sr));
    }
    // discrete early reflections: 3-sample smeared taps (a reflection off wood / paper is not a perfect click)
    for (const [delay, gain, pan] of R.taps) {
      const g = gain * (c === 0 ? Math.min(1, 1 - pan) : Math.min(1, 1 + pan));
      const i = Math.round(delay * sr);
      if (i > 1 && i + 1 < n) { d[i - 1] += g * 0.25; d[i] += g * 0.5; d[i + 1] += g * 0.25; }
    }
    const fo = Math.floor(0.004 * sr);
    for (let i = 0; i < fo; i++) d[n - 1 - i] *= i / fo;
    d[0] = 1; // direct sound
  }
  return ir;
}

function makeLimiterCurve() {
  const L = CONFIG.audio.limiter;
  const N = 4097;
  const curve = new Float32Array(N);
  const k = L.knee;
  for (let i = 0; i < N; i++) {
    const x = ((i / (N - 1)) * 2 - 1) * L.range;
    const a = Math.abs(x);
    const y = a <= k ? a : k + (1 - k) * Math.tanh((a - k) / (1 - k));
    curve[i] = x < 0 ? -y : y;
  }
  return curve;
}

function makeAmbience(ctx) {
  const M = CONFIG.audio.ambience;
  const sr = ctx.sampleRate;
  const n = Math.floor(M.length * sr);
  const xf = Math.floor(0.3 * sr);
  const buf = ctx.createBuffer(2, n, sr);
  const rng = mulberry32(0xa3b1e);
  const a1 = 1 - Math.exp((-2 * Math.PI * M.lpHz) / sr);
  const a2 = 1 - Math.exp((-2 * Math.PI * 30) / sr);
  for (let c = 0; c < 2; c++) {
    const tmp = new Float32Array(n + xf);
    let y1 = 0; let y2 = 0; let y3 = 0; let sq = 0;
    for (let i = 0; i < n + xf; i++) {
      const w = rng() * 2 - 1;
      y1 += a1 * (w - y1); y2 += a1 * (y1 - y2); // warm 2-pole low-pass
      y3 += a2 * (y2 - y3); // remove rumble / DC
      const v = y2 - y3 + w * 0.004; // + a breath of air
      tmp[i] = v; sq += v * v;
    }
    const norm = 1 / Math.sqrt(sq / (n + xf));
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) {
      let v = tmp[i];
      if (i < xf) { const u = i / xf; v = v * Math.sqrt(u) + tmp[n + i] * Math.sqrt(1 - u); } // seamless loop
      d[i] = v * norm;
    }
  }
  return buf;
}

// ------------------------------------------------------------------------------------------------
// Voice parameters (deterministic)
// ------------------------------------------------------------------------------------------------
function strHash(s) {
  if (typeof s === 'number') return s | 0;
  let h = 2166136261;
  const str = String(s ?? '');
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h | 0;
}

/** Seed for a fold event: depends only on where the flap is and which flap it is (fold-down = the same card, voiced duller). */
function foldSeed(e) {
  const A = CONFIG.audio;
  const salt = A.seed ^ strHash(e.tileId) ^ Math.imul((e.layer ?? 0) + 1, 0x9e37) ^ Math.imul(Math.round((e.size ?? 0) * 1000), 0x45d9f3);
  return hash2(Math.round((e.x ?? 0) * 8), Math.round((e.z ?? 0) * 8), salt | 0);
}

/**
 * Pitch / duration / level of one flap. u = 0..1 pitch position (undefined -> from the seed),
 * lastSt = semitones of the previous flap (consecutive flaps are kept >= pitchMinStepSt apart).
 */
function flapParams(up, sizeIn, seed, u, lastSt) {
  const F = CONFIG.audio.flap;
  const size = clamp(sizeIn ?? 0.4, 0, 1);
  const r = mulberry32(seed);
  const u0 = r();
  const lo = 12 * Math.log2(F.pitchMin); const hi = 12 * Math.log2(F.pitchMax);
  let st = F.pitchSizeSt * (1 - 2 * size) + ((u ?? u0) * 2 - 1) * F.pitchRandSt;
  if (lastSt !== undefined && lastSt !== null && Math.abs(st - lastSt) < F.pitchMinStepSt) {
    const dir = st >= lastSt ? 1 : -1;
    let cand = lastSt + dir * F.pitchMinStepSt * 1.5;
    if (cand > hi || cand < lo) cand = lastSt - dir * F.pitchMinStepSt * 1.5;
    st = cand;
  }
  st = clamp(st, lo, hi);
  const pitch = Math.pow(2, st / 12);
  const dur = lerp(F.durMin, F.durMax, Math.pow(size, F.durCurve)) * Math.pow(pitch, -F.durPitch) * (1 + (r() * 2 - 1) * F.durJitter);
  const level = F.gain * lerp(F.sizeGainMin, 1, size) * (up ? 1 : Math.pow(10, F.downGainDb / 20));
  return { up, size, pitch, semitones: st, dur, level, synthSeed: (r() * 4294967296) >>> 0 };
}

function stepParams(surface, seed, foot) {
  const S = CONFIG.audio.step;
  const V = S.surfaces[surface] ? surface : 'grass';
  const r = mulberry32(seed);
  const st = (r() * 2 - 1) * S.pitchRandSt + (foot ? S.footSt : -S.footSt);
  const pitch = Math.pow(2, st / 12);
  return { surface: V, pitch, semitones: st, dur: S.dur * (0.92 + r() * 0.16) * Math.pow(pitch, -0.3), level: S.gain * S.surfaces[V].gain * (0.85 + r() * 0.3), synthSeed: (r() * 4294967296) >>> 0 };
}

/** Flaps of one tile folding in one direction belong to one gesture. */
const groupKey = (e) => Math.round((e.x ?? 0) * 4) + ',' + Math.round((e.z ?? 0) * 4) + (e.dir === 'down' ? 'd' : 'u');

const STEP_CYCLE = ['grass', 'path', 'bridge'];
function parseKind(kind, seed) {
  if (kind === 'flap-up') return { flap: true, up: true };
  if (kind === 'flap-down') return { flap: true, up: false };
  const m = /^step-(\w+)$/.exec(kind || '');
  return { flap: false, surface: m ? m[1] : STEP_CYCLE[Math.abs(seed | 0) % 3] };
}

function distanceGain(d) {
  const A = CONFIG.audio;
  if (!(d >= 0)) return 1;
  if (d >= A.earshot) return 0;
  return (1 / (1 + (d / A.falloff) ** A.falloffPow)) * (1 - smooth((d - A.earshotFade) / (A.earshot - A.earshotFade)));
}

// ------------------------------------------------------------------------------------------------
// Real-time audio engine
// ------------------------------------------------------------------------------------------------
function buildEngine(ctx) {
  const A = CONFIG.audio;
  const sr = ctx.sampleRate;
  const maxLen = Math.ceil(MAX_SOUND_SECONDS * sr);
  const stats = { played: 0, dropped: 0, grouped: 0, stolen: 0, skipped: 0, maxConcurrent: 0, nodes: 0, synthMs: 0, flaps: 0, steps: 0 };
  const count = (node) => { stats.nodes++; return node; };

  // ---- master chain ----
  const master = count(ctx.createGain());
  master.gain.value = A.masterGain * A.limiter.ceiling;
  master.connect(ctx.destination);
  const shaper = count(ctx.createWaveShaper());
  shaper.curve = makeLimiterCurve();
  shaper.connect(master);
  const pre = count(ctx.createGain());
  pre.gain.value = 1 / A.limiter.range;
  pre.connect(shaper);
  const conv = count(ctx.createConvolver());
  conv.normalize = false;
  conv.buffer = makeRoomIR(ctx);
  if (A.comp.enabled) {
    const comp = count(ctx.createDynamicsCompressor());
    comp.threshold.value = A.comp.threshold;
    comp.knee.value = A.comp.knee;
    comp.ratio.value = A.comp.ratio;
    comp.attack.value = A.comp.attack;
    comp.release.value = A.comp.release;
    const post = count(ctx.createGain());
    post.gain.value = A.comp.makeupComp; // undoes the compressor's built-in make-up gain
    conv.connect(comp).connect(post).connect(pre);
  } else conv.connect(pre);
  const busNode = count(ctx.createGain());
  busNode.channelCount = 2;
  busNode.channelCountMode = 'explicit';
  busNode.connect(conv);

  if (A.ambience.gain > 0) {
    const amb = count(ctx.createBufferSource());
    amb.buffer = makeAmbience(ctx);
    amb.loop = true;
    const g = count(ctx.createGain());
    const t0 = ctx.currentTime;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(A.ambience.gain, t0 + A.ambience.fadeIn);
    amb.connect(g).connect(pre);
    amb.start(t0);
  }

  // ---- voice slots ----
  const slots = [];
  for (let i = 0; i < A.maxVoices + A.spareVoices; i++) {
    const gain = count(ctx.createGain());
    gain.gain.value = 0;
    const pan = count(ctx.createStereoPanner());
    gain.connect(pan).connect(busNode);
    slots.push({ gain, pan, src: null, buffer: ctx.createBuffer(1, maxLen + 2, sr), start: -1, end: -1, freeAt: -1, level: 0, dur: 0.1, released: true });
  }

  const groups = new Map();
  let tokens = A.rate.burst;
  let tokenT = -1;
  let lastSt = null;

  /** Estimated current level of a sounding voice (its envelope is ~exponential, -40 dB at dur). */
  const levelAt = (s, t) => s.level * Math.exp((-4.6 * Math.max(0, t - s.start)) / s.dur);

  /**
   * Play one sound now. p: { size, pan, gain, seed, u, foot }. Returns the voice description, or null
   * when it was skipped (inaudible), rate-limited or voice-capped.
   */
  function play(kind, p, when, extGain = 1) {
    const K = parseKind(kind, p.seed);
    const ext = (p.gain ?? 1) * extGain;
    if (ext * (K.flap ? A.flap.gain : A.step.gain) < A.minGain) { stats.skipped++; return null; }

    // sounding voices right now
    let active = 0; let quiet = null; let quietLevel = Infinity; let free = null;
    for (const s of slots) {
      if (s.freeAt <= when) { if (!free) free = s; continue; }
      if (s.released || s.end <= when) continue;
      active++;
      const l = levelAt(s, when);
      if (l < quietLevel) { quietLevel = l; quiet = s; }
    }
    const density = clamp(active / A.maxVoices, 0, 1);

    // "detail" flaps (tiny cut-outs) give way first when the page is busy: quieter, and they cost more of the rate budget
    const big = K.flap ? smooth((clamp(p.size ?? 0.4, 0, 1) - A.detailBelow) / A.detailRange) : 1;
    const cost = K.flap ? 1 + (1 - big) * A.detailCost * density : 0; // footsteps are never rate-limited (a few per second)

    // rate limit
    if (tokenT >= 0) tokens = Math.min(A.rate.burst, tokens + (when - tokenT) * A.rate.perSecond);
    tokenT = when;
    // details may not eat the last tokens: those are kept for the next real flap
    if (tokens < cost + (big < 0.5 ? A.rate.reserve : 0)) { stats.dropped++; return null; }

    const t0 = typeof performance === 'undefined' ? 0 : performance.now();
    const V = K.flap ? flapParams(K.up, p.size, p.seed, p.u, lastSt) : stepParams(K.surface, p.seed, p.foot);
    // overlapping flaps are turned down (~1 / sqrt(voices)) so that they do not sum into a noise bed
    const level = (V.level * ext * (1 - A.densityDuck * density * (1 + A.detailDuck * (1 - big)))) / Math.sqrt(1 + A.overlapDuck * active);
    if (level < A.minGain) { stats.skipped++; return null; }

    if (active >= A.maxVoices) {
      // voice cap: fade out the quietest sounding voice if the new one is louder, else drop the new one
      if (!quiet || quietLevel > level || !free) { stats.dropped++; return null; }
      const g = quiet.gain.gain;
      g.setValueAtTime(quiet.level, when);
      g.linearRampToValueAtTime(0, when + A.stealFade);
      try { quiet.src.stop(when + A.stealFade + 0.001); } catch { /* already stopped */ }
      quiet.released = true;
      quiet.freeAt = when + A.stealFade + 0.004;
      stats.stolen++;
      active--;
    }
    if (!free) { stats.dropped++; return null; }
    tokens -= cost;
    if (K.flap) lastSt = V.semitones;

    // synthesise
    const rng = mulberry32(V.synthSeed);
    const tick = 1 - A.densityTickDuck * density;
    const air = (p.dist ?? 0) / A.earshot;
    const buffer = free.buffer;
    const data = buffer.getChannelData(0);
    const n = K.flap ? synthFlap(data, sr, { ...V, tick, air }, rng) : synthStep(data, sr, V, rng);

    // events arrive on the 60 Hz frame grid: spread flap onsets over one frame (no 60 Hz rattle), and a little more
    // when the page is busy, so a wave of flaps is an irregular ripple
    const start = when + (K.flap ? (A.onsetJitter + A.rippleJitter * density) * ((V.synthSeed & 1023) / 1023) : 0);
    const dur = n / sr;
    const src = count(ctx.createBufferSource());
    src.buffer = buffer;
    src.connect(free.gain);
    free.gain.gain.setValueAtTime(level, start);
    free.pan.pan.setValueAtTime(clamp((p.pan ?? 0) * A.panWidth, -1, 1), start);
    src.start(start, 0, dur);
    free.src = src; free.start = start; free.end = start + dur; free.freeAt = start + dur + 0.03;
    free.level = level; free.dur = V.dur; free.released = false;

    stats.played++;
    if (K.flap) stats.flaps++; else stats.steps++;
    if (active + 1 > stats.maxConcurrent) stats.maxConcurrent = active + 1;
    if (t0) stats.synthMs += performance.now() - t0;
    return { ...V, kind, start, level, pan: p.pan ?? 0 };
  }

  // ---- tile gestures: one flap per rising / folding tile, with air between the flaps ---------------------------
  // A tile fires 6-8 fold events (one per layer) within 0.3 s, and ~16 tiles move per second while walking. Played
  // one by one that is a continuous rustle, so: the layers of one tile are ONE gesture (its first layer speaks; one
  // clearly larger layer may add an accent), and flap onsets keep a minimum spacing. Flaps that arrive inside the
  // spacing wait in a short queue: the loudest (nearest / largest) candidate takes the next slot, a little quieter
  // the longer it waited, the rest are dropped. A wave of tiles becomes a ripple of separate flaps.
  const G = A.tile;
  const queue = [];
  let nextOnset = -1;
  const startOne = (c, tStart) => {
    c.g.pend = null;
    const wait = Math.max(0, tStart - c.t);
    const v = play(c.kind, c.p, tStart, Math.pow(10, (-G.deferDb * Math.min(1, wait / G.maxDefer)) / 20) * (c.accent ? G.accentGain : 1));
    if (!v) return null;
    c.g.voiced++; c.g.size = clamp(c.p.size ?? 0.4, 0, 1);
    nextOnset = v.start + G.spacing + G.spacingJitter * ((((v.synthSeed >>> 10) & 1023) / 1023) * 2 - 1);
    return v;
  };
  /** Start queued flaps whose slot is within the next `lookahead` seconds. */
  function drain(when) {
    while (queue.length && nextOnset <= when + G.lookahead) {
      let bi = 0;
      for (let i = 1; i < queue.length; i++) if (queue[i].score > queue[bi].score) bi = i;
      const c = queue[bi];
      queue.splice(bi, 1);
      const tStart = Math.max(nextOnset, c.t, when);
      if (tStart - c.t > G.maxDefer) { c.g.pend = null; stats.dropped++; continue; }
      startOne(c, tStart);
    }
  }
  /**
   * A sound wants to play at `when`: footsteps and flaps without a tile (`p.group`) are played, tile flaps go through
   * the gesture logic above. Returns the voice if it started right away, else null (queued, grouped or dropped).
   */
  function trigger(kind, p, when) {
    drain(when);
    if (p.group === undefined || !parseKind(kind, p.seed).flap) return play(kind, p, when);
    const size = clamp(p.size ?? 0.4, 0, 1);
    let g = groups.get(p.group);
    if (!g || when - g.t > A.groupWindow) {
      if (groups.size > 96) { for (const [k, v] of groups) if (when - v.t > A.groupWindow && !v.pend) groups.delete(k); }
      g = { t: when, voiced: 0, size: 0, pend: null };
      groups.set(p.group, g);
    }
    const accent = g.voiced > 0;
    // the tile has spoken: only one clearly larger layer may add an accent
    if (g.voiced >= G.voicesPerTile || (accent && size < g.size + G.accentBigger)) { stats.grouped++; return null; }
    const score = (p.gain ?? 1) * lerp(A.flap.sizeGainMin, 1, size) * (kind === 'flap-down' ? G.downScore : 1) * (accent ? G.accentScore : 1);
    if (g.pend) {
      // a larger layer of a tile that is still waiting takes over the tile's place in the queue
      if (size > clamp(g.pend.p.size ?? 0.4, 0, 1)) { g.pend.p = p; g.pend.kind = kind; g.pend.score = Math.max(g.pend.score, score); }
      stats.grouped++;
      return null;
    }
    const c = { kind, p, t: when, score, g, accent };
    if (!queue.length && when >= nextOnset) return startOne(c, when);
    g.pend = c;
    queue.push(c);
    if (queue.length > G.queue) {
      let wi = 0;
      for (let i = 1; i < queue.length; i++) if (queue[i].score < queue[wi].score) wi = i;
      queue[wi].g.pend = null;
      queue.splice(wi, 1);
      stats.dropped++;
    }
    return null;
  }

  return {
    ctx, master, trigger, stats, drain,
    pending: () => queue.length,
    activeVoices(t) { let a = 0; for (const s of slots) if (!s.released && s.end > t) a++; return a; },
  };
}

// ------------------------------------------------------------------------------------------------
// Public API
// ------------------------------------------------------------------------------------------------
export function createPaperAudio({ muted = false } = {}) {
  const A = CONFIG.audio;
  let ctx = null;
  let engine = null;
  let isMuted = !!muted;
  let gestureSeen = false;
  let stepCount = 0;

  function ensure() {
    if (ctx || isMuted) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { ctx = new AC({ sampleRate: A.sampleRate, latencyHint: 'interactive' }); } catch { ctx = new AC(); }
    engine = buildEngine(ctx);
  }

  const live = () => !isMuted && ctx && engine && ctx.state === 'running';

  const offFold = bus.on('fold', (e) => {
    if (!live()) return;
    const dist = distanceFor(e.x, e.z);
    const gain = distanceGain(dist);
    if (gain <= 0) { engine.stats.skipped++; return; }
    engine.trigger(e.dir === 'down' ? 'flap-down' : 'flap-up', { size: e.size, pan: e.pan, gain, dist, seed: foldSeed(e), group: groupKey(e) }, ctx.currentTime + 0.004);
    if (engine.pending() && !drainTimer) drainTimer = setTimeout(drainLater, 30);
  });
  let drainTimer = 0;
  function drainLater() {
    drainTimer = 0;
    if (!live()) return;
    engine.drain(ctx.currentTime + 0.004);
    if (engine.pending()) drainTimer = setTimeout(drainLater, 30);
  }
  const offStep = bus.on('step', (e) => {
    stepCount++;
    if (!live()) return;
    engine.trigger('step-' + (e.surface || 'grass'), { pan: (e.foot ? 1 : -1) * A.step.footPan, gain: 1, seed: hash2(stepCount, 31, A.seed), foot: e.foot }, ctx.currentTime + 0.004);
  });
  const offFirst = bus.on('input:first', () => { api.unlock(); });

  const api = {
    /** The live AudioContext (null until the first gesture). */
    get context() { return ctx; },
    get muted() { return isMuted; },
    /** Create/resume the AudioContext. Must be called from a user gesture (main wires 'input:first'). */
    unlock() {
      gestureSeen = true;
      ensure();
      if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
    },
    setMuted(m) {
      isMuted = !!m;
      if (!isMuted && gestureSeen) { ensure(); if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {}); }
      if (engine) {
        const g = engine.master.gain;
        const t = ctx.currentTime;
        g.cancelScheduledValues(t);
        g.setTargetAtTime(isMuted ? 0 : A.masterGain * A.limiter.ceiling, t, 0.015);
      }
    },
    /** Live engine counters ({played, dropped, stolen, skipped, maxConcurrent, nodes, synthMs, ...}). */
    stats() {
      return { live: engine ? { ...engine.stats, voices: engine.activeVoices(ctx.currentTime), state: ctx.state, sampleRate: ctx.sampleRate, time: ctx.currentTime } : null };
    },
    dispose() { offFold(); offStep(); offFirst(); if (drainTimer) clearTimeout(drainTimer); if (ctx) ctx.close(); ctx = null; engine = null; },
  };
  return api;
}
