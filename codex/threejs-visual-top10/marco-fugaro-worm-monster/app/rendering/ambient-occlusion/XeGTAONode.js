/**
 * XeGTAONode - XeGTAO ground-truth ambient occlusion at a fraction of the resolution, denoised and accumulated
 *
 * XeGTAO's horizon-slice kernel (cosine-domain horizon search, closed-form arc integral, lerp-to-horizon falloff,
 * thin-occluder compensation, quadratic stepping), in passes built for cost on tile-based GPUs:
 *
 * 1. Prefilter: the closest depth of each AO texel's footprint, read once and linearized to view distance (R32F). A
 *    texel is stored negative where the kernel should see a change: its surface is new to the history (an occluder
 *    moved in or out) or, with a velocity node, its whole footprint moves on its own. With a velocity node it also
 *    writes the footprint's object motion (RG16F).
 * 2. AO: 2 slices × 3 steps per side. The slice rotation and step jitter come from a 4×4 tile, a 16-point lattice
 *    ranked by a Bayer matrix, so any 4×4 block of pixels holds all 16 combinations. Writes the AO and the view
 *    distance (RG16F), the distance negative when a tap landed on a marked texel. Background pixels and pixels past
 *    `fadeEnd` skip the march.
 * 3. Denoise: a 4×4 box matched to the tile (8 gathers), each tap weighted by how well its depth fits the center's
 *    plane. On open surfaces it averages exactly the 16 combinations, so the noise cancels.
 * 4. Accumulate, in the denoise pass: the tile moves every frame, so the taps land at new distances, and the box's
 *    result blends over the history reprojected through the camera (and along the motion vectors, with a velocity
 *    node). The history (RGBA16F: AO, distance, length, variance) is clamped to a variance band around the box's mean;
 *    its length shrinks where it strays past that band, where the view moves fast and where a tap saw a marked texel,
 *    and texels off the point's surface are dropped. Two targets alternate, so nothing is copied.
 * 5. Upsample, in the consumer's shader: a 2×2 joint bilateral upsample (two gathers and a depth compare).
 *
 * As a post effect:
 *
 *   const aoPass = xeGTAO(scenePass.getTextureNode('depth'), camera, { radius: 0.3 }) // world units
 *   renderPipeline.outputNode = vec4(scenePassColor.rgb.mul(aoPass.getAONode()), scenePassColor.a)
 *   await aoPass.compileAsync(renderer) // optional: compiles its passes ahead of the first frame
 *
 * With motion vectors (an MRT can't change at runtime, so the scene pass writes velocity from its first render):
 *
 *   scenePass.setMRT(mrt({ output, velocity }))
 *   scenePass.getTexture('velocity').type = HalfFloatType
 *   scenePass.getTexture('velocity').format = RGFormat
 *   const aoPass = xeGTAO(depth, camera, { velocityNode: scenePass.getTextureNode('velocity') })
 *
 * On the ambient light alone: run it on an opaque prepass's depth and hand it to the scene pass's materials. The
 * prepass must not read it, or it would run on the previous frame's depth.
 *
 *   const prePass = pass(scene, camera)
 *   prePass.transparent = false
 *   prePass.contextNode = context({ getAO: null })
 *   const aoPass = xeGTAO(prePass.getTextureNode('depth'), camera)
 *   scenePass.contextNode = builtinAOContext(aoPass.getMaterialAONode())
 *
 * `normalNode`, `velocityNode`, `sliceCount`, `stepsPerSlice` and `resolutionScale` are baked into the shaders and
 * rebuild them on the next frame when changed; the switches route at render time; every other setting is a uniform.
 *
 * References:
 * - https://github.com/GameTechDev/XeGTAO (XeGTAO.hlsli, XeGTAO.h)
 * - Practical Realtime Strategies for Accurate Indirect Occlusion (Activision): the 4×4 tile and matched blur
 * - Spatiotemporal Variance-Guided Filtering (Schied et al.): the history length and the variance band
 */
import {
  FloatType,
  HalfFloatType,
  Matrix4,
  NearestFilter,
  NearestMipmapNearestFilter,
  Node,
  NodeMaterial,
  QuadMesh,
  RedFormat,
  RenderTarget,
  RendererUtils,
  RGBAFormat,
  RGFormat,
  UnsignedByteType,
  Vector2,
} from 'three/webgpu'
import {
  abs,
  clamp,
  context,
  cos,
  dot,
  exp,
  float,
  floor,
  fract,
  Fn,
  HALF_PI,
  If,
  ivec2,
  length,
  logarithmicDepthToViewZ,
  max,
  min,
  mix,
  mrt,
  NodeUpdateType,
  nodeObject,
  normalize,
  passTexture,
  perspectiveDepthToViewZ,
  PI,
  positionView,
  pow,
  property,
  reference,
  round,
  saturate,
  screenCoordinate,
  screenUV,
  select,
  sign,
  sin,
  smoothstep,
  sqrt,
  step,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { compileQuad } from './utils/compileQuad.js'

const _quadMesh = /* @__PURE__ */ new QuadMesh()
const _size = /* @__PURE__ */ new Vector2()
let _rendererState

const _goldenRatio = 0.6180339887498948
const _r2 = [0.7548776662466927, 0.5698402909980532] // the R2 sequence: the tile's shift within the lattice, per frame
const _bitReversed = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15] // lattice points, consecutive far apart
const _background = 65504 // the view distance of background texels: the largest half float
const _pixelTooCloseThreshold = 1.3 // AO px: closer taps would land on the center texel (XeGTAO)
const _edgeSharpness = 0.011 // the normal's depth-edge threshold, × view distance (XeGTAO)
const _minMotionThreshold = 0.05 // drawing-buffer px per frame: below it, float noise would move every sample
const _reprojectionNoise = 1e-3 // AO texels: more than a still view's float noise, less than motion

// The uniform-backed settings and their defaults. Each is an option and a property whose getter returns the uniform
// node and whose setter sets its value.
const SETTINGS = {
  // world units
  radius: 0.5,
  intensity: 1,
  // the visibility curve's exponent (XeGTAO FinalValuePower)
  power: 2.2,
  // the outer share of the radius over which taps fade out
  falloffRange: 0.615,
  // 0–0.7: stretches the falloff along view Z, so thin objects occlude less
  thinOccluder: 0,
  // drawing-buffer px: caps the radius on screen, at any AO resolution
  maxScreenRadius: 256,
  // the view distances where the AO starts fading out, and where it's gone
  fadeStart: 100,
  fadeEnd: 300,
  // step spacing along a slice, as a power of the step's fraction: 2 clusters the taps near the center
  sampleDistributionPower: 2,
  // × view distance: how far a denoise tap may sit off the center's plane
  denoiseTolerance: 0.011,
  // × view distance: how far an AO texel's depth may be from the pixel's in the upsample
  upsampleTolerance: 0.02,
  // the current frame's weight over a full history, 1 / its longest length: lower is smoother and slower to settle
  temporalAccumulationAlpha: 0.1,
  // × view distance: how far a history texel's depth may be from the point's last-frame depth, past its slope
  historyTolerance: 0.005,
  // how far the history may stray from the denoised AO, plus historyClampDeviation × its temporal deviation
  historyClamp: 0.01,
  historyClampDeviation: 3,
  // the history's length × exp(−historyDecay × how far it strays past the clamp by more than historyDecayThreshold)
  historyDecay: 5,
  historyDecayThreshold: 0.02,
  // drawing-buffer px of reprojection per frame that halve the history's length
  historyMotionSpeed: 2,
  // with changeDetection, × view distance: a depth change past the footprint's own range that marks a texel
  changeTolerance: 0.01,
  // with a velocity node, drawing-buffer px per frame (at least 0.05): object motion below it counts as still
  motionThreshold: 0.5,
  // the current frame's weight where a tap of the box saw a marked texel
  motionAccumulationAlpha: 0.8,
  // with motion vectors, the same where few of the box's kernel reads did (a thin occluder moving through)...
  sparseMotionAccumulationAlpha: 0.25,
  // ...and the share of the reads from which motionAccumulationAlpha applies in full
  denseChangeShare: 0.1,
}

const OPTIONS = [
  'normalNode',
  'velocityNode',
  'sliceCount',
  'stepsPerSlice',
  'resolutionScale',
  'denoise',
  'temporalAccumulation',
  'changeDetection',
  'motionVectors',
  ...Object.keys(SETTINGS),
]

// Lagarde's fast acos ([-1, 1] → [0, π]).
function fastAcos(x) {
  const ax = abs(x)
  const res = ax
    .mul(-0.156583)
    .add(HALF_PI)
    .mul(sqrt(max(float(0), ax.oneMinus())))
  return x.greaterThanEqual(0).select(res, PI.sub(res))
}

// The pixel's rank in a 4×4 Bayer matrix: neighbours get ranks far apart.
function bayer4(pixel) {
  const x = pixel.x.bitAnd(3)
  const y = pixel.y.bitAnd(3)
  const xy = x.bitXor(y)
  return xy
    .bitAnd(1)
    .shiftLeft(3)
    .bitOr(y.bitAnd(1).shiftLeft(2))
    .bitOr(xy.shiftRight(1).bitAnd(1).shiftLeft(1))
    .bitOr(y.shiftRight(1).bitAnd(1))
}

// Point-sampled with NearestMipmapNearest, not Nearest: three then samples through a sampler instead of turning every
// fetch into a textureLoad. `second` ({ name, format, type }) adds a texture that an mrt() output of that name fills.
function createTarget(name, format, type, second = null) {
  const target = new RenderTarget(1, 1, { depthBuffer: false, format, type, count: second ? 2 : 1 })
  for (const tex of target.textures) {
    tex.minFilter = NearestMipmapNearestFilter
    tex.magFilter = NearestFilter
    tex.generateMipmaps = false
  }
  target.texture.name = name
  if (second) Object.assign(target.textures[1], second)
  return target
}

// The texels of the 2×2 block with top-left (bx, by), in gather order: (x0, y1), (x1, y1), (x1, y0), (x0, y0).
function blockOffsets(bx, by) {
  return [
    [bx, by + 1],
    [bx + 1, by + 1],
    [bx + 1, by],
    [bx, by],
  ]
}

// The bilinear weights of a 2×2 gather at fraction f, in gather order.
function bilinearWeights(f) {
  return vec4(f.x.oneMinus().mul(f.y), f.x.mul(f.y), f.x.mul(f.y.oneMinus()), f.x.oneMinus().mul(f.y.oneMinus()))
}

// Whether a point reprojected to `point` (uv) and clip w lies on the previous frame's screen.
function onScreen(point, w) {
  return point
    .greaterThanEqual(vec2(0))
    .all()
    .and(point.lessThanEqual(vec2(1)).all())
    .and(w.greaterThan(0))
}

// The denoise plane's slope per axis: the flatter one-sided slope, except at a depth extremum (a wire, a gap or a
// speck one texel wide), where any slope would fit a neighbour of the other surface: there it is 0, unless the far
// side runs on in a line through the next tap (a crease).
function slopes(center, z, tolerance) {
  const lineTolerance = tolerance.mul(center).mul(0.25)
  const slope = (before, after, after2) => {
    const back = center.sub(before)
    const ahead = after.sub(center)
    const flatter = select(abs(back).lessThan(abs(ahead)), back, ahead)
    const extremum = back.mul(ahead).lessThan(0)
    const crease = abs(back)
      .greaterThanEqual(abs(ahead))
      .and(abs(after2.sub(center.add(ahead.mul(2)))).lessThan(lineTolerance))
    return select(extremum.and(crease.not()), float(0), flatter)
  }
  return {
    gx: slope(z(-1, 0), z(1, 0), z(2, 0)).toVar(),
    gy: slope(z(0, -1), z(0, 1), z(0, 2)).toVar(),
  }
}

// How well a tap at (dx, dy) of depth z fits the center: by its error against whichever of the center's depth and the
// center's plane fits it better, so a one-sided slope at an edge can't reject the flat side.
function tapWeight(dx, dy, z, center, gx, gy, scale) {
  if (dx === 0 && dy === 0) return float(1)
  let plane = center
  if (dx !== 0) plane = plane.add(gx.mul(dx))
  if (dy !== 0) plane = plane.add(gy.mul(dy))
  const error = min(abs(z.sub(center)), abs(z.sub(plane)))
  return saturate(float(1.25).sub(error.mul(scale))).toVar()
}

class XeGTAONode extends Node {
  static get type() {
    return 'XeGTAONode'
  }

  static {
    for (const name of Object.keys(SETTINGS)) {
      Object.defineProperty(this.prototype, name, {
        configurable: true,
        get() {
          return this.#u[name]
        },
        set(value) {
          if (typeof value !== 'number') {
            console.warn(`XeGTAONode: ${name} takes a number; drive its uniform with onFrameUpdate() instead.`)
            return
          }
          this.#u[name].value = value
        },
      })
    }
  }

  isXeGTAONode = true

  /** Horizon slices per pixel (XeGTAO: 1 low, 2 medium, 3 high). Baked into the shader. */
  sliceCount = 2
  /** Steps per side of each slice (XeGTAO: 2 low and medium, 3 high). Baked into the shader. */
  stepsPerSlice = 3
  /** The AO's resolution, as a fraction of the drawing buffer's. Baked into the prefilter. */
  resolutionScale = 0.5
  /** The 4×4 denoise, and the temporal accumulation that rides in it. Off shows the raw AO, a 4×4 dither. */
  denoise = true
  /** Moves the tile every frame and blends each result over the reprojected history. */
  temporalAccumulation = true
  /**
   * Shortens the history where an occluder moved in or out of the kernel's footprint: without a velocity node, all
   * that keeps a moved occluder from trailing. Off saves no fetches.
   */
  changeDetection = true
  /**
   * With a velocity node: reprojects what moves on its own along its motion vectors, and shortens the history where an
   * occluder in the kernel's footprint moves. Off, the camera alone reprojects; the passes still read the velocity.
   */
  motionVectors = true

  #u = Object.fromEntries(Object.entries(SETTINGS).map(([name, value]) => [name, uniform(value)]))
  #normalNode = null
  #velocityNode = null
  #camera
  #cameraNear
  #cameraFar
  #backgroundDistance // view distances from here on are background
  #depthTarget
  #rawTarget
  #resultTargets
  #materials
  #resultTexNode
  #historyTexNode
  #motionTexNode = null
  #prefilterOutputs = null
  #aoOutputs = null
  #materialAONode = null
  #sharedContext = null
  #logarithmicDepth = false
  #compiling = null
  #disposed = false
  #built = ''
  #parity = 0
  #hasHistory = false
  #frame = 0
  #lastFrameId = -1
  #prevViewProjection = new Matrix4()

  #historyValidU = uniform(0) // 1 when the other result target holds the history
  #changeValidU = uniform(0) // 1 when the prefilter compares depths against the history
  #motionVectorsU = uniform(1)
  #tileOffsetU = uniform(new Vector2()) // this frame's shift of the tile's lattice
  #reprojectionU = uniform(new Matrix4()) // view space → the previous frame's clip space
  #resolutionU = uniform(new Vector2(1, 1)) // AO px
  #texelU = uniform(new Vector2(1, 1)) // 1 / AO px
  #fullResolutionU = uniform(new Vector2(1, 1)) // drawing-buffer px
  #resRatioU = uniform(1) // AO height / drawing-buffer height
  #projScaleU = uniform(1) // AO px per view unit at distance 1
  #ndcScaleU = uniform(new Vector2(1, 1)) // (1 / P[0][0], 1 / P[1][1]): NDC → view ray
  #projSkewU = uniform(new Vector2()) // (P[2][0], P[2][1]): nonzero under a view offset

  /**
   * @param {Node} depthNode - The scene's depth texture node (a PassNode's 'depth').
   * @param {PerspectiveCamera} camera - The camera the scene is rendered with.
   * @param {object} [options] - Any of the settings, e.g. `{ normalNode, radius: 0.35 }`.
   * @param {?Node} [options.normalNode=null] - A view-space normal texture node; without one, normals are rebuilt
   *   from depth.
   * @param {?Node} [options.velocityNode=null] - The scene pass's velocity texture node: what moves on its own then
   *   reprojects along its motion vectors, and its footprint keeps little history.
   */
  constructor(depthNode, camera, options = {}) {
    super('float')
    this.depthNode = nodeObject(depthNode)
    this.#camera = camera
    this.#cameraNear = reference('near', 'float', camera)
    this.#cameraFar = reference('far', 'float', camera)
    this.#backgroundDistance = this.#cameraFar.mul(0.99)
    this.updateBeforeType = NodeUpdateType.FRAME

    for (const [key, value] of Object.entries(options)) {
      if (!OPTIONS.includes(key)) console.warn(`XeGTAONode: unknown option "${key}". Options: ${OPTIONS.join(', ')}.`)
      else if (value !== undefined) this[key] = value
    }

    this.#createTargets()
    // AO, view distance, history length, variance: with temporal accumulation they alternate, the other the history
    this.#resultTargets = [0, 1].map((i) => createTarget(`XeGTAO.Result${i}`, RGBAFormat, HalfFloatType))

    // The quads render inside the consumer's pass and inherit its context: keep its getAO out of them.
    const contextNode = context({ getAO: null })
    const material = (name) => Object.assign(new NodeMaterial(), { name, contextNode })
    this.#materials = {
      prefilter: material('XeGTAO.Prefilter'),
      ao: material('XeGTAO'),
      denoise: material('XeGTAO.Denoise'),
      copy: material('XeGTAO.Copy'),
      accumulate: material('XeGTAO.DenoiseAccumulate'),
    }

    this.#resultTexNode = passTexture(this, this.#resultTargets[0].texture)
    this.#historyTexNode = texture(this.#resultTargets[1].texture)
  }

  // ── Inputs ──────────────────────────────────────────────────────────

  /** A view-space normal texture node, or null to rebuild normals from depth. Rebuilds the shaders on change. */
  get normalNode() {
    return this.#normalNode
  }
  set normalNode(value) {
    this.#normalNode = value ? nodeObject(value) : null
  }

  /** The scene pass's velocity texture node, or null for the camera's motion alone. Rebuilds the shaders on change. */
  get velocityNode() {
    return this.#velocityNode
  }
  set velocityNode(value) {
    this.#velocityNode = value ? nodeObject(value) : null
  }

  // ── Outputs ─────────────────────────────────────────────────────────

  /**
   * The result at AO resolution: R = AO (unclamped), G = view distance, B = history length, A = variance. With temporal
   * accumulation its texture alternates between two targets: sample the node, don't keep its `.value`.
   */
  getTextureNode() {
    return this.#resultTexNode
  }

  /** The AO at full resolution: the result, upsampled against the depth node's view distance. */
  getAONode() {
    return this.#upsample()
  }

  /**
   * The AO at a scene-pass material's own fragment, for builtinAOContext(): upsampled at screenUV against its view
   * distance, once per shader. Never hand it to the pass whose depth this node reads: that pass would run this node on
   * the previous frame's depth.
   */
  getMaterialAONode() {
    this.#materialAONode ??= Fn(() => this.#upsample(screenUV, positionView.z.negate())).once()()
    return this.#materialAONode
  }

  // ── Frame ───────────────────────────────────────────────────────────

  setSize(width, height) {
    const w = Math.max(1, Math.round(this.resolutionScale * width))
    const h = Math.max(1, Math.round(this.resolutionScale * height))
    const resolution = this.#resolutionU.value
    // a resize leaves the history undefined
    if (w !== resolution.x || h !== resolution.y) this.#hasHistory = false
    resolution.set(w, h)
    this.#texelU.value.set(1 / w, 1 / h)
    this.#fullResolutionU.value.set(width, height)
    this.#resRatioU.value = h / height
    for (const target of [this.#depthTarget, this.#rawTarget, ...this.#resultTargets]) target.setSize(w, h)
  }

  /** Drops the history, e.g. after a camera cut. */
  resetHistory() {
    this.#hasHistory = false
  }

  /**
   * Compiles the node's passes ahead of their first frame. Await it before rendering: each pass's target stays bound
   * while it compiles. Optional.
   */
  async compileAsync(renderer) {
    if (renderer.initialized !== true) await renderer.init()
    // one at a time: a rebuild would replace what an earlier compile is binding
    while (this.#compiling !== null) await this.#compiling.catch(() => {})
    if (this.#disposed) return
    // build and size as the first frame would, so it keeps what is compiled here
    this.#logarithmicDepth = renderer.logarithmicDepthBuffer === true
    renderer.getDrawingBufferSize(_size)
    this.setSize(_size.width, _size.height)
    if (this.#built !== this.#structure()) this.#buildMaterials()
    const compiled = this.#compileKey()
    const run = this.#compile(renderer, this.#passes())
    this.#compiling = run
    try {
      await run
    } finally {
      this.#compiling = null
    }
    // a change while it ran: compile the rebuilt passes too
    if (!this.#disposed && this.#compileKey() !== compiled) await this.compileAsync(renderer)
  }

  updateBefore(frame) {
    // a frame drawing the passes mid-compile would compile them synchronously
    if (this.#compiling !== null || this.#disposed) return
    const { renderer } = frame
    const camera = this.#camera
    // the output can sample this node before the scene pass brings the camera's world matrices up to date
    if (camera.matrixWorldAutoUpdate === true) camera.updateWorldMatrix(true, false)

    _rendererState = RendererUtils.resetRendererState(renderer, _rendererState)

    renderer.getDrawingBufferSize(_size)
    this.setSize(_size.width, _size.height)
    const pe = camera.projectionMatrix.elements
    this.#projScaleU.value = 0.5 * this.#resolutionU.value.y * pe[5]
    this.#ndcScaleU.value.set(1 / pe[0], 1 / pe[5])
    this.#projSkewU.value.set(pe[8], pe[9])

    if (this.#built !== this.#structure()) this.#buildMaterials()

    // a frame this node sat out leaves the history behind
    if (frame.frameId !== this.#lastFrameId + 1) this.#hasHistory = false
    this.#lastFrameId = frame.frameId

    const temporal = this.denoise && this.temporalAccumulation
    const valid = temporal && this.#hasHistory ? 1 : 0
    this.#historyValidU.value = valid
    this.#changeValidU.value = this.changeDetection ? valid : 0
    this.#motionVectorsU.value = temporal && this.motionVectors ? 1 : 0
    if (temporal) {
      // whole lattice points cycle each pixel through all 16 combinations; the R2 shift changes which rotations and
      // distances they sample
      const t = this.#frame++
      const point = _bitReversed[t & 15]
      const shift = (0.5 + t * _r2[0]) % 1
      this.#tileOffsetU.value.set((point + shift - 0.5) / 16, ((5 * point) / 16 + ((0.5 + t * _r2[1]) % 1)) % 1)
      this.#reprojectionU.value.multiplyMatrices(this.#prevViewProjection, camera.matrixWorld)
    } else {
      this.#tileOffsetU.value.set(0, 0)
    }
    // the prefilter compares depths against it too
    this.#historyTexNode.value = this.#resultTargets[this.#parity ^ 1].texture

    const passes = this.#passes()
    for (const [material, target] of passes) {
      _quadMesh.material = material
      renderer.setRenderTarget(target)
      _quadMesh.render(renderer)
    }
    this.#resultTexNode.value = passes.at(-1)[1].texture
    if (temporal) this.#parity ^= 1
    this.#hasHistory = temporal

    // the next frame reprojects into this one
    this.#prevViewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)

    RendererUtils.restoreRendererState(renderer, _rendererState)
  }

  setup(builder) {
    this.#sharedContext = builder.getSharedContext()
    this.#logarithmicDepth = builder.renderer.logarithmicDepthBuffer === true
    // every material that reads this node sets it up: rebuild only when what the shaders bake in changed (mid-compile,
    // the compile rebuilds them once it settles)
    if (this.#compiling === null && this.#built !== this.#structure()) this.#buildMaterials()
    return this.#resultTexNode
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    super.dispose()
    const free = () => {
      for (const target of [this.#depthTarget, this.#rawTarget, ...this.#resultTargets]) target.dispose()
      for (const material of Object.values(this.#materials)) material.dispose()
    }
    // a compile in flight would bind what is freed meanwhile
    if (this.#compiling !== null) this.#compiling.then(free, free)
    else free()
  }

  // The passes a frame renders under the current settings, each with its target.
  #passes() {
    const { prefilter, ao, denoise, copy, accumulate } = this.#materials
    const temporal = this.denoise && this.temporalAccumulation
    return [
      [prefilter, this.#depthTarget],
      [ao, this.#rawTarget],
      [temporal ? accumulate : this.denoise ? denoise : copy, this.#resultTargets[this.#parity]],
    ]
  }

  // What a compile covers: the shaders' structure and the last pass the switches pick.
  #compileKey() {
    return `${this.#structure()} ${this.#passes().at(-1)[0].name}`
  }

  // Each pass in the frame's renderer state, for its target; resolves once their pipelines exist.
  async #compile(renderer, passes) {
    await Promise.all(passes.map(([material, target]) => compileQuad(renderer, _quadMesh, material, target)))
  }

  // ── Build ───────────────────────────────────────────────────────────

  // What the shaders bake in.
  #structure() {
    const inputs = `${this.#normalNode?.id ?? '-'} ${this.#velocityNode?.id ?? '-'}`
    return `${this.sliceCount}×${this.stepsPerSlice} ${this.resolutionScale === 1} ${this.#logarithmicDepth} ${inputs}`
  }

  // The prefilter's and the AO pass's targets: with a velocity node, each carries a second texture.
  #createTargets() {
    const withVelocity = this.#velocityNode !== null
    // view distance; with a velocity node, the footprint's motion next to it
    const motion = withVelocity ? { name: 'motion', format: RGFormat, type: HalfFloatType } : null
    this.#depthTarget = createTarget('XeGTAO.Depth', RedFormat, FloatType, motion)
    // AO, unclamped so its noise overshoot past 1 averages back out, and view distance; with a velocity node, the share
    // of the kernel's reads that landed on a marked texel next to it
    const share = withVelocity ? { name: 'share', format: RedFormat, type: UnsignedByteType } : null
    this.#rawTarget = createTarget('XeGTAO.AO', RGFormat, HalfFloatType, share)
    this.#motionTexNode = withVelocity ? texture(this.#depthTarget.textures[1]) : null
    // an MRT pass's shader assigns one property per texture, which mrt() writes to the texture of its name
    const outputs = (target) => Object.fromEntries(target.textures.map((tex) => [tex.name, property('vec4')]))
    this.#prefilterOutputs = withVelocity ? outputs(this.#depthTarget) : null
    this.#aoOutputs = withVelocity ? outputs(this.#rawTarget) : null
  }

  #buildMaterials() {
    this.#built = this.#structure()
    if ((this.#depthTarget.textures.length === 2) !== (this.#velocityNode !== null)) {
      this.#depthTarget.dispose()
      this.#rawTarget.dispose()
      this.#createTargets()
      const { x, y } = this.#resolutionU.value
      this.#depthTarget.setSize(x, y)
      this.#rawTarget.setSize(x, y)
    }
    const set = (material, node, outputs = null) => {
      // none when compileAsync builds first; a consumer's setup keeps what it built
      if (this.#sharedContext !== null) node = node.context(this.#sharedContext)
      // a velocity node switched on or off moves a pass between the two forms: clear the other one
      material.colorNode = outputs ? node : null
      material.outputNode = outputs ? mrt(outputs) : null
      material.fragmentNode = outputs ? null : node
      material.needsUpdate = true
    }
    const raw = texture(this.#rawTarget.texture).sample(uv()).level(0)
    set(this.#materials.prefilter, this.#prefilterFn()(), this.#prefilterOutputs)
    set(this.#materials.ao, this.#aoFn()(), this.#aoOutputs)
    set(this.#materials.denoise, this.#denoiseFn()())
    set(this.#materials.copy, vec4(raw.x, abs(raw.y), 1, 0))
    set(this.#materials.accumulate, this.#accumulateFn()())
  }

  // The positive view distance at `uvCoord`, from the depth node.
  #distAt(uvCoord) {
    const depth = this.depthNode.sample(uvCoord).r
    const toViewZ = this.#logarithmicDepth ? logarithmicDepthToViewZ : perspectiveDepthToViewZ
    return toViewZ(depth, this.#cameraNear, this.#cameraFar).negate()
  }

  // The previous frame's uv of a point through the camera alone, and its last-frame view distance (clip w).
  #cameraReprojection(uvCoord, dist) {
    const ndc = vec2(uvCoord.x.mul(2).sub(1), uvCoord.y.mul(-2).add(1)).add(this.#projSkewU)
    const viewPos = vec3(ndc.mul(this.#ndcScaleU).mul(dist), dist.negate())
    const prevClip = this.#reprojectionU.mul(vec4(viewPos, 1)).toVar()
    return { uv: prevClip.xy.div(prevClip.w).mul(vec2(0.5, -0.5)).add(0.5).toVar(), w: prevClip.w }
  }

  // The closest view distance of each AO texel's footprint: the texel itself at full resolution, else its four corner
  // pixels, centered on the texel so a ratio that isn't an integer stays aligned. Negative where the kernel should see
  // a change: where the texel's surface is new to the history and, with a velocity node, where every sample of the
  // footprint moves on its own (a silhouette's resolved velocity mixes two surfaces, so one sample can't move it).
  // With a velocity node it also writes the closest sample's object motion in AO px, 0 under motionThreshold.
  #prefilterFn() {
    const fullRes = this.#fullResolutionU
    const res = this.#resolutionU
    const velocityNode = this.velocityNode
    const motionVectors = this.#motionVectorsU.greaterThan(0.5)
    const threshold = max(this.#u.motionThreshold, _minMotionThreshold).mul(this.#resRatioU)
    const moves = (motion) => dot(motion, motion).greaterThan(threshold.mul(threshold))

    return Fn(() => {
      let uvs = [uv()]
      if (this.resolutionScale !== 1) {
        const ratio = fullRes.div(res)
        const center = floor(uv().mul(res)).add(0.5).mul(ratio)
        const span = max(ratio.sub(1), 0)
        const at = (i, j) =>
          floor(center.add(vec2(i, j).sub(0.5).mul(span)))
            .add(0.5)
            .div(fullRes)
            .toVar()
        uvs = [at(0, 0), at(1, 0), at(0, 1), at(1, 1)]
      }
      const dists = uvs.map((u) => this.#distAt(u).toVar())
      const dist = dists.reduce((a, b) => min(a, b)).toVar()
      const range = dists.length > 1 ? dists.reduce((a, b) => max(a, b)).sub(dist) : float(0)
      const changed = this.#changed(dist, range)
      const stored = (marked) =>
        vec4(select(marked.and(dist.lessThan(this.#backgroundDistance)), dist.negate(), dist), 0, 0, 1)
      if (!velocityNode) return stored(changed)

      // object motion in AO px: where the velocity puts a sample last frame, minus where the camera alone does
      const motions = uvs.map((u, i) => {
        const camera = this.#cameraReprojection(u, dists[i])
        const previous = u.sub(velocityNode.sample(u).level(0).xy.mul(vec2(0.5, -0.5)))
        return previous.sub(camera.uv).mul(res).toVar()
      })
      const moving = motions.map(moves).reduce((a, b) => a.and(b))
      // the closest sample's motion: a silhouette texel follows its foreground
      let motion = motions[0]
      if (motions.length > 1) {
        motion = motion.toVar()
        const closest = dists[0].toVar()
        for (let i = 1; i < motions.length; i++) {
          const nearer = dists[i].lessThan(closest)
          motion.assign(select(nearer, motions[i], motion))
          closest.assign(select(nearer, dists[i], closest))
        }
      }
      const distance = stored(changed.or(moving.and(motionVectors)))
      const [distanceOutput, motionOutput] = Object.values(this.#prefilterOutputs)
      distanceOutput.assign(distance)
      // a select, not a multiply by the switch: off must leave exactly the camera path, and Inf × 0 is NaN
      motionOutput.assign(vec4(select(moves(motion).and(motionVectors), motion, vec2(0)), 0, 1))
      return distance
    })
  }

  // Whether the texel's surface is new to the history: reprojected through the camera, it lands where none of the
  // history's 2×2 texels it reaches holds its last-frame depth, within changeTolerance × distance plus the footprint's
  // own depth range. A texel counts as reached past float noise on each axis: under a still view the others are the
  // neighbours rounding would pick, so a slow occluder's new depth there is caught whichever way it moves.
  #changed(dist, range) {
    const res = this.#resolutionU
    const camera = this.#cameraReprojection(uv(), dist)
    const p = camera.uv.mul(res).sub(0.5)
    const base = floor(p)
    const f = p.sub(base).toVar()
    // gather order: (x0, y1), (x1, y1), (x1, y0), (x0, y0)
    const errors = abs(this.#historyTexNode.sample(base.add(1).div(res)).gather(1).sub(camera.w)).toVar()
    const [x0, x1, y0, y1] = [f.x.oneMinus(), f.x, f.y.oneMinus(), f.y].map((a) => a.greaterThan(_reprojectionNoise))
    // max(f, 1 − f) ≥ ½ on each axis, so one texel is always reached
    const reached = (error, x, y) => select(x.and(y), error, float(1e9))
    const error = min(
      min(reached(errors.x, x0, y1), reached(errors.y, x1, y1)),
      min(reached(errors.z, x1, y0), reached(errors.w, x0, y0)),
    )
    const tolerance = camera.w.mul(this.#u.changeTolerance).add(range)
    return error.greaterThan(tolerance).and(onScreen(camera.uv, camera.w)).and(this.#changeValidU.greaterThan(0.5))
  }

  #aoFn() {
    const { sliceCount, stepsPerSlice } = this
    const u = this.#u
    const texel = this.#texelU
    const ndcScale = this.#ndcScaleU
    const projScale = this.#projScaleU
    const depthTex = texture(this.#depthTarget.texture)
    // the prefilter's sign marks changed texels: distances are its magnitude
    const valueAt = (uvCoord) => depthTex.sample(uvCoord).level(0).r
    // view position from uv and view distance, for a symmetric projection: 2 mads instead of a matrix per tap
    const viewPosAt = (uvCoord, dist) => {
      const ndc = vec2(uvCoord.x.mul(2).sub(1), uvCoord.y.mul(-2).add(1))
      return vec3(ndc.mul(ndcScale).mul(dist), dist.negate())
    }

    return Fn(() => {
      const vuv = uv()
      const centerValue = valueAt(vuv).toVar()
      const dist = abs(centerValue).toVar()
      // the lowest signed distance the kernel reads: negative when a marked texel lies in its footprint
      const lowest = centerValue.toVar()
      // with a velocity node, how many of its reads are marked
      const markedReads = this.velocityNode ? select(centerValue.lessThan(0), float(1), float(0)).toVar() : null

      // background and fully faded pixels: unoccluded, at their real distance for the filters
      const background = this.#backgroundDistance
      const result = vec4(1, select(dist.lessThan(background), dist, float(_background)), 0, 1).toVar()

      If(dist.lessThan(min(u.fadeEnd, background)), () => {
        const centerPosRaw = viewPosAt(vuv, dist).toVar()

        // the 4 neighbours, for the normal
        const uvL = vuv.sub(vec2(texel.x, 0))
        const uvR = vuv.add(vec2(texel.x, 0))
        const uvT = vuv.sub(vec2(0, texel.y))
        const uvB = vuv.add(vec2(0, texel.y))
        const valueL = valueAt(uvL).toVar()
        const valueR = valueAt(uvR).toVar()
        const valueT = valueAt(uvT).toVar()
        const valueB = valueAt(uvB).toVar()
        const distL = abs(valueL)
        const distR = abs(valueR)
        const distT = abs(valueT)
        const distB = abs(valueB)
        lowest.assign(min(lowest, min(min(valueL, valueR), min(valueT, valueB))))
        markedReads?.addAssign(float(4).sub(dot(step(vec4(0), vec4(valueL, valueR, valueT, valueB)), vec4(1))))

        // view-space normal: sampled if given, else XeGTAO's edge-weighted blend of the 4 quadrants' cross products
        let viewNormal
        if (this.normalNode !== null) {
          viewNormal = this.normalNode.sample(vuv).rgb.normalize().toVar()
        } else {
          // slope-adjusted depth edges: a uniform depth gradient is not an edge
          const deltas = vec4(distL, distR, distT, distB).sub(dist).toVar()
          const slopeLR = deltas.y.sub(deltas.x).mul(0.5)
          const slopeTB = deltas.w.sub(deltas.z).mul(0.5)
          const adjusted = deltas.add(vec4(slopeLR, slopeLR.negate(), slopeTB, slopeTB.negate()))
          const edgesLRTB = saturate(vec4(1.25).sub(min(abs(deltas), abs(adjusted)).div(dist.mul(_edgeSharpness))))
          const dirL = normalize(viewPosAt(uvL, distL).sub(centerPosRaw))
          const dirR = normalize(viewPosAt(uvR, distR).sub(centerPosRaw))
          const dirT = normalize(viewPosAt(uvT, distT).sub(centerPosRaw))
          const dirB = normalize(viewPosAt(uvB, distB).sub(centerPosRaw))
          const accepted = saturate(
            vec4(
              edgesLRTB.x.mul(edgesLRTB.z),
              edgesLRTB.z.mul(edgesLRTB.y),
              edgesLRTB.y.mul(edgesLRTB.w),
              edgesLRTB.w.mul(edgesLRTB.x),
            ).add(0.01),
          )
          // winding flipped from XeGTAO's: three's view space looks down -Z
          viewNormal = normalize(
            dirT
              .cross(dirL)
              .mul(accepted.x)
              .add(dirR.cross(dirT).mul(accepted.y))
              .add(dirB.cross(dirR).mul(accepted.z))
              .add(dirL.cross(dirB).mul(accepted.w)),
          ).toVar()
        }

        // the march's center, nudged toward the camera against depth-precision self-occlusion
        const marchDist = dist.mul(0.99999).toVar()
        const centerPos = viewPosAt(vuv, marchDist).toVar()
        const viewVec = normalize(centerPos.negate()).toVar()

        // the 4×4 tile: point bayer4(pixel) of the lattice (i, 5i mod 16) / 16, which takes all 16 values on both axes
        // and fills every cell of a 4×4 grid; x rotates the slices, y jitters the steps. The frame's offset moves the
        // whole lattice, so any 4×4 block still holds one shifted copy of it.
        const rank = bayer4(ivec2(screenCoordinate.xy)).toVar()
        const noise = fract(
          vec2(float(rank), float(rank.mul(5).bitAnd(15)))
            .add(0.5)
            .div(16)
            .add(this.#tileOffsetU),
        ).toVar()

        // the world radius in AO px, capped in drawing-buffer px; the falloff uses the radius the cap left
        const maxRadius = max(u.maxScreenRadius.mul(this.#resRatioU), 0.5)
        const screenRadius = clamp(u.radius.mul(projScale).div(marchDist), 0.5, maxRadius).toVar()
        const effectRadius = screenRadius.mul(marchDist).div(projScale).toVar()

        // floored so a zero radius or range can't NaN the pass
        const falloffRange = max(u.falloffRange.mul(effectRadius), 1e-6).toVar()
        const falloffMul = falloffRange.reciprocal().negate().toVar()
        const falloffAdd = effectRadius.mul(u.falloffRange.oneMinus()).div(falloffRange).add(1).toVar()

        const minS = float(_pixelTooCloseThreshold).div(screenRadius).toVar()
        const thinScale = vec3(1, 1, u.thinOccluder.add(1)).toVar()

        // sub-pixel radii can't resolve: fade toward unoccluded
        const visibility = saturate(float(10).sub(screenRadius).div(100)).mul(0.5).toVar()

        for (let slice = 0; slice < sliceCount; slice++) {
          const phi = float(slice).add(noise.x).div(sliceCount).mul(PI)
          const cosPhi = cos(phi).toVar()
          const sinPhi = sin(phi).toVar()

          // the slice's direction in view space, and on screen (screen y runs opposite view y)
          const direction = vec3(cosPhi, sinPhi, 0)
          const omegaPx = vec2(cosPhi, sinPhi.negate()).mul(screenRadius).toVar()

          const orthoDir = direction.sub(viewVec.mul(dot(direction, viewVec)))
          const axis = normalize(orthoDir.cross(viewVec))
          const projNormal = viewNormal.sub(axis.mul(dot(viewNormal, axis)))
          const projNormalLenRaw = max(length(projNormal), 1e-4)
          // XeGTAO's slope fudge weights the arc only: cosNorm stays normalized
          const projNormalLen = mix(projNormalLenRaw, float(1), 0.05).toVar()

          const cosNorm = saturate(dot(projNormal, viewVec).div(projNormalLenRaw)).toVar()
          const n = sign(dot(orthoDir, projNormal)).mul(fastAcos(cosNorm)).toVar()
          const sinN = sin(n).toVar()

          // faded taps fall to the hemisphere's horizon, not -1, so grazing angles get no halos
          const lowHorizonCos0 = sinN.negate() // cos(n + π/2)
          const lowHorizonCos1 = sinN // cos(n − π/2)
          const horizonCos0 = lowHorizonCos0.toVar()
          const horizonCos1 = lowHorizonCos1.toVar()

          for (let step = 0; step < stepsPerSlice; step++) {
            // the R1 sequence spreads the jitter across slices and steps
            const stepNoise = fract(noise.y.add((slice + step * stepsPerSlice) * _goldenRatio))
            const s = float(step).add(stepNoise).div(stepsPerSlice).pow(u.sampleDistributionPower).add(minS)

            // snapped to texel centers, so the fetched depth matches the offset
            const offset = round(omegaPx.mul(s)).mul(texel)

            for (const [side, horizonCos, lowHorizonCos] of [
              [1, horizonCos0, lowHorizonCos0],
              [-1, horizonCos1, lowHorizonCos1],
            ]) {
              const sampleUV = vuv.add(offset.mul(side))
              const sampleValue = valueAt(sampleUV).toVar()
              lowest.assign(min(lowest, sampleValue))
              markedReads?.addAssign(select(sampleValue.lessThan(0), float(1), float(0)))
              const delta = viewPosAt(sampleUV, abs(sampleValue)).sub(centerPos).toVar()
              const deltaLen = length(delta)

              // fades over the outer falloffRange of the radius, view Z stretched against thin occluders
              const weight = saturate(length(delta.mul(thinScale)).mul(falloffMul).add(falloffAdd))
              const sampleCos = mix(lowHorizonCos, dot(delta.div(deltaLen), viewVec), weight)
              horizonCos.assign(max(horizonCos, sampleCos))
            }
          }

          // the closed-form cosine-weighted arc integral
          const h0 = fastAcos(horizonCos1).negate()
          const h1 = fastAcos(horizonCos0)
          const arc0 = cosNorm.add(h0.mul(2).mul(sinN)).sub(cos(h0.mul(2).sub(n)))
          const arc1 = cosNorm.add(h1.mul(2).mul(sinN)).sub(cos(h1.mul(2).sub(n)))
          visibility.addAssign(projNormalLen.mul(arc0.add(arc1)).mul(0.25))
        }

        // pow of the unclamped integral: its noise overshoot past 1 averages back out in the denoise
        const shaped = max(pow(max(visibility.div(sliceCount), 0), u.power), 0.03)

        // distance fade, then intensity: both affine in the AO, so they survive the averaging after
        const faded = mix(shaped, float(1), smoothstep(u.fadeStart, u.fadeEnd, dist))
        result.x.assign(mix(float(1), faded, u.intensity))
        // the marked-footprint flag rides on the distance's sign
        result.y.assign(dist.mul(step(0, lowest).mul(2).sub(1)))
        // the center, its 4 neighbours and 2 taps per step
        if (markedReads) result.z.assign(markedReads.div(5 + 2 * sliceCount * stepsPerSlice))
      })

      if (this.#aoOutputs) {
        const [aoOutput, shareOutput] = Object.values(this.#aoOutputs)
        aoOutput.assign(result)
        shareOutput.assign(vec4(result.z, 0, 0, 1))
      }
      return result
    })
  }

  // The 4×4 box matched to the tile, from 8 gathers: the taps [-1, 2]² around the texel, each weighted by how far its
  // depth sits off the center's plane, so the cancellation stays exact on open surfaces. Returns the weighted sums of
  // the AO and of its square, the center's depth and plane slopes, and whether a tap saw a marked texel; with
  // `withShare`, also the mean share of the taps' kernel reads that did (4 more gathers).
  #box(vuv, withShare = false) {
    const aoTex = texture(this.#rawTarget.texture)
    const shareTex = withShare ? texture(this.#rawTarget.textures[1]) : null
    const tolerance = this.#u.denoiseTolerance

    const taps = new Map()
    let lowest = null
    let shares = null
    for (const [bx, by] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const corner = vuv.add(vec2(bx + 0.5, by + 0.5).mul(this.#texelU))
      const ao = aoTex.sample(corner).gather(0).toVar()
      const signed = aoTex.sample(corner).gather(1).toVar()
      const z = abs(signed).toVar()
      const blockLowest = min(min(signed.x, signed.y), min(signed.z, signed.w))
      lowest = lowest ? min(lowest, blockLowest) : blockLowest
      if (shareTex) {
        const blockShares = dot(shareTex.sample(corner).gather(0), vec4(1))
        shares = shares ? shares.add(blockShares) : blockShares
      }
      blockOffsets(bx, by).forEach(([dx, dy], i) => {
        taps.set(`${dx},${dy}`, { dx, dy, ao: ao['xyzw'[i]], z: z['xyzw'[i]] })
      })
    }
    const zAt = (dx, dy) => taps.get(`${dx},${dy}`).z
    const center = zAt(0, 0).toVar()
    const { gx, gy } = slopes(center, zAt, tolerance)
    const scale = float(1)
      .div(max(tolerance.mul(center), 1e-6))
      .toVar()

    const sum = float(0).toVar()
    const sumSq = float(0).toVar()
    const sumWeight = float(0).toVar()
    for (const { dx, dy, ao, z } of taps.values()) {
      const weight = tapWeight(dx, dy, z, center, gx, gy, scale)
      const weighted = ao.mul(weight).toVar()
      sum.addAssign(weighted)
      sumSq.addAssign(ao.mul(weighted))
      sumWeight.addAssign(weight)
    }
    // the center always weighs 1, so the sums can't vanish
    const share = shares ? shares.div(16).toVar() : null
    return { center, gx, gy, sum, sumSq, sumWeight, marked: lowest.lessThan(0), share }
  }

  #denoiseFn() {
    return Fn(() => {
      const { center, sum, sumWeight } = this.#box(uv())
      return vec4(sum.div(sumWeight), center, 1, 0)
    })
  }

  // The box over the reprojected history, at 1 / the history's length. The history is clamped to the box's mean ±
  // historyClamp + historyClampDeviation × its temporal deviation (from the history's variance once 4 frames hold, from
  // the box's spread before). Its length grows by one a frame up to 1 / temporalAccumulationAlpha, and shrinks the
  // further it strays past that band, the faster the reprojection moves, and to 1 / motionAccumulationAlpha where a tap
  // of the box saw a marked texel (with motion vectors, eased toward 1 / sparseMotionAccumulationAlpha the fewer of the
  // box's kernel reads did).
  #accumulateFn() {
    const u = this.#u
    return Fn(() => {
      const vuv = uv()
      const { center, gx, gy, sum, sumSq, sumWeight, marked, share } = this.#box(vuv, this.velocityNode !== null)
      const denoised = sum.div(sumWeight).toVar()
      const rawSigma = sqrt(max(sumSq.div(sumWeight).sub(denoised.mul(denoised)), 0))

      // the depth test allows the plane's slope over the one texel a bilinear tap may be off
      const history = this.#fetchHistory(vuv, center, abs(gx).add(abs(gy)))

      const sigma = select(history.length.greaterThanEqual(4), sqrt(max(history.variance, 0)), rawSigma.mul(0.25))
      const band = u.historyClamp.add(u.historyClampDeviation.mul(sigma)).toVar()
      const low = denoised.sub(band).toVar()
      const high = denoised.add(band).toVar()
      const clamped = clamp(history.ao, low, high)
      const threshold = u.historyDecayThreshold
      const stray = max(max(low.sub(threshold).sub(history.ao), history.ao.sub(high.add(threshold))), 0)

      const fullLength = float(1).div(max(u.temporalAccumulationAlpha, 1e-3)).toVar()
      // the share is how much of the footprint moves or changed; without motion vectors, a surface moving along
      // itself barely changes depth, and the share says nothing
      let markedAlpha = u.motionAccumulationAlpha
      if (share) {
        const graded = mix(
          u.sparseMotionAccumulationAlpha,
          u.motionAccumulationAlpha,
          saturate(share.div(max(u.denseChangeShare, 1e-3))),
        )
        markedAlpha = select(this.#motionVectorsU.greaterThan(0.5), graded, u.motionAccumulationAlpha)
      }
      const markedLength = min(float(1).div(max(markedAlpha, 1e-3)), fullLength)
      // 1 / (1 + speed / historyMotionSpeed) of the full length: half of it at historyMotionSpeed px per frame
      const speed = history.offset.div(max(u.historyMotionSpeed.mul(this.#resRatioU), 1e-3))
      const maxLength = min(select(marked, markedLength, fullLength), fullLength.div(speed.add(1)))
      const len = min(
        history.length
          .mul(history.confidence)
          .mul(exp(stray.mul(u.historyDecay).negate()))
          .add(1),
        max(maxLength, 1),
      ).toVar()

      const weight = len.reciprocal().toVar()
      const delta = denoised.sub(clamped).toVar()
      const value = clamped.add(delta.mul(weight))
      const variance = weight.oneMinus().mul(history.variance.add(weight.mul(delta.mul(delta))))
      // a point on last frame's camera plane reprojects to NaN, which a weight of 0 would still carry
      return select(history.confidence.greaterThan(0), vec4(value, center, len, variance), vec4(denoised, center, 1, 0))
    })
  }

  // The history at this point. Its view position goes to the previous frame's clip space through the camera, and with
  // a velocity node the prefilter's object motion moves the uv on from there. The 2×2 history texels around it weigh
  // bilinear × whether their depth is the point's last-frame depth through the camera, within historyTolerance plus
  // `slack`: a disocclusion keeps only what's on the same surface, and what moves along the view axis drops its
  // history. Returns the history's AO, length and variance, its confidence (the passing bilinear weight) and the
  // reprojection's length in AO px.
  #fetchHistory(vuv, dist, slack) {
    const res = this.#resolutionU
    const historyTex = this.#historyTexNode

    const camera = this.#cameraReprojection(vuv, dist)
    const prevW = camera.w
    const prevUV = this.#motionTexNode
      ? camera.uv.add(this.#motionTexNode.sample(vuv).level(0).xy.mul(this.#texelU)).toVar()
      : camera.uv

    const p = prevUV.mul(res).sub(0.5)
    const base = floor(p).toVar()
    const f = p.sub(base).toVar()
    const corner = base.add(1).div(res)
    const window = vec4(prevW.mul(this.#u.historyTolerance).add(slack))

    // gather order: (x0, y1), (x1, y1), (x1, y0), (x0, y0)
    const historyDist = historyTex.sample(corner).gather(1)
    const weights = bilinearWeights(f)
      .mul(step(abs(historyDist.sub(prevW)), window))
      .toVar()
    const total = dot(weights, vec4(1)).toVar()
    const inv = float(1).div(max(total, 1e-4)).toVar()
    const average = (component) => dot(weights, historyTex.sample(corner).gather(component)).mul(inv).toVar()

    return {
      ao: average(0),
      length: average(2),
      variance: average(3),
      confidence: select(onScreen(prevUV, prevW), total, float(0)).mul(this.#historyValidU).toVar(),
      offset: length(prevUV.sub(vuv).mul(res)),
    }
  }

  // Joint bilateral upsample of the result: the 4 AO texels around the pixel, weighted bilinearly and by how close
  // each one's depth is to the pixel's. Where none is close (a thin edge the AO resolution lost) the closest one wins.
  // At `uvNode` against `distanceNode`, the pixel's positive view distance; by default the depth node's at uv().
  #upsample(uvNode = uv(), distanceNode = null) {
    const res = this.#resolutionU
    const tolerance = this.#u.upsampleTolerance
    // a PassTextureNode's clone drops its uv, so a chained .gather() would read at uv(): set it on the sample instead
    const gather = (uvCoord, component) => {
      const node = this.#resultTexNode.sample(uvCoord)
      node.gatherNode = nodeObject(component)
      return node
    }

    return Fn(() => {
      const p = uvNode.mul(res).sub(0.5)
      const base = floor(p)
      const f = p.sub(base).toVar()
      const corner = base.add(1).div(res).toVar() // the 2×2 texels' shared corner

      // gather order: (x0, y1), (x1, y1), (x1, y0), (x0, y0)
      const ao = gather(corner, 0).toVar()
      const depths = abs(gather(corner, 1)).toVar()
      // background as the AO pass writes it
      const rawDist = distanceNode ?? this.#distAt(uvNode)
      const pixelDist = select(rawDist.lessThan(this.#backgroundDistance), rawDist, float(_background)).toVar()

      const separation = abs(depths.sub(pixelDist))
        .div(max(pixelDist.mul(tolerance), 1e-6))
        .toVar()
      const weights = bilinearWeights(f)
        .mul(saturate(vec4(1).sub(separation)))
        .toVar()
      const total = dot(weights, vec4(1))

      // the closest texel, for when every weight vanished
      const closestXY = select(separation.x.lessThan(separation.y), vec2(ao.x, separation.x), vec2(ao.y, separation.y))
      const closestZW = select(separation.z.lessThan(separation.w), vec2(ao.z, separation.z), vec2(ao.w, separation.w))
      const closest = select(closestXY.y.lessThan(closestZW.y), closestXY.x, closestZW.x)

      return saturate(select(total.greaterThan(1e-3), dot(weights, ao).div(max(total, 1e-3)), closest))
    })()
  }
}

function xeGTAO(depthNode, camera, options) {
  return nodeObject(new XeGTAONode(depthNode, camera, options))
}

export { XeGTAONode, xeGTAO }
