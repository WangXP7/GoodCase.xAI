/* AWP-SCOPE-CHECK — luneta engatada é cone de luneta, na hora do gatilho.
   ═══════════════════════════════════════════════════════════════════════════════════
   O BURACO QUE COMPROU ESTA RÉGUA

   Relato do dono (13/10/2026): "jogando de AWP, vejo o inimigo no escopo, miro, e
   dependendo da distância o tiro não chega". Causa medida em sonda de navegador
   (alvo congelado, mira exata no peito, mesmo tick do disparo):

   - luneta COMPLETA (aimF 1): desvio 0,16 m a 46 m — acerto perfeito;
   - re-scope após o descope pós-tiro (aimF 0,52): desvio de 74 m — a bala ia a
     from+dir*120 sem tocar nada.

   O GUNFEEL trocou o spread da luneta (`estado.scoped ? spreadScope`) pela
   INTERPOLAÇÃO da rampa de FOV (`adsF`). A máscara da luneta aparece na tela bem
   antes do FOV terminar de fechar, então o jogador "está no escopo" com o cone
   ainda aberto (spreadHip da AWP: 0,075 rad = 4,3°). A AWP descopeia a cada tiro
   (game.js, `p.scoped && awp|mosin`), o que faz do re-scope o caminho comum.

   O QUE ELA MEDE (aberturaCone, a MESMA conta do servidor):
     AS1 · luneta engatada (scoped em arma com scope) = spreadScope, mesmo com adsF 0;
     AS2 · arma SEM scope real continua interpolando pela rampa (adsF) — sem regressão;
     AS3 · no AR o piso SPREAD_AR continua valendo, luneta ou não (A1-A3 não regrediu).

   Mutante: `--mutante=rampa` devolve a interpolação pura e tem que reprovar.
   Uso: node tools/eval/awp-scope-check.mjs [--mutante=rampa]
   ═══════════════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const MUT = (process.argv.find((a) => a.startsWith('--mutante=')) || '').split('=')[1] || '';
let fonte = readFileSync(new URL('../../public/js/game.js', import.meta.url), 'utf8');
if (MUT === 'rampa') {
  const alvo = 'estado.scoped && W.scope ? spScoped : W.spreadHip + (spScoped - W.spreadHip) * adsF';
  const troca = 'W.spreadHip + (spScoped - W.spreadHip) * adsF';
  if (!fonte.includes(alvo)) { console.error('mutante rampa: alvo não encontrado'); process.exit(2); }
  fonte = fonte.replace(alvo, troca);
}
/* Avalia aberturaCone da fonte (com ou sem mutação) sem bootar o jogo: a função é
   fechada sobre constantes do módulo, então a fatia avaliada carrega o que precisa. */
const inicio = fonte.indexOf('export function aberturaCone');
const fim = fonte.indexOf('export function anguloDeDisparo');
if (inicio < 0 || fim < 0 || fim <= inicio) { console.error('não achei aberturaCone na fonte'); process.exit(2); }
const pre = /const SPREAD_AR = ([0-9.]+)/.exec(fonte);
const GUNFEEL = true;
const mod = await import('data:text/javascript,' + encodeURIComponent(
  `const SPREAD_AR = ${pre ? pre[1] : 0.09}; const GUNFEEL = ${GUNFEEL};\n`
  + fonte.slice(inicio, fim).replace('export function', 'function')
  + '\nexport { aberturaCone };'
));
const { aberturaCone } = mod;

const WEAPONS = (await import('../../public/js/data/weapons.js')).WEAPONS;
const falhas = [];
const cobra = (cond, cod, txt, det) => { console.log(`${cod} · ${txt}\n   ${det}\n   ${cond ? 'PASSA' : 'FALHA'}`); if (!cond) falhas.push(cod); };
const est = (extra = {}) => ({ crouchF: 0, sp: 0, grounded: true, adsF: 0, bloom: 0, scoped: false, ...extra });

// AS1 — luneta engatada: cone de luneta JÁ, mesmo no re-scope imediato (adsF 0)
for (const id of ['awp', 'mosin']) {
  const w = WEAPONS[id];
  const s = aberturaCone(est({ scoped: true, adsF: 0 }), w);
  cobra(s <= w.spreadScope * 1.0001, 'AS1', `${id} com luneta engatada fecha o cone na hora do gatilho`,
    `scoped+adsF0 -> ${s.toPrecision(3)} rad (spreadScope ${w.spreadScope}); era spreadHip ${w.spreadHip} no bug`);
}
// AS2 — sem scope real, a rampa segue mandando (regressão de iron-sight)
{
  const w = WEAPONS.ak;
  const meio = aberturaCone(est({ adsF: 0.5 }), w);
  const hip = w.spreadHip, scope = w.spreadScope ?? w.spreadHip * 0.35;
  cobra(Math.abs(meio - (hip + (scope - hip) * 0.5)) < 1e-9, 'AS2', 'AK (sem luneta real) continua interpolando pela rampa do ADS',
    `adsF 0,5 -> ${meio.toPrecision(3)} rad (esperado o ponto médio ${((hip + (scope - hip) * 0.5)).toPrecision(3)})`);
}
// AS3 — no ar, o piso do spread segue (a AWP pulando NÃO vira laser)
{
  const w = WEAPONS.awp;
  const s = aberturaCone(est({ scoped: true, adsF: 1, grounded: false }), w);
  const piso = w.spreadHip + Number(/\bSPREAD_AR = ([0-9.]+)/.exec(fonte)[1]);
  cobra(s >= piso - 1e-9, 'AS3', 'AWP no ar mantém o piso de inaccuracy do pulo (SPREAD_AR)',
    `scoped no ar -> ${s.toPrecision(3)} rad (piso ${piso.toPrecision(3)})`);
}

console.log(falhas.length ? `\nVERMELHO — ${falhas.join(', ')}` : '\nVERDE');
if (MUT && !falhas.length) { console.error('\n✗ mutante passou: a régua não morde'); process.exit(1); }
if (falhas.length) process.exit(1);
