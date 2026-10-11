/* ============================================================
 * audio.js —— Web Audio API 全程序化合成音效（无外部音频文件）
 * 遵守浏览器自动播放策略：init() 必须在用户点击“开始游戏”后调用
 * ============================================================ */
(function () {
  'use strict';
  var B4 = window.B4 = window.B4 || {};

  var audio = {
    ctx: null,
    master: null,
    ready: false,
    muted: false,
    volume: 0.8,
    _noiseBuf: null,
    _chaseLevel: 0,
    _thumpTimer: 0,
    _stepFlip: 1,

    /* ---------- 初始化与总线 ---------- */
    init: function () {
      if (this.ready) { this.ensure(); return; }
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : this.volume;
        this.master.connect(this.ctx.destination);
        this._loadPrefs();
        this._applyGain();
        this.ready = true;
        this._startAmbient();
      } catch (e) { this.ready = false; }
    },
    ensure: function () {
      if (this.ctx && this.ctx.state === 'suspended') {
        try { this.ctx.resume(); } catch (e) {}
      }
    },
    _applyGain: function () {
      if (this.master) {
        this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.05);
      }
    },
    setVolume: function (v) {
      this.volume = Math.max(0, Math.min(1, v));
      this._applyGain(); this._savePrefs();
    },
    toggleMute: function () {
      this.muted = !this.muted;
      this._applyGain(); this._savePrefs();
      return this.muted;
    },
    _loadPrefs: function () {
      try {
        var raw = localStorage.getItem('b4_audio');
        if (raw) {
          var p = JSON.parse(raw);
          if (typeof p.volume === 'number') this.volume = p.volume;
          if (typeof p.muted === 'boolean') this.muted = p.muted;
        }
      } catch (e) {}
    },
    _savePrefs: function () {
      try { localStorage.setItem('b4_audio', JSON.stringify({ volume: this.volume, muted: this.muted })); } catch (e) {}
    },

    _noise: function () {
      if (!this._noiseBuf) {
        var len = this.ctx.sampleRate * 2;
        this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        var d = this._noiseBuf.getChannelData(0);
        for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      return this._noiseBuf;
    },
    _pan: function (p) {
      if (this.ctx.createStereoPanner) {
        var pan = this.ctx.createStereoPanner(); pan.pan.value = p; return pan;
      }
      var g = this.ctx.createGain(); return g;
    },

    /* ---------- 持续环境声：荧光灯电流声 + 低频噪声 ---------- */
    _startAmbient: function () {
      var ctx = this.ctx, t = ctx.currentTime;
      this.ambGain = ctx.createGain(); this.ambGain.gain.value = 1;
      this.ambGain.connect(this.master);

      // 荧光灯电流嗡鸣 120Hz
      var hum = ctx.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 120;
      var humF = ctx.createBiquadFilter(); humF.type = 'bandpass'; humF.frequency.value = 120; humF.Q.value = 9;
      var humG = ctx.createGain(); humG.gain.value = 0.012;
      var humLfo = ctx.createOscillator(); humLfo.frequency.value = 0.4;
      var humLfoG = ctx.createGain(); humLfoG.gain.value = 0.004;
      humLfo.connect(humLfoG); humLfoG.connect(humG.gain);
      hum.connect(humF); humF.connect(humG); humG.connect(this.ambGain);
      hum.start(t); humLfo.start(t);

      // 环境低频噪声（空调/楼体轰鸣）
      var nz = ctx.createBufferSource(); nz.buffer = this._noise(); nz.loop = true;
      var nzF = ctx.createBiquadFilter(); nzF.type = 'lowpass'; nzF.frequency.value = 150;
      var nzG = ctx.createGain(); nzG.gain.value = 0.03;
      nz.connect(nzF); nzF.connect(nzG); nzG.connect(this.ambGain);
      nz.start(t);

      // 双正弦拍频（营造不安感）
      var d1 = ctx.createOscillator(); d1.frequency.value = 52;
      var d2 = ctx.createOscillator(); d2.frequency.value = 52.8;
      var dG = ctx.createGain(); dG.gain.value = 0.022;
      d1.connect(dG); d2.connect(dG); dG.connect(this.ambGain);
      d1.start(t); d2.start(t);

      // 敌人接近低鸣（增益由游戏帧驱动）
      this.proxGain = ctx.createGain(); this.proxGain.gain.value = 0;
      this.proxGain.connect(this.master);
      var po = ctx.createOscillator(); po.frequency.value = 36; po.type = 'sine';
      var trem = ctx.createOscillator(); trem.frequency.value = 5.4;
      var tremG = ctx.createGain(); tremG.gain.value = 0.5;
      var poG = ctx.createGain(); poG.gain.value = 0.55;
      trem.connect(tremG); tremG.connect(poG.gain);
      po.connect(poG); poG.connect(this.proxGain);
      po.start(t); trem.start(t);

      // 追逐脉冲（增益由游戏帧驱动）
      this.chaseGain = ctx.createGain(); this.chaseGain.gain.value = 0;
      this.chaseGain.connect(this.master);
      var co = ctx.createOscillator(); co.type = 'sawtooth'; co.frequency.value = 98;
      var coF = ctx.createBiquadFilter(); coF.type = 'lowpass'; coF.frequency.value = 320;
      co.connect(coF); coF.connect(this.chaseGain);
      co.start(t);
    },

    /** 每帧驱动持续声部：chase 0/1/2，prox 0..1 */
    frame: function (dt, chase, prox) {
      if (!this.ready) return;
      var t = this.ctx.currentTime;
      this.chaseGain.gain.setTargetAtTime(chase > 0 ? 0.085 * chase : 0, t, 0.25);
      this.proxGain.gain.setTargetAtTime(prox * 0.09, t, 0.2);
      // 心跳式重击
      if (chase > 0) {
        this._thumpTimer -= dt;
        if (this._thumpTimer <= 0) {
          this._thumpTimer = chase >= 2 ? 0.34 : 0.52;
          this._thump(chase >= 2 ? 0.5 : 0.36);
        }
      } else { this._thumpTimer = 0; }
    },

    /* ---------- 音效合成工具 ---------- */
    _env: function (g, t0, peak, attack, decay) {
      g.gain.cancelScheduledValues(t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(peak, t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    },
    _blip: function (type, f0, f1, dur, peak, when) {
      var ctx = this.ctx, t = (when || ctx.currentTime);
      var o = ctx.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(f0, t);
      if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      var g = ctx.createGain(); this._env(g, t, peak, 0.008, dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur + 0.1);
    },
    _noiseHit: function (filterType, freq, q, dur, peak, pan, when) {
      var ctx = this.ctx, t = (when || ctx.currentTime);
      var s = ctx.createBufferSource(); s.buffer = this._noise();
      s.playbackRate.value = 0.8 + Math.random() * 0.4;
      var f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q || 1;
      var g = ctx.createGain(); this._env(g, t, peak, 0.005, dur);
      var p = this._pan(pan || 0);
      s.connect(f); f.connect(g); g.connect(p); p.connect(this.master);
      s.start(t); s.stop(t + dur + 0.1);
    },
    _thump: function (peak) {
      var ctx = this.ctx, t = ctx.currentTime;
      var o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(62, t);
      o.frequency.exponentialRampToValueAtTime(30, t + 0.13);
      var g = ctx.createGain(); this._env(g, t, peak, 0.006, 0.14);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + 0.3);
    },

    /* ---------- 具体音效 ---------- */
    footstep: function (sprint) {
      if (!this.ready) return;
      this._stepFlip *= -1;
      this._noiseHit('bandpass', 330 + Math.random() * 140, 1.2, sprint ? 0.09 : 0.07, sprint ? 0.22 : 0.10, this._stepFlip * 0.18);
    },
    fakeStep: function () { // 低理智幻听脚步
      if (!this.ready) return;
      this._noiseHit('bandpass', 300 + Math.random() * 200, 1.2, 0.07, 0.055, Math.random() * 1.6 - 0.8);
    },
    bump: function () {
      if (!this.ready) return;
      this._noiseHit('lowpass', 240, 1, 0.12, 0.24);
      this._blip('sine', 74, 50, 0.1, 0.18);
    },
    breath: function () { // 体力耗尽喘息
      if (!this.ready) return;
      this._noiseHit('bandpass', 480, 0.8, 0.5, 0.09);
      this._noiseHit('bandpass', 420, 0.8, 0.4, 0.07, 0, this.ctx.currentTime + 0.55);
    },
    spotted: function () { // 被实体发现
      if (!this.ready) return;
      var t = this.ctx.currentTime;
      this._blip('sawtooth', 668, 640, 0.5, 0.10, t);
      this._blip('sawtooth', 624, 590, 0.5, 0.10, t);
      this._noiseHit('highpass', 1400, 1, 0.6, 0.10);
    },
    pickup: function () { // 拾取录像带（磁带咔哒 + 卷带声）
      if (!this.ready) return;
      var t = this.ctx.currentTime;
      this._noiseHit('highpass', 2200, 1, 0.04, 0.16, 0, t);
      this._noiseHit('bandpass', 1700, 3, 0.42, 0.06, 0, t + 0.06);
      this._blip('square', 1046, 1046, 0.07, 0.07, t + 0.05);
    },
    rest: function () { // 安全屋休息
      if (!this.ready) return;
      var t = this.ctx.currentTime;
      this._noiseHit('lowpass', 800, 1, 0.5, 0.05, 0, t);
      this._blip('sine', 660, 660, 0.3, 0.08, t + 0.15);
    },
    codeOk: function () { // 密码正确
      if (!this.ready) return;
      var t = this.ctx.currentTime;
      this._blip('sine', 523, 523, 0.12, 0.12, t);
      this._blip('sine', 784, 784, 0.22, 0.12, t + 0.13);
      this._blip('sine', 84, 60, 0.18, 0.2, t + 0.05);
    },
    codeErr: function () { // 密码错误
      if (!this.ready) return;
      var t = this.ctx.currentTime;
      this._blip('square', 128, 128, 0.22, 0.12, t);
      this._blip('square', 98, 98, 0.3, 0.12, t + 0.3);
    },
    unlock: function () { // 闸门解锁（继电器 + 电机）
      if (!this.ready) return;
      var t = this.ctx.currentTime;
      this._blip('sine', 90, 55, 0.35, 0.3, t);
      this._noiseHit('bandpass', 900, 2, 0.3, 0.12, 0, t + 0.1);
      this._noiseHit('lowpass', 300, 1, 0.8, 0.1, 0, t + 0.35);
    },
    gateLocked: function () { // 闸门未解锁时交互
      if (!this.ready) return;
      this._blip('square', 110, 96, 0.16, 0.1);
      this._noiseHit('bandpass', 500, 2, 0.12, 0.1, 0, this.ctx.currentTime + 0.12);
    },
    death: function () {
      if (!this.ready) return;
      var ctx = this.ctx, t = ctx.currentTime;
      var o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(720, t);
      o.frequency.exponentialRampToValueAtTime(120, t + 0.85);
      var ws = ctx.createWaveShaper();
      var curve = new Float32Array(64);
      for (var i = 0; i < 64; i++) { var x = i / 32 - 1; curve[i] = Math.tanh(x * 3); }
      ws.curve = curve;
      var g = ctx.createGain(); this._env(g, t, 0.3, 0.01, 0.9);
      o.connect(ws); ws.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + 1.1);
      this._noiseHit('lowpass', 900, 1, 0.6, 0.22);
    },
    win: function () {
      if (!this.ready) return;
      var t = this.ctx.currentTime;
      var freqs = [392, 494, 587];
      for (var i = 0; i < freqs.length; i++) {
        this._blip('sine', freqs[i], freqs[i], 1.4, 0.07, t + i * 0.06);
      }
      this._blip('sine', 90, 60, 0.4, 0.22, t);
      this._noiseHit('lowpass', 500, 1, 1.2, 0.05, 0, t + 0.2);
    },
    ui: function () { // 界面点击
      if (!this.ready) return;
      this._blip('sine', 520, 470, 0.05, 0.05);
    }
  };

  B4.audio = audio;
})();
