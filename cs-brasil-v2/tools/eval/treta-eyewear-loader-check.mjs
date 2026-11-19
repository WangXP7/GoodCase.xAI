import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
let source=readFileSync(new URL('../../public/js/eyewear.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/gm,'').replaceAll('export async function','async function').replaceAll('export function','function');
if(process.argv.includes('--mutant=no-retry')){const previous=source;source=source.replace('fitRequest=null;console.warn','console.warn');assert.notEqual(source,previous,'mutation did not apply');}
let calls=0,loads=0;const bodySha='a'.repeat(64),profileId='character:capitao@aaaaaaaaaaaa',profile={bodyId:'character:capitao',profileId,bodySha256:bodySha,status:'certified',certified:true,source:'gpt-pilot+human-candidate',width:.96,height:.44,depth:.04,lensY:.5},landmark={bodyId:'character:capitao',profileId,bodySha256:bodySha,origin:'gpt-pilot+human-candidate',eyewear:{status:'measured'}};
const context={THREE:{},GLTFLoader:class{async loadAsync(){loads++;return {scene:{}};}},console,fetch:async url=>{calls++;if(calls===1)throw Error('transient');return {ok:true,json:async()=>String(url).includes('face-landmarks')?{bodies:{capitao:landmark}}:{eyewear:{test:{approved:true,model:'/models/items/test.glb',profiles:{capitao:profile}}}}};}};
vm.createContext(context);vm.runInContext("const TRETA_ITEMS_ENABLED = true;\n"+source,context);
await context.preloadEyewearAssets(['test']);assert.equal(loads,0);
await Promise.all([context.preloadEyewearAssets(['test']),context.preloadEyewearAssets(['test'])]);
assert.equal(calls,4,'Transient fit-data failure must permit one manifest+landmark retry');assert.equal(loads,1,'Concurrent preload must deduplicate GLB');
await context.preloadEyewearAssets(['test']);assert.equal(loads,1);
console.log('PASS: transient manifest error recovers; concurrent and cached preload load one GLB');
