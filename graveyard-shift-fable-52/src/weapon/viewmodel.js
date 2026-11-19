// G.weapon.view: the first-person weapons, the arms and their animation.
//
// The rig. Every weapon is a model from models/index.js (one interface, described there) played by
// the same rig: poses, action behaviour and reload clips come from rig.js by the weapon's class and
// reload kind; the hands' grips are solved against each model's own shape (arms.js). `setWeapon`
// lowers the one in the hands, swaps, and raises the new one.
//
// Rendering. The viewmodel lives in the main scene at the camera, so it takes the scene's lights,
// shadows, wetness and the whole post chain. Its materials carry a patch: the vertex stage projects
// with the viewmodel's own matrix (own FOV, own near plane) and squeezes depth into the first tenth
// of the depth buffer, so the gun can never be cut by a wall and always wins the depth test; the
// fragment stage adds contact darkening where hands meet the gun and each other, a woven grid on the
// glove's cloth, and the weapon's own muzzle flash: for 60 ms after a shot every viewmodel surface is
// lit from a point just ahead of and above the muzzle, with a falloff chosen for the picture (the
// world's flash light is a point light a hand's width away, which by the inverse square either
// burned the glove out or, held back, left the gun unlit; that light is now ignored by the
// viewmodel altogether).
//
// Space. View space is the camera's: +x right, +y up, -z forward. Model space is described in each
// model; `gunM` places the model in view space every frame.
//
// Nothing here allocates per frame: keyframe tables are at module scope (rig.js), channels and
// scratch objects are reused.
import { Group, Matrix4, Vector2, Vector3, Vector4, Quaternion, Euler, ShaderChunk, Mesh, BufferGeometry, Float32BufferAttribute, ShaderMaterial, AdditiveBlending, DoubleSide } from 'three';
import { tuning } from '../game/tuning.js';
import { MODELS, STAND_IN, hasModel, buildHandProps } from './models/index.js';
import { createArms, lerpPose, OCCLUDERS } from './arms.js';
import { handQuat, POSE_SIZE, POSE_AT } from './hand.js';
import { key, Spring, smoother, clamp01, lerp, ease } from './anim.js';
import * as RIG from './rig.js';
import { lastLaunch } from '../fx/casing.js';
import { installWeaponTest } from './weapontest.js';
import { upgradeLook } from './models/upgrade.js';

const DEG = Math.PI / 180;
const VM_NEAR = 0.012, VM_FAR = 6;
export const DEPTH_SLICE = 0.1; // share of the depth buffer the viewmodel uses
const ADS_TIME = 0.18;
const TRACK_EASE = 0.22; // seconds a clip's own track (a crane, a feed cover) takes to ease home when its clip stops
const MUZZLE_FX = 0.03; // how far ahead of the crown the flash sprite's anchor sits (metres)
const NEAR_LIGHT = 0.5; // metres: the closest a point light is taken to be to any viewmodel surface
const CASE_POOL = 4; // spent cases in the air at once (780 rpm x 0.32 s)
const FLASH_OFF = Math.cos(5 * Math.PI / 180); // the flame is never drawn with the bore further than this from where the held pose points it
const SNAP = 0.07; // seconds a gun in a loading pose takes to come down for a shot that interrupts it
const FLASH_WAIT = 0.12; // seconds a shot waits for the gun to come round before its flame is dropped altogether
const CASE_LIFE = 0.32; // seconds the viewmodel draws a spent case before the world particle carries on
const FLASH_AT = [-0.035, 0.075, -0.06]; // view-space offset from the muzzle to the flash term's light: up and toward the eye's side, so the faces the eye sees take it
const FLASH_RGB = [2.3, 1.36, 0.58];
const FLAME_RGB = [[1.0, 0.36, 0.08], [1.0, 0.86, 0.6]]; // the stock flame: its body and its core
// An upgrade bought with the weapon in the hands: a lit front runs from the hands to the muzzle
// (SWEEP seconds, between NEAR and FAR metres ahead of the eye) and the upgraded finish is drawn
// behind it; the lines it leaves burn bright and settle over the rest of MORPH seconds.
const ZING_LOW = { gain: 2.2, pitch: 0.7 }, ZING_HIGH = { gain: 2.6, pitch: 1.3 };
const MORPH = 0.8, MORPH_SWEEP = 0.42, MORPH_NEAR = 0.08, MORPH_FAR = 1.35;
const M = RIG.MARKS;
const WEAPONS = tuning.weapons.table;

const V = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const missing = new Set();
// a shader patch that finds nothing to replace must say so (a three.js upgrade would otherwise pass silently)
function sub(src, find, put, what) {
  if (!src.includes(find)) {
    if (!missing.has(what)) { missing.add(what); console.error(`[viewmodel] shader patch target missing: ${what}`); }
    return src;
  }
  return src.replace(find, put);
}

export function createWeaponView(G) {
  // ---- viewmodel material patch ----
  const vm = {
    uVmProj: { value: new Matrix4() }, uVmOn: { value: 1 }, uVmDepth: { value: new Vector2(DEPTH_SLICE, DEPTH_SLICE - 1) },
    uVmFlash: { value: new Vector4(0, 0, 0, 0) }, uVmFlashPos: { value: new Vector3() }, uVmFlashFall: { value: 34 }, uVmMuzzleL: { value: new Vector3(0, 1e6, 0) },
    // the upgraded finish of the weapon in the hands: x 1 when it is upgraded, y seconds (the pulses), z how far
    // from the eye the finish reaches (metres; far away once it is whole), w the lit front's strength
    uVmUp: { value: new Vector4(0, 0, 1e3, 0) }, uVmUpA: { value: new Vector3(0.62, 0.34, 1) }, uVmUpB: { value: new Vector3(0.3, 0.8, 1) },
    uVmUpP: { value: 0.0125 }, // metres between the finish's lit lines (closer on a handgun, which has less to draw them on)
  };
  const occ = { uVmOccA: { value: new Float32Array(OCCLUDERS * 4) }, uVmOccB: { value: new Float32Array(OCCLUDERS * 4) }, uVmOccN: { value: 0 } };
  const noContact = { value: 0 };
  const weaveOn = { value: 1 };
  // o.relief: scale of the surface shader's fine relief (cloth sampled finer than life needs less);
  // o.contact: { value } scaling the baked contact darkening in aSurf.w; o.occ: darken under the
  // hands' capsules (gun parts in rest space); o.albedo: multiplier on unworn surface colour;
  // o.rough: [multiplier, floor] on roughness after wetting.
  // o.fuzz: multiplier on a cloth's nap (the pale sheen that takes the colour of whatever lights it);
  // o.spec: multiplier on everything the surface mirrors (matt fabric returns far less than the 4 % a
  // smooth dielectric does, and on a near-black cloth that 4 % was most of what the eye saw).
  // o.weave: [pitch in metres, relief]: a woven grid in the cloth's rest space, raised and shaded,
  // fading out where a thread is under two pixels.
  const patch = (mat, o = {}) => {
    const prev = mat.onBeforeCompile;
    const keyOf = mat.customProgramCacheKey ? mat.customProgramCacheKey() : '';
    const rough = o.rough || [1, 0];
    const u = {
      ...vm, uVmFx: { value: new Vector4(o.relief ?? 1, o.albedo ?? 1, rough[0], rough[1]) }, uVmFuzz: { value: new Vector2(o.fuzz ?? 1, o.spec ?? 1) },
      uVmUpK: { value: 0 }, // what this material is to the upgraded finish: 0 untouched, 1 steel, 2 furniture, 3 a moulded body (models/upgrade.js sets it)
      uVmContact: o.contact || noContact, uVmWeave: { value: new Vector2(o.weave ? o.weave[0] : 0, o.weave ? o.weave[1] : 0) }, uVmWeaveOn: weaveOn, uVmSeam: { value: o.seam || 0 }, ...(o.occ ? occ : null),
    };
    mat.onBeforeCompile = (shader, renderer) => {
      if (prev) prev(shader, renderer);
      Object.assign(shader.uniforms, u);
      shader.vertexShader = sub(shader.vertexShader, '#include <common>', '#include <common>\nuniform mat4 uVmProj;\nuniform float uVmOn;\nuniform vec2 uVmDepth;', 'vertex common');
      shader.vertexShader = sub(shader.vertexShader, '#include <project_vertex>', '#include <project_vertex>\nif (uVmOn > 0.5) { gl_Position = uVmProj * mvPosition; gl_Position.z = (gl_Position.z / gl_Position.w * uVmDepth.x + uVmDepth.y) * gl_Position.w; }', 'project_vertex');
      if (!shader.fragmentShader.includes('surfaceMain(sS);')) return; // not a surface material (emissive dots)
      const occGlsl = o.occ ? /* glsl */ `
uniform vec4 uVmOccA[${OCCLUDERS}];
uniform vec4 uVmOccB[${OCCLUDERS}];
uniform int uVmOccN;
float vmOcclusion() {
  float open = 1.0;
  for (int i = 0; i < ${OCCLUDERS}; i++) {
    if (i >= uVmOccN) break;
    vec3 a = uVmOccA[i].xyz, ba = uVmOccB[i].xyz - a, pa = vSP - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
    float d = length(pa - ba * h) - uVmOccA[i].w;
    open *= 1.0 - 0.6 * (1.0 - smoothstep(0.0005, 0.0115, d));
  }
  return 1.0 - open;
}` : 'float vmOcclusion() { return 0.0; }';
      let f = shader.fragmentShader;
      f = sub(f, 'void main() {', /* glsl */ `uniform vec4 uVmFx;
uniform float uVmContact;
uniform vec2 uVmFuzz;
uniform vec2 uVmWeave;
uniform float uVmWeaveOn;
uniform float uVmSeam;
uniform vec4 uVmFlash;
uniform vec3 uVmFlashPos;
uniform float uVmFlashFall;
uniform vec4 uVmUp;
uniform vec3 uVmUpA;
uniform vec3 uVmUpB;
uniform float uVmUpP;
uniform float uVmUpK;
${occGlsl}
void vmSurface(inout Surf s) {
  s.grad *= uVmFx.x; s.dH *= uVmFx.x; gGradX *= uVmFx.x; gHt *= uVmFx.x;
  s.albedo *= mix(uVmFx.y, 1.0, smoothstep(0.7, 0.95, s.metal));
  s.rough = max(s.rough * uVmFx.z, uVmFx.w);
  if (uVmWeave.x > 0.0 && uVmWeaveOn > 0.5) {
    // warp and weft: two sets of threads crossing, each cell a small pillow
    float fq = 6.2832 / uVmWeave.x;
    float fade = 1.0 - smoothstep(0.22, 0.5, gFp / uVmWeave.x);
    vec3 q = vSP * fq;
    float a = sin(q.x + 0.6 * sin(q.z * 0.5)), b = sin(q.z), c = sin(q.y);
    float w = a * b + 0.5 * c * (1.0 - abs(a * b));
    s.albedo *= 1.0 + 0.5 * uVmWeave.y * w * fade;
    s.grad += vec3(cos(q.x) * b, 0.5 * cos(q.y), a * cos(q.z)) * (uVmWeave.y * 0.42 * fade);
    s.rough = min(1.0, s.rough + 0.08 * w * fade);
  }
  // the seam line baked into a glove's skin (aSurf.x): where the stitched rows are not drawn it is the thread
  if (uVmSeam > 0.0 && uVmWeaveOn < 0.5) s.albedo *= 1.0 - 0.55 * smoothstep(0.3, 0.62, vSA.x);
  float c = clamp(max(vSA.w * uVmContact, vmOcclusion()), 0.0, 1.0);
  s.ao *= 1.0 - 0.85 * c;
  s.albedo *= 1.0 - 0.62 * c;
  s.rough = mix(s.rough, 1.0, 0.5 * c);
  // the upgraded finish, behind the lit front (everything, once the front has passed the muzzle)
  if (uVmUpK > 0.5 && uVmUp.x > 0.0) {
    float depth = vViewPosition.z;
    float k = uVmUp.x * smoothstep(-0.008, 0.008, uVmUp.z - depth);
    vec3 tint = mix(uVmUpA, uVmUpB, smoothstep(0.1, -0.45, vSP.z)); // one colour at the butt, the other at the muzzle
    bool steel = uVmUpK < 1.5;
    // lines the length of the gun, a little wavy; faded where a face lies along the lines' own
    // planes (they would smear into a band there)
    float c = (vSP.y * 0.8 + vSP.x * 0.6) / uVmUpP + 0.2 * sin(vSP.z * 48.0);
    float cw = fwidth(c);
    float sd = fract(c) - 0.5;
    float face = smoothstep(0.2, 0.55, cw * uVmUpP / max(gFp, 1e-6));
    float line = (1.0 - smoothstep(0.05, 0.05 + max(cw, 0.03), abs(sd))) * face;
    // each line lies in a cut channel: its walls tip the surface and sit in their own shade
    float wall = (smoothstep(0.05, 0.11, abs(sd)) - smoothstep(0.11, 0.2, abs(sd))) * face * (1.0 - smoothstep(0.15, 0.4, cw));
    s.grad += vec3(0.6, 0.8, 0.0) * (sign(sd) * wall * 0.9 * k);
    s.ao *= 1.0 - 0.5 * wall * k;
    if (steel) {
      // a dark mirror: the colour lies in broad bands of it that drift along the gun
      float band = smoothstep(0.3, 0.9, sin(c * 1.5708 + 2.0 * sin(vSP.z * 15.0 - uVmUp.y * 0.7) + vSP.z * 8.0));
      s.albedo = mix(s.albedo, mix(vec3(0.03) + tint * 0.05, tint * 0.5, band), k);
      s.metal = mix(s.metal, 1.0, k);
      s.rough = mix(s.rough, mix(0.34, 0.2, band), k);
    } else if (uVmUpK > 2.5) { // dark paint in the weapon's colour, the same drifting bands in it
      float band = smoothstep(0.3, 0.9, sin(c * 1.5708 + 2.0 * sin(vSP.z * 15.0 - uVmUp.y * 0.7) + vSP.z * 8.0));
      s.albedo = mix(s.albedo, mix(tint * 0.035, tint * 0.22, band), k);
      s.metal = mix(s.metal, 0.0, k);
      s.rough = mix(s.rough, max(s.rough, 0.55), k);
    } else { // matt black, a breath of the colour in it
      s.albedo = mix(s.albedo, s.albedo * 0.05 + tint * 0.006, k);
      s.rough = mix(s.rough, max(s.rough * 0.8, 0.45), k);
    }
    // the lines are lit, each carrying pulses toward the muzzle
    float pulse = pow(0.5 + 0.5 * sin(vSP.z * 26.0 + uVmUp.y * 5.0 + floor(c) * 2.4), 8.0);
    vec3 glow = line * (uVmUpA * 0.11 + mix(uVmUpA, uVmUpB, 0.7) * pulse * 0.9) * (uVmUpK > 1.5 && uVmUpK < 2.5 ? 0.6 : 1.0);
    glow += tint * pow(1.0 - clamp(gNdv, 0.0, 1.0), 4.0) * 0.012; // and a faint rim of the same colour
    s.emissive += k * glow * (1.0 + 3.0 * uVmUp.w) + exp(-abs(depth - uVmUp.z) * 38.0) * uVmUp.w * (tint * 1.3 + 0.2) * 1.8;
  }
}
void main() {`, 'fragment main');
      f = sub(f, 'vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;', 'vec3 totalSpecular = (reflectedLight.directSpecular + reflectedLight.indirectSpecular) * uVmFuzz.y;', 'totalSpecular');
      // The world's muzzle-flash light does not light the viewmodel: its own flash term does (below).
      // Point lights on the viewmodel: none is ever closer than NEAR_LIGHT (a fire pool or a blast
      // at arm's length would burn a glove white by the inverse square), and the world's muzzle
      // light is ignored while the weapon's own flash term is lit (uVmMuzzleL is parked far away
      // otherwise, so an explosion routed through that light does light the gun).
      const pars = ShaderChunk.lights_pars_begin.replace(/(void getPointLightInfo[\s\S]*?)float lightDistance = length\( lVector \);([\s\S]*?light\.color \*= getDistanceAttenuation\([^;]*;)/, `$1float lightDistance = max( length( lVector ), ${NEAR_LIGHT.toFixed(2)} );$2\n\t\tif ( distance( pointLight.position, uVmMuzzleL ) < 0.03 ) light.color = vec3( 0.0 );`);
      if (pars === ShaderChunk.lights_pars_begin && !missing.has('pointlight')) { missing.add('pointlight'); console.error('[viewmodel] shader patch target missing: getPointLightInfo'); }
      f = sub(f, '#include <lights_pars_begin>', `uniform vec3 uVmMuzzleL;\n${pars}`, 'lights_pars_begin');
      // The flash term, then a roll-off: what the viewmodel returns bends over above 1.2 scene units
      // toward about 2.7, so no lamp or flash clips a glove or a slide to a flat white band.
      f = sub(f, '#include <opaque_fragment>', /* glsl */ `if (uVmFlash.a > 0.0) {
  vec3 fl = uVmFlashPos + vViewPosition;
  float fd = length(fl); fl /= max(fd, 1e-4);
  vec3 fn = normalize(normal), fv = normalize(vViewPosition);
  float wrap = clamp(dot(fn, fl) * 0.62 + 0.38, 0.0, 1.0);
  float att = uVmFlash.a / (1.0 + fd * fd * uVmFlashFall);
  float sp = pow(max(dot(fn, normalize(fl + fv)), 0.0), mix(42.0, 5.0, material.roughness));
  // a dark polished metal (blued steel) mirrors the blast as a warm sheen whatever its own colour
  vec3 fsc = max(material.specularColor, vec3(0.2 * metalnessFactor));
  outgoingLight += uVmFlash.rgb * att * (material.diffuseColor * wrap * wrap * 1.6 + fsc * (sp * (2.4 - 1.6 * material.roughness) + 0.3 * wrap * wrap) + 0.02 * wrap * wrap);
}
{
  float vmL = max(outgoingLight.r, max(outgoingLight.g, outgoingLight.b));
  if (vmL > 1.2) outgoingLight *= (1.2 + (vmL - 1.2) / (1.0 + (vmL - 1.2) / 1.5)) / vmL;
}
#include <opaque_fragment>`, 'opaque_fragment');
      f = sub(f, 'surfaceMain(sS);', `surfaceMain(sS);\nvmSurface(sS);${f.includes('gFuzzC') ? '\ngFuzzC *= uVmFuzz.x;' : ''}`, 'surfaceMain');
      shader.fragmentShader = f;
    };
    mat.customProgramCacheKey = () => `${keyOf}:vm${o.occ ? 'o' : ''}`;
    mat.vmUp = u.uVmUpK; // (on the material itself: the surface materials share one userData)
    return mat;
  };

  const rng = G.rng.fork('weapon.view');
  let rand = rng;

  // ---- models and hands ----
  const root = new Group(); // view space
  root.name = 'viewmodel';
  root.userData.noReflect = true; // the planar puddle reflection must not draw the viewmodel
  const gun = new Group();
  gun.matrixAutoUpdate = false;
  const _m = new Matrix4(), _m2 = new Matrix4(), _q = new Quaternion(), _e = new Euler(0, 0, 0, 'YXZ');
  const _v = V(), _v2 = V(), _s = V(1, 1, 1);
  const built = {}, entries = {};
  const pistol = MODELS[STAND_IN](G, patch);
  built[STAND_IN] = pistol;
  const arms = createArms(G, patch, pistol);
  const pistolHands = () => ({ right: arms.grip.right, left: arms.grip.left, rGrip: arms.poses.rGrip, rFire: arms.poses.rFire, lGrip: arms.poses.lGrip });
  const handsOf = { [STAND_IN]: pistolHands() };
  root.add(gun, arms.root);
  // ---- the flame at the muzzle ----
  // Drawn by the viewmodel itself (its own projection and depth slice), so the gun hides exactly
  // what it should and each class gets its own size: two crossed blades along the bore and a star
  // facing it, a different roll and shape every shot.
  const flame = (() => {
    const pos = [], uv = [], kind = [];
    const quad = (a, b, c, d, k) => { for (const [p, u] of [[a, [0, -1]], [b, [1, -1]], [c, [1, 1]], [a, [0, -1]], [c, [1, 1]], [d, [0, 1]]]) { pos.push(...p); uv.push(...u); kind.push(k); } };
    quad([0, -0.5, 0.06], [0, -0.5, -1], [0, 0.5, -1], [0, 0.5, 0.06], 0);
    quad([-0.5, 0, 0.06], [-0.5, 0, -1], [0.5, 0, -1], [0.5, 0, 0.06], 0);
    quad([-0.6, -0.6, -0.12], [0.6, -0.6, -0.12], [0.6, 0.6, -0.12], [-0.6, 0.6, -0.12], 1);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new Float32BufferAttribute(uv, 2)); geo.setAttribute('aKind', new Float32BufferAttribute(kind, 1));
    const u = { uVmProj: vm.uVmProj, uVmDepth: vm.uVmDepth, uVmOn: vm.uVmOn, uF: { value: new Vector4(0, 0, 0, 0) }, uC0: { value: new Vector3(...FLAME_RGB[0]) }, uC1: { value: new Vector3(...FLAME_RGB[1]) } }; // uF: strength, seed, age 0..1; uC0, uC1: the flame's body and core colours
    const mat = new ShaderMaterial({
      uniforms: u, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, toneMapped: false,
      vertexShader: /* glsl */ `uniform mat4 uVmProj; uniform vec2 uVmDepth; uniform float uVmOn; attribute float aKind; varying vec2 vU; varying float vK;
void main() { vU = uv; vK = aKind; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
  if (uVmOn > 0.5) { gl_Position = uVmProj * mv; gl_Position.z = (gl_Position.z / gl_Position.w * uVmDepth.x + uVmDepth.y) * gl_Position.w; } }`,
      fragmentShader: /* glsl */ `uniform vec4 uF; uniform vec3 uC0; uniform vec3 uC1; varying vec2 vU; varying float vK;
float h(float n) { return fract(sin(n * 127.1 + uF.y * 311.7) * 43758.5453); }
float n1(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h(i), h(i + 1.0), f); }
void main() {
  float I;
  if (vK < 0.5) { // a blade along the bore: a ragged tongue, widest a third of the way out
    float x = vU.x, y = abs(vU.y);
    float w = (0.16 + 0.84 * sin(3.1416 * pow(clamp(x * 1.06, 0.0, 1.0), 0.55))) * (0.55 + 0.45 * n1(x * 9.0 + vU.y * 3.0)) * (1.0 - 0.5 * uF.z);
    float tongue = 1.0 - smoothstep(0.0, 1.0, y / max(w, 0.02));
    float streak = 0.6 + 0.4 * n1(vU.y * 13.0 + 5.0);
    I = tongue * tongue * streak * (1.0 - smoothstep(0.55 + 0.4 * n1(vU.y * 7.0), 1.0, x)) * smoothstep(0.0, 0.07, x);
  } else { // the star seen from behind the gun
    vec2 p = vU * vec2(2.0, 1.0) - vec2(1.0, 0.0);
    float r = length(p), a = atan(p.y, p.x);
    float spikes = pow(0.5 + 0.5 * cos(a * 5.0 + uF.y * 6.28), 3.0) * (0.5 + 0.5 * n1(a * 2.0 + 9.0));
    I = (exp(-r * 6.5) * 1.6 + spikes * exp(-r * 3.2)) * (1.0 - smoothstep(0.7, 1.0, r));
  }
  I *= uF.x;
  vec3 c = mix(uC0, uC1, clamp(I * 1.4, 0.0, 1.0)) * I * 9.0;
  gl_FragColor = vec4(c, 1.0);
}`,
    });
    const mesh = new Mesh(geo, mat);
    mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = 5; mesh.name = 'flame';
    return { mesh, u: u.uF.value, c0: u.uC0.value, c1: u.uC1.value };
  })();
  gun.add(flame.mesh);
  const adopt = (model) => {
    gun.add(model.root);
    model.root.visible = false;
    if (model.casing) {
      model.casings = [model.casing];
      for (let i = 1; i < CASE_POOL; i++) model.casings.push(model.casing.clone());
      for (const c of model.casings) { root.add(c); c.visible = false; c.scale.setScalar(1.06); }
    }
    for (const m of model.meshes) m.renderOrder = -10; // the world behind the viewmodel is rejected early
  };
  adopt(pistol);
  const drawFirst = () => { for (const m of [...arms.right.meshes, ...arms.left.meshes]) m.renderOrder = -10; };
  drawFirst();
  // One entry per weapon id: its model (the pistol stands in for a model nobody has built yet), its
  // Def, and what the rig derives from them.
  function entry(id) {
    if (entries[id]) return entries[id];
    const src = hasModel(id) ? id : STAND_IN;
    if (!built[src]) {
      const model = MODELS[src](G, patch);
      built[src] = model;
      adopt(model);
      handsOf[src] = arms.solveFor(model);
    }
    const model = built[src];
    const def = WEAPONS[id] || WEAPONS[STAND_IN];
    const pose = RIG.poseFor(model.cls, model.pose);
    const clip = RIG.clipFor(src === id ? def : { ...def, cls: model.cls }, model.clip);
    const e = {
      id, model, def, pose, clip, act: RIG.actionOf(model.action), hands: handsOf[src],
      adsPos: [0, 0, 0],
      lowAdd: [0, 1, 2].map((i) => pose.lowered.pos[i] - pose.hip.pos[i]), lowRot: [0, 1, 2].map((i) => pose.lowered.rot[i] - pose.hip.rot[i]),
      muzzleFx: V(),
      magInHandInv: model.magInHand.clone().invert(),
      flash: model.flash || RIG.flashFor(model.cls),
      carry: model.magBox ? arms.solveCarry(model.magBox, model.spareHand === 'fist') : arms.poses[model.spareHand] || arms.poses.mag,
      tracks: clip.tracks ? Object.keys(clip.tracks) : [],
      tv: new Float64Array(clip.tracks ? Object.keys(clip.tracks).length : 0), trT: 1, // each track's last value, and the seconds since its clip stopped
      shell: def.reloadKind === 'shell',
    };
    derive(e);
    entries[id] = e;
    return e;
  }
  // What follows from the model's anchors (an optic moves the sight line, a muzzle device the muzzle).
  function derive(e) {
    const A = e.model.anchors;
    // aiming: the sight anchor on the view axis, `ads` metres from the eye, with the gun turned by
    // adsRot about its grip (compose rotates about the grip, so solve for the origin that does it)
    const r = e.pose.adsRot;
    _v.copy(A.sight).sub(A.grip);
    if (r) _v.applyEuler(_e.set(r[0], r[1], r[2], 'YXZ'));
    e.adsPos[0] = -A.grip.x - _v.x; e.adsPos[1] = -A.grip.y - _v.y; e.adsPos[2] = -e.pose.ads - A.grip.z - _v.z;
    e.muzzleFx.copy(A.muzzle); e.muzzleFx.z -= MUZZLE_FX;
  }
  // The finish and the attachments of a weapon's model. o: { upgraded, attachments: Set-like }.
  function applyLook(e, o) {
    e.upgraded = !!(o && o.upgraded);
    e.model.finish(e.upgraded);
    const at = o && o.attachments;
    const kinds = tuning.weapons.attachments.kinds;
    for (let i = 0; i < kinds.length; i++) e.model.attach(kinds[i], !!(at && typeof at.has === 'function' && at.has(kinds[i])));
    derive(e);
  }
  // A weapon was upgraded or took an attachment (or a new game handed the same weapon back stock):
  // its model follows at once, in the hands or not. No animation.
  // An upgrade bought with the weapon in the hands is shown at once, as a transformation (startMorph).
  function refresh(id, o) {
    const e = entry(id);
    const was = !!e.upgraded;
    applyLook(e, o);
    if (e === cur) {
      syncLook();
      if (e.upgraded && !was && !S.frozen && S.visible && !S.product) startMorph();
      if (!e.upgraded) S.morph.on = false;
      if (S.frozen) update(0);
    }
    return true;
  }
  // The colours that follow the weapon in the hands: its flame, the light its flash throws on the
  // viewmodel and the upgraded finish's two colours.
  function syncLook() {
    const up = !!cur.upgraded, L = upgradeLook(cur.id);
    const f0 = up ? L.flash[0] : FLAME_RGB[0], f1 = up ? L.flash[1] : FLAME_RGB[1];
    flame.c0.set(f0[0], f0[1], f0[2]); flame.c1.set(f1[0], f1[1], f1[2]);
    for (let i = 0; i < 3; i++) S.flashRGB[i] = up ? 1.2 + 1.0 * L.flash[0][i] : FLASH_RGB[i];
    vm.uVmUpA.value.set(L.a[0], L.a[1], L.a[2]); vm.uVmUpB.value.set(L.b[0], L.b[1], L.b[2]);
    vm.uVmUpP.value = cur.model.cls === 'pistol' || cur.model.cls === 'revolver' ? 0.0075 : 0.0125;
  }
  const morphEvt = { weapon: '' };
  function startMorph() {
    S.morph.on = true; S.morph.t = 0;
    rec.up.kick(0.3); rec.p.kick(1.6); rec.r.kick(2.4); // the gun jumps in the hands
    morphEvt.weapon = cur.id;
    if (G.events && typeof G.events.emit === 'function') G.events.emit('weapon:transform', morphEvt);
    // its sound: the ring an upgraded shot carries, low as the front starts and high as it leaves the muzzle
    if (G.audio && typeof G.audio.play === 'function') { G.audio.play('upgrade_zing', ZING_LOW, 0); G.audio.play('upgrade_zing', ZING_HIGH, MORPH_SWEEP); }
  }
  // what the off hand holds for a swing or a throw (placed with the hand in compose)
  const props = buildHandProps(G, patch);
  const propNames = ['knife', 'axe', 'frag', 'molotov', 'decoy'];
  for (const n of propNames) root.add(props[n]);
  for (const m of props.meshes) m.renderOrder = -10;
  // the fist for each: round a handle, a neck, a stick, or the whole body of a grenade
  const fistPoses = {};
  for (const n of propNames) fistPoses[n] = arms.solveCarry(props.grips[n] || props.grip, true);
  let cur = entry(STAND_IN);
  cur.model.root.visible = true;
  // Every weapon's model is built before play (no hitch when one is first drawn), but not all in the
  // one boot step that makes the view: one model a frame while the rest of the game loads, with the
  // boot label saying which. Whatever is left when the first frame is asked for is built then.
  const pending = Object.keys(WEAPONS).filter((id) => id !== STAND_IN);
  const label = (text) => { if (typeof document !== 'undefined') { const l = document.getElementById('boot-label'); if (l && !document.getElementById('boot')?.classList.contains('done')) l.textContent = text; } };
  function buildNext() {
    const id = pending.shift();
    if (id === undefined) return false;
    label(`weapon: ${WEAPONS[id].name || id}`);
    entry(id);
    return pending.length > 0;
  }
  const tickBuild = () => { if (buildNext()) requestAnimationFrame(tickBuild); };
  if (typeof requestAnimationFrame === 'function' && !(G.params && G.params.shot === 'weapontest')) requestAnimationFrame(tickBuild);
  else while (buildNext());
  G.scene.add(root);

  // ---- state ----
  const listeners = {};
  const events = {
    on(name, fn) { (listeners[name] ||= []).push(fn); return () => events.off(name, fn); },
    off(name, fn) { const l = listeners[name]; if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } },
    emit(name, payload) { for (const fn of (listeners[name] || []).slice()) fn(payload); },
  };
  const payload = { anim: null };
  const anim = {
    on: false, name: null, t: 0, dur: 0, k: 1, wasLocked: false, magOut: false, magIn: false, slideRelease: false, done: false, dropped: false,
    per: 0.5, start: 0, shells: 0, count: 0, rack: false, next: null, swapped: false, drawK: 1,
  };
  const S = {
    visible: true, product: null, study: null, frozen: false, time: 0, lite: false,
    adsTarget: 0, adsLin: 0, ads: 0,
    sprint: 0,
    shot: { on: false, t: 0, cased: false, viaFx: false, dur: 0.15, cyl0: 0 },
    pump: { on: false, t: 0, dur: 0.5, cased: false, v: 0 },
    locked: false, lockT: 1, relT: 1, slide: 0,
    hammer: 1, trigger: 0, cyl: 0,
    rounds: 1,
    flashRGB: [FLASH_RGB[0], FLASH_RGB[1], FLASH_RGB[2]], morph: { on: false, t: 0 },
    flashT: 1, flashK: 1, flashHold: false, holdT: 0, boreDot: 1, dt: 0, launchSeen: lastLaunch[6],
    bob: { x: 0, y: 0, roll: 0, pitch: 0 },
    sway: { yaw: 0, pitch: 0, x: 0, y: 0 },
    lastYaw: null, lastPitch: 0, lastVy: 0, wasGround: true, fakeDist: null, fakeSprint: false,
  };
  const rec = { z: new Spring(6.5, 0.55), p: new Spring(5.2, 0.5), y: new Spring(5, 0.6), r: new Spring(6, 0.5), up: new Spring(5.5, 0.6), land: new Spring(3.2, 0.6) };
  const springs = [rec.z, rec.p, rec.y, rec.r, rec.up, rec.land];

  const gunM = new Matrix4(), gunInv = new Matrix4();
  const P = new Float64Array(3), R = new Float64Array(3), _la = new Float64Array(3);
  const HP = new Float64Array(3), HR = new Float64Array(3); // the held pose (hip, sprint, aim) under whatever clip is playing
  const poseR = new Float32Array(POSE_SIZE), poseL = new Float32Array(POSE_SIZE);
  // the support hand: where it is on the gun, where it is going, where the carried magazine puts it
  const onPos = V(), onQuat = new Quaternion(), lp = V(), lq = new Quaternion(), aPos = V(), aQuat = new Quaternion();
  const leftFree = { pos: V(), quat: new Quaternion() };
  const LOW = { pos: V(-0.14, -0.46, -0.2), quat: handQuat(-1, V(-0.25, -0.75, 0.6), V(0.5, 0.5, -0.7)) };
  const POUCH = { pos: V(-0.2, -0.62, -0.1), quat: handQuat(-1, V(-0.2, -0.8, 0.55), V(0.75, 0.3, -0.6)) };
  const REST = { pos: V(-0.1, -0.36, -0.27), quat: handQuat(-1, V(-0.3, -0.55, 0.78), V(0.55, 0.6, -0.55)) };
  const TOSS = { pos: V(-0.06, -0.16, -0.42), quat: handQuat(-1, V(-0.1, -0.5, 0.85), V(0.8, 0.5, -0.3)) }; // the support hand at the end of a throw
  // the off hand's strike: rig.js MELEE as hand frames (x: along the blade, y: the back of the hand)
  const handFrame = (k) => { const x = V(...k.x).normalize(), z = V().crossVectors(x, V(...k.y)).normalize(), y = V().crossVectors(z, x); return { pos: V(...k.pos), quat: new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z)) }; };
  const MELEE_KEYS = {};
  for (const id of Object.keys(RIG.MELEE)) { const m = RIG.MELEE[id]; MELEE_KEYS[id] = { ...m, cock: handFrame(m.cock), strike: handFrame(m.strike), hitEnd: handFrame(m.hitEnd), missEnd: handFrame(m.missEnd) }; }
  const blendHand = (a, b, k) => { leftFree.pos.lerpVectors(a.pos, b.pos, k); leftFree.quat.copy(a.quat).slerp(b.quat, k); };
  let meleeHit = false; // did the swing now playing reach a body (weapon:melee, emitted just before play('swing'))
  if (G.events && typeof G.events.on === 'function') G.events.on('weapon:melee', (e) => { meleeHit = !!(e && e.hit); });
  const drop = { m: new Matrix4(), vel: V(), axis: V(), t: 0 }; // the old magazine once it is clear of the well
  const GRAVITY = 9.81;
  // spent cases in flight: launched in world space (the same launch the fx particle flies), drawn in
  // view space. A small pool, so at a high rate of fire each case flies its whole life instead of
  // vanishing when the next one starts.
  const CASES = [];
  for (let i = 0; i < CASE_POOL; i++) CASES.push({ on: false, t: 0, life: CASE_LIFE, p0: V(), v0: V(), q0: new Quaternion(), axis: V(), spin: 30, obj: null });
  // The blend layer. Whatever interrupts an animation (a cancelled reload, a shot during a shell
  // reload, a switch in the middle of anything) calls settle(): the pose the last frame drew (gun,
  // support hand, fingers, magazine) is kept as an offset from whatever plays next and eased out, so
  // no interruption can move anything in one frame. `last` is that pose, written by compose().
  const BL = { on: false, pending: false, t: 0, dur: 0.2, pos: new Float64Array(3), rot: new Float64Array(3), lp: V(), lq: new Quaternion(), pose: new Float32Array(POSE_SIZE), magD: 0, w: 0 };
  const last = { pos: new Float64Array(3), rot: new Float64Array(3), lp: V(), lq: new Quaternion(), pose: new Float32Array(POSE_SIZE), magD: 0, valid: false };

  // animation channels, refilled every frame
  const C = {
    pos: new Float64Array(3), rot: new Float64Array(3), mix: 0, add: new Float64Array(3), addRot: new Float64Array(3), adsMul: 1,
    leftOn: 1, leftPose: null, leftMix: 0, leftPoseB: null, leftMixB: 0,
    magRel: 0, magD: 0, magShown: true, magFree: -1, spareD: -1, spareOn: false, thumb: 0,
    hand: 0, handK: 0, // the support hand's path while it carries something (see compose)
    prop: null, // what the off hand holds (a name in `props`)
    pull: 0, // the charging handle drawn back past where the bolt is held open
  };
  const HAND = { none: 0, toPouch: 1, fromPouch: 2, atSpare: 3, backOn: 4, pouchLoop: 5, toCharge: 6, atCharge: 7, chargeOn: 8 };
  function resetChannels() {
    C.mix = 0; C.add[0] = C.add[1] = C.add[2] = 0; C.addRot[0] = C.addRot[1] = C.addRot[2] = 0; C.adsMul = 1;
    C.leftOn = 1; C.leftPose = null; C.leftMix = 0; C.leftPoseB = null; C.leftMixB = 0;
    C.magRel = 0; C.magD = 0; C.magShown = true; C.magFree = -1; C.spareD = -1; C.spareOn = false; C.thumb = 0;
    C.hand = HAND.none; C.handK = 0; C.pull = 0; C.prop = null;
  }

  const weaponNow = () => (G.weapon && !G.weapon.stub && G.weapon.id === cur.id ? G.weapon : null);
  const liveDef = () => { const w = weaponNow(); return (w && w.def) || cur.def; };
  const reloadScale = () => { const w = G.weapon; const k = w && w.mods ? w.mods.reloadScale : 1; return k > 0 ? k : 1; };
  const meleeDef = () => tuning.weapons.melee[(G.weapon && G.weapon.melee) || 'knife'];
  const fireTime = () => 60 / (liveDef().rpm || 400);

  function setProjection() {
    const cam = G.camera;
    const fov = lerp(cur.pose.fov[0], cur.pose.fov[1], S.ads) * DEG;
    const top = VM_NEAR * Math.tan(fov / 2), right = top * cam.aspect;
    vm.uVmProj.value.makePerspective(-right, right, top, -top, VM_NEAR, VM_FAR);
    return Math.tan((cam.fov * DEG) / 2) / Math.tan(fov / 2);
  }

  // ---- animation timelines: each fills the channels C for time t (seconds on its own clock) ----
  const SWING_POS = RIG.SWING.pos, SWING_ROT = RIG.SWING.rot, THROW_POS = RIG.THROW.pos, THROW_ROT = RIG.THROW.rot;
  const TL = {
    draw(t) {
      const tt = t * anim.drawK; // authored for a 0.5 s draw
      const k = 1 - ease.back(clamp01(tt / 0.42));
      for (let i = 0; i < 3; i++) { C.add[i] = cur.lowAdd[i] * k; C.addRot[i] = cur.lowRot[i] * k; }
      C.leftOn = smoother((tt - 0.2) / 0.26);
      leftFree.pos.copy(LOW.pos); leftFree.quat.copy(LOW.quat);
      C.leftPose = arms.poses.open; C.leftMix = 1 - smoother((tt - 0.26) / 0.2);
      C.adsMul = smoother((tt - 0.3) / 0.2);
    },
    // put the weapon in the hands away, then draw the next one (the switch happens in stepAnim)
    swap(t) {
      if (anim.swapped) { TL.draw(t - RIG.SWAP_LOWER); return; }
      const k = ease.in(clamp01(t / RIG.SWAP_LOWER));
      for (let i = 0; i < 3; i++) { C.add[i] = cur.lowAdd[i] * k; C.addRot[i] = cur.lowRot[i] * k; }
      C.adsMul = 1 - k;
    },
    reload(t) {
      const c = cur.clip;
      key(c.pos, t, C.pos); key(c.rot, t, C.rot);
      C.mix = key(c.mix, t);
      C.adsMul = 1 - smoother(t / 0.15) + smoother((t - 1.4) / 0.2);
      C.thumb = key(c.thumb, t);
      C.magRel = key(c.magRel, t);
      // old magazine: runs down the well under its own weight, then falls clear (see compose)
      if (t >= M.magIn) { C.magD = 0; C.magShown = true; }
      else if (t >= M.magOut) {
        const tau = Math.min(t, M.magFree) - M.magOut;
        C.magD = 0.5 * c.drop * tau * tau;
        C.magFree = t - M.magFree;
        C.magShown = t < M.magFree + 0.5;
      }
      // support hand: off the gun, down for the fresh magazine, up under the well, palm drives it home, back
      C.leftOn = 1 - smoother((t - 0.06) / 0.12) + smoother((t - 1.16) / 0.3);
      const A = arms.poses;
      C.leftPose = t < 0.3 ? A.open : cur.carry;
      C.leftMix = smoother((t - 0.06) / 0.14) * (1 - smoother((t - 1.22) / 0.26));
      C.leftPoseB = A.slap; C.leftMixB = cur.model.spareHand === 'mag' ? smoother((t - (M.open - 0.07)) / 0.09) * (1 - smoother((t - 1.2) / 0.2)) : 0;
      C.spareOn = t >= M.spareOn && t < M.magIn;
      C.spareD = t >= M.magIn ? 0 : C.spareOn && t >= M.align ? key(c.spare, t) : c.wellStart;
      const K = RIG.CHARGE;
      if (t < M.rise) { C.hand = HAND.toPouch; C.handK = smoother((t - 0.06) / 0.24); }
      else if (t < M.align) { C.hand = HAND.fromPouch; C.handK = ease.out3(clamp01((t - M.rise) / (M.align - M.rise))); }
      else if (cur.model.charge && anim.wasLocked && t >= K.reach) {
        // the bolt is held open on an empty magazine: the support hand takes the handle, draws it
        // back off the catch and lets it go (slideRelease), then goes home
        if (t < K.grasp) { C.hand = HAND.toCharge; C.handK = smoother((t - K.reach) / (K.grasp - K.reach)); }
        else if (t < K.back) C.hand = HAND.atCharge;
        else { C.hand = HAND.chargeOn; C.handK = smoother((t - K.back) / (K.home - K.back)); }
        C.pull = smoother((t - K.grasp) / (M.slideRelease - K.grasp - 0.01));
        C.leftOn = smoother((t - K.back) / (K.home - K.back));
        C.leftPose = cur.carry; C.leftMix = smoother((t - K.reach) / 0.1) * (1 - smoother((t - K.back) / 0.18)); C.leftMixB = 0;
      } else if (t < 1.16) C.hand = HAND.atSpare;
      else { C.hand = HAND.backOn; C.handK = smoother((t - 1.16) / 0.3); }
      for (let i = 0; i < cur.tracks.length; i++) cur.model.state[cur.tracks[i]] = key(c.tracks[cur.tracks[i]], t);
    },
    // one shell per period through the loading gate; the support hand shuttles between pouch and gate
    shell(t) {
      const c = cur.clip, per = anim.per;
      const tt = Math.max(0, t - anim.start);
      const i = Math.floor(tt / per), u = tt / per - i;
      C.pos[0] = c.pos[0]; C.pos[1] = c.pos[1]; C.pos[2] = c.pos[2]; C.rot[0] = c.rot[0]; C.rot[1] = c.rot[1]; C.rot[2] = c.rot[2];
      C.mix = smoother(t / c.mixIn);
      C.adsMul = 0; C.leftOn = 0;
      const A = arms.poses;
      C.leftPose = A[cur.model.spareHand] || A.open; C.leftMix = smoother(t / 0.15);
      const c0 = c.carry[0], c1 = c.carry[1];
      const away = 1 - RIG.SHELL_IN + c0; // the hand's trip back to the pouch runs over the end of one period and the start of the next
      if (u < c0) { C.hand = i === 0 ? HAND.toPouch : HAND.pouchLoop; C.handK = smoother(i === 0 ? u / c0 : (u + 1 - RIG.SHELL_IN) / away); C.spareD = i === 0 ? c.push : 0; }
      else if (u < c1) { C.hand = HAND.fromPouch; C.handK = ease.out3((u - c0) / (c1 - c0)); C.spareOn = true; C.spareD = c.push; }
      else if (u < RIG.SHELL_IN) { C.hand = HAND.atSpare; C.spareOn = true; C.spareD = c.push * (1 - ease.io((u - c1) / (RIG.SHELL_IN - c1))); }
      else { C.hand = HAND.pouchLoop; C.handK = smoother((u - RIG.SHELL_IN) / away); C.spareD = 0; }
    },
    // leaving a reload early, or after the last shell: the blend layer carries everything back to
    // the held pose; this only keeps the aim out until it has
    settle(t) { C.adsMul = smoother(t / anim.dur); },
    inspect(t) {
      key(INSPECT_POS, t, C.pos); key(INSPECT_ROT, t, C.rot);
      C.mix = key(INSPECT_MIX, t);
      C.adsMul = 1 - smoother(t / 0.2) + smoother((t - 3.3) / 0.3);
      C.leftOn = 1 - smoother((t - 0.02) / 0.22) + smoother((t - 3.2) / 0.36);
      leftFree.pos.copy(REST.pos); leftFree.quat.copy(REST.quat);
      C.leftPose = arms.poses.open; C.leftMix = smoother(t / 0.3) - smoother((t - 3.25) / 0.3);
    },
    // the gun is pulled aside and the off hand strikes with the blade (rig.js MELEE): cocked at the
    // hip or over the shoulder, driven to the crosshair, stopped in the body on a hit, then put away
    swing(t) {
      const u = t / anim.dur;
      const kind = (G.weapon && G.weapon.melee) || 'knife';
      const K = MELEE_KEYS[kind] || MELEE_KEYS.knife;
      key(SWING_POS, u, C.add); key(SWING_ROT, u, C.addRot);
      C.adsMul = 1 - smoother(u / 0.15) + smoother((u - 0.8) / 0.2);
      C.leftOn = 1 - smoother(t / 0.045) + smoother((t - K.back) / Math.max(anim.dur - K.back, 0.05));
      const end = meleeHit ? K.hitEnd : K.missEnd;
      if (t < K.wind) blendHand(LOW, K.cock, ease.out(t / K.wind));
      else if (t < K.hit) blendHand(K.cock, K.strike, ease.in((t - K.wind) / (K.hit - K.wind))); // accelerating into the target
      else if (t < K.hold) {
        const h = (t - K.hit) / (K.hold - K.hit);
        // a hit: a dead stop, then pushed home; a miss: it carries through
        blendHand(K.strike, end, meleeHit ? smoother((h - 0.25) / 0.5) : ease.out(h));
        if (meleeHit) { const j = Math.exp(-h * 7) * Math.sin(h * 22); C.add[0] += K.gun[0] * j; C.add[1] += K.gun[1] * j; C.add[2] += K.gun[2] * Math.exp(-h * 5); }
      } else blendHand(end, LOW, smoother((t - K.hold) / (K.back - K.hold)));
      C.leftPose = fistPoses[kind] || fistPoses.knife; C.leftMix = 1 - C.leftOn;
      if (t > 0.03 && t < K.back - 0.04) C.prop = kind; // drawn below the frame, put away below it
    },
    throw(t) {
      const u = t / anim.dur;
      key(THROW_POS, u, C.add); key(THROW_ROT, u, C.addRot);
      C.adsMul = 1 - smoother(u / 0.15) + smoother((u - 0.8) / 0.2);
      C.leftOn = 1 - smoother(u / 0.15) + smoother((u - 0.7) / 0.3);
      const k = ease.out3(clamp01((u - 0.18) / 0.22)) * (1 - smoother((u - 0.5) / 0.25));
      leftFree.pos.lerpVectors(LOW.pos, TOSS.pos, k); leftFree.quat.copy(LOW.quat).slerp(TOSS.quat, k);
      const thrown = (G.weapon && G.weapon.throwable) || 'frag';
      C.leftPose = u < 0.46 ? fistPoses[thrown] || fistPoses.frag : arms.poses.open; C.leftMix = 1 - C.leftOn;
      if (u > 0.05 && u < 0.46) C.prop = thrown; // it leaves the hand at the top of the arc
    },
  };

  const durations = { // always current: they follow the held weapon's Def, the reload scale and the melee in hand
    get draw() { return RIG.durationsFor(liveDef()).draw; }, get fire() { return fireTime(); },
    get reload() { return RIG.durationsFor(liveDef(), { reloadScale: reloadScale() }).reload; },
    get shellIn() { return RIG.durationsFor(liveDef(), { reloadScale: reloadScale() }).shellIn; },
    get pump() { return RIG.durationsFor(liveDef()).pump; },
    get empty() { return RIG.FIXED.empty; }, get inspect() { return RIG.FIXED.inspect; },
    get swing() { return meleeDef().time; }, get throw() { return RIG.FIXED.throw; },
  };
  const durationOf = (name) => durations[name] || 0;

  function start(name, dur, k = 1) {
    anim.on = true; anim.name = name; anim.t = 0; anim.dur = dur; anim.k = k;
    anim.wasLocked = S.locked;
    anim.magOut = anim.magIn = anim.slideRelease = anim.done = anim.dropped = false;
    anim.shells = 0; anim.count = 0; anim.rack = false; anim.swapped = false;
    cur.model.spare.visible = false;
    return dur / k;
  }
  // Start the blend layer from the pose the last frame drew: whatever plays next is eased into over
  // `secs`. Every interruption goes through here.
  function blendFrom(secs) {
    if (!last.valid || S.frozen) return;
    BL.pos.fill(0); BL.rot.fill(0); // `last` already holds whatever an earlier blend was still adding
    BL.on = true; BL.pending = true; BL.t = 0; BL.dur = secs;
    BL.lp.copy(last.lp); BL.lq.copy(last.lq); BL.pose.set(last.pose); BL.magD = Math.min(last.magD, 0.12);
  }
  // Leave a reload where it is and come back to the held pose (a cancel, or the end of a shell reload).
  function settle(secs) {
    blendFrom(secs);
    return start('settle', secs);
  }

  // opts for 'fire': last (the slide stays open after this shot), casing (staged poses only: have
  // G.fx throw the brass, since no weapon:fire is emitted on a stage; in play that event does it).
  // opts for 'reload' / 'shellIn': shells (how many to load when no weapon is counting).
  function play(name, opts) {
    const a = RIG.animFor(name, liveDef(), cur.model.action);
    if (a.kind === 'none') return 0;
    if (name === 'fire') {
      if (anim.on && (anim.name === 'shell' || anim.name === 'settle')) { if (anim.name === 'shell') blendFrom(SNAP); anim.on = false; } // a shot ends a shell reload: the gun snaps down to fire
      const sh = S.shot;
      sh.on = true; sh.t = 0; sh.dur = fireTime(); sh.cyl0 = Math.round(S.cyl);
      sh.cased = cur.act.eject !== 'fire'; sh.viaFx = !!(opts && opts.casing);
      if (!sh.cased && lastLaunch[6] !== S.launchSeen) { sh.cased = true; throwCase(true); } // fx has thrown this shot's case already
      S.relT = 1; S.lockT = 1;
      if (opts && opts.last && cur.act.locksOpen) S.locked = true;
      S.flashT = 0; S.flashK = (liveDef().suppressed ? 0.25 : 1) * cur.flash.light;
      // fired from a loading pose: the flame waits the few frames the gun takes to come round to where it is aimed
      // (the recoil waits with it: the gun comes down, then goes off)
      S.flashHold = S.boreDot < FLASH_OFF; S.holdT = 0;
      if (!S.flashHold) kick();
    if (!S.product) { // the flame: a new roll and shape
      const fm = flame.mesh, sz = cur.flash.size * (liveDef().suppressed ? 0.35 : 1) * rand.range(0.85, 1.15);
      fm.position.copy(cur.model.anchors.muzzle); fm.rotation.set(0, 0, rand.range(0, 6.283)); fm.scale.set(sz * 0.62, sz * 0.62, sz);
      flame.u.y = rand.next();
    }
      if (a.follow === 'pump') { const p = S.pump; p.on = true; p.t = 0; p.dur = sh.dur; p.cased = false; }
      return sh.dur;
    }
    if (name === 'empty') { // the slide or bolt stays back on the empty magazine
      if (!S.locked) { S.locked = true; if (!S.shot.on) S.lockT = 0; }
      S.rounds = 0;
      return RIG.FIXED.empty;
    }
    if (name === 'pump') { const p = S.pump; p.on = true; p.t = 0; p.dur = durations.pump / RIG.PUMP.fwd1; p.cased = !(opts && opts.eject); return durations.pump; }
    if (name === 'reload' || name === 'shellIn') {
      if (a.clip === 'shell') {
        const plan = RIG.reloadPlan(liveDef(), reloadScale());
        const empty = S.rounds <= 0;
        if (anim.on) blendFrom(0.12);
        start('shell', Infinity);
        anim.per = plan.per; anim.start = plan.start; anim.rack = empty;
        anim.count = name === 'shellIn' ? 1 : (opts && opts.shells) || 0;
        return plan.per;
      }
      const plan = RIG.reloadPlan(liveDef(), reloadScale());
      if (anim.on) blendFrom(0.12);
      return start('reload', RIG.CLOCK, plan.rate);
    }
    if (name === 'draw') {
      // a draw over a running reload is a cancel (firing.js has no other word for it): settle, don't re-draw
      if (anim.on && (anim.name === 'reload' || anim.name === 'shell')) return settle(0.22);
      if (anim.on) blendFrom(0.12);
      S.shot.on = false; S.pump.on = false;
      const d = durations.draw;
      anim.drawK = 0.5 / d;
      return start('draw', d);
    }
    if (name === 'swing' || name === 'throw' || name === 'inspect') {
      if (anim.on) blendFrom(0.12);
      return start(name, name === 'inspect' ? RIG.FIXED.inspect : durations[name]);
    }
    return 0;
  }

  // the shot's recoil, on the springs
  function kick() {
    const kk = cur.pose.kick, ads = 1 - 0.4 * S.ads;
    const k = rand.range(0.86, 1.14);
    rec.z.kick(kk[0] * k * ads); rec.p.kick(kk[1] * k * ads); rec.up.kick(kk[2] * k * ads);
    rec.y.kick(rand.range(-kk[3], kk[3]) * ads); rec.r.kick(rand.range(-kk[4], kk[4]) * ads);
  }

  function fire(evt) {
    if (anim[evt]) return;
    anim[evt] = true;
    if (evt === 'magIn') S.rounds = 1;
    if (evt === 'slideRelease') { S.locked = false; S.relT = 0; rec.p.kick(-1.5); rec.z.kick(-0.25); }
    payload.anim = anim.name;
    events.emit(evt, payload);
  }

  function stepAnim(dt) {
    if (!anim.on) return;
    const t0 = anim.t;
    anim.t = Math.min(anim.dur, anim.t + dt * anim.k);
    if (anim.name === 'reload') {
      const c = cur.clip;
      if (anim.t >= M.magOut) fire('magOut');
      if (anim.t >= M.magIn) fire('magIn');
      if (anim.t >= M.magIn && t0 < M.magIn) { rec.up.kick(c.knock[0]); rec.p.kick(c.knock[1]); } // the palm's blow
      if (anim.t >= M.slideRelease && (anim.wasLocked || c.release === 'always')) fire('slideRelease');
    } else if (anim.name === 'shell') {
      const tt = anim.t - anim.start, i = Math.floor(tt / anim.per);
      if (tt >= (anim.shells + RIG.SHELL_IN) * anim.per) { // this period's shell is home
        anim.shells++; S.rounds = 1;
        rec.up.kick(0.06); rec.p.kick(0.25);
        payload.anim = 'reload'; events.emit('shellIn', payload);
      }
      // at the end of each period: another shell, or done
      if (i >= 1 && i >= anim.shells && tt >= i * anim.per) {
        const w = weaponNow();
        const more = anim.count ? anim.shells < anim.count : !!(w && w.reloading);
        if (!more) {
          const rack = anim.rack;
          settle(RIG.SHELL_OUT);
          if (rack) play('pump'); // chamber the first shell of an empty gun
        }
      }
    } else if (anim.name === 'swap' && !anim.swapped && anim.t >= RIG.SWAP_LOWER) {
      anim.swapped = true;
      blendFrom(0.1); // the two weapons' lowered poses differ
      use(anim.next);
    }
    if (anim.on && anim.t >= anim.dur) {
      const was = anim.name;
      anim.on = false;
      if (!anim.done) { anim.done = true; payload.anim = was === 'settle' ? 'reload' : was; events.emit('done', payload); }
    }
  }

  // ---- slide or bolt, hammer, trigger, cylinder, pump ----
  function stepAction(dt) {
    const sh = S.shot, m = cur.model, A = cur.act;
    const lockAt = m.lock || 0;
    let s = S.locked ? lockAt : 0;
    S.trigger = 0;
    if (sh.on) {
      sh.t += dt;
      const t = sh.t;
      // the action's cycle is a fixed fraction of the shot period: back in 15 %, home by 40 %
      const back = sh.dur * 0.147, cycle = sh.dur * 0.4;
      if (A.cycles) {
        if (t < back) s = m.travel * ease.out(t / back);
        else s = Math.max(S.locked ? lockAt : 0, m.travel * (1 - ease.in(clamp01((t - back) / (cycle - back)))));
        S.hammer = t < 0.004 ? 1 - t / 0.004 : Math.max(S.hammer, clamp01(s / 0.015));
        if (t >= cycle) S.hammer = 1;
      } else if (A.follow === 'index') {
        // the hammer falls, then comes back as the cylinder turns the next chamber up
        const u = smoother((t / sh.dur - 0.3) / 0.32);
        S.hammer = t < 0.004 ? 1 - t / 0.004 : u;
        S.cyl = sh.cyl0 + u;
      } else S.hammer = 1;
      S.trigger = t < sh.dur / 3 ? 1 : 1 - smoother((t - sh.dur / 3) / (sh.dur * 0.6));
      if (!sh.cased && t >= back * 0.6) { sh.cased = true; throwCase(false); }
      if (t >= sh.dur) { sh.on = false; if (A.follow === 'index') S.cyl = sh.cyl0 + 1; }
    } else if (S.locked && S.lockT < 1) {
      S.lockT = Math.min(1, S.lockT + dt / 0.05);
      s = lockAt * ease.out(S.lockT);
    } else if (!S.locked && S.relT < 1) {
      S.relT = Math.min(1, S.relT + dt / 0.035);
      s = lockAt * (1 - ease.in3(S.relT));
    }
    if (S.locked && C.pull > 0 && !sh.on) s = lockAt + (m.travel - lockAt) * C.pull; // drawn back by the support hand
    S.slide = s;
    const p = S.pump;
    if (p.on) {
      p.t += dt;
      const u = p.t / p.dur;
      p.v = RIG.pumpAt(u);
      if (!p.cased && u >= RIG.PUMP.eject) { p.cased = true; launchOwn(0.75, 0.55); }
      if (u >= 1) { p.on = false; p.v = 0; }
    } else p.v = 0;
  }

  // ---- the spent case ----
  // The viewmodel draws the case itself for its first moments: real brass, lit by the flash, sorted
  // against the gun. It flies the launch the fx particle was given (fx/casing.js lastLaunch), so
  // the particle is behind it all the way and carries on when the mesh goes.
  const _ep = V(), _ed = V(), _fire = { eject: _ep, dir: _ed, pos: _ep, weapon: '' };
  function throwCase(fromFx) {
    if (S.product) return;
    if (!fromFx && S.shot.viaFx && G.fx && typeof G.fx.ejectCasing === 'function') { // staged: ask fx for the particle it would have thrown
      _fire.weapon = cur.id;
      ejectWorld(_ep); G.camera.getWorldDirection(_ed);
      G.fx.ejectCasing(_fire);
    }
    if (lastLaunch[6] !== S.launchSeen) {
      S.launchSeen = lastLaunch[6];
      startCase(_v.set(lastLaunch[0], lastLaunch[1], lastLaunch[2]), _v2.set(lastLaunch[3], lastLaunch[4], lastLaunch[5]), CASE_LIFE);
    } else launchOwn(1, 1);
  }
  // no fx particle to follow (no fx, or a hull thrown by the pump): the viewmodel's own launch
  function launchOwn(side, up) {
    if (S.product || !cur.model.casing) return;
    const e = G.camera.matrixWorld.elements;
    const r = rand.range(1.1, 1.8) * side, u = rand.range(1.4, 2.1) * up, b = rand.range(0.2, 0.6);
    _v2.set(e[0] * r + e[4] * u + e[8] * b, e[1] * r + e[5] * u + e[9] * b, e[2] * r + e[6] * u + e[10] * b);
    const pv = G.player && !G.player.stub && G.player.vel;
    if (pv) { _v2.x += pv[0] || 0; _v2.y += pv[1] || 0; _v2.z += pv[2] || 0; }
    startCase(ejectWorld(_v), _v2, side < 1 ? 0.6 : CASE_LIFE);
  }
  function startCase(p, v, life) {
    const pool = cur.model.casings;
    if (!pool || S.lite) return;
    // a free slot, or the oldest case in the air
    let n = 0, age = -1;
    for (let i = 0; i < CASE_POOL; i++) { const c = CASES[i]; if (!c.on) { n = i; break; } if (c.t / c.life > age) { age = c.t / c.life; n = i; } }
    const K = CASES[n];
    if (K.obj) K.obj.visible = false;
    K.on = true; K.t = 0; K.life = life; K.obj = pool[n]; K.p0.copy(p); K.v0.copy(v);
    K.q0.setFromRotationMatrix(gunM);
    K.axis.set(rand.range(-0.4, 0.4), 1, rand.range(-0.5, 0.5)).normalize();
    K.spin = (cur.model.casingSpin || 30) * (rand.next() < 0.5 ? -1 : 1) * rand.range(0.7, 1.2);
  }
  function stepCase(dt, k) {
    for (let i = 0; i < CASE_POOL; i++) {
      const K = CASES[i];
      if (!K.on) continue;
      K.t += dt;
      if (K.t > K.life || S.product) { K.on = false; K.obj.visible = false; continue; }
      const t = K.t;
      _v.copy(K.p0).addScaledVector(K.v0, t); _v.y -= 0.5 * GRAVITY * t * t;
      _v.applyMatrix4(G.camera.matrixWorldInverse);
      _v.x /= k; _v.y /= k;
      K.obj.position.copy(_v);
      K.obj.quaternion.copy(K.q0).multiply(_q.setFromAxisAngle(K.axis, K.spin * t));
      K.obj.visible = true;
    }
  }
  function clearCases() { for (let i = 0; i < CASE_POOL; i++) { const K = CASES[i]; if (K.on) { K.on = false; K.obj.visible = false; } } }

  // ---- sway and bob from the player's motion ----
  function stepMotion(dt) {
    const p = G.player && !G.player.stub ? G.player : null;
    const calm = 1 - 0.78 * S.ads;
    let speed = 0, phase = 0, sprinting = false, strafe = 0;
    if (S.fakeDist !== null) { speed = S.fakeSprint ? 6.5 : 4.2; sprinting = S.fakeSprint; phase = (S.fakeDist * Math.PI) / (sprinting ? 2.3 : 1.9); }
    else if (p) {
      speed = p.onGround ? Math.hypot(p.vel[0], p.vel[2]) : 0;
      sprinting = !!p.sprinting;
      phase = ((p.distance || 0) * Math.PI) / (sprinting ? 2.3 : 1.9);
      strafe = p.vel[0] * Math.cos(p.yaw) - p.vel[2] * Math.sin(p.yaw);
      // landing: the gun keeps going down for a moment, then comes back
      if (p.onGround && !S.wasGround) rec.land.kick(Math.min(0.9, -S.lastVy * 0.12));
      S.wasGround = p.onGround; S.lastVy = p.vel[1];
      // look lag: the gun trails the view when it turns
      if (S.lastYaw !== null && dt > 0) {
        let dy = p.yaw - S.lastYaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        const ry = Math.max(-6, Math.min(6, dy / dt)), rp = Math.max(-6, Math.min(6, (p.pitch - S.lastPitch) / dt));
        S.sway.yaw = lerp(S.sway.yaw, -ry * 0.012, 1 - Math.exp(-14 * dt));
        S.sway.pitch = lerp(S.sway.pitch, -rp * 0.01, 1 - Math.exp(-14 * dt));
      }
      S.lastYaw = p.yaw; S.lastPitch = p.pitch;
    }
    const sp = S.frozen ? (sprinting ? 1 : 0) : lerp(S.sprint, sprinting && speed > 4.8 && !anim.on ? 1 : 0, 1 - Math.exp(-9 * dt));
    S.sprint = sp * (1 - S.ads);
    const amt = Math.min(1, speed / 4.2);
    const A = lerp(1, 2.6, S.sprint) * amt * calm;
    // a figure of eight: one dip per step, one sway per stride, the roll leading the sway
    const tx = Math.sin(phase) * 0.0042 * A, ty = -Math.abs(Math.sin(phase)) * 0.0052 * A + 0.0026 * A;
    const troll = Math.sin(phase + 0.5) * 0.012 * A + strafe * -0.006 * calm, tpitch = Math.cos(phase * 2) * 0.006 * A;
    const k = S.frozen ? 1 : 1 - Math.exp(-13 * dt); // the gun lags the head
    S.bob.x = lerp(S.bob.x, tx, k); S.bob.y = lerp(S.bob.y, ty, k);
    S.bob.roll = lerp(S.bob.roll, troll, k); S.bob.pitch = lerp(S.bob.pitch, tpitch, k);
  }

  const lerpArr = (p, q, t) => { _la[0] = lerp(p[0], q[0], t); _la[1] = lerp(p[1], q[1], t); _la[2] = lerp(p[2], q[2], t); return _la; };

  // ---- compose ----
  function compose() {
    const a = S.ads, sp = S.sprint, pose = cur.pose, model = cur.model, grip = model.anchors.grip;
    // breathing: slow, two frequencies so it never loops visibly
    const bt = S.time, calm = 1 - 0.8 * a;
    const brY = (Math.sin(bt * 1.7) * 0.0011 + Math.sin(bt * 0.83 + 1) * 0.0007) * calm;
    const brX = Math.sin(bt * 0.61 + 2) * 0.0009 * calm;
    const brP = Math.sin(bt * 1.7 + 0.9) * 0.0035 * calm, brR = Math.sin(bt * 0.47) * 0.004 * calm;
    for (let i = 0; i < 3; i++) {
      const base = lerp(lerp(pose.hip.pos[i], pose.sprint.pos[i], sp), cur.adsPos[i], a);
      const baseR = lerp(lerp(pose.hip.rot[i], pose.sprint.rot[i], sp), pose.adsRot ? pose.adsRot[i] : 0, a);
      HP[i] = base; HR[i] = baseR;
      P[i] = lerp(base, C.pos[i], C.mix) + C.add[i];
      R[i] = lerp(baseR, C.rot[i], C.mix) + C.addRot[i];
    }
    // the blend layer: what the last frame drew, eased out over whatever is playing now
    let bw = 0;
    if (BL.on) {
      if (BL.pending) { BL.pending = false; BL.t = Math.min(S.dt, BL.dur); for (let i = 0; i < 3; i++) { BL.pos[i] += last.pos[i] - P[i]; BL.rot[i] += last.rot[i] - R[i]; } } // (it moves on its first frame)
      bw = BL.w = 1 - smoother(BL.t / BL.dur);
      for (let i = 0; i < 3; i++) { P[i] += BL.pos[i] * bw; R[i] += BL.rot[i] * bw; }
    }
    for (let i = 0; i < 3; i++) { last.pos[i] = P[i]; last.rot[i] = R[i]; }
    // how far the bore is from where the held pose points it (roll does not turn the bore)
    S.boreDot = Math.cos(R[0]) * Math.cos(HR[0]) * Math.cos(R[1] - HR[1]) + Math.sin(R[0]) * Math.sin(HR[0]);
    if (S.flashHold && S.boreDot >= FLASH_OFF && bw < 0.2) { S.flashHold = false; kick(); } // on aim, and all but still
    const rz = rec.z.x, land = rec.land.x;
    P[0] += S.bob.x + brX + S.sway.yaw * 0.25;
    P[1] += S.bob.y + brY + rec.up.x - land * 0.03 - S.sway.pitch * 0.2;
    P[2] += rz;
    R[0] += S.bob.pitch + brP + rec.p.x + S.sway.pitch - land * 0.12;
    R[1] += rec.y.x * 0.012 + S.sway.yaw;
    R[2] += S.bob.roll + brR + rec.r.x * 0.012 + S.sway.yaw * 0.6;
    // rotate about the grip, so the muzzle rises and the hands stay put
    _e.set(R[0], R[1], R[2], 'YXZ');
    gunM.makeTranslation(P[0] + grip.x, P[1] + grip.y, P[2] + grip.z)
      .multiply(_m.makeRotationFromEuler(_e))
      .multiply(_m.makeTranslation(-grip.x, -grip.y, -grip.z));
    gunInv.copy(gunM).invert();
    gun.matrix.copy(gunM);
    gun.matrixWorldNeedsUpdate = true;

    // ---- moving parts ----
    const st = model.state, lockAt = model.lock || 0;
    st.slide = S.slide; st.trigger = S.trigger; st.hammer = S.hammer; st.magRelease = C.magRel;
    st.stop = S.locked && lockAt > 0 && S.slide >= lockAt - 0.002 ? 1 : 0;
    st.magD = Math.max(C.magD, BL.magD * bw); st.pump = S.pump.v; st.cyl = S.cyl;
    last.magD = st.magD;
    // a clip's own tracks (crane, rod, cover): written by the clip while it plays; when it stops,
    // for whatever reason, each eases home from its last value
    if (anim.on && anim.name === 'reload') { for (let i = 0; i < cur.tracks.length; i++) cur.tv[i] = st[cur.tracks[i]]; cur.trT = 0; }
    else if (cur.tracks.length) { const w = 1 - smoother(cur.trT / TRACK_EASE); for (let i = 0; i < cur.tracks.length; i++) st[cur.tracks[i]] = cur.tv[i] * w; }
    model.set();
    if (model.adsHide) for (let i = 0; i < model.adsHide.length; i++) model.adsHide[i].visible = a < 0.35;
    arms.right.group.visible = !(model.adsHideHand && a >= 0.35);
    const mag = model.mag, spare = model.spare, reloading = anim.on && anim.name === 'reload';
    if (!cur.shell) mag.visible = C.magShown;
    mag.userData.setRounds(C.magD > 0 ? 0 : S.rounds);
    if (reloading && C.magFree >= 0) {
      // clear of the well: it keeps the speed it left with and falls, tumbling, in view space
      if (!anim.dropped) {
        anim.dropped = true;
        drop.t = 0;
        drop.m.copy(gunM).multiply(_m.compose(mag.position, mag.quaternion, _s));
        drop.vel.copy(model.magAxis).transformDirection(gunM).multiplyScalar(cur.clip.drop * (M.magFree - M.magOut));
        drop.axis.set(0.8, 0.1, -0.6).normalize();
      }
      const h = C.magFree - drop.t;
      drop.t = C.magFree;
      if (h > 0) {
        drop.vel.y -= GRAVITY * h;
        _v.setFromMatrixPosition(drop.m).addScaledVector(drop.vel, h);
        _m.makeRotationAxis(drop.axis, 5.5 * h);
        drop.m.setPosition(0, 0, 0).premultiply(_m).setPosition(_v);
      }
      _m2.copy(gunInv).multiply(drop.m).decompose(mag.position, mag.quaternion, _s);
    }
    if (model.scatter) model.scatter(reloading ? C.magFree : -1);

    // ---- hands ----
    const g = cur.hands;
    const kR = rec.z.x * 0.35;
    _v.copy(g.right.pos).applyMatrix4(gunM);
    _q.setFromRotationMatrix(gunM).multiply(g.right.quat);
    const eR = lerpArr(pose.elbow.right, pose.elbowAds.right, a);
    arms.right.place(_v, _q, _v2.set(eR[0] + P[0] * 0.5, eR[1] + P[1] * 0.4, eR[2] + kR + sp * 0.05));
    lerpPose(g.rGrip, g.rFire, S.trigger, poseR);
    if (C.thumb) { poseR[POSE_AT.thumb + 4] += 0.3 * C.thumb; poseR[POSE_AT.thumb + 3] += 0.18 * C.thumb; poseR[POSE_AT.thumb] += 0.1 * C.thumb; }
    arms.right.setPose(poseR);

    // support hand: on the gun (riding the forend, if the model has one), on a free path, or carrying
    onPos.copy(g.left.pos);
    if (model.supportShift) onPos.add(model.supportShift());
    onPos.applyMatrix4(gunM);
    onQuat.setFromRotationMatrix(gunM).multiply(g.left.quat);
    lp.copy(onPos); lq.copy(onQuat);
    spare.visible = false;
    let contactL = C.leftOn;
    if (S.study) {
      lp.copy(S.study.pos).applyMatrix4(gunM); lq.setFromRotationMatrix(gunM).multiply(S.study.quat);
      contactL = 0;
    } else if (C.hand !== HAND.none) {
      // carried magazine -> hand: hand = gun * magazine(d) * inverse(magazine in hand)
      const d = Math.max(0, C.spareD), ax = model.magAxis;
      _m.copy(model.magRest); _m.elements[12] += ax.x * d; _m.elements[13] += ax.y * d; _m.elements[14] += ax.z * d;
      _m2.copy(gunM).multiply(_m).multiply(cur.magInHandInv);
      aPos.setFromMatrixPosition(_m2); aQuat.setFromRotationMatrix(_m2);
      const k = C.handK;
      if (C.hand === HAND.toPouch) { lp.lerpVectors(onPos, POUCH.pos, k); lq.copy(onQuat).slerp(POUCH.quat, k); }
      else if (C.hand === HAND.fromPouch) {
        const arc = Math.sin(k * Math.PI);
        lp.lerpVectors(POUCH.pos, aPos, k); lp.x -= arc * 0.05; lp.z += arc * 0.03;
        lq.copy(POUCH.quat).slerp(aQuat, smoother(k * 1.25));
      } else if (C.hand === HAND.atSpare) { lp.copy(aPos); lq.copy(aQuat); }
      else if (C.hand === HAND.pouchLoop) { lp.lerpVectors(aPos, POUCH.pos, k); lq.copy(aQuat).slerp(POUCH.quat, k); }
      else if (C.hand >= HAND.toCharge) {
        // on the charging handle: the support grip, moved so its hold point is the handle (drawn back with it)
        const L = model.hold.left.at;
        _v.copy(g.left.pos); _v.x += model.charge.x - L[0] * 0.001; _v.y += model.charge.y - L[1] * 0.001;
        _v.z += model.charge.z - L[2] * 0.001 + (model.lock || 0) + (model.travel - (model.lock || 0)) * C.pull;
        _v.applyMatrix4(gunM);
        if (C.hand === HAND.toCharge) { lp.lerpVectors(aPos, _v, k); lp.x -= Math.sin(k * Math.PI) * 0.03; lq.copy(aQuat).slerp(onQuat, k); }
        else if (C.hand === HAND.atCharge) { lp.copy(_v); lq.copy(onQuat); }
        else { lp.lerpVectors(_v, onPos, k); lp.x -= Math.sin(k * Math.PI) * 0.02; lq.copy(onQuat); }
      } else { lp.lerpVectors(aPos, onPos, k); lp.y -= Math.sin(k * Math.PI) * 0.03; lq.copy(aQuat).slerp(onQuat, k); }
      if (C.spareOn) {
        spare.visible = true;
        _m.makeRotationFromQuaternion(lq).setPosition(lp).multiply(model.magInHand);
        _m2.copy(gunInv).multiply(_m).decompose(spare.position, spare.quaternion, _s);
        spare.userData.setRounds(1);
      }
    } else if (C.leftOn < 1) {
      lp.lerpVectors(leftFree.pos, onPos, C.leftOn);
      lq.copy(leftFree.quat).slerp(onQuat, C.leftOn);
    }
    if (bw > 0 && !S.study) { lp.lerp(BL.lp, bw); lq.slerp(BL.lq, bw); contactL *= 1 - bw; }
    last.lp.copy(lp); last.lq.copy(lq);
    for (let i = 0; i < propNames.length; i++) {
      const o = props[propNames[i]], on = C.prop === propNames[i] && (!S.product || S.product.hands); // (a product shot with the hands on shows what they hold)
      o.visible = on;
      if (on) { o.matrix.makeRotationFromQuaternion(lq).setPosition(lp); o.matrixWorldNeedsUpdate = true; }
    }
    const eL = lerpArr(pose.elbow.left, pose.elbowAds.left, a);
    arms.left.place(lp, lq, _v2.set(eL[0] + lp.x * 0.6, eL[1] + Math.min(0, lp.y + 0.1) * 0.5, eL[2] + lp.z * 0.25 + kR));
    if (S.study) poseL.set(S.study.pose);
    else {
      if (C.leftPose && C.leftMix > 0) lerpPose(g.lGrip, C.leftPose, C.leftMix, poseL); else poseL.set(g.lGrip);
      if (C.leftPoseB && C.leftMixB > 0) lerpPose(poseL, C.leftPoseB, C.leftMixB, poseL);
      if (bw > 0) lerpPose(poseL, BL.pose, bw, poseL);
    }
    last.pose.set(poseL); last.valid = true;
    arms.left.setPose(poseL);
    // contact darkening follows the support hand off the gun (it was baked in the pistol's grip)
    arms.materials.left.contact.value = contactL * contactL * (model === pistol ? 1 : 0.55);
    occ.uVmOccN.value = arms.root.visible && !S.lite ? arms.occluders(gunInv, occ.uVmOccA.value, occ.uVmOccB.value) : 0;

    // ---- the weapon's own muzzle flash, and the world's flash light to ignore ----
    const fl = S.flashT < RIG.FLASH_TIME && !S.flashHold ? S.flashK * (1 - (S.flashT / RIG.FLASH_TIME) ** 2) : 0;
    vm.uVmFlash.value.set(S.flashRGB[0], S.flashRGB[1], S.flashRGB[2], S.product ? 0 : fl);
    vm.uVmFlashFall.value = cur.flash.fall;
    // the upgraded finish, and the front that draws it on
    const mo = S.morph, up = vm.uVmUp.value;
    up.x = cur.upgraded ? 1 : 0; up.y = S.time % 1000; up.z = 1e3; up.w = 0;
    if (mo.on && cur.upgraded) {
      const u = clamp01(mo.t / MORPH_SWEEP);
      up.z = u < 1 ? lerp(MORPH_NEAR, MORPH_FAR, u * u * (3 - 2 * u)) : 1e3;
      up.w = u < 1 ? 1 : 1 - smoother((mo.t - MORPH_SWEEP) / (MORPH - MORPH_SWEEP));
      if (fl <= 0 && !S.product) { // the front lights the hands and the gun as it passes, in the weapon's colour
        const A = vm.uVmUpA.value, B = vm.uVmUpB.value;
        vm.uVmFlash.value.set(0.4 + A.x + B.x, 0.4 + A.y + B.y, 0.4 + A.z + B.z, 0.3 * up.w);
        vm.uVmFlashFall.value = 16;
        vm.uVmFlashPos.value.lerpVectors(model.anchors.grip, model.anchors.muzzle, u).applyMatrix4(gunM).add(_v.set(FLASH_AT[0], FLASH_AT[1], FLASH_AT[2]));
      }
    }
    flame.mesh.visible = fl > 0 && S.visible;
    flame.u.x = fl > 0 ? 1 - S.flashT / RIG.FLASH_TIME : 0; flame.u.z = S.flashT / RIG.FLASH_TIME;
    if (fl > 0) vm.uVmFlashPos.value.copy(model.anchors.muzzle).applyMatrix4(gunM).add(_v.set(FLASH_AT[0], FLASH_AT[1], FLASH_AT[2]));
    const ml = G.lights && G.lights.muzzle;
    if (fl > 0 && ml && ml.isObject3D && ml.intensity > 0) { ml.updateWorldMatrix(true, false); vm.uVmMuzzleL.value.setFromMatrixPosition(ml.matrixWorld).applyMatrix4(G.camera.matrixWorldInverse); }
    else vm.uVmMuzzleL.value.set(0, 1e6, 0);
  }

  function update(dt) {
    if (!(dt >= 0)) dt = 0;
    const cam = G.camera;
    // the arsenal can hold a weapon the view was never told about (a loadout made before the first switch)
    const held = G.weapon && !G.weapon.stub && G.weapon.id;
    if (held && held !== cur.id && !S.frozen && !G.params.shot?.startsWith?.('weapontest') && !(anim.on && anim.name === 'swap')) { use(held); S.rounds = G.weapon.ammo ? G.weapon.ammo.mag : 1; }
    S.dt = S.frozen ? 0 : dt;
    if (!S.frozen) {
      S.time += dt;
      if (S.flashHold) { S.holdT += dt; if (S.holdT > FLASH_WAIT) { S.flashHold = false; S.flashT = 1; } } else S.flashT += dt;
      cur.trT += dt;
      if (S.morph.on) { S.morph.t += dt; if (S.morph.t >= MORPH) S.morph.on = false; }
      if (BL.on && !BL.pending) { BL.t += dt; if (BL.t >= BL.dur) { BL.on = false; BL.pos.fill(0); BL.rot.fill(0); BL.magD = 0; } }
      stepAnim(dt);
      stepAction(dt);
      for (let i = 0; i < springs.length; i++) springs[i].step(dt);
      const d = S.adsTarget - S.adsLin;
      S.adsLin += Math.sign(d) * Math.min(Math.abs(d), dt / ADS_TIME);
    }
    resetChannels();
    if (anim.on) TL[anim.name](anim.t);
    S.ads = smoother(S.adsLin) * clamp01(C.adsMul);
    stepMotion(S.frozen ? 0 : dt);
    if (G.player && !G.player.stub) G.player.fovScale = lerp(1, liveDef().zoom || 0.8, S.ads);

    cam.updateMatrixWorld();
    const k = setProjection();
    compose();
    stepCase(S.frozen ? 0 : dt, k);
    if (S.product) {
      // product shots: the gun stays put at a point in the world and the camera orbits it
      root.matrixAutoUpdate = false;
      root.matrix.makeTranslation(S.product.pos[0], S.product.pos[1], S.product.pos[2]).multiply(gunInv);
      root.matrixWorldNeedsUpdate = true;
    } else {
      root.matrixAutoUpdate = true;
      root.position.copy(cam.position);
      root.quaternion.copy(cam.quaternion);
    }
    root.visible = S.visible;
  }

  // Model-space point -> the world point that the world camera draws at the same pixel and view
  // depth (the two FOVs differ, so the true position would not line up).
  function toWorld(local, o) {
    o.copy(local).applyMatrix4(gunM);
    if (S.product) return o.applyMatrix4(root.matrix);
    const k = setProjection();
    o.x *= k; o.y *= k;
    return o.applyMatrix4(G.camera.matrixWorld);
  }
  // The flash sprite is an ordinary world particle: it loses the depth test wherever it overlaps the
  // viewmodel on screen, so its anchor sits 30 mm ahead of the crown on the bore line. The case's
  // anchor is the ejection port itself (see the spent case, above). Pass a Vector3 to fill, or get a new one.
  // Asked for while the gun is turned away in a loading pose (a shot is about to interrupt it), the
  // answer is the muzzle of the held pose: where the gun will be when its flame shows.
  function muzzleWorld(o = V()) {
    if (S.boreDot >= FLASH_OFF || S.product) return toWorld(cur.muzzleFx, o);
    const g = cur.model.anchors.grip;
    _m2.makeTranslation(HP[0] + g.x, HP[1] + g.y, HP[2] + g.z).multiply(_m.makeRotationFromEuler(_e.set(HR[0], HR[1], HR[2], 'YXZ'))).multiply(_m.makeTranslation(-g.x, -g.y, -g.z));
    o.copy(cur.muzzleFx).applyMatrix4(_m2);
    const k = setProjection();
    o.x *= k; o.y *= k;
    return o.applyMatrix4(G.camera.matrixWorld);
  }
  // a model-space point on screen, through the viewmodel's own projection: x, y in -1..1 (tests, tuning)
  const screen = (local, o = V()) => o.copy(local).applyMatrix4(gunM).applyMatrix4(vm.uVmProj.value);
  const ejectWorld = (o = V()) => toWorld(cur.model.anchors.eject, o);

  // ---- switching ----
  function use(id) {
    const e = entry(id);
    if (e !== cur) {
      cur.model.root.visible = false; cur.model.spare.visible = false;
      clearCases();
      if (anim.on && anim.name !== 'swap') anim.on = false; // a clip belongs to the weapon it was started on
      cur = e;
      cur.model.root.visible = true;
      S.morph.on = false;
    }
    syncLook();
    S.shot.on = false; S.pump.on = false; S.pump.v = 0; S.locked = false; S.lockT = 1; S.relT = 1; S.slide = 0; S.hammer = 1; S.cyl = 0;
  }
  // Put the held weapon away and bring `id` up. Returns the seconds until it can fire.
  function setWeapon(id, o = {}) {
    const e = entry(id);
    applyLook(e, o);
    if (e === cur || !S.visible) { if (anim.on) blendFrom(0.12); anim.on = false; use(id); return play('draw'); }
    const d = RIG.durationsFor(e.def).draw;
    anim.drawK = 0.5 / d;
    if (anim.on) blendFrom(RIG.SWAP_LOWER); // mid-reload, mid-swing: lowered from where it is
    start('swap', RIG.SWAP_LOWER + d);
    anim.next = id;
    return RIG.SWAP_LOWER + d;
  }

  // Put the viewmodel in a named state at a time, deterministically (test stage, screenshots).
  // pose: hip | ads | sprint | walk | empty | fire | reload | emptyreload | inspect | draw | swing | throw | pump | swap | transform
  // (transform: an upgrade bought with the weapon in the hands, t seconds in; it leaves the weapon upgraded)
  // (swap: o.to = the weapon to switch to; o.ads: while aiming). For a shell weapon `reload` loads three.
  function stage(pose, t = 0, o = {}) {
    rand = G.rng.fork('weapon.view');
    S.frozen = false; anim.on = false; BL.on = false; BL.pos.fill(0); BL.rot.fill(0); BL.magD = 0; last.valid = false; cur.tv.fill(0); S.shot.on = false; S.pump.on = false; S.pump.v = 0; S.locked = false; S.lockT = 1; S.relT = 1; S.hammer = 1; S.cyl = 0;
    S.morph.on = false; S.flashHold = false; S.boreDot = 1; S.slide = 0; S.trigger = 0; S.adsTarget = 0; S.adsLin = 0; S.sprint = 0; S.fakeDist = null; S.fakeSprint = false; S.time = 0; S.rounds = 1; S.flashT = 1;
    clearCases();
    for (const s of springs) s.reset();
    S.bob.x = S.bob.y = S.bob.roll = S.bob.pitch = 0;
    const run = (secs) => { const n = Math.ceil(secs / (1 / 240) - 1e-6); for (let i = 0; i < n; i++) update(secs / n); };
    if (pose === 'ads' || o.ads) { S.adsTarget = 1; S.adsLin = 1; } // o.ads: any other pose, while aiming (the shot fired down the sights)
    if (pose === 'ads') { /* held */ }
    else if (pose === 'sprint' || pose === 'walk') { S.fakeSprint = pose === 'sprint'; S.fakeDist = t * (S.fakeSprint ? 6.5 : 4.2); S.sprint = S.fakeSprint ? 1 : 0; }
    else if (pose === 'empty') { play('fire', { last: true, casing: true }); play('empty'); run(Math.max(t, 0.2)); }
    else if (pose === 'emptyreload') { play('empty'); run(0.1); play('reload', { shells: 3 }); if (t > 0) run(t / anim.k); }
    else if (pose === 'fire') { play('fire', { casing: true }); if (t > 0) run(t); }
    else if (pose === 'reload') { play('reload', { shells: 3 }); if (t > 0) run(t / anim.k); }
    else if (pose === 'pump') { play('pump', { eject: true }); if (t > 0) run(t); }
    else if (pose === 'transform') { cur.upgraded = true; cur.model.finish(true); syncLook(); startMorph(); if (t > 0) run(t); }
    else if (pose === 'swap') { setWeapon(o.to || STAND_IN); if (t > 0) run(t); }
    else if (TL[pose]) { play(pose); if (t > 0) run(t / anim.k); }
    S.frozen = true;
    update(0);
  }

  // Tiers that cannot afford it (G.quality.viewDetail < 1 when a tier sets it; else the tiers that
  // skip the depth prepass, i.e. `mobile`) lose the stitching rows, the weave, the spent-case mesh and
  // the hands' contact darkening on the gun: about a fifth of the viewmodel's triangles and a shader loop.
  function applyQuality() {
    const q = G.quality || {};
    S.lite = (q.viewDetail ?? (q.depthPrepass === false ? 0 : 1)) < 1;
    weaveOn.value = S.lite ? 0 : 1;
    for (const arm of [arms.right, arms.left]) for (const m of arm.meshes) if (m.name === 'trim') m.visible = !S.lite;
  }
  applyQuality();
  if (G.quality && typeof G.quality.onChange === 'function') G.quality.onChange(applyQuality);

  const view = {
    setVisible(b) { S.visible = !!b; root.visible = S.visible; },
    play, setWeapon, refresh,
    setAds(a) { S.adsTarget = clamp01(Number(a) || 0); },
    setRounds(n) { S.rounds = n; if (n > 0 && S.locked && !anim.on) { S.locked = false; S.relT = 0; } }, // rounds in the magazine: shows or hides the top cartridge
    update(dt) { if (pending.length) while (buildNext()); update(dt); }, // the game is starting: nothing may be built during play
    muzzleWorld, ejectWorld, events, stage,
    release() { S.frozen = false; S.fakeDist = null; },
    get ads() { return S.ads; },
    get anim() { return anim.on ? (anim.name === 'shell' || anim.name === 'settle' ? 'reload' : anim.name === 'swap' ? 'draw' : anim.name) : null; },
    get locked() { return S.locked; },
    get busy() { return anim.on; },
    get weapon() { return cur.id; },
    get model() { return cur.model; },
    get upgraded() { return !!cur.upgraded; }, // the weapon in the hands wears the upgraded finish
    get morph() { return S.morph.on ? S.morph.t / MORPH : null; }, // 0..1 through the transformation, or null
    durations, durationOf,
    depthSlice: DEPTH_SLICE, // viewmodel pixels have raw depth below this
    // internals for the test stage
    pistol, arms, root, entry,
    use(id) { use(id); update(0); }, // switch at once, no animation
    get cfg() { return cur.pose; },
    // the pose the last frame drew, before recoil and sway (tests): gun position and rotation, the
    // support hand, the model's moving parts. Shared objects: read, do not keep.
    get probe() { return { pos: last.pos, rot: last.rot, left: last.lp, leftQuat: last.lq, state: cur.model.state, blend: BL.on ? BL.w : 0, flame: flame.mesh.visible, boreOff: Math.acos(Math.min(1, S.boreDot)) }; },
    screen,
    regrip(cfg) {
      if (cur.model === pistol) { arms.regrip(cfg); drawFirst(); applyQuality(); Object.assign(cur.hands, pistolHands()); }
      else Object.assign(cur.hands, arms.solveFor(cur.model, cfg));
    },
    setProduct(p) { S.product = p; vm.uVmOn.value = p ? 0 : 1; const st = cur.model.state; if ('explode' in st) st.explode = p ? p.explode || 0 : 0; cur.model.set(); arms.root.visible = p ? !!p.hands : true; },
    // hold the support hand off the gun in a named pose (hand studies): { pose, pos, quat } in model space, or null
    setStudy(s) { S.study = s; },
  };
  if (G.params.noweapon) view.setVisible(false);
  if (G.params.shot === 'weapontest') installWeaponTest(G, view);
  update(0);
  return view;
}

// roll the top away to show the port side, then over to show the roll marks, then back
const INSPECT_POS = [[0, [0.04, -0.03, -0.3]], [1.5, [0.04, -0.028, -0.3]], [2.1, [0.055, -0.02, -0.29]], [3.6, [0.055, -0.02, -0.29]]];
const INSPECT_ROT = [[0, [0.28, 0.72, 1.25]], [1.5, [0.26, 0.68, 1.3]], [2.1, [0.55, -0.3, -0.65], 'io'], [3.6, [0.52, -0.26, -0.7]]];
const INSPECT_MIX = [[0, 0], [0.5, 1, 'back'], [3.0, 1], [3.6, 0, 'io']];
