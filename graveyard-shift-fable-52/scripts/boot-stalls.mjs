// How long the page stops answering while the game loads. A heartbeat injected before any game code
// runs (a 10 ms interval) records the longest gap between main-thread turns before window.__ready and
// in the 5 s after it; the game's own window.__bootStalls is read too when it exists.
//   node scripts/boot-stalls.mjs <url> [--args "--use-angle=swiftshader"] [--noparallel] [--late] [--wait 600] [--name label]
// --noparallel  hides KHR_parallel_shader_compile from the page (as on browsers without it)
// --late        after the boot: start a run, fire, spawn and kill zombies, throw a grenade, open a
//               door and switch the power on, then list every shader program created after __ready
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const has = (k) => argv.includes(`--${k}`);
const url = argv.find((a) => /^(https?|file):/.test(a));
if (!url) { console.error('usage: boot-stalls.mjs <url> [--args ".."] [--noparallel] [--late] [--wait s] [--name label]'); process.exit(2); }
const args = (opt('args', '--use-angle=metal --enable-gpu --ignore-gpu-blocklist') || '').split(' ').filter(Boolean);
const waitS = Number(opt('wait', 600));
const name = opt('name', 'run');

const browser = await chromium.launch({ channel: 'chromium', headless: true, args });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => logs.push(`pageerror: ${String(e.message).slice(0, 300)}`));

await page.addInitScript(({ noParallel }) => {
  if (noParallel) {
    for (const C of [self.WebGL2RenderingContext, self.WebGLRenderingContext]) {
      if (!C) continue;
      const ge = C.prototype.getExtension;
      C.prototype.getExtension = function getExtension(n) { return n === 'KHR_parallel_shader_compile' ? null : ge.call(this, n); };
      const gs = C.prototype.getSupportedExtensions;
      C.prototype.getSupportedExtensions = function getSupportedExtensions() { return (gs.call(this) || []).filter((n) => n !== 'KHR_parallel_shader_compile'); };
    }
  }
  // every GL program ever bound, to tell the programs that were drawn with from those never used
  const used = (window.__usedPrograms = new Set());
  for (const C of [self.WebGL2RenderingContext]) {
    if (!C) continue;
    const up = C.prototype.useProgram;
    C.prototype.useProgram = function useProgram(p) { if (p) used.add(p); return up.call(this, p); };
  }
  const hb = (window.__hb = { t0: performance.now(), last: performance.now(), wasReady: false, pre: 0, preAt: 0, post: 0, postAt: 0, readyAt: 0, tips: 0 });
  // a gap counts for the side of __ready it started on: the turn that sets __ready ends a boot gap
  setInterval(() => {
    const now = performance.now();
    const gap = now - hb.last;
    const before = !hb.wasReady;
    hb.last = now;
    hb.wasReady = window.__ready === true;
    if (before) { if (gap > hb.pre) { hb.pre = gap; hb.preAt = now - hb.t0; } return; }
    if (!hb.readyAt) hb.readyAt = now;
    if (now - hb.readyAt <= 5000 && gap > hb.post) { hb.post = gap; hb.postAt = now - hb.t0; }
  }, 10);
  // counts tip changes on the loading screen: proof the page kept running
  document.addEventListener('DOMContentLoaded', () => {
    const t = document.querySelector('#boot .ld-tip .t');
    if (t && typeof MutationObserver === 'function') new MutationObserver(() => { hb.tips++; }).observe(t, { childList: true, characterData: true, subtree: true });
  });
}, { noParallel: has('noparallel') });

const t0 = Date.now();
const labels = [];
let last = '';
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch((e) => logs.push(`goto: ${e.message.split('\n')[0]}`));
let ready = false;
while ((Date.now() - t0) / 1000 < waitS) {
  const s = await Promise.race([
    page.evaluate(() => ({ ready: window.__ready === true, label: document.getElementById('boot-label')?.textContent || '', note: document.getElementById('boot-note') && !document.getElementById('boot-note').hidden ? 'note' : '' })),
    new Promise((r) => setTimeout(() => r({ hung: true }), 5000)),
  ]).catch((e) => ({ err: String(e.message).split('\n')[0] }));
  const tag = s.hung ? '(page not answering)' : s.err ? `(eval failed)` : `${s.label}${s.note ? ' + note' : ''}`;
  if (tag !== last) { labels.push([Number(((Date.now() - t0) / 1000).toFixed(1)), tag]); last = tag; }
  if (s.ready) { ready = true; break; }
  await new Promise((r) => setTimeout(r, 250));
}
const readyAt = Number(((Date.now() - t0) / 1000).toFixed(1));
if (ready) await page.waitForTimeout(5500);

const info = await page.evaluate(() => {
  const G = window.__G;
  const r = G && G.renderer;
  const gl = r && r.getContext ? r.getContext() : null;
  const hb = window.__hb;
  return {
    parallel: gl ? !!gl.getExtension('KHR_parallel_shader_compile') : null,
    programs: r && r.info ? r.info.programs.length : null,
    stallBeforeReadyMs: Math.round(hb.pre), stallBeforeReadyAtS: Number((hb.preAt / 1000).toFixed(1)),
    stallAfterReadyMs: Math.round(hb.post),
    tipChanges: hb.tips,
    bootStalls: window.__bootStalls || null,
    warm: window.__warmRuns || window.__warm || null,
    zstats: window.__zstats || null,
    fxBake: window.__fxBake || null,
    errors: (window.__errors || []).map((s) => String(s).slice(0, 400)),
  };
}).catch((e) => ({ evalError: String(e.message).slice(0, 300) }));

let late = null;
if (ready && has('late')) {
  late = await page.evaluate(async () => {
    const G = window.__G;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const progs = () => G.renderer.info.programs.slice();
    const before = new Set(progs());
    const steps = [];
    const mark = (what) => { steps.push([what, G.renderer.info.programs.length]); };
    G.params.god = true;
    G.game.start(); await wait(2500); mark('start run');
    for (let i = 0; i < 4; i++) { G.weapon.fire(); await wait(250); }
    await wait(1000); mark('fire');
    const p = G.player.pos;
    const near = (dx, dz) => [p[0] + dx, 0, p[2] + dz];
    const ids = [];
    for (const [dx, dz] of [[2.5, -3], [-2.5, -3], [0, -4]]) { const id = G.zombies.spawn(near(dx, dz), { exact: true }); if (id != null) ids.push(id); }
    await wait(2000); mark(`spawn ${ids.length}`);
    for (const id of ids.slice(0, 2)) G.zombies.damage(id, 99999, 'head', { x: 0, y: 0, z: -1 });
    await wait(2500); mark('kill');
    G.weapon.addThrowable('frag', 2);
    const yaw = G.camera.rotation.y;
    G.weapon.throw();
    await wait(4500); mark('grenade');
    const door = (G.level.doors || []).find((d) => !d.open);
    if (door) G.level.openDoor(door.id);
    await wait(1500); mark(`door ${door ? door.id : '-'}`);
    G.level.setPower(true);
    await wait(2500); mark('power');
    void yaw;
    const fresh = progs().filter((x) => !before.has(x)).map((x) => `${x.name || '(no name)'} [${x.type}] #${x.id}`);
    const unused = progs().filter((x) => !window.__usedPrograms.has(x.program)).map((x) => `${x.name || '(no name)'} [${x.type}] #${x.id}`);
    return { steps, fresh, unused, errors: (window.__errors || []).slice(-10).map((s) => String(s).slice(0, 300)) };
  }).catch((e) => ({ evalError: String(e.message).slice(0, 300) }));
}

const out = { name, args, ready, readyAt, labels, info, late, logs: logs.slice(0, 20) };
console.log(JSON.stringify(out, null, 1));
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 15000))]);
process.exit(0);
