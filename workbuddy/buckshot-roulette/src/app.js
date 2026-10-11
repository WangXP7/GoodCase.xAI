import { Roulette, ITEMS, chooseAction, shellName, other } from './engine.js';
import { World } from './scene.js';
import { Sound } from './audio.js';

const $ = id => document.getElementById(id);
const show = (id, visible = true) => $(id).classList.toggle('hidden', !visible);
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const KEY = 'buckshot.local.v1.';
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(KEY + key)) ?? fallback; } catch { return fallback; } };
const write = (key, value) => { try { localStorage.setItem(KEY + key, JSON.stringify(value)); } catch { /* Private mode may disable local storage. */ } };
const defaults = { volume:55, brightness:110, quality:'medium', speed:1, grain:true, motion:!matchMedia('(prefers-reduced-motion: reduce)').matches };
const settings = { ...defaults, ...read('settings', {}) };
settings.volume=Math.min(100,Math.max(0,Number(settings.volume)||0));
settings.brightness=Math.min(155,Math.max(70,Number(settings.brightness)||110));
settings.speed=[1,1.6,2.3].includes(Number(settings.speed))?Number(settings.speed):1;
const sound = new Sound(); sound.setVolume(settings.volume / 100);
let world, game=null, inGame=false, busy=false, paused=false, aiming=false, stealIndex=null, epoch=0, driving=false, modalClose=null,pendingMode='story',entering=false;
let toastTimer, subtitleTimer, lastHover, activeModal=null, lastFocused=null;

const paths = {
  glass:'<circle cx="19" cy="17" r="10"/><path d="m12 25-9 12M14 25l-3-3M15 12c3-3 6-3 9-1"/>',
  beer:'<path d="M11 6q9-4 18 0v29q-9 5-18 0Z"/><ellipse cx="20" cy="6" rx="9" ry="3"/><path d="M11 13h18M11 29h18m-12-12h6m-6 5h6"/>',
  cuffs:'<circle cx="10" cy="22" r="8"/><circle cx="31" cy="16" r="8"/><path d="m17 21 7-3M7 14l5-1m16-5 5-1"/>',
  saw:'<path d="m3 24 23-13 4 7-23 12-1-4-3 1Zm25-13 6-3 5 8-6 4Z"/><path d="m7 24 2 3m3-6 2 3m3-5 2 2m3-4 1 1"/>',
  cigarettes:'<path d="M6 12h23v24H6zM6 19h23M10 23h15M11 27h13m22-3V11m0-3c4-3-3-4 0-7"/><path d="M33 24h5v13h-5z"/>',
  phone:'<rect x="10" y="6" width="20" height="32" rx="2"/><path d="M13 2v4M14 11h12v8H14zm0 13h2m3 0h2m3 0h2m-12 5h2m3 0h2m3 0h2m-12 5h2m3 0h2m3 0h2"/>',
  inverter:'<path d="M7 12h26v23H7zM13 8v4m14-4v4M13 20h6m-3-3v6m7-3h6M4 8l-2 6 4 3m30 14 3-6-4-3"/>',
  adrenaline:'<path d="m10 9 6-6m-3 3 6 6m-8 6 10-10 13 13-10 10zm-2-2 18 18M12 31l-8 8M23 13l-4 4m8 0-4 4m8 0-4 4"/>',
  medicine:'<path d="M11 10h18l3 6v20q-12 5-24 0V16ZM11 4h18v6H11zM8 18h24M8 32h24m-12-11v8m-4-4h8"/>',
};
const icon = id => `<svg viewBox="0 0 42 42" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[id] || ''}</svg>`;
const isVersus = () => game?.state?.mode === 'versus';
const actorName = who => who === 'player' ? (isVersus() ? '玩家 1' : '你') : (isVersus() ? '玩家 2' : '庄家');
const currentActor = () => isVersus() ? game.state.turn : 'player';
const opponentOf = who => other(who);
const money = cash => '$ ' + Number(cash).toLocaleString('en-US');

function toast(text) { clearTimeout(toastTimer);$('toast').textContent=text;show('toast');toastTimer=setTimeout(()=>show('toast',false),3000); }
function subtitle(html='', seconds=0) { clearTimeout(subtitleTimer);$('subtitle').innerHTML=html;if(seconds)subtitleTimer=setTimeout(()=>$('subtitle').innerHTML='',seconds*1000); }
function save() {
  if (!game?.state) return;
  try {
    if (['dead','victory'].includes(game.state.phase)) localStorage.removeItem(KEY+'save');
    else localStorage.setItem(KEY+'save', game.serialize());
  } catch { /* Gameplay remains available without storage. */ }
}
function hasSave() { try { const raw=localStorage.getItem(KEY+'save');return raw && Roulette.restore(raw); } catch { return null; } }
function setPaused(value) { paused=value;world.paused=value;world.interactive=inGame&&!busy&&!paused&&game?.state.phase==='turn'&&(isVersus()||game.state.turn==='player'); if(value)sound.suspend();else if(inGame)sound.resume(); }
async function wait(ms, token=epoch) {
  let remaining=ms/settings.speed,last=performance.now();
  while(remaining>0){
    await new Promise(r=>setTimeout(r,32));
    if(token!==epoch)throw new Error('CANCELLED');
    const now=performance.now();if(!paused)remaining-=now-last;last=now;
  }
  if(token!==epoch)throw new Error('CANCELLED');
}
async function gate(token=epoch) { while(paused){await new Promise(r=>setTimeout(r,40));if(token!==epoch)throw new Error('CANCELLED');} }

function openModal(html, kind, { closable=true, paper=false, close=null }={}) {
  lastFocused=document.activeElement;activeModal=kind;
  $('modal-content').innerHTML=html;$('modal-panel').classList.toggle('signature-paper',paper);
  $('modal-close').classList.toggle('hidden',!closable);show('modal');
  modalClose=closable ? (close || (()=>{hideModal();setPaused(false);})) : null;
  if(inGame)setPaused(true);
  requestAnimationFrame(()=>{const focus=$('modal-content').querySelector('input,button,select,a');focus?.focus({preventScroll:true});});
}
function hideModal() {show('modal',false);activeModal=null;modalClose=null;lastFocused?.focus?.({preventScroll:true});}
function closeModal() {if(modalClose)modalClose();}
$('modal-close').onclick=closeModal;
$('modal').addEventListener('click',e=>{if(e.target===$('modal'))closeModal();});

function menu() {
  epoch++;driving=false;busy=false;inGame=false;paused=false;aiming=false;stealIndex=null;
  hideModal();show('intro',false);entering=false;show('hud',false);show('memory',false);show('menu');show('load-panel',false);show('continue',!!hasSave());subtitle();
  world.hideShells();world.setMode('menu');world.sync({player:{hp:2,max:2,items:['glass','beer','cuffs','cigarettes']},dealer:{hp:2,max:2,items:['saw','beer','glass','cigarettes']},name:'YOU',round:1,saw:false,mode:'story'});
  sound.resume();
}

async function sign(mode) {
  pendingMode=mode;await sound.start();sound.play('door');show('menu',false);world.setMode('intro');show('intro');
}
async function enterTable(){
  if(entering||$('intro').classList.contains('hidden'))return;entering=true;
  const mode=pendingMode;show('intro',false);world.interactive=false;sound.play('door');world.setMode('game');
  const token=++epoch;
  await wait(650,token);
  const terms=mode==='versus'?'两位玩家轮流握枪，三轮后决出胜者。':mode==='story'?'对局共分三轮。清空庄家的电荷，带走奖金。':'每赢下三轮，可选择带走奖金，或继续加倍。';
  openModal(`<div class="contract-number">No. 008 — VOLUNTARY PARTICIPATION</div><div class="eyebrow">GENERAL RELEASE OF LIABILITY</div><h2 id="modal-title">自愿参与声明</h2><p>本人自愿坐上这张赌桌，并接受以下条件：</p><p>一、${terms}<br>二、霰弹枪中同时装有实弹与空包弹。<br>三、命运一旦装膛，概不退换。</p><label for="signature">${mode==='versus'?'为玩家 1 输入名字':'请在下方签名'}</label><input id="signature" maxlength="12" autocomplete="off" spellcheck="false" aria-label="你的名字" value="${escape(read('name','YOU'))}"><div class="stamp">APPROVED</div><button id="sit-down" class="outline-button">签字，坐上赌桌　→</button>`, 'signature', {paper:true,close:menu});
  entering=false;$('signature').select();
  const begin=()=>{const name=$('signature').value.trim()||'YOU';write('name',name);hideModal();start(mode,name);};
  $('sit-down').onclick=begin;
  $('signature').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();begin();}});
}

async function start(mode, name) {
  epoch++;driving=false;inGame=true;busy=false;paused=false;aiming=false;stealIndex=null;
  game=new Roulette();show('menu',false);show('hud');world.setMode('game');
  await sound.start();
  await perform(game.start(mode,name));
}
async function resumeGame() {
  const saved=hasSave();if(!saved){toast('没有可恢复的对局。');show('continue',false);return;}
  epoch++;driving=false;game=saved;inGame=true;busy=false;paused=false;aiming=false;stealIndex=null;
  show('menu',false);show('hud');world.setMode('game');await sound.start();render();
  const s=game.state;
  if(s.phase==='loading')showLoad({live:s.load.live,blank:s.load.blank,count:0});
  else if(s.phase!=='turn')showEnd();
  else if(s.turn==='dealer'&&!isVersus())driveDealer();
}

function render() {
  if(!game||!inGame)return;
  const s=game.state,v=game.view('player');world.sync(v);
  const active=s.phase==='turn'&&(isVersus()||s.turn==='player')&&!busy&&!paused;
  world.interactive=active;
  $('mode-label').textContent=s.mode==='versus'?'LOCAL VERSUS':s.mode==='story'?'THE LAST TABLE':`DOUBLE OR NOTHING · ${String(s.cycle).padStart(2,'0')}`;
  $('round-number').textContent=String(s.round).padStart(2,'0');
  $('round-label').textContent=s.mode==='versus'?['第一轮 · 玩家 1 对 玩家 2','第二轮 · 筹码加倍','第三轮 · 直面天命'][s.round-1]:s.mode==='story'?['第一轮 · 试探','第二轮 · 筹码','第三轮 · 生死'][s.round-1]:s.cash?`桌上奖金 ${money(s.cash)}`:'活过三轮，再做选择';
  $('status').textContent=s.phase==='loading'?'正在装弹':s.phase!=='turn'?'本轮结束':stealIndex!==null?'选择道具':isVersus()?`${actorName(s.turn)}的回合`:s.turn==='player'?'你的回合':'庄家的回合';
  $('status').classList.toggle('versus-turn',isVersus());$('hud').classList.toggle('duo-mode',isVersus());
  $('dealer-items-label').textContent=isVersus()?'玩家 2 的道具':'庄家的道具';$('dealer-items').setAttribute('aria-label',isVersus()?'玩家 2 的道具':'庄家的道具');
  $('inventory-count').textContent=`${s.player.items.length} / 8`;
  const playerActive=active&&s.turn==='player';
  $('inventory').innerHTML=s.player.items.length?s.player.items.map((id,index)=>`<button class="item-button" data-item="${index}" aria-label="使用${ITEMS[id].name}：${ITEMS[id].description}" title="${ITEMS[id].name}：${ITEMS[id].description}" ${!playerActive||aiming||stealIndex!==null?'disabled':''}><kbd>${index+1}</kbd>${icon(id)}<span>${ITEMS[id].name}</span></button>`).join(''):`<span class="inventory-empty">${s.mode==='story'&&s.round===1?'道具将从第二轮开始发放':'桌上暂时没有道具'}</span>`;
  const dealerActive=active&&s.turn==='dealer';
  $('dealer-items').innerHTML=s.dealer.items.map((id,index)=>`<button class="dealer-item ${stealIndex!==null&&id!=='adrenaline'&&!game.canUse('player',id)?'stealable':''}" data-dealer-item="${index}" aria-label="${isVersus()?'玩家 2':'庄家'}的${ITEMS[id].name}" title="${isVersus()?'玩家 2':'庄家'} · ${ITEMS[id].name}：${ITEMS[id].description}" ${(!dealerActive&&stealIndex===null)?'disabled':''}>${icon(id)}</button>`).join('');
  $('inventory-label').firstChild.textContent=isVersus()?'玩家 1 的道具 ':'你的道具 ';
  $('inventory').querySelectorAll('[data-item]').forEach(b=>{b.onclick=()=>useItemFor('player',Number(b.dataset.item));b.onmouseenter=()=>hover(`item:player:${b.dataset.item}`);b.onmouseleave=()=>hover(null);});
  $('dealer-items').querySelectorAll('button').forEach(b=>{b.onclick=()=>dealerItem(Number(b.dataset.dealerItem));b.onmouseenter=()=>hover(`item:dealer:${b.dataset.dealerItem}`);b.onmouseleave=()=>hover(null);});
  show('action-area',active);show('gun-prompt',!aiming);show('target-choices',aiming);show('crosshair',active);
  $('prompt-main').textContent=stealIndex!==null?'选择庄家的一件道具':'点击霰弹枪';
  $('prompt-sub').textContent=stealIndex!==null?'点击桌面对面的道具，或右上角的道具图标':isVersus()?`轮到${actorName(s.turn)}，道具与枪都由当前玩家操作`:'也可以先使用桌上的道具';
  $('grab-button').textContent=stealIndex!==null?'取消偷取　ESC':'拿起霰弹枪　SPACE';
  $('shoot-dealer').querySelector('span').textContent=isVersus()?(s.turn==='player'?'射击玩家 2':'射击玩家 1'):'射击庄家';
  $('shoot-dealer').querySelector('small').textContent=isVersus()?'实弹造成伤害，空包弹交出回合':'实弹造成伤害，空包弹也交出回合';
  const chargeLine=who=>{const p=s[who];return `<span class="health-line"><span>${actorName(who)}${p.cut?' · 断线':''}</span><span>${Array.from({length:p.max},(_,i)=>`<span class="${i<p.hp?'charge':'dead-charge'}">ϟ</span>`).join('')}</span></span>`;};
  $('health-summary').innerHTML=chargeLine('player')+(isVersus()?chargeLine('dealer'):'');
  $('chamber-summary').textContent=`CHAMBER · ${String(v.remaining).padStart(2,'0')}${s.saw?'　／　2× DAMAGE':''}${s.player.cuffed?'　／　已被束缚':''}`;
  $('view-controls').querySelectorAll('button').forEach(b=>b.disabled=busy||paused);
  updateMemory();save();
}

function hover(id) {
  if(!inGame||paused||busy){show('hover-tip',false);return;}
  if(id===lastHover)return;lastHover=id;
  if(!id){show('hover-tip',false);return;}
  let main='',sub='';
  if(id==='gun'){main=aiming?'选择目标':'12 GA. 霰弹枪';sub=game.state.saw?'枪管已锯短 · 下一枪伤害加倍':'点击拿起 · 命运已在枪膛里';}
  else if(id==='dealer'){main=aiming?(isVersus()?'射击玩家 2':'射击庄家'):(isVersus()?'玩家 2':'庄家');sub=aiming?'点击开枪':game.state.dealer.cut?'除颤器已断线':`剩余 ${game.state.dealer.hp} 格电荷`;}
  else if(id.startsWith('item:')){
    const[,who,num]=id.split(':'),item=game.state[who].items[+num];if(!item)return;
    main=(who==='dealer'?(isVersus()?'玩家 2 的':'庄家的'):isVersus()?'玩家 1 的':'')+ITEMS[item].name;sub=ITEMS[item].description;
    if(stealIndex!==null&&who==='dealer')sub=item==='adrenaline'?'不能偷取肾上腺素':game.canUse('player',item)||'点击偷取并立即使用';
  }
  $('hover-tip').innerHTML=`${escape(main)}<small>${escape(sub)}</small>`;show('hover-tip',!!main);
}
function pick(id) {
  if(id==='door'&&!$('intro').classList.contains('hidden')){enterTable();return;}
  if(!canAct())return;
  if(id==='gun')grab();
  else if(id==='dealer'&&aiming)shootOpponent();
  else if(id.startsWith('item:')){const[,who,index]=id.split(':');if(who==='player')useItem(+index);else dealerItem(+index);}
}
function canAct() {return inGame&&!busy&&!paused&&game?.state.phase==='turn'&&(isVersus()||game.state.turn==='player');}
function grab() {
  if(!canAct())return;
  if(stealIndex!==null){stealIndex=null;render();return;}
  aiming=!aiming;sound.play('rack');if(aiming)world.grabGun();else world.releaseGun();render();
}
async function shoot(target) {
  if(!canAct()||!aiming)return;
  aiming=false;stealIndex=null;show('hover-tip',false);lastHover=null;
  await perform(game.shoot(currentActor(),target));
}
function shootOpponent(){const who=currentActor();return shoot(opponentOf(who));}
function shootSelf(){return shoot(currentActor());}
async function useItem(index){return useItemFor('player',index);}
async function useItemFor(who,index) {
  if(!canAct()||aiming||stealIndex!==null||currentActor()!==who)return;
  const id=game.state[who].items[index];if(!id)return;
  const reason=game.canUse(who,id);if(reason){toast(reason);return;}
  if(id==='adrenaline'){stealIndex=index;sound.play('click');render();return;}
  await perform(game.use(who,index));
}
async function dealerItem(index) {
  if(!canAct())return;
  const id=game.state.dealer.items[index];if(!id)return;
  if(isVersus()&&currentActor()==='dealer'){await useItemFor('dealer',index);return;}
  if(stealIndex===null){toast(`庄家的${ITEMS[id].name} · 需要肾上腺素才能偷取。`);return;}
  if(id==='adrenaline'){toast('肾上腺素不能偷取另一支肾上腺素。');return;}
  const reason=game.canUse('player',id);if(reason){toast(reason);return;}
  const ownIndex=stealIndex;stealIndex=null;
  await perform(game.use('player',ownIndex,index));
}

async function perform(events) {
  const token=epoch;busy=true;world.interactive=false;show('action-area',false);show('hover-tip',false);lastHover=null;
  document.querySelectorAll('#inventory button,#dealer-items button,#view-controls button').forEach(b=>b.disabled=true);
  try {
    for(const e of events){
      if(token!==epoch)return;await gate(token);
      switch(e.type){
        case 'round':
          subtitle(e.round===1?'“欢迎来到赌桌。”':e.round===2?'“这一次，桌上的东西也属于你。”':'“最后一轮。不要指望第二次机会。”');
          world.sync(game.view('player'));await wait(1400,token);break;
        case 'revive':
          sound.play('revive');flash(false,'revive');subtitle('除颤器再次启动。<br><strong>你还可以再来一次。</strong>');await wait(1900,token);break;
        case 'load':
          world.sync(game.view('player'));sound.play('rack');await wait(400,token);showLoad(e);break;
        case 'steal':
          subtitle(`${actorName(e.who)}拿起了肾上腺素。`);
          await world.useItem({...e,transfer:true},()=>{sound.play('adrenaline');subtitle(`${actorName(e.who)}偷取了${actorName(other(e.who))}的<strong>${ITEMS[e.id].name}</strong>。`);});
          break;
        case 'item':
          subtitle(`${actorName(e.who)}拿起了${ITEMS[e.id].name}。`);
          await world.useItem(e,()=>{sound.play(e.id);itemMessage(e);});
          if(token!==epoch)return;world.sync(game.view('player'));await wait(350,token);break;
        case 'shot': {
          show('load-panel',false);world.hideShells();subtitle(e.who==='dealer'?`${actorName(e.who)}将枪口指向${e.target==='dealer'?'自己':actorName(e.target)}。`:isVersus()?`${actorName(e.who)}举起了霰弹枪。`:'');
          const fire=await world.shot(e.who,e.target,e.live,settings.speed);
          if(token!==epoch)return;await gate(token);fire();sound.play(e.live?'live':'blank');
          if(e.live)flash(e.target==='player');
          subtitle(e.live?`<span class="red">实弹。</span> ${actorName(e.target)}失去 ${e.damage} 格电荷。`:`<span class="blue">空包弹。</span>${e.target===e.who?'这一回合继续。':'没有人受伤。'}`);
          world.updateMonitor(game.view('player'));await wait(600,token);
          sound.play('rack');await world.settle(settings.speed);if(token!==epoch)return;break;
        }
        case 'retain': subtitle(`${actorName(e.who)}对自己打出了空包弹。<br><strong>${isVersus()?`仍然是${actorName(e.who)}的回合。`:e.who==='player'?'仍然是你的回合。':'庄家继续行动。'}</strong>`);await wait(600,token);break;
        case 'skip': sound.play('cuffs');subtitle(`${actorName(e.who)}被手铐束缚，跳过一次行动。`);await wait(1200,token);break;
        case 'cut': sound.play('cut');world.sync(game.view('player'));subtitle(`${actorName(e.who)}的除颤器已被切断。<br><span class="red">下一发实弹将是致命的。</span>`);await wait(1700,token);break;
        case 'turn':
          if(e.who==='dealer')subtitle(isVersus()?'轮到玩家 2。':'庄家在思考。');
          else subtitle(isVersus()?'轮到玩家 1。':'轮到你了。',2);
          break;
        case 'end':
          world.sync(game.view('player'));sound.play(e.winner==='player'?'win':'death');await wait(1700,token);showEnd();break;
      }
    }
  } catch(error) {if(error.message!=='CANCELLED'){console.error(error);toast('操作未完成，请暂停后继续。');}}
  finally {if(token===epoch){busy=false;render();if(game?.state.phase==='turn'&&(isVersus()||game.state.turn==='player'))setTimeout(()=>{if(token===epoch&&!busy&&!paused)subtitle();},1800);}}
  if(token===epoch&&game.state.phase==='turn'&&game.state.turn==='dealer'&&!isVersus())driveDealer();
}

function itemMessage(e) {
  const who=actorName(e.who),self=e.who==='player';
  const header=`${who}使用了${ITEMS[e.id].name}。`;
  switch(e.id){
    case 'glass': subtitle(self||isVersus()?`${header}<br>当前一发是<span class="${e.live?'red':'blue'}">${shellName(e.live)}</span>。`:`${who}透过放大镜看了一眼枪膛。`);break;
    case 'beer': subtitle(`${header}<br>退出一发<span class="${e.live?'red':'blue'}">${shellName(e.live)}</span>。`);break;
    case 'cuffs': subtitle(`${who}给${self?(isVersus()?'玩家 2':'庄家'):(isVersus()?'玩家 1':'你')}戴上了手铐。`);break;
    case 'saw': subtitle(`${who}锯短了枪管。<br><strong>下一枪：双倍伤害。</strong>`);break;
    case 'cigarettes': subtitle(`${header}<br>${e.heal?`恢复 ${e.heal} 格电荷。`:'没有恢复电荷。'}`);break;
    case 'phone': subtitle(self?(e.index===null?'电话那头没有回应。<br>枪里只剩最后一发。':`电话里传来一个声音。<br><strong>从现在算起，第 ${e.index+1} 发是${shellName(e.live)}。</strong>`):`${who}接起了电话。<br>你听不清另一头的声音。`);break;
    case 'inverter': subtitle(`${who}翻转了当前子弹的类型。`);break;
    case 'medicine': subtitle(`${header}<br>${e.heal>0?`恢复 ${e.heal} 格电荷。`:e.heal<0?'<span class="red">失去 1 格电荷。</span>':'没有恢复电荷。'}`);break;
  }
}

function showLoad(e) {
  subtitle();aiming=false;world.releaseGun();world.showShells(e.live,e.blank);
  $('load-live').textContent=e.live;$('load-blank').textContent=e.blank;
  $('load-title').textContent=e.count?`双方各获得 ${e.count} 件道具。`:'记住这些子弹。';
  $('load-confirm').disabled=false;show('load-panel');show('action-area',false);show('memory',false);
  $('load-confirm').focus({preventScroll:true});
}
async function confirmLoad() {
  if(!inGame||busy||paused||game.state.phase!=='loading')return;
  $('load-confirm').disabled=true;show('load-panel',false);world.hideShells();sound.play('load');
  await perform(game.acknowledgeLoad());
}

async function driveDealer() {
  if(driving||!inGame)return;driving=true;const token=epoch;
  try {
    while(token===epoch&&inGame&&game.state.phase==='turn'&&game.state.turn==='dealer'){
      await wait(1600,token);await gate(token);
      const action=chooseAction(game.view('dealer'),'dealer',()=>game.random());
      const events=action.type==='item'?game.use('dealer',action.index,action.stolenIndex):game.shoot('dealer',action.target);
      await perform(events);
    }
  }catch(error){if(error.message!=='CANCELLED'){console.error(error);toast('庄家行动出现问题。可从主菜单继续存档。');}}
  finally{if(token===epoch)driving=false;}
}

function flash(player, kind='shot') {
  if(!settings.motion)return;
  const el=$('flash');el.style.background=kind==='revive'?'#d2dcc3':player?'#a02818':'#fff1c7';
  el.animate([{opacity:kind==='revive'?.75:player?.62:.38},{opacity:0}],{duration:kind==='revive'?600:player?580:180,easing:'ease-out'});
}

function showEnd() {
  const s=game.state;show('action-area',false);subtitle();show('memory',false);
  const phase=s.phase,stats=s.stats;
  let title,eyebrow,description,actions;
  if(phase==='roundOver'){
    title=isVersus()?`${actorName(s.winner)}赢下这一轮。`:'这一轮，你赢了。';eyebrow=`ROUND ${String(s.round).padStart(2,'0')} COMPLETE`;
    description=isVersus()?(s.round===1?'下一轮，道具将被摆上桌面。':'最后一轮即将开始，直面天命。'):s.round===1?'庄家重新睁开了眼。下一轮，道具将被摆上桌面。':'最后一轮即将开始。四格普通电荷耗尽后，除颤器会被切断。';
    actions='<button id="next-round" class="outline-button">进入下一轮　→</button>';
  }else if(phase==='revive'){
    title='还没到结束的时候。';eyebrow='DEFIBRILLATOR ONLINE';description='你在冰冷的地板上醒来。前两轮可以重新挑战当前轮次。';
    actions='<button id="next-round" class="outline-button">回到赌桌　→</button>';
  }else if(phase==='dead'){
    title='YOU ARE DEAD';eyebrow='NO SIGNAL';description=s.mode==='endless'?'你把一切留在了那张桌上。所有未取走的奖金归零。':'电线已经断开。这一次，没有人会把你叫醒。';
    actions='<button id="try-again" class="outline-button">再来一次　↗</button><button id="end-menu" class="text-button">返回主菜单</button>';
  }else if(phase==='offer'){
    title='双倍，或归零。';eyebrow=`THREE ROUNDS SURVIVED · ${String(s.cycle).padStart(2,'0')}`;description=`现在可以带走 ${money(s.cash)}。或者，把它押上赌桌，再赢三轮后取走 ${money(s.cash*2)}。`;
    actions='<button id="cash-out" class="outline-button">带走奖金　→</button><button id="double-down" class="outline-button">继续加倍　ϟ</button>';
  }else{
    title=isVersus()?`${actorName(s.winner)}直面了天命。`:'YOU WALKED AWAY';eyebrow=isVersus()?'THREE ROUNDS COMPLETE':'THE HOUSE HAS PAID';description=isVersus()?`${actorName(s.winner)}赢下了三轮对局。`: '清晨的空气很冷。你拿着手提箱，活着走了出来。';
    actions=isVersus()?'<button id="try-again" class="outline-button">再来一局　↗</button><button id="end-menu" class="text-button">返回主菜单</button>':'<button id="end-menu" class="outline-button">返回主菜单　→</button><button id="play-endless" class="text-button">挑战双倍或归零　↗</button>';
    const best=read('best',0);if(s.cash>best)write('best',s.cash);
  }
  const amount=['offer','victory'].includes(phase)?`<div class="amount">${money(s.cash)}</div>`:'';
  openModal(`<div class="end-panel"><div class="eyebrow">${eyebrow}</div><h2 id="modal-title">${title}</h2>${amount}<p>${description}</p><div class="end-stats"><span><strong>${stats.shots}</strong>次射击</span><span><strong>${stats.items}</strong>件道具</span><span><strong>${stats.rounds}</strong>轮胜利</span></div><div class="modal-actions">${actions}</div></div>`, 'end', {closable:false});
  if($('next-round'))$('next-round').onclick=async()=>{hideModal();setPaused(false);await perform(game.advance());};
  if($('double-down'))$('double-down').onclick=async()=>{hideModal();setPaused(false);await perform(game.double());};
  if($('cash-out'))$('cash-out').onclick=()=>{hideModal();setPaused(false);game.cashOut();showEnd();save();};
  if($('try-again'))$('try-again').onclick=()=>{hideModal();setPaused(false);start(s.mode,s.name);};
  if($('play-endless'))$('play-endless').onclick=()=>{hideModal();setPaused(false);start('endless',s.name);};
  if($('end-menu'))$('end-menu').onclick=()=>{save();menu();};
  save();
}

function updateMemory() {
  if(!game)return;const s=game.state,v=game.view('player');
  $('memory-initial').textContent=`初始装弹：${s.load.live} 发实弹 ／ ${s.load.blank} 发空包弹`;
  $('memory-shells').innerHTML=s.history.map(x=>`<span class="shell-icon used ${x.live?'':'blank'}" title="${x.kind==='beer'?'退出':'射出'}的${shellName(x.live)}"></span>`).join('')+v.knowledge.map((x,i)=>`<span class="shell-icon ${x===null?'unknown':x?'':'blank'}" title="第 ${i+1} 发：${x===null?'未知':shellName(x)}">${x===null?'?':''}</span>`).join('');
  const notes=v.knowledge.flatMap((x,i)=>x===null?[]:[`第 ${i+1} 发：${shellName(x)}`]);
  $('memory-knowledge').textContent=notes.length?notes.join('　／　'):'尚无确定的后续子弹信息。';
}
function toggleMemory() {if(inGame&&!activeModal){updateMemory();show('memory',$('memory').classList.contains('hidden'));sound.play('click');}}

function showRules(fromPause=false) {
  const versusText=isVersus()?'同屏双人：玩家 1 与玩家 2 轮流操作，双方都能看到枪中实弹与空包弹，但只能操作自己的回合。':'你与庄家轮流握枪。谁先耗尽对方的电荷，谁就赢下这一轮。';
  openModal(`<div class="eyebrow">READ BEFORE PULLING THE TRIGGER</div><h2 id="modal-title">赌桌规则</h2><p class="lead">${versusText}</p><div class="rules"><div class="rule"><b>01　看清装弹数量</b><p>红色是实弹，灰蓝色是空包弹。装弹时公布数量，顺序随机；之后不会重新洗牌。</p></div><div class="rule"><b>02　决定枪口的方向</b><p>射向对方后交出回合。对自己打出空包弹可以继续；对自己打出实弹会受伤并交出回合。</p></div><div class="rule"><b>03　让道具改变局面</b><p>使用道具不消耗回合，可连续使用。每次装弹，双方得到相同数量的随机道具，最多保留八件。</p></div><div class="rule"><b>04　三轮走出俱乐部</b><p>第一轮两格电荷，第二轮四格，前两轮失败可重试。第三轮六格，剩两格时断线，再中实弹立即出局。</p></div></div><div class="eyebrow">THE TOOLS OF THE TRADE</div><div class="item-guide">${Object.entries(ITEMS).map(([id,item])=>`<div class="guide-row">${icon(id)}<div><b>${item.name}${!['glass','beer','cuffs','saw','cigarettes'].includes(id)?' · 加倍模式':''}</b><small>${item.description}</small></div></div>`).join('')}</div><p>双倍或归零：每赢三轮可以取款，或押上奖金继续挑战；中途失败会失去全部未取奖金。随机电荷与九种道具从第一轮开始生效。</p><div class="help-footer"><kbd>SPACE</kbd> 拿枪 / 放下　 <kbd>W</kbd> 射击对手　 <kbd>S</kbd> 射击自己　 <kbd>1–8</kbd> 使用道具<br><kbd>TAB</kbd> 记弹　 <kbd>H</kbd> 规则　 <kbd>ESC</kbd> 暂停　 <kbd>F</kbd> 全屏</div>`, 'rules',{close:()=>{hideModal();if(fromPause)showPause();else {setPaused(false);render();}}});
}
function showSettings(fromPause=false) {
  openModal(`<div class="eyebrow">ADJUST THE ROOM</div><h2 id="modal-title">选项</h2><div class="settings-row"><label for="volume">主音量<small>枪声、机械声与地下俱乐部环境音</small></label><div class="setting-control"><input id="volume" type="range" min="0" max="100" value="${settings.volume}"><output id="volume-value">${settings.volume}%</output></div></div><div class="settings-row"><label for="brightness">亮度<small>调到可以分辨桌面与庄家的脸</small></label><div class="setting-control"><input id="brightness" type="range" min="70" max="155" value="${settings.brightness}"><output id="brightness-value">${settings.brightness}%</output></div></div><div class="settings-row"><label for="quality">画面分辨率<small>低像素渲染保留原作的粗粝质感</small></label><select id="quality"><option value="low">粗像素 · 性能优先</option><option value="medium">复古 · 推荐</option><option value="high">清晰 · 高分辨率</option></select></div><div class="settings-row"><label for="speed">动画速度<small>不影响子弹随机性与庄家决策</small></label><select id="speed"><option value="1">原速 · 沉浸</option><option value="1.6">1.6 倍 · 较快</option><option value="2.3">2.3 倍 · 快速</option></select></div><div class="settings-row"><label for="grain">胶片颗粒<small>噪点、扫描线与暗角</small></label><input id="grain" type="checkbox" ${settings.grain?'checked':''}></div><div class="settings-row"><label for="motion">镜头动态与闪光<small>关闭后禁用视角摇晃与屏幕闪光</small></label><input id="motion" type="checkbox" ${settings.motion?'checked':''}></div><div class="modal-actions"><button id="fullscreen" class="text-button">切换全屏　↗</button><button id="settings-done" class="outline-button">完成</button></div>`, 'settings', {close:()=>{hideModal();if(fromPause)showPause();else{setPaused(false);render();}}});
  $('quality').value=settings.quality;$('speed').value=String(settings.speed);
  for(const id of['volume','brightness','quality','speed','grain','motion']) $(id).addEventListener('input',()=>{
    settings[id]=['grain','motion'].includes(id)?$(id).checked:['volume','brightness','speed'].includes(id)?Number($(id).value):$(id).value;
    if($(id+'-value'))$(id+'-value').textContent=settings[id]+'%';
    sound.setVolume(settings.volume/100);world.resize();write('settings',settings);
  });
  $('fullscreen').onclick=fullScreen;$('settings-done').onclick=closeModal;
}
function showPause() {
  if(!inGame||activeModal==='end')return;
  save();openModal(`<div class="eyebrow">THE HOUSE CAN WAIT</div><h2 id="modal-title">暂停</h2><p>对局已自动保存。庄家会等你回来。</p><div class="pause-menu"><button id="unpause">继续对局 <span>ESC</span></button><button id="pause-settings">选项 <span>↗</span></button><button id="pause-rules">游戏规则 <span>↗</span></button><button id="save-menu">保存并返回主菜单 <span>←</span></button></div>`, 'pause',{close:()=>{hideModal();setPaused(false);render();}});
  $('unpause').onclick=closeModal;$('pause-settings').onclick=()=>showSettings(true);$('pause-rules').onclick=()=>showRules(true);$('save-menu').onclick=()=>{save();menu();};
}
function credits() {
  openModal(`<div class="eyebrow">YIQIGAME-TIWISTUDIO PRESENTS</div><h2 id="modal-title">YiQiGAME-TiWiStudio</h2><div class="credits-copy"><p class="studio-credit">恶魔轮盘——直面天命！是一款由 YiQiGAME-TiWiStudio 制作的独立浏览器复刻。</p><p>本项目以 Mike Klubnika 的《Buckshot Roulette》为玩法与视觉参考，现已支持单人三轮对局、双倍或归零，以及同屏双人模式。</p><p>这里的 3D 场景、模型、程序纹理、动画与合成音效均重新制作。它是独立的非官方复刻，不是 Steam 原版，也未接入 Steam 多人联机或成就。</p><p>原作：<a href="https://store.steampowered.com/app/2835570/BuckshotRoulette/" target="_blank" rel="noopener">Buckshot Roulette · Mike Klubnika / CRITICAL REFLEX</a></p><p>参考调查：</p><ul><li><a href="https://github.com/1503Dev/OpenBuckshotRoulette" target="_blank" rel="noopener">OpenBuckshotRoulette</a>：研究其项目说明与素材授权范围，未复制原作内容。</li><li><a href="https://github.com/AadishY/BugShot-Roulette" target="_blank" rel="noopener">BugShot-Roulette</a>：参考浏览器实现方向，未复用其代码或媒体。</li><li><a href="https://threejs.org/" target="_blank" rel="noopener">Three.js r180</a>：MIT 许可，已随附许可证并完整打包供离线运行。</li></ul><small>本地玩法与在线 Pages 版本共用同一套规则与视觉。</small><p>本地最高取款：${money(read('best',0))}</p></div>`, 'credits');
}
async function fullScreen() {try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{toast('当前窗口不支持全屏，请最大化窗口。');}}

$('start').onclick=()=>sign('story');$('endless').onclick=()=>sign('endless');$('versus').onclick=()=>sign('versus');$('continue').onclick=resumeGame;$('leave-bathroom').onclick=enterTable;$('intro-back').onclick=menu;
$('how').onclick=()=>showRules();$('settings').onclick=()=>showSettings();$('credits').onclick=credits;
$('help-button').onclick=()=>showRules();$('pause-button').onclick=showPause;$('memory-button').onclick=toggleMemory;$('close-memory').onclick=()=>show('memory',false);
$('grab-button').onclick=grab;$('put-down').onclick=grab;$('shoot-dealer').onclick=shootOpponent;$('shoot-self').onclick=shootSelf;$('load-confirm').onclick=confirmLoad;
$('view-controls').querySelectorAll('button').forEach(b=>b.onclick=()=>world.setView(b.dataset.view));
document.addEventListener('pointerover',e=>{if(e.target.closest('button')&&!e.target.closest('button').disabled)sound.play('hover');});
document.addEventListener('keydown',e=>{
  if(e.target.matches('input,select,textarea'))return;
  if(e.key==='Tab'&&activeModal){
    const focusables=[...$('modal-panel').querySelectorAll('button:not(.hidden):not(:disabled),input,select,a')];
    const first=focusables[0],last=focusables.at(-1);
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}return;
  }
  if(e.repeat)return;
  if(e.key==='Escape'){
    e.preventDefault();
    if(activeModal)closeModal();else if(!$('intro').classList.contains('hidden'))menu();else if(stealIndex!==null){stealIndex=null;render();}else if(aiming)grab();else if(!$('memory').classList.contains('hidden'))show('memory',false);else showPause();return;
  }
  if(activeModal)return;
  if(e.key.toLowerCase()==='e'&&!$('intro').classList.contains('hidden')){e.preventDefault();enterTable();return;}
  if(e.key.toLowerCase()==='f'){e.preventDefault();fullScreen();return;}
  if(!inGame)return;
  if(e.key==='Tab'){e.preventDefault();toggleMemory();}
  else if(e.key.toLowerCase()==='h'){e.preventDefault();showRules();}
  else if(e.key==='Enter'&&game.state.phase==='loading'){e.preventDefault();confirmLoad();}
  else if(e.code==='Space'){e.preventDefault();grab();}
  else if(e.key.toLowerCase()==='a')world.setView('left');
  else if(e.key.toLowerCase()==='d')world.setView('right');
  else if(e.key==='0')world.setView('table');
  else if(e.key.toLowerCase()==='w')shootOpponent();
  else if(e.key.toLowerCase()==='s')shootSelf();
  else if(/^[1-8]$/.test(e.key))useItemFor(currentActor(),Number(e.key)-1);
});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&inGame&&!activeModal){save();showPause();}});
window.addEventListener('beforeunload',save);
window.addEventListener('error',e=>{console.error('Game error:',e.message);});

try {
  world=new World($('world'),{onPick:pick,onHover:hover,settings});
  window.setTimeout(()=>{show('boot',false);menu();},550);
} catch(error) {
  console.error(error);$('boot').innerHTML='<div class="boot-symbol">ϟ</div><p>3D 画面未能启动</p><small>请启用浏览器的硬件加速，或使用 Edge / Chrome 重新打开。</small>';
}

// Development harness is explicitly opt-in and absent from ordinary play.
if(new URLSearchParams(location.search).has('test')) {
  window.__gameTest={
    get game(){return game;},get world(){return world;},get settings(){return settings;},
    get ui(){return {inGame,busy,paused,aiming,stealIndex,activeModal,driving};},
    start:async(mode='endless',seed=42)=>{await sound.start();epoch++;game=new Roulette(seed);inGame=true;busy=false;paused=false;aiming=false;show('menu',false);show('hud');hideModal();world.setMode('game');const events=game.start(mode,'TEST');render();showLoad(events.find(x=>x.type==='load'));},
    render,showEnd,confirmLoad,perform,
    restore:raw=>{epoch++;driving=false;game=Roulette.restore(raw);inGame=true;busy=false;paused=false;aiming=false;stealIndex=null;hideModal();show('menu',false);show('hud');show('load-panel',false);world.hideShells();world.setMode('game');render();},
  };
}
