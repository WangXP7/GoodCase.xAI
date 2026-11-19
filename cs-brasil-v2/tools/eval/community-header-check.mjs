// Pedido do dono em 14/10/2026: a Comunidade abre com "Olá, @handle" (ou "Olá" para visitante),
// sem o cartão "SUA CONTA / SALVE" duplicando o perfil, e com abas de verdade: role=tab,
// aria-selected, setas/Home/End, sublinhado em vez de botão quadrado com borda.
// Roda o community.js real num DOM falso; a aparência fica com as capturas do PR.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const root=new URL('../../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
const mutant=process.argv.find(arg=>arg.startsWith('--mutante='))?.slice(10);
let community=read('public/js/community.js'),markup=read('src/components/Community.astro'),css=read('public/social.css');
const mutation=(source,before,after)=>{assert(source.includes(before),'MUTANTE NÃO APLICOU: trecho ausente');return source.replace(before,after);};
const mutants={
  'sem-handle':()=>{community=mutation(community,"`Olá, ${handle?'@'+handle:p.nick}`","`Olá, ${p.nick}`");},
  'painel-duplicado':()=>{community=mutation(community,'if(panel)panel.hidden=!!p;','if(panel)panel.hidden=false;');},
  'aria-current':()=>{community=mutation(community,"b.setAttribute('aria-selected',String(on));","b.setAttribute('aria-current',String(on));");},
  'sem-teclado':()=>{community=mutation(community,"const next={ArrowRight:i+1,ArrowLeft:i-1,Home:0,End:list.length-1}[event.key];","const next=undefined;");},
  'titulo-antigo':()=>{markup=mutation(markup,'<h2 id="social-hello">Olá</h2>','<h2 id="social-hello">SEU CORO, SUA TURMA.</h2>');},
  'aba-quadrada':()=>{css=mutation(css,'.community .social-tabs button[aria-selected=true]{color:#f0f0ed}','.community .social-tabs button[aria-selected=true]{color:#11140a;background:#b4d92e;border:1px solid #b4d92e}');},
};
if(mutant){assert(mutants[mutant],'mutante desconhecido: '+mutant);mutants[mutant]();}

class Node {
  constructor(tag,attrs={}){this.tagName=tag.toUpperCase();this.children=[];this.parent=null;this.dataset={};this.attrs={...attrs};this._text='';this.hidden=false;this.disabled=false;this.listeners={};this.id=attrs.id||'';}
  get textContent(){return this._text+this.children.map(c=>typeof c==='string'?c:c.textContent).join('');}
  set textContent(v){this._text=String(v??'');this.children=[];}
  set innerHTML(v){throw new Error('HTML cru no DOM: '+String(v).slice(0,60));}
  append(...n){for(const c of n){if(c && typeof c==='object')c.parent=this;this.children.push(c);}}
  replaceChildren(...n){this.children=[];this._text='';this.append(...n);}
  setAttribute(k,v){this.attrs[k]=String(v);} getAttribute(k){return this.attrs[k]??null;}
  addEventListener(t,fn){(this.listeners[t]??=[]).push(fn);}
  closest(sel){let n=this;while(n){if(n.tagName===sel.toUpperCase())return n;n=n.parent;}return null;}
  querySelector(){return null;}
  focus(){focused=this;}
  click(){return this.onclick?.();}
  reportValidity(){return true;}
}
let focused=null;
const all=n=>[n,...n.children.filter(c=>typeof c==='object').flatMap(all)];
const attrsOf=s=>Object.fromEntries([...s.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
async function page({auth,state}) {
  const ids={};for(const id of ['community','social-status','social-account','social-content','social-unread','hub-social-unread'])ids[id]=new Node('div',{id});
  const hello=markup.match(/<h2 id="social-hello">([^<]*)<\/h2>/);ids['social-hello']=new Node('h2',{id:'social-hello'});ids['social-hello'].textContent=hello?.[1]??'';
  const logoutTag=markup.match(/<button id="social-logout"[^>]*>/)?.[0];if(logoutTag){ids['social-logout']=new Node('button',attrsOf(logoutTag));ids['social-logout'].hidden=/\shidden[\s>]/.test(logoutTag);}
  const panel=new Node('details');panel.append(ids['social-account']);
  const list=new Node('div',attrsOf(markup.match(/<div class="social-tabs"[^>]*>/)?.[0]||''));
  const tabs=[...markup.matchAll(/<button\b([^>]*data-tab="[^"]+"[^>]*)>/g)].map(m=>{const a=attrsOf(m[1]);const b=new Node('button',a);b.dataset.tab=a['data-tab'];list.append(b);return b;});
  ids.community.dataset={tab:'profile',profile:'',site:'https://fixture.test'};
  const calls=[];
  const fetch=async(path,opts={})=>{const body=opts.body?JSON.parse(opts.body):null;calls.push({path,body});const action=body?.action||new URL(path,'https://fixture.test').searchParams.get('action');
    const data=action==='profile'?{profile:state?.profile}:action==='inbox'?{conversations:[],unread_count:0}:action==='presence'?{ok:true}:state||{};return {ok:true,json:async()=>JSON.parse(JSON.stringify(data))};};
  const document={getElementById:id=>ids[id]||null,createElement:t=>new Node(t),createTextNode:t=>t,querySelectorAll:s=>s==='.social-tabs button'?tabs:[],querySelector:s=>s==='.social-tabs'?list:null,addEventListener(){},get activeElement(){return focused;},hidden:false};
  const ctx=vm.createContext({document,console,URL,URLSearchParams,Date,AbortSignal:{timeout:()=>null},setInterval:()=>1,setTimeout,location:{origin:'https://fixture.test',href:'https://fixture.test/',search:'',assign(){}},navigator:{clipboard:{writeText:async()=>{}}},fetch,
    mountAccountEntry:c=>c.append(Object.assign(new Node('p'),{textContent:'ENTRAR NA CONTA'})),mountAccountIntegrations(){},mountProfilePreferences:async()=>{},loadAccount:async()=>auth,loadAuthOptions:async()=>({providers:[]}),acceptAccount(){},logoutAccount:async()=>{calls.push({path:'logout'});},
    rankingTable:()=>new Node('table'),careerRankBadge:()=>null,careerRankTitle:()=>'',questList:()=>[],accountVerifiedBadge:()=>null,profileCharacterCard:()=>null});
  vm.runInContext(community.replace(/^import[^\n]*\n/gm,''),ctx,{timeout:1000});
  for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));
  return {ids,panel,tabs,list,calls,selected:()=>tabs.filter(t=>t.getAttribute('aria-selected')==='true').map(t=>t.dataset.tab),key:async(target,key)=>{let prevented=false;target.onkeydown?.({key,target,preventDefault(){prevented=true;}});for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r));return prevented;}};
}
const me={id:'p1',nick:'TesteDominio'};
const signedIn={authenticated:true,profile:me,identities:['google']};
const fullState={profile:{...me,handle:'rubenmarcus',url:'/u/rubenmarcus',bio:'',level:1,next_level_points:1,points:0,position:1,matches:0,kills:0,deaths:0,kd:0,play_seconds:0,socials:[],achievements:[],favorites:[],history:[],visibility:'public',settings:{}},friends:[],notifications:[],invites:[],feed:[],blocks:[]};
const tests=[
  ['logado: Olá, @handle no topo e sem o cartão SUA CONTA duplicado',async()=>{
    const ui=await page({auth:signedIn,state:fullState});
    assert.equal(ui.ids['social-hello'].textContent,'Olá, @rubenmarcus','título sem @handle');
    assert.equal(ui.panel.hidden,true,'cartão SUA CONTA continua duplicando o perfil');
    assert.doesNotMatch(ui.ids['social-account'].textContent,/Salve,/,'saudação antiga renderizada');
    assert.equal(ui.ids['social-logout'].hidden,false,'sair da conta sumiu');await ui.ids['social-logout'].onclick();assert(ui.calls.some(c=>c.path==='logout'),'sair da conta não sai');
    const noHandle=await page({auth:signedIn,state:{...fullState,profile:{...fullState.profile,handle:null}}});assert.equal(noHandle.ids['social-hello'].textContent,'Olá, TesteDominio');
  }],
  ['visitante: Olá e a entrada de conta continua disponível',async()=>{
    const ui=await page({auth:{authenticated:false},state:null});
    assert.equal(ui.ids['social-hello'].textContent,'Olá');assert.equal(ui.panel.hidden,false,'visitante perdeu a entrada');assert.equal(ui.ids['social-logout'].hidden,true);
    assert.match(ui.ids['social-account'].textContent,/ENTRAR NA CONTA/);
    assert.doesNotMatch(markup,/SEU CORO, SUA TURMA/,'título antigo no markup');
  }],
  ['abas são tablist com aria-selected e um tabindex por vez',async()=>{
    assert.equal(attrsOf(markup.match(/<div class="social-tabs"[^>]*>/)?.[0]||'').role,'tablist','abas sem role=tablist');
    assert.match(markup,/id="social-content"[^>]*role="tabpanel"/,'conteúdo sem role=tabpanel');
    const ui=await page({auth:signedIn,state:fullState});
    assert.equal(ui.tabs.length,6);for(const t of ui.tabs){assert.equal(t.getAttribute('role'),'tab');assert.equal(t.getAttribute('aria-controls'),'social-content');assert(t.id,'aba sem id');}
    assert.deepEqual(ui.selected(),['profile'],'aba ativa não marcada com aria-selected');
    assert.deepEqual(ui.tabs.map(t=>t.getAttribute('tabindex')),['0','-1','-1','-1','-1','-1'],'tabindex não acompanha a aba ativa');
    assert.equal(ui.ids['social-content'].getAttribute('aria-labelledby'),'social-tab-profile');
    assert.equal(ui.tabs.some(t=>t.getAttribute('aria-current')!==null),false,'aria-current sobrando nas abas');
  }],
  ['setas, Home e End trocam de aba pelo teclado',async()=>{
    const ui=await page({auth:signedIn,state:fullState});
    assert.equal(await ui.key(ui.tabs[0],'ArrowRight'),true,'seta não tratada');assert.deepEqual(ui.selected(),['friends']);assert.equal(focused,ui.tabs[1],'foco não acompanhou a seta');
    await ui.key(ui.tabs[1],'End');assert.deepEqual(ui.selected(),['settings']);
    await ui.key(ui.tabs[5],'ArrowRight');assert.deepEqual(ui.selected(),['profile'],'seta não dá a volta');
    await ui.key(ui.tabs[0],'ArrowLeft');assert.deepEqual(ui.selected(),['settings']);
    await ui.key(ui.tabs[5],'Home');assert.deepEqual(ui.selected(),['profile']);
    assert.equal(await ui.key(ui.tabs[0],'a'),false,'tecla comum foi engolida');
  }],
  ['aba ativa é sublinhado, não botão chapado com borda',()=>{
    const rule=sel=>{const i=css.indexOf(sel+'{');assert(i>=0,'regra ausente: '+sel);return css.slice(i,css.indexOf('}',i));};
    const base=rule('.community .social-tabs button');assert.match(base,/border:0/);assert.match(base,/background:none/);assert.match(base,/box-shadow:none/);
    assert.doesNotMatch(rule('.community .social-tabs button[aria-selected=true]'),/background|border/,'aba ativa voltou a ser bloco');
    assert.match(rule('.community .social-tabs button[aria-selected=true]::after'),/scaleX\(1\)/,'aba ativa sem sublinhado');
    assert.match(css,/\.community \.social-tabs button::after\{[^}]*height:3px;background:#b4d92e/,'sublinhado sem a cor da casa');
  }],
];
let passed=0;
for(const [name,run] of tests){try{await run();passed++;console.log('PASS '+name);}catch(e){console.log('RED '+name+': '+e.message.split('\n')[0]);}}
console.log(`community header: ${passed}/${tests.length}; mutante=${mutant||'nenhum'}`);
if(passed!==tests.length)process.exitCode=1;
