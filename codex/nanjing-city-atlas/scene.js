const T = THREE;
const pi = Math.PI;
const mapBounds = {west:-850,east:600,north:-555,south:555};
const clamp = (v,a,b) => Math.max(a,Math.min(v,b));
const mix = (a,b,t) => a+(b-a)*t;
const seedRandom = seed => () => {
  seed = (Math.imul(1664525,seed)+1013904223) >>> 0;
  return seed/4294967296;
};
const grey=0x77796f, stone=0xc5b69b, pale=0xe2d5b5, red=0xa84732, gold=0xb98242;
const ink=0x303e42, jade=0x49756a, glass=0x587f8b, blue=0x345d90;
const geos = {
  box:new T.BoxGeometry(1,1,1),
  canopy:new T.IcosahedronGeometry(.53,1),
  facade:new T.BoxGeometry(1,1,1),
  shadow:new T.PlaneGeometry(1,1).rotateX(-pi/2),
  sphere:new T.SphereGeometry(.5,12,8),
  oct:new T.IcosahedronGeometry(.54,0),
  cone:new T.ConeGeometry(.5,1,8),
  cyl:new T.CylinderGeometry(.5,.5,1,12),
  roof:new T.CylinderGeometry(.23,.707,1,4,1,false,pi/4),
  foot:new T.CylinderGeometry(.60,.707,1,4,1,false,pi/4),
  octRoof:new T.CylinderGeometry(.29,.53,1,8),
  arch:new T.TorusGeometry(.5,.055,6,24,pi),
  ring:new T.TorusGeometry(.5,.075,8,32)
};
function proceduralTexture(size,paint){
  const canvas=document.createElement('canvas');
  canvas.width=canvas.height=size;
  paint(canvas.getContext('2d'),size);
  const texture=new T.CanvasTexture(canvas);
  texture.colorSpace=T.SRGBColorSpace;
  texture.anisotropy=4;
  return texture;
}
const windows=proceduralTexture(128,(ctx,size)=>{
  const random=seedRandom(287);
  ctx.fillStyle='#c1c3c1';ctx.fillRect(0,0,size,size);
  for(let y=0;y<12;y++)for(let x=0;x<8;x++){
    const value=72+Math.floor(random()*83);
    ctx.fillStyle='rgb('+value+','+(value+11)+','+(value+17)+')';
    ctx.fillRect(x*16+1,y*10.67+1,14,8.5);
    ctx.fillStyle='#9faeb0';ctx.fillRect(x*16+2,y*10.67+1,1,8.5);
  }
});
const contactMap=proceduralTexture(64,(ctx,size)=>{
  const g=ctx.createRadialGradient(size/2,size/2,2,size/2,size/2,size/2);
  g.addColorStop(0,'rgba(16,28,24,.46)');g.addColorStop(.54,'rgba(16,28,24,.26)');
  g.addColorStop(1,'rgba(16,28,24,0)');ctx.fillStyle=g;ctx.fillRect(0,0,size,size);
});
function batcher(root) {
  const batches = new Map();
  const obj = new T.Object3D(), col = new T.Color();
  const material = new T.MeshStandardMaterial({roughness:.86});
  const luminous = new T.MeshBasicMaterial();
  const facade = new T.MeshStandardMaterial({map:windows,roughness:.36,metalness:.22});
  const shadow = new T.MeshBasicMaterial({map:contactMap,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1});
  function add(kind,x,y,z,w,h,d,color,ry=0,rx=0,rz=0,lit=false) {
    const key=kind+(lit?'+':'');
    if(!batches.has(key)) batches.set(key,{kind,lit,items:[]});
    obj.position.set(x,y,z); obj.scale.set(w,h,d); obj.rotation.set(rx,ry,rz,'YXZ');
    obj.updateMatrix();
    batches.get(key).items.push([obj.matrix.clone(),color]);
  }
  function finish() {
    for(const {kind,lit,items} of batches.values()) {
      const surface=kind==='facade'?facade:kind==='shadow'?shadow:lit?luminous:material;
      const mesh = new T.InstancedMesh(geos[kind],surface,items.length);
      if(kind==='shadow')mesh.renderOrder=2;
      else if(!lit){
        mesh.castShadow=true;
        mesh.receiveShadow=true;
      }
      items.forEach(([m,c],i)=>{mesh.setMatrixAt(i,m);mesh.setColorAt(i,col.set(c));});
      mesh.computeBoundingSphere();
      root.add(mesh);
    }
  }
  return {add,finish};
}

function footprint(city,x,z) {
  const wave=Math.sin(z/145), big=-570+.19*z+33*wave;
  if(city.key==='nj') {
    const lake = Math.hypot((x-71)/142,(z+266)/95)+.072*Math.sin(x/17+z/28);
    const island = z>80&&z<423 && Math.abs(x-(big+13)) < 58*Math.sin((z-80)/343*pi);
    const q=164+32*Math.sin(x/139)+13*Math.sin(x/57);
    if((Math.abs(x-big)<106&&!island) || (lake<1 && Math.hypot((x-94)/32,(z+265)/29)>1 &&
      Math.hypot((x-22)/29,(z+285)/20)>1 && Math.hypot((x-116)/19,(z+225)/21)>1) ||
      (x>-400&&x<229&&Math.abs(z-q)<9)) return -10;
    return 1 + 78*Math.exp(-((x-405)**2/28000+(z+256)**2/12200)) +
      26*Math.exp(-((x-501)**2/5500+(z+401)**2/4500)) +
      25*Math.exp(-((x+402)**2/2800+(z+312)**2/2200)) +
      36*Math.exp(-((x+105)**2/8000+(z-503)**2/3600)) +
      15*Math.exp(-((x-52)**2/4100+(z-365)**2/3500)) +
      10*Math.exp(-((x-102)**2/1900+(z+151)**2/850));
  }
  if(city.key==='cq') {
    const yangtze=241-45*Math.sin(x/150)+.17*x;
    const jialing=-195+40*Math.cos(x/129)+Math.max(0,x-210)*.70;
    if(Math.abs(z-yangtze)<61||Math.abs(z-jialing)<43) return -10;
    return 4+72*Math.exp(-((x+325)**2/69000+(z+1)**2/14800))+
      45*Math.exp(-((x-112)**2/54000+(z-56)**2/14000))+
      68*Math.exp(-((x-298)**2/80000+(z+398)**2/18000))+
      18*(1+Math.cos(x/47+z/100))*Math.min(1,Math.abs(z-yangtze)/100);
  }
  if(city.key==='sh') return Math.abs(x-(-40+.46*z-125*Math.cos(z/159)))<78 ? -10 : 2;
  if(city.key==='sz') return z>290+82*Math.cos(x/178)?-10:2+48*Math.exp(-((x+466)**2/16000+(z+383)**2/18000));
  if(city.key==='jn') return Math.abs(z-18*Math.sin(x/85)-58)<16||
    Math.abs(x+72+35*Math.cos(z/91))<13||Math.abs(z+202-26*Math.cos(x/111))<15?-10:2;
  return 2+8*Math.exp(-((x+450)**2+(z+362)**2)/14000);
}

function createCityScene(city, settings) {
  const root=new T.Group();
  const {add,finish}=batcher(root);
  const rng=seedRandom(settings.seed);
  const H=(x,z)=>footprint(city,x,z);
  const land=(x,z)=>Math.max(0,H(x,z));
  const night=city.key==='sz';
  const positions=[], colors=[];
  const color=new T.Color();
  const terrainTint=new T.Color(city.hill);
  function patch(x,y,z,w,d){
    if(H(x,z)>=0)add('shadow',x,y+.08,z,w,1,d,0xffffff);
  }
  function terrainTriangle(points){
    const heights=points.map(([x,z])=>H(x,z));
    const average=heights.reduce((a,b)=>a+b,0)/3;
    const low=heights.some(h=>h<0);
    for(let i=0;i<3;i++){
      const [x,z]=points[i];
      const grain=.91+.066*Math.sin(x*.036+Math.cos(z*.039)*2)+.048*Math.sin(z*.087-x*.067);
      color.set(low?city.bank:city.ground).lerp(terrainTint,low?.08:clamp((average-6)/23,0,1));
      color.multiplyScalar(grain);
      positions.push(x,heights[i],z);
      colors.push(color.r,color.g,color.b);
    }
  }
  for(let z=mapBounds.north;z<mapBounds.south;z+=10) for(let x=mapBounds.west;x<mapBounds.east;x+=10){
    terrainTriangle([[x,z],[x,z+10],[x+10,z]]);
    terrainTriangle([[x+10,z],[x,z+10],[x+10,z+10]]);
  }
  const geo=new T.BufferGeometry();
  geo.setAttribute('position',new T.Float32BufferAttribute(positions,3));
  geo.setAttribute('color',new T.Float32BufferAttribute(colors,3));
  geo.computeVertexNormals();
  const ground=new T.Mesh(geo,new T.MeshStandardMaterial({vertexColors:true,roughness:1}));
  ground.receiveShadow=true;
  root.add(ground);
  add('box',-125,-14.5,0,1450,13,1110,0x52604e);
  add('box',-125,-5.6,0,1449,4.9,1109,city.water);
  const waterMaterial=new T.MeshStandardMaterial({color:city.water,roughness:.32,metalness:.24});
  waterMaterial.onBeforeCompile=shader=>{
    shader.vertexShader='varying vec3 surfacePoint;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nsurfacePoint=(modelMatrix*vec4(position,1.)).xyz;');
    shader.fragmentShader='varying vec3 surfacePoint;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`
      #include <color_fragment>
      vec2 p=surfacePoint.xz;
      float swell=sin(p.y*.26+p.x*.075+sin(p.x*.067)*2.4);
      float current=sin(p.y*.99-p.x*.23+sin(p.x*.49)*1.7);
      float glint=pow(max(0.,swell*.55+current*.45),7.)*(.52+.48*sin(p.x*.087+p.y*.137));
      diffuseColor.rgb*=.94+.037*swell+.024*current;
      diffuseColor.rgb+=glint*vec3(.105,.13,.12);
    `);
  };
  const water=new T.Mesh(new T.PlaneGeometry(1449,1109).rotateX(-pi/2),waterMaterial);
  water.position.set(-125,-3,0);root.add(water);
  const roadColor=city.roads;
  function beam(a,b,width,color,lit=false){
    const u=new T.Vector3(...a), v=new T.Vector3(...b);
    const dir=v.clone().sub(u), m=u.addScaledVector(dir,.5);
    const pitch=Math.atan2(dir.y,Math.hypot(dir.x,dir.z));
    add('box',m.x,m.y,m.z,width,width,dir.length(),color,Math.atan2(dir.x,dir.z),-pitch,0,lit);
  }
  function road(x,z,xx,zz,width,lines,grid=false){
    const dist=Math.hypot(xx-x,zz-z), n=Math.ceil(dist/14);
    for(let i=0;i<n;i++){
      const a=i/n,b=(i+1)/n;
      const p=[mix(x,xx,a),0,mix(z,zz,a)], q=[mix(x,xx,b),0,mix(z,zz,b)];
      p[1]=H(p[0],p[2])+.7;q[1]=H(q[0],q[2])+.7;
      if(p[1]<0||q[1]<0||Math.abs(p[1]-q[1])>7)continue;
      const slope=Math.atan2(q[1]-p[1],dist/n);
      const cx=(p[0]+q[0])/2,cy=(p[1]+q[1])/2,cz=(p[2]+q[2])/2;
      if(grid&&city.key==='nj'&&(cy>18||city.landmarks.some(m=>Math.hypot(cx-m.x,cz-m.z)<m.span*.33)))continue;
      const turn=Math.atan2(xx-x,zz-z);
      add('box',cx,cy-.24,cz,width+1.9,.35,dist/n+.45,0xa7a69a,turn,-slope);
      add('box',cx,cy,cz,width,.48,dist/n+.35,roadColor,turn,-slope);
      if(lines&&i%9===3&&width>7){
        for(let j=-3;j<=3;j++){
          const offset=j*.81;
          add('box',cx+Math.cos(turn)*offset,cy+.26,cz-Math.sin(turn)*offset,.38,.06,2.2,0xcec9b6,turn,-slope);
        }
        if(grid&&i%18===3){
          const vx=cx+Math.cos(turn)*width*.26,vz=cz-Math.sin(turn)*width*.26;
          add('box',vx,cy+.76,vz,1.35,.84,2.95,[0x426c7b,0xd1c9aa,0xa65340][i%3],turn);
          add('box',vx,cy+1.28,vz,1.18,.35,1.35,0x626d71,turn);
        }
      }
      if(lines&&i%2===0)add('box',cx,cy+.3,cz,.66,.12,4,night?0x73aaf1:0xbab28c,Math.atan2(xx-x,zz-z),-slope,0,night);
    }
  }
  function box(x,y,z,w,h,d,c,ry=0){add('box',x,y+h/2,z,w,h,d,c,ry);}
  function roof(x,y,z,w,d,h,c,ry=0){
    add('foot',x,y+h*.09,z,w*1.05,h*.18,d*1.05,c,ry);
    add('roof',x,y+h*.53,z,w,h*.88,d,c,ry);
    box(x,y+h*.9,z,w*.35,1.1,1.1,c,ry);
  }
  const roofSurfaces=new Map();
  function tiledRoof(x,y,z,w,d,h,c){
    const eave = (u,t) => [x+u*w*.5*(1-t*.64),y+h*(.26*t+.74*t*t)+.75*Math.abs(u)**7*(1-t)**3,z];
    const vertices=[];
    for(const side of [-1,1]){
      const point=(u,t)=>{const v=eave(u,t);v[2]+=side*d*.5*(1-t);return v;};
      for(let j=0;j<8;j++){
        const a=j/8,b=(j+1)/8;
        for(let i=0;i<14;i++){
          const u=-1+i/7,v=u+1/7;
          vertices.push(...point(u,a),...point(v,a),...point(v,b),...point(u,a),...point(v,b),...point(u,b));
        }
      }
      const tiles=Math.ceil(w/.78);
      for(let i=0;i<=tiles;i++){
        const u=-1+2*i/tiles;
        for(let j=0;j<6;j++){
          const a=point(u,j/6),b=point(u,(j+1)/6);
          a[1]+=.10;b[1]+=.10;
          beam(a,b,.15,i%4===0?c:color.set(c).multiplyScalar(.71+i%3*.08).getHex());
        }
        add('sphere',...point(u,0),.28,.29,.33,c);
      }
    }
    for(const side of [-1,1])for(let j=0;j<8;j++){
      const hip=(u,t)=>{
        const p=eave(side,t);
        p[2]+=u*d*.5*(1-t);
        p[1]-=.75*(1-u*u)*(1-t)**3;
        return p;
      };
      const a=j/8,b=(j+1)/8;
      for(let i=0;i<8;i++){
        const u=-1+i/4,v=u+.25;
        vertices.push(...hip(u,a),...hip(v,a),...hip(v,b),...hip(u,a),...hip(v,b),...hip(u,b));
      }
    }
    if(!roofSurfaces.has(c))roofSurfaces.set(c,[]);
    roofSurfaces.get(c).push(vertices);
    box(x,y+h-.1,z,w*.39,.64,.53,c);
    for(const side of [-1,1])add('cone',x+side*w*.19,y+h+.73,z,.8,1.45,.51,c,0,0,-side*.47);
  }
  function masonry(x,y,z,w,h,d,c){
    box(x,y,z,w,h,d,c);
    const tint=new T.Color(c);
    for(let row=0;row<Math.ceil(h/.65);row++){
      for(let col=0;col<Math.ceil(w/1.53);col++){
        const xx=-w/2+.76+col*1.53+(row%2)*.7;
        if(xx>w/2-.45)continue;
        box(x+xx,y+row*.65+.09,z+d/2,1.38,.52,.17,tint.set(c).multiplyScalar(.85+((row*7+col*13)%9)*.038).getHex());
      }
    }
  }
  function archedPortal(x,y,z,w,h,frame,inside){
    box(x,y,z,w,h-w*.5,.29,inside);
    add('sphere',x,y+h-w*.5,z,w,w,.27,inside);
    const rise=h-w*.5;
    arcSpan(x,y+rise,z+.18,w+.22,w*.5+.13,4,frame);
    for(const side of [-1,1])box(x+side*w*.52,y,z+.18,.35,rise,.42,frame);
  }
  function rail(x,y,z,xx,zz,count,c){
    beam([x,y+1.32,z],[xx,y+1.32,zz],.28,c);
    beam([x,y+.35,z],[xx,y+.35,zz],.16,c);
    for(let j=0;j<=count;j++){
      const a=j/count;
      box(mix(x,xx,a),y,mix(z,zz,a),.32,1.5,.34,c);
    }
  }
  let landmarkPass=false;
  function hall(x,y,z,w,d,h,r=ink,wall=red,detail=false){
    box(x,y,z,w+5,2,d+5,stone);
    box(x,y+2,z,w*.87,h,d*.79,wall);
    for(let i=-2;i<=2;i++){
      box(x+i*w*.18,y+2,z+d*.409,1.12,h+1,1.25,wall===red?0x782e23:ink);
      if(i<2)box(x+(i+.5)*w*.18,y+3,z+d*.412,w*.11,h*.62,.35,0x312b24);
    }
    if(detail||landmarkPass){
      tiledRoof(x,y+h+2,z,w*1.06,d*1.12,h*.58,r);
      for(let i=-4;i<=4;i++){
        const xx=x+i*w*.105;
        box(xx,y+h+1.1,z+d*.433,.58,1,.96,0x753d29);
        box(xx,y+h+1.65,z+d*.454,1.2,.33,1.05,gold);
      }
      for(let i=-2;i<2;i++)for(let j=-1;j<=1;j++)
        box(x+(i+.5)*w*.18+j*.57,y+3,z+d*.422,.10,h*.61,.11,0x90684c);
    }else roof(x,y+h+2,z,w*1.04,d*1.12,h*.63,r);
  }
  function tree(x,z,h,y=H(x,z),type=0){
    if(y<0)return;
    const c=[0x406948,0x507d4c,0x658652,0x758f5c,0x355e45,0x9b613f,0xac7345];
    box(x,y,z,h*.12,h*.61,h*.12,0x65513b);
    const foliage=c[Math.floor(rng()*(type===1?2:5))+(type===1?5:0)];
    const angle=rng()*pi;
    patch(x+.6,y,z+.25,h*1.25,h*1.13);
    if(type===2){
      for(let i=0;i<3;i++)add('cone',x,y+h*(.53+i*.16),z,h*(.7-i*.17),h*.47,h*(.7-i*.17),foliage,angle);
    }else{
      add('canopy',x,y+h*.72,z,h*.88,h*.83,h*.78,foliage,angle);
      for(let i=0;i<3;i++)add('oct',x+Math.cos(angle+i*2.09)*h*.28,y+h*.67,z+Math.sin(angle+i*2.09)*h*.27,h*.49,h*.58,h*.49,
        color.set(foliage).multiplyScalar(.82+i*.17).getHex(),angle+i);
    }
  }
  function courtyard(x,y,z,w,d,c=0xa19b81){
    box(x,y-.35,z,w,.58,d,c);
    if(landmarkPass)for(let i=-3;i<=3;i++){
      box(x+i*w/8,y+.23,z,.12,.025,d*.92,0x898679);
      box(x,y+.23,z+i*d/8,w*.95,.026,.12,0x898679);
    }
    for(const zz of [-1,1])box(x,y+.25,z+zz*d/2,w,1.2,1.35,stone);
  }
  function stair(x,y,z,w,count,step=3,rise=.6){
    for(let i=0;i<count;i++)box(x,y+i*rise,z-i*step,w,rise+.22,step+.25,stone);
  }
  function pagoda(x,y,z,w,n,rc,wc,h=4,oct=true){
    box(x,y,z,w+4,2,w+4,stone);
    for(let i=0;i<n;i++){
      const size=w*(1-i/(n+2)*.74), base=y+2+i*(h+2.3);
      add(oct?'cyl':'box',x,base+h/2,z,size*.77,h,size*.77,wc);
      if(oct)add('octRoof',x,base+h+1.25,z,size,2.5,size,rc);
      else roof(x,base+h,z,size,size,2.65,rc);
      for(let side=0;side<4;side++){
        const a=side*pi/2;
        add('box',x+Math.sin(a)*size*.39,base+h*.37,z+Math.cos(a)*size*.39,1.5,h*.53,.31,ink,a);
        add('box',x+Math.sin(a)*size*.42,base+h*.09,z+Math.cos(a)*size*.42,2.25,.24,.32,stone,a);
      }
      if(!oct)for(let row=1;row<h/.62;row++)box(x,base+row*.61,z,size*.784,.12,size*.784,0x907d65);
    }
    add('cone',x,y+2+n*(h+2.3)+2,z,2.4,7,2.4,gold);
  }
  function tower(x,y,z,w,d,h,c,style='glass'){
    box(x,y,z,w*1.11,2,d*1.11,0xa5a58f);
    patch(x,y,z,w*1.74,d*1.78);
    if(h>=16)add('facade',x,y+2+h/2,z,w,h,d,c);
    else box(x,y+2,z,w,h,d,c);
    if(h>22){
      box(x,y+h+3,z-d*.14,w*.27,1.45,d*.28,0x777e79);
      box(x+w*.21,y+h+3,z+d*.13,w*.16,1.1,d*.19,0xb1b0a1);
    }
    box(x,y+h+2,z,w*.63,2,d*.63,style==='glass'?0x9aaca4:stone);
    const line=style==='glass'?0xa2b1a6:0x707a6f;
    const bands=Math.ceil(h/8);
    if(h>=14)for(let i=1;i<bands;i++){
      box(x,y+2+h*i/bands,z,w+.35,.43,d+.35,line);
      if(night&&i%2===0)add('box',x,y+2+h*i/bands+.7,z+d/2+.2,w*.68,.4,.42,i%4?0x57e8ee:0xf465c2,0,0,0,true);
    }
    if(h>32)for(let i=-1;i<=1;i++){
      box(x+i*w*.26,y+3,z+d/2+.21,.45,h-2,.45,line);
      box(x+w/2+.2,y+3,z+i*d*.26,.45,h-2,.45,line);
    }
  }
  function walls(path,h=8){
    for(let i=0;i<path.length-1;i++){
      const [x,z]=path[i], [xx,zz]=path[i+1];
      const n=Math.ceil(Math.hypot(xx-x,zz-z)/6), ry=Math.atan2(xx-x,zz-z);
      for(let j=0;j<n;j++){
        const a=(j+.5)/n,X=mix(x,xx,a),Z=mix(z,zz,a),Y=land(X,Z);
        box(X,Y,Z,5.5,h,Math.hypot(xx-x,zz-z)/n+.25,grey,ry);
        box(X,Y+h,Z,5.9,1.35,2.8,0x9d9d85,ry);
      }
    }
  }
  function arcSpan(x,y,z,width,height,depth,c,rotation=0){
    add('arch',x,y,z,width,height*2,depth,c,rotation);
  }
  function stoneBridge(x,y,z,width,acrossX=true){
    const ry=acrossX?0:pi/2;
    arcSpan(x,y,z,width,width*.21,44,stone,ry);
    box(x,y+width*.22,z,acrossX?width*.69:8,1.1,acrossX?8:width*.69,pale);
  }
  function bridge(x,z,w,y,kind){
    const eye=kind==='eye';
    box(x,y,z,w,eye?2.6:4.2,eye?8:13,eye?pale:0x747d77);
    box(x,y+3.5,z,w,1,eye?8:13,eye?0xbac8bb:0xbcb497);
    if(kind==='truss'){
      box(x,y-8,z,w,2,11,0x7d8a81);
      for(const side of [-1,1]){
        rail(x-w/2,y+4.4,z+side*6.32,x+w/2,z+side*6.32,72,0x92968a);
        box(x,y+4.54,z+side*2.65,w,.07,.12,0xd5c898);
        box(x,y-5.97,z+side*2.05,w,.23,.24,0x303839);
      }
      for(let j=-7;j<=7;j++)box(x+j*12,y+4.57,z,.15,.08,2.8,pale);
      for(let i=-w/2+12;i<w/2-3;i+=14){
        for(const s of [-1,1]){
          beam([x+i,y-6,z+6*s],[x+i+14,y+2,z+6*s],.75,0xd0c3a1);
          beam([x+i,y+2,z+6*s],[x+i+14,y-6,z+6*s],.7,0x9ea99b);
        }
        if(Math.round((i+w/2-12)/14)%3===0) box(x+i,-4,z,4,y-4,9,stone);
      }
      for(const s of [-1,1]) for(const t of [-1,1]){
        const X=x+s*(w/2-8),Z=z+t*10;
        masonry(X,-2,Z,10,y+26,9,0xd0ba92);
        box(X,y+8,Z,11.2,1.1,9.9,stone);
        box(X,y+17,Z,10.9,1.02,9.6,stone);
        box(X,y+24,Z,12,2.4,10,stone);
        for(let j=-1;j<=1;j++)archedPortal(X+j*2.48,y+13,Z+4.65,1.23,4.5,0xdbcaa8,0x44443b);
        box(X,y+26.4,Z,11.7,.7,9.8,pale);
        for(let i=-1;i<=1;i++){box(X+i*2.3,y+27,Z,.45,6,.45,grey);box(X+i*2.3+1,y+31,Z,2,2,.4,0xb13c2e);}
      }
    }else{
      for(const s of [-1,1]){
        const X=x+s*w*.22;
        box(X,-4,z,4,y+5,9,stone);
        if(eye){
          for(let j=0;j<44;j++){
            const p=a=>[X+s*Math.sin(a)*3.4+Math.cos(a)*2.4,y+15.1+Math.sin(a)*13.8,z+Math.cos(a)*6.7];
            beam(p(j*pi/22),p((j+1)*pi/22),.90,pale);
          }
          box(X,y+1.8,z,4,2.2,10,0xa8aaa3);
        }
        else box(X,y,z,4,39,5,pale);
        for(let i=-4;i<=4;i++)for(const t of [-1,1])
          beam([X,y+(eye?22:35),z+t*3],[X+i*8,y+3,z+t*4],.55,pale);
      }
    }
  }
  const boatPositions=[];
  function boat(x,z,angle,size=1,lantern=false){
    add('box',x,-.9,z,6*size,2.6*size,21*size,lantern?0x693c2a:ink,angle);
    add('box',x,1.1*size,z,4.8*size,2*size,11*size,lantern?gold:pale,angle);
    add('box',x,2.7*size,z,5.4*size,.7*size,12*size,lantern?red:grey,angle);
    if(!lantern)boatPositions.push([x,z,angle,size]);
  }

  if(city.key==='cq'){
    const viaducts=[
      [[-420,45,153],[-290,55,116],[-142,54,76],[10,57,66],[142,63,71],[325,62,52]],
      [[-243,72,-127],[-202,79,-51],[-161,78,47],[-160,71,120],[-126,64,199],[-39,58,301]],
      [[-370,53,140],[-287,58,162],[-211,62,152],[-172,64,122],[-161,68,60]]
    ];
    for(const line of viaducts)for(let i=0;i<line.length-1;i++){
      const a=line[i],b=line[i+1];
      const mid=a.map((v,j)=>(v+b[j])/2), ground=Math.max(-4,H(mid[0],mid[2]));
      beam(a,b,5,0xb0a590);
      beam([a[0],a[1]+2.7,a[2]],[b[0],b[1]+2.7,b[2]],4.3,roadColor);
      if(mid[1]-ground>6)box(mid[0],ground,mid[2],3.1,mid[1]-ground,4,stone);
    }
  }
  function promenade(points,alongX){
    for(let i=1;i<points.length;i++){
      const [x,z]=points[i-1],[xx,zz]=points[i];
      const y=H(x,z),yy=H(xx,zz);
      if(y<0||yy<0||Math.abs(y-yy)>7)continue;
      road(x,z,xx,zz,4.3,false);
      if(i%3===1)tree(x+(alongX?0:3),z+(alongX?-3:0),6,y);
      if(i%4===0){
        box(x,y,z,.26,4.4,.26,0x576269);
        add('sphere',x,y+4.48,z,.72,.62,.72,night?0x80d2ed:pale,0,0,0,night);
      }
    }
  }
  if(city.key==='sh'){
    const curve=z=>-40+.46*z-125*Math.cos(z/159);
    for(const side of [-1,1])promenade(Array.from({length:58},(_,i)=>{
      const z=-495+i*17;return [curve(z)+side*86,z];
    }),false);
    for(let i=0;i<6;i++){const z=-425+i*157;boat(curve(z),z,-.23,1.2);}
  }
  if(city.key==='sz'){
    promenade(Array.from({length:75},(_,i)=>{const x=-760+i*17;return [x,280+82*Math.cos(x/178)];}),true);
    for(let i=0;i<7;i++){
      const x=-540+i*158,z=324+82*Math.cos(x/178);
      if(H(x,z)<0)boat(x,z,pi/2,.67);
    }
  }
  if(city.key==='jn'){
    for(let i=0;i<7;i++){const x=-545+i*143,z=58+18*Math.sin(x/85);boat(x,z,pi/2,.52,true);}
    for(const side of [-1,1])promenade(Array.from({length:75},(_,i)=>{
      const x=-760+i*17;return [x,58+18*Math.sin(x/85)+side*22];
    }),true);
  }
  if(city.key==='xa'){
    road(-211,0,214,0,11,true);road(0,-152,0,139,11,true);
    for(let i=-5;i<=5;i++){
      for(const side of [-1,1])tree(i*16,side*11,6);
    }
  }
  const step=settings.block;
  for(let x=-810;x<552;x+=step){
    road(x,-501,x,526,step*.15,Math.round((x+810)/step)%4===0,true);
  }
  for(let z=-501;z<528;z+=step){
    road(-810,z,550,z,step*.15,Math.round((z+501)/step)%4===0,true);
  }
  if(city.key==='nj'){
    road(-82,-437,-28,326,11,true);road(-415,20,466,20,10,true);
    walls([[-386,-310],[-337,-256],[-243,-239],[-202,-156],[-233,-45],[-252,39],[-184,112],[-115,217],[-8,230],[86,227],[179,191],[219,114]],5.5);
    for(let i=0;i<13;i++){
      const z=-480+i*73, x=-570+.19*z+33*Math.sin(z/145)+(rng()-.5)*135;
      if(H(x,z)<0&&Math.abs(z+320)>24)boat(x,z,-.28,.75+rng()*.52);
    }
    for(const [x,z] of boatPositions)for(let i=0;i<4;i++)
      add('box',x-1+i*.8,-2.91,z-14-i*3,1.6,.04,6.6,0x74a5a0,-.24);
  }
  for(let x=-810+step*.48;x<557;x+=step)for(let z=-501+step*.48;z<527;z+=step){
    for(let a=-1;a<=1;a+=2)for(let b=-1;b<=1;b+=2){
      const X=x+a*step*.19,Z=z+b*step*.19,Y=H(X,Z);
      const r=rng(), k=rng();
      if(Y<0||city.landmarks.some(m=>Math.hypot((X-m.x),Z-m.z)<m.span*.43))continue;
      const nearHill=city.key==='nj'&&((X>200&&Z< -41)||Y>20||Z>456&&X<0);
      const riverPark=city.key==='nj'&&Math.abs(X-(-570+.19*Z+33*Math.sin(Z/145)))<132;
      if(nearHill||riverPark||r>settings.density/100){
        if(k<settings.trees/100)tree(X,Z,7+k*8,Y,X>420&&Z< -330?1:0);
        continue;
      }
      const core=city.key==='nj'?.24+.69*Math.exp(-((X+42)**2/25000+(Z+11)**2/36500))+.53*Math.exp(-((X+299)**2/12000+(Z-325)**2/17500)):city.key==='sh'?Math.max(.19,.99-Math.hypot(X-130,Z-42)/580):.49;
      const old=city.key==='nj'&&Z>85&&Z<292&&X> -185&&X<204 || city.key==='jn'||city.key==='xa';
      const h=old?5+settings.height*.16*k:4+settings.height*core*(.17+k*k*1.6);
      const w=step*(.21+rng()*.12),d=step*(.21+rng()*.12);
      const c=city.build[Math.floor(rng()*city.build.length)];
      if(old){
        patch(X,Y,Z,w*1.64,d*1.67);
        box(X,Y,Z,w,h,d,c);
        roof(X,Y+h,Z,w*1.11,d*1.1,2.2+k,city.key==='xa'?0x6d5650:ink);
        for(let j=-1;j<=1;j++){
          box(X+j*w*.26,Y+h*.28,Z+d*.5,w*.15,h*.42,.23,0x55524a);
          if(city.key==='jn')box(X+j*w*.26,Y+h*.25,Z+d*.516,w*.18,.21,.46,0xa8a096);
        }
        if(city.key==='jn'&&k>.45){
          box(X+w*.45,Y,Z,1,h+1.28,d*1.03,pale);
          box(X+w*.45,Y+h+1.28,Z,1.16,.27,d*.71,ink);
        }
      }
      else tower(X,Y,Z,w,d,h,c,h>19?'glass':'stone');
    }
  }
  if(city.key==='nj'){
    for(let i=0;i<740;i++){
      const x=194+rng()*385,z=-452+rng()*445;
      if(land(x,z)>11&&!city.landmarks.some(m=>m.id!=='purple'&&Math.hypot(x-m.x,z-m.z)<m.span*.35)&&rng()<settings.trees/100) tree(x,z,5+rng()*11,H(x,z),x>450&&z< -323?1:2);
    }
    for(let i=0;i<105;i++){
      const x=-227+rng()*335,z=331+rng()*212;
      if(land(x,z)>10&&!city.landmarks.some(m=>Math.hypot(x-m.x,z-m.z)<m.span*.37)&&rng()<settings.trees/100) tree(x,z,6+rng()*10);
    }
  }

  landmarkPass=true;
  for(const m of city.landmarks){
    const {x,z,id}=m;
    const y=land(x,z)+.7;
    let anchor=m.y;
    switch(id){
      case 'bridge':
        bridge(x,z,218,14,'truss');
        box(x-128,10,z,41,4,13,roadColor);box(x+123,10,z,29,4,13,roadColor);
        break;
      case 'eye':
        bridge(x,z,97,6,'eye');
        for(const side of [-1,1])rail(x-48,10,z+side*3.9,x+48,z+side*3.9,48,0xd1d7cf);
        break;
      case 'yue':
        courtyard(x,y,z,48,39);
        hall(x,y,z,29,23,10,0x3c6263);hall(x,y+14,z,21,17,7,0x426d70);
        hall(x,y+24,z,15,13,5,0x426d70);stair(x,y-5,z+29,11,7,2,.69);
        anchor=y+35;break;
      case 'green':
        for(let i=0;i<3;i++){
          const Z=z-25+i*17,X=x+70+Math.sin(i)*6,Y=land(X,Z);
          courtyard(X,Y,Z,12,10,0x9da284);
          rail(X-6,Y+.25,Z+5,X+6,Z+5,7,stone);
        }
        for(let i=0;i<13;i++)tree(x-19+rng()*38,z-31+i*5,10);
        for(let i=0;i<8;i++)tree(x+80,z-30+i*8,8);
        hall(x+75,land(x+75,z),z,14,10,4,jade,pale);anchor=8;break;
      case 'mausoleum': {
        const granite=0xd7cfbd, shadow=0x2a302e;
        for(let flight=0;flight<5;flight++){
          const Y=y-13+flight*3.3,Z=z+42-flight*10.7;
          stair(x,Y,Z,21,9,.93,.36);
          box(x,Y+2.9,Z-8.9,23,.43,2.5,granite);
          for(const side of [-1,1]){
            beam([x+side*11,Y+.4,Z+.55],[x+side*11,Y+3.56,Z-9],.52,granite);
            for(let j=0;j<5;j++)box(x+side*11,Y+j*.66,Z-j*1.84,.56,1,.57,granite);
          }
        }
        box(x,y+3.1,z-14,37,2.5,23,granite);
        const facadeZ=z-5;
        box(x,y+5.6,z-14,29,11.8,16,granite);
        for(let j=-1;j<=1;j++)archedPortal(x+j*7,y+6,facadeZ-1,4.6,8.3,0xc4b9a6,shadow);
        for(const side of [-1,1]){
          for(let j=0;j<2;j++){
            box(x+side*(12.1+j*1.15),y+5.9,facadeZ-1,.63,10.7,.82,pale);
          }
          box(x+side*15,y+6,z-15,5,6,9,granite);
          tiledRoof(x+side*15,y+12,z-15,6,10,2.4,blue);
          rail(x+side*17,y+5.4,z-23,x+side*17,z-4,9,granite);
          for(let j=0;j<6;j++){
            const zz=z+43-j*9.4,xx=x+side*(16+j*.45);
            tree(xx,zz,10+j%2*1.7,H(xx,zz),2);
          }
        }
        box(x,y+16.9,z-14,30.3,1.25,17.3,pale);
        tiledRoof(x,y+18.25,z-14,32,18,6.5,blue);
        const gateY=y-13,gateZ=z+45;
        for(const dx of [-12,-5,5,12])box(x+dx,gateY,gateZ,1.85,6.5,2,granite);
        box(x,gateY+5.5,gateZ,27,1.3,3,granite);
        tiledRoof(x,gateY+6.8,gateZ,28,5,2.5,blue);
        anchor=y+26;break;}
      case 'ming':
        courtyard(x,y,z,57,48);
        box(x,y,z-13,42,10,18,red);
        hall(x,y+10,z-13,31,16,8,gold,red,true);
        stair(x,y-5,z+36,13,12,2,.55);
        for(let i=-2;i<=2;i++)box(x+i*7,y,z+14,1.7,6,2,red);
        roof(x,y+6,z+14,39,8,4,gold);
        for(const s of [-1,1])for(let i=0;i<3;i++){
          box(x+s*8,land(x+s*8,z+24+6*i),z+24+6*i,2.5,2.3,3.5,grey);
          add('oct',x+s*8,land(x+s*8,z+24+6*i)+2.8,z+24+6*i,2.5,2.8,3.7,stone);
        }
        anchor=y+27;break;
      case 'linggu':pagoda(x,y,z,16,9,ink,stone,3.6);anchor=y+59;break;
      case 'villa':
        courtyard(x,y,z,36,31);
        hall(x,y,z,23,17,7,0x327757,pale);
        hall(x,y,z-9,18,10,7,0x3e8560,pale);
        for(let i=0;i<17;i++){
          const a=i/17*2*pi,tx=x+24*Math.cos(a),tz=z+26*Math.sin(a);
          tree(tx,tz,7.5);
        }
        for(let i=-3;i<=3;i++){
          const X=x+i*3;
          box(X,y+2.8,z+8.7,1.45,1.8,.31,0x607e76);
          box(X,y+2.56,z+8.84,1.9,.26,.47,pale);
        }
        anchor=y+16;break;
      case 'temple':
        for(let i=0;i<3;i++)hall(x-15+i*11,y-3+i*3,z+16-i*7,16,10,6,ink,0xc5a153);
        pagoda(x+7,y+6,z-4,15,7,ink,0xc9a454,3.7);
        for(let i=0;i<7;i++){
          const W=15*(1-i/9*.74),Y=y+8+i*6;
          for(let j=0;j<8;j++){
            const a=j*pi/4;
            add('sphere',x+7+Math.cos(a)*W*.47,Y+3.5,z-4+Math.sin(a)*W*.47,.47,.47,.47,gold);
          }
        }
        anchor=y+53;break;
      case 'xuanwu':
        for(const [tx,tz] of [[94,-265],[22,-285],[116,-225]]){
          hall(tx,land(tx,tz)+1,tz,14,10,4,jade,pale);
          for(let i=0;i<9;i++){
            const a=i*pi*2/9;tree(tx+12*Math.cos(a),tz+10*Math.sin(a),7);
          }
        }
        beam([22,1.5,-285],[94,1.5,-265],3,stone);
        beam([94,1.5,-265],[116,1.5,-225],3,stone);
        for(const side of [-1,1]){
          rail(22,1.6,-285+side*1.5,94,-265+side*1.5,23,stone);
          rail(94+side*1.3,1.6,-265,116+side*1.3,-225,15,stone);
        }
        for(let i=0;i<3;i++)boat(50+i*26,-311+i*4,.75,.55);
        anchor=7;break;
      case 'wall':
        walls([[77,-179],[113,-177],[146,-175],[173,-185],[194,-207],[205,-234]],7);
        const gateY=land(x,-175);
        masonry(x,gateY,-175,20,7,7,grey);
        archedPortal(x,gateY,-171.3,4.1,5.4,stone,0x31372f);
        hall(x,gateY+7,-175,17,12,5,ink,red);anchor=land(x,-175)+16;break;
      case 'confucius': {
        const waterZ=164+32*Math.sin(x/139)+13*Math.sin(x/57);
        courtyard(x,y,z-6,44,34);hall(x,y,z-8,25,15,8,ink,red,true);
        hall(x-21,y,z-3,11,9,4,ink,pale);hall(x+21,y,z-4,11,9,4,ink,pale);
        stoneBridge(x+3,0,waterZ,28,false);
        for(const side of [-1,1]){
          const zz=waterZ+side*10.2;
          rail(x-23,1.0,zz,x+24,zz,20,stone);
          for(let i=0;i<12;i++)box(x-23+i*4,-2.7,zz,3.84,3.8,.55,0x999487);
        }
        box(x,land(x,waterZ+14),waterZ+14,40,6,1.8,red);
        roof(x,7,waterZ+14,41,3,1.4,ink);
        for(let i=-2;i<=2;i++){
          const X=x+i*7;
          add('sphere',X,5.2,z+7,1.85,2.3,1.85,0xff7335,0,0,0,true);
        }
        for(let i=0;i<3;i++){const X=x-54+i*21;boat(X,164+32*Math.sin(X/139)+13*Math.sin(X/57),pi/2,.59,true);}
        anchor=y+21;break;}
      case 'gongyuan':
        courtyard(x,y,z,53,39);hall(x,y,z-8,15,12,7,ink,red);hall(x,y+11,z-8,10,9,5,ink,red);
        for(let row=0;row<3;row++)for(let i=-3;i<=3;i++){
          box(x+i*5,y,z+1+row*5,4.3,2.4,3.5,pale);
          roof(x+i*5,y+2.4,z+1+row*5,4.8,4,1.3,ink);
        }
        anchor=y+21;break;
      case 'zhonghua':
        for(let i=-1;i<=1;i++) {
          const Z=z+i*13;
          for(const s of [-1,1])masonry(x+s*17,y,Z,24,7+i,4,grey);
          box(x,y+5+i,Z,12,2,4,grey);
          for(let k=0;k<=12;k++){
            const a=k*pi/12;
            add('box',x+Math.cos(a)*5.1,y+.55+Math.sin(a)*(4.9+i),Z+2.08,.69,.66,.49,stone,0,0,a-pi/2);
          }
          for(let t=-6;t<=6;t++)box(x+t*4,y+7+i,Z,2.2,1.4,4.5,grey);
        }
        for(const s of [-1,1]){
          box(x+s*27,y,z,5,7,31,grey);
          for(let i=-4;i<=4;i++)box(x+s*27,y+7,z+i*3.2,5.1,1.2,1.65,grey);
          for(let i=0;i<10;i++)box(x+s*21,y+i*.64,z+18-i*1.05,5,.65,1.1,stone);
        }
        hall(x,y+8,z-14,18,11,5,ink,red,true);
        anchor=y+19;break;
      case 'laomendong':
        for(let i=-2;i<=2;i++)for(let j=-1;j<=1;j++){
          const X=x+i*8,Z=z+j*12;
          box(X,y,Z,6,4.6,9,pale);
          roof(X,y+4.6,Z,6.9,9.5,2.5,ink);
          box(X+2.9,y,Z,.8,5.9,9.1,pale);
          box(X+2.9,y+5.9,Z-1,.85,1.2,6.1,pale);
        }
        for(let i=-3;i<=3;i++){
          box(x+i*5,y+.12,z+6,4.8,.14,1.8,0x928e80);
          box(x+i*5,y+.12,z-6,4.8,.14,1.8,0x928e80);
        }
        anchor=y+12;break;
      case 'pagoda': {
        const towerGlass = new T.MeshPhysicalMaterial({color:0x75c8c6,metalness:.25,roughness:.17,transparent:true,opacity:.59,side:T.DoubleSide});
        box(x,y,z,30,2,27,grey);
        for(let i=0;i<9;i++){
          const size=17-i*1.24, Y=y+2+i*5.7;
          const shell = new T.Mesh(geos.octRoof,towerGlass);
          shell.position.set(x,Y+2.8,z);shell.scale.set(size,5.3,size);root.add(shell);
          add('cyl',x,Y+.3,z,size,0.7,size,0x7aafaa);
          add('cyl',x,Y+2.3,z,3.1,4.5,3.1,0xb1cbc1);
          for(let j=0;j<8;j++){
            const a=j*pi/4,r=size*.37;
            beam([x+Math.cos(a)*r,Y,z+Math.sin(a)*r],[x+Math.cos(a)*r*.74,Y+5,z+Math.sin(a)*r*.74],.33,pale);
          }
        }
        add('cone',x,y+56,z,2.6,9,2.6,0xd7b565);anchor=y+61;break;}
      case 'chaotian':
        courtyard(x,y,z,45,41);stair(x,y,z+19,18,9,2,.51);
        hall(x,y+4,z-6,28,18,9,gold,red);
        for(let i=-2;i<=2;i++)box(x+i*5,y,z+21,1,5,1,red);
        roof(x,y+5,z+21,25,4,2.4,gold);anchor=y+23;break;
      case 'gulous':
        masonry(x,y,z,29,8,21,0x945243);
        archedPortal(x,y,z+10.6,8.3,6.2,stone,0x42352e);
        hall(x,y+8,z,24,16,7,gold,red);
        hall(x,y+18,z,16,11,4,gold,red);anchor=y+27;break;
      case 'president':
        courtyard(x,y,z,41,49);
        box(x,y,z+16,28,8,8,0xe0d4bd);box(x,y+8,z+16,30,1.2,8.7,stone);
        archedPortal(x,y+.1,z+20.1,7.1,6.4,0xc3b59c,ink);
        for(let i=-3;i<=3;i++)box(x+i*.83,y+.31,z+20.42,.13,3.9,.2,0x8b8270);
        box(x,y+4.2,z+20.43,6.1,.19,.22,0x8b8270);box(x,y+6.8,z+20.4,11,1.4,.7,0x6c7370);
        for(const s of [-1,1]){
          for(let i=0;i<3;i++)box(x+s*(6+i*3),y+.5,z+21,.8,6,1.4,pale);
          hall(x+s*12,y,z-7,9,24,5,ink,pale);
        }
        hall(x,y,z-20,23,10,5,ink,pale);anchor=y+17;break;
      case 'museum':
        courtyard(x,y,z,53,43);stair(x,y,z+23,26,12,1.7,.48);
        hall(x,y+5,z-6,41,24,11,gold,0xb19374);anchor=y+28;break;
      case 'memorial':
        courtyard(x,y,z,49,39,0x7f817a);
        add('roof',x-6,y+5,z-7,30,10,16,0x5e6362,.46);
        box(x+12,y+.15,z+9,15,.36,18,0x426567);
        for(let i=-5;i<=5;i++)box(x+12+i*1.2,y+.526,z+8+(i%3)*2,.07,.02,4.2,0x6d8680);
        for(let i=0;i<4;i++)box(x-18+i*9,y+.4,z+21,6,.8,.7,0x92958b);
        anchor=y+13;break;
      case 'yuhuatai':
        courtyard(x,y,z,44,38);stair(x,y-3,z+24,17,11,2,.55);
        box(x,y+2,z-5,16,3,13,stone);box(x,y+5,z-5,9,4,8,grey);
        add('foot',x,y+20,z-5,4,22,4,0xa7a59a);
        rail(x-17,y+.24,z-17,x+17,z-17,19,stone);
        box(x,y+30,z-5,4.1,1.1,4.1,stone);anchor=y+33;break;
      case 'zifeng':
        tower(x-6,y,z+1,33,26,42,glass);
        tower(x,y+35,z-4,26,23,52,0x6f9399);
        tower(x+3,y+80,z-7,20,19,34,0x71969a);
        add('foot',x+3,y+120,z-7,19,10,18,0x8ea7a5,.1);
        add('cyl',x+5,y+132,z-7,2.2,22,2.2,pale);
        add('cone',x+5,y+145,z-7,1.8,7,1.8,stone);
        for(let i=0;i<3;i++)beam([x-13+i*6,y+39,z+8],[x-5+i*5,y+108,z+4],.85,0xbec9b9);
        for(let i=0;i<36;i++){
          const Y=y+35+i*2.3,X=x+Math.min(3,i*.13),Z=z-4-Math.min(3,i*.12);
          const W=i<20?26:20,D=i<20?23:19;
          for(let j=0;j<6;j++){
            const tint=[0x284856,0x496e7c,0x779aa5,0x9cb3b4][(i*13+j*7)%4];
            box(X+(j-2.5)*W/7,Y,Z+D/2+.09,W/7-.27,1.82,.21,tint);
            box(X+W/2+.09,Y,Z+(j-2.5)*D/7,.21,1.82,D/7-.27,tint);
          }
        }
        anchor=y+152;break;
      case 'xinjiekou':
        for(const [dx,dz,h,c] of [[-17,-19,84,glass],[15,-23,57,0x719094],[-17,17,64,0x87949a],[18,18,46,0xaaa99a]])
          tower(x+dx,y,z+dz,21,21,h,c);
        road(x-45,z,x+48,z,9,true);road(x,z-43,x,z+47,8,true);anchor=y+88;break;
      case 'olympic':
        add('cyl',x,y+3,z,67,6,40,0xb5b3a4);
        add('cyl',x,y+6.4,z,49,1.2,28,0x6f894f);
        for(const side of [-1,1]){
          box(x,y+7.012,z+side*7.4,30,.05,.19,pale);
          box(x+side*15,y+7.012,z,.19,.05,15,pale);
          box(x+side*11.9,y+7.014,z,.2,.05,6.1,pale);
        }
        box(x,y+7.03,z,.17,.04,14.9,pale);
        for(let i=0;i<64;i++){
          const a=i*pi/32;
          box(x+Math.cos(a)*27,y+6.55,z+Math.sin(a)*15,1.2,.65,.9,i%8<4?0x8b998f:0xa96b57,-a);
        }
        add('ring',x,y+8,z,62,34,33,0xbfc2b4,0,pi/2);
        for(const s of [-1,1]){
          arcSpan(x,y+7,z+s*10,57,29,46,0xb94332,s*.08);
          for(let j=-3;j<=3;j++)beam([x+j*7,y+7+28*Math.sqrt(1-(j*7/28.5)**2),z+s*10],[x+j*7,y+8,z+s*14],.44,pale);
        }
        anchor=y+37;break;
      case 'hexicbd':
        for(const [dx,dz,h] of [[-26,0,52],[1,-14,98],[24,11,75],[-7,20,59]])
          tower(x+dx,y,z+dz,18,17,h,dx>0?0x6e8f95:0x719b9b);
        anchor=y+103;break;
      case 'south':
        courtyard(x,y,z,83,57);
        for(let i=-4;i<=4;i++){
          box(x+i*8,y,z-14,3.8,1.8,52,grey);box(x+i*8,y+1.7,z-25,.65,.12,39,pale);
        }
        box(x,y,z+6,70,10,24,glass);roof(x,y+10,z+6,75,29,8,0xb4b9b5);
        for(let i=-5;i<=5;i++)box(x+i*6,y,z+20,.8,10,.8,pale);
        for(let i=-7;i<=7;i++){
          box(x+i*4.5,y+4.6,z+18.13,.2,4.5,.35,0xa1b4b9);
          box(x+i*4.5,y+11,z+17,.26,.55,4,0xd4d2c8);
        }
        anchor=y+22;break;
      case 'niushou':
        add('cyl',x,y+4,z,47,8,31,0xb8a581);
        add('sphere',x,y+7,z,43,22,27,0xc6a367);
        add('sphere',x,y+10,z,33,16,21,0xcfb783);
        for(let i=0;i<10;i++){
          const a=i*pi*2/10;
          box(x+Math.cos(a)*18,y+4,z+Math.sin(a)*12,1.25,8,1.25,0xe0c994);
        }
        for(let i=0;i<40;i++){
          const a=i*pi/20;
          beam([x+Math.cos(a)*21,y+7,z+Math.sin(a)*13],[x+Math.cos(a)*11,y+16,z+Math.sin(a)*6.8],.25,0xd7bd88);
        }
        pagoda(x+30,land(x+30,z-9),z-9,11,8,gold,stone,2.4);anchor=y+22;break;
      case 'tv':
        add('cyl',x,y+32,z,4.3,64,4.3,pale);
        add('sphere',x,y+63,z,13,8,13,0x769597);
        for(let i=0;i<3;i++)add('cyl',x,y+61+i*1.8,z,12.1+i*.25,.32,12.1+i*.25,0xa7b7b4);
        add('cyl',x,y+72,z,1.45,15,1.45,stone);add('cone',x,y+82,z,2,8,2,red);
        anchor=y+88;break;
      case 'gate':
        masonry(x-10,y,z,15,8,6,grey);masonry(x+10,y,z,15,8,6,grey);
        box(x,y+6,z,12,2.5,6,grey);arcSpan(x,y,z+3.1,9,6,35,stone);
        hall(x,y+8,z,20,12,4,ink,red);anchor=y+17;break;
      case 'qixia':
        courtyard(x,y,z,45,42);hall(x,y,z,23,15,8,ink,red);
        pagoda(x+18,land(x+18,z-8),z-8,9,5,grey,stone,2);anchor=y+30;break;
      case 'youth':
        for(const [dx,dz,height] of [[-10,4,114],[14,-10,88]]){
          for(let i=0;i<16;i++){
            const a=i/15,w=16+5*Math.sin(a*pi)-4*a;
            add('facade',x+dx+a*4,y+a*height+(height/15+.3)/2,z+dz-a*3,w,height/15+.3,w*.82,i%2?0xb5c8cb:0x94adb8,-a*.20);
          }
        }
        add('sphere',x-1,y+5,z+16,42,14,22,0xd1d8c9,.26,0,.12);
        add('foot',x+6,y+9,z+18,33,12,16,0xdbe1d2,.26,0,.15);
        anchor=y+124;break;
      case 'grand':
        add('cyl',x,y+1,z,57,2,38,0xa8b0a0);
        for(const [dx,dz,w,h] of [[-12,-8,19,15],[10,-9,16,12],[-11,9,15,11],[10,8,20,17]]){
          add('sphere',x+dx,y+3+h*.17,z+dz,w,h,w*.77,0x9cbbc1,-.3,0,-.21);
          for(let i=-2;i<=2;i++)add('cyl',x+dx,y+3+h*.17+i*h*.105,z+dz,w*.92,.14,w*.70,0xa9c3c4,-.3,0,-.21);
        }
        anchor=y+18;break;
      case 'station':
        courtyard(x,y,z,57,39);
        box(x,y,z+7,47,10,14,glass);roof(x,y+10,z+7,50,17,4,pale);
        for(let i=-5;i<=5;i++)box(x+i*4,y,z+14,.57,10,.65,pale);
        for(let i=0;i<4;i++){
          box(x,y,z-5-i*6,73,1,2.9,stone);
          box(x,y+1.2,z-7-i*6,83,.21,.6,grey);
        }
        anchor=y+17;break;
      case 'purple':
        box(x,y,z,16,6,15,stone);add('sphere',x,y+6,z,13,10,13,pale);
        box(x,y+8.5,z+3,1,1.3,7,grey);
        archedPortal(x,y+.1,z+7.55,2.4,3.8,stone,ink);
        for(let i=-2;i<=2;i++)box(x+i*2.5,y+3.4,z+7.55,.71,1.46,.21,0x698385);
        anchor=y+14;break;
      case 'liziba': {
        const Y=y+16;
        tower(x,y,z,29,18,14,0xbba182);
        tower(x,y+23,z,29,18,23,0xc6ad8b);
        for(const side of [-1,1]){
          box(x,y+15,z+side*8.6,28,8,.75,stone);
          for(let j=-4;j<=4;j++)box(x+j*3,y+17,z+side*9.1,2.5,3,.35,0x4f6e77);
          box(x+side*10,y+23,z+8,1,24,2.3,0x877360);
        }
        beam([x-98,Y,z],[x+81,Y,z],2.25,0x929991);
        for(let i=-4;i<4;i++)box(x+i*21,land(x+i*21,z),z,3,Math.max(.5,Y-land(x+i*21,z)),4,stone);
        for(let i=0;i<3;i++){
          const X=x+24+i*8.2;
          box(X,Y+1.1,z,7.8,2.95,3.4,0xdcd9cd);
          box(X,Y+2.94,z+1.72,7.3,1,.12,0x3d6d83);
          box(X,Y+1.32,z+1.73,7.7,.25,.13,0x609142);
          for(let j=-1;j<=1;j++)box(X+j*2.21,Y+2.1,z+1.76,.21,1.9,.11,0xb8bdb5);
        }
        anchor=y+49;break;}
      case 'hongya': for(let i=0;i<5;i++){
          const Y=y+i*6.6,Z=z-i*6.2;
          masonry(x,Y-.6,Z-3,58-i*3,2.4,7,0x827769);
          for(let j=-1;j<=1;j++){
            const X=x+j*18;
            hall(X,Y+1,Z,17,11,4.8,0x5b3931,0xb67e46);
            rail(X-7,Y+1,Z+6.8,X+7,Z+6.8,10,0x694331);
            for(let k=-2;k<=2;k++){
              box(X+k*2.9,Y-2.2,Z+5.9,.52,7,.61,0x573b2e);
              add('sphere',X+k*2.9,Y+4.4,Z+6.4,.49,.66,.49,0xff9b50,0,0,0,true);
            }
          }
        }
        anchor=y+42;break;
      case 'cqbridge': {
        const Y=y+12,length=155;
        const deck=z+15;
        box(x,Y,deck,10,2.7,length,0x7d807b);
        box(x,Y+2.8,deck,9.8,.45,length,0x9d9789);
        for(const side of [-1,1]){
          rail(x+side*5,Y+3.2,deck-length/2,x+side*5,deck+length/2,59,0xbeb5a6);
          beam([x+side*5,Y-12,deck],[x+side*2.5,Y+31,deck],2.3,0xb8b4a7);
          beam([x+side*2.5,Y+31,deck],[x,Y+54,deck],1.8,0xc3bdb0);
          for(let j=0;j<13;j++)beam([x,Y+34+j*1.3,deck],[x,Y+3.15,deck+side*(8+j*4.8)],.25,0xd2c7b0);
        }
        box(x,Y-5,deck,12,4,7,stone);
        anchor=Y+56;break;}
      case 'pearl':
        for(const a of [0,2*pi/3,4*pi/3])beam([x+13*Math.cos(a),y,z+13*Math.sin(a)],[x,y+64,z],3.2,pale);
        add('cyl',x,y+46,z,5,92,5,pale);
        for(const [h,w] of [[41,25],[85,19],[103,8]])add('sphere',x,y+h,z,w,w,w,0xad6c7d);
        for(const [h,w] of [[41,25],[85,19],[103,8]]){
          for(let j=-2;j<=2;j++){
            const W=w*Math.sqrt(1-(j*.22)**2);
            add('cyl',x,y+h+j*w*.1,z,W+.13,.28,W+.13,j===0?0xa7bac2:0xcda4aa);
          }
        }
        add('cone',x,y+115,z,2,24,2,pale);anchor=y+129;break;
      case 'shanghai': {
        const floors=72,panels=42,vertices=[],tones=[];
        function point(i,j){
          const t=i/floors,a=j*pi*2/panels;
          const radius=(19-9.5*t)*(1+.102*Math.cos(a*3));
          return [x+Math.cos(a+t*pi*2/3)*radius,y+t*162,z+Math.sin(a+t*pi*2/3)*radius*.88];
        }
        for(let i=0;i<floors;i++)for(let j=0;j<panels;j++){
          const a=point(i,j),b=point(i,j+1),c=point(i+1,j+1),d=point(i+1,j);
          vertices.push(...a,...c,...b,...a,...d,...c);
          color.set([0x517c89,0x6a93a0,0x7f9eaa,0x8baab1][(j*11+i*19)%4]);
          if(i%8===0)color.multiplyScalar(.79);
          for(let k=0;k<6;k++)tones.push(color.r,color.g,color.b);
          if(j%3===0)beam(a,d,.18,0xb0c4c6);
          if(i%3===0)beam(a,b,.15,0x9bb3b7);
        }
        const surface=new T.BufferGeometry();
        surface.setAttribute('position',new T.Float32BufferAttribute(vertices,3));
        surface.setAttribute('color',new T.Float32BufferAttribute(tones,3));
        surface.computeVertexNormals();
        const curtainWall=new T.Mesh(surface,new T.MeshStandardMaterial({vertexColors:true,roughness:.42,metalness:.2,side:T.DoubleSide}));
        curtainWall.castShadow=true;
        curtainWall.receiveShadow=true;
        root.add(curtainWall);
        add('cyl',x,y+162,z,18.6,1.2,16,0x8fa4a8);
        courtyard(x,y,z,53,40);
        anchor=y+164;break;}
      case 'shcbd':
        tower(x-13,y,z,24,20,106,0x7598ad);
        for(const s of [-1,1])box(x-13+s*9,y+108,z,5,19,12,glass);
        box(x-13,y+125,z,23,6,12,glass);
        for(const side of [-1,1])beam([x-13+side*9,y+108,z+6.2],[x-13+side*11,y+129,z+6.2],.62,0xa1b5bd);
        for(let i=0;i<15;i++)box(x-13,y+3+i*6.7,z+10.1,24,.24,.33,0x8ea8b3);
        for(let i=0;i<8;i++)tower(x+23,y+i*11,z-13,25-i*2.1,20-i*1.55,10,grey);
        add('cone',x+23,y+92,z-13,4,10,4,pale);anchor=y+137;break;
      case 'bell':
        masonry(x,y,z,43,9,43,grey);
        archedPortal(x,y,z+21.5,6.5,7,stone,0x363c36);
        rail(x-19,y+9,z+20,x+19,z+20,17,stone);
        hall(x,y+9,z,30,28,10,jade,red);
        hall(x,y+23,z,20,19,6,jade,red);anchor=y+36;break;
      case 'dayan':pagoda(x,y,z,26,7,0x987c59,0xb19467,6,false);anchor=y+65;break;
      case 'xawall':
        walls([[-211,-152],[214,-152],[214,139],[-211,139],[-211,-152]],8);
        masonry(x-12,y,z,17,8,7,grey);masonry(x+12,y,z,17,8,7,grey);
        archedPortal(x,y,z+3.7,6.6,7.2,stone,ink);
        hall(x,y+8,z,32,19,9,0x5d6456,red);anchor=y+24;break;
      case 'pingan': {
        const heights=[0,27,56,82,110,137,151,166];
        const widths=[35,33,30,27,23,19,15,2];
        for(let i=0;i<heights.length-1;i++){
          const bottom=widths[i],top=widths[i+1],start=heights[i],height=heights[i+1]-start;
          for(let j=0;j<6;j++){
            const t=j/6,w=mix(bottom,top,t);
            add('facade',x,y+start+(j+.5)*height/6,z,w,height/6+.12,w*.86,0x738f9f);
          }
          for(const side of [-1,1])for(const end of [-1,1])
            beam([x+side*bottom*.49,y+start,z+end*bottom*.423],[x+side*top*.49,y+start+height,z+end*top*.423],.52,0xb0c7ca);
        }
        anchor=y+169;break;}
      case 'spring': for(let i=0;i<40;i++){
          const t=i/40,w=36*Math.pow(1-t*t,.55)*(1-.12*t);
          add('cyl',x,y+i*3+1.5,z,w,3.07,w*.97,0x709eac,i*.08);
          add('cyl',x,y+i*3+2.95,z,w+.16,.23,w*.98,0xadc1c8,i*.08);
          for(let j=0;j<12;j++){
            const a=(j+.5)*pi/6+i*.08;
            box(x+Math.cos(a)*w*.481,y+i*3,z+Math.sin(a)*w*.474,.29,2.95,.28,0x9bb5bf);
          }
        }
        add('cone',x,y+122,z,6,8,6,0x9fbbc3);anchor=y+127;break;
      case 'szcivic': {
        courtyard(x,y,z,89,48);
        box(x,y,z,71,12,24,0xa9afb2);
        for(const side of [-1,1]){
          box(x+side*19,y,z+8,11,16,10,side<0?0xa85b50:0xc7a05d);
          for(let j=0;j<16;j++){
            const t=j/16,u=(j+1)/16;
            const H=t=>y+17-2.5*Math.sin(t*pi)+7*t*t;
            add('box',x+side*(j+.5)*2.75,(H(t)+H(u))/2,z,2.92,.72,31-7*t,0x8a99be,0,0,side*Math.atan2(H(u)-H(t),2.75));
          }
          for(let j=0;j<6;j++)box(x+side*(9+j*4.8),y+1,z+14,.5,13,.56,pale);
        }
        stair(x,y,z+27,39,7,1,.32);
        anchor=y+26;break;}
      case 'watergate': {
        const at=(a,b)=>[x+b,Math.sin(a)*9,z+Math.cos(a)*22];
        for(let i=0;i<36;i++){
          const a=i*pi/36,b=(i+1)*pi/36;
          for(const side of [-1,1]){
            beam(at(a,side*3.2),at(b,side*3.2),.81,stone);
            beam(at(a,side*2.6),at(b,side*2.6),.65,0xa69a84);
          }
          beam(at(a,0),at(b,0),4.7,stone);
        }
        for(let i=-6;i<=6;i++){
          const Z=z+i*2.7,Y=9*Math.sqrt(1-((Z-z)/22)**2);
          for(const side of [-1,1])box(x+side*3.2,Y,Z,.42,1.22,.47,pale);
        }
        anchor=14;break;}
      case 'garden':
        courtyard(x,y,z,53,44);
        for(const s of [-1,1])hall(x+s*16,y,z-7,14,15,6,ink,pale);
        box(x,y+.02,z+9,30,.5,16,city.water);
        hall(x,y,z-1,9,8,4,ink,pale);
        rail(x-15,y+.55,z+17,x+15,z+17,16,stone);
        for(let i=0;i<11;i++){
          const a=i*pi*2/11,X=x+13*Math.cos(a),Z=z+9+6*Math.sin(a);
          add('oct',X,y+.91,Z,1.6,2,1.2,0x778679,a);
        }
        anchor=y+21;break;
      case 'houses':
        for(let i=-2;i<=2;i++){
          const X=x+i*12,Z=z+(i%2)*3;
          hall(X,y,Z,11,14,6,ink,pale);
          for(let j=0;j<3;j++)box(X+5.2,y,Z,1,7+j*.76,13-j*2.8,pale);
          box(X,y-.3,Z+10,8,.63,6,stone);
          rail(X-4,y+.35,Z+12,X+4,Z+12,6,0x6c5140);
        }
        anchor=y+18;break;
    }
    m.anchor = anchor;
  }
  for(const [color,parts] of roofSurfaces){
    const surface=new T.BufferGeometry();
    surface.setAttribute('position',new T.Float32BufferAttribute(parts.flat(),3));
    surface.computeVertexNormals();
    const roofMesh=new T.Mesh(surface,new T.MeshStandardMaterial({color,side:T.DoubleSide,roughness:.58}));
    roofMesh.castShadow=true;
    roofMesh.receiveShadow=true;
    root.add(roofMesh);
  }
  finish();
  return root;
}








