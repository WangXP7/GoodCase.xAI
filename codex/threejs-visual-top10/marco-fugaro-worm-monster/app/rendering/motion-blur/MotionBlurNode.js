/**
 * MotionBlurNode - tile-based motion blur, object and camera, for three's WebGPU post-processing
 *
 * A reconstruction filter after McGuire, Guertin, Jimenez (CoD AW) and EEVEE, built for tile-based GPUs: one compute
 * pass per frame and a gather inside the consumer's pass.
 *
 * 1. MotionBlur.Prep (compute, one 8×8 workgroup per 32×32-px tile): each pixel's motion as a shutter-scaled radius
 *    (half the streak), clamped to maxBlurRadius. With the three amounts equal that is the velocity MRT, and on the sky
 *    the camera's rotation (three's background velocity is wrong); otherwise object and camera motion (from depth)
 *    weighted apart. Writes (v, view distance, |v|) per 2×2 block from its closest pixel, and per tile the largest
 *    velocity, smallest length, direction coherence and depth range.
 * 2. MotionBlur.Neighbors (compute, one lane per tile): the largest velocity among the tiles whose streak can reach
 *    this one, and whether the neighbourhood is uniform enough for the fast path.
 * 3. The gather, per pixel: the input as is where nothing near moves, a box blur along the pixel's own velocity in
 *    uniform neighbourhoods, else a depth-aware gather along the neighbourhood's velocity (alternating with the
 *    pixel's own), missing coverage filled with the pixel's own blurred background. Mirrored tap pairs on a jittered
 *    lattice, `sampleSpacing` px apart, up to `samples` taps. At resolutionScale 0.5 it runs as MotionBlur.Gather
 *    (compute, half resolution) and the consumer composites it with one bilinear fetch.
 *
 *   const scenePass = pass(scene, camera)
 *   scenePass.setMRT(mrt({ output, velocity })) // once, never swapped
 *   const velocityTexture = scenePass.getTexture('velocity') // RG16F: half the bytes of the RGBA16F default
 *   velocityTexture.type = THREE.HalfFloatType
 *   velocityTexture.format = THREE.RGFormat
 *   const blurred = motionBlur(scenePass.getTextureNode('output'), scenePass.getTextureNode('depth'), camera, {
 *     velocityNode: scenePass.getTextureNode('velocity'), // omit: camera motion only, no MRT needed
 *     resolutionScale: 0.5, // for large drawing buffers
 *     shutterAngle: 180,
 *   })
 *   renderPipeline.outputNode = blurred
 *   await blurred.compileAsync(renderer) // optional: compiles the compute passes ahead of the first frame
 *
 * Read it from a fullscreen pass (its result is per pixel at uv()). The numeric settings read as their uniform and take
 * a number; the plain ones are read on the CPU each frame. `velocityNode` and `resolutionScale` rebuild the compute
 * passes on the next frame, and `resolutionScale` changes the output's shader too: rebuild the output graph after
 * changing it. Call `resetHistory()` on teleports and camera switches, and when the node re-enters an output graph.
 */
import {
  HalfFloatType,
  LinearFilter,
  Matrix4,
  NearestFilter,
  NearestMipmapNearestFilter,
  Node,
  RGBAFormat,
  StorageTexture,
  TextureNode,
  Vector2,
} from 'three/webgpu'
import {
  abs,
  ceil,
  clamp,
  convertToTexture,
  dot,
  float,
  floor,
  fract,
  Fn,
  getCurrentStack,
  globalId,
  If,
  int,
  interleavedGradientNoise,
  inverseSqrt,
  ivec2,
  length,
  localId,
  Loop,
  max,
  min,
  mix,
  NodeUpdateType,
  nodeObject,
  rtt,
  saturate,
  select,
  setCurrentStack,
  smoothstep,
  sqrt,
  step,
  texture,
  textureLoad,
  textureStore,
  uint,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
  velocity,
  workgroupArray,
  workgroupBarrier,
  workgroupId,
} from 'three/tsl'
import { CameraVelocity } from './utils/CameraVelocity.js'
import { advanceShutter } from './utils/shutter.js'

// The uniform-backed settings: [default, min, max, integer]. Each is a property whose getter returns the uniform and
// whose setter takes a number, clamped to its range.
const SETTINGS = {
  // scale of object motion (the velocity MRT minus the camera's)
  objectAmount: [1, -Infinity, Infinity],
  // scale of the camera's rotation (and zoom) motion
  cameraRotationAmount: [1, -Infinity, Infinity],
  // scale of the camera's translation (parallax) motion
  cameraTranslationAmount: [1, -Infinity, Infinity],
  // full-resolution px per frame: object motion below it fades out (static geometry's float residual), when the
  // amounts differ
  objectDeadZone: [0.5, 0, Infinity],
  // full-resolution px of radius: neighbourhoods moving less skip the gather; at least 1 at 0.5
  minVelocity: [0.5, 0, Infinity],
  // the most taps per pixel (pairs = samples / 2)
  samples: [16, 2, 64, true],
  // full-resolution px between taps before the samples cap
  sampleSpacing: [2, 0.25, Infinity],
  // the relative depth band of the foreground/background compare
  depthSoftness: [0.05, 1e-3, Infinity],
  // the neighbourhood's smallest/largest speed ratio that takes the fast path (above 1: never)
  fastPathRatio: [0.75, 0, Infinity],
  // the direction coherence |Σv| / Σ|v| the fast path needs (above 1 disables the fast path)
  fastPathCoherence: [0.95, 0, Infinity],
  // a neighbourhood whose depth range zmax/zmin − 1 is below this (one surface) takes the fast path whatever its speed
  // ratio; a mover that close to the surface behind it loses its smear over it (0: off)
  fastPathDepthRange: [0, 0, Infinity],
  // tiles: the random offset of the slow path's neighbourhood lookup (hides tile seams)
  tileJitter: [0.25, 0, Infinity],
}
const OPTIONS = [
  'velocityNode',
  'resolutionScale',
  'shutterAngle',
  'targetFrameRate',
  'deltaTime',
  'maxBlurRadius',
  'maxFrameGap',
  'noise',
  'alternateDirection',
  'cutRotation',
  'cutTranslation',
  ...Object.keys(SETTINGS),
]
const RESOLUTION_SCALES = [1, 0.5]
const TILE = 32 // full-resolution px per tile side: a multiple of 16, so no 8×8 workgroup straddles a tile at 0.5
const MAX_NEIGHBORS = 8 // tiles of reach around a tile; maxBlurRadius is capped to it
const MAX_PAIRS = 32
const HALF_MAX = 65504 // the largest half float: the sky's view distance, and the clamp of colour taps
const NEAREST_DISTANCE = 1e-4 // the smallest view distance stored
const GOLDEN_RATIO = 0.6180339887498949
const REACH_SLACK = 1.01 // the slow path's reach tests get 1 % of slack

const _identity = /* @__PURE__ */ new Matrix4()

// Why `renderer` can't run the node, or null.
function problemOf(renderer) {
  if (renderer.backend.isWebGPUBackend !== true) return 'needs the WebGPU backend; this renderer fell back to WebGL 2'
  if (renderer.logarithmicDepthBuffer === true) return 'a logarithmic depth buffer is not supported'
  return null
}

// Whether `texture` binds as multisampled (an MSAA pass's depth).
function isMultisampled(renderer, texture) {
  return renderer.backend.utils?.getTextureSampleData?.(texture)?.primarySamples > 1
}

// An rgba16float storage texture, point-sampled (NearestMipmapNearest keeps a sampler) or bilinear.
function storageTexture(name, filter = NearestFilter) {
  const result = new StorageTexture(1, 1)
  result.name = name
  result.format = RGBAFormat
  result.type = HalfFloatType
  result.generateMipmaps = false
  result.mipmapsAutoUpdate = false
  result.minFilter = filter === NearestFilter ? NearestMipmapNearestFilter : filter
  result.magFilter = filter
  return result
}

// A texture sample at `uvNode`, level 0, without a texture-matrix transform.
const sample = (node, uvNode) => texture(node, uvNode, float(0)).setUpdateMatrix(false)
// A texel load at integer `pixel`, likewise.
const load = (node, pixel) => textureLoad(node, pixel).setUpdateMatrix(false)

// Calls `callback(frame)` once per frame, before a shader that reaches it renders. It generates no code. Its readers
// refresh in full every frame, so a resize's new bindings reach them.
class MotionBlurFrameUpdateNode extends Node {
  static get type() {
    return 'MotionBlurFrameUpdateNode'
  }

  #callback

  constructor(callback) {
    super('void')
    this.#callback = callback
    this.updateBeforeType = NodeUpdateType.FRAME
  }

  setup(builder) {
    if (builder.observer !== null) builder.observer.hasNode = true
  }

  updateBefore(frame) {
    return this.#callback(frame)
  }
}

// A texture filled by `updateNode` before the shader renders; 0 on a renderer the node can't run on.
class MotionBlurTextureNode extends TextureNode {
  static get type() {
    return 'MotionBlurTextureNode'
  }

  constructor(updateNode, value) {
    super(value)
    this.updateNode = updateNode
    this.setUpdateMatrix(false)
  }

  setup(builder) {
    builder.getNodeProperties(this).updateNode = this.updateNode
    if (problemOf(builder.renderer) !== null) return vec4(0)
    return super.setup(builder)
  }

  // TextureNode's generate() ignores the node setup() returns
  generate(builder, output) {
    if (problemOf(builder.renderer) !== null) return builder.getNodeProperties(this).outputNode.build(builder, output)
    return super.generate(builder, output)
  }

  clone() {
    const node = new this.constructor(this.updateNode, this.value)
    node.uvNode = this.uvNode
    node.levelNode = this.levelNode
    node.biasNode = this.biasNode
    node.sampler = this.sampler
    node.depthNode = this.depthNode
    node.compareNode = this.compareNode
    node.gradNode = this.gradNode
    node.gatherNode = this.gatherNode
    node.offsetNode = this.offsetNode
    return node
  }
}

class MotionBlurNode extends Node {
  static get type() {
    return 'MotionBlurNode'
  }

  // the SETTINGS properties
  static {
    for (const name of Object.keys(SETTINGS)) {
      Object.defineProperty(this.prototype, name, {
        configurable: true,
        get() {
          return this.#u[name]
        },
        set(v) {
          this.#set(name, v)
        },
      })
    }
  }

  isMotionBlurNode = true

  /** Degrees: the fraction of the frame the shutter is open (180 = half the frame's motion). */
  shutterAngle = 180
  /** 0: the blur spans shutterAngle/360 of each frame's motion. N > 0: a fixed exposure of shutterAngle/360/N s. */
  targetFrameRate = 0
  /**
   * Seconds: the wall-clock interval the rendered motion spans; null measures the gap between runs. Set it when that
   * gap isn't the render interval (frame caps, captures); never scale it by a time scale.
   */
  deltaTime = null
  /** The largest blur radius (half a streak), as a fraction of the gather target's height; at most 8 tiles. */
  maxBlurRadius = 0.05
  /** Seconds: a longer measured gap between runs is a cut (no blur that frame), even when deltaTime is set. */
  maxFrameGap = 0.25
  /** 'static': a fixed noise pattern; 'animated': a new one every frame, for a temporal filter after it. */
  noise = 'static'
  /** Odd tap pairs follow the pixel's own velocity in mixed neighbourhoods. */
  alternateDirection = true

  #camera
  #velocityNode = null
  #resolutionScale = 1
  #needsBuild = true // the kernels don't match velocityNode and resolutionScale
  #dispatched = false // the kernels ran once: their pipelines exist
  #cameraVelocity = new CameraVelocity()
  #depthTexture
  #depthRead
  #colorRead
  #packed = storageTexture('MotionBlur.Packed')
  #tiles = storageTexture('MotionBlur.Tiles')
  #tileDepth = storageTexture('MotionBlur.TileDepth')
  #neighbors = storageTexture('MotionBlur.Neighbors')
  #gather = null
  #frameUpdate = new MotionBlurFrameUpdateNode((frame) => this.#runFrame(frame))
  #packedNode
  #neighborsNode
  #gatherNode = null
  #prepKernel
  #prepMultisampled = null // the depth's sample state the Prep was built for (null: not built yet)
  #neighborsKernel
  #gatherKernel = null
  #computeList = []
  #prepDispatch = [1, 1, 1]
  #neighborsDispatch = [1, 1, 1]
  #gatherDispatch = [1, 1, 1]
  #width = 0
  #height = 0
  #shutter = null
  #needsReset = false
  #frameIndex = 0
  #compiling = null
  #disposed = false
  #warned = false

  #u = Object.fromEntries(
    Object.entries(SETTINGS).map(([name, [value, , , integer]]) => [
      name,
      integer ? uniform(value, 'int') : uniform(value),
    ]),
  )

  #fullSizeU = uniform(new Vector2(1, 1)) // the depth's size (W, H)
  #fullSizeIntU = uniform(new Vector2(1, 1), 'ivec2')
  #inverseFullSizeU = uniform(new Vector2(1, 1))
  #gatherSizeU = uniform(new Vector2(1, 1)) // (ceil(W·g), ceil(H·g))
  #gatherSizeIntU = uniform(new Vector2(1, 1), 'ivec2')
  #tilesU = uniform(new Vector2(1, 1)) // (ceil(W/32), ceil(H/32))
  #tilesIntU = uniform(new Vector2(1, 1), 'ivec2')
  #neighborRadiusU = uniform(1, 'int') // tiles of reach R
  #maxRadiusU = uniform(1) // gather px
  #noiseOffsetU = uniform(0)
  #alternateU = uniform(1)
  #radiusScaleU = uniform(new Vector2(1, 1)) // NDC per frame → radius, full-res px (y down)
  #ndcScaleU = uniform(new Vector2(1, 1)) // pixel → NDC: pixel · scale + offset
  #ndcOffsetU = uniform(new Vector2(0, 0))
  #depthQU = uniform(new Vector2(1, 0)) // q = depth·x + y: 1/view distance (perspective) or view distance
  #skyQU = uniform(0) // q of the sky: 0 (1/∞) or the largest distance

  /**
   * @param {Node} colorNode - The HDR scene colour: a texture node, or any node (rendered to a texture first).
   * @param {TextureNode} depthNode - The scene depth: `pass.getTextureNode('depth')`, not logarithmic.
   * @param {Camera} camera - The camera the scene is rendered with (perspective for camera blur).
   * @param {object} [options] - Any setting property of the node, e.g. `{ velocityNode, shutterAngle: 270 }`.
   */
  constructor(colorNode, depthNode, camera, options = {}) {
    super('vec4')
    for (const key of Object.keys(options)) {
      if (OPTIONS.includes(key)) continue
      console.warn(`MotionBlurNode: unknown option "${key}". Options: ${OPTIONS.join(', ')}.`)
    }
    if (camera?.isCamera !== true) {
      throw new Error("MotionBlurNode: `camera` must be the scene camera (not three's motionBlur(input, velocity)).")
    }
    // convertToTexture() passes a sample() node as is
    const converted = convertToTexture(colorNode)
    this.colorNode = converted.isTextureNode === true ? converted : rtt(colorNode)
    this.depthNode = nodeObject(depthNode)
    this.#camera = camera
    this.updateBeforeType = NodeUpdateType.FRAME

    // the kernels read plain textures: nothing may render a pass from inside the compute pass
    this.#depthTexture = this.depthNode.value
    if (this.#depthTexture?.isTexture !== true) throw new Error('MotionBlurNode: `depthNode` must be a texture node.')
    this.#depthRead = texture(this.#depthTexture)
    this.#colorRead = texture(this.colorNode.value)

    this.#packedNode = nodeObject(new MotionBlurTextureNode(this.#frameUpdate, this.#packed))
    this.#neighborsNode = nodeObject(new MotionBlurTextureNode(this.#frameUpdate, this.#neighbors))

    for (const key of OPTIONS) {
      if (options[key] !== undefined) this[key] = options[key]
    }
    this.#buildKernels()
  }

  // ── Settings ────────────────────────────────────────────────────────

  /** The camera the scene is rendered with. */
  get camera() {
    return this.#camera
  }

  /** three's velocity MRT, for object motion; null blurs camera motion only. Rebuilds the compute passes. */
  get velocityNode() {
    return this.#velocityNode
  }
  set velocityNode(v) {
    const node = v ? nodeObject(v) : null
    if (node !== null && node.value?.isTexture !== true) {
      throw new Error("MotionBlurNode: `velocityNode` must be a texture node: pass.getTextureNode('velocity').")
    }
    if (node === this.#velocityNode) return
    this.#velocityNode = node
    this.#needsBuild = true
  }

  /**
   * 1, or 0.5: the gather's resolution relative to the depth's. Rebuilds the compute passes; rebuild the output graph
   * after changing it (`renderPipeline.needsUpdate = true`).
   */
  get resolutionScale() {
    return this.#resolutionScale
  }
  set resolutionScale(v) {
    if (!RESOLUTION_SCALES.includes(v)) {
      console.warn(`MotionBlurNode: resolutionScale ${v}: 1 or 0.5. Keeping ${this.#resolutionScale}.`)
      return
    }
    if (v === this.#resolutionScale) return
    this.#resolutionScale = v
    // the consumer's shader may rebuild before the kernels do: create the half-resolution texture here
    if (v !== 1 && this.#gather === null) {
      this.#gather = storageTexture('MotionBlur.Gather', LinearFilter)
      this.#gatherNode = nodeObject(new MotionBlurTextureNode(this.#frameUpdate, this.#gather))
    }
    this.#needsBuild = true
  }

  /** Radians per frame: a larger camera turn in one frame is a cut. */
  get cutRotation() {
    return this.#cameraVelocity.cutRotation
  }
  set cutRotation(v) {
    this.#cameraVelocity.cutRotation = v
  }

  /** World units per frame: a longer camera move in one frame is a cut (0: off). */
  get cutTranslation() {
    return this.#cameraVelocity.cutTranslation
  }
  set cutTranslation(v) {
    this.#cameraVelocity.cutTranslation = v
  }

  /** This frame's shutter scale: the streak is that × the frame's motion, 0 on a cut. */
  get shutterScale() {
    return this.#shutter?.shutterScale ?? 0
  }

  #set(name, v) {
    const [, lo, hi, integer] = SETTINGS[name]
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      console.warn(`MotionBlurNode: ${name} ${v}: a finite number in ${lo}–${hi}.`)
      return
    }
    let value = v
    if (value < lo || value > hi) {
      console.warn(`MotionBlurNode: ${name} ${v} is outside ${lo}–${hi}; clamped.`)
      value = Math.min(hi, Math.max(lo, value))
    }
    if (integer) value = Math.round(value)
    this.#u[name].value = value
  }

  /** The next frame is a cut (no blur; the camera history re-seeded). */
  resetHistory() {
    this.#needsReset = true
    this.#cameraVelocity.reset()
  }

  /** Compiles the compute passes ahead of the next frame. Frames while it runs pass the input through. Optional. */
  async compileAsync(renderer) {
    if (this.#disposed) return
    if (renderer.initialized !== true) await renderer.init()
    if (problemOf(renderer) !== null) return
    if (this.#compiling === null) this.#buildKernels()
    // after a dispatch the pipelines exist
    if (this.#dispatched) return
    // one at a time: a compile can't be stopped, and would bind a pass disposed meanwhile
    const kernels = [...this.#computeList]
    const run = (async () => {
      for (const kernel of kernels) {
        if (this.#disposed) return
        await renderer.compileComputeAsync(kernel)
      }
    })()
    const all = this.#compiling ? Promise.allSettled([this.#compiling, run]) : run
    this.#compiling = all
    try {
      await run
    } finally {
      if (this.#compiling === all) this.#compiling = null
    }
    // an option changed while an earlier compile ran: compile the rebuilt kernels too
    if (this.#needsBuild && !this.#disposed) {
      await all
      await this.compileAsync(renderer)
    }
  }

  // ── Frame ───────────────────────────────────────────────────────────

  updateBefore(frame) {
    const { renderer } = frame
    // the inputs first, in the renderer's own state (FRAME-gated: nothing renders twice)
    for (const node of [this.depthNode, this.velocityNode, this.colorNode]) {
      if (node !== null) frame.updateBeforeNode(node.passNode ?? node)
    }
    // the kernels' colour follows an input that publishes a different texture each frame (a ping-pong history)
    this.#colorRead.value = this.colorNode.value
    // the camera as the scene was rendered
    const camera = this.#camera
    if (camera.matrixWorldAutoUpdate === true) camera.updateWorldMatrix(true, false)
    if (problemOf(renderer) !== null || this.#compiling !== null || this.#disposed) return
    this.#buildKernels()

    const width = this.#depthTexture.image?.width ?? 0
    const height = this.#depthTexture.image?.height ?? 0
    if (!(width >= 1 && height >= 1)) return
    const resized = this.#setSize(width, height)

    // the previous camera the velocity MRT used; without one, or before it is set, CameraVelocity's own history
    const projection = velocity.projectionMatrix ?? camera.projectionMatrix
    const previousProjection = velocity.previousProjectionMatrix.value
    const previous =
      this.velocityNode !== null && !previousProjection.equals(_identity)
        ? { view: velocity.previousCameraViewMatrix.value, projection: previousProjection }
        : null
    const cameraCut = this.#cameraVelocity.update(camera, projection, previous).cut
    this.#shutter = advanceShutter(this.#shutter, {
      time: frame.time,
      deltaTime: this.deltaTime,
      shutterAngle: this.shutterAngle,
      targetFrameRate: this.targetFrameRate,
      maxFrameGap: this.maxFrameGap,
      cut: resized || this.#needsReset || cameraCut,
    })
    this.#needsReset = false

    // user uniforms are applied in the shaders (their onFrameUpdate runs after this)
    const g = this.#resolutionScale
    const tileSize = TILE * g
    const radius = Math.max(0, this.maxBlurRadius) * Math.ceil(height * g)
    const maxRadius = Number.isFinite(radius) ? Math.min(radius, MAX_NEIGHBORS * tileSize) : 0
    this.#maxRadiusU.value = maxRadius
    this.#neighborRadiusU.value = Math.min(Math.max(Math.ceil(maxRadius / tileSize), 1), MAX_NEIGHBORS)
    this.#noiseOffsetU.value = this.noise === 'animated' ? (this.#frameIndex * GOLDEN_RATIO) % 1 : 0
    this.#alternateU.value = this.alternateDirection ? 1 : 0
    const halfShutter = 0.5 * this.#shutter.shutterScale
    this.#radiusScaleU.value.set(0.5 * width * halfShutter, -0.5 * height * halfShutter)
    this.#ndcScaleU.value.set(2 / width, -2 / height)
    this.#ndcOffsetU.value.set(1 / width - 1, 1 - 1 / height)
    const e = projection.elements
    const perspective = camera.isPerspectiveCamera === true
    if (perspective) this.#depthQU.value.set(1 / e[14], e[10] / e[14])
    else this.#depthQU.value.set(-1 / e[10], e[14] / e[10])
    this.#skyQU.value = perspective ? 0 : HALF_MAX

    // a Prep built before the pass's first build (compileAsync) may have the wrong depth type
    if (this.#prepMultisampled !== null && this.#prepMultisampled !== isMultisampled(renderer, this.#depthTexture)) {
      this.#prepKernel.dispose()
      this.#prepKernel = this.#withoutStack(() => this.#buildPrep())
      this.#prepKernel.dispatchSize = this.#prepDispatch
      this.#computeList[0] = this.#prepKernel
      this.#prepMultisampled = null
    }

    // one compute pass: every uniform is set by now
    renderer.compute(this.#computeList)
    this.#dispatched = true
    this.#frameIndex++
  }

  setup(builder) {
    const problem = problemOf(builder.renderer)
    if (problem !== null) {
      if (!this.#warned) {
        this.#warned = true
        console.warn(`MotionBlurNode: ${problem}. The output is the input colour.`)
      }
      return this.colorNode
    }
    // the inputs' producers register before this node
    this.colorNode.build(builder)
    this.depthNode.build(builder)
    this.velocityNode?.build(builder)

    const taps = this.#inlineTaps()
    if (this.#resolutionScale === 1) {
      return Fn(() => {
        const color = taps.color(uv()).toVar()
        const result = this.#gatherAt(uv().mul(this.#gatherSizeU), taps)
        const output = color.toVar()
        If(result.a.greaterThan(0), () => {
          output.assign(vec4(min(color.rgb, vec3(HALF_MAX)).mul(result.a.oneMinus()).add(result.rgb), color.a))
        })
        return output
      })()
    }
    return Fn(() => {
      const color = taps.color(uv()).toVar()
      const blurred = sample(this.#gatherNode, uv()).toVar()
      const blended = vec4(min(color.rgb, vec3(HALF_MAX)).mul(blurred.a.oneMinus()).add(blurred.rgb), color.a)
      return select(blurred.a.greaterThan(0), blended, color).uniformFlow()
    })()
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    super.dispose()
    const free = () => {
      for (const kernel of this.#computeList) kernel.dispose()
      for (const target of [this.#packed, this.#tiles, this.#tileDepth, this.#neighbors, this.#gather])
        target?.dispose()
    }
    // a compile in flight would bind what is freed meanwhile
    if (this.#compiling !== null) this.#compiling.then(free, free)
    else free()
  }

  // The frame's dispatches, once, whichever reader asks first.
  #runFrame(frame) {
    frame.updateBeforeNode(this)
  }

  // Sizes from the depth's (W, H); true when they changed (a cut).
  #setSize(width, height) {
    if (width === this.#width && height === this.#height) return false
    this.#width = width
    this.#height = height
    const g = this.#resolutionScale
    const gatherWidth = Math.ceil(width * g)
    const gatherHeight = Math.ceil(height * g)
    const tilesX = Math.ceil(width / TILE)
    const tilesY = Math.ceil(height / TILE)
    this.#packed.setSize(Math.ceil(width / 2), Math.ceil(height / 2))
    this.#gather?.setSize(gatherWidth, gatherHeight)
    for (const target of [this.#tiles, this.#tileDepth, this.#neighbors]) target.setSize(tilesX, tilesY)
    this.#fullSizeU.value.set(width, height)
    this.#fullSizeIntU.value.set(width, height)
    this.#inverseFullSizeU.value.set(1 / width, 1 / height)
    this.#gatherSizeU.value.set(gatherWidth, gatherHeight)
    this.#gatherSizeIntU.value.set(gatherWidth, gatherHeight)
    this.#tilesU.value.set(tilesX, tilesY)
    this.#tilesIntU.value.set(tilesX, tilesY)
    this.#prepDispatch[0] = tilesX
    this.#prepDispatch[1] = tilesY
    this.#neighborsDispatch[0] = Math.ceil(tilesX / 8)
    this.#neighborsDispatch[1] = Math.ceil(tilesY / 8)
    this.#gatherDispatch[0] = Math.ceil(gatherWidth / 8)
    this.#gatherDispatch[1] = Math.ceil(gatherHeight / 8)
    return true
  }

  // ── Build ───────────────────────────────────────────────────────────

  // The kernels for the current velocityNode and resolutionScale, replacing stale ones. The next frame is a cut.
  #buildKernels() {
    if (!this.#needsBuild) return
    this.#needsBuild = false
    for (const kernel of this.#computeList) kernel.dispose()
    if (this.#resolutionScale === 1 && this.#gather !== null) {
      this.#gather.dispose()
      this.#gather = null
      this.#gatherNode = null
    }
    this.#prepKernel = this.#withoutStack(() => this.#buildPrep())
    this.#prepKernel.dispatchSize = this.#prepDispatch
    this.#prepMultisampled = null
    this.#neighborsKernel = this.#withoutStack(() => this.#buildNeighbors())
    this.#neighborsKernel.dispatchSize = this.#neighborsDispatch
    this.#computeList = [this.#prepKernel, this.#neighborsKernel]
    this.#gatherKernel = null
    if (this.#resolutionScale !== 1) {
      this.#gatherKernel = this.#withoutStack(() => this.#buildGather())
      this.#gatherKernel.dispatchSize = this.#gatherDispatch
      this.#computeList.push(this.#gatherKernel)
    }
    this.#dispatched = false
    // the sizes follow the scale
    this.#width = 0
    this.#height = 0
  }

  // Kernels built outside any TSL stack the caller is in.
  #withoutStack(build) {
    const stack = getCurrentStack()
    setCurrentStack(null)
    try {
      return build()
    } finally {
      setCurrentStack(stack)
    }
  }

  // The consumer's taps: nodes that run the frame before the consumer renders
  #inlineTaps() {
    return {
      color: (uvNode) => sample(this.colorNode, uvNode),
      packed: (uvNode) => sample(this.#packedNode, uvNode),
      neighbors: (uvNode) => sample(this.#neighborsNode, uvNode),
    }
  }

  // The Gather kernel's taps: plain textures
  #kernelTaps() {
    const packed = texture(this.#packed)
    const neighbors = texture(this.#neighbors)
    return {
      color: (uvNode) => sample(this.#colorRead, uvNode),
      packed: (uvNode) => sample(packed, uvNode),
      neighbors: (uvNode) => sample(neighbors, uvNode),
    }
  }

  /**
   * The prep of full-resolution `pixel` (ivec2, in bounds): the radius vector `v` (full-res px), its length `len`, the
   * raw depth, whether it is sky, and `q` (affine in depth, with the view distance's relative spread). `texels`
   * ({ depth, velocity }) are the pixel's, already fetched.
   */
  #prepAt(pixel, reversed, texels) {
    const depth = texels.depth.toVar()
    const isSky = (reversed ? depth.lessThanEqual(0) : depth.greaterThanEqual(1)).toVar()
    const v = vec2(0).toVar()
    const objectAmount = this.#u.objectAmount
    const rotationAmount = this.#u.cameraRotationAmount
    const scale = this.#radiusScaleU
    const split = () => {
      const { object, rotation, translation } = this.#partsAt(pixel, depth, isSky, texels.velocity)
      v.assign(
        object
          .mul(objectAmount)
          .add(rotation.mul(rotationAmount))
          .add(translation.mul(this.#u.cameraTranslationAmount))
          .mul(scale),
      )
    }
    if (texels.velocity !== null) {
      const equal = objectAmount.equal(rotationAmount).and(rotationAmount.equal(this.#u.cameraTranslationAmount))
      If(equal, () => {
        If(isSky, () => {
          v.assign(this.#rotationAt(pixel).mul(rotationAmount).mul(scale))
        }).Else(() => {
          v.assign(texels.velocity.mul(objectAmount).mul(scale))
        })
      }).Else(split)
    } else {
      split()
    }
    // only Inf/NaN fail (huge finite vectors clamp); NaN-safe on fast math
    const maxRadius = this.#maxRadiusU.div(this.#resolutionScale)
    const key = dot(v, v).toVar()
    const valid = key.lessThan(1e30).toVar()
    const inverse = inverseSqrt(max(key, 1e-12)).toVar()
    const clamped = select(valid, v.mul(min(float(1), maxRadius.mul(inverse))), vec2(0))
      .uniformFlow()
      .toVar()
    const clampedLength = select(valid, min(key.mul(inverse), maxRadius), float(0))
      .uniformFlow()
      .toVar()
    const q = select(isSky, this.#skyQU, depth.mul(this.#depthQU.x).add(this.#depthQU.y)).uniformFlow().toVar()
    return { v: clamped, len: clampedLength, depth, isSky, q }
  }

  // The camera's rotation (and zoom) velocity at `pixel`, NDC per frame.
  #rotationAt(pixel) {
    const ndc = vec2(pixel).mul(this.#ndcScaleU).add(this.#ndcOffsetU).toVar()
    const h = this.#cameraVelocity.homography.mul(vec3(ndc, 1)).toVar()
    return ndc.sub(h.xy.div(max(h.z, 1e-6)))
  }

  // The motion at `pixel` split into object (after the dead zone), camera rotation and translation, NDC per frame.
  #partsAt(pixel, depth, isSky, velocity) {
    const ndc = vec2(pixel).mul(this.#ndcScaleU).add(this.#ndcOffsetU).toVar()
    const { rotation, full } = this.#cameraVelocity.velocityAt(ndc, depth, isSky)
    const translation = full.sub(rotation).toVar()
    // three's background velocity is wrong: the sky's MRT is ignored
    const mrt = velocity ?? full
    const objectRaw = select(isSky, vec2(0), mrt.sub(full)).uniformFlow().toVar()
    // the dead zone, in full-res px per frame (squared: no root)
    const objectPx = objectRaw.mul(this.#fullSizeU).mul(0.5)
    const deadZone = this.#u.objectDeadZone
    const fade = smoothstep(deadZone.mul(deadZone), deadZone.mul(2).add(1e-3).pow(2), dot(objectPx, objectPx))
    return { object: objectRaw.mul(fade).toVar(), rotation, translation, full }
  }

  // The view distance (sky 65504) of raw `depth`.
  #distanceOf(depth, isSky) {
    const distance = clamp(this.#cameraVelocity.viewDistanceAt(depth), NEAREST_DISTANCE, HALF_MAX)
    return select(isSky, float(HALF_MAX), distance).uniformFlow()
  }

  // MotionBlur.Prep: one workgroup per 32×32 tile. Lane (lx, ly) owns the blocks (lx + 8i, ly + 8j), i, j ∈ {0, 1}, of
  // the tile's 16×16 blocks of 2×2 px.
  #buildPrep() {
    const g = this.#resolutionScale
    const packed = this.#packed
    const tiles = this.#tiles
    const tileDepth = this.#tileDepth
    const depthTexture = this.#depthTexture
    const velocityTexture = this.velocityNode?.value ?? null
    const kernel = Fn((builder) => {
      const reversed = builder.renderer.reversedDepthBuffer === true
      // a multisampled depth can't be gathered: sample 0 of each texel instead
      const multisampled = isMultisampled(builder.renderer, depthTexture)
      this.#prepMultisampled = multisampled
      // (vmax.x, vmax.y, |vmax|², minLen), (Σv.x, Σv.y, Σ|v|, 0), (qmin, qmax, 0, 0)
      const largest = workgroupArray('vec4', 64)
      const sums = workgroupArray('vec4', 64)
      const ranges = workgroupArray('vec4', 64)
      const lane = localId.y.mul(uint(8)).add(localId.x).toVar()
      const tile = ivec2(workgroupId.xy).toVar()
      const last = this.#fullSizeIntU.sub(1).toVar()
      const best = vec3(0, 0, -1).toVar()
      const shortest = float(HALF_MAX).toVar()
      const sum = vec3(0).toVar()
      const range = vec2(HALF_MAX, 0).toVar()

      // every in-bounds pixel enters the tile's accumulators
      const accumulate = (r, inside) => {
        const m = float(inside).toVar()
        const key = dot(r.v, r.v).toVar()
        const take = step(best.z, key).mul(m)
        best.assign(mix(best, vec3(r.v, key), take))
        shortest.assign(min(shortest, mix(float(HALF_MAX), r.len, m)))
        sum.addAssign(vec3(r.v, r.len).mul(m))
        range.assign(vec2(min(range.x, mix(float(HALF_MAX), r.q, m)), max(range.y, r.q.mul(m))))
      }

      Loop({ start: int(0), end: int(4), type: 'int', condition: '<' }, ({ i }) => {
        const block = ivec2(int(localId.x).add(i.bitAnd(1).mul(8)), int(localId.y).add(i.shiftRight(1).mul(8))).toVar()
        const base = tile.mul(TILE).add(block.mul(2)).toVar()
        // one gather per channel around the block's corner: w (0, 0), z (1, 0), x (0, 1), y (1, 1)
        const corner = vec2(base.add(1)).mul(this.#inverseFullSizeU).toVar()
        const depthAt = (dx, dy) => load(this.#depthRead, min(base.add(ivec2(dx, dy)), last)).x
        const depths = multisampled
          ? vec4(depthAt(0, 1), depthAt(1, 1), depthAt(1, 0), depthAt(0, 0)).toVar()
          : texture(depthTexture, corner).gather().setUpdateMatrix(false).toVar()
        const velocityX = velocityTexture
          ? texture(velocityTexture, corner).gather(int(0)).setUpdateMatrix(false).toVar()
          : null
        const velocityY = velocityTexture
          ? texture(velocityTexture, corner).gather(int(1)).setUpdateMatrix(false).toVar()
          : null
        // the block's closest pixel by raw depth: (v, len) and depth
        const closest = vec3(0).toVar()
        const closestDepth = float(reversed ? -1 : 2).toVar()
        for (const [dx, dy, c] of [
          [0, 0, 'w'],
          [1, 0, 'z'],
          [0, 1, 'x'],
          [1, 1, 'y'],
        ]) {
          const pixel = base.add(ivec2(dx, dy)).toVar()
          const inside = pixel.x.lessThanEqual(last.x).and(pixel.y.lessThanEqual(last.y)).toVar()
          const texels = { depth: depths[c], velocity: velocityX ? vec2(velocityX[c], velocityY[c]) : null }
          const r = this.#prepAt(min(pixel, last), reversed, texels)
          // a silhouette texel follows its foreground
          const nearer = reversed ? r.depth.greaterThan(closestDepth) : r.depth.lessThan(closestDepth)
          const closer = float(inside.and(nearer))
          closest.assign(mix(closest, vec3(r.v, r.len), closer))
          closestDepth.assign(mix(closestDepth, r.depth, closer))
          accumulate(r, inside)
        }
        If(base.x.lessThanEqual(last.x).and(base.y.lessThanEqual(last.y)), () => {
          const texel = tile.mul(TILE / 2).add(block)
          const isSky = reversed ? closestDepth.lessThanEqual(0) : closestDepth.greaterThanEqual(1)
          textureStore(packed, texel, vec4(closest.xy.mul(g), this.#distanceOf(closestDepth, isSky), closest.z.mul(g)))
        })
      })

      largest.element(lane).assign(vec4(best, shortest))
      sums.element(lane).assign(vec4(sum, 0))
      ranges.element(lane).assign(vec4(range, 0, 0))
      // tree reduction; barriers outside every If
      for (const stride of [32, 16, 8, 4, 2, 1]) {
        workgroupBarrier()
        If(lane.lessThan(uint(stride)), () => {
          const other = lane.add(uint(stride)).toVar()
          const a = largest.element(lane).toVar()
          const b = largest.element(other).toVar()
          const take = step(a.z, b.z)
          largest.element(lane).assign(vec4(mix(a.xyz, b.xyz, take), min(a.w, b.w)))
          sums.element(lane).assign(sums.element(lane).add(sums.element(other)))
          const c = ranges.element(lane).toVar()
          const d = ranges.element(other).toVar()
          ranges.element(lane).assign(vec4(min(c.x, d.x), max(c.y, d.y), 0, 0))
        })
      }
      If(lane.equal(uint(0)), () => {
        const a = largest.element(uint(0)).toVar()
        const s = sums.element(uint(0)).toVar()
        const zRange = ranges.element(uint(0)).toVar()
        const coherence = min(length(s.xy).div(max(s.z, 1e-3)), 1)
        const tileCoherence = select(s.z.greaterThan(1e-3), coherence, float(1)).uniformFlow()
        textureStore(tiles, tile, vec4(a.xy.mul(g), a.w.mul(g), tileCoherence))
        textureStore(tileDepth, tile, vec4(zRange.x, zRange.y, 0, 0))
      })
    })().computeKernel([8, 8, 1])
    kernel.name = 'MotionBlur.Prep'
    return kernel
  }

  // MotionBlur.Neighbors: one lane per tile. The largest velocity among the tiles whose streak can reach this one
  // (a diagonal test next to it, a line test further), and the fast-path flag from the smallest length, the smallest
  // coherence and the depth range of the tiles involved.
  #buildNeighbors() {
    const tileSize = TILE * this.#resolutionScale
    const tilesRead = texture(this.#tiles)
    const tileDepthRead = texture(this.#tileDepth)
    const neighbors = this.#neighbors
    const kernel = Fn(() => {
      const t = ivec2(globalId.xy).toVar()
      const count = this.#tilesIntU
      If(t.x.lessThan(count.x).and(t.y.lessThan(count.y)), () => {
        const center = load(tilesRead, t).toVar()
        const centerDepth = load(tileDepthRead, t).toVar()
        const best = center.xy.toVar()
        // a neighbour must be 1 % longer to replace the centre
        const bestKey = dot(center.xy, center.xy).mul(1.0201).toVar()
        const shortest = center.z.toVar()
        const coherence = center.w.toVar()
        const zMin = centerDepth.x.toVar()
        const zMax = centerDepth.y.toVar()
        const ownReach = ceil(length(center.xy).div(tileSize)).toVar() // tiles the centre's own taps can land in
        const radius = this.#neighborRadiusU
        const side = radius.mul(2).add(1).toVar()
        const last = count.sub(1).toVar()
        Loop(side, side, ({ i, j }) => {
          const offset = ivec2(j.sub(radius), i.sub(radius)).toVar()
          const ax = abs(offset.x).toVar()
          const ay = abs(offset.y).toVar()
          const chebyshev = max(ax, ay).toVar()
          const q = t.add(offset).toVar()
          const inRange = chebyshev
            .greaterThan(0)
            .and(q.x.greaterThanEqual(0))
            .and(q.y.greaterThanEqual(0))
            .and(q.x.lessThanEqual(last.x))
            .and(q.y.lessThanEqual(last.y))
            .toVar()
          const qc = clamp(q, ivec2(0), last).toVar()
          const n = load(tilesRead, qc).toVar()
          const nd = load(tileDepthRead, qc).toVar()
          const key = dot(n.xy, n.xy).toVar()
          const speed = sqrt(key).toVar()
          const o = vec2(offset).toVar()
          const c = float(chebyshev).toVar()
          // next to it: an edge tile always reaches; a diagonal one when its velocity points along that diagonal
          const near = ax
            .equal(0)
            .or(ay.equal(0))
            .or(n.x.mul(n.y).mul(o.x.mul(o.y)).greaterThan(0))
          // further: long enough, and its line passes within 1.5 tiles of the centre
          const far = speed
            .greaterThanEqual(c.sub(1).mul(tileSize))
            .and(abs(o.x.mul(n.y).sub(o.y.mul(n.x))).lessThanEqual(max(speed, 1e-6).mul(1.5)))
          const reaches = float(inRange.and(chebyshev.equal(1).and(near).or(chebyshev.greaterThan(1).and(far)))).toVar()
          const involved = max(reaches, float(inRange.and(c.lessThanEqual(ownReach)))).toVar()
          const take = reaches.mul(step(bestKey, key)).toVar()
          best.assign(mix(best, n.xy, take))
          bestKey.assign(mix(bestKey, key, take))
          shortest.assign(min(shortest, mix(float(HALF_MAX), n.z, involved)))
          coherence.assign(min(coherence, mix(float(1), n.w, involved)))
          zMin.assign(min(zMin, mix(float(HALF_MAX), nd.x, involved)))
          zMax.assign(max(zMax, nd.y.mul(involved)))
        })
        const lengthN = length(best).toVar()
        const depthRange = zMax.div(max(zMin, 1e-6)).sub(1)
        const uniformSpeed = shortest.greaterThanEqual(this.#u.fastPathRatio.mul(lengthN))
        const oneSurface = depthRange.lessThan(this.#u.fastPathDepthRange)
        const fast = coherence.greaterThanEqual(this.#u.fastPathCoherence).and(uniformSpeed.or(oneSurface))
        textureStore(neighbors, t, vec4(best, float(fast), lengthN))
      })
    })().computeKernel([8, 8, 1])
    kernel.name = 'MotionBlur.Neighbors'
    return kernel
  }

  // MotionBlur.Gather (resolutionScale 0.5): the gather at half resolution, (blurred · coverage, coverage).
  #buildGather() {
    const gather = this.#gather
    const taps = this.#kernelTaps()
    const kernel = Fn(() => {
      const pixel = ivec2(globalId.xy).toVar()
      const size = this.#gatherSizeIntU
      If(pixel.x.lessThan(size.x).and(pixel.y.lessThan(size.y)), () => {
        textureStore(gather, pixel, this.#gatherAt(vec2(pixel).add(0.5), taps))
      })
    })().computeKernel([8, 8, 1])
    kernel.name = 'MotionBlur.Gather'
    return kernel
  }

  // The gather at gather-px `p`: vec4 (blurred · coverage, coverage); (0, 0) where nothing near moves.
  #gatherAt(p, taps) {
    const g = this.#resolutionScale
    const tileSize = TILE * g
    const size = this.#gatherSizeU
    const result = vec4(0).toVar()
    // the unjittered neighbourhood: the only fetch before the early-out
    const center = taps.neighbors(floor(p.div(tileSize)).add(0.5).div(this.#tilesU)).toVar()
    // gather px; at half resolution under 1 full-res px would only soften
    const threshold = max(this.#u.minVelocity.mul(g), float(g < 1 ? 0.5 : 0)).toVar()
    const moving = center.w.greaterThan(threshold).toVar()
    If(moving, () => {
      const puv = p.div(this.#gatherSizeU).toVar()
      const packed = taps.packed(puv).toVar()
      const pixel = floor(p).toVar()
      const n1 = fract(interleavedGradientNoise(pixel).add(this.#noiseOffsetU)).toVar()
      const n2 = fract(interleavedGradientNoise(pixel.yx).add(this.#noiseOffsetU)).toVar()
      const spacing = max(this.#u.sampleSpacing, 0.25).mul(g).toVar()
      const maxPairs = clamp(this.#u.samples.shiftRight(int(1)), int(1), int(MAX_PAIRS)).toVar()
      const pairsFor = (len) => clamp(int(ceil(len.div(spacing))), int(1), maxPairs).toVar()
      const vC = packed.xy.toVar()
      const zC = packed.z.toVar()
      const lenC = packed.w.toVar()
      const jitter = n1.sub(0.5).toVar()
      const color = (uvNode) => min(taps.color(uvNode).rgb, vec3(HALF_MAX))

      If(center.z.greaterThan(0.5), () => {
        // FAST: a box blur along the pixel's own velocity
        const pairs = pairsFor(lenC)
        const delta = lenC.div(float(pairs)).toVar() // the lattice step, gather px
        const stepUV = vC.div(max(lenC, 1e-4)).mul(delta).div(size).toVar()
        // 4 pairs per iteration, their fetches independent; pairs past the count weigh 0
        const sum = vec3(0).toVar()
        const rounds = pairs.add(3).shiftRight(int(2)).toVar()
        Loop({ start: int(0), end: rounds, type: 'int', condition: '<' }, ({ i }) => {
          for (let u = 0; u < 4; u++) {
            const index = i.mul(4).add(u).toVar()
            const k = float(index).add(0.5).toVar()
            const pair = color(puv.add(stepUV.mul(k.add(jitter)))).add(color(puv.sub(stepUV.mul(k.sub(jitter)))))
            sum.addAssign(u === 0 ? pair : pair.mul(float(index.lessThan(pairs))))
          }
        })
        // continuous with the early-out: 1 from 1 full-res px above the threshold
        const coverage = saturate(lenC.sub(threshold).div(g)).toVar()
        result.assign(vec4(sum.mul(coverage.div(float(pairs).mul(2))), coverage))
      }).Else(() => {
        // SLOW: along the neighbourhood's velocity (odd pairs along the pixel's own), depth-aware. The neighbourhood
        // from a jittered tile (hides tile seams), never shorter than the centre.
        const tileJitter = vec2(n1, n2).mul(2).sub(1).mul(this.#u.tileJitter.mul(tileSize))
        const jitteredTile = clamp(floor(p.add(tileJitter).div(tileSize)), vec2(0), this.#tilesU.sub(1))
        const nm = taps.neighbors(jitteredTile.add(0.5).div(this.#tilesU)).toVar()
        const own = step(nm.w, packed.w).toVar()
        const vN = mix(nm.xy, packed.xy, own).toVar()
        const lenN = max(mix(nm.w, packed.w, own), 1e-4).toVar()
        const pairs = pairsFor(lenN)
        const delta = lenN.div(float(pairs)).toVar() // the lattice step, gather px
        const invDelta = float(1).div(delta).toVar()
        // reaches in lattice steps get 1 % of slack, so the fastest pixel covers the whole lattice despite half floats
        const reachScale = invDelta.mul(REACH_SLACK).toVar()
        const dirN = vN.div(lenN).toVar()
        // the pixel's own direction on odd pairs, where it moves at least half the neighbourhood's speed
        const ownDirection = this.#alternateU.mul(step(lenN, lenC.mul(2)))
        const dirA = mix(dirN, vC.div(max(lenC, 1e-4)), ownDirection).toVar()
        // per direction: UV per lattice step, the reach test's direction in steps, the centre's reach in steps
        const uvN = dirN.mul(delta).div(size).toVar()
        const uvA = dirA.mul(delta).div(size).toVar()
        const reachN = dirN.mul(reachScale).toVar()
        const reachA = dirA.mul(reachScale).toVar()
        const centerN = abs(dot(vC, dirN)).mul(reachScale).toVar()
        const centerA = abs(dot(vC, dirA)).mul(reachScale).toVar()
        // behind the centre (by depthSoftness of its distance) is background: bg = saturate(z·invSoft + bias)
        const invSoft = float(1).div(max(this.#u.depthSoftness, 1e-3).mul(zC)).toVar()
        const bias = float(0.5).sub(zC.mul(invSoft)).toVar()
        const forward = float(0.5).add(jitter).toVar()
        const backward = float(0.5).sub(jitter).toVar()
        const sum = vec4(0).toVar()
        const back = vec4(0).toVar()
        // pair `index` along `dirN` (even) or the alternate direction (odd); `valid` 0 past the count
        const slowPair = (index, odd, valid) => {
          const stepUV = odd ? uvA : uvN
          const reach = odd ? reachA : reachN
          // both taps of pair k sample lattice cell k: a blur of r steps covers saturate(r − k) of it
          const k = float(index).toVar()
          const coversSample = saturate((odd ? centerA : centerN).sub(k)).toVar() // the centre's blur covers it
          for (const [sign, offset] of [
            [1, forward],
            [-1, backward],
          ]) {
            const t = k.add(offset).toVar()
            const q = (sign > 0 ? puv.add(stepUV.mul(t)) : puv.sub(stepUV.mul(t))).toVar()
            const tapColor = color(q).toVar()
            const tap = taps.packed(q).toVar()
            const background = saturate(tap.z.mul(invSoft).add(bias)).toVar()
            const reachesCenter = saturate(abs(dot(tap.xy, reach)).sub(k)) // its blur reaches the centre
            let weightBack = background.mul(coversSample)
            let weight = weightBack.add(background.oneMinus().mul(reachesCenter))
            if (valid !== null) {
              weightBack = weightBack.mul(valid)
              weight = weight.mul(valid)
            }
            weightBack = weightBack.toVar()
            weight = weight.toVar()
            sum.addAssign(vec4(tapColor.mul(weight), weight))
            back.addAssign(vec4(tapColor.mul(weightBack), weightBack))
          }
        }
        // two pairs per iteration (the direction known per pair), the second past the count weighs 0
        const rounds = pairs.add(1).shiftRight(int(1)).toVar()
        Loop({ start: int(0), end: rounds, type: 'int', condition: '<' }, ({ i }) => {
          const even = i.mul(2).toVar()
          slowPair(even, false, null)
          const odd = even.add(1).toVar()
          slowPair(odd, true, float(odd.lessThan(pairs)).toVar())
        })
        // missing coverage filled with the centre's own background layer, the raw centre only as a last resort
        const taken = float(pairs).mul(2).toVar()
        const alpha = saturate(sum.w.div(taken)).toVar()
        const epsilon = float(1).div(taken.mul(50)).toVar()
        const fill = alpha.oneMinus().div(back.w.add(epsilon)).toVar()
        const blurred = sum.rgb.div(taken).add(back.rgb.mul(fill))
        // the fast path's ramp, on the neighbourhood's length
        const ramp = saturate(lenN.sub(threshold).div(g)).toVar()
        result.assign(vec4(blurred.mul(ramp), float(1).sub(fill.mul(epsilon)).mul(ramp)))
      })
    })
    return result
  }
}

/**
 * Tile-based object and camera motion blur; not three's `motionBlur(input, velocity)`.
 *
 * @param {Node} colorNode - The scene colour.
 * @param {TextureNode} depthNode - The scene depth: `pass.getTextureNode('depth')`.
 * @param {Camera} camera - The scene camera.
 * @param {object} [options] - See the constructor.
 * @returns {MotionBlurNode}
 */
function motionBlur(colorNode, depthNode, camera, options) {
  if (depthNode?.value?.isDepthTexture !== true) {
    console.warn("motionBlur: depthNode isn't a depth texture node; expected pass.getTextureNode('depth').")
  }
  return nodeObject(new MotionBlurNode(colorNode, depthNode, camera, options))
}

export { MotionBlurNode, motionBlur }
