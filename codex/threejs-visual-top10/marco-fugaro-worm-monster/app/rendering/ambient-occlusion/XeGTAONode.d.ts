// XeGTAO ambient occlusion at a fraction of the resolution, denoised and accumulated over frames. On the ambient
// light alone, from an opaque prepass's depth:
//
//   prePass.contextNode = context({ getAO: null }) // the prepass mustn't read the AO it feeds
//   const occlusion = xeGTAO(prePass.getTextureNode('depth'), camera, { radius: 0.5 }) // world units
//   scenePass.contextNode = builtinAOContext(occlusion.getMaterialAONode())
//   await occlusion.compileAsync(renderer) // optional: compiles its passes ahead of the first frame
//
// Or as a post effect: multiply the scene's color by `occlusion.getAONode()`.

import { Node, PerspectiveCamera, Renderer, SampleNode, TextureNode, UniformNode } from 'three/webgpu'

export interface XeGTAONodeOptions {
  /** View-space normals; null rebuilds them from depth. Rebuilds the shaders on change. Default null. */
  normalNode?: TextureNode | SampleNode<'vec3'> | null
  /** The scene pass's velocity; null: the camera's motion alone. Rebuilds the shaders on change. Default null. */
  velocityNode?: TextureNode | null
  /** Horizon slices per pixel. Rebuilds the shaders on change. Default 2. */
  sliceCount?: number
  /** Steps per side of each slice. Rebuilds the shaders on change. Default 3. */
  stepsPerSlice?: number
  /** The AO's resolution relative to the drawing buffer. Default 0.5. */
  resolutionScale?: number
  /** The 4×4 denoise, which carries the temporal accumulation. Off shows the raw, dithered AO. Default true. */
  denoise?: boolean
  /** Moves the sampling pattern every frame and blends each result over the reprojected history. Default true. */
  temporalAccumulation?: boolean
  /** Shortens the history where an occluder moved in or out of the kernel's reach. Default true. */
  changeDetection?: boolean
  /** With a velocity node, reprojects what moves on its own along its motion vectors. Default true. */
  motionVectors?: boolean
  /** World units. Default 0.5. */
  radius?: number
  /** Blends from no occlusion (0) to full (1). Default 1. */
  intensity?: number
  /** The visibility curve's exponent. Default 2.2. */
  power?: number
  /** The outer share of the radius over which taps fade out. Default 0.615. */
  falloffRange?: number
  /** 0 to 0.7: stretches the falloff along view Z, so thin objects occlude less. Default 0. */
  thinOccluder?: number
  /** Caps the radius on screen, in drawing-buffer px. Default 256. */
  maxScreenRadius?: number
  /** The view distance where the AO starts fading out. Default 100. */
  fadeStart?: number
  /** The view distance where the AO is gone. Default 300. */
  fadeEnd?: number
  /** Step spacing along a slice, as a power: 2 clusters the taps near the center. Default 2. */
  sampleDistributionPower?: number
  /** How far a denoise tap may sit off the center's plane, × view distance. Default 0.011. */
  denoiseTolerance?: number
  /** How far an AO texel's depth may be from the pixel's in the upsample, × view distance. Default 0.02. */
  upsampleTolerance?: number
  /** The current frame's weight over a full history: lower is smoother and slower to settle. Default 0.1. */
  temporalAccumulationAlpha?: number
  /** How far a history texel's depth may be from the point's last-frame depth, × view distance. Default 0.005. */
  historyTolerance?: number
  /** How far the history may stray from the denoised AO, plus historyClampDeviation × its deviation. Default 0.01. */
  historyClamp?: number
  /** Widens the history clamp by this × the AO's temporal deviation. Default 3. */
  historyClampDeviation?: number
  /** How fast the history shortens where it strays past the clamp. Default 5. */
  historyDecay?: number
  /** How far past the clamp the history may stray before it shortens. Default 0.02. */
  historyDecayThreshold?: number
  /** Drawing-buffer px of reprojection per frame that halve the history's length. Default 2. */
  historyMotionSpeed?: number
  /** With changeDetection, the depth change that marks a moved occluder, × view distance. Default 0.01. */
  changeTolerance?: number
  /** With a velocity node, object motion below it counts as still, in drawing-buffer px per frame. Default 0.5. */
  motionThreshold?: number
  /** The current frame's weight where an occluder moved nearby. Default 0.8. */
  motionAccumulationAlpha?: number
  /** With motion vectors, the same where little of the kernel's reach moved, e.g. a thin occluder. Default 0.25. */
  sparseMotionAccumulationAlpha?: number
  /** With motion vectors, the moving share of the kernel's reach that takes motionAccumulationAlpha. Default 0.1. */
  denseChangeShare?: number
}

export declare class XeGTAONode extends Node<'float'> {
  /** @param depthNode A depth texture node, such as a pass's 'depth'. */
  constructor(depthNode: TextureNode, camera: PerspectiveCamera, options?: XeGTAONodeOptions)

  readonly depthNode: TextureNode
  /** View-space normals; null rebuilds them from depth. Rebuilds the shaders on change. Default null. */
  normalNode: TextureNode | SampleNode<'vec3'> | null
  /** The scene pass's velocity; null: the camera's motion alone. Rebuilds the shaders on change. Default null. */
  velocityNode: TextureNode | null

  /** Horizon slices per pixel. Rebuilds the shaders on change. Default 2. */
  sliceCount: number
  /** Steps per side of each slice. Rebuilds the shaders on change. Default 3. */
  stepsPerSlice: number
  /** The AO's resolution relative to the drawing buffer. Default 0.5. */
  resolutionScale: number
  /** The 4×4 denoise, which carries the temporal accumulation. Off shows the raw, dithered AO. Default true. */
  denoise: boolean
  /** Moves the sampling pattern every frame and blends each result over the reprojected history. Default true. */
  temporalAccumulation: boolean
  /** Shortens the history where an occluder moved in or out of the kernel's reach. Default true. */
  changeDetection: boolean
  /** With a velocity node, reprojects what moves on its own along its motion vectors. Default true. */
  motionVectors: boolean

  /** World units. Default 0.5. */
  get radius(): UniformNode<'float'>
  set radius(value: number)
  /** Blends from no occlusion (0) to full (1). Default 1. */
  get intensity(): UniformNode<'float'>
  set intensity(value: number)
  /** The visibility curve's exponent. Default 2.2. */
  get power(): UniformNode<'float'>
  set power(value: number)
  /** The outer share of the radius over which taps fade out. Default 0.615. */
  get falloffRange(): UniformNode<'float'>
  set falloffRange(value: number)
  /** 0 to 0.7: stretches the falloff along view Z, so thin objects occlude less. Default 0. */
  get thinOccluder(): UniformNode<'float'>
  set thinOccluder(value: number)
  /** Caps the radius on screen, in drawing-buffer px. Default 256. */
  get maxScreenRadius(): UniformNode<'float'>
  set maxScreenRadius(value: number)
  /** The view distance where the AO starts fading out. Default 100. */
  get fadeStart(): UniformNode<'float'>
  set fadeStart(value: number)
  /** The view distance where the AO is gone. Default 300. */
  get fadeEnd(): UniformNode<'float'>
  set fadeEnd(value: number)
  /** Step spacing along a slice, as a power: 2 clusters the taps near the center. Default 2. */
  get sampleDistributionPower(): UniformNode<'float'>
  set sampleDistributionPower(value: number)
  /** How far a denoise tap may sit off the center's plane, × view distance. Default 0.011. */
  get denoiseTolerance(): UniformNode<'float'>
  set denoiseTolerance(value: number)
  /** How far an AO texel's depth may be from the pixel's in the upsample, × view distance. Default 0.02. */
  get upsampleTolerance(): UniformNode<'float'>
  set upsampleTolerance(value: number)
  /** The current frame's weight over a full history: lower is smoother and slower to settle. Default 0.1. */
  get temporalAccumulationAlpha(): UniformNode<'float'>
  set temporalAccumulationAlpha(value: number)
  /** How far a history texel's depth may be from the point's last-frame depth, × view distance. Default 0.005. */
  get historyTolerance(): UniformNode<'float'>
  set historyTolerance(value: number)
  /** How far the history may stray from the denoised AO, plus historyClampDeviation × its deviation. Default 0.01. */
  get historyClamp(): UniformNode<'float'>
  set historyClamp(value: number)
  /** Widens the history clamp by this × the AO's temporal deviation. Default 3. */
  get historyClampDeviation(): UniformNode<'float'>
  set historyClampDeviation(value: number)
  /** How fast the history shortens where it strays past the clamp. Default 5. */
  get historyDecay(): UniformNode<'float'>
  set historyDecay(value: number)
  /** How far past the clamp the history may stray before it shortens. Default 0.02. */
  get historyDecayThreshold(): UniformNode<'float'>
  set historyDecayThreshold(value: number)
  /** Drawing-buffer px of reprojection per frame that halve the history's length. Default 2. */
  get historyMotionSpeed(): UniformNode<'float'>
  set historyMotionSpeed(value: number)
  /** With changeDetection, the depth change that marks a moved occluder, × view distance. Default 0.01. */
  get changeTolerance(): UniformNode<'float'>
  set changeTolerance(value: number)
  /** With a velocity node, object motion below it counts as still, in drawing-buffer px per frame. Default 0.5. */
  get motionThreshold(): UniformNode<'float'>
  set motionThreshold(value: number)
  /** The current frame's weight where an occluder moved nearby. Default 0.8. */
  get motionAccumulationAlpha(): UniformNode<'float'>
  set motionAccumulationAlpha(value: number)
  /** With motion vectors, the same where little of the kernel's reach moved, e.g. a thin occluder. Default 0.25. */
  get sparseMotionAccumulationAlpha(): UniformNode<'float'>
  set sparseMotionAccumulationAlpha(value: number)
  /** With motion vectors, the moving share of the kernel's reach that takes motionAccumulationAlpha. Default 0.1. */
  get denseChangeShare(): UniformNode<'float'>
  set denseChangeShare(value: number)

  /** R = AO, G = view distance, B = history length, A = variance, at AO resolution. Sample it; don't keep its value. */
  getTextureNode(): TextureNode
  /** The AO at full resolution, upsampled against the depth node. */
  getAONode(): Node<'float'>
  /** The AO at a material's own fragment, for builtinAOContext() on a pass other than the one whose depth it reads. */
  getMaterialAONode(): Node<'float'>
  /** Drops the history, e.g. after a camera cut. */
  resetHistory(): void
  /**
   * Compiles the node's passes ahead of their first frame. Await it before rendering: each pass's target stays bound
   * while it compiles. Optional.
   */
  compileAsync(renderer: Renderer): Promise<void>
}

export declare const xeGTAO: (
  depthNode: TextureNode,
  camera: PerspectiveCamera,
  options?: XeGTAONodeOptions,
) => XeGTAONode
