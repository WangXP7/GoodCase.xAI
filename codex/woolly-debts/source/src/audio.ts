export class GameAudio {
  private context: AudioContext | null = null;
  private enabled = true;

  setEnabled(value: boolean): void {
    this.enabled = value;
  }

  unlock(): void {
    if (!this.enabled) return;
    if (!this.context) this.context = new AudioContext();
    if (this.context.state === "suspended") void this.context.resume();
  }

  hit(critical = false): void {
    this.unlock();
    if (!this.context || !this.enabled) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = critical ? "square" : "triangle";
    oscillator.frequency.setValueAtTime(critical ? 175 : 112, now);
    oscillator.frequency.exponentialRampToValueAtTime(critical ? 62 : 48, now + 0.11);
    gain.gain.setValueAtTime(critical ? 0.12 : 0.075, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.14);
  }

  coin(jackpot = false): void {
    this.unlock();
    if (!this.context || !this.enabled) return;
    const now = this.context.currentTime;
    const notes = jackpot ? [620, 830, 1040] : [720, 920];
    notes.forEach((frequency, index) => {
      const oscillator = this.context!.createOscillator();
      const gain = this.context!.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      const start = now + index * 0.045;
      gain.gain.setValueAtTime(0.055, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.12);
      oscillator.connect(gain).connect(this.context!.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.13);
    });
  }

  ui(): void {
    this.unlock();
    if (!this.context || !this.enabled) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(380, now);
    oscillator.frequency.linearRampToValueAtTime(520, now + 0.05);
    gain.gain.setValueAtTime(0.025, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.08);
  }
}
