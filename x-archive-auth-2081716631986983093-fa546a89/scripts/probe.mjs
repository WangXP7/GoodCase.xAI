#!/usr/bin/env node
/**
 * Headless debug probe: boots the game and dumps live scene/renderer state as
 * JSON so rendering bugs can be diagnosed without eyeballing pixels.
 *
 * Usage: node scripts/probe.mjs [--wait 8000] [--expr 'js returning a value']
 */

import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const url = arg('url', 'http://localhost:4173');
const wait = Number(arg('wait', 8000));
const expr = arg('expr', '');

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(arg('w',1280)), height: Number(arg('h',720)) } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(`${url}/?capture=1&scenario=${arg('scenario','')}&ship=${arg('ship','')}`, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.__starfallReady === true, { timeout: 45000 }).catch(() => {});
await page.waitForTimeout(wait);

const defaultExpr = `(() => {
  const g = window.__starfall;
  if (!g) return { error: 'no game' };
  const out = { ships: 0, byClass: {}, meshes: [], sceneChildren: 0, camera: {}, info: {} };
  const w = g.world;
  for (let i = 0; i < w.ships.count; i++) {
    const s = w.ships.items[i];
    if (!s.alive) continue;
    out.ships++;
    out.byClass[s.cls] = (out.byClass[s.cls] || 0) + 1;
    if (out.ships <= 3) (out.sample ||= []).push({ cls: s.cls, lod: s.lod, vis: s.visible, p: [Math.round(s.pos.x), Math.round(s.pos.y), Math.round(s.pos.z)] });
  }
  const cam = g.stage.camera;
  out.camera = { pos: [cam.position.x|0, cam.position.y|0, cam.position.z|0], far: cam.far, near: cam.near, dist: g.cam.distance|0, focus: [g.cam.focus.x|0, g.cam.focus.y|0, g.cam.focus.z|0] };
  g.stage.scene.traverse((o) => {
    out.sceneChildren++;
    if (o.isInstancedMesh && o.count > 0) {
      out.meshes.push({ name: o.name || o.type, count: o.count, visible: o.visible, frustumCulled: o.frustumCulled, mat: o.material?.type, tri: (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3 | 0 });
    }
  });
  out.meshes = out.meshes.slice(0, 25);
  const inf = g.stage.renderer.info.render;
  out.info = { calls: inf.calls, triangles: inf.triangles };
  return out;
})()`;

const result = await page.evaluate(expr || defaultExpr).catch((e) => ({ evalError: String(e) }));
console.log(JSON.stringify(result, null, 2));

const errs = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
if (errs.length) {
  console.log('--- page errors ---');
  for (const l of errs.slice(0, 25)) console.log(l.slice(0, 400));
}

await browser.close();
