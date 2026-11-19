// Fog over the city: a post-process on the finished picture (before bloom, so that lights glow in it). The fog
// lies on the ground and thins out upwards; each pixel is fogged by how much of it the ray to it passes through,
// and the sky by what a ray to the horizon would. Off (no pass at all) when there is none.
import * as THREE from 'three';
import { Effect, EffectAttribute } from 'postprocessing';

const fragment = /* glsl */ `
uniform mat4 uInverseProjection;
uniform mat4 uCamWorld;
uniform vec3 uColor;
uniform float uDensity;   // per metre, at the ground
uniform float uHeight;    // metres over which it thins to a third
uniform float uGround;    // the height of the ground (m)

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec4 p = uInverseProjection * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec3 view = p.xyz / p.w;
  vec3 dir = normalize(mat3(uCamWorld) * view);
  float dist = depth >= 1.0 ? 60000.0 : length(view);
  // the fog passed through on the way: its density falls off with height (an exponential, summed along the ray)
  float eye = (uCamWorld[3].y - uGround) / uHeight, k = dir.y * dist / uHeight;
  float through = uDensity * exp(-max(eye, 0.0)) * dist * (abs(k) > 1e-3 ? (1.0 - exp(-k)) / k : 1.0);
  float fog = 1.0 - exp(-through);
  outputColor = vec4(mix(inputColor.rgb, uColor, fog), inputColor.a);
}
`;

export class FogEffect extends Effect {
  constructor(camera) {
    super('Fog', fragment, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map([
        ['uInverseProjection', new THREE.Uniform(camera.projectionMatrixInverse)],
        ['uCamWorld', new THREE.Uniform(camera.matrixWorld)],
        ['uColor', new THREE.Uniform(new THREE.Color(0.7, 0.72, 0.75))],
        ['uDensity', new THREE.Uniform(0)],
        ['uHeight', new THREE.Uniform(160)],
        ['uGround', new THREE.Uniform(0)],
      ]),
    });
  }
}
