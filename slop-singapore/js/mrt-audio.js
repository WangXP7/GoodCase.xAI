// js/mrt-audio.js
// The sounds of an MRT ride (js/mrt.js), synthesised in the city's audio context (js/audio-system.js): the traction
// motors' inverter whine rising and falling with the speed (louder under power and braking), the gears' whine, the
// wheels rolling (a roar in the tunnels, softer out on the viaduct), the rumble underfoot, the air-conditioning, the
// wheels squealing round a tight curve, the door chimes (the two-tone as they open, the beeps as they close), the
// doors' air, and the announcements (spoken by the browser's speech synthesis, where it has a voice). The city's own
// sounds are turned down while you ride: muffled by the car, all but gone underground.

const now = (ctx) => ctx.currentTime;
const set = (param, value, ctx, tc = 0.08) => param.setTargetAtTime(value, now(ctx), tc);

function noiseBuffer(ctx, seconds = 2) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = b.getChannelData(0);
  let pink = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    pink = 0.97 * pink + 0.03 * w;
    d[i] = w * 0.6 + pink * 3;
  }
  return b;
}

class MrtAudio {
  constructor(audioSystem) {
    this.audio = audioSystem;
    this.ready = false;
    this.speech = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
    this.voice = null;
    this.speaking = [];
    if (this.speech) {
      const pick = () => {
        const voices = this.speech.getVoices();
        // (a Singapore voice, else a British one, else any English)
        this.voice = voices.find((v) => /en[-_]SG/i.test(v.lang)) || voices.find((v) => /en[-_]GB/i.test(v.lang) && /female|libby|sonia|serena|kate|susan/i.test(v.name))
          || voices.find((v) => /en[-_]GB/i.test(v.lang)) || voices.find((v) => /^en/i.test(v.lang)) || null;
      };
      pick();
      this.speech.addEventListener?.('voiceschanged', pick);
    }
  }

  get ctx() { return this.audio.context; }

  // The nodes, once the city's audio context exists (its first gesture)
  init() {
    const ctx = this.ctx;
    if (this.ready || !ctx || !this.audio.compressor) return this.ready;
    const out = this.out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.audio.compressor);
    const noise = noiseBuffer(ctx);
    const loop = (filterType, freq, q) => {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      src.loopStart = Math.random();
      const f = ctx.createBiquadFilter();
      f.type = filterType;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(out);
      src.start();
      return { src, f, g };
    };
    const tone = (type, freq) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = 0;
      o.connect(g).connect(out);
      o.start();
      return { o, g };
    };
    // the traction motors: the inverter's tone (stepping through its carrier modes as the train speeds up) and the
    // motors' own, through a band like the car's floor lets through
    this.motorBand = ctx.createBiquadFilter();
    this.motorBand.type = 'bandpass';
    this.motorBand.frequency.value = 900;
    this.motorBand.Q.value = 0.7;
    this.motorBand.connect(out);
    const motorTone = (type) => {
      const o = ctx.createOscillator();
      o.type = type;
      const g = ctx.createGain();
      g.gain.value = 0;
      o.connect(g).connect(this.motorBand);
      o.start();
      return { o, g };
    };
    this.carrier = motorTone('square');
    this.motor = motorTone('sawtooth');
    this.motor2 = motorTone('triangle');
    this.gear = tone('sine', 800);
    this.squeal = tone('sine', 3300);
    this.roll = loop('bandpass', 700, 0.8);
    this.rumble = loop('lowpass', 140, 0.7);
    this.wind = loop('highpass', 1800, 0.5);
    this.aircon = loop('lowpass', 900, 0.4);
    this.hum = tone('sine', 120);
    this.ready = true;
    return true;
  }

  // a short tone: freq Hz, from t (s from now) for dur, at gain
  beep(freq, t, dur, gain = 0.12, type = 'sine') {
    const ctx = this.ctx;
    if (!this.init()) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    const t0 = now(ctx) + t;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
    g.gain.setTargetAtTime(0, t0 + dur * 0.6, dur * 0.25);
    o.connect(g).connect(this.out);
    o.start(t0);
    o.stop(t0 + dur * 2 + 0.2);
  }

  // the doors' air (a hiss), from t
  hiss(t = 0, dur = 0.7, gain = 0.06) {
    const ctx = this.ctx;
    if (!this.init()) return;
    const src = ctx.createBufferSource();
    src.buffer = this.roll.src.buffer;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 2500;
    const g = ctx.createGain();
    const t0 = now(ctx) + t;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.05);
    g.gain.setTargetAtTime(0, t0 + dur * 0.5, dur * 0.25);
    src.connect(f).connect(g).connect(this.out);
    src.start(t0, Math.random());
    src.stop(t0 + dur * 2);
  }

  /** The two-tone chime before an announcement, and as the doors open */
  chime(t = 0) {
    this.beep(784, t, 0.55, 0.1); // G5
    this.beep(659, t + 0.42, 0.8, 0.1); // E5
  }

  /** The doors closing: the warning beeps, then the doors' air */
  closing(seconds = 3.2) {
    const n = Math.max(4, Math.round(seconds * 2.6));
    for (let i = 0; i < n; i++) this.beep(1350, i * (seconds / n) * 0.85, 0.16, 0.07, 'square');
    this.hiss(seconds * 0.8, 0.6, 0.05);
  }

  opening() {
    this.hiss(0, 0.8, 0.07);
    this.chime(0.15);
  }

  /** Say `text`, after `delay` s (an announcement: a chime first, unless `quiet`) */
  say(text, { delay = 0, chime = true } = {}) {
    if (chime) this.chime(delay);
    if (!this.speech || !text || !this.audio.enabled) return;
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    u.lang = this.voice?.lang || 'en-GB';
    u.rate = 0.95;
    u.pitch = 1.05;
    u.volume = 0.9;
    const id = setTimeout(() => this.speech.speak(u), (delay + (chime ? 1.1 : 0)) * 1000);
    this.speaking.push(id);
  }

  stopSpeech() {
    for (const id of this.speaking) clearTimeout(id);
    this.speaking.length = 0;
    this.speech?.cancel();
  }

  /**
   * Each frame of a ride: v (m/s), a (m/s², + powering, - braking), curve (1/m), underground, inside (the camera in
   * the car), doors (0 shut .. 1 open), top (the line's top speed)
   */
  update(st) {
    const ctx = this.ctx;
    if (!this.init() || ctx.state !== 'running') return;
    const { v, a, curve = 0, underground, inside, doors = 0, top = 22 } = st;
    const k = Math.min(1, v / top);
    set(this.out.gain, this.audio.enabled ? 1 : 0, ctx, 0.3);
    // the motors: their tone climbs with the speed; the inverter's carrier steps up through its modes, then follows
    const fm = 18 + v * 26; // Hz, the motor's electrical frequency
    const steps = [[0, 520], [3, 700], [6, 880], [9.5, 0]];
    let fc = 0;
    for (const [from, f] of steps) if (v >= from) fc = f;
    if (!fc) fc = fm * 3; // (synchronous at speed: the carrier follows the motor)
    set(this.carrier.o.frequency, fc + fm * 0.5, ctx, 0.04);
    set(this.motor.o.frequency, fm * 2, ctx, 0.04);
    set(this.motor2.o.frequency, fm * 3, ctx, 0.04);
    const power = Math.min(1, Math.abs(a) / 0.9) * (v > 0.05 ? 1 : 0);
    const shell = inside ? 1 : 0.7;
    set(this.carrier.g.gain, 0.016 * power * (0.4 + 0.6 * (1 - k)) * shell, ctx, 0.06);
    set(this.motor.g.gain, 0.03 * power * (0.25 + k) * shell, ctx, 0.06);
    set(this.motor2.g.gain, 0.02 * power * (0.2 + k) * shell, ctx, 0.06);
    set(this.motorBand.frequency, 500 + fm * 1.5, ctx, 0.1);
    // the gears, the wheels and the track
    set(this.gear.o.frequency, 120 + v * 95, ctx, 0.05);
    set(this.gear.g.gain, 0.006 * k * shell, ctx, 0.1);
    const tunnel = underground ? 1 : 0;
    set(this.roll.f.frequency, 380 + v * 34 + tunnel * 120, ctx, 0.2);
    set(this.roll.g.gain, (0.05 + tunnel * 0.08) * Math.pow(k, 1.2), ctx, 0.15);
    set(this.rumble.g.gain, (0.12 + tunnel * 0.14) * k, ctx, 0.15);
    // the air rushing past (out on the viaduct, the doors' seals; louder seen from outside)
    set(this.wind.g.gain, (inside ? 0.004 : 0.03) * k * k * (1 - tunnel * 0.5), ctx, 0.2);
    // tight curves at low speed squeal
    const sq = curve > 1 / 260 && v > 2 && v < 16 ? Math.min(1, (curve * 260 - 1) * 0.8) : 0;
    set(this.squeal.o.frequency, 3100 + 250 * Math.sin(now(ctx) * 3.1), ctx, 0.05);
    set(this.squeal.g.gain, 0.012 * sq, ctx, 0.12);
    // the air-conditioning and the car's hum, inside
    set(this.aircon.g.gain, inside ? 0.035 : 0, ctx, 0.3);
    set(this.hum.g.gain, inside ? 0.008 : 0, ctx, 0.3);
    // the city outside, muffled by the car (gone in a tunnel), let in by open doors
    const mix = this.audio.mix;
    if (mix) set(mix.gain, inside ? Math.max(doors * 0.6, underground ? 0.04 : 0.3) : underground ? 0.1 : 0.9, ctx, 0.4);
  }

  /** The ride is over: the train's sounds off and the city back */
  stop() {
    this.stopSpeech();
    const ctx = this.ctx;
    if (!this.ready || !ctx) return;
    set(this.out.gain, 0, ctx, 0.3);
    if (this.audio.mix) set(this.audio.mix.gain, 1, ctx, 0.5);
  }
}

export { MrtAudio };
