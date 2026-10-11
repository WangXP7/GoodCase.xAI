import * as T from '../vendor/three.module.min.js';
import { animateItem } from './item-animations.js';

const TAU = Math.PI * 2;
const rng = (seed = 812) => () => { seed = (Math.imul(seed,1664525)+1013904223) >>> 0; return seed / 4294967296; };
function canvasTexture(draw, w = 1024, h = w) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}
function grime(kind = 'metal') {
  return canvasTexture((c,w,h) => {
    const r = rng(kind === 'table' ? 50 : 20);
    c.fillStyle = kind === 'table' ? '#424638' : kind === 'wall' ? '#323029' : kind === 'skin' ? '#767362' : '#48443c'; c.fillRect(0,0,w,h);
    for (let i=0;i<14000;i++) {
      const light = r() > .6;
      c.fillStyle = `rgba(${light?'173,166,136':'6,7,5'},${r()*.13})`;
      c.fillRect(r()*w,r()*h,1+r()*8,1+r()*8);
    }
    for (let i=0;i<140;i++) {
      const x=r()*w,y=r()*h,rad=r()*130+20, g=c.createRadialGradient(x,y,0,x,y,rad);
      g.addColorStop(0,`rgba(13,10,6,${r()*.35})`);g.addColorStop(1,'transparent');c.fillStyle=g;c.fillRect(x-rad,y-rad,rad*2,rad*2);
    }
    for (let i=0;i<550;i++) {
      c.strokeStyle=`rgba(${r()>.5?'162,146,110':'15,14,10'},${r()*.4})`;c.lineWidth=r()*1.6;
      const x=r()*w,y=r()*h;c.beginPath();c.moveTo(x,y);c.lineTo(x+r()*70-35,y+r()*6);c.stroke();
    }
    if (kind === 'wall') {
      for (let row=0;row<8;row++) for (let col=0;col<5;col++) {
        const x=(col-(row%2)*.5)*w/4,y=row*h/8;
        c.strokeStyle='#12130f';c.lineWidth=6;c.strokeRect(x,y,w/4,h/8);c.strokeStyle='#64604e';c.lineWidth=1;c.strokeRect(x+4,y+4,w/4-7,h/8-7);
      }
    }
    if (kind === 'table') {
      c.strokeStyle='rgba(183,179,148,.6)';c.lineWidth=4;
      c.strokeRect(48,48,w-96,h-96); c.beginPath();c.moveTo(48,h/2);c.lineTo(w-48,h/2);c.stroke();
      for (let row=0;row<2;row++) for (let col=0;col<4;col++) {
        const x=65+col*225,y=row ? 757 : 67;
        c.strokeStyle='rgba(156,158,131,.37)';c.lineWidth=2;c.strokeRect(x,y,210,190);
      }
      c.font='bold 38px monospace';c.fillStyle='rgba(195,187,154,.7)';c.textAlign='center';
      c.fillText('DEALER',w/2,329);c.fillText('YOU',w/2,716);
      c.save();c.translate(w/2,h/2+17);c.rotate(-.08);c.strokeStyle='rgba(186,181,146,.35)';c.lineWidth=3;
      c.beginPath();c.moveTo(-320,8);c.lineTo(-290,-8);c.lineTo(-87,-8);c.lineTo(-45,-26);c.lineTo(132,-26);c.lineTo(160,-4);c.lineTo(275,-6);c.lineTo(294,70);c.lineTo(244,73);c.lineTo(112,15);c.lineTo(-320,20);c.closePath();c.stroke();c.restore();
      c.font='12px monospace';c.fillStyle='#aaa287';c.textAlign='left';c.fillText('12 GA.  /  PROPERTY OF THE HOUSE',70,983);
      for(let i=0;i<1800;i++){c.fillStyle=`rgba(21,24,16,${r()*.6})`;c.fillRect(r()*w,r()*h,r()*12,r()*4);}
      for (let i=0;i<8;i++) {c.strokeStyle='rgba(46,24,15,.3)';c.lineWidth=4;c.beginPath();c.arc(r()*w,r()*h,30+r()*25,0,TAU);c.stroke();}
    }
  });
}

function mat(color, extra={}) { return new T.MeshStandardMaterial({ color, roughness:.85, metalness:.15, ...extra }); }
function box(parent, x,y,z, w,h,d, material, rotation=null) {
  const m = new T.Mesh(new T.BoxGeometry(w,h,d), material);m.position.set(x,y,z);if(rotation)m.rotation.set(...rotation);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;
}
function ellipsoid(parent,x,y,z,sx,sy,sz,material,segments=16) {
  const m=new T.Mesh(new T.SphereGeometry(1,segments,12),material);m.position.set(x,y,z);m.scale.set(sx,sy,sz);m.castShadow=true;parent.add(m);return m;
}
function cylinder(parent,x,y,z,r1,r2,length,material,rotation=[0,0,0],segments=12) {
  const m=new T.Mesh(new T.CylinderGeometry(r1,r2,length,segments),material);m.position.set(x,y,z);m.rotation.set(...rotation);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;
}
function pipe(parent,points,radius,material) {
  const curve=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p)));
  const m=new T.Mesh(new T.TubeGeometry(curve,32,radius,6,false),material);m.castShadow=true;parent.add(m);return m;
}
function torus(parent,x,y,z,r,t,material,rotation=[0,0,0]) {
  const m=new T.Mesh(new T.TorusGeometry(r,t,6,24),material);m.position.set(x,y,z);m.rotation.set(...rotation);parent.add(m);return m;
}
export class World {
  constructor(container, { onPick, onHover, settings }) {
    this.container=container;this.onPick=onPick;this.onHover=onHover;this.settings=settings;
    this.scene=new T.Scene();this.scene.background=new T.Color('#060806');this.scene.fog=new T.FogExp2('#080b08',.085);
    this.renderer=new T.WebGLRenderer({antialias:false,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(1);this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=T.PCFSoftShadowMap;
    this.renderer.outputColorSpace=T.SRGBColorSpace;this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.2;
    container.append(this.renderer.domElement);this.renderer.domElement.setAttribute('aria-label','恶魔轮盘——直面天命！3D 游戏场景');
    this.camera=new T.PerspectiveCamera(58,1,.08,45);
    this.camera.position.set(-.4,2.7,4.4);this.targetPosition=this.camera.position.clone();
    this.look=new T.Vector3(-.8,1.7,-.7);this.targetLook=this.look.clone();
    this.clock=new T.Clock();this.pointer=new T.Vector2(0,0);this.ray=new T.Raycaster();this.pickables=[];this.interactive=false;
    this.mode='menu';this.shake=0;this.recoil=0;this.hoverId=null;this.hoverObject=null;this.animating=false;this.sawed=false;this.pointerActive=false;this.animationToken=0;
    this.lookOffset=new T.Vector2();this.viewPreset=null;this.overview=false;this.paused=false;this.drag=null;
    this.materials={ steel:mat('#65655a',{metalness:.78,roughness:.48,map:grime()}), dark:mat('#181c19',{metalness:.7,roughness:.5}), black:mat('#030503'), wood:mat('#473325',{map:grime()}), ivory:mat('#b9b09a',{roughness:.82}), skin:mat('#8a8876',{map:grime('skin'),flatShading:true}), red:mat('#8c291c'), blue:mat('#657885'), brass:mat('#a39053',{metalness:.72,roughness:.44}) };
    this.room();this.bathroom();this.table();this.makeDealer();this.makeGun();this.itemGroup=new T.Group();this.scene.add(this.itemGroup);this.shellGroup=new T.Group();this.scene.add(this.shellGroup);
    this.particles();this.postprocessing();this.resize();
    this.boundResize=()=>this.resize();window.addEventListener('resize',this.boundResize);
    container.addEventListener('pointermove',e=>this.pointerMove(e));
    container.addEventListener('pointerleave',()=>{this.pointerActive=false;this.clearHover();});
    container.addEventListener('pointerdown',e=>{if(e.pointerType!=='mouse'){this.drag={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,moved:false};container.setPointerCapture(e.pointerId);}});
    container.addEventListener('pointerup',e=>{this.suppressClick=!!this.drag?.moved;this.drag=null;if(container.hasPointerCapture(e.pointerId))container.releasePointerCapture(e.pointerId);});
    container.addEventListener('click',e=>{if(this.suppressClick){this.suppressClick=false;return;}if(!this.interactive)return;const rect=container.getBoundingClientRect();this.ray.setFromCamera(new T.Vector2((e.clientX-rect.left)/rect.width*2-1,1-(e.clientY-rect.top)/rect.height*2),this.camera);const id=this.ray.intersectObjects(this.pickables,false)[0]?.object.userData.pick;if(id)this.onPick(id);});
    this.renderer.setAnimationLoop(()=>this.frame());
  }

  room() {
    const wall=mat('#999780',{map:grime('wall')});const floor=mat('#41443a',{map:grime()});
    box(this.scene,0,2,-4.6,13,7,.3,wall);
    box(this.scene,-5.1,2,0,.3,7,10,wall);box(this.scene,5.1,2,0,.3,7,10,wall);
    box(this.scene,0,-.85,0,13,.2,13,floor);box(this.scene,0,5.1,0,13,.2,13,this.materials.dark);
    for (let x=-4;x<5;x+=2.1) box(this.scene,x,2,-4.35,.16,6,.13,this.materials.dark);
    for(let i=0;i<4;i++) pipe(this.scene,[[-5,3.3+i*.15,-4.1],[2.6,3.3+i*.15,-4.1],[3.3,2.8+i*.15,-4.1],[3.4,-.7,-4.1]],.025,this.materials.steel);
    for(let i=0;i<3;i++) pipe(this.scene,[[-2.7+i*.32,5,-3.4],[-2.6+i*.3,3.1,-2.9],[-2.35+i*.25,2.55,-2.5],[-2.0+i*.1,1.3,-1.7]],.023,this.materials.black);
    for (const x of [-3.8,3.8]) {
      box(this.scene,x,.3,-3.8,1.0,2.3,.8,this.materials.black);
      for(const y of[-.15,.7]) {
        const disk=cylinder(this.scene,x,y,-3.36,.36,.36,.045,this.materials.dark,[Math.PI/2,0,0],28);
        torus(this.scene,x,y,-3.32,.29,.035,this.materials.black);
        ellipsoid(this.scene,x,y,-3.31,.15,.15,.045,this.materials.black);
      }
    }
    box(this.scene,2.5,1.1,-4.35,1.3,3.6,.15,this.materials.dark);
    box(this.scene,2.5,1.1,-4.24,1.1,3.35,.06,mat('#31382d',{map:grime()}));
    cylinder(this.scene,2.92,1,-4.12,.035,.035,.25,this.materials.brass,[0,0,Math.PI/2]);
    const exitTex=canvasTexture((c,w,h)=>{c.fillStyle='#102014';c.fillRect(0,0,w,h);c.fillStyle='#77a27c';c.font='bold 65px monospace';c.textAlign='center';c.fillText('EXIT →',w/2,83);},512,128);
    box(this.scene,2.5,3.25,-4.12,1.1,.28,.08,mat('#fff',{map:exitTex,emissiveMap:exitTex,emissive:'#6f9473',emissiveIntensity:.45}));
    this.scene.add(new T.HemisphereLight('#99a68a','#171911',1.05));
    const lampGroup=new T.Group();lampGroup.position.set(0,4.2,-.1);this.scene.add(lampGroup);
    cylinder(lampGroup,0,.6,0,.012,.012,1.2,this.materials.black);
    cylinder(lampGroup,0,.02,0,.24,.65,.3,this.materials.dark);
    cylinder(lampGroup,0,-.135,0,.46,.46,.02,mat('#fff2c9',{emissive:'#e5d9a4',emissiveIntensity:3}));
    this.key=new T.SpotLight('#eadbb1',85,15,Math.PI/3.15,.65,1.8);this.key.position.set(.3,4,-.2);this.key.target.position.set(0,.7,0);
    this.key.castShadow=true;this.key.shadow.mapSize.set(1024,1024);this.key.shadow.bias=-.001;this.key.shadow.normalBias=.03;
    this.scene.add(this.key,this.key.target);
    const faceLight=new T.PointLight('#b3b99a',5,5,2);faceLight.position.set(-.45,2.85,-.7);this.scene.add(faceLight);
    const wallLight=new T.PointLight('#a79c7a',21,10,2);wallLight.position.set(-.9,3.5,-3.35);this.scene.add(wallLight);
    const gunFill=new T.PointLight('#b4b8a1',10,6,2);gunFill.position.set(-1.5,2.4,2);this.scene.add(gunFill);
    const rim=new T.PointLight('#6e3724',12,8,2);rim.position.set(2.5,2.2,-3.3);this.scene.add(rim);
    this.redlight=new T.PointLight('#d8280f',2.8,3);this.redlight.position.set(-2,1.5,-1.3);this.scene.add(this.redlight);
    this.muzzleLight=new T.PointLight('#ffcd72',0,6);this.scene.add(this.muzzleLight);
    // Dust catches the overhead light; there is no opaque fake light cone.
  }

  bathroom() {
    const room=new T.Group();room.position.x=18;this.scene.add(room);
    const tile=canvasTexture((c,w,h)=>{
      c.fillStyle='#656f63';c.fillRect(0,0,w,h);const r=rng(788);
      for(let y=0;y<8;y++)for(let x=0;x<8;x++){
        c.fillStyle=`rgb(${120+r()*27},${127+r()*20},${113+r()*22})`;c.fillRect(x*128+4,y*128+4,120,120);
        for(let i=0;i<30;i++){c.fillStyle=`rgba(20,30,17,${r()*.17})`;c.fillRect(x*128+r()*128,y*128+r()*128,2+r()*22,2+r()*10);}
      }
      c.strokeStyle='#384330';c.lineWidth=3;c.beginPath();c.moveTo(205,0);c.lineTo(234,173);c.lineTo(300,259);c.lineTo(289,490);c.stroke();
    });
    const wall=mat('#bfc5b2',{map:tile,roughness:.9});
    box(room,0,1.5,-2.5,5,4.8,.2,wall);box(room,-2.5,1.5,0,.2,4.8,5,wall);box(room,2.5,1.5,0,.2,4.8,5,wall);
    box(room,0,-.65,0,5,.15,6,mat('#77786a',{map:grime('wall')}));box(room,0,3.9,0,5,.15,6,this.materials.dark);
    box(room,1.22,1.05,-2.32,1.4,3.3,.12,mat('#373e32',{map:grime()}));box(room,1.22,1.05,-2.22,1.19,3.13,.04,this.materials.dark);
    for(let i=0;i<8;i++)box(room,1.22,.5+i*.06,-2.18,.7,.024,.03,mat('#686b55'));
    cylinder(room,1.68,1,-2.11,.028,.028,.23,this.materials.brass,[0,0,Math.PI/2]);
    const doorHit=box(room,1.22,1.05,-2.07,1.4,3.3,.12,new T.MeshBasicMaterial({visible:false}));doorHit.userData.pick='door';this.pickables.push(doorHit);
    box(room,-1.10,2,-2.29,1.36,1.42,.12,this.materials.dark);
    const mirror=canvasTexture((c,w,h)=>{const grad=c.createLinearGradient(0,0,w,h);grad.addColorStop(0,'#293a32');grad.addColorStop(.5,'#596454');grad.addColorStop(1,'#1f2d23');c.fillStyle=grad;c.fillRect(0,0,w,h);c.strokeStyle='#101b16';c.lineWidth=3;c.beginPath();c.moveTo(45,0);c.lineTo(159,145);c.lineTo(190,315);c.lineTo(355,512);c.moveTo(159,145);c.lineTo(75,345);c.stroke();},512,512);
    box(room,-1.10,2,-2.21,1.24,1.3,.01,mat('#fff',{map:mirror,roughness:.3}));
    const porcelain=mat('#adb3a3',{roughness:.4});
    ellipsoid(room,-1.10,.75,-1.93,.65,.21,.42,porcelain,24);ellipsoid(room,-1.10,.85,-1.89,.50,.07,.31,mat('#414d3e'),24);
    pipe(room,[[-1.10,.55,-2],[-1.10,.22,-2],[-.89,.08,-2],[-.77,.32,-2],[-.77,.37,-2.4]],.062,this.materials.steel);
    pipe(room,[[-1.10,.80,-2.23],[-1.10,1.12,-2.23],[-1.10,1.13,-2.06],[-1.10,1.02,-2.02]],.028,this.materials.steel);
    for(const x of[-1.35,-.87])cylinder(room,x,.94,-2.17,.055,.055,.075,this.materials.steel);
    const pills=this.makeItem('medicine');pills.position.set(-.61,.93,-2.12);room.add(pills);
    box(room,-1.1,3.00,-2.15,1.3,.09,.12,mat('#dfe9ce',{emissive:'#adcda7',emissiveIntensity:1.8}));
    const light=new T.PointLight('#bed0ae',30,7,2);light.position.set(17,2.94,-1.7);this.scene.add(light);
    const red=new T.PointLight('#b33c22',6,5,2);red.position.set(19.3,2,-1.6);this.scene.add(red);
    const labelTex=canvasTexture((c,w,h)=>{c.fillStyle='#b4b08a';c.fillRect(0,0,w,h);c.fillStyle='#262c21';c.font='bold 50px monospace';c.textAlign='center';c.fillText('THE GAME',w/2,62);c.font='24px monospace';c.fillText('UPSTAIRS →',w/2,104);},512,128);
    box(room,1.2,2.35,-2.15,1.01,.28,.02,mat('#fff',{map:labelTex}));
  }

  table() {
    const topTex=grime('table');this.tableTop=box(this.scene,0,.72,.08,5.25,.17,3.9,this.materials.dark);
    const surface=new T.Mesh(new T.PlaneGeometry(5.17,3.82),mat('#fff',{map:topTex,roughness:.91,metalness:.13}));surface.rotation.x=-Math.PI/2;surface.position.set(0,.811,.08);surface.receiveShadow=true;this.scene.add(surface);
    for(const x of[-2.48,2.48]) for(const z of[-1.7,1.85]) {
      box(this.scene,x,-.0,z,.14,1.45,.14,this.materials.dark);
      cylinder(this.scene,x,.819,z,.034,.034,.012,this.materials.steel);
    }
    this.monitor=new T.Group();this.monitor.position.set(-1.88,1.22,-1.38);this.monitor.rotation.y=.12;this.scene.add(this.monitor);
    box(this.monitor,0,0,0,1.05,.67,.38,mat('#3c4034',{map:grime()}));
    box(this.monitor,0,.04,.207,.86,.44,.025,this.materials.black);
    this.screenCanvas=document.createElement('canvas');this.screenCanvas.width=512;this.screenCanvas.height=256;
    this.screenTex=new T.CanvasTexture(this.screenCanvas);this.screenTex.colorSpace=T.SRGBColorSpace;
    this.screen=new T.Mesh(new T.PlaneGeometry(.82,.40),new T.MeshBasicMaterial({map:this.screenTex}));this.screen.position.set(0,.04,.225);this.monitor.add(this.screen);
    for(let i=0;i<4;i++) box(this.monitor,-.33+i*.09,-.244,.209,.04,.035,.04,this.materials.steel);
    cylinder(this.monitor,.33,-.245,.218,.043,.043,.024,this.materials.red,[Math.PI/2,0,0]);
    this.updateMonitor({player:{hp:2,max:2},dealer:{hp:2,max:2},name:'YOU',round:1});
    this.cables=[];
    for(const x of[-.27,.27]) this.cables.push(pipe(this.scene,[[-1.88+x,1.6,-1.4],[-2.2+x,2.1,-1.9],[-2.1+x,3.4,-2.6],[-1.4+x,4.6,-2.7]],.026,this.materials.black));
    // Paper waiver and a stack of used shells live on the edge of the table.
    const paperTex=canvasTexture((c,w,h)=>{c.fillStyle='#9a967c';c.fillRect(0,0,w,h);c.fillStyle='#302e27';c.font='bold 32px monospace';c.fillText('GENERAL RELEASE',34,54);c.font='16px monospace';for(let i=0;i<12;i++)c.fillText(i%2?'THE HOUSE ACCEPTS NO LIABILITY.':'I ENTER THIS GAME OF MY OWN WILL.',34,95+i*23);c.font='italic 30px serif';c.fillText('the dealer',47,435);},512,512);
    const paper=new T.Mesh(new T.PlaneGeometry(.6,.56),mat('#aaa68f',{map:paperTex}));paper.rotation.set(-Math.PI/2,0,.11);paper.position.set(2.04,.827,-.48);this.scene.add(paper);
  }

  makeDealer() {
    const m=this.materials;this.dealer=new T.Group();this.dealer.position.set(0,2.22,-1.83);this.scene.add(this.dealer);
    const headGeo=new T.SphereGeometry(1,40,28);const pos=headGeo.attributes.position;const r=rng(455);
    for(let i=0;i<pos.count;i++) {
      let x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i);const f=1+(r()-.5)*.036;
      const px=x*.62*f*(y<-.2?1+(y+.2)*.18:1),py=y*.66*f;
      let pz=z*.47*f;
      const mouthRegion=(px/.47)**2+((py+.30)/.24)**2;
      if(z>0&&mouthRegion<1.22)pz-=.18*Math.min(1,(1.22-mouthRegion)*3);
      pos.setXYZ(i,px,py,pz);
    }
    headGeo.computeVertexNormals();this.head=new T.Mesh(headGeo,m.skin);this.head.castShadow=true;this.dealer.add(this.head);
    // The face is sculpted from low-poly volumes: sunken eyes, heavy brows and an exposed grin.
    for(const side of[-1,1]) {
      const socket=ellipsoid(this.dealer,side*.26,.1,.424,.207,.19,.061,m.black,20);socket.rotation.z=side*-.2;
      const brow=ellipsoid(this.dealer,side*.275,.25,.429,.235,.060,.087,m.skin);brow.rotation.z=side*.23;
      ellipsoid(this.dealer,side*.262,.085,.465,.091,.071,.028,mat('#111810'),12);
      ellipsoid(this.dealer,side*.245,.071,.485,.027,.018,.008,mat('#a6a98c',{emissive:'#828871',emissiveIntensity:.24}),8);
      const cheek=ellipsoid(this.dealer,side*.407,-.12,.383,.15,.20,.087,m.skin);cheek.rotation.z=side*.3;
      pipe(this.dealer,[[side*.34,.00,.469],[side*.405,-.08,.47],[side*.47,-.19,.4]],.014,m.dark);
      pipe(this.dealer,[[side*.17,.39,.42],[side*.27,.42,.4],[side*.39,.38,.37]],.008,m.dark);
    }
    ellipsoid(this.dealer,0,-.03,.469,.09,.19,.074,m.skin,8);
    for(const side of[-1,1])ellipsoid(this.dealer,side*.058,-.118,.514,.038,.025,.019,m.black,8);
    const mouth=ellipsoid(this.dealer,0,-.306,.41,.464,.209,.106,m.black,24);mouth.rotation.x=-.12;
    const lower=ellipsoid(this.dealer,0,-.487,.286,.363,.132,.116,m.skin,20);
    this.jaw=new T.Group();this.dealer.add(this.jaw);
    for(let i=0;i<11;i++) {
      const x=(i-5)*.07, edge=Math.abs(i-5)/5;
      const top=box(this.dealer,x,-.238+edge*.058,.503-edge*.13,.057+(r()-.5)*.012,.099-r()*.024,.06,m.ivory,[.10,(i-5)*.08,(r()-.5)*.23]);
      box(this.jaw,x,-.392+edge*.061,.477-edge*.10,.056,.086-r()*.025,.055,m.ivory,[-.13,(i-5)*.07,(r()-.5)*.18]);
    }
    for(const x of[-.455,.455])ellipsoid(this.dealer,x,-.229,.36,.047,.104,.07,m.skin);
    this.hands=[];
    for (const side of[-1,1]) {
      const hand=new T.Group();hand.position.set(side*1.05,.93,-1.1);hand.rotation.set(.08,side*-.19,side*.06);this.scene.add(hand);this.hands.push(hand);
      ellipsoid(hand,0,.06,0,.205,.087,.24,m.skin,12);
      for(let i=0;i<4;i++){
        const x=(i-1.5)*.10, length=.26+(i===1?.07:0)-(i===3?.055:0);
        pipe(hand,[[x,.07,.10],[x,.06,.25],[x+side*.023,.025,.25+length],[x+side*.03,.015,.29+length]],.045,m.skin);
        ellipsoid(hand,x+side*.023,.042,.23+length,.031,.014,.048,mat('#646051'),8);
      }
      pipe(hand,[[-side*.13,.04,.01],[-side*.27,.035,.13],[-side*.26,.02,.27]],.062,m.skin);
      const ring=torus(hand,side*.047,.04,.285,.055,.014,m.brass,[Math.PI/2,0,0]);
    }
    this.dealerHit=new T.Mesh(new T.SphereGeometry(.75,8,6),new T.MeshBasicMaterial({visible:false}));this.dealerHit.position.copy(this.dealer.position);this.dealerHit.userData.pick='dealer';this.scene.add(this.dealerHit);this.pickables.push(this.dealerHit);
    new T.TextureLoader().load('./assets/dealer-face.png',texture=>{
      texture.colorSpace=T.SRGBColorSpace;texture.minFilter=T.LinearFilter;texture.magFilter=T.LinearFilter;
      for(const child of this.dealer.children)child.visible=false;
      this.faceMaterial=new T.MeshBasicMaterial({map:texture,transparent:true,alphaTest:.05,color:'#989983',side:T.DoubleSide});
      this.face=new T.Mesh(new T.PlaneGeometry(1.83,1.64),this.faceMaterial);this.face.position.set(0,.04,.15);this.face.rotation.x=-.13;this.dealer.add(this.face);
    },undefined,error=>console.warn('Using procedural dealer fallback',error));
  }

  makeGun() {
    const m=this.materials;this.gun=new T.Group();this.scene.add(this.gun);
    this.gunRest=new T.Vector3(0,.96,.24);this.gun.position.copy(this.gunRest);this.gun.rotation.y=-.12;
    // Local X is the length of the shotgun; muzzle points towards negative X.
    box(this.gun,.17,0,0,.62,.17,.17,m.steel);
    this.barrel=cylinder(this.gun,-.78,.055,0,.044,.044,1.4,m.steel,[0,0,Math.PI/2],16);
    this.muzzle=torus(this.gun,-1.49,.055,0,.041,.009,m.steel,[0,Math.PI/2,0]);
    this.muzzleCap=cylinder(this.gun,-1.482,.055,0,.032,.032,.002,m.black,[0,0,Math.PI/2],16);
    this.magazine=cylinder(this.gun,-.51,-.03,0,.038,.038,.86,m.dark,[0,0,Math.PI/2]);
    this.pump=new T.Group();this.gun.add(this.pump);
    cylinder(this.pump,-.63,-.025,0,.076,.076,.42,m.wood,[0,0,Math.PI/2]);
    for(let i=0;i<9;i++)cylinder(this.pump,-.82+i*.047,-.025,0,.080,.08,.012,m.dark,[0,0,Math.PI/2]);
    const stockShape=new T.Shape();stockShape.moveTo(.4,.08);stockShape.lineTo(.70,.09);stockShape.lineTo(1.38,-.035);stockShape.lineTo(1.40,-.38);stockShape.lineTo(1.18,-.4);stockShape.lineTo(.65,-.07);stockShape.lineTo(.48,-.17);stockShape.closePath();
    const stock=new T.Mesh(new T.ExtrudeGeometry(stockShape,{depth:.16,bevelEnabled:true,bevelSegments:1,steps:1,bevelSize:.024,bevelThickness:.024}),m.wood);stock.position.z=-.08;stock.castShadow=true;this.gun.add(stock);
    box(this.gun,1.405,-.212,0,.06,.35,.20,m.black,[0,0,.02]);
    torus(this.gun,.33,-.13,0,.106,.016,m.dark);box(this.gun,.32,-.12,0,.02,.10,.017,m.steel,[0,0,-.5]);
    box(this.gun,.12,.012,.093,.23,.045,.018,m.black);this.frontSight=box(this.gun,-1.36,.113,0,.05,.038,.026,m.dark);
    for (const x of[.02,.23])cylinder(this.gun,x,.01,.104,.013,.013,.01,m.brass,[Math.PI/2,0,0],8);
    const hit=box(this.gun,0,0,0,3.2,.5,.52,new T.MeshBasicMaterial({visible:false}));hit.userData.pick='gun';this.pickables.push(hit);
    this.gunHomeQuaternion=this.gun.quaternion.clone();this.gunGoal=new T.Vector3().copy(this.gunRest);this.gunQuaternion=this.gun.quaternion.clone();
  }

  makeItem(id) {
    const g=new T.Group(),m=this.materials;
    switch(id) {
      case 'glass':
        torus(g,0,.04,-.045,.115,.019,m.steel,[Math.PI/2,0,0]);
        cylinder(g,0,.042,-.045,.098,.098,.008,mat('#98b9ad',{transparent:true,opacity:.27,metalness:.6,roughness:.05}));
        cylinder(g,0,.04,.145,.031,.032,.18,m.black,[Math.PI/2,0,0]);break;
      case 'beer': {
        cylinder(g,0,.17,0,.102,.1,.34,m.steel);
        cylinder(g,0,.17,0,.103,.103,.25,mat('#857957'));
        cylinder(g,0,.344,0,.094,.094,.009,m.steel);
        torus(g,0,.352,0,.024,.008,m.dark,[Math.PI/2,0,0]);
        const tex=canvasTexture((c,w,h)=>{c.fillStyle='#858063';c.fillRect(0,0,w,h);c.fillStyle='#292b22';c.font='bold 47px serif';c.textAlign='center';c.fillText('BEER',w/2,90);c.font='18px monospace';c.fillText('330 ML',w/2,123);},256,160);
        const label=new T.Mesh(new T.PlaneGeometry(.15,.13),mat('#fff',{map:tex}));label.position.set(0,.2,.104);g.add(label);break;
      }
      case 'cuffs':
        for(const x of[-.13,.13]){torus(g,x,.04,0,.095,.022,m.steel,[Math.PI/2,0,0]);box(g,x,.044,-.088,.1,.045,.04,m.steel);}
        for(let i=0;i<3;i++)torus(g,(i-1)*.034,.04,0,.025,.007,m.steel,[i%2?0:Math.PI/2,0,0]);break;
      case 'saw': {
        box(g,-.08,.05,0,.40,.017,.14,m.steel,[0,0,.07]);
        for(let i=0;i<13;i++) {
          const geo=new T.ConeGeometry(.021,.04,3);const tooth=new T.Mesh(geo,m.steel);tooth.rotation.x=Math.PI/2;tooth.position.set(-.26+i*.028,.035,.085);g.add(tooth);
        }
        const handle=torus(g,.19,.046,0,.089,.023,m.wood,[Math.PI/2,0,0]);handle.scale.set(1.1,.7,1);break;
      }
      case 'cigarettes': {
        box(g,0,.045,0,.20,.083,.27,mat('#b3aa88'));box(g,0,.09,-.063,.203,.009,.12,m.red);
        const t=canvasTexture((c,w,h)=>{c.fillStyle='#b9b397';c.fillRect(0,0,w,h);c.fillStyle='#782b21';c.fillRect(0,0,w,48);c.fillStyle='#323225';c.font='bold 30px serif';c.textAlign='center';c.fillText('REGULAR',w/2,92);c.font='18px serif';c.fillText('FILTER CIGARETTES',w/2,127);},256,176);
        const label=new T.Mesh(new T.PlaneGeometry(.19,.26),mat('#fff',{map:t}));label.rotation.x=-Math.PI/2;label.position.y=.091;g.add(label);
        cylinder(g,.13,.05,0,.013,.013,.23,m.ivory,[Math.PI/2,0,0]);cylinder(g,.13,.05,.08,.014,.014,.075,m.brass,[Math.PI/2,0,0]);break;
      }
      case 'phone':
        box(g,0,.04,0,.16,.075,.31,m.dark);box(g,0,.083,-.065,.12,.008,.1,mat('#647259',{emissive:'#4b684c',emissiveIntensity:.15}));
        for(let i=0;i<12;i++)box(g,(i%3-1)*.042,.082,.022+Math.floor(i/3)*.038,.027,.014,.022,m.steel);
        cylinder(g,-.06,.06,-.195,.012,.012,.11,m.black,[Math.PI/2,0,0]);break;
      case 'inverter':
        box(g,0,.07,0,.25,.14,.22,m.dark);box(g,0,.147,0,.20,.02,.17,m.steel);
        cylinder(g,-.055,.17,0,.036,.036,.03,m.red);cylinder(g,.055,.17,0,.036,.036,.03,m.blue);
        pipe(g,[[-.11,.09,-.1],[-.21,.09,-.16],[-.24,.06,.09],[-.11,.07,.14]],.015,m.black);break;
      case 'adrenaline':
        cylinder(g,0,.05,0,.035,.035,.23,mat('#a49f7f',{transparent:true,opacity:.8}),[Math.PI/2,0,0]);
        cylinder(g,0,.05,-.08,.024,.024,.13,mat('#998c27'),[Math.PI/2,0,0]);
        cylinder(g,0,.05,.19,.009,.009,.14,m.steel,[Math.PI/2,0,0]);box(g,0,.05,-.18,.11,.03,.025,m.steel);break;
      case 'medicine':
        cylinder(g,0,.10,0,.075,.075,.2,mat('#705739',{transparent:true,opacity:.85}));
        cylinder(g,0,.218,0,.083,.083,.035,m.ivory);box(g,0,.10,.072,.1,.11,.008,m.ivory);
        box(g,0,.11,.079,.065,.024,.002,m.red);box(g,0,.11,.080,.022,.065,.002,m.red);break;
    }
    return g;
  }

  syncItems(view) {
    const key=JSON.stringify([view.player.items,view.dealer.items]);if(this.itemKey===key)return;this.itemKey=key;
    this.pickables=this.pickables.filter(x=>!x.userData.pick?.startsWith('item:'));
    for(const child of [...this.itemGroup.children]) {this.itemGroup.remove(child);this.disposeGroup(child);}
    for(const who of ['player','dealer']) view[who].items.forEach((id,index)=>{
      const item=this.makeItem(id);const col=index%4,row=Math.floor(index/4);
      item.position.set(-1.66+col*1.1,.833,who==='player'?1.0+row*.47:-1.05+row*.47);item.rotation.y=(index%2?-.16:.12);
      item.userData.baseY=.833;item.userData.id=id;item.userData.pick=`item:${who}:${index}`;
      const hit=box(item,0,.14,0,.72,.4,.42,new T.MeshBasicMaterial({visible:false}));hit.userData.pick=item.userData.pick;
      this.pickables.push(hit);this.itemGroup.add(item);
    });
  }
  disposeGroup(group) {
    // Shared standard materials survive. Unique labels and their textures do not.
    group.traverse(o=>{if(o.isMesh){o.geometry.dispose();if(!Object.values(this.materials).includes(o.material)){o.material.map?.dispose();o.material.dispose();}}});
  }
  shell(live) {
    const g=new T.Group(),m=this.materials;
    cylinder(g,0,.042,0,.042,.042,.19,live?m.red:m.blue,[Math.PI/2,0,0]);
    cylinder(g,0,.042,.081,.044,.044,.035,m.brass,[Math.PI/2,0,0]);
    cylinder(g,0,.042,.102,.047,.047,.008,m.brass,[Math.PI/2,0,0]);return g;
  }
  showShells(live,blank) {
    this.hideShells();const list=[...Array(live).fill(true),...Array(blank).fill(false)];
    list.forEach((value,i)=>{const obj=this.shell(value);obj.position.set((i-(list.length-1)/2)*.20,.84,.68);this.shellGroup.add(obj);});
  }
  hideShells() {for(const child of [...this.shellGroup.children]){this.shellGroup.remove(child);this.disposeGroup(child);}}
  updateMonitor(view) {
    const c=this.screenCanvas.getContext('2d');c.fillStyle='#080704';c.fillRect(0,0,512,256);
    c.shadowColor='#fb3c0b';c.shadowBlur=9;c.fillStyle='#df461e';c.font='bold 34px monospace';
    c.fillText(view.mode==='versus'?'PLAYER 2':'DEALER',22,46);c.fillText(view.mode==='versus'?'PLAYER 1':String(view.name||'YOU').toUpperCase().slice(0,10),22,156);
    for(const [i,who]of ['dealer','player'].entries()){
      const p=view[who];
      for(let n=0;n<p.max;n++){
        const x=25+n*73,y=65+i*109;c.fillStyle=n<p.hp?'#f76023':'#33130b';c.shadowBlur=n<p.hp?12:0;
        if(view.round===3&&['story','versus'].includes(view.mode)&&n>=4){c.font='bold 44px monospace';c.fillText('×',x,y+35);}
        else {c.beginPath();c.moveTo(x+19,y);c.lineTo(x+6,y+25);c.lineTo(x+21,y+25);c.lineTo(x+11,y+47);c.lineTo(x+37,y+17);c.lineTo(x+21,y+17);c.closePath();c.fill();}
      }
      if(p.cut){c.font='bold 19px monospace';c.fillStyle='#f43b17';c.fillText('NO SIGNAL',310,i*110+43);}
    }
    c.shadowBlur=0;for(let y=0;y<256;y+=4){c.fillStyle='rgba(0,0,0,.2)';c.fillRect(0,y,512,1);}
    this.screenTex.needsUpdate=true;
    this.cables?.forEach((c,i)=>{c.visible=!view[i?'player':'dealer'].cut;});
  }
  sync(view) {if(!this.itemAnimation){this.syncItems(view);this.updateMonitor(view);this.setSaw(view.saw);}this.view=view;}
  setSaw(value) {
    this.sawed=!!value;
    const back=-.08,front=value?-.90:-1.48;
    this.barrel.scale.y=(back-front)/1.4;this.barrel.position.x=(front+back)/2;
    this.muzzle.position.x=front-.009;this.muzzleCap.position.x=front-.002;
    const tubeFront=value?-.85:-.94;
    this.magazine.scale.y=(back-tubeFront)/.86;this.magazine.position.x=(back+tubeFront)/2;
    this.frontSight.visible=!value;
  }
  useItem(event,onEffect) {return animateItem(this,event,onEffect);}

  particles() {
    const geo=new T.BufferGeometry(),r=rng(443),coords=[];for(let i=0;i<300;i++)coords.push((r()-.5)*9,r()*5,(r()-.5)*8);
    geo.setAttribute('position',new T.Float32BufferAttribute(coords,3));this.dust=new T.Points(geo,new T.PointsMaterial({color:'#b4ab80',size:.009,transparent:true,opacity:.27,depthWrite:false}));this.scene.add(this.dust);
  }
  postprocessing() {
    this.target=new T.WebGLRenderTarget(800,600,{minFilter:T.NearestFilter,magFilter:T.NearestFilter,depthBuffer:true});
    this.postScene=new T.Scene();this.postCamera=new T.OrthographicCamera(-1,1,1,-1,0,1);
    this.postMaterial=new T.ShaderMaterial({uniforms:{tDiffuse:{value:this.target.texture},time:{value:0},grain:{value:.08},brightness:{value:1},vignette:{value:.65}},vertexShader:`varying vec2 uv0; void main(){uv0=uv;gl_Position=vec4(position.xy,0.,1.);}`,fragmentShader:`
      precision highp float; varying vec2 uv0; uniform sampler2D tDiffuse; uniform float time;uniform float grain;uniform float brightness;uniform float vignette;
      float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
      void main(){vec2 uv=uv0;vec2 dir=uv-.5;float d=dot(dir,dir);vec2 offset=dir*.0015;vec3 c;
      c.r=texture2D(tDiffuse,uv+offset).r;c.g=texture2D(tDiffuse,uv).g;c.b=texture2D(tDiffuse,uv-offset).b;
      c=mix(vec3(dot(c,vec3(.3,.59,.11))),c,.78);c*=vec3(1.01,1.025,.91);c*=1.-d*vignette*1.85;
      c*=.98+.02*sin(uv.y*900.);c*=brightness;gl_FragColor=vec4(c,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      gl_FragColor.rgb+=(hash(uv+fract(time)*43.0)-.5)*grain;}
    `});
    this.postScene.add(new T.Mesh(new T.PlaneGeometry(2,2),this.postMaterial));
  }
  resize() {
    const w=this.container.clientWidth||innerWidth,h=this.container.clientHeight||innerHeight;
    this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.renderer.setSize(w,h);
    const scale=this.settings.quality==='high'?1:this.settings.quality==='low'?.5:.73;
    const ratio=Math.min(1,1600/w)*scale;this.target?.setSize(Math.max(1,Math.round(w*ratio)),Math.max(1,Math.round(h*ratio)));
    if(this.mode==='game')this.updateGameView();
  }
  updateGameView() {
    if(this.overview){const fit=Math.max(1,1.22/this.camera.aspect);this.targetPosition.set(0,.81+5.2*fit,.08+5.4*fit);this.targetLook.set(0,.81,.08);}
    else {this.targetPosition.set(0,3.55,4.8);this.targetLook.set(0,.94,-.05);}
  }
  setView(preset) {
    if(this.mode!=='game'||this.animating||this.paused)return;
    this.overview=preset==='table';this.viewPreset=preset==='left'?-1:preset==='right'?1:preset==='center'?0:null;
    this.updateGameView();
  }
  setMode(mode) {
    this.itemAnimation?.cancel();this.stolenItemPosition=null;this.paused=false;this.overview=false;this.viewPreset=null;this.pointer.set(0,0);this.lookOffset.set(0,0);
    this.mode=mode;this.interactive=false;this.animating=false;this.animationToken++;this.shake=0;this.recoil=0;this.pump.position.x=0;this.clearHover();
    this.hands.forEach((h,i)=>h.position.set(i?1.05:-1.05,.93,-1.1));
    if(mode==='menu'){this.targetPosition.set(-.6,2.6,4.4);this.targetLook.set(-1.05,1.6,-.6);}
    else if(mode==='intro'){this.targetPosition.set(18,1.7,2.05);this.targetLook.set(18,1.5,-2.2);this.camera.position.copy(this.targetPosition);this.look.copy(this.targetLook);this.interactive=true;}
    else {this.updateGameView();}
    this.releaseGun();
  }
  grabGun() {
    this.gunGoal.set(.24,1.33,2.15);this.gunQuaternion.setFromEuler(new T.Euler(0,-Math.PI/2,0));
  }
  releaseGun() {this.gunGoal.copy(this.gunRest);this.gunQuaternion.copy(this.gunHomeQuaternion);}
  async shot(who,target,live,speed=1) {
    const token=++this.animationToken;this.animating=true;this.interactive=false;
    if(who==='player'){
      this.gunGoal.set(target==='dealer'?.3:0,target==='dealer'?1.7:2.2,target==='dealer'?2:2.25);
      this.gunQuaternion.setFromEuler(new T.Euler(target==='player'?.50:-.05,target==='dealer'?-Math.PI/2:Math.PI/2,0));
    }else{
      this.gunGoal.set(0,1.85,-.65);this.gunQuaternion.setFromEuler(new T.Euler(target==='player'?-.23:.9,target==='player'?Math.PI/2:-Math.PI/2,0));
      this.hands.forEach((h,i)=>{h.position.set(i? .4:-.4,1.75,-.85);});
    }
    await this.delay(510/speed);
    if(token!==this.animationToken)return()=>{};
    return () => {
      if(live){this.shake=this.settings.motion ? .16 : 0;this.recoil=.22;this.muzzleLight.intensity=60;this.muzzleLight.position.copy(this.gun.position);if(target==='dealer')this.dealer.rotation.x=-.30;}
      else this.recoil=.03;
      this.animating=false;
    };
  }
  async settle(speed=1) {const token=this.animationToken;await this.delay(440/speed);if(token!==this.animationToken)return;this.pump.position.x=.14;await this.delay(160/speed);if(token!==this.animationToken)return;this.pump.position.x=0;this.releaseGun();this.hands.forEach((h,i)=>h.position.set(i?1.05:-1.05,.93,-1.1));}
  delay(ms) {return new Promise(resolve=>setTimeout(resolve,ms));}
  pointerMove(e) {
    if(this.drag){const dx=e.clientX-this.drag.x,dy=e.clientY-this.drag.y;this.drag.moved ||= Math.hypot(e.clientX-this.drag.startX,e.clientY-this.drag.startY)>8;if(this.drag.moved){this.overview=false;this.viewPreset=null;this.pointer.x=T.MathUtils.clamp(this.pointer.x-dx/180,-1,1);this.pointer.y=T.MathUtils.clamp(this.pointer.y+dy/220,-1,1);this.updateGameView();}this.drag.x=e.clientX;this.drag.y=e.clientY;return;}
    if(e.pointerType!=='mouse')return;
    const rect=this.container.getBoundingClientRect();this.pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);this.pointerActive=true;
    if(!this.overview)this.viewPreset=null;
  }
  clearHover(){if(this.hoverId){this.hoverId=null;this.onHover(null);}this.container.style.cursor='default';}
  frame() {
    const dt=Math.min(this.clock.getDelta(),.05),time=this.clock.elapsedTime;
    const smooth=1-Math.exp(-dt*5);this.camera.position.lerp(this.targetPosition,smooth);this.look.lerp(this.targetLook,smooth);
    const move=this.settings.motion?1:0;
    const targetOffset=this.mode==='game'&&!this.overview?new T.Vector2((this.viewPreset??this.pointer.x)*1.9,this.viewPreset===null?this.pointer.y*.9:0):new T.Vector2(this.pointer.x*.085*move,this.pointer.y*.043*move);
    if(this.mode==='game'&&(this.overview||this.animating))targetOffset.set(0,0);
    if(!this.paused)this.lookOffset.lerp(targetOffset,1-Math.exp(-dt*6));
    const look=this.look.clone();look.x+=this.lookOffset.x;look.y+=this.lookOffset.y+Math.sin(time*.8)*.006*move;
    this.camera.lookAt(look);if(this.shake>.001){this.camera.rotation.z+=(Math.random()-.5)*this.shake;this.camera.rotation.x+=(Math.random()-.5)*this.shake;this.shake*=.83;}
    this.gun.position.lerp(this.gunGoal,Math.min(1,dt*8));this.gun.quaternion.slerp(this.gunQuaternion,Math.min(1,dt*8));this.gun.position.z+=this.recoil;this.recoil*=.65;
    if(this.itemAnimation&&!this.paused)this.itemAnimation.tick(dt*this.settings.speed);
    this.dealer.position.y=2.22+Math.sin(time*1.1)*.019;this.dealer.rotation.z=Math.sin(time*.45)*.025;this.dealer.rotation.x*=.92;this.dealer.rotation.y=Math.sin(time*.25)*.04;
    this.jaw.position.y=Math.sin(time*.7)*.006;this.dust.rotation.y=time*.007;
    this.key.intensity=84+(Math.sin(time*13.5)*.35+(Math.sin(time*3.1)> .998?-6:0));this.muzzleLight.intensity*=.71;
    this.postMaterial.uniforms.time.value=time;this.postMaterial.uniforms.grain.value=this.settings.grain ? .067 : 0;this.postMaterial.uniforms.brightness.value=this.settings.brightness/100;
    if(this.interactive&&!this.animating&&this.pointerActive){
      this.ray.setFromCamera(this.pointer,this.camera);const hits=this.ray.intersectObjects(this.pickables,false);const id=hits[0]?.object.userData.pick||null;
      if(this.hoverId!==id){this.hoverId=id;this.onHover(id);}this.container.style.cursor=id?'pointer':'default';
    }else this.clearHover();
    this.itemGroup.children.forEach(o=>{o.position.y=T.MathUtils.lerp(o.position.y,o.userData.baseY+(o.userData.pick===this.hoverId ? .08 : 0),.2);});
    this.renderer.setRenderTarget(this.target);this.renderer.render(this.scene,this.camera);this.renderer.setRenderTarget(null);this.renderer.render(this.postScene,this.postCamera);
  }
}
