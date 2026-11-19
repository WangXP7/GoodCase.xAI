/* Relato: tiro para no ar entre props. Procedência/probe: docs/reports/TIROS-OCLUSAO-20261011.md.
   Game._fireHitscan real, geometria GLB real; aparência/texturas continuam no gate browser.
   --fallback-baseline reproduz autoridade antiga; --mutante=caixa-no-vao deve reprovar. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { THREE, MAPS, initTextures, Game, seedRandom } from './harness.mjs';
import { preloadPropGeometry } from './prop-geometry-fixture.mjs';

if (process.argv.includes('--self-test')) {
  const file = fileURLToPath(import.meta.url);
  const normal = spawnSync(process.execPath, [file], { stdio: 'inherit' });
  const mutant = spawnSync(process.execPath, [file, '--mutante=caixa-no-vao'], { stdio: 'inherit' });
  const pass = normal.status === 0 && mutant.status === 1;
  console.log(`Shot self-test: ${pass ? 'PASS baseline green, invisible-box mutant red' : 'FAIL'}`);
  process.exit(pass ? 0 : 1);
}
const fallback = process.argv.includes('--fallback-baseline');
const mutation = process.argv.find(arg => arg.startsWith('--mutante='))?.split('=')[1];
if (mutation && mutation !== 'caixa-no-vao') throw new Error(`Mutante desconhecido: ${mutation}`);
if (!fallback) await preloadPropGeometry(MAPS.ferro_velho.props);
seedRandom(12345);
const world = MAPS.ferro_velho.build(new THREE.Scene(), await initTextures());
world.root.updateMatrixWorld(true);
const from = new THREE.Vector3(-30, 1.3, -34), dir = new THREE.Vector3(1, 0, 1).normalize();
const group = new THREE.Group(), body = new THREE.Mesh(new THREE.BoxGeometry(.6, 1.8, .6), new THREE.MeshBasicMaterial());
body.position.y = .9; group.add(body); group.position.copy(from).addScaledVector(dir, 20); group.position.y = 0; group.updateMatrixWorld(true);
const enemy = { team: 'B', alive: true, pos: group.position, mesh: { group, parts: {} } };
group.userData.botOwner = enemy;
const game = Object.create(Game.prototype);
Object.assign(game, { world: { ...world, ambience: null }, ray: new THREE.Raycaster(), bots: [enemy], playerTeam: 'E', online: false,
  _damage: () => { game.damage++; }, damage: 0, _fleshImpact() {}, _puff() {}, _impactSfx() {},
  sfx: { ricochet() {} } });
if (mutation) {
  const box = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 2), new THREE.MeshBasicMaterial({ visible: false }));
  box.position.copy(from).addScaledVector(dir, 17); box.position.y = 1.5;
  world.root.add(box); world.occluders.push(box); box.updateMatrixWorld(true);
  if (!world.occluders.includes(box)) throw new Error('Mutante não aplicou');
}
const end = game._fireHitscan({ team: 'E' }, from, dir, 40, false, 'AK', null, false);
let failures = 0;
const check = (pass, text) => { console.log(`${pass ? 'PASS' : 'FAIL'} ${text}`); if (!pass) failures++; };
check(game.damage === 1, `SHOT1 alvo visível no vão recebe dano (${game.damage})`);
check(from.distanceTo(end) > 19 && from.distanceTo(end) < 21, `SHOT2 impacto no alvo a 20m (${from.distanceTo(end).toFixed(3)}m)`);
game.damage = 0; group.position.copy(from).addScaledVector(dir, 30); group.position.y = 0; group.updateMatrixWorld(true);
const wallEnd = game._fireHitscan({ team: 'E' }, from, dir, 40, false, 'AK', null, false);
check(game.damage === 0 && from.distanceTo(wallEnd) < 30, 'SHOT3 superfície real bloqueia alvo atrás da massa');
console.log(`Shot occlusion: ${failures} failures (${fallback ? 'fallback' : 'GLB geometry'}${mutation ? `, ${mutation}` : ''})`);
process.exitCode = failures ? 1 : 0;
