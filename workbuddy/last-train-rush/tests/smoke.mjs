// 末班快车 冒烟测试：菜单 → 开局 → 操作 → 障碍区 → 受击死亡 → 重开 → 末班车 → 胜利
import pw from 'file:///C:/Users/xp772/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;

const URL_ = 'http://127.0.0.1:8777/index.html';
const OUTDIR = 'D:/68.AIGC/xWorkBuddy/GoodCase/.workbuddy/verify';

const browser = await chromium.launch({
  executablePath: 'C:/Users/xp772/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});

const errors = [];
const failed = [];

async function run(viewport, tag) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`[${tag}] ` + String(e?.message || e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(`[${tag}][console] ` + m.text()); });
  page.on('requestfailed', r => failed.push(`[${tag}] ` + r.url() + ' :: ' + (r.failure()?.errorText || '')));
  page.on('response', r => { if (r.status() >= 400) failed.push(`[${tag}] ` + r.url() + ' :: HTTP ' + r.status()); });

  const t0 = Date.now();
  await page.goto(URL_, { waitUntil: 'load', timeout: 60000 });

  let menuOk = false;
  try {
    await page.waitForFunction(() => {
      const m = document.querySelector('#menu');
      return m && !m.classList.contains('hidden');
    }, { timeout: 25000 });
    menuOk = true;
  } catch { }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUTDIR}/ltr-${tag}-menu.png` });

  let startOk = false;
  try { await page.click('#start', { timeout: 5000 }); startOk = true; } catch { }
  await page.waitForFunction(() => (window.__game?.snapshot()?.distance ?? 0) > 15, null, { timeout: 15000 }).catch(() => { });
  await page.waitForTimeout(1200);
  const snap1 = await page.evaluate(() => window.__game?.snapshot() ?? null);
  await page.screenshot({ path: `${OUTDIR}/ltr-${tag}-play1.png` });

  // ---- 操作响应 ----
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(450);
  const afterLeft = await page.evaluate(() => window.__game.player.lane);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(450);
  const afterRight = await page.evaluate(() => window.__game.player.lane);
  await page.keyboard.press('ArrowUp');
  await page.waitForFunction(() => window.__game.player.y > 0.8, null, { timeout: 5000 }).catch(() => { });
  const afterJump = await page.evaluate(() => ({ y: window.__game.player.y, grounded: window.__game.player.grounded }));
  await page.waitForFunction(() => window.__game.player.grounded, null, { timeout: 4000 }).catch(() => { });
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(150);
  const afterRoll = await page.evaluate(() => window.__game.player.rollT);

  // ---- 方向回归：相机看向 +z 时 world +x 在屏幕左，lane 0 必须投影到 ndcX<0 ----
  const dirCheck = await page.evaluate(() => {
    const g = window.__game;
    const z = g.player.z + 15;
    return { lane0ndcX: g.project(2.3, 1.0, z).ndcX, lane2ndcX: g.project(-2.3, 1.0, z).ndcX };
  });

  // ---- 真实碰撞：本道正前方 30m 放矮栏，应扣 1 心 ----
  await page.evaluate(() => window.__game.debugObstacle('barrier', window.__game.player.lane, 30));
  await page.waitForFunction(() => window.__game.State.hearts < 3, null, { timeout: 15000 }).catch(() => { });
  const heartsAfterBarrier = await page.evaluate(() => window.__game.State.hearts);

  // ---- 金币：本道正前方放一串，应吃到 ----
  const coinsBefore = await page.evaluate(() => window.__game.State.coins);
  await page.evaluate(() => window.__game.debugCoins(6));
  await page.waitForTimeout(3200);
  const coinsAfter = await page.evaluate(() => window.__game.State.coins);
  await page.screenshot({ path: `${OUTDIR}/ltr-${tag}-coin.png` });

  // ---- 障碍区 ----
  await page.evaluate(() => window.__game.warp(700));
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUTDIR}/ltr-${tag}-play2.png` });
  const snap2 = await page.evaluate(() => window.__game?.snapshot() ?? null);

  // ---- 高速状态（速度线 + FOV 冲刺） ----
  await page.evaluate(() => window.__game.debugSpeed(28));
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${OUTDIR}/ltr-${tag}-fast.png` });
  await page.evaluate(() => window.__game.debugSpeed(13));

  // ---- 受击 ×3 → 死亡 ----
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.__game.debugHit());
    await page.waitForTimeout(1900);
  }
  const deadVisible = await page.evaluate(() => {
    const d = document.querySelector('#dead');
    return d && !d.classList.contains('hidden');
  });
  const heartsLeft = await page.evaluate(() => window.__game.State.hearts);
  await page.screenshot({ path: `${OUTDIR}/ltr-${tag}-dead.png` });

  // ---- 重开 → 末班车 → 胜利 ----
  await page.evaluate(() => window.__game.start());
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__game.warp(2380));
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUTDIR}/ltr-${tag}-train.png` });
  await page.evaluate(() => window.__game.warp(2589));
  await page.waitForTimeout(1600);
  const winVisible = await page.evaluate(() => {
    const w = document.querySelector('#win');
    return w && !w.classList.contains('hidden');
  });
  await page.screenshot({ path: `${OUTDIR}/ltr-${tag}-win.png` });

  const result = {
    tag, menuOk, startOk, loadMs: Date.now() - t0,
    snap1, snap2, deadVisible, heartsLeft, winVisible,
    heartsAfterBarrier, coinsBefore, coinsAfter, dirCheck,
    ops: { afterLeft, afterRight, afterJump, afterRoll },
    ok: menuOk && startOk && snap1?.phase === 'playing'
      && snap1.distance > 15 && afterLeft === 0 && afterRight === 2
      && !afterJump.grounded && afterJump.y > 0.5 && afterRoll > 0
      && dirCheck.lane0ndcX < 0 && dirCheck.lane2ndcX > 0
      && heartsAfterBarrier === 2 && coinsAfter > coinsBefore
      && snap2.distance > 700 && deadVisible === true && heartsLeft === 0 && winVisible === true,
  };
  console.log(JSON.stringify(result, null, 2));
  await ctx.close();
  return result;
}

const desktop = await run({ width: 1440, height: 900 }, 'desktop');
const mobile = await run({ width: 390, height: 844 }, 'mobile');

console.log(JSON.stringify({ errors: errors.slice(0, 15), failedRequests: failed.slice(0, 15) }, null, 2));
await browser.close();
console.log('SUMMARY', JSON.stringify({ desktop: desktop.ok, mobile: mobile.ok }));
