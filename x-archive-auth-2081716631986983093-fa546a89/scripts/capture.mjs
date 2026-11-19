#!/usr/bin/env node
/**
 * Screenshot harness. Boots the built game in headless Chromium, drives it with
 * a scripted camera/scenario, and writes PNGs to verify/.
 *
 * Usage:
 *   node scripts/capture.mjs --out verify/shot.png --wait 6000
 *   node scripts/capture.mjs --scenario battle --out verify/battle.png
 *   node scripts/capture.mjs --ship Destroyer --out verify/destroyer.png
 *
 * Options:
 *   --url       preview URL (default http://localhost:4173)
 *   --out       output png path
 *   --wait      ms to let the sim settle before shooting (default 8000)
 *   --w --h     viewport size (default 2560x1440)
 *   --scenario  passed to the page as ?scenario=
 *   --ship      passed to the page as ?ship= (isolated hull turntable)
 *   --cam       json blob passed as ?cam= e.g. '{"dist":900,"yaw":0.7,"pitch":0.25}'
 *   --shots     comma-separated extra delays for a sequence, e.g. 2000,4000
 */

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const has = (name) => argv.includes(`--${name}`);

const url = arg('url', process.env.PREVIEW_URL || 'http://localhost:4173');
const out = arg('out', 'verify/shot.png');
const wait = Number(arg('wait', 8000));
const width = Number(arg('w', 2560));
const height = Number(arg('h', 1440));
const scenario = arg('scenario', '');
const ship = arg('ship', '');
const cam = arg('cam', '');
const shots = arg('shots', '');

const params = new URLSearchParams();
if (scenario) params.set('scenario', scenario);
if (ship) params.set('ship', ship);
if (cam) params.set('cam', cam);
params.set('capture', '1');
const target = `${url}/?${params.toString()}`;

await mkdir(dirname(out), { recursive: true });

const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=metal',
    '--enable-unsafe-webgpu',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--disable-frame-rate-limit',
  ],
});
const page = await browser.newPage({
  viewport: { width, height },
  deviceScaleFactor: 1,
});

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));

await page.goto(target, { waitUntil: 'load', timeout: 60000 });

// Wait for the app to declare itself ready, then let the sim run.
await page
  .waitForFunction(() => window.__starfallReady === true, { timeout: 45000 })
  .catch(() => logs.push('[warn] __starfallReady never set'));

const delays = shots ? shots.split(',').map(Number) : [wait];
let i = 0;
for (const d of delays) {
  await page.waitForTimeout(d);
  const path = delays.length > 1 ? out.replace(/\.png$/, `-${i}.png`) : out;
  await page.screenshot({ path, type: 'png' });
  console.log(`wrote ${path}`);
  i++;
}

const fps = await page.evaluate(() => window.__starfallStats ?? null).catch(() => null);
if (fps) console.log('stats', JSON.stringify(fps));

const errs = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
if (errs.length) {
  console.log('--- page errors ---');
  for (const l of errs.slice(0, 40)) console.log(l);
}

await browser.close();
process.exit(errs.length ? 2 : 0);
