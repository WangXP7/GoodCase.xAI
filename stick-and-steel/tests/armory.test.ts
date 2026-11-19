import test from 'node:test';
import assert from 'node:assert/strict';
import type { Entitlement } from '@genex-ai/embed-sdk';
import { LOADOUTS, RAVENBLADE_SKU, ownsRavenblade, canEquip, loadoutId } from '../lib/duel/armory';
import { safeSkin, WEAPONS } from '../lib/duel/weapons';
import { DuelSimulation, initPhysics } from '../lib/duel/physics';
await initPhysics();

await test('only a live durable entitlement unlocks Ravenblade, including an owner test grant', () => {
 const entitlement: Entitlement = {id:'entitlement',skuId:RAVENBLADE_SKU,name:'Ravenblade',type:'purchase',skuType:'durable',quantity:1,consumed:false,createdAt:'2026-09-10T00:00:00Z'};
 assert.equal(ownsRavenblade([]),false);assert.equal(canEquip('ravenblade',false),false);
 assert.ok(LOADOUTS.filter(w=>!w.skin).every(w=>canEquip(w.id,false)));
 assert.ok(ownsRavenblade([entitlement]));assert.ok(ownsRavenblade([{...entitlement,type:'test'}]));
 for(const bad of [{skuId:'another-sku'},{consumed:true},{quantity:0},{skuType:'consumable' as const}]) assert.equal(ownsRavenblade([{...entitlement,...bad}]),false);
 assert.equal(safeSkin('mace','ravenblade'),undefined);assert.equal(safeSkin('greatsword','made-up-skin'),undefined);
});

await test('the premium design shares longsword physics and survives drops and round serialization', () => {
 const options=JSON.parse(JSON.stringify({playerWeapon:'greatsword',playerSkin:'ravenblade',rivalWeapon:'greatsword',rivalSkin:null}));
 const sim=new DuelSimulation(options);
 try {
  const weapon=sim.fighters[0].weapon;
  assert.equal(weapon.skin,'ravenblade');assert.equal(weapon.spec,WEAPONS.greatsword);assert.ok(sim.fighters[0].supportGrip);
  assert.equal(sim.fighters[1].weapon.skin,undefined);
  sim.drop();assert.equal(weapon.skin,'ravenblade');assert.equal(weapon.holder,null);
  sim.reset(JSON.parse(JSON.stringify({...options,playerSkin:null})));
  assert.equal(sim.fighters[0].weapon.skin,undefined,'regular longsword clears the previous premium design');
  assert.equal(loadoutId('greatsword','ravenblade'),'ravenblade');assert.equal(loadoutId('sword','ravenblade'),'sword');
 }finally{sim.dispose();}
});
