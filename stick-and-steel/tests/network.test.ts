import { WEAPON_ASSETS } from '../lib/duel/weapon-assets';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Vector3 } from 'three';
import { DuelSimulation, initPhysics, createDuelInput } from '../lib/duel/physics';
import { fighterSnapshot, weaponSnapshot, applyFighterSnapshot, applyWeaponSnapshot, packInput, validInput, held } from '../lib/duel/net-state';
import { createWeaponModel } from '../lib/duel/weapon-model';
import { WEAPONS, type WeaponKind } from '../lib/duel/weapons';
import { ARENAS } from '../lib/duel/arena';
await initPhysics();

await test('two human seats have independent controls and neither silently runs the AI', () => {
  const sim = new DuelSimulation(); sim.online = true; sim.start();
  try {
    for (let i = 0; i < 360; i++) sim.step();
    assert.equal(sim.hits, 0); assert.equal(sim.fighters[1].aiTime, 0);
    sim.localPlayerId = 1; const start = sim.fighters[1].position.clone();
    sim.input.move.set(0, 1); sim.input.guard = true;
    for (let i = 0; i < 60; i++) sim.step();
    assert.ok(sim.fighters[1].position.distanceTo(start) > .15);
    assert.equal(sim.inputs[0].guard, false); assert.equal(sim.fighters[1].guard, true);
    sim.drop(); assert.equal(sim.fighters[1].grip, null); assert.ok(sim.fighters[0].grip);
    sim.reset(); assert.equal(sim.localPlayerId, 1); assert.equal(sim.online, true);
    assert.ok(sim.inputs.every(input => input.move.length() === 0 && !input.attack));
  } finally { sim.dispose(); }
});

await test('network snapshots carry every limb and weapon; raw damage and grip flags override render interpolation', () => {
  const host = new DuelSimulation({ spares: true }), follower = new DuelSimulation({ spares: true });
  try {
    host.online = follower.online = true; host.localPlayerId = 0; follower.localPlayerId = 1;
    host.start(); host.inputs[0].move.y = .6; host.inputs[1].guard = true;
    for (let i = 0; i < 90; i++) host.step();
    host.drop(1); host.fighters[1].hp = 42; host.fighters[1].stagger = .5;
    const snapshots = host.fighters.map(fighterSnapshot), weapons = weaponSnapshot(host);
    assert.ok(snapshots.every(s => JSON.stringify(s).length < 6000), 'keep each packet compact');
    applyWeaponSnapshot(follower, structuredClone(weapons), structuredClone(weapons));
    snapshots.forEach((raw, i) => applyFighterSnapshot(follower, i, { ...raw, meta: {} }, structuredClone(raw)));
    for (let i = 0; i < 2; i++) for (const [name, part] of host.fighters[i].rig.parts) {
      const other = follower.fighters[i].rig.parts.get(name)!;
      assert.ok(new Vector3().copy(part.body.translation()).distanceTo(other.body.translation()) < .0001);
    }
    assert.equal(follower.fighters[1].hp, 42); assert.equal(held(follower.fighters[1]), false);
    assert.equal(follower.fighters[1].weapon.holder, null); assert.equal(follower.time, host.time);
    const raw = snapshots[0], smoothed = { ...raw, b0x: (raw.b0x as number) + .25 };
    applyFighterSnapshot(follower, 0, smoothed, raw);
    const first = [...follower.fighters[0].rig.parts.values()][0].body;
    assert.ok(Math.abs(first.translation().x - (smoothed.b0x as number)) < .00001, 'draw the SDK state once, without re-smoothing');
  } finally { host.dispose(); follower.dispose(); }
});

await test('host input validation rejects duplicate, stale, non-finite and oversized action packets', () => {
  const packet = packInput(createDuelInput(), 'round-a', 4, ['slash', 'pickup', 'chop']);
  assert.ok(validInput(packet, 'round-a', 3));
  assert.equal(validInput(packet, 'round-a', 4), false);
  assert.equal(validInput(packet, 'round-b', 3), false);
  for (const aim of [[NaN, 0], [Infinity, 0], [2, 0], [0, 0, 0]]) assert.equal(validInput({ ...packet, aim }, 'round-a', 3), false);
  assert.equal(validInput({ ...packet, actions: Array(5).fill('slash') }, 'round-a', 3), false);
  assert.equal(validInput({ ...packet, attack: 'yes' }, 'round-a', 3), false);
});

await test('weapon meshes match the physical tip and cover their handle anchor', () => {
  for (const kind of Object.keys(WEAPONS) as WeaponKind[]) {
    const model = createWeaponModel(kind);
    try {
      const box = new Box3().setFromObject(model.group), spec = WEAPONS[kind];
      assert.ok(Math.abs(box.max.y - spec.tip) < .035, `${kind}: visible and physical tip agree`);
      assert.ok(box.containsPoint(new Vector3(0, -spec.center, 0)), `${kind}: grip stays inside the visible handle`);
      assert.ok(box.max.z - box.min.z < .3 && box.max.x - box.min.x < .4);
    } finally { model.dispose(); }
  }
});

await test('the one-metre span has real spike contacts beneath it and reports the struck body part', () => {
  assert.equal(ARENAS.bridge.halfZ * 2, 1.04);
  const sim = new DuelSimulation({ arena: 'bridge' });
  try {
    sim.online = true; sim.start(); sim.drop(0); const f = sim.fighters[0];
    f.mode = 'falling'; f.rig.ragdoll = true;
    const offset = new Vector3(-f.position.x, -5.5, 1.4);
    for (const p of f.rig.parts.values()) { p.body.setTranslation(new Vector3().copy(p.body.translation()).add(offset), true); p.body.setLinvel({ x: 0, y: -5, z: 0 }, true); }
    const impacts: string[] = []; sim.onHit = hit => { if (hit.kind === 'impale') impacts.push(hit.part); };
    for (let i = 0; i < 240; i++) sim.step();
    assert.ok(impacts.length > 0, 'falling limbs must hit actual spike colliders');
    assert.equal(f.defeat, 'Fell onto the spikes'); assert.equal(sim.winner, 1);
    assert.ok(impacts.every(part => f.rig.parts.has(part)));
    assert.ok(f.rig.parts.get('pelvis')!.body.translation().y > -7.2);
  } finally { sim.dispose(); }
});

await test('bundled generated weapon meshes fit their physical envelopes and use local compact materials', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const kind of Object.keys(WEAPONS) as WeaponKind[]) {
    const data = await readFile(new URL('../public' + WEAPON_ASSETS[kind], import.meta.url));
    assert.equal(data.readUInt32LE(0), 0x46546c67); assert.ok(data.length < 1024 * 1024);
    const gltf = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString());
    const position = gltf.accessors[gltf.meshes[0].primitives[0].attributes.POSITION], spec = WEAPONS[kind];
    assert.ok(Math.abs(position.max[1] - spec.tip) < .001);
    assert.ok(position.min[1] < -spec.center && position.max[1] > -spec.center);
    assert.ok(position.max[0] - position.min[0] <= .33 && position.max[2] - position.min[2] <= .19);
    assert.ok((gltf.images ?? []).every((image: {bufferView?:number;uri?:string}) => image.bufferView !== undefined && !image.uri), 'no remote image dependency');
  }
});
