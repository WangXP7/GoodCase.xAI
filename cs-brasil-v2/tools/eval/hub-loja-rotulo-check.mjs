// A aba da loja no menu do hub diz só "LOJA" (pedido do dono, 14/10/2026: sai o "T$").
// Lê o botão real de src/pages/index.astro; as outras abas do hub não podem mudar junto.
//   node tools/eval/hub-loja-rotulo-check.mjs
//   node tools/eval/hub-loja-rotulo-check.mjs --mutations
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';

if(process.argv.includes('--mutations')){
  for(const [id,msg] of [['tdolar','aba da loja'],['sumiu','aba da loja não encontrada']]){
    const r=spawnSync(process.execPath,[new URL(import.meta.url).pathname,`--mutante=${id}`],{encoding:'utf8'});
    assert(r.status!==0 && r.stderr.includes(msg),`Mutante ${id} não foi detectado (${r.stderr.slice(-300)})`);
  }
  console.log('PASS: 2/2 mutações do rótulo da loja detectadas');process.exit(0);
}
const mutant=process.argv.find(a=>a.startsWith('--mutante='))?.split('=')[1];
let page=fs.readFileSync('src/pages/index.astro','utf8');
if(mutant==='tdolar')page=page.replace('data-hub-tab="loja">LOJA<','data-hub-tab="loja">LOJA <span aria-hidden="true">T$</span><');
if(mutant==='sumiu')page=page.replace('data-hub-tab="loja"','data-hub-tab="lojinha"');
const abas=Object.fromEntries([...page.matchAll(/<button[^>]*data-hub-tab="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)].map(m=>[m[1],m[2].replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim()]));
assert('loja' in abas,'aba da loja não encontrada no hub (data-hub-tab="loja")');
assert.equal(abas.loja,'LOJA',`aba da loja deve dizer só LOJA, diz "${abas.loja}"`);
for(const id of ['jogar','ranking','comunidade'])assert(id in abas,`aba ${id} sumiu do hub`);
assert(!mutant,'MUTANTE NÃO REPROVOU');
console.log(`PASS: aba da loja diz "${abas.loja}"; abas do hub: ${Object.entries(abas).map(([k,v])=>`${k}=${v}`).join(', ')}`);
