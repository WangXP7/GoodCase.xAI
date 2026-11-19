/* ============================================================================
   personagem-escolhido-check.mjs — O PERSONAGEM ESCOLHIDO VALE EM TODA PARTIDA
   ----------------------------------------------------------------------------
   POR QUE EXISTE
   Relato do dono (13/10): o jogo atribuía personagem sozinho e ignorava a
   escolha. Medido com nó local: o pedido no MP lia só o localStorage (quem
   chegou por `?personagem=` ficava com o corpo do bot), personagem fora do lado
   era descartado calado, e o SP depois da sala usava o corpo emprestado.
   Regra: docs/adr/0007-personagem-escolhido.md.

   O QUE ESTA RÉGUA PROVA
     PE1 tabela de `decidirPersonagemMp` (net.js): pede quando joga no lado,
         avisa com o outro lado quando não joga, avisa quando o nó não aceita,
         não faz nada no espectador, nada a fazer quando já é ele
     PE2 o pedido do MP (main.js) usa `personagemEscolhido()` e a decisão pura,
         e não lê o localStorage direto
     PE3 o ramo `avisar-lado` mostra aviso COM oferta (ir para o outro lado)
     PE4 a guarda da entrada no MP leva personagem e lado, e a devolução repõe
     PE5 a tecla M no MP atualiza a escolha guardada (a escolha do jogador
         continua sendo dele depois da sala)
     PE6 os botões da oferta moram dentro de `.pause-actions`: o resto do menu de
         pausa é FUNDO para o game.js (`_pauseBackdrop`) e o clique não chega

   Uso: node tools/eval/personagem-escolhido-check.mjs
        [--mutante=troca-calada|le-storage|sem-oferta|sem-devolver-personagem|m-esquece|botao-no-fundo]
   ============================================================================ */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MUTANTES = ['troca-calada', 'le-storage', 'sem-oferta', 'sem-devolver-personagem', 'm-esquece', 'botao-no-fundo'];
const mutante = (process.argv.find((a) => a.startsWith('--mutante=')) || '').split('=')[1] || '';
if (mutante && !MUTANTES.includes(mutante)) throw new Error(`mutante desconhecido: ${mutante}`);

let netSrc = readFileSync(path.join(ROOT, 'public/js/net.js'), 'utf8');
let main = readFileSync(path.join(ROOT, 'public/js/main.js'), 'utf8');
let astro = readFileSync(path.join(ROOT, 'src/pages/index.astro'), 'utf8');
if (mutante === 'troca-calada') netSrc = netSrc.replace("return { acao: 'avisar-lado', outroLado: lado === 'E' ? 'B' : 'E' };", "return { acao: 'nada' };");
if (mutante === 'le-storage') main = main.replace('const escolhido = personagemEscolhido();', "const escolhido = CHARACTERS.find((c) => c.id === localStorage.getItem('csbr-home-character'));");
if (mutante === 'sem-oferta') main = main.replace(/(mpAvisoPersonagem\(`\$\{escolhido\.name\} não joga na[^`]*`), \{[\s\S]*?\n    \}\);/, '$1);');
if (mutante === 'sem-devolver-personagem') main = main.replace('currentChar = e.char; currentTeam = e.team;', '');
if (mutante === 'm-esquece') main = main.replace('if (escolhaSpAntesDoMp) escolhaSpAntesDoMp.char = selChar.id;', '');
if (mutante === 'botao-no-fundo') astro = astro.replace(/(<div class="pause-actions panel">)\s*(<div id="mp-personagem-acoes"[\s\S]*?<\/div>)/, '$2\n  $1');

const falhas = [];
const cobra = (ok, msg) => { if (!ok) falhas.push(msg); };

// PE1: a decisão pura, carregada do fonte (com o mutante aplicado) como módulo.
const fonteDecisao = /export function decidirPersonagemMp[\s\S]*?\n\}/.exec(netSrc)?.[0];
cobra(!!fonteDecisao, 'PE1 decidirPersonagemMp não encontrada em net.js');
if (fonteDecisao) {
  const { decidirPersonagemMp } = await import(`data:text/javascript,${encodeURIComponent(fonteDecisao)}`);
  const so = (lados) => ({ id: `p${lados.join('')}`, lados });
  const pode = (def, lado) => def.lados.includes(lado);
  const caso = (args) => decidirPersonagemMp({ atual: 'outro', espectador: false, aceita: true, podeNoLado: pode, ...args });
  const tabela = [
    ['joga no lado: pede', caso({ escolhido: so(['E']), lado: 'E' }), { acao: 'pedir', id: 'pE' }],
    ['dois lados: pede', caso({ escolhido: so(['E', 'B']), lado: 'B' }), { acao: 'pedir', id: 'pEB' }],
    ['fora do lado: avisa com a ESQUERDA', caso({ escolhido: so(['E']), lado: 'B' }), { acao: 'avisar-lado', outroLado: 'E' }],
    ['fora do lado: avisa com a DIREITA', caso({ escolhido: so(['B']), lado: 'E' }), { acao: 'avisar-lado', outroLado: 'B' }],
    ['nó sem recurso: avisa', caso({ escolhido: so(['E']), lado: 'E', aceita: false }), { acao: 'avisar-servidor' }],
    ['já é ele: ok', caso({ escolhido: so(['E']), lado: 'E', atual: 'pE' }), { acao: 'ok' }],
    ['espectador: nada', caso({ escolhido: so(['E']), lado: 'E', espectador: true }), { acao: 'nada' }],
    ['sem lado: nada', caso({ escolhido: so(['E']), lado: null }), { acao: 'nada' }],
  ];
  for (const [nome, got, want] of tabela) cobra(JSON.stringify(got) === JSON.stringify(want), `PE1 ${nome}: esperava ${JSON.stringify(want)}, veio ${JSON.stringify(got)}`);
}

// Corpo de função declarada, por contagem de chaves.
function corpo(src, nome) {
  const m = new RegExp(`function ${nome}\\s*\\(`).exec(src);
  if (!m) return '';
  let i = src.indexOf('{', m.index), prof = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') prof++;
    else if (src[j] === '}' && --prof === 0) return src.slice(i, j + 1);
  }
  return '';
}

const pedir = corpo(main, 'mpPedirPersonagemPreferido');
cobra(/personagemEscolhido\(\)/.test(pedir) && /decidirPersonagemMp\(/.test(pedir), 'PE2 o pedido do MP não usa personagemEscolhido() + decidirPersonagemMp');
cobra(!/localStorage/.test(pedir), 'PE2 o pedido do MP lê o localStorage direto: o link ?personagem= fica de fora');
cobra(/avisar-lado[\s\S]*mpAvisoPersonagem\([^;]*,\s*\{[\s\S]*pedirTime\(d\.outroLado\)/.test(pedir), 'PE3 personagem fora do lado sem aviso com oferta de ir para o outro lado');

const guardar = corpo(main, 'mpGuardarEscolhaSp'), devolver = corpo(main, 'mpDevolverEscolhaSp');
cobra(/char:\s*currentChar/.test(guardar) && /team:\s*currentTeam/.test(guardar), 'PE4 a guarda da entrada no MP não leva personagem e lado');
cobra(/currentChar\s*=\s*e\.char/.test(devolver) && /currentTeam\s*=\s*e\.team/.test(devolver), 'PE4 a saída do MP não devolve personagem e lado: o SP usa o corpo da sala');

cobra(/switchMode === 'mp'[\s\S]{0,400}escolhaSpAntesDoMp\.char = selChar\.id/.test(main), 'PE5 a tecla M no MP não atualiza a escolha guardada');

const pausa = /<div class="pause-actions panel">([\s\S]*?)<\/div>\s*<!--/.exec(astro)?.[1] || '';
cobra(/id="mp-personagem-ir"/.test(pausa) && /id="mp-personagem-outro"/.test(pausa), 'PE6 botões da oferta fora de .pause-actions: o game.js trata o clique como fundo da pausa');

if (falhas.length) {
  console.log(`personagem-escolhido-check: FAIL${mutante ? ` (mutante ${mutante})` : ''}`);
  for (const f of falhas) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('personagem-escolhido-check: PASS (PE1 8 casos, PE2-PE6)');
