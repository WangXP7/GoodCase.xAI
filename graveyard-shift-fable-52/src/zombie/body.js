// buildZombie: one zombie = ONE skinned mesh with one material (one draw call, plus one per shadow
// pass). Form is a sculpt (sculpt/), wrapped by cages into a wardrobe of vertex data shared by every
// zombie of that sex and build; detail is baked once at load into three skin maps and one garment
// map shared by all. A zombie is an index buffer over its wardrobe, a skeleton and a material.
import { SkinnedMesh, Matrix4, Sphere, Vector3, BufferGeometry, BufferAttribute } from 'three';
import { createRng } from '../core/rng.js';
import { B, PARTS, makeProportions, createSkeleton, solveFK, setBias } from './skeleton.js';
import { buildWardrobe, bakeAtlasOf } from './bodyGeo.js';
import { bakeCharacter, bakeGarments } from './sculpt/bake.js';
import { isSoftwareRenderer, rendererName } from '../render/software.js';
import { createHairTexture } from './hair.js';
import { makeLook, pickVariant, pickSex, pickBuild, VARIANTS } from './variants.js';
import { createZombieMaterials } from './zmats.js';
import { installDamage } from './sever.js';
import { qEuler } from './ik.js';

export { VARIANTS };

let ctx = null; // G, remembered from the first call (or found on window.__G)
const wardrobes = new Map();
let maps = null;
const live = new Set();          // the materials' uniforms of every zombie alive (re-pointed when the maps are rebaked)
const progressFns = [];
export const stats = { wardrobeMs: 0, bakeMs: 0, wardrobes: 0, stepMs: [] }; // stepMs: each bake step's main-thread time
if (typeof window !== 'undefined') window.__zstats = stats;      // load cost, for the harness

// boot-progress hook: fn(fraction 0..1, label) while the character maps bake
export function onBakeProgress(fn) { progressFns.push(fn); }

function wardrobe(sex, build) {
  const key = `${sex}:${build}`;
  let w = wardrobes.get(key);
  if (w) return w;
  w = buildWardrobe(sex, build);
  const a = w.arrays;
  w.attr = {
    position: new BufferAttribute(a.position, 3), normal: new BufferAttribute(a.normal, 3), uv: new BufferAttribute(a.uv, 2),
    skinIndex: new BufferAttribute(a.skinIndex, 4), skinWeight: new BufferAttribute(a.skinWeight, 4), aSurf: new BufferAttribute(a.aSurf, 4),
  };
  w.cache = new Map();
  wardrobes.set(key, w);
  stats.wardrobeMs += w.ms; stats.wardrobes++;
  return w;
}

// The baked maps, shared by every zombie. Baked from the average male sculpt: the cages, UVs and
// detail layer are the same for every sex and build. In a staged shot or a stepped run the bake
// completes here; otherwise it is spread over the following frames (one cage region a frame)
// and reports to the boot bar.
function bodyMaps(G) {
  if (maps) return maps;
  const size = (G.quality && G.quality.charTex) || 2048;
  const base = wardrobe('m', 'average');
  const report = (f) => {
    for (const fn of progressFns) fn(f, 'zombies');
    if (typeof document !== 'undefined') { const l = document.getElementById('boot-label'); if (l && f < 1 && !window.__ready) l.textContent = `zombies ${Math.round(f * 100)}%`; }
  };
  const skin = bakeCharacter(G, base.fig, bakeAtlasOf(base, size), { onProgress: report });
  const cloth = bakeGarments(G, base.garments.pieces, size);
  maps = { normalAo: skin.normalAo, albedoRough: skin.albedoRough, thicknessCavity: skin.thicknessCavity, cloth: cloth.texture, hair: createHairTexture(size <= 1024 ? 2 : 1), jobs: [skin, cloth], size };
  // the maps for the harness (not enumerable: __zstats stays plain data)
  Object.defineProperty(stats, 'maps', { value: maps, configurable: true, enumerable: false, writable: true });
  // A restored GL context gives the bake targets back empty: bake again, at once, and point every
  // live zombie at the new maps.
  if (G.events && G.events.on) G.events.on('renderer:restored', () => {
    const old = maps.jobs;
    const s2 = bakeCharacter(G, base.fig, bakeAtlasOf(base, size), {}), c2 = bakeGarments(G, base.garments.pieces, size);
    s2.finish(); c2.finish();
    Object.assign(maps, { normalAo: s2.normalAo, albedoRough: s2.albedoRough, thicknessCavity: s2.thicknessCavity, cloth: c2.texture, jobs: [s2, c2] });
    maps.hair.needsUpdate = true;
    for (const u of live) { u.tChNA.value = maps.normalAo; u.tChAR.value = maps.albedoRough; u.tChTC.value = maps.thicknessCavity; u.tChCloth.value = maps.cloth; }
    for (const j of old) if (j.target) j.target.dispose();
  });
  const now = (G.params && (G.params.shot || G.params.step)) || typeof requestAnimationFrame === 'undefined';
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const done = () => { stats.bakeMs = (typeof performance !== 'undefined' ? performance.now() : 0) - t0; };
  if (now) { skin.finish(); cloth.finish(); done(); } else {
    // One step at a time on the GPU as well: the next waits until a fence says the last one has
    // been drawn. Each step is one large draw; queued up unchecked they would make the next thing that
    // waits for the GPU (any first draw, any read-back) wait for all of them.
    const gl = G.renderer && G.renderer.getContext ? G.renderer.getContext() : null;
    const fences = !!(gl && typeof gl.fenceSync === 'function');
    let fence = null; let fencedAt = 0; let fencedJob = null;
    const SLOW_STEP_MS = 120; // a step the GPU took longer than this over: the next ones are cut smaller
    const FAST_STEP_MS = 40; // and under this, larger again
    // Start in small pieces (smaller still on a software renderer) and grow while the GPU keeps up:
    // the first region is the largest, and a GPU still drawing it holds up whatever waits on it next.
    skin.bands = isSoftwareRenderer(rendererName(gl)) ? 32 : 8;
    const gpuBusy = () => {
      if (!fence) return false;
      if (gl.isContextLost()) { fence = null; return false; }
      if (gl.getSyncParameter(fence, gl.SYNC_STATUS) === gl.UNSIGNALED) return true; // a cached status: does not wait (a fence from a lost context reads null: done)
      gl.deleteSync(fence); fence = null;
      const took = performance.now() - fencedAt;
      if (fencedJob === skin) {
        if (took > SLOW_STEP_MS) skin.bands = Math.min(64, (skin.bands || 1) * 2);
        else if (took < FAST_STEP_MS) skin.bands = Math.max(1, Math.floor((skin.bands || 1) / 2));
      } else if (fencedJob === cloth && took > SLOW_STEP_MS) cloth.perStep = Math.max(1, Math.floor((cloth.perStep || 12) / 2));
      return false;
    };
    const tick = () => {
      const j = !skin.done ? skin : !cloth.done ? cloth : null;
      if (!j) { done(); return; }
      if (gpuBusy()) { requestAnimationFrame(tick); return; }
      const a = performance.now();
      j.step();
      stats.stepMs.push(Math.round(performance.now() - a));
      if (fences && !gl.isContextLost()) { fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush(); fencedAt = performance.now(); fencedJob = j; }
      requestAnimationFrame(tick);
    };
    // the bake shaders are compiled off the main thread first where the browser can (sculpt/bake.js)
    const ready = (j) => (j.prepare ? j.prepare() : Promise.resolve());
    Promise.all([ready(skin), ready(cloth)]).then(() => requestAnimationFrame(tick), () => requestAnimationFrame(tick));
  }
  return maps;
}

// the geometry for a list of shell names, in draw order (outermost clothing first)
function geometryFor(w, names, farSkip) {
  const key = `${names.join(',')}|${farSkip ? farSkip.join(',') : ''}`;
  let g = w.cache.get(key);
  if (g) return g;
  const lists = [], farLists = [], shLists = [];
  let nNear = 0, nFar = 0, nSh = 0;
  for (const name of names) { const a = w.near.get(name); if (a) { lists.push(a); nNear += a.length; } }
  for (const name of names) { const a = farSkip && farSkip.includes(name) ? null : w.far.get(name); if (a) { farLists.push(a); nFar += a.length; } }
  // what casts shadows: the far level without hair and without brimmed hats. A coarse brim an inch
  // from the face throws a jagged shadow across it (the round-1 black triangles); the shade under
  // a brim is painted by the skin shader instead (uChHat), smooth at any distance.
  for (const name of names) { const a = name.startsWith('hair') || name === 'capT' || name === 'campaign' || (farSkip && farSkip.includes(name)) ? null : w.far.get(name); if (a) { shLists.push(a); nSh += a.length; } }
  const idx = w.count > 65535 ? new Uint32Array(nNear + nFar + nSh) : new Uint16Array(nNear + nFar + nSh);
  let o = 0;
  for (const a of lists) { idx.set(a, o); o += a.length; }
  for (const a of farLists) { for (let i = 0; i < a.length; i++) idx[o + i] = a[i] + w.farBase; o += a.length; }
  for (const a of shLists) { for (let i = 0; i < a.length; i++) idx[o + i] = a[i] + w.farBase; o += a.length; }
  g = new BufferGeometry();
  for (const k of Object.keys(w.attr)) g.setAttribute(k, w.attr[k]);
  g.setIndex(new BufferAttribute(idx, 1));
  g.boundingSphere = new Sphere(new Vector3(0, 0.9, 0), 2.1);
  g.userData.lod = [[0, nNear], [nNear, nFar], [nNear + nFar, nSh]];
  w.cache.set(key, g);
  return g;
}

const _o = new Vector3(), _d = new Vector3(), _a = new Vector3(), _b = new Vector3(), _m = new Matrix4();

// Nearest hit of a ray on one zombie's capsules, or null. origin/dir: {x,y,z} or [x,y,z]; dir unit.
function raycastCapsules(zombie, origin, dir, maxDist = Infinity) {
  const ox = origin.x ?? origin[0], oy = origin.y ?? origin[1], oz = origin.z ?? origin[2];
  const dx = dir.x ?? dir[0], dy = dir.y ?? dir[1], dz = dir.z ?? dir[2];
  let best = null;
  for (const h of zombie.hitboxes) {
    if (zombie.pose.hide[h.index]) continue;                 // a severed part cannot be hit
    // work in the bone's unscaled frame: capsule along `axis` through `center`
    const e = h.bone.matrixWorld.elements;
    const sx = Math.hypot(e[0], e[1], e[2]) || 1, sy = Math.hypot(e[4], e[5], e[6]) || 1, sz = Math.hypot(e[8], e[9], e[10]) || 1;
    _m.set(e[0] / sx, e[4] / sy, e[8] / sz, e[12], e[1] / sx, e[5] / sy, e[9] / sz, e[13], e[2] / sx, e[6] / sy, e[10] / sz, e[14], 0, 0, 0, 1);
    const ax = h.axis, hh = h.halfHeight;
    _a.set(h.center[0] - ax[0] * hh, h.center[1] - ax[1] * hh, h.center[2] - ax[2] * hh).applyMatrix4(_m);
    _b.set(h.center[0] + ax[0] * hh, h.center[1] + ax[1] * hh, h.center[2] + ax[2] * hh).applyMatrix4(_m);
    _o.set(ox, oy, oz); _d.set(dx, dy, dz);
    const t = rayCapsule(_o, _d, _a, _b, h.radius);
    if (t >= 0 && t <= maxDist && (!best || t < best.dist)) best = { part: h.part, bone: h.bone, dist: t, hitbox: h };
  }
  if (best) best.pos = [ox + dx * best.dist, oy + dy * best.dist, oz + dz * best.dist];
  return best;
}
function rayCapsule(ro, rd, pa, pb, ra) {
  const bax = pb.x - pa.x, bay = pb.y - pa.y, baz = pb.z - pa.z;
  const oax = ro.x - pa.x, oay = ro.y - pa.y, oaz = ro.z - pa.z;
  const baba = bax * bax + bay * bay + baz * baz;
  const bard = bax * rd.x + bay * rd.y + baz * rd.z;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = rd.x * oax + rd.y * oay + rd.z * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  const a = baba - bard * bard;
  let b = baba * rdoa - baoa * bard;
  let c = baba * oaoa - baoa * baoa - ra * ra * baba;
  let h = b * b - a * c;
  if (h >= 0 && a > 1e-9) {
    const t = (-b - Math.sqrt(h)) / a;
    const y = baoa + t * bard;
    if (y > 0 && y < baba) return t;
    const cx = y <= 0 ? oax : ro.x - pb.x, cy = y <= 0 ? oay : ro.y - pb.y, cz = y <= 0 ? oaz : ro.z - pb.z;
    b = rd.x * cx + rd.y * cy + rd.z * cz;
    c = cx * cx + cy * cy + cz * cz - ra * ra;
    h = b * b - c;
    if (h > 0) return -b - Math.sqrt(h);
  }
  return -1;
}

// buildZombie(variantSeed, G?, opts?) -> zombie.
// G: the game context (needs G.mats, G.renderer). Pass it on the first call; later calls may omit
// it. If it was never passed, window.__G is used when the harness has set it.
// opts: { variant: 'trucker' | 'waitress' | 'mechanic' | 'guest' | 'trooper' | 'drifter', sex: 'm' | 'f',
//         build: 'gaunt' | 'average' | 'heavy' | 'bloated' | 'brute', bare: true (no clothing) }
export function buildZombie(variantSeed, G, opts = {}) {
  if (G) ctx = G;
  if (!ctx && typeof window !== 'undefined' && window.__G) ctx = window.__G;
  if (!ctx || !ctx.mats || !ctx.mats.cloth) throw new Error('buildZombie(seed, G): G with G.mats is needed on the first call');
  const rng = createRng(Math.imul(variantSeed | 0, 0x9e3779b1) ^ 0x5bd1e995);
  const variant = opts.variant || pickVariant(rng);
  const sex = opts.sex || pickSex(rng, variant);
  const build = opts.build || pickBuild(rng, variant);
  const prop = makeProportions(rng.fork('build'), variant, sex, build);
  const look = makeLook(rng.fork('look'), variant, sex, build, opts);
  const { skeleton, bones, pose, hitboxes } = createSkeleton(prop);
  hitboxes.forEach((h) => { h.index = bones.indexOf(h.bone); });
  const w = wardrobe(sex, build);
  const mats = createZombieMaterials(ctx, look, bodyMaps(ctx));
  // its own carriage (variants.js: posture)
  for (const [bone, pitch, yaw, roll] of look.posture) setBias(pose, B[bone], pitch, yaw, roll);
  // headwear sits askew
  qEuler(pose.lq, B.cap * 4, look.capTilt[0], look.capTilt[1], look.capTilt[2]);

  const geo = geometryFor(w, look.shells, look.farSkip);
  const ranges = geo.userData.lod;
  const mesh = new SkinnedMesh(geo, mats.char);
  mesh.bind(skeleton, new Matrix4());
  mesh.boundingSphere = new Sphere(new Vector3(0, 0.9, 0), build === 'brute' ? 2.9 : 2.1);
  mesh.castShadow = true; mesh.receiveShadow = true;
  if (mats.depth) { mesh.customDepthMaterial = mats.depth; mesh.customDistanceMaterial = mats.distance; }
  mesh.name = `zombie:${variant}:${variantSeed}`;
  // depth pre-pass twin (see zmats.js): same geometry and skeleton, drawn first
  let pre = null;
  if (mats.prepass) {
    pre = new SkinnedMesh(geo, mats.prepass);
    pre.bind(skeleton, new Matrix4());
    pre.boundingSphere = mesh.boundingSphere;
    pre.renderOrder = -1; pre.castShadow = false; pre.receiveShadow = false;
    pre.name = 'zombie:depth';
    mesh.add(pre);
  }
  // level of detail per pass: the view the player sees uses the zombie's own level; shadow maps,
  // puddle reflections and any other camera get the far one. (The geometry may be shared between
  // zombies of identical look, so the range is set before every draw.)
  let lod = 0;
  const forView = (r, sc, camera, g) => { const k = camera === ctx.camera ? lod : 1; g.setDrawRange(ranges[k][0], ranges[k][1]); };
  const forShadow = (r, o, cam, sc, g) => { g.setDrawRange(ranges[2][0], ranges[2][1]); };
  mesh.onBeforeRender = forView; mesh.onBeforeShadow = forShadow;
  if (pre) pre.onBeforeRender = forView;

  const byName = {};
  bones.forEach((b) => { byName[b.name] = b; });
  const parts = {};
  const main = { head: 'head', torso: 'spine2', armL: 'upperArmL', armR: 'upperArmR', legL: 'thighL', legR: 'thighR' };
  PARTS.forEach((p, i) => { parts[p] = { index: i, bone: byName[main[p]], hitboxes: hitboxes.filter((h) => h.part === p) }; });
  const u = mats.char.surf;
  live.add(u);
  const blood = u.uChBlood.value;
  const base = new Float32Array(6);           // the blood it was built with; setBlood adds to it
  PARTS.forEach((p, i) => { base[i] = (look.blood && look.blood[p]) || 0; blood[i] = base[i]; });

  const zombie = {
    mesh, skeleton, parts, hitboxes, bones: byName, pose, variant, sex, build, seed: variantSeed, look, proportions: prop, materials: mats, lod: 0,
    gear: look.gear, figure: w.fig,
    triangles: [ranges[0][1] / 3, ranges[1][1] / 3],
    // amount 0..1 of fresh blood on a body part (skin and the clothing over it), over what it arrived with.
    // Setting the head to 0 on a damaged zombie is the pool reusing it: wounds and severed parts are cleared.
    setBlood(part, amount) {
      const i = PARTS.indexOf(part);
      if (i < 0) return;
      if (amount <= 0 && i === 0 && zombie.damaged) zombie.resetDamage();
      blood[i] = Math.min(1, base[i] + Math.max(0, amount) * (1 - base[i]));
    },
    getBlood(part) { const i = PARTS.indexOf(part); return i < 0 ? 0 : Math.max(0, (blood[i] - base[i]) / Math.max(1e-6, 1 - base[i])); },
    // 0 = dry (indoors), 1 = out in the rain
    setWet(amount) { u.uShelter.value = 1 - Math.min(1, Math.max(0, amount)); },
    // 0 = near (full detail), 1 = far
    setLod(level) { lod = level ? 1 : 0; zombie.lod = lod; u.uChFar.value = lod; },
    raycast: (origin, dir, maxDist) => raycastCapsules(zombie, origin, dir, maxDist),
    // the level's collision boxes, when there is a level: a dead body falls against them (anim.js, ragdoll.js)
    get colliders() { return ctx && ctx.level && ctx.level.colliders ? ctx.level.colliders : null; },
    // geometry and maps are shared between zombies and stay; this frees the zombie's own material and skeleton
    dispose() { live.delete(u); mats.char.dispose(); if (mats.depth) { mats.depth.dispose(); mats.distance.dispose(); mats.prepass.dispose(); } skeleton.dispose(); },
  };
  installDamage(zombie, w.fig);
  // rest pose until an animator takes over
  solveFK(bones, pose, [0, 0, 0], [0, 0, 0, 1]);
  return zombie;
}
