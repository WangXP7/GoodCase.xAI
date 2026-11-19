import fs from 'node:fs';
import { Game } from './eval/harness.mjs';
import { WEAPONS } from '../public/js/data/weapons.js';
import { PERFIS_ARMAS } from '../public/js/data/weapon-profiles.js';
const n = v => Number(v.toFixed(3));
function tiros(dano) {
  if (!(dano > 0)) throw Error('dano inválido na matriz');
  return Math.ceil(100 / dano);
}
function tempo(quantidade, w) {
  const recargas = Math.floor((quantidade - 1) / w.mag);
  return n((quantidade - 1) * w.rate + recargas * Math.max(0, w.reload - w.rate));
}
const src = fs.readFileSync(new URL('../public/js/game.js', import.meta.url), 'utf8');
const linhaDano = src.slice(0, src.indexOf('  _shotDamage(')).split('\n').length;
const linhaFaca = src.slice(0, src.indexOf('  _meleeHit(')).split('\n').length;
let md = `# Matriz gerada do arsenal\n\nGerada por \`node tools/gen-weapon-matrix.mjs\`; não editar os valores à mão.\nO dano vem do consumidor real em [game.js:${linhaDano}](../public/js/game.js#L${linhaDano}).\n\nAlvo ideal de 100 HP, sem proteção/regeneração, primeiro tiro imediato, todos os\npellets no mesmo alvo, sem erro de mira, saque ou latência. TTK usa cadência\nconfigurada e inclui recarga ao ultrapassar o pente. É um limite ideal, não\nprevisão de partida nem equivalência entre HP e energia de munição real.\n\nPara a escopeta, dano é por cartucho completo; pellets mostra a contagem e o\ndano individual de contato. A probabilidade de concentrá-los depende da\ndispersão. Luneta é equipamento do jogo e não determina o perfil de dano.\n\n| ID | Referência / cartucho | Ação / entrada | Perfil / luneta | RPM máximo do jogo | Pente | Pellets × dano | Torso 0 / 50 / 100 / 200 m | BTK torso 0 / 100 m | TTK torso 0 / 100 m (s) | HS a 0 m |\n|---|---|---|---|---:|---:|---|---|---|---|---:|\n`;
for (const [id, w] of Object.entries(WEAPONS)) {
  if (id === 'knife') continue;
  const p = PERFIS_ARMAS[id];
  if (!p) throw Error(`ficha ausente: ${id}`);
  const pellets = w.pellets || 1;
  const danos = [0, 50, 100, 200].map(dist => Game.prototype._shotDamage.call(Game.prototype, w.dmg, id, dist, false) * pellets);
  const btk = [danos[0], danos[2]].map(tiros);
  const hs = Game.prototype._shotDamage.call(Game.prototype, w.dmg, id, 0, true) * pellets;
  md += `| ${id} | ${p.referencia} / ${p.cartucho} | ${p.acao} / ${p.segurar ? 'segurar' : 'pressionar'} | ${p.perfilDano} / ${w.scope ? 'sim' : 'não'} | ${n(60/w.rate)} | ${w.mag} | ${pellets} × ${w.dmg} | ${danos.map(n).join(' / ')} | ${btk.join(' / ')} | ${btk.map(q => tempo(q, w)).join(' / ')} | ${n(hs)} |\n`;
}
const faca = WEAPONS.knife;
md += `\nA faca usa [game.js:${linhaFaca}](../public/js/game.js#L${linhaFaca}), sem modelo de pellet,\nfalloff ou headshot de tiro. Golpe rápido: ${faca.dmg} HP; alcance configurado\n${faca.range} m; intervalo ${faca.rate} s. O golpe pesado possui seu próprio\ncontrato e não é equiparado a um disparo nesta tabela.\n`;
const destino = new URL('../docs/ARMAS-MATRIZ.md', import.meta.url);
if (process.argv.includes('--check')) {
  if (!fs.existsSync(destino) || fs.readFileSync(destino, 'utf8') !== md) {
    console.error('Matriz desatualizada: rode node tools/gen-weapon-matrix.mjs'); process.exitCode = 1;
  }
} else fs.writeFileSync(destino, md);
