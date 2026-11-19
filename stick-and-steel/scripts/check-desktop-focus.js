async (page) => {
  await page.bringToFront();
  await page.locator('.mode-choice').waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Play with a Bot', exact: true }).click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button', { name: 'Back to the arena', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => !!document.pointerLockElement);
  const outside = await page.context().newPage();
  try {
    await outside.goto('about:blank'); await outside.bringToFront(); await outside.waitForTimeout(400);
    if (await page.getByRole('dialog').isVisible()) throw new Error('Losing focus while pointer-locked opened a menu');
  } finally { await outside.close(); await page.bringToFront(); }
  await page.getByRole('button', { name: 'Open game menu' }).click();
  await page.getByRole('button', { name: 'Back to menu', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  return 'Escape opens the menu; switching away from a locked game does not; returning and explicit Menu work.';
}
