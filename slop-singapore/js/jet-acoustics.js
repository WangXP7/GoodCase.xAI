// js/jet-acoustics.js
// How the F-15SGs are heard from the ground. Sound takes distance / 343 s to arrive, so a jet is heard from where it
// was when the sound left it: behind where it is seen, its pitch raised as it comes and dropped as it goes by
// c / (c - v cos), the Doppler shift that falls out of it. A supersonic jet outruns its sound: it arrives in silence,
// and its sound is first heard all at once as its Mach cone sweeps over the listener: the sonic boom. No three.js:
// js/air-force.js records each jet's path (SoundTrail), js/audio-sources.js hears them through it, and js/main.js
// listens for the booms (BoomWatcher) and plays them (renderBoom, through js/audio-system.js) and shakes the view.

const SOUND = { speed: 343, seconds: 45, rate: 60 };

/**
 * A jet's path over the last SOUND.seconds, sampled each frame: push(t, x, y, z, throttle), then hear(t, listener) for
 * what a listener there hears at time t: the sound that left the jet at te, where c (t - te) = |listener - jet(te)|.
 * The latest such te (a supersonic jet behind its cone has two: the latest is the one going away), or none (not yet
 * heard, or gone): -> { x, y, z (where it was), te, delay, distance, speed, mach, throttle, doppler } | null
 */
class SoundTrail {
  constructor({ seconds = SOUND.seconds, rate = SOUND.rate } = {}) {
    this.cap = Math.ceil(seconds * rate) + 1;
    this.d = new Float64Array(this.cap * 5); // t, x, y, z, throttle
    this.head = 0; // the next slot
    this.n = 0;
    this.out = { x: 0, y: 0, z: 0, te: 0, delay: 0, distance: 0, speed: 0, mach: 0, throttle: 0, doppler: 1 };
  }

  get length() { return this.n; }

  clear() {
    this.n = 0;
    this.head = 0;
  }

  push(t, x, y, z, throttle = 0) {
    // (a frame at the same time again: in its place)
    if (this.n && t <= this.d[this.slot(this.n - 1) * 5]) this.head = (this.head - 1 + this.cap) % this.cap;
    else this.n = Math.min(this.cap, this.n + 1);
    const o = this.head * 5;
    this.d[o] = t; this.d[o + 1] = x; this.d[o + 2] = y; this.d[o + 3] = z; this.d[o + 4] = throttle;
    this.head = (this.head + 1) % this.cap;
  }

  // the slot of the k-th oldest sample
  slot(k) {
    return (this.head - this.n + k + this.cap * 2) % this.cap;
  }

  hear(t, lx, ly, lz) {
    const n = this.n;
    if (n < 2) return null;
    const d = this.d;
    const f = (k) => {
      const o = this.slot(k) * 5;
      return SOUND.speed * (t - d[o]) - Math.hypot(lx - d[o + 1], ly - d[o + 2], lz - d[o + 3]);
    };
    // from the newest back: the first sample whose sound has arrived (f >= 0) after one whose hasn't
    let newer = n - 1;
    let fn = f(newer);
    if (fn >= 0) return null; // all of its sound has gone by
    const stride = 8;
    let found = -1;
    for (let k = n - 1 - stride; ; k -= stride) {
      const at = Math.max(0, k);
      const fa = f(at);
      if (fa >= 0) {
        // between `at` and `newer`: the newest sample with f >= 0
        for (let j = newer - 1; j >= at; j--) {
          const fj = f(j);
          if (fj >= 0) { found = j; break; }
          newer = j;
          fn = fj;
        }
        break;
      }
      newer = at;
      fn = fa;
      if (at === 0) return null;
    }
    if (found < 0) return null;
    // between samples `found` (heard) and `found + 1` (not yet): where f = 0
    const a = this.slot(found) * 5, b = this.slot(found + 1) * 5;
    const fa = f(found);
    const s = fa / (fa - fn);
    const out = this.out;
    const dt = d[b] - d[a];
    out.te = d[a] + dt * s;
    out.x = d[a + 1] + (d[b + 1] - d[a + 1]) * s;
    out.y = d[a + 2] + (d[b + 2] - d[a + 2]) * s;
    out.z = d[a + 3] + (d[b + 3] - d[a + 3]) * s;
    out.throttle = d[a + 4] + (d[b + 4] - d[a + 4]) * s;
    out.delay = t - out.te;
    out.distance = Math.hypot(lx - out.x, ly - out.y, lz - out.z);
    const vx = (d[b + 1] - d[a + 1]) / dt, vy = (d[b + 2] - d[a + 2]) / dt, vz = (d[b + 3] - d[a + 3]) / dt;
    out.speed = Math.hypot(vx, vy, vz);
    out.mach = out.speed / SOUND.speed;
    // its speed towards the listener, then (moving source, still air and listener) c / (c - v_r)
    const r = out.distance || 1;
    const toward = (vx * (lx - out.x) + vy * (ly - out.y) + vz * (lz - out.z)) / r;
    out.doppler = Math.min(3, Math.max(0.3, SOUND.speed / Math.max(1, SOUND.speed - toward)));
    return out;
  }
}

/** How loud a boom is (0-1): its overpressure falls off about as distance^-3/4, and it's weak just over Mach 1 */
function boomIntensity(distance, mach) {
  const near = Math.min(1, (450 / Math.max(50, distance)) ** 0.75);
  const strength = Math.min(1, Math.max(0.35, (mach - 1) / 0.12));
  return Math.max(0.05, near * strength);
}

/**
 * Each trail heard by a listener for the first time, while it was supersonic when the sound left it: that's its Mach
 * cone arriving. check(trails, t, x, y, z) -> [{ trail, distance, mach, intensity, x, y, z }] (where the jet was)
 */
class BoomWatcher {
  constructor() {
    this.heard = new WeakMap();
  }

  check(trails, t, lx, ly, lz, out = []) {
    out.length = 0;
    for (const trail of trails) {
      if (!trail) continue;
      const h = trail.length ? trail.hear(t, lx, ly, lz) : null;
      const was = this.heard.get(trail);
      if (h && !was && h.mach > 1) {
        out.push({ trail, distance: h.distance, mach: h.mach, intensity: boomIntensity(h.distance, h.mach), x: h.x, y: h.y, z: h.z });
      }
      this.heard.set(trail, !!h);
    }
    return out;
  }
}

// xorshift: the same rumble for a seed
function random(seed) {
  let s = (Math.floor(seed * 2654435761) >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/**
 * The sound of a boom, `rate` samples a second, peak 1: the N-wave (a pressure jump, its fall through zero over a
 * fighter's ~0.1 s, the jump back), its echoes off the buildings, the low rumble rolling after it and windows
 * rattling. Float32Array of ~1.8 s.
 */
function renderBoom(rate, seed = 1) {
  const n = Math.round(rate * 1.8);
  const out = new Float32Array(n);
  const rnd = random(seed);
  const T = 0.1; // s: the N's length
  const rise = Math.max(2, Math.round(rate * 0.0006));
  const nWave = (t0, amp, softness = 1) => {
    const i0 = Math.round(t0 * rate), len = Math.round(T * rate);
    const edge = rise * softness;
    for (let i = 0; i < len + edge * 2; i++) {
      const k = i0 + i;
      if (k >= n) break;
      // the line from +amp down to -amp, switched in and out over `edge` samples at each end
      const u = Math.min(1, i / len);
      const inEdge = Math.min(1, (i + 1) / edge);
      const outEdge = Math.min(1, Math.max(0, (len + edge - i) / edge));
      out[k] += amp * (1 - 2 * u) * inEdge * outEdge;
    }
  };
  nWave(0, 1);
  // off the buildings: later, softer, duller
  for (const [t, a, s] of [[0.17, 0.32, 6], [0.31, 0.2, 14], [0.52, 0.12, 24], [0.8, 0.06, 40]]) nWave(t + rnd() * 0.03, a * (rnd() < 0.5 ? 1 : -1) * (0.8 + rnd() * 0.4), s);
  // the rumble: noise low-passed (a one-pole at ~90 Hz), swelling in after the front and dying away
  let low = 0, low2 = 0;
  const k = 1 - Math.exp((-2 * Math.PI * 90) / rate);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    low += k * (rnd() * 2 - 1 - low);
    low2 += k * (low - low2);
    const env = Math.min(1, t / 0.04) * Math.exp(-t / 0.55);
    out[i] += low2 * 2.6 * env;
    // windows rattling: a short buzz
    if (t > 0.02 && t < 0.45) out[i] += (rnd() * 2 - 1) * 0.05 * Math.exp(-(t - 0.02) / 0.12) * (0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 38));
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  for (let i = 0; i < n; i++) out[i] /= peak;
  return out;
}

export { SoundTrail, BoomWatcher, boomIntensity, renderBoom, SOUND };
