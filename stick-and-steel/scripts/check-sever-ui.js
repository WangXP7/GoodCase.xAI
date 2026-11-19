async (page) => {
  const context=await page.context().browser().newContext({viewport:{width:1000,height:760},hasTouch:true,isMobile:true});
  await context.addInitScript(()=>localStorage.setItem('stick-steel.training.v1','complete'));
  const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  // Drive a repeatable swing in the browser's real simulation. No injury or
  // sever event is fabricated; scene rendering/audio/effects receive its actual collision.
  await p.route(/\/lib\/duel\/physics\.ts(?:\?|$)/,async route=>{
    const response=await route.fetch();
    await route.fulfill({response,body:await response.text()+`\nconst cutReviewStep=DuelSimulation.prototype.step;let cutReviewFrame=0;DuelSimulation.prototype.step=function(){if(this.phase==='fighting'){this.practice=true;if(!this.cuts){this.input.move.y=this.fighters[0].position.distanceTo(this.fighters[1].position)>1.12?.65:0;this.input.attack=true;this.input.aim.set(-Math.sin(cutReviewFrame++/120*7)*.98,0);}else{this.clearInput();}}cutReviewStep.call(this);window.__cutReview=this;};`});
  });
  try {
    await p.goto('http://localhost:3000');await p.bringToFront();
    await p.getByRole('button',{name:'Play with a Bot',exact:true}).waitFor({timeout:30000});
    await p.getByRole('button',{name:'Play with a Bot',exact:true}).tap();
    await p.waitForFunction(()=>window.__cutReview?.cuts>0,{},{timeout:15000});
    const result=await p.evaluate(()=>{const s=window.__cutReview,f=s.fighters[1];return {cuts:s.cuts,hp:f.hp,part:f.wounds[0]?.part,detached:[...f.rig.disabledParts]};});
    if(result.hp<=60||!result.detached.some(n=>n.includes('arm')))throw new Error(JSON.stringify(result));
    await p.waitForTimeout(200);await p.screenshot({path:'output/playwright/clean-arm-sever.png'});
    if(errors.length)throw new Error(errors.join('\n'));return {result,errors};
  }finally{await context.close();}
}
