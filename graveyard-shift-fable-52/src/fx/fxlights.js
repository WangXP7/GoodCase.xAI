// Lighting shared by particles and decals. They are drawn after the scene is lit (post 'fx' slot),
// so they light themselves: an ambient term, the moon, the 4 pooled lights nearest the camera and
// the muzzle flash. Light records are the ones render/lights.js publishes as G.lights.shadowed and
// G.lights.unshadowed: { type:'spot'|'point', pos:Vector3, dir:Vector3 (the way the light travels),
// color:Color, intensity (scene candela, 0 = idle slot), range, cone (half angle), penumbra }.
// Irradiance = intensity / d^2, as three's physical lights. Shadow maps are not sampled.
import { Vector3, Vector2 } from 'three';

export const FX_LIGHTS = 5; // 4 scene lights + slot 4 = muzzle flash
const SCENE_LIGHTS = FX_LIGHTS - 1;
const FALLBACK_AMBIENT = [0.010, 0.013, 0.018]; // cold night sky when G.sky gives nothing

// Read {x,y,z}, [x,y,z] or a typed array into a Vector3. Returns out.
export function readVec(src, out) {
  if (!src) return out.set(0, 0, 0);
  if (src.x !== undefined) return out.set(+src.x || 0, +src.y || 0, +src.z || 0);
  return out.set(+src[0] || 0, +src[1] || 0, +src[2] || 0);
}

// Colour as {r,g,b}, [r,g,b] or 0xRRGGBB (sRGB hex -> linear). Returns out (Vector3 rgb).
const lin = (v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
function readColor(c, out) {
  if (c === undefined || c === null) return out.set(1, 1, 1);
  if (typeof c === 'number') {
    return out.set(lin((c >> 16) & 255), lin((c >> 8) & 255), lin(c & 255));
  }
  if (c.r !== undefined) return out.set(c.r, c.g, c.b);
  return out.set(+c[0] || 0, +c[1] || 0, +c[2] || 0);
}

export function createFxLights(G) {
  const uniforms = {
    uLightPos: { value: Array.from({ length: FX_LIGHTS }, () => new Vector3()) },
    uLightCol: { value: Array.from({ length: FX_LIGHTS }, () => new Vector3()) }, // colour * intensity
    uLightRange: { value: new Float32Array(FX_LIGHTS) }, // 0 = unbounded
    uLightDir: { value: Array.from({ length: FX_LIGHTS }, () => new Vector3(0, -1, 0)) },
    uLightCone: { value: Array.from({ length: FX_LIGHTS }, () => new Vector2(-3, -2)) }, // cos outer, cos inner; point = (-3,-2)
    uMoonDir: { value: new Vector3(0, 1, 0) }, // points at the moon
    uMoonCol: { value: new Vector3() }, // colour * scene lux
    uAmbient: { value: new Vector3().fromArray(FALLBACK_AMBIENT) },
    uFogColor: { value: new Vector3() },
    uFogDensity: { value: 0 },
    uWetness: { value: 1 },
    uTime: { value: 0 },
  };

  // Lights used when G.lights.shadowed is missing (the fx test stage registers its lamp here).
  const fallbackLights = [];
  // The flash as particles and decals see it. Same strength and colour as G.lights.setMuzzleFlash
  // (900 real cd x 1/10, range 14 m); kept here so a staged shot can pin it at an exact age.
  const muzzle = { pos: new Vector3(), color: new Vector3(1.33, 0.8, 0.35), intensity: 0, range: 14, t0: -1e9 };

  const best = new Int32Array(SCENE_LIGHTS);
  const bestD = new Float32Array(SCENE_LIGHTS);
  const tmp = new Vector3();

  function update(camPos) {
    const L = G.lights;
    const sa = L && Array.isArray(L.shadowed) ? L.shadowed : fallbackLights;
    const sb = L && Array.isArray(L.unshadowed) ? L.unshadowed : fallbackLights;
    const na = sa.length; const total = na + (sb === sa ? 0 : sb.length);
    best.fill(-1); bestD.fill(Infinity);
    for (let i = 0; i < total; i++) {
      const l = i < na ? sa[i] : sb[i - na];
      if (!l || !l.pos || !(l.intensity > 0)) continue;
      const d = readVec(l.pos, tmp).distanceToSquared(camPos);
      for (let k = 0; k < SCENE_LIGHTS; k++) {
        if (d < bestD[k]) {
          for (let j = SCENE_LIGHTS - 1; j > k; j--) { best[j] = best[j - 1]; bestD[j] = bestD[j - 1]; }
          best[k] = i; bestD[k] = d;
          break;
        }
      }
    }
    const P = uniforms.uLightPos.value; const C = uniforms.uLightCol.value; const R = uniforms.uLightRange.value;
    const Dv = uniforms.uLightDir.value; const Cn = uniforms.uLightCone.value;
    for (let k = 0; k < SCENE_LIGHTS; k++) {
      const b = best[k];
      const l = b < 0 ? null : (b < na ? sa[b] : sb[b - na]);
      if (!l) { C[k].set(0, 0, 0); R[k] = 0; Cn[k].set(-3, -2); continue; }
      readVec(l.pos, P[k]);
      readColor(l.color, C[k]).multiplyScalar(l.intensity);
      R[k] = l.range > 0 ? l.range : 0;
      if (l.type === 'spot' && l.dir && l.cone > 0) {
        readVec(l.dir, Dv[k]).normalize();
        const outer = Math.cos(l.cone);
        Cn[k].set(outer, Math.max(Math.cos(l.cone * (1 - (l.penumbra || 0))), outer + 1e-3));
      } else Cn[k].set(-3, -2);
    }
    Cn[SCENE_LIGHTS].set(-3, -2);
    const moon = G.sky && G.sky.moon;
    if (moon && moon.dir && moon.intensity > 0) {
      readVec(moon.dir, uniforms.uMoonDir.value).normalize();
      readColor(moon.color, uniforms.uMoonCol.value).multiplyScalar(moon.intensity);
    } else uniforms.uMoonCol.value.set(0, 0, 0);
    P[SCENE_LIGHTS].copy(muzzle.pos);
    C[SCENE_LIGHTS].copy(muzzle.color).multiplyScalar(muzzle.intensity);
    R[SCENE_LIGHTS] = muzzle.range;

    const fog = G.sky && G.sky.fog;
    if (fog && fog.color !== undefined) {
      readColor(fog.color, uniforms.uFogColor.value);
      uniforms.uAmbient.value.copy(uniforms.uFogColor.value);
      uniforms.uFogDensity.value = typeof fog.density === 'number' ? fog.density : 0;
    } else {
      uniforms.uAmbient.value.fromArray(FALLBACK_AMBIENT);
      uniforms.uFogDensity.value = 0;
    }
    // Indoors the level's light is baked into its surfaces and is not in the pool: without this,
    // smoke and spray in the diner are black. A flat term for the room the camera stands in (the diner
    // is the one lit room): its tubes with the power on, the one failing tube and the exit sign without.
    const lv = G.level;
    if (lv && typeof lv.zoneAt === 'function' && lv.zoneAt(camPos.x, camPos.z) === 'diner') {
      const k = lv.power && lv.power.on ? 0.3 : 0.03;
      uniforms.uAmbient.value.x += 0.95 * k; uniforms.uAmbient.value.y += 1.0 * k; uniforms.uAmbient.value.z += 0.92 * k;
    }
    const wet = G.sky && typeof G.sky.wetness === 'number' ? G.sky.wetness : 1;
    uniforms.uWetness.value = wet;
  }

  return { uniforms, fallbackLights, muzzle, update };
}

// GLSL: fxLight() accumulates diffuse, specular and back-scatter from all lights at a world point.
export const FX_LIGHT_GLSL = /* glsl */ `
#define FX_LIGHTS ${FX_LIGHTS}
uniform vec3 uLightPos[FX_LIGHTS];
uniform vec3 uLightCol[FX_LIGHTS];
uniform float uLightRange[FX_LIGHTS];
uniform vec3 uLightDir[FX_LIGHTS];
uniform vec2 uLightCone[FX_LIGHTS];
uniform vec3 uMoonDir;
uniform vec3 uMoonCol;
uniform vec3 uAmbient;
uniform vec3 uFogColor;
uniform float uFogDensity;
const float FX_PI = 3.14159265;

// diff: irradiance/pi with wrap (multiply by albedo). spec: GGX lobe * irradiance (multiply by F0).
// back: light arriving from behind the point along the view ray (thin smoke lights up when backlit).
void fxLight(vec3 P, vec3 N, vec3 V, float wrap, float rough, out vec3 diff, out vec3 spec, out vec3 back) {
  diff = vec3(0.0); spec = vec3(0.0); back = vec3(0.0);
  float a = max(rough * rough, 0.002);
  float a2 = a * a;
  for (int i = 0; i < FX_LIGHTS; i++) {
    vec3 L = uLightPos[i] - P;
    float d2 = dot(L, L);
    float att = 1.0 / (d2 + 0.05);
    float r = uLightRange[i];
    if (r > 0.0) { float q = d2 / (r * r); float w = clamp(1.0 - q * q, 0.0, 1.0); att *= w * w; }
    L *= inversesqrt(d2 + 1e-6);
    vec2 cn = uLightCone[i];
    att *= smoothstep(cn.x, cn.y, dot(-L, uLightDir[i]));
    vec3 E = uLightCol[i] * att;
    float nl = dot(N, L);
    diff += E * clamp((nl + wrap) / (1.0 + wrap), 0.0, 1.0);
    vec3 H = normalize(L + V);
    float nh = max(dot(N, H), 0.0);
    float den = nh * nh * (a2 - 1.0) + 1.0;
    spec += E * max(nl, 0.0) * min(a2 / (FX_PI * den * den), 60.0) * 0.25;
    float vb = max(dot(-V, L), 0.0);
    back += E * vb * vb * vb;
  }
  diff += uMoonCol * clamp((dot(N, uMoonDir) + wrap) / (1.0 + wrap), 0.0, 1.0);
  float mb = max(dot(-V, uMoonDir), 0.0);
  back += uMoonCol * mb * mb * mb;
  diff = diff / FX_PI + uAmbient;
  back /= FX_PI;
}
// premultiplied colour -> fogged premultiplied colour
vec3 fxFog(vec3 premul, float alpha, float dist) {
  float f = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  return mix(premul, uFogColor * alpha, f);
}
`;
