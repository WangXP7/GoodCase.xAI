#!/usr/bin/env node
import { mkdirSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createExample } from './example.mjs';
import { sha256 } from './kit.mjs';
import { GRIP_VERSION, validateGripProfile } from './grip-profile.mjs';
export function createGripExample(directory) {
  const target = resolve(directory);
  if (lstatSync(target, { throwIfNoEntry: false })) throw new Error('refusing to overwrite existing destination');
  let parent = dirname(target);
  for (;;) {
    const metadata = lstatSync(parent);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error('destination parent must be a real directory without symlinks');
    const next = dirname(parent); if (next === parent) break; parent = next;
  }
  if (!basename(target)) throw new Error('new directory required');
  mkdirSync(target);
  const pkg = createExample(target);
  writeFileSync(join(target, 'GRIP-SOURCE.md'), '# Synthetic test-only grip\nNo real hand, weapon, animation, contact, IK, fit or accepted artwork is represented. glasses.glb is a triangle used as a mock weapon. All regions and clip identities are declarations for validator testing only.\n', { flag: 'wx' });
  const ref = path => ({ path, sha256: sha256(readFileSync(join(target, path))) });
  const region = weapon => ({ id: 'synthetic-contact', semantic: weapon ? 'handle' : 'gripping', source: ref(weapon ? 'glasses.glb' : 'body.glb'), space: weapon ? 'weapon-normalized-local' : 'mesh-local-bind', mesh: 0, primitive: 0, vertices: [0], normal: [0, 1, 0], rotation: [0, 0, 0, 1] });
  const hand = () => ({ anatomy: 'mascot', closure: 'baked', ownership: 'clip-owned', actuators: [], regions: [region(false)] });
  const profile = { schemaVersion: GRIP_VERSION, status: 'draft', profileId: 'synthetic-test-only-grip', revision: 1,
    subject: { packageId: pkg.packageId, bodyId: pkg.body.id, family: pkg.body.family, fitProfile: pkg.body.fitProfile, rigId: pkg.rig.id, rigRevision: pkg.rig.revision, restPoseSha256: pkg.rig.restPoseSha256, asset: ref('body.glb') },
    coordinates: { units: 'meters', up: '+Y', forward: '+Z' },
    provenance: { author: 'CORO SOLTO synthetic test generator', source: 'tools/character-kit/grip-example.mjs', license: 'synthetic-test-only', evidence: ref('GRIP-SOURCE.md') },
    weapon: { id: 'synthetic-test-only-weapon', revision: 1, asset: ref('glasses.glb'), normalization: ref('GRIP-SOURCE.md'), regions: [region(true)], requiredContacts: ['handle'] },
    hands: { left: hand(), right: hand() }, policy: { mode: 'oneHand', dominant: 'right', support: 'authored-free-pose', reason: 'Synthetic policy declaration only; no art is present', evidence: ref('GRIP-SOURCE.md') },
    poses: [{ phase: 'idle', clip: 'synthetic-test-only-no-real-clip', source: ref('body.glb'), dominantContact: 'maintain', supportContact: 'none' }] };
  validateGripProfile(profile, target, pkg);
  writeFileSync(join(target, 'grip-profile.json'), `${JSON.stringify(profile, null, 2)}\n`, { flag: 'wx' });
  return profile;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error('usage: grip-example.mjs NEW_DIRECTORY');
    createGripExample(process.argv[2]);
  } catch (error) { console.error(`grip-example: ${error.message}`); process.exitCode = 1; }
}
