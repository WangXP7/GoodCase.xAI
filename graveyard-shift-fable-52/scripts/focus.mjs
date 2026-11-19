// npm run focus: the conditions a player will hit that nothing else exercises.
// Each case loads the built game in its own page, breaks one thing and checks the game copes.
//   1 pointer lock denied -> drag-look with a notice, still playable
//   2 a long stall (hidden tab) -> dt clamped: nobody teleports, nobody dies of it; lock loss pauses
//   3 player where zombies cannot path (a car roof) -> they gather below, the stuck guard stays quiet
//   4 no audio (before a gesture, and no AudioContext at all) -> silent, no errors
//   5 graphics context lost / no WebGL2 / localStorage throwing -> a readable message or a silent fallback
//   6 walking into a crowd -> the player is stopped by the bodies, never inside one, and can back out
import { launch, pageUrl, watchPage } from './lib.mjs';

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`[focus] ${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`); };
const browser = await launch();

async function open(params, init) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const seen = watchPage(page);
  if (init) await page.addInitScript(init);
  await page.goto(pageUrl(params));
  return { page, seen };
}
const ready = (page) => page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
const errors = (page) => page.evaluate(() => window.__errors || []);

try {
  // ---- 1. pointer lock denied
  {
    const { page } = await open('', () => {
      Element.prototype.requestPointerLock = function () { return Promise.reject(new DOMException('denied', 'SecurityError')); };
    });
    await ready(page);
    await page.getByRole('button', { name: /^Play/ }).click();
    await page.waitForTimeout(400);
    const a = await page.evaluate(() => ({ mode: window.__G.input.mode, state: window.__G.game.state, yaw: window.__G.player.yaw, mag: window.__G.weapon.ammo.mag, notice: [...document.querySelectorAll('[role=status]')].map((n) => n.textContent).join(' | ') }));
    check('lock denied: drag mode, game started', a.mode === 'drag' && a.state === 'playing', a);
    check('lock denied: a notice says how to look and fire', /drag to look/i.test(a.notice), a.notice);
    await page.mouse.move(640, 360); await page.mouse.down(); await page.mouse.move(840, 380, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(200);
    const b = await page.evaluate(() => ({ yaw: window.__G.player.yaw, mag: window.__G.weapon.ammo.mag }));
    check('lock denied: dragging turns the view', Math.abs(b.yaw - a.yaw) > 0.1, { from: a.yaw, to: b.yaw });
    await page.mouse.click(640, 360);
    await page.waitForTimeout(300);
    const c = await page.evaluate(() => window.__G.weapon.ammo.mag);
    check('lock denied: a click fires', c === b.mag - 1, { before: b.mag, after: c });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    check('lock denied: Esc pauses', (await page.evaluate(() => window.__G.game.state)) === 'paused');
    check('lock denied: no errors', (await errors(page)).length === 0, await errors(page));
    await page.close();
  }

  // ---- 2. a long stall, and pausing
  {
    const { page } = await open('autostart=1&spawn=3');
    await ready(page);
    await page.waitForTimeout(1500);
    const snap = () => page.evaluate(() => { const G = window.__G; return { t: G.time.t, sim: G.time.sim, hp: G.player.health, z: G.zombies.list.map((o) => [o.id, o.pos.x, o.pos.z]), alive: G.zombies.alive, state: G.game.state }; });
    const a = await snap();
    await page.evaluate(() => { const end = performance.now() + 4000; while (performance.now() < end); }); // the page does nothing for 4 s
    await page.waitForTimeout(100);
    const b = await snap();
    const moved = Math.max(0, ...b.z.map(([id, x, z]) => { const p = a.z.find((q) => q[0] === id); return p ? Math.hypot(x - p[1], z - p[2]) : 0; }));
    check('stall: 4 s of nothing advances the game by one clamped step, not 4 s', b.sim - a.sim < 0.5, { simAdvanced: +(b.sim - a.sim).toFixed(3) });
    check('stall: no zombie teleports', moved < 1, { farthestMove: +moved.toFixed(2) });
    check('stall: the player is not hurt by it', b.hp >= a.hp - 34 && b.state === 'playing', { hp: [a.hp, b.hp] });
    // pause: the simulation stops, the frame clock and the picture go on; resume continues
    await page.evaluate(() => window.__G.game.pause());
    await page.waitForTimeout(300);
    const p0 = await snap();
    await page.waitForTimeout(1500);
    const p1 = await snap();
    const drift = Math.max(0, ...p1.z.map(([id, x, z]) => { const q = p0.z.find((r) => r[0] === id); return q ? Math.hypot(x - q[1], z - q[2]) : 0; }));
    check('pause: simulation clock and zombies hold still', p1.sim === p0.sim && drift === 0 && p1.state === 'paused', { sim: [p0.sim, p1.sim], drift });
    check('pause: the frame clock keeps running (rain, flicker)', p1.t - p0.t > 1, { t: +(p1.t - p0.t).toFixed(2) });
    await page.evaluate(() => window.__G.game.resume());
    await page.waitForTimeout(500);
    const p2 = await snap();
    check('pause: resume carries on', p2.sim > p1.sim && p2.state === 'playing');
    check('stall and pause: no errors', (await errors(page)).length === 0, await errors(page));
    await page.close();
  }

  // ---- 3. player where zombies cannot path
  {
    const { page } = await open('autostart=1&god=1&round=3&warp=4');
    await ready(page);
    // stand on the roof of the pickup under the canopy
    const roof = await page.evaluate(() => {
      const G = window.__G;
      const hit = G.level.raycast([4.2, 4, -8.7], [0, -1, 0], 6); // from above the pickup, under the canopy deck
      G.player.pos = [4.2, hit ? hit.pos[1] ?? hit.pos.y : 1.6, -8.7];
      G.player.vel = [0, 0, 0];
      return G.player.pos;
    });
    await page.waitForTimeout(9000); // ~36 s of game time
    const r = await page.evaluate(() => {
      const G = window.__G; const p = G.player.pos;
      return {
        pos: p.map((v) => +v.toFixed(2)), walkable: G.nav.grid.walkable(p[0], p[2]), alive: G.zombies.alive, stuck: G.zombies.stats.stuck, spawned: G.zombies.stats.spawned,
        near: G.zombies.list.filter((z) => Math.hypot(z.pos.x - p[0], z.pos.z - p[2]) < 4.5).length, sim: +G.time.sim.toFixed(1), hp: G.player.health,
      };
    });
    check('unreachable: the player is on a roof, off the nav grid', r.pos[1] > 1 && r.walkable === false, { roof, pos: r.pos });
    check('unreachable: zombies gather at the nearest ground', r.near >= Math.min(4, r.alive), r);
    check('unreachable: the stuck guard does not thrash', r.stuck <= 2, { stuck: r.stuck, spawned: r.spawned, sim: r.sim });
    check('unreachable: no errors', (await errors(page)).length === 0, await errors(page));
    await page.close();
  }

  // ---- 4. audio
  {
    const { page } = await open('autostart=1&bot=1&warp=4'); // no gesture ever: the context is never created
    await ready(page);
    await page.waitForTimeout(5000);
    const a = await page.evaluate(() => ({ ready: window.__G.audio.ready, shots: window.__G.player.bot.brain.shots, kills: window.__G.game.kills }));
    check('audio before any gesture: silent, the game runs', a.ready === false && a.shots > 3, a);
    check('audio before any gesture: no errors', (await errors(page)).length === 0, await errors(page));
    await page.close();
    const second = await open('bot=1&warp=4', () => { delete window.AudioContext; delete window.webkitAudioContext; window.AudioContext = undefined; window.webkitAudioContext = undefined; });
    await ready(second.page);
    await second.page.getByRole('button', { name: /^Play/ }).click(); // a gesture, with no AudioContext to make
    await second.page.waitForTimeout(4000);
    const b = await second.page.evaluate(() => ({ ready: window.__G.audio.ready, state: window.__G.game.state, shots: window.__G.player.bot.brain.shots }));
    check('no AudioContext: silent, the game runs', b.ready === false && b.state === 'playing' && b.shots > 3, b);
    check('no AudioContext: no errors', (await errors(second.page)).length === 0, await errors(second.page));
    await second.page.close();
    const third = await open('bot=1&warp=4', () => { window.AudioContext = function () { throw new Error('audio device unavailable'); }; window.webkitAudioContext = window.AudioContext; });
    await ready(third.page);
    await third.page.getByRole('button', { name: /^Play/ }).click();
    await third.page.waitForTimeout(3000);
    const c = await third.page.evaluate(() => ({ ready: window.__G.audio.ready, state: window.__G.game.state, shots: window.__G.player.bot.brain.shots }));
    check('AudioContext throws: silent, the game runs, no errors', c.ready === false && c.state === 'playing' && c.shots > 3 && (await errors(third.page)).length === 0, { ...c, errors: await errors(third.page) });
    await third.page.close();
  }

  // ---- 5. graphics and storage
  {
    const { page } = await open('autostart=1');
    await ready(page);
    await page.evaluate(() => { const gl = window.__G.renderer.getContext(); gl.getExtension('WEBGL_lose_context').loseContext(); });
    await page.waitForTimeout(800);
    const a = await page.evaluate(() => { const el = document.getElementById('gfx-lost'); return { shown: !!el && el.getBoundingClientRect().width > 0, text: el ? el.textContent : null, reload: !!(el && el.querySelector('button')) }; });
    check('context lost: a readable message with a Reload button', a.shown && /context lost/i.test(a.text || '') && a.reload, a);
    await page.close();

    const two = await open('', () => {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return /webgl/.test(type) ? null : orig.call(this, type, ...rest); };
    });
    await two.page.waitForTimeout(6000);
    const b = await two.page.evaluate(() => {
      const el = document.getElementById('gfx-unsupported');
      const boot = document.getElementById('boot');
      return { shown: !!el && el.getBoundingClientRect().width > 0, text: el ? el.textContent.slice(0, 60) : null, bootGone: !boot || boot.classList.contains('done'), ready: window.__ready, errors: (window.__errors || []).length };
    });
    check('no WebGL2: a readable message, not a black page', b.shown && /WebGL2/.test(b.text || ''), b);
    await two.page.close();

    const three = await open('autostart=1&bot=1&god=1', () => {
      Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('denied', 'SecurityError'); } });
    });
    await ready(three.page);
    await three.page.waitForTimeout(2500);
    const c = await three.page.evaluate(() => ({ state: window.__G.game.state, best: window.__G.game.best, round: window.__G.game.round }));
    // die, so the best round is written through the throwing store
    await three.page.evaluate(() => { const G = window.__G; G.params.god = false; G.player.damage(1000, [0, 0, -1]); });
    await three.page.waitForTimeout(500);
    const d = await three.page.evaluate(() => ({ state: window.__G.game.state, best: window.__G.game.best }));
    check('localStorage throws: boots, plays, dies and records the best round in memory, no errors', c.state === 'playing' && d.state === 'dead' && d.best >= 1 && (await errors(three.page)).length === 0, { c, d, errors: await errors(three.page) });
    await three.page.close();
  }

  // ---- 6. zombies are solid
  {
    // stand still (god mode) until a crowd has closed in, then try to walk out through it
    const { page } = await open('autostart=1&god=1&round=5&warp=3');
    await ready(page);
    const crowded = () => { const G = window.__G; const p = G.player.pos; return G.zombies.list.filter((z) => Math.hypot(z.pos.x - p[0], z.pos.z - p[2]) < 2.2).length; };
    await page.waitForFunction(`(${crowded})() >= 7`, null, { timeout: 120000 });
    const r = await page.evaluate(() => new Promise((resolve) => {
      const G = window.__G; const p = G.player;
      const near = G.zombies.list.filter((z) => Math.hypot(z.pos.x - p.pos[0], z.pos.z - p.pos[2]) < 2.2);
      // straight at the middle of the thickest side
      let dir = [near.reduce((s, z) => s + z.pos.x - p.pos[0], 0), near.reduce((s, z) => s + z.pos.z - p.pos[2], 0)];
      const dl = Math.hypot(dir[0], dir[1]) || 1; dir = [dir[0] / dl, dir[1] / dl];
      const start = p.pos.slice();
      let minGap = Infinity; let n = 0; let between = 0;
      const tick = () => {
        p.yaw = Math.atan2(-dir[0], -dir[1]); // face that way; the W key does the walking
        let left = false, right = false;
        for (const z of G.zombies.list) {
          const dx = z.pos.x - p.pos[0], dz = z.pos.z - p.pos[2];
          const d = Math.hypot(dx, dz); minGap = Math.min(minGap, d);
          const along = dx * dir[0] + dz * dir[1], side = dx * dir[1] - dz * dir[0];
          if (d < 0.85 && Math.abs(along) < 0.35) { if (side > 0.2) right = true; if (side < -0.2) left = true; }
        }
        if (left && right) between++;
        if (++n < 360) requestAnimationFrame(tick);
        else {
          window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
          resolve({ crowd: near.length, alive: G.zombies.alive, pushedFor: '6 s', moved: +Math.hypot(p.pos[0] - start[0], p.pos[2] - start[2]).toFixed(2), minGap: +minGap.toFixed(3), framesBetweenTwoBodies: between, finite: p.pos.every(Number.isFinite) });
        }
      };
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
      requestAnimationFrame(tick);
    }));
    // (attackers put themselves as close as 0.3 m, their own floor; the player's walking must not get closer than that)
    check('solid zombies: pushing into a crowd never gets closer than the zombies\' own 0.3 m floor', r.minGap >= 0.29 && r.finite, r);
    check('solid zombies: the crowd holds the player (under 3 m in 6 s of walking at 4.2 m/s)', r.moved < 3, r);
    check('solid zombies: no errors', (await errors(page)).length === 0, await errors(page));
    await page.close();
  }
} catch (e) {
  check(`harness: ${e.message.split('\n')[0]}`, false);
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`[focus] ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
