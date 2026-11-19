// The camera must not be thrown at the sky by a mouse report that is not the hand's.
//   node tools/play.mjs tools/scenarios/spike.mjs --live 1 --q high
// Real clicks take the pointer lock; then the page is sent the mouse reports a browser sends when
// it moves its hidden cursor back to the middle of the window (see src/game/look.js).
export default async function ({ ev, log, page }) {
  const st = () =>
    ev(() => {
      const g = TP.game, p = g.player, i = g.input;
      return { mode: g.state.mode, locked: i.locked, raw: i.raw, lockFailed: i.lockFailed, heading: +p.heading.toFixed(4), pitch: +p.pitch.toFixed(4), dropped: i.look.dropped, period: +i.look.period.toFixed(1) };
    });
  await page.waitForTimeout(3500);
  // A plain lock: with raw movement (see raw.mjs) this window would also hear the real mouse of
  // the machine it runs on, and its reports would land among the ones sent below.
  await ev(() => {
    TP.game.input.raw = false;
  });
  await page.getByText('Begin', { exact: true }).first().click();
  await page.waitForTimeout(3000);
  await page.keyboard.press('Space');
  for (let i = 0; i < 25 && (await ev(() => TP.game.state.mode !== 'play' || !!TP.game._cut)); i++) await page.waitForTimeout(1000);
  await page.mouse.click(800, 450);
  await page.waitForTimeout(800);
  const a = await st();
  log('locked', JSON.stringify(a));
  if (!a.locked) {
    log('FAIL: no pointer lock, nothing to test');
    return;
  }

  /** Send reports one per frame; returns the look state after them. */
  const send = async (reports) => {
    await ev(
      (reports) =>
        new Promise((done) => {
          let i = 0;
          const next = () => {
            if (i >= reports.length) return done();
            const [x, y] = reports[i++];
            window.dispatchEvent(new MouseEvent('mousemove', { movementX: x, movementY: y, bubbles: true }));
            requestAnimationFrame(next);
          };
          requestAnimationFrame(next);
        }),
      reports
    );
    await page.waitForTimeout(250);
    return st();
  };
  const rep = (n, r) => Array.from({ length: n }, () => r);
  const k = await ev(() => 0.0021 * TP.game.settings.sensitivity);
  let bad = 0;
  const check = (name, before, after, dx, dy, dropped) => {
    const wantH = before.heading + dx * k,
      wantP = Math.max(-1.5, Math.min(1.5, before.pitch - dy * k));
    const ok = Math.abs(after.heading - wantH) < 0.004 && Math.abs(after.pitch - wantP) < 0.004 && after.dropped - before.dropped === dropped;
    if (!ok) bad++;
    log(`${ok ? 'ok  ' : 'FAIL'}  ${name}: pitch ${before.pitch} -> ${after.pitch} (wanted ${wantP.toFixed(4)}), heading ${before.heading} -> ${after.heading} (wanted ${wantH.toFixed(4)}), dropped ${after.dropped - before.dropped}`);
  };

  // warm up: the filter learns how often reports come
  let s0 = await send(rep(40, [2, 0]));
  log('report period', s0.period, 'ms');
  const h = await ev(() => Math.min(innerHeight, outerHeight || innerHeight)),
    w = await ev(() => Math.min(innerWidth, outerWidth || innerWidth));
  const up = -Math.round(h * 0.35),
    side = Math.round(w * 0.35);

  let s1 = await send([...rep(30, [0, 8]), [0, up], ...rep(10, [0, 8])]);
  check('looking down, one report thrown up by a third of the window', s0, s1, 0, 320, 1);
  let s2 = await send([...rep(20, [0, -6]), [0, -up], [0, up + 12], ...rep(10, [0, -6])]);
  check('looking up, out and back in two reports', s1, s2, 0, -180, 2);
  let s3 = await send([...rep(20, [6, 0]), [-side, 0], ...rep(10, [6, 0])]);
  check('turning, thrown sideways', s2, s3, 180, 0, 1);
  // a real flick: a bell of speed over nine frames, 700 px
  const flick = [8, 30, 80, 140, 184, 140, 80, 30, 8];
  let s4 = await send(flick.map((x) => [x, 0]));
  check('a real flick of 700 px is all there', s3, s4, 700, 0, 0);
  let s5 = await send([[0, -30], [0, -120], [0, -260], [0, -330], [0, -200], [0, -60]]);
  check('a hard look up of 1000 px is all there', s4, s5, 0, -1000, 0);
  log(bad ? `${bad} FAILED` : 'the camera holds');
}
