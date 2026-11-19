#!/usr/bin/env node
/* gauntlet-rodizio.mjs — QUAL MAPA A CAPTURA DESTA HORA FOTOGRAFA
   ----------------------------------------------------------------------------
   A captura com SwiftShader (único renderer de um runner sem GPU) roda a ~0,3 FPS: um
   mapa nos dois aspectos (16:9 e 3:2 — o dono joga em 3:2) leva ~10–15 min. Todos os
   mapas de uma vez não cabem no teto de 30 min por job (WT2). Então o gauntlet-captura
   fotografa UM mapa por hora, em rodízio: o mapa da hora H é jogaveis[H % N]. Com N
   jogáveis, cada mapa é refotografado a cada N horas (`--lista` mostra quais são).

   A lista sai do registro (`public/js/maps.js`), pelo mesmo parse do gl-shots.mjs, menos
   MAPAS_PARADOS: mapa novo entra no rodízio sozinho, mapa parado sai sozinho.

   Uso: node tools/eval/gauntlet-rodizio.mjs [--hora=<inteiro>] [--lista]
   ============================================================================ */
import { readFileSync } from 'node:fs';

const REG = readFileSync('public/js/maps.js', 'utf8');
const BLOCO = REG.slice(REG.indexOf('export const MAPS'), REG.indexOf('\n};', REG.indexOf('export const MAPS')));
const IDS = [...BLOCO.matchAll(/^\s{2}([a-z][a-z0-9_]*)\s*:\s*\{/gm)].map((m) => m[1]);
const PARADOS_BLOCO = (REG.match(/MAPAS_PARADOS\s*=\s*new Set\(\[([\s\S]*?)\]\)/) || [])[1] || '';
const PARADOS = new Set([...PARADOS_BLOCO.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]));
const JOGAVEIS = IDS.filter((id) => !PARADOS.has(id));
if (JOGAVEIS.length < 2) {
  console.error('gauntlet-rodizio: registro de mapas não parseado — falhar alto é melhor que fotografar o nada');
  process.exit(1);
}
if (process.argv.includes('--lista')) { console.log(JOGAVEIS.join('\n')); process.exit(0); }
const arg = process.argv.find((a) => a.startsWith('--hora='));
const bruto = arg ? arg.slice('--hora='.length) : null;
if (bruto !== null && !/^-?\d+$/.test(bruto)) {
  console.error(`gauntlet-rodizio: --hora precisa ser inteiro, veio "${bruto}"`);
  process.exit(2);
}
const hora = bruto !== null ? Number(bruto) : Math.floor(Date.now() / 3600000);
console.log(JOGAVEIS[((hora % JOGAVEIS.length) + JOGAVEIS.length) % JOGAVEIS.length]);
