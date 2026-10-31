// 程序化音频：全部用 WebAudio 合成，零外部素材
import { State, on } from './state.js';

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.musicTimer = null;
    this.step = 0;
    this.nextNoteTime = 0;
    this.tempo = 104;
    this._started = false;
  }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = State.muted ? 0 : 0.9;
    this.master.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.9;
    this.sfxGain.connect(this.master);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.34;
    this.musicGain.connect(this.master);
  }

  setMuted(m) {
    State.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  _env(gainNode, t0, peak, attack, decay) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + attack);
    g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  _osc(type, freq, t0, dur, peak, detuneTo) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (detuneTo) o.frequency.exponentialRampToValueAtTime(Math.max(detuneTo, 1), t0 + dur);
    this._env(g, t0, peak, Math.min(0.02, dur * 0.3), dur);
    o.connect(g); g.connect(this.sfxGain);
    o.start(t0); o.stop(t0 + dur + 0.1);
    return { o, g };
  }

  _noise(t0, dur, peak, filterType, freq, q) {
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType; f.frequency.value = freq; if (q) f.Q.value = q;
    const g = this.ctx.createGain();
    this._env(g, t0, peak, 0.008, dur);
    src.connect(f); f.connect(g); g.connect(this.sfxGain);
    src.start(t0); src.stop(t0 + dur + 0.05);
  }

  // ---------- 音效 ----------
  jump() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._osc('square', 280, t, 0.16, 0.16, 620);
  }
  land() {
    if (!this.ctx) return;
    this._noise(this.ctx.currentTime, 0.12, 0.22, 'lowpass', 420, 1);
  }
  footstep(right) {
    if (!this.ctx) return;
    this._noise(this.ctx.currentTime, 0.045, 0.05, 'bandpass', right ? 1400 : 1100, 2);
  }
  whoosh() {
    if (!this.ctx) return;
    this._noise(this.ctx.currentTime, 0.16, 0.09, 'bandpass', 900, 1.2);
  }
  coin(combo) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const base = 880 * Math.pow(1.0595, Math.min(combo, 12));
    this._osc('sine', base, t, 0.09, 0.22);
    this._osc('sine', base * 1.5, t + 0.055, 0.16, 0.2);
  }
  hit() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._osc('sawtooth', 160, t, 0.3, 0.32, 46);
    this._noise(t, 0.25, 0.3, 'lowpass', 900, 1);
  }
  heartDown() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._osc('square', 520, t, 0.12, 0.14, 300);
  }
  horn() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const f of [233, 349]) {
      const { o } = this._osc('sawtooth', f, t, 1.1, 0.1);
      const lfo = this.ctx.createOscillator();
      const lg = this.ctx.createGain();
      lfo.frequency.value = 5.5; lg.gain.value = 4;
      lfo.connect(lg); lg.connect(o.detune);
      lfo.start(t); lfo.stop(t + 1.2);
    }
  }
  win() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => this._osc('triangle', f, t + i * 0.13, 0.34, 0.22));
  }
  lose() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [392, 330, 262, 196].forEach((f, i) => this._osc('triangle', f, t + i * 0.16, 0.3, 0.2));
  }
  ui() {
    if (!this.ctx) return;
    this._osc('sine', 660, this.ctx.currentTime, 0.07, 0.14);
  }

  // ---------- 背景音乐：随速度加快的极简 loop ----------
  startMusic() {
    if (!this.ctx || this._started) return;
    this._started = true;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.musicTimer = setInterval(() => this._scheduler(), 30);
  }
  stopMusic() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
    this._started = false;
  }
  setTempo(bpm) { this.tempo = Math.max(70, Math.min(168, bpm)); }

  _scheduler() {
    if (!this.ctx) return;
    const stepDur = 60 / this.tempo / 4; // 16 分音符
    while (this.nextNoteTime < this.ctx.currentTime + 0.14) {
      this._playStep(this.step, this.nextNoteTime, stepDur);
      this.nextNoteTime += stepDur;
      this.step = (this.step + 1) % 32;
    }
  }

  _playStep(step, t, stepDur) {
    const mg = this.musicGain;
    // 底鼓 0,4,8,12...
    if (step % 4 === 0) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.11);
      this._env(g, t, 0.5, 0.005, 0.12);
      o.connect(g); g.connect(mg);
      o.start(t); o.stop(t + 0.2);
    }
    // 军鼓 4 的倍数后半拍
    if (step % 8 === 4) {
      const n = Math.floor(this.ctx.sampleRate * 0.09);
      const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const s = this.ctx.createBufferSource(); s.buffer = buf;
      const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1800;
      const g = this.ctx.createGain(); g.gain.value = 0.16;
      s.connect(f); f.connect(g); g.connect(mg);
      s.start(t); s.stop(t + 0.12);
    }
    // 闭镲每 16 分
    if (step % 2 === 1) {
      const n = Math.floor(this.ctx.sampleRate * 0.03);
      const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      const s = this.ctx.createBufferSource(); s.buffer = buf;
      const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
      const g = this.ctx.createGain(); g.gain.value = 0.05;
      s.connect(f); f.connect(g); g.connect(mg);
      s.start(t); s.stop(t + 0.05);
    }
    // 贝斯线（A 小调 funk 感）
    const bassPattern = [0, null, 0, 3, 5, null, 3, null, 7, null, 5, 3, 0, null, -2, null];
    const note = bassPattern[step % 16];
    if (note !== null && note !== undefined) {
      const freq = 110 * Math.pow(2, note / 12);
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = freq;
      this._env(g, t, 0.34, 0.006, stepDur * 1.8);
      o.connect(g); g.connect(mg);
      o.start(t); o.stop(t + stepDur * 2);
    }
    // 偶尔来一声铅音
    if (step === 30) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'square';
      o.frequency.value = 880;
      this._env(g, t, 0.07, 0.01, 0.22);
      o.connect(g); g.connect(mg);
      o.start(t); o.stop(t + 0.3);
    }
  }
}

// 全局单例 + 状态联动
export const audio = new Audio();
on('phase', (p) => {
  if (p === 'playing') audio.startMusic();
  else audio.stopMusic();
});
on('mute', (m) => audio.setMuted(m));
