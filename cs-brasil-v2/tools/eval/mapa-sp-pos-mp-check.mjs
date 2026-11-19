/* ============================================================================
   mapa-sp-pos-mp-check.mjs — A SALA DO MULTIPLAYER NÃO LEVA A ESCOLHA DO SP
   ----------------------------------------------------------------------------
   POR QUE EXISTE
   Relato do dono (13/10, produção): escolheu Amazônia no singleplayer e o jogo
   abriu Três Poderes. Causa: o welcome e a virada de partida do multiplayer
   escrevem `currentMap` e `matchMode` (o startGame online lê dali) e nenhuma
   saída devolvia. O cartaz e a URL continuavam dizendo Amazônia; o SP seguinte
   abria o mapa da última sala. Nasceu em f90901df1 (#489, 02/09) e ficou
   visível com o hub (64f74ece2, 26/09), onde SP e MP são abas da mesma tela.

   O QUE ESTA RÉGUA PROVA (fonte de public/js/main.js)
     MS1 toda escrita de `currentMap` vinda da sala (welcome.map, m.map) tem
         `mpGuardarEscolhaSp()` antes dela, na mesma função
     MS2 toda saída da sessão (mpEncerrarSessao, mpDesconectou,
         noServeMapaParado) chama `mpDevolverEscolhaSp()`
     MS3 a devolução repõe mapa, modo, a bandeira de modo escolhido e o índice
         do carrossel, e a guarda é de uma vez só (a virada de partida não
         sobrescreve a escolha guardada no welcome)

   A prova de ponta a ponta (nó local + navegador) é
   tools/eval/mapa-sp-pos-mp-browser.mjs; esta é a parte que cabe no check:fast.

   Uso: node tools/eval/mapa-sp-pos-mp-check.mjs
        [--mutante=sem-devolver|sem-guardar|guarda-sobrescreve|devolve-so-mapa]
   ============================================================================ */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MUTANTES = ['sem-devolver', 'sem-guardar', 'guarda-sobrescreve', 'devolve-so-mapa'];
const mutante = (process.argv.find((a) => a.startsWith('--mutante=')) || '').split('=')[1] || '';
if (mutante && !MUTANTES.includes(mutante)) throw new Error(`mutante desconhecido: ${mutante}`);

let src = readFileSync(path.join(ROOT, 'public/js/main.js'), 'utf8');
if (mutante === 'sem-devolver') src = src.replace(/\n\s*mpDevolverEscolhaSp\(\);/, '');
if (mutante === 'sem-guardar') src = src.replace(/\n\s*mpGuardarEscolhaSp\(\);/, '');
if (mutante === 'guarda-sobrescreve') src = src.replace('if (!escolhaSpAntesDoMp) escolhaSpAntesDoMp =', 'escolhaSpAntesDoMp =');
if (mutante === 'devolve-so-mapa') src = src.replace('matchMode = e.mode; modoEscolhido = e.escolhido;', '');

const falhas = [];

/* Corpo de uma função declarada (`function nome(`), por contagem de chaves. */
function corpo(nome) {
  const m = new RegExp(`(?:async\\s+)?function ${nome}\\s*\\(`).exec(src);
  if (!m) return null;
  let i = src.indexOf('{', m.index), prof = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') prof++;
    else if (src[j] === '}' && --prof === 0) return src.slice(i, j + 1);
  }
  return null;
}

// MS1: escrita vinda da sala só depois da guarda. Olha as linhas anteriores até o início da função.
const linhas = src.split('\n');
const escritas = linhas.map((l, i) => [l, i]).filter(([l]) => /currentMap\s*=\s*(welcome|m)\.map\b/.test(l));
if (escritas.length < 2) falhas.push(`MS1 esperava as 2 escritas de currentMap vindas da sala (welcome e virada), achei ${escritas.length}`);
for (const [l, i] of escritas) {
  let guardou = false;
  for (let k = i - 1; k >= 0 && k >= i - 12; k--) {
    if (/mpGuardarEscolhaSp\(\)/.test(linhas[k])) { guardou = true; break; }
    if (/^\s*(async\s+)?function\b|=>\s*\{\s*$/.test(linhas[k]) && k < i - 1) break;
  }
  if (!guardou) falhas.push(`MS1 main.js:${i + 1} escreve o mapa da sala sem mpGuardarEscolhaSp() antes: ${l.trim()}`);
}

// MS2: toda saída devolve.
for (const nome of ['mpEncerrarSessao', 'mpDesconectou', 'noServeMapaParado']) {
  const c = corpo(nome);
  if (!c) { falhas.push(`MS2 função ${nome} não encontrada`); continue; }
  if (!/mpDevolverEscolhaSp\(\)/.test(c)) falhas.push(`MS2 ${nome} encerra a sessão sem mpDevolverEscolhaSp(): o SP seguinte abre o mapa da sala`);
}

// MS3: guarda uma vez, devolve tudo.
const guardar = corpo('mpGuardarEscolhaSp');
const devolver = corpo('mpDevolverEscolhaSp');
if (!guardar || !devolver) falhas.push('MS3 mpGuardarEscolhaSp/mpDevolverEscolhaSp não encontradas');
else {
  if (!/if\s*\(\s*!escolhaSpAntesDoMp\s*\)/.test(guardar)) falhas.push('MS3 a guarda não é de uma vez só: a virada de partida sobrescreveria a escolha do SP com o mapa da sala');
  for (const campo of ['currentMap', 'matchMode', 'modoEscolhido', 'mapIdx']) {
    if (!new RegExp(`\\b${campo}\\s*=`).test(devolver)) falhas.push(`MS3 a devolução não repõe ${campo}`);
  }
}

if (falhas.length) {
  console.log(`mapa-sp-pos-mp-check: FAIL${mutante ? ` (mutante ${mutante})` : ''}`);
  for (const f of falhas) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`mapa-sp-pos-mp-check: PASS (${escritas.length} escritas guardadas, 3 saídas devolvem)`);
