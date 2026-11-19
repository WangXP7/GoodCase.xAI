import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { DuelSimulation, initPhysics, GRIP, WEAPON_CENTER } from '../lib/duel/physics';
import { handPaths, handlePaths } from '../lib/rig/hand';
import { vec } from '../lib/rig/ik';

await initPhysics();
const steps = (sim: DuelSimulation, count: number) => { for (let i = 0; i < count; i++) sim.step(); };

await test('both fighters and swords share one stable physical world; resting contact causes no damage', () => {
  const sim = new DuelSimulation();
  try {
    assert.equal(sim.world.bodies.len(), 35); assert.ok(sim.platform.isFixed()); assert.equal(sim.world.impulseJoints.len(), 32);
    sim.practice = true; sim.start(); sim.input.guard = true;
    steps(sim, 1800);
    for (const f of sim.fighters) {
      assert.equal(f.rig.world, sim.world); assert.equal(f.hp, 100);
      assert.ok(f.sword.isDynamic());
      const d = f.rig.diagnostics();
      assert.ok(d.maxJointError < .01); assert.ok(d.maxAngularViolation < .025);
      assert.ok(d.pelvisHeight > .8 && d.pelvisHeight < 1.1);
      for (const part of f.rig.parts.values()) assert.ok(part.body.isDynamic());
    }
    assert.equal(sim.hits, 0);
  } finally { sim.dispose(); }
});

await test('moving and circling drive physical bodies through alternating planted footsteps', () => {
  const sim = new DuelSimulation();
  try {
    const player = sim.fighters[0];
    const start = vec(player.rig.parts.get('pelvis')!.body.translation());
    sim.input.move.set(.4, .65);
    const lifted = new Set<number>();
    for (let i = 0; i < 240; i++) {
      sim.step(); player.feet.forEach((p, side) => { if (p.y > .10) lifted.add(side); });
    }
    sim.clearInput(); steps(sim, 180);
    assert.equal(lifted.size, 2, 'both feet must take steps');
    assert.ok(vec(player.rig.parts.get('pelvis')!.body.translation()).distanceTo(start) > .65);
    const planted = player.feet.map(p => p.clone()); steps(sim, 120);
    player.feet.forEach((p, i) => assert.ok(p.distanceTo(planted[i]) < .03, 'feet should stay planted after movement stops'));
    assert.ok(player.rig.diagnostics().maxJointError < .01);
    assert.ok(player.rig.diagnostics().maxAngularViolation < .03);
  } finally { sim.dispose(); }
});

await test('weapon steering changes the dynamic blade while its grip stays attached to the wrist', () => {
  const sim = new DuelSimulation();
  try {
    const f = sim.fighters[0], rotation = new Quaternion().copy(f.sword.rotation());
    sim.input.attack = true; sim.input.aim.set(-1, .8); steps(sim, 120);
    assert.ok(rotation.angleTo(new Quaternion().copy(f.sword.rotation())) > .3);
    const hand = f.rig.parts.get('right hand')!.body;
    const handAnchor = GRIP.clone().applyQuaternion(new Quaternion().copy(hand.rotation())).add(vec(hand.translation()));
    const swordAnchor = vec([0, -WEAPON_CENTER, 0]).applyQuaternion(new Quaternion().copy(f.sword.rotation())).add(vec(f.sword.translation()));
    assert.ok(handAnchor.distanceTo(swordAnchor) < .01);
    assert.equal(f.hp, 100, 'a fighter must not hit their own body');
    assert.ok(f.rig.diagnostics().maxAngularViolation < .03);
    for (const side of ['left', 'right'] as const) {
      const open = handPaths(0, side), held = handlePaths(side);
      held.fingers.forEach((finger, i) => {
        assert.equal(finger.length, 3);
        for (let j = 1; j < 3; j++) assert.ok(Math.abs(finger[j].distanceTo(finger[j - 1]) - open.fingers[i][j].distanceTo(open.fingers[i][j - 1])) < 1e-8);
      });
    }
  } finally { sim.dispose(); }
});

await test('a physical guard clashes with incoming blades and reduces damage compared with standing open', () => {
  const results: { hp: number; blocks: number; hits: number }[] = [];
  for (const guard of [false, true]) {
    const sim = new DuelSimulation();
    try {
      sim.start(); sim.input.guard = guard;
      // Compare equal exposure: decisive injuries can now finish both longer trials.
      for (let i = 0; i < 480 && sim.phase !== 'finished'; i++) sim.step();
      results.push({ hp: sim.fighters[0].hp, blocks: sim.blocks, hits: sim.hits });
    } finally { sim.dispose(); }
  }
  assert.ok(results[0].hits > 0, 'the opponent must land actual contacts');
  assert.ok(results[1].blocks > 0, 'guard must intercept the physical blade');
  assert.ok(results[1].hp > results[0].hp + 20, 'guarding should make a meaningful difference');
});

await test('a landed strike can win a bout; the defeated fighter drops the sword and falls; rematches restore all joints', () => {
  const sim = new DuelSimulation();
  try {
    sim.fighters[1].hp = 4; sim.start();
    for (let i = 0; i < 3600 && sim.phase !== 'finished'; i++) {
      sim.input.move.y = i < 120 ? .75 : 0;
      if (i % 100 === 0) sim.slash();
      sim.step();
    }
    assert.equal(sim.phase, 'finished'); assert.equal(sim.winner, 0);
    assert.ok(sim.hits > 0); assert.equal(sim.fighters[1].grip, null);
    assert.equal(sim.world.impulseJoints.len(), 31);
    steps(sim, 360);
    assert.ok(sim.fighters[1].rig.parts.get('pelvis')!.body.translation().y < .25);
    assert.ok(sim.fighters[1].sword.isDynamic());
    for (let trial = 0; trial < 3; trial++) {
      sim.reset(); assert.equal(sim.phase, 'ready'); assert.equal(sim.winner, null);
      assert.equal(sim.world.bodies.len(), 35); assert.equal(sim.world.impulseJoints.len(), 32);
      assert.equal(sim.hits, 0); assert.equal(sim.blocks, 0);
      assert.ok(sim.fighters.every(f => f.hp === 100 && f.grip && !f.down));
      steps(sim, 120);
    }
    assert.ok(sim.fighters.every(f => new Vector3().copy(f.sword.translation()).toArray().every(Number.isFinite)));
  } finally { sim.dispose(); }
});

await test('combat right hands are anatomically right, hold the blade, and stay right after a reset', () => {
  const sim = new DuelSimulation();
  try {
    for (let repeat = 0; repeat < 2; repeat++) {
      for (const f of sim.fighters) {
        const forward = vec([0, 0, 1]).applyAxisAngle(vec([0, 1, 0]), f.heading);
        const right = forward.clone().cross(vec([0, 1, 0]));
        const shoulder = vec(f.rig.parts.get('right upper arm')!.body.translation());
        const other = vec(f.rig.parts.get('left upper arm')!.body.translation());
        assert.ok(shoulder.sub(other).dot(right) > .1, 'right arm must sit on the character’s right');
        assert.equal(f.mainHand, 'right');
        assert.equal(f.grip!.body1().handle, f.rig.parts.get('right hand')!.body.handle);
      }
      sim.reset();
    }
  } finally { sim.dispose(); }
});
