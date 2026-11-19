/* Contrato da ficha 27: GLB clínico real substitui o helper inteiro, sem proxy de tiro. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { THREE, Game, MAPS, initTextures } from './harness.mjs';
import { UPA_PROPS } from '../../public/js/map_upa.js';
import { placeProp, registerPropTemplate, hasProp } from '../../public/js/mapprops.js';
import { grafiteNoDedicado } from '../../public/js/graffiti_pass.js';
import { loadUpaGeometry } from './upa-mint-fixture.mjs';

const failures = { 'asset-ausente': ['UPAM3', 'UPAM6'], 'sem-occluder': ['UPAM4', 'UPAM6'], 'escala-eixo': ['UPAM4'], 'orientacao': ['UPAM4'], 'proxy-aabb': ['UPAM4', 'UPAM6'], 'soro-solto': ['UPAM5'], 'respawn-bloqueado': ['UPAM7'] };
const mutation = process.argv.find(value => value.startsWith('--mutante='))?.slice('--mutante='.length);
if (mutation && !failures[mutation]) throw new Error(`Mutante UPA Mint desconhecido: ${mutation}`);
if (process.argv.includes('--self-test')) {
  const args = process.argv.filter(value => value.startsWith('--asset-manifest='));
  const normal = spawnSync(process.execPath, [new URL(import.meta.url).pathname, ...args], { encoding: 'utf8' });
  let ok = normal.status === 0;
  console.log(`${ok ? '✓' : '✗'} UPA Mint baseline ${ok ? 'verde' : normal.stdout + normal.stderr}`);
  for (const [name, expected] of Object.entries(failures)) {
    const result = spawnSync(process.execPath, [new URL(import.meta.url).pathname, ...args, `--mutante=${name}`], { encoding: 'utf8' });
    const actual = [...result.stdout.matchAll(/^✗ (UPAM\d+)/gm)].map(match => match[1]);
    const killed = result.status === 1 && JSON.stringify(actual) === JSON.stringify(expected);
    console.log(`${killed ? '✓' : '✗'} mutante ${name}: ${actual.join('/') || result.stderr.slice(0, 200) || 'sobreviveu'}`);
    ok &&= killed;
  }
  process.exit(ok ? 0 : 1);
}

function fire(world, from, dir, distance) {
  const group = new THREE.Group(), body = new THREE.Mesh(new THREE.BoxGeometry(.02, .02, .02), new THREE.MeshBasicMaterial());
  group.add(body); group.position.copy(from).addScaledVector(dir, distance + .45); group.position.y -= 1; group.updateMatrixWorld(true);
  const enemy = { team: 'B', alive: true, pos: group.position, mesh: { group, parts: {} } }; group.userData.botOwner = enemy;
  const game = Object.create(Game.prototype);
  Object.assign(game, { world, ray: new THREE.Raycaster(), bots: [enemy], playerTeam: 'E', online: false, damage: 0, _damage() { this.damage++; }, _fleshImpact() {}, _puff() {}, _impactSfx() {}, sfx: { ricochet() {} } });
  game._fireHitscan({ team: 'E' }, from, dir, 40, false, 'AK', null, false);
  return game.damage;
}

function witness(world, object, geometry, empty) {
  const meshes = [];
  object.traverse(mesh => { if (mesh.isMesh && geometry.has(mesh.geometry)) meshes.push(mesh); });
  const box = new THREE.Box3().setFromObject(object), center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const ray = new THREE.Raycaster();
  for (const axis of [0, 2]) for (const sign of [-1, 1]) for (const y of [.15, .3, .45, .6, .75, .9]) for (const lateral of [.15, .3, .45, .6, .75, .9]) {
    const from = center.clone(), otherAxis = axis === 0 ? 2 : 0;
    from.setComponent(axis, sign < 0 ? box.min.getComponent(axis) - .2 : box.max.getComponent(axis) + .2);
    from.y = box.min.y + size.y * y;
    from.setComponent(otherAxis, box.min.getComponent(otherAxis) + size.getComponent(otherAxis) * lateral);
    const dir = new THREE.Vector3().setComponent(axis, -sign), distance = size.getComponent(axis) + .4;
    ray.set(from, dir); ray.far = distance;
    const own = ray.intersectObjects(meshes, false)[0];
    if (empty && !own && !ray.intersectObjects(world.occluders, false).length) return { from, dir, distance };
    if (!empty && own) {
      ray.far = own.distance + .05;
      const other = ray.intersectObjects(world.occluders.filter(mesh => !meshes.includes(mesh)), false)[0];
      if (!other) return { from, dir, distance: own.distance + .04 };
    }
  }
  return null;
}

// O inventário esperado vem do registro de procedência dos GLBs, não do map_upa.js.
const registry = JSON.parse(readFileSync(new URL('../../public/models/props/upa-mint-assets.json', import.meta.url), 'utf8'));
const expected = registry.assets.map(asset => asset.id).filter(id => /^upa_[a-z_]+$/.test(id));
if (expected.length !== 9) throw new Error('Registro UPA não permite medir o inventário clínico de nove props');
const checks = [];
const shotWitnesses = [];
const add = (id, pass, note) => checks.push([id, pass, note]);
add('UPAM1', expected.every(id => UPA_PROPS.includes(id)), `preload clínico ${UPA_PROPS.length}/${expected.length}; faltam ${expected.filter(id => !UPA_PROPS.includes(id)).join(', ') || '0'}`);
let loaded = true;
let receipt;
try {
  receipt = await loadUpaGeometry(expected);
  console.log(`UPA-MINT fonte ${receipt.mode}`);
}
catch (error) { loaded = false; add('UPAM2', false, error.message); }
if (loaded) add('UPAM2', true, `${expected.length} GLBs reais carregados; ${receipt.mode}`);

if (loaded) {
  const sourceGeometry = new Map(expected.map(id => {
    const geometry = new Set();
    placeProp(id).traverse(mesh => { if (mesh.isMesh) geometry.add(mesh.geometry); });
    return [id, geometry];
  }));
  if (mutation === 'asset-ausente') {
    registerPropTemplate('upa_monitor', null);
    if (hasProp('upa_monitor')) throw new Error('MUTANTE NÃO APLICOU: monitor ainda registrado');
  }
  grafiteNoDedicado(true);
  const world = MAPS.upa_24h.build(new THREE.Scene(), await initTextures());
  world.root.updateMatrixWorld(true);
  const instances = [];
  world.root.traverse(object => { if (object.userData.upaProp) instances.push(object); });
  const bed = instances.find(object => object.userData.upaProp.id === 'upa_maca');
  if (mutation === 'escala-eixo') bed.scale.x *= 1.2;
  if (mutation === 'orientacao') bed.rotation.y += Math.PI / 2;
  if (mutation === 'sem-occluder') {
    const meshes = new Set(); bed.traverse(mesh => { if (mesh.isMesh) meshes.add(mesh); });
    const old = world.occluders.length; world.occluders = world.occluders.filter(mesh => !meshes.has(mesh));
    if (old === world.occluders.length) throw new Error('MUTANTE NÃO APLICOU: nenhum occluder removido');
  }
  if (mutation === 'proxy-aabb') {
    const box = new THREE.Box3().setFromObject(bed), size = box.getSize(new THREE.Vector3());
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), new THREE.MeshBasicMaterial({ colorWrite: false }));
    proxy.position.copy(bed.worldToLocal(box.getCenter(new THREE.Vector3()))); bed.add(proxy); world.occluders.push(proxy);
    if (!world.occluders.includes(proxy)) throw new Error('MUTANTE NÃO APLICOU: proxy não registrado');
  }
  if (mutation === 'soro-solto') {
    const object = instances.find(value => value.userData.upaBedside), collider = world.colliders.find(value => value.tag === object.name);
    object.position.x += .45; collider.minX += .45; collider.maxX += .45;
  }
  if (mutation === 'respawn-bloqueado') {
    const { x, z } = world.spawns.E[0];
    world.colliders.push({ minX: x - .1, maxX: x + .1, minY: 0, maxY: 2, minZ: z - .1, maxZ: z + .1, tag: 'mutante-respawn' });
  }
  world.root.updateMatrixWorld(true);
  const present = new Set(instances.map(object => object.userData.upaProp.id));
  add('UPAM3', expected.every(id => present.has(id)), `${instances.length} instâncias clínicas; faltam ${expected.filter(id => !present.has(id)).join(', ') || '0'}`);
  const defects = [];
  for (const object of instances) {
    const { id, ry } = object.userData.upaProp;
    if (!expected.includes(id)) defects.push(`${object.name}: id fora da ficha`);
    if (object.userData.geometryFixtureAsset !== id) defects.push(`${object.name}: fonte GLB ausente`);
    const scale = object.scale;
    if (Math.abs(scale.x - scale.y) > 1e-6 || Math.abs(scale.y - scale.z) > 1e-6) defects.push(`${object.name}: escala deformada`);
    if (Math.abs(scale.x - 1) > 1e-6 || Math.abs(scale.y - 1) > 1e-6 || Math.abs(scale.z - 1) > 1e-6) defects.push(`${object.name}: GLB normalizado escalado em runtime`);
    const angle = Math.atan2(Math.sin(object.rotation.y - ry), Math.cos(object.rotation.y - ry));
    if (!Number.isFinite(angle) || Math.abs(angle) > 1e-6 || object.rotation.x !== 0 || object.rotation.z !== 0) defects.push(`${object.name}: orientação divergente`);
    const bounds = new THREE.Box3().setFromObject(object);
    const collider = world.colliders.find(candidate => candidate.tag === object.name);
    if (!collider || ['X', 'Y', 'Z'].some(axis => Math.abs(collider[`min${axis}`] - bounds.min[axis.toLowerCase()]) > 1e-5 || Math.abs(collider[`max${axis}`] - bounds.max[axis.toLowerCase()]) > 1e-5)) defects.push(`${object.name}: movement fora do envelope real`);
    const meshes = [];
    object.traverse(mesh => { if (mesh.isMesh) meshes.push(mesh); });
    if (!meshes.length || meshes.some(mesh => !mesh.geometry?.attributes.position?.count || !world.occluders.includes(mesh))) defects.push(`${object.name}: malha real ausente dos tiros`);
    if (meshes.some(mesh => !sourceGeometry.get(id)?.has(mesh.geometry))) defects.push(`${object.name}: malha extra fora do GLB fonte`);
  }
  add('UPAM4', instances.length > 0 && defects.length === 0, defects.slice(0, 8).join(' · ') || `${instances.length} instâncias usam GLB, escala uniforme, envelope real e malhas de tiro`);
  const bedside = instances.filter(object => object.userData.upaBedside);
  const gaps = bedside.map(object => {
    const a = world.colliders.find(c => c.tag === object.name), b = world.colliders.find(c => c.tag === object.userData.upaBedside);
    if (!a || !b) return Infinity;
    return Math.hypot(Math.max(0, a.minX - b.maxX, b.minX - a.maxX), Math.max(0, a.minZ - b.maxZ, b.minZ - a.maxZ));
  });
  add('UPAM5', bedside.length === 10 && gaps.every(gap => gap < 1e-6), `${bedside.length}/10 bases de soro unem o envelope da maca, gap máximo ${Math.max(...gaps).toFixed(3)}m`);
  const openIds = ['upa_maca', 'upa_monitor', 'upa_soro', 'upa_cadeira_rodas', 'upa_longarina'];
  const shots = [];
  for (const id of expected) {
    const object = instances.find(value => value.userData.upaProp.id === id);
    if (!object) { shots.push(`${id}: instância ausente`); continue; }
    const solid = witness(world, object, sourceGeometry.get(id), false);
    const solidDamage = solid ? fire(world, solid.from, solid.dir, solid.distance) : null;
    if (!solid || solidDamage !== 0) shots.push(`${id}: massa não bloqueia alvo`);
    const proof = { id, instance: object.name, mass: solid ? { from: solid.from.toArray(), dir: solid.dir.toArray(), distance: solid.distance, damage: solidDamage } : null };
    if (openIds.includes(id)) {
      const gap = witness(world, object, sourceGeometry.get(id), true);
      const gapDamage = gap ? fire(world, gap.from, gap.dir, gap.distance) : null;
      if (!gap || gapDamage !== 1) shots.push(`${id}: vão real não atinge alvo`);
      proof.gap = gap ? { from: gap.from.toArray(), dir: gap.dir.toArray(), distance: gap.distance, damage: gapDamage } : null;
    }
    shotWitnesses.push(proof);
  }
  add('UPAM6', shots.length === 0, shots.join(' · ') || `hitscan produção: ${expected.length} massas bloqueiam; ${openIds.length} vãos atingem alvo`);
  const { nodes, adj } = world.waypoints;
  const reached = new Set([0]), queue = [0];
  while (queue.length) for (const next of adj[queue.pop()]) if (!reached.has(next)) { reached.add(next); queue.push(next); }
  const blocked = point => {
    const pos = { x: point.x, y: 0, z: point.z };
    Game.prototype._collide.call({ world }, pos, .38);
    return Math.hypot(pos.x - point.x, pos.z - point.z) > 1e-6;
  };
  const unsafe = [...Object.values(world.spawns).flat(), ...world.ctfPoints, ...nodes].filter(blocked);
  let unsafeEdges = 0;
  for (let i = 0; i < nodes.length; i++) for (const j of adj[i]) if (j > i) {
    const a = nodes[i], b = nodes[j], steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (.38 / 2));
    for (let step = 1; step < steps; step++) if (blocked({ x: a.x + (b.x - a.x) * step / steps, z: a.z + (b.z - a.z) * step / steps })) { unsafeEdges++; break; }
  }
  add('UPAM7', reached.size === nodes.length && unsafe.length === 0 && unsafeEdges === 0, `grafo ${reached.size}/${nodes.length} alcançável; ${unsafe.length} spawns/bandeiras/nós e ${unsafeEdges} arestas amostradas colidem`);
}
for (const [id, pass, note] of checks) console.log(`${pass ? '✓' : '✗'} ${id} ${note}`);
const output = process.argv.find(value => value.startsWith('--receipt='));
if (output) {
  const source = ['public/js/map_upa.js', 'tools/eval/upa-mint-check.mjs', 'tools/eval/upa-mint-fixture.mjs'].map(path => ({ path, sha256: createHash('sha256').update(readFileSync(new URL(`../../${path}`, import.meta.url))).digest('hex') }));
  writeFileSync(output.slice('--receipt='.length), JSON.stringify({ ...receipt, mutation: mutation || null, source, checks, shotWitnesses }, null, 2) + '\n');
}
if (checks.some(([, pass]) => !pass)) process.exit(1);
console.log('UPA-MINT OK — geometria; aparência e vãos de tiro exigem revisão dos assets finais');
