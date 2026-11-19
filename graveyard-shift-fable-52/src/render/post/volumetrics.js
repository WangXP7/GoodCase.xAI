// Volumetric light and fog ('volumetrics' slot; pass name 'vol'). Returns rgb = light scattered
// toward the camera, a = transmittance, at full resolution.
//
//   cones    Every lamp that matters to the view (G.lights.fixtures, best MAX_LAMPS by what reaches
//            the camera, off-screen ones dropped) is marched at reduced resolution. A spot shows as
//            a beam with an edge you can see plus a much fainter, wider skirt (lightlist.js BEAM);
//            each is marched only over the piece of the view ray inside it. Samples are placed
//            equi-angularly about the lamp, so they crowd where it is brightest. A cone thins toward
//            the ground it is aimed at (groundFall) and ends a little past it. Air outside every
//            lamp's skirt gets nothing: it stays black.
//   bound    However many cones a ray crosses, the air adds at most `cap` (light / (1 + light / cap)):
//            overlapping lamps cannot build a wall, and what stands behind a cone shows through it.
//            A cone the eye stands inside is faded (inside, nearFade): from within it is only a veil.
//   shadows  Each marched spot has a tile in a small atlas of depth maps drawn from the lamp, of
//            the static shadow casters only (meshes with castShadow, the level's shadow proxy).
//            Tiles are drawn once and again only if the lamp or the casters change, one per frame,
//            so every lamp's cone is cut by roofs, columns, pumps, poles and cars at no per-frame cost.
//            Moving bodies are not in the atlas: the two zombies nearest each lamp (G.zombies.list)
//            are tested in the march as upright capsules, so they darken the air behind them.
//            Points get a short halo, unshadowed.
//   rain     This pass draws no rain. Every streak, near or far, is a world-space instance in
//            fx/rain.js (the far ones live inside each outdoor lamp's beam); the air here only
//            carries a uniform scattering term for the rain (rainScatter).
//   fog      Exponential height fog (G.sky.fog), closed form, evaluated at full resolution in the
//            upsample. Nothing within fogStart, then it builds slowly (fogRamp): barely there at
//            20 m, clear from about 60 m, so only the treeline and the highway sit in it. Its
//            colour is the sky's horizon colour, cooled (fogTint).
// The medium the lamps light is that same fog, broken up by slowly drifting noise, plus a thin
// ground mist and a uniform term for the rain itself. Phase function: two Henyey-Greenstein lobes.
// Lamps marched: G.quality.volLamps (16 on every tier today; a lower number fades the last two it keeps).
// Resolution: 1 / G.quality.volFactor (1/2 on high, 1/4 on medium, low and mobile). The result is blurred across the interleaved
// jitter (depth-aware), then joint-bilateral upsampled. The jitter is fixed on screen and the
// shadow test is a ramp, not a step, so nothing crawls or boils when the camera moves.
//
// pass.uniforms (all { value }): scatter (gain on all lamp light), even (0..1: how far cones of weak
// and strong, low and tall lamps are pulled to the same brightness), cap (most light the air adds
// along one ray), nearFade (m: air closer to the eye than this counts less), inside (0..1: how much
// of a cone is dropped when the eye is inside it), groundFall (0..1: how much dimmer a cone is where
// it meets the ground), shadows (0 = ignore the atlas), bodies (0 = ignore zombies), rainScatter
// (1/m at rain 1), groundMist (1/m at the ground), wisp (0..1 noise depth),
// fogAmbient (gain on fog.color), fogTint (Vector3), fogStart (m), fogRamp (m), fogDensity (gain on
// fog.density for the veil), phase (Vector3: forward g, back g, back weight), maxDist (m).
// pass.beam = lightlist.js BEAM (the visible cone's shape).
import {
  WebGLRenderTarget, RGBAFormat, HalfFloatType, NearestFilter, LinearFilter, Data3DTexture, RedFormat,
  UnsignedByteType, RepeatWrapping, Vector2, Vector3, Vector4, Matrix4, Scene, Mesh, PerspectiveCamera, ShaderMaterial,
  DoubleSide, Color, Frustum, Sphere,
} from 'three';
import { lowRes, HALF_GLSL, UPSAMPLE_GLSL } from './halfres.js';
import { createLightList, readFog, FOG_GLSL, BEAM } from './lightlist.js';

const MAX_LAMPS = 16;
const BODIES = 2; // moving bodies (zombies) tested per lamp
const NOISE_SIZE = 32;
const TILE = 256; // one lamp's depth map, including a one-texel border that reads "nothing in the way"
const ATLAS_COLS = 8;
const ATLAS_ROWS = 4;
const SHADOW_NEAR = 0.3; // metres: the lamp's own housing is closer than this
const POINT_REACH = 4; // metres of halo a point lamp gets (they have no shadow, so keep it local)
const POINT_GAIN = 0.3; // a point's halo against a spot's cone
const EVEN_CANDELA = 300; // scene candela at which `even` changes nothing
const WEAK_CANDELA = 150; // below this a lamp is not evened all the way up
const EVEN_HEIGHT = 4.8; // metres above the ground at which `even` leaves a lamp's cone as it is
const RESCAN_FRAMES = 120; // frames between checks that the shadow casters are still the same

// Tileable smooth noise volume, two octaves, built once from the seeded stream.
function buildNoise(rng) {
  const n = NOISE_SIZE;
  const lattice = (cells) => {
    const v = new Float32Array(cells * cells * cells);
    for (let i = 0; i < v.length; i++) v[i] = rng.next();
    return (x, y, z) => {
      const s = (t) => t * t * (3 - 2 * t);
      const xi = Math.floor(x); const yi = Math.floor(y); const zi = Math.floor(z);
      const fx = s(x - xi); const fy = s(y - yi); const fz = s(z - zi);
      const at = (a, b, c) => v[(((c % cells) + cells) % cells) * cells * cells + (((b % cells) + cells) % cells) * cells + (((a % cells) + cells) % cells)];
      const lerp = (a, b, t) => a + (b - a) * t;
      return lerp(
        lerp(lerp(at(xi, yi, zi), at(xi + 1, yi, zi), fx), lerp(at(xi, yi + 1, zi), at(xi + 1, yi + 1, zi), fx), fy),
        lerp(lerp(at(xi, yi, zi + 1), at(xi + 1, yi, zi + 1), fx), lerp(at(xi, yi + 1, zi + 1), at(xi + 1, yi + 1, zi + 1), fx), fy), fz,
      );
    };
  };
  const a = lattice(4); const b = lattice(8);
  const data = new Uint8Array(n * n * n);
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const v = 0.65 * a((x / n) * 4, (y / n) * 4, (z / n) * 4) + 0.35 * b((x / n) * 8, (y / n) * 8, (z / n) * 8);
    data[(z * n + y) * n + x] = Math.max(0, Math.min(255, Math.round(v * 255)));
  }
  const tex = new Data3DTexture(data, n, n, n);
  tex.format = RedFormat; tex.type = UnsignedByteType;
  tex.minFilter = LinearFilter; tex.magFilter = LinearFilter;
  tex.wrapS = RepeatWrapping; tex.wrapT = RepeatWrapping; tex.wrapR = RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

// ---- static shadow atlas -----------------------------------------------------------------------
// One square depth map per lamp: red = distance along the lamp's axis / range, 1 where nothing is
// in the way. Drawn from copies of the casters' geometry in a private scene, so nobody else's
// objects or materials are touched. The tile frame is (bu, br, axis) with br = normalize(cross(ref,
// axis)), bu = cross(axis, br), ref = +x for near-vertical axes and +y otherwise; the march shader
// rebuilds the same frame from the axis.
function createShadowAtlas(G) {
  const target = new WebGLRenderTarget(TILE * ATLAS_COLS, TILE * ATLAS_ROWS, {
    format: RedFormat, type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: true,
  });
  target.texture.name = 'volShadowAtlas';
  target.scissorTest = true;
  const scene = new Scene();
  const cam = new PerspectiveCamera();
  cam.matrixAutoUpdate = false;
  const invRange = { value: 1 };
  const material = new ShaderMaterial({
    uniforms: { uInvRange: invRange },
    vertexShader: 'uniform float uInvRange; varying float vD; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vD = -mv.z * uInvRange; gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'varying float vD; void main() { gl_FragColor = vec4(vD, 0.0, 0.0, 1.0); }',
    side: DoubleSide,
  });
  const tiles = new Map(); // fixture -> tile
  const white = new Color(1, 1, 1);
  const saved = new Color();
  const axis = new Vector3(); const br = new Vector3(); const bu = new Vector3(); const back = new Vector3();
  let signature = -1;
  let sum = 0;
  const addCaster = (o) => { if (o.isMesh && o.castShadow && !o.isSkinnedMesh && !o.isInstancedMesh && o.geometry) sum += o.geometry.id * 31 + o.id + (o.visible ? 1 : 0); };
  const copyCaster = (o) => {
    if (!(o.isMesh && o.castShadow && !o.isSkinnedMesh && !o.isInstancedMesh && o.geometry && o.visible)) return;
    const m = new Mesh(o.geometry, material);
    m.matrixAutoUpdate = false; m.frustumCulled = false;
    m.matrix.copy(o.matrixWorld);
    scene.add(m);
  };

  return {
    texture: target.texture,
    // Call now and then: rebuilds the caster copies and marks every tile for redrawing if the set of casters changed.
    scan() {
      sum = 0;
      G.scene.traverse(addCaster);
      if (sum === signature) return;
      signature = sum;
      scene.clear();
      G.scene.updateMatrixWorld();
      G.scene.traverse(copyCaster);
      for (const t of tiles.values()) t.ready = false;
    },
    // The tile for a lamp (created on first sight), or null when the atlas is full. A lamp that moved gets redrawn.
    tile(l, tanHalf) {
      let t = tiles.get(l.ref);
      if (!t) {
        if (tiles.size >= ATLAS_COLS * ATLAS_ROWS) return null;
        const i = tiles.size;
        t = { x: (i % ATLAS_COLS) * TILE, y: Math.floor(i / ATLAS_COLS) * TILE, pos: new Vector3(1e9, 0, 0), dir: new Vector3(), tan: 0, range: 0, ready: false };
        tiles.set(l.ref, t);
      }
      if (t.pos.distanceToSquared(l.pos) > 1e-6 || t.dir.distanceToSquared(l.dir) > 1e-6 || Math.abs(t.tan - tanHalf) > 1e-4 || t.range !== l.range) {
        t.pos.copy(l.pos); t.dir.copy(l.dir); t.tan = tanHalf; t.range = l.range; t.ready = false;
      }
      return t;
    },
    draw(renderer, t) {
      axis.copy(t.dir).normalize();
      br.set(Math.abs(axis.y) > 0.9 ? 1 : 0, Math.abs(axis.y) > 0.9 ? 0 : 1, 0).cross(axis).normalize();
      bu.crossVectors(axis, br);
      // camera x = bu, y = br, looking along axis (its z is -axis)
      cam.matrix.makeBasis(bu, br, back.copy(axis).negate()).setPosition(t.pos);
      cam.matrixWorldNeedsUpdate = true;
      cam.fov = (2 * Math.atan(t.tan) * 180) / Math.PI; cam.aspect = 1; cam.near = SHADOW_NEAR; cam.far = Math.max(t.range * 1.05, SHADOW_NEAR + 1);
      cam.updateProjectionMatrix();
      invRange.value = 1 / t.range;
      renderer.getClearColor(saved);
      const alpha = renderer.getClearAlpha();
      target.scissor.set(t.x, t.y, TILE, TILE);
      target.viewport.set(t.x + 1, t.y + 1, TILE - 2, TILE - 2);
      renderer.setRenderTarget(target);
      renderer.setClearColor(white, 1);
      renderer.clear();
      renderer.render(scene, cam);
      renderer.setClearColor(saved, alpha);
      t.ready = true;
    },
    // Every tile has to be drawn again (the graphics context was lost and restored: the atlas is empty).
    invalidate() { for (const t of tiles.values()) t.ready = false; },
    dispose() { target.dispose(); material.dispose(); scene.clear(); tiles.clear(); },
  };
}

const MARCH_FRAG = HALF_GLSL + FOG_GLSL + /* glsl */ `
#define NL ${MAX_LAMPS}
const float TILE_IN = ${(TILE - 2).toFixed(1)};
const vec2 ATLAS_TEXEL = vec2(${(1 / (TILE * ATLAS_COLS)).toFixed(8)}, ${(1 / (TILE * ATLAS_ROWS)).toFixed(8)});
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
uniform highp sampler3D tNoise;
uniform sampler2D tAtlas;
uniform vec4 uLPos[NL];   // xyz, marched range
uniform vec4 uLDir[NL];   // axis, cos of the beam's edge (-2 for a point)
uniform vec4 uLCol[NL];   // colour * candela * gain, cos where the beam's soft edge starts
uniform vec4 uLTile[NL];  // atlas texel of the tile's inner corner (xy), tan(half its field of view), 1 = drawn
uniform vec4 uLExt[NL];   // cos of the skirt's edge, skirt gain, 1 / distance along the axis to the ground, -
uniform vec4 uLBody[NL * ${BODIES}]; // moving bodies near the lamp: feet xyz, height (0 = none)
uniform int uLCount;
uniform mat4 viewMatrixInv;
uniform vec3 uCamPos;
uniform float uMaxDist;
uniform float uRainScatter;
uniform float uGroundMist;
uniform float uWisp;
uniform vec3 uDrift;
uniform vec3 uPhase;
uniform ivec2 uSteps;      // beam, skirt
uniform float uNearFade;
uniform float uGroundFall; // 0..1: how much of a cone's brightness is gone where it meets the ground

float hg(float c, float g) {
  float g2 = g * g;
  float d = max(1.0 + g2 - 2.0 * g * c, 1e-4);
  return (1.0 - g2) / (12.5663706 * d * sqrt(d));
}
// c = cosine between the light's travel direction and the direction to the eye
float phase(float c) { return mix(hg(c, uPhase.x), hg(c, uPhase.y), uPhase.z); }

// scattering coefficient (1/m) the lamps see at p
float medium(vec3 p) {
  float n = texture(tNoise, p * vec3(0.055, 0.11, 0.055) + uDrift).r;
  float y = max(p.y, 0.0);
  float fog = uFogDensity * exp(-uFogFalloff * y) * (1.0 + uWisp * (n * 2.0 - 1.0));
  return fog + uGroundMist * exp(-y * 1.3) * smoothstep(0.35, 0.8, n) + uRainScatter;
}

// The piece of the ray (oc = origin - lamp) inside the lamp's range and inside a cone about its axis.
bool lampInterval(vec3 oc, vec3 rd, vec3 axis, float range, float cosO, float tMax, out float t0, out float t1) {
  float b = dot(oc, rd);
  float oo = dot(oc, oc);
  float h = b * b - (oo - range * range);
  if (h <= 0.0) return false;
  h = sqrt(h);
  t0 = max(-b - h, 0.0); t1 = min(-b + h, tMax);
  if (t1 <= t0) return false;
  if (cosO > -1.0) {
    // cone about the axis: (v.axis)^2 >= cos^2 |v|^2 on the side the lamp shines to
    float c2 = cosO * cosO;
    float da = dot(rd, axis); float oa = dot(oc, axis);
    float A = da * da - c2;
    float B = da * oa - c2 * b;
    float C = oa * oa - c2 * oo;
    if (abs(A) < 1e-5) A = A < 0.0 ? -1e-5 : 1e-5;
    float disc = B * B - A * C;
    if (disc <= 0.0) {
      if (A < 0.0) return false;
      if (da > 0.0) t0 = max(t0, -oa / da); else t1 = min(t1, -oa / da);
    } else {
      float s = sqrt(disc);
      float ta = (-B - s) / A; float tb = (-B + s) / A;
      float lo = min(ta, tb); float hi = max(ta, tb);
      if (A < 0.0) { // the ray crosses one nappe: inside between the roots
        if (oa + da * 0.5 * (lo + hi) <= 0.0) return false; // the mirror cone behind the lamp
        t0 = max(t0, lo); t1 = min(t1, hi);
      } else if (da > 0.0) t0 = max(t0, hi); // the ray runs down the cone: inside past the far root
      else t1 = min(t1, lo);
    }
  }
  return t1 > t0;
}

// 0 where an upright body (a zombie) stands between the lamp and the point L (both relative to the
// lamp): the nearest approach of the light's path to the body's axis, seen from above, and the
// height of the path there.
float bodyShade(vec3 L, vec4 body, vec3 lampPos) {
  if (body.w <= 0.0) return 1.0;
  vec2 c = body.xz - lampPos.xz;
  float s = clamp(dot(c, L.xz) / max(dot(L.xz, L.xz), 1e-4), 0.0, 1.0);
  float y = lampPos.y + L.y * s - body.y;
  float inside = (1.0 - smoothstep(0.2, 0.5, length(L.xz * s - c))) * smoothstep(-0.1, 0.1, y) * (1.0 - smoothstep(body.w - 0.12, body.w + 0.08, y));
  return 1.0 - inside;
}

// One cone of lamp i: light scattered toward the eye from the piece of the ray inside the cone
// (cosO = its edge, cosI = where the soft edge starts).
float lobe(int i, vec3 oc, vec3 rd, vec3 ro, float tMax, float jit, float cosO, float cosI, int steps, out float tMid) {
  vec4 P = uLPos[i]; vec4 Tl = uLTile[i]; vec4 E = uLExt[i];
  vec3 axis = uLDir[i].xyz;
  float t0; float t1;
  tMid = 0.0;
  if (!lampInterval(oc, rd, axis, P.w, cosO, tMax, t0, t1)) return 0.0;
  tMid = 0.5 * (t0 + t1);
  float delta = -dot(oc, rd);
  float D = max(sqrt(max(dot(oc, oc) - delta * delta, 0.0)), 0.25);
  float thA = atan((t0 - delta) / D); float thB = atan((t1 - delta) / D);
  vec3 br = normalize(cross(abs(axis.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0), axis));
  vec3 bu = cross(axis, br);
  float invR2 = 1.0 / (P.w * P.w);
  float sum = 0.0;
  for (int s = 0; s < steps; s++) {
    float u = (float(s) + fract(jit + float(s) * 0.61803399)) / float(steps);
    float t = delta + D * tan(mix(thA, thB, u));
    vec3 L = oc + rd * t;
    float d2 = max(dot(L, L), 1e-4);
    float inv = inversesqrt(d2);
    float along = dot(L, axis);
    float w = d2 * invR2;
    w = clamp(1.0 - w * w, 0.0, 1.0);
    float lit = w * w * (cosO > -1.0 ? smoothstep(cosO, cosI, along * inv) : 1.0);
    if (lit <= 0.0) continue;
    lit *= 1.0 - uGroundFall * smoothstep(0.05, 0.9, along * E.z); // a cone is brightest under the lamp and thins toward the ground
    if (Tl.w > 0.5) {
      vec2 q = vec2(dot(L, bu), dot(L, br)) / (along * Tl.z);
      if (abs(q.x) < 1.0 && abs(q.y) < 1.0) {
        float blocker = textureLod(tAtlas, (Tl.xy + (q * 0.5 + 0.5) * TILE_IN) * ATLAS_TEXEL, 0.0).r * P.w;
        lit *= 1.0 - smoothstep(0.05, 0.4, along - blocker); // a ramp, not a step: edges stay put under the jitter
      }
    }
    for (int k = 0; k < ${BODIES}; k++) lit *= bodyShade(L, uLBody[i * ${BODIES} + k], P.xyz);
    lit *= smoothstep(0.0, uNearFade, t) * phase(dot(L, -rd) * inv) * medium(ro + rd * t);
    sum += lit;
  }
  return sum * ((thB - thA) / (D * float(steps)));
}

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  float z = halfZ(c);
  vec3 dv = vec3((halfUv(c) * 2.0 - 1.0) * uInvProj, -1.0);
  float len = length(dv);
  vec3 rd = mat3(viewMatrixInv) * (dv / len);
  float tMax = min(z * len, uMaxDist);
  float jit = ign(gl_FragCoord.xy);
  vec3 acc = vec3(0.0);
  for (int i = 0; i < NL; i++) {
    if (i >= uLCount) break;
    vec3 oc = uCamPos - uLPos[i].xyz;
    vec4 E = uLExt[i];
    float j = fract(jit + float(i) * 0.527864);
    float tb; float ts = 0.0;
    float beam = lobe(i, oc, rd, uCamPos, tMax, j, uLDir[i].w, uLCol[i].w, uSteps.x, tb);
    float skirt = 0.0;
    if (E.y > 0.0) skirt = lobe(i, oc, rd, uCamPos, tMax, fract(j + 0.381966), E.x, mix(E.x, uLDir[i].w, 0.6), uSteps.y, ts);
    acc += uLCol[i].rgb * (beam * ((1.0 - E.y) * exp(-fogOpticalDepth(uCamPos.y, rd.y, tb))) + skirt * (E.y * exp(-fogOpticalDepth(uCamPos.y, rd.y, ts))));
  }
  outColor = vec4(acc, 1.0);
}`;

// Full resolution: upsample the marched light, bound it, and add the distance veil.
const UP_FRAG = (post) => post.glsl.depth + HALF_GLSL + UPSAMPLE_GLSL + FOG_GLSL + /* glsl */ `
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
uniform sampler2D tLight;
uniform vec3 uCamPos;
uniform vec3 uFogColor;
uniform float uFogStart;
uniform float uFogRamp;
uniform float uCap;
void main() {
  float z = linearDepth(vUv);
  vec4 lit = upsampleHalf(tLight, z);
  vec3 dv = vec3((vUv * 2.0 - 1.0) * uInvProj, -1.0);
  float len = length(dv);
  vec3 rd = mat3(viewMatrixInv) * (dv / len);
  float dist = z * len;
  // however many cones a ray crosses, the air never adds more than uCap: a glow over the scene, not a wall in front of it
  float lum = dot(lit.rgb, LUMA);
  vec3 light = lit.rgb / (1.0 + lum / uCap);
  // the veil: nothing near, building slowly, so only the treeline and the highway sit in it
  float far = max(dist - uFogStart, 0.0);
  float T = exp(-fogOpticalDepth(uCamPos.y, rd.y, far * far / (far + uFogRamp)));
  outColor = vec4(light + uFogColor * (1.0 - T), T);
}`;

export function createVolumetrics(G) {
  const uniforms = {
    scatter: { value: 2.2 }, even: { value: 1 }, cap: { value: 0.32 }, nearFade: { value: 7 }, inside: { value: 0.8 }, groundFall: { value: 0.88 },
    shadows: { value: 1 }, bodies: { value: 1 }, rainScatter: { value: 0.004 }, groundMist: { value: 0.002 }, wisp: { value: 0.4 },
    fogAmbient: { value: 0.75 }, fogTint: { value: new Vector3(0.8, 0.95, 1.3) }, fogStart: { value: 25 }, fogRamp: { value: 50 }, fogDensity: { value: 2.2 },
    phase: { value: new Vector3(0.45, -0.25, 0.35) }, maxDist: { value: 140 },
  };
  const fog = { density: 0, falloff: 0, r: 0, g: 0, b: 0 };
  const lamps = createLightList(G, MAX_LAMPS);
  const camPos = new Vector3();
  const tmp = new Vector3();
  const frustum = new Frustum();
  const sphere = new Sphere();
  const projScreen = new Matrix4();
  // the low-res buffer's uniforms, copied from whichever factor is in use
  const low = { tHalfDepth: { value: null }, uFullTexel: null, uInvProj: { value: new Vector2(1, 1) }, uLowScale: { value: 2 } };
  let buf = null; let marchMat; let upMat; let noise; let atlas;
  let width = 2; let height = 2; let sinceScan = RESCAN_FRAMES;
  const opts = { format: RGBAFormat, type: HalfFloatType, depthBuffer: false };
  const light = new WebGLRenderTarget(2, 2, { ...opts, minFilter: NearestFilter, magFilter: NearestFilter });
  const tmpT = new WebGLRenderTarget(2, 2, { ...opts, minFilter: NearestFilter, magFilter: NearestFilter });
  const out = new WebGLRenderTarget(2, 2, { ...opts, minFilter: LinearFilter, magFilter: LinearFilter });

  // how far a lamp's light is followed: a spot's cone ends a little past the ground it is aimed at
  const reach = (l) => {
    if (!l.spot) return Math.min(l.range, POINT_REACH);
    const toGround = l.dir.y < -0.05 ? (l.pos.y - l.groundY) / -l.dir.y : l.range;
    return Math.min(l.range, Math.max(toGround * 1.35, 3));
  };
  // what a lamp's cone adds on the way to the camera, roughly: ranks lamps for the marched list
  const lampScore = (l) => {
    sphere.center.copy(l.pos); sphere.radius = reach(l);
    if (!frustum.intersectsSphere(sphere)) return 0;
    const d = tmp.subVectors(l.pos, camPos).length();
    if (d > 220) return 0;
    return (Math.pow(l.intensity, 1 - 0.6 * uniforms.even.value) * (l.spot ? 1 : 0.25) * Math.exp(-fog.density * 0.7 * d)) / Math.max(d, 3);
  };
  // The upright bodies (zombies) nearest a lamp's axis, as capsules for the march to test.
  const BODY_HEIGHT = 1.8;
  function setBodies(l, range, base, arr) {
    for (let k = 0; k < BODIES; k++) arr[base + k].set(0, 0, 0, 0);
    const zs = G.zombies && G.zombies.list;
    if (!l.spot || !Array.isArray(zs) || uniforms.bodies.value <= 0) return;
    let d0 = range * range; let d1 = d0; // nearest two, by distance from the lamp
    for (let i = 0; i < zs.length; i++) {
      const z = zs[i];
      if (!z || z.alive === false || !z.pos) continue;
      const dx = z.pos.x - l.pos.x; const dy = (z.pos.y || 0) + 1 - l.pos.y; const dz = z.pos.z - l.pos.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < d0) { arr[base + 1].copy(arr[base]); d1 = d0; arr[base].set(z.pos.x, z.pos.y || 0, z.pos.z, BODY_HEIGHT); d0 = d; } else if (d < d1) { arr[base + 1].set(z.pos.x, z.pos.y || 0, z.pos.z, BODY_HEIGHT); d1 = d; }
    }
  }

  function useFactor(post, factor) {
    if (buf && buf.factor === factor) return;
    buf = lowRes(post, factor);
    buf.resize(width, height);
    light.setSize(buf.width, buf.height); tmpT.setSize(buf.width, buf.height);
  }
  const factorFor = (post) => (post.quality.volFactor === 2 ? 2 : 4);

  return {
    name: 'vol', uniforms, beam: BEAM,
    // the shader warm-up's dry frame (render/warm.js) draws nothing, so the shadow tiles it marked
    // ready are empty: they are drawn again, one a frame, as on the first frames
    afterDryFrame() { if (atlas) atlas.invalidate(); },
    init(post) {
      noise = buildNoise(G.rng.fork('volumetrics'));
      atlas = createShadowAtlas(G);
      if (G.events && G.events.on) G.events.on('renderer:restored', () => { atlas.invalidate(); post.snapExposure(); });
      low.uFullTexel = post.shared.texel;
      const vec4s = (n) => Array.from({ length: n }, () => new Vector4());
      marchMat = post.fsMaterial({
        fragmentShader: MARCH_FRAG,
        uniforms: {
          ...low, viewMatrixInv: post.shared.viewMatrixInv,
          tNoise: { value: noise }, tAtlas: { value: atlas.texture },
          uLPos: { value: vec4s(MAX_LAMPS) }, uLDir: { value: vec4s(MAX_LAMPS) }, uLCol: { value: vec4s(MAX_LAMPS) }, uLTile: { value: vec4s(MAX_LAMPS) },
          uLExt: { value: vec4s(MAX_LAMPS) }, uLBody: { value: vec4s(MAX_LAMPS * BODIES) },
          uLCount: { value: 0 },
          uCamPos: { value: camPos }, uMaxDist: uniforms.maxDist,
          uFogDensity: { value: 0 }, uFogFalloff: { value: 0 },
          uRainScatter: { value: 0 }, uGroundMist: uniforms.groundMist, uWisp: uniforms.wisp, uDrift: { value: new Vector3() }, uPhase: uniforms.phase,
          uSteps: { value: new Vector2(6, 4) }, uNearFade: uniforms.nearFade, uGroundFall: uniforms.groundFall,
        },
      });
      upMat = post.fsMaterial({
        fragmentShader: UP_FRAG(post),
        uniforms: {
          ...post.shared, ...low, tLight: { value: light.texture },
          uCamPos: { value: camPos }, uFogColor: { value: new Vector3() }, uFogDensity: { value: 0 }, uFogFalloff: { value: 0 },
          uFogStart: uniforms.fogStart, uFogRamp: uniforms.fogRamp, uCap: uniforms.cap,
        },
      });
    },
    resize(w, h) {
      width = w; height = h;
      out.setSize(w, h);
      if (buf) { buf.resize(w, h); light.setSize(buf.width, buf.height); tmpT.setSize(buf.width, buf.height); }
    },
    render(post) {
      const cam = post.camera;
      const u = marchMat.uniforms;
      useFactor(post, factorFor(post));
      camPos.setFromMatrixPosition(cam.matrixWorld);
      frustum.setFromProjectionMatrix(projScreen.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      readFog(G, fog);
      const gain = uniforms.scatter.value;

      if (++sinceScan >= RESCAN_FRAMES || post.snap) { sinceScan = 0; atlas.scan(); }
      const list = lamps.gather(lampScore);
      // The tier may march fewer lamps than the list holds (G.quality.volLamps; the list is best first).
      // The last two it keeps are turned down, so a lamp crossing the cut fades rather than pops.
      const cap = Math.min(MAX_LAMPS, Math.max(1, Math.floor(post.quality.volLamps || MAX_LAMPS)));
      const count = Math.min(list.count, cap);
      let drew = post.snap ? -1e9 : 0; // normally one tile a frame; all of them on a snap (first frame, teleport)
      for (let i = 0; i < count; i++) {
        const l = list.items[i];
        // even = 0: lamps scatter in proportion to their output; 1: every real lamp's cone is equally bright.
        // Small lamps (a dome light, a road flare) are not pulled all the way up: below WEAK_CANDELA they keep some of their weakness.
        const e = uniforms.even.value;
        let k = l.intensity * gain * Math.pow(EVEN_CANDELA / Math.max(l.intensity, 1e-3), e) * Math.pow(Math.min(1, l.intensity / WEAK_CANDELA), 0.75 * e) * (l.spot ? 1 : POINT_GAIN);
        if (cap < MAX_LAMPS && list.count > cap && i >= cap - 2) k *= (cap - i) / 3; // 2/3, then 1/3, then cut
        const range = reach(l);
        let skirt = 0; let invGround = 0;
        if (l.spot) {
          // Standing inside a cone you do not see a cone, only a veil over everything: fade it by how deep the eye is in the beam.
          tmp.subVectors(camPos, l.pos);
          const d = tmp.length();
          const c = d > 1e-3 ? tmp.dot(l.dir) / d : 1;
          const deep = Math.min(1, Math.max(0, (c - l.cosVisOuter) / Math.max(l.cosVisInner - l.cosVisOuter, 1e-3))) * (d < range ? 1 : 0);
          k *= 1 - uniforms.inside.value * deep * deep * (3 - 2 * deep);
          skirt = l.skirtAngle > l.visAngle + 0.02 ? BEAM.skirtGain : 0;
          if (l.dir.y < -0.05) {
            invGround = -l.dir.y / Math.max(l.pos.y - l.groundY, 0.5);
            // a tall lamp's cone is a longer path through lit air: without this a street lamp's cone outshines a canopy downlight's
            k *= Math.pow(Math.min(1.5, Math.max(0.4, (EVEN_HEIGHT * invGround))), e);
          }
        }
        u.uLPos.value[i].set(l.pos.x, l.pos.y, l.pos.z, range);
        u.uLDir.value[i].set(l.dir.x, l.dir.y, l.dir.z, l.cosVisOuter);
        u.uLCol.value[i].set(l.r * k, l.g * k, l.b * k, l.cosVisInner);
        u.uLExt.value[i].set(l.cosSkirt, skirt, invGround, 0);
        setBodies(l, range, i * BODIES, u.uLBody.value);
        let ready = 0; let x = 0; let y = 0; let tan = 1;
        if (l.spot) {
          tan = Math.tan(Math.min(Math.max(l.visAngle, l.skirtAngle) + 0.04, 1.3));
          const t = atlas.tile(l, tan);
          if (t) {
            if (!t.ready && drew < 1) { atlas.draw(post.renderer, t); drew++; }
            if (t.ready && uniforms.shadows.value > 0) { ready = 1; x = t.x + 1; y = t.y + 1; }
          }
        }
        u.uLTile.value[i].set(x, y, tan, ready);
      }
      u.uLCount.value = count;

      const rainAmount = G.mats && G.mats.shared && G.mats.shared.uRain ? G.mats.shared.uRain.value : 0;
      const t = post.time.t;
      u.uFogDensity.value = fog.density; u.uFogFalloff.value = fog.falloff;
      u.uRainScatter.value = uniforms.rainScatter.value * rainAmount;
      u.uDrift.value.set(t * 0.011, t * -0.004, t * 0.007);
      // steps along a beam / along its skirt: 6/4 on high, 4/3 on medium, 3/2 on low, 2/2 on mobile
      const vs = post.quality.volSteps || 20;
      const steps = vs < 10 ? 2 : Math.max(3, Math.round(vs / 5)); // under 10 (mobile's 8): 2/2
      u.uSteps.value.set(steps, Math.max(2, Math.round(steps * 0.67)));

      const a = uniforms.fogAmbient.value; const tint = uniforms.fogTint.value;
      const up = upMat.uniforms;
      up.uFogColor.value.set(fog.r * a * tint.x, fog.g * a * tint.y, fog.b * a * tint.z);
      up.uFogDensity.value = fog.density * uniforms.fogDensity.value; up.uFogFalloff.value = fog.falloff;

      buf.update();
      low.tHalfDepth.value = buf.target.texture;
      low.uInvProj.value.copy(buf.uniforms.uInvProj.value);
      low.uLowScale.value = buf.factor;
      post.blit(marchMat, light);
      buf.blur(light, tmpT);
      post.blit(upMat, out);
      return out.texture;
    },
    dispose() { light.dispose(); tmpT.dispose(); out.dispose(); marchMat.dispose(); upMat.dispose(); noise.dispose(); atlas.dispose(); },
  };
}
