// Planar reflection for the wet ground (pass name 'reflection', runs in the 'volumetrics' slot and
// returns nothing). The scene is drawn from the camera mirrored in the ground plane into a small
// target, fogged, and published as G.post.targets.reflection; every ground material (anything whose
// material.surf has uReflMatrix / tReflection / uReflOn, see mats/ground.js) is pointed at it.
//
// Kept cheap:
//   - G.quality.reflScale of the internal resolution: half on high (a quarter of the pixels), 0.4 on
//     medium. Where G.quality.reflection is false (low, mobile) the pass does not run at all unless
//     pass.onLow is set to true, and the ground keeps its blurred sky term. No MSAA, no post,
//     shadow maps reused rather than redrawn;
//   - redrawn every second frame while the eye stands still or only turns (every frame while it
//     moves, and after a camera cut). The ground samples it with the matrix it was drawn with, so
//     a held image stays glued to the world, and for a pure turn it is exact; the view is drawn a
//     little wider than the camera's so a turn does not run off its edge in the frame it is held;
//   - left out: the ground itself, anything flagged userData.noReflect, anything hung off the camera,
//     skinned meshes, points, lines and sprites, plain meshes under SMALL metres across (lamp lenses
//     and signs are exactly what a puddle should show, a bolt is not), and any mesh wholly beyond
//     CULL_DIST. The far plane sits at FAR.
// Everything below the plane is clipped with an oblique near plane.
// Fog: the mirrored scene pass has no fog in it (fog is applied to the main view in post), so a
// second small pass applies the same height fog along the reflected path and fades everything to
// the fog colour before the far plane. A distant lamp is then no brighter in a puddle than seen directly.
// `?nopass=reflection` switches it off; so does post.setPassEnabled('reflection', false).
import {
  WebGLRenderTarget, DepthTexture, UnsignedIntType, RGBAFormat, HalfFloatType, LinearFilter, PerspectiveCamera,
  Matrix4, Vector3, Vector4, Plane, Color,
} from 'three';
import { readFog, FOG_GLSL } from './lightlist.js';

const SCAN_EVERY = 120; // frames between looks through the scene for ground materials and what to leave out
const SMALL = 0.5; // metres: bounding radius below which a plain mesh is left out
const CULL_DIST = 40; // metres: meshes wholly farther than this are left out
const FAR = 90; // metres: far plane of the mirrored view; the fog fade completes before it
const CLIP_LIFT = 0.02; // metres above the plane where clipping starts
const GUARD = 1.12; // the mirrored view is this much wider than the camera's
const HOLD_MOVE = 0.015; // metres: the image is held for a frame only if the eye moved less than this since it was drawn
const DEFAULT_SCALE = 0.5; // when G.quality carries no reflScale

const FOG_FRAG = FOG_GLSL + /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tMirrorDepth;
uniform mat4 uProjInv;     // of the mirrored camera (oblique)
uniform mat4 uViewInv;
uniform vec3 uEye;         // the real camera
uniform float uPlaneY;
uniform vec3 uFogColor;
uniform float uFogStart;
uniform float uFogRamp;
uniform float uFar;
uniform float uKnee;
uniform float uCeil;
// What the ground may mirror of one texel: a lamp face is hundreds of times brighter than anything
// else, and wet asphalt never returns that as a clean white shape. Above uKnee the radiance is
// rolled off toward uCeil, hue kept.
vec3 soft(vec3 c) {
  float l = max(max(c.r, c.g), c.b);
  if (l <= uKnee) return c;
  float over = l - uKnee;
  return c * ((uKnee + (uCeil - uKnee) * over / (over + (uCeil - uKnee))) / l);
}
// What stands on the ground at one texel of the mirrored view: xyz = direction from the mirrored eye,
// w = how solidly it shows (0 = open sky, 1 = a thing near by, falling to 0 toward the far plane).
vec4 mirrored(vec2 uv, out float dist) {
  float d = texture(tMirrorDepth, uv).r;
  vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec3 vp = v.xyz / v.w;
  dist = length(vp); // eye -> ground -> object, the same length as mirrored eye -> object
  float cover = d >= 0.99999 ? 0.0 : 1.0 - smoothstep(0.3 * uFar, 0.75 * uFar, dist);
  return vec4(normalize(mat3(uViewInv) * vp), cover);
}
void main() {
  // Rolled off, then smeared: mostly along the line of sight (up and down the image), as water
  // ruffled by rain does, a little sideways. A panel keeps its shape with a soft edge and a tail.
  // Eight taps half a texel off the grid, so each averages two rows and together they cover sixteen with no gaps (gaps would comb a thin lamp into stripes).
  // The coverage (alpha) is smeared with the colour, and wider sideways: it was one hard 0/1 texel, which cut
  // every tree on the skyline into the puddles as a sharp black spike however soft the colour was.
  vec2 px = 1.0 / vec2(textureSize(tColor, 0));
  vec3 c = vec3(0.0);
  float cover = 0.0; float dd;
  for (int i = 0; i < 8; i++) {
    float k = float(i) - 3.5;
    float w = i == 3 || i == 4 ? 0.2 : (i == 2 || i == 5 ? 0.15 : (i == 1 || i == 6 ? 0.1 : 0.05));
    float sx = mod(float(i), 2.0) - 0.5;
    c += w * soft(texture(tColor, vUv + vec2(sx * px.x, k * 2.0 * px.y)).rgb);
    cover += w * mirrored(vUv + vec2(sx * 5.0 * px.x, k * 2.0 * px.y), dd).w;
  }
  float dist;
  vec4 m = mirrored(vUv, dist);
  vec3 dir = m.xyz; // from the mirrored eye, heading up out of the ground
  // fog: along the reflected ray going up for the sky, along the low path to the thing for a thing,
  // and between the two as a far thing gives way to the sky
  float Tsky = exp(-fogOpticalDepth(uPlaneY, max(dir.y, 0.0), 400.0));
  float y = uPlaneY + 0.5 * max(uEye.y - uPlaneY, 0.0); // the path stays low: fog it at about this height
  float far = max(min(dist, uFar) - uFogStart, 0.0);
  float Tgeo = exp(-fogOpticalDepth(y, max(dir.y, 0.0) * 0.5, far * far / (far + uFogRamp)));
  float T = mix(Tsky, Tgeo, m.w);
  // alpha: how much of the mirror here is something standing on the ground rather than the sky. The
  // ground keeps its own sky reflection (the environment) for the rest and adds this on top, so a
  // far tree line dissolves into the sky's reflection instead of standing in the water as a cut-out.
  outColor = vec4(c * T + uFogColor * (1.0 - T), cover);
}`;

export function createReflection(G) {
  const hdr = { format: RGBAFormat, type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter };
  const raw = new WebGLRenderTarget(2, 2, { ...hdr, depthBuffer: true, depthTexture: new DepthTexture(2, 2, UnsignedIntType) });
  const target = new WebGLRenderTarget(2, 2, { ...hdr, depthBuffer: false });
  // Both carry the name: the level tells the mirrored draw from the main one by the name of the
  // texture being rendered into (its reflection stand-ins are drawn only then).
  raw.texture.name = 'reflection';
  target.texture.name = 'reflection';
  const mirror = new PerspectiveCamera();
  const texMatrix = new Matrix4();
  const flipY = new Matrix4().makeScale(1, -1, 1);
  const reflect = new Matrix4();
  const bias = new Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  const plane = new Plane();
  const clip = new Vector4();
  const q = new Vector4();
  const camPos = new Vector3();
  const drawnAt = new Vector3(1e9, 0, 0);
  const up = new Vector3(0, 1, 0);
  const point = new Vector3();
  const black = new Color(0, 0, 0);
  const savedClear = new Color();
  const fog = { density: 0, falloff: 0, r: 0, g: 0, b: 0 };
  // knee, ceil: scene radiance where the mirrored image starts to roll off, and what it can never exceed
  const uniforms = { knee: { value: 1.2 }, ceil: { value: 5 } };

  const grounds = []; // materials
  const hide = []; // objects always left out of the mirrored view
  const far = []; // meshes with real bounds, tested against CULL_DIST each time
  const hidden = [];
  let sinceScan = SCAN_EVERY;
  let live = false;
  let enabled = true;
  let fogMat = null;
  let width = 2; let height = 2; let scale = 0;

  // What a puddle should show however small it is: unlit (glowing) materials and the mats library's emitters.
  const emissive = (m) => !!m && (m.isMeshBasicMaterial || m.name === 'neon' || m.name === 'emissive' || !!(m.surf && m.surf.uEOn)
    || !!(m.emissive && m.emissiveIntensity > 0 && m.emissive.r + m.emissive.g + m.emissive.b > 0));

  function visit(o) {
    if (o.userData && o.userData.noReflect) { hide.push(o); return; }
    if (o.isPoints || o.isLine || o.isSprite || o.isSkinnedMesh) { hide.push(o); return; }
    if (!o.isMesh) return;
    const single = !Array.isArray(o.material);
    const n = single ? 1 : o.material.length;
    let isGround = false; let glows = false;
    for (let i = 0; i < n; i++) {
      const m = single ? o.material : o.material[i];
      if (m && m.surf && m.surf.uReflMatrix && m.surf.tReflection && m.surf.uReflOn) { isGround = true; if (!grounds.includes(m)) grounds.push(m); }
      if (emissive(m)) glows = true;
    }
    if (isGround) { hide.push(o); return; }
    if (o.isInstancedMesh || !o.geometry) return;
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    const r = o.geometry.boundingSphere.radius * o.matrixWorld.getMaxScaleOnAxis();
    if (o.frustumCulled !== false && r < SMALL && !glows) { hide.push(o); return; }
    far.push(o);
  }
  function scan() {
    const before = grounds.length;
    grounds.length = 0; hide.length = 0; far.length = 0;
    G.scene.traverse(visit);
    if (grounds.length !== before) live = false; // new ground materials have not been switched on yet
  }

  function setOn(v) {
    for (let i = 0; i < grounds.length; i++) grounds[i].surf.uReflOn.value = v;
    live = v > 0;
  }
  function setSize(post) {
    const s = post.quality.reflScale || DEFAULT_SCALE;
    if (s === scale) return;
    scale = s;
    const w = Math.max(1, Math.ceil(width * s)); const h = Math.max(1, Math.ceil(height * s));
    raw.setSize(w, h); target.setSize(w, h);
  }

  const pass = {
    name: 'reflection', uniforms,
    onLow: false,
    target,
    init(post) {
      post.targets.reflection = target;
      fogMat = post.fsMaterial({
        fragmentShader: FOG_FRAG,
        uniforms: {
          tColor: { value: raw.texture }, tMirrorDepth: { value: raw.depthTexture },
          uProjInv: { value: mirror.projectionMatrixInverse }, uViewInv: { value: mirror.matrixWorld },
          uEye: { value: camPos }, uPlaneY: { value: 0 }, uFogColor: { value: new Vector3() }, uFogStart: { value: 0 }, uFogRamp: { value: 1 }, uFar: { value: FAR }, uKnee: uniforms.knee, uCeil: uniforms.ceil,
          uFogDensity: { value: 0 }, uFogFalloff: { value: 0 },
        },
      });
    },
    resize(w, h) { width = w; height = h; scale = 0; },
    // the shader warm-up's dry frame (render/warm.js) drew no reflection: the ground must not
    // look one up until a real frame has drawn it
    afterDryFrame() { if (live) setOn(0); },
    render(post) {
      if (++sinceScan >= SCAN_EVERY || post.snap) { sinceScan = 0; scan(); }
      const cam = post.camera;
      camPos.setFromMatrixPosition(cam.matrixWorld);
      const planeY = grounds.length && grounds[0].surf.uGroundY ? grounds[0].surf.uGroundY.value : 0;
      const wanted = grounds.length > 0 && (post.quality.reflection !== false || pass.onLow) && camPos.y - planeY > 0.05;
      if (!wanted) { if (live) setOn(0); return; }
      // Hold last frame's image on every second frame, but only while the eye stays where it was: for a turn the held
      // image is exact (the ground samples it with the matrix it was drawn with); once the eye moves it would lag a frame.
      if (live && !post.snap && (post.shared.frame.value & 1) === 1 && camPos.distanceToSquared(drawnAt) < HOLD_MOVE * HOLD_MOVE) return;
      drawnAt.copy(camPos);
      setSize(post);

      // The mirrored camera: world' = R * world with R the reflection in y = planeY. R * M * flipY is
      // a proper rotation again (two flips), so it is an ordinary camera and nothing needs its winding reversed.
      reflect.makeScale(1, -1, 1).setPosition(0, 2 * planeY, 0);
      mirror.matrixWorld.multiplyMatrices(reflect, cam.matrixWorld).multiply(flipY);
      mirror.matrixWorld.decompose(mirror.position, mirror.quaternion, mirror.scale);
      mirror.updateMatrixWorld(true);
      const p = mirror.projectionMatrix.copy(cam.projectionMatrix).elements;
      p[0] /= GUARD; p[5] /= GUARD;
      const zf = Math.min(FAR, cam.far);
      p[10] = -(zf + cam.near) / (zf - cam.near); p[14] = (-2 * zf * cam.near) / (zf - cam.near);
      texMatrix.multiplyMatrices(bias, mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);

      // Oblique near plane (Lengyel): the mirrored camera's near plane becomes the ground plane.
      plane.setFromNormalAndCoplanarPoint(up, point.set(0, planeY + CLIP_LIFT, 0)).applyMatrix4(mirror.matrixWorldInverse);
      clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
      q.set((Math.sign(clip.x) + p[8]) / p[0], (Math.sign(clip.y) + p[9]) / p[5], -1, (1 + p[10]) / p[14]);
      clip.multiplyScalar(2 / clip.dot(q));
      p[2] = clip.x; p[6] = clip.y; p[10] = clip.z + 1; p[14] = clip.w;
      mirror.projectionMatrixInverse.copy(mirror.projectionMatrix).invert();

      hidden.length = 0;
      for (let i = 0; i < hide.length; i++) { const o = hide[i]; if (o.visible) { o.visible = false; hidden.push(o); } }
      for (let i = 0; i < far.length; i++) {
        const o = far[i];
        if (!o.visible) continue;
        const s = o.geometry.boundingSphere;
        const r = s.radius * o.matrixWorld.getMaxScaleOnAxis();
        if (point.copy(s.center).applyMatrix4(o.matrixWorld).distanceTo(camPos) - r > CULL_DIST) { o.visible = false; hidden.push(o); }
      }
      if (cam.parent && cam.visible) { cam.visible = false; hidden.push(cam); }
      const r = post.renderer;
      const autoShadows = r.shadowMap.autoUpdate;
      r.shadowMap.autoUpdate = false; // reuse this frame's shadow maps
      r.getClearColor(savedClear);
      const savedAlpha = r.getClearAlpha();
      try {
        r.setRenderTarget(raw);
        r.setClearColor(black, 1);
        r.clear();
        r.render(G.scene, mirror);
      } finally {
        r.setClearColor(savedClear, savedAlpha);
        r.shadowMap.autoUpdate = autoShadows;
        for (let i = 0; i < hidden.length; i++) hidden[i].visible = true;
      }

      // fog the mirrored image the way the volumetrics pass fogs the main view
      readFog(G, fog);
      const vol = post.getPass('vol');
      const vu = vol && vol.uniforms;
      const amb = vu && vu.fogAmbient ? vu.fogAmbient.value : 1;
      const u = fogMat.uniforms;
      const tint = vu && vu.fogTint ? vu.fogTint.value : null;
      u.uFogColor.value.set(fog.r * amb * (tint ? tint.x : 1), fog.g * amb * (tint ? tint.y : 1), fog.b * amb * (tint ? tint.z : 1));
      u.uFogDensity.value = fog.density * (vu && vu.fogDensity ? vu.fogDensity.value : 1);
      u.uFogFalloff.value = fog.falloff;
      u.uFogStart.value = vu && vu.fogStart ? vu.fogStart.value : 0;
      u.uFogRamp.value = vu && vu.fogRamp ? vu.fogRamp.value : 1;
      u.uPlaneY.value = planeY; u.uFar.value = zf;
      post.blit(fogMat, target);

      for (let i = 0; i < grounds.length; i++) {
        grounds[i].surf.uReflMatrix.value.copy(texMatrix);
        grounds[i].surf.tReflection.value = target.texture;
      }
      setOn(1);
    },
    dispose() { setOn(0); raw.dispose(); target.dispose(); if (fogMat) fogMat.dispose(); },
  };
  // Switching the pass off must also switch the ground's lookup off, or puddles keep a frozen image.
  Object.defineProperty(pass, 'enabled', {
    enumerable: true,
    get: () => enabled,
    set: (v) => { enabled = !!v; if (!enabled && live) setOn(0); },
  });
  return pass;
}
