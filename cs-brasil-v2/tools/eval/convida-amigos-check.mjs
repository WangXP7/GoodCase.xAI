#!/usr/bin/env node
/* ============================================================================
   convida-amigos-check.mjs — O MODAL DE CONVITE TEM AS REDES PEDIDAS E COPIA?
   ----------------------------------------------------------------------------
   O CASO (lane glm/amigos, 14/10/2026): o dono pediu convidar amigos por
   Instagram, e-mail, LinkedIn, X e TikTok. Rede nenhuma libera lista de amigos
   de terceiro para a web; o fluxo honesto é mensagem copiada + caixa de entrada
   aberta (e WhatsApp, que aceita o texto na URL). Esta régua trava o contrato:
   as plataformas exigidas existem, os links são os de MENSAGEM (não a home),
   quem não recebe texto na URL COPIA antes de abrir, e o Web Share entra como
   "MAIS APPS" quando existe.

   MUTAÇÕES: `sem-whatsapp`, `share-mudo`, `vaza-legado` e `email-estoura`
   retiram uma garantia por vez. Todas têm que ficar vermelhas.

   Uso: node tools/eval/convida-amigos-check.mjs [--mutante=...]
   ============================================================================ */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = join(import.meta.dirname, '../..');
const mutante = process.argv.find((a) => a.startsWith('--mutante='))?.split('=')[1];
if (mutante && !['sem-whatsapp', 'share-mudo', 'vaza-legado', 'email-estoura'].includes(mutante)) throw new Error(`mutante desconhecido: ${mutante}`);

// stubs de DOM/navegador suficientes para montaConvite
const botoesDe = (dialog) => [...dialog.querySelectorAll('button')];
function docFalso() {
  const clicados = [];
  const dialog = {
    className: '', innerHTML: '', attrs: {},
    children: [], appended: [],
    setAttribute(k, v) { this.attrs[k] = v; },
    append(...ns) { this.children.push(...ns); },
    querySelectorAll: () => {
      const achados = [];
      const desce = (nos) => { for (const n of nos) { if (n._botao) achados.push(n); if (n.children?.length) desce(n.children); } };
      desce(dialog.children);
      return achados;
    },
    close() { this.fechado = true; },
    addEventListener() {},
  };
  const doc = {
    _aviso: null,
    createElement(tag) {
      if (tag === 'dialog') return dialog;
      const no = { tag, children: [], _botao: false, dataset: {}, attrs: {} };
      no.append = (...ns) => no.children.push(...ns);
      no.setAttribute = (k, v) => { no.attrs[k] = v; };
      no.addEventListener = () => {};
      if (tag === 'button') {
        no._botao = true;
        no.onclick = null;
        no.click = () => clicados.push(no);
      }
      return no;
    },
  };
  return { doc, dialog, clicados };
}

let community = readFileSync(join(ROOT, 'public/js/community.js'), 'utf8');
if (mutante === 'vaza-legado') community = community.replace('if(UI_V3){const convidar=', 'if(true){const convidar=');
if (mutante === 'email-estoura') community = community.replace("catch(e){if(!UI_V3 || !q.includes('@'))throw e;}", 'catch(e){throw e;}');

let modulo;
if (['sem-whatsapp', 'share-mudo'].includes(mutante)) {
  const tmp = join(ROOT, 'public/js/convida-amigos.mutante.mjs');
  let src = readFileSync(join(ROOT, 'public/js/convida-amigos.js'), 'utf8');
  if (mutante === 'sem-whatsapp') {
    src = src.replace("{ id: 'whatsapp', nome: 'WhatsApp', url: (texto) => `https://wa.me/?text=${encodeURIComponent(texto)}`, copia: false },", '');
  } else {
    src = src.replace('const resultado = await compartilhar(', "const resultado = await (() => Promise.resolve('cancelado'))(");
  }
  const { writeFileSync, rmSync } = await import('node:fs');
  writeFileSync(tmp, src);
  try { modulo = await import(pathToFileURL(tmp).href); } finally { rmSync(tmp, { force: true }); }
} else {
  modulo = await import(pathToFileURL(join(ROOT, 'public/js/convida-amigos.js')).href);
}

const falhas = [];
const EXIGIDAS = ['whatsapp', 'instagram', 'x', 'linkedin', 'tiktok', 'email'];
const ids = modulo.PLATAFORMAS.map((p) => p.id);
for (const id of EXIGIDAS) if (!ids.includes(id)) falhas.push(`plataforma exigida ausente: ${id}`);

const { doc, dialog } = docFalso();
const eventos = [];
const aberturas = [];
const clipboard = { escrito: null, writeText(t) { eventos.push('copiar'); this.escrito = t; return Promise.resolve(); } };
const convite = modulo.textoConvite('testador');
const montado = modulo.montaConvite({ nick: 'testador', doc, nav: { clipboard, share: undefined }, abre: (u) => { eventos.push('abrir'); aberturas.push(u); } });

if (montado !== dialog) falhas.push('montaConvite não devolveu o dialog criado no doc passado');

const porId = Object.fromEntries(modulo.PLATAFORMAS.map((p) => [p.id, p]));
if (porId.whatsapp && !porId.whatsapp.url(convite).startsWith('https://wa.me/?text=')) falhas.push('WhatsApp não manda o texto na URL (wa.me ?text=)');
if (porId.email && !/^mailto:\?subject=.+&body=/.test(porId.email.url(convite))) falhas.push('e-mail sem mailto com assunto e corpo preenchidos');
for (const id of ['instagram', 'x', 'linkedin', 'tiktok']) {
  const p = porId[id];
  if (p && p.copia !== true) falhas.push(`${id} precisa copiar a mensagem (a URL dele não recebe texto)`);
  if (p && !/messages|direct\/inbox|messaging|\/inbox/.test(p.url(convite))) falhas.push(`${id} não abre a caixa de mensagens (${p.url(convite)})`);
}

// clique de verdade: iniciar a cópia antes de abrir preserva o gesto que libera a nova aba
if (porId.instagram) {
  const botao = botoesDe(montado).find((b) => b.dataset.plataforma === 'instagram');
  await botao.onclick();
  if (eventos.slice(0, 2).join(',') !== 'copiar,abrir') falhas.push('clique no Instagram não inicia a cópia antes de abrir a caixa');
  if (clipboard.escrito !== convite) falhas.push('clique no Instagram não copiou o convite');
  if (!aberturas.some((u) => String(u).includes('instagram.com/direct/inbox'))) falhas.push('clique no Instagram não abriu a caixa de entrada');
}

// texto do convite com link rastreável e nick opcional
if (!convite.includes('utm_medium=convidar-amigos')) falhas.push('convite sem link com utm_medium=convidar-amigos');
if (modulo.textoConvite('').includes('testador')) falhas.push('convite sem nick não pode se apresentar como alguém');

// nativo só quando existe share, e o clique precisa chamar o compartilhamento real
const comShare = docFalso();
let dadosNativos = null;
modulo.montaConvite({ nick: 'testador', doc: comShare.doc, nav: { clipboard, share: async (dados) => { dadosNativos = dados; } }, abre: () => {} });
const botaoNativo = botoesDe(comShare.dialog).find((b) => b.dataset.plataforma === 'nativo');
if (!botaoNativo) falhas.push('com navigator.share disponível, falta o botão MAIS APPS');
else {
  try { await botaoNativo.onclick(); } catch (e) { falhas.push(`clique em MAIS APPS quebrou: ${e.message}`); }
  if (!dadosNativos?.text?.includes('CORO SOLTO') || !dadosNativos?.url?.includes('utm_medium=convidar-amigos')) {
    falhas.push('clique em MAIS APPS não entregou texto e link ao compartilhamento nativo');
  }
}
const semShare = docFalso();
modulo.montaConvite({ doc: semShare.doc, nav: { clipboard }, abre: () => {} });
if (botoesDe(semShare.dialog).some((b) => b.dataset.plataforma === 'nativo')) falhas.push('sem navigator.share, o botão MAIS APPS não devia existir');

if (!/const UI_V3=document\.documentElement(?:\?\.|\.)dataset(?:\?\.|\.)ui==='v3'/.test(community)
  || !/if\(UI_V3\)\{const convidar=/.test(community)
  || !/UI_V3\?tr\('Buscar por nickname ou e-mail'\):'Buscar pelo nickname'/.test(community)) {
  falhas.push('integração do convite vaza para o legado');
}
if (!/catch\(e\)\{if\(!UI_V3 \|\| !q\.includes\('@'\)\)throw e;\}/.test(community)) {
  falhas.push('busca por e-mail não degrada para lista vazia quando a migration 070 falta');
}

if (mutante) {
  const alvo = { 'sem-whatsapp': 'whatsapp', 'share-mudo': 'compartilhamento nativo', 'vaza-legado': 'vaza para o legado', 'email-estoura': 'degrada para lista vazia' }[mutante];
  const morde = falhas.some((f) => f.includes(alvo));
  console.log(morde ? `mutante ${mutante} reprovado como devia.` : `MUTAÇÃO PASSOU — ${mutante} não foi sentido.`);
  process.exit(morde ? 0 : 1);
}
if (falhas.length) {
  console.error('convite de amigos reprovado:');
  for (const f of falhas) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log('convite confere: 6 plataformas, cópia/abertura, compartilhamento nativo, legado isolado e busca por e-mail degradável.');
