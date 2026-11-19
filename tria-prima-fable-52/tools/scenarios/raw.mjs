// The game asks the browser for the mouse's own movement (raw input) when it takes the pointer
// lock: the browser then keeps no hidden cursor to put back in the middle of the window, which is
// where the camera jumps came from (src/game/look.js). That the request is granted is checked here.
//   node tools/play.mjs tools/scenarios/raw.mjs --live 1 --q high
// It is checked nowhere else on purpose: a window that reads the mouse itself hears the real mouse
// of the machine the test runs on, so the scenarios that measure angles take a plain lock.
export default async function ({ ev, log, page }) {
  const st = () =>
    ev(() => {
      const i = TP.game.input;
      return { mode: TP.game.state.mode, locked: i.locked, raw: i.raw, lockFailed: i.lockFailed };
    });
  await page.waitForTimeout(3500);
  await page.getByText('Begin', { exact: true }).first().click();
  await page.waitForTimeout(1500);
  const s = await st();
  log(JSON.stringify(s));
  if (!s.locked) log('FAIL: no pointer lock');
  else if (s.raw === true) log('the lock is raw: the browser reads the mouse itself');
  else log('locked, but this browser gives no raw movement: the look filter is the only guard');
}
