/* Treta Pop · Ajustes (#settings-panel). Carregado por tp/ligar.js só com ?ui=v3. */
import { tr, translateDom } from '../i18n.js';
import { mountProfilePreferences } from '../account-entry.js';

const ABAS = [
  ['mira', 'MIRA'],
  ['acessibilidade', 'ACESSIBILIDADE'],
  ['privacidade', 'PRIVACIDADE'],
];
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

function salvo() {
  try { return JSON.parse(localStorage.getItem('awpbr_settings') || '{}'); } catch { return {}; }
}

function aplicarMovimento(valor) {
  if (valor === 'reduzido') document.documentElement.dataset.motion = 'reduzido';
  else delete document.documentElement.dataset.motion;
}

function linhaToggle(id, rotulo, secao) {
  const linha = el('label', 'set-row set-extra tp-aj-linha');
  linha.dataset.section = secao;
  linha.append(tr(rotulo));
  const t = el('span', 'set-toggle');
  const input = el('input'); input.type = 'checkbox'; input.id = id;
  t.append(input, el('b', '', tr('LIGADO')), el('i', '', tr('DESLIGADO')));
  linha.append(t);
  return { linha, input };
}

function trocarAba(painel, aba) {
  painel.dataset.activeTab = aba;
  for (const t of painel.querySelectorAll('.set-tab')) {
    const on = t.dataset.tab === aba;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', String(on));
  }
  if (aba === 'privacidade') montarPrivacidade(painel);
}

function montarPrivacidade(painel) {
  const caixa = painel.querySelector('.tp-aj-privacidade');
  if (!caixa || caixa.childElementCount) return;
  /* o bloco vem do account-entry.js sem tr(): traduz depois de montar, e de novo quando a conta responde */
  const pronto = mountProfilePreferences(caixa);
  translateDom(caixa);
  pronto.then(() => translateDom(caixa), () => {});
}

export function ligar() {
  const painel = document.getElementById('settings-panel');
  const abas = painel?.querySelector('.set-tabs');
  const listaLinhas = painel?.querySelector('.set-list');
  if (!painel || !abas || !listaLinhas || painel.querySelector('.tp-aj-linha')) return;
  painel.classList.add('tp-aj');

  for (const [id, rot] of ABAS) {
    const b = el('button', 'set-tab', tr(rot));
    b.type = 'button'; b.dataset.tab = id;
    b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', 'false');
    b.addEventListener('click', () => trocarAba(painel, id));
    abas.append(b);
  }

  /* as linhas existentes mudam de aba só na v3: os ids e o wiring do main.js continuam */
  const xhair = document.getElementById('set-xhair')?.closest('.set-row');
  if (xhair) xhair.dataset.section = 'mira';
  const treino = document.getElementById('set-training')?.closest('.set-row');
  if (treino) treino.dataset.section = 'privacidade';
  const previa = painel.querySelector('.set-preview');
  if (previa) {
    const mira = el('div', 'tp-mira-previa');
    mira.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 4; i++) mira.append(el('i'));
    mira.append(el('b'));
    previa.append(mira);
  }

  const { linha, input } = linhaToggle('tp-set-motion', 'REDUZIR ANIMAÇÕES', 'acessibilidade');
  const nota = el('p', 'set-note tp-aj-nota');
  nota.dataset.section = 'acessibilidade';
  const sistema = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const atual = salvo().motion === 'reduzido';
  aplicarMovimento(atual ? 'reduzido' : '');
  input.checked = sistema || atual;
  input.disabled = sistema;
  nota.textContent = tr(sistema
    ? 'Seu sistema já pede menos movimento: as telas trocam só com esmaecimento.'
    : 'Troca deslizamentos e zooms das telas por um esmaecimento curto.');
  input.onchange = () => {
    const valor = input.checked ? 'reduzido' : '';
    aplicarMovimento(valor);
    document.dispatchEvent(new CustomEvent('tp-ajuste', { detail: { chave: 'motion', valor } }));
  };

  const priv = el('div', 'set-row tp-aj-privacidade');
  priv.dataset.section = 'privacidade';
  listaLinhas.append(linha, nota, priv);
  if (treino) listaLinhas.insertBefore(treino, priv);
  if (painel.dataset.activeTab === 'privacidade') montarPrivacidade(painel);
}
