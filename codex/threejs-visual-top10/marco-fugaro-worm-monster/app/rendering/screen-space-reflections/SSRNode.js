/**
 * SSRNode - temporally seeded, bracketed, safeguarded Newton screen-space reflections
 *
 * After Mayer, Assarsson, Sintorn 2026 ("Ultrafast Screen-Space Refractions and Caustics via Newton's Method"),
 * applied to reflections. Each reflective pixel finds where its view-space reflection ray meets the depth buffer by
 * Newton's method on the G-buffer's facets: the ray is intersected with the plane of the texel it stands over, which
 * converges in one step on a planar piece. Last frame's hit, reprojected through velocity (or a neighbour's), seeds the
 * search, so a steady pixel is accepted with no iteration; cold pixels bracket the first crossing with a few stratified
 * probes. The bracket keeps Newton safe (Illinois regula falsi when a step leaves it), a 1-px test plus a slope-scaled
 * depth guard accepts the result, and the trace stores only the hit distance. The resolve fetches the colour at the
 * consumer's pixel from a roughness-matched level of a shared colour pyramid; misses fall back to the environment.
 * Under a still camera with `jitter` off, the output is bit-identical from frame to frame.
 *
 *   const scenePass = pass(scene, camera, { samples: 0 })
 *   scenePass.setMRT(mrt({ output, velocity, ...ssrGBuffer() }))
 *   scenePass.getTexture('velocity').type = THREE.HalfFloatType      // RG16F: keeps the MRT at 30 B per sample
 *   scenePass.getTexture('velocity').format = THREE.RGFormat
 *   const color = scenePass.getTextureNode()
 *   const reflections = ssr(color, scenePass, {                      // reads the pass's ssr* and velocity textures
 *     thickness: 0.2,
 *     roughnessCutoff: 0.6,
 *   })
 *   const composite = ssrComposite(color, reflections, scene.environment, {
 *     environmentIntensity: () => scene.environmentIntensity,          // read each frame
 *     environmentRotation: scene.environmentRotation,
 *   })
 *   renderPipeline.outputNode = traa(rtt(composite, null, null, { type: THREE.HalfFloatType }), depth, velocity, camera)
 *   await reflections.compileAsync(renderer)                         // optional: the passes' pipelines, ahead of time
 *
 * Inputs: the pass must spread `ssrGBuffer()` into its MRT (or supply `normalsNode`, `linearDepthNode` and
 * `specularNode`), render opaque geometry with `samples: 0`, and keep velocity RG16F. The depth buffer itself is never
 * read, so reversed and logarithmic depth need nothing. The node's output, `resolve()` and the composite must run at the
 * G-buffer's resolution; `getTextureNode()` serves any other uv. Run TRAA after the composite, so the colour, the
 * G-buffer and the subtraction see the same jittered sample.
 *
 * Outputs: the node itself is `(L_ssr, c)` at the fragment's G-buffer texel; `ssrComposite()` replaces the
 * scene's environment specular by `mix(L_env, L_ssr, c)`; `ssrEnvironmentSpecular()` is that `F·L_env`.
 *
 * Numeric settings are uniforms (getter → UniformNode, setter → value) and switches uniform 0/1: changing them never
 * recompiles. `batch` and `velocityNode` rebuild the trace on the next frame, as do `normalsNode`, `linearDepthNode`,
 * `specularNode` and `resolutionScale`. Those four and `pyramidLevels` also change what the node's inline readers
 * compile to (the node, `resolve()`, `ssrComposite()`, `ssrEnvironmentSpecular()`): rebuild the output graph after
 * changing them. `getTextureNode()` follows on its own. The camera type is fixed at construction.
 */
import {
  FloatType,
  HalfFloatType,
  Matrix4,
  NearestFilter,
  Node,
  NodeMaterial,
  NodeUpdateType,
  QuadMesh,
  RedFormat,
  RenderTarget,
  RendererUtils,
  RGBAFormat,
  RGFormat,
  TextureNode,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
} from 'three/webgpu'
import {
  abs,
  bool,
  clamp,
  context,
  densityFogFactor,
  dot,
  EnvironmentBRDF,
  float,
  floor,
  fract,
  Fn,
  If,
  int,
  interleavedGradientNoise,
  ivec2,
  Loop,
  Break,
  max,
  min,
  mix,
  nodeObject,
  normalFlat,
  normalize,
  normalView,
  pmremTexture,
  positionView,
  positionViewDirection,
  property,
  rangeFogFactor,
  reference,
  reflect,
  renderGroup,
  roughness,
  screenCoordinate,
  screenUV,
  select,
  specularColorBlended,
  specularF90,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { RawTextureNode, colorPyramid } from './utils/ColorPyramidNode.js'
import { compileQuad } from './utils/compileQuad.js'
import {
  G_MAX,
  ITERS_MAX,
  K_MAX,
  SEED,
  acceptHit,
  assignPlane,
  clipScreenRay,
  coneLOD,
  coneTangent,
  liftAboveHorizon,
  octDecode,
  octEncode,
  pixelAngle,
  planeAt,
  planeVar,
  reflectionRay,
  texelCentre,
  texelOf,
  otherTexel,
  traceNewton,
  uvFromView,
  viewFromUV,
} from './utils/newtonRayTrace.js'

// The input nodes: undefined takes the pass's texture.
const INPUTS = ['velocityNode', 'normalsNode', 'linearDepthNode', 'specularNode']
const BATCHES = [1, 2, 4]
const RESOLUTION_SCALES = [1, 0.5]
const COMPOSITE_OPTIONS = ['environmentIntensity', 'environmentRotation', 'mode']
const ENVIRONMENT_OPTIONS = ['environmentIntensity', 'environmentRotation']
const UPSAMPLE_POLISH_STEPS_MAX = 3

// The node's numeric settings, each a property: name: [default, min, max, integer]
const SETTINGS = {
  // Probe gate base, m: a probe behind the surface by at most `thickness + 2·|Δd_ray|` is a gated crossing.
  thickness: [0.1, 0, Infinity],
  // px: the 1-px test's threshold, and the depth guard's slope allowance.
  hitTolerance: [1, 0, Infinity],
  // px: hits closer to the origin are self-hits; the first probe's offset.
  minDistance: [2, 0, Infinity],
  // px of footprint the origin moves along the flat normal.
  originOffset: [1, 0, Infinity],
  // Relative depth mismatch that rejects a reprojected seed.
  disocclusionThreshold: [0.03, 0, Infinity],
  // Cold probes at most.
  probes: [8, 2, K_MAX, true],
  // Guard probes before a seed.
  guardProbes: [2, 0, G_MAX, true],
  // Refine iterations per search at most; a pixel runs up to 3 searches.
  iterations: [4, 0, ITERS_MAX, true],
  // Relative depth tolerance for "in front", and the depth guard's floor.
  crossingEpsilon: [1e-3, 0, Infinity],
  // |dot(Ng, R)| below which a Newton step falls back to regula falsi.
  minDenominator: [0.05, 0, 1],
  // px step that counts as converged.
  convergePx: [0.5, 0, Infinity],
  // Minimum dot(R, Ng) at the origin: normal maps can bend R under the surface.
  horizon: [0.02, 0, 1],
  // px: the largest step on an open (unbracketed) path.
  trustRegion: [16, 0, Infinity],
  // Screen fraction over which hits fade out at the edges.
  edgeFade: [0.05, 0, 0.5],
  // View-space R.z where rays toward the camera start fading, and where they have faded out.
  cameraFadeStart: [0.6, -1, 1],
  cameraFadeEnd: [0.9, -1, 1],
  // Roughness where reflections start fading to the environment, and from which only the environment is used (those
  // pixels aren't traced).
  roughnessFadeStart: [0.2, 0, 1],
  roughnessCutoff: [0.4, 0, 1],
  // Pixels whose max(F) is below this aren't traced.
  fresnelThreshold: [0.004, 0, 1],
  // Offset of the cone LOD, in pyramid levels.
  lodBias: [0, -Infinity, Infinity],
  // resolutionScale 0.5: plane distance, relative to depth, within which a neighbouring record is reused.
  upsampleTolerance: [0.02, 0, Infinity],
  // resolutionScale 0.5: facet steps of the resolve's polish on its own ray.
  upsamplePolishSteps: [3, 0, UPSAMPLE_POLISH_STEPS_MAX, true],
}
// Boolean properties, on by default:
// - temporalSeeding: seeds from last frame's records; off: every pixel is cold.
// - neighbourSeeding: seeds from the 4 neighbours of the reprojected record when the own one fails.
// - jitter: jitters the probes per pixel and frame; off: a fixed offset per pixel, deterministic.
// - glossy: cone LOD into the colour pyramid; off: mirror fetch, and the pyramid isn't rendered for this node.
const SWITCHES = ['temporalSeeding', 'neighbourSeeding', 'jitter', 'glossy']
const OPTIONS = [
  'label',
  ...INPUTS,
  'resolutionScale',
  'batch',
  'pyramidLevels',
  'maxDistance',
  ...Object.keys(SETTINGS),
  ...SWITCHES,
]
// The pass's texture behind each G-buffer input
const GBUFFER_INPUTS = { ssrNormals: 'normalsNode', ssrDepth: 'linearDepthNode', ssrSpecular: 'specularNode' }
const INFINITE_DISTANCE = 1e30

const _quadMesh = new QuadMesh()
const _size = new Vector2()

const warnUnknown = (who, rest, options) => {
  for (const key of Object.keys(rest)) console.warn(`${who}: unknown option "${key}". Options: ${options.join(', ')}.`)
}

// Background and depthWrite-off materials write "no surface".
const surface = (node, empty) => Fn((builder) => (builder.material.depthWrite === false ? empty : node))()

// The share of the surface's light the scene's fog lets through, as three's materials fog it: 1 without fog, on
// materials with `fog: false`, and under a custom scene.fogNode, which isn't modelled.
const fogTransmittance = Fn((builder) => {
  const { scene, material } = builder
  const sceneFog = scene?.fog
  if (!sceneFog || scene.fogNode || material.fog !== true) return float(1)
  const parameter = (name) => reference(name, 'float', sceneFog).setGroup(renderGroup)
  if (sceneFog.isFogExp2) return densityFogFactor(parameter('density')).oneMinus()
  if (sceneFog.isFog) return rangeFogFactor(parameter('near'), parameter('far')).oneMinus()
  return float(1)
})

/**
 * The MRT outputs the node reads, to spread into the scene pass's `mrt()`:
 * - `ssrNormals` (RGBA16F): octahedral flat (triangle) normal and octahedral shading normal, view space;
 * - `ssrDepth` (R16F): linear view depth `−positionView.z` (0: background);
 * - `ssrSpecular` (RGBA8): `sqrt(F_env · T_fog)` and roughness, `F_env` being the environment-specular weight of
 *   three's physical lighting model (EnvironmentBRDF of the blended specular colour) and `T_fog` the share of the
 *   surface's light the scene's fog lets through, so the composite fogs what it adds and subtracts as the material
 *   fogged its own environment specular; non-PBR materials write F = 0.
 * Non-output attachments clear to (0, 0, 0, 1), which already reads as background with F = 0.
 */
export function ssrGBuffer() {
  const dotNV = normalView.dot(positionViewDirection).clamp()
  const F = EnvironmentBRDF({ dotNV, specularColor: specularColorBlended, specularF90, roughness })
  return {
    ssrNormals: surface(vec4(octEncode(normalFlat), octEncode(normalView)), vec4(0)),
    ssrDepth: surface(positionView.z.negate(), float(0)),
    ssrSpecular: surface(vec4(F.max(0).mul(fogTransmittance()).sqrt(), roughness), vec4(0, 0, 0, 1)),
  }
}

// Runs the node's frame update before the shader that reads it renders, after the G-buffer pass.
class SSRUpdateNode extends Node {
  static get type() {
    return 'SSRUpdateNode'
  }

  constructor(ssrNode) {
    super('void')
    this.ssrNode = ssrNode
    this.updateBeforeType = NodeUpdateType.FRAME
  }

  setup(builder) {
    this.ssrNode.registerInputs(builder, this)
    if (builder.observer !== null) builder.observer.hasNode = true
  }

  updateBefore(frame) {
    this.ssrNode.updateBefore(frame)
  }
}

// `valueNode`, with the node's frame update run first.
class SSRValueNode extends Node {
  static get type() {
    return 'SSRValueNode'
  }

  constructor(updateNode, valueNode) {
    super('vec4')
    this.updateNode = updateNode
    this.valueNode = valueNode
  }

  setup(builder) {
    builder.getNodeProperties(this).updateNode = this.updateNode
    return this.valueNode
  }
}

// A texture of the node whose readers run the node's frame update first.
class SSRTextureNode extends TextureNode {
  static get type() {
    return 'SSRTextureNode'
  }

  constructor(updateNode, value) {
    super(value)
    this.updateNode = updateNode
    this.setUpdateMatrix(false)
  }

  setup(builder) {
    builder.getNodeProperties(this).updateNode = this.updateNode
    return super.setup(builder)
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

const max3 = (v) => max(v.x, max(v.y, v.z))

// smoothstep from a to b; a hard step at a when a ≥ b, where WGSL's smoothstep is indeterminate
const ramp = (a, b, x) => {
  const t = clamp(x.sub(a).div(max(b.sub(a), 1e-6)), 0, 1)
  return t.mul(t).mul(t.mul(-2).add(3))
}

// uv shift a projection's offset terms cause (the TRAA jitter)
const jitterUV = (matrix, perspective, target) => {
  const pe = matrix.elements
  return perspective ? target.set(-0.5 * pe[8], 0.5 * pe[9]) : target.set(0.5 * pe[12], -0.5 * pe[13])
}

export class SSRNode extends Node {
  static get type() {
    return 'SSRNode'
  }

  // the SETTINGS and SWITCHES properties
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
    for (const name of SWITCHES) {
      Object.defineProperty(this.prototype, name, {
        configurable: true,
        get() {
          return this.#u[name].value === 1
        },
        set(v) {
          this.#u[name].value = v ? 1 : 0
        },
      })
    }
  }

  isSSRNode = true

  #label = 'SSR'
  #camera
  #perspective
  #resolutionScale = 1
  #pyramidLevels = 5
  #batch = 4
  #inert = false
  #ready = false // the inputs resolve once every option is in
  #inputs = { velocityNode: undefined, normalsNode: undefined, linearDepthNode: undefined, specularNode: undefined }
  #velocityNode = null
  #normalsNode = null
  #linearDepthNode = null
  #specularNode = null
  #u = {}
  #coreCamera
  #gBuffer
  #updateNode
  #pyramid = null
  #retiredPyramids = [] // released once a reader rebuilds
  #inlineRead = false // the node, resolve() or a composite was handed out, so a shader may read the pyramid inline
  #releasable = 0 // retired pyramids the radiance pass no longer samples

  // per frame
  #projU = uniform(new Vector4(1, 1, 0, 0))
  #nearU = uniform(0.1)
  #farU = uniform(1000)
  #resU = uniform(new Vector2(1, 1))
  #traceResU = uniform(new Vector2(1, 1))
  #viewToPrevViewU = uniform(new Matrix4())
  #viewToPrevClipU = uniform(new Matrix4())
  #prevCameraInViewU = uniform(new Vector3())
  #cameraMovedU = uniform(1)
  #jitterDeltaUVU = uniform(new Vector2())
  #frameU = uniform(0)
  #historyValidU = uniform(0)
  #cameraWorldU = uniform(new Matrix4())
  #prevMatrixWorldInverse = new Matrix4()
  #prevProjection = new Matrix4()
  #prevCameraWorldPosition = new Vector3()
  #jitterPrev = new Vector2()
  #jitterCurr = new Vector2()

  // targets and history
  #traceTargets
  #traceMaterial = new NodeMaterial()
  #traceBuilt = false
  #recordPrevNode
  #recordCurrNode
  #radianceTarget = null
  #radianceMaterial = null
  #radianceNode = null
  #parity = 0
  #lastFrameId = -1
  #historyValid = false
  #frameIndex = 0
  #width = 0
  #height = 0
  #rendererState = {}
  #formatsChecked = false
  #sharedContext = null
  #traceName
  #radianceName

  // compileAsync: what was compiled or drawn, so a compile skips it
  #compiling = null
  #compiledTrace = null // the trace material's colorNode
  #compiledRadiance = null // the radiance material's fragmentNode
  #compiledPyramid = null
  #disposed = false

  #outputNode = null

  /**
   * @param {TextureNode} colorNode - Scene radiance at the G-buffer's resolution (HDR: the jittered scene pass output).
   * @param {PassNode} gBufferPass - The pass whose MRT spreads ssrGBuffer() (and 'velocity'); samples 0.
   * @param {object} [options] - `label`, the input nodes, `resolutionScale`, `batch`, `pyramidLevels`, `maxDistance`,
   *   the numeric settings and the switches.
   */
  constructor(colorNode, gBufferPass, options = {}) {
    super('vec4')
    this.updateBeforeType = NodeUpdateType.FRAME
    this.colorNode = colorNode
    this.gBufferPass = gBufferPass
    this.#camera = gBufferPass.camera
    this.#perspective = this.#camera.isOrthographicCamera !== true
    if (this.#camera.isPerspectiveCamera !== true && this.#camera.isOrthographicCamera !== true) {
      console.warn('SSRNode: the camera is neither perspective nor orthographic; tracing it as perspective.')
    }

    for (const [name, [value, , , integer]] of Object.entries(SETTINGS)) {
      this.#u[name] = integer ? uniform(value, 'int') : uniform(value)
    }
    for (const name of SWITCHES) this.#u[name] = uniform(1)
    this.#u.maxDistance = uniform(INFINITE_DISTANCE)

    this.#coreCamera = { perspective: this.#perspective, projection: this.#projU, near: this.#nearU, far: this.#farU }
    this.#gBuffer = { depthNode: null, normalsNode: null, resolution: this.#resU }
    this.#updateNode = new SSRUpdateNode(this)

    this.#traceTargets = [this.#traceTarget(), this.#traceTarget()]
    this.#recordPrevNode = nodeObject(new RawTextureNode(this.#traceTargets[1].texture))
    this.#recordCurrNode = nodeObject(new RawTextureNode(this.#traceTargets[0].texture))
    this.label = this.#label

    for (const [key, value] of Object.entries(options)) {
      if (!OPTIONS.includes(key)) console.warn(`SSRNode: unknown option "${key}". Options: ${OPTIONS.join(', ')}.`)
      else if (value !== undefined) this[key] = value
    }
    this.#ready = true
    this.#syncInputs()
  }

  // ── Inputs and structure ────────────────────────────────────────────

  /** The G-buffer pass's camera. */
  get camera() {
    return this.#camera
  }

  /** Prefix of every material, target and quad name. */
  get label() {
    return this.#label
  }
  set label(v) {
    const label = String(v)
    this.#label = label
    this.#traceName = `${label}.Trace`
    this.#radianceName = `${label}.Radiance`
    this.#traceMaterial.name = this.#traceName
    for (const target of this.#traceTargets) target.texture.name = `${label}.Record`
    if (this.#radianceTarget !== null) {
      this.#radianceTarget.texture.name = this.#radianceName
      this.#radianceMaterial.name = this.#radianceName
    }
  }

  /** Screen velocity (NDC delta, RG16F); null: the camera alone; undefined: the pass's 'velocity' if it has one. */
  get velocityNode() {
    return this.#velocityNode
  }
  set velocityNode(v) {
    this.#setInput('velocityNode', v)
  }

  /** The flat and shading normals; undefined: the pass's 'ssrNormals'. null while the node is inert. */
  get normalsNode() {
    return this.#normalsNode
  }
  set normalsNode(v) {
    this.#setInput('normalsNode', v)
  }

  /** The linear view depth; undefined: the pass's 'ssrDepth'. null while the node is inert. */
  get linearDepthNode() {
    return this.#linearDepthNode
  }
  set linearDepthNode(v) {
    this.#setInput('linearDepthNode', v)
  }

  /** `sqrt(F_env · T_fog)` and roughness; undefined: the pass's 'ssrSpecular'. null while the node is inert. */
  get specularNode() {
    return this.#specularNode
  }
  set specularNode(v) {
    this.#setInput('specularNode', v)
  }

  /** 1, or 0.5: the trace's resolution relative to the G-buffer. */
  get resolutionScale() {
    return this.#resolutionScale
  }
  set resolutionScale(v) {
    if (!RESOLUTION_SCALES.includes(v)) {
      console.warn(`SSRNode: resolutionScale ${v}: 1 or 0.5.`)
      return
    }
    if (v === this.#resolutionScale) return
    this.#resolutionScale = v
    // the next frame resizes the trace targets
    this.#width = 0
    this.#height = 0
    this.#rebuild()
  }

  /** Colour pyramid levels for glossy lookups, 0–8 (0: mirror only). */
  get pyramidLevels() {
    return this.#pyramidLevels
  }
  set pyramidLevels(v) {
    if (!Number.isInteger(v) || v < 0 || v > 8) {
      console.warn(`SSRNode: pyramidLevels ${v}: an integer in 0–8.`)
      return
    }
    if (v === this.#pyramidLevels) return
    this.#pyramidLevels = v
    if (this.#ready) this.#syncPyramid()
  }

  /** Whether the G-buffer inputs are missing: the output is then vec4(0) and nothing runs. */
  get inert() {
    return this.#inert
  }

  #setInput(name, v) {
    // a G-buffer input has no null: it takes the pass's texture
    if (v === null && name !== 'velocityNode') v = undefined
    if (v === this.#inputs[name] || (this.#inputs[name] === undefined && v === this[name])) return
    this.#inputs[name] = v
    if (this.#ready) this.#syncInputs()
  }

  // Each input is its supplied node, else the pass's texture; a missing G-buffer texture makes the node inert.
  #syncInputs() {
    const pass = this.gBufferPass
    const inputs = this.#inputs
    // check the MRT before touching the pass: getTexture would add an attachment
    const mrtNode = pass.getMRT?.() ?? null
    const missing = Object.entries(GBUFFER_INPUTS)
      .filter(([name, input]) => inputs[input] === undefined && mrtNode?.has(name) !== true)
      .map(([name]) => name)
    this.#inert = missing.length > 0
    if (this.#inert) {
      console.error(
        `SSRNode: the G-buffer pass's MRT has no ${missing.join(', ')}: spread ssrGBuffer() into its mrt(). The node is inert.`,
      )
    } else {
      if (inputs.normalsNode === undefined) pass.getTexture('ssrNormals')
      if (inputs.linearDepthNode === undefined) {
        const t = pass.getTexture('ssrDepth')
        t.type = HalfFloatType
        t.format = RedFormat
      }
      if (inputs.specularNode === undefined) {
        const t = pass.getTexture('ssrSpecular')
        t.type = UnsignedByteType
        t.format = RGBAFormat
      }
    }
    const fromPass = (name) => {
      const node = inputs[GBUFFER_INPUTS[name]]
      return node !== undefined ? node : this.#inert ? null : pass.getTextureNode(name)
    }
    this.#normalsNode = fromPass('ssrNormals')
    this.#linearDepthNode = fromPass('ssrDepth')
    this.#specularNode = fromPass('ssrSpecular')
    let velocityNode = inputs.velocityNode
    if (velocityNode === undefined) {
      velocityNode = !this.#inert && mrtNode?.has('velocity') === true ? pass.getTextureNode('velocity') : null
      if (velocityNode !== null && pass.getTexture('velocity').format === RGBAFormat) {
        console.warn(
          "SSRNode: the pass's velocity is RGBA: 34 B per sample, over the default limit of 32. Set it to RG16F (type HalfFloatType, format RGFormat).",
        )
      }
    }
    this.#velocityNode = velocityNode
    this.#gBuffer.depthNode = this.#linearDepthNode
    this.#gBuffer.normalsNode = this.#normalsNode
    this.#formatsChecked = false
    this.#rebuild()
    this.#syncPyramid()
  }

  // The shared colour pyramid at the current levels; the one it replaces is released once a reader rebuilds.
  #syncPyramid() {
    const levels = this.#inert ? 0 : this.#pyramidLevels
    if ((this.#pyramid?.levels ?? 0) === levels) return
    if (this.#pyramid !== null) this.#retiredPyramids.push(this.#pyramid)
    this.#pyramid = levels > 0 ? colorPyramid(this.colorNode, { levels }) : null
    this.#buildRadiance()
  }

  // The trace and the texture output rebuild on the next frame, from a cold history.
  #rebuild() {
    this.#traceBuilt = false
    this.#historyValid = false
    this.#buildRadiance()
  }

  // A new fragment node changes the material's cache key: needsUpdate alone keeps the compiled shader.
  #buildRadiance() {
    if (this.#radianceMaterial === null) return
    this.#radianceMaterial.fragmentNode = Fn(() =>
      this.#inert ? vec4(0) : this.#resolveAt(texelOf(this.#gBuffer, screenUV)),
    )()
    this.#radianceMaterial.needsUpdate = true
  }

  // ── Settings ────────────────────────────────────────────────────────

  /** Probe loads per round trip: 1, 2 or 4. Rebuilds the trace and resets the history. */
  get batch() {
    return this.#batch
  }
  set batch(v) {
    if (!BATCHES.includes(v)) {
      console.warn(`SSRNode: batch ${v}: 1, 2 or 4.`)
      return
    }
    if (v === this.#batch) return
    this.#batch = v
    this.#traceBuilt = false
  }

  /** View-space ray length, m; Infinity: to the screen's edge (the 80–100 % fade applies only when finite). */
  get maxDistance() {
    return this.#u.maxDistance
  }
  set maxDistance(v) {
    if (!(v > 0)) {
      console.warn(`SSRNode: maxDistance ${v}: a positive number or Infinity.`)
      return
    }
    this.#u.maxDistance.value = Number.isFinite(v) ? v : INFINITE_DISTANCE
  }

  #set(name, v) {
    const [, lo, hi, integer] = SETTINGS[name]
    let value = Number(v)
    if (!Number.isFinite(value)) {
      const range = Number.isFinite(lo) || Number.isFinite(hi) ? ` in ${lo}–${hi}` : ''
      console.warn(`SSRNode: ${name} ${v}: a finite number${range}.`)
      return
    }
    if (integer) value = Math.round(value)
    if (value < lo || value > hi) {
      console.warn(`SSRNode: ${name} ${v} is outside ${lo}–${hi}; clamped.`)
      value = Math.min(hi, Math.max(lo, value))
    }
    this.#u[name].value = value
  }

  // ── Outputs ─────────────────────────────────────────────────────────

  /**
   * `(L_ssr, c)` at G-buffer pixel `p` (an integer-valued vec2): the reflected radiance and its confidence. `spec`,
   * `depth` and `normals` are the pixel's G-buffer values when the caller has loaded them already.
   */
  resolve(p, { spec = null, depth = null, normals = null, ...rest } = {}) {
    warnUnknown('SSRNode.resolve', rest, ['spec', 'depth', 'normals'])
    return this.#withUpdate(Fn(() => (this.#inert ? vec4(0) : this.#resolveAt(p, { spec, depth, normals })))())
  }

  /** A full-resolution `(L_ssr, c)` texture for consumers that sample at any uv; rendered once requested. */
  getTextureNode() {
    if (this.#radianceNode === null) {
      this.#radianceTarget = new RenderTarget(1, 1, { depthBuffer: false, type: HalfFloatType })
      this.#radianceTarget.texture.name = this.#radianceName
      this.#radianceMaterial = new NodeMaterial()
      this.#radianceMaterial.name = this.#radianceName
      this.#buildRadiance()
      this.#radianceNode = new SSRTextureNode(this.#updateNode, this.#radianceTarget.texture)
      if (this.#width > 0) this.#radianceTarget.setSize(this.#width, this.#height)
    }
    return this.#radianceNode
  }

  /** `vec4(F·L_env, 1)` at the fragment: the environment specular the scene's materials add (see ssrComposite). */
  getEnvironmentSpecularNode(environment, { environmentIntensity = 1, environmentRotation = null, ...rest } = {}) {
    warnUnknown('SSRNode.getEnvironmentSpecularNode', rest, ENVIRONMENT_OPTIONS)
    const env = this.#environment(environment, environmentIntensity, environmentRotation)
    const value = Fn(() => {
      if (this.#inert) return vec4(0, 0, 0, 1)
      const p = texelOf(this.#gBuffer, screenUV)
      const spec = this.specularNode.load(ivec2(p))
      const d = this.linearDepthNode.load(ivec2(p)).r
      const out = vec4(0, 0, 0, 1).toVar()
      If(d.greaterThan(0), () => {
        const e = this.normalsNode.load(ivec2(p))
        out.rgb.assign(spec.rgb.mul(spec.rgb).mul(env(p, spec, d, e)))
      })
      return out
    })()
    return this.#withUpdate(value)
  }

  /** The composite of ssrComposite(). */
  getCompositeNode(
    colorNode,
    environment,
    { environmentIntensity = 1, environmentRotation = null, mode = 'subtract', ...rest } = {},
  ) {
    warnUnknown('SSRNode.getCompositeNode', rest, COMPOSITE_OPTIONS)
    if (!['subtract', 'add'].includes(mode)) {
      console.warn(`SSRNode: composite mode "${mode}": 'subtract' or 'add'.`)
      mode = 'subtract'
    }
    const env = this.#environment(environment, environmentIntensity, environmentRotation)
    const value = Fn(() => {
      if (this.#inert) return texture(colorNode, screenUV, float(0))
      const p = texelOf(this.#gBuffer, screenUV).toVar()
      const spec = this.specularNode.load(ivec2(p)).toVar()
      const d = this.linearDepthNode.load(ivec2(p)).r.toVar()
      const colour = texture(colorNode, screenUV, float(0)).toVar()
      const out = colour.toVar()
      const F = spec.rgb.mul(spec.rgb).toVar()
      const traced = mode === 'add' ? d.greaterThan(0).and(max3(F).greaterThan(0)) : this.#reflective(spec, d)
      If(traced, () => {
        const e = this.normalsNode.load(ivec2(p)).toVar()
        const reflection = this.#resolveAt(p, { spec, depth: d, normals: e })
        const c = reflection.a
        If(mode === 'add' ? bool(true) : c.greaterThan(0), () => {
          const Lenv = env(p, spec, d, e).toVar()
          if (mode === 'subtract') out.rgb.assign(max(colour.rgb.add(F.mul(c).mul(reflection.rgb.sub(Lenv))), 0))
          else out.rgb.assign(colour.rgb.add(F.mul(mix(Lenv, reflection.rgb, c))))
        })
      })
      return out
    })()
    return this.#withUpdate(value)
  }

  // ── Frame ───────────────────────────────────────────────────────────

  /** Sizes the trace for a G-buffer of `width` × `height`; a change drops the history. */
  setSize(width, height) {
    if (width === this.#width && height === this.#height) return
    this.#width = width
    this.#height = height
    const s = this.#resolutionScale
    const w = Math.max(1, Math.ceil(width * s))
    const h = Math.max(1, Math.ceil(height * s))
    for (const target of this.#traceTargets) target.setSize(w, h)
    this.#radianceTarget?.setSize(width, height)
    this.#resU.value.set(width, height)
    this.#traceResU.value.set(w, h)
    this.#historyValid = false
  }

  /**
   * Drops the history: the next frame traces every pixel cold. Call it when the node rejoins the graph after frames
   * that rendered the G-buffer without it, or after a camera cut. Frames that render nothing keep the history.
   */
  resetHistory() {
    this.#historyValid = false
  }

  /**
   * Compiles the node's passes ahead of their first frame. Await it before rendering: each pass's target stays bound
   * while it compiles. Optional.
   */
  async compileAsync(renderer) {
    if (this.#disposed || this.#inert) return
    if (renderer.initialized !== true) await renderer.init()
    // one at a time: each compiles what the one before left out
    while (this.#compiling !== null) await this.#compiling
    if (this.#disposed || this.#inert) return
    // what the first frame builds before it draws, so that frame keeps what this compiles
    if (!this.#traceBuilt) this.#buildTrace()
    this.#syncSize(renderer)
    const trace = this.#traceMaterial.colorNode
    const radiance = this.#radianceMaterial?.fragmentNode ?? null
    const pyramid = this.glossy ? this.#pyramid : null
    const jobs = []
    if (trace !== this.#compiledTrace) {
      const target = this.#traceTargets[this.#parity]
      jobs.push(compileQuad(renderer, _quadMesh, this.#traceMaterial, target).then(() => (this.#compiledTrace = trace)))
    }
    if (radiance !== null && radiance !== this.#compiledRadiance) {
      const compiled = compileQuad(renderer, _quadMesh, this.#radianceMaterial, this.#radianceTarget)
      jobs.push(compiled.then(() => (this.#compiledRadiance = radiance)))
    }
    if (pyramid !== null && pyramid !== this.#compiledPyramid) {
      jobs.push(pyramid.compileAsync(renderer).then(() => (this.#compiledPyramid = pyramid)))
    }
    if (jobs.length === 0) return
    const run = Promise.allSettled(jobs)
    this.#compiling = run
    let results
    try {
      results = await run
    } finally {
      this.#compiling = null
    }
    const failed = results.find((result) => result.status === 'rejected')
    if (failed) throw failed.reason
    // an option changed meanwhile: compile the rebuilt passes too
    await this.compileAsync(renderer)
  }

  /** Called by the update nodes of every reader: registers the inputs, so the G-buffer pass renders first. */
  registerInputs(builder, node = this) {
    // a reader rebuilds: the pyramids replaced before are no longer read
    for (const pyramid of this.#retiredPyramids) pyramid.release()
    this.#retiredPyramids.length = 0
    const p = builder.getNodeProperties(node)
    p.colorNode = this.colorNode
    if (this.#inert) return
    p.normalsNode = this.normalsNode
    p.depthNode = this.linearDepthNode
    p.specularNode = this.specularNode
    if (this.velocityNode) p.velocityNode = this.velocityNode
    this.#sharedContext ??= builder.getSharedContext()
  }

  updateBefore(frame) {
    if (this.#inert || this.#disposed || frame.frameId === this.#lastFrameId) return
    // drawing a pass being compiled would compile it synchronously; the history doesn't outlast the gap
    if (this.#compiling !== null) {
      this.#historyValid = false
      return
    }
    const { renderer } = frame
    const camera = this.#camera
    if (camera.matrixWorldAutoUpdate === true) camera.updateWorldMatrix(true, false)

    if (!this.#formatsChecked) this.#checkInputs(renderer)
    if (!this.#traceBuilt) this.#buildTrace()
    // a frame after the radiance pass dropped them, once that frame's commands are submitted
    for (const pyramid of this.#retiredPyramids.splice(0, this.#releasable)) pyramid.release()
    this.#releasable = 0
    this.#syncSize(renderer)

    const pe = camera.projectionMatrix.elements
    if (this.#perspective) this.#projU.value.set(pe[0], pe[5], pe[8], pe[9])
    else this.#projU.value.set(pe[0], pe[5], pe[12], pe[13])
    this.#nearU.value = camera.near
    this.#farU.value = camera.far
    this.#viewToPrevViewU.value.multiplyMatrices(this.#prevMatrixWorldInverse, camera.matrixWorld)
    this.#viewToPrevClipU.value.multiplyMatrices(this.#prevProjection, this.#viewToPrevViewU.value)
    this.#prevCameraInViewU.value.copy(this.#prevCameraWorldPosition).applyMatrix4(camera.matrixWorldInverse)
    const still =
      camera.matrixWorldInverse.equals(this.#prevMatrixWorldInverse) &&
      camera.projectionMatrix.equals(this.#prevProjection)
    this.#cameraMovedU.value = still ? 0 : 1
    jitterUV(this.#prevProjection, this.#perspective, this.#jitterPrev)
    jitterUV(camera.projectionMatrix, this.#perspective, this.#jitterCurr)
    this.#jitterDeltaUVU.value.subVectors(this.#jitterPrev, this.#jitterCurr)
    this.#frameU.value = this.#frameIndex++ % 4096
    this.#historyValidU.value = this.#historyValid ? 1 : 0
    this.#cameraWorldU.value.copy(camera.matrixWorld)

    const target = this.#traceTargets[this.#parity]
    this.#recordPrevNode.value = this.#traceTargets[this.#parity ^ 1].texture
    this.#recordCurrNode.value = target.texture

    // a pass drawn has its pipeline: compileAsync skips it
    this.#rendererState = RendererUtils.resetRendererState(renderer, this.#rendererState)
    if (this.#pyramid !== null && this.glossy) {
      this.#pyramid.update(renderer, frame, { stateSaved: true })
      this.#compiledPyramid = this.#pyramid
    }
    _quadMesh.material = this.#traceMaterial
    _quadMesh.name = this.#traceName
    renderer.setRenderTarget(target)
    _quadMesh.render(renderer)
    this.#compiledTrace = this.#traceMaterial.colorNode
    if (this.#radianceTarget !== null) {
      _quadMesh.material = this.#radianceMaterial
      _quadMesh.name = this.#radianceName
      renderer.setRenderTarget(this.#radianceTarget)
      _quadMesh.render(renderer)
      this.#compiledRadiance = this.#radianceMaterial.fragmentNode
      // read through getTextureNode() alone, the radiance pass has stopped sampling the replaced pyramids
      if (!this.#inlineRead) this.#releasable = this.#retiredPyramids.length
    }
    RendererUtils.restoreRendererState(renderer, this.#rendererState)

    this.#prevMatrixWorldInverse.copy(camera.matrixWorldInverse)
    this.#prevProjection.copy(camera.projectionMatrix)
    this.#prevCameraWorldPosition.setFromMatrixPosition(camera.matrixWorld)
    this.#parity ^= 1
    this.#lastFrameId = frame.frameId
    this.#historyValid = true
  }

  setup(builder) {
    this.#inlineRead = true
    this.registerInputs(builder)
    if (this.#inert) return vec4(0)
    this.#outputNode ??= Fn(() => this.#resolveAt(texelOf(this.#gBuffer, screenUV)))()
    return this.#outputNode
  }

  /** Releases every target and material, and this node's share of the colour pyramid. No copy/clone: the node owns
   * GPU history. */
  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    super.dispose()
    const free = () => {
      for (const target of this.#traceTargets) target.dispose()
      this.#traceMaterial.dispose()
      this.#radianceTarget?.dispose()
      this.#radianceMaterial?.dispose()
      for (const pyramid of this.#retiredPyramids) pyramid.release()
      this.#retiredPyramids.length = 0
      this.#pyramid?.release()
      this.#pyramid = null
    }
    // a compile in flight still allocates the targets and builds the materials
    if (this.#compiling !== null) this.#compiling.then(free)
    else free()
  }

  // ── Internals ───────────────────────────────────────────────────────

  // Sized from the G-buffer, else, before its pass first renders, from the size that pass will have.
  #syncSize(renderer) {
    const image = this.linearDepthNode.value?.image
    if (image?.width > 1 || image?.height > 1) this.setSize(image.width, image.height)
    else {
      renderer.getDrawingBufferSize(_size)
      const scale = this.gBufferPass.getResolutionScale?.() ?? 1
      this.setSize(Math.max(1, Math.floor(_size.x * scale)), Math.max(1, Math.floor(_size.y * scale)))
    }
  }

  #withUpdate(value) {
    this.#inlineRead = true
    return nodeObject(new SSRValueNode(this.#updateNode, value))
  }

  // the hit record (s, d0)
  #traceTarget() {
    const target = new RenderTarget(1, 1, { depthBuffer: false, type: FloatType, generateMipmaps: false })
    const record = target.texture
    record.name = `${this.#label}.Record`
    record.format = RGFormat
    record.minFilter = NearestFilter
    record.magFilter = NearestFilter
    return target
  }

  #checkInputs(renderer) {
    this.#formatsChecked = true
    const target = this.gBufferPass.renderTarget
    if (target?.samples > 1) {
      console.warn('SSRNode: the G-buffer pass is multisampled; it needs samples: 0 (resolve with TRAA).')
    }
    // texture flags set after a texture was allocated don't apply
    const expected = { ssrDepth: 'r16float', ssrSpecular: 'rgba8unorm' }
    for (const [name, format] of Object.entries(expected)) {
      // a supplied node replaces the pass's texture, which may not exist
      if (this.#inputs[GBUFFER_INPUTS[name]] !== undefined) continue
      const gpu = renderer.backend.get?.(this.gBufferPass.getTexture(name))?.texture
      if (gpu?.format !== undefined && gpu.format !== format) {
        console.warn(
          `SSRNode: '${name}' is ${gpu.format}, not ${format}: the pass rendered before the node set its format. Create the node, or switch to the pass's texture, before the pass first renders.`,
        )
      }
    }
  }

  #buildTrace() {
    this.#traceBuilt = true
    this.#historyValid = false
    const material = this.#traceMaterial
    const recordOut = property('vec4')
    if (this.#sharedContext !== null) material.contextNode = context(this.#sharedContext)
    material.colorNode = Fn(() => {
      this.#trace(recordOut)
      return vec4(0)
    })()
    material.outputNode = recordOut
    material.needsUpdate = true
  }

  #settings() {
    const u = this.#u
    return {
      probes: u.probes,
      guardProbes: u.guardProbes,
      iterations: u.iterations,
      thickness: u.thickness,
      hitTolerance: u.hitTolerance,
      minDistancePx: u.minDistance,
      crossingEpsilon: u.crossingEpsilon,
      minDenominator: u.minDenominator,
      convergePx: u.convergePx,
      trustRegion: u.trustRegion,
    }
  }

  #reflective(spec, depth) {
    const F = spec.rgb.mul(spec.rgb)
    return depth
      .greaterThan(0)
      .and(max3(F).greaterThan(this.#u.fresnelThreshold))
      .and(spec.a.lessThan(this.#u.roughnessCutoff))
  }

  #ray(uv, depth, normals) {
    const u = this.#u
    return reflectionRay(this.#coreCamera, this.#gBuffer, {
      uv,
      depth,
      normals,
      horizon: u.horizon,
      originOffset: u.originOffset,
    })
  }

  // The trace: writes the record (s, d0).
  #trace(recordOut) {
    const u = this.#u
    const camera = this.#coreCamera
    const gBuffer = this.#gBuffer
    const scale = this.#resolutionScale === 1 ? 1 : 2
    const q = floor(screenCoordinate.xy).toVar()
    const p0 = q.mul(scale).toVar()
    const uv0 = texelCentre(gBuffer, p0).toVar()
    const record = vec4(0).toVar()
    // round trip 1, every pixel: 6 B
    const spec = this.specularNode.load(ivec2(p0)).toVar()
    const d0 = this.linearDepthNode.load(ivec2(p0)).r.toVar()
    If(this.#reflective(spec, d0), () => {
      // round trip 2, traced pixels only
      const e = this.normalsNode.load(ivec2(p0)).toVar()
      const vel = this.velocityNode ? this.velocityNode.load(ivec2(p0)).xy.toVar() : null
      const ray = this.#ray(uv0, d0, e)
      const seg = clipScreenRay({
        origin: ray.origin,
        direction: ray.direction,
        camera,
        gBuffer,
        maxDistance: u.maxDistance,
        minDistancePx: u.minDistance,
        originDepth: d0,
      })
      record.y.assign(d0)
      If(seg.valid, () => {
        const seed = this.#seed({ uv0, ray, seg, vel })
        // the probes' offset: per pixel, and per frame while jittering
        const xi = fract(interleavedGradientNoise(q.add(this.#frameU.mul(5.588238).mul(u.jitter))))
        const result = traceNewton({
          segment: seg,
          origin: ray.origin,
          direction: ray.direction,
          originUV: uv0,
          seed,
          gBuffer,
          camera,
          settings: this.#settings(),
          batch: this.#batch,
          xi,
        })
        record.x.assign(result.sOut)
      })
    })
    recordOut.assign(record)
  }

  // The seed: the pixel's own previous record, else the smallest valid neighbour's, reprojected; with a depth test.
  #seed({ uv0, ray, seg, vel }) {
    const u = this.#u
    const valid = bool(false).toVar()
    const s = float(0).toVar()
    const kind = int(SEED.NONE).toVar()
    If(u.temporalSeeding.greaterThan(0.5).and(this.#historyValidU.greaterThan(0.5)), () => {
      let uvPrev
      if (vel) {
        uvPrev = uv0
          .sub(vel.mul(vec2(0.5, -0.5)))
          .add(this.#jitterDeltaUVU)
          .toVar()
      } else {
        const clip = this.#viewToPrevClipU.mul(vec4(ray.position, 1)).toVar()
        uvPrev = clip.xy.div(clip.w).mul(vec2(0.5, -0.5)).add(0.5).toVar()
      }
      const inside = uvPrev.x
        .greaterThanEqual(0)
        .and(uvPrev.x.lessThanEqual(1))
        .and(uvPrev.y.greaterThanEqual(0))
        .and(uvPrev.y.lessThanEqual(1))
      If(inside, () => {
        const tr = this.#traceResU
        // the record whose ray starts nearest uvPrev: at 0.5, record q traces full-resolution texel 2q
        const qp = (
          this.#resolutionScale === 1
            ? clamp(floor(uvPrev.mul(tr)), vec2(0), tr.sub(1))
            : clamp(floor(uvPrev.mul(this.#resU).sub(0.5).mul(0.5).add(0.5)), vec2(0), tr.sub(1))
        ).toVar()
        const r0 = this.#recordPrevNode.load(ivec2(qp)).xy.toVar()
        const dExp = this.#viewToPrevViewU.mul(vec4(ray.position, 1)).z.negate().toVar()
        const Vp = this.#perspective ? normalize(ray.position.sub(this.#prevCameraInViewU)) : ray.view
        // last frame's ray, lifted as this frame's is, projected on this frame's; exactly 1 for a still camera, so a
        // converged record seeds itself
        const proj = select(
          this.#cameraMovedU.greaterThan(0.5),
          dot(liftAboveHorizon(reflect(Vp, ray.normal), ray.flatNormal, u.horizon), ray.direction),
          float(1),
        ).toVar()
        const same = (r) => r.y.greaterThan(0).and(abs(r.y.sub(dExp)).lessThanEqual(u.disocclusionThreshold.mul(dExp)))
        const inRange = (x) => x.greaterThan(seg.sLo).and(x.lessThan(seg.sHi))
        const sOwn = abs(r0.x).mul(proj).toVar()
        const ownOK = same(r0).and(inRange(sOwn))
        // own converged, else the nearest converged neighbour, else own unconverged (one retry)
        If(ownOK.and(r0.x.greaterThan(0)), () => {
          valid.assign(true)
          s.assign(sOwn)
          kind.assign(SEED.OWN)
        }).ElseIf(u.neighbourSeeding.greaterThan(0.5), () => {
          // the 4 loads in one round trip, only where the own record fails
          const neighbours = [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ].map(([dx, dy]) =>
            this.#recordPrevNode.load(ivec2(clamp(qp.add(vec2(dx, dy)), vec2(0), tr.sub(1)))).xy.toVar(),
          )
          const best = float(INFINITE_DISTANCE).toVar()
          for (const r of neighbours) {
            const sk = r.x.mul(proj)
            If(same(r).and(r.x.greaterThan(0)).and(inRange(sk)).and(sk.lessThan(best)), () => {
              best.assign(sk)
            })
          }
          If(best.lessThan(INFINITE_DISTANCE), () => {
            valid.assign(true)
            s.assign(best)
            kind.assign(SEED.NEIGHBOUR)
          })
        })
        If(valid.not().and(ownOK).and(r0.x.lessThan(0)), () => {
          valid.assign(true)
          s.assign(sOwn)
          kind.assign(SEED.UNCONVERGED)
        })
      })
    })
    return { valid, s, kind, hold: this.#cameraMovedU.lessThan(0.5) }
  }

  // (L, c) at G-buffer pixel p: the hit's colour and confidence.
  #resolveAt(p, { spec = null, depth = null, normals = null } = {}) {
    const u = this.#u
    const camera = this.#coreCamera
    const gBuffer = this.#gBuffer
    const res = this.#resU
    const pixel = p.toVar()
    const sp = (spec ?? this.specularNode.load(ivec2(pixel))).toVar()
    const d0 = (depth ?? this.linearDepthNode.load(ivec2(pixel)).r).toVar()
    const out = vec4(0).toVar()
    If(this.#reflective(sp, d0), () => {
      const e = (normals ?? this.normalsNode.load(ivec2(pixel))).toVar()
      const uv0 = texelCentre(gBuffer, pixel)
      const ray = this.#ray(uv0, d0, e)
      const O = ray.origin
      const R = ray.direction
      const s = float(0).toVar()
      const hit = bool(false).toVar()
      const coverage = float(1).toVar()
      if (this.#resolutionScale === 1) {
        s.assign(this.#recordCurrNode.load(ivec2(pixel)).x)
        hit.assign(s.greaterThan(0))
      } else {
        this.#upsample({ pixel, d0, ray, s, hit, coverage })
      }
      const uvF = uvFromView(camera, O.add(R.mul(s))).toVar()
      const fx = vec2(res.y.div(res.x), 1).mul(u.edgeFade)
      const edge2 = ramp(vec2(0), fx, uvF).mul(float(1).sub(ramp(vec2(1).sub(fx), vec2(1), uvF)))
      const cam = float(1).sub(ramp(u.cameraFadeStart, u.cameraFadeEnd, R.z))
      const md = u.maxDistance
      const dist = select(md.lessThan(1e29), float(1).sub(ramp(md.mul(0.8), md, s)), float(1))
      const rf = float(1).sub(ramp(u.roughnessFadeStart, u.roughnessCutoff, sp.a))
      const c = select(hit, coverage.mul(edge2.x).mul(edge2.y).mul(cam).mul(dist).mul(rf), float(0)).toVar()
      If(c.greaterThan(0), () => {
        out.assign(vec4(this.#fetchColour(uvF, s, sp.a, O, R), c))
      })
    })
    return out
  }

  // resolutionScale 0.5: the 4 trace records around a full-resolution pixel, reused along its own ray, polished.
  #upsample({ pixel, d0, ray, s, hit, coverage }) {
    const u = this.#u
    const camera = this.#coreCamera
    const gBuffer = this.#gBuffer
    const tr = this.#traceResU
    const O = ray.origin
    const R = ray.direction
    const i0 = clamp(floor(pixel.mul(0.5)), vec2(0), tr.sub(1)).toVar()
    const i1 = min(i0.add(1), tr.sub(1)).toVar()
    const wb = clamp(pixel.sub(i0.mul(2)).mul(0.5), 0, 1).toVar()
    const ids = [vec2(i0.x, i0.y), vec2(i1.x, i0.y), vec2(i0.x, i1.y), vec2(i1.x, i1.y)]
    const bw = [
      float(1).sub(wb.x).mul(float(1).sub(wb.y)),
      wb.x.mul(float(1).sub(wb.y)),
      float(1).sub(wb.x).mul(wb.y),
      wb.x.mul(wb.y),
    ]
    const records = ids.map((id) => this.#recordCurrNode.load(ivec2(id)).xy.toVar())
    const sumW = float(0).toVar()
    const sumWt = float(0).toVar()
    const sumWS = float(0).toVar()
    const sumBHit = float(0).toVar()
    const maxS = float(0).toVar()
    const minS = float(INFINITE_DISTANCE).toVar()
    const bestW = float(-1).toVar()
    const bestWS = float(0).toVar()
    const bestB = float(-1).toVar()
    const bestBS = float(0).toVar()
    for (let k = 0; k < 4; k++) {
      const r = records[k]
      const Pk = viewFromUV(camera, texelCentre(gBuffer, ids[k].mul(2)), r.y)
      const near = r.y
        .greaterThan(0)
        .and(abs(dot(ray.flatNormal, Pk.sub(ray.position))).lessThanEqual(u.upsampleTolerance.mul(d0)))
      const isHit = r.x.greaterThan(0)
      const wt = select(near, bw[k], float(0))
      const w = select(isHit, wt, float(0)).toVar()
      sumW.addAssign(w)
      sumWt.addAssign(wt)
      sumWS.addAssign(w.mul(r.x))
      sumBHit.addAssign(select(isHit, bw[k], float(0)))
      If(w.greaterThan(0), () => {
        maxS.assign(max(maxS, r.x))
        minS.assign(min(minS, r.x))
      })
      If(w.greaterThan(bestW), () => {
        bestW.assign(w)
        bestWS.assign(r.x)
      })
      If(isHit.and(bw[k].greaterThan(bestB)), () => {
        bestB.assign(bw[k])
        bestBS.assign(r.x)
      })
    }
    If(sumW.greaterThan(1e-6), () => {
      s.assign(select(maxS.lessThan(minS.mul(1.05)), sumWS.div(sumW), bestWS))
    }).ElseIf(bestB.greaterThanEqual(0), () => {
      s.assign(bestBS)
    })
    coverage.assign(select(sumWt.greaterThan(1e-6), sumW.div(max(sumWt, 1e-6)), sumBHit))
    If(s.greaterThan(0), () => {
      // polish on this pixel's own ray: Newton on the facet under the estimate, again while it leaves that texel.
      // Steps are unbounded: on a curved reflector the neighbours' hits lie tens of px apart, and the accept test
      // below rejects a step that lands off the surface.
      const plane = planeVar(planeAt(camera, gBuffer, uvFromView(camera, O.add(R.mul(s)))))
      Loop(UPSAMPLE_POLISH_STEPS_MAX, ({ i }) => {
        If(i.greaterThanEqual(u.upsamplePolishSteps), () => {
          Break()
        })
        const den = dot(plane.Ng, R)
        const sN = dot(plane.Ng, plane.Pc.sub(O)).div(select(abs(den).greaterThan(1e-20), den, 1e-20))
        If(abs(den).greaterThan(u.minDenominator).and(sN.greaterThan(0)), () => {
          s.assign(sN)
        })
        const uvS = uvFromView(camera, O.add(R.mul(s))).toVar()
        If(otherTexel(texelOf(gBuffer, uvS), plane.tx).not(), () => {
          Break()
        })
        assignPlane(plane, planeAt(camera, gBuffer, uvS))
      })
      const result = acceptHit({
        s,
        plane,
        origin: O,
        direction: R,
        originUV: texelCentre(gBuffer, pixel),
        camera,
        gBuffer,
        settings: this.#settings(),
      })
      hit.assign(result.hit)
    })
  }

  // The colour at the hit, at the cone's pyramid level; the colour itself when glossy is off.
  #fetchColour(uvF, s, rough, O, R) {
    const u = this.#u
    const mirror = () => texture(this.colorNode, uvF, float(0)).rgb
    if (this.#pyramid === null) return mirror()
    const colour = vec3(0).toVar()
    If(u.glossy.greaterThan(0.5), () => {
      const lod = coneLOD({
        s,
        tanTheta: coneTangent(rough),
        hitDepth: O.z.add(R.z.mul(s)).negate(),
        pxAngle: pixelAngle(this.#coreCamera, this.#resU),
        perspective: this.#perspective,
        bias: u.lodBias,
        levels: float(this.#pyramid.levels),
      })
      colour.assign(this.#pyramid.sample(uvF, lod))
    }).Else(() => {
      colour.assign(mirror())
    })
    return colour
  }

  // L_env of F·L_env at pixel p, as the scene's materials sample it; 0 without an environment.
  #environment(environment, intensity, rotation) {
    if (!environment) return () => vec3(0)
    const intensityNode = intensity?.isNode
      ? intensity
      : typeof intensity === 'function'
        ? uniform(1).onFrameUpdate(intensity)
        : float(intensity)
    let rotationU = null
    if (rotation) {
      const m = new Matrix4()
      rotationU = uniform(m).onFrameUpdate(() => m.makeRotationFromEuler(rotation).transpose())
    }
    return (p, spec, d, e) => {
      const camera = this.#coreCamera
      const P = viewFromUV(camera, texelCentre(this.#gBuffer, p), d)
      const V = this.#perspective ? normalize(P) : vec3(0, 0, -1)
      const Ns = octDecode(e.zw)
      const rough = spec.a
      const r4 = rough.mul(rough).mul(rough).mul(rough)
      const Rv = normalize(mix(reflect(V, Ns), Ns, r4))
      let Rw = normalize(this.#cameraWorldU.mul(vec4(Rv, 0)).xyz)
      // PMREMNode samples at materialEnvRotation · R, the identity in a quad: rotate here as the scene's materials do
      if (rotationU) Rw = rotationU.mul(vec4(Rw, 0)).xyz
      return pmremTexture(environment, Rw, rough).mul(intensityNode)
    }
  }
}

/** `new SSRNode(colorNode, gBufferPass, options)` as a node. */
export const ssr = (colorNode, gBufferPass, options) =>
  nodeObject(new SSRNode(colorNode, gBufferPass, options))

/**
 * The scene with its environment specular replaced by `mix(L_env, L_ssr, c)` on reflective pixels, at the colour's
 * resolution. 'subtract' (default): `max(colour + c·F·(L_ssr − L_env), 0)` on the stock scene. 'add':
 * `colour + F·mix(L_env, L_ssr, c)` on a scene rendered without environment specular.
 * - `environment`: the PMREM (or equirect) texture the materials use (scene.environment), captured when the composite
 *   is built: rebuild it when scene.environment is replaced. null: no environment specular (L_env = 0).
 *   scene.environmentNode and per-material envMaps aren't sampled.
 * - `environmentIntensity`: a number (fixed at build), a function read each frame (`() => scene.environmentIntensity`)
 *   or a node.
 * - `environmentRotation`: an Euler read each frame (scene.environmentRotation).
 * Fog: ssrGBuffer()'s F carries the scene's fog, so the composite fogs what it changes as the materials fog their own
 * environment specular; a supplied `specularNode` should fold it in the same way.
 */
export const ssrComposite =(colorNode, ssrNode, environment, options) =>
  ssrNode.getCompositeNode(colorNode, environment, options)

/**
 * `vec4(F·L_env, 1)`: the environment specular the stock scene contains, as ssrComposite() subtracts it (the same
 * `environment` and options).
 */
export const ssrEnvironmentSpecular = (ssrNode, environment, options) =>
  ssrNode.getEnvironmentSpecularNode(environment, options)
