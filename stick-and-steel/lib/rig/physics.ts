import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import { segmentTransform, vec } from './ik';
import { ANATOMY, LIMB_VISUAL_ROTATION, boundedWorldRotation, jointCoordinates, solveLimb, wristRotation, type AngularLimits } from './anatomy';
import { handPaths, handlePaths, neutralHandRotation, PALM_GRIP, WRIST_ANCHOR } from './hand';

export const STEP = 1 / 120;
export type PoseName = 'ready' | 'guard' | 'reach';
export type TargetName = 'leftHand' | 'rightHand' | 'leftFoot' | 'rightFoot';
export type Part = {
  name: string;
  body: RAPIER.RigidBody;
  length: number;
  radius: number;
  shape: 'capsule' | 'head' | 'foot' | 'hand';
  visualRotation: Quaternion;
  goal: { position: Vector3; rotation: Quaternion };
  parent?: Part;
};
export type Ball = { id: number; body: RAPIER.RigidBody; radius: number; born: number; ignoreHandsUntil?: number };
export type Hit = { name: string; position: Vector3; speed: number };
export type CatchPhase = 'idle' | 'reaching' | 'incoming' | 'holding' | 'windup' | 'throwing' | 'released' | 'missed';
type JointLimit = { name: string; joint: RAPIER.ImpulseJoint; bounds: AngularLimits; hinge: boolean; descriptor: RAPIER.JointData; parent: Part; child: Part; active: boolean };
export type SeveredJoint = { part: string; parent: string; parentAnchor: Vector3; childAnchor: Vector3; parts: string[] };
export type RigOptions = { world?: RAPIER.World; events?: RAPIER.EventQueue; collisionGroups?: number; combat?: boolean };
const GROUP_WORLD = (1 << 16) | 14;
const GROUP_RIG = (2 << 16) | 5;
const GROUP_HAND = (8 << 16) | 5;
const GROUP_BALL = (4 << 16) | 15;
const POSES = {
  ready: { hip: [0, 1.04, 0], lean: .06, hands: [[-.48, 1.06, .18], [.48, 1.06, .18]], feet: [[-.27, .068, .02], [.27, .068, .02]] },
  guard: { hip: [0, .9, -.08], lean: .18, hands: [[-.37, 1.50, .38], [.37, 1.44, .43]], feet: [[-.36, .068, .2], [.36, .068, -.16]] },
  reach: { hip: [0, 1.03, 0], lean: .1, hands: [[-.46, 1.0, .12], [.51, 1.7, .54]], feet: [[-.28, .068, .1], [.29, .068, -.1]] },
};
let initPromise: Promise<void> | undefined;
export async function initPhysics() {
  initPromise ??= RAPIER.init();
  await initPromise;
}

/** Headless, fixed-step simulation. Rendering never writes physical transforms. */
export class RigSimulation {
  readonly options: RigOptions;
  origin = new Vector3();
  heading = 0;
  stanceHeight = .95;
  support = 1;
  muscleScale = 1;
  disabledParts = new Set<string>();
  partMuscleScale = new Map<string, number>();
  rightHandRotation: Quaternion | null = null;
  leftHandRotation: Quaternion | null = null;
  footSupport = { left: true, right: true };
  world: RAPIER.World;
  events: RAPIER.EventQueue;
  parts = new Map<string, Part>();
  balls: Ball[] = [];
  targets: Record<TargetName, Vector3>;
  resolvedTargets: Record<TargetName, Vector3>;
  pose: PoseName = 'ready';
  strength = .62;
  ragdoll = false;
  time = 0;
  hits = 0;
  onHit?: (hit: Hit) => void;
  catchPhase: CatchPhase = 'idle';
  fingerCurl = { left: 0, right: 0 };
  heldBall: Ball | null = null;
  private phaseTime = 0;
  private incomingBall: Ball | null = null;
  private gripJoint: RAPIER.ImpulseJoint | null = null;
  private gripAnchor = PALM_GRIP.clone();
  private throwPower = 8;
  private jointLimits: JointLimit[] = [];
  private fingerColliders = new Map<string, RAPIER.Collider[]>();
  private combatGrips = new Map<string, string>();
  private hip = vec(POSES.ready.hip);
  private lean = POSES.ready.lean;
  private ballId = 0;
  private colliderNames = new Map<number, string>();
  private colliderBalls = new Map<number, Ball>();
  private lastHitAt = new Map<string, number>();

  constructor(options: RigOptions = {}) {
    this.options = options;
    this.world = options.world ?? new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    if (!options.world) { this.world.timestep = STEP; this.world.numSolverIterations = 12; }
    this.events = options.events ?? new RAPIER.EventQueue(true);
    this.targets = { leftHand: vec(POSES.ready.hands[0]), rightHand: vec(POSES.ready.hands[1]), leftFoot: vec(POSES.ready.feet[0]), rightFoot: vec(POSES.ready.feet[1]) };
    if (options.combat) for (const target of Object.values(this.targets)) target.x *= -1;
    this.resolvedTargets = Object.fromEntries(Object.entries(this.targets).map(([k, v]) => [k, v.clone()])) as Record<TargetName, Vector3>;
    if (!options.world) {
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(20, .1, 20).setTranslation(0, -.1, 0).setFriction(.85).setRestitution(.45).setCollisionGroups(GROUP_WORLD));
      for (const [x, z, sx, sz] of [[-5, 0, .12, 5], [5, 0, .12, 5], [0, -5, 5, .12], [0, 5, 5, .12]]) {
        this.world.createCollider(RAPIER.ColliderDesc.cuboid(sx, .13, sz).setTranslation(x, .13, z).setRestitution(.7).setCollisionGroups(GROUP_WORLD));
      }
    }
    this.build();
    this.updateGoals(1);
  }

  /** The lab's hand drawing frame uses the opposite side names to a +Z-facing fighter. */
  handDrawingSide(side: 'left' | 'right') { return this.options.combat ? side === 'right' ? 'left' : 'right' : side; }

  private addPart(name: string, a: Vector3, b: Vector3, radius: number, mass: number, shape: Part['shape'] = 'capsule', rotation?: Quaternion, visualRotation = new Quaternion()) {
    const tf = segmentTransform(a, b);
    if (shape !== 'capsule') tf.rotation.identity();
    if (rotation) tf.rotation.copy(rotation);
    const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(tf.position.x, tf.position.y, tf.position.z).setRotation(tf.rotation).setLinearDamping(.18).setAngularDamping(.8).setCcdEnabled(true).setAdditionalSolverIterations(4);
    // The hand's mass includes its spread digits, not just the tiny hub collider.
    // Keep that rotational inertia when simplifying the collision silhouette.
    if (shape === 'hand') desc.setAdditionalMassProperties(mass, vec([0, 0, 0]), vec([.0003, .00035, .0004]), visualRotation);
    if (this.options.combat && shape === 'capsule') {
      const bend = mass * (tf.length ** 2 / 12 + radius ** 2 / 4);
      desc.setAdditionalMassProperties(mass, vec([0, 0, 0]), vec([bend, mass * radius ** 2 / 2, bend]), visualRotation);
    }
    const body = this.world.createRigidBody(desc);
    // The forearm ends at the wrist instead of protruding into the smaller hand.
    const halfHeight = Math.max(.01, tf.length / 2 - radius * (name.includes('forearm') ? 1 : .45));
    const cd = shape === 'head' ? RAPIER.ColliderDesc.ball(radius) : shape === 'foot' ? (this.options.combat ? RAPIER.ColliderDesc.cuboid(.045, .04, .12) : RAPIER.ColliderDesc.cuboid(.072, .06, .145)) : shape === 'hand' ? RAPIER.ColliderDesc.cuboid(.012, .018, .012).setRotation(visualRotation) : RAPIER.ColliderDesc.capsule(halfHeight, this.options.combat ? .018 : radius).setRotation(visualRotation);
    const col = this.world.createCollider(cd.setMass(shape === 'hand' || (this.options.combat && shape === 'capsule') ? 0 : mass).setFriction(shape === 'foot' ? 1.5 : .8).setRestitution(shape === 'hand' ? 0 : .1).setCollisionGroups(this.options.collisionGroups ?? (shape === 'hand' ? GROUP_HAND : GROUP_RIG)).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
    const part: Part = { name, body, length: tf.length, radius, shape, goal: tf, visualRotation };
    this.parts.set(name, part);
    this.colliderNames.set(col.handle, name);
    return part;
  }

  private connect(parent: Part, child: Part, anchor: Vector3, bounds: AngularLimits, hinge = false) {
    const local = (p: Part) => anchor.clone().sub(vec(p.body.translation())).applyQuaternion(new Quaternion().copy(p.body.rotation()).invert());
    const desc = hinge ? RAPIER.JointData.revolute(local(parent), local(child), vec([1, 0, 0])) : RAPIER.JointData.spherical(local(parent), local(child));
    const joint = this.createJoint(parent, child, desc, bounds, hinge);
    this.jointLimits.push({ name: child.name, joint, bounds, hinge, descriptor: desc, parent, child, active: true });
    child.parent = parent;
  }

  private createJoint(parent: Part, child: Part, desc: RAPIER.JointData, bounds: AngularLimits, hinge: boolean) {
    const joint = this.world.createImpulseJoint(desc, parent.body, child.body, true);
    joint.setContactsEnabled(false);
    if (hinge) (joint as RAPIER.RevoluteImpulseJoint).setLimits(bounds[0][0], bounds[0][1]);
    else {
      // Rapier 0.19 exposes multi-axis limits on its typed raw joint set, but
      // not on SphericalImpulseJoint. Isolate that version-specific bridge here.
      for (const [i, axis] of ([3, 4, 5] as const).entries()) this.world.impulseJoints.raw.jointSetLimits(joint.handle, axis, bounds[i][0], bounds[i][1]);
    }
    return joint;
  }

  /** Choose only an endpoint of the limb that was actually hit. */
  closestLimbJoint(partName: string, point: Vector3): string | null {
    if (this.disabledParts.has(partName) || !/^(left|right) (upper arm|forearm|hand|thigh|shin|foot)$/.test(partName)) return null;
    let selected: string | null = null, distance = Infinity;
    for (const connection of this.jointLimits) {
      if (!connection.active || this.disabledParts.has(connection.name) || !/(upper arm|forearm|hand|thigh|shin|foot)$/.test(connection.name)) continue;
      if (connection.child.name !== partName && connection.parent.name !== partName) continue;
      const anchor = vec(connection.joint.anchor2()).applyQuaternion(new Quaternion().copy(connection.child.body.rotation())).add(vec(connection.child.body.translation()));
      const next = anchor.distanceToSquared(point);
      if (next < distance) { selected = connection.name; distance = next; }
    }
    return selected;
  }

  /** The severed branch keeps its downstream joints and physical momentum. */
  detach(partName: string): SeveredJoint | null {
    if (!this.options.combat || this.disabledParts.has(partName)) return null;
    const connection = this.jointLimits.find(j => j.name === partName && j.active);
    if (!connection) return null;
    const wound: SeveredJoint = { part: partName, parent: connection.parent.name, parentAnchor: vec(connection.joint.anchor1()), childAnchor: vec(connection.joint.anchor2()), parts: [] };
    for (const part of this.parts.values()) {
      let ancestor: Part | undefined = part;
      while (ancestor && ancestor !== connection.child) ancestor = ancestor.parent;
      if (!ancestor) continue;
      wound.parts.push(part.name); this.disabledParts.add(part.name);
      part.body.resetForces(false); part.body.resetTorques(false); part.body.wakeUp();
    }
    this.world.removeImpulseJoint(connection.joint, true); connection.active = false;
    return wound;
  }

  private build() {
    const p = this.computePose();
    const pelvis = this.addPart('pelvis', p.hip.clone().add(vec([-.13, 0, 0])), p.hip.clone().add(vec([.13, 0, 0])), .078, 3, 'capsule', new Quaternion(), new Quaternion().setFromAxisAngle(vec([0, 0, 1]), -Math.PI / 2));
    const spine = this.addPart('spine', p.hip, p.waist, .063, 2);
    const chest = this.addPart('chest', p.waist, p.chest, .068, 3);
    const head = this.addPart('head', p.head.clone().add(vec([0, -.01, 0])), p.head.clone().add(vec([0, .01, 0])), .225, 1.4, 'head');
    this.connect(pelvis, spine, p.hip, ANATOMY.spine); this.connect(spine, chest, p.waist, ANATOMY.spine); this.connect(chest, head, p.chest.clone().add(vec([0, .09, 0])), ANATOMY.neck);
    // A short shoulder bar is part of the chest rigid body.
    const bar = RAPIER.ColliderDesc.capsule(.18, this.options.combat ? .018 : .048).setRotation(new Quaternion().setFromAxisAngle(vec([0, 0, 1]), Math.PI / 2)).setTranslation(0, chest.length / 2, 0).setMass(.2).setCollisionGroups(this.options.collisionGroups ?? GROUP_RIG);
    this.colliderNames.set(this.world.createCollider(bar, chest.body).handle, 'chest');
    for (const side of ['left', 'right'] as const) {
      const arm = p[side].arm, leg = p[side].leg;
      const upperArm = this.addPart(`${side} upper arm`, p[side].shoulder, arm.middle, .052, .8, 'capsule', arm.upper, LIMB_VISUAL_ROTATION);
      const forearm = this.addPart(`${side} forearm`, arm.middle, arm.end, .048, .65, 'capsule', arm.lower, LIMB_VISUAL_ROTATION);
      this.connect(chest, upperArm, p[side].shoulder, ANATOMY.shoulder); this.connect(upperArm, forearm, arm.middle, [ANATOMY.elbow, [0, 0], [0, 0]], true);
      const handFrame = neutralHandRotation(this.handDrawingSide(side));
      const hand = this.addPart(`${side} hand`, p[side].palm, p[side].palm, .04, .36, 'hand', p[side].wrist, handFrame);
      this.connect(forearm, hand, arm.end, ANATOMY.wrist);
      const colliders: RAPIER.Collider[] = [];
      for (const finger of handPaths(0, this.handDrawingSide(side)).fingers) {
        for (let i = 1; i < finger.length; i++) {
          const tf = segmentTransform(finger[i - 1].clone().applyQuaternion(handFrame), finger[i].clone().applyQuaternion(handFrame));
          const collider = this.world.createCollider(RAPIER.ColliderDesc.capsule(tf.length / 2, this.options.combat ? .014 : .006).setTranslation(tf.position.x, tf.position.y, tf.position.z).setRotation(tf.rotation).setMass(0).setFriction(1.1).setRestitution(0).setCollisionGroups(this.options.combat ? 0 : GROUP_HAND).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), hand.body);
          colliders.push(collider); this.colliderNames.set(collider.handle, `${side} hand`);
        }
      }
      this.fingerColliders.set(side, colliders);
      const thigh = this.addPart(`${side} thigh`, p[side].hip, leg.middle, .061, 1.5, 'capsule', leg.upper, LIMB_VISUAL_ROTATION);
      const shin = this.addPart(`${side} shin`, leg.middle, leg.end, .054, 1.1, 'capsule', leg.lower, LIMB_VISUAL_ROTATION);
      const footPosition = leg.end.clone().add(vec([0, 0, .08]));
      const foot = this.addPart(`${side} foot`, footPosition.clone().add(vec([0, -.01, 0])), footPosition.clone().add(vec([0, .01, 0])), .06, .55, 'foot');
      this.connect(pelvis, thigh, p[side].hip, ANATOMY.hip); this.connect(thigh, shin, leg.middle, [ANATOMY.knee, [0, 0], [0, 0]], true); this.connect(shin, foot, leg.end, ANATOMY.ankle);
    }
  }

  private computePose() {
    const hip = this.hip.clone();
    const direction = vec([0, Math.cos(this.lean), Math.sin(this.lean)]);
    const waist = hip.clone().addScaledVector(direction, .245);
    const chest = waist.clone().addScaledVector(direction, .245);
    const head = chest.clone().add(vec([0, .32, .02]));
    const sidePose = (side: 'left' | 'right') => {
      // Combat faces +Z: the character's right is -X (the lab keeps its drawing frame).
      const sign = (side === 'left' ? -1 : 1) * (this.options.combat ? -1 : 1);
      const shoulder = chest.clone().add(vec([sign * .21, 0, 0]));
      const h = hip.clone().add(vec([sign * .12, 0, 0]));
      const chestRotation = new Quaternion().setFromAxisAngle(vec([1, 0, 0]), this.lean);
      const arm = solveLimb(shoulder, this.targets[`${side}Hand`], vec([sign * .35, -.65, -.6]), .36, .34, chestRotation, true);
      const leg = solveLimb(h, this.targets[`${side}Foot`], vec([sign * .1, 0, 1]), .51, .50, new Quaternion(), false);
      const wrist = wristRotation(arm.lower, this.handDrawingSide(side));
      const palm = arm.end.clone().sub(WRIST_ANCHOR.clone().applyQuaternion(wrist));
      this.resolvedTargets[`${side}Hand`].copy(arm.end);
      this.resolvedTargets[`${side}Foot`].copy(leg.end);
      return { shoulder, hip: h, arm, leg, wrist, palm };
    };
    return { hip, waist, chest, head, left: sidePose('left'), right: sidePose('right') };
  }

  private updateGoals(blend: number) {
    const definition = POSES[this.pose];
    this.hip.lerp(this.options.combat ? vec([0, this.stanceHeight, 0]) : vec(definition.hip), blend);
    this.lean += (definition.lean - this.lean) * blend;
    const p = this.computePose();
    const root = new Quaternion().setFromAxisAngle(vec([0, 1, 0]), this.heading);
    const assign = (name: string, a: Vector3, b: Vector3, rotation?: Quaternion) => {
      const part = this.parts.get(name)!;
      const tf = segmentTransform(a, b);
      tf.position.applyQuaternion(root).add(this.origin);
      part.goal.position.copy(tf.position);
      const desired = root.clone().multiply(rotation ?? tf.rotation);
      if (blend === 1) part.goal.rotation.copy(desired);
      else part.goal.rotation.rotateTowards(desired, Math.min(part.goal.rotation.angleTo(desired) * blend, (part.shape === 'hand' ? 3 : 5) * STEP));
    };
    assign('pelvis', p.hip.clone().add(vec([-.13, 0, 0])), p.hip.clone().add(vec([.13, 0, 0])), new Quaternion());
    assign('spine', p.hip, p.waist); assign('chest', p.waist, p.chest);
    assign('head', p.head, p.head, new Quaternion());
    for (const side of ['left', 'right'] as const) {
      const d = p[side];
      assign(`${side} upper arm`, d.shoulder, d.arm.middle, d.arm.upper);
      assign(`${side} forearm`, d.arm.middle, d.arm.end, d.arm.lower);
      assign(`${side} hand`, d.palm, d.palm, d.wrist);
      const desiredHandRotation = side === 'right' ? this.rightHandRotation : this.leftHandRotation;
      if (desiredHandRotation) {
        const hand = this.parts.get(`${side} hand`)!;
        const forearm = this.parts.get(`${side} forearm`)!;
        hand.goal.rotation.copy(boundedWorldRotation(forearm.goal.rotation, desiredHandRotation, ANATOMY.wrist));
      }
      assign(`${side} thigh`, d.hip, d.leg.middle, d.leg.upper);
      assign(`${side} shin`, d.leg.middle, d.leg.end, d.leg.lower);
      const f = d.leg.end.clone().add(vec([0, 0, .08]));
      assign(`${side} foot`, f, f, boundedWorldRotation(d.leg.lower, new Quaternion(), ANATOMY.ankle));
    }
    for (const limit of this.jointLimits) {
      const part = this.parts.get(limit.name)!;
      const parent = part.parent!.goal.rotation;
      if (limit.hinge) {
        const angle = jointCoordinates(parent.clone().invert().multiply(part.goal.rotation))[0];
        part.goal.rotation.copy(parent).multiply(new Quaternion().setFromAxisAngle(vec([1, 0, 0]), Math.max(limit.bounds[0][0], Math.min(limit.bounds[0][1], angle))));
      } else part.goal.rotation.copy(boundedWorldRotation(parent, part.goal.rotation, limit.bounds));
    }
  }

  setPose(pose: PoseName) {
    this.cancelCatch();
    this.pose = pose;
    const p = POSES[pose];
    (['left', 'right'] as const).forEach((s, i) => {
      this.targets[`${s}Hand`].copy(vec(p.hands[i]));
      this.targets[`${s}Foot`].copy(vec(p.feet[i]));
      if (this.options.combat) { this.targets[`${s}Hand`].x *= -1; this.targets[`${s}Foot`].x *= -1; }
    });
  }

  setTarget(name: TargetName, point: Vector3) {
    const v = point.clone();
    v.x = Math.max(-1.3, Math.min(1.3, v.x));
    v.z = Math.max(-.9, Math.min(1.1, v.z));
    v.y = name.endsWith('Foot') ? .068 : Math.max(.3, Math.min(2.3, v.y));
    // Clamp to the reachable sphere; an unreachable target cannot stretch a limb.
    const side = (name.startsWith('left') ? -1 : 1) * (this.options.combat ? -1 : 1);
    const origin = name.endsWith('Foot') ? this.hip.clone().add(vec([side * .12, 0, 0])) : this.hip.clone().add(vec([side * .21, .49 * Math.cos(this.lean), .49 * Math.sin(this.lean)]));
    const reach = name.endsWith('Foot') ? 1.009 : .699;
    if (name.endsWith('Foot')) {
      const maxHorizontal = Math.sqrt(Math.max(.01, reach * reach - (origin.y - .068) ** 2));
      const offset = v.clone().sub(origin); offset.y = 0;
      if (offset.length() > maxHorizontal) offset.setLength(maxHorizontal);
      v.x = origin.x + offset.x; v.z = origin.z + offset.z;
    } else {
      const offset = v.clone().sub(origin);
      if (offset.length() > reach) v.copy(origin).add(offset.setLength(reach));
    }
    this.targets[name].copy(v);
  }

  wristPoint(side: 'left' | 'right') {
    const hand = this.parts.get(`${side} hand`)!;
    return WRIST_ANCHOR.clone().applyQuaternion(new Quaternion().copy(hand.body.rotation())).add(vec(hand.body.translation()));
  }

  gripPoint() {
    const hand = this.parts.get('right hand')!;
    return PALM_GRIP.clone().applyQuaternion(hand.visualRotation).applyQuaternion(new Quaternion().copy(hand.body.rotation())).add(vec(hand.body.translation()));
  }

  startCatch() {
    if (this.ragdoll) return false;
    this.setPose('ready');
    this.setTarget('rightHand', vec([.46, 1.65, .35]));
    this.catchPhase = 'reaching'; this.phaseTime = 0;
    return true;
  }

  throwHeld(power = 8) {
    if (this.ragdoll || this.catchPhase !== 'holding' || !this.heldBall) return false;
    this.throwPower = Math.max(4, Math.min(12, power));
    this.catchPhase = 'windup'; this.phaseTime = 0;
    this.setTarget('rightHand', vec([.44, 1.61, .25]));
    return true;
  }

  private releaseGrip(throwBall = false) {
    if (this.gripJoint) this.world.removeImpulseJoint(this.gripJoint, true);
    this.gripJoint = null;
    const ball = this.heldBall; this.heldBall = null;
    if (ball) {
      // A short hand-only grace interval lets the opening fingers clear the ball.
      // All other collisions remain active, including the floor and forearm.
      ball.ignoreHandsUntil = this.time + .12;
      ball.body.collider(0).setCollisionGroups((4 << 16) | 7);
      if (throwBall) ball.body.applyImpulse(vec([0, .32, 1]).normalize().multiplyScalar(ball.body.mass() * this.throwPower), true);
    }
  }

  cancelCatch() {
    this.releaseGrip(); this.incomingBall = null; this.catchPhase = 'idle'; this.phaseTime = 0;
  }

  private catchContact(ball: Ball, name: string) {
    if (this.ragdoll || this.catchPhase !== 'incoming' || ball !== this.incomingBall || name !== 'right hand') return;
    const hand = this.parts.get('right hand')!.body;
    if (vec(ball.body.translation()).distanceTo(this.gripPoint()) > .18 || vec(ball.body.linvel()).sub(vec(hand.linvel())).length() > 7) return;
    const rotation = new Quaternion().copy(hand.rotation());
    this.gripAnchor.copy(vec(ball.body.translation()).sub(vec(hand.translation())).applyQuaternion(rotation.clone().invert()));
    const ballFrame = new Quaternion().copy(ball.body.rotation()).invert().multiply(rotation);
    this.gripJoint = this.world.createImpulseJoint(RAPIER.JointData.fixed(this.gripAnchor, new Quaternion(), vec([0, 0, 0]), ballFrame), hand, ball.body, true);
    this.gripJoint.setContactsEnabled(false);
    this.heldBall = ball; this.incomingBall = null; this.catchPhase = 'holding'; this.phaseTime = 0;
  }

  private updateInteraction() {
    this.phaseTime += STEP;
    if (this.ragdoll && this.catchPhase !== 'idle') this.cancelCatch();
    if (this.catchPhase === 'reaching' && this.phaseTime > 1.7) {
      const hand = this.parts.get('right hand')!;
      const palmRotation = new Quaternion().copy(hand.body.rotation()).multiply(hand.visualRotation);
      // Approach the palm side at the proximal fingers, leaving room for curled tips.
      const destination = vec([0, -.10, .006]).applyQuaternion(palmRotation).add(vec(hand.body.translation()));
      const origin = vec([0, 0, 1.8]).applyQuaternion(palmRotation).add(vec([.15, .18, 0])).add(destination);
      this.incomingBall = this.launchAt(destination, origin, 3.4);
      this.catchPhase = 'incoming'; this.phaseTime = 0;
    } else if (this.catchPhase === 'incoming' && this.phaseTime > 2.2) {
      this.incomingBall = null; this.catchPhase = 'missed'; this.phaseTime = 0;
    } else if (this.catchPhase === 'windup' && this.phaseTime > .4) {
      this.setTarget('rightHand', vec([.40, 1.45, .68]));
      this.catchPhase = 'throwing'; this.phaseTime = 0;
    } else if (this.catchPhase === 'throwing' && this.phaseTime > .2) {
      this.releaseGrip(true); this.catchPhase = 'released'; this.phaseTime = 0;
    }
    if (this.gripJoint) {
      this.gripAnchor.lerp(PALM_GRIP.clone().applyQuaternion(this.parts.get('right hand')!.visualRotation), 1 - Math.exp(-10 * STEP));
      this.gripJoint.setAnchor1(this.gripAnchor);
    }
    for (const side of ['left', 'right'] as const) {
      if (this.options.combat) continue;
      const closed = side === 'right' && (this.catchPhase === 'holding' || this.catchPhase === 'windup');
      const next = this.fingerCurl[side] + ((closed ? 1 : 0) - this.fingerCurl[side]) * (1 - Math.exp(-13 * STEP));
      if (Math.abs(next - this.fingerCurl[side]) < 1e-6) continue;
      this.fingerCurl[side] = next;
      const colliders = this.fingerColliders.get(side)!;
      const handFrame = this.parts.get(`${side} hand`)!.visualRotation;
      let index = 0;
      for (const finger of handPaths(next, side).fingers) {
        for (let i = 1; i < finger.length; i++) {
          const tf = segmentTransform(finger[i - 1].clone().applyQuaternion(handFrame), finger[i].clone().applyQuaternion(handFrame));
          const collider = colliders[index++]; collider.setTranslationWrtParent(tf.position); collider.setRotationWrtParent(tf.rotation); collider.setHalfHeight(tf.length / 2);
        }
      }
    }
    for (const ball of this.balls) if (ball.ignoreHandsUntil && this.time >= ball.ignoreHandsUntil) {
      ball.body.collider(0).setCollisionGroups(GROUP_BALL); ball.ignoreHandsUntil = undefined;
    }
  }

  /** Expose the drawn digits as contact surfaces while gripping a ledge. */
  setCombatGrip(side: 'left' | 'right', closed: boolean, exposed: boolean) {
    if (!this.options.combat) return;
    const key = `${closed}:${exposed}`; if (this.combatGrips.get(side) === key) return;
    this.combatGrips.set(side, key);
    const hand = this.parts.get(`${side} hand`)!, colliders = this.fingerColliders.get(side)!;
    const drawingSide = this.handDrawingSide(side);
    const paths = closed ? handlePaths(drawingSide) : handPaths(.12, drawingSide); let index = 0;
    for (const finger of paths.fingers) for (let i = 1; i < finger.length; i++) {
      const tf = segmentTransform(finger[i - 1].clone().applyQuaternion(hand.visualRotation), finger[i].clone().applyQuaternion(hand.visualRotation));
      const collider = colliders[index++]; collider.setTranslationWrtParent(tf.position); collider.setRotationWrtParent(tf.rotation); collider.setHalfHeight(tf.length / 2);
      // Weapon contacts only: the ledge constraint itself supports the gripping fingers.
      collider.setCollisionGroups(exposed ? (this.options.collisionGroups! & 0xffff0000) | 8 : 0);
    }
  }

  spawnBall(position: Vector3, velocity = new Vector3(), radius = .145) {
    if (this.balls.length >= 24) this.removeBall(this.balls[0]);
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(position.x, position.y, position.z).setLinvel(velocity.x, velocity.y, velocity.z).setLinearDamping(.08).setAngularDamping(.12).setCcdEnabled(true));
    body.setAngvel({ x: velocity.z * .5, y: 1, z: -velocity.x * .5 }, true);
    const collider = this.world.createCollider(RAPIER.ColliderDesc.ball(radius).setMass(.72).setRestitution(.78).setFriction(.6).setCollisionGroups(GROUP_BALL).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
    const ball = { id: ++this.ballId, body, radius, born: this.time };
    this.balls.push(ball); this.colliderBalls.set(collider.handle, ball);
    return ball;
  }

  launchAt(target: Vector3, origin = target.clone().add(vec([0, .2, 3])), speed = 11) {
    const distance = origin.distanceTo(target);
    const travelTime = distance / speed;
    const velocity = target.clone().sub(origin).divideScalar(travelTime);
    velocity.y += 4.905 * travelTime;
    return this.spawnBall(origin, velocity);
  }

  hitArm() {
    const arm = this.parts.get('right forearm')!;
    const target = vec(arm.body.translation());
    return this.launchAt(target, target.clone().add(vec([.7, .12, 2.7])), 11);
  }

  removeBall(ball: Ball) {
    if (ball === this.heldBall || ball === this.incomingBall) this.cancelCatch();
    this.colliderBalls.delete(ball.body.collider(0).handle);
    this.world.removeRigidBody(ball.body);
    this.balls = this.balls.filter(b => b !== ball);
  }

  prepareStep() {
    this.time += STEP;
    this.updateInteraction();
    this.updateGoals(1 - Math.exp(-8 * STEP));
    for (const part of this.parts.values()) {
      const body = part.body;
      body.resetForces(false); body.resetTorques(false);
      if (this.ragdoll || this.disabledParts.has(part.name)) continue;
      const limbStrength = this.partMuscleScale.get(part.name) ?? 1;
      const strength = Math.max(.04, this.strength);
      const isCore = ['pelvis', 'spine', 'chest'].includes(part.name);
      const isFoot = part.shape === 'foot';
      // Assisted balance: physical springs hold pelvis/feet near stance targets.
      // Arms receive torque only, so a hit can move them through their joints.
      if (part.name === 'pelvis' || (isFoot && this.footSupport[part.name.startsWith('left') ? 'left' : 'right'])) {
        const frequency = (part.name === 'pelvis' ? 11 : 16) * Math.sqrt(this.support);
        const mass = body.mass();
        const force = part.goal.position.clone().sub(vec(body.translation())).multiplyScalar(frequency ** 2 * mass).addScaledVector(vec(body.linvel()), -2 * .9 * frequency * mass);
        if (part.name === 'pelvis') {
          let supportedMass = 19.16;
          for (const name of this.disabledParts) supportedMass -= this.parts.get(name)!.body.mass();
          force.y += supportedMass * 9.81 * this.support;
        }
        force.clampLength(0, isFoot ? 240 : 700);
        body.addForce(force, true);
      }
      const delta = part.goal.rotation.clone().multiply(new Quaternion().copy(body.rotation()).invert());
      if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
      const axis = new Vector3(delta.x, delta.y, delta.z);
      const sin = axis.length();
      const angle = 2 * Math.atan2(sin, Math.max(0, delta.w));
      if (sin > 1e-6) axis.multiplyScalar(angle / sin); else axis.set(0, 0, 0);
      const freq = (isCore ? 44 : isFoot ? 24 : (14 + strength * 44) * (part.name.includes('forearm') ? 1.08 : 1)) * Math.sqrt(this.muscleScale * limbStrength);
      const inertia = body.principalInertia();
      // Apply the full inertia tensor. A capsule's axial inertia is much smaller
      // than its bending inertia; one scalar destabilizes twist damping.
      const inertiaFrame = new Quaternion().copy(body.rotation()).multiply(new Quaternion().copy(body.principalInertiaLocalFrame()));
      const acceleration = axis.multiplyScalar(freq * freq).addScaledVector(vec(body.angvel()), -2 * .95 * freq);
      const torque = acceleration.clone().applyQuaternion(inertiaFrame.clone().invert()).multiply(vec(inertia)).applyQuaternion(inertiaFrame);
      if (part.shape === 'hand') {
        const lever = WRIST_ANCHOR.clone().negate().applyQuaternion(new Quaternion().copy(body.rotation()));
        torque.add(lever.cross(vec([0, body.mass() * 9.81, 0])));
        if (part.name === 'right hand' && this.heldBall) {
          const mass = this.heldBall.body.mass();
          const offset = vec(this.heldBall.body.translation()).sub(vec(body.worldCom()));
          // Include the held ball's inertia and gravity in the wrist controller.
          torque.addScaledVector(acceleration, .4 * mass * this.heldBall.radius ** 2);
          torque.addScaledVector(offset.clone().cross(acceleration.clone().cross(offset)), mass);
          torque.add(offset.cross(vec([0, mass * 9.81, 0])));
        }
      }
      torque.clampLength(0, (isCore ? 45 : 9) * limbStrength);
      body.addTorque(torque, true);
    }
  }

  step() {
    this.prepareStep();
    this.world.step(this.events);
    this.events.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const ball = this.colliderBalls.get(h1) ?? this.colliderBalls.get(h2);
      const name = this.colliderNames.get(h1) ?? this.colliderNames.get(h2);
      if (!ball || !name) return;
      this.catchContact(ball, name);
      const key = `${ball.id}-${name}`;
      if (this.time - (this.lastHitAt.get(key) ?? -10) < .25) return;
      this.lastHitAt.set(key, this.time); this.hits++;
      this.onHit?.({ name, position: vec(ball.body.translation()), speed: vec(ball.body.linvel()).length() });
    });
    for (const ball of this.balls) {
      const p = ball.body.translation();
      if (p.y < -8 || Math.abs(p.x) > 18 || Math.abs(p.z) > 18 || this.time - ball.born > 60) this.removeBall(ball);
    }
  }

  reset(preserveTargets = false) {
    this.cancelCatch();
    this.disabledParts.clear(); this.partMuscleScale.clear();
    this.ragdoll = false; if (!preserveTargets) this.setPose('ready'); this.hip.copy(vec(POSES.ready.hip)); this.lean = POSES.ready.lean;
    this.footSupport.left = this.footSupport.right = true;
    this.updateGoals(1);
    for (const part of this.parts.values()) {
      part.body.setTranslation(part.goal.position, true); part.body.setRotation(part.goal.rotation, true);
      part.body.setLinvel({ x: 0, y: 0, z: 0 }, true); part.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      part.body.resetForces(false); part.body.resetTorques(false);
    }
    for (const connection of this.jointLimits) if (!connection.active) {
      connection.joint = this.createJoint(connection.parent, connection.child, connection.descriptor, connection.bounds, connection.hinge); connection.active = true;
    }
    for (const ball of this.balls) this.removeBall(ball);
    this.hits = 0; this.lastHitAt.clear();
  }

  diagnostics() {
    let maxJointError = 0;
    this.world.impulseJoints.forEach(joint => {
      const a = vec(joint.anchor1()).applyQuaternion(new Quaternion().copy(joint.body1().rotation())).add(vec(joint.body1().translation()));
      const b = vec(joint.anchor2()).applyQuaternion(new Quaternion().copy(joint.body2().rotation())).add(vec(joint.body2().translation()));
      maxJointError = Math.max(maxJointError, a.distanceTo(b));
    });
    const joints = this.jointLimits.filter(j => j.active).map(({ name, joint, bounds, hinge }) => {
      const relative = new Quaternion().copy(joint.body1().rotation()).invert().multiply(new Quaternion().copy(joint.body2().rotation()));
      const angles = jointCoordinates(relative);
      const violation = Math.max(...angles.map((v, i) => Math.max(bounds[i][0] - v, v - bounds[i][1], 0)));
      return { name, angles, bounds, hinge, violation };
    });
    return { maxJointError, maxAngularViolation: Math.max(...joints.map(j => j.violation)), joints, hits: this.hits, pelvisHeight: this.parts.get('pelvis')!.body.translation().y, ballCount: this.balls.length, catchPhase: this.catchPhase, heldBallId: this.heldBall?.id ?? null };
  }

  dispose() {
    if (!this.options.events) this.events.free();
    if (!this.options.world) this.world.free();
  }
}
