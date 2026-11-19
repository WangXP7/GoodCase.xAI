import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { RigSimulation, initPhysics } from '../lib/rig/physics';
import { solveTwoBone, vec } from '../lib/rig/ik';
import { ANATOMY, jointCoordinates, solveLimb } from '../lib/rig/anatomy';
import { handPaths, HAND_HUB, neutralHandRotation, PALM_GRIP } from '../lib/rig/hand';

await initPhysics();
const steps = (sim: RigSimulation, count: number) => { for (let i = 0; i < count; i++) sim.step(); };
const untilPhase = (sim: RigSimulation, phase: RigSimulation['catchPhase'], maxSteps: number) => {
  for (let i = 0; i < maxSteps && sim.catchPhase !== phase; i++) sim.step();
};
const hand = (sim: RigSimulation) => sim.wristPoint('right');

await test('IK preserves both bone lengths at normal, unreachable, coincident, and collinear targets', () => {
  const start = vec([.2, 1.5, 0]);
  for (const target of [vec([.5, 1.1, .3]), vec([5, 8, 4]), start.clone(), vec([.2, 1.1, 0])]) {
    for (const pole of [vec([0, -1, 0]), vec([1, 0, 0])]) {
      const result = solveTwoBone(start, target, pole, .36, .34);
      assert.ok(Math.abs(result.middle.distanceTo(start) - .36) < 1e-6);
      assert.ok(Math.abs(result.middle.distanceTo(result.end) - .34) < 1e-6);
      assert.ok(result.end.distanceTo(start) <= .7);
      assert.ok(result.end.toArray().every(Number.isFinite));
    }
  }
});

await test('all supported poses maintain stable physical joints and floor contact', () => {
  const sim = new RigSimulation();
  try {
    assert.equal(sim.parts.size, 16);
    for (const pose of ['ready', 'guard', 'reach'] as const) {
      sim.setPose(pose); steps(sim, 900);
      const d = sim.diagnostics();
      assert.ok(d.maxJointError < .015, `${pose}: joint drift ${d.maxJointError}`);
      assert.ok(d.maxAngularViolation < .025, `${pose}: angular violation ${d.maxAngularViolation}`);
      assert.ok(d.pelvisHeight > .75 && d.pelvisHeight < 1.2);
      for (const part of sim.parts.values()) {
        const p = part.body.translation();
        assert.ok([p.x, p.y, p.z].every(Number.isFinite));
        assert.ok(part.body.isDynamic(), `${part.name} must respond to physics`);
      }
      for (const side of ['left', 'right']) assert.ok(sim.parts.get(`${side} foot`)!.body.translation().y >= .035);
    }
  } finally { sim.dispose(); }
});

await test('anatomical IK shares a hinge axis and respects reach, bend, and shoulder limits', () => {
  const start = vec([.21, 1.53, 0]);
  for (const target of [vec([.5, 1.6, .4]), start.clone(), vec([8, 5, -3]), vec([.21, .3, 0])]) {
    const pose = solveLimb(start, target, vec([.35, -.65, -.6]), .36, .34, new Quaternion(), true);
    assert.ok(Math.abs(pose.middle.distanceTo(start) - .36) < 1e-6);
    assert.ok(Math.abs(pose.end.distanceTo(pose.middle) - .34) < 1e-6);
    const elbow = jointCoordinates(pose.upper.clone().invert().multiply(pose.lower));
    assert.ok(elbow[0] >= ANATOMY.elbow[0] - 1e-6 && elbow[0] <= ANATOMY.elbow[1] + 1e-6);
    assert.ok(Math.abs(elbow[1]) + Math.abs(elbow[2]) < 1e-6);
    jointCoordinates(pose.upper).forEach((v, i) => assert.ok(v >= ANATOMY.shoulder[i][0] - 1e-6 && v <= ANATOMY.shoulder[i][1] + 1e-6));
  }
});

await test('two-link digits share a hub, retain their lengths, and mirror with forward-facing thumbs', () => {
  const open = handPaths(0, 'right');
  const restingBends = open.fingers.map(finger => {
    const base = finger[1].clone().sub(finger[0]);
    const tip = finger[2].clone().sub(finger[1]);
    const bend = base.angleTo(tip);
    assert.ok(bend > .15 && bend < .65, 'each open digit has a gentle knuckle bend');
    assert.ok(tip.z / tip.length() > base.z / base.length(), 'resting tips curl toward the palm');
    return bend;
  });
  assert.ok(restingBends[0] > restingBends[1] && restingBends[1] > restingBends[2], 'little finger is more relaxed than index');
  const lengths = open.fingers.map(finger => finger[0].distanceTo(finger[1]) + finger[1].distanceTo(finger[2]));
  assert.ok(lengths[1] > lengths[2] && lengths[2] > lengths[0] && lengths[0] > lengths[3], 'middle stays longest and thumb shortest');
  for (const curl of [0, .25, .5, .75, 1]) {
    const paths = handPaths(curl, 'right'), mirrored = handPaths(curl, 'left');
    assert.equal(paths.fingers.length, 4);
    assert.equal(paths.stem.length, 2, 'one wrist stroke replaces the palm polygon');
    paths.fingers.forEach((finger, i) => {
      assert.equal(finger.length, 3, 'two links per digit');
      if (i < 3) assert.ok(finger[0].distanceTo(HAND_HUB) < 1e-9, 'three fingers share a root');
    });
    paths.fingers.forEach((finger, f) => finger.forEach((point, i) => {
      assert.ok(point.toArray().every(Number.isFinite));
      assert.ok(point.clone().multiply(vec([-1, 1, 1])).distanceTo(mirrored.fingers[f][i]) < 1e-9);
      if (i) assert.ok(Math.abs(point.distanceTo(finger[i - 1]) - open.fingers[f][i].distanceTo(open.fingers[f][i - 1])) < 1e-9);
    }));
  }
  for (const side of ['left', 'right'] as const) {
    const thumb = handPaths(0, side).fingers[3];
    const direction = thumb[2].clone().sub(thumb[0]).applyQuaternion(neutralHandRotation(side));
    assert.ok(direction.z > .08, `${side} thumb must face forward in a neutral arm, not backward`);
  }
  assert.ok(handPaths(1, 'right').fingers[3][2].z > .05, 'thumb opposes the other digits around the ball');
  for (const finger of handPaths(1, 'right').fingers) {
    for (let i = 1; i < finger.length; i++) {
      const edge = finger[i].clone().sub(finger[i - 1]);
      const t = Math.max(0, Math.min(1, PALM_GRIP.clone().sub(finger[i - 1]).dot(edge) / edge.lengthSq()));
      const closest = finger[i - 1].clone().addScaledVector(edge, t);
      assert.ok(closest.distanceTo(PALM_GRIP) > .151, 'closed digits should clear both the ball and the stroke radius');
    }
  }
});

await test('physical elbow, knee, shoulder, and wrist limits survive impulses with muscles disabled', () => {
  const sim = new RigSimulation();
  try {
    steps(sim, 300); sim.ragdoll = true;
    for (const name of ['right forearm', 'left shin', 'right upper arm', 'left hand']) {
      const body = sim.parts.get(name)!.body;
      body.applyTorqueImpulse(vec([.1, .08, -.08]).applyQuaternion(new Quaternion().copy(body.rotation())), true);
    }
    let maxError = 0;
    for (let i = 0; i < 600; i++) { sim.step(); maxError = Math.max(maxError, sim.diagnostics().maxAngularViolation); }
    assert.ok(maxError < .12, `joint limit overshoot ${maxError} radians`);
    assert.ok(sim.diagnostics().maxAngularViolation < .025);
    assert.ok(sim.diagnostics().pelvisHeight < .3);
    assert.equal(sim.diagnostics().joints.filter(j => j.hinge).length, 4);
  } finally { sim.dispose(); }
});

await test('repeated contact-gated catches hold, curl, and release a free physical ball', () => {
  const sim = new RigSimulation();
  try {
    steps(sim, 600);
    for (let trial = 0; trial < 3; trial++) {
      const hitsBefore = sim.hits;
      assert.equal(sim.startCatch(), true);
      let last = new Quaternion().copy(sim.parts.get('right hand')!.body.rotation());
      let maxTurn = 0;
      for (let i = 0; i < 600 && sim.catchPhase !== 'holding'; i++) {
        sim.step();
        const rotation = new Quaternion().copy(sim.parts.get('right hand')!.body.rotation());
        maxTurn = Math.max(maxTurn, last.angleTo(rotation)); last = rotation;
      }
      assert.equal(sim.catchPhase, 'holding');
      assert.ok(sim.hits > hitsBefore, 'a physical hand contact must precede capture');
      assert.ok(maxTurn < .18, `wrist turned ${maxTurn} radians in one step`);
      const ball = sim.heldBall!;
      assert.ok(ball.body.isDynamic());
      assert.equal(sim.world.impulseJoints.len(), 16, 'one temporary grip added to 15 anatomical joints');
      steps(sim, 360);
      assert.ok(sim.fingerCurl.right > .99);
      assert.ok(vec(ball.body.translation()).distanceTo(sim.gripPoint()) < .015);
      assert.ok(sim.diagnostics().maxAngularViolation < .04);
      assert.equal(sim.throwHeld(), true);
      untilPhase(sim, 'released', 150);
      assert.equal(sim.catchPhase, 'released');
      assert.equal(sim.heldBall, null);
      assert.equal(sim.world.impulseJoints.len(), 15);
      assert.ok(ball.body.linvel().z > 4);
      const releasePosition = vec(ball.body.translation());
      steps(sim, 90);
      assert.ok(vec(ball.body.translation()).distanceTo(releasePosition) > 1.5);
      assert.ok(sim.fingerCurl.right < .01);
      assert.equal(ball.body.collider(0).collisionGroups(), (4 << 16) | 15, 'hand contacts must return after release');
      for (const b of sim.balls) sim.removeBall(b);
      steps(sim, 180);
    }
  } finally { sim.dispose(); }
});

await test('a missed pass never attaches, and ragdoll/reset clean up an existing grip', () => {
  const sim = new RigSimulation();
  try {
    steps(sim, 600); sim.startCatch();
    while (sim.catchPhase === 'reaching') sim.step();
    const missed = sim.balls[0];
    missed.body.setTranslation(vec([3, 2, 2]), true); missed.body.setLinvel(vec([0, 0, 0]), true);
    steps(sim, 300);
    assert.equal(sim.catchPhase, 'missed'); assert.equal(sim.heldBall, null);
    assert.equal(sim.throwHeld(), false);
    assert.equal(sim.world.impulseJoints.len(), 15);
    sim.startCatch();
    untilPhase(sim, 'holding', 600);
    assert.equal(sim.catchPhase, 'holding');
    sim.ragdoll = true; sim.step();
    assert.equal(sim.heldBall, null); assert.equal(sim.world.impulseJoints.len(), 15);
    assert.equal(sim.startCatch(), false);
    sim.reset(); steps(sim, 600);
    assert.equal(sim.catchPhase, 'idle'); assert.equal(sim.balls.length, 0);
    assert.ok(sim.fingerCurl.right < .001);
  } finally { sim.dispose(); }
});

await test('a real ball collision moves the forearm, then muscles recover its pose', () => {
  const sim = new RigSimulation();
  try {
    steps(sim, 600);
    const arm = sim.parts.get('right forearm')!, before = vec(arm.body.translation());
    sim.hitArm(); let displacement = 0;
    for (let i = 0; i < 240; i++) { sim.step(); displacement = Math.max(displacement, vec(arm.body.translation()).distanceTo(before)); }
    assert.ok(sim.hits > 0, 'projectile must actually collide');
    assert.ok(displacement > .15, `impact displacement only ${displacement}`);
    for (const ball of sim.balls) sim.removeBall(ball);
    steps(sim, 900);
    assert.ok(vec(arm.body.translation()).distanceTo(before) < .04, 'arm should recover after impact');
    assert.ok(sim.diagnostics().maxJointError < .015);
  } finally { sim.dispose(); }
});

await test('dragging hand and foot targets changes the physical pose without stretching the rig', () => {
  const sim = new RigSimulation();
  try {
    steps(sim, 600); const before = hand(sim);
    sim.setTarget('rightHand', vec([.55, 1.6, .48]));
    sim.setTarget('leftFoot', vec([-8, 5, 4]));
    assert.equal(sim.targets.leftFoot.y, .068);
    assert.ok(sim.targets.leftFoot.distanceTo(vec([-.12, 1.04, 0])) < 1.011);
    steps(sim, 900);
    assert.ok(hand(sim).distanceTo(before) > .25);
    assert.ok(hand(sim).distanceTo(sim.targets.rightHand) < .16, 'physical hand should follow its IK target');
    assert.ok(sim.diagnostics().maxJointError < .015);
  } finally { sim.dispose(); }
});

await test('balls bounce, the pool remains bounded, and ragdoll/reset change physical behavior', () => {
  const sim = new RigSimulation();
  try {
    const ball = sim.spawnBall(vec([2, 2, 0])); let bounced = false;
    for (let i = 0; i < 240; i++) { sim.step(); if (ball.body.linvel().y > 1) bounced = true; }
    assert.ok(bounced, 'ball must bounce off the floor');
    for (let i = 0; i < 35; i++) sim.spawnBall(vec([2, 3 + i * .31, 0]), new Vector3());
    assert.equal(sim.balls.length, 24);
    sim.ragdoll = true; steps(sim, 600);
    assert.ok(sim.diagnostics().pelvisHeight < .3, 'ragdoll must fall without balance assistance');
    sim.reset(); steps(sim, 600);
    assert.equal(sim.balls.length, 0); assert.equal(sim.hits, 0); assert.equal(sim.ragdoll, false);
    assert.ok(sim.diagnostics().pelvisHeight > .95);
  } finally { sim.dispose(); }
});
