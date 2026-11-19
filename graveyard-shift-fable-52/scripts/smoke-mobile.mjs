// npm run smoke:mobile [-- --round 3] [--seconds 300]
//
// Phone emulation (844x390, DPR 3, touch, mobile UA). Part 1 drives the game by touch events only,
// through the real on-screen controls, located with __touch: Play, stick, look, fire, reload, three
// fingers at once, a cancelled finger, portrait -> landscape -> portrait while playing (no pause; the
// landscape suggestion; fingers cancelled, buttons re-laid, nothing stuck), pause. The mechanics part:
// FIRE held 1.5 s is one shot with the pistol and many with the SMG, the FIRE glyph follows the mode,
// a tap in the stick zone jumps and a drag there moves without jumping, and nothing listens to device
// motion (tilt to look was removed). Part 2 is the bot under phone emulation (bot=1&touch=1&god=1&warp=4)
// to round 3. Fails on any __errors entry.
import { parseArgs } from 'node:util';
import { launch, pageUrl, watchPage, touchDriver } from './lib.mjs';

const { values: a } = parseArgs({ options: { round: { type: 'string', default: '3' }, seconds: { type: 'string', default: '300' } } });
const goalRound = Number(a.round);
let browser; let code = 0;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { console.log(`[smoke:mobile] FAIL ${m}`); code = 1; };
const check = (name, ok, detail = '') => { console.log(`[smoke:mobile] ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`); if (!ok) code = 1; };

const read = (page) => page.evaluate(() => {
  const G = window.__G; const s = window.__stats();
  const w = G.weapon && G.weapon.ammo ? G.weapon.ammo : {};
  return {
    state: s.state, inputMode: s.inputMode, round: s.round, errors: (window.__errors || []).length,
    pos: G.player.pos.slice(), yaw: G.player.yaw, mag: w.mag, reloading: !!(G.weapon && G.weapon.reloading),
    move: Math.hypot(G.input.move.x, G.input.move.y), fire: !!G.input.fire, look: Math.hypot(G.input.touchLook.dx, G.input.touchLook.dy),
    paused: G.game.state === 'paused',
  };
});
const touchRects = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__touch)));
const btn = (t, name) => { const b = t.buttons.find((x) => x.name === name); if (!b) throw new Error(`no ${name} button in __touch (${t.buttons.map((x) => x.name)})`); return b; };
// __touch buttons are circles {x, y, r} (centre); zones are rectangles {x, y, w, h}
const center = (b) => (b.w === undefined ? [b.x, b.y] : [b.x + b.w / 2, b.y + b.h / 2]);
const untilTrue = async (page, fn, ms = 3000, arg) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await page.evaluate(fn, arg)) return true; await wait(50); } return false; };

// A menu button by its visible text, tapped where it is on screen.
async function tapText(page, td, re) {
  const loc = page.locator('.gs-screen.on button').filter({ hasText: re }).first();
  await loc.waitFor({ state: 'visible', timeout: 5000 });
  const box = await loc.boundingBox();
  await td.tap(box.x + box.width / 2, box.y + box.height / 2);
}

// Every drawn .gs-tb-* button against its __touch circle: centre and radius within 4 px.
async function drift(page, label) {
  const rows = await page.evaluate(() => window.__touch.buttons.map((b) => {
    const el = document.querySelector(`.gs-tb-${b.name}`);
    if (!el || el.hidden) return { name: b.name, missing: true };
    const r = el.getBoundingClientRect();
    return { name: b.name, dx: r.left + r.width / 2 - b.x, dy: r.top + r.height / 2 - b.y, dr: r.width / 2 - b.r };
  }));
  const bad = rows.filter((r) => r.missing || Math.abs(r.dx) > 4 || Math.abs(r.dy) > 4 || Math.abs(r.dr) > 4);
  check(`${label}: drawn buttons match __touch (${rows.length}, drift <= 4 px)`, rows.length >= 8 && bad.length === 0, bad.map((r) => `${r.name} ${r.missing ? 'missing' : `${r.dx.toFixed(1)},${r.dy.toFixed(1)},${r.dr.toFixed(1)}`}`).join(' '));
}
const inSafe = (page, safe) => page.evaluate((s) => {
  const w = innerWidth, h = innerHeight;
  return window.__touch.buttons.filter((b) => b.x - b.r < s.left - 1 || b.x + b.r > w - s.right + 1 || b.y - b.r < s.top - 1 || b.y + b.r > h - s.bottom + 1).map((b) => b.name);
}, safe);
const newTouchPage = async ({ lefty = false, insets = null, params = 'god=1' } = {}) => {
  const page = await browser.newPage();
  if (lefty) await page.addInitScript(() => localStorage.setItem('graveyard-shift.settings', '{"lefty":true}'));
  let cdp = null;
  if (insets) { cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets }); }
  await page.goto(pageUrl(params));
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  return { page, cdp };
};

async function part1() {
  const page = await browser.newPage();
  const extra = watchPage(page);
  await page.goto(pageUrl('god=1'));
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  const td = await touchDriver(page);
  try {
    let p = await read(page);
    check('starts on the title', p.state === 'title');
    await tapText(page, td, /^play/i);
    check('tap Play -> playing, touch mode', await untilTrue(page, () => window.__stats().state === 'playing' && window.__stats().inputMode === 'touch', 5000), JSON.stringify(await read(page)));
    check('controls registered', await untilTrue(page, () => window.__touch.buttons.length >= 8, 3000));
    await wait(600);
    let t = await touchRects(page);
    const stick = t.sticks[0];

    // stick up for 1 s
    p = await read(page);
    const sx = stick.x + stick.w * 0.45, sy = stick.y + stick.h * 0.6;
    await td.down(1, sx, sy); await td.move(1, sx, sy - 70);
    await wait(1000);
    const q = await read(page);
    await td.up(1);
    const moved = Math.hypot(q.pos[0] - p.pos[0], q.pos[2] - p.pos[2]);
    check('stick up 1 s moves >= 3.5 m', moved >= 3.5, `${moved.toFixed(2)} m`);
    await wait(300);

    // look drag, 200 px, slow enough that the speed boost is off
    p = await read(page);
    const lx = t.look.x + t.look.w * 0.35, ly = t.look.y + t.look.h * 0.3;
    await td.drag(2, [lx, ly], [lx + 200, ly], 2500);
    await wait(200);
    q.yaw = (await read(page)).yaw;
    let dy = q.yaw - p.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    check('look drag 200 px turns 1.04 rad +-15%', Math.abs(Math.abs(dy) - 1.04) <= 1.04 * 0.15, `${Math.abs(dy).toFixed(3)} rad`);

    // hold FIRE: the magazine falls
    const fire = btn(t, 'fire');
    p = await read(page);
    await td.down(3, ...center(fire)); await wait(900); await td.up(3);
    await wait(100);
    q.mag = (await read(page)).mag;
    check('hold FIRE: mag falls', q.mag < p.mag, `${p.mag} -> ${q.mag}`);

    // tap RELOAD
    const reload = btn(t, 'reload');
    await td.tap(...center(reload));
    check('tap RELOAD: reloading', await untilTrue(page, () => window.__G.weapon.reloading === true, 1200));
    await untilTrue(page, () => window.__G.weapon.reloading === false, 6000);

    await drift(page, 'right-handed');
    // ADS toggles on a tap and off on the next
    await td.tap(...center(btn(t, 'ads')));
    check('tap AIM: ads on', await untilTrue(page, () => window.__G.input.ads === true, 800));
    await td.tap(...center(btn(t, 'ads')));
    check('tap AIM again: ads off', await untilTrue(page, () => window.__G.input.ads === false, 800));
    // JUMP is a hold
    await td.down(5, ...center(btn(t, 'jump')));
    check('hold JUMP: jump held', await untilTrue(page, () => window.__G.input.jump === true, 800));
    await td.up(5);
    // MELEE and THROW
    await page.evaluate(() => { const G = window.__G; window.__ev = { melee: 0, throw: 0, buy: 0 }; G.events.on('weapon:melee', () => window.__ev.melee++); G.events.on('throw', () => window.__ev.throw++); G.events.on('buy', () => window.__ev.buy++); G.weapon.addThrowable('frag', 1); });
    await td.tap(...center(btn(t, 'melee')));
    check('tap MELEE: swings', await untilTrue(page, () => window.__ev.melee >= 1, 1500));
    await wait(600);
    await td.tap(...center(btn(t, 'throw')));
    check('tap THROW: throws', await untilTrue(page, () => window.__ev.throw >= 1, 1500));
    // INTERACT: appears at the ammo wall, a tap buys, a hold registers as held
    await page.evaluate(() => { const p = window.__G.player.pos; p[0] = 6; p[2] = -18.8; });
    check('INTERACT appears at the ammo wall', await untilTrue(page, () => window.__touch.buttons.some((b) => b.name === 'interact'), 3000));
    await wait(400);
    t = await touchRects(page);
    await drift(page, 'with interact');
    await td.down(6, ...center(btn(t, 'interact')));
    check('hold INTERACT: held', await untilTrue(page, () => window.__G.input.held('interact') > 0, 800));
    await td.up(6);
    check('INTERACT bought ammo', await untilTrue(page, () => window.__ev.buy >= 1, 1500));
    // SWAP: with a second weapon in hand the held weapon changes
    await page.evaluate(() => window.__G.weapon.give('revolver'));
    const before = await page.evaluate(() => window.__G.weapon.id);
    await wait(900);
    await td.tap(...center(btn(await touchRects(page), 'swap')));
    check('tap SWAP: weapon changes', await untilTrue(page, (id) => window.__G.weapon.id !== id, 2000, before));
    await wait(900);

    // stick + look + FIRE with three fingers, all registered in one frame
    await page.evaluate(() => {
      const G = window.__G; window.__frames = []; window.__sampling = true;
      const loop = () => { if (!window.__sampling) return; window.__frames.push({ move: Math.hypot(G.input.move.x, G.input.move.y) > 0.3, fire: G.input.touch.state.buttons.fire, look: Math.hypot(G.input.touchLook.dx, G.input.touchLook.dy) > 0 }); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    });
    await td.down(4, lx, ly);
    await td.down(1, sx, sy); await td.move(1, sx, sy - 60);
    await td.down(3, ...center(fire));
    for (let i = 0; i < 25; i++) { await td.move(4, lx + 3 * i, ly); await wait(16); }
    const frames = await page.evaluate(() => { window.__sampling = false; return window.__frames; });
    const both = frames.filter((f) => f.move && f.fire && f.look).length;
    check('stick + look + FIRE register in one frame', both >= 1, `${both} of ${frames.length} frames`);
    await td.releaseAll();
    await wait(200);

    // cancel mid-drag: movement is back to 0 on the next frame
    await td.down(1, sx, sy); await td.move(1, sx, sy - 60);
    await wait(250);
    const mid = await read(page);
    await td.cancel(1);
    await wait(120);
    const after = await read(page);
    check('cancel mid-drag: move back to 0', mid.move > 0.3 && after.move === 0, `${mid.move.toFixed(2)} -> ${after.move}`);
    await wait(150);

    // rotation while playing: portrait -> landscape -> portrait. Upright plays (no pause, no blocking
    // card): the suggestion shows, a finger held through the turn is cancelled, the buttons are re-laid
    // for the new shape (all on screen, drawn where __touch says), nothing stays held.
    const onScreen = () => page.evaluate(() => window.__touch.buttons.filter((b) => b.x - b.r < -1 || b.y - b.r < -1 || b.x + b.r > innerWidth + 1 || b.y + b.r > innerHeight + 1).map((b) => b.name));
    const stuck = () => page.evaluate(() => { const G = window.__G; const st = G.input.touch.state; return { move: Math.hypot(G.input.move.x, G.input.move.y), look: Math.hypot(G.input.touchLook.dx, G.input.touchLook.dy), fire: !!G.input.fire, buttons: Object.keys(st.buttons).filter((k) => st.buttons[k]) }; });
    const turn = async (w, h, tag) => {
      t = await touchRects(page);
      const sz = t.sticks[0];
      await td.down(1, sz.x + sz.w * 0.45, sz.y + sz.h * 0.6); await td.move(1, sz.x + sz.w * 0.45, sz.y + sz.h * 0.6 - 60);
      await td.down(4, t.look.x + t.look.w * 0.5, t.look.y + t.look.h * 0.3);
      check(`${tag}: stick held before the turn`, await untilTrue(page, () => Math.hypot(window.__G.input.move.x, window.__G.input.move.y) > 0.3, 800));
      await page.setViewportSize({ width: w, height: h });
      check(`${tag}: still playing (no pause)`, await untilTrue(page, () => window.__G.game.state === 'playing', 1500) && await page.evaluate(() => window.__G.game.state === 'playing'));
      check(`${tag}: fingers held through the turn are cancelled`, await untilTrue(page, () => Math.hypot(window.__G.input.move.x, window.__G.input.move.y) === 0, 1500), JSON.stringify(await stuck()));
      check(`${tag}: controls re-laid for ${w}x${h}`, await untilTrue(page, (W) => window.__touch.buttons.length >= 8 && Math.abs(window.__touch.look.x + window.__touch.look.w - W) < 2, 2000, w));
      await wait(300);
      check(`${tag}: every button on screen`, (await onScreen()).length === 0, (await onScreen()).join(' '));
      await drift(page, tag);
      await td.up(1); await td.up(4);
      await wait(150);
      const s1 = await stuck();
      check(`${tag}: nothing stuck after release`, s1.move === 0 && s1.look === 0 && !s1.fire && s1.buttons.length === 0, JSON.stringify(s1));
    };
    const turnHint = () => page.evaluate(() => { const e = document.querySelector('.gs-turn'); const r = e && e.getBoundingClientRect(); return e ? { shown: !e.hidden && r.width > 0, mini: e.classList.contains('mini'), text: e.textContent, top: r.top, bottom: r.bottom } : null; });
    await turn(390, 844, 'to portrait');
    let hint = await turnHint();
    check('portrait: "Turn your phone sideways" toast shows', !!hint && hint.shown && !hint.mini && /sideways for a bigger view/.test(hint.text), JSON.stringify(hint));
    check('portrait: the toast is above the crosshair', !!hint && hint.bottom < 844 / 2 - 30, JSON.stringify(hint));
    await turn(844, 390, 'back to landscape');
    hint = await turnHint();
    check('landscape: the suggestion is gone', !!hint && !hint.shown, JSON.stringify(hint));
    await turn(390, 844, 'portrait again');
    hint = await turnHint();
    check('portrait again: the suggestion shows (toast or glyph)', !!hint && hint.shown, JSON.stringify(hint));
    // a tap on it hides it for the session, and the tap is not a look or a shot
    const yaw0 = (await read(page)).yaw;
    const hb = await page.evaluate(() => { const r = document.querySelector('.gs-turn').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    await td.tap(...hb);
    check('tap the suggestion: hidden', await untilTrue(page, () => document.querySelector('.gs-turn').hidden === true, 1000));
    check('the tap did not turn the view', Math.abs((await read(page)).yaw - yaw0) < 1e-6);
    check('dismissal remembered for the session', await page.evaluate(() => sessionStorage.getItem('graveyard-shift.turnHint') === '1'));
    await turn(844, 390, 'landscape to finish');
    await wait(300);

    // PAUSE
    t = await touchRects(page);
    await td.tap(...center(btn(t, 'pause')));
    check('tap PAUSE -> paused', await untilTrue(page, () => window.__G.game.state === 'paused', 3000));
  } finally {
    await td.close().catch(() => {});
  }
  const errors = await page.evaluate(() => window.__errors || []);
  const all = [...errors, ...extra.filter((e) => !errors.some((x) => x.includes(e.slice(15, 60))))];
  check('no errors in the touch sequence', all.length === 0, all.join(' | '));
  await page.close();
}

// Fire modes, tap to jump; tilt to look is gone.
async function partMechanics() {
  const { page } = await newTouchPage({ params: 'autostart=1&god=1' });
  const extra = watchPage(page);
  const td = await touchDriver(page);
  try {
    check('mechanics: controls up', await untilTrue(page, () => window.__touch.buttons.length >= 8 && window.__G.game.state === 'playing', 8000));
    await page.evaluate(() => {
      const G = window.__G; window.__shots = 0;
      G.events.on('weapon:fire', (e) => { if (!e.dry) window.__shots++; });
    });
    await wait(700);
    let t = await touchRects(page);
    const fire = btn(t, 'fire');
    const holdFire = async (ms) => {
      await page.evaluate(() => { window.__shots = 0; });
      await td.down(3, ...center(fire)); await wait(ms); await td.up(3);
      await wait(150);
      return page.evaluate(() => window.__shots);
    };
    const glyph = () => page.evaluate(() => { const e = document.querySelector('.gs-tb-fire'); return { auto: e.classList.contains('auto'), title: e.title }; });
    check('pistol: FIRE shows the single-shot glyph', !(await glyph()).auto, JSON.stringify(await glyph()));
    const pistolShots = await holdFire(1500);
    check('pistol: holding FIRE 1.5 s fires exactly 1 shot', pistolShots === 1, `${pistolShots} shots`);
    await page.evaluate(() => { const G = window.__G; G.weapon.give('smg'); });
    await wait(1100);
    check('SMG: FIRE shows the automatic glyph', (await glyph()).auto, JSON.stringify(await glyph()));
    const smgShots = await holdFire(1500);
    check('SMG: holding FIRE 1.5 s fires many', smgShots >= 10, `${smgShots} shots`);

    // tap in the stick zone: a jump; a drag there: a move and no jump
    const stick = t.sticks[0];
    const sx = stick.x + stick.w * 0.45, sy = stick.y + stick.h * 0.6;
    const sample = async (fn) => {
      await page.evaluate(() => {
        const G = window.__G; window.__y0 = G.player.pos[1]; window.__rise = 0; window.__sampling = true;
        const loop = () => { if (!window.__sampling) return; window.__rise = Math.max(window.__rise, G.player.pos[1] - window.__y0); requestAnimationFrame(loop); };
        requestAnimationFrame(loop);
      });
      const p0 = (await read(page)).pos;
      await fn();
      const rise = await page.evaluate(() => { window.__sampling = false; return window.__rise; });
      const p1 = (await read(page)).pos;
      return { rise, moved: Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) };
    };
    const tapped = await sample(async () => { await td.tap(sx, sy); await wait(700); });
    check('tap the stick zone: jumps', tapped.rise > 0.3, `rise ${tapped.rise.toFixed(2)} m, moved ${tapped.moved.toFixed(2)} m`);
    await wait(400);
    const dragged = await sample(async () => { await td.drag(1, [sx, sy], [sx, sy - 70], 200, { hold: true }); await wait(600); await td.up(1); await wait(500); });
    check('drag in the stick zone: moves, no jump', dragged.moved > 1 && dragged.rise < 0.05, `rise ${dragged.rise.toFixed(2)} m, moved ${dragged.moved.toFixed(2)} m`);

    // tilt to look was removed: nothing listens to motion, and Settings has no Look or Tilt row
    const noTilt = await page.evaluate(async () => {
      const G = window.__G;
      const y0 = G.player.yaw;
      for (let i = 0; i < 30; i++) { window.dispatchEvent(new Event('devicemotion')); await new Promise((r) => setTimeout(r, 16)); }
      const rows = [...document.querySelectorAll('.gs-settings .gs-set .l')].map((e) => e.textContent);
      return { gyro: 'gyro' in G.input, turned: Math.abs(G.player.yaw - y0), rows: rows.filter((r) => /look|tilt/i.test(r)) };
    });
    check('no tilt: no G.input.gyro, no Look/Tilt settings row, motion events do nothing', !noTilt.gyro && noTilt.rows.length === 0 && noTilt.turned < 1e-6, JSON.stringify(noTilt));
  } finally {
    await td.close().catch(() => {});
  }
  const errors = await page.evaluate(() => window.__errors || []);
  const all = [...errors, ...extra.filter((e) => !errors.some((x) => x.includes(e.slice(15, 60))))];
  check('no errors in the mechanics run', all.length === 0, all.join(' | '));
  await page.close();
}

async function partLefty() {
  const { page } = await newTouchPage({ lefty: true, params: 'autostart=1&god=1' });
  const td = await touchDriver(page);
  try {
    check('lefty: controls up', await untilTrue(page, () => window.__touch.buttons.length >= 8, 8000));
    await wait(500);
    const t = await touchRects(page);
    const w = await page.evaluate(() => innerWidth);
    check('lefty: FIRE on the left, PAUSE on the right, stick zone on the right', btn(t, 'fire').x < w / 2 && btn(t, 'pause').x > w / 2 && t.sticks[0].x > w / 2 - 1);
    await drift(page, 'lefty');
    await td.down(3, ...center(btn(t, 'fire')));
    check('lefty: hold FIRE registers', await untilTrue(page, () => window.__G.input.touch.state.buttons.fire === true, 800));
    await td.up(3);
    await td.down(1, t.sticks[0].x + t.sticks[0].w * 0.5, t.sticks[0].y + t.sticks[0].h * 0.6);
    await td.move(1, t.sticks[0].x + t.sticks[0].w * 0.5, t.sticks[0].y + t.sticks[0].h * 0.6 - 60);
    check('lefty: the right-hand stick moves the player', await untilTrue(page, () => Math.hypot(window.__G.input.move.x, window.__G.input.move.y) > 0.5, 800));
    check('stick is drawn under the thumb', await page.evaluate(() => { const e = document.querySelector('.gs-stick'); return e.classList.contains('on') && e.getBoundingClientRect().width > 50; }));
    await td.up(1);
  } finally { await td.close().catch(() => {}); }
  const errors = await page.evaluate(() => window.__errors || []);
  check('no errors in the left-handed run', errors.length === 0, errors.join(' | '));
  await page.close();
}

async function partNotch() {
  for (const insets of [{ top: 0, left: 47, bottom: 21, right: 0 }, { top: 0, left: 0, bottom: 21, right: 47 }]) {
    const { page, cdp } = await newTouchPage({ insets, params: 'autostart=1&god=1' });
    try {
      const tag = `notch L${insets.left} R${insets.right}`;
      check(`${tag}: controls up`, await untilTrue(page, () => window.__touch.buttons.length >= 8, 8000));
      await wait(500);
      check(`${tag}: no button under the inset`, (await inSafe(page, insets)).length === 0, (await inSafe(page, insets)).join(' '));
      await drift(page, tag);
      // the phone turns 180 degrees: insets change sides, orientationchange fires, there is no resize
      const flip = { top: 0, left: insets.right, bottom: 21, right: insets.left };
      await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: flip });
      await page.evaluate(() => window.dispatchEvent(new Event('orientationchange')));
      await wait(600);
      check(`${tag}: after the 180 degree flip no button is under the new inset`, (await inSafe(page, flip)).length === 0, (await inSafe(page, flip)).join(' '));
      await drift(page, `${tag} flipped`);
      const errors = await page.evaluate(() => window.__errors || []);
      check(`${tag}: no errors`, errors.length === 0, errors.join(' | '));
    } finally { await page.close(); }
  }
}

async function part2() {
  const page = await browser.newPage();
  const extra = watchPage(page);
  const t0 = Date.now();
  await page.goto(pageUrl('autostart=1&bot=1&touch=1&god=1&warp=4'));
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  let p;
  for (;;) {
    await wait(500);
    p = await read(page);
    if (p.errors) { fail('errors during the bot run'); break; }
    if (p.round >= goalRound) break;
    if (p.state === 'dead') { fail('died under god mode'); break; }
    if ((Date.now() - t0) / 1000 > Number(a.seconds)) { fail(`round ${goalRound} not reached in ${a.seconds}s (round ${p.round})`); break; }
  }
  check(`bot under phone emulation reaches round ${goalRound}`, p.round >= goalRound && p.inputMode === 'touch', `round ${p.round}, ${p.inputMode}, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  const errors = await page.evaluate(() => window.__errors || []);
  const all = [...errors, ...extra.filter((e) => !errors.some((x) => x.includes(e.slice(15, 60))))];
  check('no errors in the bot run', all.length === 0, all.join(' | '));
  await page.close();
}

try {
  browser = await launch({ device: 'phone' });
  await part1();
  await partMechanics();
  await partLefty();
  await partNotch();
  await part2();
} catch (e) {
  console.error(`[smoke:mobile] failed: ${e.message}`); code = 1;
} finally {
  if (browser) await browser.close();
}
console.log(code ? '[smoke:mobile] FAILED' : '[smoke:mobile] OK no errors');
process.exit(code);
