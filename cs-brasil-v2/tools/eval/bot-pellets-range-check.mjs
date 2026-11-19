import { Game, THREE } from './harness.mjs';
const original = Math.random;
const seed = valor => { let n = valor >>> 0; return () => { n = (1664525 * n + 1013904223) >>> 0; return n / 4294967296; }; };
console.log('skill,metros,legado_dano_por_cartucho,pellets_dano_por_cartucho,pellets_cartuchos_com_acerto');
let falhas = 0;
try {
  for (const skill of [.6, 1, 1.5]) for (const metros of [6, 12, 24, 40]) {
    const somas = [0, 0]; let acertos = 0;
    for (let amostra = 0; amostra < 400; amostra++) for (const [modo, legado] of [[0, true], [1, false]]) {
      Math.random = seed(973000 + amostra);
      const g = Object.create(Game.prototype), alvo = { alive: true, team: 'B', pos: new THREE.Vector3(0, 0, -metros) };
      g.player = { alive: false }; g.bots = [alvo]; g.time = 10; g.ray = new THREE.Raycaster(); g.world = { occluders: [] };
      let dano = 0; g._damage = (_, valor) => { dano += valor; };
      for (const k of ['_tracer', '_flash', '_fleshImpact', '_bloodSpatter', '_noteHit', '_puff']) g[k] = () => {};
      if (legado) g._dispararBot = function (b, from, dir, W) {
        return this._resolverTiroBot(b, from, dir, { ...W, dmg: W.dmg * Math.min(W.pellets, 6) * .55 });
      };
      g._botShootNN({ pos: new THREE.Vector3(), team: 'E', weapon: 'shotgun', mag: 8, skill, mesh: { isGLB: false } }, alvo);
      somas[modo] += dano;
      if (!legado && dano > 0) acertos++;
      if (!Number.isFinite(dano) || dano < 0 || dano > 46) falhas++;
    }
    console.log([skill, metros, ...(somas.map(s => (s / 400).toFixed(3))), `${acertos}/400`].join(','));
  }
} finally { Math.random = original; }
if (falhas) console.error(`FALHA ${falhas} cartuchos excederam o orçamento sem headshot ou produziram dano inválido`);
process.exitCode = falhas ? 1 : 0;
