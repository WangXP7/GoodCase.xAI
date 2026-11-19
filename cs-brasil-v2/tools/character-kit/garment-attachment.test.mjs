import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareGarment} from './garment/node.mjs';
import {prepareLoadedGarment} from './garment/core.mjs';
import {exampleBytes, dependencies} from './garment/synthetic-profile.mjs';
import {TRUSTED_RECORD_JSON} from './garment/example-record.mjs';
import {TARGET_SLOTS} from './garment/wearables-schema.mjs';
const {THREE, parseGLB, clone} = await dependencies();
const record = JSON.parse(TRUSTED_RECORD_JSON);
async function fixture() {
  const kit = await prepareGarment({THREE, parseGLB, baseBytes: exampleBytes(), garmentBytes: exampleBytes(true)});
  const gltf = await parseGLB(exampleBytes()), model = clone(gltf.scene), group = new THREE.Group(); group.add(model);
  const ctrl = {model, group, mixer: new THREE.AnimationMixer(model)};
  return {kit, ctrl, body: model.getObjectByName('SyntheticBody')};
}
test('attach shares template resources; idempotent dispose and reattach preserve body/cache', async () => {
  const {kit, ctrl, body} = await fixture(), originalGeometry = body.geometry, originalMaterial = body.material, bones = body.skeleton.bones.slice();
  const first = kit.attach(ctrl), sharedGeometry = first.mesh.geometry, sharedMaterial = first.mesh.material;
  let geometryDisposals = 0, materialDisposals = 0, skeletonDisposals = 0;
  sharedGeometry.addEventListener('dispose', () => geometryDisposals++);
  sharedMaterial.addEventListener('dispose', () => materialDisposals++);
  const disposeSkeleton = first.mesh.skeleton.dispose.bind(first.mesh.skeleton);
  first.mesh.skeleton.dispose = () => {skeletonDisposals++; disposeSkeleton();};
  assert.notEqual(sharedGeometry, originalGeometry); assert.notEqual(sharedMaterial, originalMaterial);
  assert.deepEqual(first.mesh.skeleton.bones, bones); assert.equal(first.mesh.parent, ctrl.model);
  assert.throws(() => kit.attach(ctrl), /slot occupied/);
  first.dispose(); first.dispose(); assert.deepEqual([geometryDisposals, materialDisposals, skeletonDisposals], [0, 0, 1]);
  assert.equal(first.mesh.parent, null); assert.equal(body.geometry, originalGeometry); assert.equal(body.material, originalMaterial);
  assert.deepEqual(body.skeleton.bones, bones);
  const second = kit.attach(ctrl); assert.equal(second.mesh.geometry, sharedGeometry); assert.equal(second.mesh.material, sharedMaterial);
  second.dispose(); assert.deepEqual([geometryDisposals, materialDisposals], [0, 0]);
});
test('two cloned targets share immutable garment resources and follow their own joints', async () => {
  const {kit, ctrl, body} = await fixture(), other = await fixture(), a = kit.attach(ctrl), b = kit.attach(other.ctrl);
  assert.equal(a.mesh.geometry, b.mesh.geometry); assert.equal(a.mesh.material, b.mesh.material);
  assert.notEqual(a.mesh.skeleton, b.mesh.skeleton); assert.notEqual(a.mesh.skeleton.bones[0], b.mesh.skeleton.bones[0]);
  body.skeleton.bones[0].position.x = 0.5; ctrl.model.updateMatrixWorld(true); a.mesh.skeleton.update();
  const point = a.mesh.applyBoneTransform(0, new THREE.Vector3()); assert.equal(point.x, 0.5);
  assert.equal(other.body.skeleton.bones[0].position.x, 0); a.dispose(); assert.equal(b.mesh.parent, other.ctrl.model); b.dispose();
});
test('all eight target slots dispose idempotently and reattach without leaking a lease', async () => {
  const base = await parseGLB(exampleBytes()), source = await parseGLB(exampleBytes(true)), target = await fixture();
  for (const [layer, slot] of TARGET_SLOTS.entries()) {
    const contract = structuredClone(record.contract); Object.assign(contract, {itemId: `synthetic:${slot}`, slot, layer, conflicts: []});
    const kit = prepareLoadedGarment({THREE, base, source, family: record.family, contract});
    const first = kit.attach(target.ctrl); assert.equal(first.slot, slot); first.dispose(); first.dispose();
    const second = kit.attach(target.ctrl); assert.equal(second.slot, slot); second.dispose();
  }
});
test('slot occupancy is shared across independently prepared items', async () => {
  const base = await parseGLB(exampleBytes()), source = await parseGLB(exampleBytes(true)), target = await fixture();
  const make = itemId => {const contract = structuredClone(record.contract); contract.itemId = itemId; return prepareLoadedGarment({THREE, base, source, family: record.family, contract});};
  const a = make('synthetic:a'), b = make('synthetic:b'), mounted = a.attach(target.ctrl);
  assert.throws(() => b.attach(target.ctrl), /slot occupied/); mounted.dispose(); b.attach(target.ctrl).dispose();
});
const mutants = {
  position: b => {b.geometry.attributes.position.array[0] = 0.01;},
  weights: b => {b.geometry.attributes.skinWeight.array[0] = 0.5;},
  normalized: b => {b.geometry.attributes.skinWeight.normalized = true;},
  index: b => {b.geometry.setIndex([0, 1, 3]);},
  inverseBind: b => {b.skeleton.boneInverses[0].elements[12] = 1;},
  bindMatrix: b => {b.bindMatrix.elements[12] = 1;},
  hierarchy: b => {b.skeleton.bones[0].remove(b.skeleton.bones[1]);},
  foreignBone: b => {b.skeleton.bones[0] = new THREE.Bone(); b.skeleton.bones[0].name = 'Hips';},
  morph: b => {b.geometry.morphAttributes.position = [b.geometry.attributes.position.clone()];},
};
for (const [name, mutate] of Object.entries(mutants)) test('target mutation refused: ' + name, async () => {
  const {kit, ctrl, body} = await fixture(); mutate(body); assert.throws(() => kit.attach(ctrl));
  assert.equal(ctrl.model.getObjectByName('SyntheticGarment'), undefined);
});
for (const name of ['missingOwner', 'wrongMixer', 'duplicateName', 'family', 'fit']) test('ownership/request refused: ' + name, async () => {
  const {kit, ctrl, body} = await fixture(); let request;
  if (name === 'missingOwner') ctrl.group.remove(ctrl.model);
  if (name === 'wrongMixer') ctrl.mixer = new THREE.AnimationMixer(new THREE.Group());
  if (name === 'duplicateName') {const bone = new THREE.Bone(); bone.name = body.skeleton.bones[0].name; ctrl.model.add(bone);}
  if (name === 'family') request = {family: 'wrong', fit: record.family.fit};
  if (name === 'fit') request = {family: record.family.family, fit: 'wrong'};
  assert.throws(() => kit.attach(ctrl, request));
});
for (const kind of ['extraMesh', 'animation', 'texture', 'jointTRS', 'approval', 'hide']) test('authoring domain refused: ' + kind, async () => {
  const base = await parseGLB(exampleBytes()), source = await parseGLB(exampleBytes(true)), contract = structuredClone(record.contract);
  const mesh = source.scene.getObjectByName('SyntheticGarment');
  if (kind === 'extraMesh') source.scene.add(new THREE.Mesh());
  if (kind === 'animation') source.animations.push(new THREE.AnimationClip('not allowed', 1, []));
  if (kind === 'texture') mesh.material.map = new THREE.Texture();
  if (kind === 'jointTRS') {mesh.skeleton.bones[0].position.x = 1; mesh.skeleton.bones[0].updateMatrix();}
  if (kind === 'approval') contract.fitApproved = true;
  if (kind === 'hide') contract.hideTriangleIDs = [0];
  assert.throws(() => prepareLoadedGarment({THREE, base, source, family: record.family, contract}));
});
