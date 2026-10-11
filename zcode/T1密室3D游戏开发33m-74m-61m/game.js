/* =====================================================================
 * 三重密室 · 3D Escape Room (Three.js r128)
 * ---------------------------------------------------------------------
 * 谜题依赖链（严格串行，不是平行谜题）：
 *   抽屉 ──获得──> 电池(A)
 *   电池(A) ──装入──> 手电筒(B)点亮
 *   点亮的手电筒(B) ──照明──> 才敢进黑暗的房间2
 *   房间2货架 ──拾取──> 红色玻璃片(C)
 *   B + C 组合 = 红光手电 ──照射──> 密码铁门(D)划痕显影 724
 *   输入 724 ──> 铁门(D)滑开 ──> 进入房间3
 *   房间3木箱 ──> 金钥匙 ──> 出口大门 ──> 通关
 * ===================================================================== */
(() => {
'use strict';

// ---------------- 小工具 ----------------
const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

const params = new URLSearchParams(location.search);
const NO_LOCK = params.has('nolock'); // ?nolock=1 兼容模式：不锁定指针，拖动转向、点击光标处

// ---------------- 音效（WebAudio 合成，无外部资源） ----------------
let actx = null;
function initAudio() { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } }
function tone(freq, dur, type, vol, delay) {
  if (!actx) return;
  const t0 = actx.currentTime + (delay || 0);
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type || 'square'; o.frequency.value = freq;
  g.gain.setValueAtTime(vol || 0.04, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(actx.destination);
  o.start(t0); o.stop(t0 + dur + 0.03);
}
const sfx = {
  click()  { tone(700, 0.06, 'square', 0.03); },
  pickup() { tone(620, 0.08, 'triangle', 0.05); tone(930, 0.10, 'triangle', 0.05, 0.08); },
  deny()   { tone(190, 0.16, 'sawtooth', 0.05); },
  error()  { tone(220, 0.12, 'square', 0.05); tone(160, 0.18, 'square', 0.05, 0.13); },
  reveal() { tone(1200, 0.07, 'sine', 0.05); tone(1200, 0.07, 'sine', 0.05, 0.12); tone(1500, 0.12, 'sine', 0.05, 0.24); },
  unlock() { tone(523, 0.09, 'triangle', 0.06); tone(659, 0.09, 'triangle', 0.06, 0.10); tone(784, 0.16, 'triangle', 0.06, 0.20); },
  door()   { tone(80, 0.5, 'sawtooth', 0.05); tone(60, 0.6, 'triangle', 0.05, 0.1); },
  room()   { tone(392, 0.10, 'sine', 0.04); tone(523, 0.14, 'sine', 0.04, 0.10); },
  win()    { [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.16, 'triangle', 0.06, i * 0.13)); },
};

// ---------------- 游戏状态（唯一事实来源） ----------------
const S = {
  started: false, won: false, modal: false,
  drawerOpened: false,
  hasBattery: false,      // A
  hasFlashlight: false, flashlightLit: false,   // B
  hasRedShard: false, hasRedLight: false,       // C / B+C
  codeKnown: false, doorOpen: false,            // D
  chestOpened: false, hasGoldenKey: false,      // 房3
  exitOpen: false,
  room: 1, t0: 0, interactCd: 0,
};

// ---------------- Three.js 场景 ----------------
const canvas = $('#game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04050a);
scene.fog = new THREE.Fog(0x04050a, 5, 24);

const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 60);
scene.add(camera);

// 玩家
const player = { x: 2.6, z: 1.6, yaw: Math.PI, pitch: 0 };
const PR = 0.32, EYE = 1.55, SPEED = 3.2, WALL_H = 3.2, T = 0.3;

// 灯光
scene.add(new THREE.AmbientLight(0x8090b0, 0.10));
function pointLight(color, i, dist, x, y, z) {
  const l = new THREE.PointLight(color, i, dist);
  l.position.set(x, y, z); scene.add(l); return l;
}
pointLight(0xffd9a0, 0.95, 13, 0, 2.7, 4);    // 房1 顶灯
pointLight(0xffd9a0, 0.55, 9, -3, 2.5, 7.5);  // 房1 书桌灯
pointLight(0x4455aa, 0.10, 7, 0, 2.6, 15);    // 房2 幽幽蓝光（几乎全黑）
const torchA = pointLight(0xff9a4a, 0.85, 9, -3.2, 2.4, 24);
const torchB = pointLight(0xff9a4a, 0.85, 9, 3.2, 2.4, 24);
const outside = pointLight(0xfff6e0, 1.2, 7, 0, 2.5, 32.5); // 门外之光

// 手电筒（挂在相机上）
const spot = new THREE.SpotLight(0xffe8c0, 0, 16, 0.48, 0.45, 1);
camera.add(spot);
spot.position.set(0.12, -0.12, 0);
const spotTarget = new THREE.Object3D();
spotTarget.position.set(0, -0.05, -1);
camera.add(spotTarget);
spot.target = spotTarget;
const camGlow = new THREE.PointLight(0xffe8c0, 0, 2.6);
camera.add(camGlow);

// ---------------- 材质 / 建造工具 ----------------
const mat = (c, r, m) => new THREE.MeshStandardMaterial({ color: c, roughness: r === undefined ? 0.9 : r, metalness: m || 0 });
const colliders = []; // {x,z,w,d,on}
const tweens = [];
function tween(dur, fn, done) { tweens.push({ t: 0, dur, fn, done }); }

function addCollider(x, z, w, d) { const c = { x, z, w, d, on: true }; colliders.push(c); return c; }

function box(w, h, d, m, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z); scene.add(mesh); return mesh;
}
function wall(x1, z1, x2, z2, m) {
  const w = Math.abs(x2 - x1) || T, d = Math.abs(z2 - z1) || T;
  const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
  const mesh = box(w, WALL_H, d, m, cx, WALL_H / 2, cz);
  addCollider(cx, cz, w, d);
  return mesh;
}
function floorPlane(z0, color) {
  const p = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), mat(color, 0.95));
  p.rotation.x = -Math.PI / 2; p.position.set(0, 0, z0 + 5); scene.add(p); return p;
}
function ceilPlane(z0, color) {
  const p = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), mat(color, 1));
  p.rotation.x = Math.PI / 2; p.position.set(0, WALL_H, z0 + 5); scene.add(p); return p;
}

// ---------------- 可交互物件登记 ----------------
const interactMeshes = [];
const OBJ_NAME = {
  drawer: '书桌抽屉', flashlight: '手电筒', shard: '红色玻璃片',
  pdoor: '密码铁门', chest: '木箱', exit: '出口大门', darkdoor: '黑暗的门洞',
};
const OBJ_DIST = { drawer: 2.5, flashlight: 2.5, shard: 2.5, pdoor: 3.4, chest: 2.8, exit: 3.4, darkdoor: 3.2 };
function reg(mesh, id) { mesh.userData.id = id; interactMeshes.push(mesh); return mesh; }

// ---------------- 搭建三个房间 ----------------
const wallMat = mat(0x6a6f7c), wallMat2 = mat(0x565d6e), wallMat3 = mat(0x6e5f52);
const woodMat = mat(0x7a5b3a), darkWood = mat(0x4a3826), metalMat = mat(0x8a93a5, 0.5, 0.6);
const goldMat = mat(0xd8a830, 0.35, 0.8);

// 地板 / 天花板
floorPlane(0, 0x8a7458); ceilPlane(0, 0x3a3630);
floorPlane(10, 0x4c5160); ceilPlane(10, 0x23262e);
floorPlane(20, 0x6b5a48); ceilPlane(20, 0x33291f);

// 墙
wall(-5.15, 0, 5.15, 0, wallMat);                       // 房1 南墙
wall(-5, -0.15, -5, 30.15, wallMat);                    // 西墙
wall(5, -0.15, 5, 30.15, wallMat);                      // 东墙
wall(-5.15, 10, -0.9, 10, wallMat); wall(0.9, 10, 5.15, 10, wallMat);   // 房1/2 隔墙（门洞宽1.8）
wall(-5.15, 20, -1.0, 20, wallMat2); wall(1.0, 20, 5.15, 20, wallMat2); // 房2/3 隔墙（门洞宽2）
wall(-5.15, 30, -0.8, 30, wallMat3); wall(0.8, 30, 5.15, 30, wallMat3); // 房3 北墙（出口宽1.6）

// 门洞外的“外面”
box(4, 0.1, 4, mat(0x9aa48f, 1), 0, -0.05, 32.5);
const glowPlane = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshBasicMaterial({ color: 0xfff3d0 }));
glowPlane.position.set(0, 1.6, 34.4); scene.add(glowPlane);
glowPlane.material.opacity = 0; glowPlane.material.transparent = true;

// ---- 房1：书房 ----
const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.8), mat(0x7a3f3f, 1));
rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.01, 5.5); scene.add(rug);
const paint = box(1.4, 1.0, 0.05, mat(0x35507a, 0.8), -1.8, 1.9, 0.2); paint.rotation.y = 0; // 装饰画（南墙）
const paintFrame = box(1.5, 1.1, 0.04, darkWood, -1.8, 1.9, 0.16);

// 书桌 + 抽屉（O1）
const desk = new THREE.Group(); scene.add(desk);
desk.position.set(-4.15, 0, 6.5);
const deskTop = box(0.85, 0.07, 1.7, woodMat, 0, 0, 0); deskTop.position.set(0, 0.78, 0); desk.add(deskTop);
[[-0.34, -0.78], [-0.34, 0.78], [0.34, -0.78], [0.34, 0.78]].forEach(([lx, lz]) => {
  const leg = box(0.08, 0.75, 0.08, darkWood, 0, 0, 0); leg.position.set(lx, 0.375, lz); desk.add(leg);
});
const deskBody = box(0.7, 0.5, 1.5, woodMat, 0, 0, 0); deskBody.position.set(-0.02, 0.5, 0); desk.add(deskBody);
const drawerMesh = box(0.06, 0.22, 1.1, darkWood, 0, 0, 0); drawerMesh.position.set(0.36, 0.56, 0); desk.add(drawerMesh);
const drawerKnob = box(0.03, 0.05, 0.05, goldMat, 0, 0, 0); drawerKnob.position.set(0.40, 0.56, 0); desk.add(drawerKnob);
addCollider(-4.15, 6.5, 0.95, 1.8);
[deskTop, deskBody, drawerMesh, drawerKnob].forEach(m => reg(m, 'drawer'));

// 边桌 + 手电筒（O2）
const sideTable = new THREE.Group(); scene.add(sideTable);
sideTable.position.set(3.5, 0, 3);
const stTop = box(0.72, 0.06, 0.72, woodMat, 0, 0, 0); stTop.position.set(0, 0.72, 0); sideTable.add(stTop);
const stLeg = box(0.1, 0.7, 0.1, darkWood, 0, 0, 0); stLeg.position.set(0, 0.35, 0); sideTable.add(stLeg);
addCollider(3.5, 3, 0.78, 0.78);
const flGroup = new THREE.Group(); flGroup.position.set(3.5, 0.82, 3); flGroup.rotation.z = Math.PI / 2; scene.add(flGroup);
const flBody = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.26, 12), mat(0x2f3540, 0.5, 0.4)); flGroup.add(flBody);
const flHead = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.05, 0.08, 12), mat(0x454f60, 0.4, 0.6)); flHead.position.y = 0.16; flGroup.add(flHead);
const flLens = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.015, 12), new THREE.MeshStandardMaterial({ color: 0xfff2cc, emissive: 0x000000, roughness: 0.3 }));
flLens.position.y = 0.205; flGroup.add(flLens);
[flBody, flHead, flLens].forEach(m => reg(m, 'flashlight'));

// ---- 房1→房2 的黑暗门洞 ----
const darkPlane = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 2.9),
  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 1, side: THREE.DoubleSide }));
darkPlane.position.set(0, 1.45, 10); scene.add(darkPlane); reg(darkPlane, 'darkdoor');

// ---- 房2：储藏室 ----
// 货架
const shelf = new THREE.Group(); scene.add(shelf); shelf.position.set(4.55, 0, 14);
[0.55, 1.15, 1.75].forEach((y) => { const b = box(0.55, 0.05, 2.2, metalMat, 0, 0, 0); b.position.set(0, y, 0); shelf.add(b); });
[[-1.05], [1.05]].forEach(([z]) => { const p = box(0.55, 1.8, 0.06, metalMat, 0, 0, 0); p.position.set(0, 0.9, z); shelf.add(p); });
addCollider(4.55, 14, 0.6, 2.3);
// 红色玻璃片（O3）
const shardMesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.09), new THREE.MeshStandardMaterial({
  color: 0xff2020, emissive: 0x5a0000, roughness: 0.25, metalness: 0.1 }));
shardMesh.position.set(4.45, 1.86, 14.3); scene.add(shardMesh); reg(shardMesh, 'shard');
// 杂物箱
box(0.8, 0.8, 0.8, woodMat, -4.2, 0.4, 12.2); addCollider(-4.2, 12.2, 0.9, 0.9);
box(0.6, 0.6, 0.6, darkWood, -3.3, 0.3, 17.8); addCollider(-3.3, 17.8, 0.7, 0.7);
box(0.7, 0.7, 0.7, woodMat, 3.9, 0.35, 18.3); addCollider(3.9, 18.3, 0.8, 0.8);

// 密码铁门（O4，房2→房3）
const doorGroup = new THREE.Group(); scene.add(doorGroup); doorGroup.position.set(0, 0, 20);
const pdSlab = box(2.0, 2.85, 0.14, mat(0x5a6478, 0.55, 0.55), 0, 0, 0); pdSlab.position.set(0, 1.425, 0); doorGroup.add(pdSlab);
const pdRivet = box(1.9, 0.08, 0.02, metalMat, 0, 0, 0); pdRivet.position.set(0, 2.7, -0.08); doorGroup.add(pdRivet);
const pdPlate = box(0.3, 0.4, 0.05, mat(0x1c222e, 0.6, 0.3), 0, 0, 0); pdPlate.position.set(0.72, 1.35, -0.1); doorGroup.add(pdPlate);
const pdDot = box(0.05, 0.05, 0.02, new THREE.MeshStandardMaterial({ color: 0x113311, emissive: 0x00aa33, roughness: 0.4 }), 0, 0, 0);
pdDot.position.set(0.72, 1.5, -0.13); doorGroup.add(pdDot);
const doorCollider = addCollider(0, 20, 2.1, 0.32);
// 划痕显影层（画布纹理，默认透明）
const codeCanvas = document.createElement('canvas');
codeCanvas.width = 512; codeCanvas.height = 256;
(function drawCode() {
  const c = codeCanvas.getContext('2d');
  c.clearRect(0, 0, 512, 256);
  c.font = 'bold 150px Consolas, monospace';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.shadowColor = '#ff2010'; c.shadowBlur = 28;
  c.fillStyle = '#ff3020';
  c.fillText('7 2 4', 256, 138);
  c.strokeText('7 2 4', 256, 138);
})();
const codeTex = new THREE.CanvasTexture(codeCanvas);
const codePlane = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.65),
  new THREE.MeshBasicMaterial({ map: codeTex, transparent: true, opacity: 0 }));
codePlane.position.set(-0.2, 1.55, -0.09); doorGroup.add(codePlane);
[pdSlab, pdPlate, pdDot].forEach(m => reg(m, 'pdoor'));

// ---- 房3：出口大厅 ----
// 木箱（O5）
const chestGroup = new THREE.Group(); scene.add(chestGroup); chestGroup.position.set(-2.5, 0, 26.5);
const chestBase = box(1.0, 0.55, 0.66, darkWood, 0, 0, 0); chestBase.position.set(0, 0.275, 0); chestGroup.add(chestBase);
const chestTrim = box(1.04, 0.07, 0.7, goldMat, 0, 0, 0); chestTrim.position.set(0, 0.52, 0); chestGroup.add(chestTrim);
const lidPivot = new THREE.Group(); lidPivot.position.set(0, 0.55, -0.33); chestGroup.add(lidPivot);
const chestLid = box(1.0, 0.1, 0.66, darkWood, 0, 0, 0); chestLid.position.set(0, 0.05, 0.33); lidPivot.add(chestLid);
const lidTrim = box(1.04, 0.03, 0.7, goldMat, 0, 0, 0); lidTrim.position.set(0, 0.1, 0.33); lidPivot.add(lidTrim);
addCollider(-2.5, 26.5, 1.15, 0.85);
[chestBase, chestTrim, chestLid, lidTrim].forEach(m => reg(m, 'chest'));

// 火把
[[-3.2, 24], [3.2, 24]].forEach(([x, z]) => {
  const stick = box(0.07, 0.5, 0.07, darkWood, x, 2.2, z);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.26, 8), new THREE.MeshBasicMaterial({ color: 0xffa530 }));
  flame.position.set(x, 2.55, z); scene.add(flame);
  flame.userData.flicker = true; scene.userData.flames = scene.userData.flames || []; scene.userData.flames.push(flame);
});

// 出口大门（O6）
const exitGroup = new THREE.Group(); scene.add(exitGroup); exitGroup.position.set(-0.8, 0, 30);
const exSlab = box(1.6, 2.85, 0.12, mat(0x5a4632, 0.8), 0, 0, 0); exSlab.position.set(0.8, 1.425, 0); exitGroup.add(exSlab);
const exLock = box(0.14, 0.18, 0.06, goldMat, 0, 0, 0); exLock.position.set(1.45, 1.1, -0.1); exitGroup.add(exLock);
const exShackle = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.016, 8, 16, Math.PI), goldMat);
exShackle.position.set(1.45, 1.19, -0.1); exitGroup.add(exShackle);
const exKeyhole = box(0.03, 0.07, 0.02, mat(0x201500, 0.5, 0.9), 0, 0, 0); exKeyhole.position.set(1.45, 1.1, -0.14); exitGroup.add(exKeyhole);
const exitCollider = addCollider(0, 30, 1.7, 0.3);
[exSlab, exLock, exShackle].forEach(m => reg(m, 'exit'));

// ---------------- HUD ----------------
const objText = $('#objText'), invText = $('#invText'), timerEl = $('#timer'),
      roomEl = $('#roomText'), promptEl = $('#prompt'), toastsEl = $('#toasts'),
      bannerEl = $('#banner'), redEl = $('#redlight');

function say(text, opt) {
  opt = opt || {};
  console.log('[FEEDBACK]', text);
  const d = document.createElement('div');
  d.className = 'toast' + (opt.important ? ' important' : '');
  d.textContent = text;
  toastsEl.appendChild(d);
  while (toastsEl.children.length > 3) toastsEl.removeChild(toastsEl.firstChild);
  setTimeout(() => d.classList.add('out'), opt.long ? 6000 : 3200);
  setTimeout(() => d.remove(), opt.long ? 6800 : 3900);
  refreshHUD();
}

function currentObjective() {
  if (S.won) return '你逃出去了，自由了！';
  if (!S.hasFlashlight && !S.hasBattery) return '在第一个房间里四处看看，找找能带走的东西。';
  if (!S.flashlightLit) return '手电筒需要一节电池才能亮——房间里找找抽屉之类的地方。';
  if (S.room === 1) return '举着手电筒，穿过北墙的门洞，进入黑暗的房间。';
  if (!S.hasRedShard) return '储藏室里一片漆黑，找找有用的东西——货架方向似乎有微弱的反光。';
  if (!S.hasRedLight) return '把红色玻璃片装到手电筒前端，组合成红光手电。';
  if (!S.codeKnown) return '用红光去照北墙的密码铁门，看看门板上的划痕藏着什么。';
  if (!S.doorOpen) return '在密码锁上输入三位密码 7 2 4。';
  if (!S.hasGoldenKey) return '在第三个房间里找找，能打开出口大门的钥匙在哪。';
  return '用金钥匙打开出口大门，逃出去！';
}
function refreshHUD() {
  const o = currentObjective();
  if (objText.textContent !== o) {
    objText.textContent = o;
    const p = $('#objective');
    p.classList.remove('flash'); void p.offsetWidth; p.classList.add('flash');
  }
  const items = [];
  if (S.hasBattery) items.push('🔋 电池');
  if (S.hasRedLight) items.push('🔦 红光手电');
  else if (S.hasFlashlight) items.push(S.flashlightLit ? '🔦 手电筒（已点亮）' : '🔦 手电筒（没电）');
  if (S.hasRedShard && !S.hasRedLight) items.push('🔻 红色玻璃片');
  if (S.hasGoldenKey) items.push('🗝 金钥匙');
  invText.textContent = items.length ? items.join('　') : '空空如也';
  roomEl.textContent = '第 ' + S.room + ' / 3 间';
}
function showBanner(text) {
  bannerEl.textContent = text;
  bannerEl.classList.add('show');
  setTimeout(() => bannerEl.classList.remove('show'), 2400);
}
function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

// ---------------- 状态推进 ----------------
function lightOn() {
  if (S.flashlightLit) return;
  S.flashlightLit = true;
  spot.intensity = 2.4; camGlow.intensity = 0.28;
  console.log('[STATE] flashlightLit=true');
  sfx.click();
  tween(0.8, (k) => { darkPlane.material.opacity = 1 - k; }, () => { darkPlane.visible = false; });
  if (S.hasRedShard && !S.hasRedLight) combineRed();
}
function combineRed() {
  S.hasRedLight = true;
  spot.color.set(0xff2418); spot.intensity = 2.9; camGlow.color.set(0xff3020);
  redEl.classList.add('on');
  console.log('[STATE] hasRedLight=true');
  sfx.reveal();
}
function logState() {
  console.log('[STATE]', JSON.stringify({
    battery: S.hasBattery, light: S.flashlightLit, shard: S.hasRedShard,
    red: S.hasRedLight, code: S.codeKnown, door: S.doorOpen,
    chest: S.chestOpened, key: S.hasGoldenKey, exit: S.exitOpen, room: S.room,
  }));
}

// ---------------- 交互核心 ----------------
const raycaster = new THREE.Raycaster();
const lastNDC = new THREE.Vector2(0, 0);

function pickAt(ndc) {
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(interactMeshes.filter(m => m.visible), false);
  if (!hits.length) return null;
  const h = hits[0];
  return { id: h.object.userData.id, dist: h.distance };
}
function interact(id) {
  if (!S.started || S.won || S.modal) return;
  if (performance.now() < S.interactCd) return;
  S.interactCd = performance.now() + 220;
  console.log('[ACTION] interact:', id);
  sfx.click();
  logState();

  switch (id) {
    case 'drawer': {
      if (S.drawerOpened) { say('抽屉已经空了，里面什么都没有。'); break; }
      S.drawerOpened = true;
      const dx0 = drawerMesh.position.x;
      tween(0.5, (k) => { drawerMesh.position.x = dx0 + 0.3 * k; drawerKnob.position.x = dx0 + 0.3 * k + 0.04; });
      S.hasBattery = true;
      sfx.pickup();
      say('抽屉「吱呀」一声滑开了——里面躺着一节旧电池！（电池已放入背包）');
      if (S.hasFlashlight && !S.flashlightLit) {
        lightOn();
        say('你顺手把电池装进手电筒——「咔哒」，一道光柱亮了！', { long: true });
      }
      break;
    }
    case 'flashlight': {
      if (S.hasFlashlight) break;
      S.hasFlashlight = true;
      flGroup.visible = false;
      console.log('[STATE] hasFlashlight=true');
      if (S.hasBattery) {
        lightOn();
        say('你捡起手电筒，拧开后盖装上电池——「咔哒」，亮了！');
      } else {
        sfx.deny();
        say('你捡起手电筒晃了晃——里面空空如也，一节电池也没有。');
      }
      break;
    }
    case 'darkdoor': {
      if (S.flashlightLit) { say('门洞里黑洞洞的，不过你现在有光源了，可以进去。'); break; }
      sfx.deny();
      say('门洞里是一片浓得化不开的黑。没有光源就往里走，只会一头撞墙。');
      break;
    }
    case 'shard': {
      if (S.hasRedShard) break;
      S.hasRedShard = true;
      shardMesh.visible = false;
      console.log('[STATE] hasRedShard=true');
      if (S.flashlightLit) {
        combineRed();
        say('一块边缘磨圆的红色玻璃片。你顺手把它卡在手电筒前端——光变成了深红色！红光之下，一些肉眼看不见的东西会显形。', { long: true, important: true });
      } else {
        sfx.pickup();
        say('一块边缘磨圆的红色玻璃片，你把它收进了口袋。');
      }
      break;
    }
    case 'pdoor': {
      if (S.doorOpen) { say('铁门已经滑开了，通道就在眼前。'); break; }
      if (!S.hasRedLight) {
        sfx.deny();
        say('厚重的铁门纹丝不动。门上装着三位数字密码锁，门板上有几道浅浅的划痕——普通的光线下，什么也看不清。', { long: true });
        break;
      }
      if (!S.codeKnown) {
        S.codeKnown = true;
        console.log('[STATE] codeKnown=true');
        sfx.reveal();
        tween(0.9, (k) => { codePlane.material.opacity = 0.95 * k; });
        say('红光扫过门板——划痕显出了三个发光的数字：7 · 2 · 4 ！', { long: true, important: true });
        setTimeout(() => { if (S.started && !S.won) openKeypad(); }, 1100);
        break;
      }
      openKeypad();
      break;
    }
    case 'chest': {
      if (S.chestOpened) { say('箱子里已经空空如也。'); break; }
      S.chestOpened = true;
      console.log('[STATE] chestOpened=true');
      tween(0.7, (k) => { lidPivot.rotation.x = -1.9 * k; });
      S.hasGoldenKey = true;
      sfx.pickup();
      say('箱盖「啪」地弹开——里面静静躺着一把黄铜钥匙，泛着温润的金光！（金钥匙已放入背包）', { long: true, important: true });
      break;
    }
    case 'exit': {
      if (S.exitOpen) { say('大门已经开着了，外面就是自由！'); break; }
      if (S.hasGoldenKey) {
        S.exitOpen = true;
        exitCollider.on = false;
        console.log('[STATE] exitOpen=true');
        tween(1.6, (k) => {
          exitGroup.rotation.y = -1.75 * k;
          glowPlane.material.opacity = k;
        });
        sfx.unlock(); sfx.win();
        say('金钥匙插进锁孔，旋转——「咔嚓！」黄铜挂锁弹开，大门缓缓打开，外面的光涌了进来……', { long: true, important: true });
        const elapsed = performance.now() - S.t0;
        setTimeout(() => {
          S.won = true;
          $('#winTime').textContent = '⏱ 用时 ' + fmtTime(elapsed);
          $('#winSteps').textContent = '解谜链：抽屉 → 电池 → 手电筒 →（照明进暗室）→ 红玻璃片 → 红光显影 724 → 密码铁门 → 金钥匙 → 出口大门';
          $('#win').classList.remove('hidden');
          if (document.pointerLockElement) document.exitPointerLock();
          console.log('[RESULT] WIN, time =', fmtTime(elapsed));
        }, 1800);
      } else {
        sfx.deny();
        say('厚重的木门被一把黄铜挂锁锁死了，锁孔泛着金色的光——需要一把金钥匙。', { long: true });
      }
      break;
    }
  }
  refreshHUD();
}

function tryInteractAt(ndc) {
  const hit = pickAt(ndc);
  if (!hit) return;
  const maxD = OBJ_DIST[hit.id] || 2.5;
  if (hit.dist > maxD) {
    say('太远了，走近一点再操作「' + (OBJ_NAME[hit.id] || hit.id) + '」。');
    return;
  }
  interact(hit.id);
}

// ---------------- 密码锁 UI ----------------
const keypadEl = $('#keypad'), kpDisplay = $('#kpDisplay'), padBox = $('#padBox');
let kpEntry = '';
function kpRender() { kpDisplay.textContent = (kpEntry.padEnd(3, '—')).split('').join(' '); }
function openKeypad() {
  if (S.modal) return;
  S.modal = true; kpEntry = ''; kpRender();
  keypadEl.classList.remove('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
  console.log('[STATE] keypad open');
  say('三位数字密码锁亮着微光。输入密码（也可直接敲键盘数字）。');
}
function closeKeypad() {
  S.modal = false;
  keypadEl.classList.add('hidden');
  if (!NO_LOCK && S.started && !S.won) say('点击画面重新锁定视角继续探索。');
}
function kpPress(k) {
  if (k === 'C') { kpEntry = ''; kpRender(); sfx.click(); return; }
  if (k === 'OK') {
    if (kpEntry.length < 3) { say('密码是三位数字，还没输完。'); sfx.deny(); return; }
    if (kpEntry === '724') {
      closeKeypad();
      S.doorOpen = true; doorCollider.on = false;
      console.log('[STATE] doorOpen=true');
      const x0 = doorGroup.position.x;
      tween(1.4, (t) => { doorGroup.position.x = x0 + 2.05 * ease(t); });
      sfx.unlock(); sfx.door();
      say('「咔哒——轰隆」锁体震动，铁门缓缓向侧面滑开，第三个房间的通道出现了！', { long: true, important: true });
    } else {
      sfx.error();
      padBox.classList.remove('shake'); void padBox.offsetWidth; padBox.classList.add('shake');
      say('「哔——哔」密码锁上的红灯闪了两下：密码错误。');
      kpEntry = ''; kpRender();
    }
    return;
  }
  if (kpEntry.length < 3) { kpEntry += k; kpRender(); sfx.click(); }
}
keypadEl.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-k]');
  if (b) kpPress(b.dataset.k);
});
$('#kpClose').addEventListener('click', closeKeypad);

// ---------------- 输入 ----------------
const keys = {};
addEventListener('keydown', (e) => {
  if (S.modal) {
    if (/^[0-9]$/.test(e.key)) { kpPress(e.key); e.preventDefault(); }
    else if (e.key === 'Enter') { kpPress('OK'); e.preventDefault(); }
    else if (e.key === 'Backspace') { kpPress('C'); e.preventDefault(); }
    else if (e.key === 'Escape') closeKeypad();
    return;
  }
  keys[e.code] = true;
  if (e.code === 'KeyE') {
    const ndc = locked() ? new THREE.Vector2(0, 0) : lastNDC.clone();
    tryInteractAt(ndc);
  }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });

function locked() { return !!document.pointerLockElement; }

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// 指针锁定模式：点击画面上锁
if (!NO_LOCK) {
  canvas.addEventListener('mousedown', () => {
    if (S.started && !S.won && !S.modal && !locked()) canvas.requestPointerLock();
  });
}
// 鼠标移动：锁定模式转视角；兼容模式记录光标位置
let dragging = false, dragMoved = 0, lastMX = 0, lastMY = 0;
addEventListener('mousemove', (e) => {
  if (!S.started || S.won || S.modal) return;
  if (locked()) {
    player.yaw -= e.movementX * 0.0024;
    player.pitch = clamp(player.pitch - e.movementY * 0.0024, -1.35, 1.35);
  } else {
    lastNDC.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    if (dragging) {
      const dx = e.clientX - lastMX, dy = e.clientY - lastMY;
      dragMoved += Math.abs(dx) + Math.abs(dy);
      player.yaw -= dx * 0.0042;
      player.pitch = clamp(player.pitch - dy * 0.0042, -1.35, 1.35);
      lastMX = e.clientX; lastMY = e.clientY;
    }
  }
});
canvas.addEventListener('mousedown', (e) => {
  if (!NO_LOCK) {
    if (locked() && S.started && !S.won && !S.modal) tryInteractAt(new THREE.Vector2(0, 0));
    return;
  }
  dragging = true; dragMoved = 0; lastMX = e.clientX; lastMY = e.clientY;
});
addEventListener('mouseup', (e) => {
  if (!NO_LOCK || !dragging) return;
  dragging = false;
  if (dragMoved < 7 && S.started && !S.won && !S.modal) tryInteractAt(lastNDC.clone());
});

// ---------------- 碰撞与移动 ----------------
function collide(px, pz) {
  for (let iter = 0; iter < 2; iter++) {
    for (const c of colliders) {
      if (!c.on) continue;
      const minX = c.x - c.w / 2 - PR, maxX = c.x + c.w / 2 + PR;
      const minZ = c.z - c.d / 2 - PR, maxZ = c.z + c.d / 2 + PR;
      if (px > minX && px < maxX && pz > minZ && pz < maxZ) {
        const dl = px - minX, dr = maxX - px, dn = pz - minZ, df = maxZ - pz;
        const m = Math.min(dl, dr, dn, df);
        if (m === dl) px = minX; else if (m === dr) px = maxX;
        else if (m === dn) pz = minZ; else pz = maxZ;
      }
    }
  }
  return [px, pz];
}

let darkWarnAt = -9999;
function update(dt) {
  // 转向（键盘）
  if (keys['ArrowLeft']) player.yaw += 2.4 * dt;
  if (keys['ArrowRight']) player.yaw -= 2.4 * dt;
  // 移动
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  const rx = -fz, rz = fx;
  let mx = 0, mz = 0;
  if (keys['KeyW'] || keys['ArrowUp']) { mx += fx; mz += fz; }
  if (keys['KeyS'] || keys['ArrowDown']) { mx -= fx; mz -= fz; }
  if (keys['KeyD']) { mx += rx; mz += rz; }
  if (keys['KeyA']) { mx -= rx; mz -= rz; }
  const len = Math.hypot(mx, mz);
  if (len > 0 && !S.modal && !S.won) {
    let nx = player.x + (mx / len) * SPEED * dt;
    let nz = player.z + (mz / len) * SPEED * dt;
    // 黑暗门洞：没有光源不许进房2
    if (!S.flashlightLit && nz > 10.35) {
      nz = 10.35;
      if (performance.now() - darkWarnAt > 3000) {
        darkWarnAt = performance.now();
        sfx.deny();
        say('你朝黑暗里迈了半步——里面深不见底，什么也看不见。先退回来，找个光源吧。', { long: true });
      }
    }
    [player.x, player.z] = collide(nx, nz);
  }
  camera.position.set(player.x, EYE, player.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;

  // 房间切换（阈值与黑暗门洞的阻拦线 10.35 对齐，避免被推回时误报进入房间2）
  const room = player.z < 10.4 ? 1 : player.z < 20.4 ? 2 : 3;
  if (room !== S.room) {
    S.room = room;
    console.log('[STATE] enter room', room);
    sfx.room();
    showBanner(room === 2 ? '第二间房 · 储藏室' : '第三间房 · 出口大厅');
    if (room === 2) say('这里没有灯。手电筒的光柱扫过货架和杂物箱……');
    if (room === 3) say('最后一间房。出口应该就在北墙——但看起来还锁着。');
    refreshHUD();
  }

  // 悬停提示
  if (S.started && !S.won && !S.modal) {
    const ndc = locked() ? new THREE.Vector2(0, 0) : lastNDC;
    const hit = pickAt(ndc);
    if (hit && hit.dist <= (OBJ_DIST[hit.id] || 2.5)) {
      promptEl.style.display = 'block';
      promptEl.innerHTML = '<b>' + (OBJ_NAME[hit.id] || hit.id) + '</b> —— 点击 / E 互动';
    } else if (hit) {
      promptEl.style.display = 'block';
      promptEl.innerHTML = '<b>' + (OBJ_NAME[hit.id] || hit.id) + '</b> —— 太远了，走近一点';
    } else {
      promptEl.style.display = 'none';
    }
  } else {
    promptEl.style.display = 'none';
  }

  // 计时
  if (S.started && !S.won) {
    const el = performance.now() - S.t0;
    timerEl.textContent = '⏱ ' + fmtTime(el);
    timerEl.classList.toggle('slow', el > 5 * 60 * 1000);
  }

  // 动画
  for (let i = tweens.length - 1; i >= 0; i--) {
    const t = tweens[i];
    t.t += dt;
    const k = Math.min(1, t.t / t.dur);
    t.fn(ease(k));
    if (k >= 1) { tweens.splice(i, 1); if (t.done) t.done(); }
  }
  // 玻璃片旋转 + 火苗抖动
  shardMesh.rotation.y += dt * 1.5;
  (scene.userData.flames || []).forEach((f, i) => {
    f.scale.y = 1 + Math.sin(performance.now() / 90 + i * 2) * 0.18;
    f.scale.x = f.scale.z = 1 + Math.cos(performance.now() / 70 + i) * 0.1;
  });
}

// ---------------- 主循环 ----------------
let prev = performance.now(), lastRaf = performance.now(), lastTick = performance.now(), frames = 0;
function frame(nowMs) {
  const dt = Math.min(0.05, (nowMs - prev) / 1000);
  prev = nowMs;
  update(dt);
  renderer.render(scene, camera);
  frames++;
}
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  lastRaf = now;
  if (now - lastTick >= 15) { lastTick = now; frame(now); }
}
loop();
// 兼容性保底：某些内嵌浏览器 / 被遮挡的后台页面里 rAF 不触发、定时器被节流到 ~1Hz，
// 游戏会完全停摆。此时改用不受节流的 MessageChannel 驱动同一帧函数。
// 正常桌面浏览器中 rAF 一直健康，此保底逻辑永远不会启动，游戏行为不变。
let pumpOn = false;
setInterval(() => {
  if (pumpOn || performance.now() - lastRaf < 500) return;
  pumpOn = true;
  const ch = new MessageChannel();
  ch.port1.onmessage = () => {
    // lastTick 由 rAF 与保底循环共用：rAF 健康时保底循环只空转不重复驱动
    const now = performance.now();
    if (now - lastTick >= 15) {
      lastTick = now;
      // 软渲染环境下每帧可能耗时数百毫秒，这里放宽 dt 上限，保证降级环境下游戏时间仍接近真实时间
      const dt = Math.min((now - prev) / 1000, 0.2);
      prev = now;
      update(dt);
      renderer.render(scene, camera);
      frames++;
    }
    ch.port2.postMessage(0);
  };
  ch.port2.postMessage(0);
}, 250);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------- 开始 ----------------
$('#btnStart').addEventListener('click', () => {
  initAudio();
  $('#intro').classList.add('hidden');
  S.started = true;
  S.t0 = performance.now();
  console.log('[STATE] game start');
  showBanner('第一间房 · 书房');
  say('你从冰冷的地板上醒来。房间尽头有一扇门，门后是一片深不见底的黑。');
  say('（提示：点击或按 E 与眼前物件互动；左上角是当前目标。）', { long: true });
  if (!NO_LOCK) canvas.requestPointerLock();
  refreshHUD();
});

// ---------------- 调试接口（自动化测试用，不影响正常游玩） ----------------
const _v = new THREE.Vector3();
window.GAME = {
  state: S,
  player,
  frames: () => frames,
  pos() { return { x: player.x, z: player.z }; },
  distTo(id) {
    const m = interactMeshes.find((mm) => mm.userData.id === id && mm.visible);
    if (!m) return -1;
    m.getWorldPosition(_v);
    return Math.hypot(_v.x - player.x, _v.z - player.z);
  },
  angleTo(id) {
    const m = interactMeshes.find((mm) => mm.userData.id === id && mm.visible);
    if (!m) return 0;
    m.getWorldPosition(_v);
    const want = Math.atan2(-(_v.x - player.x), -(_v.z - player.z));
    let d = want - player.yaw;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d; // 玩家需要旋转的角度（正=向左转）
  },
  project(id) {
    const m = interactMeshes.find((mm) => mm.userData.id === id && mm.visible);
    if (!m) return null;
    m.getWorldPosition(_v);
    _v.project(camera);
    if (_v.z > 1) return null;
    return { x: (_v.x * 0.5 + 0.5) * innerWidth, y: (-_v.y * 0.5 + 0.5) * innerHeight };
  },
  turnTo(id) { // 一次性把朝向对准物件（等价于玩家转动鼠标）
    player.yaw += window.GAME.angleTo(id);
    player.pitch = 0;
  },
  lastFeedback: () => {
    const list = toastsEl.querySelectorAll('.toast');
    return list.length ? list[list.length - 1].textContent : '';
  },
  time: () => (S.started ? fmtTime(performance.now() - S.t0) : '00:00'),
};

})();
