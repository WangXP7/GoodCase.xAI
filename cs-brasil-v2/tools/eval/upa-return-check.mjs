import './harness.mjs';
import { MAPS, MAPAS_PARADOS, MAP_IDS_JOGAVEIS, mapasDoMenu, mapaParado, mapaDaSessao, nextMapId } from '../../public/js/maps.js';
import { spawnSync } from 'node:child_process';

if (process.argv.includes('--self-test')) {
  const result = spawnSync(process.execPath, [new URL(import.meta.url).pathname, '--mutante=reestaciona'], { encoding: 'utf8' });
  const killed = result.status === 1 && /✗ UPAR1/.test(result.stdout) && /✗ UPAR4/.test(result.stdout);
  console.log(`${killed ? '✓' : '✗'} reestaciona: retorno por URL e mapa fixado rejeitado`);
  process.exit(killed ? 0 : 1);
}
const mutant = process.argv.find(value => value.startsWith('--mutante='))?.split('=')[1];
if (mutant && mutant !== 'reestaciona') throw new Error(`mutante desconhecido: ${mutant}`);
if (mutant) MAPAS_PARADOS.add('upa_24h');

const id = 'upa_24h';
const rows = [
  ['UPAR1', !mapaParado(id), 'UPA está liberada no registro de mapas'],
  ['UPAR2', MAP_IDS_JOGAVEIS.includes(id) && mapasDoMenu().includes(id), 'menu normal oferece UPA'],
  ['UPAR3', MAP_IDS_JOGAVEIS.some(previous => nextMapId(previous) === id), 'rotação normal chega à UPA'],
  ['UPAR4', mapaDaSessao({ urlMap: id }) === id && mapaDaSessao({ savedMap: id, pinned: true }) === id, 'URL e mapa fixado abrem UPA'],
  ['UPAR5', typeof MAPS[id]?.build === 'function' && MAPS[id].ctfMode === true, 'construtor e modo CTF preservados'],
];
for (const [code, ok, detail] of rows) console.log(`${ok ? '✓' : '✗'} ${code} ${detail}`);
process.exit(rows.every(([, ok]) => ok) ? 0 : 1);
