// Fire, light and the special surfaces of things that burn, grow and fade.
//  - material variants of the prop surface: glowing coals, briar that burns away, briar that grows,
//    the cloth of a Shade
//  - Fx: every flame and glowing thing in the world asks for its particles and its light here
import * as THREE from 'three';
import { createPropMaterial } from '../gfx/propMaterial.js';
import { worldMaterial } from '../gfx/atmos.js';
import { addPatch, after } from '../gfx/patch.js';

const FRAG_MAIN_START = '#include <clipping_planes_fragment>';

/** Coals: cold grey in the model, lit from within by uHeat 0..1. */
export function heatMaterial(tint = [1, 1, 1]) {
  const m = createPropMaterial();
  const u = (m.userData.u = { uHeat: { value: 0 }, uHeatTint: { value: new THREE.Color(tint[0], tint[1], tint[2]) } });
  addPatch(
    m,
    (shader) => {
      shader.uniforms.uHeat = u.uHeat;
      shader.uniforms.uHeatTint = u.uHeatTint;
      shader.fragmentShader = after(shader.fragmentShader, '#include <common>', 'uniform float uHeat;\nuniform vec3 uHeatTint;', 'heat pars');
      shader.fragmentShader = after(
        shader.fragmentShader,
        '#include <emissivemap_fragment>',
        /* glsl */ `
{
  float hn = tpNoise(vUvw * 11.0 + vec3(0.0, uTime * 0.3, 0.0)) * 0.65 + tpNoise(vUvw * 31.0 - vec3(uTime * 0.45, 0.0, uTime * 0.2)) * 0.35;
  float hk = smoothstep(1.02 - uHeat * 1.05, 1.3 - uHeat * 0.85, hn + 0.3) * step(0.004, uHeat);
  vec3 hc = mix(vec3(1.0, 0.1, 0.01), vec3(1.0, 0.5, 0.12), hk * uHeat);
  totalEmissiveRadiance += hc * uHeatTint * hk * (1.5 + 7.0 * uHeat);
}
`,
        'heat emissive'
      );
    },
    'heat'
  );
  return worldMaterial(m);
}

/** Briar that burns away: uBurn 0 whole .. 1 gone, eaten from the edges of a noise with a live rim. */
export function burnMaterial() {
  const m = createPropMaterial();
  const u = (m.userData.u = { uBurn: { value: 0 } });
  addPatch(
    m,
    (shader) => {
      shader.uniforms.uBurn = u.uBurn;
      shader.fragmentShader = after(shader.fragmentShader, '#include <common>', 'uniform float uBurn;\nfloat tpBurnEdge = 1.0;', 'burn pars');
      shader.fragmentShader = after(
        shader.fragmentShader,
        FRAG_MAIN_START,
        /* glsl */ `
if (uBurn > 0.0) {
  float bn = tpNoise(vTpWorld * 1.3) * 0.55 + tpNoise(vTpWorld * 4.7 + 3.1) * 0.3 + tpNoise(vTpWorld * 15.0 + 9.2) * 0.15;
  tpBurnEdge = bn - uBurn * 1.12 + 0.04;
  if (tpBurnEdge < 0.0) discard;
}
`,
        'burn discard'
      );
      shader.fragmentShader = after(shader.fragmentShader, '#include <color_fragment>', 'if (uBurn > 0.0) diffuseColor.rgb *= mix(0.08, 1.0, smoothstep(0.0, 0.3, tpBurnEdge));', 'burn char');
      shader.fragmentShader = after(
        shader.fragmentShader,
        '#include <emissivemap_fragment>',
        'if (uBurn > 0.0) totalEmissiveRadiance += mix(vec3(1.0, 0.62, 0.2), vec3(1.0, 0.16, 0.02), smoothstep(0.0, 0.09, tpBurnEdge)) * (1.0 - smoothstep(0.0, 0.11, tpBurnEdge)) * 12.0;',
        'burn rim'
      );
    },
    'burn'
  );
  return worldMaterial(m);
}

/** Briar that grows: only what lies below uGrowY (world metres) exists yet. */
export function growMaterial() {
  const m = createPropMaterial();
  const u = (m.userData.u = { uGrowY: { value: 1e6 } });
  addPatch(
    m,
    (shader) => {
      shader.uniforms.uGrowY = u.uGrowY;
      shader.fragmentShader = after(shader.fragmentShader, '#include <common>', 'uniform float uGrowY;', 'grow pars');
      shader.fragmentShader = after(
        shader.fragmentShader,
        FRAG_MAIN_START,
        /* glsl */ `
{
  float gy = uGrowY + (tpNoise(vTpWorld * 3.0) - 0.5) * 0.5;
  if (vTpWorld.y > gy) discard;
}
`,
        'grow discard'
      );
      shader.fragmentShader = after(
        shader.fragmentShader,
        '#include <emissivemap_fragment>',
        'totalEmissiveRadiance += vec3(0.35, 0.9, 0.25) * (1.0 - smoothstep(0.0, 0.5, uGrowY - vTpWorld.y)) * 2.2;',
        'grow tip'
      );
    },
    'grow'
  );
  return worldMaterial(m);
}

/**
 * The cloth of a Shade: darker than the dark, a violet rim, ragged at the hem, and able to come
 * apart (uFade 0 whole .. 1 gone) or to stand frozen (uFrost 0..1).
 */
export function ghostMaterial() {
  const m = createPropMaterial();
  const u = (m.userData.u = { uFade: { value: 0 }, uFrost: { value: 0 }, uBase: { value: new THREE.Vector2(0, 2.2) } });
  addPatch(
    m,
    (shader) => {
      shader.uniforms.uFade = u.uFade;
      shader.uniforms.uFrost = u.uFrost;
      shader.uniforms.uBase = u.uBase;
      shader.fragmentShader = after(shader.fragmentShader, '#include <common>', 'uniform float uFade;\nuniform float uFrost;\nuniform vec2 uBase;\nfloat tpGhostEdge = 1.0;', 'ghost pars');
      shader.fragmentShader = after(
        shader.fragmentShader,
        FRAG_MAIN_START,
        /* glsl */ `
{
  float gh = clamp((vTpWorld.y - uBase.x) / uBase.y, 0.0, 1.0);
  float gn = tpNoise(vTpWorld * 2.6 + vec3(0.0, -uTime * 0.5 * (1.0 - uFrost), 0.0)) * 0.6 + tpNoise(vTpWorld * 8.0 + 4.0) * 0.4;
  // the hem is never quite there
  float hem = smoothstep(0.0, 0.42, gh);
  tpGhostEdge = gn + hem * 0.75 - 0.42 - uFade * 1.5;
  if (tpGhostEdge < 0.0) discard;
}
`,
        'ghost discard'
      );
      shader.fragmentShader = after(shader.fragmentShader, '#include <color_fragment>', 'diffuseColor.rgb = mix(diffuseColor.rgb * 0.55, vec3(0.62, 0.78, 0.9), uFrost * 0.75);', 'ghost colour');
      shader.fragmentShader = after(
        shader.fragmentShader,
        '#include <emissivemap_fragment>',
        /* glsl */ `
{
  vec3 gv = normalize(vViewPosition);
  float rim = pow(1.0 - abs(dot(normal, gv)), 2.6);
  vec3 gc = mix(vec3(0.5, 0.26, 0.95), vec3(0.6, 0.85, 1.0), uFrost);
  totalEmissiveRadiance += gc * (rim * 0.85 + (1.0 - smoothstep(0.0, 0.12, tpGhostEdge)) * (0.5 + 3.0 * uFade));
}
`,
        'ghost rim'
      );
    },
    'ghost'
  );
  m.roughness = 1;
  return worldMaterial(m);
}

const _v = new THREE.Vector3();
const _c = new THREE.Color();
const LIGHT_GAIN = 7; // model light units -> candela

/**
 * Flames and lights. A "source" is one burning or glowing point: a particle emitter (optional)
 * and a light (optional), switched and scaled together.
 */
export class Fx {
  constructor(game) {
    this.game = game;
    this.sources = [];
    this.t = 0;
  }

  /**
   * { x, y, z, kind: particle emitter kind or null, size, color (particles), smoke,
   *   light: { color, intensity (candela), range } | null, far, flicker 0..1 }
   */
  source(spec) {
    const P = this.game.particles;
    const s = {
      x: spec.x,
      y: spec.y,
      z: spec.z,
      power: spec.power != null ? spec.power : 1,
      on: spec.on !== false,
      em: null,
      light: null,
      flicker: spec.flicker != null ? spec.flicker : 0.22,
      ph: Math.random() * 100,
      far: spec.far || 70,
    };
    if (spec.kind) {
      s.em = P.emitter({ kind: spec.kind, x: s.x, y: s.y, z: s.z, size: spec.size || 0.3, color: spec.color || null, far: s.far, smoke: spec.smoke, rate: spec.rate || 1, radius: spec.radius, alpha: spec.alpha, power: s.power, active: s.on });
    }
    if (spec.light) s.light = { color: new THREE.Color(spec.light.color), intensity: spec.light.intensity, range: spec.light.range, dy: spec.light.dy || 0 };
    this.sources.push(s);
    return s;
  }
  /** Change a source: { on, power, x, y, z }. */
  set(s, o) {
    if (o.on != null) s.on = o.on;
    if (o.power != null) s.power = o.power;
    if (o.x != null) {
      s.x = o.x;
      s.y = o.y;
      s.z = o.z;
    }
    if (s.em) {
      s.em.active = s.on && s.power > 0.01;
      s.em.power = s.power;
      s.em.x = s.x;
      s.em.y = s.y;
      s.em.z = s.z;
    }
  }
  remove(s) {
    if (!s) return;
    if (s.em) this.game.particles.remove(s.em);
    const i = this.sources.indexOf(s);
    if (i >= 0) this.sources.splice(i, 1);
  }

  /**
   * Everything a model declares: its emitters and its lights, in the world. Returns the sources.
   * opts: { on, far, only: (emitter) => bool, lights: bool }
   */
  attach(placed, opts = {}) {
    const out = [];
    const model = placed.model;
    const sc = placed.scale;
    const lights = (model.lights || []).slice();
    for (const e of model.emitters || []) {
      if (opts.only && !opts.only(e)) continue;
      placed.anchor(e.pos, _v);
      let kind = e.type;
      if (kind === 'fire' && (e.size || 0.3) * sc < 0.08) kind = 'candle';
      // a light declared at (nearly) the same place rides with this emitter
      let light = null;
      for (let i = 0; i < lights.length; i++) {
        const l = lights[i];
        if (Math.hypot(l.pos[0] - e.pos[0], l.pos[1] - e.pos[1], l.pos[2] - e.pos[2]) < 0.25) {
          light = { color: l.color, intensity: l.intensity * LIGHT_GAIN, range: l.range * 1.7 * Math.max(1, sc) };
          lights.splice(i, 1);
          break;
        }
      }
      out.push(this.source({ x: _v.x, y: _v.y, z: _v.z, kind, size: (e.size || 0.3) * sc, color: e.color || null, radius: e.radius, rate: e.rate, light, far: opts.far || 45, on: opts.on !== false, flicker: kind === 'fire' || kind === 'candle' ? 0.25 : 0.08 }));
    }
    if (opts.lights !== false)
      for (const l of lights) {
        placed.anchor(l.pos, _v);
        out.push(this.source({ x: _v.x, y: _v.y, z: _v.z, kind: null, light: { color: l.color, intensity: l.intensity * LIGHT_GAIN, range: l.range * 1.7 * Math.max(1, sc) }, far: opts.far || 45, on: opts.on !== false, flicker: 0.06 }));
      }
    return out;
  }

  /** A short flash of light that fades by itself. */
  flash(x, y, z, color, intensity, range, seconds = 0.6) {
    this.sources.push({ x, y, z, power: 1, on: true, em: null, light: { color: new THREE.Color(color), intensity, range, dy: 0 }, flicker: 0, ph: 0, far: 200, ttl: seconds, ttl0: seconds });
  }

  update(dt) {
    this.t += dt;
    const t = this.t;
    const L = this.game.engine.lighting;
    const cam = this.game.engine.camera.position;
    for (let i = this.sources.length - 1; i >= 0; i--) {
      const s = this.sources[i];
      let k = s.power;
      if (s.ttl != null) {
        s.ttl -= dt;
        if (s.ttl <= 0) {
          this.sources.splice(i, 1);
          continue;
        }
        const f = s.ttl / s.ttl0;
        k = f * f;
      }
      if (!s.on || !s.light || k <= 0.01) continue;
      const dx = s.x - cam.x,
        dy = s.y - cam.y,
        dz = s.z - cam.z;
      if (dx * dx + dy * dy + dz * dz > 70 * 70) continue;
      const fl = 1 + s.flicker * (Math.sin(t * 11.3 + s.ph) * 0.55 + Math.sin(t * 23.7 + s.ph * 1.7) * 0.3 + Math.sin(t * 4.1 + s.ph * 0.6) * 0.4);
      L.point(s.x, s.y + s.light.dy, s.z, _c.copy(s.light.color), s.light.intensity * k * fl, s.light.range * (0.85 + 0.15 * Math.min(1, k)));
    }
  }
}
