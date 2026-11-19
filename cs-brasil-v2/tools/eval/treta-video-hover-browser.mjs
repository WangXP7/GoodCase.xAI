// Vídeo de hover dos cards de skin da loja, medido no jogo real (pedido do dono, 14/10/2026).
//
//   V1  boot: do primeiro request até a loja aberta, nenhum request a /video/ e nenhum
//       <video> na loja (o #char-preview-video do menu é de outra tela). A contagem de requests do boot vai no relatório.
//   V2  hover com mouse: o card cria o <video> (preload=none, mudo, loop), baixa a skin
//       certa e toca; ao sair, pausa.
//   V3  foco por teclado (Tab) toca o vídeo do card focado.
//   V4  prefers-reduced-motion: hover e foco não baixam vídeo nem criam <video>.
//   V5  toque (390×844): o primeiro toque toca o vídeo sem abrir o detalhe; o segundo abre.
//
// Uso (servidor próprio; a 8123 é de outra sessão):
//   BASE=http://localhost:9311 tools/eval/with-browser-lock.sh node tools/eval/treta-video-hover-browser.mjs
//   ... --mutations   roda os mutantes boot, reduzido e toque e exige que cada um reprove
//   OUT=<dir> grava screenshots/relatório (padrão /tmp/treta-video-hover)
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {chromium} from 'playwright';
import {TRETA_SKINS,TRETA_DEFAULT_REWARDS} from '../../public/js/treta-catalog.js';

const base=process.env.BASE;
if(!base){console.error('passe BASE=http://localhost:<porta> explícito');process.exit(2);}
const MUTANTS={
  boot:['return {tap:()=>{','start();return {tap:()=>{'],
  reduzido:["if(matchMedia('(prefers-reduced-motion: reduce)').matches)return false;",''],
  toque:["if(lastPointer!=='touch' || tapped)return false;",'return false;'],
};
if(process.argv.includes('--mutations')){
  for(const [id,expect] of [['boot','V1'],['reduzido','V4'],['toque','V5']]){
    const r=spawnSync(process.execPath,[new URL(import.meta.url).pathname,`--mutante=${id}`],{encoding:'utf8',env:{...process.env,OUT:`/tmp/treta-video-hover-mut-${id}`}});
    assert(r.status!==0 && (r.stderr+r.stdout).includes(expect),`mutante ${id} não reprovou em ${expect}\n${(r.stderr+r.stdout).slice(-600)}`);
    console.log(`mutante ${id}: reprovou em ${expect}`);
  }
  console.log('PASS: 3/3 mutações do vídeo de hover detectadas');process.exit(0);
}
const mutant=process.argv.find(a=>a.startsWith('--mutante='))?.split('=')[1];
const out=process.env.OUT || '/tmp/treta-video-hover';
mkdirSync(out,{recursive:true});
const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser=await chromium.launch({...(existsSync(chrome)?{executablePath:chrome}:{}),args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
const manifest=JSON.parse(readFileSync('public/models/skins/manifest.json','utf8'));
const approved=TRETA_SKINS.filter(s=>manifest.skins[s.id]?.approved===true);
const report={base,mutant:mutant || null,boot:{},checks:[]};
const check=(id,ok,detail)=>{report.checks.push({id,ok,detail});if(!ok)throw new Error(`${id} REPROVOU: ${detail}`);console.log(`${id} ok · ${detail}`);};
const state={authenticated:true,acquisition:'quests',topUpsEnabled:false,accountId:'fixture-account',wallet:{balance:1600,referral_code:'00000000-0000-4000-8000-000000000001'},inventory:[],ledger:[],quests:{email:1,referral:2,singleplayer:3,multiplayer:4,dailyMatchEarned:70},campaign:{...TRETA_DEFAULT_REWARDS,starts_at:new Date(Date.now()-86400000).toISOString(),ends_at:new Date(Date.now()+86400000).toISOString()},catalog:TRETA_SKINS.map(s=>({id:s.id,character_id:s.character,price:800,available:true,model_path:manifest.skins[s.id]?.model}))};

async function openStore(name,{viewport,touch=false,reduced=false}) {
  const context=await browser.newContext({viewport,isMobile:touch,hasTouch:touch,reducedMotion:reduced?'reduce':'no-preference'});
  const page=await context.newPage();
  const requests=[];
  page.on('request',r=>requests.push({url:new URL(r.url()).pathname,type:r.resourceType(),t:Date.now()}));
  /* /.astro/eval-vite/deps/* é módulo da barra de dev do Astro, que o serve.mjs não repassa
     (404 também na main). Não é código do jogo; qualquer outro erro de página reprova. */
  page.on('pageerror',e=>{if(!/\/\.astro\/eval-vite\//.test(e.message))report.checks.push({id:'pageerror',ok:false,detail:`${name}: ${e.message.slice(0,160)}`});});
  await page.addInitScript(()=>{localStorage.setItem('awpbr_settings',JSON.stringify({menuMusic:false,vol:0,speech:false}));localStorage.setItem('cs_lang','pt');localStorage.setItem('awpbr_nick','TESTE UI');localStorage.setItem('cs_treta_intro','v1');});
  if(mutant)await page.route('**/js/treta-store.js*',async r=>{
    const original=readFileSync('public/js/treta-store.js','utf8'),[from,to]=MUTANTS[mutant];
    const source=original.replace(from,to);if(source===original)throw new Error('MUTANTE NÃO APLICOU');
    await r.fulfill({contentType:'text/javascript',body:source});
  });
  await page.route('**/api/**',route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/treta')return route.fulfill({json:state});
    if(path==='/api/social-auth')return route.fulfill({json:{authenticated:true,accountId:'fixture-account',profile:{nick:'TESTE UI',id:'fixture-profile'},providers:[],email:false}});
    return route.fulfill({json:{profile:{avatar_url:'/img/chars/barbudo.webp',socials:['fixture']},rooms:[],entries:[],online:0}});
  });
  page.setDefaultTimeout(20000);
  await page.goto(`${base}/?nav=1&secao=jogar`,{waitUntil:'commit',timeout:30000});
  await page.locator('#splash-enter:not(.hidden)').waitFor({timeout:90000});
  await page.locator('#boot-splash').click();
  await page.locator('#hub-ui:not([hidden])').waitFor({timeout:90000});
  await page.locator('button[data-hub-tab="loja"]').click();
  await page.locator('#hub-shop:not([hidden])').waitFor();
  await page.waitForFunction(n=>document.querySelectorAll('#treta-grid .treta-card').length===n,approved.length,{timeout:20000});
  await page.waitForFunction(()=>[...document.querySelectorAll('.treta-card img')].every(i=>i.complete && i.naturalWidth>0));
  await page.waitForTimeout(1500);
  return {context,page,requests};
}
const videoReq=requests=>requests.filter(r=>r.url.startsWith('/video/') || r.type==='media');
const shot=(page,key)=>page.screenshot({path:resolve(out,`${key}.png`)});
const playing=(page,i)=>page.waitForFunction(i=>{const v=document.querySelectorAll('.treta-card')[i]?.querySelector('video');return v && !v.paused && v.readyState>=2 && v.currentTime>0.2;},i,{timeout:20000}).then(()=>true,()=>false);

let failed=null;
try {
  {
    const {context,page,requests}=await openStore('desktop',{viewport:{width:1536,height:1024}});
    const boot=videoReq(requests);
    report.boot={requests:requests.length,images:requests.filter(r=>r.type==='image').length,media:boot.length,videoUrls:boot.map(r=>r.url)};
    check('V1',boot.length===0 && await page.locator('#hub-shop video').count()===0,`boot com loja aberta: ${requests.length} requests, ${boot.length} de vídeo, ${await page.locator('#hub-shop video').count()} <video>`);
    await shot(page,'desktop-loja');
    const card=page.locator('.treta-card').nth(1),id=approved[1].id;
    await card.scrollIntoViewIfNeeded();await card.hover();
    const ok=await playing(page,1);
    const attrs=await card.locator('video').evaluate(v=>({preload:v.getAttribute('preload') ?? v.preload,muted:v.muted,loop:v.loop,poster:new URL(v.poster).pathname,src:new URL(v.currentSrc).pathname}));
    check('V2',ok && attrs.preload==='none' && attrs.muted && attrs.loop && attrs.src.startsWith(`/video/skins/${id}.`) && attrs.poster===`/video/skins/${id}.webp`,`hover em ${id}: ${JSON.stringify(attrs)}`);
    await page.waitForTimeout(600);await shot(page,'desktop-hover');
    await page.mouse.move(5,5);await page.waitForTimeout(400);
    check('V2b',await card.locator('video').evaluate(v=>v.paused),'saiu do card: vídeo pausado');
    await page.locator('#treta-how').focus();
    let focused=-1;for(let k=0;k<40 && focused<0;k++){await page.keyboard.press('Tab');focused=await page.evaluate(()=>[...document.querySelectorAll('.treta-card')].indexOf(document.activeElement));}
    check('V3',focused>=0 && await playing(page,focused),`Tab chegou ao card ${focused} e o vídeo tocou`);
    await shot(page,'desktop-foco-teclado');
    await context.close();
  }
  {
    const {context,page,requests}=await openStore('reduzido',{viewport:{width:1536,height:1024},reduced:true});
    await page.locator('.treta-card').nth(0).hover();await page.waitForTimeout(1500);
    await page.locator('#treta-how').focus();await page.keyboard.press('Tab');await page.waitForTimeout(800);
    check('V4',videoReq(requests).length===0 && await page.locator('#hub-shop video').count()===0,`reduced-motion: ${videoReq(requests).length} requests de vídeo, ${await page.locator('#hub-shop video').count()} <video>`);
    await shot(page,'desktop-reduced-motion-hover');
    await context.close();
  }
  {
    const {context,page,requests}=await openStore('mobile',{viewport:{width:390,height:844},touch:true});
    check('V1m',videoReq(requests).length===0,`boot mobile: ${requests.length} requests, ${videoReq(requests).length} de vídeo`);
    await shot(page,'mobile-loja');
    const card=page.locator('.treta-card').first();await card.scrollIntoViewIfNeeded();
    await card.tap();
    const ok=await playing(page,0),detail=await page.locator('#treta-detail[open]').count();
    await page.waitForTimeout(400);await shot(page,'mobile-primeiro-toque');
    check('V5',ok && detail===0,`primeiro toque: vídeo tocando=${ok}, detalhe aberto=${detail}`);
    await card.tap();await page.locator('#treta-detail[open]').waitFor({timeout:8000}).catch(()=>{});
    check('V5b',await page.locator('#treta-detail[open]').count()===1,'segundo toque abre o detalhe');
    await context.close();
  }
  const errors=report.checks.filter(c=>c.id==='pageerror');
  check('V0',errors.length===0,`erros de página: ${errors.length} ${errors.map(e=>e.detail).join(' | ')}`);
} catch(e){failed=e;}
finally {writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));await browser.close();}
if(failed){console.error(failed.message);process.exit(1);}
console.log(`PASS: vídeo de hover (V0-V5) · boot ${report.boot.requests} requests, 0 de vídeo · ${out}`);
