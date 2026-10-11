'use strict';
/* =====================================================================
   BIG SHARK · 复古街机鲨鱼觅食小游戏
   风格:1930's 橡皮管卡通 × 做旧胶片(噪点/暗角/抖动/泛黄纸面)
   玩法:鼠标游动,按住左键/空格冲刺;啃鱼群、咬住沙滩游客拖回海里
        吞掉;水母会蜇人;饥饿值归零即饿死,冲击 HI-SCORE。
   ===================================================================== */

/* ---------------- 画布与缩放 ---------------- */
const cvs = document.getElementById('game');
const ctx = cvs.getContext('2d');
const W = 1280, H = 800;
function fitStage() {
  const s = Math.min(innerWidth / W, innerHeight / H);
  cvs.style.width = Math.round(W * s) + 'px';
  cvs.style.height = Math.round(H * s) + 'px';
}
addEventListener('resize', fitStage); fitStage();

/* ---------------- 小工具 ---------------- */
const TAU = Math.PI * 2;
const rand  = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp  = (a, b, t) => a + (b - a) * t;
const dist  = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
function angLerp(a, b, t) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
}
const pad = (n, l) => String(Math.max(0, Math.floor(n))).padStart(l, '0');

/* ---------------- 做旧调色板 ---------------- */
const INK    = '#3b3226';   // 勾线墨色
const INK2   = '#5a5140';
const PAPER  = '#e6dcbd';   // 纸面/天空
const PANEL  = '#efe6cd';   // HUD 面板
const SAND   = '#dbc89d';
const SAND2  = '#c4ae82';   // 湿沙
const WATER1 = '#aca68e';
const WATER2 = '#8b8470';
const FLOOR  = '#6e6753';
const FLOOR2 = '#5e5845';
const WHITE  = '#f2ecda';
const RED    = '#8f3d2c';   // 做旧警示红
const SHARK_BODY = '#c9bfa2';
const SHARK_BELLY = '#ded4b8';
const SHARK_FIN  = '#b1a78a';

/* ---------------- 世界几何 ---------------- */
const HUD_H = 118;              // 顶部记分区高度
const SAND_TOP = HUD_H;         // 沙滩上沿
const WL_BASE = 252;            // 水线基准
const FLOOR_Y = 716;            // 海床基准
let T = 0;                      // 全局时间(秒)

function wlY(x) {               // 水面波浪线
  return WL_BASE + Math.sin(x * 0.021 + T * 1.4) * 5 + Math.sin(x * 0.045 - T * 0.8) * 3;
}
function floorY(x) {            // 海床起伏
  return FLOOR_Y - 26 * Math.sin(x * 0.004 + 1.7) - 14 * Math.sin(x * 0.011 + 0.4);
}

/* ---------------- 输入 ---------------- */
const input = { mx: W * 0.62, my: H * 0.62, down: false, keys: {} };
cvs.addEventListener('pointermove', e => {
  const r = cvs.getBoundingClientRect();
  const s = r.width / W;
  input.mx = (e.clientX - r.left) / s;
  input.my = (e.clientY - r.top) / s;
});
cvs.addEventListener('pointerdown', e => {
  initAudio();
  if (AC && AC.state === 'suspended') AC.resume();
  input.down = true;
  if (gameState === 'title') startGame();
  else if (gameState === 'over' && overCd <= 0) { resetGame(); startGame(); }
  else if (paused) paused = false;
});
addEventListener('pointerup', () => input.down = false);
cvs.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
  input.keys[k] = true;
  initAudio();
  if (k === 'p' && gameState === 'play') paused = !paused;
  if (k === 'm') toggleMute();
  if (k === 'r' && gameState === 'over' && overCd <= 0) { resetGame(); startGame(); }
});
addEventListener('keyup', e => input.keys[e.key.toLowerCase()] = false);

/* ---------------- 音频(迷你合成器) ---------------- */
let AC = null, master = null, boostGain = null, muted = false, noiseBuf = null;
function initAudio() {
  if (AC) return;
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.gain.value = 0.5; master.connect(AC.destination);
    noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // 冲刺循环风声
    const src = AC.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = AC.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 0.6;
    boostGain = AC.createGain(); boostGain.gain.value = 0;
    src.connect(f); f.connect(boostGain); boostGain.connect(master);
    src.start();
  } catch (e) { AC = null; }
}
function toggleMute() { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.5; }
function tone(type, f0, f1, dur, vol = 0.2, delay = 0) {
  if (!AC || muted) return;
  const t = AC.currentTime + delay;
  const o = AC.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(Math.max(f0, 1), t);
  o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
  const g = AC.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}
function noiseHit(dur, vol, freq, delay = 0) {
  if (!AC || muted) return;
  const t = AC.currentTime + delay;
  const src = AC.createBufferSource(); src.buffer = noiseBuf;
  const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
  const g = AC.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t); src.stop(t + dur + 0.05);
}
const sfx = {
  blip()  { tone('square', 740, 980, 0.09, 0.13); },
  chomp() { noiseHit(0.12, 0.3, 900); tone('square', 260, 70, 0.12, 0.2); },
  gulp()  { tone('sine', 300, 55, 0.32, 0.3); noiseHit(0.25, 0.22, 500, 0.05); },
  hop()   { tone('triangle', 170, 330, 0.12, 0.16); noiseHit(0.08, 0.1, 700); },
  splash(){ noiseHit(0.32, 0.28, 1500); },
  hurt()  { tone('sawtooth', 300, 60, 0.25, 0.22); },
  level() { [440, 554, 659, 880].forEach((f, i) => tone('square', f, f, 0.13, 0.15, i * 0.09)); },
  over()  { [330, 262, 196, 131].forEach((f, i) => tone('triangle', f, f * 0.9, 0.32, 0.2, i * 0.22)); },
  click() { tone('square', 620, 620, 0.05, 0.1); },
  scream(){ tone('square', 900, 1400, 0.1, 0.08); tone('square', 1200, 700, 0.14, 0.07, 0.08); },
};

/* ---------------- 游戏状态 ---------------- */
let gameState = 'title';        // title | play | over
let paused = false;
let score = 0, hiscore = 0, newRecord = false;
try { hiscore = +(localStorage.getItem('bigshark.hiscore') || 0); } catch (e) {}
let level = 1, xp = 0, xpNeed = 250;
let hunger = 100, boost = 100;
let shake = 0, overCd = 0, hungryPopCd = 0;

/* ---------------- 鲨鱼(玩家) ---------------- */
const shark = {
  x: 640, y: 560, vx: 120, vy: 0, ang: 0,
  mouth: 0, biteCd: 0, onLand: false, wasLand: false,
  carry: null, hopT: 0, boosting: false, stingCd: 0,
  dbg: { tryBite: 0, ate: 0, preyNear: false, mouthDist: 999 },
};
const sharkSize = () => Math.min(1 + (level - 1) * 0.11, 1.8);
const sharkMaxSpd = () => 330 * (1 + (level - 1) * 0.05) * (shark.carry ? 0.72 : 1);
function mouthPos() {
  const s = sharkSize();
  return { x: shark.x + Math.cos(shark.ang) * 62 * s, y: shark.y + Math.sin(shark.ang) * 62 * s };
}

/* ---------------- 实体 ---------------- */
const fishes = [], crabs = [], jellies = [], tourists = [], parts = [], pops = [];

function spawnFishCluster(cx, cy, n) {
  for (let i = 0; i < n; i++) {
    fishes.push({
      ax: cx, ay: cy,                       // 学校锚点
      x: cx + rand(-30, 30), y: cy + rand(-24, 24),
      vx: rand(-20, 20), vy: rand(-10, 10),
      seed: rand(TAU), dead: false, respawn: 0,
    });
  }
}
function spawnCrab() {
  crabs.push({ x: rand(80, W - 80), y: rand(SAND_TOP + 40, WL_BASE - 26), dir: rand() < 0.5 ? -1 : 1, hopT: rand(1) });
}
function spawnJelly() {
  jellies.push({ x: rand(120, W - 120), y: rand(WL_BASE + 160, FLOOR_Y - 130), seed: rand(TAU), drift: rand(-8, 8) });
}
function spawnTourist(type, x) {
  const t = {
    type, state: type,                     // walk | sun | swim | grabbed | gone
    x: x !== undefined ? x : (rand() < 0.5 ? rand(60, 200) : rand(W - 200, W - 60)),
    baseY: rand(SAND_TOP + 52, WL_BASE - 34),
    y: 0, dir: rand() < 0.5 ? -1 : 1,
    speed: rand(20, 34), seed: rand(TAU),
    panic: 0, screamed: false, struggle: 0,
    c1: ['#a89a7c', '#8f8672', '#b5a988', '#97896b'][Math.floor(rand(4))],
    c2: ['#6e6753', '#57503f', '#8a7a5c'][Math.floor(rand(3))],
    hat: rand() < 0.7,
  };
  if (type === 'sun') {
    const spot = TOWELS[Math.floor(rand(TOWELS.length))];
    t.x = spot.x; t.baseY = spot.y + 6;
  }
  if (type === 'swim') { t.x = rand(160, W - 160); t.baseY = WL_BASE + rand(18, 42); }
  t.y = t.baseY;
  tourists.push(t);
}

const TOWELS = [{ x: 250, y: 196 }, { x: 560, y: 186 }, { x: 880, y: 200 }, { x: 1130, y: 188 }];
const UMBRELLAS = [{ x: 250, y: 192, s: 1 }, { x: 620, y: 172, s: 0.9 }, { x: 880, y: 196, s: 1.05 }, { x: 1160, y: 170, s: 0.85 }];
const PALMS = [{ x: 96, y: 208 }, { x: 420, y: 186 }, { x: 760, y: 210 }, { x: 1080, y: 190 }];

/* 粒子与浮字 */
function pop(x, y, text, big) {
  pops.push({ x, y: Math.max(y, SAND_TOP + 26), text, life: 1, big: !!big });
}
function puff(x, y, n, col) {
  for (let i = 0; i < n; i++) parts.push({
    x, y, vx: rand(-70, 70), vy: rand(-90, 20), life: rand(0.4, 0.8),
    t: 0, kind: 'puff', col: col || 'rgba(90,80,60,0.5)', r: rand(3, 7),
  });
}
function bubbles(x, y, n) {
  for (let i = 0; i < n; i++) parts.push({
    x: x + rand(-8, 8), y, vx: rand(-12, 12), vy: rand(-70, -30), life: rand(0.6, 1.3),
    t: 0, kind: 'bubble', r: rand(2, 4.5),
  });
}
function droplets(x, y, n) {
  for (let i = 0; i < n; i++) parts.push({
    x, y, vx: rand(-160, 160), vy: rand(-260, -60), life: rand(0.4, 0.8),
    t: 0, kind: 'drop', r: rand(2, 4),
  });
}

/* ---------------- 初始化 / 重置 ---------------- */
function resetGame() {
  score = 0; level = 1; xp = 0; xpNeed = 250; hunger = 100; boost = 100;
  newRecord = false; shake = 0;
  shark.x = 640; shark.y = 560; shark.vx = 120; shark.vy = 0; shark.ang = 0;
  shark.carry = null; shark.mouth = 0; shark.biteCd = 0;
  fishes.length = 0; crabs.length = 0; jellies.length = 0; tourists.length = 0;
  parts.length = 0; pops.length = 0;
  initSpawn();
}
function initSpawn() {
  for (let i = 0; i < 5; i++) {
    spawnFishCluster(rand(140, W - 140), rand(WL_BASE + 90, FLOOR_Y - 110), 6);
  }
  for (let i = 0; i < 3; i++) spawnCrab();
  for (let i = 0; i < 3; i++) spawnJelly();
  for (let i = 0; i < 4; i++) spawnTourist('walk', rand(120, W - 120));
  spawnTourist('sun'); spawnTourist('sun');
  spawnTourist('swim'); spawnTourist('swim');
}
function startGame() { gameState = 'play'; paused = false; sfx.click(); }
function gameOver() {
  gameState = 'over'; overCd = 0.9;
  if (score > hiscore) { hiscore = score; newRecord = true; try { localStorage.setItem('bigshark.hiscore', String(hiscore)); } catch (e) {} }
  sfx.over();
}

/* ---------------- 升级 ---------------- */
function checkLevel() {
  while (xp >= xpNeed) {
    xp -= xpNeed; level++;
    xpNeed = 250 + (level - 1) * 180;
    pop(shark.x, shark.y - 60, 'LEVEL UP! LV.' + level, true);
    sfx.level(); shake = Math.max(shake, 5);
  }
}

/* ---------------- 更新:鲨鱼 ---------------- */
function updateShark(dt) {
  const k = input.keys;
  let dx = 0, dy = 0;
  if (k['a'] || k['arrowleft']) dx -= 1;
  if (k['d'] || k['arrowright']) dx += 1;
  if (k['w'] || k['arrowup']) dy -= 1;
  if (k['s'] || k['arrowdown']) dy += 1;

  let tx, ty;
  if (dx || dy) { const l = Math.hypot(dx, dy); tx = shark.x + dx / l * 120; ty = shark.y + dy / l * 120; }
  else { tx = input.mx; ty = input.my; }
  const ddx = tx - shark.x, ddy = ty - shark.y;
  const dl = Math.hypot(ddx, ddy) || 1;

  shark.wasLand = shark.onLand;
  shark.onLand = shark.y < wlY(shark.x) + 6;

  // 嘴部位置与猎物感知(供突进与张嘴共用)
  const m0 = mouthPos();
  let preyNear = false;
  for (const f of fishes) if (!f.dead && dist(m0.x, m0.y, f.x, f.y) < 130) { preyNear = true; break; }
  if (!preyNear) for (const t of tourists) {
    if (t.state === 'walk' || t.state === 'sun' || t.state === 'swim') {
      if (dist(m0.x, m0.y, t.x, t.y - 12) < 130) { preyNear = true; break; }
    }
  }
  if (!preyNear) for (const c of crabs) if (dist(m0.x, m0.y, c.x, c.y) < 120) { preyNear = true; break; }

  let acc = shark.onLand ? 150 : 900;
  let maxs = shark.onLand ? 110 : sharkMaxSpd();

  // 冲刺
  const wantBoost = input.down || k[' '] || k['shift'];
  let boosting = false;
  if (wantBoost && boost > 0.5) {
    boosting = true;
    if (shark.onLand) {          // 沙滩上按住冲刺 = 一蹦一蹦
      shark.hopT -= dt;
      if (shark.hopT <= 0) {
        shark.hopT = 0.36;
        boost = Math.max(0, boost - 15);
        shark.vx = ddx / dl * 390;
        shark.vy = -400;
        sfx.hop(); puff(shark.x, shark.y + 14, 6);
      }
    }
  } else shark.hopT = 0;
  if (boosting && !shark.onLand) { boost = Math.max(0, boost - 34 * dt); acc *= 2.1; maxs *= 1.65; }
  shark.boosting = boosting;
  if (!wantBoost) boost = Math.min(100, boost + 26 * dt);
  if (boostGain) boostGain.gain.value = (boosting && !muted) ? 0.06 : 0;

  // 驱动与阻力(有猎物在嘴边时保持突进,避免在目标前"刹车"干瞪眼)
  if (dl > 26 || shark.onLand || preyNear) {
    shark.vx += (ddx / dl) * acc * dt;
    shark.vy += (ddy / dl) * acc * dt;
  }
  const drag = shark.onLand ? 1.2 : 1.6;
  shark.vx -= shark.vx * drag * dt;
  shark.vy -= shark.vy * drag * dt;
  if (shark.onLand) shark.vy += 850 * dt;   // 沙滩上被"重力"拽回海里

  const sp = Math.hypot(shark.vx, shark.vy);
  if (sp > maxs) { shark.vx *= maxs / sp; shark.vy *= maxs / sp; }
  shark.x = clamp(shark.x + shark.vx * dt, 40, W - 40);
  shark.y = clamp(shark.y + shark.vy * dt, SAND_TOP + 30, H - 30);
  const fy = floorY(shark.x) - 18;
  if (shark.y > fy) { shark.y = fy; if (shark.vy > 0) shark.vy *= -0.15; }

  // 入水 / 上岸 反馈
  if (shark.wasLand !== shark.onLand) {
    if (shark.onLand) { puff(shark.x, wlY(shark.x) - 4, 10); shake = Math.max(shake, 3); noiseHit(0.15, 0.2, 600); }
    else if (sp > 140) { droplets(shark.x, wlY(shark.x), 12); sfx.splash(); shake = Math.max(shake, 3); }
  }

  if (sp > 25) shark.ang = angLerp(shark.ang, Math.atan2(shark.vy, shark.vx), 1 - Math.exp(-8 * dt));

  // 嘴:猎物靠近就张嘴
  shark.biteCd -= dt; shark.stingCd -= dt;
  const m = mouthPos();
  shark.mouth = lerp(shark.mouth, preyNear ? 1 : 0, 1 - Math.exp(-10 * dt));
  shark.dbg.preyNear = preyNear;
  shark.dbg.mouthDist = Math.round(Math.min(...fishes.filter(f => !f.dead).map(f => dist(m.x, m.y, f.x, f.y)), 9999));

  // 咬!
  if ((shark.mouth > 0.45 || boosting) && shark.biteCd <= 0) { shark.dbg.tryBite++; tryBite(m); }
}

function tryBite(m) {
  const s = sharkSize(), r = 52 * s;
  // 鱼群(嘴部或身体碰到都算咬到)
  for (const f of fishes) {
    if (f.dead) continue;
    if (dist(m.x, m.y, f.x, f.y) < r || dist(shark.x, shark.y, f.x, f.y) < 42 * s) {
      f.dead = true; f.respawn = rand(2.5, 5);
      shark.dbg.ate++;
      score += 25; xp += 5; hunger = Math.min(100, hunger + 8);
      pop(f.x, f.y - 14, '+25'); sfx.chomp(); bubbles(f.x, f.y, 5);
      shark.biteCd = 0.3;
      return;
    }
  }
  // 螃蟹
  for (const c of crabs) {
    if (dist(m.x, m.y, c.x, c.y) < r * 0.8) {
      c.dead = true;
      score += 75; xp += 10; hunger = Math.min(100, hunger + 14);
      pop(c.x, c.y - 16, '+75'); sfx.chomp(); puff(c.x, c.y, 6);
      shark.biteCd = 0.3;
      return;
    }
  }
  // 游客
  for (const t of tourists) {
    if (t.state !== 'walk' && t.state !== 'sun' && t.state !== 'swim') continue;
    if (dist(m.x, m.y, t.x, t.y - 12) < r || dist(shark.x, shark.y, t.x, t.y - 12) < 40 * s) {
      shark.biteCd = 0.4;
      if (t.state === 'swim') {          // 水里的游客直接吞
        t.state = 'gone'; t.respawn = rand(3, 6);
        score += 300; xp += 45; hunger = Math.min(100, hunger + 45);
        pop(t.x, t.y - 20, '+300 CHOMP!', true);
        sfx.chomp(); sfx.gulp(); droplets(t.x, wlY(t.x), 10); shake = Math.max(shake, 5);
        checkLevel();
      } else {                            // 沙滩游客:叼走,带回海里才算数
        t.state = 'grabbed'; t.struggle = 0;
        shark.carry = t;
        sfx.chomp(); sfx.scream();
        pop(t.x, t.y - 30, 'GOTCHA!');
        shake = Math.max(shake, 6);
      }
      return;
    }
  }
}

/* ---------------- 更新:叼着游客 ---------------- */
function updateCarry(dt) {
  const t = shark.carry;
  if (!t) return;
  const m = mouthPos();
  t.x = m.x; t.y = m.y + 4;
  t.struggle += dt / 7;
  if (t.struggle >= 1) {                  // 挣脱了!
    t.state = 'walk'; t.panic = 3; t.screamed = false;
    t.y = Math.min(t.y, wlY(t.x) - 16); t.baseY = t.y;
    shark.carry = null;
    pop(t.x, t.y - 30, 'ESCAPED!');
    sfx.hurt(); shake = Math.max(shake, 5);
  } else if (!shark.onLand && shark.y > wlY(shark.x) + 60) {
    // 拖回深水,吞!
    t.state = 'gone'; t.respawn = rand(4, 8);
    shark.carry = null;
    score += 500; xp += 60; hunger = Math.min(100, hunger + 80);
    pop(shark.x, shark.y - 50, '+500 GULP!', true);
    sfx.gulp(); bubbles(shark.x, shark.y, 14); droplets(shark.x, wlY(shark.x), 8);
    shake = Math.max(shake, 7);
    checkLevel();
  }
}

/* ---------------- 更新:鱼群 ---------------- */
function updateFishes(dt) {
  for (const f of fishes) {
    if (f.dead) { f.respawn -= dt; if (f.respawn <= 0) { f.dead = false; f.x = f.ax + rand(-30, 30); f.y = f.ay + rand(-20, 20); } continue; }
    f.ax += Math.sin(T * 0.23 + f.seed) * 14 * dt;
    f.ay += Math.cos(T * 0.19 + f.seed * 2) * 10 * dt;
    f.ax = clamp(f.ax, 80, W - 80);
    f.ay = clamp(f.ay, WL_BASE + 50, FLOOR_Y - 80);
    let gx = f.ax + Math.sin(T * 1.4 + f.seed) * 34;
    let gy = f.ay + Math.cos(T * 1.1 + f.seed * 1.7) * 22;
    // 逃离鲨鱼嘴
    const m = mouthPos();
    const dm = dist(f.x, f.y, m.x, m.y);
    if (dm < 140) { gx = f.x + (f.x - m.x) * 3; gy = f.y + (f.y - m.y) * 3; }
    const dx = gx - f.x, dy = gy - f.y, d = Math.hypot(dx, dy) || 1;
    const spd = dm < 140 ? 170 : 55;
    f.vx = lerp(f.vx, dx / d * spd, 1 - Math.exp(-3 * dt));
    f.vy = lerp(f.vy, dy / d * spd, 1 - Math.exp(-3 * dt));
    f.x = clamp(f.x + f.vx * dt, 20, W - 20);
    f.y = clamp(f.y + f.vy * dt, WL_BASE + 14, FLOOR_Y - 30);
  }
}

/* ---------------- 更新:螃蟹 / 水母 ---------------- */
function updateCritters(dt) {
  for (let i = crabs.length - 1; i >= 0; i--) {
    const c = crabs[i];
    if (c.dead) { crabs.splice(i, 1); continue; }
    c.hopT -= dt;
    if (c.hopT <= 0) { c.hopT = rand(0.5, 1.4); c.dir = rand() < 0.35 ? -c.dir : c.dir; }
    // 鲨鱼上岸时吓跑
    let flee = 0;
    if (shark.onLand && Math.abs(shark.x - c.x) < 160) flee = shark.x < c.x ? 1 : -1;
    c.x = clamp(c.x + (c.dir * 30 + flee * 90) * dt, 40, W - 40);
  }
  for (const j of jellies) {
    j.x = clamp(j.x + (j.drift + Math.sin(T * 0.4 + j.seed) * 10) * dt, 60, W - 60);
    j.y += Math.sin(T * 0.7 + j.seed) * 8 * dt;
    j.y = clamp(j.y, WL_BASE + 120, FLOOR_Y - 80);
    const s = sharkSize();
    if (shark.stingCd <= 0 && gameState === 'play' && dist(shark.x, shark.y, j.x, j.y) < 34 * s + 14) {
      shark.stingCd = 1.2;
      hunger = Math.max(0, hunger - 12);
      const d = Math.hypot(shark.x - j.x, shark.y - j.y) || 1;
      shark.vx += (shark.x - j.x) / d * 380;
      shark.vy += (shark.y - j.y) / d * 380;
      pop(shark.x, shark.y - 30, 'ZAP! -12', true);
      sfx.hurt(); shake = Math.max(shake, 5);
      if (hunger <= 0) gameOver();
    }
  }
}

/* ---------------- 更新:游客 ---------------- */
function sharkScare(t) {
  if (shark.onLand) return dist(shark.x, shark.y, t.x, t.y) < 210;
  return shark.y < wlY(shark.x) + 80 && dist(shark.x, shark.y, t.x, t.y) < 240;
}
function updateTourists(dt) {
  for (const t of tourists) {
    if (t.state === 'gone') {
      t.respawn -= dt;
      if (t.respawn <= 0) {           // 重生:从沙滩边缘溜达进来
        t.state = 'walk'; t.type = 'walk';
        t.x = rand() < 0.5 ? 56 : W - 56;
        t.baseY = rand(SAND_TOP + 52, WL_BASE - 34);
        t.y = t.baseY; t.panic = 0; t.screamed = false; t.struggle = 0;
      }
      continue;
    }
    if (t.state === 'grabbed') continue;    // 由 updateCarry 驱动
    if (t.state === 'walk') {
      if (t.panic <= 0 && sharkScare(t)) {
        t.panic = 2.6;
        if (!t.screamed) { pop(t.x, t.y - 42, '!!'); t.screamed = true; sfx.scream(); }
        t.dir = shark.x < t.x ? 1 : -1;
      }
      if (t.panic > 0) { t.panic -= dt; if (t.panic <= 0) t.screamed = false; }
      const spd = t.panic > 0 ? 130 : t.speed;
      t.x += t.dir * spd * dt;
      if (t.x < 50) { t.x = 50; t.dir = 1; }
      if (t.x > W - 50) { t.x = W - 50; t.dir = -1; }
      t.y = t.baseY + Math.sin(T * 7 + t.seed) * 1.5;
    } else if (t.state === 'sun') {
      if (sharkScare(t)) { t.state = 'walk'; t.panic = 2.6; t.baseY = clamp(t.baseY + 26, SAND_TOP + 48, WL_BASE - 30); pop(t.x, t.y - 42, '!!'); sfx.scream(); }
    } else if (t.state === 'swim') {
      let vx = Math.sin(T * 0.5 + t.seed) * 22;
      if (sharkScare(t)) { vx = (t.x < shark.x ? -1 : 1) * 120; if (!t.screamed) { pop(t.x, t.y - 40, '!!'); t.screamed = true; setTimeout(() => t.screamed = false, 1500); } }
      t.x = clamp(t.x + vx * dt, 60, W - 60);
      t.y = t.baseY + Math.sin(T * 1.6 + t.seed) * 5;
      t.dir = vx >= 0 ? 1 : -1;
    }
  }
  // 补货
  if (Math.floor(T * 2) !== Math.floor((T - dt) * 2)) {
    const walkers = tourists.filter(t => t.state === 'walk' || t.state === 'sun').length;
    const swimmers = tourists.filter(t => t.state === 'swim').length;
    if (walkers < 6) spawnTourist(rand() < 0.75 ? 'walk' : 'sun');
    if (swimmers < 2 && rand() < 0.4) spawnTourist('swim');
    if (crabs.length < 3) spawnCrab();
    if (fishes.filter(f => !f.dead).length < 18) spawnFishCluster(rand(140, W - 140), rand(WL_BASE + 90, FLOOR_Y - 110), 6);
  }
}

/* ---------------- 更新:粒子 / 浮字 ---------------- */
function updateFx(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.t += dt;
    if (p.t >= p.life) { parts.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.kind === 'drop') p.vy += 700 * dt;
    if (p.kind === 'puff') { p.vx *= 1 - 2 * dt; p.vy *= 1 - 2 * dt; }
  }
  for (let i = pops.length - 1; i >= 0; i--) {
    const p = pops[i];
    p.life -= dt; p.y -= 34 * dt;
    if (p.life <= 0) pops.splice(i, 1);
  }
  if (rand() < 3 * dt) bubbles(rand(60, W - 60), rand(WL_BASE + 60, FLOOR_Y - 60), 1);
}

/* ---------------- 主更新 ---------------- */
function update(dt) {
  if (gameState === 'play') {
    updateShark(dt);
    updateCarry(dt);
    // 饥饿
    let drain = 2.0 + level * 0.12;
    if (shark.boosting) drain += 1.6;
    if (shark.onLand) drain += 3.5;
    hunger -= drain * dt;
    if (hunger < 25) {
      hungryPopCd -= dt;
      if (hungryPopCd <= 0) { hungryPopCd = 3; pop(shark.x, shark.y - 46, 'HUNGRY!'); }
      if (hunger <= 0) { hunger = 0; gameOver(); }
    }
    overCd -= dt;
  }
  updateFishes(dt);
  updateCritters(dt);
  updateTourists(dt);
  updateFx(dt);
  shake = Math.max(0, shake - 9 * dt);
}

/* =====================================================================
   绘制
   ===================================================================== */
function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* 云朵:先描一圈粗边再统一填充,得到干净的剪影勾线 */
function drawCloud(x, y, s, alpha) {
  const cs = [[0, 0, 30], [-26, 7, 20], [27, 8, 21], [-8, -12, 20], [10, -9, 17]];
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s * 0.72);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = INK; ctx.lineWidth = 7;
  for (const c of cs) { ctx.beginPath(); ctx.arc(c[0], c[1], c[2], 0, TAU); ctx.stroke(); }
  ctx.fillStyle = WHITE;
  for (const c of cs) { ctx.beginPath(); ctx.arc(c[0], c[1], c[2], 0, TAU); ctx.fill(); }
  ctx.restore();
}

/* ---------------- 沙滩 ---------------- */
const SPECKS = [];
for (let i = 0; i < 150; i++) SPECKS.push({ x: rand(0, W), y: rand(SAND_TOP + 6, WL_BASE - 8), r: rand(0.6, 1.5) });

function drawBeach() {
  ctx.fillStyle = SAND;
  ctx.fillRect(0, SAND_TOP - 2, W, WL_BASE - SAND_TOP + 20);
  // 沙粒
  ctx.fillStyle = 'rgba(90,80,60,0.18)';
  for (const s of SPECKS) { ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill(); }
  // 远处沙丘线
  ctx.strokeStyle = 'rgba(90,80,60,0.35)'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, SAND_TOP + 16);
  ctx.quadraticCurveTo(W * 0.25, SAND_TOP + 6, W * 0.5, SAND_TOP + 16);
  ctx.quadraticCurveTo(W * 0.75, SAND_TOP + 26, W, SAND_TOP + 12);
  ctx.stroke();

  drawSandcastle(660, 226);
  for (const p of PALMS) drawPalm(p.x, p.y);
  for (const u of UMBRELLAS) drawUmbrella(u.x, u.y, u.s);
  for (const tw of TOWELS) drawTowel(tw.x, tw.y);
}

function drawPalm(x, y) {
  ctx.save(); ctx.translate(x, y);
  ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.fillStyle = '#cbb98d';
  ctx.beginPath();                               // 弯曲树干
  ctx.moveTo(-6, 46);
  ctx.quadraticCurveTo(2, 6, 26, -38);
  ctx.quadraticCurveTo(14, 2, 6, 46);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  const tops = [[26, -38]];
  for (const [tx, ty] of tops) {
    ctx.fillStyle = '#7d825e';
    for (let i = 0; i < 5; i++) {                // 叶子
      const a = -Math.PI * 0.9 + i * Math.PI * 0.42;
      const ex = tx + Math.cos(a) * 44, ey = ty + Math.sin(a) * 30 + 12;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.quadraticCurveTo(tx + Math.cos(a) * 26, ty + Math.sin(a) * 20 - 8, ex, ey);
      ctx.quadraticCurveTo(tx + Math.cos(a) * 24, ty + Math.sin(a) * 18 + 4, tx, ty + 5);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = INK2;                        // 椰子
    ctx.beginPath(); ctx.arc(tx - 5, ty + 8, 4.5, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(tx + 6, ty + 6, 4, 0, TAU); ctx.fill();
  }
  ctx.restore();
}
function drawUmbrella(x, y, s) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.strokeStyle = INK; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, 34); ctx.lineTo(-8, -34); ctx.stroke();   // 杆
  const cols = ['#b8ab8a', '#8f8672'];
  for (let i = 0; i < 8; i++) {                  // 伞面扇形
    const a0 = Math.PI + i * Math.PI / 8, a1 = a0 + Math.PI / 8;
    ctx.fillStyle = cols[i % 2];
    ctx.beginPath(); ctx.moveTo(-8, -34);
    ctx.arc(-8, -34, 40, a0, a1); ctx.closePath();
    ctx.fill(); ctx.stroke();
  }
  ctx.fillStyle = INK;
  ctx.beginPath(); ctx.arc(-8, -38, 3, 0, TAU); ctx.fill();
  ctx.restore();
}
function drawTowel(x, y) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(-0.04);
  ctx.fillStyle = '#b5a988'; rr(-26, -9, 52, 18, 5); ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.stroke();
  ctx.strokeStyle = 'rgba(87,80,63,0.6)'; ctx.lineWidth = 3;
  for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(i * 13, -7); ctx.lineTo(i * 13, 7); ctx.stroke(); }
  ctx.restore();
}
function drawSandcastle(x, y) {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = SAND2; ctx.strokeStyle = INK; ctx.lineWidth = 2;
  rr(-22, -14, 44, 16, 2); ctx.fill(); ctx.stroke();
  rr(-22, -26, 12, 14, 2); ctx.fill(); ctx.stroke();
  rr(10, -26, 12, 14, 2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -26); ctx.lineTo(0, -38); ctx.stroke();   // 旗杆
  ctx.fillStyle = RED;
  ctx.beginPath(); ctx.moveTo(0, -38); ctx.lineTo(11, -34); ctx.lineTo(0, -30); ctx.closePath(); ctx.fill();
  ctx.restore();
}

/* ---------------- 海水与海床 ---------------- */
const WEEDS = [];
for (let i = 0; i < 9; i++) WEEDS.push({ x: 70 + i * 140 + rand(-30, 30), h: rand(26, 60), ph: rand(TAU) });
const WDOTS = [];
for (let i = 0; i < 34; i++) WDOTS.push({ x: rand(0, W), y: rand(WL_BASE + 40, FLOOR_Y - 20), r: rand(0.8, 2), sp: rand(4, 14) });

function waterPath() {
  ctx.beginPath();
  ctx.moveTo(0, wlY(0));
  for (let x = 16; x <= W; x += 16) ctx.lineTo(x, wlY(x));
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
}
function drawWater() {
  waterPath();
  const g = ctx.createLinearGradient(0, WL_BASE - 12, 0, H);
  g.addColorStop(0, WATER1); g.addColorStop(1, WATER2);
  ctx.fillStyle = g; ctx.fill();
  // 悬浮微粒
  ctx.fillStyle = 'rgba(240,234,214,0.09)';
  for (const d of WDOTS) {
    const yy = (d.y + T * d.sp) % (FLOOR_Y - WL_BASE - 30) + WL_BASE + 30;
    ctx.beginPath(); ctx.arc(d.x, yy, d.r, 0, TAU); ctx.fill();
  }
  // 水下波纹线
  ctx.strokeStyle = 'rgba(240,234,214,0.10)'; ctx.lineWidth = 1.5;
  for (let i = 0; i < 4; i++) {
    const yy = WL_BASE + 90 + i * 105;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 26) {
      const y2 = yy + Math.sin(x * 0.014 + T * (0.8 + i * 0.2) + i * 2) * 4;
      x === 0 ? ctx.moveTo(x, y2) : ctx.lineTo(x, y2);
    }
    ctx.stroke();
  }
}
function drawFloor() {
  // 后层沙丘
  ctx.fillStyle = FLOOR2;
  ctx.beginPath(); ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 24) ctx.lineTo(x, floorY(x) + 26 + Math.sin(x * 0.02 + 3) * 8);
  ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
  // 前层海床
  ctx.fillStyle = FLOOR;
  ctx.beginPath(); ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 16) ctx.lineTo(x, floorY(x));
  ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = 3;
  ctx.beginPath();
  for (let x = 0; x <= W; x += 16) { const y2 = floorY(x); x === 0 ? ctx.moveTo(x, y2) : ctx.lineTo(x, y2); }
  ctx.stroke();
  // 海草
  ctx.strokeStyle = '#4e4a38'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  for (const w of WEEDS) {
    const base = floorY(w.x) + 4;
    for (let b = 0; b < 3; b++) {
      const sway = Math.sin(T * 1.3 + w.ph + b) * 9;
      ctx.beginPath(); ctx.moveTo(w.x + b * 7 - 7, base);
      ctx.quadraticCurveTo(w.x + b * 7 - 7 + sway, base - w.h * 0.6, w.x + b * 7 - 7 + sway * 1.8, base - w.h + b * 6);
      ctx.stroke();
    }
  }
  ctx.lineCap = 'butt';
  // 海星
  drawStar(360, floorY(360) + 12, 7, '#8f7a54');
  drawStar(940, floorY(940) + 14, 6, '#8f7a54');
}
function drawStar(x, y, r, col) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(0.4);
  ctx.fillStyle = col; ctx.strokeStyle = INK; ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = i * Math.PI / 5 - Math.PI / 2;
    const rr2 = i % 2 === 0 ? r : r * 0.45;
    i === 0 ? ctx.moveTo(Math.cos(a) * rr2, Math.sin(a) * rr2) : ctx.lineTo(Math.cos(a) * rr2, Math.sin(a) * rr2);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}
function drawFoam() {
  ctx.strokeStyle = 'rgba(242,236,218,0.85)'; ctx.lineWidth = 3.5;
  ctx.beginPath();
  for (let x = 0; x <= W; x += 14) { const y2 = wlY(x); x === 0 ? ctx.moveTo(x, y2) : ctx.lineTo(x, y2); }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(242,236,218,0.35)'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let x = 0; x <= W; x += 14) { const y2 = wlY(x) + 6 + Math.sin(x * 0.05 + T * 2) * 2; x === 0 ? ctx.moveTo(x, y2) : ctx.lineTo(x, y2); }
  ctx.stroke();
}

/* ---------------- 实体绘制 ---------------- */
function drawFish(f) {
  if (f.dead) return;
  ctx.save(); ctx.translate(f.x, f.y);
  const a = Math.atan2(f.vy, f.vx);
  const flip = Math.cos(a) < 0;
  ctx.rotate(flip ? a + Math.PI : a);
  ctx.scale(1, flip ? -1 : 1);
  const wob = Math.sin(T * 8 + f.seed) * 0.15;
  ctx.fillStyle = INK2; ctx.strokeStyle = INK; ctx.lineWidth = 1.4;
  ctx.save(); ctx.rotate(wob * 0.4);            // 尾
  ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(-12, -5); ctx.lineTo(-12, 5); ctx.closePath();
  ctx.fill(); ctx.stroke(); ctx.restore();
  ctx.beginPath(); ctx.ellipse(0, 0, 8, 3.6, 0, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.fillStyle = WHITE;
  ctx.beginPath(); ctx.arc(4, -1, 1.3, 0, TAU); ctx.fill();
  ctx.restore();
}
function drawCrab(c) {
  ctx.save(); ctx.translate(c.x, c.y); ctx.scale(c.dir, 1);
  ctx.strokeStyle = INK; ctx.lineWidth = 2;
  ctx.fillStyle = '#8a4434';
  for (let i = -1; i <= 1; i += 2) {            // 腿
    for (let l = 0; l < 3; l++) {
      ctx.beginPath(); ctx.moveTo(i * 5, 0);
      ctx.lineTo(i * 12, -4 + l * 4 + Math.sin(T * 10 + l) * 1.5);
      ctx.stroke();
    }
  }
  ctx.beginPath(); ctx.ellipse(0, 0, 9, 6, 0, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(11, -4, 3.4, 0, TAU); ctx.fill(); ctx.stroke();   // 钳
  ctx.strokeStyle = INK; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(3, -5); ctx.lineTo(4, -10); ctx.moveTo(-3, -5); ctx.lineTo(-4, -10); ctx.stroke();
  ctx.fillStyle = WHITE;
  ctx.beginPath(); ctx.arc(4, -11, 1.8, 0, TAU); ctx.arc(-4, -11, 1.8, 0, TAU); ctx.fill();
  ctx.restore();
}
function drawJelly(j) {
  ctx.save(); ctx.translate(j.x, j.y);
  const pulse = 1 + Math.sin(T * 2.2 + j.seed) * 0.1;
  ctx.scale(1 / pulse, pulse);
  ctx.fillStyle = 'rgba(232,226,204,0.8)'; ctx.strokeStyle = 'rgba(59,50,38,0.65)'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 15, Math.PI, 0);
  ctx.quadraticCurveTo(15, 8, 0, 6);
  ctx.quadraticCurveTo(-15, 8, -15, 0);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.lineWidth = 1.6;
  for (let i = 0; i < 4; i++) {
    const x0 = -10 + i * 6.5;
    ctx.beginPath(); ctx.moveTo(x0, 6);
    ctx.quadraticCurveTo(x0 + Math.sin(T * 3 + i + j.seed) * 5, 16, x0 + Math.sin(T * 2 + i) * 7, 26);
    ctx.stroke();
  }
  ctx.restore();
}
function drawTourist(t, sc) {
  if (t.state === 'gone') return;
  const k = sc || 1;
  ctx.save();
  if (t.state === 'sun') { drawSunbather(t); ctx.restore(); return; }
  ctx.translate(t.x, t.y);
  if (t.state === 'grabbed') ctx.rotate(Math.sin(T * 20) * 0.35);
  ctx.scale(t.dir * k, k);
  const run = t.panic > 0;
  const step = Math.sin(T * (run ? 16 : 8) + t.seed) * (run ? 5 : 3);
  ctx.strokeStyle = INK; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
  // 腿
  ctx.beginPath();
  ctx.moveTo(-2, -9); ctx.lineTo(-2 + step, 0);
  ctx.moveTo(2, -9); ctx.lineTo(2 - step, 0);
  ctx.stroke();
  // 身体
  ctx.fillStyle = t.c1;
  rr(-5, -19, 10, 11, 3); ctx.fill(); ctx.stroke();
  // 手臂
  ctx.beginPath();
  if (run || t.state === 'grabbed') { ctx.moveTo(-4, -17); ctx.lineTo(-7, -24); ctx.moveTo(4, -17); ctx.lineTo(7, -24); }
  else { ctx.moveTo(-4, -16); ctx.lineTo(-6, -10 + step * 0.5); ctx.moveTo(4, -16); ctx.lineTo(6, -10 - step * 0.5); }
  ctx.stroke();
  // 头
  ctx.fillStyle = '#d9c9a8';
  ctx.beginPath(); ctx.arc(0, -24, 4.8, 0, TAU); ctx.fill(); ctx.stroke();
  if (t.hat) {                                   // 帽子
    ctx.fillStyle = t.c2;
    ctx.beginPath(); ctx.arc(0, -25.5, 5, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-7, -25.5); ctx.lineTo(7, -25.5); ctx.stroke();
  }
  ctx.restore();
  if (t.panic > 0 || t.state === 'grabbed') {    // 惊叫
    ctx.save(); ctx.translate(t.x, t.y - (t.state === 'grabbed' ? 40 : 40) + Math.sin(T * 14) * 2);
    ctx.fillStyle = RED; ctx.font = 'bold 15px "Microsoft YaHei", sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('!', 0, 0);
    ctx.restore();
  }
}
function drawSunbather(t) {
  ctx.save(); ctx.translate(t.x, t.y);
  ctx.strokeStyle = INK; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
  ctx.fillStyle = '#c4ae82';                     // 野餐垫
  rr(-24, -4, 48, 10, 3); ctx.fill(); ctx.stroke();
  ctx.fillStyle = t.c1;
  rr(-14, -10, 20, 8, 4); ctx.fill(); ctx.stroke();       // 身体(躺着)
  ctx.fillStyle = '#d9c9a8';
  ctx.beginPath(); ctx.arc(10, -8, 4.6, 0, TAU); ctx.fill(); ctx.stroke(); // 头
  if (t.hat) {
    ctx.fillStyle = t.c2;
    ctx.beginPath(); ctx.arc(10, -9, 5, -Math.PI * 0.8, Math.PI * 0.2); ctx.closePath(); ctx.fill();
  }
  ctx.beginPath(); ctx.moveTo(-14, -7); ctx.lineTo(-20, -3); ctx.stroke(); // 脚
  ctx.restore();
}

/* ---------------- 鲨鱼 ---------------- */
function drawSharkAt(x, y, ang, s, opts) {
  const o = opts || {};
  ctx.save(); ctx.translate(x, y);
  const flip = Math.cos(ang) < 0;
  ctx.rotate(flip ? ang + Math.PI : ang);
  ctx.scale(1, flip ? -1 : 1);
  ctx.scale(s, s);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';

  const L = 120, Hh = 44;
  const wag = Math.sin(T * (6 + Math.min(14, Math.hypot(shark.vx, shark.vy) * 0.03))) * 0.3;
  const FIN = o.fin || SHARK_FIN;

  // 尾鳍
  ctx.save(); ctx.translate(-L * 0.48, 0); ctx.rotate(wag);
  ctx.fillStyle = FIN; ctx.strokeStyle = INK; ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(2, 0);
  ctx.quadraticCurveTo(-14, -6, -26, -30);
  ctx.quadraticCurveTo(-16, -8, -8, -2);
  ctx.lineTo(-8, 2);
  ctx.quadraticCurveTo(-16, 8, -26, 30);
  ctx.quadraticCurveTo(-14, 6, 2, 0);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();

  // 背鳍
  ctx.fillStyle = FIN; ctx.strokeStyle = INK; ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-L * 0.16, -Hh * 0.42);
  ctx.quadraticCurveTo(-L * 0.02, -Hh * 1.28, L * 0.2, -Hh * 0.5);
  ctx.closePath(); ctx.fill(); ctx.stroke();

  // 身体
  ctx.fillStyle = SHARK_BODY;
  ctx.beginPath();
  ctx.moveTo(L * 0.53, Hh * 0.06);
  ctx.quadraticCurveTo(L * 0.34, -Hh * 0.52, 0, -Hh * 0.5);
  ctx.quadraticCurveTo(-L * 0.38, -Hh * 0.42, -L * 0.52, -Hh * 0.14);
  ctx.lineTo(-L * 0.52, Hh * 0.18);
  ctx.quadraticCurveTo(-L * 0.2, Hh * 0.56, L * 0.2, Hh * 0.5);
  ctx.quadraticCurveTo(L * 0.42, Hh * 0.42, L * 0.53, Hh * 0.06);
  ctx.closePath(); ctx.fill(); ctx.stroke();

  // 肚皮
  ctx.fillStyle = SHARK_BELLY;
  ctx.beginPath();
  ctx.moveTo(L * 0.44, Hh * 0.2);
  ctx.quadraticCurveTo(L * 0.1, Hh * 0.58, -L * 0.34, Hh * 0.3);
  ctx.quadraticCurveTo(-L * 0.05, Hh * 0.34, L * 0.44, Hh * 0.16);
  ctx.closePath(); ctx.fill();

  // 胸鳍
  ctx.fillStyle = FIN; ctx.strokeStyle = INK; ctx.lineWidth = 2.6;
  ctx.save();
  ctx.translate(L * 0.06, Hh * 0.34); ctx.rotate(0.5 + wag * 0.3);
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.quadraticCurveTo(-6, 18, -20, 24);
  ctx.quadraticCurveTo(-12, 8, -8, 0);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();

  // 鳃
  ctx.strokeStyle = INK; ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(L * 0.13 - i * 6, 0, Hh * 0.34, -0.5, 0.5);
    ctx.stroke();
  }

  // 眼睛
  const ex = L * 0.36, ey = -Hh * 0.2;
  if (o.dead) {
    ctx.strokeStyle = INK; ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(ex - 5, ey - 5); ctx.lineTo(ex + 5, ey + 5);
    ctx.moveTo(ex + 5, ey - 5); ctx.lineTo(ex - 5, ey + 5);
    ctx.stroke();
  } else {
    ctx.fillStyle = WHITE; ctx.strokeStyle = INK; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(ex, ey, 6.4, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = INK;
    ctx.beginPath(); ctx.arc(ex + 2, ey + 1, 2.6, 0, TAU); ctx.fill();
    if (o.angry) {                                 // 冲刺时的怒眉
      ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.moveTo(ex - 7, ey - 10); ctx.lineTo(ex + 6, ey - 5); ctx.stroke();
    }
  }
  // 鼻孔
  ctx.fillStyle = INK;
  ctx.beginPath(); ctx.arc(L * 0.47, -Hh * 0.08, 1.6, 0, TAU); ctx.fill();

  // 嘴
  const mx0 = L * 0.5, my0 = Hh * 0.12;
  const open = o.mouth !== undefined ? o.mouth : 0;
  if (open < 0.08) {
    ctx.strokeStyle = INK; ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(mx0 - L * 0.2, my0 - 2);
    ctx.quadraticCurveTo(mx0 - L * 0.08, my0 + 7, mx0 + 1, my0);
    ctx.stroke();
  } else {
    const a0 = -0.18, a1 = 0.3 + open * 0.8, len = L * 0.32;
    ctx.fillStyle = '#4a3f30'; ctx.strokeStyle = INK; ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(mx0, my0);
    ctx.lineTo(mx0 + Math.cos(a0) * len, my0 + Math.sin(a0) * len);
    ctx.lineTo(mx0 + Math.cos((a0 + a1) / 2) * len * 1.06, my0 + Math.sin((a0 + a1) / 2) * len * 1.06);
    ctx.lineTo(mx0 + Math.cos(a1) * len, my0 + Math.sin(a1) * len);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // 牙齿
    ctx.fillStyle = WHITE; ctx.lineWidth = 1.2;
    for (const [aa, dirn] of [[a0 + 0.06, 1], [a1 - 0.06, -1]]) {
      for (const tt of [0.4, 0.62, 0.84]) {
        const px = mx0 + Math.cos(aa) * len * tt, py = my0 + Math.sin(aa) * len * tt;
        const nx = Math.cos(aa + dirn * 1.5), ny = Math.sin(aa + dirn * 1.5);
        ctx.beginPath();
        ctx.moveTo(px - Math.cos(aa) * 5, py - Math.sin(aa) * 5);
        ctx.lineTo(px + Math.cos(aa) * 5, py + Math.sin(aa) * 5);
        ctx.lineTo(px + nx * 6, py + ny * 6);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    }
  }
  ctx.restore();

  // 叼着的游客(世界坐标,跟随嘴,放大一号更醒目)
  if (o.carry) {
    drawTourist(o.carry, 1.35);
  }
}
function drawShark() {
  const s = sharkSize();
  const m = mouthPos();
  if (shark.onLand) {                             // 沙滩上的影子
    ctx.fillStyle = 'rgba(60,50,35,0.18)';
    ctx.beginPath(); ctx.ellipse(shark.x, shark.y + 26 * s, 46 * s, 10 * s, 0, 0, TAU); ctx.fill();
  }
  if (shark.boosting && !shark.onLand) {          // 冲刺速度线
    ctx.strokeStyle = 'rgba(242,236,218,0.5)'; ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const off = (i - 1) * 14 * s;
      const bx = shark.x - Math.cos(shark.ang) * (70 + i * 16) * s - Math.sin(shark.ang) * off;
      const by = shark.y - Math.sin(shark.ang) * (70 + i * 16) * s + Math.cos(shark.ang) * off;
      ctx.beginPath(); ctx.moveTo(bx, by);
      ctx.lineTo(bx - Math.cos(shark.ang) * 18, by - Math.sin(shark.ang) * 18);
      ctx.stroke();
    }
  }
  drawSharkAt(shark.x, shark.y, shark.ang, s, {
    mouth: shark.mouth,
    angry: shark.boosting,
    dead: gameState === 'over',
    carry: shark.carry,
  });
}

/* ---------------- HUD ---------------- */
const HUD_CLOUDS = [
  { x: 120, s: 0.7, sp: 5 }, { x: 360, s: 1, sp: 3.4 }, { x: 700, s: 0.85, sp: 4.2 },
  { x: 950, s: 1.05, sp: 2.8 }, { x: 1180, s: 0.75, sp: 3.8 },
];
const FONT_P = '"Press Start 2P","Microsoft YaHei",monospace';
const FONT_C = '"Microsoft YaHei","Press Start 2P",sans-serif';

function panelBox(x, y, w, h) {
  ctx.fillStyle = PANEL;
  rr(x, y, w, h, 10); ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.stroke();
  ctx.strokeStyle = INK2; ctx.lineWidth = 1.4;
  rr(x + 5, y + 5, w - 10, h - 10, 7); ctx.stroke();
}
function drawHUD() {
  // 天空条
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, HUD_H);
  // 云(缓慢漂移,坐在虚线上)
  for (const c of HUD_CLOUDS) {
    const cx = ((c.x + T * c.sp) % (W + 240)) - 120;
    drawCloud(cx, HUD_H - 12, c.s, 0.95);
  }
  // 虚线
  ctx.strokeStyle = INK; ctx.lineWidth = 3;
  ctx.setLineDash([16, 12]);
  ctx.beginPath(); ctx.moveTo(0, HUD_H - 6); ctx.lineTo(W, HUD_H - 6); ctx.stroke();
  ctx.setLineDash([]);

  // 1UP SCORE
  panelBox(24, 14, 258, 76);
  ctx.textAlign = 'left';
  ctx.fillStyle = INK2; ctx.font = '11px ' + FONT_P;
  ctx.fillText('1UP SCORE', 42, 38);
  ctx.fillStyle = INK; ctx.font = '24px ' + FONT_P;
  ctx.fillText(pad(score, 6), 42, 72);

  // HI-SCORE(经典街机行为:实时显示历史最高与当前的较大者)
  panelBox(W / 2 - 130, 14, 260, 76);
  ctx.textAlign = 'center';
  ctx.fillStyle = INK2; ctx.font = '11px ' + FONT_P;
  ctx.fillText('HI-SCORE', W / 2, 38);
  ctx.fillStyle = INK; ctx.font = '24px ' + FONT_P;
  ctx.fillText(pad(Math.max(hiscore, score), 6), W / 2, 72);

  // BIG SHARK LV
  panelBox(W - 282, 14, 258, 76);
  ctx.textAlign = 'left';
  ctx.fillStyle = INK2; ctx.font = '11px ' + FONT_P;
  ctx.fillText('BIG SHARK', W - 264, 38);
  ctx.fillStyle = INK; ctx.font = '24px ' + FONT_P;
  ctx.fillText('LV.' + level, W - 264, 72);
  const filled = Math.floor(clamp(xp / xpNeed, 0, 1) * 6 + 1e-6);
  for (let i = 0; i < 6; i++) {
    const px2 = W - 130 + i * 17;
    ctx.beginPath(); ctx.arc(px2, 64, 5.5, 0, TAU);
    if (i < filled) { ctx.fillStyle = INK; ctx.fill(); }
    ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.stroke();
  }
}

/* ---------------- 底部状态条 ---------------- */
let hatch = null;
function makeHatch() {
  const c = document.createElement('canvas'); c.width = c.height = 8;
  const g = c.getContext('2d');
  g.strokeStyle = INK; g.lineWidth = 3;
  g.beginPath(); g.moveTo(-2, 10); g.lineTo(10, -2); g.stroke();
  g.beginPath(); g.moveTo(-2, 4); g.lineTo(4, -2); g.stroke();
  g.beginPath(); g.moveTo(4, 10); g.lineTo(10, 4); g.stroke();
  hatch = ctx.createPattern(c, 'repeat');
}
function statBar(x, y, w, h, label, p, warn) {
  ctx.textAlign = 'left';
  ctx.fillStyle = INK; ctx.font = 'bold 13px ' + FONT_C;
  ctx.fillText(label, x, y + h - 4);
  const bx = x + 76, bw = w, bh = h;
  ctx.fillStyle = 'rgba(40,32,22,0.35)';
  rr(bx, y, bw, bh, 4); ctx.fill();
  ctx.save();
  rr(bx + 2, y + 2, Math.max(0, (bw - 4) * clamp(p, 0, 1)), bh - 4, 3); ctx.clip();
  if (warn) {
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(T * 10);
    ctx.fillStyle = RED; ctx.fillRect(bx, y, bw, bh);
    ctx.globalAlpha = 1;
  } else { ctx.fillStyle = hatch || INK; ctx.fillRect(bx, y, bw, bh); }
  ctx.restore();
  ctx.strokeStyle = INK; ctx.lineWidth = 3;
  rr(bx, y, bw, bh, 4); ctx.stroke();
}
function drawBars() {
  statBar(24, H - 84, 170, 20, 'BOOST', boost / 100, boost < 20 && shark.boosting);
  statBar(24, H - 50, 240, 22, 'HUNGER', hunger / 100, hunger < 25);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(59,50,38,0.55)'; ctx.font = '12px ' + FONT_C;
  ctx.fillText('MOUSE 游动 · 左键/空格 冲刺 · P 暂停 · M 静音', W - 24, H - 18);
}

/* ---------------- 粒子 / 浮字 ---------------- */
function drawFx() {
  for (const p of parts) {
    const k = 1 - p.t / p.life;
    if (p.kind === 'bubble') {
      ctx.strokeStyle = 'rgba(242,236,218,0.7)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.stroke();
    } else if (p.kind === 'puff') {
      ctx.fillStyle = p.col;
      ctx.globalAlpha = k * 0.8;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1.4 - k * 0.4), 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = 'rgba(242,236,218,0.8)';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * k, 0, TAU); ctx.fill();
    }
  }
  ctx.textAlign = 'center';
  for (const p of pops) {
    const a = clamp(p.life * 2, 0, 1);
    ctx.globalAlpha = a;
    ctx.font = (p.big ? 20 : 15) + 'px ' + FONT_P;
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(230,220,189,0.9)';
    ctx.strokeText(p.text, p.x, p.y);
    ctx.fillStyle = p.big ? RED : INK;
    ctx.fillText(p.text, p.x, p.y);
    ctx.globalAlpha = 1;
  }
}

/* ---------------- 覆盖屏 ---------------- */
function dim(a) { ctx.fillStyle = 'rgba(52,44,32,' + a + ')'; ctx.fillRect(0, 0, W, H); }
function drawTitle() {
  dim(0.45);
  ctx.textAlign = 'center';
  // LOGO
  ctx.font = '64px ' + FONT_P;
  ctx.fillStyle = INK; ctx.fillText('BIG SHARK', W / 2 + 5, 305 + 5);
  ctx.fillStyle = PAPER; ctx.fillText('BIG SHARK', W / 2, 305);
  // 波浪下划线
  ctx.strokeStyle = PAPER; ctx.lineWidth = 4;
  ctx.beginPath();
  for (let x = W / 2 - 300; x <= W / 2 + 300; x += 12) {
    const y2 = 345 + Math.sin(x * 0.04 + T * 3) * 6;
    x === W / 2 - 300 ? ctx.moveTo(x, y2) : ctx.lineTo(x, y2);
  }
  ctx.stroke();
  ctx.fillStyle = '#e0d6b8'; ctx.font = '20px ' + FONT_C;
  ctx.fillText('复古街机 · 化身大鲨鱼,觅食求生', W / 2, 396);
  // 闪烁开始提示
  ctx.globalAlpha = 0.55 + 0.45 * Math.sin(T * 4);
  ctx.fillStyle = PAPER; ctx.font = '20px ' + FONT_P;
  ctx.fillText('CLICK TO START', W / 2, 470);
  ctx.globalAlpha = 1;
  // 操作说明
  ctx.fillStyle = 'rgba(226,216,186,0.85)'; ctx.font = '15px ' + FONT_C;
  ctx.fillText('鼠标 / WASD 游动 · 按住左键或空格 冲刺 · 沙滩上按住冲刺 一蹦一蹦弹回海里', W / 2, 660);
  ctx.fillText('啃鱼群 +25 · 叼起沙滩游客拖回深海 +500 · 水母会蜇人 · 饥饿条见底就 GAME OVER', W / 2, 690);
  ctx.fillStyle = 'rgba(226,216,186,0.6)'; ctx.font = '12px ' + FONT_P;
  ctx.fillText('HI-SCORE ' + pad(hiscore, 6), W / 2, 740);
  // 巡游的演示鲨鱼
  const dx = ((T * 150) % (W + 400)) - 200;
  drawSharkAt(dx, 555 + Math.sin(T * 1.2) * 26, Math.cos(T * 1.2) * 0.18 + (Math.cos(T * 1.2) < 0 ? Math.PI : 0) * 0, 1.05, { mouth: (Math.sin(T * 2) + 1) * 0.2 });
}
function drawOver() {
  dim(0.55);
  ctx.textAlign = 'center';
  ctx.font = '56px ' + FONT_P;
  ctx.fillStyle = INK; ctx.fillText('GAME OVER', W / 2 + 4, 330 + 4);
  ctx.fillStyle = RED; ctx.fillText('GAME OVER', W / 2, 330);
  ctx.fillStyle = '#e0d6b8'; ctx.font = '18px ' + FONT_C;
  ctx.fillText('大鲨鱼饿晕了…… 大海需要更多猎物。', W / 2, 386);
  ctx.fillStyle = PAPER; ctx.font = '22px ' + FONT_P;
  ctx.fillText('SCORE ' + pad(score, 6), W / 2, 450);
  if (newRecord) {
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(T * 6);
    ctx.font = '18px ' + FONT_P;
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(230,220,189,0.85)';
    ctx.strokeText('NEW RECORD!', W / 2, 492);
    ctx.fillStyle = RED;
    ctx.fillText('NEW RECORD!', W / 2, 492);
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = '#cfc4a0'; ctx.font = '14px ' + FONT_P;
    ctx.fillText('HI-SCORE ' + pad(hiscore, 6), W / 2, 492);
  }
  if (overCd <= 0) {
    ctx.globalAlpha = 0.55 + 0.45 * Math.sin(T * 4);
    ctx.fillStyle = PAPER; ctx.font = '16px ' + FONT_P;
    ctx.fillText('CLICK TO RETRY', W / 2, 560);
    ctx.globalAlpha = 1;
  }
}
function drawPaused() {
  dim(0.5);
  ctx.textAlign = 'center';
  ctx.fillStyle = PAPER; ctx.font = '36px ' + FONT_P;
  ctx.fillText('PAUSED', W / 2, H / 2 - 10);
  ctx.font = '16px ' + FONT_C;
  ctx.fillText('按 P 或点击继续', W / 2, H / 2 + 30);
}

/* ---------------- 胶片质感 ---------------- */
let grainCvs = null, grainPat = null, frame = 0, vig = null;
function makeGrain() {
  if (!grainCvs) { grainCvs = document.createElement('canvas'); grainCvs.width = grainCvs.height = 160; }
  const g = grainCvs.getContext('2d');
  const id = g.createImageData(160, 160);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.random() * 255;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 22;
  }
  g.putImageData(id, 0, 0);
  grainPat = ctx.createPattern(grainCvs, 'repeat');
}
function makeVignette() {
  vig = document.createElement('canvas'); vig.width = W; vig.height = H;
  const g = vig.getContext('2d');
  const gr = g.createRadialGradient(W / 2, H / 2, H * 0.36, W / 2, H / 2, H * 0.82);
  gr.addColorStop(0, 'rgba(30,24,14,0)');
  gr.addColorStop(1, 'rgba(30,24,14,0.5)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
}
function drawFilm() {
  // 噪点
  if (frame % 5 === 0 || !grainPat) makeGrain();
  if (grainPat) {
    ctx.save();
    ctx.translate(rand(-80, 0), rand(-80, 0));
    ctx.fillStyle = grainPat;
    ctx.fillRect(0, 0, W + 160, H + 160);
    ctx.restore();
  }
  // 暗角
  if (vig) ctx.drawImage(vig, 0, 0);
  // 亮度闪烁
  ctx.fillStyle = 'rgba(255,248,225,' + (0.02 + 0.018 * Math.sin(T * 9.3)) + ')';
  ctx.fillRect(0, 0, W, H);
  // 偶发划痕
  if (rand() < 0.05) {
    const sx = rand(0, W);
    ctx.strokeStyle = 'rgba(40,32,20,0.12)'; ctx.lineWidth = rand(0.5, 1.4);
    ctx.beginPath(); ctx.moveTo(sx, rand(0, 80)); ctx.lineTo(sx + rand(-8, 8), rand(H - 80, H)); ctx.stroke();
  }
}

/* ---------------- 准星 ---------------- */
function drawCursor() {
  const x = input.mx, y = input.my;
  const r = shark.boosting ? 13 : 10;
  ctx.strokeStyle = 'rgba(59,50,38,0.9)'; ctx.lineWidth = 2.4;
  ctx.fillStyle = 'rgba(242,236,218,0.9)';
  ctx.beginPath(); ctx.arc(x, y, 2, 0, TAU); ctx.fill();
  for (const [a, b] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    ctx.beginPath();
    ctx.moveTo(x + a * 5, y + b * 5);
    ctx.lineTo(x + a * r, y + b * r);
    ctx.stroke();
  }
}

/* ---------------- 渲染主流程 ---------------- */
function render() {
  ctx.save();
  // 手摇放映机抖动
  if (rand() < 0.35) ctx.translate(rand(-1.2, 1.2), rand(-1.2, 1.2));
  if (shake > 0) ctx.translate(rand(-shake, shake), rand(-shake, shake));

  // 背景:水线以上留纸色
  ctx.fillStyle = PAPER; ctx.fillRect(-4, -4, W + 8, H + 8);

  drawBeach();

  // 沙滩上的游客和螃蟹(在水面之后画会被水盖住,所以先画水前层)
  for (const t of tourists) if (t.state === 'walk' || t.state === 'sun') drawTourist(t);
  for (const c of crabs) drawCrab(c);

  drawWater();
  drawFloor();
  for (const f of fishes) drawFish(f);
  for (const t of tourists) if (t.state === 'swim') drawTourist(t);
  for (const j of jellies) drawJelly(j);

  drawShark();
  drawFoam();
  drawFx();

  ctx.restore();   // 抖动不影响 HUD

  drawHUD();
  if (gameState !== 'title') drawBars();

  if (gameState === 'title') drawTitle();
  else if (gameState === 'over') drawOver();
  else if (paused) drawPaused();

  drawFilm();
  drawCursor();
}

/* ---------------- 主循环 ---------------- */
let last = performance.now(), lastFrame = last;
function tick(now) {
  let dt = Math.min((now - last) / 1000, 0.033);
  last = now; lastFrame = now;
  if (paused) dt = 0;
  T += dt; frame++;
  update(dt);
  render();
}
function loop(now) {
  requestAnimationFrame(loop);
  tick(now);
}
requestAnimationFrame(loop);
// 某些嵌入式 webview 会冻结 rAF:用定时器兜底驱动,保证画面不死
setInterval(() => {
  const now = performance.now();
  if (now - lastFrame > 50) tick(now);
}, 16);

/* ---------------- 启动 ---------------- */
if (document.fonts && document.fonts.load) {
  document.fonts.load('16px "Press Start 2P"');
  document.fonts.load('bold 16px "Microsoft YaHei"');
}
makeHatch();
makeVignette();
makeGrain();
resetGame();
gameState = 'title';

/* 调试接口(自动化测试用) */
window.__shark = {
  info: () => ({
    state: gameState, paused,
    score, level, xp, need: xpNeed, hunger, boost,
    x: shark.x, y: shark.y, onLand: shark.onLand, carry: !!shark.carry,
    fish: fishes.filter(f => !f.dead).length,
    tourists: tourists.filter(t => t.state !== 'gone').length,
    hiscore,
    dbg: { ...shark.dbg, mouth: +shark.mouth.toFixed(2), biteCd: +shark.biteCd.toFixed(2) },
    nearestFish: (() => {
      let best = null, bd = 1e9;
      for (const f of fishes) { if (f.dead) continue; const d = dist(shark.x, shark.y, f.x, f.y); if (d < bd) { bd = d; best = f; } }
      return best ? { x: Math.round(best.x), y: Math.round(best.y) } : null;
    })(),
    nearestTour: (() => {
      let best = null, bd = 1e9;
      for (const t of tourists) {
        if (t.state !== 'walk' && t.state !== 'sun' && t.state !== 'swim') continue;
        const d = dist(shark.x, shark.y, t.x, t.y); if (d < bd) { bd = d; best = t; }
      }
      return best ? { x: Math.round(best.x), y: Math.round(best.y), state: best.state } : null;
    })(),
  }),
  aim: (wx, wy) => {
    const c = document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    const s = r.width / W;
    c.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + wx * s, clientY: r.top + wy * s, bubbles: true }));
  },
  holdBoost: down => {
    window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { key: ' ', bubbles: true }));
  },
  tp: (x, y) => { shark.x = x; shark.y = y; shark.vx = shark.vy = 0; },
  setHunger: v => hunger = v,
  addScore: n => score += n,
  start: () => { resetGame(); startGame(); },
};

requestAnimationFrame(loop);
