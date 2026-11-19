// Post chain. Owns the HDR scene target and runs passes in fixed slot order:
//   scene -> ao -> volumetrics -> [combine] -> fx -> bloom -> flare -> composite -> fxaa -> screen
// Built-in passes (bloom, composite, fxaa) use the same interface as passes added by other modules.
//
// Pass interface (all optional except name and render):
//   { name, enabled = true,
//     init(post)        called once from addPass; build materials and targets here
//     resize(w, h)      internal resolution changed
//     render(post)      draw into your own target; return the result Texture (see SLOT_INPUT below)
//     dispose() }
// A pass that throws in render is disabled and reported once; the rest of the frame still draws.
//
// Which passes run is the tier's business, read from G.quality fields every frame: `aoOn` (the ao
// slot), `flare` (the flare slot), `msaa` (samples on the scene target), `reflection` and `volFactor`
// (inside those passes), `bloomMips` (inside bloom), `depthPrepass` (the depth-only twins in the
// scene: see syncPrepass). The chain also times the frames it draws and
// hands each duration to G.quality.frame(ms), which is what moves the dynamic resolution.
// `rain` (density) is applied to the pass named 'rain' by wrapping its render (quality.js
// wrapRainDensity) until fx/rain.js reads the field itself.
import {
  WebGLRenderTarget, DepthTexture, DataTexture, HalfFloatType, UnsignedIntType, UnsignedByteType, RGBAFormat,
  LinearFilter, RawShaderMaterial, GLSL3, NoBlending, Mesh, BufferGeometry, BufferAttribute,
  OrthographicCamera, Vector2,
} from 'three';
import { createBloom } from './bloom.js';
import { createComposite } from './composite.js';
import { createFxaa } from './fxaa.js';
import { installAtmosphere } from './atmosphere.js';
import { installPostTestScene } from '../renderer.js';
import { wrapRainDensity } from '../quality.js';

const PREPASS_SCAN = 120; // frames between looks through the scene for depth pre-pass meshes
const FLASH_HOLD = 0.05; // seconds the exposure meter holds after a shot (the flash's bright part)
export const SLOTS = ['ao', 'volumetrics', 'fx', 'bloom', 'flare', 'composite', 'fxaa'];

// What the chain does with the texture a slot's pass returns (post.tex[slot]):
//   ao           .r multiplies the scene (1 = unoccluded). Full or half res, linear-sampled.
//   volumetrics  .rgb in-scattered light added to the scene (scene-linear HDR), .a transmittance.
//   fx           nothing returned: draw straight into post.targets.hdr (no depth buffer there;
//                test against tDepth in your shader). Runs after ao/volumetrics, before bloom.
//                The result is passed through the NaN/negative guard again before anything reads it.
//   bloom        added in composite (built in).
//   flare        .rgb added after bloom, before exposure (scene-linear HDR).
// Slots whose pass is missing, disabled or skipped fall back to a neutral texture.

const FS_VERTEX = /* glsl */ `
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FS_HEADER = /* glsl */ `precision highp float;
precision highp int;
precision highp sampler2D;
in vec2 vUv;
out vec4 outColor;
`;

// Shader chunks for pass authors (post.glsl.*). `depth` needs ...post.shared in the material uniforms.
const GLSL = {
  common: /* glsl */ `
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
float luma(vec3 c) { return dot(c, LUMA); }
// integer hash -> [0,1). Stable across GPUs, unlike fract(sin()).
uint hashU(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v.x ^ v.y ^ v.z;
}
float hash13(vec3 p) { return float(hashU(uvec3(ivec3(p))) >> 8u) * (1.0 / 16777216.0); }
`,
  depth: /* glsl */ `
uniform sampler2D tDepth;
uniform float cameraNear;
uniform float cameraFar;
uniform mat4 projMatrixInv;
uniform mat4 viewMatrixInv;
float rawDepth(vec2 uv) { return texture(tDepth, uv).r; }
// metres along the view axis, positive; the sky (nothing drawn) returns cameraFar
float linearDepth(vec2 uv) {
  float d = rawDepth(uv);
  return (cameraNear * cameraFar) / (cameraFar - (cameraFar - cameraNear) * d);
}
vec3 viewPos(vec2 uv) {
  vec4 v = projMatrixInv * vec4(uv * 2.0 - 1.0, rawDepth(uv) * 2.0 - 1.0, 1.0);
  return v.xyz / v.w;
}
vec3 worldPos(vec2 uv) { return (viewMatrixInv * vec4(viewPos(uv), 1.0)).xyz; }
`,
};

// One bad pixel (NaN, Inf, negative) would be smeared across the frame by bloom: stop it here.
const SAFE_HDR = /* glsl */ `
vec3 safeHdr(vec3 c) {
  if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
  return min(max(c, vec3(0.0)), vec3(32000.0));
}`;

const COMBINE_FRAG = SAFE_HDR + /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tAO;
uniform sampler2D tVolumetrics;
uniform float uNanGuard;
void main() {
  vec3 c = texture(tScene, vUv).rgb;
  float ao = texture(tAO, vUv).r;
  vec4 vol = texture(tVolumetrics, vUv);
  c = c * ao * vol.a + vol.rgb;
  outColor = vec4(uNanGuard > 0.5 ? safeHdr(c) : c, 1.0);
}`;

// Same guard again after the fx slot, whose passes draw straight into the HDR image.
const GUARD_FRAG = SAFE_HDR + /* glsl */ `
uniform sampler2D tSrc;
uniform float uNanGuard;
void main() {
  vec3 c = texture(tSrc, vUv).rgb;
  outColor = vec4(uNanGuard > 0.5 ? safeHdr(c) : c, 1.0);
}`;

function solidTexture(r, g, b, a) {
  const t = new DataTexture(new Uint8Array([r, g, b, a]), 1, 1, RGBAFormat, UnsignedByteType);
  t.needsUpdate = true;
  return t;
}

// Accepts both `uniforms.x.value = 1` and `uniforms.x = 1`; reading always returns the {value} object.
function uniformBag(defs) {
  const bag = {};
  for (const [k, v] of Object.entries(defs)) {
    const u = { value: v };
    Object.defineProperty(bag, k, {
      enumerable: true,
      get: () => u,
      set: (x) => { u.value = x !== null && typeof x === 'object' && 'value' in x ? x.value : x; },
    });
  }
  return bag;
}

export function createPost(G) {
  const renderer = G.renderer;
  if (!renderer || renderer.stub) throw new Error('post chain needs a real renderer');
  const size = renderer.getDrawingBufferSize(new Vector2());
  let width = size.x;
  let height = size.y;

  const search = new URLSearchParams(window.location.search);
  const skip = new Set((search.get('nopass') || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));

  // ---- targets -----------------------------------------------------------------------------
  const hdrOpts = { type: HalfFloatType, format: RGBAFormat, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false };
  const msaa = () => (skip.has('msaa') ? 0 : G.quality.msaa || 0);
  const scene = new WebGLRenderTarget(width, height, {
    ...hdrOpts, depthBuffer: true, samples: msaa(),
    depthTexture: new DepthTexture(width, height, UnsignedIntType),
  });
  const targets = {
    scene, // linear HDR colour + depth (targets.scene.depthTexture), MSAA-resolved
    hdr: new WebGLRenderTarget(width, height, hdrOpts), // scene with ao + volumetrics applied; fx passes draw into it
    ldr: new WebGLRenderTarget(width, height, hdrOpts), // tone-mapped, sRGB-encoded, before fxaa/grain
  };

  // ---- fullscreen drawing --------------------------------------------------------------------
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const quad = new Mesh(geo);
  quad.frustumCulled = false;
  const quadCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const fsMaterial = ({ fragmentShader, uniforms = {}, ...rest }) => new RawShaderMaterial({
    glslVersion: GLSL3, vertexShader: FS_VERTEX, fragmentShader: FS_HEADER + fragmentShader, uniforms,
    depthTest: false, depthWrite: false, blending: NoBlending, ...rest,
  });
  // target: WebGLRenderTarget, or null for the canvas
  const blit = (material, target) => {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(quad, quadCam);
  };

  // ---- uniforms ------------------------------------------------------------------------------
  // Look controls. Any module may set these; the contract names are exposure, damage, grainAmount, saturation.
  const uniforms = uniformBag({
    exposure: 1.0, // manual multiplier on top of eye adaptation
    damage: 0.0, // 0..1 player-hurt pulse
    grainAmount: 0.028,
    saturation: 1.0,
    // eye adaptation: auto = clamp((adaptKey / meteredLuminance) ^ adaptStrength, adaptMin, adaptMax)
    adaptKey: 0.02, adaptStrength: 0.4, adaptMin: 0.5, adaptMax: 2.2, adaptSpeedUp: 0.9, adaptSpeedDown: 3.0,
    // bloom: threshold and knee are in exposed units (1.0 = display white before the tone curve)
    bloomThreshold: 0.9, bloomKnee: 0.6, bloomRadius: 0.55, bloomStrength: 0.5, bloomClamp: 300.0,
    toneMix: 0.4, // 0 = ACES, 1 = AgX
    shadowDetail: 0.6, // 0 = full film toe (crushed), 1 = linear shadows
    gradeAmount: 1.0, contrast: 0.05,
    vignette: 0.3, chromaticAberration: 0.0012,
    dither: 1.0, fxaa: 1.0, nanGuard: 1.0, adaptOn: 1.0,
  });
  // Per-frame data for pass shaders: spread into material uniforms as `...post.shared`.
  const shared = {
    tScene: { value: scene.texture },
    tDepth: { value: scene.depthTexture },
    tHdr: { value: targets.hdr.texture },
    cameraNear: { value: 0.05 }, cameraFar: { value: 400 },
    projMatrix: { value: G.camera.projectionMatrix }, projMatrixInv: { value: G.camera.projectionMatrixInverse },
    viewMatrix: { value: G.camera.matrixWorldInverse }, viewMatrixInv: { value: G.camera.matrixWorld },
    resolution: { value: new Vector2(width, height) }, texel: { value: new Vector2(1 / width, 1 / height) },
    time: { value: 0 }, frame: { value: 0 },
  };

  const neutral = {
    ao: solidTexture(255, 255, 255, 255),
    volumetrics: solidTexture(0, 0, 0, 255),
    bloom: solidTexture(0, 0, 0, 255),
    flare: solidTexture(0, 0, 0, 255),
  };
  // Slot results for this frame, plus `exposure` (1x1, .r = current auto exposure) and
  // `luma` (smallest bloom mip, .a = sqrt luminance) published by the built-in passes.
  const tex = { ...neutral, hdr: targets.hdr.texture, exposure: neutral.ao, luma: neutral.bloom, composite: null, fx: null, fxaa: null };

  const combineMat = fsMaterial({
    fragmentShader: COMBINE_FRAG,
    uniforms: { tScene: shared.tScene, tAO: { value: neutral.ao }, tVolumetrics: { value: neutral.volumetrics }, uNanGuard: uniforms.nanGuard },
  });

  // Copy of targets.hdr with the guard re-applied, made only on frames where an fx pass drew.
  // Readers use shared.tHdr / post.tex.hdr, which point at whichever is current.
  let hdrSafe = null;
  const guardMat = fsMaterial({ fragmentShader: GUARD_FRAG, uniforms: { tSrc: { value: targets.hdr.texture }, uNanGuard: uniforms.nanGuard } });

  // ---- passes --------------------------------------------------------------------------------
  const bySlot = Object.fromEntries(SLOTS.map((s) => [s, []]));
  const post = {
    targets, uniforms, shared, tex, glsl: GLSL, fsMaterial, blit, slots: SLOTS,
    get width() { return width; },
    get height() { return height; },
    get renderer() { return renderer; },
    get camera() { return G.camera; },
    get quality() { return G.quality; },
    get time() { return G.time; },

    addPass(pass, slot) {
      if (!bySlot[slot]) throw new Error(`post.addPass: unknown slot "${slot}" (use one of ${SLOTS.join(', ')})`);
      if (pass.enabled === undefined) pass.enabled = true;
      if (skip.has(String(pass.name).toLowerCase()) || skip.has(slot)) pass.skipped = true;
      if (pass.init) pass.init(post);
      if (pass.resize) pass.resize(width, height);
      if (pass.name === 'rain') wrapRainDensity(pass, G);
      bySlot[slot].push(pass);
      return pass;
    },
    getPass(name) {
      for (const s of SLOTS) for (const p of bySlot[s]) if (p.name === name) return p;
      return null;
    },
    // Calls fn(pass, slot) for every added pass, in slot order. For the harness's per-pass stats.
    eachPass(fn) { for (const s of SLOTS) for (const p of bySlot[s]) fn(p, s); },
    setPassEnabled(name, on) {
      const p = post.getPass(name);
      if (p) p.enabled = !!on;
      return !!p;
    },
    // Jump eye adaptation to the metered value on the next frame (teleports, staged shots, respawn).
    snapExposure() { snap = true; },
    get snapPending() { return snap; },

    resize(w, h) {
      width = w; height = h;
      const samples = msaa();
      if (scene.samples !== samples) { scene.samples = samples; scene.dispose(); }
      for (const t of Object.values(targets)) t.setSize(w, h);
      if (hdrSafe) hdrSafe.setSize(w, h);
      shared.resolution.value.set(w, h);
      shared.texel.value.set(1 / w, 1 / h);
      for (const s of SLOTS) for (const p of bySlot[s]) if (p.resize) p.resize(w, h);
    },

    render() {
      // frame-to-frame time for dynamic resolution; a change resizes the targets here, before anything is drawn
      const now = performance.now();
      if (lastRender > 0 && G.quality.frame) G.quality.frame(now - lastRender);
      lastRender = now;

      const cam = G.camera;
      cam.updateMatrixWorld();
      shared.cameraNear.value = cam.near; shared.cameraFar.value = cam.far;
      shared.projMatrix.value = cam.projectionMatrix; shared.projMatrixInv.value = cam.projectionMatrixInverse;
      shared.viewMatrix.value = cam.matrixWorldInverse; shared.viewMatrixInv.value = cam.matrixWorld;
      shared.time.value = G.time.t; shared.frame.value = G.time.frame;
      post.snap = snap; snap = false;
      // The eye does not adapt to a muzzle flash: while the flash light is on, the meter holds.
      // (Five quick shots in the dark lane otherwise pulled the exposure down by a sixth, and the
      // lane stayed dimmer for a second or two after the last one.)
      // The hold lasts FLASH_HOLD seconds from each shot, not for as long as the flash light is lit:
      // its tail overlaps the next shot at any real rate of fire, so holding on "lit" froze the
      // meter for the whole of a burst and the eye never adapted while the player kept firing.
      const mz = G.lights && G.lights.muzzle ? G.lights.muzzle.intensity : 0;
      if (mz > muzzleSeen * 1.5 + 1e-4) flashHold = FLASH_HOLD; // brighter than last frame: a new shot
      else flashHold = Math.max(0, flashHold - G.time.dt);
      muzzleSeen = mz;
      post.adaptHold = (flashHold > 0 && mz > 1e-4) || !!(G.sky && G.sky.flash > 0.01); // nor to sheet lightning

      syncPrepass();
      renderer.info.reset();
      renderer.setRenderTarget(scene);
      renderer.clear();
      renderer.render(G.scene, cam);

      runSlot('ao', G.quality.aoOn !== false);
      runSlot('volumetrics', true);
      combineMat.uniforms.tAO.value = tex.ao;
      combineMat.uniforms.tVolumetrics.value = tex.volumetrics;
      blit(combineMat, targets.hdr);
      let hdrTex = targets.hdr.texture;
      if (runSlot('fx', true)) {
        if (!hdrSafe) hdrSafe = new WebGLRenderTarget(width, height, hdrOpts);
        blit(guardMat, hdrSafe);
        hdrTex = hdrSafe.texture;
      }
      shared.tHdr.value = hdrTex;
      tex.hdr = hdrTex;
      for (let i = 3; i < SLOTS.length; i++) runSlot(SLOTS[i], SLOTS[i] !== 'flare' || G.quality.flare !== false);
      renderer.setRenderTarget(null);
    },
  };
  let snap = true; // first frame starts adapted
  let flashHold = 0; // seconds the exposure meter still holds for the last shot
  let muzzleSeen = 0; // the flash light's intensity last frame
  let lastRender = 0; // performance.now() at the previous render

  // Depth pre-pass meshes are whatever is in the scene that writes depth but no colour and casts
  // no shadow (the level's `depth` bucket). They change nothing in the image, so a tier may leave
  // them out: G.quality.depthPrepass false hides them, true shows again
  // the ones this hid. The scene is looked through every PREPASS_SCAN frames for new ones.
  const prepasses = [];
  const prepassHidden = [];
  let sincePrepassScan = PREPASS_SCAN;
  const collectPrepass = (o) => {
    const m = o.material;
    if (!(o.isMesh && !o.castShadow && m && !Array.isArray(m) && m.colorWrite === false && m.depthWrite !== false)) return;
    // a twin hung on a mesh that writes no depth of its own IS that mesh's depth (the zombies): it stays
    const pm = o.parent && o.parent.isMesh ? o.parent.material : null;
    if (pm && !Array.isArray(pm) && pm.depthWrite === false) return;
    prepasses.push(o);
  };
  function syncPrepass() {
    const want = G.quality.depthPrepass !== false;
    if (want) {
      if (prepassHidden.length) { for (let i = 0; i < prepassHidden.length; i++) prepassHidden[i].visible = true; prepassHidden.length = 0; }
      return;
    }
    if (++sincePrepassScan >= PREPASS_SCAN || post.snap) { sincePrepassScan = 0; prepasses.length = 0; G.scene.traverse(collectPrepass); }
    for (let i = 0; i < prepasses.length; i++) {
      const o = prepasses[i];
      if (o.visible) { o.visible = false; prepassHidden.push(o); }
    }
  }

  // returns true if at least one pass in the slot drew this frame
  function runSlot(slot, allowed) {
    let out = null;
    let ran = false;
    if (allowed) {
      for (const p of bySlot[slot]) {
        if (!p.enabled || p.skipped) continue;
        try {
          const r = p.render(post);
          ran = true;
          if (r) out = r;
        } catch (e) {
          p.enabled = false;
          console.error(`[post] pass "${p.name}" failed and was disabled: ${e && e.message}`);
        }
      }
    }
    tex[slot] = out || neutral[slot] || null;
    return ran;
  }

  // nopass tokens that are features inside a built-in pass rather than a whole pass
  if (skip.has('bloom')) uniforms.bloomStrength.value = 0;
  if (skip.has('fxaa')) uniforms.fxaa.value = 0;
  if (skip.has('grain')) uniforms.grainAmount.value = 0;
  if (skip.has('dither')) uniforms.dither.value = 0;
  if (skip.has('ca')) uniforms.chromaticAberration.value = 0;
  if (skip.has('vignette')) uniforms.vignette.value = 0;
  if (skip.has('grade')) uniforms.gradeAmount.value = 0;
  if (skip.has('adapt')) uniforms.adaptOn.value = 0;
  if (skip.has('nanguard')) uniforms.nanGuard.value = 0;
  const bypassComposite = skip.has('composite'); // raw exposed image, for A/B
  for (const name of ['bloom', 'composite', 'fxaa']) skip.delete(name); // these three always run; the tokens above switch their effect off

  post.addPass(createBloom(), 'bloom');
  post.addPass(createComposite({ bypass: bypassComposite }), 'composite');
  post.addPass(createFxaa(), 'fxaa');

  // Ambient occlusion, reflection, volumetrics, flare, rain. If their setup throws, drop whatever
  // it managed to register and carry on with the built-in chain; console.error lands in __errors.
  const before = SLOTS.map((slot) => bySlot[slot].length);
  try {
    installAtmosphere(G, post);
  } catch (e) {
    SLOTS.forEach((slot, i) => { bySlot[slot].length = before[i]; });
    console.error(`[post] atmosphere passes failed to install and are off: ${e && e.message}`);
  }

  if (G.params.shot === 'posttest') installPostTestScene(G);
  return post;
}
