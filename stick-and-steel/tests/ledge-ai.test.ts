import test from 'node:test';
import assert from 'node:assert/strict';
import { DuelSimulation, initPhysics, type DuelHit } from '../lib/duel/physics';
import { onPlatform } from '../lib/duel/arena';
import type { WeaponKind } from '../lib/duel/weapons';

await initPhysics();
const steps = (sim: DuelSimulation, n: number) => { for (let i = 0; i < n; i++) sim.step(); };

function hangingPlayer(kind: WeaponKind = 'sword', direction = -1) {
  const sim = new DuelSimulation({ arena: 'bridge', rivalWeapon: kind });
  // Walk off through the same controller used by desktop/touch. No pose, joint,
  // damage or collision is injected into the ledge encounter.
  sim.practice = true; sim.start(); sim.input.move.x = direction;
  for (let i = 0; i < 600 && !sim.fighters[0].hang; i++) sim.step();
  sim.clearInput();
  assert.ok(sim.fighters[0].hang, 'the player must catch the edge physically');
  return sim;
}

for (const kind of ['sword', 'mace', 'greatsword'] as const) for (const direction of [-1, 1]) {
  await test(`${kind} bot approaches and knocks the hanging player off bridge side ${direction}`, () => {
    const sim = hangingPlayer(kind, direction);
    try {
      const player = sim.fighters[0], bot = sim.fighters[1], grip = player.hang!;
      let handHit: DuelHit | undefined, windup = 0, swinging = false;
      const start = sim.time;
      sim.onHit = hit => { if (hit.attacker === 1 && hit.target === 0 && hit.part === `${grip.hand} hand` && hit.damage >= 6) handHit = hit; };
      sim.practice = false;
      for (let i = 0; i < 1200 && player.hang && !handHit; i++) {
        sim.step();
        assert.equal(bot.mode, 'upright', 'approaching and striking must not walk the bot off the deck');
        if (bot.lowStrike && bot.state === 'windup') windup++;
        if (bot.lowStrike && bot.state === 'swing') swinging = true;
        if (!handHit) assert.ok(player.hang, 'release must follow a real damaging hand collision');
      }
      assert.ok(windup >= 40 && swinging, 'the bot must telegraph and execute its own low strike');
      assert.ok(handHit, 'autonomous weapon contact must hit the gripping fingers before stamina expires');
      assert.ok(player.stamina > 20 && player.hp > 60 && sim.time - start < 10);
      assert.equal(player.hang, null); assert.equal(player.mode, 'falling');
      steps(sim, 240);
      assert.ok(player.down); assert.equal(sim.winner, 1);
      assert.equal(bot.mode, 'upright'); assert.ok(bot.grip);
      assert.ok(onPlatform('bridge', bot.rig.parts.get('pelvis')!.body.translation()), 'the bot must not follow the falling player into the pit');
    } finally { sim.dispose(); }
  });
}

await test('climbing promptly escapes the ledge attack and the bot returns to regular combat', () => {
  const sim = hangingPlayer();
  try {
    sim.practice = false; sim.input.interact = true;
    const player = sim.fighters[0];
    for (let i = 0; i < 780 && player.mode !== 'upright' && !player.down; i++) sim.step();
    assert.equal(player.mode, 'upright'); assert.equal(player.hang, null); assert.ok(!player.down);
    sim.clearInput();
    const bot = sim.fighters[1]; let normalAttack = false;
    for (let i = 0; i < 480 && !normalAttack; i++) {
      sim.step(); normalAttack = bot.slashTime > 0 && !bot.lowStrike;
    }
    assert.ok(normalAttack, 'a recovered player is no longer treated as a ledge target');
  } finally { sim.dispose(); }
});

await test('ledge attacks respect recoil, practice mode, and human ownership online', () => {
  const sim = hangingPlayer();
  try {
    const bot = sim.fighters[1];
    steps(sim, 180); assert.equal(bot.slashTime, 0, 'practice mode must remain passive');
    sim.practice = false; sim.online = true;
    steps(sim, 180); assert.equal(bot.slashTime, 0, 'online human opponents must not be driven by bot AI');
    sim.online = false;
    for (let i = 0; i < 600 && bot.state !== 'windup'; i++) sim.step();
    assert.equal(bot.state, 'windup'); assert.equal(bot.lowStrike, true);
    bot.recoilTime = .3; sim.step();
    assert.equal(bot.state, 'stagger'); assert.equal(bot.slashTime, 0); assert.equal(bot.attack, false);
  } finally { sim.dispose(); }
});
