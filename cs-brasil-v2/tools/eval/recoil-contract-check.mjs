import { Game, bootGame, initTextures, THREE } from './harness.mjs';
import { WEAPONS } from '../../public/js/data/weapons.js';
import { REC_DEG, REC, RECOIL_CLASS, RECOIL_PATTERN, vmKickAmp } from '../../public/js/recoil.js';

// #970: valores recuperados de 1f1060b40^, antes da remoção no pacote de viewmodels.
const anteriores = { akm: 1.72, g3: 1.75, tavor: 1.3, m400: 1.5, rem700: 4.8, g3sg1: 1.7 };
const classes = { akm: 'ak', g3: 'ak', tavor: 'ar' };
const mutante = process.argv.find(arg => arg.startsWith('--mutante='))?.split('=')[1];
if (mutante) {
  if (mutante.startsWith('classe-')) {
    const id = mutante.slice(7);
    if (!Object.hasOwn(classes, id) || !Object.hasOwn(RECOIL_CLASS, id)) throw new Error('mutação de classe não aplicou');
    delete RECOIL_CLASS[id];
  } else {
    if (!(mutante in anteriores)) throw new Error(`mutante desconhecido: ${mutante}`);
    if (!Object.hasOwn(REC_DEG, mutante)) throw new Error('mutação não aplicou: perfil já ausente');
    delete REC_DEG[mutante];
  }
}
let falhas = 0;
const cobrar = (ok, descricao) => { console.log(`${ok ? 'OK' : 'FALHA'} ${descricao}`); if (!ok) falhas++; };
for (const id of Object.keys(WEAPONS)) cobrar(Object.hasOwn(REC_DEG, id), `${id}: amplitude explícita`);
const randomOriginal = Math.random;
const game = bootGame('praca_poderes', { textures: initTextures(), bots: 0, seed: 970 });
game.state = 'live'; game.time = 10;
for (const nome of ['_fireHitscan', '_flash', '_ejectCasing', '_shotRecoil', '_scope']) game[nome] = () => {};
game._muzzleWorld = () => new THREE.Vector3();
try {
  Math.random = () => 0.5;
  for (const [id, graus] of Object.entries(anteriores)) {
    for (const scoped of [false, true]) {
      const p = { scoped, crouchF: 0, sprayI: 0, pitch: 0, yaw: 0 };
      const estado = { ty: 0, tx: 0, sh: 0 };
      Game.prototype._shotRecoil.call({ time: 10, _installRecoil: () => estado }, p, id);
      const impulso = graus * Math.PI / 180 * (scoped ? 0.68 : 1);
      cobrar(Math.abs(p.pitch - impulso * REC.perm) < 1e-12, `${id}: deriva real ${scoped ? 'ADS' : 'quadril'}`);
      cobrar(Math.abs(estado.ty - impulso * (1 - REC.perm)) < 1e-12, `${id}: punch real ${scoped ? 'ADS' : 'quadril'}`);
      const kick = (0.42 + Math.sqrt(graus) * 0.28) * (scoped ? 0.7 : 1);
      cobrar(Math.abs(vmKickAmp(id, { scoped }) - kick) < 1e-12, `${id}: amplitude do viewmodel`);
      Object.assign(game.player, { weapon: id, scoped, crouchF: 0, nextShotAt: 0, drawUntil: 0, reloadUntil: 0 });
      game.player.ammo[id] = { mag: 2, res: 0 };
      let recebido = null;
      game.vm.recoil.kick = valor => { recebido = valor; };
      game._tryShoot();
      cobrar(recebido !== null && Math.abs(recebido - kick) < 1e-12, `${id}: _tryShoot entrega o kick real ao viewmodel`);
    }
  }
  for (const [id, cls] of Object.entries(classes)) {
    const p = { scoped: false, crouchF: 0, sprayI: 8, pitch: 0, yaw: 0 };
    const estado = { ty: 0, tx: 0, sh: 0 };
    Game.prototype._shotRecoil.call({ time: 10, _installRecoil: () => estado }, p, id);
    const impulso = anteriores[id] * Math.PI / 180;
    const [x, y] = RECOIL_PATTERN[cls][8];
    cobrar(Math.abs(estado.tx - impulso * x * (1 - REC.perm)) < 1e-12
      && Math.abs(estado.ty - impulso * y * (1 - REC.perm)) < 1e-12, `${id}: padrão real no nono tiro`);
  }
} finally { Math.random = randomOriginal; game.dispose(); }
process.exitCode = falhas ? 1 : 0;
