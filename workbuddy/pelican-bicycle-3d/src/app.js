// app.js —— 启动器。boot(mode) 可反复调用 / dispose，供单文件版切换版本用。
// 单独页面（index.html / pixel.html）则靠 window.__MODE__ 自动启动。

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeBuilder, makeMaterial } from './core.js';
import { buildRig } from './rig.js';
import { buildWorld } from './world.js';
import { VOXEL, thin } from './model.js';

/** 递归释放几何体、材质与材质上挂的贴图 */
function disposeTree(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (!o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      for (const k of Object.keys(m)) {
        const v = m[k];
        if (v && v.isTexture) v.dispose();
      }
      m.dispose();
    }
  });
}

export function boot(mode, opts = {}) {
  const isPixel = mode === 'voxel';
  const stage = opts.stage || document.body;

  // 每次启动新建 canvas：同一个 canvas 无法二次获取 WebGL 上下文
  const canvas = document.createElement('canvas');
  stage.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isPixel, powerPreference: 'high-performance' });
  renderer.setPixelRatio(isPixel ? 1 : Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = isPixel ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = isPixel ? 1.0 : 0.98;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 420);
  camera.position.set(4.3, 3.0, 6.5);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 1.72, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.minDistance = 3.0;
  controls.maxDistance = 26;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.autoRotate = opts.autoRotate !== false;
  controls.autoRotateSpeed = 1.1;
  controls.update();

  const T = thin(mode);
  const builder = makeBuilder(mode, VOXEL);
  const material = makeMaterial(mode);

  const rig = buildRig(builder, material, T);
  scene.add(rig.group);
  const world = buildWorld(scene, builder, material, mode);

  function resize() {
    const w = window.innerWidth || 1280;
    const h = window.innerHeight || 720;
    const aspect = w / h;
    if (isPixel) {
      // 固定 240 行，宽度按视口比例算 → 像素是方的，不会拉伸
      const ph = 240;
      const pw = Math.max(240, Math.min(900, Math.round(ph * aspect)));
      renderer.setSize(pw, ph, false);
    } else {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);
    }
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    canvas.style.width = '100%';
    canvas.style.height = '100%';
  }
  resize();
  window.addEventListener('resize', resize);

  const clock = new THREE.Clock();
  let time = 0;
  let raf = 0;
  let disposed = false;

  const app = {
    mode,
    canvas,
    scene, camera, renderer, controls, rig, world,
    firstFrame: false,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      controls.dispose();
      disposeTree(scene);
      renderer.dispose();
      try { renderer.forceContextLoss(); } catch (e) { /* 忽略 */ }
      canvas.remove();
    },
  };

  function loop() {
    if (disposed) return;
    raf = requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);
    time += dt;
    rig.update(time);
    world.update(time, dt);
    controls.update();
    renderer.render(scene, camera);

    if (!app.firstFrame) {
      app.firstFrame = true;
      if (opts.onFirstFrame) opts.onFirstFrame(app);
    }
  }
  raf = requestAnimationFrame(loop);

  return app;
}

/* ── 独立页面（index.html / pixel.html）自动启动 ────── */
if (typeof window !== 'undefined' && window.__MODE__) {
  const stage = document.getElementById('stage') || document.body;
  const hud = document.getElementById('hud');
  const btnRotate = document.getElementById('btn-rotate');

  const app = boot(window.__MODE__, {
    stage,
    onFirstFrame(a) {
      if (hud) hud.classList.add('ready');
      const info = a.renderer.info.render;
      window.__DIAG__ = {
        mode: a.mode,
        triangles: info.triangles,
        drawCalls: info.calls,
        canvasBuffer: [a.canvas.width, a.canvas.height],
        parts: a.rig.parts.length,
        kneeSample: a.rig.state.knee,
      };
    },
  });
  window.__APP__ = app;

  if (btnRotate) {
    btnRotate.classList.add('on');
    btnRotate.addEventListener('click', () => {
      app.controls.autoRotate = !app.controls.autoRotate;
      btnRotate.classList.toggle('on', app.controls.autoRotate);
    });
  }
}
