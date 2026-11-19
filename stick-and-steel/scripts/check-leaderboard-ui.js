async (page) => {
  await page.goto(await page.evaluate(() => location.origin));
  await page.waitForFunction(() => document.querySelector('.mode-choice') || document.querySelector('.tutorial-cue'), null, { timeout: 30000 });
  if (await page.locator('.tutorial-cue').count()) { await page.getByRole('button', { name: 'Open game menu' }).click(); await page.getByRole('button', { name: 'Skip training', exact: true }).click(); }
  await page.getByRole('button', { name: 'Online Match', exact: true }).waitFor();
  if (await page.getByText('Choose your opponent', { exact: true }).count()) throw new Error('Old eyebrow remains');
  await page.getByRole('button', { name: 'Leaderboard', exact: true }).click();
  await page.getByLabel('Your online record', { exact: true }).waitFor({ timeout: 25000 });
  if (await page.getByRole('alert').count()) throw new Error(await page.getByRole('alert').innerText());
  await page.screenshot({ path: 'output/playwright/leaderboard-desktop.png' });
  if(await page.getByRole('button',{name:'Refresh',exact:true}).count()||await page.getByRole('dialog').getByRole('button',{name:'Replay training',exact:true}).count())throw new Error('Unrelated leaderboard controls remain');
  await page.getByRole('button', { name: 'Start battle', exact: true }).click();
  await page.getByRole('button', { name: 'Online Match', exact: true }).click();
  await page.locator('.online-invitation').waitFor();
  await page.getByRole('button', { name: 'Play with a Bot', exact: true }).click();
  await page.locator('.online-invitation').waitFor({ state: 'hidden' });
  await page.getByRole('progressbar', { name: 'Your health' }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Back to menu', exact: true }).click();
}
