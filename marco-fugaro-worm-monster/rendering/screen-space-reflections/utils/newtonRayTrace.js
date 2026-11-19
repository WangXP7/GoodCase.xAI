/**
 * newtonRayTrace - the screen-space ray tracer core of SSRNode, as TSL helpers
 *
 * Every function emits TSL into the current `Fn` stack and takes its per-frame values as nodes, so a reflection or
 * refraction shader can reuse it on any G-buffer. The G-buffer is view space: a linear view depth texture
 * (`−positionView.z`, 0 = background) and an RGBA16F normals texture holding the octahedral flat (triangle) normal in
 * `xy` and the octahedral shading normal in `zw`.
 *
 *   const camera = { perspective: true, projection, near, far }        // projection: vec4 (pe0, pe5, pe8, pe9)
 *   const gBuffer = { depthNode, normalsNode, resolution }             // texture nodes, vec2 size in px
 *   const ray = reflectionRay(camera, gBuffer, { uv, depth, normals, horizon, originOffset })
 *   const segment = clipScreenRay({ origin: ray.origin, direction: ray.direction, camera, gBuffer, maxDistance,
 *     minDistancePx, originDepth: depth })
 *   const result = traceNewton({ segment, origin: ray.origin, direction: ray.direction, originUV: uv, seed: null,
 *     gBuffer, camera, settings, xi })                                 // { hit, s, sOut, uv, reason, path, … }
 *
 * `camera.projection` is (pe[0], pe[5], pe[8], pe[9]) of a perspective projection matrix, or (pe[0], pe[5], pe[12],
 * pe[13]) of an orthographic one, with `pe = projectionMatrix.elements` (jittered, as the G-buffer was rendered).
 * Rays are parameterised by their view-space length `s`; a segment also maps a screen-linear `t ∈ [0, 1]` along the
 * unclipped segment. Every texture read is a clamped `.load()`: no implicit-LOD sample inside a loop.
 *
 * A refraction caller passes `direction = refract(V, N, 1 / ior)`, its own seed, and `frontFacing: false` where exit
 * faces are wanted.
 */
import {
  abs,
  bool,
  ceil,
  clamp,
  dot,
  float,
  floor,
  If,
  int,
  ivec2,
  length,
  Loop,
  Break,
  max,
  min,
  mix,
  normalize,
  pow,
  reflect,
  select,
  sqrt,
  log2,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'

/** The depth given to background texels: infinitely far for the probes. */
export const BIG = 65504

/** Loop bounds baked into the shaders (the counts themselves are uniforms): probes, guard probes, iterations. */
export const K_MAX = 8
export const G_MAX = 3
export const ITERS_MAX = 6

/** Reason codes of a traced pixel. */
export const REASON = {
  HIT: 0,
  NO_CROSSING: 1,
  NOT_CONVERGED: 2,
  BACK_FACE: 3,
  SELF_HIT: 4,
  OFF_SCREEN: 5,
  BACKGROUND: 6,
}

/** Path codes: how the search started. */
export const PATH = { SKIPPED: 0, COLD: 1, OWN_SEED: 2, NEIGHBOUR_SEED: 3, UNCONVERGED_SEED: 4 }

/** Seed kinds (path − 1). */
export const SEED = { NONE: 0, OWN: 1, NEIGHBOUR: 2, UNCONVERGED: 3 }

// ── Encodings ───────────────────────────────────────────────────────

/** Octahedral encoding of a unit vector into [−1, 1]² (Cigolle et al. 2014). */
export function octEncode(n) {
  const a = n.div(abs(n.x).add(abs(n.y)).add(abs(n.z)))
  const signs = vec2(select(a.x.greaterThanEqual(0), 1, -1), select(a.y.greaterThanEqual(0), 1, -1))
  const folded = vec2(1).sub(abs(a.yx)).mul(signs)
  return select(a.z.greaterThanEqual(0), a.xy, folded)
}

/** Inverse of octEncode. */
export function octDecode(e) {
  const z = float(1).sub(abs(e.x)).sub(abs(e.y))
  const t = max(z.negate(), 0)
  const x = e.x.add(select(e.x.greaterThanEqual(0), t.negate(), t))
  const y = e.y.add(select(e.y.greaterThanEqual(0), t.negate(), t))
  return normalize(vec3(x, y, z))
}

// ── Projection ──────────────────────────────────────────────────────

/** The view-space point at linear depth `d` on the view ray through `uv` (origin top-left). */
export function viewFromUV(camera, uv, d) {
  const pe = camera.projection
  const ndc = vec2(uv.x.mul(2).sub(1), float(1).sub(uv.y.mul(2)))
  if (camera.perspective) {
    return vec3(ndc.x.add(pe.z).mul(d).div(pe.x), ndc.y.add(pe.w).mul(d).div(pe.y), d.negate())
  }
  return vec3(ndc.x.sub(pe.z).div(pe.x), ndc.y.sub(pe.w).div(pe.y), d.negate())
}

/** The uv a view-space point projects to. */
export function uvFromView(camera, p) {
  const pe = camera.projection
  if (camera.perspective) {
    const w = max(p.z.negate(), 1e-20)
    return vec2(
      pe.x.mul(p.x).add(pe.z.mul(p.z)).div(w).mul(0.5).add(0.5),
      float(0.5).sub(pe.y.mul(p.y).add(pe.w.mul(p.z)).div(w).mul(0.5)),
    )
  }
  return vec2(pe.x.mul(p.x).add(pe.z).mul(0.5).add(0.5), float(0.5).sub(pe.y.mul(p.y).add(pe.w).mul(0.5)))
}

/** View units per px at depth 1 (perspective) or at any depth (orthographic). */
export function pixelAngle(camera, resolution) {
  return float(2).div(camera.projection.y.mul(resolution.y))
}

/** `N` turned to face the camera at `P`: exact for a rasterised flat normal. */
export function orient(camera, N, P) {
  if (camera.perspective) return select(dot(N, P).greaterThan(0), N.negate(), N)
  return select(N.z.lessThan(0), N.negate(), N)
}

// ── Texels and facets ───────────────────────────────────────────────

/** The texel (integer-valued vec2) under `uv`, clamped to the texture. */
export function texelOf(gBuffer, uv) {
  return clamp(floor(uv.mul(gBuffer.resolution)), vec2(0), gBuffer.resolution.sub(1))
}

/** A texel's centre uv. */
export function texelCentre(gBuffer, tx) {
  return tx.add(0.5).div(gBuffer.resolution)
}

/** Whether two texels differ. */
export function otherTexel(a, b) {
  return a.x.notEqual(b.x).or(a.y.notEqual(b.y))
}

/** Linear depth at `uv`; background reads BIG. */
export function depthAt(gBuffer, uv) {
  const d = gBuffer.depthNode.load(ivec2(texelOf(gBuffer, uv))).r
  return select(d.greaterThan(0), d, float(BIG))
}

/** The facet of the texel under `uv`: { Ng (camera-facing flat normal), Pc (texel-centre point), d, tx }. */
export function planeAt(camera, gBuffer, uv) {
  const tx = texelOf(gBuffer, uv).toVar()
  return planeOfTexel(camera, gBuffer, tx)
}

/** The facet of texel `tx`, with its two loads. */
export function planeOfTexel(camera, gBuffer, tx, depth = null, normals = null) {
  const d = (depth ?? gBuffer.depthNode.load(ivec2(tx)).r).toVar()
  const e = normals ?? gBuffer.normalsNode.load(ivec2(tx))
  const Pc = viewFromUV(camera, texelCentre(gBuffer, tx), d).toVar()
  const Ng = orient(camera, octDecode(e.xy), Pc).toVar()
  return { Ng, Pc, d, tx }
}

/** Mutable plane variables, for loops. */
export function planeVar(plane = null) {
  return {
    Ng: (plane ? plane.Ng : vec3(0, 0, 1)).toVar(),
    Pc: (plane ? plane.Pc : vec3(0)).toVar(),
    d: (plane ? plane.d : float(0)).toVar(),
    tx: (plane ? plane.tx : vec2(-1)).toVar(),
  }
}

/** Assigns a plane to plane variables. */
export function assignPlane(target, plane) {
  target.Ng.assign(plane.Ng)
  target.Pc.assign(plane.Pc)
  target.d.assign(plane.d)
  target.tx.assign(plane.tx)
}

/** The depth where `uv`'s view ray meets the facet (the facet's own depth when they are parallel). */
export function facetDepth(camera, uv, plane) {
  if (camera.perspective) {
    const rayD = viewFromUV(camera, uv, float(1))
    const dn = dot(plane.Ng, rayD)
    return select(abs(dn).greaterThan(1e-4), dot(plane.Ng, plane.Pc).div(dn), plane.d)
  }
  const rayO = viewFromUV(camera, uv, float(0))
  const dn = plane.Ng.z.negate()
  return select(abs(dn).greaterThan(1e-4), dot(plane.Ng, plane.Pc.sub(rayO)).div(dn), plane.d)
}

/** g(s) against a facet: ray depth minus facet depth on the same view ray; > 0 behind, −BIG on the background. */
export function gFacet(camera, s, plane, origin, direction) {
  const x = origin.add(direction.mul(s))
  return select(plane.d.greaterThan(0), x.z.negate().sub(facetDepth(camera, uvFromView(camera, x), plane)), -BIG)
}

// ── Rays ────────────────────────────────────────────────────────────

/** `R` lifted toward the facet normal `Ng` to at least `horizon` above the facet. */
export function liftAboveHorizon(R, Ng, horizon) {
  const h = dot(R, Ng).toVar()
  return select(h.lessThan(horizon), normalize(R.add(Ng.mul(horizon.sub(h)))), R)
}

/**
 * The reflection ray of a G-buffer texel: { position, view, flatNormal, normal, direction, origin }. `uv` is the
 * texel's centre, `depth` its linear depth, `normals` its RGBA16F normals texel. The direction is lifted to at least
 * `horizon` above the flat normal; the origin moves `originOffset` px of footprint along it.
 */
export function reflectionRay(camera, gBuffer, { uv, depth, normals, horizon, originOffset }) {
  const P0 = viewFromUV(camera, uv, depth).toVar()
  const V = camera.perspective ? normalize(P0) : vec3(0, 0, -1)
  const Ng0 = orient(camera, octDecode(normals.xy), P0).toVar()
  const Ns = octDecode(normals.zw).toVar()
  const R = liftAboveHorizon(reflect(V, Ns), Ng0, horizon).toVar()
  const footprint = pixelAngle(camera, gBuffer.resolution).mul(camera.perspective ? depth : float(1))
  const O = P0.add(Ng0.mul(originOffset.mul(footprint))).toVar()
  return { position: P0, view: V, flatNormal: Ng0, normal: Ns, direction: R, origin: O }
}

/** Tangent of the half-angle of a roughness's specular cone (Phong-equivalent lobe, Uludag 2014). */
export function coneTangent(roughness) {
  const a = roughness.mul(roughness)
  const n = float(2)
    .div(max(a.mul(a), 1e-8))
    .sub(2)
  const cosT = pow(float(0.244), float(1).div(n.add(1)))
  return sqrt(max(float(1).sub(cosT.mul(cosT)), 0)).div(cosT)
}

/** Pyramid LOD of a cone of half-angle tangent `tanTheta` after `s`, seen at `hitDepth`: log2 of its px diameter. */
export function coneLOD({ s, tanTheta, hitDepth, pxAngle, perspective, bias, levels }) {
  const footPx = s
    .mul(2)
    .mul(tanTheta)
    .div(pxAngle.mul(perspective ? max(hitDepth, 1e-6) : float(1)))
  return clamp(log2(max(footPx, 1)).add(bias), 0, levels)
}

// ── Segment ─────────────────────────────────────────────────────────

/**
 * Clips the ray to the near and far planes, `maxDistance` and the screen (½ texel inside), and returns the maps of
 * the unclipped segment: `uvOf(t)`, `dRayOf(t)`, `sOf(t)`, `tOfS(s)`, `uvAtS(s)`, plus `lenPx` (px per unit t),
 * `tLo`, `tHi`, `sLo`, `sHi`, `Lpx` (clipped px) and `valid`.
 */
export function clipScreenRay({ origin: O, direction: R, camera, gBuffer, maxDistance, minDistancePx, originDepth }) {
  const persp = camera.perspective
  const sEnd0 = min(maxDistance, float(1e6).mul(max(originDepth, 1))).toVar()
  // every ray toward the camera ends before the near plane, however small R.z
  const nearT = camera.near.mul(-1.001).sub(O.z).div(max(R.z, 1e-30))
  sEnd0.assign(select(R.z.greaterThan(0), min(sEnd0, nearT), sEnd0))
  const farT = camera.far
    .negate()
    .sub(O.z)
    .div(select(R.z.lessThan(-1e-5), R.z, -1))
  sEnd0.assign(select(R.z.lessThan(-1e-5), min(sEnd0, farT), sEnd0))
  const E0 = O.add(R.mul(sEnd0)).toVar()
  const uvO = uvFromView(camera, O).toVar()
  const dUV = uvFromView(camera, E0).sub(uvO).toVar()
  const k0 = persp ? float(1).div(O.z.negate()).toVar() : float(1)
  const kE0 = persp ? float(1).div(E0.z.negate()).toVar() : float(1)

  // Liang–Barsky against [½ texel, 1 − ½ texel]², entry and exit
  const lo = gBuffer.resolution.reciprocal().mul(0.5)
  const hi = vec2(1).sub(lo)
  const tIn = float(0).toVar()
  const tOut = float(1).toVar()
  for (const a of ['x', 'y']) {
    const d = dUV[a]
    const parallel = abs(d).lessThanEqual(1e-9)
    const dSafe = select(parallel, float(1), d)
    const t0 = lo[a].sub(uvO[a]).div(dSafe)
    const t1 = hi[a].sub(uvO[a]).div(dSafe)
    const outside = uvO[a].lessThan(lo[a]).or(uvO[a].greaterThan(hi[a]))
    tIn.assign(select(parallel, tIn, max(tIn, min(t0, t1))))
    tOut.assign(select(parallel, select(outside, float(-1), tOut), min(tOut, max(t0, t1))))
  }
  const lenPx = max(length(dUV.mul(gBuffer.resolution)), 1e-6).toVar()
  const tLo = max(tIn, minDistancePx.div(lenPx)).toVar()
  const tHi = tOut.toVar()
  const Lpx = tHi.sub(tLo).mul(lenPx).toVar()
  const valid = tHi
    .greaterThan(tLo)
    .and(Lpx.greaterThanEqual(minDistancePx.mul(0.5)))
    .toVar()

  const uvOf = (t) => uvO.add(dUV.mul(t))
  const dRayOf = persp ? (t) => float(1).div(mix(k0, kE0, t)) : (t) => mix(O.z, E0.z, t).negate()
  const sOf = persp
    ? (t) =>
        sEnd0
          .mul(t)
          .mul(kE0)
          .div(mix(k0, kE0, t))
    : (t) => sEnd0.mul(t)
  const tOfS = persp ? (s) => s.mul(k0).div(max(sEnd0.mul(kE0).sub(s.mul(kE0.sub(k0))), 1e-30)) : (s) => s.div(sEnd0)
  const uvAtS = (s) => uvFromView(camera, O.add(R.mul(s)))
  const sLo = sOf(tLo).toVar()
  const sHi = sOf(tHi).toVar()
  return { uvOf, dRayOf, sOf, tOfS, uvAtS, lenPx, tLo, tHi, sLo, sHi, Lpx, valid, sEnd0 }
}

// ── Acceptance ──────────────────────────────────────────────────────

/**
 * The paper's 1-px test against the facet, a slope-scaled depth guard along the view ray, and the guards (on
 * screen, w > 0, front facing, not a self-hit, not the background). Returns { hit, reason, uv }.
 */
export function acceptHit({
  s,
  plane,
  origin: O,
  direction: R,
  originUV,
  camera,
  gBuffer,
  settings,
  frontFacing = true,
}) {
  const res = gBuffer.resolution
  const xF = O.add(R.mul(s)).toVar()
  const uvF = uvFromView(camera, xF).toVar()
  const dF = xF.z.negate()
  const fd = facetDepth(camera, uvF, plane).toVar()
  const PF = viewFromUV(camera, uvF, fd)
  const c = O.add(R.mul(dot(PF.sub(O), R)))
  const errPx = length(uvFromView(camera, c).sub(uvF).mul(res))
  const gC = dF.sub(fd).toVar()
  const x2 = O.add(R.mul(s.mul(1.001)))
  const uvStep = uvFromView(camera, x2)
  const pxDelta = max(length(uvStep.sub(uvF).mul(res)), 1e-3)
  const slopePx = abs(
    x2.z
      .negate()
      .sub(facetDepth(camera, uvStep, plane))
      .sub(gC),
  ).div(pxDelta)
  const depthOK = abs(gC).lessThanEqual(settings.crossingEpsilon.mul(dF).add(settings.hitTolerance.mul(slopePx)))
  const converged = errPx.lessThanEqual(settings.hitTolerance).and(depthOK)
  const den = dot(plane.Ng, R)
  const facing = frontFacing ? den.lessThan(0) : den.greaterThan(0)
  const farEnough = length(uvF.sub(originUV).mul(res)).greaterThanEqual(settings.minDistancePx)
  let onScreen = uvF.x.greaterThanEqual(0).and(uvF.x.lessThanEqual(1)).and(uvF.y.greaterThanEqual(0))
  onScreen = onScreen.and(uvF.y.lessThanEqual(1))
  if (camera.perspective) onScreen = onScreen.and(xF.z.lessThan(camera.near.negate()))

  const reason = select(converged, int(REASON.HIT), int(REASON.NOT_CONVERGED)).toVar()
  reason.assign(select(farEnough, reason, int(REASON.SELF_HIT)))
  reason.assign(select(facing, reason, int(REASON.BACK_FACE)))
  reason.assign(select(onScreen, reason, int(REASON.OFF_SCREEN)))
  reason.assign(select(plane.d.greaterThan(0), reason, int(REASON.BACKGROUND)))
  return { hit: reason.equal(REASON.HIT), reason, uv: uvF }
}

// ── Tracers ─────────────────────────────────────────────────────────

// The ray length where it meets a facet's plane, `den` = dot(plane.Ng, R).
const facetRoot = (plane, den, O) => dot(plane.Ng, plane.Pc.sub(O)).div(select(abs(den).greaterThan(1e-20), den, 1e-20))

const bracketVar = () => ({ sa: float(0).toVar(), ga: float(0).toVar(), sb: float(0).toVar(), gb: float(0).toVar() })
const assignBracket = (target, sa, ga, sb, gb) => {
  target.sa.assign(sa)
  target.ga.assign(ga)
  target.sb.assign(sb)
  target.gb.assign(gb)
}

/**
 * Temporally seeded, bracketed, safeguarded Newton: guard probes before a seed or stratified cold probes in batches
 * of `batch` loads, a seed polish to a facet root that reproduces itself, Newton on facet planes with an Illinois
 * regula-falsi fallback and an open-path trust region, and acceptHit. A bracket whose end facets both meet the ray
 * outside it is taken for a depth step the ray passes behind (a two-facet heuristic: one bisection first when it spans
 * more than 2 px): the refine stops there, and a cold search resumes its probes past it. An own or neighbour seed that
 * ends unconverged searches again cold in the same invocation, so a seed past an occluder's edge can't pin a pixel:
 * up to 3 searches, each with its own `settings.iterations`. `seed` is { valid, s, kind (SEED kinds), hold } or null;
 * `hold` (under a still camera) keeps last frame's own hit that the polish can't reproduce while its texel's facet
 * still accepts it. Settings are nodes (counts may be int or float); `batch` (1, 2 or 4) is baked. `xi` is the probe
 * offset in [0, 1). Returns { hit, s, sOut (the record: s, −s to retry, or 0), uv, depth, normal, iterations and
 * probes (summed over the searches), reason, path, guardFound }.
 */
export function traceNewton({
  segment: seg,
  origin: O,
  direction: R,
  originUV,
  seed = null,
  gBuffer,
  camera,
  settings: S,
  batch = 4,
  frontFacing = true,
  xi,
}) {
  const EPS = S.crossingEpsilon
  const seeded = seed ? bool(seed.valid).toVar() : bool(false)
  const sSeed = seed ? float(seed.s).toVar() : float(0)
  const seedKind = seed ? int(seed.kind).toVar() : int(0)
  const holdSeed = seed?.hold ? bool(seed.hold).and(seedKind.equal(SEED.OWN)) : bool(false)
  const accept = (s, plane) =>
    acceptHit({ s, plane, origin: O, direction: R, originUV, camera, gBuffer, settings: S, frontFacing })

  // the result, over the searches
  const hit = bool(false).toVar()
  const sC = float(0).toVar()
  const iterations = int(0).toVar()
  const probes = int(0).toVar()
  const reason = int(REASON.NO_CROSSING).toVar()
  const path = int(PATH.COLD).toVar()
  const guardFound = bool(false).toVar()
  const closed = bool(false).toVar()
  const retryable = bool(false).toVar()
  const plane = planeVar()
  // a cold search that passed behind a depth step resumes its probes after the gated one, counting crossings only
  // after a probe in front
  const resumeAt = float(0).toVar()
  const pastStep = bool(false).toVar()

  // one search, seeded or cold as `seeded` says
  const search = () => {
    pastStep.assign(false)
    hit.assign(false)
    sC.assign(0)
    reason.assign(REASON.NO_CROSSING)
    path.assign(PATH.COLD)
    guardFound.assign(false)
    closed.assign(false)
    retryable.assign(false)
    assignPlane(plane, { Ng: vec3(0, 0, 1), Pc: vec3(0), d: float(0), tx: vec2(-1) })
    const it = int(0).toVar()
    const probesUsed = int(0).toVar()
    const doRefine = bool(false).toVar()
    const bracket = bracketVar()

    // ── probes ──
    const guards = float(S.guardProbes)
    const tSeed = (seed ? select(seeded, seg.tOfS(sSeed), seg.tLo) : seg.tLo).toVar()
    const tGuardHi = max(seg.tLo, tSeed.sub(float(1).div(seg.lenPx))).toVar()
    const coldCount = clamp(ceil(sqrt(min(seg.Lpx, 1e6))), 2, float(S.probes))
    // no guards for a seed within a px of the segment's start
    const count = select(seeded, select(tGuardHi.greaterThan(seg.tLo), guards, float(0)), coldCount).toVar()
    const span = select(seeded, tGuardHi.sub(seg.tLo).div(max(guards, 1)), seg.tHi.sub(seg.tLo)).toVar()
    const probeT = (i) => {
      const u = i.add(xi)
      const v = u.div(count)
      return seg.tLo.add(span.mul(select(seeded, u, v.mul(v))))
    }
    const first0 = select(seeded, float(0), resumeAt).toVar()

    const sFront = seg.sLo.toVar()
    const gFront = EPS.mul(seg.dRayOf(seg.tLo)).negate().toVar()
    const tPrev = select(first0.greaterThan(0), probeT(first0.sub(1)), seg.tLo).toVar()
    const inFront = first0.equal(0).toVar()
    const gatedAt = float(0).toVar()
    const haveFirst = bool(false).toVar()
    const haveGated = bool(false).toVar()
    const first = bracketVar()
    const gated = bracketVar()

    // the seed's texel, in the first round trip
    const txS = vec2(-1).toVar()
    const dS = float(0).toVar()
    const eSeed = vec4(0).toVar()
    if (seed) {
      If(seeded, () => {
        txS.assign(texelOf(gBuffer, seg.uvAtS(sSeed)))
        dS.assign(gBuffer.depthNode.load(ivec2(txS)).r)
        eSeed.assign(gBuffer.normalsNode.load(ivec2(txS)))
      })
    }

    Loop(Math.ceil(K_MAX / batch), ({ i: j }) => {
      const ts = []
      const ds = []
      const index = (k) => float(j).mul(batch).add(k)
      // the batch's loads first: their addresses depend only on t
      for (let k = 0; k < batch; k++) {
        const t = probeT(min(index(k), max(count.sub(1), 0))).toVar()
        const d = float(BIG).toVar()
        If(index(k).lessThan(count).and(index(k).greaterThanEqual(first0)), () => {
          d.assign(depthAt(gBuffer, seg.uvOf(t)))
        })
        ts.push(t)
        ds.push(d)
      }
      for (let k = 0; k < batch; k++) {
        If(haveGated.not().and(index(k).lessThan(count)).and(index(k).greaterThanEqual(first0)), () => {
          const dR = seg.dRayOf(ts[k]).toVar()
          const g = dR.sub(ds[k]).toVar()
          const s = seg.sOf(ts[k]).toVar()
          probesUsed.assign(int(index(k).sub(first0)).add(1))
          If(g.lessThanEqual(EPS.mul(dR)), () => {
            sFront.assign(s)
            gFront.assign(g)
            inFront.assign(true)
          }).ElseIf(inFront, () => {
            const gate = S.thickness.add(abs(dR.sub(seg.dRayOf(tPrev))).mul(2))
            If(haveFirst.not().and(seeded.not()), () => {
              haveFirst.assign(true)
              assignBracket(first, sFront, gFront, s, g)
            })
            If(g.lessThanEqual(gate), () => {
              haveGated.assign(true)
              gatedAt.assign(index(k))
              assignBracket(gated, sFront, gFront, s, g)
              guardFound.assign(seeded)
            })
          })
          tPrev.assign(ts[k])
        })
      }
      If(haveGated.or(float(j).add(1).mul(batch).greaterThanEqual(count)), () => {
        Break()
      })
    })

    // ── what to refine ──
    const seedHit = bool(false).toVar()
    const sPolished = float(0).toVar()
    const polishReason = int(REASON.NOT_CONVERGED).toVar()
    If(seeded.not(), () => {
      If(haveGated, () => {
        assignBracket(bracket, gated.sa, gated.ga, gated.sb, gated.gb)
        retryable.assign(true)
      }).ElseIf(haveFirst, () => {
        assignBracket(bracket, first.sa, first.ga, first.sb, first.gb)
      })
      If(haveGated.or(haveFirst), () => {
        closed.assign(true)
        doRefine.assign(true)
        assignPlane(plane, planeAt(camera, gBuffer, seg.uvAtS(bracket.sb)))
      })
    }).Else(() => {
      path.assign(seedKind.add(1))
      retryable.assign(true)
      // seed polish: a facet root that lies in its own facet's texel (the seed texel's, else the front-facing one its
      // root lands in), or of two facets whose roots land in each other's texel the nearer. It depends on the seed's
      // texel pair only, so a converged seed reproduces itself; anything else is refined.
      const seedPlane = planeOfTexel(camera, gBuffer, txS, dS, eSeed)
      const den = dot(seedPlane.Ng, R)
      const usable0 = abs(den).greaterThan(S.minDenominator).and(dS.greaterThan(0))
      const r0 = select(usable0, facetRoot(seedPlane, den, O), sSeed).toVar()
      const sP = r0.toVar()
      const polishPlane = planeVar(seedPlane)
      const tx1 = texelOf(gBuffer, seg.uvAtS(r0)).toVar()
      const consistent = usable0.not().or(otherTexel(tx1, txS).not()).toVar()
      If(consistent.not(), () => {
        const p1 = planeOfTexel(camera, gBuffer, tx1)
        const den1 = dot(p1.Ng, R)
        const r1 = facetRoot(p1, den1, O).toVar()
        const tx2 = texelOf(gBuffer, seg.uvAtS(r1))
        const own = otherTexel(tx2, tx1).not()
        // a seam where the two roots agree within convergePx (a depth step between the facets is no root)
        const seam = otherTexel(tx2, txS)
          .not()
          .and(
            abs(seg.tOfS(r1).sub(seg.tOfS(r0)))
              .mul(seg.lenPx)
              .lessThanEqual(S.convergePx),
          )
        consistent.assign(den1.lessThan(S.minDenominator.negate()).and(p1.d.greaterThan(0)).and(own.or(seam)))
        If(consistent.and(own.or(r1.lessThan(r0))), () => {
          sP.assign(r1)
          assignPlane(polishPlane, p1)
        })
      })
      // a polish near the seed point only; otherwise Newton refines from the seed
      const nearSeed = min(abs(seg.tOfS(r0).sub(tSeed)), abs(seg.tOfS(sP).sub(tSeed)))
        .mul(seg.lenPx)
        .lessThanEqual(1)
        .and(consistent)
        .and(sP.greaterThan(sFront))
        .and(sP.lessThan(seg.sHi))
      const polish = accept(sP, polishPlane)
      seedHit.assign(nearSeed.and(polish.hit))
      sPolished.assign(sP)
      polishReason.assign(select(nearSeed, polish.reason, int(REASON.NOT_CONVERGED)))
      // under a still camera, last frame's own hit that the polish can't reproduce holds while its texel's facet
      // still accepts it
      If(holdSeed.and(seedHit.not()), () => {
        If(accept(sSeed, seedPlane).hit, () => {
          seedHit.assign(true)
          sPolished.assign(sSeed)
          polishReason.assign(REASON.HIT)
        })
      })
      If(guardFound, () => {
        // a guard found an earlier gated crossing: refine it; the seed stands if that fails (a pass-behind)
        assignBracket(bracket, gated.sa, gated.ga, gated.sb, gated.gb)
        closed.assign(true)
        doRefine.assign(true)
        assignPlane(plane, planeAt(camera, gBuffer, seg.uvAtS(gated.sb)))
      })
        .ElseIf(seedHit, () => {
          hit.assign(true)
          sC.assign(sPolished)
          reason.assign(REASON.HIT)
        })
        .ElseIf(polishReason.notEqual(REASON.NOT_CONVERGED), () => {
          reason.assign(polishReason)
        })
        .Else(() => {
          assignPlane(plane, seedPlane)
          const gS = gFacet(camera, sSeed, seedPlane, O, R).toVar()
          If(gS.greaterThan(EPS.mul(seg.dRayOf(tSeed))), () => {
            closed.assign(true)
            assignBracket(bracket, sFront, gFront, sSeed, gS)
          }).Else(() => {
            assignBracket(bracket, sFront, gFront, seg.sHi, BIG)
            sC.assign(sSeed)
          })
          doRefine.assign(true)
        })
    })

    // ── refine: safeguarded Newton, Illinois regula falsi, trust region; px distances in screen-linear t ──
    If(doRefine, () => {
      If(closed, () => {
        sC.assign(bracket.sb)
      })
      const side = int(0).toVar()
      const done = bool(false).toVar()
      // where each end's facet meets the ray (a closed bracket starts at its far end; the background never does).
      // Both outside the bracket suggests a depth step the ray passes behind, not a crossing. Two facets can't see a
      // third between them, so a bracket wider than 2 px is bisected once before the step is taken as one.
      const startFar = closed.toVar()
      const rootA = float(0).toVar()
      const rootB = float(0).toVar()
      const knownA = bool(false).toVar()
      const knownB = bool(false).toVar()
      const stepLike = bool(false).toVar()
      const bisected = bool(false).toVar()
      const passBehind = bool(false).toVar()
      const { sa, ga, sb, gb } = bracket
      const tC = seg.tOfS(sC).toVar()
      const tA = seg.tOfS(sa).toVar()
      const tB = seg.tOfS(sb).toVar()
      Loop(ITERS_MAX, () => {
        If(done.or(float(it).greaterThanEqual(float(S.iterations))), () => {
          Break()
        })
        const den = dot(plane.Ng, R).toVar()
        const sN = dot(plane.Ng, plane.Pc.sub(O))
          .div(select(abs(den).greaterThan(1e-20), den, 1e-20))
          .toVar()
        const tSN = seg.tOfS(sN).toVar()
        const newtonPx = abs(tSN.sub(tC)).mul(seg.lenPx).toVar()
        const usable = abs(den).greaterThan(S.minDenominator).and(plane.d.greaterThan(0)).toVar()
        // sC is already its facet's root: land on it when it lies on that facet's texel, inside the bracket
        If(usable.and(newtonPx.lessThan(S.convergePx)), () => {
          If(
            otherTexel(texelOf(gBuffer, seg.uvAtS(sN)), plane.tx)
              .not()
              .and(sN.greaterThan(sa))
              .and(sN.lessThan(sb)),
            () => {
              sC.assign(sN)
            },
          )
          Break()
        })
        If(side.equal(1).or(side.equal(0).and(startFar)), () => {
          rootB.assign(sN)
          knownB.assign(usable)
        }).ElseIf(side.equal(-1), () => {
          rootA.assign(select(plane.d.greaterThan(0), sN, float(BIG)))
          knownA.assign(usable.or(plane.d.lessThanEqual(0)))
        })
        const outside = (r) => r.lessThanEqual(sa).or(r.greaterThanEqual(sb))
        stepLike.assign(closed.and(knownA).and(knownB).and(outside(rootA)).and(outside(rootB)))
        const narrow = abs(tB.sub(tA)).mul(seg.lenPx).lessThanEqual(2)
        If(stepLike.and(narrow.or(bisected)), () => {
          passBehind.assign(true)
          Break()
        })
        const inTrust = closed.or(newtonPx.lessThanEqual(S.trustRegion))
        const okN = usable.and(sN.greaterThan(sa)).and(sN.lessThan(sb)).and(inTrust)
        const w = clamp(ga.div(min(ga.sub(gb), -1e-20)), 0.1, 0.9)
        const march = seg.sOf(min(mix(tC, seg.tHi, 0.25), tC.add(S.trustRegion.div(seg.lenPx))))
        const sNext = select(
          stepLike,
          seg.sOf(mix(tA, tB, 0.5)),
          select(okN, sN, select(closed, sa.add(sb.sub(sa).mul(w)), march)),
        ).toVar()
        bisected.assign(bisected.or(stepLike))
        const tN = seg.tOfS(sNext).toVar()
        const uvN = seg.uvAtS(sNext).toVar()
        const stepPx = abs(tN.sub(tC)).mul(seg.lenPx).toVar()
        If(otherTexel(texelOf(gBuffer, uvN), plane.tx), () => {
          assignPlane(plane, planeAt(camera, gBuffer, uvN))
        })
        const dR = O.z.add(R.z.mul(sNext)).negate()
        const g = select(plane.d.greaterThan(0), dR.sub(facetDepth(camera, uvN, plane)), -BIG).toVar()
        If(g.greaterThan(EPS.mul(dR)), () => {
          sb.assign(sNext)
          gb.assign(g)
          tB.assign(tN)
          If(side.equal(1), () => {
            ga.mulAssign(0.5)
          })
          side.assign(1)
          closed.assign(true)
        }).Else(() => {
          sa.assign(sNext)
          ga.assign(g)
          tA.assign(tN)
          If(side.equal(-1), () => {
            gb.mulAssign(0.5)
          })
          side.assign(-1)
        })
        sC.assign(sNext)
        tC.assign(tN)
        it.addAssign(1)
        const bracketPx = select(closed, abs(tB.sub(tA)).mul(seg.lenPx), float(BIG))
        done.assign(stepPx.lessThan(S.convergePx).or(bracketPx.lessThan(1)))
      })
      // the refine ended after the bisection with the bracket still step-like
      passBehind.assign(passBehind.or(stepLike))
      const final = accept(sC, plane)
      hit.assign(final.hit)
      reason.assign(final.reason)
      // a cold search that passes behind a step finds no crossing there: nothing to retry, search on past it
      If(passBehind.and(final.hit.not()).and(seeded.not()), () => {
        reason.assign(REASON.NO_CROSSING)
        retryable.assign(false)
        pastStep.assign(haveGated.and(gatedAt.add(1).lessThan(count)))
        resumeAt.assign(gatedAt.add(1))
      })
      If(guardFound.and(final.hit.not()), () => {
        hit.assign(seedHit)
        sC.assign(select(seedHit, sPolished, sSeed))
        reason.assign(select(seedHit, int(REASON.HIT), polishReason))
      })
    })
    iterations.addAssign(it)
    probes.addAssign(probesUsed)
  }

  // an own or neighbour seed that ends unconverged searches again cold (other seeded failures, background, back face,
  // off screen, are mostly true misses, and a failed −s retry is the cold search's own failure again); a cold search
  // that passed behind a step searches on past it
  const continuePast = () =>
    If(pastStep.not(), () => {
      Break()
    })
  Loop({ start: int(0), end: int(3), type: 'int', condition: '<', name: 'searchPass' }, () => {
    search()
    if (seed) {
      If(seeded.and(reason.equal(REASON.NOT_CONVERGED)).and(seedKind.notEqual(SEED.UNCONVERGED)), () => {
        seeded.assign(false)
      }).Else(() => {
        continuePast()
      })
    } else continuePast()
  })

  // a cold gated bracket that failed retries once from −s next frame
  const eligible = reason
    .equal(REASON.NOT_CONVERGED)
    .and(closed)
    .and(retryable)
    .and(seedKind.notEqual(SEED.UNCONVERGED))
    .and(sC.greaterThan(0))
  const sOut = select(hit, sC, select(eligible, sC.negate(), float(0)))
  return {
    hit,
    s: sC,
    sOut,
    uv: seg.uvAtS(sC),
    depth: plane.d,
    normal: plane.Ng,
    iterations,
    probes,
    reason,
    path,
    guardFound,
  }
}
