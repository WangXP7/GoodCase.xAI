// Bloom: three's UnrealBloom (BloomNode) look in 8 passes instead of 12.
//
// The composite math and each mip's Gaussian footprint match the stock node; the work is restructured:
//  - the luminance high pass is fused into mip0's horizontal blur taps, unmerged at half-res texel centres, so it
//    keeps stock's threshold-then-blur order exactly
//  - mip0 keeps stock's separable pair (it draws the tight core glow)
//  - mips 1-4 are single-pass 2x-downsample hops with 2D Gaussian kernels: cascaded Gaussians compose
//    (sigma_total² = Σ sigma_i²), so each mip reaches stock's cumulative blur while touching far fewer pixels
//  - the composite keeps its own half-res pass, so the consumer reads one texture instead of five
//
// The mips live one octave below stock (1/8..1/64 instead of 1/4..1/32): their content is >= 1.7 sigma-texels smooth
// at storage res, which the composite's bilinear upsample reconstructs cleanly.
//
// The look of `bloom()` from 'three/addons/tsl/display/BloomNode.js', with the settings in an options object. The input
// must be a texture node (a pass output), since the high pass samples it at offset UVs:
//
//   const sceneColor = scenePass.getTextureNode()
//   const bloomNode = bloom(sceneColor, { strength: 1, radius: 0.5, threshold: 0.8 })
//   renderPipeline.outputNode = sceneColor.add(bloomNode)
//   await bloomNode.compileAsync(renderer) // optional: compiles the passes ahead of the first frame

import {
  HalfFloatType,
  NodeMaterial,
  NodeUpdateType,
  QuadMesh,
  RenderTarget,
  RendererUtils,
  Node,
  Vector2,
  Vector3,
} from 'three/webgpu'
import {
  add,
  Fn,
  float,
  luminance,
  mix,
  nodeObject,
  passTexture,
  smoothstep,
  texture,
  uniform,
  uniformArray,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { compileQuad } from './utils/compileQuad.js'

const _quadMesh = new QuadMesh()
const _size = new Vector2()
let _rendererState

// Stock UnrealBloom per-mip kernel radii; sigma = K/3 texels, at scales 1/2..1/32.
const STOCK_KERNEL_SIZES = [6, 10, 14, 18, 22]
const MIP_FACTORS = [1.0, 0.8, 0.6, 0.4, 0.2]

// Downsample hops of mips 1-4, as fractions of mip0's resolution, each a 2x
// downsample. Intermediate hops blur by HOP_SIGMA texels; each mip's last hop
// takes the variance left, so the cumulative blur matches stock.
const MIP_HOPS = [[2, 4], [8], [16], [32]]
const HOP_SIGMA = 1.55 // keeps intermediate kernels at 5x5 merged taps

// The uniform-backed settings and their defaults: each getter returns the uniform, each setter sets its value.
const SETTINGS = { strength: 1, radius: 0, threshold: 0, smoothWidth: 0.01 }
const OPTIONS = [...Object.keys(SETTINGS), 'resolutionScale', 'highPassFn', 'bloomTintColors']

const luminosityHighPass = Fn(({ input, threshold, smoothWidth }) => {
  const v = luminance(input.rgb)
  const alpha = smoothstep(threshold, threshold.add(smoothWidth), v)
  return mix(vec4(0), input, alpha)
})

// 1D Gaussian taps at the integer offsets below `radius`, adjacent pairs
// merged into single bilinear fetches. taps[0] is the center.
function gaussianTaps(sigma, radius) {
  const coefficients = []
  for (let i = 0; i < radius; i++) {
    coefficients.push(Math.exp((-0.5 * i * i) / (sigma * sigma)))
  }

  const taps = [{ offset: 0, weight: coefficients[0] }]
  for (let i = 1; i < radius; i += 2) {
    const wa = coefficients[i]
    const wb = i + 1 < radius ? coefficients[i + 1] : 0
    const w = wa + wb
    taps.push({ offset: (i * wa + (i + 1) * wb) / w, weight: w })
  }
  return taps
}

// Per-axis second moment of a merged tap set — the discrete blur variance the
// kernel actually applies, which the hop solver matches against stock.
function tapsVariance(taps) {
  let total = taps[0].weight
  let varSum = 0
  for (let i = 1; i < taps.length; i++) {
    total += 2 * taps[i].weight
    varSum += 2 * taps[i].weight * taps[i].offset ** 2
  }
  return varSum / total
}

// A hop kernel's radius: odd, so every coefficient shares a fetch, and
// reaching 2.5 sigma, about where stock truncates.
function hopRadius(sigma) {
  return 2 * Math.ceil(1.25 * sigma) + 1
}

// Merged taps whose discrete (truncated) variance hits the target, which the
// analytic sigma undershoots once tails are cut. The radius is fixed first, so
// the variance doesn't jump where 3 sigma crosses an integer.
function tapsForVariance(targetVariance) {
  const radius = hopRadius(Math.sqrt(targetVariance))
  let sigma = Math.sqrt(targetVariance)
  for (let i = 0; i < 8; i++) {
    sigma *= Math.sqrt(targetVariance / tapsVariance(gaussianTaps(sigma, radius)))
  }
  return gaussianTaps(sigma, radius)
}

// The stock kernels lose ~0.5% energy per pass (unnormalized discrete
// coefficients); each mip's last hop replicates it to match stock's brightness.
function stockKernelSum(kernelRadius) {
  const sigma = kernelRadius / 3
  let sum = 0.39894 / sigma
  for (let i = 1; i < kernelRadius; i++) {
    sum += (2 * 0.39894 * Math.exp((-0.5 * i * i) / (sigma * sigma))) / sigma
  }
  return sum
}

// Expand merged taps to signed 1D offsets: [{0,w0}, {+o1,w1}, {-o1,w1}, ...]
function signedTaps(taps) {
  const signed = [taps[0]]
  for (let i = 1; i < taps.length; i++) {
    signed.push(taps[i], { offset: -taps[i].offset, weight: taps[i].weight })
  }
  return signed
}

class BloomNode extends Node {
  static get type() {
    return 'BloomNode'
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
            console.warn(`BloomNode: ${name} takes a number; drive its uniform with onFrameUpdate() instead.`)
            return
          }
          this.#u[name].value = value
        },
      })
    }
  }

  /** Scale factor for the internal render targets, like stock. Read every frame. */
  resolutionScale = 0.5

  #u = Object.fromEntries(Object.entries(SETTINGS).map(([name, value]) => [name, uniform(value)]))
  // Per-mip tint, applied in the composite, which reads these vectors every frame.
  #bloomTintColors = Array.from({ length: 5 }, () => new Vector3(1, 1, 1))
  // Applied per blur tap of mip0's high pass.
  #highPassFn = luminosityHighPass
  // what the high pass was built from
  #builtHighPassFn = null
  #builtInputNode = null
  #sharedContext = null
  #pending = new Set() // materials built since the last frame or compile
  #compiling = null
  #disposed = false

  #renderTargetH0
  #mipRenderTargets = [] // the 5 composite inputs (index 0 = mip0's vertical target)
  #renderTargetComposite
  #hops = [] // { renderTarget, scale, taps1D, gain, sourceTexture, invSize, material }
  #invSizeMip0 = uniform(new Vector2())
  #textureH0
  #mipTextures = []
  #textureOutput
  #materialH0 = null
  #materialV0 = null
  #materialComposite = null

  /**
   * @param {TextureNode} inputNode - A texture node, such as a pass output.
   * @param {object} [options] - strength, radius, threshold, smoothWidth, resolutionScale, highPassFn, bloomTintColors.
   */
  constructor(inputNode, options = {}) {
    super('vec4')

    this.inputNode = inputNode
    if (typeof options !== 'object' || options === null || options.isNode === true) {
      console.warn('BloomNode: the settings go in an options object: bloom(node, { strength, radius, threshold }).')
      options = {}
    }
    for (const [key, value] of Object.entries(options)) {
      if (!OPTIONS.includes(key)) console.warn(`BloomNode: unknown option "${key}". Options: ${OPTIONS.join(', ')}.`)
      else if (value !== undefined) this[key] = value
    }

    this.#renderTargetH0 = this.#createRenderTarget('Bloom.h0')
    this.#textureH0 = texture(this.#renderTargetH0.texture)

    this.#mipRenderTargets.push(this.#createRenderTarget('Bloom.mip0'))

    MIP_HOPS.forEach((scales, i) => {
      const mip = i + 1
      // Stock's discrete variance for this mip (sigma = K/3 texels at scale
      // 2^-mip), in mip0 texels, minus the extra widening of our coarser
      // bilinear upsample (a tent filter, variance 1/6 texel² at storage res).
      const kernelSize = STOCK_KERNEL_SIZES[mip]
      let remaining =
        tapsVariance(gaussianTaps(kernelSize / 3, kernelSize)) * 4 ** mip + (4 ** mip - scales.at(-1) ** 2) / 6

      scales.forEach((scale, j) => {
        const isLast = j === scales.length - 1
        const taps1D = isLast ? tapsForVariance(remaining / scale ** 2) : gaussianTaps(HOP_SIGMA, hopRadius(HOP_SIGMA))
        remaining -= tapsVariance(taps1D) * scale ** 2

        const renderTarget = this.#createRenderTarget(isLast ? `Bloom.mip${mip}` : `Bloom.down${scale * 2}`)
        if (isLast) this.#mipRenderTargets.push(renderTarget)

        const sourceRenderTarget = this.#hops.length > 0 ? this.#hops.at(-1).renderTarget : this.#mipRenderTargets[0]
        this.#hops.push({
          renderTarget,
          scale,
          taps1D,
          gain: isLast ? stockKernelSum(kernelSize) ** 2 : 1,
          sourceTexture: texture(sourceRenderTarget.texture),
          invSize: uniform(new Vector2()),
          material: null,
        })
      })
    })

    this.#mipTextures = this.#mipRenderTargets.map((rt) => texture(rt.texture))

    this.#renderTargetComposite = this.#createRenderTarget('Bloom.composite')
    this.#textureOutput = passTexture(this, this.#renderTargetComposite.texture)

    this.updateBeforeType = NodeUpdateType.FRAME
  }

  #createRenderTarget(name) {
    const renderTarget = new RenderTarget(1, 1, { depthBuffer: false, type: HalfFloatType })
    renderTarget.texture.name = name
    renderTarget.texture.generateMipmaps = false
    return renderTarget
  }

  /** The high pass on each of mip0's blur taps, e.g. for anamorphic looks. Rebuilds it on the next frame. */
  get highPassFn() {
    return this.#highPassFn
  }
  set highPassFn(fn) {
    this.#highPassFn = fn
  }

  /** Per-mip tint, tight to wide. Mutate the vectors, or assign five to copy them in. */
  get bloomTintColors() {
    return this.#bloomTintColors
  }
  set bloomTintColors(colors) {
    // the composite reads these vectors: copy into them
    if (colors.length !== this.#bloomTintColors.length) {
      console.warn(`BloomNode: bloomTintColors takes ${this.#bloomTintColors.length} vectors, got ${colors.length}.`)
    }
    for (const [i, tint] of this.#bloomTintColors.entries()) if (colors[i]) tint.copy(colors[i])
  }

  /** The composited bloom as a texture node, like stock's. */
  getTextureNode() {
    return this.#textureOutput
  }

  setSize(width, height) {
    const resx = Math.max(1, Math.floor(width * this.resolutionScale))
    const resy = Math.max(1, Math.floor(height * this.resolutionScale))

    this.#renderTargetH0.setSize(resx, resy)
    this.#mipRenderTargets[0].setSize(resx, resy)
    this.#renderTargetComposite.setSize(resx, resy)
    this.#invSizeMip0.value.set(1 / resx, 1 / resy)

    for (const hop of this.#hops) {
      const w = Math.max(1, Math.floor(resx / hop.scale))
      const h = Math.max(1, Math.floor(resy / hop.scale))
      hop.renderTarget.setSize(w, h)
      hop.invSize.value.set(1 / w, 1 / h)
    }
  }

  /**
   * Compiles the node's passes ahead of their first frame. Await it before rendering: each pass's target stays bound
   * while it compiles. Optional.
   */
  async compileAsync(renderer) {
    if (this.#disposed) return
    if (renderer.initialized !== true) await renderer.init()
    if (this.#disposed) return
    // build first, as the first frame would; a compile in flight holds the rebuild until it settles
    if (this.#compiling === null && this.#needsBuild()) this.#build()
    const passes = this.#passes().filter(({ material }) => this.#pending.has(material))
    if (passes.length === 0) {
      if (this.#compiling === null) return
      // another call compiles them: wait for it, then for what changed meanwhile
      await Promise.allSettled([this.#compiling])
      return this.compileAsync(renderer)
    }
    for (const { material } of passes) this.#pending.delete(material)
    const run = this.#compilePasses(renderer, passes)
    const all = this.#compiling ? Promise.allSettled([this.#compiling, run]) : run
    this.#compiling = all
    try {
      await run
    } finally {
      if (this.#compiling === all) this.#compiling = null
    }
    // an option changed while it ran: compile the rebuilt passes too
    if (!this.#disposed && this.#needsBuild()) {
      await Promise.allSettled([all])
      await this.compileAsync(renderer)
    }
  }

  updateBefore(frame) {
    // drawing a pass while it compiles would compile it again, synchronously
    if (this.#compiling !== null || this.#disposed) return
    const { renderer } = frame

    _rendererState = RendererUtils.resetRendererState(renderer, _rendererState)

    const size = renderer.getDrawingBufferSize(_size)
    this.setSize(size.width, size.height)

    if (this.#needsBuild()) this.#build()

    renderer.setRenderTarget(this.#renderTargetH0)
    _quadMesh.material = this.#materialH0
    _quadMesh.name = 'Bloom [ High Pass + Blur Horizontal ]'
    _quadMesh.render(renderer)

    renderer.setRenderTarget(this.#mipRenderTargets[0])
    _quadMesh.material = this.#materialV0
    _quadMesh.name = 'Bloom [ Blur Vertical ]'
    _quadMesh.render(renderer)

    for (const hop of this.#hops) {
      renderer.setRenderTarget(hop.renderTarget)
      _quadMesh.material = hop.material
      _quadMesh.name = `Bloom [ ${hop.renderTarget.texture.name} ]`
      _quadMesh.render(renderer)
    }

    renderer.setRenderTarget(this.#renderTargetComposite)
    _quadMesh.material = this.#materialComposite
    _quadMesh.name = 'Bloom [ Composite ]'
    _quadMesh.render(renderer)

    RendererUtils.restoreRendererState(renderer, _rendererState)
    this.#pending.clear()
  }

  setup(builder) {
    this.#sharedContext = builder.getSharedContext()
    // every consumer sets it up: keep what is built, and leave a rebuild to the frame while a compile runs
    if (this.#materialV0 === null || (this.#compiling === null && this.#needsBuild())) this.#build()
    return this.#textureOutput
  }

  // ── Build ───────────────────────────────────────────────────────────

  #needsBuild() {
    return (
      this.#materialV0 === null ||
      this.#builtHighPassFn !== this.#highPassFn ||
      this.#builtInputNode !== this.inputNode
    )
  }

  // Every pass the frame renders, in order, with its target.
  #passes() {
    return [
      { material: this.#materialH0, target: this.#renderTargetH0 },
      { material: this.#materialV0, target: this.#mipRenderTargets[0] },
      ...this.#hops.map((hop) => ({ material: hop.material, target: hop.renderTarget })),
      { material: this.#materialComposite, target: this.#renderTargetComposite },
    ]
  }

  // The high pass whenever its function or input changed; the other passes once.
  #build() {
    if (typeof this.inputNode.sample !== 'function') {
      throw new Error(
        'BloomNode: inputNode must be a texture node (a pass output) — the high pass samples it at offset UVs.',
      )
    }
    if (this.#builtHighPassFn !== this.#highPassFn || this.#builtInputNode !== this.inputNode) this.#buildHighPass()
    if (this.#materialV0 === null) this.#buildBlurs()
  }

  // Every pass in the state the frame renders it in, for its target; resolves once they all exist.
  #compilePasses(renderer, passes) {
    const size = renderer.getDrawingBufferSize(_size)
    this.setSize(size.width, size.height)
    return Promise.all(passes.map(({ material, target }) => compileQuad(renderer, _quadMesh, material, target)))
  }

  #buildBlurs() {
    const sharedContext = this.#sharedContext ?? {}
    const mip0Sigma = STOCK_KERNEL_SIZES[0] / 3
    const mip0Taps = signedTaps(gaussianTaps(mip0Sigma, STOCK_KERNEL_SIZES[0]))
    // Stock's unnormalized coefficient scale, kept for exact mip0 brightness.
    const mip0Scale = 0.39894 / mip0Sigma

    // Mip0 vertical blur: the stock kernel
    const blurV = Fn(() => {
      const uvNode = uv()
      const sum = vec3(0).toVar()
      for (const { offset, weight } of mip0Taps) {
        const sampleUv = uvNode.add(vec2(0, offset).mul(this.#invSizeMip0))
        sum.addAssign(this.#textureH0.sample(sampleUv).rgb.mul(weight * mip0Scale))
      }
      return vec4(sum, 1)
    })

    this.#materialV0 = this.#materialV0 || new NodeMaterial()
    this.#materialV0.fragmentNode = blurV().context(sharedContext)
    this.#materialV0.name = 'Bloom_blurV'
    this.#materialV0.needsUpdate = true

    // Downsample hops: one pass each, a normalized 2D kernel as the outer
    // product of the merged 1D taps
    for (const hop of this.#hops) {
      const taps = signedTaps(hop.taps1D)
      const total1D = taps.reduce((sum, tap) => sum + tap.weight, 0)
      const norm = hop.gain / total1D ** 2

      const downsampleBlur = Fn(() => {
        const uvNode = uv()
        const sum = vec3(0).toVar()
        for (const tapX of taps) {
          for (const tapY of taps) {
            const sampleUv = uvNode.add(vec2(tapX.offset, tapY.offset).mul(hop.invSize))
            sum.addAssign(hop.sourceTexture.sample(sampleUv).rgb.mul(tapX.weight * tapY.weight * norm))
          }
        }
        return vec4(sum, 1)
      })

      hop.material = hop.material || new NodeMaterial()
      hop.material.fragmentNode = downsampleBlur().context(sharedContext)
      hop.material.name = `Bloom_${hop.renderTarget.texture.name.split('.')[1]}`
      hop.material.needsUpdate = true
    }

    // Composite at mip0 res, like stock: the consumer reads one texture
    const bloomTintColors = uniformArray(this.bloomTintColors)

    const composite = Fn(() => {
      const terms = this.#mipTextures.map((mipTexture, i) => {
        const factor = mix(float(MIP_FACTORS[i]), float(1.2 - MIP_FACTORS[i]), this.radius)
        return factor.mul(vec4(bloomTintColors.element(i), 1)).mul(mipTexture)
      })
      return add(...terms).mul(this.strength)
    })

    this.#materialComposite = this.#materialComposite || new NodeMaterial()
    this.#materialComposite.fragmentNode = composite().context(sharedContext)
    this.#materialComposite.name = 'Bloom_composite'
    this.#materialComposite.needsUpdate = true

    this.#pending.add(this.#materialV0)
    for (const hop of this.#hops) this.#pending.add(hop.material)
    this.#pending.add(this.#materialComposite)
  }

  // Mip0 horizontal blur with the high pass fused into every tap. The taps stay unmerged on half-res texel centres,
  // where the bilinear fetch of the input equals stock's bright-pass value (merging needs thresholded data).
  #buildHighPass() {
    this.#builtHighPassFn = this.#highPassFn
    this.#builtInputNode = this.inputNode
    const mip0Sigma = STOCK_KERNEL_SIZES[0] / 3
    // Stock's unnormalized coefficient scale, kept for exact mip0 brightness.
    const mip0Scale = 0.39894 / mip0Sigma

    const highPassBlurH = Fn(() => {
      const uvNode = uv()
      const sum = vec3(0).toVar()
      for (let i = 1 - STOCK_KERNEL_SIZES[0]; i < STOCK_KERNEL_SIZES[0]; i++) {
        const weight = Math.exp((-0.5 * i * i) / (mip0Sigma * mip0Sigma))
        const sampleUv = uvNode.add(vec2(i, 0).mul(this.#invSizeMip0))
        const bright = this.#highPassFn({
          input: this.inputNode.sample(sampleUv),
          threshold: this.threshold,
          smoothWidth: this.smoothWidth,
        })
        sum.addAssign(bright.rgb.mul(weight * mip0Scale))
      }
      return vec4(sum, 1)
    })

    this.#materialH0 = this.#materialH0 || new NodeMaterial()
    this.#materialH0.fragmentNode = highPassBlurH().context(this.#sharedContext ?? {})
    this.#materialH0.name = 'Bloom_highPassBlurH'
    this.#materialH0.needsUpdate = true
    this.#pending.add(this.#materialH0)
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    super.dispose()

    const free = () => {
      this.#renderTargetH0.dispose()
      this.#mipRenderTargets[0].dispose()
      this.#renderTargetComposite.dispose()

      if (this.#materialH0 !== null) this.#materialH0.dispose()
      if (this.#materialV0 !== null) this.#materialV0.dispose()
      if (this.#materialComposite !== null) this.#materialComposite.dispose()
      for (const hop of this.#hops) {
        hop.renderTarget.dispose()
        if (hop.material !== null) hop.material.dispose()
      }
    }
    // a compile in flight would bind what is freed meanwhile
    if (this.#compiling !== null) this.#compiling.then(free, free)
    else free()
  }
}

/**
 * TSL function for creating the optimized bloom effect.
 *
 * @param {Node<vec4>} node - The input node, must be a texture node (a pass output).
 * @param {object} [options] - strength, radius, threshold, smoothWidth, resolutionScale, highPassFn, bloomTintColors.
 * @returns {BloomNode}
 */
export const bloom = (node, options) => new BloomNode(nodeObject(node), options)

export { BloomNode }
export default BloomNode
