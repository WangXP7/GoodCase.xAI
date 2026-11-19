import * as THREE from 'three/webgpu'
import {
  Fn,
  If,
  Loop,
  float,
  int,
  uint,
  vec2,
  vec3,
  vec4,
  uniform,
  uniformArray,
  uniformGroup,
  instancedArray,
  instanceIndex,
  length,
  normalize,
  cross,
  dot,
  abs,
  min,
  max,
  mix,
  clamp,
  select,
  sin,
  cos,
  tan,
  exp,
  sqrt,
  atan,
  floor,
  smoothstep,
  uintBitsToFloat,
  atomicAdd,
  atomicLoad,
  atomicStore,
  positionLocal,
} from 'three/tsl'
import { NoodleSimulation, NoodleSimulationHelper } from './NoodleSimulation.js'

/**
 * WormSimulation — soft worms that crawl, climb a moving body and pile up on it: NoodleSimulation chains driven only by
 * velocity changes and muscle bend constraints, so the noodles' stretch, bend, contacts, colliders and step bound
 * always have the last word. A body field (a signed distance with a normal and a velocity, see options.field)
 * makes worms nearly weightless inside it, presses them in at its skin and drags them along with the body; the gravity
 * left fills it from the bottom up, and worms that don't fit hang, drip and crawl back. Everything after loading runs
 * on the GPU: the CPU sends settings, rays and events, and reads nothing back.
 *
 *   // BodyField: round cones on a skinned mesh's bones, from examples/utils/BodyField.js
 *   const field = BodyField.fromSkinnedMesh(body, {
 *     inflateTop: 0.1, // room round the body for the worms, m
 *     inflateBottom: 0.42, // more at the floor, where they pile up
 *     coreMargin: 0.06, // colliders a little fatter than the cones
 *     maxBodySpeed: 3, // the fastest the body drags them, m/s
 *   })
 *   const worms = new WormSimulation(curves, material, { field, states, radius: 0.024, particlesPerNoodle: 18 })
 *   worms.colliders.push(...field.colliders, ...props)
 *   scene.add(worms)
 *   scene.add(new WormSimulationHelper(worms))   // optional: capsules coloured by state, a cube at each goal
 *
 *   renderer.setAnimationLoop(() => {
 *     mixer.update(dt); body.updateMatrixWorld(true)
 *     field.update(dt)
 *     worms.leadVelocity.copy(rootVelocity)
 *     worms.update(renderer, dt)                 // one renderer.compute()
 *     renderer.render(scene, camera)
 *   })
 *
 *   worms.poke(raycaster); worms.blast(raycaster); worms.strike(center, direction, { end }); worms.collapse()
 *   worms.pick(raycaster); worms.grabPicked(); worms.moveGrabAlongRay(ray); worms.endGrab(); worms.reset()
 *   worms.reset({ clock: true })                 // the clock and frame count too: the run from construction again
 *   worms.updateFillCapacity()                   // after the body's pose or size changes
 *
 *   // gathering loose worms in order (options.catchOrders, such as their homes' heights for feet first):
 *   worms.crawlBack = false; worms.catchLevel = rising; worms.catchRadius = growing
 *   // or nearest first, the rest crawling in to meet the growing radius:
 *   worms.catchCrawling = true; worms.catchRadius = growing
 *
 * `curves` are the worms' starting poses, head first. Without a field, worms crawl to `home`. Each worm is in a
 * WormState, updated once a frame: LOOSE (falls, writhes, its grip fading), CRAWLING (serpentine on the floor toward
 * the body), CLIMBING (swims up the field, its grip rising) and HELD (writhes in the field, its grip full).
 */

/** A worm's state, wormData W0.x. */
export const WormState = Object.freeze({ LOOSE: 0, CRAWLING: 1, CLIMBING: 2, HELD: 3 })

const { LOOSE, CRAWLING, CLIMBING, HELD } = WormState
// vec4 per worm in wormData, after 1 per particle; then 1 more per worm, the peristaltic wave's.
const WORM_VEC4 = 6
// vec4 per worm the measure pass writes: [share in the field, mean depth, burial, fill front], [field normal sum,
// supported particles], [support normal sum, firmly supported], [head's field normal, head's field distance],
// [particles on the floor, highest point (world y), 0, 0].
const MEASURE_VEC4 = 5
// The most fill layers.
const MAX_FILL_LAYERS = 256
// Up to here NoodleSimulation keeps a noodle in workgroup memory and its pass binds 7 storage buffers; past it 8, and
// the worms' hook would add a 9th, over WebGPU's default limit.
const MAX_PARTICLES = 170

const WORM_OPTION_KEYS = [
  'field',
  'states',
  'cooldowns',
  'catchOrders',
  'headRounding',
  'tailTaper',
  'tailTip',
  'fillLayers',
  'fillLayerHeight',
]
// Settings only the CPU reads: no uniform.
const CPU_SETTINGS = ['packing']

const WORM_SETTINGS = {
  // Gait
  amplitude: 1,
  crawlAmplitude: 1,
  crawlWavelength: 1,
  climbAmplitude: 0.8,
  tailAmplitude: 1,
  wavelength: 0.9,
  frequency: 1.8,
  muscleCompliance: 1,
  heldAmplitude: 0.15,
  looseAmplitude: 0.2,
  restMemory: 0.5,
  curl: 0,
  looseCurl: 0,
  curlVariation: 0.5,
  curlWaves: 1,
  curlThreshold: 2,
  writheRate: 3,
  chirality: 0.7,
  looseChirality: 0.36,
  temperature: 1,
  gaitMemory: 0.05,
  buriedDamping: 0.6,
  tailWaveSpan: 1 / 3,
  looseEaseIn: 0.5,
  serpentine: 1,
  squirm: 0,
  squirmFrequency: 1.5,
  squirmWaves: 1.2,
  squirmLift: 0.5,
  squirmBursts: 0.5,
  squirmHead: 1,
  heldSquirm: 0,
  peristalsis: 0,
  peristalsisFrequency: 2,
  peristalsisWaves: 1,
  // Steering
  steeringGain: 2.5,
  maxBias: 3,
  headPull: 0.1,
  stuckTime: 8,
  backupTime: 1.5,
  detourDistance: 1,
  detourTime: 3,
  detourSideTime: 20,
  pursuitLead: 1,
  crawlSpeed: 1,
  // Friction on the ground and colliders
  forwardFriction: 0.05,
  backwardFriction: 0.5,
  lateralFriction: 1,
  looseIsotropy: 0,
  yieldSpeed: 0.1,
  heldFriction: 0,
  // Adhesion
  adhesionPull: 2,
  heldAdhesion: 0,
  breakGap: 0.5,
  breakSpeed: 1.5,
  restickDelay: 0.4,
  // Field
  buoyancy: 0.88,
  climbBuoyancy: 1,
  skinPull: 1.2,
  squeeze: 0,
  climbPull: 0.4,
  climbHeadPull: 0.3,
  rearPull: 0,
  rearShare: 0.3,
  rearTime: 6,
  rearSpan: 0.25,
  maxFieldAcceleration: 3,
  lateralDrag: 6,
  axialDrag: 1.5,
  gripTime: 0.5,
  capture: 0.12,
  skinDepth: 0.1,
  // States
  fillFraction: 0.8,
  packing: 0.3,
  dripRate: 0.01,
  knockTime: 1.5,
  spillHeight: Infinity,
  spillTime: 0.25,
  wanderChance: 0.7,
  wanderTime: 15,
  wanderSpread: 1,
  wanderMinDistance: 1.5,
  wanderMaxDistance: 3,
  arrivalRadius: 0.25,
  climbTimeout: 20,
  timeoutCooldown: 5,
  collapseTime: 3,
  collapseStagger: 2,
  looseRest: 0.3,
  catchShare: 0.5,
  catchTime: 0.5,
  catchRadius: Infinity,
  catchLevel: Infinity,
  knockOffTime: 1,
  holdShare: 0.7,
  climbStallTime: 3,
  climbSlipShare: 0.1,
  climbSlipTime: 1,
  strayShare: 0.4,
  climbGiveUpTime: 8,
  heldSlipShare: 0.3,
  heldSlipTime: 1.5,
  // Tools
  toolCooldown: 3,
  pokeRadius: 0.3,
  pokeSpeed: 1.5,
  blastRadius: 0.7,
  blastSpeed: 6,
  strikeRadius: 0.35,
  strikeSpeed: 8,
  strikeSpread: 0.35,
  strikeTumble: 0.6,
  strikeLocality: 0,
}

const _matrix = new THREE.Matrix4()
const STRIKE_OPTIONS = ['end', 'from', 'fromEnd']
// The thinnest tail tip wormRadiusProfile() gives, × the widest radius.
const MIN_TAIL_TIP = 1e-3
// Segments between a strike's last and its present one that its swept space is measured against, less one.
const STRIKE_SWEEP = 4

// murmur3's finalizer, a uint hash; random() in [0, 1).
const fmix32 = (h) => {
  const a = h
    .bitXor(h.shiftRight(uint(16)))
    .mul(uint(0x85ebca6b))
    .toVar()
  const b = a
    .bitXor(a.shiftRight(uint(13)))
    .mul(uint(0xc2b2ae35))
    .toVar()
  return b.bitXor(b.shiftRight(uint(16)))
}
const random = (seed) => float(fmix32(seed).shiftRight(uint(8))).div(16777216)
// The same on the CPU.
const random01 = (seed) => {
  let h = seed >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 8) / 16777216
}

/**
 * The worm's radius along it, as multipliers of the widest: u from 0 (head) to 1 (tail tip). A rounded head over
 * `headRounding` of the length, from 0.8 at the tip, a uniform body, and a taper over the last `tailTaper` to `tailTip`
 * (at least 0.001).
 */
export function wormRadiusProfile(points, { headRounding = 0.05, tailTaper = 0.45, tailTip = 0.12 } = {}) {
  // A step where the band is empty (no taper).
  const smooth = (a, b, x) => {
    if (!(b > a)) return x >= b ? 1 : 0
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)
  }
  // NoodleSimulation takes radii above 0 only.
  const tip = Math.max(tailTip, MIN_TAIL_TIP)
  return Array.from({ length: points }, (_, i) => {
    const u = i / (points - 1)
    const head = headRounding > 0 ? 0.8 + 0.2 * Math.sin((Math.min(1, u / headRounding) * Math.PI) / 2) : 1
    return head * (1 - (1 - tip) * smooth(1 - tailTaper, 1, u))
  })
}

export class WormSimulation extends NoodleSimulation {
  isWormSimulation = true
  type = 'WormSimulation'

  /** Gait: peak bend per joint, as A · 2π / wavelength per body length: the wave the others scale. */
  amplitude = WORM_SETTINGS.amplitude
  /** Gait: the crawling wave's amplitude, × amplitude. */
  crawlAmplitude = WORM_SETTINGS.crawlAmplitude
  /** Gait: the crawling wave's wavelength, × wavelength: the held and loose writhe keep theirs. */
  crawlWavelength = WORM_SETTINGS.crawlWavelength
  /** Gait: the climbing wave's amplitude, × amplitude: above 1, a flat crawl still swims up the field. */
  climbAmplitude = WORM_SETTINGS.climbAmplitude
  /** Gait: share of the wave left at the tail tip (over tailWaveSpan): below 1 the light tip doesn't whip. */
  tailAmplitude = WORM_SETTINGS.tailAmplitude
  /** Gait: wavelength of the wave, body lengths. */
  wavelength = WORM_SETTINGS.wavelength
  /** Gait: Hz, crawling and climbing. */
  frequency = WORM_SETTINGS.frequency
  /** Muscle compliance (XPBD, × spacing⁴ like bendingCompliance), ÷ the activation: lower is stronger. */
  muscleCompliance = WORM_SETTINGS.muscleCompliance
  /** Writhe amplitude when held, × temperature; buried worms writhe less. */
  heldAmplitude = WORM_SETTINGS.heldAmplitude
  /** Writhe amplitude when loose, × temperature. */
  looseAmplitude = WORM_SETTINGS.looseAmplitude
  /** s: held and loose, the rest curvature follows their curl, or the current one, this slowly. */
  restMemory = WORM_SETTINGS.restMemory
  /** 1/m: held, the rest curvature eases toward this curl, coiling whichever way the worm lies; 0 keeps its bend. */
  curl = WORM_SETTINGS.curl
  /** 1/m: the same when loose. */
  looseCurl = WORM_SETTINGS.looseCurl
  /** Share the curl varies by along each worm, so coils run into arcs. */
  curlVariation = WORM_SETTINGS.curlVariation
  /** Cycles of that variation along each worm, each worm at its own phase. */
  curlWaves = WORM_SETTINGS.curlWaves
  /** 1/m: the curl fades in as a joint's coherent bend (over two spans either side) reaches this, from half of it. */
  curlThreshold = WORM_SETTINGS.curlThreshold
  /** rad/s the writhe's wave plane turns at. */
  writheRate = WORM_SETTINGS.writheRate
  /** γ = α / (2πλ) of the writhe when held (Patil et al. 2023): near 0.7 worms tangle. */
  chirality = WORM_SETTINGS.chirality
  /** γ otherwise: near 0.36 worms untangle. */
  looseChirality = WORM_SETTINGS.looseChirality
  /** Scales the writhe's amplitude, frequency and flip rate: cold is firm and tangled, warm runny. */
  temperature = WORM_SETTINGS.temperature
  /** s: crawling and climbing, the rest curvature follows the wave this slowly. */
  gaitMemory = WORM_SETTINGS.gaitMemory
  /** Share of the held writhe a fully buried worm (4 contacts a segment) loses. */
  buriedDamping = WORM_SETTINGS.buriedDamping
  /** Share of the body, from the tail tip, over which the wave eases to tailAmplitude. */
  tailWaveSpan = WORM_SETTINGS.tailWaveSpan
  /** s the loose writhe eases in over. */
  looseEaseIn = WORM_SETTINGS.looseEaseIn
  /** Share of the travelling bend wave, the serpentine crawl and swim, crawling and climbing. */
  serpentine = WORM_SETTINGS.serpentine
  /** Rad per body length: the squirm, a chaotic bend, crawling and climbing. */
  squirm = WORM_SETTINGS.squirm
  /** Hz: the squirm's typical frequency. */
  squirmFrequency = WORM_SETTINGS.squirmFrequency
  /** Cycles per body length: the squirm's typical wavenumber. */
  squirmWaves = WORM_SETTINGS.squirmWaves
  /** Share of a right angle the squirm's plane tips out of the surface's, at most: the body arches and twists. */
  squirmLift = WORM_SETTINGS.squirmLift
  /** 0–1: how far the squirm fades between bursts. */
  squirmBursts = WORM_SETTINGS.squirmBursts
  /** Share of the squirm a crawler's head takes, eased up to all of it over the front 40%: the head steers. */
  squirmHead = WORM_SETTINGS.squirmHead
  /** Share of the squirm held and loose worms take, in the writhe's plane. */
  heldSquirm = WORM_SETTINGS.heldSquirm
  /** Share each segment's rest length swings by, crawling: the peristaltic wave, head to tail. */
  peristalsis = WORM_SETTINGS.peristalsis
  /** Hz of the peristaltic wave. */
  peristalsisFrequency = WORM_SETTINGS.peristalsisFrequency
  /** Peristaltic waves along the body. */
  peristalsisWaves = WORM_SETTINGS.peristalsisWaves

  /** Steering: bias per radian of heading error. */
  steeringGain = WORM_SETTINGS.steeringGain
  /** Steering: the most bias (rad per body length) on the leading two-thirds. */
  maxBias = WORM_SETTINGS.maxBias
  /** g of pull on a crawler's head along the surface toward its goal, so it never stalls. */
  headPull = WORM_SETTINGS.headPull
  /** s without progress before a crawler backs up. */
  stuckTime = WORM_SETTINGS.stuckTime
  /** s a crawler backs up for, its wave running tail to head. */
  backupTime = WORM_SETTINGS.backupTime
  /** m to a random side of its goal a crawler heads after backing up, round what blocked it; 0: none. */
  detourDistance = WORM_SETTINGS.detourDistance
  /** s it heads there before it turns back to its goal. */
  detourTime = WORM_SETTINGS.detourTime
  /** s each worm keeps its detour side for, so repeated detours work along what blocks the way. */
  detourSideTime = WORM_SETTINGS.detourSideTime
  /** s, the most a crawler leads the moving body by (leadVelocity). */
  pursuitLead = WORM_SETTINGS.pursuitLead
  /** m/s a crawler is assumed to make, for the lead. */
  crawlSpeed = WORM_SETTINGS.crawlSpeed

  /** Coulomb coefficients on the ground and colliders, crawling and loose: toward the head, the tail, sideways. */
  forwardFriction = WORM_SETTINGS.forwardFriction
  backwardFriction = WORM_SETTINGS.backwardFriction
  lateralFriction = WORM_SETTINGS.lateralFriction
  /** 0–1: how far a loose worm's forward and backward friction go to lateralFriction; 1 sticks to walls every way. */
  looseIsotropy = WORM_SETTINGS.looseIsotropy
  /** Body lengths/s: a particle on a surface sliding slower stops, as mucus under a still foot. */
  yieldSpeed = WORM_SETTINGS.yieldSpeed
  /** Coulomb coefficient on the ground and colliders for held worms, the same every way. */
  heldFriction = WORM_SETTINGS.heldFriction

  /** Worms stick to the ground and colliders. */
  adhesion = true
  /** g of adhesion pull on crawling and loose worms, counted by friction as load. */
  adhesionPull = WORM_SETTINGS.adhesionPull
  /** Share of adhesionPull on held and climbing worms. */
  heldAdhesion = WORM_SETTINGS.heldAdhesion
  /** × radius: a stuck contact lets go past this gap. */
  breakGap = WORM_SETTINGS.breakGap
  /** m/s: a stuck contact lets go separating faster. */
  breakSpeed = WORM_SETTINGS.breakSpeed
  /** s before a contact that let go can stick again. */
  restickDelay = WORM_SETTINGS.restickDelay

  /** Share of gravity the field lifts off a held or loose worm inside it, × its grip: the rest fills it bottom-up. */
  buoyancy = WORM_SETTINGS.buoyancy
  /** Share of gravity the field lifts off a climbing worm, × its grip: its swim can't lift much more. */
  climbBuoyancy = WORM_SETTINGS.climbBuoyancy
  /** g pressing held worms in at the field's skin. */
  skinPull = WORM_SETTINGS.skinPull
  /** g pressing held and climbing worms inward everywhere inside the field, never upward; 0: only the skin pull. */
  squeeze = WORM_SETTINGS.squeeze
  /** g pressing climbing worms in at the field's skin. */
  climbPull = WORM_SETTINGS.climbPull
  /** g pulling a climber's head up along the field, then in at the fill front. */
  climbHeadPull = WORM_SETTINGS.climbHeadPull
  /** g lifting a rearing held worm's leading quarter where the field's top faces up; 0 turns rearing off. */
  rearPull = WORM_SETTINGS.rearPull
  /** Share of the held worms that rear, chosen again every rearTime. */
  rearShare = WORM_SETTINGS.rearShare
  /** s a worm rears, or doesn't, before it is chosen again. */
  rearTime = WORM_SETTINGS.rearTime
  /** Share of the body, from the head, a rearing worm lifts, easing out toward its end. */
  rearSpan = WORM_SETTINGS.rearSpan
  /** g, the most lift and skin pull add together. */
  maxFieldAcceleration = WORM_SETTINGS.maxFieldAcceleration
  /** 1/s of drag across the worm, relative to the body (resistive force theory). */
  lateralDrag = WORM_SETTINGS.lateralDrag
  /** 1/s of drag along the worm, relative to the body. */
  axialDrag = WORM_SETTINGS.axialDrag
  /** s a worm's grip takes to rise or fade. */
  gripTime = WORM_SETTINGS.gripTime
  /** m outside the field where its hold fades out. */
  capture = WORM_SETTINGS.capture
  /** m inside the field the skin pull reaches. */
  skinDepth = WORM_SETTINGS.skinDepth

  /** Share of a layer's capacity at which the fill front moves past it. */
  fillFraction = WORM_SETTINGS.fillFraction
  /** Share of the field's volume worms fill. */
  packing = WORM_SETTINGS.packing
  /** Per second: the chance a held worm at the field's edge, or lying on the floor at the base, lets go. */
  dripRate = WORM_SETTINGS.dripRate
  /** s a dripped worm can't be caught or crawl. */
  knockTime = WORM_SETTINGS.knockTime
  /** m, world height: a held worm with any part above it for spillTime lets go, as a drip does. Infinity: none does. */
  spillHeight = WORM_SETTINGS.spillHeight
  /** s a held worm stays above spillHeight before it lets go: an end flicked up by a lurch drops back sooner. */
  spillTime = WORM_SETTINGS.spillTime
  /** Share of fallen worms that first crawl off to a point wanderMinDistance–wanderMaxDistance out, then come back. */
  wanderChance = WORM_SETTINGS.wanderChance
  /** s a wander lasts on average, from ⅔ to 4⁄3 of it. */
  wanderTime = WORM_SETTINGS.wanderTime
  /** rad: a wander's heading spreads this far either side of its direction out. */
  wanderSpread = WORM_SETTINGS.wanderSpread
  /** m from its head, at least, a wanderer's point lies. */
  wanderMinDistance = WORM_SETTINGS.wanderMinDistance
  /** m, at most. */
  wanderMaxDistance = WORM_SETTINGS.wanderMaxDistance
  /** m: a wanderer whose head is this close to its point lies still, its muscles off, until the wander ends. */
  arrivalRadius = WORM_SETTINGS.arrivalRadius
  /** A wanderer at its point or a loose worm in its cooldown lies still anywhere; off, only partly in the field. */
  restOutside = true
  /** s a worm may climb before it lets go. */
  climbTimeout = WORM_SETTINGS.climbTimeout
  /** s of cooldown after a climb timed out. */
  timeoutCooldown = WORM_SETTINGS.timeoutCooldown
  /** s collapse() keeps worms loose, plus up to collapseStagger. */
  collapseTime = WORM_SETTINGS.collapseTime
  /** s of stagger, at random per worm, added to collapseTime. */
  collapseStagger = WORM_SETTINGS.collapseStagger
  /** s a loose worm rests on something before it crawls, or before it lies still in its cooldown. */
  looseRest = WORM_SETTINGS.looseRest
  /** A loose worm with this share of its particles in the field for catchTime is caught: held. */
  catchShare = WORM_SETTINGS.catchShare
  catchTime = WORM_SETTINGS.catchTime
  /** m across the floor from catchCenter past which a loose worm isn't caught but crawls back; Infinity: anywhere. */
  catchRadius = WORM_SETTINGS.catchRadius
  /**
   * A loose worm is caught, and a crawler climbs, only once catchLevel reaches its catch order (options.catchOrders):
   * raised over time, it gathers the worms in that order. Infinity: in any order.
   */
  catchLevel = WORM_SETTINGS.catchLevel
  /** A loose worm out of reach crawls back once its cooldown ends and it is supported; off, it lies where it fell. */
  crawlBack = true
  /** A crawler in reach for catchTime is caught like a loose worm; off, it is held only once it climbs the field. */
  catchCrawling = false
  /** s a crawler goes unsupported before it comes loose. */
  knockOffTime = WORM_SETTINGS.knockOffTime
  /** Share in the field a climber needs to be held, at the fill front or once it stalls. */
  holdShare = WORM_SETTINGS.holdShare
  /** s a climber gains no height (5 cm) before it stalls. */
  climbStallTime = WORM_SETTINGS.climbStallTime
  /** A climber with under this share in the field for climbSlipTime comes loose. */
  climbSlipShare = WORM_SETTINGS.climbSlipShare
  climbSlipTime = WORM_SETTINGS.climbSlipTime
  /** A climber with under this share in the field for climbGiveUpTime gives up and wanders off. */
  strayShare = WORM_SETTINGS.strayShare
  climbGiveUpTime = WORM_SETTINGS.climbGiveUpTime
  /** A held worm with under this share in the field for heldSlipTime comes loose. */
  heldSlipShare = WORM_SETTINGS.heldSlipShare
  heldSlipTime = WORM_SETTINGS.heldSlipTime

  /** s of cooldown a grab, a poke, a blast or a strike leaves: a worm neither crawls nor is caught until it ends. */
  toolCooldown = WORM_SETTINGS.toolCooldown
  /** Poke: m around the hit, m/s kick. */
  pokeRadius = WORM_SETTINGS.pokeRadius
  pokeSpeed = WORM_SETTINGS.pokeSpeed
  /** Blast: m around the hit, m/s at its centre. */
  blastRadius = WORM_SETTINGS.blastRadius
  blastSpeed = WORM_SETTINGS.blastSpeed
  /** Strike: m around its centre (or segment), m/s along its direction at the centre. */
  strikeRadius = WORM_SETTINGS.strikeRadius
  strikeSpeed = WORM_SETTINGS.strikeSpeed
  /** 0–1: how far each struck worm's flight turns off the direction, at random. */
  strikeSpread = WORM_SETTINGS.strikeSpread
  /** ± share of the speed one end of a struck worm gains over the other: it flies tumbling end over end. */
  strikeTumble = WORM_SETTINGS.strikeTumble
  /** 0: a struck worm flies as one; 1: each particle by its own distance, so the near end is yanked ahead. */
  strikeLocality = WORM_SETTINGS.strikeLocality

  /** Where crawlers head without a field (object space). */
  home = new THREE.Vector3()
  /** World space: where catchRadius is measured from, such as the body's base. */
  catchCenter = new THREE.Vector3()
  /** The body's velocity (world space): crawlers lead it by up to pursuitLead. */
  leadVelocity = new THREE.Vector3()
  /** World space, flattened: wandering crawlers head out this way, by its length against 1 for straight out. */
  wanderDirection = new THREE.Vector3()

  #w // the worm buffers, uniforms and passes
  #field
  #source
  #events = { collapse: false, reset: false, tool: 0 }
  #grabRay = false
  #warned = []
  #renderer = null
  #compiling = null
  #disposed = false
  #clock = 0

  /**
   * @param {THREE.Curve|THREE.Curve[]} curves - One per worm, head first: its starting pose.
   * @param {THREE.Material} [material]
   * @param {object} [options] - NoodleSimulation's (radius: the widest, default 0.024; particlesPerNoodle, default
   *   18, at most 170; radiusProfile, by default wormRadiusProfile() of the three below; contactLanes and
   *   colliderCulling, default true; partnerHash, default true: false when nothing reads couplingData's particle
   *   hash), and:
   * @param {object} [options.field] - The body: `sample(position, alpha)` (TSL: distance, normal, velocity),
   *   `volumeByHeight(step, count, out)`, `floor` and `boundingSphere`: a still ball as in worms.html, or the
   *   BodyField in examples/utils.
   * @param {ArrayLike<number>} [options.states] - Each worm's WormState at the start and after reset(); LOOSE default.
   * @param {ArrayLike<number>} [options.cooldowns] - Each worm's cooldown at the start and after reset(), s: until it
   *   ends a loose worm lies where it is, neither crawling nor caught. 0 by default.
   * @param {ArrayLike<number>} [options.catchOrders] - Each worm's catch order, compared with catchLevel. 0 by default.
   * @param {number} [options.headRounding=0.05] - Share of the length the head rounds over.
   * @param {number} [options.tailTaper=0.45] - Share of the length the tail tapers over.
   * @param {number} [options.tailTip=0.12] - The tail tip's radius, × the widest (at least 0.001).
   * @param {number} [options.fillLayerHeight=0.1] - m: the fill front's layers, from the field's floor up.
   * @param {number} [options.fillLayers] - How many, at most 256; by default up to the top of the field's
   *   boundingSphere at construction, else 20.
   */
  constructor(curves, material = null, options = {}) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new Error('WormSimulation: the third argument is an options object, { field, states, radius, … }.')
    }
    const list = Array.isArray(curves) ? curves : [curves]
    const P = options.particlesPerNoodle ?? 18
    if (P > MAX_PARTICLES) {
      throw new Error(
        `WormSimulation: particlesPerNoodle ${P} is over ${MAX_PARTICLES}: the noodles pass would bind 9 storage buffers.`,
      )
    }
    const radius = options.radius ?? 0.024
    const M = list.length
    let field = options.field ?? null
    if (field !== null && typeof field.sample !== 'function') {
      console.warn('WormSimulation: options.field needs sample(position, alpha); ignored.')
      field = null
    }
    const layerHeight = options.fillLayerHeight ?? 0.1
    if (!(typeof layerHeight === 'number' && layerHeight > 0 && Number.isFinite(layerHeight))) {
      throw new Error(`WormSimulation: options.fillLayerHeight must be a number > 0 (got ${layerHeight}).`)
    }
    let layers = options.fillLayers
    if (layers === undefined) {
      const sphere = field?.boundingSphere
      const floorY = Number.isFinite(field?.floor) ? field.floor : 0
      const top = sphere?.isSphere && !sphere.isEmpty() ? sphere.center.y + sphere.radius : floorY + 20 * layerHeight
      layers = Math.ceil((top - floorY) / layerHeight)
    }
    if (!(typeof layers === 'number' && layers >= 1)) {
      throw new Error(`WormSimulation: options.fillLayers must be a number ≥ 1 (got ${layers}).`)
    }
    layers = Math.min(Math.round(layers), MAX_FILL_LAYERS)
    const perWorm = (key, what) => {
      const value = options[key] ?? null
      if (value !== null && !(Array.isArray(value) || ArrayBuffer.isView(value))) {
        throw new Error(`WormSimulation: options.${key} must be an array of ${what}, one per worm.`)
      }
      return value
    }
    const states = perWorm('states', 'WormState values')
    const cooldowns = perWorm('cooldowns', 'seconds')
    const catchOrders = perWorm('catchOrders', 'numbers')
    const profile =
      options.radiusProfile ??
      wormRadiusProfile(P, {
        headRounding: options.headRounding,
        tailTaper: options.tailTaper,
        tailTip: options.tailTip,
      })
    const noodleOptions = { radius, particlesPerNoodle: P, radiusProfile: profile }
    for (const [key, value] of Object.entries(options)) {
      if (WORM_OPTION_KEYS.includes(key) || key in noodleOptions) continue
      if (key === 'noodleHook') {
        console.warn('WormSimulation: the worms own options.noodleHook; ignored.')
        continue
      }
      // NoodleSimulation warns on the keys it doesn't know.
      noodleOptions[key] = value
    }
    // Built before the noodles pass, whose hook reads them.
    const w = createWormState(M, P, states, cooldowns, catchOrders, layers, layerHeight)
    noodleOptions.noodleHook = (stage, context) => wormHook(w, stage, context)
    // Worms pile densely, where the 32-lane contacts pass is faster.
    noodleOptions.contactLanes ??= true
    // A worm reaches few of a scene's colliders.
    noodleOptions.colliderCulling ??= true
    super(curves, material, noodleOptions)
    this.#w = w
    this.#field = field
    this.#source = { curves, material, options: { ...options } }
    // The segment hash finds two touching segments only while their mean length fits its cell less the contact: the
    // peristaltic swing stops there.
    w.uniforms.maxRestLength.value = this.info.segmentCellSize - 2 * this.maxRadius
    // The mean particle's share of a worm, for the fill capacity: π r̄² s.
    const meanProfile = profile.reduce((sum, value) => sum + value, 0) / P
    const lengths = list.reduce((sum, curve) => sum + curve.getLength(), 0)
    w.particleVolume = Math.PI * (radius * meanProfile) ** 2 * (lengths / (M * (P - 1)))
    // Solver defaults for worms.
    this.numSubsteps = 8
    this.bendingIterations = 4
    this.bendingCompliance = 2
    this.stretchingCompliance = 0.001
    this.bendingPlasticity = 0
    this.contactFriction = 0.8
    this.colliderFriction = 0.8
    this.groundFriction = 0.05
    this.separationSpeed = 1.5
    this.damping = 0.05
    this.normalDamping = 0.2
    // Under strictCollisions' bound at 8 substeps (67.5 · r · substeps units/s).
    this.maxSpeed = Math.min(11, 0.9 * 67.5 * this.maxRadius * 8)
    createWormPasses(this, w, field)
    this.updateFillCapacity()
    // The worm passes run around the user's extraPasses. A read returns both in new arrays, so assign a new object
    // rather than push to them; assigning a read back keeps only the user's.
    let user = this.extraPasses
    Object.defineProperty(this, 'extraPasses', {
      get: () => this.#passList(user),
      set: (value) => {
        user = this.#withoutOwnPasses(value)
      },
      enumerable: true,
      configurable: true,
    })
  }

  /** Worms: one per curve. */
  get wormCount() {
    return this.#w.M
  }

  /** The body field given (options.field), or null. */
  get field() {
    return this.#field
  }

  /**
   * The field as the surface pass sampled it this substep at each particle (world space), for a one-thread-per-particle
   * pass in extraPasses.substep, such as a FieldAttractor, to read instead of sampling again. Its sample() ignores its
   * arguments. null without a field.
   */
  get cachedField() {
    return this.#w.cachedField
  }

  /**
   * Per particle 1 vec4 (static contact normal, or the field normal while gripping in the field; re-stick timer),
   * then per worm 6 vec4: [state, time in state, phase, grip], [mean normal, support timer], [goal, bias], [share in
   * the field, cooldown, wave direction, back-up timer], [writhe angle, writhe sign, best distance, stuck timer],
   * [burial, wander timer, stall timer, fill front]; then per worm 1 vec4, [peristaltic phase, 0, 0, 0]. A storage
   * node, for passes and materials reading it on the GPU.
   */
  get wormData() {
    return this.#w.data
  }

  /** Where wormData's per-worm part starts, in vec4: worm m's W0 is at wormDataOffset + 6m. */
  get wormDataOffset() {
    return this.#w.N
  }

  /** The fill front's layers above the field's floor (options.fillLayers). */
  get fillLayers() {
    return this.#w.layers
  }

  /** m: each layer's height (options.fillLayerHeight). */
  get fillLayerHeight() {
    return this.#w.layerHeight
  }

  /** Particles each fill layer holds, from field.volumeByHeight × packing. */
  get fillCapacity() {
    return this.#w.capacity
  }

  /** Measures the field's volume per layer again (field.volumeByHeight): after its pose or the worms' size changes. */
  updateFillCapacity() {
    const w = this.#w
    const field = this.#field
    if (typeof field?.volumeByHeight === 'function') {
      const volume = field.volumeByHeight(w.layerHeight, w.layers, w.volume)
      if (volume !== w.volume && volume?.length >= w.layers) w.volume.set(volume.slice(0, w.layers))
    } else {
      w.volume.fill(0)
    }
    this.#syncCapacity()
    return this
  }

  // ---- Tools ----

  /** Every worm within pokeRadius of where the ray first hits a worm comes loose, with a small kick. */
  poke(raycaster) {
    this.pick(raycaster)
    this.#events.tool = 1
    return this
  }

  /** Every worm within blastRadius of the hit flies off at up to blastSpeed. */
  blast(raycaster) {
    this.pick(raycaster)
    this.#events.tool = 2
    return this
  }

  /**
   * Every worm with a particle within strikeRadius of `center` (world space), or of the segment from it to
   * `options.end`, or of the space that segment swept from `options.from`–`options.fromEnd`, comes loose and flies
   * along `direction` (world space) at up to strikeSpeed, harder nearer the centre: a bat's or a club's hit, at the
   * next update(). A particle already moving that way that fast keeps its speed, so a swept barrel can strike every
   * frame.
   * @param {THREE.Vector3} center
   * @param {THREE.Vector3} direction
   * @param {object} [options]
   * @param {THREE.Vector3} [options.end] - The segment's other end: a barrel, not a point.
   * @param {THREE.Vector3} [options.from] - Where `center` was a moment ago, as last frame.
   * @param {THREE.Vector3} [options.fromEnd] - And where `end` was.
   */
  strike(center, direction, options = {}) {
    for (const key of Object.keys(options)) {
      if (!STRIKE_OPTIONS.includes(key)) console.warn(`WormSimulation.strike: unknown option "${key}" ignored.`)
    }
    const u = this.#w.uniforms
    this.updateWorldMatrix(true, false)
    _matrix.copy(this.matrixWorld).invert()
    const end = options.end ?? center
    const from = options.from ?? center
    u.strikeCenter.value.copy(center).applyMatrix4(_matrix)
    u.strikeEnd.value.copy(end).applyMatrix4(_matrix)
    u.strikeFrom.value.copy(from).applyMatrix4(_matrix)
    // without fromEnd, the segment moved as its centre did
    if (options.fromEnd) u.strikeFromEnd.value.copy(options.fromEnd)
    else u.strikeFromEnd.value.subVectors(end, center).add(from)
    u.strikeFromEnd.value.applyMatrix4(_matrix)
    u.strikeDirection.value.copy(direction).transformDirection(_matrix)
    this.#events.tool = 3
    return this
  }

  /** Every worm comes loose for collapseTime, plus up to collapseStagger. */
  collapse() {
    this.#events.collapse = true
    return this
  }

  /**
   * Every worm back on its curve, at rest, in its initial state (options.states); info.substeps, its rest bends and
   * contact loads as at construction. The clock and the frame count (the seed of the per-frame random draws) run on,
   * unless `clock` is true. The run from reset({ clock: true }) replays the one from construction as far as two runs
   * from construction agree (where contacts pile up the segment hash's atomics order the contact sums), once the
   * caller has put back what the worms read: the field and the colliders in their first pose (field.update(0)), and a
   * FieldAttractor's clock and anchors (attractor.time = 0, attractor.snap()).
   * @param {object} [options]
   * @param {boolean} [options.clock=false] - The clock and the frame count back to 0 too.
   */
  reset(options = {}) {
    for (const key of Object.keys(options)) {
      if (key !== 'clock') console.warn(`WormSimulation.reset: unknown option "${key}" ignored.`)
    }
    super.reset()
    this.#events.reset = true
    if (options.clock === true) {
      this.#clock = 0
      this.#w.uniforms.frame.value = 0
    }
    return this
  }

  startGrab(particle) {
    this.#grabRay = false
    return super.startGrab(particle)
  }

  grabPicked() {
    this.#grabRay = true
    return super.grabPicked()
  }

  /** Steps the worms: their passes and the noodles' substeps, in one renderer.compute(). Doesn't update the field. */
  update(renderer, delta) {
    this.#renderer ??= renderer
    this.#syncUniforms()
    // The surface pass reads colliders within breakGap (0.1 r at least) of a worm.
    this.colliderCullingReach = Math.max(this.#w.uniforms.breakGap.value, 0.1) * this.maxRadius
    super.update(renderer, delta)
    // Consumed once a frame stepped.
    if (this.info.substeps > 0) {
      this.#clock = (this.#clock + this.info.substeps * this.info.coupling.h) % 1e5
      const events = this.#events
      events.collapse = false
      events.reset = false
      events.tool = 0
    }
  }

  async compileAsync(renderer) {
    this.#renderer ??= renderer
    const compiling = (async () => {
      await super.compileAsync(renderer)
      // The event passes, which a frame's list holds only when needed.
      const { reset, tools } = this.#w.passes
      for (const pass of [reset, tools]) if (!this.#disposed) await renderer.compileComputeAsync(pass)
    })()
    this.#compiling = compiling
    try {
      await compiling
    } finally {
      if (this.#compiling === compiling) this.#compiling = null
    }
  }

  copy(source, recursive = true) {
    super.copy(source, recursive)
    if (source.isWormSimulation) {
      for (const key of Object.keys(WORM_SETTINGS)) this[key] = source[key]
      this.adhesion = source.adhesion
      this.restOutside = source.restOutside
      this.crawlBack = source.crawlBack
      this.catchCrawling = source.catchCrawling
      this.home.copy(source.home)
      this.catchCenter.copy(source.catchCenter)
      this.leadVelocity.copy(source.leadVelocity)
      this.wanderDirection.copy(source.wanderDirection)
    }
    return this
  }

  /** A new simulation of the same curves, material and options (field and states included), with these settings. */
  clone(recursive) {
    const { curves, material, options } = this.#source
    return new this.constructor(curves, material, options).copy(this, recursive)
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    super.dispose()
    const w = this.#w
    const renderer = this.#renderer
    const free = () => {
      for (const pass of Object.values(w.passes)) {
        try {
          pass.dispose()
        } catch {
          // Never compiled.
        }
      }
      if (renderer === null) return
      const { backend, info, _attributes: attributes } = renderer
      const nodes = [w.data, w.initial, w.initialRest, w.orders, w.fill, w.fieldSamples, w.measures, w.fieldCache]
      for (const node of nodes) {
        if (node === null) continue
        const attribute = node.value
        if (!backend.has(attribute) || !backend.get(attribute).buffer) continue
        if (!attributes?.delete(attribute)) {
          backend.destroyAttribute(attribute)
          info.destroyAttribute(attribute)
        }
      }
    }
    if (this.#compiling) this.#compiling.then(free, free)
    else free()
  }

  // extraPasses as assigned, less the worm passes a read of it gave.
  #withoutOwnPasses(value) {
    if (value === null || typeof value !== 'object') return value
    const own = Object.values(this.#w.passes)
    const keys = ['before', 'substep', 'after'].filter(
      (key) => Array.isArray(value[key]) && value[key].some((pass) => own.includes(pass)),
    )
    if (keys.length === 0) return value
    const out = { ...value }
    for (const key of keys) out[key] = value[key].filter((pass) => !own.includes(pass))
    return out
  }

  // The worm passes around the user's own extraPasses.
  #passList(user) {
    const p = this.#w.passes
    const events = this.#events
    const before = []
    if (events.reset) before.push(p.reset)
    before.push(p.fillClear, p.probe, p.measure, p.state, p.steer)
    if (events.tool > 0) before.push(p.tools)
    const own = user && typeof user === 'object' ? user : {}
    const array = (value) => (Array.isArray(value) ? value : [])
    return {
      before: [...before, ...array(own.before)],
      substep: [this.colliderCulling ? p.surfaceCulled : p.surface, ...array(own.substep)],
      after: array(own.after),
    }
  }

  #warnOnce(key, message) {
    if (this.#warned.includes(key)) return
    this.#warned.push(key)
    console.warn(message)
  }

  #syncCapacity() {
    const w = this.#w
    const scale = Math.max(this.packing, 0) / Math.max(w.particleVolume, 1e-12)
    const node = w.uniforms.fillCapacity
    let changed = false
    for (let j = 0; j < w.layers; j++) {
      w.capacity[j] = w.volume[j] * scale
      if (Object.is(node.array[j], w.capacity[j])) continue
      node.array[j] = w.capacity[j]
      changed = true
    }
    if (changed) {
      // Its buffer refreshed from the array (unbuilt, it has none yet) and its group bumped: every binding uploads
      // it once, at its next use.
      if (node.value) node.updateBuffer()
      node.groupNode.needsUpdate = true
    }
  }

  #syncUniforms() {
    const w = this.#w
    const u = w.uniforms
    for (const key of Object.keys(WORM_SETTINGS)) {
      const value = this[key]
      if (!(key in u)) continue
      if (typeof value !== 'number' || Number.isNaN(value)) {
        this.#warnOnce(key, `WormSimulation: ${key} = ${String(value)} is not a number; keeping ${u[key].value}.`)
        continue
      }
      // ±Infinity as a finite float: 'never' for a time, 'anywhere' for a distance.
      u[key].value = Math.min(Math.max(value, -1e9), 1e9)
    }
    u.adhesion.value = this.adhesion ? 1 : 0
    u.restOutside.value = this.restOutside ? 1 : 0
    u.crawlBack.value = this.crawlBack ? 1 : 0
    u.catchCrawling.value = this.catchCrawling ? 1 : 0
    u.catchRadius.value = Math.max(u.catchRadius.value, 0)
    u.clock.value = this.#clock
    this.updateWorldMatrix(true, false)
    u.localToWorld.value.copy(this.matrixWorld)
    u.worldToLocal.value.copy(_matrix.copy(this.matrixWorld).invert())
    u.home.value.copy(this.home)
    u.catchCenter.value.copy(this.catchCenter)
    u.leadVelocity.value.copy(this.leadVelocity)
    u.wanderDirection.value.copy(this.wanderDirection)
    const floorY = this.#field?.floor
    u.floor.value = typeof floorY === 'number' && Number.isFinite(floorY) ? floorY : 0
    u.frame.value = (u.frame.value + 1) >>> 0
    u.collapse.value = this.#events.collapse ? 1 : 0
    u.tool.value = this.#events.tool
    u.grabRay.value = this.#grabRay ? 1 : 0
    this.#syncCapacity()
  }
}

// ======== Buffers and uniforms ========

function createWormState(M, P, states, cooldowns, catchOrders, layers, layerHeight) {
  const N = M * P
  const block = new Float32Array(4 * (WORM_VEC4 + 1) * M)
  const orders = new Float32Array(M)
  for (let m = 0; m < M; m++) {
    const order = Number(catchOrders?.[m] ?? 0)
    orders[m] = Number.isFinite(order) ? order : 0
  }
  for (let m = 0; m < M; m++) {
    const given = Number(states?.[m] ?? LOOSE)
    const state = [LOOSE, CRAWLING, CLIMBING, HELD].includes(given) ? given : LOOSE
    const o = 4 * WORM_VEC4 * m
    // W0: state, time, phase, grip
    block.set([state, 0, random01(m * 31 + 7) * Math.PI * 2, state === HELD ? 1 : 0], o)
    // W1: mean normal (up), support timer
    block.set([0, 1, 0, 0], o + 4)
    // W3: share in the field, cooldown, wave direction, back-up timer
    const cooldown = Number(cooldowns?.[m] ?? 0)
    block.set([0, Number.isFinite(cooldown) ? Math.max(cooldown, 0) : 0, 1, 0], o + 12)
    // W4: writhe angle, writhe sign, best distance (best height climbing), stuck timer
    block.set([random01(m * 17 + 3) * Math.PI * 2, 1, state === CLIMBING ? -1e9 : 1e9, 0], o + 16)
    // W5: burial, wander timer, stall timer, fill front
    block.set([0, 0, 0, 1e9], o + 20)
  }
  // Per worm, after every worm's six: the peristaltic wave's phase.
  for (let m = 0; m < M; m++) block[4 * (WORM_VEC4 * M + m)] = random01(m * 53 + 11) * Math.PI * 2
  const data = new Float32Array(4 * (N + (WORM_VEC4 + 1) * M))
  data.set(block, 4 * N)
  const uniforms = {
    localToWorld: uniform(new THREE.Matrix4()),
    worldToLocal: uniform(new THREE.Matrix4()),
    home: uniform(new THREE.Vector3()),
    catchCenter: uniform(new THREE.Vector3()),
    leadVelocity: uniform(new THREE.Vector3()),
    wanderDirection: uniform(new THREE.Vector3()),
    floor: uniform(0),
    // An 'object' group of its own: uploaded after a change (#syncCapacity()), not at every dispatch.
    fillCapacity: uniformArray(new Array(layers).fill(0), 'float')
      .setName('worms_fillCapacity')
      .setGroup(uniformGroup('object')),
    adhesion: uniform(1),
    restOutside: uniform(1),
    crawlBack: uniform(1),
    catchCrawling: uniform(0),
    frame: uniform(0, 'uint'),
    // simulated s
    clock: uniform(0),
    collapse: uniform(0),
    tool: uniform(0),
    // object space
    strikeCenter: uniform(new THREE.Vector3()),
    strikeEnd: uniform(new THREE.Vector3()),
    strikeFrom: uniform(new THREE.Vector3()),
    strikeFromEnd: uniform(new THREE.Vector3()),
    strikeDirection: uniform(new THREE.Vector3(1, 0, 0)),
    grabRay: uniform(0),
    // m: the longest a segment's rest length swings to (the constructor sets it)
    maxRestLength: uniform(1e9),
  }
  for (const [key, value] of Object.entries(WORM_SETTINGS)) {
    if (!CPU_SETTINGS.includes(key)) uniforms[key] = uniform(value)
  }
  return {
    M,
    P,
    N,
    layers,
    layerHeight,
    data: instancedArray(data, 'vec4').setName('worms_data'),
    initial: instancedArray(block, 'vec4').setName('worms_initial'),
    // per worm, its catch order (options.catchOrders)
    orders: instancedArray(orders, 'float').setName('worms_catchOrders'),
    fill: instancedArray(new Uint32Array(layers), 'uint').setName('worms_fill').toAtomic(),
    // per particle, the field the probe pass finds for the measure pass: normal (object space), distance
    fieldSamples: instancedArray(N, 'vec4').setName('worms_fieldSamples'),
    // per worm, what the measure pass finds for the state and steer passes: MEASURE_VEC4 each
    measures: instancedArray(M * MEASURE_VEC4, 'vec4').setName('worms_measures'),
    volume: new Float32Array(layers),
    capacity: new Float32Array(layers),
    particleVolume: 1,
    uniforms,
    passes: {},
  }
}

// Worm m's j-th vec4.
const wormVec = (w, m, j) => w.data.element(uint(w.N).add(uint(m).mul(WORM_VEC4)).add(j))
// Worm m's peristaltic vec4, after every worm's six: [phase, 0, 0, 0].
const squeezeVec = (w, m) => w.data.element(uint(w.N + WORM_VEC4 * w.M).add(uint(m)))

// The amplitude of state's wave, and its share of the crawling one (the muscles' activation).
function waveAmplitude(u, state, time, burial) {
  const temperature = max(u.temperature, 0)
  const amplitude = select(
    state.equal(CRAWLING),
    u.amplitude.mul(max(u.crawlAmplitude, 0)),
    select(
      state.equal(CLIMBING),
      u.amplitude.mul(max(u.climbAmplitude, 0)),
      select(
        state.equal(HELD),
        u.heldAmplitude.mul(temperature).mul(float(1).sub(burial.mul(u.buriedDamping))),
        u.looseAmplitude.mul(temperature).mul(min(time.div(max(u.looseEaseIn, 1e-3)), 1)),
      ),
    ),
  )
  return max(amplitude, 0)
}

// ======== Inside the noodles pass ========

// 'bend': after each bending sweep, the muscles, a constraint per joint (XPBD, λ accumulated over the sweeps):
// ê · (xᵢ − ½(xᵢ₋₁ + xᵢ₊₁)) = −s · sin(θ*/2), in three colours as the bends. The target bend θ* ê is the travelling
// wave A·k·S·sin(k·u − φ) (× serpentine crawling and climbing) plus the steering bias on the leading two-thirds, in the
// wave's plane, and the squirm, partly out of it. φ runs backward while backing up, so the wave reverses smoothly.
// On the first sweep of a substep, the peristaltic rest lengths and the rest curvature. The stretch solve's rows, free
// during the bending sweeps, hold each joint's target shape (xyz) and λ (w).
function wormHook(w, stage, c) {
  if (stage !== 'bend' || c.P < 3) return
  const { mem, sync, lane, noodle, P, workgroupSize, nodes, firstSweep } = c
  const u = w.uniforms
  const nu = nodes.uniforms
  const nb = nodes.buffers
  const W0 = wormVec(w, noodle, 0).toVar()
  const W1 = wormVec(w, noodle, 1).toVar()
  const W2 = wormVec(w, noodle, 2).toVar()
  const W3 = wormVec(w, noodle, 3).toVar()
  const W4 = wormVec(w, noodle, 4).toVar()
  const W5 = wormVec(w, noodle, 5).toVar()
  const state = W0.x
  const crawling = state.equal(CRAWLING).toVar()
  const gait = crawling.or(state.equal(CLIMBING)).toVar()
  // A wanderer at its point, or a loose worm at rest in its cooldown, lies still (see restOutside).
  const mayRest = u.restOutside.greaterThan(0.5).or(W3.x.greaterThan(0)).toVar()
  const resting = crawling
    .and(mayRest)
    .and(W5.y.greaterThan(0))
    .and(length(W2.xyz.sub(mem.x(uint(0)).xyz)).lessThan(u.arrivalRadius))
    .toVar()
  const headHeight = dot(nu.groundNormal, mem.x(uint(0)).xyz)
    .add(nu.groundConstant)
    .sub(c.radiusOf(uint(0)))
  const headDown = nu.groundEnabled.greaterThan(0.5).and(headHeight.lessThan(c.radiusOf(uint(0))))
  const still = state
    .equal(LOOSE)
    .and(mayRest)
    .and(W3.y.greaterThan(0))
    .and(W1.w.greaterThanEqual(u.looseRest).or(headDown))
    .toVar()
  const amplitude = select(resting.or(still), float(0), waveAmplitude(u, state, W0.y, W5.x)).toVar()
  const activation = min(amplitude.div(max(u.amplitude, 1e-3)), 1).toVar()
  const active = amplitude.greaterThan(1e-6).toVar()
  const frequency = select(gait, u.frequency, u.frequency.mul(max(u.temperature, 0))).toVar()
  const direction = select(crawling, W3.z, float(1)).toVar()
  // The phase, integrated per frame by the steer pass, advanced over the substeps.
  const h = nu.h
  const phase = W0.z
    .add(
      frequency
        .mul(direction)
        .mul(Math.PI * 2)
        .mul(h)
        .mul(float(nb.stepState.element(uint(0)))),
    )
    .toVar()
  const k = float(Math.PI * 2)
    .div(max(u.wavelength.mul(select(crawling, u.crawlWavelength, float(1))), 0.05))
    .toVar()
  const S = 1 / (P - 1)
  const bias = select(gait.and(direction.greaterThan(0)).and(resting.not()), W2.w, float(0)).toVar()
  // The squirm: three waves per worm of random wavenumber, frequency and direction, and a fourth tipping its plane,
  // swelling and fading in bursts.
  const time = u.clock.add(h.mul(float(nb.stepState.element(uint(0)))))
  const seed = uint(noodle).mul(uint(2654435761))
  const rnd = (n) => random(seed.add(n))
  const spread = (n) => rnd(n).mul(0.8).add(0.6)
  const turning = (n) => select(rnd(n).lessThan(0.5), float(-1), float(1))
  const kappas = vec4(spread(1), spread(2), spread(3), spread(4))
    .mul(u.squirmWaves.mul(Math.PI * 2))
    .toVar()
  const omegas = vec4(
    spread(5).mul(turning(9)),
    spread(6).mul(turning(10)),
    spread(7).mul(turning(11)),
    spread(8).mul(turning(12)),
  )
    .mul(u.squirmFrequency.mul(Math.PI * 2))
    .toVar()
  const phis = vec4(rnd(13), rnd(14), rnd(15), rnd(16))
    .mul(Math.PI * 2)
    .add(omegas.mul(time))
    .toVar()
  const burst = smoothstep(
    -0.4,
    0.8,
    sin(time.mul(u.squirmFrequency.mul(Math.PI * 2 * 0.13)).add(rnd(17).mul(Math.PI * 2))),
  )
  const squirmAmplitude = select(
    resting.or(still).or(active.not()),
    float(0),
    u.squirm.mul(select(gait, float(1), u.heldSquirm)).mul(mix(float(1), burst, clamp(u.squirmBursts, 0, 1))),
  ).toVar()
  const serpentine = select(gait, max(u.serpentine, 0), float(1))
  const normal = W1.xyz.toVar()
  // The writhe's axis, turning with its angle; each worm tilted its own way.
  const psi = W4.x.toVar()
  const tilt = random(uint(noodle).mul(7919).add(13)).mul(Math.PI).toVar()
  const axis = vec3(cos(psi).mul(cos(tilt)), sin(tilt), sin(psi).mul(cos(tilt))).toVar()
  // Per joint × its spacing⁴, as the passive bends' bendingCompliance, softer as the activation drops.
  const alpha = u.muscleCompliance.div(h.mul(h).mul(max(activation, 1e-4))).toVar()
  const memory = select(gait.and(resting.not()), max(u.gaitMemory, 1e-3), max(u.restMemory, 1e-3))
  const restRate = float(1)
    .sub(exp(h.negate().div(memory)))
    .toVar()
  // Held and loose worms' curl, 1/m, and where along the worm its variation peaks.
  const curl = select(state.equal(HELD), u.curl, select(state.equal(LOOSE), u.looseCurl, float(0))).toVar()
  const curlPhase = random(uint(noodle).mul(104729).add(71))
    .mul(Math.PI * 2)
    .toVar()
  const base = uint(noodle).mul(P)
  // A correction's part into what held the particle up last substep is dropped, as the passive bends do.
  const unsupported = (d, g) => d.sub(g.xyz.mul(g.w.mul(min(dot(d, g.xyz), 0))))
  // Where the wave starts easing to tailAmplitude.
  const tailStart = float(1)
    .sub(clamp(u.tailWaveSpan, 1e-3, 1))
    .toVar()
  // The target bend's shape at a joint, the same every sweep of a substep: (the wave; the squirm per unit squirm
  // amplitude, in the wave's plane and out of it).
  const shapeAt = (along) => {
    const tail = mix(float(1), u.tailAmplitude, smoothstep(tailStart, 1, along))
    const wave = sin(k.mul(along).sub(phase)).mul(tail)
    const waves = sin(kappas.mul(along).add(phis))
    const head = select(crawling, mix(clamp(u.squirmHead, 0, 1), float(1), smoothstep(0, 0.4, along)), float(1))
    const squirm = float(S).mul(waves.x.add(waves.y).add(waves.z).mul(0.5)).mul(tail).mul(head).toVar()
    const tip = select(
      gait,
      clamp(u.squirmLift, 0, 1)
        .mul(Math.PI / 2)
        .mul(waves.w),
      float(0),
    ).toVar()
    return vec3(wave, squirm.mul(cos(tip)), squirm.mul(sin(tip)))
  }
  // The target bend at a joint from its shape: (in the wave's plane, out of it). The amplitudes and the bias are read
  // every sweep, as a worm that comes to rest drops them.
  const targetOf = (shape, along) =>
    vec2(
      amplitude
        .mul(serpentine)
        .mul(k)
        .mul(S)
        .mul(shape.x)
        .add(bias.mul(S).mul(max(float(1).sub(along.mul(1.5)), 0)))
        .add(squirmAmplitude.mul(shape.y)),
      squirmAmplitude.mul(shape.z),
    )

  // Once a substep, each segment's rest length, swung by the peristaltic wave while crawling; and each joint's rest
  // curvature: crawling and climbing worms ease toward the target bend's; held, loose and resting ones toward their
  // coherent bend, the turn over two spans either side, which a zig-zag lacks. With a curl, that bend is capped at it,
  // and raised to it where it is past curlThreshold, bends with its neighbours and is off the ground.
  const squeezing = crawling.and(resting.not()).and(active).toVar()
  // The peristaltic wave's own phase, integrated per worm as the gait's, advanced over the substeps.
  const squeezePhase = squeezeVec(w, noodle)
    .x.add(
      u.peristalsisFrequency
        .mul(direction)
        .mul(Math.PI * 2)
        .mul(h)
        .mul(float(nb.stepState.element(uint(0)))),
    )
    .toVar()
  If(firstSweep, () => {
    Loop({ start: lane, end: uint(P - 1), type: 'uint', condition: '<', update: workgroupSize }, ({ i: j }) => {
      // Segment j, to the next particle; its stretch compliance's factor (w) is its spacing². Stretched at most to
      // where the segment hash still finds every segment it touches.
      const own = mem.rest(j).toVar()
      const swing = sin(
        float(j)
          .add(0.5)
          .mul(S)
          .mul(u.peristalsisWaves.mul(Math.PI * 2))
          .sub(squeezePhase),
      )
      const restLength = min(
        sqrt(own.w).mul(float(1).add(select(squeezing, u.peristalsis, float(0)).mul(swing))),
        u.maxRestLength,
      )
      // Joint j: the first and last particles have none; joint j's target shape goes in its row (j > 0).
      const center = max(j, uint(1)).toVar()
      const lo = select(center.greaterThan(uint(1)), center.sub(2), uint(0)).toVar()
      const hi = min(center.add(2), uint(P - 1)).toVar()
      const before = float(center.sub(lo))
      const after = float(hi.sub(center))
      const xb = mem.x(center).xyz.toVar()
      const lengths = mem.rest(center).toVar()
      const spacing = lengths.z
      const along = float(center).mul(S)
      const bendOf = (turn) => spacing.mul(2).mul(tan(min(abs(turn), 2.8).mul(0.5)))
      // The turn per span: of the arc through the joint and the particles n₋ and n₊ spans either side, the angle
      // between the two chords is (n₋ + n₊) / 2 of it; for the narrow one, n = 1.
      const turn = (a, b) => atan(length(cross(a, b)), dot(a, b))
      const coherent = turn(xb.sub(mem.x(lo).xyz), mem.x(hi).xyz.sub(xb))
        .mul(2)
        .div(before.add(after))
        .toVar()
      const narrow = turn(xb.sub(mem.x(center.sub(1)).xyz), mem.x(center.add(1)).xyz.sub(xb))
      const wobble = sin(along.mul(u.curlWaves.mul(Math.PI * 2)).add(curlPhase))
      const curlTurn = spacing.mul(curl).mul(max(u.curlVariation.mul(wobble).add(1), 0))
      // where the joint bends with its neighbours, not against them
      const onset = smoothstep(
        u.curlThreshold.mul(0.5),
        max(u.curlThreshold, 1e-6),
        coherent.div(max(spacing, 1e-9)),
      ).mul(smoothstep(0.3, 0.7, coherent.div(max(narrow, 1e-9))))
      const radius = c.radiusOf(center).toVar()
      const height = dot(nu.groundNormal, xb).add(nu.groundConstant).sub(radius)
      const grounded = select(
        nu.groundEnabled.greaterThan(0.5),
        float(1).sub(smoothstep(radius, radius.mul(3), height)),
        float(0),
      )
      const curled = mix(min(coherent, curlTurn), curlTurn, onset.mul(float(1).sub(grounded)))
      const shape = shapeAt(along).toVar()
      const target = select(
        gait.and(resting.not()),
        bendOf(length(targetOf(shape, along))),
        bendOf(select(curl.greaterThan(0), curled, coherent)),
      )
      const bend = select(j.greaterThan(uint(0)), lengths.y.add(target.sub(lengths.y).mul(restRate)), own.y)
      mem.rest(j).assign(vec4(restLength, bend, own.z, own.w))
      If(j.greaterThan(uint(0)), () => {
        mem.row(j).assign(vec4(shape, 0))
      })
    })
    // Inside the branch, which every thread of the workgroup takes alike: later sweeps follow the pass's own sync.
    sync()
  })

  for (const order of [0, 1, 2]) {
    Loop(
      { start: lane, end: uint(Math.ceil((P - 2) / 3)), type: 'uint', condition: '<', update: workgroupSize },
      ({ i: m }) => {
        const center = m.mul(3).add(order).add(1).toVar()
        If(center.lessThanEqual(uint(P - 2)), () => {
          const xa = mem.x(center.sub(1)).toVar()
          const xb = mem.x(center).toVar()
          const xc = mem.x(center.add(1)).toVar()
          const chord = xa.xyz.sub(xc.xyz).toVar()
          const t = chord.div(max(length(chord), 1e-9)).toVar()
          // Gait states wave in the plane of the joint's surface (its record), else the worm's mean one; held and
          // loose worms in the writhe's.
          const record = w.data.element(base.add(center)).xyz.toVar()
          const surface = cross(select(length(record).greaterThan(0.5), record, normal), t).toVar()
          const writhe = axis.sub(t.mul(dot(axis, t))).toVar()
          const plane = select(
            gait.and(length(surface).greaterThan(1e-3)),
            surface.div(max(length(surface), 1e-9)),
            writhe.div(max(length(writhe), 1e-9)),
          ).toVar()
          // The target bend as a vector across the joint: in the plane, and out of it about the chord. The joint's
          // row holds its shape (xyz) and its λ (w).
          const row = mem.row(center).toVar()
          const bend = targetOf(row.xyz, float(center).mul(S)).toVar()
          const across = plane
            .mul(bend.x)
            .add(normalize(cross(t, plane)).mul(bend.y))
            .toVar()
          const size = length(across).toVar()
          const e = select(size.greaterThan(1e-6), across.div(max(size, 1e-9)), plane).toVar()
          const theta = select(size.greaterThan(1e-6), size, float(0))
          const spacing = mem.rest(center).z.toVar()
          If(active, () => {
            const lambda = select(firstSweep, float(0), row.w).toVar()
            const quartic = spacing.mul(spacing).mul(spacing).mul(spacing)
            const compliance = alpha.mul(quartic).toVar()
            const C = dot(e, xb.xyz.sub(xa.xyz.add(xc.xyz).mul(0.5))).add(spacing.mul(sin(theta.mul(0.5))))
            const weight = xb.w.add(xa.w.mul(0.25)).add(xc.w.mul(0.25))
            const dLambda = C.negate()
              .sub(compliance.mul(lambda))
              .div(max(weight.add(compliance), 1e-12))
              .toVar()
            const step = e.mul(dLambda).toVar()
            const ga = mem.support(center.sub(1))
            const gb = mem.support(center)
            const gc = mem.support(center.add(1))
            mem.x(center.sub(1)).assign(vec4(xa.xyz.add(unsupported(step.mul(xa.w.mul(-0.5)), ga)), xa.w))
            mem.x(center).assign(vec4(xb.xyz.add(unsupported(step.mul(xb.w), gb)), xb.w))
            mem.x(center.add(1)).assign(vec4(xc.xyz.add(unsupported(step.mul(xc.w.mul(-0.5)), gc)), xc.w))
            mem.row(center).assign(vec4(row.xyz, lambda.add(dLambda)))
          })
        })
      },
    )
    // The pass syncs right after the hook.
    if (order < 2) sync()
  }
}

// ======== The worm passes ========

function createWormPasses(sim, w, field) {
  const { buffers: b, uniforms: nu } = sim.nodes
  const u = w.uniforms
  const P = w.P
  const M = w.M
  const N = w.N
  // Per particle, the field the surface pass samples, world space: [normal, distance], [velocity, 0].
  w.fieldCache = field ? instancedArray(2 * N, 'vec4').setName('worms_fieldCache') : null
  // The noodles' rest lengths and bends as built, which the reset pass restores.
  w.initialRest = instancedArray(Float32Array.from(b.restLengths.value.array), 'vec4').setName('worms_initialRest')
  w.cachedField = field
    ? {
        isCachedField: true,
        get boundingSphere() {
          return field.boundingSphere
        },
        sample: () => {
          const at = instanceIndex.mul(2)
          const head = w.fieldCache.element(at).toVar()
          return { distance: head.w, normal: head.xyz, velocity: w.fieldCache.element(at.add(1)).xyz }
        },
      }
    : null
  const radius = sim.radius
  const profile = nu.radiusProfile
  const radiusOf = (k) => (profile ? profile.element(k).mul(radius) : float(radius))
  const frameTime = float(nu.substeps).mul(nu.h)
  const gravity = length(nu.gravity)
  const toWorld = (x) => u.localToWorld.mul(vec4(x, 1)).xyz
  const toLocal = (v) => u.worldToLocal.mul(vec4(v, 0)).xyz
  const toWorldDirection = (v) => u.localToWorld.mul(vec4(v, 0)).xyz
  // The field at x (object space) at `alpha` of the frame, in object space; far away without one. `cached`: also
  // stored (world space) at the thread's particle, for cachedField.
  const sample = (x, alpha, cached = false) => {
    if (!field) return { distance: float(1e9), normal: vec3(0), velocity: vec3(0) }
    const s = field.sample(toWorld(x), alpha)
    if (cached) {
      const at = instanceIndex.mul(2)
      w.fieldCache.element(at).assign(vec4(s.normal, s.distance))
      w.fieldCache.element(at.add(1)).assign(vec4(s.velocity, 0))
    }
    return {
      distance: float(s.distance).toVar(),
      normal: toLocal(s.normal).toVar(),
      velocity: toLocal(s.velocity).toVar(),
    }
  }
  // Up along the surface at n, bending in toward −n at the fill front.
  const climbDirection = (n, y, front) => {
    const up = nu.up
    const along = up.sub(n.mul(dot(n, up))).toVar()
    const upward = select(length(along).greaterThan(1e-4), normalize(along), up)
    const blend = smoothstep(front.sub(0.3), front, y)
    const c = mix(upward, n.negate(), blend).toVar()
    return select(length(c).greaterThan(1e-4), normalize(c), up)
  }

  // Every worm back in its initial state; the particles' records cleared; after the noodles' respawn, its rest bends as
  // built (the respawn recomputes them on the GPU, ulps off the constructor's) and its contact loads cleared: the run
  // from a reset replays the one from construction. One thread per particle or worm.
  const reset = Fn(() => {
    const i = instanceIndex
    If(i.lessThan(uint(N)), () => {
      w.data.element(i).assign(vec4(0))
      b.restLengths.element(i).assign(w.initialRest.element(i))
    })
    If(i.lessThan(uint(M * (P - 1))), () => {
      b.segmentLoad.element(i).assign(float(0))
    })
    If(i.lessThan(uint(M)), () => {
      for (let j = 0; j < WORM_VEC4; j++) {
        wormVec(w, i, j).assign(w.initial.element(i.mul(WORM_VEC4).add(j)))
      }
      squeezeVec(w, i).assign(w.initial.element(uint(WORM_VEC4 * M).add(i)))
    })
  })().compute(Math.max(N, M))

  // The fill front: holding and climbing particles inside the field, counted per layer.
  const layers = w.layers
  const layerHeight = w.layerHeight
  const fillClear = Fn(() => {
    atomicStore(w.fill.element(instanceIndex), uint(0))
  })().compute(layers)

  // Probe: the field at every particle, and the fill count. A pass of its own: the field's loop nested in measure's
  // loop over the particles fails pipeline creation on some Vulkan drivers.
  const probe = Fn(() => {
    const i = instanceIndex
    const x = b.positions.element(i).xyz.toVar()
    const { distance, normal } = sample(x, float(0))
    w.fieldSamples.element(i).assign(vec4(normal, distance))
    const state = wormVec(w, i.div(uint(P)), 0).x.toVar()
    If(state.equal(HELD).or(state.equal(CLIMBING)).and(distance.lessThan(0)), () => {
      const layer = floor(toWorld(x).y.sub(u.floor).div(layerHeight)).toVar()
      If(layer.greaterThanEqual(0).and(layer.lessThan(layers)), () => {
        atomicAdd(w.fill.element(uint(layer)), uint(1))
      })
    })
  })().compute(N)

  // The crawler's goal: the field's surface point nearest the head on the floor, led by the body's velocity; else home.
  const crawlGoal = (head, headNormal, headDistance) => {
    if (!field) return u.home
    const point = toWorld(head).sub(toWorldDirection(headNormal).mul(headDistance)).toVar()
    const flat = vec3(point.x, u.floor, point.z).toVar()
    const lead = min(length(flat.sub(toWorld(head))).div(max(u.crawlSpeed, 0.01)), u.pursuitLead)
    return u.worldToLocal.mul(vec4(flat.add(u.leadVelocity.mul(lead)), 1)).xyz
  }

  // Once a frame, three passes of one thread per worm: measure, state, steer. As one pass they fail pipeline creation
  // on some Vulkan drivers.

  // Measure: over the particles, from probe's samples, the share in the field, its mean normal and depth, what holds
  // them up, the floor and the contacts; the field at the head; and the fill front, the top of the lowest layer under
  // fillFraction of its capacity.
  const measure = Fn(() => {
    const m = instanceIndex
    const first = m.mul(uint(P)).toVar()
    const inside = float(0).toVar()
    const fieldNormal = vec3(0).toVar()
    const depth = float(0).toVar()
    const held = float(0).toVar()
    const firm = float(0).toVar()
    const grounded = float(0).toVar()
    const highest = float(-1e9).toVar()
    const supportNormal = vec3(0).toVar()
    const contacts = float(0).toVar()
    const headNormal = vec3(0).toVar()
    const headDistance = float(1e9).toVar()
    Loop(P, ({ i: k }) => {
      const i = first.add(k).toVar()
      const segment = m
        .mul(uint(P - 1))
        .add(k)
        .toVar()
      const last = k.equal(P - 1).toVar()
      const x = b.positions.element(i).xyz.toVar()
      const f = w.fieldSamples.element(i).toVar()
      If(k.equal(0), () => {
        headNormal.assign(f.xyz)
        headDistance.assign(f.w)
      })
      If(f.w.lessThan(u.capture.mul(0.5)), () => {
        inside.addAssign(1)
      })
      If(f.w.lessThan(u.capture), () => {
        fieldNormal.addAssign(f.xyz)
      })
      depth.addAssign(min(f.w, 1))
      // Held up by a contact, or stuck to a surface by adhesion.
      const g = b.support.element(i).toVar()
      const record = w.data.element(i).toVar()
      const glued = record.w.greaterThan(0).and(length(record.xyz).greaterThan(0.5)).toVar()
      If(g.w.greaterThan(0), () => {
        held.addAssign(1)
        supportNormal.addAssign(g.xyz)
      }).ElseIf(glued, () => {
        held.addAssign(1)
        supportNormal.addAssign(record.xyz)
      })
      If(g.w.greaterThan(0.5).or(glued), () => {
        firm.addAssign(1)
      })
      const height = toWorld(x).y.toVar()
      If(height.sub(u.floor).lessThan(radiusOf(k).mul(1.5)), () => {
        grounded.addAssign(1)
      })
      highest.assign(max(highest, height))
      If(last.not(), () => {
        contacts.addAssign(b.segmentDelta.element(segment.mul(2)).w)
      })
    })
    const front = float(1e9).toVar()
    const top = float(1e9).toVar()
    const found = float(0).toVar()
    Loop(layers, ({ i: j }) => {
      const capacity = u.fillCapacity.element(j).toVar()
      const layerTop = u.floor.add(float(j).add(1).mul(layerHeight)).toVar()
      If(capacity.greaterThan(0.5), () => {
        top.assign(layerTop)
        If(found.lessThan(0.5).and(float(atomicLoad(w.fill.element(j))).lessThan(capacity.mul(u.fillFraction))), () => {
          front.assign(layerTop)
          found.assign(1)
        })
      })
    })
    front.assign(select(found.greaterThan(0.5), front, top))

    const out = m.mul(MEASURE_VEC4).toVar()
    const burial = min(contacts.div(P - 1).div(4), 1)
    w.measures.element(out).assign(vec4(inside.div(P), depth.div(P), burial, front))
    w.measures.element(out.add(1)).assign(vec4(fieldNormal, held))
    w.measures.element(out.add(2)).assign(vec4(supportNormal, firm))
    w.measures.element(out.add(3)).assign(vec4(headNormal, headDistance))
    w.measures.element(out.add(4)).assign(vec4(grounded, highest, 0, 0))
  })().compute(M)

  // State: the transitions and their timers, from the measures; a wanderer's or a detour's point.
  const state = Fn(() => {
    const m = instanceIndex
    const base = uint(N).add(m.mul(WORM_VEC4)).toVar()
    const W0 = w.data.element(base).toVar()
    const W1 = w.data.element(base.add(1)).toVar()
    const W2 = w.data.element(base.add(2)).toVar()
    const W3 = w.data.element(base.add(3)).toVar()
    const W4 = w.data.element(base.add(4)).toVar()
    const W5 = w.data.element(base.add(5)).toVar()
    const dt = frameTime.toVar()
    const first = m.mul(uint(P)).toVar()
    const head = b.positions.element(first).xyz.toVar()
    const measured = m.mul(MEASURE_VEC4).toVar()
    const M0 = w.measures.element(measured).toVar()
    const M1 = w.measures.element(measured.add(1)).toVar()
    const M2 = w.measures.element(measured.add(2)).toVar()
    const M3 = w.measures.element(measured.add(3)).toVar()
    const share = M0.x
    const meanDepth = M0.y
    const burial = M0.z
    const front = M0.w
    const fieldNormal = M1.xyz
    const held = M1.w
    const supportNormal = M2.xyz
    const firm = M2.w
    const headField = { normal: M3.xyz, distance: M3.w }
    const grounded = w.measures.element(measured.add(4)).x.toVar()
    const highest = w.measures.element(measured.add(4)).y.toVar()
    const headY = toWorld(head).y.toVar()

    const stateNow = W0.x.toVar()
    const timer = W0.y.add(dt).toVar()
    const grip = W0.w.toVar()
    const cooldown = max(W3.y.sub(dt), 0).toVar()
    const become = (next) => {
      stateNow.assign(next)
      timer.assign(0)
      W1.w.assign(0)
      W3.z.assign(1)
      W3.w.assign(0)
      W4.z.assign(next === CLIMBING ? -1e9 : 1e9)
      W4.w.assign(0)
      W5.y.assign(0)
      W5.z.assign(0)
    }
    const release = (next, wait) => {
      become(next)
      cooldown.assign(max(cooldown, wait))
    }

    // Events: collapse, then a grab.
    If(u.collapse.greaterThan(0.5), () => {
      release(LOOSE, u.collapseTime.add(random(m.mul(97).add(u.frame.mul(5))).mul(max(u.collapseStagger, 0))))
    })
    const grabbedParticle = select(u.grabRay.greaterThan(0.5), uint(b.grabState.element(uint(4)).x), nu.grabParticle)
    const grabHit = u.grabRay.lessThan(0.5).or(b.grabState.element(uint(4)).z.greaterThan(0.5))
    If(
      nu.grabActive
        .greaterThan(0.5)
        .and(grabHit)
        .and(grabbedParticle.div(uint(P)).equal(m)),
      () => {
        If(stateNow.notEqual(LOOSE), () => {
          become(LOOSE)
        })
        grip.assign(0)
        cooldown.assign(max(cooldown, u.toolCooldown))
      },
    )

    const goal = crawlGoal(head, headField.normal, headField.distance).toVar()
    const supported = held.greaterThanEqual(3).toVar()
    // Wander: crawl to a floor point wanderMinDistance–wanderMaxDistance out, away from the body and along
    // wanderDirection, for ⅔–4⁄3 of wanderTime.
    const wander = (salt) => {
      const seed = m.mul(uint(2246822519)).add(u.frame.mul(3)).add(salt).toVar()
      // World space, where the point is placed: the head's field normal flattened, and wanderDirection's bias.
      const outward = toWorldDirection(headField.normal).toVar()
      const normalOut = vec3(outward.x, 0, outward.z)
        .div(max(length(outward), 1e-9))
        .toVar()
      const bias = vec3(u.wanderDirection.x, 0, u.wanderDirection.z)
      const out = select(length(normalOut).greaterThan(1e-3), normalize(normalOut), vec3(0)).add(bias).toVar()
      const away = select(length(out).greaterThan(1e-3), normalize(out), vec3(1, 0, 0)).toVar()
      const turn = random(seed).sub(0.5).mul(u.wanderSpread.mul(2)).toVar()
      const direction = vec3(
        away.x.mul(cos(turn)).sub(away.z.mul(sin(turn))),
        0,
        away.x.mul(sin(turn)).add(away.z.mul(cos(turn))),
      )
      const near = max(u.wanderMinDistance, 0)
      const reach = random(seed.add(1))
        .mul(max(u.wanderMaxDistance.sub(near), 0))
        .add(near)
      const point = toWorld(head).add(direction.mul(reach)).toVar()
      W2.assign(vec4(u.worldToLocal.mul(vec4(point.x, u.floor, point.z, 1)).xyz, W2.w))
      W5.y.assign(
        max(u.wanderTime, 0.1).mul(
          random(seed.add(2))
            .mul(2 / 3)
            .add(2 / 3),
        ),
      )
    }

    // In reach: the head within catchRadius of catchCenter, with catchLevel at its order.
    const fromCenter = toWorld(head).sub(u.catchCenter).toVar()
    const near = length(vec2(fromCenter.x, fromCenter.z))
      .lessThanEqual(u.catchRadius)
      .and(w.orders.element(m).lessThanEqual(u.catchLevel))
      .toVar()

    If(stateNow.equal(LOOSE), () => {
      grip.assign(max(grip.sub(dt.div(max(u.gripTime, 1e-3))), 0))
      // Caught by the field once the cooldown is over and in reach, or resting on the floor, props or other worms.
      W5.z.assign(
        select(share.greaterThanEqual(u.catchShare).and(cooldown.lessThanEqual(0)).and(near), W5.z.add(dt), float(0)),
      )
      const resting = firm.greaterThanEqual(3).or(held.greaterThanEqual(P / 2))
      W1.w.assign(select(resting, W1.w.add(dt), float(0)))
      const crawl = () => {
        become(CRAWLING)
        If(random(m.mul(uint(0x27d4eb2f)).add(u.frame.mul(11)).add(5)).lessThan(u.wanderChance), () => {
          wander(uint(17))
        })
      }
      // A worm on the floor crawls, even in the field's skirt; one resting in the field higher up is caught; one out of
      // reach crawls as soon as something holds it up, unless crawlBack is off.
      const outOfReach = near.not().and(supported).and(u.crawlBack.greaterThan(0.5))
      If(cooldown.lessThanEqual(0), () => {
        If(grounded.greaterThanEqual(3).and(W1.w.greaterThanEqual(u.looseRest)), crawl)
          .ElseIf(W5.z.greaterThanEqual(u.catchTime), () => {
            become(HELD)
          })
          .ElseIf(W1.w.greaterThanEqual(u.looseRest).or(outOfReach), crawl)
      })
    })
      .ElseIf(stateNow.equal(CRAWLING), () => {
        grip.assign(0)
        // Knocked off: unsupported for knockOffTime.
        W1.w.assign(select(supported, float(0), W1.w.add(dt)))
        const wandering = W5.y.greaterThan(0).toVar()
        W5.y.assign(max(W5.y.sub(dt), 0))
        const target = select(wandering, W2.xyz, goal).toVar()
        // Progress toward the goal, or backing up after stuckTime without it; counted afresh once a wander ends.
        const distance = length(target.sub(head)).toVar()
        // With restOutside off, a wanderer arriving with none of it in the field turns back.
        If(
          u.restOutside
            .lessThan(0.5)
            .and(share.lessThanEqual(0))
            .and(wandering)
            .and(distance.lessThan(u.arrivalRadius)),
          () => {
            W5.y.assign(0)
          },
        )
        If(wandering.and(W5.y.lessThanEqual(0)), () => {
          W4.z.assign(1e9)
          W4.w.assign(0)
        })
          .ElseIf(distance.lessThan(W4.z.sub(0.05)).or(wandering.and(distance.lessThan(u.arrivalRadius))), () => {
            W4.z.assign(min(distance, W4.z))
            W4.w.assign(0)
          })
          .Else(() => {
            W4.w.assign(W4.w.add(dt))
          })
        If(W3.z.lessThan(0), () => {
          W3.w.assign(W3.w.sub(dt))
          If(W3.w.lessThanEqual(0), () => {
            W3.z.assign(1)
            W4.z.assign(1e9)
            // The detour: a floor point detourDistance to one side of the goal's direction, for detourTime. The side
            // holds for detourSideTime, so repeated detours work along what blocks the way.
            If(wandering.not().and(u.detourDistance.greaterThan(0)).and(u.detourTime.greaterThan(0)), () => {
              const from = toWorld(head).toVar()
              const to = toWorld(target)
              const along = vec3(to.x.sub(from.x), 0, to.z.sub(from.z)).toVar()
              const forward = select(length(along).greaterThan(1e-3), normalize(along), vec3(1, 0, 0)).toVar()
              const sideWindow = uint(floor(u.clock.div(max(u.detourSideTime, 0.1))))
              const side = select(
                random(m.mul(uint(0x165667b1)).add(sideWindow.mul(13)).add(29)).lessThan(0.5),
                float(-1),
                float(1),
              )
              const point = from.add(vec3(forward.z.negate(), 0, forward.x).mul(u.detourDistance.mul(side))).toVar()
              W2.assign(vec4(u.worldToLocal.mul(vec4(point.x, u.floor, point.z, 1)).xyz, W2.w))
              W5.y.assign(u.detourTime)
            })
          })
        }).ElseIf(W4.w.greaterThan(u.stuckTime), () => {
          W3.z.assign(-1)
          W3.w.assign(u.backupTime)
          W4.w.assign(0)
        })
        // With catchCrawling on, caught like a loose worm once in reach for catchTime (not while wandering).
        const catching = u.catchCrawling.greaterThan(0.5).and(near).and(wandering.not()).toVar()
        W5.z.assign(select(catching, W5.z.add(dt), float(0)))
        If(W1.w.greaterThan(u.knockOffTime), () => {
          become(LOOSE)
        })
          .ElseIf(catching.and(W5.z.greaterThanEqual(u.catchTime)), () => {
            become(HELD)
          })
          // climbs only once catchLevel reaches its order
          .ElseIf(
            wandering
              .not()
              .and(headField.distance.lessThan(u.capture))
              .and(w.orders.element(m).lessThanEqual(u.catchLevel)),
            () => {
              become(CLIMBING)
            },
          )
      })
      .ElseIf(stateNow.equal(CLIMBING), () => {
        grip.assign(min(grip.add(dt.div(max(u.gripTime, 1e-3))), 1))
        W1.w.assign(select(share.lessThan(u.climbSlipShare), W1.w.add(dt), float(0)))
        W5.y.assign(select(share.lessThan(u.strayShare), W5.y.add(dt), float(0)))
        // Progress is height gained.
        If(headY.greaterThan(W4.z.add(0.05)), () => {
          W4.z.assign(headY)
          W5.z.assign(0)
        }).Else(() => {
          W5.z.assign(W5.z.add(dt))
        })
        const atFront = headY.greaterThanEqual(front.sub(0.1))
        If(share.greaterThanEqual(u.holdShare).and(atFront.or(W5.z.greaterThan(u.climbStallTime))), () => {
          become(HELD)
        })
          .ElseIf(W1.w.greaterThan(u.climbSlipTime), () => {
            become(LOOSE)
          })
          .ElseIf(timer.greaterThan(u.climbTimeout), () => {
            release(LOOSE, u.timeoutCooldown)
          })
          .ElseIf(W5.y.greaterThan(u.climbGiveUpTime), () => {
            become(CRAWLING)
            wander(uint(0))
          })
      })
      .ElseIf(stateNow.equal(HELD), () => {
        grip.assign(min(grip.add(dt.div(max(u.gripTime, 1e-3))), 1))
        W1.w.assign(select(share.lessThan(u.heldSlipShare), W1.w.add(dt), float(0)))
        // Drip: a worm at the field's edge, or lying on the floor at the base, lets go now and then; and a spill: one
        // above spillHeight for spillTime lets go (released mid-flick, a lurching end would fly off).
        const outer = meanDepth.greaterThan(float(-2 * radius)).or(grounded.greaterThanEqual(3))
        const drip = random(m.mul(uint(0x9e3779b1)).add(u.frame.mul(7)).add(1)).lessThan(u.dripRate.mul(dt))
        W5.z.assign(select(highest.greaterThan(u.spillHeight), W5.z.add(dt), float(0)))
        If(outer.and(drip).or(W5.z.greaterThanEqual(u.spillTime)), () => {
          release(LOOSE, u.knockTime)
        }).ElseIf(W1.w.greaterThan(u.heldSlipTime), () => {
          become(LOOSE)
        })
      })

    // The surface normal: the field's while gripping in it, else what holds the worm up.
    const gripping = stateNow.equal(CLIMBING).or(stateNow.equal(HELD))
    If(gripping.and(length(fieldNormal).greaterThan(1e-3)), () => {
      W1.assign(vec4(normalize(fieldNormal), W1.w))
    }).ElseIf(supported.and(length(supportNormal).greaterThan(1e-3)), () => {
      W1.assign(vec4(normalize(supportNormal), W1.w))
    })

    w.data.element(base).assign(vec4(stateNow, timer, W0.z, grip))
    w.data.element(base.add(1)).assign(W1)
    w.data.element(base.add(2)).assign(W2)
    w.data.element(base.add(3)).assign(vec4(share, cooldown, W3.z, W3.w))
    w.data.element(base.add(4)).assign(W4)
    w.data.element(base.add(5)).assign(vec4(burial, W5.y, W5.z, front))
  })().compute(M)

  // Steer: the goal and the steering bias, the heading's signed angle to it about the surface normal; the phase, run
  // backward while backing up; and the writhe, its plane turning at writheRate, flipping direction at random at
  // writheRate / (2πγ).
  const steer = Fn(() => {
    const m = instanceIndex
    const base = uint(N).add(m.mul(WORM_VEC4)).toVar()
    const W0 = w.data.element(base).toVar()
    const W1 = w.data.element(base.add(1)).toVar()
    const W2 = w.data.element(base.add(2)).toVar()
    const W3 = w.data.element(base.add(3)).toVar()
    const W4 = w.data.element(base.add(4)).toVar()
    const W5 = w.data.element(base.add(5)).toVar()
    const dt = frameTime.toVar()
    const first = m.mul(uint(P)).toVar()
    const head = b.positions.element(first).xyz.toVar()
    const M3 = w.measures.element(m.mul(MEASURE_VEC4).add(3)).toVar()
    const headNormal = M3.xyz
    const stateNow = W0.x.toVar()
    const goal = crawlGoal(head, headNormal, M3.w).toVar()
    const climb = climbDirection(headNormal, toWorld(head).y, W5.w).toVar()
    const climbing = stateNow.equal(CLIMBING)
    const crawling = stateNow.equal(CRAWLING)
    const wanderGoal = crawling.and(W5.y.greaterThan(0))
    const target = select(climbing, head.add(climb), select(wanderGoal, W2.xyz, goal)).toVar()
    const normal = select(climbing.and(length(headNormal).greaterThan(1e-3)), headNormal, W1.xyz).toVar()
    const heading = head.sub(b.positions.element(first.add(Math.min(3, P - 1))).xyz).toVar()
    const toGoal = target.sub(head).toVar()
    const flatten = (v) => v.sub(normal.mul(dot(v, normal)))
    const hFlat = flatten(heading).toVar()
    const gFlat = flatten(toGoal).toVar()
    const error = atan(dot(normal, cross(hFlat, gFlat)), dot(hFlat, gFlat))
    const bias = select(
      crawling.or(climbing),
      clamp(error.mul(u.steeringGain), u.maxBias.negate(), u.maxBias),
      float(0),
    )

    const temperature = max(u.temperature, 0)
    const frequency = select(crawling.or(climbing), u.frequency, u.frequency.mul(temperature))
    const direction = select(crawling, W3.z, float(1))
    const phase = W0.z
      .add(
        frequency
          .mul(direction)
          .mul(dt)
          .mul(Math.PI * 2),
      )
      .mod(Math.PI * 2000)
    // The peristaltic wave's phase, at its own frequency, so neither wraps nor a change of frequency makes it jump.
    const squeeze = squeezeVec(w, m)
      .x.add(
        u.peristalsisFrequency
          .mul(direction)
          .mul(dt)
          .mul(Math.PI * 2),
      )
      .mod(Math.PI * 2)
    const gamma = select(stateNow.equal(HELD), u.chirality, u.looseChirality)
    const rate = u.writheRate.mul(temperature)
    const flips = rate.div(max(gamma.mul(Math.PI * 2), 1e-3)).mul(dt)
    const flip = random(m.mul(uint(2654435761)).add(u.frame)).lessThan(flips)
    const sign = select(flip, W4.y.negate(), W4.y).toVar()
    W4.x.assign(W4.x.add(rate.mul(sign).mul(dt)).mod(Math.PI * 2000))
    W4.y.assign(sign)

    w.data.element(base).assign(vec4(W0.x, W0.y, phase, W0.w))
    w.data.element(base.add(2)).assign(vec4(target, bias))
    w.data.element(base.add(4)).assign(W4)
    squeezeVec(w, m).assign(vec4(squeeze, 0, 0, 0))
  })().compute(M)

  // Poke (tool 1), blast (tool 2) and strike (tool 3): the worms with a particle within the tool's radius of its centre
  // (the pick's hit, or the strike's own segment) come loose; poke and blast kick them away from it, strike along its
  // direction up to its speed, each worm turned off it at random and tumbling.
  const tools = Fn(() => {
    const m = instanceIndex
    const hitBits = atomicLoad(b.pick.element(uint(0))).toVar()
    const strike = u.tool.greaterThan(2.5)
    If(strike.or(hitBits.notEqual(uint(0xffffffff))), () => {
      const picked = nu.pickOrigin.add(nu.pickDirection.mul(uintBitsToFloat(hitBits)))
      const hit = select(strike, u.strikeCenter, picked).toVar()
      const tip = select(strike, u.strikeEnd, hit).toVar()
      const hitBefore = select(strike, u.strikeFrom, hit).toVar()
      const tipBefore = select(strike, u.strikeFromEnd, hit).toVar()
      // to the nearest of the segments from the last one to this one
      const distanceOf = (p) => {
        let nearest = null
        for (let j = 0; j <= STRIKE_SWEEP; j++) {
          const a = mix(hitBefore, hit, j / STRIKE_SWEEP)
          const axis = mix(tipBefore, tip, j / STRIKE_SWEEP).sub(a)
          const along = clamp(dot(p.sub(a), axis).div(max(dot(axis, axis), 1e-12)), 0, 1)
          const distance = length(p.sub(a.add(axis.mul(along))))
          nearest = nearest ? min(nearest, distance) : distance
        }
        return nearest
      }
      const blast = u.tool.greaterThan(1.5)
      const reach = select(strike, u.strikeRadius, select(blast, u.blastRadius, u.pokeRadius)).toVar()
      const speed = select(strike, u.strikeSpeed, select(blast, u.blastSpeed, u.pokeSpeed)).toVar()
      const first = m.mul(uint(P)).toVar()
      const closest = float(1e30).toVar()
      Loop(P, ({ i: k }) => {
        closest.assign(min(closest, distanceOf(b.positions.element(first.add(k)).xyz)))
      })
      If(closest.lessThan(reach), () => {
        const base = uint(N).add(m.mul(WORM_VEC4)).toVar()
        const W0 = w.data.element(base).toVar()
        w.data.element(base).assign(vec4(LOOSE, 0, W0.z, 0))
        const W1 = w.data.element(base.add(1))
        W1.assign(vec4(W1.xyz, 0))
        const W3 = w.data.element(base.add(3))
        W3.assign(vec4(W3.x, max(W3.y, u.toolCooldown), 1, 0))
        const W5 = w.data.element(base.add(5))
        W5.assign(vec4(W5.x, 0, 0, W5.w))
        const falloff = float(1).sub(closest.div(reach)).mul(0.5).add(0.5)
        const seed = m.mul(uint(3)).add(uint(0x2c1b3c6d))
        const turn = vec3(random(seed), random(seed.add(uint(1))), random(seed.add(uint(2))))
          .sub(0.5)
          .mul(2)
        const flight = normalize(u.strikeDirection.add(turn.mul(u.strikeSpread))).toVar()
        Loop(P, ({ i: k }) => {
          const i = first.add(k)
          const position = b.positions.element(i).xyz.toVar()
          const v = b.velocities.element(i)
          If(strike, () => {
            // up to its share of the speed along the flight: 1 at the segment, ½ at strikeRadius, 0 at twice it
            const own = clamp(float(1).sub(distanceOf(position).div(reach).mul(0.5)), 0, 1)
            const share = mix(falloff, own, u.strikeLocality)
            const end = float(k)
              .div(Math.max(P - 1, 1))
              .mul(2)
              .sub(1)
            const target = speed.mul(share).mul(end.mul(u.strikeTumble).add(1))
            const short = max(target.sub(dot(v.xyz, flight)), 0)
            v.assign(vec4(v.xyz.add(flight.mul(short)), v.w))
          }).Else(() => {
            const away = position.sub(hit).toVar()
            const out = normalize(away.add(vec3(0, length(away).mul(0.5).add(0.05), 0)))
            v.assign(vec4(v.xyz.add(out.mul(speed).mul(falloff)), v.w))
          })
        })
      })
    })
  })().compute(M)

  // Every substep after the velocity pass, writing only velocities: the field's lift, skin pull and drag relative to
  // the body for gripping worms; on the ground and Plane colliders, adhesion, anisotropic friction, the yield and the
  // head pull for crawling and loose worms; the climber's head pull. `culled` (colliderCulling): the colliders in the
  // worm's list.
  const surfaceOf = (culled) => {
    const i = instanceIndex
    const m = i.div(uint(P)).toVar()
    const k = i.mod(uint(P)).toVar()
    const W0 = wormVec(w, m, 0).toVar()
    const stateNow = W0.x.toVar()
    const grip = W0.w.toVar()
    const h = nu.h
    const g = gravity.toVar()
    const x = b.positions.element(i).xyz.toVar()
    const velocity = b.velocities.element(i).toVar()
    const v = velocity.xyz.toVar()
    const r = radiusOf(k).toVar()
    const record = w.data.element(i).toVar()
    const alpha = float(b.stepState.element(uint(0)))
      .div(float(nu.substeps))
      .toVar()
    const f = sample(x, alpha, true)
    const ahead = b.positions.element(select(k.greaterThan(uint(0)), i.sub(1), i)).xyz
    const behind = b.positions.element(select(k.lessThan(uint(P - 1)), i.add(1), i)).xyz
    const axis = ahead.sub(behind).toVar()
    const t = axis.div(max(length(axis), 1e-9)).toVar()

    // The field: lift, skin pull and squeeze (never upward), capped; then drag relative to the body, stronger across
    // the worm.
    const within = float(1)
      .sub(smoothstep(0, max(u.capture, 1e-4), f.distance))
      .toVar()
    const skin = smoothstep(u.skinDepth.negate(), 0, f.distance).mul(within).toVar()
    const inward = vec3(f.normal.x, max(f.normal.y, 0), f.normal.z).toVar()
    const inwardLength = length(inward).toVar()
    const press = select(inwardLength.greaterThan(1e-3), inward.div(max(inwardLength, 1e-9)), vec3(0))
    const pull = select(stateNow.equal(HELD), u.skinPull, select(stateNow.equal(CLIMBING), u.climbPull, float(0)))
    const squeeze = select(stateNow.equal(HELD).or(stateNow.equal(CLIMBING)), u.squeeze, float(0))
    const buoyancy = select(stateNow.equal(CLIMBING), u.climbBuoyancy, u.buoyancy)
    const lift = nu.gravity.mul(buoyancy.mul(within).mul(grip).mul(h).negate())
    const inwardPull = pull.mul(skin).add(squeeze.mul(within))
    const field = lift.sub(press.mul(inwardPull.mul(g).mul(grip).mul(h))).toVar()
    const most = u.maxFieldAcceleration.mul(g).mul(h)
    const size = length(field).toVar()
    If(size.greaterThan(most), () => {
      field.mulAssign(most.div(size))
    })
    v.addAssign(field)
    const drag = grip.mul(within).toVar()
    If(drag.greaterThan(0), () => {
      const relative = v.sub(f.velocity).toVar()
      const lengthwise = t.mul(dot(t, relative)).toVar()
      v.assign(
        f.velocity
          .add(lengthwise.mul(exp(u.axialDrag.mul(drag).mul(h).negate())))
          .add(relative.sub(lengthwise).mul(exp(u.lateralDrag.mul(drag).mul(h).negate()))),
      )
    })

    // The nearest surface: the ground, then the colliders, held colliderMargin off. A collider is two vec4, type in the
    // last w: Plane (normal, constant), Sphere (centre, radius), Box3 (min | max), Capsule (start, radius | end); then
    // the same at last frame's pose, blended at the substep's share of the frame. Of the nearest collider, its index
    // (−1: the ground or none) and the share along its axis, for its motion over the frame.
    const n = vec3(0).toVar()
    const gap = float(1e9).toVar()
    const best = int(-1).toVar()
    const bestAlong = float(0).toVar()
    const nearest = (listed) => {
      If(nu.groundEnabled.greaterThan(0.5), () => {
        const d = dot(nu.groundNormal, x).add(nu.groundConstant).sub(r)
        If(d.lessThan(gap), () => {
          gap.assign(d)
          n.assign(nu.groundNormal)
        })
      })
      sim.forEachCollider(
        m,
        (c) => {
          // At this substep's pose, as the velocity pass meets it.
          const a = mix(nu.colliders.element(c.mul(4).add(2)), nu.colliders.element(c.mul(4)), alpha).toVar()
          const e = mix(nu.colliders.element(c.mul(4).add(3)), nu.colliders.element(c.mul(4).add(1)), alpha).toVar()
          const kind = nu.colliders.element(c.mul(4).add(1)).w
          const d = float(0).toVar()
          const normal = vec3(0).toVar()
          const along = float(0).toVar()
          If(kind.lessThan(0.5), () => {
            const scale = max(length(a.xyz), 1e-30)
            normal.assign(a.xyz.div(scale))
            d.assign(dot(normal, x).add(a.w.div(scale)))
          })
            .ElseIf(kind.lessThan(1.5).or(kind.greaterThan(2.5)), () => {
              // From the nearest point of the segment, which for a sphere is its centre.
              const axis = select(kind.greaterThan(2.5), e.xyz.sub(a.xyz), vec3(0))
              along.assign(clamp(dot(x.sub(a.xyz), axis).div(max(dot(axis, axis), 1e-12)), 0, 1))
              const offset = x.sub(a.xyz.add(axis.mul(along))).toVar()
              const distance = length(offset)
              normal.assign(offset.div(max(distance, 1e-9)))
              d.assign(distance.sub(a.w))
            })
            .Else(() => {
              const local = x.sub(a.xyz.add(e.xyz).mul(0.5)).toVar()
              const q = abs(local).sub(e.xyz.sub(a.xyz).mul(0.5)).toVar()
              const outside = max(q, vec3(0)).toVar()
              const out = length(outside)
              d.assign(out.add(min(max(q.x, max(q.y, q.z)), 0)))
              // Inside, out through the nearest face.
              const face = select(
                q.x.greaterThanEqual(max(q.y, q.z)),
                vec3(1, 0, 0),
                select(q.y.greaterThanEqual(q.z), vec3(0, 1, 0), vec3(0, 0, 1)),
              )
              normal.assign(local.sign().mul(select(out.greaterThan(1e-9), outside.div(max(out, 1e-9)), face)))
            })
          const reach = d.sub(r).sub(nu.colliderMargin)
          If(reach.lessThan(gap), () => {
            gap.assign(reach)
            n.assign(normal)
            best.assign(int(c))
            bestAlong.assign(along)
          })
        },
        { culled: listed },
      )
    }
    nearest(culled)
    if (culled) {
      // Past breakGap of every collider in the list (which holds every one nearer, colliderCullingReach), only a stuck
      // crawler's front third reads the nearest surface, its normal deciding whether it lets go: it walks them all.
      const far = gap.greaterThanEqual(max(u.breakGap, 0.1).mul(r))
      const reads = stateNow
        .equal(CRAWLING)
        .and(float(k).lessThan(P / 3))
        .and(record.w.greaterThan(0))
      If(far.and(reads), () => {
        gap.assign(1e9)
        n.assign(vec3(0))
        best.assign(-1)
        nearest(false)
      })
    }
    // m the nearest surface moved over the frame, at the particle: none for the ground and Planes.
    const moved = vec3(0).toVar()
    If(best.greaterThanEqual(0), () => {
      const c = uint(best).mul(4).toVar()
      const a = nu.colliders.element(c)
      const e = nu.colliders.element(c.add(1))
      const lastA = nu.colliders.element(c.add(2))
      const lastE = nu.colliders.element(c.add(3))
      const kind = e.w
      If(kind.greaterThan(0.5).and(kind.lessThan(1.5).or(kind.greaterThan(2.5))), () => {
        moved.assign(mix(a.xyz.sub(lastA.xyz), e.xyz.sub(lastE.xyz), bestAlong))
      }).ElseIf(kind.greaterThan(0.5), () => {
        moved.assign(a.xyz.add(e.xyz).sub(lastA.xyz).sub(lastE.xyz).mul(0.5))
      })
    })
    const surfaceVelocity = moved.div(nu.h.mul(float(nu.substeps))).toVar()
    const touching = gap.lessThan(r.mul(0.1)).toVar()
    const cooldown = min(record.w, 0).toVar()
    const share = select(stateNow.equal(HELD).or(stateNow.equal(CLIMBING)), u.heldAdhesion, float(1)).toVar()
    // A crawler's front third sticks only to surfaces facing up, so its head slides round a wall and lifts off it;
    // the rest peels after it.
    const leaving = stateNow
      .equal(CRAWLING)
      .and(float(k).lessThan(P / 3))
      .and(dot(n, nu.up).lessThan(0.7))
    const holds = u.adhesion.greaterThan(0.5).and(share.greaterThan(0)).and(leaving.not()).toVar()
    const stuck = record.w.greaterThan(0).and(holds).toVar()
    const next = vec4(0, 0, 0, min(cooldown.add(h), 0)).toVar()

    // Adhesion: a stuck contact pulls back to the nearest surface, up to adhesionPull g (× heldAdhesion gripping),
    // unless it parted past breakGap or breakSpeed.
    const separating = dot(v.sub(surfaceVelocity), n).toVar()
    const pulling = stuck
      .and(gap.lessThan(u.breakGap.mul(r)))
      .and(separating.lessThan(u.breakSpeed))
      .toVar()
    const broke = stuck.and(pulling.not()).toVar()
    If(broke, () => {
      next.w = u.restickDelay.negate()
    })
    If(pulling, () => {
      next.w = float(1)
      const adhesion = u.adhesionPull.mul(share).mul(g).mul(h)
      const reachable = max(gap, 0).div(h).add(max(separating, 0))
      v.subAssign(n.mul(min(adhesion, reachable)))
    })
    // A contact touching now sticks from the next substep, once its re-stick delay has passed; one that just let go
    // waits the whole delay.
    If(touching.and(holds).and(broke.not()).and(cooldown.greaterThanEqual(0)), () => {
      next.w = float(1)
    })

    If(stateNow.equal(CRAWLING).or(stateNow.equal(LOOSE)), () => {
      // Friction along the body: forward (toward the head), backward and sideways, the adhesion counted as load.
      If(touching.or(pulling), () => {
        next.xyz = n
        const weight = max(dot(nu.gravity, n).negate(), 0).div(max(g, 1e-6))
        const load = weight
          .add(select(pulling, u.adhesionPull, float(0)))
          .mul(g)
          .mul(h)
          .toVar()
        const relative = v.sub(surfaceVelocity).toVar()
        const vn = n.mul(dot(relative, n)).toVar()
        const vt = relative.sub(vn).toVar()
        const forward = dot(vt, t).toVar()
        const lateral = vt.sub(t.mul(forward)).toVar()
        // Hu et al. 2009: each direction's coefficient times the unit velocity's share along it, so isotropic
        // coefficients oppose the slide exactly; neither component reverses.
        // Backing up, the setae turn: the easy way is toward the tail.
        const easy = forward.mul(wormVec(w, m, 3).z).greaterThan(0)
        const setae = select(easy, u.forwardFriction, u.backwardFriction)
        const mu = select(stateNow.equal(LOOSE), mix(setae, u.lateralFriction, u.looseIsotropy), setae)
        const slide = max(length(vt), 1e-12).toVar()
        const slowed = forward
          .sign()
          .mul(max(abs(forward).sub(mu.mul(load).mul(abs(forward).div(slide))), 0))
          .toVar()
        const keep = max(float(1).sub(u.lateralFriction.mul(load).div(slide)), 0)
        const tangential = t.mul(slowed).add(lateral.mul(keep)).toVar()
        // The yield: slower than yieldSpeed body lengths per second, it sticks. The tail tip has no segment of its
        // own: it takes the one before.
        const segment = select(k.lessThan(uint(P - 1)), i, i.sub(1))
        const bodyLength = float(P - 1).mul(b.restLengths.element(segment).x.max(1e-6))
        If(length(tangential).lessThan(u.yieldSpeed.mul(bodyLength)), () => {
          tangential.assign(vec3(0))
        })
        v.assign(surfaceVelocity.add(vn).add(tangential))
        // The head pulled along the surface toward the goal, unless a wanderer arrived.
        const goal = wormVec(w, m, 2).xyz.toVar()
        const arrived = wormVec(w, m, 5)
          .y.greaterThan(0)
          .and(length(goal.sub(x)).lessThan(u.arrivalRadius))
        If(k.equal(uint(0)).and(stateNow.equal(CRAWLING)).and(arrived.not()), () => {
          const toward = goal.sub(x).toVar()
          const flat = toward.sub(n.mul(dot(toward, n))).toVar()
          v.addAssign(flat.div(max(length(flat), 1e-6)).mul(u.headPull.mul(g).mul(h)))
        })
      })
    }).Else(() => {
      // Gripping: the field's normal in it, for the wave plane; the climber's head pulled up along it.
      If(grip.greaterThan(0).and(f.distance.lessThan(u.capture)), () => {
        next.xyz = f.normal
      }).ElseIf(touching, () => {
        next.xyz = n
      })
      // Held, Coulomb friction relative to the surface, the same every way, the adhesion counted as load.
      If(stateNow.equal(HELD).and(touching.or(pulling)), () => {
        const weight = max(dot(nu.gravity, n).negate(), 0).div(max(g, 1e-6))
        const load = weight
          .add(select(pulling, u.adhesionPull.mul(share), float(0)))
          .mul(g)
          .mul(h)
        const relative = v.sub(surfaceVelocity).toVar()
        const vn = n.mul(dot(relative, n)).toVar()
        const vt = relative.sub(vn).toVar()
        const keep = max(float(1).sub(u.heldFriction.mul(load).div(max(length(vt), 1e-12))), 0)
        v.assign(surfaceVelocity.add(vn).add(vt.mul(keep)))
      })
      If(k.equal(uint(0)).and(stateNow.equal(CLIMBING)), () => {
        const front = wormVec(w, m, 5).w
        const c = climbDirection(f.normal, toWorld(x).y, front)
        v.addAssign(c.mul(u.climbHeadPull.mul(g).mul(h).mul(within)))
      })
      // Rearing: for rearTime at a time, a share of the held worms lift their leading part where the field's top
      // faces up, easing out over rearSpan of the body.
      const rearReach = max(u.rearSpan, 0)
        .mul(P - 1)
        .toVar()
      If(stateNow.equal(HELD).and(u.rearPull.greaterThan(0)).and(float(k).lessThan(rearReach)), () => {
        const period = max(u.rearTime, 0.1)
        const rearWindow = floor(W0.y.div(period).add(random(m.mul(uint(40503)).add(29)))).toVar()
        const chosen = random(
          m
            .mul(uint(2654435761))
            .add(uint(rearWindow.max(0)))
            .add(uint(977)),
        ).lessThan(u.rearShare)
        If(chosen, () => {
          const up = smoothstep(0.3, 0.7, dot(f.normal, nu.up))
          const ease = float(1).sub(float(k).div(max(rearReach, 1e-6)))
          v.addAssign(nu.up.mul(u.rearPull.mul(g).mul(h).mul(up).mul(ease)))
        })
      })
    })
    w.data.element(i).assign(next)
    b.velocities.element(i).assign(vec4(v, velocity.w))
  }
  const surface = Fn(() => surfaceOf(false))().compute(N)
  const surfaceCulled = Fn(() => surfaceOf(true))().compute(N)

  w.passes = { reset, fillClear, probe, measure, state, steer, tools, surface, surfaceCulled }
  for (const [key, pass] of Object.entries(w.passes)) pass.setName(`worms_${key}`)
}

// ======== The helper ========

const stateColor = (state) =>
  select(
    state.lessThan(0.5),
    vec3(0.5),
    select(
      state.lessThan(1.5),
      vec3(0.9, 0.2, 0.2),
      select(state.lessThan(2.5), vec3(1, 0.7, 0.1), vec3(0.2, 0.8, 0.3)),
    ),
  )

/**
 * WormSimulationHelper — the worms' capsules as the solver sees them (NoodleSimulationHelper), coloured by state:
 * grey loose, red crawling, amber climbing, green held; and a small cube at each worm's goal. It leaves the scene and
 * disposes itself when the worms are disposed.
 */
export class WormSimulationHelper extends THREE.Group {
  isWormSimulationHelper = true
  type = 'WormSimulationHelper'

  #worms
  #capsules
  #goals
  #disposed = false
  #capsulesDisposed = false
  #onDispose = () => {
    this.removeFromParent()
    this.dispose()
  }

  constructor(worms) {
    super()
    if (!worms?.isWormSimulation) throw new Error('WormSimulationHelper: needs a WormSimulation.')
    this.#worms = worms
    const P = worms.particlesPerNoodle
    const data = worms.wormData
    const offset = worms.wormDataOffset
    const stateOf = (worm) => data.element(uint(offset).add(worm.mul(WORM_VEC4))).x

    this.#capsules = new NoodleSimulationHelper(worms)
    this.#capsules.name = 'worm capsules'
    this.#capsules.addEventListener('dispose', () => {
      this.#capsulesDisposed = true
    })
    this.#capsules.material.colorNode = stateColor(stateOf(instanceIndex.div(uint(P - 1))))
    this.add(this.#capsules)

    const material = new THREE.MeshBasicNodeMaterial({ name: 'worm goal' })
    material.colorNode = stateColor(stateOf(instanceIndex))
    material.positionNode = data.element(uint(offset).add(instanceIndex.mul(WORM_VEC4)).add(2)).xyz.add(positionLocal)
    this.#goals = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.04), material)
    this.#goals.name = 'worm goals'
    this.#goals.count = worms.wormCount
    this.#goals.frustumCulled = false
    this.add(this.#goals)
    worms.addEventListener('dispose', this.#onDispose)
  }

  get worms() {
    return this.#worms
  }

  updateMatrixWorld(force) {
    this.#worms.updateWorldMatrix(true, false)
    this.matrixWorld.copy(this.#worms.matrixWorld)
    this.matrixWorldNeedsUpdate = false
    for (const child of this.children) child.updateMatrixWorld(force)
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    super.dispose()
    this.#worms.removeEventListener('dispose', this.#onDispose)
    // The capsules helper may have left already, on the worms' own dispose.
    this.#capsules.removeFromParent()
    if (!this.#capsulesDisposed) this.#capsules.dispose()
    this.#goals.removeFromParent()
    this.#goals.geometry.dispose()
    this.#goals.material.dispose()
  }
}
