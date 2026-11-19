#!/usr/bin/env node
/* mapas-paginas-check.mjs: cada arena tem página própria em /mapas/<id> (ADR 0008).
   Pedido do dono (14/10/2026): rota com endereço único para indexar e compartilhar. Mede o BUILD
   (dist/client), não o código: a página que importa é a que vai para o ar.

     MP1 · uma página por arena de src/data/jogo.ts (MAPAS), com title, canonical, og:url e og:image da arena
     MP2 · o botão abre o jogo já na arena (/?map=<id>) e a página liga para as outras arenas
     MP3 · /mapas liga cada arena para a página dela; o sitemap lista as páginas

   Uso: npm run build && node --experimental-strip-types tools/eval/mapas-paginas-check.mjs [--mutante=sem-pagina|sem-jogar|sem-sitemap] */
import { existsSync, readFileSync } from 'node:fs';

const MUT = (process.argv.find((a) => a.startsWith('--mutante=')) || '').split('=')[1] || '';
const SITE = 'https://www.corosolto.com.br';
// Lê o MAPAS de verdade (não uma regex sobre o texto): arena com formatação diferente não pode sumir da conta.
const { MAPAS } = await import('../../src/data/jogo.ts');
const mapas = (MAPAS || []).map((m) => ({ id: m.id, nome: m.nome }));
if (!mapas.length) { console.error('✗ nenhuma arena lida de MAPAS em src/data/jogo.ts: a régua não sabe medir'); process.exit(1); }
if (!existsSync('dist/client/mapas/index.html')) { console.error('✗ sem build: rode npm run build antes'); process.exit(1); }

const ler = (arquivo) => (existsSync(arquivo) ? readFileSync(arquivo, 'utf8') : null);
const attr = (html, re) => re.exec(html || '')?.[1] ?? null;
const falhas = [];
const item = (id, erros, msg) => { if (erros.length) falhas.push(`${id} ${msg}: ${erros.slice(0, 4).join('; ')}`); else console.log(`✓ ${id}`); };

const paginas = Object.fromEntries(mapas.map((m) => [m.id, ler(`dist/client/mapas/${m.id}/index.html`)]));
if (MUT === 'sem-pagina') paginas[mapas[0].id] = null;
if (MUT === 'sem-jogar') paginas[mapas[0].id] = paginas[mapas[0].id].replace(`href="/?map=${mapas[0].id}"`, 'href="/"');

// MP1
{
  const erros = [];
  for (const m of mapas) {
    const html = paginas[m.id];
    if (!html) { erros.push(`/mapas/${m.id} sem página no build`); continue; }
    const url = `${SITE}/mapas/${m.id}`;
    if (!attr(html, /<title>([^<]*)<\/title>/)?.includes(m.nome)) erros.push(`${m.id}: title sem "${m.nome}"`);
    if (attr(html, /<link rel="canonical" href="([^"]+)"/) !== url) erros.push(`${m.id}: canonical`);
    if (attr(html, /<meta property="og:url" content="([^"]+)"/) !== url) erros.push(`${m.id}: og:url`);
    if (attr(html, /<meta property="og:image" content="([^"]+)"/) !== `${SITE}/img/map-previews/${m.id}.jpg`) erros.push(`${m.id}: og:image não é a arte da arena`);
    if (!existsSync(`public/img/map-previews/${m.id}.jpg`)) erros.push(`${m.id}: arte public/img/map-previews/${m.id}.jpg não existe`);
    if (/<meta name="robots" content="noindex/.test(html)) erros.push(`${m.id}: noindex`);
  }
  item('MP1', erros, `páginas de arena fora do contrato (${mapas.length} arenas)`);
}

// MP2
{
  const erros = [];
  for (const m of mapas) {
    const html = paginas[m.id];
    if (!html) continue;
    if (!html.includes(`href="/?map=${m.id}"`)) erros.push(`${m.id}: sem botão para jogar nesta arena`);
    for (const outro of mapas) if (outro.id !== m.id && !html.includes(`href="/mapas/${outro.id}"`)) erros.push(`${m.id}: sem link para ${outro.id}`);
  }
  // O botão só abre a arena se ela estiver no menu: arena parada (public/js/maps.js) ignoraria o ?map=.
  const parados = /MAPAS_PARADOS = new Set\(\[([^\]]*)\]/.exec(readFileSync('public/js/maps.js', 'utf8'))?.[1];
  if (parados === undefined) erros.push('MAPAS_PARADOS não encontrado em public/js/maps.js: a régua não sabe se o botão abre a arena');
  else for (const m of mapas) if (new RegExp(`['"]${m.id}['"]`).test(parados)) erros.push(`${m.id}: arena parada, o ?map= não abre`);
  item('MP2', erros, 'jogar e navegar entre arenas');
}

// MP3
{
  const erros = [];
  const lista = ler('dist/client/mapas/index.html');
  for (const m of mapas) if (!lista.includes(`href="/mapas/${m.id}"`)) erros.push(`/mapas não liga para ${m.id}`);
  let sitemap = readFileSync('src/pages/sitemap.xml.ts', 'utf8');
  if (MUT === 'sem-sitemap') sitemap = sitemap.replace('...MAPAS.map(', '...[].map(');
  if (!/\.\.\.MAPAS\.map\(\(m\) => \[`\/mapas\/\$\{m\.id\}`/.test(sitemap)) erros.push('sitemap.xml.ts não lista /mapas/<id>');
  item('MP3', erros, 'ligação a partir de /mapas e sitemap');
}

if (falhas.length) { for (const f of falhas) console.error(`✗ ${f}`); process.exit(1); }
console.log(`mapas-paginas-check: ${mapas.length} arenas com página própria`);
