// Water as a real mirror: the city is drawn a second time, upside down below the water's level, into a texture
// that the ground shader lays on the water (materials.js). Unlike reflections found on the screen (reflections.js,
// which the window panes use), this shows what stands above the water from any angle — also what is out of the
// picture. One level for the whole view: that of the water nearest to the point looked at.
import * as THREE from 'three';
import { shared } from './materials.js';

const SCALE = 0.5;   // size of the mirror picture, as a share of the screen
const CLIP = 0.3;    // metres below the water level that are still drawn (the banks, which stand a little into it)

export class WaterMirror {
  constructor(renderer) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.camera = new THREE.PerspectiveCamera();
    this.blank = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    this.blank.needsUpdate = true;
    shared.uMirror.value = this.blank;
    this.size = new THREE.Vector2();
    this.clear = new THREE.Color(0, 0, 0);
    this.frustum = new THREE.Frustum();
    this.seen = []; // the water in view (level())
    this.rect = new THREE.Vector4(); // where the water is on the screen: left, bottom, right, top (see level())
    this.narrow = new THREE.Frustum();
    this.enabled = true;
    this.crop = true; // only the part of the picture that water looks at is drawn (false: all of it, to compare)
  }

  // The level of the water nearest to `focus` among the tiles in view, or null if no water is to be seen.
  level(tiles, camera, focus) {
    this.frustum.setFromProjectionMatrix(_m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    let best = null, bestD = Infinity;
    this.seen.length = 0;
    for (const t of tiles.values()) {
      const w = t.water;
      if (!w || !this.frustum.intersectsSphere(w.sphere)) continue;
      this.seen.push(w);
      const d = Math.hypot(w.sphere.center.x - focus.x, w.sphere.center.z - focus.z);
      if (d < bestD) { bestD = d; best = w.y; }
    }
    return best;
  }

  // Draws the mirror picture for this frame. hide: objects that are left out of it.
  update(scene, camera, tiles, focus, hide = []) {
    const y = this.enabled ? this.level(tiles, camera, focus) : null;
    if (y == null) { shared.uMirrorOn.value = 0; return; }
    const r = this.renderer;
    r.getDrawingBufferSize(this.size).multiplyScalar(SCALE).floor();
    if (this.target.width !== this.size.x || this.target.height !== this.size.y) this.target.setSize(this.size.x, this.size.y);

    // the camera, mirrored in the water (as three's Reflector does it)
    const cam = this.camera, plane = _plane.set(_up, -y);
    _pos.setFromMatrixPosition(camera.matrixWorld);
    _look.set(0, 0, -1).applyMatrix4(_rot.extractRotation(camera.matrixWorld)).add(_pos);
    cam.position.set(_pos.x, 2 * y - _pos.y, _pos.z);
    cam.up.set(0, 1, 0).applyMatrix4(_rot).reflect(_up);
    cam.lookAt(_look.x, 2 * y - _look.y, _look.z);
    cam.near = camera.near; cam.far = camera.far;
    cam.updateMatrixWorld();
    cam.projectionMatrix.copy(camera.projectionMatrix);
    cam.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    // an oblique near plane: nothing below the water is drawn (Lengyel's method)
    _clip.copy(plane); _clip.constant += CLIP;
    _clip.applyMatrix4(cam.matrixWorldInverse);
    const p = cam.projectionMatrix.elements, c = _v4.set(_clip.normal.x, _clip.normal.y, _clip.normal.z, _clip.constant);
    _q.x = (Math.sign(c.x) + p[8]) / p[0]; _q.y = (Math.sign(c.y) + p[9]) / p[5]; _q.z = -1; _q.w = (1 + p[10]) / p[14];
    c.multiplyScalar(2 / c.dot(_q));
    p[2] = c.x; p[6] = c.y; p[10] = c.z + 1; p[14] = c.w;

    // from a point of the world to its place in the mirror picture
    shared.uMirrorMatrix.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);

    // Where in the mirror picture the water looks: `rect`, from -1 to 1 across it — each stretch of water where the
    // mirror's own camera sees it (water that does not lie at the mirror's level looks elsewhere than where it is
    // on the screen); the whole picture if any of it comes too near the eye to tell.
    this.rect.set(1, 1, -1, -1);
    for (const w of this.seen) for (let k = 0; k < 4; k++) {
      _corner.set(k & 1 ? w.box.max.x : w.box.min.x, w.y, k & 2 ? w.box.max.z : w.box.min.z, 1).applyMatrix4(shared.uMirrorMatrix.value);
      if (_corner.w < 1) { this.rect.set(-1, -1, 1, 1); continue; }
      const q = this.rect, x = _corner.x / _corner.w, yy = _corner.y / _corner.w;
      q.x = Math.min(q.x, x); q.y = Math.min(q.y, yy); q.z = Math.max(q.z, x); q.w = Math.max(q.w, yy);
    }
    const MARGIN = 0.4, rc = this.rect, x0 = Math.max(-1, rc.x - MARGIN), y0 = Math.max(-1, rc.y - MARGIN), x1 = Math.min(1, rc.z + MARGIN), y1 = Math.min(1, rc.w + MARGIN);
    // (water that is wholly off the screen — its tile is in view, the water itself is not — needs no picture at all)
    if (this.crop && (x1 <= x0 || y1 <= y0)) { shared.uMirrorOn.value = 0; return; }
    const hidden = hide.filter((o) => o && o.visible);
    // The mirror picture is only ever looked at where there is water on the screen (a little beyond: the ripples
    // shift it). So only that part of it is drawn, and of the city only the tiles that show in that part — when
    // the water is a moat in a corner of the view, that is a small share of a second drawing of everything.
    const part = this.crop && (x1 - x0 < 1.95 || y1 - y0 < 1.95);
    if (part) {
      // (the same view, cut to that part: what lies outside it is outside this frustum)
      _crop.set(2 / (x1 - x0), 0, 0, -(x1 + x0) / (x1 - x0), 0, 2 / (y1 - y0), 0, -(y1 + y0) / (y1 - y0), 0, 0, 1, 0, 0, 0, 0, 1);
      this.narrow.setFromProjectionMatrix(_crop.multiply(shared.uMirrorMatrix.value));
      for (const t of tiles.values()) if (t.group?.visible && t.sphere && !this.narrow.intersectsSphere(t.sphere)) hidden.push(t.group);
    }
    for (const o of hidden) o.visible = false;
    const state = { target: r.getRenderTarget(), shadows: r.shadowMap.autoUpdate, background: scene.background, clear: r.getClearColor(new THREE.Color()), alpha: r.getClearAlpha() };
    shared.uMirror.value = this.blank; shared.uMirrorOn.value = 0; // (the picture cannot show itself)
    r.shadowMap.autoUpdate = false; scene.background = null;
    r.setRenderTarget(this.target);
    r.setClearColor(this.clear, 0);
    r.clear();
    if (part) { const w = this.target.width, h = this.target.height; this.target.scissor.set(Math.floor((x0 * 0.5 + 0.5) * w), Math.floor((y0 * 0.5 + 0.5) * h), Math.ceil((x1 - x0) * 0.5 * w), Math.ceil((y1 - y0) * 0.5 * h)); }
    this.target.scissorTest = part;
    r.setRenderTarget(this.target); // (takes the scissor)
    r.render(scene, cam);
    r.setRenderTarget(state.target);
    r.setClearColor(state.clear, state.alpha);
    r.shadowMap.autoUpdate = state.shadows; scene.background = state.background;
    for (const o of hidden) o.visible = true;
    shared.uMirror.value = this.target.texture; shared.uMirrorOn.value = 1;
  }
}

const _corner = new THREE.Vector4(), _crop = new THREE.Matrix4();
const _m = new THREE.Matrix4(), _rot = new THREE.Matrix4(), _up = new THREE.Vector3(0, 1, 0), _pos = new THREE.Vector3(), _look = new THREE.Vector3();
const _plane = new THREE.Plane(), _clip = new THREE.Plane(), _v4 = new THREE.Vector4(), _q = new THREE.Vector4();
