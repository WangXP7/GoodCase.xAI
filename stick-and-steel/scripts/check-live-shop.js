async (page) => {
 const context=await page.context().browser().newContext({viewport:{width:1200,height:837}});const guest=await context.newPage();
 try {
  await guest.goto(await page.evaluate(() => location.origin));
  await guest.waitForFunction(()=>document.querySelector('.tutorial-cue')||document.querySelector('.mode-choice'),null,{timeout:30000});
  if(await guest.locator('.tutorial-cue').count()){await guest.getByRole('button',{name:'Open game menu'}).click();await guest.getByRole('button',{name:'Skip training',exact:true}).click();}
  await guest.getByRole('dialog').waitFor({state:'hidden'});await guest.getByRole('group',{name:'Choose your weapon'}).getByRole('button',{name:'Ravenblade',exact:true}).click();
  await guest.waitForTimeout(3000); await guest.screenshot({path:'output/playwright/shop-live-catalog.png'}); await guest.getByRole('button',{name:/Unlock · 100 coins/}).waitFor({timeout:10000});
  await guest.screenshot({path:'output/playwright/shop-live-catalog.png'});
  const purchase=guest.getByRole('button',{name:/Unlock · 100 coins/});if(!await purchase.isDisabled())throw new Error('Guest purchases must be account-gated'); if(!await guest.getByText('$1.00 equivalent · one-time purchase',{exact:true}).isVisible())throw new Error('Server price missing');
  if(await guest.getByText(/Yours permanently|Genex coin shop|Opponents see it in every online duel/).count())throw new Error('Removed shop copy is still shown');
  console.log('Real guest identity: catalog price and account-gated purchase passed; no payment initiated.');
 }finally{await context.close();}
}
