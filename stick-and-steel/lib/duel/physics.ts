import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector2, Vector3 } from 'three';
import { RigSimulation, STEP, type SeveredJoint } from '../rig/physics';
import { vec } from '../rig/ik';
import { evaluateStrike, severThreshold, knocksDown } from './damage';
import { WEAPONS, gripAnchor, handlePoint, safeSkin, type Weapon, type WeaponKind, type WeaponSkin, type Hand } from './weapons';
import { ARENAS, onPlatform, nearestLedge, type ArenaKind } from './arena';
import { PIT_SPIKES, SPIKE_RADIUS, SPIKE_HEIGHT } from './hazards';
import { WRIST_ANCHOR } from '../rig/hand';

export { initPhysics, STEP } from '../rig/physics';
export const GRIP = gripAnchor('right');
export const WEAPON_FRAME = new Quaternion().setFromAxisAngle(vec([1, 0, 0]), Math.PI / 2);
export const WEAPON_CENTER = .34;
const UP = vec([0, 1, 0]);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
export type DuelInput = { move: Vector2; aim: Vector2; attack: boolean; guard: boolean; interact: boolean };
export const createDuelInput = (): DuelInput => ({ move: new Vector2(), aim: new Vector2(.18, .8), attack: false, guard: false, interact: false });
export type DuelPhase = 'ready' | 'fighting' | 'finished';
export type CombatState = 'ready' | 'guard' | 'windup' | 'swing' | 'recover' | 'stagger' | 'down' | 'unarmed' | 'reaching' | 'fallen' | 'rising' | 'hanging' | 'climbing' | 'falling';
export type DuelHit = { kind: 'hit' | 'sever' | 'block' | 'floor' | 'impale'; point: Vector3; velocity: Vector3; strength: number; damage: number; target: number; attacker: number; part: string; counter?: boolean };
export type Wound = SeveredJoint & { born: number; bleed: number };
type Motion = { position: Vector3; linear: Vector3; angular: Vector3 };
type ContactPart = { fighter: number; part: string; weapon: boolean; blade: boolean; blunt?: boolean; item?: Weapon };
type LedgeGrip = { hand: Hand; joint: RAPIER.ImpulseJoint; point: Vector3; inward: Vector3; age: number; climb: number };
export type DuelOptions = { arena: ArenaKind; playerWeapon: WeaponKind; rivalWeapon: WeaponKind; playerSkin?: WeaponSkin | null; rivalSkin?: WeaponSkin | null; spares: boolean; ledgeDrill: boolean };
export type Fighter = {
  id: number; rig: RigSimulation; sword: RAPIER.RigidBody; grip: RAPIER.ImpulseJoint | null;
  weapon: Weapon; mainHand: Hand; supportGrip: RAPIER.ImpulseJoint | null; gripStress: number; gripSettle: number; pickup: Weapon | null; pickupTime: number;
  mode: 'upright' | 'fallen' | 'rising' | 'falling' | 'hanging'; modeTime: number; hang: LedgeGrip | null; grabCooldown: number; shoveTime: number; shoved: boolean;
  climbLanding: Vector3 | null;
  hp: number; stamina: number; stagger: number; down: boolean; downTime: number;
  position: Vector3; heading: number; velocity: Vector3; aim: Vector2; attack: boolean; guard: boolean;
  slashTime: number; slashSide: number; lungeTime: number; aiTime: number;
  lowStrike: boolean; slashDuration: number; windupDuration: number; state: CombatState; recovery: number; recoilTime: number; counterTime: number; manualHeld: boolean; manualWindup: number;
  injuries: Map<string, number>; wounds: Wound[]; hitPart: string; defeat: string; bodyMotion: Map<string, Motion>;
  feet: Vector3[]; stepSide: number; stepping: number; stepTime: number; stepFrom: Vector3; stepTo: Vector3;
  remote?: { point: Vector3 | null; inward: Vector3 | null; held: boolean; support: boolean; hanging: Hand | null };
  weaponGoal: Quaternion; previousAim: Vector2; weaponVelocity: Vector3; weaponAngular: Vector3; weaponPosition: Vector3;
};

/** Both articulated fighters and weapons share one fixed-step Rapier world. */
export class DuelSimulation {
  world!: RAPIER.World;
  events!: RAPIER.EventQueue;
  fighters: Fighter[] = [];
  weapons: Weapon[] = [];
  platform!: RAPIER.RigidBody;
  options: DuelOptions;
  online = false;
  training: 'off' | 'dummy' | 'parry' = 'off';
  idleMotion = false;
  localPlayerId = 0;
  inputs = [createDuelInput(), createDuelInput()];
  get input() { return this.inputs[this.localPlayerId]; }
  isHuman(id: number) { return id === 0 || this.online || this.training !== 'off'; }
  phase: DuelPhase = 'ready';
  winner: number | null = null;
  endedAt: number | null = null;
  time = 0;
  hits = 0;
  blocks = 0;
  cuts = 0;
  disarms = 0;
  practice = false;
  onHit?: (hit: DuelHit) => void;
  private hazards = new Set<number>();
  private contacts = new Map<number, ContactPart>();
  private lastHit = new Map<string, number>();

  constructor(options: Partial<DuelOptions> = {}) {
    this.options = { arena: 'yard', playerWeapon: 'sword', rivalWeapon: 'sword', spares: false, ledgeDrill: false, ...options };
    this.build();
  }

  private build() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = STEP; this.world.numSolverIterations = 14; this.world.maxCcdSubsteps = 3;
    this.events = new RAPIER.EventQueue(true);
    this.platform = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    if (this.options.arena === 'bridge') {
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(ARENAS.bridge.halfX, .25, ARENAS.bridge.halfZ).setTranslation(0, -.25, 0).setFriction(1).setCollisionGroups((1 << 16) | 62), this.platform);
      for (const point of PIT_SPIKES) {
        const spike = this.world.createCollider(RAPIER.ColliderDesc.cone(SPIKE_HEIGHT / 2, SPIKE_RADIUS).setTranslation(point.x, point.y, point.z).setFriction(.8).setCollisionGroups((1 << 16) | 62).setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(12), this.platform);
        this.hazards.add(spike.handle);
      }
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(30, .1, 30).setTranslation(0, -7.1, 0).setCollisionGroups((1 << 16) | 62));
    } else {
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(12, .1, 12).setTranslation(0, -.1, 0).setFriction(1).setCollisionGroups((1 << 16) | 62), this.platform);
      for (const [x, z, sx, sz] of [[-3.7, 0, .08, 3.7], [3.7, 0, .08, 3.7], [0, -3.7, 3.7, .08], [0, 3.7, 3.7, .08]]) {
        this.world.createCollider(RAPIER.ColliderDesc.cuboid(sx, .22, sz).setTranslation(x, .22, z).setFriction(.7).setCollisionGroups((1 << 16) | 62));
      }
    }
    this.fighters = [0, 1].map(id => this.createFighter(id));
    if (this.options.spares) for (const [i, kind] of (['mace', 'greatsword'] as const).entries()) {
      this.createWeapon(kind, vec([i ? 2.4 : -2.4, .10, .12]), new Quaternion().setFromAxisAngle(vec([0, 0, 1]), i ? Math.PI / 2 : -Math.PI / 2), null);
    }
    if (this.options.ledgeDrill && this.options.arena === 'bridge') this.setupLedgeDrill();
    if (this.training === 'dummy') {
      this.dropWeapon(this.fighters[1]);
      this.fighters[1].sword.setTranslation(vec([0, -20, 0]), false);
      this.fighters[1].sword.setEnabled(false);
    }
    // Let the physical joints settle before presenting the arena.
    for (let i = 0; i < 240; i++) this.step();
    this.time = 0; this.hits = 0; this.blocks = 0; this.cuts = 0; this.disarms = 0; this.lastHit.clear();
  }

  private weaponGroups(holder: number | null) { return (8 << 16) | 1 | 8 | 32 | (holder === 0 ? 4 : holder === 1 ? 2 : 6); }

  private createWeapon(kind: WeaponKind, position: Vector3, rotation: Quaternion, holder: number | null) {
    const spec = WEAPONS[kind];
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(position.x, position.y, position.z).setRotation(rotation).setLinearDamping(.15).setAngularDamping(.3).setCcdEnabled(true).setAdditionalSolverIterations(6));
    const item: Weapon = { id: this.weapons.length, spec, body, holder, pickupAfter: 0, position: position.clone(), linear: new Vector3(), angular: new Vector3() };
    for (const shape of spec.shapes) {
      const collider = this.world.createCollider(RAPIER.ColliderDesc.cuboid(...shape.half).setTranslation(...shape.offset).setMass(shape.mass).setFriction(.55).setRestitution(.08).setCollisionGroups(this.weaponGroups(holder)).setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(12), body);
      this.contacts.set(collider.handle, { fighter: holder ?? -1, part: 'sword', weapon: true, blade: shape.surface === 'edge', blunt: shape.surface === 'blunt', item });
    }
    this.weapons.push(item); return item;
  }

  private createFighter(id: number): Fighter {
    const groups = id === 0 ? (2 << 16) | 1 | 4 | 8 | 32 : (4 << 16) | 1 | 2 | 8 | 32;
    const rig = new RigSimulation({ world: this.world, events: this.events, collisionGroups: groups, combat: true });
    const spacing = this.training === 'off' ? 1.05 : this.training === 'parry' ? .9 : 1.4;
    const position = vec([id === 0 ? -spacing : spacing, 0, 0]);
    const heading = id === 0 ? Math.PI / 2 : -Math.PI / 2;
    rig.origin.copy(position); rig.heading = heading; rig.stanceHeight = .96;
    rig.targets.rightHand.set(-.30, 1.26, .40); rig.targets.leftHand.set(.28, 1.27, .22);
    rig.targets.leftFoot.set(.20, .048, .13); rig.targets.rightFoot.set(-.20, .048, -.13);
    rig.reset();
    // Reset restores laboratory targets; install and settle the combat stance.
    rig.targets.rightHand.set(-.30, 1.26, .40); rig.targets.leftHand.set(.28, 1.27, .22);
    const hand = rig.parts.get('right hand')!;
    const rotation = new Quaternion().copy(hand.body.rotation()).multiply(WEAPON_FRAME);
    const gripPoint = GRIP.clone().applyQuaternion(new Quaternion().copy(hand.body.rotation())).add(vec(hand.body.translation()));
    const kind = id === 0 ? this.options.playerWeapon : this.options.rivalWeapon;
    const center = gripPoint.clone().add(vec([0, WEAPONS[kind].center, 0]).applyQuaternion(rotation));
    const weapon = this.createWeapon(kind, center, rotation, id), sword = weapon.body;
    weapon.skin = safeSkin(kind, id === 0 ? this.options.playerSkin : this.options.rivalSkin);
    const grip = this.world.createImpulseJoint(RAPIER.JointData.fixed(GRIP, WEAPON_FRAME, handlePoint(weapon), new Quaternion()), hand.body, sword, true);
    grip.setContactsEnabled(false);
    for (const part of rig.parts.values()) for (let i = 0; i < part.body.numColliders(); i++) {
      this.contacts.set(part.body.collider(i).handle, { fighter: id, part: part.name, weapon: false, blade: false });
    }
    const root = new Quaternion().setFromAxisAngle(UP, heading);
    return {
      id, rig, sword, grip, hp: 100, stamina: 100, stagger: 0, down: false, downTime: 0,
      weapon, mainHand: 'right', supportGrip: null, gripStress: 0, gripSettle: 0, pickup: null, pickupTime: 0, mode: 'upright', modeTime: 0, hang: null, grabCooldown: 0, shoveTime: 0, shoved: false, climbLanding: null,
      position, heading, velocity: new Vector3(), aim: new Vector2(-.45, .25), attack: false, guard: false,
      slashTime: 0, slashSide: -1, lungeTime: 0, aiTime: 0,
      lowStrike: false, slashDuration: .94, windupDuration: .24, state: 'ready', recovery: 0, recoilTime: 0, counterTime: 0, manualHeld: false, manualWindup: 0,
      injuries: new Map(), wounds: [], hitPart: '', defeat: '', bodyMotion: new Map([...rig.parts].map(([name]) => [name, { position: new Vector3(), linear: new Vector3(), angular: new Vector3() }])),
      feet: [vec([.20, .048, .13]), vec([-.20, .048, -.13])].map(p => p.applyQuaternion(root).add(position)),
      stepSide: 0, stepping: -1, stepTime: 0, stepFrom: new Vector3(), stepTo: new Vector3(),
      weaponGoal: rotation.clone(), previousAim: new Vector2(-.45, .25), weaponVelocity: new Vector3(), weaponAngular: new Vector3(), weaponPosition: center.clone(),
    };
  }

  start() { if (this.phase === 'ready') { this.phase = 'fighting'; this.fighters[1].aiTime = 0; } }

  /** Arm the practice partner in place, without resetting either fighter or the world. */
  prepareTrainingParry() {
    if (this.training === 'off') return;
    this.training = 'parry';
    const f = this.fighters[1]; if (f.grip) return;
    const hand = f.rig.parts.get(`${f.mainHand} hand`)!.body;
    const rotation = new Quaternion().copy(hand.rotation()).multiply(WEAPON_FRAME);
    const center = this.gripPoint(f, f.mainHand).sub(handlePoint(f.weapon).applyQuaternion(rotation));
    f.sword.setEnabled(true); f.sword.setTranslation(center, true); f.sword.setRotation(rotation, true);
    f.sword.setLinvel(hand.linvel(), true); f.sword.setAngvel(vec([0, 0, 0]), true);
    f.weapon.holder = f.id; f.weapon.pickupAfter = Infinity;
    f.grip = this.world.createImpulseJoint(RAPIER.JointData.fixed(gripAnchor(f.mainHand), WEAPON_FRAME, handlePoint(f.weapon), new Quaternion()), hand, f.sword, true);
    f.grip.setContactsEnabled(false); f.gripStress = 0; f.recovery = .3;
    for (let i = 0; i < f.sword.numColliders(); i++) f.sword.collider(i).setCollisionGroups(this.weaponGroups(f.id));
  }
  slash(id = this.localPlayerId) {
    const f = this.fighters[id];
    if (this.phase === 'finished' || f.slashTime > 0 || f.recovery > 0 || f.recoilTime > 0 || f.stamina < 12 || !f.grip) return;
    this.start(); this.beginSlash(f, !!this.fighters[1 - id].hang || this.inputs[id].aim.y < -.65);
  }
  chop(id = this.localPlayerId) {
    const f = this.fighters[id];
    if (this.phase === 'finished' || f.slashTime > 0 || f.recovery > 0 || f.recoilTime > 0 || f.stamina < 12 || !f.grip || f.mode !== 'upright') return;
    this.start(); this.beginSlash(f, true);
  }
  private beginSlash(f: Fighter, low = false) {
    f.lowStrike = low;
    const counter = f.counterTime > 0;
    const tempo = f.weapon.spec.tempo * (f.weapon.spec.twoHanded && !f.supportGrip ? 1.25 : 1);
    f.windupDuration = (low ? .48 : counter ? .13 : this.isHuman(f.id) ? .24 : .36) * tempo;
    f.slashDuration = f.windupDuration + .32 + (this.isHuman(f.id) ? .34 : .43) * tempo;
    f.slashTime = f.slashDuration; f.slashSide *= -1; f.stamina -= counter ? 9 : 13; f.counterTime = 0;
  }
  lunge(id = this.localPlayerId) {
    const f = this.fighters[id];
    if (this.phase === 'finished' || f.lungeTime > 0 || f.recoilTime > 0 || f.recovery > .2 || f.stamina < 18 || !f.grip) return;
    this.start(); f.lungeTime = .24; f.stamina -= 18;
  }
  clearInput(id = this.localPlayerId) { const input = this.inputs[id]; input.move.set(0, 0); input.attack = false; input.guard = false; input.interact = false; this.fighters[id].pickup = null; }

  drop(id = this.localPlayerId) {
    const f = this.fighters[id]; f.pickup = null;
    if (f.hang) this.releaseLedge(f); else this.dropWeapon(f);
  }

  shove(id = this.localPlayerId) {
    const f = this.fighters[id];
    const hand = f.grip ? f.mainHand === 'right' ? 'left' : 'right' : this.availableHand(f);
    if (this.phase === 'finished' || f.down || f.mode !== 'upright' || f.shoveTime > 0 || f.stamina < 16 || f.supportGrip || !hand || !this.healthyHand(f, hand)) return;
    this.start(); f.shoveTime = .42; f.shoved = false; f.stamina -= 16;
  }

  private healthyHand(f: Fighter, side: Hand) { return !f.rig.disabledParts.has(`${side} hand`); }
  private availableHand(f: Fighter): Hand | null { return this.healthyHand(f, 'right') ? 'right' : this.healthyHand(f, 'left') ? 'left' : null; }
  private gripPoint(f: Fighter, side: Hand) {
    const hand = f.rig.parts.get(`${side} hand`)!.body;
    return gripAnchor(side).applyQuaternion(new Quaternion().copy(hand.rotation())).add(vec(hand.translation()));
  }
  private weaponHandle(item: Weapon, secondary = false) {
    const point = handlePoint(item); if (secondary) point.y -= .16;
    return point.applyQuaternion(new Quaternion().copy(item.body.rotation())).add(vec(item.body.translation()));
  }
  private targetHand(f: Fighter, side: Hand, gripPoint: Vector3) {
    const hand = f.rig.parts.get(`${side} hand`)!.body;
    const wrist = gripPoint.clone().add(WRIST_ANCHOR.clone().sub(gripAnchor(side)).applyQuaternion(new Quaternion().copy(hand.rotation())));
    f.rig.targets[`${side}Hand`].copy(wrist).sub(f.rig.origin).applyQuaternion(new Quaternion().setFromAxisAngle(UP, -f.heading));
  }

  pickup(id = this.localPlayerId) {
    const f = this.fighters[id];
    if (this.phase !== 'finished' && !f.down && !f.grip && f.mode === 'upright' && this.availableHand(f)) f.pickup = this.nearbyWeapon(id);
  }

  nearbyWeapon(id = this.localPlayerId) {
    const f = this.fighters[id];
    return this.weapons.filter(item => {
      const handle = this.weaponHandle(item);
      return item.holder === null && item.pickupAfter <= this.time && handle.y > -.12 && handle.y < .8 && onPlatform(this.options.arena, handle, -.035) && handle.distanceTo(f.position) < 1.75 && vec(item.body.linvel()).length() < 3;
    }).sort((a, b) => this.weaponHandle(a).distanceTo(f.position) - this.weaponHandle(b).distanceTo(f.position))[0] ?? null;
  }

  private pickupWeapon(f: Fighter, request: boolean) {
    if (f.grip || (!request && !f.pickup) || f.mode !== 'upright' || (this.isHuman(f.id) && (this.inputs[f.id].attack || this.inputs[f.id].guard))) { f.pickup = null; f.pickupTime = 0; return; }
    const side = this.availableHand(f); if (!side) return;
    f.mainHand = side;
    if (!f.pickup) f.pickup = this.nearbyWeapon(f.id);
    const item = f.pickup;
    if (!item || item.holder !== null) { f.pickup = null; return; }
    const handle = this.weaponHandle(item);
    if (handle.distanceTo(f.position) > 2.0 || handle.y < -.15) { f.pickup = null; return; }
    f.pickupTime += STEP; f.attack = f.guard = false; f.state = 'reaching';
    const approach = handle.clone().sub(f.position); approach.y = 0;
    // Walk to the handle before crouching; a deep squat cannot cover walking distance.
    f.rig.stanceHeight = approach.length() > .65 ? .84 : .30;
    if (approach.length() > .30) {
      const next = f.position.clone().addScaledVector(approach.clone().normalize(), STEP * .65);
      const arena = ARENAS[this.options.arena];
      next.x = clamp(next.x, -arena.halfX + .2, arena.halfX - .2); next.z = clamp(next.z, -arena.halfZ + .2, arena.halfZ - .2);
      if (onPlatform(this.options.arena, next, .19)) { f.position.copy(next); f.rig.origin.copy(next); }
    }
    if (approach.length() <= .70) this.targetHand(f, side, handle);
    const hand = f.rig.parts.get(`${side} hand`)!.body;
    const relativeSpeed = vec(hand.linvel()).sub(vec(item.body.linvel())).length();
    // Fingers can close only once the actual hand reaches the handle. No weapon teleport.
    if (f.pickupTime > .18 && this.gripPoint(f, side).distanceTo(handle) < .14 && relativeSpeed < 3) {
      const contactAnchor = this.gripPoint(f, side).sub(vec(item.body.translation())).applyQuaternion(new Quaternion().copy(item.body.rotation()).invert());
      f.grip = this.world.createImpulseJoint(RAPIER.JointData.spherical(gripAnchor(side), contactAnchor), hand, item.body, true);
      f.grip.setContactsEnabled(false); item.holder = f.id; f.weapon = item; f.sword = item.body; f.pickup = null; f.pickupTime = 0; f.gripStress = .15;
      for (let i = 0; i < item.body.numColliders(); i++) item.body.collider(i).setCollisionGroups(this.weaponGroups(f.id));
      f.recovery = .4; f.gripSettle = .4;
    }
  }

  private supportWeapon(f: Fighter) {
    if (!f.grip || f.gripSettle > 0 || !f.weapon.spec.twoHanded || f.mode !== 'upright') return;
    const side: Hand = f.mainHand === 'right' ? 'left' : 'right';
    if (!this.healthyHand(f, side)) return;
    const point = this.weaponHandle(f.weapon, true); this.targetHand(f, side, point);
    if (!f.supportGrip && this.gripPoint(f, side).distanceTo(point) < .20) {
      const handle = handlePoint(f.weapon); handle.y -= .16;
      f.supportGrip = this.world.createImpulseJoint(RAPIER.JointData.spring(0, 190, 12, gripAnchor(side), handle), f.rig.parts.get(`${side} hand`)!.body, f.sword, true);
      f.supportGrip.setContactsEnabled(false);
    }
  }

  private applyShove(f: Fighter, opponent: Fighter) {
    if (f.shoveTime <= 0) return;
    f.shoveTime = Math.max(0, f.shoveTime - STEP);
    const side: Hand = f.grip ? f.mainHand === 'right' ? 'left' : 'right' : this.availableHand(f) ?? 'left';
    if (!this.healthyHand(f, side) || f.supportGrip) return;
    f.rig.targets[`${side}Hand`].set(side === 'left' ? .10 : -.10, 1.32, .72);
    const hand = f.rig.parts.get(`${side} hand`)!.body, chest = opponent.rig.parts.get('chest')!.body;
    if (!f.shoved && !opponent.down && vec(hand.translation()).distanceTo(vec(chest.translation())) < .28) {
      const impulse = vec(chest.translation()).sub(vec(hand.translation())); impulse.y = .04; impulse.normalize().multiplyScalar(14);
      chest.applyImpulseAtPoint(impulse, vec(hand.translation()), true); hand.applyImpulse(impulse.clone().multiplyScalar(-.15), true);
      opponent.stagger = Math.min(1, opponent.stagger + .7); f.shoved = true;
    }
  }

  private knockDown(f: Fighter) {
    if (f.down || f.mode !== 'upright') return;
    f.mode = 'fallen'; f.modeTime = 0; f.state = 'fallen'; f.stagger = 1; f.rig.ragdoll = true; f.slashTime = 0;
    this.dropWeapon(f);
  }

  private startHanging(f: Fighter, hand: Hand, point: Vector3, inward: Vector3) {
    this.dropWeapon(f);
    // The fingers keep their purchase on the lip; the articulated wrist and arm still swing.
    const handBody = f.rig.parts.get(`${hand} hand`)!.body;
    const joint = this.world.createImpulseJoint(RAPIER.JointData.fixed(gripAnchor(hand), new Quaternion(), point, new Quaternion().copy(handBody.rotation())), handBody, this.platform, true);
    joint.setContactsEnabled(false);
    f.hang = { hand, joint, point: point.clone(), inward: inward.clone(), age: 0, climb: 0 };
    f.mode = 'hanging'; f.modeTime = 0; f.state = 'hanging'; f.rig.support = 0;
  }

  private releaseLedge(f: Fighter) {
    if (f.hang) this.world.removeImpulseJoint(f.hang.joint, true);
    f.hang = null; f.mode = 'falling'; f.modeTime = 0; f.grabCooldown = 1.2; f.state = 'falling';
  }

  private replantFeet(f: Fighter) {
    const root = new Quaternion().setFromAxisAngle(UP, f.heading), arena = ARENAS[this.options.arena];
    f.feet = [vec([.20, .048, .14]), vec([-.20, .048, -.14])].map(p => {
      p.applyQuaternion(root).add(f.position); p.x = clamp(p.x, -arena.halfX + .14, arena.halfX - .14); p.z = clamp(p.z, -arena.halfZ + .14, arena.halfZ - .14); return p;
    });
    f.stepping = -1; this.updateFeet(f, root);
  }

  private updateRecovery(f: Fighter): boolean {
    if (f.mode === 'upright') return false;
    f.modeTime += STEP;
    const pelvis = vec(f.rig.parts.get('pelvis')!.body.translation());
    f.position.set(pelvis.x, 0, pelvis.z); f.velocity.set(0, 0, 0); f.attack = f.guard = false; f.slashTime = 0; f.pickup = null;
    f.rig.origin.set(pelvis.x, pelvis.y - .96, pelvis.z); f.rig.heading = f.heading;
    f.rig.rightHandRotation = f.rig.leftHandRotation = null;
    f.rig.support = 0; f.rig.muscleScale = .12; f.rig.footSupport.left = f.rig.footSupport.right = false;
    if (f.mode === 'falling') {
      f.state = 'falling'; f.rig.ragdoll = false;
      if (this.options.arena === 'bridge' && f.grabCooldown <= 0) {
        for (const side of ['left', 'right'] as const) {
          if (!this.healthyHand(f, side)) continue;
          const handPoint = this.gripPoint(f, side), ledge = nearestLedge(handPoint);
          this.targetHand(f, side, ledge.point);
          if (pelvis.y < .8 && handPoint.distanceTo(ledge.point) < .19 && f.rig.parts.get('pelvis')!.body.linvel().y < 1) {
            this.startHanging(f, side, ledge.point, ledge.inward); break;
          }
        }
      }
      if (f.mode === 'falling' && onPlatform(this.options.arena, pelvis, .12) && pelvis.y < .4 && pelvis.y > -.05) { f.mode = 'fallen'; f.modeTime = 0; }
    }
    if (f.mode === 'hanging' && f.hang) {
      const hang = f.hang; f.state = hang.climb > 0 ? 'climbing' : 'hanging'; f.rig.ragdoll = false;
      if (this.phase === 'fighting') { hang.age += STEP; f.stamina = Math.max(0, f.stamina - STEP * (hang.climb > 0 ? 13 : 7)); }
      this.targetHand(f, hang.hand, hang.point);
      if (!this.healthyHand(f, hang.hand) || f.stamina <= 0) this.releaseLedge(f);
      else {
        const wantsUp = this.isHuman(f.id) ? this.inputs[f.id].interact : this.phase === 'fighting' && hang.age > (this.options.ledgeDrill ? 4.5 : 1.2);
        if ((wantsUp && hang.age > .25) || hang.climb > 0) {
          hang.climb += STEP;
          const goal = hang.point.clone().addScaledVector(hang.inward, -.38);
          const outside = pelvis.clone().sub(hang.point).dot(hang.inward) < -.29;
          // Clear the underside before lifting; otherwise the head can wedge below the slab.
          const canLift = hang.climb > .4 && outside;
          f.rig.origin.set(goal.x, canLift ? 0 : pelvis.y - .96, goal.z); f.rig.stanceHeight = canLift ? .22 : .96; f.rig.support = 1; f.rig.muscleScale = .45;
          this.targetHand(f, hang.hand, hang.point);
          if (hang.climb > .5 && pelvis.y > -.02) {
            f.climbLanding = hang.point.clone().addScaledVector(hang.inward, .55);
            this.world.removeImpulseJoint(hang.joint, true); f.hang = null; f.mode = 'rising'; f.modeTime = 0; this.replantFeet(f);
          } else if (hang.climb > 4.2) this.releaseLedge(f);
        }
      }
    } else if (f.mode === 'fallen') {
      f.state = 'fallen'; f.rig.ragdoll = true;
      if (f.modeTime > .65 && onPlatform(this.options.arena, pelvis, .15) && (!this.isHuman(f.id) || this.inputs[f.id].interact)) {
        f.mode = 'rising'; f.modeTime = 0; f.rig.ragdoll = false; this.replantFeet(f);
      }
    }
    if (f.mode === 'rising') {
      f.state = 'rising'; f.rig.ragdoll = false;
      if (!onPlatform(this.options.arena, pelvis, .05) && !f.climbLanding) { f.mode = 'falling'; f.modeTime = 0; }
      else {
        const t = clamp(f.modeTime / 1.15, 0, 1);
        f.rig.origin.set(f.position.x, 0, f.position.z); f.rig.stanceHeight = .34 + .62 * t;
        f.rig.support = .85 + .15 * t; f.rig.muscleScale = .4 + .6 * t; f.rig.footSupport.left = f.rig.footSupport.right = true;
        if (f.climbLanding) {
          f.rig.stanceHeight = .98;
          if (pelvis.y > .35) { f.position.copy(f.climbLanding); f.rig.origin.copy(f.position); }
          if (onPlatform(this.options.arena, pelvis, .2) && pelvis.y > .55) { f.climbLanding = null; this.replantFeet(f); }
        }
        this.updateFeet(f, new Quaternion().setFromAxisAngle(UP, f.heading));
        if (t >= 1 && pelvis.y > .73 && !f.climbLanding) { f.mode = 'upright'; f.modeTime = 0; f.stagger = .3; f.recovery = .3; }
        else if (f.modeTime > 4) { f.mode = 'fallen'; f.modeTime = 0; }
      }
    }
    f.rig.prepareStep(); return true;
  }

  private setupLedgeDrill() {
    const player = this.fighters[0], rival = this.fighters[1];
    const lip = ARENAS.bridge.halfZ;
    player.position.set(0, 0, lip - .72); player.heading = 0; player.rig.origin.copy(player.position); player.rig.heading = 0; player.rig.reset(); this.replantFeet(player);
    const hand = player.rig.parts.get('right hand')!.body, rotation = new Quaternion().copy(hand.rotation()).multiply(WEAPON_FRAME);
    player.sword.setRotation(rotation, true); player.sword.setTranslation(this.gripPoint(player, 'right').add(vec([0, player.weapon.spec.center, 0]).applyQuaternion(rotation)), true);
    this.dropWeapon(rival); rival.sword.setTranslation(vec([1.7, .1, 0]), true); rival.sword.setLinvel(vec([0, 0, 0]), true);
    rival.position.set(-.35, 0, lip + .34); rival.heading = Math.PI; rival.rig.heading = rival.heading; rival.rig.origin.set(-.35, -1.04, lip + .34);
    const point = vec([-.48, .025, lip]); this.targetHand(rival, 'left', point); rival.rig.reset(true);
    this.startHanging(rival, 'left', point, vec([0, 0, -1]));
  }

  private updateFighter(f: Fighter, opponent: Fighter) {
    f.recovery = Math.max(0, f.recovery - STEP); f.recoilTime = Math.max(0, f.recoilTime - STEP); f.counterTime = Math.max(0, f.counterTime - STEP);
    f.grabCooldown = Math.max(0, f.grabCooldown - STEP); f.gripStress = Math.max(0, f.gripStress - STEP * .12);
    if (f.grip && f.gripSettle > 0) {
      f.gripSettle = Math.max(0, f.gripSettle - STEP);
      f.grip.setAnchor2(vec(f.grip.anchor2()).lerp(handlePoint(f.weapon), f.gripSettle > 0 ? 1 - Math.exp(-12 * STEP) : 1));
    }
    if (f.down) { f.state = 'down'; f.attack = f.guard = false; f.rig.ragdoll = true; f.rig.prepareStep(); return; }
    if (this.phase === 'fighting' && f.wounds.length) {
      f.hp = Math.max(0, f.hp - f.wounds.reduce((sum, wound) => sum + wound.bleed, 0) * STEP);
      if (f.hp <= 0) { this.knockOut(f, 'Blood loss'); f.rig.prepareStep(); return; }
    }
    if (this.updateRecovery(f)) return;
    const loose = !f.grip ? this.weapons.filter(w => w.holder === null && w.pickupAfter < this.time && onPlatform(this.options.arena, w.body.translation())).sort((a, b) => this.weaponHandle(a).distanceTo(f.position) - this.weaponHandle(b).distanceTo(f.position))[0] : undefined;
    const delta = vec(opponent.rig.parts.get('pelvis')!.body.translation()).sub(f.position); delta.y = 0;
    const distance = delta.length();
    const ledgeTarget = !this.isHuman(f.id) && f.grip ? opponent.hang : null;
    const facing = f.pickup ? this.weaponHandle(f.pickup).sub(f.position) : !this.isHuman(f.id) && loose ? this.weaponHandle(loose).sub(f.position) : opponent.hang && (ledgeTarget || f.lowStrike || this.inputs[f.id].aim.y < -.5) ? opponent.hang.point.clone().sub(f.position) : delta;
    const desiredHeading = Math.atan2(facing.x, facing.z);
    f.heading += clamp(angleDelta(f.heading, desiredHeading), -STEP * 2.8, STEP * 2.8);
    const root = new Quaternion().setFromAxisAngle(UP, f.heading);
    const forward = vec([0, 0, 1]).applyQuaternion(root), right = vec([1, 0, 0]).applyQuaternion(root);
    const movement = new Vector2(), requestedAim = new Vector2(-.38, .38);
    if (this.isHuman(f.id)) {
      const input = this.inputs[f.id];
      movement.copy(input.move).clampLength(0, 1); requestedAim.copy(input.aim); f.attack = input.attack && !input.guard && !!f.grip; f.guard = input.guard;
      if (input.attack && !f.manualHeld && f.slashTime <= 0) f.manualWindup = .10;
      if (!input.attack && f.manualHeld && f.slashTime <= 0) f.recovery = Math.max(f.recovery, .16);
      f.manualHeld = input.attack; f.manualWindup = Math.max(0, f.manualWindup - STEP);
    } else {
      f.aiTime += STEP;
      const active = this.phase === 'fighting' && !this.practice && opponent.mode !== 'falling';
      const fightingDistance = 1.42 + (f.grip ? f.weapon.spec.reach - .95 : 0);
      movement.set(active ? -Math.sin(f.aiTime * .9) * .18 : 0, active ? clamp((distance - fightingDistance) * 1.6, -.55, .9) : 0);
      if (!f.grip && loose && (active || this.practice)) movement.set(0, clamp((this.weaponHandle(loose).distanceTo(f.position) - .45) * 1.4, 0, .85));
      f.guard = true; f.attack = false;
      const opening = opponent.recovery > .12 || opponent.recoilTime > .1;
      let inRange = distance < fightingDistance + .53;
      if (ledgeTarget) {
        // Walk along the deck to the gripping hand, rather than chasing the
        // hanging pelvis or circling off the opposite edge. Leave room for both feet.
        const arena = ARENAS[this.options.arena];
        const longBlade = f.weapon.spec.twoHanded;
        const offset = f.weapon.spec.kind === 'mace' ? .4 : longBlade ? (ledgeTarget.hand === 'left' ? .8 : -.6) : 0;
        const stand = ledgeTarget.point.clone().addScaledVector(ledgeTarget.inward, longBlade ? (offset > 0 ? .8 : .65) : .72).addScaledVector(UP.clone().cross(ledgeTarget.inward), -offset);
        stand.x = clamp(stand.x, -arena.halfX + .28, arena.halfX - .28);
        stand.z = clamp(stand.z, -arena.halfZ + .28, arena.halfZ - .28);
        const approach = stand.sub(f.position); approach.y = 0;
        inRange = approach.length() < (longBlade ? .13 : .035) && Math.abs(angleDelta(f.heading, desiredHeading)) < .10;
        approach.multiplyScalar(2.4).clampLength(0, .9);
        movement.set(approach.dot(right), approach.dot(forward));
        // Plant the stance during the committed stroke; normal recoil still interrupts it.
        if (!active || (f.lowStrike && f.slashTime > 0)) movement.set(0, 0);
      }
      if (active && f.grip && inRange && f.slashTime <= 0 && f.recovery <= 0 && f.recoilTime <= 0 && f.stamina > 24 && (f.aiTime > 1.4 || (opening && f.counterTime > 0))) {
        this.beginSlash(f, !!ledgeTarget); f.aiTime = 0;
      }
      if (active && !ledgeTarget && distance < .85 && Math.sin(f.aiTime * 1.8) > .98 && !f.supportGrip) this.shove(f.id);
    }
    const idle = this.idleMotion && this.phase === 'ready' && this.training === 'off' && !this.online;
    if (idle) f.guard = false;
    f.state = f.guard ? 'guard' : 'ready';
    if (f.slashTime > 0) {
      f.slashTime = Math.max(0, f.slashTime - STEP);
      const elapsed = f.slashDuration - f.slashTime;
      const stroke = clamp((elapsed - f.windupDuration) / .32, 0, 1);
      const recover = clamp((elapsed - f.windupDuration - .32) / (f.slashDuration - f.windupDuration - .32), 0, 1);
      requestedAim.set(f.slashSide * Math.cos(stroke * Math.PI), f.lowStrike ? (f.weapon.spec.kind === 'mace' ? -1 : -.9) : .48 - Math.sin(stroke * Math.PI) * .46);
      if (f.lowStrike && !this.isHuman(f.id) && f.weapon.spec.kind === 'mace') requestedAim.set(.18, .75 - stroke * 1.75);
      if (recover > 0) requestedAim.lerp(new Vector2(-.38, .38), f.lowStrike ? Math.max(0, (recover - .7) / .3) : recover);
      f.state = elapsed < f.windupDuration ? 'windup' : recover > 0 ? 'recover' : 'swing';
      f.attack = f.state === 'swing'; f.guard = false;
      if (f.state === 'windup') movement.multiplyScalar(.35);
      if (f.state === 'recover') { f.recovery = Math.max(f.recovery, f.slashTime); movement.multiplyScalar(.6); }
    } else if (f.attack) f.state = f.manualWindup > 0 ? 'windup' : 'swing';
    if (f.recoilTime > 0) {
      f.attack = f.guard = false; f.slashTime = 0; f.state = 'stagger'; requestedAim.copy(f.aim); movement.multiplyScalar(.35);
    } else if (f.recovery > 0 && f.slashTime <= 0) { f.attack = f.guard = false; f.state = 'recover'; }
    if (this.phase === 'finished') { movement.set(0, 0); f.attack = false; f.guard = true; f.slashTime = 0; f.state = 'guard'; }
    if (f.guard && (!this.isHuman(f.id) || this.phase === 'finished')) requestedAim.set(.18, .8);
    if (f.state === 'ready') requestedAim.set(-.38, .38);
    if (idle) requestedAim.add(new Vector2(Math.sin(this.time * .8 + f.id * 2) * .065, Math.sin(this.time * 1.1 + f.id) * .035));
    const aimDelta = requestedAim.sub(f.aim).clampLength(0, STEP * (f.state === 'windup' ? 5 : f.state === 'swing' ? 8 : 5) / (f.grip ? f.weapon.spec.tempo : 1));
    f.aim.add(aimDelta);
    f.rig.partMuscleScale.clear();
    if (f.recoilTime > 0) for (const name of ['upper arm', 'forearm', 'hand']) f.rig.partMuscleScale.set(`${f.mainHand} ${name}`, .22);
    if (f.stagger > .2 && f.hitPart) f.rig.partMuscleScale.set(f.hitPart, .3);
    for (const [name, injury] of f.injuries) {
      const weakening = clamp(1 - injury / 100, .5, 1);
      f.rig.partMuscleScale.set(name, Math.min(f.rig.partMuscleScale.get(name) ?? 1, weakening));
    }
    f.stagger = Math.max(0, f.stagger - STEP * .85);
    const effort = f.attack ? f.aim.distanceTo(f.previousAim) : 0;
    f.stamina = clamp(f.stamina + STEP * (f.attack ? 3 : 15) - effort * 1.5, 0, 100); f.previousAim.copy(f.aim);
    const speed = (f.guard && f.grip ? .85 : 1.35) * (1 - .55 * f.stagger) * (f.pickup ? .25 : 1);
    const desiredVelocity = forward.clone().multiplyScalar(movement.y * speed).addScaledVector(right, movement.x * speed);
    if (f.lungeTime > 0) { f.lungeTime = Math.max(0, f.lungeTime - STEP); desiredVelocity.addScaledVector(forward, 2.6); }
    f.velocity.lerp(desiredVelocity, 1 - Math.exp(-10 * STEP));
    f.position.addScaledVector(f.velocity, STEP);
    const pelvis = vec(f.rig.parts.get('pelvis')!.body.translation());
    // The movement target stays close to the physical body, including after hits.
    const offset = f.position.clone().sub(pelvis); offset.y = 0;
    if (offset.length() > .22) { offset.setLength(.22); f.position.x = pelvis.x + offset.x; f.position.z = pelvis.z + offset.z; }
    if (f.stagger > .1) {
      const catchStep = vec(f.rig.parts.get('pelvis')!.body.linvel()); catchStep.y = 0; catchStep.multiplyScalar(.16).clampLength(0, .22);
      f.position.x += (pelvis.x + catchStep.x - f.position.x) * STEP * 7; f.position.z += (pelvis.z + catchStep.z - f.position.z) * STEP * 7;
    }
    const limitX = this.options.arena === 'yard' ? 3.15 : 5.2, limitZ = this.options.arena === 'yard' ? 3.15 : 2.2;
    f.position.x = clamp(f.position.x, -limitX, limitX); f.position.z = clamp(f.position.z, -limitZ, limitZ);
    f.position.y = 0;
    f.rig.origin.copy(f.position); f.rig.heading = f.heading;
    f.rig.stanceHeight = .96 - (f.guard ? .045 : 0) - f.stagger * .10;
    if (idle) f.rig.stanceHeight += Math.sin(this.time * 1.3 + f.id * 1.4) * .008;
    f.rig.support = 1 - .48 * f.stagger; f.rig.muscleScale = (.7 + f.stamina * .003) * (1 - .65 * f.stagger);
    for (const side of ['left', 'right'] as const) f.rig.footSupport[side] = onPlatform(this.options.arena, f.rig.parts.get(`${side} foot`)!.body.translation());
    if (!onPlatform(this.options.arena, pelvis)) f.rig.support = 0;
    const ax = clamp(f.aim.x, -1, 1), ay = clamp(f.aim.y, -1, 1);
    // A low aimed stroke at a hanging opponent lowers the stance enough to reach the lip.
    const edgeReach = opponent.hang ? clamp(-ay, 0, 1) : 0;
    f.rig.stanceHeight -= edgeReach * (f.weapon.spec.kind === 'mace' ? .4 : f.weapon.spec.twoHanded ? .31 : .25);
    const sign = f.mainHand === 'right' ? -1 : 1, freeHand = f.mainHand === 'right' ? 'left' : 'right';
    f.rig.targets[`${f.mainHand}Hand`].set(sign * (f.guard ? .05 : .26) + ax * .22, 1.24 + ay * .22 - edgeReach * .36 - (f.lowStrike && f.slashTime > 0 && opponent.hang && f.weapon.spec.kind === 'mace' ? .2 : 0), (f.attack ? .51 : .34) - Math.abs(ax) * .07);
    f.rig.targets[`${freeHand}Hand`].set(-sign * .27, f.guard ? 1.44 : 1.26, .24);
    f.weaponGoal.copy(root).multiply(new Quaternion().setFromAxisAngle(UP, ax * 1.45)).multiply(new Quaternion().setFromAxisAngle(vec([1, 0, 0]), Math.PI / 2 - ay * 1.10));
    f.rig.rightHandRotation = f.rig.leftHandRotation = null;
    if (f.grip) f.rig[f.mainHand === 'right' ? 'rightHandRotation' : 'leftHandRotation'] = f.weaponGoal.clone().multiply(WEAPON_FRAME.clone().invert());
    else f.state = 'unarmed';
    this.updateFeet(f, root);
    this.pickupWeapon(f, this.phase !== 'finished' && (this.isHuman(f.id) ? this.inputs[f.id].interact : !!loose));
    this.supportWeapon(f); this.applyShove(f, opponent);
    f.rig.prepareStep();
    this.driveWeapon(f);
  }

  private updateFeet(f: Fighter, root: Quaternion) {
    const ideals = [vec([.20, .048, .14]), vec([-.20, .048, -.14])].map(p => p.applyQuaternion(root).add(f.position).addScaledVector(f.velocity, .12));
    if (f.stepping < 0) {
      const errors = ideals.map((p, i) => p.distanceTo(f.feet[i]));
      const threshold = f.stagger > .2 ? .075 : .12;
      const side = errors[f.stepSide] > threshold ? f.stepSide : 1 - f.stepSide;
      if (errors[side] > threshold) { f.stepping = side; f.stepTime = 0; f.stepFrom.copy(f.feet[side]); f.stepTo.copy(ideals[side]); }
    }
    if (f.stepping >= 0) {
      f.stepTime += STEP / (f.stagger > .2 ? .21 : .27); const t = Math.min(1, f.stepTime), smooth = t * t * (3 - 2 * t);
      f.feet[f.stepping].lerpVectors(f.stepFrom, f.stepTo, smooth).addScaledVector(UP, Math.sin(t * Math.PI) * .11);
      if (t >= 1) { f.stepSide = 1 - f.stepping; f.stepping = -1; }
    }
    const inverse = root.clone().invert();
    f.rig.targets.leftFoot.copy(f.feet[0]).sub(f.position).applyQuaternion(inverse);
    f.rig.targets.rightFoot.copy(f.feet[1]).sub(f.position).applyQuaternion(inverse);
  }

  private driveWeapon(f: Fighter) {
    const body = f.sword;
    if (!f.grip) return;
    const rotation = new Quaternion().copy(body.rotation());
    const q = f.weaponGoal.clone().multiply(rotation.clone().invert());
    if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
    const axis = vec(q), sin = axis.length();
    if (sin > 1e-6) axis.multiplyScalar(2 * Math.atan2(sin, q.w) / sin);
    const freq = f.recoilTime > 0 ? 3 : f.guard ? 13 : f.state === 'swing' ? 12 : 9;
    const acceleration = axis.multiplyScalar(freq * freq).addScaledVector(vec(body.angvel()), -2 * (f.state === 'swing' ? .7 : .9) * freq);
    const frame = rotation.clone().multiply(new Quaternion().copy(body.principalInertiaLocalFrame()));
    const torque = acceleration.applyQuaternion(frame.clone().invert()).multiply(vec(body.principalInertia())).applyQuaternion(frame);
    const lever = vec(body.localCom()).sub(handlePoint(f.weapon)).applyQuaternion(rotation);
    torque.add(lever.cross(vec([0, body.mass() * 9.81, 0])));
    const gripPower = (f.weapon.spec.twoHanded && !f.supportGrip ? .6 : 1) * (f.gripSettle > 0 ? .4 : 1);
    torque.clampLength(0, (f.recoilTime > 0 ? .65 : f.weapon.spec.torque * (f.guard ? 1.14 : 1)) * gripPower * (.45 + f.stamina * .0055) * (1 - .55 * f.stagger));
    body.addTorque(torque, true);
  }

  private velocityAt(contact: ContactPart, point: Vector3) {
    if (contact.item) return contact.item.angular.clone().cross(point.clone().sub(contact.item.position)).add(contact.item.linear);
    const f = this.fighters[contact.fighter];
    const motion = contact.weapon ? { position: f.weaponPosition, linear: f.weaponVelocity, angular: f.weaponAngular } : f.bodyMotion.get(contact.part)!;
    return motion.angular.clone().cross(point.clone().sub(motion.position)).add(motion.linear);
  }

  private recoil(f: Fighter, duration: number) {
    f.recoilTime = Math.max(f.recoilTime, duration); f.recovery = Math.max(f.recovery, duration + .12);
    f.slashTime = 0; f.attack = false; f.state = 'stagger';
  }

  private contact(a: number, b: number, force: number) {
    const spikePart = this.hazards.has(a) ? this.contacts.get(b) : this.hazards.has(b) ? this.contacts.get(a) : undefined;
    if (spikePart && !spikePart.weapon && spikePart.fighter >= 0) {
      const f = this.fighters[spikePart.fighter], key = `spike:${f.id}:${spikePart.part}`;
      const velocity = f.bodyMotion.get(spikePart.part)?.linear.clone() ?? new Vector3();
      if (!this.lastHit.has(key) && velocity.length() > 2 && force * STEP > .08) {
        this.lastHit.set(key, this.time);
        let point = vec(f.rig.parts.get(spikePart.part)!.body.translation());
        this.world.contactPair(this.world.getCollider(a), this.world.getCollider(b), manifold => { if (manifold.numSolverContacts()) point = vec(manifold.solverContactPoint(0)); });
        this.knockOut(f, 'Fell onto the spikes');
        this.onHit?.({ kind: 'impale', point, velocity, strength: velocity.length(), damage: 100, target: f.id, attacker: -1, part: spikePart.part });
      }
      return;
    }
    const current = (handle: number) => {
      const c = this.contacts.get(handle);
      return c?.item ? { ...c, fighter: c.item.holder ?? -1 } : c;
    };
    const ca = current(a), cb = current(b);
    let weapon = ca?.weapon ? ca : cb?.weapon ? cb : undefined;
    if (!weapon) return;
    let point = vec(weapon.item!.body.translation());
    this.world.contactPair(this.world.getCollider(a), this.world.getCollider(b), manifold => { if (manifold.numSolverContacts()) point = vec(manifold.solverContactPoint(0)); });
    if (ca?.weapon && cb?.weapon) {
      const score = (c: ContactPart) => c.fighter < 0 ? -100 : (this.fighters[c.fighter].attack ? 10 : 0) + this.velocityAt(c, point).length();
      weapon = score(ca) >= score(cb) ? ca : cb;
    }
    const other = weapon === ca ? cb : ca, f = this.fighters[weapon.fighter];
    if (!f || f.down || !f.grip) return;
    const velocity = this.velocityAt(weapon, point);
    if (other) velocity.sub(this.velocityAt(other, point));
    const speed = velocity.length(), impulse = force * STEP;
    if (!other || other.fighter < 0) {
      if (speed > 2 && impulse > .05 && this.time - (this.lastHit.get(`floor${f.id}`) ?? -10) > .3) {
        this.lastHit.set(`floor${f.id}`, this.time); this.onHit?.({ kind: 'floor', point, velocity, strength: speed, damage: 0, target: f.id, attacker: f.id, part: 'ground' });
      }
      return;
    }
    if (other.fighter === f.id) return;
    const victim = this.fighters[other.fighter];
    if (victim.down || (!other.weapon && victim.rig.disabledParts.has(other.part))) return;
    const key = other.weapon ? `block:${Math.min(f.id, victim.id)}:${Math.max(f.id, victim.id)}` : `${f.id}:${victim.id}:hit`;
    if (speed < 1.25 || impulse < .025 || this.time - (this.lastHit.get(key) ?? -10) < .30) return;
    if (other.weapon) {
      if (!f.attack && !victim.attack && speed < 2.5) return;
      this.lastHit.set(key, this.time); this.blocks++;
      const parry = victim.guard && victim.stamina > 12;
      victim.stamina = Math.max(0, victim.stamina - clamp(impulse * 2, 2, 9));
      f.stamina = Math.max(0, f.stamina - clamp(speed * 1.2, 3, 10));
      this.recoil(f, parry ? .32 : .21);
      if (parry) victim.counterTime = .8;
      else { this.recoil(victim, .20); victim.stagger = Math.min(1, victim.stagger + .12); }
      this.strainGrip(f, (speed * .045 + impulse * .018) * victim.weapon.spec.disarm * (parry ? 1.7 : .8));
      this.strainGrip(victim, (speed * .027 + impulse * .016) * f.weapon.spec.disarm * (parry ? .6 : 1.2));
      this.onHit?.({ kind: 'block', point, velocity, strength: speed, damage: 0, target: victim.id, attacker: f.id, part: 'sword', counter: parry }); return;
    }
    if (this.phase !== 'fighting' || (!f.attack && speed < 3.5)) return;
    const strike = evaluateStrike({ velocity, rotation: new Quaternion().copy(f.sword.rotation()), impulse, blade: weapon.blade, blunt: weapon.blunt, part: other.part });
    if (strike.damage <= 0) return;
    this.lastHit.set(key, this.time); this.hits++;
    if (this.training !== 'off') {
      // Keep the contact impulse and motor response, but make lessons nonlethal.
      victim.hitPart = other.part;
      this.onHit?.({ kind: 'hit', point, velocity, strength: speed, damage: 0, target: victim.id, attacker: f.id, part: other.part });
      return;
    }
    victim.hp = Math.max(0, victim.hp - strike.damage); victim.stagger = clamp(victim.stagger + strike.damage / 70, 0, 1); victim.hitPart = other.part;
    // A forearm hit near the wrist should take the hand, while one near the
    // elbow takes the forearm. Accumulate cuts at that specific joint.
    const cutPart = victim.rig.closestLimbJoint(other.part, point) ?? other.part;
    const tissueDamage = (victim.injuries.get(cutPart) ?? 0) + strike.cut;
    victim.injuries.set(cutPart, tissueDamage);
    if (strike.damage > 12) this.recoil(victim, .14 + Math.min(.22, strike.damage / 180));
    if (other.part === `${victim.mainHand} hand` || other.part === `${victim.mainHand} forearm`) this.strainGrip(victim, strike.damage / 60);
    if (victim.hang && other.part === `${victim.hang.hand} hand` && strike.damage >= 6) this.releaseLedge(victim);
    if (knocksDown(other.part, strike.damage, !!weapon.blunt)) this.knockDown(victim);
    let severed = false, hitPoint = point, hitPart = other.part;
    if (strike.canSever && tissueDamage >= severThreshold(cutPart)) {
      const wound = victim.rig.detach(cutPart);
      if (wound) {
        severed = true; this.cuts++; victim.wounds.push({ ...wound, born: this.time, bleed: cutPart.includes('hand') ? 2 : 3 });
        const stump = victim.rig.parts.get(wound.parent)!.body;
        hitPoint = wound.parentAnchor.clone().applyQuaternion(new Quaternion().copy(stump.rotation())).add(vec(stump.translation())); hitPart = wound.part;
        victim.stagger = 1;
        if (victim.hang && wound.parts.includes(`${victim.hang.hand} hand`)) this.releaseLedge(victim);
        const losesWeapon = wound.parts.includes(`${victim.mainHand} hand`);
        if (losesWeapon) this.dropWeapon(victim);
        if (victim.supportGrip) {
          const supportHand = victim.mainHand === 'right' ? 'left' : 'right';
          if (wound.parts.includes(`${supportHand} hand`)) { this.world.removeImpulseJoint(victim.supportGrip, true); victim.supportGrip = null; }
        }
        const remaining = this.availableHand(victim); if (remaining && losesWeapon) victim.mainHand = remaining;
        if (wound.parts.some(name => name.includes('foot'))) this.knockOut(victim, 'Leg severed');
        else if (!remaining) this.knockOut(victim, 'Unable to continue');
        else if (cutPart.includes('arm')) this.knockDown(victim);
      }
    }
    this.onHit?.({ kind: severed ? 'sever' : 'hit', point: hitPoint, velocity, strength: speed, damage: strike.damage, target: victim.id, attacker: f.id, part: hitPart });
    if (victim.hp <= 0 && !victim.down) this.knockOut(victim, other.part === 'head' ? 'Decisive head strike' : 'Decisive strike');
  }

  private dropWeapon(f: Fighter) {
    if (f.supportGrip) { this.world.removeImpulseJoint(f.supportGrip, true); f.supportGrip = null; }
    if (!f.grip) return;
    if (f.grip) { this.world.removeImpulseJoint(f.grip, true); f.grip = null; }
    f.weapon.holder = null; f.weapon.pickupAfter = this.time + .55; f.pickup = null; f.slashTime = 0; f.attack = false; f.gripSettle = 0;
    for (let i = 0; i < f.sword.numColliders(); i++) f.sword.collider(i).setCollisionGroups(this.weaponGroups(null));
    f.sword.resetTorques(false); f.sword.resetForces(false);
  }

  private strainGrip(f: Fighter, amount: number) {
    if (!f.grip || this.training !== 'off') return;
    f.gripStress += amount * (1.35 - f.stamina * .006) * (f.supportGrip ? .55 : 1);
    if (f.gripStress >= 1) { this.dropWeapon(f); f.state = 'unarmed'; f.recovery = .5; this.disarms++; }
  }

  private knockOut(f: Fighter, reason = 'Lost balance') {
    if (f.hang) { this.world.removeImpulseJoint(f.hang.joint, true); f.hang = null; }
    f.hp = 0; f.down = true; f.rig.ragdoll = true; f.state = 'down'; f.attack = f.guard = false; f.defeat = reason;
    this.dropWeapon(f);
    if (this.phase !== 'finished') { this.phase = 'finished'; this.winner = 1 - f.id; this.endedAt = this.time; this.clearInput(); }
  }

  step() {
    this.time += STEP;
    if (this.training !== 'off') for (const f of this.fighters) { f.stamina = 100; f.downTime = 0; }
    for (const item of this.weapons) { item.body.resetForces(false); item.body.resetTorques(false); }
    this.fighters.forEach((f, i) => this.updateFighter(f, this.fighters[1 - i]));
    for (const item of this.weapons) { item.position.copy(item.body.translation()); item.linear.copy(item.body.linvel()); item.angular.copy(item.body.angvel()); }
    for (const f of this.fighters) {
      for (const side of ['left', 'right'] as const) f.rig.setCombatGrip(side, (!!f.grip && (f.mainHand === side || !!f.supportGrip)) || f.hang?.hand === side, f.hang?.hand === side);
      f.weaponVelocity.copy(f.sword.linvel()); f.weaponAngular.copy(f.sword.angvel()); f.weaponPosition.copy(f.sword.translation());
      for (const [name, motion] of f.bodyMotion) {
        const body = f.rig.parts.get(name)!.body; motion.position.copy(body.translation()); motion.linear.copy(body.linvel()); motion.angular.copy(body.angvel());
      }
    }
    this.world.step(this.events);
    this.events.drainCollisionEvents(() => {});
    this.events.drainContactForceEvents(event => this.contact(event.collider1(), event.collider2(), event.totalForceMagnitude()));
    for (const f of this.fighters) {
      if (f.down || this.phase !== 'fighting') continue;
      const pelvis = f.rig.parts.get('pelvis')!.body.translation();
      if (pelvis.y < -5) { this.knockOut(f, 'Fell from the span'); continue; }
      if (f.mode === 'upright' && this.options.arena === 'bridge' && !onPlatform('bridge', pelvis, -.05)) { f.mode = 'falling'; f.modeTime = 0; this.dropWeapon(f); }
      const low = pelvis.y < .48 && f.mode === 'upright' && !f.pickup;
      f.downTime = low ? f.downTime + STEP : 0;
      if (f.downTime > .45 && this.training === 'off') this.knockDown(f);
    }
  }

  reset(options: Partial<DuelOptions> = {}) {
    this.events.free(); this.world.free(); this.contacts.clear(); this.hazards.clear(); this.lastHit.clear();
    this.options = { ...this.options, ...options }; this.weapons = [];
    this.phase = 'ready'; this.winner = null; this.endedAt = null; this.time = 0; this.inputs = [createDuelInput(), createDuelInput()]; this.build();
  }

  diagnostics() {
    return { bodies: this.world.bodies.len(), joints: this.world.impulseJoints.len(), hits: this.hits, blocks: this.blocks, cuts: this.cuts, disarms: this.disarms,
      fighters: this.fighters.map(f => ({ hp: f.hp, state: f.state, wounds: f.wounds.length, height: f.rig.parts.get('pelvis')!.body.translation().y, ...f.rig.diagnostics() })) };
  }
  dispose() { this.events.free(); this.world.free(); }
}
