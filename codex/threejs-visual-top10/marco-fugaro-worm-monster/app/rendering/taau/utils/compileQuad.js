/**
 * compileQuad - creates a fullscreen pass's pipeline ahead of its first draw, as `QuadMesh.render()` draws it
 *
 *   await compileQuad(renderer, quad, material, target)      // the pass quad.render() draws into target
 *   await compileQuad(renderer, quad, material, target, 2)   // into mip 2 of target
 *
 * three's `renderer.compileAsync()` calls mustn't overlap, so every compileQuad() queues on the renderer, whichever
 * technique calls it: await any other compileAsync() (a PassNode's) before or after them, not alongside. Each pass
 * compiles with `target` bound in the state `RendererUtils.resetRendererState()` leaves (MRT null), which three reads
 * while it builds the shaders: the renderer gets its own state back once the pass has compiled, so render nothing
 * meanwhile. The material keeps the quad's fullscreen vertex node until then too.
 */
import { RendererUtils } from 'three/webgpu'

// One queue per renderer, shared by every copy of this module.
const QUEUE = Symbol.for('three-advanced-techniques.compileQuad')

export function compileQuad(renderer, quad, material, target, mip = 0) {
  const run = (renderer[QUEUE] ?? Promise.resolve()).then(() => {
    quad.material = material
    // QuadMesh.render() swaps in its own vertex node, and the draw's cache key hashes it: borrow that node
    let vertexNode = null
    quad.render({ render: (mesh) => (vertexNode = mesh.material.vertexNode) })
    const previousVertexNode = material.vertexNode
    material.vertexNode = vertexNode
    const state = RendererUtils.resetRendererState(renderer)
    const { depth, stencil } = renderer
    renderer.setRenderTarget(target, 0, mip)
    // a render takes depth and stencil from its target, compileAsync() from the renderer
    renderer.depth = target.depthBuffer
    renderer.stencil = target.stencilBuffer
    const restore = () => {
      material.vertexNode = previousVertexNode
      renderer.depth = depth
      renderer.stencil = stencil
      RendererUtils.restoreRendererState(renderer, state)
    }
    let compiled
    try {
      compiled = renderer.compileAsync(quad, quad.camera)
    } catch (error) {
      restore()
      throw error
    }
    // the shader builds read the bound target (its formats pick the output type) until the compile settles
    return compiled.finally(restore)
  })
  renderer[QUEUE] = run.catch(() => {})
  return run
}
