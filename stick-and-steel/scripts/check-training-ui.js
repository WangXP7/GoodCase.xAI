async (page) => {
  await page.bringToFront();
  await page.goto(await page.evaluate(() => location.origin));
  await page.waitForFunction(() => document.querySelector('.tutorial-cue') || document.querySelector('.mode-choice'), null, { timeout: 30000 });
  if (await page.locator('.mode-choice').count()) await page.locator('.yard-shortcut').click();
  await page.locator('[data-step="move"]').waitFor();
  await page.screenshot({ path: 'output/playwright/tutorial-movement.png' });
  for (let cycle = 0; cycle < 3 && await page.locator('[data-step="move"]').count(); cycle++) {
    for (const key of ['w', 'a', 's', 'd']) { await page.keyboard.down(key); await page.waitForTimeout(550); await page.keyboard.up(key); }
  }
  await page.locator('[data-step="swing"]').waitFor();
  const firstDirection = await page.locator('[data-direction]').getAttribute('data-direction');
  await page.waitForFunction(first => document.querySelector('[data-direction]')?.getAttribute('data-direction') !== first, firstDirection);

  if (await page.locator('.lesson-card, .lesson-keys').count()) throw new Error('Old instruction panel is still present');
  await page.screenshot({ path: 'output/playwright/tutorial-world-cue.png' });
  await page.mouse.move(550, 430); await page.mouse.down();
  for(let n=0;n<6 && await page.locator('[data-step="swing"]').count();n++){
    for(let k=0;k<=18;k++){const t=k/18;await page.mouse.move(n%2?940-t*650:290+t*650,480-Math.sin(t*Math.PI)*120);await page.waitForTimeout(18);}
  }
  await page.locator('[data-step="hit"]').waitFor();
  if(await page.locator('.tutorial-cue').getAttribute('data-hits')!=='0')throw new Error('First held sweep should have practice space');
  await page.screenshot({path:'output/playwright/tutorial-space-to-swing.png'});
  await page.keyboard.down('w');await page.waitForFunction(()=>document.querySelector('.tutorial-cue h1')?.textContent!=='Step closer',null,{timeout:5000});await page.waitForTimeout(150);await page.keyboard.up('w');
  const strikes = new Set();
  for (let n = 0; n < 18; n++) {
    for (let k = 0; k <= 18; k++) {
      const t = k / 18, x = n % 2 ? 940 - t * 650 : 290 + t * 650;
      await page.mouse.move(x, 480 - Math.sin(t * Math.PI) * 120); await page.waitForTimeout(12);
      strikes.add(await page.locator('.tutorial-cue').getAttribute('data-hits'));
      if (await page.locator('[data-step="parry"]').count()) break;
    }
    if (await page.locator('[data-step="parry"]').count()) break;
    if(await page.locator('.tutorial-cue h1').innerText()==='Step closer'){await page.keyboard.down('w');await page.waitForTimeout(180);await page.keyboard.up('w');}
  }
  await page.mouse.up();
  await page.locator('[data-step="parry"]').waitFor({ timeout: 3000 });
  if(!strikes.has('1')||await page.locator('.tutorial-cue').getAttribute('data-hits')!=='2')throw new Error('Skipped a practice strike');
  if (await page.getByRole('button', { name: 'Try a parry', exact: true }).count()) throw new Error('Parry still requires a confirmation');
  await page.screenshot({ path: 'output/playwright/tutorial-auto-parry.png' });
  await page.mouse.down({ button: 'right' });
  // Follow the gesture cue: steer the held guard through several directions,
  // since the player's final footing need not match one fixed guard pose.
  for(let i=0;i<140&&!await page.locator('[data-step="great"]').count();i++){
    await page.mouse.move(650+Math.sin(i*.35)*170,420+Math.cos(i*.35)*150);await page.waitForTimeout(130);
  }
  await page.locator('[data-step="great"]').waitFor({ timeout: 3000 });
  await page.mouse.up({ button: 'right' });
  await page.screenshot({ path: 'output/playwright/tutorial-great.png' });
  await page.locator('[data-step="complete"]').waitFor({ timeout: 3000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'output/playwright/tutorial-ivory-finish.png' });
  await page.keyboard.press('Enter');
  await page.locator('.online-invitation').waitFor();
  await page.getByRole('button', { name: 'Back to menu', exact: true }).click();
  await page.getByRole('button', { name: 'Online Match', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Play with a Bot', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: 'Online Match', exact: true }).waitFor({ timeout: 30000 });
  if (await page.locator('.tutorial-cue').count()) throw new Error('Completed training appeared again');
}
