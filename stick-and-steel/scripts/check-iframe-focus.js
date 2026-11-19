async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1280, height: 880 }, hasTouch: true, isMobile: true });
  const test = await context.newPage(), errors = [];
  test.on('pageerror', e => errors.push(e.message));
  await context.addInitScript(() => { try { localStorage.setItem('stick-steel.training.v1', 'complete'); } catch {} });
  await test.route('http://localhost:3000/iframe-review', route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0;background:#eee"><button id="outside" style="height:60px">Outside the game</button><iframe title="Game" src="http://localhost:3000" style="width:100%;height:800px;border:0"></iframe></body>' }));
  try {
    await test.goto('http://localhost:3000/iframe-review');
    const game = test.frameLocator('iframe');
    await game.locator('.mode-choice').waitFor({ timeout: 30000 });
    await game.getByRole('group', { name: 'Choose your weapon' }).getByRole('button', { name: 'Arming sword', exact: true }).click();
    await test.locator('#outside').click(); await test.waitForTimeout(350);
    if (await game.getByRole('dialog').count()) throw new Error('Clicking outside the menu iframe opened a dialog');
    await game.getByRole('button', { name: 'Play with a Bot', exact: true }).click();
    await game.locator('.battle-leaderboard').waitFor();
    await test.locator('#outside').click(); await test.waitForTimeout(350);
    if (await game.getByRole('dialog').count()) throw new Error('Clicking outside the duel iframe opened a dialog');
    await game.locator('.battle-leaderboard').click();
    await game.getByRole('heading', { name: 'The leaderboard.', exact: true }).waitFor();
    if (await game.getByText(/Online bouts only|wins first, then bouts played/).count()) throw new Error('Verbose leaderboard copy remains');
    await game.getByRole('button', { name: 'Back to battle', exact: true }).click();
    await game.getByRole('dialog').waitFor({ state: 'hidden' });
    if (await game.locator('.mode-choice').count()) throw new Error('Closing the duel leaderboard reset the bout');
    await game.getByRole('button', { name: 'Open game menu' }).click();
    await game.getByRole('dialog').waitFor();
    await test.screenshot({ path: 'output/playwright/iframe-focus-review.png' });
    if (errors.length) throw new Error(errors.join('\n'));
    return 'Outside clicks preserve menu/duel view; explicit Menu works; duel leaderboard returns to the same bout.';
  } finally { await context.close(); }
}
