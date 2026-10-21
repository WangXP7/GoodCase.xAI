/* ============================================================
 * main.js — 启动 / 交互 / 城市切换 / 渲染循环
 * ========================================================== */
import * as THREE from 'three';
import { CityBuilder, Environment, TIMES } from './engine.js';
import nanjing from './cities/nanjing.js';
import chongqing from './cities/chongqing.js';
import shanghai from './cities/shanghai.js';
import xian from './cities/xian.js';
import shenzhen from './cities/shenzhen.js';
import jiangnan from './cities/jiangnan.js';

const CITIES = [nanjing, chongqing, shanghai, xian, shenzhen, jiangnan];

/* ---------------- DOM ---------------- */
const $ = id => document.getElementById(id);
const canvas = $('scene'), loader = $('loader'), loadStep = $('loadStep'), loadBar = $('loadBar'), errBox = $('err');

/* ---------------- 渲染器 ---------------- */
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  errBox.style.display = 'block';
  errBox.textContent = 'WebGL 初始化失败：' + e.message;
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 1, 9000);
const env = new Environment(scene, renderer);

/* ---------------- 轨道相机（自制，含触屏） ---------------- */
const cam = {
  target: new THREE.Vector3(0, 60, 0),
  tTarget: new THREE.Vector3(0, 60, 0),
  theta: 0.78, phi: 0.74, radius: 1180,
  tTheta: 0.78, tPhi: 0.74, tRadius: 1180,
  minR: 150, maxR: 2400, auto: false,
};
function applyCam(dt) {
  if (cam.auto) cam.tTheta += dt * 0.045;
  const k = 1 - Math.pow(0.0015, dt);
  cam.theta += (cam.tTheta - cam.theta) * k;
  cam.phi += (cam.tPhi - cam.phi) * k;
  cam.radius += (cam.tRadius - cam.radius) * k;
  cam.target.lerp(cam.tTarget, k);
  const sp = Math.sin(cam.phi), cp = Math.cos(cam.phi);
  camera.position.set(
    cam.target.x + cam.radius * sp * Math.sin(cam.theta),
    cam.target.y + cam.radius * cp,
    cam.target.z + cam.radius * sp * Math.cos(cam.theta)
  );
  camera.lookAt(cam.target);
}
{
  const ptrs = new Map();
  let pinch = 0;
  canvas.addEventListener('pointerdown', e => { ptrs.set(e.pointerId, [e.clientX, e.clientY]); canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    const p = ptrs.get(e.pointerId);
    const dx = e.clientX - p[0], dy = e.clientY - p[1];
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 1) {
      cam.tTheta -= dx * 0.0052;
      cam.tPhi = Math.min(1.45, Math.max(0.12, cam.tPhi - dy * 0.0042));
    } else if (ptrs.size === 2) {
      const pts = [...ptrs.values()];
      const d = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
      if (pinch) cam.tRadius = Math.min(cam.maxR, Math.max(cam.minR, cam.tRadius * pinch / d));
      pinch = d;
    }
  });
  const up = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = 0; };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    cam.tRadius = Math.min(cam.maxR, Math.max(cam.minR, cam.tRadius * Math.exp(e.deltaY * 0.0011)));
  }, { passive: false });
}

/* ---------------- 状态 ---------------- */
const state = { city: 'nanjing', seed: '金陵', density: 1, time: 'dusk', traffic: true, fog: true };
let active = null;      // { builder, city }
let building = false;

/* ---------------- UI 构建 ---------------- */
const cityNav = $('cities');
CITIES.forEach((c, i) => {
  const b = document.createElement('button');
  b.className = 'city-tab' + (c.id === state.city ? ' active' : '');
  b.dataset.id = c.id;
  b.innerHTML = `<span class="idx">${String(i + 1).padStart(2, '0')}</span><span class="name">${c.name}${c.badge ? `<span class="badge-new">${c.badge}</span>` : ''}</span><span class="tag">${c.subtitle}</span>`;
  b.addEventListener('click', () => switchCity(c.id));
  cityNav.appendChild(b);
});
function syncTabs() {
  cityNav.querySelectorAll('.city-tab').forEach(t => t.classList.toggle('active', t.dataset.id === state.city));
}
$('times').querySelectorAll('button').forEach(b => {
  b.addEventListener('click', () => {
    state.time = b.dataset.t;
    $('times').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    env.applyTime(TIMES[state.time], state.fog ? 1 : 0);
  });
});
$('dice').addEventListener('click', () => {
  const s = Math.random().toString(36).slice(2, 8);
  $('seed').value = s; state.seed = s; rebuild();
});
let seedTimer = 0;
$('seed').addEventListener('input', () => {
  clearTimeout(seedTimer);
  seedTimer = setTimeout(() => { state.seed = $('seed').value || '金陵'; rebuild(); }, 450);
});
let denTimer = 0;
$('density').addEventListener('input', () => {
  const v = +$('density').value;
  $('densityVal').textContent = v < 80 ? '疏朗' : v > 120 ? '密集' : '标准';
  clearTimeout(denTimer);
  denTimer = setTimeout(() => { state.density = v / 100; rebuild(); }, 350);
});
function toggle(id, key, fn) {
  const el = $(id);
  el.addEventListener('click', () => {
    state[key] = !state[key];
    el.classList.toggle('on', state[key]);
    fn && fn(state[key]);
  });
}
toggle('tTraffic', 'traffic', on => { if (active) setTraffic(on); });
toggle('tFog', 'fog', on => { if (active) env.applyTime(TIMES[state.time], on ? 1 : 0); });
toggle('tOrbit', 'auto', on => { cam.auto = on; });

function setTraffic(on) {
  const b = active.builder;
  for (const c in b.carMeshes) b.carMeshes[c].visible = on;
  for (const bt of b.boats) bt.g.visible = on;
  for (const tr of b.trains) tr.g.visible = on;
}

/* ---------------- 城市切换 / 构建 ---------------- */
function disposeCity() {
  if (!active) return;
  active.builder.root.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) { if (m.map) m.map.dispose(); if (m.emissiveMap) m.emissiveMap.dispose(); m.dispose(); }
    }
  });
  scene.remove(active.builder.root);
  active = null;
}

async function switchCity(id, keepSeed = true) {
  if (building) return;
  building = true;
  state.city = id;
  syncTabs();
  const city = CITIES.find(c => c.id === id);
  loader.querySelector('.lt').textContent = `${city.name} · 生成中`;
  loadStep.textContent = '正在初始化…';
  loadBar.style.width = '8%';
  loader.classList.remove('hide');
  await new Promise(r => setTimeout(r, 60));
  try {
    disposeCity();
    const builder = new CityBuilder({
      seed: state.seed, density: state.density, palette: city.palette, groundSize: 1200,
      loader: label => { loadStep.textContent = label; },
    });
    const t0 = performance.now();
    await city.build(builder);
    builder.finalize();
    scene.add(builder.root);
    env.register(builder);
    env.applyTime(TIMES[state.time], state.fog ? 1 : 0);
    active = { builder, city };
    setTraffic(state.traffic);
    // 相机就位
    const c = city.camera;
    cam.tRadius = c.radius; cam.tPhi = c.phi; cam.tTheta = c.theta;
    cam.tTarget.set(0, c.targetY, 0);
    cam.minR = c.minR; cam.maxR = c.maxR;
    // 统计
    $('sBld').textContent = builder.stats.buildings;
    $('sMark').textContent = builder.stats.landmarks;
    $('sTree').textContent = builder.stats.trees;
    loadBar.style.width = '100%';
    window.__citygen = {
      ready: true, current: id, seed: state.seed,
      counts: { ...builder.stats },
      marks: builder._marks || [],
      ms: Math.round(performance.now() - t0),
      switchCity: id2 => switchCity(id2),
      cam,
    };
    await new Promise(r => setTimeout(r, 220));
    loader.classList.add('hide');
  } catch (e) {
    console.error(e);
    errBox.style.display = 'block';
    errBox.textContent = '生成失败：' + (e && e.message ? e.message : e);
    loader.classList.add('hide');
  }
  building = false;
}
function rebuild() { if (!building) switchCity(state.city); }

/* ---------------- 主循环 ---------------- */
let last = performance.now(), fpsEma = 60, fpsT = 0;
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  applyCam(dt);
  if (active) active.builder.update(dt, now / 1000);
  env.update(dt);
  renderer.render(scene, camera);
  fpsEma = fpsEma * 0.92 + (1 / Math.max(dt, 1e-4)) * 0.08;
  if (now - fpsT > 500) { fpsT = now; $('sFps').textContent = Math.round(fpsEma); }
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* ---------------- 启动 ---------------- */
switchCity('nanjing').then(() => loop());
