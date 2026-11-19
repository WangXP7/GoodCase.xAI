async(page)=>{
 const origin=await page.evaluate(()=>location.origin),errors=[];
 await page.bringToFront();await page.goto(origin);await page.locator('.mode-choice').waitFor({timeout:30000});
 const leader=page.locator('.menu-rail button');await leader.hover();
 const underline=await leader.locator('span').evaluate(e=>({line:getComputedStyle(e,'::after').height,color:getComputedStyle(e).color}));
 if(underline.line!=='4px'||underline.color!=='rgb(161, 48, 46)')throw new Error('Leaderboard underline/hover missing');
 const border=await page.getByRole('button',{name:'Play with a Bot',exact:true}).evaluate(e=>getComputedStyle(e).borderTopColor);
 if(!border.startsWith('rgba'))throw new Error('Bot border is still opaque');
 await page.getByRole('button',{name:'Open game menu'}).click();await page.getByRole('navigation',{name:'Menu sections'}).getByRole('button',{name:'Weapons',exact:true}).click();
 await page.locator('.armory-rack').getByRole('button',{name:/Iron mace/}).click();
 const equip=await page.getByRole('button',{name:'Equip Iron mace',exact:true}).boundingBox(),back=await page.getByRole('button',{name:'Back to menu',exact:true}).boundingBox();
 if(back.y-equip.y-equip.height>12)throw new Error('Armory actions are too far apart');
 await page.screenshot({path:'output/playwright/armory-tight-actions.png',scale:'css'});
 await page.getByRole('button',{name:'Back to menu',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
 const ctx=await page.context().browser().newContext({viewport:{width:390,height:694},hasTouch:true,isMobile:true});await ctx.addInitScript(()=>localStorage.setItem('stick-steel.training.v1','complete'));
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
 try{
  await p.goto(origin);await p.locator('.mode-choice').waitFor({timeout:30000});await p.getByRole('button',{name:'Play with a Bot',exact:true}).tap();await p.getByRole('button',{name:'Guard mode'}).tap();
  await p.locator('.impact-label:not([hidden])').first().waitFor({timeout:20000});
  await p.screenshot({path:'output/playwright/mobile-impact-clearance.png',scale:'css'});
  const prompt=await p.locator('.game-context').boundingBox(),controls=await p.locator('.touch-combat-controls').boundingBox();
  if(prompt&&!(prompt.y>694*.6&&prompt.y+prompt.height<controls.y))throw new Error('Mobile prompt is not lowered above controls');
  await p.getByRole('button',{name:'Drop weapon or let go'}).tap();await p.waitForFunction(()=>document.querySelector('.ink-meter.side-0 .ink-condition')?.textContent?.includes('Unarmed'),null,{timeout:5000});
  await p.getByRole('button',{name:'Open game menu'}).tap();await p.getByRole('button',{name:'Back to menu',exact:true}).tap();await p.getByRole('dialog').waitFor({state:'hidden'});
  await p.getByRole('button',{name:'Open game menu'}).tap();await p.getByRole('navigation',{name:'Menu sections'}).getByRole('button',{name:'Weapons',exact:true}).tap();
  await p.locator('.armory-rack').getByRole('button',{name:/Iron mace/}).tap();
  await p.getByRole('button',{name:'Equip Iron mace',exact:true}).scrollIntoViewIfNeeded();
  const e=await p.getByRole('button',{name:'Equip Iron mace',exact:true}).boundingBox(),b=await p.getByRole('button',{name:'Back to menu',exact:true}).boundingBox();if(b.y-e.y-e.height>12)throw new Error('Phone armory gap remains');
  await p.screenshot({path:'output/playwright/mobile-armory-tight-actions.png',scale:'css'});
  if(errors.length)throw new Error(errors.join('\n'));
  return 'Soft bot border, red/underlined leaderboard, compact armory actions, visible off-player impact labels, lower mobile hint and direct Drop passed';
 }finally{await ctx.close();}
}
