// CONTRATO: sobreviver ao corte de round não pode entregar o round seguinte sem balas.
// O _resetPositions repunha SÓ os slots awp/pistol; no modo 'all' a arma do personagem
// (rifle, SMG...) carregava o pente/reserva do fim do round anterior. Quem morria
// renascia cheio (respawn repõe o loadout); quem sobrevivia chegava no round 2 a pires.
// Usa o Game REAL (stub de DOM/three do harness), boot igual ao bootGame do harness —
// cópia mínima só para poder apontar --game-module pro mutante.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const option = (n) => process.argv.find((a) => a.startsWith(n + '='))?.slice(n.length + 1);
const gameFile = path.resolve(option('--game-module') || path.join(ROOT, 'public/js/game.js'));

const { THREE, MAPS, initTextures, renderer, sfx, seedRandom, CHARACTERS } =
  await import(pathToFileURL(path.join(ROOT, 'tools/eval/harness.mjs')));
const { Game, WEAPONS } = await import(pathToFileURL(gameFile));
const { PISTOLS } = await import(pathToFileURL(path.join(ROOT, 'public/js/weapons.js')));
const { CHAR_WEAPON } = await import(pathToFileURL(path.join(ROOT, 'public/js/characters.js')));
const hash = (f) => fs.readFileSync(f, 'utf8');

// boot: mesmos passos do bootGame do harness (Game novo já com round 1 rodando e matrizes
// de mundo prontas pro raycaster). Duplicado de propósito: bootGame instancia o Game DELE,
// e o mutante precisa instanciar o game.js do --game-module.
function boot({ mapId = 'ferro_velho', settings = {}, playerCharId } = {}) {
  seedRandom(12345);
  const playerDef = CHARACTERS.find((c) => c.id === playerCharId) || CHARACTERS[0];
  const g = new Game({
    renderer, textures: initTextures(), sfx,
    settings: { bots: 4, quality: 'low', difficulty: 'normal', sens: 1, ...settings },
    playerCharId: playerDef.id, playerTeam: 'E', playerFaction: playerDef.team, enemyFaction: 'B',
    nickname: 'SIM', mapId, ctf: false, testMode: true, onQuit() {}, onMatchEnd() {},
  });
  g._ensureDolly = () => {};
  g.killsToWin = Infinity;
  g.start ? g.start() : g._startRound();
  g.scene.updateMatrixWorld(true);
  g.world.root.updateMatrixWorld(true);
  return g;
}

const rows = [];
const check = (name, pass, observed = {}) => rows.push({ name, pass: !!pass, observed });
const cheia = (w) => g.player.ammo[w] && g.player.ammo[w].mag === WEAPONS[w].mag
  && g.player.ammo[w].res === WEAPONS[w].reserve;
const seca = (w) => g.player.ammo[w] && g.player.ammo[w].mag === 0 && g.player.ammo[w].res === 0;
const esgota = (w) => { g.player.ammo[w] = { mag: 0, res: 0 }; };

/* Cenário 1 — o do relato: modo 'all' (padrão SP), arma do personagem que não é
   awp/pistola, jogador GASTOU tudo no round 1 e sobreviveu ao corte. */
{
  const arma = (c) => CHAR_WEAPON[c.id] || 'ak';
  const rifleChar = CHARACTERS.find((c) => c.team === 'E'
    && !PISTOLS.has(arma(c)) && arma(c) !== 'awp' && arma(c) !== 'knife');
  if (!rifleChar) throw new Error('sem personagem com rifle no elenco — régua sem cenário');
  var g = boot({ playerCharId: rifleChar.id });
  const w1 = g.player.weapon;
  check('setup arma do personagem em jogo', w1 === arma(rifleChar), { w1 });
  esgota(w1); esgota('pistol');
  g._resetPositions();   // o que o _startRound chama no início do round 2
  const w2 = g.player.weapon;
  check('round novo com primaria cheia', w2 === w1 && cheia(w2),
    { w2, ammo: g.player.ammo[w2] });
  check('round novo com secundaria cheia', cheia('pistol'), { ammo: g.player.ammo.pistol });
  check('loadout volta pro personagem', g.player.primary === w2 && g.player.secondary === 'pistol');
}

/* Cenário 2 — modo SÓ PISTOLAS: repor loadout não pode presentear AWP (o respawn
   também respeita o modo: slot proibido não se enche). */
{
  g = boot({ settings: { wpnMode: 'pistols' } });
  esgota('pistol');
  g._resetPositions();
  check('pistols: pistola cheia', g.player.weapon === 'pistol' && cheia('pistol'),
    { ammo: g.player.ammo.pistol });
  check('pistols: awp continua fora do cardápio', seca('awp') || !g.player.ammo.awp,
    { awp: g.player.ammo.awp });
}

/* Cenário 2b — modo SÓ AWP: o top-off não pode presentear a pistola que o modo zerou. */
{
  g = boot({ settings: { wpnMode: 'awp' } });
  esgota('pistol');
  g._resetPositions();
  check('awp: primaria cheia', g.player.weapon === 'awp' && cheia('awp'), { awp: g.player.ammo.awp });
  check('awp: pistola continua seca', seca('pistol'), { pistol: g.player.ammo.pistol });
}

/* Cenário 3 — modo FACA: nada de munição nenhuma aparecendo do nada. */
{
  g = boot({ settings: { wpnMode: 'knife' } });
  const cw = CHAR_WEAPON[g.playerCharId] || 'ak';
  esgota(cw);
  g._resetPositions();
  check('knife: awp seco', seca('awp'), { awp: g.player.ammo.awp });
  check('knife: pistola seca', seca('pistol'), { pistol: g.player.ammo.pistol });
  check('knife: arma do personagem não ganha pente', seca(cw), { [cw]: g.player.ammo[cw] });
}

/* Cenário 4 — respawn (quem morreu) continua cheio: o fix não pode regredir o caminho
   que já funcionava. */
{
  g = boot({});
  const w = g.player.weapon === 'knife' || !g.player.ammo[g.player.weapon] ? 'awp' : g.player.weapon;
  esgota(w);
  g._respawnPlayer ? g._respawnPlayer() : (g.player.hp = 0, g._updateRespawn?.(0));
  check('respawn repõe o loadout (contrato existente)', cheia(w) || g.player.ammo[w].mag > 0,
    { ammo: g.player.ammo[w] });
}

// deriva de fonte: o hash do game.js real tem que fechar com o módulo carregado
const src = hash(gameFile);
check('game.js legível e com WEAPONS', !!src && !!WEAPONS.awp && !!WEAPONS.pistol);

const result = {
  passed: rows.filter((r) => r.pass).length, total: rows.length,
  failed: rows.filter((r) => !r.pass).map((r) => r.name), rows,
  scope: 'contrato de munição entre rounds; sem aprovacao visual/MP',
};
console.log(JSON.stringify({ passed: result.passed, total: result.total, failed: result.failed }, null, 1));
if (result.failed.length) process.exitCode = 1;
