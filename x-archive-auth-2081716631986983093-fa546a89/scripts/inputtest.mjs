#!/usr/bin/env node
/**
 * Drives the real input layer in headless Chromium and reports what each
 * gesture actually does to the camera and the selection, so control feel can be
 * diagnosed with numbers instead of adjectives.
 */

import { chromium } from 'playwright';

const url = process.env.PREVIEW_URL || 'http://localhost:4173';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

await page.goto(`${url}/?capture=1`, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.__starfallReady === true, { timeout: 45000 });
await page.waitForTimeout(6000);

const state = () => page.evaluate(() => {
  const g = window.__starfall;
  const c = g.cam;
  return {
    focus: [Math.round(c.focus.x), Math.round(c.focus.y), Math.round(c.focus.z)],
    dist: Math.round(c.distance),
    yaw: +(c.yaw ?? 0).toFixed(3),
    pitch: +(c.pitch ?? 0).toFixed(3),
    sel: g.world.selection.length,
    band: g.controls.band ? 1 : 0,
    dragging: !!c.dragging,
    camPos: [Math.round(g.stage.camera.position.x), Math.round(g.stage.camera.position.y), Math.round(g.stage.camera.position.z)],
  };
});

const settle = (ms = 1400) => page.waitForTimeout(ms);
const log = async (label) => console.log(label.padEnd(30), JSON.stringify(await state()));

await log('initial');

// --- wheel zoom -----------------------------------------------------------
await page.mouse.move(800, 450);
for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(60); }
await settle();
await log('after 5 wheel-in');
for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(60); }
await settle();
await log('after 10 wheel-out');

// --- left drag (expect band selection, NOT camera movement) ---------------
await page.mouse.move(500, 300);
await page.mouse.down({ button: 'left' });
await page.mouse.move(700, 400, { steps: 8 });
const midBand = await state();
console.log('mid left-drag'.padEnd(30), JSON.stringify(midBand));
await page.mouse.move(1100, 700, { steps: 10 });
await page.mouse.up({ button: 'left' });
await settle();
await log('after left drag (band?)');

// --- middle drag (expect orbit) ------------------------------------------
const beforeOrbit = await state();
await page.mouse.move(800, 450);
await page.mouse.down({ button: 'middle' });
await page.mouse.move(1000, 500, { steps: 10 });
await page.mouse.up({ button: 'middle' });
await settle();
const afterOrbit = await state();
console.log('middle drag orbit'.padEnd(30), `yaw ${beforeOrbit.yaw} -> ${afterOrbit.yaw}, pitch ${beforeOrbit.pitch} -> ${afterOrbit.pitch}, focus moved ${Math.hypot(afterOrbit.focus[0]-beforeOrbit.focus[0], afterOrbit.focus[2]-beforeOrbit.focus[2])|0} m`);

// --- keyboard pan ---------------------------------------------------------
const beforePan = await state();
await page.keyboard.down('w');
await page.waitForTimeout(700);
await page.keyboard.up('w');
await settle();
const afterPan = await state();
console.log('W pan'.padEnd(30), `focus moved ${Math.hypot(afterPan.focus[0]-beforePan.focus[0], afterPan.focus[2]-beforePan.focus[2])|0} m at dist ${beforePan.dist}`);

// --- edge scroll ----------------------------------------------------------
const beforeEdge = await state();
await page.mouse.move(1598, 450);
await page.waitForTimeout(900);
await page.mouse.move(800, 450);
await settle();
const afterEdge = await state();
console.log('edge scroll right'.padEnd(30), `focus moved ${Math.hypot(afterEdge.focus[0]-beforeEdge.focus[0], afterEdge.focus[2]-beforeEdge.focus[2])|0} m`);

// --- select all then right-click move ------------------------------------
await page.keyboard.down('Control');
await page.keyboard.press('a');
await page.keyboard.up('Control');
await settle(600);
console.log('ctrl+A select'.padEnd(30), JSON.stringify(await state()));

// --- double click select ---------------------------------------------------
await page.mouse.dblclick(800, 450);
await settle(600);
await log('after dblclick');

if (errs.length) { console.log('--- errors ---'); errs.slice(0, 15).forEach((e) => console.log(e.slice(0, 300))); }
await browser.close();
