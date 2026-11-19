import test from 'node:test';
import assert from 'node:assert/strict';
import { DuelSimulation, initPhysics } from '../lib/duel/physics';
import { DuelTutorial } from '../lib/duel/tutorial';
await initPhysics();

await test('two free sweeps precede two real contacts; a click or guard cannot pass training', () => {
  const s = new DuelSimulation(); s.training = 'dummy'; s.reset();
  const lesson = new DuelTutorial(s); lesson.swing(); s.onHit = h => lesson.contact(h);
  try {
    lesson.steer(200, 0); assert.equal(lesson.step, 'swing');
    s.input.attack = s.input.guard = true; lesson.steer(200, 0); assert.equal(lesson.step, 'swing');
    s.input.guard = false; lesson.steer(100, 0); assert.equal(lesson.step, 'swing');
    assert.ok(lesson.status.distance > 2.6, 'start beyond immediate striking range');
    for (let i = 0; i < 300 && lesson.step === 'swing'; i++) { lesson.steer(4, 0); s.input.aim.set(Math.cos(i / 36) * .95, .3); s.step(); if (lesson.practiceSwings < 2) assert.equal(lesson.step, 'swing'); }
    assert.equal(lesson.practiceSwings, 2); assert.equal(lesson.step, 'hit'); assert.equal(s.hits, 0); assert.equal(lesson.hits, 0);
    for (let i = 0; i < 1800 && lesson.step === 'hit'; i++) { s.input.move.set(0, lesson.status.distance > 1.5 ? .5 : 0); lesson.steer(4, 0); s.input.aim.set(Math.cos(i / 36) * .95, .3); lesson.tick(); s.step(); if (lesson.hits < 2) assert.equal(lesson.step, 'hit'); }
    assert.equal(lesson.step, 'parry'); assert.equal(lesson.needsParrySetup, true); assert.ok(s.hits > 0);
    assert.equal(s.input.attack, false); assert.equal(s.fighters[1].hp, 100); assert.equal(s.cuts, 0);
    assert.equal(lesson.hits, 2); assert.ok(s.time >= 2.2, 'one instant contact cannot finish attacks');
    const bodies = s.fighters.map(f => f.rig.parts.get('pelvis')!.body), positions = bodies.map(b => ({...b.translation()})), world = s.world;
    lesson.parry();
    assert.equal(s.world, world); bodies.forEach((b,i)=>{assert.equal(s.fighters[i].rig.parts.get('pelvis')!.body,b);assert.deepEqual({...b.translation()},positions[i]);});
    assert.ok(s.fighters[1].grip, 'the partner is armed in place');
    for(let i=0;i<120;i++){lesson.tick();s.step();}assert.equal(lesson.swings,0,'time to read the parry cue before the first strike');
    s.input.guard = true; s.input.aim.set(.18,.8);
    for(let i=0;i<1800&&lesson.step!=='great';i++){lesson.tick();s.step();}
    assert.equal(lesson.step,'great','continuous attack-to-parry works from the position the player reached');
  } finally { s.dispose(); }
});

await test('a real high guard parries the scripted strike; waiting without guarding does not complete training', () => {
  for (const guard of [false, true]) {
    const s = new DuelSimulation(); s.training = 'parry'; s.reset();
    const lesson = new DuelTutorial(s); lesson.parry(); s.input.guard = guard;
    const contacts: string[] = []; s.onHit = h => { contacts.push(h.kind); lesson.contact(h); };
    try {
      for (let i = 0; i < 1200 && lesson.step !== 'great'; i++) { lesson.tick(); s.step(); }
      assert.equal(lesson.step, guard ? 'great' : 'parry');
      if (guard) { lesson.present(.5); assert.equal(lesson.step, 'great'); lesson.present(.5); assert.equal(lesson.step, 'complete'); }
      if (guard) { assert.ok(contacts.includes('block')); assert.ok(lesson.swings <= 2); }
      for (const f of s.fighters) { assert.equal(f.hp, 100); assert.ok(f.grip); assert.equal(f.wounds.length, 0); }
      assert.equal(s.online, false);
      s.training = 'off'; s.reset({ arena: 'bridge' }); assert.equal(s.isHuman(1), false); assert.equal(s.phase, 'ready'); assert.equal(s.options.arena, 'bridge');
    } finally { s.dispose(); }
  }
});

await test('movement comes first and requires actual travel in all four directions', () => {
  const s = new DuelSimulation(); s.training = 'dummy'; s.reset();
  const lesson = new DuelTutorial(s); lesson.begin();
  try {
    s.input.attack = true; lesson.steer(500, 500); assert.equal(lesson.step, 'move');
    s.input.attack = false; s.input.move.set(0, 1);
    for (let i = 0; i < 200; i++) lesson.tick();
    assert.equal(lesson.movement[0], 0, 'held keys without body travel do not count');
    for (const [x, y] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      s.input.move.set(x, y);
      for (let i = 0; i < 70 && lesson.step === 'move'; i++) { lesson.tick(); s.step(); }
    }
    assert.deepEqual(lesson.movement, [1, 1, 1, 1]);
    assert.equal(lesson.step, 'swing'); assert.equal(s.phase, 'fighting');
    assert.ok(s.time > 0, 'movement transitions without restarting simulation time');
  } finally { s.dispose(); }
});
