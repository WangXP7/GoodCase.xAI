import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { THREE } from './harness.mjs';
import * as production from '../../public/js/graffiti_pass.js';

const name = 'pixo-lajes-01.png', assetURL = new URL(`../../public/img/decals/${name}`, import.meta.url);
const raw = await sharp(assetURL.pathname).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const bins = { zero: 0, partial: 0, full: 0 };
for (let i = 3; i < raw.data.length; i += 4) bins[raw.data[i] === 0 ? 'zero' : raw.data[i] === 255 ? 'full' : 'partial']++;
assert.deepEqual([raw.info.width, raw.info.height, raw.info.channels], [288, 512, 4]);
assert.ok(bins.zero > 60000 && bins.full > 60000 && bins.partial > 0, 'real asset contains transparent paper and antialiased ink');
assert.deepEqual([...raw.data.subarray(0, 4)], [76, 105, 113, 0], 'hidden blue RGB is the old opaque-card regression');
const texture = new THREE.DataTexture(raw.data, raw.info.width, raw.info.height, THREE.RGBAFormat);
const photoRaw = await sharp(new URL('../../public/posters/or-mural-chorao.jpg', import.meta.url).pathname).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
assert.ok(photoRaw.data.every((value, index) => index % 4 !== 3 || value === 255), 'real photo stays opaque');
const photo = new THREE.DataTexture(photoRaw.data, photoRaw.info.width, photoRaw.info.height, THREE.RGBAFormat);
const makeRoot = () => {
  const root = new THREE.Group(), wall = new THREE.Mesh(new THREE.BoxGeometry(8, 4, .2), new THREE.MeshLambertMaterial());
  wall.position.y = 2; wall.name = 'fixture-concrete'; root.add(wall); return root;
};
const T = { decalFiles: [], decals: [], posterFiles: [], posterImgs: [] };
function suite(api) {
  const results = [];
  for (const path of ['baked', 'live']) for (const [artName, image, alpha] of [[name, texture, true], ['homenagem-chorao', photo, false]]) {
    const root = makeRoot();
    const result = path === 'baked'
      ? api.aplicarGrafite(root, T, { arquivos: [], pecas: [], murais: [[artName, 0, 2, .13, 0, 2, 2]] }, { [artName]: image })
      : api.pendurarMurais({ root, T, waypoints: [{ x: -2, z: 4 }, { x: 0, z: 4 }, { x: 2, z: 4 }], texturas: [image], nomes: [artName], seed: 7,
        passo: .8, alcance: 8, minLarg: 2, larg: 3, alt: 2 });
    assert.equal(result.murais, 1, `${path}/${artName}: must keep actual supported artwork`);
    const mesh = root.children.find(mesh => mesh.name === `mural:${artName}`);
    assert.ok(mesh, `${path}/${artName}: real production mesh is required`);
    const material = mesh.material;
    const valid = material.map === image && material.transparent === alpha && material.alphaTest === (alpha ? .24 : 0)
      && material.depthWrite === !alpha && material.opacity === 1 && material.polygonOffset && mesh.renderOrder === 2;
    results.push({ path, name: artName, valid, transparent: material.transparent, alphaTest: material.alphaTest, depthWrite: material.depthWrite,
      firstPixelWouldBeDrawn: !material.transparent && material.alphaTest === 0 });
  }
  return results;
}
const results = suite(production);
console.log(JSON.stringify({ asset: name, sha256: createHash('sha256').update(readFileSync(assetURL)).digest('hex'), dimensions: [raw.info.width, raw.info.height], bins, results }));
assert.ok(results.every(result => result.valid), 'pixo live and baked must discard transparent background without changing opaque photos');
if (process.argv.includes('--self-test')) {
  const sourceURL = new URL('../../public/js/graffiti_pass.js', import.meta.url), source = readFileSync(sourceURL, 'utf8');
  const marker = "nome === 'pixo-lajes-01.png'";
  assert.equal(source.split(marker).length, 2, 'mutant targets the actual shared material decision');
  const mutantSource = source.replace(marker, 'false').replace(/(\bfrom\s*)(['"])([^'"\n]+)\2/g, (_full, prefix, _quote, specifier) =>
    prefix + JSON.stringify(specifier.startsWith('.') ? new URL(specifier, sourceURL).href : import.meta.resolve(specifier)));
  assert.notEqual(mutantSource, source);
  const mutant = await import(`data:text/javascript,${encodeURIComponent(mutantSource)}`), failures = suite(mutant).filter(result => !result.valid);
  assert.deepEqual(failures.map(result => result.path), ['baked', 'live'], 'real opaque-material mutant must regress both production mounting paths');
  assert.ok(failures.every(result => result.name === name && result.firstPixelWouldBeDrawn), 'mutant must reveal the actual hidden blue RGB');
  assert.equal(readFileSync(sourceURL, 'utf8'), source);
  console.log(JSON.stringify({ realMaterialMutationDetected: true, failures: failures.map(result => `${result.path}/${result.name}`), opaquePhotoControls: 2 }));
}
