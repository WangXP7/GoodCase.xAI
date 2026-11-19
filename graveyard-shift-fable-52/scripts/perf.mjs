// npm run perf -- [--q high] [--shot wide] [--zombies 24] [--frames 300] [--size 1920x1080] [--runs 3] [--uncapped]
//   [--device phone|tablet] [--dpr n] [--throttle <cpu slowdown, e.g. 4>]
// --device runs under mobile emulation (touch, DPR, mobile UA); pass touch=1 and q=mobile yourself.
// --throttle slows the CPU through CDP (4 is roughly a mid-range phone against this laptop; the GPU is not slowed).
// Each run ends with a table of draw calls and triangles by pass for the last frame (window.__passStats()).
// Frame rate on a staged shot with a crowd alive, rain on and the camera moving (a slow dolly and
// pan around the shot's own camera). Reports __stats().fps sampled every 60 frames, and the frame
// intervals seen by requestAnimationFrame. --uncapped lifts the display's 60 Hz cap (headroom).
//
// npm run perf -- --table [--views wide,diner-in,...] [--tiers high,mobile] [--zombies 24] [--frames 30] [--json <file>]
//   The scene budget table: draw calls and triangles of one stepped frame (fixed seed, god=1, power
//   on), by pass (main colour, depth pre-pass, each shadow map, reflection, rain, particles, post)
//   and by source group (each zone's group, vehicles, zombies near and far, viewmodel, sky, fx, lights),
//   per view and per tier. `mobile` runs as a phone (--device phone, touch=1). Counts are
//   deterministic: frame time is not measured in this mode. The player is put where the camera is,
//   so the level's zone and what it draws follow the view. Views are the level's named shots, or
//   VIEWS below (a door state and a camera of their own). --shots <dir> also saves a PNG of each
//   view's measured frame as <dir>/<tier>-<view>.png (for before/after image diffs).
//
// npm run perf -- --walk [--tiers high] [--shots <dir>] [--nocull]
//   The portal culling's walk test: the camera walks through every doorway of the enclosed rooms (the
//   diner, motel rooms on both wings and floors, the office, the garage bays) both ways, along the
//   forecourt's east fence, and turns a full circle at points inside each room, a frame every 0.25 m
//   (or 15 degrees). Each frame, rays from the camera through a grid over every opening of the room
//   it is in that lands on screen are tested against every mesh and body the culling left out: one
//   that a ray meets is a pop (it was not drawn while it could be seen). Exit 1 on any. With --shots
//   every frame is saved; run once with --nocull (culling off) and once without and diff the two
//   folders: any difference is something the culling changed on screen.
import { parseArgs } from 'node:util';
import { writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { pageUrl, watchPage, contextOptions } from './lib.mjs';

const { values: a } = parseArgs({
  options: {
    q: { type: 'string', default: 'high' }, shot: { type: 'string', default: 'wide' }, zombies: { type: 'string', default: '24' },
    frames: { type: 'string', default: '300' }, size: { type: 'string' }, device: { type: 'string' }, dpr: { type: 'string' }, throttle: { type: 'string' }, runs: { type: 'string', default: '3' },
    uncapped: { type: 'boolean', default: false }, params: { type: 'string', default: '' },
    table: { type: 'boolean', default: false }, views: { type: 'string' }, tiers: { type: 'string', default: 'high,mobile' }, json: { type: 'string' }, shots: { type: 'string' }, hide: { type: 'string' }, walk: { type: 'boolean', default: false }, nocull: { type: 'boolean', default: false },
  },
});
const args = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'];
if (a.table) { await table(); process.exit(0); }
if (a.walk) process.exit(await walk());
if (a.uncapped) args.push('--disable-frame-rate-limit', '--disable-gpu-vsync');
let code = 0;
for (let run = 1; run <= Number(a.runs); run++) {
  const browser = await chromium.launch({ channel: 'chromium', headless: true, args });
  try {
    const page = await browser.newPage(contextOptions({ device: a.device, size: a.size, dpr: a.dpr, version: browser.version() }));
    if (a.throttle) await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: Number(a.throttle) });
    const extra = watchPage(page);
    await page.goto(pageUrl(`shot=${a.shot}&spawn=${a.zombies}&q=${a.q}&god=1${a.params ? `&${a.params}` : ''}`));
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
    await page.waitForTimeout(3000); // shaders linked, lights settled, eye adapted
    const r = await page.evaluate((frames) => new Promise((resolve) => {
      const G = window.__G;
      const base = G.shotCam.cam.slice();
      const fps = []; const dts = []; const alive = []; const calls = [];
      let n = 0; let last = performance.now();
      const tick = (now) => {
        const k = n / 60;
        // dolly 3 m side to side and 1.5 m in and out, pan +-12 degrees
        const yaw = base[3] + 0.21 * Math.sin(k * 1.3);
        const sx = Math.cos(base[3]), sz = -Math.sin(base[3]);
        const fx = -Math.sin(base[3]), fz = -Math.cos(base[3]);
        const side = 1.5 * Math.sin(k * 0.9), fwd = 0.75 * Math.sin(k * 0.6);
        window.__setShot({ cam: [base[0] + sx * side + fx * fwd, base[1], base[2] + sz * side + fz * fwd, yaw, base[4]] });
        if (n > 0) dts.push(now - last);
        last = now;
        if (n > 0 && n % 60 === 0) { const s = window.__stats(); fps.push(s.fps); alive.push(s.alive); calls.push(s.drawCalls); }
        if (++n <= frames) requestAnimationFrame(tick);
        else {
          dts.sort((p, q) => p - q);
          const mean = dts.reduce((s, v) => s + v, 0) / dts.length;
          const s = window.__stats();
          resolve({
            fps, meanFps: +(1000 / mean).toFixed(1), meanMs: +mean.toFixed(2), p95Ms: +dts[Math.floor(dts.length * 0.95)].toFixed(2), maxMs: +dts[dts.length - 1].toFixed(2),
            alive, drawCalls: calls, triangles: s.triangles, cpuFrameMs: s.frameMs, tier: G.quality.tier || G.quality.name || G.quality.preset, errors: (window.__errors || []).length,
            size: [G.renderer.domElement.width, G.renderer.domElement.height],
          });
        }
      };
      requestAnimationFrame(tick);
    }), Number(a.frames));
    // the same dolly with no display refresh between frames: what a frame really costs (CPU + GPU)
    r.bench = await page.evaluate((frames) => {
      const base = window.__G.shotCam.cam.slice();
      return window.__bench(frames, (n) => {
        const k = n / 60;
        const sx = Math.cos(base[3]), sz = -Math.sin(base[3]), fx = -Math.sin(base[3]), fz = -Math.cos(base[3]);
        const side = 1.5 * Math.sin(k * 0.9), fwd = 0.75 * Math.sin(k * 0.6);
        window.__setShot({ cam: [base[0] + sx * side + fx * fwd, base[1], base[2] + sz * side + fz * fwd, base[3] + 0.21 * Math.sin(k * 1.3), base[4]] });
      });
    }, Number(a.frames));
    console.log(`[perf] run ${run} q=${a.q}${a.uncapped ? ' uncapped' : ''} ${JSON.stringify(r)}`);
    const passes = await page.evaluate(() => window.__passStats());
    console.log(`[perf] passes (last frame)\n${['pass'.padEnd(14) + 'calls'.padStart(7) + 'triangles'.padStart(12), ...passes.map((p) => p.pass.padEnd(14) + String(p.calls).padStart(7) + String(p.triangles).padStart(12))].map((l) => `  ${l}`).join('\n')}`);
    if (r.errors || extra.length) { console.log(`[perf] errors: ${extra.join(' | ')}`); code = 1; }
  } finally { await browser.close(); }
}
process.exit(code);

// ---- --table -------------------------------------------------------------------------------------
// view: { shot | cam, open (door ids, 'all' or ''), zone (where the zombies are staged; default the camera's) }
function viewTable() { return {
  wide: { shot: 'wide', open: 'all' },
  'diner-in': { shot: 'diner-in', open: 'all' },
  'diner-in-shut': { shot: 'diner-in', open: '' }, // every door shut: d1 is not bought
  'diner-door': { cam: [12.2, 1.7, -24.5, Math.PI, -0.02], open: 'd1' }, // inside, looking out through the bought front door
  'motel-lot': { shot: 'motel-lot', open: 'all' },
  'motel-room': { shot: 'motel-room', open: 'all' },
  'yard-lane': { shot: 'yard-lane', open: 'all' },
  'garage-ext': { shot: 'garage-ext', open: 'all' },
  'east-fence': { shot: 'p2-east-fence', open: '' }, // the scrapyard through the forecourt's chain-link
  // inside the enclosed rooms, toward and away from their openings (the portal culling's cases)
  'diner-south': { cam: [16, 1.7, -27, Math.PI, 0], open: '' }, // the boarded front windows
  'diner-east': { cam: [10, 1.7, -26, -Math.PI / 2, 0], open: '' }, // the length of the room, the kitchen door
  'diner-west': { cam: [9, 1.7, -26, Math.PI / 2, 0], open: 'all' }, // facing the store wall: no opening near the screen
  'room-in': { cam: [41.5, 1.6, -39.2, 0, -0.05], open: 'all' }, // motel room n1: its boarded back window
  'room-door': { cam: [40.75, 1.6, -42.6, Math.PI, 0], open: 'all' }, // n1 toward its door and the lot
  'bay-in': { cam: [52, 1.7, 12, -Math.PI / 2, 0], open: 'all' }, // the bays toward their back wall
  'bay-out': { cam: [63, 1.7, 12, Math.PI / 2, 0], open: 'all' }, // the bays toward the yard through the bay doors
}; }

// Runs in the page: wraps the renderer's draw entry point and every post pass, steps one frame, and
// returns each draw's calls and triangles by pass and by source. Reads only: nothing is drawn differently.
function traceFrame() {
  const G = window.__G;
  const r = G.renderer;
  const info = r.info.render;
  const out = { pass: {}, group: {}, cell: {}, total: { calls: 0, triangles: 0 } };
  let pass = 'scene';
  G.post.eachPass((p) => {
    if (p.__budget) return;
    p.__budget = true;
    const o = p.render;
    p.render = function traced(x) { const prev = pass; pass = p.name; try { return o.call(this, x); } finally { pass = prev; } };
  });
  const shadowName = new Map();
  let spot = 0;
  G.scene.traverse((o) => { if (o.isLight && o.castShadow && o.shadow) shadowName.set(o.shadow.camera, o.isDirectionalLight ? 'shadow:moon' : `shadow:spot${spot++}`); });
  const lodFar = (G.quality && G.quality.zombieLodFar) || 12;
  const cam = G.camera.position;
  const sourceOf = (o) => {
    let top = o; let second = null;
    while (top.parent && top.parent !== G.scene) { second = top; top = top.parent; }
    const n = top.name || '';
    if (n === 'world') return `level:${(second && second.name) || '?'}`;
    if (n === 'vehicles' || n.startsWith('vehicles')) return 'vehicles';
    if (n.startsWith('zombie')) {
      const e = top.matrixWorld.elements;
      return Math.hypot(e[12] - cam.x, e[14] - cam.z) > lodFar ? 'zombies:far' : 'zombies:near';
    }
    if (n === 'viewmodel') return 'viewmodel';
    if (n === 'sky') return 'sky';
    if (n.startsWith('fx-')) return n.startsWith('fx-rain') ? 'fx:rain' : n === 'fx-particles' ? 'fx:particles' : 'fx:decals';
    if (n === 'lights') return `lights:${o.name || '?'}`;
    return n || o.type;
  };
  const orig = r.renderBufferDirect;
  r.renderBufferDirect = function traced(camera, scene, geometry, material, object, group) {
    const c0 = info.calls; const t0 = info.triangles;
    const res = orig.apply(this, arguments);
    const dc = info.calls - c0; const dt = info.triangles - t0;
    let p = pass;
    if (shadowName.has(camera)) p = `${pass === 'scene' ? '' : `${pass}:`}${shadowName.get(camera)}`;
    else if (pass === 'scene') p = camera.isOrthographicCamera ? 'post' : material && material.colorWrite === false ? 'prepass' : 'main';
    else if (camera.isOrthographicCamera && pass !== 'reflection') p = `${pass}`;
    const s = camera.isOrthographicCamera && !shadowName.has(camera) ? 'post' : sourceOf(object);
    const add = (m, k) => { const v = m[k] || (m[k] = { calls: 0, triangles: 0 }); v.calls += dc; v.triangles += dt; };
    add(out.pass, p); add(out.group, s); add(out.cell, `${p}|${s}`);
    out.total.calls += dc; out.total.triangles += dt;
    return res;
  };
  return new Promise((resolve) => {
    window.__step = 1;
    const wait = () => (window.__step === 0 ? requestAnimationFrame(() => { r.renderBufferDirect = orig; resolve(out); }) : requestAnimationFrame(wait));
    wait();
  });
}

async function table() {
  const VIEWS = viewTable();
  const views = (a.views ? a.views.split(',') : Object.keys(VIEWS));
  const tiers = a.tiers.split(',');
  if (a.shots) mkdirSync(a.shots, { recursive: true });
  const results = [];
  for (const tier of tiers) {
    const device = tier === 'mobile' ? 'phone' : a.device;
    const browser = await chromium.launch({ channel: 'chromium', headless: true, args });
    try {
      for (const name of views) {
        const v = VIEWS[name] || { shot: name, open: 'all' };
        const page = await browser.newPage(contextOptions({ device, size: a.size, dpr: a.dpr, version: browser.version() }));
        const extra = watchPage(page);
        const q = [`shot=${v.shot || 'wide'}`, v.cam ? `cam=${v.cam.join(',')}` : '', `spawn=${a.zombies}`, `q=${tier}`, 'god=1', 'power=1', 'step=1', 'seed=7',
          v.open ? `open=${v.open}` : '', tier === 'mobile' ? 'touch=1' : '', a.params].filter(Boolean).join('&');
        await page.goto(pageUrl(q));
        await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
        // the player where the camera is: the level's zone, what it draws and its lights follow the view
        await page.evaluate(() => {
          const G = window.__G; const c = G.shotCam && G.shotCam.cam;
          if (c && G.player && G.player.pos) { G.player.pos[0] = c[0]; G.player.pos[2] = c[2]; if (G.level && G.level.update) G.level.update(); }
        });
        await page.evaluate((n) => { window.__step = n; }, Number(a.frames === '300' ? 30 : a.frames));
        await page.waitForFunction(() => window.__step === 0, null, { timeout: 120000 });
        // --hide <group,...>: those level groups left out of the measured frame (what a culling rule would save, and what it would change)
        if (a.hide) {
          await page.evaluate((h) => {
            const G = window.__G;
            for (const n of h.split(',')) {
              const g = G.level.groups[n];
              if (g) for (const c of g.children) if (c.name !== 'shadow') c.visible = false; // the shadow proxy stays: it is what keeps light out through walls
              const v = G.scene.getObjectByName(`vehicles:${n}`);
              if (v) for (const c of v.children) c.visible = false;
            }
          }, a.hide);
        }
        const t = await page.evaluate(traceFrame);
        if (a.shots) {
          await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
          await page.screenshot({ path: `${a.shots}/${tier}-${name}.png` });
        }
        const st = await page.evaluate(() => ({ ...window.__stats(), visible: [...(window.__G.level.visibleZones || [])], drawn: window.__G.level.drawnZones ? [...window.__G.level.drawnZones] : null }));
        const errors = [...(await page.evaluate(() => window.__errors || [])), ...extra];
        results.push({ tier, view: name, ...t, stats: st, errors: errors.length });
        console.log(`[budget] ${tier.padEnd(6)} ${name.padEnd(14)} calls ${String(t.total.calls).padStart(4)}  tris ${String(t.total.triangles).padStart(8)}  zone ${st.zone} alive ${st.alive} drawn ${(st.drawn || st.visible).join(',')}${errors.length ? `  ERRORS ${errors.length}: ${errors.slice(0, 3).join(' | ')}` : ''}`);
        await page.close();
      }
    } finally { await browser.close(); }
  }
  // per view: by pass, then by source
  for (const r of results) {
    const rows = (m) => Object.entries(m).sort((x, y) => y[1].calls - x[1].calls).map(([k, v]) => `${k}:${v.calls}/${Math.round(v.triangles / 1000)}k`).join('  ');
    console.log(`\n[budget] ${r.tier} ${r.view}: ${r.total.calls} calls, ${(r.total.triangles / 1e6).toFixed(3)} M triangles`);
    console.log(`  by pass   ${rows(r.pass)}`);
    console.log(`  by source ${rows(r.group)}`);
  }
  if (a.json) writeFileSync(a.json, JSON.stringify(results, null, 1));
}

// ---- --walk --------------------------------------------------------------------------------------
function walkPaths() {
  const UPPER = 3.04 + 1.6; // eye height on the motel's upper floor
  const P = [];
  const line = (name, a, b, y = 1.65) => P.push({ name, kind: 'line', a, b, y });
  const spin = (name, at, y = 1.65) => P.push({ name, kind: 'spin', at, y });
  const both = (name, a, b, y) => { line(`${name}-in`, b, a, y); line(`${name}-out`, a, b, y); };
  both('d1', [12.2, -23.5], [12.2, -16.5]);
  both('d2', [23.0, -27.25], [30.0, -27.25]);
  both('room-n1', [40.75, -42], [40.75, -35]);
  both('room-n2', [50.75, -42], [50.75, -35]);
  both('room-e1', [64, -28.25], [57, -28.25]);
  both('room-n3', [40.75, -42], [40.75, -37.0], UPPER);
  both('room-e4', [64, -21.25], [59.2, -21.25], UPPER);
  both('office', [30.75, -42], [30.75, -35]);
  for (const z of [6.8, 12.0, 17.2]) both(`bay-${z}`, [50, z], [42.5, z]);
  both('d3', [44, -6], [44, 2]);
  both('d4', [19, 10.1], [26, 10.1]);
  both('d5', [21.5, -11.5], [30, -11.5]);
  line('east-fence-n', [21.2, -1], [21.2, 19.5]);
  line('east-fence-s', [21.2, 19.5], [21.2, -1]);
  for (const [n, at, y] of [['diner-mid', [16, -26]], ['diner-d2', [24, -27.2]], ['kitchen', [23, -30]], ['diner-west', [8.2, -26]], ['n1', [41.5, -41]],
    ['e1', [63, -28.5]], ['n3', [41.5, -41], 3.04 + 1.6], ['office', [29, -40]], ['bays', [56, 12]], ['bays-office', [63.5, 6.5]], ['bays-door', [47, 12]]]) spin(`spin-${n}`, at, y);
  return P;
}
function frames(p) {
  const out = [];
  if (p.kind === 'spin') {
    for (let d = 0; d < 360; d += 15) for (const pitch of [-0.35, 0.1]) out.push([p.at[0], p.y, p.at[1], (d * Math.PI) / 180, pitch]);
    return out;
  }
  const dx = p.b[0] - p.a[0], dz = p.b[1] - p.a[1], L = Math.hypot(dx, dz);
  const yaw = Math.atan2(-dx, -dz); // yaw 0 looks down -z, +yaw turns toward -x
  for (let s = 0; s <= L + 1e-6; s += 0.25) out.push([p.a[0] + (dx * s) / L, p.y, p.a[1] + (dz * s) / L, yaw, -0.05]);
  return out;
}
// Runs in the page after a frame: rays through each opening of the room the camera is in, against what the culling left out.
function checkPops() {
  const G = window.__G; const cull = G.level.cull; const cell = cull.cell;
  if (!cell) return { cell: null, culled: 0, pops: [] };
  const T = window.__THREE || null;
  const cam = G.camera; cam.updateMatrixWorld();
  const e = cam.matrixWorld.elements; const ox = e[12], oy = e[13], oz = e[14];
  const vp = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse).elements;
  const ndc = (x, y, z) => { const w = vp[3] * x + vp[7] * y + vp[11] * z + vp[15]; if (w <= 1e-4) return null; return [(vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / w, (vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / w]; };
  // a ray from the eye through q, against a box: the entry distance beyond `after` (the opening), or -1
  const hit = (d, b, after) => {
    let t0 = after, t1 = 1e9;
    for (let k = 0; k < 3; k++) {
      const o = [ox, oy, oz][k], dk = d[k];
      if (Math.abs(dk) < 1e-9) { if (o < b[k] || o > b[k + 3]) return -1; continue; }
      let a = (b[k] - o) / dk, c = (b[k + 3] - o) / dk;
      if (a > c) { const t = a; a = c; c = t; }
      if (a > t0) t0 = a; if (c < t1) t1 = c;
      if (t0 > t1) return -1;
    }
    return t0;
  };
  const off = [];
  for (const en of cull.entries) if (!(en.obj.layers.mask & 1)) off.push({ name: `${en.obj.parent ? en.obj.parent.name : '?'}/${en.obj.name || en.obj.type}`, b: en.real || (en.real = (() => { const bb = en.box; const m = 0.3; return [bb[0] + m, bb[1] + m, bb[2] + m, bb[3] - m, bb[4] - m, bb[5] - m]; })()) });
  for (const o of G.scene.children) if (o.isSkinnedMesh && o.userData.portalCulled) { const p = o.position; off.push({ name: o.name, b: [p.x - 0.5, p.y, p.z - 0.5, p.x + 0.5, p.y + 1.9, p.z + 0.5] }); }
  const pops = new Set();
  const N = 10;
  for (const q of cell.portals) {
    const ext = [q.max[0] - q.min[0], q.max[1] - q.min[1], q.max[2] - q.min[2]];
    const thin = ext[0] < ext[2] ? 0 : 2; // the opening's plane is across its thin horizontal axis
    for (const side of [0, 1]) for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const P = [0, 0, 0];
      P[thin] = side ? q.max[thin] : q.min[thin];
      const along = thin === 0 ? 2 : 0;
      P[along] = q.min[along] + (ext[along] * i) / N; P[1] = q.min[1] + (ext[1] * j) / N;
      const s = ndc(P[0], P[1], P[2]);
      if (!s || Math.abs(s[0]) > 1 || Math.abs(s[1]) > 1) continue;
      const d = [P[0] - ox, P[1] - oy, P[2] - oz];
      for (const o of off) if (!pops.has(o.name) && hit(d, o.b, 1.0) >= 0) pops.add(o.name);
    }
  }
  void T;
  return { cell: cell.id, culled: off.length, pops: [...pops] };
}
async function walk() {
  const tier = (a.tiers || 'high').split(',')[0];
  const device = tier === 'mobile' ? 'phone' : a.device;
  if (a.shots) mkdirSync(a.shots, { recursive: true });
  const browser = await chromium.launch({ channel: 'chromium', headless: true, args });
  let bad = 0; let total = 0; let inCell = 0; let culledFrames = 0;
  try {
    const page = await browser.newPage(contextOptions({ device, size: a.size || '960x540', dpr: a.dpr || '1', version: browser.version() }));
    const extra = watchPage(page);
    await page.goto(pageUrl(['shot=wide', 'spawn=24', `q=${tier}`, 'god=1', 'power=1', 'step=1', 'seed=7', 'open=all', tier === 'mobile' ? 'touch=1' : '', a.params].filter(Boolean).join('&')));
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
    if (a.nocull) await page.evaluate(() => { window.__G.level.cull.enabled = false; });
    for (const p of walkPaths()) {
      const fs = frames(p);
      const pops = new Map();
      for (let k = 0; k < fs.length; k++) {
        const c = fs[k];
        await page.evaluate((cam) => {
          const G = window.__G;
          window.__setShot({ cam });
          if (G.player && G.player.pos) { G.player.pos[0] = cam[0]; G.player.pos[1] = cam[1] > 3 ? 3.04 : 0; G.player.pos[2] = cam[2]; }
          window.__step = 1;
        }, c);
        await page.waitForFunction(() => window.__step === 0, null, { timeout: 60000 });
        const r = await page.evaluate(checkPops);
        total++;
        if (r.cell) inCell++;
        if (r.culled) culledFrames++;
        for (const n of r.pops) pops.set(n, (pops.get(n) || 0) + 1);
        if (a.shots) await page.screenshot({ path: `${a.shots}/${p.name}-${String(k).padStart(3, '0')}.png` });
      }
      if (pops.size) bad++;
      console.log(`[walk] ${p.name.padEnd(16)} ${String(fs.length).padStart(3)} frames  ${pops.size ? `POP: ${[...pops].map(([n, c]) => `${n} x${c}`).join(', ')}` : 'ok'}`);
    }
    const errors = [...(await page.evaluate(() => window.__errors || [])), ...extra];
    if (errors.length) { console.log(`[walk] errors: ${errors.slice(0, 5).join(' | ')}`); bad++; }
  } finally { await browser.close(); }
  console.log(`[walk] ${total} frames, ${inCell} inside a room, ${culledFrames} with something culled; ${bad ? `${bad} path(s) FAILED` : 'no pop-in'}`);
  return bad ? 1 : 0;
}
