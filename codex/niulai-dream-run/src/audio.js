const NOTES = [196, 220, 261.63, 293.66, 329.63, 392];

export class Soundscape {
  constructor() {
    this.context = null;
    this.master = null;
    this.muted = false;
    this.active = false;
    this.chapter = 0;
    this.step = 0;
    this.timer = 0;
    this.supported = Boolean(window.AudioContext || window.webkitAudioContext);
  }

  async unlock() {
    if (!this.supported) return false;
    if (!this.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.context = new AudioContextClass({ latencyHint: "interactive" });
      this.master = this.context.createGain();
      this.master.gain.value = 0.0001;
      this.master.connect(this.context.destination);
      this.#startAmbientLoop();
    }
    if (this.context.state === "suspended") await this.context.resume();
    this.#applyVolume(0.04);
    return true;
  }

  setActive(active) {
    this.active = active;
    if (this.context) this.#applyVolume(0.12);
  }

  setChapter(chapter) {
    this.chapter = chapter;
    this.step = 0;
    if (!this.context || this.muted) return;
    const root = chapter === 1 ? 174.61 : chapter === 2 ? 220 : 196;
    this.#tone(root, 0.7, "sine", 0.16, 0);
    this.#tone(root * 1.5, 1.1, "triangle", 0.08, 0.12);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.context) this.#applyVolume(0.04);
    return this.muted;
  }

  play(name) {
    if (!this.context || this.muted) return;
    switch (name) {
      case "lane":
        this.#tone(260, 0.08, "sine", 0.035);
        break;
      case "jump":
        this.#glide(220, 440, 0.22, "triangle", 0.08);
        break;
      case "land":
        this.#tone(120, 0.08, "sine", 0.07);
        break;
      case "dash":
        this.#glide(180, 660, 0.46, "sawtooth", 0.06);
        this.#tone(880, 0.18, "triangle", 0.035, 0.12);
        break;
      case "collect":
        this.#tone(660, 0.16, "sine", 0.08);
        this.#tone(990, 0.2, "triangle", 0.055, 0.06);
        break;
      case "hit":
        this.#glide(170, 58, 0.34, "sawtooth", 0.11);
        break;
      case "break":
        this.#tone(180, 0.12, "square", 0.06);
        this.#tone(540, 0.25, "triangle", 0.08, 0.05);
        break;
      case "complete":
        [261.63, 329.63, 392, 523.25].forEach((frequency, index) => {
          this.#tone(frequency, 0.72, "triangle", 0.085, index * 0.13);
        });
        break;
      default:
        break;
    }
  }

  #startAmbientLoop() {
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => {
      if (!this.active || this.muted || !this.context) return;
      const offsets = this.chapter === 1 ? [-2, 0, 3, 1, 4, 2] : this.chapter === 2 ? [1, 4, 2, 5, 3, 0] : [0, 2, 4, 1, 3, 2];
      const frequency = NOTES[offsets[this.step % offsets.length]];
      this.#tone(frequency, 0.82, this.step % 3 === 0 ? "triangle" : "sine", 0.025);
      if (this.step % 4 === 0) this.#tone(frequency / 2, 1.25, "sine", 0.018, 0.08);
      this.step += 1;
    }, 1080);
  }

  #applyVolume(ramp) {
    if (!this.master || !this.context) return;
    const target = this.muted ? 0.0001 : this.active ? 0.16 : 0.025;
    this.master.gain.cancelScheduledValues(this.context.currentTime);
    this.master.gain.setTargetAtTime(target, this.context.currentTime, ramp);
  }

  #tone(frequency, duration, type, volume, delay = 0) {
    if (!this.context || !this.master) return;
    const start = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }

  #glide(from, to, duration, type, volume) {
    if (!this.context || !this.master) return;
    const start = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, start);
    oscillator.frequency.exponentialRampToValueAtTime(to, start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }

  destroy() {
    window.clearInterval(this.timer);
    this.context?.close();
  }
}
