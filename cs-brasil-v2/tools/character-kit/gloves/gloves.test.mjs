import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { MATERIAL_VARIANTS, parseGLB } from './core.mjs';
import { verifyRepository } from './repository.mjs';
import { runMutants } from './mutants.mjs';

const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));

function manifest() {
  return JSON.parse(fs.readFileSync(path.join(root, 'public/data/gloves-manifest.json'), 'utf8'));
}

test('all candidate characters are accounted for without approving visual quality', { timeout: 120_000 }, () => {
  const result = verifyRepository(root);
  const all3p = [...result.supported3p, ...result.blocked3p].sort();
  assert.deepEqual(all3p, result.supported1p);
  assert.equal(new Set(all3p).size, all3p.length);
  const document = manifest();
  assert.equal(document.visualApproved, false);
  assert.equal(document.runtimeEnabled, false);
  assert.ok(document.incompatible.every(entry => ['incompatible', 'unknown'].includes(entry.status) && entry.reasonCode && entry.reason));
});

test('packages preserve joints while reducing the source to non-empty weighted glove surfaces', { timeout: 120_000 }, () => {
  const result = verifyRepository(root);
  for (const metric of result.metrics) {
    assert.ok(metric.after.vertices > 0 && metric.after.vertices < metric.before.vertices, `${metric.id} vertex reduction`);
    assert.equal(metric.after.joints, metric.before.joints, `${metric.id} joints`);
    assert.ok(metric.after.triangles > 0, `${metric.id} triangles`);
    assert.ok(metric.after.leftTriangles > 0 && metric.after.rightTriangles > 0, `${metric.id} both hands`);
    if (metric.perspective === '3p') {
      assert.ok(metric.after.nonzeroWeights > 0 && metric.after.nonzeroWeights < metric.before.nonzeroWeights, `${metric.id} weight reduction`);
    }
  }
});

test('material skins share one mesh and each mesh has disjoint left/right ownership', { timeout: 120_000 }, () => {
  const document = manifest();
  const expectedMaterials = MATERIAL_VARIANTS.map(variant => variant.id);
  for (const glovePackage of document.packages) {
    assert.deepEqual(glovePackage.materialVariantIds, expectedMaterials);
    assert.equal(glovePackage.animationOwnership.animationsEmbedded, false);
    assert.equal(glovePackage.animationOwnership.poseOverrides, false);
    assert.equal(glovePackage.animationOwnership.teleport, false);
    assert.equal(glovePackage.handOwnership.sourceHandRemovalCount, 0);
    for (const variant of glovePackage.sourceVariants) {
      const bytes = fs.readFileSync(path.join(root, variant.mesh.path));
      const glb = parseGLB(bytes).document;
      const ownership = glb.meshes.flatMap(mesh => mesh.primitives.map(primitive => primitive.extras?.handOwnership)).sort();
      assert.deepEqual(ownership, ['left', 'right']);
      assert.equal(glb.materials.length, 1);
    }
  }
});

test('weight, bind, missing-joint, digest, ownership and family mutants are killed', { timeout: 300_000 }, () => {
  const killed = runMutants(root);
  assert.deepEqual(killed.map(result => result.mutation), [
    'weights',
    'inverse-bind',
    'missing-joint',
    'digest-divergence',
    'double-hand-removal',
    'wrong-skeleton-family',
  ]);
  assert.ok(killed.every(result => result.killed && result.error));
});
