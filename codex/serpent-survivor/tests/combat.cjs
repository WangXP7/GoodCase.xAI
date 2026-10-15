const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Game,upgrades,dist,W,H}=require('../engine.js');
const results=[];
function test(name,fn){fn();results.push(name);console.log('PASS',name);}
function arena(){const g=new Game(42);g.start();g.p.x=800;g.p.y=500;g.enemies=[];g.events=[];g.spawnClock=100;g.skills.forEach(s=>{s.auto=false;s.cd=0;});return g;}
function tick(g,seconds,input={}){for(let t=0;t<seconds-.00001;t+=.05){g.update(.05,input);g.events=[];}}
function mob(g,x=900,y=500,type='melee'){const e=g.spawn(type,{x,y});e.speed=0;e.hp=e.maxHp=2000;return e;}
test('地图面积扩大四倍，出生在中心，移动可越过旧边界，镜头和刷怪遵循新边界',()=>{const g=new Game(42);assert.equal(W*H/(1600*1000),4);assert.equal(g.p.x,W/2);assert.equal(g.p.y,H/2);g.start();g.enemies=[];g.spawnClock=100;g.skills.forEach(s=>s.auto=false);tick(g,2,{x:1,y:1});assert(g.p.x>1600&&g.p.y>1000);assert(g.bounds().x>800&&g.bounds().y>500);for(const [x,y] of [[90,90],[W-90,H-90]]){g.p.x=x;g.p.y=y;g.enemies=[];for(let i=0;i<30;i++){const e=g.spawn();assert(e.x>=73&&e.x<=W-73&&e.y>=73&&e.y<=H-73);assert(dist(e,g.p)<1900);}const b=g.bounds();assert(b.x>=0&&b.y>=0&&b.x+b.width<=W&&b.y+b.height<=H);}g.p.x=W-91;g.p.y=H-91;tick(g,.1,{x:1,y:1});assert.equal(g.p.x,W-90);assert.equal(g.p.y,H-90);});
test('自动尾击造成真实伤害、产生击退，冷却期间拒绝重复施放',()=>{const g=arena(),e=mob(g,880);assert(g.cast('tail'));assert(e.hp<2000);assert(e.vx>0);assert(!g.cast('tail'));const x=e.x;tick(g,.3);assert(e.x>x+20);});
test('毒瓶飞行后生成持续毒池，真实减速并造成持续伤害',()=>{const g=arena(),e=mob(g,1040);e.speed=80;g.cast('poison');assert.equal(g.pools.length,0);tick(g,.6);assert.equal(g.pools.length,1);const x=e.x,h=e.hp;tick(g,.5);assert(e.hp<h);assert(e.poison>0);assert(x-e.x<80*.5*.8);});
test('诅咒增加毒伤、降低接触伤害；双状态触发范围爆炸',()=>{const a=arena(),b=arena(),ea=mob(a),eb=mob(b);eb.curse=5;a.damage(ea,10,'poison');b.damage(eb,10,'poison');assert(2000-eb.hp>(2000-ea.hp)*1.7);const g=arena(),e=mob(g,900),near=mob(g,940);e.poison=2;e.stacks=1;g.cast('curse');assert(e.curse>0);const h=near.hp;tick(g,.05);assert(g.stats.combos>0);assert(near.hp<h);const c=arena(),ce=mob(c,801);ce.curse=5;tick(c,.05);assert(Math.abs((120-c.p.hp)-ce.damage*.6)<.01);});
test('尾击将怪物推入毒池，并触发诅咒与中毒联动',()=>{const g=arena(),e=mob(g,890);g.pools=[{x:960,y:500,r:43,life:8,total:8,seed:0}];e.curse=5;g.cast('tail');tick(g,.5);assert(e.x>920);assert(e.poison>0);assert(g.stats.combos>0);});
test('层叠强化提高真实毒素层数，毒池到期后状态消退',()=>{const g=arena(),e=mob(g);g.p.maxStacks=3;g.pools=[{x:e.x,y:e.y,r:70,life:2,total:2,seed:0}];tick(g,1.65);assert.equal(e.stacks,3);tick(g,4);assert.equal(e.poison,0);assert.equal(e.stacks,0);});
test('能量不足无法召集；足够时真实扣能量、横贯全屏并伤害敌人',()=>{const g=arena(),e=mob(g,1300,850);g.p.energy=20;assert(!g.cast('legion'));g.p.energy=100;assert(g.cast('legion'));assert.equal(g.p.energy,0);tick(g,1.7);assert(e.hp<1900);assert(!g.cast('legion'));});
test('远程音波先预警并锁定方向，站立会受伤、横移能够躲避',()=>{const run=dodge=>{const g=arena(),e=mob(g,500,500,'ranged');e.shootCd=0;g.update(.05);assert(e.attack&&e.attack.t===0);assert.equal(g.p.hp,120);tick(g,1.4,dodge?{y:1}:{});return g;};assert(run(false).p.hp<120);assert.equal(run(true).p.hp,120);});
test('击杀掉落可收集经验，升级随机三选一暂停，选择真实生效',()=>{const g=arena(),e=mob(g,810);g.damage(e,3000,'tail');assert.equal(g.stats.kills,1);assert.equal(g.crystals.length,1);g.p.xp=21;tick(g,.05);assert.equal(g.state,'upgrade');assert.equal(g.choices.length,3);assert.equal(new Set(g.choices.map(u=>u.id)).size,3);let t=g.time;g.update(.05,{x:1});assert.equal(g.time,t);const u=g.choices[0].id;assert(g.choose(0));assert.equal(g.build[u],1);assert.equal(g.state,'playing');});
test('所有强化均改变模拟属性，包含数量、范围、时长、冷却和联动',()=>{for(const u of upgrades){const g=arena(),before=JSON.stringify(g.p);u.apply(g);assert.notEqual(JSON.stringify(g.p),before,u.id);}});
test('时间增强血量与速度，精英敌潮按时出现，最后一分钟增加刷怪密度',()=>{const g=arena(),a=g.spawn();g.time=300;const b=g.spawn();assert(b.hp>a.hp&&b.speed>a.speed);g.time=119.99;g.update(.05);assert.equal(g.enemies.filter(e=>e.type==='elite').length,4);const early=arena();early.spawnClock=0;early.update(.05);const late=arena();late.time=550;late.nextElite=600;late.spawnClock=0;late.update(.05);assert(late.enemies.length>=early.enemies.length*5);});
test('生命归零失败，10 分钟生存胜利，重开完整清空状态',()=>{const g=arena();g.hit(9999);assert.equal(g.state,'dead');g.reset();assert.equal(g.p.hp,120);assert.equal(g.time,0);assert.equal(g.stats.kills,0);assert.equal(g.enemies.length,0);g.start();g.time=599.99;g.update(.05);assert.equal(g.state,'won');assert.equal(g.time,600);});
// Real simulation bot: no invulnerability, extra health, time skips, or damage overrides.
const bot=new Game(7519);bot.start();bot.skills[3].auto=true;let peakEnemies=0,latePeak=0,upgradesChosen=0;
for(let i=0;i<13000&&!['dead','won'].includes(bot.state);i++){
 if(bot.state==='upgrade'){
  const priorities={magnet:90,stacks:85,venom:82,haste:80,bottles:77,blast:75,energy:73,legion:70,reach:68,double:65,curse:60,frail:58,slow:56,pool:54,push:50,speed:49,fang:48,vital:45};
  const scores=bot.choices.map(u=>(priorities[u.id]||40)-(bot.build[u.id]||0)*9+(u.id==='vital'&&bot.p.hp<bot.p.maxHp*.6?130:0));bot.choose(scores.indexOf(Math.max(...scores)));upgradesChosen++;
 }
 const p=bot.p,t=bot.time;let tx=W/2+480*Math.cos(t*.18),ty=H/2+285*Math.sin(t*.18);
 let closest=null,best=Infinity;for(const c of bot.crystals){const d=dist(c,p);if(d<best){best=d;closest=c;}}
 if(closest&&best<250){let safe=true;for(const e of bot.enemies)if(dist(e,closest)<85){safe=false;break;}if(safe){tx=closest.x;ty=closest.y;}}
 let dx=tx-p.x,dy=ty-p.y,l=Math.max(1,Math.hypot(dx,dy));dx/=l;dy/=l;
 for(const e of bot.enemies){const d=dist(e,p);if(d<110&&d>1){const power=(110-d)/110*2;dx+=(p.x-e.x)/d*power;dy+=(p.y-e.y)/d*power;}}
 // Choose a heading against predicted contact and locked sonic telegraphs.
 let bestHeading={x:dx,y:dy},bestScore=-Infinity;
 for(let h=0;h<20;h++){const angle=h/20*Math.PI*2,hx=Math.cos(angle),hy=Math.sin(angle);let score=(hx*dx+hy*dy)*4;
  const fx=p.x+hx*p.speed*.65,fy=p.y+hy*p.speed*.65;if(fx<115||fx>W-115||fy<115||fy>H-115)score-=35;
  for(const e of bot.enemies){const distance=Math.hypot(fx-e.x,fy-e.y);if(distance<95)score-=(95-distance)*.35;if(e.attack){const a=e.attack,remain=1.35-a.t;const px=p.x+hx*p.speed*remain,py=p.y+hy*p.speed*remain,projection=(px-a.x)*a.dx+(py-a.y)*a.dy,cross=Math.abs((px-a.x)*a.dy-(py-a.y)*a.dx);if(projection>0&&projection<670&&cross<70)score-=(70-cross)*.8;}}
  if(score>bestScore){bestScore=score;bestHeading={x:hx,y:hy};}
 }
 bot.update(.05,bestHeading);bot.events=[];peakEnemies=Math.max(peakEnemies,bot.enemies.length);if(t>=540)latePeak=Math.max(latePeak,bot.enemies.length);
}
const report={passed:results.length,checks:results,fullRun:{...bot.snapshot(),peakEnemies,latePeak,upgradesChosen,invincible:bot.invincible}};
fs.writeFileSync(path.resolve(__dirname,'../combat-results.json'),JSON.stringify(report,null,2));console.log('BOT',JSON.stringify(report.fullRun));assert.equal(bot.state,'won','ordinary movement bot should survive the complete 10-minute run');console.log('PASS 真实规则下移动机器人完成 10 分钟生存');
