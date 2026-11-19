// Practical lights. The level registers every fixture with G.lights.add(); registering is cheap
// (a plain record, no three objects). Each frame a FIXED pool of real three lights is handed to the
// fixtures that matter most to the camera:
//   2 shadow-casting spots   nearest shadow-capable spot fixtures (soft shadows, see shadows.js)
//   6 plain spots            next most important spot fixtures
//   3 plain points           point and tube fixtures
//   1 point                  muzzle flash (intensity 0 and untouched while idle)
// The pool never changes size and idle slots stay in the scene at intensity 0, so the light counts
// baked into every shader are constant: nothing recompiles when lights swap, flicker or fire.
// The tier decides how much of the pool is in use (G.quality.shadowedSpots / spots / points, read
// every frame): slots beyond it are made invisible, which takes them out of every shader. That is
// one recompile when the tier changes, and a shorter light loop on every pixel afterwards.
//
// On a tier that uses less than the whole pool there is one more light, the lamp fill
// (`G.lights.lampFill`, named 'lampFill'): a point light standing in for the lamps near the player
// that got no real light. A ground pool lights the ground and nothing else, so without it the pumps
// under a far canopy are black shapes on bright concrete. It sits above the middle of those lamps,
// each weighted by its output and its distance from the player (never by what is on screen, so the
// light does not shift as the player turns), with a fraction of their output; it moves there
// smoothly, and fades out and back in when that middle jumps. Only lamps whose light lands in the
// player's zone count (G.level.zone / zoneAt), so it cannot light a room through its walls. On a
// tier that uses the whole pool it is invisible: not in any shader, not in the picture.
// It is a stopgap for the sky's fill (sky.js): setting `G.lights.useLampFill = false`
// switches it off for good.
//
// Moving bodies and shadow maps (also per tier, G.quality.zombieShadowDist):
//   - a skinned body farther than that from a shadowed spot is left out of that spot's shadow map
//     (out there the lamp's light has all but run out; it was two or three draws per body per lamp);
//   - at 0 no skinned body is drawn into any shadow map, the moon's included (castShadow is switched
//     off on each body directly, and back on when the tier changes), and each live zombie
//     gets a soft contact blob on the ground instead (one instanced draw for all of them), leaning
//     away from the lamp that lights it most.
// A fixture without a slot is drawn as an analytic pool of light on the ground (one instanced,
// additive draw call for all of them). Slots change hands by cross-fading real light against that
// pool over FADE_TIME, with a bonus for the current holder, so nothing pops.
//
// Units. `lumens` is the real fixture output. Scene intensity = real candela * UNIT, with
// UNIT = 1/10 (one scene radiance unit is about 10 cd/m2). `color` is chromaticity only: it is
// normalised to luminance 1 so equal lumens look equally bright whatever the tint.
import {
  Group, SpotLight, PointLight, Color, Vector3, Matrix4, Frustum, Sphere, Mesh, PlaneGeometry, BufferGeometry, MeshBasicMaterial,
  InstancedBufferGeometry, InstancedBufferAttribute, ShaderMaterial, AdditiveBlending, DynamicDrawUsage,
} from 'three';
import { installSoftShadows, configureSpotShadow, setMoonShadowCadence } from './shadows.js';

// the first free slot among the n the tier allows
const freeSlot = (slots, n) => { for (let i = 0; i < n; i++) if (!slots[i].fixture) return slots[i]; return null; };

export const UNIT = 1 / 10;
const N_SHADOW = 2; // was 3: each shadowed spot costs about 1.3 ms a frame on high at 1080p with a crowd 
const N_SPOT = 6; // was 5: the spot that lost its shadow slot keeps a real light, so no lamp drops to a ground pool
const N_POINT = 3;
const FADE_TIME = 0.45; // seconds for a slot to fade in or out
const HOLD_BONUS = 1.6; // score multiplier for the fixture that already holds a slot
const REAL_LIGHT_DISTANCE = 55; // metres from the camera beyond which a fixture is pool-only
const OFFSCREEN = 0.12; // score multiplier when the lit area is outside the view
const MUZZLE_CANDELA = 900; // real candela at intensity 1
const MUZZLE_DECAY = 0.03; // seconds (e-folding)
const LUMA = [0.2126, 0.7152, 0.0722];
const FILL_GAIN = 0.06; // of the summed candela of the lamps it stands in for
const FILL_LIFT = 1.5; // metres above their weighted middle: spreads it, and keeps it off the ground below
const FILL_RANGE = 34; // metres
const FILL_TIME = 0.5; // seconds to settle on a new place or level
const FILL_JUMP = 8; // metres: a move longer than this is a fade out and in, not a slide
const FILL_NEAR = 12; // metres from the player at which a lamp's say in where the fill stands halves
const BODY_SCAN_FRAMES = 120; // frames between looks through the scene for skinned bodies
const MAX_BLOBS = 64;
const BLOB_RADIUS = 0.42; // metres: a body's footprint
const BLOB_OPACITY = 0.62; // at the feet under a lamp; BLOB_AMBIENT where no lamp reaches
const BLOB_AMBIENT = 0.35;
const BLOB_REACH = 1.2; // metres: the longest a blob leans away from its lamp
const BODY_HEIGHT = 1.8;

function chroma(r, g, b) {
  const y = r * LUMA[0] + g * LUMA[1] + b * LUMA[2];
  return new Color().setRGB(r / y, g / y, b / y);
}
// Linear RGB, luminance 1.
export const LIGHT_COLORS = {
  sodium: chroma(1.0, 0.46, 0.075), // high-pressure sodium, about 2000 K
  canopy: chroma(0.74, 1.0, 0.84), // cold, slightly green white
  fluorescent: chroma(0.8, 1.0, 0.9),
  muzzle: chroma(1.0, 0.6, 0.26),
};

function toColor(c) {
  const out = new Color();
  if (c && c.isColor) out.copy(c);
  else if (Array.isArray(c)) out.setRGB(c[0], c[1], c[2]);
  else out.set(c ?? 0xffffff);
  const y = out.r * LUMA[0] + out.g * LUMA[1] + out.b * LUMA[2];
  return y > 1e-6 ? out.multiplyScalar(1 / y) : out.setRGB(1, 1, 1);
}
const setVec = (v, a) => (a && a.isVector3 ? v.copy(a) : v.set(a[0], a[1], a[2]));

// 1D value noise from an integer hash: deterministic, time-driven.
function hash1(n) {
  let x = (n | 0) * 374761393 + 1013904223;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}
function noise1(x) {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash1(i);
  return a + (hash1(i + 1) - a) * f * f * (3 - 2 * f);
}
// Multiplier in [1 - amount, 1]. 'waver' = slow mains/ballast drift; 'stutter' = steady stretches
// broken by bursts of dropouts (failing fluorescent).
function flickerGain(f, t) {
  const x = t * f.speed + f.phase;
  if (f.kind === 'stutter') {
    const burst = Math.min(1, Math.max(0, (noise1(x * 0.35) - 0.56) * 12));
    const chop = noise1(x * 11) > 0.5 ? 0 : 1;
    return 1 - f.amount * (burst * chop * 0.92 + 0.08 * noise1(x * 3.1 + 5));
  }
  return 1 - f.amount * (0.6 * noise1(x) + 0.4 * noise1(x * 3.7 + 2));
}

const POOL_VERT = /* glsl */ `
attribute vec3 iCentre;
attribute vec4 iShape; // height above ground, radius, coneCos, penumbraCos
attribute vec4 iColor; // rgb = colour * candela * weight, a = range
attribute vec3 iDir; // spot axis
varying vec3 vWorld;
varying vec3 vDir;
varying vec2 vP;
varying vec4 vShape;
varying vec4 vColor;
void main() {
  vP = position.xz * iShape.y;
  vShape = iShape;
  vColor = iColor;
  vDir = iDir;
  vWorld = iCentre + vec3(vP.x, 0.0, vP.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}`;
// What the real light would do to flat ground: inverse square, the spot cone and three's range
// window, then Lambert diffuse plus the GGX highlight that makes the long streak on wet asphalt.
const POOL_FRAG = /* glsl */ `
uniform float uAlbedo;
uniform float uRoughness;
varying vec3 vWorld;
varying vec3 vDir;
varying vec2 vP;
varying vec4 vShape;
varying vec4 vColor;
void main() {
  float h = vShape.x;
  float d2 = h * h + dot(vP, vP);
  float d = sqrt(d2);
  float cosT = h / d;
  float x = d / vColor.a;
  float window = clamp(1.0 - x * x * x * x, 0.0, 1.0);
  vec3 L = vec3(-vP.x, h, -vP.y) / d;
  float e = cosT / d2 * smoothstep(vShape.z, vShape.w, dot(-L, vDir)) * window * window; // irradiance per candela
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 H = normalize(L + V);
  float a = uRoughness * uRoughness; float a2 = a * a;
  float nh = max(H.y, 0.0); float nv = max(V.y, 1e-3); float nl = cosT;
  float dd = nh * nh * (a2 - 1.0) + 1.0;
  float D = a2 / (3.14159265 * dd * dd);
  float vis = 0.5 / max(nl * sqrt(nv * nv * (1.0 - a2) + a2) + nv * sqrt(nl * nl * (1.0 - a2) + a2), 1e-4);
  float F = 0.04 + 0.96 * pow(1.0 - max(dot(V, H), 0.0), 5.0);
  gl_FragColor = vec4(vColor.rgb * e * (uAlbedo / 3.14159265 + D * vis * F), 1.0);
}`;

function createPools() {
  const quad = new PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  const geo = new InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.getAttribute('position'));
  const mat = new ShaderMaterial({
    uniforms: { uAlbedo: { value: 0.045 }, uRoughness: { value: 0.35 } },
    vertexShader: POOL_VERT, fragmentShader: POOL_FRAG, transparent: true, blending: AdditiveBlending,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mesh = new Mesh(geo, mat);
  mesh.name = 'lightPools';
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  let cap = 0;
  let centre; let shape; let color; let dir;
  const grow = (n) => {
    cap = Math.max(64, cap * 2, n);
    const mk = (size) => { const a = new InstancedBufferAttribute(new Float32Array(cap * size), size); a.setUsage(DynamicDrawUsage); return a; };
    centre = mk(3); shape = mk(4); color = mk(4); dir = mk(3);
    geo.setAttribute('iCentre', centre); geo.setAttribute('iShape', shape); geo.setAttribute('iColor', color); geo.setAttribute('iDir', dir);
  };
  grow(64);
  return {
    mesh, uniforms: mat.uniforms,
    begin(n) { if (n > cap) grow(n); return { centre: centre.array, shape: shape.array, color: color.array, dir: dir.array }; },
    end(n) {
      geo.instanceCount = n;
      mesh.visible = n > 0;
      centre.needsUpdate = true; shape.needsUpdate = true; color.needsUpdate = true; dir.needsUpdate = true;
    },
  };
}

// Contact blobs: what stands in for a zombie's shadow on tiers where bodies are in no shadow map.
// One instanced, alpha-blended draw; each instance is a soft dark ellipse on the ground.
const BLOB_VERT = /* glsl */ `
attribute vec4 iBlob;  // feet xyz, radius
attribute vec4 iLean;  // unit direction on the ground (xz), lean length in metres, opacity
varying vec2 vP;       // along the lean (-1 behind the feet .. 0 at the feet .. 1 at the tip), across (-1..1)
varying float vA;
void main() {
  float along = position.x < 0.0 ? position.x * iBlob.w : position.x * (iBlob.w + iLean.z); // metres from the feet
  vP = vec2(position.x, position.z);
  vA = iLean.w;
  vec2 ax = iLean.xy;
  vec2 w = ax * along + vec2(-ax.y, ax.x) * (position.z * iBlob.w);
  gl_Position = projectionMatrix * viewMatrix * vec4(iBlob.x + w.x, iBlob.y, iBlob.z + w.y, 1.0);
}`;
// Darkest at the feet, gone at the rim: round behind the body, drawn out toward the tip.
const BLOB_FRAG = /* glsl */ `
varying vec2 vP;
varying float vA;
void main() {
  float f = 1.0 - smoothstep(0.1, 1.0, length(vP));
  gl_FragColor = vec4(0.0, 0.0, 0.0, vA * f);
}`;

function createBlobs() {
  const quad = new PlaneGeometry(2, 2, 2, 1).rotateX(-Math.PI / 2); // a column of vertices at the feet: the two halves have different lengths
  const geo = new InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.getAttribute('position'));
  const blob = new InstancedBufferAttribute(new Float32Array(MAX_BLOBS * 4), 4);
  const lean = new InstancedBufferAttribute(new Float32Array(MAX_BLOBS * 4), 4);
  blob.setUsage(DynamicDrawUsage); lean.setUsage(DynamicDrawUsage);
  geo.setAttribute('iBlob', blob); geo.setAttribute('iLean', lean);
  geo.instanceCount = 0;
  const mat = new ShaderMaterial({
    vertexShader: BLOB_VERT, fragmentShader: BLOB_FRAG, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mesh = new Mesh(geo, mat);
  mesh.name = 'contactBlobs';
  mesh.frustumCulled = false;
  mesh.renderOrder = 4; // before the light pools
  mesh.visible = false;
  mesh.userData.noReflect = true;
  return {
    mesh, blob: blob.array, lean: lean.array,
    end(n) {
      geo.instanceCount = n;
      mesh.visible = n > 0;
      if (n > 0) { blob.needsUpdate = true; lean.needsUpdate = true; }
    },
  };
}

export function createLights(G) {
  const soft = installSoftShadows(G.renderer);
  const rng = G.rng.fork('lights');
  const root = new Group();
  root.name = 'lights';
  G.scene.add(root);

  const fixtures = [];
  let nextId = 1;

  // ---- slots -------------------------------------------------------------------------------
  const makeSlot = (light, tier) => {
    root.add(light);
    if (light.target) root.add(light.target);
    return { light, tier, fixture: null, fade: 0, drawnFor: null, drawnPos: new Vector3(), drawnDir: new Vector3(), drawnCone: 0, drawnSize: 0 };
  };
  const tiers = { shadow: [], spot: [], point: [] };
  const TIER_NAMES = ['shadow', 'spot', 'point'];
  for (let i = 0; i < N_SHADOW; i++) {
    const l = new SpotLight(0xffffff, 0, 20, 1, 0.5, 2);
    l.castShadow = true;
    l.shadow.autoUpdate = false;
    configureSpotShadow(l, 1);
    tiers.shadow.push(makeSlot(l, 'shadow'));
  }
  for (let i = 0; i < N_SPOT; i++) tiers.spot.push(makeSlot(new SpotLight(0xffffff, 0, 20, 1, 0.5, 2), 'spot'));
  for (let i = 0; i < N_POINT; i++) tiers.point.push(makeSlot(new PointLight(0xffffff, 0, 10, 2), 'point'));
  const muzzle = new PointLight(LIGHT_COLORS.muzzle, 0, 14, 2);
  root.add(muzzle);
  let muzzleLevel = 0;
  let muzzleFresh = false;

  const fill = new PointLight(0xffffff, 0, FILL_RANGE, 2);
  fill.name = 'lampFill';
  fill.visible = false;
  root.add(fill);
  const fillAt = new Vector3(); const fillColor = new Color(); // where and what it is heading for
  let fillLevel = 0; // 0..1 fade
  let fillPlaced = false;

  const pools = createPools();
  root.add(pools.mesh);
  const blobs = createBlobs();
  root.add(blobs.mesh);

  // ---- tier budget ---------------------------------------------------------------------------
  // How many slots of each kind the tier uses. A slot outside it holds nothing and is invisible.
  const budget = { shadow: -1, spot: -1, point: -1 };
  const clampInt = (v, max) => (Number.isFinite(v) ? Math.min(max, Math.max(0, Math.floor(v))) : max);
  function syncBudget() {
    const q = G.quality || {};
    const ns = clampInt(q.shadowedSpots, N_SHADOW); const np = clampInt(q.spots, N_SPOT); const nq = clampInt(q.points, N_POINT);
    if (ns === budget.shadow && np === budget.spot && nq === budget.point) return;
    budget.shadow = ns; budget.spot = np; budget.point = nq;
    for (const name of TIER_NAMES) {
      const slots = tiers[name];
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        const on = i < budget[name];
        s.light.visible = on;
        if (!on && s.fixture) { s.fixture.slots[name] = null; s.fixture = null; s.fade = 0; s.light.intensity = 0; }
      }
    }
    snap = true; // the lamps that lost or gained a real light change over at once, with the recompile
    syncFill();
  }
  let fillWanted = null;
  function syncFill() {
    const want = api.useLampFill !== false && budget.shadow + budget.spot < N_SHADOW + N_SPOT;
    if (want === fillWanted) return;
    fillWanted = want;
    fill.visible = want;
    if (!want) { fill.intensity = 0; fillLevel = 0; fillPlaced = false; }
  }

  // The fill light (see the header). Runs after the slots are applied, so fx.real is this frame's.
  function updateFill(dt, wasSnap) {
    if (!fill.visible) return;
    const level = G.level;
    const zoneAt = level && typeof level.zoneAt === 'function' ? level.zoneAt : null;
    const here = zoneAt ? level.zone : null; // null: no zones (yet), or outside them all: no zone limit
    let w = 0; let x = 0; let y = 0; let z = 0; let r = 0; let g = 0; let b = 0; let power = 0;
    for (let i = 0; i < fixtures.length; i++) {
      const fx = fixtures[i];
      if (!fx.enabled || fx.type !== 'spot' || !fx.poolOk || fx.score <= 0) continue;
      const share = 1 - Math.min(1, fx.real);
      if (share <= 0.001) continue;
      if (here) {
        if (fx.zone === undefined) fx.zone = zoneAt(fx.foot.x, fx.foot.z) || null; // where its light lands
        if (fx.zone && fx.zone !== here) continue; // behind a wall from here
      }
      // by distance from the player only: what is on screen does not move it
      const dx = fx.foot.x - camPos.x; const dy = fx.foot.y - camPos.y; const dz = fx.foot.z - camPos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const lit = fx.candela * fx.gain * share;
      const wi = lit / (1 + d2 / (FILL_NEAR * FILL_NEAR));
      power += lit * Math.max(0, 1 - Math.sqrt(d2) / REAL_LIGHT_DISTANCE);
      w += wi; x += fx.pos.x * wi; y += fx.pos.y * wi; z += fx.pos.z * wi;
      r += fx.color.r * wi; g += fx.color.g * wi; b += fx.color.b * wi;
    }
    const k = wasSnap ? 1 : Math.min(1, dt / FILL_TIME);
    if (w <= 1e-4) {
      fillLevel = Math.max(0, fillLevel - k); // every lamp in reach has a real light: nothing to stand in for
    } else {
      fillAt.set(x / w, y / w + FILL_LIFT, z / w);
      fillColor.setRGB(r / w, g / w, b / w);
      fillTarget += (FILL_GAIN * power - fillTarget) * k;
      const far = fill.position.distanceToSquared(fillAt) > FILL_JUMP * FILL_JUMP;
      if (!fillPlaced || wasSnap || (far && fillLevel <= 0)) {
        // first time, a cut, or faded right out ahead of a jump: go straight there
        fill.position.copy(fillAt); fill.color.copy(fillColor); fillPlaced = true;
        fillLevel = wasSnap ? 1 : Math.min(1, fillLevel + k);
      } else if (far) {
        fillLevel = Math.max(0, fillLevel - 2 * k); // fading out where it stands; it jumps once it is dark
      } else {
        fill.position.lerp(fillAt, k); fill.color.lerp(fillColor, k);
        fillLevel = Math.min(1, fillLevel + k);
      }
    }
    fill.intensity = fillTarget * fillLevel;
  }
  let fillTarget = 0; // scene candela it is settling on

  // ---- bodies in shadow maps -------------------------------------------------------------------
  // three draws every shadow map inside one render call, with no hook per light. The gate is a mesh
  // with nothing to draw that sits ahead of every body in the scene: its onBeforeShadow runs at the
  // start of each light's shadow pass and switches castShadow off on the bodies that pass leaves
  // out; its onBeforeRender (the main pass, after all shadow maps) switches them back on. Only
  // bodies that were casting are touched, so whatever the zombie code decided stands.
  const bodies = []; // skinned meshes in the scene
  const gated = []; // bodies whose castShadow the gate switched off, to be restored
  let sinceBodyScan = BODY_SCAN_FRAMES;
  const collectBody = (o) => { if (o.isSkinnedMesh) bodies.push(o); };
  function restoreBodies() {
    for (let i = 0; i < gated.length; i++) gated[i].castShadow = true;
    gated.length = 0;
  }
  // zombieShadowDist 0: no body casts at all. Set directly on each body every frame (not left to the
  // gate, which only works for bodies drawn after it in the scene), and handed back when the tier
  // gives bodies shadows again. A body added between scans is caught at the next one; zombie:spawn
  // brings that scan forward.
  // Marked on the mesh (userData.tierNoShadow), not kept in a list: bodies come and go with spawns.
  let muted = false; // some body in the scene carries the mark
  function syncBodyShadows() {
    if (G.quality && G.quality.zombieShadowDist <= 0) {
      for (let i = 0; i < bodies.length; i++) {
        const m = bodies[i];
        if (m.castShadow) { m.castShadow = false; m.userData.tierNoShadow = true; muted = true; }
      }
    } else if (muted) {
      // the tier change that got here set snap, so `bodies` was rescanned this frame
      for (let i = 0; i < bodies.length; i++) {
        const m = bodies[i];
        if (m.userData.tierNoShadow) { m.castShadow = true; delete m.userData.tierNoShadow; }
      }
      muted = false;
    }
  }
  if (G.events && G.events.on) G.events.on('zombie:spawn', () => { sinceBodyScan = BODY_SCAN_FRAMES; });
  // Each map takes at most G.quality.zombieShadowMax bodies: the nearest to the spot, or for the moon
  // (whose map follows the camera) the nearest to the camera. A body further down the list throws
  // a shadow too small or too faint to miss next to the ones nearer the lamp, and was a draw per
  // map. Distances go in a fixed array; the cut is the n-th smallest of them (no allocation).
  const bodyD2 = new Float64Array(256);
  function nthSmallest(n, count) {
    let cut = -Infinity;
    for (let k = 0; k < n; k++) {
      let best = Infinity;
      for (let i = 0; i < count; i++) { const v = bodyD2[i]; if (v > cut && v < best) best = v; }
      if (best === Infinity) return Infinity; // fewer than n distinct: every one stays
      cut = best;
    }
    return cut;
  }
  function gateShadowPass(shadowCamera) {
    restoreBodies();
    const q = G.quality || {};
    const dist = Number.isFinite(q.zombieShadowDist) ? q.zombieShadowDist : Infinity;
    const max = Number.isFinite(q.zombieShadowMax) ? Math.max(0, Math.floor(q.zombieShadowMax)) : Infinity;
    let from = null;
    for (let i = 0; i < tiers.shadow.length; i++) if (tiers.shadow[i].light.shadow.camera === shadowCamera) from = tiers.shadow[i].light.position;
    const moon = !from;
    if (moon && dist > 0 && max === Infinity) return; // the moon (or someone else's light), uncapped: bodies stay in unless the tier gives them no shadow at all
    if (moon) from = camPos; // the moon's map is fitted round the camera: the bodies nearest it are the ones that show
    const d2 = moon ? Infinity : dist * dist;
    let n = 0;
    for (let i = 0; i < bodies.length && n < bodyD2.length; i++) {
      const m = bodies[i];
      if (!m.castShadow || !m.visible) { bodyD2[n++] = Infinity; continue; }
      const e = m.matrixWorld.elements;
      const dx = e[12] - from.x; const dy = moon ? 0 : e[13] + 1 - from.y; const dz = e[14] - from.z;
      bodyD2[n++] = dx * dx + dy * dy + dz * dz;
    }
    const cut = dist <= 0 || max <= 0 ? -Infinity : max < n ? Math.min(d2, nthSmallest(max, n)) : d2;
    for (let i = 0; i < bodies.length && i < n; i++) {
      const m = bodies[i];
      if (!m.castShadow || !m.visible) continue;
      if (bodyD2[i] > cut) { m.castShadow = false; gated.push(m); }
    }
  }
  const gate = new Mesh(new BufferGeometry(), new MeshBasicMaterial());
  gate.name = 'shadowGate';
  gate.frustumCulled = false;
  gate.castShadow = true; // that is what gets onBeforeShadow called; the empty geometry draws nothing
  gate.userData.noReflect = true;
  gate.onBeforeShadow = (_r, _o, _cam, shadowCamera) => gateShadowPass(shadowCamera);
  gate.onBeforeRender = restoreBodies;
  root.add(gate);

  // ---- contact blobs ---------------------------------------------------------------------------
  function updateBlobs() {
    const zs = G.zombies && G.zombies.list;
    if (!(G.quality && G.quality.zombieShadowDist <= 0) || !Array.isArray(zs) || !zs.length) { if (blobs.mesh.visible) blobs.end(0); return; }
    const B = blobs.blob; const L = blobs.lean;
    let n = 0;
    for (let i = 0; i < zs.length && n < MAX_BLOBS; i++) {
      const z = zs[i];
      if (!z || z.alive === false || !z.pos) continue;
      const x = z.pos.x; const y = z.pos.y || 0; const zz = z.pos.z;
      // the lamp that lights this body most: the blob leans away from it, as its shadow would
      let bestE = 0; let lx = 0; let lz = 0; let lh = 0;
      for (let k = 0; k < fixtures.length; k++) {
        const fx = fixtures[k];
        if (!fx.enabled) continue;
        const dx = x - fx.pos.x; const dy = y + 1 - fx.pos.y; const dz = zz - fx.pos.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > fx.range * fx.range || dy > 0) continue;
        if (fx.type === 'spot' && (dx * fx.dir.x + dy * fx.dir.y + dz * fx.dir.z) < Math.cos(fx.cone) * Math.sqrt(d2)) continue;
        const e = (fx.candela * fx.gain) / Math.max(d2, 1);
        if (e > bestE) { bestE = e; lx = dx; lz = dz; lh = fx.pos.y - y; }
      }
      let ax = 1; let az = 0; let reach = 0; let a = BLOB_AMBIENT;
      if (bestE > 0) {
        const flat = Math.hypot(lx, lz);
        if (flat > 1e-3) { ax = lx / flat; az = lz / flat; }
        reach = lh > BODY_HEIGHT + 0.2 ? Math.min(BLOB_REACH, (BODY_HEIGHT * flat) / (lh - BODY_HEIGHT)) : BLOB_REACH;
        // a faint lamp throws a faint shadow: full strength from about 0.2 scene lux up
        a = BLOB_AMBIENT + (BLOB_OPACITY - BLOB_AMBIENT) * Math.min(1, bestE / 0.2);
      }
      B[n * 4] = x; B[n * 4 + 1] = y + 0.02; B[n * 4 + 2] = zz; B[n * 4 + 3] = BLOB_RADIUS;
      L[n * 4] = ax; L[n * 4 + 1] = az; L[n * 4 + 2] = reach; L[n * 4 + 3] = a;
      n++;
    }
    blobs.end(n);
  }

  // Records for the volumetrics pass: same objects every frame, fields rewritten in update().
  const describe = (slot) => ({
    type: slot.light.isSpotLight ? 'spot' : 'point', pos: slot.light.position, dir: new Vector3(0, -1, 0),
    color: slot.light.color, intensity: 0, range: 0, cone: 0, penumbra: 0, shadowMap: null,
    shadowMatrix: slot.light.castShadow ? slot.light.shadow.matrix : null, slot,
  });
  const shadowed = tiers.shadow.map(describe);
  const unshadowed = [...tiers.spot, ...tiers.point].map(describe);

  // ---- fixtures ----------------------------------------------------------------------------
  function derive(fx) {
    fx.dir.normalize();
    fx.zone = undefined; // the zone its light lands in: worked out again when the fill next needs it
    const spot = fx.type === 'spot';
    const cd = spot ? fx.lumens / (2 * Math.PI * (1 - Math.cos(fx.cone))) : fx.lumens / (4 * Math.PI);
    fx.candela = cd * UNIT;
    // where the light lands: used for importance and for the ground pool
    const h = fx.pos.y - fx.groundY;
    const down = spot ? -fx.dir.y : 1;
    fx.poolOk = fx.pool && h > 0.3 && h < fx.range && down > 0.5;
    const reach = spot && down > 0.2 ? Math.min(h / down, fx.range) : 0;
    fx.foot.copy(fx.pos).addScaledVector(fx.dir, reach);
    fx.height = h;
    fx.poolRadius = Math.sqrt(Math.max(fx.range * fx.range - h * h, 0));
    fx.bound.set(fx.foot, spot ? Math.min(fx.poolRadius, h * Math.tan(Math.min(fx.cone, 1.3))) + 1 : fx.range * 0.7);
  }

  function add(o) {
    const type = o.type === 'spot' ? 'spot' : o.type === 'tube' ? 'tube' : 'point';
    const fl = typeof o.flicker === 'object' && o.flicker ? o.flicker : { amount: Number(o.flicker) || 0 };
    const fx = {
      id: nextId++, type,
      pos: setVec(new Vector3(), o.pos), dir: setVec(new Vector3(), o.dir || [0, -1, 0]),
      color: toColor(o.color), lumens: o.lumens ?? 1000, range: o.range ?? 20,
      cone: Math.min(o.cone ?? 1.0, 1.45), penumbra: o.penumbra ?? 0.55, size: o.size ?? 0.25,
      castShadow: type === 'spot' && !!o.castShadow, priority: o.priority ?? 1,
      pool: o.pool !== false, groundY: o.groundY ?? 0, enabled: true,
      flicker: {
        amount: Math.min(1, Math.max(0, fl.amount || 0)), speed: fl.speed ?? (type === 'tube' ? 2.2 : 1.3),
        kind: fl.kind ?? (type === 'tube' ? 'stutter' : 'waver'), phase: rng.range(0, 1000),
      },
      gain: 1, // current flicker multiplier; the level can drive its emissive mesh from this
      foot: new Vector3(), bound: new Sphere(), candela: 0, height: 0, poolRadius: 0, poolOk: false,
      slots: { shadow: null, spot: null, point: null }, real: 0, score: 0, shadowScore: 0, want: null,
      // change any of pos, dir, color, lumens, range, cone, penumbra, size, enabled
      set(p) {
        if (p.pos) setVec(fx.pos, p.pos);
        if (p.dir) setVec(fx.dir, p.dir);
        if (p.color !== undefined) fx.color.copy(toColor(p.color));
        for (const k of ['lumens', 'range', 'cone', 'penumbra', 'size', 'enabled', 'priority']) if (p[k] !== undefined) fx[k] = p[k];
        derive(fx);
        return fx;
      },
      remove() {
        const i = fixtures.indexOf(fx);
        if (i >= 0) fixtures.splice(i, 1);
        for (const k of Object.keys(tiers)) for (const s of tiers[k]) if (s.fixture === fx) { s.fixture = null; s.fade = 0; s.light.intensity = 0; }
      },
    };
    derive(fx);
    fixtures.push(fx);
    return fx;
  }

  // ---- per-frame assignment ----------------------------------------------------------------
  const frustum = new Frustum();
  const viewProj = new Matrix4();
  const camPos = new Vector3();
  const lastCam = new Vector3(1e9, 0, 0);
  const tmp = new Vector3();
  const best = { shadow: new Array(N_SHADOW), spot: new Array(N_SPOT), point: new Array(N_POINT) };
  let snap = true;
  let frameNo = 0; // updates so far

  // distance from the camera to the segment fixture -> where its light lands
  function reachDistance(fx) {
    tmp.subVectors(fx.foot, fx.pos);
    const len2 = tmp.lengthSq();
    let k = 0;
    if (len2 > 1e-6) k = Math.min(1, Math.max(0, ((camPos.x - fx.pos.x) * tmp.x + (camPos.y - fx.pos.y) * tmp.y + (camPos.z - fx.pos.z) * tmp.z) / len2));
    const dx = fx.pos.x + tmp.x * k - camPos.x; const dy = fx.pos.y + tmp.y * k - camPos.y; const dz = fx.pos.z + tmp.z * k - camPos.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  // keep the n highest-scoring fixtures in list (descending); key picks the score field
  function offer(list, n, fx, key) {
    if (n <= 0) return;
    let i = n - 1;
    if (list[i] && list[i][key] >= fx[key]) return;
    while (i > 0 && (!list[i - 1] || list[i - 1][key] < fx[key])) { list[i] = list[i - 1]; i--; }
    list[i] = fx;
  }

  function runTier(name, dt) {
    const slots = tiers[name];
    const step = snap ? 1 : dt / FADE_TIME;
    for (const s of slots) {
      const fx = s.fixture;
      if (!fx) continue;
      // a fixture being promoted keeps its plain slot until a shadow slot is free, so it never dips
      const waiting = name !== 'shadow' && fx.want === 'shadow' && !fx.slots.shadow;
      const keep = (fx.want === name || waiting) && fx.enabled;
      s.fade = Math.min(1, Math.max(0, s.fade + (keep ? step : -step)));
      if (s.fade <= 0 && !keep) { fx.slots[name] = null; s.fixture = null; }
    }
    for (const fx of best[name]) {
      if (!fx || fx.slots[name]) continue;
      const free = freeSlot(slots, budget[name]);
      if (!free) break;
      free.fixture = fx; fx.slots[name] = free; free.fade = snap ? 1 : 0;
    }
  }

  function applySlot(s, rec) {
    const l = s.light;
    const fx = s.fixture;
    if (!fx) {
      if (l.intensity !== 0) l.intensity = 0;
      if (l.castShadow) l.shadow.autoUpdate = false;
      rec.intensity = 0;
      return;
    }
    fx.real += s.fade;
    l.position.copy(fx.pos);
    l.color.copy(fx.color);
    l.intensity = fx.candela * fx.gain * s.fade;
    l.distance = fx.range;
    if (l.isSpotLight) {
      l.target.position.copy(fx.pos).add(fx.dir);
      l.angle = fx.cone; l.penumbra = fx.penumbra;
      rec.dir.copy(fx.dir);
      if (l.castShadow) {
        configureSpotShadow(l, fx.cone, fx.size, Math.max(256, (G.quality.shadowRes || 2048) >> 1));
        // With no moving body in the map (zombieShadowDist 0) it only changes when the lamp does, so
        // it is redrawn at the moon's cadence, two frames out of step with the moon, and at once
        // when the slot changes hands or the lamp moves.
        const every = G.quality.zombieShadowDist <= 0 ? Math.max(1, Math.floor(G.quality.moonShadowEvery || 1)) : 1;
        if (every > 1) {
          const moved = s.drawnFor !== fx || !s.drawnPos.equals(fx.pos) || !s.drawnDir.equals(fx.dir) || s.drawnCone !== fx.cone || s.drawnSize !== l.shadow.mapSize.x;
          l.shadow.autoUpdate = false;
          if (moved || !l.shadow.map || (frameNo + 2) % every === 0) {
            l.shadow.needsUpdate = true;
            s.drawnFor = fx; s.drawnPos.copy(fx.pos); s.drawnDir.copy(fx.dir); s.drawnCone = fx.cone; s.drawnSize = l.shadow.mapSize.x;
          }
        } else {
          l.shadow.autoUpdate = true;
          s.drawnFor = null;
        }
        rec.shadowMap = soft && l.shadow.map ? l.shadow.map.depthTexture : null; // stock PCF maps are compare samplers: not exposed
      }
    }
    rec.intensity = l.intensity; rec.range = fx.range; rec.cone = l.isSpotLight ? fx.cone : Math.PI; rec.penumbra = fx.penumbra;
  }

  function update(dt) {
    const cam = G.camera;
    const t = G.time.t;
    cam.updateMatrixWorld();
    camPos.setFromMatrixPosition(cam.matrixWorld);
    viewProj.copy(cam.matrixWorld).invert().premultiply(cam.projectionMatrix);
    frustum.setFromProjectionMatrix(viewProj);
    if (camPos.distanceToSquared(lastCam) > 64) snap = true; // teleport or first frame: no fades
    lastCam.copy(camPos);
    frameNo++;
    syncBudget();
    setMoonShadowCadence(G.quality ? G.quality.moonShadowEvery : 1);
    restoreBodies(); // normally empty: the main pass already did it
    if (++sinceBodyScan >= BODY_SCAN_FRAMES || snap) { sinceBodyScan = 0; bodies.length = 0; G.scene.traverse(collectBody); }
    syncBodyShadows();
    syncFill();

    best.shadow.fill(null); best.spot.fill(null); best.point.fill(null);
    for (const fx of fixtures) {
      fx.want = null; fx.real = 0;
      fx.gain = fx.flicker.amount > 0 ? flickerGain(fx.flicker, t) : 1;
      if (!fx.enabled) { fx.score = 0; fx.shadowScore = 0; continue; }
      const d = Math.max(reachDistance(fx), 1.5);
      const near = d < api.realDistance ? 1 : 0;
      const seen = frustum.intersectsSphere(fx.bound) ? 1 : OFFSCREEN;
      const held = fx.slots.shadow || fx.slots.spot || fx.slots.point ? HOLD_BONUS : 1;
      fx.score = (near * seen * fx.priority * fx.candela * held) / (d * d);
      fx.shadowScore = fx.castShadow ? (near * seen * fx.priority * (fx.slots.shadow ? HOLD_BONUS : 1)) / (d * d) : 0;
      if (fx.shadowScore > 0) offer(best.shadow, budget.shadow, fx, 'shadowScore');
    }
    for (const fx of best.shadow) if (fx) fx.want = 'shadow';
    for (const fx of fixtures) {
      if (fx.want || fx.score <= 0) continue;
      if (fx.type === 'spot') offer(best.spot, budget.spot, fx, 'score'); else offer(best.point, budget.point, fx, 'score');
    }
    for (const fx of best.spot) if (fx) fx.want = 'spot';
    for (const fx of best.point) if (fx) fx.want = 'point';

    runTier('shadow', dt); runTier('spot', dt); runTier('point', dt);
    const wasSnap = snap;
    snap = false;

    for (let i = 0; i < shadowed.length; i++) applySlot(tiers.shadow[i], shadowed[i]);
    for (let i = 0; i < unshadowed.length; i++) applySlot(unshadowed[i].slot, unshadowed[i]);
    updateFill(dt, wasSnap);

    // ground pools carry whatever share of each fixture the real lights are not carrying
    const buf = pools.begin(fixtures.length);
    let n = 0;
    pools.uniforms.uAlbedo.value = api.poolAlbedo;
    pools.uniforms.uRoughness.value = api.poolRoughness;
    for (const fx of fixtures) {
      if (!fx.poolOk || !fx.enabled) continue;
      const w = (1 - Math.min(1, fx.real)) * fx.gain * fx.candela;
      if (w <= 1e-5) continue;
      const spot = fx.type === 'spot';
      const cc = spot ? Math.cos(fx.cone) : -2;
      buf.centre[n * 3] = fx.pos.x; buf.centre[n * 3 + 1] = fx.groundY + 0.015; buf.centre[n * 3 + 2] = fx.pos.z;
      buf.shape[n * 4] = fx.height; buf.shape[n * 4 + 1] = fx.poolRadius;
      buf.shape[n * 4 + 2] = cc; buf.shape[n * 4 + 3] = spot ? Math.cos(fx.cone * (1 - fx.penumbra)) : -1.5;
      buf.dir[n * 3] = fx.dir.x; buf.dir[n * 3 + 1] = fx.dir.y; buf.dir[n * 3 + 2] = fx.dir.z;
      buf.color[n * 4] = fx.color.r * w; buf.color[n * 4 + 1] = fx.color.g * w; buf.color[n * 4 + 2] = fx.color.b * w; buf.color[n * 4 + 3] = fx.range;
      n++;
    }
    pools.end(n);
    updateBlobs();

    if (muzzleFresh) muzzleFresh = false; // the frame it fires renders at full strength
    else if (muzzleLevel > 0) {
      muzzleLevel *= Math.exp(-dt / MUZZLE_DECAY);
      if (muzzleLevel < 0.004) muzzleLevel = 0;
      muzzle.intensity = muzzleLevel * MUZZLE_CANDELA * UNIT;
    }
  }

  const api = {
    add, update, colors: LIGHT_COLORS, UNIT,
    softShadows: soft, // false = stock-shadow fallback (see shadows.js); shadowMap is then null in the records below
    // ground assumed under pool-only fixtures; the level sets these to match its wet asphalt
    poolAlbedo: 0.045, poolRoughness: 0.35,
    realDistance: REAL_LIGHT_DISTANCE, // metres; fixtures farther than this from the camera are pool-only
    fixtures, shadowed, unshadowed, muzzle, root,
    lampFill: fill, // see the header; false below switches it off (the sky's fill replaces it)
    useLampFill: true,
    // intensity 1 = one pistol shot. Decays by itself; call again each shot. 0 switches it off now.
    setMuzzleFlash(pos, intensity = 1) {
      if (pos) setVec(muzzle.position, pos);
      muzzleLevel = Math.max(0, intensity);
      muzzleFresh = muzzleLevel > 0;
      muzzle.intensity = muzzleLevel * MUZZLE_CANDELA * UNIT;
    },
    // Skip the cross-fades on the next update (respawn, cutscene cut). Camera jumps over 8 m do it automatically.
    snap() { snap = true; },
    // Apply the tier's light budget now instead of on the next update (the light counts are part of
    // every shader, so the boot does this before compiling them for a new tier).
    syncTier() { syncBudget(); },
    // debug: which fixture each slot holds and how far in it is
    debug() {
      const row = (s) => (s.fixture ? `${s.fixture.id}:${s.fade.toFixed(2)}` : '-');
      return {
        shadow: tiers.shadow.map(row), spot: tiers.spot.map(row), point: tiers.point.map(row), fixtures: fixtures.length, muzzle: muzzle.intensity,
        lampFill: fill.visible ? { at: [fill.position.x, fill.position.y, fill.position.z].map((v) => Math.round(v * 10) / 10), intensity: Math.round(fill.intensity * 10) / 10 } : null,
      };
    },
  };
  return api;
}
