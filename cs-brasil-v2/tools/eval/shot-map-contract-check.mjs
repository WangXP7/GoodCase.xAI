/* Real geometry/actual hitscan contracts for quality, hidden proxies, mandatory asset retry. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { THREE, MAPS, initTextures, Game, seedRandom } from './harness.mjs';
import { preloadPropGeometry } from './prop-geometry-fixture.mjs';
import { COMMON_MAP_PROPS, preloadMapProps, hasProp, registerPropTemplate, placeProp } from '../../public/js/mapprops.js';
import * as havan from '../../public/js/map_havan.js';
import { grafiteNoDedicado } from '../../public/js/graffiti_pass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
let failures=0;
const check=(ok,label)=>{console.log(`${ok?'PASS':'FAIL'} ${label}`);if(!ok)failures++;};
if(process.argv.includes('--self-test')){
 const file=fileURLToPath(import.meta.url),normal=spawnSync(process.execPath,[file],{stdio:'inherit'}),mutant=spawnSync(process.execPath,[file,'--mutante=proxy-piscina'],{stdio:'inherit'});
 const pass=normal.status===0&&mutant.status===1;console.log(`Shot map contract self-test: ${pass?'PASS normal green, mutant red':'FAIL'}`);process.exit(pass?0:1);
}
await preloadPropGeometry([...new Set([...COMMON_MAP_PROPS,...MAPS.piscina_treta.props,...MAPS.upa_24h.props,...havan.havanPropsPool()])]);
const textures=await initTextures();grafiteNoDedicado(true);
const build=mod=>{seedRandom(12345);mod.setHavanCarSeed(76543);const world=mod.buildHavan(new THREE.Scene(),textures);world.root.updateMatrixWorld(true);return world;};
const medium=build(havan);
globalThis.localStorage={getItem:()=>JSON.stringify({quality:'low'})};
const lowModule=await import('../../public/js/map_havan.js?shot-quality-low');
const low=build(lowModule);
check(JSON.stringify(medium.colliders)===JSON.stringify(low.colliders),'QUALITY1 LOWQ mantém colliders de Havan');
const ray=new THREE.Raycaster();ray.far=100;let divergence=0,rays=0;
const points=[[-15.5,15],[33,29],[-3.5,47],[20,55],[-38,6],[-38,22],[38,6],[38,22],[-26,59.6],[-10,59.6],[6,59.6],[22,59.6],[0,18],[12,36],[-24,42]];
for(const [x,z] of points)for(const y of [.6,1.3,2.7])for(let a=0;a<8;a++){
 ray.set(new THREE.Vector3(x,y,z),new THREE.Vector3(Math.sin(a*Math.PI/4),0,Math.cos(a*Math.PI/4)));
 const first=w=>ray.intersectObjects(w.occluders,false).find(h=>h.distance>.3)?.distance;
 const m=first(medium),l=first(low);if((m===undefined)!==(l===undefined)||(m!==undefined&&Math.abs(m-l)>1e-6))divergence++;rays++;
}
check(divergence===0,`QUALITY2 LOWQ mesmos bloqueios de bala (${divergence}/${rays})`);
// Exercise each physical proxy separately; batching preserves the same occluder membership.
location.search='?piscinaBatch=0';
seedRandom(12345);const pool=MAPS.piscina_treta.build(new THREE.Scene(),textures);pool.root.updateMatrixWorld(true);
const hidden=[];pool.root.traverse(o=>{if(o.isMesh&&o.material?.colorWrite===false)hidden.push(o);});
check(hidden.length>0,'POOL0 régua encontrou proxies físicos invisíveis');
if(process.argv.includes('--mutante=proxy-piscina'))pool.occluders.push(...hidden.filter(o=>!pool.occluders.includes(o)));
check(!pool.occluders.some(o=>hidden.includes(o)),'POOL1 proxy invisível não bloqueia bala');
let witness=null;
for(const proxy of hidden){const box=new THREE.Box3().setFromObject(proxy),center=box.getCenter(new THREE.Vector3());
 for(const offset of [-.45,0,.45])for(const y of [.08,.3,.6,1.3,1.9])for(let a=0;a<8&&!witness;a++){
  if(y<=box.min.y||y>=box.max.y)continue;
  const dir=new THREE.Vector3(Math.sin(a*Math.PI/4),0,Math.cos(a*Math.PI/4));
  const from=center.clone().addScaledVector(dir,-4);from.add(new THREE.Vector3(dir.z,0,-dir.x).multiplyScalar(offset*Math.max(box.max.x-box.min.x,box.max.z-box.min.z)));from.y=y;ray.set(from,dir);
  const old=ray.intersectObjects([...pool.occluders,...hidden],false)[0];
  const real=ray.intersectObjects(pool.occluders.filter(o=>!hidden.includes(o)),false)[0];
  if(old&&hidden.includes(old.object)&&(!real||real.distance>old.distance+.04))witness={from,dir,distance:old.distance+.02};
 }
 if(witness)break;
}
if(!witness)throw new Error('Piscina sem testemunho geométrico causal');
const group=new THREE.Group(),body=new THREE.Mesh(new THREE.BoxGeometry(.02,1.8,.02),new THREE.MeshBasicMaterial());body.position.y=witness.from.y;group.add(body);
group.position.copy(witness.from).addScaledVector(witness.dir,witness.distance);group.position.y=0;group.updateMatrixWorld(true);
const enemy={team:'B',alive:true,pos:group.position,mesh:{group,parts:{}}};group.userData.botOwner=enemy;
const game=Object.create(Game.prototype);Object.assign(game,{world:pool,ray:new THREE.Raycaster(),bots:[enemy],playerTeam:'E',online:false,damage:0,_damage(){this.damage++;},_fleshImpact(){},_puff(){},_impactSfx(){},sfx:{ricochet(){}}});
game._fireHitscan({team:'E'},witness.from,witness.dir,40,false,'AK',null,false);
check(game.damage===1,`POOL2 actual hitscan atravessa o vão do proxy (${JSON.stringify({from:witness.from.toArray(),dir:witness.dir.toArray(),distance:witness.distance})})`);
const id=MAPS.piscina_treta.props[0], saved=placeProp(id,{targetH:1}),original=GLTFLoader.prototype.load,warning=console.warn;let attempts=0;registerPropTemplate(id,null);
GLTFLoader.prototype.load=function(url,ok,progress,fail){if(!String(url).includes(id))return original.call(this,url,ok,progress,fail);attempts++;if(attempts<3)fail(new Error('fixture download failed'));else ok({scene:new THREE.Group()});};
console.warn=()=>{};
try{
 await preloadMapProps(['shot_unused_global_fixture']);
 await preloadMapProps(MAPS.upa_24h.props,{required:true});check(MAPS.upa_24h.props.length===9&&MAPS.upa_24h.props.every(hasProp),'LOAD0 erro em prop alheio não bloqueia UPA com os nove GLBs carregados');
 await preloadMapProps([id]);check(!hasProp(id),'LOAD1 offline permite fallback após erro');
 let rejected=false;try{await preloadMapProps([id],{required:true});}catch(e){rejected=e.message.includes('Tente novamente');}
 check(rejected&&!hasProp(id),'LOAD2 online rejeita mapa incompleto com feedback');
 await preloadMapProps([id],{required:true});check(hasProp(id)&&attempts===3,'LOAD3 nova tentativa carrega asset obrigatório');
}finally{GLTFLoader.prototype.load=original;console.warn=warning;registerPropTemplate(id,saved);}
console.log(`Shot map contract: ${failures} failures`);process.exitCode=failures?1:0;
