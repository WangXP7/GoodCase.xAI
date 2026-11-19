// Lamp light on the ground at night: street lamps, car and train headlamps.
// Every lamp is a flat quad carrying the footprint of its light. The quads are not drawn in the picture:
// they are drawn from straight above into a light map around the focus, where overlapping lamps keep the
// brighter of the two (lights never pile up into a glare), and every lit surface that faces the sky takes its
// lamp light from that map — as light on its own colour, so asphalt stays asphalt and paint stays paint.
import * as THREE from 'three';
import { shared } from './materials.js';

export const LAMP_LAYER = 2; // the layer the lamp quads live on: the picture's camera does not see it
// The lamp quads stand in a scene of their own, not in the city's: drawing the light map (three times per frame)
// does not walk the city, and drawing the city does not walk the lamps.
export const lampScene = new THREE.Scene();
lampScene.matrixWorldAutoUpdate = false; // (the quads are placed by their instance matrices, in the world's own frame)
const SIZE = 2048;
const Y0 = 200, YSPAN = 1000; // heights are stored as (y + Y0) / YSPAN
// Lights lie one above the other where a flyover crosses a street, and each level must keep its own: the map
// has two halves, side by side. First the heights are drawn: at every point the highest and the lowest light
// there. Then the lights themselves, twice: into the left half only those at the highest height, into the right
// half only those at the lowest — so a car's headlamps on the deck light the deck and not the street under it,
// and the street keeps its own lamps.
const lampPass = { value: 0 };       // 0: heights; 1: the highest lights; 2: the lowest
const lampHeights = { value: null }; // the heights drawn in pass 0 (r: highest, g: 1 - lowest)

// Material for a lamp quad: `map` is the footprint; the colour (times the vertex colour, if any) is the light.
export function lampMaterial(map, params = {}) {
  const m = new THREE.MeshBasicMaterial({
    map, side: THREE.DoubleSide, depthTest: false, depthWrite: false, transparent: true,
    forceSinglePass: true, // (both faces in one draw: three would draw a transparent two-sided thing twice, and look its shader up anew each time)
    blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, ...params,
  });
  // The height the light lies at goes into the alpha channel, so that a lamp under a flyover does not light
  // the deck above it, nor a car on the deck the street below. (Lights keep the greater value where they
  // overlap: for the lowest height, the height is written the other way up.)
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uLampPass = lampPass; shader.uniforms.uLampHeights = lampHeights;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vLampY;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 lampWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
        lampWorld = instanceMatrix * lampWorld;
        #endif
        vLampY = (modelMatrix * lampWorld).y;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vLampY;\nuniform float uLampPass;\nuniform sampler2D uLampHeights;')
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        float lampHeight = (vLampY + ${Y0}.0) / ${YSPAN}.0, lampLit = step(0.004, dot(gl_FragColor.rgb, vec3(1.0)));
        if (uLampPass < 0.5) gl_FragColor = vec4(lampHeight, 1.0 - lampHeight, 0.0, 0.0) * lampLit;
        else {
          // (only the lights of this half's level: within three metres of the highest, or of the lowest)
          vec2 known = texture2D(uLampHeights, (gl_FragCoord.xy - vec2(uLampPass > 1.5 ? ${SIZE}.0 : 0.0, 0.0)) / ${SIZE}.0).rg;
          float level = uLampPass > 1.5 ? 1.0 - known.g : known.r;
          float mine = lampLit * step(abs(lampHeight - level), 3.0 / ${YSPAN}.0);
          gl_FragColor = vec4(gl_FragColor.rgb * mine, lampHeight * mine);
        }`);
  };
  m.customProgramCacheKey = () => 'lamp-quad-v3';
  return m;
}

// Call once, before any material is compiled: teaches three's lit materials to read the light map.
export function installLampLight() {
  THREE.ShaderChunk.lights_pars_begin += /* glsl */ `
uniform float uLampOn;
uniform sampler2D uLampMap;
uniform vec4 uLampRect; // centre x, centre z, half size, 0
`;
  THREE.ShaderChunk.lights_fragment_end += /* glsl */ `
if (uLampOn > 0.5) {
  mat3 lampToWorld = transpose(mat3(viewMatrix));
  vec3 lampAt = cameraPosition + lampToWorld * geometryPosition;
  vec2 lampUv = vec2(lampAt.x - uLampRect.x, uLampRect.y - lampAt.z) / (2.0 * uLampRect.z) + 0.5;
  vec2 lampEdge = smoothstep(vec2(0.0), vec2(0.04), lampUv) * (1.0 - smoothstep(vec2(0.96), vec2(1.0), lampUv));
  float lampUp = smoothstep(0.25, 0.7, (lampToWorld * geometryNormal).y);
  // only light lying at this height: from the map of the highest lights, or from that of the lowest
  vec4 lampHigh = texture2D(uLampMap, vec2(lampUv.x * 0.5, lampUv.y)), lampLow = texture2D(uLampMap, vec2(lampUv.x * 0.5 + 0.5, lampUv.y));
  float lampLevelHigh = 1.0 - smoothstep(2.5, 5.0, abs(lampAt.y - (lampHigh.a * ${YSPAN}.0 - ${Y0}.0)));
  float lampLevelLow = 1.0 - smoothstep(2.5, 5.0, abs(lampAt.y - (lampLow.a * ${YSPAN}.0 - ${Y0}.0)));
  vec3 lampLight = max(lampHigh.rgb * lampLevelHigh, lampLow.rgb * lampLevelLow);
  reflectedLight.directDiffuse += lampLight * lampEdge.x * lampEdge.y * lampUp * material.diffuseColor;
}
`;
  // Plain materials get the uniforms here. A material with a hook of its own sets them itself: lampUniforms
  // (shader) to take part, or uLampOn 0 and the map to stay out (buildings, vehicles: a roof is far above the
  // lamps). The map must always be given: a sampler left unset falls on texture unit 0, and if the material
  // has a texture of another kind there (the facades' texture arrays), nothing is drawn at all.
  THREE.Material.prototype.onBeforeCompile = function (shader) { lampUniforms(shader); };
}
export function lampUniforms(shader) {
  shader.uniforms.uLampOn = shared.uLampOn; shader.uniforms.uLampMap = shared.uLampMap; shader.uniforms.uLampRect = shared.uLampRect;
}

export class LampLight {
  constructor(renderer) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(2 * SIZE, SIZE, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
    this.camera.up.set(0, 0, -1);
    this.camera.layers.set(LAMP_LAYER);
    this.half = 0;
    this.black = new THREE.Color(0, 0, 0);
    this.heights = new THREE.WebGLRenderTarget(SIZE, SIZE, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.none = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    this.none.needsUpdate = true;
    lampHeights.value = this.none;
    shared.uLampMap.value = this.target.texture;
  }

  // focus: what the view looks at; eye: the camera's position.
  update(focus, eye, night) {
    const scene = lampScene;
    shared.uLampOn.value = night > 0.02 ? 1 : 0;
    if (night <= 0.02) return;
    // the map reaches as far as the view does (in coarse steps), and moves a whole texel at a time
    const want = THREE.MathUtils.clamp(eye.distanceTo(focus) * 1.6, 350, 2400), half = 350 * 1.35 ** Math.ceil(Math.log(want / 350) / Math.log(1.35));
    const cam = this.camera;
    if (half !== this.half) { this.half = half; cam.left = cam.bottom = -half; cam.right = cam.top = half; cam.updateProjectionMatrix(); }
    const texel = (2 * half) / SIZE, cx = Math.round(focus.x / texel) * texel, cz = Math.round(focus.z / texel) * texel;
    cam.position.set(cx, focus.y + 2000, cz);
    cam.lookAt(cx, focus.y, cz);
    shared.uLampRect.value.set(cx, cz, half, 0);

    const r = this.renderer, shadows = r.shadowMap.autoUpdate, background = scene.background, previous = r.getRenderTarget();
    const clear = r.getClearColor(new THREE.Color()), alpha = r.getClearAlpha();
    r.shadowMap.autoUpdate = false; scene.background = null; // (only the lamp quads are of interest)
    r.setClearColor(this.black, 0);
    lampPass.value = 0; // the heights
    lampHeights.value = this.none; // (a target cannot be read while it is drawn into)
    r.setRenderTarget(this.heights);
    r.clear();
    r.render(scene, cam);
    lampHeights.value = this.heights.texture;
    this.target.viewport.set(0, 0, 2 * SIZE, SIZE);
    r.setRenderTarget(this.target);
    r.clear();
    const autoClear = r.autoClear;
    r.autoClear = false; // (a clear is not kept to the viewport: the second drawing would wipe the first)
    for (const pass of [1, 2]) { // the highest lights into the left half, the lowest into the right
      lampPass.value = pass;
      this.target.viewport.set((pass - 1) * SIZE, 0, SIZE, SIZE);
      r.setRenderTarget(this.target); // (takes the viewport)
      r.render(scene, cam);
    }
    this.target.viewport.set(0, 0, 2 * SIZE, SIZE);
    r.autoClear = autoClear;
    r.setRenderTarget(previous);
    r.setClearColor(clear, alpha);
    r.shadowMap.autoUpdate = shadows; scene.background = background;
  }
}
