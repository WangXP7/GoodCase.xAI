#!/usr/bin/env node
// O auditor antigo só reconhecia /img/decals: pixo em textura/canvas passava
// sem inventário. As mesmas cenas reais ficam verdes nesse mutante cego.
import assert from 'node:assert/strict';
import { THREE } from './harness.mjs';
import { superficieGrafitavel } from '../../public/js/graffiti_surface.js';
import { identifyGraffitiTexture, inventoryGraffitiMaterials, trackGraffitiCanvases } from './graffiti-art-inventory.mjs';

class CanvasContext {
  constructor(canvas) { this.canvas = canvas; }
  stroke() { return 'native-stroke'; }
  fillText() { return 'native-fill'; }
  strokeText() { return 'native-text-stroke'; }
  drawImage() { return 'native-copy'; }
}
globalThis.CanvasRenderingContext2D = CanvasContext;
trackGraffitiCanvases({ graffitiStart: 1, graffitiEnd: 3 });
function pixacaoTex() {
  const canvas = { width: 256, height: 128 }, ctx = new CanvasContext(canvas);
  assert.equal(ctx.stroke(), 'native-stroke'); return new THREE.CanvasTexture(canvas);
}
function pixoLine() {
  const canvas = { width: 512, height: 128 }; new CanvasContext(canvas).stroke();
  return new THREE.CanvasTexture(canvas);
}
const image = path => new THREE.Texture({ src: `http://fixture/${path}`, width: 512, height: 512 });
const wall = texture => new THREE.Mesh(new THREE.BoxGeometry(4, 4, .2), new THREE.MeshLambertMaterial({ map: texture }));
const root = (...meshes) => { const r = new THREE.Group(); r.add(...meshes); r.updateMatrixWorld(true); return r; };
const sources = globalThis.__graffitiCanvasSources;
const inventory = (scene, identify = identifyGraffitiTexture) => inventoryGraffitiMaterials(scene, THREE, superficieGrafitavel, identify, sources);
const bad = entries => entries.filter(e => e.needsWallReview || e.classification === 'painted-surface' && !e.eligibleSurface);
let count = 0;
const check = (name, body) => { body(); count++; console.log(`PASS ${name}`); };
const concrete = wall(image('img/textures/corrego_streetart_pixo.webp'));
check('painted actual wall remains an eligible physical support', () => {
  const scene = root(concrete), entry = inventory(scene)[0];
  assert.equal(entry.classification, 'painted-surface'); assert.equal(entry.eligibleSurface, true);
  assert.equal(bad(inventory(scene)).length, 0); assert.equal(scene.children[0], concrete);
});
check('unloaded painted surface remains inventoried and visibly invalid', () => {
  const texture = image('img/textures/campomorro_streetart_baile.webp');
  texture.image.width = 0; texture.image.height = 0;
  const entries = inventory(root(wall(texture)));
  assert.equal(entries.length, 1); assert.equal(entries[0].visibleArtwork, false);
});
check('lambe texture is inventoried but geometric tile is not graffiti', () => {
  assert.equal(inventory(root(wall(image('img/textures/campomorro_streetart_baile.webp')))).length, 1);
  assert.equal(inventory(root(wall(image('img/textures/escadao_streetart_azulejo.webp')))).length, 0);
});
const onPlant = wall(image('img/textures/corrego_streetart_pixo.webp')); onPlant.name = 'samambaia';
check('real pixo material on opaque plant cannot remain unmeasured', () => {
  const entries = inventory(root(onPlant)); assert.equal(entries.length, 1); assert.equal(bad(entries).length, 1);
});
const floating = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.7), new THREE.MeshBasicMaterial({ map: pixacaoTex() }));
floating.position.set(0, 3, 0);
check('unclassified floating procedural pixo is detected despite no URL or art name', () => {
  const entries = inventory(root(floating)); assert.equal(entries.length, 1);
  assert.equal(entries[0].artwork.producer, 'pixacaoTex'); assert.equal(bad(entries).length, 1);
});
check('procedural pixoLine producer is traced', () => assert.equal(identifyGraffitiTexture(pixoLine(), sources).producer, 'pixoLine'));
check('canvas copying retains art provenance', () => {
  const canvas = { width: 256, height: 128 }, ctx = new CanvasContext(canvas);
  assert.equal(ctx.drawImage(floating.material.map.image), 'native-copy');
  assert.equal(identifyGraffitiTexture(new THREE.CanvasTexture(canvas), sources).producer, 'pixacaoTex');
});
check('T.graffiti source range identifies text rendering', () => {
  const canvas = { width: 512, height: 256 }; globalThis.__inventoryFixtureContext = new CanvasContext(canvas);
  (0, eval)('globalThis.__inventoryFixtureContext.fillText("TRETA",0,0);\n//# sourceURL=file:///fixtures/textures.js');
  assert.equal(identifyGraffitiTexture(new THREE.CanvasTexture(canvas), sources).producer, 'T.graffiti');
});
check('ordinary procedural canvas is not called graffiti', () => {
  const canvas = { width: 256, height: 128 }; new CanvasContext(canvas).stroke();
  assert.equal(identifyGraffitiTexture(new THREE.CanvasTexture(canvas), sources), null);
});
check('tagged procedural overlay stays in the existing support pipeline', () => {
  floating.name = 'decal:pixo-fixture';
  const entry = inventory(root(floating))[0]; assert.equal(entry.classification, 'declared-overlay');
  assert.equal(entry.needsWallReview, false); floating.name = '';
});
check('unrendered material groups cannot inflate artwork inventory', () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 4, .2), [new THREE.MeshLambertMaterial(), onPlant.material]);
  mesh.geometry.clearGroups(); mesh.geometry.addGroup(0, 36, 0);
  assert.equal(inventory(root(mesh)).length, 0);
});
const legacy = texture => {
  const src = texture?.image?.src;
  return typeof src === 'string' && /\/img\/decals\//.test(src) ? { kind: 'image', family: 'decal', path: src } : null;
};
for (const [name, mesh] of [['plant', onPlant], ['floating-canvas', floating]]) {
  assert.equal(bad(inventory(root(mesh))).length, 1);
  assert.equal(bad(inventory(root(mesh), legacy)).length, 0, `${name} proves the old URL-only detector falsely reports no art`);
}
console.log(JSON.stringify({ fixtures: count, mutationsDetected: ['plant', 'floating-canvas'], noSourcePatched: true }));
