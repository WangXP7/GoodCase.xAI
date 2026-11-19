import { Game, bootGame, initTextures, THREE } from './harness.mjs';
import { WEAPONS } from '../../public/js/data/weapons.js';
let perfis;
try { perfis = await import('../../public/js/data/weapon-profiles.js'); }
catch (erro) { console.error('FALHA arsenal não declara referência, ação, entrada e dano separadamente:', erro.message); process.exit(1); }
const { PERFIS_ARMAS, perfilArma } = perfis;
const mutante = process.argv.find(a => a.startsWith('--mutante='))?.split('=')[1];
if (mutante === 'ignora-perfil') {
  const dano = Game.prototype._shotDamage;
  Game.prototype._shotDamage = function (dmg, id, ...args) {
    return dano.call(this, dmg, ['rem700', 'g3sg1', 'm400'].includes(id) ? 'ak' : id, ...args);
  };
} else if (mutante === 'entrada-mecanica') {
  const atualizar = Game.prototype._updatePlayer;
  Game.prototype._updatePlayer = function (...args) {
    const segurar = PERFIS_ARMAS.pistol.segurar;
    try { PERFIS_ARMAS.pistol.segurar = false; return atualizar.apply(this, args); }
    finally { PERFIS_ARMAS.pistol.segurar = segurar; }
  };
} else if (mutante && mutante !== 'saque-fallback') throw Error('mutante desconhecido');
let falhas = 0;
const cobrar = (ok, msg) => { console.log(`${ok ? 'OK' : 'FALHA'} ${msg}`); if (!ok) falhas++; };
{
  const native = Object.hasOwn;
  let compatible = false;
  try {
    Object.hasOwn = undefined;
    compatible = perfilArma('awp') === PERFIS_ARMAS.awp;
    try { perfilArma('__proto__'); compatible = false; } catch {}
  } catch {}
  finally { Object.hasOwn = native; }
  cobrar(compatible, 'ficha carrega sem Object.hasOwn e rejeita chaves herdadas');
}
cobrar(Object.keys(WEAPONS).sort().join() === Object.keys(PERFIS_ARMAS).sort().join(), 'todo ID tem exatamente uma ficha explícita');
for (const [id, p] of Object.entries(PERFIS_ARMAS)) {
  cobrar(p.referencia && p.cartucho && p.acao && typeof p.segurar === 'boolean' && p.perfilDano && p.saque > 0,
    `${id}: referência, cartucho, ação, entrada, dano e saque declarados`);
  cobrar(p.segurar === !!WEAPONS[id].auto, `${id}: conveniência de entrada vigente preservada`);
}
for (const id of ['rem700', 'g3sg1', 'm400']) {
  const p = PERFIS_ARMAS[id], original = p.perfilDano;
  try {
    const antes = Game.prototype._shotDamage.call(Game.prototype, 30, id, 200, true);
    p.perfilDano = 'sniper';
    const depois = Game.prototype._shotDamage.call(Game.prototype, 30, id, 200, true);
    cobrar(antes !== depois, `${id}: consumidor de dano lê perfil explícito, independentemente da luneta`);
  } finally { p.perfilDano = original; }
}
let recusou = false;
try { Game.prototype._shotDamage.call(Game.prototype, 30, 'arma-sem-ficha', 200, false); } catch { recusou = true; }
cobrar(recusou, 'arma sem ficha não cai silenciosamente em rifle');
for (const id of ['toString', '__proto__']) {
  let recusou = false;
  try { perfilArma(id); } catch { recusou = true; }
  cobrar(recusou, `propriedade herdada ${id} não é ficha de arma`);
}
const jogo = bootGame('praca_poderes', { textures: initTextures(), bots: 2, seed: 972 });
jogo.state = 'live'; jogo.time = 10; jogo.mouseDown0 = true;
for (const nome of ['_fireHitscan', '_flash', '_ejectCasing', '_shotRecoil']) jogo[nome] = () => {};
jogo._muzzleWorld = () => new THREE.Vector3(); jogo.vm.recoil.kick = () => {};
Object.assign(jogo.player, { alive: true, weapon: 'pistol', nextShotAt: 0, reloadUntil: 0, drawUntil: 0 });
jogo.player.ammo.pistol = { mag: 12, res: 0 };
try {
  PERFIS_ARMAS.pistol.segurar = true; jogo._updatePlayer(.016);
  cobrar(jogo.player.ammo.pistol.mag === 11, 'update real consome modo de entrada, sem confundi-lo com ação mecânica');
  const saque = PERFIS_ARMAS.m4.saque;
  try {
    PERFIS_ARMAS.m4.saque = mutante === 'saque-fallback' ? .42 : .7;
    jogo._switchWeapon('m4');
    cobrar(Math.abs(jogo.player.drawUntil - jogo.time - .7) < 1e-8, 'saque real lê a ficha explícita da arma');
  } finally { PERFIS_ARMAS.m4.saque = saque; }
} finally { PERFIS_ARMAS.pistol.segurar = false; jogo.dispose(); }
process.exitCode = falhas ? 1 : 0;
