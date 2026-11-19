// Real UI check on the loaded local or published game. No matchmaking or writes
// to other players' records. Fresh mobile storage must open the main menu too.
async (page) => {
  const errors = [], layouts = [];
  const check = async (p, label) => {
    p.on('pageerror', error => errors.push(error.message));
    await p.locator('.mode-choice').waitFor({ timeout: 30000 });
    if (await p.locator('.tutorial-cue').count()) throw new Error('Tutorial started automatically');
    const link = p.getByRole('button', { name: 'Learn to Fight', exact: true });
    const geometry = await link.evaluate(el => {
      const rect = el.getBoundingClientRect(), tiles = document.querySelector('.weapon-tiles').getBoundingClientRect(), style = getComputedStyle(el);
      return { top: rect.top, bottom: rect.bottom, height: rect.height, tilesBottom: tiles.bottom, viewport: innerHeight, underline: style.textDecorationLine, border: style.borderTopWidth, background: style.backgroundColor };
    });
    if (geometry.top < geometry.tilesBottom || geometry.bottom > geometry.viewport || geometry.height < 44 || !geometry.underline.includes('underline') || geometry.border !== '0px' || geometry.background !== 'rgba(0, 0, 0, 0)') throw new Error(label + ': bad tutorial link layout ' + JSON.stringify(geometry));
    await p.screenshot({ path: `.genex/scratch/menu-optional-${label}.png`, scale: 'css' });
    await link.click();
    await p.locator('.training-title').waitFor();
    if (await p.locator('.training-title').innerText() !== 'The Practice Yard') throw new Error('Wrong tutorial title');
    await p.getByRole('button', { name: 'Skip Tutorial', exact: true }).click();
    await p.locator('.mode-choice').waitFor();
    await p.locator('.menu-rail').getByRole('button', { name: 'Leaderboard', exact: true }).click();
    await p.locator('.leaderboard-table').waitFor({ timeout: 30000 });
    const count = await p.locator('.leaderboard-table tbody tr').count();
    if (count < 10) throw new Error('Sparse leaderboard was not filled');
    await p.screenshot({ path: `.genex/scratch/leaderboard-rivals-${label}.png`, scale: 'css' });
    await p.getByRole('button', { name: 'Start battle', exact: true }).click();
    await p.locator('.mode-choice').waitFor();
    layouts.push({ label, entries: count, ...geometry });
  };
  await page.setViewportSize({ width: 1280, height: 800 });
  await check(page, 'desktop');
  const url = page.url();
  const context = await page.context().browser().newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  try {
    const mobile = await context.newPage();
    await mobile.goto(url.startsWith('http://localhost') ? url + '?genex_auth=1' : url);
    await check(mobile, 'portrait');
    await mobile.setViewportSize({ width: 844, height: 390 });
    await check(mobile, 'landscape');
  } finally { await context.close(); }
  if (errors.length) throw new Error(errors.join('\n'));
  return { layouts, errors: 0 };
}
