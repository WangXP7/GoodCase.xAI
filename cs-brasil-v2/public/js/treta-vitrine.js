// Vitrine SKINS NOVAS na aba JOGAR: as skins à venda da loja, com arte e vídeo de hover.
// Carrega por import dinâmico depois do estado da loja; sem loja no ar, fica escondida.
import {tretaVitrine,skinPreview,abrirTretaSkin,equiparTretaSkin} from './treta-store.js';
import {estadoDaUrl} from './rotas.js';

const $=id=>document.getElementById(id);
const node=(tag,text='',cls='')=>{const e=document.createElement(tag);e.textContent=text;e.className=cls;return e;};
const money=value=>`T$ ${new Intl.NumberFormat('pt-BR').format(value)}`;
const SKIN=/^[a-z0-9-]{1,64}$/;
let assinatura='',pendente=null,deepLink=true;

function semSkinNaUrl() {
  const url=new URL(location.href);
  if(!url.searchParams.has('skin'))return;
  url.searchParams.delete('skin');history.replaceState(history.state,'',url);
}
/* Clique leva à loja (/loja, ADR 0008) com o detalhe da skin; ?skin= marca a skin aberta. */
function abrirNaLoja(id) {
  document.querySelector('.hub-tabs [data-hub-tab="loja"]')?.click();
  const url=new URL(location.href);url.searchParams.set('skin',id);history.replaceState(history.state,'',url);
  abrirTretaSkin(id);
}
function seguirDeepLink() {
  if(!deepLink || $('boot-splash'))return;
  const id=new URL(location.href).searchParams.get('skin'),lista=tretaVitrine();
  if(!lista || estadoDaUrl(location.href)?.secao!=='loja' || !SKIN.test(id || ''))return;
  deepLink=false;
  if(lista.some(s=>s.id===id))abrirTretaSkin(id);else semSkinNaUrl();
}
async function equipar(id,botao,aviso) {
  botao.disabled=true;botao.textContent='EQUIPANDO…';
  try{if(!await equiparTretaSkin(id))throw new Error('equip');}
  catch{aviso.textContent='Não deu para equipar agora. Tente pela loja.';botao.disabled=false;botao.textContent='EQUIPAR';}
}
function card(s,aviso) {
  const item=node('li','','treta-vitrine-card');item.style.setProperty('--skin-color',s.color);item.dataset.skin=s.id;
  if(s.equipped)item.dataset.equipada='';
  const abrir=node('button','','treta-vitrine-abrir');abrir.type='button';
  const img=node('img');img.src=s.poster;img.alt=`Skin ${s.name}`;img.loading='lazy';img.decoding='async';img.width=72;img.height=72;
  const texto=node('span','','treta-vitrine-texto');texto.append(node('small',s.series),node('strong',s.name));
  texto.append(s.owned?node('i'):node('b',money(s.price)));   // <i>: lugar do EQUIPAR/EQUIPADA
  abrir.append(img,texto);abrir.setAttribute('aria-label',`${s.name}, ${s.owned?'no seu armário':money(s.price)}. Ver na loja`);
  const preview=skinPreview(abrir,s.id);
  abrir.onclick=()=>{if(preview.tap())return;abrirNaLoja(s.id);};
  item.append(abrir);
  if(s.equipped)item.append(node('span','EQUIPADA','treta-vitrine-equipada'));
  else if(s.owned){const b=node('button','EQUIPAR','treta-vitrine-equipar');b.type='button';b.onclick=()=>void equipar(s.id,b,aviso);item.append(b);}
  return item;
}
function fimDaLista() {
  const l=$('treta-vitrine-lista');
  l.toggleAttribute('data-fim',l.scrollLeft+l.clientWidth>=l.scrollWidth-4);
}
function desenhar() {
  const host=$('treta-vitrine');
  if(!host)return;
  const lista=tretaVitrine();
  seguirDeepLink();
  if(!lista?.length){host.hidden=true;assinatura='';return;}
  if($('boot-splash'))return;   // nada de imagem competindo com o boot
  const nova=JSON.stringify(lista);
  if(nova===assinatura && !host.hidden)return;
  assinatura=nova;
  const aviso=$('treta-vitrine-aviso');aviso.textContent='';
  $('treta-vitrine-lista').replaceChildren(...lista.map(s=>card(s,aviso)));
  /* Celular: só o título cabe abaixo do JOGAR; três rostos mostram que tem skin ali. */
  $('treta-vitrine-teaser').replaceChildren(...lista.slice(0,3).map(s=>{const i=node('span');i.style.backgroundImage=`url("${s.poster}")`;return i;}));
  host.hidden=false;fimDaLista();
}

export function iniciarVitrine() {
  const host=$('treta-vitrine');
  if(!host || host.dataset.pronta)return;
  host.dataset.pronta='1';
  $('treta-vitrine-loja').onclick=()=>document.querySelector('.hub-tabs [data-hub-tab="loja"]')?.click();
  $('treta-vitrine-teaser').onclick=()=>host.scrollIntoView({block:'end',behavior:'smooth'});
  $('treta-vitrine-lista').addEventListener('scroll',fimDaLista,{passive:true});
  document.addEventListener('cs-treta-state',desenhar);
  document.addEventListener('cs-shop-open',seguirDeepLink);
  $('treta-detail')?.addEventListener('close',()=>{if(estadoDaUrl(location.href)?.secao==='loja')semSkinNaUrl();});
  if($('boot-splash')){
    pendente=new MutationObserver(()=>{if(!$('boot-splash')){pendente.disconnect();pendente=null;desenhar();}});
    pendente.observe(document.body,{childList:true,subtree:true});
  }
  desenhar();
}
