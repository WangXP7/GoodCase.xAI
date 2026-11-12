import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { bilingual, localizeStatic, localizeCanvas } from './bilingual.js';

const $ = s => document.querySelector(s);
localizeStatic();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const viewport = $('#viewport');
let renderer;
try { renderer = new THREE.WebGLRenderer({antialias:true, alpha:true, powerPreference:'high-performance'}); }
catch (e) { $('#loader').innerHTML='<div class="loader-mark">Duo.</div><p></p>';bilingual('#loader>p','This exhibit needs WebGL. Please enable hardware acceleration.');throw e; }
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
viewport.append(renderer.domElement);
renderer.domElement.setAttribute('aria-label','3D 设备：拖动旋转，滚动缩放，点选部件查看详情 / 3D device — drag to rotate, scroll to zoom, click a component to inspect');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32,innerWidth/innerHeight,.1,150);
const controls = new OrbitControls(camera,renderer.domElement);
controls.enableDamping = true; controls.dampingFactor=.065; controls.enablePan=false;
controls.minDistance=8; controls.maxDistance=43; controls.autoRotateSpeed=.45;
controls.maxPolarAngle=Math.PI*.89; controls.minPolarAngle=Math.PI*.11;
const root = new THREE.Group(); scene.add(root); root.rotation.z=-.075;
const left = new THREE.Group(), right = new THREE.Group();
left.position.set(-.045,0,.24); right.position.set(.045,0,.24); root.add(left,right);
const W=2.92,H=6.18,R=.39;
const parts = [
  {id:'shell',name:'Outer shell',material:'BEAD-BLASTED TITANIUM · CERAMIC GLASS',description:'A sculpted titanium enclosure wraps each half. Precisely radiused edges meet a ceramic glass back and an exterior cover display.',offset:-2.65},
  {id:'displays',name:'Dual displays',material:'TWO INDEPENDENT OLED PANELS',description:'Two edge-to-edge glass panels meet at a narrow central seam. A compact cover interface gives way to an expanded, two-screen workspace.',offset:3.0},
  {id:'hinge',name:'Hinge mechanism',material:'POLISHED STEEL · SYNCHRONIZED GEARS',description:'Interlocking barrels and a central spine guide a full 180° opening. The visible hinge line is the pivot shared by both display assemblies.',offset:0},
  {id:'battery',name:'Battery modules',material:'TWIN GRAPHITE-WRAPPED CELLS',description:'A balanced pair of cells distributes weight across the two halves. Flexible interconnects bridge the hinge inside the structural spine.',offset:-.72},
  {id:'camera',name:'Camera system',material:'OPTICAL GLASS · METAL SENSOR CARRIERS',description:'Two independently seated lens assemblies, a flash and a compact sensor board sit within a protective rear camera island.',offset:-3.45},
  {id:'logic',name:'Logic board',material:'MULTILAYER PCB · SHIELDED SILICON',description:'A compact logic board places the main processor, memory and signal shielding along the upper edge, leaving room for the battery below.',offset:.85},
  {id:'speakers',name:'Stereo speakers',material:'ACOUSTIC CHAMBERS · MICRO-PERFORATIONS',description:'Mirrored speaker enclosures sit along the lower edge. A series of machined apertures connects each acoustic chamber to the outside.',offset:1.85},
  {id:'taptic',name:'Taptic Engine',material:'LINEAR ACTUATOR · STEEL ENCLOSURE',description:'A suspended linear actuator provides a tactile response. Its isolated mounting keeps feedback crisp within the thin enclosure.',offset:2.32},
  {id:'magsafe',name:'MagSafe components',material:'COPPER INDUCTION COIL · MAGNET ARRAY',description:'A concentric copper coil and segmented magnet ring align charging accessories through the back glass. The coil sits beneath the battery layer.',offset:-1.62},
  {id:'frame',name:'Internal frame',material:'MACHINED ALUMINUM · TORX FASTENERS',description:'A pocketed midframe ties the enclosure to the hinge spine. Openings hold the battery, electronics and speakers in a defined, serviceable stack.',offset:.12}
];
const records=[]; const pickables=[]; const gears=[];
const titanium = new THREE.MeshStandardMaterial({color:0x9b9e9c,metalness:.94,roughness:.28});
const edgeMetal = new THREE.MeshStandardMaterial({color:0xd0d3d2,metalness:1,roughness:.17});
const darkMetal = new THREE.MeshStandardMaterial({color:0x333c43,metalness:.85,roughness:.35});
const glass = new THREE.MeshPhysicalMaterial({color:0x10171d,metalness:.15,roughness:.12,clearcoat:1,clearcoatRoughness:.1});
const graphite = new THREE.MeshStandardMaterial({color:0x1e2529,metalness:.35,roughness:.55});
const copper = new THREE.MeshStandardMaterial({color:0xc58b4c,metalness:.9,roughness:.3});
const boardMat = new THREE.MeshStandardMaterial({color:0x153e3c,metalness:.45,roughness:.45});
const chipMat = new THREE.MeshStandardMaterial({color:0x32353a,metalness:.7,roughness:.3});
const optical = new THREE.MeshPhysicalMaterial({color:0x152c48,metalness:.55,roughness:.08,clearcoat:1,iridescence:1,iridescenceIOR:1.5});
const white = new THREE.MeshStandardMaterial({color:0xe3e8df,roughness:.55});
const rubber = new THREE.MeshStandardMaterial({color:0x0b1115,roughness:.72});

// A small photographic studio, baked into a reflection environment.
const studio = new THREE.Scene(); studio.background=new THREE.Color(0xaab3b7);
function softbox(w,h,x,y,z,intensity){const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({color:new THREE.Color().setScalar(intensity),side:THREE.DoubleSide}));m.position.set(x,y,z);m.lookAt(0,0,0);studio.add(m);}
softbox(10,18,-8,4,5,4);softbox(4,20,8,4,-3,2.7);softbox(15,10,0,10,0,3);softbox(3,12,2,1,10,1.4);
const pmrem=new THREE.PMREMGenerator(renderer);
scene.environment=pmrem.fromScene(studio,.06).texture; pmrem.dispose();
scene.add(new THREE.HemisphereLight(0xeaf4ff,0x96958c,2));
function areaLight(color,power,x,y,z){const l=new THREE.DirectionalLight(color,power);l.position.set(x,y,z);scene.add(l);return l;}
areaLight(0xffffff,3.3,-5,9,8);areaLight(0xc9dcf1,1.9,7,3,-5);areaLight(0xfff6e4,1.2,3,2,9);

function roundedShape(w,h,r){
 const x=-w/2,y=-h/2,s=new THREE.Shape();
 s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);return s;
}
function body(w,h,d,r,mat,parent,x=0,y=0,z=0){
 const geo=new THREE.ExtrudeGeometry(roundedShape(w-.025,h-.025,Math.max(.025,r-.012)),{depth:Math.max(.005,d-.025),bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:.012,bevelThickness:.012,curveSegments:12});
 geo.translate(0,0,-(d-.025)/2); const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);parent.add(m);return m;
}
function box(w,h,d,mat,parent,x=0,y=0,z=0){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);parent.add(m);return m;}
function disc(radius,depth,mat,parent,x,y,z){const m=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,depth,48),mat);m.rotation.x=Math.PI/2;m.position.set(x,y,z);parent.add(m);return m;}
function ring(radius,tube,mat,parent,x,y,z){const m=new THREE.Mesh(new THREE.TorusGeometry(radius,tube,8,72),mat);m.position.set(x,y,z);parent.add(m);return m;}
function surface(w,h,r,map,parent,x,y,z,back=false){const g=new THREE.ShapeGeometry(roundedShape(w,h,r),24);const pos=g.attributes.position,uv=g.attributes.uv;for(let i=0;i<pos.count;i++)uv.setXY(i,(pos.getX(i)+w/2)/w,(pos.getY(i)+h/2)/h);const mat=new THREE.MeshBasicMaterial({map,toneMapped:false});const m=new THREE.Mesh(g,mat);m.position.set(x,y,z);if(back)m.rotation.y=Math.PI;parent.add(m);return m;}
function layer(id,parent,x=0,z=0){const g=new THREE.Group();g.position.set(x,0,z);g.userData.partId=id;parent.add(g);const rec={id,group:g,base:g.position.clone(),offset:parts.find(p=>p.id===id).offset};records.push(rec);return g;}
function labelTexture(text,small='',color='#c2c9c9') {const c=document.createElement('canvas');c.width=512;c.height=256;const ctx=c.getContext('2d');ctx.clearRect(0,0,512,256);ctx.textAlign='center';ctx.fillStyle=color;ctx.font='500 51px Arial';ctx.fillText(text,256,112);ctx.font='19px Arial';ctx.fillText(small,256,161);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;}
function decal(w,h,map,parent,x,y,z,back=false){const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map,transparent:true,depthWrite:false}));m.position.set(x,y,z);if(back)m.rotation.y=Math.PI;parent.add(m);return m;}
function screw(parent,x,y,z){disc(.041,.026,edgeMetal,parent,x,y,z);box(.047,.009,.003,darkMetal,parent,x,y,z+.016);box(.009,.047,.003,darkMetal,parent,x,y,z+.016);}

// The interface is drawn as a texture, so it remains part of the 3D object.
const screenCanvases={};
function roundRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r);}
function wallpaper(ctx,w,h,variant=0){
 let g=ctx.createLinearGradient(0,0,w,h);g.addColorStop(0,'#c5d2d8');g.addColorStop(.35,'#678599');g.addColorStop(.62,'#223e55');g.addColorStop(1,'#101d2d');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
 for(let i=7;i>=0;i--){ctx.save();ctx.translate(w*(.1+variant*.2),h*.52);ctx.rotate(-.6);ctx.scale(1,.92);let gr=ctx.createLinearGradient(-w,0,w,0);gr.addColorStop(0,'#d9e2e5');gr.addColorStop(.30,'#97b6c8');gr.addColorStop(.5,'#e7ebea');gr.addColorStop(.58,'#a2baca');gr.addColorStop(.73,'#435b72');gr.addColorStop(1,'#172e47');ctx.strokeStyle=gr;ctx.lineWidth=w*.13;ctx.beginPath();ctx.ellipse(w*.47,h*.1,w*(.9-i*.055),h*(.48-i*.025),0,0,Math.PI*2);ctx.stroke();ctx.restore();}
 let shade=ctx.createLinearGradient(0,0,0,h);shade.addColorStop(0,'#09243422');shade.addColorStop(.6,'#102c3f00');shade.addColorStop(1,'#051628bb');ctx.fillStyle=shade;ctx.fillRect(0,0,w,h);
}
function screenTexture(kind){
 const c=document.createElement('canvas');c.width=768;c.height=1600;const ctx=c.getContext('2d');localizeCanvas(ctx);wallpaper(ctx,768,1600,kind==='right'?.2:0);
 ctx.fillStyle='#fff';ctx.textAlign='left';ctx.font='500 27px Arial';ctx.fillText('9:41',54,65);ctx.textAlign='right';ctx.font='24px Arial';ctx.fillText('▮▮▮  ᯤ  ▰',713,65);
 if(kind==='cover'){
  ctx.textAlign='center';ctx.font='32px Arial';ctx.fillText('Tuesday, September 9',384,235);ctx.font='200 175px Arial';ctx.fillText('9:41',384,415);
  ctx.fillStyle='#eef8ff28';roundRect(ctx,62,1160,644,140,35);ctx.fill();ctx.fillStyle='#fff';ctx.textAlign='left';ctx.font='600 24px Arial';ctx.fillText('DUO',92,1207);ctx.font='25px Arial';ctx.fillText('A new dimension awaits.',92,1251);
  ctx.textAlign='center';ctx.font='23px Arial';ctx.fillText('Unfold to explore',384,1475);ctx.fillStyle='#ffffffbf';roundRect(ctx,270,1545,228,8,4);ctx.fill();
 }else if(kind==='left'){
  ctx.textAlign='left';ctx.font='30px Arial';ctx.fillText('Tuesday, September 9',52,194);ctx.font='200 108px Arial';ctx.fillText('Good morning.',45,315);
  ctx.fillStyle='#ecf3f354';roundRect(ctx,45,402,678,300,45);ctx.fill();ctx.fillStyle='#fff';ctx.font='34px Arial';ctx.fillText('Cupertino',79,462);ctx.font='200 100px Arial';ctx.fillText('22°',74,578);ctx.font='26px Arial';ctx.fillText('Clear skies',80,646);ctx.font='100px Arial';ctx.fillText('☀',535,574);
  const names=['Messages','Calendar','Photos','Camera','Maps','Clock','Notes','Settings'];const cols=['#65af6d','#f0f2f1','#dbc394','#898f99','#78adbb','#263443','#d5be76','#a8b0b6'];
  names.forEach((n,i)=>{const x=53+(i%4)*179,y=780+Math.floor(i/4)*208;ctx.fillStyle=cols[i];roundRect(ctx,x,y,123,123,28);ctx.fill();ctx.fillStyle=i===1?'#d66b63':'#fff';ctx.textAlign='center';ctx.font='53px Arial';ctx.fillText(['●','9','✿','◉','↗','◷','≡','⚙'][i],x+61,y+79);ctx.font='22px Arial';ctx.fillStyle='#f0f4f7';ctx.fillText(n,x+61,y+159);});
  ctx.fillStyle='#e1edf340';roundRect(ctx,44,1369,680,161,40);ctx.fill();['↗','◉','♫','◎'].forEach((a,i)=>{ctx.fillStyle=['#5d9e79','#6093b3','#b58b96','#94a8b1'][i];roundRect(ctx,78+i*171,1390,119,119,28);ctx.fill();ctx.fillStyle='#fff';ctx.textAlign='center';ctx.font='57px Arial';ctx.fillText(a,138+i*171,1470);});
 }else{
  ctx.fillStyle='#f2f4f0';ctx.fillRect(0,112,768,1488);ctx.fillStyle='#6a7a85';ctx.textAlign='left';ctx.font='25px Arial';ctx.fillText('WORKSPACE',51,177);ctx.font='55px Arial';ctx.fillStyle='#2f424e';ctx.fillText('Room to think.',48,286);ctx.font='25px Arial';ctx.fillStyle='#8c989e';ctx.fillText('A little more space for everything.',50,340);
  ctx.fillStyle='#d6e0e2';roundRect(ctx,45,405,678,495,32);ctx.fill();ctx.save();ctx.beginPath();ctx.roundRect(45,405,678,495,32);ctx.clip();let g=ctx.createLinearGradient(50,400,750,1000);g.addColorStop(0,'#bbc8cd');g.addColorStop(1,'#4f6b7e');ctx.fillStyle=g;ctx.fillRect(45,405,678,495);ctx.fillStyle='#dce4e4';ctx.beginPath();ctx.moveTo(45,780);ctx.lineTo(280,505);ctx.lineTo(490,780);ctx.lineTo(630,610);ctx.lineTo(740,830);ctx.lineTo(740,900);ctx.lineTo(45,900);ctx.fill();ctx.fillStyle='#8aa1ad';ctx.beginPath();ctx.moveTo(45,850);ctx.lineTo(250,680);ctx.lineTo(440,850);ctx.lineTo(625,730);ctx.lineTo(740,880);ctx.lineTo(740,900);ctx.lineTo(45,900);ctx.fill();ctx.restore();
  ctx.fillStyle='#fff';ctx.font='18px Arial';ctx.fillText('A QUIETER PERSPECTIVE',79,466);ctx.font='40px Arial';ctx.fillText('Somewhere, outside.',79,845);
  ctx.fillStyle='#e4e8e4';roundRect(ctx,45,940,678,215,30);ctx.fill();ctx.fillStyle='#4a626e';ctx.font='20px Arial';ctx.fillText('NOW PLAYING',79,986);ctx.font='33px Arial';ctx.fillText('Weightless',79,1040);ctx.fillStyle='#8a989e';ctx.font='22px Arial';ctx.fillText('Ambient sessions · 04:32',79,1082);ctx.fillStyle='#556c79';ctx.font='50px Arial';ctx.fillText('Ⅱ',623,1060);
  ctx.fillStyle='#fff';roundRect(ctx,45,1193,678,260,30);ctx.fill();ctx.fillStyle='#83949c';ctx.font='20px Arial';ctx.fillText('QUICK NOTE',79,1240);ctx.fillStyle='#425b69';ctx.font='29px Arial';ctx.fillText('Make room for possibility.',79,1302);ctx.strokeStyle='#dae1df';ctx.lineWidth=2;[1345,1395].forEach(y=>{ctx.beginPath();ctx.moveTo(80,y);ctx.lineTo(685,y);ctx.stroke();});
 }
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=Math.min(renderer.capabilities.getMaxAnisotropy(),8);screenCanvases[kind]=c;return t;
}
const textures={cover:screenTexture('cover'),left:screenTexture('left'),right:screenTexture('right')};
const screenMeshes=[]; const screenStandbys=[];

function makeHalf(parent,sign){
 const x=sign*(W/2+.055);
 // External casing: perimeter and rear glass form a single removable enclosure.
 const shell=layer('shell',parent,x,-.34);
 body(W,H,.22,R,titanium,shell);
 body(W-.09,H-.09,.025,R-.04,edgeMetal,shell,0,0,-.125);
 body(W-.17,H-.17,.026,R-.07,glass,shell,0,0,-.147);
 // Hairline inlays and discreet buttons remain attached to the housing.
 [-2.4,2.4].forEach(y=>box(.02,.045,.22,white,shell,sign*(W/2+.005),y,0));
 if(sign===-1){
  body(.045,.59,.11,.018,edgeMetal,shell,-W/2-.015,1.25,0);
  body(.045,.39,.11,.018,edgeMetal,shell,-W/2-.015,.48,0);
  body(.045,.23,.10,.018,edgeMetal,shell,-W/2-.015,2.12,0);
  const cover=surface(W-.24,H-.23,R-.1,textures.cover,shell,0,0,-.165,true);cover.userData.cover=true;
  body(.72,.15,.01,.07,rubber,shell,0,2.75,-.18);
 }else{
  body(.045,.76,.11,.018,edgeMetal,shell,W/2+.015,1.15,0);
  decal(1.5,.63,labelTexture('Duo','DESIGNED IN POSSIBILITY','#89969a'),shell,0,-.28,-.166,true);
 }
 for(let i=0;i<7;i++)disc(.027,.02,rubber,shell,-.46+i*.145,-H/2+.018,.02).rotation.x=0;
 box(.33,.025,.10,rubber,shell,0,-H/2-.006,.015);

 // The independent display stack; it carries its own black glass bezel.
 const displays=layer('displays',parent,x,-.13);
 body(W-.07,H-.07,.105,R-.04,darkMetal,displays);
 body(W-.13,H-.13,.045,R-.07,rubber,displays,0,0,.067);
 const scr=surface(W-.23,H-.23,R-.12,textures[sign===-1?'left':'right'],displays,0,0,.093);
 screenMeshes.push(scr);
 // The right inner panel first shows a single-panel interface, then cross-fades.
 if(sign===1){const standby=surface(W-.23,H-.23,R-.12,textures.cover,displays,0,0,.095);standby.material.transparent=true;standby.material.depthWrite=false;screenStandbys.push(standby);}
 body(.68,.135,.025,.06,rubber,displays,0,2.76,.11);
 disc(.038,.008,optical,displays,.25,2.76,.128);
 box(.7,.012,.009,edgeMetal,displays,0,-2.88,.112);

 const battery=layer('battery',parent,x,-.21);
 body(W-.45,3.42,.15,.15,graphite,battery,0,-.13,0);
 // Welded pouch seams, safety label and connector tail.
 body(W-.54,3.3,.01,.10,darkMetal,battery,0,-.13,.084);
 decal(1.65,.85,labelTexture('Li-ion','DUO  /  RECYCLE RESPONSIBLY','#9ba7aa'),battery,0,-.08,.095);
 decal(1.3,.3,labelTexture('↻  +  −','CELL '+(sign===-1?'01':'02'),'#78878b'),battery,0,-1.04,.096);
 box(.35,.32,.017,copper,battery,.74,1.65,.04);
 for(let i=0;i<5;i++)box(.022,.18,.008,edgeMetal,battery,.61+i*.052,1.67,.052);

 const magsafe=layer('magsafe',parent,x,-.31);
 disc(1.07,.026,graphite,magsafe,0,-.1,0);
 for(let j=0;j<9;j++)ring(.62+j*.044,.013,copper,magsafe,0,-.1,.03);
 for(let j=0;j<16;j++){const a=j/16*Math.PI*2;const m=box(.17,.29,.065,edgeMetal,magsafe,Math.cos(a)*.96,Math.sin(a)*.96-.1,.04);m.rotation.z=a-Math.PI/2;}
 body(.26,.46,.04,.04,edgeMetal,magsafe,0,-1.44,0);
 box(.09,.63,.025,copper,magsafe,.21,1.18,0);

 const frame=layer('frame',parent,x,-.13);
 const frameShape=roundedShape(W-.13,H-.13,R-.07);
 const hole=new THREE.Path();const hx=-(W-.42)/2,hy=-2.0,hw=W-.42,hh=4.48;
 hole.moveTo(hx,hy);hole.lineTo(hx,hy+hh);hole.lineTo(hx+hw,hy+hh);hole.lineTo(hx+hw,hy);hole.closePath();frameShape.holes.push(hole);
 const fg=new THREE.ExtrudeGeometry(frameShape,{depth:.1,bevelEnabled:true,bevelSize:.009,bevelThickness:.009,bevelSegments:2,steps:1,curveSegments:12});fg.translate(0,0,-.05);frame.add(new THREE.Mesh(fg,edgeMetal));
 box(W-.38,.055,.07,titanium,frame,0,1.56,.02);
 box(W-.38,.055,.07,titanium,frame,0,-1.98,.02);
 for(const xx of [-1.23,1.23])for(const yy of [-2.78,-1.93,1.61,2.78])screw(frame,xx,yy,.075);
 const gasket=ring(.15,.025,rubber,frame,sign*1.1,-2.52,.04);gasket.scale.y=.7;

 const logic=layer('logic',parent,x,-.17);
 body(W-.49,.79,.075,.08,boardMat,logic,0,2.18,0);
 body(.48,1.05,.065,.05,boardMat,logic,-sign*1.00,1.4,0);
 body(.72,.6,.075,.06,chipMat,logic,sign===-1?-.35:.36,2.2,.078);
 decal(.6,.32,labelTexture('D1','DUO SILICON','#c1c7c6'),logic,sign===-1?-.35:.36,2.2,.12);
 body(.63,.36,.07,.03,edgeMetal,logic,sign*.67,2.22,.065);
 for(let i=0;i<12;i++){box(.055,.10,.025,i%3?copper:white,logic,-1.03+i*.18,2.47,.062);box(.045,.06,.025,edgeMetal,logic,-1.04+i*.18,1.89,.062);}
 for(let i=0;i<6;i++)box(.1,.065,.03,chipMat,logic,-sign*1.01,1.17+i*.13,.055);
 const trace=new THREE.LineBasicMaterial({color:0xb6a161});
 for(let i=0;i<5;i++){const pts=[new THREE.Vector3(-.8+i*.09,1.9,.048),new THREE.Vector3(-.8+i*.09,2.02,.048),new THREE.Vector3(-.55+i*.09,2.10,.048)];logic.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),trace));}

 const speakers=layer('speakers',parent,x,-.17);
 body(1.10,.40,.17,.09,graphite,speakers,-.66,-2.57,0);
 body(.58,.39,.15,.07,graphite,speakers,.91,-2.57,0);
 for(let i=0;i<9;i++)box(.026,.19,.015,darkMetal,speakers,-1.08+i*.105,-2.57,.093);
 for(let i=0;i<4;i++)disc(.037,.012,rubber,speakers,.73+i*.11,-2.57,.089);
 screw(speakers,-1.18,-2.39,.095);screw(speakers,1.16,-2.39,.095);

 const taptic=layer('taptic',parent,x,-.17);
 body(1.37,.34,.15,.07,edgeMetal,taptic,0,-2.12,.015);
 body(1.18,.22,.01,.035,darkMetal,taptic,0,-2.12,.10);
 decal(1.01,.19,labelTexture('TAPTIC ENGINE','','#b7c3c8'),taptic,0,-2.12,.11);
 box(.24,.2,.025,copper,taptic,.82,-2.12,.03);
}
makeHalf(left,-1);makeHalf(right,1);

// Rear-facing optics sit in the right enclosure, on the same axes as their carrier.
const cam=layer('camera',right,W/2+.055,-.45);
body(1.26,1.61,.12,.24,titanium,cam,-.56,2.04,0);
body(1.14,1.49,.025,.20,darkMetal,cam,-.56,2.04,-.071);
[-.01,.74].forEach((dy,i)=>{
 const y=2.4-dy;
 disc(.275,.15,edgeMetal,cam,-.68,y,-.14);disc(.237,.155,rubber,cam,-.68,y,-.151);disc(.198,.017,optical,cam,-.68,y,-.239);
 ring(.133,.012,darkMetal,cam,-.68,y,-.249);disc(.09,.005,optical,cam,-.68,y,-.253);disc(.035,.007,new THREE.MeshBasicMaterial({color:0x6895ba}),cam,-.735,y+.07,-.26);
});
disc(.10,.018,white,cam,-.17,2.36,-.098);disc(.065,.02,optical,cam,-.17,1.85,-.099);
// Exploded camera carrier includes sensor mounts and a flexible copper connector.
box(.8,.32,.025,copper,cam,-.3,1.3,.045);box(.38,.24,.055,chipMat,cam,-.42,1.27,.08);

const hinge=layer('hinge',root,0,.24);
const shaft=new THREE.Mesh(new THREE.CylinderGeometry(.09,.09,5.84,32),darkMetal);hinge.add(shaft);
for(let i=0;i<14;i++){
 const barrel=new THREE.Mesh(new THREE.CylinderGeometry(.15,.15,.36,32),i%2?titanium:edgeMetal);barrel.position.y=-2.58+i*.397;hinge.add(barrel);gears.push(barrel);
 const collar=new THREE.Mesh(new THREE.TorusGeometry(.153,.016,6,32),darkMetal);collar.rotation.x=Math.PI/2;collar.position.y=-2.77+i*.397;hinge.add(collar);
}
for(const y of [-2.68,2.68]){
 for(const sign of [-1,1]){const armLayer=layer('hinge',sign===-1?left:right,0,-.12);box(.33,.25,.08,edgeMetal,armLayer,sign*.23,y,0);screw(armLayer,sign*.28,y,.055);}
 const gear=new THREE.Group();gear.position.set(0,y,0);hinge.add(gear);gears.push(gear);
 for(let i=0;i<12;i++){const a=i/12*Math.PI*2;const tooth=box(.052,.07,.052,copper,gear,Math.cos(a)*.18,0,Math.sin(a)*.18);tooth.rotation.y=-a;}
}
for(const y of [-1.25,1.25]){body(.45,.27,.018,.04,copper,hinge,0,y,.17);for(let i=0;i<7;i++)box(.017,.25,.008,darkMetal,hinge,-.15+i*.05,y,.184);}

// Aligned construction guides make the thickness stack legible.
const guides=[];
for(const parent of [left,right]){
 const sign=parent===left?-1:1;
 for(const y of [-2.63,2.63]){
  const pts=[new THREE.Vector3(sign*(W/2+.055),y,-3.1),new THREE.Vector3(sign*(W/2+.055),y,3.05)];
  const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineDashedMaterial({color:0x8a9eab,dashSize:.06,gapSize:.07,transparent:true,opacity:0}));line.computeLineDistances();parent.add(line);guides.push(line);
 }
}
// Batch static geometry per component/material, while keeping each part pickable.
// The moving hinge stays articulated rather than being baked into the enclosure.
for(const rec of records){
 if(rec.id==='hinge')continue;
 const batches=new Map();
 rec.group.children.filter(o=>o.isMesh&&!o.material.transparent).forEach(m=>{const key=m.material.uuid;if(!batches.has(key))batches.set(key,[]);batches.get(key).push(m);});
 for(const meshes of batches.values()){
  if(meshes.length<2)continue;
  const geometries=meshes.map(m=>{m.updateMatrix();let g=m.geometry.clone();if(g.index)g=g.toNonIndexed();g.applyMatrix4(m.matrix);return g;});
  const merged=new THREE.BufferGeometry();
  for(const key of ['position','normal','uv']){
   if(!geometries.every(g=>g.attributes[key]))continue;
   const itemSize=geometries[0].attributes[key].itemSize;
   const length=geometries.reduce((n,g)=>n+g.attributes[key].array.length,0);
   const array=new Float32Array(length);let at=0;
   geometries.forEach(g=>{array.set(g.attributes[key].array,at);at+=g.attributes[key].array.length;});
   merged.setAttribute(key,new THREE.BufferAttribute(array,itemSize));
  }
  const combined=new THREE.Mesh(merged,meshes[0].material);rec.group.add(combined);
  meshes.forEach(m=>{rec.group.remove(m);m.geometry.dispose();});geometries.forEach(g=>g.dispose());
 }
}
records.forEach(r=>r.group.traverse(o=>{if(o.isMesh){o.userData.partId=r.id;pickables.push(o);}}));

// A soft contact field, not a hard stage, keeps the object floating in the studio.
const shadowCanvas=document.createElement('canvas');shadowCanvas.width=256;shadowCanvas.height=256;
const sctx=shadowCanvas.getContext('2d'),sg=sctx.createRadialGradient(128,128,4,128,128,125);sg.addColorStop(0,'rgba(42,58,66,.22)');sg.addColorStop(.35,'rgba(42,58,66,.13)');sg.addColorStop(1,'rgba(42,58,66,0)');sctx.fillStyle=sg;sctx.fillRect(0,0,256,256);
const shadow=new THREE.Mesh(new THREE.PlaneGeometry(11,7),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(shadowCanvas),transparent:true,depthWrite:false,opacity:.8}));shadow.rotation.x=-Math.PI/2;shadow.position.set(0,-3.8,0);scene.add(shadow);

const state={open:0,targetOpen:0,explode:0,targetExplode:0,demonstrating:false,demoStart:0,selected:null,mode:'closed',finish:'natural',ready:false};
let selectedMaterials=[],lastTime=performance.now(),demoPhase='',animationScale=1;
const initialCamera=new THREE.Vector3();let cameraTween=null;
const navTarget=new THREE.Vector3();
function composition(){
 const mobile=innerWidth<=700;
 const aspect=innerWidth/innerHeight;
 const off=mobile?0:-(aspect>1.6?3.6:2.6);
 controls.target.set(off,mobile?.4:0,0);
 if(mobile){camera.position.set(7.2,3.4,26);controls.target.y=-.2;}
 else camera.position.set(8.2+off,4.0,16.2);
 if(state.targetExplode){camera.position.set(mobile?17:21.5+off,mobile?8:9.5,mobile?30:16.2);controls.target.z=.15;}
 initialCamera.copy(camera.position);controls.update();
}
composition();
function viewPreset(exploded=false){
 const mobile=innerWidth<=700;
 const offset=mobile?0:-(innerWidth/innerHeight>1.6?3.6:2.6);
 const destination=exploded?new THREE.Vector3(mobile?17:21.5+offset,mobile?8:9.5,mobile?30:16.2):new THREE.Vector3(mobile?7.2:8.2+offset,mobile?3.4:4,mobile?26:16.2);
 cameraTween={from:camera.position.clone(),to:destination,targetFrom:controls.target.clone(),targetTo:new THREE.Vector3(offset,mobile?-.2:0,exploded?.15:0),start:performance.now(),duration:reducedMotion?1:1400};
}
function toast(text){bilingual('#toast',text);$('#toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),3500);}
function updateUI(){
 const exploded=state.targetExplode>0;
 document.body.classList.toggle('exploded',exploded);
 document.body.classList.toggle('opened',state.targetOpen>.5);
 $('#anatomy').hidden=!exploded;
 $('#explode').classList.toggle('active',exploded);
 $('#reassemble').disabled=!exploded;
 $('#toggle-open').disabled=exploded;
 $('#fold').disabled=exploded||state.demonstrating;
 bilingual('#open-label',state.targetOpen>.5?'Close device':'Open device');
 $('#toggle-open').classList.toggle('active',state.targetOpen>.5&&!exploded);
 $('#demonstrate').classList.toggle('active',state.demonstrating);
 bilingual('#demo-label',state.demonstrating?'Stop demo':'Demonstrate');
 $('#demo-progress').hidden=!state.demonstrating;
 $('#view-index').textContent=exploded?'03 / 03':state.targetOpen>.5?'02 / 03':'01 / 03';
 bilingual('#view-label',exploded?'THE INNER ARCHITECTURE':state.targetOpen>.5?'A NEW DIMENSION':'THE COMPLETE OBJECT');
 bilingual('#caption-title',exploded?'Considered, down to the core.':state.targetOpen>.5?'Two screens. One possibility.':'Beautifully together.');
 bilingual('#caption-copy',exploded?'Select a component to discover its role.':state.targetOpen>.5?'An expanded canvas. A familiar experience.':'Precision, from every perspective.');
 bilingual('#status-text',state.demonstrating?'DEMONSTRATING':exploded?'ANATOMY MODE':'LIVE INTERACTIVE');
}
function stopDemo(){state.demonstrating=false;updateUI();}
function setOpen(n,fromSlider=false){stopDemo();state.targetOpen=n;state.mode=n>.5?'open':'closed';if(!fromSlider)clearSelection();updateUI();}
function explodeDevice(){stopDemo();state.targetOpen=1;state.targetExplode=1;state.mode='exploded';clearSelection();viewPreset(true);updateUI();toast('Click any component to explore its construction.');}
function reassemble(){stopDemo();state.targetExplode=0;state.targetOpen=1;state.mode='open';clearSelection();viewPreset(false);updateUI();}
function clearSelection(){selectedMaterials.forEach(({mesh,original,highlight})=>{mesh.material=original;highlight.dispose();});selectedMaterials=[];state.selected=null;$('#part-card').hidden=true;document.querySelectorAll('.part-button').forEach(b=>b.classList.remove('active'));}
function selectPart(id){
 clearSelection();const part=parts.find(p=>p.id===id);if(!part)return;
 state.selected=id;
 records.forEach(rec=>rec.group.traverse(mesh=>{
  if(!mesh.isMesh||!mesh.material)return;
  const original=mesh.material,highlight=original.clone();
  if(rec.id===id){
   if(highlight.emissive){highlight.emissive=new THREE.Color(0x458aab);highlight.emissiveIntensity=.35;}
   else {highlight.color=new THREE.Color(0x85c8e0);}
  }else if(state.targetExplode){highlight.transparent=true;highlight.opacity=.13;highlight.depthWrite=false;}
  mesh.material=highlight;selectedMaterials.push({mesh,original,highlight});
 }));
 const number=String(parts.indexOf(part)+1).padStart(2,'0');
 bilingual('#part-number','COMPONENT '+number+' / 10','部件 '+number+' / 10');
 bilingual('#part-name',part.name);bilingual('#part-description',part.description);bilingual('#part-material',part.material);$('#part-card').hidden=false;
 document.querySelector(`[data-part="${id}"]`)?.classList.add('active');
}
parts.forEach((p,i)=>{const b=document.createElement('button');b.className='part-button';b.dataset.part=p.id;b.innerHTML=`<span class="part-index">${String(i+1).padStart(2,'0')}</span><span class="part-label"></span><i>↗</i>`;bilingual(b.querySelector('.part-label'),p.name);b.addEventListener('click',()=>selectPart(p.id));$('#part-list').append(b);});
$('#toggle-open').addEventListener('click',()=>setOpen(state.targetOpen>.5?0:1));
$('#fold').addEventListener('input',e=>setOpen(Number(e.target.value)/180,true));
$('#explode').addEventListener('click',explodeDevice);
$('#reassemble').addEventListener('click',reassemble);
$('#clear-part').addEventListener('click',clearSelection);
$('#demonstrate').addEventListener('click',()=>{
 if(state.demonstrating){stopDemo();return;}
 clearSelection();state.targetExplode=0;state.demonstrating=true;state.demoStart=performance.now();state.targetOpen=0;demoPhase='';state.mode='demo';viewPreset(false);controls.autoRotate=false;$('#auto-rotate').setAttribute('aria-pressed','false');updateUI();
});
$('#reset-view').addEventListener('click',()=>{viewPreset(state.targetExplode>0);toast('View reset');});
$('#auto-rotate').addEventListener('click',()=>{controls.autoRotate=!controls.autoRotate;$('#auto-rotate').setAttribute('aria-pressed',String(controls.autoRotate));});
function zoom(factor){cameraTween=null;const d=camera.position.clone().sub(controls.target);d.multiplyScalar(factor);d.clampLength(controls.minDistance,controls.maxDistance);camera.position.copy(controls.target).add(d);controls.update();}
$('#zoom-in').addEventListener('click',()=>zoom(.86));$('#zoom-out').addEventListener('click',()=>zoom(1.16));
document.querySelectorAll('.swatch').forEach(b=>b.addEventListener('click',()=>{
 clearSelection();state.finish=b.dataset.finish;
 const values={natural:[0x9b9e9c,'Natural titanium'],dark:[0x454e57,'Black titanium'],blue:[0x738b9f,'Blue titanium']};
 titanium.color.setHex(values[state.finish][0]);bilingual('#finish-name',values[state.finish][1]);
 bilingual('#finish-family',values[state.finish][1]);
 document.querySelectorAll('.swatch').forEach(n=>{n.classList.toggle('selected',n===b);n.setAttribute('aria-pressed',String(n===b));});
}));
$('#about-btn').addEventListener('click',()=>$('#about').showModal());$('.dialog-close').addEventListener('click',()=>$('#about').close());$('.about-done').addEventListener('click',()=>$('#about').close());
$('#about').addEventListener('click',e=>{if(e.target===$('#about')){const b=$('#about').getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)$('#about').close();}});
addEventListener('keydown',e=>{if(e.key==='Escape')clearSelection();});
const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();let down=null;
renderer.domElement.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY,time:performance.now()};cameraTween=null;});
function hitAt(x,y){pointer.set(x/innerWidth*2-1,1-y/innerHeight*2);raycaster.setFromCamera(pointer,camera);return raycaster.intersectObjects(pickables,false)[0];}
renderer.domElement.addEventListener('pointerup',e=>{
 if(!down||Math.hypot(e.clientX-down.x,e.clientY-down.y)>7||performance.now()-down.time>700)return;
 const hit=hitAt(e.clientX,e.clientY);if(hit)selectPart(hit.object.userData.partId);else clearSelection();down=null;
});
renderer.domElement.addEventListener('pointermove',e=>{if(down&&e.buttons)return;renderer.domElement.style.cursor=hitAt(e.clientX,e.clientY)?'pointer':'grab';});
renderer.domElement.addEventListener('wheel',()=>{cameraTween=null;},{passive:true});
controls.addEventListener('start',()=>{cameraTween=null;});
function smoothstep(t){t=THREE.MathUtils.clamp(t,0,1);return t*t*(3-2*t);}
function demoAt(ms){
 const t=ms/1000; let phase;
 if(t<2){state.targetOpen=0;phase='01 / The complete object';}
 else if(t<6){state.targetOpen=smoothstep((t-2)/4);phase='02 / A precision hinge, in motion';}
 else if(t<10){state.targetOpen=1;phase='03 / An interface with room to unfold';}
 else if(t<14){state.targetOpen=1-smoothstep((t-10)/4);phase='04 / Everything, together again';}
 else if(t<16){state.targetOpen=0;phase='05 / A familiar feeling';}
 else {state.targetOpen=0;stopDemo();toast('Demonstration complete. The object is yours to explore.');return;}
 $('#demo-progress div').style.width=`${Math.min(100,t/16*100)}%`;
 if(phase!==demoPhase){demoPhase=phase;bilingual('#demo-phase',phase);updateUI();}
}
let renderedFrames=0;
function tick(now){
 requestAnimationFrame(tick);const dt=Math.min((now-lastTime)/1000,.5);lastTime=now;
 if(state.demonstrating)demoAt(now-state.demoStart);
 const speed=reducedMotion&&!state.demonstrating?1:1-Math.exp(-dt*4.0);
 state.open=THREE.MathUtils.lerp(state.open,state.targetOpen,speed);state.explode=THREE.MathUtils.lerp(state.explode,state.targetExplode,speed);
 if(Math.abs(state.open-state.targetOpen)<.0001)state.open=state.targetOpen;
 if(Math.abs(state.explode-state.targetExplode)<.0001)state.explode=state.targetExplode;
 // The book fold uses the very same pivot as the visible hinge spine.
 left.rotation.y=Math.PI*(1-state.open);
 root.position.x=-(W/2+.1)*(1-state.open);
 root.position.y=innerWidth<=700?-.52:.2+state.explode*.3;
 for(const rec of records){rec.group.position.copy(rec.base);rec.group.position.z+=rec.offset*state.explode;}
 gears.forEach((g,i)=>{g.rotation.y=(1-state.open)*Math.PI*(i%2?-.5:.5);});
 guides.forEach(g=>g.material.opacity=state.explode*.36);
 screenStandbys.forEach(s=>s.material.opacity=(state.selected&&state.targetExplode&&state.selected!=='displays'?.13:1)*(1-smoothstep((state.open-.18)/.48)));
 screenMeshes.forEach(s=>s.material.emissiveIntensity=.16+state.open*.18);
 shadow.scale.x=1+state.open*.4+state.explode*.15;shadow.material.opacity=.8-state.explode*.3;
 if(cameraTween){const t=smoothstep((now-cameraTween.start)/cameraTween.duration);camera.position.lerpVectors(cameraTween.from,cameraTween.to,t);controls.target.lerpVectors(cameraTween.targetFrom,cameraTween.targetTo,t);if(t===1)cameraTween=null;}
 controls.update();renderer.render(scene,camera);renderedFrames++;
 const deg=Math.round(state.open*180);$('#angle').textContent=deg+'°';
 if(document.activeElement!==$('#fold'))$('#fold').value=String(deg);
 if(!state.ready&&renderedFrames>3){state.ready=true;$('#loader').classList.add('gone');updateUI();}
}
requestAnimationFrame(tick);
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,2));composition();});
// A read-only inspection interface supports interaction verification.
window.exhibit={getState:()=>({open:state.open,targetOpen:state.targetOpen,explode:state.explode,targetExplode:state.targetExplode,selected:state.selected,demonstrating:state.demonstrating,finish:state.finish,ready:state.ready,frames:renderedFrames,camera:camera.position.toArray(),triangles:renderer.info.render.triangles,drawCalls:renderer.info.render.calls}),components:()=>parts.map(p=>({id:p.id,name:p.name,instances:records.filter(r=>r.id===p.id).length})),projectPart:id=>{scene.updateMatrixWorld(true);const rec=records.find(r=>r.id===id);if(!rec)return null;const v=new THREE.Box3().setFromObject(rec.group).getCenter(new THREE.Vector3()).project(camera);return{x:(v.x+1)/2*innerWidth,y:(1-v.y)/2*innerHeight};},layerPositions:()=>records.map(r=>({id:r.id,base:r.base.toArray(),actual:r.group.position.toArray(),offset:r.offset}))};
