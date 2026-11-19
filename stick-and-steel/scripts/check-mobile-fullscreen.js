async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.addInitScript(() => { try { localStorage.setItem('stick-steel.training.v1','complete'); } catch {} });
  const p = await context.newPage(), errors = [], checks = [];
  p.on('pageerror', e => errors.push(e.message));
  // Browser-only instrumentation of the real simulation; nothing is added to the shipped app.
  await p.route(/\/lib\/duel\/physics\.ts(?:\?|$)/, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + '\nconst reviewStep = DuelSimulation.prototype.step; DuelSimulation.prototype.step = function() { reviewStep.call(this); window.__fullscreenReview = this; };' });
  });
  await p.route('http://localhost:3000/fullscreen-review', r => r.fulfill({ contentType:'text/html', body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}button{height:44px}#shell{height:calc(100dvh - 44px)}#shell:fullscreen,#shell.expanded{position:fixed;inset:0;height:100dvh;background:white}iframe{width:100%;height:calc(100% - 44px);border:0}</style><button id="outside">Outside</button><div id="shell"><button id="full">Fullscreen</button><button id="fit">Expand viewport</button><iframe src="http://localhost:3000" allow="fullscreen" allowfullscreen></iframe></div><script>full.onclick=()=>document.fullscreenElement?document.exitFullscreen():shell.requestFullscreen();fit.onclick=()=>shell.classList.toggle('expanded');</script>` }));
  try {
    await p.goto('http://localhost:3000/fullscreen-review'); await p.bringToFront();
    const game = p.frameLocator('iframe');
    await game.getByRole('button',{name:'Play with a Bot',exact:true}).waitFor({timeout:30000});
    await game.getByRole('button',{name:'Play with a Bot',exact:true}).tap();
    const frame = p.frames().find(f => f.url() === 'http://localhost:3000/');
    await frame.evaluate(() => { window.__fullscreenReview.practice = true; });
    const state = () => frame.evaluate(() => ({time:window.__fullscreenReview.time, move:window.__fullscreenReview.input.move.toArray(), attack:window.__fullscreenReview.input.attack}));
    const advances = async label => { const a=await state(); await p.waitForTimeout(300);const b=await state();if(b.time-a.time<.08)throw new Error(label+' left the simulation frozen');checks.push(label); };
    const nativeFullscreen = await p.evaluate(()=>document.fullscreenEnabled);
    for(let i=0;nativeFullscreen && i<2;i++) {
      await p.locator('#full').tap();await p.waitForFunction(()=>!!document.fullscreenElement);await advances('Enter native fullscreen '+i);
      await p.locator('#full').tap();await p.waitForFunction(()=>!document.fullscreenElement);await advances('Exit native fullscreen '+i);
    }
    // iPhone hosts can expand an iframe via CSS without a child fullscreen event.
    await p.locator('#fit').tap();await advances('Expand parent iframe');
    await p.locator('#fit').tap();await advances('Restore parent iframe');
    await game.getByRole('button',{name:'Guard mode'}).tap();
    await p.locator('#outside').tap();const before=await state();await p.waitForTimeout(250);const after=await state();
    if(after.time-before.time>.05)throw new Error('Unrelated outside focus must still suspend the local duel');
    if(await game.getByRole('dialog').count())throw new Error('Fullscreen/outside focus opened a menu');
    // Simulate the omitted focus notification, then deliver an actual touch.
    const cdp=page.context().browser().browserType().name()==='chromium' ? await context.newCDPSession(p) : null;
    const send = async (type, points) => {
      if(cdp) return cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points});
      if(type==='touchEnd') return p.mouse.up();
      await p.mouse.move(points[0].x,points[0].y);
      if(type==='touchStart') await p.mouse.down();
    };
    const stick=await game.locator('.touch-stick').boundingBox(),x=stick.x+stick.width/2,y=stick.y+stick.height/2;
    await send('touchStart',[{id:1,x,y}]);
    await send('touchMove',[{id:1,x,y:y-32}]);await advances('Fresh pointer resumes the iframe');
    // Browser transition cancels a pointer even when pointerup never arrives.
    await frame.evaluate(()=>window.dispatchEvent(new Event('blur')));
    if((await state()).move.some(v=>v!==0))throw new Error('Cancelled movement was held');
    await send('touchEnd',[]);
    await send('touchStart',[{id:2,x,y}]);
    await send('touchMove',[{id:2,x,y:y-32}]);
    if((await state()).move[1]<.5)throw new Error('Stale touch ID blocked the next movement');
    await send('touchEnd',[]);checks.push('Cancelled drag can restart');
    await game.getByRole('button',{name:'Open game menu'}).tap();await game.getByRole('dialog').waitFor();
    await p.locator(nativeFullscreen?'#full':'#fit').tap();await p.waitForTimeout(200);
    if(!await game.getByRole('dialog').isVisible())throw new Error('Fullscreen dismissed an explicit pause menu');
    await p.locator(nativeFullscreen?'#full':'#fit').tap();
    await game.getByRole('button',{name:'Back to the arena',exact:true}).tap();await game.getByRole('dialog').waitFor({state:'hidden'});
    await advances('Explicit resume after fullscreen');
    await frame.evaluate(() => { const gl=document.querySelector('.game-canvas canvas').getContext('webgl2');window.__lossExtension=gl.getExtension('WEBGL_lose_context');window.__lossExtension.loseContext(); });
    await p.waitForTimeout(250);
    if(await game.getByRole('dialog').count())throw new Error('Context loss opened a permanent pause menu');
    await frame.evaluate(()=>window.__lossExtension.restoreContext());await p.waitForTimeout(700);await advances('Restored WebGL context');
    await p.screenshot({path:'output/playwright/mobile-fullscreen-restored.png'});
    if(errors.length)throw new Error(errors.join('\n'));
    return {browser:page.context().browser().browserType().name(),nativeFullscreen,checks,errors};
  } finally {await context.close();}
}
