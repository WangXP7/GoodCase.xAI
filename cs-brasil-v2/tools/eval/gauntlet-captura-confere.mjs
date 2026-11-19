#!/usr/bin/env node
/* gauntlet-captura-confere.mjs — a captura horária só passa com PNG do mapa e os aspectos em live.
   O gl-shots não derruba o passo (o parcial sobe mesmo assim); quem deixa o job vermelho é este.
   Uso: node tools/eval/gauntlet-captura-confere.mjs <pasta> <mapa> */
import { existsSync, readdirSync, readFileSync } from 'node:fs';

const [dir, id] = process.argv.slice(2);
if (!dir || !id) { console.error('uso: gauntlet-captura-confere.mjs <pasta> <mapa>'); process.exit(2); }
const pngs = existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith(`game-${id}-`) && f.endsWith('.png')) : [];
let metricas = [];
try { metricas = JSON.parse(readFileSync(`${dir}/_metrics.json`, 'utf8')); } catch { /* sem métrica = sem captura */ }
const doMapa = metricas.filter((x) => x.map === id);
const semLive = doMapa.filter((x) => x.tLive == null).map((x) => x.aspect);
if (!pngs.length || !doMapa.length || semLive.length) {
  console.log(`::error::captura de ${id} incompleta: ${pngs.length} PNG, ${doMapa.length} aspecto(s) medido(s), sem live: ${semLive.join(', ') || 'nenhum'}`);
  process.exit(1);
}
console.log(`${id}: ${pngs.length} PNG, ${doMapa.length} aspecto(s) em live`);
