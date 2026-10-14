(() => {
  'use strict';
  const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const sceneInfo={sunset:{name:'落日旷野',en:'GOLDEN HOUR',caption:'落日有回声'},aurora:{name:'极光之夜',en:'NORTHERN LIGHTS',caption:'写给夜空'},coast:{name:'蓝调海岸',en:'THE BLUE HOUR',caption:'海风来信'},upload:{name:'我的照片',en:'YOUR MOMENT',caption:'我的这一刻'}};
  const filmInfo={original:'原生彩色',vintage:'暖调复古',mono:'银盐黑白'};
  const state={scene:'sunset',film:'original',exposure:0,flash:true,sound:true,remaining:8,busy:false,photos:[],selected:null,uploaded:null,renderer:null,development:null,totalCaptures:0};
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  let toastTimeout,liveRaf=0,lastFrame=0,audioContext=null;
  function rand(seed=42){return()=>{seed=(Math.imul(1664525,seed)+1013904223)|0;return (seed>>>0)/4294967296;};}
  function canvas(w=900,h=w){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
  function gradient(ctx,y0,y1,stops){const g=ctx.createLinearGradient(0,y0,0,y1);stops.forEach(([p,c])=>g.addColorStop(p,c));return g;}
  const noiseCanvas=canvas(180);{const c=noiseCanvas.getContext('2d'),d=c.createImageData(180,180),r=rand(99);for(let i=0;i<d.data.length;i+=4){const v=Math.floor(r()*256);d.data[i]=d.data[i+1]=d.data[i+2]=v;d.data[i+3]=255;}c.putImageData(d,0,0);}
  function grain(c,opacity=.065){c.save();c.globalAlpha=opacity;c.globalCompositeOperation='soft-light';c.fillStyle=c.createPattern(noiseCanvas,'repeat');c.fillRect(0,0,c.canvas.width,c.canvas.height);c.restore();}

  function mountain(c,w,h,base,amplitude,color,seed,offset=0){const r=rand(seed);c.beginPath();c.moveTo(-20,h);for(let x=-20;x<=w+20;x+=6){const nx=x/w;const y=base+Math.sin(nx*6.3+offset)*amplitude+Math.sin(nx*17.4+offset)*amplitude*.27+Math.sin(nx*38+seed)*amplitude*.09+(r()-.5)*amplitude*.05;c.lineTo(x,y);}c.lineTo(w+20,h);c.closePath();c.fillStyle=color;c.fill();}
  function starfield(c,w,h,r,count=280){for(let i=0;i<count;i++){const x=r()*w,y=r()*h*.76,s=r()>.97?1.45:r()*.75+.2;c.fillStyle=`rgba(214,239,235,${r()*.65+.2})`;c.beginPath();c.arc(x,y,s,0,Math.PI*2);c.fill();if(s>1.2){c.globalAlpha=.3;c.fillRect(x-3,y-.25,6,.5);c.fillRect(x-.25,y-3,.5,6);c.globalAlpha=1;}}}
  function paintScene(target,name){
    const c=target.getContext('2d'),w=target.width,h=target.height,r=rand(name==='sunset'?67:name==='aurora'?98:143);c.clearRect(0,0,w,h);c.save();c.scale(w/900,h/900);const W=900,H=900;
    if(name==='sunset'){
      c.fillStyle=gradient(c,0,H,[[0,'#344d57'],[.24,'#ae7966'],[.49,'#f1a362'],[.65,'#b47450'],[1,'#243937']]);c.fillRect(0,0,W,H);
      const glow=c.createRadialGradient(560,290,10,560,290,370);glow.addColorStop(0,'#ffc995a8');glow.addColorStop(.3,'#edaa7366');glow.addColorStop(1,'#ea976000');c.fillStyle=glow;c.fillRect(0,0,W,670);
      c.fillStyle='#ffe0a3';c.beginPath();c.arc(570,296,66,0,Math.PI*2);c.fill();
      for(let i=0;i<22;i++){const y=90+i*13;c.fillStyle=`rgba(240,196,156,${.009+r()*.018})`;c.fillRect(r()*250-50,y,500+r()*500,2+r()*7);}
      mountain(c,W,H,444,36,'#a98270',19,.5);mountain(c,W,H,480,56,'#8d746c',45,2.5);mountain(c,W,H,519,67,'#677174',66,1.4);mountain(c,W,H,589,92,'#415961',7,3.4);
      c.fillStyle=gradient(c,598,H,[[0,'#96907c'],[.22,'#687779'],[1,'#233c41']]);c.beginPath();c.moveTo(487,556);c.bezierCurveTo(350,617,573,618,460,691);c.bezierCurveTo(319,781,510,821,295,900);c.lineTo(832,900);c.bezierCurveTo(780,795,580,795,610,706);c.bezierCurveTo(669,621,562,592,540,556);c.fill();
      for(let i=0;i<170;i++){const y=585+r()*320,spread=(y-570)*.55;c.strokeStyle=`rgba(248,193,124,${.04+r()*.17})`;c.lineWidth=.4+r()*1.4;c.beginPath();c.moveTo(525+(r()-.5)*spread,y);c.lineTo(535+(r()-.5)*spread,y);c.stroke();}
      mountain(c,W,H,785,74,'#283f3e',81,2.7);
      // Rolling foreground with dry stems catches the last warm light.
      c.fillStyle='#1e3230';c.beginPath();c.moveTo(0,741);c.bezierCurveTo(150,757,197,851,405,900);c.lineTo(0,900);c.fill();
      for(let i=0;i<72;i++){const x=r()*340-40,y=800+r()*125,len=35+r()*100;c.strokeStyle=r()>.65?'#a68d60':'#485447';c.lineWidth=.7+r();c.beginPath();c.moveTo(x,y);c.quadraticCurveTo(x-10,y-len*.55,x-22,y-len);c.stroke();for(let j=0;j<4;j++){c.beginPath();c.moveTo(x-22+j*3,y-len+j*9);c.lineTo(x-36+j*3,y-len+5+j*9);c.stroke();}}
    }else if(name==='aurora'){
      c.fillStyle=gradient(c,0,H,[[0,'#091d31'],[.45,'#143c49'],[.73,'#335a61'],[1,'#101f32']]);c.fillRect(0,0,W,H);starfield(c,W,H,r,580);
      c.save();c.globalCompositeOperation='screen';
      for(let band=0;band<3;band++){for(let i=0;i<160;i++){const x=i*6,curve=200+Math.sin(x/255+band*.72)*135+Math.sin(x/106)*28+band*41;const height=80+Math.sin(x/170+band)*55;const g=c.createLinearGradient(x,curve-height*1.8,x,curve+height);g.addColorStop(0,'#39c9be00');g.addColorStop(.6,`rgba(81,211,166,${.07+(2-band)*.017})`);g.addColorStop(.86,`rgba(116,230,188,${.10+(2-band)*.022})`);g.addColorStop(1,'#4fbba100');c.fillStyle=g;c.beginPath();c.moveTo(x,curve-height*1.8);c.lineTo(x+6,curve-height*1.75);c.lineTo(x+40,curve+height);c.lineTo(x+32,curve+height);c.fill();}}
      c.restore();
      mountain(c,W,H,615,79,'#537c84',8,.2);mountain(c,W,H,635,81,'#244c60',32,1.9);
      c.fillStyle=gradient(c,677,H,[[0,'#274c5d'],[1,'#132e3f']]);c.fillRect(0,685,W,215);
      for(let i=0;i<150;i++){const y=688+r()*220;c.strokeStyle=`rgba(123,187,171,${r()*.12})`;c.lineWidth=.5+r();const x=r()*900;c.beginPath();c.moveTo(x,y);c.lineTo(x+30+r()*170,y);c.stroke();}
      const pine=(x,y,s)=>{c.fillStyle='#102b32';c.fillRect(x-s*.02,y-s*.16,s*.04,s*.3);for(let k=0;k<5;k++){const sy=y-s+k*s*.16,sw=s*(.12+k*.036);c.beginPath();c.moveTo(x,sy);c.lineTo(x-sw,sy+s*.37);c.lineTo(x+sw,sy+s*.37);c.fill();}};
      for(let i=0;i<22;i++)pine(i*47-10,878+Math.sin(i)*20,80+r()*130);pine(802,884,294);pine(47,922,324);
    }else{
      c.fillStyle=gradient(c,0,H,[[0,'#536e85'],[.35,'#b7b9b2'],[.54,'#d6beb0'],[.55,'#7b969c'],[1,'#2d5c69']]);c.fillRect(0,0,W,H);
      const g=c.createRadialGradient(664,209,4,664,209,105);g.addColorStop(0,'#f5ecd98c');g.addColorStop(1,'#f5ecd900');c.fillStyle=g;c.fillRect(500,80,330,300);c.fillStyle='#f0e9d7';c.beginPath();c.arc(664,209,28,0,Math.PI*2);c.fill();
      for(let i=0;i<18;i++){c.fillStyle=`rgba(228,217,198,${.012+r()*.026})`;c.fillRect(r()*700-100,130+r()*270,300+r()*500,3+r()*11);}
      for(let i=0;i<410;i++){const y=498+r()*402,x=r()*900;c.strokeStyle=`rgba(209,231,219,${.04+r()*.12})`;c.lineWidth=.6+(y-498)/200;c.beginPath();c.moveTo(x,y);c.bezierCurveTo(x+20,y-2,x+48,y+3,x+60+r()*120,y);c.stroke();}
      const rock=(x,y,s,color)=>{c.fillStyle=color;c.beginPath();c.moveTo(x-s*.62,y);c.lineTo(x-s*.38,y-s*.68);c.lineTo(x-s*.21,y-s*.89);c.lineTo(x+s*.07,y-s);c.lineTo(x+s*.20,y-s*.81);c.lineTo(x+s*.42,y-s*.66);c.lineTo(x+s*.54,y);c.closePath();c.fill();c.save();c.clip();c.strokeStyle='#78908077';for(let i=0;i<18;i++){c.lineWidth=1+r()*4;const xx=x-s*.4+r()*s*.9;c.beginPath();c.moveTo(xx,y-s);c.lineTo(xx-s*.1,y);c.stroke();}c.restore();};
      rock(297,602,182,'#4c6560');rock(535,554,83,'#6e8580');
      c.strokeStyle='#e1ddd0aa';c.lineWidth=2;c.beginPath();c.ellipse(298,607,130,10,0,0,Math.PI*2);c.stroke();
      c.fillStyle='#243f40';c.beginPath();c.moveTo(0,730);c.bezierCurveTo(110,785,149,744,206,819);c.bezierCurveTo(300,845,356,840,389,900);c.lineTo(0,900);c.fill();
      for(let i=0;i<45;i++){const x=r()*280,y=812+r()*100;c.strokeStyle='#71857a';c.lineWidth=1;c.beginPath();c.moveTo(x,y);c.lineTo(x+15,y-30-r()*40);c.stroke();}
      // Distant birds, asymmetric and quiet.
      c.strokeStyle='#445e6488';c.lineWidth=1.4;for(let i=0;i<4;i++){const x=155+i*31,y=335+Math.sin(i*4)*22;c.beginPath();c.moveTo(x-7,y);c.quadraticCurveTo(x-3,y-4,x,y);c.quadraticCurveTo(x+3,y-4,x+7,y);c.stroke();}
    }
    const vig=c.createRadialGradient(450,410,210,450,450,640);vig.addColorStop(0,'#07151400');vig.addColorStop(1,'#07151480');c.fillStyle=vig;c.fillRect(0,0,W,H);grain(c,.15);c.restore();return target;
  }

  const sources={};['sunset','aurora','coast'].forEach(name=>sources[name]=paintScene(canvas(),name));
  const finder=$('#viewfinder-canvas'),finderCtx=finder.getContext('2d');
  function filterString(film=state.film,exposure=state.exposure){const b=Math.pow(2,exposure*.65);if(film==='mono')return`grayscale(1) contrast(1.12) brightness(${b})`;if(film==='vintage')return`sepia(.37) saturate(.82) contrast(.88) brightness(${b*1.06})`;return`saturate(.88) contrast(1.025) brightness(${b})`;}
  function drawSource(c,source,t=0,film=state.film,exposure=state.exposure){
    const w=c.canvas.width,h=c.canvas.height;c.save();c.clearRect(0,0,w,h);c.filter=filterString(film,exposure);const sw=source.naturalWidth||source.width,sh=source.naturalHeight||source.height;
    const side=Math.min(sw,sh),zoom=reduced||state.scene==='upload'?1:1.02+Math.sin(t*.15)*.012,sz=side/zoom,sx=(sw-sz)/2+Math.sin(t*.1)*side*.003,sy=(sh-sz)/2;c.drawImage(source,sx,sy,sz,sz,0,0,w,h);c.restore();
    if(state.scene!=='upload'&&!reduced){c.save();c.globalCompositeOperation='screen';const g=c.createLinearGradient(0,0,w,0);const glow=.012+Math.sin(t*.4)*.009;g.addColorStop(0,`rgba(255,163,90,${glow})`);g.addColorStop(1,'transparent');c.fillStyle=g;c.fillRect(0,0,w,h);c.restore();}
  }
  function renderFinder(now=0){const src=state.scene==='upload'?state.uploaded:sources[state.scene];if(src)drawSource(finderCtx,src,now*.001);}
  function liveLoop(now){if(now-lastFrame>(reduced?250:50)){renderFinder(now);lastFrame=now;}liveRaf=requestAnimationFrame(liveLoop);}
  function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>el.classList.remove('show'),3200);}
  function setScene(scene){if(!sceneInfo[scene]||scene==='upload'&&!state.uploaded)throw new Error('此场景不可用');state.scene=scene;$$('[data-scene]').forEach(b=>{const active=b.dataset.scene===scene;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});$('#finder-scene').textContent=sceneInfo[scene].en;renderFinder(performance.now());focusFinder();}
  function setFilm(film){if(!filmInfo[film])throw new Error('未知胶片');state.film=film;$$('[data-film]').forEach(b=>{const active=b.dataset.film===film;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});renderFinder(performance.now());}
  function setExposure(value){if(typeof value!=='number'||!Number.isFinite(value)||value< -1.5||value>1.5)throw new Error('曝光必须介于 -1.5 和 1.5 之间');state.exposure=Math.round(value*10)/10;$('#exposure').value=state.exposure;const f=state.exposure===0?'±0.0':`${state.exposure>0?'+':''}${state.exposure.toFixed(1)}`;$('#exposure-value').textContent=f+' EV';$('#finder-exposure').textContent='EV '+state.exposure.toFixed(1);renderFinder(performance.now());}
  function focusFinder(){const f=$('#viewfinder');f.classList.add('focusing');setTimeout(()=>f.classList.remove('focusing'),500);}

  function ensureAudio(){if(!state.sound)return null;try{audioContext||=new(window.AudioContext||window.webkitAudioContext)();if(audioContext.state==='suspended')audioContext.resume().catch(()=>{});return audioContext;}catch{return null;}}
  function playSound(kind){const a=ensureAudio();if(!a)return;const now=a.currentTime;const noise=(delay,len,volume,freq)=>{const buffer=a.createBuffer(1,Math.ceil(a.sampleRate*len),a.sampleRate),data=buffer.getChannelData(0),r=rand(31);for(let i=0;i<data.length;i++)data[i]=(r()*2-1)*Math.pow(1-i/data.length,.7);const src=a.createBufferSource(),filter=a.createBiquadFilter(),gain=a.createGain();src.buffer=buffer;filter.type='bandpass';filter.frequency.value=freq;filter.Q.value=.7;gain.gain.setValueAtTime(volume,now+delay);gain.gain.exponentialRampToValueAtTime(.001,now+delay+len);src.connect(filter).connect(gain).connect(a.destination);src.start(now+delay);src.onended=()=>{src.disconnect();filter.disconnect();gain.disconnect();};};
    if(kind==='shutter'){noise(0,.045,.75,1600);noise(.072,.055,.4,800);noise(.17,1.05,.09,460);const osc=a.createOscillator(),g=a.createGain();osc.type='sawtooth';osc.frequency.setValueAtTime(92,now+.15);osc.frequency.linearRampToValueAtTime(76,now+1.05);g.gain.setValueAtTime(0,now);g.gain.setValueAtTime(.018,now+.15);g.gain.exponentialRampToValueAtTime(.001,now+1.2);osc.connect(g).connect(a.destination);osc.start(now+.15);osc.stop(now+1.25);osc.onended=()=>{osc.disconnect();g.disconnect();};}
    if(kind==='reload'){noise(0,.09,.23,450);noise(.16,.06,.3,1200);}
    if(kind==='ready'){const o=a.createOscillator(),g=a.createGain();o.type='sine';o.frequency.setValueAtTime(660,now);o.frequency.setValueAtTime(880,now+.1);g.gain.setValueAtTime(.035,now);g.gain.exponentialRampToValueAtTime(.001,now+.32);o.connect(g).connect(a.destination);o.start();o.stop(now+.33);o.onended=()=>{o.disconnect();g.disconnect();};}
  }
  function updateCounter(){const n=String(state.remaining).padStart(2,'0');$('#film-count').textContent=n;state.renderer?.setCount(state.remaining);$('#shutter-button').disabled=state.busy||state.remaining===0;$('#reload-film').disabled=state.busy;if(!state.busy)$('#shutter-label').textContent=state.remaining?'按下快门':'请装入胶片';}
  function photoRecord(image,scene,film,exposure,sample=false){const now=new Date();return{id:globalThis.crypto?.randomUUID?.()||`moment-${Date.now()}-${state.photos.length}`,image,scene,film,exposure,sample,title:sceneInfo[scene].caption,date:now.toLocaleDateString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit'}).replaceAll('/','.'),timestamp:now.toISOString()};}
  function renderGallery(newID=null){const root=$('#gallery');root.replaceChildren();state.photos.forEach((p,i)=>{const b=document.createElement('button');b.className='photo-card'+(p.sample?' sample':'')+(p.id===newID?' new':'');b.style.setProperty('--rotation',`${[-5,3,-3,4,-2,2][i%6]}deg`);b.setAttribute('aria-label',`查看${p.sample?'样片':'照片'}：${p.title}`);b.dataset.photoId=p.id;const img=document.createElement('img');img.src=p.image;img.alt=p.title;img.loading='lazy';const caption=document.createElement('span');caption.className='photo-caption';const name=document.createElement('span');name.className='photo-name';name.textContent=p.title;const n=document.createElement('span');n.className='photo-number';n.textContent=String(i+1).padStart(2,'0');caption.append(name,n);b.append(img,caption);b.addEventListener('click',()=>openPhoto(p.id));root.append(b);});const end=document.createElement('div');end.className='gallery-end';end.innerHTML='<svg><use href="#i-camera"/></svg><span>下一刻，等你按下快门</span>';root.append(end);$('#gallery-count').textContent=String(state.photos.length).padStart(2,'0');if(newID)root.scrollTo({left:0,behavior:reduced?'instant':'smooth'});}

  function capture(){
    if(state.busy)return Promise.reject(new Error('相纸正在显影，请稍候'));
    if(state.remaining<=0){toast('胶片用完了，点击「换卷」装入 8 张新胶片。');return Promise.reject(new Error('胶片已用完'));}
    if($('#photo-dialog').open)return Promise.reject(new Error('请先关闭照片预览'));
    state.busy=true;state.remaining--;state.totalCaptures++;updateCounter();$('#shutter-label').textContent='正在显影';$('#capture-status').textContent='正在吐出相纸…';$('.live-badge').lastChild.textContent=' 正在显影';
    renderFinder(performance.now());const shot=canvas();const sc=shot.getContext('2d');sc.drawImage(finder,0,0,shot.width,shot.height);grain(sc,.17);const p=photoRecord(shot.toDataURL('image/jpeg',.94),state.scene,state.film,state.exposure);
    state.renderer?.triggerFlash(state.flash);playSound('shutter');if(state.flash&&!reduced){$('#screen-flash').classList.remove('fire');void $('#screen-flash').offsetWidth;$('#screen-flash').classList.add('fire');}
    const paper=$('#developing-photo');paper.hidden=false;paper.classList.add('arriving');paper.style.setProperty('--development','0');$('#developing-image').src=p.image;$('#development-percent').textContent='0%';
    return new Promise(resolve=>{const development={photo:p,start:performance.now(),bonus:0,progress:0,lastShake:0,raf:0,resolve};state.development=development;const step=now=>{if(state.development!==development)return;const elapsed=now-development.start;development.progress=clamp((elapsed-900+development.bonus)/(reduced?2400:6700),0,1);const visual=Math.pow(development.progress,.72);paper.style.setProperty('--development',visual.toFixed(3));$('#development-percent').textContent=Math.round(development.progress*100)+'%';if(elapsed>1000)$('#capture-status').textContent=development.progress<.75?'影像正在浮现 · 轻晃相纸可加快显影':'就快好了，把光留在这一刻。';if(development.progress>=1){finishDevelopment(development);return;}development.raf=requestAnimationFrame(step);};development.raf=requestAnimationFrame(step);});
  }
  function finishDevelopment(development){const p=development.photo;$('#capture-status').textContent='显影完成，已放入「片刻收藏」。';$('#development-percent').textContent='READY';playSound('ready');setTimeout(()=>{state.photos.unshift(p);renderGallery(p.id);$('#developing-photo').hidden=true;$('#developing-photo').classList.remove('arriving');$('#developing-photo').style.transform='';state.busy=false;state.development=null;updateCounter();$('.live-badge').lastChild.textContent=' 相机已就绪';if(state.remaining===0)$('#capture-status').textContent='这一卷拍完了，换一卷继续收藏。';development.resolve({id:p.id,title:p.title,remaining:state.remaining,photoCount:state.photos.length});},reduced?100:650);}
  function reloadFilm(){if(state.busy)throw new Error('请等当前相纸完成显影');state.remaining=8;updateCounter();playSound('reload');toast('新胶片已装入 · 8 个新的瞬间');$('#capture-status').textContent='新的一卷，从这一刻开始。';return{remaining:8};}
  function openPhoto(id){const p=state.photos.find(p=>p.id===id);if(!p)throw new Error('找不到这张照片');state.selected=id;$('#dialog-image').src=p.image;$('#photo-title').textContent=p.title;$('#photo-date').textContent=p.date;$('#photo-meta').textContent=`${p.sample?'内置样片 · ':''}${filmInfo[p.film]} / EV ${p.exposure.toFixed(1)}`;if(!$('#photo-dialog').open)$('#photo-dialog').showModal();return{id:p.id,title:p.title};}
  function exportCanvas(photo){const c=canvas(1200,1440),x=c.getContext('2d');x.fillStyle='#eeeadd';x.fillRect(0,0,c.width,c.height);x.save();x.globalAlpha=.022;x.fillStyle=x.createPattern(noiseCanvas,'repeat');x.fillRect(0,0,c.width,c.height);x.restore();return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{x.drawImage(img,72,72,1056,1056);x.fillStyle='#4d5443';x.font='48px "KaiTi", "Microsoft YaHei", serif';x.fillText(photo.title,80,1240);x.fillStyle='#848774';x.font='20px monospace';x.fillText(photo.date,82,1355);x.textAlign='right';x.font='600 25px Arial';x.fillText('MOMENT / ONE',1120,1355);resolve(c);};img.onerror=()=>reject(new Error('照片解码失败'));img.src=photo.image;});}
  async function downloadSelected(){const p=state.photos.find(p=>p.id===state.selected);if(!p)return;const c=await exportCanvas(p);const blob=await new Promise(resolve=>c.toBlob(resolve,'image/png'));if(!blob)throw new Error('浏览器无法导出照片');const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`MOMENT_${p.date.replaceAll('.','-')}_${p.id.slice(0,8)}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);toast('相纸已生成，正在保存 PNG。');}

  $$('[data-thumb]').forEach(el=>{const ctx=el.getContext('2d');ctx.drawImage(sources[el.dataset.thumb],0,0,el.width,el.height);});
  for(const [scene,film]of[['sunset','original'],['aurora','original'],['coast','vintage']]){const c=canvas(700);drawSource(c.getContext('2d'),sources[scene],0,film,0);state.photos.push(photoRecord(c.toDataURL('image/jpeg',.91),scene,film,0,true));}renderGallery();
  $$('[data-scene]').forEach(b=>b.addEventListener('click',()=>setScene(b.dataset.scene)));
  $$('[data-film]').forEach(b=>b.addEventListener('click',()=>setFilm(b.dataset.film)));
  $('#exposure').addEventListener('input',e=>setExposure(Number(e.target.value)));
  $('#flash-toggle').addEventListener('click',()=>{state.flash=!state.flash;$('#flash-toggle').setAttribute('aria-checked',String(state.flash));});
  $('#sound-button').addEventListener('click',()=>{state.sound=!state.sound;$('#sound-button').setAttribute('aria-pressed',String(state.sound));$('#sound-button').setAttribute('aria-label',state.sound?'关闭声音':'开启声音');toast(state.sound?'相机声音已开启':'相机已静音');});
  $('#shutter-button').addEventListener('click',()=>capture().catch(e=>toast(e.message)));
  $('#fallback-shutter').addEventListener('click',()=>capture().catch(e=>toast(e.message)));
  $('#reload-film').addEventListener('click',()=>{try{reloadFilm();}catch(e){toast(e.message);}});
  $('#reset-view').addEventListener('click',()=>{state.renderer?.reset();toast('已回到初始视角');});
  $('#viewfinder').addEventListener('click',focusFinder);
  $('#close-dialog').addEventListener('click',()=>$('#photo-dialog').close());
  $('#photo-dialog').addEventListener('click',e=>{if(e.target===$('#photo-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
  $('#download-photo').addEventListener('click',()=>downloadSelected().catch(e=>toast(e.message)));
  document.addEventListener('keydown',e=>{if(e.code!=='Space'||e.repeat||e.altKey||e.ctrlKey||e.metaKey||$('#photo-dialog').open)return;if(['INPUT','TEXTAREA','SELECT','BUTTON','A'].includes(document.activeElement?.tagName)||document.activeElement?.isContentEditable)return;e.preventDefault();capture().catch(e=>toast(e.message));});
  $('#upload-button').addEventListener('click',()=>$('#image-input').click());
  $('#image-input').addEventListener('change',async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;if(!['image/jpeg','image/png','image/webp','image/avif'].includes(file.type)){toast('请使用 JPG、PNG、WebP 或 AVIF 图片。');return;}if(file.size>25*1024*1024){toast('请选择小于 25 MB 的图片。');return;}const url=URL.createObjectURL(file);try{const img=new Image();img.src=url;await img.decode();const c=canvas(1200),x=c.getContext('2d'),side=Math.min(img.naturalWidth,img.naturalHeight);if(!side)throw new Error('空图片');x.drawImage(img,(img.naturalWidth-side)/2,(img.naturalHeight-side)/2,side,side,0,0,1200,1200);state.uploaded=c;setScene('upload');toast('照片已放入取景器 · 只在本机处理');}catch{toast('这张图片暂时无法读取，请换一张试试。');}finally{URL.revokeObjectURL(url);}});
  // Paper movement accelerates the simulated chemistry; no device sensor permission.
  let paperDrag=null;
  $('#developing-photo').addEventListener('pointerdown',e=>{if(!state.development)return;paperDrag={x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY};e.currentTarget.setPointerCapture(e.pointerId);});
  $('#developing-photo').addEventListener('pointermove',e=>{if(!paperDrag||!state.development)return;const d=Math.hypot(e.clientX-paperDrag.lastX,e.clientY-paperDrag.lastY);paperDrag.lastX=e.clientX;paperDrag.lastY=e.clientY;const now=performance.now();if(d>2&&now-state.development.lastShake>45){state.development.bonus=Math.min(4800,state.development.bonus+Math.min(d*5,120));state.development.lastShake=now;}e.currentTarget.style.transform=`translate(${clamp(e.clientX-paperDrag.x,-55,55)}px,${clamp(e.clientY-paperDrag.y,-35,35)}px) rotate(${-7+clamp((e.clientX-paperDrag.x)*.2,-15,15)}deg)`;});
  const releasePaper=e=>{paperDrag=null;e.currentTarget.style.transform='';if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);};$('#developing-photo').addEventListener('pointerup',releasePaper);$('#developing-photo').addEventListener('pointercancel',releasePaper);
  function fallback(reason){$('#camera-canvas').hidden=true;$('#camera-fallback').hidden=false;$('#render-label').textContent='经典模式';$('.drag-hint').textContent='点击红色快门拍照';$('#reset-view').hidden=true;if(reason)console.warn('MOMENT: using CSS camera fallback:',reason);}
  try{state.renderer=new CameraStudio($('#camera-canvas'),()=>capture().catch(e=>toast(e.message)));$('#render-label').textContent='3D 光影工作室';}catch(e){fallback(e.message);}
  $('#camera-canvas').addEventListener('renderer-lost',()=>{state.renderer=null;fallback('WebGL context lost');toast('已切换经典模式，仍可正常拍照。');});
  renderFinder();liveRaf=requestAnimationFrame(liveLoop);document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(liveRaf);liveRaf=0;}else if(!liveRaf)liveRaf=requestAnimationFrame(liveLoop);});

  const readState=()=>({scene:state.scene,film:state.film,exposure:state.exposure,flash:state.flash,sound:state.sound,remaining:state.remaining,busy:state.busy,photoCount:state.photos.length,captures:state.totalCaptures,photos:state.photos.map(({id,title,sample})=>({id,title,sample})),render:state.renderer?.diagnostics()||{renderer:'CSS fallback'},development:state.development?Math.round(state.development.progress*100):null});
  const configure=input=>{if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('参数必须是对象');const keys=['scene','film','exposure','flash'];if(Object.keys(input).some(k=>!keys.includes(k)))throw new Error('未知设置');if(input.scene!==undefined&&(!['sunset','aurora','coast'].includes(input.scene)))throw new Error('场景必须是 sunset、aurora 或 coast');if(input.film!==undefined&&!Object.hasOwn(filmInfo,input.film))throw new Error('无效的胶片风格');if(input.exposure!==undefined&&(typeof input.exposure!=='number'||!Number.isFinite(input.exposure)||input.exposure< -1.5||input.exposure>1.5))throw new Error('无效的曝光值');if(input.flash!==undefined&&typeof input.flash!=='boolean')throw new Error('闪光灯必须是布尔值');if(input.scene!==undefined)setScene(input.scene);if(input.film!==undefined)setFilm(input.film);if(input.exposure!==undefined)setExposure(input.exposure);if(input.flash!==undefined){state.flash=input.flash;$('#flash-toggle').setAttribute('aria-checked',String(state.flash));}return readState();};
  // Same imperative actions back the interface and the optional WebMCP contract.
  const lifecycle=new AbortController();const context=document.modelContext;const registrationErrors=[];
  const toolDefinitions=[
    {name:'read_camera_state',title:'读取相机状态',description:'读取胶片数量、取景设置、显影进度和相片列表。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute:readState},
    {name:'configure_camera',title:'调整取景设置',description:'设置内置场景、胶片、曝光或闪光灯。更新取景器，不触发拍照。',inputSchema:{type:'object',properties:{scene:{type:'string',enum:['sunset','aurora','coast']},film:{type:'string',enum:['original','vintage','mono']},exposure:{type:'number',minimum:-1.5,maximum:1.5},flash:{type:'boolean'}},additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute:configure},
    {name:'capture_instant_photo',title:'拍照并完成显影',description:'消耗一张胶片并完成显影，返回已放入收藏的相片信息。显影需数秒；忙碌或胶片用完时失败。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute:()=>capture()},
    {name:'reload_camera_film',title:'更换胶片',description:'装入一卷 8 张的新胶片，保留已拍摄相片。显影时不可换卷。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute:reloadFilm}
  ];
  if(context?.registerTool)for(const tool of toolDefinitions){try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(e=>registrationErrors.push(e.message));}catch(e){registrationErrors.push(e.message);}}
  window.addEventListener('pagehide',()=>{lifecycle.abort();audioContext?.close().catch(()=>{});});
  window.MomentLab=Object.freeze({readState,configure,capture,reloadFilm,openPhoto,exportCanvas,toolDefinitions,registrationErrors});
})();
