import * as THREE from 'three/webgpu'
import {
  Fn,
  If,
  Loop,
  float,
  int,
  uint,
  vec2,
  vec3,
  vec4,
  ivec3,
  uniform,
  uniformArray,
  uniformGroup,
  instancedArray,
  storage,
  instanceIndex,
  invocationLocalIndex,
  attribute,
  positionLocal,
  normalGeometry,
  normalLocal,
  tangentLocal,
  positionPrevious,
  length,
  normalize,
  cross,
  dot,
  floor,
  abs,
  min,
  max,
  mix,
  clamp,
  smoothstep,
  select,
  sqrt,
  inverseSqrt,
  sin,
  cos,
  floatBitsToUint,
  uintBitsToFloat,
  atomicAdd,
  atomicLoad,
  atomicMax,
  atomicMin,
  atomicOr,
  atomicStore,
  countTrailingZeros,
  workgroupArray,
  workgroupBarrier,
  localId,
  workgroupId,
} from 'three/tsl'

/**
 * NoodleSimulation — noodles, ropes and cables that don't pass through each other: inextensible strands that bend
 * like rods, buckle when they land on an end and keep the shape they settle in, collide as chains of capsules with
 * each other and with the world, simulated on the GPU and drawn as smooth tubes.
 *
 *   const curves = points.map((p) => new THREE.LineCurve3(p, p.clone().add(new THREE.Vector3(0, -3, 0))))
 *   const noodles = new NoodleSimulation(curves, material, { radius: 0.05, particlesPerNoodle: 32 })
 *   noodles.bendingCompliance = 0.5                  // stiffer
 *   noodles.bendingPlasticity = 0                    // ropes and cables spring back
 *   noodles.colliders.push(new THREE.Sphere(center, 0.5), new Capsule(start, end, 0.1)) // move them in place
 *   scene.add(noodles)
 *   scene.add(new NoodleSimulationHelper(noodles))   // optional: the capsules, as the solver sees them
 *   await noodles.compileAsync(renderer)             // optional: the first update, grab or reset() doesn't hitch
 *
 *   const timer = new THREE.Timer()
 *   renderer.setAnimationLoop((time) => {
 *     timer.update(time)
 *     noodles.update(renderer, timer.getDelta())     // pass 0 while paused
 *     renderer.render(scene, camera)
 *   })
 *
 *   const hit = await noodles.pickAsync(raycaster)   // { distance, point, position, particle, noodle }
 *   noodles.startGrab(hit.particle).moveGrab(hit.position); noodles.moveGrab(target); noodles.endGrab()
 *
 * Each curve (any THREE.Curve) is one noodle's rest shape and starting pose in the object's space, sampled into
 * `particlesPerNoodle` evenly spaced particles; `options.pinned` holds particles at their rest pose. The simulation
 * runs in the object's space, and one draw renders every noodle as `count` instances of one tube. The material is
 * cloned with its positionNode replaced, so any material works, normal maps, shadows and motion vectors included.
 * `uv` runs along the noodle (x) and around it (y), as in TubeGeometry; `instanceIndex` is the noodle. Needs a
 * WebGPURenderer on the WebGPU backend.
 *
 * Each segment between two neighbouring particles is a capsule of the noodle's radius. Per substep (1/60 s /
 * numSubsteps), passes that each write only their own particle, segment or noodle and read what earlier ones wrote:
 *   1. integrate   gravity; clears the segment hash
 *   2. hash        each segment by its middle where the substep started
 *   3. noodles     one workgroup per noodle, in workgroup memory: drag, the grab, XPBD bending (Gauss-Seidel in three
 *                  colours, with plastic flow), then every stretch constraint at once (tridiagonal), softer in
 *                  compression so noodles buckle
 *   4. contacts    32 threads per segment (one with contactLanes off): capsules of other noodles and of far parts of
 *                  the same one, mass-split, with Coulomb friction, parting at most at separationSpeed; and the
 *                  distance to the nearest other segment where the substep started
 *   5. coupling    partners' pushes
 *   6. velocity    the contact pushes; ground and Plane / Sphere / Box3 / Capsule colliders; each particle's step
 *                  bounded by a share of that distance, so centerlines never cross; speed clamp, NaN recovery
 * Per frame: colliderCulling's per-noodle collider lists before the substeps; after them, the particle hash partners
 * read and a twist-free frame carried along each noodle.
 *
 * References:
 * - Macklin, Müller, Chentanez, "XPBD: Position-Based Simulation of Compliant Constrained Dynamics" (2016)
 * - Macklin, Müller, Chentanez, Kim, "Unified Particle Physics for Real-Time Applications" (2014)
 * - Han, Harada, "Tridiagonal Matrix Formulation for Inextensible Hair Strand Simulation" (2013)
 * - Deul, Kugelstadt, Weiler, Bender, "Direct Position-Based Solver for Stiff Rods" (2018)
 * - Kelager, Niebe, Erleben, "A Triangle Bending Constraint Model for Position-Based Dynamics" (2010)
 * - Wu, Wu, Yang, Wang, "A Safe and Fast Repulsion Method for GPU-based Cloth Self Collisions" (2020), the
 *   per-particle step bound
 * - Chen, Hsu, Liu, Macklin, Yang, Yuksel, "Offset Geometric Contact" (2025), its share of 0.45
 * - Bridson, Fedkiw, Anderson, "Robust Treatment of Collisions, Contact and Friction for Cloth Animation" (2002)
 * - Tonge, Benevolenski, Voroshilov, "Mass Splitting for Jitter-Free Parallel Rigid Body Simulation" (2012)
 * - NVIDIA PhysX: maxDepenetrationVelocity, the cap on how fast overlap is pushed apart
 * - Ericson, "Real-Time Collision Detection" (2005), closest points of two segments
 * - SideFX, Houdini Vellum: edge collisions, plasticity, drag across and along hair, compression stiffness
 * - Duff, Burgess, Christensen, Hery, Kensler, Liani, Villemin, "Building an Orthonormal Basis, Revisited" (2017)
 * - Bergou, Wardetzky, Robinson, Audoly, Grinspun, "Discrete Elastic Rods" (2008), the curvature 2 tan(θ/2) and
 *   parallel transport
 */

const OPTION_KEYS = [
  'radius',
  'particlesPerNoodle',
  'radialSegments',
  'lengthSegments',
  'capSegments',
  'colliders',
  'pinned',
  'segmentBucketSize',
  'bucketSize',
  'radiusProfile',
  'noodleHook',
  'contactLanes',
  'colliderCulling',
  'partnerHash',
]

// [min, max, integer]: validated on every update() (an invalid value keeps its last valid one).
const NUMBER_SETTINGS = {
  numSubsteps: [1, 64, true],
  bendingIterations: [1, 16, true],
  bendingPlasticity: [0, 1000],
  bendingPlasticityThreshold: [0, Math.PI],
  timeScale: [0, 16],
  maxDeltaTime: [0, 1],
  damping: [0, 1000],
  normalDamping: [0, 1000],
  maxSpeed: [0, Infinity],
  stretchingCompliance: [0, Infinity],
  compressionCompliance: [0, Infinity],
  bendingCompliance: [0, Infinity],
  bendingDamping: [0, Infinity],
  contactStiffness: [0, 1],
  separationSpeed: [0, Infinity],
  contactFriction: [0, Infinity],
  couplingInterval: [1, 64, true],
  groundFriction: [0, Infinity],
  groundRestitution: [0, 1],
  colliderFriction: [0, Infinity],
  colliderMargin: [0, 1e6],
  colliderCullingReach: [0, Infinity],
  grabStiffness: [0, 1],
}
const BOOLEAN_SETTINGS = ['selfCollision', 'strictCollisions', 'contactLanes', 'colliderCulling']

const MAX_COLLIDERS = 96
// colliderCulling's list per noodle: a bit per collider, in u32 words.
const MASK_WORDS = Math.ceil(MAX_COLLIDERS / 32)
// colliderCulling's reach, × the most a noodle's particles may approach a collider in a frame.
const CULL_SAFETY = 2
// Collider types, in the second vec4 of each collider.
const PLANE = 0
const SPHERE = 1
const BOX = 2
const CAPSULE = 3
// Particle hash bucket capacity by default: twice the most particles a cell holds, within these bounds.
const MIN_BUCKET = 16
const MAX_BUCKET = 64
// Dropped hash entries count up to this, short of 2³² by more than one dispatch adds past the check.
const MAX_DROPPED = 0xf0000000
// WebGPU's default maxStorageBufferBindingSize.
const MAX_BINDING_BYTES = 128 * 1024 * 1024
// Segments are searched this far apart (× radius, between their axes), touching included.
const CONTACT_REACH = 2.5
// contactLanes: threads per workgroup, and per segment. A segment's lanes stride the entries of its query cells and
// keep up to as many of its contacts, summed in the order the one-thread pass visits them (past that many, each lane's
// own sums in lane order).
const CONTACT_LANES = 32
const SEGMENT_LANES = 32
// contactLanes: the most pairs within the bounds a segment's lanes queue to take up together; past it a lane takes its
// own.
const QUEUE = 64
// Slack (× the coordinates' magnitude) contactLanes' distance bounds keep over float rounding.
const BOUND_EPSILON = 1e-4
// Share of its distance to the nearest other segment a particle may move per substep: two segments that both move
// less than half their distance can't meet.
const STEP_SHARE = 0.45
// The least a particle may move per substep (× radius), so noodles that start deep in each other separate.
const MIN_STEP = 0.05
// Densest packing of segments in a pile, for the segment bucket.
const PACKING = 0.6
// How firmly another noodle holds a particle up in the solves (1: like a collider).
const NOODLE_SUPPORT = 0.25
// A bend is measured as if the chord across its joint were at least this share of the spacing (a fold of 168°).
const MIN_CHORD = 0.2
// Threads per noodle in the noodles pass: one SIMD group on most GPUs for a noodle that fits in it, else two; and
// WebGPU's default workgroup memory (six vec4 per particle).
const NOODLE_WORKGROUP = 64
const NOODLE_SIMD = 32
const WORKGROUP_BYTES = 16384

const _vector = new THREE.Vector3()
const _tangent = new THREE.Vector3()
const _normal = new THREE.Vector3()
const _inverse = new THREE.Matrix4()
const _ray = new THREE.Ray()
const _identity = new THREE.Matrix4()

// What a NoodleSimulationHelper reads of its simulation.
const HELPER_DATA = new WeakMap()

// ======== TSL helpers ========

// NaN and ±Inf have an all-ones exponent; `x != x` can be folded away by WGSL compilers.
const isFiniteFloat = (x) => floatBitsToUint(x).bitAnd(uint(0x7f800000)).notEqual(uint(0x7f800000))
const isFinite3 = (v) => isFiniteFloat(v.x).and(isFiniteFloat(v.y)).and(isFiniteFloat(v.z))

// A unit vector perpendicular to the unit vector t, continuous except across t.z = 0 (Duff et al. 2017).
const perpendicular = (t) => {
  const sign = select(t.z.greaterThanEqual(0), float(1), float(-1)).toVar()
  const a = float(-1).div(sign.add(t.z)).toVar()
  return vec3(float(1).add(sign.mul(t.x).mul(t.x).mul(a)), sign.mul(t.x.mul(t.y).mul(a)), sign.negate().mul(t.x))
}

// murmur3's finalizer. An XOR of prime products alone sends sign-mirrored cells to one bucket.
const fmix32 = (h) => {
  const a = h
    .bitXor(h.shiftRight(uint(16)))
    .mul(uint(0x85ebca6b))
    .toVar()
  const b = a
    .bitXor(a.shiftRight(uint(13)))
    .mul(uint(0xc2b2ae35))
    .toVar()
  return b.bitXor(b.shiftRight(uint(16)))
}

const hashCell = (cell, size) =>
  fmix32(
    uint(cell.x)
      .mul(uint(73856093))
      .add(uint(cell.y).mul(uint(19349663)))
      .add(uint(cell.z).mul(uint(83492791))),
  ).bitAnd(uint(size - 1))

// The closest points of segments p0p1 and q0q1, as (s, t) along each (Ericson 2005, 5.1.9). Parallel segments meet
// at the middle of their overlap, so neither end is favoured.
const closestOnSegments = Fn(([p0, p1, q0, q1]) => {
  const d1 = p1.sub(p0).toVar()
  const d2 = q1.sub(q0).toVar()
  const r = p0.sub(q0).toVar()
  const a = max(dot(d1, d1), 1e-30).toVar()
  const e = max(dot(d2, d2), 1e-30).toVar()
  const b = dot(d1, d2).toVar()
  const c = dot(d1, r).toVar()
  const f = dot(d2, r).toVar()
  const denom = a.mul(e).sub(b.mul(b)).toVar()
  // Where q0 and q1 fall along p0p1.
  const s0 = c.negate().div(a).toVar()
  const s1 = b.sub(c).div(a).toVar()
  const middle = clamp(min(s0, s1), 0, 1)
    .add(clamp(max(s0, s1), 0, 1))
    .mul(0.5)
    .toVar()
  const s = middle.toVar()
  // Nearly parallel ones (under about 6°) blend toward the middle: their exact closest point jumps from end to end.
  const skew = denom.div(a.mul(e)).toVar()
  If(skew.greaterThan(1e-6), () => {
    const exact = clamp(b.mul(f).sub(c.mul(e)).div(denom), 0, 1)
    s.assign(mix(middle, exact, smoothstep(0, 0.01, skew)))
  })
  const t = b.mul(s).add(f).div(e).toVar()
  If(t.lessThan(0), () => {
    t.assign(0)
    s.assign(clamp(c.negate().div(a), 0, 1))
  }).ElseIf(t.greaterThan(1), () => {
    t.assign(1)
    s.assign(clamp(b.sub(c).div(a), 0, 1))
  })
  return vec2(s, t)
})

// A particle held up last substep doesn't give way into its support (normal xyz, strength w): the part of a
// correction `d` into it is dropped. massAlong(): its inverse mass along the unit vector `d`.
const unsupported = (d, support) => d.sub(support.xyz.mul(support.w.mul(min(dot(d, support.xyz), 0))))
const massAlong = (w, d, support) => {
  const into = min(dot(d, support.xyz), 0)
  return w.mul(float(1).sub(support.w.mul(into).mul(into)))
}

// Pushes `x` out by `depth` along `n` and moves `prev` by the overlap not made by this substep's `approach`, so a
// particle that started inside leaves without velocity; then removes the slide relative to the surface (moved by
// `motion`) up to `friction` × the normal push.
const resolveContact = (x, prev, n, depth, approach, motion, friction) => {
  const before = dot(x.sub(prev), n).toVar()
  const shift = max(depth.sub(approach), 0).toVar()
  x.addAssign(n.mul(depth))
  prev.addAssign(n.mul(shift))
  const relative = x.sub(prev).sub(motion).toVar()
  const tangential = relative.sub(n.mul(dot(relative, n))).toVar()
  const normalPush = max(depth, dot(x.sub(prev), n).sub(before))
  const slide = length(tangential)
  x.subAssign(tangential.mul(min(float(1), friction.mul(normalPush).div(max(slide, 1e-30)))))
}

// ======== The simulation ========

export class NoodleSimulation extends THREE.Mesh {
  isNoodleSimulation = true
  type = 'NoodleSimulation'

  // ---- Time ----

  /** Substeps per 1/60 s of simulated time. Their length is fixed, so the motion is the same at any frame rate. */
  numSubsteps = 15
  /** Simulated seconds per real second; 0 pauses. */
  timeScale = 1
  /** Most real time one update() steps (s), before timeScale; longer frames run in slow motion. */
  maxDeltaTime = 1 / 30

  // ---- Forces ----

  /** m/s², in the object's space. */
  gravity = new THREE.Vector3(0, -9.81, 0)
  /** Air drag along the noodle (1/s): the velocity along it decays as exp(−damping·t). */
  damping = 0.05
  /** Air drag across the noodle (1/s): a noodle falling broadside slows to g / normalDamping. */
  normalDamping = 0.5
  /** Speed clamp against blow-ups (units/s; 0: none). strictCollisions also bounds the speed. */
  maxSpeed = 50

  // ---- Material (XPBD) ----

  /** Stretch compliance per unit mass (s²/m²; 0 keeps every noodle its length), independent of the spacing. */
  stretchingCompliance = 0
  /**
   * Stretch compliance while a segment is shorter than its rest length: a noodle landing on an end gives way and
   * buckles; at 0 it stops whole, as a rod.
   */
  compressionCompliance = 0.00005
  /**
   * Bending compliance per unit mass (s²/m⁴, ρA / EI), independent of the spacing; higher is floppier. A noodle held
   * out level droops over about (1 / (9.81 · bendingCompliance))^⅓: 2 is soft cooked spaghetti, 0.08 a rod.
   */
  bendingCompliance = 2
  /** Damping of the bends' rate of change (β, Macklin et al. 2016): slows bending, not swaying or rolling. */
  bendingDamping = 20
  /** Bending sweeps per substep; too few leave stiff noodles softer than their compliance asks. */
  bendingIterations = 4
  /**
   * Plastic flow of the bends (1/s): past the threshold, a joint's rest bend creeps toward its bend, so a noodle keeps
   * the shape it settled in, as cooked pasta does. 0 always springs back, for ropes and cables; reset() restores it.
   */
  bendingPlasticity = 2
  /** Bend (radians per joint, beyond the rest one) a noodle springs back from before it flows. */
  bendingPlasticityThreshold = 0.05

  // ---- Contacts ----

  /** Noodles collide with each other and with themselves; segments of one noodle that overlap at rest never do. */
  selfCollision = true
  /**
   * Noodles never pass through each other: each particle moves, per substep, at most a share of its distance to the
   * nearest other segment, so no two centerlines cross. This caps the speed at 67.5 × maxRadius (radius × the
   * radiusProfile's peak) × numSubsteps units/s (update() warns when that is below maxSpeed).
   */
  strictCollisions = true
  /**
   * The contacts pass runs 32 threads per segment, striding the entries of the 27 cells it searches, and skips pairs
   * exact distance bounds rule out: several times faster in dense piles, with the same contacts, distances and pushes,
   * to the bit, as one thread per segment (off). Its pass is built the first time it is on.
   */
  contactLanes = true
  /** Share of a contact overlap resolved per substep. */
  contactStiffness = 1
  /**
   * Fastest that overlapping noodles push apart (units/s): deeper overlap clears over the next substeps, so noodles
   * pressed into each other part without flying off.
   */
  separationSpeed = 2
  /** Coulomb coefficient between noodles, and against coupled partners. */
  contactFriction = 0.6
  /** Substeps between passes against coupled partners (the last substep always runs one). */
  couplingInterval = 1

  // ---- Ground ----

  /** In the object's space, its normal pointing out of the ground; null for none. */
  ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  /** Coulomb coefficient against the ground. */
  groundFriction = 0.85
  /** Share of the normal speed an impact keeps (0 stops dead, 1 bounces back). */
  groundRestitution = 0

  // ---- Colliders ----

  /**
   * Read on every update(), in the object's space: THREE.Plane (keeps the noodles on its normal's side),
   * THREE.Sphere, THREE.Box3 and Capsule (three/addons/math/Capsule.js, or any { start, end, radius }), up to 96,
   * each swept over the substeps from its last pose; and partners to couple with (another NoodleSimulation, any
   * object with `couplingData`), which push the noodles out of their particles as of their last update, by half the
   * overlap: list each other for two-way coupling.
   */
  colliders = []
  /** Coulomb coefficient against the colliders. */
  colliderFriction = 0.6
  /** Added to every collider surface, object units. */
  colliderMargin = 0
  /**
   * Each noodle meets only the Plane / Sphere / Box3 / Capsule colliders it may reach this frame, from a per-noodle
   * list built before the substeps with a conservative reach, so the noodles step exactly as without it. Its passes
   * are built the first time it is on.
   */
  colliderCulling = false
  /**
   * Object units past colliderMargin a collider stays in a noodle's colliderCulling list, for passes of your own that
   * read colliders the noodle doesn't touch (forEachCollider()); Infinity lists every one.
   */
  colliderCullingReach = 0

  // ---- Grab ----

  /** 0…1: how firmly the grabbed particles follow the target (1: kinematically). */
  grabStiffness = 1

  // ---- Extension ----

  /**
   * Compute passes of your own, dispatched with the noodles' passes: `before`, once a frame before the substeps;
   * `substep`, every substep after the velocity pass; `after`, once a frame after the substeps. Arrays of compute
   * nodes, read on every update(), run only in frames that step; `nodes` gives the noodles' buffers.
   */
  extraPasses = { before: [], substep: [], after: [] }

  /**
   * Sizes, and the substeps the last update() ran (0 after reset(), so a FieldAttractor's next update() advances no
   * time); `coupling`: how it stepped (`members`: 1, substeps per 1/60 s, their length `h`, bending sweeps per
   * substep). readInfoAsync() fills in the hash entries dropped from full buckets since construction or reset(), and
   * the fullest bucket of each hash.
   */
  info = {
    noodles: 0,
    particles: 0,
    segments: 0,
    particlesPerNoodle: 0,
    pinned: 0,
    segmentSkip: 0,
    segmentCellSize: 0,
    segmentTableSize: 0,
    segmentBucketSize: 0,
    hashTableSize: 0,
    bucketSize: 0,
    substeps: 0,
    coupling: { members: 0, substeps: 0, h: 0, bendingIterations: 0 },
    droppedSegmentEntries: 0,
    fullestSegmentBucket: 0,
    droppedEntries: 0,
    fullestBucket: 0,
  }

  #source // constructor inputs, for clone()
  #materials = [] // the deformed clones this simulation owns
  #nodes // the tube's position nodes

  #M = 0 // noodles
  #P = 0 // particles per noodle
  #N = 0 // particles
  #S = 0 // segments
  #radius = 0
  #maxRadius = 0 // radius × the largest of radiusProfile: sizes the hashes and the step bound
  #profile = null // options.radiusProfile as a Float32Array, or null
  #noodleHook = null
  #rest // Float32Array, xyzw per particle: the starting pose, inverse mass in w
  #pinnedCount = 0
  #maxSpacing = 0 // the longest rest segment

  // The particle hash, for partners: built after every frame unless options.partnerHash is false.
  #partnerHash = true
  #tableSize = 0
  #bucket = 0
  #cellOf
  #hashOf
  // The segment hash, for the contacts.
  #segmentSkip = 1
  #segmentCell = 0
  #segmentTable = 0
  #segmentBucket = 0
  #segmentCellOf
  #segmentHashOf
  #sharedNoodles = false // the noodles pass runs in workgroup memory
  #noodleWorkgroup = NOODLE_WORKGROUP

  #storage = [] // every storage node this simulation owns
  #buffers
  #uniforms
  #passes = {}
  #frameLists = new Map()

  #renderer = null
  #live = false // a frame has run: the GPU holds the state
  #stepped = false // a substep or reset has run: every buffer read back is on the GPU
  #compiling = null // the compileAsync() in flight, which GPU frees wait for
  #queued = new Map() // pass → compileAsync() runs still to compile it; a frame that needs it waits
  #compiled = new WeakSet() // passes built, by a frame or a compile
  #ranLists = new WeakSet() // frame lists dispatched
  #statsEpoch = 0 // bumped by reset(): a statistics reading in flight is stale
  #disposed = false
  #warned = []
  #valid = {}
  #validGravity = new THREE.Vector3(0, -9.81, 0)
  #validGround = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  #groundEnabled = true

  #lastTime = -1
  // The fixed-substep clock (#advanceClock()): the substep count it runs at, and the simulated time not yet stepped.
  #clock = { key: 0, accumulator: 0 }
  #respawnPending = false
  #snapPending = false
  #framesCurrent = true
  #lastCopyCalls = -1

  #colliderStates = new WeakMap()
  #frameShapes = []
  #colliderSweep = 0 // the farthest a collider's surface moves this frame
  #capsuleColliders = false // a Capsule has been listed: the collider passes have its branch
  #partners = new Map()
  #couplingData

  #grab = {
    active: false,
    capture: false,
    hasTarget: false,
    particle: 0,
    target: new THREE.Vector3(),
    previousTarget: new THREE.Vector3(),
    // The first target since the catch, not yet stepped.
    leap: false,
    // A grab along a ray (grabPicked()): target and previousTarget are the ray's origins, these its directions.
    ray: false,
    direction: new THREE.Vector3(0, 0, -1),
    previousDirection: new THREE.Vector3(0, 0, -1),
  }
  // pick(): the next frame finds the nearest particle along this ray (object space).
  #pick = { pending: false, origin: new THREE.Vector3(), direction: new THREE.Vector3(), radius: 0, near: 0, far: 1e30 }

  /**
   * @param {THREE.Curve|THREE.Curve[]} curves - One per noodle: its rest shape and starting pose, object space.
   * @param {THREE.Material} [material] - Cloned. Defaults to a MeshStandardNodeMaterial.
   * @param {object} [options]
   * @param {number} [options.radius=0.05] - Of the tubes and of the capsules they collide as.
   * @param {number} [options.particlesPerNoodle] - Particles along each noodle; by default one per diameter of
   *   the longest curve.
   * @param {number} [options.radialSegments=8] - Tube vertices around.
   * @param {number} [options.lengthSegments=3] - Tube rings between two particles.
   * @param {number} [options.capSegments=2] - Rings of each rounded end.
   * @param {Array} [options.colliders] - Initial `colliders`.
   * @param {ArrayLike<number>} [options.pinned] - Particles (noodle × particlesPerNoodle + index) held at their
   *   rest pose.
   * @param {number} [options.segmentBucketSize] - Entries per segment-hash bucket; by default 4 × the segments a
   *   densely packed cell holds, from 32 to 64. Size it from `info.fullestSegmentBucket` (readInfoAsync()).
   * @param {number} [options.bucketSize] - Entries per bucket of the particle hash partners read; by default twice
   *   the particles a cell holds, from 16 to 64. Size it from `info.fullestBucket`.
   * @param {ArrayLike<number>} [options.radiusProfile] - particlesPerNoodle multipliers of `radius`, head first, the
   *   same for every noodle: tapered tubes. The hashes and the step bound are sized by the largest.
   * @param {Function} [options.noodleHook] - (stage, context) => void, called while the noodles pass is built, to emit
   *   TSL inside each noodle's solve: 'bend' after every bending sweep, 'stretch' after the stretch solve. `context`:
   *   the noodle's particles (`mem.x(k)`: position and inverse mass; `mem.start(k)`, `mem.support(k)`, `mem.rest(k)`),
   *   `each(body)` over them, `sync()`, `lane`, `noodle`, `base`, `P`, `shared`, `firstSweep`, `radiusOf(k)` and
   *   `nodes`. The pass syncs after every call, so a hook need not end on `sync()`. Each buffer the hook reads is one
   *   more binding: the pass binds 7 while a noodle fits in workgroup memory (up to 170 particles), 8 past it, and
   *   WebGPU's default limit is 8.
   * @param {boolean} [options.contactLanes=true] - The starting `contactLanes`.
   * @param {boolean} [options.colliderCulling=false] - The starting `colliderCulling`.
   * @param {boolean} [options.partnerHash=true] - Builds the particle hash of couplingData (gridCounters,
   *   gridParticles) after every frame, for the simulations that list this one as a collider. false skips its two
   *   passes: only when none does. Fixed at construction.
   */
  constructor(curves, material = null, options = {}) {
    super(new THREE.BufferGeometry(), null)
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new Error('NoodleSimulation: the third argument is an options object, { radius, particlesPerNoodle, … }.')
    }
    for (const key of Object.keys(options)) {
      if (!OPTION_KEYS.includes(key)) console.warn(`NoodleSimulation: unknown option "${key}" ignored.`)
    }
    const list = Array.isArray(curves) ? curves : [curves]
    if (list.length === 0) throw new Error('NoodleSimulation: `curves` is an empty array.')
    const lengths = list.map((curve, i) => {
      const name = Array.isArray(curves) ? `curves[${i}]` : 'curves'
      if (typeof curve?.getSpacedPoints !== 'function' || typeof curve.getLength !== 'function') {
        throw new Error(`NoodleSimulation: ${name} must be a THREE.Curve.`)
      }
      const length = curve.getLength()
      if (!(length > 0) || !Number.isFinite(length)) throw new Error(`NoodleSimulation: ${name} has no length.`)
      return length
    })

    const radius = options.radius ?? 0.05
    if (!(radius > 0) || !Number.isFinite(radius)) {
      throw new Error(`NoodleSimulation: radius must be a finite number > 0 (got ${radius}).`)
    }
    const P = options.particlesPerNoodle ?? Math.max(2, Math.round(Math.max(...lengths) / (2 * radius)) + 1)
    const radialSegments = options.radialSegments ?? 8
    const lengthSegments = options.lengthSegments ?? 3
    const capSegments = options.capSegments ?? 2
    for (const [key, value, least] of [
      ['particlesPerNoodle', P, 2],
      ['radialSegments', radialSegments, 3],
      ['lengthSegments', lengthSegments, 1],
      ['capSegments', capSegments, 1],
      ['segmentBucketSize', options.segmentBucketSize ?? 1, 1],
      ['bucketSize', options.bucketSize ?? 1, 1],
    ]) {
      if (!Number.isInteger(value) || value < least) {
        throw new Error(`NoodleSimulation: ${key} must be an integer ≥ ${least} (got ${value}).`)
      }
    }
    let profile = null
    if (options.radiusProfile !== undefined) {
      const given = options.radiusProfile
      if (!(Array.isArray(given) || ArrayBuffer.isView(given)) || given.length !== P) {
        throw new Error(`NoodleSimulation: options.radiusProfile must hold particlesPerNoodle (${P}) numbers.`)
      }
      profile = Float32Array.from(given)
      if (!profile.every((value) => value > 0 && Number.isFinite(value))) {
        throw new Error('NoodleSimulation: options.radiusProfile must be finite numbers > 0.')
      }
    }
    if (options.noodleHook !== undefined && typeof options.noodleHook !== 'function') {
      throw new Error('NoodleSimulation: options.noodleHook must be a function (stage, context) => void.')
    }
    this.#noodleHook = options.noodleHook ?? null
    for (const key of ['contactLanes', 'colliderCulling', 'partnerHash']) {
      if (options[key] !== undefined && typeof options[key] !== 'boolean') {
        throw new Error(`NoodleSimulation: options.${key} must be a boolean.`)
      }
    }
    if (options.colliders !== undefined && !Array.isArray(options.colliders)) {
      throw new Error('NoodleSimulation: options.colliders must be an array.')
    }
    const pinned = options.pinned ?? []
    if (!Array.isArray(pinned) && !ArrayBuffer.isView(pinned)) {
      throw new Error('NoodleSimulation: options.pinned must be an array of particle indices.')
    }

    this.#source = { curves, material, options: { ...options } }
    this.#M = list.length
    this.#P = P
    this.#N = list.length * P
    this.#S = list.length * (P - 1)
    this.#radius = radius
    this.#profile = profile
    const sizing = profile ? radius * Math.max(...profile) : radius
    this.#maxRadius = sizing
    this.colliders = options.colliders ? options.colliders.slice() : []
    this.contactLanes = options.contactLanes ?? true
    this.colliderCulling = options.colliderCulling ?? false
    this.#partnerHash = options.partnerHash ?? true
    for (const key of Object.keys(NUMBER_SETTINGS)) this.#valid[key] = this[key]

    // The rest pose: particles evenly spaced along each curve. restLengths per particle: the stretch rest length to
    // the next one (x), the bend's rest 2s̄ · tan(θ/2) (y), its spacing s̄ (z), the stretch compliance's factor (w).
    const N = this.#N
    const rest = new Float32Array(4 * N)
    const restLengths = new Float32Array(4 * N)
    let minSpacing = Infinity
    let maxSpacing = 0
    for (let n = 0; n < list.length; n++) {
      const points = list[n].getSpacedPoints(P - 1)
      if (points.length !== P) throw new Error(`NoodleSimulation: curve ${n} gave ${points.length} points, not ${P}.`)
      for (let k = 0; k < P; k++) {
        const point = points[k]
        if (!point?.isVector3 || ![point.x, point.y, point.z].every(Number.isFinite)) {
          throw new Error(`NoodleSimulation: curve ${n} is not a finite 3D curve.`)
        }
        rest.set([point.x, point.y, point.z, 1], 4 * (n * P + k))
      }
      for (let k = 0; k < P; k++) {
        const i = n * P + k
        if (k + 1 < P) {
          const spacing = points[k].distanceTo(points[k + 1])
          restLengths[4 * i] = spacing
          // Stretch compliance scales with the segment's length².
          restLengths[4 * i + 3] = spacing * spacing
          minSpacing = Math.min(minSpacing, spacing)
          maxSpacing = Math.max(maxSpacing, spacing)
        }
        if (k > 0 && k + 1 < P) {
          _vector
            .copy(points[k - 1])
            .addScaledVector(points[k], -2)
            .add(points[k + 1])
          // Bend compliance scales with the spacing⁴ (the mean of the joint's two segments).
          const spacing = 0.5 * (points[k - 1].distanceTo(points[k]) + points[k].distanceTo(points[k + 1]))
          restLengths[4 * i + 2] = spacing
          const chord = Math.max(points[k - 1].distanceTo(points[k + 1]), MIN_CHORD * spacing)
          restLengths[4 * i + 1] = (2 * spacing * _vector.length()) / chord
        }
      }
    }
    if (!(minSpacing > 0)) throw new Error('NoodleSimulation: two particles of a noodle coincide; use fewer particles.')
    this.#maxSpacing = maxSpacing
    for (const p of pinned) {
      if (!Number.isInteger(p) || p < 0 || p >= N) {
        throw new Error(`NoodleSimulation: options.pinned has ${p}, not a particle index from 0 to ${N - 1}.`)
      }
      if (rest[4 * p + 3] !== 0) this.#pinnedCount++
      rest[4 * p + 3] = 0
    }
    this.#rest = rest

    // A bucket size no storage binding holds, even with the table shrunk.
    const oversize = (name, bytes, key, value) =>
      new Error(
        `NoodleSimulation: ${key} ${value} needs ${Math.ceil(bytes / 2 ** 20)} MB of ${name} entries, past ` +
          `WebGPU's ${MAX_BINDING_BYTES / 2 ** 20} MB storage binding; use a smaller one, or fewer particles.`,
      )

    // The particle hash partners read: a cell is one diameter.
    this.#bucket =
      options.bucketSize ??
      THREE.MathUtils.clamp(2 * Math.ceil(2 * ((2 * sizing) / minSpacing + 1)), MIN_BUCKET, MAX_BUCKET)
    let tableSize = 64
    while (tableSize < 2 * N) tableSize *= 2
    while (tableSize > N && 4 * tableSize * this.#bucket > MAX_BINDING_BYTES) tableSize /= 2
    if (4 * tableSize * this.#bucket > MAX_BINDING_BYTES) {
      throw oversize('particle-hash', 4 * tableSize * this.#bucket, 'bucketSize', this.#bucket)
    }
    this.#tableSize = tableSize
    const invCellSize = 1 / (2 * sizing)
    this.#cellOf = (position) => ivec3(floor(position.mul(invCellSize)))
    this.#hashOf = (cell) => hashCell(cell, tableSize)

    // The segment hash, by segment middles: a cell covers the contact reach plus a segment, so every segment within
    // reach is in the 27 cells around one's middle.
    const S = this.#S
    // Segments of one noodle closer along it than its diameter overlap at rest: they never collide.
    this.#segmentSkip = Math.max(1, Math.floor(1 + (2.2 * sizing) / minSpacing - 1e-9))
    this.#segmentCell = CONTACT_REACH * sizing + 1.1 * maxSpacing
    // Buckets are read only as far as they're filled.
    const perCell = (PACKING * this.#segmentCell ** 3) / (Math.PI * sizing * sizing * minSpacing)
    this.#segmentBucket =
      options.segmentBucketSize ?? THREE.MathUtils.clamp(4 * Math.ceil(perCell), 2 * MIN_BUCKET, MAX_BUCKET)
    let segmentTable = 64
    while (segmentTable < 2 * S) segmentTable *= 2
    while (segmentTable > S && 16 * segmentTable * this.#segmentBucket > MAX_BINDING_BYTES) segmentTable /= 2
    if (16 * segmentTable * this.#segmentBucket > MAX_BINDING_BYTES) {
      throw oversize('segment-hash', 16 * segmentTable * this.#segmentBucket, 'segmentBucketSize', this.#segmentBucket)
    }
    this.#segmentTable = segmentTable
    const invSegmentCell = 1 / this.#segmentCell
    this.#segmentCellOf = (position) => ivec3(floor(position.mul(invSegmentCell)))
    this.#segmentHashOf = (cell) => hashCell(cell, segmentTable)

    this.#sharedNoodles = 6 * 16 * P <= WORKGROUP_BYTES
    this.#noodleWorkgroup = P <= NOODLE_SIMD ? NOODLE_SIMD : NOODLE_WORKGROUP
    this.#allocate(rest, restLengths, transportFrames(rest, this.#M, P))
    this.#uniforms = this.#createUniforms()
    this.#createPasses()
    this.#nodes = this.#createSurfaceNodes()

    this.geometry = this.#createTubeGeometry(radialSegments, lengthSegments, capSegments)
    this.count = this.#M
    // Deformed on the GPU: the geometry's bounds are the rest pose's.
    this.frustumCulled = false
    this.material = this.#deform(material ?? new THREE.MeshStandardNodeMaterial())

    const b = this.#buffers
    const u = this.#uniforms
    this.#couplingData = {
      layout: 'hash',
      positions: b.positions,
      previous: b.previous,
      particleRadius: sizing,
      cellSize: 2 * sizing,
      tableSize,
      maxPerCell: this.#bucket,
      gridCounters: b.hashCounts,
      gridParticles: b.hashEntries,
      cellOf: this.#cellOf,
      hashOf: this.#hashOf,
      matrixWorld: this.matrixWorld,
      owner: this,
    }
    HELPER_DATA.set(this, { positions: b.positions, drawnPositions: b.drawnPositions, P, profile: u.radiusProfile })
    Object.assign(this.info, {
      noodles: this.#M,
      particles: N,
      segments: S,
      particlesPerNoodle: P,
      pinned: this.#pinnedCount,
      segmentSkip: this.#segmentSkip,
      segmentCellSize: this.#segmentCell,
      segmentTableSize: segmentTable,
      segmentBucketSize: this.#segmentBucket,
      hashTableSize: tableSize,
      bucketSize: this.#bucket,
    })
  }

  // ---- Accessors ----

  /** Of the tubes and of the capsules they collide as, object units. */
  get radius() {
    return this.#radius
  }

  get particlesPerNoodle() {
    return this.#P
  }

  get particleCount() {
    return this.#N
  }

  /** Capsules: particlesPerNoodle − 1 per noodle. */
  get segmentCount() {
    return this.#S
  }

  /** options.radiusProfile as given (a copy), or null: every particle has `radius`. */
  get radiusProfile() {
    return this.#profile ? this.#profile.slice() : null
  }

  /** The widest particle's radius: `radius` × the largest of radiusProfile. */
  get maxRadius() {
    return this.#maxRadius
  }

  /** options.partnerHash: whether every frame ends by building the particle hash of couplingData. */
  get partnerHash() {
    return this.#partnerHash
  }

  /** The particle positions: a storage node, vec4 per particle (xyz, inverse mass), noodle after noodle. */
  get particlePositions() {
    return this.#buffers.positions
  }

  /**
   * A per-particle value at the drawn vertex, for the material's vertex stage: `read(i)` at the two particles of the
   * vertex's span (i a uint node, the particle's index), mixed along it. The rounded ends take their end particle's.
   * One thread per particle in a pass of yours fills what `read` reads, so the material needn't compute it per vertex:
   *
   *   const shade = instancedArray(noodles.particleCount, 'float')
   *   material.colorNode = vec3(vertexStage(noodles.alongNoodle((i) => shade.element(i))))
   *
   * @param {Function} read - (i) => Node
   * @returns {Node}
   */
  alongNoodle(read) {
    const P = this.#P
    const along = attribute('noodle', 'vec4').x
    const segment = clamp(floor(along), 0, P - 2)
    const base = instanceIndex.mul(uint(P))
    const i0 = base.add(uint(segment))
    const i1 = base.add(uint(min(segment.add(1), P - 1)))
    return mix(read(i0), read(i1), along.sub(segment))
  }

  /** What a coupled partner reads: the particle hash and buffers; null once disposed. */
  get couplingData() {
    return this.#couplingData
  }

  /** Whether startGrab() holds a particle. */
  get isGrabbing() {
    return this.#grab.active
  }

  // ---- Interaction ----

  /**
   * Puts every noodle back on its curve, at rest, with its twist frames as built, at the next update(), and restarts
   * info's substeps and GPU statistics. Not a bit-exact replay of construction: the respawn recomputes the rest bends
   * on the GPU (a few ulps off the constructor's) and segmentLoad keeps the last substep's contact loads.
   */
  reset() {
    if (this.#disposed) return this.#warnDisposed('reset')
    this.#respawnPending = true
    this.#snapPending = true
    this.#clock.accumulator = 0
    this.#grab.active = false
    this.#statsEpoch++
    Object.assign(this.info, {
      substeps: 0,
      droppedSegmentEntries: 0,
      fullestSegmentBucket: 0,
      droppedEntries: 0,
      fullestBucket: 0,
    })
    return this
  }

  /**
   * Grabs particle `particle` (from pickAsync()) and its neighbours on the noodle; they keep their offsets from it
   * and follow moveGrab() until endGrab(). Pinned particles stay pinned.
   */
  startGrab(particle) {
    if (this.#disposed) return this.#warnDisposed('startGrab')
    if (!Number.isInteger(particle) || particle < 0 || particle >= this.#N) {
      throw new Error(`NoodleSimulation: startGrab(${particle}) needs a particle index from 0 to ${this.#N - 1}.`)
    }
    const grab = this.#grab
    grab.active = true
    grab.capture = true
    grab.hasTarget = false
    grab.ray = false
    grab.particle = particle
    return this
  }

  /** Where the grabbed particle goes, world space; swept over the next update's substeps. */
  moveGrab(point) {
    if (this.#disposed) return this.#warnDisposed('moveGrab')
    if (!point?.isVector3 || ![point.x, point.y, point.z].every(Number.isFinite)) {
      throw new Error('NoodleSimulation: moveGrab(point) needs a finite THREE.Vector3.')
    }
    const grab = this.#grab
    if (!grab.active) return this
    if (grab.ray) {
      this.#warnOnce('moveGrabRay', 'NoodleSimulation: a grabPicked() grab moves by moveGrabAlongRay(ray); ignored.')
      return this
    }
    this.updateWorldMatrix(true, false)
    grab.target.copy(point).applyMatrix4(_inverse.copy(this.matrixWorld).invert())
    if (!grab.hasTarget) {
      grab.previousTarget.copy(grab.target)
      grab.leap = true
    }
    grab.hasTarget = true
    return this
  }

  /** Lets go: the noodle keeps the grab's velocity. */
  endGrab() {
    this.#grab.active = false
    this.#grab.hasTarget = false
    this.#grab.ray = false
    return this
  }

  /**
   * Finds the particle nearest along the ray at the next update(), on the GPU, among spheres of `options.radius`
   * (default 2.5 × radius) around the particles, within the raycaster's near and far: nothing is read back. The
   * answer lands in `pickResult`, for your passes and grabPicked().
   */
  pick(raycaster, options = {}) {
    if (this.#disposed) return this.#warnDisposed('pick')
    if (!raycaster?.ray?.origin?.isVector3 || !raycaster.ray.direction?.isVector3) {
      throw new Error('NoodleSimulation: pick(raycaster) needs a THREE.Raycaster.')
    }
    const radius = options.radius ?? 2.5 * this.#radius
    if (!(typeof radius === 'number' && radius > 0)) {
      throw new Error(`NoodleSimulation: pick() radius must be a number > 0 (got ${radius}).`)
    }
    this.updateWorldMatrix(true, false)
    _inverse.copy(this.matrixWorld).invert()
    _ray.copy(raycaster.ray).applyMatrix4(_inverse)
    const pick = this.#pick
    pick.pending = true
    pick.origin.copy(_ray.origin)
    pick.direction.copy(_ray.direction).normalize()
    pick.radius = radius
    pick.near = raycaster.near ?? 0
    pick.far = Number.isFinite(raycaster.far) ? raycaster.far : 1e30
    return this
  }

  /**
   * Grabs what pick() (called first, in the same frame) finds at the next update(), on the GPU.
   * moveGrabAlongRay() then moves it, keeping its distance along the ray.
   */
  grabPicked() {
    if (this.#disposed) return this.#warnDisposed('grabPicked')
    const grab = this.#grab
    grab.active = true
    grab.capture = true
    grab.hasTarget = false
    grab.ray = true
    return this
  }

  /** Where a grabPicked() grab goes: along this ray (world space), at the distance the pick found it. */
  moveGrabAlongRay(ray) {
    if (this.#disposed) return this.#warnDisposed('moveGrabAlongRay')
    if (!ray?.origin?.isVector3 || !ray.direction?.isVector3) {
      throw new Error('NoodleSimulation: moveGrabAlongRay(ray) needs a THREE.Ray.')
    }
    const grab = this.#grab
    if (!grab.active || !grab.ray) return this
    this.updateWorldMatrix(true, false)
    _ray.copy(ray).applyMatrix4(_inverse.copy(this.matrixWorld).invert())
    grab.target.copy(_ray.origin)
    grab.direction.copy(_ray.direction).normalize()
    if (!grab.hasTarget) {
      grab.previousTarget.copy(grab.target)
      grab.previousDirection.copy(grab.direction)
      grab.leap = true
    }
    grab.hasTarget = true
    return this
  }

  /** pick()'s answer on the GPU: uint [0] the hit distance's float bits, [1] the particle (0xffffffff: none). */
  get pickResult() {
    return this.#buffers.pick
  }

  /**
   * The simulation's storage and uniform nodes, for passes of your own (extraPasses, options.noodleHook): `buffers`
   * (positions, previous, velocities, restLengths, support, segmentDelta, stepState, grabState, pick, …; layouts in
   * #allocate()) and `uniforms` (h, substeps, gravity, ground, colliders, colliderCount, …).
   */
  get nodes() {
    return { buffers: this.#buffers, uniforms: this.#uniforms }
  }

  /**
   * Emits TSL, in a pass of your own, that calls body(c) for each Plane / Sphere / Box3 / Capsule collider index c
   * (`nodes.uniforms.colliders` holds 4 vec4 per collider: its pose now and last frame's), in list order. With
   * `options.culled`, only those in colliderCulling's list for `noodle`: for extraPasses.substep and .after passes
   * while colliderCulling is on.
   *
   * @param {Node} noodle
   * @param {Function} body - (c) => void
   * @param {object} [options]
   * @param {boolean} [options.culled=false]
   */
  forEachCollider(noodle, body, options = {}) {
    for (const key of Object.keys(options)) {
      if (key !== 'culled') console.warn(`NoodleSimulation: forEachCollider(): unknown option "${key}" ignored.`)
    }
    if (!options.culled) return Loop(this.#uniforms.colliderCount, ({ i: c }) => body(c))
    const masks = this.#buffers.stepState
    const first = uint(noodle).mul(uint(MASK_WORDS)).add(uint(1)).toVar()
    // Each word's bits lowest first: the colliders in ascending order.
    return Loop(MASK_WORDS, ({ i: word }) => {
      const offset = uint(word).mul(uint(32)).toVar()
      const bits = masks.element(first.add(uint(word))).toVar()
      Loop(bits.notEqual(uint(0)), () => {
        const c = offset.add(countTrailingZeros(bits)).toVar()
        bits.assign(bits.bitAnd(bits.sub(uint(1))))
        body(c)
      })
    })
  }

  /**
   * The particle nearest along the ray, among spheres of `options.radius` (default 2.5 × radius) around the
   * particles; one GPU readback. `point` is where the ray enters that sphere and `position` the particle, in world
   * space: grab with `moveGrab(position)` so the noodle doesn't jump.
   *
   * @returns {Promise<{distance: number, point: THREE.Vector3, position: THREE.Vector3, particle: number, noodle: number}|null>}
   */
  async pickAsync(raycaster, options = {}) {
    if (this.#disposed) throw new Error('NoodleSimulation: pickAsync() after dispose().')
    if (!raycaster?.ray?.origin?.isVector3 || !raycaster.ray.direction?.isVector3) {
      throw new Error('NoodleSimulation: pickAsync(raycaster) needs a THREE.Raycaster.')
    }
    if (options === null || typeof options !== 'object') {
      throw new Error('NoodleSimulation: pickAsync() options must be an object.')
    }
    const { radius } = options
    if (radius !== undefined && !(typeof radius === 'number' && radius > 0)) {
      throw new Error(`NoodleSimulation: pickAsync() radius must be a number > 0 (got ${radius}).`)
    }
    const ray = raycaster.ray.clone()
    const { near, far } = raycaster
    const positions = await this.#readPositions()
    if (this.#disposed) throw new Error('NoodleSimulation: pickAsync() after dispose().')
    this.updateWorldMatrix(true, false)
    _ray.copy(ray).applyMatrix4(_inverse.copy(this.matrixWorld).invert())
    const r = radius ?? 2.5 * this.#radius
    const r2 = r * r
    const { origin, direction } = _ray
    let best = Infinity
    let bestParticle = -1
    for (let p = 0; p < this.#N; p++) {
      const ox = positions[4 * p] - origin.x
      const oy = positions[4 * p + 1] - origin.y
      const oz = positions[4 * p + 2] - origin.z
      const along = ox * direction.x + oy * direction.y + oz * direction.z
      const offSq = ox * ox + oy * oy + oz * oz - along * along
      if (offSq > r2) continue
      const half = Math.sqrt(r2 - offSq)
      const t = along - half >= 0 ? along - half : along + half
      if (t >= 0 && t < best) {
        best = t
        bestParticle = p
      }
    }
    if (bestParticle < 0) return null
    const point = _ray.at(best, new THREE.Vector3()).applyMatrix4(this.matrixWorld)
    const distance = point.distanceTo(ray.origin)
    if (distance < near || distance > far) return null
    const position = new THREE.Vector3().fromArray(positions, 4 * bestParticle).applyMatrix4(this.matrixWorld)
    return { distance, point, position, particle: bestParticle, noodle: Math.floor(bestParticle / this.#P) }
  }

  /**
   * Reads the particles back, noodle after noodle: xyz positions and velocities in the object's space. One readback.
   *
   * @returns {Promise<{positions: Float32Array, velocities: Float32Array}>}
   */
  async readParticlesAsync() {
    if (this.#disposed) throw new Error('NoodleSimulation: readParticlesAsync() after dispose().')
    const [positions, velocities] = await Promise.all([this.#readPositions(), this.#readVelocities()])
    return { positions: unpad(positions, this.#N), velocities: unpad(velocities, this.#N) }
  }

  /**
   * Reads the hash statistics since construction or reset() back into `info` and returns it: the entries dropped from
   * full buckets and the most a bucket was asked to hold. Noodles may cross where segments were dropped: construct
   * with `options.segmentBucketSize` ≥ `info.fullestSegmentBucket` (and `options.bucketSize` ≥ `info.fullestBucket`).
   * One readback.
   *
   * @returns {Promise<object>}
   */
  async readInfoAsync() {
    if (this.#disposed) throw new Error('NoodleSimulation: readInfoAsync() after dispose().')
    // Nothing hashed yet, or the next update() restarts the counts.
    if (!this.#stepped || this.#respawnPending) return this.info
    const epoch = this.#statsEpoch
    const stats = new Uint32Array(await this.#renderer.getArrayBufferAsync(this.#buffers.stats.value))
    if (this.#disposed) throw new Error('NoodleSimulation: readInfoAsync() after dispose().')
    if (epoch !== this.#statsEpoch) return this.info
    const info = this.info
    const [droppedSegmentEntries, fullestSegmentBucket, droppedEntries, fullestBucket] = stats
    if (droppedSegmentEntries > 0) {
      this.#warnOnce(
        'segmentOverflow',
        `NoodleSimulation: ${droppedSegmentEntries} segment-hash entries were dropped (buckets hold ${this.#segmentBucket}, one was asked for ${fullestSegmentBucket}): the other segments missed those for a substep, and noodles may cross there. Construct with options.segmentBucketSize of at least ${fullestSegmentBucket}.`,
      )
    }
    if (droppedEntries > 0) {
      this.#warnOnce(
        'particleOverflow',
        `NoodleSimulation: ${droppedEntries} particle-hash entries were dropped (buckets hold ${this.#bucket}, one was asked for ${fullestBucket}): partners missed those particles for a frame. Construct with options.bucketSize of at least ${fullestBucket}.`,
      )
    }
    Object.assign(info, { droppedSegmentEntries, fullestSegmentBucket, droppedEntries, fullestBucket })
    return info
  }

  /**
   * Compiles the compute passes ahead of time, so neither the first update(), grab or reset() nor a change of
   * selfCollision or strictCollisions compiles mid-frame; the passes of the partners listed now too.
   * The next frame's passes come first: until they're built, update() holds the noodles still. Optional.
   *
   * @param {THREE.WebGPURenderer} renderer - The renderer update() runs with.
   */
  async compileAsync(renderer) {
    if (this.#disposed) throw new Error('NoodleSimulation: compileAsync() after dispose().')
    if (!renderer?.isRenderer) throw new Error('NoodleSimulation: compileAsync(renderer) needs the WebGPURenderer.')
    if (!renderer.initialized) await renderer.init()
    if (this.#disposed) return
    if (this.#renderer === null) this.#renderer = renderer
    else if (renderer !== this.#renderer) {
      throw new Error('NoodleSimulation: compileAsync() with another renderer than update().')
    }
    if (!renderer.backend?.isWebGPUBackend) {
      return this.#warnOnce(
        'backend',
        'NoodleSimulation: needs the WebGPU backend; the WebGL 2 fallback has no compute atomics. Not simulating.',
      )
    }
    await this.#compile(renderer)
  }

  // The passes for the colliders listed now, under every setting, built without taking their poses (a collider moved
  // meanwhile must not sweep across that move). Colliders no longer listed, or changed, go.
  async #compile(renderer) {
    const p = this.#readSettings()
    this.updateWorldMatrix(true, false)
    const listed = Array.isArray(this.colliders) ? this.colliders : []
    if (!this.#capsuleColliders && listed.some(isCapsule)) this.#enableCapsuleColliders()
    const partners = []
    for (const collider of listed) {
      if (collider !== this && collider?.couplingData !== undefined) {
        const state = this.#partnerState(collider)
        if (state) partners.push(state)
      }
    }
    for (const [key, state] of this.#partners) if (!partners.includes(state)) this.#dropPartner(key, state)
    // Every velocity variant #listPasses() may pick for these colliders, whatever the settings.
    const culling = p.colliderCulling ? [false, true] : [false]
    for (const [segments, bound] of [
      [true, true],
      [true, false],
      [false, false],
    ]) {
      for (const coupled of partners.length > 0 ? [true, false] : [false]) {
        for (const culled of culling) this.#velocityPass({ segments, partners: coupled, bound, culled })
      }
    }
    if (p.colliderCulling) {
      this.#maskPass(false)
      this.#maskPass(true)
    }
    // The next frame's passes first, skipping those built or queued by another run.
    const first = this.#frameList({
      n: 1,
      respawn: false,
      copyPrevious: true,
      capture: false,
      selfCollision: p.selfCollision,
      strict: p.strictCollisions,
      lanes: p.contactLanes,
      culling: p.colliderCulling,
      interval: p.couplingInterval,
      partners: partners.map((state) => state.pass),
      frames: true,
      ray: false,
      pick: false,
      extra: this.#readExtraPasses(),
    })
    // With a hook, the ray-grab noodles pass too: subclasses grab that way.
    if (this.#noodleHook) this.#rayNoodlePass()
    const order = [...new Set([...first, ...this.#allPasses()])].filter(
      (pass) => !this.#compiled.has(pass) && !this.#queued.has(pass),
    )
    for (const pass of order) this.#queued.set(pass, (this.#queued.get(pass) ?? 0) + 1)
    const done = (pass) => {
      const runs = this.#queued.get(pass) - 1
      if (runs > 0) this.#queued.set(pass, runs)
      else this.#queued.delete(pass)
    }
    // One pass at a time: three's compile can't be cancelled, so frees wait for it to settle, and a pass dropped
    // before its turn is skipped.
    const run = (async () => {
      let next = 0
      try {
        for (; next < order.length; next++) {
          if (this.#disposed) return
          const pass = order[next]
          if (this.#allPasses().includes(pass)) {
            await renderer.compileComputeAsync(pass)
            this.#compiled.add(pass)
          }
          done(pass)
        }
      } finally {
        // What a disposed or failed run didn't reach holds no frame.
        for (; next < order.length; next++) done(order[next])
      }
    })()
    // A compile already in flight keeps the frees waiting until both settle.
    const all = this.#compiling ? Promise.allSettled([this.#compiling, run]) : run
    this.#compiling = all
    try {
      await all
      await run
    } finally {
      if (this.#compiling === all) this.#compiling = null
    }
  }

  // ---- Simulation ----

  /**
   * Advances the simulation by `delta` seconds (× timeScale) in fixed substeps and refreshes the tubes. Call once per
   * frame, before rendering; pass 0 while paused to keep motion vectors at rest. Without `delta`, the wall-clock time
   * since the previous call is used. While compileAsync() still builds a pass the frame needs, the noodles hold still.
   *
   * @param {THREE.WebGPURenderer} renderer - The same renderer on every call.
   * @param {number} [delta]
   */
  update(renderer, delta) {
    if (this.#disposed) return this.#warnOnce('disposed', 'NoodleSimulation: update() after dispose().')
    if (!renderer?.isRenderer) throw new Error('NoodleSimulation: update(renderer, delta) needs the WebGPURenderer.')
    if (!renderer.initialized) {
      return this.#warnOnce('init', 'NoodleSimulation: call update() after `await renderer.init()`.')
    }
    if (this.#renderer === null) {
      this.#renderer = renderer
    } else if (renderer !== this.#renderer) {
      return this.#warnOnce('renderer', 'NoodleSimulation: update() with another renderer than the first one; ignored.')
    }
    if (!renderer.backend?.isWebGPUBackend) {
      return this.#warnOnce(
        'backend',
        'NoodleSimulation: needs the WebGPU backend; the WebGL 2 fallback has no compute atomics. Not simulating.',
      )
    }
    const p = this.#readSettings()
    this.#syncMaterial()
    this.updateWorldMatrix(true, false)
    const now = performance.now()
    if (delta === undefined) delta = this.#lastTime < 0 ? 1 / 60 : (now - this.#lastTime) / 1000
    this.#lastTime = now
    if (typeof delta !== 'number' || Number.isNaN(delta)) {
      this.#warnOnce('delta', `NoodleSimulation: update() delta = ${String(delta)} is not a number; using 0.`)
    }
    const f = this.#frame(renderer, p, this.#advanceClock(p, delta))
    const list = this.#frameList(f)
    if (list.length > 0) {
      // A pass still compiling would dispatch without its pipeline: the noodles wait as if paused (copyPrevious ran
      // in the first frame, so its pipeline is ready).
      if (this.#queued.size > 0 && list.some((pass) => this.#queued.has(pass))) {
        this.info.substeps = 0
        this.#snapPending = true
        if (f.copyPrevious && this.#live) renderer.compute(this.#passes.copyPrevious)
        return
      }
      renderer.compute(list)
      this.#live = true
      if (!this.#ranLists.has(list)) {
        this.#ranLists.add(list)
        for (const pass of list) this.#compiled.add(pass)
      }
      // A substep or a reset binds every buffer read back.
      if (f.n > 0 || f.respawn) this.#stepped = true
    }
    this.#endFrame(f)
  }

  // The fixed-substep clock advanced by `delta` real seconds: numSubsteps substeps per 1/60 s of simulated time, which
  // runs at timeScale × real time; a frame counts at most maxDeltaTime (slow motion instead of a catch-up spiral), and
  // the excess is dropped. `+ 1e-6` keeps a 1/60 s frame at exactly numSubsteps. Returns { n, h, paused }.
  #advanceClock({ numSubsteps, timeScale, maxDeltaTime }, delta) {
    const clock = this.#clock
    if (clock.key !== numSubsteps) {
      clock.key = numSubsteps
      clock.accumulator = 0
    }
    const h = 1 / (60 * numSubsteps)
    const frame = typeof delta === 'number' && delta > 0 ? Math.min(delta, maxDeltaTime) : 0
    if (!Number.isFinite(clock.accumulator)) clock.accumulator = 0
    clock.accumulator += frame * timeScale
    let n = Math.floor(clock.accumulator / h + 1e-6)
    const cap = Math.ceil((maxDeltaTime * timeScale) / h - 1e-6)
    if (n > cap) {
      n = cap
      clock.accumulator = 0
    } else {
      clock.accumulator = Math.max(0, clock.accumulator - n * h)
    }
    return { n, h, paused: frame * timeScale === 0 }
  }

  // The rest of a frame before its dispatch: what the passes read, and the shape of its pass list. `tick`: n substeps
  // of h simulated seconds.
  #frame(renderer, p, { n, h, paused }) {
    this.info.substeps = n
    const coupling = this.info.coupling
    coupling.members = 1
    coupling.substeps = p.numSubsteps
    coupling.h = h
    if (p.selfCollision && p.strictCollisions) {
      // The velocity pass's bound, at the widest particle's reach.
      const strictSpeed = (STEP_SHARE * CONTACT_REACH * this.#maxRadius) / h
      if (p.maxSpeed === 0 || strictSpeed < p.maxSpeed) {
        this.#warnOnce(
          'strictSpeed',
          `NoodleSimulation: strictCollisions caps the speed at ${strictSpeed.toFixed(1)} units/s (largest radius ${this.#maxRadius}, ${p.numSubsteps} substeps), below maxSpeed; raise numSubsteps for faster motion.`,
        )
      }
    }
    const respawn = this.#respawnPending
    const renderCalls = renderer.info.render.calls
    // Once per render, hidden or not: the helper draws from it too.
    const copyPrevious = renderCalls !== this.#lastCopyCalls
    if (copyPrevious) this.#lastCopyCalls = renderCalls
    const grab = this.#grab
    const f = {
      n,
      respawn,
      copyPrevious,
      capture: grab.active && grab.capture,
      ray: grab.active && grab.ray,
      pick: this.#pick.pending,
      extra: this.#readExtraPasses(),
      selfCollision: p.selfCollision,
      strict: p.strictCollisions,
      lanes: p.contactLanes,
      culling: p.colliderCulling,
      interval: p.couplingInterval,
      partners: [],
      frames: false,
      paused,
    }
    f.partners = this.#syncColliders().map((state) => state.pass)
    if (p.colliderCulling) this.#syncCulling(p, h, n)
    this.#syncUniforms(p, h, n)
    coupling.bendingIterations = this.#uniforms.bendingIterations.value
    // The twist frames as built, uploaded before the respawn's dispatches: the frames pass carries them from there as
    // it does after construction.
    if (respawn) this.#buffers.frames.value.needsUpdate = true
    if (n > 0 || respawn) this.#framesCurrent = false
    f.frames = this.visible && !this.#framesCurrent
    return f
  }

  // After the dispatch: what it consumed, and where the next frame starts.
  #endFrame(f) {
    const grab = this.#grab
    this.#respawnPending = false
    if (f.frames) this.#framesCurrent = true
    if (f.pick) this.#pick.pending = false
    if (grab.active && grab.capture) grab.capture = false
    if (f.n > 0 && grab.hasTarget) {
      grab.previousTarget.copy(grab.target)
      grab.previousDirection.copy(grab.direction)
      grab.leap = false
    }
    // Colliders sweep from here next time; while paused they jump, so a move made during a pause isn't swept.
    this.#advanceColliders(f.n > 0 || f.paused || this.#snapPending)
    this.#snapPending = false
  }

  // colliderCulling's reach (#maskPass()): CULL_SAFETY × (the widest radius, colliderMargin, colliderCullingReach,
  // how far a particle may travel over the frame, and one substep's move before the bound).
  #syncCulling(p, h, n) {
    const radius = this.#maxRadius
    const speed = p.maxSpeed > 0 ? p.maxSpeed : Infinity
    const strict = p.strictCollisions && p.selfCollision
    // A grab shoves the noodles it meets as far as it moves: unbounded along a ray or on its first move.
    const grab = this.#grab
    const grabSweep =
      !grab.active || !grab.hasTarget
        ? 0
        : grab.ray || grab.leap
          ? Infinity
          : grab.target.distanceTo(grab.previousTarget)
    const travel = strict ? n * STEP_SHARE * CONTACT_REACH * radius : n * speed * h + this.#colliderSweep + grabSweep
    const solve = (speed + this.#validGravity.length() * h) * h + this.#maxSpacing + 2 * radius
    const reach = CULL_SAFETY * (radius + p.colliderMargin + p.colliderCullingReach + travel + solve)
    this.#uniforms.cullReach.value = Number.isFinite(reach) ? Math.min(reach, 3e38) : 3e38
  }

  /** The rest geometry doesn't follow the simulation, so raycasts ignore the noodles; see pickAsync(). */
  raycast() {}

  /** Copies the object and the settings, colliders (shallow) included; the simulation state stays this one's. */
  copy(source, recursive = true) {
    const geometry = this.geometry
    const material = this.material
    super.copy(source, recursive)
    // Bound to this simulation's buffers.
    this.geometry = geometry
    this.material = material
    this.count = this.#M
    if (source.isNoodleSimulation) {
      for (const key of Object.keys(NUMBER_SETTINGS)) this[key] = source[key]
      for (const key of BOOLEAN_SETTINGS) this[key] = source[key]
      if (source.gravity?.isVector3) this.gravity.copy(source.gravity)
      this.ground = source.ground?.isPlane ? source.ground.clone() : null
      this.colliders = Array.isArray(source.colliders) ? source.colliders.slice() : []
    }
    return this
  }

  /** A new simulation of the same curves, material and options, with this one's settings. */
  clone(recursive) {
    const { curves, material, options } = this.#source
    return new this.constructor(curves, material, options).copy(this, recursive)
  }

  /** Frees the GPU resources (once a compileAsync() in flight settles) and removes the noodles and their helpers. */
  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    this.removeFromParent()
    super.dispose()
    this.geometry.dispose()
    for (const material of this.#materials) material.dispose()
    this.#materials = []
    // extraPasses are their owner's to dispose.
    const passes = this.#allPasses(false)
    const storage = [...this.#storage]
    const partners = [...this.#partners.values()]
    // A compile in flight may bind the partners' buffers: keep listening until it settles.
    this.#afterCompile(() => {
      for (const state of partners) state.release?.()
      for (const pass of passes) disposePass(pass)
      this.#destroyStorage(storage)
    })
    this.#partners.clear()
    this.#clearLists()
    this.#storage = []
    this.#couplingData = null
    HELPER_DATA.delete(this)
  }

  // ---- Construction ----

  #allocate(rest, restLengths, frames) {
    const N = this.#N
    const S = this.#S
    const s = (name, array, type) => {
      const node = instancedArray(array, type).setName(`noodles_${name}`)
      this.#storage.push(node)
      return node
    }
    // Inverse mass rides in w of positions (lowered while grabbed) and of velocities (as built).
    const velocities = new Float32Array(4 * N)
    for (let i = 0; i < N; i++) velocities[4 * i + 3] = rest[4 * i + 3]
    this.#buffers = {
      positions: s('positions', rest.slice(), 'vec4'),
      previous: s('previous', rest.slice(), 'vec4'),
      // The velocity (predicted, between integrate and the velocity pass) and the inverse mass.
      velocities: s('velocities', velocities, 'vec4'),
      rest: s('rest', rest.slice(), 'vec4'),
      restLengths: s('restLengths', restLengths, 'vec4'),
      // Per particle: the stretch solve's rows (without workgroup memory), then the partners' pushes.
      delta: s('delta', new Float32Array(4 * N), 'vec4'),
      // Per particle: the bends' λ, then the stretch solve's forward sweep.
      solve: s('solve', new Float32Array(4 * N), 'vec4'),
      // Per particle: the normal of what held it up last substep, and how firmly (1 for colliders).
      support: s('support', new Float32Array(4 * N), 'vec4'),
      // Its array stays the frames as built, which a respawn uploads again.
      frames: s('frames', frames.slice(), 'vec4'),
      // The pose last drawn, for motion vectors.
      drawnPositions: s('drawnPositions', rest.slice(), 'vec4'),
      drawnFrames: s('drawnFrames', frames, 'vec4'),
      hashCounts: s('hashCounts', new Uint32Array(this.#tableSize), 'uint').toAtomic(),
      hashEntries: s('hashEntries', new Uint32Array(this.#tableSize * this.#bucket), 'uint'),
      segmentCounts: s('segmentCounts', new Uint32Array(this.#segmentTable), 'uint').toAtomic(),
      // The middle of a segment where its substep started (xyz) and its index (w).
      segmentEntries: s('segmentEntries', new Float32Array(4 * this.#segmentTable * this.#segmentBucket), 'vec4'),
      // Per segment, two vec4: its two ends' pushes, w its contact count and the nearest other segment's distance.
      segmentDelta: s('segmentDelta', new Float32Array(8 * S), 'vec4'),
      // Per segment: its contacts last substep, which split its mass.
      segmentLoad: s('segmentLoad', new Float32Array(S), 'float'),
      // [0]: substeps run this frame; then MASK_WORDS per noodle, colliderCulling's lists (#maskPass()).
      stepState: s('stepState', new Uint32Array(1 + MASK_WORDS * this.#M), 'uint'),
      // Since construction or reset(): segment-hash entries dropped (0) and the fullest bucket (1); the particle
      // hash's (2, 3).
      stats: s('stats', new Uint32Array(4), 'uint').toAtomic(),
      // The grabbed particles' offsets from the anchor (0–2), where it was grabbed (3), and along a ray the picked
      // anchor, its distance along the ray and whether the pick hit (4).
      grabState: s('grabState', new Float32Array(32), 'vec4'),
      // pick(): the nearest hit's distance (float bits; 0xffffffff: none) and its particle.
      pick: s('pick', new Uint32Array([0xffffffff, 0xffffffff, 0, 0]), 'uint').toAtomic(),
    }
  }

  // Constant for a whole frame; what varies per substep comes from stepState.
  #createUniforms() {
    return {
      h: uniform(1 / 900),
      substeps: uniform(1, 'uint'),
      gravity: uniform(new THREE.Vector3(0, -9.81, 0)),
      // Against gravity, unit; 0 without gravity.
      up: uniform(new THREE.Vector3(0, 1, 0)),
      drag: uniform(1),
      normalDrag: uniform(1),
      maxSpeed: uniform(50),
      stretchAlpha: uniform(0),
      compressAlpha: uniform(0),
      bendAlpha: uniform(0),
      bendGamma: uniform(0),
      bendingIterations: uniform(1, 'uint'),
      plasticity: uniform(0),
      plasticityThreshold: uniform(0),
      contactStiffness: uniform(1),
      // separationSpeed × h.
      separation: uniform(0),
      contactFriction: uniform(0.6),
      groundEnabled: uniform(1),
      groundNormal: uniform(new THREE.Vector3(0, 1, 0)),
      groundConstant: uniform(0),
      groundFriction: uniform(0.85),
      groundRestitution: uniform(0),
      restThreshold: uniform(0),
      // Uniform arrays sit in 'object' groups of their own, which upload them only after a version bump
      // (markArrayChanged()), not at every dispatch as three's objectGroup does; same bind group and WGSL.
      colliders: uniformArray(
        Array.from({ length: 4 * MAX_COLLIDERS }, () => new THREE.Vector4()),
        'vec4',
      )
        .setName('noodles_colliders')
        .setGroup(uniformGroup('object')),
      colliderCount: uniform(0, 'uint'),
      colliderFriction: uniform(0.6),
      colliderMargin: uniform(0),
      // colliderCulling: how near a noodle's box a collider comes to stay in its list (#syncCulling()).
      cullReach: uniform(3e38),
      grabActive: uniform(0),
      grabParticle: uniform(0, 'uint'),
      grabFrom: uniform(new THREE.Vector3()),
      grabTo: uniform(new THREE.Vector3()),
      grabHasTarget: uniform(0),
      grabStiffness: uniform(1),
      radiusProfile: this.#profile
        ? uniformArray(Array.from(this.#profile), 'float')
            .setName('noodles_radiusProfile')
            .setGroup(uniformGroup('object'))
        : null,
      // pick() and the grab along a ray (moveGrabAlongRay()), in the object's space.
      pickOrigin: uniform(new THREE.Vector3()),
      pickDirection: uniform(new THREE.Vector3(0, 0, -1)),
      pickRadius: uniform(0.1),
      pickNear: uniform(0),
      pickFar: uniform(1e30),
      grabDirectionFrom: uniform(new THREE.Vector3(0, 0, -1)),
      grabDirectionTo: uniform(new THREE.Vector3(0, 0, -1)),
    }
  }

  #createPasses() {
    const b = this.#buffers
    const u = this.#uniforms
    const N = this.#N
    const P = this.#P
    const B = this.#bucket
    const T = this.#tableSize
    const ST = this.#segmentTable
    const cellOf = this.#cellOf
    const hashOf = this.#hashOf

    // Particle i into the bucket of x's cell; past a full bucket it is dropped for the frame, and counted.
    const insert = (x, i) => {
      const h = hashOf(cellOf(x)).toVar()
      const slot = atomicAdd(b.hashCounts.element(h), uint(1)).toVar()
      If(slot.lessThan(uint(B)), () => {
        b.hashEntries.element(h.mul(uint(B)).add(slot)).assign(i)
      }).Else(() => {
        this.#countDrop(2)
      })
      atomicMax(b.stats.element(uint(3)), slot.add(uint(1)))
    }

    // 1 storage buffer: stepState
    const begin = Fn(() => {
      b.stepState.element(uint(0)).assign(uint(0))
    })().compute(1)

    // Also restores the rest bends plasticity moved, and restarts the statistics.
    // 7 storage buffers: positions, previous, velocities, rest, support, restLengths, stats
    const respawn = Fn(() => {
      const i = instanceIndex
      If(i.equal(uint(0)), () => {
        for (let k = 0; k < 4; k++) atomicStore(b.stats.element(uint(k)), uint(0))
      })
      const rest = b.rest.element(i).toVar()
      b.positions.element(i).assign(rest)
      b.previous.element(i).assign(rest)
      b.velocities.element(i).assign(vec4(0, 0, 0, rest.w))
      b.support.element(i).assign(vec4(0))
      const k = i.mod(uint(P))
      If(k.greaterThan(uint(0)).and(k.lessThan(uint(P - 1))), () => {
        const before = b.rest.element(i.sub(1)).xyz.toVar()
        const after = b.rest.element(i.add(1)).xyz.toVar()
        const lengths = b.restLengths.element(i)
        const spacing = lengths.z.toVar()
        const chord = max(length(after.sub(before)), spacing.mul(MIN_CHORD))
        const bend = length(before.sub(rest.xyz.mul(2)).add(after))
          .mul(spacing.mul(2))
          .div(chord)
        lengths.assign(vec4(lengths.x, bend, lengths.z, lengths.w))
      })
    })().compute(N)

    // When a grab starts: the anchor's neighbours' offsets, and the anchor.
    // 2 storage buffers: positions, grabState
    const capture = Fn(() => {
      const anchor = int(u.grabParticle).toVar()
      const other = clamp(anchor.add(int(instanceIndex)).sub(1), 0, N - 1)
      const at = b.positions.element(uint(anchor)).xyz.toVar()
      b.grabState.element(instanceIndex).assign(vec4(b.positions.element(uint(other)).xyz.sub(at), 0))
      If(instanceIndex.equal(uint(1)), () => {
        b.grabState.element(uint(3)).assign(vec4(at, 0))
      })
    })().compute(3)

    // Counts the substep, clears the segment hash, and predicts the free motion under gravity; pinned particles
    // stay. `velocities` keeps the predicted velocity for the velocity pass.
    // 5 storage buffers: stepState, segmentCounts, positions, previous, velocities
    const integrate = Fn(() => {
      const i = instanceIndex
      If(i.equal(uint(0)), () => {
        const s = b.stepState.element(uint(0))
        s.assign(s.add(uint(1)))
      })
      Loop({ start: i, end: uint(ST), type: 'uint', condition: '<', update: N }, ({ i: k }) => {
        atomicStore(b.segmentCounts.element(k), uint(0))
      })
      const x = b.positions.element(i).xyz.toVar()
      const state = b.velocities.element(i).toVar()
      const w = state.w
      const v = select(w.greaterThan(0), state.xyz.add(u.gravity.mul(u.h)), vec3(0))
      b.previous.element(i).assign(vec4(x, 0))
      b.positions.element(i).assign(vec4(x.add(v.mul(u.h)), w))
      b.velocities.element(i).assign(vec4(v, w))
    })().compute(N)

    const hashSegments = this.#createSegmentHash()

    const noodles = this.#createNoodlePass()

    const contacts = this.#createContactPass(false)

    // The final particle hash, for partners.
    // 1 storage buffer: hashCounts
    const clearHash = Fn(() => {
      atomicStore(b.hashCounts.element(instanceIndex), uint(0))
    })().compute(T)
    // 4 storage buffers: positions, hashCounts, hashEntries, stats
    const hashParticles = Fn(() => {
      insert(b.positions.element(instanceIndex).xyz.toVar(), instanceIndex)
    })().compute(N)

    // 4 storage buffers: drawnPositions, drawnFrames, positions, frames
    const copyPrevious = Fn(() => {
      const i = instanceIndex
      b.drawnPositions.element(i).assign(b.positions.element(i))
      b.drawnFrames.element(i).assign(b.frames.element(i))
    })().compute(N)

    // One thread per noodle: a twist-free normal carried down the noodle, projected across each new tangent. The
    // first particle starts from last frame's normal, so the frame never jumps.
    // 2 storage buffers: positions, frames
    const frames = Fn(() => {
      const base = instanceIndex.mul(uint(P)).toVar()
      const first = b.positions.element(base.add(1)).xyz.sub(b.positions.element(base).xyz).toVar()
      const firstLength = length(first).toVar()
      const tangent = select(firstLength.greaterThan(1e-9), first.div(firstLength), vec3(0, 0, 1)).toVar()
      const last = b.frames.element(base).xyz.toVar()
      const carried = last.sub(tangent.mul(dot(last, tangent))).toVar()
      const carriedLength = length(carried).toVar()
      const normal = vec3(0).toVar()
      If(carriedLength.greaterThan(1e-3), () => {
        normal.assign(carried.div(carriedLength))
      }).Else(() => {
        normal.assign(perpendicular(tangent))
      })
      b.frames.element(base).assign(vec4(normal, 0))
      Loop({ start: uint(1), end: uint(P), type: 'uint', condition: '<' }, ({ i: k }) => {
        const next = base.add(min(k.add(1), uint(P - 1)))
        const d = b.positions
          .element(next)
          .xyz.sub(b.positions.element(base.add(k).sub(1)).xyz)
          .toVar()
        const dLength = length(d).toVar()
        tangent.assign(select(dLength.greaterThan(1e-9), d.div(dLength), tangent))
        const projected = normal.sub(tangent.mul(dot(normal, tangent))).toVar()
        const projectedLength = length(projected).toVar()
        If(projectedLength.greaterThan(1e-6), () => {
          normal.assign(projected.div(projectedLength))
        })
        b.frames.element(base.add(k)).assign(vec4(normal, 0))
      })
    })().compute(this.#M)

    // pick(): the nearest hit distance by an atomic min on its float bits (non-negative floats order as their bits),
    // then the lowest index at that distance, so any thread order gives one answer.
    // 1 storage buffer: pick
    const pickClear = Fn(() => {
      atomicStore(b.pick.element(uint(0)), uint(0xffffffff))
      atomicStore(b.pick.element(uint(1)), uint(0xffffffff))
    })().compute(1)
    const hitDistance = (i) => {
      const o = b.positions.element(i).xyz.sub(u.pickOrigin).toVar()
      const along = dot(o, u.pickDirection).toVar()
      const off = dot(o, o).sub(along.mul(along)).toVar()
      const r2 = u.pickRadius.mul(u.pickRadius).toVar()
      const half = sqrt(max(r2.sub(off), 0)).toVar()
      const t = select(along.sub(half).greaterThanEqual(0), along.sub(half), along.add(half)).toVar()
      const hit = off.lessThanEqual(r2).and(t.greaterThanEqual(u.pickNear)).and(t.lessThanEqual(u.pickFar))
      return { t, hit }
    }
    // 2 storage buffers: positions, pick
    const pickNearest = Fn(() => {
      const { t, hit } = hitDistance(instanceIndex)
      If(hit, () => {
        atomicMin(b.pick.element(uint(0)), floatBitsToUint(t))
      })
    })().compute(N)
    // 2 storage buffers: positions, pick
    const pickIndex = Fn(() => {
      const { t, hit } = hitDistance(instanceIndex)
      If(hit.and(floatBitsToUint(t).equal(atomicLoad(b.pick.element(uint(0))))), () => {
        atomicMin(b.pick.element(uint(1)), instanceIndex)
      })
    })().compute(N)
    // A grab along a ray starting: as capture, from the picked anchor, plus its distance along the ray.
    // 3 storage buffers: positions, grabState, pick
    const captureRay = Fn(() => {
      const found = atomicLoad(b.pick.element(uint(1))).toVar()
      const hit = found.notEqual(uint(0xffffffff)).toVar()
      const anchor = int(select(hit, found, uint(0))).toVar()
      const other = clamp(anchor.add(int(instanceIndex)).sub(1), 0, N - 1)
      const at = b.positions.element(uint(anchor)).xyz.toVar()
      b.grabState.element(instanceIndex).assign(vec4(b.positions.element(uint(other)).xyz.sub(at), 0))
      If(instanceIndex.equal(uint(1)), () => {
        b.grabState.element(uint(3)).assign(vec4(at, 0))
        const distance = dot(at.sub(u.pickOrigin), u.pickDirection)
        b.grabState.element(uint(4)).assign(vec4(float(anchor), distance, select(hit, float(1), float(0)), 0))
      })
    })().compute(3)

    this.#passes = {
      pickClear,
      pickNearest,
      pickIndex,
      captureRay,
      begin,
      respawn,
      capture,
      integrate,
      hashSegments,
      noodles,
      contacts,
      clearHash,
      hashParticles,
      copyPrevious,
      frames,
    }
    // Named in pipeline labels.
    for (const [key, pass] of Object.entries(this.#passes)) pass.setName(`noodles_${key}`)
  }

  // A dropped hash entry, into statistics count k, saturating short of 2³².
  #countDrop(k) {
    const stats = this.#buffers.stats
    const dropped = atomicLoad(stats.element(uint(k))).toVar()
    If(dropped.lessThan(uint(MAX_DROPPED)), () => {
      atomicAdd(stats.element(uint(k)), uint(1))
    })
  }

  // Hashes each segment by its middle where the substep started; past a full bucket it is dropped for the substep,
  // and counted.
  // 4 storage buffers: previous, segmentCounts, segmentEntries, stats
  #createSegmentHash() {
    const b = this.#buffers
    const P = this.#P
    const SB = this.#segmentBucket
    const segmentCellOf = this.#segmentCellOf
    const segmentHashOf = this.#segmentHashOf
    return Fn(() => {
      const i = instanceIndex
      If(i.mod(uint(P)).lessThan(uint(P - 1)), () => {
        const middle = b.previous
          .element(i)
          .xyz.add(b.previous.element(i.add(1)).xyz)
          .mul(0.5)
          .toVar()
        const h = segmentHashOf(segmentCellOf(middle)).toVar()
        const slot = atomicAdd(b.segmentCounts.element(h), uint(1)).toVar()
        If(slot.lessThan(uint(SB)), () => {
          // Segment index: noodle × (P − 1) + k.
          const segment = i.sub(i.div(uint(P)))
          b.segmentEntries.element(h.mul(uint(SB)).add(slot)).assign(vec4(middle, float(segment)))
        }).Else(() => {
          this.#countDrop(0)
        })
        atomicMax(b.stats.element(uint(1)), slot.add(uint(1)))
      })
    })().compute(this.#N)
  }

  // The noodles pass of a grab along a ray (built on first use).
  #rayNoodlePass() {
    return (this.#passes.noodlesRay ??= this.#createNoodlePass(true).setName('noodles_noodlesRay'))
  }

  // extraPasses as this frame reads it: arrays of compute nodes, else empty.
  #readExtraPasses() {
    const extra = this.extraPasses
    const out = { before: [], substep: [], after: [] }
    if (extra === null || typeof extra !== 'object') {
      this.#warnOnce('extraPasses', 'NoodleSimulation: extraPasses must be { before, substep, after }; using none.')
      return out
    }
    for (const key of Object.keys(out)) {
      const list = extra[key] ?? []
      if (!Array.isArray(list) || !list.every((pass) => pass?.isComputeNode)) {
        this.#warnOnce(`extraPasses:${key}`, `NoodleSimulation: extraPasses.${key} must be an array of compute nodes.`)
        continue
      }
      out[key] = list
    }
    return out
  }

  // contactLanes' contacts pass, built the first time it is on.
  #contactLanesPass() {
    return (this.#passes.contactLanes ??= this.#createContactPass(true).setName('noodles_contactLanes'))
  }

  // colliderCulling's lists, once a frame before the substeps: MASK_WORDS words per noodle in stepState from [1], bit
  // c set when collider c, at its last pose, now or between, comes within cullReach of the box around the noodle's
  // particles. The grabbed noodle (`ray`: the one pick() found) lists every collider. A workgroup of 32 lanes per
  // word, a lane per collider, its bit OR-ed in workgroup memory.
  // 2 storage buffers: positions, stepState (3 with `ray`: grabState)
  #maskPass(ray) {
    const key = ray ? 'colliderMasksRay' : 'colliderMasks'
    if (this.#passes[key]) return this.#passes[key]
    const b = this.#buffers
    const u = this.#uniforms
    const P = this.#P
    const words = this.#M * MASK_WORDS
    const pass = Fn(() => {
      const lane = invocationLocalIndex
      const t = instanceIndex.div(uint(32)).toVar()
      // Past the last word, the lanes of a 2D dispatch's last row: no word.
      const live = t.lessThan(uint(words)).toVar()
      const noodle = t.div(uint(MASK_WORDS)).toVar()
      const c = t.mod(uint(MASK_WORDS)).mul(uint(32)).add(lane).toVar()
      const base = noodle.mul(uint(P)).toVar()
      const low = b.positions.element(base).xyz.toVar()
      const high = vec3(low).toVar()
      Loop({ start: uint(1), end: uint(P), type: 'uint', condition: '<' }, ({ i: k }) => {
        const x = b.positions.element(base.add(k)).xyz.toVar()
        low.assign(min(low, x))
        high.assign(max(high, x))
      })
      const center = low.add(high).mul(0.5).toVar()
      const half = high.sub(low).mul(0.5).toVar()
      const picked = ray ? b.grabState.element(uint(4)).toVar() : null
      const grabParticle = ray ? uint(picked.x) : u.grabParticle
      const grabbed = (
        ray ? u.grabActive.greaterThan(0.5).and(picked.z.greaterThan(0.5)) : u.grabActive.greaterThan(0.5)
      )
        .and(grabParticle.div(uint(P)).equal(noodle))
        .toVar()
      const bits = workgroupArray('uint', 1).toAtomic()
      If(lane.equal(uint(0)), () => {
        atomicStore(bits.element(uint(0)), uint(0))
      })
      workgroupBarrier()
      If(live.and(c.lessThan(u.colliderCount)), () => {
        const k = c.mul(4)
        const now0 = u.colliders.element(k).toVar()
        const now1 = u.colliders.element(k.add(1)).toVar()
        const last0 = u.colliders.element(k.add(2)).toVar()
        const last1 = u.colliders.element(k.add(3)).toVar()
        const type = now1.w
        const distance = float(0).toVar()
        If(type.lessThan(PLANE + 0.5), () => {
          // The box's lowest point over each pose's plane.
          const side = (plane) =>
            dot(plane.xyz, center)
              .sub(dot(abs(plane.xyz), half))
              .add(plane.w)
          distance.assign(min(side(now0), side(last0)))
        }).Else(() => {
          // A Sphere is a one-point Capsule, a Box3 its corners with radius 0.
          const ends = type.greaterThan(SPHERE + 0.5)
          const nowEnd = select(ends, now1.xyz, now0.xyz)
          const lastEnd = select(ends, last1.xyz, last0.xyz)
          const pad = max(now0.w, last0.w)
          const lowest = min(min(now0.xyz, nowEnd), min(last0.xyz, lastEnd)).sub(pad)
          const highest = max(max(now0.xyz, nowEnd), max(last0.xyz, lastEnd)).add(pad)
          const apart = max(max(lowest.sub(high), low.sub(highest)), vec3(0)).toVar()
          const box = type.greaterThan(BOX - 0.5).and(type.lessThan(BOX + 0.5))
          distance.assign(select(box, max(apart.x, max(apart.y, apart.z)), length(apart)))
        })
        If(grabbed.or(distance.lessThanEqual(u.cullReach)), () => {
          atomicOr(bits.element(uint(0)), uint(1).shiftLeft(lane))
        })
      })
      workgroupBarrier()
      If(live.and(lane.equal(uint(0))), () => {
        b.stepState.element(uint(1).add(t)).assign(atomicLoad(bits.element(uint(0))))
      })
    })().compute(words * 32, [32])
    this.#passes[key] = pass.setName(`noodles_${key}`)
    return pass
  }

  // One thread per segment: the capsules near it, through the segment hash. Both threads of a pair compute it in one
  // order, lower segment first, so their pushes are equal and opposite; each moves its own two ends by their
  // barycentric, inverse-mass-weighted share (Bridson et al. 2002), its mass split over its last substep's contacts
  // (Tonge et al. 2012). Coulomb friction on the contact points' slide. A push stops the approach and parts the pair
  // at up to separationSpeed. Also measures, where the substep started, the distance to the nearest other segment.
  // With `lanes` (contactLanes): SEGMENT_LANES threads per segment. With the 27 query cells' buckets laid end to end,
  // lane l takes entries l, l + 32, …, each found in its bucket by a binary search over where the buckets start. A
  // lane skips pairs whose bounding spheres are out of reach (with BOUND_EPSILON of slack), the start distance unless
  // it can lower `nearest` (segment distance is 1-Lipschitz in each end), and the joint test unless the pair touches.
  // The pairs within the bounds queue in workgroup memory for the lanes to take up together, and lane 0 sums the
  // contacts in their entries' order, the one-thread pass's: the same contacts, distances and pushes, to the bit.
  // 7 storage buffers: positions, previous, segmentCounts, segmentEntries, segmentDelta, support, segmentLoad
  #createContactPass(lanes) {
    const b = this.#buffers
    const u = this.#uniforms
    const P = this.#P
    const S = this.#S
    const SB = this.#segmentBucket
    const radius = this.#radius
    const diameter = 2 * radius
    const reach = CONTACT_REACH * this.#maxRadius
    const widest = 2 * this.#maxRadius
    const segmentCell = this.#segmentCell
    const profile = u.radiusProfile
    const segmentSkip = this.#segmentSkip
    const segmentCellOf = this.#segmentCellOf
    const segmentHashOf = this.#segmentHashOf
    // With lanes: SL lanes per segment, CONTACT_LANES / SL segments per workgroup.
    const SL = SEGMENT_LANES
    const groups = CONTACT_LANES / SL
    const contacts = Fn(() => {
      const lane = lanes ? invocationLocalIndex.mod(uint(SL)).toVar() : invocationLocalIndex
      // This segment's share of the workgroup's arrays.
      const part = lanes ? invocationLocalIndex.div(uint(SL)).toVar() : null
      const g = lanes ? instanceIndex.div(uint(SL)).toVar() : instanceIndex
      const noodle = g.div(uint(P - 1)).toVar()
      const i0 = g.add(noodle).toVar()
      const A0 = b.positions.element(i0).toVar()
      const A1 = b.positions.element(i0.add(1)).toVar()
      const gA0 = b.support.element(i0).toVar()
      const gA1 = b.support.element(i0.add(1)).toVar()
      const a0 = b.previous.element(i0).xyz.toVar()
      const a1 = b.previous.element(i0.add(1)).xyz.toVar()
      const middle = a0.add(a1).mul(0.5).toVar()
      const cell = segmentCellOf(middle).toVar()
      // Mass splitting: each of a segment's contacts sees its inverse mass times their number.
      const ownLoad = max(b.segmentLoad.element(g), 1).toVar()
      const push0 = vec3(0).toVar()
      const push1 = vec3(0).toVar()
      const slip0 = vec3(0).toVar()
      const slip1 = vec3(0).toVar()
      const found = float(0).toVar()
      const nearest = float(reach).toVar()
      // The lanes' bounds: this segment's half-length at the start and now, its middle now, the most an end moved,
      // and reach and the widest contact with the slack.
      let own = null
      if (lanes) {
        const slack = length(middle).add(segmentCell).mul(BOUND_EPSILON).toVar()
        own = {
          half: length(a1.sub(a0)).mul(0.5).toVar(),
          middleNow: A0.xyz.add(A1.xyz).mul(0.5).toVar(),
          halfNow: length(A1.xyz.sub(A0.xyz)).mul(0.5).toVar(),
          moved: max(length(A0.xyz.sub(a0)), length(A1.xyz.sub(a1))).toVar(),
          reach: slack.add(reach).toVar(),
          contact: slack.add(widest).toVar(),
        }
      }
      // Pairs of one noodle this close along it never touch.
      const near = (p, q) => abs(int(p).sub(int(q))).lessThanEqual(segmentSkip)
      // Query cell c (an int, 0–26) around this segment's.
      const queryOf = (c) => cell.add(ivec3(c.mod(3).sub(1), c.div(3).mod(3).sub(1), c.div(9).sub(1))).toVar()
      // With lanes: the segment's share of the workgroup's arrays, and the entry's place in the one-thread order (key).
      let shared = null
      let key = null
      // Segment `other` (of noodle otherNoodle) against this one. `queued`, with lanes: a pair within the bounds goes
      // to the queue, which the lanes take up once every bucket is searched, unless it is full.
      const examine = (other, otherNoodle, sameNoodle, queued) => {
        const j0 = other.add(otherNoodle).toVar()
        const B0 = b.positions.element(j0).toVar()
        const B1 = b.positions.element(j0.add(1)).toVar()
        const b0 = b.previous.element(j0).xyz.toVar()
        const b1 = b.previous.element(j0.add(1)).xyz.toVar()
        // `bounds`, with lanes: the bounding spheres' distances at the start and now.
        const pair = (bounds) => {
          // The pair in one order, lower segment (P) first.
          const swap = other.lessThan(g).toVar()
          const P0 = select(swap, B0, A0).toVar()
          const P1 = select(swap, B1, A1).toVar()
          const Q0 = select(swap, A0, B0).toVar()
          const Q1 = select(swap, A1, B1).toVar()
          const p0 = select(swap, b0, a0).toVar()
          const p1 = select(swap, b1, a1).toVar()
          const q0 = select(swap, a0, b0).toVar()
          const q1 = select(swap, a1, b1).toVar()

          const measureStart = () => {
            const start = closestOnSegments(p0, p1, q0, q1).toVar()
            nearest.assign(min(nearest, length(mix(p0, p1, start.x).sub(mix(q0, q1, start.y)))))
          }
          if (!bounds) measureStart()

          const st = closestOnSegments(P0.xyz, P1.xyz, Q0.xyz, Q1.xyz).toVar()
          const s = st.x
          const t = st.y
          const pA = mix(P0.xyz, P1.xyz, s).toVar()
          const pB = mix(Q0.xyz, Q1.xyz, t).toVar()
          const d = pA.sub(pB).toVar()
          const distance = length(d).toVar()
          if (bounds) {
            // `distance` is exact unless closestOnSegments blends toward the overlap's middle (skew under 0.01).
            const d1 = P1.xyz.sub(P0.xyz)
            const d2 = Q1.xyz.sub(Q0.xyz)
            const ae = max(dot(d1, d1), 1e-30)
              .mul(max(dot(d2, d2), 1e-30))
              .toVar()
            const be = dot(d1, d2)
            const exact = ae.sub(be.mul(be)).greaterThanEqual(ae.mul(0.01))
            const now = select(exact, distance, bounds.now)
            const movedB = max(length(B0.xyz.sub(b0)), length(B1.xyz.sub(b1)))
            const startLower = max(bounds.start, now.sub(own.moved).sub(movedB))
            If(startLower.greaterThanEqual(own.reach).not(), measureStart)
          }
          // Near a joint both segments sharing it see the same contact; one counts. A contact at a segment's end is
          // the next segment's; one at its start, the previous segment's when that one has it inside. Both read it
          // from the closest points computed in the same order, so they agree to the bit.
          const lower = select(swap, other, g).toVar()
          const upper = select(swap, g, other).toVar()
          const joint = float(0).toVar()
          const atJoint = (segment, along, start, a0, q0, q1, partner) => {
            const local = segment.mod(uint(P - 1)).toVar()
            If(
              along
                .greaterThan(1 - 1e-6)
                .and(local.lessThan(uint(P - 2)))
                .and(sameNoodle.and(near(segment.add(1), partner)).not()),
              () => {
                joint.assign(1)
              },
            )
            If(
              along
                .lessThan(1e-6)
                .and(local.greaterThan(uint(0)))
                .and(sameNoodle.and(near(segment.sub(1), partner)).not()),
              () => {
                const before = b.positions.element(start.sub(1)).xyz.toVar()
                const inside = float(0).toVar()
                If(segment.sub(1).lessThan(partner), () => {
                  inside.assign(closestOnSegments(before, a0, q0, q1).x)
                }).Else(() => {
                  inside.assign(closestOnSegments(q0, q1, before, a0).y)
                })
                If(inside.lessThanEqual(1 - 1e-6), () => {
                  joint.assign(1)
                })
              },
            )
          }
          const joints = () => {
            atJoint(lower, s, select(swap, j0, i0), P0.xyz, Q0.xyz, Q1.xyz, upper)
            atJoint(upper, t, select(swap, i0, j0), Q0.xyz, P0.xyz, P1.xyz, lower)
          }
          if (!bounds) joints()
          // The two radii at the closest points, summed.
          let contact = diameter
          if (profile) {
            const along = (segment, at) => {
              const k = segment.mod(uint(P - 1)).toVar()
              return mix(profile.element(k), profile.element(k.add(1)), at)
            }
            contact = along(lower, s).add(along(upper, t)).mul(radius).toVar()
          }
          const respond = () => {
            const n = d.div(distance).toVar()
            const gB0 = b.support.element(j0).toVar()
            const gB1 = b.support.element(j0.add(1)).toVar()
            const gP0 = select(swap, gB0, gA0)
            const gP1 = select(swap, gB1, gA1)
            const gQ0 = select(swap, gA0, gB0)
            const gQ1 = select(swap, gA1, gB1)
            const wA = float(1)
              .sub(s)
              .mul(float(1).sub(s))
              .mul(massAlong(P0.w, n, gP0))
              .add(s.mul(s).mul(massAlong(P1.w, n, gP1)))
            const wB = float(1)
              .sub(t)
              .mul(float(1).sub(t))
              .mul(massAlong(Q0.w, n.negate(), gQ0))
              .add(t.mul(t).mul(massAlong(Q1.w, n.negate(), gQ1)))
            const otherLoad = max(b.segmentLoad.element(other), 1)
            const loadP = select(swap, otherLoad, ownLoad)
            const loadQ = select(swap, ownLoad, otherLoad)
            const weight = wA.mul(loadP).add(wB.mul(loadQ)).toVar()
            If(weight.greaterThan(1e-12), () => {
              const scale = float(1).div(weight).toVar()
              const depth = float(contact).sub(distance).mul(u.contactStiffness).toVar()
              // Where the contact points were when the substep started.
              const pA0 = mix(p0, p1, s)
              const pB0 = mix(q0, q1, t)
              // Stop the approach and part at up to separationSpeed, counting the speed they already part at.
              depth.assign(min(depth, max(length(pA0.sub(pB0)).sub(distance).add(u.separation), 0)))
              const slide = pA.sub(pA0).sub(pB.sub(pB0)).toVar()
              const tangential = slide.sub(n.mul(dot(slide, n))).toVar()
              const slideLength = length(tangential).toVar()
              const impulse = n.mul(depth).mul(scale).toVar()
              // Friction's own effective mass, along the slide it removes.
              const across = tangential.div(max(slideLength, 1e-30)).toVar()
              const wAt = float(1)
                .sub(s)
                .mul(float(1).sub(s))
                .mul(massAlong(P0.w, across.negate(), gP0))
                .add(s.mul(s).mul(massAlong(P1.w, across.negate(), gP1)))
              const wBt = float(1)
                .sub(t)
                .mul(float(1).sub(t))
                .mul(massAlong(Q0.w, across, gQ0))
                .add(t.mul(t).mul(massAlong(Q1.w, across, gQ1)))
              const slip = across
                .mul(min(slideLength, u.contactFriction.mul(depth)).negate())
                .div(max(wAt.mul(loadP).add(wBt.mul(loadQ)), 1e-12))
                .toVar()
              // This thread's side: P pushes along +n, Q along −n.
              const sign = select(swap, float(-1), float(1))
              const along = select(swap, t, s).toVar()
              const share0 = sign.mul(float(1).sub(along)).mul(A0.w).toVar()
              const share1 = sign.mul(along).mul(A1.w).toVar()
              // A support only removes directions, so against a side that can't give way the push left grows
              // without bound: the contact point moves at most the overlap, each end at most the overlap /
              // max(s, 1 − s), and friction likewise the slide.
              const farther = max(along, float(1).sub(along)).toVar()
              const moved0 = unsupported(impulse.mul(share0), gA0).toVar()
              const moved1 = unsupported(impulse.mul(share1), gA1).toVar()
              const moved = max(
                length(moved0.mul(float(1).sub(along)).add(moved1.mul(along))),
                max(length(moved0), length(moved1)).mul(farther),
              )
              const limit = min(float(1), depth.div(max(moved, 1e-30))).toVar()
              const slid0 = unsupported(slip.mul(share0), gA0).toVar()
              const slid1 = unsupported(slip.mul(share1), gA1).toVar()
              const slid = max(
                length(slid0.mul(float(1).sub(along)).add(slid1.mul(along))),
                max(length(slid0), length(slid1)).mul(farther),
              )
              const slipLimit = min(float(1), min(slideLength, u.contactFriction.mul(depth)).div(max(slid, 1e-30)))
              if (shared) {
                const c0 = moved0.mul(limit).toVar()
                const c1 = moved1.mul(limit).toVar()
                const s0 = slid0.mul(slipLimit).toVar()
                const s1 = slid1.mul(slipLimit).toVar()
                const slot = atomicAdd(shared.tally(0), uint(1)).toVar()
                If(slot.lessThan(uint(SL)), () => {
                  shared.key(slot).assign(key)
                  shared.contact(0, slot).assign(vec4(c0, s0.x))
                  shared.contact(1, slot).assign(vec4(c1, s0.y))
                  shared.contact(2, slot).assign(vec4(s1, s0.z))
                })
                push0.addAssign(c0)
                push1.addAssign(c1)
                slip0.addAssign(s0)
                slip1.addAssign(s1)
              } else {
                push0.addAssign(moved0.mul(limit))
                push1.addAssign(moved1.mul(limit))
                slip0.addAssign(slid0.mul(slipLimit))
                slip1.addAssign(slid1.mul(slipLimit))
              }
              found.addAssign(1)
            })
          }
          const within = distance
            .lessThan(contact)
            .and(distance.greaterThan(profile ? contact.mul(1e-6) : diameter * 1e-6))
          if (bounds) {
            // The joint test only tells touching pairs apart.
            If(within, () => {
              joints()
              If(joint.lessThan(0.5), respond)
            })
          } else {
            const touching = within.and(joint.lessThan(0.5))
            If(touching, respond)
          }
        }
        if (lanes) {
          // Every point of a segment is within half its length of its middle.
          const start = length(b0.add(b1).mul(0.5).sub(middle))
            .sub(own.half)
            .sub(length(b1.sub(b0)).mul(0.5))
            .toVar()
          const now = length(B0.xyz.add(B1.xyz).mul(0.5).sub(own.middleNow))
            .sub(own.halfNow)
            .sub(length(B1.xyz.sub(B0.xyz)).mul(0.5))
            .toVar()
          If(start.greaterThanEqual(own.reach).and(now.greaterThanEqual(own.contact)).not(), () => {
            if (queued) {
              const slot = atomicAdd(shared.tally(2), uint(1)).toVar()
              If(slot.lessThan(uint(QUEUE)), () => {
                shared.queue(slot, 0).assign(other)
                shared.queue(slot, 1).assign(key)
              }).Else(() => {
                pair({ start, now })
              })
            } else {
              pair({ start, now })
            }
          })
        } else {
          pair(null)
        }
      }
      // One entry of query cell `query`'s bucket.
      const visit = (entry, query) => {
        const other = uint(entry.w).toVar()
        const otherNoodle = other.div(uint(P - 1)).toVar()
        const sameNoodle = otherNoodle.equal(noodle).toVar()
        const offset = entry.xyz.sub(middle)
        // Only the entry's own cell counts it: two query cells can share a bucket.
        const eCell = segmentCellOf(entry.xyz)
        const inCell = eCell.x.equal(query.x).and(eCell.y.equal(query.y)).and(eCell.z.equal(query.z))
        const candidate = inCell
          .and(other.notEqual(g))
          .and(sameNoodle.and(near(other, g)).not())
          .and(dot(offset, offset).lessThan(segmentCell * segmentCell))
        If(candidate, () => {
          examine(other, otherNoodle, sameNoodle, lanes)
        })
      }
      if (lanes) {
        // Past S, the threads of a 2D dispatch's last row: no segment.
        const live = g.lessThan(uint(S)).toVar()
        const arrays = {
          counts: workgroupArray('uint', 27 * groups),
          hashes: workgroupArray('uint', 27 * groups),
          offsets: workgroupArray('uint', 28 * groups),
          keys: workgroupArray('uint', CONTACT_LANES),
          // A contact's pushes: (end 0's, slip 0's x), (end 1's, slip 0's y), (slip 1's, slip 0's z).
          contacts: [0, 1, 2].map(() => workgroupArray('vec4', CONTACT_LANES)),
          // The pairs within the bounds, for the lanes to take up together: (other segment, key) each.
          queue: workgroupArray('uint', 2 * QUEUE * groups),
          // Per segment: its contacts, the bits of its nearest distance (non-negative: they order as the floats), and
          // the pairs queued.
          tally: workgroupArray('uint', 3 * groups).toAtomic(),
        }
        // This segment's elements: SL contacts and QUEUE pairs a segment.
        shared = {
          count: (c) => arrays.counts.element(part.mul(27).add(c)),
          hash: (c) => arrays.hashes.element(part.mul(27).add(c)),
          offset: (c) => arrays.offsets.element(part.mul(28).add(c)),
          key: (j) => arrays.keys.element(part.mul(SL).add(j)),
          contact: (r, j) => arrays.contacts[r].element(part.mul(SL).add(j)),
          queue: (j, w) => arrays.queue.element(part.mul(QUEUE).add(j).mul(2).add(w)),
          tally: (j) => arrays.tally.element(part.mul(3).add(j)),
        }
        // Query cell c's bucket and how many entries it holds.
        Loop({ start: lane, end: uint(27), type: 'uint', condition: '<', update: SL }, ({ i: c }) => {
          const h = segmentHashOf(queryOf(int(c))).toVar()
          shared.hash(c).assign(h)
          shared.count(c).assign(min(atomicLoad(b.segmentCounts.element(h)), uint(SB)))
        })
        If(lane.equal(uint(0)), () => {
          atomicStore(shared.tally(0), uint(0))
          atomicStore(shared.tally(1), floatBitsToUint(float(reach)))
          atomicStore(shared.tally(2), uint(0))
          shared.offset(uint(0)).assign(uint(0))
        })
        workgroupBarrier()
        // The buckets laid end to end: where each starts.
        If(lane.equal(uint(0)), () => {
          const end = uint(0).toVar()
          Loop(27, ({ i: c }) => {
            end.addAssign(shared.count(c))
            shared.offset(uint(c).add(1)).assign(end)
          })
        })
        workgroupBarrier()
        const entries = shared.offset(uint(27)).toVar()
        If(live, () => {
          Loop({ start: lane, end: entries, type: 'uint', condition: '<', update: SL }, ({ i: k }) => {
            // The bucket entry k lies in: the last that starts at or before it.
            const c = uint(0).toVar()
            for (const step of [16, 8, 4, 2, 1]) {
              const next = c.add(uint(step)).toVar()
              const starts = shared.offset(min(next, uint(27)))
              c.assign(select(next.lessThanEqual(uint(26)).and(starts.lessThanEqual(k)), next, c))
            }
            const at = shared.offset(c)
            const entry = b.segmentEntries.element(shared.hash(c).mul(uint(SB)).add(k.sub(at))).toVar()
            key = k
            visit(entry, queryOf(int(c)))
          })
        })
        // The queued pairs, taken up together.
        workgroupBarrier()
        const queued = min(atomicLoad(shared.tally(2)), uint(QUEUE)).toVar()
        If(live, () => {
          Loop({ start: lane, end: queued, type: 'uint', condition: '<', update: SL }, ({ i: j }) => {
            const other = shared.queue(j, 0).toVar()
            key = shared.queue(j, 1).toVar()
            const otherNoodle = other.div(uint(P - 1)).toVar()
            examine(other, otherNoodle, otherNoodle.equal(noodle).toVar(), false)
          })
        })
        atomicMin(shared.tally(1), floatBitsToUint(nearest))
        workgroupBarrier()
        const kept = atomicLoad(shared.tally(0)).toVar()
        const spilled = kept.greaterThan(uint(SL)).toVar()
        const closest = uintBitsToFloat(atomicLoad(shared.tally(1))).toVar()
        const writeLanes = (sum0, sum1) => {
          const o = g.mul(uint(2)).toVar()
          b.segmentDelta.element(o).assign(vec4(select(isFinite3(sum0), sum0, vec3(0)), float(kept)))
          b.segmentDelta.element(o.add(1)).assign(vec4(select(isFinite3(sum1), sum1, vec3(0)), closest))
        }
        // Lane 0 adds the contacts up in the one-thread order: by their entries' place among the buckets laid end to
        // end.
        If(lane.equal(uint(0)).and(live).and(spilled.not()), () => {
          const sum0 = vec3(0).toVar()
          const sum1 = vec3(0).toVar()
          const slipSum0 = vec3(0).toVar()
          const slipSum1 = vec3(0).toVar()
          const after = int(-1).toVar()
          Loop(kept, () => {
            const next = uint(0xffffffff).toVar()
            const at = uint(0).toVar()
            Loop(kept, ({ i: j }) => {
              const placed = shared.key(j).toVar()
              If(int(placed).greaterThan(after).and(placed.lessThan(next)), () => {
                next.assign(placed)
                at.assign(j)
              })
            })
            after.assign(int(next))
            const q0 = shared.contact(0, at).toVar()
            const q1 = shared.contact(1, at).toVar()
            const q2 = shared.contact(2, at).toVar()
            sum0.addAssign(q0.xyz)
            sum1.addAssign(q1.xyz)
            slipSum0.addAssign(vec3(q0.w, q1.w, q2.w))
            slipSum1.addAssign(q2.xyz)
          })
          sum0.addAssign(slipSum0)
          sum1.addAssign(slipSum1)
          writeLanes(sum0, sum1)
        })
        workgroupBarrier()
        // Past SL contacts, each lane's own sums, added up in lane order.
        If(spilled, () => {
          shared.contact(0, lane).assign(vec4(push0, slip0.x))
          shared.contact(1, lane).assign(vec4(push1, slip0.y))
          shared.contact(2, lane).assign(vec4(slip1, slip0.z))
        })
        workgroupBarrier()
        If(lane.equal(uint(0)).and(live).and(spilled), () => {
          const sum0 = vec3(0).toVar()
          const sum1 = vec3(0).toVar()
          const slipSum0 = vec3(0).toVar()
          const slipSum1 = vec3(0).toVar()
          Loop(SL, ({ i: j }) => {
            const q0 = shared.contact(0, uint(j)).toVar()
            const q1 = shared.contact(1, uint(j)).toVar()
            const q2 = shared.contact(2, uint(j)).toVar()
            sum0.addAssign(q0.xyz)
            sum1.addAssign(q1.xyz)
            slipSum0.addAssign(vec3(q0.w, q1.w, q2.w))
            slipSum1.addAssign(q2.xyz)
          })
          sum0.addAssign(slipSum0)
          sum1.addAssign(slipSum1)
          writeLanes(sum0, sum1)
        })
      } else {
        Loop(27, ({ i: c }) => {
          const query = queryOf(c)
          const h = segmentHashOf(query).toVar()
          // Materialized: an atomic used straight as a Loop bound compiles to nothing.
          const count = min(atomicLoad(b.segmentCounts.element(h)), uint(SB)).toVar()
          Loop(count, ({ i: e }) => {
            visit(b.segmentEntries.element(h.mul(uint(SB)).add(e)).toVar(), query)
          })
        })
        push0.addAssign(slip0)
        push1.addAssign(slip1)
        const o = g.mul(uint(2)).toVar()
        b.segmentDelta.element(o).assign(vec4(select(isFinite3(push0), push0, vec3(0)), found))
        b.segmentDelta.element(o.add(1)).assign(vec4(select(isFinite3(push1), push1, vec3(0)), nearest))
      }
    })()
    return lanes ? contacts.compute(Math.ceil(S / groups) * CONTACT_LANES, [CONTACT_LANES]) : contacts.compute(S)
  }

  // One workgroup per noodle, its particles in workgroup memory and the serial solve on its first thread; one thread
  // per noodle on the storage buffers when a noodle is too long for workgroup memory.
  // 1. Drag on the substep's motion, along and across the noodle; then the grab, swept over the substeps.
  // 2. Bending: a constraint per interior particle on 2s̄ · |x₋ − 2x + x₊| / |x₊ − x₋| = 2s̄ · tan(θ/2), the discrete
  //    curvature of Bergou et al. 2008, stiffening toward a hairpin so noodles don't kink. Constraints three particles
  //    apart share none: three colours in turn (Gauss-Seidel), reversed every other sweep so neither end leads. λ
  //    accumulates over a substep's sweeps (XPBD), damped as in Macklin et al. 2016, eq. 26; plastic flow past the
  //    threshold.
  // 3. Stretch: every stretch constraint at once, one Newton step on the tridiagonal (J W Jᵀ + α̃) Δλ = −C (Thomas
  //    algorithm, Han and Harada 2013; compliance as in Deul et al. 2018), so a pull at one end reaches the other
  //    within the substep. W_k = w_k (I − σ_k g_k g_kᵀ): a particle held up by a collider (normal g) that its stretch
  //    constraints would push into it doesn't move into it (σ = 1).
  // 4. Writes the noodle back, and `delta` at 0 for the partners.
  // 7 storage buffers in workgroup memory (positions, previous, delta, restLengths, grabState, stepState, support),
  // 8 without (+ solve). `ray`: a grab along a ray, its anchor and distance from the pick in grabState[4].
  #createNoodlePass(ray = false) {
    const b = this.#buffers
    const u = this.#uniforms
    const P = this.#P
    const shared = this.#sharedNoodles
    const workgroup = this.#noodleWorkgroup
    const hook = this.#noodleHook
    return Fn(() => {
      const lane = shared ? localId.x : uint(0)
      const noodle = shared ? workgroupId.x : instanceIndex
      const base = noodle.mul(uint(P)).toVar()
      // Particle k of the noodle: position and inverse mass (x), where the substep started (start), support, rest
      // lengths (rest), and the solves' scratch: row (normal, pivot) and solve (rhs, lower, held, bend λ).
      let mem
      if (shared) {
        const arrays = ['x', 'start', 'support', 'rest', 'row', 'solve'].map(() => workgroupArray('vec4', P))
        const [x, start, support, rest, row, solve] = arrays
        mem = {
          x: (k) => x.element(k),
          start: (k) => start.element(k),
          support: (k) => support.element(k),
          rest: (k) => rest.element(k),
          row: (k) => row.element(k),
          solve: (k) => solve.element(k),
        }
      } else {
        const at = (buffer) => (k) => buffer.element(base.add(k))
        mem = {
          x: at(b.positions),
          start: at(b.previous),
          support: at(b.support),
          rest: at(b.restLengths),
          row: at(b.delta),
          solve: at(b.solve),
        }
      }
      // Every particle of the noodle, spread over the workgroup.
      const each = (body) =>
        Loop({ start: lane, end: uint(P), type: 'uint', condition: '<', update: shared ? workgroup : 1 }, ({ i: k }) =>
          body(k),
        )
      const sync = () => {
        if (shared) workgroupBarrier()
      }

      if (shared) {
        each((k) => {
          const i = base.add(k).toVar()
          mem.x(k).assign(b.positions.element(i))
          mem.start(k).assign(b.previous.element(i))
          mem.support(k).assign(b.support.element(i))
          mem.rest(k).assign(b.restLengths.element(i))
        })
        sync()
      }

      // What options.noodleHook emits its TSL with.
      const context = hook
        ? {
            mem,
            each,
            sync,
            lane,
            noodle,
            base,
            P,
            shared,
            workgroupSize: shared ? workgroup : 1,
            radiusOf: (k) => this.#radiusOf(k),
            nodes: this.nodes,
          }
        : null

      // 1. Drag, then the grab.
      const picked = ray ? b.grabState.element(uint(4)).toVar() : null
      const grabParticle = ray ? uint(picked.x) : u.grabParticle
      const anchor = int(grabParticle).sub(int(base)).toVar()
      const grabbing = (
        ray ? u.grabActive.greaterThan(0.5).and(picked.z.greaterThan(0.5)) : u.grabActive.greaterThan(0.5)
      )
        .and(grabParticle.div(uint(P)).equal(noodle))
        .toVar()
      const progress = float(b.stepState.element(uint(0)))
        .div(float(u.substeps))
        .toVar()
      // Along a ray: at the pick's distance, on the ray swept over the substeps.
      const swept = ray
        ? mix(u.grabFrom, u.grabTo, progress).add(
            normalize(mix(u.grabDirectionFrom, u.grabDirectionTo, progress)).mul(picked.y),
          )
        : mix(u.grabFrom, u.grabTo, progress)
      const target = select(u.grabHasTarget.greaterThan(0.5), swept, b.grabState.element(uint(3)).xyz).toVar()
      each((k) => {
        const here = mem.start(k).xyz.toVar()
        const axis = mem
          .start(min(k.add(1), uint(P - 1)))
          .xyz.sub(mem.start(select(k.greaterThan(uint(0)), k.sub(1), uint(0))).xyz)
          .toVar()
        const axisLength = length(axis).toVar()
        const p = mem.x(k).toVar()
        const motion = p.xyz.sub(here).toVar()
        const tangent = select(axisLength.greaterThan(1e-9), axis.div(axisLength), vec3(0)).toVar()
        const along = tangent.mul(dot(motion, tangent)).toVar()
        const dragged = here.add(along.mul(u.drag).add(motion.sub(along).mul(u.normalDrag))).toVar()
        // Pinned particles keep their place.
        const x = select(p.w.greaterThan(0), dragged, p.xyz).toVar()
        const w = p.w.toVar()
        const offset = int(k).sub(anchor).toVar()
        If(grabbing.and(abs(offset).lessThanEqual(1)).and(w.greaterThan(0)), () => {
          // Never into the ground or a collider: the solves would pull the neighbours in after it.
          const held = this.#outside(
            target.add(b.grabState.element(uint(offset.add(1))).xyz),
            progress,
            this.#radiusOf(k),
          )
          x.assign(mix(x, held, u.grabStiffness))
          w.assign(w.mul(float(1).sub(u.grabStiffness)))
        })
        mem.x(k).assign(vec4(x, w))
      })
      sync()

      // 2. Bending, in three colours.
      if (P >= 3) {
        Loop(u.bendingIterations, ({ i: sweep }) => {
          // Materialized: nested Loops all name their index i, so an inner one shadows `sweep`.
          const firstSweep = sweep.equal(0).toVar()
          const reverse = sweep.mod(2).equal(1).toVar()
          for (const order of [0, 1, 2]) {
            const color = select(reverse, uint(2 - order), uint(order)).toVar()
            Loop(
              {
                start: lane,
                end: uint(Math.ceil((P - 2) / 3)),
                type: 'uint',
                condition: '<',
                update: shared ? workgroup : 1,
              },
              ({ i: m }) => {
                const center = m.mul(3).add(color).add(1).toVar()
                If(center.lessThanEqual(uint(P - 2)), () => {
                  const xa = mem.x(center.sub(1)).toVar()
                  const xb = mem.x(center).toVar()
                  const xc = mem.x(center.add(1)).toVar()
                  const v = xa.xyz.sub(xb.xyz.mul(2)).add(xc.xyz).toVar()
                  const chord = xc.xyz.sub(xa.xyz).toVar()
                  const spacing = mem.rest(center).z.toVar()
                  const bend = length(v).toVar()
                  const chord2 = dot(chord, chord).toVar()
                  // 1 / the chord, at least MIN_CHORD × the spacing.
                  const acrossInverse = inverseSqrt(
                    max(chord2, spacing.mul(spacing).mul(MIN_CHORD * MIN_CHORD)),
                  ).toVar()
                  // 2s̄ · tan(θ/2): for equal segments |v| = 2s · sin(θ/2) and the chord is 2s · cos(θ/2).
                  const scale = spacing.mul(2).mul(acrossInverse).toVar()
                  const curvature = bend.mul(scale).toVar()
                  // λ accumulates over a substep's sweeps; written every sweep, a skipped constraint's too.
                  const lambda = select(firstSweep, float(0), mem.solve(center).w).toVar()
                  const dLambda = float(0).toVar()
                  // Plastic flow, once a substep.
                  If(firstSweep.and(u.plasticity.greaterThan(0)), () => {
                    const lengths = mem.rest(center).toVar()
                    const strain = curvature.sub(lengths.y).toVar()
                    const excess = max(abs(strain).sub(u.plasticityThreshold.mul(spacing)), 0)
                    const flow = select(strain.greaterThan(0), excess, excess.negate()).mul(u.plasticity)
                    mem.rest(center).assign(vec4(lengths.x, max(lengths.y.add(flow), 0), lengths.z, lengths.w))
                  })
                  If(curvature.greaterThan(1e-9), () => {
                    const n = v.div(bend).toVar()
                    const lengths = mem.rest(center).toVar()
                    const C = curvature.sub(lengths.y)
                    // ∇C: along n at all three, and the ends' share of the chord's change.
                    const tilt = chord.mul(inverseSqrt(max(chord2, 1e-18)).mul(bend).mul(acrossInverse)).toVar()
                    const gradA = n.add(tilt).mul(scale).toVar()
                    const gradB = n.mul(scale.mul(-2)).toVar()
                    const gradC = n.sub(tilt).mul(scale).toVar()
                    const rate = dot(gradA, xa.xyz.sub(mem.start(center.sub(1)).xyz))
                      .add(dot(gradB, xb.xyz.sub(mem.start(center).xyz)))
                      .add(dot(gradC, xc.xyz.sub(mem.start(center.add(1)).xyz)))
                    // A supported particle isn't bent into its support: the part of its correction (along ±∇C,
                    // with the sign λ will take) into it is dropped.
                    const ga = mem.support(center.sub(1)).toVar()
                    const gb = mem.support(center).toVar()
                    const gc = mem.support(center.add(1)).toVar()
                    const sign = select(C.greaterThan(0), float(-1), float(1)).toVar()
                    // w |∇C|², less the part into the support (massAlong, along ∇C rather than a unit vector).
                    const mobility = (w, grad, g) => {
                      const into = min(dot(grad, g.xyz).mul(sign), 0)
                      return w.mul(dot(grad, grad).sub(g.w.mul(into).mul(into)))
                    }
                    const W = mobility(xa.w, gradA, ga)
                      .add(mobility(xb.w, gradB, gb))
                      .add(mobility(xc.w, gradC, gc))
                    const quartic = spacing.mul(spacing).toVar()
                    quartic.mulAssign(quartic)
                    const alpha = u.bendAlpha.mul(quartic)
                    const gamma = u.bendGamma.mul(quartic)
                    dLambda.assign(
                      C.negate()
                        .sub(alpha.mul(lambda))
                        .sub(gamma.mul(rate))
                        .div(max(gamma.add(1).mul(W).add(alpha), 1e-30)),
                    )
                    mem.x(center.sub(1)).assign(vec4(xa.xyz.add(unsupported(gradA.mul(dLambda.mul(xa.w)), ga)), xa.w))
                    mem.x(center).assign(vec4(xb.xyz.add(unsupported(gradB.mul(dLambda.mul(xb.w)), gb)), xb.w))
                    mem.x(center.add(1)).assign(vec4(xc.xyz.add(unsupported(gradC.mul(dLambda.mul(xc.w)), gc)), xc.w))
                  })
                  mem.solve(center).assign(vec4(0, 0, 0, lambda.add(dLambda)))
                })
              },
            )
            sync()
          }
          if (hook) {
            hook('bend', { ...context, firstSweep, sweepReversed: reverse })
            sync()
          }
        })
      }

      // 3. Which firmly supported particles the stretch constraints push into their support (solve.z: held).
      each((k) => {
        const g = mem.support(k).toVar()
        const x = mem.x(k).xyz.toVar()
        const push = vec3(0).toVar()
        If(k.greaterThan(uint(0)), () => {
          const edge = x.sub(mem.x(k.sub(1)).xyz).toVar()
          const distance = max(length(edge), 1e-9)
          push.addAssign(edge.div(distance).mul(mem.rest(k.sub(1)).x.sub(distance)))
        })
        If(k.lessThan(uint(P - 1)), () => {
          const edge = mem.x(k.add(1)).xyz.sub(x).toVar()
          const distance = max(length(edge), 1e-9)
          push.addAssign(edge.div(distance).mul(distance.sub(mem.rest(k).x)))
        })
        const pressed = g.w.greaterThan(0.5).and(dot(push, g.xyz).lessThan(0))
        const kept = mem.solve(k).toVar()
        mem.solve(k).assign(vec4(kept.xy, select(pressed, float(1), float(0)), kept.w))
      })
      sync()

      If(lane.equal(uint(0)), () => {
        const held = (k) => vec4(mem.support(k).xyz, mem.support(k).w.mul(mem.solve(k).z))
        // n·W·n and the part of a correction a held particle takes.
        const along = (w, g, n) => w.mul(float(1).sub(g.w.mul(dot(n, g.xyz)).mul(dot(n, g.xyz))))
        const keep = (d, g) => d.sub(g.xyz.mul(g.w.mul(dot(d, g.xyz))))
        // Forward sweep: row j couples x_j and x_j+1; its off-diagonal with row j − 1 is −n_j·W_j·n_j−1.
        const x0 = mem.x(uint(0)).xyz.toVar()
        const w0 = mem.x(uint(0)).w.toVar()
        const g0 = held(uint(0)).toVar()
        const x1 = vec3(0).toVar()
        const w1 = float(0).toVar()
        const g1 = vec4(0).toVar()
        const normalBefore = vec3(0).toVar()
        const pivotBefore = float(1).toVar()
        const rhsBefore = float(0).toVar()
        Loop({ start: uint(0), end: uint(P - 1), type: 'uint', condition: '<' }, ({ i: j }) => {
          const p = mem.x(j.add(1)).toVar()
          x1.assign(p.xyz)
          w1.assign(p.w)
          g1.assign(held(j.add(1)))
          const edge = x1.sub(x0).toVar()
          const distance = length(edge).toVar()
          const normal = select(distance.greaterThan(1e-9), edge.div(distance), vec3(0, 1, 0)).toVar()
          const lengths = mem.rest(j).toVar()
          const C = distance.sub(lengths.x).toVar()
          const diagonal = along(w0, g0, normal)
            .add(along(w1, g1, normal))
            .add(select(C.lessThan(0), u.compressAlpha, u.stretchAlpha).mul(lengths.w))
          const coupling = dot(normalBefore, normal).sub(g0.w.mul(dot(normal, g0.xyz)).mul(dot(normalBefore, g0.xyz)))
          const lower = select(j.greaterThan(uint(0)), w0.negate().mul(coupling), float(0)).toVar()
          const ratio = lower.div(pivotBefore).toVar()
          const pivot = diagonal.sub(ratio.mul(lower)).toVar()
          const rhs = C.negate().sub(ratio.mul(rhsBefore)).toVar()
          // Both ends held: the row drops out.
          If(pivot.lessThan(1e-12), () => {
            pivot.assign(1)
            rhs.assign(0)
          })
          mem.row(j).assign(vec4(normal, pivot))
          const kept = mem.solve(j).toVar()
          mem.solve(j).assign(vec4(rhs, lower, kept.z, kept.w))
          x0.assign(x1)
          w0.assign(w1)
          g0.assign(g1)
          normalBefore.assign(normal)
          pivotBefore.assign(pivot)
          rhsBefore.assign(rhs)
        })

        // Back substitution: each particle's correction once both its constraints are known.
        const lambdaAfter = float(0).toVar()
        const normalAfter = vec3(0).toVar()
        const lowerAfter = float(0).toVar()
        // A held particle sticks to its support while its slide stays within friction × its press into it (static
        // friction), else it slides free.
        const move = (k, d) => {
          const p = mem.x(k).toVar()
          const g = held(k).toVar()
          const slide = keep(d, g).toVar()
          const into = max(dot(d, g.xyz).mul(g.w).negate(), 0)
          const onGround = u.groundEnabled.greaterThan(0.5).and(dot(g.xyz, u.groundNormal).greaterThan(0.9999))
          const friction = select(onGround, u.groundFriction, u.colliderFriction)
          const stop = select(length(slide).lessThanEqual(friction.mul(into)), float(1), float(0))
          mem.x(k).assign(vec4(p.xyz.add(slide.mul(float(1).sub(stop)).mul(p.w)), p.w))
        }
        Loop({ start: int(P - 2), end: int(0), type: 'int', condition: '>=' }, ({ i: j }) => {
          const row = uint(j).toVar()
          const factor = mem.row(row).toVar()
          const sweep = mem.solve(row).toVar()
          const lambda = sweep.x.sub(lowerAfter.mul(lambdaAfter)).div(factor.w).toVar()
          move(row.add(1), factor.xyz.mul(lambda).sub(normalAfter.mul(lambdaAfter)))
          lambdaAfter.assign(lambda)
          normalAfter.assign(factor.xyz)
          lowerAfter.assign(sweep.y)
        })
        move(uint(0), normalAfter.mul(lambdaAfter).negate())
      })
      sync()
      if (hook) {
        hook('stretch', { ...context, firstSweep: null, sweepReversed: null })
        sync()
      }

      // 4. Back to the storage buffers.
      each((k) => {
        const i = base.add(k).toVar()
        if (shared) {
          b.positions.element(i).assign(mem.x(k))
          b.restLengths.element(i).assign(mem.rest(k))
        }
        b.delta.element(i).assign(vec4(0))
      })
    })().compute(shared ? this.#M * workgroup : this.#M, shared ? [workgroup] : undefined)
  }

  // A particle's share of its two segments' contact pushes, and the nearest other segment's distance from either.
  // Returns the summed push, for the supports.
  #gather(i, x, nearest, { segments, partners }) {
    const b = this.#buffers
    const P = this.#P
    const noodle = i.div(uint(P)).toVar()
    const k = i.sub(noodle.mul(uint(P))).toVar()
    const push = vec3(0).toVar()
    If(k.greaterThan(uint(0)), () => {
      const end = b.segmentDelta.element(i.sub(noodle).sub(1).mul(uint(2)).add(1)).toVar()
      nearest.assign(min(nearest, end.w))
      if (segments) push.addAssign(end.xyz)
    })
    If(k.lessThan(uint(P - 1)), () => {
      const g = i.sub(noodle).toVar()
      const o = g.mul(uint(2)).toVar()
      nearest.assign(min(nearest, b.segmentDelta.element(o.add(1)).w))
      if (segments) {
        const start = b.segmentDelta.element(o).toVar()
        push.addAssign(start.xyz)
        b.segmentLoad.element(g).assign(start.w)
      }
    })
    if (partners) push.addAssign(b.delta.element(i).xyz)
    x.addAssign(push)
    return push
  }

  // The radius of a noodle's particle k (a uint node): `radius` × radiusProfile[k], or `radius`.
  #radiusOf(k) {
    const profile = this.#uniforms.radiusProfile
    return profile ? profile.element(k).mul(this.#radius).toVar() : this.#radius
  }

  // What holds a particle up: a push with a part against gravity counts, the load from above doesn't.
  #holding(push) {
    return select(dot(push, this.#uniforms.up).greaterThan(0), push, vec3(0))
  }

  // Ground and colliders, the step bound, then the velocity. `segments` / `partners` first apply the contact pushes;
  // `bound` limits each particle's step to a share of its distance to the nearest other segment; `culled`: only the
  // colliders in the noodle's colliderCulling list.
  // 8 storage buffers: positions, previous, velocities, stepState, segmentDelta, segmentLoad, delta, support
  #velocityPass(options) {
    const culled = options.culled ? ':culled' : ''
    const variant = `${this.#capsuleColliders ? ':capsules' : ''}${culled}`
    const key = `velocity:${options.segments}:${options.partners}:${options.bound}${variant}`
    if (this.#passes[key]) return this.#passes[key]
    const b = this.#buffers
    const u = this.#uniforms
    const radius = this.#radius
    const P = this.#P
    const pass = Fn(() => {
      const i = instanceIndex
      const ownRadius = this.#radiusOf(i.mod(uint(P)))
      const state = b.velocities.element(i).toVar()
      // Where the substep started, and where the free motion alone took the particle.
      const start = b.previous.element(i).xyz.toVar()
      const predicted = start.add(state.xyz.mul(u.h)).toVar()
      const own = b.positions.element(i).toVar()
      const x = own.xyz.toVar()
      const prev = start.toVar()
      // Support from earlier passes this substep: none.
      const held = vec4(0).toVar()
      // The ground and colliders hold firmly; noodles and partners softly, as they give way too.
      const pushed = vec3(0).toVar()
      const noodleHold = held.xyz.toVar()
      const nearest = float(CONTACT_REACH * this.#maxRadius).toVar()
      if (options.segments || options.partners || options.bound) {
        noodleHold.addAssign(this.#holding(this.#gather(i, x, nearest, options)))
      }
      const s = float(b.stepState.element(uint(0))).toVar()
      const a1 = s.div(float(u.substeps)).toVar()
      const a0 = s.sub(1).div(float(u.substeps)).toVar()

      If(u.groundEnabled.greaterThan(0.5), () => {
        const n = u.groundNormal
        const depth = float(ownRadius).sub(dot(n, x).add(u.groundConstant)).toVar()
        If(depth.greaterThan(0), () => {
          pushed.addAssign(n.mul(depth))
          const before = dot(x.sub(prev), n).toVar()
          const approach = max(before.negate(), 0)
          x.addAssign(n.mul(depth))
          prev.addAssign(n.mul(max(depth.sub(approach), 0)))
          // An impact (faster than gravity gives in a frame) leaves at −restitution × its speed.
          If(before.div(u.h).lessThan(u.restThreshold.negate()), () => {
            prev.addAssign(n.mul(dot(n, x).add(u.groundRestitution.mul(before)).sub(dot(n, prev))))
          })
          const tangential = x
            .sub(prev)
            .sub(n.mul(dot(x.sub(prev), n)))
            .toVar()
          const normalPush = max(depth, dot(x.sub(prev), n).sub(before))
          const removed = min(float(1), u.groundFriction.mul(normalPush).div(max(length(tangential), 1e-30)))
          x.subAssign(tangential.mul(removed))
        })
      })

      this.forEachCollider(
        i.div(uint(P)),
        (c) => {
          const { n, depth, approach, motion } = this.#colliderContact(c, x, prev, a0, a1, ownRadius)
          If(depth.greaterThan(0), () => {
            pushed.addAssign(n.mul(depth))
            resolveContact(x, prev, n, depth, approach, motion, u.colliderFriction)
          })
        },
        { culled: options.culled === true },
      )

      if (options.bound) {
        // Both segments of a pair move less than half their distance, so their centerlines can't meet.
        const limit = max(nearest.mul(STEP_SHARE), MIN_STEP * radius).toVar()
        const step = x.sub(start).toVar()
        const stepLength = length(step).toVar()
        If(stepLength.greaterThan(limit), () => {
          const keep = limit.div(stepLength).toVar()
          x.assign(start.add(step.mul(keep)))
          prev.assign(start.add(prev.sub(start).mul(keep)))
        })
      }

      // The predicted velocity plus what the substep changed: unlike (x − prev) / h, exact far from the origin.
      const v = state.xyz.add(x.sub(predicted).sub(prev.sub(start)).div(u.h)).toVar()
      const speed = length(v).toVar()
      If(speed.greaterThan(u.maxSpeed), () => {
        v.mulAssign(u.maxSpeed.div(speed))
      })
      // Pinned particles stay; one that went non-finite stops where the substep started.
      const ok = isFinite3(x).and(isFinite3(prev)).and(isFinite3(v)).and(state.w.greaterThan(0))
      b.positions.element(i).assign(vec4(select(ok, x, start), own.w))
      b.previous.element(i).assign(vec4(select(ok, prev, start), 0))
      const all = pushed.add(noodleHold).toVar()
      const push = length(all).toVar()
      const firm = select(
        length(pushed).greaterThan(1e-12).or(held.w.greaterThan(0.5)),
        float(1),
        float(NOODLE_SUPPORT),
      )
      b.support.element(i).assign(select(push.greaterThan(1e-12), vec4(all.div(push), firm), vec4(0)))
      b.velocities.element(i).assign(vec4(select(ok, v, vec3(0)), state.w))
    })().compute(this.#N)
    this.#passes[key] = pass.setName(`noodles_${key}`)
    return pass
  }

  // Collider c against a particle at x (prev a substep ago), the shape at a1 of the frame (a0 a substep ago): the
  // normal out, the depth, how far the particle came in, and the surface's motion.
  #colliderContact(c, x, prev, a0, a1, particleRadius = this.#radius) {
    const u = this.#uniforms
    const radius = particleRadius
    const k = c.mul(4)
    const now0 = u.colliders.element(k).toVar()
    const now1 = u.colliders.element(k.add(1)).toVar()
    const last0 = u.colliders.element(k.add(2)).toVar()
    const last1 = u.colliders.element(k.add(3)).toVar()
    // This substep's shape and the previous one's, swept from last frame's.
    const p0 = mix(last0, now0, a1).toVar()
    const p1 = mix(last1, now1, a1).toVar()
    const q0 = mix(last0, now0, a0).toVar()
    const q1 = mix(last1, now1, a0).toVar()
    const type = now1.w
    const inflate = float(radius).add(u.colliderMargin).toVar()
    const n = vec3(0, 1, 0).toVar()
    const depth = float(0).toVar()
    const approach = float(0).toVar()
    const motion = vec3(0).toVar()
    const plane = () => {
      const scale = max(length(p0.xyz), 1e-30)
      const scaleBefore = max(length(q0.xyz), 1e-30)
      const normal = p0.xyz.div(scale).toVar()
      const distance = dot(normal, x).add(p0.w.div(scale)).toVar()
      n.assign(normal)
      depth.assign(inflate.sub(distance))
      approach.assign(max(dot(q0.xyz.div(scaleBefore), prev).add(q0.w.div(scaleBefore)).sub(distance), 0))
    }
    const sphere = () => {
      const d = x.sub(p0.xyz).toVar()
      const distance = length(d).toVar()
      If(distance.greaterThan(p0.w.add(inflate).mul(1e-6)), () => {
        n.assign(d.div(distance))
        depth.assign(p0.w.add(inflate).sub(distance))
        approach.assign(max(dot(prev.sub(q0.xyz).sub(d), n).add(p0.w.sub(q0.w)), 0))
        motion.assign(p0.xyz.sub(q0.xyz))
      })
    }
    const box = () => {
      const center = p0.xyz.add(p1.xyz).mul(0.5).toVar()
      const half = p1.xyz.sub(p0.xyz).mul(0.5).add(inflate).toVar()
      const centerBefore = q0.xyz.add(q1.xyz).mul(0.5).toVar()
      const halfBefore = q1.xyz.sub(q0.xyz).mul(0.5).add(inflate).toVar()
      const local = x.sub(center).toVar()
      const room = half.sub(abs(local)).toVar()
      If(min(min(room.x, room.y), room.z).greaterThan(0), () => {
        // Out through the nearest face.
        const grow = float(0).toVar()
        If(room.x.lessThanEqual(room.y).and(room.x.lessThanEqual(room.z)), () => {
          n.assign(vec3(select(local.x.greaterThanEqual(0), float(1), float(-1)), 0, 0))
          depth.assign(room.x)
          grow.assign(half.x.sub(halfBefore.x))
        })
          .ElseIf(room.y.lessThanEqual(room.z), () => {
            n.assign(vec3(0, select(local.y.greaterThanEqual(0), float(1), float(-1)), 0))
            depth.assign(room.y)
            grow.assign(half.y.sub(halfBefore.y))
          })
          .Else(() => {
            n.assign(vec3(0, 0, select(local.z.greaterThanEqual(0), float(1), float(-1))))
            depth.assign(room.z)
            grow.assign(half.z.sub(halfBefore.z))
          })
        approach.assign(max(dot(prev.sub(centerBefore).sub(local), n).add(grow), 0))
        motion.assign(center.sub(centerBefore))
      })
    }
    // Out from the closest point of the axis, which moves as the same share of the axis did, so friction carries
    // what rests on a moving capsule.
    const capsule = () => {
      const axis = p1.xyz.sub(p0.xyz).toVar()
      const along = clamp(dot(x.sub(p0.xyz), axis).div(max(dot(axis, axis), 1e-30)), 0, 1).toVar()
      const closest = p0.xyz.add(axis.mul(along)).toVar()
      const closestBefore = mix(q0.xyz, q1.xyz, along).toVar()
      const d = x.sub(closest).toVar()
      const distance = length(d).toVar()
      If(distance.greaterThan(p0.w.add(inflate).mul(1e-6)), () => {
        n.assign(d.div(distance))
        depth.assign(p0.w.add(inflate).sub(distance))
        approach.assign(max(dot(prev.sub(closestBefore).sub(d), n).add(p0.w.sub(q0.w)), 0))
        motion.assign(closest.sub(closestBefore))
      })
    }
    // The capsule branch only once a Capsule is listed.
    const shapes = If(type.lessThan(PLANE + 0.5), plane).ElseIf(type.lessThan(SPHERE + 0.5), sphere)
    if (this.#capsuleColliders) shapes.ElseIf(type.lessThan(BOX + 0.5), box).Else(capsule)
    else shapes.Else(box)
    return { n, depth, approach, motion }
  }

  // x moved out of the ground and the colliders, without friction: where the grab may hold a particle.
  #outside(x, a, particleRadius = this.#radius) {
    const u = this.#uniforms
    const p = x.toVar()
    If(u.groundEnabled.greaterThan(0.5), () => {
      p.addAssign(u.groundNormal.mul(max(float(particleRadius).sub(dot(u.groundNormal, p).add(u.groundConstant)), 0)))
    })
    Loop(u.colliderCount, ({ i: c }) => {
      const { n, depth } = this.#colliderContact(c, p, p, a, a, particleRadius)
      p.addAssign(n.mul(max(depth, 0)))
    })
    return p
  }

  // The tube's position nodes: a Catmull-Rom spline through the particles, the carried frame interpolated and
  // re-orthogonalized to its tangent, and rounded ends. The shadow pass gets the position alone.
  #createSurfaceNodes() {
    const b = this.#buffers
    const P = this.#P
    const radius = this.#radius
    const tube = (positions, frames, withFrame) => {
      // x: along the noodle in particles (0 … P−1), y: angle around, z: latitude on the ends, w: end (−1, 1; 0 body).
      const vertex = attribute('noodle', 'vec4')
      const segment = clamp(floor(vertex.x), 0, P - 2).toVar()
      const t = vertex.x.sub(segment).toVar()
      const base = instanceIndex.mul(uint(P)).toVar()
      const i0 = base.add(uint(segment)).toVar()
      const i1 = base.add(uint(min(segment.add(1), P - 1))).toVar()
      const p0 = positions.element(i0).xyz.toVar()
      const p1 = positions.element(i1).xyz.toVar()
      const pPrev = positions.element(base.add(uint(max(segment.sub(1), 0)))).xyz
      const pNext = positions.element(base.add(uint(min(segment.add(2), P - 1)))).xyz
      // Uniform Catmull-Rom; the shared ×0.5 cancels in the tangent.
      const t2 = t.mul(t)
      const c1 = p1.sub(pPrev).toVar()
      const c2 = pPrev.mul(2).sub(p0.mul(5)).add(p1.mul(4)).sub(pNext).toVar()
      const c3 = pPrev.negate().add(p0.mul(3)).sub(p1.mul(3)).add(pNext).toVar()
      const spine = p0
        .mul(2)
        .add(c1.mul(t))
        .add(c2.mul(t2))
        .add(c3.mul(t2.mul(t)))
        .mul(0.5)
      const derivative = c1
        .add(c2.mul(t.mul(2)))
        .add(c3.mul(t2.mul(3)))
        .toVar()
      const derivativeLength = length(derivative)
      const tangent = select(
        derivativeLength.greaterThan(1e-9),
        derivative.div(derivativeLength),
        normalize(p1.sub(p0)),
      ).toVar()
      const carried = mix(frames.element(i0).xyz, frames.element(i1).xyz, t).toVar()
      const across = carried.sub(tangent.mul(dot(carried, tangent))).toVar()
      const acrossLength = length(across)
      const normal = select(acrossLength.greaterThan(1e-6), across.div(acrossLength), frames.element(i0).xyz).toVar()
      const binormal = cross(tangent, normal)
      const radial = normal
        .mul(cos(vertex.y))
        .add(binormal.mul(sin(vertex.y)))
        .toVar()
      const ring = cos(vertex.z)
      const along = vertex.w.mul(sin(vertex.z)).toVar()
      // Tapered (radiusProfile): interpolated between the span's particles.
      const profile = this.#uniforms.radiusProfile
      const r = profile
        ? mix(profile.element(uint(segment)), profile.element(uint(segment).add(1)), t)
            .mul(radius)
            .toVar()
        : radius
      const position = spine.add(radial.mul(ring.mul(r))).add(tangent.mul(along.mul(r)))
      if (!withFrame) return { position }
      const surfaceNormal = normalize(radial.mul(ring).add(tangent.mul(along))).toVar()
      // Along the noodle, as uv.x runs; across it at the tips.
      const lengthwise = tangent.sub(surfaceNormal.mul(dot(tangent, surfaceNormal))).toVar()
      const lengthwiseLength = length(lengthwise)
      const surfaceTangent = select(lengthwiseLength.greaterThan(1e-4), lengthwise.div(lengthwiseLength), normal)
      return { position, normal: surfaceNormal, tangent: surfaceTangent }
    }
    return {
      surface: Fn((builder) => {
        const current = tube(b.positions, b.frames, true)
        // As three's skinning: overriding normalLocal / tangentLocal keeps normal maps and flat shading working.
        normalLocal.assign(current.normal)
        tangentLocal.assign(current.tangent)
        if (builder.needsPreviousData()) positionPrevious.assign(tube(b.drawnPositions, b.drawnFrames, false).position)
        return current.position
      })(),
      shadow: Fn(() => tube(b.positions, b.frames, false).position)(),
    }
  }

  // One noodle's tube, drawn `count` times: rounded end, lengthSegments rings per span, rounded end. Positions,
  // normals and tangents are placeholders the position node replaces.
  #createTubeGeometry(radialSegments, lengthSegments, capSegments) {
    const P = this.#P
    const rings = []
    for (let c = 0; c < capSegments; c++) rings.push([0, (Math.PI / 2) * (1 - c / capSegments), -1])
    for (let j = 0; j <= (P - 1) * lengthSegments; j++) rings.push([j / lengthSegments, 0, 0])
    for (let c = 1; c <= capSegments; c++) rings.push([P - 1, (Math.PI / 2) * (c / capSegments), 1])

    const around = radialSegments + 1 // the seam repeats, for the uvs
    const count = rings.length * around
    const noodle = new Float32Array(4 * count)
    const uv = new Float32Array(2 * count)
    const tangent = new Float32Array(4 * count)
    rings.forEach(([along, latitude, end], r) => {
      for (let j = 0; j < around; j++) {
        const v = r * around + j
        noodle.set([along, (j / radialSegments) * Math.PI * 2, latitude, end], 4 * v)
        uv.set([r / (rings.length - 1), j / radialSegments], 2 * v)
        // The bitangent (normal × tangent × w) runs around the noodle as uv.y does.
        tangent[4 * v + 3] = -1
      }
    })
    const IndexArray = count > 65535 ? Uint32Array : Uint16Array
    const index = new IndexArray((rings.length - 1) * radialSegments * 6)
    let o = 0
    for (let r = 0; r < rings.length - 1; r++) {
      for (let j = 0; j < radialSegments; j++) {
        const a = r * around + j
        const b = (r + 1) * around + j
        // Counter-clockwise seen from outside: around × along points out.
        index.set([a, a + 1, b, a + 1, b + 1, b], o)
        o += 6
      }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * count), 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(3 * count), 3))
    geometry.setAttribute('tangent', new THREE.BufferAttribute(tangent, 4))
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    geometry.setAttribute('noodle', new THREE.BufferAttribute(noodle, 4))
    geometry.setIndex(new THREE.BufferAttribute(index, 1))
    // For depth sorting; the CPU never sees the moving noodles.
    const box = new THREE.Box3()
    for (let i = 0; i < this.#N; i++) box.expandByPoint(_vector.fromArray(this.#rest, 4 * i))
    geometry.boundingBox = box.clone().expandByScalar(this.#radius)
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere())
    return geometry
  }

  // A clone of `source` drawn as the noodles.
  #deform(source) {
    if (this.#materials.includes(source)) return source
    if (!source?.isMaterial) throw new Error('NoodleSimulation: `material` must be a THREE.Material.')
    for (const key of ['positionNode', 'castShadowPositionNode', 'vertexNode']) {
      if (source[key]) {
        this.#warnOnce(`material:${key}`, `NoodleSimulation: the material's ${key} is replaced by the simulation.`)
      }
    }
    const material = source.clone()
    material.positionNode = this.#nodes.surface
    material.castShadowPositionNode = this.#nodes.shadow
    // A vertexNode would override the simulated positions in clip space.
    material.vertexNode = null
    // Node values collapse in three's render cache keys: two simulations with equal materials would share bindings.
    const baseKey = material.customProgramCacheKey.bind(material)
    material.customProgramCacheKey = () => `${baseKey()}|NoodleSimulation:${this.uuid}`
    material.needsUpdate = true
    this.#materials.push(material)
    return material
  }

  // A material assigned after construction is cloned and deformed too.
  #syncMaterial() {
    if (this.#materials.includes(this.material)) return
    if (Array.isArray(this.material)) {
      this.#warnOnce('materialArray', 'NoodleSimulation: takes one material; using the first.')
      this.material = this.material[0]
    }
    this.#source.material = this.material
    const material = this.#deform(this.material ?? new THREE.MeshStandardNodeMaterial())
    for (const old of this.#materials) if (old !== material) old.dispose()
    this.#materials = [material]
    this.material = material
  }

  // ---- Per frame ----

  #readSettings() {
    const p = {}
    for (const [key, [low, high, integer]] of Object.entries(NUMBER_SETTINGS)) {
      const value = this[key]
      const ok = typeof value === 'number' && value >= low && value <= high && (!integer || Number.isInteger(value))
      if (ok) {
        this.#valid[key] = value
      } else {
        this.#warnOnce(
          `setting:${key}`,
          `NoodleSimulation: ${key} = ${String(value)} is not ${integer ? 'an integer' : 'a number'} in [${low}, ${high}]; keeping ${this.#valid[key]}.`,
        )
      }
      p[key] = this.#valid[key]
    }
    for (const key of BOOLEAN_SETTINGS) p[key] = Boolean(this[key])

    const gravity = this.gravity
    if (gravity?.isVector3 && [gravity.x, gravity.y, gravity.z].every(Number.isFinite)) {
      this.#validGravity.copy(gravity)
    } else {
      this.#warnOnce('gravity', 'NoodleSimulation: gravity must be a finite THREE.Vector3; keeping the last one.')
    }
    const ground = this.ground
    if (ground === null) {
      this.#groundEnabled = false
    } else if (
      ground?.isPlane &&
      [ground.normal.x, ground.normal.y, ground.normal.z, ground.constant].every(Number.isFinite) &&
      ground.normal.lengthSq() > 0
    ) {
      this.#validGround.copy(ground)
      this.#groundEnabled = true
    } else {
      this.#warnOnce('ground', 'NoodleSimulation: ground must be a finite THREE.Plane or null; keeping the last one.')
    }
    return p
  }

  #syncUniforms(p, h, n) {
    const u = this.#uniforms
    u.h.value = h
    u.substeps.value = Math.max(n, 1)
    u.gravity.value.copy(this.#validGravity)
    const g = this.#validGravity.length()
    if (g > 0) u.up.value.copy(this.#validGravity).divideScalar(-g)
    else u.up.value.set(0, 0, 0)
    u.drag.value = Math.exp(-p.damping * h)
    u.normalDrag.value = Math.exp(-p.normalDamping * h)
    u.maxSpeed.value = p.maxSpeed > 0 ? Math.min(p.maxSpeed, 3e38) : 3e38
    // Per constraint, times its spacing factor (restLengths z⁴ for bends, w for stretch).
    u.stretchAlpha.value = Math.min(p.stretchingCompliance / (h * h), 3e38)
    u.compressAlpha.value = Math.min(p.compressionCompliance / (h * h), 3e38)
    u.bendAlpha.value = Math.min(p.bendingCompliance / (h * h), 3e38)
    // 0 × ∞ (no stiffness, or no damping, at the extremes) is no damping.
    const bendDamping = p.bendingCompliance > 0 && p.bendingDamping > 0 ? p.bendingCompliance * p.bendingDamping : 0
    u.bendGamma.value = Math.min(bendDamping / h, 3e38)
    u.bendingIterations.value = p.bendingIterations
    u.plasticity.value = 1 - Math.exp(-p.bendingPlasticity * h)
    u.plasticityThreshold.value = p.bendingPlasticityThreshold
    u.contactStiffness.value = p.contactStiffness
    u.separation.value = Math.min(p.separationSpeed * h, 3e38)
    u.contactFriction.value = Math.min(p.contactFriction, 3e38)
    u.groundEnabled.value = this.#groundEnabled ? 1 : 0
    const scale = this.#validGround.normal.length()
    u.groundNormal.value.copy(this.#validGround.normal).divideScalar(scale)
    u.groundConstant.value = this.#validGround.constant / scale
    u.groundFriction.value = Math.min(p.groundFriction, 3e38)
    u.groundRestitution.value = p.groundRestitution
    // Faster than gravity accelerates anything in one frame.
    u.restThreshold.value = this.#validGravity.length() / 60
    u.colliderFriction.value = Math.min(p.colliderFriction, 3e38)
    u.colliderMargin.value = p.colliderMargin
    const grab = this.#grab
    u.grabActive.value = grab.active ? 1 : 0
    u.grabParticle.value = grab.particle
    u.grabHasTarget.value = grab.hasTarget ? 1 : 0
    u.grabFrom.value.copy(grab.previousTarget)
    u.grabTo.value.copy(grab.target)
    u.grabDirectionFrom.value.copy(grab.previousDirection)
    u.grabDirectionTo.value.copy(grab.direction)
    u.grabStiffness.value = p.grabStiffness
    const pick = this.#pick
    if (pick.pending) {
      u.pickOrigin.value.copy(pick.origin)
      u.pickDirection.value.copy(pick.direction)
      u.pickRadius.value = pick.radius
      u.pickNear.value = pick.near
      u.pickFar.value = pick.far
    }
  }

  // What a frame's pass list depends on.
  #frameKey(f) {
    return [
      f.n,
      f.respawn,
      f.copyPrevious,
      f.capture,
      f.selfCollision,
      f.strict,
      f.lanes,
      f.culling,
      f.interval,
      f.partners.map((pass) => pass.id).join('.'),
      f.frames,
      f.ray,
      f.pick,
      ...['before', 'substep', 'after'].map((key) => (f.extra?.[key] ?? []).map((pass) => pass.id).join('.')),
    ].join()
  }

  // The frame's pass list, one cached list per frame shape.
  #frameList(f) {
    const key = this.#frameKey(f)
    let list = this.#frameLists.get(key)
    if (list) return list
    list = this.#listPasses(f)
    if (this.#frameLists.size >= 64) this.#frameLists.clear()
    this.#frameLists.set(key, list)
    return list
  }

  // Before the substeps; each substep's solve, contacts and coupling, and resolve; after.
  #listPasses(f) {
    const s = this.#passes
    const list = []
    const extra = f.extra ?? { before: [], substep: [], after: [] }
    if (f.respawn) list.push(s.respawn)
    if (f.copyPrevious) list.push(s.copyPrevious)
    if (f.pick) list.push(s.pickClear, s.pickNearest, s.pickIndex)
    if (f.capture) list.push(f.ray ? s.captureRay : s.capture)
    if (f.n > 0) list.push(s.begin, ...extra.before)
    // After extraPasses.before, which may move the particles.
    if (f.n > 0 && f.culling) list.push(this.#maskPass(f.ray))
    for (let k = 0; k < f.n; k++) {
      list.push(s.integrate)
      // Only the contacts read the segment hash.
      if (f.selfCollision) list.push(s.hashSegments)
      list.push(f.ray ? this.#rayNoodlePass() : s.noodles)
      const coupling = f.partners.length > 0 && (k % f.interval === 0 || k === f.n - 1)
      if (f.selfCollision) list.push(f.lanes ? this.#contactLanesPass() : s.contacts)
      if (coupling) list.push(...f.partners)
      const options = {
        segments: f.selfCollision,
        partners: coupling,
        bound: f.selfCollision && f.strict,
        culled: f.culling,
      }
      list.push(this.#velocityPass(options), ...extra.substep)
    }
    if (f.n > 0) list.push(...extra.after)
    // What partners read: this frame's final positions.
    if (this.#partnerHash && (f.n > 0 || f.respawn)) list.push(s.clearHash, s.hashParticles)
    if (f.frames) list.push(s.frames)
    return list
  }

  // Cached lists hold passes: dropped whenever a pass is built anew or disposed.
  #clearLists() {
    this.#frameLists.clear()
  }

  // The collider list: shapes packed for the velocity pass; partners as passes of their own, built once and dropped
  // when they leave the list. Returns the partners' states.
  #syncColliders() {
    let list = this.colliders
    if (!Array.isArray(list)) {
      this.#warnOnce('collidersArray', 'NoodleSimulation: colliders must be an array; using none.')
      list = []
    }
    const u = this.#uniforms
    const slots = u.colliders.array
    let changed = false
    const partners = []
    const seenPartners = []
    const shapes = []
    let sweep = 0
    for (const collider of list) {
      if (collider?.isPlane || collider?.isSphere || collider?.isBox3 || isCapsule(collider)) {
        if (shapes.includes(collider)) continue
        if (shapes.length === MAX_COLLIDERS) {
          this.#warnOnce(
            'collidersMax',
            `NoodleSimulation: only the first ${MAX_COLLIDERS} Plane / Sphere / Box3 / Capsule colliders are used.`,
          )
          continue
        }
        let state = this.#colliderStates.get(collider)
        if (!state) {
          state = { now: [new THREE.Vector4(), new THREE.Vector4()], last: null }
          this.#colliderStates.set(collider, state)
        }
        if (!packShape(collider, state.now)) {
          this.#warnOnce('colliderValue', 'NoodleSimulation: skipping a collider that is empty or not finite.')
          continue
        }
        // A new collider, one back in the list, one that changed kind, or any after a reset starts where it is.
        const fresh = !state.last || !this.#frameShapes.includes(collider) || state.last[1].w !== state.now[1].w
        if (fresh || this.#snapPending) {
          state.last = state.now.map((v) => v.clone())
        }
        const k = shapes.length
        if (copyChanged(slots[4 * k], state.now[0])) changed = true
        if (copyChanged(slots[4 * k + 1], state.now[1])) changed = true
        if (copyChanged(slots[4 * k + 2], state.last[0])) changed = true
        if (copyChanged(slots[4 * k + 3], state.last[1])) changed = true
        shapes.push(collider)
        sweep = Math.max(sweep, colliderSweep(state.now, state.last))
      } else if (collider === this) {
        this.#warnOnce('colliderSelf', 'NoodleSimulation: a simulation in its own colliders is skipped.')
      } else if (collider?.couplingData !== undefined) {
        const state = this.#partnerState(collider)
        if (state && !seenPartners.includes(state)) {
          seenPartners.push(state)
          partners.push(state)
        }
      } else {
        this.#warnOnce(
          'collider',
          'NoodleSimulation: colliders takes THREE.Plane, Sphere, Box3, Capsule and coupling partners; skipping others.',
        )
      }
    }
    if (!this.#capsuleColliders && shapes.some(isCapsule)) this.#enableCapsuleColliders()
    if (changed) markArrayChanged(u.colliders)
    u.colliderCount.value = shapes.length
    this.#frameShapes = shapes
    this.#colliderSweep = sweep
    for (const [key, state] of this.#partners) if (!seenPartners.includes(state)) this.#dropPartner(key, state)
    return partners
  }

  #advanceColliders(advance) {
    if (!advance) return
    for (const shape of this.#frameShapes) {
      const state = this.#colliderStates.get(shape)
      state.last[0].copy(state.now[0])
      state.last[1].copy(state.now[1])
    }
  }

  // The first Capsule listed: the passes that meet colliders (velocity, and noodles for the grab's target) are
  // rebuilt with the capsule branch.
  #enableCapsuleColliders() {
    this.#capsuleColliders = true
    const stale = []
    for (const [key, pass] of Object.entries(this.#passes)) {
      if (key === 'noodles' || key === 'noodlesRay' || key.startsWith('velocity:')) {
        stale.push(pass)
        delete this.#passes[key]
      }
    }
    this.#passes.noodles = this.#createNoodlePass().setName('noodles_noodles')
    this.#clearLists()
    this.#afterCompile(() => {
      for (const pass of stale) disposePass(pass)
    })
  }

  // A coupling partner's pass, keyed by its positions buffer, so a rebuilt partner gets a new one.
  #partnerState(collider) {
    const data = collider.couplingData
    if (!data) return null // not ready yet, or disposed
    let state = this.#partners.get(data.positions)
    if (!state) {
      const needed = [
        'positions',
        'gridCounters',
        'gridParticles',
        'cellOf',
        'hashOf',
        'maxPerCell',
        'particleRadius',
        'cellSize',
      ]
      const missing = needed.filter((key) => data[key] === undefined || data[key] === null)
      if (missing.length > 0) {
        this.#warnOnce(
          'partnerData',
          `NoodleSimulation: skipping a partner whose couplingData lacks ${missing.join(', ')}.`,
        )
        return null
      }
      state = { data, ...this.#createCouplingPass(data), release: null }
      if (typeof collider.addEventListener === 'function') {
        const onDispose = () => this.#partnerGone(data.positions, state)
        collider.addEventListener('dispose', onDispose)
        state.release = () => collider.removeEventListener('dispose', onDispose)
      }
      this.#partners.set(data.positions, state)
      this.#clearLists()
    }
    // The coupling compares positions as they are: both simulations must share one space.
    if (collider.isObject3D) {
      collider.updateWorldMatrix(true, false)
      if (!sameMatrix(collider.matrixWorld, this.matrixWorld)) {
        this.#warnOnce(
          'partnerSpace',
          'NoodleSimulation: a coupled simulation has another world transform; coupling assumes one space.',
        )
      }
    } else if (!sameMatrix(this.matrixWorld, _identity)) {
      this.#warnOnce(
        'partnerSpace',
        'NoodleSimulation: coupling with a partner in world space needs the noodles at the identity transform.',
      )
    }
    return state
  }

  // Its pass and dispose listener go once a compile in flight, which may bind its buffers, settles.
  #dropPartner(key, state) {
    if (this.#partners.get(key) !== state) return
    this.#partners.delete(key)
    this.#clearLists()
    this.#afterCompile(() => {
      state.release?.()
      disposePass(state.pass)
    })
  }

  // A partner being disposed, before it frees its buffers. A compile in flight may bind them: they go now through
  // three's attribute map, so that compile recreates them, and again once it settles.
  #partnerGone(key, state) {
    if (this.#compiling !== null) {
      this.#destroyStorage(state.storage)
      this.#afterCompile(() => this.#destroyStorage(state.storage))
    }
    this.#dropPartner(key, state)
  }

  // Pushes against a partner's particles found through its hash: half the overlap each side (the partner runs the
  // mirror pass), Coulomb friction on the slide relative to the partner when it exposes `previous`, averaged over the
  // contacts and added to `delta`. Returns the pass and the partner's buffers it binds.
  // 7 storage buffers: positions, previous, delta, the partner's positions, previous, counts, entries
  #createCouplingPass(data) {
    const b = this.#buffers
    const u = this.#uniforms
    // Own bindings for the partner's buffers: its node names could clash with ours.
    const wrap = (node, name) =>
      storage(node.value, node.bufferType, node.bufferCount).setName(`noodles_partner${name}`)
    const positions = wrap(data.positions, 'Positions')
    const previous = data.previous ? wrap(data.previous, 'Previous') : null
    const counts = wrap(data.gridCounters, 'Counts').toAtomic()
    const entries = wrap(data.gridParticles, 'Entries')
    const capacity = data.maxPerCell
    // Every particle at the widest one's radius.
    const contact = this.#maxRadius + data.particleRadius
    const reach = Math.max(1, Math.ceil(contact / data.cellSize - 1e-6))
    const width = 2 * reach + 1
    const cellOf = data.cellOf

    const pass = Fn(() => {
      const i = instanceIndex
      const xi = b.positions.element(i).xyz.toVar()
      const motion = xi.sub(b.previous.element(i).xyz).toVar()
      const center = cellOf(xi).toVar()
      const push = vec3(0).toVar()
      const found = float(0).toVar()
      const touch = (j, xj) => {
        const d = xi.sub(xj).toVar()
        const d2 = dot(d, d).toVar()
        If(d2.lessThan(contact * contact).and(d2.greaterThan(contact * contact * 1e-12)), () => {
          const distance = sqrt(d2).toVar()
          const n = d.div(distance).toVar()
          const normal = float(contact).sub(distance).mul(0.5).mul(u.contactStiffness).toVar()
          push.addAssign(n.mul(normal))
          const slide = (previous ? motion.sub(xj.sub(previous.element(j).xyz)) : motion).toVar()
          const tangential = slide.sub(n.mul(dot(slide, n))).toVar()
          push.subAssign(
            tangential.mul(min(float(0.5), u.contactFriction.mul(normal).div(max(length(tangential), 1e-30)))),
          )
          found.addAssign(1)
        })
      }
      Loop(width * width * width, ({ i: c }) => {
        const query = center
          .add(ivec3(c.mod(width).sub(reach), c.div(width).mod(width).sub(reach), c.div(width * width).sub(reach)))
          .toVar()
        const h = data.hashOf(query).toVar()
        const count = min(atomicLoad(counts.element(h)), uint(capacity)).toVar()
        Loop(count, ({ i: k }) => {
          const j = entries.element(h.mul(uint(capacity)).add(k)).toVar()
          const xj = positions.element(j).xyz.toVar()
          // Only the entry's own cell counts it: two query cells can share a bucket.
          const jCell = cellOf(xj)
          If(jCell.x.equal(query.x).and(jCell.y.equal(query.y)).and(jCell.z.equal(query.z)), () => {
            touch(j, xj)
          })
        })
      })
      If(found.greaterThan(0), () => {
        const delta = b.delta.element(i)
        delta.assign(vec4(delta.xyz.add(push.div(found)), 0))
      })
    })()
      .compute(this.#N)
      .setName('noodles_partner')
    return { pass, storage: [positions, previous, counts, entries].filter(Boolean) }
  }

  // ---- Readback ----

  async #readPositions() {
    // Until a frame runs, the state is the rest pose.
    if (!this.#live) return this.#rest.slice()
    return new Float32Array(await this.#renderer.getArrayBufferAsync(this.#buffers.positions.value))
  }

  async #readVelocities() {
    if (!this.#stepped) return new Float32Array(4 * this.#N)
    return new Float32Array(await this.#renderer.getArrayBufferAsync(this.#buffers.velocities.value))
  }

  // ---- Utilities ----

  // Every compute pass this simulation holds now: its own, and its partners'.
  #allPasses(extras = true) {
    const passes = Object.values(this.#passes)
    const extra = extras ? this.#readExtraPasses() : { before: [], substep: [], after: [] }
    for (const key of ['before', 'substep', 'after'])
      for (const pass of extra[key]) if (!passes.includes(pass)) passes.push(pass)
    for (const state of this.#partners.values()) passes.push(state.pass)
    return passes
  }

  // GPU frees wait for a compileAsync() in flight, which would build and bind what they free.
  #afterCompile(free) {
    if (this.#compiling) this.#compiling.then(free, free)
    else free()
  }

  // Through three's attribute map, so renderer.info.memory stays right and a pass that binds one later recreates it
  // (of one item, if its CPU copy was dropped).
  #destroyStorage(nodes) {
    if (this.#renderer === null) return
    const { backend, info, _attributes: attributes } = this.#renderer
    for (const node of nodes) {
      const attribute = node.value
      if (!backend.has(attribute) || !backend.get(attribute).buffer) continue
      if (attribute.array.length === 0) attribute.array = new attribute.array.constructor(attribute.itemSize)
      if (!attributes?.delete(attribute)) {
        backend.destroyAttribute(attribute)
        info.destroyAttribute(attribute)
      }
    }
  }

  #warnDisposed(method) {
    this.#warnOnce('disposed', `NoodleSimulation: ${method}() after dispose().`)
    return this
  }

  #warnOnce(key, message) {
    if (this.#warned.includes(key)) return
    this.#warned.push(key)
    console.warn(message)
  }
}

// ======== The helper ========

/**
 * NoodleSimulationHelper — the capsules of a NoodleSimulation as the solver collides them, one per segment.
 *
 *   const helper = new NoodleSimulationHelper(noodles)
 *   scene.add(helper)                  // anywhere: it follows the noodles
 *   helper.material.color.set(0xff0000)
 *
 * Disposing the noodles disposes the helper.
 */
export class NoodleSimulationHelper extends THREE.Mesh {
  isNoodleSimulationHelper = true
  type = 'NoodleSimulationHelper'

  #noodles
  #onDispose = () => {
    this.removeFromParent()
    this.dispose()
  }

  /** @param {NoodleSimulation} noodles */
  constructor(noodles) {
    if (!noodles?.isNoodleSimulation || !HELPER_DATA.has(noodles)) {
      throw new Error('NoodleSimulationHelper: needs a NoodleSimulation that is not disposed.')
    }
    const { positions, drawnPositions, P, profile } = HELPER_DATA.get(noodles)
    const material = new THREE.MeshStandardNodeMaterial({
      name: 'NoodleSimulationHelper',
      color: 0x6c86c8,
      roughness: 0.55,
      metalness: 0,
    })
    // A unit-height capsule (body from y −½ to ½) stretched along each segment.
    const capsule = (buffer) => {
      const segment = instanceIndex
      const i0 = segment.add(segment.div(uint(P - 1))).toVar()
      const a = buffer.element(i0).xyz.toVar()
      const b = buffer.element(i0.add(1)).xyz.toVar()
      const axis = b.sub(a).toVar()
      const span = length(axis).toVar()
      const along = select(span.greaterThan(1e-9), axis.div(span), vec3(0, 1, 0)).toVar()
      const side = perpendicular(along).toVar()
      const other = cross(side, along).toVar()
      const y = positionLocal.y
      const body = clamp(y, -0.5, 0.5)
      // Tapered (radiusProfile): the capsule at the mean of its two particles' radii.
      const local = segment.mod(uint(P - 1)).toVar()
      const scale = profile
        ? profile
            .element(local)
            .add(profile.element(local.add(1)))
            .mul(0.5)
        : float(1)
      const lengthwise = body.mul(span).add(y.sub(body).mul(scale))
      const position = a
        .add(b)
        .mul(0.5)
        .add(along.mul(lengthwise))
        .add(side.mul(positionLocal.x.mul(scale)))
        .add(other.mul(positionLocal.z.mul(scale)))
      return { position, along, side, other }
    }
    material.positionNode = Fn((builder) => {
      const current = capsule(positions)
      const n = normalGeometry
      normalLocal.assign(current.side.mul(n.x).add(current.along.mul(n.y)).add(current.other.mul(n.z)))
      if (builder.needsPreviousData()) positionPrevious.assign(capsule(drawnPositions).position)
      return current.position
    })()
    // Node values collapse in three's render cache keys: two helpers would otherwise share bindings.
    const baseKey = material.customProgramCacheKey.bind(material)
    material.customProgramCacheKey = () => `${baseKey()}|NoodleSimulationHelper:${noodles.uuid}`
    super(new THREE.CapsuleGeometry(noodles.radius, 1, 2, 8), material)
    this.#noodles = noodles
    this.count = noodles.segmentCount
    this.frustumCulled = false
    this.matrixAutoUpdate = false
    noodles.addEventListener('dispose', this.#onDispose)
  }

  get noodles() {
    return this.#noodles
  }

  // Draws over the noodles wherever the helper sits in the scene.
  updateMatrixWorld(force) {
    this.#noodles.updateWorldMatrix(true, false)
    this.matrixWorld.copy(this.#noodles.matrixWorld)
    this.matrixWorldNeedsUpdate = false
    for (const child of this.children) child.updateMatrixWorld(force)
  }

  updateWorldMatrix(updateParents, updateChildren) {
    this.#noodles.updateWorldMatrix(true, false)
    this.matrixWorld.copy(this.#noodles.matrixWorld)
    if (updateChildren) for (const child of this.children) child.updateWorldMatrix(false, true)
  }

  raycast() {}

  clone() {
    return new this.constructor(this.#noodles)
  }

  dispose() {
    super.dispose()
    this.#noodles.removeEventListener('dispose', this.#onDispose)
    this.geometry.dispose()
    this.material.dispose()
  }
}

// ======== Utilities ========

// Each noodle's twist-free normals at rest, as the GPU frames pass: the first draw needs no update().
function transportFrames(rest, M, P) {
  const frames = new Float32Array(rest.length)
  const point = (i, target) => target.fromArray(rest, 4 * i)
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  for (let n = 0; n < M; n++) {
    const base = n * P
    _tangent.subVectors(point(base + 1, a), point(base, b))
    if (_tangent.lengthSq() > 1e-18) _tangent.normalize()
    else _tangent.set(0, 0, 1)
    perpendicularTo(_tangent, _normal)
    _normal.toArray(frames, 4 * base)
    for (let k = 1; k < P; k++) {
      _vector.subVectors(point(base + Math.min(k + 1, P - 1), a), point(base + k - 1, b))
      if (_vector.lengthSq() > 1e-18) _tangent.copy(_vector).normalize()
      _vector.copy(_normal).addScaledVector(_tangent, -_normal.dot(_tangent))
      if (_vector.lengthSq() > 1e-12) _normal.copy(_vector).normalize()
      _normal.toArray(frames, 4 * (base + k))
    }
  }
  return frames
}

// The CPU twin of the TSL perpendicular().
function perpendicularTo(t, target) {
  const sign = t.z >= 0 ? 1 : -1
  const a = -1 / (sign + t.z)
  return target.set(1 + sign * t.x * t.x * a, sign * t.x * t.y * a, -sign * t.x)
}

// xyz per item out of vec4 per item.
function unpad(data, count) {
  const out = new Float32Array(3 * count)
  for (let i = 0; i < count; i++) {
    out[3 * i] = data[4 * i]
    out[3 * i + 1] = data[4 * i + 1]
    out[3 * i + 2] = data[4 * i + 2]
  }
  return out
}

// Copies `source` into `target`; true when a component changed (by Object.is: -0 is not 0).
function copyChanged(target, source) {
  if (
    Object.is(target.x, source.x) &&
    Object.is(target.y, source.y) &&
    Object.is(target.z, source.z) &&
    Object.is(target.w, source.w)
  ) {
    return false
  }
  target.copy(source)
  return true
}

// After an in-place edit of a uniformArray in a group of its own: its buffer refreshed from the array (unbuilt, it has
// none yet) and the group's version bumped, so every binding uploads it once, at its next use.
function markArrayChanged(node) {
  if (node.value) node.updateBuffer()
  node.groupNode.needsUpdate = true
}

// three rebuilds a pass to find its bindings, so one that never compiled throws here.
function disposePass(pass) {
  try {
    pass.dispose()
  } catch {}
}

function sameMatrix(a, b) {
  for (let i = 0; i < 16; i++) if (Math.abs(a.elements[i] - b.elements[i]) > 1e-6) return false
  return true
}

// three/addons/math/Capsule.js has no isCapsule flag: anything with start and end points and a radius.
function isCapsule(shape) {
  return shape?.start?.isVector3 === true && shape.end?.isVector3 === true && typeof shape.radius === 'number'
}

// A Plane, Sphere, Box3 or Capsule as two vec4: (normal, constant | centre, radius | min | start, radius) and
// (… | max | end), type in the last w.
function packShape(shape, out) {
  if (shape.isPlane) {
    const scale = shape.normal.length()
    if (!(scale > 0) || !Number.isFinite(scale) || !Number.isFinite(shape.constant)) return false
    out[0].set(shape.normal.x / scale, shape.normal.y / scale, shape.normal.z / scale, shape.constant / scale)
    out[1].set(0, 0, 0, PLANE)
    return true
  }
  if (shape.isSphere) {
    const { center, radius } = shape
    if (!(radius > 0) || ![center.x, center.y, center.z, radius].every(Number.isFinite)) return false
    out[0].set(center.x, center.y, center.z, radius)
    out[1].set(0, 0, 0, SPHERE)
    return true
  }
  if (isCapsule(shape)) {
    const { start, end, radius } = shape
    if (!(radius >= 0) || ![start.x, start.y, start.z, end.x, end.y, end.z, radius].every(Number.isFinite)) return false
    out[0].set(start.x, start.y, start.z, radius)
    out[1].set(end.x, end.y, end.z, CAPSULE)
    return true
  }
  const { min, max } = shape
  if (shape.isEmpty() || ![min.x, min.y, min.z, max.x, max.y, max.z].every(Number.isFinite)) return false
  out[0].set(min.x, min.y, min.z, 0)
  out[1].set(max.x, max.y, max.z, BOX)
  return true
}

// The farthest a collider's surface moves from `last` to `now` (packShape()'s pairs); a Plane that turns, unbounded.
function colliderSweep(now, last) {
  const type = now[1].w
  const moved = (k) => Math.hypot(now[k].x - last[k].x, now[k].y - last[k].y, now[k].z - last[k].z)
  const grown = Math.abs(now[0].w - last[0].w)
  if (type === PLANE) return moved(0) > 0 ? Infinity : grown
  if (type === SPHERE) return moved(0) + grown
  return Math.max(moved(0), moved(1)) + grown
}
