// Tile-based object and camera motion blur, read from a fullscreen pass:
//
//   const scenePass = pass(scene, camera)
//   scenePass.setMRT(mrt({ output, velocity }))
//   const blurred = motionBlur(scenePass.getTextureNode('output'), scenePass.getTextureNode('depth'), camera, {
//     velocityNode: scenePass.getTextureNode('velocity'), // omit: camera motion only
//     shutterAngle: 180,
//   })
//   renderPipeline.outputNode = blurred

import { Camera, Node, Renderer, TextureNode, UniformNode } from 'three/webgpu'

export interface MotionBlurNodeOptions {
  /** three's velocity MRT, `pass.getTextureNode('velocity')`; null blurs camera motion only. Default null. */
  velocityNode?: TextureNode | null
  /** The gather's resolution relative to the depth's. Default 1. */
  resolutionScale?: 1 | 0.5
  /** Degrees of the frame the shutter is open: 180 blurs half the frame's motion. Default 180. */
  shutterAngle?: number
  /** 0: exposes shutterAngle / 360 of each frame; N > 0: a fixed exposure of shutterAngle / 360 / N s. Default 0. */
  targetFrameRate?: number
  /** Seconds the rendered motion spans (frame caps, captures); null measures the gap between frames. Default null. */
  deltaTime?: number | null
  /** Largest blur radius (half a streak) as a fraction of the frame's height, at most 8 tiles. Default 0.05. */
  maxBlurRadius?: number
  /** Seconds: a longer gap between frames is a cut, with no blur that frame. Default 0.25. */
  maxFrameGap?: number
  /** 'animated' changes the noise every frame, for a temporal filter after the blur. Default 'static'. */
  noise?: 'static' | 'animated'
  /** Odd tap pairs follow the pixel's own velocity in mixed neighbourhoods. Default true. */
  alternateDirection?: boolean
  /** Radians per frame: a larger camera turn in one frame is a cut. Default Math.PI / 4. */
  cutRotation?: number
  /** World units per frame: a longer camera move in one frame is a cut; 0 turns the rule off. Default 0. */
  cutTranslation?: number
  /** Scale of object motion (the velocity MRT minus the camera's). Default 1. */
  objectAmount?: number
  /** Scale of the camera's rotation and zoom motion. Default 1. */
  cameraRotationAmount?: number
  /** Scale of the camera's translation (parallax) motion. Default 1. */
  cameraTranslationAmount?: number
  /** Full-resolution px per frame below which object motion fades out, when the amounts differ. Default 0.5. */
  objectDeadZone?: number
  /** Full-resolution px of radius below which a neighbourhood skips the gather. Default 0.5. */
  minVelocity?: number
  /** The most taps per pixel, 2 to 64. Default 16. */
  samples?: number
  /** Full-resolution px between taps, at least 0.25. Default 2. */
  sampleSpacing?: number
  /** Relative depth band of the foreground/background compare, at least 1e-3. Default 0.05. */
  depthSoftness?: number
  /** Smallest-to-largest speed ratio a neighbourhood needs for the fast path; above 1: never. Default 0.75. */
  fastPathRatio?: number
  /** Direction coherence |Σv| / Σ|v| the fast path needs; above 1 disables it. Default 0.95. */
  fastPathCoherence?: number
  /** Depth range zmax / zmin − 1 below which the fast path ignores the speed ratio; 0: off. Default 0. */
  fastPathDepthRange?: number
  /** Tiles of random offset in the slow path's neighbourhood lookup, hiding tile seams. Default 0.25. */
  tileJitter?: number
}

export declare class MotionBlurNode extends Node<'vec4'> {
  /**
   * @param colorNode The HDR scene colour: a texture node, or any node (rendered to a texture first).
   * @param depthNode The scene depth, `pass.getTextureNode('depth')`, not logarithmic.
   * @param camera The camera the scene is rendered with; camera blur needs a perspective one.
   */
  constructor(colorNode: Node, depthNode: TextureNode, camera: Camera, options?: MotionBlurNodeOptions)

  readonly isMotionBlurNode: true

  /** The colour the blur reads, as a texture node. */
  readonly colorNode: TextureNode
  readonly depthNode: TextureNode
  readonly camera: Camera

  /** three's velocity MRT, or null for camera motion only. Rebuilds the compute passes on change. Default null. */
  velocityNode: TextureNode | null
  /**
   * The gather's resolution relative to the depth's. Rebuilds the compute passes; rebuild the output graph after
   * changing it (`renderPipeline.needsUpdate = true`). Default 1.
   */
  resolutionScale: 1 | 0.5

  /** Degrees of the frame the shutter is open: 180 blurs half the frame's motion. Default 180. */
  shutterAngle: number
  /** 0: exposes shutterAngle / 360 of each frame; N > 0: a fixed exposure of shutterAngle / 360 / N s. Default 0. */
  targetFrameRate: number
  /** Seconds the rendered motion spans (frame caps, captures); null measures the gap between frames. Default null. */
  deltaTime: number | null
  /** Largest blur radius (half a streak) as a fraction of the frame's height, at most 8 tiles. Default 0.05. */
  maxBlurRadius: number
  /** Seconds: a longer gap between frames is a cut, with no blur that frame. Default 0.25. */
  maxFrameGap: number
  /** 'animated' changes the noise every frame, for a temporal filter after the blur. Default 'static'. */
  noise: 'static' | 'animated'
  /** Odd tap pairs follow the pixel's own velocity in mixed neighbourhoods. Default true. */
  alternateDirection: boolean
  /** Radians per frame: a larger camera turn in one frame is a cut. Default Math.PI / 4. */
  cutRotation: number
  /** World units per frame: a longer camera move in one frame is a cut; 0 turns the rule off. Default 0. */
  cutTranslation: number

  /** This frame's streak as a fraction of the frame's motion; 0 on a cut. */
  readonly shutterScale: number

  // Each numeric setting reads as its uniform and takes a number, clamped to its range.

  /** Scale of object motion (the velocity MRT minus the camera's). Default 1. */
  get objectAmount(): UniformNode<'float'>
  set objectAmount(value: number)
  /** Scale of the camera's rotation and zoom motion. Default 1. */
  get cameraRotationAmount(): UniformNode<'float'>
  set cameraRotationAmount(value: number)
  /** Scale of the camera's translation (parallax) motion. Default 1. */
  get cameraTranslationAmount(): UniformNode<'float'>
  set cameraTranslationAmount(value: number)
  /** Full-resolution px per frame below which object motion fades out, when the amounts differ. Default 0.5. */
  get objectDeadZone(): UniformNode<'float'>
  set objectDeadZone(value: number)
  /** Full-resolution px of radius below which a neighbourhood skips the gather. Default 0.5. */
  get minVelocity(): UniformNode<'float'>
  set minVelocity(value: number)
  /** The most taps per pixel, 2 to 64. Default 16. */
  get samples(): UniformNode<'int'>
  set samples(value: number)
  /** Full-resolution px between taps, at least 0.25. Default 2. */
  get sampleSpacing(): UniformNode<'float'>
  set sampleSpacing(value: number)
  /** Relative depth band of the foreground/background compare, at least 1e-3. Default 0.05. */
  get depthSoftness(): UniformNode<'float'>
  set depthSoftness(value: number)
  /** Smallest-to-largest speed ratio a neighbourhood needs for the fast path; above 1: never. Default 0.75. */
  get fastPathRatio(): UniformNode<'float'>
  set fastPathRatio(value: number)
  /** Direction coherence |Σv| / Σ|v| the fast path needs; above 1 disables it. Default 0.95. */
  get fastPathCoherence(): UniformNode<'float'>
  set fastPathCoherence(value: number)
  /** Depth range zmax / zmin − 1 below which the fast path ignores the speed ratio; 0: off. Default 0. */
  get fastPathDepthRange(): UniformNode<'float'>
  set fastPathDepthRange(value: number)
  /** Tiles of random offset in the slow path's neighbourhood lookup, hiding tile seams. Default 0.25. */
  get tileJitter(): UniformNode<'float'>
  set tileJitter(value: number)

  /** Makes the next frame a cut. Call on teleports, camera switches and re-entering an output graph. */
  resetHistory(): void
  /** Compiles the compute passes ahead of the next frame; frames meanwhile pass the input through. */
  compileAsync(renderer: Renderer): Promise<void>
}

/** Tile-based object and camera motion blur; not three's `motionBlur(input, velocity)`. */
export declare const motionBlur: (
  colorNode: Node,
  depthNode: TextureNode,
  camera: Camera,
  options?: MotionBlurNodeOptions,
) => MotionBlurNode
