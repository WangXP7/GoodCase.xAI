import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('C:/Users/wxppa/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:8123';
const OUT = 'D:/68.AIGC/GoodCase/lol-idle/shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--disable-quic'] });

async function newPage(w, h, mobile) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  const p = await ctx.newPage();
  await p.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await p.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForFunction(() => !!window.__rift, null, { timeout: 30000 });
  return p;
}

const shot = async (p, name) => { await p.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 88 }); console.log('shot', name); };

// 01 开局（真实时间 9 秒，让兵线走进画面）
{
  const p = await newPage(1600, 900, false);
  await p.waitForTimeout(9000);
  await shot(p, '01-start');
  await p.context().close();
}

// 02 中期：快进 4 分钟 + 真实 6 秒
{
  const p = await newPage(1600, 900, false);
  await p.evaluate(() => {
    const R = window.__rift;
    for (let i = 0; i < 240; i++) {
      const S = R.state();
      R.tick(20);
      const un = S.heroes.filter(h => !h.owned);
      const nh = un[0];
      if (nh) {
        const c = R.cost.hero(nh.id);
        if (S.team.length < 3 || S.gold > c * 4) { if (S.gold >= c) R.recruit(nh.id); }
        else if (i % 2 === 0) R.buy.auto();
      } else if (i % 2 === 0) R.buy.auto();
    }
    R.buy.auto();
  });
  await p.waitForTimeout(7000);
  await shot(p, '02-mid');
  await p.context().close();
}

// 03 招募面板
{
  const p = await newPage(1600, 900, false);
  await p.evaluate(() => { const R = window.__rift; R.addGold(5000); R.buy.auto(); });
  await p.waitForTimeout(1200);
  await p.click('#btnSummon');
  await p.waitForTimeout(700);
  await shot(p, '03-summon');
  await p.context().close();
}

// 04 转生（快进到黄金以上）
{
  const p = await newPage(1600, 900, false);
  await p.evaluate(() => {
    const R = window.__rift, S = R.state();
    S.stars = 9; S.game = 19;
    R.buy.auto();
  });
  await p.waitForTimeout(1500);
  await p.click('#btnRebirth');
  await p.waitForTimeout(700);
  await shot(p, '04-rebirth');
  await p.context().close();
}

// 05 手机竖屏
{
  const p = await newPage(412, 915, true);
  await p.evaluate(() => {
    const R = window.__rift;
    for (let i = 0; i < 120; i++) { R.tick(20); if (i % 2 === 0) R.buy.auto(); }
  });
  await p.waitForTimeout(6000);
  await shot(p, '05-mobile');
  await p.context().close();
}

// 06 后期（15 分钟量级）
{
  const p = await newPage(1600, 900, false);
  await p.evaluate(() => {
    const R = window.__rift;
    for (let i = 0; i < 900; i++) {
      const S = R.state();
      R.tick(20);
      const nh = S.heroes.filter(h => !h.owned)[0];
      if (nh) {
        const c = R.cost.hero(nh.id);
        if (S.team.length < 3 || S.gold > c * 4) { if (S.gold >= c) R.recruit(nh.id); }
        else if (i % 2 === 0) R.buy.auto();
      } else if (i % 2 === 0) R.buy.auto();
    }
  });
  await p.waitForTimeout(6000);
  await shot(p, '06-late');
  const st = await p.evaluate(() => {
    const S = window.__rift.state();
    return { game: S.game, dps: Math.round(window.__rift.stats().dps), heroes: S.heroes.filter(h => h.owned).length, stars: S.stars };
  });
  console.log('late state', JSON.stringify(st));
  await p.context().close();
}

await browser.close();
console.log('done');
