#!/usr/bin/env node
// Relato de 14/10/2026: o FAQ do SOBRE O JOGO citava 4 mapas ("incluem Praça, Piscina,
// Loja H e Ferro Velho") com 12 selecionáveis no menu. A resposta (PT e EN, visível e
// no JSON-LD) precisa dizer quantos são e nomear todos os mapas da vitrine /mapas,
// que o game-pages-check já amarra ao registro jogável de public/js/maps.js.
// Uso: BASE=http://127.0.0.1:4564 node tools/eval/home-faq-maps-check.mjs [--mutante=mapa-a-menos]
import assert from 'node:assert/strict';

const base = process.env.BASE || 'http://127.0.0.1:4339';
const mutant = process.argv.includes('--mutante=mapa-a-menos');
const get = async (path) => { const r = await fetch(new URL(path, base)); assert.equal(r.status, 200, `${path}: HTTP ${r.status}`); return r.text(); };
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#(?:39|x27);/gi, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const nodes = (html) => [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].flatMap((m) => { const d = JSON.parse(m[1]); return d['@graph'] ?? [d]; });

const [home, mapas] = await Promise.all([get('/'), get('/mapas')]);
const names = nodes(mapas).find((n) => n['@type'] === 'ItemList').itemListElement.map((i) => i.name ?? i.item?.name);
const faq = nodes(home).find((n) => n['@type'] === 'FAQPage').mainEntity.find((q) => q.name === 'Quais mapas o jogo tem?');
const visible = [...home.matchAll(/<summary data-en="([^"]*)">Quais mapas o jogo tem\?<\/summary><p data-en="([^"]*)">([^<]*)<\/p>/g)][0];
assert.ok(faq && visible, 'pergunta "Quais mapas o jogo tem?" ausente da home');
let answers = { 'JSON-LD': faq.acceptedAnswer.text, 'visível PT': decode(visible[3]), 'visível EN': decode(visible[2]) };
if (mutant) answers = Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, v.replace(names.at(-1), '')]));
const failures = [];
for (const [where, text] of Object.entries(answers)) {
  const missing = names.filter((name) => !text.includes(name));
  if (missing.length) failures.push(`${where}: faltam ${missing.length} de ${names.length} mapas (${missing.join(', ')})`);
  if (!text.includes(String(names.length))) failures.push(`${where}: não diz que são ${names.length} mapas`);
}
for (const failure of failures) console.error(`✗ ${failure}`);
console.log(`FAQ de mapas cobre os ${names.length} mapas da vitrine: ${failures.length ? 'FAIL' : 'PASS'}${mutant ? ' (mutante mapa-a-menos)' : ''}`);
process.exitCode = failures.length ? 1 : 0;
