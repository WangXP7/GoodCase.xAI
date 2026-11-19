import { Game, THREE } from './harness.mjs';
import { WEAPONS } from '../../public/js/data/weapons.js';
import fs from 'node:fs';
const mutante = process.argv.find(a => a.startsWith('--mutante='))?.split('=')[1];
if (mutante === 'pula-primeiro') {
  const fonte = fs.readFileSync(new URL('../../public/js/ballistics.js', import.meta.url), 'utf8');
  const alterado = fonte.replace('hit.dist < primeiro.dist', 'hit.dist > primeiro.dist');
  if (alterado === fonte) throw Error('mutante não aplicou');
  const absoluto = alterado.replace("from 'three'", `from '${new URL('../../public/vendor/three.module.js', import.meta.url).href}'`);
  const { resolverRaio } = await import('data:text/javascript;base64,' + Buffer.from(absoluto).toString('base64'));
  const consultar = Game.prototype._consultarTiro.toString();
  const { entradaCombatente, ALCANCE_TIRO } = await import('../../public/js/hitboxes.js');
  Game.prototype._consultarTiro = new Function('resolverRaio', 'entradaCombatente', 'ALCANCE_TIRO', `return function ${consultar}`)(resolverRaio, entradaCombatente, ALCANCE_TIRO);
} else if (mutante) {
  let codigo = fs.readFileSync(new URL('../../public/js/ballistics.js', import.meta.url), 'utf8');
  const original = codigo;
  if (mutante === 'aabb-global') codigo = codigo
    .replace('const caixa = caixaCompleta(hit.object);', 'const caixa = new THREE.Box3().setFromObject(hit.object);')
    .replace('const inversa = matriz.clone().invert();', 'const inversa = new THREE.Matrix4();');
  else if (mutante === 'sem-validacao') codigo = codigo.replace('const caixa = caixaCompleta(hit.object);',
    'const caixa = new THREE.Box3().setFromBufferAttribute(hit.object.geometry.attributes.position);');
  else if (mutante === 'sem-oclusao') codigo = codigo.replace('for (const outro of oclusores)', 'for (const outro of [])');
  if (codigo === original) throw Error('mutante não aplicou');
  codigo = codigo.replace("from 'three'", `from '${new URL('../../public/vendor/three.module.js', import.meta.url).href}'`);
  const { saidaPenetracao } = await import('data:text/javascript;base64,' + Buffer.from(codigo).toString('base64'));
  Game.prototype._penetrationExit = function (hit, dir, wid, surf) {
    const cfg = WEAPONS[wid]?.penetration;
    if (!cfg || this.online || !cfg.surfaces.includes(surf)) return null;
    return saidaPenetracao(hit, dir, cfg, this.world.occluders);
  };
}
let falhas = 0;
const cobrar = (ok, msg) => { console.log(`${ok ? 'OK' : 'FALHA'} ${msg}`); if (!ok) falhas++; };
function caixa(largura, espessura, superficie, z = -5) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(largura, 2, espessura), new THREE.MeshBasicMaterial());
  m.position.set(0, 1.5, z); m.userData.surf = superficie; return m;
}
function disparar(paredes, { online = false, wid = 'awp', doisAlvos = false, alvoNoTrecho = false } = {}) {
  const jogo = Object.create(Game.prototype), cena = new THREE.Scene();
  jogo.ray = new THREE.Raycaster(); jogo.world = { occluders: paredes }; jogo.online = online;
  jogo.playerTeam = 'E'; jogo.bots = []; const danos = [];
  for (const z of doisAlvos ? (alvoNoTrecho ? [-5.4, -8] : [-6, -8]) : [-6]) {
    const group = new THREE.Group(), body = new THREE.Mesh(new THREE.SphereGeometry(.35), new THREE.MeshBasicMaterial());
    body.position.set(0, 1, z); group.add(body);
    const bot = { team: 'B', alive: true, pos: new THREE.Vector3(0, 0, z), mesh: { group, parts: { head: null } } };
    body.userData.botOwner = bot; jogo.bots.push(bot); cena.add(group);
  }
  for (const parede of paredes) cena.add(parede.parent || parede);
  cena.updateMatrixWorld(true);
  jogo._damage = (alvo, dano) => danos.push([alvo, dano]);
  for (const nome of ['_puff', '_impactSfx', '_fleshImpact']) jogo[nome] = () => {};
  jogo._fireHitscan({ team: 'E' }, new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), 400, false, 'AWP', wid, false);
  cena.traverse(o => { o.geometry?.dispose(); if (Array.isArray(o.material)) o.material.forEach(m => m.dispose()); else o.material?.dispose(); });
  return danos;
}
{
  const parede = caixa(4, .12, 'madeira'); parede.rotation.y = Math.PI/4;
  const danos = disparar([parede]);
  cobrar(danos.length === 1 && danos[0][1] === 200, 'tábua rotacionada usa espessura do raio no espaço local, não AABB global');
}
{
  const parede = caixa(4, .2, 'madeira'); parede.rotation.y = Math.PI/4; parede.scale.set(2, 1, .5);
  cobrar(disparar([parede]).length === 1, 'escala não uniforme preserva espessura em metros do mundo');
}
{
  const parede = caixa(4, .22, 'madeira'); parede.rotation.y = Math.PI/4;
  cobrar(disparar([parede]).length === 0, 'incidência oblíqua acima do limite bloqueia');
}
{
  const parede = caixa(2, .2, 'madeira'); parede.geometry.setIndex([...parede.geometry.index.array].slice(0, 30));
  cobrar(disparar([parede]).length === 0, 'caixa aberta sem face de saída não autoriza travessia');
}
{
  const parede = caixa(2, .2, 'madeira'); const p = parede.geometry.attributes.position;
  p.setX(0, p.getX(0) - .1);
  cobrar(disparar([parede]).length === 0, 'malha deformada não herda autorização por conservar o tipo BoxGeometry');
}
{
  const madeira = caixa(2, .2, 'madeira'), concreto = caixa(2, .1, 'concreto', -5.05);
  cobrar(disparar([madeira, concreto]).length === 0, 'concreto começando dentro da madeira bloqueia');
}
{
  const madeira = caixa(2, .2, 'madeira'), concreto = caixa(2, .4, 'concreto', -5);
  cobrar(disparar([madeira, concreto]).length === 0, 'concreto começando antes da madeira bloqueia');
}
{
  const madeira = caixa(2, .2, 'madeira'), segunda = caixa(2, .2, 'madeira', -5.2);
  cobrar(disparar([madeira, segunda]).length === 0, 'duas tábuas adjacentes não viram uma única travessia');
}
{
  const madeira = caixa(2, .2, 'madeira'), concreto = caixa(2, 15, 'concreto', -3);
  cobrar(disparar([madeira, concreto]).length === 0, 'origem dentro de outro sólido não ignora esse bloqueio');
}
{
  const danos = disparar([caixa(2, .2, 'madeira')], { doisAlvos: true });
  cobrar(danos.length === 1 && danos[0][0].pos.z === -6, 'travessia atinge somente o primeiro combatente');
}
{
  const parede = caixa(2, .2, 'madeira'); parede.material = [parede.material];
  parede.geometry.clearGroups(); parede.geometry.addGroup(24, 6, 0);
  cobrar(disparar([parede]).length === 0, 'material em array com somente grupo frontal não é caixa completa');
}
{
  const parede = caixa(2, .2, 'madeira'); parede.geometry.setDrawRange(24, 6);
  cobrar(disparar([parede]).length === 0, 'drawRange restrito à entrada não autoriza saída ausente');
}
{
  const parede = caixa(2, .2, 'madeira'); const grupo = new THREE.Group();
  grupo.add(parede); grupo.rotation.y = Math.PI/4; parede.geometry.dispose();
  parede.geometry = new THREE.BoxGeometry(4, 2, .12); parede.position.z = -5*Math.SQRT2;
  grupo.position.x = 5;
  cobrar(disparar([parede]).length === 1, 'matriz de pai transformado participa do espaço local');
}
{
  const madeira = caixa(2, .2, 'madeira'), fora = caixa(2, .2, 'concreto'); fora.position.x = 5;
  cobrar(disparar([madeira, fora]).length === 1, 'oclusor fora do segmento não bloqueia toda travessia');
}
{
  const parede = caixa(2, 10, 'madeira', -2); parede.material.side = THREE.DoubleSide;
  parede.updateMatrixWorld(true);
  const dir = new THREE.Vector3(0, 0, -1);
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 1, 0), dir);
  const hit = ray.intersectObject(parede, false)[0];
  const saida = Game.prototype._penetrationExit.call({ online: false, world: { occluders: [parede] } }, hit, dir, 'awp', 'madeira');
  cobrar(hit && saida === null, 'resolvedor rejeita saída vista de dentro como autorização de entrada');
  parede.geometry.dispose(); parede.material.dispose();
}
cobrar(disparar([caixa(2, .2, 'madeira')], { doisAlvos: true, alvoNoTrecho: true }).length === 0,
  'combatente com entrada dentro do obstáculo não é ignorado para atingir outro atrás');
cobrar(disparar([caixa(2, .2, 'vidro')]).length === 1, 'vidro simples mantém contrato existente');
cobrar(disparar([caixa(2, .2, 'madeira')], { online: true }).length === 0, 'cliente online conserva ausência de dano local por travessia');
cobrar(disparar([caixa(2, .2, 'madeira')], { wid: 'ak' }).length === 0, 'nenhuma autorização nova para outras armas');
process.exitCode = falhas ? 1 : 0;
