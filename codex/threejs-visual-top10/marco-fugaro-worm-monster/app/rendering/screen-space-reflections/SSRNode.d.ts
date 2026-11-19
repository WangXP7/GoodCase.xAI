// Screen-space reflections by Newton's method on the G-buffer, in place of the scene's environment specular:
//
//   const scenePass = pass(scene, camera, { samples: 0 })
//   scenePass.setMRT(mrt({ output, velocity, ...ssrGBuffer() }))   // keep velocity RG16F
//   const color = scenePass.getTextureNode()
//   const reflections = ssr(color, scenePass, { roughnessCutoff: 0.6, thickness: 0.2 })
//   renderPipeline.outputNode = ssrComposite(color, reflections, scene.environment)
//   await reflections.compileAsync(renderer) // optional: the passes' pipelines, ahead of time

import { Camera, Euler, Node, PassNode, Renderer, Texture, TextureNode, UniformNode } from 'three/webgpu'

/** The MRT outputs the node reads, to spread into the scene pass's `mrt()`. */
export type SSRGBuffer = {
  /** Octahedral flat and shading normals, view space (RGBA16F). */
  ssrNormals: Node<'vec4'>
  /** Linear view depth, 0 on the background (R16F). */
  ssrDepth: Node<'float'>
  /** `sqrt(F_env · T_fog)` and roughness (RGBA8); 0 on non-PBR materials. */
  ssrSpecular: Node<'vec4'>
}

export interface SSRNodeOptions {
  /** Prefix of every material, target and quad name. Default 'SSR'. */
  label?: string
  /** Screen velocity (NDC delta, RG16F); null: the camera alone. Default: the pass's 'velocity' if its MRT has one. */
  velocityNode?: TextureNode | null
  /** Octahedral flat and shading normals. Default: the pass's 'ssrNormals'. */
  normalsNode?: TextureNode
  /** Linear view depth. Default: the pass's 'ssrDepth'. */
  linearDepthNode?: TextureNode
  /** `sqrt(F_env · T_fog)` and roughness. Default: the pass's 'ssrSpecular'. */
  specularNode?: TextureNode
  /** Trace resolution relative to the G-buffer, 1 or 0.5; the resolve stays at full resolution. Default 1. */
  resolutionScale?: 1 | 0.5
  /** Probe loads per round trip: 1, 2 or 4. Default 4. */
  batch?: 1 | 2 | 4
  /** Colour pyramid levels for glossy lookups, 0–8 (0: mirror only). Default 5. */
  pyramidLevels?: number

  /** View-space ray length, m; Infinity: to the screen's edge. Default Infinity. */
  maxDistance?: number
  /** How far behind a surface a probe still crosses it, m, before the ray's own slope. Default 0.1. */
  thickness?: number
  /** px: the 1-px hit test's threshold, and the depth guard's slope allowance. Default 1. */
  hitTolerance?: number
  /** px: closer hits are self-hits. Default 2. */
  minDistance?: number
  /** px the ray origin moves along the flat normal. Default 1. */
  originOffset?: number
  /** Relative depth mismatch that rejects a reprojected seed. Default 0.03. */
  disocclusionThreshold?: number
  /** Cold probes at most, 2–8. Default 8. */
  probes?: number
  /** Guard probes before a seed, 0–3. Default 2. */
  guardProbes?: number
  /** Refine iterations per search at most, 0–6; a pixel runs up to 3 searches. Default 4. */
  iterations?: number
  /** Relative depth tolerance for "in front", and the depth guard's floor. Default 1e-3. */
  crossingEpsilon?: number
  /** `|dot(Ng, R)|` below which a Newton step falls back to regula falsi, 0–1. Default 0.05. */
  minDenominator?: number
  /** px step that counts as converged. Default 0.5. */
  convergePx?: number
  /** Minimum `dot(R, Ng)` at the origin, where normal maps bend R under the surface, 0–1. Default 0.02. */
  horizon?: number
  /** px: the largest step on an unbracketed path. Default 16. */
  trustRegion?: number
  /** Screen fraction over which hits fade out at the edges, 0–0.5. Default 0.05. */
  edgeFade?: number
  /** View-space `R.z` where rays toward the camera start fading, −1–1. Default 0.6. */
  cameraFadeStart?: number
  /** View-space `R.z` where rays toward the camera have faded out, −1–1. Default 0.9. */
  cameraFadeEnd?: number
  /** Roughness where reflections start fading to the environment. Default 0.2. */
  roughnessFadeStart?: number
  /** Roughness from which only the environment is used and pixels aren't traced. Default 0.4. */
  roughnessCutoff?: number
  /** Pixels whose `max(F)` is below this aren't traced. Default 0.004. */
  fresnelThreshold?: number
  /** Offset of the cone LOD, in pyramid levels. Default 0. */
  lodBias?: number
  /** At resolutionScale 0.5: plane distance, relative to depth, that reuses a neighbour's hit. Default 0.02. */
  upsampleTolerance?: number
  /** At resolutionScale 0.5: facet steps that polish each pixel's reused hit, 0–3. Default 3. */
  upsamplePolishSteps?: number

  /** Seeds from last frame's hits; off: every pixel traces cold. Default true. */
  temporalSeeding?: boolean
  /** Seeds from the 4 neighbours of the reprojected hit when its own fails. Default true. */
  neighbourSeeding?: boolean
  /** Jitters the probes per pixel and frame; off: deterministic. Default true. */
  jitter?: boolean
  /** Glossy lookups into the colour pyramid by roughness cone; off: mirror. Default true. */
  glossy?: boolean
}

/** The pixel's G-buffer values, when the caller has loaded them already. Default: loaded by the node. */
export interface SSRResolveOptions {
  spec?: Node<'vec4'> | null
  depth?: Node<'float'> | null
  normals?: Node<'vec4'> | null
}

export interface SSREnvironmentOptions {
  /** A number fixed at build, a function read each frame or a node. Default 1. */
  environmentIntensity?: number | (() => number) | Node<'float'>
  /** Read each frame, e.g. `scene.environmentRotation`. Default null. */
  environmentRotation?: Euler | null
}

export interface SSRCompositeOptions extends SSREnvironmentOptions {
  /** 'subtract': on the stock scene; 'add': on a scene rendered without environment specular. Default 'subtract'. */
  mode?: 'subtract' | 'add'
}

/**
 * `(L_ssr, c)` at the fragment's G-buffer texel: the reflected radiance and its confidence.
 *
 * Changing `normalsNode`, `linearDepthNode`, `specularNode`, `resolutionScale` or `pyramidLevels` changes what the
 * node, `resolve()`, `ssrComposite()` and `ssrEnvironmentSpecular()` compile to: rebuild the output graph after
 * changing them (`renderPipeline.needsUpdate = true`). `getTextureNode()` follows on its own.
 */
export declare class SSRNode extends Node<'vec4'> {
  /**
   * @param colorNode Scene radiance at the G-buffer's resolution, such as the jittered pass output.
   * @param gBufferPass The pass whose MRT spreads `ssrGBuffer()`, with `samples: 0`.
   */
  constructor(colorNode: TextureNode, gBufferPass: PassNode, options?: SSRNodeOptions)

  readonly isSSRNode: true

  readonly colorNode: TextureNode
  readonly gBufferPass: PassNode
  /** The G-buffer pass's camera. */
  readonly camera: Camera
  /** Whether the G-buffer inputs are missing: the output is then vec4(0) and nothing runs. */
  readonly inert: boolean

  // `label` is a string property too, left untyped: three's types declare TSL's label() method under that name.

  /** Screen velocity; null: the camera alone. Setting undefined restores the pass's 'velocity'. Rebuilds the trace. */
  get velocityNode(): TextureNode | null
  set velocityNode(value: TextureNode | null | undefined)
  /** null while the node is inert. Setting undefined restores the pass's 'ssrNormals'. Rebuild the output graph. */
  get normalsNode(): TextureNode | null
  set normalsNode(value: TextureNode | undefined)
  /** null while the node is inert. Setting undefined restores the pass's 'ssrDepth'. Rebuild the output graph. */
  get linearDepthNode(): TextureNode | null
  set linearDepthNode(value: TextureNode | undefined)
  /** null while the node is inert. Setting undefined restores the pass's 'ssrSpecular'. Rebuild the output graph. */
  get specularNode(): TextureNode | null
  set specularNode(value: TextureNode | undefined)

  /** Trace resolution relative to the G-buffer, 1 or 0.5. Resets the history; rebuild the output graph. Default 1. */
  resolutionScale: 1 | 0.5
  /** Probe loads per round trip: 1, 2 or 4. Rebuilds the trace. Default 4. */
  batch: 1 | 2 | 4
  /** Colour pyramid levels for glossy lookups, 0–8 (0: mirror only). Rebuild the output graph. Default 5. */
  pyramidLevels: number

  // Each setting reads as its uniform and takes a number, clamped to its range.

  /** View-space ray length, m; Infinity: to the screen's edge. Default Infinity. */
  get maxDistance(): UniformNode<'float'>
  set maxDistance(value: number)
  /** How far behind a surface a probe still crosses it, m, before the ray's own slope. Default 0.1. */
  get thickness(): UniformNode<'float'>
  set thickness(value: number)
  /** px: the 1-px hit test's threshold, and the depth guard's slope allowance. Default 1. */
  get hitTolerance(): UniformNode<'float'>
  set hitTolerance(value: number)
  /** px: closer hits are self-hits. Default 2. */
  get minDistance(): UniformNode<'float'>
  set minDistance(value: number)
  /** px the ray origin moves along the flat normal. Default 1. */
  get originOffset(): UniformNode<'float'>
  set originOffset(value: number)
  /** Relative depth mismatch that rejects a reprojected seed. Default 0.03. */
  get disocclusionThreshold(): UniformNode<'float'>
  set disocclusionThreshold(value: number)
  /** Cold probes at most, 2–8. Default 8. */
  get probes(): UniformNode<'int'>
  set probes(value: number)
  /** Guard probes before a seed, 0–3. Default 2. */
  get guardProbes(): UniformNode<'int'>
  set guardProbes(value: number)
  /** Refine iterations per search at most, 0–6; a pixel runs up to 3 searches. Default 4. */
  get iterations(): UniformNode<'int'>
  set iterations(value: number)
  /** Relative depth tolerance for "in front", and the depth guard's floor. Default 1e-3. */
  get crossingEpsilon(): UniformNode<'float'>
  set crossingEpsilon(value: number)
  /** `|dot(Ng, R)|` below which a Newton step falls back to regula falsi, 0–1. Default 0.05. */
  get minDenominator(): UniformNode<'float'>
  set minDenominator(value: number)
  /** px step that counts as converged. Default 0.5. */
  get convergePx(): UniformNode<'float'>
  set convergePx(value: number)
  /** Minimum `dot(R, Ng)` at the origin, where normal maps bend R under the surface, 0–1. Default 0.02. */
  get horizon(): UniformNode<'float'>
  set horizon(value: number)
  /** px: the largest step on an unbracketed path. Default 16. */
  get trustRegion(): UniformNode<'float'>
  set trustRegion(value: number)
  /** Screen fraction over which hits fade out at the edges, 0–0.5. Default 0.05. */
  get edgeFade(): UniformNode<'float'>
  set edgeFade(value: number)
  /** View-space `R.z` where rays toward the camera start fading, −1–1. Default 0.6. */
  get cameraFadeStart(): UniformNode<'float'>
  set cameraFadeStart(value: number)
  /** View-space `R.z` where rays toward the camera have faded out, −1–1. Default 0.9. */
  get cameraFadeEnd(): UniformNode<'float'>
  set cameraFadeEnd(value: number)
  /** Roughness where reflections start fading to the environment. Default 0.2. */
  get roughnessFadeStart(): UniformNode<'float'>
  set roughnessFadeStart(value: number)
  /** Roughness from which only the environment is used and pixels aren't traced. Default 0.4. */
  get roughnessCutoff(): UniformNode<'float'>
  set roughnessCutoff(value: number)
  /** Pixels whose `max(F)` is below this aren't traced. Default 0.004. */
  get fresnelThreshold(): UniformNode<'float'>
  set fresnelThreshold(value: number)
  /** Offset of the cone LOD, in pyramid levels. Default 0. */
  get lodBias(): UniformNode<'float'>
  set lodBias(value: number)
  /** At resolutionScale 0.5: plane distance, relative to depth, that reuses a neighbour's hit. Default 0.02. */
  get upsampleTolerance(): UniformNode<'float'>
  set upsampleTolerance(value: number)
  /** At resolutionScale 0.5: facet steps that polish each pixel's reused hit, 0–3. Default 3. */
  get upsamplePolishSteps(): UniformNode<'int'>
  set upsamplePolishSteps(value: number)

  /** Seeds from last frame's hits; off: every pixel traces cold. Default true. */
  temporalSeeding: boolean
  /** Seeds from the 4 neighbours of the reprojected hit when its own fails. Default true. */
  neighbourSeeding: boolean
  /** Jitters the probes per pixel and frame; off: deterministic. Default true. */
  jitter: boolean
  /** Glossy lookups into the colour pyramid by roughness cone; off: mirror. Default true. */
  glossy: boolean

  /** `(L_ssr, c)` at G-buffer pixel `p`, an integer-valued vec2. */
  resolve(p: Node<'vec2'>, options?: SSRResolveOptions): Node<'vec4'>
  /** A full-resolution `(L_ssr, c)` texture to sample at any uv. */
  getTextureNode(): TextureNode
  /** `vec4(F·L_env, 1)` at the fragment: the environment specular `ssrComposite()` replaces. */
  getEnvironmentSpecularNode(environment: Texture | null, options?: SSREnvironmentOptions): Node<'vec4'>
  /** The same as `ssrComposite(colorNode, this, environment, options)`. */
  getCompositeNode(colorNode: TextureNode, environment: Texture | null, options?: SSRCompositeOptions): Node<'vec4'>
  /** Drops the history, e.g. after a camera cut or frames that rendered the G-buffer without the node. */
  resetHistory(): void
  /**
   * Compiles the node's passes ahead of their first frame. Await it before rendering: each pass's target stays bound
   * while it compiles. Optional.
   */
  compileAsync(renderer: Renderer): Promise<void>
}

export declare function ssrGBuffer(): SSRGBuffer

export declare const ssr: (colorNode: TextureNode, gBufferPass: PassNode, options?: SSRNodeOptions) => SSRNode

/**
 * The scene with its environment specular replaced by `mix(L_env, L_ssr, c)` on reflective pixels.
 * @param environment The materials' environment, read at build (`scene.environment`); null: none.
 */
export declare const ssrComposite: (
  colorNode: TextureNode,
  ssrNode: SSRNode,
  environment: Texture | null,
  options?: SSRCompositeOptions,
) => Node<'vec4'>

/** `vec4(F·L_env, 1)`: the environment specular of the stock scene, as `ssrComposite()` subtracts it. */
export declare const ssrEnvironmentSpecular: (
  ssrNode: SSRNode,
  environment: Texture | null,
  options?: SSREnvironmentOptions,
) => Node<'vec4'>
