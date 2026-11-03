import { createRequire } from 'node:module';
const require = createRequire('C:/Users/wxppa/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:8123';
const pass = [], fail = [];
const ck = (name, cond, extra = '') => (cond ? pass : fail).push(name + (extra ? ` (${extra})` : ''));

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--disable-quic'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message.slice(0, 160)));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 160)); });
page.on('response', r => { if (r.status() >= 400) errors.push(`http${r.status()}: ${r.url()}`); });

await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__rift, null, { timeout: 30000 });

// ---------- 1. 初始状态 ----------
const init = await page.evaluate(() => {
  const S = window.__rift.state();
  return {
    gold: S.gold, heroes: S.heroes.filter(h => h.owned).length, team: S.team.length,
    stage: S.game, target: S.target, towerMax: S.towerMax, items: Object.keys(S.items).length,
    runes: Object.keys(S.runes).length, gps: window.__rift.stats().dps,
  };
});
ck('初始金币为 0', init.gold === 0, String(init.gold));
ck('初始 1 位英雄且已上阵', init.heroes === 1 && init.team === 1);
ck('初始第 1 局第 1 个目标', init.stage === 1 && init.target === 0);
ck('初始塔有血量', init.towerMax > 0, String(init.towerMax));
ck('6 件装备 / 6 枚符文', init.items === 6 && init.runes === 6);

// ---------- 2. 画布尺寸 ----------
const cv = await page.evaluate(() => {
  const c = document.getElementById('stage'), r = c.getBoundingClientRect();
  return { cw: c.width, ch: c.height, rw: Math.round(r.width), rh: Math.round(r.height), dpr: window.devicePixelRatio };
});
ck('画布按 DPR 铺满容器', Math.abs(cv.cw - cv.rw * Math.min(2, cv.dpr)) <= 2 && cv.rh > 150, JSON.stringify(cv));

// ---------- 3. 自动战斗：金币与塔血变化 ----------
const before = await page.evaluate(() => ({ gold: window.__rift.gold(), hp: window.__rift.stage().hp }));
await page.evaluate(() => window.__rift.tick(200));   // 10 秒
const after = await page.evaluate(() => ({
  gold: window.__rift.gold(), hp: window.__rift.stage().hp,
  stage: window.__rift.stage(),
}));
ck('10 秒后金币增长', after.gold > before.gold, `${before.gold} → ${after.gold}`);
ck('10 秒后塔血下降或已推进', after.hp < before.hp || after.stage.target > 0, `hp ${before.hp} → ${Math.round(after.hp)}`);

// ---------- 4. 升级 / 装备 / 符文 ----------
const ups = await page.evaluate(() => {
  const R = window.__rift, S = R.state();
  S.gold = 100000;
  const d0 = R.stats().dps, lv0 = S.heroes[0].lvl, c0 = R.cost.hero(S.heroes[0].id);
  const okHero = R.buy.hero(S.heroes[0].id);
  const lv1 = S.heroes[0].lvl, d1 = R.stats().dps, c1 = R.cost.hero(S.heroes[0].id);
  const okItem = R.buy.item('doran');
  const itemLv = S.items.doran, d2 = R.stats().dps;
  const okRune = R.buy.rune('precision');
  const d3 = R.stats().dps;
  const okRune2 = R.buy.rune('precision');
  return { okHero, lv0, lv1, d0, d1, d2, d3, c0, c1, okItem, itemLv, okRune, okRune2, rune: S.runes.precision };
});
ck('升级英雄：等级 +1', ups.okHero && ups.lv1 === ups.lv0 + 1, `${ups.lv0} → ${ups.lv1}`);
ck('升级后 DPS 提升', ups.d1 > ups.d0, `${Math.round(ups.d0)} → ${Math.round(ups.d1)}`);
ck('升级成本递增', ups.c1 > ups.c0, `${ups.c0} → ${ups.c1}`);
ck('购买装备：等级 +1 且 DPS 提升', ups.okItem && ups.itemLv === 1 && ups.d2 > ups.d1);
ck('购买符文：生效且 DPS 提升', ups.okRune && ups.rune === true && ups.d3 > ups.d2);
ck('重复购买符文被拒绝', ups.okRune2 === false);

// ---------- 5. 招募与上阵 ----------
const rec = await page.evaluate(() => {
  const R = window.__rift, S = R.state();
  S.gold = 1e6;
  const id = S.heroes.find(h => !h.owned).id;
  const cost = R.cost.hero(id);
  const g0 = S.gold;
  R.recruit(id);
  const owned = S.heroes.find(h => h.id === id).owned;
  const inTeam = S.team.includes(id);
  return { id, cost, spent: g0 - S.gold, owned, inTeam, teamLen: S.team.length, member: S.team[0] };
});
ck('招募扣除金币', Math.abs(rec.spent - rec.cost) <= 1, `${rec.cost} vs ${rec.spent}`);
ck('招募后拥有并自动上阵', rec.owned && rec.inTeam && rec.teamLen === 2);

// ---------- 6. 一键成长 ----------
const auto = await page.evaluate(() => {
  const R = window.__rift, S = R.state();
  S.gold = 50000;
  const before = { lv: S.heroes.reduce((a, h) => a + h.lvl, 0), items: Object.values(S.items).reduce((a, b) => a + b, 0) };
  R.buy.auto();
  const after = { lv: S.heroes.reduce((a, h) => a + h.lvl, 0), items: Object.values(S.items).reduce((a, b) => a + b, 0), gold: S.gold };
  return { before, after };
});
ck('一键成长提升了等级/装备', auto.after.lv > auto.before.lv || auto.after.items > auto.before.items,
  `lv ${auto.before.lv}→${auto.after.lv}, item ${auto.before.items}→${auto.after.items}`);
ck('一键成长花掉了金币', auto.after.gold < 50000, String(auto.after.gold));

// ---------- 7. 拆塔推进与段位 ----------
const prog = await page.evaluate(() => {
  const R = window.__rift, S = R.state();
  S.gold = 1e7;
  const start = { game: S.game, target: S.target, stars: S.stars };
  for (let i = 0; i < 40; i++) { R.tick(20); R.buy.auto(); }
  return { start, now: { game: S.game, target: S.target, stars: S.stars, towers: S.towersDown } };
});
ck('持续战斗推进了目标/局数', prog.now.game > prog.start.game || prog.now.target > prog.start.target,
  JSON.stringify(prog.now));
ck('拆塔计数增长', prog.now.towers > 0, String(prog.now.towers));
ck('段位星数随局数增长', prog.now.stars > prog.start.stars, `${prog.start.stars} → ${prog.now.stars}`);

// ---------- 8. 存档与刷新恢复 ----------
const saved = await page.evaluate(() => {
  const R = window.__rift, S = R.state();
  S.gold = 123456;
  R.save();
  return JSON.parse(localStorage.getItem('rift-idle-save-v1')).gold;
});
ck('存档写入 localStorage', saved === 123456, String(saved));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__rift);
const restored = await page.evaluate(() => ({ gold: window.__rift.state().gold, towers: window.__rift.state().towersDown }));
ck('刷新后状态恢复', restored.gold >= 123456 && restored.towers > 0, JSON.stringify(restored));

// ---------- 9. 离线收益（新上下文预置存档，避免 beforeunload 覆盖） ----------
const octx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
await octx.addInitScript(() => {
  const seed = {
    v: 1, gold: 0, glory: 0, game: 1, target: 0, stars: 0, wave: 0, waveT: 0,
    heroes: [{ id: 'garen', lvl: 5, star: 1, owned: true }], team: ['garen'],
    items: { doran: 0, ie: 0, rage: 0, bt: 0, trin: 0, guard: 0 },
    runes: { precision: false, domination: false, sorcery: false, resolve: false, inspire: false, conqueror: false },
    best: 1, time: 0, kills: 0, towersDown: 0, gps: 1000,
    lastSave: Date.now() - 3600 * 1000,
  };
  localStorage.setItem('rift-idle-save-v1', JSON.stringify(seed));
});
const op = await octx.newPage();
await op.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
await op.waitForFunction(() => !!window.__rift);
await op.waitForTimeout(700);
const offline = await op.evaluate(() => ({
  gold: window.__rift.state().gold,
  hasLog: window.__rift.state().log.some(l => /离线/.test(l.text)),
}));
await octx.close();
ck('离线 1 小时按 60% 结算', Math.abs(offline.gold - 1000 * 3600 * 0.6) < 3000, String(Math.round(offline.gold)));
ck('离线收益写入战报', offline.hasLog);

// ---------- 10. 受击掉血与复活 ----------
const wipe = await page.evaluate(async () => {
  const R = window.__rift;
  const S = R.state();
  // 塔攻击应造成掉血
  S.teamHp = S.hpMax * 0.8;
  const hp0 = S.teamHp;
  const hits0 = S.taken;
  for (let i = 0; i < 8; i++) R.tick(10);
  const hp1 = S.teamHp;
  const hits1 = S.taken;
  // 直接进入阵亡态，验证 3 秒复活
  S.dead = 1.0;
  S.teamHp = 0;
  for (let i = 0; i < 60; i++) R.tick(10);
  return { hp0, hp1, hits0, hits1, dead: S.dead, hpAfter: S.teamHp, max: S.hpMax };
});
ck('防御塔每 1.5 秒反击一次', wipe.hits1 - wipe.hits0 >= 2, `承伤 ${wipe.hits1 - wipe.hits0} 次`);
ck('承伤后血量不超过上限', wipe.hp1 <= wipe.max, `${wipe.hp1.toFixed(2)} / ${wipe.max}`);
ck('阵亡后 3 秒复活并回满', wipe.dead === 0 && Math.abs(wipe.hpAfter - wipe.max) < 0.01, JSON.stringify(wipe));

// ---------- 11. 转生 ----------
const rb = await page.evaluate(() => {
  const R = window.__rift, S = R.state();
  S.stars = 9; S.game = 19; S.gold = 5000;
  const gain = R.rebirthGain();
  return { gain, gated: R.rebirthGain() };
});
ck('转生收益按星数计算', rb.gain > 0, String(rb.gain));
await page.evaluate(() => window.__rift.state().stars = 9);
await page.click('#btnRebirth');
await page.waitForTimeout(200);
const modalOpen = await page.evaluate(() => document.getElementById('modalRebirth').classList.contains('open'));
ck('转生弹窗可打开', modalOpen);
const afterRb = await page.evaluate(() => {
  document.getElementById('btnDoRebirth').click();
  const S = window.__rift.state();
  return { glory: S.glory, game: S.game, stars: S.stars, gold: S.gold, team: S.team.length, heroes: S.heroes.filter(h => h.owned).length };
});
ck('转生后获得荣耀点', afterRb.glory > 0, String(afterRb.glory));
ck('转生后局数/星级/金币重置', afterRb.game === 1 && afterRb.stars === 0 && afterRb.gold === 0, JSON.stringify(afterRb));
ck('转生后保留英雄与阵容', afterRb.heroes >= 2 && afterRb.team >= 1, JSON.stringify(afterRb));

// ---------- 12. 招募面板 UI ----------
await page.evaluate(() => window.__rift.state().gold = 1e6);
await page.click('#btnSummon');
await page.waitForTimeout(300);
const summonUi = await page.evaluate(() => ({
  open: document.getElementById('modalSummon').classList.contains('open'),
  cards: document.querySelectorAll('#summonGrid .pcard').length,
  btn: document.querySelectorAll('#summonGrid button').length,
}));
ck('招募面板 15 张英雄卡', summonUi.open && summonUi.cards === 15 && summonUi.btn === 15, JSON.stringify(summonUi));
await page.keyboard.press('Escape').catch(() => {});
await page.evaluate(() => document.querySelector('#modalSummon .x').click());
await page.waitForTimeout(200);

// ---------- 13. 主界面渲染完整性 ----------
const dom = await page.evaluate(() => ({
  team: document.querySelectorAll('#teamList .hero').length,
  items: document.querySelectorAll('#itemList .item').length,
  runes: document.querySelectorAll('#runeList .rune').length,
  log: document.querySelectorAll('#log div').length,
  gold: document.getElementById('uiGold').textContent,
  rank: document.getElementById('rankName').textContent,
  overflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
}));
ck('三栏面板齐全', dom.team >= 1 && dom.items === 6 && dom.runes === 6, JSON.stringify(dom));
ck('战报有内容', dom.log > 0, String(dom.log));
ck('桌面端无横向溢出', dom.overflow);

// ---------- 14. 移动端 ----------
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const mp = await mctx.newPage();
const merr = [];
mp.on('pageerror', e => merr.push(e.message.slice(0, 120)));
await mp.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
await mp.waitForFunction(() => !!window.__rift);
await mp.waitForTimeout(1200);
const mob = await mp.evaluate(() => ({
  overflow: document.documentElement.scrollWidth,
  inner: window.innerWidth,
  canvas: document.getElementById('stage').getBoundingClientRect().height,
  font: parseFloat(getComputedStyle(document.body).fontSize),
}));
ck('手机端无横向溢出', mob.overflow <= mob.inner + 1, `${mob.overflow} / ${mob.inner}`);
ck('手机端战场高度合理', mob.canvas >= 200, String(Math.round(mob.canvas)));
ck('手机端无 JS 报错', merr.length === 0, merr[0] || '');

ck('全程零真实报错', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
console.log(`\n=== ${pass.length}/${pass.length + fail.length} PASS ===`);
pass.forEach(p => console.log('  ok   ' + p));
fail.forEach(f => console.log('  FAIL ' + f));
process.exit(fail.length ? 1 : 0);
