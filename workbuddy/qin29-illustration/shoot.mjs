// 全图缩略视图 + 局部放大
import pw from 'file:///C:/Users/xp772/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
import path from 'path';
import { pathToFileURL } from 'url';

const svg = process.argv[2] || 'qin-29-illustration.svg';
const outBase = process.argv[3] || 'shot';
const EXE = 'C:/Users/xp772/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';

const browser = await chromium.launch({ executablePath: EXE });
const errs = [];

import fs from 'fs';
const svgSrc = fs.readFileSync(path.resolve(svg), 'utf8');

// 1) 缩略全图
const p1 = await browser.newPage({ viewport: { width: 1400, height: 1120 } });
p1.on('pageerror', e => errs.push('pageerror: ' + e.message));
await p1.setContent(`<style>html,body{margin:0;background:#1a1a1a;overflow:hidden}
#w{width:1400px;height:1120px}
#w svg{width:100%;height:100%;display:block}</style><div id="w">${svgSrc}</div>`);
await p1.waitForTimeout(500);
await p1.screenshot({ path: outBase + '-full.png' });
await p1.close();

// 2) 局部放大（按 SVG 原始坐标裁剪）
const p2 = await browser.newPage({ viewport: { width: 3000, height: 2400 } });
p2.on('pageerror', e => errs.push('pageerror: ' + e.message));
await p2.goto(pathToFileURL(path.resolve(svg)).href, { waitUntil: 'load' });
await p2.waitForTimeout(500);
const regions = [
  ['chain-top', 420, 180, 620, 900],
  ['chain-mid', 400, 900, 700, 800],
  ['chain-low', 300, 1560, 1000, 700],
  ['cockpit', 980, 940, 780, 400],
  ['panels', 900, 1740, 1500, 480],
  ['right', 2200, 280, 800, 1560],
  ['bubble', 120, 1150, 900, 560],
];
for (const [name, x, y, w, h] of regions) {
  await p2.screenshot({ path: `${outBase}-${name}.png`, clip: { x, y, width: w, height: h } });
}
console.log('errors:', errs.length ? errs.join('\n') : 'none');
await browser.close();
