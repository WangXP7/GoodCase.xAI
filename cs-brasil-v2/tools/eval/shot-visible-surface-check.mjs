/* Hitscan de produção atravessa proxies ocultos substituídos por GLBs. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { THREE, MAPS, Game, initTextures, seedRandom } from './harness.mjs';
import { preloadPropGeometry } from './prop-geometry-fixture.mjs';
import { withVisibleShotOccluders } from '../../public/js/shot_surfaces.js';
import { COMMON_MAP_PROPS } from '../../public/js/mapprops.js';
import { grafiteNoDedicado } from '../../public/js/graffiti_pass.js';
import { buildMansao } from '../../public/js/map_mansao.js';
import { buildEscadao } from '../../public/js/map_escadao.js';
import { buildParque } from '../../public/js/map_parque.js';
if(process.argv.includes('--self-test')){
 const file=fileURLToPath(import.meta.url),normal=spawnSync(process.execPath,[file],{stdio:'inherit'}),mutant=spawnSync(process.execPath,[file,'--mutante=hidden-proxy'],{stdio:'inherit'});
 const pass=normal.status===0&&mutant.status===1;console.log(`Visible shot self-test: ${pass?'PASS normal green, original proxy mutant red':'FAIL'}`);process.exit(pass?0:1);
}
const cases=[
 {id:'mansao',build:buildMansao,from:[-15.2,2.4,28.44000000357628],dir:[0,0,-1]},
 {id:'escadao',build:buildEscadao,from:[12,10.152499983310701,-30],dir:[0,0,-1]},
 {id:'parque_treta',build:buildParque,from:[13,.3900000333786011,21.899999976158142],dir:[0,0,-1]},
];
const activeCases=process.argv.includes('--unit-only')?[]:cases;
await preloadPropGeometry(activeCases.length?[...new Set([...COMMON_MAP_PROPS,...activeCases.flatMap(c=>MAPS[c.id].props||[])])]:[]);
const textures=await initTextures();let failures=0;
const check=(ok,label)=>{console.log(`${ok?'PASS':'FAIL'} ${label}`);if(!ok)failures++;};
function fire(world,from,dir,distance){
 const enemy=combatenteNoRaio(from,dir,distance);
 const game=Object.create(Game.prototype);Object.assign(game,{world,ray:new THREE.Raycaster(),bots:[enemy],playerTeam:'E',online:false,damage:0,_damage(){this.damage++;},_fleshImpact(){},_puff(){},_impactSfx(){},sfx:{ricochet(){}}});
 game._fireHitscan({team:'E'},from,dir,40,false,'AK',null,false);return game.damage;
}
function combatenteNoRaio(from,dir,entrada){
 // Torso canônico: raio 0,45 m; a fixture posiciona a entrada, não o centro visual.
 return {team:'B',alive:true,pos:from.clone().addScaledVector(dir,entrada+.45).add(new THREE.Vector3(0,-1,0))};
}
function massWitness(world,model){
 const meshes=new Set();model.traverse(m=>{if(m.isMesh)meshes.add(m);});
 const box=new THREE.Box3().setFromObject(model),center=box.getCenter(new THREE.Vector3()),ray=new THREE.Raycaster();ray.far=200;
 for(const axis of [0,2])for(const sign of [-1,1])for(const fraction of [.2,.5,.8]){
  const from=center.clone();from.setComponent(axis,sign<0?box.min.getComponent(axis)-1:box.max.getComponent(axis)+1);from.y=box.min.y+(box.max.y-box.min.y)*fraction;
  const dir=new THREE.Vector3().setComponent(axis,-sign);ray.set(from,dir);const first=ray.intersectObjects(world.occluders,false)[0];
  if(!first||!meshes.has(first.object))continue;
  const other=ray.intersectObjects(world.occluders.filter(m=>!meshes.has(m)),false)[0];
  if(!other||other.distance>first.distance+.3)return {from,dir,distance:first.distance+.15,meshes};
 }
 return null;
}

for(const c of activeCases){
 seedRandom(12345);grafiteNoDedicado(true);const raw=process.argv.includes('--mutante=hidden-proxy'),w=(raw?c.build:MAPS[c.id].build)(new THREE.Scene(),textures);w.root.updateMatrixWorld(true);
 const from=new THREE.Vector3(...c.from),dir=new THREE.Vector3(...c.dir),enemy=combatenteNoRaio(from,dir,3);
 const game=Object.create(Game.prototype);Object.assign(game,{world:w,ray:new THREE.Raycaster(),bots:[enemy],playerTeam:'E',online:false,damage:0,_damage(){this.damage++;},_fleshImpact(){},_puff(){},_impactSfx(){},sfx:{ricochet(){}}});
 const end=game._fireHitscan({team:'E'},from,dir,40,false,'AK',null,false),distance=from.distanceTo(end),ok=game.damage===1&&distance>2.98&&distance<3.02;
 console.log(`${ok?'PASS':'FAIL'} VISIBLE ${c.id}: damage=${game.damage}, impact=${distance.toFixed(6)}m, original proxy=${raw}`);if(!ok)failures++;
 if(c.id!=='mansao'){
  const model=c.id==='escadao'?w.casario.find(item=>item.obj)?.obj:w.root.getObjectByName('parque-molde-carrossel')?.children[0];
  const witness=model&&massWitness(w,model);check(!!witness,`MASS ${c.id}: testemunho sobre malha GLB registrada`);
  if(witness){
   const saved=w.occluders;check(fire(w,witness.from,witness.dir,witness.distance)===0,`MASS ${c.id}: malha real bloqueia alvo atrás`);
   w.occluders=saved.filter(m=>!witness.meshes.has(m));check(fire(w,witness.from,witness.dir,witness.distance)===1,`MASS ${c.id}: remover só malha GLB expõe alvo (mutação)`);w.occluders=saved;
  }
 }
 w.ambience?.dispose?.();
}
const materials=Array.from({length:6},()=>new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));materials[5].colorWrite=false;
const mesh=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),materials),root=new THREE.Group();root.add(mesh);root.updateMatrixWorld(true);
const mixed=withVisibleShotOccluders(()=>({root,occluders:[mesh]}))(),from=new THREE.Vector3(0,0,-2),dir=new THREE.Vector3(0,0,1);
check(fire(mixed,from,dir,2)===1,'FACE1 frente colorWrite:false deixa alvo no vão receber dano');
check(fire(mixed,from,dir,3)===0,'FACE2 fundo visível do mesmo mesh continua bloqueando');
root.visible=false;check(fire(mixed,from,dir,3)===1,'DYNAMIC1 ancestor oculto após build deixa de bloquear');root.visible=true;
mesh.material[4].opacity=0;check(fire(mixed,from,dir,3)===1,'DYNAMIC2 material opacidade0 após build deixa de bloquear');mesh.material[4].opacity=1;
const guarded=mesh.raycast;mesh.raycast=THREE.Mesh.prototype.raycast;check(fire(mixed,from,dir,2)===0,'FACE3 remover guarda reintroduz bloqueio da face invisível (mutação)');mesh.raycast=guarded;
const group=new THREE.Group();group.position.y=2;
const left=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial()),right=left.clone();left.position.x=-1.5;right.position.x=1.5;group.add(left,right);group.updateMatrixWorld(true);
const colliders=[{minX:-2,maxX:2}],grouped=withVisibleShotOccluders(()=>({root:group,colliders,occluders:[group,left,group]}))();
check(grouped.occluders.length===2&&grouped.colliders===colliders&&group.position.y===2,'GROUP1 registro Group vira meshes deduplicadas; collider/transform preservados');
check(fire(grouped,new THREE.Vector3(0,2,-2),dir,3)===1,'GROUP2 vão real entre filhos de Group acerta alvo');
check(fire(grouped,new THREE.Vector3(1.5,2,-2),dir,3)===0,'GROUP3 mesh real filha de Group bloqueia massa');
const saved=grouped.occluders;grouped.occluders=[];check(fire(grouped,new THREE.Vector3(1.5,2,-2),dir,3)===1,'GROUP4 remover registro GLB reintroduz tiro através da massa (mutação)');grouped.occluders=saved;
group.visible=false;check(fire(grouped,new THREE.Vector3(1.5,2,-2),dir,3)===1,'GROUP5 visibility dinâmica do ancestor respeitada');
console.log(`Visible surfaces: ${failures} failures`);process.exitCode=failures?1:0;
