// Shader warm-up. Before the first frame is drawn, every shader program that frame and the first
// seconds of play draw with is compiled, without stopping the page for the whole of it.
//
// What gets compiled is found by drawing one frame "dry": G.post.render() runs with renderer.render
// replaced by a recorder, so every scene, mesh and fullscreen pass the chain would draw (the level,
// the vehicles, the zombie pool with its hidden bodies, the weapon and hands, particles, decals,
// rain, sky, the depth pre-pass meshes, the puddle reflection, the lamp shadow tiles of the
// volumetrics and every post pass) is listed with
// the material it is drawn with, the scene its lights come from, the camera and the render target.
// Each whole scene is listed, hidden objects included, as renderer.compile does. Shadow maps are
// drawn inside renderer.render with depth materials three picks itself: those are listed by doing
// the same pick (shadowEntries). The dry frame changes no picture: nothing is drawn, no pixels are
// read back, the frame timer is not fed, it runs under a frame number no real frame has, the
// exposure snap it uses up and the chain's per-frame results (post.tex) are put back, and a pass
// that remembers what it drew is told afterwards (pass.afterDryFrame()).
//
// Each listed draw is then compiled with renderer.compile against its real target, scene and camera:
//   parallel  (KHR_parallel_shader_compile)  all compiles are issued in small batches, then the
//             programs are polled until each reports ready; each ready one gets its first use (the
//             link check and uniform lookup) there and then, so the first frame has none left.
//   sliced    (no extension)  one draw at a time: issue the compile, wait for a GPU fence without
//             blocking (gpuIdle: the browser's GPU process does the compile), then the first use,
//             and give the page a turn whenever a slice has taken more than sliceMs. Where the
//             compile happens on the page's own thread after all, the longest pause is the slowest program.
// The dry frame runs up to ROUNDS times: a draw can change what the next one needs (the first frame
// creates the rain; the reflection switches the ground's lookup on), and a round that adds nothing ends it.
// Nothing fails: past capMs, or when the context is lost, it returns and the frame compiles what is left.
import { MeshDepthMaterial, MeshDistanceMaterial, FrontSide, BackSide, DoubleSide, VSMShadowMap } from 'three';
import { applyShotCam } from '../core/loop.js';

export const CAP_MS = 4 * 60 * 1000; // give up waiting after this; the first frame compiles whatever is left
export const SLICE_MS = 40; // main-thread time a slice may take before the page gets a turn
export const POLL_MS = 50; // between readiness checks (parallel)
export const ROUNDS = 3;
const CHUNK = 12; // objects per compile call (parallel): keeps one call's source building short
const SHADOW_SIDE = { [FrontSide]: BackSide, [BackSide]: FrontSide, [DoubleSide]: DoubleSide };

export function canCompileInParallel(renderer) {
  try { return !!(renderer && renderer.extensions && renderer.extensions.has('KHR_parallel_shader_compile')); } catch { return false; }
}

// Starts the compiles for everything in the scene so far (only where the driver compiles in parallel),
// so it works on them while the remaining modules build; nothing here waits for them or uses them.
// Skipped on touch devices, whose first update still changes the light counts every shader carries.
export function kickCompile(G) {
  const r = G.renderer;
  if (!r || r.stub || !G.scene || !G.post || G.post.stub || (G.device && G.device.touch) || !canCompileInParallel(r)) return;
  const prev = r.getRenderTarget();
  try {
    r.setRenderTarget((G.post.targets && G.post.targets.scene) || null);
    r.compile(G.scene, G.camera);
  } catch (e) {
    console.warn(`[warm] early compile: ${e && e.message}`);
  } finally {
    r.setRenderTarget(prev);
  }
}

// Waits, without blocking, until the GPU has done everything asked of it so far: a fence, polled
// between turns (its status is cached between turns: asking does not wait). WebGL calls run in the
// browser's GPU process; only queries wait for it. So "issue the compile, wait for the fence, then
// query" keeps the compile off the page's thread even without KHR_parallel_shader_compile, and a
// first draw that follows does not have to wait for other queued work.
export async function gpuIdle(gl, wait = yieldToPage, maxMs = 120000) {
  if (!gl || typeof gl.fenceSync !== 'function' || gl.isContextLost()) return;
  const f = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (!f) return;
  gl.flush();
  const t0 = performance.now();
  try {
    while (!gl.isContextLost() && gl.getSyncParameter(f, gl.SYNC_STATUS) === gl.UNSIGNALED && performance.now() - t0 < maxMs) await wait(0);
  } finally {
    if (!gl.isContextLost()) gl.deleteSync(f);
  }
}

// A turn for the page that includes a paint: requestAnimationFrame runs just before the paint and the
// timeout queued from it runs after it. A hidden tab has no frames: the plain timeout carries on.
export function yieldToPage(ms = 0) {
  return new Promise((resolve) => {
    let done = false;
    const go = () => { if (!done) { done = true; resolve(); } };
    setTimeout(go, Math.max(ms, 100));
    if (ms <= 0 && typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(go, 0));
    else setTimeout(go, ms);
  });
}

const drawable = (o) => !!(o && (o.isMesh || o.isPoints || o.isLine || o.isSprite) && o.material);

// The parts of an object (not its material) that change which program it is drawn with.
export function objectSig(o) {
  const g = o.geometry || {};
  const a = g.attributes || {};
  const m = g.morphAttributes || {};
  let s = o.isPoints ? 'P' : o.isLine ? 'L' : o.isSprite ? 's' : 'M';
  if (o.isInstancedMesh) s += `I${o.instanceColor ? 'c' : ''}${o.morphTexture ? 'm' : ''}`;
  if (o.isBatchedMesh) s += `B${o._colorsTexture ? 'c' : ''}`;
  if (o.isSkinnedMesh) s += 'S';
  if (a.color) s += `C${a.color.itemSize}`;
  if (a.tangent) s += 'T';
  if (a.normal) s += 'N';
  if (a.uv) s += 'U';
  if (!a.position) s += 'X';
  for (const k of ['position', 'normal', 'color']) if (m[k]) s += `${k[0]}${m[k].length}`;
  return s;
}

const matKey = (m) => (Array.isArray(m) ? m.map((x) => (x ? `${x.id}.${x.version}` : '-')).join(',') : `${m.id}.${m.version}`);
const targetKey = (t) => (t ? (t.isXRRenderTarget ? 'x' : 't') : 's');

// One draw to compile: { root, object, material, camera, target, tag?, apply? }. root is what the
// draw's lights (and fog and environment) come from; apply() sets up a borrowed material and returns its undo.
export function entryKey(e) {
  return `${e.root.id}|${targetKey(e.target)}|${e.tag || ''}|${matKey(e.material)}|${objectSig(e.object)}`;
}

export function collectRoot(root, camera, target, out) {
  if (!root || typeof root.traverse !== 'function') return;
  root.traverse((o) => { if (drawable(o)) out.push({ root, object: o, material: o.material, camera, target }); });
}

// One dry frame of the post chain (see the header). Appends what it would have drawn to `out`.
let dryFrames = 0;
export function probeFrame(G, out) {
  const r = G.renderer; const post = G.post; const q = G.quality;
  const saved = { render: r.render, read: r.readRenderTargetPixels, readAsync: r.readRenderTargetPixelsAsync };
  const qFrame = q && typeof q.frame === 'function' ? q.frame : null;
  const snap = post.snapPending === true;
  // the chain's per-frame results (post.tex: the exposure the bloom prefilter reads, the metering
  // luma, the slot outputs) are put back too: after a dry frame they point at targets never drawn
  const tex = post.tex ? { ...post.tex } : null;
  const tHdr = post.shared && post.shared.tHdr ? post.shared.tHdr.value : undefined;
  r.render = (scene, camera) => { if (scene && camera) collectRoot(scene, camera, r.getRenderTarget(), out); };
  r.readRenderTargetPixels = () => {};
  if (saved.readAsync) r.readRenderTargetPixelsAsync = () => Promise.resolve();
  if (qFrame) q.frame = () => {};
  // a frame number no real frame has: work stamped with the frame number (render/post/halfres.js
  // draws the shared low-res depth once per frame) is not taken as done for the real frame
  const time = G.time;
  const frame = time ? time.frame : 0;
  if (time) time.frame = -1 - (dryFrames++ % 1000000);
  try {
    if (G.shotCam) applyShotCam(G, G.shotCam); // as the loop does before each render
    post.render();
  } catch (e) {
    // the chain could not run dry: the main view alone is still worth warming
    console.warn(`[warm] dry frame: ${e && e.message}`);
    collectRoot(G.scene, G.camera, post.targets && post.targets.scene, out);
  } finally {
    if (time) time.frame = frame;
    r.render = saved.render;
    r.readRenderTargetPixels = saved.read;
    if (saved.readAsync) r.readRenderTargetPixelsAsync = saved.readAsync;
    if (qFrame) q.frame = qFrame;
    if (snap && typeof post.snapExposure === 'function') post.snapExposure();
    if (tex) Object.assign(post.tex, tex);
    if (tHdr !== undefined) post.shared.tHdr.value = tHdr;
    // a pass that keeps things it believes it has drawn (render/post/volumetrics.js: its shadow
    // tiles) is told nothing was drawn
    if (typeof post.eachPass === 'function') post.eachPass((p) => { if (typeof p.afterDryFrame === 'function') p.afterDryFrame(); });
  }
}

// Shadow-map draws, compiled as three's shadow pass will draw them: each caster with the light's
// depth material (its customDepthMaterial / customDistanceMaterial, or three's own depth material set
// up from the caster's material: side, alpha test, map, displacement, clipping), lit by the main
// scene (the shadow pass runs inside the scene's render) into a render target. `proxies` keeps the
// stand-ins for three's own depth materials (programs are shared by source, not by material).
function shadowProps(m, type) {
  const side = m.shadowSide !== null && m.shadowSide !== undefined ? m.shadowSide : (type === VSMShadowMap ? m.side : SHADOW_SIDE[m.side]);
  return {
    visible: m.visible, wireframe: m.wireframe, side,
    alphaMap: m.alphaMap, alphaTest: m.alphaToCoverage === true ? 0.5 : m.alphaTest, map: m.map,
    clipShadows: m.clipShadows, clippingPlanes: m.clippingPlanes, clipIntersection: m.clipIntersection,
    displacementMap: m.displacementMap, displacementScale: m.displacementScale, displacementBias: m.displacementBias,
    wireframeLinewidth: m.wireframeLinewidth, linewidth: m.linewidth,
  };
}
const propsSig = (p) => `${p.side}|${p.alphaMap ? p.alphaMap.id : '-'}|${p.alphaTest > 0 ? 1 : 0}|${p.map ? p.map.id : '-'}|${p.displacementMap && p.displacementScale !== 0 ? 1 : 0}|${p.wireframe ? 1 : 0}|${p.clipShadows && p.clippingPlanes && p.clippingPlanes.length ? 1 : 0}`;

export function shadowEntries(G, out, proxies) {
  const r = G.renderer; const scene = G.scene;
  if (!r || !r.shadowMap || !r.shadowMap.enabled || !scene) return;
  const type = r.shadowMap.type;
  const lights = { depth: null, distance: null };
  scene.traverseVisible((o) => {
    if (!o.isLight || !o.castShadow || !o.shadow) return;
    const k = o.isPointLight ? 'distance' : 'depth';
    if (!lights[k]) lights[k] = o;
  });
  if (!lights.depth && !lights.distance) return;
  const target = (G.post && G.post.targets && (G.post.targets.hdr || G.post.targets.scene)) || null;
  if (!target) return;
  const casters = [];
  scene.traverse((o) => { if ((o.isMesh || o.isLine || o.isPoints) && o.castShadow && o.material) casters.push(o); });
  for (const kind of ['depth', 'distance']) {
    const light = lights[kind];
    if (!light) continue;
    for (const o of casters) {
      const custom = kind === 'distance' ? o.customDistanceMaterial : o.customDepthMaterial;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      const mats = []; const sigs = []; const sets = [];
      for (const m of list) {
        if (!m || m.visible === false) continue;
        const p = shadowProps(m, type);
        let dm = custom;
        if (!dm) {
          const key = `${kind}:${m.id}`;
          dm = proxies.get(key);
          if (!dm) { dm = kind === 'distance' ? new MeshDistanceMaterial() : new MeshDepthMaterial(); dm.name = 'warm-shadow'; proxies.set(key, dm); }
          Object.assign(dm, p);
        } else {
          sets.push([dm, p]);
        }
        mats.push(dm); sigs.push(propsSig(p));
      }
      if (!mats.length) continue;
      // a custom depth material is set up from the caster's material at draw time, as three does,
      // and put back afterwards
      const apply = sets.length ? () => {
        const undo = sets.map(([dm, p]) => { const was = {}; for (const k of Object.keys(p)) was[k] = dm[k]; Object.assign(dm, p); return [dm, was]; });
        return () => { for (const [dm, was] of undo) Object.assign(dm, was); };
      } : null;
      out.push({ root: scene, object: o, material: Array.isArray(o.material) ? mats : mats[0], camera: light.shadow.camera, target, tag: `shadow:${sigs.join(',')}`, apply });
    }
  }
}

// Compiles a list of draws that share a root, camera and target in one renderer.compile call. The
// list is handed to compile as a stand-in for a scene: compile walks it with traverse() and takes
// each object's material at that moment, so each draw's own material is swapped in just for its turn.
export function compileEntries(renderer, entries) {
  if (!entries.length) return;
  const { root, camera, target } = entries[0];
  const prevTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(target || null);
  try {
    const batch = {
      traverse(cb) {
        for (const e of entries) {
          const o = e.object; const prev = o.material;
          const undo = e.apply ? e.apply() : null;
          o.material = e.material;
          try { cb(o); } finally { o.material = prev; if (undo) undo(); }
        }
      },
      traverseVisible() {},
    };
    try {
      renderer.compile(batch, camera, root);
    } catch (e) {
      // one at a time through the documented path, so one bad draw costs only itself
      for (const en of entries) {
        const o = en.object; const prev = o.material;
        const undo = en.apply ? en.apply() : null;
        o.material = en.material;
        try { renderer.compile(o, en.camera, en.root); } catch (err) { console.warn(`[warm] ${o.name || o.type}: ${err && err.message}`); } finally { o.material = prev; if (undo) undo(); }
      }
    }
  } finally {
    renderer.setRenderTarget(prevTarget);
  }
}

// The draws of one round that were not compiled in an earlier one. `seen` holds their keys.
export function discover(G, seen, proxies) {
  const all = [];
  if (G.post && !G.post.stub && typeof G.post.render === 'function') probeFrame(G, all);
  else collectRoot(G.scene, G.camera, null, all);
  shadowEntries(G, all, proxies);
  const fresh = [];
  for (const e of all) {
    const k = entryKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    fresh.push(e);
  }
  return fresh;
}

function groupEntries(entries) {
  const groups = new Map();
  const targets = new Map();
  const tid = (t) => { if (!t) return 's'; if (!targets.has(t)) targets.set(t, targets.size); return targets.get(t); };
  for (const e of entries) {
    const k = `${e.root.id}|${e.camera.id}|${tid(e.target)}`;
    let g = groups.get(k);
    if (!g) { g = []; groups.set(k, g); }
    g.push(e);
  }
  return [...groups.values()];
}

const programName = (p) => `${p.name || '(unnamed)'} [${p.type || 'program'}]`;

// Runs the warm-up. opts: { onProgress(state), parallel, capMs, sliceMs, pollMs, now(), wait(ms) }.
// Resolves to the state: { mode, ready, total, rounds, created, timedOut, lost, failed[], ms }.
// In parallel mode ready/total count shader programs; sliced, they count draws (a program is known
// only once its compile has been issued, and there each one is forced as soon as it is).
export function createWarm(G) {
  const proxies = new Map();
  const seen = new Set();
  const finished = new WeakSet();
  return async function warm(opts = {}) {
    const r = G.renderer;
    const o = {
      parallel: canCompileInParallel(r), capMs: CAP_MS, sliceMs: SLICE_MS, pollMs: POLL_MS,
      now: () => performance.now(), wait: yieldToPage, onProgress: () => {}, ...opts,
    };
    const t0 = o.now();
    const gl = r && r.getContext ? r.getContext() : null;
    const lost = () => !!(gl && typeof gl.isContextLost === 'function' && gl.isContextLost());
    const S = { mode: o.parallel ? 'parallel' : 'sliced', ready: 0, total: 0, rounds: 0, created: 0, timedOut: false, lost: false, failed: [], ms: 0 };
    const programs = () => (r.info && r.info.programs) || [];
    const over = () => o.now() - t0 > o.capMs;
    const finish = (p) => {
      if (finished.has(p)) return;
      finished.add(p);
      try { p.getUniforms(); } catch (e) { console.warn(`[warm] ${programName(p)}: ${e && e.message}`); }
      if (p.diagnostics && p.diagnostics.runnable === false) S.failed.push(programName(p));
    };
    // the slowest draws to prepare (sliced: each is timed alone), for the boot details
    S.slowest = [];
    S.longest = { discover: 0, compile: 0, firstUse: 0 }; // the longest single blocking call of each kind (ms)
    const noteSlow = (e, ms) => {
      if (ms < 50) return;
      const m = Array.isArray(e.material) ? e.material[0] : e.material;
      S.slowest.push([`${(m && m.name) || (m && m.type) || '?'}${e.tag ? ' (shadow)' : ''}`, Math.round(ms)]);
      S.slowest.sort((x, y) => y[1] - x[1]);
      S.slowest.length = Math.min(S.slowest.length, 5);
    };
    let slice = o.now();
    const breathe = async () => { if (o.now() - slice >= o.sliceMs) { await o.wait(0); slice = o.now(); } };
    const stop = () => {
      if (lost()) { S.lost = true; return true; }
      if (over()) { S.timedOut = true; return true; }
      return false;
    };

    o.onProgress(S);
    for (let round = 0; round < ROUNDS && !stop(); round++) {
      const before = new Set(programs());
      const d0 = o.now();
      const fresh = discover(G, seen, proxies);
      S.longest.discover = Math.max(S.longest.discover, Math.round(o.now() - d0));
      S.rounds = round + 1;
      if (!fresh.length) break;
      if (o.parallel) {
        for (const group of groupEntries(fresh)) {
          for (let i = 0; i < group.length; i += CHUNK) {
            compileEntries(r, group.slice(i, i + CHUNK));
            await breathe();
            if (lost()) break;
          }
          if (lost()) break;
        }
      } else {
        S.total += fresh.length;
        for (const e of fresh) {
          if (stop()) break;
          o.onProgress(S); // before the step that may block
          const had = new Set(programs());
          const a = o.now();
          compileEntries(r, [e]);
          S.longest.compile = Math.max(S.longest.compile, Math.round(o.now() - a));
          const fresh = programs().filter((p) => !had.has(p));
          // the compile runs in the GPU process: wait for it there, then the first use does not block
          if (fresh.length) await gpuIdle(gl, o.wait);
          const f0 = o.now();
          for (const p of fresh) finish(p);
          S.longest.firstUse = Math.max(S.longest.firstUse, Math.round(o.now() - f0));
          noteSlow(e, o.now() - a);
          S.ready++;
          await breathe();
        }
      }
      let created = 0;
      for (const p of programs()) if (!before.has(p)) created++;
      S.created += created;
      if (!created && round > 0) break;
    }

    if (o.parallel) {
      for (;;) {
        const list = programs();
        const turn = o.now();
        let ready = 0;
        for (const p of list) {
          if (finished.has(p)) { ready++; continue; }
          if (o.now() - turn >= o.sliceMs) continue; // the rest next turn
          if (typeof p.isReady !== 'function' || p.isReady()) { finish(p); ready++; }
        }
        S.ready = ready; S.total = list.length;
        o.onProgress(S);
        if (ready >= list.length || stop()) break;
        await o.wait(o.pollMs);
      }
    } else {
      // programs made before the warm-up (or found by an earlier one) that were never used yet
      for (const p of programs()) {
        if (finished.has(p) || stop()) continue;
        finish(p);
        await breathe();
      }
      if (!S.lost && !S.timedOut) S.ready = S.total;
    }
    S.ms = Math.round(o.now() - t0);
    o.onProgress(S);
    return S;
  };
}

// Shader compile and link failures, reported once each with the material and program name and the
// first 1,500 characters of the driver's log (D3D logs run long), in place of three's default
// report (which prints the whole source). The program is still used: its draws do nothing.
export const SHADER_LOG_MAX = 1500;
export function shaderErrorText(name, logs) {
  const text = logs.filter((l) => l && l.trim()).map((l) => l.trim()).join('\n');
  return `[shader] ${name} failed to compile or link: ${text.slice(0, SHADER_LOG_MAX) || '(no log)'}`;
}
export function installShaderErrorReport(renderer) {
  if (!renderer || !renderer.debug) return;
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    let name = '(unknown program)';
    try {
      const p = ((renderer.info && renderer.info.programs) || []).find((x) => x.program === program);
      if (p) name = programName(p);
    } catch { /* keep the generic name */ }
    const logs = [];
    try {
      logs.push(`program: ${gl.getProgramInfoLog(program) || ''}`);
      logs.push(`vertex: ${gl.getShaderInfoLog(vs) || ''}`);
      logs.push(`fragment: ${gl.getShaderInfoLog(fs) || ''}`);
    } catch { /* a lost context has no logs */ }
    console.error(shaderErrorText(name, logs.filter((l) => !/^\w+: $/.test(l))));
  };
}
