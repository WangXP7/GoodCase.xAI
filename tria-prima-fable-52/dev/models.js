// Model viewer for kit-built models. Not part of the game.
//   /dev/models.html?m=cinderbloom,dewcap&seed=1&az=30&el=18&bg=day
//   m      comma list of model names, or kind:<kind>, or all
//   seed   one seed for every model, or a range "1-4" to line up variants of the first model
//   az el  camera azimuth / elevation in degrees;  dist  distance multiplier;  fov
//   bg     day | dusk | night        debug=1 shows colliders and anchors       t = time in seconds
// window.MV: { ready, shot(name), info(), set(params) }
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildModel, listModels, modelMeta } from '../src/models/registry.js';
// Each folder loads on its own, so a broken file in one folder cannot take the viewer down for the others.
for (const folder of ['flora', 'items', 'nature', 'structures', 'ruins']) {
  try {
    await import(`../src/models/${folder}/index.js`);
  } catch (e) {
    console.error(`[models] folder "${folder}" failed to load: ${e && e.message}`);
  }
}
import { createPropMaterial } from '../src/gfx/propMaterial.js';
import { shared } from '../src/gfx/shared.js';

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.02, 400);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const hemi = new THREE.HemisphereLight(0xbcd7ff, 0x6b5a45, 1.0);
const sun = new THREE.DirectionalLight(0xfff0dc, 3.2);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0002;
sun.shadow.normalBias = 0.01;
scene.add(hemi, sun, sun.target);

const ground = new THREE.Mesh(new THREE.CircleGeometry(200, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2b2a22, roughness: 1 }));
ground.receiveShadow = true;
scene.add(ground);

const propMat = createPropMaterial({ grime: false });
const glassMat = new THREE.MeshPhysicalMaterial({
  vertexColors: true,
  transmission: 0.92,
  roughness: 0.06,
  thickness: 0.02,
  ior: 1.45,
  transparent: true,
  side: THREE.DoubleSide,
  envMapIntensity: 1.4,
});
const liquidMat = createPropMaterial({ roughness: 0.2, grime: false });

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.8, 1.0);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const group = new THREE.Group();
scene.add(group);
let params = {};
let stats = [];

const BG = {
  // overcast daylight: flat, cold, honest
  day: { sky: 0x7b848d, fog: 0x868e95, hemiSky: 0xaab6c4, hemiGround: 0x3a362d, hemi: 0.85, sun: 1.9, sunCol: 0xf2ead8, sunDir: [0.5, 0.74, 0.44], glow: 1.0, ground: 0x2b2a22, exp: 1.0, env: 0.28 },
  // last light: low amber sun, blue shadow
  dusk: { sky: 0x4d4347, fog: 0x5a4c4a, hemiSky: 0x55607a, hemiGround: 0x2a231d, hemi: 1.1, sun: 3.2, sunCol: 0xff9a4a, sunDir: [0.78, 0.24, 0.57], glow: 1.4, ground: 0x2b2720, exp: 1.25, env: 0.2 },
  // moonlight
  night: { sky: 0x070a12, fog: 0x0a0e18, hemiSky: 0x2a3a5c, hemiGround: 0x0c0c10, hemi: 1.0, sun: 1.6, sunCol: 0x9db7ff, sunDir: [0.4, 0.8, 0.44], glow: 2.0, ground: 0x22262b, exp: 1.5, env: 0.12 },
};

function parse() {
  const q = new URLSearchParams(location.search);
  const o = {};
  for (const [k, v] of q) o[k] = v;
  return o;
}

function resolveNames(m) {
  if (!m || m === 'all') return listModels();
  if (m.startsWith('kind:')) return listModels(m.slice(5));
  return m.split(',').filter(Boolean);
}

function rebuild(p) {
  params = { m: 'all', seed: '1', az: '28', el: '16', dist: '1', fov: '32', bg: 'day', debug: '0', t: '1.3', gap: '0.25', ...p };
  while (group.children.length) {
    const c = group.children.pop();
    c.traverse((o) => o.geometry && o.userData.own && o.geometry.dispose());
  }
  stats = [];
  let names = resolveNames(params.m);
  let seeds = [Number(params.seed) || 1];
  const range = /^(\d+)-(\d+)$/.exec(params.seed);
  let items = [];
  if (range) {
    for (let s = Number(range[1]); s <= Number(range[2]); s++) for (const n of names) items.push([n, s]);
  } else items = names.map((n) => [n, seeds[0]]);

  const gap = Number(params.gap);
  // opts=lod=1,picked=true,glyph=salt -> { lod: 1, picked: true, glyph: 'salt' }
  let opts = null;
  if (params.opts) {
    opts = {};
    for (const kv of params.opts.split(',')) {
      const i = kv.indexOf('=');
      if (i < 0) continue;
      const v = kv.slice(i + 1);
      opts[kv.slice(0, i)] = v === 'true' ? true : v === 'false' ? false : v !== '' && !isNaN(Number(v)) ? Number(v) : v;
    }
  }
  let x = 0;
  const bb = new THREE.Box3();
  for (const [name, seed] of items) {
    let model;
    try {
      model = buildModel(name, seed, opts);
    } catch (e) {
      console.error('model failed: ' + name, e);
      continue;
    }
    const w = Math.max(0.1, model.size[0]);
    const cx = x + w / 2 - (model.min[0] + model.size[0] / 2);
    const g = new THREE.Group();
    g.position.x = cx;
    let tris = 0;
    const count = (geo) => (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    if (model.opaque) {
      const mesh = new THREE.Mesh(model.opaque, propMat);
      mesh.castShadow = mesh.receiveShadow = true;
      g.add(mesh);
      tris += count(model.opaque);
    }
    for (const pg of Object.values(model.parts || {})) {
      const mesh = new THREE.Mesh(pg, propMat);
      mesh.castShadow = mesh.receiveShadow = true;
      g.add(mesh);
      tris += count(pg);
    }
    if (model.liquid) {
      const mesh = new THREE.Mesh(model.liquid, liquidMat);
      g.add(mesh);
      tris += count(model.liquid);
    }
    if (model.glass) {
      const mesh = new THREE.Mesh(model.glass, glassMat);
      mesh.castShadow = false;
      mesh.renderOrder = 2;
      g.add(mesh);
      tris += count(model.glass);
    }
    if (params.debug === '1') {
      const wire = new THREE.MeshBasicMaterial({ color: 0x00ffaa, wireframe: true });
      for (const c of model.colliders) {
        let geo;
        if (c.type === 'box') geo = new THREE.BoxGeometry(c.h[0] * 2, c.h[1] * 2, c.h[2] * 2);
        else if (c.type === 'cyl') geo = new THREE.CylinderGeometry(c.r, c.r, c.h, 12);
        else geo = new THREE.SphereGeometry(c.r, 10, 8);
        const mesh = new THREE.Mesh(geo, wire);
        mesh.position.set(...c.c);
        if (c.ry) mesh.rotation.y = c.ry;
        mesh.userData.own = true;
        g.add(mesh);
      }
      for (const [k, a] of Object.entries(model.anchors)) {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 5), new THREE.MeshBasicMaterial({ color: 0xff00ff }));
        mesh.position.set(...a);
        mesh.userData.own = true;
        g.add(mesh);
      }
      for (const e of model.emitters) {
        const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.015), new THREE.MeshBasicMaterial({ color: 0xffff00 }));
        mesh.position.set(...e.pos);
        mesh.userData.own = true;
        g.add(mesh);
      }
    }
    group.add(g);
    stats.push({ name, seed, tris: Math.round(tris), size: model.size.map((v) => +v.toFixed(3)), colliders: model.colliders.length });
    bb.expandByPoint(new THREE.Vector3(x, model.min[1], model.min[2]));
    bb.expandByPoint(new THREE.Vector3(x + w, model.max[1], model.max[2]));
    x += w + gap * Math.max(1, w * 0.6);
  }
  // frame
  const c = bb.getCenter(new THREE.Vector3());
  const s = bb.getSize(new THREE.Vector3());
  const az = (Number(params.az) * Math.PI) / 180,
    el = (Number(params.el) * Math.PI) / 180;
  camera.fov = Number(params.fov);
  const aspect = canvas.width / canvas.height;
  const fitH = (Math.max(s.y, 0.1) * 0.62) / Math.tan((camera.fov * Math.PI) / 360);
  const fitW = (Math.hypot(s.x, s.z) * 0.56) / Math.tan((camera.fov * Math.PI) / 360) / aspect;
  const d = Math.max(fitH, fitW, 0.3) * Number(params.dist) + Math.max(s.z, s.x * 0.2) * 0.5;
  camera.position.set(c.x + Math.sin(az) * Math.cos(el) * d, c.y + Math.sin(el) * d, c.z + Math.cos(az) * Math.cos(el) * d);
  camera.lookAt(c);
  camera.near = Math.max(0.01, d * 0.02);
  camera.far = d * 30 + 200;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();

  const bg = BG[params.bg] || BG.day;
  scene.background = new THREE.Color(bg.sky);
  // no scene fog here: the game replaces three's fog with its own atmosphere, which this viewer does not run
  scene.fog = null;
  hemi.intensity = bg.hemi;
  hemi.color.set(bg.hemiSky);
  hemi.groundColor.set(bg.hemiGround);
  sun.intensity = bg.sun;
  sun.color.set(bg.sunCol);
  ground.material.color.set(bg.ground);
  renderer.toneMappingExposure = bg.exp;
  scene.environmentIntensity = bg.env;
  shared.uGlow.value = bg.glow;
  const sd = new THREE.Vector3(...bg.sunDir).normalize();
  shared.uSunDir.value.copy(sd);
  const R = Math.max(s.x, s.y, s.z, 1) * 0.75 + 0.5;
  sun.position.copy(c).addScaledVector(sd, R * 4);
  sun.target.position.copy(c);
  const sc = sun.shadow.camera;
  sc.left = -R;
  sc.right = R;
  sc.top = R;
  sc.bottom = -R;
  sc.near = 0.1;
  sc.far = R * 9;
  sc.updateProjectionMatrix();
  sun.shadow.normalBias = R * 0.004;
  shared.uTime.value = Number(params.t);
}

function resize() {
  const w = window.innerWidth,
    h = window.innerHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function render() {
  composer.render();
}

async function shot(name = 'model') {
  render();
  const url = canvas.toDataURL('image/jpeg', 0.92);
  const r = await fetch('/__shot?name=' + encodeURIComponent(name), { method: 'POST', body: url });
  return r.json();
}

resize();
rebuild(parse());
window.addEventListener('resize', () => {
  resize();
  rebuild(params);
});
let live = !new URLSearchParams(location.search).has('still');
function loop(t) {
  if (live) {
    shared.uTime.value = t / 1000;
    render();
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

window.MV = {
  ready: Promise.resolve(true),
  shot,
  render,
  info: () => stats,
  list: (kind) => listModels(kind),
  meta: modelMeta,
  set: (p) => {
    live = false;
    rebuild({ ...params, ...p });
    render();
  },
};
