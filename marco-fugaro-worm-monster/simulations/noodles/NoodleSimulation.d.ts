// Noodles, ropes and cables on the GPU: strands that bend, buckle, pile up and never pass through each other, drawn as
// one instanced tube:
//
//   const noodles = new NoodleSimulation(curves, material, { radius: 0.05, particlesPerNoodle: 32 })
//   noodles.colliders.push(new THREE.Sphere(center, 0.5))
//   scene.add(noodles)
//   await noodles.compileAsync(renderer)
//   renderer.setAnimationLoop(() => {
//     noodles.update(renderer, timer.getDelta())
//     renderer.render(scene, camera)
//   })
//   const hit = await noodles.pickAsync(raycaster)
//   noodles.startGrab(hit.particle).moveGrab(hit.position)

import {
  Box3,
  BufferGeometry,
  CapsuleGeometry,
  ComputeNode,
  Curve,
  Material,
  Mesh,
  MeshStandardNodeMaterial,
  Node,
  NodeMaterial,
  Plane,
  Ray,
  Raycaster,
  Renderer,
  Sphere,
  StorageBufferNode,
  UniformArrayNode,
  UniformNode,
  Vector3,
} from 'three/webgpu'

/** A capsule collider, such as three/addons/math/Capsule.js. */
export interface NoodleCapsule {
  start: Vector3
  end: Vector3
  radius: number
}

/** What `colliders` takes: shapes, and simulations to couple with. */
export type NoodleCollider = Plane | Sphere | Box3 | NoodleCapsule | NoodleSimulation<Material>

export interface NoodleSimulationOptions {
  /** Of the tubes and of the capsules they collide as. Default 0.05. */
  radius?: number
  /** Particles along each noodle, at least 2. Default one per diameter of the longest curve. */
  particlesPerNoodle?: number
  /** Tube vertices around. Default 8. */
  radialSegments?: number
  /** Tube rings between two particles. Default 3. */
  lengthSegments?: number
  /** Rings of each rounded end. Default 2. */
  capSegments?: number
  /** The starting `colliders`. Default []. */
  colliders?: NoodleCollider[]
  /** Particles (noodle × particlesPerNoodle + index) held at their rest pose. Default none. */
  pinned?: ArrayLike<number>
  /** Entries per segment-hash bucket; size it from info.fullestSegmentBucket. Default from the spacing, 32 to 64. */
  segmentBucketSize?: number
  /** Entries per particle-hash bucket; size it from info.fullestBucket. Default from the spacing, 16 to 64. */
  bucketSize?: number
  /** particlesPerNoodle multipliers of `radius`, head first, the same for every noodle. Default none. */
  radiusProfile?: ArrayLike<number>
  /** Emits TSL inside each noodle's solve while its pass is built: after every bending sweep and the stretch solve. */
  noodleHook?: (stage: 'bend' | 'stretch', context: NoodleHookContext) => void
  /** The starting contactLanes. Default true. */
  contactLanes?: boolean
  /** The starting colliderCulling. Default false. */
  colliderCulling?: boolean
  /** Builds the particle hash partners read, every frame; false only when nothing couples to this one. Default true. */
  partnerHash?: boolean
}

/** What options.noodleHook emits its TSL with, for one noodle. */
export type NoodleHookContext = {
  /** The noodle's particle k: position and inverse mass, where the substep started, support, rest lengths. */
  mem: {
    x: (k: Node | number) => Node<'vec4'>
    start: (k: Node | number) => Node<'vec4'>
    support: (k: Node | number) => Node<'vec4'>
    rest: (k: Node | number) => Node<'vec4'>
  }
  /** Calls body(k) for every particle of the noodle, spread over the workgroup. */
  each: (body: (k: Node<'uint'>) => void) => void
  /** A workgroup barrier while the noodle is in workgroup memory. */
  sync: () => void
  lane: Node<'uint'>
  noodle: Node<'uint'>
  /** The noodle's first particle. */
  base: Node<'uint'>
  /** particlesPerNoodle. */
  P: number
  /** The noodle is in workgroup memory. */
  shared: boolean
  /** Threads per noodle: the stride of each(). */
  workgroupSize: number
  /** True in the substep's first bending sweep; null in 'stretch'. */
  firstSweep: Node<'bool'> | null
  radiusOf: (k: Node<'uint'>) => Node<'float'> | number
  nodes: NoodleSimulationNodes
}

/** Compute passes of yours, dispatched with the noodles' in frames that step. */
export interface NoodleExtraPasses {
  /** Once a frame, before the substeps. */
  before: ComputeNode[]
  /** Every substep, after the velocity pass. */
  substep: ComputeNode[]
  /** Once a frame, after the substeps. */
  after: ComputeNode[]
}

export interface NoodleSimulationBuffers {
  /** Per particle xyz and inverse mass, object space, noodle after noodle. */
  readonly positions: StorageBufferNode<'vec4'>
  /** Where each particle started the substep. */
  readonly previous: StorageBufferNode<'vec4'>
  /** Per particle velocity and inverse mass. */
  readonly velocities: StorageBufferNode<'vec4'>
  /** Per particle: stretch rest length to the next, rest bend, spacing, stretch compliance factor. */
  readonly restLengths: StorageBufferNode<'vec4'>
  /** Per particle: the normal of what held it up last substep, and how firmly. */
  readonly support: StorageBufferNode<'vec4'>
  /** [0] the substep running; then colliderCulling's lists, a bit per collider. */
  readonly stepState: StorageBufferNode<'uint'>
}

/** Set from the settings every update(). */
export interface NoodleSimulationUniforms {
  /** The substep's length, s. */
  readonly h: UniformNode<'float'>
  /** Substeps this frame, at least 1. */
  readonly substeps: UniformNode<'uint'>
  /** Object space. */
  readonly gravity: UniformNode<'vec3'>
  /** 1 with a ground, else 0. */
  readonly groundEnabled: UniformNode<'float'>
  readonly groundNormal: UniformNode<'vec3'>
  readonly groundConstant: UniformNode<'float'>
  /** 4 vec4 per Plane / Sphere / Box3 / Capsule collider: its pose now, then last frame's. */
  readonly colliders: UniformArrayNode<'vec4'>
  readonly colliderCount: UniformNode<'uint'>
}

export interface NoodleSimulationNodes {
  buffers: NoodleSimulationBuffers
  uniforms: NoodleSimulationUniforms
}

export interface NoodleSimulationInfo {
  noodles: number
  particles: number
  segments: number
  particlesPerNoodle: number
  pinned: number
  segmentBucketSize: number
  bucketSize: number
  /** Substeps the last update() ran; 0 after reset(). */
  substeps: number
  /** How the last update() stepped: `h` is the substep's length. */
  coupling: {
    members: number
    substeps: number
    h: number
    bendingIterations: number
  }
  /** Since construction or reset(), read by readInfoAsync(). */
  droppedSegmentEntries: number
  fullestSegmentBucket: number
  droppedEntries: number
  fullestBucket: number
}

export interface NoodlePickOptions {
  /** Of the spheres round the particles the ray hits. Default 2.5 × radius. */
  radius?: number
}

export interface NoodlePickResult {
  /** From the ray's origin, world units. */
  distance: number
  /** Where the ray enters the particle's sphere, world space. */
  point: Vector3
  /** The particle, world space: grab with moveGrab(position) so the noodle doesn't jump. */
  position: Vector3
  particle: number
  noodle: number
}

/** xyz per particle, object space, noodle after noodle. */
export interface NoodleParticles {
  positions: Float32Array
  velocities: Float32Array
}

export interface ForEachColliderOptions {
  /** Only those in colliderCulling's list for the noodle, while colliderCulling is on. Default false. */
  culled?: boolean
}

export declare class NoodleSimulation<
  TMaterial extends Material = NodeMaterial,
> extends Mesh<BufferGeometry, TMaterial> {
  /** Drawn with a MeshStandardNodeMaterial. */
  constructor(curves: Curve<Vector3> | Curve<Vector3>[], material?: null, options?: NoodleSimulationOptions)
  /**
   * @param curves One per noodle: its rest shape and starting pose, object space.
   * @param material Cloned, its positionNode replaced.
   */
  constructor(curves: Curve<Vector3> | Curve<Vector3>[], material: TMaterial | null, options?: NoodleSimulationOptions)

  readonly isNoodleSimulation: true

  /** Substeps per 1/60 s of simulated time, 1 to 64: the motion is the same at any frame rate. Default 15. */
  numSubsteps: number
  /** Simulated seconds per real second; 0 pauses. Default 1. */
  timeScale: number
  /** The most real seconds one update() steps, before timeScale; longer frames run in slow motion. Default 1/30. */
  maxDeltaTime: number

  /** m/s², object space. Default (0, −9.81, 0). */
  gravity: Vector3
  /** Air drag along the noodle, 1/s. Default 0.05. */
  damping: number
  /** Air drag across the noodle, 1/s: a noodle falling broadside slows to g / normalDamping. Default 0.5. */
  normalDamping: number
  /** Units/s, against blow-ups; 0 for none. Default 50. */
  maxSpeed: number

  /** Stretch compliance per unit mass, s²/m²; 0 keeps every noodle its length. Default 0. */
  stretchingCompliance: number
  /** Stretch compliance while a segment is shorter than at rest: a noodle landing on end buckles. Default 0.00005. */
  compressionCompliance: number
  /** Bending compliance per unit mass, s²/m⁴: 2 is soft cooked spaghetti, 0.08 a rod. Default 2. */
  bendingCompliance: number
  /** Damps the bends' rate of change: slows bending, not swaying or rolling. Default 20. */
  bendingDamping: number
  /** Bending sweeps per substep, 1 to 16; too few leave stiff noodles softer. Default 4. */
  bendingIterations: number
  /** Plastic flow of the bends, 1/s: a noodle keeps the shape it settles in; 0 springs back, as ropes do. Default 2. */
  bendingPlasticity: number
  /** Bend per joint, radians past the rest one, a noodle springs back from before it flows. Default 0.05. */
  bendingPlasticityThreshold: number

  /** Noodles collide with each other and with themselves. Default true. */
  selfCollision: boolean
  /** No two centerlines cross; caps the speed at 67.5 × maxRadius × numSubsteps units/s. Default true. */
  strictCollisions: boolean
  /** 32 threads per segment in the contacts pass: the same contacts, faster in dense piles. Default true. */
  contactLanes: boolean
  /** Share of a contact overlap resolved per substep, 0 to 1. Default 1. */
  contactStiffness: number
  /** Units/s: the fastest overlapping noodles push apart. Default 2. */
  separationSpeed: number
  /** Coulomb coefficient between noodles and against coupled partners. Default 0.6. */
  contactFriction: number
  /** Substeps between passes against coupled partners, 1 to 64. Default 1. */
  couplingInterval: number

  /** Object space, its normal pointing out of the ground; null for none. Default the plane y = 0. */
  ground: Plane | null
  /** Coulomb coefficient against the ground. Default 0.85. */
  groundFriction: number
  /** Share of the normal speed an impact keeps: 0 stops dead, 1 bounces back. Default 0. */
  groundRestitution: number

  /** Read every update(), object space: up to 96 shapes, swept from their last pose, and simulations to couple with. */
  colliders: NoodleCollider[]
  /** Coulomb coefficient against the colliders. Default 0.6. */
  colliderFriction: number
  /** Added to every collider surface, object units. Default 0. */
  colliderMargin: number
  /** Each noodle meets only the colliders it may reach this frame, with the same motion. Default false. */
  colliderCulling: boolean
  /** Units past colliderMargin a collider stays in a noodle's culled list, for forEachCollider(). Default 0. */
  colliderCullingReach: number

  /** How firmly grabbed particles follow the target, 0 to 1. Default 1. */
  grabStiffness: number

  /** Read every update(). */
  extraPasses: NoodleExtraPasses
  /** Sizes, the substeps the last update() ran, and the hash statistics of readInfoAsync(). */
  readonly info: NoodleSimulationInfo

  /** Of the tubes and of the capsules they collide as, object units. */
  readonly radius: number
  readonly particlesPerNoodle: number
  readonly particleCount: number
  /** Capsules: particlesPerNoodle − 1 per noodle. */
  readonly segmentCount: number
  /** A copy of options.radiusProfile, or null. */
  readonly radiusProfile: Float32Array | null
  /** The widest particle's radius: radius × the largest of radiusProfile. */
  readonly maxRadius: number
  /** Per particle xyz and inverse mass, object space, noodle after noodle. */
  readonly particlePositions: StorageBufferNode<'vec4'>
  /** A grab holds a particle. */
  readonly isGrabbing: boolean
  /** pick()'s answer: [0] the hit distance's float bits, [1] the particle (0xffffffff: none). */
  readonly pickResult: StorageBufferNode<'uint'>
  /** The storage and uniform nodes, for extraPasses and options.noodleHook. */
  readonly nodes: NoodleSimulationNodes

  /** A per-particle value at the drawn vertex, `read(i)` mixed along its span, for the material's vertex stage. */
  alongNoodle<TNodeType>(read: (i: Node<'uint'>) => Node<TNodeType>): Node<TNodeType>
  /** Emits TSL that calls body(c) for each Plane / Sphere / Box3 / Capsule collider index, in list order. */
  forEachCollider(
    noodle: Node | number,
    body: (c: Node<'int'>) => void,
    options?: ForEachColliderOptions,
  ): Node

  /** Every noodle back on its curve, at rest, at the next update(). */
  reset(): this
  /** Grabs a particle (from pickAsync()) and its neighbours until endGrab(). */
  startGrab(particle: number): this
  /** Where the grabbed particle goes, world space, swept over the next update's substeps. */
  moveGrab(point: Vector3): this
  /** Lets go: the noodle keeps the grab's velocity. */
  endGrab(): this
  /** Finds the particle nearest along the ray at the next update(), on the GPU, into pickResult. */
  pick(raycaster: Raycaster, options?: NoodlePickOptions): this
  /** Grabs what pick(), called first in the same frame, finds at the next update(). */
  grabPicked(): this
  /** Where a grabPicked() grab goes: along this ray, world space, at the distance the pick found. */
  moveGrabAlongRay(ray: Ray): this
  /** The particle nearest along the ray, in one readback; raycasts skip the noodles. */
  pickAsync(raycaster: Raycaster, options?: NoodlePickOptions): Promise<NoodlePickResult | null>
  readParticlesAsync(): Promise<NoodleParticles>
  /** Reads the hash statistics since construction or reset() into `info`. */
  readInfoAsync(): Promise<NoodleSimulationInfo>

  /** Compiles the compute passes ahead of the first update(), grab or reset(). */
  compileAsync(renderer: Renderer): Promise<void>
  /** Steps `delta` × timeScale seconds and refreshes the tubes; 0 while paused. Default the time since last call. */
  update(renderer: Renderer, delta?: number): void
  /** Frees the GPU resources and removes the noodles and their helpers. */
  dispose(): void
}

/** The capsules of a NoodleSimulation as the solver collides them; disposed with the noodles. */
export declare class NoodleSimulationHelper extends Mesh<CapsuleGeometry, MeshStandardNodeMaterial> {
  constructor(noodles: NoodleSimulation<Material>)

  readonly isNoodleSimulationHelper: true

  readonly noodles: NoodleSimulation<Material>
}
