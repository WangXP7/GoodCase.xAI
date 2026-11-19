/* Baseline 72d559d90, seed 12345, medium, GLBs reais via prop-geometry-fixture.
   Assinatura exclui UV/albedo/acabamento; inclui posição, índice, normal, transforms,
   colisores, spawns, pickups, CTF e terreno. Não mede pixel, GPU ou carregamento bitmap.
   Obras usava 512²×repeat17 em 56×70m: 155,43 / 124,34 px/m (25% de estiramento).
   Alvo compartilhado map_uv.js/texel-tetos.mjs: 128 px/m em ambos os eixos.
   Mutantes: --mutante=obras-uv|colisor|geometry|material|rng|acabamento; --self-test. */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TEXEL_ALVO } from './texel-tetos.mjs';
const BASELINES = {
  "amazonia": {
    "contract": "558028b3a1e7da9b93d61bd85ce122f7e93f53e66742a6db3183c92dbe070a94",
    "geometry": "842f225ec993434f4d52ddc6d735676b03a820a5804e6e6ac182efda185a256a",
    "randomCalls": 13452,
    "meshCount": 491
  },
  "atacadao_treta": {
    "contract": "13a4772ebc99eb056748119bdc11a1cb11f083ccf97361db22e3b5f19e60cf61",
    "geometry": "a06b1b5be896934e1894e45e1bc294530497cff9e72235c94012ce5eed71fceb",
    "randomCalls": 8620,
    "meshCount": 1021
  },
  "campomorro": {
    "contract": "d9444d10273595463c5fb7ae47b803e126d0ebe63448c776dec66d88cb0a3eed",
    "geometry": "2eb7538b40e03c178bd447a343fa95e491f3200bfdab6a207f8eeb3ffe2227ea",
    "randomCalls": 5240,
    "meshCount": 568
  },
  "corrego": {
    "contract": "8e332c653ad795f9203f49b5e019d78556cdeb88cda57c2d8608228fbf018c92",
    "geometry": "fdee09ef349604ef84ecbeec73285f5d6546d9e272b1b59e77b909bcbe46046d",
    "randomCalls": 13528,
    "meshCount": 656
  },
  "escadao": {
    "contract": "fa88560e2845456feb591fc7e1c233df81790b9ff12a63c94d0c3c5a157ac463",
    "geometry": "9f9fa0e327cb44fb80d2159776f80e270c83054eebdafce84df41e6c08f0939c",
    "randomCalls": 12976,
    "meshCount": 1141
  },
  "ferro_velho": {
    "contract": "6bb1fa05ef69ca19739cb64ebfd10dfbd8a12b3de4f586138497c98d46bab12e",
    "geometry": "382bdfab1848d222dce811de9191a4fad58962a38574f416346e574ec31f19e2",
    "randomCalls": 12088,
    "meshCount": 759
  },
  "lajes": {
    "contract": "c179e5527cf74f1e3a800591738c2f0ba841e5e390294b076788f8bd81c531c3",
    "geometry": "e47c68444d4dee6e45a38b34423264f133f462ceb46773d0e7ba92df33c5e1a5",
    "randomCalls": 153128,
    "meshCount": 809
  },
  "loja_h": {
    "contract": "a6fb4f5f9f343913e87a9d778aca92ec07709da71380558eb6acb04785d25e13",
    "geometry": "04bf12a6448d6dff05bdfbceea4c12f37296609371b5db5e6260ddffae4c172b",
    "randomCalls": 12024,
    "meshCount": 317
  },
  "mansao": {
    "contract": "2bab712cfd9bb628ed7d03a67fb96fa04215695b0f0237c4e0bfdfe974c5f425",
    "geometry": "c09e7ee6ef3e9348f9afcaa6fd3261714844086e61cb7c0da0cf27172d238b71",
    "randomCalls": 9452,
    "meshCount": 883
  },
  "obras_prefeitura": {
    "contract": "5bf2b0f5837d572140c314e4098ad2f82f69de3b0f891f0fb46a7c8f5a4ac42e",
    "geometry": "1188cd6a7c5d3824adacc904752cea1f46c32df02f37b7acf206ff4173f1c6de",
    "randomCalls": 9516,
    "meshCount": 765
  },
  "parque_treta": {
    "contract": "6b9e4bf3bc279b5a2c93a37e8924745dca65c9d089ae2d7e9e9b9e9a6a6e42e3",
    "geometry": "bd71ca960b0f0c025955691f3fadd0438e3e1918b807bbf76bdbbbe3c15a2886",
    "randomCalls": 4280,
    "meshCount": 564
  },
  "penitenciaria": {
    "contract": "0caf514d6b91001cab181a6621ea3aa64ca7758dab740c2162611c99f6e6efa5",
    "geometry": "92daff5dcdbd81055752b607ca495adbcbe68857241d51d034626fb24233752e",
    "randomCalls": 7056,
    "meshCount": 502
  },
  "piscina_treta": {
    "contract": "e6b0cdbf91e8698c99d1762d10afbf578e1341c69af94ca1f8d4049a35af1cf8",
    "geometry": "938f739a3024aef96b6fb5be1c6f8c4c9e8e7f8285ac8ceb41f6665dc773ce66",
    "randomCalls": 9524,
    "meshCount": 322
  },
  "posto_treta": {
    "contract": "65de86dc59452fde64bd2992d99101a53070e555729dbe58fe5ef5dc1ecb90e9",
    "geometry": "60b687eddb0ebe1f9e8f738afe2e23901fd96e65cb101fc77422bbd948b596e7",
    "randomCalls": 19032,
    "meshCount": 1276
  },
  "praca_poderes": {
    "contract": "bbbbcbd622cb28e4e2216206d6b57902411b9dc6ec5951f95fb4db1cb289f5f5",
    "geometry": "5bf10de65b20594bb5a13327eb0bf5dff1ce1aa89bc6392917c9fc001c400d24",
    "randomCalls": 103569,
    "meshCount": 321
  },
  "quebrada": {
    "contract": "3924a6d4e5624221e9740e1bfef932f555d1b987f85eca846b9f787a5ec3479d",
    "geometry": "29a892afbdedeca15fa56f01f0321b8fc711f33509aadfa7ee8fc10ab14ea8f8",
    "randomCalls": 17036,
    "meshCount": 1563
  },
  "upa_24h": {
    "contract": "c2d56a7dee2ffc40c15ed4a9fc72d93f176674bba6a0bc715e9acee82020e262",
    "geometry": "547baca232074d43d8c42df17fc6b47ade11006c6d5e7c168909a492cc263906",
    "randomCalls": 5860,
    "meshCount": 363
  },
  "velho_oeste": {
    "contract": "3b0435614fd64c00274aad8c2bc7b6ab36b7c32bac9ae113bb0c9190edd03018",
    "geometry": "fea06cb604ee2db0cfce90b394e42d93d307d98b2db94b3bf212ac5ec9147da5",
    "randomCalls": 6260,
    "meshCount": 611
  }
};
// Índices do primeiro encontro runtime no baseline: duplicatas compartilham material.
const FINISH_TARGETS = {
  "parque_treta": [[11, "color", 12943761]],
  "escadao": [[65, "normalScale", 0.4], [66, "normalScale", 0.4], [67, "normalScale", 0.4], [68, "normalScale", 0.4], [70, "normalScale", 0.4], [103, "normalScale", 0.4], [121, "normalScale", 0.4], [122, "normalScale", 0.4]],
  "ferro_velho": [[324, "roughness", 0.76]],
  "corrego": [[2, "normalScale", 0.4], [9, "normalScale", 0.4], [44, "normalScale", 0.4], [45, "normalScale", 0.4], [47, "normalScale", 0.4], [121, "normalScale", 0.4]],
  "atacadao_treta": [[7, "color", 13218152], [111, "color", 4811902]],
  "loja_h": [[0, "normalScale", 0.4], [1, "normalScale", 0.4], [2, "normalScale", 0.4], [3, "normalScale", 0.4], [5, "normalScale", 0.4], [6, "normalScale", 0.4], [7, "normalScale", 0.4], [10, "normalScale", 0.4], [20, "normalScale", 0.4], [21, "normalScale", 0.4], [22, "normalScale", 0.4], [23, "normalScale", 0.4], [25, "normalScale", 0.4], [37, "normalScale", 0.4], [38, "normalScale", 0.4], [50, "normalScale", 0.4], [54, "normalScale", 0.4], [55, "normalScale", 0.4], [56, "normalScale", 0.4], [57, "normalScale", 0.4]],
  "mansao": [[35, "roughness", 0.42]],
  "campomorro": [[0, "normalScale", 0.4], [1, "normalScale", 0.4], [3, "normalScale", 0.4], [5, "normalScale", 0.4], [16, "normalScale", 0.4]],
  "upa_24h": [[1, "color", 9541787]],
  "praca_poderes": [[0, "normalScale", 0.4], [1, "normalScale", 0.4], [2, "normalScale", 0.4], [3, "normalScale", 0.4], [4, "normalScale", 0.4], [5, "normalScale", 0.4], [6, "normalScale", 0.4], [21, "normalScale", 0.4], [22, "normalScale", 0.4], [45, "normalScale", 0.4], [49, "normalScale", 0.4], [56, "normalScale", 0.4], [57, "normalScale", 0.4], [58, "normalScale", 0.4], [59, "normalScale", 0.4], [61, "normalScale", 0.4], [62, "normalScale", 0.4]],
  "velho_oeste": [[13, "bumpScale", 0.055]],
  "posto_treta": [[101, "color", 12148041]],
  "piscina_treta": [],
  "obras_prefeitura": [[1, "color", 5861758]],
  "amazonia": [[27, "color", 10643288]],
  "quebrada": [[0, "normalScale", 0.4], [1, "normalScale", 0.4], [2, "normalScale", 0.4], [3, "normalScale", 0.4], [17, "normalScale", 0.4], [42, "normalScale", 0.4], [43, "normalScale", 0.4], [49, "normalScale", 0.4], [59, "normalScale", 0.4], [60, "normalScale", 0.4]],
  "penitenciaria": [[5, "bumpScale", 0.028]],
  "lajes": [[5, "normalScale", 0.45], [10, "normalScale", 0.45], [11, "normalScale", 0.45], [101, "normalScale", 0.45], [104, "normalScale", 0.45], [105, "normalScale", 0.45], [106, "normalScale", 0.45]],
};
const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const file = fileURLToPath(import.meta.url), id = arg('mapa'), mutation = arg('mutante');
const mutations = ['obras-uv', 'colisor', 'geometry', 'material', 'rng', 'acabamento'];
if (mutation && !mutations.includes(mutation)) throw Error(`Mutante desconhecido: ${mutation}`);
if (!id) {
  const ids = mutation ? ['obras_prefeitura'] : Object.keys(BASELINES);
  let failures = 0;
  for (const map of ids) {
    const run = spawnSync(process.execPath, [file, `--mapa=${map}`, ...(mutation ? [`--mutante=${mutation}`] : []), ...(arg('out') ? [`--json=${arg('out')}/${map}.json`] : [])], { encoding: 'utf8' });
    process.stdout.write(run.stdout); if (run.status) { failures++; process.stderr.write(run.stderr.slice(-1500)); }
  }
  if (process.argv.includes('--self-test') && !failures) for (const mut of mutations) {
    const run = spawnSync(process.execPath, [file, '--mapa=obras_prefeitura', `--mutante=${mut}`], { encoding: 'utf8' });
    const killed = run.status === 1 && run.stdout.includes(`MUTANTE ${mut} aplicado`) && run.stdout.includes('✗');
    console.log(`${killed ? '✓' : '✗'} mutante ${mut}: ${killed ? 'morto' : run.stdout.slice(-300) + run.stderr.slice(-300)}`);
    if (!killed) failures++;
  }
  console.log(`Map surface upgrade: ${ids.length} mapas, ${failures} falhas. Aparência e FPS exigem A/B no navegador.`);
  process.exit(failures ? 1 : 0);
}
if (!BASELINES[id]) throw Error(`Mapa desconhecido: ${id}`);
const { THREE, MAPS, initTextures, seedRandom } = await import('./harness.mjs');
const { TEXEL_ALVO: UV_ALVO } = await import('../../public/js/map_uv.js');
if (UV_ALVO !== TEXEL_ALVO) throw Error('Alvo UV diverge de texel-tetos');
const { preloadPropGeometry } = await import('./prop-geometry-fixture.mjs');
globalThis.localStorage = { getItem(k) { return k === 'awpbr_settings' ? '{"quality":"medium"}' : null; }, setItem() {} };
console.warn = () => {};
await preloadPropGeometry(MAPS[id].props);
const textures = initTextures(); seedRandom(12345);
let randomCalls = 0; const random = Math.random; Math.random = () => { randomCalls++; return random(); };
const scene = new THREE.Scene(), world = MAPS[id].build(scene, textures); scene.updateMatrixWorld(true);
const arrHash = a => { const h = createHash('sha256'); if (a) h.update(Buffer.from(a.array.buffer, a.array.byteOffset, a.array.byteLength)); return h.digest('hex'); };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const round = value => typeof value === 'number' ? Math.round(value * 1e8) / 1e8 : value;
const meshes = [], materials = new Set(); world.root.traverse(o => { if (o.isMesh) { meshes.push(o); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => materials.add(m)); } });
const ground = meshes.find(o => o.geometry.attributes.position.count === 4047 && o.geometry.parameters?.width === 56 && o.geometry.parameters?.height === 70);
let changed = false;
if (mutation === 'obras-uv' && ground) { const uv = ground.geometry.attributes.uv, p = ground.geometry.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getX(i) + 28) / 56, (35 - p.getZ(i)) / 70); changed = true; }
if (mutation === 'colisor') { world.colliders[0].minX -= 1; changed = true; }
if (mutation === 'geometry') { const p = meshes[0].geometry.attributes.position; p.setX(0, p.getX(0) + 1); changed = true; }
if (mutation === 'material') { const m = [...materials].find(m => m.opacity === 1 && !m.transparent); m.opacity = .5; changed = true; }
if (mutation === 'acabamento') { const [index, field, value] = FINISH_TARGETS[id][0] || []; const m = [...materials][index]; if (m) { if (field === 'normalScale') m.normalScale.set(value + 1, value + 1); else if (field === 'color') m.color.setHex(value ^ 0xffffff); else m[field] = value + 1; changed = true; } }
if (mutation === 'rng') { Math.random(); changed = true; }
if (mutation) { if (!changed) throw Error('MUTANTE NÃO APLICOU'); console.log(`MUTANTE ${mutation} aplicado`); }
const physical = meshes.map(o => ({ name: o.name, type: o.type, visible: o.visible, matrix: o.matrixWorld.elements.map(round), instance: arrHash(o.instanceMatrix), count: o.count || 0,
  position: arrHash(o.geometry.attributes.position), index: arrHash(o.geometry.index), normal: arrHash(o.geometry.attributes.normal), groups: o.geometry.groups,
  render: (Array.isArray(o.material) ? o.material : [o.material]).map(m => [m.side, m.visible, m.opacity, m.transparent, m.alphaTest, m.colorWrite, m.depthWrite]) }));
const samples = []; for (let x = -30; x <= 30; x += 3) for (let z = -36; z <= 36; z += 3) for (const y of [undefined, 0, 3.1, 6]) samples.push(round(world.groundHeightAt?.(x, z, y) ?? 0));
const contract = { colliders: world.colliders, spawns: world.spawns, pickups: world.pickups, ctfPoints: world.ctfPoints, bounds: world.bounds, ground: samples };
let failures = 0; const check = (valid, message) => { console.log(`${valid ? '✓' : '✗'} ${id} ${message}`); if (!valid) failures++; };
check(digest(contract) === BASELINES[id].contract, 'colisores/spawns/pickups/CTF/terreno invariáveis');
check(digest(physical) === BASELINES[id].geometry, `geometria/render flags invariáveis (${meshes.length} malhas)`);
check(randomCalls === BASELINES[id].randomCalls, `RNG preservado: ${randomCalls}/${BASELINES[id].randomCalls}`);
const finishTargets = FINISH_TARGETS[id];
if (finishTargets.length) {
  const mismatches = finishTargets.filter(([index, field, expected]) => { const m = [...materials][index]; const actual = field === 'color' ? m?.color?.getHex() : m?.[field]; return field === 'normalScale' ? actual?.x !== expected || actual?.y !== expected : actual !== expected; });
  check(!mismatches.length, `acabamento runtime alcança materiais visíveis: ${finishTargets.length - mismatches.length}/${finishTargets.length}`);
  for (const [index, field, expected] of mismatches.slice(0, 5)) { const m = [...materials][index]; const actual = field === 'color' ? m?.color?.getHex() : field === 'normalScale' ? m?.normalScale?.toArray() : m?.[field]; console.log(`  material[${index}] ${m?.name || 'procedural'} ${field}: esperado ${expected}, recebido ${JSON.stringify(actual)}; confira o acabamento no builder registrado.`); }
}
if (id === 'obras_prefeitura') {
  if (!ground?.material.map?.image?.width) check(false, 'terreno/textura sem dimensão; não foi possível medir');
  else {
    const p = ground.geometry.attributes.position, uv = ground.geometry.attributes.uv, t = ground.material.map;
    const a = 0, b = 1, c = 57;
    const dx = Math.abs((uv.getX(b) - uv.getX(a)) * t.image.width * t.repeat.x / (p.getX(b) - p.getX(a)));
    const dz = Math.abs((uv.getY(c) - uv.getY(a)) * t.image.height * t.repeat.y / (p.getZ(c) - p.getZ(a)));
    check(Math.abs(dx - TEXEL_ALVO) < .01 && Math.abs(dz - TEXEL_ALVO) < .01,
      `terreno sem estiramento: ${dx.toFixed(2)}/${dz.toFixed(2)} px/m, alvo compartilhado ${TEXEL_ALVO}`);
  }
}
const out = arg('json'); if (out) fs.writeFileSync(out, JSON.stringify({ id, randomCalls, failures, materials: [...materials].map(m => ({ name: m.name, color: m.color?.getHex(), roughness: m.roughness, metalness: m.metalness, bumpScale: m.bumpScale, normalScale: m.normalScale?.toArray() })) }, null, 2));
process.exit(failures ? 1 : 0);
