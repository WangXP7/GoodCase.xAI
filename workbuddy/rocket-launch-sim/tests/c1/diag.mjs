/**
 * 诊断：固定 g₀=6 / H=15km，扫描飞行程序（hTurn 比例 × 幂律 p × 燃料 × 燃时）
 * 目的：找出"为什么 0 组入轨"——是推力不足、燃料不够，还是制导形状不对。
 */

import { fly, makeBody, makeRocket, rocketDV } from './sim.mjs';
import { Regime } from './orbit-solver.ref.mjs';

const line = (s = '') => console.log(s);
const R = 300000;
const Hkm = 15, H = Hkm * 1000;

const g0 = 6;
const body = makeBody(R, g0);
const atm = { rho0: 1.2, H: 2500, top: H * 0.8 };
const vc = Math.sqrt(body.mu / (R + H));

line('════════════════════════════════════════════════════════════════');
line(`  诊断 · g₀=${g0}  H=${Hkm}km  v_c=${vc.toFixed(0)} m/s  逃逸速度=${(Math.SQRT2 * vc).toFixed(0)} m/s`);
line('════════════════════════════════════════════════════════════════');
line('');
line('  ── 先看：不同燃料/燃时下，火箭关机时能达到什么状态 ──');
line('');
line(`  ${'燃x'.padStart(4)} ${'时x'.padStart(4)} ${'Δv'.padStart(6)} ${'TWR'.padStart(6)} ${'关机高度km'.padStart(10)} ${'关机速度'.padStart(9)} ${'弹道倾角°'.padStart(9)} ${'近地点km'.padStart(9)} ${'远地点km'.padStart(10)} ${'状态'.padStart(12)}`);
line('  ' + '─'.repeat(96));

for (const fs of [0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
  for (const bs of [1.0, 1.5, 2.0, 2.5]) {
    const rk = makeRocket({});
    const dv = rocketDV(rk, fs);
    const prog = { hStart: H * 0.01, hTurn: H * 0.25, p: 0.5 };
    const r = fly(body, atm, rk, prog, fs, bs);
    const apo = Number.isFinite(r.apo) ? (r.apo / 1000).toFixed(1) : '∞';
    line(`  ${String(fs).padStart(4)} ${String(bs).padStart(4)} ${dv.toFixed(0).padStart(6)} ${r.twr0.toFixed(2).padStart(6)} ${(r.hEnd / 1000).toFixed(1).padStart(10)} ${r.vEnd.toFixed(0).padStart(9)} ${(r.gammaEnd ?? 0).toFixed(1).padStart(9)} ${(r.peri / 1000).toFixed(1).padStart(9)} ${apo.padStart(10)} ${(r.dead ?? r.regime).padStart(12)}`);
  }
}

line('');
line('  ── 再扫：制导形状（hTurn 占 H 的比例 × 幂律 p），固定 燃x0.7/时x2.0 ──');
line('');
line(`  ${'hTurn%'.padStart(7)} ${'p'.padStart(5)} ${'关机高度km'.padStart(10)} ${'关机速度'.padStart(9)} ${'倾角°'.padStart(7)} ${'近地点km'.padStart(9)} ${'远地点km'.padStart(10)} ${'动压kPa'.padStart(8)} ${'时长s'.padStart(6)} ${'状态'.padStart(12)}`);
line('  ' + '─'.repeat(96));

const hits = [];
for (const ht of [0.15, 0.3, 0.5, 0.7, 0.9, 1.1]) {
  for (const p of [0.3, 0.5, 0.7, 1.0, 1.5, 2.0]) {
    const rk = makeRocket({});
    const prog = { hStart: H * 0.01, hTurn: H * ht, p };
    const r = fly(body, atm, rk, prog, 0.7, 2.0);
    const okOrbit = (r.regime === Regime.ELLIPTIC || r.regime === Regime.CIRCULAR) && r.peri >= H * 0.9 && Number.isFinite(r.apo);
    if (okOrbit) hits.push({ ht, p, r });
    const apo = Number.isFinite(r.apo) ? (r.apo / 1000).toFixed(1) : '∞';
    line(`  ${String(ht * 100).padStart(7)} ${String(p).padStart(5)} ${(r.hEnd / 1000).toFixed(1).padStart(10)} ${r.vEnd.toFixed(0).padStart(9)} ${(r.gammaEnd ?? 0).toFixed(1).padStart(7)} ${(r.peri / 1000).toFixed(1).padStart(9)} ${apo.padStart(10)} ${(r.maxQ / 1000).toFixed(1).padStart(8)} ${r.t.toFixed(1).padStart(6)} ${(okOrbit ? '✅入轨' : (r.dead ?? r.regime)).padStart(12)}`);
  }
}

line('');
if (hits.length > 0) {
  line(`  🎯 找到 ${hits.length} 组入轨解！`);
  for (const h of hits.slice(0, 5)) {
    line(`     hTurn=${h.ht * 100}%  p=${h.p}  → 近地点 ${(h.r.peri / 1000).toFixed(1)}km  远地点 ${(h.r.apo / 1000).toFixed(1)}km  时长 ${h.r.t.toFixed(1)}s  动压 ${(h.r.maxQ / 1000).toFixed(1)}kPa  TWR ${h.r.twr0.toFixed(2)}`);
  }
} else {
  line('  ❌ 该 (燃x,时x) 组合下无入轨解');
}
