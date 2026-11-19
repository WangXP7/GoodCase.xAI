// Temporal anti-aliasing upscaling: jittered frames, rendered at or below the output's resolution, accumulated into one
// stable, anti-aliased image at the output's:
//
//   const scenePass = pass(scene, camera, { samples: 0 })
//   scenePass.setMRT(mrt({ output, velocity }))
//   scenePass.setResolutionScale(0.5)
//   const color = scenePass.getTextureNode('output')
//   const depth = scenePass.getTextureNode('depth')
//   const taauNode = taau(color, depth, scenePass.getTextureNode('velocity'), camera, { maxAccumulation: 24 })
//   renderPipeline.outputNode = renderOutput(taauNode.getTextureNode())
//   await taauNode.compileAsync(renderer) // optional: compiles the passes ahead of the first frame

import { Camera, Node, OrthographicCamera, PerspectiveCamera, Renderer, TextureNode, UniformNode } from 'three/webgpu'

/** Colour space of the history's second clip box. */
export type TAAUClipColorSpace = 'ycocg' | 'rgb'

export interface TAAUNodeOptions {
  /** Reads the history with a 5-tap Catmull-Rom filter instead of one bilinear tap. Default true. */
  bicubicHistory?: boolean
  /** Halton(2, 3) jitter phases: 32 suits a 2× upscale, 16 a 1.5× one. Default 32. */
  jitterPhases?: number
  /** Mask at the input resolution for content without velocity: 0 keeps the history, 1 drops it. Default null. */
  reactiveNode?: TextureNode | null
  /** 'ycocg' clips the history to the neighbourhood's YCoCg and RGB boxes, 'rgb' to the RGB one. Default 'ycocg'. */
  clipColorSpace?: TAAUClipColorSpace
  /** Keeps the output in one texture across frames, for consumers that hold its `.value`. Default false. */
  stableOutput?: boolean
  /** Least share of the current frame in the blend. Default 0.02. */
  currentFrameWeight?: number
  /** Cap on the samples a pixel accumulates; a still one remembers about twice as many frames. Default 16. */
  maxAccumulation?: number
  /** Reconstruction kernel σ, in output pixels. Default 0.47. */
  kernelSigma?: number
  /** Least kernel σ, in input pixels; keep it below `kernelSigma` × the input / output ratio. Default 0.2. */
  kernelSigmaFloor?: number
  /** Depth change, as a share of the view depth, that drops the history. Default 0.02. */
  depthRejectTolerance?: number
  /** 3×3 depth spread, as a share of the view depth, that marks an edge, whose history is kept. Default 0.04. */
  edgeDetectTolerance?: number
  /** Motion, in output pixels per frame, at which the current frame takes over. Default 128. */
  maxVelocityLength?: number
  /** Clip box width under full motion, as a share of its width at rest. Default 0.5. */
  varianceGammaMin?: number
  /** Per-frame survival of a thin-feature lock; 0 disables locking. Default 0.5. */
  lockDecay?: number
  /** Luma contrast against the neighbourhood that locks a thin feature. Default 0.2. */
  lockThreshold?: number
  /** Strength of the `reactiveNode` mask. Default 1. */
  reactiveAmount?: number
  /** 1 locks only luma ridges under two texels wide (FSR2's shape test), 0 any contrast. Default 1. */
  lockDetection?: number
  /** Luma ratio under which two texels count as similar in the ridge test. Default 1.05. */
  lockSimilarity?: number
  /** Change of the neighbourhood's median luma that drops an inherited lock; 1 never does. Default 0.1. */
  lockLumaTolerance?: number
  /** Sample cap for a moving edge whose history matches no surface nearby. Default 2. */
  edgeDisocclusionAccumulation?: number
  /** Motion against the surface behind, in output pixels per frame, that makes an edge moving. Default 1. */
  edgeDisocclusionMinParallax?: number
}

export declare class TAAUNode extends Node<'vec4'> {
  /** Values accepted by `clipColorSpace`. */
  static readonly clipColorSpaces: readonly TAAUClipColorSpace[]

  /**
   * @param beautyNode Scene colour at the input resolution: a pass or RTT texture.
   * @param depthNode Scene depth at the input resolution.
   * @param velocityNode Scene velocity at the input resolution.
   */
  constructor(
    beautyNode: TextureNode,
    depthNode: TextureNode,
    velocityNode: TextureNode,
    camera: PerspectiveCamera | OrthographicCamera,
    options?: TAAUNodeOptions,
  )

  readonly isTAAUNode: true

  beautyNode: TextureNode
  depthNode: TextureNode
  velocityNode: TextureNode
  camera: PerspectiveCamera | OrthographicCamera

  /** Reads the history with a 5-tap Catmull-Rom filter, not one bilinear tap. Rebuilds the resolve. Default true. */
  bicubicHistory: boolean
  /** Halton(2, 3) jitter phases: 32 suits a 2× upscale, 16 a 1.5× one. Default 32. */
  jitterPhases: number
  /**
   * Mask at the input resolution for content without velocity: 0 keeps the history, 1 drops it. Rebuilds the node's
   * passes. Default null.
   */
  reactiveNode: TextureNode | null
  /** 'ycocg' clips the history to the neighbourhood's YCoCg and RGB boxes, 'rgb' to the RGB one. Default 'ycocg'. */
  clipColorSpace: TAAUClipColorSpace
  /**
   * Keeps the output in one texture across frames, for consumers that hold its `.value`. Rebuilds the targets and
   * drops the history; consumers that hold the `.value` read the new texture once the output graph rebuilds
   * (`renderPipeline.needsUpdate = true`). Default false.
   */
  stableOutput: boolean

  /** Least share of the current frame in the blend. Default 0.02. */
  get currentFrameWeight(): UniformNode<'float'>
  set currentFrameWeight(value: number)
  /** Cap on the samples a pixel accumulates; a still one remembers about twice as many frames. Default 16. */
  get maxAccumulation(): UniformNode<'float'>
  set maxAccumulation(value: number)
  /** Reconstruction kernel σ, in output pixels. Default 0.47. */
  get kernelSigma(): UniformNode<'float'>
  set kernelSigma(value: number)
  /** Least kernel σ, in input pixels; keep it below `kernelSigma` × the input / output ratio. Default 0.2. */
  get kernelSigmaFloor(): UniformNode<'float'>
  set kernelSigmaFloor(value: number)
  /** Depth change, as a share of the view depth, that drops the history. Default 0.02. */
  get depthRejectTolerance(): UniformNode<'float'>
  set depthRejectTolerance(value: number)
  /** 3×3 depth spread, as a share of the view depth, that marks an edge, whose history is kept. Default 0.04. */
  get edgeDetectTolerance(): UniformNode<'float'>
  set edgeDetectTolerance(value: number)
  /** Motion, in output pixels per frame, at which the current frame takes over. Default 128. */
  get maxVelocityLength(): UniformNode<'float'>
  set maxVelocityLength(value: number)
  /** Clip box width under full motion, as a share of its width at rest. Default 0.5. */
  get varianceGammaMin(): UniformNode<'float'>
  set varianceGammaMin(value: number)
  /** Per-frame survival of a thin-feature lock; 0 disables locking. Default 0.5. */
  get lockDecay(): UniformNode<'float'>
  set lockDecay(value: number)
  /** Luma contrast against the neighbourhood that locks a thin feature. Default 0.2. */
  get lockThreshold(): UniformNode<'float'>
  set lockThreshold(value: number)
  /** Strength of the `reactiveNode` mask. Default 1. */
  get reactiveAmount(): UniformNode<'float'>
  set reactiveAmount(value: number)
  /** 1 locks only luma ridges under two texels wide (FSR2's shape test), 0 any contrast. Default 1. */
  get lockDetection(): UniformNode<'float'>
  set lockDetection(value: number)
  /** Luma ratio under which two texels count as similar in the ridge test. Default 1.05. */
  get lockSimilarity(): UniformNode<'float'>
  set lockSimilarity(value: number)
  /** Change of the neighbourhood's median luma that drops an inherited lock; 1 never does. Default 0.1. */
  get lockLumaTolerance(): UniformNode<'float'>
  set lockLumaTolerance(value: number)
  /** Sample cap for a moving edge whose history matches no surface nearby. Default 2. */
  get edgeDisocclusionAccumulation(): UniformNode<'float'>
  set edgeDisocclusionAccumulation(value: number)
  /** Motion against the surface behind, in output pixels per frame, that makes an edge moving. Default 1. */
  get edgeDisocclusionMinParallax(): UniformNode<'float'>
  set edgeDisocclusionMinParallax(value: number)

  /** The resolved colour. Its `.value` ping-pongs between frames: keep the node, not the texture. */
  getTextureNode(): TextureNode
  /** Drops the history, e.g. on a camera cut. */
  resetHistory(): void
  /**
   * Compiles the node's passes ahead of their first frame. Await it before rendering: each pass's target stays bound
   * while it compiles. Optional.
   */
  compileAsync(renderer: Renderer): Promise<void>
}

/** Keeps the velocity's projection unjittered while no TAAUNode renders; call it each frame before rendering. */
export declare function syncUnjitteredProjection(camera: Camera): void

export declare const taau: (
  beautyNode: Node<'vec4'>,
  depthNode: TextureNode,
  velocityNode: TextureNode,
  camera: PerspectiveCamera | OrthographicCamera,
  options?: TAAUNodeOptions,
) => TAAUNode
