/**
 * ColorPyramidNode - a prefiltered mip pyramid of an HDR colour texture, for glossy screen-space lookups
 *
 * Level L (1 ≤ L ≤ `levels`) is the colour at 2^L times coarser than its source, filtered with a separable binomial
 * [1, 3, 3, 1]/8 over a 4×4 footprint (4 bilinear taps per texel). Level 1 reads the colour; level L ≥ 2 reads level
 * L − 1. The levels ping-pong between two targets, so a pass never samples the texture it renders into and no level
 * needs a copy: A (half resolution) holds the odd levels at mip L − 1, B (quarter resolution) the even levels at mip
 * L − 2.
 *
 *   const pyramid = colorPyramid(scenePass.getTextureNode(), { levels: 5 }) // shared per (colour, levels)
 *   // in a consumer's updateBefore:   pyramid.update(renderer, frame)       // renders once per frame id
 *   // in its shader:                  pyramid.sample(uv, lod)               // trilinear between integer levels
 *   await pyramid.compileAsync(renderer)                                     // optional: the levels' pipelines
 *   pyramid.release()                                                        // disposed with its last user
 *
 * Used as a node itself, it is the pyramid at `screenUV` and level `lodNode`, and renders itself before the reader.
 * Consumers that only call `sample()` drive it with `update()`: it renders only for the frames someone asks it to.
 * The pyramid ignores depth, so coarse levels bleed across edges.
 */
import {
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  NodeMaterial,
  NodeUpdateType,
  QuadMesh,
  RenderTarget,
  RendererUtils,
  Node,
  TextureNode,
  Vector2,
} from 'three/webgpu'
import {
  clamp,
  float,
  floor,
  If,
  min,
  mix,
  nodeObject,
  screenUV,
  select,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { compileQuad } from './compileQuad.js'

const OPTIONS = ['levels', 'label']
const MAX_LEVELS = 8
const DEFAULT_LEVELS = 5

const _quadMesh = new QuadMesh()
const _size = new Vector2()
// colour node → Map(levels → pyramid)
const _shared = new WeakMap()

/** A texture node without the uv transform: its loads and samples skip the texture matrix's uniform and multiply. */
export class RawTextureNode extends TextureNode {
  static get type() {
    return 'RawTextureNode'
  }

  constructor(value, uvNode = null, levelNode = null, biasNode = null) {
    super(value, uvNode, levelNode, biasNode)
    this.setUpdateMatrix(false)
  }
}

// The levels option, or the default with a warning
function checkLevels(levels, who) {
  if (Number.isInteger(levels) && levels >= 0 && levels <= MAX_LEVELS) return levels
  console.warn(`${who}: levels ${levels}: an integer in 0–${MAX_LEVELS}.`)
  return DEFAULT_LEVELS
}

export class ColorPyramidNode extends Node {
  static get type() {
    return 'ColorPyramidNode'
  }

  isColorPyramidNode = true

  #levels
  #label
  #targets
  #textureNodes
  #materials = []
  #levelNames = []
  #texelOffsets = [] // per level: 0.75 source texels, in uv
  #mips = 0 // levels that fit the colour's size
  #lastFrameId = -1
  #users = 0
  #rendererState = {}
  #width = 0
  #height = 0
  #compiling = null
  #compiledMips = 0 // levels whose pipelines exist
  #disposed = false

  /**
   * @param {TextureNode} colorNode - The HDR colour to filter.
   * @param {object} [options]
   * @param {number} [options.levels=5] - Pyramid levels (0–8); 0 keeps only the colour.
   * @param {string} [options.label='ColorPyramid'] - Prefix of the targets' and materials' names.
   */
  constructor(colorNode, { levels = DEFAULT_LEVELS, label = 'ColorPyramid', ...rest } = {}) {
    super('vec4')
    for (const key of Object.keys(rest)) {
      console.warn(`ColorPyramidNode: unknown option "${key}". Options: ${OPTIONS.join(', ')}.`)
    }
    levels = checkLevels(levels, 'ColorPyramidNode')
    this.colorNode = colorNode
    this.#levels = levels
    this.#label = label
    /** Level read when the pyramid is used as a node. */
    this.lodNode = uniform(0)
    this.updateBeforeType = NodeUpdateType.FRAME
    this.#targets = ['A', 'B'].map((name) => {
      const target = new RenderTarget(1, 1, { depthBuffer: false, type: HalfFloatType, generateMipmaps: false })
      target.texture.name = `${label}.${name}`
      target.texture.minFilter = LinearMipmapLinearFilter
      target.texture.magFilter = LinearFilter
      target.texture.mipmaps.length = 0
      target.texture.mipmaps.push({})
      return target
    })
    this.#textureNodes = this.#targets.map((target) => nodeObject(new RawTextureNode(target.texture)))
    for (let level = 1; level <= levels; level++) {
      this.#levelNames.push(`${label}.Level${level}`)
      this.#texelOffsets.push(uniform(new Vector2()))
      this.#materials.push(this.#levelMaterial(level))
    }
  }

  /** Pyramid levels (construction-only). */
  get levels() {
    return this.#levels
  }

  get label() {
    return this.#label
  }

  /** [A, B]: odd levels at mip L − 1 of A (half resolution), even levels at mip L − 2 of B (quarter resolution). */
  get textures() {
    return this.#targets.map((target) => target.texture)
  }

  /** Sizes the pyramid for a colour of `width` × `height`. */
  setSize(width, height) {
    if (width === this.#width && height === this.#height) return
    this.#width = width
    this.#height = height
    const wA = Math.max(1, Math.ceil(width / 2))
    const hA = Math.max(1, Math.ceil(height / 2))
    const mips = Math.max(1, Math.min(this.#levels, Math.floor(Math.log2(Math.max(wA, hA))) + 1))
    this.#mips = mips
    // A: the odd levels' mips and the even ones between them; B: half A's size, its mips from level 2 on
    const sizes = [
      [wA, hA, mips % 2 === 1 ? mips : mips - 1],
      [Math.max(1, Math.floor(wA / 2)), Math.max(1, Math.floor(hA / 2)), Math.max(1, Math.floor(mips / 2) * 2 - 1)],
    ]
    this.#targets.forEach((target, i) => {
      const [w, h, count] = sizes[i]
      target.texture.mipmaps.length = 0
      for (let k = 0; k < count; k++) target.texture.mipmaps.push({})
      target.setSize(w, h)
    })
    // level L ≥ 2 reads level L − 1, at max(1, ⌊wA / 2^(L − 2)⌋) as its mip sits in either target
    for (let level = 1; level <= this.#levels; level++) {
      const div = 2 ** (level - 2)
      const w = level === 1 ? width : Math.max(1, Math.floor(wA / div))
      const h = level === 1 ? height : Math.max(1, Math.floor(hA / div))
      this.#texelOffsets[level - 1].value.set(0.75 / w, 0.75 / h)
    }
  }

  /**
   * Renders the levels unless they were rendered this frame. `stateSaved`: the caller has already saved and reset the
   * renderer's state, and restores it.
   */
  update(renderer, frame, { stateSaved = false } = {}) {
    // drawing a level being compiled would compile it synchronously
    if (this.#levels === 0 || this.#compiling !== null || frame.frameId === this.#lastFrameId) return
    this.#lastFrameId = frame.frameId
    this.#syncSize(renderer)
    if (!stateSaved) this.#rendererState = RendererUtils.resetRendererState(renderer, this.#rendererState)
    for (let level = 1; level <= this.#mips; level++) {
      _quadMesh.material = this.#materials[level - 1]
      _quadMesh.name = this.#levelNames[level - 1]
      renderer.setRenderTarget(...this.#levelTarget(level))
      _quadMesh.render(renderer)
    }
    this.#compiledMips = Math.max(this.#compiledMips, this.#mips)
    if (!stateSaved) RendererUtils.restoreRendererState(renderer, this.#rendererState)
  }

  /**
   * Compiles the levels the next update renders at the colour's size; await it before rendering. Levels compiled or
   * rendered before are skipped, so a second user compiling the shared pyramid costs nothing.
   */
  async compileAsync(renderer) {
    if (this.#levels === 0 || this.#disposed) return
    if (renderer.initialized !== true) await renderer.init()
    while (this.#compiling !== null) await this.#compiling
    if (this.#disposed) return
    this.#syncSize(renderer)
    const from = this.#compiledMips + 1
    const to = this.#mips
    if (from > to) return
    const jobs = []
    for (let level = from; level <= to; level++) {
      const [target, , mip] = this.#levelTarget(level)
      jobs.push(compileQuad(renderer, _quadMesh, this.#materials[level - 1], target, mip))
    }
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
    this.#compiledMips = Math.max(this.#compiledMips, to)
  }

  updateBefore(frame) {
    this.update(frame.renderer, frame)
  }

  /**
   * The colour at `uvNode`, blurred to pyramid level `lodNode` (0 = the colour itself, fractional levels blend the
   * two integer levels around them). Explicit integer levels only: 2 samples, 1 at level 0 without a blend.
   */
  sample(uvNode, lodNode) {
    const colorAt = (p) => texture(this.colorNode, p, float(0)).rgb
    if (this.#levels === 0) return colorAt(uvNode)
    const [A, B] = this.#textureNodes
    const at = (node, mip) => node.sample(uvNode).level(mip).rgb
    const lod = clamp(lodNode, 0, this.#levels)
    const Lc = min(floor(lod), this.#levels - 1).toVar()
    const f = lod.sub(Lc).toVar()
    const out = vec3(0).toVar()
    If(Lc.lessThan(0.5), () => {
      out.assign(colorAt(uvNode))
      If(f.greaterThan(0), () => {
        out.assign(mix(out, at(A, float(0)), f))
      })
    }).Else(() => {
      // odd Lc: Lc on A, Lc + 1 on B, both at mip Lc − 1; even Lc: Lc on B at mip Lc − 2, Lc + 1 on A at mip Lc
      const odd = Lc.mod(2).greaterThan(0.5)
      const a = at(A, select(odd, Lc.sub(1), Lc))
      const b = at(B, select(odd, Lc.sub(1), Lc.sub(2)))
      out.assign(mix(a, b, select(odd, f, f.oneMinus())))
    })
    return out
  }

  /** Counts a user; release() when done. */
  acquire() {
    this.#users++
    return this
  }

  /** Drops a user; the last one disposes the pyramid. */
  release() {
    this.#users = Math.max(0, this.#users - 1)
    if (this.#users === 0) this.dispose()
  }

  setup() {
    return vec4(this.sample(screenUV, this.lodNode), 1)
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    super.dispose()
    const byLevels = _shared.get(this.colorNode)
    if (byLevels?.get(this.#levels) === this) byLevels.delete(this.#levels)
    const free = () => {
      for (const target of this.#targets) target.dispose()
      for (const material of this.#materials) material.dispose()
    }
    // a compile in flight still allocates the targets and builds the materials
    if (this.#compiling !== null) this.#compiling.then(free)
    else free()
  }

  // Sized from the colour, else, before its pass first renders, from the size that pass will have.
  #syncSize(renderer) {
    const image = this.colorNode.value?.image
    if (image?.width > 1 || image?.height > 1) this.setSize(image.width, image.height)
    else {
      renderer.getDrawingBufferSize(_size)
      const scale = this.colorNode.passNode?.getResolutionScale?.() ?? 1
      this.setSize(Math.max(1, Math.floor(_size.x * scale)), Math.max(1, Math.floor(_size.y * scale)))
    }
  }

  // [target, cube face, mip] level L renders into: odd levels into A at mip L − 1, even ones into B at mip L − 2.
  #levelTarget(level) {
    const odd = level % 2 === 1
    return [this.#targets[odd ? 0 : 1], 0, odd ? level - 1 : level - 2]
  }

  #levelMaterial(level) {
    const material = new NodeMaterial()
    material.name = this.#levelNames[level - 1]
    // level L − 1: the colour, or A at mip L − 2 (odd L − 1), or B at mip L − 3 (even L − 1)
    const source = level === 1 ? texture(this.colorNode) : this.#textureNodes[level % 2]
    const mip = level === 1 ? 0 : level % 2 === 0 ? level - 2 : level - 3
    const p = uv()
    const offset = this.#texelOffsets[level - 1]
    const tap = (dx, dy) => texture(source, p.add(offset.mul(vec2(dx, dy))), float(mip)).rgb
    material.fragmentNode = vec4(tap(-1, -1).add(tap(1, -1)).add(tap(-1, 1)).add(tap(1, 1)).mul(0.25), 1)
    return material
  }
}

/**
 * The shared pyramid of `colorNode` with `levels` levels: one per (colour, levels), counted per call. Call
 * `release()` on it when done.
 */
export function colorPyramid(colorNode, { levels = DEFAULT_LEVELS, label = 'ColorPyramid', ...rest } = {}) {
  for (const key of Object.keys(rest)) {
    console.warn(`colorPyramid: unknown option "${key}". Options: ${OPTIONS.join(', ')}.`)
  }
  levels = checkLevels(levels, 'colorPyramid')
  let byLevels = _shared.get(colorNode)
  if (!byLevels) _shared.set(colorNode, (byLevels = new Map()))
  let pyramid = byLevels.get(levels)
  if (!pyramid) {
    pyramid = new ColorPyramidNode(colorNode, { levels, label })
    byLevels.set(levels, pyramid)
  }
  return pyramid.acquire()
}
