/* TRACER-3P-CHECK — em 3ª pessoa, o traçado do jogador nasce da arma do corpo.
   ═══════════════════════════════════════════════════════════════════════════════════
   O BURACO QUE COMPROU ESTA RÉGUA

   Relato do dono (13/10/2026): em câmera de ombro ou corpo inteiro, "o trajeto da
   bala sai como se ele estivesse em primeira pessoa" — o traçado nascia do cano
   fantasma do viewmodel (raio câmera→boca), com a câmera ATRÁS do personagem, em
   vez de sair da arma visível na mão do modelo.

   O QUE ELA MEDE (bootGame real, sem browser):
     T1 · camView third: a origem do traçado fica a <1,5 m da arma do corpo (arma-glb
          ou arma-caixa do playerTP) — e NÃO colada na câmera, que está ~1,7 m atrás;
     T2 · camView first: o caminho do viewmodel segue valendo (origem perto da câmera).

   Mutante: `--mutante=fp` força o ramo de 1ª pessoa sempre e tem que reprovar o T1.
   Uso: node tools/eval/tracer-3p-check.mjs [--mutante=fp]
   ═══════════════════════════════════════════════════════════════════════════════════ */
import { bootGame, initTextures } from './harness.mjs';

const MUT = (process.argv.find((a) => a.startsWith('--mutante=')) || '').split('=')[1] || '';
const g = bootGame('praca_poderes', { textures: initTextures(), bots: 2 });
g.state = 'live';   // bootGame entrega countdown; o gatilho só vive em live
if (MUT === 'fp') {
  const orig = g._fireHitscan;
  g._fireHitscan = function (...a) { const cv = this.camView; this.camView = 'first'; try { return orig.apply(this, a); } finally { this.camView = cv; } };
}

const falhas = [];
const cobra = (cond, cod, txt, det) => { console.log(`${cod} · ${txt}\n   ${det}\n   ${cond ? 'PASSA' : 'FALHA'}`); if (!cond) falhas.push(cod); };
const alvo = g.bots.find((b) => b.alive && b.team !== g.playerTeam);
if (alvo) alvo.alive = false;   // tira o bot do raycast: o fim do traçado é a parede/limite

const cap = [];
const origTracer = g._tracer.bind(g);
g._tracer = (a, b) => { cap.push({ a: a.clone(), b: b.clone() }); };

const atira = () => {
  g.player.ammo[g.player.weapon].mag = 5;
  g.player.nextShotAt = 0; g.player.reloadUntil = 0;
  cap.length = 0;
  g._tryShoot();
  return cap[0] || null;
};

for (const [modo, cod, esperado] of [['third', 'T1', 'corpo'], ['first', 'T2', 'camera']]) {
  g.setCamView(modo);
  if (modo !== 'first') g._ensurePlayerTP();
  const t = atira();
  if (!t) { cobra(false, cod, `traçado disparado em ${modo}`, 'nenhum _tracer capturado'); continue; }
  const cam = g.camera.getWorldPosition(cap[0].a.constructor !== Object ? new (t.a.constructor)() : t.a).copy(t.a).set(0, 0, 0);
  g.camera.getWorldPosition(cam);
  const dCam = t.a.distanceTo(cam);
  if (esperado === 'corpo') {
    const gun = g.playerTP?.group && (g.playerTP.group.getObjectByName('arma-glb') || g.playerTP.group.getObjectByName('arma-caixa'));
    const gunPos = gun ? gun.getWorldPosition(new (t.a.constructor)()) : null;
    cobra(!!gunPos && t.a.distanceTo(gunPos) < 1.5, cod, `${modo}: origem do traçado na arma do corpo`,
      gunPos ? `origem→arma ${t.a.distanceTo(gunPos).toFixed(2)} m (teto 1,5) · origem→câmera ${dCam.toFixed(2)} m` : 'arma do corpo não encontrada no playerTP');
  } else {
    cobra(dCam < 2.5, cod, `${modo}: origem do traçado no viewmodel (perto da câmera)`,
      `origem→câmera ${dCam.toFixed(2)} m (teto 2,5)`);
  }
}

console.log(falhas.length ? `\nVERMELHO — ${falhas.join(', ')}` : '\nVERDE');
if (MUT && !falhas.length) { console.error('\n✗ mutante passou: a régua não morde'); process.exit(1); }
if (falhas.length) process.exit(1);
