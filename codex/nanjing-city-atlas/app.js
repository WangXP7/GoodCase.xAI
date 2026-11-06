const $ = id => document.getElementById(id);
const viewport=$('viewport'), stage=$('stage'), list=$('list');
const scene=new T.Scene();
const camera=new T.OrthographicCamera(-1,1,1,-1,1,5200);
const fill=new T.HemisphereLight(0xf7f6df,0x5e6959,2.05);
const sun=new T.DirectionalLight(0xffe2af,2.35);
sun.position.set(-360,640,270);
scene.add(fill,sun);

let renderer;
try{
  renderer=new T.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));
  renderer.toneMapping=T.ACESFilmicToneMapping;
  viewport.append(renderer.domElement);
  renderer.domElement.setAttribute('aria-label','可旋转缩放的三维城市模型');
}catch(error){
  $('error').hidden=false;
  $('error').textContent='浏览器无法启动 WebGL。地标列表仍可浏览。可在支持 WebGL 的 Edge 或 Chrome 中打开此文件。';
}
let city=cities[0], settings, model, active=null, filter='all';
let tourTimer=null, pending=false, rebuildTimer=null, dirty=false, lastFrame=0;
const target={x:-119,y:0,z:0,yaw:-.37,pitch:.73,span:1460};
const view={...target};
const defaults=()=>({density:city.density,height:city.height,trees:city.trees,block:city.key==='jn'?39:47,seed:3201,light:city.key==='sz'?'night':'day',labels:true});

function setLight(){
  const theme={
    day:[2.1,2.38,0xffe4b6,0xf1f4df,city.sky,1.05],
    dusk:[1.05,2.95,0xffb07c,0xffd5bd,0x534443,.92],
    night:[.62,1.12,0x92b9ff,0xa3baf2,0x182737,.92]
  }[settings.light];
  fill.intensity=theme[0];sun.intensity=theme[1];
  sun.color.set(theme[2]);fill.color.set(theme[3]);scene.background=new T.Color(theme[4]);
  if(renderer)renderer.toneMappingExposure=theme[5];
  requestFrame();
}
function rebuild(){
  clearTimeout(rebuildTimer);
  if(renderer){
    if(model){
      scene.remove(model);
      const materials=new Set();
      model.traverse(item=>{
        if(item.material)materials.add(item.material);
        if(item.isInstancedMesh)item.dispose();
        if(item.geometry&&!Object.values(geos).includes(item.geometry))item.geometry.dispose();
      });
      materials.forEach(material=>material.dispose());
    }
    model=createCityScene(city,settings);
    scene.add(model);
  }
  drawMap();
  requestFrame();
}
function scheduleRebuild(){
  clearTimeout(rebuildTimer);rebuildTimer=setTimeout(rebuild,110);
}
function setView(mode){
  const overview={x:-119,y:0,z:0,span:1655};
  if(mode==='top')Object.assign(target,overview,{yaw:0,pitch:1.565});
  else Object.assign(target,overview,{yaw:-.37,pitch:.73});
  requestFrame();
}
function focus(m){
  const H=Math.max(0,footprint(city,m.x,m.z));
  const h=m.anchor??m.y;
  Object.assign(target,{x:m.x,y:Math.max(H+8,(h+H)*.5),z:m.z,
    yaw:m.id==='bridge'?-.23:-.36,pitch:m.id==='xuanwu'?.99:.59,
    span:Math.max(m.span*1.94,(h-H)*2.05,104)});
  requestFrame();
}
function requestFrame(){
  dirty=true;
  if(!pending&&renderer){pending=true;requestAnimationFrame(frame);}
}
function frame(now){
  pending=false;
  const dt=clamp(now-lastFrame,12,130); lastFrame=now;
  const amount=1-Math.exp(-dt/66);
  let animating=false;
  for(const key of Object.keys(view)){
    const d=target[key]-view[key];
    if(Math.abs(d)>(key==="yaw"||key==="pitch"?.0002:.008)){view[key]+=d*amount;animating=true;}
    else view[key]=target[key];
  }
  if(!dirty&&!animating)return;
  dirty=false;
  const width=viewport.clientWidth,height=viewport.clientHeight;
  if(width<1||height<1)return;
  const ratio=width/height, half=Math.max(view.span,view.span*.55*ratio)/2;
  camera.left=-half;camera.right=half;camera.top=half/ratio;camera.bottom=-half/ratio;
  const radius=2250;
  camera.position.set(view.x+radius*Math.sin(view.yaw)*Math.cos(view.pitch),
    view.y+radius*Math.sin(view.pitch),view.z+radius*Math.cos(view.yaw)*Math.cos(view.pitch));
  camera.lookAt(view.x,view.y,view.z);
  camera.updateMatrixWorld();camera.updateProjectionMatrix();
  renderer.render(scene,camera);
  updatePins(width,height);
  if(animating)requestFrame();
}
function updatePins(width,height){
  const seen=[];
  const ordered=active?[active]:city.landmarks.filter(m=>m.pin);
  for(const pin of $('labels').children)pin.hidden=true;
  if(!settings.labels)return;
  for(const m of ordered){
    const v=new T.Vector3(m.x,(m.anchor??m.y)+8,!active&&m.id==="xuanwu"?m.z-46:m.z).project(camera);
    const x=(v.x*.5+.5)*width,y=(-v.y*.5+.5)*height;
    const half=m.short.length*(active?6.5:5.4)+10;
    if(x-half<5||x+half>width-5||y<31||y>height-41||
       (!active&&((y<105&&x<Math.min(315,width*.65))||(y>height-110&&x>width-140)))||
       seen.some(p=>Math.abs(p.x-x)<p.half+half&&Math.abs(p.y-y)<25))continue;
    seen.push({x,y,half});
    m.button.hidden=false;
    m.button.classList.toggle('active',active===m);
    m.button.style.left=x+'px';m.button.style.top=y+'px';
  }
}
function drawMap(){
  const canvas=$('mini'),ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
  const {west,east,north,south}=mapBounds;
  const mx=x=>(x-west)/(east-west)*w,mz=z=>(z-north)/(south-north)*h;
  const rgb=c=>'#'+c.toString(16).padStart(6,'0');
  for(let j=0;j<h;j+=3)for(let i=0;i<w;i+=3){
    const y=footprint(city,mix(west,east,(i+1)/w),mix(north,south,(j+1)/h));
    ctx.fillStyle=rgb(y<0?city.water:y>14?city.hill:city.ground);
    ctx.fillRect(i,j,3,3);
  }
  city.landmarks.forEach(m=>{
    ctx.beginPath();ctx.arc(mx(m.x),mz(m.z),m===active?5:2.1,0,pi*2);
    ctx.fillStyle=m===active?'#fff1c7':'#efd09a';ctx.fill();
    if(m===active){ctx.strokeStyle='#533a23';ctx.lineWidth=2;ctx.stroke();}
  });
}
function renderFeature(){
  const f=$('feature');
  const badge=document.createElement('div');badge.className='eyebrow';
  const title=document.createElement('h2'), description=document.createElement('p');
  if(active){
    badge.textContent=String(city.landmarks.indexOf(active)+1).padStart(2,'0')+' / '+category[active.type];
    title.textContent=active.name;description.textContent=active.desc;
  }else{
    badge.textContent=String(city.landmarks.length).padStart(2,'0')+' / LANDMARKS';
    title.textContent=city.key==='nj'?'南京地标总览':city.name;
    description.textContent=city.key==='nj'?'从长江大桥、玄武湖到钟山与秦淮。选一个地标，镜头会自动靠近。':'选一个地标进入近景，也可在场景参数中重生成街区。';
  }
  f.replaceChildren(badge,title,description);
}
function visibleLandmarks(){
  const query=$('search').value.trim().toLowerCase();
  return city.landmarks.filter(m=>(filter==='all'||m.type===filter)&&
    (!query||(m.name+category[m.type]+m.desc).toLowerCase().includes(query)));
}
function renderList(){
  const entries=visibleLandmarks();
  list.replaceChildren();
  if(!entries.length){
    const empty=document.createElement('p');empty.className='empty';empty.textContent='没有符合条件的地标。';list.append(empty);
  }
  for(const m of entries){
    const btn=document.createElement('button');btn.className='entry';btn.dataset.landmark=m.id;
    btn.setAttribute('aria-current',String(m===active));
    const n=document.createElement('b');n.textContent=String(city.landmarks.indexOf(m)+1).padStart(2,'0');
    const title=document.createElement('span');title.textContent=m.name;
    const group=document.createElement('small');group.textContent=category[m.type];title.append(group);
    const arrow=document.createElement('i');arrow.textContent='↗';arrow.setAttribute('aria-hidden','true');
    btn.append(n,title,arrow);btn.onclick=()=>{stopTour();selectLandmark(m);};list.append(btn);
  }
  $('previous').disabled=$('next').disabled=$('tour').disabled=!entries.length;
}
function renderFilters(){
  const filters=$('filters');filters.replaceChildren();
  const types=['all',...new Set(city.landmarks.map(m=>m.type))];
  for(const type of types){
    const b=document.createElement('button');b.textContent=type==='all'?'全部':category[type];
    b.setAttribute('aria-pressed',String(type===filter));
    b.onclick=()=>{stopTour();filter=type;renderFilters();renderList();};filters.append(b);
  }
}
function selectLandmark(m){
  active=m;renderFeature();drawMap();focus(m);
  for(const el of list.querySelectorAll('.entry'))el.setAttribute('aria-current',String(el.dataset.landmark===m.id));
  const item=list.querySelector('[aria-current="true"]');
  if(item){
    const listRect=list.getBoundingClientRect(), itemRect=item.getBoundingClientRect();
    if(itemRect.top<listRect.top)list.scrollTop+=itemRect.top-listRect.top-4;
    if(itemRect.bottom>listRect.bottom)list.scrollTop+=itemRect.bottom-listRect.bottom+4;
  }
}
function stepTour(offset){
  const available=visibleLandmarks(), index=available.indexOf(active), n=available.length;
  if(n)selectLandmark(available[index<0?(offset>0?0:n-1):(index+offset+n)%n]);
}
function stopTour(){
  clearInterval(tourTimer);tourTimer=null;$('tour').textContent='开始巡游';
}
function switchPanel(edit){
  $('landPanel').hidden=edit;$('editPanel').hidden=!edit;
  $('landTab').setAttribute('aria-pressed',String(!edit));
  $('editTab').setAttribute('aria-pressed',String(edit));
}
function clearFocus(mode){
  stopTour();active=null;renderFeature();renderList();drawMap();setView(mode);
}

function renderControls(){
  const controls=$('controls');controls.replaceChildren();
  const sliders=[
    ['density','建筑密度',15,100,'%'],['height','街区高度',5,110,''],
    ['block','街区间距',32,71,''],['trees','树木覆盖',0,100,'%']
  ];
  for(const [id,label,min,max,unit] of sliders){
    const container=document.createElement('label');container.className='control';container.textContent=label;
    const output=document.createElement('output');output.value=settings[id]+unit;
    const input=document.createElement('input');input.type='range';input.id=id;
    output.htmlFor=id;
    input.min=min;input.max=max;input.value=settings[id];
    input.oninput=()=>{settings[id]=Number(input.value);output.value=input.value+unit;scheduleRebuild();};
    container.append(output,input);controls.append(container);
  }
  const light=document.createElement('label');light.className='control';light.textContent='光照';
  const select=document.createElement('select');select.id='light';
  for(const [v,label] of [['day','晴日'],['dusk','金色黄昏'],['night','蓝调夜景']]){
    const option=new Option(label,v);select.add(option);
  }
  select.value=settings.light;select.onchange=()=>{settings.light=select.value;setLight();};
  light.append(select);controls.append(light);
  const marker=document.createElement('label');marker.className='control check';
  const check=document.createElement('input');check.type='checkbox';check.checked=settings.labels;check.id='markers';
  check.onchange=()=>{
    settings.labels=check.checked;
    if(!settings.labels)for(const pin of $('labels').children)pin.hidden=true;
    requestFrame();
  };
  marker.append(check,'显示地标标注');controls.append(marker);
  const actions=document.createElement('div');actions.className='control actions';
  const seed=document.createElement('button');seed.textContent='重生成 · '+settings.seed;seed.id='regenerate';
  seed.onclick=()=>{settings.seed++;seed.textContent='重生成 · '+settings.seed;rebuild();};
  const reset=document.createElement('button');reset.textContent='恢复默认';
  reset.onclick=()=>{settings=defaults();renderControls();setLight();rebuild();};
  actions.append(seed,reset);controls.append(actions);
}
function switchCity(next){
  stopTour();city=next;settings=defaults();active=null;filter='all';$('search').value='';
  $('cityTitle').textContent=city.title;$('cityIntro').textContent=city.intro;$('headerCity').textContent=city.name;
  $('edition').textContent=String(cities.indexOf(city)+1).padStart(2,'0')+(city.key==='nj'?' / FEATURED CITY':' / CITY PRESET');
  for(const btn of $('cities').children)btn.setAttribute('aria-pressed',String(btn.dataset.city===city.key));
  $('labels').replaceChildren();
  for(const m of city.landmarks){
    const b=document.createElement('button');b.className='pin';b.textContent=m.short;b.hidden=true;
    b.title=m.name;b.onclick=()=>{stopTour();switchPanel(false);selectLandmark(m);};
    m.button=b;$('labels').append(b);
  }
  renderFilters();renderList();renderFeature();renderControls();setLight();rebuild();setView('home');
}
for(const [index,preset] of cities.entries()){
  const b=document.createElement('button');b.dataset.city=preset.key;
  if(index===0){const tag=document.createElement('small');tag.textContent='重点';b.append(tag);}
  b.append(preset.name);b.onclick=()=>switchCity(preset);$('cities').append(b);
}
$('home').onclick=()=>clearFocus('home');
$('top').onclick=()=>clearFocus('top');
function zoom(factor){
  target.span=clamp(target.span*factor,46,2630);requestFrame();
}
$('plus').onclick=()=>zoom(.79);$('minus').onclick=()=>zoom(1.26);
$('landTab').onclick=()=>switchPanel(false);$('editTab').onclick=()=>{stopTour();switchPanel(true);};
$('search').oninput=()=>{stopTour();renderList();};
$('previous').onclick=()=>{stopTour();stepTour(-1);};$('next').onclick=()=>{stopTour();stepTour(1);};
$('tour').onclick=()=>{
  if(tourTimer){stopTour();return;}
  stepTour(1);tourTimer=setInterval(()=>stepTour(1),4400);$('tour').textContent='暂停巡游';
};
if(renderer){
  new ResizeObserver(()=>{
    renderer.setSize(viewport.clientWidth,viewport.clientHeight,false);requestFrame();
  }).observe(viewport);
  const canvas=renderer.domElement,pointers=new Map();
  canvas.addEventListener('contextmenu',event=>event.preventDefault());
  canvas.addEventListener('wheel',event=>{event.preventDefault();stopTour();zoom(Math.exp(clamp(event.deltaY,-120,120)*.0018));},{passive:false});
  canvas.addEventListener('pointerdown',event=>{
    stopTour();canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId,[event.clientX,event.clientY,event.button]);
  });
  canvas.addEventListener('pointermove',event=>{
    if(!pointers.has(event.pointerId))return;
    const [x,y,button]=pointers.get(event.pointerId), dx=event.clientX-x,dy=event.clientY-y;
    const other=Array.from(pointers).find(([id])=>id!==event.pointerId);
    if(other){
      const [ox,oy]=other[1], before=Math.hypot(x-ox,y-oy),after=Math.hypot(x+dx-ox,y+dy-oy);
      if(before>4&&after>4)zoom(before/after);
    }else if(button===2||event.shiftKey){
      const scale=target.span/viewport.clientWidth;
      target.x-=scale*(Math.cos(target.yaw)*dx+Math.sin(target.yaw)*dy);
      target.z+=scale*(Math.sin(target.yaw)*dx-Math.cos(target.yaw)*dy);
    }else{
      target.yaw-=dx*.007;target.pitch=clamp(target.pitch+dy*.007,.19,1.565);
    }
    pointers.set(event.pointerId,[event.clientX,event.clientY,button]);requestFrame();
  });
  for(const type of ['pointerup','pointercancel','lostpointercapture'])
    canvas.addEventListener(type,event=>pointers.delete(event.pointerId));
}
switchCity(cities[0]);




