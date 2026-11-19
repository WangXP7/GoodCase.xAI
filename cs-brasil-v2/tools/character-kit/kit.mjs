import { readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { createHash } from 'node:crypto';

export const VERSION = 'cs-character-kit/1';
export const SLOTS = Object.freeze({
  eyewear: ['rigid', 'face', 10, []], headwear: ['rigid', 'head', 20, ['scalp']],
  gloves: ['skinned', null, 10, ['hands']], shirt: ['skinned', null, 10, ['torso', 'arms']],
  jacket: ['skinned', null, 20, ['torso', 'arms']], pants: ['skinned', null, 10, ['legs']],
  shoes: ['skinned', null, 10, ['feet']],
});
const ROLES = ['hips', 'spine', 'head', 'handLeft', 'handRight', 'footLeft', 'footRight'];
const REGIONS = ['scalp', 'torso', 'arms', 'hands', 'legs', 'feet'];
const fail = message => { throw new Error(message); };
const check = (condition, message) => { if (!condition) fail(message); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function keys(object, names, at) {
  check(record(object), `${at}: object required`);
  check(Object.keys(object).every(k => names.includes(k)), `${at}: unknown field`);
  check(names.every(k => Object.hasOwn(object, k)), `${at}: missing field`);
}
function finiteTree(value) {
  if (typeof value === 'number') check(Number.isFinite(value), 'non-finite number');
  else if (Array.isArray(value)) value.forEach(finiteTree);
  else if (record(value)) Object.values(value).forEach(finiteTree);
}
function strings(value, at) {
  check(Array.isArray(value) && value.every(v => typeof v === 'string' && v.length > 0), `${at}: string array required`);
  check(new Set(value).size === value.length, `${at}: duplicate value`);
}
function vector(value, count, at) {
  check(Array.isArray(value) && value.length === count && value.every(Number.isFinite), `${at}: finite vector required`);
}
export function confinedFile(root, path) {
  check(typeof path === 'string' && /^[a-zA-Z0-9_./-]+$/.test(path) && !isAbsolute(path), 'unsafe asset path');
  check(!path.split('/').some(p => p === '.' || p === '..' || !p), 'unsafe asset path');
  const base = realpathSync(root), target = realpathSync(resolve(base, path));
  const rel = relative(base, target);
  check(rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), 'asset escapes package root');
  check(statSync(target).isFile(), 'asset must be a regular file');
  return target;
}
export function readJSON(path) {
  check(statSync(path).size <= 1024 * 1024, 'manifest exceeds 1 MiB safety limit');
  const value = JSON.parse(readFileSync(path, 'utf8'));
  finiteTree(value);
  return value;
}
export function inspectGLB(path) {
  check(statSync(path).size <= 256 * 1024 * 1024, 'GLB exceeds 256 MiB safety limit');
  const b = readFileSync(path);
  check(b.length >= 20 && b.readUInt32LE(0) === 0x46546c67 && b.readUInt32LE(4) === 2, 'invalid GLB v2 header');
  check(b.readUInt32LE(8) === b.length, 'GLB length mismatch');
  let offset = 12, document, binBytes = 0, chunks = 0;
  while (offset < b.length) {
    check(offset + 8 <= b.length, 'truncated GLB chunk');
    const length = b.readUInt32LE(offset), type = b.readUInt32LE(offset + 4);
    check(length % 4 === 0 && offset + 8 + length <= b.length, 'invalid GLB chunk length');
    if (chunks === 0) {
      check(type === 0x4e4f534a, 'GLB first chunk must be JSON');
      document = JSON.parse(b.toString('utf8', offset + 8, offset + 8 + length));
    } else {
      check(chunks === 1 && type === 0x004e4942, 'unsupported GLB chunk');
      binBytes = length;
    }
    offset += 8 + length; chunks++;
  }
  finiteTree(document);
  check(document?.asset?.version === '2.0', 'glTF version must be 2.0');
  const nodes = document.nodes ?? [], skins = document.skins ?? [], meshes = document.meshes ?? [];
  for (const key of ['nodes', 'skins', 'meshes', 'buffers', 'images', 'materials', 'animations'])
    check(document[key] === undefined || Array.isArray(document[key]), `glTF ${key}: array required`);
  check((document.buffers ?? []).every(v => !Object.hasOwn(v, 'uri')) &&
    (document.images ?? []).every(v => !Object.hasOwn(v, 'uri')), 'external/data URI resources unsupported; embed in GLB');
  check((document.buffers?.length ?? 0) <= 1, 'GLB must have at most one embedded buffer');
  if (document.buffers?.length) check(Number.isInteger(document.buffers[0].byteLength) && document.buffers[0].byteLength > 0 &&
    document.buffers[0].byteLength <= binBytes && binBytes - document.buffers[0].byteLength <= 3, 'GLB BIN size mismatch');
  const jointSets = skins.map(skin => {
    check(Array.isArray(skin.joints) && skin.joints.length > 0 && new Set(skin.joints).size === skin.joints.length, 'invalid skin joints');
    return skin.joints.map(index => {
      check(Number.isInteger(index) && index >= 0 && index < nodes.length, 'invalid joint node index');
      check(typeof nodes[index]?.name === 'string' && nodes[index].name.length > 0, 'joint name required');
      return nodes[index].name;
    });
  });
  jointSets.forEach(j => check(new Set(j).size === j.length, 'duplicate joint names in skin'));
  const skinnedNodes = nodes.filter(n => n.skin !== undefined);
  for (const n of skinnedNodes) {
    check(Number.isInteger(n.skin) && n.skin >= 0 && n.skin < skins.length, 'invalid skin index');
    check(Number.isInteger(n.mesh) && n.mesh >= 0 && n.mesh < meshes.length, 'skinned node requires valid mesh');
    check(meshes[n.mesh].primitives?.length > 0 && meshes[n.mesh].primitives.every(p =>
      p.attributes?.POSITION !== undefined && p.attributes?.JOINTS_0 !== undefined && p.attributes?.WEIGHTS_0 !== undefined), 'skinned mesh missing attributes');
  }
  return { sha256: sha256(b), bytes: b.length, jointSets, skinnedNodes: skinnedNodes.length,
    meshes: meshes.length, materials: (document.materials ?? []).map(m => m.name ?? null),
    animations: (document.animations ?? []).map(a => a.name ?? null),
    extensionsRequired: document.extensionsRequired ?? [], inspection: 'metadata-only' };
}
function asset(root, value, at) {
  keys(value, ['path', 'sha256', 'provenance'], at);
  check(value.path.endsWith('.glb') && hash(value.sha256), `${at}: GLB path/hash required`);
  keys(value.provenance, ['author', 'source', 'license', 'evidence'], `${at}.provenance`);
  check(['author', 'source', 'license'].every(k => typeof value.provenance[k] === 'string' && value.provenance[k].trim()), `${at}: provenance required`);
  const evidence = confinedFile(root, value.provenance.evidence);
  check(statSync(evidence).size > 0, `${at}: empty provenance evidence`);
  const result = inspectGLB(confinedFile(root, value.path));
  check(result.sha256 === value.sha256, `${at}: asset hash mismatch`);
  check(result.meshes > 0, `${at}: mesh required`);
  return result;
}
export function validatePackage(pkg, root) {
  finiteTree(pkg);
  keys(pkg, ['schemaVersion', 'status', 'packageId', 'rig', 'body', 'items'], 'package');
  check(pkg.schemaVersion === VERSION && pkg.status === 'draft' && id(pkg.packageId), 'package version/status/id invalid');
  keys(pkg.rig, ['id', 'revision', 'restPoseSha256', 'units', 'up', 'forward', 'bones', 'sockets'], 'rig');
  check(id(pkg.rig.id) && Number.isInteger(pkg.rig.revision) && pkg.rig.revision > 0 && hash(pkg.rig.restPoseSha256), 'rig identity invalid');
  check(pkg.rig.units === 'meters' && pkg.rig.up === '+Y' && pkg.rig.forward === '+Z', 'rig coordinate convention mismatch');
  keys(pkg.rig.bones, ROLES, 'rig.bones');
  strings(Object.values(pkg.rig.bones), 'rig.bones');
  check(record(pkg.rig.sockets), 'rig.sockets required');
  for (const [name, socket] of Object.entries(pkg.rig.sockets)) {
    check(['face', 'head'].includes(name), 'unsupported socket');
    keys(socket, ['bone', 'position', 'rotation', 'scale'], `socket.${name}`);
    check(Object.values(pkg.rig.bones).includes(socket.bone), 'socket bone not mapped');
    vector(socket.position, 3, 'socket.position'); vector(socket.rotation, 4, 'socket.rotation'); vector(socket.scale, 3, 'socket.scale');
    check(Math.abs(Math.hypot(...socket.rotation) - 1) < 1e-6 && socket.scale.every(v => v > 0), 'invalid socket transform');
  }
  keys(pkg.body, ['id', 'family', 'fitProfile', 'asset'], 'body');
  check([pkg.body.id, pkg.body.family, pkg.body.fitProfile].every(id), 'body identity invalid');
  const body = asset(root, pkg.body.asset, 'body.asset');
  check(body.skinnedNodes > 0 && body.jointSets.every(j => Object.values(pkg.rig.bones).every(b => j.includes(b))), 'body missing rig bones');
  check(Array.isArray(pkg.items), 'items array required');
  const seen = new Set(), reports = {};
  for (const item of pkg.items) {
    keys(item, ['id', 'catalogId', 'slot', 'kind', 'rigId', 'rigRevision', 'restPoseSha256', 'bodyFamily', 'fitProfile', 'socket', 'layer', 'hideBodyRegions', 'excludes', 'asset'], 'item');
    check(id(item.id) && !seen.has(item.id) && id(item.catalogId), 'item id invalid/duplicate'); seen.add(item.id);
    check(Object.hasOwn(SLOTS, item.slot), 'unknown slot'); const rule = SLOTS[item.slot];
    check(item.kind === rule[0] && item.socket === rule[1] && item.layer === rule[2], 'slot/kind/socket/layer mismatch');
    check(item.rigId === pkg.rig.id && item.rigRevision === pkg.rig.revision && item.restPoseSha256 === pkg.rig.restPoseSha256, 'incompatible rig');
    check(item.bodyFamily === pkg.body.family && item.fitProfile === pkg.body.fitProfile, 'incompatible body family/fit profile');
    if (item.socket) check(Object.hasOwn(pkg.rig.sockets, item.socket), 'missing socket');
    strings(item.hideBodyRegions, 'hideBodyRegions'); strings(item.excludes, 'excludes');
    check(item.hideBodyRegions.every(r => REGIONS.includes(r) && rule[3].includes(r)), 'slot cannot hide that body region');
    check(item.excludes.every(id) && !item.excludes.includes(item.id), 'invalid exclusion id');
    const report = asset(root, item.asset, `item.${item.id}`);
    if (item.kind === 'rigid') check(report.jointSets.length === 0 && report.skinnedNodes === 0, 'rigid item contains skin');
    else check(report.skinnedNodes > 0 && report.jointSets.every(j => Object.values(pkg.rig.bones).every(b => j.includes(b))), 'skinned item missing rig bones');
    reports[item.id] = report;
  }
  check(new Set(pkg.items.map(i => i.catalogId)).size === pkg.items.length, 'duplicate catalog identity');
  return { status: 'draft', packageId: pkg.packageId, body, items: reports, fitApproved: false, runtimeEnabled: false };
}
export function planOutfit(pkg, root, selected) {
  validatePackage(pkg, root);
  strings(selected, 'selected');
  const items = selected.map(id => { const item = pkg.items.find(i => i.id === id); check(item, `unknown item: ${id}`); return item; });
  check(new Set(items.map(i => i.slot)).size === items.length, 'outfit slot conflict');
  check(items.every(i => !i.excludes.some(id => selected.includes(id))), 'outfit exclusion conflict');
  return { status: 'draft', bodyId: pkg.body.id, fitApproved: false, runtimeEnabled: false,
    attachments: items.sort((a, b) => a.layer - b.layer || a.id.localeCompare(b.id)).map(i => ({ id: i.id, kind: i.kind, socket: i.socket, layer: i.layer })),
    proposedHiddenBodyRegions: [...new Set(items.flatMap(i => i.hideBodyRegions))].sort(),
    requiredReview: ['license-evidence', 'rig-bind-and-weights', 'fit-and-clipping-motion-suite', 'materials-and-performance', 'human-visual-approval'],
    entitlement: 'server-check-required' };
}
