import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { THREE } from './harness.mjs';
import { criarSuporteGrafite } from '../../public/js/graffiti_surface.js';

const fixtureFile = fileURLToPath(new URL('./graffiti-area-audit.mjs', import.meta.url));
const fixtures = spawnSync(process.execPath, [fixtureFile], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
process.stdout.write(fixtures.stdout || '');
process.stderr.write(fixtures.stderr || '');
assert.equal(fixtures.status, 0, 'independent serialized-function fixtures must pass');
assert.match(fixtures.stdout, /Area audit: 21 serialized-function fixtures passed/);

const piece = { x: 0, y: 2, z: .13, ry: 0, w: 2, h: 2 };
function scene(plantZ) {
  const root = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 4, .2), new THREE.MeshLambertMaterial());
  wall.position.y = 2; root.add(wall);
  if (plantZ !== undefined) {
    const plant = new THREE.Mesh(new THREE.PlaneGeometry(.001, .001, 40, 40), new THREE.MeshLambertMaterial());
    plant.position.set(.25, 2.25, plantZ); plant.name = 'plant'; plant.userData.nonSolidSurface = true; root.add(plant);
  }
  return root;
}
for (const [name, plantZ, expected] of [
  ['supported wall remains accepted', undefined, true],
  ['3200 tiny foreground triangles cannot erase their total area', .115, false],
  ['3200 plant triangles behind wall do not invalidate it', .08, true],
]) {
  assert.equal(criarSuporteGrafite(scene(plantZ))(piece), expected, name);
  console.log(`PASS production: ${name}`);
}
console.log('Area audit integration: 21 serialized fixtures + 3 current-production controls passed');
