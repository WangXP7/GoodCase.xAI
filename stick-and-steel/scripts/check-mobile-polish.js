async (page) => {
 const origin=await page.evaluate(()=>location.origin),errors=[];
 const ctx=await page.context().browser().newContext({viewport:{width:390,height:694},isMobile:true,hasTouch:true});
 await ctx.addInitScript(()=>localStorage.setItem('stick-steel.training.v1','complete'));
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
 const assert=(yes,message)=>{if(!yes)throw new Error(message);};
 try{
  await p.goto(origin);await p.locator('.mode-choice').waitFor({timeout:30000});await p.waitForFunction(()=>!document.querySelector('.tile-loading'));
  for(const [width,height] of [[390,694],[320,568],[844,390]]){
   await p.setViewportSize({width,height});await p.waitForTimeout(500);
   for(const tile of await p.locator('.weapon-tile').all()){
    const art=await tile.locator('.tile-art').boundingBox(),name=await tile.locator('.tile-name').boundingBox();
    if(await tile.locator('.tile-price').count()){const price=await tile.locator('.tile-price').boundingBox(),lock=await tile.locator('.tile-mark').boundingBox();assert(price.x<art.x+art.width/3&&price.y<art.y+art.height/4&&price.x+price.width<=lock.x,'Premium price does not fit at upper-left');}
    assert(name.x>=art.x&&name.y>=art.y&&name.x+name.width<=art.x+art.width&&name.y+name.height<=art.y+art.height,'Weapon name outside square');
    assert(art.y+art.height<height-44,'Weapon overlaps footer');
   }
   const guest=p.locator('[data-genex-guest-popover]');
   if(await guest.isVisible()){
    const g=await guest.boundingBox(),rack=await p.locator('.weapon-tiles').boundingBox();
    assert(g.y>=rack.y+rack.height,'Guest sign-in covers the weapon rack');
    for(const selector of ['.game-control-hint','.game-menu-button']){const b=await p.locator(selector).boundingBox();assert(g.x+g.width<=b.x||g.x>=b.x+b.width||g.y+g.height<=b.y||g.y>=b.y+b.height,'Guest sign-in covers a footer button');}
   }
   await p.screenshot({path:'output/playwright/mobile-menu-'+width+'.png',scale:'css'});
  }
  await p.setViewportSize({width:390,height:694});await p.getByRole('button',{name:'Play with a Bot',exact:true}).tap();
  for(const [width,height] of [[390,694],[320,568],[844,390]]){
   await p.setViewportSize({width,height});await p.waitForTimeout(150);
   assert(await p.locator('.game-wordmark').count()===0,'Brand remains in combat');
   const health=await p.locator('.ink-meter.side-0').boundingBox();assert(health.y>=60,'Close button overlaps HP lane');
   const guard=await p.getByRole('button',{name:'Guard mode'}).boundingBox(),interact=await p.getByRole('button',{name:'Interact: pick up, stand or climb'}).boundingBox();
   assert(guard.width===interact.width&&guard.height===interact.height&&guard.x===interact.x,'Tools do not match');
   assert(guard.y+guard.height<interact.y,'Tools are not stacked');
   const style=await p.getByRole('button',{name:'Guard mode'}).evaluate(e=>getComputedStyle(e).borderRadius),other=await p.getByRole('button',{name:'Interact: pick up, stand or climb'}).evaluate(e=>getComputedStyle(e).borderRadius);assert(style===other,'Tools have different corners');
   const drop=await p.getByRole('button',{name:'Drop weapon or let go'}).boundingBox(),pad=await p.locator('.touch-swing').boundingBox(),stick=await p.locator('.touch-stick').boundingBox();
   assert(drop.width===guard.width&&drop.height===guard.height&&drop.x===guard.x,'Drop does not match the stack');
   assert(interact.y+interact.height<drop.y,'Drop is not the bottom action');
   if(width<height){assert(Math.abs(drop.x+drop.width-pad.x-pad.width)<1&&drop.y+drop.height<pad.y,'Portrait actions must sit above the pad at the right edge');}
   else{assert(drop.x>pad.x+pad.width&&Math.abs(drop.y+drop.height-pad.y-pad.height)<1,'Landscape actions must stay to the right of the pad');}
   assert(drop.x>=stick.x+stick.width,'Action stack overlaps movement');
   const icon=await p.getByRole('button',{name:'Guard mode'}).locator('svg').boundingBox(),label=await p.getByRole('button',{name:'Guard mode'}).locator('span').boundingBox();
   assert(label.y-icon.y-icon.height<=2,'Control icon/text gap is too large');
   assert(guard.y>=health.y+health.height+4,'Action stack overlaps the HP bars');
   const footer=await p.locator('.game-footer').boundingBox();assert(height-footer.y-footer.height<=6,'Footer is too far from the bottom');
   assert(await p.locator('.touch-more,.touch-more-trigger').count()===0,'Popup actions remain');
   await p.screenshot({path:'output/playwright/mobile-combat-'+width+'.png',scale:'css'});
  }
  assert(errors.length===0,errors.join('\n'));
  return {passed:'390x694 Safari-sized viewport, 320x568 compact phone and 844x390 landscape: safe HP, compact Guard/Interact/Drop on the right, lowered footer, contained card names'};
 }finally{await ctx.close();}
}
