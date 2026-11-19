import * as THREE from 'three';

export const PROCEDURAL_CAP_VERSION='treta-cap-procedural-v1';
const CHANNELS=['getX','getY','getZ','getW'];

function measuredHeadBounds(body,headIndex){
  const position=body.geometry.getAttribute('position');
  const skinIndex=body.geometry.getAttribute('skinIndex');
  const skinWeight=body.geometry.getAttribute('skinWeight');
  if(!position || !skinIndex || !skinWeight)return null;
  const bounds=new THREE.Box3(),point=new THREE.Vector3();
  for(let i=0;i<position.count;i++){
    let weight=0;
    for(let channel=0;channel<4;channel++)if(skinIndex[CHANNELS[channel]](i)===headIndex)weight+=skinWeight[CHANNELS[channel]](i);
    if(weight>.55)bounds.expandByPoint(point.fromBufferAttribute(position,i));
  }
  return bounds.isEmpty()?null:bounds;
}

function labelTexture(){
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=180;
  const context=canvas.getContext('2d');context.fillStyle='#121b2c';context.fillRect(0,0,canvas.width,canvas.height);context.fillStyle='#e9cf59';context.font='900 110px Arial';context.textAlign='center';context.textBaseline='middle';context.fillText('TRETA',256,92);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}

function flattenGeometry(geometry,matrix,keepUV=false){
  geometry.applyMatrix4(matrix);const flat=geometry.index?geometry.toNonIndexed():geometry;
  if(!keepUV){const uv=new Float32Array(flat.getAttribute('position').count*2);uv.fill(.02);flat.setAttribute('uv',new THREE.BufferAttribute(uv,2));}
  return flat;
}

function mergeGeometry(geometries){
  const merged=new THREE.BufferGeometry(),count=geometries.reduce((sum,geometry)=>sum+geometry.getAttribute('position').count,0);
  for(const [name,size]of [['position',3],['normal',3],['uv',2]]){const values=new Float32Array(count*size);let offset=0;for(const geometry of geometries){const source=geometry.getAttribute(name).array;values.set(source,offset);offset+=source.length;}merged.setAttribute(name,new THREE.BufferAttribute(values,size));}
  merged.computeBoundingBox();merged.computeBoundingSphere();return merged;
}

function measureCrownFit(body,bones,{rx,ry,rz,baseY,headHeight,cx,cz}){
  const position=body.geometry.getAttribute('position'),skinIndex=body.geometry.getAttribute('skinIndex'),skinWeight=body.geometry.getAttribute('skinWeight');
  const near=new Set(bones.map((bone,index)=>[bone.name,index]).filter(([name])=>/^(Head|neck|head_end|headfront|Curl)/.test(name)).map(([,index])=>index));
  let tested=0,outside=0,centralTop=-Infinity;
  for(let i=0;i<position.count;i++){
    let weight=0;
    for(let channel=0;channel<4;channel++)if(near.has(skinIndex[CHANNELS[channel]](i)))weight+=skinWeight[CHANNELS[channel]](i);
    if(weight<=.05)continue;
    const x=(position.getX(i)-cx)/rx,z=(position.getZ(i)-cz)/rz,radial=x*x+z*z,y=position.getY(i);
    if(radial<=.2)centralTop=Math.max(centralTop,y);
    if(y<baseY || radial>1)continue;
    tested++;
    const shellY=baseY+ry*Math.sqrt(1-radial);
    if(y>shellY+headHeight*.005)outside++;
  }
  return {
    headAndHairOutsideCrownPct:+(100*outside/Math.max(1,tested)).toFixed(3),
    crownClearanceCm:+((baseY+ry-centralTop)*100).toFixed(3),
  };
}

export function createProceduralCap(body,{visible=true}={}){
  const bones=body?.skeleton?.bones || [],headIndex=bones.findIndex(bone=>bone.name==='Head');
  if(headIndex<0)return null;
  const bounds=measuredHeadBounds(body,headIndex);if(!bounds)return null;
  const position=body.geometry.getAttribute('position'),height=bounds.max.y-bounds.min.y,upper=new THREE.Box3(),point=new THREE.Vector3();
  for(let i=0;i<position.count;i++)if(position.getY(i)>bounds.max.y-height*.38&&position.getY(i)<=bounds.max.y&&position.getX(i)>=bounds.min.x&&position.getX(i)<=bounds.max.x)upper.expandByPoint(point.fromBufferAttribute(position,i));
  if(upper.isEmpty())return null;
  const width=upper.max.x-upper.min.x,depth=upper.max.z-upper.min.z,cx=(upper.min.x+upper.max.x)/2,cz=(upper.min.z+upper.max.z)/2;
  const rx=width*.54,rz=Math.max(depth*.54,rx*.85),ry=height*.32,baseY=bounds.max.y-height*.23;
  const group=new THREE.Group();group.name='TRETA-cap';group.visible=visible;bones[headIndex].add(group);
  const toHead=body.skeleton.boneInverses[headIndex],geometries=[],add=(geometry,keepUV=false)=>{const flat=flattenGeometry(geometry,toHead,keepUV);geometries.push(flat);return flat;};
  const crown=new THREE.SphereGeometry(1,48,24,0,Math.PI*2,0,Math.PI/2);crown.scale(rx,ry,rz);crown.translate(cx,baseY,cz);add(crown);
  const positions=[],indices=[],columns=48,rows=8;
  for(let row=0;row<=rows;row++){const fraction=row/rows;for(let column=0;column<=columns;column++){const angle=(column/columns-.5)*1.95,x=Math.sin(angle)*rx*(.88+fraction*.08),z=Math.cos(angle)*rz+fraction*rx*.25*Math.cos(angle*.55);positions.push(cx+x,baseY+height*.005+fraction*fraction*height*.035+Math.abs(x/rx)*height*.006,cz+z);}}
  for(let row=0;row<rows;row++)for(let column=0;column<columns;column++){const a=row*(columns+1)+column,b=a+columns+1;indices.push(a,b,a+1,a+1,b,b+1);}
  const brim=new THREE.BufferGeometry();brim.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));brim.setIndex(indices);brim.computeVertexNormals();const brimVertexStart=geometries[0].getAttribute('position').count,brimGeometry=add(brim),brimVertexCount=brimGeometry.getAttribute('position').count;
  for(let panel=0;panel<6;panel++){const phi=panel*Math.PI/3,points=[];for(let i=0;i<=28;i++){const theta=i/28*Math.PI/2;points.push(new THREE.Vector3(cx+(rx+.0008)*Math.sin(theta)*Math.sin(phi),baseY+(ry+.0008)*Math.cos(theta),cz+(rz+.0008)*Math.sin(theta)*Math.cos(phi)));}add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),28,height*.0017,4,false));}
  const button=new THREE.SphereGeometry(height*.024,16,8);button.scale(1,.45,1);button.translate(cx,baseY+ry,cz);add(button);
  const patch=new THREE.PlaneGeometry(rx*1.05,rx*.38);patch.rotateX(-.25);patch.translate(cx,baseY+ry*.42,cz+rz*.917+.002);add(patch,true);
  const geometry=mergeGeometry(geometries),material=new THREE.MeshStandardMaterial({map:labelTexture(),side:THREE.DoubleSide,roughness:.84}),mesh=new THREE.Mesh(geometry,material);mesh.name='TRETA-cap-mesh';mesh.frustumCulled=false;mesh.userData.noHit=true;mesh.raycast=()=>{};mesh.receiveShadow=true;group.add(mesh);
  const dimensions={rx,ry,rz,baseY,headHeight:height,cx,cz},fitMetrics=measureCrownFit(body,bones,dimensions),renderMetrics={drawCalls:1,triangles:geometry.getAttribute('position').count/3};group.userData={itemId:PROCEDURAL_CAP_VERSION,slot:'head',certified:false,dimensions,fitMetrics,renderMetrics};
  return {group,mesh,head:bones[headIndex],headIndex,dimensions,fitMetrics,renderMetrics,brimVertexStart,brimVertexCount,anchor:group.matrix.clone(),version:PROCEDURAL_CAP_VERSION,certified:false};
}
