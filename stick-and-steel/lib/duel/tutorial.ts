import { Vector3 } from 'three';
import type { DuelHit, DuelSimulation } from './physics';

export const TUTORIAL_STORAGE_KEY = 'stick-steel.training.v1';
export type TutorialStep = 'move' | 'swing' | 'hit' | 'parry' | 'great' | 'complete';
export type TutorialStatus = { step: TutorialStep; cue: 'waiting' | 'windup' | 'strike'; swings: number; held: boolean; movement: number[]; practiceSwings: number; hits: number; distance: number };

/** One continuous practice bout. Only deliberate, separated contacts advance it. */
export class DuelTutorial {
  step: TutorialStep = 'move';
  movement = [0, 0, 0, 0]; // W, A, S, D — each needs actual travel, not just a key press.
  private previousPosition = new Vector3();
  travel = 0;
  hits = 0;
  practiceSwings = 0;
  private lastPracticeSwing = -Infinity;
  private readyAt = 0;
  private lastHit = -Infinity;
  swings = 0;
  needsParrySetup = false;
  private nextAttack = 2;
  private celebration = 0;
  constructor(private sim: DuelSimulation) {}
  get status(): TutorialStatus {
    const state = this.sim.fighters[1].state;
    return { step: this.step, cue: state === 'windup' ? 'windup' : state === 'swing' ? 'strike' : 'waiting', swings: this.swings, held: this.step === 'parry' ? this.sim.input.guard : this.sim.input.attack, movement: [...this.movement], practiceSwings: this.practiceSwings, hits: this.hits, distance: this.distance() };
  }
  begin() { this.step = 'move'; this.movement.fill(0); this.previousPosition.copy(this.sim.fighters[0].rig.parts.get('pelvis')!.body.translation()); this.sim.start(); }
  swing() { this.step = 'swing'; this.travel = 0; this.hits = this.practiceSwings = 0; this.readyAt = this.sim.time + .35; this.lastHit = this.lastPracticeSwing = -Infinity; this.sim.start(); }
  steer(dx: number, dy: number) {
    if (!['swing', 'hit'].includes(this.step) || !this.sim.input.attack || this.sim.input.guard) return;
    this.travel = Math.min(250, this.travel + Math.hypot(dx, dy));
    if (this.step === 'swing' && this.travel >= 90 && this.sim.time >= this.readyAt && this.sim.time - this.lastPracticeSwing >= .65) {
      this.practiceSwings++; this.travel = 0; this.lastPracticeSwing = this.sim.time;
      if (this.practiceSwings >= 2) { this.step = 'hit'; this.readyAt = this.sim.time + .45; }
    }
  }
  contact(hit: DuelHit) {
    if (this.step === 'hit' && hit.kind === 'hit' && hit.attacker === 0 && hit.target === 1 && this.sim.input.attack && this.travel >= 90 && this.sim.time >= this.readyAt && this.sim.time - this.lastHit >= .8) {
      this.hits++; this.travel = 0; this.lastHit = this.sim.time;
      if (this.hits >= 2) { this.step = 'parry'; this.needsParrySetup = true; this.sim.clearInput(); }
    }
    if (this.step === 'parry' && !this.needsParrySetup && hit.kind === 'block' && hit.counter && hit.attacker === 1 && hit.target === 0) {
      this.step = 'great'; this.celebration = 0; this.sim.clearInput(); this.sim.clearInput(1);
    }
  }
  parry() { this.sim.prepareTrainingParry(); this.step = 'parry'; this.needsParrySetup = false; this.nextAttack = this.sim.time + 2.2; this.swings = 0; this.sim.start(); }
  private distance() { const a = this.sim.fighters[0].rig.parts.get('pelvis')!.body.translation(), b = this.sim.fighters[1].rig.parts.get('pelvis')!.body.translation(); return Math.hypot(a.x - b.x, a.z - b.z); }
  present(dt: number) {
    if (this.step === 'great') { this.celebration += dt; if (this.celebration >= .95) this.step = 'complete'; }
  }
  tick() {
    if (this.step === 'move') {
      const position = this.sim.fighters[0].rig.parts.get('pelvis')!.body.translation();
      const distance = Math.min(.025, Math.hypot(position.x - this.previousPosition.x, position.z - this.previousPosition.z));
      this.previousPosition.copy(position);
      const { x, y } = this.sim.input.move;
      [y, x, -y, -x].forEach((axis, i) => { if (axis > .25) this.movement[i] = Math.min(1, this.movement[i] + distance / .15); });
      if (this.movement.every(value => value >= 1)) this.swing();
      return;
    }
    if (this.step !== 'parry' || this.needsParrySetup) return;
    const opponent = this.sim.fighters[1];
    const distance = this.distance();
    // The partner steps into range; the player's position and controls stay theirs.
    this.sim.inputs[1].move.set(0, opponent.slashTime || opponent.recoilTime || Math.abs(distance - 1.82) < .02 ? 0 : Math.max(-.45, Math.min(.65, (distance - 1.82) * 1.8)));
    if (Math.abs(distance - 1.82) < .07 && this.sim.time >= this.nextAttack && !opponent.slashTime && !opponent.recovery && !opponent.recoilTime) {
      this.sim.slash(1);
      const extra = .5; opponent.windupDuration += extra; opponent.slashDuration += extra; opponent.slashTime += extra;
      this.nextAttack = this.sim.time + 3.5; this.swings++;
    }
  }
}
