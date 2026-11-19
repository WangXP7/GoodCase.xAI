import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {mountEyewearCandidate} from '/js/eyewear.js';
import {createProceduralCap} from '/js/procedural-cap.js';

const canvas=document.querySelector('canvas'),renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});
renderer.setSize(360,360,false);renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.85;
const scene=new THREE.Scene();scene.background=new THREE.Color(0x182131);scene.add(new THREE.HemisphereLight(0xddeaff,0x66553b,2));
for(const[color,intensity,position]of[[0xffedd1,3,[3,4,5]],[0x90b6ff,1.5,[-3,3,-2]],[0xffffff,1.2,[0,2,-4]]]){const light=new THREE.DirectionalLight(color,intensity);light.position.set(...position);scene.add(light);}
const camera=new THREE.PerspectiveCamera(30,1,.01,100),loader=new GLTFLoader(),pivot=new THREE.Group();scene.add(pivot);
const [manifest,landmarks]=await Promise.all([fetch('/models/items/eyewear-manifest.json').then(r=>r.json()),fetch('/models/items/face-landmarks.json').then(r=>r.json())]);
let state=null;

function skinned(index,target){state.body.getVertexPosition(index,target);return target.applyMatrix4(state.body.matrixWorld);}
function headMatrix(){return new THREE.Matrix4().multiplyMatrices(state.head.matrixWorld,new THREE.Matrix4().copy(state.body.skeleton.boneInverses[state.headIndex]).multiply(state.body.bindMatrix));}
function toHeadLocal(world){const matrix=headMatrix(),factor=matrix.getMaxScaleOnAxis();return world.clone().applyMatrix4(matrix.clone().invert()).multiplyScalar(factor);}
function headCenter(){const center=state.bounds.getCenter(new THREE.Vector3());return center.applyMatrix4(headMatrix());}
function headProxy(){
  const body=state.body,geometry=body.geometry,index=geometry.index,skinIndex=geometry.getAttribute('skinIndex'),skinWeight=geometry.getAttribute('skinWeight'),count=geometry.getAttribute('position').count,channels=['getX','getY','getZ','getW'];
  const near=new Set(body.skeleton.bones.map((bone,i)=>[bone.name,i]).filter(([name])=>/^(Head|neck|head_end|headfront|Curl)/.test(name)).map(([,i])=>i)),keep=new Uint8Array(count),positions=new Float32Array(count*3),point=new THREE.Vector3();
  for(let i=0;i<count;i++){let weight=0;for(let channel=0;channel<4;channel++)if(near.has(skinIndex[channels[channel]](i)))weight+=skinWeight[channels[channel]](i);if(weight>.05){keep[i]=1;const p=toHeadLocal(skinned(i,point));positions[i*3]=p.x;positions[i*3+1]=p.y;positions[i*3+2]=p.z;}}
  const source=index?index.array:[...Array(count).keys()],triangles=[];for(let i=0;i<source.length;i+=3)if(keep[source[i]]&&keep[source[i+1]]&&keep[source[i+2]])triangles.push(source[i],source[i+1],source[i+2]);
  const proxyGeometry=new THREE.BufferGeometry();proxyGeometry.setAttribute('position',new THREE.BufferAttribute(positions,3));proxyGeometry.setIndex(triangles);proxyGeometry.computeBoundingSphere();
  const proxy=new THREE.Mesh(proxyGeometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));proxy.updateMatrixWorld(true);return proxy;
}
function surfaceX(proxy,point,side){const ray=new THREE.Raycaster(new THREE.Vector3(side*.3,point.y,point.z),new THREE.Vector3(-side,0,0),0,.3),hit=ray.intersectObject(proxy,false)[0];return hit?Math.abs(hit.point.x):0;}
function inside(proxy,point){let votes=0;for(const direction of [new THREE.Vector3(1,0,0),new THREE.Vector3(0,1,0)]){const ray=new THREE.Raycaster(point,direction,0,1);if(ray.intersectObject(proxy,false).length%2)votes++;}return votes===2;}
function eyewearMetrics(){
  const mounted=state.mounted,deformation=mounted.deformation;if(!deformation)return null;
  const mesh=deformation.mesh,position=mesh.geometry.getAttribute('position'),original=deformation.original,local=[];for(let i=0;i<position.count;i++)local.push(toHeadLocal(new THREE.Vector3().fromBufferAttribute(position,i).applyMatrix4(mesh.matrixWorld)));
  const isFront=i=>original[i*3+2]>=deformation.hinge,frontBox=new THREE.Box3();local.forEach((point,i)=>{if(isFront(i))frontBox.expandByPoint(point);});
  const proxy=headProxy(),result={lensEyeCm:+(((frontBox.min.y+frontBox.max.y)/2-state.landmark.eyewear.eyeLineY)*100).toFixed(3)},step=2;
  let frontInside=0,frontTested=0;for(let i=0;i<position.count;i+=step)if(isFront(i)){frontTested++;if(inside(proxy,local[i]))frontInside++;}
  result.clippingPct=+(100*frontInside/Math.max(1,frontTested)).toFixed(3);
  for(const [name,side,earName]of[['left',1,'left'],['right',-1,'right']]){
    const ear=state.landmark.eyewear.ears[earName],points=[];for(let i=0;i<position.count;i+=step){if(isFront(i)||local[i].x*side<=0)continue;const point=local[i],gap=Math.abs(point.x)-surfaceX(proxy,point,side);points.push({z:point.z,y:point.y,gap,visible:gap>-.0005});}
    const bins=new Map();for(const point of points){const bin=Math.floor(point.z*400);if(!bins.has(bin))bins.set(bin,[]);bins.get(bin).push(point);}
    let visibleEnd=null,broken=false;for(const bin of [...bins.keys()].sort((a,b)=>b-a)){const values=bins.get(bin),fraction=values.filter(point=>point.visible).length/values.length;if(!broken){if(fraction>=.3)visibleEnd=bin;else broken=true;}}
    const z=visibleEnd==null?null:visibleEnd/400,values=visibleEnd==null?[]:bins.get(visibleEnd),y=values.length?values.reduce((sum,point)=>sum+point.y,0)/values.length:null,sunk=points.filter(point=>!point.visible&&point.z>ear.frontZ+.005).length;
    result[name]={templeEarCm:z==null?null:+((z-ear.frontZ)*100).toFixed(3),templeEarVerticalCm:y==null?null:+((y-ear.topY)*100).toFixed(3),sunkFraction:+(sunk/Math.max(1,points.length)).toFixed(5)};
  }
  proxy.geometry.dispose();proxy.material.dispose();return result;
}
function eyeWorld(){return state.eyeBind.clone().applyMatrix4(headMatrix());}
function capMetrics(){
  const brim=state.cap.mesh,position=brim.geometry.getAttribute('position'),eye=eyeWorld().project(camera),screenEye=(1-eye.y)*180,start=state.cap.brimVertexStart,end=start+state.cap.brimVertexCount;
  let brimBottom=-Infinity;for(let i=start;i<end;i++){const point=new THREE.Vector3().fromBufferAttribute(position,i).applyMatrix4(brim.matrixWorld).project(camera);if(Math.abs(point.x-eye.x)<.14)brimBottom=Math.max(brimBottom,(1-point.y)*180);}
  const relative=new THREE.Matrix4().copy(state.head.matrixWorld).invert().multiply(state.cap.group.matrixWorld),stability=Math.max(...relative.elements.map((value,index)=>Math.abs(value-(index%5===0?1:0))));
  return {brimEyeClearancePx:+(screenEye-brimBottom).toFixed(3),headAndHairOutsideCrownPct:state.cap.fitMetrics.headAndHairOutsideCrownPct,crownClearanceCm:state.cap.fitMetrics.crownClearanceCm,drawCalls:state.cap.renderMetrics.drawCalls,triangles:state.cap.renderMetrics.triangles,stability:+stability.toExponential(3)};
}
function setPose(name,time){
  state.mixer.stopAllAction();const clip=state.clips[name]||state.clips.idle||Object.values(state.clips)[0];if(clip){const action=state.mixer.clipAction(clip);action.reset().play();state.mixer.setTime(Math.min(time,Math.max(0,clip.duration-.001)));}
}
function setView(view){
  const yaw={front:0,threeQuarter:Math.PI/4,profile:Math.PI/2}[view]??0;pivot.rotation.y=yaw;scene.updateMatrixWorld(true);const center=headCenter(),distance=state.kind==='cap'?(view==='profile'?.8:.85):(view==='profile'?.72:.78);
  camera.position.set(center.x,center.y+(state.kind==='cap'?.025:.01),center.z+distance);camera.lookAt(center.x,center.y-.025,center.z);camera.updateProjectionMatrix();scene.updateMatrixWorld(true);
}
async function loadBody(bodyId){
  pivot.clear();const gltf=await loader.loadAsync(`/models/characters/${bodyId}.glb`),model=gltf.scene;pivot.add(model);let body;model.traverse(object=>{if(!body&&object.isSkinnedMesh&&object.skeleton.bones.some(bone=>bone.name==='Head'))body=object;});
  let animations=gltf.animations;try{animations=(await loader.loadAsync(`/models/anims/${bodyId}.glb`)).animations;}catch{}
  model.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(model),scale=1.72/(box.max.y-box.min.y||1);model.scale.setScalar(scale);model.position.set(-box.getCenter(new THREE.Vector3()).x*scale,-box.min.y*scale,-box.getCenter(new THREE.Vector3()).z*scale);model.updateMatrixWorld(true);
  const headIndex=body.skeleton.bones.findIndex(bone=>bone.name==='Head'),head=body.skeleton.bones[headIndex],position=body.geometry.getAttribute('position'),skinIndex=body.geometry.getAttribute('skinIndex'),skinWeight=body.geometry.getAttribute('skinWeight'),channels=['getX','getY','getZ','getW'],bounds=new THREE.Box3(),point=new THREE.Vector3();
  for(let i=0;i<position.count;i++){let weight=0;for(let channel=0;channel<4;channel++)if(skinIndex[channels[channel]](i)===headIndex)weight+=skinWeight[channels[channel]](i);if(weight>.65)bounds.expandByPoint(point.fromBufferAttribute(position,i));}
  const clips=Object.fromEntries(animations.map(clip=>[clip.name,clip])),mixer=new THREE.AnimationMixer(model);state={bodyId,model,body,head,headIndex,bounds,clips,mixer,landmark:landmarks.bodies[bodyId]};
  scene.updateMatrixWorld(true);const front=body.skeleton.bones.find(bone=>bone.name==='headfront'),eye=front?front.getWorldPosition(new THREE.Vector3()):headCenter();if(Number.isFinite(state.landmark?.eyewear?.eyeLineY))eye.y=state.landmark.eyewear.eyeLineY;state.eyeBind=eye.applyMatrix4(headMatrix().clone().invert());
}
async function loadEyewear(itemId,bodyId,overrides={}){await loadBody(bodyId);const entry=manifest.eyewear[itemId],profile={...entry.profiles[bodyId],...overrides},gltf=await loader.loadAsync(entry.model);state.kind='eyewear';state.itemId=itemId;state.profile=profile;state.mounted=mountEyewearCandidate(state.model,gltf.scene,profile,state.landmark,itemId);if(!state.mounted)throw new Error('eyewear mount failed');}
async function loadCap(bodyId){await loadBody(bodyId);state.kind='cap';state.itemId='treta-cap-procedural-v1';state.cap=createProceduralCap(state.body);if(!state.cap)throw new Error('cap mount failed');}
function frame({pose,time,view}){setPose(pose,time);setView(view);renderer.render(scene,camera);const metrics=state.kind==='eyewear'&&view==='front'?eyewearMetrics():state.kind==='cap'?capMetrics():null;return {metrics,clip:state.clips[pose]?.name||null};}
window.fitMatrix={loadEyewear,loadCap,frame};window.fitMatrixReady=true;
