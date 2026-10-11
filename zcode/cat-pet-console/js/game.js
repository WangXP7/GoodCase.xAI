/* ==========================================================
   NEKO PAL · 猫咪掌机 - 游戏逻辑
   ========================================================== */
"use strict";

const $ = s => document.querySelector(s);
const SAVE_KEY = "nekopal_save_v1";
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

/* ---------------- 状态 ---------------- */
function defaultState() {
  return {
    name: "", color: "gray",
    hunger: 78, happiness: 80, energy: 82, clean: 85,
    coins: 50, bond: 0, level: 1,
    sleeping: false,
    wish: null,          // { id, deadline }
    nextWishAt: 0,       // 时间戳
    nextChatAt: 0,
    nextWanderAt: 0,
    decor: [],           // 已解锁装饰 data-deco 列表
    sound: true,
    bornAt: Date.now(),
    lastTick: Date.now(),
  };
}
let S = defaultState();

const FURS = [
  { id: "orange", label: "橘猫" },
  { id: "gray",   label: "灰猫" },
  { id: "black",  label: "黑猫" },
  { id: "white",  label: "白猫" },
  { id: "cow",    label: "奶牛猫" },
];
const NAMES = ["团子", "年糕", "麻薯", "布丁", "煤球", "汤圆", "雪球", "奶糖", "豆包", "花卷"];

/* 装饰解锁：等级 -> 装饰 */
const DECO = {
  sillPlant: { lv: 2,  name: "窗台小绿植" },
  blanket:   { lv: 3,  name: "沙发格纹毯" },
  photo:     { lv: 4,  name: "猫咪小相框" },
  lamp:      { lv: 5,  name: "暖光落地灯" },
  aquarium:  { lv: 6,  name: "茶几小鱼缸" },
  rug:       { lv: 7,  name: "爪印圆地毯" },
  books:     { lv: 8,  name: "窗边小书堆" },
  family:    { lv: 9,  name: "全家福相框" },
  trophy:    { lv: 10, name: "猫猫大师奖杯" },
};

/* 愿望定义 */
const WISHES = [
  { id: "kibble", icon: "🍚", text: "想吃猫粮啦",  reward: 6 },
  { id: "can",    icon: "🐟", text: "好馋罐头…",   reward: 10 },
  { id: "fish",   icon: "🍥", text: "想吃小鱼干",  reward: 12 },
  { id: "wand",   icon: "🎣", text: "想玩逗猫棒",  reward: 8 },
  { id: "yarn",   icon: "🧶", text: "毛线球！毛线球！", reward: 8 },
  { id: "bath",   icon: "🫧", text: "想洗香香",    reward: 10 },
  { id: "nap",    icon: "🛏️", text: "想睡个好觉",  reward: 6 },
];

/* 点位（等距地面百分比坐标，z 为离地高度 px）
   地面尺寸 500×380，原点在房间中心 */
const GROUND = { w: 500, d: 380 };
const SPOTS = {
  floorCenter: { x: 52, y: 58 },
  floorLeft:   { x: 16, y: 62 },
  floorRight:  { x: 62, y: 72 },
  sofa:        { x: 23, y: 84, z: 40 },
  washer:      { x: 84, y: 60, z: 98 },
  bowl:        { x: 20, y: 62 },
  tree:        { x: 69, y: 43, z: 82 },
};
function spotPx(s) {
  return { x: s.x / 100 * GROUND.w, y: s.y / 100 * GROUND.d };
}

/* 衰减速率（每秒） */
const RATE = {
  hunger: 100 / 2700,
  happiness: 100 / 3300,
  energyAwake: 100 / 5200,
  energySleep: 100 / 800,     // 睡觉恢复
  clean: 100 / 7600,
  happinessSleep: 100 / 14000,
  cleanSleep: 100 / 22000,
};

/* ---------------- DOM 引用 ---------------- */
const el = {
  stage: $("#stage"), console: $("#console"),
  room: $("#room"), cat: $("#cat"), catFlip: $("#catFlip"), catSvg: $("#catSvg"),
  bubble: $("#bubble"), fx: $("#fx"),
  modalLayer: $("#modalLayer"), toast: $("#toast"),
  coinNum: $("#coinNum"), lvlNum: $("#lvlNum"),
  bowl: $("#bowl"), yarn: $("#yarn"), dim: $("#dim"),
  bathFoam: $("#bathFoam"),
  clockH: $("#clockH"), clockM: $("#clockM"),
};

/* ---------------- 音效（WebAudio 合成） ---------------- */
let AC = null;
function audio() {
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
  if (AC && AC.state === "suspended") AC.resume();
  return AC;
}
function tone(freq, dur = 0.12, type = "sine", vol = 0.16, delay = 0, slideTo = null) {
  if (!S.sound) return;
  const ac = audio(); if (!ac) return;
  const t0 = ac.currentTime + delay;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(ac.destination);
  o.start(t0); o.stop(t0 + dur + 0.05);
}
const sfx = {
  click:  () => tone(760, 0.06, "square", 0.08),
  meow:   () => { tone(660, 0.16, "sine", 0.14, 0, 880); tone(880, 0.22, "sine", 0.12, 0.12, 440); },
  purr:   () => { tone(160, 0.3, "sine", 0.1); tone(180, 0.3, "sine", 0.08, 0.08); },
  eat:    () => { for (let i = 0; i < 4; i++) tone(rand(300, 500), 0.05, "triangle", 0.09, i * 0.12); },
  coin:   () => { tone(1180, 0.09, "square", 0.1); tone(1560, 0.14, "square", 0.1, 0.09); },
  wash:   () => { for (let i = 0; i < 5; i++) tone(rand(900, 1600), 0.06, "sine", 0.05, i * 0.1); },
  levelup:() => { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.16, "triangle", 0.12, i * 0.11)); },
  sleep:  () => { tone(520, 0.2, "sine", 0.1, 0, 300); },
  morning:() => { tone(700, 0.14, "sine", 0.1); tone(900, 0.18, "sine", 0.1, 0.14); },
};

/* ---------------- 工具 UI ---------------- */
let toastTimer = null;
function toast(msg, dur = 2200) {
  el.toast.innerHTML = msg;
  el.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove("show"), dur);
}

let bubbleTimer = null;
function bubble(html, dur = 3200) {
  el.bubble.classList.toggle("rt", lastSpotX > 52);
  el.bubble.innerHTML = html;
  el.bubble.classList.add("show");
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => el.bubble.classList.remove("show"), dur);
}

function spawnFx(char, cls, n = 1, spread = 60) {
  for (let i = 0; i < n; i++) {
    const p = document.createElement("i");
    p.className = "pt " + cls;
    if (cls !== "bub") p.textContent = char;
    p.style.left = (35 + rand(-14, 34)) + "%";
    p.style.top = (12 + rand(-10, 20)) + "%";
    p.style.setProperty("--dx", rand(-spread, spread) + "px");
    p.style.animationDelay = (i * 0.16) + "s";
    el.fx.appendChild(p);
    p.addEventListener("animationend", () => p.remove());
  }
}

/* ---------------- 存档 ---------------- */
function save() {
  S.lastTick = Date.now();
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) {}
}
function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return Object.assign(defaultState(), data);
  } catch (e) { return null; }
}

/* ---------------- 猫外观与姿态 ---------------- */
function applyCatLook() {
  el.cat.classList.remove("fur-orange", "fur-gray", "fur-black", "fur-white", "fur-cow");
  el.cat.classList.add("fur-" + S.color);
}
function setPose(pose) {
  el.cat.classList.remove("pose-sit", "pose-sleep", "pose-eat", "pose-play", "pose-happy");
  el.cat.classList.add("pose-" + pose);
}
function setMood(mood) { // open(默认) happy sleepy closed
  el.catSvg.classList.remove("mood-happy", "mood-sleepy", "mood-closed");
  if (mood && mood !== "open") el.catSvg.classList.add("mood-" + mood);
}
function face(dir) {
  el.cat.classList.toggle("face-l", dir === "l");
}
let lastSpotX = 42;
function placeCat(spotKey) {
  const s = SPOTS[spotKey];
  const p = spotPx(s);
  el.cat.style.transition = "none";
  el.cat.style.left = p.x + "px";
  el.cat.style.top = p.y + "px";
  el.cat.style.setProperty("--z", (s.z || 0) + "px");
  void el.cat.offsetWidth;
  el.cat.style.transition = "";
  lastSpotX = s.x;
}
function moveCat(spotKey, dur = 1.8, cb) {
  const s = SPOTS[spotKey];
  const p = spotPx(s);
  face(s.x < lastSpotX ? "l" : "r");
  lastSpotX = s.x;
  el.cat.classList.add("walking");
  setPose("sit");
  el.cat.style.left = p.x + "px";
  el.cat.style.top = p.y + "px";
  el.cat.style.setProperty("--z", (s.z || 0) + "px");
  setTimeout(() => {
    el.cat.classList.remove("walking");
    face("r");
    if (cb) cb();
  }, dur * 1000);
}

/* ---------------- HUD ---------------- */
function statVal(k) { return S[k]; }
function updateHUD() {
  document.querySelectorAll(".hud .bar").forEach(bar => {
    const k = bar.dataset.k;
    const v = clamp(statVal(k), 0, 100);
    bar.querySelector("i").style.transform = `scaleX(${v / 100})`;
    bar.classList.toggle("warn", v < 28);
  });
  el.coinNum.textContent = Math.floor(S.coins);
  el.lvlNum.textContent = "Lv." + S.level;
}

/* ---------------- 时间与昼夜 ---------------- */
function dayClass(h) {
  if (h >= 6 && h < 10) return "dn-morning";
  if (h >= 10 && h < 17) return "dn-noon";
  if (h >= 17 && h < 20) return "dn-dusk";
  return "dn-night";
}
function updateDayNight() {
  const now = new Date();
  const h = now.getHours();
  document.body.className = dayClass(h);
  const mh = (h % 12) * 30 + now.getMinutes() * 0.5;
  const mm = now.getMinutes() * 6;
  el.clockH.style.transform = `rotate(${mh}deg)`;
  el.clockM.style.transform = `rotate(${mm}deg)`;
}

/* ---------------- 等级 ---------------- */
function bondNeed(lv) { return lv * lv * 12; }   // 升到下一级所需
function addBond(n) {
  S.bond += n;
  while (S.level < 10 && S.bond >= bondNeed(S.level)) {
    S.bond -= bondNeed(S.level);
    S.level++;
    onLevelUp();
  }
}
function onLevelUp() {
  const reward = 20 + S.level * 5;
  S.coins += reward;
  sfx.levelup();
  const decoEntry = Object.entries(DECO).find(([k, d]) => d.lv === S.level);
  let decoMsg = "";
  if (decoEntry) {
    unlockDeco(decoEntry[0]);
    decoMsg = `<div style="font-size:12px;color:#9ab05a;font-weight:800;margin-top:6px">🎁 新装饰解锁：${decoEntry[1].name}</div>`;
  }
  openPanel(`
    <div class="bigemoji">🌟</div>
    <div class="lvlnum">Lv.${S.level}</div>
    <h2>和 ${S.name} 更亲密啦！</h2>
    <div class="center" style="margin:8px 0 4px;font-size:12.5px;color:#a98c62">
      亲密度奖励 +${reward} 金币${decoMsg}
    </div>
    <button class="go" style="margin-top:10px" onclick="closePanel()">好耶！</button>
  `);
}
function unlockDeco(key) {
  if (S.decor.includes(key)) return;
  S.decor.push(key);
  const node = document.querySelector(`[data-deco="${key}"]`);
  if (node) {
    node.classList.add("on", "pop");
    setTimeout(() => node.classList.remove("pop"), 800);
  }
}
function applyDecor() {
  S.decor.forEach(key => {
    const node = document.querySelector(`[data-deco="${key}"]`);
    if (node) node.classList.add("on");
  });
}

/* ---------------- 愿望 ---------------- */
function wishAvailable(w) {
  if (w.id === "nap" && S.energy > 72) return false;
  if (["kibble", "can", "fish"].includes(w.id) && S.hunger > 82) return false;
  if (w.id === "bath" && S.clean > 82) return false;
  if (["wand", "yarn"].includes(w.id) && S.happiness > 84) return false;
  return true;
}
function maybeSpawnWish(now) {
  if (S.sleeping || S.wish || now < S.nextWishAt) return;
  if (!S.name) return;
  const pool = WISHES.filter(wishAvailable);
  if (!pool.length) return;
  const w = pick(pool);
  S.wish = { id: w.id, deadline: now + 150000 };
  bubble(`<span class="big">${w.icon}</span>${w.text}<span class="cd">⏳ 2分30秒内满足TA</span>`, 4200);
  sfx.meow();
}
function completeWish(actionId) {
  if (!S.wish || S.wish.id !== actionId) return;
  const w = WISHES.find(x => x.id === actionId);
  S.wish = null;
  S.nextWishAt = Date.now() + rand(80, 160) * 1000;
  S.coins += w.reward;
  addBond(8);
  sfx.coin();
  toast(`愿望达成！金币 +${w.reward} · 亲密度 +8`);
  happyMoment(1600);
}
function failWish(now) {
  if (!S.wish || now < S.wish.deadline) return;
  S.wish = null;
  S.nextWishAt = Date.now() + rand(70, 120) * 1000;
  bubble("呜…算了 🥺", 2400);
}

/* ---------------- 闲聊 ---------------- */
function maybeChat(now) {
  if (S.sleeping || S.wish || !S.name || now < S.nextChatAt) return;
  S.nextChatAt = now + rand(26, 55) * 1000;
  const low = [];
  if (S.hunger < 32) low.push(`<span class="big">🍚</span>肚子咕咕叫了…`);
  if (S.happiness < 32) low.push(`<span class="big">🥱</span>好无聊哇…`);
  if (S.energy < 30) low.push(`<span class="big">💤</span>眼皮好重…`);
  if (S.clean < 32) low.push(`<span class="big">🫧</span>身上痒痒的…`);
  if (low.length) { bubble(pick(low), 3000); return; }
  const chats = [
    `<span class="big">😺</span>喵呜~`, `<span class="big">☀️</span>窗外的鸟真多`,
    `<span class="big">🐾</span>铲屎官最好了`, `<span class="big">🧶</span>尾巴好像有自己的想法`,
    `<span class="big">🛋️</span>沙发是我的地盘`, `<span class="big">🌊</span>洗衣机转圈圈好好看`,
    `<span class="big">💭</span>梦里全是小鱼干`, `<span class="big">✨</span>今天也是想你的一天`,
  ];
  bubble(pick(chats), 2800);
}

/* ---------------- 猫行为 ---------------- */
function maybeWander(now) {
  if (S.sleeping || S.wish || el.cat.classList.contains("walking")) return;
  if (busyUntil > now || now < S.nextWanderAt) return;
  S.nextWanderAt = now + rand(9, 20) * 1000;
  if (Math.random() < 0.34) { // 小动作
    if (Math.random() < 0.5) {
      el.cat.classList.add("ear-twitch");
      setTimeout(() => el.cat.classList.remove("ear-twitch"), 700);
    } else {
      spawnFx("♪", "note", 1, 20);
    }
    return;
  }
  // 想睡时优先去洗衣机上（像参考图那样趴洗衣机）
  let spot;
  if (S.energy < 34 && !S.sleeping) spot = "washer";
  else spot = pick(["floorCenter", "floorLeft", "floorRight", "sofa", "tree", "washer"]);
  if (currentSpot === spot) return;
  currentSpot = spot;
  moveCat(spot, 1.8);
}

function happyMoment(dur = 1500) {
  setPose("happy");
  setMood("happy");
  spawnFx("♥", "heart", 3);
  setTimeout(() => { setPose("sit"); setMood("open"); }, dur);
}

let busyUntil = 0;
let currentSpot = "floorCenter";
let zzzTimer = null;

/* ---------------- 动作 ---------------- */
function withBusy(fn) {
  if (!S.name) return;
  if (Date.now() < busyUntil) return;
  busyUntil = Date.now() + 300;
  fn();
}

function feedAction(item) {
  const cost = { kibble: 0, can: 10, fish: 15 }[item];
  if (S.coins < cost) { toast("金币不够啦，多陪陪猫咪赚金币吧 💰"); return; }
  S.coins -= cost;
  closePanel();
  busyUntil = Date.now() + 5200;
  bubble(`<span class="big">🍚</span>开饭咯！`, 1800);
  moveCat("bowl", 1.8, () => {
    el.bowl.classList.add("filled");
    setPose("eat");
    setMood("happy");
    sfx.eat();
    const fxRun = setInterval(() => spawnFx("", "bub", 1, 24), 300);
    setTimeout(() => {
      clearInterval(fxRun);
      el.bowl.classList.remove("filled");
      setPose("sit"); setMood("open");
      const gain = { kibble: [18, 0], can: [35, 6], fish: [22, 12] }[item];
      S.hunger = clamp(S.hunger + gain[0], 0, 100);
      S.happiness = clamp(S.happiness + gain[1], 0, 100);
      addBond(2);
      toast({ kibble: "猫粮真香~", can: "罐头大满足！", fish: "小鱼干最棒了！" }[item]);
      completeWish(item);
      updateHUD(); save();
      S.nextWanderAt = Date.now();
    }, 2800);
  });
}

function playAction(item) {
  closePanel();
  busyUntil = Date.now() + 3800;
  if (S.energy < 12) { bubble(`<span class="big">😵</span>玩不动了…让TA睡会儿`, 2200); return; }
  moveCat(item === "yarn" ? "floorRight" : "floorCenter", 1.2, () => {
    setPose("play");
    setMood("happy");
    if (item === "yarn") {
      el.yarn.classList.add("rolling");
      setTimeout(() => el.yarn.classList.remove("rolling"), 2900);
    }
    const noteRun = setInterval(() => spawnFx(pick(["♪", "♫"]), "note", 1, 50), 260);
    sfx.meow();
    setTimeout(() => {
      clearInterval(noteRun);
      setPose("sit"); setMood("open");
      S.happiness = clamp(S.happiness + (item === "wand" ? 18 : 15), 0, 100);
      S.energy = clamp(S.energy - (item === "wand" ? 8 : 6), 0, 100);
      S.hunger = clamp(S.hunger - 3, 0, 100);
      addBond(2);
      toast(item === "wand" ? "逗猫棒超好玩！心情 +" : "毛线球！永远的神 🧶");
      completeWish(item);
      updateHUD(); save();
      S.nextWanderAt = Date.now();
    }, 3200);
  });
}

function bathAction() {
  closePanel();
  busyUntil = Date.now() + 4600;
  moveCat("floorCenter", 1.2, () => {
    setPose("sit");
    setMood("closed");
    el.cat.classList.add("bathing");
    sfx.wash();
    const bubRun = setInterval(() => spawnFx("", "bub", 2, 70), 220);
    setTimeout(() => {
      clearInterval(bubRun);
      el.cat.classList.remove("bathing");
      setMood("open");
      S.clean = 100;
      S.happiness = clamp(S.happiness - 2, 0, 100);
      addBond(2);
      toast("洗得香香的！清洁度 MAX 🫧");
      completeWish("bath");
      updateHUD(); save();
      S.nextWanderAt = Date.now();
    }, 3400);
  });
}

function sleepToggle() {
  closePanel();
  if (S.sleeping) { wakeUp(true); return; }
  S.sleeping = true;
  el.room.classList.add("sleeping");
  sfx.sleep();
  busyUntil = Date.now() + 3600;
  bubble(`<span class="big">🌙</span>晚安，铲屎官…`, 2200);
  moveCat("washer", 2.0, () => {
    setPose("sleep");
    setMood("closed");
    zzzTimer = setInterval(() => spawnFx("Z", "zzz", 1, 26), 1800);
  });
  completeWish("nap");
  updateHUD(); save();
}
function wakeUp(manual) {
  S.sleeping = false;
  el.room.classList.remove("sleeping");
  clearInterval(zzzTimer);
  setPose("sit"); setMood("open");
  el.cat.style.setProperty("--z", "0px");
  sfx.morning();
  if (manual) { toast(`${S.name} 伸了个大懒腰 ☀️`); happyMoment(1200); }
  S.nextWanderAt = Date.now() + 3000;
  updateHUD(); save();
}

/* 摸猫 */
function petCat() {
  if (!S.name || Date.now() < busyUntil || S.sleeping) return;
  busyUntil = Date.now() + 900;
  S.happiness = clamp(S.happiness + 2, 0, 100);
  addBond(1);
  sfx.purr();
  spawnFx(pick(["♥", "♡"]), "heart", 2, 40);
  setMood("happy");
  setTimeout(() => { if (!S.sleeping) setMood("open"); }, 1100);
  updateHUD();
}

/* ---------------- 菜单面板 ---------------- */
function openPanel(html) {
  el.modalLayer.innerHTML = `<div class="panel">${html}</div>`;
  el.modalLayer.classList.add("show");
}
function closePanel() { el.modalLayer.classList.remove("show"); el.modalLayer.innerHTML = ""; }
window.closePanel = closePanel;

function menuFeed() {
  sfx.click();
  const rows = [
    { id: "kibble", ico: "🍚", name: "猫粮", eff: "饱食 +18", cost: 0 },
    { id: "can",    ico: "🥫", name: "鱼肉罐头", eff: "饱食 +35<br>心情 +6", cost: 10 },
    { id: "fish",   ico: "🍥", name: "小鱼干", eff: "饱食 +22<br>心情 +12", cost: 15 },
  ];
  openPanel(`
    <button class="x" onclick="closePanel()">✕</button>
    <h3>🍚 开饭啦</h3>
    <p class="hint">挑一个 ${S.name} 爱吃的</p>
    <div class="items">
      ${rows.map(r => `
        <button class="item ${S.coins < r.cost ? "poor" : ""}" onclick="feedAction('${r.id}')">
          <i>${r.ico}</i><b>${r.name}</b><small>${r.eff}</small>
          <em>${r.cost ? r.cost + " 金币" : "免费"}</em>
        </button>`).join("")}
    </div>
  `);
}
function menuPlay() {
  sfx.click();
  const rows = [
    { id: "wand", ico: "🪶", name: "逗猫棒", eff: "心情 +18<br>精力 -8", cost: 0 },
    { id: "yarn", ico: "🧶", name: "毛线球", eff: "心情 +15<br>精力 -6", cost: 0 },
  ];
  openPanel(`
    <button class="x" onclick="closePanel()">✕</button>
    <h3>🎣 一起玩</h3>
    <p class="hint">陪玩会消耗一点精力哦</p>
    <div class="items">
      ${rows.map(r => `
        <button class="item" style="grid-column: span 3 / span 3; flex-direction: row; gap: 12px; padding: 12px" onclick="playAction('${r.id}')">
          <i>${r.ico}</i><b>${r.name}</b><small>${r.eff.replace("<br>", " · ")}</small><em>免费</em>
        </button>`).join("")}
    </div>
  `);
}
window.feedAction = feedAction;
window.playAction = playAction;

function menuHelp() {
  sfx.click();
  openPanel(`
    <button class="x" onclick="closePanel()">✕</button>
    <h3>❔ 玩法说明</h3>
    <ul class="help-list">
      <li>🍚 <b>喂食 / 🎣 玩耍 / 🛁 清洁 / 🌙 睡觉</b>：照顾好四项状态，别让它们见底。</li>
      <li>💬 ${"猫"}会说出<b>愿望</b>（头顶气泡），2 分 30 秒内满足可获得<b>金币</b>和亲密度。</li>
      <li>👆 <b>点一点猫</b>可以摸摸头，涨心情还涨亲密度。</li>
      <li>🌟 亲密度提升 <b>Lv</b> 后会解锁新装饰，房间会越来越温馨。</li>
      <li>🌙 晚上（现实时间）窗外会变黑，让猫早点睡；<b>关掉页面猫也在家</b>，回来记得看看TA。</li>
      <li>💾 进度自动保存在本机浏览器中。</li>
    </ul>
    <div class="help-foot">
      <button class="ghostbtn" onclick="toggleSound()">${S.sound ? "🔔 音效：开" : "🔕 音效：关"}</button>
      <button class="ghostbtn danger" onclick="readopt()">🐾 重新领养</button>
    </div>
  `);
}
window.toggleSound = function () {
  S.sound = !S.sound;
  if (S.sound) sfx.click();
  toast(S.sound ? "音效已开启 🔔" : "音效已关闭 🔕", 1400);
  menuHelp();
  save();
};
window.readopt = function () {
  if (confirm("确定要重新领养吗？当前进度会全部清空。")) {
    S = defaultState();
    localStorage.removeItem(SAVE_KEY);
    location.reload();
  }
};

/* ---------------- 领养流程 ---------------- */
let adoptSel = "orange";
function showAdoption() {
  document.body.className = "dn-noon";
  const preview = f => {
    const svg = el.catSvg.cloneNode(true);
    svg.classList.add("mini-svg");
    svg.setAttribute("viewBox", "0 0 240 230");
    const wrap = document.createElement("div");
    wrap.className = "fur-" + f.id;
    svg.classList.remove("mood-happy", "mood-sleepy", "mood-closed");
    wrap.appendChild(svg);
    return wrap.outerHTML;
  };
  openPanel(`
    <div class="bigemoji">🐾</div>
    <h2>领养一只小猫</h2>
    <p class="hint">选一只喜欢的毛色，再给TA取个名字吧</p>
    <div class="adopt-list">
      ${FURS.map(f => `
        <button class="acat ${f.id === adoptSel ? "sel" : ""}" data-fur="${f.id}">
          ${preview(f)}<span>${f.label}</span>
        </button>`).join("")}
    </div>
    <div class="name-row">
      <input id="nameInput" maxlength="6" placeholder="猫咪的名字" value="${pick(NAMES)}">
      <button class="dice" id="diceBtn" title="随机名字">🎲</button>
    </div>
    <button class="go" id="adoptGo">开始一起生活 ❤</button>
  `);
  el.modalLayer.querySelectorAll(".acat").forEach(btn => {
    btn.addEventListener("click", () => {
      adoptSel = btn.dataset.fur;
      el.modalLayer.querySelectorAll(".acat").forEach(b => b.classList.remove("sel"));
      btn.classList.add("sel");
      sfx.meow();
    });
  });
  $("#diceBtn").addEventListener("click", () => { $("#nameInput").value = pick(NAMES); sfx.click(); });
  $("#adoptGo").addEventListener("click", () => {
    const name = ($("#nameInput").value || "").trim() || pick(NAMES);
    S.name = name.slice(0, 6);
    S.color = adoptSel;
    S.bornAt = Date.now();
    S.nextWishAt = Date.now() + 25000;
    S.nextChatAt = Date.now() + 8000;
    applyCatLook();
    currentSpot = "floorCenter";
    placeCat("floorCenter");
    closePanel();
    sfx.levelup();
    setPose("happy"); setMood("happy");
    spawnFx("♥", "heart", 5, 80);
    setTimeout(() => { setPose("sit"); setMood("open"); }, 2000);
    bubble(`<span class="big">💕</span>以后请多关照啦！我是 ${S.name}`, 4000);
    toast(`欢迎回家，${S.name}！`);
    save();
  });
}

/* ---------------- 离线结算 ---------------- */
function offlineReport() {
  const away = Math.floor((Date.now() - S.lastTick) / 1000);
  if (away < 90) return;
  const eff = Math.min(away, 8 * 3600);
  const sl = S.sleeping;
  S.hunger = clamp(S.hunger - RATE.hunger * eff, 0, 100);
  S.happiness = clamp(S.happiness - (sl ? RATE.happinessSleep : RATE.happiness) * eff, 0, 100);
  S.clean = clamp(S.clean - (sl ? RATE.cleanSleep : RATE.clean) * eff, 0, 100);
  S.energy = clamp(S.energy + (sl ? RATE.energySleep * eff : -RATE.energyAwake * Math.min(eff, 3600)), 0, 100);
  if (sl && S.energy >= 99.5) { S.sleeping = false; el.room.classList.remove("sleeping"); }
  S.wish = null;
  S.nextWishAt = Date.now() + rand(20, 50) * 1000;
  const hrs = Math.floor(eff / 3600), mins = Math.floor((eff % 3600) / 60);
  const dur = hrs ? `${hrs} 小时${mins ? " " + mins + " 分钟" : ""}` : `${mins} 分钟`;
  setTimeout(() => {
    openPanel(`
      <div class="bigemoji">🏠</div>
      <h2>你回来啦！</h2>
      <div class="center" style="margin-top:6px;font-size:12.5px;color:#a98c62;line-height:1.8">
        你离开了 <b style="color:#d98d2b">${dur}</b><br>
        ${S.name} 一直在想你哦 🐾<br>
        <span style="font-size:12px">🍚 饱食 ${Math.round(S.hunger)} · 💗 心情 ${Math.round(S.happiness)}<br>💤 精力 ${Math.round(S.energy)} · 🫧 清洁 ${Math.round(S.clean)}</span>
      </div>
      <button class="go" style="margin-top:12px" onclick="closePanel()">我来看看TA</button>
    `);
    sfx.meow();
  }, 700);
}

/* ---------------- 主循环 ---------------- */
let secCount = 0;
function tick() {
  const now = Date.now();
  if (!S.name) return;

  // 衰减
  S.hunger = clamp(S.hunger - RATE.hunger, 0, 100);
  S.happiness = clamp(S.happiness - (S.sleeping ? RATE.happinessSleep : RATE.happiness), 0, 100);
  S.clean = clamp(S.clean - (S.sleeping ? RATE.cleanSleep : RATE.clean), 0, 100);
  if (S.sleeping) {
    S.energy = clamp(S.energy + RATE.energySleep, 0, 100);
    if (S.energy >= 100) wakeUp(false);
  } else {
    S.energy = clamp(S.energy - RATE.energyAwake, 0, 100);
  }

  maybeSpawnWish(now);
  failWish(now);
  maybeChat(now);
  maybeWander(now);
  updateDayNight();
  updateHUD();

  // 愿望倒计时气泡刷新
  if (S.wish && Math.random() < 0.06) {
    const left = Math.ceil((S.wish.deadline - now) / 1000);
    const w = WISHES.find(x => x.id === S.wish.id);
    if (left > 0 && left < 150) bubble(`<span class="big">${w.icon}</span>${w.text}<span class="cd">⏳ 还剩 ${Math.floor(left / 60)}分${left % 60}秒</span>`, 2600);
  }

  secCount++;
  if (secCount % 10 === 0) save();
}

/* ---------------- 事件绑定 ---------------- */
function bindEvents() {
  $("#btnFeed").addEventListener("click", () => withBusy(menuFeed));
  $("#btnPlay").addEventListener("click", () => withBusy(menuPlay));
  $("#btnBath").addEventListener("click", () => withBusy(bathAction));
  $("#btnSleep").addEventListener("click", () => withBusy(sleepToggle));
  $("#btnSound").addEventListener("click", () => { S.sound = !S.sound; if (S.sound) sfx.click(); toast(S.sound ? "音效已开启 🔔" : "音效已关闭 🔕", 1400); save(); });
  $("#btnHelp").addEventListener("click", menuHelp);
  $("#dpad").addEventListener("click", () => { sfx.meow(); spawnFx("♪", "note", 2, 30); });
  el.cat.addEventListener("click", petCat);
  el.modalLayer.addEventListener("click", e => { if (e.target === el.modalLayer && S.name) closePanel(); });

  document.addEventListener("keydown", e => {
    if (!S.name || e.target.tagName === "INPUT") return;
    if (e.key === "1") withBusy(menuFeed);
    if (e.key === "2") withBusy(menuPlay);
    if (e.key === "3") withBusy(bathAction);
    if (e.key === "4") withBusy(sleepToggle);
  });

  window.addEventListener("beforeunload", save);
  document.addEventListener("visibilitychange", () => { if (document.hidden) save(); });
}

/* ---------------- 舞台缩放 ---------------- */
function fitStage() {
  const w = el.console.offsetWidth, h = el.console.offsetHeight;
  const s = Math.min(1, (window.innerWidth - 24) / w, (window.innerHeight - 24) / h);
  el.stage.style.transform = `scale(${s})`;
}
window.addEventListener("resize", fitStage);

/* ---------------- 启动 ---------------- */
function init() {
  const loaded = load();
  if (loaded && loaded.name) {
    S = loaded;
    S.wish = null;
    applyCatLook();
    applyDecor();
    updateDayNight();
    updateHUD();
    offlineReport();
    if (S.sleeping) { setPose("sleep"); setMood("closed"); el.room.classList.add("sleeping"); }
    else setPose("sit");
    // 恢复猫位置
    placeCat("floorCenter");
  } else {
    S = defaultState();
    applyCatLook();
    showAdoption();
  }
  bindEvents();
  updateDayNight();
  updateHUD();
  fitStage();
  setInterval(tick, 1000);
  setTimeout(fitStage, 60);
}
init();
