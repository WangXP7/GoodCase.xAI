const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const URL = 'file://' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const OUT = path.join(__dirname, '_shots');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox',
           '--ignore-gpu-blocklist', '--enable-webgl'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + (e.stack || e.message)));

  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(2500);

  const state = await page.evaluate(() => {
    const g = window.__mc;
    if (!g) return { ready: false };
    return {
      ready: true, hasRenderer: !!g.renderer, chunks: g.world.chunks.size,
      seed: g.world.seed, loadMsg: document.getElementById('loadMsg').textContent,
    };
  });
  console.log('INIT', JSON.stringify(state));
  if (!state.hasRenderer) {
    console.log('ERRORS', JSON.stringify(errors.slice(0, 5), null, 1));
    await browser.close(); process.exit(1);
  }

  await page.click('#startBtn');
  await page.waitForTimeout(14000);

  const ui = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('#hotbar .slot img')].map(i => (i.src || '').length);
    const g = window.__mc;
    return {
      hotbarIconBytes: imgs,
      fps: +g.fps.toFixed(1),
      pos: g.player.pos.map(v => +v.toFixed(2)),
      drawnChunks: g.stats.drawnChunks,
      tris: g.stats.tris,
      drawCalls: g.stats.drawCalls,
    };
  });
  console.log('UI', JSON.stringify(ui));

  async function shot(name, setup, wait = 1400) {
    if (setup) await page.evaluate(setup);
    await page.waitForTimeout(wait);
    await page.screenshot({ path: path.join(OUT, name) });
  }

  await shot('01-ground.png', () => {
    const g = window.__mc;
    g.player.pitch = -0.10;
    g.player.yaw = 0.6;
  });

  for (let i = 0; i < 4; i++) {
    await shot('02-dir-' + i + '.png', `(()=>{window.__mc.player.yaw = ${i} * Math.PI / 2;})()`);
  }

  // 抬头看天（云 + 太阳）
  await shot('03-sky.png', () => { window.__mc.player.pitch = 0.55; }, 1600);

  // 高处俯瞰
  await shot('04-aerial.png', () => {
    const g = window.__mc;
    g.player.pos[1] += 18;
    g.player.pitch = -0.62;
    g.player.flying = true;
    g.player.vel[1] = 0;
  }, 2600);

  // 回到地面
  await shot('05-back.png', () => {
    const g = window.__mc;
    g.player.flying = false;
    g.player.pitch = -0.16;
    for (let y = 120; y > 1; y--) {
      if (g.world.isSolid(Math.floor(g.player.pos[0]), y, Math.floor(g.player.pos[2]))) {
        g.player.pos[1] = y + 1.05; break;
      }
    }
  }, 2000);

  // 夜晚
  await shot('06-night.png', () => { window.__mc.world.time = 0.74; }, 1800);

  // 黄昏
  await shot('07-dusk.png', () => { window.__mc.world.time = 0.5; }, 1800);

  // 黎明
  await shot('08-dawn.png', () => { window.__mc.world.time = 0.985; }, 1800);

  // 白天 + 挖掘（制造裂纹）
  await page.evaluate(() => {
    const g = window.__mc;
    g.world.time = 0.22;
    g.player.pitch = -0.42;
    g.player.creative = false;
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const g = window.__mc;
    g.hit = { x: Math.floor(g.player.pos[0]), y: Math.floor(g.player.pos[1]) - 1, z: Math.floor(g.player.pos[2]) + 1, face: 2, id: 12 };
    g.mining = { x: g.hit.x, y: g.hit.y, z: g.hit.z, t: 0.42, time: 0.6, id: 12 };
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, '09-mining.png') });

  // 水下
  await page.evaluate(() => {
    const g = window.__mc, W = g.world;
    g.player.creative = true;
    const px = Math.floor(g.player.pos[0]), pz = Math.floor(g.player.pos[2]);
    let found = null;
    for (let r = 0; r < 90 && !found; r += 3) {
      for (let a = 0; a < 16; a++) {
        const x = px + Math.round(Math.cos(a / 16 * Math.PI * 2) * r);
        const z = pz + Math.round(Math.sin(a / 16 * Math.PI * 2) * r);
        if (!W.hasChunk(x >> 4, z >> 4)) continue;
        let waterTop = -1;
        for (let y = 64; y > 30; y--) {
          if (W.getBlock(x, y, z) === 38) { waterTop = y; break; }
        }
        if (waterTop > 0) { found = [x, waterTop, z]; break; }
      }
    }
    if (found) {
      g.player.pos[0] = found[0] + 0.5;
      g.player.pos[1] = found[1] - 2.5;
      g.player.pos[2] = found[2] + 0.5;
      g.player.flying = false;
      g.player.vel = [0, 0, 0];
      g.player.pitch = 0.05;
    }
    window.__waterFound = !!found;
  });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, '10-underwater.png') });
  console.log('WATER_FOUND', await page.evaluate(() => window.__waterFound));

  const final = await page.evaluate(() => {
    const g = window.__mc;
    let dirty = 0, mesh = 0, water = 0;
    for (const c of g.world.chunks.values()) { if (c.dirtyMesh) dirty++; if (c.mesh) mesh++; if (c.meshWater) water++; }
    return { chunks: g.world.chunks.size, dirty, mesh, water, fps: +g.fps.toFixed(1), pos: g.player.pos.map(v => +v.toFixed(1)) };
  });
  console.log('FINAL', JSON.stringify(final));
  console.log('ERROR_COUNT', errors.length);
  if (errors.length) console.log('ERRORS', JSON.stringify(errors.slice(0, 6), null, 1));

  await browser.close();
})();
