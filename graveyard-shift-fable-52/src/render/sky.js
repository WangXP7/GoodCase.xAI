// Night sky: a broken cloud deck lit from behind by a low moon, sodium sky-glow at the horizon and
// sheet lightning. The same shader is captured into a PMREM environment (G.scene.environment) for
// image-based lighting, with the moon disc left out and radiance clamped so nothing fireflies.
// The capture is redone only while lightning is active, at most CAPTURE_HZ times a second; between
// captures scene.environmentIntensity tracks the flash so the frame-to-frame flicker is exact.
// The moon itself is a shadow-casting directional light (soft shadows, see shadows.js).
//
//   G.sky.moonDir      Vector3, unit, points AT the moon
//   G.sky.moon         { dir, color, intensity, shadowMap, shadowMatrix }   for volumetrics
//   G.sky.fog          { color, density, heightFalloff }   colour follows the horizon (and lightning)
//   G.sky.lightning(s) fire a flash, s in 0..1
//   G.sky.flash        current flash level 0..1 (read-only)
//   G.sky.setMoon(azimuth, elevation)   radians; azimuth 0 = -z, positive toward +x
import {
  Scene, Mesh, BoxGeometry, ShaderMaterial, BackSide, Vector3, Color, DirectionalLight, PMREMGenerator,
} from 'three';
import { installSoftShadows, configureMoonShadow, fitMoonShadow, installLightTestScene } from './shadows.js';

const CAPTURE_HZ = 6;
const MOON_COLOR = new Color().setRGB(0.6, 0.74, 1.0); // blue-grey key
const MOON_LUX = 0.6; // scene units; a film moon, far above the physical ratio to the lamps (0.35 left everything outside a lamp pool a black cut-out)
const ENV_FILL = 2.3; // gain on the sky's own light on the scene: the cool fill that keeps forms readable in the dark
const ENV_FLASH_RATIO = 12; // mean sky radiance at flash 1 over the idle sky; only steers the between-capture ratio

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = p.xyww; // always on the far plane, whatever camera draws it
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uMoonDir;
uniform vec3 uMoonColor;
uniform vec3 uHorizon;
uniform vec3 uGlowDir;
uniform vec3 uFlashDir;
uniform float uFlash;
uniform float uTime;
uniform float uCoverage;
varying vec3 vDir;

float h21(vec2 p) {
  uvec2 q = uvec2(ivec2(floor(p))) * uvec2(1597334673u, 3812015801u);
  uint n = (q.x ^ q.y) * 1597334673u;
  return float(n >> 8) * (1.0 / 16777216.0);
}
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5; float s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 3.1; a *= 0.5; }
  return s / 0.96875;
}
// first three octaves of fbm(): the large shapes only, for the shading and lightning lookups
float fbmLow(vec2 p) {
  float a = 0.5; float s = 0.0;
  for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 3.1; a *= 0.5; }
  return s / 0.875;
}

void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  vec2 uv = d.xz / (h + 0.11);
  vec2 wind = uTime * vec2(0.011, 0.005);

  float big = fbm(uv * 0.85 + wind);
  float dens = big * 0.72 + fbm(uv * 2.6 + wind * 1.7 + 11.3) * 0.28;
  float cover = smoothstep(uCoverage - 0.16, uCoverage + 0.2, dens); // 0 in a gap, 1 in thick cloud
  float alpha = smoothstep(0.0, 0.35, cover);
  // a second sample a step toward the moon: cloud that is thicker on the moon side is in shade
  vec2 moonUv = uMoonDir.xz / (max(uMoonDir.y, 0.0) + 0.11);
  vec2 toMoon = moonUv - uv;
  toMoon /= max(length(toMoon), 1e-4);
  float shade = smoothstep(-0.06, 0.15, fbmLow((uv + toMoon * 0.22) * 0.85 + wind) - big);

  float cosM = max(dot(d, uMoonDir), 0.0);
  float halo = pow(cosM, 180.0) * 2.2 + pow(cosM, 24.0) * 0.5 + pow(cosM, 5.0) * 0.09;
#ifdef CAPTURE
  halo = min(halo, 0.12); // the moon light itself supplies the highlight; keep the glare out of reflections
#endif

  // clear night air behind the deck
  vec3 sky = mix(vec3(0.014, 0.022, 0.040), vec3(0.004, 0.008, 0.018), pow(h, 0.45));
  sky += uMoonColor * (pow(cosM, 400.0) * 0.6 + pow(cosM, 10.0) * 0.03);
#ifndef CAPTURE
  sky += uMoonColor * 22.0 * smoothstep(0.99987, 0.99993, cosM);
#endif

  // the deck: thin cloud passes moonlight (bright rims), thick cloud blocks it
  float through = exp(-cover * cover * 4.5);
  vec3 cloud = uMoonColor * (halo * through * 1.6 + 0.02 * (1.0 - 0.65 * shade) + 0.012 * through);
  // sodium light from the truck stop and the town beyond, caught on the underside
  vec3 sodium = vec3(1.0, 0.47, 0.13);
  float town = 0.55 + 0.45 * pow(max(dot(normalize(d.xz + 1e-5), normalize(uGlowDir.xz)), 0.0), 2.0);
  cloud += sodium * 0.045 * exp(-h * 4.5) * town * (0.5 + 0.5 * cover);

  // sheet lightning: the deck lit from inside around one cell, the whole sky lifted a little
  float cell = smoothstep(0.3, 0.72, fbmLow(uv * 0.7 + 31.7));
  float lobe = max(dot(d, uFlashDir), 0.0);
  lobe = pow(lobe, 5.0) * (0.35 + 0.65 * lobe * lobe);
  vec3 bolt = vec3(0.7, 0.83, 1.0) * uFlash * (0.03 + 2.0 * lobe * (0.2 + 0.8 * cell));
  // thin cloud glows, the thick cores stay darker: the deck reads as lit from inside
  cloud += bolt * (0.3 + 0.7 * exp(-cover * cover * 1.8));
  sky += bolt * 0.1;

  vec3 col = mix(sky, cloud, alpha);
  vec3 horizon = uHorizon + bolt * 0.25;
  col = mix(col, horizon, exp(-h * 16.0));
  // below the horizon: dark wet ground, for the environment capture and for gaps in the level
  col = mix(col, horizon * 0.25, smoothstep(0.0, -0.12, d.y));
#ifdef CAPTURE
  col = min(col, vec3(6.0));
#endif
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}`;

// Flash envelope: a fast main stroke and two weaker re-strikes, then a tail. t in seconds since the strike.
function flashEnvelope(t, strokes) {
  let v = 0;
  for (const s of strokes) {
    const x = t - s.at;
    if (x < 0) continue;
    v += s.amp * Math.min(1, x / 0.025) * Math.exp(-x / s.decay);
  }
  return v;
}

export function createSky(G) {
  const soft = installSoftShadows(G.renderer);
  const rng = G.rng.fork('sky');
  const moonDir = new Vector3();
  const horizonBase = new Color().setRGB(0.02, 0.022, 0.03);
  const fog = { color: new Color().copy(horizonBase), density: 0.012, heightFalloff: 0.08 };

  const uniforms = {
    uMoonDir: { value: moonDir }, uMoonColor: { value: MOON_COLOR.clone().multiplyScalar(1.0) },
    uHorizon: { value: fog.color }, uGlowDir: { value: new Vector3(0.6, 0, 0.8) },
    uFlashDir: { value: new Vector3(0, 0.3, -1).normalize() }, uFlash: { value: 0 }, uTime: { value: 0 }, uCoverage: { value: 0.47 },
  };
  const geo = new BoxGeometry(2, 2, 2);
  const makeMat = (capture) => new ShaderMaterial({
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms, side: BackSide, depthWrite: false, fog: false,
    defines: capture ? { CAPTURE: 1 } : {},
  });
  const dome = new Mesh(geo, makeMat(false));
  dome.name = 'sky';
  dome.frustumCulled = false;
  dome.renderOrder = 1000; // after the opaque world: only uncovered pixels are shaded
  G.scene.add(dome);

  // ---- moon light ----------------------------------------------------------------------------
  const moonLight = new DirectionalLight(MOON_COLOR, MOON_LUX);
  moonLight.name = 'moon';
  moonLight.castShadow = true;
  G.scene.add(moonLight, moonLight.target);
  const moon = { dir: moonDir, color: moonLight.color, intensity: MOON_LUX, shadowMap: null, shadowMatrix: moonLight.shadow.matrix };

  // ---- environment capture -------------------------------------------------------------------
  const captureScene = new Scene();
  const captureDome = new Mesh(geo, makeMat(true));
  captureDome.frustumCulled = false;
  captureScene.add(captureDome);
  const pmrem = new PMREMGenerator(G.renderer);
  let envTarget = null;
  let capturedFlash = -1;
  let sinceCapture = 1e9;
  function capture(flash) {
    uniforms.uFlash.value = flash;
    if (envTarget && typeof pmrem._allocateTarget === 'function') {
      // Reuse the first target: the environment texture object never changes, so no material is
      // re-initialised when lightning re-captures. (three allocates a new target per call otherwise.)
      const own = pmrem._allocateTarget;
      pmrem._allocateTarget = () => envTarget;
      try { pmrem.fromScene(captureScene, 0, 0.1, 10, { size: 256 }); } finally { pmrem._allocateTarget = own; }
    } else {
      const old = envTarget;
      envTarget = pmrem.fromScene(captureScene, 0, 0.1, 10, { size: 256 });
      if (old) old.dispose();
    }
    G.scene.environment = envTarget.texture;
    sky.envMap = envTarget.texture;
    capturedFlash = flash;
    sinceCapture = 0;
    sky.captures++;
    G.renderer.setRenderTarget(null);
  }

  // ---- lightning -----------------------------------------------------------------------------
  let strokes = null;
  let strikeAge = 0;
  let strength = 0;

  const sky = {
    envMap: null, moonDir, moon, fog, flash: 0, dome, moonLight,
    captures: 0, // environment captures so far (debug)
    setMoon(azimuth, elevation) {
      const c = Math.cos(elevation);
      moonDir.set(Math.sin(azimuth) * c, Math.sin(elevation), -Math.cos(azimuth) * c).normalize();
      if (envTarget) capture(Math.max(capturedFlash, 0));
    },
    // azimuth (optional, radians, same convention as setMoon) fixes where the flash is; default is random
    lightning(s = 1, azimuth) {
      strength = Math.min(1, Math.max(0, s));
      strikeAge = 0;
      strokes = [
        { at: 0, amp: 1, decay: 0.07 },
        { at: rng.range(0.11, 0.17), amp: rng.range(0.45, 0.75), decay: 0.06 },
        { at: rng.range(0.24, 0.36), amp: rng.range(0.2, 0.45), decay: 0.12 },
      ];
      const a = azimuth ?? rng.range(0, Math.PI * 2);
      uniforms.uFlashDir.value.set(Math.sin(a), rng.range(0.3, 0.55), -Math.cos(a)).normalize();
    },
    update(dt) {
      if (test) test.update();
      uniforms.uTime.value = G.time.t;

      let flash = 0;
      if (strokes) {
        strikeAge += dt;
        flash = strength * Math.min(1, flashEnvelope(strikeAge, strokes));
        if (strikeAge > 0.2 && flash < 0.004) { strokes = null; flash = 0; }
      }
      sky.flash = flash;
      uniforms.uFlash.value = flash;
      fog.color.setRGB(horizonBase.r + FLASH_FOG.r * flash, horizonBase.g + FLASH_FOG.g * flash, horizonBase.b + FLASH_FOG.b * flash);

      sinceCapture += dt;
      const due = sinceCapture >= 1 / CAPTURE_HZ;
      if ((flash > 0 && (capturedFlash === 0 || due)) || (flash === 0 && capturedFlash !== 0)) capture(flash);
      uniforms.uFlash.value = flash;
      G.scene.environmentIntensity = (ENV_FILL * (1 + ENV_FLASH_RATIO * flash)) / (1 + ENV_FLASH_RATIO * capturedFlash);

      const res = G.quality.shadowRes || 2048;
      if (moonLight.shadow.mapSize.x !== res) configureMoonShadow(moonLight, { mapSize: res });
      fitMoonShadow(moonLight, G.camera, moonDir);
      moon.shadowMap = soft && moonLight.shadow.map ? moonLight.shadow.map.depthTexture : null;
      moon.intensity = moonLight.intensity;
    },
  };
  const FLASH_FOG = new Color().setRGB(0.1, 0.12, 0.15);

  configureMoonShadow(moonLight, { mapSize: G.quality.shadowRes || 2048 });
  sky.setMoon(0.42, 0.4);
  capture(0);

  const test = G.params.shot === 'lighttest' && G.lights && !G.lights.stub ? installLightTestScene(G) : null;
  return sky;
}
