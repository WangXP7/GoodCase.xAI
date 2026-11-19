// Birds over the city: flocks of white pigeons that keep to the part of the city in view. A flock circles above
// a tree for a while, comes down into it and is gone, and later flies out of it again (or out of another tree,
// if the view has moved on meanwhile). One instanced mesh; where a flock's tree is and how far the flock has
// settled in it is kept per flock in a small texture, everything else comes out of the vertex shader from the
// time and a few random numbers per bird, so a thousand birds cost the CPU next to nothing.
import * as THREE from 'three';
import { shared } from './materials.js';

export const MAX_BIRDS = 2000;
const FLOCK = 14;  // birds per flock
const FLOCKS = Math.ceil(MAX_BIRDS / FLOCK);
const SPAN = 3.2;  // wingspan in metres: a good deal larger than life, or they would not be seen from the air
const LAND = 13, TAKE_OFF = 9; // seconds a flock takes to settle in its tree, and to leave it
const CRUISE = 28;             // metres per second: a flock moving over to another tree

// A bird flying towards +z: a slim body and two wings of two panels each. aWing: 0 on the body, 1 at the tip.
function birdGeometry() {
  const pos = [], wing = [];
  const tri = (a, b, c) => { for (const [x, y, z, w] of [a, b, c]) { pos.push(x, y, z); wing.push(w); } };
  const h = SPAN / 2;
  tri([0, 0, 0.42, 0], [0.09, 0, -0.1, 0], [-0.09, 0, -0.1, 0]);       // head and chest
  tri([0.09, 0, -0.1, 0], [0, 0, -0.5, 0], [-0.09, 0, -0.1, 0]);       // tail
  for (const s of [-1, 1]) {
    tri([s * 0.06, 0, 0.2, 0], [s * h * 0.5, 0, 0.16, 0.5], [s * 0.06, 0, -0.16, 0]);         // inner panel
    tri([s * h * 0.5, 0, 0.16, 0.5], [s * h * 0.5, 0, -0.1, 0.5], [s * 0.06, 0, -0.16, 0]);
    tri([s * h * 0.5, 0, 0.16, 0.5], [s * h, 0, -0.02, 1], [s * h * 0.5, 0, -0.1, 0.5]);      // outer panel
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
  const seed = new Float32Array(MAX_BIRDS * 4);
  for (let i = 0; i < MAX_BIRDS; i++) seed.set([Math.floor(i / FLOCK), Math.random(), Math.random(), Math.random()], i * 4);
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4)); // flock, and three random numbers
  return g;
}

// The mesh; call mesh.userData.update(dt, focus, camera, streamer) every frame.
export function createBirds() {
  // per flock: row 0 = its tree (x, y of the crown, z) and how far it has settled there (0 flying .. 1 in the
  // tree); row 1 = how fast that changes (per second), for the way the birds face while they come down
  const data = new Float32Array(FLOCKS * 2 * 4);
  const flockTex = new THREE.DataTexture(data, FLOCKS, 2, THREE.RGBAFormat, THREE.FloatType);
  flockTex.minFilter = flockTex.magFilter = THREE.NearestFilter;
  const material = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { uTime: shared.uTime, uDark: shared.uDark, uFlocks: { value: flockTex } },
    vertexShader: /* glsl */ `
      #define PIGEONS 1.0 // share of the flocks that are white pigeons (the rest would be black crows)
      attribute float aWing;
      attribute vec4 aSeed;
      uniform float uTime;
      uniform sampler2D uFlocks;
      varying float vShade;
      varying float vCrow;
      float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
      // how much of the bird is still in the air (1), with the flock settled by 'perch': one bird after another
      float aloft(float perch) {
        float b = clamp(perch * 1.4 - 0.4 * aSeed.w, 0.0, 1.0);
        return 1.0 - b * b * (3.0 - 2.0 * b);
      }
      // where the bird is at time t
      vec3 place(float t, vec4 flock, float perch) {
        float f = aSeed.x, air = aloft(perch);
        // the flock: a slow, never-repeating loop above its tree, at a height of its own
        vec2 reach = 45.0 + 170.0 * vec2(hash(f + 1.0), hash(f + 5.0));
        vec3 c = vec3(
          reach.x * sin(t * (0.05 + 0.06 * hash(f + 8.0)) + 6.28 * hash(f + 2.0)),
          22.0 + 230.0 * pow(hash(f + 3.0), 2.0) + 14.0 * sin(t * 0.05 + 6.28 * hash(f + 4.0)),
          reach.y * sin(t * (0.05 + 0.06 * hash(f + 10.0)) + 6.28 * hash(f + 6.0)));
        // the bird: round the flock on its own circle, rising and falling a little
        float radius = 8.0 + 55.0 * aSeed.y, turn = (0.5 + aSeed.z) * 4.5 / radius * (hash(f + 7.0) < 0.5 ? -1.0 : 1.0);
        float a = t * turn + 6.28 * aSeed.w;
        vec3 own = vec3(cos(a) * radius, 9.0 * sin(t * 0.21 + 6.28 * aSeed.z) + 50.0 * (aSeed.w - 0.5), sin(a) * radius * 0.8);
        own.y = max(own.y, 4.0 - c.y);
        // settled, it sits somewhere in the crown
        vec3 twig = (vec3(aSeed.y, aSeed.z, aSeed.w) - 0.5) * vec3(3.0, 2.0, 3.0);
        return flock.xyz + mix(twig, c + own, air);
      }
      void main() {
        float u = (aSeed.x + 0.5) / ${FLOCKS}.0;
        vec4 flock = texture2D(uFlocks, vec2(u, 0.25));
        float rate = texture2D(uFlocks, vec2(u, 0.75)).x;
        vec3 p = place(uTime, flock, flock.w), ahead = place(uTime + 0.25, flock, clamp(flock.w + rate * 0.25, 0.0, 1.0));
        vec3 fwd = normalize(ahead - p + vec3(0.0, 0.0, 1e-4)), right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd)), up = cross(fwd, right);
        // wings: beat for a while, then glide with the wings held a little up
        float beat = smoothstep(-0.2, 0.3, sin(uTime * 0.35 + 6.28 * aSeed.y));
        // a flock is of one kind: pigeons (the larger share: white, smaller, quick wings) or crows (black, slow wings)
        float crow = step(PIGEONS, hash(aSeed.x + 9.0));
        float lift = mix(0.18, sin(uTime * mix(8.0, 4.5, crow) * (0.85 + 0.3 * aSeed.z) + 6.28 * aSeed.w), beat) * 0.55;
        // (a bird in the tree is not seen: it shrinks away among the leaves as it arrives)
        vec3 local = position * mix(0.7, 1.0, crow) * smoothstep(0.0, 0.05, aloft(flock.w));
        vCrow = crow;
        local.y += abs(local.x) * lift * aWing;
        local.x *= 1.0 - 0.22 * abs(lift) * aWing;
        vec3 world = p + right * local.x + up * local.y + fwd * local.z;
        vShade = 0.75 + 0.25 * aWing;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uDark;
      varying float vShade;
      varying float vCrow;
      void main() { gl_FragColor = vec4(mix(vec3(0.82, 0.82, 0.84), vec3(0.03, 0.03, 0.035), vCrow) * vShade * mix(1.0, 0.5, uDark), 1.0); } // (still white against the night sky)`,
  });
  const mesh = new THREE.Mesh(birdGeometry(), material);
  mesh.frustumCulled = false; // (they are placed in the shader)
  mesh.name = 'birds';
  // shadows: the shadow pass must place the birds as the picture does, so it gets the same vertex shader
  mesh.castShadow = true;
  mesh.customDepthMaterial = new THREE.ShaderMaterial({ side: THREE.DoubleSide, uniforms: material.uniforms, vertexShader: material.vertexShader, fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }' });
  mesh.geometry.instanceCount = 100;

  // ---- the flocks: which tree, and flying / coming down / in the tree / leaving it
  const flocks = Array.from({ length: FLOCKS }, () => ({ state: 'new', timer: 0, perch: 0, rate: 0, anchor: new THREE.Vector3(), target: null }));
  const rnd = (a, b) => a + Math.random() * (b - a);
  mesh.userData.flocks = flocks;
  mesh.userData.update = (dt, focus, camera, streamer) => {
    const reach = THREE.MathUtils.clamp(camera.position.distanceTo(focus) * 0.7, 120, 650); // how far from the focus is still "in view"
    // a tree within reach of the focus: the place of its crown, or null if none is found
    const tiles = [...streamer.tiles.values()].filter((t) => t.trees?.roosts.length);
    const pickTree = () => {
      for (let tries = 0; tries < 12 && tiles.length; tries++) {
        const r = tiles[Math.floor(Math.random() * tiles.length)].trees.roosts, i = Math.floor(Math.random() * (r.length / 3)) * 3;
        if (Math.hypot(r[i] - focus.x, r[i + 2] - focus.z) < reach) return new THREE.Vector3(r[i], r[i + 1], r[i + 2]);
      }
      return null;
    };
    const far = (p) => Math.hypot(p.x - focus.x, p.z - focus.z) > reach * 1.5;
    const count = Math.ceil(mesh.geometry.instanceCount / FLOCK);
    for (let i = 0; i < count; i++) {
      const f = flocks[i];
      f.rate = 0;
      if (f.state === 'new') {
        // at the start some are in the air and some in the trees
        f.target = pickTree();
        f.anchor.copy(f.target ?? new THREE.Vector3(focus.x + rnd(-reach, reach) * 0.6, streamer.ground(focus.x, focus.z) + 12, focus.z + rnd(-reach, reach) * 0.6));
        if (f.target && Math.random() < 0.3) { f.state = 'perched'; f.perch = 1; f.timer = rnd(2, 25); } else { f.state = 'fly'; f.perch = 0; f.timer = rnd(8, 70); }
      } else if (f.state === 'fly') {
        f.timer -= dt;
        if (!f.target || far(f.target)) f.target = pickTree() ?? f.target; // the view has moved on: over to a tree there
        if (f.target) {
          const d = f.anchor.distanceTo(f.target);
          if (d > 0.01) f.anchor.lerp(f.target, Math.min(1, (CRUISE * dt) / d));
          else if (f.timer <= 0) f.state = 'land';
        }
      } else if (f.state === 'land') {
        f.rate = 1 / LAND; f.perch += dt / LAND;
        if (f.perch >= 1) { f.perch = 1; f.state = 'perched'; f.timer = rnd(6, 26); }
      } else if (f.state === 'perched') {
        f.timer -= dt;
        // (nobody sees a bird in a tree: if the view has moved on, the flock is in a tree there instead)
        if (far(f.anchor)) { const tree = pickTree(); if (tree) { f.target = tree; f.anchor.copy(tree); } }
        if (f.timer <= 0) f.state = 'takeoff';
      } else {
        f.rate = -1 / TAKE_OFF; f.perch -= dt / TAKE_OFF;
        if (f.perch <= 0) { f.perch = 0; f.state = 'fly'; f.timer = rnd(30, 85); }
      }
      data.set([f.anchor.x, f.anchor.y, f.anchor.z, f.perch], i * 4);
      data[(FLOCKS + i) * 4] = f.rate;
    }
    flockTex.needsUpdate = true;
  };
  return mesh;
}
