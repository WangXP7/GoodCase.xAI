import { Game, bootGame, initTextures, THREE } from './harness.mjs';
import { WEAPONS } from '../../public/js/data/weapons.js';

// #969: a cadência vem de WEAPONS.rate; main.js limita cada passo a 50 ms.
const game = bootGame('praca_poderes', { textures: initTextures(), bots: 2, seed: 969 });
game.state = 'live';
for (const nome of ['_fireHitscan', '_flash', '_ejectCasing', '_shotRecoil']) game[nome] = () => {};
game._muzzleWorld = () => new THREE.Vector3();
game.vm.recoil.kick = () => {};
let falhas = 0;
const cobrar = (ok, texto) => { console.log(`${ok ? 'OK' : 'FALHA'} ${texto}`); if (!ok) falhas++; };
const mutante = process.argv.find(arg => arg.startsWith('--mutante='))?.split('=')[1];
if (mutante) {
  const disparar = Game.prototype._tryShoot;
  if (mutante === 'reagendar') game._tryShoot = function () { return disparar.call(this, false); };
  else if (mutante === 'sem-cooldown') game._tryShoot = function (...args) {
    this.player.nextShotAt = this.time; return disparar.apply(this, args);
  };
  else throw new Error(`mutante desconhecido: ${mutante}`);
}
const preparar = id => {
  game.time = 1; game.bloom = 0; game.mouseDown0 = true;
  Object.assign(game.player, { weapon: id, alive: true, scoped: false, nextShotAt: 0, reloadUntil: 0, drawUntil: 0 });
  game.player.ammo[id] = { mag: 1000, res: 0 };
};
try {
  cobrar(Object.values(WEAPONS).filter(w => w.auto).every(w => w.rate > 0.05),
    'todas as armas automáticas são mais lentas que o passo máximo de 50 ms');
  for (const id of ['m4', 'mp5', 'famas', 'p90']) {
    for (const hz of [20, 30, 60, 144]) {
      preparar(id);
      game._tryShoot();
      let maiorRajada = 0;
      for (let quadro = 1; quadro < 10 * hz; quadro++) {
        game.time = 1 + quadro / hz;
        const antes = game.player.ammo[id].mag;
        game._updatePlayer(1 / hz);
        maiorRajada = Math.max(maiorRajada, antes - game.player.ammo[id].mag);
      }
      const tiros = 1000 - game.player.ammo[id].mag;
      const ideal = 1 + tiros * WEAPONS[id].rate;
      cobrar(Math.abs(game.player.nextShotAt - ideal) < 1e-9,
        `${id} a ${hz} Hz: ${tiros} tiros, calendário preservado`);
      cobrar(tiros >= Math.floor((10 - 1 / hz) / WEAPONS[id].rate), `${id} a ${hz} Hz: taxa nominal`);
      cobrar(tiros <= Math.ceil(10 / WEAPONS[id].rate) && maiorRajada <= 1,
        `${id} a ${hz} Hz: teto nominal e no máximo um tiro por passo`);
    }
  }
  preparar('mp5'); game._tryShoot();
  game.mouseDown0 = false;
  game.time = 10; game._updatePlayer(0.05);
  game.mouseDown0 = true; game._tryShoot();
  cobrar(game.player.ammo.mp5.mag === 998 && Math.abs(game.player.nextShotAt - 10.075) < 1e-9,
    'soltar e pressionar reinicia o calendário sem dívida de tiros');
  preparar('pistol'); game._tryShoot();
  for (let i = 1; i <= 60; i++) { game.time = 1 + i / 60; game._updatePlayer(1 / 60); }
  cobrar(game.player.ammo.pistol.mag === 999, 'pistola continua exigindo novo clique');
  preparar('mp5'); game._tryShoot(); game.player.reloadUntil = 5;
  game.time = 4; game._updatePlayer(0.05);
  cobrar(game.player.ammo.mp5.mag === 999, 'recarga bloqueia disparo');
  game.player.reloadUntil = 0; game.time = 6; game._updatePlayer(0.05);
  cobrar(game.player.ammo.mp5.mag === 998 && Math.abs(game.player.nextShotAt - 6.075) < 1e-9,
    'retorno após bloqueio inicia novo calendário sem rajada acumulada');
  preparar('mp5'); game._tryShoot();
  game.time = 1.04; game.mouseDown0 = false; game._updatePlayer(0.04);
  game.time = 1.05; game.mouseDown0 = true; game._tryShoot();
  cobrar(game.player.ammo.mp5.mag === 999, 'novo clique durante cooldown não antecipa tiro');
  game.time = 1.08; game._updatePlayer(0.03);
  cobrar(game.player.ammo.mp5.mag === 998 && Math.abs(game.player.nextShotAt - 1.15) < 1e-9,
    'clique bloqueado seguido de gatilho segurado preserva fase anterior');
  preparar('mp5'); game._tryShoot(); game.player.drawUntil = 1.08;
  game.time = 1.07; game._updatePlayer(0.05);
  cobrar(game.player.ammo.mp5.mag === 999, 'saque bloqueia disparo');
  game.time = 1.10; game._updatePlayer(0.03);
  cobrar(game.player.ammo.mp5.mag === 998 && Math.abs(game.player.nextShotAt - 1.15) < 1e-9,
    'bloqueio curto mantém fase sem recuperar vários tiros');
} finally { game.dispose(); }
process.exitCode = falhas ? 1 : 0;
