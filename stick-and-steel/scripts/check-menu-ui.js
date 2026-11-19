async (page) => {
  const url=page.url(), errors=[];page.on('pageerror',e=>errors.push(e.message));
  const waitMenu=async p=>{
    await p.waitForFunction(()=>document.querySelector('.mode-choice')||document.querySelector('.tutorial-cue'),null,{timeout:30000});
    if(await p.locator('.tutorial-cue').count()){await p.getByRole('button',{name:'Open game menu',exact:true}).click();await p.getByRole('button',{name:'Skip training',exact:true}).click();}
    await p.getByRole('dialog').waitFor({state:'hidden'});await p.locator('.weapon-tiles canvas').waitFor();
    await p.waitForFunction(()=>!document.querySelector('.tile-loading'),null,{timeout:20000});
  };
  await waitMenu(page);
  const rack=page.getByRole('group',{name:'Choose your weapon'});
  const before=await page.screenshot({clip:await page.locator('.weapon-tiles').boundingBox()});await page.waitForTimeout(900);const after=await page.screenshot({clip:await page.locator('.weapon-tiles').boundingBox()});if(before.equals(after))throw new Error('Weapon previews are not rotating');
  await rack.getByRole('button',{name:'Iron mace',exact:true}).click();
  if(await rack.getByRole('button',{name:'Iron mace',exact:true}).getAttribute('aria-pressed')!=='true')throw new Error('Tile did not equip');
  await page.reload();await waitMenu(page);await page.waitForFunction(()=>document.querySelector('.weapon-tile[aria-label="Iron mace"]')?.getAttribute('aria-pressed')==='true');
  await rack.getByRole('button',{name:'Arming sword',exact:true}).click();
  await page.screenshot({path:'output/playwright/menu-tiles-desktop.png',scale:'css'});
  await page.getByRole('navigation',{name:'Arena menu'}).getByRole('button',{name:'Leaderboard',exact:true}).click();
  await page.locator('.personal-record').waitFor();
  const dialog=page.getByRole('dialog');for(const name of ['Refresh','Choose opponent','Replay training'])if(await dialog.getByRole('button',{name,exact:true}).count())throw new Error('Unrelated leaderboard control: '+name);
  await page.screenshot({path:'output/playwright/leaderboard-crown.png',scale:'css'});await dialog.getByRole('button',{name:'Start battle',exact:true}).click();
  if(await page.locator('.mode-choice').getByRole('button',{name:'Replay training',exact:true}).count())throw new Error('Training still appears in primary menu');
  await page.getByRole('dialog').waitFor({state:'hidden'});await page.locator('.yard-shortcut').click();await page.locator('.tutorial-cue[data-step="move"]').waitFor();await page.getByRole('button',{name:'Open game menu',exact:true}).click();await page.getByRole('button',{name:'Skip training',exact:true}).click();
  const context=await page.context().browser().newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});const phone=await context.newPage();phone.on('pageerror',e=>errors.push(e.message));
  try {
    await phone.goto(url);await waitMenu(phone);
    for(const [width,height,label] of [[390,844,'portrait'],[844,390,'landscape']]){
      await phone.setViewportSize({width,height});await phone.waitForTimeout(500);
      if(await phone.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Mobile horizontal overflow');
      for(const tile of await phone.locator('.weapon-tile').all()){const box=await tile.boundingBox();if(!box||box.x<0||box.y<0||box.x+box.width>width||box.y+box.height>height-40)throw new Error('Tile is offscreen');}
      await phone.getByRole('group',{name:'Choose your weapon'}).getByRole('button',{name:'Longsword',exact:true}).tap();
      await phone.screenshot({path:'output/playwright/menu-tiles-'+label+'.png',scale:'css'});
    }
    await phone.getByRole('group',{name:'Choose your weapon'}).getByRole('button',{name:'Ravenblade',exact:true}).tap();await phone.getByRole('heading',{name:'Choose your steel.',exact:true}).waitFor();
    if(!await phone.locator('.armory-rack button[aria-pressed="true"]').innerText().then(t=>t.includes('Ravenblade')))throw new Error('Locked tile did not open Ravenblade details');
    await phone.screenshot({path:'output/playwright/shop-detail-landscape.png',scale:'css'});
    if(errors.length)throw new Error(errors.join('\n'));
    return {passed:'Rotating tiles, equip/reload, crown leaderboard, clean actions, training shortcut, phone portrait/landscape, premium details'};
  } finally {await context.close();}
}
