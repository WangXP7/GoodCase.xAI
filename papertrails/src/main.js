// Pop-up Atlas composition root.
// URL params: ?seed=N  ?quality=low|med|high  ?mute=1  ?hint=0  ?night=1  ?life=0  ?animals=0
import * as THREE from 'three';
import { CONFIG, QUALITY, TILE_SIZE } from './core/config.js';
import { bus } from './core/events.js';
import { state } from './core/state.js';
import { createLoop } from './core/loop.js';
import { loadAssets } from './assets/loader.js';
import { createWFC } from './world/wfc.js';
import { createWorld } from './world/world.js';
import { createTraveller } from './player/traveller.js';
import { createControls } from './player/controls.js';
import { createFollowCamera } from './camera/follow.js';
import { createRenderer } from './render/renderer.js';
import { createLights } from './render/lights.js';
import { createPost } from './render/post.js';
import { createMaterials } from './render/materials.js';
import { createPaperAudio } from './audio/paper.js';
import { createMusic } from './audio/music.js';
import { createDayNight } from './render/daynight.js';
import { createLife } from './life/life.js';
import { createAnimals } from './life/animals.js';
import { createGame } from './game/index.js';
import { createViews } from './camera/views.js';
// Allocation-free two-dimensional length.
const hypot2 = (a, b) => Math.sqrt(a * a + b * b);

const params = new URLSearchParams(location.search);
const seedParam = parseInt(params.get('seed') ?? '', 10);
const seed = Number.isFinite(seedParam) ? seedParam : CONFIG.DEFAULT_SEED;
const quality = QUALITY[params.get('quality')] ? params.get('quality') : CONFIG.DEFAULT_QUALITY;
const muted = params.get('mute') === '1';
const showHint = params.get('hint') !== '0';

state.seed = seed;
state.quality = quality;

async function boot() {
  const canvas = document.getElementById('atlas');
  const hint = document.getElementById('hint');

  const scene = new THREE.Scene();
  const { renderer, setSize: setRendererSize } = createRenderer({ canvas, quality });
  const materials = createMaterials({ quality });
  const assets = await loadAssets({ materials, renderer, quality });
  materials.setTextures(assets.textures);
  const lights = createLights({ scene, quality });
  const wfc = createWFC({ seed });
  const world = createWorld({ scene, assets, wfc, materials, quality });
  const traveller = createTraveller({ scene, assets, world, materials });
  const follow = createFollowCamera({ aspect: window.innerWidth / Math.max(1, window.innerHeight) });
  const controls = createControls({ domElement: canvas, camera: follow.camera, traveller });
  const views = createViews({ follow }); // V cycles camera views
  const post = createPost({ renderer, scene, camera: follow.camera, quality });
  const audio = createPaperAudio({ muted });
  const music = createMusic({ audio });
  const daynight = createDayNight({ scene, night: params.get('night') === '1' });
  // ambient life + weather (leaves, snow, rain, birds, chimney smoke, fireflies ...): 2 draw calls; ?life=0 disables it
  const life = params.get('life') === '0' || CONFIG.life.enabled === false ? null : createLife({ scene, assets, wfc, world, daynight, camera: follow.camera, quality, seed });
  // living animals (cats, sheep, hens, ducks ...): cut-paper cards on risen tiles, 2 draw calls; ?animals=0 disables them
  const animals = params.get('animals') === '0' || CONFIG.animals.enabled === false ? null : createAnimals({ scene, renderer, world, wfc, traveller, daynight, assets, seed, quality });
  // Gameplay progress is saved independently for each world seed.
  const game = createGame({ scene, renderer, world, wfc, traveller, follow, controls, lights, post, daynight, music, audio, life, assets, materials, seed, quality });
  follow.setAssistGate(game.modal);
  // N: day / night, M: music on / off (keys only - no on-screen UI)
  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'KeyN') daynight.toggle();
    else if (e.code === 'KeyV' && !game.modal()) views.next();
    else if (e.code === 'KeyM') music.toggle();
  });

  // The tiles cast shadows through BatchedMeshes, everything else through plain meshes.
  // three uses ONE internal depth material for all shadow casters and re-derives its whole program-parameter
  // set whenever the object class flips (batched <-> plain) - twice per frame, ~6 kB of garbage each frame.
  // A second, identical depth material for the plain meshes removes the flip.
  const plainDepth = new THREE.MeshDepthMaterial();
  scene.traverse((o) => { if (o.isMesh && !o.isBatchedMesh && !o.isInstancedMesh && o.castShadow && !o.customDepthMaterial) o.customDepthMaterial = plainDepth; });

  // ---- one simulation tick (order is part of the contract) ------------------------------------
  const idle = { x: 0, z: 0 };
  const _right = new THREE.Vector3();

  function update(dt) {
    state.time = loop.time;
    state.frame = loop.frame;
    const input = controls.getInput(dt) || idle;
    traveller.update(dt, game.modal() ? idle : input); // No walking while the atlas page is open.
    const p = traveller.position;
    const t = state.traveller;
    t.x = p.x; t.y = p.y; t.z = p.z;
    t.dirX = traveller.moveDir.x; t.dirZ = traveller.moveDir.z; t.speed = traveller.speed;
    _right.setFromMatrixColumn(follow.camera.matrixWorld, 0);
    const rl = hypot2(_right.x, _right.z) || 1;
    state.listener.x = p.x; state.listener.z = p.z;
    state.listener.rightX = _right.x / rl; state.listener.rightZ = _right.z / rl;
    world.update(dt, p, traveller.moveDir);
    views.update(dt);
    follow.update(dt, traveller);
    daynight.update(dt);
    if (life) life.update(dt, p, follow.camera);
    if (animals) animals.update(dt);
    game.update(dt);
    lights.update(dt, traveller, follow.camera);
    materials.update(dt);
  }

  function render(dt) {
    post.setFocus(follow.focusPoint);
    post.render(dt);
    game.atlasmap.render(); // Drawn over the finished frame; no-op while closed.
  }

  const loop = createLoop({ update, render });

  // ---- resize -----------------------------------------------------------------------------------
  function resize() {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    setRendererSize(w, h);
    follow.setAspect(w / h);
    post.setSize(w, h);
    bus.emit('resize', { width: w, height: h, dpr: renderer.getPixelRatio() });
  }
  window.addEventListener('resize', resize);

  // ---- hint (the only on-screen text) -----------------------------------------------------------
  if (showHint) {
    hint.classList.add('on');
    bus.once('input:first', () => hint.classList.remove('on'));
  } else hint.remove();

  // Find a safe initial position without skipping the opening fold animation.
  function initialPosition() {
    const x = 0; const z = 0;
    if (world.isWalkable(x, z)) return [x, z];
    for (let r = 0.25; r <= TILE_SIZE * 3; r += 0.25) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const nx = x + Math.cos(a) * r;
        const nz = z + Math.sin(a) * r;
        if (world.isWalkable(nx, nz)) return [nx, nz];
      }
    }
    return [x, z];
  }

  // ---- start ------------------------------------------------------------------------------------------
  if (animals) await animals.ready;
  resize();
  const [x, z] = initialPosition();
  traveller.teleport(x, z);
  controls.clearTarget();
  update(0);
  follow.snap(traveller);
  _right.setFromMatrixColumn(follow.camera.matrixWorld, 0);
  const rl = hypot2(_right.x, _right.z) || 1;
  state.listener.rightX = _right.x / rl; state.listener.rightZ = _right.z / rl;
  if (world.faceCamera) world.faceCamera();
  if (life) life.update(0, traveller.position, follow.camera);
  lights.update(0, traveller, follow.camera);
  render(0);
  loop.start();
}

boot().catch((err) => {
  console.error('[atlas] boot failed', err);
  throw err;
});
