// Bloom in 8 passes with the look of three's `bloom()`, on a texture node:
//
//   const sceneColor = scenePass.getTextureNode()
//   const bloomNode = bloom(sceneColor, { strength: 1, radius: 0.5, threshold: 0.8 })
//   renderPipeline.outputNode = sceneColor.add(bloomNode)
//   await bloomNode.compileAsync(renderer) // optional: compiles the passes ahead of the first frame

import { Node, Renderer, TextureNode, UniformNode, Vector3 } from 'three/webgpu'

/** Inputs of a high pass, called for each blur tap. */
export type BloomHighPassParams = {
  input: Node<'vec4'>
  threshold: UniformNode<'float'>
  smoothWidth: UniformNode<'float'>
}

export interface BloomNodeOptions {
  /** Scales the bloom. Default 1. */
  strength?: number
  /** Blends the mips from tight to wide, in [0, 1]. Default 0. */
  radius?: number
  /** Luminance above which pixels glow. Default 0. */
  threshold?: number
  /** Width of the threshold's soft edge. Default 0.01. */
  smoothWidth?: number
  /** Internal resolution relative to the drawing buffer. Default 0.5. */
  resolutionScale?: number
  /** The high pass on each of mip0's blur taps, e.g. for anamorphic looks. Default: a smoothstep on luminance. */
  highPassFn?: (params: BloomHighPassParams) => Node<'vec4'>
  /** Per-mip tint, tight to wide: five vectors, copied in. Default white. */
  bloomTintColors?: Vector3[]
}

export declare class BloomNode extends Node<'vec4'> {
  /** @param inputNode A texture node, such as a pass output. */
  constructor(inputNode: TextureNode, options?: BloomNodeOptions)

  /** The texture the bloom samples. */
  inputNode: TextureNode

  /** Scales the bloom. Default 1. */
  get strength(): UniformNode<'float'>
  set strength(value: number)
  /** Blends the mips from tight to wide, in [0, 1]. Default 0. */
  get radius(): UniformNode<'float'>
  set radius(value: number)
  /** Luminance above which pixels glow. Default 0. */
  get threshold(): UniformNode<'float'>
  set threshold(value: number)
  /** Width of the threshold's soft edge. Default 0.01. */
  get smoothWidth(): UniformNode<'float'>
  set smoothWidth(value: number)
  /** Internal resolution relative to the drawing buffer. Default 0.5. */
  resolutionScale: number
  /** The high pass on each of mip0's blur taps, e.g. for anamorphic looks. Rebuilds it on the next frame. */
  highPassFn: (params: BloomHighPassParams) => Node<'vec4'>
  /** Per-mip tint, tight to wide. Mutate the vectors, or assign five to copy them in. Default white. */
  bloomTintColors: Vector3[]

  /** The composited bloom as a texture node. */
  getTextureNode(): TextureNode
  /**
   * Compiles the node's passes ahead of their first frame. Await it before rendering: each pass's target stays bound
   * while it compiles. Optional.
   */
  compileAsync(renderer: Renderer): Promise<void>
}

export declare const bloom: (node: TextureNode, options?: BloomNodeOptions) => BloomNode

export default BloomNode
