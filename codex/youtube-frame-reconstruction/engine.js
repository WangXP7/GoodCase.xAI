/* Deterministic Canvas sequence compositor. No <video>, remote embed or MP4 playback. */
(() => {
'use strict';
const film=window.FILM, canvas=document.querySelector('#canvas'), ctx=canvas.getContext('2d',{alpha:false});
const $=id=>document.getElementById(id), audio=new Audio(film.audio);
audio.preload='auto';
const mapping=film.shots.flatMap(s=>Array.from({length:s.sourceEnd-s.sourceStart},(_,i)=>s.sourceStart+i));
const count=mapping.length,duration=count/film.fps,cache=new Map(),pending=new Map();
let frame=0,playing=false,clockStart=0,clockFrame=0,speed=1,token=0,raf=0,transportToken=0;
let lastSource=-1;
const MAX_CACHE=42;
function getImage(index){
  const source=mapping[index];
  if(cache.has(source)){const v=cache.get(source);cache.delete(source);cache.set(source,v);return Promise.resolve(v);}
  if(pending.has(source))return pending.get(source);
  const promise=new Promise((resolve,reject)=>{
    const im=new Image();im.decoding='async';im.onload=async()=>{
      try{await im.decode();cache.set(source,im);pending.delete(source);trim();resolve(im);}catch(e){pending.delete(source);reject(e);}
    };
    im.onerror=()=>{pending.delete(source);reject(new Error(`Frame asset unavailable: ${source}`));};
    im.src=film.framePath(source);
  });pending.set(source,promise);return promise;
}
function trim(){while(cache.size>MAX_CACHE){const key=cache.keys().next().value;cache.delete(key);}}
function prefetch(start){for(let i=start+1;i<Math.min(count,start+15);i++)if(!cache.has(mapping[i])&&!pending.has(mapping[i]))getImage(i).catch(()=>{});}
function composite(im,index){
  ctx.drawImage(im,0,0,film.width,film.height);lastSource=mapping[index];
  for(const o of film.overlays){if(index>=o.start&&index<o.end){ctx.save();ctx.font=`${o.size??48}px ${o.font??'Georgia'}`;ctx.fillStyle=o.color??'#fff';ctx.textAlign=o.align??'center';ctx.fillText(o.text,o.x??960,o.y??540);ctx.restore();}}
}
function update(){
  $('seek').value=frame;const t=frame/film.fps;
  $('counter').textContent=`${String(frame).padStart(3,'0')} / ${count-1} · ${String(Math.floor(t/60)).padStart(2,'0')}:${(t%60).toFixed(2).padStart(5,'0')}`;
  $('play').textContent=playing?'暂停':'播放';
  let offset=0;film.shots.forEach((s,i)=>{const n=s.sourceEnd-s.sourceStart;$('strip').children[i]?.classList.toggle('active',frame>=offset&&frame<offset+n);offset+=n;});
}
async function renderFrame(index){
  const myToken=++token;index=Math.max(0,Math.min(count-1,Math.floor(index)));
  const image=await getImage(index);if(myToken!==token)return false;
  composite(image,index);frame=index;update();prefetch(index);return true;
}
function pause(){transportToken++;playing=false;cancelAnimationFrame(raf);audio.pause();update();}
function tick(){
  if(!playing)return;
  let time=audio.readyState>=2&&!audio.paused?audio.currentTime:clockFrame/film.fps+(performance.now()-clockStart)*speed/1000;
  if(time>=duration){pause();renderFrame(count-1);return;}
  const desired=Math.min(count-1,Math.floor(time*film.fps));
  if(desired!==frame){
    const image=cache.get(mapping[desired]);
    if(image){composite(image,desired);frame=desired;update();prefetch(desired);}
    else{pause();const resumeToken=transportToken;$('loading').hidden=false;renderFrame(desired).then(()=>{$('loading').hidden=true;if(resumeToken===transportToken)play().catch(fail);}).catch(fail);return;}
  }
  raf=requestAnimationFrame(tick);
}
async function play(){
  if(playing)return;if(frame>=count-1)await renderFrame(0);
  const intent=++transportToken;
  await Promise.all(Array.from({length:Math.min(12,count-frame)},(_,i)=>getImage(frame+i)));
  if(intent!==transportToken)return;
  audio.currentTime=frame/film.fps;audio.playbackRate=speed;
  clockStart=performance.now();clockFrame=frame;playing=true;update();
  try{await audio.play();}catch{}if(playing)raf=requestAnimationFrame(tick);
}
async function seek(index){pause();await renderFrame(index);audio.currentTime=frame/film.fps;}
function fail(error){pause();$('loading').hidden=false;$('loading').textContent='画面加载失败，请通过“启动预览.cmd”打开。';console.error(error);}
function fullscreen(){if(document.fullscreenElement)document.exitFullscreen();else document.querySelector('.stage').requestFullscreen();}
$('play').onclick=()=>playing?pause():play().catch(fail);
$('prev').onclick=()=>seek(frame-1);$('next').onclick=()=>seek(frame+1);
$('seek').oninput=e=>seek(+e.target.value).catch(fail);
$('speed').onchange=e=>{speed=+e.target.value;audio.playbackRate=speed;clockStart=performance.now();clockFrame=frame;};
$('mute').onclick=()=>{audio.muted=!audio.muted;$('mute').textContent=audio.muted?'已静音':'声音开';};
$('full').onclick=fullscreen;canvas.ondblclick=fullscreen;
let offset=0;
for(const shot of film.shots){
  const b=document.createElement('button'),start=offset,length=shot.sourceEnd-shot.sourceStart;
  b.className='shot';b.style.flexGrow=length;b.title=`镜头 ${shot.id} · ${(start/film.fps).toFixed(2)}s · 源帧 ${shot.sourceStart}–${shot.sourceEnd-1}`;
  b.setAttribute('aria-label',b.title);b.onclick=()=>seek(start);$('strip').append(b);offset+=length;
}
document.addEventListener('keydown',e=>{
  if(e.target.tagName==='SELECT'||e.target.tagName==='INPUT')return;
  if(e.code==='Space'){e.preventDefault();playing?pause():play().catch(fail);}
  if(e.code==='ArrowRight'||e.code==='ArrowLeft'){
    e.preventDefault();const direction=e.code==='ArrowRight'?1:-1;
    if(e.shiftKey){let starts=[],n=0;for(const s of film.shots){starts.push(n);n+=s.sourceEnd-s.sourceStart;}seek(direction>0?(starts.find(s=>s>frame)??count-1):([...starts].reverse().find(s=>s<frame)??0));}
    else seek(frame+direction);
  }
  if(e.code==='KeyF')fullscreen();if(e.code==='KeyM')$('mute').click();if(e.code==='KeyR')seek(0).then(play);
});
// Public frame rendering API used by verification and external renderers.
window.renderFrame=renderFrame;
window.renderAt=t=>seek(Math.round(t*film.fps));
window.__seek=window.renderAt;
window.animationState=()=>({frame,sourceFrame:mapping[frame],fps:film.fps,frames:count,playing,width:canvas.width,height:canvas.height,lastSource,cache:cache.size});
window.__ready=false;
if(new URLSearchParams(location.search).has('clean'))document.body.classList.add('clean');
renderFrame(0).then(()=>{$('loading').hidden=true;$('play').disabled=false;window.__ready=true;}).catch(fail);
})();
