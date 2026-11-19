/**
 * TAAUNode - temporal anti-aliasing upscaling: jittered frames, rendered at or below the output's resolution,
 * accumulated into one stable, anti-aliased image at the output's
 *
 * The camera renders each frame with a sub-pixel Halton jitter, only while the render pipeline renders, so picking and
 * the shadow maps see it still. Two passes:
 *
 * 1. Neighbourhood, once per input texel: the depth dilation, the reprojection velocity, the edge test, the colour
 *    moments in RGB and in `clipColorSpace`, the median luma and the ridge test.
 * 2. Resolve, per output pixel: the current frame from a separable kernel (`kernelSigma`, in output pixels), the
 *    history reprojected (`bicubicHistory`: a 5-tap Catmull-Rom read) and clipped to the neighbourhood's colour box,
 *    looser at rest (`varianceGammaMin`), then blended by the samples it holds (`currentFrameWeight`,
 *    `maxAccumulation`). Features under two texels wide lock their history (`lockThreshold`, `lockDecay`, FSR2's shape
 *    test); a depth change past `depthRejectTolerance` drops it; edges keep theirs for anti-aliasing, refreshed while
 *    they move over what they uncover (`edgeDisocclusionAccumulation`).
 *
 * The output ping-pongs: read it through `getTextureNode()`, which follows the frame's target, rather than keeping its
 * `.value`; `stableOutput: true` gives consumers that keep it (three's SharpenNode) one texture.
 *
 *   const scenePass = pass(scene, camera, { samples: 0 })   // no MSAA
 *   scenePass.setResolutionScale(0.5)                        // input / output: 1 is plain anti-aliasing
 *   scenePass.setMRT(mrt({ output, velocity }))
 *   const taauNode = taau(
 *     scenePass.getTextureNode('output'),
 *     scenePass.getTextureNode('depth'),
 *     scenePass.getTextureNode('velocity'),
 *     camera,
 *     { maxAccumulation: 24 },
 *   )
 *   renderPipeline.outputNode = renderOutput(taauNode.getTextureNode())
 *   await taauNode.compileAsync(renderer) // optional: compiles the passes ahead of the first frame
 *
 * The numeric settings are uniforms: changing them never recompiles. On the next frame, `bicubicHistory`,
 * `reactiveNode` and `stableOutput` rebuild the node's passes, and `jitterPhases` and `clipColorSpace` take effect.
 *
 * After Karis, "High Quality Temporal Supersampling" (2014), and AMD's FidelityFX Super Resolution 2 (2022).
 */
import {
  DepthTexture,
  FloatType,
  HalfFloatType,
  LinearFilter,
  Matrix3,
  Matrix4,
  NodeMaterial,
  NodeUpdateType,
  QuadMesh,
  RGBAFormat,
  RGBFormat,
  RGFormat,
  RenderTarget,
  RendererUtils,
  Node,
  UnsignedInt101111Type,
  Vector2,
} from 'three/webgpu'
import {
  Fn,
  If,
  OnAfterRenderPipeline,
  OnBeforeRenderPipeline,
  context,
  convertToTexture,
  exp,
  float,
  getViewPosition,
  ivec2,
  logarithmicDepthToViewZ,
  luminance,
  max,
  min,
  mix,
  outputStruct,
  passTexture,
  property,
  texture,
  uv,
  uniform,
  vec2,
  vec3,
  vec4,
  velocity,
  viewZToPerspectiveDepth,
  viewZToReversedPerspectiveDepth,
} from 'three/tsl'
import { compileQuad } from './utils/compileQuad.js'
import {
  clipAABB,
  computeHaltonOffsets,
  flickerReduction,
  sampleCurrentDepth,
} from 'three/addons/tsl/utils/TAAUtils.js'

const _quadMesh = /*@__PURE__*/ new QuadMesh()
const _size = /*@__PURE__*/ new Vector2()

let _rendererState

// The uniform-backed settings and their defaults. Each is a property whose getter returns the uniform node and whose
// setter sets its value.
const SETTINGS = {
  // the least share of the current frame in the blend, so a converged pixel never freezes
  currentFrameWeight: 0.02,
  // the cap on the accumulated sample weight τ; a still pixel gains about half a sample a frame, so it remembers about
  // twice as many frames
  maxAccumulation: 16,
  // the reconstruction kernel's σ in output pixels, converted to input pixels by the upscale ratio
  kernelSigma: 0.47,
  // the least kernel σ in input pixels, so a steep upscale keeps more than the center tap; keep it below
  // kernelSigma × the ratio (0.235 at a 2× upscale), or it overrides the ratio
  kernelSigmaFloor: 0.2,
  // the depth change, as a share of the view depth, that drops the history
  depthRejectTolerance: 0.02,
  // the 3×3 depth spread, as a share of the view depth, that marks a silhouette edge: edges keep the history the
  // depth test rejects, or no silhouette would accumulate
  edgeDetectTolerance: 0.04,
  // motion, in output pixels per frame, at which the current frame takes over
  maxVelocityLength: 128,
  // the clip box's width under full motion, as a share of its width at rest: lower ghosts less and flickers more
  varianceGammaMin: 0.5,
  // the per-frame survival of a thin-feature lock; 0 disables locking. Near 1 a lock can latch, ghosting on
  // high-contrast texture
  lockDecay: 0.5,
  // the luma contrast against the neighbourhood's mean that locks a thin feature, whose history then stays unclipped:
  // it keeps wires and glints from flickering
  lockThreshold: 0.2,
  // the strength of the reactive mask
  reactiveAmount: 1,
  // 1: the contrast test locks only luma ridges under two texels wide (FSR2's shape test); 0: any contrast, which
  // also locks both sides of every high-contrast silhouette
  lockDetection: 1,
  // the luma ratio (max / min) under which two texels count as similar in the ridge test
  lockSimilarity: 1.05,
  // the change of the neighbourhood's median luma (1 − min / max) that drops an inherited lock; 1 never does
  lockLumaTolerance: 0.1,
  // the sample cap of a moving edge whose history matches no surface nearby: it keeps the history for anti-aliasing,
  // refreshed within a few frames; maxAccumulation or more: no cap
  edgeDisocclusionAccumulation: 2,
  // motion of the surface behind against the pixel's own, in output pixels per frame, past which an edge counts as
  // moving: keeps the cap off still silhouettes and thin features
  edgeDisocclusionMinParallax: 1,
}

const OPTIONS = [
  'bicubicHistory',
  'jitterPhases',
  'reactiveNode',
  'clipColorSpace',
  'stableOutput',
  ...Object.keys(SETTINGS),
]

// The resolve's merged bilinear fetches need a linearly filtered beauty texture.
const isBilinear = (beautyTexture) => beautyTexture.magFilter === LinearFilter && beautyTexture.type !== FloatType

// The 3×3 neighbourhood, row by row; index 4 is the center.
const _offsets = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [0, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
]

// Median of 9 float nodes: Devillard's 19-exchange sorting network (opt_med9).
function median9(values) {
  const p = values.slice()
  const sort = (a, b) => {
    const lo = min(p[a], p[b]).toVar()
    const hi = max(p[a], p[b]).toVar()
    p[a] = lo
    p[b] = hi
  }
  for (const [a, b] of [
    [1, 2],
    [4, 5],
    [7, 8],
    [0, 1],
    [3, 4],
    [6, 7],
    [1, 2],
    [4, 5],
    [7, 8],
    [0, 3],
    [5, 8],
    [4, 7],
    [3, 6],
    [1, 4],
    [2, 5],
    [4, 7],
    [4, 2],
    [6, 4],
    [4, 2],
  ])
    sort(a, b)
  return p[4]
}

// [toClipSpace, fromClipSpace] per `clipColorSpace`. YCoCg:
// Y = R/4 + G/2 + B/4, Co = R/2 - B/2, Cg = -R/4 + G/2 - B/4.
const _clipColorSpaces = {
  ycocg: [
    /*@__PURE__*/ new Matrix3().set(0.25, 0.5, 0.25, 0.5, 0, -0.5, -0.25, 0.5, -0.25),
    /*@__PURE__*/ new Matrix3().set(1, 1, -1, 1, 0, 1, 1, -1, -1),
  ],
  rgb: [/*@__PURE__*/ new Matrix3(), /*@__PURE__*/ new Matrix3()],
}

// The camera's projection without the jitter, for three's `velocity` node. One matrix for every TAAUNode: a scene
// material compiles `uniform(projectionMatrix)` once, so a matrix owned by one node would leave it reading a disposed
// node's frozen copy once another replaces it, and a later FOV or aspect change would read as motion.
const _unjitteredProjection = /*@__PURE__*/ new Matrix4()

/**
 * Keeps the unjittered projection current while no TAAUNode drives it: once one has left the output graph, the
 * materials it compiled still read it. Call once a frame before rendering, while the camera carries no jitter.
 *
 * @param {Camera} camera - The camera the scene is rendered with.
 */
function syncUnjitteredProjection(camera) {
  _unjitteredProjection.copy(camera.projectionMatrix)
  velocity.setProjectionMatrix(_unjitteredProjection)
}
class TAAUNode extends Node {
  #auxNode
  #auxType = null // the aux attachment's type, picked in setup()
  #bicubicHistory = true
  #built = null // what the materials were built for
  #cameraNearFar
  #clipColorSpace
  #clipMatrix
  #clipMatrixInverse
  #compiling = null // the compileAsync() in flight
  #disposed = false
  #drawn = new Set() // the materials a frame drew since they were built
  #haltonOffsets
  #historyNode
  #jitterIndex
  #jitterOffset
  #jitterPhases = 32
  #logarithmicDepth = false
  #needsPostProcessingSync
  #needsReset
  #outputSize
  #pingPong
  #previousCameraProjectionMatrixInverse
  #previousCameraWorldMatrix
  #previousDepthNode
  #previousDepthRenderTarget
  #reactiveNode = null
  #renderTargets = []
  #reprojectionMatrix
  #resolveMaterial
  #reversedDepth = false
  #seedMaterial
  #sharedContext = null
  #stableOutput = false
  #statsMaterial
  #statsNodes
  #statsRenderTarget
  #textureNode
  #u = Object.fromEntries(Object.entries(SETTINGS).map(([name, value]) => [name, uniform(value)]))

  static get type() {
    return 'TAAUNode'
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
            console.warn(`TAAUNode: ${name} takes a number; drive its uniform with onFrameUpdate() instead.`)
            return
          }
          this.#u[name].value = value
        },
      })
    }
  }

  /** Values accepted by `clipColorSpace`. */
  static clipColorSpaces = ['ycocg', 'rgb']

  /**
   * @param {TextureNode} beautyNode - Scene color, at the *input* resolution.
   * @param {TextureNode} depthNode - Scene depth, at the input resolution.
   * @param {TextureNode} velocityNode - Scene velocity, at the input resolution.
   * @param {Camera} camera - The camera the scene is rendered with.
   * @param {Object} [options] - Any of the properties `bicubicHistory`, `jitterPhases`, `reactiveNode`,
   *   `clipColorSpace`, `stableOutput` and the uniform settings (`currentFrameWeight`, `maxAccumulation`, …).
   */
  constructor(beautyNode, depthNode, velocityNode, camera, options = {}) {
    super('vec4')

    this.isTAAUNode = true
    this.updateBeforeType = NodeUpdateType.FRAME

    this.beautyNode = beautyNode
    this.depthNode = depthNode
    this.velocityNode = velocityNode
    this.camera = camera

    // the colour transform of the second variance clip; see `clipColorSpace`
    this.#clipMatrix = uniform(new Matrix3())
    this.#clipMatrixInverse = uniform(new Matrix3())
    this.#clipColorSpace = 'rgb'
    this.clipColorSpace = 'ycocg'

    this.#jitterIndex = 0
    this.#jitterOffset = uniform(new Vector2())
    this.#haltonOffsets = computeHaltonOffsets(this.#jitterPhases)

    // The history and aux nodes, and the published one without `stableOutput`, are repointed every frame. That is safe
    // because `TextureNode.sample()` clones with `referenceNode = getBase()` and the `value` getter proxies through it,
    // so every clone follows the swap. They start on distinct textures so no two nodes in one material share one at
    // build time: TextureNode uniforms hash on the texture uuid and would otherwise collapse.
    const outputTexture = this.#createTargets()
    this.#textureNode = passTexture(this, outputTexture)
    this.#historyNode = texture(this.#renderTargets[0].textures[0])
    this.#auxNode = texture(this.#renderTargets[0].textures[1])

    // The previous depth buffer needs its own target sized to the *input* depth texture: the history is at the output
    // resolution, so the copy extents would not match its own depthTexture.
    this.#previousDepthRenderTarget = new RenderTarget(1, 1, {
      depthBuffer: false,
      depthTexture: new DepthTexture(),
    })
    this.#previousDepthRenderTarget.depthTexture.name = 'TAAUNode.previousDepth'
    this.#previousDepthNode = texture(this.#previousDepthRenderTarget.depthTexture)

    this.#resolveMaterial = new NodeMaterial()
    this.#resolveMaterial.name = 'TAAU.resolve'

    this.#seedMaterial = new NodeMaterial()
    this.#seedMaterial.name = 'TAAU.seed'

    // The neighbourhood statistics, one texel per closest tap (see #buildMaterials()). Four half-float attachments,
    // the last one two channels wide without a reactive mask: 28 bytes a texel, 32 with one (WebGPU's default
    // maxColorAttachmentBytesPerSample). Depths stay out of them: the pass runs the edge test, and the resolve reloads
    // the dilated depth texel.
    this.#statsRenderTarget = new RenderTarget(1, 1, { depthBuffer: false, type: HalfFloatType, count: 4 })
    for (const [i, name] of ['motion', 'mean', 'spread', 'clipSpread'].entries()) {
      this.#statsRenderTarget.textures[i].name = `TAAUNode.stats.${name}`
    }
    this.#syncStatsFormat()
    this.#statsNodes = this.#statsRenderTarget.textures.map((t) => texture(t))

    this.#statsMaterial = new NodeMaterial()
    this.#statsMaterial.name = 'TAAU.neighbourhood'

    this.#cameraNearFar = uniform(new Vector2())
    this.#previousCameraWorldMatrix = uniform(new Matrix4())
    this.#previousCameraProjectionMatrixInverse = uniform(new Matrix4())
    this.#outputSize = uniform(new Vector2())

    // One CPU-side mat4 instead of two chained per-fragment multiplies.
    this.#reprojectionMatrix = uniform(new Matrix4())

    this.#needsPostProcessingSync = false

    for (const [key, value] of Object.entries(options)) {
      if (!OPTIONS.includes(key)) console.warn(`TAAUNode: unknown option "${key}". Options: ${OPTIONS.join(', ')}.`)
      else if (value !== undefined) this[key] = value
    }
  }

  getTextureNode() {
    return this.#textureNode
  }

  // ── Settings ────────────────────────────────────────────────────────

  /** Reads the history with a 5-tap Catmull-Rom filter instead of one bilinear tap. Rebuilds the resolve. */
  get bicubicHistory() {
    return this.#bicubicHistory
  }
  set bicubicHistory(value) {
    this.#bicubicHistory = Boolean(value)
  }

  /**
   * Halton(2, 3) jitter phases, ~8 × the upscale ratio²: 32 suits a 2× upscale, 16 a 1.5× one. Applies on the next
   * frame.
   */
  get jitterPhases() {
    return this.#jitterPhases
  }
  set jitterPhases(count) {
    if (!Number.isInteger(count) || count < 1) {
      console.warn(`TAAUNode: jitterPhases ${count}: a positive integer.`)
      return
    }
    if (count === this.#jitterPhases) return
    this.#jitterPhases = count
    this.#haltonOffsets = computeHaltonOffsets(count)
    this.#jitterIndex %= count
  }

  /**
   * A mask at the input resolution for content without usable velocity (alpha-blended, additive): 0 keeps the
   * history, 1 trusts the current frame. Rebuilds the node's passes.
   */
  get reactiveNode() {
    return this.#reactiveNode
  }
  set reactiveNode(node) {
    node ??= null
    if (node === this.#reactiveNode) return
    this.#reactiveNode = node
    this.#syncStatsFormat()
  }

  /**
   * Publishes the colour in one texture that keeps its identity across frames, for consumers that keep
   * `getTextureNode().value` (three's SharpenNode); costs one more RGBA16F write per output pixel. Rebuilds the node's
   * targets and drops the history; consumers that keep the `.value` read the new texture once the output graph
   * rebuilds (`renderPipeline.needsUpdate = true`).
   */
  get stableOutput() {
    return this.#stableOutput
  }
  set stableOutput(value) {
    value = Boolean(value)
    if (value === this.#stableOutput) return
    this.#stableOutput = value
    this.#textureNode.value = this.#createTargets()
    this.#historyNode.value = this.#renderTargets[0].textures[0]
    this.#auxNode.value = this.#renderTargets[0].textures[1]
  }

  /**
   * `'ycocg'` clips the history to the neighbourhood's YCoCg box as well as its RGB one, keeping at most what either
   * would; `'rgb'` clips to RGB only.
   * @type {string}
   */
  get clipColorSpace() {
    return this.#clipColorSpace
  }
  set clipColorSpace(name) {
    if (name === this.#clipColorSpace) return
    const matrices = _clipColorSpaces[name]
    if (matrices === undefined) {
      console.warn(`TAAUNode: clipColorSpace "${name}": one of ${TAAUNode.clipColorSpaces.join(', ')}.`)
      return
    }
    this.#clipColorSpace = name
    this.#clipMatrix.value.copy(matrices[0])
    this.#clipMatrixInverse.value.copy(matrices[1])
  }

  // ── Targets ─────────────────────────────────────────────────────────

  // The ping-pong pair, replacing the current one: [0] resolved color, [1] aux (r = the lock's neighbourhood luma,
  // g = accumulated weight τ, b = lock). The frame's write target becomes the next frame's history, so the aux
  // attachment persists without a copy, and its color is what `getTextureNode()` publishes. With `stableOutput`, [2] is
  // one texture both targets share, which always holds the newest frame. Returns the texture to publish first.
  #createTargets() {
    for (const rt of this.#renderTargets) rt.dispose()
    const count = this.#stableOutput ? 3 : 2
    this.#renderTargets = [0, 1].map((i) => {
      const rt = new RenderTarget(1, 1, { depthBuffer: false, type: HalfFloatType, count })
      rt.textures[0].name = `TAAUNode.rt${i}.color`
      rt.textures[1].name = `TAAUNode.rt${i}.aux`
      this.#syncAuxType(rt)
      return rt
    })
    this.#pingPong = 0
    this.#needsReset = true
    // the first frame writes target 1
    if (!this.#stableOutput) return this.#renderTargets[1].textures[0]
    const outputTexture = this.#renderTargets[0].textures[2]
    outputTexture.name = 'TAAUNode.output'
    this.#renderTargets[1].textures[2] = outputTexture
    return outputTexture
  }

  #syncAuxType(rt) {
    const aux = rt.textures[1]
    if (this.#auxType === null || aux.type === this.#auxType) return
    aux.type = this.#auxType
    aux.format = this.#auxType === HalfFloatType ? RGBAFormat : RGBFormat
    rt.dispose()
  }

  // The stats' last attachment carries the reactive mask, if any.
  #syncStatsFormat() {
    const last = this.#statsRenderTarget.textures[3]
    const format = this.#reactiveNode === null ? RGFormat : RGBAFormat
    if (last.format === format) return
    last.format = format
    this.#statsRenderTarget.dispose()
  }

  /**
   * Drops the history and reseeds from the current frame. Call on a camera cut or
   * teleport — without it the reprojection tries to reconcile two unrelated views
   * and smears for the length of the accumulation window.
   */
  resetHistory() {
    this.#needsReset = true
  }

  setSize(outputWidth, outputHeight) {
    for (const rt of this.#renderTargets) rt.setSize(outputWidth, outputHeight)
  }

  /**
   * Applies the frame's Halton offset as a camera view offset.
   *
   * The offset is `halton - 0.5`, i.e. ±0.5 **input** pixels — one full input pixel,
   * which is the FSR2 convention and what the tap-center reconstruction below
   * assumes. (Stock TAAUNode's comment here claims the offset is shrunk by the
   * input/output ratio. No such term exists in its code, and adding one would
   * under-cover the input texel: samples would cluster in its middle and never
   * reach the corners.)
   */
  setViewOffset(inputWidth, inputHeight) {
    // the velocity pass must see the unjittered projection
    this.camera.updateProjectionMatrix()
    syncUnjitteredProjection(this.camera)

    const haltonOffset = this.#haltonOffsets[this.#jitterIndex]
    const jitterX = haltonOffset[0] - 0.5
    const jitterY = haltonOffset[1] - 0.5

    this.#jitterOffset.value.set(jitterX, jitterY)

    this.camera.setViewOffset(inputWidth, inputHeight, jitterX, jitterY, inputWidth, inputHeight)
  }

  clearViewOffset() {
    this.camera.clearViewOffset()
    velocity.setProjectionMatrix(null)

    this.#jitterIndex = (this.#jitterIndex + 1) % this.#haltonOffsets.length
  }

  updateBefore(frame) {
    const { renderer } = frame

    // a compile in flight would race a rebuild of the materials it compiles
    if (this.#compiling === null && this.#auxType !== null && this.#built !== this.#structure()) this.#buildMaterials()

    this.#cameraNearFar.value.set(this.camera.near, this.camera.far)

    // This runs before the scene pass renders, and rendering is what brings the
    // camera's world matrices up to date (OrbitControls leaves them a frame
    // behind), so refresh them the way the renderer would. Otherwise the
    // reprojection below uses last frame's rotation and rejects valid history.
    if (this.camera.parent === null && this.camera.matrixWorldAutoUpdate === true) this.camera.updateMatrixWorld()

    // Reprojection, folded into one CPU-side matrix: the current view-inverse
    // composed with the previous frame's world matrix. Both this and
    // `#previousCameraProjectionMatrixInverse` still hold last frame's snapshot
    // here, and the resolve below reads them — so they are only retired at the
    // very end of this method.
    this.#reprojectionMatrix.value.copy(this.camera.matrixWorldInverse).multiply(this.#previousCameraWorldMatrix.value)

    const beautyRenderTarget = this.#beautyRenderTarget()

    const inputWidth = beautyRenderTarget.texture.width
    const inputHeight = beautyRenderTarget.texture.height

    const drawingBufferSize = renderer.getDrawingBufferSize(_size)
    const outputWidth = drawingBufferSize.width
    const outputHeight = drawingBufferSize.height

    this.#outputSize.value.set(outputWidth, outputHeight)

    if (this.#needsPostProcessingSync === true) {
      this.setViewOffset(inputWidth, inputHeight)
      this.#needsPostProcessingSync = false
    }

    // while a compile runs, drawing the passes would create their pipelines synchronously
    if (this.#compiling !== null || this.#disposed) return

    _rendererState = RendererUtils.resetRendererState(renderer, _rendererState)

    const readIndex = this.#pingPong
    const writeIndex = 1 - this.#pingPong
    const readTarget = this.#renderTargets[readIndex]
    const writeTarget = this.#renderTargets[writeIndex]

    const needsResize = readTarget.width !== outputWidth || readTarget.height !== outputHeight

    if (needsResize === true) {
      this.setSize(outputWidth, outputHeight)
      // setSize() disposes, so both targets need re-initializing
      renderer.initRenderTarget(readTarget)
      renderer.initRenderTarget(writeTarget)
    }

    // Seed both targets with a bilinear upscale of the current frame so the
    // first frames after a resize or a cut do not fade in from black, and so
    // the accumulator starts from τ = 0 rather than stale coverage.
    if (needsResize === true || this.#needsReset === true) {
      _quadMesh.material = this.#seedMaterial
      _quadMesh.name = 'TAAU.seed'
      for (const rt of this.#renderTargets) {
        renderer.setRenderTarget(rt)
        _quadMesh.render(renderer)
      }
      renderer.setRenderTarget(null)
      this.#needsReset = false
      this.#drawn.add(this.#seedMaterial)
    }

    // the neighbourhood statistics, one texel larger than the input on each side
    const statsWidth = inputWidth + 2
    const statsHeight = inputHeight + 2
    if (this.#statsRenderTarget.width !== statsWidth || this.#statsRenderTarget.height !== statsHeight) {
      this.#statsRenderTarget.setSize(statsWidth, statsHeight)
    }
    renderer.setRenderTarget(this.#statsRenderTarget)
    _quadMesh.material = this.#statsMaterial
    _quadMesh.name = 'TAAU.neighbourhood'
    _quadMesh.render(renderer)

    this.#historyNode.value = readTarget.textures[0]
    this.#auxNode.value = readTarget.textures[1]

    renderer.setRenderTarget(writeTarget)
    _quadMesh.material = this.#resolveMaterial
    _quadMesh.name = 'TAAU'
    _quadMesh.render(renderer)
    renderer.setRenderTarget(null)
    this.#drawn.add(this.#statsMaterial).add(this.#resolveMaterial)

    // swap — this frame's output is next frame's history, no copy needed
    this.#pingPong = writeIndex
    if (this.stableOutput === false) this.#textureNode.value = writeTarget.textures[0]

    // Keep the previous-depth target locked to the source depth's actual size:
    // a one-frame mismatch between the scene pass's depth attachment and the
    // beauty target's bookkeeping would otherwise produce a copy with
    // mismatched extents, which WebGPU rejects for depth formats.
    const currentDepth = this.depthNode.value
    const srcW = currentDepth.image?.width ?? 0
    const srcH = currentDepth.image?.height ?? 0

    if (srcW > 0 && srcH > 0) {
      if (this.#previousDepthRenderTarget.width !== srcW || this.#previousDepthRenderTarget.height !== srcH) {
        this.#previousDepthRenderTarget.setSize(srcW, srcH)
        renderer.initRenderTarget(this.#previousDepthRenderTarget)
      }

      const dstDepth = this.#previousDepthRenderTarget.depthTexture
      renderer.copyTextureToTexture(currentDepth, dstDepth)
      this.#previousDepthNode.value = dstDepth
    }

    // Retire this frame's camera for the next one. The camera carries the
    // current frame's jitter at this point (setViewOffset ran before the scene
    // pass), which is exactly what the next frame needs to unproject the depth
    // buffer we just copied.
    this.#previousCameraWorldMatrix.value.copy(this.camera.matrixWorld)
    this.#previousCameraProjectionMatrixInverse.value.copy(this.camera.projectionMatrixInverse)

    RendererUtils.restoreRendererState(renderer, _rendererState)
  }

  setup(builder) {
    if (builder.renderPipeline && !builder.context.renderPipelineState.viewOffsetOwner) {
      builder.context.renderPipelineState.viewOffsetOwner = this

      this.#needsPostProcessingSync = true

      OnBeforeRenderPipeline(() => {
        const beautyRenderTarget = this.#beautyRenderTarget()
        this.setViewOffset(beautyRenderTarget.texture.width, beautyRenderTarget.texture.height)
      })

      OnAfterRenderPipeline(() => {
        this.clearViewOffset()
      })
    }

    this.#syncRenderer(builder.renderer)
    // The shaders don't depend on the context's content, so a node compileAsync() built keeps its materials.
    this.#sharedContext = builder.getSharedContext()
    // every material that reads this node sets it up: rebuild only when what the shaders bake in changed, and never
    // under a compile in flight, which compiles the rebuilt materials when it settles
    if (this.#compiling === null && this.#built !== this.#structure()) this.#buildMaterials()

    return this.#textureNode
  }

  /**
   * Compiles the node's passes ahead of their first frame. Await it before rendering: each pass's target stays bound
   * while it compiles. Optional.
   */
  async compileAsync(renderer) {
    if (this.#disposed) return
    if (renderer.initialized !== true) await renderer.init()
    // one at a time: a compile holds the passes' vertex node until it settles
    while (this.#compiling !== null) await this.#compiling.catch(() => {})
    if (this.#disposed) return
    this.#syncRenderer(renderer)
    if (this.#built !== this.#structure()) this.#buildMaterials()
    // the frames drew every pass since the materials were built: their pipelines exist
    if (this.#drawn.size === 3) return
    const run = this.#compilePasses(renderer)
    this.#compiling = run
    try {
      await run
    } finally {
      this.#compiling = null
    }
    // an option changed while it ran: compile the rebuilt passes too
    if (!this.#disposed && this.#built !== this.#structure()) await this.compileAsync(renderer)
  }

  // Queues every pass the frame draws, for the targets it draws them into and in the renderer state it draws them in,
  // then waits for their pipelines.
  async #compilePasses(renderer) {
    // the frame's sizes: the ping-pong pair at the drawing buffer's, the stats one texel larger than the input
    const { width, height } = renderer.getDrawingBufferSize(_size)
    const [target] = this.#renderTargets
    if (target.width !== width || target.height !== height) {
      this.setSize(width, height)
      // the frame won't see the resize, and a resize leaves the history undefined
      this.#needsReset = true
    }
    const input = this.#beautyRenderTarget().texture
    const stats = this.#statsRenderTarget
    const statsWidth = input.width + 2
    const statsHeight = input.height + 2
    if (stats.width !== statsWidth || stats.height !== statsHeight) stats.setSize(statsWidth, statsHeight)

    // each pass for the target the frame draws it into
    const passes = this.#renderTargets.flatMap((target) => [
      [this.#seedMaterial, target],
      [this.#resolveMaterial, target],
    ])
    passes.push([this.#statsMaterial, stats])
    await Promise.all(passes.map(([material, target]) => compileQuad(renderer, _quadMesh, material, target)))
  }

  // What the shaders and targets take from the renderer, for setup() or a compile before any.
  #syncRenderer(renderer) {
    if (renderer.reversedDepthBuffer === true) this.#previousDepthRenderTarget.depthTexture.type = FloatType

    // Lock luma, τ and lock are non-negative: 4 bytes a pixel where the device
    // renders to rg11b10ufloat, the lock in its 10-bit channel.
    this.#auxType = renderer.hasFeature('rg11b10ufloat-renderable') ? UnsignedInt101111Type : HalfFloatType
    for (const rt of this.#renderTargets) this.#syncAuxType(rt)

    this.#reversedDepth = renderer.reversedDepthBuffer === true
    this.#logarithmicDepth = renderer.logarithmicDepthBuffer === true
  }

  #beautyRenderTarget() {
    return this.beautyNode.isRTTNode ? this.beautyNode.renderTarget : this.beautyNode.passNode.renderTarget
  }

  // What the shaders bake in.
  #structure() {
    return [
      this.#bicubicHistory,
      this.#reactiveNode?.id ?? -1,
      this.#stableOutput,
      this.#auxType,
      this.#reversedDepth,
      this.#logarithmicDepth,
      this.camera.isOrthographicCamera === true,
      isBilinear(this.beautyNode.value),
    ].join()
  }

  #buildMaterials() {
    this.#built = this.#structure()
    this.#drawn.clear()

    const auxType = this.#auxType
    const historyNode = this.#historyNode
    const auxNode = this.#auxNode

    const reversedDepthBuffer = this.#reversedDepth
    const logarithmicDepthBuffer = this.#logarithmicDepth
    const isOrthographic = this.camera.isOrthographicCamera === true

    // The two depth consumers here want OPPOSITE conventions, and getting that
    // backwards silently destroys the disocclusion test rather than erroring.
    //
    // `toViewZ` takes what TAAUtils' `sampleCurrentDepth` returns, which is
    // always a *standard* [0,1] depth — the helper already un-reverses and
    // de-logarithms. So the standard formulas are inlined rather than calling
    // three's `perspectiveDepthToViewZ`/`orthographicDepthToViewZ`, because
    // those branch on `reversedDepthBuffer` and expect a raw buffer value:
    // under reversed-Z they would apply a second flip to an already-flipped
    // depth, mapping near to -far and far to -near.
    const toViewZ = (depth, near, far) =>
      isOrthographic ? near.sub(far).mul(depth).sub(near) : near.mul(far).div(far.sub(near).mul(depth).sub(far))

    // `getViewPosition` feeds depth straight into the clip vector and inverts
    // it with `#previousCameraProjectionMatrixInverse`, which three built in
    // whatever convention the renderer uses — so this one wants the RAW stored
    // value, with no un-reversing. (Stock's `samplePreviousDepth` omits the
    // flip for exactly this reason, while `sampleCurrentDepth` applies it.)
    // A logarithmic buffer is the one case that still needs converting, into
    // the matching convention.
    const readPreviousDepth = (uvNode, near, far) => {
      const depth = this.#previousDepthNode.sample(uvNode).r
      if (logarithmicDepthBuffer === false) return depth

      const viewZ = logarithmicDepthToViewZ(depth, near, far)
      return reversedDepthBuffer
        ? viewZToReversedPerspectiveDepth(viewZ, near, far)
        : viewZToPerspectiveDepth(viewZ, near, far)
    }

    const toClipSpace = (c) => vec4(this.#clipMatrix.mul(c.rgb), c.a)
    const fromClipSpace = (c) => vec4(this.#clipMatrixInverse.mul(c.rgb), c.a)

    // --- neighbourhood: once per input texel ---
    //
    // Each texel stands for the output pixels whose `closestTap` it is. The
    // target is one texel larger than the input on each side, so texel (i, j)
    // holds `closestTap` (i - 1, j - 1). Statistics, by attachment:
    //   motion:     offset UV (xy), 4 × the dilated texel's index in the 3×3 + flags (1 = edge, 2 = luma ridge) (z),
    //               the standard deviation in the clip colour space (w = b)
    //   mean:       the 3×3 mean colour
    //   spread:     the 3×3 RGB standard deviation (rgb), the median luma (a)
    //   clipSpread: the standard deviation in the clip colour space (xy = rg), the reactive mask (z), if any
    // Index and flags are integers under 36, exact in a half float.

    const motionOutput = property('vec4')
    const meanOutput = property('vec4')
    const spreadOutput = property('vec4')
    const clipSpreadOutput = property(this.reactiveNode === null ? 'vec2' : 'vec4')
    const statsOutputNode = outputStruct(motionOutput, meanOutput, spreadOutput, clipSpreadOutput)

    const neighbourhood = Fn(() => {
      const inputSize = ivec2(this.beautyNode.size())
      const inputSizeF = vec2(inputSize)
      const near = this.#cameraNearFar.x
      const far = this.#cameraNearFar.y

      const closestTapF = uv().mul(inputSizeF.add(2)).floor().sub(1).toConst()
      const closestTap = ivec2(closestTapF)

      // Kept one texel inside the edge so the depth helper's own 3x3 walk, and
      // the velocity load at whichever texel it picks, stay in bounds too.
      const dilationCenter = closestTapF.clamp(vec2(1), inputSizeF.sub(vec2(2)))

      const currentDepth = sampleCurrentDepth(this.depthNode, dilationCenter, this.#cameraNearFar)
      const closestDepth = currentDepth.get('closestDepth')
      const closestPositionTexel = currentDepth.get('closestPositionTexel')
      const farthestDepth = currentDepth.get('farthestDepth')

      const offsetUV = this.velocityNode.load(closestPositionTexel).xy.mul(vec2(0.5, -0.5))

      const closestViewZ = toViewZ(closestDepth, near, far).toVar()
      const farthestViewZ = toViewZ(farthestDepth, near, far)
      const isEdge = closestViewZ.sub(farthestViewZ).abs().greaterThan(closestViewZ.abs().mul(this.edgeDetectTolerance))

      const moment1 = vec4(0).toVar()
      const moment2 = vec4(0).toVar()
      const clipMoment1 = vec4(0).toVar()
      const clipMoment2 = vec4(0).toVar()
      // Per-tap luma, in `_offsets` order, for the thin-feature lock.
      const tapLumas = []

      for (const [x, y] of _offsets) {
        // Clamped into the texture, as the reconstruction's taps are.
        const tap = closestTap.add(ivec2(x, y)).clamp(ivec2(0), inputSize.sub(ivec2(1)))
        const c = this.beautyNode.load(tap).max(0).toVar()

        moment1.addAssign(c)
        moment2.addAssign(c.pow2())

        const clipColor = toClipSpace(c)
        clipMoment1.addAssign(clipColor)
        clipMoment2.addAssign(clipColor.pow2())

        tapLumas.push(luminance(c.rgb).toVar())
      }

      // Floored at 1e-6 rather than 0: a perfectly flat neighbourhood would
      // otherwise give a zero-width clip box and reject all history.
      const N = float(_offsets.length)
      const mean = moment1.div(N)
      const spread = moment2.div(N).sub(mean.pow2()).max(1e-6).sqrt()
      const clipMean = clipMoment1.div(N)
      const clipSpread = clipMoment2.div(N).sub(clipMean.pow2()).max(1e-6).sqrt()

      // The median ignores the feature itself: a sub-texel feature that drops
      // out of this frame's jittered raster barely moves it.
      const medianLuma = median9(tapLumas)

      // FSR2's shape test (ComputeThinFeatureConfidence): the nucleus must be
      // a luma ridge, brighter or darker than every dissimilar neighbour, and
      // no 2×2 quadrant around it may be all similar, which would make it part
      // of a feature at least two texels wide. A step edge fails it.
      const nucleusLuma = tapLumas[4]
      const similar = []
      let dissimilarMin = float(1e9)
      let dissimilarMax = float(0)
      for (let i = 0; i < _offsets.length; i++) {
        if (i === 4) continue
        const l = tapLumas[i]
        similar[i] = max(l, nucleusLuma).div(min(l, nucleusLuma).max(1e-6)).lessThan(this.lockSimilarity).toVar()
        dissimilarMin = min(dissimilarMin, similar[i].select(float(1e9), l))
        dissimilarMax = max(dissimilarMax, similar[i].select(float(0), l))
      }
      const isRidge = nucleusLuma.greaterThan(dissimilarMax).or(nucleusLuma.lessThan(dissimilarMin))
      const isThick = [
        [0, 1, 3],
        [1, 2, 5],
        [3, 6, 7],
        [5, 7, 8],
      ]
        .map(([a, b, c]) => similar[a].and(similar[b]).and(similar[c]))
        .reduce((any, quadrant) => any.or(quadrant))

      const flags = isEdge.select(float(1), float(0)).add(isRidge.and(isThick.not()).select(float(2), float(0)))
      // Which of the 3×3 the dilation picked, (dx + 1) × 3 + (dy + 1): the resolve reloads its depth, since a
      // half-float view Z flips the disocclusion test on distant and grazing surfaces.
      const dilatedOffset = closestPositionTexel.sub(dilationCenter)
      const dilatedIndex = dilatedOffset.x.add(1).mul(3).add(dilatedOffset.y.add(1))
      const reactive = this.reactiveNode !== null ? this.reactiveNode.load(closestPositionTexel).r : float(0)

      motionOutput.assign(vec4(offsetUV, dilatedIndex.mul(4).add(flags), clipSpread.b))
      meanOutput.assign(mean)
      spreadOutput.assign(vec4(spread.rgb, medianLuma))
      clipSpreadOutput.assign(this.reactiveNode === null ? clipSpread.rg : vec4(clipSpread.rg, reactive, 0))

      return vec4(0) // TSL requires colorNode to return a value
    })

    // --- resolve: once per output pixel ---

    const colorOutput = property('vec4')
    // Three channels for an rg11b10ufloat aux. It also keeps these shaders from
    // matching an older version's: three r187 keys a render pipeline on its
    // shader and the first attachment's format only.
    const halfAux = auxType === HalfFloatType
    const auxOutput = property(halfAux ? 'vec4' : 'vec3')
    const auxValue = (lockLuma, accum, lock) => (halfAux ? vec4(lockLuma, accum, lock, 1) : vec3(lockLuma, accum, lock))
    // with `stableOutput`, the color twice: the history's attachment, and the shared published one
    const outputNode = this.stableOutput
      ? outputStruct(colorOutput, auxOutput, colorOutput)
      : outputStruct(colorOutput, auxOutput)

    // 5-tap optimized Catmull-Rom. Sharper than a bilinear tap across
    // reprojections, which matters more here than in TRAA because an upscaler
    // leans much harder on history.
    // Reference: https://gist.github.com/TheRealMJP/c83b8c0f46b63f3a88a5986f4fa982b1
    const sampleHistoryBicubic = Fn(([uvNode, textureSize]) => {
      const samplePos = uvNode.mul(textureSize).sub(vec2(0.5))
      const texPos1 = samplePos.floor()
      const f = samplePos.fract()
      const f2 = f.mul(f).toVar()
      const f3 = f2.mul(f).toVar()

      const w0 = f2.sub(f.mul(0.5)).sub(f3.mul(0.5)).toVar()
      const w1 = f3.mul(1.5).sub(f2.mul(2.5)).add(float(1)).toVar()
      const w2 = f.mul(0.5).add(f2.mul(2)).sub(f3.mul(1.5)).toVar()
      const w3 = f3.mul(0.5).sub(f2.mul(0.5)).toVar()

      const w12 = w1.add(w2).toVar()
      const offset12 = w2.div(w12)

      const invSize = float(1).div(textureSize)
      const texPos0 = texPos1.sub(vec2(1)).add(vec2(0.5)).mul(invSize)
      const texPos3 = texPos1.add(vec2(2)).add(vec2(0.5)).mul(invSize)
      const texPos12 = texPos1.add(vec2(0.5)).add(offset12).mul(invSize)

      const wA = w12.x.mul(w0.y)
      const wB = w0.x.mul(w12.y)
      const wC = w12.x.mul(w12.y)
      const wD = w3.x.mul(w12.y)
      const wE = w12.x.mul(w3.y)

      const sA = historyNode.sample(vec2(texPos12.x, texPos0.y)).mul(wA)
      const sB = historyNode.sample(vec2(texPos0.x, texPos12.y)).mul(wB)
      const sC = historyNode.sample(vec2(texPos12.x, texPos12.y)).mul(wC)
      const sD = historyNode.sample(vec2(texPos3.x, texPos12.y)).mul(wD)
      const sE = historyNode.sample(vec2(texPos12.x, texPos3.y)).mul(wE)

      const totalWeight = wA.add(wB).add(wC).add(wD).add(wE)

      // Clamp to >= 0: Catmull-Rom's negative lobes (w0, w3) can ring into
      // negative RGB on high-contrast HDR edges, showing as dark fringing.
      return sA.add(sB).add(sC).add(sD).add(sE).div(totalWeight).max(0)
    })

    const bilinearReconstruction = isBilinear(this.beautyNode.value)

    const [motionNode, meanNode, spreadNode, clipSpreadNode] = this.#statsNodes

    const resolve = Fn(() => {
      const uvNode = uv()
      const inputSize = ivec2(this.beautyNode.size())
      const inputSizeF = vec2(inputSize)
      const outputSizeF = this.#outputSize
      const near = this.#cameraNearFar.x
      const far = this.#cameraNearFar.y

      // input pixels per output pixel — 0.5 at a 2x upscale
      const ratio = inputSizeF.x.div(outputSizeF.x).toConst()

      // output pixel center, in input-pixel coordinates
      const pIn = uvNode.mul(inputSizeF)

      // the sample at integer texel (m, n) was rendered at (m + 0.5 + jitter)
      const closestTapF = pIn.sub(vec2(0.5).add(this.#jitterOffset)).round()
      const closestTap = ivec2(closestTapF)

      // the neighbourhood's statistics, one texel in from the stats target's border
      const statsTexel = closestTap.add(ivec2(1))
      const motion = motionNode.load(statsTexel).toVar()
      const mean = meanNode.load(statsTexel).toVar()
      const spread = spreadNode.load(statsTexel).toVar()
      const clipStats = clipSpreadNode.load(statsTexel).toVar()
      const clipSpread = vec3(clipStats.xy, motion.w)
      const dilatedIndex = motion.z.div(4).floor().toVar()
      const flags = motion.z.sub(dilatedIndex.mul(4))

      const offsetUV = motion.xy
      const historyUV = uvNode.sub(offsetUV).toConst()

      // the dilated depth at full precision, as sampleCurrentDepth converts it
      const dilationCenter = closestTapF.clamp(vec2(1), inputSizeF.sub(vec2(2))).toVar()
      const dilatedTexel = dilationCenter.add(vec2(dilatedIndex.div(3).floor(), dilatedIndex.mod(3)).sub(1))
      let closestDepth = this.depthNode.load(dilatedTexel).r
      if (reversedDepthBuffer) closestDepth = closestDepth.oneMinus()
      if (logarithmicDepthBuffer) {
        closestDepth = viewZToPerspectiveDepth(logarithmicDepthToViewZ(closestDepth, near, far), near, far)
      }
      const closestViewZ = toViewZ(closestDepth, near, far).toVar()
      const isEdge = flags.mod(2).greaterThan(0.5)
      const isRidge = flags.greaterThan(1.5)

      // Scale-invariant depth tests in linear view space: a tolerance
      // proportional to local depth.
      const previousDepth = readPreviousDepth(historyUV, near, far)
      const previousPositionView = getViewPosition(
        historyUV,
        previousDepth,
        this.#previousCameraProjectionMatrixInverse,
      )
      const previousViewZ = this.#reprojectionMatrix.mul(vec4(previousPositionView, 1)).z

      const depthScale = closestViewZ.abs()
      const depthDelta = closestViewZ.sub(previousViewZ).abs()

      const isValidUV = historyUV.greaterThanEqual(0).all().and(historyUV.lessThanEqual(1).all())
      // Two-sided: geometry appearing closer makes the history as stale as geometry receding.
      const isDisocclusion = depthDelta.greaterThan(depthScale.mul(this.depthRejectTolerance))
      const hasValidHistory = isValidUV.and(isEdge.or(isDisocclusion.not()))

      // 9-tap Gaussian reconstruction around `closestTap`, weighted by the
      // distance from the output pixel center to each tap's *jittered* sample
      // center. sigma is in OUTPUT pixels, converted by the upscale ratio and floored.
      const sigma = max(this.kernelSigma.mul(ratio), this.kernelSigmaFloor)
      const invTwoSigmaSq = float(-0.5).div(sigma.mul(sigma)).toConst()

      // from the closest tap's sample center to the output pixel center, in input pixels
      const d = pIn.sub(closestTapF.add(vec2(0.5).add(this.#jitterOffset))).toVar()

      // The kernel is separable: per axis, the weights of taps -1, 0 and +1.
      const wm = exp(d.add(1).pow2().mul(invTwoSigmaSq)).toVar()
      const w0 = exp(d.pow2().mul(invTwoSigmaSq)).toVar()
      const wp = exp(d.sub(1).pow2().mul(invTwoSigmaSq)).toVar()

      let currentColor
      if (bilinearReconstruction) {
        // Tap -1 at its texel center; taps 0 and +1 in one bilinear fetch
        // between their centers, so 2×2 fetches cover the 3×3. Clamp-to-edge
        // addressing clamps out-of-range taps as the loads below do.
        const w0p = w0.add(wp).toVar()
        const invInputSize = vec2(1).div(inputSizeF)
        const a = closestTapF.sub(0.5).mul(invInputSize).toVar()
        const b = closestTapF.add(0.5).add(wp.div(w0p)).mul(invInputSize).toVar()
        const fetch = (x, y) => this.beautyNode.sample(vec2(x, y)).level(0).max(0)

        const sum = fetch(a.x, a.y)
          .mul(wm.x.mul(wm.y))
          .add(fetch(a.x, b.y).mul(wm.x.mul(w0p.y)))
          .add(fetch(b.x, a.y).mul(w0p.x.mul(wm.y)))
          .add(fetch(b.x, b.y).mul(w0p.x.mul(w0p.y)))
        const sumWeight = wm.x.add(w0p.x).mul(wm.y.add(w0p.y))
        currentColor = sum.div(sumWeight.max(1e-5)).toVar()
      } else {
        const weights = [wm, w0, wp]
        const sumColor = vec4(0).toVar()
        const sumWeight = float(0).toVar()
        for (const [x, y] of _offsets) {
          const w = weights[x + 1].x.mul(weights[y + 1].y)
          const tap = closestTap.add(ivec2(x, y)).clamp(ivec2(0), inputSize.sub(ivec2(1)))
          sumColor.addAssign(this.beautyNode.load(tap).max(0).mul(w))
          sumWeight.addAssign(w)
        }
        currentColor = sumColor.div(sumWeight.max(1e-5)).toVar()
      }

      // How well this frame's samples covered this output pixel: FSR2's
      // per-pixel omega, the closest tap's own weight.
      const coverage = w0.x.mul(w0.y).toConst()

      // variance clip, from the neighbourhood's moments
      const motionFactor = offsetUV.mul(outputSizeF).length().div(this.maxVelocityLength).saturate().toVar()
      const varianceGamma = mix(this.varianceGammaMin, 1, motionFactor.oneMinus().pow2())
      // The mean is inside its own box, so it is the clip's center as is.
      const variance = vec4(spread.rgb.mul(varianceGamma), 0)
      const minColor = mean.sub(variance)
      const maxColor = mean.add(variance)

      const historyColor = this.bicubicHistory
        ? sampleHistoryBicubic(historyUV, outputSizeF)
        : historyNode.sample(historyUV)

      // The RGB clip, then (with `clipColorSpace` 'ycocg') the YCoCg box as
      // well. Neither box contains the other, so clipping against both keeps
      // at most what either would.
      const rgbClippedHistory = clipAABB(mean, historyColor, minColor, maxColor)
      // The clip space is linear, so the mean's transform is the transformed colours' mean.
      const clipMean = toClipSpace(mean)
      const clipVariance = vec4(clipSpread.rgb.mul(varianceGamma), 0)
      const clipMin = clipMean.sub(clipVariance)
      const clipMax = clipMean.add(clipVariance)
      const clippedHistoryColor = fromClipSpace(
        clipAABB(clipMean, toClipSpace(rgbClippedHistory), clipMin, clipMax),
      )

      // Thin-feature lock. Variance clipping would destroy a sub-pixel feature,
      // so locked pixels keep their unclipped history. Read at `historyUV`, so a
      // lock follows the surface it belongs to.
      const aux = auxNode.sample(historyUV)

      // Luma is linear, so the luma of the mean is the mean of the tap lumas.
      const meanLuma = luminance(mean.rgb).toVar()
      const medianLuma = spread.a

      // Symmetric relative contrast |c-m|/(c+m) against the neighbourhood mean: it
      // fires on both sides of every high-contrast silhouette.
      const currentLuma = luminance(currentColor.rgb)
      const contrastThinFeature = currentLuma
        .sub(meanLuma)
        .abs()
        .div(currentLuma.add(meanLuma).max(1e-4))
        .smoothstep(0, this.lockThreshold)

      // The neighbourhood pass's ridge test only ever vetoes the contrast test.
      const ridgeThinFeature = isRidge.select(float(1), float(0))
      const thinFeature = this.lockDetection
        .greaterThan(0.5)
        .select(ridgeThinFeature.mul(contrastThinFeature), contrastThinFeature)

      const canLock = isValidUV.and(isDisocclusion.not())
      const newLock = canLock.select(thinFeature, float(0)).toVar()

      // An inherited lock remembers the neighbourhood's median luma from when
      // it was created (`aux.r`), and is dropped once that has changed by more
      // than `lockLumaTolerance` (FSR2's lock kill).
      const storedLuma = aux.r
      const lumaChange = float(1).sub(min(storedLuma, medianLuma).div(max(storedLuma, medianLuma).max(1e-6)))
      const keepInherited = canLock.and(lumaChange.lessThanEqual(this.lockLumaTolerance))
      const inheritedLock = aux.b.mul(keepInherited.select(this.lockDecay, 0)).toVar()
      const lock = max(newLock, inheritedLock).saturate().toVar()
      const lockLuma = newLock.greaterThanEqual(inheritedLock).select(medianLuma, storedLuma)
      const lockedHistoryColor = mix(clippedHistoryColor, historyColor, lock)

      // An edge keeps history the depth test rejected. When that edge moves
      // across what is behind it (the dilated surface's motion differs from
      // this pixel's own by `edgeDisocclusionMinParallax` output px) and no
      // previous surface across historyUV's 2×2 footprint matches either, the
      // history came from somewhere else: it is kept for anti-aliasing, but
      // only for `edgeDisocclusionAccumulation` samples.
      const edgeUnmatched = float(0).toVar()
      If(isEdge.and(isDisocclusion).and(isValidUV), () => {
        const ownOffsetUV = this.velocityNode.load(dilationCenter).xy.mul(vec2(0.5, -0.5))
        const parallaxPx = offsetUV.sub(ownOffsetUV).mul(outputSizeF).length()
        If(parallaxPx.greaterThanEqual(this.edgeDisocclusionMinParallax), () => {
          const footprintBase = historyUV.mul(inputSizeF).sub(0.5).floor()
          const closestDelta = float(1e9).toVar()
          for (const [dx, dy] of [
            [0, 0],
            [1, 0],
            [0, 1],
            [1, 1],
          ]) {
            const tapUV = footprintBase.add(vec2(dx, dy)).add(0.5).div(inputSizeF).clamp(0, 1)
            const tapPosition = getViewPosition(
              tapUV,
              readPreviousDepth(tapUV, near, far),
              this.#previousCameraProjectionMatrixInverse,
            )
            const tapViewZ = this.#reprojectionMatrix.mul(vec4(tapPosition, 1)).z
            closestDelta.assign(min(closestDelta, closestViewZ.sub(tapViewZ).abs()))
          }
          edgeUnmatched.assign(
            closestDelta.greaterThan(depthScale.mul(this.depthRejectTolerance)).select(float(1), float(0)),
          )
        })
      })
      const accumulationCap = edgeUnmatched
        .greaterThan(0.5)
        .select(min(this.edgeDisocclusionAccumulation, this.maxAccumulation), this.maxAccumulation)

      // Accumulated sample weight tau: reset on disocclusion, capped so a
      // static pixel never stops responding.
      const previousAccum = hasValidHistory.select(aux.g, 0)
      const accum = min(previousAccum.add(coverage), accumulationCap).toVar()

      // alpha = omega / tau, the FSR2 blend. The uniform floor keeps a fully
      // converged pixel from freezing; motion and the reactive mask push it up.
      const currentWeight = max(coverage.div(accum.max(1e-5)), this.currentFrameWeight).toVar()
      currentWeight.addAssign(motionFactor)

      if (this.reactiveNode !== null) {
        // Alpha-blended and additive content writes no usable velocity, so it
        // has to be told to distrust history rather than having it inferred.
        const reactive = clipStats.z.mul(this.reactiveAmount).saturate()
        currentWeight.addAssign(reactive)
        accum.assign(mix(accum, coverage, reactive))
      }

      currentWeight.assign(hasValidHistory.select(currentWeight.saturate(), 1))

      const output = flickerReduction(currentColor, lockedHistoryColor, currentWeight)

      colorOutput.assign(output)
      auxOutput.assign(auxValue(lockLuma, accum, lock))

      return vec4(0) // TSL requires colorNode to return a value
    })

    const sharedContext = context(this.#sharedContext)

    this.#statsMaterial.contextNode = sharedContext
    this.#statsMaterial.colorNode = neighbourhood()
    this.#statsMaterial.outputNode = statsOutputNode

    this.#resolveMaterial.contextNode = sharedContext
    this.#resolveMaterial.colorNode = resolve()
    this.#resolveMaterial.outputNode = outputNode

    this.#seedMaterial.colorNode = Fn(() => {
      colorOutput.assign(this.beautyNode.sample(uv()))
      auxOutput.assign(auxValue(0, 0, 0))

      return vec4(0)
    })()

    this.#seedMaterial.contextNode = sharedContext
    this.#seedMaterial.outputNode = outputNode

    for (const material of [this.#statsMaterial, this.#resolveMaterial, this.#seedMaterial]) material.needsUpdate = true
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    super.dispose()

    const free = () => {
      for (const rt of this.#renderTargets) rt.dispose()
      this.#statsRenderTarget.dispose()
      this.#previousDepthRenderTarget.dispose()

      this.#statsMaterial.dispose()
      this.#resolveMaterial.dispose()
      this.#seedMaterial.dispose()
    }
    // a compile in flight would bind what is freed meanwhile
    if (this.#compiling !== null) this.#compiling.then(free, free)
    else free()
  }
}

export { TAAUNode, syncUnjitteredProjection }

/**
 * TSL function for creating a TAAUNode — temporal anti-aliasing with upsampling.
 *
 * @tsl
 * @function
 * @param {TextureNode} beautyNode - Scene color at the input resolution.
 * @param {TextureNode} depthNode - Scene depth at the input resolution.
 * @param {TextureNode} velocityNode - Scene velocity at the input resolution.
 * @param {Camera} camera - The camera the scene is rendered with.
 * @param {Object} [options] - See the constructor.
 * @returns {TAAUNode}
 */
export const taau = (beautyNode, depthNode, velocityNode, camera, options) =>
  new TAAUNode(convertToTexture(beautyNode), depthNode, velocityNode, camera, options)
