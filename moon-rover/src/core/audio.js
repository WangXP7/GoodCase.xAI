/* ============================================================
   SOUND IN A VACUUM
   ------------------------------------------------------------
   Nothing out there carries sound. What you hear is what the
   chassis carries: motor whine through the bogies, regolith
   grinding under the grousers, the drill in the frame. All of it
   arrives structure-borne, so all of it is low-passed and dull.
   The only bright sounds in the mix are electrical — the radio,
   the GPR, the alarms. Everything is synthesised at runtime.
   ============================================================ */

export class Audio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.master = null;
    this.volSfx = 0.8; this.volMusic = 0.55;
    this._motorOn = false;
  }

  /* `external` lets the whole graph be built on an OfflineAudioContext, which
     is how the demo video's soundtrack is rendered: an offline context's
     currentTime does not advance as you schedule against it, so callers set
     `timeBase` per frame and every scheduling site reads now() instead. */
  init(external) {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!external && !AC) return;
    const ctx = this.ctx = external || new AC();

    this.master = ctx.createGain(); this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 22; comp.ratio.value = 5;
    comp.attack.value = 0.004; comp.release.value = 0.22;
    this.master.connect(comp); comp.connect(ctx.destination);

    this.busSfx = ctx.createGain(); this.busSfx.gain.value = this.volSfx;
    this.busMusic = ctx.createGain(); this.busMusic.gain.value = this.volMusic;
    this.busSfx.connect(this.master); this.busMusic.connect(this.master);

    // a short plate-ish reverb so the cabin has some body
    this.verb = ctx.createConvolver();
    this.verb.buffer = this._impulse(1.9, 2.6);
    this.verbGain = ctx.createGain(); this.verbGain.gain.value = 0.24;
    this.verb.connect(this.verbGain); this.verbGain.connect(this.busSfx);

    this.noiseBuf = this._noise(8.0);

    this._buildDrive();
    this._buildAmbient();
    this._buildMusic();
    this.ready = true;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  /** Scheduling clock. Realtime uses the context; offline renders override it. */
  now() { return this.timeBase != null ? this.timeBase : this.ctx.currentTime; }

  _noise(sec) {
    const n = Math.floor(this.ctx.sampleRate * sec);
    const b = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.021 * w) / 1.021;     // brown-ish: heavier at the bottom
      d[i] = last * 3.2;
    }
    return b;
  }
  _impulse(sec, decay) {
    const rate = this.ctx.sampleRate, n = Math.floor(rate * sec);
    const b = this.ctx.createBuffer(2, n, rate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return b;
  }

  /* ---------------- continuous drive layer ----------------
     A raw sawtooth through a resonant filter sounds like a wasp in a jar. What
     a geared hub actually radiates into a chassis is a harmonic stack whose
     partials fall off steeply, plus a quiet gear-mesh tone an octave or two up,
     plus broadband bearing rumble. Built that way here, with every partial
     tuned individually so nothing sticks out as a pure tone. */
  _buildDrive() {
    const ctx = this.ctx;
    this.mGain = ctx.createGain(); this.mGain.gain.value = 0;
    this.mGain.connect(this.busSfx);

    /* One band-limited pulse train — a commutating hub, not a chord — driven
       through a bank of FIXED resonators. That split is what makes it read as
       a machine: the excitation pitch rides the wheel speed while the chassis
       formants stay exactly where they are. A stack of sine partials that all
       slide together just sounds like a siren. */
    const N = 26, real = new Float32Array(N), imag = new Float32Array(N);
    for (let i = 1; i < N; i++) imag[i] = (1 / i) * Math.exp(-i * 0.10);
    const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    this.mOsc = ctx.createOscillator();
    this.mOsc.setPeriodicWave(wave);
    this.mOsc.frequency.value = 38;
    const drive = ctx.createGain(); drive.gain.value = 1;
    this.mOsc.connect(drive); this.mOsc.start();

    // chassis formants, panned apart so the machine has some width around you
    this.mRes = [];
    const FORMANTS = [[172, 5.0, 1.00, -0.35], [418, 6.5, 0.62, 0.30], [905, 8.0, 0.30, -0.15]];
    for (const [f, q, amp, pan] of FORMANTS) {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.value = f; bp.Q.value = q;
      const g = ctx.createGain(); g.gain.value = amp;
      const p = ctx.createStereoPanner(); p.pan.value = pan;
      drive.connect(bp); bp.connect(g); g.connect(p); p.connect(this.mGain);
      this.mRes.push({ bp, g });
    }
    // cogging: a shallow AM at the commutation rate keeps it from being static
    this.cogOsc = ctx.createOscillator(); this.cogOsc.type = 'sawtooth'; this.cogOsc.frequency.value = 90;
    this.cogGain = ctx.createGain(); this.cogGain.gain.value = 0.10;
    this.cogOsc.connect(this.cogGain); this.cogGain.connect(drive.gain);
    this.cogOsc.start();

    // bearing rumble rides with the motor rather than sitting under it
    const br = ctx.createBufferSource(); br.buffer = this.noiseBuf; br.loop = true;
    this.brFilt = ctx.createBiquadFilter(); this.brFilt.type = 'bandpass';
    this.brFilt.frequency.value = 160; this.brFilt.Q.value = 1.1;
    this.brGain = ctx.createGain(); this.brGain.gain.value = 0;
    br.connect(this.brFilt); this.brFilt.connect(this.brGain); this.brGain.connect(this.busSfx);
    br.start();

    // gear mesh: detuned pair, well down in the mix, so it reads as machinery
    this.wOsc = []; this.wGain = ctx.createGain(); this.wGain.gain.value = 0;
    const wf = ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 2600;
    for (let i = 0; i < 2; i++) {
      const o = ctx.createOscillator();
      o.type = 'triangle'; o.frequency.value = 620; o.detune.value = i ? 9 : -7;
      const g = ctx.createGain(); g.gain.value = 0.5;
      o.connect(g); g.connect(wf); o.start();
      this.wOsc.push(o);
    }
    wf.connect(this.wGain); this.wGain.connect(this.busSfx);

    // regolith grind under the wheels — two bands, so it is grit and not hiss
    this.gSrc = ctx.createBufferSource(); this.gSrc.buffer = this.noiseBuf; this.gSrc.loop = true;
    this.gFilt = ctx.createBiquadFilter(); this.gFilt.type = 'bandpass';
    this.gFilt.frequency.value = 240; this.gFilt.Q.value = 0.5;
    this.gHi = ctx.createBiquadFilter(); this.gHi.type = 'highshelf';
    this.gHi.frequency.value = 1800; this.gHi.gain.value = -8;
    this.gGain = ctx.createGain(); this.gGain.gain.value = 0;
    this.gSrc.connect(this.gFilt); this.gFilt.connect(this.gHi);
    this.gHi.connect(this.gGain); this.gGain.connect(this.busSfx);
    this.gSrc.start();

    // chassis rumble
    this.rSrc = ctx.createBufferSource(); this.rSrc.buffer = this.noiseBuf; this.rSrc.loop = true;
    this.rFilt = ctx.createBiquadFilter(); this.rFilt.type = 'lowpass'; this.rFilt.frequency.value = 90;
    this.rGain = ctx.createGain(); this.rGain.gain.value = 0;
    this.rSrc.connect(this.rFilt); this.rFilt.connect(this.rGain); this.rGain.connect(this.busSfx);
    this.rSrc.start();

    // drill
    this.dOsc = ctx.createOscillator(); this.dOsc.type = 'square'; this.dOsc.frequency.value = 96;
    this.dFilt = ctx.createBiquadFilter(); this.dFilt.type = 'lowpass'; this.dFilt.frequency.value = 780; this.dFilt.Q.value = 6;
    this.dGain = ctx.createGain(); this.dGain.gain.value = 0;
    this.dLfo = ctx.createOscillator(); this.dLfo.frequency.value = 18;
    this.dLfoG = ctx.createGain(); this.dLfoG.gain.value = 22;
    this.dLfo.connect(this.dLfoG); this.dLfoG.connect(this.dOsc.frequency);
    this.dOsc.connect(this.dFilt); this.dFilt.connect(this.dGain); this.dGain.connect(this.busSfx);
    this.dGain.connect(this.verb);
    this.dOsc.start(); this.dLfo.start();
  }

  /* ---------------- ambience: the machine keeping itself alive ---------------- */
  _buildAmbient() {
    const ctx = this.ctx;
    this.aGain = ctx.createGain(); this.aGain.gain.value = 0.0;
    const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 47;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 70.6;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 200;
    o1.connect(lp); o2.connect(lp); lp.connect(this.aGain); this.aGain.connect(this.busSfx);
    o1.start(); o2.start();
    // electronics hiss
    const h = ctx.createBufferSource(); h.buffer = this.noiseBuf; h.loop = true;
    const hf = ctx.createBiquadFilter(); hf.type = 'highpass'; hf.frequency.value = 3200;
    const hg = ctx.createGain(); hg.gain.value = 0.010;
    h.connect(hf); hf.connect(hg); hg.connect(this.busSfx); h.start();
  }

  /* ---------------- generative score ---------------- */
  _buildMusic() {
    this.musicOn = true;
    this._chord = 0;
    this._nextChange = 0;
    this.mBus = this.ctx.createGain(); this.mBus.gain.value = 0.0;
    this.mBus.connect(this.busMusic);
    const v = this.ctx.createConvolver(); v.buffer = this._impulse(4.5, 2.2);
    const vg = this.ctx.createGain(); vg.gain.value = 0.55;
    this.mBus.connect(v); v.connect(vg); vg.connect(this.busMusic);
  }

  // D minor, drifting — cold, patient, unresolved
  static CHORDS = [
    [146.83, 174.61, 220.00, 293.66],   // Dm
    [130.81, 174.61, 196.00, 261.63],   // C/E-ish
    [116.54, 174.61, 233.08, 293.66],   // Bb
    [146.83, 196.00, 220.00, 277.18]    // Dm(add) with a leading tone
  ];

  _voice(freq, dur, gain = 0.10, type = 'sine', detune = 0) {
    const ctx = this.ctx, t = this.now();
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; f.Q.value = 0.7;
    o.connect(f); f.connect(g); g.connect(this.mBus);
    o.start(t); o.stop(t + dur + 0.1);
  }

  musicTick(t, tension = 0) {
    if (!this.ready || !this.musicOn) return;
    if (t < this._nextChange) return;
    this._nextChange = t + 17 + Math.random() * 9;
    const ch = Audio.CHORDS[this._chord % Audio.CHORDS.length];
    this._chord++;
    const dur = 18 + Math.random() * 7;
    ch.forEach((f, i) => {
      this._voice(f, dur, 0.055 - i * 0.006, i === 0 ? 'triangle' : 'sine', (Math.random() - 0.5) * 9);
    });
    // a single high bell, sparingly, more often when something is wrong
    if (Math.random() < 0.35 + tension * 0.4) {
      setTimeout(() => this._voice(ch[3] * 2, 7, 0.030, 'sine', 3), 2600 + Math.random() * 4000);
    }
  }

  setMusic(on) {
    this.musicOn = on;
    if (this.ready) this.mBus.gain.setTargetAtTime(on ? 1 : 0, this.now(), 0.6);
  }

  /* ---------------- granular regolith ----------------
     Gravel is not a filtered hiss, it is thousands of individual impacts. A
     continuous bed plus scattered grains at a rate set by wheel speed gets a
     lot closer than any amount of EQ on a static loop. */
  _grain(level, bright, pan) {
    const ctx = this.ctx, t = this.now();
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.55 + Math.random() * 1.3;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass';
    f.frequency.value = 260 + Math.random() * 1500 * bright;
    f.Q.value = 1.4 + Math.random() * 2.6;
    const g = ctx.createGain();
    const dur = 0.035 + Math.random() * 0.07;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level * (0.5 + Math.random()), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    src.connect(f); f.connect(g); g.connect(p); p.connect(this.busSfx);
    const off = Math.random() * (this.noiseBuf.duration - 0.3);
    src.start(t, off, dur + 0.05); src.stop(t + dur + 0.06);
  }

  /** A suspension stop taking a hit — structure-borne, so it is a dull knock. */
  clunk(force, pan = 0) {
    if (!this.ready || force < 0.08) return;
    const ctx = this.ctx, t = this.now();
    const amp = Math.min(force, 1) * 0.22;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(150 + Math.random() * 60, t);
    o.frequency.exponentialRampToValueAtTime(52, t + 0.11);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(amp, t + 0.003);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    const n = ctx.createBufferSource(); n.buffer = this.noiseBuf;
    const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 620; nf.Q.value = 1.6;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(amp * 0.55, t + 0.002);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    o.connect(og); og.connect(p);
    n.connect(nf); nf.connect(ng); ng.connect(p);
    p.connect(this.busSfx);
    o.start(t); o.stop(t + 0.2);
    n.start(t, Math.random() * 5, 0.12); n.stop(t + 0.12);
  }

  /* ---------------- one-shots ---------------- */
  _env(node, peak, attack, decay) {
    const t = this.now();
    node.gain.cancelScheduledValues(t);
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    node.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  thud(force = 1) {
    if (!this.ready) return;
    const ctx = this.ctx, t = this.now();
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(120 * (0.7 + force * 0.4), t);
    o.frequency.exponentialRampToValueAtTime(32, t + 0.28);
    const g = ctx.createGain(); this._env(g, 0.42 * Math.min(force, 2), 0.004, 0.34);
    o.connect(g); g.connect(this.busSfx); g.connect(this.verb);
    o.start(t); o.stop(t + 0.5);
    const n = ctx.createBufferSource(); n.buffer = this.noiseBuf;
    const nf = ctx.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 420;
    const ng = ctx.createGain(); this._env(ng, 0.22 * Math.min(force, 2), 0.002, 0.16);
    n.connect(nf); nf.connect(ng); ng.connect(this.busSfx);
    n.start(t); n.stop(t + 0.3);
  }

  ping(freq = 880, dur = 0.5, peak = 0.16, type = 'sine') {
    if (!this.ready) return;
    const ctx = this.ctx, t = this.now();
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = ctx.createGain(); this._env(g, peak, 0.006, dur);
    o.connect(g); g.connect(this.busSfx); g.connect(this.verb);
    o.start(t); o.stop(t + dur + 0.1);
  }

  /** the GPR chirp: a real swept pulse, because that is what a GPR emits */
  chirp() {
    if (!this.ready) return;
    const ctx = this.ctx, t = this.now();
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(1400, t);
    o.frequency.exponentialRampToValueAtTime(170, t + 0.42);
    const g = ctx.createGain(); this._env(g, 0.13, 0.004, 0.5);
    o.connect(g); g.connect(this.busSfx); g.connect(this.verb);
    o.start(t); o.stop(t + 0.6);
  }

  /** subsurface return — a dense, wrong-sounding cluster */
  echo() {
    if (!this.ready) return;
    [523.25, 622.25, 784, 932.33].forEach((f, i) =>
      setTimeout(() => this.ping(f, 1.4, 0.085, 'sine'), i * 95));
  }

  discovery() {
    if (!this.ready) return;
    [293.66, 440, 587.33, 880].forEach((f, i) =>
      setTimeout(() => this.ping(f, 2.4, 0.10, 'triangle'), i * 130));
  }

  ui(kind = 'tick') {
    if (!this.ready) return;
    if (kind === 'tick') this.ping(1900, 0.05, 0.045, 'square');
    else if (kind === 'ok') { this.ping(880, 0.09, 0.07, 'square'); setTimeout(() => this.ping(1320, 0.12, 0.06, 'square'), 70); }
    else if (kind === 'bad') { this.ping(220, 0.20, 0.10, 'sawtooth'); }
    else if (kind === 'warn') { this.ping(660, 0.10, 0.08, 'square'); setTimeout(() => this.ping(660, 0.10, 0.08, 'square'), 160); }
  }

  radio() {
    if (!this.ready) return;
    const ctx = this.ctx, t = this.now();
    const n = ctx.createBufferSource(); n.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 1.4;
    const g = ctx.createGain(); this._env(g, 0.075, 0.02, 0.6);
    n.connect(f); f.connect(g); g.connect(this.busSfx);
    n.start(t); n.stop(t + 0.8);
  }

  /* ---------------- per-frame mix ---------------- */
  update(dt, st) {
    if (!this.ready) return;
    const t = this.now(), k = 0.06;
    // Normalised against the hub speed of a wheel ROLLING at top speed, not a
    // literal 26 rad/s: the LRV envelope clamps spin to 17 rad/s, so the fixed
    // bar meant the motor topped out at two thirds of its timbre and never
    // sounded worked at all.
    const spin = Math.min(Math.abs(st.wheelSpin) / (st.spinRef || 26), 1);
    const load = Math.min(st.motorLoad, 1);
    const moving = st.contacts > 0 ? 1 : 0;

    // Excitation pitch tracks the hub; the formants above it never move.
    const f0 = 21 + spin * 74;
    this.mOsc.frequency.setTargetAtTime(f0, t, 0.06);
    this.cogOsc.frequency.setTargetAtTime(f0 * 6, t, 0.06);      // six poles
    this.cogGain.gain.setTargetAtTime(0.05 + load * 0.14, t, 0.1);
    // load opens the upper formants — that is what makes effort audible
    this.mRes[1].g.gain.setTargetAtTime(0.34 + load * 0.55, t, 0.1);
    this.mRes[2].g.gain.setTargetAtTime(0.10 + load * 0.42 + spin * 0.18, t, 0.1);
    this.mGain.gain.setTargetAtTime((0.020 + load * 0.075 + spin * 0.028) * moving, t, k);
    this.brFilt.frequency.setTargetAtTime(120 + spin * 260, t, 0.1);
    this.brGain.gain.setTargetAtTime((0.010 + spin * 0.030) * moving, t, k);

    for (const o of this.wOsc) o.frequency.setTargetAtTime(340 + spin * 1180, t, 0.07);
    this.wGain.gain.setTargetAtTime((0.0016 + spin * 0.0075 + load * 0.005) * moving, t, k);

    // normalised against the drive envelope, not a literal: a realistic-mode
    // rover tops out at 3.6 m/s and would otherwise never sound loaded
    const vmax = st.maxSpeed || 8.4;
    const spd = Math.min(st.speed / (vmax * 0.95), 1);
    this.gFilt.frequency.setTargetAtTime(180 + spd * 440, t, 0.12);
    this.gGain.gain.setTargetAtTime((spd * 0.045 + st.slip * 0.085) * moving, t, k);

    // scatter individual grains on top of the bed
    if (moving && (spd > 0.06 || st.slip > 0.08)) {
      this._grainAcc = (this._grainAcc || 0) + dt * (10 + spd * 34 + st.slip * 55);
      let n = Math.min(4, Math.floor(this._grainAcc));
      this._grainAcc -= n;
      while (n-- > 0) this._grain(0.030 + spd * 0.035 + st.slip * 0.05, 0.35 + spd * 0.65,
                                  (Math.random() * 2 - 1) * 0.75);
    } else this._grainAcc = 0;

    this.rFilt.frequency.setTargetAtTime(60 + st.rough * 140, t, 0.15);
    this.rGain.gain.setTargetAtTime(st.rough * 0.16 * moving, t, k);

    this.dGain.gain.setTargetAtTime(st.drilling ? 0.10 : 0, t, 0.08);
    this.dFilt.frequency.setTargetAtTime(st.drilling ? 700 + Math.sin(t * 3) * 200 : 400, t, 0.1);

    this.aGain.gain.setTargetAtTime(0.030 + st.alarm * 0.02, t, 0.4);
  }

  setVolumes(sfx, music) {
    this.volSfx = sfx; this.volMusic = music;
    if (!this.ready) return;
    this.busSfx.gain.setTargetAtTime(sfx, this.now(), 0.1);
    this.busMusic.gain.setTargetAtTime(music, this.now(), 0.1);
  }
}
