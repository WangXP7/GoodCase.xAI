/* ════════════════════════════════════════════════════════════════════════════
   断裂桥梁 · 列车脱轨坠水 —— 端到端验收
   用法：node tools/verify.js          （需要 playwright + chromium）

   断言四项：
     1. 控制台零错误
     2. 叙事链完整：首次失效 → 渐进断裂 → 溅水 → 5/5 落水 → 5/5 沉没
     3. 交互可用：暂停 / 慢动作 / 重置 / 车速 / 点击剪断杆件
     4. 渲染朝向正确：渲染车体与车轮的位置必须等于物理位置（防镜像回归）
   ════════════════════════════════════════════════════════════════════════════ */
const { chromium } = require('playwright');
const path = require('path');

const FILE = 'file:///' + path.resolve(__dirname, '../index.html').replace(/\\/g, '/');
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(700);

  /* ── 1. 快进推演叙事链（不渲染，秒级拿到完整轨迹） ── */
  const nar = await page.evaluate(() => {
    initSim(); setTrainVelocity();
    const h = CFG.DT / CFG.SUB;
    const ev = { firstBreak: null, breakSeq: [], splash: -1, wetAt: [], sunkAt: [], sunk5: -1, wet5: -1,
                 rideKick: 0, rideKickAt: -1, kickUp: 0, kickUpAt: -1 };
    const comVy = car => car.c.reduce((a, p) => a + (p.y - p.py), 0) / 4 / h;   // >0 = 向下
    for (let f = 1; f <= 1500; f++) {
      step(CFG.DT);
      if (f % 15 === 0) ev.breakSeq.push(S.broke);
      const wet = S.cars.filter(c => c.wet).length, sunk = S.cars.filter(c => c.sunk).length;
      if (wet > 0 && ev.wetAt.length === 0) ev.wetAt.push(+S.t.toFixed(2));
      if (wet === 5 && ev.wet5 < 0) ev.wet5 = +S.t.toFixed(2);
      if (sunk === 5 && ev.sunk5 < 0) ev.sunk5 = +S.t.toFixed(2);
      // 弹射判据：车厢质心的"向上速度"（px/s）。合法运动只有坠落（向下），
      // 向上速度只可能来自结构回弹/堆挤；病态的数值弹射会达到数百 px/s。
      // 行驶阶段（首次失效前）应近乎为零——曾因轨面 2px 台阶达到 470 px/s（伪弹跳）。
      for (const car of S.cars) {
        const uy = -comVy(car);
        if (S.broke === 0 && uy > ev.rideKick) { ev.rideKick = uy; ev.rideKickAt = +S.t.toFixed(2); }
        if (uy > ev.kickUp) { ev.kickUp = uy; ev.kickUpAt = +S.t.toFixed(2); }
      }
    }
    if (S.firstSplash >= 0) ev.splash = +S.firstSplash.toFixed(2);
    ev.firstBreak = S.firstBreak;
    ev.broke = S.broke; ev.total = S.total;
    return ev;
  });

  check('首次失效发生在损伤杆件且超限（拉压按绝对值判定）',
    !!nar.firstBreak && nar.firstBreak.dmg && Math.abs(nar.firstBreak.util) > 1,
    JSON.stringify(nar.firstBreak));
  check('首次失效位于中跨（X0..X1 内）',
    !!nar.firstBreak && nar.firstBreak.x > 300 && nar.firstBreak.x < 1300,
    'x=' + (nar.firstBreak && nar.firstBreak.x));
  const seq = nar.breakSeq;
  check('断裂数为单调递增（失效不可逆）', seq.every((v, i) => i === 0 || v >= seq[i - 1]), '序列 ' + seq.join(','));
  check('断裂是渐进过程而非单帧全灭',
    seq.filter(v => v > 0).length >= 3 && seq[seq.length - 1] < nar.total,
    `最终 ${seq[seq.length - 1]}/${nar.total}（未整体湮灭）`);
  check('产生溅水事件', nar.splash > 0, 'firstSplash=' + nar.splash + 's');
  check('5/5 车厢全部落水', nar.wet5 > 0, 't=' + nar.wet5 + 's');
  check('5/5 车厢全部沉没', nar.sunk5 > 0, 't=' + nar.sunk5 + 's');
  check('行驶阶段无伪弹跳（向上速度 < 30 px/s）', nar.rideKick < 30,
    `峰值 ${nar.rideKick.toFixed(1)} px/s @ t=${nar.rideKickAt}s`);
  check('崩溃/入水阶段无数值弹射（向上速度 < 200 px/s）', nar.kickUp < 200,
    `峰值 ${nar.kickUp.toFixed(1)} px/s @ t=${nar.kickUpAt}s（堆挤回弹属真实物理）`);

  /* ── 2. 渲染朝向：镜像类 bug 的回归断言 ── */
  const orient = await page.evaluate(() => {
    initSim(); setTrainVelocity();
    for (let i = 0; i < 60; i++) step(CFG.DT);
    const car = S.cars[1], p0 = car.c[0], p1 = car.c[1], p2 = car.c[2];
    let fx = p1.x - p0.x, fy = p1.y - p0.y;
    const L = Math.hypot(fx, fy); fx /= L; fy /= L;
    // 与 index.html 中 drawTrain 完全一致的变换与 wheelLocal
    const M = (lx, ly) => ({ x: p0.x + fx * lx - fy * ly, y: p0.y + fy * lx + fx * ly });
    const wl = w => ({ lx: (w.x - p0.x) * fx + (w.y - p0.y) * fy, ly: (w.y - p0.y) * fx - (w.x - p0.x) * fy });
    const drawnTop = M(0, -car.H).y;
    const drawnWheels = car.wheels.map(w => { const l = wl(w); return M(l.lx, l.ly).y; });
    const up = M(0, 10).y < M(0, -10).y;             // 局部 +y 应指向屏幕上方
    return { drawnTop, physTop: p2.y, drawnWheels, physWheels: car.wheels.map(w => w.y), up };
  });
  check('渲染车体顶边 = 物理顶边', Math.abs(orient.drawnTop - orient.physTop) < 0.5,
    `渲染 ${orient.drawnTop.toFixed(2)} / 物理 ${orient.physTop.toFixed(2)}`);
  check('渲染车轮位置 = 物理车轮位置',
    orient.drawnWheels.every((v, i) => Math.abs(v - orient.physWheels[i]) < 0.5),
    `渲染 [${orient.drawnWheels.map(v => v.toFixed(0))}] / 物理 [${orient.physWheels.map(v => v.toFixed(0))}]`);

  /* ── 3. 交互 ── */
  await page.evaluate(() => { initSim(); setTrainVelocity(); });
  await page.keyboard.press(' ');
  await page.waitForTimeout(250);
  const paused = await page.evaluate(() => S.run === false);
  await page.keyboard.press(' ');
  await page.keyboard.press('s');
  await page.waitForTimeout(200);
  const slow = await page.evaluate(() => S.slow === true);
  await page.keyboard.press('s');
  await page.click('#b-stress');
  const stressOff = await page.evaluate(() => S.stress === false);
  await page.click('#b-stress');
  await page.evaluate(() => { const r = document.getElementById('r-v'); r.value = '18'; r.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(200);
  const spd = await page.evaluate(() => Math.round(S.targetV / CFG.PPM));
  check('空格暂停 / 播放', paused, 'S.run=' + paused);
  check('S 切换慢动作', slow, 'S.slow=' + slow);
  check('应力着色开关', stressOff, 'S.stress 可关');
  check('车速滑块生效', spd === 18, 'targetV → ' + spd + ' m/s');

  /* ── 4. 点击杆件剪断 → 邻杆超载 ── */
  const click = await page.evaluate(() => {
    initSim(); setTrainVelocity();
    S.collapseT = 0;                                  // 冻结相机分支，便于换算屏幕坐标
    const before = S.broke;
    const t = S.bridge.top[12];
    const pt = { x: t.x, y: t.y };
    const s = Math.max(VW / CFG.WW, VH / CFG.WH) * S.cam.z;
    const vw = VW / s, vh = VH / s;
    const cx = vw >= CFG.WW ? CFG.WW / 2 : Math.max(vw / 2, Math.min(S.cam.x, CFG.WW - vw / 2));
    const cy = vh >= CFG.WH ? CFG.WH / 2 : Math.max(vh / 2, Math.min(S.cam.y, CFG.WH - vh / 2));
    return { sx: (pt.x - cx) * s + VW / 2, sy: (pt.y - cy) * s + VH / 2, before };
  });
  await page.mouse.click(click.sx, click.sy);
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({ broke: S.broke, umax: Math.max(0, ...S.C.filter(c => !c.broken && isFinite(c.cap) && c.brk).map(c => Math.abs(c.util || 0))) }));
  check('点击杆件可剪断并引起邻杆超载', after.broke > click.before && after.umax > 1,
    `断裂 ${click.before} → ${after.broke}，邻杆峰值利用率 ${after.umax.toFixed(2)}`);

  await page.keyboard.press('r');
  await page.waitForTimeout(300);
  const reset = await page.evaluate(() => ({ t: S.t, broke: S.broke }));
  check('R 重置干净', reset.broke === 0 && reset.t < 1.2, JSON.stringify(reset));

  check('控制台零错误', errs.length === 0, errs.slice(0, 4).join(' | '));

  /* ── 输出 ── */
  console.log('\n═══ 断裂桥梁 · 列车脱轨坠水 端到端验收 ═══\n');
  let pass = 0;
  for (const r of results) {
    console.log(`${r.ok ? '✔' : '✘'} ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
    if (r.ok) pass++;
  }
  console.log(`\n${pass}/${results.length} 通过`);
  console.log(`叙事：首次失效 t=${nar.firstBreak && nar.firstBreak.t}s → 溅水 ${nar.splash}s → 全部落水 ${nar.wet5}s → 全部沉没 ${nar.sunk5}s\n`);
  await browser.close();
  process.exit(pass === results.length ? 0 : 1);
})();
