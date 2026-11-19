import { Quaternion, Vector3 } from 'three';
import type { DuelSimulation, Fighter, DuelInput, DuelHit, Wound } from './physics';
import type RAPIER from '@dimforge/rapier3d-compat';
export type WireState = Record<string, unknown>;
export const SNAPSHOT_IDS = ['fighter-red', 'fighter-blue', 'weapons'] as const;
export const held = (f: Fighter) => f.remote?.held ?? !!f.grip;
export const supported = (f: Fighter) => f.remote?.support ?? !!f.supportGrip;
export const hangingHand = (f: Fighter) => f.remote?.hanging ?? f.hang?.hand ?? null;
const round = (x: number) => Math.round(x * 10000) / 10000;
function packBody(body: RAPIER.RigidBody, out: WireState, key: string) {
  const p = body.translation(), q = body.rotation();
  out[key + 'x'] = round(p.x); out[key + 'y'] = round(p.y); out[key + 'z'] = round(p.z);
  out[key + 'q'] = [q.x, q.y, q.z, q.w].map(round);
}
function readBody(body: RAPIER.RigidBody, state: WireState, key: string) {
  const coords = [state[key + 'x'], state[key + 'y'], state[key + 'z']];
  const rotation = state[key + 'q'];
  if (!coords.every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 200)) return;
  if (!Array.isArray(rotation) || rotation.length !== 4 || !rotation.every(v => typeof v === 'number' && Number.isFinite(v))) return;
  const q = new Quaternion().fromArray(rotation); if (q.lengthSq() < .01) return;
  body.setTranslation(new Vector3().fromArray(coords as number[]), false); body.setRotation(q.normalize(), false);
}
function packWound(w: Wound) { return { ...w, parentAnchor: w.parentAnchor.toArray(), childAnchor: w.childAnchor.toArray() }; }
export function fighterSnapshot(f: Fighter): WireState {
  const out: WireState = { heading: f.heading };
  [...f.rig.parts.values()].forEach((part, i) => packBody(part.body, out, 'b' + i));
  out.meta = {
    hp: f.hp, stamina: f.stamina, stagger: f.stagger, down: f.down, state: f.state, mode: f.mode,
    weapon: f.weapon.id, mainHand: f.mainHand, held: !!f.grip, support: !!f.supportGrip, gripStress: f.gripStress,
    hanging: f.hang?.hand ?? null, hangPoint: f.hang?.point.toArray() ?? null, hangInward: f.hang?.inward.toArray() ?? null, pickup: f.pickup?.id ?? null, aim: f.aim.toArray(), guard: f.guard, counterTime: f.counterTime, stepping: f.stepping, attack: f.attack, defeat: f.defeat,
    wounds: f.wounds.map(packWound), disabled: [...f.rig.disabledParts], angular: Object.values(f.sword.angvel()),
  };
  return out;
}
type FighterMeta = Omit<Fighter, 'weapon' | 'wounds' | 'aim' | 'pickup'> & { weapon: number; held: boolean; support: boolean; hanging: 'left' | 'right' | null; wounds: ReturnType<typeof packWound>[]; disabled: string[]; angular: number[]; aim: number[]; pickup: number | null; hangPoint: number[] | null; hangInward: number[] | null };
/** The follower never steps Rapier: existing bodies are only transform containers for the renderer. */
export function applyFighterSnapshot(sim: DuelSimulation, id: number, render: WireState, raw: WireState) {
  const f = sim.fighters[id], meta = raw.meta as FighterMeta | undefined; if (!meta) return;
  [...f.rig.parts.values()].forEach((part, i) => readBody(part.body, render, 'b' + i));
  f.heading = typeof render.heading === 'number' ? render.heading : f.heading;
  f.position.copy(f.rig.parts.get('pelvis')!.body.translation()); f.position.y = 0;
  for (const key of ['hp', 'stamina', 'stagger', 'down', 'state', 'mode', 'mainHand', 'gripStress', 'counterTime', 'stepping', 'attack', 'guard', 'defeat'] as const) Object.assign(f, { [key]: meta[key] });
  f.aim.fromArray(meta.aim ?? [0, 0]);
  f.pickup = meta.pickup === null ? null : sim.weapons[meta.pickup] ?? null;
  f.remote = { point: meta.hangPoint ? new Vector3().fromArray(meta.hangPoint) : null, inward: meta.hangInward ? new Vector3().fromArray(meta.hangInward) : null, held: meta.held, support: meta.support, hanging: meta.hanging };
  if (sim.weapons[meta.weapon]) { f.weapon = sim.weapons[meta.weapon]; f.sword = f.weapon.body; }
  if (Array.isArray(meta.angular) && meta.angular.length === 3) f.sword.setAngvel(new Vector3().fromArray(meta.angular), false);
  f.rig.disabledParts.clear(); for (const part of meta.disabled ?? []) f.rig.disabledParts.add(part);
  f.wounds = (meta.wounds ?? []).map(w => ({ ...w, parentAnchor: new Vector3().fromArray(w.parentAnchor), childAnchor: new Vector3().fromArray(w.childAnchor) }));
}
export function weaponSnapshot(sim: DuelSimulation): WireState {
  const out: WireState = {};
  sim.weapons.forEach((w, i) => packBody(w.body, out, 'w' + i));
  out.meta = { time: sim.time, phase: sim.phase, winner: sim.winner, endedAt: sim.endedAt, hits: sim.hits, blocks: sim.blocks, cuts: sim.cuts, disarms: sim.disarms, holders: sim.weapons.map(w => w.holder) };
  return out;
}
export function applyWeaponSnapshot(sim: DuelSimulation, render: WireState, raw: WireState) {
  sim.weapons.forEach((w, i) => readBody(w.body, render, 'w' + i));
  const meta = raw.meta as ReturnType<typeof readMatchMeta>; if (!meta) return;
  for (const key of ['time', 'phase', 'winner', 'endedAt', 'hits', 'blocks', 'cuts', 'disarms'] as const) Object.assign(sim, { [key]: meta[key] });
  sim.weapons.forEach((w, i) => { w.holder = meta.holders[i] ?? null; });
}
function readMatchMeta() { return {} as Pick<DuelSimulation, 'time' | 'phase' | 'winner' | 'endedAt' | 'hits' | 'blocks' | 'cuts' | 'disarms'> & { holders: (number | null)[] }; }
export type Action = 'slash' | 'chop' | 'lunge' | 'drop' | 'pickup' | 'shove' | 'rematch';
export type InputPacket = { epoch: string; seq: number; move: number[]; aim: number[]; attack: boolean; guard: boolean; interact: boolean; actions: Action[] };
export function packInput(input: DuelInput, epoch: string, seq: number, actions: Action[]): InputPacket {
  return { epoch, seq, move: input.move.toArray(), aim: input.aim.toArray(), attack: input.attack, guard: input.guard, interact: input.interact, actions };
}
export function validInput(value: unknown, epoch: string, lastSequence: number): value is InputPacket {
  if (!value || typeof value !== 'object') return false;
  const p = value as InputPacket;
  return p.epoch === epoch && Number.isSafeInteger(p.seq) && p.seq > lastSequence &&
    [p.move, p.aim].every(v => Array.isArray(v) && v.length === 2 && v.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1.01)) &&
    [p.attack, p.guard, p.interact].every(v => typeof v === 'boolean') &&
    Array.isArray(p.actions) && p.actions.length <= 4 && p.actions.every(a => ['slash', 'chop', 'lunge', 'drop', 'pickup', 'shove', 'rematch'].includes(a));
}
export const hitToWire = (hit: DuelHit) => ({ ...hit, point: hit.point.toArray(), velocity: hit.velocity.toArray() });
export function hitFromWire(value: ReturnType<typeof hitToWire>): DuelHit { return { ...value, point: new Vector3().fromArray(value.point), velocity: new Vector3().fromArray(value.velocity) }; }
