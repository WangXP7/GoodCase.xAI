import * as THREE from 'three/webgpu'
import {
  abs,
  atan,
  atomicAdd,
  atomicLoad,
  atomicStore,
  attribute,
  builtinAOContext,
  cameraViewMatrix,
  ceil,
  clamp,
  context,
  cos,
  cross,
  dot,
  exp,
  float,
  floor,
  Fn,
  fract,
  fwidth,
  hash,
  If,
  instancedArray,
  instancedBufferAttribute,
  instanceIndex,
  int,
  length,
  lights,
  Loop,
  luminance,
  mat4,
  materialColor,
  materialEmissive,
  materialRoughness,
  materialSheen,
  max,
  min,
  mix,
  mrt,
  mx_fractal_noise_float,
  mx_noise_float,
  mx_noise_vec3,
  normalFlat,
  normalize,
  normalLocal,
  normalView,
  normalViewGeometry,
  normalWorldGeometry,
  output,
  packNormalToRGB,
  pass,
  positionGeometry,
  positionLocal,
  positionPrevious,
  positionView,
  positionWorld,
  pow,
  renderOutput,
  round,
  rtt,
  sample,
  saturate,
  select,
  sign,
  sin,
  smoothstep,
  step,
  storage,
  tangentView,
  texture,
  uint,
  uniform,
  uniformArray,
  uniformGroup,
  unpackRGBToNormal,
  uv,
  vec2,
  vec3,
  vec4,
  velocity,
  vertexStage,
} from 'three/tsl'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { Capsule } from 'three/addons/math/Capsule.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { film } from 'three/addons/tsl/display/FilmNode.js'
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js'
import Stats from 'stats-gl'
import { TAAUNode, syncUnjitteredProjection, taau } from '../rendering/taau/TAAUNode.js'
import { ssr, ssrEnvironmentSpecular, ssrGBuffer } from '../rendering/screen-space-reflections/SSRNode.js'
import { octEncode } from '../rendering/screen-space-reflections/utils/newtonRayTrace.js'
import { xeGTAO } from '../rendering/ambient-occlusion/XeGTAONode.js'
import { motionBlur } from '../rendering/motion-blur/MotionBlurNode.js'
import { bloom } from '../rendering/bloom/BloomNode.js'
import {
  wormRadiusProfile,
  WormSimulation,
  WormSimulationHelper,
  WormState,
} from '../simulations/noodles/WormSimulation.js'
import { BodyField, BodyFieldHelper } from './utils/BodyField.js'
import { FieldAttractor } from './utils/FieldAttractor.js'
import { GPUTierDetector } from '../utils/GPUTierDetector.js'

// Worm Monster: a man made of about 110 simulated worms (WormSimulation) crawls in across a restroom floor, heaves up
// into a body from the feet up, and walks at the player, who holds a baseball bat. A FieldAttractor pulls each worm
// toward its home on a BodyField: round cones on the bones of Mixamo's walking monster rig. A hit knocks worms
// off onto the wall, and the figure stands while they are gathered back before it walks on. Once the body swallows the
// eye: "Get worm'd".
//
// Controls: WASD or the arrows walk, Shift runs, Alt slows, C crouches, Space jumps; a click locks the pointer and the
// mouse looks, Esc releases it. Once locked, a click uses the tool: 1 Bat (swing), 2 Grab (drag), 3 Poke, 4 Blast.
// Touch: the left stick walks and turns, Hit swings, a drag looks. ⇧R replays, X collapses, F toggles the flashlight,
// V resets the view, H the worms' states, J the field, K the homes, P the stats, T pauses.
//
// Quality: three tiers, Low, Medium and High. GPUTierDetector picks Low on a mobile device and Medium on a desktop at
// load, from the adapter and navigator.userAgentData, and it holds; with ?monitorPerformance=true, FrameTimeGovernor
// steps it down while frames run long, and back up once they have room. Any param can be set in the URL: ?tier=High
// fixes a tier, ?start=ceiling rains the worms down.

// ─── Gait ────────────────────────────────────────────────────────────────────

// The figure's gait: Mixamo's Start Walking and Walking clips, played on their own rig, each with its travel along the
// figure's front taken out of the hips: the figure's path moves it by that travel instead, so the feet stay planted at
// any playback rate and on any path.

const _point = new THREE.Vector3()
const _offset = new THREE.Vector3()
const _gaitInverse = new THREE.Matrix4()

/**
 * A clip whose hip travels along the model's +z, that travel taken out of it and kept as a distance curve. A looping
 * clip keeps its sway and surge about a steady walk (its mean speed); a clip played once is pinned where it starts.
 * Also the times both feet are down in it (feetDown): where a walk can come to rest.
 */
class RootMotion {
  /** The clip, its travel taken out of the hip. */
  clip
  loop
  /** Model units per clip second: the mean speed. */
  speed = 0
  /** s into the clip where both toes are down and still, sorted: the middle of each such stretch. */
  feetDown = []
  #times
  #distances

  constructor(clip, model, options = {}) {
    const { hip = 'Hips', loop = false, toes = ['LeftToeBase', 'RightToeBase'], lift = 0.06, slip = 0.6 } = options
    this.clip = clip.clone()
    this.loop = loop
    const node = model.getObjectByName(hip)
    const track = this.clip.tracks.find((t) => t.name === `${hip}.position`)
    if (!node || !track) {
      console.warn(`RootMotion: "${clip.name}" has no "${hip}.position" track`)
      this.#times = new Float32Array([0])
      this.#distances = new Float32Array([0])
      return
    }
    // the hip's parent's space → the model's, in the rest pose (its ancestors aren't animated)
    model.updateMatrixWorld(true)
    const toModel = model.matrixWorld.clone().invert().multiply(node.parent.matrixWorld)
    const toParent = new THREE.Matrix3().setFromMatrix4(toModel.clone().invert())
    const { times, values } = track
    const count = times.length
    const z = Float32Array.from({ length: count }, (_, k) => _point.fromArray(values, k * 3).applyMatrix4(toModel).z)
    const span = times[count - 1] - times[0]
    this.speed = span > 0 ? (z[count - 1] - z[0]) / span : 0
    this.#times = Float32Array.from(times)
    this.#distances = loop ? this.#times.map((t) => this.speed * (t - times[0])) : z.map((d) => d - z[0])
    for (let k = 0; k < count; k++) {
      _offset.set(0, 0, -this.#distances[k]).applyMatrix3(toParent)
      _point.fromArray(values, k * 3).add(_offset)
      _point.toArray(values, k * 3)
    }
    this.feetDown = this.#measureFeetDown(model, toes, lift, slip)
  }

  // Where both toes lie within `lift` model units of their lowest and slide under `slip` units per clip second over the
  // ground (their travel in the model plus the clip's own): the middle of each such stretch. The clip's tracks are set
  // straight on `model` (in its rest pose) at 60 samples a second, then put back.
  #measureFeetDown(model, names, lift, slip) {
    const toes = names.map((name) => model.getObjectByName(name))
    if (toes.some((toe) => !toe)) return []
    const tracks = this.clip.tracks.map((track) => {
      const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name)
      return {
        node: THREE.PropertyBinding.findNode(model, nodeName),
        propertyName,
        interpolant: track.createInterpolant(),
      }
    })
    const saved = tracks.map(({ node, propertyName }) => node?.[propertyName]?.clone())
    const duration = this.clip.duration
    const count = Math.max(2, Math.round(duration * 60))
    const points = []
    for (let i = 0; i <= count; i++) {
      const time = (i / count) * duration
      for (const { node, propertyName, interpolant } of tracks) {
        node?.[propertyName]?.fromArray(interpolant.evaluate(time))
      }
      model.updateMatrixWorld(true)
      _gaitInverse.copy(model.matrixWorld).invert()
      points.push(toes.map((toe) => _point.setFromMatrixPosition(toe.matrixWorld).applyMatrix4(_gaitInverse).clone()))
    }
    tracks.forEach(({ node, propertyName }, i) => saved[i] && node[propertyName].copy(saved[i]))
    model.updateMatrixWorld(true)
    const lowest = toes.map((_, k) => Math.min(...points.map((p) => p[k].y)))
    const step = duration / count
    const last = this.loop ? count - 1 : count // a loop's last sample is its first
    const at = (i) => points[this.loop ? (i + count) % count : THREE.MathUtils.clamp(i, 0, count)]
    const down = []
    for (let i = 0; i <= last; i++) {
      const time = i * step
      const travel = this.travel(time - step, time + step) / (2 * step)
      down.push(
        toes.every((_, k) => {
          // over the ground: its own slide in the model plus the clip's travel
          const slide = _offset.subVectors(at(i + 1)[k], at(i - 1)[k]).divideScalar(2 * step)
          return at(i)[k].y - lowest[k] < lift && Math.hypot(slide.x, slide.z + travel) < slip
        }),
      )
    }
    // the middle of each stretch of samples with both feet down; a loop's may run over its end
    const times = []
    for (let i = 0; i <= last; i++) {
      if (!down[i] || (i > 0 ? down[i - 1] : this.loop && down[last])) continue
      let end = i
      while (down[(end + 1) % (last + 1)] && end - i < last) end++
      const middle = ((i + end) / 2) * step
      times.push(this.loop ? THREE.MathUtils.euclideanModulo(middle, duration) : middle)
    }
    return times.sort((a, b) => a - b)
  }

  /**
   * Clip seconds from `time` to the first feet-down moment at least `ahead` s on (a loop's wrap counts as going on), or
   * null if there is none.
   */
  restAfter(time, ahead) {
    const duration = this.clip.duration
    for (let lap = 0; lap < (this.loop ? 3 : 1); lap++) {
      for (const down of this.feetDown) {
        const left = down + lap * duration - time
        if (left >= ahead) return left
      }
    }
    return null
  }

  /** Model units travelled `time` s into the clip. */
  distanceAt(time) {
    const times = this.#times
    const last = times.length - 1
    if (!(time > times[0])) return this.#distances[0]
    if (time >= times[last]) return this.#distances[last]
    let low = 0
    let high = last
    while (high - low > 1) {
      const middle = (low + high) >> 1
      if (times[middle] <= time) low = middle
      else high = middle
    }
    const share = (time - times[low]) / (times[high] - times[low])
    return THREE.MathUtils.lerp(this.#distances[low], this.#distances[high], share)
  }

  /** Model units travelled as the clip's time went `from` → `to`; a loop's wrap counts as going on. */
  travel(from, to) {
    if (!this.loop) return this.distanceAt(to) - this.distanceAt(from)
    const duration = this.clip.duration
    let step = to - from
    if (step < -duration / 2) step += duration
    else if (step > duration / 2) step -= duration
    return this.speed * step
  }
}

/** The figure's start and walk clips from the two Mixamo glTFs, measured on `model`: their rig, in its rest pose. */
class MonsterGait {
  /** RootMotion: Start Walking, played once. */
  start
  /** RootMotion: Walking, looped. */
  walk

  constructor(model, sources) {
    const clipOf = (gltf, name) => Object.assign(gltf.animations[0].clone(), { name })
    this.start = new RootMotion(clipOf(sources.start, 'Start Walking'), model)
    this.walk = new RootMotion(clipOf(sources.walk, 'Walking'), model, { loop: true })
  }
}

// ─── Wet trails ──────────────────────────────────────────────────────────────

// The wet trails the worms leave on the room: a grid of wetness per flat surface (the floor, the walls), all in one
// storage buffer. Each frame every segment of a worm touching a surface wets the cells its stroke swept over since the
// last frame, by how long each was under it, and at once where it hit fast: a resting worm soaks a spot within
// paintTime, a slap splats it, a fast flick barely marks it, and nothing leaves gaps. A separable Gaussian then blurs
// the cells into a film, scaled so a lone soaked stroke peaks at 1, and every cell dries exponentially. Materials read
// the film with sample(), a quadratic B-spline with its gradient.
//
//   const surfaces = [{ origin, along, up, normal, width, height, paintRate, dryRate }, …]
//   const wet = new WetPaint(surfaces, { cellSize: 0.02 })
//   worms.extraPasses.after.push(wet.paintNode(worms), ...wet.filmNodes)
//   const film = wet.sample(0) // the floor at the fragment: vec3(film, its gradient along `along` and `up`, per m)
//   floorMaterial.colorNode = albedo.mul(smoothstep(0, 1, film.x).mul(0.5).oneMinus())
//   wet.update(renderer, delta) // each frame before worms.update(): this frame's paint, drying and blur
//   await wet.compileAsync(renderer) // optional: clear()'s pass, ahead of its first dispatch
//   wet.clear(renderer)         // dry everything
//   wet.release(worms)          // before the worms are disposed

const MAX_SPAN = 64 // most cells a segment's painted box spans along each axis
const MAX_SWEEP = 16 // most positions a segment's sweep since the last frame is sampled at
const SWEEP_LIMIT = 0.3 // m an end of a segment may move in a frame and still be swept: a longer move is a jump
const LANES = 8 // threads that share a segment's cells
const BLUR_REACH = 2.5 // σ the blur's taps reach either side
const MAX_TAPS = 16 // most taps either side of a cell: σ at most MAX_TAPS / BLUR_REACH cells

const WETNESS_OPTIONS = ['cellSize']
const SURFACE_KEYS = ['origin', 'along', 'up', 'normal', 'width', 'height']

const vector = (v) => vec3(v.x, v.y, v.z)
// A uniform array in an 'object' group of its own (the same bind group and WGSL): uploaded once after changed(), not
// at every dispatch and draw.
const changingArray = (array, type) => uniformArray(array, type).setGroup(uniformGroup('object'))
// After an in-place edit of `node.array`: its buffer refreshed (none until built) and every binding's upload queued.
function changed(node) {
  if (node.value) node.updateBuffer()
  node.groupNode.needsUpdate = true
}

class WetPaint {
  isWetPaint = true
  type = 'WetPaint'

  /** Wetness a soaked cell holds, 0–1: 0 paints nothing. */
  amount = 1
  /** s under a touching stroke that soaks a cell to `amount`; 0 soaks it at once. */
  paintTime = 0.25
  /** m/s a stroke hits a surface at that soaks a cell at once, slower hits soaking a share; 0 never. */
  slapSpeed = 1.5
  /** s: the wetness falls to 1/e in this long; 0 dries it at once. */
  dryTime = 18
  /** ± share of the drying rate a smooth noise varies over each surface, 0–1: old patches dry out in holes. */
  dryAmplitude = 0
  /** 1/m: the frequency of that noise. */
  dryFrequency = 2
  /** × a particle's radius: the half-width of the stroke a segment paints. */
  spread = 0.6
  /** × a particle's radius: how far off a surface a segment still paints, fading out. */
  contact = 0.3
  /** m: the σ of the Gaussian that blurs the cells into the film; 0 shows the cells as they are. */
  blur = 0.02

  /**
   * The surfaces as given, each with its `paintRate` and `dryRate` (live) and its grid: `columns`, `rows` and the
   * buffer `offset` of its first cell.
   */
  surfaces
  /** m: a cell's side. */
  cellSize

  #cells // per cell: its wetness, and the most this frame's strokes add to it
  #rows // the cells blurred along each surface's rows
  #film // #rows blurred along the columns × the gain: what sample() reads
  #reader
  #u = {
    decay: uniform(0),
    dryAmplitude: uniform(0),
    dryFrequency: uniform(2),
    amount: uniform(1),
    deposit: uniform(0), // wetness a cell under a stroke for a whole frame gains
    slap: uniform(0), // 1 / the gap a slap closes in a frame to soak a cell at once, /m
    frame: uniform(1), // this frame's number, from 1: a sweep starts where the frame before painted
    half: uniform(0, 'uint'), // which half of each painter's `last` this frame writes; it reads the other
    spread: uniform(0.6),
    contact: uniform(0.3),
    taps: uniform(0, 'int'),
    // by |tap|: the Gaussian's normalised weights
    weights: changingArray(new Array(MAX_TAPS + 1).fill(0), 'float'),
    gain: uniform(1),
  }
  #surfaceRates
  #paintRates
  #filmPasses
  #clear
  #paints = new Map()
  #blurKey = ''
  #frame = 1
  #renderer = null

  /**
   * @param {Array<{origin: THREE.Vector3, along: THREE.Vector3, up: THREE.Vector3, normal: THREE.Vector3,
   *   width: number, height: number, paintRate?: number, dryRate?: number}>} surfaces - Flat rectangles, world
   *   space: `width` along `along` by `height` along `up` (at right angles) from the corner `origin`, wet on the side
   *   `normal` faces; paintRate and dryRate (default 1) scale its soaking and drying.
   * @param {object} [options]
   * @param {number} [options.cellSize=0.02] - m.
   */
  constructor(surfaces, options = {}) {
    for (const key of Object.keys(options)) {
      if (!WETNESS_OPTIONS.includes(key)) console.warn(`WetPaint: unknown option "${key}".`)
    }
    const cellSize = Math.max(options.cellSize ?? 0.02, 1e-3)
    this.cellSize = cellSize
    let offset = 0
    this.surfaces = surfaces.map((surface, index) => {
      for (const key of SURFACE_KEYS) {
        if (surface[key] === undefined) throw new Error(`WetPaint: surfaces[${index}] has no "${key}".`)
      }
      const columns = Math.max(1, Math.ceil(surface.width / cellSize))
      const rows = Math.max(1, Math.ceil(surface.height / cellSize))
      const grid = {
        origin: surface.origin.clone(),
        along: surface.along.clone().normalize(),
        up: surface.up.clone().normalize(),
        normal: surface.normal.clone().normalize(),
        width: surface.width,
        height: surface.height,
        paintRate: surface.paintRate ?? 1,
        dryRate: surface.dryRate ?? 1,
        columns,
        rows,
        offset,
      }
      offset += columns * rows
      return grid
    })
    this.#surfaceRates = changingArray(
      this.surfaces.map((s) => s.dryRate),
      'float',
    )
    this.#paintRates = changingArray(
      this.surfaces.map((s) => s.paintRate),
      'float',
    )
    const count = Math.max(offset, 1)
    const cells = (this.#cells = instancedArray(count, 'vec2').setName('wetPaint_cells'))
    const rows = (this.#rows = instancedArray(count, 'float').setName('wetPaint_rows'))
    const film = (this.#film = instancedArray(count, 'float').setName('wetPaint_film'))
    this.#reader = storage(film.value, 'float', count).toReadOnly().setName('wetPaint_read')
    const u = this.#u
    // a cell's wetness with this frame's strokes added
    const wetness = (cell) => min(cell.x.add(cell.y), u.amount)

    this.#filmPasses = [
      Fn(() => {
        const { offset, columns, column, row } = this.#locate(int(instanceIndex))
        const at = (tap) => offset.add(row.mul(columns)).add(clamp(column.add(tap), int(0), columns.sub(1)))
        rows.element(instanceIndex).assign(this.#blur(at, (index) => wetness(cells.element(index))))
      })()
        .compute(count)
        .setName('wetPaint_blurRows'),
      Fn(() => {
        const { surface, offset, columns, rows: height, column, row } = this.#locate(int(instanceIndex))
        const at = (tap) => offset.add(clamp(row.add(tap), int(0), height.sub(1)).mul(columns)).add(column)
        film.element(instanceIndex).assign(this.#blur(at, (index) => rows.element(index)).mul(u.gain))
        // then the strokes join the cell and it dries by this frame's share: the next frame's rows pass reads it
        const cell = cells.element(instanceIndex)
        cell.assign(vec2(wetness(cell).mul(exp(u.decay.mul(this.#dryRate(surface, column, row)))), 0))
      })()
        .compute(count)
        .setName('wetPaint_blurColumns'),
    ]
    this.#clear = Fn(() => {
      cells.element(instanceIndex).assign(vec2(0))
      rows.element(instanceIndex).assign(0)
      film.element(instanceIndex).assign(0)
    })()
      .compute(count)
      .setName('wetPaint_clear')
  }

  /**
   * The two passes that blur the cells into the film, along rows then columns, the second also adding this frame's
   * strokes to the cells and drying them by this frame's share: run them once a frame, after the paint.
   */
  get filmNodes() {
    return this.#filmPasses
  }

  /**
   * The pass that paints where `noodles` (a NoodleSimulation) touch the surfaces, made once per noodles. Run it once a
   * frame, after the noodles have stepped.
   */
  paintNode(noodles) {
    const known = this.#paints.get(noodles)
    if (known) return known.node
    const positions = noodles.nodes.buffers.positions
    const P = noodles.particlesPerNoodle
    const count = noodles.particleCount
    const profile = noodles.radiusProfile ?? new Array(P).fill(1)
    // constant: uploaded once
    const radii = changingArray(
      Array.from(profile, (f) => f * noodles.radius),
      'float',
    )
    const localToWorld = uniform(new THREE.Matrix4().copy(noodles.matrixWorld))
    const radius = Math.max(...profile) * noodles.radius
    // each segment's ends, world space, where it was last painted, w the frame's number; two halves, one written while
    // the other is read
    const last = instancedArray(count * 4, 'vec4').setName('wetPaint_last')
    const u = this.#u
    const cells = this.#cells
    const cellSize = this.cellSize
    const node = Fn(() => {
      const first = instanceIndex.div(LANES).toVar()
      const lane = int(instanceIndex.mod(LANES)).toVar()
      const k = first.mod(uint(P)).toVar()
      // the last particle of a noodle starts no segment
      If(k.lessThan(uint(P - 1)), () => {
        const world = (i) => localToWorld.mul(vec4(positions.element(i).xyz, 1)).xyz
        const x0 = world(first).toVar()
        const x1 = world(first.add(1)).toVar()
        const ends = (half) => half.mul(count * 2).add(first.mul(2))
        const read = ends(uint(1).sub(u.half)).toVar()
        const was0 = last.element(read).toVar()
        const was1 = last.element(read.add(1)).toVar()
        If(lane.equal(0), () => {
          const write = ends(u.half).toVar()
          last.element(write).assign(vec4(x0, u.frame))
          last.element(write.add(1)).assign(vec4(x1, u.frame))
        })
        // where the ends were the frame before; after a frame unpainted, where they are
        const fresh = was0.w.equal(u.frame.sub(1))
        const y0 = select(fresh, was0.xyz, x0).toVar()
        const y1 = select(fresh, was1.xyz, x1).toVar()
        const r0 = radii.element(k).toVar()
        const r1 = radii.element(k.add(1)).toVar()
        this.surfaces.forEach((s, index) => {
          const deposit = u.deposit.mul(this.#paintRates.element(index))
          const onto = (x) => {
            const local = x.sub(vector(s.origin))
            return vec2(dot(local, vector(s.along)), dot(local, vector(s.up)))
          }
          const gap = (x, r) => dot(x.sub(vector(s.origin)), vector(s.normal)).sub(r)
          // the segment on the surface now (p) and last frame (q), m, and its ends' gaps to it
          const p0 = onto(x0).toVar()
          const p1 = onto(x1).toVar()
          const g0 = gap(x0, r0).toVar()
          const g1 = gap(x1, r1).toVar()
          const moved = max(length(onto(y0).sub(p0)), length(onto(y1).sub(p1))).toVar()
          // a jump is not swept
          const sweep = moved.lessThan(SWEEP_LIMIT)
          const q0 = select(sweep, onto(y0), p0).toVar()
          const q1 = select(sweep, onto(y1), p1).toVar()
          const h0 = select(sweep, gap(y0, r0), g0).toVar()
          const h1 = select(sweep, gap(y1, r1), g1).toVar()
          const reach0 = r0.mul(u.contact)
          const reach1 = r1.mul(u.contact)
          const near = min(min(g0.sub(reach0), g1.sub(reach1)), min(h0.sub(reach0), h1.sub(reach1)))
          If(near.lessThan(0), () => {
            const pad = max(r0, r1).mul(u.spread).toVar()
            // sweep positions half a stroke's half-width apart at most
            const spacing = max(pad, cellSize).mul(0.5)
            const steps = int(clamp(ceil(select(sweep, moved, 0).div(spacing)), 1, MAX_SWEEP)).toVar()
            const lo = floor(min(min(p0, p1), min(q0, q1)).sub(pad).div(cellSize))
            const hi = floor(max(max(p0, p1), max(q0, q1)).add(pad).div(cellSize))
            const c0 = int(clamp(lo.x, 0, s.columns - 1)).toVar()
            const c1 = min(int(clamp(hi.x, 0, s.columns - 1)), c0.add(MAX_SPAN - 1)).toVar()
            const b0 = int(clamp(lo.y, 0, s.rows - 1)).toVar()
            const b1 = min(int(clamp(hi.y, 0, s.rows - 1)), b0.add(MAX_SPAN - 1)).toVar()
            const across = c1.sub(c0).add(1).toVar()
            const box = across.mul(b1.sub(b0).add(1))
            // this lane's share of the box's cells
            Loop({ start: lane, end: box, type: 'int', condition: '<', update: LANES, name: 'i' }, ({ i }) => {
              const row = b0.add(i.div(across)).toVar()
              const column = c0.add(i.mod(across)).toVar()
              const centre = vec2(float(column), float(row)).add(0.5).mul(cellSize).toVar()
              // the share of the frame the cell spent under the stroke × how firmly it pressed; the hardest slap
              const soaked = float(0).toVar()
              const slapped = float(0).toVar()
              Loop({ start: int(1), end: steps.add(1), type: 'int', condition: '<', name: 'step' }, ({ step }) => {
                const f = float(step).div(float(steps)).toVar()
                const a = mix(q0, p0, f).toVar()
                const d = mix(q1, p1, f).sub(a).toVar()
                // the nearest point of the segment, where its radius and gap are interpolated
                const t = saturate(dot(centre.sub(a), d).div(max(dot(d, d), 1e-12))).toVar()
                const distance = length(centre.sub(a.add(d.mul(t))))
                const radius = mix(r0, r1, t).toVar()
                const was = mix(h0, h1, t).toVar()
                const now = mix(g0, g1, t).toVar()
                const press = smoothstep(0, max(radius.mul(u.contact), 1e-5), mix(was, now, f)).oneMinus()
                // the share of the cell the stroke covers, its edge a cell wide
                const touch = saturate(radius.mul(u.spread).sub(distance).div(cellSize).add(0.5)).mul(press).toVar()
                soaked.addAssign(touch)
                slapped.assign(max(slapped, touch.mul(saturate(was.sub(now).mul(u.slap)))))
              })
              const wet = soaked.div(float(steps)).mul(deposit).add(slapped.mul(u.amount)).toVar()
              If(wet.greaterThan(0), () => {
                const cell = cells.element(uint(row.mul(s.columns).add(column).add(s.offset)))
                cell.y.assign(max(cell.y, wet))
              })
            })
          })
        })
      })
    })()
      .compute(count * LANES)
      .setName(`wetPaint_paint_${noodles.name || 'noodles'}`)
    this.#paints.set(noodles, { node, last, localToWorld, radius })
    return node
  }

  /**
   * Surface `index`'s film at `point` (default: the fragment's world position), a quadratic B-spline through the
   * cells: a TSL vec3, the film (1 on a lone soaked stroke) and its gradient along the surface's `along` and `up`, /m.
   */
  sample(index, point = positionWorld) {
    const s = this.surfaces[index]
    const reader = this.#reader
    const local = point.sub(vector(s.origin))
    // in cells, a cell's centre on a whole number
    const a = dot(local, vector(s.along)).div(this.cellSize).sub(0.5).toVar()
    const b = dot(local, vector(s.up)).div(this.cellSize).sub(0.5).toVar()
    const a0 = round(a).toVar()
    const b0 = round(b).toVar()
    // the weights of the cells −1, 0 and +1 from the nearest, and their derivatives
    const spline = (f) => [
      f.oneMinus().sub(0.5).pow2().mul(0.5),
      f.pow2().oneMinus().sub(0.25),
      f.add(0.5).pow2().mul(0.5),
    ]
    const slope = (f) => [f.sub(0.5), f.mul(-2), f.add(0.5)]
    const fa = a.sub(a0).toVar()
    const fb = b.sub(b0).toVar()
    const [wa, da, wb, db] = [spline(fa), slope(fa), spline(fb), slope(fb)]
    const at = (i, j) => {
      const column = clamp(a0.add(i), 0, s.columns - 1)
      const row = clamp(b0.add(j), 0, s.rows - 1)
      return reader.element(uint(row.mul(s.columns).add(column)).add(uint(s.offset)))
    }
    let value = float(0)
    let alongSlope = float(0)
    let upSlope = float(0)
    for (let j = 0; j < 3; j++) {
      const cells = [0, 1, 2].map((i) => at(i - 1, j - 1).toVar())
      const sum = cells.reduce((total, cell, i) => total.add(cell.mul(wa[i])), float(0)).toVar()
      const sumSlope = cells.reduce((total, cell, i) => total.add(cell.mul(da[i])), float(0))
      value = value.add(sum.mul(wb[j]))
      alongSlope = alongSlope.add(sumSlope.mul(wb[j]))
      upSlope = upSlope.add(sum.mul(db[j]))
    }
    return vec3(value, vec2(alongSlope, upSlope).div(this.cellSize))
  }

  /**
   * Applies the settings and this frame's paint and drying (`delta`, s), and follows each painter's matrixWorld. While
   * time stands still (`delta` 0) the film passes don't run, so a change to the blur re-blurs the film here.
   */
  update(renderer, delta) {
    this.#renderer = renderer
    const u = this.#u
    const stepping = delta > 0
    if (stepping) this.#frame = (this.#frame % 0x100000) + 1
    u.frame.value = this.#frame
    u.half.value = this.#frame % 2
    // ln of this frame's fade; −100 dries at once
    u.decay.value = stepping ? (this.dryTime > 0 ? -delta / this.dryTime : -100) : 0
    u.dryAmplitude.value = THREE.MathUtils.clamp(this.dryAmplitude, 0, 1)
    u.dryFrequency.value = Math.max(this.dryFrequency, 0)
    const amount = THREE.MathUtils.clamp(this.amount, 0, 1)
    u.amount.value = amount
    u.deposit.value = stepping ? (this.paintTime > 0 ? (amount * delta) / this.paintTime : amount) : 0
    u.slap.value = stepping && this.slapSpeed > 0 ? 1 / (this.slapSpeed * delta) : 0
    u.spread.value = Math.max(this.spread, 0)
    u.contact.value = Math.max(this.contact, 1e-3)
    for (const [noodles, paint] of this.#paints) paint.localToWorld.value.copy(noodles.matrixWorld)
    const surfaceRates = this.#surfaceRates
    const paintRates = this.#paintRates
    let dryEdited = false
    let paintEdited = false
    for (let i = 0; i < this.surfaces.length; i++) {
      const s = this.surfaces[i]
      const dry = Math.max(s.dryRate, 0)
      const paint = Math.max(s.paintRate, 0)
      if (!Object.is(surfaceRates.array[i], dry)) {
        surfaceRates.array[i] = dry
        dryEdited = true
      }
      if (!Object.is(paintRates.array[i], paint)) {
        paintRates.array[i] = paint
        paintEdited = true
      }
    }
    if (dryEdited) changed(surfaceRates)
    if (paintEdited) changed(paintRates)

    const sigma = Math.min(Math.max(this.blur, 0) / this.cellSize, MAX_TAPS / BLUR_REACH) // cells
    const halfWidth = (u.spread.value * this.#radius()) / this.cellSize // cells
    const key = `${sigma} ${halfWidth}`
    if (key === this.#blurKey) return
    this.#blurKey = key
    const taps = Math.ceil(BLUR_REACH * sigma)
    const weights = u.weights.array.fill(0)
    for (let k = 0; k <= taps; k++) weights[k] = sigma > 0 ? Math.exp(-(k * k) / (2 * sigma * sigma)) : 1
    const total = weights.reduce((sum, w, k) => sum + (k > 0 ? 2 * w : w), 0)
    for (let k = 0; k <= taps; k++) weights[k] /= total
    changed(u.weights)
    // a lone soaked stroke's peak after the blur, the band the paint covers across the kernel: the film's gain
    let peak = 0
    for (let k = -taps; k <= taps; k++) {
      peak += weights[Math.abs(k)] * THREE.MathUtils.clamp(halfWidth - Math.abs(k) + 0.5, 0, 1)
    }
    u.taps.value = taps
    u.gain.value = 1 / Math.max(peak, 0.05)
    if (!stepping) renderer.compute(this.#filmPasses)
  }

  /**
   * Compiles clear()'s pass ahead of its first dispatch; await it first, as a dispatch doesn't wait. The other passes
   * run in the noodles' extraPasses, which their compileAsync() covers.
   */
  compileAsync(renderer) {
    return renderer.compileComputeAsync(this.#clear)
  }

  /** Dries every surface at once, and restarts the strokes' sweeps. */
  clear(renderer) {
    this.#renderer = renderer
    this.#frame = (this.#frame % 0x100000) + 2
    renderer.compute(this.#clear)
  }

  /** Frees the paint pass of `noodles`; take it out of their extraPasses first. */
  release(noodles) {
    const paint = this.#paints.get(noodles)
    if (!paint) return
    this.#paints.delete(noodles)
    paint.node.dispose()
    this.#free(paint.last)
  }

  /** Frees the passes and the buffers; take the passes out of every noodles' extraPasses first. */
  dispose() {
    for (const noodles of [...this.#paints.keys()]) this.release(noodles)
    for (const node of [...this.#filmPasses, this.#clear]) node.dispose()
    for (const array of [this.#cells, this.#rows, this.#film]) this.#free(array)
  }

  // Frees the GPU buffer of a storage node.
  #free(array) {
    const renderer = this.#renderer
    if (renderer === null) return
    const { backend, info, _attributes: attributes } = renderer
    const attribute = array.value
    if (!backend.has(attribute) || !backend.get(attribute).buffer) return
    if (!attributes?.delete(attribute)) {
      backend.destroyAttribute(attribute)
      info.destroyAttribute(attribute)
    }
  }

  // The surface of buffer cell `index` (an int node), its grid, and the cell's column and row in it.
  #locate(index) {
    const surfaces = this.surfaces
    let surface = int(0)
    let offset = int(surfaces[0].offset)
    let columns = int(surfaces[0].columns)
    let rows = int(surfaces[0].rows)
    surfaces.forEach((s, i) => {
      if (i === 0) return
      const inside = index.greaterThanEqual(s.offset)
      surface = select(inside, int(i), surface)
      offset = select(inside, int(s.offset), offset)
      columns = select(inside, int(s.columns), columns)
      rows = select(inside, int(s.rows), rows)
    })
    offset = offset.toVar()
    columns = columns.toVar()
    const local = index.sub(offset)
    return {
      surface: surface.toVar(),
      offset,
      columns,
      rows: rows.toVar(),
      column: local.mod(columns).toVar(),
      row: local.div(columns).toVar(),
    }
  }

  // The widest radius any painter paints with, m.
  #radius() {
    let radius = 0
    for (const paint of this.#paints.values()) radius = Math.max(radius, paint.radius)
    return radius
  }

  // At this thread's cell, the Gaussian sum of `read(index)` over the taps: `at(tap)` the buffer index of the tap `tap`
  // cells away.
  #blur(at, read) {
    const u = this.#u
    const sum = float(0).toVar()
    Loop({ start: u.taps.negate(), end: u.taps.add(1), type: 'int', condition: '<', name: 'tap' }, ({ tap }) => {
      sum.addAssign(read(uint(at(tap))).mul(u.weights.element(abs(tap))))
    })
    return sum
  }

  // The drying rate of a cell of `surface`, × the mean: the surface's dryRate × a smooth noise over the surface, the
  // noise skipped at amplitude 0.
  #dryRate(surface, column, row) {
    const u = this.#u
    const rate = float(1).toVar()
    If(u.dryAmplitude.greaterThan(0), () => {
      const q = vec2(float(column), float(row))
        .add(0.5)
        .mul(u.dryFrequency.mul(this.cellSize))
        .add(vec2(float(surface).mul(37.1), float(surface).mul(11.3)))
      // Perlin noise, mostly within ±0.5, stretched to ±1
      const variation = smoothstep(-0.5, 0.5, mx_noise_float(q)).mul(2).sub(1)
      // the slowest spots at amplitude 1 still dry, 20× slower than the mean
      rate.assign(max(variation.mul(u.dryAmplitude).add(1), 0.05))
    })
    return rate.mul(this.#surfaceRates.element(surface))
  }
}

// ─── Restroom ────────────────────────────────────────────────────────────────

// A tiled public restroom, 4.9 × 10 × 3 m: a row of stalls down its left wall, urinals and sinks down its right, under
// three ceiling spot lights with glowing diffusers. It is placed so the spot the figure stands on (spotX, spotZ, in the
// model's metres) is the origin, the entrance wall toward +z. The model's materials become node materials, tinted and
// roughened by the params; the floor and the tiled walls show the worms' wet trails (WetPaint): a film with soft edges,
// darker, tinted and glossy, its thickness and drying varied in noise. The lamps light the room alone, through its
// materials' lightsNode, with the lights passed in: the example lights its worms itself. Their shadows are drawn once,
// of the room alone (ROOM_LAYER), but the lamp nearest the figure redraws its own every frame, with the worms. The stall
// doors swing on their hinges when pushed (StallDoor), spring back to the angles they were modelled at and bounce off
// their stops; while one moves, the lamps whose shadow it reaches redraw. The room's static meshes draw merged, one per
// material and shadow flags, and the doors as one InstancedMesh per part.
//
//   const model = (await new GLTFLoader().loadAsync('./models/restroom.glb')).scene
//   const restroom = new Restroom(model, params, { lights: [flashlight, hemisphere] })
//   scene.add(restroom)
//   worms.colliders = [...cores, ...restroom.colliders]
//   const wet = restroom.wetness
//   worms.extraPasses.after.push(wet.paintNode(worms), ...wet.filmNodes)
//   restroom.wetness.update(renderer, delta) // every frame, before worms.update()
//   const { envScene, envPosition } = restroom
//   scene.environment = pmrem.fromScene(envScene, 0.04, 0.05, 30, { position: envPosition }).texture
//   overhead.intensity = params.overheadIntensity * restroom.update(params, time, figure.position) // every frame
//   restroom.doorNear(point, radius)?.push(point, velocity, { share: 0.15, least: 3, most: 10 }) // a bat's hit
//   for (const speed of restroom.swingDoors(params, delta)) bang(speed) // every frame: rad/s a door met a stop at
//   controls.obstacles = restroom.walkObstacles // a walker stays out of the fixtures and the doors
//   restroom.shoveDoors(eye, radius, velocity) // and the doors it walks into turn away, either way
//   restroom.keepClear(feet, radius, height) // a body walking the room stays out of the same obstacles
//   restroom.stallAt(point), restroom.stalls[i].doorway // which stall a point is in; where to line up to walk in
//   restroom.setBlood(writing.texture, { center, normal, along, width, height }) // blood in the wall tiles' shading
//   // after a change to spotX, spotZ, wetTrailCellSize or a *Detail param: restroom.dispose(), then a new Restroom;
//   // after one to the lamps or envBrightness: restroom.update(params, time), then bake envScene again

const ROOM_LAYER = 3 // the room's meshes: what the lamps' static shadows draw
const ENV_EYE = 1.2 // m above the figure's spot: where the environment is baked from
const TILE_THICKNESS = 0.012 // m: the wall tiles stand this far in from the floor's edge
const PLANE_REACH = 0.03 // m off a wet surface's plane a fragment still shows its film
const BLOOD_MATERIALS = ['wall-tile'] // the materials the blood on a wall shades
const NO_BLOOD = new THREE.DataTexture(new Uint8Array(4), 1, 1) // transparent: no blood
NO_BLOOD.needsUpdate = true
const RESTROOM_OPTIONS = ['lights']
const DOOR_SUBSTEP = 1 / 240 // s: the hinge's integration step
const DOOR_FIT_STEP = THREE.MathUtils.degToRad(0.5) // rad: StallDoor.fitTo()'s sweep
const DOOR_HALF_THICKNESS = 0.02 // m: the panel's, and its spheres' radius
const DOOR_SPHERE_SPACING = 0.04 // m between a door's spheres, under twice their radius: no walker slips between
const PART_WELD = 1e-4 // m within which a part's vertices are one
const PART_LEAST = 0.02 // m: parts smaller across, in xz, are left out of the walker's obstacles
const STUB_DEPTH = 0.3 // m: a wall tiles' part jutting this far into the room is a stub wall, not a lining
// The bowls' shapes, m: a basin's deck at the wall (where the tap stands), its rims, and its floor below the rim; a
// urinal's back plate, rims, and heights above its bottom of its floor, its front lip and its side rims.
const SINK_BOWL = { back: 0.085, side: 0.04, front: 0.04, depth: 0.1 }
const URINAL_BOWL = { back: 0.07, side: 0.045, front: 0.04, floor: 0.15, frontTop: 0.23, sideTop: 0.4 }
const PART_JOIN = 0.005 // m within which the boxes of one fixture's parts are one box
const STALL_HIGH = 1.9 // m: parts of the stalls starting above it (the head rail and its posts) are no worm collider
const STALL_POST = 0.06 // m a stall's opening reaches past its door, to the posts each side
const DOORWAY_OUT = 0.45 // m before a stall's front, in the aisle, a body lines up to walk in
const KEEP_PASSES = 4 // keepClear()'s sweeps: a push out of one obstacle can push into another
// The params whose change draws the static shadows again
const SHADOW_KEYS = ['lampShadows', 'lampShadowMapSize', 'lampShadowBias', 'lampShadowNormalBias', 'lampAngle']
const _restroomUp = new THREE.Vector3(0, 1, 0)
const _restroomLocal = new THREE.Vector3()
const _arm = new THREE.Vector3()
const _normal = new THREE.Vector3()
const _relative = new THREE.Matrix4()
const _matrix = new THREE.Matrix4()
const _identity = new THREE.Matrix4()
const _childBox = new THREE.Box3()
const _swept = new THREE.Box3()
const _sphere = new THREE.Sphere()

// `object`'s matrix in the space of `ancestor`, from the local matrices between them.
function matrixIn(object, ancestor, target) {
  target.identity()
  for (let node = object; node !== ancestor; node = node.parent) target.premultiply(node.matrix)
  return target
}

// Whether `object` is a mesh of one material drawn as placed, one a merge or an InstancedMesh can stand in for.
function plainMesh(object) {
  return (
    object.isMesh &&
    !object.isInstancedMesh &&
    !object.isBatchedMesh &&
    !object.isSkinnedMesh &&
    !Array.isArray(object.material)
  )
}

// Whether `mesh` would draw the same as a child of its ancestor `room`: shown, and under no node between them that
// changes how it draws (a hidden one, an LOD, a clipping group, a group of another render order).
function drawsAsChildOf(mesh, room) {
  for (let node = mesh; node !== room; node = node.parent) {
    if (!node.visible || node.isLOD || node.isClippingGroup) return false
    if (node !== mesh && node.isGroup && node.renderOrder !== room.renderOrder) return false
  }
  return true
}

// Whether two geometries hold the same index, attributes and draw range, value for value.
function sameGeometry(a, b) {
  if (a === b) return true
  if (a.drawRange.start !== b.drawRange.start || a.drawRange.count !== b.drawRange.count) return false
  const same = (x, y) =>
    x === y ||
    (x?.constructor === y?.constructor &&
      x.itemSize === y.itemSize &&
      x.normalized === y.normalized &&
      x.array.constructor === y.array.constructor &&
      x.array.length === y.array.length &&
      x.array.every((value, i) => value === y.array[i]))
  const names = Object.keys(a.attributes)
  if (names.length !== Object.keys(b.attributes).length) return false
  if (Object.keys(a.morphAttributes).length + Object.keys(b.morphAttributes).length > 0) return false
  return same(a.index, b.index) && names.every((name) => same(a.attributes[name], b.attributes[name]))
}

// One geometry of `meshes`, in the space of their ancestor `space`: their matrices baked in, the attributes they all
// have, and none that only some have unless the material samples no texture (a uv it doesn't read). Null if they
// don't merge.
function mergedGeometry(meshes, space) {
  const [first] = meshes
  const textured = Object.values(first.material).some((value) => value?.isTexture)
  const names = Object.keys(first.geometry.attributes).filter((name) =>
    meshes.every(({ geometry }) => geometry.attributes[name]),
  )
  const parts = []
  for (const mesh of meshes) {
    const { geometry } = mesh
    if ((geometry.index === null) !== (first.geometry.index === null)) return null
    if (textured && Object.keys(geometry.attributes).length > names.length) return null
    const part = new THREE.BufferGeometry()
    for (const name of names) part.setAttribute(name, geometry.attributes[name])
    part.setIndex(geometry.index)
    matrixIn(mesh, space, _matrix)
    parts.push(_matrix.equals(_identity) ? part : part.clone().applyMatrix4(_matrix))
  }
  return mergeGeometries(parts)
}

// A box round each separate part of `object`'s meshes, world space: its vertices welded within PART_WELD, joined by
// their triangles; parts under PART_LEAST across in xz are left out.
function partsOf(object) {
  const boxes = []
  object?.traverse((mesh) => {
    if (!mesh.isMesh) return
    const { index, attributes } = mesh.geometry
    const position = attributes.position
    const parent = new Int32Array(position.count).map((_, i) => i)
    const find = (i) => {
      while (parent[i] !== i) i = parent[i] = parent[parent[i]]
      return i
    }
    const join = (a, b) => {
      parent[find(a)] = find(b)
    }
    const welded = new Map()
    for (let i = 0; i < position.count; i++) {
      const key = [position.getX(i), position.getY(i), position.getZ(i)].map((v) => Math.round(v / PART_WELD)).join()
      if (welded.has(key)) join(i, welded.get(key))
      else welded.set(key, i)
    }
    const corners = index ? index.count : position.count
    for (let t = 0; t + 2 < corners; t += 3) {
      const [a, b, c] = [t, t + 1, t + 2].map((k) => (index ? index.getX(k) : k))
      join(a, b)
      join(a, c)
    }
    const parts = new Map()
    for (let i = 0; i < position.count; i++) {
      const root = find(i)
      if (!parts.has(root)) parts.set(root, new THREE.Box3())
      parts.get(root).expandByPoint(_restroomLocal.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld))
    }
    for (const box of parts.values()) {
      if (Math.max(box.max.x - box.min.x, box.max.z - box.min.z) >= PART_LEAST) boxes.push(box)
    }
  })
  return boxes
}

// A wall-hung bowl's box as five boxes round its open middle, for the worms: its floor up to `floor` (y), its side and
// front rims `side` and `front` m thick up to `sideTop` and `frontTop`, its back `back` m thick at the wall, all its
// height. The wall is the side of `bounds`, the room's walls, its box lies nearest.
function bowlOf(box, bounds, { back, side, front, floor, sideTop = box.max.y, frontTop = box.max.y }) {
  const { min, max } = box
  const gaps = [min.x - bounds.min.x, bounds.max.x - max.x, min.z - bounds.min.z, bounds.max.z - max.z]
  const wall = gaps.indexOf(Math.min(...gaps))
  const out = wall < 2 ? 'x' : 'z'
  const across = wall < 2 ? 'z' : 'x'
  const bottom = box.clone()
  bottom.max.y = floor
  const left = box.clone()
  left.max[across] = min[across] + side
  left.max.y = sideTop
  const right = box.clone()
  right.min[across] = max[across] - side
  right.max.y = sideTop
  const lip = box.clone()
  lip.max.y = frontTop
  const plate = box.clone()
  if (wall % 2 === 1) {
    lip.max[out] = min[out] + front
    plate.min[out] = max[out] - back
  } else {
    lip.min[out] = max[out] - front
    plate.max[out] = min[out] + back
  }
  return [bottom, left, right, lip, plate]
}

// The boxes of `boxes` that touch or overlap, within PART_JOIN, as one box each: the parts of one fixture.
function joined(boxes) {
  const out = []
  for (const box of boxes) {
    const grown = box.clone().expandByScalar(PART_JOIN)
    const touching = out.filter((other) => other.intersectsBox(grown))
    const merged = touching.reduce((sum, other) => sum.union(other), box.clone())
    out.splice(0, out.length, ...out.filter((other) => !touching.includes(other)), merged)
  }
  return out
}

// Out of a Box3's or a Sphere's footprint on the floor, grown by `radius`, for a body from the floor to `height` that
// overlaps it vertically: to its closest point plus the radius, or from inside out through the nearest side. Returns
// whether it moved.
function pushOut(position, obstacle, radius, height) {
  if (obstacle.isSphere) {
    const { center } = obstacle
    const dy = center.y < 0 ? -center.y : center.y > height ? center.y - height : 0
    if (dy >= obstacle.radius) return false
    const reach = Math.sqrt(obstacle.radius ** 2 - dy ** 2) + radius
    const dx = position.x - center.x
    const dz = position.z - center.z
    const distance = Math.hypot(dx, dz)
    if (distance >= reach) return false
    if (distance > 0) {
      position.x = center.x + (dx / distance) * reach
      position.z = center.z + (dz / distance) * reach
    } else position.x = center.x + reach
    return true
  }
  const { min, max } = obstacle
  if (max.y <= 0 || min.y >= height) return false
  const closestX = THREE.MathUtils.clamp(position.x, min.x, max.x)
  const closestZ = THREE.MathUtils.clamp(position.z, min.z, max.z)
  const dx = position.x - closestX
  const dz = position.z - closestZ
  const distance = Math.hypot(dx, dz)
  if (distance > 0) {
    if (distance >= radius) return false
    position.x = closestX + (dx / distance) * radius
    position.z = closestZ + (dz / distance) * radius
    return true
  }
  const sides = [position.x - min.x, max.x - position.x, position.z - min.z, max.z - position.z]
  const nearest = sides.indexOf(Math.min(...sides))
  if (nearest === 0) position.x = min.x - radius
  else if (nearest === 1) position.x = max.x + radius
  else if (nearest === 2) position.z = min.z - radius
  else position.z = max.z + radius
  return true
}

// A stall door on its hinge, the door node's origin, turning about its parent's y: open by `angle` into the aisle above
// 0, into the stall below. Pushes set it swinging; a damped spring pulls it back to the angle it was modelled at
// (`rest`), and it bounces off a stop each way: open at openLimit or the wall, shut at what stands in the stall.
class StallDoor {
  isStallDoor = true
  type = 'StallDoor'
  /** rad: 0 closed, open into the aisle above 0, into the stall below. */
  angle = 0
  /** rad/s, opening above 0. */
  speed = 0
  /** rad: the angle it was modelled at, which it springs back to. */
  rest = 0
  /** rad it opens into the aisle before its panel meets a wall (fitTo()); step()'s openLimit stops it too. */
  openStop = Math.PI
  /** rad it swings into the stall before its panel meets a wall or what stands there (fitTo()). */
  shutStop = 0
  /** Spheres along the panel at mid height, world space, following its swing: a walker's obstacles. */
  spheres = []
  /** The shut panel's hinge end and free end, world space, on the floor (fitTo()). */
  shutEnds = [new THREE.Vector3(), new THREE.Vector3()]
  /** The panel and its hardware as it stands, world space: round their box in the node's space. */
  box = new THREE.Box3()
  object
  #closed = new THREE.Quaternion() // the node's quaternion at angle 0
  #box = new THREE.Box3() // the panel and its hardware, in the node's space
  #inverse = new THREE.Matrix4()
  #hinge = new THREE.Vector3()
  #free = 0 // node z of the panel's free edge (the hinge at 0)
  #held = 0 // the way (1 opening, -1 shutting) a body against the panel keeps it from turning, the next step()
  #middle = 0 // node y of the panel's middle

  constructor(object) {
    this.object = object
    const q = object.quaternion
    this.rest = 2 * Math.atan2(q.y, q.w)
    this.angle = this.rest
    this.#closed.setFromAxisAngle(_restroomUp, -this.rest).multiply(q)
    object.updateWorldMatrix(true, true)
    this.#inverse.copy(object.matrixWorld).invert()
    object.traverse((child) => {
      if (!child.isMesh) return
      if (!child.geometry.boundingBox) child.geometry.computeBoundingBox()
      _relative.multiplyMatrices(this.#inverse, child.matrixWorld)
      this.#box.union(_childBox.copy(child.geometry.boundingBox).applyMatrix4(_relative))
    })
    const box = this.#box
    this.#free = Math.abs(box.max.z) > Math.abs(box.min.z) ? box.max.z : box.min.z
    this.#middle = (box.min.y + box.max.y) / 2
    const count = Math.max(Math.ceil(Math.abs(this.#free) / DOOR_SPHERE_SPACING), 1) + 1
    for (let i = 0; i < count; i++) this.spheres.push(new THREE.Sphere(new THREE.Vector3(), DOOR_HALF_THICKNESS))
    this.#place()
  }

  // Sets openStop and shutStop: how far the door turns each way from shut with its panel's free half `margin` m inside
  // the walls of `bounds` and, swinging into the stall, out of every box in `obstacles` it doesn't meet shut (world).
  fitTo(bounds, obstacles = [], margin = 0.005) {
    const angle = this.angle
    this.angle = 0
    this.#place()
    this.shutEnds[0].set(0, 0, 0).applyMatrix4(this.object.matrixWorld).setY(0)
    this.shutEnds[1].set(0, 0, this.#free).applyMatrix4(this.object.matrixWorld).setY(0)
    const frame = obstacles.filter((box) => !this.#clear(null, [box], 0))
    const inside = obstacles.filter((box) => !frame.includes(box))
    this.openStop = this.#sweep(1, bounds, [], margin)
    this.shutStop = this.#sweep(-1, bounds, inside, margin)
    this.angle = angle
    this.#place()
  }

  /** m from a world point to the door, 0 inside it. */
  distanceTo(point) {
    return this.#box.distanceToPoint(_restroomLocal.copy(point).applyMatrix4(this.#inverse))
  }

  /**
   * A push at a world point by something moving at `velocity` (m/s) through it: it swings away from the pusher's side
   * (where it came `from`, else from its velocity) at `share` of its speed across it, `least` to `most` rad/s.
   */
  push(point, velocity, { share = 0.15, least = 0, most = Infinity } = {}, from = null) {
    _arm.subVectors(point, this.#hinge).setY(0)
    const reach = Math.max(_arm.length(), 0.05)
    // the panel's normal: its own +x, the way it moves as it opens
    _normal.set(1, 0, 0).applyQuaternion(this.object.quaternion)
    const across = velocity.dot(_normal)
    const side = from
      ? Math.sign(this.#box.min.x + this.#box.max.x - 2 * _restroomLocal.copy(from).applyMatrix4(this.#inverse).x)
      : 0
    // a pusher on the +x side swings it toward −x: shut
    const way = side !== 0 ? side : Math.sign(across)
    const kick = Math.max((share * Math.abs(across)) / reach, least)
    this.speed = THREE.MathUtils.clamp(this.speed + way * kick, -most, most)
  }

  /**
   * A body at `from` (world space) walking at `velocity` (m/s) against the panel: the door turns away from it at
   * `share` of the speed it walks into it, and through the next step() it can't turn toward it.
   */
  shove(from, velocity, share = 1) {
    _restroomLocal.copy(from).applyMatrix4(this.#inverse)
    // a body on the −x side, in the stall, opens it
    const way = _restroomLocal.x < 0 ? 1 : -1
    const reach = Math.max(Math.hypot(_restroomLocal.x, _restroomLocal.z), 0.05)
    _normal.set(1, 0, 0).applyQuaternion(this.object.quaternion)
    const turn = (share * Math.max(way * velocity.dot(_normal), 0)) / reach
    if (this.speed * way < turn) this.speed = way * turn
    this.#held = -way
  }

  /** `delta` s of swinging; returns the rad/s it met a stop at, 0 for none. */
  step(delta, { frequency, damping, bounce, openBounce, openLimit }) {
    const high = Math.min(Math.max(openLimit, 0), this.openStop)
    const low = -this.shutStop
    const rest = THREE.MathUtils.clamp(this.rest, low, high)
    const held = this.#held
    this.#held = 0
    if (this.speed === 0 && this.angle === rest) return 0
    const omega = 2 * Math.PI * Math.max(frequency, 0)
    let impact = 0
    const steps = Math.ceil(delta / DOOR_SUBSTEP)
    const h = delta / Math.max(steps, 1)
    for (let i = 0; i < steps; i++) {
      this.speed += (-omega * omega * (this.angle - rest) - 2 * damping * omega * this.speed) * h
      if (held !== 0 && Math.sign(this.speed) === held) this.speed = 0
      this.angle += this.speed * h
      if (this.angle < low) {
        this.angle = low
        if (this.speed < 0) {
          impact = Math.max(impact, -this.speed)
          this.speed *= -bounce
        }
      } else if (this.angle > high) {
        this.angle = high
        if (this.speed > 0) {
          impact = Math.max(impact, this.speed)
          this.speed *= -openBounce
        }
      }
    }
    // settled
    if (Math.abs(this.speed) < 2e-3 && Math.abs(this.angle - rest) < 2e-3) {
      this.speed = 0
      this.angle = rest
    }
    this.#place()
    return impact
  }

  /** Back to its modelled angle within its stops, still. */
  reset() {
    this.angle = THREE.MathUtils.clamp(this.rest, -this.shutStop, this.openStop)
    this.speed = 0
    this.#place()
  }

  // rad the door turns `way` (1 open, −1 shut) from shut before its panel's free half leaves the walls or meets a box
  #sweep(way, bounds, boxes, margin) {
    for (let a = DOOR_FIT_STEP; a <= Math.PI; a += DOOR_FIT_STEP) {
      this.angle = way * a
      this.#place()
      if (!this.#clear(bounds, boxes, margin)) return a - DOOR_FIT_STEP
    }
    return Math.PI
  }

  // Whether the corners of the panel's free half lie `margin` m inside the walls of `bounds` (unless null) and out of
  // the xz of every box, as it stands.
  #clear(bounds, boxes, margin) {
    for (let i = 0; i < 4; i++) {
      const x = i & 1 ? DOOR_HALF_THICKNESS : -DOOR_HALF_THICKNESS
      _restroomLocal.set(x, this.#middle, (i & 2 ? 1 : 0.5) * this.#free).applyMatrix4(this.object.matrixWorld)
      if (bounds) {
        const { min, max } = bounds
        if (_restroomLocal.x < min.x + margin || _restroomLocal.x > max.x - margin) return false
        if (_restroomLocal.z < min.z + margin || _restroomLocal.z > max.z - margin) return false
      }
      for (const { min, max } of boxes) {
        if (
          _restroomLocal.x > min.x &&
          _restroomLocal.x < max.x &&
          _restroomLocal.z > min.z &&
          _restroomLocal.z < max.z
        )
          return false
      }
    }
    return true
  }

  #place() {
    this.object.quaternion.setFromAxisAngle(_restroomUp, this.angle).multiply(this.#closed)
    this.object.updateMatrixWorld(true)
    this.#inverse.copy(this.object.matrixWorld).invert()
    this.#hinge.setFromMatrixPosition(this.object.matrixWorld)
    this.box.copy(this.#box).applyMatrix4(this.object.matrixWorld)
    const last = Math.max(this.spheres.length - 1, 1)
    this.spheres.forEach((sphere, i) => {
      sphere.center.set(0, this.#middle, (i / last) * this.#free).applyMatrix4(this.object.matrixWorld)
    })
  }
}

// The obstacles the worms collide with: a box per stall partition and toilet, the pillar by the entrance, a bowl per
// basin and urinal (bowlOf()) and a box per soap dispenser and urinal divider. The stall doors get none: worms pass
// under them.
const STALLS = ['stalls', 'toilets', 'stall-hardware']
const SINKS = ['sinks', 'soap-dispensers']
const URINALS = ['urinals', 'urinal-dividers', 'urinal-fittings']
const OBSTACLES = [STALLS, ['pillar-tiles'], SINKS, URINALS]
const DOOR_PREFIX = 'stall-door-'
// What each obstacle node is, for the sound of a bat meeting it (solidAt()).
const SURFACE_OF = {
  stalls: 'panel',
  toilets: 'ceramic',
  'stall-hardware': 'metal',
  'pillar-tiles': 'tile',
  sinks: 'ceramic',
  'soap-dispensers': 'panel',
  urinals: 'ceramic',
  'urinal-dividers': 'panel',
  'urinal-fittings': 'metal',
}
const FIXTURES = ['pillar-tiles', 'sinks', 'urinals', 'urinal-dividers']

// The model's materials each surface's params (<surface>Tint, <surface>Roughness) take, and those with a normal map
// (<surface>Normal).
const SURFACES = {
  floor: ['floor-tile'],
  tile: ['wall-tile'],
  paint: ['paint'],
  partition: ['partition'],
  ceramic: ['ceramic'],
  chrome: ['chrome'],
  plastic: ['plastic', 'seat'],
}
const NORMAL_SURFACES = ['floor', 'tile']
// The materials the worms' wet trails show on.
const WET_MATERIALS = ['floor-tile', 'wall-tile']

// Tileable fBm value noise, two independent channels, for the wet film's thickness: four octaves of a smoothly
// interpolated lattice whose periods divide the texture.
const WET_NOISE = (() => {
  const size = 256
  const data = new Uint8Array(size * size * 4)
  const sum = new Float32Array(2 * size * size)
  let state = 0x2545f491
  const random = () => {
    state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0
    return ((state ^ (state >>> 13)) >>> 0) / 4294967296
  }
  const fade = (t) => t * t * (3 - 2 * t)
  for (let channel = 0; channel < 2; channel++) {
    let amplitude = 1
    let total = 0
    for (let cells = 4; cells <= 32; cells *= 2) {
      const lattice = Float32Array.from({ length: cells * cells }, random)
      const at = (i, j) => lattice[(j % cells) * cells + (i % cells)]
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const u = (x / size) * cells
          const v = (y / size) * cells
          const [i, j] = [Math.floor(u), Math.floor(v)]
          const [fu, fv] = [fade(u - i), fade(v - j)]
          const top = at(i, j) + (at(i + 1, j) - at(i, j)) * fu
          const bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fu
          sum[2 * (y * size + x) + channel] += amplitude * (top + (bottom - top) * fv)
        }
      }
      total += amplitude
      amplitude *= 0.5
    }
    for (let k = 0; k < size * size; k++) sum[2 * k + channel] /= total
  }
  for (let k = 0; k < size * size; k++) {
    // stretched about the mean: fBm piles up there
    for (let channel = 0; channel < 2; channel++) {
      data[4 * k + channel] = Math.round(THREE.MathUtils.clamp((sum[2 * k + channel] - 0.5) * 2.2 + 0.5, 0, 1) * 255)
    }
    data[4 * k + 3] = 255
  }
  const noise = new THREE.DataTexture(data, size, size)
  noise.name = 'wet noise'
  noise.wrapS = noise.wrapT = THREE.RepeatWrapping
  noise.minFilter = THREE.LinearMipmapLinearFilter
  noise.magFilter = THREE.LinearFilter
  noise.generateMipmaps = true
  noise.needsUpdate = true
  return noise
})()
const DIFFUSER = 'light-diffuser'
const FIXTURE_LIGHTS = 'light-fixtures' // the lamps' housings and diffusers: they shade nothing
// What a model material hands its node material.
const RESTROOM_MATERIAL_KEYS = [
  'name',
  'color',
  'map',
  'roughness',
  'roughnessMap',
  'metalness',
  'metalnessMap',
  'normalMap',
  'normalMapType',
  'normalScale',
  'aoMap',
  'aoMapIntensity',
  'emissive',
  'emissiveMap',
  'emissiveIntensity',
  'vertexColors',
  'transparent',
  'opacity',
  'alphaMap',
  'alphaTest',
  'side',
  'flatShading',
]

// [0, 1) from two integers
function hashPair(a, b) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ 0x9e3779b9
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}

// A clone's spot lights point at a copy of their target that isn't in the graph: each gets its own child back.
function attachTargets(root) {
  const lamps = []
  root.traverse((object) => object.isSpotLight && lamps.push(object))
  for (const lamp of lamps) {
    lamp.clear()
    lamp.add(lamp.target)
  }
  return lamps.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
}

// A node material with the PBR settings and maps of `source`, a model material.
function toNodeMaterial(source) {
  const material = new THREE.MeshStandardNodeMaterial()
  for (const key of RESTROOM_MATERIAL_KEYS) {
    const value = source[key]
    if (value === undefined) continue
    material[key] = value?.isColor || value?.isVector2 ? value.clone() : value
  }
  return material
}

class Restroom extends THREE.Group {
  isRestroom = true
  type = 'Restroom'
  /** The ceiling spot lights, entrance to back. */
  lamps = []
  /** The stall doors, entrance to back. */
  doors = []
  /** Worm colliders, world space: the walls' and ceiling's inward planes, boxes round the fixtures, the wall stub. */
  colliders = []
  /** The room inside its walls, world space. */
  bounds = new THREE.Box3()
  /** Between the stall fronts and the fixtures opposite, floor to ceiling, world space: where a camera may go. */
  space = new THREE.Box3()
  /** The floor clear of the open stall doors too, world space: where strays are laid and the figure walks. */
  aisle = new THREE.Box3()
  /**
   * What a walker can't walk through, world space: a box round each separate part of the stalls, the toilets and the
   * fixtures, the wall stub that closes the stall row, and the doors' spheres, which follow their swing.
   */
  walkObstacles = []
  /**
   * The stalls, entrance to back: each `{ middle, half, doorway }`, the world z of its opening's middle, half its
   * width, and the point on the floor in the aisle before it where a body lines up to walk in.
   */
  stalls = []
  /** The model under its own lamps, × envBrightness, for PMREMGenerator.fromScene() from envPosition. */
  envScene = new THREE.Scene()
  /** World space: ENV_EYE m above the figure's spot. */
  envPosition = new THREE.Vector3(0, ENV_EYE, 0)
  /** The worms' wet trails: surface 0 the floor, 1 the sinks' wall, 2 the back wall, 3 the entrance wall. */
  wetness
  /** The materials the wet trails show on, each with its wet mask `gloss` (0 dry, 1 wet), for a reflection pass. */
  wetMaterials = []

  #obstacles = []
  #parts = []
  #stubs = [] // the wall stub closing the stall row at the entrance end, floor to ceiling
  #surfaces = new Map() // each of #parts' surface
  #tileTop = 0
  #materials = []
  #normals = [] // [material, its model normalScale, its surface]
  #diffuser = null
  #envLamps = []
  #envDiffuser = null
  #envMaterials = []
  #lampPositions = []
  #liveLamp = -1
  #impacts = []
  #shadowKey = [] // SHADOW_KEYS' values the static shadows were drawn with
  #room = null // the model's clone
  #merged = [] // the meshes merging the room's static ones
  #doorParts = [] // each { mesh, offsets }: an InstancedMesh of one part of every door, and each part in its node
  #u = {
    tint: Object.fromEntries(Object.keys(SURFACES).map((key) => [key, uniform(new THREE.Color(1, 1, 1))])),
    roughness: Object.fromEntries(Object.keys(SURFACES).map((key) => [key, uniform(1)])),
    wetTrails: uniform(0),
    wetTrailTint: uniform(new THREE.Color()),
    wetTrailDarken: uniform(0),
    wetTrailRoughness: uniform(0),
    wetTrailThreshold: uniform(0.6),
    wetTrailSoftness: uniform(1),
    wetTrailRim: uniform(0),
    wetTrailRimWidth: uniform(0.01),
    wetTrailNoise: uniform(0),
    wetTrailDryNoise: uniform(0),
    wetTrailNoiseScale: uniform(1),
    wetTrailGlossPower: uniform(1),
    flicker: uniform(1),
    flickerZ: uniform(1e6),
    bloodMap: texture(NO_BLOOD),
    bloodCenter: uniform(new THREE.Vector3()),
    bloodNormal: uniform(new THREE.Vector3(1, 0, 0)),
    bloodAlong: uniform(new THREE.Vector3(0, 0, -1)), // ÷ the width
    bloodUp: uniform(new THREE.Vector3(0, 1, 0)), // ÷ the height
    bloodWetColor: uniform(new THREE.Color()),
    bloodDryColor: uniform(new THREE.Color()),
    bloodWetRoughness: uniform(0.15),
    bloodDryRoughness: uniform(0.55),
    bloodFilmRoughness: uniform(0.7),
    bloodFilm: uniform(1),
  }

  /**
   * @param {THREE.Object3D} model - restroom.glb's scene, left as it is: the restroom shows a clone.
   * @param {object} params - The example's params.
   * @param {object} [options]
   * @param {THREE.Light[]} [options.lights] - The scene's lights besides the lamps that light the room.
   */
  constructor(model, params, options = {}) {
    super()
    for (const key of Object.keys(options)) {
      if (!RESTROOM_OPTIONS.includes(key)) console.warn(`Restroom: unknown option "${key}".`)
    }
    this.name = 'restroom'
    this.position.set(-params.spotX, 0, -params.spotZ)

    const room = model.clone(true)
    room.name = 'restroom model'
    this.add(room)
    this.#room = room
    this.lamps = attachTargets(room)
    this.updateMatrixWorld(true)

    this.#measure(room)
    room.traverse((object) => {
      if (object.name.startsWith(DOOR_PREFIX) && !object.parent?.name.startsWith(DOOR_PREFIX)) {
        this.doors.push(new StallDoor(object))
      }
    })
    this.doors.sort((a, b) => b.object.position.z - a.object.position.z)
    for (const door of this.doors) {
      door.fitTo(this.bounds, this.#parts)
      door.reset()
    }
    this.walkObstacles = [...this.#parts, ...this.#stubs, ...this.doors.flatMap((door) => door.spheres)]
    for (const door of this.doors) {
      const [hinge, free] = door.shutEnds
      const middle = (hinge.z + free.z) / 2
      const doorway = new THREE.Vector3(this.space.min.x + DOORWAY_OUT, 0, middle)
      this.stalls.push({ middle, half: Math.abs(hinge.z - free.z) / 2 + STALL_POST, doorway })
    }
    this.#buildWetness(params)
    this.#convertMaterials(room, options.lights ?? [])
    room.traverse((object) => {
      if (!object.isMesh) return
      object.castShadow = !object.name.startsWith(FIXTURE_LIGHTS)
      object.receiveShadow = true
      object.layers.enable(ROOM_LAYER)
    })
    for (const lamp of this.lamps) {
      lamp.shadow.camera.near = 0.1
      lamp.shadow.camera.far = 15
      lamp.shadow.autoUpdate = false
      lamp.shadow.needsUpdate = true
      this.#lampPositions.push(lamp.getWorldPosition(new THREE.Vector3()))
    }
    this.#instanceDoors(room)
    this.#mergeStatic(room)
    this.#buildEnvironment(model)

    this.update(params, 0)
  }

  /** Whether a sphere of `radius` at `point` (world space) fits inside the walls, clear of every collider box. */
  isClear(point, radius = 0) {
    const { min, max } = this.bounds
    if (point.x < min.x + radius || point.x > max.x - radius) return false
    if (point.z < min.z + radius || point.z > max.z - radius) return false
    if (point.y < min.y || point.y > max.y - radius) return false
    return [...this.#obstacles, ...this.#stubs].every((box) => box.distanceToPoint(point) > radius)
  }

  // ─── Layout ──────────────────────────────────────────────────────────────────

  // The room's boxes, the collider planes and boxes, from the placed model's nodes.
  #measure(room) {
    const boxOf = (names) =>
      names.reduce((box, name) => {
        const node = room.getObjectByName(name)
        return node ? box.union(new THREE.Box3().setFromObject(node)) : box
      }, new THREE.Box3())

    const floor = boxOf(['floor'])
    const height = boxOf(['paint']).max.y
    const { bounds, space, aisle } = this
    bounds.min.set(floor.min.x + TILE_THICKNESS, floor.min.y, floor.min.z + TILE_THICKNESS)
    bounds.max.set(floor.max.x - TILE_THICKNESS, height, floor.max.z - TILE_THICKNESS)
    this.#tileTop = boxOf(['wall-tiles']).max.y

    this.#obstacles = OBSTACLES.map(boxOf).filter((box) => !box.isEmpty())
    this.#parts = OBSTACLES.flat().flatMap((name) => {
      const parts = partsOf(room.getObjectByName(name))
      for (const part of parts) this.#surfaces.set(part, SURFACE_OF[name] ?? 'panel')
      return parts
    })
    // The wall tiles' parts line the walls, but for the stub that closes the stall row, which juts into the room: the
    // tiles over it, and the skirting and paint above and below, floor to ceiling.
    const width = bounds.max.x - bounds.min.x
    const length = bounds.max.z - bounds.min.z
    this.#stubs = partsOf(room.getObjectByName('wall-tiles'))
      .filter((part) => {
        const across = part.max.x - part.min.x
        return across > STUB_DEPTH && across < width - STUB_DEPTH && part.max.z - part.min.z < length / 2
      })
      .map((part) => part.set(part.min.setY(bounds.min.y), part.max.setY(bounds.max.y)))
    const doors = []
    room.traverse((object) => object.name.startsWith(DOOR_PREFIX) && doors.push(object.name))
    const stallFront = boxOf(OBSTACLES[0]).max.x
    const fixtures = FIXTURES.map((name) => boxOf([name]).min.x).filter(Number.isFinite)
    const fixtureFront = Math.min(bounds.max.x, ...fixtures)
    space.copy(bounds)
    space.min.x = Math.max(bounds.min.x, stallFront)
    space.max.x = fixtureFront
    aisle.copy(space)
    aisle.min.x = Math.max(space.min.x, boxOf(doors).max.x)

    const { min, max } = bounds
    this.colliders.push(
      new THREE.Plane(new THREE.Vector3(1, 0, 0), -min.x),
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), max.x),
      new THREE.Plane(new THREE.Vector3(0, 0, 1), -min.z),
      new THREE.Plane(new THREE.Vector3(0, 0, -1), max.z),
      new THREE.Plane(new THREE.Vector3(0, -1, 0), max.y),
    )
    const partsNamed = (name) => partsOf(room.getObjectByName(name))
    for (const names of OBSTACLES) {
      if (names === STALLS) {
        const panels = partsNamed('stalls').filter((part) => part.min.y < STALL_HIGH)
        this.colliders.push(...joined(panels), ...joined(partsNamed('toilets')))
      } else if (names === SINKS) {
        for (const basin of partsNamed('sinks')) {
          this.colliders.push(...bowlOf(basin, bounds, { ...SINK_BOWL, floor: basin.max.y - SINK_BOWL.depth }))
        }
        this.colliders.push(...partsNamed('soap-dispensers'))
      } else if (names === URINALS) {
        for (const urinal of partsNamed('urinals')) {
          const { floor, sideTop, frontTop } = URINAL_BOWL
          const bottom = urinal.min.y
          const heights = { floor: bottom + floor, sideTop: bottom + sideTop, frontTop: bottom + frontTop }
          this.colliders.push(...bowlOf(urinal, bounds, { ...URINAL_BOWL, ...heights }))
        }
        this.colliders.push(...joined(partsNamed('urinal-dividers')))
      } else {
        const box = boxOf(names)
        if (!box.isEmpty()) this.colliders.push(box)
      }
    }
    this.colliders.push(...this.#stubs)
  }

  // The floor and the three tiled walls a worm can reach; the one behind the stalls is out of it.
  #buildWetness(params) {
    const { min, max } = this.bounds
    const axis = (x, y, z) => new THREE.Vector3(x, y, z)
    const width = max.x - min.x
    const length = max.z - min.z
    const height = this.#tileTop - min.y
    const across = { along: axis(1, 0, 0), up: axis(0, 1, 0), width, height }
    const side = { along: axis(0, 0, 1), up: axis(0, 1, 0), width: length, height }
    this.wetness = new WetPaint(
      [
        { origin: min.clone(), along: axis(1, 0, 0), up: axis(0, 0, 1), normal: axis(0, 1, 0), width, height: length },
        { ...side, origin: axis(max.x, min.y, min.z), normal: axis(-1, 0, 0) },
        { ...across, origin: axis(min.x, min.y, min.z), normal: axis(0, 0, 1) },
        { ...across, origin: axis(min.x, min.y, max.z), normal: axis(0, 0, -1) },
      ],
      { cellSize: Math.max(params.wetTrailCellSize, 0.01) },
    )
  }

  // ─── Shading ─────────────────────────────────────────────────────────────────

  // The film of the wet surface this fragment lies on and faces as, else 0: the floor's skirting tops and the
  // pillar's faces lie off every surface's plane.
  #wetFilm() {
    const surfaces = this.wetness.surfaces
    return Fn(() => {
      const film = vec3(0).toVar()
      surfaces.forEach((surface, index) => {
        const normal = vector(surface.normal)
        const facing = normalWorldGeometry.dot(normal).greaterThan(0.5)
        const off = abs(positionWorld.sub(vector(surface.origin)).dot(normal))
        If(facing.and(off.lessThan(PLANE_REACH)), () => {
          film.assign(this.wetness.sample(index))
        })
      })
      return film
    })()
  }

  // The film as a wet mask: thinned where a noise says the film is thin, so it dries there first, then ramped to 1 over
  // a band round wetTrailThreshold, wetTrailSoftness × the threshold each side (0 a crisp rim). The same noise varies
  // the film's thickness, its darkness and gloss; the gloss follows the mask to wetTrailGlossPower, drying before the
  // stain. A meniscus darkens just inside the threshold, over wetTrailRimWidth (m, from the film's gradient).
  #wetMask() {
    const u = this.#u
    const film = this.#wetFilm().toVar()
    const normal = normalWorldGeometry.abs()
    const p = positionWorld
    const plane = select(
      normal.y.greaterThan(max(normal.x, normal.z)),
      p.xz,
      select(normal.x.greaterThan(normal.z), p.zy, p.xy),
    )
    const noise = texture(WET_NOISE, plane.div(u.wetTrailNoiseScale))
      .r.mul(0.65)
      .add(texture(WET_NOISE, plane.div(u.wetTrailNoiseScale.mul(0.29))).g.mul(0.35))
      .toVar()
    const keep = noise.oneMinus().mul(u.wetTrailDryNoise).mul(0.8).oneMinus().toVar()
    const value = saturate(film.x.sub(keep.oneMinus()).div(keep)).toVar()
    const threshold = u.wetTrailThreshold
    const softness = u.wetTrailSoftness
    const aa = max(fwidth(value).mul(0.5), 1e-4)
    const low = max(threshold.mul(softness.oneMinus()).sub(aa), 0)
    const high = threshold.mul(softness.add(1)).add(aa)
    const wet = smoothstep(low, high, value).mul(u.wetTrails).toVar()
    const inside = value.sub(threshold).div(max(length(film.yz).div(keep), 1e-3))
    const thickness = mix(float(1).sub(u.wetTrailNoise), float(1).add(u.wetTrailNoise.mul(0.5)), noise)
    return {
      darken: wet.mul(u.wetTrailDarken).mul(thickness).min(1),
      gloss: pow(wet, u.wetTrailGlossPower).mul(thickness.min(1)),
      rim: wet.mul(smoothstep(0, u.wetTrailRimWidth, inside).oneMinus()),
    }
  }

  // The blood setBlood() put on a wall, at this fragment: its coverage (anti-aliased), thickness and the film round it;
  // 0 off the wall's plane, facing another way or outside its rectangle.
  #bloodMask() {
    const u = this.#u
    const local = positionWorld.sub(u.bloodCenter).toVar()
    const uv = vec2(dot(local, u.bloodAlong), dot(local, u.bloodUp)).add(0.5).toVar()
    const inside = uv.x.greaterThan(0).and(uv.x.lessThan(1)).and(uv.y.greaterThan(0)).and(uv.y.lessThan(1))
    const onPlane = abs(dot(local, u.bloodNormal)).lessThan(PLANE_REACH)
    const facing = dot(normalWorldGeometry, u.bloodNormal).greaterThan(0.5)
    const on = select(inside.and(onPlane).and(facing), float(1), float(0)).toVar()
    const sample = u.bloodMap.sample(uv).toVar()
    const aa = max(fwidth(sample.a).mul(0.5), 1e-3)
    return {
      coverage: smoothstep(float(0.5).sub(aa), float(0.5).add(aa), sample.a).mul(on),
      thickness: sample.r,
      film: sample.g.mul(on),
    }
  }

  #convertMaterials(room, extraLights) {
    const u = this.#u
    const lightsNode = lights([...this.lamps, ...extraLights])
    const surfaceOf = (name) => Object.keys(SURFACES).find((key) => SURFACES[key].includes(name)) ?? null
    const converted = new Map()
    const convert = (source) => {
      const material = toNodeMaterial(source)
      material.lightsNode = lightsNode
      const surface = surfaceOf(source.name)
      let albedo = materialColor.rgb
      let roughness = materialRoughness
      if (surface) {
        albedo = albedo.mul(u.tint[surface])
        roughness = roughness.mul(u.roughness[surface])
      }
      if (WET_MATERIALS.includes(source.name)) {
        const { darken, gloss, rim } = this.#wetMask()
        albedo = mix(albedo, albedo.mul(u.wetTrailTint), darken)
        albedo = albedo.mul(rim.mul(u.wetTrailRim).oneMinus())
        roughness = mix(roughness, u.wetTrailRoughness, gloss)
        this.wetMaterials.push({ material, gloss })
      }
      if (BLOOD_MATERIALS.includes(source.name)) {
        // the blood's colour and roughness where it lies, and round it a dried film that dulls the tiles' gloss
        const { coverage, thickness, film } = this.#bloodMask()
        const blood = mix(u.bloodDryColor, u.bloodWetColor, smoothstep(0.05, 0.7, thickness))
        const bloodRoughness = mix(u.bloodDryRoughness, u.bloodWetRoughness, smoothstep(0.1, 0.8, thickness))
        albedo = mix(albedo, blood, coverage)
        roughness = mix(mix(roughness, u.bloodFilmRoughness, film.mul(u.bloodFilm).min(1)), bloodRoughness, coverage)
      }
      if (surface || WET_MATERIALS.includes(source.name) || BLOOD_MATERIALS.includes(source.name)) {
        material.colorNode = albedo
        material.roughnessNode = roughness
      }
      if (NORMAL_SURFACES.includes(surface) && material.normalMap) {
        this.#normals.push([material, material.normalScale.clone(), surface])
      }
      if (source.name === DIFFUSER) {
        // the stuttering lamp's diffuser stutters with it
        const near = abs(positionWorld.z.sub(u.flickerZ)).lessThan(0.5)
        material.emissiveNode = materialEmissive.mul(select(near, u.flicker, float(1)))
        this.#diffuser = material
      }
      this.#materials.push(material)
      return material
    }
    room.traverse((object) => {
      if (!object.isMesh) return
      const source = object.material
      if (!converted.has(source)) converted.set(source, convert(source))
      object.material = converted.get(source)
    })
  }

  // ─── Draws ───────────────────────────────────────────────────────────────────

  // The doors' parts as one InstancedMesh per part, each door an instance placed from its node (#placeDoors()); the
  // nodes stay, empty, as the doors' transforms. A part another door draws differently stays a mesh on its door, as
  // does a door node that is a mesh itself.
  #instanceDoors(room) {
    const doors = this.doors
    const parts = doors.map((door) => {
      const meshes = []
      door.object.traverse((child) => child !== door.object && plainMesh(child) && meshes.push(child))
      return meshes
    })
    for (const [k, first] of (parts[0] ?? []).entries()) {
      const set = parts.map((meshes) => meshes[k])
      const alike = (mesh) =>
        mesh?.material === first.material &&
        mesh.castShadow === first.castShadow &&
        mesh.receiveShadow === first.receiveShadow &&
        mesh.layers.mask === first.layers.mask &&
        mesh.renderOrder === first.renderOrder &&
        mesh.frustumCulled === first.frustumCulled &&
        drawsAsChildOf(mesh, room) &&
        sameGeometry(mesh.geometry, first.geometry)
      if (!set.every(alike)) continue
      const { geometry, material } = first
      const mesh = new THREE.InstancedMesh(geometry, material, doors.length)
      mesh.name = `stall doors ${material.name}`
      mesh.castShadow = first.castShadow
      mesh.receiveShadow = first.receiveShadow
      mesh.layers.mask = first.layers.mask
      mesh.renderOrder = first.renderOrder
      mesh.frustumCulled = first.frustumCulled
      const offsets = set.map((part, i) => matrixIn(part, doors[i].object, new THREE.Matrix4()))
      // round each door's part at any angle about its hinge, its node's origin: no frustum culls a swinging door
      if (!geometry.boundingBox) geometry.computeBoundingBox()
      mesh.boundingSphere = new THREE.Sphere()
      doors.forEach((door, i) => {
        const { min, max } = _childBox.copy(geometry.boundingBox).applyMatrix4(offsets[i])
        const reach = Math.hypot(Math.max(-min.x, max.x, 0), Math.max(-min.y, max.y, 0), Math.max(-min.z, max.z, 0))
        _sphere.center.setFromMatrixPosition(matrixIn(door.object, room, _matrix))
        _sphere.radius = reach * _matrix.getMaxScaleOnAxis()
        mesh.boundingSphere.union(_sphere)
      })
      mesh.boundingBox = mesh.boundingSphere.getBoundingBox(new THREE.Box3())
      for (const part of set) part.removeFromParent()
      room.add(mesh)
      this.#doorParts.push({ mesh, offsets })
    }
    this.#placeDoors()
  }

  // The doors' instances where their nodes stand. Their matrices keep the static usage: three uploads a dynamic
  // attribute at every draw, these only after a door moved.
  #placeDoors() {
    const doors = this.doors
    for (const { mesh, offsets } of this.#doorParts) {
      for (let i = 0; i < doors.length; i++) {
        mesh.setMatrixAt(i, matrixIn(doors[i].object, this.#room, _matrix).multiply(offsets[i]))
      }
      mesh.instanceMatrix.needsUpdate = true
    }
  }

  // The room's static meshes merged into one per material and shadow flags, in the room's space: one draw for what each
  // drew. The meshes left on the doors stay, as does one that would draw differently merged: as the room's child (a
  // hidden one, say), or whole (morphed, or drawing a range of its geometry). A mesh with children, or at the model's
  // top, leaves an empty node of its name and transform in its place.
  #mergeStatic(room) {
    const onDoors = []
    for (const door of this.doors) door.object.traverse((child) => child.isMesh && onDoors.push(child))
    const groups = new Map()
    room.traverse((mesh) => {
      if (!plainMesh(mesh) || onDoors.includes(mesh) || !drawsAsChildOf(mesh, room)) return
      const { geometry, material, castShadow, receiveShadow, layers, renderOrder, frustumCulled } = mesh
      const { start, count } = geometry.drawRange
      if (Object.keys(geometry.morphAttributes).length > 0 || start > 0 || count < Infinity) return
      const key = [material.id, castShadow, receiveShadow, layers.mask, renderOrder, frustumCulled].join()
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(mesh)
    })
    for (const meshes of groups.values()) {
      if (meshes.length < 2) continue
      const geometry = mergedGeometry(meshes, room)
      if (!geometry) continue
      const [first] = meshes
      const merged = new THREE.Mesh(geometry, first.material)
      merged.name = `restroom ${first.material.name}`
      merged.castShadow = first.castShadow
      merged.receiveShadow = first.receiveShadow
      merged.layers.mask = first.layers.mask
      merged.renderOrder = first.renderOrder
      merged.frustumCulled = first.frustumCulled
      for (const mesh of meshes) {
        const { parent } = mesh
        if (mesh.children.length > 0 || parent === room) {
          const node = new THREE.Object3D()
          node.name = mesh.name
          node.position.copy(mesh.position)
          node.quaternion.copy(mesh.quaternion)
          node.scale.copy(mesh.scale)
          node.matrix.copy(mesh.matrix)
          node.matrixWorld.copy(mesh.matrixWorld)
          node.matrixAutoUpdate = mesh.matrixAutoUpdate
          for (const child of [...mesh.children]) node.add(child)
          parent.add(node)
        }
        mesh.removeFromParent()
      }
      room.add(merged)
      this.#merged.push(merged)
    }
  }

  // ─── Environment ─────────────────────────────────────────────────────────────

  // Another clone of the model, placed the same, with copies of its own materials and lamps, no shadows.
  #buildEnvironment(model) {
    const room = model.clone(true)
    room.name = 'restroom env model'
    room.position.copy(this.position)
    this.#envLamps = attachTargets(room)
    for (const lamp of this.#envLamps) lamp.castShadow = false
    const copies = new Map()
    room.traverse((object) => {
      if (!object.isMesh) return
      const source = object.material
      if (!copies.has(source)) {
        const copy = source.clone()
        copy.name = `${source.name} env`
        // the bake renders without an MRT, where a material's own MRT outputs would be its only ones
        copy.mrtNode = null
        copies.set(source, copy)
        this.#envMaterials.push(copy)
        if (source.name === DIFFUSER) this.#envDiffuser = copy
      }
      object.material = copies.get(source)
    })
    this.envScene.name = 'restroom env'
    this.envScene.add(room)
  }

  #updateEnvironment(params) {
    const on = params.lamps ? params.envBrightness : 0
    for (const lamp of this.#envLamps) {
      lamp.color.set(params.lampColor)
      lamp.intensity = params.lampIntensity * on
      lamp.angle = THREE.MathUtils.degToRad(params.lampAngle)
      lamp.penumbra = params.lampPenumbra
      lamp.decay = params.lampDecay
    }
    if (this.#envDiffuser) {
      this.#envDiffuser.emissive.set(params.lampColor)
      this.#envDiffuser.emissiveIntensity = params.diffuserIntensity * on
    }
  }

  // ─── Per frame ───────────────────────────────────────────────────────────────

  // Bursts of stutter, flickerRate a second on average, each flickerBurstMin–flickerBurstMax s long, stepping
  // flickerStutter times a second.
  #flickerAt(time, params) {
    const { flickerRate: rate, flickerDepth: depth, flickerBurstMin: shortest, flickerStutter: stutter } = params
    const longest = Math.max(params.flickerBurstMax, shortest)
    const slot = Math.floor(time)
    let dip = 0
    for (const s of [slot - 1, slot]) {
      if (hashPair(s, 1) >= rate) continue
      const t = time - (s + hashPair(s, 2))
      if (t < 0 || t > shortest + (longest - shortest) * hashPair(s, 3)) continue
      dip = Math.max(dip, hashPair(s * 131 + Math.floor(t * stutter), 4) < 0.6 ? 1 : 0.3)
    }
    return 1 - depth * dip
  }

  // The static shadows show the room alone and are drawn again only when they change; the live lamp's every frame.
  #updateShadows(params, live) {
    const key = this.#shadowKey
    let redraw = false
    for (let k = 0; k < SHADOW_KEYS.length; k++) {
      const value = params[SHADOW_KEYS[k]]
      if (key[k] === value) continue
      key[k] = value
      redraw = true
    }
    this.lamps.forEach((lamp, i) => {
      const shadow = lamp.shadow
      lamp.castShadow = params.lampShadows
      if (shadow.mapSize.x !== params.lampShadowMapSize) shadow.mapSize.setScalar(params.lampShadowMapSize)
      shadow.bias = params.lampShadowBias
      shadow.normalBias = params.lampShadowNormalBias
      shadow.radius = params.lampShadowRadius // read by the receivers: the maps stay as drawn
      // the default mask, layer 0 only, takes the camera's: everything
      shadow.camera.layers.mask = i === live ? 1 : 1 << ROOM_LAYER
      shadow.autoUpdate = i === live
      if (redraw || (i === this.#liveLamp && i !== live)) shadow.needsUpdate = true
    })
    this.#liveLamp = live
  }

  /**
   * Applies the live params: tints, roughness, wet trails, the lamps, their shadows and flicker. The lamp nearest
   * `focus` (world space) redraws its shadow every frame; returns its flicker, 0–1 (1 steady).
   * @param {object} params
   * @param {number} time - s.
   * @param {THREE.Vector3} [focus]
   */
  update(params, time, focus = null) {
    const u = this.#u
    for (const key of Object.keys(SURFACES)) {
      u.tint[key].value.set(params[`${key}Tint`])
      u.roughness[key].value = params[`${key}Roughness`]
    }
    for (const [material, scale, surface] of this.#normals) {
      material.normalScale.copy(scale).multiplyScalar(params[`${surface}Normal`])
    }

    u.bloodWetColor.value.set(params.writingWetColor)
    u.bloodDryColor.value.set(params.writingDryColor)
    u.bloodWetRoughness.value = params.writingWetRoughness
    u.bloodDryRoughness.value = params.writingDryRoughness
    u.bloodFilmRoughness.value = params.writingFilmRoughness
    u.bloodFilm.value = params.writingFilm

    u.wetTrails.value = params.wetTrails ? 1 : 0
    u.wetTrailTint.value.set(params.wetTrailTint)
    u.wetTrailDarken.value = params.wetTrailDarken
    u.wetTrailRoughness.value = params.wetTrailRoughness
    u.wetTrailThreshold.value = params.wetTrailThreshold
    u.wetTrailSoftness.value = THREE.MathUtils.clamp(params.wetTrailSoftness, 0, 1)
    u.wetTrailRim.value = params.wetTrailRim
    u.wetTrailRimWidth.value = Math.max(params.wetTrailRimWidth, 1e-4)
    u.wetTrailNoise.value = params.wetTrailNoise
    u.wetTrailDryNoise.value = params.wetTrailDryNoise
    u.wetTrailNoiseScale.value = Math.max(params.wetTrailNoiseScale, 0.01)
    u.wetTrailGlossPower.value = Math.max(params.wetTrailGlossPower, 0.05)
    const wetness = this.wetness
    wetness.amount = params.wetTrails ? params.wetTrailAmount : 0
    wetness.paintTime = params.wetTrailPaintTime
    wetness.slapSpeed = params.wetTrailSlapSpeed
    wetness.dryTime = params.wetTrailDryTime
    wetness.dryAmplitude = params.wetTrailDryAmplitude
    wetness.dryFrequency = params.wetTrailDryFrequency
    wetness.spread = params.wetTrailSpread
    wetness.contact = params.wetTrailContact
    wetness.blur = params.wetTrailBlur
    for (const surface of wetness.surfaces.slice(1)) {
      surface.dryRate = params.wetTrailWallDryRate
      surface.paintRate = params.wetTrailWallPaintRate
    }

    const on = params.lamps ? 1 : 0
    const flickering = params.flicker ? Math.round(params.flickerLamp) - 1 : -1
    const flicker = flickering >= 0 ? this.#flickerAt(time, params) : 1
    u.flicker.value = flicker
    u.flickerZ.value = this.#lampPositions[flickering]?.z ?? 1e6
    let nearest = -1
    if (focus) {
      let best = Infinity
      this.#lampPositions.forEach((p, i) => {
        const d = Math.hypot(p.x - focus.x, p.z - focus.z)
        if (d < best) [best, nearest] = [d, i]
      })
    }
    this.lamps.forEach((lamp, i) => {
      lamp.color.set(params.lampColor)
      lamp.intensity = params.lampIntensity * on * (i === flickering ? flicker : 1)
      lamp.angle = THREE.MathUtils.degToRad(params.lampAngle)
      lamp.penumbra = params.lampPenumbra
      lamp.decay = params.lampDecay
    })
    this.#updateShadows(params, params.lampWormShadows ? nearest : -1)
    if (this.#diffuser) {
      this.#diffuser.emissive.set(params.lampColor)
      this.#diffuser.emissiveIntensity = params.diffuserIntensity * on
    }
    this.#updateEnvironment(params)
    return nearest >= 0 && nearest === flickering ? flicker : 1
  }

  /** The nearest door within `radius` of a world point; null for none. */
  doorNear(point, radius = 0) {
    let nearest = null
    let best = radius
    for (const door of this.doors) {
      const distance = door.distanceTo(point)
      if (distance <= best) [best, nearest] = [distance, door]
    }
    return nearest
  }

  /**
   * `delta` s of the doors' swinging, with the params' doorReturn, doorDamping, doorBounce, doorOpenBounce and
   * doorOpenLimit (deg). While one moves, each lamp whose shadow it reaches redraws its shadow.
   * @returns {number[]} The rad/s each door that met a stop met it at.
   */
  swingDoors(params, delta) {
    const impacts = this.#impacts
    impacts.length = 0
    const settings = {
      frequency: params.doorReturn,
      damping: params.doorDamping,
      bounce: params.doorBounce,
      openBounce: params.doorOpenBounce,
      openLimit: THREE.MathUtils.degToRad(params.doorOpenLimit),
    }
    let moved = false
    for (const door of this.doors) {
      const angle = door.angle
      _swept.copy(door.box)
      const impact = door.step(delta, settings)
      if (impact > 0) impacts.push(impact)
      if (door.angle === angle) continue
      moved = true
      this.#redrawShadowsOver(_swept.union(door.box))
    }
    if (moved) this.#placeDoors()
    return impacts
  }

  // Marks for a redraw each static shadow whose frustum, as last drawn, reaches `box` (world space): where a door
  // stood and where it stands. A map that saw neither can't change.
  #redrawShadowsOver(box) {
    for (const lamp of this.lamps) {
      const shadow = lamp.shadow
      if (shadow.needsUpdate || shadow.autoUpdate) continue
      if (shadow.getFrustum().intersectsBox(box)) shadow.needsUpdate = true
    }
  }

  /**
   * Blood in the wall tiles' shading: `map` (thickness in red, the dried film round it in green, coverage in alpha;
   * null for none) over a `width` × `height` m rectangle on the wall through `center` facing `normal`, u along
   * `along`, v up. World space; colours and roughness from update()'s params.
   */
  setBlood(map, { center, normal, along, width, height }) {
    const u = this.#u
    u.bloodMap.value = map ?? NO_BLOOD
    u.bloodCenter.value.copy(center)
    u.bloodNormal.value.copy(normal).normalize()
    u.bloodAlong.value.copy(along).normalize().divideScalar(Math.max(width, 1e-3))
    u.bloodUp.value.crossVectors(u.bloodNormal.value, along).normalize().divideScalar(Math.max(height, 1e-3))
  }

  /**
   * What a ball of `radius` at a world point meets: 'tile' (the walls, the floor, the pillar), 'panel' (partitions,
   * dividers, dispensers), 'ceramic' (toilets, sinks, urinals), 'metal' (fittings) or null. The doors don't count.
   */
  solidAt(point, radius = 0) {
    const { min, max } = this.bounds
    if (point.x < min.x + radius || point.x > max.x - radius || point.z < min.z + radius) return 'tile'
    if (point.z > max.z - radius || point.y < min.y + radius) return 'tile'
    for (const part of this.#parts) if (part.distanceToPoint(point) < radius) return this.#surfaces.get(part)
    for (const stub of this.#stubs) if (stub.distanceToPoint(point) < radius) return 'tile'
    return null
  }

  /** The index in `stalls` of the stall a world point is in; -1 for none. */
  stallAt(point) {
    if (point.x >= this.space.min.x) return -1
    return this.stalls.findIndex(({ middle, half }) => Math.abs(point.z - middle) < half)
  }

  /** Whether a body of `radius` at `point` (world) lines up with stall `index`'s opening, near enough to walk in. */
  inDoorway(point, index, radius) {
    const { middle, half, doorway } = this.stalls[index]
    return Math.abs(point.z - middle) < Math.max(half - STALL_POST - radius, 0.05) && point.x < doorway.x + 0.2
  }

  /**
   * Moves a body standing at `position` (world; its y is the floor), `radius` round and `height` tall, out of
   * walkObstacles and into the walls; what lies wholly above it doesn't stop it.
   */
  keepClear(position, radius, height) {
    const { min, max } = this.bounds
    for (let pass = 0; pass < KEEP_PASSES; pass++) {
      let pushed = false
      for (const obstacle of this.walkObstacles) pushed = pushOut(position, obstacle, radius, height) || pushed
      position.x = THREE.MathUtils.clamp(position.x, min.x + radius, max.x - radius)
      position.z = THREE.MathUtils.clamp(position.z, min.z + radius, max.z - radius)
      if (!pushed) break
    }
  }

  /**
   * Every door a body of `radius` at `position` (world space), walking at `velocity` (m/s), touches turns away from it
   * at `share` of the speed it walks into it.
   */
  shoveDoors(position, radius, velocity, share = 1) {
    for (const door of this.doors) {
      if (door.distanceTo(position) < radius + DOOR_HALF_THICKNESS) door.shove(position, velocity, share)
    }
  }

  /** Every door back to its modelled angle, still. */
  resetDoors() {
    let moved = false
    for (const door of this.doors) {
      const angle = door.angle
      _swept.copy(door.box)
      door.reset()
      if (door.angle === angle) continue
      moved = true
      this.#redrawShadowsOver(_swept.union(door.box))
    }
    if (moved) this.#placeDoors()
  }

  dispose() {
    for (const lamp of [...this.lamps, ...this.#envLamps]) lamp.dispose()
    for (const material of [...this.#materials, ...this.#envMaterials]) material.dispose()
    for (const mesh of this.#merged) mesh.geometry.dispose()
    for (const { mesh } of this.#doorParts) mesh.dispose()
    this.wetness.dispose()
  }
}

// ─── Camera shake ────────────────────────────────────────────────────────────

/**
 * A handheld camera's slow wobble, layered on whatever aims the camera, and the jolt of an impact on top of it.
 *
 * Pitch and yaw each follow two sines at unrelated frequencies, so the drift never visibly repeats. kick() adds trauma
 * that decays: a fast, rough shake in pitch, yaw and roll, scaled by trauma², so small kicks barely show and big ones
 * snap. The offset turns the camera about its own axes, so it reads the same whichever way the camera looks.
 *
 *
 *   const shake = new CameraShake({ amplitude: 0.004, frequency: 0.7 })
 *   renderer.setAnimationLoop((time) => {
 *     controls.update() // sets the camera's orientation
 *     shake.apply(camera, time / 1000)
 *     renderer.render(scene, camera)
 *   })
 *   shake.kick(0.6) // an impact
 *
 * apply() multiplies the offset onto `camera.quaternion`. When something re-aims the camera every frame (OrbitControls,
 * a lookAt), that's all. When nothing does, call restore(camera) before apply() to take the last offset back off.
 *
 * Options and properties:
 *   amplitude - rad, the sway's largest turn about either axis.
 *   frequency - Hz of the sway's main sine: about one sway per 1 / frequency s.
 *   pitchShare, yawShare - × amplitude about the camera's x and y axes.
 *   kickAmplitude - rad of the jolt at trauma 1, about each axis.
 *   kickFrequency - Hz of the jolt's main sine.
 *   kickDecay - 1/s: trauma falls to 1/e in 1 / kickDecay s.
 */

const SHAKE_OPTIONS = [
  'amplitude',
  'frequency',
  'pitchShare',
  'yawShare',
  'kickAmplitude',
  'kickFrequency',
  'kickDecay',
]
class CameraShake {
  isCameraShake = true
  type = 'CameraShake'

  amplitude = 0.004
  frequency = 0.7
  pitchShare = 1
  yawShare = 1
  kickAmplitude = 0.05
  kickFrequency = 18
  kickDecay = 5

  /** The offset apply() last multiplied onto a camera. */
  quaternion = new THREE.Quaternion()

  #euler = new THREE.Euler(0, 0, 0, 'YXZ')
  #inverse = new THREE.Quaternion()
  #applied = null
  #time = 0 // of the last offset
  #kick = 0 // trauma at #kickTime
  #kickTime = 0

  /** @param {object} [options] - Any of the options above. */
  constructor(options = {}) {
    for (const key of Object.keys(options)) {
      if (!SHAKE_OPTIONS.includes(key)) console.warn(`CameraShake: unknown option "${key}".`)
      else this[key] = options[key]
    }
  }

  /**
   * Adds `amount` of trauma, 0 to 1 in all, from the time of the last offset.
   * @param {number} amount
   */
  kick(amount) {
    this.#kick = Math.min(this.traumaAt(this.#time) + amount, 1)
    this.#kickTime = this.#time
    return this
  }

  /**
   * The trauma left at `time`, in seconds.
   * @param {number} time
   * @returns {number}
   */
  traumaAt(time) {
    return this.#kick * Math.exp(-Math.max(time - this.#kickTime, 0) * this.kickDecay)
  }

  /**
   * The offset at `time`, in seconds, into `this.quaternion`.
   * @param {number} time
   * @returns {Quaternion}
   */
  offsetAt(time) {
    this.#time = time
    const t = TWO_PI * this.frequency * time
    const a = this.amplitude
    let pitch = a * this.pitchShare * (0.6 * Math.sin(t) + 0.4 * Math.sin(2.31 * t + 1.7))
    let yaw = a * this.yawShare * (0.6 * Math.sin(0.83 * t + 0.4) + 0.4 * Math.sin(1.93 * t + 2.9))
    let roll = 0
    const trauma = this.traumaAt(time)
    if (trauma > 1e-4) {
      const k = TWO_PI * this.kickFrequency * time
      const jolt = this.kickAmplitude * trauma * trauma
      pitch += jolt * (0.6 * Math.sin(k + 0.3) + 0.4 * Math.sin(2.13 * k + 1.1))
      yaw += jolt * (0.6 * Math.sin(1.27 * k + 2.2) + 0.4 * Math.sin(2.71 * k + 0.6))
      roll += jolt * (0.6 * Math.sin(0.89 * k + 4.1) + 0.4 * Math.sin(1.93 * k + 2.4))
    }
    return this.quaternion.setFromEuler(this.#euler.set(pitch, yaw, roll))
  }

  /**
   * Turns `camera` by the offset at `time`, in seconds, and updates its world matrix.
   * @param {import('three').Camera} camera
   * @param {number} time
   */
  apply(camera, time) {
    camera.quaternion.multiply(this.offsetAt(time))
    camera.updateMatrixWorld()
    this.#applied = camera
    return this
  }

  /**
   * Takes the offset apply() last gave `camera` back off.
   * @param {import('three').Camera} camera
   */
  restore(camera) {
    if (this.#applied !== camera) return this
    camera.quaternion.multiply(this.#inverse.copy(this.quaternion).invert())
    camera.updateMatrixWorld()
    this.#applied = null
    return this
  }

  copy(source) {
    for (const key of SHAKE_OPTIONS) this[key] = source[key]
    return this
  }

  clone() {
    return new this.constructor().copy(this)
  }
}

// ─── Walk controls ───────────────────────────────────────────────────────────

/**
 * First-person walking on a flat floor: WASD or the arrow keys walk relative to the view's heading, Shift runs, Alt
 * slows to a walk, C crouches (held), Space jumps, and the mouse looks around. The eye stays `height` above what the
 * feet stand on (`crouchHeight` crouched, higher in a jump), inside `bounds` and out of `obstacles`, as a body of
 * `radius`. The feet stand on `ground` or on the top of an obstacle jumped onto, and fall when they walk off it.
 * y is up.
 *
 *
 *   const controls = new WalkControls(camera, renderer.domElement, {
 *     ground: 0, // y of the floor
 *     height: 1.6, // of the eye above it
 *     bounds: new THREE.Box3().setFromObject(room), // the walkable area: its xz, less the radius
 *     obstacles: [new THREE.Box3().setFromObject(table), new THREE.Sphere(new THREE.Vector3(3, 1, 0), 1)],
 *   })
 *   controls.target.set(0, 1.6, -5) // the next update() faces it
 *
 *   const timer = new THREE.Timer()
 *   renderer.setAnimationLoop((time) => {
 *     timer.update(time)
 *     controls.update(timer.getDelta())
 *     renderer.render(scene, camera)
 *   })
 *
 * - Settings are plain properties, read on every update(); `bounds` and `obstacles` are world space, so the camera's
 *   parent is the scene (or untransformed).
 * - The walking velocity eases toward the keys' with the time constant `damping`.
 * - Keys are read on the element's document in the capture phase, so the element needs no focus and a UI that stops
 *   their propagation can't swallow a release. They are ignored while an input, textarea, select or contenteditable
 *   has focus or Ctrl or Meta is held, and released when the window loses focus.
 * - With `pointerLock`, a mouse click on the element locks the pointer, as in PointerLockControls: moving the mouse
 *   turns the view (right turns right, up looks up) and Esc releases it. Touch and pen, the mouse with `pointerLock`
 *   off, and a click whose lock the browser refuses look by dragging the first pointer down on the element, in the
 *   same directions.
 * - Virtual sticks and scripts: `moveInput` (x right, y forward) walks at its length × speed, added to the keys, and
 *   turn(yaw, pitch) turns the view on the next update().
 * - `target` is the point looked at, as in OrbitControls: set it and the next update() faces it; every update() writes
 *   it back at the distance it was set at.
 * - Events: 'change' (the camera moved or turned), 'start' and 'end' (a look drag), 'lock' and 'unlock'.
 */

const _changeEvent = { type: 'change' }
const _startEvent = { type: 'start' }
const _endEvent = { type: 'end' }
const _lockEvent = { type: 'lock' }
const _unlockEvent = { type: 'unlock' }

const WALK_OPTIONS = [
  'speed',
  'runMultiplier',
  'slowMultiplier',
  'height',
  'ground',
  'radius',
  'lookSpeed',
  'pointerLock',
  'damping',
  'bounds',
  'obstacles',
  'crouchHeight',
  'crouchMultiplier',
  'crouchTime',
  'jumpSpeed',
  'gravity',
  'footRadius',
  'headroom',
  'ceiling',
]
const EDITABLE_TAGS = ['INPUT', 'TEXTAREA', 'SELECT']
const PITCH_LIMIT = THREE.MathUtils.degToRad(89) // short of straight up or down, where the heading is undefined
const REST_SPEED = 1e-4 // m/s under which an easing stop is over
const MAX_DELTA = 0.25 // s: the most one update() advances, so a stalled frame doesn't jump
const COLLISION_PASSES = 4 // sweeps over the obstacles: a push out of one can push into another
// Most steps a move is split into, each half the radius long, so a step can't cross an obstacle
const MAX_STEPS = 64
const FOOTING = 1e-6 // m: a surface this far above the feet still holds them, against rounding
const PLACED = 1e-12 // m²: a camera moved farther than this since the last update was placed by other code

const _euler = new THREE.Euler(0, 0, 0, 'YXZ')
const _noInput = new THREE.Vector2()
const _walkDirection = new THREE.Vector3()
const _previousPosition = new THREE.Vector3()
const _previousQuaternion = new THREE.Quaternion()

const isEditable = (element) => EDITABLE_TAGS.includes(element?.tagName) || element?.isContentEditable === true

class WalkControls extends THREE.Controls {
  isWalkControls = true
  type = 'WalkControls'

  /** Walking speed, m/s. */
  speed = 3
  /** Speed factor while Shift is held. */
  runMultiplier = 2
  /** Speed factor while Alt is held: a slow walk. Both held multiply. */
  slowMultiplier = 0.4
  /** Eye height above the ground, m. */
  height = 1.6
  /** y of the floor. */
  ground = 0
  /** Eye height above the ground while crouching (keys.CROUCH held, or `crouching`), m. */
  crouchHeight = 1
  /** Speed factor while crouching. */
  crouchMultiplier = 0.5
  /** Time the eye takes to go down to crouchHeight or back up, s; 0 at once. */
  crouchTime = 0.15
  /** Upward speed a jump (keys.JUMP, or jump()) leaves the ground at, m/s; 0 never jumps. */
  jumpSpeed = 3.5
  /** Downward acceleration while in the air, m/s². */
  gravity = 9.81
  /** Radius of the feet round the eye's xz, m: the walker stands on an obstacle's top while this disc overlaps it. */
  footRadius = 0.1
  /** Height of the head above the eye, m: what obstacles, undersides and `ceiling` meet; it can block standing up. */
  headroom = 0.1
  /** y the top of the head can't rise past. */
  ceiling = Infinity
  /** Whether to crouch besides the keys, as from a virtual button. */
  crouching = false
  /** Radius of the walker's body: its distance to the bounds' sides and the obstacles, m. */
  radius = 0.3
  /** View turn per pixel the locked mouse moves or a drag covers, radians; negative inverts. */
  lookSpeed = 0.003
  /** Whether a mouse click on the element locks the pointer; off, the mouse looks by dragging. */
  pointerLock = true
  /** Time constant of the velocity's easing, s; 0 starts and stops at once. */
  damping = 0.15
  /** @type {?Box3} The walkable area: the eye's xz stays inside it, less the radius; its y extent is not read. */
  bounds = null
  /**
   * @type {Array<Box3|Sphere>} Solids the walker can't enter, world space: the eye stays out of each one's xz footprint
   *   by the radius wherever it overlaps the walker vertically.
   */
  obstacles = []
  /** The point looked at; see the class description. */
  target = new THREE.Vector3()
  /** The walking velocity, m/s (y is 0). */
  velocity = new THREE.Vector3()
  /** Analog walking, as from a virtual stick: x right, y forward, −1 to 1, added to the keys', capped at length 1. */
  moveInput = new THREE.Vector2()

  #yaw = 0
  #pitch = 0
  #crouch = 0 // 0 standing, 1 crouched, eased
  #feet = null // y of the feet, from the first update
  #under = 0 // y of the surface under the feet
  #grounded = true // standing on the ground or an obstacle
  #rise = 0 // m/s upward
  #eye = 0 // m from the feet to the eye, as last written
  #jumpQueued = false
  #pressed = []
  #pointerId = null
  #pointerX = 0
  #pointerY = 0
  #lookX = 0
  #lookY = 0
  #turnYaw = 0
  #turnPitch = 0
  #locked = false
  #targetDistance = 1
  #writtenTarget = new THREE.Vector3()
  #writtenQuaternion = new THREE.Quaternion()
  #writtenPosition = new THREE.Vector3()
  #lastTime = null
  #connected = false
  #document = null
  #window = null
  #touchAction = ''

  /**
   * @param {Camera} camera - The camera that walks.
   * @param {?HTMLElement} [domElement=null] - The element clicked or dragged to look; its document gets the key and
   *   mouse listeners.
   * @param {Object} [options] - Any of the settings above but `crouching`.
   */
  constructor(camera, domElement = null, options = {}) {
    super(camera, domElement)
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('WalkControls: options must be an object.')
    }
    for (const key of Object.keys(options)) {
      if (!WALK_OPTIONS.includes(key)) console.warn(`WalkControls: unknown option "${key}" ignored.`)
    }
    for (const key of WALK_OPTIONS) if (options[key] !== undefined) this[key] = options[key]
    if (this.bounds !== null && this.bounds?.isBox3 !== true) {
      throw new TypeError('WalkControls: bounds must be a THREE.Box3 or null.')
    }
    if (!Array.isArray(this.obstacles)) throw new TypeError('WalkControls: obstacles must be an array.')
    for (const obstacle of this.obstacles) checkObstacle(obstacle)

    /** Key codes of each action; edit to remap. */
    this.keys = {
      FORWARD: ['KeyW', 'ArrowUp'],
      BACKWARD: ['KeyS', 'ArrowDown'],
      LEFT: ['KeyA', 'ArrowLeft'],
      RIGHT: ['KeyD', 'ArrowRight'],
      RUN: ['ShiftLeft', 'ShiftRight'],
      SLOW: ['AltLeft', 'AltRight'],
      CROUCH: ['KeyC'],
      JUMP: ['Space'],
    }

    // the camera keeps its orientation: the target starts where it looks
    this.#readOrientation()
    this.#writtenQuaternion.copy(camera.quaternion)
    this.#writeTarget()

    if (domElement !== null) this.connect(domElement)
  }

  connect(element) {
    super.connect(element)
    element.addEventListener('pointerdown', this.#onPointerDown)
    element.addEventListener('pointermove', this.#onPointerMove)
    element.addEventListener('pointerup', this.#onPointerUp)
    element.addEventListener('pointercancel', this.#onPointerUp)
    element.addEventListener('lostpointercapture', this.#onPointerUp)
    this.#document = element.ownerDocument ?? null
    // capture phase: before any handler below can stop them (a UI panel may stop every key event)
    this.#document?.addEventListener('keydown', this.#onKeyDown, true)
    this.#document?.addEventListener('keyup', this.#onKeyUp, true)
    this.#document?.addEventListener('mousemove', this.#onMouseMove)
    this.#document?.addEventListener('pointerlockchange', this.#onPointerLockChange)
    this.#window = this.#document?.defaultView ?? null
    this.#window?.addEventListener('blur', this.#onBlur)
    // touch drags look instead of scrolling
    this.#touchAction = element.style.touchAction
    element.style.touchAction = 'none'
    this.#connected = true
  }

  disconnect() {
    const element = this.domElement
    if (element === null || !this.#connected) return
    this.#endDrag()
    // no listener is left to hear the lock end, so it ends here
    if (this.#locked) {
      this.#document?.exitPointerLock?.()
      this.#locked = false
      this.dispatchEvent(_unlockEvent)
    }
    this.#pressed.length = 0
    element.removeEventListener('pointerdown', this.#onPointerDown)
    element.removeEventListener('pointermove', this.#onPointerMove)
    element.removeEventListener('pointerup', this.#onPointerUp)
    element.removeEventListener('pointercancel', this.#onPointerUp)
    element.removeEventListener('lostpointercapture', this.#onPointerUp)
    this.#document?.removeEventListener('keydown', this.#onKeyDown, true)
    this.#document?.removeEventListener('keyup', this.#onKeyUp, true)
    this.#document?.removeEventListener('mousemove', this.#onMouseMove)
    this.#document?.removeEventListener('pointerlockchange', this.#onPointerLockChange)
    this.#window?.removeEventListener('blur', this.#onBlur)
    element.style.touchAction = this.#touchAction
    this.#connected = false
    this.#document = null
    this.#window = null
  }

  dispose() {
    super.dispose()
    this.disconnect()
  }

  /** Whether the pointer is locked to the element. */
  get isLocked() {
    return this.#locked
  }

  /** Locks the pointer to the element, as a click on it does; browsers honour it only within a user gesture. */
  lock() {
    // A request too soon after Esc rejects (and returns nothing in some browsers): the click's drag still looks.
    this.domElement?.requestPointerLock?.()?.catch?.(() => {})
  }

  /**
   * Turns the view on the next update(): `yaw` rad to the left, `pitch` rad up. Turns add up until then; while disabled
   * they are dropped.
   * @param {number} yaw
   * @param {number} [pitch=0]
   */
  turn(yaw, pitch = 0) {
    this.#turnYaw += yaw
    this.#turnPitch += pitch
  }

  /** Releases the pointer, as Esc does. */
  unlock() {
    if (this.#locked) this.#document?.exitPointerLock?.()
  }

  /**
   * Walks, turns, jumps and falls, keeping the eye over what the feet stand on, in the bounds and out of the obstacles.
   * @param {?number} [delta] - Seconds since the last update; measured when omitted. At most 0.25 s is advanced.
   * @return {boolean} Whether the camera moved or turned.
   */
  update(delta = null) {
    const camera = this.object
    const position = camera.position
    _previousPosition.copy(position)
    _previousQuaternion.copy(camera.quaternion)

    if (delta === null) {
      const now = performance.now()
      delta = this.#lastTime === null ? 0 : (now - this.#lastTime) / 1000
      this.#lastTime = now
    }
    delta = delta > 0 ? Math.min(delta, MAX_DELTA) : 0

    // turned by other code (lookAt, a restored pose): carry on from there
    if (!camera.quaternion.equals(this.#writtenQuaternion)) this.#readOrientation()
    // placed by other code: the feet carry on from under its eye
    if (this.#feet === null) this.#feet = this.ground
    else if (position.distanceToSquared(this.#writtenPosition) > PLACED) this.#feet = position.y - this.#eye

    // crouched by the keys or `crouching`, eased; up in a jump from whatever the feet stand on, then falling
    const crouched = this.enabled && (this.crouching || this.#held(this.keys.CROUCH))
    const ease = this.crouchTime > 0 ? delta / this.crouchTime : 1
    this.#crouch = THREE.MathUtils.clamp(this.#crouch + (crouched ? ease : -ease), 0, 1)
    if (this.#jumpQueued && this.enabled && this.#grounded && this.jumpSpeed > 0) {
      this.#rise = this.jumpSpeed
      this.#grounded = false
    }
    this.#jumpQueued = false
    const feetBefore = this.#feet
    if (!this.#grounded) {
      this.#feet += this.#rise * delta - 0.5 * this.gravity * delta * delta
      this.#rise -= this.gravity * delta
    }
    const crouch = THREE.MathUtils.smoothstep(this.#crouch, 0, 1)
    let eye = THREE.MathUtils.lerp(this.height, Math.min(this.crouchHeight, this.height), crouch)
    // the head under the ceiling and what was above it: a jump stops there, standing up stops short of it
    const radius = Math.max(this.radius, 0)
    const headroom = Math.max(this.headroom, 0)
    const overhead = this.#overhead(position, radius, feetBefore + this.#eye + headroom - FOOTING)
    if (this.#feet + eye + headroom > overhead) {
      if (this.#grounded) eye = Math.max(overhead - headroom - this.#feet, 0)
      else {
        this.#feet = Math.max(overhead - headroom - eye, feetBefore)
        this.#rise = Math.min(this.#rise, 0)
      }
    }
    this.#eye = eye
    position.y = this.#feet + eye

    // a target set since the last update: face it
    if (!this.target.equals(this.#writtenTarget)) {
      _walkDirection.subVectors(this.target, position)
      const distance = _walkDirection.length()
      if (distance > 0) {
        this.#targetDistance = distance
        // straight above or below has no heading: keep the current one
        if (_walkDirection.x !== 0 || _walkDirection.z !== 0)
          this.#yaw = Math.atan2(-_walkDirection.x, -_walkDirection.z)
        this.#pitch = THREE.MathUtils.clamp(Math.asin(_walkDirection.y / distance), -PITCH_LIMIT, PITCH_LIMIT)
      }
    }

    if (!this.enabled) {
      this.#pressed.length = 0
      this.#lookX = this.#lookY = 0
      this.#turnYaw = this.#turnPitch = 0
    }
    if (!this.pointerLock) this.unlock()
    // the pointer's travel, x right and y down: right turns right (yaw falls), up looks up
    if (this.#lookX !== 0 || this.#lookY !== 0) {
      this.#yaw =
        THREE.MathUtils.euclideanModulo(this.#yaw - this.#lookX * this.lookSpeed + Math.PI, 2 * Math.PI) - Math.PI
      this.#pitch = THREE.MathUtils.clamp(this.#pitch - this.#lookY * this.lookSpeed, -PITCH_LIMIT, PITCH_LIMIT)
      this.#lookX = this.#lookY = 0
    }
    if (this.#turnYaw !== 0 || this.#turnPitch !== 0) {
      this.#yaw = THREE.MathUtils.euclideanModulo(this.#yaw + this.#turnYaw + Math.PI, 2 * Math.PI) - Math.PI
      this.#pitch = THREE.MathUtils.clamp(this.#pitch + this.#turnPitch, -PITCH_LIMIT, PITCH_LIMIT)
      this.#turnYaw = this.#turnPitch = 0
    }

    // the keys' and the analog input's ground velocity: forward is (-sin yaw, -cos yaw), right (cos yaw, -sin yaw)
    const analog = this.enabled ? this.moveInput : _noInput
    const forward = this.#axis(this.keys.FORWARD, this.keys.BACKWARD) + analog.y
    const strafe = this.#axis(this.keys.RIGHT, this.keys.LEFT) + analog.x
    const amount = Math.min(Math.hypot(forward, strafe), 1)
    const sin = Math.sin(this.#yaw)
    const cos = Math.cos(this.#yaw)
    let goalX = cos * strafe - sin * forward
    let goalZ = -sin * strafe - cos * forward
    const goalLength = Math.hypot(goalX, goalZ)
    if (goalLength > 0) {
      const speed =
        this.speed *
        (this.#held(this.keys.RUN) ? this.runMultiplier : 1) *
        (this.#held(this.keys.SLOW) ? this.slowMultiplier : 1) *
        THREE.MathUtils.lerp(1, this.crouchMultiplier, THREE.MathUtils.smoothstep(this.#crouch, 0, 1))
      goalX *= (speed * amount) / goalLength
      goalZ *= (speed * amount) / goalLength
    }

    // v(t) = goal + (v0 - goal) e^(-t/τ), and the move is its integral over delta: exact at any frame rate
    const velocity = this.velocity
    let moveX = goalX * delta
    let moveZ = goalZ * delta
    if (this.damping > 0) {
      const decay = Math.exp(-delta / this.damping)
      const lag = this.damping * (1 - decay)
      moveX += (velocity.x - goalX) * lag
      moveZ += (velocity.z - goalZ) * lag
      velocity.set(goalX + (velocity.x - goalX) * decay, 0, goalZ + (velocity.z - goalZ) * decay)
    } else {
      velocity.set(goalX, 0, goalZ)
    }
    if (goalLength === 0 && velocity.x * velocity.x + velocity.z * velocity.z < REST_SPEED * REST_SPEED) {
      velocity.set(0, 0, 0)
    }

    const moveLength = Math.hypot(moveX, moveZ)
    // radius 0 divides to Infinity: MAX_STEPS
    const steps = moveLength > 0 ? THREE.MathUtils.clamp(Math.ceil(moveLength / (radius / 2)), 1, MAX_STEPS) : 1
    // what the feet were above at the frame's start doesn't block: they land on it below
    const bottom = Math.max(feetBefore, this.#feet)
    const top = this.#feet + eye + headroom
    for (let i = 0; i < steps; i++) {
      position.x += moveX / steps
      position.z += moveZ / steps
      this.#collide(position, radius, bottom, top)
    }

    // landed on the highest surface under the feet that they were above, or off the edge of the one they stood on
    this.#under = this.#supportAt(position, bottom + FOOTING)
    if (this.#feet <= this.#under) {
      this.#feet = this.#under
      this.#rise = 0
      this.#grounded = true
    } else if (this.#grounded) {
      this.#grounded = false
      this.#rise = 0
    }
    position.y = this.#feet + eye

    this.#writeOrientation()
    this.#writeTarget()
    this.#writtenPosition.copy(position)

    const changed = !position.equals(_previousPosition) || !camera.quaternion.equals(_previousQuaternion)
    if (changed) this.dispatchEvent(_changeEvent)
    return changed
  }

  // out of every obstacle the walker overlaps vertically, from its feet to the top of its head, then into the bounds,
  // which always win
  #collide(position, radius, bottom, top) {
    for (let pass = 0; pass < COLLISION_PASSES; pass++) {
      let pushed = false
      for (const obstacle of this.obstacles) {
        if (obstacle?.isBox3 === true) pushed = pushOutOfBox(position, obstacle, radius, bottom, top) || pushed
        else if (obstacle?.isSphere === true)
          pushed = pushOutOfSphere(position, obstacle, radius, bottom, top) || pushed
        else checkObstacle(obstacle)
      }
      if (this.bounds !== null) clampToBounds(position, this.bounds, radius)
      if (!pushed) break
    }
  }

  // y of the highest surface the feet's disc overlaps at or under `below`: the ground, or an obstacle's top
  #supportAt(position, below) {
    const foot = Math.max(this.footRadius, 0)
    let support = this.ground
    for (const obstacle of this.obstacles) {
      const y = topUnder(obstacle, position.x, position.z, foot)
      if (y !== null && y <= below && y > support) support = y
    }
    return support
  }

  // y of the lowest underside over the body at or above `above`, or the ceiling
  #overhead(position, radius, above) {
    let lowest = this.ceiling
    for (const obstacle of this.obstacles) {
      const y = bottomOver(obstacle, position.x, position.z, radius)
      if (y !== null && y >= above && y < lowest) lowest = y
    }
    return lowest
  }

  // 1, 0 or -1: whether a key of `positive` or of `negative` is held
  #axis(positive, negative) {
    return (this.#held(positive) ? 1 : 0) - (this.#held(negative) ? 1 : 0)
  }

  #held(codes) {
    for (const code of codes) if (this.#pressed.includes(code)) return true
    return false
  }

  #readOrientation() {
    _euler.setFromQuaternion(this.object.quaternion, 'YXZ')
    this.#yaw = _euler.y
    this.#pitch = THREE.MathUtils.clamp(_euler.x, -PITCH_LIMIT, PITCH_LIMIT)
  }

  #writeOrientation() {
    this.object.quaternion.setFromEuler(_euler.set(this.#pitch, this.#yaw, 0, 'YXZ'))
    this.#writtenQuaternion.copy(this.object.quaternion)
  }

  // the view direction is (-sin yaw cos pitch, sin pitch, -cos yaw cos pitch)
  #writeTarget() {
    const cosPitch = Math.cos(this.#pitch)
    _walkDirection.set(-Math.sin(this.#yaw) * cosPitch, Math.sin(this.#pitch), -Math.cos(this.#yaw) * cosPitch)
    this.target.copy(this.object.position).addScaledVector(_walkDirection, this.#targetDistance)
    this.#writtenTarget.copy(this.target)
  }

  #endDrag() {
    const pointerId = this.#pointerId
    if (pointerId === null) return
    // cleared first: releasing the capture can fire lostpointercapture at once
    this.#pointerId = null
    if (this.domElement.hasPointerCapture?.(pointerId)) this.domElement.releasePointerCapture(pointerId)
    this.dispatchEvent(_endEvent)
  }

  #onPointerDown = (event) => {
    // the first pointer down on the element, even a finger that lands while another holds a virtual stick
    if (!this.enabled || this.#locked || this.#pointerId !== null || event.button !== 0) return
    // the drag looks until the lock takes over, and on if the browser refuses it
    if (this.pointerLock && event.pointerType === 'mouse') this.lock()
    this.#pointerId = event.pointerId
    this.#pointerX = event.clientX
    this.#pointerY = event.clientY
    // Chrome throws InvalidStateError while the lock just requested is pending: the lock takes over from the drag
    try {
      this.domElement.setPointerCapture(event.pointerId)
    } catch {
      // the drag still looks, uncaptured
    }
    this.dispatchEvent(_startEvent)
  }

  #onPointerMove = (event) => {
    if (event.pointerId !== this.#pointerId) return
    if (this.enabled) {
      this.#lookX += event.clientX - this.#pointerX
      this.#lookY += event.clientY - this.#pointerY
    }
    this.#pointerX = event.clientX
    this.#pointerY = event.clientY
  }

  // pointerup, pointercancel and lostpointercapture
  #onPointerUp = (event) => {
    if (event.pointerId === this.#pointerId) this.#endDrag()
  }

  // while locked the cursor stays put and only movementX/Y report the mouse
  #onMouseMove = (event) => {
    if (!this.#locked || !this.enabled) return
    this.#lookX += event.movementX ?? 0
    this.#lookY += event.movementY ?? 0
  }

  #onPointerLockChange = () => {
    const locked = this.#document?.pointerLockElement === this.domElement
    if (locked === this.#locked) return
    this.#locked = locked
    if (locked) {
      this.#endDrag()
      this.dispatchEvent(_lockEvent)
    } else {
      this.dispatchEvent(_unlockEvent)
    }
  }

  /** Jumps at the next update(), if on the ground: as keys.JUMP does, for a virtual button. */
  jump() {
    this.#jumpQueued = true
  }

  /** m the feet are above the surface under them: 0 standing, on the ground or an obstacle, more in the air. */
  get lift() {
    return this.#feet === null ? 0 : this.#feet - this.#under
  }

  /** y of the feet: `ground`, an obstacle's top they stand on, or in the air. */
  get feet() {
    return this.#feet ?? this.ground
  }

  #onKeyDown = (event) => {
    if (!this.enabled) return
    // a shortcut, not a step; macOS also sends no keyup for keys released while Meta is held. Alt slows (keys.SLOW).
    if (event.ctrlKey || event.metaKey) {
      this.#pressed.length = 0
      return
    }
    // the innermost target: a field inside an open shadow root reaches the document retargeted to its host
    if (isEditable(event.composedPath?.()[0] ?? event.target)) return
    if (this.keys.JUMP.includes(event.code) && !event.repeat) this.#jumpQueued = true
    if (!this.#pressed.includes(event.code) && Object.values(this.keys).some((codes) => codes.includes(event.code))) {
      this.#pressed.push(event.code)
    }
  }

  #onKeyUp = (event) => {
    const index = this.#pressed.indexOf(event.code)
    if (index !== -1) this.#pressed.splice(index, 1)
  }

  #onBlur = () => {
    this.#pressed.length = 0
    this.#endDrag()
  }
}

function checkObstacle(obstacle) {
  if (obstacle?.isBox3 !== true && obstacle?.isSphere !== true) {
    throw new TypeError('WalkControls: each obstacle must be a THREE.Box3 or a THREE.Sphere.')
  }
}

// The obstacle's top over the disc of `radius` at x, z, or null where the disc misses it.
function topUnder(obstacle, x, z, radius) {
  if (obstacle?.isBox3 === true) {
    return !obstacle.isEmpty() && footprintDistanceSquared(obstacle, x, z) <= radius * radius ? obstacle.max.y : null
  }
  const reach = sphereReach(obstacle, x, z, radius)
  return reach === null ? null : obstacle.center.y + reach
}

// The obstacle's underside over the disc of `radius` at x, z, or null where the disc misses it.
function bottomOver(obstacle, x, z, radius) {
  if (obstacle?.isBox3 === true) {
    return !obstacle.isEmpty() && footprintDistanceSquared(obstacle, x, z) <= radius * radius ? obstacle.min.y : null
  }
  const reach = sphereReach(obstacle, x, z, radius)
  return reach === null ? null : obstacle.center.y - reach
}

// Squared xz distance from x, z to the box's footprint: 0 inside it.
function footprintDistanceSquared(box, x, z) {
  const dx = x - THREE.MathUtils.clamp(x, box.min.x, box.max.x)
  const dz = z - THREE.MathUtils.clamp(z, box.min.z, box.max.z)
  return dx * dx + dz * dz
}

// How far above and below its centre a sphere reaches over the disc of `radius` at x, z, at the disc's nearest point;
// null where the disc misses it.
function sphereReach(sphere, x, z, radius) {
  if (sphere?.isSphere !== true || !(sphere.radius >= 0)) return null
  const d = Math.max(Math.hypot(x - sphere.center.x, z - sphere.center.z) - radius, 0)
  return d < sphere.radius ? Math.sqrt(sphere.radius * sphere.radius - d * d) : null
}

// Out of the box's footprint grown by the radius, its corners rounded: to the closest point of the footprint plus the
// radius, or out through the nearest side from inside it. Returns whether the eye moved.
function pushOutOfBox(position, box, radius, bottom, top) {
  if (box.isEmpty() || box.max.y <= bottom || box.min.y >= top) return false
  const { min, max } = box
  const x = position.x
  const z = position.z
  const closestX = THREE.MathUtils.clamp(x, min.x, max.x)
  const closestZ = THREE.MathUtils.clamp(z, min.z, max.z)
  const dx = x - closestX
  const dz = z - closestZ
  const distanceSquared = dx * dx + dz * dz
  if (distanceSquared > 0) {
    if (distanceSquared >= radius * radius) return false
    const scale = radius / Math.sqrt(distanceSquared)
    position.x = closestX + dx * scale
    position.z = closestZ + dz * scale
    return true
  }
  const toMinX = x - min.x
  const toMaxX = max.x - x
  const toMinZ = z - min.z
  const toMaxZ = max.z - z
  const nearest = Math.min(toMinX, toMaxX, toMinZ, toMaxZ)
  if (nearest === toMinX) position.x = min.x - radius
  else if (nearest === toMaxX) position.x = max.x + radius
  else if (nearest === toMinZ) position.z = min.z - radius
  else position.z = max.z + radius
  return position.x !== x || position.z !== z
}

// Out of the circle where the sphere meets the walker's height nearest its centre, grown by the radius
function pushOutOfSphere(position, sphere, radius, bottom, top) {
  const { center } = sphere
  const dy = center.y < bottom ? bottom - center.y : center.y > top ? center.y - top : 0
  if (sphere.radius < 0 || dy >= sphere.radius) return false
  const reach = Math.sqrt(sphere.radius * sphere.radius - dy * dy) + radius
  const dx = position.x - center.x
  const dz = position.z - center.z
  const distanceSquared = dx * dx + dz * dz
  if (distanceSquared >= reach * reach) return false
  if (distanceSquared > 0) {
    const scale = reach / Math.sqrt(distanceSquared)
    position.x = center.x + dx * scale
    position.z = center.z + dz * scale
  } else {
    position.x = center.x + reach
  }
  return true
}

// The eye's xz into the bounds less the radius: their middle where they are narrower than the body. y isn't read, so
// only a box empty in x or z is ignored.
function clampToBounds(position, bounds, radius) {
  const { min, max } = bounds
  if (max.x < min.x || max.z < min.z) return
  position.x =
    min.x + radius <= max.x - radius
      ? THREE.MathUtils.clamp(position.x, min.x + radius, max.x - radius)
      : (min.x + max.x) / 2
  position.z =
    min.z + radius <= max.z - radius
      ? THREE.MathUtils.clamp(position.z, min.z + radius, max.z - radius)
      : (min.z + max.z) / 2
}

// ─── Bat model ───────────────────────────────────────────────────────────────

// The player's melee weapon: a wooden baseball bat, and the first-person view model that swings it.
//
// BaseballBat is a lathe-turned 34" ash bat on a regulation profile: a 1.4" knob, a 0.93" handle, a long taper, a 2.6"
// barrel and a cupped end, its knob at the origin and its barrel up +y, in metres. Its node material is procedural:
// growth rings around a pith off the billet (fine lines on the edge grain, flames on the face grain and up the
// taper), earlywood pores and fibres along the length, a gloss lacquer clearcoat, a burned-in brand oval, black grip
// tape spiralling up the handle, and wear: ball marks and scuffs on the barrel, grime from hands above the tape, dirt.
//
// BatViewModel holds one in first person as a child of the camera, which looks down its −z: at rest low, near the
// middle and close in, the barrel pointing forward and up to the left, swaying with breath, the walk and the look.
// swing() winds up, whips the barrel from the upper left across the view to the lower right, follows through and
// recovers from below the view. Like a game's view model it draws over the walls instead of clipping into them, yet
// still behind whatever stands in front of it: meshes with a renderOrder below BatViewModel.RENDER_ORDER can't hide
// it, the rest depth-test against it.
//
//   const viewModel = new BatViewModel(new BaseballBat({ woodColor: '#d6ae78' }))
//   camera.add(viewModel)
//   room.traverse((object) => (object.renderOrder = BatViewModel.RENDER_ORDER - 1)) // the bat draws over the room
//   viewModel.update(delta, { moveSpeed }) // every frame, after the camera moved
//   if (clicked) viewModel.swing()
//   if (viewModel.active) {
//     viewModel.getBarrelSegment(start, end) // world space, sweet spot → tip; getPreviousBarrelSegment: last frame's
//     viewModel.getSwingVelocity(velocity) // world m/s of the sweet spot
//     // on a hit: viewModel.hitStop(0.06); viewModel.recoil(1)
//   }
//   bat.woodColor = '#c49a66' // material settings are live; after a change to the shape, bat.rebuild()

const INCH = 0.0254
const TAU = Math.PI * 2
const DEG = Math.PI / 180

// The shape: a change needs rebuild(). Lengths in m, from the knob's end.
const SHAPE = {
  length: 34 * INCH,
  knobDiameter: 1.4 * INCH,
  knobHeight: 0.42 * INCH,
  handleDiameter: 0.93 * INCH,
  handleSwell: 0.07 * INCH, // the handle's growth in diameter from the knob to the taper
  taperStart: 11 * INCH,
  barrelStart: 24.5 * INCH,
  barrelDiameter: 2.6 * INCH,
  taperPower: 1.25, // above 1 the handle stays thin longer and the taper flares late
  endRounding: 0.36 * INCH, // radius of the end's rim
  cupDiameter: 1.15 * INCH,
  cupDepth: 0.6 * INCH, // 0: a rounded end
  tapeStart: 0.55 * INCH, // just above the knob, which stays bare
  tapeEnd: 9.5 * INCH,
  tapeThickness: 0.0005, // m, one layer
  radialSegments: 64,
  brand: 'ASHFORD',
  stampTop: 'GENUINE',
  stampBottom: 'PRO STOCK 34',
}

// The material: live uniforms. Colours in sRGB.
const MATERIAL = {
  woodColor: '#dab27a', // the latewood: honey under the lacquer
  woodColorVariation: '#c6955b', // the patches it drifts toward
  colorVariation: 0.5,
  colorVariationFrequency: 9, // 1/m
  grainColor: '#8c5a2c', // the earlywood bands, the flames
  poreColor: '#3f2412',
  ringFrequency: 240, // growth rings per m
  ringContrast: 0.6,
  ringIrregularity: 0.5, // how much the rings' widths and darkness vary
  earlywood: 0.3, // share of a ring
  ringWarp: 0.004, // m the rings wander
  ringWarpFrequency: 30, // 1/m across the grain, a fifteenth of it along
  pithDistance: 0.1, // m from the bat's axis to the tree's pith, outside the billet
  pithAngle: 90, // deg about the axis where the face grain (the flames) shows: under the stamp, as on ash bats
  grainSlope: 0.02, // run-out of the grain along the bat
  fiberFrequency: 2400, // 1/m across the grain
  fiberAmplitude: 0.22,
  poreFrequency: 1600, // 1/m across the grain
  poreAmplitude: 0.85,
  poreDepth: 0.00004, // m
  endGrain: 0.3, // darkening of the end grain at the knob and in the cup
  roughness: 0.55, // the wood under the lacquer
  specularIntensity: 0.35, // the wood's own reflection, under the lacquer
  clearcoat: 1,
  clearcoatRoughness: 0.07,
  clearcoatUnevenness: 0.5, // the lacquer's orange peel and patchy gloss
  grimeColor: '#4c301b', // pine tar and hands, above the tape
  grimeAmplitude: 0.7,
  grimeLength: 0.11, // m above the tape
  dirtColor: '#5e4c3a',
  dirtAmplitude: 0.45,
  markColor: '#6b7076', // ball marks: crushed lacquer and the ball's rub, grey
  markTint: '#b4615a', // a few take the stitches' red
  markAmplitude: 0.8,
  markDensity: 0.45,
  markDepth: 0.00025, // m, the deepest dent
  scratchAmplitude: 0.5,
  stampColor: '#26130a',
  stampAmplitude: 0.92,
  stampPosition: 28 * INCH, // m from the knob to the oval's centre
  stampAngle: 90, // deg about the axis
  stampDepth: 0.00004, // m
  tapeColor: '#0d0d0d',
  tapeWidth: 0.025, // m
  tapeOverlap: 0.35,
  tapeRoughness: 0.72,
  tapeWear: 0.6,
  bumpAmplitude: 1,
}

// The brand oval's extent on the barrel, m: along the bat × around it
const STAMP_SIZE = [0.104, 0.042]
const STAMP_RANGE = 2 // mm of distance the stamp's field holds either side of an edge
const STAMP_TEXELS = [512, 208]

// A stroke font on a 4 × 6 grid: polylines of "x,y" points, split by '|'.
const GLYPHS = {
  A: '0,0 2,6 4,0|0.8,2.4 3.2,2.4',
  B: '0,0 0,6 3,6 4,5 4,4 3,3 0,3|3,3 4,2 4,1 3,0 0,0',
  C: '4,1 3,0 1,0 0,1 0,5 1,6 3,6 4,5',
  D: '0,0 0,6 2.5,6 4,4.5 4,1.5 2.5,0 0,0',
  E: '4,0 0,0 0,6 4,6|0,3 3,3',
  F: '0,0 0,6 4,6|0,3 3,3',
  G: '4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1 4,3 2.2,3',
  H: '0,0 0,6|4,0 4,6|0,3 4,3',
  I: '1,0 3,0|2,0 2,6|1,6 3,6',
  J: '0,1 1,0 3,0 4,1 4,6',
  K: '0,0 0,6|4,6 0,2.4|1.4,3.4 4,0',
  L: '0,6 0,0 4,0',
  M: '0,0 0,6 2,3 4,6 4,0',
  N: '0,0 0,6 4,0 4,6',
  O: '1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0',
  P: '0,0 0,6 3,6 4,5 4,4 3,3 0,3',
  Q: '1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0|2.6,1.4 4,0',
  R: '0,0 0,6 3,6 4,5 4,4 3,3 0,3|2,3 4,0',
  S: '4,5 3,6 1,6 0,5 0,4 1,3 3,3 4,2 4,1 3,0 1,0 0,1',
  T: '0,6 4,6|2,6 2,0',
  U: '0,6 0,1 1,0 3,0 4,1 4,6',
  V: '0,6 2,0 4,6',
  W: '0,6 1,0 2,4 3,0 4,6',
  X: '0,0 4,6|0,6 4,0',
  Y: '0,6 2,3 4,6|2,3 2,0',
  Z: '0,6 4,6 0,0 4,0',
  0: '1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0',
  1: '1,4.8 2,6 2,0|1,0 3,0',
  2: '0,5 1,6 3,6 4,5 4,4 0,0 4,0',
  3: '0,5 1,6 3,6 4,5 4,4 3,3 4,2 4,1 3,0 1,0 0,1|1.6,3 3,3',
  4: '3,0 3,6 0,2 4,2',
  5: '4,6 0,6 0,3 3,3 4,2 4,1 3,0 1,0 0,1',
  6: '4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1 4,2 3,3 0,3',
  7: '0,6 4,6 1.4,0',
  8: '1,3 0,4 0,5 1,6 3,6 4,5 4,4 3,3 1,3 0,2 0,1 1,0 3,0 4,1 4,2 3,3',
  9: '0,1 1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,4 1,3 4,3',
  '.': '1.8,0 2.2,0',
  '-': '1,3 3,3',
}

const SHAPE_KEYS = Object.keys(SHAPE)
const BAT_MATERIAL_KEYS = Object.keys(MATERIAL)
const COLOR_KEYS = BAT_MATERIAL_KEYS.filter((key) => typeof MATERIAL[key] === 'string')

const smooth = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1)
  return t * t * (3 - 2 * t)
}
// max(a, b) with a fillet of about k
const smoothMax = (a, b, k) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.max(a, b) + (h * h * k) / 4
}

// Segments [x0, y0, x1, y1, halfWidth] in mm of the stamp: two ovals and three lines of text, along the bat × around.
function stampSegments({ brand, stampTop, stampBottom }) {
  const segments = []
  const oval = (a, b, halfWidth) => {
    const n = 96
    for (let i = 0; i < n; i++) {
      const [t0, t1] = [(i / n) * TAU, ((i + 1) / n) * TAU]
      segments.push([a * Math.cos(t0), b * Math.sin(t0), a * Math.cos(t1), b * Math.sin(t1), halfWidth])
    }
  }
  const text = (string, capHeight, centerY, halfWidth, tracking = 1.7) => {
    const unit = capHeight / 6
    const chars = [...string.toUpperCase()]
    const advance = (char) => (char === ' ' ? 3 : 4 + tracking)
    const width = chars.reduce((sum, char) => sum + advance(char), -tracking)
    let x = -width / 2
    for (const char of chars) {
      for (const stroke of (GLYPHS[char] ?? '').split('|').filter(Boolean)) {
        const points = stroke.split(' ').map((pair) => pair.split(',').map(Number))
        for (let i = 0; i + 1 < points.length; i++) {
          const [[x0, y0], [x1, y1]] = [points[i], points[i + 1]]
          segments.push([
            (x + x0) * unit,
            centerY + (y0 - 3) * unit,
            (x + x1) * unit,
            centerY + (y1 - 3) * unit,
            halfWidth,
          ])
        }
      }
      x += advance(char)
    }
  }
  oval(47, 19.2, 0.6)
  oval(44, 16.6, 0.3)
  text(brand, 9.5, 0, 0.75, 1.5)
  text(stampTop, 3, 10.4, 0.32)
  text(stampBottom, 3, -10.4, 0.32)
  return segments
}

// The stamp as a signed distance field, mm, encoded over ±STAMP_RANGE: below 0.5 is ink.
function stampTexture(options) {
  const [width, height] = STAMP_TEXELS
  const [sizeX, sizeY] = STAMP_SIZE.map((m) => m * 1000)
  const data = new Uint8Array(width * height).fill(255)
  const toX = (i) => ((i + 0.5) / width - 0.5) * sizeX
  const toY = (j) => ((j + 0.5) / height - 0.5) * sizeY
  for (const [x0, y0, x1, y1, halfWidth] of stampSegments(options)) {
    const reach = halfWidth + STAMP_RANGE
    const i0 = Math.max(0, Math.floor(((Math.min(x0, x1) - reach) / sizeX + 0.5) * width))
    const i1 = Math.min(width - 1, Math.ceil(((Math.max(x0, x1) + reach) / sizeX + 0.5) * width))
    const j0 = Math.max(0, Math.floor(((Math.min(y0, y1) - reach) / sizeY + 0.5) * height))
    const j1 = Math.min(height - 1, Math.ceil(((Math.max(y0, y1) + reach) / sizeY + 0.5) * height))
    const [dx, dy] = [x1 - x0, y1 - y0]
    const lengthSq = dx * dx + dy * dy || 1e-9
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const [px, py] = [toX(i) - x0, toY(j) - y0]
        const t = Math.min(Math.max((px * dx + py * dy) / lengthSq, 0), 1)
        const distance = Math.hypot(px - t * dx, py - t * dy) - halfWidth
        const value = Math.round(Math.min(Math.max(0.5 + distance / (2 * STAMP_RANGE), 0), 1) * 255)
        const k = j * width + i
        if (value < data[k]) data[k] = value
      }
    }
  }
  const map = new THREE.DataTexture(data, width, height, THREE.RedFormat, THREE.UnsignedByteType)
  map.name = 'bat stamp'
  map.magFilter = map.minFilter = THREE.LinearFilter
  map.needsUpdate = true
  return map
}

// The normal bumped by a height in m over the surface, from its screen-space derivatives (Mikkelsen, "Bump Mapping
// Unparametrized Surfaces on the GPU"), unnormalised so heights keep their size at any distance.
function bumpNormal(height) {
  const dx = positionView.dFdx()
  const dy = positionView.dFdy()
  const normal = normalViewGeometry
  const r1 = cross(dy, normal)
  const r2 = cross(normal, dx)
  const det = dot(dx, r1)
  const gradient = sign(det).mul(height.dFdx().mul(r1).add(height.dFdy().mul(r2)))
  return abs(det).mul(normal).sub(gradient).normalize()
}

class BaseballBat extends THREE.Group {
  isBaseballBat = true
  type = 'BaseballBat'

  /** The material's uniforms, by MATERIAL's keys; the properties of the same names set them. */
  uniforms = {}

  #shape = { ...SHAPE }
  #regions = {
    length: uniform(0),
    knobHeight: uniform(0),
    barrelStart: uniform(0),
    tapeStart: uniform(0),
    tapeEnd: uniform(0),
    tapeThickness: uniform(0),
  }
  #stamp = null
  #stampKey = ''
  #stampNode = null

  static {
    for (const key of SHAPE_KEYS) {
      Object.defineProperty(this.prototype, key, {
        get() {
          return this.#shape[key]
        },
        set(value) {
          this.#shape[key] = value
        },
      })
    }
    for (const key of BAT_MATERIAL_KEYS) {
      const isColor = COLOR_KEYS.includes(key)
      Object.defineProperty(this.prototype, key, {
        get() {
          const { value } = this.uniforms[key]
          return isColor ? `#${value.getHexString()}` : value
        },
        set(value) {
          if (isColor) this.uniforms[key].value.set(value)
          else this.uniforms[key].value = value
        },
      })
    }
  }

  constructor(options = {}) {
    super()
    this.name = 'baseball-bat'
    for (const key of Object.keys(options)) {
      if (!SHAPE_KEYS.includes(key) && !BAT_MATERIAL_KEYS.includes(key)) {
        console.warn(`BaseballBat: unknown option "${key}" ignored.`)
      }
    }
    for (const key of SHAPE_KEYS) if (options[key] !== undefined) this.#shape[key] = options[key]
    for (const key of BAT_MATERIAL_KEYS) {
      const value = options[key] ?? MATERIAL[key]
      this.uniforms[key] = uniform(COLOR_KEYS.includes(key) ? new THREE.Color(value) : value)
    }

    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.#createMaterial())
    this.mesh.name = 'baseball-bat'
    this.add(this.mesh)
    this.rebuild()
  }

  /** m from the knob to the sweet spot, about 6" from the end. */
  get sweetSpot() {
    return this.#shape.length - 6.5 * INCH
  }

  /** The barrel's radius, m. */
  get barrelRadius() {
    return this.#shape.barrelDiameter / 2
  }

  /** The point on the bat's axis `distance` m from the knob, in the bat's space. */
  getPoint(distance, target) {
    return target.set(0, distance, 0)
  }

  /** The bat's radius `distance` m from the knob, the tape left out. */
  radiusAt(distance) {
    return this.#radius(distance, false)
  }

  /** Builds the geometry and the stamp again after a change to the shape. */
  rebuild() {
    const shape = this.#shape
    const points = this.#profile()
    const geometry = new THREE.LatheGeometry(points, shape.radialSegments)
    // v runs along the bat by arc length, knob to cup
    const arc = [0]
    for (let i = 1; i < points.length; i++) arc.push(arc[i - 1] + points[i].distanceTo(points[i - 1]))
    const uv = geometry.attributes.uv
    for (let k = 0; k < uv.count; k++) uv.setY(k, arc[k % points.length] / arc[arc.length - 1])
    geometry.name = 'baseball-bat'
    this.mesh.geometry.dispose()
    this.mesh.geometry = geometry

    for (const key of Object.keys(this.#regions)) this.#regions[key].value = shape[key]

    const stampKey = [shape.brand, shape.stampTop, shape.stampBottom].join('\n')
    if (stampKey !== this.#stampKey) {
      this.#stamp?.dispose()
      this.#stamp = stampTexture(shape)
      this.#stampKey = stampKey
      this.#stampNode.value = this.#stamp
    }
    return this
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
    this.#stamp?.dispose()
  }

  // The radius `y` m from the knob's end: a superellipse knob filleted into the handle, the handle's swell, the taper
  // and the barrel; with the tape's two layers over the handle if `withTape`.
  #radius(y, withTape = true) {
    const s = this.#shape
    const knobRadius = s.knobDiameter / 2
    const half = s.knobHeight / 2
    const u = Math.min(Math.abs((y - half) / half), 1)
    const knob = knobRadius * (1 - u ** 3.5) ** (1 / 3.5)
    const handle = s.handleDiameter / 2 + (s.handleSwell / 2) * smooth(s.knobHeight, s.taperStart, y)
    const barrelBase = s.barrelDiameter / 2 - 0.03 * INCH
    const t = Math.min(Math.max((y - s.taperStart) / (s.barrelStart - s.taperStart), 0), 1)
    const flare = smooth(0, 1, t ** s.taperPower)
    let shaft = handle + (barrelBase - handle) * flare
    shaft += 0.03 * INCH * smooth(s.barrelStart, s.length - 2 * INCH, y)
    let radius = smoothMax(knob, shaft, 0.005)
    if (withTape && y > s.knobHeight * 0.5) {
      const covered =
        smooth(s.tapeStart - 0.0004, s.tapeStart, y) * (1 - smooth(s.tapeEnd - 0.0003, s.tapeEnd + 0.0003, y))
      radius += 2 * s.tapeThickness * covered
    }
    return radius
  }

  // The lathe's profile (radius, height), knob centre to cup bottom.
  #profile() {
    const s = this.#shape
    const points = []
    const push = (r, y) => points.push(new THREE.Vector2(Math.max(r, 0), y))
    const knobRadius = s.knobDiameter / 2
    const half = s.knobHeight / 2
    // the knob's underside: the lower half of its superellipse
    for (let i = 0; i <= 16; i++) {
      const phi = -Math.PI / 2 + (i / 16) * (Math.PI / 2)
      const c = Math.cos(phi)
      const sn = Math.sin(phi)
      push(knobRadius * Math.abs(c) ** (2 / 3.5), half - half * Math.abs(sn) ** (2 / 3.5))
    }
    // the shaft, stepped finer where it curves
    const rim = s.endRounding
    const top = s.length - rim
    const steps = [
      [s.knobHeight + 0.03, 0.001],
      [s.taperStart, 0.006],
      [s.barrelStart + 0.03, 0.005],
      [top, 0.01],
    ]
    let y = half
    for (const [until, step] of steps) {
      while (y < until - 1e-6) {
        const from = y
        y = Math.min(y + step, until)
        // fine across the tape's ends, where it steps
        for (const edge of [s.tapeStart, s.tapeEnd]) {
          for (let k = -6; k <= 6; k++) {
            const e = edge + k * 0.0002
            if (e > from + 1e-6 && e < y - 1e-6) push(this.#radius(e), e)
          }
        }
        push(this.#radius(y), y)
      }
    }
    // the rim, rounded over
    const end = this.#radius(top)
    for (let i = 1; i <= 10; i++) {
      const a = (i / 10) * (Math.PI / 2)
      push(end - rim + rim * Math.cos(a), top + rim * Math.sin(a))
    }
    const cupRadius = s.cupDiameter / 2
    const lip = Math.min(0.003, cupRadius * 0.5)
    if (s.cupDepth > lip && cupRadius > lip) {
      // a rounded lip into the cup, then the bowl down to its centre
      push(cupRadius + lip, s.length)
      for (let i = 1; i <= 8; i++) {
        const a = Math.PI / 2 + (i / 8) * (Math.PI / 2)
        push(cupRadius + lip + lip * Math.cos(a), s.length - lip + lip * Math.sin(a))
      }
      for (let i = 1; i <= 14; i++) {
        const phi = (i / 14) * (Math.PI / 2)
        push(cupRadius * Math.cos(phi), s.length - lip - (s.cupDepth - lip) * Math.sin(phi))
      }
    } else {
      // a domed end
      const from = end - rim
      for (let i = 1; i <= 10; i++) {
        const r = from * (1 - i / 10)
        push(r, s.length + 0.002 * (1 - (r / from) ** 2))
      }
    }
    return points
  }

  #createMaterial() {
    const u = this.uniforms
    const region = this.#regions
    const p = positionLocal
    const y = p.y
    const radial = length(p.xz)
    const angle = atan(p.z, p.x)

    // Growth rings: distance from the pith line, off the billet and tilted by the run-out, warped. They cut the round
    // surface as lines on the edge grain and as flames on the face grain and where the taper cuts through them.
    const pithAngle = u.pithAngle.mul(DEG)
    const pith = vec3(pithAngle.cos(), 0, pithAngle.sin()).mul(u.pithDistance)
    const grainAxis = normalize(vec3(u.grainSlope, 1, u.grainSlope.mul(0.4)))
    const fromPith = p.sub(pith)
    const across = fromPith.sub(grainAxis.mul(dot(fromPith, grainAxis)))
    const stretch = vec3(1, 1 / 15, 1)
    const warp = mx_fractal_noise_float(p.mul(stretch).mul(u.ringWarpFrequency), 3, 2, 0.5)
    const rings = length(across).add(warp.mul(u.ringWarp)).mul(u.ringFrequency)
    // each ring its own width and darkness
    const irregular = mx_noise_float(vec3(rings.mul(0.37), 0.5, 0.5))
    const ringIndex = rings.add(irregular.mul(u.ringIrregularity).mul(0.9))
    const ring = fract(ringIndex)
    const ringShade = float(1).sub(hash(floor(ringIndex).add(1e4)).mul(u.ringIrregularity).mul(0.7))
    // earlywood right after the ring's boundary, fading into the latewood
    const fade = float(1).sub(smoothstep(0, u.earlywood, ring))
    const early = fade
      .mul(fade)
      .mul(smoothstep(0, 0.03, ring).mul(0.5).add(0.5))
      .mul(ringShade)
    const pore = smoothstep(0.12, 0.42, mx_noise_float(p.mul(vec3(1, 1 / 45, 1)).mul(u.poreFrequency)))
    const pores = pore.mul(fade.mul(0.85).add(0.15))
    const fiber = mx_noise_float(p.mul(vec3(1, 1 / 70, 1)).mul(u.fiberFrequency))
    const variation = mx_fractal_noise_float(p.mul(vec3(1, 0.3, 1)).mul(u.colorVariationFrequency), 2, 2, 0.5)
      .mul(0.5)
      .add(0.5)

    let wood = mix(u.woodColor, u.woodColorVariation, variation.mul(u.colorVariation))
    wood = mix(wood, u.grainColor, early.mul(u.ringContrast))
    wood = mix(wood, u.poreColor, pores.mul(u.poreAmplitude))
    wood = wood.mul(fiber.mul(u.fiberAmplitude).add(1))
    // end grain drinks the finish: darker at the knob's end and in the cup
    const endGrain = smoothstep(0.55, 0.9, abs(normalLocal.y))
    wood = wood.mul(float(1).sub(endGrain.mul(u.endGrain)))

    // Ball marks: up to one per cell of a lattice around × along the barrel, most near the sweet spot.
    const cellsAround = 9
    const cellLength = 0.03
    const around = angle.div(TAU).add(0.5).mul(cellsAround)
    const along = y.div(cellLength)
    const arcCell = radial.mul(TAU / cellsAround)
    const sweet = region.length.sub(6.5 * INCH)
    const markEdge = mx_noise_float(p.mul(500)).mul(0.6).add(1)
    let markCover = float(0)
    let markDent = float(0)
    let markRed = float(0)
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const ci = floor(around).add(di)
        const cj = floor(along).add(dj)
        const wrapped = ci.sub(floor(ci.div(cellsAround)).mul(cellsAround))
        const seed = wrapped.add(cj.mul(cellsAround)).add(4096)
        const [h1, h2, h3, h4, h5] = [0, 1, 2, 3, 4].map((k) => hash(seed.add(k * 7919)))
        const centreY = cj.add(h2).mul(cellLength)
        const near = exp(centreY.sub(sweet).div(0.085).pow(2).negate())
        const present = step(h3, u.markDensity.mul(near))
        const dx = around.sub(ci.add(h1)).mul(arcCell).div(1.5)
        const dy = along.sub(cj.add(h2)).mul(cellLength)
        const radius = mix(0.004, 0.0105, h4)
        const falloff = exp(dx.mul(dx).add(dy.mul(dy)).div(radius.mul(radius)).negate()).mul(present)
        const mark = smoothstep(0.2, 0.65, falloff.mul(markEdge))
        markCover = max(markCover, mark)
        markDent = markDent.add(falloff.mul(h4.mul(0.6).add(0.4)))
        // the seam's stitches: two rows of short red dashes across a few marks
        const bent = dy.add(dx.mul(dx).mul(h1.sub(0.5).mul(120)))
        const rows = float(1).sub(smoothstep(0.0003, 0.0007, abs(abs(bent).sub(0.0032))))
        const dashes = smoothstep(0.1, 0.5, dx.mul(TAU / 0.0032).sin())
        markRed = max(markRed, rows.mul(dashes).mul(mark).mul(step(0.75, h5)))
      }
    }
    const barrel = smoothstep(region.barrelStart.sub(0.08), region.barrelStart.add(0.02), y)
    const markBreak = mx_noise_float(p.mul(900)).mul(0.35).add(0.75)
    const marks = markCover.mul(markBreak).mul(u.markAmplitude).saturate()

    // Scuffs: thin lines in the lacquer, mostly around the barrel, in patches
    const scratchLine = float(1).sub(smoothstep(0, 0.06, abs(mx_noise_float(p.mul(vec3(90, 700, 90))))))
    const scratchLine2 = float(1).sub(smoothstep(0, 0.05, abs(mx_noise_float(p.mul(vec3(500, 160, 500)).add(7.3)))))
    const scratchPatch = smoothstep(0.1, 0.5, mx_noise_float(p.mul(28).add(3.1)))
    const scratches = max(scratchLine, scratchLine2.mul(0.7)).mul(scratchPatch).mul(barrel).mul(u.scratchAmplitude)

    // Dirt toward the end and over the barrel; grime from hands above the tape
    const dirtNoise = mx_fractal_noise_float(p.mul(32), 3, 2, 0.55)
    const dirt = smoothstep(0.0, 0.55, dirtNoise).mul(barrel.mul(0.7).add(0.3)).mul(u.dirtAmplitude)
    const grimeNoise = mx_fractal_noise_float(p.mul(vec3(70, 25, 70)).add(11.7), 2, 2, 0.5)
      .mul(0.5)
      .add(0.5)
    const aboveTape = smoothstep(region.tapeEnd.sub(0.002), region.tapeEnd, y)
    const grimeFade = float(1).sub(
      smoothstep(region.tapeEnd, region.tapeEnd.add(u.grimeLength), y.sub(grimeNoise.mul(0.03))),
    )
    const grime = aboveTape.mul(grimeFade).mul(grimeNoise.mul(0.6).add(0.4)).mul(u.grimeAmplitude)

    // The brand: a burned-in oval on the barrel, along the bat × around it
    const stampAngle = u.stampAngle.mul(DEG)
    const [ca, sa] = [stampAngle.cos(), stampAngle.sin()]
    const relative = atan(p.z.mul(ca).sub(p.x.mul(sa)), p.x.mul(ca).add(p.z.mul(sa)))
    const stampUV = vec2(
      y.sub(u.stampPosition).div(STAMP_SIZE[0]).add(0.5),
      relative.mul(radial).div(STAMP_SIZE[1]).add(0.5),
    )
    const inside = step(0, stampUV.x).mul(step(stampUV.x, 1)).mul(step(0, stampUV.y)).mul(step(stampUV.y, 1))
    const burnJitter = mx_noise_float(p.mul(1800)).mul(0.08)
    this.#stampNode = texture(new THREE.DataTexture(new Uint8Array([255]), 1, 1, THREE.RedFormat), stampUV)
    const stampDistance = this.#stampNode.r
      .sub(0.5)
      .mul(2 * STAMP_RANGE)
      .add(burnJitter)
    const ink = float(1)
      .sub(smoothstep(-0.1, 0.12, stampDistance))
      .mul(inside)
      .mul(u.stampAmplitude)
    const scorch = float(1)
      .sub(smoothstep(0, 0.7, stampDistance))
      .mul(inside)
      .mul(u.stampAmplitude)
    const stampHeight = float(1)
      .sub(smoothstep(-0.25, 0.25, stampDistance))
      .mul(inside)
      .mul(u.stampDepth)
      .negate()

    // Grip tape: a helix up the handle, each wrap's lower edge lapping over the one below, a straight finishing wrap at
    // the top
    const tape = smoothstep(region.tapeStart.sub(0.0004), region.tapeStart, y).mul(
      float(1).sub(smoothstep(region.tapeEnd.sub(0.0003), region.tapeEnd.add(0.0003), y)),
    )
    const pitch = u.tapeWidth.mul(float(1).sub(u.tapeOverlap))
    const wrap = fract(y.sub(region.tapeStart).div(pitch).add(angle.div(TAU)))
    const finishWidth = u.tapeWidth.mul(0.6)
    const finishing = step(region.tapeEnd.sub(finishWidth), y)
    const wrapFinish = y.sub(region.tapeEnd.sub(finishWidth)).div(finishWidth)
    const lap = mix(wrap, wrapFinish, finishing)
    const lapHeight = smoothstep(0, 0.05, lap).mul(float(1).sub(smoothstep(0.05, 0.8, lap).mul(0.85)))
    const tapeTexture = mx_noise_float(p.mul(vec3(2200, 1400, 2200)))
    const tapeHeight = lapHeight.mul(region.tapeThickness).add(tapeTexture.mul(0.00002))
    const tapeEdge = float(1)
      .sub(smoothstep(0, 0.07, lap))
      .mul(0.6)
    const handZone = smoothstep(region.tapeStart, region.tapeStart.add(0.03), y).mul(
      float(1).sub(smoothstep(region.tapeEnd.sub(0.08), region.tapeEnd, y)),
    )
    const tapeWorn = smoothstep(-0.1, 0.5, mx_fractal_noise_float(p.mul(vec3(90, 20, 90)), 2, 2, 0.5))
      .mul(handZone)
      .mul(u.tapeWear)
    const tapeColor = u.tapeColor
      .mul(tapeTexture.mul(0.15).add(1))
      .mul(tapeWorn.mul(0.8).add(1))
      .add(tapeEdge.mul(0.01))

    // Colour
    let color = wood
    color = mix(color, color.mul(vec3(0.62, 0.5, 0.4)), scorch.mul(0.55))
    color = mix(color, u.stampColor, ink)
    color = mix(color, u.grimeColor, grime)
    color = mix(color, u.dirtColor, dirt.mul(0.5))
    color = mix(color, u.markColor, marks.mul(0.4))
    color = mix(color, u.markTint, markRed.mul(u.markAmplitude).mul(0.6))
    color = mix(color, color.mul(1.25).add(0.04), scratches.mul(0.5))
    color = mix(color, tapeColor, tape)

    // Heights: pores and earlywood sink into the wood; dents and the stamp press the lacquer too
    const woodHeight = pores.mul(-1).sub(early.mul(0.3)).add(fiber.mul(0.15)).mul(u.poreDepth)
    const dent = markDent.mul(u.markDepth).mul(u.markAmplitude).negate()
    // orange peel in the lacquer
    const peel = mx_noise_float(p.mul(700)).mul(0.000003).mul(u.clearcoatUnevenness)
    const coatHeight = dent.add(stampHeight).add(scratches.mul(-0.000004)).add(peel)
    const height = mix(woodHeight.add(coatHeight), tapeHeight, tape).mul(u.bumpAmplitude)

    const material = new THREE.MeshPhysicalNodeMaterial({ name: 'baseball-bat' })
    material.colorNode = color
    material.metalness = 0
    material.specularIntensityNode = mix(u.specularIntensity, 0.5, tape)
    material.roughnessNode = mix(
      u.roughness.add(grime.mul(0.25)).add(dirt.mul(0.2)),
      u.tapeRoughness.sub(tapeWorn.mul(0.3)).sub(tapeEdge.mul(0.1)),
      tape,
    )
    const coat = float(1)
      .sub(grime.mul(0.55))
      .sub(dirt.mul(0.45))
      .sub(marks.mul(0.2))
      .mul(float(1).sub(tape))
      .mul(u.clearcoat)
    material.clearcoatNode = coat.max(0)
    const gloss = mx_noise_float(p.mul(vec3(14, 4, 14)).add(5.3))
      .mul(0.5)
      .add(0.5)
    material.clearcoatRoughnessNode = u.clearcoatRoughness
      .add(gloss.mul(u.clearcoatUnevenness).mul(0.08))
      .add(marks.mul(0.08))
      .add(scratches.mul(0.3))
      .add(dirt.mul(0.25))
      .add(grime.mul(0.3))
    material.normalNode = bumpNormal(height)
    material.clearcoatNormalNode = bumpNormal(coatHeight.mul(u.bumpAmplitude))
    return material
  }
}

// A damped oscillator, stepped exactly: stable at any frequency and step.
class Oscillator {
  value = 0
  velocity = 0

  constructor(frequency, damping) {
    this.frequency = frequency // Hz
    this.damping = damping // ratio, below 1
  }

  step(delta) {
    const w = TAU * this.frequency
    const z = Math.min(this.damping, 0.999)
    const wd = w * Math.sqrt(1 - z * z)
    const decay = Math.exp(-z * w * delta)
    const [c, s] = [Math.cos(wd * delta), Math.sin(wd * delta)]
    const [x, v] = [this.value, this.velocity]
    this.value = decay * (x * c + ((v + z * w * x) / wd) * s)
    this.velocity = decay * (v * c - ((z * w * v + w * w * x) / wd) * s)
    return this.value
  }

  reset() {
    this.value = this.velocity = 0
  }
}

const POSE_KEYS = ['x', 'y', 'z', 'elevation', 'azimuth', 'roll']
// The swing's poses, in order: the hands (the bat's grip point, gripDistance from the knob) in the camera's space, m,
// and the bat's direction from them: elevation above the view's horizon, azimuth right of straight ahead, roll about
// its own axis, deg.
const POSES = {
  rest: { x: 0, y: -0.38, z: -0.42, elevation: 40, azimuth: -70, roll: 0 },
  windup: { x: -0.2, y: -0.24, z: -0.48, elevation: 50, azimuth: -122, roll: -25 },
  contact: { x: -0.12, y: -0.22, z: -0.75, elevation: 6, azimuth: 25, roll: 55 }, // the arms at full stretch
  strike: { x: 0.08, y: -0.3, z: -0.6, elevation: -20, azimuth: 78, roll: 95 },
  followThrough: { x: 0.12, y: -0.42, z: -0.28, elevation: -40, azimuth: 120, roll: 120 },
  recovery: { x: -0.06, y: -0.6, z: -0.33, elevation: -4, azimuth: -40, roll: 45 },
}
const POSE_ORDER = ['rest', 'windup', 'contact', 'strike', 'followThrough', 'recovery', 'rest']
// Knots the path passes through moving (Catmull-Rom tangents); at the others it turns back, so it stops there.
const MOVING_KNOTS = [2, 3, 5]

const VIEW = {
  gripDistance: 0.1, // m from the knob to the hands
  windupDuration: 0.1, // s: the pull back
  swingDuration: 0.15, // s: windup to the strike pose, accelerating
  followDuration: 0.15, // s: on to the follow-through, braking
  recoverDuration: 0.35, // s: back to rest, under the view
  cooldown: 0.08, // s after the follow-through before another swing can start
  swingPower: 2.3, // ease-in exponent of the swing: higher whips harder
  barrelLag: 0.018, // s the bat's turn lags its hands
  activeFrom: 1.5, // the hit window on the path: 1 is the windup pose, 2 contact, 3 strike, 4 follow-through
  activeTo: 2.9,
  breathFrequency: 0.23, // Hz
  breathAmplitude: 0.004, // m
  breathAngle: 0.7, // deg
  stepLength: 0.75, // m per step
  bobSpeed: 1.4, // m/s of walk at which the bob is full
  bobAmplitude: 0.011, // m up and down
  bobSideAmplitude: 0.008, // m
  bobAngle: 1.6, // deg of roll and tilt
  lookSway: 0.03, // rad of lag per rad/s of look
  lookSwayMax: 0.12, // rad
  lookSwayFrequency: 3.5, // Hz
  lookSwayShift: 0.35, // m the hands drift per rad of lag, against the turn
  recoilKick: 5, // rad/s the barrel bounces back with, per recoil()
  recoilFrequency: 5, // Hz
  recoilDamping: 0.35,
  recoilDistance: 0.6, // m/s the hands jolt back with
  vibrationKick: 5, // rad/s
  vibrationFrequency: 24, // Hz
  vibrationDamping: 0.07,
  impactDrag: 0.45, // share of the swing's speed a hit takes, recovered over dragRecovery
  dragRecovery: 0.12, // s
  reboundRate: 1.5, // × its own pace a swing that met a wall runs back along its path to rest (rebound())
  overlay: true, // draw over meshes with a renderOrder below RENDER_ORDER (the walls)
}
const BAT_VIEW_KEYS = Object.keys(VIEW)

const _q = new THREE.Quaternion()
const _q2 = new THREE.Quaternion()
const _v = new THREE.Vector3()
const _axisX = new THREE.Vector3(1, 0, 0)
const _axisY = new THREE.Vector3(0, 1, 0)

const easeInOut = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t)
const smootherstep = (t) => t * t * t * (t * (t * 6 - 15) + 10)

class BatViewModel extends THREE.Group {
  /** The bat's renderOrder: meshes below it draw first and can't hide it, while `overlay` is on. */
  static RENDER_ORDER = -1

  isBatViewModel = true
  type = 'BatViewModel'

  /** The swing's poses by name, each { x, y, z, elevation, azimuth, roll }: see POSES. */
  poses = {}

  #grip = new THREE.Group()
  #mask = new THREE.Mesh()
  #phase = 'idle' // 'idle' | 'windup' | 'swing' | 'follow' | 'recover'
  #time = 0 // s into the swing
  #path = 0 // where the barrel is on the path
  #start = {} // the pose a swing winds up from
  #pose = {} // scratch: the hands' pose
  #turn = {} // scratch: the bat's turn, barrelLag behind
  #offset = {} // breath, bob and look, added to the pose
  #base = {} // the timeline's pose this frame
  #clock = 0
  #hitStop = 0
  #rate = 1
  #reverse = false // running back from a wall
  #walk = 0 // smoothed share of the full bob
  #stride = 0 // rad of the walk's cycle
  #swayYaw = new Oscillator(3.5, 0.75) // about the look's lag: its rest is the lag
  #swayPitch = new Oscillator(3.5, 0.75)
  #swayYawTarget = 0
  #swayPitchTarget = 0
  #lookQuaternion = new THREE.Quaternion()
  #looked = false
  #bounce = new Oscillator(5, 0.35)
  #vibration = new Oscillator(24, 0.07)
  #jolt = [new Oscillator(5, 0.35), new Oscillator(5, 0.35), new Oscillator(5, 0.35)]
  #bounceAxis = new THREE.Vector3(0, 0, 1)
  #vibrationAxis = new THREE.Vector3(1, 0, 0)
  #joltDirection = new THREE.Vector3()
  #sweet = new THREE.Vector3()
  #sweetLocal = new THREE.Vector3()
  #previousSweetLocal = new THREE.Vector3()
  #localVelocity = new THREE.Vector3()
  #velocity = new THREE.Vector3()
  #segment = [new THREE.Vector3(), new THREE.Vector3()]
  #previousSegment = [new THREE.Vector3(), new THREE.Vector3()]
  #primed = false

  constructor(bat = new BaseballBat(), options = {}) {
    super()
    this.name = 'bat-view-model'
    for (const key of Object.keys(options)) {
      if (!BAT_VIEW_KEYS.includes(key) && key !== 'poses')
        console.warn(`BatViewModel: unknown option "${key}" ignored.`)
    }
    for (const key of BAT_VIEW_KEYS) this[key] = options[key] ?? VIEW[key]
    for (const name of Object.keys(POSES)) this.poses[name] = { ...POSES[name], ...options.poses?.[name] }

    this.bat = bat
    this.#grip.name = 'bat-grip'
    this.#grip.add(bat)
    this.add(this.#grip)

    // Drawn just before the bat, the mask resets the depth under its silhouette to the far plane: the bat then
    // depth-tests only against itself there, and whatever draws after it, against the bat.
    const mask = new THREE.MeshBasicNodeMaterial({ name: 'bat-depth-mask', colorWrite: false })
    mask.depthFunc = THREE.AlwaysDepth
    mask.depthNode = float(1)
    this.#mask.material = mask
    this.#mask.geometry = bat.mesh.geometry
    this.#mask.name = 'bat-depth-mask'
    this.#mask.renderOrder = BatViewModel.RENDER_ORDER - 0.5
    bat.mesh.renderOrder = BatViewModel.RENDER_ORDER
    bat.add(this.#mask)
    this.#setPose(this.#base, this.poses.rest)
    this.#setPose(this.#start, this.poses.rest)
    for (const key of POSE_KEYS) this.#offset[key] = 0
    this.#apply(this.#base, this.#offset)
  }

  /** Whether the barrel is sweeping the space in front of the player: hits count now. */
  get active() {
    return (
      (this.#phase === 'swing' || this.#phase === 'follow') &&
      this.#hitStop <= 0 &&
      this.#path >= this.activeFrom &&
      this.#path <= this.activeTo
    )
  }

  /** 'idle', 'windup', 'swing', 'follow', 'recover', or 'rebound' running back from a wall. */
  get phase() {
    return this.#phase
  }

  /** Whether swing() would start one now. */
  get canSwing() {
    if (this.#phase === 'idle') return true
    if (this.#phase !== 'recover') return false
    const recovering = this.#time - this.windupDuration - this.swingDuration - this.followDuration
    return recovering >= this.cooldown
  }

  /** Starts a swing, from wherever the bat is. Returns false, doing nothing, until it can. */
  swing() {
    if (!this.canSwing) return false
    this.#reverse = false
    Object.assign(this.#start, this.#base)
    this.#phase = 'windup'
    this.#time = 0
    this.#rate = 1
    return true
  }

  /** Freezes the swing for `seconds`, the pause of an impact: `active` is false meanwhile, the recoil keeps moving. */
  hitStop(seconds) {
    this.#hitStop = Math.max(this.#hitStop, seconds)
  }

  /**
   * A solid in the way: the swing goes back `rewind` s of its time at once (to where it met the solid, posed now), and
   * after any hit stop runs back along its own path to rest, reboundRate × its pace.
   */
  rebound(rewind = 0) {
    if (!['windup', 'swing', 'follow'].includes(this.#phase)) return
    this.#reverse = true
    this.#time = Math.max(this.#time - Math.max(rewind, 0), 0)
    this.#sample(this.#time, this.#base)
    this.#apply(this.#base, this.#offset)
  }

  /** Jolts the bat as on impact: the barrel bounces back against the swing and rings; the swing loses speed. */
  recoil(amount = 1) {
    const batDirection = _v.set(0, 1, 0).applyQuaternion(this.#grip.quaternion)
    const speed = this.#localVelocity.length()
    if (speed > 0.5) {
      // rotating about v × bat moves the barrel against v
      this.#bounceAxis.crossVectors(this.#localVelocity, batDirection).normalize()
      this.#joltDirection.copy(this.#localVelocity).divideScalar(-speed)
    } else {
      this.#bounceAxis.crossVectors(batDirection, _axisX).normalize()
      this.#joltDirection.set(0, 0, 1)
    }
    this.#vibrationAxis.crossVectors(batDirection, this.#bounceAxis).normalize()
    this.#bounce.velocity += this.recoilKick * amount
    this.#vibration.velocity += this.vibrationKick * amount
    for (let i = 0; i < 3; i++)
      this.#jolt[i].velocity += this.#joltDirection.getComponent(i) * this.recoilDistance * amount
    if (this.#phase === 'swing' || this.#phase === 'follow') this.#rate = 1 - this.impactDrag
  }

  /** Fills `start` and `end` with this frame's barrel, sweet spot to tip, in world space. */
  getBarrelSegment(start, end) {
    start.copy(this.#segment[0])
    end.copy(this.#segment[1])
    return this
  }

  /** Fills `start` and `end` with last frame's barrel: with this frame's, the quad it swept. */
  getPreviousBarrelSegment(start, end) {
    start.copy(this.#previousSegment[0])
    end.copy(this.#previousSegment[1])
    return this
  }

  /** The sweet spot's world velocity this frame, m/s. */
  getSwingVelocity(target) {
    return target.copy(this.#velocity)
  }

  /** Whether the bat draws over meshes with a renderOrder below RENDER_ORDER (the walls), as view models do. */
  get overlay() {
    return this.#mask.visible
  }

  set overlay(value) {
    this.#mask.visible = value
  }

  /** Steps the swing, the sway and the recoil; `moveSpeed` is the player's speed over the floor, m/s. */
  update(delta, { moveSpeed = 0 } = {}) {
    delta = Math.min(Math.max(delta, 0), 0.1)
    this.#mask.geometry = this.bat.mesh.geometry // rebuild() replaces it
    this.#clock += delta
    this.#advance(delta)
    this.#sample(this.#time, this.#base)
    const offset = this.#offsets(delta, moveSpeed)
    this.#apply(this.#base, offset)
    this.#measure(delta)
  }

  // The swing's clock and phase.
  #advance(delta) {
    if (this.#phase === 'idle') return
    if (this.#hitStop > 0) {
      this.#hitStop -= delta
      if (this.#hitStop > 0) return
      delta = -this.#hitStop
      this.#hitStop = 0
    }
    if (this.#reverse) {
      this.#time -= delta * this.reboundRate
      if (this.#time > 0) {
        this.#phase = 'rebound'
        return
      }
      this.#time = 0
      this.#reverse = false
      this.#phase = 'idle'
      return
    }
    this.#rate += (1 - this.#rate) * (1 - Math.exp(-delta / this.dragRecovery))
    this.#time += delta * this.#rate
    const t = this.#time
    const ends = [this.windupDuration, this.swingDuration, this.followDuration, this.recoverDuration]
    let total = 0
    const phases = ['windup', 'swing', 'follow', 'recover']
    this.#phase = 'idle'
    for (let i = 0; i < 4; i++) {
      total += ends[i]
      if (t < total) {
        this.#phase = phases[i]
        break
      }
    }
  }

  // The path parameter at `time` s into the swing: 0 → 1 the windup, → 3 the swing (through contact at 2), → 4 the
  // follow-through, → 6 the recovery (through its low pose at 5).
  #pathAt(time) {
    const { windupDuration: w, swingDuration: s, followDuration: f, recoverDuration: r } = this
    if (time <= 0) return 0
    if (time < w) return easeInOut(time / w)
    if (time < w + s) return 1 + 2 * ((time - w) / s) ** this.swingPower
    if (time < w + s + f) {
      // exponential braking whose start matches the swing's end speed
      const rate = 2 * this.swingPower * (f / s)
      let k = rate
      for (let i = 0; i < 12; i++) k = Math.max(rate * (1 - Math.exp(-k)), 1e-3)
      return 3 + (1 - Math.exp(-k * ((time - w - s) / f))) / (1 - Math.exp(-k))
    }
    if (time < w + s + f + r) return 4 + 2 * smootherstep((time - w - s - f) / r)
    return 6
  }

  // The timeline's pose: the hands from `time`, the bat's turn from barrelLag earlier.
  #sample(time, out) {
    if (this.#phase === 'idle') return this.#setPose(out, this.poses.rest)
    this.#poseAt(this.#pathAt(time), this.#pose)
    const turnPath = this.#pathAt(time - this.barrelLag)
    this.#poseAt(turnPath, this.#turn)
    this.#path = turnPath
    out.x = this.#pose.x
    out.y = this.#pose.y
    out.z = this.#pose.z
    out.elevation = this.#turn.elevation
    out.azimuth = this.#turn.azimuth
    out.roll = this.#turn.roll
    return out
  }

  // The pose at path parameter `p`: cubic Hermite through the knots, from the start pose at 0.
  #poseAt(p, out) {
    const knots = POSE_ORDER.map((name, i) => (i === 0 ? this.#start : this.poses[name]))
    const last = knots.length - 1
    const i = Math.min(Math.floor(p), last - 1)
    const t = p - i
    const tangent = (k, key) =>
      MOVING_KNOTS.includes(k) ? (knots[Math.min(k + 1, last)][key] - knots[Math.max(k - 1, 0)][key]) / 2 : 0
    const [h00, h10, h01, h11] = [
      2 * t ** 3 - 3 * t ** 2 + 1,
      t ** 3 - 2 * t ** 2 + t,
      -2 * t ** 3 + 3 * t ** 2,
      t ** 3 - t ** 2,
    ]
    for (const key of POSE_KEYS) {
      out[key] = h00 * knots[i][key] + h10 * tangent(i, key) + h01 * knots[i + 1][key] + h11 * tangent(i + 1, key)
    }
    return out
  }

  #setPose(out, pose) {
    for (const key of POSE_KEYS) out[key] = pose[key]
    return out
  }

  // Breath, the walk's bob, the look's lag and the recoil, added to the pose.
  #offsets(delta, moveSpeed) {
    const offset = this.#offset
    for (const key of POSE_KEYS) offset[key] = 0
    const time = this.#clock

    const breath = Math.sin(TAU * this.breathFrequency * time)
    const drift = Math.sin(TAU * this.breathFrequency * 0.61 * time + 1.3)
    offset.y += breath * this.breathAmplitude
    offset.x += drift * this.breathAmplitude * 0.5
    offset.elevation += breath * this.breathAngle
    offset.azimuth += drift * this.breathAngle * 0.6

    const target = Math.min(moveSpeed / this.bobSpeed, 1.5)
    this.#walk += (target - this.#walk) * (1 - Math.exp(-delta / 0.15))
    this.#stride += (moveSpeed / this.stepLength) * Math.PI * delta
    const walk = this.#walk
    offset.y += -Math.abs(Math.sin(this.#stride)) * this.bobAmplitude * walk + this.bobAmplitude * 0.5 * walk
    offset.x += Math.sin(this.#stride) * this.bobSideAmplitude * walk
    offset.roll += Math.sin(this.#stride) * this.bobAngle * walk
    offset.elevation += Math.cos(2 * this.#stride) * this.bobAngle * 0.5 * walk

    // the look's angular velocity, in the camera's space, lags the bat behind the turn
    let yawRate = 0
    let pitchRate = 0
    const camera = this.parent
    if (camera && delta > 0) {
      camera.updateWorldMatrix(true, false)
      camera.matrixWorld.decompose(_v, _q, _v)
      if (this.#looked) {
        _q2.copy(this.#lookQuaternion).invert().multiply(_q)
        const angle = 2 * Math.acos(Math.min(Math.abs(_q2.w), 1))
        if (angle > 1e-6) {
          const s = Math.sign(_q2.w) / Math.sqrt(1 - _q2.w * _q2.w)
          yawRate = (_q2.y * s * angle) / delta
          pitchRate = (_q2.x * s * angle) / delta
        }
      }
      this.#lookQuaternion.copy(_q)
      this.#looked = true
    }
    const max = this.lookSwayMax
    this.#swayYaw.frequency = this.#swayPitch.frequency = this.lookSwayFrequency
    const clampSway = (v) => Math.min(Math.max(v, -max), max)
    // the sway is target + value: a new target moves the oscillator's rest, not the sway
    const yawTarget = clampSway(-yawRate * this.lookSway)
    const pitchTarget = clampSway(-pitchRate * this.lookSway)
    this.#swayYaw.value -= yawTarget - this.#swayYawTarget
    this.#swayPitch.value -= pitchTarget - this.#swayPitchTarget
    this.#swayYawTarget = yawTarget
    this.#swayPitchTarget = pitchTarget
    this.#swayYaw.step(delta)
    this.#swayPitch.step(delta)

    for (const oscillator of [this.#bounce, ...this.#jolt]) {
      oscillator.frequency = this.recoilFrequency
      oscillator.damping = this.recoilDamping
    }
    this.#vibration.frequency = this.vibrationFrequency
    this.#vibration.damping = this.vibrationDamping
    this.#bounce.step(delta)
    this.#vibration.step(delta)
    for (const oscillator of this.#jolt) oscillator.step(delta)
    return offset
  }

  // The grip's transform from the pose and its offsets.
  #apply(pose, offset) {
    const grip = this.#grip
    const yawLag = this.#swayYaw.value + this.#swayYawTarget
    const pitchLag = this.#swayPitch.value + this.#swayPitchTarget
    grip.position.set(
      pose.x + offset.x + this.#jolt[0].value - yawLag * this.lookSwayShift,
      pose.y + offset.y + this.#jolt[1].value + pitchLag * this.lookSwayShift,
      pose.z + offset.z + this.#jolt[2].value,
    )
    const elevation = (pose.elevation + offset.elevation) * DEG
    const azimuth = (pose.azimuth + offset.azimuth) * DEG
    const roll = (pose.roll + offset.roll) * DEG
    // the bat's +y turned to the direction, rolled about itself first
    grip.quaternion
      .setFromAxisAngle(_axisY, -azimuth)
      .multiply(_q.setFromAxisAngle(_axisX, elevation - Math.PI / 2))
      .multiply(_q.setFromAxisAngle(_axisY, roll))
    // the look's lag and the recoil turn it about the hands, in the camera's space
    grip.quaternion.premultiply(_q.setFromAxisAngle(_axisY, yawLag))
    grip.quaternion.premultiply(_q.setFromAxisAngle(_axisX, pitchLag))
    grip.quaternion.premultiply(_q.setFromAxisAngle(this.#bounceAxis, this.#bounce.value))
    grip.quaternion.premultiply(_q.setFromAxisAngle(this.#vibrationAxis, this.#vibration.value))
    this.bat.position.set(0, -this.gripDistance, 0)
  }

  // The sweet spot's and the barrel's world positions and velocity.
  #measure(delta) {
    this.bat.updateWorldMatrix(true, false)
    this.#previousSegment[0].copy(this.#segment[0])
    this.#previousSegment[1].copy(this.#segment[1])
    const bat = this.bat
    bat.localToWorld(bat.getPoint(bat.sweetSpot, this.#segment[0]))
    bat.localToWorld(bat.getPoint(bat.length, this.#segment[1]))
    const previous = _v.copy(this.#sweet)
    this.#sweet.copy(this.#segment[0])
    this.#previousSweetLocal.copy(this.#sweetLocal)
    this.#sweetLocal.copy(this.#sweet)
    this.worldToLocal(this.#sweetLocal)
    if (this.#primed && delta > 0) {
      this.#velocity.subVectors(this.#sweet, previous).divideScalar(delta)
      this.#localVelocity.subVectors(this.#sweetLocal, this.#previousSweetLocal).divideScalar(delta)
    } else {
      this.#previousSegment[0].copy(this.#segment[0])
      this.#previousSegment[1].copy(this.#segment[1])
    }
    this.#primed = true
  }
}

// ─── Impact ──────────────────────────────────────────────────────────────────

// The bat's impact, besides the worms' own flight: its sounds, synthesized with WebAudio from noise and oscillators
// (no files), and a spray of slime droplets that fly, fall, and stain where they land.
//
//   const audio = new ImpactAudio({ volume: 0.8 })
//   audio.prepare(48000)                  // while loading: the noise and the hall synthesized ahead, at that rate
//   audio.whoosh(1)                       // on every swing; the first, from a click, starts the audio
//   audio.hit(1)                          // on contact: a thump, a woody knock, a squelch, then worms slapping a wall
//   audio.hit(1, { wet: false })          // the thump and knock alone, when SquishAudio.burst() gives the squelch
//   audio.bang(1)                         // a stall door struck or slamming: a hollow thud, a knock, a latch's rattle
//   audio.death(1)                        // swallowed: a deep boom and a dark chord tolling away in a hall
//   const spray = new SlimeSpray({ count: 160, color: '#5a1626' })
//   scene.add(spray)
//   spray.burst(point, direction, { count: 50, speed: 5 })
//   spray.update(delta, restroom.bounds)  // every frame

const AUDIO_OPTIONS = ['volume']
const HALL_SECONDS = 4.5

// White noise, −1 to 1, into `data`.
function whiteNoise(data) {
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return data
}

// One channel of a long dark room's impulse into `data`: noise decaying, its highs dying first.
function hallImpulse(data, sampleRate) {
  let low = 0
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate
    // a one-pole lowpass whose cutoff falls with time: the tail darkens
    const k = Math.min(1, 0.5 * Math.exp(-t * 1.4) + 0.02)
    low += k * (Math.random() * 2 - 1 - low)
    data[i] = low * Math.exp(-t * 1.6) * (t < 0.02 ? t / 0.02 : 1)
  }
  return data
}

// Short-lived graphs of WebAudio nodes per sound; silent without an AudioContext. The context starts at the first
// sound, from the click that swings.
class ImpactAudio {
  isImpactAudio = true
  type = 'ImpactAudio'
  volume = 0.8
  #context = null
  #master = null
  #noise = null
  #hall = null // a convolver: a long dark room's reverb, made at the first death or, prepared, once the page idles
  #hallWet = null // the hall's level, until the first death joins it to the master
  #hallSamples = null // prepare()'s impulse, [left, right], until the hall is made from it
  #prepared = null // prepare()'s samples: { sampleRate, noise, hall }
  #whoosh = null // the last whoosh's envelope, cut short by a hit

  constructor(options = {}) {
    for (const key of Object.keys(options)) {
      if (!AUDIO_OPTIONS.includes(key)) console.warn(`ImpactAudio: unknown option "${key}".`)
      else this[key] = options[key]
    }
  }

  /**
   * Synthesizes the noise and the hall's impulse ahead, for a context running at `sampleRate` Hz (48000 on most
   * devices), so neither the first sound nor the first death waits on them: call it while the page loads, before the
   * first sound. The context still starts at the first sound; at another rate it synthesizes them at first use. The
   * samples (about 2 MB at 48 kHz) are held until that first sound, so skip it when no sound will play.
   * @param {number} sampleRate
   */
  prepare(sampleRate) {
    if (!(globalThis.AudioContext ?? globalThis.webkitAudioContext) || this.#context) return this
    const length = Math.round(sampleRate * HALL_SECONDS)
    const noise = whiteNoise(new Float32Array(sampleRate))
    const hall = [0, 1].map(() => hallImpulse(new Float32Array(length), sampleRate))
    this.#prepared = { sampleRate, noise, hall }
    return this
  }

  #ready() {
    const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext
    if (!Context) return null
    if (!this.#context) {
      const context = (this.#context = new Context())
      this.#master = context.createGain()
      this.#master.connect(context.destination)
      const prepared = this.#prepared?.sampleRate === context.sampleRate ? this.#prepared : null
      this.#prepared = null
      // 1 s of white noise, played from random offsets
      const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate)
      if (prepared) buffer.copyToChannel(prepared.noise, 0)
      else whiteNoise(buffer.getChannelData(0))
      this.#noise = buffer
      if (prepared) {
        // the convolver's setup takes milliseconds too: in an idle moment rather than in the gesture or the death
        this.#hallSamples = prepared.hall
        const idle = globalThis.requestIdleCallback ?? setTimeout
        idle(() => this.#context === context && this.#hallOf(context))
      }
    }
    if (this.#context.state === 'suspended') this.#context.resume()
    this.#master.gain.value = this.volume
    return this.#context
  }

  // Noise through a filter, its gain an attack then an exponential decay, from `at` s, into `output`.
  #noiseBurst(context, at, { type, frequency, to = frequency, q = 1, gain, attack, decay, output = this.#master }) {
    const source = context.createBufferSource()
    source.buffer = this.#noise
    const filter = context.createBiquadFilter()
    filter.type = type
    filter.Q.value = q
    filter.frequency.setValueAtTime(frequency, at)
    filter.frequency.exponentialRampToValueAtTime(Math.max(to, 1), at + attack + decay)
    const envelope = context.createGain()
    envelope.gain.setValueAtTime(0.0001, at)
    envelope.gain.exponentialRampToValueAtTime(gain, at + attack)
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay)
    source.connect(filter).connect(envelope).connect(output)
    source.start(at, Math.random() * 0.5, attack + decay + 0.05)
    return envelope
  }

  // An oscillator gliding from `from` to `to` Hz, its gain an attack then an exponential decay, from `at` s, into
  // `output`, through a lowpass closing from `bright` to `dark` Hz if given.
  #tone(context, at, { type, from, to, gain, attack, decay, output = this.#master, bright, dark = bright }) {
    const oscillator = context.createOscillator()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(from, at)
    oscillator.frequency.exponentialRampToValueAtTime(to, at + attack + decay)
    const envelope = context.createGain()
    envelope.gain.setValueAtTime(0.0001, at)
    envelope.gain.exponentialRampToValueAtTime(gain, at + attack)
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay)
    let input = oscillator
    if (bright !== undefined) {
      const filter = context.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.setValueAtTime(bright, at)
      filter.frequency.exponentialRampToValueAtTime(Math.max(dark, 1), at + attack + decay)
      input = oscillator.connect(filter)
    }
    input.connect(envelope).connect(output)
    oscillator.start(at)
    oscillator.stop(at + attack + decay + 0.05)
  }

  // A long dark room: 4.5 s of stereo noise decaying, its highs dying first, prepared or synthesized now. Its level
  // joins the master at the first death, so the context renders none of it before.
  #hallOf(context) {
    if (this.#hall) return this.#hall
    const length = Math.round(context.sampleRate * HALL_SECONDS)
    const impulse = context.createBuffer(2, length, context.sampleRate)
    const samples = this.#hallSamples
    this.#hallSamples = null
    for (let channel = 0; channel < 2; channel++) {
      if (samples) impulse.copyToChannel(samples[channel], channel)
      else hallImpulse(impulse.getChannelData(channel), context.sampleRate)
    }
    const convolver = context.createConvolver()
    convolver.buffer = impulse
    this.#hallWet = context.createGain()
    this.#hallWet.gain.value = 1.4
    convolver.connect(this.#hallWet)
    return (this.#hall = convolver)
  }

  /** The AudioContext once a sound or unlock() has started it, else null. */
  get context() {
    return this.#context
  }

  /** Starts or resumes the audio: call it from a touch or a click, which browsers let audio start from. */
  unlock() {
    this.#ready()
  }

  /** The bat cutting the air: a band of noise sweeping up and back down. */
  whoosh(amplitude = 1) {
    const context = this.#ready()
    if (!context) return
    const at = context.currentTime
    this.#whoosh = this.#noiseBurst(context, at, {
      type: 'bandpass',
      frequency: 350,
      to: 2200,
      q: 1.4,
      gain: 0.35 * amplitude,
      attack: 0.07,
      decay: 0.2,
    })
  }

  /**
   * The bat meeting the worms: a deep thump, a woody knock, and unless `wet` is false a wet squelch and a few worms
   * slapping a wall after their flight. `amplitude` 0 to 1 and more scales them all.
   */
  hit(amplitude = 1, { wet = true } = {}) {
    const context = this.#ready()
    if (!context) return
    const at = context.currentTime
    const a = Math.max(amplitude, 0.05)
    // the bat stops cutting the air
    if (this.#whoosh) {
      const gain = this.#whoosh.gain
      gain.cancelScheduledValues(at)
      gain.setValueAtTime(Math.max(gain.value, 0.0001), at)
      gain.exponentialRampToValueAtTime(0.0001, at + 0.02)
      this.#whoosh = null
    }
    this.#tone(context, at, { type: 'sine', from: 150, to: 38, gain: 0.9 * a, attack: 0.004, decay: 0.28 })
    this.#tone(context, at, { type: 'triangle', from: 720, to: 430, gain: 0.25 * a, attack: 0.002, decay: 0.05 })
    this.#noiseBurst(context, at, {
      type: 'lowpass',
      frequency: 2400,
      to: 300,
      gain: 0.5 * a,
      attack: 0.003,
      decay: 0.09,
    })
    if (!wet) return
    this.#noiseBurst(context, at + 0.01, {
      type: 'bandpass',
      frequency: 900,
      to: 260,
      q: 4,
      gain: 0.7 * a,
      attack: 0.01,
      decay: 0.22,
    })
    const slaps = 3 + Math.floor(Math.random() * 3)
    for (let i = 0; i < slaps; i++) {
      const later = at + 0.12 + Math.random() * 0.45
      this.#noiseBurst(context, later, {
        type: 'bandpass',
        frequency: 500 + Math.random() * 900,
        to: 180,
        q: 2.5,
        gain: (0.15 + Math.random() * 0.25) * a,
        attack: 0.004,
        decay: 0.06 + Math.random() * 0.08,
      })
    }
  }

  /**
   * A stall door struck or slamming on a stop: the hollow thud of its panel, a knock, and the rattle of its latch and
   * hinges. `amplitude` 0 to 1 and more scales them.
   */
  bang(amplitude = 1) {
    const context = this.#ready()
    if (!context) return
    const at = context.currentTime
    const a = Math.max(amplitude, 0.05)
    this.#tone(context, at, { type: 'sine', from: 120, to: 58, gain: 0.7 * a, attack: 0.003, decay: 0.3 })
    this.#tone(context, at, { type: 'triangle', from: 262, to: 238, gain: 0.16 * a, attack: 0.002, decay: 0.35 })
    this.#noiseBurst(context, at, {
      type: 'bandpass',
      frequency: 720,
      to: 240,
      q: 2,
      gain: 0.6 * a,
      attack: 0.002,
      decay: 0.12,
    })
    const rattles = 2 + Math.floor(Math.random() * 3)
    for (let i = 0; i < rattles; i++) {
      this.#noiseBurst(context, at + 0.012 + Math.random() * 0.09, {
        type: 'bandpass',
        frequency: 3000 + Math.random() * 2600,
        to: 2400,
        q: 6,
        gain: (0.07 + Math.random() * 0.1) * a,
        attack: 0.001,
        decay: 0.03 + Math.random() * 0.04,
      })
    }
  }

  /**
   * The bat meeting something solid, `surface` 'tile' (the walls and floor), 'panel' (a partition or divider),
   * 'ceramic' (a toilet, sink or urinal) or 'metal' (a fitting): a sharp crack, the bat's own woody knock and the sting
   * ringing through it, and the surface's answer: glazed tile over solid wall a short dull thud, a tink and grit; a
   * panel a hollow boom and a rattle; ceramic a bright ring; metal a clang. `amplitude` 0 to 1 and more scales them.
   */
  wallHit(amplitude = 1, surface = 'tile') {
    const context = this.#ready()
    if (!context) return
    const at = context.currentTime
    const a = Math.max(amplitude, 0.05)
    // the crack of the contact, and the ash bat's knock and sting
    this.#noiseBurst(context, at, { type: 'highpass', frequency: 3200, gain: 0.55 * a, attack: 0.0006, decay: 0.014 })
    this.#tone(context, at, { type: 'triangle', from: 560, to: 500, gain: 0.32 * a, attack: 0.001, decay: 0.07 })
    this.#tone(context, at, { type: 'sine', from: 1260, to: 1190, gain: 0.14 * a, attack: 0.001, decay: 0.045 })
    this.#tone(context, at + 0.004, {
      type: 'sawtooth',
      from: 182,
      to: 176,
      gain: 0.05 * a,
      attack: 0.004,
      decay: 0.32,
    })
    if (surface === 'panel') {
      this.#tone(context, at, { type: 'sine', from: 118, to: 62, gain: 0.75 * a, attack: 0.003, decay: 0.32 })
      this.#noiseBurst(context, at, {
        type: 'bandpass',
        frequency: 640,
        to: 220,
        q: 2,
        gain: 0.55 * a,
        attack: 0.002,
        decay: 0.14,
      })
      for (let i = 0; i < 3; i++) {
        this.#noiseBurst(context, at + 0.015 + Math.random() * 0.08, {
          type: 'bandpass',
          frequency: 2800 + Math.random() * 2400,
          to: 2200,
          q: 6,
          gain: (0.05 + Math.random() * 0.08) * a,
          attack: 0.001,
          decay: 0.03 + Math.random() * 0.04,
        })
      }
    } else if (surface === 'ceramic' || surface === 'metal') {
      const partials = surface === 'ceramic' ? [1730, 2910, 4460] : [880, 2340, 3710, 5230]
      const decay = surface === 'ceramic' ? 0.28 : 0.6
      this.#tone(context, at, { type: 'sine', from: 160, to: 90, gain: 0.35 * a, attack: 0.002, decay: 0.09 })
      partials.forEach((frequency, i) => {
        const gain = (surface === 'ceramic' ? 0.12 : 0.1) * a * (1 - i * 0.18)
        this.#tone(context, at, {
          type: 'sine',
          from: frequency,
          to: frequency * 0.997,
          gain,
          attack: 0.001,
          decay: decay / (1 + i * 0.4),
        })
      })
    } else {
      // tile on a solid wall: dead underneath, a bright glaze on top, a little grit as it chips
      this.#tone(context, at, { type: 'sine', from: 96, to: 52, gain: 0.8 * a, attack: 0.002, decay: 0.11 })
      this.#noiseBurst(context, at, {
        type: 'lowpass',
        frequency: 1800,
        to: 240,
        gain: 0.45 * a,
        attack: 0.002,
        decay: 0.05,
      })
      this.#tone(context, at, { type: 'sine', from: 2870, to: 2860, gain: 0.07 * a, attack: 0.001, decay: 0.09 })
      this.#tone(context, at, { type: 'sine', from: 4710, to: 4690, gain: 0.045 * a, attack: 0.001, decay: 0.06 })
      this.#noiseBurst(context, at + 0.003, {
        type: 'bandpass',
        frequency: 2100,
        q: 1.6,
        gain: 0.18 * a,
        attack: 0.001,
        decay: 0.05,
      })
      for (let i = 0; i < 4; i++) {
        this.#noiseBurst(context, at + 0.03 + Math.random() * 0.12, {
          type: 'highpass',
          frequency: 3500 + Math.random() * 2500,
          gain: (0.03 + Math.random() * 0.04) * a,
          attack: 0.0008,
          decay: 0.012 + Math.random() * 0.015,
        })
      }
    }
  }

  /**
   * Swallowed: a deep boom, and a dark minor chord rubbing against a semitone swelling in and tolling away, with a
   * low rumble and a faint bell, all in a long dark hall. `amplitude` 0 to 1 and more scales it.
   */
  death(amplitude = 1) {
    const context = this.#ready()
    if (!context) return
    const at = context.currentTime + 0.02
    const a = Math.max(amplitude, 0.05)
    const bus = context.createGain()
    bus.connect(this.#master)
    bus.connect(this.#hallOf(context))
    this.#hallWet?.connect(this.#master)
    this.#hallWet = null
    this.#tone(context, at, { type: 'sine', from: 62, to: 29, gain: 1.1 * a, attack: 0.012, decay: 2.6, output: bus })
    this.#noiseBurst(context, at, {
      type: 'lowpass',
      frequency: 900,
      to: 60,
      gain: 0.55 * a,
      attack: 0.01,
      decay: 1.6,
      output: bus,
    })
    // D minor with an E flat over it, in brass-like saws, each a pair a few cents apart
    for (const [frequency, gain] of [
      [36.71, 0.2],
      [73.42, 0.26],
      [110, 0.18],
      [146.83, 0.16],
      [174.61, 0.12],
      [155.56, 0.07],
    ]) {
      for (const cents of [-7, 6]) {
        const f = frequency * 2 ** (cents / 1200)
        this.#tone(context, at, {
          type: 'sawtooth',
          from: f,
          to: f * 0.985,
          gain: gain * a,
          attack: 0.09,
          decay: 3.8,
          output: bus,
          bright: 2200,
          dark: 140,
        })
      }
    }
    for (const [ratio, gain] of [
      [1, 0.06],
      [2.76, 0.035],
      [5.4, 0.02],
    ]) {
      const f = 196 * ratio
      this.#tone(context, at + 0.03, {
        type: 'sine',
        from: f,
        to: f * 0.998,
        gain: gain * a,
        attack: 0.004,
        decay: 3.2,
        output: bus,
      })
    }
  }

  dispose() {
    this.#context?.close?.()
    this.#context = this.#master = this.#noise = this.#hall = this.#hallWet = this.#hallSamples = this.#prepared = null
    this.#whoosh = null
  }
}

const SPRAY_OPTIONS = ['count', 'color', 'radius', 'life', 'gravity', 'drag', 'stretch']
const STAIN_RINGS = 4
const STAIN_SEGMENTS = 48
const STAIN_LIFT = 0.0015 // m off the surface a stain lies, clear of its depth
const _impactMatrix = new THREE.Matrix4()
const _impactQuaternion = new THREE.Quaternion()
const _impactScale = new THREE.Vector3()
const _impactUp = new THREE.Vector3(0, 1, 0)
const _impactDirection = new THREE.Vector3()
const _impactSide = new THREE.Vector3()
const _along = new THREE.Vector3()
const _impactAcross = new THREE.Vector3()

// The first `count` floats of a buffer, sent at its next draw.
function upload(buffer, count) {
  buffer.clearUpdateRanges()
  buffer.addUpdateRange(0, count)
  buffer.needsUpdate = true
}

// A unit disc in xz, domed to y 1 at its centre: a stain's shape before its rim is broken up.
function stainGeometry() {
  const positions = [0, 1, 0]
  const indices = []
  for (let ring = 1; ring <= STAIN_RINGS; ring++) {
    const t = ring / STAIN_RINGS
    for (let s = 0; s < STAIN_SEGMENTS; s++) {
      const angle = (s / STAIN_SEGMENTS) * Math.PI * 2
      positions.push(t * Math.cos(angle), 1 - t * t, t * Math.sin(angle))
    }
  }
  const at = (ring, s) => (ring === 0 ? 0 : 1 + (ring - 1) * STAIN_SEGMENTS + (s % STAIN_SEGMENTS))
  for (let s = 0; s < STAIN_SEGMENTS; s++) indices.push(at(0, 0), at(1, s + 1), at(1, s))
  for (let ring = 1; ring < STAIN_RINGS; ring++) {
    for (let s = 0; s < STAIN_SEGMENTS; s++) {
      indices.push(at(ring, s), at(ring, s + 1), at(ring + 1, s))
      indices.push(at(ring, s + 1), at(ring + 1, s + 1), at(ring + 1, s))
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

// Slime droplets: each flies stretched along its velocity under gravity and drag, and sticks where it meets the floor
// or a wall of `bounds` as a stain (the `stains` child): its rim broken into lobes and spikes by its own seed, drawn
// out with a tail the way it was going, the longer the more it grazed the surface; shrinking away over the end of its
// life. CPU-simulated, one draw each.
class SlimeSpray extends THREE.InstancedMesh {
  isSlimeSpray = true
  type = 'SlimeSpray'
  radius = 0.012 // m, a droplet's mean radius
  life = 60 // s a droplet lasts, stuck or not
  gravity = -9.81
  drag = 1.2 // 1/s
  stretch = 0.05 // × the speed in m/s: how long a flying droplet draws out
  /** The droplets stuck to a surface. */
  stains
  #drops = []
  #seeds
  #matrices // the stains' instance matrices again, for their positionNode
  #u = { irregularity: uniform(1), spikes: uniform(1), tail: uniform(1) }
  #changed = true // a burst or a clear since the last update
  #life = 0 // life and stretch as the matrices were last written with
  #stretch = 0
  #drawn = 0 // bits: the droplets (1) and the stains (2) have been drawn, so their pipelines are built

  /** @param {object} [options] - count (160, droplets alive at once), color, and any of the settings above. */
  constructor(options = {}) {
    const count = options.count ?? 160
    const geometry = new THREE.IcosahedronGeometry(1, 1)
    const material = new THREE.MeshPhysicalNodeMaterial({
      name: 'slime droplet',
      color: options.color ?? '#5a1626',
      roughness: 0.18,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
    })
    super(geometry, material, count)
    for (const key of Object.keys(options)) {
      if (!SPRAY_OPTIONS.includes(key)) console.warn(`SlimeSpray: unknown option "${key}".`)
      else if (!['count', 'color'].includes(key)) this[key] = options[key]
    }
    this.name = 'slime spray'
    this.frustumCulled = false
    this.castShadow = false
    this.receiveShadow = true
    this.count = 0

    // The stain's rim, by angle round it (local +x the way the droplet went): lobes, a few thin spikes and a tail.
    this.#seeds = new THREE.InstancedBufferAttribute(new Float32Array(count), 1)
    const seed = instancedBufferAttribute(this.#seeds)
    const u = this.#u
    const p = positionGeometry
    const angle = atan(p.z, p.x)
    const wave = (k, salt) => sin(angle.mul(k).add(seed.mul(salt)))
    const lobes = wave(2, 7.31)
      .mul(0.14)
      .add(wave(3, 17.13).mul(0.16))
      .add(wave(5, 41.7).mul(0.1))
      .add(wave(9, 73.1).mul(0.06))
    const spikes = pow(max(wave(7, 91.3), 0), 14)
      .add(pow(max(wave(13, 29.9), 0), 24))
      .mul(0.45)
    const tail = pow(max(cos(angle), 0), 10).mul(0.9)
    const rim = lobes.mul(u.irregularity).add(spikes.mul(u.spikes)).add(tail.mul(u.tail)).add(1)
    const stainMaterial = new THREE.MeshPhysicalNodeMaterial({
      name: 'slime stain',
      roughness: 0.18,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
    })
    this.stains = new THREE.InstancedMesh(stainGeometry(), stainMaterial, count)
    // a positionNode replaces the instanced position, so it places the broken-up stain by its instance matrix itself
    this.#matrices = new THREE.InstancedInterleavedBuffer(this.stains.instanceMatrix.array, 16, 1)
    const column = (k) => instancedBufferAttribute(this.#matrices, 'vec4', 16, 4 * k)
    const instance = mat4(column(0), column(1), column(2), column(3))
    stainMaterial.positionNode = instance.mul(vec4(p.x.mul(rim), p.y, p.z.mul(rim), 1)).xyz
    this.stains.name = 'slime stains'
    this.stains.frustumCulled = false
    this.stains.castShadow = false
    this.stains.receiveShadow = true
    this.stains.count = 0
    this.add(this.stains)
    // Uploaded only as they change (static buffers, a range of the live ones), and hidden while none live, once drawn
    // empty: that first draw builds their pipelines, so a burst doesn't wait on them.
    this.onAfterRender = () => (this.#drawn |= 1)
    this.stains.onAfterRender = () => (this.#drawn |= 2)
  }

  /** How much a stain's rim bulges into lobes, 0 a plain oval. */
  get irregularity() {
    return this.#u.irregularity.value
  }

  set irregularity(value) {
    this.#u.irregularity.value = value
  }

  /** How far a stain's thin spikes reach, × its radius. */
  get spikes() {
    return this.#u.spikes.value
  }

  set spikes(value) {
    this.#u.spikes.value = value
  }

  /** How long a stain's tail draws out the way the droplet went, × its radius. */
  get tail() {
    return this.#u.tail.value
  }

  set tail(value) {
    this.#u.tail.value = value
  }

  /** `count` droplets from `origin` along `direction` (world) at 0.4–1.2 × `speed` m/s, turned by up to `spread`. */
  burst(origin, direction, { count = 40, speed = 4, spread = 0.6 } = {}) {
    const capacity = this.instanceMatrix.count
    for (let i = 0; i < count; i++) {
      if (this.#drops.length >= capacity) this.#drops.shift()
      _impactDirection
        .set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
        .multiplyScalar(2 * spread)
        .add(direction)
        .normalize()
      this.#drops.push({
        position: origin.clone(),
        velocity: _impactDirection.clone().multiplyScalar(speed * (0.4 + 0.8 * Math.random())),
        size: this.radius * (0.4 + 1.2 * Math.random() ** 2),
        age: 0,
        stuck: null, // the surface's normal once it lands
        along: new THREE.Vector3(1, 0, 0), // the way it slid on, along the surface
        smear: 0, // how much it grazed the surface: 0 head-on, 1 along it
        seed: Math.random() * 100,
      })
    }
    this.#changed = true
    return this
  }

  /** `delta` s further, landing on the floor and the walls of `bounds` (world). */
  update(delta, bounds) {
    const drops = this.#drops
    // what changed: the droplets in flight while time runs; the stains as droplets land, go, or fade
    let flown = this.#changed || this.life !== this.#life || this.stretch !== this.#stretch
    let stained = flown
    for (let i = drops.length - 1; i >= 0; i--) {
      const drop = drops[i]
      drop.age += delta
      if (drop.age > this.life) {
        drops.splice(i, 1)
        flown = stained = true
      } else if (!drop.stuck) {
        this.#fly(drop, delta, bounds)
        flown ||= delta !== 0 || drop.stuck !== null
        stained ||= drop.stuck !== null
      } else stained ||= delta !== 0 && this.#fade(drop) < 1
    }
    let flying = 0
    let stuck = 0
    for (const drop of drops) {
      if (drop.stuck) {
        if (stained) {
          this.#seeds.array[stuck] = drop.seed
          this.stains.setMatrixAt(stuck, this.#stainMatrixOf(drop))
        }
        stuck++
      } else {
        if (flown) this.setMatrixAt(flying, this.#matrixOf(drop))
        flying++
      }
    }
    this.count = flying
    this.stains.count = stuck
    if (flown && flying > 0) upload(this.instanceMatrix, 16 * flying)
    if (stained && stuck > 0) {
      upload(this.stains.instanceMatrix, 16 * stuck)
      upload(this.#matrices, 16 * stuck)
      upload(this.#seeds, stuck)
    }
    const built = this.#drawn === 3
    this.material.visible = flying > 0 || !built
    this.stains.visible = stuck > 0 || !built
    this.#changed = false
    this.#life = this.life
    this.#stretch = this.stretch
    this.stains.material.color.copy(this.material.color)
    return this
  }

  #fly(drop, delta, bounds) {
    const { position, velocity } = drop
    velocity.y += this.gravity * delta
    velocity.multiplyScalar(Math.exp(-this.drag * delta))
    position.addScaledVector(velocity, delta)
    const { min, max } = bounds
    const r = drop.size * 0.5
    let normal = null
    if (position.y < min.y + r) normal = new THREE.Vector3(0, 1, 0)
    else if (position.x < min.x + r) normal = new THREE.Vector3(1, 0, 0)
    else if (position.x > max.x - r) normal = new THREE.Vector3(-1, 0, 0)
    else if (position.z < min.z + r) normal = new THREE.Vector3(0, 0, 1)
    else if (position.z > max.z - r) normal = new THREE.Vector3(0, 0, -1)
    if (!normal) return
    position.clamp(_impactSide.copy(min).addScalar(r), _impactDirection.copy(max).subScalar(r))
    position.addScaledVector(normal, STAIN_LIFT - r)
    // the way it slid on, and how much it grazed rather than met the surface
    const speed = velocity.length()
    drop.along.copy(velocity).addScaledVector(normal, -velocity.dot(normal))
    const sliding = drop.along.length()
    if (sliding > 1e-4) drop.along.divideScalar(sliding)
    else
      drop.along
        .set(Math.random() - 0.5, 0, Math.random() - 0.5)
        .projectOnPlane(normal)
        .normalize()
    drop.smear = speed > 1e-4 ? sliding / speed : 0
    drop.stuck = normal
    velocity.set(0, 0, 0)
  }

  // Stretched along its flight, shrinking over the last quarter of its life.
  #matrixOf(drop) {
    const size = drop.size * this.#fade(drop)
    const speed = drop.velocity.length()
    _impactQuaternion.setFromUnitVectors(
      _impactUp,
      _impactDirection.copy(drop.velocity).divideScalar(Math.max(speed, 1e-6)),
    )
    _impactScale.set(size, size * (1 + this.stretch * speed * 10), size)
    return _impactMatrix.compose(drop.position, _impactQuaternion, _impactScale)
  }

  // Flat on its surface, local +x the way it slid on: longer and narrower the more it grazed, ahead of where it hit.
  #stainMatrixOf(drop) {
    const size = drop.size * this.#fade(drop)
    const long = size * 2.2 * (1 + 1.2 * drop.smear)
    const wide = size * 2.2 * (1 - 0.3 * drop.smear)
    _impactAcross.crossVectors(drop.along, drop.stuck)
    _impactMatrix.makeBasis(
      _along.copy(drop.along).multiplyScalar(long),
      _impactDirection.copy(drop.stuck).multiplyScalar(size * 0.3),
      _impactAcross.multiplyScalar(wide),
    )
    _impactSide.copy(drop.position).addScaledVector(drop.along, size * drop.smear)
    return _impactMatrix.setPosition(_impactSide)
  }

  #fade(drop) {
    return Math.min(1, (this.life - drop.age) / (this.life / 4))
  }

  /** Every droplet gone. */
  clear() {
    this.#drops.length = 0
    this.count = 0
    this.stains.count = 0
    this.#changed = true
    return this
  }

  /**
   * Draws the droplets and the stains for a frame even while none live, so their pipelines are built anew now: call it
   * when the scene's lights, shadows, environment or fog change.
   */
  rewarm() {
    this.#drawn = 0
    return this
  }

  dispose() {
    this.geometry.dispose()
    this.material.dispose()
    this.stains.geometry.dispose()
    this.stains.material.dispose()
    this.stains.dispose()
    super.dispose()
  }
}

// ─── Squish sound ────────────────────────────────────────────────────────────

// The worms squishing against each other, a granular WebAudio texture: overlapping grains of squishing flesh at random
// offsets, pitches and lengths, some backwards, one continuous squish as loud as `activity` (0 silent, 1 the packed
// body walking). The flesh is synthesized (synthesizeSquish: bubbles popping, a wet crackle and hiss over a low swell).
// It is heard in 3D from where the worms are, fading with distance, over a tiled room's reverb. A hit adds a burst:
// the hardest squelches, low and heavy, then the thrown worms slapping a wall at the view's right.
//
//   const audio = new ImpactAudio()                // shares its AudioContext, started by a click
//   const squish = new SquishAudio(audio, { volume: 1 })
//   squish.prepare(48000)                          // while loading: the texture synthesized ahead, at that rate
//   squish.activity = 0.7                          // every frame: how much the worms rub and slide over each other
//   squish.update(delta, wormsPoint, camera)       // schedules the grains, heard from wormsPoint at the camera
//   squish.burst(1)                                // the bat's hit
//   squish.synth.bubblePitch = 1200                // the synth's settings: a change synthesizes the texture anew

const SQUISH_OPTIONS = [
  'volume',
  'synth',
  'density',
  'grainLength',
  'grainSpread',
  'pitch',
  'pitchSpread',
  'reverse',
  'tone',
  'smoothing',
  'distance',
  'rolloff',
  'room',
  'roomTime',
  'muffle',
  'muffleTone',
  'slaps',
  'slapPan',
]
const LOOKAHEAD = 0.1 // s of grains scheduled ahead of the context's clock
const RESYNTHESIZE_EVERY = 0.2 // s at least between two syntheses while the settings change
const SILENT = 1e-3 // the level below which no grains play
const SQUELCHES = 7 // the texture's strongest events a burst draws from
const _squishPosition = new THREE.Vector3()
const _forward = new THREE.Vector3()
const _squishUp = new THREE.Vector3()
const _toSource = new THREE.Vector3()

// Whether settings `a` (or null) hold every value of `b`.
function sameSettings(a, b) {
  if (!a) return false
  for (const key in b) if (!Object.is(a[key], b[key])) return false
  return true
}

// Eases `param` toward `value` from `at` over `tau` s unless `last`, the target it was last given, is `value`: a
// repeat would only go on along the same curve. Returns the target.
function easeTo(param, value, last, at, tau) {
  if (!Object.is(value, last)) param.setTargetAtTime(value, at, tau)
  return value
}

// A tiled room's response, one channel of it into `data` (zeros): a few early reflections in its first 40 ms, then a
// diffuse tail falling 60 dB over `time` s, its highs dying sooner; of unit energy.
function roomImpulse(data, sampleRate, time) {
  const sr = sampleRate
  const decay = Math.log(1000) / time // 1/s: the amplitude's fall, 60 dB over `time`
  for (let k = 0; k < 8; k++) {
    const at = Math.round(sr * (0.003 + Math.random() * 0.037))
    data[at] += (Math.random() < 0.5 ? -1 : 1) * (0.3 + 0.5 * Math.random()) * (1 - at / (0.06 * sr))
  }
  let low = 0
  for (let i = Math.round(0.01 * sr); i < data.length; i++) {
    const t = i / sr
    // a one-pole lowpass closing as the tail goes on
    low += (0.08 + 0.6 * Math.exp((-2 * t) / time)) * (Math.random() * 2 - 1 - low)
    data[i] += 0.5 * low * Math.exp(-decay * t) * Math.min((t - 0.01) / 0.01, 1)
  }
  let energy = 0
  for (let i = 0; i < data.length; i++) energy += data[i] * data[i]
  const scale = 1 / Math.sqrt(energy || 1)
  for (let i = 0; i < data.length; i++) data[i] *= scale
  return data
}

// The room's impulse length for `time`, in samples.
const roomLength = (sampleRate, time) => Math.round(sampleRate * time * 1.2)

// The synth's settings, fitted to a recording of a raw chicken breast squeezed by its features: the 1/3-octave
// spectrum (3 dB apart on average, 20 Hz–13 kHz), spectral centroid and flatness, the pops' pitch and its spread,
// clicks and squishes per second and the loudness of its quiet and loud moments.
const SQUISH_SYNTH_DEFAULTS = {
  seconds: 4, // s of texture the grains are drawn from
  seed: 1,
  events: 6, // squishes per s
  eventLength: 0.06, // s: an event's decay, × 0.6–1.6
  doubles: 0.5, // share of the events that squish again 30–60 ms later
  floor: 0.1, // wetness between the events, as an event's share: the flesh never goes still
  bubbles: 130, // pops per s at an event's peak
  bubblePitch: 1540, // Hz: the pops' middle pitch
  bubbleSpread: 0.31, // octaves: the spread of their pitches, a normal in octaves
  bubbleRise: 0.1, // ξ: how fast a pop's pitch rises as it dies away (van den Doel)
  bubbleDamping: 0.22, // × the pops' physical damping: below 1 they ring longer
  bubbleAmplitude: 1,
  crackle: 670, // clicks per s at an event's peak
  crackleBase: 9, // stray clicks per s between events
  crackleLow: 2350, // Hz: the pitch range the clicks ring at
  crackleHigh: 20000,
  crackleAmplitude: 4,
  crackleDecay: 0.001, // s a click rings for, × 0.25–1.5: shorter is a broader tick
  hiss: 0.13, // wet noise under the clicks during an event, 2–10 kHz
  body: 0.1, // wet low noise under the events: the mass sloshing
  bodyFrequency: 175, // Hz: its lowpass
  thump: 0.68, // the flesh's low swell under each event
  thumpFrequency: 35, // Hz
  rumble: 0.055, // the low rumble all along
  rumbleFrequency: 24, // Hz: its lowpass
  loudness: -25.8, // dB, K-weighted (ITU-R BS.1770, ungated): as loud as that recording
}

class SquishAudio {
  isSquishAudio = true
  type = 'SquishAudio'
  volume = 1 // 1 plays the texture as loud as it is, at `activity` 1 within `distance`
  synth = { ...SQUISH_SYNTH_DEFAULTS } // synthesizeSquish's settings
  density = 16 // grains/s whenever it plays, evenly spaced (± half a gap), overlapping into one continuous squish
  grainLength = 0.4 // s, faded in and out over a third each, so the grains crossfade
  grainSpread = 0.5 // ± share of grainLength a grain's length varies by
  pitch = 1 // × the playback rate
  pitchSpread = 0.3 // ± octaves a grain's pitch varies by
  reverse = 0.35 // share of the grains played backwards
  tone = 7000 // Hz: the brightest grain's lowpass; each takes a quarter of it up to all
  smoothing = 0.4 // s the level eases toward `activity` over
  distance = 0.5 // m from the source within which it plays at full volume
  rolloff = 1 // how fast it fades past `distance`: × distance / (distance + rolloff · (d − distance)), 1 is 1/d
  room = 0.1 // the room's reverb, × the source at `distance`, steady wherever the source is
  roomTime = 1 // s the reverb takes to fall 60 dB: glazed tiles ring
  muffle = 0 // 0–1: from open to heard through the worms, inside the body
  muffleTone = 500 // Hz: the lowpass fully muffled
  slaps = 4 // wet slaps after a burst: the thrown worms meeting a wall
  slapPan = 0.6 // −1 left to 1 right: where they slap, ± 0.3
  activity = 0 // 0–1: how much the worms squish now
  #audio
  #texture = null // once synthesized: { buffer, reversed, squelches ([onset s, weight]) }
  #synthesized = null // a copy of the settings it was synthesized with
  #synthAt = -Infinity // context s it was
  #preparedTexture = null // prepare()'s, until the first synthesis: { sampleRate, synth, data, reversed, events }
  #preparedRoom = null // prepare()'s, until the room's first impulse: { sampleRate, time, channels }
  #context = null
  #input = null // the grains, at `volume` → muffle lowpass → panner → output → limiter
  #muffler = null
  #panner = null
  #room = null // the reverb: a convolver, fed from the muffler by #roomSend
  #roomSend = null
  #roomTime = 0 // s the room's impulse was made for
  #output = null
  #level = 0 // `activity` eased
  #next = 0 // context s the next grain starts at
  #targets = null // what the graph's settings were last given: { volume, room, cutoff, refDistance, rolloff }

  constructor(audio, options = {}) {
    this.#audio = audio
    for (const key of Object.keys(options)) {
      if (!SQUISH_OPTIONS.includes(key)) console.warn(`SquishAudio: unknown option "${key}".`)
      else if (key === 'synth') Object.assign(this.synth, options.synth)
      else this[key] = options[key]
    }
  }

  /**
   * Synthesizes the texture and the room's impulse ahead, with `synth` and `roomTime` as they are, for a context
   * running at `sampleRate` Hz (48000 on most devices), so the first squish doesn't wait on them: call it while the
   * page loads, before the first squish. At another rate, or with those settings changed since, they are synthesized
   * at first use instead. The samples (about 2 MB at 48 kHz) are held until the first squish, so skip it when none
   * will play.
   * @param {number} sampleRate
   */
  prepare(sampleRate) {
    if (!(globalThis.AudioContext ?? globalThis.webkitAudioContext) || this.#texture) return this
    const { data, events } = synthesizeSquish(sampleRate, this.synth)
    const synth = { ...this.synth }
    this.#preparedTexture = { sampleRate, synth, data, reversed: data.slice().reverse(), events }
    const time = THREE.MathUtils.clamp(this.roomTime, 0.1, 4)
    const channels = [0, 1].map(() => roomImpulse(new Float32Array(roomLength(sampleRate, time)), sampleRate, time))
    this.#preparedRoom = { sampleRate, time, channels }
    return this
  }

  /** The level the grains play at now, 0–1: `activity` eased over `smoothing`. */
  get level() {
    return this.#level
  }

  /** Whether the texture is synthesized, ready to play. */
  get loaded() {
    return this.#texture !== null
  }

  // The graph, once the shared context runs, and the texture, synthesized again when its settings change.
  #ready() {
    const context = this.#audio.context
    if (!context || context.state !== 'running') return null
    if (this.#context !== context) {
      this.#context = context
      // a limiter: the hardest squelches reach full scale
      const limiter = context.createDynamicsCompressor()
      limiter.threshold.value = -3
      limiter.knee.value = 0
      limiter.ratio.value = 20
      limiter.attack.value = 0.001
      limiter.release.value = 0.1
      limiter.connect(context.destination)
      this.#output = context.createGain()
      this.#output.connect(limiter)
      this.#panner = context.createPanner()
      this.#panner.panningModel = 'HRTF'
      this.#panner.distanceModel = 'inverse'
      this.#panner.rolloffFactor = 1
      this.#muffler = context.createBiquadFilter()
      this.#muffler.type = 'lowpass'
      this.#muffler.frequency.value = 20000
      this.#input = context.createGain()
      this.#input.connect(this.#muffler).connect(this.#panner).connect(this.#output)
      this.#room = context.createConvolver()
      this.#room.normalize = false
      this.#room.connect(this.#output)
      this.#roomSend = context.createGain()
      this.#muffler.connect(this.#roomSend).connect(this.#room)
      this.#roomTime = 0
      this.#texture = null
      this.#synthesized = null
      this.#targets = { volume: Number.NaN, room: Number.NaN, cutoff: Number.NaN, refDistance: Number.NaN, rolloff: Number.NaN }
      this.#next = context.currentTime
    }
    this.#synthesize(context)
    const roomTime = THREE.MathUtils.clamp(this.roomTime, 0.1, 4)
    if (roomTime !== this.#roomTime) {
      this.#roomTime = roomTime
      this.#room.buffer = this.#roomImpulse(context, roomTime)
    }
    return context
  }

  // The room's impulse for `time` s, two channels apart: prepared, or synthesized now.
  #roomImpulse(context, time) {
    const sr = context.sampleRate
    const impulse = context.createBuffer(2, roomLength(sr, time), sr)
    const prepared = this.#preparedRoom
    this.#preparedRoom = null
    const ahead = prepared?.sampleRate === sr && prepared.time === time
    for (let channel = 0; channel < 2; channel++) {
      if (ahead) impulse.copyToChannel(prepared.channels[channel], channel)
      else roomImpulse(impulse.getChannelData(channel), sr, time)
    }
    return impulse
  }

  #synthesize(context) {
    if (sameSettings(this.#synthesized, this.synth) || context.currentTime - this.#synthAt < RESYNTHESIZE_EVERY) return
    this.#synthesized = { ...this.synth }
    this.#synthAt = context.currentTime
    const sr = context.sampleRate
    const prepared = this.#preparedTexture
    this.#preparedTexture = null
    const ahead = prepared?.sampleRate === sr && sameSettings(prepared.synth, this.synth)
    const { data, events } = ahead ? prepared : synthesizeSquish(sr, this.synth)
    const strongest = events.slice(0, SQUELCHES)
    const most = strongest[0]?.[1] ?? 1
    // one channel, forward and backward
    const buffer = context.createBuffer(1, data.length, sr)
    buffer.copyToChannel(data, 0)
    const reversed = context.createBuffer(1, data.length, sr)
    reversed.copyToChannel(ahead ? prepared.reversed : data.slice().reverse(), 0)
    const squelches = strongest.map(([at, strength]) => [Math.max(at - 0.005, 0), strength / most])
    this.#texture = { buffer, reversed, squelches }
  }

  /**
   * Eases the level toward `activity`, places the sound at `position` (where the worms are nearest, as the distance
   * fades it) heard from `listener` (an Object3D, the camera, its matrixWorld current) and schedules the grains due in
   * the next LOOKAHEAD s. Call it every frame.
   */
  update(delta, position, listener) {
    const context = this.#ready()
    if (!context) return
    const target = THREE.MathUtils.clamp(this.activity, 0, 1)
    this.#level += (target - this.#level) * (this.smoothing > 0 ? 1 - Math.exp(-delta / this.smoothing) : 1)
    const now = context.currentTime
    const end = now + Math.max(delta, 1 / 60)
    // each setting scheduled as it changes
    const targets = this.#targets
    targets.volume = easeTo(this.#input.gain, this.volume, targets.volume, now, 0.02)
    const refDistance = Math.max(this.distance, 1e-3)
    if (refDistance !== targets.refDistance) this.#panner.refDistance = targets.refDistance = refDistance
    const rolloff = Math.max(this.rolloff, 0)
    if (rolloff !== targets.rolloff) this.#panner.rolloffFactor = targets.rolloff = rolloff
    targets.room = easeTo(this.#roomSend.gain, Math.max(this.room, 0), targets.room, now, 0.05)
    const open = context.sampleRate / 2
    const cutoff = open * (Math.max(this.muffleTone, 20) / open) ** THREE.MathUtils.clamp(this.muffle, 0, 1)
    targets.cutoff = easeTo(this.#muffler.frequency, cutoff, targets.cutoff, now, 0.05)
    this.#place(context, position, listener, end)

    if (this.#next < now) this.#next = now
    if (!this.#texture || this.#level < SILENT || this.density <= 0) return
    // the grains overlapping at once, about: their sum is as loud as one
    const overlap = Math.sqrt(Math.max(this.density * this.grainLength, 1))
    for (; this.#next < now + LOOKAHEAD; this.#next += (0.5 + Math.random()) / this.density) {
      const length = this.grainLength * (1 + this.grainSpread * (2 * Math.random() - 1))
      const speed = this.pitch * 2 ** (this.pitchSpread * (2 * Math.random() - 1))
      const gain = (this.#level * (0.8 + 0.4 * Math.random())) / overlap
      this.#grain(context, this.#next, { length, speed, gain, attack: length / 3 })
    }
  }

  // The listener at the camera, the panner at the body, ramped to them by `end`. Close in, the sound comes from all
  // round, so its direction eases toward the view's.
  #place(context, position, listener, end) {
    _squishPosition.setFromMatrixPosition(listener.matrixWorld)
    const e = listener.matrixWorld.elements
    _forward.set(-e[8], -e[9], -e[10]).normalize()
    _squishUp.set(e[4], e[5], e[6]).normalize()
    const l = context.listener
    if (l.positionX) {
      l.positionX.linearRampToValueAtTime(_squishPosition.x, end)
      l.positionY.linearRampToValueAtTime(_squishPosition.y, end)
      l.positionZ.linearRampToValueAtTime(_squishPosition.z, end)
      l.forwardX.linearRampToValueAtTime(_forward.x, end)
      l.forwardY.linearRampToValueAtTime(_forward.y, end)
      l.forwardZ.linearRampToValueAtTime(_forward.z, end)
      l.upX.linearRampToValueAtTime(_squishUp.x, end)
      l.upY.linearRampToValueAtTime(_squishUp.y, end)
      l.upZ.linearRampToValueAtTime(_squishUp.z, end)
    } else {
      l.setPosition(_squishPosition.x, _squishPosition.y, _squishPosition.z)
      l.setOrientation(_forward.x, _forward.y, _forward.z, _squishUp.x, _squishUp.y, _squishUp.z)
    }
    _toSource.subVectors(position, _squishPosition)
    const distance = _toSource.length()
    const around = THREE.MathUtils.smoothstep(distance, 0.1, 0.6)
    _toSource.divideScalar(Math.max(distance, 1e-6))
    _toSource.lerp(_forward, 1 - around).normalize()
    _toSource.multiplyScalar(distance).add(_squishPosition)
    const p = this.#panner
    if (p.positionX) {
      p.positionX.linearRampToValueAtTime(_toSource.x, end)
      p.positionY.linearRampToValueAtTime(_toSource.y, end)
      p.positionZ.linearRampToValueAtTime(_toSource.z, end)
    } else {
      p.setPosition(_toSource.x, _toSource.y, _toSource.z)
    }
  }

  // A grain of the texture from `offset` s (random if not given), `length` s long at the `speed` playback rate,
  // backwards for `backwards`, faded in over `attack` s and out over its last third, into `output` (the grains' input).
  #grain(context, at, options) {
    const { length, speed, gain, offset, backwards = Math.random() < this.reverse, attack, output } = options
    const buffer = backwards ? this.#texture.reversed : this.#texture.buffer
    const span = length * speed // s of the texture it plays
    let from = offset ?? Math.random() * Math.max(buffer.duration - span, 0)
    // the same stretch, read from the reversed buffer
    if (backwards) from = buffer.duration - from - span
    from = THREE.MathUtils.clamp(from, 0, Math.max(buffer.duration - span, 0))
    const source = context.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = speed
    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = Math.min(this.tone * 2 ** (-2 * Math.random()), context.sampleRate / 2)
    const envelope = this.#envelope(context, at, length, gain, attack)
    source
      .connect(filter)
      .connect(envelope)
      .connect(output ?? this.#input)
    source.start(at, from, span)
  }

  // A gain rising from 0 over `attack`, holding, and falling to 0 over the last third of `length` s.
  #envelope(context, at, length, gain, attack) {
    const envelope = context.createGain()
    const release = Math.max(length / 3, 0.005)
    envelope.gain.setValueAtTime(0, at)
    envelope.gain.linearRampToValueAtTime(gain, at + attack)
    envelope.gain.setValueAtTime(gain, Math.max(at + length - release, at + attack))
    envelope.gain.linearRampToValueAtTime(0, at + length)
    return envelope
  }

  /**
   * The bat's hit: two of the hardest squelches together, low and heavy, then `slaps` short wet slaps of the thrown
   * worms meeting the wall round `slapPan`. `amplitude` 0 to 1 and more scales them.
   */
  burst(amplitude = 1) {
    const context = this.#ready()
    if (!context || !this.#texture) return
    const { squelches } = this.#texture
    const at = context.currentTime
    const a = Math.max(amplitude, 0)
    const picked = []
    // past the grains' volume, still muffled and placed at the body
    const output = this.#muffler
    for (const [delay, gain, speed, length] of [
      [0, 1.3, 0.75 + Math.random() * 0.1, 0.3],
      [0.01 + Math.random() * 0.02, 0.9, 0.85 + Math.random() * 0.15, 0.25],
    ]) {
      const offset = this.#pickSquelch(squelches, picked)
      this.#grain(context, at + delay, {
        length,
        speed,
        gain: gain * a,
        offset,
        backwards: false,
        attack: 0.002,
        output,
      })
    }
    for (let i = 0; i < this.slaps; i++) {
      const pan = context.createStereoPanner()
      pan.pan.value = THREE.MathUtils.clamp(this.slapPan + 0.6 * (Math.random() - 0.5), -1, 1)
      pan.connect(this.#output)
      const offset = Math.random() < 0.6 ? this.#pickSquelch(squelches) : undefined
      this.#grain(context, at + 0.12 + Math.random() * 0.45, {
        length: 0.07 + Math.random() * 0.07,
        speed: 1 + Math.random() * 0.35,
        gain: (0.3 + Math.random() * 0.4) * a,
        offset,
        backwards: false,
        attack: 0.002,
        output: pan,
      })
    }
  }

  // A squelch's onset, s, drawn from `squelches` ([onset, weight]) by weight, none of `taken` again (and added to it).
  #pickSquelch(squelches, taken = []) {
    const left = squelches.filter(([at]) => !taken.includes(at))
    let pick = Math.random() * left.reduce((sum, [, weight]) => sum + weight, 0)
    for (const [at, weight] of left) {
      if ((pick -= weight) <= 0) {
        taken.push(at)
        return at
      }
    }
    return left.at(-1)[0]
  }

  dispose() {
    this.#output?.disconnect()
    this.#context = this.#input = this.#muffler = this.#panner = this.#room = this.#roomSend = this.#output = null
    this.#texture = this.#preparedTexture = this.#preparedRoom = null
  }
}

/**
 * Squishing flesh, synthesized: squish events at random (`events` per s, strengths heavy-tailed, some doubled), each a
 * low swell of the flesh moving, then a burst of bubbles popping (damped sines whose pitch rises as they die, van den
 * Doel's model) and a wet crackle (clicks ringing at random high pitches) over a hiss; between them a low rumble and
 * stray clicks. Returns the samples, at `loudness`, and the events' onsets (s) and strengths, strongest first.
 */
function synthesizeSquish(sampleRate, options = {}) {
  const o = { ...SQUISH_SYNTH_DEFAULTS, ...options }
  // mulberry32
  let state = o.seed >>> 0
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const between = (a, b) => a + (b - a) * random()
  const logBetween = (a, b) => a * (b / a) ** random()
  const normal = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random())
  const sr = sampleRate
  const n = Math.round(o.seconds * sr)
  const out = new Float32Array(n)
  const envelope = new Float32Array(n).fill(o.floor) // the floor and the events: how wet the flesh is at each sample

  // the events, their envelopes and their thumps
  const events = []
  const gap = () => -Math.log(1 - random()) / o.events // s to the next event: a Poisson process
  for (let t = 0.03 + 0.5 * gap(); t < o.seconds - 0.1; t += gap()) {
    const strength = 0.15 + 0.85 * random() ** 1.5
    const hits = [[t, strength]]
    if (random() < o.doubles) hits.push([t + between(0.03, 0.06), strength * between(0.4, 0.9)])
    for (const [at, s] of hits) {
      events.push([at, s])
      const attack = between(0.005, 0.02)
      const decay = o.eventLength * between(0.6, 1.6)
      const from = Math.round(at * sr)
      const to = Math.min(n, from + Math.round((attack + 6 * decay) * sr))
      for (let i = from; i < to; i++) {
        const u = (i - from) / sr
        envelope[i] += s * (u < attack ? (u / attack) ** 2 : Math.exp(-(u - attack) / decay))
      }
    }
    // the flesh shoved: a low swell a little ahead of the burst, gliding down
    const f = o.thumpFrequency * between(0.75, 1.35)
    const rise = between(0.015, 0.035)
    const fall = between(0.04, 0.11)
    const from = Math.max(0, Math.round((t - between(0, 0.025)) * sr))
    const to = Math.min(n, from + Math.round((rise + 5 * fall) * sr))
    let phase = random() * Math.PI * 2
    for (let i = from; i < to; i++) {
      const u = (i - from) / sr
      const gain = u < rise ? 0.5 - 0.5 * Math.cos((Math.PI * u) / rise) : Math.exp(-(u - rise) / fall)
      phase += (2 * Math.PI * f * (1 - 0.3 * Math.min(u / (rise + 3 * fall), 1))) / sr
      out[i] += o.thump * strength * gain * Math.sin(phase)
    }
  }

  // pops and clicks, by their rates over each millisecond
  const block = Math.round(sr / 1000)
  for (let b = 0; b < n; b += block) {
    const e = envelope[b]
    for (const [rate, pop] of [
      [o.bubbles * e, true],
      [o.crackleBase + o.crackle * e, false],
    ]) {
      let count = rate / 1000
      for (; count > 0; count--) {
        if (count < 1 && random() >= count) break
        const at = b + Math.floor(random() * block)
        const loud = Math.min(random() ** -0.6, 6) // heavy-tailed
        if (pop) {
          // a bubble: f(t) = f0 (1 + ξ d t), damped at d = 0.13 f0 + 0.0072 f0^1.5 (van den Doel)
          const f0 = Math.min(o.bubblePitch * 2 ** (o.bubbleSpread * normal()), sr / 3)
          const d = (0.13 * f0 + 0.0072 * f0 ** 1.5) * o.bubbleDamping * between(0.6, 1.6)
          const amplitude = 0.05 * o.bubbleAmplitude * loud * (0.3 + e) * (f0 / 1000) ** -0.7
          const length = Math.min(n - at, Math.round((7 / d) * sr))
          let phase = 0
          for (let i = 0; i < length; i++) {
            const u = i / sr
            phase += (2 * Math.PI * f0 * (1 + o.bubbleRise * d * u)) / sr
            out[at + i] += amplitude * Math.exp(-d * u) * Math.sin(phase)
          }
        } else {
          // a click: a short ring at a high pitch
          const f = Math.min(logBetween(o.crackleLow, o.crackleHigh), 0.45 * sr)
          const decay = o.crackleDecay * between(0.25, 1.5)
          const amplitude = 0.04 * o.crackleAmplitude * loud * (0.2 + e)
          const length = Math.min(n - at, Math.round(6 * decay * sr))
          const phase = random() * Math.PI * 2
          for (let i = 0; i < length; i++) {
            const u = i / sr
            out[at + i] += amplitude * Math.exp(-u / decay) * Math.sin(phase + 2 * Math.PI * f * u)
          }
        }
      }
    }
  }

  // under the events the hiss (white noise through a 2–10 kHz band) and the body (noise under bodyFrequency); all
  // along the rumble (noise under rumbleFrequency). Two-pole lowpasses, each gain making up its band's loss.
  const band = biquadBandpass(sr, 4500, 0.6)
  const bodyPole = Math.exp((-2 * Math.PI * o.bodyFrequency) / sr)
  const rumblePole = Math.exp((-2 * Math.PI * o.rumbleFrequency) / sr)
  const bodyGain = Math.sqrt(sr / (4 * o.bodyFrequency))
  const rumbleGain = Math.sqrt(sr / (4 * o.rumbleFrequency))
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  let b1 = 0
  let b2 = 0
  let r1 = 0
  let r2 = 0
  for (let i = 0; i < n; i++) {
    const white = random() * 2 - 1
    const y = band.b0 * white + band.b1 * x1 + band.b2 * x2 - band.a1 * y1 - band.a2 * y2
    x2 = x1
    x1 = white
    y2 = y1
    y1 = y
    b1 = b1 * bodyPole + (1 - bodyPole) * (random() * 2 - 1)
    b2 = b2 * bodyPole + (1 - bodyPole) * b1
    r1 = r1 * rumblePole + (1 - rumblePole) * (random() * 2 - 1)
    r2 = r2 * rumblePole + (1 - rumblePole) * r1
    const e = envelope[i]
    out[i] += o.hiss * e ** 0.8 * y + o.body * bodyGain * e * b2 + o.rumble * rumbleGain * r2
  }

  const gain = 10 ** ((o.loudness - kWeightedLoudness(out, sr)) / 20)
  for (let i = 0; i < n; i++) out[i] *= Number.isFinite(gain) ? gain : 0
  events.sort((a, b) => b[1] - a[1])
  return { data: out, events }
}

// dB of `data`'s mean square, K-weighted as ITU-R BS.1770 does (a high shelf of +4 dB over 1.7 kHz, a highpass at
// 38 Hz), ungated: how loud it sounds.
function kWeightedLoudness(data, sampleRate) {
  let K = Math.tan((Math.PI * 1681.97) / sampleRate)
  const Vh = 10 ** (4 / 20)
  const Vb = Vh ** 0.4997
  let Q = 0.7072
  let a0 = 1 + K / Q + K * K
  const shelf = [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0]
  const shelfPoles = [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0]
  K = Math.tan((Math.PI * 38.135) / sampleRate)
  Q = 0.5003
  a0 = 1 + K / Q + K * K
  const highPoles = [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0]
  let [x1, x2, y1, y2, z1, z2] = [0, 0, 0, 0, 0, 0]
  let sum = 0
  for (let i = 0; i < data.length; i++) {
    const y = shelf[0] * data[i] + shelf[1] * x1 + shelf[2] * x2 - shelfPoles[0] * y1 - shelfPoles[1] * y2
    x2 = x1
    x1 = data[i]
    const z = y - 2 * y1 + y2 - highPoles[0] * z1 - highPoles[1] * z2
    y2 = y1
    y1 = y
    z2 = z1
    z1 = z
    sum += z * z
  }
  return -0.691 + 10 * Math.log10(sum / Math.max(data.length, 1))
}

// RBJ's bandpass (0 dB peak) coefficients, normalized.
function biquadBandpass(sampleRate, frequency, q) {
  const w = (2 * Math.PI * frequency) / sampleRate
  const alpha = Math.sin(w) / (2 * q)
  const a0 = 1 + alpha
  return { b0: alpha / a0, b1: 0, b2: -alpha / a0, a1: (-2 * Math.cos(w)) / a0, a2: (1 - alpha) / a0 }
}

// ─── Blood writing ───────────────────────────────────────────────────────────

// Words written on a wall in blood with a finger: a slanted scrawl whose letters lean, stray off the line and vary in
// size, smeared streaky and thin at the edges, running down in drips that end in beads, with spatter round it and four
// fingers dragged down beside it. Drawn once on a 2D canvas into `texture`: thickness in red, the thin dried film round
// the blood in green, coverage in alpha, v up. Restroom.setBlood() shades the wall tiles with it. Without a 2D canvas
// the texture stays empty.
//
//   const writing = new BloodWriting('No exit here', { width: 1.3, height: 1, angle: 14 })
//   await writing.ready // the font loaded and the words drawn
//   restroom.setBlood(writing.texture, { center, normal, along, width: writing.width, height: writing.height })
//   writing.draw('No exit here', { angle: 20 }) // again, after a change to the words or the drawing's options

const WRITING_OPTIONS = [
  'font',
  'width',
  'height',
  'resolution',
  'angle',
  'lean',
  'jitter',
  'drips',
  'dripLength',
  'spatter',
  'smear',
  'marks',
  'lines',
  'seed',
]
const FONT_TIMEOUT = 4000 // ms a web font may take before the words are drawn in the fallback
const BLUR_RADIUS = 5 // px of the box blur the thickness is taken from, twice
const FILM_RADIUS = 0.02 // m of the box blur the dried film round the blood is taken from, twice
const FIT = 0.86 // most of the drawing's width the words and the finger marks take
const FIT_HEIGHT = 0.6 // most of its height the words take, the drips below them
const LETTER_GAP = 0.09 // × the font size between one letter's ink and the next
const WORD_GAP = 0.38 // × the font size a space takes
const LINE_HEIGHT = 1.15 // × the font size from one line's baseline to the next

// A seeded generator, uniform in [0, 1).
function random(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Smooth 1D value noise, 0–1, from a table of `rand`.
function noise1(rand) {
  const table = Float32Array.from({ length: 256 }, rand)
  return (x) => {
    const i = Math.floor(x)
    const f = x - i
    const a = table[i & 255]
    const b = table[(i + 1) & 255]
    return a + (b - a) * f * f * (3 - 2 * f)
  }
}

// In place, a separable box blur of radius r over a w × h field.
function boxBlur(field, w, h, r) {
  const line = new Float32Array(Math.max(w, h))
  const pass = (count, length, at) => {
    for (let j = 0; j < count; j++) {
      let sum = 0
      for (let i = -r; i <= r; i++) sum += field[at(j, THREE.MathUtils.clamp(i, 0, length - 1))]
      for (let i = 0; i < length; i++) {
        line[i] = sum / (2 * r + 1)
        sum += field[at(j, Math.min(i + r + 1, length - 1))] - field[at(j, Math.max(i - r, 0))]
      }
      for (let i = 0; i < length; i++) field[at(j, i)] = line[i]
    }
  }
  pass(h, w, (y, x) => y * w + x)
  pass(w, h, (x, y) => y * w + x)
}

// `text` in lines: at its line breaks if it has any, else its words in `count` lines, broken where the longest line
// is shortest.
function splitLines(text, count) {
  if (text.includes('\n')) return text.split('\n').map((line) => line.trim())
  const words = text.trim().split(/\s+/)
  const best = (from, left) => {
    if (left <= 1 || from >= words.length - 1) {
      const line = words.slice(from).join(' ')
      return { lines: [line], longest: line.length }
    }
    let found = null
    for (let to = from + 1; to < words.length; to++) {
      const line = words.slice(from, to).join(' ')
      const rest = best(to, left - 1)
      const longest = Math.max(line.length, rest.longest)
      if (!found || longest < found.longest) found = { lines: [line, ...rest.lines], longest }
    }
    return found
  }
  return best(0, Math.max(Math.round(count), 1)).lines
}

// Each line's letters at `context`'s font of `size` px: where their ink starts and how wide it is, from its bounds
// (a brush font's ink overhangs its advance), a space as a word gap; and each line's length.
function measureLines(context, lines, size) {
  return lines.map((line) => {
    const letters = [...line].map((letter) => {
      if (letter.trim() === '') return { letter, left: 0, ink: size * WORD_GAP, space: true }
      const metrics = context.measureText(letter)
      const left = metrics.actualBoundingBoxLeft ?? 0
      const right = metrics.actualBoundingBoxRight ?? metrics.width
      return { letter, left, ink: Math.max(left + right, size * 0.1), space: false }
    })
    const gaps = letters.filter((l, i) => i > 0 && !l.space && !letters[i - 1].space).length
    const length = letters.reduce((sum, l) => sum + l.ink, 0) + gaps * size * LETTER_GAP
    return { letters, length }
  })
}

class BloodWriting {
  isBloodWriting = true
  type = 'BloodWriting'
  /** Resolves once the first drawing is done. */
  ready
  /** The drawing: thickness in red, the dried film round the blood in green, coverage in alpha; rows bottom up. */
  texture = null
  /** The words drawn. */
  text = ''
  font = 'Permanent Marker' // a web font the page loads, else the canvas's fallback
  width = 0.95 // m of wall the drawing covers
  height = 0.9 // m
  resolution = 800 // px per m
  angle = 14 // deg the line rises to the right
  lean = 18 // deg the letters lean forward
  jitter = 1 // how far the letters stray off the line, in size and turn
  drips = 1 // × the drips running down from the letters
  dripLength = 0.35 // m: the longest
  spatter = 1 // × the drops flicked round it
  smear = 1 // how streaky and broken the finger left the strokes
  marks = true // four fingers dragged down beside the words
  lines = 2 // the words broken into this many lines, between words, as even as they go; a \n breaks one too
  seed = 7
  #canvas = null

  /** @param {object} [options] - Any of the settings above. */
  constructor(text, options = {}) {
    this.ready = this.draw(text, options)
  }

  /**
   * Draws `text` again with these options (the rest as they are), once the font is in. The texture is replaced when
   * its size changes.
   */
  async draw(text, options = {}) {
    for (const key of Object.keys(options)) {
      if (!WRITING_OPTIONS.includes(key)) console.warn(`BloodWriting: unknown option "${key}" ignored.`)
      else this[key] = options[key]
    }
    this.text = text
    const w = Math.max(Math.round(this.width * this.resolution), 1)
    const h = Math.max(Math.round(this.height * this.resolution), 1)
    if (this.texture?.image.width !== w || this.texture?.image.height !== h) {
      this.texture?.dispose()
      this.texture = new THREE.DataTexture(new Uint8Array(4 * w * h), w, h)
      this.texture.name = 'blood writing'
      this.texture.colorSpace = THREE.NoColorSpace
      this.texture.magFilter = THREE.LinearFilter
      this.texture.minFilter = THREE.LinearMipmapLinearFilter
      this.texture.generateMipmaps = true
      this.texture.anisotropy = 8
      this.texture.needsUpdate = true
    }
    if (typeof document === 'undefined') return
    const canvas = (this.#canvas ??= document.createElement('canvas'))
    canvas.width = w
    canvas.height = h
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return
    const fontOf = (size) => `${size}px "${this.font}", "Marker Felt", cursive`
    if (document.fonts?.load) {
      const timeout = new Promise((resolve) => setTimeout(resolve, FONT_TIMEOUT))
      await Promise.race([document.fonts.load(fontOf(100), text).catch(() => {}), timeout])
    }
    // as large as a third of the height allows: the slanted lines and the finger marks within FIT of the width, the
    // lines within FIT_HEIGHT of the height
    const lines = splitLines(text, this.lines)
    const largest = h / 3
    context.font = fontOf(largest)
    const widest = Math.max(...measureLines(context, lines, largest).map((line) => line.length))
    const tall = lines.length * LINE_HEIGHT * largest
    const angle = THREE.MathUtils.degToRad(this.angle)
    const cos = Math.abs(Math.cos(angle))
    const sin = Math.abs(Math.sin(angle))
    const spanX = widest * cos + tall * sin + (this.marks ? 1.1 * largest : 0)
    const spanY = widest * sin + tall * cos
    const fit = Math.min(1, (FIT * w) / Math.max(spanX, 1), (FIT_HEIGHT * h) / Math.max(spanY, 1))
    const size = Math.max(Math.round(largest * fit), 1)
    this.#paint(context, w, h, size, fontOf(size), lines)
    this.texture.needsUpdate = true
  }

  // The words, their drips, spatter and finger marks into the canvas; then its thickness (red) and coverage (alpha)
  // from what was painted, streaked and broken at the thin edges.
  #paint(context, w, h, size, font, lines) {
    const rand = random(this.seed)
    const jitter = Math.max(this.jitter, 0)
    context.clearRect(0, 0, w, h)
    context.fillStyle = context.strokeStyle = '#fff'
    context.lineCap = context.lineJoin = 'round'
    context.font = font
    context.textBaseline = 'alphabetic'

    // the lines along a rising slant, one under the other, each a little off the others as a hand writes them; each
    // letter leaning, turned, sized and set off the line about its own ink's middle, so it keeps clear of the next
    const angle = THREE.MathUtils.degToRad(this.angle)
    const lean = Math.tan(THREE.MathUtils.degToRad(this.lean))
    const measured = measureLines(context, lines, size)
    const widest = Math.max(...measured.map((line) => line.length))
    const lineHeight = size * LINE_HEIGHT
    const centreX = w / 2 - (this.marks ? size * 0.55 : 0)
    const centreY = h * 0.36
    // a point of the lines' frame (x along them, y down) in the canvas
    const toCanvas = (x, y) => [
      centreX + x * Math.cos(angle) + y * Math.sin(angle),
      centreY - x * Math.sin(angle) + y * Math.cos(angle),
    ]
    const starts = []
    let count = 0
    context.save()
    context.translate(centreX, centreY)
    context.rotate(-angle)
    measured.forEach(({ letters, length }, k) => {
      const baseline = (k - (measured.length - 1) / 2) * lineHeight + size * 0.35
      let along = -length / 2 + (rand() - 0.5) * size * 0.3 * jitter
      starts.push({ along, length, baseline })
      letters.forEach(({ letter, left, ink, space }, i) => {
        if (space) {
          along += ink
          return
        }
        if (i > 0 && !letters[i - 1].space) along += size * LETTER_GAP
        count++
        const grow = 1 + (rand() - 0.5) * 0.24 * jitter
        const drop = (rand() - 0.5) * size * 0.14 * jitter + Math.sin(count * 0.9) * size * 0.04 * jitter
        context.save()
        context.translate(along + ink / 2, baseline + drop)
        context.rotate((rand() - 0.5) * 0.12 * jitter)
        context.transform(1, 0, -lean, 1, 0, 0)
        context.scale(grow, grow)
        context.lineWidth = size * 0.035
        // a finger goes over a stroke more than once: the letter again a little off, thinner
        for (let pass = 0; pass < 3; pass++) {
          const dx = (rand() - 0.5) * size * 0.04
          const dy = (rand() - 0.5) * size * 0.03
          context.globalAlpha = pass === 0 ? 1 : 0.85
          context.fillText(letter, left - ink / 2 + dx, dy)
          if (pass === 0) context.strokeText(letter, left - ink / 2 + dx, dy)
        }
        context.restore()
        along += ink
      })
    })
    context.restore()
    context.globalAlpha = 1

    // four fingers dragged down and away past the first line's end
    if (this.marks) {
      const first = starts[0]
      const [endX, endY] = toCanvas(first.along + first.length + size * 0.45, first.baseline - size * 0.55)
      const reach = h * 0.42
      for (let finger = 0; finger < 4; finger++) {
        const x0 = endX + finger * size * 0.17 + (rand() - 0.5) * size * 0.05
        const y0 = endY + Math.abs(finger - 1.5) * size * 0.08
        const length = reach * (0.7 + 0.3 * rand())
        const steps = 40
        for (let s = 0; s < steps; s++) {
          const t0 = s / steps
          const t1 = (s + 1) / steps
          const wobble = (t) => Math.sin(t * 7 + finger * 1.3) * size * 0.025
          context.lineWidth = size * 0.07 * (1 - 0.75 * t0) * (0.8 + 0.4 * rand())
          context.globalAlpha = 1 - 0.5 * t0
          context.beginPath()
          context.moveTo(x0 + t0 * length * 0.18 + wobble(t0), y0 + t0 * length)
          context.lineTo(x0 + t1 * length * 0.18 + wobble(t1), y0 + t1 * length)
          context.stroke()
        }
      }
      context.globalAlpha = 1
    }

    // drips down from the letters' undersides: straight down the wall, thinning, a bead at the end
    let image = context.getImageData(0, 0, w, h)
    const alpha = (x, y) => image.data[4 * (y * w + x) + 3]
    const edges = []
    for (let y = 1; y < h - 4; y += 2) {
      for (let x = 0; x < w; x += 2) {
        if (alpha(x, y) > 200 && alpha(x, y + 3) < 30) edges.push([x, y])
      }
    }
    const dripCount = Math.round(count * 2.2 * Math.max(this.drips, 0))
    const longest = Math.max(this.dripLength, 0) * this.resolution
    for (let d = 0; d < dripCount && edges.length > 0; d++) {
      const [x0, y0] = edges.splice(Math.floor(rand() * edges.length), 1)[0]
      const width = size * (0.018 + 0.03 * rand())
      const length = Math.min(longest * (0.08 + 0.92 * rand() ** 2), h - y0 - width * 2)
      if (length < width) continue
      let x = x0
      for (let y = y0; y < y0 + length; y += 2) {
        const t = (y - y0) / length
        x += (rand() - 0.5) * 0.6
        context.beginPath()
        context.arc(x, y, (width / 2) * (1 - 0.45 * t), 0, Math.PI * 2)
        context.fill()
      }
      context.beginPath()
      context.ellipse(x, y0 + length, width * 0.55, width * 0.7, 0, 0, Math.PI * 2)
      context.fill()
    }

    // spatter: drops and flicks round the words
    const dropCount = Math.round(count * 9 * Math.max(this.spatter, 0))
    for (let d = 0; d < dropCount; d++) {
      const [x, y] = toCanvas(
        (rand() - 0.5) * (widest + size * 1.5),
        (rand() - 0.5) * (measured.length * lineHeight + size * 1.4),
      )
      const radius = size * 0.004 + size * 0.022 * rand() ** 3
      const turn = rand() * Math.PI * 2
      context.beginPath()
      context.ellipse(x, y, radius * (1 + 2 * rand() ** 4), radius, turn, 0, Math.PI * 2)
      context.fill()
    }

    // coverage and thickness: the painted coverage blurred, streaked along the line and thinner to the edges, where
    // the streaks break it up; the film, the coverage blurred wide
    image = context.getImageData(0, 0, w, h)
    const coverage = new Float32Array(w * h)
    for (let i = 0; i < w * h; i++) coverage[i] = image.data[4 * i + 3] / 255
    const thickness = Float32Array.from(coverage)
    boxBlur(thickness, w, h, BLUR_RADIUS)
    boxBlur(thickness, w, h, BLUR_RADIUS)
    const film = Float32Array.from(coverage)
    const filmRadius = Math.max(Math.round(FILM_RADIUS * this.resolution), 1)
    boxBlur(film, w, h, filmRadius)
    boxBlur(film, w, h, filmRadius)
    const streak = noise1(rand)
    const drift = noise1(rand)
    const smear = THREE.MathUtils.clamp(this.smear, 0, 2)
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const data = this.texture.image.data
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        const o = 4 * ((h - 1 - y) * w + x)
        const c = coverage[i]
        data[o + 1] = Math.round(255 * Math.min(film[i] * 3, 1))
        if (c <= 0) {
          data[o] = data[o + 2] = data[o + 3] = 0
          continue
        }
        // across and along the line
        const across = x * sin + y * cos
        const alongLine = x * cos - y * sin
        const s = streak(across * 0.22 + drift(alongLine * 0.006) * 6)
        const t = Math.min(thickness[i] * 1.6, 1) * (1 - 0.45 * smear * (1 - s))
        const kept = c * THREE.MathUtils.smoothstep(t, 0.06 * smear, 0.06 * smear + 0.08)
        data[o] = Math.round(255 * t)
        data[o + 2] = 0
        data[o + 3] = Math.round(255 * kept)
      }
    }
  }

  dispose() {
    this.texture?.dispose()
  }
}

// ─── Touch controls ──────────────────────────────────────────────────────────

// Touch controls dressed like the end screen: a stick low on the left that a drag starting in a square around it
// drives (tank controls: up walks, down backs off, left and right turn; its base stays put) and a Hit button on the
// right, in IM Fell English SC lettering over clotted reds, the button's glow beating like a heart. A touch anywhere
// else passes through to the page. Pointer events, so a mouse drives them too when they are shown on a desktop.
//
//   const touch = new TouchControls({ reach: 2 })
//   document.body.append(touch.element)
//   touch.visible = matchMedia('(pointer: coarse)').matches
//   // every frame, before controls.update():
//   controls.moveInput.set(0, touch.stick.y)
//   controls.turn(-touch.stick.x * turnSpeed * delta)
//   if (touch.held) bat.swing()
//   touch.element.addEventListener('pointerdown', () => audio.unlock()) // a gesture the browser starts audio from


const TOUCH_OPTIONS = ['deadZone', 'curve', 'travel', 'reach', 'label']
const STYLE_ID = 'worm-monster-touch-style'
const STYLE = `
.sw-touch {
  position: fixed; inset: 0; z-index: 5; pointer-events: none;
  font-family: 'IM Fell English SC', Georgia, serif;
  user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent;
  transition: opacity 0.4s;
}
.sw-touch[hidden] { display: block; opacity: 0; }
.sw-touch[hidden] * { pointer-events: none !important; }
.sw-touch-still .sw-touch-hit, .sw-touch-still .sw-touch-label { animation-play-state: paused; }
.sw-touch-zone {
  --sw-touch-base: 144px;
  position: absolute; transform: translate(-50%, -50%);
  left: calc(120px + env(safe-area-inset-left)); top: calc(100% - 130px - env(safe-area-inset-bottom));
  width: calc(var(--sw-touch-base) * var(--sw-touch-reach, 2));
  height: calc(var(--sw-touch-base) * var(--sw-touch-reach, 2));
  pointer-events: auto; touch-action: none;
}
.sw-touch-base {
  position: absolute; left: 50%; top: 50%; border-radius: 50%;
  width: var(--sw-touch-base); height: var(--sw-touch-base); margin: calc(var(--sw-touch-base) / -2);
  background: radial-gradient(circle, rgba(34, 2, 5, 0.22) 0%, rgba(10, 0, 1, 0.55) 62%, rgba(0, 0, 0, 0.72) 100%);
  border: 1px solid rgba(163, 22, 26, 0.5);
  box-shadow: 0 0 26px rgba(110, 0, 6, 0.45), inset 0 0 30px rgba(0, 0, 0, 0.92);
  opacity: 0.42; transition: opacity 0.25s;
}
.sw-touch-base.active { opacity: 0.95; }
.sw-touch-ring {
  position: absolute; inset: 15px; border-radius: 50%;
  border: 1px dashed rgba(200, 40, 40, 0.3);
}
.sw-touch-mark {
  position: absolute; color: rgba(214, 70, 64, 0.5); font-size: 10px; line-height: 10px;
  text-shadow: 0 0 6px rgba(150, 0, 8, 0.9);
}
.sw-touch-knob {
  position: absolute; left: 50%; top: 50%; width: 60px; height: 60px; margin: -30px 0 0 -30px; border-radius: 50%;
  background: radial-gradient(circle at 38% 32%, #74121a 0%, #3c0509 46%, #120102 100%);
  border: 1px solid rgba(255, 96, 90, 0.32);
  box-shadow: 0 0 16px rgba(163, 22, 26, 0.7), inset 0 -5px 10px rgba(0, 0, 0, 0.8),
    inset 0 2px 4px rgba(255, 130, 120, 0.16);
}
.sw-touch-label {
  position: absolute; left: 50%; top: calc(100% + 10px); transform: translateX(-50%);
  color: rgba(222, 182, 160, 0.6); font-size: 13px; letter-spacing: 0.32em; white-space: nowrap;
  text-shadow: 0 0 6px #000, 0 0 14px rgba(140, 0, 8, 0.85);
  animation: sw-flicker 7s steps(1) infinite;
}
.sw-touch-hit {
  position: absolute; width: 116px; height: 116px; border-radius: 50%; padding: 0;
  right: calc(30px + env(safe-area-inset-right)); bottom: calc(40px + env(safe-area-inset-bottom));
  pointer-events: auto; touch-action: none; cursor: pointer; outline: none;
  font: inherit; font-size: 24px; letter-spacing: 0.1em; color: #ecd2bd;
  text-shadow: 0 0 8px #000, 0 0 16px rgba(255, 40, 40, 0.55);
  background: radial-gradient(circle at 40% 34%, #7e0e14 0%, #45060a 50%, #170103 100%);
  border: 2px solid rgba(190, 30, 36, 0.78);
  box-shadow: 0 0 20px rgba(150, 0, 8, 0.5), inset 0 0 20px rgba(0, 0, 0, 0.85);
  animation: sw-heartbeat 1.7s ease-in-out infinite;
  transition: transform 0.06s;
}
.sw-touch-hit::before {
  content: ''; position: absolute; inset: -10px; border-radius: 50%;
  border: 1px solid rgba(163, 22, 26, 0.38); border-left-color: transparent; transform: rotate(-24deg);
}
.sw-touch-hit::after {
  content: ''; position: absolute; left: 61%; bottom: -15px; width: 7px; height: 20px;
  background: linear-gradient(#6a0a10, #2b0306); border-radius: 30% 30% 50% 50% / 20% 20% 75% 75%;
  box-shadow: 0 0 6px rgba(120, 0, 6, 0.7);
}
.sw-touch-hit.pressed {
  transform: scale(0.9); animation: none;
  background: radial-gradient(circle at 40% 34%, #b8151d 0%, #60070c 55%, #1e0204 100%);
  box-shadow: 0 0 44px rgba(225, 20, 32, 0.9), inset 0 0 24px rgba(0, 0, 0, 0.7);
}
@keyframes sw-heartbeat {
  0%, 36%, 100% { box-shadow: 0 0 18px rgba(140, 0, 8, 0.42), inset 0 0 20px rgba(0, 0, 0, 0.85); }
  9% { box-shadow: 0 0 34px rgba(200, 0, 14, 0.8), inset 0 0 16px rgba(0, 0, 0, 0.8); }
  18% { box-shadow: 0 0 22px rgba(150, 0, 8, 0.5), inset 0 0 20px rgba(0, 0, 0, 0.85); }
  26% { box-shadow: 0 0 30px rgba(190, 0, 12, 0.72), inset 0 0 17px rgba(0, 0, 0, 0.8); }
}
@keyframes sw-flicker {
  0%, 41%, 44%, 100% { opacity: 1; }
  42% { opacity: 0.35; }
  43% { opacity: 0.85; }
  86% { opacity: 0.55; }
  87% { opacity: 1; }
}
`

// A stick low on the left and a Hit button on the right, as one fixed overlay: `element`.
class TouchControls {
  isTouchControls = true
  type = 'TouchControls'
  /** The stick: x right, y up (forward), −1 to 1, after the dead zone and the curve. */
  stick = new THREE.Vector2()
  /** Share of the travel the stick ignores at its centre. */
  deadZone = 0.12
  /** Exponent of the response past the dead zone: above 1, finer near the centre. */
  curve = 1.4
  /** px the knob travels from the centre. */
  travel = 56
  /** The overlay: append it to the page. */
  element = document.createElement('div')
  #zone = document.createElement('div')
  #base = document.createElement('div')
  #knob = document.createElement('div')
  #hit = document.createElement('button')
  #pointer = null // the stick's pointer id
  #button = null // the Hit button's pointer id
  #origin = new THREE.Vector2()
  #reach = 2

  /**
   * @param {object} [options]
   * @param {number} [options.deadZone]
   * @param {number} [options.curve]
   * @param {number} [options.travel]
   * @param {number} [options.reach]
   * @param {string} [options.label='Hit'] - The button's word.
   */
  constructor(options = {}) {
    for (const key of Object.keys(options)) {
      if (!TOUCH_OPTIONS.includes(key)) console.warn(`TouchControls: unknown option "${key}".`)
      else if (key !== 'label') this[key] = options[key]
    }
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = STYLE
      document.head.append(style)
    }
    this.element.className = 'sw-touch'
    this.#zone.className = 'sw-touch-zone'
    this.#base.className = 'sw-touch-base'
    this.#knob.className = 'sw-touch-knob'
    const ring = document.createElement('div')
    ring.className = 'sw-touch-ring'
    const marks = [
      ['▲', 'left:50%;top:5px;transform:translateX(-50%)'],
      ['▼', 'left:50%;bottom:5px;transform:translateX(-50%)'],
      ['◀', 'left:6px;top:50%;transform:translateY(-50%)'],
      ['▶', 'right:6px;top:50%;transform:translateY(-50%)'],
    ].map(([glyph, place]) => {
      const mark = document.createElement('span')
      mark.className = 'sw-touch-mark'
      mark.textContent = glyph
      mark.style.cssText = place
      return mark
    })
    const label = document.createElement('span')
    label.className = 'sw-touch-label'
    label.textContent = 'Walk'
    this.#base.append(ring, ...marks, this.#knob, label)
    this.#zone.append(this.#base)
    this.#hit.className = 'sw-touch-hit'
    this.#hit.type = 'button'
    this.#hit.textContent = options.label ?? 'Hit'
    this.element.append(this.#zone, this.#hit)

    this.#zone.addEventListener('pointerdown', this.#onStickDown)
    this.#zone.addEventListener('pointermove', this.#onStickMove)
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.#zone.addEventListener(type, this.#onStickUp)
      this.#hit.addEventListener(type, this.#onHitUp)
    }
    this.#hit.addEventListener('pointerdown', this.#onHitDown)
    this.element.addEventListener('transitionend', this.#onFaded)
    // no long-press menu or selection under a thumb
    this.element.addEventListener('contextmenu', (event) => event.preventDefault())
  }

  /** Whether the overlay shows and takes input. Hidden, the stick and the button let go. */
  get visible() {
    return !this.element.hidden
  }

  set visible(value) {
    if (value === this.visible) return
    this.element.hidden = !value
    if (value) this.element.classList.remove('sw-touch-still')
    else {
      this.#release()
      this.#letGo()
      // hidden before its first style, or already transparent: no fade runs, so no transitionend comes to pause it
      const fading = this.element.getAnimations().some((animation) => animation.transitionProperty === 'opacity')
      if (!fading) this.element.classList.add('sw-touch-still')
    }
  }

  /** Side of the square centred on the stick that a touch starts it in, × the base's diameter; at least 1. */
  get reach() {
    return this.#reach
  }

  set reach(value) {
    if (value === this.#reach) return
    this.#reach = value
    this.#zone.style.setProperty('--sw-touch-reach', String(Math.max(value, 1)))
  }

  /** Whether the Hit button is held down. */
  get held() {
    return this.#button !== null
  }

  dispose() {
    this.element.remove()
  }

  // Faded out: the heartbeat and the flicker pause until shown, since unseen they would still repaint every frame.
  #onFaded = (event) => {
    if (event.target === this.element && event.propertyName === 'opacity' && this.element.hidden) {
      this.element.classList.add('sw-touch-still')
    }
  }

  #onStickDown = (event) => {
    if (this.#pointer !== null || (event.pointerType === 'mouse' && event.button !== 0)) return
    event.preventDefault()
    this.#pointer = event.pointerId
    this.#zone.setPointerCapture?.(event.pointerId)
    // the base stays put: a thumb on it drives the knob from its centre, one elsewhere from where it landed
    const box = this.#base.getBoundingClientRect()
    const x = box.left + box.width / 2
    const y = box.top + box.height / 2
    const onBase = Math.hypot(event.clientX - x, event.clientY - y) <= box.width / 2
    this.#origin.set(onBase ? x : event.clientX, onBase ? y : event.clientY)
    this.#base.classList.add('active')
    this.#onStickMove(event)
  }

  #onStickMove = (event) => {
    if (event.pointerId !== this.#pointer) return
    const travel = Math.max(this.travel, 1)
    let dx = event.clientX - this.#origin.x
    let dy = event.clientY - this.#origin.y
    const length = Math.hypot(dx, dy)
    if (length > travel) {
      dx *= travel / length
      dy *= travel / length
    }
    this.#knob.style.transform = `translate(${dx}px, ${dy}px)`
    // radial dead zone, then the curve, keeping the direction
    const reach = Math.min(length / travel, 1)
    const dead = THREE.MathUtils.clamp(this.deadZone, 0, 0.95)
    const amount = reach <= dead ? 0 : ((reach - dead) / (1 - dead)) ** Math.max(this.curve, 0.1)
    if (amount === 0) this.stick.set(0, 0)
    else this.stick.set(dx, -dy).normalize().multiplyScalar(amount)
  }

  #onStickUp = (event) => {
    if (event.pointerId === this.#pointer) this.#release()
  }

  #release() {
    if (this.#pointer !== null && this.#zone.hasPointerCapture?.(this.#pointer)) {
      this.#zone.releasePointerCapture(this.#pointer)
    }
    this.#pointer = null
    this.stick.set(0, 0)
    this.#base.classList.remove('active')
    this.#knob.style.transform = ''
  }

  #onHitDown = (event) => {
    if (this.#button !== null || (event.pointerType === 'mouse' && event.button !== 0)) return
    // no emulated mouse events, focus or double-tap zoom after it
    event.preventDefault()
    this.#button = event.pointerId
    this.#hit.setPointerCapture?.(event.pointerId)
    this.#hit.classList.add('pressed')
  }

  #onHitUp = (event) => {
    if (event.pointerId === this.#button) this.#letGo()
  }

  #letGo() {
    if (this.#button !== null && this.#hit.hasPointerCapture?.(this.#button)) {
      this.#hit.releasePointerCapture(this.#button)
    }
    this.#button = null
    this.#hit.classList.remove('pressed')
  }
}

// ─── Frame time governor ─────────────────────────────────────────────────────

/**
 * Steps an app between quality levels from its frame times: down when frames run long and the GPU or the CPU is
 * busy, up when frames have headroom for a while. It knows levels and milliseconds; what a level means is the app's.
 *
 *   const governor = new FrameTimeGovernor(3, { level: 2, maxLevel: 2 })
 *   governor.addEventListener('change', ({ level, previous, reason }) => applyTier(TIERS[level]))
 *   renderer.setAnimationLoop((time) => {
 *     // …the frame…
 *     governor.update(renderer, time) // last, after the frame's submits
 *   })
 *   governor.reset() // after a pause, a rebuild, a level the app set itself or a hidden tab
 *
 * Inputs, per update(): the interval between `time`s (setAnimationLoop's timestamp, ms); the CPU time,
 * `performance.now() − time` at the call; and every `sampleEvery` frames, the latency of
 * `device.queue.onSubmittedWorkDone()` called right after the frame's submits, over the interval: a GPU-busy share
 * that needs no timestamp queries. Without a WebGPU device the busy share is unknown and frame intervals decide alone:
 * on a vsynced display whose refresh interval is at or over target × upFactor it then only steps down.
 *
 * Every `windowTime` ms of accepted frames closes a window: its median interval (`frameTime`) and CPU time.
 *   Down: frameTime > target × downFactor for `downWindows` windows in a row, and gpuBusy ≥ busyShare or
 *     cpuTime ≥ busyShare × frameTime. A slow frame with an idle GPU and CPU is a display cap, not an overload.
 *   Up: the frame's work, max(cpuTime, gpuBusy × frameTime) (no device: frameTime), < target × upFactor for
 *     `upWindows` windows, and `upWait` ms since the last change. (On a vsynced display the interval never drops
 *     under the refresh interval, so the work, not the interval, shows the headroom.)
 *   After a change, `settleTime` ms are ignored (the change compiles pipelines). A down within `flipFlopTime` of an
 *   up is a flip-flop: the up wait doubles, up to `maxUpWait`; after `maxFlipFlops` the governor locks: it still
 *   steps down, and steps up at most once every `probeInterval` (thermal recovery).
 *   Ignored: the first `startDelay` ms; intervals over `maxInterval`. A gap over `gapTime` restarts the windows.
 *
 * The refresh interval is the 10th percentile of the intervals over the first `refreshTime` ms, snapped to a common
 * rate (30, 50, 60, 72, 75, 90, 100, 120, 144, 165 or 240 Hz). When it matches one and the GPU and CPU were idle
 * meanwhile, target = max(targetFrameTime, refreshInterval), so a 30 Hz cap (iOS Low Power Mode, Energy Saver) never
 * reads as an overload; an app already overloaded at start keeps targetFrameTime.
 *
 * Events: 'change' { level, previous, direction ('down' | 'up'), reason, time, frameTime, cpuTime, gpuBusy }.
 *
 * Options and properties (ms unless noted):
 *   levels - the number of levels, 0 lowest (positional).
 *   level - the current level; default the top. The app may set it, then reset().
 *   minLevel, maxLevel - the range it steps in; default 0 and the top.
 *   targetFrameTime - the frame time to hold; default 1000 / 60.
 *   downFactor, upFactor - × target: the overload and headroom bounds.
 *   windowTime, downWindows, upWindows - the window length, and the windows in a row a step needs.
 *   busyShare - 0–1: the GPU or CPU share of the interval that counts as busy.
 *   settleTime, startDelay, upWait, maxUpWait, flipFlopTime, maxFlipFlops, probeInterval - see above.
 *   sampleEvery - frames between GPU-busy samples.
 *   maxInterval, gapTime, refreshTime - see above.
 *   allowUp - false: only ever steps down.
 *
 * Readouts: frameTime, cpuTime, gpuBusy (0–1, null until sampled), refreshInterval (null until measured), target,
 * locked, flipFlops, lastReason.
 */

const GOVERNOR_OPTIONS = [
  'level',
  'minLevel',
  'maxLevel',
  'targetFrameTime',
  'downFactor',
  'upFactor',
  'windowTime',
  'downWindows',
  'upWindows',
  'busyShare',
  'settleTime',
  'startDelay',
  'upWait',
  'maxUpWait',
  'flipFlopTime',
  'maxFlipFlops',
  'probeInterval',
  'sampleEvery',
  'maxInterval',
  'gapTime',
  'refreshTime',
  'allowUp',
]

// Hz a display or a power-saving cap commonly runs at
const REFRESH_RATES = [30, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240]
const SNAP_TOLERANCE = 0.1
const REFRESH_MIN_FRAMES = 5

const medianInPlace = (values) => {
  values.sort((a, b) => a - b)
  const middle = values.length >> 1
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2
}
const toDigits = (value, digits = 1) => Number(value.toFixed(digits))

class FrameTimeGovernor extends THREE.EventDispatcher {
  isFrameTimeGovernor = true
  type = 'FrameTimeGovernor'

  levels
  level
  minLevel = 0
  maxLevel
  targetFrameTime = 1000 / 60
  downFactor = 1.25
  upFactor = 0.7
  windowTime = 1000
  downWindows = 2
  upWindows = 5
  busyShare = 0.6
  settleTime = 2000
  startDelay = 3000
  upWait = 5000
  maxUpWait = 60000
  flipFlopTime = 10000
  maxFlipFlops = 3
  probeInterval = 60000
  sampleEvery = 30
  maxInterval = 250
  gapTime = 1000
  refreshTime = 2000
  allowUp = true

  /** ms, the last window's median interval. */
  frameTime = 0
  /** ms, the last window's median CPU time. */
  cpuTime = 0
  /** 0–1, the last GPU-busy sample; null until one resolves after a start, reset or change. */
  gpuBusy = null
  /** ms, the display's refresh interval; null until measured. */
  refreshInterval = null
  locked = false
  flipFlops = 0
  lastReason = ''

  #lastTime = null
  #holdUntil = 0
  #lastChange = 0
  #lastUp = null
  #lastProbe = 0
  #wait = 0
  #frames = 0
  #slow = 0
  #good = 0
  #intervals = []
  #cpus = []
  #span = 0
  #generation = 0
  #sampling = false
  #canSample = false
  #refresh = null // { start, intervals, cpuShares, busy } while measuring
  #refreshTrusted = false

  /**
   * @param {number} levels
   * @param {object} [options]
   */
  constructor(levels, options = {}) {
    super()
    if (!Number.isInteger(levels) || levels < 1) throw new Error('FrameTimeGovernor: levels must be an integer ≥ 1.')
    this.levels = levels
    this.maxLevel = levels - 1
    for (const key of Object.keys(options)) {
      if (!GOVERNOR_OPTIONS.includes(key)) console.warn(`FrameTimeGovernor: unknown option "${key}".`)
      else if (options[key] !== undefined) this[key] = options[key]
    }
    this.minLevel = Math.max(0, this.minLevel)
    this.maxLevel = Math.min(levels - 1, this.maxLevel)
    this.level = Math.min(this.maxLevel, Math.max(this.minLevel, this.level ?? this.maxLevel))
    this.#wait = this.upWait
  }

  /** ms, the frame time held: targetFrameTime, or a slower display's refresh interval. */
  get target() {
    return this.#refreshTrusted ? Math.max(this.targetFrameTime, this.refreshInterval) : this.targetFrameTime
  }

  /**
   * Call once a frame, last in the animation loop, with setAnimationLoop's `time`.
   * @param {Renderer} renderer
   * @param {number} time - ms
   */
  update(renderer, time) {
    const cpu = Math.max(0, performance.now() - time)
    if (this.#lastTime === null) {
      this.#start(time)
      return
    }
    const interval = time - this.#lastTime
    this.#lastTime = time
    if (!(interval > 0)) return
    this.#frames++

    if (interval > this.gapTime) {
      this.#clearWindows()
      return
    }
    if (interval > this.maxInterval) return

    const device = renderer?.backend?.isWebGPUBackend ? renderer.backend.device : null
    this.#canSample = typeof device?.queue?.onSubmittedWorkDone === 'function'
    // every frame while the refresh is measured, for the busy evidence
    const every = this.#refresh !== null ? 1 : this.sampleEvery
    if (this.#canSample && !this.#sampling && this.#frames % every === 0) this.#sample(device, interval)
    if (this.#refresh !== null) this.#measureRefresh(time, interval, cpu)
    if (time - interval < this.#holdUntil) return

    this.#intervals.push(interval)
    this.#cpus.push(cpu)
    this.#span += interval
    if (this.#span >= this.windowTime) this.#closeWindow(time)
  }

  /** Restarts the windows and the start delay; the refresh interval and the flip-flop history stay. */
  reset() {
    this.#lastTime = null
    this.#clearWindows()
    this.#forgetBusy()
  }

  #start(time) {
    this.#lastTime = time
    this.#holdUntil = time + this.startDelay
    this.#lastChange = time
    if (this.refreshInterval === null && this.#refresh === null) {
      this.#refresh = { start: time, intervals: [], cpuShares: [], busy: 0, samples: 0 }
    }
  }

  #sample(device, interval) {
    this.#sampling = true
    const generation = this.#generation
    const start = performance.now()
    device.queue.onSubmittedWorkDone().then(
      () => {
        if (generation !== this.#generation) return
        this.#sampling = false
        this.gpuBusy = Math.min(1, (performance.now() - start) / interval)
        const refresh = this.#refresh
        if (refresh !== null) {
          refresh.busy = Math.max(refresh.busy, this.gpuBusy)
          refresh.samples++
        }
      },
      () => {
        if (generation === this.#generation) this.#sampling = false
      },
    )
  }

  #measureRefresh(time, interval, cpu) {
    const refresh = this.#refresh
    refresh.intervals.push(interval)
    refresh.cpuShares.push(cpu / interval)
    if (time - refresh.start < this.refreshTime || refresh.intervals.length < REFRESH_MIN_FRAMES) return
    const sorted = refresh.intervals.sort((a, b) => a - b)
    const p10 = sorted[Math.floor(sorted.length * 0.1)]
    let snapped = null
    let best = SNAP_TOLERANCE
    for (const rate of REFRESH_RATES) {
      const period = 1000 / rate
      const error = Math.abs(period - p10) / period
      if (error <= best) {
        best = error
        snapped = period
      }
    }
    // a cap shows as a common rate with the GPU and CPU idle; anything else is load
    const busy = refresh.busy >= this.busyShare || medianInPlace(refresh.cpuShares) >= this.busyShare
    const evidence = refresh.samples > 0 || !this.#canSample
    this.refreshInterval = snapped ?? p10
    this.#refreshTrusted = snapped !== null && !busy && evidence
    this.#refresh = null
  }

  #closeWindow(time) {
    const frameTime = medianInPlace(this.#intervals)
    const cpuTime = medianInPlace(this.#cpus)
    this.#intervals.length = 0
    this.#cpus.length = 0
    this.#span = 0
    this.frameTime = frameTime
    this.cpuTime = cpuTime

    const target = this.target
    const gpuBusy = this.gpuBusy
    const busyKnown = gpuBusy !== null
    // unknown while a device exists but no sample has resolved yet
    const work = busyKnown ? Math.max(cpuTime, gpuBusy * frameTime) : this.#canSample ? null : frameTime

    this.#slow = frameTime > target * this.downFactor ? this.#slow + 1 : 0
    this.#good = work !== null && work < target * this.upFactor ? this.#good + 1 : 0

    if (this.#slow >= this.downWindows && this.level > this.minLevel) {
      const cpuBound = cpuTime >= this.busyShare * frameTime
      const gpuBound = busyKnown ? gpuBusy >= this.busyShare : !this.#canSample
      if (cpuBound || gpuBound) {
        let why = `CPU ${toDigits(cpuTime)} ms`
        if (gpuBound) why = busyKnown ? `GPU busy ${toDigits(gpuBusy, 2)}` : 'GPU busy unknown'
        const bound = toDigits(target * this.downFactor)
        this.#change(this.level - 1, 'down', `${toDigits(frameTime)} ms frames > ${bound} ms, ${why}`, time)
      }
      return
    }

    if (
      this.allowUp &&
      this.#good >= this.upWindows &&
      this.level < this.maxLevel &&
      time - this.#lastChange >= this.#wait &&
      (!this.locked || time - this.#lastProbe >= this.probeInterval)
    ) {
      if (this.locked) this.#lastProbe = time
      const why = `${toDigits(work)} ms of work < ${toDigits(target * this.upFactor)} ms for ${this.#good} windows`
      this.#change(this.level + 1, 'up', this.locked ? `${why} (probe)` : why, time)
    }
  }

  #change(level, direction, reason, time) {
    const previous = this.level
    if (direction === 'down' && this.#lastUp !== null && time - this.#lastUp < this.flipFlopTime) {
      this.flipFlops++
      this.#wait = Math.min(this.maxUpWait, this.#wait * 2)
      if (this.flipFlops >= this.maxFlipFlops && !this.locked) {
        this.locked = true
        this.#lastProbe = time
      }
    }
    if (direction === 'up') this.#lastUp = time
    const { frameTime, cpuTime, gpuBusy } = this
    this.level = level
    this.lastReason = reason
    this.#lastChange = time
    this.#holdUntil = time + this.settleTime
    this.#clearWindows()
    this.#forgetBusy()
    this.dispatchEvent({ type: 'change', level, previous, direction, reason, time, frameTime, cpuTime, gpuBusy })
  }

  #clearWindows() {
    this.#intervals.length = 0
    this.#cpus.length = 0
    this.#span = 0
    this.#slow = 0
    this.#good = 0
  }

  #forgetBusy() {
    this.gpuBusy = null
    this.#generation++
    this.#sampling = false
  }
}

// ─── Params ──────────────────────────────────────────────────────────────────

const params = {
  debug: false,
  paused: false,
  tool: 'Bat',
  showHelper: false,
  showField: false,
  showHomes: false,
  // Quality: a tier (TIERS) for the device, Auto from GPUTierDetector at load
  tier: 'Auto', // Auto, Low, Medium, High
  // On, Auto steps the tier down while frames run long, and back up to the one found at load (FrameTimeGovernor). Off
  // under automation (navigator.webdriver), whose frames may be a profile's or pinned to its clock, unless the URL sets
  // it.
  monitorPerformance: false,
  governorTarget: 60, // fps it holds
  // View: the player's eye, starting down the aisle with the figure's start ahead of it
  fov: 55,
  exposure: 1.1,
  cameraX: 0.3, // m: where the player starts
  cameraY: 1.5, // m: eye height, at the figure's shoulders: there its worms bury the eye, at the neck they part
  cameraZ: 4.4, // m: toward the entrance; the figure starts at approachStart
  lookYaw: 4, // deg about y the player starts facing, 0 down the aisle (−z), left above 0
  lookPitch: -6, // deg the player starts looking, up above 0
  maxPixelRatio: 2, // the output's pixels per CSS pixel at most: TAAU resolves the scene at min(devicePixelRatio, this)
  // Walk (WASD): WalkControls on the aisle floor, the eye at cameraY
  playerWalk: true,
  playerSpeed: 1.4, // m/s
  playerRun: 1.8, // × playerSpeed with Shift
  playerSlow: 0.4, // × playerSpeed with Alt
  playerCrouchHeight: 0.95, // m: eye height with C held
  playerCrouchSpeed: 0.5, // × playerSpeed crouched
  playerJumpSpeed: 3.2, // m/s up a jump (Space) leaves the floor at: about half a metre
  playerGravity: 9.81, // m/s² down in a jump
  playerDamping: 0.12, // s: speeds up and slows down over about this long
  playerMargin: 0.25, // m kept from the walls, the fixtures and the doors
  playerRoam: true, // the whole room, into the stalls and round the entrance; off, the aisle alone
  pointerLock: true, // a click locks the pointer and the mouse looks, Esc releases it; off, a drag looks
  lookSpeed: 0.003, // rad the view turns per pixel the mouse moves
  // Touch Controls: a stick low on the left (tank: up walks, down backs off, left and right turn), Hit on the right;
  // a drag elsewhere looks
  touchControls: 'Auto', // Auto: on a touch screen
  touchTurnSpeed: 110, // deg/s at full left or right
  touchRunAt: 0.92, // share of the stick's reach past which the walk runs
  touchDeadZone: 0.12, // share of the stick's travel it ignores at the centre
  touchTravel: 56, // px the knob travels
  touchReach: 2, // side of the square centred on the stick that a touch starts it in, × the base's diameter
  touchVibrate: true, // a buzz on each hit, where the browser can
  // Handheld: CameraShake's sway on top of the look
  handheld: true,
  handheldAmplitude: 0.004, // rad
  handheldFrequency: 0.7, // Hz
  // Game Over: once the body's field reaches the eye
  gameOver: true,
  engulfDepth: 0, // m of field distance at the eye that counts as swallowed
  gameOverDelay: 0.6, // s
  gameOverFade: 1.5, // s
  gameOverHintDelay: 2, // s before "Click to replay" shows; earlier clicks don't replay
  gameOverHintFade: 1, // s
  gameOverSound: true,
  gameOverDarkness: 0.85,
  gameOverText: "Get worm'd",
  gameOverColor: '#a3161a',
  // Loading Screen: covers the page from the start until the worms have spawned, then waits for Start; read at load
  loadingScreen: true,
  loadingFrames: 3, // frames the worms draw under it first, so what compiles at its first draw does so out of sight
  loadingFade: 0.1, // s it fades out over
  // the title and a Start button once loaded, the world still till it's clicked: the click starts the sound and locks
  // the pointer. Skipped under automation (navigator.webdriver), which nobody clicks for.
  loadingStart: true,
  loadingDarkness: 0.8, // share of the scene it hides while it waits for Start
  loadingTipTime: 8, // s a tip shows before the next, while it loads
  loadingFullscreen: true, // Start on a touch screen goes fullscreen, out of the browser's bars
  // In Your Face: the view darkens a little once all it sees is worms
  faceDark: true,
  faceDarkEV: 2,
  faceDarkFrom: 0.65, // share of the view covered where it begins
  faceDarkTime: 0.35, // s
  faceReach: 1.2, // m from the eye a worm counts as in the face
  faceSkin: 0.08, // m outside the body's field the worms lie
  // Bat: a click swings it; the worms where it meets the body fly off to the right
  bat: true,
  batWindup: 0.1, // s
  batSwing: 0.15, // s
  batFollow: 0.15, // s
  batRecover: 0.35, // s
  batSwingPower: 2.3, // ease-in exponent: higher whips harder
  batCooldown: 0.08, // s
  batHitReach: 0.15, // m of field distance from the barrel that counts as a hit
  batRestX: 0, // m: the hands at rest, in camera space
  batRestY: -0.38,
  batRestZ: -0.42,
  batRestElevation: 40, // deg: the bat above the view's horizon,
  batRestAzimuth: -70, // right of straight ahead,
  batRestRoll: 0, // and about its own axis
  // Bat → Narrow Rest Pose: a narrow view, like a portrait phone's, crops the rest pose at its left edge, so the bat
  // rests upright and in toward the middle there: this pose at batNarrowAspect and below, blending to the one above by
  // batWideAspect (the view's width / height)
  batNarrowAspect: 0.6,
  batWideAspect: 1.3,
  batNarrowX: 0.03,
  batNarrowY: -0.36,
  batNarrowZ: -0.48,
  batNarrowElevation: 49,
  batNarrowAzimuth: -34,
  batNarrowRoll: 0,
  // Bat → Collision: while it swings, the bat is a capsule in the worms' colliders, shoving aside those in its way
  batCollide: true,
  batColliderRadius: 0.035, // m added to the barrel's radius: a fast swing moves up to 9 cm a substep
  batColliderLength: 0.45, // m of the bat, down from its tip, that collides, hits and strikes: up the taper
  // the struck worms keep strictCollisions' speed bound; off, while the hit plays at the usual substeps they fly free
  // of it, up to strikeSpeed, and may pass through each other: at few substeps the bound holds them to a crawl
  strictHits: true,
  strikeRadius: 0.5, // m round the bat's striking part at the contact whose worms fly
  strikeSpeed: 20, // m/s at the bat
  hitSubsteps: 12, // the worms' substeps while the hit's slow motion keeps a frame within numSubsteps of them: the
  // solver bounds the speed at ≈ 1.7 m/s a substep, so the struck worms fly past the usual maxSpeed, at no extra cost
  strikeLocality: 0.5, // 0: a worm flies as one; 1: each particle by its own distance, the near end yanked ahead
  strikeSpread: 0.35, // how far each worm's flight turns off the hit's, at random
  strikeTumble: 0.6, // ± share of the speed one end gets over the other: they tumble
  strikeRight: 1.5, // the flight: × the view's right,
  strikeForward: 0.3, // forward,
  strikeUp: 0.3, // up,
  strikeSwing: 0.5, // and the barrel's way
  plow: true, // after the hit, the bat keeps striking as it sweeps through the body
  plowRadius: 0.25, // m
  hitStop: 0.07, // s
  hitSlowMo: 0.3, // the time scale right after, easing back to 1
  hitSlowMoTime: 0.35, // s
  hitShake: 0.75, // camera trauma, 0–1
  kickAmplitude: 0.05, // rad at trauma 1
  kickFrequency: 18, // Hz
  kickDecay: 5, // 1/s
  hitFov: 5, // deg
  hitFovTime: 0.25, // s
  hitFlash: 0.3,
  hitFlashColor: '#ffe2e6',
  hitFlashTime: 0.1, // s
  knockback: 0.35, // m
  staggerTime: 0.5, // s
  flinchAngle: 28, // deg
  flinchFrequency: 2.2, // Hz
  flinchDamping: 5, // 1/s
  // Regroup: after a hit the figure stands until its worms are back on it
  regroup: true,
  regroupShare: 0.9, // share of the knocked-off worms held again
  regroupTimeout: 5, // s; 0 waits for ever
  regroupMinTime: 2, // s after the last hit before it may walk with regroupEnough held
  regroupEnough: 0.8, // share of the worms held before the first hit
  regroupGatherTime: 2.5, // s the gather takes, feet to head
  regroupCatchRadius: 1.5, // m
  regroupEase: 0.4, // s it slows to rest and speeds up again over
  sprayCount: 45,
  spraySpeed: 5, // m/s
  spraySpread: 0.7,
  sprayColor: '#5a1626',
  sprayLife: 60, // s
  sprayIrregularity: 1,
  spraySpikes: 1,
  sprayTail: 1,
  sound: true,
  soundVolume: 0.8,
  // Squish Sound: the worms rubbing over each other, growing as more are held on the body
  squish: true,
  squishVolume: 0.8,
  squishLow: 0.3, // its level once the first worms touch
  squishFrom: 0.1, // share of the body's worms held where it starts growing,
  squishTo: 0.9, // and where it's full
  squishIdle: 0.6, // × the level while the figure stands
  squishDensity: 16, // grains/s
  squishGrain: 0.4, // s
  squishGrainSpread: 0.5,
  squishPitch: 1,
  squishPitchSpread: 0.3, // ± octaves
  squishReverse: 0.35, // share of the grains played backwards
  squishTone: 7000, // Hz
  squishSmoothing: 0.4, // s
  squishDistance: 0.5, // m within which it plays at full volume
  squishRolloff: 1,
  squishRoom: 0.1, // reverb level
  squishRoomTime: 1, // s
  squishHeight: 0.5, // × figureHeight the sound comes from
  squishMuffleTone: 500, // Hz once the eye is in the worms
  squishMuffleDepth: 0.15, // m
  squishHit: 1, // × the burst of squelches at a hit; 0 keeps the synthesized hit
  squishSlaps: 4,
  squishSlapPan: 0.6, // −1 left to 1 right
  // Squish Sound → Synth: the texture the grains are drawn from
  squishSynthSeconds: 4, // s
  squishSynthSeed: 1,
  squishSynthEvents: 6, // per s
  squishSynthEventLength: 0.06, // s
  squishSynthDoubles: 0.5,
  squishSynthFloor: 0.1,
  squishSynthBubbles: 130, // per s
  squishSynthBubblePitch: 1540, // Hz
  squishSynthBubbleSpread: 0.31, // octaves
  squishSynthBubbleRise: 0.1,
  squishSynthBubbleDamping: 0.22,
  squishSynthBubbleAmplitude: 1,
  squishSynthCrackle: 670, // per s
  squishSynthCrackleBase: 9, // per s
  squishSynthCrackleLow: 2350, // Hz
  squishSynthCrackleHigh: 20000, // Hz
  squishSynthCrackleAmplitude: 4,
  squishSynthCrackleDecay: 0.001, // s
  squishSynthHiss: 0.13,
  squishSynthBody: 0.1,
  squishSynthBodyFrequency: 175, // Hz
  squishSynthThump: 0.68,
  squishSynthThumpFrequency: 35, // Hz
  squishSynthRumble: 0.055,
  squishSynthRumbleFrequency: 24, // Hz
  squishSynthLoudness: -25.8, // dB, K-weighted
  // Stall Doors: they swing on their hinges and spring back
  doors: true,
  doorPush: 0.15, // share of the bat's speed a door takes
  doorKnock: 3, // rad/s at least
  doorMaxSpeed: 10, // rad/s
  doorReturn: 0.6, // Hz
  doorDamping: 0.25, // damping ratio
  doorBounce: 0.45, // share of its speed a door keeps off its inner stop
  doorOpenBounce: 0.3, // and off its open stop
  doorOpenLimit: 120, // deg
  doorShake: 0.35, // camera trauma
  doorHitStop: 0.03, // s
  doorWalkPush: 1.2, // × the walking speed
  // Bat → Walls: the bat stops at walls, the floor and fixtures, and bounces back
  batWalls: true,
  batOverWalls: true, // drawn over the room, so it never clips a wall
  wallHitStop: 0.04, // s
  wallShake: 0.5, // camera trauma at full speed
  wallFullSpeed: 8, // m/s of the barrel for the hardest hit
  wallRebound: 1.5, // × the swing's pace back to rest
  // Blood Writing: on the wall by the entrance
  writing: true,
  writingText: 'No exit here',
  writingZ: 5, // m along the stalls' wall
  writingY: 1.3, // m
  writingWidth: 0.95, // m
  writingHeight: 0.9, // m
  writingLines: 2,
  writingAngle: 14, // deg
  writingLean: 18, // deg
  writingJitter: 1,
  writingDrips: 1.6,
  writingDripLength: 0.3, // m
  writingSpatter: 1,
  writingSmear: 1,
  writingMarks: true,
  writingSeed: 7,
  writingWetColor: '#6e0710', // the blood where it lies thick
  writingDryColor: '#2a0306', // at its thin, dried edges
  writingWetRoughness: 0.12, // the tiles' roughness under thick, wet blood
  writingDryRoughness: 0.5, // under its thin, dried edges
  writingFilmRoughness: 0.75, // in the dried film smeared round the blood, which dulls the glazed tiles
  writingFilm: 1, // how much of the film there is
  // TAAU: temporal anti-aliasing upscaling
  taau: true,
  renderPixelRatio: 2, // the scene and prepass's pixels per CSS pixel, at most the output's; TAAU upscales a lower one
  taauCurrentFrameWeight: 0.025, // the current frame's least share of the history, more for moving pixels
  taauMaxAccumulation: 16, // samples a still pixel accumulates, about twice as many frames
  taauKernelSigma: 0.47, // output px: the reconstruction's width
  taauKernelSigmaFloor: 0.2, // input px: below taauKernelSigma × the input/output ratio, or it takes over
  taauDepthRejectTolerance: 0.02, // × the view depth: a depth change that drops the history
  taauEdgeDetectTolerance: 0.04, // × the view depth: a 3×3 depth spread that marks an edge, whose history is kept
  taauMaxVelocityLength: 32, // output px of motion at which the current frame takes over: low keeps wet highlights
  taauVarianceGammaMin: 0.5, // the clip box's width under full motion, × its width at rest
  taauLockDecay: 0.5, // a thin-feature lock's survival per frame
  taauLockThreshold: 0.2, // the luma contrast that locks a thin feature
  taauRidgeLock: true, // only a luma ridge under two texels wide locks (FSR2's shape test)
  taauLockSimilarity: 1.05, // the luma ratio under which two texels count as similar in that test
  taauLockLumaTolerance: 0.1, // the neighbourhood's luma change that drops an inherited lock
  taauEdgeDisocclusionAccumulation: 2, // samples a moving edge keeps of history that matches no surface nearby
  taauEdgeMinParallax: 1, // output px per frame that makes an edge moving
  taauClipColorSpace: 'ycocg', // the history's second clip box
  taauBicubicHistory: true, // compiled: a 5-tap Catmull-Rom history read instead of one bilinear tap
  taauJitterPhases: 32, // compiled
  // Overhead Light
  overhead: true,
  overheadColor: '#fff0c4',
  overheadIntensity: 2.2,
  overheadAzimuth: -42, // deg from +z toward +x
  overheadElevation: 67, // deg
  shadows: true,
  shadowMapSize: 1024,
  shadowExtent: 3, // m, half the square the map covers, round the figure
  shadowHeight: 4, // m
  shadowRadius: 2, // texels: the PCF radius
  shadowBias: -0.0002, // in depth
  shadowNormalBias: 0.004, // m
  // Ambient
  ambient: true,
  skyColor: '#d8d09a',
  groundColor: '#3e3828',
  ambientIntensity: 0.55,
  envIntensity: 0.35,
  envSigma: 0.04, // the reflection's blur
  // Flashlight (F)
  flashlight: true,
  flashlightFade: 0.04, // s
  flashlightColor: '#ffffff',
  flashlightIntensity: 3.5,
  flashlightAngle: 24, // deg
  flashlightPenumbra: 0.6,
  flashlightDistance: 8,
  flashlightOffsetX: 0.25, // m right of the camera
  flashlightOffsetY: -0.2, // m above it
  // Fog
  fog: true,
  fogColor: '#44412c',
  fogDensity: 0.06,
  // Ambient Occlusion (ambient light only)
  ao: true,
  aoRadius: 1.7,
  aoIntensity: 1,
  aoPower: 1.5,
  aoFalloffRange: 0.77,
  aoThinOccluder: 0,
  aoResolution: 0.5, // × the scene pass: half, with 1 × 3 samples, looks as full with 2 × 6 once TAAU resolves it
  aoSlices: 1, // compiled: the kernel's cost goes with slices × steps
  aoSteps: 3, // compiled, per slice
  aoMaxScreenRadius: 256, // drawing-buffer px
  aoTemporalAccumulation: true,
  aoTemporalAlpha: 0.1, // the current frame's weight over a full history
  aoChangeDetection: true,
  // Screen-Space Reflections in the wet trails' puddles
  ssr: true,
  ssrIntensity: 5, // × the Fresnel weight: 1 physical
  ssrResolution: 0.5, // × the scene pass
  ssrMaxDistance: 10, // m
  ssrThickness: 0.1, // m
  ssrProbes: 8,
  ssrIterations: 2,
  ssrEdgeFade: 0.05, // share of the screen
  ssrRoughnessCutoff: 0.4, // rougher pixels keep the environment's reflection
  ssrPuddleRoughness: 0.02,
  ssrRipple: 0.02,
  ssrRippleFrequency: 12, // 1/m
  ssrShowOnly: false,
  // Motion Blur
  motionBlur: true,
  shutterAngle: 180,
  maxBlurRadius: 0.05,
  objectBlurAmount: 1,
  cameraRotationBlurAmount: 1,
  cameraTranslationBlurAmount: 1,
  blurResolution: 0.5,
  // Bloom
  bloom: true,
  bloomAmplitude: 0.45,
  bloomRadius: 0.55,
  bloomThreshold: 0.9,
  // Film: after tone mapping
  film: true,
  grain: 0.08,
  vignette: 0.4,
  vignetteInner: 0.35, // share of the way to a corner
  vignetteOuter: 0.95,
  aberration: 0,
  tint: '#ecebc4',
  saturation: 0.85,
  blackLift: 0.012,
  // Restroom
  spotX: 3.35, // m across the model, stalls (0) to sinks (4.9): where the figure stands (rebuild)
  spotZ: -5.8, // m along it, entrance (0) to back wall (−10) (rebuild)
  lamps: true,
  lampColor: '#fff7ea',
  lampIntensity: 9.55, // cd
  lampAngle: 70, // deg
  lampPenumbra: 0.6,
  lampDecay: 2,
  diffuserIntensity: 6, // × lampColor
  lampShadows: true,
  lampWormShadows: true, // the lamp nearest the figure redraws its shadow every frame
  lampShadowMapSize: 1024,
  lampShadowBias: -0.0005,
  lampShadowNormalBias: 0.02,
  lampShadowRadius: 1.5, // texels: the PCF radius
  envBrightness: 1, // × the lamps and diffusers of the reflected room
  flicker: true,
  flickerRate: 0.15,
  flickerDepth: 0.7,
  flickerLamp: 3, // 1–3, entrance to back
  flickerBurstMin: 0.2, // s
  flickerBurstMax: 0.9,
  flickerStutter: 24, // Hz
  // Restroom Material: × the model's colour, roughness and normal map
  floorTint: '#ffffff',
  floorRoughness: 1,
  floorNormal: 1,
  tileTint: '#ffffff',
  tileRoughness: 1,
  tileNormal: 1,
  paintTint: '#ffffff',
  paintRoughness: 1,
  partitionTint: '#ffffff',
  partitionRoughness: 1,
  ceramicTint: '#ffffff',
  ceramicRoughness: 1,
  chromeTint: '#ffffff',
  chromeRoughness: 1,
  plasticTint: '#ffffff',
  plasticRoughness: 1,
  // Wet Trails: the worms' slime wherever they touch the floor or a tiled wall
  wetTrails: true,
  wetTrailAmount: 1, // the wetness of a soaked spot, 0–1
  wetTrailPaintTime: 0.25, // s under a worm that soaks a spot
  wetTrailSlapSpeed: 1.5, // m/s of impact that soaks a spot at once (0: never)
  wetTrailDryTime: 25, // s to 1/e
  wetTrailDryAmplitude: 0, // ± share of the drying rate a noise varies
  wetTrailDryFrequency: 2, // 1/m
  wetTrailWallPaintRate: 8, // × on the walls
  wetTrailWallDryRate: 1, // × on the walls
  wetTrailSpread: 0.6, // × a worm's radius: the stroke's half-width
  wetTrailContact: 0.3, // × its radius off a surface it still paints
  wetTrailBlur: 0.02, // m: σ
  wetTrailThreshold: 0.7, // share of a full stroke's film that shows half wet
  wetTrailSoftness: 0.3, // × the threshold the edge ramps over
  wetTrailRim: 0, // darkening of a meniscus inside the edge, 0–1
  wetTrailRimWidth: 0.01, // m
  wetTrailNoise: 0.33,
  wetTrailDryNoise: 0.6,
  wetTrailNoiseScale: 2.46, // m
  wetTrailGlossPower: 2, // the gloss dries before the stain
  wetTrailTint: '#6c1414',
  wetTrailDarken: 0.4,
  wetTrailRoughness: 0.1,
  wetTrailCellSize: 0.02, // m (rebuild); the cost grows as 1 / size²
  // Worm Material
  wormColor: '#965a5a',
  wormDark: '#74304e',
  wormVariation: 0.75,
  wormToneSkew: 0.7, // tone = hash^skew: below 1, more pink worms
  tailDarken: 0.25,
  tailDarkenStart: 0.6, // share of the length from the head
  clitellumColor: '#a0605a',
  clitellumCore: 0.5, // share of clitellumWidth that is solid
  wormRoughness: 0.2,
  wormClearcoat: 1,
  wormClearcoatRoughness: 0.04,
  wormSheen: 0.2,
  wormSheenColor: '#f2b6cc',
  wormSheenRoughness: 0.5,
  wormGlow: '#6a2044', // emissive: light scattered under the skin
  glowOcclusion: 1, // share of the glow the AO takes away
  wormAmbient: 1, // × the ambient and environment light
  // Body Occlusion: the body above a worm blocks the ambient light
  bodyOcclusion: true,
  bodyOcclusionDensity: 4, // 1/m: exp(−density · length of body overhead)
  bodyOcclusionReach: 0.6, // m above each vertex
  bodyOcclusionSamples: 4, // compiled
  shadowLift: 0.15, // share of the light a shadowed worm still gets
  wormEnvIntensity: 0.5,
  ringFrequency: 55, // 1/m
  ringAmplitude: 0.014,
  dirt: 0.35, // darkening where the worms touch the floor
  dirtStart: 0.03, // m: full below
  dirtHeight: 0.12, // m: none above
  baseDarken: 0.4, // share of baseColor at the floor
  baseDarkenStart: 0.05, // m: full below
  baseDarkenHeight: 0.5, // m: none above
  baseColor: '#82555b',
  baseShine: 1, // share of the base darkening the glow and sheen take
  cavity: 0.85, // share of the AO the albedo takes
  depthDarken: 0.6, // share lost deep in the body (0 compiles the field sample out)
  depthDarkenStart: -0.03, // m of field distance
  depthDarkenEnd: -0.12, // m
  wormValueJitter: 0.1,
  // Worm Core: dark flesh inside the body, so the gaps between the worms show shadow
  core: true,
  coreColor: '#1a0709',
  coreRoughness: 1,
  coreInset: 0.2, // m inside the field's surface
  coreReach: 0.12, // m outside its anchor a held worm still counts as home
  coreFillMin: 0.5, // share of an anchor's worms home where its core starts to grow,
  coreFillMax: 0.9, // and where it's full
  coreFade: 0.5, // m: thinner below this height
  coreGrowRate: 3, // 1/s
  coreShrinkRate: 15, // 1/s
  coreRadialSegments: 12, // rebuild
  coreCapSegments: 4, // rebuild
  // Figure
  pose: 'walk', // stand, walk
  standClip: 'Start Walking', // the clip the stand pose freezes
  standTime: 0.3, // s into it
  yaw: 0, // deg the figure turns about y
  sway: 0.04, // s of the clip either side
  swayFrequency: 0.2,
  fadeTime: 1.2, // s a pose change crossfades over
  hunched: false,
  hunch: 36, // deg the spine bends
  headDrop: -30, // deg; below 0 the head lifts
  shoulderSlump: 35, // deg
  armsForward: 62, // deg
  armsOut: -2, // deg each arm swings out from the torso (in, below 0)
  reachArm: 'none', // left, right, none: that arm reaches toward the camera
  reachForward: 55, // deg from hanging: 90 points ahead
  reachAcross: -40, // deg in toward the midline
  reachElbow: 10, // deg
  reachOffset: 0.03, // m added to the reaching forearm and hand
  reachSwayAmplitude: 6, // deg
  reachSwayFrequency: 0.12, // Hz
  walk: true, // pose walk: along the path, else in place
  walkSpeed: 0.33, // × the walk clips' rate: ≈ 0.57 m/s
  startFrom: 0.3, // s into Start Walking: the standing frame
  startSpeed: 1, // × walkSpeed it sets off at
  startHandoff: 1.67, // s into Start Walking where the walk loop takes over
  walkPhase: 0.08, // s into Walking the loop takes over at
  handoffBlend: 0.3, // s of clip time
  stopOnFeet: true, // halted, it stops on a frame with both feet down
  armSwing: 0.35, // × the walk's arm swing
  path: 'approach', // approach (after the player), aisle, waypoints
  approachStart: 0, // m along z where the figure assembles (rebuild)
  approachStop: 0, // m short of the eye where it stops
  approachTurn: 90, // deg per m walked
  figureRoam: true, // the chase goes anywhere the player can; off, over the aisle
  figureRadius: 0.25, // m
  pathStart: -3, // m along z
  pathEnd: 1,
  turnRadius: 0.25, // m: the aisle path turns round on a half circle, toward the urinals
  figureHeight: 1.85, // m standing (rebuild)
  // Body Field: radius offsets (live), m. Near 0 the worms lie on the skin: thicker, and the legs touch and the arms
  // meet the torso.
  torsoOffset: 0,
  shoulderOffset: 0,
  armOffset: 0,
  handOffset: 0,
  neckOffset: -0.02,
  headOffset: 0,
  legOffset: 0,
  footOffset: 0,
  // Body Field: bulk (toggles rebuild, sizes live), m
  hump: false,
  humpRadius: 0.3,
  humpBack: 0.14,
  humpUp: -0.04,
  belly: false,
  bellyRadius: 0.26,
  bellyForward: 0.07,
  bellyDown: 0.08,
  yoke: true, // a bar across the shoulders
  yokeRadius: 0.1,
  yokeSpan: 1, // × the shoulders' width
  yokeDown: 0.03,
  scruff: false,
  scruffStartRadius: 0.1,
  scruffEndRadius: 0.06,
  scruffUp: 0.05,
  scruffForward: 0.04,
  webs: false,
  webStartRadius: 0.11,
  webEndRadius: 0.13,
  skirt: false, // a cone from the hips to the floor
  skirtTopRadius: 0.36,
  skirtBottomRadius: 0.3,
  skirtUp: 0.1,
  skirtBack: 0,
  skull: true, // a ball rounding the head
  skullRadius: 0.12,
  skullUp: 0.1,
  skullForward: 0.03,
  hem: false, // a short wide cone round the feet
  hemRadius: 0.5,
  hemTopRadius: 0.26,
  hemHeight: 0.35,
  // Body Field: live
  fieldSmoothing: 0.03, // m
  inflateTop: 0.03, // m
  inflateBottom: 0.03, // m: the feet's flare onto the floor
  inflateFalloff: 0.15,
  breathe: 0.02, // m
  breatheFrequency: 0.22,
  maxBodySpeed: 3,
  cullDistance: 0.8,
  jumpDistance: 0.3,
  coreShare: 0.45, // the worms' colliders, × each fitted cone's mean radius
  showShell: false,
  // Attraction (FieldAttractor)
  attraction: true,
  pullAmplitude: 1,
  creep: 0.3, // m/s
  attractionRate: 3.5, // 1/s
  approachSpeed: 4.5, // m/s
  response: 10, // 1/s
  maxPull: 2.5, // g
  maxBrake: 1, // g
  edge: 0.03, // m
  glide: 0.6,
  lift: 0.85,
  liftInside: 0,
  hangDistance: 0.2, // m
  farLift: 0.3,
  liftReach: 0.35, // m
  maxAcceleration: 3.5, // g
  // Attraction: homes
  homing: 1,
  slackMin: 1.1,
  slackMax: 1.7,
  anchorMin: 0.1,
  anchorMax: 0.9,
  legHomeMin: 0.1, // m: the legs' homes lie in this height band
  legHomeMax: 1, // m
  cloakTop: 0, // m: torso homes below this hang with the legs' worms as a cloak
  legBias: 2.6,
  torsoBias: 2.4,
  armBias: 1.8,
  headBias: 3,
  reachBias: 1.8, // × armBias on the reaching arm
  neckBias: 0.5, // × headBias on the neck
  headConeBias: 0.5, // × headBias on the head cone under the skull
  shortHeads: true, // the shortest worms take the head's homes,
  shortArms: true, // the next shortest the arms',
  longLegs: true, // the middling the torso's, the longest the legs'
  heapShare: 0, // body worms homed low in the hem (or the skirt)
  heapHeight: 0.25, // m; 0 leaves them no home
  heapSlack: 1.6,
  homeSurface: 1, // homes ∝ each anchor's volume (0) or surface (1)
  // Attraction: mess
  weightMin: 0.65,
  weightMax: 1.25,
  tailMin: 0.6,
  tailMax: 1,
  legTailMax: 1,
  armTailMax: 0.45,
  armWeight: 3, // × weight per region
  headWeight: 3,
  torsoWeight: 3,
  legWeight: 3,
  headSlack: 1, // × slack per region
  armSlack: 0.8,
  torsoSlack: 0.85,
  headTailMin: 1,
  headFlatten: 5, // × flatten per region
  armFlatten: 3,
  legHang: 0.2, // × hang per region
  torsoHang: 0.3,
  armHang: 1,
  headHang: 2,
  headGrip: 0.5, // where along them (0 leading end, 1 tail) each region's worms are held
  armGrip: 0.5,
  torsoGrip: 0.3,
  legGrip: 0.5,
  heapHang: 0,
  heapFlatten: 0.3,
  headHangLevel: 0, // the up component past which hang turns each region's segments down
  torsoHangLevel: 0,
  armHangLevel: -0.5,
  legHangLevel: -0.3,
  danglers: 4, // forearm and hand homes that take the longest worms and let them hang
  danglerTail: 0.1,
  danglerTailStart: 0.25,
  danglerHang: 1,
  danglerHangLevel: -0.5,
  danglerFlatten: 0,
  tailStartMin: 0.45,
  tailStartMax: 0.65,
  legTailStartMin: 0.2,
  legTailStartMax: 0.35,
  tailHoming: 0.5, // × homing at the trailing end
  reversedShare: 0.1,
  noiseAmplitude: 0.02, // m
  noiseFrequency: 3, // 1/m
  noiseSpeed: 0.35, // Hz
  noiseDriftX: 1.3, // × noiseSpeed per axis
  noiseDriftY: 2.1,
  noiseDriftZ: 0.7,
  // Attraction: lurch
  lurch: true,
  lurchAmplitude: 0.45, // g
  lurchFrequency: 0.8, // Hz
  lurchBursts: 0.15,
  burstFrequency: 0.17, // Hz
  lurchTail: 0.4,
  looseKick: 0.3,
  lurchWeight: 0.6, // share of a worm's weight its lurch takes
  conform: 4, // 1/s
  flatten: 2, // g
  flattenHang: 1,
  hang: 1.5, // g
  levelBand: 0.25,
  // Attraction: leash, along the room
  leashDistance: 11, // m
  leashBand: 0.5, // m
  leashPull: 0.5, // g
  leashAxesX: 0, // along z only
  leashAxesY: 0,
  leashAxesZ: 1,
  // Attraction: rise, held worms climbing over the head and falling off it
  rise: true,
  riseInterval: 60, // s held, on average, before a worm rises
  riseSpread: 0.9, // share of riseInterval
  riseDuration: 12, // s it climbs at most
  riseSpeed: 0.15, // m/s
  riseReach: 0.1, // m outside the body a rising worm still clings
  riseDelay: 4, // s
  riseHead: false, // the head's own worms rise too
  summitHeight: 0.2, // m above the crown
  spillHeight: 0.1, // m above the crown a held worm lets go past
  spillTime: 0.25, // s
  // Attraction: assembly (rebuild)
  assembleSpread: 0.1, // s
  heightShare: 0.7,
  wakeJitter: 0.3,
  // Hold (WormSimulation's surface pass)
  capture: 0.06,
  skinDepth: 0.06,
  buoyancy: 0.85,
  squeeze: -0.3, // g toward the field's core; below 0 out toward its skin
  lateralDrag: 6,
  axialDrag: 1.5,
  gripTime: 0.3,
  maxFieldAcceleration: 3,
  rearPull: 1.4,
  rearShare: 0.02,
  rearTime: 3,
  rearSpan: 0.4,
  heldFriction: 0.3,
  // States
  catchTime: 0.1,
  catchRadius: 0.3, // m from the figure's base a fallen worm is caught within
  dripRate: 0.03,
  dripDelay: 4, // s
  knockTime: 0.8,
  collapseTime: 2,
  collapseStagger: 1.2,
  // States → Advanced: WormSimulation's climb and fill behaviour, held inert: a body worm is only held or loose
  looseRest: 1000000000,
  wanderChance: 0,
  heldSlipShare: 0,
  catchShare: 0,
  holdShare: 0,
  restOutside: false,
  climbHeadPull: 0,
  climbPull: 0,
  skinPull: 0,
  fillLayers: 1, // rebuild
  // Writhe
  amplitude: 0.5,
  heldAmplitude: 0.25,
  looseAmplitude: 0.5,
  looseEaseIn: 0.3,
  frequency: 1.8,
  wavelength: 1.2,
  temperature: 1.2,
  buriedDamping: 0.15,
  curl: 7,
  looseCurl: 9,
  curlVariation: 0.6,
  curlWaves: 1.5,
  curlThreshold: 0.3,
  restMemory: 0.6,
  writheRate: 3,
  chirality: 0.7,
  looseChirality: 0.36,
  squirm: 10,
  squirmFrequency: 1.5,
  squirmWaves: 1.2,
  squirmBursts: 0.7,
  heldSquirm: 0.3,
  serpentine: 0,
  // Crawl: the strays' gait
  peristalsis: 0.4, // share each segment's rest length swings by
  peristalsisFrequency: 3, // Hz
  peristalsisWaves: 1,
  squirmHead: 0.3, // share of the squirm a crawler's head takes
  headPull: 1.5, // g on a crawler's head toward the body
  steeringGain: 2.5,
  maxBias: 3,
  stuckTime: 4, // s without progress before a crawler detours
  // Grip & Adhesion
  adhesion: true,
  adhesionPull: 5, // g
  heldAdhesion: 0.28, // share held worms take
  breakGap: 4.5, // × r
  breakSpeed: 4, // m/s
  restickDelay: 0.05,
  forwardFriction: 0.025,
  backwardFriction: 0.25,
  lateralFriction: 0.5,
  looseIsotropy: 1, // a loose worm grips the same every way
  // Worms (rebuild)
  wormCount: 113,
  strayShare: 0.17,
  particles: 16,
  thickness: 0.05, // m
  lengthMin: 0.45, // m
  lengthMax: 1.2,
  lengthSkew: 1.3, // above 1, more short worms
  headRounding: 0.08,
  tailTaper: 0.3,
  tailTip: 0.4,
  clitellumSwell: 0.12,
  clitellumPosition: 0.28, // share of the length from the head
  clitellumWidth: 0.06,
  radialSegments: 10,
  lengthSegments: 2,
  capSegments: 3,
  segmentBucketSize: 64,
  start: 'scatter', // heap, scatter, ceiling
  assemblePull: 0.4, // × the pull as the start begins
  assemblePullTime: 4, // s it eases up to full over
  assembleGripTime: 1, // s a worm's grip, and so its pull, takes to build once caught while the start gathers
  // s the start gathers over, feet first: the catch level rises through the homes' heights and the catch radius grows
  // from the figure out; 0 catches every worm at once
  assembleGatherTime: 5,
  assembleRadiusFrom: 1.2, // m across the floor from the figure: the worms within it assemble first
  assembleRadiusTo: 3, // m it grows to; the worms farther out crawl in to meet it
  assembleWalkAt: 0.9, // share of the worms laid round the figure held when it walks off; at the latest, at the
  // gather's end
  startHover: 0.02, // m over the floor the heap, scatter and strays are laid: they drop onto it
  heapInner: 0.1, // m from the feet
  heapOuter: 0.65,
  heapLayers: 10,
  scatterInner: 0.8,
  scatterOuter: 3,
  ceilingBottom: 2.2,
  ceilingTop: 2.5,
  ceilingRadius: 0.9,
  strayInner: 1.2, // m along the aisle
  strayOuter: 4, // the back wall is 4.2 m behind the figure
  strayBehind: 0.7, // share of the strays down the aisle behind the figure
  strayWidth: 0.8, // share of the aisle's width the strays are laid across: clear of the doors and urinals
  strayClusters: 10, // knots the strays are coiled in, round as many points; 0 lays each on its own
  strayClusterRadius: 0.25, // m: a knot's worms coil within this of its point while they fit
  strayCrawl: true, // strays crawl to the body and climb into it; off, they writhe where they lie
  maxTurn: 20, // deg per joint: coiled worms spring off the floor once they crawl
  packGap: 0.9, // × the sum of two radii
  packBudget: 120, // ms
  seed: 1,
  warmup: 0, // s simulated at load
  // Solver
  numSubsteps: 7,
  bendingIterations: 4,
  bendingCompliance: 5,
  stretchingCompliance: 0.1,
  compressionCompliance: 0.002,
  bendingDamping: 20,
  bendingPlasticity: 0,
  bendingPlasticityThreshold: 0.05, // rad
  contactFriction: 0.08,
  contactStiffness: 1,
  colliderFriction: 0.4,
  colliderMargin: 0, // m
  groundFriction: 0.05,
  groundRestitution: 0,
  separationSpeed: 0.8, // m/s
  damping: 0.05,
  normalDamping: 0.2,
  maxSpeed: 11.5, // m/s
  timeScale: 1,
  maxDeltaTime: 0.02, // s of world a frame steps at most: a slow frame runs in slow motion
  maxPlayerDeltaTime: 0.1, // s a frame moves the player at most
  gravity: -9.81,
  selfCollision: true,
  strictCollisions: true,
  contactLanes: true, // the contacts pass at 32 threads a segment: the same contacts, about 6× faster
  colliderCulling: true, // each worm meets only the colliders it can reach this frame: the same steps, fewer tests
  sharedFieldSample: true, // the attractor reads the field the worms' surface pass sampled: one cone loop a substep
  // Tools
  toolCooldown: 1.5, // s a struck worm stays loose
  pokeRadius: 0.3,
  pokeSpeed: 2,
  blastRadius: 0.6,
  blastSpeed: 6,
  grabRadius: 0.08,
  grabStiffness: 1,
}
// The params as written, for the presets.
const DEFAULTS = { ...params }

// WormSimulation settings copied every frame, by name.
const WORM_KEYS = [
  'numSubsteps',
  'bendingIterations',
  'bendingCompliance',
  'stretchingCompliance',
  'compressionCompliance',
  'bendingDamping',
  'bendingPlasticity',
  'bendingPlasticityThreshold',
  'contactFriction',
  'contactStiffness',
  'colliderFriction',
  'colliderMargin',
  'groundFriction',
  'groundRestitution',
  'separationSpeed',
  'damping',
  'normalDamping',
  'timeScale',
  'maxDeltaTime',
  'selfCollision',
  'strictCollisions',
  'contactLanes',
  'colliderCulling',
  'grabStiffness',
  'capture',
  'skinDepth',
  'buoyancy',
  'squeeze',
  'lateralDrag',
  'axialDrag',
  'gripTime',
  'maxFieldAcceleration',
  'rearPull',
  'rearShare',
  'rearTime',
  'rearSpan',
  'heldFriction',
  'catchTime',
  'knockTime',
  'collapseTime',
  'collapseStagger',
  'looseRest',
  'wanderChance',
  'heldSlipShare',
  'catchShare',
  'holdShare',
  'restOutside',
  'climbHeadPull',
  'climbPull',
  'skinPull',
  'amplitude',
  'heldAmplitude',
  'looseAmplitude',
  'looseEaseIn',
  'frequency',
  'wavelength',
  'temperature',
  'buriedDamping',
  'curl',
  'looseCurl',
  'curlVariation',
  'curlWaves',
  'curlThreshold',
  'restMemory',
  'writheRate',
  'chirality',
  'looseChirality',
  'squirm',
  'squirmFrequency',
  'squirmWaves',
  'squirmBursts',
  'heldSquirm',
  'serpentine',
  'peristalsis',
  'peristalsisFrequency',
  'peristalsisWaves',
  'squirmHead',
  'headPull',
  'steeringGain',
  'maxBias',
  'stuckTime',
  'adhesion',
  'adhesionPull',
  'heldAdhesion',
  'breakGap',
  'breakSpeed',
  'restickDelay',
  'forwardFriction',
  'backwardFriction',
  'lateralFriction',
  'looseIsotropy',
  'toolCooldown',
  'pokeRadius',
  'pokeSpeed',
  'blastRadius',
  'blastSpeed',
  'strikeRadius',
  'strikeSpeed',
  'strikeSpread',
  'strikeTumble',
  'strikeLocality',
]

// FieldAttractor settings copied every frame: [attractor key, param] pairs.
const ATTRACTOR_KEYS = Object.entries({
  creep: 'creep',
  attraction: 'attractionRate',
  approachSpeed: 'approachSpeed',
  response: 'response',
  maxPull: 'maxPull',
  maxBrake: 'maxBrake',
  edge: 'edge',
  homing: 'homing',
  tailHoming: 'tailHoming',
  glide: 'glide',
  lift: 'lift',
  liftInside: 'liftInside',
  hangDistance: 'hangDistance',
  farLift: 'farLift',
  liftReach: 'liftReach',
  noiseAmplitude: 'noiseAmplitude',
  noiseFrequency: 'noiseFrequency',
  noiseSpeed: 'noiseSpeed',
  lurchFrequency: 'lurchFrequency',
  lurchBursts: 'lurchBursts',
  burstFrequency: 'burstFrequency',
  lurchTail: 'lurchTail',
  looseKick: 'looseKick',
  lurchWeight: 'lurchWeight',
  conform: 'conform',
  flatten: 'flatten',
  flattenHang: 'flattenHang',
  hang: 'hang',
  levelBand: 'levelBand',
  leashDistance: 'leashDistance',
  leashBand: 'leashBand',
  leashPull: 'leashPull',
  riseSpeed: 'riseSpeed',
  riseReach: 'riseReach',
  maxAcceleration: 'maxAcceleration',
})

// The per-worm arrays HomeAssigner fills and FieldAttractor reads.
const HOME_ARRAYS = [
  'anchorOf',
  'anchorAt',
  'slack',
  'weight',
  'tail',
  'tailStart',
  'reversed',
  'hangShare',
  'flattenShare',
  'grip',
  'hangLevel',
]

// The values a param with a fixed set takes, which the URL query is checked against.
const OPTIONS = {
  tier: ['Auto', 'Low', 'Medium', 'High'],
  shadowMapSize: [1024, 2048, 4096],
  lampShadowMapSize: [512, 1024, 2048],
  ssrResolution: [0.5, 1],
  blurResolution: [0.5, 1],
  pose: ['stand', 'walk'],
  reachArm: ['left', 'right', 'none'],
  path: ['approach', 'aisle', 'waypoints'],
  start: ['heap', 'scatter', 'ceiling'],
  tool: ['Bat', 'Grab', 'Poke', 'Blast'],
  touchControls: ['Auto', 'On', 'Off'],
  taauClipColorSpace: TAAUNode.clipColorSpaces,
}
// [min, max] of the params outside which the build breaks.
const RANGES = {
  flickerLamp: [1, 3],
  thickness: [0.01, 0.12],
  packGap: [0.5, 1.5],
  particles: [6, 48],
  taauJitterPhases: [8, 64],
  aoSlices: [1, 4],
  aoSteps: [2, 12],
  loadingDarkness: [0, 1],
}
// The reaching arm's side of the rig ('Left', 'Right'), or null.
const reachSide = () => (params.reachArm === 'left' ? 'Left' : params.reachArm === 'right' ? 'Right' : null)

// Home regions, and their colours in HomesHelper.
const REGION = { legs: 0, torso: 1, arms: 2, head: 3, none: 255 }
const REGION_COLORS = ['#4aa3ff', '#ffb347', '#7dff7d', '#ff5c8a']
const regionOf = (cone) =>
  /Leg|Hips|skirt|hem/.test(cone)
    ? REGION.legs
    : /Arm|Hand|Shoulder|web/.test(cone)
      ? REGION.arms
      : /Head|neck|scruff|skull/i.test(cone)
        ? REGION.head
        : REGION.torso
// Which radius offset a fitted cone takes (params.<part>Offset).
const partOf = (cone) =>
  /Foot|Toe/.test(cone)
    ? 'foot'
    : /Leg/.test(cone)
      ? 'leg'
      : /Hand/.test(cone)
        ? 'hand'
        : /Arm/.test(cone)
          ? 'arm'
          : /neck/i.test(cone)
            ? 'neck'
            : /Head/.test(cone)
              ? 'head'
              : /Shoulder/.test(cone)
                ? 'shoulder'
                : 'torso'
const FOOT_BONES = ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase']
// The bulk cones, each with its toggle param.
const BULK = ['hump', 'belly', 'yoke', 'scruff', 'webs', 'skirt', 'skull', 'hem']
// The bones the hunch and the reach turn, and the share of `hunch` each spine bone takes, bottom up.
const HUNCH_BONES = [
  'Spine',
  'Spine1',
  'Spine2',
  'Neck',
  'Head',
  'LeftShoulder',
  'RightShoulder',
  'LeftArm',
  'RightArm',
  'LeftForeArm',
  'RightForeArm',
]
// The bones armSwing narrows the walk's swing of, about their mean rotation over the walk loop.
const SWING_BONES = ['Shoulder', 'Arm', 'ForeArm', 'Hand'].flatMap((part) => [`Left${part}`, `Right${part}`])
// Samples of the walk loop each swing bone's mean rotation is taken from.
const SWING_SAMPLES = 64
// The walk pose's actions: the standing frame, setting off, the loop.
const GAIT = ['idle', 'start', 'walk']
// The share of `hunch` each spine bone takes, bottom up.
const HUNCH_SPLIT = [
  ['Spine', 0.3],
  ['Spine1', 0.3],
  ['Spine2', 0.25],
  ['Neck', 0.15],
]
const TWO_PI = Math.PI * 2
const UP = new THREE.Vector3(0, 1, 0)
// m of sole under the rig's lowest joints (its toes), at the rig's own scale
const SOLE = 0.04
// An angle in (−π, π].
const wrapAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle))

// The params the URL set: no tier overrides them.
const urlKeys = []
for (const [key, text] of new URLSearchParams(location.search)) {
  if (!Object.hasOwn(params, key)) {
    console.warn(`[worm-monster] unknown query param "${key}"`)
    continue
  }
  const type = typeof params[key]
  let value
  if (type === 'number' && text !== '' && Number.isFinite(Number(text))) value = Number(text)
  else if (type === 'boolean') value = text === 'true' || text === '1'
  else if (type === 'string') value = text
  else {
    console.warn(`[worm-monster] query param "${key}=${text}" is not a ${type}`)
    continue
  }
  if (OPTIONS[key]) {
    // in any case: ?tier=low
    const option = OPTIONS[key].find((o) => String(o).toLowerCase() === String(value).toLowerCase())
    if (option === undefined) {
      console.warn(`[worm-monster] query param "${key}=${text}" is not one of ${OPTIONS[key].join(', ')}`)
      continue
    }
    value = option
  }
  if (RANGES[key]) {
    const clamped = THREE.MathUtils.clamp(value, ...RANGES[key])
    if (clamped !== value) console.warn(`[worm-monster] query param "${key}=${text}" clamped to ${clamped}`)
    value = clamped
  }
  params[key] = value
  urlKeys.push(key)
}

// ─── Quality tiers ───────────────────────────────────────────────────────────

// The keys each tier sets, lowest first; a key a tier leaves out takes the params as written (DEFAULTS): High, the full
// quality, set by hand or in the URL. Medium, a desktop's, steps the worms fewer times a frame and renders the scene at
// 1 px per CSS px, which TAAU upscales to the output's 2 on a Retina display. Low, a mobile device's, also drops what
// costs a pass, a shadow map or a dispatch apiece: the reflections, the lamps' and the overhead light's shadows, the
// bloom, the wet trails; keeps the AO at a quarter of the scene's resolution (its prepass still redraws the scene); caps
// the output at 1.5 px per CSS px; and lays fewer worms of fewer particles. At fewer substeps the bat's collider grows
// to cover its sweep, and the struck worms fly free of the solver's bound (strictHits).
const TIER_NAMES = ['Low', 'Medium', 'High']
const TIERS = {
  Low: {
    numSubsteps: 3,
    bendingIterations: 2,
    batColliderRadius: 0.08,
    strictHits: false,
    bodyOcclusionSamples: 1,
    wetTrails: false,
    particles: 12,
    wormCount: 100,
    renderPixelRatio: 1,
    maxPixelRatio: 1.5,
    lampWormShadows: false,
    lampShadows: false,
    aoResolution: 0.25,
    ssr: false,
    shadows: false,
    shadowMapSize: 1024,
    bloom: false,
  },
  Medium: {
    numSubsteps: 4,
    bendingIterations: 3,
    batColliderRadius: 0.06,
    strictHits: false,
    bodyOcclusionSamples: 2,
    wetTrailCellSize: 0.04,
    renderPixelRatio: 1,
    lampWormShadows: false,
  },
  High: {},
}
// Every key a tier sets, and those that rebuild the worms or the restroom: the governor never changes these.
const TIER_KEYS = Object.values(TIERS)
  .flatMap(Object.keys)
  .filter((key, i, keys) => keys.indexOf(key) === i)
const TIER_REBUILD_KEYS = ['particles', 'wormCount', 'wetTrailCellSize']

// The value each tier key took from the last tier applied.
const tierSet = {}
let tiersLive = false // the scene and its post-processing are built: a tier's change runs their side effects
/**
 * Sets each tier key the URL left free to tier `name`'s value, then runs the side effects of those that changed; the
 * rest are read every frame. `live` (the governor's steps) leaves the rebuild keys as they are, and any key changed
 * since a tier last set it. Returns the keys that changed.
 */
function applyTier(name, { live = false } = {}) {
  const changed = []
  for (const key of TIER_KEYS) {
    const rebuilds = TIER_REBUILD_KEYS.includes(key)
    if (urlKeys.includes(key) || (live && rebuilds)) continue
    if (live && Object.hasOwn(tierSet, key) && !Object.is(params[key], tierSet[key])) continue
    const tier = TIERS[name]
    const value = Object.hasOwn(tier, key) ? tier[key] : DEFAULTS[key]
    tierSet[key] = value
    if (Object.is(params[key], value)) continue
    params[key] = value
    changed.push(key)
  }
  if (!tiersLive || changed.length === 0) return changed
  const has = (...keys) => keys.some((key) => changed.includes(key))
  if (has('maxPixelRatio')) setPixelRatio()
  else if (has('renderPixelRatio')) setSampling()
  if (has('ssr')) buildPost()
  else if (has('bloom', 'motionBlur')) setOutput()
  if (has('wetTrails')) wirePasses()
  if (has('wetTrailCellSize')) rebuildRestroom()
  else if (has('particles', 'wormCount')) rebuild()
  return changed
}

// ─── Loading screen ──────────────────────────────────────────────────────────

// The page's #loading screen, there before the scripts arrive, covers it until the worms have spawned and drawn
// loadingFrames frames, so what compiles at its first draw does so out of sight. Its bar runs through the stages, each
// filling its share, a download by its bytes, and the tip at its bottom changes every loadingTipTime or on a click.
// Loaded, it logs how long each stage took; with loadingStart it then swaps the bar for the Start button and lets the
// still scene show through until start(). It fades out over loadingFade and the player takes over. An uncaught error
// or a failed build shows on it in place of the stage, and it stays.
class LoadingScreen {
  // Each stage's label and share of the bar, in order.
  static STAGES = {
    renderer: ['Lighting the candles', 0.02],
    restroom: ['Unlocking the restroom', 0.48],
    figure: ['Digging up the host', 0.2],
    worms: ['Hatching the worms', 0.05],
    compile: ['Feeding the worms', 0.15],
    spawn: ['Summoning all worms', 0.1],
  }

  shown = false // over the page: loading, or waiting for Start
  waiting = false // loaded, waiting for Start
  failed = false
  times = [['scripts', 0]] // [stage, ms since the page's start it began at], in order, then ['done', ms]
  button = null // Start
  #element
  #bar
  #fill
  #label
  #tips = []
  #deck = [] // tips still to show, dealt from the end: none shows twice until all have
  #tipTimer = 0
  #darkness = null // the --darkness it shows
  #stage = null
  #value = 0 // the bar's fill, 0–1, never going back
  #files = new Map() // url → [received, total] bytes, of this stage's downloads
  #frames = 0 // drawn with the worms
  #onError = (event) => this.fail(event.message || String(event.error))

  constructor(element) {
    this.#element = element
    if (!element) return
    this.#bar = element.querySelector('.loading-bar')
    this.#fill = element.querySelector('.loading-fill')
    this.#label = element.querySelector('.loading-stage')
    this.button = element.querySelector('.loading-button')
    this.#tips = [...element.querySelectorAll('.loading-tip')]
    element.querySelector('.loading-tips')?.addEventListener('click', () => this.#nextTip())
    if (!params.loadingScreen) {
      element.style.setProperty('--fade', '0s')
      element.classList.add('done')
      return
    }
    this.shown = true
    window.addEventListener('error', this.#onError)
    this.#scheduleTip()
  }

  /** Starts a stage of STAGES: its label shows and its share of the bar begins. */
  begin(stage) {
    if (!this.shown || this.failed) return
    this.#stage = stage
    this.#files.clear()
    this.times.push([stage, performance.now()])
    this.#label.textContent = LoadingScreen.STAGES[stage][0]
    this.#show(0)
  }

  /** A loader's onProgress for the download of `url`: the stage fills by the bytes of all its downloads. */
  progress(url) {
    return (event) => {
      if (!this.shown || !event.lengthComputable) return
      this.#files.set(url, [event.loaded, event.total])
      let received = 0
      let total = 0
      for (const [loaded, size] of this.#files.values()) {
        received += loaded
        total += size
      }
      this.#show(received / total)
    }
  }

  /**
   * Once a frame, after it is drawn: `spawned` once the worms are in the scene. After loadingFrames of those, waits
   * for Start, or without loadingStart or under automation hides.
   */
  update(spawned) {
    if (this.waiting) return this.#setDarkness()
    if (!this.shown || this.failed || !spawned) return
    if (this.#stage !== 'spawn') this.begin('spawn')
    const frames = Math.max(Math.round(params.loadingFrames), 1)
    this.#show(++this.#frames / frames)
    if (this.#frames < frames) return
    if (params.loadingStart && !navigator.webdriver) this.#wait()
    else this.hide()
  }

  /** Hides, once it waits for Start. */
  start() {
    if (this.waiting) this.hide()
  }

  /** Fades out over loadingFade. */
  hide() {
    if (!this.shown) return
    this.#loaded()
    this.shown = false
    this.waiting = false
    this.button.blur()
    this.#element.style.setProperty('--fade', `${Math.max(params.loadingFade, 0)}s`)
    this.#element.classList.add('done')
  }

  /** Shows `message` in place of the stage, and stays. */
  fail(message) {
    if (!this.shown || this.failed) return
    this.failed = true
    clearTimeout(this.#tipTimer)
    this.#element.classList.add('failed')
    this.#label.textContent = `Failed to load: ${message}`
  }

  // The Start button in place of the bar, focused so Enter or Space starts too, and the scene through it.
  #wait() {
    this.#loaded()
    this.waiting = true
    this.#setDarkness()
    this.#element.classList.add('ready')
    this.button.focus({ preventScroll: true })
  }

  // The tips stopped, and the stages' times logged, once.
  #loaded() {
    clearTimeout(this.#tipTimer)
    window.removeEventListener('error', this.#onError)
    if (this.times.at(-1)[0] === 'done') return
    this.times.push(['done', performance.now()])
    const stages = this.times
      .slice(0, -1)
      .map(([stage, at], i) => `${stage} ${((this.times[i + 1][1] - at) / 1000).toFixed(2)}`)
    console.log(`[worm-monster] loaded in ${(performance.now() / 1000).toFixed(2)} s (${stages.join(' · ')})`)
  }

  // The share of the scene it hides while it waits: loadingDarkness.
  #setDarkness() {
    const darkness = THREE.MathUtils.clamp(params.loadingDarkness, 0, 1)
    if (darkness === this.#darkness) return
    this.#darkness = darkness
    this.#element.style.setProperty('--darkness', darkness)
  }

  // The next tip in loadingTipTime.
  #scheduleTip() {
    clearTimeout(this.#tipTimer)
    this.#tipTimer = setTimeout(() => this.#nextTip(), Math.max(params.loadingTipTime, 1) * 1000)
  }

  // The next tip of a shuffled deck, on the timer or a click; while it loads, the one after it scheduled.
  #nextTip() {
    const tips = this.#tips
    if (tips.length < 2) return
    const current = tips.findIndex((tip) => tip.classList.contains('shown'))
    if (this.#deck.length === 0) {
      const deck = (this.#deck = tips.map((_, i) => i).filter((i) => i !== current))
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[deck[i], deck[j]] = [deck[j], deck[i]]
      }
    }
    tips[current]?.classList.remove('shown')
    tips[this.#deck.pop()].classList.add('shown')
    if (this.shown && !this.waiting && !this.failed) this.#scheduleTip()
  }

  // The bar `fraction` of the way through this stage.
  #show(fraction) {
    let before = 0
    for (const stage of Object.keys(LoadingScreen.STAGES)) {
      if (stage === this.#stage) break
      before += LoadingScreen.STAGES[stage][1]
    }
    const share = LoadingScreen.STAGES[this.#stage][1]
    this.#value = Math.max(this.#value, Math.min(before + share * THREE.MathUtils.clamp(fraction, 0, 1), 1))
    this.#fill.style.transform = `scaleX(${this.#value})`
    this.#bar.setAttribute('aria-valuenow', Math.round(this.#value * 100))
  }
}
const loading = new LoadingScreen(document.getElementById('loading'))
loading.begin('renderer')

// ─── Renderer ────────────────────────────────────────────────────────────────

const renderer = new THREE.WebGPURenderer({ antialias: false })
renderer.toneMapping = THREE.AgXToneMapping
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
renderer.setPixelRatio(Math.min(window.devicePixelRatio, params.maxPixelRatio))
renderer.domElement.style.cssText = 'position:fixed;top:0;left:0;z-index:-1;touch-action:none;'
renderer.setSize(window.innerWidth, window.innerHeight)
document.body.appendChild(renderer.domElement)
// WebGPU or an error, never three's WebGL 2 fallback, which would draw the scene without the compute-shader worms.
renderer._getFallback = null
try {
  await renderer.init()
} catch (error) {
  const reason = navigator.gpu ? (error?.message ?? error) : 'this browser has no navigator.gpu'
  throw new Error(`WebGPU failed to start, and this example has no WebGL fallback: ${reason}`)
}
// The worms need core WebGPU: 8 storage buffers per stage, and storage buffers in the vertex stage.
if (renderer.backend.compatibilityMode) {
  const { maxStorageBuffersPerShaderStage, maxStorageBuffersInVertexStage } = renderer.backend.device.limits
  console.error(
    `[worm-monster] This GPU's WebGPU runs in compatibility mode (${maxStorageBuffersPerShaderStage} storage ` +
      `buffers per shader stage, ${maxStorageBuffersInVertexStage ?? '?'} in vertex shaders): the worms need core ` +
      'WebGPU, with 8.',
  )
}

// The device's tier from its adapter and navigator.userAgentData, in a few ms, before anything reads the tier keys:
// Medium for a desktop GPU; Low for a phone or a tablet, a mobile or pre-Xe2 Intel GPU, a weak one and a fallback
// adapter. High is only ever set by hand.
const detector = new GPUTierDetector(TIER_NAMES, {
  caps: { fallback: 'Low', weak: 'Low', mobile: 'Low', desktop: 'Medium' },
})
const found = await detector.detect(renderer)
// Phones, tablets and mobile GPUs start without the debug view: its GPU timestamp queries cost a mobile GPU several ms
// a frame.
if (found.mobile && !urlKeys.includes('debug')) params.debug = false
applyTier(params.tier === 'Auto' ? found.tier : params.tier)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, params.maxPixelRatio))
{
  const tier = params.tier === 'Auto' ? found.tier : `${params.tier}, fixed; detected ${found.tier}`
  const reasons = found.reasons.join(', ')
  console.log(`[worm-monster] tier ${tier} (${found.deviceClass}: ${reasons}; in ${found.signals.time.toFixed(1)} ms)`)
}
// With monitorPerformance, Auto's frames, kept within governorTarget by stepping Medium down to Low's live keys, and
// back up.
const governor = new FrameTimeGovernor(TIER_NAMES.length, { level: found.level, minLevel: 0, maxLevel: found.level })
// under automation only if the URL asks
const governable = !navigator.webdriver || urlKeys.includes('monitorPerformance')
let governed = false // the governor ran last frame

const canTime = renderer.hasFeature('timestamp-query')
const stats = new Stats({ trackGPU: canTime, trackCPT: canTime })
document.body.appendChild(stats.dom)
stats.init(renderer)

const scene = new THREE.Scene()
scene.background = new THREE.Color(params.fogColor)
const fog = new THREE.FogExp2(params.fogColor, params.fogDensity)
const timer = new THREE.Timer()
timer.connect(document)

// ─── Camera ──────────────────────────────────────────────────────────────────

const camera = new THREE.PerspectiveCamera(params.fov, window.innerWidth / window.innerHeight, 0.05, 60)
scene.add(camera)
// The player: WASD walks, the mouse looks (a click locks the pointer, Esc releases it; unlocked, a drag looks).
const controls = new WalkControls(camera, renderer.domElement)
const NO_OBSTACLES = []
function syncControls() {
  const { aisle, space } = restroom
  controls.speed = params.playerWalk ? params.playerSpeed : 0
  controls.runMultiplier = params.playerRun
  controls.slowMultiplier = params.playerSlow
  controls.crouchHeight = params.playerCrouchHeight
  controls.crouchMultiplier = params.playerCrouchSpeed
  controls.jumpSpeed = params.playerJumpSpeed
  controls.gravity = params.playerGravity
  controls.damping = params.playerDamping
  controls.radius = params.playerMargin
  controls.bounds = params.playerRoam ? restroom.bounds : aisle
  controls.obstacles = params.playerRoam ? restroom.walkObstacles : NO_OBSTACLES
  controls.ground = 0
  controls.ceiling = restroom.bounds.max.y
  controls.height = THREE.MathUtils.clamp(params.cameraY, space.min.y + 0.15, space.max.y - 0.15)
  controls.lookSpeed = params.lookSpeed
  controls.pointerLock = params.pointerLock
}
// At the start position, facing lookYaw and lookPitch from the next update().
function placePlayer() {
  syncControls()
  const yaw = THREE.MathUtils.degToRad(params.lookYaw)
  const pitch = THREE.MathUtils.degToRad(params.lookPitch)
  camera.position.set(params.cameraX, controls.ground + controls.height, params.cameraZ)
  controls.target
    .set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
    .add(camera.position)
}
// At the start, still, free to walk once the loading screen is gone.
function resetPlayer() {
  placePlayer()
  controls.velocity.set(0, 0, 0)
  controls.enabled = !loading.shown
}
const shake = new CameraShake()

// The view at load: V restores it.
const VIEW_KEYS = ['cameraX', 'cameraY', 'cameraZ', 'lookYaw', 'lookPitch']
const homeView = Object.fromEntries(VIEW_KEYS.map((key) => [key, params[key]]))

// ─── Restroom and lights ─────────────────────────────────────────────────────

const loader = new GLTFLoader()
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

const hemisphere = new THREE.HemisphereLight()
hemisphere.name = 'ambient'
scene.add(hemisphere)

// It always casts: its shadow turns off by intensity and stops redrawing. A castShadow toggle would rebuild every
// material, and three disposes the shadow node then, which a material hidden meanwhile still holds when it shows again.
const shadowBounds = new THREE.Box3()
const overhead = new THREE.DirectionalLight()
overhead.name = 'overhead'
overhead.castShadow = true
scene.add(overhead, overhead.target)

// The lights toggle by intensity, never visibility: a change in the lights would recompile every material.
const flashlight = new THREE.SpotLight()
flashlight.name = 'flashlight'
flashlight.castShadow = false
camera.add(flashlight, flashlight.target)

// The room, lit by its lamps, the hemisphere and the flashlight; the worms by the overhead light, not the lamps.
const RESTROOM_URL = './models/restroom.glb'
loading.begin('restroom')
const restroomModel = (await loader.loadAsync(RESTROOM_URL, loading.progress(RESTROOM_URL))).scene
const roomLights = [flashlight, hemisphere]
let restroom = new Restroom(restroomModel, params, { lights: roomLights })
scene.add(restroom)

// The room and what sticks to it draw before the bat, which draws over them (BatViewModel.overlay); the worms after.
function drawBeforeBat(object) {
  object.traverse((child) => {
    if (child.isMesh) child.renderOrder = BatViewModel.RENDER_ORDER - 1
  })
}
drawBeforeBat(restroom)

// Words in blood on the wall by the entrance (Restroom.setBlood()).
function writingOptions() {
  return {
    width: params.writingWidth,
    height: params.writingHeight,
    angle: params.writingAngle,
    lean: params.writingLean,
    jitter: params.writingJitter,
    drips: params.writingDrips,
    dripLength: params.writingDripLength,
    spatter: params.writingSpatter,
    smear: params.writingSmear,
    marks: params.writingMarks,
    lines: params.writingLines,
    seed: params.writingSeed,
  }
}
const writing = new BloodWriting(params.writingText, writingOptions())
resetPlayer()

// The restroom reflected in the worms and the wet floor: the model under its lamps, baked at the figure's spot.
const pmrem = new THREE.PMREMGenerator(renderer)
let environment = null
function buildEnvironment() {
  restroom.update(params, timer.getElapsed(), figure?.group.position)
  let next
  try {
    next = pmrem.fromScene(restroom.envScene, params.envSigma, 0.05, 30, { position: restroom.envPosition })
  } catch (error) {
    console.warn('[worm-monster] the restroom environment failed, using RoomEnvironment:', error)
    const room = new RoomEnvironment()
    next = pmrem.fromScene(room, params.envSigma)
    room.dispose?.()
  }
  scene.environment = next.texture
  for (const material of [wormMaterial, worms?.material]) {
    if (!material) continue
    material.envMap = next.texture
    material.needsUpdate = true
  }
  // the reflections' composite subtracts the environment it was built with
  if (ssrNode) buildPost()
  environment?.dispose()
  environment = next
  spray.rewarm()
}

// A new restroom, then the worms laid again in it: the old spill may lie inside its walls or fixtures.
function rebuildRestroom() {
  scene.remove(restroom)
  const previous = restroom
  restroom = new Restroom(restroomModel, params, { lights: roomLights })
  drawBeforeBat(restroom)
  scene.add(restroom)
  prePass.unlitMaterials = plainMaterialsOf(restroom)
  buildEnvironment()
  if (worms) worms.colliders = wormColliders(mass)
  wirePasses()
  previous.dispose()
  rebuild()
}

// ─── Worm material ───────────────────────────────────────────────────────────

const uWormColor = uniform(new THREE.Color()).onFrameUpdate(() => uWormColor.value.set(params.wormColor))
const uWormDark = uniform(new THREE.Color()).onFrameUpdate(() => uWormDark.value.set(params.wormDark))
const uClitellumColor = uniform(new THREE.Color()).onFrameUpdate(() => uClitellumColor.value.set(params.clitellumColor))
const uWormVariation = uniform(0).onFrameUpdate(() => params.wormVariation)
const uToneSkew = uniform(1).onFrameUpdate(() => Math.max(params.wormToneSkew, 1e-3))
const uTailDarken = uniform(0).onFrameUpdate(() => params.tailDarken)
const uTailDarkenStart = uniform(0).onFrameUpdate(() => THREE.MathUtils.clamp(params.tailDarkenStart, 0, 0.999))
const uClitellumPosition = uniform(0).onFrameUpdate(() => params.clitellumPosition)
const uClitellumWidth = uniform(0).onFrameUpdate(() => Math.max(params.clitellumWidth, 1e-3))
const uClitellumCore = uniform(0).onFrameUpdate(() => THREE.MathUtils.clamp(params.clitellumCore, 0, 0.999))
const uDirt = uniform(0).onFrameUpdate(() => params.dirt)
const uDirtStart = uniform(0).onFrameUpdate(() => params.dirtStart)
const uDirtHeight = uniform(0).onFrameUpdate(() => Math.max(params.dirtHeight, params.dirtStart + 1e-3))
const uBaseDarken = uniform(0).onFrameUpdate(() => params.baseDarken)
const uBaseDarkenStart = uniform(0).onFrameUpdate(() => params.baseDarkenStart)
const uBaseDarkenHeight = uniform(0).onFrameUpdate(() =>
  Math.max(params.baseDarkenHeight, params.baseDarkenStart + 1e-3),
)
const uBaseColor = uniform(new THREE.Color()).onFrameUpdate(() => uBaseColor.value.set(params.baseColor))
const uBaseShine = uniform(0).onFrameUpdate(() => params.baseShine)
const uCavity = uniform(0).onFrameUpdate(() => params.cavity)
const uValueJitter = uniform(0).onFrameUpdate(() => params.wormValueJitter)
const uDepthDarken = uniform(0).onFrameUpdate(() => params.depthDarken)
const uDepthStart = uniform(0).onFrameUpdate(() => params.depthDarkenStart)
const uDepthEnd = uniform(0).onFrameUpdate(() => Math.min(params.depthDarkenEnd, params.depthDarkenStart - 1e-3))
const glowOcclusion = uniform(1).onFrameUpdate(() => params.glowOcclusion)
// The base's weight by world height, and what the glow and sheen keep of it.
const baseLow = uBaseDarken.mul(smoothstep(uBaseDarkenStart, uBaseDarkenHeight, positionWorld.y).oneMinus())
const baseShine = float(1).sub(baseLow.mul(uBaseShine))
// Each worm's value, ± wormValueJitter.
const valueJitter = float(1).add(hash(instanceIndex.add(7919)).sub(0.5).mul(2).mul(uValueJitter))
// The scene pass's AO (its getAO context; none in the prepass), or 1.
const occlusionOf = (builder) => builder.context.getAO?.(null, builder) ?? float(1)

const uOcclusionDensity = uniform(0).onFrameUpdate(() => params.bodyOcclusionDensity)
const uOcclusionReach = uniform(0).onFrameUpdate(() => params.bodyOcclusionReach)

// The body `field` at each worm particle, once a frame after the worms step, which the worms' material reads at its
// vertices, mixed along their span, instead of sampling the field there: the field's normal and distance, and the
// share of the ambient light (hemisphere and environment) the body above lets through, exp(−bodyOcclusionDensity × the
// length of body within bodyOcclusionReach overhead) from `samples` field samples. The worms' mesh stays at the
// origin, so their particles' positions are world positions.
class WormShade {
  #worms
  #field
  #samples
  #computeNode = null
  #fieldBuffer
  #occlusionBuffer

  constructor(worms, field, { samples = 4 } = {}) {
    this.#worms = worms
    this.#field = field
    // far outside and unoccluded until the first pass
    const far = new Float32Array(4 * worms.particleCount)
    for (let i = 0; i < worms.particleCount; i++) far.set([0, 1, 0, 1e3], 4 * i)
    this.#fieldBuffer = instancedArray(far, 'vec4').setName('wormShade_field')
    this.#occlusionBuffer = instancedArray(new Float32Array(worms.particleCount).fill(1), 'float')
    this.#occlusionBuffer.setName('wormShade_occlusion')
    this.samples = samples
  }

  get computeNode() {
    return this.#computeNode
  }

  /** Field samples per particle for the occlusion: compiled, a new pass on change. */
  get samples() {
    return this.#samples
  }
  set samples(value) {
    if (value === this.#samples) return
    this.#samples = value
    this.#computeNode?.dispose()
    const count = this.#worms.particleCount
    const positions = this.#worms.particlePositions
    const field = this.#field
    this.#computeNode = Fn(() => {
      const i = instanceIndex
      If(i.lessThan(uint(count)), () => {
        const p = positions.element(i).xyz.toVar()
        const here = field.sample(p)
        this.#fieldBuffer.element(i).assign(vec4(here.normal, here.distance))
        const inside = float(0).toVar()
        for (let k = 0; k < value; k++) {
          const above = p.add(vec3(0, uOcclusionReach.mul((k + 0.5) / value), 0))
          inside.addAssign(smoothstep(0.02, -0.02, field.sample(above).distance))
        }
        this.#occlusionBuffer.element(i).assign(exp(inside.mul(uOcclusionReach).mul(uOcclusionDensity).div(-value)))
      })
    })()
      .compute(count, [64])
      .setName('wormShade')
  }

  /** The body occlusion at the vertex. */
  occlusionNode() {
    return vertexStage(this.#worms.alongNoodle((i) => this.#occlusionBuffer.element(i)))
  }

  /** The field distance at the vertex: its span's, moved along the field's normal to the vertex. */
  distanceNode() {
    const positions = this.#worms.particlePositions
    return vertexStage(
      Fn(() => {
        const here = this.#worms.alongNoodle((i) => this.#fieldBuffer.element(i)).toVar()
        const axis = this.#worms.alongNoodle((i) => positions.element(i).xyz)
        return here.w.add(dot(here.xyz, positionWorld.sub(axis)))
      })(),
    )
  }

  dispose() {
    this.#computeNode?.dispose()
  }
}

// The share of its colour a worm keeps at its depth in the body: 1 from depthDarkenStart out, 1 − depthDarken from
// depthDarkenEnd in.
function depthShade(shade) {
  return float(1).sub(uDepthDarken.mul(smoothstep(uDepthEnd, uDepthStart, shade.distanceNode()).oneMinus()))
}

// uv.x runs head to tail. A per-worm tone and value, darker tails, the clitellum band, floor dirt, a maroon base and
// the AO's cavity darkening, all × `shade`. The glow fades with the AO, and it and the sheen with the base and `shade`.
function shadeWorms(material, shade) {
  material.colorNode = Fn((builder) => {
    const along = uv().x
    const tone = hash(instanceIndex).pow(uToneSkew).mul(uWormVariation)
    const darken = uTailDarken.mul(smoothstep(uTailDarkenStart, 1, along))
    const base = mix(uWormDark, uWormColor, tone).mul(float(1).sub(darken))
    const offBand = abs(along.sub(uClitellumPosition))
    const band = float(1).sub(smoothstep(uClitellumWidth.mul(uClitellumCore), uClitellumWidth, offBand))
    const dirt = float(1).sub(uDirt.mul(smoothstep(uDirtStart, uDirtHeight, positionWorld.y).oneMinus()))
    const cavity = mix(float(1), occlusionOf(builder), uCavity)
    return mix(mix(base, uClitellumColor, band), uBaseColor, baseLow)
      .mul(dirt)
      .mul(cavity)
      .mul(valueJitter)
      .mul(shade)
  })()
  material.emissiveNode = Fn((builder) =>
    materialEmissive
      .mul(mix(float(1), occlusionOf(builder), glowOcclusion))
      .mul(baseShine)
      .mul(shade),
  )()
  material.sheenNode = materialSheen.mul(baseShine).mul(shade)
  material.needsUpdate = true
}

// The template each build's worms clone; shadeWorms() shades the clone.
const wormMaterial = new THREE.MeshPhysicalNodeMaterial({ name: 'worm' })
// Whether the worms' material samples the field per vertex: only while depthDarken is above 0.
let depthShaded = false
function syncDepthShade() {
  const wanted = params.depthDarken > 0
  if (!worms || building || wanted === depthShaded) return
  depthShaded = wanted
  shadeWorms(worms.material, wanted ? depthShade(wormShade) : float(1))
}
// Multiplies the AO the scene pass applies: the worms' share of the ambient light, and what the body lets through.
const uWormAmbient = uniform(1).onFrameUpdate(() => params.wormAmbient)
wormMaterial.aoNode = uWormAmbient
const wormAmbientOf = (shade) => (params.bodyOcclusion ? uWormAmbient.mul(shade.occlusionNode()) : uWormAmbient)
// Whether the worms' material reads the body occlusion.
let occlusionShaded = false
function syncBodyOcclusion() {
  if (!worms || building) return
  const samples = Math.max(1, Math.round(params.bodyOcclusionSamples))
  if (samples !== wormShade.samples) {
    wormShade.samples = samples
    wirePasses()
  }
  if (params.bodyOcclusion === occlusionShaded) return
  occlusionShaded = params.bodyOcclusion
  worms.material.aoNode = wormAmbientOf(wormShade)
  worms.material.needsUpdate = true
}
// Light scattered through the pile: shadows on the worms are lifted toward 1 by this share.
const shadowLift = uniform(0).onFrameUpdate(() => params.shadowLift)
wormMaterial.receivedShadowNode = (shadow) => shadow.add(shadow.oneMinus().mul(shadowLift))
// Annuli: a ripple of the normal along each worm, faded out where they get finer than about two pixels and at the ends.
const ringsPerWorm = uniform(0).onFrameUpdate(() => (params.ringFrequency * (params.lengthMin + params.lengthMax)) / 2)
const ringAmplitude = uniform(0).onFrameUpdate(() => params.ringAmplitude)
const rings = uv().x.mul(ringsPerWorm)
const ringFade = smoothstep(0.5, 0.25, fwidth(rings)).mul(smoothstep(0, 0.06, uv().x.min(uv().x.oneMinus())))
const ripple = cos(rings.mul(TWO_PI)).mul(ringAmplitude).mul(ringFade)
wormMaterial.normalNode = Fn(() => normalize(normalView.sub(tangentView.mul(ripple))))()
wormMaterial.clearcoatNormalNode = Fn(() => normalize(normalView.sub(tangentView.mul(ripple))))()

// The worm's radius along it, × thickness/2: a rounded head, a tapered tail and the clitellum's swell.
function wormProfile(P) {
  const { headRounding, tailTaper, tailTip, clitellumSwell, clitellumPosition, clitellumWidth } = params
  return wormRadiusProfile(P, { headRounding, tailTaper, tailTip }).map((f, k) => {
    const x = (k / (P - 1) - clitellumPosition) / Math.max(clitellumWidth, 1e-3)
    return f * (1 + clitellumSwell * Math.exp(-x * x))
  })
}

// ─── Figure ──────────────────────────────────────────────────────────────────

// The figure's path: after the player (approach), a stadium round the aisle (aisle), or random waypoints in it.
class WalkPath {
  position = new THREE.Vector3()
  heading = 0
  #distance = 0
  #waypoint = new THREE.Vector3()
  #toward = new THREE.Vector3()

  reset() {
    this.#distance = 0
    this.#waypoint.set(0, 0, 0)
    const approach = params.path === 'approach'
    this.position.set(0, 0, approach ? params.approachStart : 0)
    this.heading = approach ? this.#bearing() : 0
    this.advance(0)
  }

  advance(distance) {
    this.#distance += distance
    if (params.path === 'approach') this.#approach(distance)
    else if (params.path === 'aisle') this.#aisle(this.#distance)
    else this.#waypoints(distance)
    return this
  }

  // The heading straight at `goal` (the eye unless given); #toward is left holding the way there across the floor.
  #bearing(goal = camera.position) {
    const toward = this.#toward.subVectors(goal, this.position).setY(0)
    return Math.atan2(toward.x, toward.z)
  }

  // Where the chase heads: the eye, or, roaming, a stall's doorway on the way out of the figure's stall or into the
  // eye's, until it lines up with the opening.
  #goal() {
    const eye = camera.position
    if (!params.figureRoam) return eye
    const theirs = restroom.stallAt(eye)
    const ours = restroom.stallAt(this.position)
    if (ours >= 0 && ours !== theirs) return restroom.stalls[ours].doorway
    if (theirs >= 0 && ours !== theirs && !restroom.inDoorway(this.position, theirs, params.figureRadius)) {
      return restroom.stalls[theirs].doorway
    }
    return eye
  }

  // Toward the goal, turning at most approachTurn per m walked, or on the spot while facing away, so it never circles a
  // player standing still; it stops approachStop short of the eye.
  #approach(distance) {
    const goal = this.#goal()
    const turn = wrapAngle(this.#bearing(goal) - this.heading)
    const gap = this.#toward.length()
    const stop = goal === camera.position ? params.approachStop : 0
    const most = THREE.MathUtils.degToRad(params.approachTurn) * distance
    const turned = THREE.MathUtils.clamp(turn, -most, most)
    this.heading += turned
    const step = Math.min(distance * Math.max(Math.cos(turn - turned), 0), Math.max(gap - stop, 0))
    this.position.x += Math.sin(this.heading) * step
    this.position.z += Math.cos(this.heading) * step
    this.confine()
  }

  /** Roaming on the approach, out of the walls, fixtures and doors (Restroom.keepClear()); else over the aisle. */
  confine() {
    if (params.path === 'approach' && params.figureRoam) {
      restroom.keepClear(this.position, params.figureRadius, params.figureHeight * 0.9)
      return
    }
    const { min, max } = restroom.aisle
    this.position.x = THREE.MathUtils.clamp(this.position.x, min.x + 0.3, Math.max(max.x - 0.3, min.x + 0.3))
    this.position.z = THREE.MathUtils.clamp(this.position.z, min.z + 0.3, Math.max(max.z - 0.3, min.z + 0.3))
  }

  // At s = 0 it crosses z = 0, where the figure stands, or the nearest end of its straight.
  #aisle(s) {
    const R = Math.max(params.turnRadius, 0.05)
    const start = Math.min(params.pathStart, params.pathEnd - 0.1)
    const end = params.pathEnd
    const L = end - start
    const perimeter = 2 * L + TWO_PI * R
    const u = THREE.MathUtils.euclideanModulo(s + THREE.MathUtils.clamp(-start, 0, L), perimeter)
    if (u < L) {
      this.position.set(0, 0, start + u)
      this.heading = 0
    } else if (u < L + Math.PI * R) {
      const a = (u - L) / R
      this.position.set(R - R * Math.cos(a), 0, end + R * Math.sin(a))
      this.heading = a
    } else if (u < 2 * L + Math.PI * R) {
      this.position.set(2 * R, 0, end - (u - L - Math.PI * R))
      this.heading = Math.PI
    } else {
      const a = (u - 2 * L - Math.PI * R) / R
      this.position.set(R + R * Math.cos(a), 0, start - R * Math.sin(a))
      this.heading = Math.atan2(-Math.sin(a), -Math.cos(a))
    }
  }

  #waypoints(distance) {
    if (this.#waypoint.distanceTo(this.position) < 0.5) {
      const { min, max } = restroom.aisle
      const margin = Math.min(0.6, (max.x - min.x) / 2)
      this.#waypoint.set(
        THREE.MathUtils.randFloat(min.x + margin, max.x - margin),
        0,
        THREE.MathUtils.randFloat(params.pathStart, params.pathEnd),
      )
    }
    const want = Math.atan2(this.#waypoint.x - this.position.x, this.#waypoint.z - this.position.z)
    const turn = Math.atan2(Math.sin(want - this.heading), Math.cos(want - this.heading))
    this.heading += THREE.MathUtils.clamp(turn, -distance * 1.2, distance * 1.2)
    this.position.x += Math.sin(this.heading) * distance
    this.position.z += Math.cos(this.heading) * distance
  }
}

const _bonePoint = new THREE.Vector3()
const _front = new THREE.Vector3()
const _down = new THREE.Vector3()
const _out = new THREE.Vector3()
const _from = new THREE.Vector3()
const _axis = new THREE.Vector3()
const _reach = new THREE.Vector3()
const _upper = new THREE.Vector3()
const _bend = new THREE.Vector3()
const _away = new THREE.Vector3()
const _turn = new THREE.Quaternion()
const _parent = new THREE.Quaternion()
const _local = new THREE.Quaternion()
const _sample = new THREE.Vector4()
const _stanceSide = new THREE.Vector3()
const _groupInverse = new THREE.Matrix4()
const _toePoints = [new THREE.Vector3(), new THREE.Vector3()]
const _toeStep = new THREE.Vector3()

// The figure the worms cover: Mixamo's monster rig, a bare skeleton. It walks on its own clips (MonsterGait):
// it stands on a frame of Start Walking (startFrom), sets off from
// there, and at the frame of it that best matches the Walking loop (startHandoff) blends into that loop at the matching
// phase (walkPhase); each clip's own travel moves it along its path, so the feet stay planted, and while the two blend
// the root follows the planted toe. Halted on the way (regrouping), its clip slows to rest on its next frame with both
// feet down, and speeds up again from there. The stand pose is a frozen frame of a clip that sways, on its own action
// of a cloned clip (two slots, alternating); a frozen frame stands on its lowest foot bone, plus the sole's offset
// below it. Every change of action blends the new one in and the others out in proportion, their weights summing to 1.
// On top of any pose, the hunch bends the spine, drops the head, slumps the shoulders and brings the arms forward, both
// arms swing out from the torso, and one arm reaches toward the camera, drifting up and down.
class WalkingFigure {
  group = new THREE.Group()
  path = new WalkPath()
  /** The rig's bones, by name. */
  rig = {}
  mixer
  velocity = new THREE.Vector3()
  strideSpeed = 1.4 // m/s the walk loop carries it at the clip's own rate
  halted = false // gathering or regrouping: it eases back onto its standing frame
  /** The walk pose's phase: 'idle' standing, 'start' setting off, 'walk' the loop. */
  gait = 'idle'
  #model
  #clips
  #actions
  #gaitClips // MonsterGait: the start and walk clips with their travel
  #slots = [null, null]
  #slot = 0
  #action = null // the action blending in, or alone
  #weights = new Map() // action → weight, summing to 1
  #blend = null // { others: action → its share of what #action leaves, rate: 1/s }
  #poseOf = new Map() // action → the pose key it plays
  #rootSpeed = 0 // m/s the clips carried it along its heading over the last step
  #pace = 1 // share of their own rate the gait clips play at
  #stop = null // halted on the way: { speed, hurry, time, elapsed } of the slow-down onto a feet-down frame
  #stance = null // in a start → walk blend: { toe, at } the planted toe the root follows, in the group's space
  #stanceAt = new THREE.Vector3()
  #toes // the toe bones
  #key = null
  #cut = true // the next setPose() starts its pose with no fade
  #restartAt = null // the clip time restPose() stopped an animated pose at, resumed by the next setPose()
  #time = 0
  #rest
  #feet
  #footing = new Map() // frozen pose key → the sole minus the lowest foot bone, m
  #previous = new THREE.Vector3()
  #bones
  // Each hunched bone's quaternion before the hunch, put back before the mixer runs: it writes only changed values.
  #hunchBase = new Map()
  #swingMeans // arm bone → its mean local rotation over the walk loop
  #knock = new THREE.Vector3() // m of a hit's shove still to come
  #stagger = 0 // s the walk stays halted
  #flinch = Infinity // s since the last hit
  #flinchToward = new THREE.Vector3()

  // `gait`: the Mixamo glTFs { start, walk }; the walk's rig is the figure.
  constructor(gait) {
    this.group.name = 'figure'
    const model = (this.#model = gait.walk.scene)
    this.group.add(model)
    model.traverse((node) => {
      if (node.isBone) this.rig[node.name] = node
    })
    this.#rest = new Map(
      Object.values(this.rig).map((bone) => [
        bone,
        { position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone() },
      ]),
    )
    this.#feet = FOOT_BONES.map((name) => this.rig[name]).filter(Boolean)
    this.#toes = ['LeftToeBase', 'RightToeBase'].map((name) => this.rig[name]).filter(Boolean)
    this.#bones = Object.fromEntries(
      [...HUNCH_BONES, 'LeftHand', 'RightHand'].map((name) => [name, this.rig[name] ?? null]),
    )
    this.mixer = new THREE.AnimationMixer(model)
    const { start, walk } = (this.#gaitClips = new MonsterGait(model, gait))
    this.#clips = Object.fromEntries([start.clip, walk.clip].map((clip) => [clip.name, clip]))
    this.#actions = {
      idle: this.mixer.clipAction(start.clip.clone()),
      start: this.mixer.clipAction(start.clip),
      walk: this.mixer.clipAction(walk.clip),
    }
    this.#actions.start.setLoop(THREE.LoopOnce)
    this.#actions.start.clampWhenFinished = true
    for (const [name, action] of Object.entries(this.#actions)) {
      this.#poseOf.set(action, GAIT.includes(name) ? 'walk' : name)
    }
    this.#swingMeans = this.#meanRotations(walk.clip, SWING_BONES)
    this.fit(params.figureHeight)
  }

  // Each of the bones `names`' mean local rotation over `clip`, from even samples on one hemisphere.
  #meanRotations(clip, names) {
    const means = new Map()
    for (const track of clip.tracks) {
      const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name)
      if (propertyName !== 'quaternion') continue
      const bone = THREE.PropertyBinding.findNode(this.#model, nodeName)
      if (!bone || !names.includes(bone.name)) continue
      const interpolant = track.createInterpolant()
      const first = new THREE.Vector4().fromArray(interpolant.evaluate(0))
      const sum = new THREE.Vector4()
      for (let s = 0; s < SWING_SAMPLES; s++) {
        _sample.fromArray(interpolant.evaluate((s / SWING_SAMPLES) * clip.duration))
        sum.addScaledVector(_sample, _sample.dot(first) < 0 ? -1 : 1)
      }
      means.set(bone, new THREE.Quaternion(sum.x, sum.y, sum.z, sum.w).normalize())
    }
    return means
  }

  // Normalized to `height` from the joints in the rest pose, SOLE under the lowest on the floor at the group's origin.
  // The footings and the stride speed are measured again at the new size.
  fit(height) {
    this.#restoreHunch()
    const model = this.#model
    const { position, quaternion } = this.group
    const saved = { position: position.clone(), quaternion: quaternion.clone() }
    position.set(0, 0, 0)
    quaternion.identity()
    this.restPose()
    const restartAt = this.#restartAt
    model.scale.setScalar(1)
    model.position.set(0, 0, 0)
    model.updateMatrixWorld(true)
    const box = new THREE.Box3()
    for (const bone of this.#rest.keys()) box.expandByPoint(_bonePoint.setFromMatrixPosition(bone.matrixWorld))
    const fit = height / (box.max.y - box.min.y + SOLE)
    const center = box.getCenter(new THREE.Vector3())
    model.scale.setScalar(fit)
    model.position.set(-center.x * fit, (SOLE - box.min.y) * fit, -center.z * fit)
    this.#footing.clear()
    this.strideSpeed = this.#gaitClips.walk.speed * fit
    this.restPose()
    this.#restartAt = restartAt
    position.copy(saved.position)
    quaternion.copy(saved.quaternion)
    this.group.updateMatrixWorld(true)
  }

  // The bones' rest transforms: the pose the field is built in. The next setPose() cuts to its pose: the mixer
  // only writes values that changed since its last update, so its actions restart, measuring against the rest pose.
  restPose() {
    this.#restoreHunch()
    this.#restartAt = this.animated ? this.#action.time : null
    this.mixer.stopAllAction()
    this.#weights.clear()
    this.#blend = null
    this.#key = null
    this.#cut = true
    this.#toRest()
    this.group.updateMatrixWorld(true)
  }

  // Every bone at its rest transform, matrices not updated.
  #toRest() {
    for (const [bone, rest] of this.#rest) {
      bone.position.copy(rest.position)
      bone.quaternion.copy(rest.quaternion)
      bone.scale.copy(rest.scale)
    }
  }

  /** The pose params ask for: `stand:<clip>@<time>` for a frozen frame, else the animated pose's name. */
  get poseKey() {
    return params.pose === 'stand' ? `stand:${params.standClip}@${params.standTime}` : params.pose
  }

  get frozen() {
    return this.#key?.startsWith('stand:') === true
  }

  get animated() {
    return this.#key !== null && !this.frozen
  }

  /** The model's clips, by name. */
  get clipNames() {
    return Object.keys(this.#clips)
  }

  // The pose `key`, paused if frozen: blended in over fadeTime, or cut to after a reset or rest pose.
  setPose(key) {
    if (key === this.#key) return
    const cut = this.#cut
    if (cut) {
      this.mixer.stopAllAction()
      this.#weights.clear()
      this.#blend = null
    }
    const frozen = key.startsWith('stand:')
    const animated = this.#actions[key] && !GAIT.includes(key)
    const next = frozen ? this.#frozenAction(key) : animated ? this.#actions[key] : this.#gaitAction()
    if (!this.#weights.has(next)) this.#enter(next)
    if (frozen) next.paused = true
    if (cut && !frozen && this.#restartAt !== null) next.time = this.#restartAt
    this.#key = key
    this.#blendTo(next, cut ? 0 : params.fadeTime)
    this.#cut = false
    this.#restartAt = null
  }

  #weight(action) {
    return this.#weights.get(action) ?? 0
  }

  // `action` from `time` s, playing at no weight yet.
  #enter(action, time = 0) {
    action.reset()
    action.time = time
    action.setEffectiveWeight(0)
    action.play()
    this.#weights.set(action, 0)
  }

  // `action` in over `duration` s, the other actions out in proportion to their weights now.
  #blendTo(action, duration) {
    if (!this.#weights.has(action)) this.#enter(action)
    this.#action = action
    const others = new Map()
    let rest = 0
    for (const [other, weight] of this.#weights) {
      if (other === action || weight <= 0) continue
      others.set(other, weight)
      rest += weight
    }
    if (!(duration > 0) || rest <= 0) {
      for (const other of this.#weights.keys()) this.#weights.set(other, other === action ? 1 : 0)
      this.#blend = null
      return
    }
    for (const [other, weight] of others) others.set(other, weight / rest)
    this.#blend = { others, rate: 1 / duration }
  }

  // The blend on by `delta` s, the weights handed to the actions; those left with none stopped.
  #stepBlend(delta) {
    const blend = this.#blend
    const lead = this.#action
    if (blend) {
      const weight = Math.min(this.#weight(lead) + delta * blend.rate, 1)
      this.#weights.set(lead, weight)
      for (const [other, share] of blend.others) {
        if (this.#weights.has(other)) this.#weights.set(other, share * (1 - weight))
      }
      if (weight >= 1) this.#blend = null
    }
    let total = 0
    for (const weight of this.#weights.values()) total += weight
    for (const [action, weight] of this.#weights) {
      if (weight > 0 || action === lead) {
        action.setEffectiveWeight(total > 0 ? weight / total : 1)
      } else {
        action.stop()
        this.#weights.delete(action)
      }
    }
  }

  // The walk pose's action for its phase: the standing frame, the start, or the loop.
  #gaitAction() {
    const { start, walk } = this.#actions
    if (this.gait === 'idle') return this.#idle()
    if (this.gait === 'walk') {
      if (!this.#weights.has(walk)) this.#enter(walk, params.walkPhase)
      return walk
    }
    this.gait = 'start'
    if (!this.#weights.has(start)) this.#enter(start, params.startFrom)
    return start
  }

  // The standing frame: Start Walking held at startFrom.
  #idle() {
    const idle = this.#actions.idle
    if (!this.#weights.has(idle)) this.#enter(idle, params.startFrom)
    idle.paused = true
    idle.time = params.startFrom
    return idle
  }

  // Standing, it sets off once free; at startHandoff the start hands over to the walk loop at walkPhase, blended over
  // handoffBlend s of clip time. Halted on the way, its clips slow to rest on a frame with both feet down.
  #stepGait(delta) {
    const { start, walk } = this.#actions
    if (this.gait === 'idle') {
      if (this.halted) return
      this.gait = 'start'
      this.#pace = 1
      this.#stop = null
      if (this.#weight(start) === 0) this.#enter(start, params.startFrom)
      this.#blendTo(start, params.regroupEase)
      return
    }
    if (this.gait === 'start' && start.time >= params.startHandoff) {
      this.gait = 'walk'
      if (this.#weight(walk) === 0) this.#enter(walk, params.walkPhase + (start.time - params.startHandoff))
      this.#blendTo(walk, params.handoffBlend / Math.max(params.walkSpeed, 1e-3))
    }
    this.#stepPace(delta)
  }

  // The gait clips' pace. Free, it eases back up to 1 over regroupEase. Halted, it slows the leading clip over
  // T ≥ regroupEase onto its next feet-down frame (stopOnFeet; else half a regroupEase stop on): clip speed
  // v(s) = v₀(1 − s)² + 2k·s(1 − s), s = elapsed / T, which never runs backward.
  #stepPace(delta) {
    const walking = this.gait === 'walk'
    const lead = walking ? this.#actions.walk : this.#actions.start
    const motion = walking ? this.#gaitClips.walk : this.#gaitClips.start
    const ease = Math.max(params.regroupEase, 1e-3)
    if (!this.halted) {
      this.#stop = null
      this.#pace = Math.min(this.#pace + delta / ease, 1)
      return
    }
    if (delta <= 0) return
    const rate = params.walkSpeed * (walking ? 1 : this.#startRate()) // clip s per s at pace 1
    if (!this.#stop) {
      const speed = rate * this.#pace
      if (!(speed > 1e-4)) {
        this.#pace = 0
        return
      }
      const rest = params.stopOnFeet ? motion.restAfter(lead.time, (speed * ease) / 3) : null
      const distance = rest ?? (speed * ease) / 2
      const time = Math.max(ease, distance / speed)
      this.#stop = { speed, hurry: (3 * distance) / time - speed, time, elapsed: 0 }
    }
    const stop = this.#stop
    // clip s covered s of the way through the stop
    const covered = (s) => stop.time * ((stop.speed * (1 - (1 - s) ** 3)) / 3 + stop.hurry * (s * s - (2 * s ** 3) / 3))
    const s0 = Math.min(stop.elapsed / stop.time, 1)
    stop.elapsed += delta
    const s1 = Math.min(stop.elapsed / stop.time, 1)
    this.#pace = rate > 0 ? (covered(s1) - covered(s0)) / delta / rate : 0
  }

  // How far the planted toe slid in the group's space since the last step, the clips having moved on: the lower toe,
  // 1 cm below the other and within 5 cm of the floor, the same one as last step; else null.
  #stanceStep() {
    if (this.#toes.length < 2) return null
    this.#model.updateMatrixWorld(true)
    _groupInverse.copy(this.group.matrixWorld).invert()
    const [a, b] = this.#toes.map((toe, i) =>
      _toePoints[i].setFromMatrixPosition(toe.matrixWorld).applyMatrix4(_groupInverse),
    )
    const toe = a.y < b.y ? 0 : 1
    const [low, high] = toe === 0 ? [a, b] : [b, a]
    const planted = low.y < 0.05 && high.y - low.y > 0.01
    const last = this.#stance
    const step = planted && last?.toe === toe ? _toeStep.subVectors(low, last.at) : null
    this.#stance = planted ? { toe, at: this.#stanceAt.copy(low) } : null
    return step
  }

  // × walkSpeed the start clip plays at: startSpeed where it sets off, easing to 1 by the handoff.
  #startRate() {
    const span = params.startHandoff - params.startFrom
    const time = this.#actions.start.time - params.startFrom
    return THREE.MathUtils.lerp(params.startSpeed, 1, span > 0 ? THREE.MathUtils.clamp(time / span, 0, 1) : 1)
  }

  // A new action on a clone of the stand clip, in the slot the last frozen pose doesn't hold; its footing measured.
  #frozenAction(key) {
    this.#slot ^= 1
    const old = this.#slots[this.#slot]
    if (old) {
      old.stop()
      this.mixer.uncacheClip(old.getClip())
      this.#weights.delete(old)
      this.#poseOf.delete(old)
    }
    const clip = (this.#clips[params.standClip] ?? this.#actions.idle.getClip()).clone()
    if (!this.#footing.has(key)) this.#footing.set(key, this.#measureFooting(clip, params.standTime))
    const action = (this.#slots[this.#slot] = this.mixer.clipAction(clip))
    this.#poseOf.set(action, key)
    return action
  }

  // How far the sole (SOLE under the lowest joint) lies from the lowest foot bone with `clip` alone at `time`, m: the
  // bones posed straight from its tracks, then put back.
  #measureFooting(clip, time) {
    if (this.#feet.length === 0) return 0
    this.#restoreHunch()
    const tracks = clip.tracks.map((track) => {
      const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name)
      return { track, node: THREE.PropertyBinding.findNode(this.#model, nodeName), propertyName }
    })
    const nodes = [...this.#rest.keys()]
    for (const { node } of tracks) if (node && !nodes.includes(node)) nodes.push(node)
    const saved = nodes.map((node) => [node.position.clone(), node.quaternion.clone(), node.scale.clone()])
    this.#toRest()
    const at = THREE.MathUtils.euclideanModulo(time, Math.max(clip.duration, 1e-6))
    for (const { track, node, propertyName } of tracks) {
      const target = node?.[propertyName]
      if (typeof target?.fromArray === 'function') target.fromArray(track.createInterpolant().evaluate(at))
    }
    this.#model.updateMatrixWorld(true)
    let lowest = Infinity
    for (const bone of this.#rest.keys())
      lowest = Math.min(lowest, _bonePoint.setFromMatrixPosition(bone.matrixWorld).y)
    const offset = lowest - SOLE * this.#model.scale.y - this.#footY()
    nodes.forEach((node, i) => {
      node.position.copy(saved[i][0])
      node.quaternion.copy(saved[i][1])
      node.scale.copy(saved[i][2])
    })
    this.#model.updateMatrixWorld(true)
    return offset
  }

  // The lowest foot bone's world height, from the matrices as last updated.
  #footY() {
    let lowest = Infinity
    for (const bone of this.#feet) lowest = Math.min(lowest, _bonePoint.setFromMatrixPosition(bone.matrixWorld).y)
    return Number.isFinite(lowest) ? lowest : 0
  }

  // `halted`: it starts standing, as the start's gather wants; else it sets off at once.
  reset(halted = false) {
    this.#time = 0
    this.path.reset()
    this.#key = null
    this.#cut = true
    this.#restartAt = null
    this.#knock.set(0, 0, 0)
    this.#stagger = 0
    this.gait = halted ? 'idle' : 'start'
    this.#pace = 1
    this.#stop = null
    this.#stance = null
    this.halted = halted
    this.#flinch = Infinity
    this.advance(0)
    this.velocity.set(0, 0, 0)
  }

  /** m/s its walk carries it along its heading now, blocked or not: what it shoves the doors with. */
  get walkingSpeed() {
    return params.walk && this.#key === 'walk' && this.#stagger === 0 ? this.#rootSpeed : 0
  }

  /** A hit along `direction`: the figure shoved knockback m, its walk halted for staggerTime, its spine flinching. */
  knock(direction) {
    const away = _away.copy(direction).setY(0)
    if (away.lengthSq() < 1e-8) return
    away.normalize()
    this.#knock.addScaledVector(away, params.knockback)
    this.#stagger = Math.max(this.#stagger, params.staggerTime)
    this.#flinch = 0
    this.#flinchToward.copy(away)
  }

  // The pose at this time, the root along its path and on the floor, the hunch, the bones' world matrices; the root's
  // velocity.
  advance(delta) {
    this.#restoreHunch()
    this.setPose(this.poseKey)
    const key = this.#key
    if (key === 'walk') this.#stepGait(delta)
    this.#stepBlend(delta)
    this.#time += delta
    this.#flinch += delta
    const action = this.#action
    const { idle, start, walk } = this.#actions
    if (this.frozen) {
      const sway = params.sway * Math.sin(TWO_PI * params.swayFrequency * this.#time)
      action.time = THREE.MathUtils.euclideanModulo(params.standTime + sway, Math.max(action.getClip().duration, 1e-6))
    }
    if (this.#weights.has(idle)) idle.time = params.startFrom
    start.timeScale = params.walkSpeed * this.#startRate() * this.#pace
    walk.timeScale = params.walkSpeed * this.#pace
    // the travel each gait clip covers this step, by its weight
    const from = [start.time, walk.time]
    this.mixer.update(delta)
    const gait = this.#gaitClips
    const travel =
      this.#weight(start) * gait.start.travel(from[0], start.time) +
      this.#weight(walk) * gait.walk.travel(from[1], walk.time)
    let metres = Math.max(travel, 0) * this.#model.scale.x
    // blending start into walk, the two clips plant the feet apart: the root follows the planted toe instead
    const side = _stanceSide.set(0, 0, 0)
    const step = this.#weight(start) > 0 && this.#weight(walk) > 0 ? this.#stanceStep() : (this.#stance = null)
    if (step) {
      metres = THREE.MathUtils.clamp(-step.z, 0, 3 * metres + 0.002)
      side.set(-step.x, 0, 0).applyQuaternion(this.group.quaternion)
    }
    this.#rootSpeed = delta > 0 ? metres / delta : 0
    this.#previous.copy(this.group.position)
    this.#stagger = Math.max(this.#stagger - delta, 0)
    if (key === 'walk' && params.walk && this.#stagger === 0) {
      this.path.advance(metres)
      if (step) {
        this.path.position.add(side)
        this.path.confine()
      }
    }
    // a hit's shove, eased in over about 0.1 s
    if (this.#knock.lengthSq() > 1e-10) {
      const share = 1 - Math.exp(-delta / 0.1)
      this.path.position.addScaledVector(this.#knock, share)
      this.#knock.multiplyScalar(1 - share)
      this.path.confine()
    }
    this.group.position.copy(this.path.position)
    this.group.rotation.y = this.path.heading + THREE.MathUtils.degToRad(params.yaw)
    this.group.updateMatrixWorld(true)
    // with the group at y 0; an animated pose's ground is 0, a frozen one's its footing, blended by weight
    const feet = this.#footY()
    let ground = 0
    for (const [weighted, weight] of this.#weights) {
      const pose = this.#poseOf.get(weighted)
      if (pose?.startsWith('stand:')) ground += weight * (feet + (this.#footing.get(pose) ?? 0))
    }
    this.group.position.y = -ground
    this.group.updateMatrixWorld(true)
    this.#applyHunch()
    if (delta > 0) this.velocity.subVectors(this.group.position, this.#previous).divideScalar(delta)
  }

  #restoreHunch() {
    for (const [bone, quaternion] of this.#hunchBase) bone.quaternion.copy(quaternion)
    this.#hunchBase.clear()
  }

  // Top-down, each turn about the bone's joint in world space, its children carried along.
  #applyHunch() {
    const side = reachSide()
    const flinch = this.#flinchAngle()
    const calm = this.#calmShare()
    if (!params.hunched && !side && params.armsOut === 0 && flinch === 0 && calm === 0) return
    const bones = this.#bones
    for (const name of HUNCH_BONES) {
      const bone = bones[name]
      if (bone) this.#hunchBase.set(bone, bone.quaternion.clone())
    }
    for (const bone of this.#swingMeans.keys()) this.#hunchBase.set(bone, bone.quaternion.clone())
    if (calm > 0) {
      for (const [bone, mean] of this.#swingMeans) bone.quaternion.slerp(mean, calm)
      this.#model.updateMatrixWorld(true)
    }
    const front = _front.set(0, 0, 1).applyQuaternion(this.group.quaternion)
    if (params.hunched) this.#bend(front)
    this.#spread(front)
    if (side) this.#reach(front, side)
    if (flinch !== 0) {
      for (const [name, share] of HUNCH_SPLIT) this.#tilt(bones[name], UP, this.#flinchToward, flinch * share)
      this.#tilt(bones.Head, UP, this.#flinchToward, flinch * 0.6)
    }
  }

  // How far the arms turn to their mean walking rotation: 1 − armSwing, by the walk pose's weight.
  #calmShare() {
    const weight = GAIT.reduce((sum, name) => sum + this.#weight(this.#actions[name]), 0)
    return THREE.MathUtils.clamp(1 - params.armSwing, 0, 1) * Math.min(weight, 1)
  }

  // rad the hit bends the spine away now: flinchAngle in a damped wobble, 0 once it has died down.
  #flinchAngle() {
    const t = this.#flinch
    const decay = Math.exp(-t * params.flinchDamping)
    if (!(decay > 1e-3)) return 0
    return THREE.MathUtils.degToRad(params.flinchAngle) * decay * Math.cos(TWO_PI * params.flinchFrequency * t)
  }

  // Both arms swung out from the torso by armsOut, hunched or not: a gap between the arms and the body.
  #spread(front) {
    const angle = THREE.MathUtils.degToRad(params.armsOut)
    for (const side of ['Left', 'Right']) {
      const arm = this.#bones[`${side}Arm`]
      const forearm = this.#bones[`${side}ForeArm`]
      if (arm && forearm) this.#tilt(arm, this.#direction(arm, forearm), this.#outward(front, side), angle)
    }
  }

  // The figure faces +z with its left arm on +x: the world direction away from its midline on `side`, into _out.
  #outward(front, side) {
    return _out.crossVectors(UP, front).multiplyScalar(side === 'Left' ? 1 : -1)
  }

  // The hunch: the spine bent forward, the head dropped, the shoulders slumped, the arms brought forward.
  #bend(front) {
    const bones = this.#bones
    const degrees = THREE.MathUtils.degToRad
    for (const [name, share] of HUNCH_SPLIT) this.#tilt(bones[name], UP, front, degrees(params.hunch) * share)
    this.#tilt(bones.Head, UP, front, degrees(params.headDrop))
    const slump = _down.subVectors(front, UP)
    for (const side of ['Left', 'Right']) {
      const shoulder = bones[`${side}Shoulder`]
      const arm = bones[`${side}Arm`]
      if (shoulder && arm) this.#tilt(shoulder, this.#direction(shoulder, arm), slump, degrees(params.shoulderSlump))
      const forearm = bones[`${side}ForeArm`]
      if (!arm || !forearm) continue
      this.#tilt(arm, this.#direction(arm, forearm), front, degrees(params.armsForward))
    }
  }

  // One arm aimed ahead of the chest: the upper arm swung forward from hanging straight down and turned in toward the
  // midline, drifting up and down, the forearm bent up from its line.
  #reach(front, side) {
    const bones = this.#bones
    const [arm, forearm, hand] = ['Arm', 'ForeArm', 'Hand'].map((part) => bones[`${side}${part}`])
    if (!arm || !forearm || !hand) return
    const degrees = THREE.MathUtils.degToRad
    const sway = params.reachSwayAmplitude * Math.sin(TWO_PI * params.reachSwayFrequency * this.#time)
    const swing = degrees(params.reachForward + sway)
    const across = degrees(params.reachAcross)
    const out = this.#outward(front, side)
    const ahead = _reach.copy(front).multiplyScalar(Math.cos(across)).addScaledVector(out, -Math.sin(across))
    this.#aim(arm, forearm, ahead.multiplyScalar(Math.sin(swing)).addScaledVector(UP, -Math.cos(swing)))
    const upper = _upper.copy(this.#direction(arm, forearm)).normalize()
    const axis = _bend.crossVectors(upper, UP)
    if (axis.lengthSq() < 1e-8) return
    _turn.setFromAxisAngle(axis.normalize(), degrees(params.reachElbow))
    this.#aim(forearm, hand, upper.applyQuaternion(_turn))
  }

  // Turns `bone` about its joint so the world direction to `child` points along `target`.
  #aim(bone, child, target) {
    const from = this.#direction(bone, child)
    if (from.lengthSq() < 1e-12 || target.lengthSq() < 1e-12) return
    _turn.setFromUnitVectors(from.normalize(), target.normalize())
    this.#turnAboutJoint(bone)
  }

  // Applies the world-space turn _turn to `bone` about its joint, its children carried along.
  #turnAboutJoint(bone) {
    bone.parent.getWorldQuaternion(_parent)
    bone.quaternion.premultiply(_local.copy(_parent).invert().multiply(_turn).multiply(_parent))
    bone.updateMatrixWorld(true)
  }

  // The world direction from one joint to another.
  #direction(from, to) {
    _from.setFromMatrixPosition(from.matrixWorld)
    return _bonePoint.setFromMatrixPosition(to.matrixWorld).sub(_from)
  }

  // Turns `bone` by `angle` about its joint, carrying the world direction `from` toward `toward`.
  #tilt(bone, from, toward, angle) {
    if (!bone || angle === 0) return
    _axis.crossVectors(from, toward)
    if (_axis.lengthSq() < 1e-12) return
    _turn.setFromAxisAngle(_axis.normalize(), angle)
    this.#turnAboutJoint(bone)
  }
}

// ─── The mass ────────────────────────────────────────────────────────────────

// The body's round cones on the rig, fitted once to a human mesh: [bone, end, start radius, end radius], radii in m at
// a 1.85 m figure; `end` is the bone whose joint the cone runs to, or a length in m on along the parent → bone line.
const limbs = (side) => [
  [`${side}UpLeg`, `${side}Leg`, 0.12, 0.078],
  [`${side}Leg`, `${side}Foot`, 0.086, 0.061],
  [`${side}Foot`, `${side}ToeBase`, 0.104, 0.06],
  [`${side}ToeBase`, `${side}Toe_End`, 0.054, 0.053],
]
const arms = (side) => [
  [`${side}Shoulder`, `${side}Arm`, 0.082, 0.092],
  [`${side}Arm`, `${side}ForeArm`, 0.091, 0.059],
  [`${side}ForeArm`, `${side}Hand`, 0.062, 0.04],
  [`${side}Hand`, 0.185, 0.059, 0.038],
]
const BODY = [
  ['Hips', 'Spine', 0.176, 0.147],
  ...limbs('Left'),
  ...limbs('Right'),
  ['Spine', 'Spine1', 0.143, 0.152],
  ['Spine1', 'Spine2', 0.152, 0.135],
  ['Spine2', 'Neck', 0.13, 0.06],
  ...arms('Left'),
  ...arms('Right'),
  ['Neck', 'Head', 0.045, 0.074],
  ['Head', 'HeadTop_End', 0.117, 0.083],
]

// BODY on the figure as it stands, scaled to figureHeight: each cone in its bone's space.
function bodyCones(figure) {
  const { rig } = figure
  const scale = params.figureHeight / 1.85
  const joint = (bone) => new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld)
  return BODY.map(([name, to, startRadius, endRadius]) => {
    const bone = rig[name]
    const start = joint(bone)
    const end =
      typeof to === 'string'
        ? joint(rig[to])
        : start.clone().add(
            start
              .clone()
              .sub(joint(bone.parent))
              .setLength(to * scale),
          )
    const toLocal = bone.matrixWorld.clone().invert()
    return {
      name,
      startBone: bone,
      start: start.applyMatrix4(toLocal),
      end: end.applyMatrix4(toLocal),
      startRadius: startRadius * scale,
      endRadius: endRadius * scale,
    }
  })
}

// The BodyField settings the params drive.
function fieldSettings() {
  return {
    floor: 0,
    coreMargin: 0, // the worms collide with the thin cores instead
    smoothing: params.fieldSmoothing,
    inflateTop: params.inflateTop,
    inflateBottom: params.inflateBottom,
    inflateFalloff: params.inflateFalloff,
    maxBodySpeed: params.maxBodySpeed,
    cullDistance: params.cullDistance,
    jumpDistance: params.jumpDistance,
  }
}

// The body the worms make: the figure's fitted cones, each fattened by its part's offset, plus the bulk cones (hump,
// belly, yoke, scruff, webs, skirt, skull, hem), as one BodyField; thin capsules along the fitted bones (cores)
// for the worms to drape over; and the capsules their homes lie on (anchors), every cone but the feet's. The bulk
// cones are placed in the rest pose and ride the skeleton.
class WormMass {
  field
  /** Capsule[]: the worms' colliders, coreShare × each fitted cone's mean radius, never through the floor. */
  cores = []
  /** Capsule[]: in world space, the cone's axis and its mean radius + inflateTop. */
  anchors = []
  /** Uint8Array: each anchor's REGION. */
  regions
  /** string[]: each anchor's cone name. */
  names
  /** Uint8Array: 1 where an anchor's end stood higher than its start at the build. */
  rising
  /** number[]: each anchor's cone in the field. */
  anchorCones = []
  /** World space: the top of the head, the highest point of its cones. */
  crown = new THREE.Vector3()
  #fitted
  #bones = {}
  #joints = {} // rest-pose world joints, by bone name
  #toLocal = {} // rest-pose world → bone space, by bone name
  #front = new THREE.Vector3()
  #bulk
  #coreCones = [] // [cone, mean fitted radius] per core

  /** Built in the rest pose, then posed as the figure stands now. */
  static fromFigure(figure) {
    figure.restPose()
    return new WormMass(figure, bodyCones(figure))
  }

  // `figure` in its rest pose, `fitted` its body cones.
  constructor(figure, fitted) {
    this.#fitted = fitted.map((cone) => ({ ...cone }))
    const named = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Head', 'LeftShoulder', 'RightShoulder', 'LeftArm', 'RightArm']
    for (const name of named) {
      const bone = figure.rig[name]
      if (!bone) throw new Error(`[worm-monster] the rig has no bone "${name}"`)
      this.#bones[name] = bone
      this.#joints[name] = new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld)
      this.#toLocal[name] = bone.matrixWorld.clone().invert()
    }
    // the figure faces +z: its left arm is on +x
    this.#front.subVectors(this.#joints.LeftArm, this.#joints.RightArm).cross(UP).normalize()
    this.#bulk = Object.fromEntries(BULK.map((key) => [key, params[key]]))
    const cones = this.#cones()
    this.field = new BodyField(cones, fieldSettings())
    figure.advance(0)
    this.field.update(0)
    cones.forEach((cone, i) => {
      if (FOOT_BONES.includes(cone.name)) return
      this.anchorCones.push(i)
      this.anchors.push(new Capsule(new THREE.Vector3(), new THREE.Vector3(), 0))
      if (i >= this.#fitted.length) return
      this.#coreCones.push([i, (this.#fitted[i].startRadius + this.#fitted[i].endRadius) / 2])
      this.cores.push(new Capsule(new THREE.Vector3(), new THREE.Vector3(), 0))
    })
    this.regions = Uint8Array.from(this.anchorCones, (i) => regionOf(cones[i].name))
    this.names = this.anchorCones.map((i) => cones[i].name)
    this.#sync()
    this.rising = Uint8Array.from(this.anchors, (anchor) => (anchor.end.y > anchor.start.y ? 1 : 0))
  }

  /** The anchor a world point lies along, at `t` from its start: into `target`. */
  pointOn(anchor, t, target) {
    const { start, end } = this.anchors[anchor]
    return target.lerpVectors(start, end, t)
  }

  // Breathing, the field at the figure's pose now, the cores and anchors along it.
  update(delta, time) {
    const field = this.field
    Object.assign(field, fieldSettings())
    // swells out from the rest field and back, never inside it: the worms settle on the rest surface
    const swell = 0.5 - 0.5 * Math.cos(TWO_PI * params.breatheFrequency * time)
    field.inflateTop = params.inflateTop + params.breathe * swell
    field.update(delta)
    this.#sync()
  }

  // New offsets and bulk sizes, same cones: copied into the field, which reads the pose again, still.
  reshape() {
    this.field.copy(new BodyField(this.#cones(), fieldSettings()))
    this.#sync()
  }

  // The room the worms can fill now: the field's volume by 10 cm layers, less the cores'.
  measure() {
    const layers = Math.ceil((this.field.boundingSphere.center.y + this.field.boundingSphere.radius) / 0.1)
    const field = this.field.volumeByHeight(0.1, Math.max(layers, 1)).reduce((sum, v) => sum + v, 0)
    let cores = 0
    for (const { start, end, radius } of this.cores) {
      cores += Math.PI * radius ** 2 * start.distanceTo(end) + (4 / 3) * Math.PI * radius ** 3
    }
    return Math.max(field - cores, 1e-6)
  }

  dispose() {
    this.field.dispose()
  }

  // The field's cones: fitted, with offsets (and reachOffset on the reaching forearm and hand), then the bulk.
  #cones() {
    const side = reachSide()
    const reaching = (name) => side !== null && (name === `${side}ForeArm` || name === `${side}Hand`)
    const cones = this.#fitted.map((cone) => {
      const add = (params[`${partOf(cone.name)}Offset`] ?? 0) + (reaching(cone.name) ? params.reachOffset : 0)
      return {
        ...cone,
        startRadius: Math.max(0, cone.startRadius + add),
        endRadius: Math.max(0, cone.endRadius + add),
      }
    })
    const joint = (name) => this.#joints[name].clone()
    const front = this.#front
    const add = (name, startBone, endBone, start, end, startRadius, endRadius) =>
      cones.push({
        name,
        startBone: this.#bones[startBone],
        endBone: this.#bones[endBone],
        start: start.applyMatrix4(this.#toLocal[startBone]),
        end: end.applyMatrix4(this.#toLocal[endBone]),
        startRadius: Math.max(0, startRadius),
        endRadius: Math.max(0, endRadius),
      })
    // a sphere: a capsule 2 cm long
    const ball = (name, bone, center, radius) =>
      add(name, bone, bone, center.clone().addScaledVector(UP, -0.01), center.addScaledVector(UP, 0.01), radius, radius)
    const bulk = this.#bulk
    // Spine1 is the middle of the rig's three spine bones (Spine sits just above the hips)
    if (bulk.hump) {
      const center = joint('Spine1').addScaledVector(front, -params.humpBack).addScaledVector(UP, params.humpUp)
      ball('hump', 'Spine1', center, params.humpRadius)
    }
    if (bulk.belly) {
      const center = joint('Spine').addScaledVector(front, params.bellyForward).addScaledVector(UP, -params.bellyDown)
      ball('belly', 'Spine', center, params.bellyRadius)
    }
    // riding the collarbones, not the arms: a reaching or swinging arm leaves the shoulders square
    if (bulk.yoke) {
      const [left, right] = [joint('LeftArm'), joint('RightArm')]
      const middle = left.clone().add(right).multiplyScalar(0.5)
      const [start, end] = [left, right].map((point) =>
        point.sub(middle).multiplyScalar(params.yokeSpan).add(middle).addScaledVector(UP, -params.yokeDown),
      )
      add('yoke', 'LeftShoulder', 'RightShoulder', start, end, params.yokeRadius, params.yokeRadius)
    }
    if (bulk.scruff) {
      const lift = (point) => point.addScaledVector(UP, params.scruffUp).addScaledVector(front, params.scruffForward)
      const [start, end] = [lift(joint('Spine2')), lift(joint('Head'))]
      add('scruff', 'Spine2', 'Head', start, end, params.scruffStartRadius, params.scruffEndRadius)
    }
    if (bulk.webs) {
      for (const side of ['Left', 'Right']) {
        const arm = `${side}Arm`
        const [start, end] = [joint(arm), joint('Spine1')]
        add(`web ${side.toLowerCase()}`, arm, 'Spine1', start, end, params.webStartRadius, params.webEndRadius)
      }
    }
    // from the hips to the floor, both ends riding the hips
    if (bulk.skirt) {
      const top = joint('Hips').addScaledVector(UP, params.skirtUp)
      const foot = joint('Hips').setY(0).addScaledVector(front, -params.skirtBack)
      add('skirt', 'Hips', 'Hips', top, foot, params.skirtTopRadius, params.skirtBottomRadius)
    }
    if (bulk.skull) {
      const center = joint('Head').addScaledVector(UP, params.skullUp).addScaledVector(front, params.skullForward)
      ball('skull', 'Head', center, params.skullRadius)
    }
    if (bulk.hem) {
      const foot = joint('Hips').setY(0).addScaledVector(front, -params.skirtBack)
      const top = foot.clone().setY(params.hemHeight)
      add('hem', 'Hips', 'Hips', top, foot, params.hemTopRadius, params.hemRadius)
    }
    return cones
  }

  // Cores and anchors from the field's capsules (its cones' axes now).
  #sync() {
    const { colliders, cones } = this.field
    this.#coreCones.forEach(([i, radius], k) => {
      const core = this.cores[k]
      const { start, end } = colliders[i]
      core.start.copy(start)
      core.end.copy(end)
      core.radius = Math.max(0, Math.min(params.coreShare * radius, start.y, end.y))
    })
    this.anchorCones.forEach((i, k) => {
      const anchor = this.anchors[k]
      anchor.start.copy(colliders[i].start)
      anchor.end.copy(colliders[i].end)
      anchor.radius = (cones[i].startRadius + cones[i].endRadius) / 2 + params.inflateTop
    })
    const { center, radius } = this.field.boundingSphere
    this.crown.set(center.x, center.y + radius, center.z)
    let top = -Infinity
    cones.forEach((cone, i) => {
      if (regionOf(cone.name) !== REGION.head) return
      for (const [point, r] of [
        [colliders[i].start, cone.startRadius],
        [colliders[i].end, cone.endRadius],
      ]) {
        if (point.y + r <= top) continue
        top = point.y + r
        this.crown.set(point.x, top + this.field.inflateTop, point.z)
      }
    })
  }
}

// ─── The core ────────────────────────────────────────────────────────────────

// Sets `v` to (x, y, z, w); true when a component changed (by Object.is: −0 is not 0).
function setChanged(v, x, y, z, w) {
  if (Object.is(v.x, x) && Object.is(v.y, y) && Object.is(v.z, z) && Object.is(v.w, w)) return false
  v.set(x, y, z, w)
  return true
}

const uCoreColor = uniform(new THREE.Color()).onFrameUpdate(() => uCoreColor.value.set(params.coreColor))
const uCoreRoughness = uniform(0).onFrameUpdate(() => params.coreRoughness)

// One capsule per cone, for WormCore: each vertex's unit direction from the axis in a frame whose axis is +y, as its
// position and normal, the end it rides (coreAlong: 0 start, 1 end) and its cone (coreCone).
class WormCoreGeometry extends THREE.BufferGeometry {
  constructor(count, radialSegments, capSegments) {
    super()
    this.type = 'WormCoreGeometry'
    this.parameters = { count, radialSegments, capSegments }
    const radial = Math.max(3, Math.round(radialSegments))
    const caps = Math.max(1, Math.round(capSegments))
    // rows from the start pole (polar angle 0, down −y) to the end pole (π)
    const rows = []
    for (let i = 0; i <= caps; i++) rows.push([0, (Math.PI / 2) * (i / caps)])
    for (let i = 0; i <= caps; i++) rows.push([1, (Math.PI / 2) * (1 + i / caps)])
    const perCone = rows.length * radial
    const direction = new Float32Array(3 * count * perCone)
    const along = new Float32Array(count * perCone)
    const cone = new Float32Array(count * perCone)
    const index = []
    for (let c = 0; c < count; c++) {
      const base = c * perCone
      rows.forEach(([end, polar], r) => {
        for (let j = 0; j < radial; j++) {
          const azimuth = (TWO_PI * j) / radial
          const v = base + r * radial + j
          direction[3 * v] = Math.sin(polar) * Math.cos(azimuth)
          direction[3 * v + 1] = -Math.cos(polar)
          direction[3 * v + 2] = Math.sin(polar) * Math.sin(azimuth)
          along[v] = end
          cone[v] = c
        }
      })
      for (let r = 0; r + 1 < rows.length; r++) {
        for (let j = 0; j < radial; j++) {
          const a = base + r * radial + j
          const b = a + radial
          const a1 = base + r * radial + ((j + 1) % radial)
          const b1 = a1 + radial
          index.push(a, b, a1, a1, b, b1)
        }
      }
    }
    this.setAttribute('position', new THREE.BufferAttribute(direction, 3))
    this.setAttribute('normal', new THREE.BufferAttribute(direction.slice(), 3))
    this.setAttribute('coreAlong', new THREE.BufferAttribute(along, 1))
    this.setAttribute('coreCone', new THREE.BufferAttribute(cone, 1))
    this.setIndex(index)
  }
}

// Near-black flesh inside the worms, so the gaps between them show shadow rather than the room: one round cone
// per anchor, coreInset inside the field's surface, grown from its axis as that anchor's HELD worms come home (to
// smoothstep(coreFillMin, coreFillMax) of the share home) and shrunk fast when they leave, so a blast strips it before
// it stands bare. A child of the worms, hidden with them. Its passes (computeNodes) run once a frame while time moves:
// after the worms' substeps in their batch (extraPasses.after), alone on a frame the worms don't step.
class WormCore extends THREE.Mesh {
  #mass
  #slots
  #cones
  #uniforms
  #fill
  #expected
  #anchorOf
  #heldOf
  #storage
  #particles
  #passes
  #renderer = null

  constructor(mass, worms, homes) {
    const count = mass.anchors.length
    const slots = Array.from({ length: 2 * Math.max(count, 1) }, () => new THREE.Vector4())
    const cones = changingArray(slots, 'vec4').setName('core_cones')
    const u = {
      inset: uniform(0).setName('core_inset'),
      reach: uniform(0).setName('core_reach'),
      fillMin: uniform(0).setName('core_fillMin'),
      fillMax: uniform(1).setName('core_fillMax'),
      grow: uniform(0).setName('core_grow'),
      shrink: uniform(0).setName('core_shrink'),
      bodyCount: uniform(1).setName('core_bodyCount'),
      inflateTop: uniform(0).setName('core_inflateTop'),
      inflateBottom: uniform(0).setName('core_inflateBottom'),
      inflateFalloff: uniform(1).setName('core_inflateFalloff'),
      floor: uniform(0).setName('core_floor'),
      fade: uniform(1).setName('core_fade'),
      toWorld: uniform(new THREE.Matrix4()).setName('core_toWorld'),
    }
    const counts = instancedArray(new Uint32Array(Math.max(count, 1)), 'uint')
      .setName('core_counts')
      .toAtomic()
    const fill = instancedArray(new Float32Array(Math.max(count, 1)), 'float').setName('core_fill')
    const expected = instancedArray(new Float32Array(Math.max(count, 1)), 'float').setName('core_expected')
    const anchorOf = instancedArray(new Int32Array(worms.count), 'int').setName('core_anchorOf')
    const heldOf = instancedArray(new Int32Array(worms.count), 'int').setName('core_heldOf')

    const material = new THREE.MeshStandardNodeMaterial({ name: 'worm core' })
    material.colorNode = uCoreColor
    material.roughnessNode = uCoreRoughness
    material.positionNode = Fn((builder) => {
      const c = int(attribute('coreCone', 'float')).toVar()
      const a = cones.element(c.mul(2)).toVar()
      const b = cones.element(c.mul(2).add(1)).toVar()
      const ab = b.xyz.sub(a.xyz).toVar()
      const span = length(ab)
      const axis = select(span.greaterThan(1e-6), ab.div(max(span, 1e-6)), vec3(0, 1, 0)).toVar()
      const reference = select(abs(axis.y).lessThan(0.99), vec3(0, 1, 0), vec3(1, 0, 0))
      const side = normalize(cross(reference, axis)).toVar()
      const other = cross(side, axis)
      const local = positionGeometry
      const direction = side.mul(local.x).add(axis.mul(local.y)).add(other.mul(local.z)).toVar()
      const along = attribute('coreAlong', 'float')
      const center = mix(a.xyz, b.xyz, along).toVar()
      const height = max(center.y.sub(u.floor), 0)
      const inflate = u.inflateTop.add(
        u.inflateBottom.sub(u.inflateTop).mul(exp(height.div(max(u.inflateFalloff, 1e-6)).negate())),
      )
      const grow = smoothstep(u.fillMin, u.fillMax, fill.element(c)).mul(smoothstep(0, u.fade, height))
      const radius = max(mix(a.w, b.w, along).add(inflate).sub(u.inset), 0).mul(grow)
      normalLocal.assign(direction)
      const position = center.add(direction.mul(radius)).toVar()
      // still for the motion blur: it moves with the body, slowly
      if (builder.needsPreviousData()) positionPrevious.assign(position)
      return position
    })()
    // node values collapse in three's render cache keys: each build's core keeps its own bindings
    const baseKey = material.customProgramCacheKey.bind(material)
    super(new WormCoreGeometry(count, params.coreRadialSegments, params.coreCapSegments), material)
    material.customProgramCacheKey = () => `${baseKey()}|WormCore:${this.uuid}`
    this.name = 'worm core'
    this.type = 'WormCore'
    this.frustumCulled = false
    this.castShadow = false
    this.receiveShadow = true
    this.#mass = mass
    this.#slots = slots
    this.#cones = cones
    this.#uniforms = u
    this.#fill = fill
    this.#expected = expected
    this.#anchorOf = anchorOf
    this.#heldOf = heldOf
    this.#storage = [counts, fill, expected, anchorOf, heldOf]
    this.#particles = worms.particlesPerNoodle

    const P = worms.particlesPerNoodle
    const { positions } = worms.nodes.buffers
    const offset = uint(worms.wormDataOffset)
    // a HELD worm counts for its anchor while its held particle lies within reach outside that anchor's cone
    const tally = Fn(() => {
      const m = instanceIndex
      const anchor = anchorOf.element(m).toVar()
      If(anchor.greaterThanEqual(0), () => {
        const state = worms.wormData.element(offset.add(m.mul(6))).x
        If(state.greaterThan(WormState.HELD - 0.5), () => {
          const held = m.mul(P).add(uint(heldOf.element(m)))
          const x = u.toWorld.mul(vec4(positions.element(held).xyz, 1)).xyz.toVar()
          const a = cones.element(anchor.mul(2)).toVar()
          const b = cones.element(anchor.mul(2).add(1)).toVar()
          const ab = b.xyz.sub(a.xyz).toVar()
          const t = clamp(dot(x.sub(a.xyz), ab).div(max(dot(ab, ab), 1e-9)), 0, 1).toVar()
          const gap = length(x.sub(a.xyz.add(ab.mul(t))))
            .sub(mix(a.w, b.w, t))
            .sub(u.inflateTop)
          If(gap.lessThan(u.reach), () => {
            atomicAdd(counts.element(anchor), uint(1))
          })
        })
      })
    })()
      .compute(worms.count)
      .setName('coreTally')
    const resolve = Fn(() => {
      const c = instanceIndex
      const total = float(0).toVar()
      Loop(count, ({ i }) => {
        total.addAssign(float(atomicLoad(counts.element(i))))
      })
      const homed = expected.element(c)
      const body = total.div(max(u.bodyCount, 1)).toVar()
      const share = select(homed.greaterThan(0.5), float(atomicLoad(counts.element(c))).div(max(homed, 1)), body)
      const target = min(min(share, body), 1).toVar()
      const grown = fill.element(c)
      grown.assign(mix(grown, target, select(target.lessThan(grown), u.shrink, u.grow)))
    })()
      .compute(Math.max(count, 1))
      .setName('coreResolve')
    const clear = Fn(() => {
      atomicStore(counts.element(instanceIndex), uint(0))
    })()
      .compute(Math.max(count, 1))
      .setName('coreClear')
    this.#passes = [tally, resolve, clear]
    this.syncHomes(homes)
  }

  // Each worm's anchor and held particle, and how many worms each anchor homes, after the homes change.
  syncHomes(homes) {
    const anchorOf = this.#anchorOf.value
    anchorOf.array.set(homes.anchorOf)
    anchorOf.needsUpdate = true
    const heldOf = this.#heldOf.value
    const last = this.#particles - 1
    heldOf.array.forEach((_, m) => {
      const k = Math.round(THREE.MathUtils.clamp(homes.grip[m], 0, 1) * last)
      heldOf.array[m] = homes.reversed[m] ? last - k : k
    })
    heldOf.needsUpdate = true
    const expected = this.#expected.value
    expected.array.fill(0)
    let body = 0
    for (const anchor of homes.anchorOf) {
      if (anchor < 0 || anchor >= expected.array.length) continue
      expected.array[anchor]++
      body++
    }
    expected.needsUpdate = true
    this.#uniforms.bodyCount.value = Math.max(body, 1)
    return this
  }

  // Shrunk to nothing: after a replay, before the worms gather again.
  reset() {
    const fill = this.#fill.value
    fill.array.fill(0)
    fill.needsUpdate = true
    return this
  }

  /** The tally, the growth and the counts' clear: once a frame while time moves, after the worms' substeps. */
  get computeNodes() {
    return this.#passes
  }

  // What its passes read this frame: the cones at the field's pose now, and the growth over `delta` seconds.
  update(renderer, delta) {
    this.#renderer ??= renderer
    const field = this.#mass.field
    const { colliders, cones } = field
    const slots = this.#slots
    const anchorCones = this.#mass.anchorCones
    let moved = false
    for (let k = 0; k < anchorCones.length; k++) {
      const i = anchorCones[k]
      const { start, end } = colliders[i]
      if (setChanged(slots[2 * k], start.x, start.y, start.z, cones[i].startRadius)) moved = true
      if (setChanged(slots[2 * k + 1], end.x, end.y, end.z, cones[i].endRadius)) moved = true
    }
    if (moved) changed(this.#cones)
    const u = this.#uniforms
    u.inset.value = params.coreInset
    u.reach.value = params.coreReach
    u.fillMin.value = Math.min(params.coreFillMin, params.coreFillMax - 1e-3)
    u.fillMax.value = params.coreFillMax
    u.grow.value = 1 - Math.exp(-params.coreGrowRate * Math.max(delta, 0))
    u.shrink.value = 1 - Math.exp(-params.coreShrinkRate * Math.max(delta, 0))
    u.inflateTop.value = field.inflateTop
    u.inflateBottom.value = field.inflateBottom
    u.inflateFalloff.value = field.inflateFalloff
    u.floor.value = field.floor
    u.fade.value = Math.max(params.coreFade, 1e-3)
    this.parent?.updateWorldMatrix(true, false)
    u.toWorld.value.copy(this.parent?.matrixWorld ?? _identity)
    return this
  }

  dispose() {
    this.geometry.dispose()
    this.material.dispose()
    for (const pass of this.#passes) {
      try {
        pass.dispose()
      } catch {
        // never compiled
      }
    }
    // A compute node's dispose frees its uniforms, not its storage buffers.
    const renderer = this.#renderer
    if (!renderer) return
    const { backend, info, _attributes: attributes } = renderer
    for (const node of this.#storage) {
      const attribute = node.value
      if (!backend.has(attribute) || !backend.get(attribute).buffer) continue
      if (!attributes?.delete(attribute)) {
        backend.destroyAttribute(attribute)
        info.destroyAttribute(attribute)
      }
    }
  }
}

// ─── Start layouts ───────────────────────────────────────────────────────────

// Seeded uniform random numbers (mulberry32).
class Random {
  #state
  constructor(seed) {
    this.#state = seed >>> 0
  }
  next() {
    let t = (this.#state = (this.#state + 0x6d2b79f5) >>> 0)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  range(a, b) {
    return a + (b - a) * this.next()
  }
}

// Placed particles in a spatial hash: a candidate fits where it is at least `gap` × the sum of the two radii from
// every other worm's particles.
class ParticleHash {
  #cells = new Map()
  #size

  constructor(cellSize) {
    this.#size = cellSize
  }
  #key(x, y, z) {
    return ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512)
  }
  add(p, radius) {
    const s = this.#size
    const key = this.#key(Math.floor(p.x / s), Math.floor(p.y / s), Math.floor(p.z / s))
    let cell = this.#cells.get(key)
    if (!cell) this.#cells.set(key, (cell = []))
    cell.push(p.x, p.y, p.z, radius)
  }
  fits(p, radius, gap) {
    const s = this.#size
    const cx = Math.floor(p.x / s)
    const cy = Math.floor(p.y / s)
    const cz = Math.floor(p.z / s)
    for (let x = cx - 1; x <= cx + 1; x++) {
      for (let y = cy - 1; y <= cy + 1; y++) {
        for (let z = cz - 1; z <= cz + 1; z++) {
          const cell = this.#cells.get(this.#key(x, y, z))
          if (!cell) continue
          for (let i = 0; i < cell.length; i += 4) {
            const min = gap * (radius + cell[i + 3])
            const dx = p.x - cell[i]
            const dy = p.y - cell[i + 1]
            const dz = p.z - cell[i + 2]
            if (dx * dx + dy * dy + dz * dz < min * min) return false
          }
        }
      }
    }
    return true
  }
}

const _segment = new THREE.Vector3()
const _toPoint = new THREE.Vector3()
const _middle = new THREE.Vector3()
// How far p is outside a Capsule's surface.
function capsuleClearance(p, capsule) {
  _segment.subVectors(capsule.end, capsule.start)
  _toPoint.subVectors(p, capsule.start)
  const t = THREE.MathUtils.clamp(_toPoint.dot(_segment) / Math.max(_segment.lengthSq(), 1e-12), 0, 1)
  return _toPoint.addScaledVector(_segment, -t).length() - capsule.radius
}

// Tries per worm before it is left out: the straighter the walks, the more miss a bounded spot.
const LAY_ATTEMPTS = 200

// The worms' starting curves, head first, and roles (0 body, 1 stray): smooth random walks lying flat, those on the
// floor `hover` m over it, at most maxTurn per joint, none closer than `gap` × the sum of two radii to another, every
// particle where `inside` allows (in the restroom, clear of its fixtures and the cores). Each worm's length is drawn
// from `lengths`; its spans are equal.
class WormSpill {
  curves = []
  roles = []
  #random
  #hash
  #radii
  #thickness
  #gap
  #maxTurn
  #inside
  #hover
  #deadline

  constructor(radii, { seed, gap, maxTurn, budget, inside, hover = 0 }) {
    this.#radii = radii
    this.#hover = hover
    this.#thickness = 2 * Math.max(...radii)
    this.#gap = gap
    this.#maxTurn = THREE.MathUtils.degToRad(maxTurn)
    this.#inside = inside
    this.#random = new Random(seed)
    this.#hash = new ParticleHash(Math.max(2 * gap * Math.max(...radii), 1e-3))
    this.#deadline = performance.now() + budget
  }

  get count() {
    return this.curves.length
  }

  /** Each worm's head, where its curve starts. */
  heads() {
    return this.curves.map((curve) => curve.getPoint(0))
  }

  // `count` worms on the floor, heads `inner`–`outer` m from `center`, denser near it when `falloff` (∝ 1 − ρ/outer),
  // in up to `layers` layers, each 1.8 radii over the last.
  heap(center, count, { inner, outer, layers, lengths, falloff = true }) {
    const random = this.#random
    let placed = 0
    for (let n = 0; n < count && !this.#overBudget(); n++) {
      for (let attempt = 0; attempt < LAY_ATTEMPTS; attempt++) {
        const rho = this.#radius(inner, outer, falloff)
        const angle = random.range(0, TWO_PI)
        const head = new THREE.Vector3(center.x + Math.sin(angle) * rho, 0, center.z + Math.cos(angle) * rho)
        const heading = random.range(0, TWO_PI)
        const span = this.#span(lengths)
        let points = null
        for (let layer = 0; layer < layers && !points; layer++) {
          points = this.#lay(head, heading, span, this.#hover + 0.9 * this.#thickness * layer)
        }
        if (!points) continue
        this.#add(points, 0)
        placed++
        break
      }
    }
    return placed
  }

  // `count` strays on the floor along the aisle, `left`–`right` in x, `inner`–`outer` m from `center` in z, `behind` of
  // them on its far side.
  strays(center, count, { inner, outer, behind, left, right, lengths, clusters = 0, clusterRadius = 0.35 }) {
    const random = this.#random
    const spot = () => {
      const along = random.range(inner, outer)
      const z = center.z + (random.next() < behind ? -along : along)
      return new THREE.Vector3(random.range(left, right), 0, z)
    }
    // knots: each worm coiled within clusterRadius of its knot's point, or laid anywhere once it no longer fits
    const knots = Array.from({ length: clusters }, spot)
    let placed = 0
    for (let n = 0; n < count && !this.#overBudget(); n++) {
      const knot = knots.length > 0 ? knots[n % knots.length] : null
      for (let attempt = 0; attempt < LAY_ATTEMPTS; attempt++) {
        const coiled = knot !== null && attempt < (2 * LAY_ATTEMPTS) / 3
        const head = coiled
          ? new THREE.Vector3(random.range(-1, 1), 0, random.range(-1, 1)).multiplyScalar(clusterRadius * 0.7).add(knot)
          : spot()
        if (coiled) head.x = THREE.MathUtils.clamp(head.x, left, right)
        const span = this.#span(lengths)
        const heading = random.range(0, TWO_PI)
        const points = coiled
          ? this.#lay(head, heading, span, this.#hover, knot, clusterRadius)
          : this.#lay(head, heading, span, this.#hover)
        if (!points) continue
        this.#add(points, 1)
        placed++
        break
      }
    }
    return placed
  }

  // `count` worms lying flat `bottom`–`top` m up within `radius` of `center`: a rain onto the figure.
  ceiling(center, count, { bottom, top, radius, lengths }) {
    const random = this.#random
    let placed = 0
    for (let n = 0; n < count && !this.#overBudget(); n++) {
      for (let attempt = 0; attempt < LAY_ATTEMPTS; attempt++) {
        const angle = random.range(0, TWO_PI)
        const rho = radius * Math.sqrt(random.next())
        const head = new THREE.Vector3(center.x + Math.sin(angle) * rho, 0, center.z + Math.cos(angle) * rho)
        const lift = random.range(bottom, Math.max(bottom, top))
        const points = this.#lay(head, random.range(0, TWO_PI), this.#span(lengths), lift, center, radius)
        if (!points) continue
        this.#add(points, 0)
        placed++
        break
      }
    }
    return placed
  }

  #overBudget() {
    return performance.now() > this.#deadline
  }

  // ρ in [inner, outer] with density ∝ ρ, × (1 − ρ/outer) when `falloff`.
  #radius(inner, outer, falloff) {
    const random = this.#random
    const peak = falloff ? Math.max(outer / 4, inner * (1 - inner / outer)) : outer
    for (let tries = 0; tries < 64; tries++) {
      const rho = random.range(inner, outer)
      const density = falloff ? rho * (1 - rho / outer) : rho
      if (random.next() * peak <= density) return rho
    }
    return random.range(inner, outer)
  }

  #span([min, max, skew = 1]) {
    const length = min + (Math.max(min, max) - min) * this.#random.next() ** Math.max(skew, 1e-3)
    return length / (this.#radii.length - 1)
  }

  // A smooth random walk from `head` along `heading` (rad about y from +z), each particle `lift` over where it would
  // touch the floor, within `bound` m of `center` if given; null if it doesn't fit.
  #lay(head, heading, span, lift, center = null, bound = Infinity) {
    const radii = this.#radii
    const random = this.#random
    const maxTurn = this.#maxTurn
    const within = (p) => !center || Math.hypot(p.x - center.x, p.z - center.z) <= bound
    const first = new THREE.Vector3(head.x, radii[0] + lift, head.z)
    if (!within(first) || !this.#fits(first, 0, [])) return null
    const points = [first]
    let direction = heading
    let bend = 0
    for (let k = 1; k < radii.length; k++) {
      let next = null
      for (let tries = 0; tries < 12 && !next; tries++) {
        // bends persist, so the walk curves rather than zigzags; retries turn anywhere within maxTurn
        const turn =
          tries === 0
            ? THREE.MathUtils.clamp(0.7 * bend + random.range(-0.6, 0.6) * maxTurn, -maxTurn, maxTurn)
            : random.range(-maxTurn, maxTurn)
        const angle = direction + turn
        const p = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle)).multiplyScalar(span).add(points[k - 1])
        p.y = radii[k] + lift
        if (within(p) && this.#fits(p, k, points)) {
          next = p
          direction = angle
          bend = turn
        }
      }
      if (!next) return null
      points.push(next)
    }
    return points
  }

  // Cheapest first: the others' particles, the span to the last one, this worm's own, then `inside`.
  #fits(p, k, points) {
    const radii = this.#radii
    const gap = this.#gap
    if (!this.#hash.fits(p, radii[k], gap)) return false
    if (k > 0) {
      const middle = _middle.addVectors(points[k - 1], p).multiplyScalar(0.5)
      if (!this.#hash.fits(middle, (radii[k - 1] + radii[k]) / 2, gap)) return false
    }
    for (let j = 0; j < k - 2; j++) {
      const min = gap * (radii[k] + radii[j])
      if (p.distanceToSquared(points[j]) < min * min) return false
    }
    return this.#inside(p, radii[k])
  }

  #add(points, role) {
    const radii = this.#radii
    for (let k = 0; k < points.length; k++) {
      this.#hash.add(points[k], radii[k])
      if (k === 0) continue
      this.#hash.add(points[k - 1].clone().add(points[k]).multiplyScalar(0.5), (radii[k - 1] + radii[k]) / 2)
    }
    const path = new THREE.CurvePath()
    for (let k = 1; k < points.length; k++) path.add(new THREE.LineCurve3(points[k - 1], points[k]))
    this.curves.push(path)
    this.roles.push(role)
  }
}

// ─── Homes ───────────────────────────────────────────────────────────────────

const _home = new THREE.Vector3()
const _ring = new THREE.Vector3()
const _side = new THREE.Vector3()
const _across = new THREE.Vector3()
const _anchorAxis = new THREE.Vector3()

// The share of a leg anchor's height within the legs' home band [legHomeMin, legHomeMax].
function legBand(start, end) {
  const low = Math.min(start.y, end.y)
  const high = Math.max(start.y, end.y)
  if (high - low < 1e-3) return low >= params.legHomeMin && low <= params.legHomeMax ? 1 : 0
  const inside = Math.min(high, params.legHomeMax) - Math.max(low, params.legHomeMin)
  return THREE.MathUtils.clamp(inside / (high - low), 0, 1)
}

// t along a leg anchor at a random height within the legs' home band, or at the band's nearest height on it.
function legAt({ start, end }, random) {
  const rise = end.y - start.y
  if (Math.abs(rise) < 1e-3) return random.next()
  const low = Math.min(start.y, end.y)
  const high = Math.max(start.y, end.y)
  const from = THREE.MathUtils.clamp(params.legHomeMin, low, high)
  const to = THREE.MathUtils.clamp(params.legHomeMax, low, high)
  return (random.range(from, to) - start.y) / rise
}

// Each worm's home on an anchor and how it takes the pull, per region: short worms on the head, the longest in
// the cloak and dangling off the hands, a heap round the feet. Homes are drawn ∝ each anchor's size × its region's
// bias and paired with the worms by azimuth, so each rises on its own side; lower homes wake first.
class HomeAssigner {
  anchorOf
  anchorAt
  slack
  weight
  tail
  tailStart
  reversed
  hangShare
  flattenShare
  grip
  hangLevel
  /** Uint8Array: the home's REGION, or REGION.none for a worm without one. */
  regions
  /** Float32Array: each worm's starting cooldown, s; one without a home never wakes. */
  wake
  /** Float32Array: m above the floor each worm's home lies at, in the build pose; 0 without one. */
  height
  /** m: the highest home. */
  top = 0

  constructor(count) {
    this.anchorOf = new Int32Array(count)
    this.anchorAt = new Float32Array(count)
    this.slack = new Float32Array(count)
    this.weight = new Float32Array(count)
    this.tail = new Float32Array(count)
    this.tailStart = new Float32Array(count)
    this.reversed = new Uint8Array(count)
    this.hangShare = new Float32Array(count)
    this.flattenShare = new Float32Array(count)
    this.grip = new Float32Array(count)
    this.hangLevel = new Float32Array(count)
    this.regions = new Uint8Array(count)
    this.wake = new Float32Array(count)
    this.height = new Float32Array(count)
  }

  // Homes on `mass` for the worms whose heads are `heads`, lengths `lengths` and roles `roles`, round `center`.
  assign(mass, heads, lengths, roles, center) {
    const random = new Random(params.seed * 7919 + 13)
    const bias = [params.legBias, params.torsoBias, params.armBias, params.headBias]
    // ∝ volume or surface: a bulk cone's volume swamps the limbs', its surface less so
    const surface = THREE.MathUtils.clamp(params.homeSurface, 0, 1)
    const side = reachSide()
    const onReachArm = (name) => side !== null && [`${side}Arm`, `${side}ForeArm`, `${side}Hand`].includes(name)
    const onReach = (a) => (onReachArm(mass.names[a]) ? params.reachBias : 1)
    const onNeck = (a) => (mass.names[a] === 'Neck' ? params.neckBias : mass.names[a] === 'Head' ? params.headConeBias : 1)
    const weights = mass.anchors.map(({ start, end, radius }, a) => {
      const length = start.distanceTo(end)
      const volume = Math.PI * radius ** 2 * length + (4 / 3) * Math.PI * radius ** 3
      const area = 2 * Math.PI * radius * length + 4 * Math.PI * radius ** 2
      const band = mass.regions[a] === REGION.legs ? legBand(start, end) : 1
      return (
        volume ** (1 - surface) * area ** surface * band * Math.max(bias[mass.regions[a]] * onReach(a) * onNeck(a), 0)
      )
    })
    const total = weights.reduce((sum, w) => sum + w, 0)
    // crawling strays take homes like the rest: they climb to them once they reach the body
    const all = []
    for (let m = 0; m < roles.length; m++) {
      if (roles[m] === 0 || params.strayCrawl) all.push(m)
      else this.#stray(m)
    }
    const reach = (m) => Math.hypot(heads[m].x - center.x, heads[m].z - center.z)
    const spilled = all.filter((m) => roles[m] === 0)
    const heapCount = Math.round(THREE.MathUtils.clamp(params.heapShare, 0, 1) * spilled.length)
    const heaped = spilled.sort((m1, m2) => reach(m1) - reach(m2)).slice(0, heapCount)
    const hem = mass.names.indexOf('hem')
    const skirt = hem >= 0 ? hem : mass.names.indexOf('skirt')
    for (const m of heaped) this.#heap(m, random, mass, skirt)
    const body = all.filter((m) => !heaped.includes(m))
    if (body.length === 0 || !(total > 0)) {
      for (const m of body) this.#stray(m)
      return this
    }
    // systematic draws: each anchor gets close to its expected share
    const homes = []
    const offset = random.next()
    let a = 0
    let below = 0
    for (let j = 0; j < body.length; j++) {
      const target = ((j + offset) / body.length) * total
      while (a < weights.length - 1 && below + weights[a] < target) below += weights[a++]
      homes.push(this.#home(mass, a, center, random))
    }
    // the danglers: forearm and hand homes, the reaching arm's first, that hang the longest worms off the limb
    const onHand = (home) => home.region === REGION.arms && /ForeArm|Hand/.test(mass.names[home.anchor])
    const onReaching = (home) => (onReachArm(mass.names[home.anchor]) ? 1 : 0)
    const danglers = homes
      .filter(onHand)
      .sort((h1, h2) => onReaching(h2) - onReaching(h1))
      .slice(0, Math.max(0, Math.round(params.danglers)))
    for (const home of danglers) {
      home.tail = params.danglerTail
      home.tailStart = params.danglerTailStart
      home.hangShare = params.danglerHang
      home.flattenShare = params.danglerFlatten
      home.grip = 0
      home.hangLevel = params.danglerHangLevel
    }
    // the head's homes take the shortest worms, the arms' the next, the legs' the longest, the danglers longer still:
    // a head and limbs rather than a mop
    const onHead = params.shortHeads ? homes.filter((home) => home.region === REGION.head) : []
    const onArms = params.shortArms
      ? homes.filter((home) => home.region === REGION.arms && !danglers.includes(home))
      : []
    const onTorso = params.longLegs ? homes.filter((home) => home.region === REGION.torso && !home.draped) : []
    const sorted = [...onHead, ...onArms, ...onTorso, ...danglers]
    const elsewhere = homes.filter((home) => !sorted.includes(home))
    body.sort((m1, m2) => lengths[m1] - lengths[m2])
    const azimuth = (p) => Math.atan2(p.x - center.x, p.z - center.z)
    const byAzimuth = (worms) => worms.sort((m1, m2) => azimuth(heads[m1]) - azimuth(heads[m2]))
    const pairs = []
    let taken = 0
    for (const group of [onHead, onArms, onTorso, elsewhere, danglers]) {
      const worms = byAzimuth(body.slice(taken, (taken += group.length)))
      group.sort((h1, h2) => h1.azimuth - h2.azimuth)
      for (let j = 0; j < worms.length; j++) pairs.push([worms[j], group[j]])
    }
    const top = Math.max(...homes.map((home) => home.y), 1e-3)
    for (const [m, home] of pairs) {
      this.anchorOf[m] = home.anchor
      this.anchorAt[m] = home.t
      this.slack[m] = home.slack
      this.weight[m] = home.weight
      this.tail[m] = home.tail
      this.tailStart[m] = home.tailStart
      this.reversed[m] = home.reversed
      this.hangShare[m] = home.hangShare
      this.flattenShare[m] = home.flattenShare
      this.grip[m] = home.grip
      this.hangLevel[m] = home.hangLevel
      this.regions[m] = home.region
      const rise = params.heightShare * Math.max(home.y, 0) + params.wakeJitter * top * random.next()
      this.wake[m] = (params.assembleSpread * rise) / top
      this.height[m] = Math.max(home.y, 0)
    }
    this.top = top
    return this
  }

  // Homed low on the hem's or the skirt's axis, or nowhere without either.
  #heap(m, random, mass, skirt) {
    const { start, end } = skirt >= 0 ? mass.anchors[skirt] : {}
    const span = skirt >= 0 ? Math.abs(start.y - end.y) : 0
    const homed = span > 1e-3 && params.heapHeight > 0
    const low = homed ? THREE.MathUtils.clamp(params.heapHeight / span, 0, 1) : 0
    const up = random.range(0, low)
    this.anchorOf[m] = homed ? skirt : -1
    this.anchorAt[m] = homed && mass.rising[skirt] ? up : 1 - up
    this.slack[m] = params.heapSlack
    this.weight[m] = random.range(params.weightMin, params.weightMax)
    this.tail[m] = random.range(params.tailMin, params.tailMax)
    this.tailStart[m] = random.range(params.tailStartMin, params.tailStartMax)
    this.reversed[m] = 0
    this.hangShare[m] = params.heapHang
    this.flattenShare[m] = params.heapFlatten
    this.grip[m] = params.legGrip
    this.hangLevel[m] = params.legHangLevel
    this.regions[m] = REGION.legs
    this.wake[m] = params.assembleSpread * params.wakeJitter * random.next()
  }

  #stray(m) {
    this.anchorOf[m] = -1
    this.anchorAt[m] = 0
    this.slack[m] = 1
    this.weight[m] = 0
    this.tail[m] = 1
    this.tailStart[m] = 1
    this.reversed[m] = 0
    this.hangShare[m] = 0
    this.flattenShare[m] = 1
    this.grip[m] = 0
    this.hangLevel[m] = -1
    this.regions[m] = REGION.none
    this.wake[m] = 1e9
  }

  #home(mass, anchor, center, random) {
    const region = mass.regions[anchor]
    const legs = region === REGION.legs
    const arms = region === REGION.arms
    const head = region === REGION.head
    const torso = region === REGION.torso
    const t = legs ? legAt(mass.anchors[anchor], random) : random.range(params.anchorMin, params.anchorMax)
    const point = mass.pointOn(anchor, t, _home)
    // the legs' homes and the torso's low ones hang the cloak
    const draped = legs || (torso && point.y < params.cloakTop)
    // per region, as REGION numbers them: legs, torso, arms, head
    const lift = [params.legWeight, params.torsoWeight, params.armWeight, params.headWeight][region]
    const slack = [1, params.torsoSlack, params.armSlack, params.headSlack][region]
    const hangShare = [params.legHang, params.torsoHang, params.armHang, params.headHang][region]
    const grip = [params.legGrip, params.torsoGrip, params.armGrip, params.headGrip][region]
    const hangLevel = [params.legHangLevel, params.torsoHangLevel, params.armHangLevel, params.headHangLevel][region]
    const tail = random.range(params.tailMin, params.tailMax)
    return {
      anchor,
      t,
      region,
      draped,
      slack: random.range(params.slackMin, params.slackMax) * slack,
      weight: random.range(params.weightMin, params.weightMax) * lift,
      tail: draped
        ? Math.min(tail, params.legTailMax)
        : arms
          ? Math.min(tail, params.armTailMax)
          : head
            ? Math.max(tail, params.headTailMin)
            : tail,
      hangShare: draped ? params.legHang : hangShare,
      flattenShare: [1, 1, params.armFlatten, params.headFlatten][region],
      grip: draped ? params.legGrip : grip,
      hangLevel: draped ? params.legHangLevel : hangLevel,
      tailStart: draped
        ? random.range(params.legTailStartMin, params.legTailStartMax)
        : random.range(params.tailStartMin, params.tailStartMax),
      reversed: random.next() < params.reversedShare ? 1 : 0,
      azimuth: Math.atan2(point.x - center.x, point.z - center.z),
      y: point.y,
    }
  }
}

// Debug view of the homes: each anchor's axis and end rings, and a cross at every body worm's home point, coloured by
// region. Drawn on the CPU while shown.
class HomesHelper extends THREE.LineSegments {
  /** Segments per end ring. */
  static SEGMENTS = 16

  #mass
  #homes

  constructor(mass, homes) {
    const anchors = mass.anchors.length
    const body = homes.anchorOf.filter((a) => a >= 0).length
    const vertices = 2 * (anchors * (1 + 2 * HomesHelper.SEGMENTS) + 3 * body)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * vertices), 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(3 * vertices), 3))
    geometry.getAttribute('position').setUsage(THREE.DynamicDrawUsage)
    const material = new THREE.LineBasicNodeMaterial({
      name: 'homes helper',
      vertexColors: true,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    })
    super(geometry, material)
    this.name = 'homes helper'
    this.renderOrder = 1
    this.frustumCulled = false
    this.#mass = mass
    this.#homes = homes
    this.#paint()
  }

  update() {
    const position = this.geometry.getAttribute('position')
    const mass = this.#mass
    const n = HomesHelper.SEGMENTS
    let v = 0
    const put = (p) => position.setXYZ(v++, p.x, p.y, p.z)
    const [ring, side, across, axis] = [_ring, _side, _across, _anchorAxis]
    for (const { start, end, radius } of mass.anchors) {
      put(start)
      put(end)
      axis.subVectors(end, start)
      if (axis.lengthSq() < 1e-12) axis.copy(UP)
      axis.normalize()
      side.set(1, 0, 0).cross(axis)
      if (side.lengthSq() < 1e-6) side.set(0, 0, 1).cross(axis)
      side.normalize()
      across.crossVectors(axis, side)
      for (const center of [start, end]) {
        for (let i = 0; i < n; i++) {
          for (const j of [i, i + 1]) {
            const angle = (TWO_PI * j) / n
            ring.copy(center).addScaledVector(side, radius * Math.cos(angle))
            put(ring.addScaledVector(across, radius * Math.sin(angle)))
          }
        }
      }
    }
    const homes = this.#homes
    const size = 0.03
    for (let m = 0; m < homes.anchorOf.length; m++) {
      if (homes.anchorOf[m] < 0) continue
      const p = mass.pointOn(homes.anchorOf[m], homes.anchorAt[m], _home)
      for (const d of [
        [size, 0, 0],
        [0, size, 0],
        [0, 0, size],
      ]) {
        position.setXYZ(v++, p.x - d[0], p.y - d[1], p.z - d[2])
        position.setXYZ(v++, p.x + d[0], p.y + d[1], p.z + d[2])
      }
    }
    position.needsUpdate = true
  }

  dispose() {
    this.geometry.dispose()
    this.material.dispose()
  }

  #paint() {
    const color = this.geometry.getAttribute('color')
    const colors = REGION_COLORS.map((hex) => new THREE.Color(hex))
    const n = HomesHelper.SEGMENTS
    let v = 0
    this.#mass.regions.forEach((region) => {
      for (let i = 0; i < 2 + 4 * n; i++) color.setXYZ(v++, colors[region].r, colors[region].g, colors[region].b)
    })
    const homes = this.#homes
    for (let m = 0; m < homes.anchorOf.length; m++) {
      if (homes.anchorOf[m] < 0) continue
      const c = colors[homes.regions[m]]
      for (let i = 0; i < 6; i++) color.setXYZ(v++, c.r, c.g, c.b)
    }
    color.needsUpdate = true
  }
}

// ─── Build ───────────────────────────────────────────────────────────────────

let figure = null
let mass = null
let worms = null
let wormShade = null // WormShade
let attractor = null
let riseAnchors = null // per anchor: 1 where its worms rise
let homes = null
let core = null
let wormLengths = []
let wormsHelper = null
let fieldHelper = null
let homesHelper = null
let grabbing = false
let building = false
let buildChain = Promise.resolve()
let simTime = 0 // sim seconds since the build or replay
let lastWake = 0 // sim s the start's last body worm wakes at
let laidRound = 0 // body worms the start laid round the figure, strays aside
let startHeights = new Float32Array(0) // the homed worms' home heights, lowest first: the start's catch levels
let catchOrders = new Float32Array(0) // each worm's catch order: its home's height at the build
let builtPose = '' // the pose the starting curves were laid round: replay() respawns at them
const buildCenter = new THREE.Vector3()
const status = {
  worms: 0,
  packMs: 0,
  fill: 0,
  held: 0,
  loose: 0,
  homed: 0, // worms with a home on the body, whatever their state
  strays: 0,
  crawling: 0,
  countedAt: -Infinity, // sim s the counts were read at
  error: '',
}
const warned = []

// The pull's share for each worm: its grip while HELD, 0 while LOOSE (falling, flung, grabbed, waiting or a stray).
function wormGate(noodles) {
  const offset = uint(noodles.wormDataOffset)
  return (m) => {
    const W0 = noodles.wormData.element(offset.add(uint(m).mul(6)))
    return select(W0.x.greaterThan(WormState.HELD - 0.5), W0.w, float(0))
  }
}

// How far each worm has turned from its home to the summit: 0 while held for its own wait (riseInterval ± riseSpread),
// then 1 for up to riseDuration, again and again while it stays held; 0 while not held, or homed on an anchor that
// doesn't rise (`anchors`, 1 or 0 per anchor).
const uRise = uniform(0).setName('wormRise')
const uRiseInterval = uniform(0).setName('wormRiseInterval')
const uRiseSpread = uniform(0).setName('wormRiseSpread')
const uRiseDuration = uniform(0).setName('wormRiseDuration')
function wormRise(noodles, anchors) {
  const offset = uint(noodles.wormDataOffset)
  return (m, anchor) => {
    const W0 = noodles.wormData.element(offset.add(uint(m).mul(6)))
    const spread = hash(uint(m).add(uint(0x5bd1e995)))
      .mul(2)
      .sub(1)
      .mul(uRiseSpread)
    const wait = uRiseInterval.mul(spread.add(1))
    const held = W0.y.mod(wait.add(uRiseDuration))
    const share = select(anchor.greaterThanEqual(0), anchors.element(max(anchor, 0)), float(1))
    return select(W0.x.greaterThan(WormState.HELD - 0.5), smoothstep(wait, wait.add(0.5), held), float(0))
      .mul(share)
      .mul(uRise)
  }
}

// 1 on each anchor whose worms rise: every one but the head's, unless riseHead.
function syncRiseAnchors() {
  if (!riseAnchors) return
  const { array } = riseAnchors
  let edited = false
  mass.regions.forEach((region, i) => {
    const rises = params.riseHead || region !== REGION.head ? 1 : 0
    if (array[i] === rises) return
    array[i] = rises
    edited = true
  })
  if (edited) changed(riseAnchors)
}

// The bat's capsule is listed from the build, so the solver's capsule branch compiles then; BatSwing takes it out of
// the list between swings and puts it back as it swings.
const batCollider = new Capsule(new THREE.Vector3(0, -10, 0), new THREE.Vector3(0, -9.9, 0), 0.01)
function wormColliders(from) {
  return [...from.cores, ...restroom.colliders, batCollider]
}

// The worms' own passes: the attractor every substep, then once a frame their wet trails (paint, then blur and dry),
// their shade and, while params.core, the core's tally and growth.
let coreWired = false // the core's passes are in the worms' batch
function wirePasses() {
  if (!worms) return
  const wet = restroom.wetness
  const after = params.wetTrails ? [wet.paintNode(worms), ...wet.filmNodes] : []
  after.push(wormShade.computeNode)
  coreWired = params.core
  if (coreWired) after.push(...core.computeNodes)
  worms.extraPasses = { before: [], substep: [attractor.computeNode], after }
}

function disposeWorms() {
  endGrab()
  if (worms) {
    worms.extraPasses = { before: [], substep: [], after: [] }
    restroom.wetness.release(worms)
  }
  for (const object of [wormsHelper, fieldHelper, homesHelper, worms]) {
    if (!object) continue
    scene.remove(object)
    object.dispose?.()
  }
  core?.removeFromParent()
  core?.dispose()
  attractor?.dispose()
  wormShade?.dispose()
  mass?.dispose()
  worms = attractor = riseAnchors = mass = homes = core = wormsHelper = fieldHelper = homesHelper = wormShade = null
  wormLengths = []
  Object.assign(status, { worms: 0, held: 0, loose: 0, strays: 0, crawling: 0, fill: 0, countedAt: -Infinity })
}

// The body field, the spill, the homes, the worms and their attractor. Rebuilt by the Worms, fit, bulk and assembly
// settings.
async function build() {
  building = true
  try {
    endGrab()
    if (!figure) {
      const urls = ['monster-start-walking', 'monster-walking'].map((name) => `./models/skinning/${name}.glb`)
      loading.begin('figure')
      const [start, walk] = await Promise.all(urls.map((url) => loader.loadAsync(url, loading.progress(url))))
      figure = new WalkingFigure({ start, walk })
      scene.add(figure.group)
      if (!figure.clipNames.includes(params.standClip)) {
        console.warn(`[worm-monster] the model has no clip "${params.standClip}": standing in "${DEFAULTS.standClip}"`)
        params.standClip = DEFAULTS.standClip
      }
    } else {
      figure.fit(params.figureHeight)
    }
    loading.begin('worms')
    disposeWorms()
    figure.reset(params.assembleGatherTime > 0)
    gameOver.reset()
    // the old run's hit, timed on its clock
    regroup.reset()
    bat.reset()
    status.error = ''
    if (params.wormCount <= 0) return

    const nextMass = WormMass.fromFigure(figure)
    const P = params.particles
    const profile = wormProfile(P)
    const radii = profile.map((f) => (f * params.thickness) / 2)
    const margin = 0.15
    const inside = (p, r) =>
      restroom.isClear(p, r + margin) && nextMass.cores.every((core) => capsuleClearance(p, core) > r)
    const startedAt = performance.now()
    const spill = new WormSpill(radii, {
      seed: params.seed,
      gap: params.packGap,
      maxTurn: params.maxTurn,
      budget: params.packBudget,
      inside,
      hover: params.startHover,
    })
    const lengths = [params.lengthMin, params.lengthMax, params.lengthSkew]
    const center = buildCenter.copy(figure.group.position).setY(0)
    const strayCount = Math.round(params.wormCount * THREE.MathUtils.clamp(params.strayShare, 0, 1))
    const bodyCount = params.wormCount - strayCount
    if (params.start === 'ceiling') {
      spill.ceiling(center, bodyCount, {
        bottom: params.ceilingBottom,
        top: params.ceilingTop,
        radius: params.ceilingRadius,
        lengths,
      })
    } else if (params.start === 'scatter') {
      spill.heap(center, bodyCount, {
        inner: params.scatterInner,
        outer: params.scatterOuter,
        layers: 1,
        lengths,
        falloff: false,
      })
    } else {
      spill.heap(center, bodyCount, {
        inner: params.heapInner,
        outer: params.heapOuter,
        layers: params.heapLayers,
        lengths,
      })
    }
    const aisle = restroom.aisle
    const aisleMiddle = (aisle.min.x + aisle.max.x) / 2
    const strayHalf = ((aisle.max.x - aisle.min.x) / 2) * THREE.MathUtils.clamp(params.strayWidth, 0, 1)
    spill.strays(center, strayCount, {
      inner: params.strayInner,
      outer: params.strayOuter,
      behind: params.strayBehind,
      left: aisleMiddle - strayHalf,
      right: aisleMiddle + strayHalf,
      clusters: Math.max(0, Math.round(params.strayClusters)),
      clusterRadius: params.strayClusterRadius,
      lengths,
    })
    status.packMs = Math.round(performance.now() - startedAt)
    if (spill.count < params.wormCount) {
      console.warn(`[worm-monster] ${params.start}: placed ${spill.count} of ${params.wormCount} worms`)
    }
    if (spill.count === 0) {
      nextMass.dispose()
      return
    }

    const nextHeads = spill.heads()
    const nextLengths = spill.curves.map((curve) => curve.getLength())
    const nextRoles = Uint8Array.from(spill.roles)
    const nextHomes = new HomeAssigner(spill.count).assign(nextMass, nextHeads, nextLengths, nextRoles, center)
    const nextLastWake = nextHomes.wake.reduce((last, wake) => (wake < 1e8 ? Math.max(last, wake) : last), 0)
    const nextCatchOrders = Float32Array.from(nextHomes.height)
    const nextWorms = new WormSimulation(spill.curves, wormMaterial, {
      field: nextMass.field,
      states: Uint8Array.from(nextRoles, (role) =>
        role === 1 && params.strayCrawl ? WormState.CRAWLING : WormState.LOOSE,
      ),
      cooldowns: nextHomes.wake,
      catchOrders: nextCatchOrders,
      radius: params.thickness / 2,
      particlesPerNoodle: P,
      radiusProfile: profile,
      radialSegments: params.radialSegments,
      lengthSegments: params.lengthSegments,
      capSegments: params.capSegments,
      segmentBucketSize: params.segmentBucketSize,
      contactLanes: params.contactLanes,
      colliderCulling: params.colliderCulling,
      fillLayers: params.fillLayers,
      // nothing here reads couplingData's particle hash
      partnerHash: false,
    })
    nextWorms.name = 'worms'
    // its own clone of the material: darkened by depth in this body's field
    const nextShade = new WormShade(nextWorms, nextMass.field, {
      samples: Math.max(1, Math.round(params.bodyOcclusionSamples)),
    })
    depthShaded = params.depthDarken > 0
    occlusionShaded = params.bodyOcclusion
    nextWorms.material.aoNode = wormAmbientOf(nextShade)
    shadeWorms(nextWorms.material, depthShaded ? depthShade(nextShade) : float(1))
    nextWorms.castShadow = true
    nextWorms.receiveShadow = true
    nextWorms.ground = floorPlane
    nextWorms.colliders = wormColliders(nextMass)
    const nextRiseAnchors = changingArray(Array.from(nextMass.anchors, () => 1), 'float').setName('wormRiseAnchors')
    const attracting = params.sharedFieldSample ? nextWorms.cachedField : nextMass.field
    const nextAttractor = new FieldAttractor(nextWorms, attracting, {
      anchors: nextMass.anchors,
      ...Object.fromEntries(HOME_ARRAYS.map((key) => [key, nextHomes[key]])),
      gate: wormGate(nextWorms),
      rise: wormRise(nextWorms, nextRiseAnchors),
      name: 'wormAttractor',
    })
    const nextCore = new WormCore(nextMass, nextWorms, nextHomes)
    nextWorms.add(nextCore)

    mass = nextMass
    worms = nextWorms
    wormShade = nextShade
    attractor = nextAttractor
    riseAnchors = nextRiseAnchors
    syncRiseAnchors()
    homes = nextHomes
    catchOrders = nextCatchOrders
    lastWake = nextLastWake
    core = nextCore
    wormLengths = nextLengths
    builtPose = figure.poseKey
    wirePasses()
    await restroom.wetness.compileAsync(renderer)
    restroom.wetness.clear(renderer)
    syncWorms()
    syncAttractor()
    loading.begin('compile')
    await worms.compileAsync(renderer)
    scene.add(worms)
    wormsHelper = new WormSimulationHelper(worms)
    wormsHelper.name = 'worm helper'
    fieldHelper = new BodyFieldHelper(mass.field)
    fieldHelper.name = 'field helper'
    homesHelper = new HomesHelper(mass, homes)
    scene.add(wormsHelper, fieldHelper, homesHelper)
    if (!precompiled) await precompile()
    measureFill()
    status.worms = spill.count
    status.strays = nextRoles.filter((role) => role === 1).length
    laidRound = nextRoles.filter((role, m) => role === 0 && homes.regions[m] !== REGION.none).length
    startHeights = homes.height.filter((_, m) => homes.regions[m] !== REGION.none).sort()
    simTime = 0
    status.countedAt = -Infinity
    attractor.snap()
    console.log(
      `[worm-monster] ${params.start}: ${spill.count} worms × ${P} particles (${status.strays} strays) laid in ` +
        `${status.packMs} ms; ${mass.field.cones.length} cones, fill ${status.fill.toFixed(2)}`,
    )
  } finally {
    building = false
  }
  // A head start, simulated without drawing; the timestamp queries read now and then, or their pool fills.
  const steps = Math.round(params.warmup * 60)
  for (let i = 0; i < steps; i++) {
    simulate(1 / 60)
    if (renderer.backend.trackTimestamp && i % 8 === 7) renderer.resolveTimestampsAsync('compute')
  }
}

function rebuild() {
  buildChain = buildChain.then(build).catch((error) => {
    building = false
    status.error = String(error?.message ?? error).slice(0, 80)
    console.error('[worm-monster] build failed:', error)
    loading.fail(status.error)
    disposeWorms()
  })
  return buildChain
}

// The worms' share of the room the field leaves round the cores.
function measureFill() {
  if (!mass) return
  const profile = wormProfile(params.particles)
  const meanSquare = profile.reduce((sum, f) => sum + f * f, 0) / profile.length
  const area = Math.PI * (params.thickness / 2) ** 2 * meanSquare
  let volume = 0
  homes.regions.forEach((region, m) => {
    if (region !== REGION.none) volume += area * wormLengths[m]
  })
  status.fill = volume / mass.measure()
}

function syncWorms() {
  for (const key of WORM_KEYS) worms[key] = params[key]
  if (bat.plowing) {
    worms.strikeRadius = params.plowRadius
    worms.strikeSpeed = bat.plowSpeed
  }
  // strictCollisions bounds the speed at 67.5 × radius × substeps: while a hit plays slowed, and in the step that
  // takes its strike, the worms step at hitSubsteps so the struck ones fly up to strikeSpeed
  const slowed = params.hitSubsteps * bat.timeScale * params.timeScale <= params.numSubsteps
  const hit = (bat.striking || (bat.playing && slowed)) && params.hitSubsteps > params.numSubsteps
  worms.numSubsteps = hit ? params.hitSubsteps : params.numSubsteps
  const fastest = hit ? Math.max(params.maxSpeed, params.strikeSpeed) : params.maxSpeed
  worms.maxSpeed = Math.min(fastest, 0.9 * 67.5 * worms.maxRadius * worms.numSubsteps)
  // without strictHits, the rest of the hit at the usual substeps flies free of that bound
  if (!params.strictHits && (bat.striking || bat.playing) && !hit) {
    worms.strictCollisions = false
    worms.maxSpeed = Math.max(params.maxSpeed, params.strikeSpeed)
  }
  worms.gravity.set(0, params.gravity, 0)
  // while the mass assembles every worm counts as at its edge: no drips yet
  worms.dripRate = simTime < params.dripDelay ? 0 : params.dripRate
  // The start gathers from the figure out (startGather), or with no gather time catches every worm where it lies.
  // Later a worm fallen beyond catchRadius crawls back, but after a hit the fallen are gathered feet first
  // (Regroup.gather).
  const start = startGather()
  const assembling = params.assembleGatherTime <= 0 && simTime < lastWake + params.catchTime + 0.1
  const gather = assembling || start >= 0 ? -1 : regroup.gather
  const reach = Math.max(params.catchRadius, params.regroupCatchRadius)
  const radius =
    start >= 0
      ? THREE.MathUtils.lerp(params.assembleRadiusFrom, params.assembleRadiusTo, start)
      : gather < 0
        ? params.catchRadius
        : THREE.MathUtils.lerp(params.catchRadius, reach, gather)
  worms.catchRadius = assembling ? Infinity : radius
  worms.catchLevel = start >= 0 ? startLevel(start) : gather < 0 ? Infinity : regroup.level
  worms.crawlBack = gather < 0
  worms.catchCrawling = start >= 0
  if (start >= 0) worms.gripTime = params.assembleGripTime
  worms.catchCenter.copy(figure.group.position)
  worms.leadVelocity.copy(figure.velocity)
  worms.spillHeight = riseOn() ? mass.crown.y + params.spillHeight : Infinity
  worms.spillTime = params.spillTime
}

// 0–1 through the start's gather, -1 once it is over or without one: the catch level rises through the homes' heights
// and the catch radius grows from assembleRadiusFrom to assembleRadiusTo.
function startGather() {
  const t = simTime / Math.max(params.assembleGatherTime, 1e-3)
  return params.assembleGatherTime > 0 && t < 1 ? t : -1
}

// m: the start's catch level at `t` through its gather, passing the homes' heights at an even pace, lowest first.
function startLevel(t) {
  if (startHeights.length === 0) return t * homes.top
  return startHeights[Math.min(Math.floor(t * startHeights.length), startHeights.length - 1)]
}

// The figure stands while the start gathers, until assembleWalkAt of the worms laid round it are held.
function startHolding() {
  if (startGather() < 0) return false
  const counted = status.countedAt >= 0
  return !(counted && status.held >= params.assembleWalkAt * laidRound)
}

// Worms rise, and let go above the head, once the mass has assembled.
function riseOn() {
  return params.rise && simTime >= params.riseDelay
}

// × the pull as the start assembles: assemblePull at first, easing up to 1 over assemblePullTime.
function assemblePull() {
  const t = THREE.MathUtils.clamp(simTime / Math.max(params.assemblePullTime, 1e-3), 0, 1)
  return THREE.MathUtils.lerp(params.assemblePull, 1, t * t * (3 - 2 * t))
}

function syncAttractor() {
  for (const [key, param] of ATTRACTOR_KEYS) attractor[key] = params[param]
  attractor.noiseDrift.set(params.noiseDriftX, params.noiseDriftY, params.noiseDriftZ)
  attractor.leashAxes.set(params.leashAxesX, params.leashAxesY, params.leashAxesZ)
  attractor.amplitude = params.attraction ? params.pullAmplitude * assemblePull() : 0
  attractor.lurchAmplitude = params.lurch ? params.lurchAmplitude : 0
  attractor.summit.copy(mass.crown).addScaledVector(UP, params.summitHeight)
  uRise.value = riseOn() ? 1 : 0
  uRiseInterval.value = Math.max(params.riseInterval, 0.1)
  uRiseSpread.value = THREE.MathUtils.clamp(params.riseSpread, 0, 1)
  uRiseDuration.value = Math.max(params.riseDuration, 0)
}

// One frame of simulated time: the figure's pose, the field and its anchors, then the worms and their core. The clock
// runs on the time the worms stepped, which stands still while they compile.
function simulate(delta) {
  if (!figure || building) return
  const simDelta = delta * params.timeScale
  if (simDelta > 0) figure.advance(simDelta)
  if (!worms) return
  mass.update(simDelta, simTime)
  syncAttractor()
  attractor.update()
  syncWorms()
  restroom.wetness.update(renderer, simDelta)
  core.visible = params.core
  if (params.core !== coreWired) wirePasses()
  if (params.core) core.update(renderer, simDelta)
  worms.update(renderer, delta)
  // A frame the worms don't step skips their batch's after passes: the core's run alone, unless time stands still,
  // when they would leave it as it is.
  if (params.core && worms.info.substeps === 0 && simDelta > 0) renderer.compute(core.computeNodes)
  simTime += worms.info.substeps * worms.info.coupling.h
}

// The worms with a home, held or loose, and those still crawling to it, read back from the worms' state now and then.
let counting = false
let countedAt = -Infinity
let wormStates = new Uint8Array(0) // each worm's WormState, as countStates last read them
// Called every 0.5 s of real time, unless a read is in flight, once the worms have stepped (their state buffer exists
// then).
async function countStates(time) {
  counting = true
  countedAt = time
  const counted = worms
  const regions = homes.regions
  const at = simTime
  try {
    const data = new Float32Array(await renderer.getArrayBufferAsync(counted.wormData.value))
    // a rebuild or replay since: these are the old run's states
    if (counted !== worms || simTime < at) return
    const base = 4 * counted.wormDataOffset
    let held = 0
    let body = 0
    let crawling = 0
    let homed = 0
    if (wormStates.length !== regions.length) wormStates = new Uint8Array(regions.length)
    for (let m = 0; m < regions.length; m++) {
      const state = Math.round(data[base + 24 * m])
      wormStates[m] = state
      if (regions[m] !== REGION.none) homed++
      if (state === WormState.CRAWLING) crawling++
      else if (regions[m] !== REGION.none) {
        body++
        if (state === WormState.HELD) held++
      }
    }
    status.held = held
    status.loose = body - held
    status.crawling = crawling
    status.homed = homed
    status.countedAt = at
  } catch (error) {
    if (!warned.includes('count')) {
      warned.push('count')
      console.warn('[worm-monster] reading the worm states failed:', error)
    }
  } finally {
    counting = false
  }
}

// ─── Post-processing ─────────────────────────────────────────────────────────

const renderPipeline = new THREE.RenderPipeline(renderer)

// One MRT for the session: swapping it at runtime breaks the pipelines. The screen-space reflections' G-buffer: every
// surface's normals and depth, which the rays meet, and a Fresnel weight of 0 (nothing reflects) but in the puddles.
const scenePass = pass(scene, camera, { samples: 0 })
scenePass.name = 'scene'
const gBuffer = ssrGBuffer()
scenePass.setMRT(mrt({ output, velocity, ...gBuffer, ssrSpecular: vec4(0, 0, 0, 1) }))
const velocityTexture = scenePass.getTexture('velocity')
velocityTexture.type = THREE.HalfFloatType
velocityTexture.format = THREE.RGFormat
const depthTexture = scenePass.getTexture('ssrDepth')
depthTexture.type = THREE.HalfFloatType
depthTexture.format = THREE.RedFormat
scenePass.getTexture('ssrSpecular').type = THREE.UnsignedByteType
const sceneColor = scenePass.getTextureNode('output')

// A pass that draws the materials in `unlitMaterials` as one unlit material: for a pass whose MRT writes only what
// any material's vertex stage gives (depth, the geometric normal), the same image, without the lit materials' light
// and shadow updates at each draw. A shadow map drawn within it sets its own render-object function and puts this back.
class PrePassNode extends THREE.PassNode {
  unlitMaterials = []
  unlitMaterial = new THREE.MeshBasicNodeMaterial({ name: 'prepass unlit', fog: false })
  #renderer = null
  #next = null // the render-object function it stands in front of
  #renderObject = (object, scene, camera, geometry, material, ...rest) => {
    const drawn = this.unlitMaterials.includes(material) ? this.unlitMaterial : material
    return this.#next.call(this.#renderer, object, scene, camera, geometry, drawn, ...rest)
  }

  updateBefore(frame) {
    const renderer = (this.#renderer = frame.renderer)
    const previous = renderer.getRenderObjectFunction()
    this.#next = previous ?? renderer.renderObject
    renderer.setRenderObjectFunction(this.#renderObject)
    try {
      return super.updateBefore(frame)
    } finally {
      renderer.setRenderObjectFunction(previous)
    }
  }

  // three precompiles each mesh with its own material: the unlit one stands in while the meshes are queued.
  compileAsync(renderer) {
    const swapped = []
    this.scene.traverse((object) => {
      if (!this.unlitMaterials.includes(object.material)) return
      swapped.push([object, object.material])
      object.material = this.unlitMaterial
    })
    try {
      return super.compileAsync(renderer)
    } finally {
      for (const [object, material] of swapped) object.material = material
    }
  }

  dispose() {
    this.unlitMaterial.dispose()
    super.dispose()
  }
}
// The room's materials that draw in a depth-and-normal pass exactly as an unlit one does: opaque, front-sided,
// smooth-shaded, moving no vertex and discarding no fragment.
function plainMaterialsOf(room) {
  const materials = []
  room.traverse((object) => {
    const m = object.isMesh ? object.material : null
    if (!m?.isMaterial || materials.includes(m)) return
    const plain =
      m.side === THREE.FrontSide &&
      !m.transparent &&
      m.alphaTest === 0 &&
      !m.alphaMap &&
      !m.alphaHash &&
      !m.displacementMap &&
      !m.positionNode &&
      !m.vertexNode &&
      !m.depthNode &&
      !m.maskNode &&
      !m.flatShading &&
      !m.wireframe &&
      !m.polygonOffset &&
      !(m.clippingPlanes?.length > 0) &&
      m.depthWrite &&
      m.depthTest &&
      m.depthFunc === THREE.LessEqualDepth &&
      m.colorWrite
    if (plain) materials.push(m)
  })
  return materials
}

// Ambient occlusion: depth and the geometric normal from an opaque prepass give XeGTAO's visibility, which the scene
// pass's materials take as ambient occlusion: it scales the hemisphere's and the environment's light only. The room
// draws in it unlit.
const prePass = new PrePassNode(THREE.PassNode.COLOR, scene, camera, { samples: 0 })
prePass.name = 'prepass'
prePass.unlitMaterials = plainMaterialsOf(restroom)
prePass.transparent = false
prePass.contextNode = context({ getAO: null })
prePass.setMRT(mrt({ output: packNormalToRGB(normalViewGeometry) }))
prePass.getTexture('output').type = THREE.UnsignedByteType
const prePassNormal = sample((uv) => unpackRGBToNormal(prePass.getTextureNode().sample(uv)))
// No velocity node: the scene pass writes the velocity after this node runs, inside it.
const occlusion = xeGTAO(prePass.getTextureNode('depth'), camera, { normalNode: prePassNormal })
occlusion.radius.onFrameUpdate(() => params.aoRadius)
occlusion.intensity.onFrameUpdate(() => params.aoIntensity)
occlusion.power.onFrameUpdate(() => params.aoPower)
occlusion.falloffRange.onFrameUpdate(() => params.aoFalloffRange)
occlusion.thinOccluder.onFrameUpdate(() => params.aoThinOccluder)
occlusion.maxScreenRadius.onFrameUpdate(() => params.aoMaxScreenRadius)
occlusion.temporalAccumulationAlpha.onFrameUpdate(() => params.aoTemporalAlpha)
const aoContext = builtinAOContext(occlusion.getMaterialAONode())
function setAO() {
  const contextNode = params.ao ? aoContext : null
  if (scenePass.contextNode === contextNode) return
  scenePass.contextNode = contextNode
  scenePass.needsUpdate = true
}

// Screen-space reflections in the wet trails' puddles (SSRNode). Only the puddles write a Fresnel weight, × the
// wet mask, and a rippled water normal to the G-buffer; the composite swaps the environment's reflection there (the
// baked, empty room) for what the rays meet on screen, before TAAU.
const uRipple = uniform(0).onFrameUpdate(() => params.ssrRipple)
const uRippleFrequency = uniform(0).onFrameUpdate(() => params.ssrRippleFrequency)
const uSSRIntensity = uniform(1).onFrameUpdate(() => params.ssrIntensity)
const uPuddleRoughness = uniform(0).onFrameUpdate(() => params.ssrPuddleRoughness)
const puddleNormal = Fn(() => {
  const normal = normalWorldGeometry
  const wave = mx_noise_vec3(positionWorld.mul(uRippleFrequency))
  const tilt = wave.sub(normal.mul(dot(normal, wave))).mul(uRipple)
  return normalize(cameraViewMatrix.mul(vec4(normalize(normal.add(tilt)), 0)).xyz)
})()
const puddleGBuffer = (gloss) =>
  mrt({
    ssrNormals: vec4(octEncode(normalFlat), octEncode(puddleNormal)),
    // √F × the wet mask's root, and the puddle's roughness for the reflection's blur (F keeps the tiles')
    ssrSpecular: Fn(() => {
      const specular = gBuffer.ssrSpecular.toVar()
      return vec4(specular.rgb.mul(gloss.sqrt()), mix(specular.a, uPuddleRoughness, gloss))
    })(),
  })
// The restroom's wet materials write the puddles' G-buffer only while the reflections run.
function syncPuddles() {
  const on = ssrNode !== null
  for (const { material, gloss } of restroom.wetMaterials) {
    if (on === (material.mrtNode !== null)) continue
    material.mrtNode = on ? puddleGBuffer(gloss) : null
    material.needsUpdate = true
  }
}
const newSSR = () =>
  params.ssr ? ssr(sceneColor, scenePass, { label: 'PuddleSSR', resolutionScale: params.ssrResolution }) : null
function syncSSR() {
  if (!ssrNode) return
  ssrNode.maxDistance = params.ssrMaxDistance
  ssrNode.thickness = params.ssrThickness
  ssrNode.probes = params.ssrProbes
  ssrNode.iterations = params.ssrIterations
  ssrNode.edgeFade = params.ssrEdgeFade
  ssrNode.roughnessCutoff = params.ssrRoughnessCutoff
}
// The scene's colour with the puddles' reflections, at the scene pass's resolution: scene + c·(k·F·L_ssr − F·L_env),
// which at k = 1 is the node's own composite. scene.environment is read here: a new one rebuilds it.
function newLit() {
  if (!ssrNode) return sceneColor
  const specular = scenePass.getTextureNode('ssrSpecular')
  const environment = ssrEnvironmentSpecular(ssrNode, scene.environment, {
    environmentIntensity: () => scene.environmentIntensity,
    environmentRotation: scene.environmentRotation,
  })
  const color = Fn(() => {
    const reflection = vec4(ssrNode).toVar() // L_ssr, c
    const F = specular.rgb.mul(specular.rgb)
    const reflected = F.mul(uSSRIntensity).min(1).mul(reflection.rgb).mul(reflection.a)
    if (params.ssrShowOnly) return vec4(reflected, 1)
    const replaced = environment.rgb.mul(reflection.a)
    return vec4(max(sceneColor.rgb.add(reflected).sub(replaced), 0), sceneColor.a)
  })()
  return rtt(color, null, null, { type: THREE.HalfFloatType, depthBuffer: false, resolutionScale: sceneScale() })
}
let ssrNode = newSSR()
let lit = newLit()
syncSSR()
syncPuddles()

// TAAU: the scene pass and its prepass render jittered at renderPixelRatio, and TAAUNode accumulates them, with the
// reflections, into an image at the output's pixel ratio, which the motion blur and the bloom read. It jitters the
// camera only while the render pipeline renders, so picking and the shadow maps see it still. Without TAAU the scene
// renders at the output's pixel ratio.
function sceneScale() {
  return params.taau ? Math.min(1, params.renderPixelRatio / renderer.getPixelRatio()) : 1
}
function setSampling() {
  const scale = sceneScale()
  scenePass.setResolutionScale(scale)
  prePass.setResolutionScale(scale)
  if (lit.isRTTNode) lit.setResolutionScale(scale)
}
// The output's pixel ratio, and the scene's share of it.
function setPixelRatio() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, params.maxPixelRatio))
  setSampling()
}
function newTAAU() {
  if (!params.taau) return null
  const node = taau(lit, scenePass.getTextureNode('depth'), scenePass.getTextureNode('velocity'), camera, {
    bicubicHistory: params.taauBicubicHistory,
    jitterPhases: params.taauJitterPhases,
    clipColorSpace: params.taauClipColorSpace,
  })
  node.currentFrameWeight.onFrameUpdate(() => params.taauCurrentFrameWeight)
  node.maxAccumulation.onFrameUpdate(() => params.taauMaxAccumulation)
  node.kernelSigma.onFrameUpdate(() => params.taauKernelSigma)
  node.kernelSigmaFloor.onFrameUpdate(() => params.taauKernelSigmaFloor)
  node.depthRejectTolerance.onFrameUpdate(() => params.taauDepthRejectTolerance)
  node.edgeDetectTolerance.onFrameUpdate(() => params.taauEdgeDetectTolerance)
  node.maxVelocityLength.onFrameUpdate(() => params.taauMaxVelocityLength)
  node.varianceGammaMin.onFrameUpdate(() => params.taauVarianceGammaMin)
  node.lockDecay.onFrameUpdate(() => params.taauLockDecay)
  node.lockThreshold.onFrameUpdate(() => params.taauLockThreshold)
  node.lockDetection.onFrameUpdate(() => (params.taauRidgeLock ? 1 : 0))
  node.lockSimilarity.onFrameUpdate(() => params.taauLockSimilarity)
  node.lockLumaTolerance.onFrameUpdate(() => params.taauLockLumaTolerance)
  node.edgeDisocclusionAccumulation.onFrameUpdate(() => params.taauEdgeDisocclusionAccumulation)
  node.edgeDisocclusionMinParallax.onFrameUpdate(() => params.taauEdgeMinParallax)
  return node
}
const resolved = () => taauNode?.getTextureNode() ?? lit
const newBlur = () =>
  motionBlur(resolved(), scenePass.getTextureNode('depth'), camera, {
    velocityNode: scenePass.getTextureNode('velocity'),
    resolutionScale: params.blurResolution,
  })
// Bloom reads the scene before the motion blur: its glow is soft anyway.
const newBloom = () =>
  bloom(resolved(), { strength: params.bloomAmplitude, radius: params.bloomRadius, threshold: params.bloomThreshold })

setSampling()
let taauNode = newTAAU()
let blurred = newBlur()
let bloomNode = newBloom()

// The post-processing's and both passes' pipelines, compiled off the main thread behind the loading screen. Frames skip
// the render until then: one drawn meanwhile would compile them on it, and the passes' precompile holds their target.
let precompiled = false
async function precompile() {
  // in reading order, one at a time (three's compiles can't overlap): a pass precompiles what it reads, drawing it
  await prePass.compileAsync(renderer)
  await occlusion.compileAsync(renderer)
  await scenePass.compileAsync(renderer)
  await Promise.all([ssrNode, taauNode, blurred, bloomNode].map((node) => node?.compileAsync(renderer)))
  precompiled = true
}

// The reflections' settings and TAAU's compiled options are baked into their nodes, and TAAU, the blur and the bloom
// are built on what comes before them: new ones on change.
function buildPost() {
  const previous = [ssrNode, lit === sceneColor ? null : lit, taauNode, blurred, bloomNode]
  ssrNode = newSSR()
  syncSSR()
  syncPuddles()
  lit = newLit()
  setSampling()
  taauNode = newTAAU()
  blurred = newBlur()
  bloomNode = newBloom()
  setOutput()
  for (const node of previous) node?.dispose()
}

const uGrain = uniform(0).onFrameUpdate(() => params.grain)
const uAberration = uniform(0).onFrameUpdate(() => params.aberration)
const uTint = uniform(new THREE.Color()).onFrameUpdate(() => uTint.value.set(params.tint))
const uSaturation = uniform(1).onFrameUpdate(() => params.saturation)
const uBlackLift = uniform(0).onFrameUpdate(() => params.blackLift)
const uVignette = uniform(0).onFrameUpdate(() => params.vignette)
const uVignetteInner = uniform(0).onFrameUpdate(() => params.vignetteInner)
const uVignetteOuter = uniform(1).onFrameUpdate(() => Math.max(params.vignetteOuter, params.vignetteInner + 1e-3))

// A cheap low-light camera, in display space: grain, a tinted, desaturated grade with lifted blacks, a vignette.
function finish(color) {
  const grained = film(color, uGrain)
  const grey = luminance(grained.rgb)
  const graded = mix(vec3(grey), grained.rgb, uSaturation).mul(uTint)
  const lifted = graded.mul(uBlackLift.oneMinus()).add(uBlackLift)
  const corner = length(uv().sub(0.5)).mul(Math.SQRT2)
  const shade = float(1).sub(uVignette.mul(smoothstep(uVignetteInner, uVignetteOuter, corner)))
  return vec4(lifted.mul(shade), 1)
}

// A hit's flash, in display space: the view mixed toward hitFlashColor by uFlash, which the loop sets.
const uFlash = uniform(0)
const uFlashColor = uniform(new THREE.Color()).onFrameUpdate(() => uFlashColor.value.set(params.hitFlashColor))
const flashed = (color) => vec4(mix(color.rgb, uFlashColor, uFlash), 1)

// Off while the worm helper shows: its goal boxes' velocity doesn't follow where they are drawn.
const blurShown = () => params.motionBlur && !(params.debug && params.showHelper)
const aberrationShown = () => params.film && params.aberration > 0
let blurring = false
let aberrating = false
let aberrationNode = null
function setOutput() {
  blurring = blurShown()
  aberrating = aberrationShown()
  let color = blurring ? blurred : resolved()
  if (params.bloom) color = vec4(color.rgb.add(bloomNode.rgb), 1)
  const previous = aberrationNode
  aberrationNode = aberrating ? chromaticAberration(color, uAberration) : null
  if (aberrationNode) color = aberrationNode
  const mapped = renderOutput(color)
  renderPipeline.outputColorTransform = false
  renderPipeline.outputNode = flashed(params.film ? finish(mapped) : mapped)
  renderPipeline.needsUpdate = true
  previous?.dispose()
  if (blurring) blurred.resetHistory()
}
setAO()
setOutput()

// ─── Game over ───────────────────────────────────────────────────────────────

// Once the body's field reaches the eye, the view darkens and the end text fades in gameOverDelay sim seconds later,
// with the death sound; the replay hint follows. It stays until a replay: a click once the hint shows, or ⇧R.
class GameOver {
  swallowedAt = null // sim s the field first reached the eye
  shown = false
  element = document.createElement('div')
  #title = document.createElement('h1')
  #hint = document.createElement('p')
  #style = ''
  #shownAt = 0 // ms, performance.now(), the text began to fade in

  constructor() {
    const { element } = this
    element.className = 'game-over'
    element.style.cssText =
      'position:fixed;inset:0;z-index:100;display:flex;flex-direction:column;align-items:center;' +
      'justify-content:center;gap:2vh;opacity:0;pointer-events:none;user-select:none;cursor:pointer;' +
      "font-family:'IM Fell English SC',Georgia,serif;text-align:center;"
    this.#title.style.cssText =
      'margin:0;font-weight:400;font-size:clamp(3rem,13vw,10rem);letter-spacing:0.06em;line-height:1;' +
      'text-shadow:0 0 0.4em rgba(0,0,0,0.9);'
    this.#hint.style.cssText =
      'margin:0;font-size:clamp(0.9rem,2vw,1.2rem);letter-spacing:0.25em;color:rgba(232,224,204,0.55);opacity:0;'
    this.#hint.textContent = 'Click to replay'
    element.append(this.#title, this.#hint)
    document.body.append(element)
    element.addEventListener('click', (e) => {
      // a click still swinging as the body closed in doesn't replay
      if (performance.now() - this.#shownAt < Math.max(params.gameOverHintDelay, 0) * 1000) return
      replay()
      // a mouse click is a gesture the browser takes a lock request from; a tap never locks, as at Start: locked, a
      // touch screen's stick and look would stop
      if (params.pointerLock && e.pointerType !== 'touch' && !touchShown()) controls.lock()
    })
  }

  // Swallowed or not at sim time `time`: once it is, it stays so.
  update(swallowed, time) {
    if (!params.gameOver) return this.reset()
    if (swallowed && this.swallowedAt === null) this.swallowedAt = time
    if (this.swallowedAt !== null && time - this.swallowedAt >= params.gameOverDelay) this.#show(true)
    // a touch screen has no keys
    const hint = touchShown() ? 'Tap to replay' : 'Click to replay'
    if (this.#hint.textContent !== hint) this.#hint.textContent = hint
    const style = [params.gameOverText, params.gameOverColor, params.gameOverDarkness, params.gameOverFade].join('|')
    if (style === this.#style) return
    this.#style = style
    const dark = THREE.MathUtils.clamp(params.gameOverDarkness, 0, 1)
    this.#title.textContent = params.gameOverText
    this.#title.style.color = params.gameOverColor
    this.element.style.background =
      `radial-gradient(ellipse at center, rgba(4,0,0,${(dark * 0.75).toFixed(3)}) 0%, ` +
      `rgba(4,0,0,${dark.toFixed(3)}) 70%)`
  }

  reset() {
    this.swallowedAt = null
    this.#show(false)
  }

  #show(shown) {
    if (shown === this.shown) return
    this.shown = shown
    const { style } = this.element
    // in over gameOverFade, out at once
    style.transition = shown ? `opacity ${Math.max(params.gameOverFade, 0)}s ease-in` : 'none'
    style.opacity = shown ? '1' : '0'
    style.pointerEvents = shown ? 'auto' : 'none'
    const hint = this.#hint.style
    const delay = Math.max(params.gameOverHintDelay, 0)
    hint.transition = shown ? `opacity ${Math.max(params.gameOverHintFade, 0)}s ease-in ${delay}s` : 'none'
    hint.opacity = shown ? '1' : '0'
    if (!shown) return
    this.#shownAt = performance.now()
    if (params.sound && params.gameOverSound) audio.death(1)
  }
}
const gameOver = new GameOver()

// ─── Bat ─────────────────────────────────────────────────────────────────────

// The bat in the player's hands (BatViewModel): a click swings it. While it swings, its striking part (the barrel and
// taper, batColliderLength from the tip) is a capsule among the worms' colliders, and the quad it swept since the last
// frame is tested against the body's field. A swing's first contact is a hit: the worms there are struck toward the
// view's right, the figure is knocked back and regroups, slime sprays, and the hit-stop, slow motion, camera jolt,
// FOV punch and flash play. After the hit the bat plows on, striking the worms within plowRadius of its sweep.
class BatSwing {
  timeScale = 1 // the sim's, this frame
  plowing = false // the strike waiting for the next step is a plow's
  plowSpeed = 0 // m/s: its speed, the sweet spot's
  #viewModel
  #hit = false // this swing has hit
  #struckAt = -1 // sim s of the hit: the plow waits until a step has taken its strike
  #contactShare = 0 // where between last frame's barrel and this frame's the contact lies
  #since = Infinity // s since the last hit, on the world's clock before its slow motion
  #start = new THREE.Vector3()
  #end = new THREE.Vector3()
  #previousStart = new THREE.Vector3()
  #previousEnd = new THREE.Vector3()
  #near = new THREE.Vector3()
  #far = new THREE.Vector3()
  #point = new THREE.Vector3()
  #contact = new THREE.Vector3()
  #direction = new THREE.Vector3()
  #axis = new THREE.Vector3()
  #velocity = new THREE.Vector3()
  #doorsHit = [] // the stall doors this swing has hit
  #wallHit = false // this swing has met a wall
  #thud = false // this swing has hit the body: its other sounds stay quiet

  constructor(viewModel) {
    this.#viewModel = viewModel
  }

  /** Swings, unless the last swing is still going. */
  swing() {
    if (!params.bat || !controls.enabled) return
    if (!this.#viewModel.swing()) return
    this.#hit = false
    this.#wallHit = false
    this.#thud = false
    this.plowing = false
    this.#doorsHit.length = 0
    if (params.sound) audio.whoosh(1)
  }

  /** Whether the swing hit the body, while it lasts: no other sound plays meanwhile. */
  get quiet() {
    return this.#thud && this.#viewModel.phase !== 'idle'
  }

  /** Whether the last hit is still playing: its stop and slow motion. */
  get playing() {
    return this.#since < Math.max(params.hitStop, 0) + Math.max(params.hitSlowMoTime, 0)
  }

  /** Whether the hit's strike still waits for a step to take it. */
  get striking() {
    return this.#hit && simTime <= this.#struckAt
  }

  /** The FOV's punch now, deg. */
  get fovOffset() {
    const k = this.#since / Math.max(params.hitFovTime, 1e-3)
    return k < 1 ? params.hitFov * (1 - k) ** 2 : 0
  }

  // `delta` s of the world's clock: the feel counted down, then the barrel tested if it may hit.
  update(delta) {
    this.#since += delta
    this.timeScale = this.#timeScaleAt(this.#since)
    const flash = Math.max(1 - this.#since / Math.max(params.hitFlashTime, 1e-3), 0)
    uFlash.value = params.hitFlash * flash * flash

    // the bat's striking part, batColliderLength down from its tip, now and last frame
    this.#viewModel.getBarrelSegment(this.#start, this.#end)
    this.#viewModel.getPreviousBarrelSegment(this.#previousStart, this.#previousEnd)
    const length = Math.max(params.batColliderLength, 0.01)
    this.#start.sub(this.#end).setLength(length).add(this.#end)
    this.#previousStart.sub(this.#previousEnd).setLength(length).add(this.#previousEnd)
    const phase = this.#viewModel.phase
    const swinging = phase === 'swing' || phase === 'follow'
    this.#syncCollider(params.bat && params.batCollide && params.tool === 'Bat' && phase !== 'idle')
    if (this.#viewModel.active && params.doors) this.#testDoors()
    if (params.batWalls && swinging && !this.#wallHit && this.#testWalls(delta)) return
    if (!mass || building || !worms) return
    if (this.#hit) {
      // on through the swing and the follow-through, once a step has taken the hit's strike, no faster than the bat
      if (params.plow && swinging && simTime > this.#struckAt) {
        this.plowSpeed = Math.min(params.strikeSpeed, this.#viewModel.getSwingVelocity(this.#velocity).length())
        const swept = { end: this.#end, from: this.#previousStart, fromEnd: this.#previousEnd }
        worms.strike(this.#start, this.#flight(this.#direction), swept)
        this.plowing = true
      }
      return
    }
    if (!this.#viewModel.active) return
    let nearest = Infinity
    for (let i = 0; i <= 5; i++) {
      this.#near.lerpVectors(this.#previousStart, this.#previousEnd, i / 5)
      this.#far.lerpVectors(this.#start, this.#end, i / 5)
      for (let j = 0; j <= 4; j++) {
        const point = this.#point.lerpVectors(this.#near, this.#far, j / 4)
        const distance = mass.field.distanceAt(point)
        if (distance < nearest) {
          nearest = distance
          this.#contact.copy(point)
          this.#contactShare = j / 4
        }
      }
    }
    if (nearest < params.batHitReach + this.#viewModel.bat.barrelRadius) this.#strike()
  }

  // The sim's time scale `since` s into a hit: stopped for hitStop, then eased back from hitSlowMo over hitSlowMoTime.
  #timeScaleAt(since) {
    const stop = Math.max(params.hitStop, 0)
    const slow = Math.max(params.hitSlowMoTime, 0)
    if (since < stop) return 0
    if (since >= stop + slow) return 1
    return THREE.MathUtils.lerp(params.hitSlowMo, 1, ((since - stop) / slow) ** 2)
  }

  // While it swings, the bat's striking part, fattened by batColliderRadius, is one of the worms' colliders; at rest it
  // leaves the list, so it comes back where it is, not swept from where it was.
  #syncCollider(on) {
    if (!worms) return
    const list = worms.colliders
    const index = list.indexOf(batCollider)
    if (!on) {
      if (index >= 0) list.splice(index, 1)
      return
    }
    batCollider.start.copy(this.#start)
    batCollider.end.copy(this.#end)
    batCollider.radius = this.#viewModel.bat.barrelRadius + Math.max(params.batColliderRadius, 0)
    if (index < 0) list.push(batCollider)
  }

  // The worms' flight: the view's right, forward and up, and the barrel's own way, by the strike's weights.
  #flight(direction) {
    direction.set(0, 0, 0)
    direction.addScaledVector(this.#axis.set(1, 0, 0).applyQuaternion(camera.quaternion), params.strikeRight)
    direction.addScaledVector(this.#axis.set(0, 0, -1).applyQuaternion(camera.quaternion), params.strikeForward)
    direction.addScaledVector(UP, params.strikeUp)
    const swept = this.#viewModel.getSwingVelocity(this.#axis)
    if (swept.lengthSq() > 1e-8) direction.addScaledVector(swept.normalize(), params.strikeSwing)
    if (direction.lengthSq() < 1e-8) direction.set(1, 0, 0)
    return direction.normalize()
  }

  // The barrel's sweep since the last frame against the walls, the floor and the fixtures: the first it meets stops it
  // there with a crack, a jolt and a shake, and it bounces back. Through a wall already, it swings on.
  #testWalls(delta) {
    if (this.#throughWall()) return false
    const reach = this.#viewModel.bat.barrelRadius
    for (let j = 1; j <= 4; j++) {
      for (let i = 0; i <= 5; i++) {
        this.#near.lerpVectors(this.#previousStart, this.#previousEnd, i / 5)
        this.#far.lerpVectors(this.#start, this.#end, i / 5)
        const surface = restroom.solidAt(this.#point.lerpVectors(this.#near, this.#far, j / 4), reach)
        if (!surface) continue
        this.#wallHit = true
        const speed = this.#viewModel.getSwingVelocity(this.#velocity).length()
        const amplitude = THREE.MathUtils.clamp(speed / Math.max(params.wallFullSpeed, 1e-3), 0.25, 1.2)
        if (params.sound && !this.#thud) audio.wallHit(amplitude, surface)
        buzz(25)
        shake.kick(params.wallShake * amplitude)
        this.#viewModel.recoil(1.2)
        this.#viewModel.hitStop(params.wallHitStop)
        this.#viewModel.reboundRate = params.wallRebound
        this.#viewModel.rebound((1 - j / 4) * delta)
        return true
      }
    }
    return false
  }

  // Whether the bat as it lay at the frame's start, or the reach from the eye to its hands, passes through a solid,
  // sampled every 4 cm: a thin partition between the hands and the tip counts.
  #throughWall() {
    const { bat, gripDistance } = this.#viewModel
    const tip = this.#previousEnd
    const direction = this.#axis.subVectors(tip, this.#previousStart).normalize()
    const hands = this.#near.copy(tip).addScaledVector(direction, gripDistance - bat.length)
    for (let k = 0; k <= 10; k++) {
      if (restroom.solidAt(this.#point.lerpVectors(camera.position, hands, k / 10))) return true
    }
    const steps = Math.ceil((bat.length - gripDistance) / 0.04)
    for (let k = 0; k <= steps; k++) {
      const fromKnob = THREE.MathUtils.lerp(gripDistance, bat.length, k / steps)
      this.#point.copy(tip).addScaledVector(direction, fromKnob - bat.length)
      if (restroom.solidAt(this.#point, bat.radiusAt(fromKnob))) return true
    }
    return false
  }

  // The barrel's sweep since the last frame against the stall doors, earliest first: each door it reaches swings away
  // from the side the barrel came from, once a swing.
  #testDoors() {
    const reach = this.#viewModel.bat.barrelRadius
    for (let j = 0; j <= 4; j++) {
      for (let i = 0; i <= 5; i++) {
        this.#near.lerpVectors(this.#previousStart, this.#previousEnd, i / 5)
        this.#far.lerpVectors(this.#start, this.#end, i / 5)
        const point = this.#point.lerpVectors(this.#near, this.#far, j / 4)
        const door = restroom.doorNear(point, reach)
        if (!door || this.#doorsHit.includes(door)) continue
        this.#doorsHit.push(door)
        const velocity = this.#viewModel.getSwingVelocity(this.#velocity)
        const push = { share: params.doorPush, least: params.doorKnock, most: params.doorMaxSpeed }
        door.push(point, velocity, push, this.#near)
        if (params.sound && !this.#thud) audio.bang(1)
        buzz(18)
        shake.kick(params.doorShake)
        this.#viewModel.hitStop(params.doorHitStop)
        this.#viewModel.recoil(0.6)
      }
    }
  }

  // The worms round the bat's striking part where it met the body, struck along the flight.
  #strike() {
    this.#hit = true
    this.#struckAt = simTime
    this.plowing = false
    this.#since = 0
    // this frame steps as the hit's first moment, stopped or slowed: the strike waits for a slowed step, which
    // syncWorms gives hitSubsteps and strikeSpeed, rather than flying capped at maxSpeed
    this.timeScale = this.#timeScaleAt(0)
    const point = this.#contact
    const direction = this.#flight(this.#direction)
    const share = this.#contactShare
    this.#near.lerpVectors(this.#previousStart, this.#start, share)
    this.#far.lerpVectors(this.#previousEnd, this.#end, share)
    worms.strike(this.#near, direction, { end: this.#far })
    figure.knock(direction)
    regroup.hit()
    spray.burst(point, direction, { count: params.sprayCount, speed: params.spraySpeed, spread: params.spraySpread })
    // the squish's burst of squelches stands in for the hit's synthesized one
    const squelch = params.squish && params.squishHit > 0 && squish.loaded
    if (params.sound) audio.hit(1, { wet: !squelch })
    if (squelch) squish.burst(params.squishHit)
    this.#thud = true
    buzz(35)
    shake.kick(params.hitShake)
    this.#viewModel.hitStop(params.hitStop)
    this.#viewModel.recoil(1)
  }

  reset() {
    this.#syncCollider(false)
    this.#hit = false
    this.#struckAt = -1
    this.plowing = false
    this.#since = Infinity
    this.timeScale = 1
    uFlash.value = 0
  }
}

// After a hit the figure stands until its worms are back: regroupShare of the body worms the hits knocked off held
// again (as countStates reads them), or from regroupMinTime on regroupEnough of those held before, or regroupTimeout s
// after the last hit.
class Regroup {
  waiting = false
  need = 0 // held worms it waits for
  #before = 0 // held before the first hit
  #fewest = Infinity // held, the fewest counted since
  #struckAt = -Infinity // sim s of the last hit
  #heights = null // the catch orders of the body worms off at the gather's start, lowest first

  // 0–1 through the gather, -1 outside it: once the struck worms' cooldown ends, over regroupGatherTime, the catch
  // radius grows from the feet and the catch level rises through the knocked-off worms' catch orders.
  get gather() {
    // a hit ahead of the clock is from the run before a rebuild or replay
    if (this.#struckAt > simTime) return -1
    const t = (simTime - this.#struckAt - params.toolCooldown) / Math.max(params.regroupGatherTime, 1e-3)
    if (!this.waiting && t >= 1) return -1
    return THREE.MathUtils.clamp(t, 0, 1)
  }

  // m: the gather's catch level, passing the knocked-off worms' catch orders at an even pace; Infinity outside it.
  get level() {
    const gather = this.gather
    if (gather < 0) return Infinity
    const heights = this.#heights
    if (!heights?.length) return gather * homes.top
    return heights[Math.min(Math.floor(gather * heights.length), heights.length - 1)]
  }

  hit() {
    if (!params.regroup) return
    if (!this.waiting) {
      this.#before = this.need = status.held
      this.#fewest = Infinity
    }
    this.waiting = true
    this.#struckAt = simTime
    this.#heights = null
  }

  update() {
    if (!this.waiting) return
    const counted = status.countedAt > this.#struckAt
    const read = wormStates.length === homes.regions.length
    if (counted && read && this.#heights === null && simTime >= this.#struckAt + params.toolCooldown) {
      const off = []
      for (let m = 0; m < wormStates.length; m++) {
        if (homes.regions[m] !== REGION.none && wormStates[m] !== WormState.HELD) off.push(catchOrders[m])
      }
      this.#heights = Float32Array.from(off).sort()
    }
    if (counted) {
      this.#fewest = Math.min(this.#fewest, status.held)
      const lost = Math.max(this.#before - this.#fewest, 0)
      this.need = this.#before - Math.floor(lost * (1 - THREE.MathUtils.clamp(params.regroupShare, 0, 1)))
    }
    const whole = counted && status.held >= this.need
    const since = simTime - this.#struckAt
    const enough = counted && since >= params.regroupMinTime && status.held >= params.regroupEnough * this.#before
    const timeout = params.regroupTimeout > 0 && since > params.regroupTimeout
    if (!params.regroup || whole || enough || timeout) this.waiting = false
  }

  reset() {
    this.waiting = false
    this.need = this.#before = 0
    this.#struckAt = -Infinity
    this.#heights = null
  }
}
const regroup = new Regroup()
const audio = new ImpactAudio({ volume: params.soundVolume })
const squish = new SquishAudio(audio, { volume: params.squishVolume })
// SquishAudio.synth's settings are the params squishSynth<Key>: [synth key, param] pairs.
const squishSynthParams = Object.keys(squish.synth).map((key) => [
  key,
  `squishSynth${key[0].toUpperCase()}${key.slice(1)}`,
])
// The squish's synth and room from the params.
function syncSquishSynth() {
  for (const [key, param] of squishSynthParams) squish.synth[key] = params[param]
  squish.roomTime = params.squishRoomTime
}
const spray = new SlimeSpray({ count: 1500, color: params.sprayColor })
drawBeforeBat(spray.stains) // stuck to the walls; the drops in flight draw after the bat
scene.add(spray)
const viewModel = new BatViewModel()
camera.add(viewModel)
const bat = new BatSwing(viewModel)

// ─── Touch ───────────────────────────────────────────────────────────────────

// On a touch screen: the stick walks and turns, tank-style, Hit swings, and a drag elsewhere on the screen looks.
const touch = new TouchControls({
  deadZone: params.touchDeadZone,
  travel: params.touchTravel,
  reach: params.touchReach,
})
document.body.append(touch.element)
// a touch the browser lets audio start from
for (const type of ['pointerdown', 'pointerup']) {
  touch.element.addEventListener(type, () => (params.sound || params.squish) && audio.unlock())
}
const coarsePointer = matchMedia('(pointer: coarse)')
let touchSeen = false
window.addEventListener('pointerdown', (e) => (touchSeen ||= e.pointerType === 'touch'), { capture: true })
const touchShown = () =>
  params.touchControls === 'On' || (params.touchControls === 'Auto' && (coarsePointer.matches || touchSeen))
const buzz = (ms) => params.touchVibrate && touch.visible && navigator.vibrate?.(ms)

// The loading screen's Start: a gesture the audio may start from, and, with a mouse, a pointer lock request, so the
// first click in the restroom swings rather than locks; on a touch screen, a fullscreen request.
loading.button?.addEventListener('click', (e) => {
  if (!loading.waiting) return
  if (params.sound || params.squish) audio.unlock()
  const touched = e.pointerType === 'touch' || touchShown()
  if (params.pointerLock && !touched) controls.lock()
  if (params.loadingFullscreen && touched) {
    document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })?.catch(() => {})
  }
  loading.start()
})

// ─── Tools ───────────────────────────────────────────────────────────────────

function collapse() {
  endGrab()
  worms?.collapse()
}
// The worms back where they were laid, the figure and the player where they started, the clock at 0.
function replay() {
  if (!worms || building) return
  endGrab()
  gameOver.reset()
  governor.reset()
  resetPlayer()
  bat.reset()
  regroup.reset()
  spray.clear()
  restroom.resetDoors()
  // curves laid round another pose could start inside its cores
  if (figure.poseKey !== builtPose) return rebuild()
  figure.reset(params.assembleGatherTime > 0)
  mass.update(0, 0)
  attractor.snap()
  worms.reset()
  core.reset()
  restroom.wetness.clear(renderer)
  simTime = 0
  status.countedAt = -Infinity
}
// The view at load: the player back at the start, looking straight ahead.
function resetView() {
  Object.assign(params, homeView)
  resetPlayer()
}

const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
function aimAt(ndcX, ndcY) {
  pointer.set(ndcX, ndcY)
  // the look may have turned it since the last frame
  camera.updateMatrixWorld()
  raycaster.setFromCamera(pointer, camera)
  return raycaster
}
function aimAtEvent(e) {
  // locked, the cursor is hidden and still: the tools aim at the centre
  if (controls.isLocked) return aimAt(0, 0)
  return aimAt((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1)
}
// While the pointer is free a mouse click only locks it, unless the browser refused the last lock.
let lockRefused = false
document.addEventListener('pointerlockerror', () => (lockRefused = true))
controls.addEventListener('lock', () => (lockRefused = false))
function endGrab() {
  if (grabbing) worms?.endGrab()
  grabbing = false
}

// The tools pick on the GPU: the CPU never learns which worm the pointer hit.
renderer.domElement.addEventListener('pointerdown', (e) => {
  // a click is a gesture audio may start from: the death sound and the squish play even without a swing
  if (params.sound || params.squish) audio.unlock()
  if (e.button !== 0 || !worms) return
  if (params.pointerLock && e.pointerType === 'mouse' && !controls.isLocked && !lockRefused) return
  if (params.tool === 'Bat') {
    // on a touch screen Hit swings, and a drag looks
    if (e.pointerType !== 'touch' || !touch.visible) bat.swing()
    return
  }
  const ray = aimAtEvent(e)
  if (params.tool === 'Grab') {
    worms.pick(ray, { radius: params.grabRadius }).grabPicked().moveGrabAlongRay(ray.ray)
    grabbing = true
  } else if (params.tool === 'Poke') {
    worms.poke(ray)
  } else {
    worms.blast(ray)
  }
})
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!grabbing) return
  worms?.moveGrabAlongRay(aimAtEvent(e).ray)
})
window.addEventListener('pointerup', endGrab)
window.addEventListener('pointercancel', endGrab)

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  // zoom or another screen may change the device pixel ratio
  setPixelRatio()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

// ─── Debug and keys ──────────────────────────────────────────────────────────

// With debug on, stats-gl shows, and records from Start: the loading's frames and shader compiles stay out of its
// graphs. Until then, and with debug off, it does no work a frame: no stats update, no GPU timestamp queries.
const statsRecording = () => params.debug && !loading.shown
function setDebug(enabled) {
  params.debug = enabled
  stats.dom.style.display = enabled ? '' : 'none'
}
setDebug(params.debug)

// Auto's tier, stepped by the governor's frame times.
governor.addEventListener('change', (event) => {
  applyTier(TIER_NAMES[event.level], { live: true })
  console.log(`[worm-monster] tier ${TIER_NAMES[event.level]}: stepped ${event.direction}, ${event.reason}`)
})
// A hidden tab's frames stop: its gap is no frame time.
document.addEventListener('visibilitychange', () => governor.reset())
tiersLive = true

// In the capture phase, so the keys work wherever the focus is.
const TOOL_KEYS = { Digit1: 'Bat', Digit2: 'Grab', Digit3: 'Poke', Digit4: 'Blast' }
window.addEventListener(
  'keydown',
  (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
    if (e.code === 'KeyP') setDebug(!params.debug)
    else if (e.code === 'KeyR' && e.shiftKey) replay()
    else if (e.code === 'KeyX') collapse()
    else if (e.code === 'KeyV') resetView()
    else if (e.code === 'KeyH') params.showHelper = !params.showHelper
    else if (e.code === 'KeyF') params.flashlight = !params.flashlight
    else if (e.code === 'KeyJ') params.showField = !params.showField
    else if (e.code === 'KeyK') params.showHomes = !params.showHomes
    else if (TOOL_KEYS[e.code]) params.tool = TOOL_KEYS[e.code]
    else if (e.code === 'KeyT') params.paused = !params.paused
    else return
    e.preventDefault()
  },
  { capture: true },
)

// ─── Loop ────────────────────────────────────────────────────────────────────

buildEnvironment()
const ready = rebuild()
// The sounds synthesized in the loading screen's last stage rather than at their first use, for the usual output rate:
// at another they are made at first use.
const SAMPLE_RATE = 48000
ready.then(() => {
  loading.begin('spawn')
  syncSquishSynth()
  if (params.sound) audio.prepare(SAMPLE_RATE)
  if (params.squish) squish.prepare(SAMPLE_RATE)
})

const _around = new THREE.Vector3()
const _shadowBox = new THREE.Box3()
const _shadowCorner = new THREE.Vector3()
const _bloodCenter = new THREE.Vector3()
const _figureDoorPoint = new THREE.Vector3()
const _figurePush = new THREE.Vector3()
const _squishAt = new THREE.Vector3()
const _walking = { moveSpeed: 0 } // the bat's sway: how fast the player walks
let squishPacked = -1 // the most of the body's worms held so far this run, 0–1 past squishFrom: −1 before any touch
let squishTime = 0 // sim s it was last updated: a replay or rebuild sends the clock back
const _bloodNormal = new THREE.Vector3(1, 0, 0)
const _bloodAlong = new THREE.Vector3(0, 0, -1)
let flashlightLevel = params.flashlight ? 1 : 0 // 0 off → 1 on, eased toward params.flashlight in real time

// three's shadow camera sits at its light, looking at the target, as LightShadow.updateMatrices places it: its box is
// the bounds' corners in that frame. three builds the projection only when a material sets the shadow up.
function fitShadowCamera(light, bounds) {
  const camera = light.shadow.camera
  camera.position.copy(light.position)
  camera.lookAt(light.target.position)
  camera.updateMatrixWorld()
  const { min, max } = bounds
  _shadowBox.makeEmpty()
  for (let i = 0; i < 8; i++) {
    _shadowCorner.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z)
    _shadowBox.expandByPoint(_shadowCorner.applyMatrix4(camera.matrixWorldInverse))
  }
  camera.left = _shadowBox.min.x
  camera.right = _shadowBox.max.x
  camera.bottom = _shadowBox.min.y
  camera.top = _shadowBox.max.y
  camera.near = -_shadowBox.max.z
  camera.far = -_shadowBox.min.z
  camera.updateProjectionMatrix()
}

// How much of the view the worms fill: of a grid of rays through it, edges included, the share that meets the body's
// field, grown by faceSkin where the worms lie on it, within faceReach of the eye. None while the eye is farther off.
const FACE_COLUMNS = 7
const FACE_ROWS = 4
const FACE_LEAST_STEP = 0.04 // m: the shortest step a ray marches the field by
const FACE_EDGE = 0.95 // the outermost rays, in NDC: the view's edges count
// m past the field's bounding sphere a ray's samples must stay to be skipped: well over the float rounding of
// distanceAt()
const FACE_SLACK = 1e-6
const _ray = new THREE.Vector3()
const _onRay = new THREE.Vector3()
const _toCenter = new THREE.Vector3()
let faceCover = 0 // the share now
let faceDarkness = 0 // 0–1, eased toward the cover past faceDarkFrom
function wormCover() {
  if (!mass) return 0
  const field = mass.field
  const reach = Math.max(params.faceReach, 0)
  const skin = params.faceSkin
  const eye = field.distanceAt(camera.position) - skin
  if (eye > reach) return 0
  // The field is nowhere less than the distance to its bounding sphere: a ray that stays more than `skin` outside it
  // within reach meets nothing, and isn't marched.
  const { center, radius } = field.boundingSphere
  const clear = radius + skin + FACE_SLACK
  _toCenter.subVectors(center, camera.position)
  let hits = 0
  for (let j = 0; j < FACE_ROWS; j++) {
    for (let i = 0; i < FACE_COLUMNS; i++) {
      _ray.set(FACE_EDGE * ((2 * i) / (FACE_COLUMNS - 1) - 1), FACE_EDGE * ((2 * j) / (FACE_ROWS - 1) - 1), 0.5)
      _ray.unproject(camera).sub(camera.position).normalize()
      const nearest = THREE.MathUtils.clamp(_toCenter.dot(_ray), 0, reach)
      const miss = _onRay.copy(_ray).multiplyScalar(nearest).distanceTo(_toCenter)
      if (miss > clear) continue
      // every ray's first sample is the eye
      let distance = eye
      for (let t = 0; t <= reach; ) {
        if (t > 0) distance = field.distanceAt(_onRay.copy(camera.position).addScaledVector(_ray, t)) - skin
        if (distance < 0) {
          hits++
          break
        }
        t += Math.max(distance, FACE_LEAST_STEP)
      }
    }
  }
  return hits / (FACE_COLUMNS * FACE_ROWS)
}

renderer.setAnimationLoop((time) => {
  timer.update(time)
  // the frame's compute and render alike: Start and the loading screen's hiding come between frames
  const recording = statsRecording()
  renderer.backend.trackTimestamp = canTime && recording
  // Two clocks: the player walks, turns and fades in real time; the world (the figure, the worms, the bat, the spray,
  // the doors) steps at most maxDeltaTime a frame, so a slow frame slows it rather than adding substeps.
  // The bat stays on the world's clock: batColliderRadius holds its sweep per substep.
  const real = Math.min(timer.getDelta(), params.maxPlayerDeltaTime)
  const frame = Math.min(real, params.maxDeltaTime)
  const elapsed = timer.getElapsed()

  // The camera: at the player's eye, walked and turned by the controls, then swayed as if handheld and jolted by hits.
  // The last frame's sway comes off first, or the controls would take it for a look.
  shake.restore(camera)
  syncControls()
  // touch: the stick walks forward and back and turns, tank-style, running past touchRunAt; Hit held swings
  touch.visible = touchShown() && !gameOver.shown && !loading.shown
  touch.deadZone = params.touchDeadZone
  touch.travel = params.touchTravel
  touch.reach = params.touchReach
  controls.moveInput.set(0, touch.stick.y)
  if (touch.stick.x !== 0) controls.turn(-touch.stick.x * THREE.MathUtils.degToRad(params.touchTurnSpeed) * real)
  if (touch.stick.length() >= params.touchRunAt) controls.speed *= params.playerRun
  if (touch.held) bat.swing()
  controls.update(real)
  if (params.playerRoam && params.doors) {
    restroom.shoveDoors(camera.position, controls.radius, controls.velocity, params.doorWalkPush)
  }
  shake.amplitude = params.handheld ? params.handheldAmplitude : 0
  shake.frequency = params.handheldFrequency
  shake.kickAmplitude = params.kickAmplitude
  shake.kickFrequency = params.kickFrequency
  shake.kickDecay = params.kickDecay
  shake.apply(camera, elapsed)
  // the bat: its swing, then its hit test against the field as the swing has left it
  viewModel.visible = params.bat && params.tool === 'Bat'
  viewModel.overlay = params.batOverWalls
  viewModel.windupDuration = params.batWindup
  viewModel.swingDuration = params.batSwing
  viewModel.followDuration = params.batFollow
  viewModel.recoverDuration = params.batRecover
  viewModel.swingPower = params.batSwingPower
  viewModel.cooldown = params.batCooldown
  const narrowing = 1 - THREE.MathUtils.smoothstep(camera.aspect, params.batNarrowAspect, params.batWideAspect)
  const restPose = (key) => THREE.MathUtils.lerp(params[`batRest${key}`], params[`batNarrow${key}`], narrowing)
  Object.assign(viewModel.poses.rest, {
    x: restPose('X'),
    y: restPose('Y'),
    z: restPose('Z'),
    elevation: restPose('Elevation'),
    azimuth: restPose('Azimuth'),
    roll: restPose('Roll'),
  })
  _walking.moveSpeed = controls.velocity.length()
  viewModel.update(frame, _walking)
  bat.update(frame)
  audio.volume = params.soundVolume

  // The scene: view, fog, restroom, lights, post-processing, materials, helpers and the status line, from the params.
  const fov = params.fov + bat.fovOffset
  if (camera.fov !== fov) {
    camera.fov = fov
    camera.updateProjectionMatrix()
  }
  faceCover = params.faceDark ? wormCover() : 0
  const faceTarget = THREE.MathUtils.smoothstep(faceCover, params.faceDarkFrom, 1)
  faceDarkness += (faceTarget - faceDarkness) * (1 - Math.exp(-real / Math.max(params.faceDarkTime, 1e-3)))
  renderer.toneMappingExposure = params.exposure * 2 ** (-params.faceDarkEV * faceDarkness)
  scene.background.set(params.fogColor)
  fog.color.set(params.fogColor)
  fog.density = params.fogDensity
  const fogged = params.fog ? fog : null
  // a change in the fog or the environment builds every pipeline anew: the hidden spray's now, not at a hit
  if (scene.fog !== fogged) {
    scene.fog = fogged
    spray.rewarm()
  }

  const around = figure ? _around.copy(figure.group.position).setY(0) : _around.set(0, 0, 0)
  const flicker = restroom.update(params, elapsed, around)
  const azimuth = THREE.MathUtils.degToRad(params.overheadAzimuth)
  const elevation = THREE.MathUtils.degToRad(params.overheadElevation)
  overhead.color.set(params.overheadColor)
  overhead.intensity = params.overhead ? params.overheadIntensity * flicker : 0
  overhead.position
    .set(Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.cos(azimuth))
    .multiplyScalar(10)
    .add(around)
  overhead.target.position.copy(around)
  const shadow = overhead.shadow
  const casting = params.shadows && params.overhead
  shadow.intensity = casting ? 1 : 0
  shadow.autoUpdate = casting
  if (shadow.mapSize.x !== params.shadowMapSize) shadow.mapSize.setScalar(params.shadowMapSize)
  shadow.radius = params.shadowRadius
  shadow.bias = params.shadowBias
  shadow.normalBias = params.shadowNormalBias
  shadowBounds.min.set(around.x - params.shadowExtent, 0, around.z - params.shadowExtent)
  shadowBounds.max.set(around.x + params.shadowExtent, params.shadowHeight, around.z + params.shadowExtent)
  fitShadowCamera(overhead, shadowBounds)

  hemisphere.color.set(params.skyColor)
  hemisphere.groundColor.set(params.groundColor)
  hemisphere.intensity = params.ambient ? params.ambientIntensity : 0
  scene.environmentIntensity = params.ambient ? params.envIntensity : 0

  flashlight.color.set(params.flashlightColor)
  const fade = params.flashlightFade > 0 ? real / params.flashlightFade : 1
  flashlightLevel = THREE.MathUtils.clamp(flashlightLevel + (params.flashlight ? fade : -fade), 0, 1)
  flashlight.intensity = params.flashlightIntensity * THREE.MathUtils.smoothstep(flashlightLevel, 0, 1)
  flashlight.angle = THREE.MathUtils.degToRad(params.flashlightAngle)
  flashlight.penumbra = params.flashlightPenumbra
  flashlight.distance = params.flashlightDistance
  flashlight.position.set(params.flashlightOffsetX, params.flashlightOffsetY, 0)
  flashlight.target.position.set(params.flashlightOffsetX, params.flashlightOffsetY, -1)

  setAO()
  occlusion.resolutionScale = params.aoResolution * sceneScale()
  occlusion.sliceCount = params.aoSlices
  occlusion.stepsPerSlice = params.aoSteps
  occlusion.temporalAccumulation = params.aoTemporalAccumulation
  occlusion.changeDetection = params.aoChangeDetection

  blurred.shutterAngle = params.shutterAngle
  blurred.maxBlurRadius = params.maxBlurRadius
  blurred.objectAmount = params.objectBlurAmount
  blurred.cameraRotationAmount = params.cameraRotationBlurAmount
  blurred.cameraTranslationAmount = params.cameraTranslationBlurAmount

  bloomNode.strength = params.bloomAmplitude
  bloomNode.radius = params.bloomRadius
  bloomNode.threshold = params.bloomThreshold

  syncDepthShade()
  syncBodyOcclusion()
  for (const material of [wormMaterial, worms?.material]) {
    if (!material) continue
    material.roughness = params.wormRoughness
    material.clearcoat = params.wormClearcoat
    material.clearcoatRoughness = params.wormClearcoatRoughness
    material.envMapIntensity = params.ambient ? params.wormEnvIntensity : 0
    material.sheen = params.wormSheen
    material.sheenColor.set(params.wormSheenColor)
    material.sheenRoughness = params.wormSheenRoughness
    material.emissive.set(params.wormGlow)
  }
  if (wormsHelper) wormsHelper.visible = params.debug && params.showHelper
  if (fieldHelper) fieldHelper.visible = params.debug && params.showField
  if (homesHelper) homesHelper.visible = params.debug && params.showHomes
  if (blurShown() !== blurring || aberrationShown() !== aberrating) setOutput()

  // still while paused, and while the loading screen waits for Start
  const still = params.paused || loading.waiting
  const step = still ? 0 : frame * bat.timeScale
  regroup.update()
  if (figure) figure.halted = regroup.waiting || startHolding()
  simulate(step)
  spray.material.color.set(params.sprayColor)
  spray.life = params.sprayLife
  // the blood on the stalls' wall, read left to right facing it
  _bloodCenter.set(restroom.bounds.min.x, params.writingY, params.writingZ)
  restroom.setBlood(params.writing ? writing.texture : null, {
    center: _bloodCenter,
    normal: _bloodNormal,
    along: _bloodAlong,
    width: writing.width,
    height: writing.height,
  })
  spray.irregularity = params.sprayIrregularity
  spray.spikes = params.spraySpikes
  spray.tail = params.sprayTail
  spray.update(step, restroom.bounds)
  // the stall doors swing in the sim's time, shoved by a roaming figure walking into them; one meeting a stop bangs as
  // hard as it met it
  if (params.doors && figure && params.figureRoam && params.path === 'approach') {
    _figureDoorPoint.copy(figure.group.position).setY(1)
    const heading = figure.path.heading
    _figurePush.set(Math.sin(heading), 0, Math.cos(heading)).multiplyScalar(figure.walkingSpeed)
    restroom.shoveDoors(_figureDoorPoint, params.figureRadius, _figurePush, params.doorWalkPush)
  }
  if (params.doors) {
    for (const speed of restroom.swingDoors(params, step)) {
      if (params.sound && !bat.quiet) audio.bang(Math.min(speed / Math.max(params.doorMaxSpeed, 1e-3), 1.2))
    }
  }

  // The body's closeness to the eye: the swallow. Swallowed, the player walks no more.
  const closeness = worms && !building ? mass.field.distanceAt(camera.position) : Infinity
  if (worms && !building) gameOver.update(closeness < params.engulfDepth, simTime)
  // the player waits for the worms
  controls.enabled = !loading.shown && gameOver.swallowedAt === null
  // the cursor back for the replay click
  if (gameOver.shown) controls.unlock()
  // The worms squishing together, continuously from the first worms touching: squishLow, growing with the most of the
  // body's worms held so far this run (a hit knocking them off doesn't lower it), more walking than standing; muffled
  // once the eye is in them. Silent while still.
  if (figure) {
    if (simTime < squishTime) squishPacked = -1
    squishTime = simTime
    if (status.countedAt >= 0 && status.homed > 0 && status.held > 0) {
      const packed = THREE.MathUtils.smoothstep(status.held / status.homed, params.squishFrom, params.squishTo)
      squishPacked = Math.max(squishPacked, packed)
    }
    const pace = THREE.MathUtils.clamp(
      figure.walkingSpeed / Math.max(figure.strideSpeed * params.walkSpeed, 1e-3),
      0,
      1,
    )
    const level = squishPacked < 0 ? 0 : THREE.MathUtils.lerp(params.squishLow, 1, squishPacked)
    squish.activity = params.squish && !still ? level * THREE.MathUtils.lerp(params.squishIdle, 1, pace) : 0
    squish.muffle = THREE.MathUtils.smoothstep(params.faceSkin - closeness, 0, params.squishMuffleDepth)
    squish.volume = params.squishVolume
    squish.density = params.squishDensity
    squish.grainLength = params.squishGrain
    squish.grainSpread = params.squishGrainSpread
    squish.pitch = params.squishPitch
    squish.pitchSpread = params.squishPitchSpread
    squish.reverse = params.squishReverse
    squish.tone = params.squishTone
    squish.smoothing = params.squishSmoothing
    squish.distance = params.squishDistance
    squish.rolloff = params.squishRolloff
    squish.room = params.squishRoom
    squish.muffleTone = params.squishMuffleTone
    squish.slaps = params.squishSlaps
    squish.slapPan = params.squishSlapPan
    syncSquishSynth()
    // from the worms nearest the eye, faceSkin outside the body's field, toward its middle
    _squishAt.copy(figure.group.position).addScaledVector(UP, params.figureHeight * params.squishHeight)
    _squishAt.sub(camera.position)
    const middle = _squishAt.length()
    const nearest = THREE.MathUtils.clamp(closeness - params.faceSkin, 0, middle)
    _squishAt.multiplyScalar(nearest / Math.max(middle, 1e-6)).add(camera.position)
    squish.update(real, _squishAt, camera)
  }
  if (params.debug) {
    if (fieldHelper && params.showField) {
      fieldHelper.showShell = params.showShell
      fieldHelper.update()
    }
    if (homesHelper && params.showHomes) homesHelper.update()
  }
  // the regroup, the start's walk-off and the squish wait on these counts
  if (
    !counting &&
    worms &&
    !building &&
    simTime > 0 &&
    elapsed - countedAt >= 0.5 &&
    (params.regroup || params.squish || startGather() >= 0)
  ) {
    countStates(elapsed)
  }
  blurred.deltaTime = real > 0 ? real : null

  // the velocity's unjittered projection, kept live while TAAU is off
  syncUnjitteredProjection(camera)
  if (precompiled) renderPipeline.render()
  // the worms are in once a build has finished; a run without any spawns too
  loading.update(figure !== null && !building)

  if (recording) stats.update()
  if (renderer.backend.trackTimestamp) {
    renderer.resolveTimestampsAsync('render')
    renderer.resolveTimestampsAsync('compute')
  }
  // Auto's tier from the frame times, last, after the frame's submits: while the scene runs, not still, building,
  // behind the loading screen or swallowed; restarted each time it runs again.
  const governing =
    params.tier === 'Auto' &&
    params.monitorPerformance &&
    governable &&
    !still &&
    !building &&
    !loading.shown &&
    worms !== null &&
    gameOver.swallowedAt === null
  if (governing) {
    if (!governed) governor.reset()
    governor.targetFrameTime = 1000 / Math.max(params.governorTarget, 1)
    governor.update(renderer, time)
  }
  governed = governing
})
