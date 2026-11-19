// Run after navigating Playwright CLI to the published build:
// playwright-cli run-code --filename scripts/check-online-ui.js
// Uses the real menu, SDK guest flow and relay. No injected join hook or auth mocks.
async (page) => {
  const gameHosts = ['stick-steel.auras.cc', 'stick-steel.genex.technology'];
  await page.waitForURL(url => gameHosts.includes(url.hostname), { timeout: 30000 });
  const url = page.url();
  if (!gameHosts.some(host => url.startsWith('https://' + host + '/'))) throw new Error('Open the published game first. Genex staging is single-player.');
  const peerContext = await page.context().browser().newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const peer = await peerContext.newPage();
  const recordsFor = async p => (await p.locator('.personal-record strong').allTextContents()).slice(0,2).map(Number.parseFloat);
  const join = async (p, weapon) => {
    await p.waitForFunction(() => document.querySelector('.tutorial-cue') || document.querySelector('.mode-choice'), null, { timeout: 30000 });
    if (await p.locator('.tutorial-cue').count()) { await p.getByRole('button', { name: 'Open game menu' }).click(); await p.getByRole('button', { name: 'Skip training', exact: true }).click(); }
    await p.getByRole('dialog').waitFor({state:'hidden'});
    await p.getByRole('group',{name:'Choose your weapon'}).getByRole('button',{name:weapon,exact:true}).click();
    await p.locator('.menu-rail').getByRole('button', { name: 'Leaderboard', exact: true }).click();
    await p.locator('.personal-record').waitFor({timeout:15000}); const before = await recordsFor(p);
    await p.getByRole('button', { name: 'Start battle', exact: true }).click();
    await p.getByRole('button', { name: 'Online Match', exact: true }).click();
    await p.waitForFunction(() => {
      const text = document.querySelector('.online-invitation')?.textContent ?? '';
      return text.includes('Finding a challenger') || text.includes('Waiting for both players') || text.includes('Waiting for a second player') || text.includes('Connection interrupted') || !document.querySelector('.online-invitation');
    }, null, { timeout: 25000 });
    if (await p.getByRole('heading', { name: 'Connection interrupted' }).isVisible()) throw new Error(await p.locator('.online-invitation').innerText());
    return before;
  };
  const leave = async p => {
    try {
      if (await p.locator('.mode-choice').count()) return;
      if (!await p.getByRole('dialog').isVisible()) await p.getByRole('button', { name: 'Open game menu' }).click({ timeout: 1500 });
      await p.getByRole('navigation',{name:'Menu sections'}).getByRole('button',{name:'Arena & sound',exact:true}).click();
      await p.getByRole('button', { name: 'Leave online', exact: true }).click({ timeout: 1500 });
    } catch { /* Best-effort cleanup preserves the original test failure. */ }
  };
  let phase = 'first browser joins';
  try {
    const firstBefore = await join(page, 'Arming sword');
    phase = 'second browser joins';
    await peer.goto(url);
    await peer.getByRole('button', { name: 'Open game menu' }).waitFor({ state: 'visible', timeout: 25000 });
    const secondBefore = await join(peer, 'Iron mace');
    phase = 'both browsers finish the countdown';
    for (const p of [page, peer]) {
      await p.waitForFunction(() => !document.querySelector('.online-invitation') && !document.querySelector('.game-result'), null, { timeout: 25000 });
      if (await p.getByRole('progressbar', { name: 'Your health' }).getAttribute('value') !== '100') throw new Error('Unexpected starting health');
    }
    phase = 'each player sees their own selected weapon';
    for (const [index,p] of [page,peer].entries()) {
      await p.getByRole('button',{name:'Open game menu',exact:true}).click();
      const weapon = await p.locator('.setup-weapon-link').innerText();
      if(!weapon.includes(index===0?'Arming sword':'Iron mace'))throw new Error('Wrong local loadout: '+weapon);
      await p.getByRole('button',{name:'Back to the arena',exact:true}).click();
      await p.getByRole('dialog').waitFor({state:'hidden'});
    }
    phase = 'remote weapon release';
    await peer.getByRole('button', { name: 'Drop weapon or let go', exact: true }).tap();
    await page.waitForFunction(() => document.querySelector('.ink-meter.side-1 .ink-condition')?.textContent?.includes('Unarmed'), null, { timeout: 10000 });
    await page.screenshot({ path: 'output/playwright/online-two-guests-host.png', scale: 'css' });
    await peer.screenshot({ path: 'output/playwright/online-two-guests-peer.png', scale: 'css' });
    phase = 'a real fall ends the shared round';
    const pad = await peer.getByRole('button', { name: 'Movement stick' }).boundingBox();
    if (!pad) throw new Error('Movement stick missing');
    const cdp = await peerContext.newCDPSession(peer);
    const touch = async (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
    const finger = { id: 8, x: pad.x + pad.width / 2, y: pad.y + pad.height / 2, radiusX: 4, radiusY: 4 };
    await touch('touchStart', [finger]); await touch('touchMove', [{ ...finger, x: finger.x - 45 }]);
    await peer.waitForTimeout(2300); await touch('touchEnd', []);
    if (!await peer.locator('.game-result').count()) {
      await peer.getByRole('button', { name: 'Drop weapon or let go', exact: true }).tap();
    }
    for (const p of [page, peer]) { await p.locator('.game-result').waitFor({ timeout: 18000 }); const dock=await p.locator('.game-result').boundingBox();if(dock.y<p.viewportSize().height*.54)throw new Error('Result obscures the center'); }
    await page.screenshot({path:'output/playwright/result-bottom-desktop.png',scale:'css'});await peer.screenshot({path:'output/playwright/result-bottom-mobile.png',scale:'css'});
    phase = 'both players receive one complementary record';
    for (const [index, p] of [page, peer].entries()) {
      await p.keyboard.press('Escape');
      if (!await p.getByRole('dialog').isVisible()) await p.locator('.game-result').getByRole('button', { name: 'Leaderboard', exact: true }).click();
      else await p.getByRole('navigation',{name:'Menu sections'}).getByRole('button', { name: 'Leaderboard', exact: true }).click();
      await p.locator('.personal-record').waitFor({ timeout: 15000 });
      await p.waitForTimeout(1500);
      await p.screenshot({path: 'output/playwright/online-record-' + index + '.png', scale:'css'});
    }
    const records = await Promise.all([page, peer].map(recordsFor));
    const changes = records.map((row,i)=>row.map((count,j)=>count-[firstBefore,secondBefore][i][j]));
    if(changes.some(row=>row[0]+row[1]!==1)||changes[0][0]+changes[1][0]!==1||changes[0][1]+changes[1][1]!==1)throw new Error('Results are not complementary: '+JSON.stringify({records,changes}));
    for(const [i,p] of [page,peer].entries()){await p.getByRole('button',{name:'Back to battle',exact:true}).click();await p.getByRole('dialog').waitFor({state:'hidden'});await p.locator('.game-result').getByRole('button',{name:'Leaderboard',exact:true}).click();await p.locator('.personal-record').waitFor();if(JSON.stringify(await recordsFor(p))!==JSON.stringify(records[i]))throw new Error('Reopening counted the round again');}
    phase = 'leaving after a result keeps a single usable end screen';
    await peer.getByRole('navigation',{name:'Menu sections'}).getByRole('button',{name:'Arena & sound',exact:true}).click();
    await peer.getByRole('button',{name:'Leave online',exact:true}).click();
    await peer.locator('.mode-choice').waitFor();
    await page.getByRole('button',{name:'Back to battle',exact:true}).click();
    await page.waitForTimeout(1800);
    if(await page.locator('.online-invitation').count())throw new Error('Waiting screen overlaps the result');
    await page.locator('.game-result').getByRole('button',{name:'Back to menu',exact:true}).click();
    await page.locator('.mode-choice').waitFor();
    phase = 'guest record survives a fresh identity after reload';
    await page.reload(); await page.locator('.mode-choice').waitFor({timeout:30000});
    await page.locator('.menu-rail').getByRole('button',{name:'Leaderboard',exact:true}).click();
    await page.locator('.personal-record').waitFor({timeout:15000});
    if(JSON.stringify(await recordsFor(page))!==JSON.stringify(records[0]))throw new Error('Guest record lost on reload');
    await page.getByRole('button',{name:'Start battle',exact:true}).click();
    return { outcome: 'Two guests: distinct loadouts, matching, remote drop, shared fall, complementary records, clean exits and reload persistence passed', records };

  } catch (error) {
    const first = await page.locator('.online-invitation').innerText({ timeout: 1000 }).catch(() => 'no online overlay');
    const second = await peer.locator('.online-invitation').innerText({ timeout: 1000 }).catch(() => 'no online overlay');
    throw new Error(phase + ': ' + error.message + '\nFirst: ' + first + '\nSecond: ' + second);
  } finally {
    await leave(peer); await leave(page); await peerContext.close();
  }
}
