import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RGBELoader} from 'three/addons/loaders/RGBELoader.js';
import {Sky} from 'three/addons/objects/Sky.js';
import {Water} from 'three/addons/objects/Water.js';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {GTAOPass} from 'three/addons/postprocessing/GTAOPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {SCALE,point,units,corridor,inside} from './plan.js';

const $=s=>document.querySelector(s), $$=s=>document.querySelectorAll(s);
const mobile=matchMedia('(pointer:coarse)').matches;
let seed=127;const rand=()=>{seed=(seed*16807)%2147483647;return(seed-1)/2147483646};
const scene=new T.Scene();scene.background=new T.Color('#d8e0d7');scene.fog=new T.FogExp2('#d0d9cb',mobile?.0013:.003);
const camera=new T.PerspectiveCamera(mobile?50:43,innerWidth/innerHeight,.08,800);
const renderer=new T.WebGLRenderer({antialias:true,powerPreference:'high-performance',preserveDrawingBuffer:true});
renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,mobile?1.4:1.65));
renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;
renderer.setClearColor('#dfe2d7');$('#viewport').appendChild(renderer.domElement);renderer.domElement.tabIndex=0;
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.065;controls.minDistance=3;controls.maxDistance=mobile?230:135;controls.maxPolarAngle=Math.PI*.485;controls.target.set(-1,0,0);
const hemi=new T.HemisphereLight('#d4e3f2','#6d7050',2.1);scene.add(hemi);
const sun=new T.DirectionalLight('#fff0d4',3.5);sun.position.set(-32,48,-25);sun.castShadow=true;sun.shadow.mapSize.set(mobile?2048:4096,mobile?2048:4096);Object.assign(sun.shadow.camera,{left:-49,right:49,top:49,bottom:-49,near:1,far:150});sun.shadow.bias=-.00015;sun.shadow.normalBias=.04;sun.shadow.radius=3;scene.add(sun);
const sky=new Sky();sky.scale.setScalar(450);scene.add(sky);const su=sky.material.uniforms;su.turbidity.value=5;su.rayleigh.value=1.6;su.mieCoefficient.value=.004;su.mieDirectionalG.value=.82;su.sunPosition.value.copy(sun.position);
const pmrem=new T.PMREMGenerator(renderer);pmrem.compileEquirectangularShader();
const fallbackEnv=pmrem.fromScene(sky,.04);scene.environment=fallbackEnv.texture;scene.environmentIntensity=.5;
new RGBELoader().load('./assets/venice_sunset_1k.hdr',hdr=>{const env=pmrem.fromEquirectangular(hdr);scene.environment=env.texture;hdr.dispose();fallbackEnv.dispose()},undefined,()=>console.info('Using built-in sky environment'));

const composer=new EffectComposer(renderer);composer.addPass(new RenderPass(scene,camera));
const ao=new GTAOPass(scene,camera,innerWidth,innerHeight);ao.updateGtaoMaterial({radius:.28,distanceExponent:1.5,thickness:.5,scale:.75});composer.addPass(ao);
const bloom=new UnrealBloomPass(new T.Vector2(innerWidth,innerHeight),.12,.4,1.25);composer.addPass(bloom);composer.addPass(new OutputPass());
let highQuality=true;ao.enabled=!mobile;

// All surface assets are generated locally. Texture scale follows real-world metres.
function texture(kind){const c=document.createElement('canvas');c.width=c.height=512;const ctx=c.getContext('2d');
 const colors={oak:'#ac875f',stone:'#c3bfad',wall:'#e8e3d5',rug:'#c0bca5',soil:'#6c7951',copper:'#7c715a',tile:'#b4b8ab',fabric:'#d4cbb7'};
 ctx.fillStyle=colors[kind]||'#ccc';ctx.fillRect(0,0,512,512);
 for(let i=0;i<26000;i++){const alpha=rand()*.11;ctx.fillStyle=rand()>.5?`rgba(255,255,235,${alpha})`:`rgba(35,30,20,${alpha})`;let x=rand()*512,y=rand()*512;ctx.fillRect(x,y,kind==='oak'?rand()*70+2:rand()*3+1,1)}
 if(kind==='oak'){for(let y=0;y<512;y+=64){ctx.fillStyle='#654b3933';ctx.fillRect(0,y,512,1.5);for(let x=(y%128===0?0:110);x<512;x+=230)ctx.fillRect(x,y,1,64);for(let j=0;j<24;j++){ctx.strokeStyle=`rgba(72,46,22,${rand()*.1})`;ctx.beginPath();const yy=y+rand()*64;ctx.moveTo(0,yy);ctx.bezierCurveTo(130,yy+rand()*8,320,yy-4,512,yy+3);ctx.stroke()}}}
 if(kind==='stone'||kind==='tile'){const d=kind==='stone'?128:64;ctx.strokeStyle='#676c5633';ctx.lineWidth=1;for(let p=0;p<=512;p+=d){ctx.beginPath();ctx.moveTo(p,0);ctx.lineTo(p,512);ctx.moveTo(0,p);ctx.lineTo(512,p);ctx.stroke()}}
 if(kind==='copper'){for(let p=0;p<512;p+=64){ctx.fillStyle='#424f412f';ctx.fillRect(p,0,3,512)}}
 if(kind==='rug'||kind==='fabric'){for(let i=0;i<512;i+=3){ctx.fillStyle='#fff1';ctx.fillRect(0,i,512,1);ctx.fillStyle='#3027190c';ctx.fillRect(i,0,1,512)}}
 const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(kind==='oak'?.55:.33,kind==='oak'?.55:.33);t.anisotropy=renderer.capabilities.getMaxAnisotropy();return t}
const tex={};for(const k of ['oak','stone','wall','rug','soil','copper','tile','fabric'])tex[k]=texture(k);
const mat=(color,roughness=.65,other={})=>new T.MeshStandardMaterial({color,roughness,...other});
const M={wall:mat('#f1eddf',.88,{map:tex.wall,bumpMap:tex.wall,bumpScale:.025}),oak:mat('#edcfab',.6,{map:tex.oak,bumpMap:tex.oak,bumpScale:.025}),stone:mat('#e1e0ce',.84,{map:tex.stone,bumpMap:tex.stone,bumpScale:.025}),foundation:mat('#b7b4a5'),brass:mat('#a28c5d',.32,{metalness:.75}),dark:mat('#293c36',.43,{metalness:.4}),wood:mat('#81633f',.55,{map:tex.oak}),walnut:mat('#5c422d',.48,{map:tex.oak}),cloth:mat('#e8dcc7',.92,{map:tex.fabric,bumpMap:tex.fabric,bumpScale:.04}),green:mat('#5e7160',.95,{map:tex.fabric}),rust:mat('#a9603d',.85,{map:tex.fabric}),pillow:mat('#eee9da',.95,{map:tex.fabric}),rug:mat('#e2d9be',1,{map:tex.rug,bumpMap:tex.rug,bumpScale:.03}),black:mat('#172725',.4),screen:mat('#283e3d',.23,{metalness:.35}),porcelain:mat('#f6f4e6',.22),leaf:mat('#526b3d',.9),soil:mat('#7d855d',1,{map:tex.soil}),roof:mat('#a5a58d',.58,{map:tex.copper,metalness:.4}),roofRim:mat('#58675b',.42,{metalness:.55}),glass:new T.MeshPhysicalMaterial({color:'#b4d3cd',metalness:.1,roughness:.08,transparent:true,opacity:.23,depthWrite:false,side:T.DoubleSide}),glow:mat('#fff0ca',.3,{emissive:'#ffd894',emissiveIntensity:2}),waterEdge:mat('#8c9c8b',.5),path:mat('#d4ceb5',.9,{map:tex.stone}),trunk:mat('#63533c',1)};
const loader=new T.TextureLoader();
function surface(file,repeat,colorSpace=true){const t=loader.load('./assets/'+file);t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(...repeat);t.anisotropy=renderer.capabilities.getMaxAnisotropy();if(colorSpace)t.colorSpace=T.SRGBColorSpace;return t}
M.oak.map=surface('hardwood2_diffuse.jpg',[.35,.7]);M.oak.color.set('#dfd3bb');M.oak.roughnessMap=surface('hardwood2_roughness.jpg',[.35,.7],false);M.oak.bumpMap=surface('hardwood2_bump.jpg',[.35,.7],false);M.oak.bumpScale=.018;
M.soil.map=surface('grasslight-big.jpg',[.08,.08]);M.soil.color.set('#b6b994');
const building=new T.Group(),roofs=new T.Group(),upperWalls=new T.Group(),lowerWalls=new T.Group(),furniture=new T.Group(),landscape=new T.Group();scene.add(building,landscape);building.add(lowerWalls,upperWalls,roofs,furniture);
const batch=new Map();const boxes=new T.BoxGeometry(1,1,1),cylinder=new T.CylinderGeometry(1,1,1,16),sphere=new T.SphereGeometry(1,12,8);const tmp=new T.Object3D();
function add(geo,material,pos=[0,0,0],scale=[1,1,1],rotation=0,parent=furniture,batching=true){
 tmp.position.set(...pos);tmp.rotation.set(0,rotation,0);tmp.scale.set(...scale);tmp.updateMatrix();
 if(batching){const key=parent.uuid+material.uuid;let b=batch.get(key);if(!b){b={parent,material,geos:[]};batch.set(key,b)}const g=geo.index?geo.toNonIndexed():geo.clone();g.applyMatrix4(tmp.matrix);b.geos.push(g);return null}
 const mesh=new T.Mesh(geo,material);mesh.position.set(...pos);mesh.rotation.y=rotation;mesh.scale.set(...scale);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh
}
function box(x,y,z,w,h,d,m=M.wall,r=0,parent=furniture){return add(boxes,m,[x,y,z],[w,h,d],r,parent)}
function round(x,y,z,w,h,d,m=M.cloth,r=0,parent=furniture,radius=.08){return add(new RoundedBoxGeometry(1,1,1,3,.12),m,[x,y,z],[w,h,d],r,parent)}
function cyl(x,y,z,r,h,m=M.wood,parent=furniture){return add(cylinder,m,[x,y,z],[r,h,r],0,parent)}
function ball(x,y,z,a,b,c,m=M.leaf,parent=furniture){return add(sphere,m,[x,y,z],[a,b,c],rand()*6,parent)}
function polyMesh(poly,y,depth,material,parent=furniture){const shape=new T.Shape();poly.forEach((v,i)=>{const p=point(v);i?shape.lineTo(...p):shape.moveTo(...p)});shape.closePath();const g=new T.ExtrudeGeometry(shape,{depth,bevelEnabled:false});g.rotateX(Math.PI/2);g.translate(0,y+depth,0);return add(g,material,[0,0,0],[1,1,1],0,parent)}
const obstacles=[],wallColliders=[],doors=[],switches=[],roomLights=[],lights=[];
function segment(a,b,y,h,d,m,parent,collide=false){const dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);box((a[0]+b[0])/2,y+h/2,(a[1]+b[1])/2,len,h,d,m,-Math.atan2(dz,dx),parent);if(collide)wallColliders.push({a,b,d})}
function wall(a,b,{glazed=false,collide=true}={}){const y=.32;
 if(glazed){segment(a,b,y,.18,.22,M.wall,lowerWalls,collide);segment(a,b,y+.18,2.65,.055,M.glass,upperWalls);segment(a,b,3.06,.16,.22,M.wall,upperWalls);const length=Math.hypot(b[0]-a[0],b[1]-a[1]);const n=Math.ceil(length/1.2);for(let i=0;i<=n;i++){let t=i/n;box(T.MathUtils.lerp(a[0],b[0],t),1.76,T.MathUtils.lerp(a[1],b[1],t),.045,2.78,.065,M.dark,0,upperWalls)}}
 else{segment(a,b,y,1.02,.19,M.wall,lowerWalls,collide);segment(a,b,1.34,1.88,.19,M.wall,upperWalls)}
 segment(a,b,.32,.065,.205,M.walnut,lowerWalls);
}
function door(a,b,unit){const dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz),r=-Math.atan2(dz,dx),pivot=new T.Group();pivot.position.set(a[0],.32,a[1]);pivot.rotation.y=r;building.add(pivot);
 const slab=add(boxes,M.wood,[len/2,1.12,0],[len-.04,2.24,.065],0,pivot,false);add(boxes,M.brass,[len-.15,1.05,.07],[.19,.035,.05],0,pivot,false);for(const q of [a,b])box(q[0],1.51,q[1],.09,2.4,.09,M.dark,0,upperWalls);segment(a,b,2.69,.1,.12,M.dark,upperWalls);
 doors.push({pivot,slab,a,b,r,angle:0,target:0,name:unit.name,open:false});
}
function wallWithDoor(pa,pb,entry,unit){const a=point(pa),b=point(pb),e1=point(entry[0]),e2=point(entry[1]);const dx=b[0]-a[0],dz=b[1]-a[1],l2=dx*dx+dz*dz;
 const t1=((e1[0]-a[0])*dx+(e1[1]-a[1])*dz)/l2,t2=((e2[0]-a[0])*dx+(e2[1]-a[1])*dz)/l2;
 if(t1>=-.05&&t1<=1.05&&t2>=-.05&&t2<=1.05&&Math.abs((e1[0]-a[0])*dz-(e1[1]-a[1])*dx)/Math.sqrt(l2)<.15){const lo=Math.min(t1,t2),hi=Math.max(t1,t2);const p=[a[0]+dx*lo,a[1]+dz*lo],q=[a[0]+dx*hi,a[1]+dz*hi];if(lo>.01)wall(a,p);if(hi<.99)wall(q,b);door(p,q,unit);return true}return false}

for(const [i,u] of units.entries()){
 polyMesh(u.poly,.1,.22,M.foundation,lowerWalls);polyMesh(u.poly,.32,.035,M.oak,lowerWalls);
 // Copper roof follows the actual irregular apartment outline, not a rectangular proxy.
 polyMesh(u.poly,3.22,.18,M.roof,roofs);
 const e1=point(u.entry[0]),e2=point(u.entry[1]),e=[(e1[0]+e2[0])/2,(e1[1]+e2[1])/2];let edge=null;
 for(let j=0;j<u.poly.length;j++){const a=point(u.poly[j]),b=point(u.poly[(j+1)%u.poly.length]),len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len<1.1)continue;const d=distSegment(e[0],e[1],a,b);if(!edge||d<edge.d)edge={j,a,b,len,d}}
 for(let j=0;j<u.poly.length;j++){const pa=u.poly[j],pb=u.poly[(j+1)%u.poly.length],a=point(pa),b=point(pb);if(j===edge.j){const dx=(b[0]-a[0])/edge.len,dz=(b[1]-a[1])/edge.len,mid=T.MathUtils.clamp((e[0]-a[0])*dx+(e[1]-a[1])*dz,.55,edge.len-.55),p=[a[0]+dx*(mid-.51),a[1]+dz*(mid-.51)],q=[a[0]+dx*(mid+.51),a[1]+dz*(mid+.51)];wall(a,p);wall(q,b);door(p,q,u)}else{const mid=[(pa[0]+pb[0])/2,(pa[1]+pb[1])/2];const outside=(mid[1]<112||mid[1]>505||mid[0]<115||mid[0]>665);wall(a,b,{glazed:outside||((j===0||j===1)&&u.kind==='side')})}segment(a,b,3.4,.065,.16,M.roofRim,roofs)}
 furnishApartment(u,i);
}
polyMesh(corridor,.1,.22,M.foundation,lowerWalls);polyMesh(corridor,.32,.04,M.stone,lowerWalls);

// Furniture is modelled at human scale. Local frames turn the rooms with each residential wing.
function furnishApartment(u,index){const c=point(u.center),r=u.angle;const side=u.kind==='side';
 const P=(x,z,y=.36)=>{if(side)z*=.7;return[c[0]+Math.cos(r)*x+Math.sin(r)*z,y,c[1]-Math.sin(r)*x+Math.cos(r)*z]};
 const B=(x,y,z,w,h,d,m,rr=0)=>{const p=P(x,z,y);if(!inside(p[0],p[2],u.poly))return;if(y+h/2>.5&&y-h/2<1.5&&w>.5&&d>.35)obstacles.push({x:p[0],z:p[2],w:w+.32,d:d+.32,r:r+rr});if(h>1.5&&m===M.wood){const base=y-h/2,cut=1.34;box(p[0],(base+cut)/2,p[2],w,cut-base,d,m,r+rr);box(p[0],(cut+y+h/2)/2,p[2],w,y+h/2-cut,d,m,r+rr,upperWalls)}else box(p[0],p[1],p[2],w,h,d,m,r+rr)};
 const R=(x,y,z,w,h,d,m,rr=0,rad=.08)=>{const p=P(x,z,y);if(!inside(p[0],p[2],u.poly))return;if(y+h/2>.5&&y-h/2<1.5&&w>.5&&d>.35)obstacles.push({x:p[0],z:p[2],w:w+.32,d:d+.32,r:r+rr});round(p[0],p[1],p[2],w,h,d,m,r+rr,furniture,rad)};
 const C=(x,y,z,ra,h,m)=>{const p=P(x,z,y);if(!inside(p[0],p[2],u.poly))return;if(ra>.3&&y>.5&&y<1.5)obstacles.push({x:p[0],z:p[2],w:ra*2+.32,d:ra*2+.32,r:0});cyl(...p,ra,h,m)};
 const W=(x1,z1,x2,z2)=>{const a=P(x1,z1),b=P(x2,z2),n=Math.ceil(Math.hypot(b[0]-a[0],b[2]-a[2])/.07);let start=null;for(let i=0;i<=n;i++){const t=i/n,x=T.MathUtils.lerp(a[0],b[0],t),z=T.MathUtils.lerp(a[2],b[2],t),valid=inside(x,z,u.poly);if(valid&&start===null)start=[x,z];if(start&&(!valid||i===n)){if(Math.hypot(x-start[0],z-start[1])>.1)wall(start,[x,z]);start=null}}};
 function plant(x,z,size=1){const p=P(x,z);if(!inside(p[0],p[2],u.poly))return;pot(p[0],p[2],size)}
 function bed(x,z,w=1.6){B(x,.52,z,w+.1,.32,2.18,M.walnut);R(x,.79,z,w,.26,2.1,M.pillow);R(x,.96,z+.25,w+.03,.14,1.6,M.cloth);R(x,1.01,z+.76,w+.035,.05,.48,index%2?M.green:M.rust);R(x,1.02,z-.67,w*.42,.13,.45,M.pillow,-.04);R(x+w*.26,1.02,z-.69,w*.42,.14,.45,M.pillow,.06);R(x,.98,z-1.1,w+.18,1.25,.12,M.green);for(const s of [-1,1]){B(x+s*(w/2+.36),.61,z-.72,.48,.46,.52,M.wood);C(x+s*(w/2+.36),.89,z-.72,.09,.05,M.brass);C(x+s*(w/2+.36),1.05,z-.72,.025,.3,M.brass);C(x+s*(w/2+.36),1.24,z-.72,.17,.22,M.cloth)}B(x,.37,z+.6,w+1.1,.025,2.4,M.rug)}
 function sofa(x,z){R(x,.57,z,2.5,.3,.94,M.green);R(x,.85,z+.34,2.55,.75,.22,M.green);for(const s of [-1,1])R(x+s*1.22,.76,z,.17,.55,1.05,M.green);for(let j=-1;j<=1;j++)R(x+j*.76,.79,z-.08,.72,.18,.77,M.green);R(x-.75,1,z+.14,.38,.38,.16,M.cloth,.12);R(x+.76,.99,z+.15,.38,.38,.16,M.rust,-.15);for(const dx of [-1,1])for(const dz of [-.3,.3])B(x+dx,.43,z+dz,.05,.15,.05,M.brass)}
 const compact=side;const bw=compact?1.35:1.55;
 if(!side){bed(-2.65,-3,bw);bed(2.65,-3,bw);W(-1.25,-5.1,-1.25,-1.3);W(1.25,-5.1,1.25,-1.3);W(-4.5,-1.25,-3.8,-1.25);W(-2.8,-1.25,-1.25,-1.25);W(1.25,-1.25,2.6,-1.25);W(3.65,-1.25,4.5,-1.25);B(-4.1,1.45,-3.25,.65,2.15,2.4,M.wood);B(4.1,1.45,-3.25,.65,2.15,2.4,M.wood)}
 else{bed(-3.2,0,1.55);W(-1.7,-3.4,-1.7,-1);W(-1.7,.1,-1.7,3.8);B(-4.8,1.5,2.5,.62,2.2,1.5,M.wood)}
 const lx=side?1.05:0,lz=side?.35:2.3;
 B(lx,.38,lz-.3,3.35,.025,3.2,M.rug);sofa(lx,lz+.5);
 R(lx-.12,.68,lz-.82,1.3,.1,.68,M.wood,0,.15);B(lx-.12,.5,lz-.82,.68,.3,.34,M.dark);
 B(lx-.3,.75,lz-.8,.32,.04,.23,M.rust,.15);B(lx-.26,.78,lz-.79,.3,.025,.22,M.pillow,.09);C(lx+.26,.79,lz-.82,.12,.13,M.porcelain);
 // TV panel, floating cabinet and small objects.
 B(lx,1.13,lz-2.2,2.35,1.5,.11,M.walnut);B(lx,1.4,lz-2.11,1.52,.85,.06,M.black);B(lx,1.41,lz-2.072,1.42,.76,.012,M.screen);R(lx,.62,lz-2.05,2.45,.25,.4,M.wood);C(lx+.82,.9,lz-2.02,.11,.25,M.porcelain);
 const kx=side?-.6:-3.1,kz=side?-3.35:.15;
 B(kx,.79,kz,2.5,.85,.64,M.green);B(kx,1.24,kz,2.6,.075,.71,M.porcelain);B(kx,1.82,kz+.27,2.6,1.1,.06,M.tile||M.stone);
 for(let j=-1;j<=1;j++){B(kx+j*.82,.83,kz-.327,.77,.75,.025,M.wood);B(kx+j*.82,.97,kz-.353,.2,.025,.028,M.brass)}
 B(kx-.66,1.285,kz,.69,.02,.42,M.dark);B(kx-.66,1.3,kz,.55,.02,.31,M.porcelain);B(kx+.7,1.29,kz,.65,.02,.5,M.black);for(const dx of [-.15,.15])for(const dz of [-.13,.13])C(kx+.7+dx,1.31,kz+dz,.09,.016,M.dark);
 C(kx-.67,1.46,kz+.18,.025,.36,M.brass);B(kx-.67,1.64,kz+.07,.035,.035,.22,M.brass);B(kx,2.52,kz,2.5,.7,.35,M.wood);B(kx,2.15,kz-.1,2.4,.025,.3,M.glow);
 const dx=side?3.15:3.45,dz=side?2.05:.55;
 C(dx,.92,dz,.68,.08,M.wood);C(dx,.65,dz,.14,.52,M.dark);for(let j=0;j<3;j++){const a=j*Math.PI*2/3;let x=dx+Math.sin(a)*.97,z=dz+Math.cos(a)*.97;R(x,.67,z,.48,.1,.48,M.cloth,a);R(x,1,z+.2,.49,.65,.09,M.green,a);for(const sx of [-.17,.17])B(x+sx,.5,z,.04,.3,.04,M.wood)}C(dx,1.03,dz,.09,.2,M.porcelain);
 // A tiled washroom, shower, vanity and toilet.
 const bx=side?4.25:3.55,bz=side?-1.75:(index===7||index===8?2.65:3.9);B(bx,.38,bz,1.65,.025,1.9,M.stone);W(bx-.88,bz-.98,bx-.88,bz-.15);W(bx-.88,bz+.75,bx+.8,bz+.75);
 B(bx+.4,.67,bz+.15,.52,.62,.65,M.porcelain);R(bx+.4,.84,bz-.1,.43,.12,.57,M.porcelain);B(bx-.32,.84,bz-.64,.66,.65,.39,M.wood);B(bx-.32,1.2,bz-.64,.71,.07,.43,M.porcelain);B(bx-.32,1.76,bz-.81,.55,.83,.025,M.glass);C(bx-.32,1.35,bz-.66,.024,.25,M.brass);
 B(bx+.7,1.5,bz-.3,.025,2.2,1.2,M.glass);B(bx+.67,2.42,bz-.65,.05,.1,.25,M.brass);
 plant(side?3.8:-3.95,side?3.6:2.45,.8);plant(side?-1.2:1.15,side?3.4:4.35,.65);
 // Framed abstract artwork with layered pigment blocks.
 B(lx-.3,1.9,lz+.98,1.05,.83,.045,M.walnut);B(lx-.3,1.9,lz+.95,.94,.72,.025,M.cloth);B(lx-.49,1.9,lz+.927,.3,.5,.018,M.rust);B(lx-.14,1.8,lz+.919,.3,.26,.018,M.green);
 const lp=P(lx,lz,2.65),light=new T.PointLight('#ffd8a2',0,10,2);light.position.set(...lp);scene.add(light);roomLights.push(light);cyl(lp[0],2.8,lp[2],.38,.12,M.cloth,upperWalls);cyl(lp[0],2.73,lp[2],.3,.025,M.glow,upperWalls);
 const sw=P(side?3:-1,side?-2.8:3.8,1.35);box(...sw,.09,.13,.025,M.porcelain,r);switches.push({p:new T.Vector3(...sw),light,on:true,name:u.name});
}
function pot(x,z,size=1){cyl(x,.36+size*.22,z,size*.23,size*.45,M.porcelain);cyl(x,.36+size*.44,z,size*.2,.03,M.soil);for(let i=0;i<9;i++){const a=i*2.4;const h=.65+rand()*.55;ball(x+Math.sin(a)*size*.22,.36+size*h,z+Math.cos(a)*size*.22,size*.12,size*.35,size*.07,M.leaf)}}

// Central shared circulation: three lifts, split stair, skylight and entrance colonnade.
const cp=(x,y)=>point([x,y]);
for(let i=0;i<3;i++){const x=-3.3+i*3.3;box(x,1.66,-4.8,3.2,2.65,2.4,M.wall,0,upperWalls);box(x,1.65,-3.56,2.35,2.5,.05,M.dark,0,upperWalls);for(const s of [-1,1])box(x+s*.55,1.6,-3.51,1.07,2.4,.045,M.brass,0,upperWalls);box(x,1.6,-3.46,.025,2.4,.02,M.dark,0,upperWalls);box(x,2.94,-3.45,.32,.16,.02,M.glow,0,upperWalls);box(x+1.25,1.5,-3.5,.08,.21,.04,M.brass,0,upperWalls)}
for(let i=0;i<13;i++){box(-1.2,.36+i*.16,.15+i*.22,2.3,.16,.24,M.stone);box(1.2,2.28-i*.16,.15+i*.22,2.3,.16,.24,M.stone)}
box(0,2.44,3.05,4.9,.16,.75,M.stone);for(let i=0;i<13;i++){for(const x of [-2.4,0,2.4])box(x,.95+i*.16,.15+i*.22,.025,1.15,.025,M.dark)}
for(const x of [-2.4,0,2.4]){const a=new T.Vector3(x,1.53,.13),b=new T.Vector3(x,3.45,2.85);const g=new T.CylinderGeometry(.025,.025,a.distanceTo(b),8);const m=new T.Mesh(g,M.brass);m.position.copy(a).add(b).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),b.clone().sub(a).normalize());furniture.add(m)}
for(const [a,b] of [[[-4.92,-6.05],[4.92,-6.05]],[[4.92,-6.05],[4.92,-3.5]],[[4.92,-3.5],[-4.92,-3.5]],[[-4.92,-3.5],[-4.92,-6.05]]])wallColliders.push({a,b,d:.15});
// Guard rails keep the staircase a visible, physically bounded architectural feature.
wallColliders.push({a:[-2.5,-.15],b:[2.5,-.15],d:.12},{a:[-2.5,-.15],b:[-2.5,3.4],d:.12},{a:[2.5,-.15],b:[2.5,3.4],d:.12},{a:[-2.5,3.4],b:[2.5,3.4],d:.12});
for(const x of [-3.4,3.4]){pot(x,-1.7,.9);box(x,.74,1.35,.9,.7,1.9,M.wood);round(x,1.12,1.35,.83,.1,1.83,M.cloth)}
for(const z of [-6,-2,2]){box(0,3.23,z,12.4,.13,.14,M.dark,0,roofs);box(0,3.29,z+1.8,12.4,.06,3.4,M.glass,0,roofs)}
for(const x of [-3.4,3.4]){box(x,1.72,4.65,.18,2.8,.18,M.dark,0,upperWalls);box(x,.5,4.65,.25,.3,.25,M.brass)}
for(let i=0;i<3;i++)box(0,.1+i*.08,6.4-i*.65,6.6+i*.35,.16,.7,M.stone,0,landscape);

// Site: a planted island, raised terrace, reflective water, decks and distant shoreline.
const islandShape=new T.Shape();islandShape.absellipse(0,0,43,34,0,Math.PI*2,false,0);let islandG=new T.ExtrudeGeometry(islandShape,{depth:.6,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:.8,bevelThickness:.3,curveSegments:96});islandG.rotateX(-Math.PI/2);islandG.translate(0,-1,0);add(islandG,M.soil,[0,0,0],[1,1,1],0,landscape);
// Pale gravel court around the traced footprint.
const courtShape=new T.Shape();courtShape.absellipse(0,0,32,25.5,0,Math.PI*2,false,0);const courtGeo=new T.ShapeGeometry(courtShape,96);courtGeo.rotateX(-Math.PI/2);add(courtGeo,M.path,[0,-.075,0],[1,1,1],0,landscape);
box(0,-.09,26,6.6,.13,18,M.wood,0,landscape);for(let z=17;z<35;z+=.19)box(0,-.013,z,6.58,.016,.012,M.walnut,0,landscape);
box(0,-.16,35,12,.34,6,M.wood,0,landscape);for(let z=32;z<38;z+=.19)box(0,.02,z,12,.015,.012,M.walnut,0,landscape);
for(const x of [-5.4,5.4])for(const z of [32.5,37.5]){cyl(x,-.7,z,.13,1.9,M.walnut,landscape);cyl(x,.3,z,.17,.07,M.brass,landscape)}
for(const x of [-3.1,3.1]){round(x,.34,35,1.8,.45,.8,M.cloth,0,landscape);box(x,.14,35,1.6,.22,.64,M.walnut,0,landscape)}cyl(0,.37,35,.55,.6,M.porcelain,landscape);
// Water normal map with physically animated reflection and refraction.
const nc=document.createElement('canvas');nc.width=nc.height=256;const nctx=nc.getContext('2d'),ni=nctx.createImageData(256,256);for(let i=0;i<ni.data.length;i+=4){ni.data[i]=120+rand()*16;ni.data[i+1]=120+rand()*16;ni.data[i+2]=250;ni.data[i+3]=255}nctx.putImageData(ni,0,0);const normals=new T.CanvasTexture(nc);normals.wrapS=normals.wrapT=T.RepeatWrapping;
const water=new Water(new T.PlaneGeometry(850,850),{textureWidth:mobile?256:512,textureHeight:mobile?256:512,waterNormals:normals,sunDirection:sun.position.clone().normalize(),sunColor:0xfff0d0,waterColor:0x507e78,distortionScale:2.5,fog:true});water.rotation.x=-Math.PI/2;water.position.y=-.72;water.material.uniforms.size.value=6;landscape.add(water);
// A water garden in the open southern notch of the original plan.
box(0,-.06,10.5,5.4,.22,5.9,M.dark,0,landscape);const pool=add(new T.PlaneGeometry(5.05,5.55),mat('#5d8579',.16,{metalness:.4,transparent:true,opacity:.85}),[0,.061,10.5],[1,1,1],0,landscape,false);pool.rotation.x=-Math.PI/2;
for(const x of [-2.8,2.8])box(x,.16,10.5,.17,.38,6.2,M.stone,0,landscape);for(const z of [7.5,13.5])box(0,.16,z,5.7,.38,.17,M.stone,0,landscape);
for(let i=0;i<18;i++){const x=(rand()-.5)*4.4,z=8+rand()*5;cyl(x,.079,z,.13+rand()*.14,.018,mat(i%3?'#657750':'#819564'),landscape)}
for(const s of [-1,1])for(let j=0;j<10;j++)box(s*4.1,.02,9+j*.95,1.25,.08,.65,M.stone,0,landscape);
// Landscape edges, gravel, boulders and lighting.
for(let i=0;i<105;i++){const a=i*Math.PI*2/105;const x=Math.cos(a)*41.5,z=Math.sin(a)*33;ball(x,-.32,z,.4+rand()*.7,.24+rand()*.35,.4+rand()*.55,M.waterEdge,landscape)}
for(const s of [-1,1])for(let j=0;j<8;j++){const x=s*(8+j*3.5),z=25-j*.2;cyl(x,.28,z,.055,.8,M.dark,landscape);cyl(x,.65,z,.09,.08,M.glow,landscape);const l=new T.PointLight('#ffcc83',0,5,2);l.position.set(x,.8,z);scene.add(l);lights.push(l)}
for(let j=0;j<6;j++){for(const s of [-1,1]){const x=s*3.05,z=18+j*3;cyl(x,.24,z,.045,.65,M.dark,landscape);cyl(x,.56,z,.075,.07,M.glow,landscape)}}

// Leaf cards, instanced in thousands, add fine silhouettes without thousands of draw calls.
const leafCanvas=document.createElement('canvas');leafCanvas.width=leafCanvas.height=64;const lc=leafCanvas.getContext('2d');lc.fillStyle='white';lc.beginPath();lc.ellipse(32,32,14,30,.5,0,Math.PI*2);lc.fill();const leafAlpha=new T.CanvasTexture(leafCanvas);
const foliageM=new T.MeshStandardMaterial({color:'#719050',roughness:.85,alphaMap:leafAlpha,alphaTest:.55,side:T.DoubleSide});
const treeData=[];for(let i=0;i<48;i++){const a=i*2.39996;const radius=33+rand()*7;const x=Math.cos(a)*radius,z=Math.sin(a)*radius*.77;if(Math.abs(x)<6&&z>0)continue;treeData.push({x,z,h:3.7+rand()*3.2})}
// Distant land and a wooded horizon stop the environment from feeling like a floating model.
const shoreInner=a=>112+Math.sin(a*3)*17+Math.cos(a*5)*9;
const shorePositions=[],shoreIndices=[],shoreColors=[];for(let j=0;j<=16;j++)for(let i=0;i<=144;i++){const a=i/144*Math.PI*2,r=shoreInner(a)+(390-shoreInner(a))*j/16,x=Math.cos(a)*r,z=Math.sin(a)*r*.85,h=-1+j*.95*(1+Math.sin(a*4)*.35)+Math.sin(x*.04)*Math.sin(z*.035)*j*.35;shorePositions.push(x,h,z);const c=new T.Color().setHSL(.24,.14,.28+Math.sin(a*3)*.025+j*.003);shoreColors.push(c.r,c.g,c.b);if(j<16&&i<144){const q=j*145+i;shoreIndices.push(q,q+145,q+1,q+1,q+145,q+146)}}const shoreG=new T.BufferGeometry();shoreG.setAttribute('position',new T.Float32BufferAttribute(shorePositions,3));shoreG.setAttribute('color',new T.Float32BufferAttribute(shoreColors,3));shoreG.setIndex(shoreIndices);shoreG.computeVertexNormals();const shoreM=mat('#a3ac90',1,{vertexColors:true,side:T.DoubleSide});add(shoreG,shoreM,[0,0,0],[1,1,1],0,landscape);
for(let i=0;i<60;i++){const a=i/60*Math.PI*2,r=shoreInner(a)+14+rand()*12;treeData.push({x:Math.cos(a)*r,z:Math.sin(a)*r*.85,h:5+rand()*7,distant:true})}
const leafCount=treeData.reduce((n,t)=>n+(t.distant?300:950),0),leafMesh=new T.InstancedMesh(new T.PlaneGeometry(1,1),foliageM,leafCount);leafMesh.castShadow=true;leafMesh.receiveShadow=true;const leafColor=new T.Color();let leafIndex=0;
for(const tree of treeData){const {x,z,h}=tree;cyl(x,h*.36-.2,z,.1+h*.012,h*.72,M.trunk,landscape);for(let j=0;j<5;j++){const a=j*2.4;let p1=new T.Vector3(x,h*.36,z),p2=new T.Vector3(x+Math.sin(a)*h*.24,h*.65+rand()*h*.17,z+Math.cos(a)*h*.24);let g=new T.CylinderGeometry(.025,.07,p1.distanceTo(p2),6);g.rotateZ(-Math.PI/2);g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(1,0,0),p2.clone().sub(p1).normalize()));g.translate(...p1.add(p2).multiplyScalar(.5).toArray());add(g,M.trunk,[0,0,0],[1,1,1],0,landscape)}const n=tree.distant?300:950;for(let i=0;i<n;i++){const a=rand()*Math.PI*2,rr=Math.cbrt(rand())*h*.35,yy=(rand()-.5)*h*.42;tmp.position.set(x+Math.cos(a)*rr,h*.72+yy,z+Math.sin(a)*rr);tmp.rotation.set(rand()*Math.PI,rand()*Math.PI*2,rand()*Math.PI);tmp.scale.setScalar(tree.distant?1.1:.46+rand()*.32);tmp.updateMatrix();leafMesh.setMatrixAt(leafIndex,tmp.matrix);leafColor.setHSL(.20+rand()*.06,.22+rand()*.22,.18+rand()*.15);leafMesh.setColorAt(leafIndex++,leafColor)}}landscape.add(leafMesh);
const grassMat=new T.MeshStandardMaterial({color:'#9aab73',roughness:1,side:T.DoubleSide});const grass=new T.InstancedMesh(new T.PlaneGeometry(.1,.55),grassMat,6200);grass.castShadow=false;let gi=0;for(let i=0;i<6200;i++){const a=rand()*Math.PI*2;const rr=Math.sqrt(rand())*1;let x=Math.cos(a)*(32+rr*9),z=Math.sin(a)*(26+rr*6.5);if(Math.abs(x)<5&&z>0){x+=7}tmp.position.set(x,.1+rand()*.08,z);tmp.rotation.set(0,rand()*Math.PI,rand()*.2-.1);tmp.scale.setScalar(.45+rand()*.9);tmp.updateMatrix();grass.setMatrixAt(gi++,tmp.matrix)}landscape.add(grass);

// Merge static geometry by material and visibility layer. Dynamic doors stay independent.
for(const {parent,material,geos} of batch.values()){if(!geos.length)continue;const merged=mergeGeometries(geos,false);if(merged){const mesh=new T.Mesh(merged,material);mesh.castShadow=material!==M.glass&&material!==M.glow;mesh.receiveShadow=true;parent.add(mesh)}for(const g of geos)g.dispose()}batch.clear();
roofs.visible=false;upperWalls.visible=false;

let mode='orbit',roofOn=false,lightMode=0,transition=null,yaw=0,pitch=0,walkHeight=1.96,nearby=null,lastTime=performance.now(),frameCount=0,elapsed=0,fps=0,uiHidden=false;
const clock=new T.Clock();const keys=new Set(),moveStick=new T.Vector2(),raycaster=new T.Raycaster();
const overview={pos:new T.Vector3(46,53,68).multiplyScalar(mobile?1.85:1),target:new T.Vector3(-1.2,0,0)};
camera.position.copy(overview.pos);controls.target.copy(overview.target);controls.update();
function toast(msg){$('#toast').textContent=msg;$('#toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),3200)}
function cameraTo(pos,target,duration=1.7){transition={from:camera.position.clone(),to:pos.clone(),fromTarget:controls.target.clone(),target:target.clone(),time:0,duration};controls.enabled=false}
function setRoof(on){roofOn=on;roofs.visible=on;upperWalls.visible=on||mode==='walk';$('#roof-btn').setAttribute('aria-pressed',String(on));$('#roof-label').textContent=on?'打开屋顶':'盖上屋顶';if(mode==='plan'&&on)toast('屋顶已盖上，可再次打开查看室内布局')}
function exitLock(){if(document.pointerLockElement)document.exitPointerLock()}
function setMode(next){document.body.classList.toggle('inspect',next!=='orbit');exitLock();keys.clear();mode=next;transition=null;document.body.classList.toggle('walk',next==='walk');$$('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===next));$('#crosshair').hidden=next!=='walk';$('#walk-hint').hidden=next!=='walk';$('#minimap').hidden=next!=='walk';$('#touch-controls').hidden=next!=='walk'||!mobile;$('#interaction').hidden=true;controls.enabled=next!=='walk';
 if(next==='walk'){setRoof(true);upperWalls.visible=true;camera.position.set(0,1.96,5.15);yaw=0;pitch=0;camera.rotation.order='YXZ';camera.rotation.set(0,0,0);controls.enabled=false;$('#control-hint').textContent=mobile?'左侧摇杆移动 · 右侧滑动观察':'点击场景开始 · WASD 移动 · E 交互 · Esc 释放鼠标';$('#scene-name').textContent='步行 · 中央门厅';toast(mobile?'左侧摇杆移动，右侧拖动观察':'点击场景捕获鼠标，WASD 移动，E 开关门或灯')}
 else{upperWalls.visible=roofOn;$('#control-hint').innerHTML='拖动旋转视角 <b>·</b> 滚轮缩放 <b>·</b> 右键平移';if(next==='plan'){setRoof(false);cameraTo(new T.Vector3(0,mobile?138:78,.015),new T.Vector3(0,0,0),1.5);$('#scene-name').textContent='鸟瞰 · 原图轮廓与十户布局'}else{cameraTo(overview.pos,overview.target);$('#scene-name').textContent='全景 · 蟹形聚落'}}
}
function setLight(next){lightMode=next;document.body.classList.toggle('night',next===2);const names=['午后','黄昏','夜景'];$('#light-label').textContent=names[next];$('#time-label').textContent=['16:30 / 午后暖阳','18:20 / 日落余晖','20:30 / 湖畔灯火'][next];$('#light-btn').setAttribute('aria-pressed',String(next>0));
 const conf=[{sun:'#ffefd6',power:3.5,pos:[-32,48,-25],hemi:2.1,sky:'#cbd7c9',exposure:1.08,env:.5},{sun:'#ffd0a1',power:2.9,pos:[-68,17,-15],hemi:1.3,sky:'#c9b8a4',exposure:1.07,env:.33},{sun:'#a7c2ef',power:.45,pos:[-22,40,25],hemi:.45,sky:'#142b37',exposure:1.25,env:.14}][next];sun.color.set(conf.sun);sun.intensity=conf.power;sun.position.set(...conf.pos);hemi.intensity=conf.hemi;renderer.toneMappingExposure=conf.exposure;scene.environmentIntensity=conf.env;scene.fog.color.set(conf.sky);sky.visible=next!==2;scene.background=new T.Color(conf.sky);su.sunPosition.value.copy(sun.position);water.material.uniforms.sunDirection.value.copy(sun.position).normalize();water.material.uniforms.sunColor.value.set(conf.sun);water.material.uniforms.waterColor.value.set(next===2?'#183a40':'#507e78');
 for(const s of switches)s.light.intensity=s.on?(next===0?2:next===1?12:27):0;for(const l of lights)l.intensity=next===0?0:next===1?7:15;M.glow.emissiveIntensity=next===2?4:1.5;bloom.strength=next===2?.3:.1;
}
const tourViews=[
 {pos:[4.9,3.8,6.4],target:[0,1.35,-2.4],label:'中央门厅 · 光影与秩序'},
 {pos:[-3.2,2.25,-8.7],target:[-7.2,1.25,-11.5],label:'湖景客厅 · 北庭晨光居'},
 {pos:[-8.7,2.2,-13.3],target:[-9.65,1.05,-15.2],label:'温暖卧室 · 北庭晨光居'},
 {pos:[9,5,41],target:[0,.5,31],label:'水岸平台 · 建筑之外'}
];
function goTour(index){const v=tourViews[index];if(mode==='walk'||mode==='plan')setMode('orbit');document.body.classList.add('inspect');setRoof(false);upperWalls.visible=false;cameraTo(new T.Vector3(...v.pos),new T.Vector3(...v.target),2);$('#scene-name').textContent=v.label;$('#tour-panel').style.opacity='.55';setTimeout(()=>$('#tour-panel').style.opacity='',2000)}
$$('[data-mode]').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.mode)));$('#roof-btn').onclick=()=>setRoof(!roofOn);$('#light-btn').onclick=()=>setLight((lightMode+1)%3);$('#enter-btn').onclick=()=>setMode('walk');$$('[data-tour]').forEach(b=>b.onclick=()=>goTour(Number(b.dataset.tour)));
$('#reference-btn').onclick=()=>{exitLock();$('#reference-dialog').showModal()};$('#help-btn').onclick=()=>{exitLock();$('#help-dialog').showModal()};$$('[data-close]').forEach(b=>b.onclick=()=>$('#'+b.dataset.close).close());$$('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const b=d.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)d.close()}}));$('#compare-plan').onclick=()=>{$('#reference-dialog').close();setMode('plan')};
$('#photo-btn').onclick=()=>{composer.render();const a=document.createElement('a');a.download=`蟹屿-${['午后','黄昏','夜景'][lightMode]}-${Date.now()}.png`;a.href=renderer.domElement.toDataURL('image/png');a.click();toast('已保存当前画面')};
$('#quality-btn').onclick=()=>{highQuality=!highQuality;ao.enabled=highQuality;renderer.setPixelRatio(highQuality?Math.min(devicePixelRatio,1.65):1);renderer.setSize(innerWidth,innerHeight);composer.setPixelRatio(renderer.getPixelRatio());composer.setSize(innerWidth,innerHeight);$('#quality-btn').textContent=highQuality?'高画质':'流畅';toast(highQuality?'高画质：开启环境遮蔽与精细渲染':'流畅模式：降低渲染负荷')};
renderer.domElement.addEventListener('click',()=>{if(mode==='walk'&&!mobile&&!document.pointerLockElement)renderer.domElement.requestPointerLock()?.catch(()=>toast('浏览器未捕获鼠标，可按住右键拖动观察'))});
let looking=false;renderer.domElement.addEventListener('pointerdown',e=>{if(mode==='walk'&&e.button===2)looking=true});addEventListener('pointerup',()=>looking=false);
function look(dx,dy){yaw-=dx*.0023;pitch=T.MathUtils.clamp(pitch-dy*.0023,-1.35,1.35);camera.rotation.set(pitch,yaw,0,'YXZ')}
addEventListener('mousemove',e=>{if(mode==='walk'&&(document.pointerLockElement||looking))look(e.movementX,e.movementY)});
addEventListener('keydown',e=>{if($('dialog[open]'))return;if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();keys.add(e.code);if(e.code==='KeyE'&&!e.repeat)interact();if(e.code==='KeyR')setMode('orbit');if(e.code==='KeyH'){uiHidden=!uiHidden;document.body.classList.toggle('hidden-ui',uiHidden)}});addEventListener('keyup',e=>keys.delete(e.code));addEventListener('blur',()=>keys.clear());document.addEventListener('pointerlockchange',()=>{if(!document.pointerLockElement)keys.clear()});
let touchLook=null;renderer.domElement.addEventListener('touchstart',e=>{if(mode==='walk'){const t=e.changedTouches[0];if(t.clientX>innerWidth*.4)touchLook={id:t.identifier,x:t.clientX,y:t.clientY}}},{passive:true});renderer.domElement.addEventListener('touchmove',e=>{if(mode!=='walk'||!touchLook)return;for(const t of e.changedTouches)if(t.identifier===touchLook.id){look((t.clientX-touchLook.x)*1.8,(t.clientY-touchLook.y)*1.8);touchLook.x=t.clientX;touchLook.y=t.clientY}e.preventDefault()},{passive:false});renderer.domElement.addEventListener('touchend',()=>touchLook=null);
const stick=$('#joystick');stick.addEventListener('pointerdown',e=>{stick.setPointerCapture(e.pointerId);updateStick(e)});stick.addEventListener('pointermove',e=>{if(stick.hasPointerCapture(e.pointerId))updateStick(e)});function updateStick(e){const b=stick.getBoundingClientRect();moveStick.set((e.clientX-b.left-50)/38,(e.clientY-b.top-50)/38);if(moveStick.length()>1)moveStick.normalize();stick.firstElementChild.style.transform=`translate(${moveStick.x*28}px,${moveStick.y*28}px)`}const resetStick=()=>{moveStick.set(0,0);stick.firstElementChild.style.transform=''};stick.addEventListener('pointerup',resetStick);stick.addEventListener('pointercancel',resetStick);$('#touch-interact').onclick=interact;

function distSegment(x,z,a,b){const dx=b[0]-a[0],dz=b[1]-a[1],t=T.MathUtils.clamp(((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz),0,1);return Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz)}
function blocked(x,z){for(const o of obstacles){const dx=x-o.x,dz=z-o.z,lx=Math.cos(o.r)*dx-Math.sin(o.r)*dz,lz=Math.sin(o.r)*dx+Math.cos(o.r)*dz;if(Math.abs(lx)<o.w/2&&Math.abs(lz)<o.d/2)return true}if(Math.abs(x)>45||Math.abs(z)>39)return true;if(x*x/(42*42)+z*z/(33*33)>1&&!(Math.abs(x)<6&&z>24&&z<38))return true;if(x>-2.9&&x<2.9&&z>7.4&&z<13.7)return true;for(const w of wallColliders)if(distSegment(x,z,w.a,w.b)<.2+w.d*.5)return true;for(const d of doors){const theta=d.r+d.angle;const len=Math.hypot(d.b[0]-d.a[0],d.b[1]-d.a[1]);const b=[d.a[0]+Math.cos(theta)*len,d.a[1]-Math.sin(theta)*len];if(distSegment(x,z,d.a,b)<.23)return true}return false}
function updateWalk(dt){let f=(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0)-moveStick.y;let s=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0)+moveStick.x;const len=Math.hypot(f,s);if(len>1){f/=len;s/=len}const speed=(keys.has('ShiftLeft')||keys.has('ShiftRight')?4.6:2.45)*dt;const dx=(Math.cos(yaw)*s-Math.sin(yaw)*f)*speed,dz=(-Math.sin(yaw)*s-Math.cos(yaw)*f)*speed;const steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.07));for(let i=0;i<steps;i++){if(!blocked(camera.position.x+dx/steps,camera.position.z))camera.position.x+=dx/steps;if(!blocked(camera.position.x,camera.position.z+dz/steps))camera.position.z+=dz/steps}const inBuilding=units.some(u=>inside(camera.position.x,camera.position.z,u.poly))||inside(camera.position.x,camera.position.z,corridor);walkHeight=T.MathUtils.lerp(walkHeight,inBuilding?1.96:1.62,Math.min(1,dt*6));camera.position.y=walkHeight+(len>.1?Math.sin(clock.elapsedTime*10)*.017:0);findInteractable();drawMap();const name='步行 · '+(units.find(u=>inside(camera.position.x,camera.position.z,u.poly))?.name||(inBuilding?'中央门厅':'水岸庭院'));if($('#scene-name').textContent!==name)$('#scene-name').textContent=name}
function findInteractable(){nearby=null;let best=2.1;const forward=new T.Vector3(0,0,-1).applyQuaternion(camera.quaternion);for(const d of doors){const pos=d.pivot.position.clone();pos.y=1.4;const dist=camera.position.distanceTo(pos);const facing=pos.clone().sub(camera.position).normalize().dot(forward);if(dist<best&&facing>-.15){best=dist;nearby={type:'door',obj:d}}}for(const s of switches){const dist=camera.position.distanceTo(s.p);if(dist<best&&s.p.clone().sub(camera.position).normalize().dot(forward)>.1){best=dist;nearby={type:'switch',obj:s}}}$('#interaction').hidden=!nearby;if(nearby)$('#interaction span').textContent=nearby.type==='door'?(nearby.obj.open?'关闭房门':'打开房门'):(nearby.obj.on?'关闭室内灯':'打开室内灯')}
function interact(){if(mode!=='walk'||!nearby)return;const o=nearby.obj;if(nearby.type==='door'){o.open=!o.open;o.target=o.open?-Math.PI*.52:0;toast(`${o.name} · ${o.open?'房门已打开':'房门已关闭'}`)}else{o.on=!o.on;o.light.intensity=o.on?(lightMode===0?2:lightMode===1?12:27):0;toast(o.on?'室内灯已开启':'室内灯已关闭')}}
const map=$('#map'),mc=map.getContext('2d');function drawMap(){mc.clearRect(0,0,map.width,map.height);const sc=.32,ox=6,oy=5;function poly(p,fill){mc.beginPath();p.forEach(([x,y],i)=>i?mc.lineTo(x*sc+ox,y*sc+oy):mc.moveTo(x*sc+ox,y*sc+oy));mc.closePath();mc.fillStyle=fill;mc.fill();mc.strokeStyle='#6f816950';mc.lineWidth=.8;mc.stroke()}poly(corridor,'#b6bead');for(const u of units)poly(u.poly,'#d6d0b9');const x=(camera.position.x/SCALE+390)*sc+ox,z=(camera.position.z/SCALE+300)*sc+oy;mc.save();mc.translate(x,z);mc.rotate(-yaw);mc.fillStyle='#b4653e';mc.beginPath();mc.moveTo(0,-6);mc.lineTo(4,4);mc.lineTo(0,2);mc.lineTo(-4,4);mc.closePath();mc.fill();mc.restore()}
function resize(){camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);composer.setSize(innerWidth,innerHeight)}addEventListener('resize',resize);
function tick(){requestAnimationFrame(tick);const dt=Math.min(clock.getDelta(),.05);if(transition){transition.time+=dt;let t=Math.min(transition.time/transition.duration,1);t=t*t*(3-2*t);camera.position.lerpVectors(transition.from,transition.to,t);controls.target.lerpVectors(transition.fromTarget,transition.target,t);camera.lookAt(controls.target);if(t>=1){transition=null;controls.enabled=mode!=='walk'}}else if(mode==='walk')updateWalk(dt);else controls.update();for(const d of doors)d.pivot.rotation.y=d.r+(d.angle=T.MathUtils.lerp(d.angle,d.target,Math.min(1,dt*7)));water.material.uniforms.time.value+=dt*.35;const wind=clock.elapsedTime*.35;leafMesh.rotation.z=Math.sin(wind)*.001;grass.rotation.y=Math.sin(wind)*.0006;composer.render();frameCount++;elapsed+=dt;if(elapsed>1){fps=Math.round(frameCount/elapsed);frameCount=0;elapsed=0}}
setLight(0);tick();
let sceneStats={triangles:0,meshes:0};scene.traverse(o=>{if(o.isMesh){sceneStats.triangles+=(o.geometry.index?o.geometry.index.count:o.geometry.attributes.position.count)/3*(o.isInstancedMesh?o.count:1);sceneStats.meshes++}});
// A read-only QA surface and the same UI actions make browser verification reproducible.
window.crabScene={get state(){return{mode,roofOn,lightMode,fps,camera:camera.position.toArray(),doors:doors.map(d=>({name:d.name,open:d.open,position:d.pivot.position.toArray()})),triangles:sceneStats.triangles,drawCalls:sceneStats.meshes,units:units.length,collisionSegments:wallColliders.length,lights:switches.length,switchStates:switches.map(s=>s.on),nearby:nearby?.type||null,obstacles:obstacles.length,ready:true}},setMode,setRoof,setLight,goTour,blocked,getUnit:(x,z)=>units.find(u=>inside(x,z,u.poly))?.name};
requestAnimationFrame(()=>requestAnimationFrame(()=>{$('#loading').style.opacity='0';setTimeout(()=>$('#loading').remove(),1050)}));
