// Real guest identity + real relay, with invite rooms to avoid public players.
// Run against localhost via Playwright CLI run-code --filename. The module
// routing is test-only; it does not change the production game's matchmaking.
async (page) => {
  const errors = [];
  let isolated = 0;
  const prepare = async p => {
    p.on('pageerror', e => errors.push(e.message));
    p.on('response', r => { if (r.url().includes('/matchmake/') && r.status() >= 400) errors.push('Relay HTTP ' + r.status()); });
    await p.route('**/lib/duel/online-session.ts*', async route => {
      const response = await route.fetch(), body = await response.text();
      if (!body.includes('import { matchmake }')) throw new Error('Unexpected dev module; refuse to enter public queue');
      isolated++;
      await route.fulfill({ response, body: body.replaceAll('matchmake', 'createPrivate') });
    });
    await p.goto('http://localhost:3000/?genex_auth=1');
    await p.waitForFunction(() => document.querySelector('.tutorial-skip') || document.querySelector('.mode-choice'), null, { timeout: 30000 });
    if (await p.locator('.tutorial-skip').count()) await p.getByRole('button', { name: 'Skip Tutorial', exact: true }).click();
  };
  const search = async p => {
    await p.getByRole('button', { name: 'Online Match', exact: true }).click();
    await p.locator('.online-invitation').waitFor({ timeout: 15000 });
  };
  const waitForBot = async p => {
    await p.waitForFunction(() => /^Player [1-9][0-9]$/.test(document.querySelector('.ink-meter.side-1 .ink-meter-name span')?.textContent ?? ''), null, { timeout: 25000 });
    if (!isolated || await p.locator('.online-invitation').count()) throw new Error('Bot transition did not leave the isolated queue');
    if (await p.getByRole('button', { name: 'Keep waiting', exact: true }).count()) throw new Error('Unwanted waiting control');
  };
  await prepare(page); await search(page); await waitForBot(page);
  await page.screenshot({ path: '.genex/scratch/bot-desktop.png', scale: 'css' });
  await page.getByRole('button', { name: 'Open game menu', exact: true }).click();
  await page.getByRole('button', { name: 'Back to menu', exact: true }).click();

  const context = await page.context().browser().newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const mobile = await context.newPage();
  try {
    await prepare(mobile); await search(mobile); await waitForBot(mobile);
    await mobile.getByRole('button', { name: 'Movement stick', exact: true }).waitFor();
    await mobile.screenshot({ path: '.genex/scratch/bot-mobile.png', scale: 'css' });
    await mobile.keyboard.down('KeyD'); await mobile.waitForTimeout(3500); await mobile.keyboard.up('KeyD');
    await mobile.getByRole('button', { name: 'Drop weapon or let go', exact: true }).click();
    await mobile.locator('.game-result').waitFor({ timeout: 20000 });
    await mobile.locator('.game-result').getByRole('button', { name: 'Online Match', exact: true }).waitFor();
    await mobile.screenshot({ path: '.genex/scratch/bot-result-mobile.png', scale: 'css' });
    await search(mobile);
    await mobile.getByRole('button', { name: 'Back to menu', exact: true }).click();
    if (errors.length) throw new Error(errors.join('\n'));
    return { passed: 'Desktop and mobile automatic bots, real fall/result, fresh online search, no extra waiting control.', isolated };
  } finally { await context.close(); }
}
