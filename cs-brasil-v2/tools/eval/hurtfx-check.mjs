/* hurtfx-check.mjs — o "levei tiro" do online não acumula nada na cena?
 *
 * `_playerHurtFx` (chamado pelo netcode a cada queda de hp no snapshot) abria um
 * GPUParticles novo por dano via `_tintFx`, descartava o retorno e nunca emitia.
 * Medido no Chromium com ANGLE Metal (M4 Pro, praca_poderes, quality med), 100 chamadas:
 * texturas 647→754, geometrias 903→1053, filhos da cena 71→171, draw calls 452→491.
 * Os 100 sistemas, desenhados sozinhos, pintavam 0 pixels (controle com spawn: 9472).
 *
 *   HF1  100 chamadas não acrescentam filho, textura, geometria nem partícula suave à cena;
 *   HF2  o feedback que sobra (coice) continua acontecendo.
 *
 * Mutação (sai 1 se a mutação PASSAR):
 *   --mutante=tintfx   devolve a criação do sistema por dano
 *
 *   node tools/eval/hurtfx-check.mjs
 */
import { bootGame, initTextures, Game } from './harness.mjs';

const MUTANTE = (process.argv.find((a) => a.startsWith('--mutante=')) || '').split('=')[1] || '';
if (!['', 'tintfx'].includes(MUTANTE)) { console.error(`mutante desconhecido: ${MUTANTE}`); process.exit(1); }
if (MUTANTE === 'tintfx') {
  const fonte = Game.prototype._playerHurtFx.toString();
  const mutada = fonte.replace(/(this\.sfx\.hurt.*\n)/, '$1    this._tintFx(0xff2222, false, 96);\n');
  if (mutada === fonte) { console.error('MUTANTE NAO APLICOU: tintfx'); process.exit(1); }
  Game.prototype._playerHurtFx = new Function(`return ({ ${mutada} })._playerHurtFx;`)();
}

const g = bootGame('praca_poderes', { textures: initTextures() });
g.settings.quality = 'med';
const conta = () => {
  const tex = new Set(), geo = new Set();
  g.scene.traverse((o) => {
    if (o.geometry) geo.add(o.geometry);
    for (const m of [].concat(o.material || [])) {
      for (const v of Object.values(m)) if (v && v.isTexture) tex.add(v);
      for (const u of Object.values(m.uniforms || {})) if (u && u.value && u.value.isTexture) tex.add(u.value);
    }
  });
  return { filhos: g.scene.children.length, texturas: tex.size, geometrias: geo.size, suaves: (g.scene.userData.softs || []).length };
};
const antes = conta();
const coice0 = g.player.recoilP || 0;
for (let i = 0; i < 100; i++) g._playerHurtFx();
const depois = conta();
const coice = (g.player.recoilP || 0) - coice0;

const cresceu = Object.keys(antes).filter((k) => depois[k] !== antes[k]);
const res = [
  ['HF1', '100 danos no online não acumulam nada na cena', cresceu.length === 0,
    Object.keys(antes).map((k) => `${k} ${antes[k]}→${depois[k]}`).join(', ') +
    (cresceu.length ? ' — _playerHurtFx em public/js/game.js voltou a abrir sistema por dano' : '')],
  ['HF2', 'o coice do dano continua', coice > 1.9, `recoilP +${coice.toFixed(2)}`],
];
for (const [id, desc, ok, evid] of res) console.log(`${ok ? '✓' : '✗'} ${id}  ${desc} — ${evid}`);
const falhou = res.some(([, , ok]) => !ok);
if (MUTANTE) {
  console.log(falhou ? `✓ mutante ${MUTANTE} ficou vermelho` : `✗ mutante ${MUTANTE} PASSOU — régua cega`);
  process.exit(falhou ? 0 : 1);
}
process.exit(falhou ? 1 : 0);
