import { THREE } from './harness.mjs';
import { readFile } from 'node:fs/promises';
const mutante = process.argv.find(a => a.startsWith('--mutante='))?.split('=')[1];
let corpo, mundo;
try {
  corpo = await import('../../public/js/hitboxes.js'); mundo = await import('../../public/js/ballistics.js');
  if (typeof mundo.resolverRaio !== 'function') throw Error('resolvedor de mundo ausente');
} catch (e) { console.error('FALHA contrato compartilhado de entrada e mundo:', e.message); process.exit(1); }
if (mutante) {
  const original = await readFile(new URL('../../public/js/ballistics.js', import.meta.url), 'utf8');
  const trocas = { ultimo: ['hit.dist < primeiro.dist', 'hit.dist > primeiro.dist'],
    parede: ['parede?.distance ?? Infinity', 'Infinity'], alcance: ['hit.dist > alcance', 'hit.dist > Infinity'] };
  const troca = trocas[mutante];
  if (!troca || !original.includes(troca[0])) throw Error('mutante não aplicou');
  mundo = await import(`data:text/javascript;base64,${Buffer.from(original.replace(...troca).replace("from 'three'", `from '${new URL('../../public/vendor/three.module.js', import.meta.url).href}'`)).toString('base64')}`);
}
let falhas = 0;
const cobrar = (ok, msg) => { console.log(`${ok ? 'OK' : 'FALHA'} ${msg}`); if (!ok) falhas++; };
const origem = new THREE.Vector3(0, 1, 0), direcao = new THREE.Vector3(0, 0, -1);
function alvo(z, x = 0, crouchF = 0) { const ent = { pos: new THREE.Vector3(x, 0, z) }; return { ent, pos: ent.pos, crouchF }; }
function resolver(alvos, paredes = [], opcoes = {}) {
  for (const p of paredes) p.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(opcoes.origem || origem, direcao, 0, corpo.ALCANCE_TIRO);
  const hits = ray.intersectObjects(paredes, false);
  return mundo.resolverRaio({ origem: opcoes.origem || origem, direcao, alvos, paredes: hits,
    intersectar: corpo.entradaCombatente, alcance: corpo.ALCANCE_TIRO,
    atravessar: opcoes.penetracao ? p => mundo.saidaPenetracao(p, direcao, opcoes.penetracao, paredes) : null });
}
function caixa(z, espessura = .2) { const m = new THREE.Mesh(new THREE.BoxGeometry(4, 2, espessura), new THREE.MeshBasicMaterial()); m.position.set(0, 1, z); return m; }
{
  const e = alvo(-10), hit = resolver([e]);
  cobrar(hit?.ent === e.ent && !hit.head && Math.abs(hit.dist - 9.55) < 1e-8 && Math.abs(hit.point.z + 9.55) < 1e-8,
    'entrada física, distância e ponto vêm do mesmo torso');
  const h = resolver([e], [], { origem: new THREE.Vector3(0, 1.6, 0) });
  cobrar(h?.head && Math.abs(h.dist - 9.75) < 1e-8, 'cabeça usa a mesma entrada analítica');
}
{
  const lateral = alvo(-10, .44), central = alvo(-10.1);
  cobrar(resolver([lateral, central])?.ent === central.ent, 'primeira superfície vence centro mais próximo');
}
cobrar(!resolver([alvo(-10)], [caixa(-9.65)])?.ent, 'empate de torso e parede bloqueia com tolerância numérica');
cobrar(resolver([alvo(-200.2)])?.ent && !resolver([alvo(-201)])?.ent, 'alcance limita a superfície, não o centro');
cobrar(resolver([alvo(-10, 0, 1)], [], { origem: new THREE.Vector3(0, 1.08, 0) })?.head, 'cabeça acompanha agachamento');
cobrar(corpo.alturaDoOlho(1) === 1.1 && corpo.alturaDoOlho(0, 1.5) === 1.5, 'origem/mira usam postura do corpo');
{
  const parede = caixa(-5), primeiro = alvo(-6), segundo = alvo(-8);
  const pen = { maxThickness: .28, damageMul: .5 };
  const hit = resolver([primeiro, segundo], [parede], { penetracao: pen });
  cobrar(hit?.ent === primeiro.ent && hit.damageMul === .5 && hit.atravessou?.object === parede,
    'mundo compartilha a continuação e o primeiro combatente');
  cobrar(!resolver([alvo(-5.4), segundo], [parede], { penetracao: pen })?.ent, 'entrada dentro do trecho não é pulada');
  cobrar(!resolver([primeiro], [parede])?.ent, 'sem autorização, parede continua bloqueando');
}
process.exitCode = falhas ? 1 : 0;
