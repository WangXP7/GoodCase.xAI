import {Game,THREE} from './harness.mjs';
import {perfilArma} from '../../public/js/data/weapon-profiles.js';
import {WEAPONS} from '../../public/js/data/weapons.js';
import {writeFileSync,mkdirSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const out=process.env.BALLISTICS_QA_OUT || '/tmp/corosolto-balistica-playtest';mkdirSync(out,{recursive:true});
const gameSha256=createHash('sha256').update(readFileSync(new URL('../../public/js/game.js',import.meta.url))).digest('hex');
// Bancada com FX principais desativados: gatilho, cone, recuo, hitbox e dano são os consumidores reais.
const g=Object.create(Game.prototype);g.state='live';g.camView='first';g.online=false;g.dedicated=false;g.world={occluders:[]};g.ray=new THREE.Raycaster();g.camera=new THREE.PerspectiveCamera();
g.vm={authored:{shoot(){}},recoil:{kick(){}},root:{},rig:{}};g.sfx=new Proxy({},{get:()=>()=>{}});g.espectando=()=>false;g._aimOrigin=()=>new THREE.Vector3(0,1.62-.52*(g.player.crouchF||0),0);g._muzzleWorld=()=>new THREE.Vector3(0,1.5,-.5);
for(const k of ['_botOuve','_flash','_ejectCasing','_fleshImpact','_tracer','_startReload'])g[k]=()=>{};
g._scope=function(on){this.player.scoped=on;this._aimF=on?1:0;};
let hits=0,head=0,rays=0,radial=[],coneAngles=[];const fire=g._fireHitscan;g._fireHitscan=function(shooter,from,dir,...args){rays++;const p=this.player;const aim=new THREE.Vector3(0,0,-1).applyEuler(new THREE.Euler(p.pitch+(p.recoilP||0),p.yaw,0,'YXZ'));coneAngles.push(Math.acos(Math.max(-1,Math.min(1,aim.dot(dir)))));const z=-this.bots[0].pos.z;radial.push(Math.hypot(from.x-dir.x*z/dir.z,from.y-dir.y*z/dir.z-1));return fire.call(this,shooter,from,dir,...args);};
g._damage=(ent,dmg,attacker,w,hs)=>{ent.hp-=dmg;hits++;if(hs)head++;if(ent.hp<=0)ent.alive=false;};
let n=1;const original=Math.random;const seed=v=>{n=v>>>0;Math.random=()=>{n=(1664525*n+1013904223)>>>0;return n/4294967296;};};
const rows=[];const fixed=process.argv.includes('--fixed-five');try{for(const [id,W]of Object.entries(WEAPONS)){if(id==='knife')continue;for(const distance of [3,12,30])for(const stance of ['hip','ads','crouch-ads'])for(const compensate of [true,false]){
 const trials=[];let totalShots=0,totalHits=0,totalHeads=0,totalRays=0,shotsWithHit=0,censoredMagazine=0,censoredTime=0,allR=[],allCone=[];for(let trial=0;trial<100;trial++){
 seed(985000+trial);g.time=10;g.bloom=0;g._aimF=stance.includes('ads')?1:0;
 const p=g.player={alive:true,hp:100,isPlayer:true,team:'E',weapon:id,vel:new THREE.Vector3(),pos:new THREE.Vector3(),yaw:0,pitch:Math.atan2(1-(1.62-.52*(stance.startsWith('crouch')?1:0)),distance),crouchF:stance.startsWith('crouch')?1:0,grounded:true,scoped:stance.includes('ads'),nextShotAt:0,drawUntil:0,reloadUntil:0,ammo:{[id]:{mag:W.mag,res:0}}};
 g.bots=[{alive:true,hp:100,team:'B',pos:new THREE.Vector3(0,0,-distance),crouchF:0}];if(fixed)g.bots[0].hp=Infinity;hits=0;head=0;rays=0;radial=[];coneAngles=[];let shots=0,first=null,last=null;
 for(let frame=0;frame<(fixed?2400:1200)&&p.ammo[id].mag>0&&g.bots[0].alive&&(!fixed||shots<5);frame++){
  g.time=10+frame/120;g.bloom=Math.max(0,g.bloom-1.8/120);const punch=p.recoilP||0;
  if(compensate){p.yaw=0;p.pitch=Math.atan2(1-(1.62-.52*(stance.startsWith('crouch')?1:0)),distance)-punch;}
  // Gatilho semi clicado a cada oportunidade; auto conserva fase como o loop real.
  if(stance.includes('ads'))g._scope(true);const before=p.ammo[id].mag,hitBefore=hits;g._tryShoot(perfilArma(id).segurar);if(p.ammo[id].mag<before){shots++;if(hits>hitBefore)shotsWithHit++;first??=g.time;last=g.time;}
 }
 totalShots+=shots;totalHits+=hits;totalHeads+=head;totalRays+=rays;allR.push(...radial);allCone.push(...coneAngles);if(g.bots[0].alive&&!fixed){if(p.ammo[id].mag<=0)censoredMagazine++;else censoredTime++;}if(fixed&&shots!==5)throw Error('sequência fixa incompleta '+id);trials.push(g.bots[0].alive?null:last-first);
 }
 const done=trials.filter(x=>x!==null).sort((a,b)=>a-b);allR.sort((a,b)=>a-b);allCone.sort((a,b)=>a-b);const q=(a,p)=>a.length?a[Math.ceil(a.length*p)-1]:null;
 const row={id,distance,stance,compensate,trials:100,kills:done.length,censored:100-done.length,ttkAmongKillsP50:q(done,.5),ttkAmongKillsP90:q(done,.9),censoredMagazine,censoredTime,shots:totalShots,rays:totalRays,shotsWithHit,hits:totalHits,heads:totalHeads,absoluteRadiusP90:q(allR,.9),coneAngleP90:q(allCone,.9),coneRadiusP90:Math.tan(q(allCone,.9))*distance,fixedShotsPerTrial:fixed?5:null};if(fixed)for(const k of ['kills','censored','ttkAmongKillsP50','ttkAmongKillsP90','censoredMagazine','censoredTime'])delete row[k];rows.push(row);console.log(JSON.stringify(row));
}}}finally{Math.random=original;writeFileSync(out+'/' +(fixed?'fixed-five-dispersion.json':'range-playtest.json'),JSON.stringify({gameSha256,hz:120,limitSeconds:fixed?20:10,stopAtMagazineEmpty:true,mainFxDisabled:true,cosmeticKickSideStillSamples:true,ttkConditionalOnKill:true,fixedShotsPerTrial:fixed?5:null,rows},null,2));}
