async (page) => {
  const origin = await page.evaluate(() => location.origin);
  const context = await page.context().browser().newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.addInitScript(() => localStorage.setItem('stick-steel.training.v1', 'complete'));
  const p = await context.newPage(), errors = [];
  p.on('pageerror', e => errors.push(e.message));
  try {
    await p.goto(origin); await p.bringToFront();
    await p.getByRole('button', { name: 'Play with a Bot', exact: true }).waitFor({ timeout: 30000 });
    await p.getByRole('button', { name: 'Play with a Bot', exact: true }).tap();
    const cdp = await context.newCDPSession(p), stick = await p.locator('.touch-stick').boundingBox();
    const x = stick.x + stick.width / 2, y = stick.y + stick.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 50, y, id: 1 }] });
    await p.locator('.ink-meter.side-0').getByText('Holding the edge', { exact: true }).waitFor({ timeout: 6000 });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const before = await p.locator('.ink-meter.side-0').innerText();
    await p.screenshot({ path: 'output/playwright/bot-ledge-approach.png' });
    await p.locator('.ink-meter.side-1').getByText('Winding up', { exact: true }).waitFor({ timeout: 10000 });
    await p.screenshot({ path: 'output/playwright/bot-ledge-windup.png' });
    await p.locator('.ink-meter.side-0').getByText('Falling', { exact: true }).waitFor({ timeout: 10000 });
    const release = await p.locator('.ink-meter.side-0').evaluate(e => ({ hp: e.querySelector('.ink-health').value, stamina: e.querySelector('.ink-stamina').value }));
    if (release.hp >= 100 || release.hp <= 0 || release.stamina < 20) throw new Error('The player must lose grip from a damaging strike, not exhaustion');
    await p.screenshot({ path: 'output/playwright/bot-ledge-hand-hit.png' });
    await p.getByRole('button', { name: /One more round/ }).waitFor({ timeout: 14000 });
    const after = await p.locator('.game-result').innerText();
    await p.screenshot({ path: 'output/playwright/bot-ledge-result.png' });
    if (errors.length) throw new Error(errors.join('\n'));
    return { before, release, after, errors };
  } finally { await context.close(); }
}
