import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { syntheticGLB } from './example.mjs';
import { inspectBindBytes } from './bind-inspector.mjs';
const sha = b => createHash('sha256').update(b).digest('hex');
const read = (b, expected = {}) => inspectBindBytes(b, sha(b), expected);
const split = b => { const n = b.readUInt32LE(12); return { doc: JSON.parse(b.toString('utf8', 20, 20 + n)), bin: Buffer.from(b.subarray(28 + n)) }; };
function pack(doc, bin, pretty = false) {
  const j = Buffer.from(typeof doc === 'string' ? doc : JSON.stringify(doc, null, pretty ? 2 : undefined)), p = Buffer.alloc(Math.ceil(j.length / 4) * 4, 32); j.copy(p);
  const b = Buffer.alloc(28 + p.length + bin.length); b.writeUInt32LE(0x46546c67, 0); b.writeUInt32LE(2, 4); b.writeUInt32LE(b.length, 8);
  b.writeUInt32LE(p.length, 12); b.writeUInt32LE(0x4e4f534a, 16); p.copy(b, 20); b.writeUInt32LE(bin.length, 20 + p.length); b.writeUInt32LE(0x004e4942, 24 + p.length); bin.copy(b, 28 + p.length); return b;
}
function mutate(b, edit) { const state = split(b); edit(state); return pack(state.doc, state.bin); }
function append(state, bytes, accessor) {
  const view = state.doc.bufferViews.length, id = state.doc.accessors.length;
  state.doc.bufferViews.push({ buffer: 0, byteOffset: state.bin.length, byteLength: bytes.length });
  state.doc.accessors.push({ bufferView: view, ...accessor }); state.bin = Buffer.concat([state.bin, bytes]); state.doc.buffers[0].byteLength = state.bin.length; return id;
}
function fixture() {
  const state = split(syntheticGLB()), matrices = Buffer.alloc(7 * 64);
  for (let i = 0; i < 7; i++) for (const k of [0, 5, 10, 15]) matrices.writeFloatLE(1, i * 64 + k * 4);
  state.doc.skins[0].inverseBindMatrices = append(state, matrices, { type: 'MAT4', componentType: 5126, count: 7 }); return pack(state.doc, state.bin);
}
const original = fixture(), baseline = read(original);
test('reads real bytes as draft and never approves contact/runtime', () => {
  assert.equal(baseline.primitives[0].vertices, 3); assert.equal(baseline.contactApproved, false); assert.equal(baseline.runtimeEnabled, false);
  assert.equal(baseline.primitives[0].weightedJoints[0].nonzeroInfluences, 3);
  assert.throws(() => inspectBindBytes(original, '0'.repeat(64)), /source hash mismatch/);
  assert.throws(() => inspectBindBytes(original), /SHA-256 required/);
});
test('identical data GLB repack changes source hash only', () => {
  const {doc, bin} = split(original), repacked = pack(doc, bin, true), report = read(repacked);
  assert.notEqual(sha(original), sha(repacked));
  for (const key of ['bindFingerprintSha256', 'geometryFingerprintSha256', 'weightsFingerprintSha256']) assert.equal(report[key], baseline[key]);
});
for (const [name, edit, field] of [
  ['IBM', s => s.bin.writeFloatLE(0.125, 108 + 12 * 4), 'bindFingerprintSha256'],
  ['parent', s => { s.doc.nodes[0].children.pop(); s.doc.nodes[1].children = [6]; }, 'bindFingerprintSha256'],
  ['TRS', s => s.doc.nodes[1].translation = [0.25, 0, 0], 'bindFingerprintSha256'],
  ['JOINTS', s => s.bin.writeUInt16LE(1, 36), 'weightsFingerprintSha256'],
  ['weight', s => { s.bin.writeFloatLE(0.5, 60); s.bin.writeFloatLE(0.5, 64); }, 'weightsFingerprintSha256'],
  ['geometry', s => s.bin.writeFloatLE(0.25, 0), 'geometryFingerprintSha256'],
]) test(`detect valid ${name} mutant even when asset rehashed`, () => {
  const changed = mutate(original, edit); assert.notDeepEqual(changed, original);
  const report = read(changed); assert.notEqual(report[field], baseline[field]);
  assert.throws(() => read(changed, { [field]: baseline[field] }), new RegExp(`${field} mismatch`));
  if (field !== 'bindFingerprintSha256') assert.equal(report.bindFingerprintSha256, baseline.bindFingerprintSha256);
});
for (const [name, edit, error] of [
  ['duplicate joints', s => s.doc.skins[0].joints[1] = 0, /duplicate skin joints/],
  ['multiple parents', s => s.doc.nodes[1].children = [6], /multiple parents/],
  ['duplicate child', s => s.doc.nodes[0].children.push(1), /duplicate child/],
  ['cycle', s => s.doc.nodes[1].children = [0], /hierarchy cycle/],
  ['NaN IBM', s => s.bin.writeFloatLE(NaN, 108), /non-finite accessor/],
  ['singular IBM', s => s.bin.writeFloatLE(0, 108), /singular matrix/],
  ['bad IBM count', s => s.doc.accessors[3].count = 6, /IBM format\/count/],
  ['bad child index', s => s.doc.nodes[0].children.push(99), /child index/],
  ['bad quaternion', s => s.doc.nodes[1].rotation = [0, 0, 0, 2], /non-unit quaternion/],
  ['zero scale', s => s.doc.nodes[1].scale = [0, 1, 1], /singular matrix/],
  ['matrix with TRS', s => { s.doc.nodes[1].matrix = Array(16).fill(0); s.doc.nodes[1].translation = [0, 0, 0]; }, /matrix and TRS/],
  ['out-of-domain joints', s => s.bin.writeUInt16LE(999, 36), /JOINTS outside skin domain/],
  ['negative weight', s => s.bin.writeFloatLE(-0.1, 60), /WEIGHTS outside/],
  ['NaN weight', s => s.bin.writeFloatLE(NaN, 60), /non-finite accessor/],
  ['zero weight sum', s => s.bin.writeFloatLE(0, 60), /WEIGHTS sum/],
  ['wrong weight sum', s => s.bin.writeFloatLE(0.4, 60), /WEIGHTS sum/],
  ['sparse accessor', s => s.doc.accessors[0].sparse = { count: 1 }, /sparse accessor unsupported/],
  ['view overflow', s => s.doc.bufferViews[0].byteLength = 999999, /bufferView bounds/],
  ['accessor overflow', s => s.doc.accessors[0].count = 100, /exceeds bufferView/],
  ['allocation cap', s => s.doc.accessors[0].count = 1e9, /allocation limit/],
  ['external buffer', s => s.doc.buffers[0].uri = 'file:///tmp/private', /embedded buffer/],
  ['compression', s => s.doc.extensionsRequired = ['KHR_draco_mesh_compression'], /compressed\/quantized/],
]) test(`reject ${name}`, () => { const changed = mutate(original, edit); assert.notDeepEqual(changed, original); assert.throws(() => read(changed), error); });
test('source array order matters; identity matrix vs default TRS and -0 do not', () => {
  const ordered = mutate(original, s => s.doc.skins[0].joints.reverse()); assert.notEqual(read(ordered).bindFingerprintSha256, baseline.bindFingerprintSha256);
  const matrix = mutate(original, s => s.doc.nodes[1].matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -0, 0, 0, 1]);
  assert.equal(read(matrix).bindFingerprintSha256, baseline.bindFingerprintSha256);
  const zero = mutate(original, s => s.bin.writeFloatLE(-0, 0)); assert.equal(read(zero).geometryFingerprintSha256, baseline.geometryFingerprintSha256);
});
test('accessor byteOffset and interleaved byteStride preserve actual positions', () => {
  const changed = mutate(original, s => {
    const data = Buffer.alloc(56); for (let i = 0; i < 3; i++) s.bin.copy(data, 8 + i * 16, i * 12, i * 12 + 12);
    const accessor = append(s, data, { type: 'VEC3', componentType: 5126, count: 3, byteOffset: 8 });
    s.doc.bufferViews[s.doc.accessors[accessor].bufferView].byteStride = 16; s.doc.meshes[0].primitives[0].attributes.POSITION = accessor;
  });
  assert.equal(read(changed).geometryFingerprintSha256, baseline.geometryFingerprintSha256);
});
test('normalized uint8 WEIGHTS decode to identical values', () => {
  const changed = mutate(original, s => {
    const data = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0]);
    s.doc.meshes[0].primitives[0].attributes.WEIGHTS_0 = append(s, data, { type: 'VEC4', componentType: 5121, normalized: true, count: 3 });
  });
  assert.equal(read(changed).weightsFingerprintSha256, baseline.weightsFingerprintSha256);
});
test('all influence sets are decoded and out-of-domain extra-set joints fail', () => {
  const changed = mutate(original, s => {
    const attrs = s.doc.meshes[0].primitives[0].attributes;
    attrs.JOINTS_1 = append(s, Buffer.alloc(24), { type: 'VEC4', componentType: 5123, count: 3 });
    attrs.WEIGHTS_1 = append(s, Buffer.alloc(48), { type: 'VEC4', componentType: 5126, count: 3 });
  });
  assert.equal(read(changed).primitives[0].influenceSets, 2);
  const broken = mutate(changed, s => {
    const id = s.doc.meshes[0].primitives[0].attributes.JOINTS_1, view = s.doc.bufferViews[s.doc.accessors[id].bufferView]; s.bin.writeUInt16LE(999, view.byteOffset);
  }); assert.throws(() => read(broken), /JOINTS outside skin domain/);
});
test('omitted IBM is equivalent to explicit identity matrices', () => {
  assert.equal(read(syntheticGLB()).bindFingerprintSha256, baseline.bindFingerprintSha256);
});

for (const key of ['translation', 'rotation', 'scale', 'matrix', 'children'])
  test(`reject explicit null node ${key}`, () => assert.throws(() => read(mutate(original, s => s.doc.nodes[1][key] = null)), /null node/));
test('reject duplicate JSON keys including escaped equivalent', () => {
  const {doc, bin} = split(original), text = JSON.stringify(doc);
  const changed = text.replace('"asset":{', '"asset":{"version":"bad",');
  assert.notEqual(changed, text); assert.throws(() => read(pack(changed, bin)), /duplicate JSON key/);
  const escaped = text.replace('"asset":{', '"asset":{"vers\\u0069on":"bad",');
  assert.notEqual(escaped, text); assert.throws(() => read(pack(escaped, bin)), /duplicate JSON key/);
});
test('cap combined normalized-weight precision and influence-set count', () => {
  const changed = mutate(original, s => {
    const attrs = s.doc.meshes[0].primitives[0].attributes;
    attrs.WEIGHTS_0 = append(s, Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0]), {type: 'VEC4', componentType: 5121, normalized: true, count: 3});
    attrs.JOINTS_1 = attrs.JOINTS_0;
    attrs.WEIGHTS_1 = append(s, Buffer.alloc(12), {type: 'VEC4', componentType: 5121, normalized: true, count: 3});
  });
  assert.throws(() => read(changed), /encoding precision unsupported/);
  const sets = mutate(original, s => {
    const attrs = s.doc.meshes[0].primitives[0].attributes;
    for (let i = 1; i < 5; i++) { attrs[`JOINTS_${i}`] = attrs.JOINTS_0; attrs[`WEIGHTS_${i}`] = attrs.WEIGHTS_0; }
  }); assert.throws(() => read(sets), /four influence sets unsupported/);
});
test('aggregate allocation counts metadata-derived default IBM matrices', () => {
  const changed = mutate(original, s => {
    s.doc.nodes = Array.from({length: 1000}, () => ({}));
    s.doc.skins = Array.from({length: 250}, () => ({joints: Array.from({length: 1000}, (_, i) => i)}));
  });
  assert.throws(() => read(changed), /aggregate allocation\/work limit/);
});
test('reject independent stride, offset, normalization and extra skin-set mutations', () => {
  assert.throws(() => read(mutate(original, s => s.doc.bufferViews[0].byteStride = 8)), /alignment\/stride/);
  assert.throws(() => read(mutate(original, s => s.doc.accessors[0].byteOffset = 1)), /alignment\/stride/);
  assert.throws(() => read(mutate(original, s => s.doc.accessors[0].byteOffset = null)), /bufferView bounds/);
  assert.throws(() => read(mutate(original, s => s.doc.accessors[2].normalized = true)), /normalized component/);
  assert.throws(() => read(mutate(original, s => s.doc.meshes[0].primitives[0].attributes.JOINTS_1 = 1)), /paired contiguous/);
});
