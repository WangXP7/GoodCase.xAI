// As sete moedas TRETA$ da loja têm arte própria, no formato da moeda do Saci, e nenhuma
// aparece como "EM PRODUÇÃO" (pedido do dono, 14/10/2026). Lê o catálogo, os webp reais
// e o trecho da loja que desenha a seção "OURO COM HISTÓRIA". Mutantes em memória.
//   node tools/eval/treta-coins-art-check.mjs
//   node tools/eval/treta-coins-art-check.mjs --mutations
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import sharp from 'sharp';
import {TRETA_COINS} from '../../public/js/treta-catalog.js';

if(process.argv.includes('--mutations')){
  for(const [id,message] of [['sem-arte','arte ausente'],['duplicada','arte repetida'],['em-producao','EM PRODUÇÃO na seção de moedas'],['quadrada','fora do círculo não é transparente']]){
    const r=spawnSync(process.execPath,[new URL(import.meta.url).pathname,`--mutante=${id}`],{encoding:'utf8'});
    assert(r.status!==0 && r.stderr.includes(message),`Mutante ${id} não foi detectado (${r.stderr.slice(-300)})`);
  }
  console.log('PASS: 4/4 mutações das moedas detectadas');process.exit(0);
}
const mutant=process.argv.find(a=>a.startsWith('--mutante='))?.split('=')[1];
const coins=TRETA_COINS.map(c=>({...c}));
if(mutant==='sem-arte')coins[3].poster='/img/treta/coin-classic-inexistente.webp';
if(mutant==='duplicada')coins[6].poster=coins[0].poster;
assert.equal(coins.length,7,'a loja promete sete valores');
const seen=new Map();
for(const c of coins){
  const file=`public${c.poster || ''}`;
  assert(c.poster && fs.existsSync(file),`T$ ${c.value} ${c.name}: arte ausente (${c.poster})`);
  let buf=fs.readFileSync(file);
  const hash=createHash('sha256').update(buf).digest('hex');
  assert(!seen.has(hash),`T$ ${c.value} ${c.name}: arte repetida de ${seen.get(hash)}`);seen.set(hash,c.name);
  const meta=await sharp(buf).metadata();
  assert(meta.format==='webp' && meta.width===512 && meta.height===512 && meta.hasAlpha,`T$ ${c.value} ${c.name}: precisa ser webp 512×512 com alfa, como a do Saci`);
  assert(buf.length<=80*1024,`T$ ${c.value} ${c.name}: arte acima de 80 KB (${buf.length})`);
  const {data}=await sharp(buf).ensureAlpha().extractChannel(3).raw().toBuffer({resolveWithObject:true});
  if(mutant==='quadrada' && c.value===5)data.fill(255);
  const a=(x,y)=>data[y*512+x];
  assert([a(4,4),a(507,4),a(4,507),a(507,507)].every(v=>v===0),`T$ ${c.value} ${c.name}: fora do círculo não é transparente`);
  assert([a(256,256),a(256,20),a(20,256)].every(v=>v===255),`T$ ${c.value} ${c.name}: a moeda não ocupa o quadro de borda a borda`);
}
let store=fs.readFileSync('public/js/treta-store.js','utf8');
if(mutant==='em-producao')store=store.replace("node('small',c.name)","node('small',c.value===1?c.name:`${c.name} · EM PRODUÇÃO`)");
const section=store.split('\n').find(l=>l.includes("$('treta-coins')"));
assert(section,'trecho que desenha #treta-coins não encontrado');
assert(!/EM PRODU|treta-coin-pending|disabled/.test(section),'EM PRODUÇÃO na seção de moedas (ou moeda desabilitada/sem arte)');
assert(/c\.poster/.test(section),'a seção de moedas não usa a arte de cada moeda');
assert(!mutant,'MUTANTE NÃO REPROVOU');
console.log(`PASS: 7 moedas com arte própria (webp 512×512, círculo transparente, ${[...seen.keys()].length} arquivos distintos) e sem EM PRODUÇÃO`);
