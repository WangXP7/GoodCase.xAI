async (page) => {
  const origin = await page.evaluate(() => location.origin);
  const context = await page.context().browser().newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mobile = await context.newPage();
  const errors = []; mobile.on('pageerror', e => errors.push(e.message));
  const cdp = await context.newCDPSession(mobile);
  const send = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(p => ({ ...p, radiusX: 8, radiusY: 8, force: 1 })) });
  try {
    await mobile.goto(origin);
    await mobile.locator('[data-step="move"]').waitFor({ timeout: 30000 });
    const moveStick = await mobile.getByRole('button', { name: 'Movement stick' }).boundingBox();
    const mx = moveStick.x + moveStick.width / 2, my = moveStick.y + moveStick.height / 2;
    for (let cycle = 0; cycle < 3 && await mobile.locator('[data-step="move"]').count(); cycle++) {
      for (const [dx, dy] of [[0,-40],[-40,0],[0,40],[40,0]]) {
        await send('touchStart', [{ id: 1, x: mx, y: my }]);
        await send('touchMove', [{ id: 1, x: mx + dx, y: my + dy }]);
        await mobile.waitForTimeout(600); await send('touchEnd', []);
      }
    }
    await mobile.locator('[data-step="swing"]').waitFor();
    await mobile.screenshot({ path: 'output/playwright/mobile-training-welcome.png' });
    await mobile.screenshot({ path: 'output/playwright/mobile-training-swing.png' });
    const pad = await mobile.getByRole('button', { name: 'Hold and drag to swing', exact: true }).boundingBox();
    const stick = await mobile.getByRole('button', { name: 'Movement stick' }).boundingBox();
    const fixed = { id: 1, x: stick.x + stick.width / 2, y: stick.y + stick.height / 2 };
    const cy = pad.y + pad.height / 2, cx = pad.x + pad.width / 2;
    await send('touchStart', [fixed, { id: 2, x: cx, y: cy }]);
    for(let cycle=0;cycle<6 && await mobile.locator('[data-step="swing"]').count();cycle++) {
      for(let k=0;k<16;k++){const t=(cycle*16+k)/16*Math.PI;await send('touchMove',[fixed,{id:2,x:cx+Math.cos(t)*48,y:cy-Math.sin(t)*18}]);await mobile.waitForTimeout(20);}
    }
    await mobile.locator('[data-step="hit"]').waitFor();
    if(await mobile.locator('.tutorial-cue').getAttribute('data-hits')!=='0')throw new Error('No room for the first touch sweep');
    await send('touchMove',[{...fixed,y:fixed.y-40},{id:2,x:cx+48,y:cy}]);
    await mobile.waitForFunction(()=>document.querySelector('.tutorial-cue h1')?.textContent!=='Step closer',null,{timeout:5000});
    await mobile.waitForTimeout(200);
    await send('touchMove',[fixed,{id:2,x:cx+48,y:cy}]);
    for (let cycle = 0; cycle < 24; cycle++) {
      for (let k = 0; k < 16; k++) {
        const x = cx + Math.cos((cycle * 16 + k) / 16 * Math.PI) * 48;
        await send('touchMove', [fixed, { id: 2, x, y: cy + 8 }]); await mobile.waitForTimeout(20);
      }
      if (await mobile.locator('[data-step="parry"]').count()) break;
      if(await mobile.locator('.tutorial-cue h1').innerText()==='Step closer'){
        await send('touchMove',[{...fixed,y:fixed.y-30},{id:2,x:cx,y:cy}]);await mobile.waitForTimeout(200);await send('touchMove',[fixed,{id:2,x:cx,y:cy}]);
      }
    }
    await send('touchEnd', []);
    if (!await mobile.locator('[data-step="parry"]').count()) {await mobile.screenshot({path:'output/playwright/mobile-training-stuck.png'});throw new Error('Touch sweep did not hit: ' + await mobile.locator('.tutorial-cue').innerText()+'; hits='+await mobile.locator('.tutorial-cue').getAttribute('data-hits'));}
    await mobile.getByRole('button', { name: 'Guard mode' }).tap();
    await mobile.locator('[data-step="complete"]').waitFor({ timeout: 20000 });
    await mobile.screenshot({ path: 'output/playwright/mobile-training-complete.png' });
    await mobile.getByRole('button', { name: 'Back to menu', exact: true }).tap();
    await mobile.getByRole('button', { name: 'Play with a Bot', exact: true }).tap();
    await mobile.getByRole('button', { name: 'Guard mode' }).tap();
    await mobile.waitForFunction(()=>document.querySelector('.game-context')?.textContent?.includes('guard'),null,{timeout:3000});
    if (!await mobile.locator('.game-context').innerText().then(t => t.includes('guard'))) {await mobile.screenshot({path:'output/playwright/mobile-guard-state.png'});throw new Error('Touch guard not applied: '+await mobile.locator('.game-context').innerText()+'; pressed='+await mobile.getByRole('button',{name:'Guard mode'}).getAttribute('aria-pressed'));}
    const move = await mobile.getByRole('button', { name: 'Movement stick' }).boundingBox();
    await send('touchStart', [{ id: 3, x: move.x + 85, y: move.y + 30 }]);
    await mobile.waitForTimeout(200); await send('touchCancel', []);
    const transform = await mobile.locator('.stick-knob').evaluate(el => el.style.transform);
    if (!transform.includes('(0px, 0px)')) throw new Error('Cancelled movement remained active: ' + transform);
    await mobile.getByRole('button', {name:'Drop weapon or let go'}).tap();
    await mobile.waitForFunction(()=>document.querySelector('.ink-meter.side-0 .ink-condition')?.textContent?.includes('Unarmed'),null,{timeout:3000});
    if(await mobile.getByRole('button',{name:'Guard mode'}).getAttribute('aria-pressed')!=='false')throw new Error('Drop left guard latched');
    await mobile.getByRole('button', { name: 'Open game menu' }).tap();
    await mobile.getByRole('button', { name: 'Replay training', exact: true }).tap();
    await mobile.setViewportSize({ width: 844, height: 390 });
    await mobile.screenshot({ path: 'output/playwright/mobile-training-landscape.png' });
    if (errors.length) throw new Error(errors.join('\n'));
    console.log('Touch: simultaneous sticks, real hit and parry, guard, cancellation, direct drop, replay and landscape passed.');
  } finally { await context.close(); }
}
