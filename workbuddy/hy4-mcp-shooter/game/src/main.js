/**
 * main.js — 游戏主循环与编排层
 *
 * 三个关键职责：
 *   1. 渲染与玩法（射击、波次、敌人）
 *   2. 订阅 Scene Manifest 的变化并热重建场景
 *   3. 响应 MCP Server 的下行请求（截图 / 自动试玩 / 遥测）
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { defaultLevel, sanitizeLevel, ENEMY_TYPES } from './level.js';
import { buildLevel, disposeGroup, sunDirection } from './scene-builder.js';
import { Player } from './player.js';
import { Enemy, ProjectileSystem } from './enemy.js';
import { Bridge } from './bridge.js';
import { Hud } from './hud.js';

/* ================================================================== *
 *  渲染基础
 * ================================================================== */

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: true, // 让 toDataURL 截图可用
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(76, innerWidth / innerHeight, 0.1, 1200);
scene.add(camera);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
// threshold 1.0：只有明确超过 1.0 的高光（灯泡本体、枪口火焰、天线指示灯）才泛光。
// 阈值定低了整个画面会糊上层雾，暗部失去层次 —— 这是最常见的 bloom 滥用。
// radius 收紧到 0.4，让光晕更"结实"，而不是虚化成一大团。
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.6, 0.4, 1.0);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* ================================================================== *
 *  状态
 * ================================================================== */

let level = defaultLevel();
let levelGroup = null;
let colliders = [];
let slopes = [];
let enemies = [];
let player = new Player(camera, renderer.domElement);
const projectiles = new ProjectileSystem(scene);
const hud = new Hud();

let score = 0;
let wave = 1;
let waveTimer = 0;
let waveActive = false;
let running = false;
let lastTime = performance.now();
let fpsAcc = 0, fpsFrames = 0, fpsValue = 0;

/* ================================================================== *
 *  视觉特效（曳光弹 / 弹着点 / 枪口火焰）
 * ================================================================== */

class Effects {
  constructor(scene) {
    this.scene = scene;
    this.tracers = [];
    this.impacts = [];
    this.tracerGeo = new THREE.CylinderGeometry(0.028, 0.028, 1, 5, 1, true);
    this.tracerGeo.translate(0, 0.5, 0);   // 让几何体沿 +Z 从 0 延伸到 1
    this.tracerGeo.rotateX(Math.PI / 2);   // +Z 为长度方向，配合 lookAt 指向目标
    this.impactGeo = new THREE.SphereGeometry(0.16, 8, 6);
  }

  tracer(from, to) {
    const m = new THREE.Mesh(this.tracerGeo, new THREE.MeshBasicMaterial({
      color: 0xffd27a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    const d = from.distanceTo(to);
    m.position.copy(from);
    m.lookAt(to);
    m.scale.set(1, 1, d);
    this.scene.add(m);
    this.tracers.push({ mesh: m, life: 0.075 });
  }

  impact(point, normalish) {
    const m = new THREE.Mesh(this.impactGeo, new THREE.MeshBasicMaterial({
      color: 0xffb347, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    m.position.copy(point);
    if (normalish) m.position.addScaledVector(normalish, 0.03);
    this.scene.add(m);
    this.impacts.push({ mesh: m, life: 0.34, max: 0.34 });
  }

  update(dt) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      t.mesh.material.opacity = Math.max(0, t.life / 0.075) * 0.95;
      if (t.life <= 0) { this.scene.remove(t.mesh); t.mesh.material.dispose(); this.tracers.splice(i, 1); }
    }
    for (let i = this.impacts.length - 1; i >= 0; i--) {
      const p = this.impacts[i];
      p.life -= dt;
      const k = Math.max(0, p.life / p.max);
      p.mesh.scale.setScalar(0.6 + (1 - k) * 2.4);
      p.mesh.material.opacity = k * 0.9;
      if (p.life <= 0) { this.scene.remove(p.mesh); p.mesh.material.dispose(); this.impacts.splice(i, 1); }
    }
  }
}
const fx = new Effects(scene);

/* ================================================================== *
 *  武器视图模型
 * ================================================================== */

function buildWeapon() {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x2c313c, roughness: 0.42, metalness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14171d, roughness: 0.6, metalness: 0.5 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xff8a3c, emissive: 0xff6a1e, emissiveIntensity: 2.2, roughness: 0.3 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.11, 0.52), metal);
  body.position.set(0.19, -0.16, -0.42);
  g.add(body);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.34, 10), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0.19, -0.15, -0.79);
  g.add(barrel);

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.2, 0.1), dark);
  grip.position.set(0.19, -0.29, -0.28);
  grip.rotation.x = -0.24;
  g.add(grip);

  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.16, 0.09), dark);
  mag.position.set(0.19, -0.28, -0.44);
  mag.rotation.x = 0.12;
  g.add(mag);

  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.1), accent);
  sight.position.set(0.19, -0.085, -0.5);
  g.add(sight);

  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffd08a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  flash.position.set(0.19, -0.15, -0.98);
  g.add(flash);

  const light = new THREE.PointLight(0xffa040, 0, 6, 2);
  light.position.copy(flash.position);
  g.add(light);

  g.renderOrder = 999;
  return { group: g, flash, light };
}

const weapon = buildWeapon();
weapon.group.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
camera.add(weapon.group);
let recoil = 0;

/* ================================================================== *
 *  关卡应用与热重建
 * ================================================================== */

function applyLevel(next, { resetPlayer = false, logKind = 'prop' } = {}) {
  level = next;

  if (levelGroup) {
    scene.remove(levelGroup);
    disposeGroup(levelGroup);
  }
  const built = buildLevel(level);
  levelGroup = built.group;
  colliders = built.colliders;
  slopes = built.slopes;
  scene.add(levelGroup);

  // 环境
  renderer.toneMappingExposure = level.environment.exposure;
  bloom.strength = level.environment.bloom;
  scene.fog = new THREE.FogExp2(new THREE.Color(level.environment.fogColor), level.environment.fogDensity);

  // 玩法
  player.applyGameplay(level.gameplay);

  // 敌人
  for (const e of enemies) e.dispose(scene);
  enemies = [];
  projectiles.clear();
  spawnManifestEnemies();

  if (resetPlayer || !waveActive) player.respawn(level.playerStart, level.playerYaw);

  hud.setStatus(wave, enemies.length, level.meta.revision, score);
  return built;
}

function spawnManifestEnemies() {
  const t = level.gameplay.enemies;
  for (const s of level.spawns) {
    const e = new Enemy(s, t);
    e._hsMul = level.gameplay.player.headshotMultiplier;
    scene.add(e.mesh);
    enemies.push(e);
  }
}

/** 新增波次：在竞技场边缘随机生成，数量与血量按配置递增 */
function spawnWave(n) {
  const g = level.gameplay;
  const count = g.waves.perWaveBase + g.waves.perWaveGrowth * (n - 1);
  const half = level.environment.arenaSize / 2 - 6;
  const types = Object.keys(ENEMY_TYPES);

  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = half * (0.55 + Math.random() * 0.45);
    const type = n === 1 ? 'grunt' : types[Math.min(types.length - 1, Math.floor(Math.random() * (1 + Math.min(n, 3))))];
    const e = new Enemy(
      { id: `w${n}_${i}`, type, position: [Math.cos(a) * r, 0, Math.sin(a) * r], patrol: null },
      g.enemies,
    );
    e._hsMul = g.player.headshotMultiplier;
    e.maxHealth *= Math.pow(g.waves.healthScalePerWave, n - 1);
    e.health = e.maxHealth;
    scene.add(e.mesh);
    enemies.push(e);
  }
  hud.toast(`第 ${n} 波 · ${count} 名敌人`, 'gold');
}

/* ================================================================== *
 *  射击
 * ================================================================== */

const _ray = new THREE.Ray();
const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _hitPoint = new THREE.Vector3();

function fire() {
  if (!player.canFire()) {
    if (player.ammo <= 0 && !player.reloading) player.startReload();
    return;
  }
  player.consumeShot();

  camera.getWorldPosition(_origin);
  player.aimDirection(_dir);
  _ray.set(_origin, _dir);

  const gp = level.gameplay.player;

  // 1) 敌人
  let best = null;
  for (const e of enemies) {
    if (!e.alive) continue;
    const hit = e.raycast(_origin, _dir);
    if (hit && (!best || hit.distance < best.distance)) best = { enemy: e, ...hit };
  }

  // 2) 场景几何（取最近阻挡）
  let wallT = Infinity;
  for (const b of colliders) {
    const p = _ray.intersectBox(b, _hitPoint);
    if (p) {
      const d = _origin.distanceTo(p);
      if (d < wallT && d > 0.6) wallT = d;
    }
  }

  const muzzle = weapon.group.localToWorld(new THREE.Vector3(0.19, -0.15, -0.95));

  if (best && best.distance < wallT && best.distance < gp.range) {
    const dealt = best.enemy.takeDamage(gp.damage, best.headshot);
    player.stats.damageDealt += dealt;
    player.stats.shotsHit += 1;
    if (best.headshot) player.stats.headshots += 1;
    hud.hitMarker();
    fx.tracer(muzzle, best.point);
    fx.impact(best.point, _dir.clone().negate());
    if (!best.enemy.alive) onEnemyKilled(best.enemy);
  } else if (wallT < Infinity && wallT < gp.range) {
    _hitPoint.copy(_origin).addScaledVector(_dir, wallT);
    fx.tracer(muzzle, _hitPoint);
    fx.impact(_hitPoint, _dir.clone().negate());
  } else {
    const far = _origin.clone().addScaledVector(_dir, Math.min(gp.range, 300));
    fx.tracer(muzzle, far);
  }

  // 表现：后坐 + 枪口焰
  recoil = 1;
  weapon.flash.material.opacity = 1;
  weapon.flash.scale.setScalar(0.8 + Math.random() * 0.7);
  weapon.light.intensity = 9;
}

function onEnemyKilled(e) {
  score += e.scoreValue;
  player.stats.kills += 1;
  hud.toast(`击杀 ${e.label} +${e.scoreValue}`);
  const idx = enemies.indexOf(e);
  if (idx >= 0) {
    e.dispose(scene);
    enemies.splice(idx, 1);
  }
}

/* ================================================================== *
 *  输入绑定
 * ================================================================== */

let mouseDown = false;
renderer.domElement.addEventListener('mousedown', (e) => { if (e.button === 0) mouseDown = true; });
window.addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; });
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR') player.startReload();
  if (e.code === 'Escape') hud.toast('已释放鼠标 · 点击画面继续');
});
renderer.domElement.addEventListener('click', () => { if (running) player.requestLock(); });

/**
 * 进入"运行态"。只有运行态下才推进物理与 AI —— 对应 UE 的 Play-In-Editor。
 * lock=false 用于无人值守场景（Agent 自动化、无头浏览器），这些环境拿不到指针锁定授权。
 */
function startRun({ lock = true } = {}) {
  hud.hideStart();
  hud.hideDead();
  running = true;
  if (lock) player.requestLock();
  return running;
}
function stopRun() {
  running = false;
  if (document.pointerLockElement) document.exitPointerLock();
  player.keys.clear();
  mouseDown = false;
  return running;
}

document.getElementById('startBtn').addEventListener('click', () => startRun({ lock: true }));
document.getElementById('retryBtn').addEventListener('click', () => {
  hud.hideDead();
  score = 0; wave = 1; waveActive = false; waveTimer = 0;
  player.respawn(level.playerStart, level.playerYaw);
  for (const e of enemies) e.dispose(scene);
  enemies = [];
  projectiles.clear();
  spawnWave(1);
  waveActive = true;
  running = true;
  player.requestLock();
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  bloom.setSize(innerWidth, innerHeight);
});

/* ================================================================== *
 *  MCP 桥
 * ================================================================== */

const bridge = new Bridge(`ws://${location.hostname || '127.0.0.1'}:8787`);

bridge.on('status', ({ connected, offline, reason }) => {
  hud.setConnected(connected);
  if (offline) {
    // 部署到静态托管时的正常状态：不是错误，只是没有本机引擎桥
    hud.toast(reason || '单机模式 · 使用内置关卡', 'warn');
    return;
  }
  hud.toast(connected ? 'MCP Server 已连接 · AI 可实时编辑关卡' : 'MCP Server 未连接 · 使用内置关卡', connected ? 'gold' : 'warn');
});

bridge.on('level:full', ({ level: raw, tool, detail }) => {
  const next = sanitizeLevel(raw);
  applyLevel(next, { resetPlayer: false });
  hud.setStatus(wave, enemies.length, next.meta.revision, score);
  if (tool) hud.log(tool, detail, tool.startsWith('set_env') || tool.startsWith('build') ? 'env' : 'prop');
});

// 只有 environment 变了就走轻量路径：不重建道具，只改光照/雾/色调
bridge.on('level:env', ({ level: raw, tool, detail }) => {
  level = sanitizeLevel(raw);
  const env = level.environment;
  renderer.toneMappingExposure = env.exposure;
  bloom.strength = env.bloom;
  scene.fog = new THREE.FogExp2(new THREE.Color(env.fogColor), env.fogDensity);
  if (levelGroup) {
    scene.remove(levelGroup);
    disposeGroup(levelGroup);
    const built = buildLevel(level);
    levelGroup = built.group;
    colliders = built.colliders;
    slopes = built.slopes;
    scene.add(levelGroup);
  }
  hud.setStatus(wave, enemies.length, level.meta.revision, score);
  if (tool) hud.log(tool, detail, 'env');
});

bridge.on('level:gameplay', ({ level: raw, tool, detail }) => {
  level = sanitizeLevel(raw);
  player.applyGameplay(level.gameplay);
  for (const e of enemies) e._hsMul = level.gameplay.player.headshotMultiplier;
  hud.setStatus(wave, enemies.length, level.meta.revision, score);
  if (tool) hud.log(tool, detail, 'gp');
});

bridge.on('level:actors', ({ level: raw, tool, detail }) => {
  // 只有道具/敌人变了：重建场景图但不打断玩家状态
  const keepHp = player.health;
  const next = sanitizeLevel(raw);
  applyLevel(next, { resetPlayer: false });
  player.health = Math.min(keepHp, player.maxHealth);
  if (tool) hud.log(tool, detail, tool.includes('enemy') ? 'enemy' : 'prop');
});

// --- 下行请求：截图 ---
// 任何异常都必须回报，否则 Agent 侧只能看到"超时"，无从判断是渲染坏了还是没连上。
bridge.on('capture', (payload, id) => {
  try {
    composer.render();
    const quality = typeof payload?.quality === 'number' ? payload.quality : 0.72;
    const dataUrl = renderer.domElement.toDataURL('image/jpeg', quality);
    bridge.send('capture:result', {
      id, image: dataUrl, ok: true,
      width: renderer.domElement.width, height: renderer.domElement.height,
    });
  } catch (err) {
    console.error('[capture] 渲染失败', err);
    bridge.send('capture:result', { id, ok: false, error: String(err && err.message || err) });
  }
});

// --- 下行请求：启动 / 暂停模拟 ---
// 对应 UE5 MCP 的 start_play_in_editor / stop_play_in_editor。
// 没有这一步，Agent 就只能"编辑静态场景"，无法验证玩法是否真的跑得起来。
bridge.on('sim:start', (_p, id) => {
  startRun({ lock: false });
  hud.toast('AI 已启动模拟', 'gold');
  hud.log('start_simulation', `波次${wave} · 敌人${enemies.length}`, 'gp');
  bridge.send('sim:result', { id, ok: true, running, wave, enemies: enemies.length });
});
bridge.on('sim:stop', (_p, id) => {
  stopRun();
  hud.toast('AI 已暂停模拟', 'warn');
  hud.log('stop_simulation', '已暂停', 'gp');
  bridge.send('sim:result', { id, ok: true, running });
});

// --- 下行请求：设定机位（Agent 取景审美术 / 出宣传图）---
bridge.on('viewpoint', (payload, id) => {
  if (playtest) {
    bridge.send('viewpoint:result', { id, ok: false, reason: '试玩机器人正在接管，请先等它跑完' });
    return;
  }
  const next = player.setViewpoint(payload || {});
  hud.toast(next.spectate ? 'AI 已接管视角（自由机位）' : 'AI 已设定机位', 'gold');
  hud.log('set_viewpoint', `[${next.position.map((v) => v.toFixed(0)).join(',')}] fov${Math.round(next.fov)}`, 'env');
  bridge.send('viewpoint:result', { id, ok: true, ...next });
});

// --- 下行请求：自动试玩 ---
let playtest = null;
bridge.on('playtest', ({ seconds = 8 }, id) => {
  const before = { ...player.stats };
  playtest = {
    id, seconds,
    start: performance.now(),
    before,
    startHp: player.health,
    frames: 0, acc: 0,
  };
  hud.toast(`AI 正在自动试玩 ${seconds}s…`, 'gold');
  hud.log('run_playtest', `机器人接管 ${seconds}s`, 'gp');
});

function finishPlaytest() {
  if (!playtest) return;
  const p = playtest;
  playtest = null;
  const s = player.stats;
  const shots = s.shotsFired - p.before.shotsFired;
  const hits = s.shotsHit - p.before.shotsHit;
  const result = {
    id: p.id,
    seconds: p.seconds,
    avgFps: Math.round(p.frames / Math.max(0.001, (performance.now() - p.start) / 1000)),
    kills: s.kills - p.before.kills,
    shots,
    hits,
    accuracy: shots > 0 ? Math.round((hits / shots) * 100) : 0,
    damageDealt: Math.round(s.damageDealt - p.before.damageDealt),
    damageTaken: Math.round(s.damageTaken - p.before.damageTaken),
    hpRemaining: Math.round(player.health),
    enemiesAlive: enemies.length,
    playerDied: !player.alive,
  };
  bridge.send('playtest:result', result);
  hud.log('playtest:done', `${result.avgFps}fps · 命中率${result.accuracy}% · 击杀${result.kills}`, 'gp');
}

/** 试玩机器人：自动瞄准最近敌人并开火 */
function botStep(dt) {
  let target = null, bestD = Infinity;
  for (const e of enemies) {
    if (!e.alive) continue;
    const d = e.position.distanceTo(player.position);
    if (d < bestD) { bestD = d; target = e; }
  }
  if (target) {
    const tp = new THREE.Vector3(target.position.x, target.position.y + 1.3, target.position.z);
    camera.getWorldPosition(_origin);
    _dir.copy(tp).sub(_origin).normalize();
    const yaw = Math.atan2(-_dir.x, -_dir.z);
    const pitch = Math.asin(THREE.MathUtils.clamp(_dir.y, -1, 1));
    player.yaw += THREE.MathUtils.clamp(((yaw - player.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI, -4 * dt, 4 * dt);
    player.pitch += THREE.MathUtils.clamp(pitch - player.pitch, -3 * dt, 3 * dt);
    if (player.canFire()) fire();
    else if (player.ammo <= 0) player.startReload();
  }
  // 简易走位：绕着场地中心转
  player.keys.delete('KeyW'); player.keys.delete('KeyS');
  player.keys.delete('KeyA'); player.keys.delete('KeyD');
  player.keys.add(bestD > 14 ? 'KeyW' : 'KeyA');
}

/* ================================================================== *
 *  主循环
 * ================================================================== */

function tick() {
  requestAnimationFrame(tick);
  const now = performance.now();
  let dt = (now - lastTime) / 1000;
  lastTime = now;
  if (dt > 0.1) dt = 0.1; // 切标签页回来时别让物理炸掉

  // FPS
  fpsAcc += dt; fpsFrames += 1;
  if (fpsAcc >= 0.5) { fpsValue = Math.round(fpsFrames / fpsAcc); fpsAcc = 0; fpsFrames = 0; hud.setFps(fpsValue); }

  if (running) {
    if (playtest) {
      botStep(dt);
      playtest.frames += 1;
      if ((now - playtest.start) / 1000 >= playtest.seconds) finishPlaytest();
    }

    player.update(dt, colliders, slopes);

    const ctx = {
      spawnProjectile: (from, to) => projectiles.spawn(from, to),
      onMeleeHit: () => hud.damageFlash(1),
    };
    for (const e of enemies) e.update(dt, player, colliders, ctx);
    projectiles.update(dt, player, colliders, () => hud.damageFlash(0.75));

    if (mouseDown && player.locked && !playtest) fire();

    // 波次推进
    if (level.gameplay.waves.enabled) {
      if (!waveActive && enemies.length === 0) {
        waveTimer += dt;
        if (waveTimer === dt) hud.toast(`第 ${wave} 波将在 ${level.gameplay.waves.delay}s 后开始`);
        if (waveTimer >= level.gameplay.waves.delay) {
          waveTimer = 0;
          spawnWave(wave);
          waveActive = true;
        }
      }
      if (waveActive && enemies.length === 0) {
        waveActive = false;
        wave += 1;
        waveTimer = 0;
        if (wave > level.gameplay.waves.count) {
          hud.toast('全部波次清空 · 战场静默', 'gold');
        }
      }
    }

    if (!player.alive) {
      hud.showDead(player.stats);
      running = false;
    }
  }

  // 武器动画
  // 自由视角（观景/取景）下收起手中武器 —— 否则悬浮在半空会看到一个悬空的枪。
  weapon.group.visible = !player.spectate;
  recoil = Math.max(0, recoil - dt * 7);
  weapon.group.position.z = recoil * 0.09;
  weapon.group.rotation.x = recoil * 0.16;
  if (weapon.flash.material.opacity > 0) {
    weapon.flash.material.opacity = Math.max(0, weapon.flash.material.opacity - dt * 16);
    weapon.light.intensity = weapon.flash.material.opacity * 9;
  }

  fx.update(dt);

  // HUD
  hud.setVitals(
    player.health, player.maxHealth ?? 100,
    player.ammo, player.magazine ?? 30,
    player.reloading,
    player.reloading ? 1 - player.reloadTimer / Math.max(0.001, level.gameplay.player.reloadTime) : 0,
  );
  hud.setStatus(wave, enemies.length, level.meta.revision, score);

  // 遥测上行（低频，1Hz）
  telemetryAcc += dt;
  if (telemetryAcc >= 1 && bridge.connected) {
    telemetryAcc = 0;
    bridge.send('telemetry', {
      fps: fpsValue, wave, enemies: enemies.length, score,
      health: Math.round(player.health), ammo: player.ammo,
      alive: player.alive, revision: level.meta.revision,
      pos: [+player.position.x.toFixed(1), +player.position.y.toFixed(1), +player.position.z.toFixed(1)],
    });
  }

  composer.render();
}
let telemetryAcc = 0;

/* ================================================================== *
 *  启动
 * ================================================================== */

player.onDamaged = (amount) => hud.damageFlash(Math.min(1, amount / 40));
applyLevel(defaultLevel(), { resetPlayer: true });
hud.setFps(0);
bridge.connect();
tick();

// 暴露给控制台，方便手动调试与自动化测试
window.__GAME__ = {
  get level() { return level; },
  applyLevel, player, startRun, stopRun,
  get enemies() { return enemies; },
  get running() { return running; },
  scene, bridge,
};

// ?autostart=1 —— 免点击直接进入运行态。
// 无头浏览器 / Agent 自动化拿不到指针锁定授权，必须先绕过"点击开始"这一步。
if (new URLSearchParams(location.search).get('autostart') === '1') {
  startRun({ lock: false });
}
