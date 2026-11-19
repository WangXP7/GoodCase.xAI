import * as THREE from 'three/webgpu'
import {
  Fn,
  If,
  abs,
  clamp,
  dot,
  float,
  floor,
  fract,
  hash,
  instanceIndex,
  instancedArray,
  int,
  length,
  max,
  min,
  mix,
  select,
  sin,
  smoothstep,
  uint,
  uniform,
  uniformArray,
  uniformGroup,
  vec3,
  vec4,
} from 'three/tsl'

/**
 * FieldAttractor — a compute pass that pulls noodles (ropes, worms) into a signed-distance field, harder the farther
 * outside they are, each toward a home point on an anchor. Dangling tails, a boiling surface, random lurches and a
 * leash hold a crowd of strands roughly in a shape without placing any of them, so the shape stays messy and comes
 * back after being pushed out.
 *
 *   const attractor = new FieldAttractor(noodles, field, {
 *     anchors,  // Capsule[] or Sphere[], world space, moved in place each frame
 *     anchorOf, // Int32Array(count): anchor per noodle, -1 = the field alone
 *     // optional per-noodle arrays: anchorAt, slack, weight, tail, tailStart, reversed, hangShare, flattenShare,
 *     // grip, hangLevel
 *     gate: (noodle) => grip.element(noodle), // TSL float in [0, 1] per noodle; default 1
 *     rise: (noodle, anchor) => rising.element(noodle), // TSL float in [0, 1]: toward `summit`; default 0
 *   })
 *   noodles.extraPasses = { before: [], substep: [attractor.computeNode], after: [] } // before compileAsync()
 *   // each frame: move the anchors, field.update(delta), then
 *   attractor.update()
 *   noodles.update(renderer, delta)
 *   attractor.snap()        // after the anchors jump
 *   attractor.syncNoodles() // after editing the per-noodle arrays
 *
 * `noodles` is a NoodleSimulation; `field` anything with sample(position, alpha) → { distance, normal, velocity } in
 * world space (distance > 0 outside) and a `boundingSphere`, such as BodyField. The pass runs every substep after
 * the noodles' velocity pass, one thread per particle, and changes only velocities. Each noodle's own SDF is the field
 * intersected with a ball round its home; the pass adds a pull toward it, a lift against gravity while travelling home,
 * lurches, a leash, and flatten and hang terms that lay segments along the surface or let them droop, all in units of
 * |gravity| and capped at maxAcceleration; then damps the outward speed near the surface (`conform`). Pinned and
 * grabbed particles are skipped.
 */

const SETTINGS = {
  amplitude: 1,
  creep: 0.3,
  attraction: 2.5,
  approachSpeed: 3,
  response: 10,
  maxPull: 2.5,
  maxBrake: 1,
  edge: 0.03,
  homing: 1,
  tailHoming: 1,
  glide: 0.6,
  lift: 0.85,
  liftInside: 0,
  hangDistance: 0.2,
  farLift: 0.3,
  liftReach: 0.35,
  noiseAmplitude: 0.05,
  noiseFrequency: 3,
  noiseSpeed: 0.35,
  lurchAmplitude: 1,
  lurchFrequency: 0.8,
  lurchBursts: 0.15,
  burstFrequency: 0.17,
  lurchTail: 0.4,
  looseKick: 0.3,
  lurchWeight: 1,
  conform: 0,
  flatten: 0,
  flattenHang: 1,
  hang: 0,
  levelBand: 0.25,
  leashDistance: 11,
  leashBand: 0.5,
  leashPull: 0.5,
  riseSpeed: 0.2,
  riseReach: 0.1,
  maxAcceleration: 3.5,
}
const VECTOR_SETTINGS = { leashAxes: [1, 0, 1], noiseDrift: [1.3, 2.1, 0.7], summit: [0, 0, 0] }
// Settings that are the width of a smoothstep: kept above 0 on the GPU.
const BANDS = ['edge', 'liftReach', 'hangDistance', 'leashBand', 'levelBand', 'riseReach']
const ARRAYS = {
  anchorOf: { type: Int32Array, value: -1 },
  anchorAt: { type: Float32Array, value: 0.5 },
  slack: { type: Float32Array, value: 1 },
  weight: { type: Float32Array, value: 1 },
  tail: { type: Float32Array, value: 1 },
  tailStart: { type: Float32Array, value: 0.35 },
  reversed: { type: Uint8Array, value: 0 },
  hangShare: { type: Float32Array, value: 1 },
  flattenShare: { type: Float32Array, value: 1 },
  grip: { type: Float32Array, value: 0 },
  hangLevel: { type: Float32Array, value: -1 },
}
const OPTION_KEYS = [
  'anchors',
  ...Object.keys(ARRAYS),
  'gate',
  'rise',
  'name',
  ...Object.keys(SETTINGS),
  ...Object.keys(VECTOR_SETTINGS),
]
const TAU = 2 * Math.PI

const _matrix = new THREE.Matrix4()

export class FieldAttractor {
  isFieldAttractor = true
  type = 'FieldAttractor'

  // ---- Settings (read by update()) ----

  /** × the pull and the travel lift of every noodle. */
  amplitude = SETTINGS.amplitude
  /** m/s: the approach speed asked for at the surface of a noodle's SDF. */
  creep = SETTINGS.creep
  /** 1/s: how much faster per metre outside it. */
  attraction = SETTINGS.attraction
  /** m/s: the fastest approach asked for. */
  approachSpeed = SETTINGS.approachSpeed
  /** 1/s: how fast the speed toward the SDF follows that target. */
  response = SETTINGS.response
  /** g: the most the pull accelerates toward the SDF. */
  maxPull = SETTINGS.maxPull
  /** g: the most it brakes an approach faster than the target. */
  maxBrake = SETTINGS.maxBrake
  /** m: the band outside the SDF over which the pull fades in; inside, nothing pulls. */
  edge = SETTINGS.edge
  /** × the home ball's distance; 0 pulls to the field alone. */
  homing = SETTINGS.homing
  /** × homing toward the ends, eased in like the tail pull: below 1 the ends wrap the body instead of trailing out. */
  tailHoming = SETTINGS.tailHoming
  /** 0…1: far from home, how much the direction to it slides round the body instead of through it. */
  glide = SETTINGS.glide
  /** × gravity: the lift against it while a noodle travels toward its home near the body. */
  lift = SETTINGS.lift
  /** × that lift inside the field. */
  liftInside = SETTINGS.liftInside
  /** m from home past which a noodle counts as travelling (lift fades in over 1–2 ×). */
  hangDistance = SETTINGS.hangDistance
  /** × the pull's upward part far from the body: far noodles slither and lunge rather than fly. */
  farLift = SETTINGS.farLift
  /** m outside the field that counts as near it, fading out by 2 ×: for the lift, the upward pull and the glide. */
  liftReach = SETTINGS.liftReach
  /** m: how far the boiling noise moves the field's surface. */
  noiseAmplitude = SETTINGS.noiseAmplitude
  /** 1/m: the noise's spatial frequency. */
  noiseFrequency = SETTINGS.noiseFrequency
  /** Hz: how fast the noise boils. */
  noiseSpeed = SETTINGS.noiseSpeed
  /** × noiseSpeed per axis, so the noise never repeats in step. */
  noiseDrift = new THREE.Vector3(...VECTOR_SETTINGS.noiseDrift)
  /** g: a lurch's acceleration. */
  lurchAmplitude = SETTINGS.lurchAmplitude
  /** Hz: how often a noodle's lurch direction changes. */
  lurchFrequency = SETTINGS.lurchFrequency
  /** 0…0.5: the burst threshold; a noodle lurches for acos(1 − 2 · lurchBursts) / π of each burst cycle. */
  lurchBursts = SETTINGS.lurchBursts
  /** Hz: burst cycles per second. */
  burstFrequency = SETTINGS.burstFrequency
  /** × the lurch at the end farther from the held point (1 at it). */
  lurchTail = SETTINGS.lurchTail
  /** × the lurch while the gate is 0, so loose noodles keep squirming. */
  looseKick = SETTINGS.looseKick
  /** 0…1: how much the lurch scales with a noodle's weight; 0 lurches every noodle alike. */
  lurchWeight = SETTINGS.lurchWeight
  /** 1/s: damps the outward speed along the normal near the surface, × the gate; 0 leaves it free. */
  conform = SETTINGS.conform
  /** g: turns held segments standing out of the surface back onto it, × the gate; 0 leaves them free. */
  flatten = SETTINGS.flatten
  /** 0…1: the share of `flatten` a segment hanging straight down is spared, so tails still dangle. */
  flattenHang = SETTINGS.flattenHang
  /**
   * g: turns each held segment toward gravity, × the gate, × each particle's nearness to the surface. Balanced in
   * pairs, so strands hang without the noodle sinking; 0 leaves them free.
   */
  hang = SETTINGS.hang
  /** The band of a segment's up component over which hang fades in above a noodle's hangLevel. */
  levelBand = SETTINGS.levelBand
  /** m from the field's bounding-sphere centre, along leashAxes, past which the leash pulls back. */
  leashDistance = SETTINGS.leashDistance
  /** m: the band over which the leash fades in. */
  leashBand = SETTINGS.leashBand
  /** g: the leash's pull, whatever the gate. */
  leashPull = SETTINGS.leashPull
  /** Per-axis weights of the offset the leash measures: (1, 0, 1) horizontal. */
  leashAxes = new THREE.Vector3(...VECTOR_SETTINGS.leashAxes)
  /** World space: the point rising noodles are drawn to instead of their home. */
  summit = new THREE.Vector3(...VECTOR_SETTINGS.summit)
  /** m/s: the fastest a rising noodle is asked to climb. */
  riseSpeed = SETTINGS.riseSpeed
  /** m outside the field a rising noodle still clings, carried weightless (fading out by 2 ×); farther, it falls. */
  riseReach = SETTINGS.riseReach
  /** g: the most all of it together accelerates a particle. */
  maxAcceleration = SETTINGS.maxAcceleration

  /** s of simulated time, advanced by update(); set it to restart the noise and lurches. */
  time = 0

  // ---- Per noodle (edit, then syncNoodles()) ----

  /** Home capsules (start, end, radius) or spheres (center, radius), world space, read by update(). */
  anchors
  /** Int32Array: anchor index per noodle; -1 = the field alone. */
  anchorOf
  /** Float32Array: t along the anchor, start (0) → end (1). */
  anchorAt
  /** Float32Array: the home ball's radius over the anchor's. */
  slack
  /** Float32Array: × every drive of the noodle (pull, lift, lurch). */
  weight
  /** Float32Array: the pull share left at the end farther from the held point. */
  tail
  /** Float32Array: distance from the held point (0) to the farther end (1) where the pull starts fading to `tail`. */
  tailStart
  /** Uint8Array: 1 = the tail end leads. */
  reversed
  /** Float32Array: × hang. */
  hangShare
  /** Float32Array: × flatten. */
  flattenShare
  /** Float32Array: where the noodle is held, 0 leading end … 1 trailing end; 0.5 drapes it from its middle. */
  grip
  /** Float32Array: the up component (−1…1) past which hang turns a segment; −1 every one, 0 only rising ones. */
  hangLevel

  /** Names the pass, its buffer and its uniforms; unique per pass. */
  name

  #noodles
  #field
  #count
  #gate
  #rise
  #capacity
  #now
  #last
  #slots
  #data
  #uniforms
  #compute
  #renderer = null
  #warned = []
  #disposed = false

  /**
   * @param {THREE.Mesh} noodles - A NoodleSimulation.
   * @param {object} field - sample(positionNode, alphaNode) → { distance, normal, velocity }, and boundingSphere.
   * @param {object} [options] - anchors, the per-noodle arrays, gate, rise, name, and any setting.
   */
  constructor(noodles, field, options = {}) {
    if (options === null || typeof options !== 'object') throw new Error('FieldAttractor: options must be an object.')
    for (const key of Object.keys(options)) {
      if (!OPTION_KEYS.includes(key)) console.warn(`FieldAttractor: unknown option "${key}" ignored.`)
    }
    const nodes = noodles?.nodes
    if (!nodes?.buffers?.positions || !nodes.buffers.velocities || !nodes.buffers.stepState || !nodes.uniforms?.h) {
      throw new Error('FieldAttractor: noodles must be a NoodleSimulation (its `nodes` buffers and uniforms).')
    }
    if (!(noodles.particlesPerNoodle >= 2) || !Number.isInteger(noodles.count) || noodles.count < 1) {
      throw new Error('FieldAttractor: noodles needs particlesPerNoodle ≥ 2 and a noodle count.')
    }
    if (typeof field?.sample !== 'function' || !field.boundingSphere?.isSphere) {
      throw new Error('FieldAttractor: field needs sample(position, alpha) and a boundingSphere.')
    }
    if (options.gate !== undefined && typeof options.gate !== 'function') {
      throw new Error('FieldAttractor: gate must be a function (noodleIndexNode) => float node.')
    }
    if (options.rise !== undefined && typeof options.rise !== 'function') {
      throw new Error('FieldAttractor: rise must be a function (noodleIndexNode, anchorIndexNode) => float node.')
    }
    this.#noodles = noodles
    this.#field = field
    const count = (this.#count = noodles.count)
    this.#gate = options.gate ?? null
    this.#rise = options.rise ?? null
    this.name = options.name ?? 'fieldAttractor'

    this.anchors = options.anchors ?? []
    if (!Array.isArray(this.anchors)) throw new Error('FieldAttractor: anchors must be an array.')
    this.anchors.forEach(checkAnchor)
    for (const [key, { type, value }] of Object.entries(ARRAYS)) {
      const given = options[key]
      if (given !== undefined && given?.length !== count) {
        throw new Error(`FieldAttractor: ${key} must hold one value per noodle (${count}), not ${given?.length}.`)
      }
      this[key] = given ?? new type(count).fill(value)
    }
    for (const key of Object.keys(SETTINGS)) if (options[key] !== undefined) this[key] = options[key]
    for (const key of Object.keys(VECTOR_SETTINGS)) {
      if (options[key] === undefined) continue
      if (options[key]?.isVector3) this[key].copy(options[key])
      else console.warn(`FieldAttractor: ${key} must be a THREE.Vector3; kept (${VECTOR_SETTINGS[key].join(', ')}).`)
    }

    // Anchors: 4 vec4 each, start (xyz, r) and end now, then at the last update.
    const capacity = (this.#capacity = this.anchors.length)
    this.#now = new Float64Array(8 * capacity)
    this.#last = new Float64Array(8 * capacity)
    this.#slots = Array.from({ length: 4 * Math.max(capacity, 1) }, () => new THREE.Vector4())
    const name = this.name
    const settings = {}
    for (const key of Object.keys(SETTINGS)) settings[key] = uniform(0).setName(`${name}_${key}`)
    this.#uniforms = {
      ...settings,
      leashAxes: uniform(new THREE.Vector3()).setName(`${name}_leashAxes`),
      noiseDrift: uniform(new THREE.Vector3()).setName(`${name}_noiseDrift`),
      summit: uniform(new THREE.Vector3()).setName(`${name}_summit`),
      time: uniform(0).setName(`${name}_time`),
      center: uniform(new THREE.Vector3()).setName(`${name}_center`),
      localToWorld: uniform(new THREE.Matrix4()).setName(`${name}_localToWorld`),
      worldToLocal: uniform(new THREE.Matrix4()).setName(`${name}_worldToLocal`),
      // An 'object' group of its own: uploaded after a change (#sync()), not at every dispatch.
      anchors: uniformArray(this.#slots, 'vec4').setName(`${name}_anchors`).setGroup(uniformGroup('object')),
    }
    // Per noodle, 3 vec4: (anchor, t, slack, weight), (tail, reversed, phase, tailStart),
    // (hangShare, flattenShare, grip, hangLevel).
    this.#data = instancedArray(new Float32Array(12 * count), 'vec4').setName(`${name}_data`)
    this.syncNoodles()
    this.#compute = this.#createPass()
    this.snap()
  }

  /** The pass: one thread per particle, for the noodles' extraPasses.substep. */
  get computeNode() {
    return this.#compute
  }

  get noodles() {
    return this.#noodles
  }

  get field() {
    return this.#field
  }

  /** Once a frame, after field.update(), before noodles.update(): advances time, reads the anchors, syncs settings. */
  update() {
    if (this.#disposed) return this
    const info = this.#noodles.info
    const step = (info?.substeps ?? 0) * (info?.coupling?.h ?? 0)
    if (Number.isFinite(step) && step > 0) this.time += step
    this.#last.set(this.#now)
    this.#readAnchors()
    this.#sync()
    return this
  }

  /** Takes the anchors' current pose as their last one too: after a rebuild or any jump. */
  snap() {
    if (this.#disposed) return this
    this.#readAnchors()
    this.#last.set(this.#now)
    this.#sync()
    return this
  }

  /** Uploads the per-noodle arrays after they were edited in place. */
  syncNoodles() {
    const count = this.#count
    for (const key of Object.keys(ARRAYS)) {
      if (this[key]?.length !== count) {
        throw new Error(`FieldAttractor: ${key} must hold one value per noodle (${count}), not ${this[key]?.length}.`)
      }
    }
    const array = this.#data.value.array
    let outOfRange = 0
    for (let m = 0; m < count; m++) {
      let anchor = Math.trunc(this.anchorOf[m])
      if (!(anchor >= -1 && anchor < this.#capacity)) {
        outOfRange++
        anchor = -1
      }
      const o = 12 * m
      array[o] = anchor
      array[o + 1] = finite(this.anchorAt[m], 0.5)
      array[o + 2] = Math.max(finite(this.slack[m], 1), 0)
      array[o + 3] = Math.max(finite(this.weight[m], 1), 0)
      array[o + 4] = finite(this.tail[m], 1)
      array[o + 5] = this.reversed[m] ? 1 : 0
      array[o + 6] = phaseOf(m)
      array[o + 7] = Math.min(Math.max(finite(this.tailStart[m], 0.35), 0), 0.999)
      array[o + 8] = Math.max(finite(this.hangShare[m], 1), 0)
      array[o + 9] = Math.max(finite(this.flattenShare[m], 1), 0)
      array[o + 10] = Math.min(Math.max(finite(this.grip[m], 0), 0), 1)
      array[o + 11] = Math.min(Math.max(finite(this.hangLevel[m], -1), -1), 1)
    }
    if (outOfRange > 0) {
      console.warn(`FieldAttractor: ${outOfRange} anchorOf value(s) outside -1…${this.#capacity - 1}; no home.`)
    }
    this.#data.value.needsUpdate = true
    return this
  }

  /** Frees the pass and its buffer; take the pass out of the noodles' extraPasses first. */
  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    try {
      this.#compute.dispose()
    } catch {
      // Never compiled.
    }
    const renderer = this.#renderer
    if (renderer === null) return
    const { backend, info, _attributes: attributes } = renderer
    const attribute = this.#data.value
    if (!backend.has(attribute) || !backend.get(attribute).buffer) return
    if (!attributes?.delete(attribute)) {
      backend.destroyAttribute(attribute)
      info.destroyAttribute(attribute)
    }
  }

  // ---- Internals ----

  #readAnchors() {
    const anchors = this.anchors
    if (anchors.length !== this.#capacity) {
      this.#warnOnce(
        'anchors',
        `FieldAttractor: anchors changed from ${this.#capacity} to ${anchors.length}; reading the first ones.`,
      )
    }
    const now = this.#now
    for (let i = 0, n = Math.min(anchors.length, this.#capacity); i < n; i++) {
      const anchor = anchors[i]
      const start = anchor.start ?? anchor.center
      const end = anchor.end ?? anchor.center
      const radius = Math.max(finite(anchor.radius, 0), 0)
      start.toArray(now, 8 * i)
      now[8 * i + 3] = radius
      end.toArray(now, 8 * i + 4)
      now[8 * i + 7] = radius
    }
  }

  #sync() {
    const u = this.#uniforms
    for (const [key, fallback] of Object.entries(SETTINGS)) {
      let value = this[key]
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        this.#warnOnce(key, `FieldAttractor: ${key} = ${String(value)} is not a finite number; using ${fallback}.`)
        value = fallback
      }
      u[key].value = BANDS.includes(key) ? Math.max(value, 1e-6) : value
    }
    u.lurchBursts.value = Math.min(Math.max(u.lurchBursts.value, 1e-6), 0.5)
    for (const [key, fallback] of Object.entries(VECTOR_SETTINGS)) {
      const value = this[key]
      if (value?.isVector3 && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)) {
        u[key].value.copy(value)
      } else {
        this.#warnOnce(key, `FieldAttractor: ${key} is not a finite Vector3; using (${fallback.join(', ')}).`)
        u[key].value.fromArray(fallback)
      }
    }
    u.time.value = this.time
    u.center.value.copy(this.#field.boundingSphere.center)
    const noodles = this.#noodles
    noodles.updateWorldMatrix(true, false)
    u.localToWorld.value.copy(noodles.matrixWorld)
    u.worldToLocal.value.copy(_matrix.copy(noodles.matrixWorld).invert())
    const now = this.#now
    const last = this.#last
    const slots = this.#slots
    let changed = false
    for (let i = 0; i < this.#capacity; i++) {
      if (setChanged(slots[4 * i], now, 8 * i)) changed = true
      if (setChanged(slots[4 * i + 1], now, 8 * i + 4)) changed = true
      if (setChanged(slots[4 * i + 2], last, 8 * i)) changed = true
      if (setChanged(slots[4 * i + 3], last, 8 * i + 4)) changed = true
    }
    if (changed) {
      // Its buffer refreshed from the array (unbuilt, it has none yet) and its group bumped: every binding uploads
      // it once, at its next use.
      if (u.anchors.value) u.anchors.updateBuffer()
      u.anchors.groupNode.needsUpdate = true
    }
  }

  #warnOnce(key, message) {
    if (this.#warned.includes(key)) return
    this.#warned.push(key)
    console.warn(message)
  }

  #createPass() {
    const { buffers: b, uniforms: nu } = this.#noodles.nodes
    const P = this.#noodles.particlesPerNoodle
    const count = this.#count
    const u = this.#uniforms
    const data = this.#data
    const field = this.#field
    const gateOf = this.#gate ?? (() => float(1))
    const riseOf = this.#rise ?? (() => float(0))

    const pass = Fn(() => {
      const i = instanceIndex
      const position = b.positions.element(i).toVar()
      // Pinned and grabbed particles have no live inverse mass.
      If(position.w.greaterThan(0), () => {
        const m = i.div(uint(P)).toVar()
        const k = i.mod(uint(P))
        const state = b.velocities.element(i).toVar()
        const home = data.element(m.mul(3)).toVar()
        const shape = data.element(m.mul(3).add(1)).toVar()
        const shares = data.element(m.mul(3).add(2)).toVar()
        const weight = home.w
        const phase = shape.z
        const step = float(b.stepState.element(uint(0))).toVar()
        const alpha = step.div(float(nu.substeps)).toVar()
        const time = max(u.time.add(nu.h.mul(step)), 0).toVar()

        // World space: position, velocity, gravity; the offset from the field's centre, which the noise moves with.
        const toWorld = u.localToWorld
        const x = toWorld.mul(vec4(position.xyz, 1)).xyz.toVar()
        const v = toWorld.mul(vec4(state.xyz, 0)).xyz.toVar()
        const gravity = toWorld.mul(vec4(nu.gravity, 0)).xyz.toVar()
        const g = length(gravity).toVar()
        const up = gravity.div(max(g, 1e-9)).negate().toVar()
        const offset = x.sub(u.center).toVar()

        const gate = clamp(float(gateOf(m)), 0, 1).toVar()
        const reversedNoodle = shape.y.greaterThan(0.5)
        const along = float(k).div(P - 1)
        const lead = select(reversedNoodle, float(1).sub(along), along)
        // Distance from the held point along the noodle, over the longer side.
        const grip = shares.z
        const fromGrip = abs(lead.sub(grip))
          .div(max(max(grip, float(1).sub(grip)), 1e-6))
          .toVar()
        const trailing = smoothstep(shape.w, 1, fromGrip).toVar()
        const lambda = mix(float(1), shape.x, trailing).toVar()

        // The field, its surface boiling.
        const f = field.sample(x, alpha)
        const d = float(f.distance).toVar()
        const n = vec3(f.normal).toVar()
        const bodyVelocity = vec3(f.velocity).toVar()
        const wave = offset.mul(u.noiseFrequency)
        const drift = u.noiseDrift.mul(time.mul(u.noiseSpeed).mul(TAU))
        const boil = sin(wave.x.add(drift.x))
          .mul(sin(wave.y.add(drift.y).add(phase.mul(TAU))))
          .mul(sin(wave.z.add(drift.z)))
        const dn = d.add(u.noiseAmplitude.mul(boil)).toVar()

        // The noodle's own SDF: the field intersected with a ball round its home, which slides and shrinks to the
        // summit while the noodle rises.
        const D = dn.toVar()
        const e = n.negate().toVar()
        const anchor = int(home.x).toVar()
        const rising = clamp(float(riseOf(m, anchor)), 0, 1).toVar()
        const homed = anchor.greaterThanEqual(0).toVar()
        If(homed.or(rising.greaterThan(0)), () => {
          const point = vec3(u.summit).toVar()
          const radius = float(0).toVar()
          If(homed, () => {
            const j = uint(anchor).mul(4)
            const a = mix(u.anchors.element(j.add(2)).xyz, u.anchors.element(j).xyz, alpha)
            const bEnd = mix(u.anchors.element(j.add(3)).xyz, u.anchors.element(j.add(1)).xyz, alpha)
            point.assign(mix(mix(a, bEnd, home.y), u.summit, rising))
            radius.assign(u.anchors.element(j).w.mul(home.z).mul(float(1).sub(rising)))
          })
          const toHome = point.sub(x).toVar()
          const rho = length(toHome).toVar()
          // without a home, the summit's pull fades in with the rise
          const homing = u.homing.mul(mix(float(1), u.tailHoming, trailing)).mul(select(homed, float(1), rising))
          const homeDistance = homing.mul(rho.sub(radius)).toVar()
          If(homeDistance.greaterThan(dn), () => {
            // Far from home, slide round the body instead of through it; outside, close in on its surface.
            const straight = toHome.div(max(rho, 1e-9)).toVar()
            const slide = straight.sub(n.mul(min(dot(straight, n), 0))).toVar()
            const glide = u.glide.mul(smoothstep(0, u.liftReach, homeDistance))
            const seek = smoothstep(0, u.liftReach, dn)
            const aim = mix(straight, slide.div(max(length(slide), 1e-6)), glide)
              .sub(n.mul(seek))
              .toVar()
            const direction = aim.div(max(length(aim), 1e-9))
            D.assign(homeDistance)
            e.assign(direction)
          })
        })

        // 1. Pull: an approach speed that grows with the distance outside, relative to the body.
        const target = min(u.creep.add(u.attraction.mul(max(D, 0))), mix(u.approachSpeed, u.riseSpeed, rising))
        const approach = dot(v.sub(bodyVelocity), e)
        const acceleration = clamp(u.response.mul(target.sub(approach)), u.maxBrake.mul(g).negate(), u.maxPull.mul(g))
        const drive = u.amplitude.mul(gate).mul(weight).toVar()
        const pull = e
          .mul(
            acceleration
              .mul(drive)
              .mul(lambda)
              .mul(smoothstep(0, u.edge, D)),
          )
          .toVar()
        const near = float(1)
          .sub(smoothstep(u.liftReach, u.liftReach.mul(2), d))
          .toVar()
        const rise = dot(pull, up).toVar()
        If(rise.greaterThan(0), () => {
          pull.subAssign(up.mul(rise.mul(float(1).sub(mix(u.farLift, 1, near)))))
        })

        // 2. Travel lift: weightless while travelling home near the body; tails keep their weight. A rising noodle is
        // carried exactly weightless within riseReach, so the capped pull alone moves it; knocked off, it falls.
        const outside = mix(u.liftInside, 1, smoothstep(u.edge.negate(), u.edge, d))
        const travel = u.lift.mul(drive).mul(smoothstep(u.hangDistance, u.hangDistance.mul(2), D))
        const cling = float(1).sub(smoothstep(u.riseReach, u.riseReach.mul(2), d))
        const carry = mix(travel, u.amplitude.mul(gate).mul(cling), rising)
        const lift = up.mul(g.mul(carry).mul(lambda.mul(lambda)).mul(near).mul(outside))

        // 3. Lurch: a smooth random direction per noodle, in bursts.
        const T = time.mul(u.lurchFrequency).add(phase).toVar()
        const key = uint(floor(T))
          .mul(uint(3 * count))
          .add(m.mul(3))
          .toVar()
        const next = key.add(uint(3 * count))
        const corner = (s) => vec3(hash(s), hash(s.add(1)), hash(s.add(2)))
        const random = mix(corner(key), corner(next), smoothstep(0, 1, fract(T)))
          .mul(2)
          .sub(1)
          .toVar()
        const zeta = random.div(max(length(random), 1e-6))
        const burst = smoothstep(
          float(1).sub(u.lurchBursts.mul(2)),
          1,
          sin(time.mul(u.burstFrequency).add(phase).mul(TAU)),
        )
        const share = gate.add(u.looseKick.mul(float(1).sub(gate)))
        const lurch = zeta.mul(
          u.lurchAmplitude
            .mul(g)
            .mul(burst)
            .mul(mix(float(1), u.lurchTail, fromGrip))
            .mul(mix(float(1), weight, u.lurchWeight))
            .mul(share),
        )

        // 4. Leash: back toward the field, whatever the gate.
        const away = offset.mul(u.leashAxes).toVar()
        const reach = length(away).toVar()
        const leash = away
          .div(max(reach, 1e-9))
          .mul(u.leashPull.mul(g).mul(smoothstep(u.leashDistance, u.leashDistance.add(u.leashBand), reach)))
          .negate()

        // 5. Flatten: a segment (from its neighbour toward the held point) standing out of the surface is turned back
        // onto it, across the segment, × the sine of its angle out of the tangent plane. Hanging segments are spared.
        // Indices from the leading end: this particle's (ku) and the held one's (kg).
        const ku = select(reversedNoodle, uint(P - 1).sub(k), k).toVar()
        const kg = uint(clamp(floor(grip.mul(P - 1).add(0.5)), 0, P - 1)).toVar()
        const first = m.mul(uint(P)).toVar()
        const particle = (u) => first.add(select(reversedNoodle, uint(P - 1).sub(u), u))
        const leading = ku.equal(kg)
        const neighbour = select(leading, i, particle(select(ku.greaterThan(kg), ku.sub(1), ku.add(1))))
        const leader = toWorld.mul(vec4(b.positions.element(neighbour).xyz, 1)).xyz
        const segment = x.sub(leader).toVar()
        const direction = segment.div(max(length(segment), 1e-9)).toVar()
        const standing = max(dot(direction, n), 0).toVar()
        const across = n.sub(direction.mul(standing)).toVar()
        const hanging = max(dot(direction, up).negate(), 0)
        const band = smoothstep(u.liftReach.negate(), 0, d).mul(near).toVar()
        const flat = across.mul(
          u.flatten
            .mul(g)
            .mul(standing)
            .mul(float(1).sub(u.flattenHang.mul(hanging)))
            .mul(gate)
            .mul(shares.y)
            .mul(band)
            .mul(select(leading, float(0), float(1)))
            .div(max(length(across), 0.05))
            .negate(),
        )

        // 6. Hang: each segment turned toward gravity as a pair, its outer particle pushed down across it and the
        // inner one up. A particle takes its own segment's push and the reaction of the next one out (at the held
        // point, of both neighbours). Above hangLevel −1, only a segment rising past hangLevel is turned.
        const hang = vec3(0).toVar()
        const hangDrive = u.hang.mul(g).mul(gate).mul(shares.x).mul(near).toVar()
        If(hangDrive.greaterThan(0), () => {
          const down = up.negate()
          const level = shares.w
          const rising = (segment) =>
            select(level.lessThanEqual(-1), float(1), smoothstep(level, level.add(u.levelBand), dot(segment, up)))
          const reactionOf = (j) => {
            const behind = toWorld.mul(vec4(b.positions.element(j).xyz, 1)).xyz.sub(x)
            const next = behind.div(max(length(behind), 1e-9))
            return down.sub(next.mul(dot(next, down))).mul(rising(next))
          }
          const outward = ku.greaterThanEqual(kg)
          const last = select(outward, ku.equal(uint(P - 1)), ku.equal(uint(0)))
          const follower = select(last, i, particle(select(outward, ku.add(1), ku.sub(1))))
          const reaction = reactionOf(follower)
            .mul(select(last, float(0), float(1)))
            .toVar()
          If(leading.and(kg.greaterThan(uint(0))), () => {
            reaction.addAssign(reactionOf(particle(ku.sub(1))))
          })
          const own = down
            .sub(direction.mul(dot(direction, down)))
            .mul(rising(direction))
            .mul(select(leading, float(0), float(1)))
          hang.assign(own.sub(reaction).mul(hangDrive))
        })

        const change = pull.add(lift).add(lurch).add(leash).add(flat).add(hang).toVar()
        change.mulAssign(min(float(1), u.maxAcceleration.mul(g).div(max(length(change), 1e-9))))

        // 7. Conform: damp the outward speed along the normal near the surface, relative to the body.
        const outward = max(dot(v.sub(bodyVelocity), n), 0)
        const conform = n.mul(
          outward
            .mul(min(u.conform.mul(nu.h), 1))
            .mul(gate)
            .mul(band),
        )

        const kick = change.mul(nu.h).sub(conform)
        const velocity = state.xyz.add(u.worldToLocal.mul(vec4(kick, 0)).xyz).toVar()
        velocity.mulAssign(min(float(1), nu.maxSpeed.div(max(length(velocity), 1e-9))))
        b.velocities.element(i).assign(vec4(velocity, state.w))
      })
    })()
      .compute(this.#noodles.particleCount)
      .setName(this.name)
    pass.onInit(({ renderer }) => {
      this.#renderer ??= renderer
    })
    return pass
  }
}

function checkAnchor(anchor, index) {
  const capsule = anchor?.start?.isVector3 && anchor.end?.isVector3
  const sphere = anchor?.center?.isVector3
  if ((!capsule && !sphere) || typeof anchor.radius !== 'number') {
    throw new Error(`FieldAttractor: anchors[${index}] must be a Capsule (start, end, radius) or a Sphere.`)
  }
}

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback
}

// A noodle's phase in [0, 1), from its index.
function phaseOf(index) {
  let a = (index + 0x9e3779b9) >>> 0
  a = Math.imul(a ^ (a >>> 16), 0x21f0aaad)
  a = Math.imul(a ^ (a >>> 15), 0x735a2d97)
  return ((a ^ (a >>> 15)) >>> 0) / 4294967296
}

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
