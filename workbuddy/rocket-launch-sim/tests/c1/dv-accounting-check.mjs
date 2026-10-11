/**
 * P2-DES-001 · Δv 记账公式自检
 * 验证 S1 §3.2-⑥ 的分段公式与 S3 §3.3 的「分离后质量恒等式」
 * （同时作为 C16 —— 参考实现分离时未扣一级余油 —— 的回归测试）
 */
const ISP = 2900;
const PAYLOAD = 8500, S1D = 7000, S1F = 18900, S2D = 3500, S2F = 4500;
const M0 = PAYLOAD + S1D + S1F + S2D + S2F;              // 42400
const M_AFTER_S1 = S1D + S2D + S2F + PAYLOAD;            // 23500
const M_S2_START = S2D + S2F + PAYLOAD;                  // 16500
const M_DRY = S2D + PAYLOAD;                             // 12000
const MDOT1 = S1F / 60;                                  // 315 kg/s
const DV_TOTAL = ISP * Math.log(M0 / M_AFTER_S1) + ISP * Math.log(M_S2_START / M_DRY);

/** 本 GDD 的公式 */
function dvRemain(t, staged, tSep) {
  if (!staged) {
    const m = M0 - MDOT1 * t;
    return ISP * Math.log(m / M_AFTER_S1) + ISP * Math.log(M_S2_START / M_DRY);
  }
  const m = M_S2_START - (S2F / 21) * (t - tSep);
  return ISP * Math.log(Math.max(m, M_DRY) / M_DRY);
}

/** C16：参考实现的错误写法（只扣 s1.dry） */
function dvRemain_BUGGY(t, staged, tSep) {
  if (!staged) return dvRemain(t, false, tSep);
  const mAtSep = M0 - MDOT1 * tSep;
  const mAfter = mAtSep - S1D;                    // ← 漏扣 fuel1
  const m = mAfter - (S2F / 21) * (t - tSep);
  return ISP * Math.log(m / M_DRY);
}

const line = (s = '') => console.log(s);
const pad = (x, n) => String(x).padStart(n);

line(`\n  Δv 总量 = ${DV_TOTAL.toFixed(1)} m/s   （RT-1 标定值 2635）`);
line(`  常量：M0=${M0}  M_AFTER_S1=${M_AFTER_S1}  M_S2_START=${M_S2_START}  M_DRY=${M_DRY}\n`);

line('  ── 1. 分段公式自洽性（一级段，未分离）──');
line('  ' + 'T+s'.padStart(6) + pad('m (kg)', 10) + pad('dvRemain', 11) + pad('校验', 26));
line('  ' + '─'.repeat(56));
for (const t of [0, 10, 30, 50, 60]) {
  const m = M0 - MDOT1 * t;
  const dv = dvRemain(t, false, 0);
  line('  ' + pad(t.toFixed(0), 6) + pad(m.toFixed(0), 10) + pad(dv.toFixed(1), 11) + '  ' +
    (t === 0 ? `= DV_TOTAL ${Math.abs(dv - DV_TOTAL) < 0.5 ? '✅' : '❌'}` : ''));
}

line('\n  ── 2. 分离连续性（正好燃尽分离 T+60）──');
const before = dvRemain(60, false, 0);
const after = dvRemain(60, true, 60);
line(`  分离前 ${before.toFixed(1)} m/s   分离后 ${after.toFixed(1)} m/s   跳变 ${(after - before).toFixed(3)} m/s  ${Math.abs(after - before) < 1 ? '✅ 连续' : '❌'}`);

line('\n  ── 3. 分离后质量恒等式（S3 §3.3）—— 任意时刻分离，m_after 恒为 16500 ──');
line('  ' + '分离T+'.padStart(8) + pad('fuel1余', 10) + pad('m_before', 11) + pad('m_after', 10) + pad('dvWasted', 11) + pad('dvRemain后', 12) + pad('BUG版dv', 11));
line('  ' + '─'.repeat(76));
for (const tSep of [1, 20, 40, 50, 55, 60]) {
  const fuel1 = S1F - MDOT1 * tSep;
  const mBefore = M0 - MDOT1 * tSep;
  const mAfter = mBefore - S1D - fuel1;
  const dvWasted = ISP * Math.log(mBefore / M_AFTER_S1);
  const dvAfter = dvRemain(tSep, true, tSep);
  const dvBug = dvRemain_BUGGY(tSep, true, tSep);
  const ok = Math.abs(mAfter - M_S2_START) < 1;
  line('  ' + pad(tSep.toFixed(0), 8) + pad(fuel1.toFixed(0), 10) + pad(mBefore.toFixed(0), 11) +
    pad(mAfter.toFixed(0) + (ok ? '✅' : '❌'), 10) + pad(dvWasted.toFixed(0), 11) +
    pad(dvAfter.toFixed(0), 12) + pad(dvBug.toFixed(0) + (dvBug > DV_TOTAL ? '❌' : ''), 11));
}

line('\n  ── 4. C16 回归：BUG 版 Δv 余量是否超过物理上限 ──');
const worstBug = Math.max(...[1, 20, 40, 55].map((t) => dvRemain_BUGGY(t, true, t)));
line(`  BUG 版最大 Δv 余量 = ${worstBug.toFixed(0)} m/s   物理上限 DV_TOTAL = ${DV_TOTAL.toFixed(0)} m/s   ${worstBug > DV_TOTAL ? '❌ 超出物理上限 —— 必须修' : '✅'}`);
line(`  本 GDD 版最大 Δv 余量 = ${Math.max(...[1, 20, 40, 55].map((t) => dvRemain(t, true, t))).toFixed(0)} m/s  ${Math.max(...[1, 20, 40, 55].map((t) => dvRemain(t, true, t))) <= DV_TOTAL ? '✅' : '❌'}`);
line('');
