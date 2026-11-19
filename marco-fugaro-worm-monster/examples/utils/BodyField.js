import * as THREE from 'three/webgpu'
import {
  If,
  Loop,
  clamp,
  dot,
  exp,
  float,
  length,
  max,
  min,
  mix,
  select,
  sqrt,
  uniform,
  uniformArray,
  uniformGroup,
  vec3,
} from 'three/tsl'
import { Capsule } from 'three/addons/math/Capsule.js'

/**
 * BodyField — a skinned body as a smooth union of round cones, one per bone, that any shader can sample for a
 * signed distance, an outward normal and the body's velocity: a soft, moving volume to pull particles into, rest them
 * on or drag them along with, without baking a distance volume per pose.
 *
 *   const field = BodyField.fromSkinnedMesh(skinnedMesh)  // fitted in the bind pose
 *   // or new BodyField([{ startBone, endBone, start, end, startRadius, endRadius }, …], { smoothing: 0.1 })
 *   mixer.update(delta)
 *   figure.updateMatrixWorld(true)
 *   field.update(delta)                                   // reads the bones
 *   // inside a Fn of any stage; alpha in [0, 1] blends last frame's pose into this one's (a substep's progress)
 *   const { distance, normal, velocity, coreDistance } = field.sample(positionWorld, alpha)
 *   field.distanceAt(point, normal)                       // the same on the CPU, at the current pose
 *   field.volumeByHeight(0.1, 20)                         // m³ inside the field per 10 cm layer above `floor`
 *   noodles.colliders.push(...field.colliders)            // a Capsule per cone, moved in place by update()
 *   scene.add(new BodyFieldHelper(field))                 // cones and the shell's outline; helper.update()
 *
 * Each cone is the exact round-cone distance (two spheres and the cone tangent to both); the cones meet through a
 * polynomial smooth minimum of width `smoothing`, which also blends their normals and velocities. `coreDistance` is
 * that union; `distance` subtracts an inflation (none by default) that grows toward the floor,
 * inflate(y) = inflateTop + (inflateBottom − inflateTop) · exp(−(y − floor) / inflateFalloff). `velocity` is how the
 * closest axis point moved over the last frame, at most `maxBodySpeed`. Endpoints live in one uniform array, so
 * sampling needs no storage binding. Past `cullDistance` outside the field, sample() skips the cones and returns lower
 * bounds; nearer, it skips each cone too far away to change the union.
 */

const SETTINGS = {
  smoothing: 0.1,
  inflateBottom: 0,
  inflateTop: 0,
  inflateFalloff: 0.55,
  floor: 0,
  coreMargin: 0,
  maxBodySpeed: Infinity,
  jumpDistance: 0.3,
  cullDistance: 0.5,
}
const OPTION_KEYS = [...Object.keys(SETTINGS), 'mesh']
const FIT_DEFAULTS = { percentile: 0.7, minWeight: 0.5, leafPercentile: 0.95 }
// Vertices an end of a cone needs for its own radius; fewer and it takes the whole cone's.
const MIN_END_VERTICES = 8
// ((r1 − r2) / length)² from which the larger sphere holds the smaller one: the cone is that sphere.
const CONTAINED = 1
const FAR = 1e9
// The slack (× the position's magnitude + 1 m) the cone skips of sample() and distanceAt() keep over float rounding.
const BOUND_SLACK = 1e-5
// Floats of contour lines the helper's shell starts with.
const SHELL_CAPACITY = 6 * 4096

const _matrix = new THREE.Matrix4()
const _post = new THREE.Matrix4()
const _vector = new THREE.Vector3()
const _normal = new THREE.Vector3()
const _gradient = new THREE.Vector3()

let fieldId = 0

export class BodyField {
  isBodyField = true
  type = 'BodyField'

  /** Width of the smooth union between cones, m. */
  smoothing = SETTINGS.smoothing
  /** Inflation at `floor`, m. */
  inflateBottom = SETTINGS.inflateBottom
  /** Inflation far above `floor`, m. */
  inflateTop = SETTINGS.inflateTop
  /** Height over which the inflation falls from inflateBottom toward inflateTop (1/e), m. */
  inflateFalloff = SETTINGS.inflateFalloff
  /** Height of the floor, where the inflation is inflateBottom; below it the inflation stays there. */
  floor = SETTINGS.floor
  /** Added to each collider capsule's radius (the cone's mean radius), m; may be negative. */
  coreMargin = SETTINGS.coreMargin
  /** The most `velocity` reports, m/s. */
  maxBodySpeed = SETTINGS.maxBodySpeed
  /** An endpoint moving farther than this in one update is a jump: last frame's pose is dropped, m. */
  jumpDistance = SETTINGS.jumpDistance
  /** How far outside the field sample() stays exact; farther out it skips the cones and returns lower bounds, m. */
  cullDistance = SETTINGS.cullDistance
  /** A SkinnedMesh to read the bones through as it is skinned (matrixWorld · bindMatrixInverse · bone), or null. */
  mesh = null

  /**
   * The cones, read only: `{ name, startBone, endBone, start, end, startRadius, endRadius }`, `start` in startBone's
   * local space, `end` in endBone's, radii in world metres.
   */
  cones
  /** A Capsule per cone, world space, at the current pose: its axis, mean radius + coreMargin, never below `floor`. */
  colliders
  /** Encloses the field (distance < 0) at the last two poses, read only. */
  boundingSphere = new THREE.Sphere()

  #count
  #now
  #last
  #data
  #uniforms
  #bounds = new THREE.Vector4()
  #all
  #inverseDelta = 0

  /**
   * @param {object[]} cones - `{ startBone, endBone = startBone, start, end, startRadius, endRadius, name? }`: start
   *   and end are Vector3 in their bone's local space, radii in world metres.
   * @param {object} [options] - Any setting (smoothing, inflateBottom, inflateTop, inflateFalloff, floor, coreMargin,
   *   maxBodySpeed, jumpDistance, cullDistance), and `mesh`, a SkinnedMesh to read the bones through.
   */
  constructor(cones, options = {}) {
    if (!Array.isArray(cones) || cones.length === 0) throw new Error('BodyField: cones must be a non-empty array.')
    readOptions(options, OPTION_KEYS, 'BodyField')
    this.cones = cones.map(readCone)
    for (const key of OPTION_KEYS) if (options[key] !== undefined) this[key] = options[key]

    const count = (this.#count = this.cones.length)
    this.#now = new Float64Array(8 * count)
    this.#last = new Float64Array(8 * count)
    this.#all = Int32Array.from({ length: count }, (_, i) => 8 * i)
    this.#data = Array.from({ length: 4 * count }, () => new THREE.Vector4())
    const name = `bodyField${fieldId++}`
    this.#uniforms = {
      // An 'object' group of its own: uploaded after a change (#sync()), not at every dispatch and draw.
      cones: uniformArray(this.#data, 'vec4').setName(`${name}_cones`).setGroup(uniformGroup('object')),
      bounds: uniform(new THREE.Vector4()).setName(`${name}_bounds`),
      smoothing: uniform(0).setName(`${name}_smoothing`),
      inflateBottom: uniform(0).setName(`${name}_inflateBottom`),
      inflateTop: uniform(0).setName(`${name}_inflateTop`),
      inflateFalloff: uniform(1).setName(`${name}_inflateFalloff`),
      floor: uniform(0).setName(`${name}_floor`),
      maxBodySpeed: uniform(0).setName(`${name}_maxBodySpeed`),
      cullDistance: uniform(0).setName(`${name}_cullDistance`),
      inverseDelta: uniform(0).setName(`${name}_inverseDelta`),
    }
    this.colliders = this.cones.map(() => new Capsule(new THREE.Vector3(), new THREE.Vector3(), 0))
    this.#readPose(this.#now)
    this.#last.set(this.#now)
    this.#sync()
  }

  /**
   * Fits a cone to each bone that owns vertices, in the mesh's bind pose: each vertex goes to its dominant bone (kept
   * when that weight is at least minWeight), a cone runs from the bone to the child it fits tightest, a leaf's along
   * its parent → bone direction out to the `leafPercentile` of its vertices' projections, and each end's radius is the
   * `percentile` of the radial distances there. Read the mesh where it is scaled as it will be drawn.
   *
   * @param {THREE.SkinnedMesh} mesh
   * @param {object} [options] - percentile (0.7), minWeight (0.5), leafPercentile (0.95), and the field's options.
   */
  static fromSkinnedMesh(mesh, options = {}) {
    if (!mesh?.isSkinnedMesh) throw new Error('BodyField.fromSkinnedMesh: mesh must be a SkinnedMesh.')
    const fit = {}
    const rest = {}
    for (const [key, value] of Object.entries(options)) (key in FIT_DEFAULTS ? fit : rest)[key] = value
    readOptions(rest, OPTION_KEYS, 'BodyField.fromSkinnedMesh')
    const cones = fitCones(mesh, { ...FIT_DEFAULTS, ...fit })
    if (cones.length === 0) throw new Error('BodyField.fromSkinnedMesh: no bone owns a vertex.')
    return new BodyField(cones, { mesh, ...rest })
  }

  /**
   * Reads the bones' world matrices, keeping the previous pose for sample()'s alpha. Call it once a frame, after the
   * mixer and updateMatrixWorld(). A jump past jumpDistance, or delta 0, leaves the field still.
   *
   * @param {number} delta - Seconds since the last update.
   */
  update(delta = 0) {
    this.#last.set(this.#now)
    this.#readPose(this.#now)
    if (!(delta > 0) || this.#jumped()) this.#last.set(this.#now)
    this.#inverseDelta = delta > 0 ? 1 / delta : 0
    this.#sync()
  }

  /**
   * The field at a world position, as TSL. Call it inside a Fn: it declares variables and loops over the cones.
   *
   * @param {Node<vec3>} positionNode - World position.
   * @param {Node<float>|number} [alphaNode=1] - 0 samples last frame's pose, 1 this one's.
   * @returns {{ distance: Node<float>, normal: Node<vec3>, velocity: Node<vec3>, coreDistance: Node<float> }}
   */
  sample(positionNode, alphaNode = 1) {
    const u = this.#uniforms
    const p = vec3(positionNode).toVar()
    const alpha = float(alphaNode).toVar()
    const inflate = u.inflateTop
      .add(
        u.inflateBottom.sub(u.inflateTop).mul(exp(max(p.y.sub(u.floor), 0).div(max(u.inflateFalloff, 1e-6)).negate())),
      )
      .toVar()
    const offset = p.sub(u.bounds.xyz).toVar()
    const reach = length(offset).toVar()
    const core = reach.sub(u.bounds.w).toVar()
    const gradient = offset.toVar()
    const velocity = vec3(0).toVar()

    If(core.sub(inflate).lessThanEqual(u.cullDistance), () => {
      const k = max(u.smoothing, 1e-6)
      const slack = length(p).add(1).mul(BOUND_SLACK).toVar()
      core.assign(FAR)
      gradient.assign(vec3(0))
      Loop(this.#count, ({ i }) => {
        const j = i.mul(4)
        const aNow = u.cones.element(j)
        const bNow = u.cones.element(j.add(1))
        const aLast = u.cones.element(j.add(2))
        const bLast = u.cones.element(j.add(3))
        const a = mix(aLast.xyz, aNow.xyz, alpha).toVar()
        const ab = mix(bLast.xyz, bNow.xyz, alpha).sub(a).toVar()
        const r1 = aNow.w
        const r2 = bNow.w
        const span = length(ab).toVar()
        // A cone at least `smoothing` farther than the union so far blends in with weight 0: skipped, by the distance
        // to its bounding sphere, which never exceeds the cone's.
        const lower = length(p.sub(a.add(ab.mul(0.5)))).sub(span.mul(0.5).add(max(r1, r2)))
        If(lower.lessThan(core.add(k).add(slack)), () => {
          const safeSpan = max(span, 1e-6)
          const axis = ab.div(safeSpan)
          const pa = p.sub(a).toVar()
          const along = dot(pa, axis).toVar()
          const radial = sqrt(max(dot(pa, pa).sub(along.mul(along)), 0))
          // sin of the side's tilt: the closest sphere centre sits radial · tan(tilt) behind the projection
          const tilt = r1.sub(r2).div(safeSpan).toVar()
          const slide = radial.mul(tilt).div(sqrt(max(float(1).sub(tilt.mul(tilt)), 1e-12)))
          const s = select(
            tilt.mul(tilt).greaterThanEqual(CONTAINED),
            select(r1.greaterThanEqual(r2), float(0), span),
            clamp(along.sub(slide), 0, span),
          ).toVar()
          const t = s.div(safeSpan).toVar()
          const toP = p.sub(a.add(axis.mul(s))).toVar()
          const gap = length(toP).toVar()
          const coneDistance = gap.sub(mix(r1, r2, t))
          const coneNormal = select(gap.greaterThan(1e-9), toP.div(max(gap, 1e-9)), vec3(0, 1, 0))
          const coneMotion = mix(aNow.xyz.sub(aLast.xyz), bNow.xyz.sub(bLast.xyz), t)
          const h = clamp(core.sub(coneDistance).div(k).mul(0.5).add(0.5), 0, 1).toVar()
          core.assign(mix(core, coneDistance, h).sub(k.mul(h).mul(h.oneMinus())))
          gradient.assign(mix(gradient, coneNormal, h))
          velocity.assign(mix(velocity, coneMotion, h))
        })
      })
      velocity.mulAssign(u.inverseDelta)
      velocity.mulAssign(min(float(1), u.maxBodySpeed.div(max(length(velocity), 1e-9))))
    })

    const g = length(gradient)
    const normal = select(g.greaterThan(1e-9), gradient.div(max(g, 1e-9)), vec3(0, 1, 0)).toVar()
    return { distance: core.sub(inflate).toVar(), normal, velocity, coreDistance: core }
  }

  /**
   * The signed distance at a world point at the current pose, as sample() at alpha 1.
   *
   * @param {THREE.Vector3} point
   * @param {?THREE.Vector3} [targetNormal] - Set to the unit outward normal.
   * @returns {number}
   */
  distanceAt(point, targetNormal = null) {
    const core = this.#coreAt(point.x, point.y, point.z, targetNormal ?? _normal)
    return core - inflateAt(this, point.y)
  }

  /**
   * The field's volume (distance < 0) per height layer at the current pose, from a 5 cm world-aligned grid: layer i
   * spans floor + [i, i + 1) · step.
   *
   * @param {number} [step=0.1] - Layer height, m.
   * @param {number} [count=20] - Layers.
   * @param {Float32Array} [out]
   * @returns {Float32Array} m³ per layer.
   */
  volumeByHeight(step = 0.1, count = 20, out = new Float32Array(count)) {
    const cell = 0.05
    const volume = cell ** 3
    const k = Math.max(this.smoothing, 1e-6)
    const list = new Int32Array(this.#count)
    const rect = new Float64Array(4)
    out.fill(0)
    for (let iy = 0; ; iy++) {
      const y = this.floor + (iy + 0.5) * cell
      const layer = Math.floor((y - this.floor) / step)
      if (layer >= count) break
      const inflate = inflateAt(this, y)
      const n = sliceOf(this.#now, y, inflate + 2 * k, list, rect)
      if (n === 0) continue
      for (let iz = Math.floor(rect[2] / cell); iz <= Math.ceil(rect[3] / cell); iz++) {
        const z = (iz + 0.5) * cell
        for (let ix = Math.floor(rect[0] / cell); ix <= Math.ceil(rect[1] / cell); ix++) {
          if (unionAt(this.#now, list, n, k, (ix + 0.5) * cell, y, z, _gradient) < inflate) out[layer] += volume
        }
      }
    }
    return out
  }

  /** Copies another field with as many cones: its settings, mesh and cones; then reads the pose, at rest. */
  copy(source) {
    if (source.cones.length !== this.#count) {
      throw new Error(`BodyField.copy: ${source.cones.length} cones can't replace ${this.#count}.`)
    }
    const cones = source.cones.map(readCone)
    for (const key of OPTION_KEYS) this[key] = source[key]
    cones.forEach((cone, i) => {
      Object.assign(this.cones[i], cone)
    })
    this.#readPose(this.#now)
    this.#last.set(this.#now)
    this.#inverseDelta = 0
    this.#sync()
    return this
  }

  clone() {
    const options = {}
    for (const key of OPTION_KEYS) options[key] = this[key]
    return new BodyField(this.cones, options)
  }

  /** The field holds no GPU resource of its own: its uniforms go with the shaders that sample it. */
  dispose() {
    this.mesh = null
  }

  // World endpoints and radii of every cone, 8 numbers each: a (xyz, r), b (xyz, r).
  #readPose(target) {
    if (this.mesh) _post.multiplyMatrices(this.mesh.matrixWorld, this.mesh.bindMatrixInverse)
    for (let i = 0; i < this.#count; i++) {
      const cone = this.cones[i]
      this.#toWorld(cone.startBone, cone.start).toArray(target, 8 * i)
      target[8 * i + 3] = cone.startRadius
      this.#toWorld(cone.endBone, cone.end).toArray(target, 8 * i + 4)
      target[8 * i + 7] = cone.endRadius
    }
  }

  #toWorld(bone, local) {
    _matrix.copy(bone.matrixWorld)
    if (this.mesh) _matrix.premultiply(_post)
    return _vector.copy(local).applyMatrix4(_matrix)
  }

  #jumped() {
    const limit = this.jumpDistance ** 2
    const now = this.#now
    const last = this.#last
    for (let i = 0; i < now.length; i += 4) {
      const dx = now[i] - last[i]
      const dy = now[i + 1] - last[i + 1]
      const dz = now[i + 2] - last[i + 2]
      if (dx * dx + dy * dy + dz * dz > limit) return true
    }
    return false
  }

  // The settings, poses, bounds and colliders into their uniforms and objects.
  #sync() {
    const u = this.#uniforms
    const now = this.#now
    const last = this.#last
    const data = this.#data
    let changed = false
    for (let i = 0; i < this.#count; i++) {
      const o = 8 * i
      if (setChanged(data[4 * i], now, o)) changed = true
      if (setChanged(data[4 * i + 1], now, o + 4)) changed = true
      if (setChanged(data[4 * i + 2], last, o)) changed = true
      if (setChanged(data[4 * i + 3], last, o + 4)) changed = true
      const capsule = this.colliders[i]
      capsule.start.fromArray(now, o)
      capsule.end.fromArray(now, o + 4)
      // never through the floor, which would press what rests on it down into it
      const clearance = Math.min(now[o + 1], now[o + 5]) - this.floor
      capsule.radius = Math.max(0, Math.min((now[o + 3] + now[o + 7]) / 2 + this.coreMargin, clearance))
    }
    // A sphere around both poses' cones, widened by the smooth union's reach (at most `smoothing` past the cones).
    const box = this.#box(now, this.#box(last))
    const center = box.getCenter(_vector)
    let radius = 0
    for (const pose of [now, last]) {
      for (let i = 0; i < pose.length; i += 4) {
        const d = Math.hypot(pose[i] - center.x, pose[i + 1] - center.y, pose[i + 2] - center.z) + pose[i + 3]
        radius = Math.max(radius, d)
      }
    }
    const smoothing = Math.max(this.smoothing, 1e-6)
    this.#bounds.set(center.x, center.y, center.z, radius + smoothing)
    this.boundingSphere.set(center, radius + smoothing + Math.max(this.inflateBottom, this.inflateTop, 0))
    if (changed) {
      // Its buffer refreshed from the array (unbuilt, it has none yet) and its group bumped: every binding uploads
      // it once, at its next use.
      if (u.cones.value) u.cones.updateBuffer()
      u.cones.groupNode.needsUpdate = true
    }
    u.bounds.value.copy(this.#bounds)
    u.smoothing.value = this.smoothing
    u.inflateBottom.value = this.inflateBottom
    u.inflateTop.value = this.inflateTop
    u.inflateFalloff.value = this.inflateFalloff
    u.floor.value = this.floor
    u.maxBodySpeed.value = Math.min(this.maxBodySpeed, FAR)
    u.cullDistance.value = this.cullDistance
    u.inverseDelta.value = this.#inverseDelta
  }

  // The box around a pose's spheres, expanding `target` (a new Box3 by default).
  #box(pose, target = new THREE.Box3()) {
    for (let i = 0; i < pose.length; i += 4) {
      const r = pose[i + 3]
      target.expandByPoint(_vector.set(pose[i] - r, pose[i + 1] - r, pose[i + 2] - r))
      target.expandByPoint(_vector.set(pose[i] + r, pose[i + 1] + r, pose[i + 2] + r))
    }
    return target
  }

  // The smooth union's distance at the current pose, its unit gradient into `normal`: sample() in float64.
  #coreAt(px, py, pz, normal) {
    const bounds = this.#bounds
    const ox = px - bounds.x
    const oy = py - bounds.y
    const oz = pz - bounds.z
    let core = Math.hypot(ox, oy, oz) - bounds.w
    _gradient.set(ox, oy, oz)
    if (core - inflateAt(this, py) <= this.cullDistance) {
      core = unionAt(this.#now, this.#all, this.#count, Math.max(this.smoothing, 1e-6), px, py, pz, _gradient)
    }
    const g = _gradient.length()
    if (g > 1e-9) normal.copy(_gradient).divideScalar(g)
    else normal.set(0, 1, 0)
    return core
  }
}

// inflate(y): inflateTop + (inflateBottom − inflateTop) · exp(−(y − floor) / inflateFalloff), held at floor below it.
function inflateAt(field, y) {
  const height = Math.max(y - field.floor, 0)
  return (
    field.inflateTop +
    (field.inflateBottom - field.inflateTop) * Math.exp(-height / Math.max(field.inflateFalloff, 1e-6))
  )
}

/**
 * The smooth union of the cones at `list[0…count)` (offsets into `pose`, 8 numbers per cone: a xyz, r1, b xyz, r2) at
 * a point, at smoothing `k`; its gradient, not normalized, into `gradient`. sample()'s loop, in float64.
 */
function unionAt(pose, list, count, k, px, py, pz, gradient) {
  let core = FAR
  let gx = 0
  let gy = 0
  let gz = 0
  const slack = (Math.abs(px) + Math.abs(py) + Math.abs(pz) + 1) * BOUND_SLACK
  for (let c = 0; c < count; c++) {
    const i = list[c]
    const ax = pose[i]
    const ay = pose[i + 1]
    const az = pose[i + 2]
    const r1 = pose[i + 3]
    const abx = pose[i + 4] - ax
    const aby = pose[i + 5] - ay
    const abz = pose[i + 6] - az
    const r2 = pose[i + 7]
    const span = Math.hypot(abx, aby, abz)
    const pax = px - ax
    const pay = py - ay
    const paz = pz - az
    // As sample(): a cone at least `smoothing` farther than the union so far blends in with weight exactly 0, which
    // leaves the union, its gradient and every later cone's blend bit for bit as they are. Skipped, by the distance to
    // its bounding sphere, which never exceeds the cone's.
    const mx = pax - 0.5 * abx
    const my = pay - 0.5 * aby
    const mz = paz - 0.5 * abz
    const reach = core + k + slack + 0.5 * span + Math.max(r1, r2)
    if (reach <= 0 || mx * mx + my * my + mz * mz > reach * reach) continue
    const safeSpan = Math.max(span, 1e-6)
    const along = (pax * abx + pay * aby + paz * abz) / safeSpan
    const radial = Math.sqrt(Math.max(pax * pax + pay * pay + paz * paz - along * along, 0))
    const tilt = (r1 - r2) / safeSpan
    let s
    if (tilt * tilt >= CONTAINED) s = r1 >= r2 ? 0 : span
    else s = Math.min(Math.max(along - (radial * tilt) / Math.sqrt(Math.max(1 - tilt * tilt, 1e-12)), 0), span)
    const t = s / safeSpan
    const tx = pax - (abx / safeSpan) * s
    const ty = pay - (aby / safeSpan) * s
    const tz = paz - (abz / safeSpan) * s
    const gap = Math.hypot(tx, ty, tz)
    const coneDistance = gap - (r1 + (r2 - r1) * t)
    let nx = 0
    let ny = 1
    let nz = 0
    if (gap > 1e-9) {
      nx = tx / gap
      ny = ty / gap
      nz = tz / gap
    }
    const h = Math.min(Math.max(0.5 + (0.5 * (core - coneDistance)) / k, 0), 1)
    core = core + (coneDistance - core) * h - k * h * (1 - h)
    gx += (nx - gx) * h
    gy += (ny - gy) * h
    gz += (nz - gz) * h
  }
  gradient.set(gx, gy, gz)
  return core
}

/**
 * The cones of `pose` within `reach` of height y, as offsets into `list`, and their xz box grown by `reach` into `rect`
 * (min x, max x, min z, max z). A cone farther than inflate(y) + 2 · smoothing from every point of the layer can't
 * move the layer's zero level (the smooth union passes it unchanged once it is `smoothing` below that cone).
 */
function sliceOf(pose, y, reach, list, rect) {
  let count = 0
  rect[0] = rect[2] = Infinity
  rect[1] = rect[3] = -Infinity
  for (let i = 0; i < pose.length; i += 8) {
    const r = Math.max(pose[i + 3], pose[i + 7])
    const low = Math.min(pose[i + 1], pose[i + 5]) - r
    const high = Math.max(pose[i + 1], pose[i + 5]) + r
    if (y < low - reach || y > high + reach) continue
    list[count++] = i
    rect[0] = Math.min(rect[0], Math.min(pose[i], pose[i + 4]) - r - reach)
    rect[1] = Math.max(rect[1], Math.max(pose[i], pose[i + 4]) + r + reach)
    rect[2] = Math.min(rect[2], Math.min(pose[i + 2], pose[i + 6]) - r - reach)
    rect[3] = Math.max(rect[3], Math.max(pose[i + 2], pose[i + 6]) + r + reach)
  }
  return count
}

/**
 * Draws a BodyField: each cone's wire (its two tangent circles, four side lines and the arcs over its caps) and
 * the inflated shell's outline as contours every `shellStep` of height. It reads the field's colliders, cones and
 * settings in world space, so keep it at the scene's root. Call update() after the field's.
 */
export class BodyFieldHelper extends THREE.Object3D {
  isBodyFieldHelper = true
  type = 'BodyFieldHelper'

  /** Height between the shell's contours, m. */
  shellStep = 0.1
  /** Grid spacing of the contours, m. Each contour costs about (its box / shellSpacing)² · the cones reaching it. */
  shellSpacing = 0.06
  /** Whether update() redraws the shell's contours. */
  showShell = true

  field
  /** @type {THREE.LineSegments} */
  coneLines
  /** @type {THREE.LineSegments} */
  shellLines

  #segments
  #shellCapacity = 0

  /**
   * @param {BodyField} field
   * @param {object} [options]
   * @param {THREE.ColorRepresentation} [options.coneColor=0x40c8ff]
   * @param {THREE.ColorRepresentation} [options.shellColor=0xffa040]
   * @param {number} [options.segments=16] - Segments per circle.
   */
  constructor(field, options = {}) {
    super()
    readOptions(options, ['coneColor', 'shellColor', 'segments'], 'BodyFieldHelper')
    const { coneColor = 0x40c8ff, shellColor = 0xffa040, segments = 16 } = options
    this.field = field
    this.name = 'round cone field helper'
    this.matrixAutoUpdate = false
    this.#segments = Math.max(4, Math.round(segments / 2) * 2)
    const lineMaterial = (name, color) =>
      new THREE.LineBasicNodeMaterial({
        name,
        color,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        transparent: true,
      })
    const coneGeometry = new THREE.BufferGeometry()
    const perCone = 4 * this.#segments + 4
    coneGeometry.setAttribute('position', dynamic(new Float32Array(field.cones.length * perCone * 6)))
    this.coneLines = new THREE.LineSegments(coneGeometry, lineMaterial('round cone field cones', coneColor))
    this.coneLines.name = 'round cone field cones'
    this.shellLines = new THREE.LineSegments(
      shellGeometry(SHELL_CAPACITY),
      lineMaterial('round cone field shell', shellColor),
    )
    this.#shellCapacity = SHELL_CAPACITY
    this.shellLines.name = 'round cone field shell'
    for (const lines of [this.coneLines, this.shellLines]) {
      lines.frustumCulled = false
      lines.renderOrder = 1
      lines.matrixAutoUpdate = false
      this.add(lines)
    }
    this.update()
  }

  /** Redraws the cones at the field's current pose, and the shell when showShell is set. */
  update() {
    const position = this.coneLines.geometry.getAttribute('position')
    const writer = new SegmentWriter(position.array)
    this.field.colliders.forEach((capsule, i) => {
      const cone = this.field.cones[i]
      writeCone(writer, capsule.start, capsule.end, cone.startRadius, cone.endRadius, this.#segments)
    })
    position.needsUpdate = true
    this.coneLines.geometry.setDrawRange(0, writer.count)
    this.shellLines.visible = this.showShell
    if (this.showShell) this.#updateShell()
  }

  dispose() {
    for (const lines of [this.coneLines, this.shellLines]) {
      lines.geometry.dispose()
      lines.material.dispose()
    }
  }

  // Marching squares on horizontal slices of the field's distance, each over the cones that reach it.
  #updateShell() {
    const field = this.field
    const spacing = Math.max(this.shellSpacing, 0.005)
    const step = Math.max(this.shellStep, 0.005)
    const k = Math.max(field.smoothing, 1e-6)
    // The field's current pose, from its colliders and cones.
    const pose = new Float64Array(8 * field.cones.length)
    field.colliders.forEach((capsule, i) => {
      capsule.start.toArray(pose, 8 * i)
      pose[8 * i + 3] = field.cones[i].startRadius
      capsule.end.toArray(pose, 8 * i + 4)
      pose[8 * i + 7] = field.cones[i].endRadius
    })
    const list = new Int32Array(field.cones.length)
    const rect = new Float64Array(4)
    const top = Math.max(...field.colliders.map((c) => Math.max(c.start.y, c.end.y)))
    const lines = []
    let values = new Float32Array(0)
    for (let y = field.floor + step / 2; y < top + 1; y += step) {
      const inflate = inflateAt(field, y)
      const n = sliceOf(pose, y, inflate + 2 * k, list, rect)
      if (n === 0) continue
      const i0 = Math.floor(rect[0] / spacing) - 1
      const k0 = Math.floor(rect[2] / spacing) - 1
      const nx = Math.ceil(rect[1] / spacing) + 2 - i0
      const nz = Math.ceil(rect[3] / spacing) + 2 - k0
      if (values.length < nx * nz) values = new Float32Array(nx * nz)
      for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) {
          const x = (i0 + i) * spacing
          const z = (k0 + j) * spacing
          values[j * nx + i] = unionAt(pose, list, n, k, x, y, z, _gradient) - inflate
        }
      }
      contour(values, nx, nz, (a, b, c, d) => {
        lines.push((i0 + a) * spacing, y, (k0 + b) * spacing, (i0 + c) * spacing, y, (k0 + d) * spacing)
      })
    }
    if (lines.length > this.#shellCapacity) {
      this.#shellCapacity = Math.ceil(lines.length * 1.5)
      this.shellLines.geometry.dispose()
      this.shellLines.geometry = shellGeometry(this.#shellCapacity)
    }
    const geometry = this.shellLines.geometry
    const position = geometry.getAttribute('position')
    position.array.set(lines)
    position.needsUpdate = true
    geometry.setDrawRange(0, lines.length / 3)
  }
}

// ======== Fitting ========

// One cone per bone that owns vertices, in the bind pose (see fromSkinnedMesh).
function fitCones(mesh, { percentile, minWeight, leafPercentile }) {
  for (const [key, value] of Object.entries({ percentile, minWeight, leafPercentile })) {
    if (!(value >= 0 && value <= 1)) throw new Error(`BodyField.fromSkinnedMesh: ${key} must be in [0, 1].`)
  }
  const { skeleton, geometry } = mesh
  const bones = skeleton.bones
  const position = geometry.getAttribute('position')
  const skinIndex = geometry.getAttribute('skinIndex')
  const skinWeight = geometry.getAttribute('skinWeight')
  if (!position || !skinIndex || !skinWeight) {
    throw new Error('BodyField.fromSkinnedMesh: the geometry needs position, skinIndex and skinWeight.')
  }
  // Bind space (bindMatrix · v), where bone b sat at boneInverses[b]⁻¹.
  const joints = skeleton.boneInverses.map((inverse) =>
    new THREE.Vector3().setFromMatrixPosition(_matrix.copy(inverse).invert()),
  )
  const bind = new Float64Array(3 * position.count)
  const owned = bones.map(() => [])
  const firm = bones.map(() => [])
  for (let v = 0; v < position.count; v++) {
    _vector
      .fromBufferAttribute(position, v)
      .applyMatrix4(mesh.bindMatrix)
      .toArray(bind, 3 * v)
    let best = 0
    for (let c = 1; c < skinWeight.itemSize; c++) {
      if (skinWeight.getComponent(v, c) > skinWeight.getComponent(v, best)) best = c
    }
    const weight = skinWeight.getComponent(v, best)
    if (!(weight > 0)) continue
    const bone = skinIndex.getComponent(v, best)
    owned[bone]?.push(v)
    if (weight >= minWeight) firm[bone]?.push(v)
  }

  const index = new Map(bones.map((bone, b) => [bone, b]))
  mesh.updateWorldMatrix(true, false)
  _post.multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse)
  const cones = []
  for (let b = 0; b < bones.length; b++) {
    const vertices = firm[b].length > 0 ? firm[b] : owned[b]
    if (vertices.length === 0) continue
    const bone = bones[b]
    const start = joints[b]
    const ends = bone.children
      .filter((child) => index.has(child))
      .map((child) => joints[index.get(child)])
      .filter((end) => end.distanceTo(start) > 1e-9)
    if (ends.length === 0) ends.push(leafEnd(bone, start, joints, index, bind, vertices, leafPercentile))
    let best = null
    for (const end of ends) {
      const radii = fitRadii(start, end, bind, vertices, percentile)
      if (!best || radii.score < best.score) best = { end, ...radii }
    }
    // Bind space → world metres, as the bone's skin matrix scales it now.
    bone.updateWorldMatrix(true, false)
    _matrix.multiplyMatrices(bone.matrixWorld, skeleton.boneInverses[b]).multiply(mesh.bindMatrix).premultiply(_post)
    const scale = _matrix.getMaxScaleOnAxis()
    cones.push({
      name: bone.name,
      startBone: bone,
      endBone: bone,
      start: start.clone().applyMatrix4(skeleton.boneInverses[b]),
      end: best.end.clone().applyMatrix4(skeleton.boneInverses[b]),
      startRadius: best.startRadius * scale,
      endRadius: best.endRadius * scale,
    })
  }
  return cones
}

// A leaf's end: along parent → bone out to the leafPercentile of its vertices' projections (the joint itself when
// it has no parent bone, a sphere).
function leafEnd(bone, start, joints, index, bind, vertices, leafPercentile) {
  const parent = index.get(bone.parent)
  if (parent === undefined || joints[parent].distanceTo(start) < 1e-9) return start.clone()
  const direction = start.clone().sub(joints[parent]).normalize()
  const along = vertices.map(
    (v) =>
      (bind[3 * v] - start.x) * direction.x +
      (bind[3 * v + 1] - start.y) * direction.y +
      (bind[3 * v + 2] - start.z) * direction.z,
  )
  return start.clone().addScaledVector(direction, Math.max(quantile(along, leafPercentile), 0))
}

// Each end's radius (the percentile of radial distances in its quarter of the axis) and the cone's (its score).
function fitRadii(start, end, bind, vertices, percentile) {
  const ab = end.clone().sub(start)
  const lengthSq = ab.lengthSq()
  const all = []
  const near = []
  const far = []
  for (const v of vertices) {
    const px = bind[3 * v] - start.x
    const py = bind[3 * v + 1] - start.y
    const pz = bind[3 * v + 2] - start.z
    const t = lengthSq > 0 ? Math.min(Math.max((px * ab.x + py * ab.y + pz * ab.z) / lengthSq, 0), 1) : 0
    const d = Math.hypot(px - ab.x * t, py - ab.y * t, pz - ab.z * t)
    all.push(d)
    if (t < 0.25) near.push(d)
    if (t > 0.75) far.push(d)
  }
  const score = quantile(all, percentile)
  return {
    score,
    startRadius: near.length >= MIN_END_VERTICES ? quantile(near, percentile) : score,
    endRadius: far.length >= MIN_END_VERTICES ? quantile(far, percentile) : score,
  }
}

function quantile(values, fraction) {
  const sorted = Float64Array.from(values).sort()
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]
}

// ======== Helper geometry ========

class SegmentWriter {
  count = 0

  constructor(array) {
    this.array = array
  }

  line(a, b) {
    const i = 3 * this.count
    this.array[i] = a.x
    this.array[i + 1] = a.y
    this.array[i + 2] = a.z
    this.array[i + 3] = b.x
    this.array[i + 4] = b.y
    this.array[i + 5] = b.z
    this.count += 2
  }
}

const _axis = new THREE.Vector3()
const _u = new THREE.Vector3()
const _w = new THREE.Vector3()
const _p = new THREE.Vector3()
const _q = new THREE.Vector3()

// The point at angle ψ in the meridian plane at angle θ: centre + r (cos ψ · radial(θ) + sin ψ · axis).
function onSphere(target, center, r, theta, psi) {
  return target
    .copy(center)
    .addScaledVector(_u, r * Math.cos(psi) * Math.cos(theta))
    .addScaledVector(_w, r * Math.cos(psi) * Math.sin(theta))
    .addScaledVector(_axis, r * Math.sin(psi))
}

// A round cone's wire: its tangent circles, four side lines and two meridian arcs over each cap.
function writeCone(writer, a, b, r1, r2, segments) {
  _axis.subVectors(b, a)
  const span = _axis.length()
  if (span > 1e-9) _axis.divideScalar(span)
  else _axis.set(0, 1, 0)
  _u.set(1, 0, 0)
  if (Math.abs(_axis.x) > 0.9) _u.set(0, 1, 0)
  _u.addScaledVector(_axis, -_u.dot(_axis)).normalize()
  _w.crossVectors(_axis, _u)
  const tilt = span > 1e-9 ? (r1 - r2) / span : 0
  // The larger sphere holds the smaller: draw it alone, as two great circles.
  if (tilt * tilt >= CONTAINED) {
    const [center, r] = r1 >= r2 ? [a, r1] : [b, r2]
    for (const [theta, psi0] of [
      [0, 0],
      [Math.PI / 2, 0],
    ]) {
      for (let s = 0; s < 2 * segments; s++) {
        const f = (Math.PI * s) / segments
        writer.line(
          onSphere(_p, center, r, theta, psi0 + f),
          onSphere(_q, center, r, theta, psi0 + f + Math.PI / segments),
        )
      }
    }
    return
  }
  const phi = Math.asin(tilt)
  const ring = (center, r, theta) => onSphere(_p, center, r, theta, phi)
  for (const [center, r] of [
    [a, r1],
    [b, r2],
  ]) {
    for (let s = 0; s < segments; s++) {
      const t0 = (2 * Math.PI * s) / segments
      const t1 = (2 * Math.PI * (s + 1)) / segments
      onSphere(_q, center, r, t1, phi)
      writer.line(ring(center, r, t0), _q)
    }
  }
  for (let s = 0; s < 4; s++) {
    const theta = (Math.PI * s) / 2
    onSphere(_q, b, r2, theta, phi)
    writer.line(ring(a, r1, theta), _q)
  }
  // Caps: ψ from φ over the pole to π − φ on b's side, and to −π − φ on a's.
  const half = segments / 2
  for (const [center, r, from, to] of [
    [a, r1, phi, -Math.PI - phi],
    [b, r2, phi, Math.PI - phi],
  ]) {
    for (const theta of [0, Math.PI / 2]) {
      for (let s = 0; s < half; s++) {
        const p0 = from + ((to - from) * s) / half
        const p1 = from + ((to - from) * (s + 1)) / half
        onSphere(_q, center, r, theta, p1)
        writer.line(onSphere(_p, center, r, theta, p0), _q)
      }
    }
  }
}

// Marching squares over a grid of distances (x fastest): emits each segment of the zero contour in grid units.
function contour(values, nx, nz, emit) {
  const edge = (i, k, e, out) => {
    // Edges: 0 (i,k)–(i+1,k), 1 (i+1,k)–(i+1,k+1), 2 (i,k+1)–(i+1,k+1), 3 (i,k)–(i,k+1).
    const [ia, ka, ib, kb] = [
      [i, k, i + 1, k],
      [i + 1, k, i + 1, k + 1],
      [i, k + 1, i + 1, k + 1],
      [i, k, i, k + 1],
    ][e]
    const va = values[ka * nx + ia]
    const vb = values[kb * nx + ib]
    const t = va / (va - vb)
    out[0] = ia + (ib - ia) * t
    out[1] = ka + (kb - ka) * t
  }
  const p = [0, 0]
  const q = [0, 0]
  for (let k = 0; k < nz - 1; k++) {
    for (let i = 0; i < nx - 1; i++) {
      const c =
        (values[k * nx + i] < 0 ? 1 : 0) |
        (values[k * nx + i + 1] < 0 ? 2 : 0) |
        (values[(k + 1) * nx + i + 1] < 0 ? 4 : 0) |
        (values[(k + 1) * nx + i] < 0 ? 8 : 0)
      for (const [e0, e1] of CASES[c]) {
        edge(i, k, e0, p)
        edge(i, k, e1, q)
        emit(p[0], p[1], q[0], q[1])
      }
    }
  }
}

const CASES = [
  [],
  [[3, 0]],
  [[0, 1]],
  [[3, 1]],
  [[1, 2]],
  [
    [3, 0],
    [1, 2],
  ],
  [[0, 2]],
  [[3, 2]],
  [[2, 3]],
  [[0, 2]],
  [
    [0, 1],
    [2, 3],
  ],
  [[1, 2]],
  [[1, 3]],
  [[0, 1]],
  [[3, 0]],
  [],
]

// ======== Inputs ========

// Sets `v` from array[offset…offset + 3]; true when a component changed (by Object.is: -0 is not 0).
function setChanged(v, array, offset) {
  const x = array[offset]
  const y = array[offset + 1]
  const z = array[offset + 2]
  const w = array[offset + 3]
  if (Object.is(v.x, x) && Object.is(v.y, y) && Object.is(v.z, z) && Object.is(v.w, w)) return false
  v.set(x, y, z, w)
  return true
}

function readOptions(options, keys, owner) {
  if (options === null || typeof options !== 'object') throw new Error(`${owner}: options must be an object.`)
  for (const key of Object.keys(options))
    if (!keys.includes(key)) console.warn(`${owner}: unknown option "${key}" ignored.`)
}

function readCone(cone, index) {
  const { startBone, endBone = startBone, start, end, startRadius, endRadius, name } = cone
  if (!startBone?.isObject3D || !endBone?.isObject3D) {
    throw new Error(`BodyField: cone ${index ?? ''} needs startBone (and endBone) as Object3D.`)
  }
  if (!start?.isVector3 || !end?.isVector3)
    throw new Error(`BodyField: cone ${index ?? ''} needs start and end Vector3.`)
  if (!(startRadius >= 0) || !(endRadius >= 0)) {
    throw new Error(`BodyField: cone ${index ?? ''} needs radii ≥ 0, not ${startRadius} and ${endRadius}.`)
  }
  return {
    name: name ?? startBone.name,
    startBone,
    endBone,
    start: start.clone(),
    end: end.clone(),
    startRadius,
    endRadius,
  }
}

function dynamic(array) {
  return new THREE.BufferAttribute(array, 3).setUsage(THREE.DynamicDrawUsage)
}

// Room for `floats` / 3 vertices of contour lines.
function shellGeometry(floats) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', dynamic(new Float32Array(floats)))
  geometry.setDrawRange(0, 0)
  return geometry
}
