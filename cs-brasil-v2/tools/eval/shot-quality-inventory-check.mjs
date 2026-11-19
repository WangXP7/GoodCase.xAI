/* Fresh-process quality inventory: real GLB, no artwork, all registered maps. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const worker=process.argv.find(a=>a.startsWith('--worker='))?.slice(9);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
if(worker){
 globalThis.localStorage={getItem:()=>JSON.stringify({quality:worker})};
 const {THREE,MAPS,seedRandom,initTextures}=await import('./harness.mjs');
 const {preloadPropGeometry}=await import('./prop-geometry-fixture.mjs');
 const {COMMON_MAP_PROPS}=await import('../../public/js/mapprops.js');
 const {havanPropsPool,setHavanCarSeed}=await import('../../public/js/map_havan.js');
 const {grafiteNoDedicado}=await import('../../public/js/graffiti_pass.js');
 setHavanCarSeed(76543);
 await preloadPropGeometry([...new Set([...COMMON_MAP_PROPS,...Object.values(MAPS).flatMap(m=>m.props||[]),...havanPropsPool()])]);
 const textures=await initTextures(),out={quality:worker,maps:{}};
 for(const [id,map]of Object.entries(MAPS)){
  try{
   seedRandom(12345);setHavanCarSeed(76543);grafiteNoDedicado(true);const scene=new THREE.Scene(),w=map.build(scene,textures);scene.updateMatrixWorld(true);
   const b=w.bounds;if(!b)throw new Error('mapa sem bounds');const rays=[],probe=new THREE.Raycaster();probe.far=400;
   for(let ix=1;ix<=4;ix++)for(let iz=1;iz<=3;iz++)for(const y of [.5,1.3,2.7])for(let a=0;a<8;a++){
    const x=Math.round((b.minX+(b.maxX-b.minX)*ix/5)*1e9)/1e9,z=Math.round((b.minZ+(b.maxZ-b.minZ)*iz/4)*1e9)/1e9;
    const origin=new THREE.Vector3(x,w.groundHeightAt(x,z)+y,z),dir=new THREE.Vector3(Math.abs(Math.sin(a*Math.PI/4))<1e-12?0:Math.sin(a*Math.PI/4),0,Math.abs(Math.cos(a*Math.PI/4))<1e-12?0:Math.cos(a*Math.PI/4));probe.set(origin,dir);
    const hit=probe.intersectObjects(w.occluders,false).find(h=>h.distance>.3);rays.push({from:origin.toArray(),distance:hit?.distance??null});
   }
   const surfaces={hiddenNode:0,hiddenMaterial:0,colorWriteFalse:0,opacityZero:0,nonSolid:0,alphaTest:0};
   for(const mesh of w.occluders){
    let hiddenNode=false,nonSolid=false;for(let n=mesh;n;n=n.parent){hiddenNode ||= n.visible===false;nonSolid ||= !!n.userData.nonSolidSurface;}
    const ms=Array.isArray(mesh.material)?mesh.material:[mesh.material],flags={hiddenNode,nonSolid,hiddenMaterial:ms.some(m=>m?.visible===false),colorWriteFalse:ms.some(m=>m?.colorWrite===false),opacityZero:ms.some(m=>m?.opacity===0),alphaTest:ms.some(m=>m?.alphaTest>0)};
    for(const [key,value]of Object.entries(flags))if(value)surfaces[key]++;
   }
   out.maps[id]={surfaces,colliders:w.colliders.length,colliderHash:hash(w.colliders),occluders:w.occluders.length,rays};w.ambience?.dispose?.();
   console.log(`QUALITY INVENTORY ${worker} ${id}: ${w.colliders.length} colliders, ${w.occluders.length} occluders, ${rays.length} rays`);
  }catch(error){out.maps[id]={error:error.message};console.log(`QUALITY INVENTORY ${worker} ${id}: ERROR ${error.message}`);}
 }
 writeFileSync(process.env.SHOT_QUALITY_OUTPUT,JSON.stringify(out));
}else{
 const file=fileURLToPath(import.meta.url),records=[];let failed=0;
 for(const q of ['med','low']){
  const output=`/tmp/shot-quality-inventory-${process.pid}-${q}.json`;
  const run=spawnSync(process.execPath,[file,`--worker=${q}`],{stdio:'inherit',env:{...process.env,SHOT_QUALITY_OUTPUT:output}});
  if(run.status!==0)throw new Error(`Quality inventory worker ${q}: exit ${run.status}`);
  records.push(JSON.parse(readFileSync(output,'utf8')));
 }
 const [med,low]=records,summary=[];
 for(const id of Object.keys(med.maps)){
  const m=med.maps[id],l=low.maps[id];let divergent=0;
  if(m.error||l?.error){failed++;summary.push({id,error:m.error||l?.error});continue;}
  for(let i=0;i<m.rays.length;i++){
   const a=m.rays[i],b=l.rays[i];if(!b||a.from.some((n,j)=>Math.abs(n-b.from[j])>1e-6)||(a.distance===null)!==(b.distance===null)||(a.distance!==null&&Math.abs(a.distance-b.distance)>1e-6))divergent++;
  }
  const colliders=m.colliderHash===l.colliderHash,visible=[m,l].every(v=>['hiddenNode','hiddenMaterial','colorWriteFalse','opacityZero'].every(k=>v.surfaces[k]===0)),ok=colliders&&divergent===0&&visible;if(!ok)failed++;
  const row={id,collidersEqual:colliders,colliders:[m.colliders,l.colliders],occluders:[m.occluders,l.occluders],surfaces:[m.surfaces,l.surfaces],divergent,rays:m.rays.length};summary.push(row);console.log(`${ok?'PASS':'FAIL'} QUALITY ${JSON.stringify(row)}`);
 }
 const path=process.argv.find(a=>a.startsWith('--report='))?.slice(9)||'/tmp/shot-quality-inventory-summary.json';writeFileSync(path,JSON.stringify({maps:summary,failures:failed},null,2)+'\n');
 console.log(`Quality inventory: ${failed} failures; summary ${path}`);process.exitCode=failed?1:0;
}
