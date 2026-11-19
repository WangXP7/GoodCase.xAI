import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
export const VERSION = 'cs-bind-inspection/1';
const MAX_BYTES = 64 * 1024 * 1024, MAX_VALUES = 4_000_000;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const must = (ok, message) => { if (!ok) throw new Error(message); };
const index = (n, length) => Number.isSafeInteger(n) && n >= 0 && n < length;
const natural = n => Number.isSafeInteger(n) && n >= 0;
const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const vector = (v, n) => Array.isArray(v) && v.length === n && v.every(Number.isFinite);
function fingerprint(kind, data, reserve) {
  const count = value => {
    reserve(1);
    if (Array.isArray(value)) value.forEach(count);
    else if (value && typeof value === 'object') Object.values(value).forEach(count);
  };
  count(data); return sha(JSON.stringify({ version: VERSION, kind, data }));
}
function strictJSON(source) {
  const parsed = JSON.parse(source); let cursor = 0;
  const space = () => { while (cursor < source.length && /\s/.test(source[cursor])) cursor++; };
  const string = () => {
    const start = cursor++;
    while (cursor < source.length) { const c = source[cursor++]; if (c === '\\') cursor++; else if (c === '"') return JSON.parse(source.slice(start, cursor)); }
    throw new Error('unterminated JSON string');
  };
  const scan = depth => {
    must(depth <= 128, 'JSON nesting limit'); space();
    if (source[cursor] === '{') {
      cursor++; space(); const keys = new Set(); if (source[cursor] === '}') { cursor++; return; }
      for (;;) { space(); const key = string(); must(!keys.has(key), 'duplicate JSON key'); keys.add(key); space(); cursor++; scan(depth + 1); space(); if (source[cursor++] === '}') return; }
    }
    if (source[cursor] === '[') {
      cursor++; space(); if (source[cursor] === ']') { cursor++; return; }
      for (;;) { scan(depth + 1); space(); if (source[cursor++] === ']') return; }
    }
    if (source[cursor] === '"') { string(); return; }
    while (cursor < source.length && !/[\s,}\]]/.test(source[cursor])) cursor++;
  };
  scan(0);
  const finite = value => { if (typeof value === 'number') must(Number.isFinite(value), 'non-finite JSON number'); else if (value && typeof value === 'object') Object.values(value).forEach(finite); };
  finite(parsed); return parsed;
}
function matrixMultiply(a, b) {
  const out = Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  must(out.every(Number.isFinite), 'non-finite world matrix'); return out;
}
function checkMatrix(m) {
  must(vector(m, 16), 'matrix requires 16 finite numbers');
  must(m[3] === 0 && m[7] === 0 && m[11] === 0 && m[15] === 1, 'non-affine matrix unsupported');
  const determinant = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
  must(Number.isFinite(determinant) && determinant !== 0, 'singular matrix unsupported'); return m;
}
function localMatrix(node) {
  must(node && typeof node === 'object' && !Array.isArray(node), 'node must be object');
  for (const key of ['matrix', 'translation', 'rotation', 'scale', 'children']) must(node[key] !== null, `null node ${key}`);
  if (node.matrix !== undefined) {
    must(['translation', 'rotation', 'scale'].every(k => node[k] === undefined), 'matrix and TRS cannot coexist');
    return checkMatrix(node.matrix);
  }
  const t = node.translation ?? [0, 0, 0], q = node.rotation ?? [0, 0, 0, 1], s = node.scale ?? [1, 1, 1];
  must(vector(t, 3) && vector(q, 4) && vector(s, 3), 'invalid TRS values');
  must(Math.abs(Math.hypot(...q) - 1) <= 1e-5, 'non-unit quaternion');
  const [x, y, z, w] = q, [sx, sy, sz] = s;
  return checkMatrix([(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, ...t, 1]);
}
function parse(bytes, expectedSha256) {
  must(Buffer.isBuffer(bytes) && bytes.length <= MAX_BYTES, 'GLB byte safety limit');
  must(typeof expectedSha256 === 'string' && /^[a-f0-9]{64}$/.test(expectedSha256), 'expected SHA-256 required');
  must(sha(bytes) === expectedSha256, 'source hash mismatch');
  must(bytes.length >= 20 && bytes.readUInt32LE(0) === 0x46546c67 && bytes.readUInt32LE(4) === 2 && bytes.readUInt32LE(8) === bytes.length, 'invalid GLB header/length');
  let offset = 12, document, bin, chunk = 0;
  while (offset < bytes.length) {
    must(offset + 8 <= bytes.length, 'truncated GLB chunk');
    const n = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4);
    must(n % 4 === 0 && offset + 8 + n <= bytes.length, 'invalid GLB chunk bounds');
    if (chunk === 0) {
      must(type === 0x4e4f534a && n <= 4 * 1024 * 1024, 'JSON chunk missing/too large');
      document = strictJSON(bytes.toString('utf8', offset + 8, offset + 8 + n));
    } else { must(chunk === 1 && type === 0x004e4942, 'unsupported GLB chunk'); bin = bytes.subarray(offset + 8, offset + 8 + n); }
    offset += n + 8; chunk++;
  }
  must(document?.asset?.version === '2.0' && bin, 'embedded glTF2 BIN required');
  for (const key of ['nodes', 'skins', 'meshes', 'accessors', 'bufferViews', 'buffers']) must(Array.isArray(document[key]), `${key} array required`);
  must(document.buffers.length === 1 && !Object.hasOwn(document.buffers[0], 'uri'), 'single embedded buffer required');
  const length = document.buffers[0].byteLength;
  must(natural(length) && length <= bin.length && bin.length - length <= 3, 'BIN byteLength mismatch');
  must((document.nodes.length <= 10000) && document.accessors.length <= 10000, 'metadata safety limit');
  must(!(document.extensionsRequired ?? []).some(e => ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_mesh_quantization'].includes(e)), 'compressed/quantized geometry unsupported');
  return { document, bin: bin.subarray(0, length) };
}
function decoder(doc, bin, reserve) {
  const cache = new Map();
  const components = { 5120: [1, 'readInt8', 127], 5121: [1, 'readUInt8', 255], 5122: [2, 'readInt16LE', 32767], 5123: [2, 'readUInt16LE', 65535], 5125: [4, 'readUInt32LE', null], 5126: [4, 'readFloatLE', null] };
  return id => {
    must(index(id, doc.accessors.length), 'accessor index out of range');
    if (cache.has(id)) return cache.get(id);
    const a = doc.accessors[id], arity = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type], spec = components[a.componentType];
    must(a.sparse === undefined, 'sparse accessor unsupported');
    must(arity && spec && (a.type !== 'MAT4' || a.componentType === 5126), 'accessor type unsupported');
    must(a.normalized === undefined || typeof a.normalized === 'boolean', 'normalized must be boolean');
    must(!a.normalized || spec[2] !== null, 'normalized component type unsupported');
    must(Number.isSafeInteger(a.count) && a.count > 0 && a.count * arity <= MAX_VALUES, 'accessor allocation limit');
    must(index(a.bufferView, doc.bufferViews.length), 'accessor needs explicit bufferView');
    const view = doc.bufferViews[a.bufferView], base = view.byteOffset === undefined ? 0 : view.byteOffset, local = a.byteOffset === undefined ? 0 : a.byteOffset, element = arity * spec[0], stride = view.byteStride === undefined ? element : view.byteStride;
    must(!view.extensions?.EXT_meshopt_compression && view.buffer === 0, 'unsupported bufferView');
    must(natural(base) && natural(local) && natural(view.byteLength) && base + view.byteLength <= bin.length, 'bufferView bounds');
    must(base % spec[0] === 0 && local % spec[0] === 0 && Number.isSafeInteger(stride) && stride >= element && stride % spec[0] === 0, 'accessor alignment/stride');
    if (view.byteStride !== undefined) must(stride >= 4 && stride <= 252 && stride % 4 === 0, 'invalid byteStride');
    must(local + (a.count - 1) * stride + element <= view.byteLength, 'accessor exceeds bufferView');
    reserve(a.count * arity); const values = new Array(a.count * arity);
    for (let n = 0; n < a.count; n++) for (let c = 0; c < arity; c++) {
      let value = bin[spec[1]](base + local + n * stride + c * spec[0]);
      if (a.normalized) value = Math.max(-1, value / spec[2]);
      must(Number.isFinite(value), 'non-finite accessor value'); values[n * arity + c] = value === 0 ? 0 : value;
    }
    const result = { values, type: a.type, componentType: a.componentType, normalized: a.normalized === true, count: a.count, arity };
    cache.set(id, result); return result;
  };
}
export function inspectBindBytes(bytes, expectedSha256, expectedFingerprints = {}) {
  const { document: d, bin } = parse(bytes, expectedSha256); let used = 0;
  const reserve = n => { must(Number.isSafeInteger(n) && n >= 0 && n <= MAX_VALUES - used, 'aggregate allocation/work limit'); used += n; };
  reserve(d.nodes.length * 34);
  const decode = decoder(d, bin, reserve), parents = Array(d.nodes.length).fill(null);
  const locals = d.nodes.map(localMatrix), worlds = Array(d.nodes.length);
  d.nodes.forEach((node, parent) => {
    must(node.children === undefined || Array.isArray(node.children), 'children must be array');
    for (const child of node.children ?? []) {
      must(index(child, d.nodes.length), 'child index out of range');
      must(parents[child] === null, 'duplicate child/multiple parents'); parents[child] = parent;
    }
  });
  for (let start = 0; start < d.nodes.length; start++) {
    const chain = [], visited = new Set(); let node = start;
    while (node !== null && !worlds[node]) { must(!visited.has(node), 'hierarchy cycle'); visited.add(node); chain.push(node); node = parents[node]; }
    while (chain.length) { const i = chain.pop(); worlds[i] = parents[i] === null ? locals[i] : matrixMultiply(worlds[parents[i]], locals[i]); }
  }
  const skins = d.skins.map(skin => {
    must(Array.isArray(skin.joints) && skin.joints.length > 0 && new Set(skin.joints).size === skin.joints.length && skin.joints.every(j => index(j, d.nodes.length)), 'invalid/duplicate skin joints');
    if (skin.skeleton !== undefined) {
      must(index(skin.skeleton, d.nodes.length), 'invalid skeleton root');
      for (const joint of skin.joints) { let p = joint; while (p !== null && p !== skin.skeleton) p = parents[p]; must(p !== null, 'skeleton not ancestor of joint'); }
    }
    reserve(skin.joints.length * 16); let matrices;
    if (skin.inverseBindMatrices === undefined) matrices = skin.joints.map(identity);
    else {
      const ibm = decode(skin.inverseBindMatrices);
      must(ibm.type === 'MAT4' && ibm.componentType === 5126 && !ibm.normalized && ibm.count === skin.joints.length, 'IBM format/count unsupported');
      must(d.bufferViews[d.accessors[skin.inverseBindMatrices].bufferView].byteStride === undefined, 'interleaved IBM unsupported');
      matrices = skin.joints.map((_, i) => checkMatrix(ibm.values.slice(i * 16, i * 16 + 16)));
    }
    return { joints: skin.joints, skeleton: skin.skeleton ?? null, inverseBindMatrices: matrices };
  });
  const geometry = [], weights = [], assignments = [], summaries = [];
  for (let ni = 0; ni < d.nodes.length; ni++) {
    const node = d.nodes[ni];
    if (node.skin === undefined) continue;
    must(index(node.skin, skins.length) && index(node.mesh, d.meshes.length), 'invalid skin/mesh assignment');
    assignments.push({ node: ni, mesh: node.mesh, skin: node.skin, meshWorld: worlds[ni] });
    const primitives = d.meshes[node.mesh].primitives;
    must(Array.isArray(primitives) && primitives.length > 0, 'mesh primitives required');
    for (let pi = 0; pi < primitives.length; pi++) {
      const p = primitives[pi]; must(!p.extensions?.KHR_draco_mesh_compression, 'Draco primitive unsupported');
      must((p.mode === undefined ? 4 : p.mode) === 4, 'only triangle primitives supported');
      const attrs = p.attributes; must(attrs && typeof attrs === 'object', 'attributes required');
      const positions = decode(attrs.POSITION);
      must(positions.type === 'VEC3' && positions.componentType === 5126 && !positions.normalized, 'POSITION format unsupported');
      const ids = Object.keys(attrs).filter(k => /^(JOINTS|WEIGHTS)_/.test(k));
      must(ids.every(k => /^(JOINTS|WEIGHTS)_\d+$/.test(k)), 'malformed skin attribute semantic');
      const sets = ids.filter(k => k.startsWith('JOINTS_')).map(k => Number(k.slice(7))).sort((a, b) => a - b);
      must(sets.length <= 4, 'more than four influence sets unsupported');
      must(sets.length > 0 && sets.every((set, i) => set === i) && ids.length === sets.length * 2, 'paired contiguous skin sets required');
      const decoded = sets.map(set => {
        const j = decode(attrs[`JOINTS_${set}`]), w = decode(attrs[`WEIGHTS_${set}`]);
        must(j.type === 'VEC4' && [5121, 5123].includes(j.componentType) && !j.normalized && j.count === positions.count, 'JOINTS format/count invalid');
        must(w.type === 'VEC4' && w.count === positions.count && ((w.componentType === 5126 && !w.normalized) || ([5121, 5123].includes(w.componentType) && w.normalized)), 'WEIGHTS format/count invalid');
        return { joints: j.values, weights: w.values, quantum: w.componentType === 5121 ? 1 / 255 : w.componentType === 5123 ? 1 / 65535 : 0 };
      });
      const quantizationBound = decoded.reduce((n, v) => n + 2 * v.quantum, 0);
      must(quantizationBound <= 2 / 255, 'combined weight encoding precision unsupported');
      const tolerance = Math.max(1e-4, quantizationBound);
      reserve(skins[node.skin].joints.length * 5);
      const support = Array(skins[node.skin].joints.length).fill(0); let maximumSumError = 0;
      for (let v = 0; v < positions.count; v++) {
        let sum = 0;
        for (const set of decoded) for (let k = 0; k < 4; k++) {
          const i = v * 4 + k, j = set.joints[i], w = set.weights[i];
          must(index(j, support.length), 'JOINTS outside skin domain');
          must(w >= 0 && w <= 1, 'WEIGHTS outside [0,1]'); sum += w; if (w > 0) support[j]++;
        }
        maximumSumError = Math.max(maximumSumError, Math.abs(sum - 1));
        must(sum > 0 && Math.abs(sum - 1) <= tolerance, 'WEIGHTS sum outside encoding tolerance');
      }
      const shape = Object.keys(attrs).filter(k => !/^(JOINTS|WEIGHTS)_/.test(k)).sort().map(k => {
        const a = decode(attrs[k]); must(a.count === positions.count, 'attribute count mismatch'); return [k, a.type, a.values];
      });
      let indices = null;
      if (p.indices !== undefined) { const a = decode(p.indices); must(a.type === 'SCALAR' && [5121, 5123, 5125].includes(a.componentType) && !a.normalized, 'indices format invalid'); indices = a.values; must(indices.every(i => index(i, positions.count)), 'index outside vertex domain'); }
      must((indices?.length ?? positions.count) % 3 === 0, 'triangle element count');
      must(p.targets === undefined || Array.isArray(p.targets), 'morph targets array required');
      const morphs = (p.targets ?? []).map(target => Object.keys(target).sort().map(k => {
        must(['POSITION', 'NORMAL', 'TANGENT'].includes(k), 'morph semantic unsupported'); const a = decode(target[k]);
        must(a.type === 'VEC3' && a.componentType === 5126 && !a.normalized && a.count === positions.count, 'morph format invalid'); return [k, a.values];
      }));
      geometry.push({ node: ni, primitive: pi, attributes: shape, indices, morphs });
      weights.push({ node: ni, primitive: pi, skin: node.skin, sets: decoded.map(s => ({ joints: s.joints, weights: s.weights })) });
      summaries.push({ node: ni, mesh: node.mesh, primitive: pi, vertices: positions.count, influenceSets: sets.length, maximumSumError, tolerance,
        weightedJoints: support.flatMap((count, joint) => count ? [{ joint, node: skins[node.skin].joints[joint], name: typeof d.nodes[skins[node.skin].joints[joint]].name === 'string' ? d.nodes[skins[node.skin].joints[joint]].name.slice(0, 128) : null, nonzeroInfluences: count }] : []) });
    }
  }
  must(assignments.length > 0, 'no skinned mesh assignments');
  const bind = { convention: 'glTF-column-major-TRS-T*R*S-xyzw-source-units', nodes: d.nodes.map((n, i) => ({ parent: parents[i], children: n.children ?? [], local: locals[i] })), skins, assignments };
  const report = { version: VERSION, status: 'draft', sourceAssetSha256: expectedSha256, bytes: bytes.length,
    bindFingerprintSha256: fingerprint('bind', bind, reserve), geometryFingerprintSha256: fingerprint('geometry', geometry, reserve), weightsFingerprintSha256: fingerprint('weights', weights, reserve),
    nodeCount: d.nodes.length, skinCount: skins.length, primitives: summaries,
    contactApproved: false, runtimeEnabled: false, unverified: ['anatomical-contact', 'art-and-fit', 'inverse-bind-rest-consistency', 'animations', 'material-and-texture-content', 'runtime-normalization-recipe', 'default-morph-weights', 'unskinned-geometry'] };
  must(expectedFingerprints && typeof expectedFingerprints === 'object' && !Array.isArray(expectedFingerprints), 'expected fingerprints object required');
  for (const [key, hash] of Object.entries(expectedFingerprints)) {
    must(['bindFingerprintSha256', 'geometryFingerprintSha256', 'weightsFingerprintSha256'].includes(key) && typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash), 'invalid expected fingerprint');
    must(report[key] === hash, `${key} mismatch`);
  }
  return report;
}
export function inspectBindFile(path, expectedSha256, expectedFingerprints = {}) {
  must(statSync(path).isFile() && statSync(path).size <= MAX_BYTES, 'GLB file safety limit');
  return inspectBindBytes(readFileSync(path), expectedSha256, expectedFingerprints);
}
