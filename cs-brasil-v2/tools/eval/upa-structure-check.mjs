/* UPA: contrato clínico e de circulação medido na cena e nos colliders reais. */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { THREE, Game, MAPS, initTextures } from './harness.mjs';
import { grafiteNoDedicado } from '../../public/js/graffiti_pass.js';
import { UPA_PROPS } from '../../public/js/map_upa.js';
import { loadUpaGeometry } from './upa-mint-fixture.mjs';

const arg = process.argv.find(a => a.startsWith('--mutante='));
const mut = arg ? arg.split('=')[1] : '';
const mutantNames = ['reintroduz-loja', 'fecha-acesso', 'comprime-rotas', 'apaga-setor', 'remove-cover', 'monitor-solto'];
if (mut && !mutantNames.includes(mut)) throw new Error(`mutante desconhecido: ${mut}`);
if (process.argv.includes('--self-test')) {
  const expectedFailures = {
    'reintroduz-loja': ['UPA1'],
    'apaga-setor': ['UPA2'],
    'fecha-acesso': ['UPA3', 'UPA4'],
    'comprime-rotas': ['UPA4'],
    'remove-cover': ['UPA5'],
    'monitor-solto': ['UPA6'],
  };
  let ok = true;
  for (const name of mutantNames) {
    const r = spawnSync(process.execPath, [new URL(import.meta.url).pathname, ...process.argv.filter(value => value.startsWith('--asset-manifest=') || value === '--mint'), `--mutante=${name}`], { encoding: 'utf8' });
    const failed = [...r.stdout.matchAll(/^✗ (UPA\d+)/gm)].map(m => m[1]);
    const killed = r.status !== 0 && JSON.stringify(failed) === JSON.stringify(expectedFailures[name]);
    console.log(`${killed ? '✓' : '✗'} mutante ${name} ${killed ? `morto somente por ${failed.join('/')}` : `falhou fora do contrato (${failed.join('/') || 'nenhuma cláusula'})`}`);
    ok &&= killed;
  }
  process.exit(ok ? 0 : 1);
}

grafiteNoDedicado(true);
const mint = process.argv.includes('--mint') || process.argv.some(value => value.startsWith('--asset-manifest=')) || UPA_PROPS.every(id => existsSync(new URL(`../../public/models/props/${id}.glb`, import.meta.url)));
console.log(`UPA-STRUCTURE fonte ${mint ? (await loadUpaGeometry(UPA_PROPS)).mode : 'procedural-fallback'}`);
const world = MAPS.upa_24h.build(new THREE.Scene(), await initTextures());
world.root.updateMatrixWorld(true);

if (mut === 'monitor-solto') {
  let monitor;
  world.root.traverse(o => { if (!monitor && (o.name === 'upa-monitor' || o.userData.upaProp?.id === 'upa_monitor') && o.position.x > 0 && Math.abs(o.position.z - 22) < .01) monitor = o; });
  if (!monitor) throw new Error('MUTANTE NÃO APLICOU: monitor de emergência ausente');
  for (const c of world.colliders) if (Math.abs((c.minX + c.maxX) / 2 - monitor.position.x) < .01 && Math.abs((c.minZ + c.maxZ) / 2 - monitor.position.z) < .01) { c.minX -= .55; c.maxX -= .55; }
  monitor.position.x -= .55;
}

if (mut === 'reintroduz-loja') {
  const gondola = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.9, 1.1), new THREE.MeshBasicMaterial());
  gondola.name = 'gondola_mercado'; gondola.position.set(11, .95, -28); world.root.add(gondola);
}
if (mut === 'apaga-setor') {
  const label = world.root.getObjectByName('upa-sector-observacao');
  if (!label) throw new Error('MUTANTE NÃO APLICOU: placa de observação ausente');
  label.parent.remove(label);
}
if (mut === 'fecha-acesso') {
  const a = world.upaAccesses?.find(x => x.id === 'oeste-sul-meio');
  if (!a) throw new Error('MUTANTE NÃO APLICOU: acesso oeste-sul-meio ausente');
  world.colliders.push({ minX: a.x - 1.6, maxX: a.x + 1.6, minY: 0, maxY: 2.5, minZ: a.z - .22, maxZ: a.z + .22, tag: 'mutante-porta-fechada' });
}
if (mut === 'comprime-rotas') {
  // Move o vão central oeste/sul para perto do externo, mantendo três vãos reais.
  // Assim UPA3 (quantidade de acessos) continua verde e só UPA4 (decisões separadas) cai.
  const outerWall = world.colliders.find(c => Math.abs(c.minZ + 14.15) < .01 && Math.abs(c.minX + 29.6) < .01 && Math.abs(c.maxX + 24) < .01);
  const middleWall = world.colliders.find(c => Math.abs(c.minZ + 14.15) < .01 && Math.abs(c.minX + 20) < .01 && Math.abs(c.maxX + 17) < .01);
  const innerWall = world.colliders.find(c => Math.abs(c.minZ + 14.15) < .01 && Math.abs(c.minX + 14) < .01 && Math.abs(c.maxX + 10) < .01);
  const external = world.upaAccesses?.find(x => x.id === 'oeste-sul-externo');
  const middle = world.upaAccesses?.find(x => x.id === 'oeste-sul-meio');
  if (!outerWall || !middleWall || !innerWall || !external || !middle) throw new Error('MUTANTE NÃO APLICOU: batentes dos acessos oeste/sul ausentes');
  outerWall.maxX = -24.5; middleWall.minX = -21.5; middleWall.maxX = -19.7; innerWall.minX = -16.7;
  external.x = -23; middle.x = -18.2;
}
if (mut === 'remove-cover') {
  const doomed = world.root.getObjectByName('upa-cover-balcao-recepcao-1');
  if (!doomed) throw new Error('MUTANTE NÃO APLICOU: cobertura real da recepção ausente');
  doomed.parent?.remove(doomed);
  world.colliders = world.colliders.filter(c => c.tag !== doomed.name);
}
world.root.updateMatrixWorld(true);

const sceneNames = [];
world.root.traverse(o => { if (o.name) sceneNames.push(o.name); });
const forbiddenPattern = /(?:^|[-_])(manequim|gondola(?:_mercado|_eletro)?|painel_tvs|caixa_cobranca|cooler)(?:$|[-_])/;
const forbidden = sceneNames.filter(name => forbiddenPattern.test(name));

const requiredSectors = ['recepcao', 'triagem', 'consultorios', 'observacao', 'emergencia', 'farmacia'];
const visibleSectors = requiredSectors.filter(id => {
  const sign = world.root.getObjectByName(`upa-sector-${id}`);
  if (!sign || sign.visible === false) return false;
  let visibleMesh = false;
  sign.traverse(o => {
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    if (o.isMesh && o.visible !== false && o.geometry?.attributes?.position?.count > 0 && materials.every(m => !m || m.visible !== false) && materials.some(m => !m || (m.opacity ?? 1) > .05)) visibleMesh = true;
  });
  return visibleMesh && !new THREE.Box3().setFromObject(sign).isEmpty();
});

const activeCollider = (x, z) => world.colliders.some(c => c.minY < 1.6 && c.maxY > .2 && x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ);
const accesses = world.upaAccesses || [];
function physicalAccess(a) {
  const crossingClear = [-.8, -.4, 0, .4, .8].every(dz => !activeCollider(a.x, a.z + dz));
  const framedByWall = activeCollider(a.x - 2.3, a.z) && activeCollider(a.x + 2.3, a.z);
  return Math.abs(Math.abs(a.z) - 14) < .01 && crossingClear && framedByWall;
}
const validAccesses = accesses.filter(physicalAccess);

const routeGroups = new Map();
for (const a of validAccesses) {
  const wing = a.x < 0 ? 'oeste' : 'leste';
  const half = a.z < 0 ? 'sul' : 'norte';
  const key = `${wing}-${half}`;
  if (!routeGroups.has(key)) routeGroups.set(key, []);
  routeGroups.get(key).push(a.x);
}
const routeDecisions = ['oeste-sul', 'oeste-norte', 'leste-sul', 'leste-norte'].map(key => {
  const xs = (routeGroups.get(key) || []).sort((a,b) => a-b);
  return { key, count: xs.length, separated: xs.length === 3 && xs[1]-xs[0] >= 5 && xs[2]-xs[1] >= 5 };
});

const coverMeshes = [];
world.root.traverse(o => { if (o.name?.startsWith('upa-cover-') && (o.isMesh || o.isGroup)) coverMeshes.push(o); });
const coverColliders = world.colliders.filter(c => c.tag?.startsWith('upa-cover-'));
const physicalCovers = coverMeshes.filter(mesh => {
  const record = world.upaClinicalCover.find(value => value.name === mesh.name);
  const related = world.colliders.filter(c => (record?.colliderTags || [mesh.name]).includes(c.tag));
  if (!related.length) return false;
  const c = { minX: Math.min(...related.map(v => v.minX)), maxX: Math.max(...related.map(v => v.maxX)), minZ: Math.min(...related.map(v => v.minZ)), maxZ: Math.max(...related.map(v => v.maxZ)), minY: Math.min(...related.map(v => v.minY)), maxY: Math.max(...related.map(v => v.maxY)) };
  const b = new THREE.Box3().setFromObject(mesh);
  const sameBounds = Math.abs(b.min.x-c.minX)<.06 && Math.abs(b.max.x-c.maxX)<.06 && Math.abs(b.min.z-c.minZ)<.06 && Math.abs(b.max.z-c.maxZ)<.06;
  const h = c.maxY - c.minY, w = c.maxX - c.minX, d = c.maxZ - c.minZ;
  return sameBounds && h >= .45 && h <= 2.6 && Math.max(w, d) >= .5;
});
const coverBySector = Object.fromEntries(requiredSectors.map(id => [id, 0]));
for (const mesh of physicalCovers) {
  const p = new THREE.Vector3(); new THREE.Box3().setFromObject(mesh).getCenter(p);
  const sector = p.z < -14 ? (p.x < 0 ? 'recepcao' : 'farmacia') : p.z >= 14 ? (p.x < 0 ? 'observacao' : 'emergencia') : (p.x < 0 ? 'consultorios' : 'triagem');
  coverBySector[sector]++;
}

const bedside = [];
world.root.traverse(o => { if ((o.name === 'upa-monitor' || o.userData.upaProp?.id === 'upa_monitor') && o.position.x > 0 && Math.abs(o.position.z - 22) < .01) bedside.push(o); });
const bedsideGaps = bedside.map(mesh => {
  const physical = world.colliders.filter(c => Math.abs((c.minX + c.maxX) / 2 - mesh.position.x) < .01 && Math.abs((c.minZ + c.maxZ) / 2 - mesh.position.z) < .01);
  if (!physical.length) return { gap: NaN, clear: false };
  const maxX = Math.max(...physical.map(c => c.maxX));
  const bed = coverColliders.filter(c => c.tag.startsWith('upa-cover-maca-') && c.minX > mesh.position.x && c.minZ < mesh.position.z && c.maxZ > mesh.position.z).sort((a,b) => a.minX - b.minX)[0];
  if (!bed) return { gap: NaN, clear: false };
  const gap = bed.minX - maxX;
  if (gap <= 0) return { gap, clear: true };
  const x = (maxX + bed.minX) / 2;
  const clear = [-.2, 0, .2].every(dz => {
    const pos = { x, y: 0, z: mesh.position.z + dz };
    Game.prototype._collide.call({ world }, pos, .38);
    return Math.hypot(pos.x - x, pos.z - mesh.position.z - dz) < 1e-6;
  });
  return { gap, clear };
});

const checks = [
  ['UPA1', forbidden.length === 0, `cena sem props comerciais (${forbidden.join(', ') || '0'})`],
  ['UPA2', visibleSectors.length === requiredSectors.length, `${visibleSectors.length}/${requiredSectors.length} placas setoriais na cena`],
  ['UPA3', accesses.length === 12 && validAccesses.length === 12, `${validAccesses.length}/12 acessos atravessam parede e têm batentes sólidos`],
  ['UPA4', routeDecisions.every(r => r.separated), routeDecisions.map(r => `${r.key}:${r.count}`).join(' · ')],
  ['UPA5', physicalCovers.length === 52 && physicalCovers.length === coverMeshes.length && Object.values(coverBySector).every(n => n >= 4), `${physicalCovers.length}/52 coberturas têm bounds/collider reais; setores ${Object.entries(coverBySector).map(([k,v])=>`${k}:${v}`).join(' · ')}`],
  ['UPA6', bedside.length === 3 && bedsideGaps.every(value => value.clear), `monitores junto das macas ou com passagem física para raio 0,38 m; frestas ${bedsideGaps.map(value => `${value.gap.toFixed(2)} m`).join(' · ')}`],
];
for (const [id, pass, note] of checks) console.log(`${pass ? '✓' : '✗'} ${id} ${note}`);
if (checks.some(([,pass])=>!pass)) process.exit(1);
if (mut) { console.error(`MUTANTE ${mut} sobreviveu`); process.exit(1); }
console.log('UPA-STRUCTURE OK');
