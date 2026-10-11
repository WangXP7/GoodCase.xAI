// All sounds are synthesized locally. No recordings from the original game.
export class Sound {
  constructor() { this.ctx = null; this.volume = 0.55; this.ambient = null; this.timer = null; this.step = 0; }
  async start() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.value = -16; compressor.ratio.value = 5;
      this.master.connect(compressor); compressor.connect(this.ctx.destination);
      this.noiseBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 3, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      let low = 0;
      for (let i = 0; i < data.length; i++) { low = (low + Math.random() * 0.04 - 0.02) / 1.02; data[i] = low * 5 + (Math.random() * 2 - 1) * 0.6; }
      this.hum();
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (!this.timer) this.timer = setInterval(() => this.beat(), 180);
  }
  setVolume(value) { this.volume = value; if (this.master) this.master.gain.setTargetAtTime(value, this.ctx.currentTime, 0.05); }
  tone(freq, duration, gain = .1, type = 'sine', endFreq = null, delay = 0) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + delay, osc = this.ctx.createOscillator(), vol = this.ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, t);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + duration);
    vol.gain.setValueAtTime(0.001, t); vol.gain.linearRampToValueAtTime(gain, t + .004); vol.gain.exponentialRampToValueAtTime(.001, t + duration);
    osc.connect(vol); vol.connect(this.master); osc.start(t); osc.stop(t + duration + .02);
  }
  noise(duration = .1, gain = .1, cutoff = 3000, delay = 0) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + delay, node = this.ctx.createBufferSource(), vol = this.ctx.createGain(), filter = this.ctx.createBiquadFilter();
    node.buffer = this.noiseBuffer; filter.type = 'lowpass'; filter.frequency.value = cutoff;
    vol.gain.setValueAtTime(gain, t); vol.gain.exponentialRampToValueAtTime(.001, t + duration);
    node.connect(filter); filter.connect(vol); vol.connect(this.master); node.start(t, Math.random()); node.stop(t + duration + .02);
  }
  hum() {
    this.ambient = this.ctx.createGain(); this.ambient.gain.value = .065; this.ambient.connect(this.master);
    [42, 57.2, 84.3].forEach(freq => {
      const osc = this.ctx.createOscillator(), filter = this.ctx.createBiquadFilter();
      osc.type = 'sawtooth'; osc.frequency.value = freq; filter.type = 'lowpass'; filter.frequency.value = 145;
      osc.connect(filter); filter.connect(this.ambient); osc.start();
    });
  }
  beat() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const i = this.step++ % 16;
    if (i % 4 === 0) this.tone(83, .16, .052, 'sine', 36);
    if (i === 4 || i === 12) this.noise(.08, .021, 600);
    if (i % 2) this.noise(.02, .007, 1600);
    if (i === 14) this.tone(110, .17, .008, 'triangle', 54);
  }
  play(name) {
    switch (name) {
      case 'hover': this.tone(300, .025, .018, 'triangle'); break;
      case 'click': this.noise(.03, .14, 2200); this.tone(160, .04, .09, 'square', 50); break;
      case 'load': this.noise(.09, .22, 3800); this.tone(380, .07, .12, 'triangle', 95); break;
      case 'rack': this.noise(.12, .28, 1900); this.noise(.08, .22, 3300, .18); this.tone(160, .12, .08, 'sawtooth', 65); break;
      case 'live': this.noise(.55, 1.3, 7800); this.tone(115, .32, .8, 'triangle', 27); this.noise(.9, .2, 650, .035); break;
      case 'blank': this.noise(.12, .2, 3100); this.tone(310, .045, .09, 'square', 90); break;
      case 'glass': this.tone(820, .4, .09, 'sine', 490); this.noise(.08, .06, 2300); break;
      case 'beer': this.noise(.45, .18, 3200); this.tone(160, .18, .07, 'triangle', 90); break;
      case 'cuffs': [0,.09,.19].forEach(d => { this.noise(.045,.24,4800,d); this.tone(930,.07,.06,'triangle',600,d); }); break;
      case 'saw': for (let i=0;i<5;i++) { this.noise(.16,.2,2900,i*.16); this.tone(150,.13,.08,'sawtooth',280,i*.16); } break;
      case 'cigarettes': this.noise(.18,.16,4300); this.tone(60,.45,.06,'sine'); break;
      case 'phone': [0,.22,.6,.82].forEach(d => { this.tone(440,.16,.09,'square',null,d); this.tone(480,.16,.06,'sine',null,d); }); break;
      case 'inverter': this.tone(70,.65,.23,'sawtooth',1000); this.noise(.5,.2,1500); break;
      case 'adrenaline': this.noise(.13,.11,3400); this.tone(200,.4,.07,'sine',500); break;
      case 'medicine': [0,.11,.24].forEach(d=>this.noise(.065,.13,3300,d)); break;
      case 'revive': this.tone(300,.6,.17,'sawtooth',2300); this.noise(.2,.3,3800,.65); this.tone(900,.2,.14,'sine',null,.7); break;
      case 'cut': this.noise(.12,.4,5700); this.tone(630,.5,.13,'sawtooth',30); break;
      case 'win': [110,164.81,220,329.63].forEach((f,i)=>this.tone(f,1.6,.07,'triangle',null,i*.15)); break;
      case 'death': this.tone(85,2,.22,'sawtooth',20); this.noise(1.4,.1,380); break;
      case 'door': this.noise(.75,.3,450); this.tone(80,.7,.15,'sawtooth',27); break;
    }
  }
  suspend() { if (this.ctx) this.ctx.suspend(); }
  resume() { if (this.ctx) this.ctx.resume(); }
}
