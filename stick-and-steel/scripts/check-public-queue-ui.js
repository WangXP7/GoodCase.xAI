// Run against the loaded local or published game using real guest identity.
// This checks the public queue stage, which has no Session until a pair exists.
async (page) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.waitForFunction(() => document.querySelector('.tutorial-skip') || document.querySelector('.mode-choice'), null, { timeout: 30000 });
  if (await page.locator('.tutorial-skip').count()) await page.getByRole('button', { name: 'Skip Tutorial', exact: true }).click();
  const started = Date.now();
  await page.getByRole('button', { name: 'Online Match', exact: true }).click();
  await page.locator('.battle-leaderboard').waitFor({ timeout: 25000 });
  const opponent = await page.locator('.ink-meter.side-1 .ink-meter-name span').first().innerText();
  const ms = Date.now() - started;
  await page.screenshot({ path: '.genex/scratch/public-queue-bot.png', scale: 'css' });
  await page.getByRole('button', { name: 'Open game menu', exact: true }).click();
  const fallback = !await page.getByRole('button', { name: 'Leave online', exact: true }).count();
  if (fallback && (ms < 4900 || !/^Player [1-9][0-9]$/.test(opponent))) throw new Error('Fallback skipped the wait or has an incorrect rival name');
  await page.getByRole('button', { name: fallback ? 'Back to menu' : 'Leave online', exact: true }).click();
  await page.locator('.mode-choice').waitFor();
  if (errors.length) throw new Error(errors.join('\n'));
  return { opponent, fallback, millisecondsFromClick: ms, errors: errors.length };
}
