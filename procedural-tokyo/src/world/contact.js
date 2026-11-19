// Contact shadows: the soft dark that gathers on the ground round the foot of everything that stands on it —
// buildings, trees, cars, poles — whatever the sun is doing. (After three's contact shadow example: the things
// are drawn flat from straight above into a mask around the focus, the mask is blurred, and the ground takes
// its darkness from it; under the thing itself the dark is hidden, round it the blur shows.)
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { shared } from './materials.js';

const SIZE = 1024;

// Marks a mesh as ground: it takes contact shadows and throws none.
export const asGround = (mesh) => { mesh.userData.ground = true; return mesh; };

const BLUR = /* glsl */ `
uniform sampler2D map;
uniform vec2 step;   // one tap's stride, in uv
varying vec2 vUv;
void main() {
  // nine taps of a bell curve
  float sum = texture2D(map, vUv).r * 0.2270270270;
  sum += (texture2D(map, vUv + step * 1.0).r + texture2D(map, vUv - step * 1.0).r) * 0.1945945946;
  sum += (texture2D(map, vUv + step * 2.0).r + texture2D(map, vUv - step * 2.0).r) * 0.1216216216;
  sum += (texture2D(map, vUv + step * 3.0).r + texture2D(map, vUv - step * 3.0).r) * 0.0540540541;
  sum += (texture2D(map, vUv + step * 4.0).r + texture2D(map, vUv - step * 4.0).r) * 0.0162162162;
  gl_FragColor = vec4(sum, sum, sum, 1.0);
}`;

export class ContactShadows {
  constructor(renderer) {
    this.renderer = renderer;
    const target = () => new THREE.WebGLRenderTarget(SIZE, SIZE, { depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.mask = target(); this.half = target(); this.done = target();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 6000);
    this.camera.up.set(0, 0, -1);
    this.flat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, fog: false });
    this.blur = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { map: { value: null }, step: { value: new THREE.Vector2() } },
      vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: BLUR, depthTest: false, depthWrite: false,
    }));
    this.softness = 0.5; // metres over which the dark fades out
    this.frame = 0;
    this.black = new THREE.Color(0, 0, 0);
    this.extent = 0;
    shared.uContactMap.value = this.done.texture;
  }

  // scene: the scene; focus: what the view looks at; eye: the camera's position; hide: objects that throw none.
  update(scene, focus, eye, hide = []) {
    if (shared.uContact.value <= 0 || this.frame++ % 2) return; // (things move slowly against a blur of metres)
    // the map reaches as far as the view does (in coarse steps), and moves a whole texel at a time
    const want = THREE.MathUtils.clamp(eye.distanceTo(focus) * 1.5, 220, 1400), half = 220 * 1.35 ** Math.ceil(Math.log(want / 220) / Math.log(1.35));
    const cam = this.camera;
    if (half !== this.extent) { this.extent = half; cam.left = cam.bottom = -half; cam.right = cam.top = half; cam.updateProjectionMatrix(); }
    const texel = (2 * half) / SIZE, cx = Math.round(focus.x / texel) * texel, cz = Math.round(focus.z / texel) * texel;
    cam.position.set(cx, focus.y + 3000, cz);
    cam.lookAt(cx, focus.y, cz);
    shared.uContactRect.value.set(cx, cz, half, 0);

    const r = this.renderer, hidden = [];
    scene.traverse((o) => { if (o.userData.ground && o.visible) { o.visible = false; hidden.push(o); } });
    for (const o of hide) if (o && o.visible) { o.visible = false; hidden.push(o); }
    const state = { target: r.getRenderTarget(), shadows: r.shadowMap.autoUpdate, background: scene.background, override: scene.overrideMaterial, clear: r.getClearColor(new THREE.Color()), alpha: r.getClearAlpha() };
    r.shadowMap.autoUpdate = false; scene.background = null; scene.overrideMaterial = this.flat;
    r.setRenderTarget(this.mask);
    r.setClearColor(this.black, 1);
    r.clear();
    r.render(scene, cam);
    scene.overrideMaterial = state.override; scene.background = state.background; r.shadowMap.autoUpdate = state.shadows;
    for (const o of hidden) o.visible = true;

    // blurred across, then down: a tap every (softness / 4) metres
    const u = this.blur.material.uniforms, stride = this.softness / 4 / (2 * half);
    u.map.value = this.mask.texture; u.step.value.set(stride, 0);
    r.setRenderTarget(this.half); this.blur.render(r);
    u.map.value = this.half.texture; u.step.value.set(0, stride);
    r.setRenderTarget(this.done); this.blur.render(r);
    r.setRenderTarget(state.target);
    r.setClearColor(state.clear, state.alpha);
  }
}
