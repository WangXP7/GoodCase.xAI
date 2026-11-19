// Soft worms that crawl, climb a moving body and pile up on it, built on NoodleSimulation:
//
//   const worms = new WormSimulation(curves, material, { field, states, radius: 0.024, particlesPerNoodle: 18 })
//   worms.colliders.push(...field.colliders)
//   scene.add(worms)
//   renderer.setAnimationLoop(() => {
//     field.update(dt)
//     worms.leadVelocity.copy(rootVelocity)
//     worms.update(renderer, dt)
//     renderer.render(scene, camera)
//   })
//   worms.strike(center, direction, { end })
//   worms.reset({ clock: true })

import { Curve, Group, Material, Node, NodeMaterial, Raycaster, Sphere, StorageBufferNode, Vector3 } from 'three/webgpu'
import { NoodleExtraPasses, NoodleSimulation, NoodleSimulationOptions } from './NoodleSimulation.js'

/** A worm's state, wormData W0.x. */
export declare const WormState: {
  readonly LOOSE: 0
  readonly CRAWLING: 1
  readonly CLIMBING: 2
  readonly HELD: 3
}
export type WormState = (typeof WormState)[keyof typeof WormState]

/** A field's TSL sample, world space. */
export type WormFieldSample = {
  /** Signed, > 0 outside. */
  distance: Node<'float'>
  normal: Node<'vec3'>
  velocity: Node<'vec3'>
}

/** The body worms climb and fill: a still ball as in worms.html, or the BodyField in examples/utils. */
export interface WormField {
  /** TSL, world space; `alpha` 0 samples last frame's pose, 1 this one's. */
  sample(position: Node<'vec3'>, alpha?: Node<'float'> | number): WormFieldSample
  /** m³ of field per layer of height `step`, from `floor` up. */
  volumeByHeight?(step: number, count: number, out: Float32Array): Float32Array
  /** World height the fill layers start from. Default 0. */
  floor?: number
  boundingSphere?: Sphere
}

export interface WormRadiusProfileOptions {
  /** Share of the length the head rounds over. Default 0.05. */
  headRounding?: number
  /** Share of the length the tail tapers over. Default 0.45. */
  tailTaper?: number
  /** The tail tip's radius, × the widest, at least 0.001. Default 0.12. */
  tailTip?: number
}

/** Multipliers of the widest radius, head to tail tip: a rounded head, a uniform body and a tapered tail. */
export declare function wormRadiusProfile(particlesPerNoodle: number, options?: WormRadiusProfileOptions): number[]

export interface WormSimulationOptions<TField extends WormField = WormField>
  extends Omit<NoodleSimulationOptions, 'noodleHook'>,
    WormRadiusProfileOptions {
  /** The widest radius. Default 0.024. */
  radius?: number
  /** At most 170. Default 18. */
  particlesPerNoodle?: number
  /** Default wormRadiusProfile() of headRounding, tailTaper and tailTip. */
  radiusProfile?: ArrayLike<number>
  /** The starting colliderCulling. Default true. */
  colliderCulling?: boolean
  /** Without one, worms crawl to `home`. Default null. */
  field?: TField | null
  /** Each worm's WormState at the start and after reset(). Default LOOSE. */
  states?: ArrayLike<number>
  /** Each worm's cooldown, s, at the start and after reset(): until it ends, a loose worm lies still. Default 0. */
  cooldowns?: ArrayLike<number>
  /** Each worm's catch order, compared with catchLevel. Default 0. */
  catchOrders?: ArrayLike<number>
  /** m: the height of each fill layer, from the field's floor up. Default 0.1. */
  fillLayerHeight?: number
  /** Fill layers, at most 256. Default up to the top of the field's boundingSphere, else 20. */
  fillLayers?: number
}

export interface WormStrikeOptions {
  /** The segment's other end: a barrel, not a point. Default `center`. */
  end?: Vector3
  /** Where `center` was a moment ago, so the swept space strikes too. Default `center`. */
  from?: Vector3
  /** Where `end` was. Default `from` moved as `center` to `end`. */
  fromEnd?: Vector3
}

export interface WormResetOptions {
  /** Restarts the clock and the random draws too, so the run from construction plays again. Default false. */
  clock?: boolean
}

export declare class WormSimulation<
  TMaterial extends Material = NodeMaterial,
  TField extends WormField = WormField,
> extends NoodleSimulation<TMaterial> {
  /** Drawn with a MeshStandardNodeMaterial. */
  constructor(curves: Curve<Vector3> | Curve<Vector3>[], material?: null, options?: WormSimulationOptions<TField>)
  /**
   * Worm defaults: numSubsteps 8, stretchingCompliance 0.001, bendingPlasticity 0, contactFriction and
   * colliderFriction 0.8, groundFriction 0.05, separationSpeed 1.5, normalDamping 0.2, maxSpeed at most 11.
   * @param curves One per worm, head first: its starting pose.
   * @param material Cloned, its positionNode replaced.
   */
  constructor(
    curves: Curve<Vector3> | Curve<Vector3>[],
    material: TMaterial | null,
    options?: WormSimulationOptions<TField>,
  )

  readonly isWormSimulation: true

  /** Gait: peak bend per joint, A · 2π / wavelength per body length: the wave the others scale. Default 1. */
  amplitude: number
  /** The crawling wave's amplitude, × amplitude. Default 1. */
  crawlAmplitude: number
  /** The crawling wave's wavelength, × wavelength. Default 1. */
  crawlWavelength: number
  /** The climbing wave's amplitude, × amplitude. Default 0.8. */
  climbAmplitude: number
  /** Share of the wave left at the tail tip, over tailWaveSpan. Default 1. */
  tailAmplitude: number
  /** Of the wave, body lengths. Default 0.9. */
  wavelength: number
  /** Hz of the wave, crawling and climbing. Default 1.8. */
  frequency: number
  /** Of the muscles, × spacing⁴ like bendingCompliance, ÷ the activation: lower is stronger. Default 1. */
  muscleCompliance: number
  /** Writhe amplitude when held, × temperature; buried worms writhe less. Default 0.15. */
  heldAmplitude: number
  /** Writhe amplitude when loose, × temperature. Default 0.2. */
  looseAmplitude: number
  /** s: how slowly held and loose worms' rest curvature follows their curl, or the current one. Default 0.5. */
  restMemory: number
  /** 1/m: the curl held worms' rest curvature eases toward; 0 keeps their bend. Default 0. */
  curl: number
  /** 1/m: the same for loose worms. Default 0. */
  looseCurl: number
  /** Share the curl varies by along each worm, so coils run into arcs. Default 0.5. */
  curlVariation: number
  /** Cycles of that variation along each worm. Default 1. */
  curlWaves: number
  /** 1/m: the curl fades in as a joint's coherent bend reaches this, from half of it. Default 2. */
  curlThreshold: number
  /** rad/s the writhe's wave plane turns at. Default 3. */
  writheRate: number
  /** γ of the writhe when held: near 0.7 worms tangle. Default 0.7. */
  chirality: number
  /** γ otherwise: near 0.36 worms untangle. Default 0.36. */
  looseChirality: number
  /** Scales the writhe's amplitude, frequency and flip rate: cold is firm and tangled, warm runny. Default 1. */
  temperature: number
  /** s: how slowly crawling and climbing worms' rest curvature follows the wave. Default 0.05. */
  gaitMemory: number
  /** Share of the held writhe a fully buried worm loses. Default 0.6. */
  buriedDamping: number
  /** Share of the body, from the tail tip, over which the wave eases to tailAmplitude. Default 1/3. */
  tailWaveSpan: number
  /** s the loose writhe eases in over. Default 0.5. */
  looseEaseIn: number
  /** Share of the travelling bend wave, crawling and climbing. Default 1. */
  serpentine: number
  /** rad per body length of the squirm, a chaotic bend, crawling and climbing. Default 0. */
  squirm: number
  /** Hz: the squirm's typical frequency. Default 1.5. */
  squirmFrequency: number
  /** Cycles per body length: the squirm's typical wavenumber. Default 1.2. */
  squirmWaves: number
  /** Share of a right angle the squirm's plane tips out of the surface's, at most. Default 0.5. */
  squirmLift: number
  /** 0 to 1: how far the squirm fades between bursts. Default 0.5. */
  squirmBursts: number
  /** Share of the squirm a crawler's head takes, eased up to all of it over the front 40%. Default 1. */
  squirmHead: number
  /** Share of the squirm held and loose worms take, in the writhe's plane. Default 0. */
  heldSquirm: number
  /** Share each segment's rest length swings by while crawling: a wave head to tail. Default 0. */
  peristalsis: number
  /** Hz of the peristaltic wave. Default 2. */
  peristalsisFrequency: number
  /** Peristaltic waves along the body. Default 1. */
  peristalsisWaves: number

  /** Steering bias per radian of heading error. Default 2.5. */
  steeringGain: number
  /** The most steering bias, rad per body length, on the leading two-thirds. Default 3. */
  maxBias: number
  /** g pulling a crawler's head along the surface toward its goal. Default 0.1. */
  headPull: number
  /** s without progress before a crawler backs up. Default 8. */
  stuckTime: number
  /** s a crawler backs up for. Default 1.5. */
  backupTime: number
  /** m to a random side of its goal a crawler heads after backing up; 0 for none. Default 1. */
  detourDistance: number
  /** s it heads there before turning back to its goal. Default 3. */
  detourTime: number
  /** s each worm keeps its detour side for. Default 20. */
  detourSideTime: number
  /** s: the most a crawler leads the moving body by, at leadVelocity. Default 1. */
  pursuitLead: number
  /** m/s a crawler is taken to make, for the lead. Default 1. */
  crawlSpeed: number

  /** Coulomb coefficient toward the head on the ground and colliders, crawling and loose. Default 0.05. */
  forwardFriction: number
  /** The same toward the tail. Default 0.5. */
  backwardFriction: number
  /** The same sideways. Default 1. */
  lateralFriction: number
  /** 0 to 1: how far a loose worm's forward and backward friction go to lateralFriction. Default 0. */
  looseIsotropy: number
  /** Body lengths/s: a particle on a surface sliding slower stops. Default 0.1. */
  yieldSpeed: number
  /** Coulomb coefficient on the ground and colliders for held worms, every way. Default 0. */
  heldFriction: number

  /** Worms stick to the ground and colliders. Default true. */
  adhesion: boolean
  /** g of adhesion pull on crawling and loose worms, counted by friction as load. Default 2. */
  adhesionPull: number
  /** Share of adhesionPull on held and climbing worms. Default 0. */
  heldAdhesion: number
  /** × radius: a stuck contact lets go past this gap. Default 0.5. */
  breakGap: number
  /** m/s: a stuck contact lets go separating faster. Default 1.5. */
  breakSpeed: number
  /** s before a contact that let go can stick again. Default 0.4. */
  restickDelay: number

  /** Share of gravity the field lifts off a held or loose worm inside it, × its grip. Default 0.88. */
  buoyancy: number
  /** Share of gravity the field lifts off a climbing worm, × its grip. Default 1. */
  climbBuoyancy: number
  /** g pressing held worms in at the field's skin. Default 1.2. */
  skinPull: number
  /** g pressing held and climbing worms inward everywhere inside the field, never upward. Default 0. */
  squeeze: number
  /** g pressing climbing worms in at the field's skin. Default 0.4. */
  climbPull: number
  /** g pulling a climber's head up along the field, then in at the fill front. Default 0.3. */
  climbHeadPull: number
  /** g lifting a rearing held worm's front where the field's top faces up; 0: no rearing. Default 0. */
  rearPull: number
  /** Share of the held worms that rear, chosen again every rearTime. Default 0.3. */
  rearShare: number
  /** s a worm rears, or doesn't, before it is chosen again. Default 6. */
  rearTime: number
  /** Share of the body, from the head, a rearing worm lifts. Default 0.25. */
  rearSpan: number
  /** g: the most lift and skin pull add together. Default 3. */
  maxFieldAcceleration: number
  /** 1/s of drag across the worm, relative to the body. Default 6. */
  lateralDrag: number
  /** 1/s of drag along the worm, relative to the body. Default 1.5. */
  axialDrag: number
  /** s a worm's grip takes to rise or fade. Default 0.5. */
  gripTime: number
  /** m outside the field where its hold fades out. Default 0.12. */
  capture: number
  /** m inside the field the skin pull reaches. Default 0.1. */
  skinDepth: number

  /** Share of a layer's capacity at which the fill front moves past it. Default 0.8. */
  fillFraction: number
  /** Share of the field's volume worms fill. Default 0.3. */
  packing: number
  /** Per second: the chance a held worm at the field's edge, or on the floor at its base, lets go. Default 0.01. */
  dripRate: number
  /** s a dripped worm can't be caught or crawl. Default 1.5. */
  knockTime: number
  /** m, world height: a held worm with any part above it for spillTime lets go. Default Infinity. */
  spillHeight: number
  /** s a held worm stays above spillHeight before it lets go. Default 0.25. */
  spillTime: number
  /** Share of fallen worms that first crawl off to a point, then come back. Default 0.7. */
  wanderChance: number
  /** s a wander lasts on average. Default 15. */
  wanderTime: number
  /** rad: a wander's heading spreads this far either side of its direction out. Default 1. */
  wanderSpread: number
  /** m from its head, at least, a wanderer's point lies. Default 1.5. */
  wanderMinDistance: number
  /** m, at most. Default 3. */
  wanderMaxDistance: number
  /** m: a wanderer whose head is this close to its point lies still until the wander ends. Default 0.25. */
  arrivalRadius: number
  /** Resting worms lie still anywhere; off, only partly in the field. Default true. */
  restOutside: boolean
  /** s a worm may climb before it lets go. Default 20. */
  climbTimeout: number
  /** s of cooldown after a climb timed out. Default 5. */
  timeoutCooldown: number
  /** s collapse() keeps worms loose, plus up to collapseStagger. Default 3. */
  collapseTime: number
  /** s of random stagger per worm added to collapseTime. Default 2. */
  collapseStagger: number
  /** s a loose worm rests on something before it crawls or lies still. Default 0.3. */
  looseRest: number
  /** A loose worm with this share of its particles in the field for catchTime is held. Default 0.5. */
  catchShare: number
  /** s, for catchShare and catchCrawling. Default 0.5. */
  catchTime: number
  /** m across the floor from catchCenter past which a loose worm isn't caught but crawls back. Default Infinity. */
  catchRadius: number
  /** A loose worm is caught, and a crawler climbs, only once this reaches its catch order. Default Infinity. */
  catchLevel: number
  /** A loose worm out of reach crawls back once its cooldown ends; off, it lies where it fell. Default true. */
  crawlBack: boolean
  /** A crawler in reach for catchTime is caught like a loose worm; off, only once it climbs. Default false. */
  catchCrawling: boolean
  /** s a crawler goes unsupported before it comes loose. Default 1. */
  knockOffTime: number
  /** Share in the field a climber needs to be held, at the fill front or once it stalls. Default 0.7. */
  holdShare: number
  /** s a climber gains no height before it stalls. Default 3. */
  climbStallTime: number
  /** A climber with under this share in the field for climbSlipTime comes loose. Default 0.1. */
  climbSlipShare: number
  /** Default 1. */
  climbSlipTime: number
  /** A climber with under this share in the field for climbGiveUpTime wanders off. Default 0.4. */
  strayShare: number
  /** Default 8. */
  climbGiveUpTime: number
  /** A held worm with under this share in the field for heldSlipTime comes loose. Default 0.3. */
  heldSlipShare: number
  /** Default 1.5. */
  heldSlipTime: number

  /** s a grab, poke, blast or strike keeps a worm from crawling or being caught. Default 3. */
  toolCooldown: number
  /** m round the hit poke() loosens. Default 0.3. */
  pokeRadius: number
  /** m/s of poke()'s kick. Default 1.5. */
  pokeSpeed: number
  /** m round the hit blast() reaches. Default 0.7. */
  blastRadius: number
  /** m/s at a blast's centre. Default 6. */
  blastSpeed: number
  /** m round a strike's centre or segment. Default 0.35. */
  strikeRadius: number
  /** m/s along a strike's direction at its centre. Default 8. */
  strikeSpeed: number
  /** 0 to 1: how far each struck worm's flight turns off the direction, at random. Default 0.35. */
  strikeSpread: number
  /** ± share of the speed one end of a struck worm gains over the other. Default 0.6. */
  strikeTumble: number
  /** 0: a struck worm flies as one; 1: each particle by its own distance. Default 0. */
  strikeLocality: number

  /** Where crawlers head without a field, object space. */
  home: Vector3
  /** World space: where catchRadius is measured from, such as the body's base. */
  catchCenter: Vector3
  /** The body's velocity, world space: crawlers lead it by up to pursuitLead. */
  leadVelocity: Vector3
  /** World space, flattened: wanderers head out this way, by its length against 1 for straight out. */
  wanderDirection: Vector3

  /** A read lists the worms' own passes too, in new arrays: assign a new object rather than push to them. */
  extraPasses: NoodleExtraPasses

  readonly wormCount: number
  /** options.field, or null. */
  readonly field: TField | null
  /** The field the surface pass sampled this substep at each particle, for a one-thread-per-particle substep pass. */
  readonly cachedField: WormField | null
  /** Per particle 1 vec4, then per worm 6 vec4 (W0: state, time in state, phase, grip), then 1 vec4 per worm. */
  readonly wormData: StorageBufferNode<'vec4'>
  /** Where wormData's per-worm part starts: worm m's W0 is at wormDataOffset + 6m. */
  readonly wormDataOffset: number
  readonly fillLayers: number
  /** m. */
  readonly fillLayerHeight: number
  /** Particles each fill layer holds, from the field's volumeByHeight() × packing. */
  readonly fillCapacity: Float32Array

  /** Measures the field's volume per layer again: after its pose or the worms' size changes. */
  updateFillCapacity(): this
  /** Every worm within pokeRadius of where the ray first hits a worm comes loose, with a small kick. */
  poke(raycaster: Raycaster): this
  /** Every worm within blastRadius of the hit flies off at up to blastSpeed. */
  blast(raycaster: Raycaster): this
  /** Every worm within strikeRadius of `center`, world space, flies along `direction` at up to strikeSpeed. */
  strike(center: Vector3, direction: Vector3, options?: WormStrikeOptions): this
  /** Every worm comes loose for collapseTime, plus up to collapseStagger. */
  collapse(): this
  /** Every worm back on its curve, at rest, in its starting state, at the next update(). */
  reset(options?: WormResetOptions): this
}

/** The worms' capsules coloured by state: grey loose, red crawling, amber climbing, green held; a cube at each goal. */
export declare class WormSimulationHelper extends Group {
  constructor(worms: WormSimulation<Material, WormField>)

  readonly isWormSimulationHelper: true

  readonly worms: WormSimulation<Material, WormField>
}
