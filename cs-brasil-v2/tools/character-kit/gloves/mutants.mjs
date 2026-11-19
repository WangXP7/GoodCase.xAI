#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mutateGLBAccessor, sha256 } from './core.mjs';
import { verifyRepository } from './repository.mjs';

const clone = value => JSON.parse(JSON.stringify(value));

export function runMutants(root) {
  const manifestPath = path.join(root, 'public/data/gloves-manifest.json');
  const baseline = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const package3p = baseline.packages.find(entry => entry.perspective === '3p');
  assert.ok(package3p, '3p package required for mutants');
  const variant = package3p.sourceVariants[0];
  const originalOutput = fs.readFileSync(path.join(root, variant.mesh.path));
  const cases = [
    {
      name: 'weights',
      prepare() {
        const manifest = clone(baseline);
        const target = manifest.packages.find(entry => entry.id === package3p.id).sourceVariants[0];
        const bytes = mutateGLBAccessor(originalOutput, 'WEIGHTS_0');
        target.mesh.sha256 = sha256(bytes);
        return { manifest, overrides: new Map([[variant.mesh.path, bytes]]) };
      },
    },
    {
      name: 'inverse-bind',
      prepare() {
        const manifest = clone(baseline);
        const target = manifest.packages.find(entry => entry.id === package3p.id).sourceVariants[0];
        const bytes = mutateGLBAccessor(originalOutput, 'INVERSE_BIND_MATRICES');
        target.mesh.sha256 = sha256(bytes);
        return { manifest, overrides: new Map([[variant.mesh.path, bytes]]) };
      },
    },
    {
      name: 'missing-joint',
      prepare() {
        const manifest = clone(baseline);
        const target = manifest.packages.find(entry => entry.id === package3p.id).sourceVariants[0];
        const bytes = mutateGLBAccessor(originalOutput, 'JOINTS_0');
        target.mesh.sha256 = sha256(bytes);
        return { manifest, overrides: new Map([[variant.mesh.path, bytes]]) };
      },
    },
    {
      name: 'digest-divergence',
      prepare() {
        const manifest = clone(baseline);
        manifest.packages.find(entry => entry.id === package3p.id).sourceVariants[0].source.sha256 = '0'.repeat(64);
        return { manifest, overrides: new Map() };
      },
    },
    {
      name: 'double-hand-removal',
      prepare() {
        const manifest = clone(baseline);
        manifest.packages.find(entry => entry.id === package3p.id).handOwnership.sourceHandRemovalCount = 2;
        return { manifest, overrides: new Map() };
      },
    },
    {
      name: 'wrong-skeleton-family',
      prepare() {
        const manifest = clone(baseline);
        manifest.packages.find(entry => entry.id === package3p.id).skeletonFamily.fingerprintSha256 = 'f'.repeat(64);
        return { manifest, overrides: new Map() };
      },
    },
  ];
  const results = [];
  for (const mutation of cases) {
    const { manifest, overrides } = mutation.prepare();
    const readAsset = relative => overrides.get(relative) ?? fs.readFileSync(path.join(root, relative));
    let error = null;
    try {
      verifyRepository(root, { manifest, readAsset });
    } catch (caught) {
      error = caught;
    }
    assert.ok(error, `${mutation.name} mutant survived`);
    results.push({ mutation: mutation.name, killed: true, error: error.message });
  }
  return results;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  if (process.argv.length !== 2) {
    console.error('usage: node tools/character-kit/gloves/mutants.mjs');
    process.exit(2);
  }
  const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
  try {
    console.log(JSON.stringify({ status: 'PASS', mutants: runMutants(root) }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ status: 'FAIL', error: error.message }, null, 2));
    process.exitCode = 1;
  }
}
