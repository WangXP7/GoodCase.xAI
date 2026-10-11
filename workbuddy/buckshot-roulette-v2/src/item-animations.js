import * as T from '../vendor/three.module.min.js';

const ease=t=>t*t*(3-2*t);
const clamp=t=>T.MathUtils.clamp(t,0,1);
const v=(x,y,z)=>new T.Vector3(x,y,z);
function mesh(parent,geometry,material,position,rotation=[0,0,0]) {
  const o=new T.Mesh(geometry,material);o.position.copy(position);o.rotation.set(...rotation);o.castShadow=true;parent.add(o);return o;
}
function cylinder(parent,r,length,material,position,rotation=[0,0,0]) {
  return mesh(parent,new T.CylinderGeometry(r,r,length,12),material,position,rotation);
}
function hand(world) {
  const g=new T.Group(),m=world.materials;
  const palm=mesh(g,new T.SphereGeometry(1,12,8),m.skin,v(0,0,0));palm.scale.set(.08,.046,.11);
  for(let i=0;i<4;i++){
    cylinder(g,.022,.13,m.skin,v((i-1.5)*.043,0,-.10),[Math.PI/2,0,0]);
    mesh(g,new T.SphereGeometry(.022,8,6),m.skin,v((i-1.5)*.043,-.014,-.165));
  }
  cylinder(g,.03,.12,m.skin,v(-.09,.005,-.03),[.8,0,-.55]);
  cylinder(g,.066,.23,m.dark,v(0,-.025,.18),[Math.PI/2,0,0]);
  return g;
}
function path(o,keys,t) {
  let i=1;while(i<keys.length-1&&t>keys[i][0])i++;
  const a=keys[i-1],b=keys[i],u=ease(clamp((t-a[0])/(b[0]-a[0])));
  o.position.lerpVectors(a[1],b[1],u);
  if(a[2]&&b[2])o.quaternion.copy(a[2]).slerp(b[2],u);
}
function smoke(world,parent) {
  const c=document.createElement('canvas');c.width=c.height=64;
  const ctx=c.getContext('2d'),g=ctx.createRadialGradient(32,32,0,32,32,32);
  g.addColorStop(0,'rgba(190,192,174,.5)');g.addColorStop(1,'rgba(190,192,174,0)');ctx.fillStyle=g;ctx.fillRect(0,0,64,64);
  const texture=new T.CanvasTexture(c),puffs=[];
  for(let i=0;i<12;i++){const p=new T.Sprite(new T.SpriteMaterial({map:texture,transparent:true,opacity:0,depthWrite:false}));parent.add(p);puffs.push(p);}
  return {texture,puffs,update(t,origin){puffs.forEach((p,i)=>{const age=t-i*.045;if(age<0||age>1.1){p.visible=false;return;}p.visible=true;p.position.copy(origin).add(v(Math.sin(i*3+age*2)*.09,age*.45,.04+age*.12));p.scale.setScalar(.08+age*.24);p.material.opacity=Math.sin(clamp(age/1.1)*Math.PI)*.45;});}};
}

// The scene clock owns this timeline: pause freezes it and changing scenes cancels it.
// Gameplay commits once in the engine; these objects only present that result.
export function animateItem(world,event,onEffect=()=>{}) {
  world.itemAnimation?.cancel();
  const id=event.transfer?'adrenaline':event.id,who=event.who,m=world.materials;
  world.animating=true;world.interactive=false;world.clearHover();
  world.lookOffset.set(0,0);world.camera.lookAt(world.look);world.camera.updateMatrixWorld(true);
  const group=new T.Group();world.scene.add(group);
  const sourceWho=event.transfer?(who==='player'?'dealer':'player'):who;
  const source=world.itemGroup.children.find(o=>o.userData.id===event.id&&o.userData.pick?.startsWith(`item:${sourceWho}:`));
  const start=world.stolenItemPosition?.clone()||source?.position.clone()||v(who==='player'?.8:-.8,.84,who==='player'?1.2:-1);
  if(!event.transfer)world.stolenItemPosition=null;
  if(source&&!event.transfer)source.visible=false;
  const prop=world.makeItem(id);group.add(prop);prop.position.copy(start);
  const grip=hand(world);group.add(grip);
  const q=world.camera.quaternion.clone(),rot=(x=0,y=0,z=0)=>q.clone().multiply(new T.Quaternion().setFromEuler(new T.Euler(x,y,z)));
  const stage=(x,y,d=2.2)=>{const h=Math.tan(T.MathUtils.degToRad(world.camera.fov/2))*d;return v(x*h*world.camera.aspect,y*h,-d).applyQuaternion(q).add(world.camera.position);};
  const center=stage(0,-.06),mouth=who==='dealer'?v(0,1.94,-1.45):stage(.14,-.36,id==='cigarettes'?1.15:1.65),ear=who==='dealer'?v(.53,2.32,-1.7):stage(.50,.02,1.6);
  const fill=new T.PointLight('#d0c4a0',5,5,2);fill.position.copy(stage(-.32,.5,1));group.add(fill);
  const hidden=stage(.48,-1.15),restQ=new T.Quaternion();
  const gunIds=['glass','saw','beer','inverter'];
  if(gunIds.includes(id)){
    world.gunGoal.copy(stage(0,-.17,3.1));world.gunQuaternion.copy(q);
    if(id==='glass'||id==='inverter')world.gunQuaternion.multiply(new T.Quaternion().setFromEuler(new T.Euler(.23,0,0)));
    if(id==='saw')world.gunQuaternion.multiply(new T.Quaternion().setFromEuler(new T.Euler(0,.52,0)));
  }
  const gunPoint=p=>p.clone().applyQuaternion(world.gunQuaternion).add(world.gunGoal);
  const chamber=gunPoint(v(.08,.23,.10)),cut=gunPoint(v(-.9,.11,0));
  const secondary=[],textures=[];
  let smokeEffect,ember,cigarette,looseShell,offcut,cap,pills,stolen;
  const ownMaterial=(color,extras={})=>new T.MeshStandardMaterial({color,roughness:.65,...extras});
  if(id==='cigarettes'){
    cigarette=new T.Group();group.add(cigarette);cigarette.visible=false;
    cylinder(cigarette,.014,.22,m.ivory,v(0,0,0),[Math.PI/2,0,0]);
    cylinder(cigarette,.015,.07,m.brass,v(0,0,.09),[Math.PI/2,0,0]);
    ember=cylinder(cigarette,.015,.015,ownMaterial('#8b3218',{emissive:'#fb5920',emissiveIntensity:0}),v(0,0,-.115),[Math.PI/2,0,0]);
    smokeEffect=smoke(world,group);textures.push(smokeEffect.texture);
  }
  if(id==='beer') {looseShell=world.shell(event.live);group.add(looseShell);looseShell.visible=false;}
  if(id==='saw') {
    offcut=new T.Group();group.add(offcut);offcut.visible=false;
    cylinder(offcut,.044,.58,m.steel,v(-.29,.055,0),[0,0,Math.PI/2]);
    mesh(offcut,new T.BoxGeometry(.05,.038,.026),m.dark,v(-.46,.113,0));
    cylinder(offcut,.038,.09,m.dark,v(-.045,-.03,0),[0,0,Math.PI/2]);
  }
  if(id==='inverter'){
    looseShell=world.shell(false);group.add(looseShell);looseShell.visible=false;
    const glow=new T.PointLight('#f3ae6b',0,1.5);group.add(glow);secondary.push(glow);
  }
  if(id==='medicine'){
    cap=cylinder(group,.083,.035,m.ivory,center);cap.visible=false;
    pills=new T.Group();group.add(pills);pills.visible=false;
    for(let i=0;i<3;i++)mesh(pills,new T.SphereGeometry(.023,8,6),m.ivory,v(i*.045,0,0)).scale.set(1,1,1.8);
  }
  if(event.transfer){stolen=world.makeItem(event.id);group.add(stolen);stolen.position.copy(source?.position||start);stolen.visible=false;}
  const duration=id==='saw'?2.65:id==='phone'?2.5:id==='cigarettes'?2.6:2.1;
  const effectAt=id==='saw'?.67:id==='cigarettes'?.61:.57;
  let elapsed=0,applied=false,settled=false;
  return new Promise((resolve,reject)=>{
    const cleanup=()=>{
      if(source)source.visible=true;
      group.traverse(o=>{if(o.isSprite){o.material.dispose();}});
      world.scene.remove(group);world.disposeGroup(group);textures.forEach(t=>t.dispose());
      world.releaseGun();world.pump.position.x=0;
      world.itemAnimation=null;world.animating=false;
    };
    const finish=cancelled=>{if(settled)return;settled=true;cleanup();if(cancelled)reject(new Error('CANCELLED'));else resolve();};
    const timeline={id,who,elapsed:0,duration,group,cancel:()=>finish(true),tick(dt){
      elapsed+=dt;timeline.elapsed=elapsed;const t=clamp(elapsed/duration);
      try {
        path(prop,[[0,start,restQ],[.22,center,rot(.6,0,0)],[.72,center,rot(.6,0,0)],[1,hidden,rot(1,0,0)]],t);
        if(id==='glass'){
          const inspect=chamber.clone().add(v(0,.05,.06).applyQuaternion(q));
          path(prop,[[0,start,restQ],[.25,center,rot(.45)],[.44,inspect,rot(.45)],[.76,inspect,rot(.45)],[1,hidden,rot(.8)]],t);
          if(t>.44&&t<.76)prop.position.add(v(Math.sin(t*20)*.024,Math.cos(t*19)*.015,0).applyQuaternion(q));
        }else if(id==='saw'){
          const cutQ=world.gunQuaternion.clone().multiply(new T.Quaternion().setFromEuler(new T.Euler(Math.PI/2,0,Math.PI/2)));
          path(prop,[[0,start,restQ],[.25,cut,cutQ],[.68,cut,cutQ],[1,hidden,rot(1)]],t);
          if(t>.25&&t<.68)prop.position.add(v(0,-.016,Math.sin(t*100)*.15).applyQuaternion(world.gunQuaternion));
          if(t>=effectAt){offcut.visible=true;offcut.position.copy(gunPoint(v(-.9,0,0))).add(v(-.25*(t-effectAt),-5*(t-effectAt)**2,.1));offcut.quaternion.copy(world.gunQuaternion).multiply(new T.Quaternion().setFromEuler(new T.Euler(0,0,(t-effectAt)*5)));}
        }else if(id==='cigarettes'){
          prop.visible=t<.37;
          if(t>=.28){cigarette.visible=true;path(cigarette,[[.28,center,q],[.49,mouth,q],[.67,mouth,q],[1,hidden,q]],t);grip.position.copy(cigarette.position);ember.material.emissiveIntensity=t>.46&&t<.70?1+Math.sin(clamp((t-.46)/.24)*Math.PI)*4:1;smokeEffect.update((t-.6)*3,mouth);}
        }else if(id==='beer'){
          path(prop,[[0,start,restQ],[.22,center,rot(.1)],[.42,mouth,rot(-1.25)],[.61,mouth,rot(-1.3)],[1,hidden,rot(.4)]],t);
          world.pump.position.x=t>.61&&t<.8?Math.sin((t-.61)/.19*Math.PI)*.18:0;
          if(t>.64){looseShell.visible=true;const u=(t-.64)*3;looseShell.position.copy(gunPoint(v(.1,.06,.15))).add(v(u*.55,u*.3-u*u*.7,u*.2));looseShell.rotation.set(u*7,u*4,1);}
        }else if(id==='cuffs'){
          const wrist=who==='player'?v(1.03,1.07,-1.02):stage(-.35,-.3,2);
          path(prop,[[0,start,restQ],[.24,center,rot(.7)],[.57,wrist,rot(.5)],[.82,wrist,rot(.5)],[1,wrist.clone().add(v(0,-.11,0)),rot(.5)]],t);
        }else if(id==='phone'){
          path(prop,[[0,start,restQ],[.25,center,rot(1.3)],[.43,ear,rot(1.6,0,.2)],[.79,ear,rot(1.6,0,.2)],[1,hidden,rot(.7)]],t);
        }else if(id==='inverter'){
          path(prop,[[0,start,restQ],[.25,center,rot(.6)],[.47,chamber,rot(.4)],[.75,chamber,rot(.4)],[1,hidden,rot(.7)]],t);
          if(t>.40&&t<.82){looseShell.visible=true;looseShell.position.copy(chamber).add(v(0,.13,0));looseShell.rotation.z=clamp((t-.45)/.25)*Math.PI;secondary[0].position.copy(chamber);secondary[0].intensity=world.settings.motion?Math.sin(clamp((t-.4)/.42)*Math.PI)*2:0;}else looseShell.visible=false;
        }else if(id==='medicine'){
          path(prop,[[0,start,restQ],[.25,center,rot(.3)],[.55,mouth,rot(-1.9)],[.76,mouth,rot(-1.9)],[1,hidden,rot(.5)]],t);
          if(t>.27){prop.children[1].visible=false;cap.visible=true;cap.position.copy(center).add(v(.3*(t-.27),.22-(t-.27)**2*2,0));cap.rotation.y=t*12;}
          if(t>.41&&t<.6){pills.visible=true;pills.position.lerpVectors(center,mouth,clamp((t-.41)/.19));}else pills.visible=false;
        }else if(id==='adrenaline'){
          const wrist=stage(-.20,-.34,1.7);
          path(prop,[[0,start,restQ],[.23,center,rot(0,.4)],[.48,wrist,rot(0,.7)],[.7,wrist,rot(0,.7)],[1,hidden,rot(1)]],t);
          if(stolen&&t>.6){stolen.visible=true;const destination=v(.7,.85,who==='player'?1.1:-.8);path(stolen,[[.6,source?.position||start],[.81,center],[1,destination]],t);world.stolenItemPosition=destination;}
        }
        if(!(id==='cigarettes'&&t>=.28))grip.position.copy(prop.position);
        if(id==='saw'){
          grip.position.add(v(.20,.05,0).applyQuaternion(prop.quaternion));grip.quaternion.copy(rot(.6,0,-.15));
        }else if(['beer','medicine','phone','cigarettes'].includes(id)){
          grip.quaternion.copy(rot(.6,0,-.15));grip.position.add(v(.10,-.08,.08).applyQuaternion(q));
        }else{grip.quaternion.copy(prop.quaternion);grip.position.add(v(.11,-.045,.12).applyQuaternion(prop.quaternion));}
        if(id==='cuffs'&&t>.7)grip.position.lerp(hidden,ease((t-.7)/.3));
        if(!applied&&t>=effectAt){applied=true;if(id==='saw')world.setSaw(true);onEffect();}
        if(t>=1)finish(false);
      }catch(error){finish(true);console.error('Item animation failed',error);}
    }};
    world.itemAnimation=timeline;timeline.tick(0);
  });
}
