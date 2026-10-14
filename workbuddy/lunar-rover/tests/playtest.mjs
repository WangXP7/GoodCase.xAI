/* 月面运输 — 自动化试玩 / 回归验证（确定性步长版）
   真实无头浏览器 + 真实键鼠事件；长时间驾驶在页面内以固定步长推进，
   既快又不受无头环境 rAF 节流影响。 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PW = process.env.PW_MOD || 'C:/Users/wxppa/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const _pw = await import('file:///' + PW);
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);

/* 案例根目录：脚本位于 <case>/tests/ 下，故取上一级。这样从任意 cwd 运行都能找到 index.html 与 vendor/ */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EDGE = process.env.BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const T = { pass:0, fail:0, results:[] };
const LOG = [];
function ok(name, cond, detail){
  const r = { name, pass: !!cond, detail: detail===undefined?'':String(detail) };
  T.results.push(r); r.pass ? T.pass++ : T.fail++;
  console.log(`${r.pass?'PASS':'FAIL'}  ${name}${r.detail?'  — '+r.detail:''}`);
  return r.pass;
}
const info = m => { LOG.push(m); console.log('      ' + m); };

/* ---------- 本地静态服务 ---------- */
const MIME = {'.html':'text/html;charset=utf-8','.js':'text/javascript','.mjs':'text/javascript'};
const srv = http.createServer((req,res)=>{
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(p,(e,buf)=>{
    if(e){ res.writeHead(404); res.end('404'); return; }
    res.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});
    res.end(buf);
  });
});
await new Promise(r=>srv.listen(0,'127.0.0.1',r));
const URL = `http://127.0.0.1:${srv.address().port}/index.html`;

/* ---------- 浏览器 ---------- */
const browser = await chromium.launch({
  executablePath: EDGE, headless: true,
  args:['--no-sandbox','--disable-dev-shm-usage','--hide-scrollbars']
});
const page = await browser.newPage({ viewport:{width:1280,height:720} });
const consoleErr=[], pageErr=[];
page.on('console', m=>{ if(m.type()==='error') consoleErr.push(m.text()); });
page.on('pageerror', e=>pageErr.push(String(e && e.stack || e)));

const t0 = Date.now();
await page.goto(URL,{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>window.__LR && window.__LR.ready, null, {timeout:120000});
info(`启动完成 ${((Date.now()-t0)/1000).toFixed(1)}s`);

const S   = ()=>page.evaluate(()=>window.__LR.state);
const IN  = (o)=>page.evaluate(x=>window.__LR.setInput(x), o||null);
const tp  = (x,z,yaw)=>page.evaluate(a=>window.__LR.teleport(a[0],a[1],a[2]), [x,z,yaw===undefined?null:yaw]);
/* 推进 n 帧固定步长物理；render=true 时同时渲染并更新镜头/HUD */
const adv = (n, render=false, dt=1/60)=>page.evaluate(a=>window.__LR.frameStep(a[0],a[1],a[2]), [n,dt,render]);
const sec = (s, render=false)=>adv(Math.round(s*60), render);

/* ---------- 注入页面内测试驱动 ---------- */
await page.evaluate(()=>{
  const LR = window.__LR;
  const R_FWD = 1.45, R_CAR = 1.52, HOV = 1.18;

  /* 常量输入推进 */
  window.__RUN = function(inp, frames, sampleEvery){
    const st=[];
    for(let f=0;f<frames;f++){
      LR.setInput(inp);
      LR.frameStep(1,1/60,false);
      if(sampleEvery && f%sampleEvery===0){
        const s=LR.state;
        st.push({x:s.x,z:s.z,y:s.y,g:s.groundY,sp:s.speed,dr:s.drops,dv:s.delivered,ro:s.rolled,ai:s.airborne,ti:s.tilt,ba:s.battery});
      }
    }
    return {states:st, last:LR.state};
  };

  /* 自动驾驶：可传入单个目标或航点数组（沿运输通道行进） */
  window.__AUTO = function(targets, maxFrames, opt){
    opt = opt||{};
    const list = Array.isArray(targets) ? targets.slice() : [targets];
    const arriveR = opt.arriveR||15, arriveV = opt.arriveV||3.0;
    const wpR = opt.wpR || 16;
    const trail=[]; let stuck=0, reverseFor=0, minDist=1e9, wp=0, bumps=0, prevSp=0;
    for(let f=0; f<maxFrames; f++){
      const st = LR.state;
      const target = list[Math.min(wp, list.length-1)];
      const dx=target.x-st.x, dz=target.z-st.z, dist=Math.hypot(dx,dz);
      const lastWp = (wp >= list.length-1);
      if(lastWp) minDist=Math.min(minDist,dist);
      if(f%90===0) trail.push([Math.round(st.x),Math.round(st.z),+st.speed.toFixed(1)]);
      if(st.rolled) return {ok:false,why:'rolled',dist,frames:f,trail,minDist,wp};
      let err = Math.atan2(dx,dz)-st.yaw;
      while(err>Math.PI) err-=2*Math.PI;
      while(err<-Math.PI) err+=2*Math.PI;
      if(dist < (lastWp?arriveR:wpR)){
        if(lastWp && Math.abs(st.speed) < arriveV){
          LR.setInput({throttle:0,brake:1,steer:0});
          LR.frameStep(Math.round((opt.brakeSec||0.6)*60),1/60,false);
          LR.setInput(null);
          return {ok:true,dist,frames:f,trail,minDist,wp,drops:LR.state.drops};
        }
        if(lastWp){
          // 已进入终点半径但速度仍高于 arriveV：必须主动刹停。
          // 否则会落进 tgt±死区被判为「保持速度」，速度被钉在 arriveV 之上而永远不满足抵达条件。
          LR.setInput({throttle:0, brake:0.85, steer:Math.max(-1,Math.min(1, err*1.6))});
          LR.frameStep(1,1/60,false);
          continue;
        }
        wp++; continue;
      }
      const steer = Math.max(-1,Math.min(1, err*2.4));
      let tgt = opt.vmax||14;
      if(Math.abs(err)>0.4) tgt=Math.min(tgt,8);
      if(Math.abs(err)>0.9) tgt=Math.min(tgt,4.5);
      if(dist<70) tgt=Math.min(tgt,9);
      if(dist<36) tgt=Math.min(tgt,4.5);
      if(lastWp && dist<arriveR+10) tgt=Math.min(tgt,1.5);
      let throttle=0,brake=0;
      if(reverseFor>0){ brake=1; reverseFor--; }
      else if(st.speed<tgt-0.5) throttle=1;
      else if(st.speed>tgt+0.9) brake=0.8;
      else throttle=0.25;
      if(Math.abs(st.speed)<0.7 && throttle>0 && Math.abs(err)<1.4){ stuck++; if(stuck>120){ reverseFor=100; stuck=0; } }
      else if(Math.abs(st.speed)>1.5) stuck=0;
      if(st.speed<prevSp-2.5) bumps++;
      prevSp=st.speed;
      LR.setInput({throttle,brake,steer});
      LR.frameStep(1,1/60,false);
    }
    const st=LR.state;
    return {ok:false,why:'timeout',dist:Math.hypot(list[list.length-1].x-st.x,list[list.length-1].z-st.z),
            frames:maxFrames,trail,minDist,wp,bumps};
  };

  /* 沿运输通道生成航点 */
  window.__WP = function(route, target, step){
    step = step||34;
    const out=[]; const L=Math.hypot(route.bx-route.ax, route.bz-route.az);
    const n=Math.floor(L/step);
    for(let i=1;i<=n;i++){ const t=i/(n+1);
      out.push({x:route.ax+(route.bx-route.ax)*t, z:route.az+(route.bz-route.az)*t}); }
    out.push({x:target.x, z:target.z});
    return out;
  };

  /* 直线加速撞击某圆柱障碍（带横向纠偏，保证真的撞上） */
  window.__CRASH = function(o, frames, throttle, opts){
    opts = opts||{};
    const start = opts.start||0;
    const dirx = opts.dx||0, dirz = opts.dz||1;
    LR.teleport(o.x - dirx*start, o.z - dirz*start, Math.atan2(dirx,dirz));
    const res = {maxPen:-99,passed:false,minClear:9,maxSpeed:0,drops0:LR.state.drops,drops1:0,
                 contactFrames:0,trail:[],rolled:false};
    for(let f=0;f<frames;f++){
      const s0=LR.state;
      let err = Math.atan2(o.x-s0.x, o.z-s0.z) - s0.yaw;
      while(err>Math.PI) err-=2*Math.PI;
      while(err<-Math.PI) err+=2*Math.PI;
      const steer = opts.steer===false ? 0 : Math.max(-0.8,Math.min(0.8, err*1.6));
      LR.setInput({throttle, brake:0, steer});
      LR.frameStep(1,1/60,false);
      const st = LR.state;
      const s=Math.sin(st.yaw), c=Math.cos(st.yaw);
      const fx=st.x+s*R_FWD, fz=st.z+c*R_FWD;
      const pen=(o.r+R_CAR)-Math.hypot(fx-o.x,fz-o.z);
      if(pen>res.maxPen) res.maxPen=pen;
      res.minClear=Math.min(res.minClear, st.y-st.groundY);
      res.maxSpeed=Math.max(res.maxSpeed,st.speed);
      if(Math.hypot(st.x-o.x, st.z-o.z) > start*0.75 && (st.speed<0) === false){}
      if(Math.hypot(st.x-o.x, st.z-o.z) > o.r + R_CAR + 6 &&
         ((st.x-o.x)*dirx+(st.z-o.z)*dirz) > 0) res.passed=true;
      if(st.contact) res.contactFrames++;
      if(st.rolled){ res.rolled=true; break; }
      if(f%15===0) res.trail.push([Math.round(st.x),Math.round(st.z),+st.speed.toFixed(1)]);
    }
    res.drops1=LR.state.drops;
    res.last=LR.state;
    return res;
  };

  /* 沿路线行驶并记录是否在「高速」状态下发生了交付 */
  window.__PASSBY = function(target, frames, throttle){
    const res={minDist:1e9,deliveredFast:false,deliveredSlow:false,maxSpeedInZone:0,dv0:LR.state.delivered};
    for(let f=0;f<frames;f++){
      LR.setInput({throttle,brake:0,steer:0});
      LR.frameStep(1,1/60,false);
      const st=LR.state;
      const d=Math.hypot(st.x-target.x,st.z-target.z);
      res.minDist=Math.min(res.minDist,d);
      if(d<target.deliverR+9){
        res.maxSpeedInZone=Math.max(res.maxSpeedInZone,Math.abs(st.speed));
        if(st.delivered>res.dv0){ if(Math.abs(st.speed)>3.0) res.deliveredFast=true; else res.deliveredSlow=true; }
      }
      if(st.rolled) break;
    }
    res.last=LR.state;
    return res;
  };

  /* ---------- 栅格导航 A*：绕开岩石 / 建筑 / 陡坡 ---------- */
  window.__NAV = function(tx, tz, opt){
    opt = opt||{};
    const CELL = opt.cell||4, CLEAR = opt.clear===undefined?2.4:opt.clear;
    const HW = 450, N = Math.ceil(900/CELL), SIZE = N*N;
    const H = LR.terrainH;
    if (!window.__NAVG || window.__NAVG.N!==N || window.__NAVG.CLEAR!==CLEAR){
      const blocked = new Uint8Array(SIZE);
      const O = LR.obstacles;
      const rr = O.map(o => (o.type==='cyl' ? o.r : Math.hypot(o.hx,o.hz)) + CLEAR);
      for (let i=0;i<N;i++){
        const x = -HW + (i+0.5)*CELL;
        for (let j=0;j<N;j++){
          const z = -HW + (j+0.5)*CELL;
          let b = 0;
          for (let k=0;k<O.length;k++){
            const ob = O[k], r2 = rr[k];
            if (Math.abs(x-ob.x) > r2 || Math.abs(z-ob.z) > r2) continue;   // 先做便宜的包围盒筛选
            if (Math.hypot(x-ob.x, z-ob.z) < r2){ b = 1; break; }
          }
          if (!b){
            const gx = (H(x+1.5,z)-H(x-1.5,z))/3, gz = (H(x,z+1.5)-H(x,z-1.5))/3;
            if (Math.hypot(gx,gz) > 1.20) b = 1;                            // 坡度 >49° 视为不可通行
          }
          blocked[j*N+i] = b;
        }
      }
      window.__NAVG = {N, CELL, CLEAR, blocked, builds:0};
    }
    const g = window.__NAVG, B = g.blocked; g.builds++;
    const at = (i,j)=> j*N+i;
    const free = (i,j)=> i>=0 && j>=0 && i<N && j<N && B[at(i,j)]===0;
    const ci = x => Math.max(0, Math.min(N-1, Math.floor((x+HW)/CELL)));
    const wx = i => -HW + (i+0.5)*CELL;
    const near = (i0,j0)=>{
      if (free(i0,j0)) return [i0,j0];
      for (let rad=1; rad<16; rad++)
        for (let di=-rad; di<=rad; di++) for (let dj=-rad; dj<=rad; dj++){
          if (Math.max(Math.abs(di),Math.abs(dj))!==rad) continue;
          if (free(i0+di, j0+dj)) return [i0+di, j0+dj];
        }
      return null;
    };
    const s = LR.state;
    const a = near(ci(s.x), ci(s.z)), b = near(ci(tx), ci(tz));
    if (!a || !b) return {wps:[{x:tx,z:tz}], why:'nogrid'};
    const si=a[0], sj=a[1], ti=b[0], tj=b[1];
    const gs = new Float32Array(SIZE).fill(Infinity);
    const came = new Int32Array(SIZE).fill(-1);
    const heap=[];
    const push=(f,i,j)=>{ heap.push([f,i,j]); let c=heap.length-1;
      while(c>0){ const p=(c-1)>>1; if(heap[p][0]<=heap[c][0]) break; const t=heap[p]; heap[p]=heap[c]; heap[c]=t; c=p; } };
    const pop=()=>{ const top=heap[0], last=heap.pop();
      if (heap.length){ heap[0]=last; let c=0;
        for(;;){ const l=2*c+1, r=l+1; let m=c;
          if (l<heap.length && heap[l][0]<heap[m][0]) m=l;
          if (r<heap.length && heap[r][0]<heap[m][0]) m=r;
          if (m===c) break; const t=heap[m]; heap[m]=heap[c]; heap[c]=t; c=m; } }
      return top; };
    const hv = (i,j)=> Math.hypot(i-ti, j-tj);
    gs[at(si,sj)] = 0; push(hv(si,sj), si, sj);
    let found = false, guard = 0;
    while (heap.length && guard++ < 400000){
      const cur = pop(); const a2 = cur[1], b2 = cur[2];
      if (a2===ti && b2===tj){ found = true; break; }
      const g0 = gs[at(a2,b2)];
      for (let di=-1;di<=1;di++) for (let dj=-1;dj<=1;dj++){
        if (!di && !dj) continue;
        const ni=a2+di, nj=b2+dj;
        if (!free(ni,nj)) continue;
        if (di && dj && (!free(a2+di,b2) || !free(a2,b2+dj))) continue;      // 不允许斜穿障碍角
        const ng = g0 + ((di&&dj) ? 1.41421 : 1);
        const id = at(ni,nj);
        if (ng < gs[id]){ gs[id]=ng; came[id]=at(a2,b2); push(ng + hv(ni,nj), ni, nj); }
      }
    }
    if (!found) return {wps:[{x:tx,z:tz}], why:'nopath'};
    const cells=[]; let cur = at(ti,tj);
    while (cur>=0){ cells.push([cur%N, Math.floor(cur/N)]); cur = came[cur]; }
    cells.reverse();
    const los = (i0,j0,i1,j1)=>{
      const n = Math.max(Math.abs(i1-i0), Math.abs(j1-j0));
      for (let k=1;k<=n;k++){
        if (!free(Math.round(i0+(i1-i0)*k/n), Math.round(j0+(j1-j0)*k/n))) return false;
      }
      return true;
    };
    const pts=[cells[0]]; let anchor=0;
    for (let k=2;k<cells.length;k++){
      if (!los(cells[anchor][0],cells[anchor][1],cells[k][0],cells[k][1])){ pts.push(cells[k-1]); anchor=k-1; }
    }
    pts.push(cells[cells.length-1]);
    const wps = pts.slice(1).map(p=>({x:wx(p[0]), z:wx(p[1])}));
    if (!wps.length || Math.hypot(wps[wps.length-1].x-tx, wps[wps.length-1].z-tz) > 2) wps.push({x:tx, z:tz});
    return {wps, cells:cells.length, grid:{N, builds:g.builds}};
  };

  /* 低速精确接近并停进装货圈。
     月面车低速时转弯半径只有 1~2 m，所以「越近越慢」才能收敛；
     恒速接近会画出 3 m 以上的圆圈而永远靠不上去。 */
  window.__CREEP = function(crateName, crate, frames){
    const pickR = LR.state.pickR || 5.0;
    let best=1e9, noGain=0, reverseFor=0, rolledFor=0, resets=0, retreats=0, holdFrames=0, stuckHard=0;
    const trail=[];
    for(let f=0;f<frames;f++){
      const st=LR.state;
      const c=st.cargo.find(x=>x.name===crateName);
      if(!c || c.state!=='dropped') return {ok:true, frames:f, dist:best, resets, retreats, trail};
      if(c.x===null||c.z===null) return {ok:true, frames:f, dist:best, resets, retreats, trail};
      if(st.rolled){                                    // 翻覆时车辆失去动力，必须先复位
        rolledFor++;
        if(rolledFor>40){ LR.respawn(); resets++; rolledFor=0; trail.push({f, reset:true}); }
        LR.setInput({throttle:0,brake:0,steer:0});
        LR.frameStep(1,1/60,false);
        continue;
      }
      rolledFor=0;
      crate.x=c.x; crate.z=c.z;
      const dx=crate.x-st.x, dz=crate.z-st.z, d=Math.hypot(dx,dz);
      if(d < best-0.05){ best=d; noGain=0; } else noGain++;
      if(f%90===0) trail.push({f, d:+d.toFixed(1), v:+st.speed.toFixed(1)});
      let err=Math.atan2(dx,dz)-st.yaw;
      while(err>Math.PI) err-=2*Math.PI;
      while(err<-Math.PI) err+=2*Math.PI;
      const v=st.speed;
      const steer=Math.max(-1,Math.min(1, err*(d<12?3.2:1.9)));
      let throttle=0, brake=0;
      if(reverseFor>0){ reverseFor--; brake=1; }
      else if(d > pickR*0.72){
        const vT = Math.max(1.0, Math.min(6.0, d*0.34));
        if(v < vT*0.90) throttle = d>20 ? 0.62 : 0.34;
        else if(v > vT*1.15) brake = 0.30;
      } else {
        holdFrames++;                                    // 进入装货圈就刹停，否则会被开出圈外导致 pickProg 清零
        if(v > 0.30) brake = 0.5;
      }
      // 顶着障碍几乎不动（接触且无速度）→ 倒车脱离再重新对准
      if(throttle>0 && Math.abs(v)<0.7 && st.contact) stuckHard++;
      else stuckHard = Math.max(0, stuckHard-2);
      if(d > pickR*0.72){                                // 装货圈内停住属于正常，不触发脱离
        if(stuckHard>90 && reverseFor<=0){ reverseFor=90; stuckHard=0; retreats++; trail.push({f, retreat:true, d:+d.toFixed(1)}); }
        else if(noGain>210 && reverseFor<=0){ reverseFor=100; noGain=0; retreats++; trail.push({f, retreat:true, d:+d.toFixed(1)}); }
      }
      LR.setInput({throttle, brake, steer});
      LR.frameStep(1,1/60,false);
    }
    return {ok:false, frames:frames, dist:best, holdFrames, resets, retreats, trail,
            state:(LR.state.cargo.find(x=>x.name===crateName)||{}).state};
  };

  /* 回收掉落货物：栅格导航绕开障碍驶到货物旁 → 低速精确装车。
     第一次走直取，失败则依次从四个（及两个斜向）方位接近，
     因为货物常常滚到岩石背面，只有一个方位进得去。 */
  window.__PICKUP = function(crateName, crate, frames){
    const log=[];
    const bears=[null, 0, 1.5708, 3.1416, -1.5708, 0.7854, -2.3562];
    for(let bi=0; bi<bears.length; bi++){
      const s=LR.state;
      const c=s.cargo.find(x=>x.name===crateName);
      if(!c || c.state!=='dropped') return {ok:true, dist:0, log};
      crate.x=c.x; crate.z=c.z;
      const bear=bears[bi];
      const br=8.0;
      const goal = (bear===null) ? {x:c.x, z:c.z} : {x:c.x+Math.cos(bear)*br, z:c.z+Math.sin(bear)*br};
      const nav = window.__NAV(goal.x, goal.z, {clear:2.2});
      const r1 = window.__AUTO(nav.wps, 5400, {wpR:8, arriveR:bear===null?6.5:5.5, arriveV:3.4, vmax:11});
      const r2 = window.__CREEP(crateName, crate, frames);
      log.push({a:bi+1, bear:(bear===null?'直取':Math.round(bear*57.3)+'°'),
                wps:nav.wps.length, why:nav.why||null, nav:r1.ok, creep:r2.ok,
                d:+r2.dist.toFixed(1), resets:r2.resets, retreats:r2.retreats});
      if(r2.ok) return {ok:true, dist:r2.dist, nav:r1.ok, creep:r2.ok, resets:r2.resets,
                        retreats:r2.retreats, attempts:bi+1, log};
      if(r2.resets) { /* 翻覆已复位，继续下一次尝试 */ }
    }
    const last=log[log.length-1]||{};
    return {ok:false, dist:last.d, attempts:log.length, log,
            state:(LR.state.cargo.find(x=>x.name===crateName)||{}).state};
  };

  /* 沿运输通道网络规划航点：不在目标通道上时先退回中央装卸区再出发 */
  window.__PLAN = function(targetIdx, step){
    step = step||34;
    const st=LR.state, B=window.__LR.bases(), R=window.__LR.routes(), H=window.__LR.hub();
    const proj=(r,px,pz)=>{
      const vx=r.bx-r.ax, vz=r.bz-r.az, L2=vx*vx+vz*vz;
      const t=((px-r.ax)*vx+(pz-r.az)*vz)/L2;
      const tc=Math.max(0,Math.min(1,t));
      const qx=r.ax+vx*tc, qz=r.az+vz*tc;
      return {t, tc, d:Math.hypot(px-qx,pz-qz)};
    };
    const pts=(r, t0, t1)=>{
      const L=Math.hypot(r.bx-r.ax,r.bz-r.az), n=Math.max(1,Math.round(L/step)), out=[];
      for(let i=1;i<=n;i++){
        const t=t0+(t1-t0)*(i/n);
        out.push({x:r.ax+(r.bx-r.ax)*t, z:r.az+(r.bz-r.az)*t});
      }
      return out;
    };
    const tgt={x:B[targetIdx].x, z:B[targetIdx].z};
    let near=null;
    for(let i=0;i<R.length;i++){
      const p=proj(R[i], st.x, st.z);
      if(!near || p.d<near.d) near={i, d:p.d, t:p.tc};
    }
    let out=[];
    if (near && near.d < 55 && near.i === targetIdx){
      out = out.concat(pts(R[near.i], near.t, 1));
    } else if (near && near.d < 55){
      out = out.concat(pts(R[near.i], near.t, 0));
      out.push({x:H.x, z:H.z});
      out = out.concat(pts(R[targetIdx], 0, 1));
    } else {
      out.push({x:H.x, z:H.z});
      out = out.concat(pts(R[targetIdx], 0, 1));
    }
    out.push(tgt);
    return {wps:out, near:{i:near?near.i:-1, d:near?+near.d.toFixed(1):null}};
  };

  /* 平地手刹测试 */
  window.__BRAKE_TEST = function(seconds){
    const out={start:LR.state.speed,end:0,airFrames:0,groundFrames:0,minSpeed:99};
    for(let f=0;f<seconds*60;f++){
      LR.setInput({throttle:0,brake:0,steer:0,handbrake:1});
      LR.frameStep(1,1/60,false);
      const s2=LR.state;
      if(s2.airborne) out.airFrames++; else out.groundFrames++;
      out.minSpeed=Math.min(out.minSpeed,s2.speed);
    }
    out.end=LR.state.speed;
    LR.setInput(null);
    return out;
  };

  /* 冲过坡顶 → 检查腾空（低重力滞空） */
  window.__JUMP = function(crest, dirx, dirz, startDist, frames){
    LR.teleport(crest.x-dirx*startDist, crest.z-dirz*startDist, Math.atan2(dirx,dirz));
    const out={airFrames:0,maxH:0,maxVy:0,maxSpeed:0,trail:[]};
    for(let f=0;f<frames;f++){
      LR.setInput({throttle:1,brake:0,steer:0});
      LR.frameStep(1,1/60,false);
      const st=LR.state;
      out.maxSpeed=Math.max(out.maxSpeed,st.speed);
      if(st.airborne){
        out.airFrames++;
        out.maxH=Math.max(out.maxH, st.y-st.groundY);
        out.maxVy=Math.max(out.maxVy, -st.vy);
      }
      if(f%20===0) out.trail.push([Math.round(st.x),Math.round(st.z),+st.speed.toFixed(1),st.airborne?1:0]);
      if(st.rolled) break;
    }
    LR.setInput(null);
    out.last=LR.state;
    return out;
  };
});

/* ================= T0 启动 / 渲染 ================= */
{
  const a = await S();
  const f0 = await page.evaluate(()=>window.__LR.state.frames);
  const raf = await page.evaluate(()=>new Promise(r=>{ let n=0; const t=performance.now();
    function f(){ n++; if(performance.now()-t<3000) requestAnimationFrame(f); else r(n/((performance.now()-t)/1000)); }
    requestAnimationFrame(f); }));
  const f1 = await page.evaluate(()=>window.__LR.state.frames);
  ok('T0.1 three.js 加载并初始化完成', a && typeof a.x==='number');
  info(`真实动画帧率 ${raf.toFixed(1)} fps（请求动画帧实测），循环内帧计数 ${f0} → ${f1}`);
  ok('T0.2 实时渲染循环稳定运行', raf > 20 && f1 > f0, `${raf.toFixed(1)} fps`);
  const ms = await page.evaluate(()=>{ const t=performance.now(); window.__LR.frameStep(6,1/60,true); return (performance.now()-t)/6; });
  info(`物理+渲染一帧耗时 ${ms.toFixed(2)} ms`);
  ok('T0.3 单帧耗时满足实时交互', ms < 34, `${ms.toFixed(2)} ms/frame（<34ms 即 ≥30fps）`);
  const cv = await page.evaluate(()=>{ const c=document.querySelector('canvas'); return {w:c.width,h:c.height,webgl:!!c.getContext('webgl2')||!!c.getContext('webgl')}; });
  ok('T0.4 WebGL 画布正常', cv.w>200 && cv.h>150 && cv.webgl, `${cv.w}x${cv.h}`);
  await page.evaluate(()=>window.__LR.setTimeScale(1));
}

/* ================= T1 开始任务 ================= */
{
  await page.click('#btnStart');
  await sec(1, true);
  const st = await S();
  ok('T1.1 点击开始进入任务', st.started===true);
  ok('T1.2 三箱货物初始都在车斗', st.cargo.every(c=>c.state==='loaded'), st.cargo.map(c=>c.name+':'+c.state).join(', '));
  ok('T1.3 初始未送达、无掉落', st.delivered===0 && st.drops===0);
  ok('T1.4 HUD 已显示', await page.evaluate(()=>document.getElementById('hud').classList.contains('on')));
  ok('T1.5 起始电量 100%', Math.round(st.battery)===100, st.battery.toFixed(1));
  ok('T1.6 车辆停在装卸区地面', st.y-st.groundY>0.9 && st.y-st.groundY<1.6, `离地 ${(st.y-st.groundY).toFixed(2)} m`);
  // 出站口 / 通道起始段必须留出可通行宽度（防止程序化建筑堵路）
  const clear = await page.evaluate(()=>{
    const O=window.__LR.obstacles, B=window.__LR.bases(), st=window.__LR.state;
    const dObs=(px,pz,o)=>{
      if(o.type==='cyl') return Math.hypot(px-o.x,pz-o.z)-o.r;
      const cs=Math.cos(o.rot), sn=Math.sin(o.rot);
      const dx=px-o.x, dz=pz-o.z;
      const lx=dx*cs+dz*sn, lz=-dx*sn+dz*cs;
      const qx=Math.max(-o.hx,Math.min(o.hx,lx)), qz=Math.max(-o.hz,Math.min(o.hz,lz));
      return Math.hypot(lx-qx,lz-qz);
    };
    const seg=(ax,az,bx,bz,len,name)=>{
      const L=Math.hypot(bx-ax,bz-az), ux=(bx-ax)/L, uz=(bz-az)/L;
      let worst=99, at=null, near=null;
      for(let k=0;k<=80;k++){
        const f=k/80, px=ax+ux*len*f, pz=az+uz*len*f;
        for(const o of O){
          const d=dObs(px,pz,o);
          if(d<worst){ worst=d; at={x:+o.x.toFixed(0),z:+o.z.toFixed(0),type:o.type}; near=[+px.toFixed(0),+pz.toFixed(0)]; }
        }
      }
      return {name, worst:+worst.toFixed(2), at, near};
    };
    return [ seg(st.x,st.z,B[0].x,B[0].z,48,'出站→静海'),
             seg(0,0,B[0].x,B[0].z,55,'通道→静海'),
             seg(0,0,B[1].x,B[1].z,55,'通道→月溪'),
             seg(0,0,B[2].x,B[2].z,55,'通道→南极') ];
  });
  ok('T1.7 出站口与三条通道起始段留有足够通行宽度', clear.every(c=>c.worst>2.2),
     clear.map(c=>`${c.name} ${c.worst}m`).join(' / '));
  info('通道净宽明细 ' + JSON.stringify(clear));
}

/* ================= T2 真实键盘：加速/制动/转向/手刹 ================= */
{
  await IN(null);
  const st0 = await S();
  await page.keyboard.down('w');
  await sec(3);
  const st1 = await S();
  await page.keyboard.up('w');
  ok('T2.1 W 键加速有效', st1.speed>7, `${st0.speed.toFixed(2)} → ${st1.speed.toFixed(2)} m/s`);
  ok('T2.2 加速过程贴着地面行驶', st1.y-st1.groundY>0.6 && st1.y-st1.groundY<1.7, `离地 ${(st1.y-st1.groundY).toFixed(2)} m`);
  await page.keyboard.down('s');
  await sec(1.5);
  const st2 = await S();
  await page.keyboard.up('s');
  ok('T2.3 S 键制动减速', st2.speed < st1.speed-3, `${st1.speed.toFixed(2)} → ${st2.speed.toFixed(2)} m/s`);
  // 制动距离（低重力下应明显长）
  await IN({throttle:1,brake:0,steer:0}); await sec(4); await IN(null);
  const vb = await S();
  const d0 = {x:vb.x,z:vb.z};
  await page.keyboard.down('s'); await sec(3); await page.keyboard.up('s');
  const vb2 = await S();
  const brakeDist = Math.hypot(vb2.x-d0.x, vb2.z-d0.z);
  info(`从 ${vb.speed.toFixed(1)} m/s 全力制动 3s，滑行 ${brakeDist.toFixed(1)} m（末速 ${vb2.speed.toFixed(2)}）`);
  ok('T2.4 制动是渐进滑移而不是瞬间刹死（低重力低抓地）', brakeDist > 8, `制动滑行 ${brakeDist.toFixed(1)} m`);
  // 转向
  const y0 = (await S()).yaw;
  await page.keyboard.down('w'); await page.keyboard.down('a'); await sec(2);
  const st3 = await S();
  await page.keyboard.up('a'); await page.keyboard.up('w');
  const dYaw = Math.abs(((st3.yaw-y0+Math.PI*3)%(Math.PI*2))-Math.PI);
  ok('T2.5 A 键左转改变航向', dYaw>0.2, `Δyaw ${(dYaw*180/Math.PI).toFixed(0)}°`);
  await IN(null); await sec(1);
  // 手刹：在平整贴地状态下验证制动
  await IN(null); await adv(4);
  const flat = await page.evaluate(()=>{
    const H=window.__LR.terrainH, O=window.__LR.obstacles;
    let best=null;
    for(let x=-280;x<=280;x+=17){ for(let z=-280;z<=280;z+=17){
      const e=6, gx=(H(x+e,z)-H(x-e,z))/(2*e), gz=(H(x,z+e)-H(x,z-e))/(2*e);
      const s=Math.hypot(gx,gz);
      if(best && s>best.s) continue;
      let ok=true;
      for(let k=-45;k<=45 && ok;k+=5){
        const px=x, pz=z+k;
        for(const o of O){ if(Math.hypot(px-o.x,pz-o.z) < o.r+4){ ok=false; break; } }
      }
      if(ok) best={x,z,s:+s.toFixed(3)};
    }}
    return best;
  });
  await tp(flat.x, flat.z, 0);
  await page.evaluate(()=>window.__RUN({throttle:1,brake:0,steer:0},150,0));
  await IN(null); await adv(3);
  await page.keyboard.down('Space');
  const bt = await page.evaluate(()=>{
    const out={start:window.__LR.state.speed, airFrames:0, groundFrames:0, hbSeen:0};
    for(let f=0;f<156;f++){
      window.__LR.frameStep(1,1/60,false);
      const s=window.__LR.state;
      if(s.input.handbrake>0) out.hbSeen++;
      if(s.airborne) out.airFrames++; else out.groundFrames++;
    }
    out.end=window.__LR.state.speed;
    return out;
  });
  await page.keyboard.up('Space');
  ok('T2.6 空格手刹在贴地状态下有效制动', bt.end < bt.start-3 && bt.hbSeen>140,
     `${bt.start.toFixed(2)} → ${bt.end.toFixed(2)} m/s（手刹生效帧 ${bt.hbSeen}/156，贴地帧 ${bt.groundFrames}，腾空帧 ${bt.airFrames}，地面坡度 ${flat.s}）`);
  await IN(null);
}

/* ================= T3 低重力手感：上坡减速 / 下坡加速 ================= */
{
  const spot = await page.evaluate(()=>{
    const H=window.__LR.terrainH, O=window.__LR.obstacles;
    let best=null;
    for(let x=-280;x<=280;x+=11){ for(let z=-280;z<=280;z+=11){
      const e=6, gx=(H(x+e,z)-H(x-e,z))/(2*e), gz=(H(x,z+e)-H(x,z-e))/(2*e);
      const s=Math.hypot(gx,gz);
      if(s<0.22||s>0.58) continue;
      const ux=gx/s, uz=gz/s;
      let score=s, clear=0;
      for(let k=-70;k<=70;k+=5){
        const px=x+ux*k, pz=z+uz*k;
        if(Math.abs(px)>390||Math.abs(pz)>390){ score-=1; break; }
        const e2=6, a=(H(px+e2,pz)-H(px-e2,pz))/(2*e2), b=(H(px,pz+e2)-H(px,pz-e2))/(2*e2);
        const ss=Math.hypot(a,b);
        if(ss<0.12) score-=0.03;
        if(Math.abs((a*ux+b*uz)/Math.max(ss,1e-6))<0.8) score-=0.05;      // 坡度方向不一致
        for(const o of O){ if(Math.hypot(px-o.x,pz-o.z) < o.r+4){ score-=0.6; break; } }
        clear++;
      }
      if(!best || score>best.score) best={x,z,s,gx,gz,score,clear};
    }}
    return best;
  });
  ok('T3.1 找到坡度均匀、无障碍的试验坡面', !!spot && spot.s>0.2,
     spot? `坡度 ${(Math.atan(spot.s)*180/Math.PI).toFixed(1)}° @ ${spot.x.toFixed(0)},${spot.z.toFixed(0)}（评分 ${spot.score.toFixed(2)}）` : 'none');
  if (spot){
    const upYaw = Math.atan2(spot.gx, spot.gz), downYaw = upYaw+Math.PI;
    const accelerate = async(yaw)=>{ await tp(spot.x,spot.z,yaw); await sec(0.3);
      const r = await page.evaluate(a=>window.__RUN({throttle:1,brake:0,steer:0},300,150), 0);
      const st = await S(); await IN(null); return st; };
    const vUp = await accelerate(upYaw);
    const vDown = await accelerate(downYaw);
    ok('T3.2 同油门下上坡明显掉速（比下坡慢）', vDown.speed - vUp.speed > 1.5,
       `上坡 ${vUp.speed.toFixed(2)} / 下坡 ${vDown.speed.toFixed(2)} m/s（差 ${(vDown.speed-vUp.speed).toFixed(2)}）`);
    // 溜车对比：同初速自由滑行
    const coast = async(yaw)=>{
      await tp(spot.x,spot.z,yaw); await sec(0.3);
      await page.evaluate(()=>window.__RUN({throttle:1,brake:0,steer:0},80,0));
      const a = await S();
      await page.evaluate(()=>window.__RUN({throttle:0,brake:0,steer:0},180,0));
      const b = await S(); await IN(null);
      return {v0:a.speed, v1:b.speed};
    };
    const cUp = await coast(upYaw), cDown = await coast(downYaw);
    info(`自由滑行 3s：上坡 ${cUp.v0.toFixed(2)}→${cUp.v1.toFixed(2)} / 下坡 ${cDown.v0.toFixed(2)}→${cDown.v1.toFixed(2)} m/s`);
    ok('T3.3 下坡溜车明显比上坡快（月面重力分量）', (cDown.v1-cDown.v0) - (cUp.v1-cUp.v0) > 1.5,
       `Δv 下坡 ${(cDown.v1-cDown.v0).toFixed(2)} / 上坡 ${(cUp.v1-cUp.v0).toFixed(2)} m/s`);
    ok('T3.4 低速时下坡会自行溜车（无需动力）', cDown.v1 > cUp.v1 + 1.5, `下坡末速 ${cDown.v1.toFixed(2)} m/s`);
    // 腾空：高速冲过凸起坡顶应出现腾空（低重力 → 飘）
    const crest = await page.evaluate(()=>{
      const H=window.__LR.terrainH, O=window.__LR.obstacles;
      const dirs=[[1,0],[0,1],[0.707,0.707],[-0.707,0.707],[0.707,-0.707],[-1,0],[0,-1],[-0.707,-0.707]];
      let best=null;
      for(let x=-250;x<=250;x+=9){ for(let z=-250;z<=250;z+=9){
        const h0=H(x,z);
        for(const d of dirs){
          const hb=H(x-d[0]*26, z-d[1]*26), hf=H(x+d[0]*26, z+d[1]*26);
          if(hb < h0+0.8) continue;            // 来路必须是上坡
          if(hf > h0-3.5) continue;            // 前方必须明显下坠
          let ok=true;
          for(let k=1;k<=78 && ok;k+=6){
            const px=x-d[0]*k, pz=z-d[1]*k;
            if(Math.abs(px)>380||Math.abs(pz)>380){ ok=false; break; }
            for(const o of O){ if(Math.hypot(px-o.x,pz-o.z) < o.r+3.5){ ok=false; break; } }
          }
          if(!ok) continue;
          const score=(h0-hf)+(hb-h0)*0.5;
          if(!best || score>best.score) best={x,z,ux:d[0],uz:d[1],score:+score.toFixed(1),drop:+(hf-h0).toFixed(1)};
        }
      }}
      return best;
    });
    if (!crest) info('未找到适合的凸起坡顶，跳过腾空验证');
    else {
      const jump = await page.evaluate(c=>window.__JUMP(c, c.ux, c.uz, 78, 700), crest);
      ok('T3.5 高速冲过坡顶会腾空（低重力滞空）', jump.airFrames > 0,
         `腾空 ${(jump.airFrames/60).toFixed(2)}s / 最高离地 ${jump.maxH.toFixed(2)} m / 入坡车速 ${jump.maxSpeed.toFixed(1)} m/s（坡顶落差 ${crest.drop} m）`);
    }
  }
}

/* ================= T4 岩石碰撞：不穿透 / 不陷地 ================= */
let usedRock = null;
{
  const rock = await page.evaluate(()=>{
    const O=window.__LR.obstacles, H=window.__LR.terrainH;
    let best=null;
    for(const o of O){
      if(o.type!=='cyl'||o.r<3.0||o.r>6.5) continue;
      if(Math.abs(o.x)>330||Math.abs(o.z)>330) continue;
      const sz=o.z-70, sx=o.x;
      if(sz<-400) continue;
      let ok=true, maxStep=0;
      for(let k=0;k<70&&ok;k+=3){
        const pz=sz+k;
        if(H(sx,sz) - H(sx,pz) > 6) ok=false;              // 起始段不能是陡上坡
        for(const p of O){ if(p===o) continue;
          if(p.type==='cyl' && Math.hypot(sx-p.x,pz-p.z)<p.r+3.2){ ok=false; break; } }
      }
      if(ok && (!best||o.r>best.r)) best={x:o.x,z:o.z,r:o.r};
    }
    return best;
  });
  ok('T4.1 找到测试岩石与净空助跑道', !!rock, rock? `半径 ${rock.r.toFixed(1)} m @ ${rock.x.toFixed(0)},${rock.z.toFixed(0)}`:'none');
  if (rock){
    usedRock = rock;
    const res = await page.evaluate(r=>window.__CRASH(r, 900, 1, {start:70, dx:0, dz:1}), rock);
    info(`撞击轨迹 ${JSON.stringify(res.trail.slice(-6))}`);
    ok('T4.2 车辆未穿透岩石', !res.passed, `最终 z=${res.last.z.toFixed(1)}，岩石 z=${rock.z.toFixed(1)}`);
    ok('T4.3 最大穿透深度在容差内', res.maxPen < 0.5, `maxPen ${res.maxPen.toFixed(3)} m`);
    ok('T4.4 撞击前达到较高车速（确实发生了高速碰撞）', res.maxSpeed > 8, `最高 ${res.maxSpeed.toFixed(1)} m/s`);
    ok('T4.5 全程未沉入地面', res.minClear > 0.55, `最小离地 ${res.minClear.toFixed(2)} m`);
    ok('T4.6 碰撞被检测到（接触标记）', res.contactFrames > 0, `接触帧 ${res.contactFrames}`);
  }
}

/* ================= T5 高速撞击 → 货物掉落；低速不甩货 ================= */
{
  const rock = await page.evaluate(()=>{
    const O=window.__LR.obstacles, H=window.__LR.terrainH;
    let best=null;
    for(const o of O){
      if(o.type!=='cyl'||o.r<3.2||o.r>6.5) continue;
      const sz=o.z-110, sx=o.x;
      if(Math.abs(sx)>300||sz<-380) continue;
      let ok=true;
      for(let k=0;k<110&&ok;k+=3){ const pz=sz+k;
        for(const p of O){ if(p===o) continue;
          if(p.type==='cyl'&&Math.hypot(sx-p.x,pz-p.z)<p.r+3.4){ ok=false; break; } } }
      if(ok && (!best||o.r>best.r)) best={x:o.x,z:o.z,r:o.r};
    }
    return best;
  });
  if (!rock) ok('T5.0 找到高速撞击试验岩石', false, 'none');
  else {
    const before = await S();
    const res = await page.evaluate(r=>window.__CRASH(r, 1100, 1, {start:110, dx:0, dz:1}), rock);
    const after = await S();
    info(`撞击最高车速 ${res.maxSpeed.toFixed(1)} m/s，掉落次数 ${before.drops} → ${after.drops}`);
    ok('T5.1 高速撞击导致货物甩出车斗', after.drops > before.drops, `drops=${after.drops}，货物状态 ${after.cargo.map(c=>c.state).join('/')}`);
    const d = after.cargo.find(c=>c.state==='dropped');
    ok('T5.2 掉落货物是独立世界物体（可回收）', !!d && d.x!==null, d? `@ ${d.x.toFixed(0)},${d.z.toFixed(0)}`:'none');
    // 低速抵近不应甩货
    const b2 = await S();
    const res2 = await page.evaluate(r=>window.__CRASH(r, 600, 0.28, {start:18, dx:0, dz:1}), rock);
    const a2 = await S();
    ok('T5.3 低速抵近接触不会甩货', a2.drops === b2.drops,
       `撞击时最高车速 ${res2.maxSpeed.toFixed(1)} m/s，drops ${b2.drops} → ${a2.drops}`);
  }
}

/* ================= T6 掉落货物回收 ================= */
async function recoverCrate(){
  const st = await S();
  const d = st.cargo.find(c=>c.state==='dropped');
  if (!d) return {none:true, ok:true};
  // __PICKUP 内部完成「栅格导航绕障 → 低速精确装车 → 失败则换方位重试」
  const r = await page.evaluate(a=>window.__PICKUP(a[0], a[1], a[2]), [d.name, {x:d.x,z:d.z}, 1500]);
  await IN(null);
  const after = await S();
  const me = after.cargo.find(c=>c.name===d.name);
  const done = me && me.state !== 'dropped';
  return {none:false, ok:!!done, dist:r.dist, nav:r.nav, creep:r.creep,
          attempts:r.attempts, resets:r.resets||0, retreats:r.retreats||0, log:r.log||[],
          state:me?me.state:'?', loaded:after.cargo.filter(c=>c.state==='loaded').length};
}
{
  const st = await S();
  const drop = st.cargo.find(c=>c.state==='dropped');
  if (!drop) ok('T6.1 有可回收的掉落货物', false, '本次未产生掉落，跳过该项');
  else {
    const n0 = st.cargo.filter(c=>c.state==='loaded').length;
    const r = await recoverCrate();
    const after = await S();
    const loaded = after.cargo.filter(c=>c.state==='loaded').length;
    ok('T6.1 驾驶靠近掉落货物可自动装回车斗', loaded > n0,
       `导航=${r.nav} 装车=${r.creep}（最近 ${r.dist===undefined?'-':r.dist.toFixed(1)}m，尝试${r.attempts||0}次 复位${r.resets||0}次），车斗货物 ${n0} → ${loaded} 箱：${after.cargo.map(c=>c.state).join('/')}`
       + (loaded>n0 ? '' : ' 明细 ' + JSON.stringify(r.log||[])));
    ok('T6.2 货物状态总数守恒（3 箱）',
       after.cargo.filter(c=>c.state==='delivered').length + loaded + after.cargo.filter(c=>c.state==='dropped').length === 3);
  }
}

/* ================= T7 交付判定：必须低速停稳 ================= */
{
  const bases = await page.evaluate(()=>window.__LR.bases());
  const b = bases[0];
  const before = await S();
  // 高速穿过交付区
  await tp(b.x - Math.sin(0)*0, b.z - Math.cos(0)*0, 0);
  await tp(b.x, b.z - 95, 0);
  const res = await page.evaluate(t=>window.__PASSBY(t, 900, 1), b);
  const after = await S();
  info(`高速穿越基地：最近距离 ${res.minDist.toFixed(1)} m，区内最高车速 ${res.maxSpeedInZone.toFixed(1)} m/s`);
  ok('T7.1 交付区确实被穿越（测试有效）', res.minDist < b.deliverR + 9, `最近 ${res.minDist.toFixed(1)} m ≤ ${(b.deliverR+9).toFixed(1)} m`);
  ok('T7.2 高速通过不会误触发交付', res.deliveredFast === false && after.delivered === before.delivered,
     `delivered ${before.delivered} → ${after.delivered}，高速误触发=${res.deliveredFast}，缓慢状态交付=${res.deliveredSlow}`);
}

/* ================= T8 翻覆与复位 ================= */
{
  await page.evaluate(()=>window.__LR.flip());
  await sec(0.6);
  const st1 = await S();
  ok('T8.1 触发翻覆后车辆处于翻覆状态', st1.rolled===true);
  await IN({throttle:1,brake:0,steer:0}); await sec(1.5); await IN(null);
  const st2 = await S();
  ok('T8.2 翻覆后车辆失去控制（无法驱动）', Math.abs(st2.speed)<0.8, `speed ${st2.speed.toFixed(2)} m/s`);
  await page.keyboard.press('r');
  await sec(0.8);
  const st3 = await S();
  ok('T8.3 R 键复位成功且车身回正', st3.rolled===false && st3.tilt<0.35, `rolled=${st3.rolled}, tilt=${(st3.tilt*180/Math.PI).toFixed(1)}°`);
  ok('T8.4 复位后仍贴合地面', st3.y-st3.groundY>0.9 && st3.y-st3.groundY<1.7, `离地 ${(st3.y-st3.groundY).toFixed(2)} m`);
  ok('T8.5 复位后速度归零', Math.abs(st3.speed)<0.2, `${st3.speed.toFixed(3)} m/s`);
}

/* ================= T9 三种镜头 ================= */
{
  const cams=[];
  for (const m of [0,1,2]){
    await page.evaluate(m=>window.__LR.setCam(m), m);
    await adv(30, true);
    const st = await S();
    cams.push({m, name:st.camName, cam:st.cam, pos:st.camPos,
               d:Math.hypot(st.camPos[0]-st.x, st.camPos[2]-st.z),
               h:st.camPos[1]-st.y});
  }
  ok('T9.1 第一人称：镜头位于驾驶舱内', cams[0].cam===0 && cams[0].d<3.0 && cams[0].h<2.5,
     `水平 ${cams[0].d.toFixed(2)} m，高 ${cams[0].h.toFixed(2)} m`);
  ok('T9.2 第三人称：镜头在车后上方跟随', cams[1].cam===1 && cams[1].d>8 && cams[1].d<20 && cams[1].h>3,
     `水平 ${cams[1].d.toFixed(1)} m，高 ${cams[1].h.toFixed(1)} m`);
  ok('T9.3 远景观察：镜头距离远', cams[2].cam===2 && cams[2].d>40, `距离 ${cams[2].d.toFixed(0)} m`);
  ok('T9.4 三种镜头位置互不相同', new Set(cams.map(c=>c.pos.map(v=>v.toFixed(1)).join(','))).size===3);
  ok('T9.5 HUD 显示镜头名称', cams[0].name==='第一人称'&&cams[1].name==='第三人称'&&cams[2].name==='远景观察',
     cams.map(c=>c.name).join(' / '));
  await page.keyboard.press('1'); await adv(10,true);
  ok('T9.6 数字键 1/2/3 切换镜头', (await S()).cam===0);
  await page.keyboard.press('c'); await adv(10,true);
  ok('T9.7 C 键循环切换镜头', (await S()).cam===1);
  // 远景可缩放（滚轮）
  await page.evaluate(()=>window.__LR.setCam(2)); await adv(20,true);
  const r0 = await page.evaluate(()=>window.__LR.state.camPos);
  await page.mouse.move(640,360); await page.mouse.wheel(0,-600); await adv(20,true);
  const r1 = await page.evaluate(()=>window.__LR.state.camPos);
  ok('T9.8 远景镜头支持滚轮缩放', Math.abs(r1[0]-r0[0])+Math.abs(r1[2]-r0[2])>1,
     `缩放前后位移 ${(Math.abs(r1[0]-r0[0])+Math.abs(r1[2]-r0[2])).toFixed(1)} m`);
  await page.evaluate(()=>window.__LR.setCam(1));
  // 第一人称视野必须真的「看得见东西」：镜头位于驾驶舱内部，
  // 若车体不隐藏，车厢/货箱会在近裁剪面附近糊住整个画面。
  // 判据用射线几何检测（直接命中自身几何体 = 视野被挡），像素统计只作参考量。
  const fpView = await page.evaluate(()=>{
    window.__LR.setCam(0);
    window.__LR.frameStep(2, 1/60, true);
    return Object.assign(window.__LR.camOcclusion(), window.__LR.frameSample(0.28, 0.40, 0.30, 0.20),
                         {bodyVisible: window.__LR.state.bodyVisible});
  });
  ok('T9.9 第一人称不显示自身车体', fpView.bodyVisible===false, `bodyVisible=${fpView.bodyVisible}`);
  // 阈值 2 m 由反向对照标定：缺陷态下射线命中自身几何体仅 0.17~0.82 m，正常态为 30~57 m
  ok('T9.10 第一人称前方视野未被自身几何体挡住',
     fpView.selfHit===false && fpView.dist!==null && fpView.dist>2,
     `视线最近命中 ${fpView.dist===null?'无':fpView.dist+' m'}，命中自身=${fpView.selfHit}`
     + `（参考：采样区色域 ${fpView.colors} 种 / 亮度标准差 ${fpView.sd}）`);
  // 自证：强行把车体显示出来（复现原缺陷），同一条射线必须命中自身 —— 否则 T9.10 恒真、无检测能力
  const fpBroken = await page.evaluate(()=>{
    window.__LR.forceBodyVisible(true);
    window.__LR.frameStep(2, 1/60, true);
    const r = Object.assign(window.__LR.camOcclusion(), {bodyVisible: window.__LR.state.bodyVisible});
    window.__LR.forceBodyVisible(false);
    window.__LR.frameStep(2, 1/60, true);
    return r;
  });
  ok('T9.11 遮挡检测具备区分能力（强制显示车体时命中自身）',
     fpBroken.bodyVisible===true && fpBroken.selfHit===true,
     `强制显示后 命中自身=${fpBroken.selfHit}，最近命中 ${fpBroken.dist===null?'无':fpBroken.dist+' m'}`);
  await page.evaluate(()=>window.__LR.setCam(1));
  await adv(20,true);
  const bodyBack = await page.evaluate(()=>window.__LR.state.bodyVisible);
  ok('T9.12 切回第三人称后车体恢复显示', bodyBack===true, `bodyVisible=${bodyBack}`);
}

/* ================= T10 HUD / 小地图 ================= */
{
  await adv(20,true);
  const hud = await page.evaluate(()=>({
    spd: document.getElementById('spd').textContent,
    bat: document.getElementById('bat').textContent,
    mTitle: document.getElementById('mTitle').textContent,
    mSub: document.getElementById('mSub').textContent,
    mDist: document.getElementById('mDist').textContent,
    slots: document.querySelectorAll('#slots .slot').length,
    bases: document.querySelectorAll('#baseList .bItem').length,
    deliv: document.getElementById('delivN').textContent,
    chips: document.getElementById('chips').textContent,
    camName: document.getElementById('camName').textContent
  }));
  ok('T10.1 HUD 显示当前速度', /^\d+$/.test(hud.spd.trim()), '速度 ' + hud.spd + ' km/h');
  ok('T10.2 HUD 显示剩余电量', /%$/.test(hud.bat.trim()), '电量 ' + hud.bat);
  ok('T10.3 HUD 显示当前任务与基地距离', hud.mTitle.length>1 && /\d/.test(hud.mDist),
     `${hud.mTitle} | ${hud.mDist.replace(/\s+/g,' ')} | ${hud.mSub}`);
  ok('T10.4 HUD 列出三个基地状态与三个货位', hud.bases===3 && hud.slots===3, `基地 ${hud.bases} 项 / 货位 ${hud.slots} 项`);
  ok('T10.5 HUD 显示已送达数量', /[0-3]/.test(hud.deliv), '已送达 ' + hud.deliv);
  const mm = await page.evaluate(()=>{
    const c=document.getElementById('minimap'), g=c.getContext('2d');
    const d=g.getImageData(0,0,c.width,c.height).data;
    const set=new Set(); let bright=0, amber=0, cyan=0;
    for(let i=0;i<d.length;i+=4*29){
      set.add((d[i]>>4)+','+(d[i+1]>>4)+','+(d[i+2]>>4));
      if(d[i]>200&&d[i+1]>200&&d[i+2]>200) bright++;
      if(d[i]>190&&d[i+1]>120&&d[i+1]<200&&d[i+2]<120) amber++;
      if(d[i]<120&&d[i+1]>170&&d[i+2]>180) cyan++;
    }
    return {colors:set.size, bright, amber, cyan};
  });
  ok('T10.6 小地图绘制了地形与标记', mm.colors>12 && mm.bright>0,
     `色域 ${mm.colors} 种 / 车标像素 ${mm.bright} / 目标基地 ${mm.amber} / 信标 ${mm.cyan}`);
}

/* ================= T11 完整通关：三箱送达三个基地 ================= */
{
  const log=[]; let guard=0;
  while (guard++ < 12){
    let st = await S();
    if (st.delivered >= 3) break;
    // 每段行程出发前，把散落在途中的货物全部收回车斗
    for (let k=0;k<4;k++){
      if (!(await S()).cargo.some(c=>c.state==='dropped')) break;
      const rr = await recoverCrate();
      log.push(`回收货物(${rr.ok?'成功':'未完成 状态='+(rr.state||'-')+' dist='+(rr.dist===undefined?'-':rr.dist.toFixed(1))})`);
    }
    st = await S();
    const bases = await page.evaluate(()=>window.__LR.bases());
    const idx = bases.findIndex(b=>!b.delivered);
    if (idx < 0) break;
    const target = bases[idx];
    const onboard = st.cargo.filter(c=>c.state==='loaded').length;
    if (onboard === 0){ log.push(`车斗无货（${st.cargo.map(c=>c.state).join('/')}）且无法回收，终止`); break; }
    // 沿运输通道网络规划并行驶到基地卸货区
    const plan = await page.evaluate(i=>window.__PLAN(i, 34), idx);
    let res = await page.evaluate(a=>window.__AUTO(a[0], 14000, {arriveR:7.5, arriveV:3.0, vmax:15, wpR:17}), [plan.wps]);
    let mid = await S();
    log.push(`${target.name}: 航点${plan.wps.length}个(最近通道#${plan.near.i} ${plan.near.d}m) 抵达=${res.ok}${res.ok?'':`(${res.why} 余${res.dist.toFixed(0)}m wp${res.wp}/${plan.wps.length})`} rolled=${mid.rolled}`);
    if (mid.rolled){
      await page.keyboard.press('r'); await sec(0.8);
      res = await page.evaluate(a=>window.__AUTO(a[0], 8000, {arriveR:7.5, arriveV:3.0, vmax:15, wpR:17}), [plan.wps]);
      log.push(`${target.name}: 复位后重试 抵达=${res.ok}${res.ok?'':`(${res.why} 余${(res.dist||0).toFixed(0)}m)`}`);
    }
    // 停稳等待卸载
    await page.evaluate(()=>window.__RUN({throttle:0,brake:1,steer:0},320,0));
    await IN(null);
    const after = await S();
    const bnow = await page.evaluate(()=>window.__LR.bases());
    log.push(`  → 已送达 ${after.delivered}/3，基地 ${bnow.map(b=>b.delivered?1:0).join('')}，货物 ${after.cargo.map(c=>c.state).join('/')}，电量 ${after.battery.toFixed(0)}%`);
    if (after.delivered === st.delivered && !(after.cargo.some(c=>c.state==='dropped'))) {
      log.push('（无进展且无掉落可回收，终止循环）'); break;
    }
  }
  const fin = await S();
  ok('T11.1 三箱货物全部送达三个基地（完整通关）', fin.delivered===3, log.join(' | '));
  const winVisible = await page.evaluate(()=>!document.getElementById('win').classList.contains('hide'));
  ok('T11.2 通关界面自动弹出', winVisible && fin.won===true);
  const stats = await page.evaluate(()=>document.getElementById('stats').textContent.replace(/\s+/g,' ').trim());
  ok('T11.3 通关统计有真实数据', /\d/.test(stats), stats.slice(0,140));
  const statUnits = await page.evaluate(()=>[...document.querySelectorAll('#stats .stat b i')].map(e=>e.textContent));
  const statLabels = await page.evaluate(()=>[...document.querySelectorAll('#stats .stat span')].map(e=>e.textContent));
  ok('T11.4 四项统计带内联单位且标签完整', statUnits.length===3 && statLabels.length===4,
     `单位 ${statUnits.join('/')} ｜ 标签 ${statLabels.join('/')}`);
  await adv(5,true);
  fs.mkdirSync(path.join(ROOT,'shots'),{recursive:true});
await page.screenshot({path:path.join(ROOT,'shots','06-win.jpg'), type:'jpeg', quality:86});
  info(`通关用时 ${fin.elapsed.toFixed(0)}s，行驶 ${fin.odometer.toFixed(0)} m，掉落 ${fin.drops} 次`);
}

/* ================= T12 重新开始 ================= */
{
  const winShown = await page.evaluate(()=>!document.getElementById('win').classList.contains('hide'));
  if (winShown) await page.click('#btnAgain');
  else { await page.evaluate(()=>window.__LR.restart()); info('通关界面未出现（T11 未通关），改用接口重置'); }
  await sec(1,true);
  const st = await S();
  ok('T12.1 重新开始后进度复位', st.delivered===0 && st.drops===0 && st.cargo.every(c=>c.state==='loaded'),
     `delivered=${st.delivered} drops=${st.drops} cargo=${st.cargo.map(c=>c.state).join('/')}`);
  ok('T12.2 通关界面已关闭', await page.evaluate(()=>document.getElementById('win').classList.contains('hide')));
  const sp = await page.evaluate(()=>window.__LR.spawn());
  ok('T12.3 车辆回到装卸区出生点', Math.hypot(st.x-sp.x, st.z-sp.z) < 3,
     `位置 ${st.x.toFixed(1)},${st.z.toFixed(1)}（出生点 ${sp.x},${sp.z}）`);
  const toasts = await page.evaluate(()=>[...document.getElementById('toasts').children].map(e=>e.textContent));
  ok('T12.4 重新开始后不残留上一局提示', toasts.length<=1, `提示条 ${toasts.length} 条：${toasts.join(' / ')}`);
}

/* ================= T13 错误与稳定性 ================= */
{
  const st = await S();
  ok('T13.1 无未捕获的页面错误', pageErr.length===0, pageErr.slice(0,2).join(' | '));
  ok('T13.2 游戏内部无错误记录', st.error===0, 'errors=' + st.error);
  const real = consoleErr.filter(t=>!/favicon|404/i.test(t));
  ok('T13.3 控制台无报错', real.length===0, real.slice(0,2).join(' | '));
}

await page.screenshot({path:path.join(ROOT,'shots','07-hud.jpg'), type:'jpeg', quality:86});
await browser.close(); srv.close();
console.log(`\n===== 结果：${T.pass} 通过 / ${T.fail} 失败 =====`);
if (T.fail){ console.log('失败项：'); T.results.filter(r=>!r.pass).forEach(r=>console.log('  - '+r.name+' :: '+r.detail)); }
process.exit(T.fail ? 1 : 0);
