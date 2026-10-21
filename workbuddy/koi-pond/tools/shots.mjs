// 成品截图：全景 / 低角度倒影 / 俯视鱼群 / 投食瞬间
import { createRequire } from 'node:module';
const require = createRequire('C:/Users/wxppa/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = require('playwright');

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--disable-quic', '--use-gl=angle', '--use-angle=swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
page.on('pageerror', e => console.log('PAGEERROR', e.message));

await page.goto('http://127.0.0.1:8917/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.KOI_READY === true, { timeout: 90000 });
await page.waitForTimeout(1600);

const shoot = async (name) => {
  await page.screenshot({ path: `shots/${name}.jpg`, type: 'jpeg', quality: 92, timeout: 150000 });
  console.log('shot', name);
};

const setCam = async (cfg) => {
  await page.evaluate((c) => {
    const K = window.KOI;
    Object.assign(K.cam, c);
  }, cfg);
  await page.waitForTimeout(2600);
};

// 01 全景
await page.evaluate(() => {
  const K = window.KOI;
  K.cam.theta = 0.60; K.cam.tTheta = 0.60;
  K.cam.phi = 1.145; K.cam.tPhi = 1.145;
  K.cam.dist = 15.8; K.cam.tDist = 15.8;
});
await page.waitForTimeout(2600);
await shoot('01-overview');

// 02 低角度：看树影与水线
await setCam({ theta: 1.15, tTheta: 1.15, phi: 1.30, tPhi: 1.30, dist: 13.0, tDist: 13.0 });
await shoot('02-reflection');

// 03 俯视：看鱼群与水下
await setCam({ theta: 0.25, tTheta: 0.25, phi: 0.86, tPhi: 0.86, dist: 14.2, tDist: 14.2 });
await shoot('03-fish-school');

// 04 投食瞬间
await page.evaluate(() => {
  const K = window.KOI;
  K.dropFood(-1.2, 0.6, 5);
  K.dropFood(2.4, -1.6, 4);
});
await page.waitForTimeout(1400);
await shoot('04-feeding');

console.log('done');
await browser.close();
