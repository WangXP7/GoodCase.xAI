/* ============================================================================
   gauntlet-rodizio-check.mjs — O RODÍZIO DA CAPTURA HORÁRIA COBRE OS JOGÁVEIS E RECUSA LIXO
   ----------------------------------------------------------------------------
   POR QUE EXISTE
   Na revisão do #859, `gauntlet-rodizio.mjs --hora=abc` imprimia `undefined` com
   exit 0: o workflow aceitaria o nome e fotografaria o nada. O corpo do PR também
   dizia 11 jogáveis quando a main lista 12; a contagem não pode depender de texto.

   O QUE ESTA RÉGUA PROVA (rodando o script de verdade)
     GR1 `--lista` = registro de public/js/maps.js menos MAPAS_PARADOS, sem
         repetição e sem parado
     GR2 as horas 0..N-1 passam por cada jogável uma vez, e H e H+N dão o mesmo
     GR3 `--hora` que não é inteiro (abc, vazio, 1.5, 2x) sai com exit≠0 e sem
         nada no stdout

   Uso: node tools/eval/gauntlet-rodizio-check.mjs
        [--mutante=aceita-lixo|sem-filtro-parados|rodizio-torto]
   ============================================================================ */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MUTANTES = ['aceita-lixo', 'sem-filtro-parados', 'rodizio-torto'];
const mutante = (process.argv.find((a) => a.startsWith('--mutante=')) || '').split('=')[1] || '';
if (mutante && !MUTANTES.includes(mutante)) throw new Error(`mutante desconhecido: ${mutante}`);

let script = readFileSync(path.join(ROOT, 'tools/eval/gauntlet-rodizio.mjs'), 'utf8');
const trocar = (de, para) => {
  if (!script.includes(de)) throw new Error(`mutante ${mutante} não achou o alvo: ${de}`);
  script = script.replace(de, para);
};
if (mutante === 'aceita-lixo') trocar("!/^-?\\d+$/.test(bruto)", 'false');
if (mutante === 'sem-filtro-parados') trocar('IDS.filter((id) => !PARADOS.has(id))', 'IDS.slice()');
if (mutante === 'rodizio-torto') trocar('JOGAVEIS[((hora % JOGAVEIS.length)', 'JOGAVEIS[((hora % (JOGAVEIS.length - 1))');

const tmp = mkdtempSync(path.join(os.tmpdir(), 'rodizio-'));
const alvo = path.join(tmp, 'gauntlet-rodizio.mjs');
writeFileSync(alvo, script);
const rodar = (...args) => spawnSync(process.execPath, [alvo, ...args], { cwd: ROOT, encoding: 'utf8' });

const falhas = [];
const reg = readFileSync(path.join(ROOT, 'public/js/maps.js'), 'utf8');
const ini = reg.indexOf('export const MAPS = {');
const registro = [...reg.slice(ini, reg.indexOf('\n};', ini)).matchAll(/^ {2}([a-z][a-z0-9_]*):\s*\{/gm)].map((m) => m[1]);
const parados = [...((reg.match(/MAPAS_PARADOS = new Set\(\[([\s\S]*?)\]\)/) || [])[1] || '').matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
const esperado = registro.filter((id) => !parados.includes(id));
if (registro.length < 2 || !parados.length) falhas.push('a régua não leu o registro ou MAPAS_PARADOS de maps.js');

const lista = rodar('--lista').stdout.trim().split('\n').filter(Boolean);
if (lista.join(',') !== esperado.join(',')) falhas.push(`GR1 --lista ${lista.length} [${lista}] ≠ registro menos parados ${esperado.length} [${esperado}]`);
if (new Set(lista).size !== lista.length) falhas.push('GR1 --lista repete mapa');
const parado = lista.find((id) => parados.includes(id));
if (parado) falhas.push(`GR1 ${parado} está parado e entrou no rodízio`);

const N = esperado.length;
const vistos = [];
for (let h = 0; h < N; h++) {
  const r = rodar(`--hora=${h}`), r2 = rodar(`--hora=${h + N}`);
  const id = r.stdout.trim();
  if (r.status !== 0 || !esperado.includes(id)) falhas.push(`GR2 hora ${h}: "${id}" (exit ${r.status})`);
  if (r2.stdout.trim() !== id) falhas.push(`GR2 hora ${h} e ${h + N} dão mapas diferentes`);
  vistos.push(id);
}
const faltam = esperado.filter((id) => !vistos.includes(id));
if (faltam.length) falhas.push(`GR2 ${N} horas seguidas não passam por ${faltam.join(', ')}`);

for (const lixo of ['abc', '', '1.5', '2x']) {
  const r = rodar(`--hora=${lixo}`);
  if (r.status === 0 || r.stdout.trim()) falhas.push(`GR3 --hora="${lixo}" saiu ${r.status} com "${r.stdout.trim()}"`);
}
rmSync(tmp, { recursive: true, force: true });

const rotulo = mutante ? ` (mutante ${mutante})` : '';
if (falhas.length) {
  console.log(`gauntlet-rodizio-check: FAIL${rotulo}`);
  for (const f of falhas) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`gauntlet-rodizio-check: PASS (${N} jogáveis, ${parados.length} parados fora, entrada inválida recusada)`);
