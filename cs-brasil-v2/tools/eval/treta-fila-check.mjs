// A loja não anuncia fila de próximas skins (pedido do dono em 14/10/2026).
// A linha "NA FILA DE NOVAS SKINS" saiu da página e a lista TRETA_NEXT saiu do
// catálogo. Esta régua lê a marcação da loja, o catálogo e o CSS; um mutante
// devolve a linha numa cópia em memória e precisa ficar vermelho.
//   node tools/eval/treta-fila-check.mjs
//   node tools/eval/treta-fila-check.mjs --mutations
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';

const root=new URL('../../',import.meta.url);
const read=p=>fs.readFileSync(new URL(p,root),'utf8');
if(process.argv.includes('--mutations')){
  for(const [id,message] of [['linha','linha da fila na página'],['catalogo','TRETA_NEXT no catálogo'],['estilo','estilo .treta-next']]){
    const r=spawnSync(process.execPath,[new URL(import.meta.url).pathname,`--mutante=${id}`],{encoding:'utf8'});
    assert(r.status!==0 && r.stderr.includes(message),`Mutante ${id} não foi detectado`);
  }
  console.log('PASS: 3/3 mutações da fila detectadas');process.exit(0);
}
const mutant=process.argv.find(a=>a.startsWith('--mutante='))?.split('=')[1];
let page=read('src/components/TretaStore.astro'),catalog=read('public/js/treta-catalog.js'),css=read('public/treta.css');
if(mutant==='linha')page=page.replace('</section>\n  <section id="treta-quests-view"','  <p class="treta-next">NA FILA DE NOVAS SKINS <span>Fulano</span></p>\n  </section>\n  <section id="treta-quests-view"');
if(mutant==='catalogo')catalog+="\nexport const TRETA_NEXT = ['Fulano'];\n";
if(mutant==='estilo')css+='\n.treta-next{margin:24px 0}\n';
assert(!mutant || page!==read('src/components/TretaStore.astro') || catalog!==read('public/js/treta-catalog.js') || css!==read('public/treta.css'),'MUTANTE NÃO APLICOU');
assert(page.includes('id="treta-coins"'),'marcação da loja mudou: seção das moedas não encontrada');
assert(!/NA FILA|treta-next/i.test(page),'linha da fila na página da loja');
assert(!/TRETA_NEXT/.test(catalog),'TRETA_NEXT no catálogo da loja');
assert(!/\.treta-next\b/.test(css),'estilo .treta-next sobrou no CSS da loja');
for(const f of fs.readdirSync(new URL('public/js/',root)).filter(f=>f.startsWith('treta-')))
  assert(!/TRETA_NEXT|NA FILA DE NOVAS SKINS/.test(read('public/js/'+f)),`${f}: fila de skins ainda referenciada`);
console.log('PASS: loja sem fila de próximas skins (página, catálogo, CSS e módulos treta-*)');
