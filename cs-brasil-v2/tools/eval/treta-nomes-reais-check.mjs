// Nenhum texto visível da loja cita político real (pedido do dono, 14/10/2026): as skins
// levam o nome do PERSONAGEM do jogo ("Barbudo do Drip", "Capitão Cyborg"), nunca o da
// pessoa. Varre o que o jogador lê: nome, série e descrição de todo item do catálogo, os
// textos da loja (treta-store.js e TretaStore.astro), a vitrine SKINS NOVAS do menu
// (treta-vitrine.js e o bloco dela no index.astro) e os campos de texto do manifesto de
// skins. Os `id` ficam de fora de propósito: inventário, banco e caminho de asset dependem
// deles e o jogador não os vê. Mutantes em memória.
//   node tools/eval/treta-nomes-reais-check.mjs
//   node tools/eval/treta-nomes-reais-check.mjs --mutations
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import * as catalog from '../../public/js/treta-catalog.js';

/* Pessoas reais que já apareceram (ou rondam) o catálogo de skins. Comparação sem acento e
   sem caixa, por palavra inteira: "Zero Um" casa, "zerou" não. */
const PESSOAS=['lula','bolsonaro','michelle','janja','zero um','aljuiz','xandao','moraes','flavio','dilma','haddad','zanatta','damares','tarcisio','eduardo bolsonaro','carlos bolsonaro'];
const norm=s=>String(s).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
const achar=texto=>PESSOAS.find(p=>new RegExp(`(^|[^a-z0-9])${p.replace(' ','[\\s_-]+')}([^a-z0-9]|$)`).test(norm(texto)));

if(process.argv.includes('--mutations')){
  for(const id of ['nome','descricao','serie','loja','astro','manifesto','vitrine','vitrine-html']){
    const r=spawnSync(process.execPath,[new URL(import.meta.url).pathname,`--mutante=${id}`],{encoding:'utf8'});
    assert(r.status!==0 && r.stderr.includes('pessoa real'),`Mutante ${id} não foi detectado (${(r.stderr+r.stdout).slice(-300)})`);
  }
  console.log('PASS: 8/8 mutações de nome real detectadas');process.exit(0);
}
const mutant=process.argv.find(a=>a.startsWith('--mutante='))?.split('=')[1];
const falhas=[];
const olhar=(onde,texto)=>{const p=achar(texto);if(p)falhas.push(`${onde}: "${String(texto).slice(0,80)}" cita pessoa real (${p})`);};

/* 1. Catálogo: todo array de itens exportado (skins, óculos, propostas, moedas). */
const VISIVEIS=['name','series','description','compatibility','mark','title','alt','label','caption'];
let itens=0;
for(const [exp,valor] of Object.entries(catalog)){
  if(!Array.isArray(valor))continue;
  for(const original of valor){
    if(!original || typeof original!=='object')continue;
    const item={...original};
    if(exp==='TRETA_SKINS' && item.id==='lula-drip'){
      if(mutant==='nome')item.name='Lula do Drip';
      if(mutant==='serie')item.series='BOLSONARO 2500';
    }
    if(exp==='TRETA_SKINS' && item.id==='senador-drip' && mutant==='descricao')item.description='Zero Um de preto e violeta.';
    itens++;
    for(const k of VISIVEIS)if(typeof item[k]==='string')olhar(`${exp}[${item.id ?? item.value ?? item.name}].${k}`,item[k]);
  }
}
assert(itens>=13,`catálogo encolheu demais (${itens} itens): a régua não está lendo o que a loja mostra`);
assert(catalog.TRETA_SKINS.length>=13,'TRETA_SKINS sumiu do catálogo');

/* 2. Textos fixos da loja: literais de string do JS e o HTML do componente. Os `id` de
   skin não entram em literal de texto visível; caminhos de arquivo ficam de fora. */
for(const arquivo of ['treta-store.js','treta-vitrine.js']){
  let js=fs.readFileSync(`public/js/${arquivo}`,'utf8');
  if(mutant==='loja' && arquivo==='treta-store.js')js=js.replace("image.alt=s.name","image.alt=`Janja ${s.name}`");
  if(mutant==='vitrine' && arquivo==='treta-vitrine.js')js=js.replace('img.alt=`Skin ${s.name}`','img.alt=`Skin do Lula ${s.name}`');
  for(const m of js.matchAll(/'([^'\n]*)'|`([^`\n]*)`/g)){
    const texto=m[1] ?? m[2];
    if(/^\/|\.(webp|glb|mp4|webm|json)$/.test(texto))continue;
    olhar(arquivo,texto);
  }
}
let hub=fs.readFileSync('src/pages/index.astro','utf8').match(/<section id="treta-vitrine"[\s\S]*?<\/section>/)?.[0];
assert(hub,'bloco da vitrine sumiu do index.astro: a régua não está lendo o que o menu mostra');
if(mutant==='vitrine-html')hub=hub.replace('SKINS NOVAS','SKINS DO BOLSONARO');
olhar('index.astro (vitrine)',hub.replace(/<[^>]*>/g,' ').replace(/\s+/g,' '));
const componentes=fs.readdirSync('src/components').filter(f=>/^Treta.*\.astro$/.test(f));
assert(componentes.includes('TretaStore.astro') && componentes.includes('TretaDialogs.astro'),`componentes da loja mudaram de nome: ${componentes}`);
for(const f of componentes){
  let astro=fs.readFileSync(`src/components/${f}`,'utf8');
  if(mutant==='astro' && f==='TretaStore.astro')astro=astro.replace('OURO COM HISTÓRIA','OURO DO BOLSONARO');
  olhar(f,astro.replace(/<[^>]*>/g,' ').replace(/\s+/g,' '));
  for(const m of astro.matchAll(/(?:alt|title|aria-label|placeholder)="([^"]*)"/g))olhar(`${f} (atributo)`,m[1]);
}

/* 3. Manifesto de skins: só campos de texto (o resto é caminho, hash e número). */
const manifest=JSON.parse(fs.readFileSync('public/models/skins/manifest.json','utf8'));
if(mutant==='manifesto')manifest.skins['lula-drip'].name='Lula do Drip';
for(const [id,s] of Object.entries(manifest.skins))for(const k of VISIVEIS)if(typeof s[k]==='string')olhar(`manifest.skins[${id}].${k}`,s[k]);

if(falhas.length){console.error(falhas.join('\n'));process.exit(1);}
assert(!mutant,'MUTANTE NÃO REPROVOU');
console.log(`PASS: ${itens} itens do catálogo, textos da loja e manifesto sem nome de pessoa real`);
