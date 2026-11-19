import { Game } from './harness.mjs';
import { readFileSync } from 'node:fs';
let { acompanharDuelo: instalar } = await import('./duel-metrics.mjs');
const mutant = process.argv.find(a => a.startsWith('--mutante='))?.split('=')[1];
if (mutant) {
  const source = readFileSync(new URL('duel-metrics.mjs', import.meta.url), 'utf8');
  const swaps = {
    gap: ['hp >= 100) d.firstHit', 'hp >= 100 || g.time - d.lastHit > DUEL_REACTION_SECONDS) d.firstHit'],
    protegido: ['if (!eligible || !(ent.hp < hp)) return result;', 'if (!eligible) return result;'],
    fatal: ['if (d.firstHit === null || hp >= 100)', 'if (ent.alive && (d.firstHit === null || hp >= 100))'],
    cura: ['d.firstHit === null || hp >= 100', 'd.firstHit === null'],
  };
  const swap = swaps[mutant];
  if (!swap || !source.includes(swap[0])) throw Error('mutante não aplicou');
  ({ acompanharDuelo: instalar } = await import(`data:text/javascript;base64,${Buffer.from(source.replace(...swap)).toString('base64')}`));
}
let failures = 0;
const check = (ok, name) => { console.log(`${ok ? 'OK' : 'FALHA'} ${name}`); failures += !ok; };
function fixture() {
  const player = { isPlayer: true, alive: true, hp: 100, team: 'E', deaths: 0 };
  const bot = { team: 'B', alive: true, weapon: 'ak' };
  const g = Object.assign(Object.create(Game.prototype), { time: 0, state: 'live', player, bots: [bot],
    el: { vignette: { style: {} }, hpFill: { style: {} } }, sfx: { hurt() {} },
    _stackTrace() {}, _dmgArc() {}, _flash() {}, _noteHit() {},
    _kill(ent) { ent.alive = false; ent.hp = 0; ent.deaths++; } });
  const d = instalar(g);
  return { g, d, player, hit(t, damage, head = false) { g.time = t; g._damage(player, damage, bot, 'AK', head); g._noteHit(bot, 'AK', damage, head, 10); } };
}
{
  const f = fixture(); f.hit(1, 16); f.hit(6, 16); f.hit(10, 68);
  check(f.d.ttkN === 1 && f.d.ttk === 9, 'silêncio sem cura preserva primeiro dano da vida');
}
{
  const f = fixture(); f.player.protUntil = 5; f.hit(1, 30); f.hit(6, 20); f.hit(10, 80);
  check(f.d.hits === 2 && f.d.ttk === 4, 'dano protegido não conta como acerto nem inicia janela');
}
{
  const f = fixture(); f.hit(0, 100);
  check(f.d.ttkN === 1 && f.d.ttk === 0 && f.d.deaths === 1 && f.d.healthyFastBursts === 1, 'primeiro acerto fatal em t=0 é amostra zero válida');
  check(!(f.d.ttk / f.d.ttkN >= 3), 'BOT4 continua reprovando letalidade saudável abaixo de três segundos');
  f.hit(1, 20); f.player.hp = 100; f.player.alive = true; f.hit(4, 50); f.hit(8, 50);
  check(f.d.ttkN === 2 && f.d.ttk === 4 && f.d.hits === 3, 'nota fatal tardia e dano em morto não contaminam respawn');
}
{
  const f = fixture(); f.hit(1, 30); f.player.hp = 90; f.hit(5, 90);
  check(f.d.ttk === 4, 'cura parcial não apaga primeiro dano');
}
{
  const f = fixture(); f.hit(1, 30); f.player.hp = 100; f.hit(5, 50); f.hit(9, 50);
  check(f.d.ttk === 4, 'recuperação real a cem HP reinicia episódio');
}
{
  const f = fixture(); f.hit(1, 1); f.hit(20, 49); f.hit(21, 50);
  check(f.d.ttk === 20 && f.d.burstSum === 1 && f.d.woundedBursts === 1,
    'rajada curta iniciada ferido permanece diagnosticada separadamente');
}
{
  const f = fixture(); f.hit(7, 100);
  check(f.d.ttkN === 1 && f.d.ttk === 0, 'acerto fatal não espera nota de feedback para abrir amostra');
}
const consumer = readFileSync(new URL('botsim.mjs', import.meta.url), 'utf8');
check(consumer.includes('D = acompanharDuelo(g);'), 'botsim consome a instrumentação testada');
process.exitCode = failures ? 1 : 0;
