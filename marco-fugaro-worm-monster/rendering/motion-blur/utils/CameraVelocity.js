/**
 * CameraVelocity - the screen motion the camera gives each pixel, from the pixel's depth
 *
 * Where a static point seen at a pixel was on the screen one frame earlier, without a velocity buffer. Exact for
 * perspective cameras and robust to large world coordinates: built on the CPU in doubles, relative to the camera, so
 * the GPU never reconstructs a world position. With K(P) the x, y and w rows of a projection without its translation
 * column (K·x = w·(ndc, 1)):
 *
 *   H = K(Pprevious) · R · K(P)⁻¹, kt = K(Pprevious) · t    (R, t: the rotation and translation of Vprevious · V⁻¹)
 *   invW = depth · a + b, (a, b) = (1/P[14], P[10]/P[14])  (0 for the sky)
 *   rotation = ndc − dehom(H · (ndc, 1))                     (depth-independent: the sky's whole motion, zoom too)
 *   full = ndc − dehom(H · (ndc, 1) + kt · invW)             (translation = full − rotation)
 *
 * Velocities are NDC per frame, current − previous, like three's velocity MRT. A point behind the previous camera
 * divides by max(w, 1e-6): pushed far along its true streak, for the caller's length clamp.
 *
 *   const cameraVelocity = new CameraVelocity({ cutRotation: Math.PI / 4, cutTranslation: 0 })
 *   // once per rendered frame, after the camera's matrixWorldInverse is up to date; P: the unjittered projection;
 *   // previous: { view, projection } the velocity buffer was built with, if any (else the instance's own history)
 *   const { cut } = cameraVelocity.update(camera, P, previous)
 *   // TSL, inside an Fn
 *   const { rotation, full } = cameraVelocity.velocityAt(ndc, depth, isSky)
 *   const distance = cameraVelocity.viewDistanceAt(depth)
 *
 * A cut (no camera velocity) happens on the first update, after reset(), when the camera object or the projection's
 * aspect changes, when the camera turns by more than `cutRotation` in one frame and, with `cutTranslation` > 0, when
 * it moves farther than that. A non-perspective camera warns once and gives no camera velocity. Without `previous`,
 * a second update() in the same frame compares the camera with itself: one consumer per instance.
 */
import { Matrix3, Matrix4, Vector2, Vector3, Vector4 } from 'three/webgpu'
import { float, max, uniform, vec3 } from 'three/tsl'

const _relative = /* @__PURE__ */ new Matrix4()
const _cameraWorld = /* @__PURE__ */ new Matrix4()
const _rotation = /* @__PURE__ */ new Matrix3()
const _translation = /* @__PURE__ */ new Vector3()
const _kPrevious = /* @__PURE__ */ new Matrix3()
const _kCurrentInverse = /* @__PURE__ */ new Matrix3()

// The x, y and w rows of a projection without its translation column. Matrix3.set takes rows; elements are column-major.
function projectionToK(projection, target) {
  const e = projection.elements
  return target.set(e[0], e[4], e[8], e[1], e[5], e[9], e[3], e[7], e[11])
}

class CameraVelocity {
  isCameraVelocity = true

  /** Radians per frame: a larger turn of the camera is a cut. */
  cutRotation
  /** World units per frame: a longer move of the camera is a cut; 0 turns the rule off. */
  cutTranslation

  #homography = uniform(new Matrix3())
  #translationTerm = uniform(new Vector3())
  #depthToInvW = uniform(new Vector2(1, 0))
  // view distance = (x + depth·y) / (z + depth·w) = (P[14] − depth·P[15]) / (P[10] − depth·P[11])
  #viewDistance = uniform(new Vector4(1, 0, 1, 0))
  #previousView = new Matrix4()
  #previousProjection = new Matrix4()
  #hasHistory = false
  #camera = null
  #needsReset = false
  #warned = false

  /**
   * @param {object} [options]
   * @param {number} [options.cutRotation=Math.PI / 4] - Radians per frame; a larger turn is a cut.
   * @param {number} [options.cutTranslation=0] - World units per frame; a longer move is a cut (0: off).
   */
  constructor({ cutRotation = Math.PI / 4, cutTranslation = 0 } = {}) {
    this.cutRotation = cutRotation
    this.cutTranslation = cutTranslation
  }

  /** The homography H (uniform, mat3): previous NDC of a point at infinity, before the divide. Read-only. */
  get homography() {
    return this.#homography
  }

  /**
   * Builds this frame's H and kt, once per rendered frame, after the camera's matrixWorldInverse is up to date.
   *
   * @param {Camera} camera
   * @param {Matrix4} [projectionMatrix=camera.projectionMatrix] - The unjittered current projection.
   * @param {?{view: Matrix4, projection: Matrix4}} [previous=null] - The previous view and projection the velocity
   *   buffer was built with; null uses this instance's own from the last update.
   * @returns {{cut: boolean, rotationAngle: number, translationLength: number}} Whether this frame is a cut, and the
   *   camera's turn (radians) and move (world units) since the previous frame.
   */
  update(camera, projectionMatrix = camera.projectionMatrix, previous = null) {
    const perspective = camera.isPerspectiveCamera === true
    if (!perspective && !this.#warned) {
      this.#warned = true
      console.warn('CameraVelocity: only perspective cameras give camera velocity; this one gives none.')
    }
    const P = projectionMatrix
    const previousView = previous?.view ?? (this.#hasHistory ? this.#previousView : null)
    const previousProjection = previous?.projection ?? (this.#hasHistory ? this.#previousProjection : null)

    let cut = this.#needsReset || !this.#hasHistory || camera !== this.#camera
    let rotationAngle = 0
    let translationLength = 0
    if (previousView === null || previousProjection === null) {
      cut = true
    } else {
      // current view space → previous view space, in doubles (the view matrix, without the parents' scale)
      _relative.multiplyMatrices(previousView, _cameraWorld.copy(camera.matrixWorldInverse).invert())
      _rotation.setFromMatrix4(_relative)
      _translation.setFromMatrixPosition(_relative)
      const r = _rotation.elements
      rotationAngle = Math.acos(Math.min(1, Math.max(-1, (r[0] + r[4] + r[8] - 1) / 2)))
      translationLength = _translation.length()
      const aspect = P.elements[5] / P.elements[0]
      const previousAspect = previousProjection.elements[5] / previousProjection.elements[0]
      if (!(Math.abs(aspect - previousAspect) <= 1e-6 * Math.abs(aspect))) cut = true
      if (rotationAngle > this.cutRotation) cut = true
      if (this.cutTranslation > 0 && translationLength > this.cutTranslation) cut = true
    }

    if (cut || !perspective) {
      this.#homography.value.identity()
      this.#translationTerm.value.set(0, 0, 0)
    } else {
      projectionToK(previousProjection, _kPrevious)
      projectionToK(P, _kCurrentInverse).invert()
      this.#homography.value.multiplyMatrices(_kPrevious, _rotation).multiply(_kCurrentInverse)
      this.#translationTerm.value.copy(_translation).applyMatrix3(_kPrevious)
    }
    const e = P.elements
    // unused without a perspective, where an orthographic near of 0 would make it NaN
    if (perspective) this.#depthToInvW.value.set(1 / e[14], e[10] / e[14])
    else this.#depthToInvW.value.set(0, 0)
    this.#viewDistance.value.set(e[14], -e[15], e[10], -e[11])

    // copies: three updates both matrices in place, and P may be a shared one
    this.#previousView.copy(camera.matrixWorldInverse)
    this.#previousProjection.copy(P)
    this.#camera = camera
    this.#hasHistory = true
    this.#needsReset = false
    return { cut, rotationAngle, translationLength }
  }

  /** The next update() is a cut: no camera velocity, history re-seeded. */
  reset() {
    this.#needsReset = true
  }

  /**
   * The camera's NDC velocity per frame at `ndc` (vec2) of a pixel of raw `depth` (float); `isSky` (bool) treats it
   * as a point at infinity. TSL, inside an Fn, the inputs in variables.
   *
   * @returns {{rotation: Node<vec2>, full: Node<vec2>}} The rotation (and zoom) part, and the whole camera velocity.
   */
  velocityAt(ndc, depth, isSky) {
    const ab = this.#depthToInvW
    const invW = depth
      .mul(ab.x)
      .add(ab.y)
      .mul(float(1).sub(float(isSky)))
      .toVar()
    const hRot = this.#homography.mul(vec3(ndc, 1)).toVar()
    const hFull = hRot.add(this.#translationTerm.mul(invW)).toVar()
    const rotation = ndc.sub(hRot.xy.div(max(hRot.z, 1e-6))).toVar()
    const full = ndc.sub(hFull.xy.div(max(hFull.z, 1e-6))).toVar()
    return { rotation, full }
  }

  /** The positive view distance of raw `depth` (float), perspective or orthographic, normal or reversed. TSL. */
  viewDistanceAt(depth) {
    const u = this.#viewDistance
    return u.x.add(depth.mul(u.y)).div(u.z.add(depth.mul(u.w)))
  }
}

export { CameraVelocity }
