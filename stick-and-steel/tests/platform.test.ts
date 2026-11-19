import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Scene, Vector3 } from 'three';
import { DuelSimulation, initPhysics, type DuelHit } from '../lib/duel/physics';
import { WEAPONS, gripAnchor, handlePoint } from '../lib/duel/weapons';
import { onPlatform } from '../lib/duel/arena';
import { evaluateStrike, knocksDown } from '../lib/duel/damage';
import { createWeaponViews } from '../lib/duel/weapon-view';

await initPhysics();
const steps = (sim: DuelSimulation, count: number) => { for (let i = 0; i < count; i++) sim.step(); };

await test('all three weapons drop freely and are physically reached, picked up, and rendered at their body transforms', () => {
  for (const kind of ['sword', 'mace', 'greatsword'] as const) {
    const sim = new DuelSimulation({ playerWeapon: kind }), scene = new Scene(), views = createWeaponViews(scene);
    try {
      sim.practice = true; sim.start();
      const f = sim.fighters[0], item = f.weapon;
      if (kind === 'greatsword') assert.ok(f.supportGrip, 'the long handle must have a real second joint');
      const before = new Vector3().copy(item.body.translation()); sim.drop();
      assert.equal(f.grip, null); assert.equal(f.supportGrip, null); assert.equal(item.holder, null);
      assert.ok(new Vector3().copy(item.body.translation()).distanceTo(before) < 1e-8, 'dropping must preserve the body transform');
      steps(sim, 120); assert.ok(item.body.translation().y < .2);
      sim.input.interact = true;
      let contactGap = Infinity, displacement = Infinity;
      for (let i = 0; i < 900 && !f.grip; i++) {
        const hand = f.rig.parts.get(`${f.mainHand} hand`)!.body;
        const palm = gripAnchor(f.mainHand).applyQuaternion(new Quaternion().copy(hand.rotation())).add(hand.translation());
        const handle = handlePoint(item).applyQuaternion(new Quaternion().copy(item.body.rotation())).add(item.body.translation());
        const position = new Vector3().copy(item.body.translation());
        sim.step();
        if (f.grip) { contactGap = palm.distanceTo(handle); displacement = position.distanceTo(new Vector3().copy(item.body.translation())); }
      }
      assert.ok(f.grip, `${kind} should be reachable from the floor`);
      assert.equal(item.holder, 0); assert.equal(f.weapon, item); assert.ok(item.body.isDynamic());
      assert.ok(contactGap < .15 && displacement < .15, 'pickup requires contact range and must not teleport a distant weapon');
      steps(sim, 300); assert.ok(f.rig.parts.get('pelvis')!.body.translation().y > .7);
      if (kind === 'greatsword') assert.ok(f.supportGrip, 'the second hand must return after floor pickup');
      views.update(sim.weapons); assert.equal(scene.children.length, 2);
      assert.ok(scene.children[item.id].position.distanceTo(new Vector3().copy(item.body.translation())) < 1e-8);
      views.reset(); assert.equal(scene.children.length, 0);
    } finally { views.dispose(); sim.dispose(); }
  }
});

await test('pickup cannot attach a weapon outside reach and an empty hand cannot deal remote damage', () => {
  const sim = new DuelSimulation();
  try {
    sim.practice = true; sim.start(); sim.drop();
    const f = sim.fighters[0]; f.weapon.body.setTranslation(new Vector3(-3, .1, -2), true); f.weapon.body.setLinvel(new Vector3(), true);
    sim.input.interact = true; sim.input.attack = true; sim.slash(); steps(sim, 240);
    assert.equal(f.grip, null); assert.equal(f.weapon.holder, null); assert.equal(f.pickup, null); assert.equal(sim.hits, 0);
  } finally { sim.dispose(); }
});

await test('a shove needs a free hand and contact range, then transfers an impulse into the rival', () => {
  const sim = new DuelSimulation();
  try {
    sim.practice = true; sim.start(); sim.drop(); sim.shove(); steps(sim, 60);
    assert.ok(!sim.fighters[0].shoved && sim.fighters[1].stagger === 0, 'a distant shove must not affect the opponent');
    const player = sim.fighters[0], rival = sim.fighters[1];
    for (let i = 0; i < 600 && !player.shoved; i++) {
      sim.input.move.y = player.position.distanceTo(rival.position) > .65 ? .6 : 0;
      if (i % 60 === 0) sim.shove();
      sim.step();
    }
    assert.ok(player.shoved && rival.stagger > .5);
    assert.ok(new Vector3().copy(rival.rig.parts.get('chest')!.body.linvel()).length() > .4, 'the body must react to the hand impulse');
    sim.reset({ playerWeapon: 'greatsword' });
    const stamina = sim.fighters[0].stamina; assert.ok(sim.fighters[0].supportGrip);
    sim.shove(); assert.equal(sim.fighters[0].stamina, stamina, 'both occupied hands cannot spend stamina on an unavailable shove');
  } finally { sim.dispose(); }
});

await test('real parries can break a worn grip; the disarmed opponent retrieves the loose weapon', () => {
  const sim = new DuelSimulation({ playerWeapon: 'greatsword' });
  try {
    sim.start(); sim.input.guard = true;
    const rival = sim.fighters[1]; rival.gripStress = .9;
    for (let i = 0; i < 600 && sim.disarms === 0; i++) sim.step();
    assert.equal(sim.disarms, 1); assert.ok(sim.blocks >= 2);
    assert.equal(rival.grip, null); assert.equal(rival.weapon.holder, null); assert.ok(!rival.down);
    sim.practice = true;
    for (let i = 0; i < 1200 && !rival.grip; i++) sim.step();
    assert.ok(rival.grip); assert.equal(rival.weapon.holder, 1);
    assert.equal(sim.world.bodies.len(), 35); assert.equal(sim.world.impulseJoints.len(), 33);
  } finally { sim.dispose(); }
});

await test('mace glancing hits leave a healthy fighter standing; committed central blows can knock down', () => {
  const impact = { velocity: new Vector3(7, 0, 0), rotation: new Quaternion(), impulse: .5, blade: false, blunt: true, part: 'left forearm' };
  const strike = evaluateStrike(impact);
  assert.ok(strike.damage > 10 && strike.damage < 21); assert.equal(strike.canSever, false); assert.equal(strike.cut, 0);
  assert.equal(knocksDown(impact.part, strike.damage, true), false);
  const heavy = evaluateStrike({...impact, velocity:new Vector3(10,0,0), part:'chest'});
  assert.equal(knocksDown('chest', heavy.damage, true), true);
  assert.ok(WEAPONS.mace.reach < WEAPONS.sword.reach && WEAPONS.greatsword.reach > WEAPONS.sword.reach);
  const sim = new DuelSimulation({ playerWeapon: 'mace' });
  try {
    sim.practice = true; sim.start(); const rival = sim.fighters[1];
    for (let i = 0; i < 1200 && !sim.hits; i++) {
      sim.input.move.y = sim.fighters[0].position.distanceTo(rival.position) > .9 ? .65 : 0;
      sim.input.attack = true; sim.input.aim.set(-Math.sin(i / 120 * 7) * .98, .1); sim.step();
    }
    assert.ok(sim.hits > 0 && rival.hp > 75 && rival.hp < 100);
    sim.clearInput(); steps(sim, 90);
    assert.equal(rival.mode, 'upright', 'a normal first mace contact must not force a fall');
    assert.ok(rival.grip && !rival.down); assert.equal(sim.cuts, 0);
  } finally { sim.dispose(); }
});

await test('walking off either side can catch the edge through actual hand proximity and climb back', () => {
  for (const direction of [-1, 1]) {
    const sim = new DuelSimulation({ arena: 'bridge' });
    try {
      sim.practice = true; sim.start(); sim.input.move.x = direction; const f = sim.fighters[0];
      for (let i = 0; i < 600 && !f.hang; i++) sim.step();
      assert.ok(f.hang && f.mode === 'hanging'); assert.equal(f.grip, null);
      sim.clearInput(); steps(sim, 120);
      assert.ok(f.hang && f.stamina < 100 && !f.down);
      const hand = f.rig.parts.get(`${f.hang.hand} hand`)!.body;
      const anchor = gripAnchor(f.hang.hand).applyQuaternion(new Quaternion().copy(hand.rotation())).add(hand.translation());
      assert.ok(anchor.distanceTo(f.hang.point) < .02, 'a physical joint must hold the actual hand on the edge');
      sim.input.interact = true;
      for (let i = 0; i < 780 && sim.fighters[0].mode !== 'upright' && !f.down; i++) sim.step();
      assert.equal(f.mode, 'upright'); assert.equal(f.hang, null); assert.ok(!f.down);
      assert.ok(onPlatform('bridge', f.rig.parts.get('pelvis')!.body.translation(), .15));
    } finally { sim.dispose(); }
  }
});

await test('the ledge drill opponent climbs back, but a real low hand strike breaks the edge grip', () => {
  const sim = new DuelSimulation({ arena: 'bridge', ledgeDrill: true });
  try {
    assert.ok(sim.fighters[1].hang); const initialJoints = sim.world.impulseJoints.len();
    sim.practice = true; sim.start(); steps(sim, 1200);
    assert.ok(!sim.fighters[1].hang && !sim.fighters[1].down && sim.fighters[1].mode === 'upright');
    for (let trial = 0; trial < 2; trial++) {
      sim.reset(); assert.equal(sim.world.impulseJoints.len(), initialJoints);
      sim.start(); let handHit: DuelHit | undefined;
      sim.onHit = hit => { if (hit.target === 1 && hit.part === 'left hand' && hit.damage >= 6) handHit = hit; };
      for (let i = 0; i < 500 && !handHit; i++) {
        sim.input.attack = true; sim.input.aim.set(-Math.sin(i / 120 * 10) * .98, -.9); sim.step();
      }
      assert.ok(handHit, 'the blade must hit the drawn gripping fingers');
      assert.equal(sim.fighters[1].hang, null); assert.equal(sim.fighters[1].mode, 'falling');
      sim.clearInput(); steps(sim, 360);
      assert.ok(sim.fighters[1].down); assert.equal(sim.fighters[1].defeat, 'Fell onto the spikes'); assert.equal(sim.winner, 0);
    }
    sim.reset({ arena: 'yard', ledgeDrill: false, spares: true, playerWeapon: 'mace', rivalWeapon: 'greatsword' });
    assert.equal(sim.world.bodies.len(), 37); assert.equal(sim.weapons.length, 4);
    assert.ok(sim.fighters.every(f => !f.hang && !f.down && !f.wounds.length));
  } finally { sim.dispose(); }
});
