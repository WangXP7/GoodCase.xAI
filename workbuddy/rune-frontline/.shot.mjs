import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire('C:/Users/wxppa/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = require('playwright');

const dir = 'D:/58.GAM/15放置挂机LOL/wbDSv4.1F';
if (!fs.existsSync(dir + '/shots')) fs.mkdirSync(dir + '/shots');

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--disable-quic'] });
const page = await browser.newPage({ viewport: { width: 420, height: 747 }, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

await page.goto('file:///' + dir + '/index.html');
await page.waitForTimeout(1000);
await page.screenshot({ path: dir + '/shots/01-deploy.png' });

await page.mouse.click(210, 412);       // 开始战斗
await page.waitForTimeout(400);
let st = await page.evaluate(() => ({ phase: G.phase, tier: G.pick && G.pick.tier }));
console.log('after-start', JSON.stringify(st));
await page.screenshot({ path: dir + '/shots/02-hex.png' });

await page.mouse.click(123, 340);       // 选第一张
await page.waitForTimeout(300);
st = await page.evaluate(() => ({ phase: G.phase, hex: G.hexTaken }));
console.log('after-pick', JSON.stringify(st));

await page.waitForTimeout(6000);
await page.screenshot({ path: dir + '/shots/03-battle.png' });

await page.waitForTimeout(7000);
await page.screenshot({ path: dir + '/shots/04-mid.png' });

// 尽量把海克斯选完
for (let i = 0; i < 120; i++) {
  const ph = await page.evaluate(() => G.phase);
  if (ph === 'hex') { await page.mouse.click(123, 340); await page.waitForTimeout(250); }
  else if (ph === 'result') { break; }
  else await page.waitForTimeout(500);
}
await page.waitForTimeout(500);
await page.screenshot({ path: dir + '/shots/05-end.png' });

const fin = await page.evaluate(() => ({
  phase: G.phase, t: +G.t.toFixed(1), lv: G.level, hex: G.hexTaken, kills: G.kills,
  gold: Math.floor(G.gold), result: G.result,
  enemy: G.lanes.map(l => l.enemyCount),
  cores: G.lanes.map(l => Math.round(l.enemyCore.hp)),
  bullets: G.bullets.length, particles: G.particles.length,
}));
console.log('FINAL', JSON.stringify(fin));
console.log('ERRORS', errs.length ? errs.join(' | ') : 'none');
await browser.close();
