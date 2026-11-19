import { readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { sha256, validatePackage } from './kit.mjs';
export const GRIP_VERSION = 'cs-grip-profile/1';
export const GRIP_PHASES = ['idle', 'walk', 'run', 'crouch', 'aim', 'shoot', 'reload', 'jump', 'land', 'death', 'revive'];
const check = (ok, message) => { if (!ok) throw new Error(message); };
const keys = (v, names, at) => {
  check(v !== null && typeof v === 'object' && !Array.isArray(v), `${at}: object required`);
  check(Object.keys(v).every(k => names.includes(k)), `${at}: unknown field`);
  check(names.every(k => Object.hasOwn(v, k)), `${at}: missing field`);
};
const text = v => typeof v === 'string' && v.trim().length > 0;
const id = v => typeof v === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(v);
const digest = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const integer = v => Number.isInteger(v) && v >= 0;
function finite(v) {
  if (typeof v === 'number') check(Number.isFinite(v), 'non-finite number');
  else if (Array.isArray(v)) v.forEach(finite);
  else if (v && typeof v === 'object') Object.values(v).forEach(finite);
}
function unit(v, n, at) {
  check(Array.isArray(v) && v.length === n && v.every(Number.isFinite) && Math.abs(Math.hypot(...v) - 1) < 1e-6, `${at}: invalid unit vector/quaternion`);
}
function file(root, ref, at) {
  keys(ref, ['path', 'sha256'], at);
  check(text(ref.path) && !isAbsolute(ref.path) && !/[\\%\x00-\x1f]/.test(ref.path) && ref.path.split('/').every(s => s && s !== '.' && s !== '..'), `${at}: unsafe path`);
  check(digest(ref.sha256), `${at}: invalid hash`);
  const base = realpathSync(root), target = realpathSync(resolve(base, ref.path)), rel = relative(base, target);
  check(rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), `${at}: escapes root`);
  const metadata = statSync(target);
  check(metadata.isFile(), `${at}: file required`);
  check(metadata.size <= 256 * 1024 * 1024, `${at}: file exceeds 256MiB limit`);
  const bytes = readFileSync(target);
  check(bytes.length > 0 && sha256(bytes) === ref.sha256, `${at}: empty file or hash mismatch`);
}
function region(v, root, at, weapon = false) {
  keys(v, ['id', 'semantic', 'source', 'space', 'mesh', 'primitive', 'vertices', 'normal', 'rotation'], at);
  check(id(v.id) && (weapon ? ['handle', 'trigger', 'guard'] : ['palm-bearing', 'gripping', 'trigger', 'support']).includes(v.semantic), `${at}: invalid semantic`);
  file(root, v.source, `${at}.source`);
  check(v.space === (weapon ? 'weapon-normalized-local' : 'mesh-local-bind'), `${at}: incompatible space`);
  check(integer(v.mesh) && integer(v.primitive), `${at}: invalid mesh/primitive`);
  check(Array.isArray(v.vertices) && v.vertices.length > 0 && v.vertices.every(integer) && new Set(v.vertices).size === v.vertices.length, `${at}: invalid/duplicate vertices`);
  unit(v.normal, 3, at); unit(v.rotation, 4, at);
}
export function validateGripProfile(p, root, pkg = null, packageRoot = root) {
  finite(p);
  keys(p, ['schemaVersion', 'status', 'profileId', 'revision', 'subject', 'coordinates', 'provenance', 'weapon', 'hands', 'policy', 'poses'], 'grip');
  check(p.schemaVersion === GRIP_VERSION && p.status === 'draft' && id(p.profileId) && integer(p.revision) && p.revision > 0, 'grip: invalid identity/status');
  keys(p.subject, ['packageId', 'bodyId', 'family', 'fitProfile', 'rigId', 'rigRevision', 'restPoseSha256', 'asset'], 'subject');
  check(['packageId', 'bodyId', 'family', 'fitProfile', 'rigId'].every(k => id(p.subject[k])) && integer(p.subject.rigRevision) && p.subject.rigRevision > 0 && digest(p.subject.restPoseSha256), 'subject: invalid identity');
  file(root, p.subject.asset, 'subject.asset');
  keys(p.coordinates, ['units', 'up', 'forward'], 'coordinates');
  check(p.coordinates.units === 'meters' && p.coordinates.up === '+Y' && p.coordinates.forward === '+Z', 'coordinate mismatch');
  keys(p.provenance, ['author', 'source', 'license', 'evidence'], 'provenance');
  check(['author', 'source', 'license'].every(k => text(p.provenance[k])), 'provenance required');
  file(root, p.provenance.evidence, 'provenance.evidence');
  keys(p.weapon, ['id', 'revision', 'asset', 'normalization', 'regions', 'requiredContacts'], 'weapon');
  check(id(p.weapon.id) && integer(p.weapon.revision) && p.weapon.revision > 0, 'weapon identity invalid');
  file(root, p.weapon.asset, 'weapon.asset'); file(root, p.weapon.normalization, 'weapon.normalization');
  check(Array.isArray(p.weapon.regions) && p.weapon.regions.length > 0, 'weapon regions required');
  p.weapon.regions.forEach((v, i) => { region(v, root, `weapon.regions.${i}`, true); check(v.source.sha256 === p.weapon.asset.sha256 && v.source.path === p.weapon.asset.path, 'weapon region source mismatch'); });
  check(new Set(p.weapon.regions.map(v => v.id)).size === p.weapon.regions.length, 'duplicate weapon region');
  check(Array.isArray(p.weapon.requiredContacts) && p.weapon.requiredContacts.length > 0 && p.weapon.requiredContacts.every(s => ['handle', 'trigger', 'guard'].includes(s)) && new Set(p.weapon.requiredContacts).size === p.weapon.requiredContacts.length, 'invalid/duplicate required contacts');
  check(p.weapon.requiredContacts.every(s => p.weapon.regions.some(r => r.semantic === s)), 'missing required weapon region');
  keys(p.hands, ['left', 'right'], 'hands');
  for (const side of ['left', 'right']) {
    const h = p.hands[side]; keys(h, ['anatomy', 'closure', 'ownership', 'actuators', 'regions'], `hands.${side}`);
    check(['human', 'paw', 'mascot'].includes(h.anatomy) && ['baked', 'weighted', 'none'].includes(h.closure), 'invalid anatomy/closure');
    check(['pose-overlay', 'clip-owned', 'none'].includes(h.ownership), 'invalid ownership');
    check(Array.isArray(h.actuators) && Array.isArray(h.regions), 'hand arrays required');
    check(h.closure === 'none' || h.regions.length > 0, 'closure requires declared contact region');
    check(h.closure === 'weighted' ? h.actuators.length > 0 && h.ownership !== 'none' : h.actuators.length === 0 && h.ownership !== 'pose-overlay', 'closure/actuator ownership mismatch');
    check(h.closure !== 'none' || h.ownership === 'none', 'none closure requires none ownership');
    check(h.closure !== 'baked' || h.ownership === 'clip-owned', 'baked closure requires clip-owned ownership');
    h.actuators.forEach(a => {
      keys(a, ['node', 'axis', 'minRadians', 'maxRadians'], 'actuator');
      check(integer(a.node) && Number.isFinite(a.minRadians) && Number.isFinite(a.maxRadians) && a.minRadians < a.maxRadians, 'invalid actuator limits'); unit(a.axis, 3, 'actuator.axis');
    });
    check(new Set(h.actuators.map(a => a.node)).size === h.actuators.length, 'duplicate actuator');
    h.regions.forEach((r, i) => { region(r, root, `hands.${side}.regions.${i}`); check(r.source.sha256 === p.subject.asset.sha256 && r.source.path === p.subject.asset.path, 'hand region source mismatch'); });
    check(new Set(h.regions.map(r => r.id)).size === h.regions.length, 'duplicate hand region');
  }
  keys(p.policy, ['mode', 'dominant', 'support', 'reason', 'evidence'], 'policy');
  check(['oneHand', 'twoHand'].includes(p.policy.mode) && ['left', 'right'].includes(p.policy.dominant) && ['authored-free-pose', 'authored-pose', 'unsupported'].includes(p.policy.support), 'invalid support policy; constrained IK is not supported by this schema');
  check(text(p.policy.reason), 'support reason required'); file(root, p.policy.evidence, 'policy.evidence');
  check(p.policy.mode !== 'oneHand' || p.policy.support === 'authored-free-pose', 'oneHand cannot have support IK/contact');
  check(p.policy.mode !== 'twoHand' || p.policy.support !== 'authored-free-pose', 'twoHand requires support policy');
  check(p.policy.mode !== 'oneHand' || !p.weapon.requiredContacts.includes('guard'), 'oneHand cannot require guard support');
  check(Array.isArray(p.poses), 'poses array required');
  const phases = new Set();
  for (const pose of p.poses) {
    keys(pose, ['phase', 'clip', 'source', 'dominantContact', 'supportContact'], 'pose');
    check(GRIP_PHASES.includes(pose.phase) && !phases.has(pose.phase), 'invalid/duplicate phase'); phases.add(pose.phase);
    check(text(pose.clip), 'clip name required'); file(root, pose.source, 'pose.source');
    check(['maintain', 'release', 'reacquire'].includes(pose.dominantContact) && ['maintain', 'release', 'reacquire', 'none', 'unsupported'].includes(pose.supportContact), 'invalid phase contact');
    check(p.policy.mode !== 'oneHand' || pose.supportContact === 'none', 'oneHand phase cannot have support contact');
    check(p.policy.support !== 'unsupported' || ['unsupported', 'release'].includes(pose.supportContact), 'unsupported policy cannot maintain support');
  }
  if (pkg !== null) {
    validatePackage(pkg, packageRoot);
    const s = p.subject;
    check(s.packageId === pkg.packageId && s.bodyId === pkg.body.id && s.family === pkg.body.family && s.fitProfile === pkg.body.fitProfile, 'incompatible package/body family/fit');
    check(s.rigId === pkg.rig.id && s.rigRevision === pkg.rig.revision && s.restPoseSha256 === pkg.rig.restPoseSha256, 'incompatible rig');
    check(s.asset.sha256 === pkg.body.asset.sha256, 'incompatible body hash');
  }
  return { status: 'draft', profileId: p.profileId, runtimeEnabled: false, contactApproved: false, fitApproved: false,
    inspection: 'structural-only', packageValidated: pkg !== null, missingPhases: GRIP_PHASES.filter(s => !phases.has(s)),
    supportRequirementSatisfied: false,
    limitations: ['geometry-and-region-indices-not-verified', 'weights-and-actuator-nodes-not-verified', 'clip-names-and-channel-ownership-not-verified', 'normalization-recipe-not-executed', 'bind-digest-declared-only', 'contact-closure-penetration-and-art-not-verified', 'constrained-ik-not-supported'] };
}

export function readGripJSON(path) {
  const metadata = statSync(path);
  check(metadata.isFile() && metadata.size <= 1024 * 1024, 'JSON file exceeds 1MiB limit or is not a file');
  const source = readFileSync(path, 'utf8');
  check(Buffer.byteLength(source, 'utf8') <= 1024 * 1024, 'JSON file exceeds 1MiB limit');
  const parsed = JSON.parse(source);
  let cursor = 0;
  const whitespace = () => { while (/\s/.test(source[cursor] ?? '') && cursor < source.length) cursor++; };
  const string = () => {
    const start = cursor++;
    while (cursor < source.length) {
      const character = source[cursor++];
      if (character === '\\') cursor++;
      else if (character === '"') return JSON.parse(source.slice(start, cursor));
    }
    throw new Error('unterminated JSON string');
  };
  const value = depth => {
    check(depth <= 128, 'JSON nesting exceeds 128 levels');
    whitespace();
    if (source[cursor] === '{') {
      cursor++; whitespace(); const seen = new Set();
      if (source[cursor] === '}') { cursor++; return; }
      for (;;) {
        whitespace(); const key = string();
        check(!seen.has(key), `duplicate JSON key: ${key}`); seen.add(key);
        whitespace(); cursor++; value(depth + 1); whitespace();
        if (source[cursor++] === '}') return;
      }
    }
    if (source[cursor] === '[') {
      cursor++; whitespace();
      if (source[cursor] === ']') { cursor++; return; }
      for (;;) { value(depth + 1); whitespace(); if (source[cursor++] === ']') return; }
    }
    if (source[cursor] === '"') { string(); return; }
    while (cursor < source.length && !/[\s,}\]]/.test(source[cursor])) cursor++;
  };
  value(0);
  check(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && Object.getPrototypeOf(parsed) === Object.prototype, 'JSON root must be a nonnull plain object');
  finite(parsed); return parsed;
}
