// Moor grass: two rings of tufts that follow the eye. Every tuft is placed, shaped, coloured and
// blown about in the vertex shader from its lattice cell alone, so nothing is uploaded per frame.
import * as THREE from 'three';
import { shared } from './shared.js';
import { worldMaterial } from './atmos.js';
import { addPatch, after } from './patch.js';
import { LAYER_MAIN_ONLY } from './engine.js';

const VERT_PARS = /* glsl */ `
uniform vec4 uGrass;  // cell size, cells per side, fade-out start, fade-out end
uniform vec4 uGrassB; // fade-in start, fade-in end, blade width, blade height
varying vec3 vGrassCol;
`;

const VERT_MAIN = /* glsl */ `
vec3 tpGrassPos;
{
  float gN = uGrass.y, gCell = uGrass.x, gL = gN * gCell;
  float gid = float(gl_InstanceID);
  vec2 gBase = (vec2(mod(gid, gN), floor(gid / gN)) + 0.5) * gCell;
  vec2 gCellW = gBase + floor((cameraPosition.xz - gBase) / gL + 0.5) * gL;
  vec2 gId = floor(gCellW / gCell);
  float h1 = tpHash21(gId), h2 = tpHash21(gId + 17.31), h3 = tpHash21(gId * 1.7 + 5.1);
  vec2 gPos = gCellW + (vec2(h1, h2) - 0.5) * gCell;
  vec2 luv = tpLandUV(gPos);
  vec4 mA = texture2D(uMaskA, luv);
  vec4 mB = texture2D(uMaskB, luv);
  vec4 fx = texture2D(uFxTex, luv);
  float gy = tpHeight(gPos);
  float dist = distance(vec3(gPos.x, gy, gPos.y), cameraPosition);
  float fade = (1.0 - smoothstep(uGrass.z, uGrass.w, dist)) * smoothstep(uGrassB.x, uGrassB.y, dist);
  float clump = texture2D(uNoiseTex, gPos * 0.021).a;
  float dens = mA.a * (0.55 + 0.75 * clump) + fx.b;
  float alive = smoothstep(h3 - 0.08, h3 + 0.08, dens) * fade * (1.0 - fx.r);

  float b = position.z;
  float hb = tpHash21(gId + b * 7.7 + 3.3);
  float az = (h1 + b * 0.37 + hb * 0.5) * 6.2831853;
  vec2 dirA = vec2(cos(az), sin(az));
  vec2 perp = vec2(-dirA.y, dirA.x);
  float lean = 0.22 + 0.85 * hb;
  float H = uGrassB.w * (0.5 + 0.95 * h2) * (0.8 + 0.4 * hb);
  H *= 1.0 + 0.45 * mB.r - 0.25 * smoothstep(0.6, 0.85, mB.b) - 0.3 * mA.r + 0.7 * fx.b + 0.5 * (clump - 0.5);
  H *= mix(1.0, 0.62, smoothstep(26.0, 70.0, dist));
  float W = uGrassB.z * (0.7 + 0.6 * hb);
  float t = position.y, side = position.x;
  float curve = t * t;

  // blades root round the tuft, not all at one point
  vec2 root = gPos + dirA * gCell * 0.55 * fract(hb * 7.31);
  vec3 p = vec3(root.x, gy, root.y);
  p.xz += perp * side * W * (1.0 - t * 0.86);
  p.xz += dirA * lean * H * curve;
  p.y += H * t * (1.0 - 0.55 * lean * curve);

  // wind: slow fronts rolling over the moor, and each blade's own flutter
  vec2 wdir = uWind.xy;
  float front = texture2D(uNoiseTex, gPos * 0.011 - wdir * uTime * 0.03).r;
  float flut = sin(uTime * (2.1 + h1 * 1.6) + h2 * 6.28 + gPos.x * 0.7 + b);
  float bend = ((front * 1.7 - 0.5) * uWind.z + flut * 0.05 * (0.4 + uWind.z)) * (1.0 - fx.g);
  p.xz += wdir * bend * H * curve * 1.15;
  p.y -= abs(bend) * H * curve * 0.35;

  // whoever walks here pushes it flat
  vec2 away = gPos - uPlayer.xz;
  float pd = length(away);
  float push = (1.0 - smoothstep(0.15, uPlayer.w, pd)) * step(abs(uPlayer.y - gy), 1.4);
  p.xz += (away / max(pd, 1e-3)) * push * H * 0.75 * curve;
  p.y -= push * H * 0.6 * curve;

  tpGrassPos = mix(vec3(gPos.x, gy - 0.1, gPos.y), p, alive);
  // lit like the ground it grows from, so a slope turned from the sun is dark grass too
  vec2 gNxz = texture2D(uNrmTex, luv).xy * 2.0 - 1.0;
  vec3 gNrm = vec3(gNxz.x, sqrt(max(0.0, 1.0 - dot(gNxz, gNxz))), gNxz.y);
  objectNormal = normalize(gNrm * 1.25 + vec3(dirA.x * 0.2 + wdir.x * bend * 0.4, 0.0, dirA.y * 0.2 + wdir.y * bend * 0.4));

  // colour: the same big stains as the ground under it, dark at the root
  float bn1 = texture2D(uNoiseTex, gPos * 0.0113).r;
  float gp = texture2D(uNoiseTex, gPos * 0.031).g;
  vec3 tip = mix(vec3(0.04, 0.046, 0.025), vec3(0.118, 0.106, 0.064), h2 * 0.8 + hb * 0.2);
  tip = mix(tip, vec3(0.036, 0.05, 0.024), smoothstep(0.5, 0.75, gp) * 0.6);
  tip *= mix(vec3(0.72, 0.76, 0.7), vec3(1.16, 1.08, 0.9), bn1);
  tip = mix(tip, tip * vec3(0.98, 0.66, 0.78), smoothstep(0.6, 0.85, mB.b) * 0.55);
  tip = mix(tip, vec3(0.2, 0.19, 0.17), mA.r * 0.85);
  tip = mix(tip, tip * vec3(0.8, 0.95, 0.75) * 0.85, mB.r * 0.6);
  tip = mix(tip, vec3(0.5, 0.62, 0.72), fx.g * 0.85);
  tip = mix(tip, vec3(0.05, 0.13, 0.03), fx.b * 0.7);
  vGrassCol = tip * mix(0.42, 1.0, sqrt(t)) * (0.85 + 0.3 * hb) * (0.84 + 0.3 * texture2D(uNoiseTex, gPos * 0.0031 + 0.4).b);
}
`;

function tuftGeometry(blades, segs) {
  const pos = [],
    idx = [];
  for (let b = 0; b < blades; b++) {
    const base = pos.length / 3;
    for (let s = 0; s < segs; s++) {
      const t = s / segs;
      pos.push(-0.5, t, b, 0.5, t, b);
    }
    pos.push(0, 1, b);
    for (let s = 0; s < segs - 1; s++) {
      const a = base + s * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const a = base + (segs - 1) * 2;
    idx.push(a, a + 1, a + 2);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  // three needs a normal attribute for a lit material; the shader overrides it
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).fill(0), 3));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  g.boundingBox = new THREE.Box3(new THREE.Vector3(-1e9, -1e9, -1e9), new THREE.Vector3(1e9, 1e9, 1e9));
  return g;
}

function ring(blades, segs, uniforms) {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  worldMaterial(m);
  addPatch(
    m,
    (shader) => {
      shader.uniforms.uGrass = uniforms.uGrass;
      shader.uniforms.uGrassB = uniforms.uGrassB;
      shader.vertexShader = after(shader.vertexShader, '#include <common>', VERT_PARS, 'grass pars');
      shader.vertexShader = after(shader.vertexShader, '#include <beginnormal_vertex>', VERT_MAIN, 'grass main');
      shader.vertexShader = after(shader.vertexShader, '#include <begin_vertex>', 'transformed = tpGrassPos;', 'grass pos');
      // one hard shadow tap is plenty for a blade of grass
      shader.fragmentShader = '#undef SHADOWMAP_TYPE_PCF_SOFT\n' + shader.fragmentShader;
      shader.fragmentShader = after(shader.fragmentShader, '#include <common>', 'varying vec3 vGrassCol;', 'grass fpars');
      shader.fragmentShader = after(shader.fragmentShader, '#include <color_fragment>', 'diffuseColor.rgb = vGrassCol;', 'grass col');
      shader.fragmentShader = after(shader.fragmentShader, '#include <normal_fragment_begin>', 'normal = normalize(vNormal);', 'grass nrm');
      // the sky light that lit materials get from the environment map
      shader.fragmentShader = after(
        shader.fragmentShader,
        '#include <lights_fragment_end>',
        `reflectedLight.indirectDiffuse += diffuseColor.rgb * mix(uSkyHor, uSkyZen, 0.55) * 0.6;
{
  // looking into the sun, the blades glow through
  float tpBack = pow(max(dot(normalize(vTpWorld - cameraPosition), uSunDir), 0.0), 5.0);
  reflectedLight.directDiffuse += diffuseColor.rgb * uSunColor * (tpBack * 0.45 * tpCloudShadow(vTpWorld));
}`,
        'grass ibl'
      );
    },
    'grass'
  );
  const mesh = new THREE.Mesh(tuftGeometry(blades, segs), m);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.layers.set(LAYER_MAIN_ONLY);
  return mesh;
}

export class Grass {
  constructor(engine) {
    this.engine = engine;
    this.group = new THREE.Group();
    this.group.name = 'grass';
    this.nearU = { uGrass: { value: new THREE.Vector4() }, uGrassB: { value: new THREE.Vector4(-2, -1, 0.024, 0.52) } };
    this.farU = { uGrass: { value: new THREE.Vector4() }, uGrassB: { value: new THREE.Vector4(13, 19, 0.1, 0.6) } };
    this.near = ring(5, 3, this.nearU);
    this.far = ring(3, 2, this.farU);
    this.group.add(this.near, this.far);
    engine.scene.add(this.group);
    this.setDensity(engine.q.grass);
  }

  setDensity(g) {
    this.density = g;
    const nN = Math.max(96, Math.round(280 * Math.sqrt(g))),
      nF = Math.max(96, Math.round(232 * Math.sqrt(g)));
    const LN = 42,
      LF = 150;
    this.nearU.uGrass.value.set(LN / nN, nN, LN * 0.5 - 6, LN * 0.5 - 0.5);
    this.farU.uGrass.value.set(LF / nF, nF, LF * 0.5 - 20, LF * 0.5 - 1);
    // sparser lattices get wider blades so the moor stays covered
    this.nearU.uGrassB.value.z = 0.026 * Math.min(1.8, 280 / nN);
    this.farU.uGrassB.value.z = 0.1 * Math.min(1.8, 232 / nF);
    this.near.geometry.instanceCount = nN * nN;
    this.far.geometry.instanceCount = nF * nF;
  }

  update() {
    if (this.engine.q.grass !== this.density) this.setDensity(this.engine.q.grass);
    // no grass to draw from high above the island
    this.group.visible = shared.uCamPos.value.y < 200;
  }
}
