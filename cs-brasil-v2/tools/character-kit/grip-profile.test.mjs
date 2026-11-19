import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, symlinkSync, truncateSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createExample } from './example.mjs';
import { sha256 } from './kit.mjs';
import { validateGripProfile, GRIP_VERSION } from './grip-profile.mjs';
function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'grip-kit-'));
  try {
    const pkg = createExample(root);
    writeFileSync(join(root, 'evidence.txt'), 'Synthetic testing only; no approved art.');
    const ref = path => ({ path, sha256: sha256(readFileSync(join(root, path))) });
    const region = (weapon = false) => ({ id: 'contact', semantic: weapon ? 'handle' : 'gripping', source: ref(weapon ? 'glasses.glb' : 'body.glb'), space: weapon ? 'weapon-normalized-local' : 'mesh-local-bind', mesh: 0, primitive: 0, vertices: [0], normal: [0, 1, 0], rotation: [0, 0, 0, 1] });
    const hand = () => ({ anatomy: 'mascot', closure: 'baked', ownership: 'clip-owned', actuators: [], regions: [region()] });
    const p = { schemaVersion: GRIP_VERSION, status: 'draft', profileId: 'synthetic-grip', revision: 1,
      subject: { packageId: pkg.packageId, bodyId: pkg.body.id, family: pkg.body.family, fitProfile: pkg.body.fitProfile, rigId: pkg.rig.id, rigRevision: pkg.rig.revision, restPoseSha256: pkg.rig.restPoseSha256, asset: ref('body.glb') },
      coordinates: { units: 'meters', up: '+Y', forward: '+Z' }, provenance: { author: 'test', source: 'synthetic', license: 'test-only', evidence: ref('evidence.txt') },
      weapon: { id: 'synthetic-weapon', revision: 1, asset: ref('glasses.glb'), normalization: ref('evidence.txt'), regions: [region(true)], requiredContacts: ['handle'] },
      hands: { left: hand(), right: hand() }, policy: { mode: 'oneHand', dominant: 'right', support: 'authored-free-pose', reason: 'Synthetic one-hand fixture', evidence: ref('evidence.txt') },
      poses: [{ phase: 'idle', clip: 'synthetic-idle', source: ref('body.glb'), dominantContact: 'maintain', supportContact: 'none' }] };
    run(p, pkg, root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}
test('valid synthetic composition remains draft and explicitly incomplete', () => fixture((p, pkg, root) => {
  const out = validateGripProfile(p, root, pkg);
  assert.equal(out.packageValidated, true);
  assert.equal(out.runtimeEnabled, false); assert.equal(out.contactApproved, false); assert.equal(out.fitApproved, false);
  assert.equal(out.missingPhases.length, 10); assert.equal(out.inspection, 'structural-only');
  assert(out.limitations.includes('weights-and-actuator-nodes-not-verified'));
  writeFileSync(join(root, 'grip.json'), JSON.stringify(p));
  const cli = new URL('./grip-cli.mjs', import.meta.url);
  const cliOut = JSON.parse(execFileSync(process.execPath, [cli.pathname, join(root, 'grip.json'), join(root, 'package.json')], { encoding: 'utf8' }));
  assert.deepEqual(cliOut, out);
}));
const mutations = [
  ['unknown approval', p => p.approved = true, /unknown field/],
  ['self accepted', p => p.status = 'accepted', /identity\/status/],
  ['unknown nested field', p => p.hands.right.geometryVerified = true, /unknown field/],
  ['traversal', p => p.provenance.evidence.path = '../outside', /unsafe path/],
  ['absolute', p => p.provenance.evidence.path = '/tmp/outside', /unsafe path/],
  ['encoded', p => p.provenance.evidence.path = '%2e%2e/outside', /unsafe path/],
  ['windows', p => p.provenance.evidence.path = '..\\outside', /unsafe path/],
  ['wrong hash', p => p.provenance.evidence.sha256 = '0'.repeat(64), /hash mismatch/],
  ['wrong family', p => p.subject.family = 'other', /incompatible package/],
  ['wrong rig', p => p.subject.rigId = 'other', /incompatible rig/],
  ['wrong fit', p => p.subject.fitProfile = 'other', /incompatible package/],
  ['zero normal', p => p.hands.right.regions[0].normal = [0, 0, 0], /unit vector/],
  ['zero quaternion', p => p.hands.right.regions[0].rotation = [0, 0, 0, 0], /unit vector/],
  ['infinite normal', p => p.hands.right.regions[0].normal[0] = Infinity, /non-finite/],
  ['NaN limits', p => { p.hands.right.actuators = [{ node: 1, axis: [1, 0, 0], minRadians: NaN, maxRadians: 1 }]; }, /non-finite/],
  ['duplicate region', p => p.weapon.regions.push(structuredClone(p.weapon.regions[0])), /duplicate/],
  ['duplicate vertices', p => p.hands.right.regions[0].vertices = [0, 0], /duplicate vertices/],
  ['source mismatch', p => p.hands.right.regions[0].source = structuredClone(p.weapon.asset), /source mismatch/],
  ['wrong space', p => p.weapon.regions[0].space = 'world', /space/],
  ['oneHand IK', p => p.policy.support = 'constrained-ik', /IK/],
  ['oneHand support', p => p.poses[0].supportContact = 'maintain', /oneHand/],
  ['weighted no actuator', p => p.hands.right.closure = 'weighted', /closure\/actuator/],
  ['baked fake curl', p => p.hands.right.actuators = [{ node: 1, axis: [1, 0, 0], minRadians: 0, maxRadians: 1 }], /closure\/actuator/],
  ['duplicate phase', p => p.poses.push(structuredClone(p.poses[0])), /duplicate phase/],
  ['unknown phase', p => p.poses[0].phase = 'dance', /phase/],
  ['required guard missing', p => p.weapon.requiredContacts.push('guard'), /missing required/],
];
for (const [name, mutate, pattern] of mutations) test(`reject ${name}`, () => fixture((p, pkg, root) => { const before = structuredClone(p); mutate(p); assert.notDeepEqual(p, before, 'mutation must apply'); assert.throws(() => validateGripProfile(p, root, pkg), pattern); }));
test('symlink escape rejected even with correct external digest', () => fixture((p, pkg, root) => {
  const outside = mkdtempSync(join(tmpdir(), 'grip-outside-'));
  try {
    writeFileSync(join(outside, 'source.txt'), 'outside'); symlinkSync(outside, join(root, 'escape'));
    p.provenance.evidence = { path: 'escape/source.txt', sha256: sha256(Buffer.from('outside')) };
    assert.throws(() => validateGripProfile(p, root, pkg), /escapes root/);
  } finally { rmSync(outside, { recursive: true, force: true }); }
}));
test('weighted declaration remains unverified; duplicate actuators rejected', () => fixture((p, pkg, root) => {
  Object.assign(p.hands.right, { closure: 'weighted', ownership: 'pose-overlay', actuators: [{ node: 9999, axis: [1, 0, 0], minRadians: 0, maxRadians: 1 }] });
  const out = validateGripProfile(p, root, pkg); assert.equal(out.contactApproved, false);
  assert(out.limitations.includes('weights-and-actuator-nodes-not-verified'));
  p.hands.right.actuators.push(structuredClone(p.hands.right.actuators[0]));
  assert.throws(() => validateGripProfile(p, root, pkg), /duplicate actuator/);
}));
test('unsupported twoHand reports inability without fabricating approval', () => fixture((p, pkg, root) => {
  p.policy.mode = 'twoHand'; p.policy.support = 'unsupported'; p.poses[0].supportContact = 'unsupported';
  assert.equal(validateGripProfile(p, root, pkg).supportRequirementSatisfied, false);
  p.poses[0].supportContact = 'maintain'; assert.throws(() => validateGripProfile(p, root, pkg), /unsupported policy/);
}));
test('optional composition validates actual kit, not just declared identities', () => fixture((p, pkg, root) => {
  pkg.status = 'approved'; assert.throws(() => validateGripProfile(p, root, pkg), /version\/status/);
  assert.equal(validateGripProfile(p, root).packageValidated, false);
}));

test('baked requires explicit clip-owned ownership', () => fixture((p, pkg, root) => {
  p.hands.right.ownership = 'none'; assert.throws(() => validateGripProfile(p, root, pkg), /ownership/);
}));
const duplicates = [
  ['top', source => source.replace('"status":"draft"', '"status":"accepted","status":"draft"')],
  ['nested', source => source.replace('"anatomy":"mascot"', '"anatomy":"human","anatomy":"mascot"')],
  ['escaped', source => source.replace('"status":"draft"', '"sta\\u0074us":"accepted","status":"draft"')],
];
for (const [name, mutate] of duplicates) test(`CLI rejects duplicate ${name} profile keys`, () => fixture((p, pkg, root) => {
  const source = JSON.stringify(p), changed = mutate(source); assert.notEqual(changed, source);
  writeFileSync(join(root, 'grip.json'), changed);
  const result = spawnSync(process.execPath, [new URL('./grip-cli.mjs', import.meta.url).pathname, join(root, 'grip.json')], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /duplicate JSON key/);
}));
test('CLI rejects duplicate package keys before composing legacy kit', () => fixture((p, pkg, root) => {
  writeFileSync(join(root, 'grip.json'), JSON.stringify(p));
  const source = JSON.stringify(pkg), changed = source.replace('"status":"draft"', '"sta\\u0074us":"accepted","status":"draft"');
  assert.notEqual(changed, source); writeFileSync(join(root, 'package.json'), changed);
  const result = spawnSync(process.execPath, [new URL('./grip-cli.mjs', import.meta.url).pathname, join(root, 'grip.json'), join(root, 'package.json')], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /duplicate JSON key/);
}));
test('sparse oversized source rejected before read/hash', () => fixture((p, pkg, root) => {
  writeFileSync(join(root, 'large.bin'), 'x'); truncateSync(join(root, 'large.bin'), 256 * 1024 * 1024 + 1);
  p.provenance.evidence = { path: 'large.bin', sha256: '0'.repeat(64) };
  assert.throws(() => validateGripProfile(p, root), /256MiB/);
}));
test('CLI rejects sparse oversized JSON before parse', () => fixture((p, pkg, root) => {
  writeFileSync(join(root, 'large.json'), '{}'); truncateSync(join(root, 'large.json'), 1024 * 1024 + 1);
  const result = spawnSync(process.execPath, [new URL('./grip-cli.mjs', import.meta.url).pathname, join(root, 'large.json')], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /1MiB/);
}));
test('CLI retains JSON syntax rejection', () => fixture((p, pkg, root) => {
  writeFileSync(join(root, 'bad.json'), '{"status":"draft",}');
  const result = spawnSync(process.execPath, [new URL('./grip-cli.mjs', import.meta.url).pathname, join(root, 'bad.json')], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.doesNotMatch(result.stderr, /duplicate JSON key/);
}));

for (const raw of ['null', 'false', '0', '""', '[]']) {
  for (const kind of ['profile', 'package']) test(`CLI rejects ${kind} root ${raw}`, () => fixture((p, pkg, root) => {
    writeFileSync(join(root, 'grip.json'), JSON.stringify(p)); writeFileSync(join(root, 'invalid.json'), raw);
    const args = kind === 'profile' ? [join(root, 'invalid.json')] : [join(root, 'grip.json'), join(root, 'invalid.json')];
    const result = spawnSync(process.execPath, [new URL('./grip-cli.mjs', import.meta.url).pathname, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1); assert.match(result.stderr, /root must be/);
  }));
}
for (const pkg of [false, 0, '', []]) test(`API rejects explicit invalid composition ${JSON.stringify(pkg)}`, () => fixture((p, valid, root) => {
  assert.throws(() => validateGripProfile(p, root, pkg));
}));
test('standalone synthetic generator composes through real CLI and refuses repeat', () => fixture((p, pkg, root) => {
  const destination = join(realpathSync(root), 'new-example');
  const generator = new URL('./grip-example.mjs', import.meta.url).pathname;
  execFileSync(process.execPath, [generator, destination]);
  const result = JSON.parse(execFileSync(process.execPath, [new URL('./grip-cli.mjs', import.meta.url).pathname, join(destination, 'grip-profile.json'), join(destination, 'package.json')], { encoding: 'utf8' }));
  assert.equal(result.packageValidated, true); assert.equal(result.contactApproved, false);
  const before = readFileSync(join(destination, 'grip-profile.json'));
  const repeated = spawnSync(process.execPath, [generator, destination], { encoding: 'utf8' });
  assert.equal(repeated.status, 1); assert.match(repeated.stderr, /refusing to overwrite/);
  assert.deepEqual(readFileSync(join(destination, 'grip-profile.json')), before);
}));
for (const dangling of [false, true]) test(`generator rejects ${dangling ? 'dangling' : 'existing'} symlink destination`, () => fixture((p, pkg, root) => {
  symlinkSync(dangling ? join(root, 'missing') : root, join(root, 'linked'));
  const result = spawnSync(process.execPath, [new URL('./grip-example.mjs', import.meta.url).pathname, join(root, 'linked')], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /refusing to overwrite/);
}));
test('generator rejects symlink parent without writing through it', () => fixture((p, pkg, root) => {
  symlinkSync(root, join(root, 'linked'));
  const result = spawnSync(process.execPath, [new URL('./grip-example.mjs', import.meta.url).pathname, join(root, 'linked', 'new')], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /without symlinks/);
}));
