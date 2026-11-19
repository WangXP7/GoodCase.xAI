import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, readFileSync, mkdirSync, existsSync, readdirSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createExample, syntheticGLB } from './example.mjs';
import { validatePackage, planOutfit, inspectGLB, readJSON, sha256 } from './kit.mjs';
const cli = fileURLToPath(new URL('./cli.mjs', import.meta.url));
function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'character-kit-'));
  try { run(createExample(root), root); } finally { rmSync(root, { recursive: true, force: true }); }
}
test('synthetic package validates and plans without approving fit or runtime', () => fixture((pkg, root) => {
  assert.equal(validatePackage(pkg, root).fitApproved, false);
  const plan = planOutfit(pkg, root, ['test-shirt', 'test-glasses']);
  assert.equal(plan.status, 'draft'); assert.equal(plan.runtimeEnabled, false);
  assert.deepEqual(plan.proposedHiddenBodyRegions, ['torso']);
  assert.equal(plan.entitlement, 'server-check-required');
  assert.equal(inspectGLB(join(root, 'body.glb')).jointSets[0].length, 7);
  const output = JSON.parse(execFileSync(process.execPath, [cli, 'validate', join(root, 'package.json')], { encoding: 'utf8' }));
  assert.equal(output.packageId, 'synthetic-example');
}));
const mutations = [
  ['parent traversal', p => p.items[0].asset.path = '../body.glb', /unsafe asset path/],
  ['absolute path', p => p.items[0].asset.path = '/tmp/body.glb', /unsafe asset path/],
  ['encoded traversal', p => p.items[0].asset.path = '%2e%2e/body.glb', /unsafe asset path/],
  ['windows traversal', p => p.items[0].asset.path = '..\\body.glb', /unsafe asset path/],
  ['NaN socket', p => p.rig.sockets.face.position[0] = NaN, /non-finite/],
  ['infinite transform', p => p.rig.sockets.face.scale[0] = Infinity, /non-finite/],
  ['zero quaternion', p => p.rig.sockets.face.rotation = [0, 0, 0, 0], /invalid socket transform/],
  ['negative scale', p => p.rig.sockets.face.scale[0] = -1, /invalid socket transform/],
  ['absent provenance', p => delete p.items[0].asset.provenance, /missing field/],
  ['empty license', p => p.items[0].asset.provenance.license = '', /provenance required/],
  ['wrong hash', p => p.items[0].asset.sha256 = '0'.repeat(64), /hash mismatch/],
  ['wrong rig', p => p.items[0].rigId = 'other-rig', /incompatible rig/],
  ['wrong rest pose', p => p.items[0].restPoseSha256 = '0'.repeat(64), /incompatible rig/],
  ['wrong body', p => p.items[0].bodyFamily = 'other-body', /incompatible body/],
  ['wrong fit', p => p.items[0].fitProfile = 'other-fit', /incompatible body/],
  ['wrong slot', p => p.items[0].slot = 'gloves', /slot\/kind/],
  ['prototype slot', p => p.items[0].slot = 'constructor', /unknown slot/],
  ['wrong layer', p => p.items[0].layer = 900, /slot\/kind/],
  ['illegal mask', p => p.items[0].hideBodyRegions = ['torso'], /cannot hide/],
  ['missing socket', p => delete p.rig.sockets.face, /missing socket/],
  ['missing mapped joint', p => p.rig.bones.footRight = 'Absent', /body missing rig bones/],
  ['rigid with skin', p => p.items[0].asset = structuredClone(p.body.asset), /rigid item contains skin/],
  ['skinned without skin', p => p.items[1].asset = structuredClone(p.items[0].asset), /skinned item missing/],
  ['self approved', p => p.status = 'approved', /version\/status/],
  ['client entitlement', p => p.items[0].owned = true, /unknown field/],
  ['duplicate item', p => p.items.push(structuredClone(p.items[0])), /duplicate/],
];
for (const [name, mutate, error] of mutations) test(`reject ${name}`, () => fixture((pkg, root) => {
  const before = structuredClone(pkg); mutate(pkg); assert.notDeepEqual(pkg, before, 'mutation must apply');
  assert.throws(() => validatePackage(pkg, root), error);
}));
test('reject symlink escape including provenance', () => fixture((pkg, root) => {
  const outside = mkdtempSync(join(tmpdir(), 'character-outside-'));
  try {
    writeFileSync(join(outside, 'external.glb'), syntheticGLB(false)); symlinkSync(outside, join(root, 'escape'));
    pkg.items[0].asset.path = 'escape/external.glb'; assert.throws(() => validatePackage(pkg, root), /escapes package root/);
    pkg.items[0].asset.path = 'glasses.glb'; pkg.items[0].asset.provenance.evidence = 'escape/external.glb';
    assert.throws(() => validatePackage(pkg, root), /escapes package root/);
  } finally { rmSync(outside, { recursive: true, force: true }); }
}));
test('reject outfit conflicts and unknown or duplicate selections', () => fixture((pkg, root) => {
  assert.throws(() => planOutfit(pkg, root, ['unknown']), /unknown item/);
  assert.throws(() => planOutfit(pkg, root, ['test-shirt', 'test-shirt']), /duplicate/);
  pkg.items[0].excludes = ['test-shirt']; assert.throws(() => planOutfit(pkg, root, ['test-glasses', 'test-shirt']), /exclusion/);
  pkg.items[0].excludes = []; const extra = structuredClone(pkg.items[0]); extra.id = 'other-glasses'; extra.catalogId = 'other-catalog'; pkg.items.push(extra);
  assert.throws(() => planOutfit(pkg, root, ['test-glasses', 'other-glasses']), /slot conflict/);
}));
test('reject corrupted GLB even when contributor updates digest', () => fixture((pkg, root) => {
  const bytes = syntheticGLB(false); bytes.writeUInt32LE(bytes.length + 4, 8);
  writeFileSync(join(root, 'glasses.glb'), bytes); pkg.items[0].asset.sha256 = sha256(bytes);
  assert.throws(() => validatePackage(pkg, root), /length mismatch/);
}));
test('reject JSON overflow and CLI invalid package with nonzero exit', () => fixture((pkg, root) => {
  const file = join(root, 'package.json'); writeFileSync(file, '{"number":1e999}');
  assert.throws(() => readJSON(file), /non-finite/);
  const result = spawnSync(process.execPath, [cli, 'validate', file], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /non-finite/);
}));
test('example refuses overwrite of existing artifacts', () => fixture((pkg, root) => {
  const before = readFileSync(join(root, 'package.json'));
  assert.throws(() => createExample(root), /refusing to overwrite/);
  assert.deepEqual(readFileSync(join(root, 'package.json')), before);
}));
function editGLB(bytes, edit) {
  const length = bytes.readUInt32LE(12), doc = JSON.parse(bytes.toString('utf8', 20, 20 + length));
  edit(doc); const json = Buffer.from(JSON.stringify(doc)), pad = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20); json.copy(pad);
  const output = Buffer.concat([bytes.subarray(0, 20), pad, bytes.subarray(20 + length)]);
  output.writeUInt32LE(output.length, 8); output.writeUInt32LE(pad.length, 12); return output;
}
for (const [name, mutate, error] of [
  ['external buffer', d => d.buffers[0].uri = 'https://invalid.example/secret', /URI resources unsupported/],
  ['external image', d => d.images = [{ uri: '../secret.png' }], /URI resources unsupported/],
  ['invalid joint', d => d.skins[0].joints[0] = 9999, /invalid joint node index/],
  ['duplicate joint', d => d.skins[0].joints[1] = 0, /invalid skin joints/],
  ['duplicate bone name', d => d.nodes[1].name = 'Hips', /duplicate joint names/],
  ['missing weights', d => delete d.meshes[0].primitives[0].attributes.WEIGHTS_0, /missing attributes/],
  ['wrong embedded buffer size', d => d.buffers[0].byteLength = 100000, /BIN size mismatch/],
]) test(`reject GLB ${name} after honest rehash`, () => fixture((pkg, root) => {
  const original = syntheticGLB(), changed = editGLB(original, mutate); assert.notDeepEqual(changed, original);
  writeFileSync(join(root, 'body.glb'), changed); pkg.body.asset.sha256 = sha256(changed);
  assert.throws(() => validatePackage(pkg, root), error);
}));

for (const file of ['body.glb', 'glasses.glb', 'SOURCE.md', 'package.json'])
  for (const targetExists of [false, true])
    test(`example rejects ${targetExists ? 'existing' : 'dangling'} symlink at ${file} before writing`, () => {
      const root = mkdtempSync(join(tmpdir(), 'character-example-symlink-'));
      try {
        const directory = join(root, 'package'), outside = join(root, 'outside');
        mkdirSync(directory);
        if (targetExists) writeFileSync(outside, 'preserve external content');
        symlinkSync('../outside', join(directory, file));
        assert.throws(() => createExample(directory), /refusing to overwrite/);
        assert.equal(existsSync(outside), targetExists);
        if (targetExists) assert.equal(readFileSync(outside, 'utf8'), 'preserve external content');
        assert.equal(lstatSync(join(directory, file)).isSymbolicLink(), true);
        assert.deepEqual(readdirSync(directory), [file], 'preflight must prevent partial writes');
      } finally { rmSync(root, { recursive: true, force: true }); }
    });
