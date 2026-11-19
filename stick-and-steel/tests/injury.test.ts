import test from 'node:test';
import assert from 'node:assert/strict';
import { InstancedMesh, Matrix4, Quaternion, Scene, Vector3 } from 'three';
import { DuelSimulation, initPhysics, type DuelHit } from '../lib/duel/physics';
import { evaluateStrike, severThreshold, knocksDown } from '../lib/duel/damage';
import { vec } from '../lib/rig/ik';
import { bloodSurface, createImpactEffects } from '../lib/duel/effects';
import { applyFighterSnapshot, fighterSnapshot } from '../lib/duel/net-state';

await initPhysics();
const step = (sim: DuelSimulation, count: number) => { for (let i = 0; i < count; i++) sim.step(); };

await test('arm impacts select the shoulder, elbow or wrist on the struck side', () => {
  const sim = new DuelSimulation();
  try {
    const rig = sim.fighters[0].rig;
    for (const side of ['left', 'right']) for (const [struck, cut] of [['upper arm', 'upper arm'], ['upper arm', 'forearm'], ['forearm', 'forearm'], ['forearm', 'hand'], ['hand', 'hand']]) {
      const wound = rig.detach(`${side} ${cut}`)!;
      const body = rig.parts.get(wound.part)!.body;
      const point = wound.childAnchor.clone().applyQuaternion(new Quaternion().copy(body.rotation())).add(vec(body.translation()));
      rig.reset();
      assert.equal(rig.closestLimbJoint(`${side} ${struck}`, point), `${side} ${cut}`);
      assert.equal(rig.closestLimbJoint('chest', point), null, 'torso contact must not remove a nearby arm');
    }
  } finally { sim.dispose(); }
});

await test('blood lands on the bridge or the pit floor, never a deck above the wound', () => {
  assert.equal(bloodSurface('bridge', .1, new Vector3(0, -.05, 0)), 0);
  assert.equal(bloodSurface('bridge', -1, new Vector3(0, -1.1, 0)), null);
  assert.equal(bloodSurface('bridge', .1, new Vector3(0, -.05, 2)), null);
  assert.equal(bloodSurface('bridge', -6.9, new Vector3(0, -7.1, 2)), -7);
  assert.equal(bloodSurface('yard', .1, new Vector3(0, -.1, 2)), 0);
});

await test('both cut ends follow their physical bodies and survive a multiplayer snapshot', () => {
  const host = new DuelSimulation(), remote = new DuelSimulation();
  const scene = new Scene(), effects = createImpactEffects(scene), matrix = new Matrix4();
  try {
    const f = host.fighters[1], wound = f.rig.detach('right forearm')!;
    f.wounds.push({...wound,born:0,bleed:3});
    f.rig.parts.get(wound.parent)!.body.setTranslation(new Vector3(0,2,0),true);
    f.rig.parts.get(wound.part)!.body.setTranslation(new Vector3(1,1,0),true);
    const snapshot = fighterSnapshot(f); applyFighterSnapshot(remote,1,snapshot,snapshot);
    const twin = remote.fighters[1];
    assert.equal(twin.wounds[0].parent,wound.parent);assert.deepEqual(twin.wounds[0].parts,wound.parts);
    assert.deepEqual([...twin.rig.disabledParts],[...f.rig.disabledParts]);
    const expected = [[wound.parent,wound.parentAnchor],[wound.part,wound.childAnchor]].map(([name,anchor])=>{
      const body=twin.rig.parts.get(name as string)!.body;
      return (anchor as Vector3).clone().applyQuaternion(new Quaternion().copy(body.rotation())).add(vec(body.translation()));
    });
    for(let i=0;i<5;i++)effects.update(.05,[twin],6+i*.05);
    const drops=scene.children[0] as InstancedMesh;
    for(const point of expected){let nearby=false;for(let i=0;i<drops.count;i++){drops.getMatrixAt(i,matrix);if(matrix.determinant()>1e-12&&new Vector3().setFromMatrixPosition(matrix).distanceTo(point)<.16)nearby=true;}assert.ok(nearby,'each exposed end keeps dripping after the initial spray');}
  }finally{effects.dispose();host.dispose();remote.dispose();}
});

await test('cuts require a fast leading edge and real impact; the flat, hilt and resting blade cannot sever', () => {
  const impact = { velocity: new Vector3(9.5, 0, 0), rotation: new Quaternion(), impulse: .3, blade: true, part: 'left forearm' };
  const sharp = evaluateStrike(impact);
  assert.ok(sharp.canSever && sharp.cut > severThreshold(impact.part));
  const flat = evaluateStrike({ ...impact, velocity: new Vector3(0, 0, 6) });
  assert.ok(flat.damage > 0 && flat.damage < sharp.damage); assert.equal(flat.cut, 0); assert.equal(flat.canSever, false);
  assert.equal(evaluateStrike({ ...impact, blade: false }).canSever, false);
  assert.equal(evaluateStrike({ ...impact, velocity: new Vector3() }).damage, 0);
  assert.equal(evaluateStrike({ ...impact, impulse: 0 }).damage, 0);
  assert.equal(severThreshold('chest'), Infinity);
});

await test('an enemy windup is readable; a physical parry interrupts the swing and grants a counter window', () => {
  const sim = new DuelSimulation();
  try {
    sim.start(); sim.input.guard = true;
    let windupFrames = 0, hit: DuelHit | undefined;
    sim.onHit = event => { if (event.kind === 'block' && event.counter && event.target === 0) hit = event; };
    for (let i = 0; i < 600 && !hit; i++) {
      sim.step(); if (sim.fighters[1].state === 'windup') windupFrames++;
    }
    assert.ok(windupFrames >= 24, 'the opponent must prepare visibly before striking');
    assert.ok(hit, 'the guard must intercept the physical blade');
    assert.ok(sim.fighters[0].counterTime > .65);
    assert.ok(sim.fighters[1].recoilTime > .25 && !sim.fighters[1].attack);
    sim.input.guard = false; sim.slash();
    assert.ok(sim.fighters[0].windupDuration < .2, 'the counter starts faster than a normal slash');
    assert.equal(sim.fighters[0].counterTime, 0);
  } finally { sim.dispose(); }
});

await test('a clean cut severs a fresh sword arm; the survivor can rearm with the other hand', () => {
  const sim = new DuelSimulation();
  try {
    sim.practice = true; sim.start();
    let hit: DuelHit | undefined;
    sim.onHit = event => { if (event.kind === 'sever') hit = event; };
    for (let i = 0; i < 1200 && !hit; i++) {
      sim.input.move.y = sim.fighters[0].position.distanceTo(sim.fighters[1].position) > 1.12 ? .65 : 0;
      sim.input.attack = true; sim.input.aim.set(-Math.sin(i / 120 * 7) * .98, 0); sim.step();
    }
    assert.ok(hit && hit.target === 1 && hit.part === 'right forearm', 'an actual blade collision must trigger separation');
    const victim = sim.fighters[1], wound = victim.wounds[0];
    assert.ok(!victim.down && !victim.grip && victim.hp > 0); assert.equal(sim.winner, null);
    assert.equal(victim.mainHand, 'left');
    assert.deepEqual(wound.parts, ['right forearm', 'right hand']);
    assert.equal(sim.world.bodies.len(), 35, 'reuse the original bodies for detached limbs, plus the fixed platform');
    assert.equal(sim.world.impulseJoints.len(), 30, 'remove only the elbow and weapon grip, preserving the detached wrist');
    sim.clearInput(); sim.drop();
    for (let i = 0; i < 1200 && !victim.grip; i++) sim.step();
    assert.ok(victim.grip && !victim.down && victim.hp > 0, 'the AI must physically retrieve a weapon with its surviving hand');
    assert.equal(victim.weapon.holder, 1); assert.equal(victim.mainHand, 'left');
    step(sim, 360);
    const parent = victim.rig.parts.get(wound.parent)!.body, child = victim.rig.parts.get(wound.part)!.body;
    const anchorA = wound.parentAnchor.clone().applyQuaternion(new Quaternion().copy(parent.rotation())).add(vec(parent.translation()));
    const anchorB = wound.childAnchor.clone().applyQuaternion(new Quaternion().copy(child.rotation())).add(vec(child.translation()));
    assert.ok(anchorA.distanceTo(anchorB) > .08, 'the severed elbow must no longer be constrained together');
    assert.ok(child.translation().y < .16 && victim.rig.parts.get('pelvis')!.body.translation().y > .7);
    assert.ok(victim.rig.diagnostics().maxJointError < .02, 'remaining debris joints must stay stable');
    for (let trial = 0; trial < 3; trial++) {
      sim.reset(); assert.equal(sim.cuts, 0); assert.equal(sim.endedAt, null); assert.equal(sim.world.impulseJoints.len(), 32);
      assert.ok(sim.fighters.every(f => !f.wounds.length && !f.rig.disabledParts.size && !f.injuries.size && f.grip));
      step(sim, 120);
    }
  } finally { sim.dispose(); }
});

await test('a detached branch receives no pose forces and the reusable rig can reconnect it on reset', () => {
  const sim = new DuelSimulation();
  try {
    const rig = sim.fighters[0].rig, wound = rig.detach('left shin');
    assert.ok(wound); assert.deepEqual(wound.parts, ['left shin', 'left foot']);
    assert.equal(rig.detach('left foot'), null, 'already detached descendants cannot be separated again');
    const foot = rig.parts.get('left foot')!.body;
    foot.setLinvel({ x: 0, y: 0, z: 0 }, true); rig.prepareStep();
    assert.deepEqual(vec(foot.userForce()).toArray(), [0, 0, 0]);
    assert.deepEqual(vec(foot.userTorque()).toArray(), [0, 0, 0]);
    assert.equal(sim.world.impulseJoints.len(), 31);
    rig.reset(); assert.equal(sim.world.impulseJoints.len(), 32); assert.equal(rig.disabledParts.size, 0);
    step(sim, 120); assert.ok(rig.diagnostics().maxJointError < .02);
  } finally { sim.dispose(); }
});

await test('a low blade sweep can sever a leg and release the stance into a physical fall', () => {
  const sim = new DuelSimulation();
  try {
    sim.practice = true; sim.start();
    for (let i = 0; i < 600 && sim.phase !== 'finished'; i++) {
      sim.input.move.y = sim.fighters[0].position.distanceTo(sim.fighters[1].position) > 1.2 ? .65 : 0;
      sim.input.attack = true; sim.input.aim.set(Math.sin(i / 120 * 6) * .95, -.85); sim.step();
    }
    const victim = sim.fighters[1];
    assert.equal(victim.defeat, 'Leg severed'); assert.ok(victim.down && victim.rig.ragdoll);
    assert.deepEqual(victim.wounds[0].parts, ['left shin', 'left foot']);
    assert.ok(!victim.rig.disabledParts.has('left thigh'), 'a knee-height sweep leaves the upper leg attached');
    assert.equal(sim.cuts, 1); assert.ok(sim.time < 5);
    step(sim, 360); assert.ok(victim.rig.parts.get('pelvis')!.body.translation().y < .25);
    for (const part of victim.rig.parts.values()) assert.ok(vec(part.body.translation()).toArray().every(Number.isFinite));
  } finally { sim.dispose(); }
});

await test('blood droplets settle into floor marks and rematch clears the bounded effect pools', () => {
  const scene = new Scene(), effects = createImpactEffects(scene), matrix = new Matrix4();
  const visibleCount = (mesh: InstancedMesh) => {
    let count = 0;
    for (let i = 0; i < mesh.count; i++) { mesh.getMatrixAt(i, matrix); if (matrix.determinant() > 1e-12) count++; }
    return count;
  };
  try {
    const [drops, stains] = scene.children as InstancedMesh[];
    for (let i = 0; i < 40; i++) effects.hit({ kind: 'sever', point: new Vector3(0, 1, 0), velocity: new Vector3(4, 0, 0), strength: 4, damage: 35, target: 1, attacker: 0, part: 'right forearm' });
    effects.update(0, [], 0);
    assert.ok(visibleCount(drops) > 0 && visibleCount(drops) <= 192);
    for (let i = 0; i < 240; i++) effects.update(1 / 120, [], i / 120);
    assert.equal(visibleCount(drops), 0); assert.ok(visibleCount(stains) > 0 && visibleCount(stains) <= 256);
    assert.equal(scene.children.length, 2);
    effects.reset(); assert.equal(visibleCount(drops), 0); assert.equal(visibleCount(stains), 0);
  } finally { effects.dispose(); }
  assert.equal(scene.children.length, 0);
});

await test('ordinary sweeps take a few hits to injure; speed spikes cannot one-shot a fresh fighter', () => {
  const impact = { velocity: new Vector3(5,0,0), rotation: new Quaternion(), impulse: .3, blade: true, part: 'chest' };
  const chest = evaluateStrike(impact), arm = evaluateStrike({...impact, part:'right forearm'});
  assert.ok(chest.damage >= 10 && chest.damage <= 18);
  assert.ok(arm.cut < severThreshold('right hand'), 'one ordinary sweep cannot remove even the smallest arm branch');
  assert.equal(knocksDown('chest', chest.damage, false), false);
  assert.equal(knocksDown('chest', evaluateStrike({...impact, blade:false, blunt:true}).damage, true), false);
  assert.equal(knocksDown('right forearm', 32, true), false, 'a mace arm hit flinches rather than forcing a whole-body fall');
  assert.equal(knocksDown('chest', 29, true), true, 'a committed central mace impact still knocks down');
  for (const speed of [3, 6, 10, 100]) {
    const head = evaluateStrike({...impact, velocity:new Vector3(speed,0,0), part:'head', impulse:100});
    assert.ok(head.damage < 45, 'even a solver speed spike leaves a fresh opponent alive');
  }
});

await test('a direct arm cut separates the limb without increasing its HP damage', () => {
  const sim = new DuelSimulation();
  try {
    sim.practice = true; sim.start(); let first: DuelHit | undefined;
    sim.onHit = hit => { if((hit.kind === 'hit' || hit.kind === 'sever') && hit.target === 1) first ??= hit; };
    for(let i=0;i<600 && !first;i++) {
      sim.input.move.y=sim.fighters[0].position.distanceTo(sim.fighters[1].position)>1.12?.65:0;
      sim.input.attack=true;sim.input.aim.set(-Math.sin(i/120*7)*.98,0);sim.step();
    }
    assert.ok(first && first.kind === 'sever' && first.part === 'right forearm');
    const rival=sim.fighters[1];assert.ok(rival.hp>75);assert.equal(rival.wounds.length,1);
    assert.ok(first.damage > 10 && first.damage < 25);
    assert.equal(rival.grip, null); assert.ok(rival.rig.disabledParts.has('right forearm'));
    const scene = new Scene(), effects = createImpactEffects(scene), matrix = new Matrix4();
    try {
      effects.hit(first); effects.update(1 / 120, sim.fighters, sim.time);
      const drops = scene.children[0] as InstancedMesh;
      let visible = 0;
      for (let i = 0; i < drops.count; i++) { drops.getMatrixAt(i, matrix); if (matrix.determinant() > 1e-12) visible++; }
      assert.ok(visible >= 30, 'the real sever event must produce the blood burst');
    } finally { effects.dispose(); }
  } finally { sim.dispose(); }
});

await test('cutting power is separate from HP; slow, flat and blunt contacts cannot sever a fresh arm', () => {
  const impact = { velocity: new Vector3(6,0,0), rotation: new Quaternion(), impulse:.3, blade:true, part:'right forearm' };
  const clean = evaluateStrike(impact);
  assert.ok(Math.abs(clean.damage - 15.957) < 1e-8, 'preserve the existing HP damage at this contact speed');
  assert.ok(clean.canSever && clean.cut >= severThreshold(impact.part));
  const slow = evaluateStrike({...impact, velocity:new Vector3(3,0,0)});
  assert.ok(slow.cut < severThreshold('right hand') && !slow.canSever);
  const flat = evaluateStrike({...impact, velocity:new Vector3(0,0,6)});
  assert.equal(flat.cut,0); assert.equal(flat.canSever,false);
  const blunt = evaluateStrike({...impact, blade:false, blunt:true});
  assert.equal(blunt.cut,0); assert.equal(blunt.canSever,false);
});
