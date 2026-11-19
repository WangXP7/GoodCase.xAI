import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { placeProp, PropBatch } from '../../public/js/mapprops.js';
import { superficieGrafitavel } from '../../public/js/graffiti_surface.js';
import { preloadPropGeometry } from './prop-geometry-fixture.mjs';

// Assets reais, dois caminhos de desenho. Fachada não pode perder pintura;
// vidro/lataria e móveis não podem ganhar apoio só por serem opacos.
const cases = [['bus', false], ['dumpster', false], ['pilha_pneus', false],
  ['piscina_banco', false], ['justica', false], ['casa_favela_tijolo', true],
  ['container_escritorio', true],
  // Malha única cujo título do GLB contém "Glass": a categoria decide, não o título.
  ['ministerio', true],
  // Casas e fachadas que os mapas usam como "casas" (Quebrada, Posto, Atacadão, Obras).
  ['fav_brasileira', true], ['fav_modular', true], ['fachada_comercio', true]];
await preloadPropGeometry(cases.map(([id]) => id));
const digest = root => {
  const hash = createHash('sha256');
  root.updateMatrixWorld(true);
  root.traverse(o => {
    if (!o.isMesh) return;
    hash.update(JSON.stringify({ matrix: o.matrixWorld.elements,
      instances: o.instanceMatrix ? Array.from(o.instanceMatrix.array) : null,
      visible: o.visible, material: (Array.isArray(o.material) ? o.material : [o.material])
        .map(m => [m.side, m.visible, m.opacity, m.transparent, m.alphaTest, m.colorWrite]) }));
    for (const a of [...Object.values(o.geometry.attributes), o.geometry.index].filter(Boolean))
      hash.update(Buffer.from(a.array.buffer, a.array.byteOffset, a.array.byteLength));
  });
  return hash.digest('hex');
};
let checked = 0, causalMutants = 0;
for (const [id, wall] of cases) for (const mode of ['clone', 'batch']) {
  const root = new THREE.Group();
  if (mode === 'clone') root.add(placeProp(id, { x: 3, z: -2, targetH: 2, ry: .3 }));
  else {
    const batch = new PropBatch();
    assert.equal(batch.add(id, { x: 3, z: -2, targetH: 2, ry: .3 }), true);
    batch.build(root);
  }
  const meshes = [];
  root.traverse(o => { if (o.isMesh) meshes.push(o); });
  assert.ok(meshes.length, `${id}/${mode}: sem malha`);
  for (const mesh of meshes) {
    let owner = mesh;
    while (owner && owner.userData.mapPropId !== id) owner = owner.parent;
    assert.ok(owner, `${id}/${mode}: identidade perdida`);
  }
  const allowed = meshes.filter(superficieGrafitavel).length;
  assert.ok(wall ? allowed > 0 : allowed === 0, `${id}/${mode}: categoria de suporte errada`);
  // A Justiça já contém "flag" no nome do GLB, e a regra de materiais/nome
  // também a exclui. Os quatro outros props isolam causalmente a nova categoria.
  if (!wall && id !== 'justica') {
    const before = digest(root);
    root.traverse(o => { delete o.userData.graffitiSupportExcluded; });
    assert.ok(meshes.some(superficieGrafitavel), `${id}/${mode}: mutante não recuperou falso apoio`);
    assert.equal(digest(root), before, `${id}/${mode}: classificação alterou geometria física`);
    causalMutants++;
  }
  checked++;
}
console.log(JSON.stringify({ status: 'passed', cases: checked, causalMutants,
  physicalGeometryUnchanged: true, assets: cases.map(([id]) => id) }));
