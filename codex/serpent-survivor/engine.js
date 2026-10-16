/* Shared deterministic combat simulation. No renderer or network required. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.Serpent=factory();})(typeof window==='undefined'?globalThis:window,function(){
'use strict';
const VIEW_W=1600,VIEW_H=1000,W=3200,H=2000,TAU=Math.PI*2;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const upgrades=[
 ['fang','淬刃','ϟ','尾击伤害 +30%，所有基础伤害 +8%。',g=>{g.p.tailDamage*=1.3;g.p.power*=1.08;}],
 ['reach','长尾横扫','◔','尾击范围 +22%，横扫角度扩大 20°。',g=>{g.p.reach*=1.22;g.p.arc=Math.min(TAU,g.p.arc+.35);}],
 ['double','双重鞭尾','≋','尾击额外横扫一次，第二击方向偏转。',g=>g.p.strikes++,4],
 ['haste','蜕皮律动','◷','全部技能冷却缩短 13%。',g=>g.p.haste*=.87,7],
 ['bottles','分裂毒瓶','⚗','每次额外投掷一枚毒瓶，覆盖另一处敌群。',g=>g.p.bottles++,5],
 ['venom','烈性毒素','☣','毒液每秒伤害 +35%。',g=>g.p.poisonDamage*=1.35],
 ['pool','腐蚀蔓延','◉','毒池半径 +20%，持续时间 +1.2 秒。',g=>{g.p.poolRadius*=1.2;g.p.duration+=1.2;},6],
 ['stacks','层叠蛇毒','⋮','毒素层数上限 +1，每层增加一份毒伤。',g=>g.p.maxStacks++,5],
 ['curse','深渊咒印','✧','诅咒半径 +22%，持续时间 +1.5 秒。',g=>{g.p.curseRadius*=1.22;g.p.curseDuration+=1.5;}],
 ['frail','剥鳞之咒','✣','诅咒易伤增加 15%，额外毒伤加成 +30%。',g=>{g.p.vulnerability+=.15;g.p.cursePoison+=.3;}],
 ['blast','瘟疫共振','✺','联动爆炸伤害 +40%，爆炸范围 +15%。',g=>{g.p.blastDamage*=1.4;g.p.blastRadius*=1.15;}],
 ['push','驱入泥沼','➶','尾击击退 +35%；被尾击的敌人毒抗降低，毒伤 +25%。',g=>{g.p.knock*=1.35;g.p.pushPoison+=.25;}],
 ['slow','凝滞毒沼','❋','毒池减速增加 10%，中毒持续时间 +1 秒。',g=>{g.p.slow=Math.min(.78,g.p.slow+.1);g.p.poisonDuration++;},4],
 ['legion','万鳞奔袭','⋙','召集伤害 +35%，能量消耗降低 8 点。',g=>{g.p.legionDamage*=1.35;g.p.energyCost=Math.max(60,g.p.energyCost-8);},5],
 ['energy','祖灵回响','◇','击杀能量 +60%，自然能量恢复 +35%。',g=>{g.p.killEnergy*=1.6;g.p.energyRegen*=1.35;}],
 ['magnet','结晶呼唤','✦','结晶拾取距离 +40%，经验获取 +15%。',g=>{g.p.magnet*=1.4;g.p.xpBonus*=1.15;}],
 ['vital','坚韧鳞甲','⬡','生命上限 +30，恢复 45 点生命；受伤降低 8%。',g=>{g.p.maxHp+=30;g.p.hp=Math.min(g.p.maxHp,g.p.hp+45);g.p.armor*=.92;}],
 ['speed','游蛇步法','〰','移动速度 +12%，恢复 20 点生命。',g=>{g.p.speed*=1.12;g.p.hp=Math.min(g.p.maxHp,g.p.hp+20);},5]
].map(([id,name,icon,description,apply,max=9])=>({id,name,icon,description,apply,max}));
class Game{
 constructor(seed=Date.now()){this.seed=seed>>>0;this.reset();}
 random(){this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296;}
 reset(){this.time=0;this.state='ready';this.enemies=[];this.pools=[];this.bottles=[];this.waves=[];this.crystals=[];this.effects=[];this.events=[];this.nextId=1;this.spawnClock=0;this.nextElite=120;this.phase=0;this.choices=[];this.build={};this.invincible=false;
  this.stats={kills:0,damage:0,combos:0,crystals:0,poison:0,poisonCasts:0,tail:0,curse:0,legion:0,elites:0,hits:0};
  this.viewport={width:VIEW_W,height:VIEW_H};
  this.p={x:W/2,y:H/2,angle:-Math.PI/2,hp:120,maxHp:120,energy:30,level:1,xp:0,nextXp:22,speed:185,invuln:0,power:1,tailDamage:24,reach:146,arc:Math.PI*1.2,strikes:1,haste:1,bottles:1,poolRadius:100,duration:5,poisonDuration:2.5,poisonDamage:21,maxStacks:1,slow:.36,curseRadius:270,curseDuration:5,vulnerability:.25,cursePoison:.7,blastDamage:34,blastRadius:82,pushPoison:0,knock:260,legionDamage:190,energyCost:100,killEnergy:1.2,energyRegen:1.8,magnet:120,xpBonus:1,armor:1};
  this.skills=[{id:'tail',name:'尾击',key:'自动',icon:'◔',base:1.05,cd:.15,auto:true},{id:'poison',name:'毒瓶',key:'1',icon:'⚗',base:5.6,cd:1,auto:true},{id:'curse',name:'诅咒',key:'2',icon:'✧',base:8,cd:2.5,auto:true},{id:'legion',name:'蛇人召集',key:'␣',icon:'⋙',base:18,cd:0,auto:false}];
 }
 start(){this.state='playing';this.emit('banner',{text:'第一幕 · 孢子苏醒'});for(let i=0;i<36;i++){const angle=i/36*TAU,radius=420+this.random()*340;this.spawn('melee',{x:clamp(this.p.x+Math.cos(angle)*radius*1.25,76,W-76),y:clamp(this.p.y+Math.sin(angle)*radius*.8,76,H-76)});}}
 emit(type,data={}){this.events.push({type,...data});}
 effect(type,x,y,data={}){this.effects.push({type,x,y,life:data.life||.6,total:data.life||.6,...data});}
 bounds(){const width=Math.min(W,this.viewport.width),height=Math.min(H,this.viewport.height);return {x:clamp(this.p.x-width/2,0,W-width),y:clamp(this.p.y-height/2,0,H-height),width,height};}
 encounter(){const stage=this.time>=540?4:this.time>=360?3:this.time>=180?2:1;return {stage,cap:[180,360,600,850][stage-1],batch:[2,3,4,6][stage-1],interval:Math.max(.13,.55-this.time*.00065)*(stage===4?.65:1)};}
 visibleEnemies(){const b=this.bounds();return this.enemies.filter(e=>e.hp>0&&e.x+e.r>=b.x&&e.x-e.r<=b.x+b.width&&e.y+e.r>=b.y&&e.y-e.r<=b.y+b.height).length;}
 spawn(type,at){const t=this.time,r=this.random();type=type||(r<.12+Math.min(.18,t/2000)&&t>25?'ranged':'melee');let x,y;if(at){x=at.x;y=at.y;}else{const side=Math.floor(this.random()*4),pos=this.random(),b=this.bounds(),left=Math.max(76,b.x-35),right=Math.min(W-76,b.x+b.width+35),top=Math.max(76,b.y-35),bottom=Math.min(H-76,b.y+b.height+35);x=side===0?left:side===1?right:left+pos*(right-left);y=side===2?top:side===3?bottom:top+pos*(bottom-top);}
  const elite=type==='elite',hp=(26+t*.18)*(elite?9:type==='ranged'?1.25:1);const e={id:this.nextId++,x,y,hp,maxHp:hp,type,r:elite?34:19,speed:(37+Math.min(65,t*.11))*(elite?.76:type==='ranged'?.8:1),damage:(7+t*.018)*(elite?2.2:1),vx:0,vy:0,poison:0,stacks:0,stackClock:0,curse:0,comboCd:0,pushed:0,shootCd:2+this.random()*3,attack:null,flash:0,walk:this.random()*TAU};this.enemies.push(e);return e;
 }
 nearest(x=this.p.x,y=this.p.y){let best=null,d=Infinity;for(const e of this.enemies)if(e.hp>0){const n=Math.hypot(e.x-x,e.y-y);if(n<d){d=n;best=e;}}return best;}
 cast(id){if(this.state!=='playing')return false;const s=this.skills.find(s=>s.id===id),p=this.p;if(!s||s.cd>0)return false;if(id==='legion'&&p.energy<p.energyCost)return false;const target=this.nearest();if(id!=='legion'&&!target)return false;s.cd=s.base*p.haste;this.stats[id==='poison'?'poisonCasts':id]++;
  if(id==='tail'){p.angle=Math.atan2(target.y-p.y,target.x-p.x);for(let i=0;i<p.strikes;i++){const angle=p.angle+(i%2?Math.PI:0)+(i>1?(i-1)*.35:0);this.effect('slash',p.x,p.y,{angle,r:p.reach,arc:p.arc,life:.3});for(const e of this.enemies){if(e.hp<=0||dist(e,p)>p.reach+e.r)continue;const a=Math.atan2(e.y-p.y,e.x-p.x);if(Math.abs(Math.atan2(Math.sin(a-angle),Math.cos(a-angle)))>p.arc/2)continue;this.damage(e,p.tailDamage*p.power,'tail');const d=Math.max(1,dist(e,p));e.vx=(e.x-p.x)/d*p.knock;e.vy=(e.y-p.y)/d*p.knock;e.pushed=3;}}this.emit('sound',{kind:'tail'});}
  if(id==='poison'){const candidates=this.enemies.filter(e=>e.hp>0).sort((a,b)=>dist(a,p)-dist(b,p)).slice(0,40);const ranked=candidates.map(e=>({e,score:candidates.reduce((sum,n)=>sum+(dist(n,e)<p.poolRadius?1:0),0)-dist(e,p)/260})).sort((a,b)=>b.score-a.score);const picked=[];for(let i=0;i<p.bottles;i++){const e=(ranked.find(n=>picked.every(q=>dist(q,n.e)>p.poolRadius))||ranked[(i*7)%ranked.length]).e;picked.push(e);this.bottles.push({x:p.x,y:p.y,sx:p.x,sy:p.y,tx:clamp(e.x+e.vx*.12,70,W-70),ty:clamp(e.y+e.vy*.12,70,H-70),t:0,duration:.55});}this.emit('sound',{kind:'poison'});}
  if(id==='curse'){this.effect('curse',p.x,p.y,{r:p.curseRadius,life:.85});for(const e of this.enemies)if(dist(e,p)<=p.curseRadius+e.r){e.curse=p.curseDuration;this.effect('hex',e.x,e.y,{life:.5});}this.emit('sound',{kind:'curse'});}
  if(id==='legion'){const b=this.bounds();p.energy-=p.energyCost;this.waves.push({x:b.x-180,start:b.x-180,end:b.x+b.width+200,top:b.y,bottom:b.y+b.height,t:0,hit:new Set()});this.effect('summon',p.x,p.y,{life:1.4});this.emit('banner',{text:'万鳞奔袭 · 蛇人召集'});this.emit('shake',{amount:10});this.emit('sound',{kind:'legion'});}return true;
 }
 damage(e,amount,source){if(e.hp<=0)return 0;let value=amount*(e.curse>0?1+this.p.vulnerability:1);if(source==='poison')value*=((e.curse>0?1+this.p.cursePoison:1)+(e.pushed>0?this.p.pushPoison:0));const actual=Math.min(e.hp,value);e.hp-=value;e.flash=.1;this.stats.damage+=actual;if(source==='poison')this.stats.poison+=actual;
  if(source!=='poison'||this.random()<.24)this.emit('number',{x:e.x,y:e.y-20,value:Math.round(value),kind:source});
  if(e.hp<=0){this.stats.kills++;if(e.type==='elite')this.stats.elites++;this.p.energy=Math.min(100,this.p.energy+this.p.killEnergy);this.crystals.push({x:e.x,y:e.y,value:e.type==='elite'?18:e.type==='ranged'?5:3,age:0});this.effect('death',e.x,e.y,{r:e.r,life:.4,color:e.type==='elite'?'#c3a75e':'#98a56a'});if(e.type==='elite'){this.p.hp=Math.min(this.p.maxHp,this.p.hp+14);this.emit('banner',{text:'精英击破 · 恢复 14 生命'});}}
  return actual;
 }
 hit(amount){if(this.p.invuln>0||this.invincible)return;this.p.hp=Math.max(0,this.p.hp-amount*this.p.armor);this.p.invuln=.65;this.stats.hits++;this.emit('hurt');this.emit('shake',{amount:7});this.emit('sound',{kind:'hurt'});if(this.p.hp<=0){this.state='dead';this.emit('end',{win:false});}}
 levelUp(){if(this.p.xp<this.p.nextXp||this.state!=='playing')return;this.p.xp-=this.p.nextXp;this.p.level++;this.p.nextXp=Math.floor(22+this.p.level*13+this.p.level**1.4);this.p.hp=Math.min(this.p.maxHp,this.p.hp+9);let pool=upgrades.filter(u=>(this.build[u.id]||0)<u.max);this.choices=[];for(let i=0;i<3&&pool.length;i++){const n=Math.floor(this.random()*pool.length);this.choices.push(pool.splice(n,1)[0]);}this.state='upgrade';this.emit('upgrade');this.emit('sound',{kind:'level'});}
 choose(index){if(this.state!=='upgrade'||!this.choices[index])return false;const u=this.choices[index];u.apply(this);this.build[u.id]=(this.build[u.id]||0)+1;this.state='playing';this.choices=[];this.emit('chosen',{id:u.id});this.levelUp();return true;}
 update(dt,input={}){if(this.state!=='playing')return;dt=Math.min(dt,.05);this.time=Math.min(600,this.time+dt);const p=this.p;p.invuln=Math.max(0,p.invuln-dt);p.energy=Math.min(100,p.energy+p.energyRegen*dt);
  let dx=input.x||0,dy=input.y||0,l=Math.hypot(dx,dy);if(l>0){dx/=Math.max(1,l);dy/=Math.max(1,l);p.x=clamp(p.x+dx*p.speed*dt,90,W-90);p.y=clamp(p.y+dy*p.speed*dt,90,H-90);if(!this.nearest()||dist(this.nearest(),p)>p.reach)p.angle=Math.atan2(dy,dx);}
  for(const s of this.skills){s.cd=Math.max(0,s.cd-dt);if(s.auto&&s.cd<=0)this.cast(s.id);}
  this.spawnClock-=dt;const encounter=this.encounter();if(this.spawnClock<=0){this.spawnClock+=encounter.interval;for(let i=0;i<encounter.batch&&this.enemies.length<encounter.cap;i++)this.spawn();}
  if(this.time>=this.nextElite){for(let i=0;i<3+Math.floor(this.time/120);i++)this.spawn('elite');this.nextElite+=120;this.emit('banner',{text:'精英敌潮 · 菌巢暴动'});this.emit('sound',{kind:'warning'});}
  const phase=this.time>=540?3:this.time>=360?2:this.time>=180?1:0;if(phase!==this.phase){this.phase=phase;this.emit('banner',{text:['','第二幕 · 低语侵蚀','第三幕 · 菌潮汹涌','终幕 · 黑潮围城'][phase]});}
  for(const b of this.bottles){b.t+=dt;b.x=b.sx+(b.tx-b.sx)*Math.min(1,b.t/b.duration);b.y=b.sy+(b.ty-b.sy)*Math.min(1,b.t/b.duration);if(b.t>=b.duration){b.dead=true;this.pools.push({x:b.tx,y:b.ty,r:p.poolRadius,life:p.duration,total:p.duration,seed:this.random()*TAU});this.effect('splash',b.tx,b.ty,{r:p.poolRadius,life:.5});}}
  this.bottles=this.bottles.filter(b=>!b.dead);for(const pool of this.pools)pool.life-=dt;this.pools=this.pools.filter(pool=>pool.life>0);
  const grid=new Map(),cell=65;for(const e of this.enemies){const k=Math.floor(e.x/cell)+','+Math.floor(e.y/cell);if(!grid.has(k))grid.set(k,[]);grid.get(k).push(e);}
  for(const e of this.enemies){if(e.hp<=0)continue;e.curse=Math.max(0,e.curse-dt);e.poison=Math.max(0,e.poison-dt);e.comboCd=Math.max(0,e.comboCd-dt);e.pushed=Math.max(0,e.pushed-dt);e.flash=Math.max(0,e.flash-dt);e.stackClock-=dt;
   let inside=false;for(const pool of this.pools)if(dist(e,pool)<pool.r+e.r*.4){inside=true;e.poison=p.poisonDuration;if(e.stackClock<=0){e.stacks=Math.min(p.maxStacks,e.stacks+1);e.stackClock=.75;}break;}
   if(e.poison>0){this.damage(e,p.poisonDamage*Math.max(1,e.stacks)*p.power*dt,'poison');if(e.curse>0&&e.comboCd<=0&&e.hp>0){e.comboCd=1.8;this.stats.combos++;this.effect('blast',e.x,e.y,{r:p.blastRadius,life:.5});this.emit('sound',{kind:'blast'});for(const other of this.enemies)if(other.hp>0&&dist(e,other)<p.blastRadius+other.r)this.damage(other,p.blastDamage*p.power,'blast');}}else e.stacks=0;
   if(e.hp<=0)continue;const d=Math.max(1,dist(e,p)),ax=(p.x-e.x)/d,ay=(p.y-e.y)/d;e.walk+=dt*e.speed*.12;
   if(e.type==='ranged'){e.shootCd-=dt;if(e.attack){e.attack.t+=dt;if(e.attack.t>=1.35){const a=e.attack,proj=(p.x-a.x)*a.dx+(p.y-a.y)*a.dy,cross=Math.abs((p.x-a.x)*a.dy-(p.y-a.y)*a.dx);if(proj>-15&&proj<650&&cross<43)this.hit(e.damage*(e.curse>0?.6:1));this.effect('sonic',a.x,a.y,{dx:a.dx,dy:a.dy,length:650,life:.4});e.attack=null;e.shootCd=3.5+this.random()*2;}}else if(e.shootCd<=0&&d<630){e.attack={x:e.x,y:e.y,dx:ax,dy:ay,t:0};}
   }
   let speed=e.speed*(inside?1-p.slow:1);if(e.attack)speed=0;else if(e.type==='ranged'&&d<310)speed*=d<210?-.5:.1;
   let sx=0,sy=0,cx=Math.floor(e.x/cell),cy=Math.floor(e.y/cell);for(let xx=cx-1;xx<=cx+1;xx++)for(let yy=cy-1;yy<=cy+1;yy++){const near=grid.get(xx+','+yy);if(!near)continue;for(const o of near){if(o===e||o.hp<=0)continue;let qx=e.x-o.x,qy=e.y-o.y,dd=Math.hypot(qx,qy),min=(e.r+o.r)*.85;if(dd>0&&dd<min){const f=(min-dd)/min*38;sx+=qx/dd*f;sy+=qy/dd*f;}}}
   e.x=clamp(e.x+(ax*speed+e.vx+sx)*dt,73,W-73);e.y=clamp(e.y+(ay*speed+e.vy+sy)*dt,73,H-73);e.vx*=Math.exp(-7*dt);e.vy*=Math.exp(-7*dt);
   if(dist(e,p)<e.r+20)this.hit(e.damage*(e.curse>0?.6:1));
  }
  for(const w of this.waves){w.t+=dt;w.x=w.start+w.t*Math.max(1050,(w.end-w.start)/1.9);for(const e of this.enemies)if(e.hp>0&&!w.hit.has(e.id)&&Math.abs(e.x-w.x)<115&&e.y+e.r>=w.top&&e.y-e.r<=w.bottom){w.hit.add(e.id);this.damage(e,p.legionDamage*p.power,'legion');e.vx=620;}w.dead=w.x>w.end;}this.waves=this.waves.filter(w=>!w.dead);
  this.enemies=this.enemies.filter(e=>e.hp>0);
  // Merge old distant crystals to keep late-run rendering and collection bounded.
  if(this.crystals.length>600){const bins=new Map();for(const c of this.crystals){const k=Math.round(c.x/70)+','+Math.round(c.y/70);if(bins.has(k))bins.get(k).value+=c.value;else bins.set(k,c);}this.crystals=[...bins.values()];}
  for(const c of this.crystals){c.age+=dt;const d=dist(c,p);if(d<p.magnet||c.pull){c.pull=true;const step=Math.min(d,dt*(240+c.age*18));if(d>0){c.x+=(p.x-c.x)/d*step;c.y+=(p.y-c.y)/d*step;}if(d<24){p.xp+=c.value*p.xpBonus;this.stats.crystals+=c.value;c.dead=true;this.emit('pickup');}}}this.crystals=this.crystals.filter(c=>!c.dead);
  for(const f of this.effects)f.life-=dt;this.effects=this.effects.filter(f=>f.life>0);
  if(this.time>=600&&this.state==='playing'){this.state='won';this.emit('end',{win:true});}else this.levelUp();
 }
 snapshot(){return {state:this.state,time:+this.time.toFixed(2),hp:+this.p.hp.toFixed(2),energy:+this.p.energy.toFixed(2),level:this.p.level,x:this.p.x,y:this.p.y,map:{width:W,height:H},camera:this.bounds(),encounter:this.encounter(),visibleEnemies:this.visibleEnemies(),enemies:this.enemies.length,crystals:this.crystals.length,pools:this.pools.length,stats:{...this.stats},skills:this.skills.map(s=>({id:s.id,cd:s.cd,auto:s.auto})),build:{...this.build}};}
}
return {Game,upgrades,W,H,VIEW_W,VIEW_H,clamp,dist};
});
