/* Runtime quality must not remove physical cover used by authoritative bullets. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { THREE, MAPS, Game, seedRandom, initTextures } from './harness.mjs';
import { preloadPropGeometry } from './prop-geometry-fixture.mjs';
import { grafiteNoDedicado } from '../../public/js/graffiti_pass.js';
if(process.argv.includes('--self-test')){
 const file=fileURLToPath(import.meta.url),normal=spawnSync(process.execPath,[file],{stdio:'inherit'}),mutant=spawnSync(process.execPath,[file,'--mutante=cover-low'],{stdio:'inherit'});
 const pass=normal.status===0&&mutant.status===1;console.log(`Brasilia quality self-test: ${pass?'PASS normal green, mutant red':'FAIL'}`);process.exit(pass?0:1);
}
await preloadPropGeometry(MAPS.praca_poderes.props);const textures=await initTextures();grafiteNoDedicado(true);
function build(quality){globalThis.localStorage={getItem:()=>JSON.stringify({quality})};seedRandom(12345);const w=MAPS.praca_poderes.build(new THREE.Scene(),textures);w.root.updateMatrixWorld(true);return w;}
const medium=build('med'),low=build('low');
if(process.argv.includes('--mutante=cover-low')){
 const bin=low.occluders.find(o=>o.geometry?.parameters?.radiusTop===.38&&o.geometry?.parameters?.height===1);
 if(!bin)throw new Error('Mutante sem lixeiras');
 low.occluders=low.occluders.filter(o=>o!==bin);bin.parent.remove(bin);
}
let failures=0;
const check=(ok,label)=>{console.log(`${ok?'PASS':'FAIL'} ${label}`);if(!ok)failures++;};
check(JSON.stringify(medium.colliders)===JSON.stringify(low.colliders),`BRQUALITY1 colliders invariantes (${medium.colliders.length}/${low.colliders.length})`);
const points=[[-7.2,-38],[-7.2,-56],[7.2,-18],[-4.2,13],[-3,12],[-10,42],[-13,34],[-13,-30],[-4,20],[-8,-44],[-22,-48],[-22,-16],[-18,-34],[-18,2]];
const ray=new THREE.Raycaster();ray.far=100;let divergent=0,rays=0;
for(const [x,z]of points)for(const y of [.3,.6,1.3])for(let a=0;a<8;a++){
 ray.set(new THREE.Vector3(x-2*Math.sin(a*Math.PI/4),y,z-2*Math.cos(a*Math.PI/4)),new THREE.Vector3(Math.sin(a*Math.PI/4),0,Math.cos(a*Math.PI/4)));
 const first=w=>ray.intersectObjects(w.occluders,false).find(h=>h.distance>.05)?.distance;
 const m=first(medium),l=first(low);if((m===undefined)!==(l===undefined)||(m!==undefined&&Math.abs(m-l)>1e-6))divergent++;rays++;
}
check(divergent===0,`BRQUALITY2 mesmos bloqueios (${divergent}/${rays})`);
const from=new THREE.Vector3(-7.2,.5,-41),dir=new THREE.Vector3(0,0,1),group=new THREE.Group();
const body=new THREE.Mesh(new THREE.BoxGeometry(.02,1.8,.02),new THREE.MeshBasicMaterial());body.position.y=.9;group.add(body);group.position.set(-7.2,0,-38);group.updateMatrixWorld(true);
const enemy={team:'B',alive:true,pos:group.position,mesh:{group,parts:{}}};group.userData.botOwner=enemy;
const fire=w=>{const g=Object.create(Game.prototype);Object.assign(g,{world:w,ray:new THREE.Raycaster(),bots:[enemy],playerTeam:'E',online:false,damage:0,_damage(){this.damage++;},_fleshImpact(){},_puff(){},_impactSfx(){},sfx:{ricochet(){}}});g._fireHitscan({team:'E'},from,dir,40,false,'AK',null,false);return g.damage;};
check(fire(medium)===fire(low),'BRQUALITY3 actual hitscan mesmo alvo atrás da lixeira em med/low');
console.log(`Brasilia shot quality: ${failures} failures`);process.exitCode=failures?1:0;
