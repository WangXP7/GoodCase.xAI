import * as THREE from 'three/webgpu'
import {
  builtinAOContext,
  context,
  mrt,
  normalViewGeometry,
  output,
  packNormalToRGB,
  pass,
  renderOutput,
  sample,
  unpackRGBToNormal,
  velocity,
} from 'three/tsl'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import GUI from 'lil-gui'
import Stats from 'stats-gl'
import { xeGTAO } from '../../rendering/ambient-occlusion/XeGTAONode.js'
import { taau } from '../../rendering/taau/TAAUNode.js'

/**
 * Lab — the stage the simulation examples share: a steel lab bench in a bright, plain room under a soft overhead light,
 * rimmed from behind, with ambient occlusion, an orbiting camera, a GUI, stats, a loading screen and pointer grabbing.
 * It holds no simulation: an example adds its own, colliding with the bench through `colliders` and `ground`.
 *
 *   const lab = await Lab.create({ title: 'Noodles', hint: 'Drag a noodle to pull it', scale: 4 })
 *   lab.addTray()                                     // optional: walls that keep crawlers on the bench
 *   const noodles = new NoodleSimulation(dropStrands({ ... }), material, { colliders: lab.colliders })
 *   noodles.ground = lab.ground
 *   lab.add(noodles)                                  // casts and receives shadows
 *   lab.onGrab({
 *     hit: async (raycaster) => (await noodles.pickAsync(raycaster)) !== null,  // else the drag orbits
 *     start: (raycaster) => noodles.pick(raycaster).grabPicked().moveGrabAlongRay(raycaster.ray),
 *     move: (raycaster) => noodles.moveGrabAlongRay(raycaster.ray),
 *     end: () => noodles.endGrab(),
 *   })
 *   lab.onReset(() => noodles.reset())               // R, and the GUI's Drop again
 *   lab.onFrame((delta) => noodles.update(lab.renderer, delta))
 *   lab.ready()                                       // the View folder joins the GUI; the loading screen fades out
 *
 * Metres, y up. The bench's top is centred on the origin at y = 0, its long side along x, and the floor is
 * `table.height` below: simulations that measure their floor from y = 0, as WormSimulation does without a field, take
 * the bench for it. A left drag (one finger) on a strand grabs it; every other gesture is OrbitControls': a left drag
 * elsewhere orbits, a right drag or two fingers pan, and the wheel or a pinch zooms.
 */

const TABLE = { width: 1.6, depth: 0.8, height: 0.92, thickness: 0.035 }
const FLOOR = -TABLE.height
// The frame: square legs inset from the corners, an apron under the top, stretchers low between the legs.
const LEG = 0.045
const INSET = 0.07
const FOOT = 0.012
const RAIL_HEIGHT = 0.16
const COLORS = {
  room: '#e7eaed',
  floor: '#d2d6da',
  top: '#bfc6cd',
  steel: '#d6dade',
  rubber: '#2c3034',
  enamel: '#eef0ee',
  light: '#fbfdff',
  rim: '#eef3ff',
}
// Toward each light from the bench's foot, at a scale of 1: the overhead light, and the rim low behind the bench that
// catches the tops and edges.
const LIGHT_DIRECTION = [0.5, 3.2, 1.1]
const RIM_DIRECTION = [-0.3, 1.4, -2.6]
const _eye = new THREE.Vector3()
const _target = new THREE.Vector3()
const _view = new THREE.Matrix4()
const _box = new THREE.Box3()

// An open hand over what a drag would grab, closed through the drag.
export const HAND = Object.freeze({ hover: 'grab', drag: 'grabbing' })
// Pixels per CSS pixel: the output's at most, the scene's, which TAAU upscales to the output's, and the occlusion's.
const OUTPUT_PIXEL_RATIO = 1.5
const SCENE_PIXEL_RATIO = 1
const AO_PIXEL_RATIO = 0.5
const VIEW = {
  shadows: true,
  light: 3.5,
  rim: 5, // 0 turns it off
  rimShadows: true,
  environment: 0.4,
  ao: true,
  aoIntensity: 1,
  aoRadius: 0.1, // m at a scale of 1
}

export class Lab {
  /** The lab's size, × a 1.6 m bench (options.scale). */
  scale
  /** The bench, m: its top's width (x), depth (z), height and thickness. */
  table
  /** The centre of the bench's top surface: the origin. */
  surface = new THREE.Vector3()
  /** The floor, for a simulation's `ground`. */
  ground
  /** Box3s of the bench's top, legs and stretchers, world space, for a simulation's `colliders`. */
  colliders = []
  /** What the shadow map covers: the bench, the floor round it and the air above it. Grow it in place to fit. */
  shadowBounds
  /** The View folder's settings, applied as they change. */
  view = { ...VIEW }

  /** @type {THREE.WebGPURenderer} */
  renderer
  /** @type {THREE.Scene} */
  scene
  /** @type {THREE.PerspectiveCamera} */
  camera
  /** @type {OrbitControls} */
  controls
  /** @type {GUI} */
  gui
  /** The overhead light. @type {THREE.DirectionalLight} */
  light
  /** The rim light, low behind the bench; hidden at an intensity of 0. @type {THREE.DirectionalLight} */
  rim
  stats
  /** @type {THREE.RenderPipeline} */
  pipeline
  /** The ambient occlusion (XeGTAONode): it darkens the environment's light in creases. */
  occlusion
  timer = new THREE.Timer()

  #frame = []
  #reset = []
  #grab = null
  #gesture = null
  #hover = { event: null, testing: false, hit: false }
  #touches = new Set()
  #scenePass = null
  #prePass = null
  #aoContext = null
  #raycaster = new THREE.Raycaster()
  #pointer = new THREE.Vector2()

  constructor(scale = 1) {
    if (!(scale > 0 && Number.isFinite(scale))) throw new Error(`Lab: scale must be a number > 0 (got ${scale}).`)
    this.scale = scale
    this.table = Object.fromEntries(Object.entries(TABLE).map(([key, value]) => [key, value * scale]))
    this.ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), -FLOOR * scale)
    this.shadowBounds = new THREE.Box3(
      new THREE.Vector3(-1.3, FLOOR, -0.9).multiplyScalar(scale),
      new THREE.Vector3(1.3, FLOOR + 2.4, 0.9).multiplyScalar(scale),
    )
    this.view.aoRadius *= scale
  }

  /**
   * Starts WebGPU and builds the room; the loop runs from here on, behind the loading screen until ready().
   *
   * @param {object} [options]
   * @param {string} [options.title=document.title] - The GUI's title.
   * @param {string} [options.hint] - A line of help at the bottom of the screen.
   * @param {number} [options.scale=1] - The lab's size, × a 1.6 m bench: a bigger one holds bigger simulations.
   */
  static async create(options = {}) {
    const lab = new Lab(options.scale)
    try {
      await lab.#init(options)
    } catch (error) {
      Lab.fail(error)
      throw error
    }
    return lab
  }

  /** Shows what is loading on the loading screen. */
  static stage(text) {
    const stage = document.querySelector('#loading .loading-stage')
    if (stage && !document.getElementById('loading').classList.contains('failed')) stage.textContent = text
  }

  /** Prints an error on the loading screen, which stays up. */
  static fail(error) {
    const loading = document.getElementById('loading')
    if (!loading || loading.classList.contains('done')) return
    loading.classList.add('failed')
    loading.querySelector('.loading-stage').textContent = String(error?.message ?? error)
  }

  /** Adds objects to the scene, casting and receiving shadows. */
  add(...objects) {
    for (const object of objects) {
      object.traverse((child) => {
        if (child.isMesh) child.castShadow = child.receiveShadow = true
      })
      this.scene.add(object)
    }
    return this
  }

  /** Runs `handler(delta)` every frame, before the render; delta in s. */
  onFrame(handler) {
    this.#frame.push(handler)
    return this
  }

  /** Runs `handler()` on R and the GUI's Drop again. */
  onReset(handler) {
    this.#reset.push(handler)
    return this
  }

  /**
   * The left drag (one finger): `hit(raycaster)`, a boolean or a promise of one, says whether it starts on the
   * simulation; if so `start(raycaster)` runs, then `move(raycaster)` as the pointer moves and `end()` on release or
   * when a second finger comes down; if not, it orbits. Without `hit`, every left drag is the simulation's.
   * `cursors()` gives the cursor where a drag would start on the simulation (`hover`) and through one (`drag`), or null
   * for neither. Replaces the last one.
   */
  onGrab({ hit = null, start, move = null, end = null, cursors = () => HAND }) {
    this.#endGrab()
    this.#grab = { hit, start, move, end, cursors }
    return this
  }

  /**
   * Sets a white enamel tray on the middle of the bench, its base and walls joining `colliders`: it keeps crawlers
   * on the bench. Call it before building the simulation that collides with it.
   *
   * @param {object} [options]
   * @param {number} [options.width=0.9 × scale] - m, along x.
   * @param {number} [options.depth=0.55 × scale] - m, along z.
   * @param {number} [options.height=0.07 × scale] - m: the walls'.
   * @returns {THREE.Mesh}
   */
  addTray({ width = 0.9 * this.scale, depth = 0.55 * this.scale, height = 0.07 * this.scale } = {}) {
    const wall = 0.008 * this.scale
    const base = 0.004 * this.scale
    // [size, centre]
    const parts = [
      [[width, base, depth], [0, base / 2, 0]],
      [[width, height, wall], [0, height / 2, (depth - wall) / 2]],
      [[width, height, wall], [0, height / 2, -(depth - wall) / 2]],
      [[wall, height, depth - 2 * wall], [(width - wall) / 2, height / 2, 0]],
      [[wall, height, depth - 2 * wall], [-(width - wall) / 2, height / 2, 0]],
    ]
    const pieces = parts.map(([size, center]) => {
      this.colliders.push(box(center, size))
      return new RoundedBoxGeometry(...size, 2, Math.min(...size) * 0.45).translate(...center)
    })
    const tray = new THREE.Mesh(
      mergeGeometries(pieces),
      new THREE.MeshStandardNodeMaterial({ name: 'enamel', color: COLORS.enamel, roughness: 0.28 }),
    )
    for (const geometry of pieces) geometry.dispose()
    tray.name = 'tray'
    tray.material.shadowSide = THREE.DoubleSide
    this.add(tray)
    return tray
  }

  reset() {
    this.#endGrab()
    for (const handler of this.#reset) handler()
    return this
  }

  /** Ends loading: the View folder joins the GUI, last, and the loading screen fades out. */
  ready() {
    this.#addViewFolder()
    document.getElementById('loading')?.classList.add('done')
    return this
  }

  // ---- Setup ----

  async #init({ title = document.title, hint = '' }) {
    window.addEventListener('error', (event) => Lab.fail(event.error ?? event.message))
    window.addEventListener('unhandledrejection', (event) => Lab.fail(event.reason))

    Lab.stage('Starting WebGPU')
    const renderer = new THREE.WebGPURenderer({ antialias: false })
    // WebGPU or an error: three's WebGL 2 fallback can't run the simulations' compute shaders.
    renderer._getFallback = null
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, OUTPUT_PIXEL_RATIO))
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.toneMapping = THREE.AgXToneMapping
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    document.body.appendChild(renderer.domElement)
    try {
      await renderer.init()
    } catch (error) {
      const reason = navigator.gpu ? (error?.message ?? error) : 'this browser has no navigator.gpu'
      throw new Error(`WebGPU failed to start, and the simulations have no WebGL fallback: ${reason}`)
    }
    if (renderer.backend.compatibilityMode) {
      console.warn('[lab] WebGPU runs in compatibility mode here: the simulations need core WebGPU.')
    }
    this.renderer = renderer

    const canTime = renderer.hasFeature('timestamp-query')
    this.stats = new Stats({ trackGPU: canTime, trackCPT: canTime })
    document.body.appendChild(this.stats.dom)
    this.stats.init(renderer)

    Lab.stage('Building the lab')
    const scene = (this.scene = new THREE.Scene())
    scene.background = new THREE.Color(COLORS.room)
    // The floor fades into the walls' colour: a room without corners.
    scene.fog = new THREE.Fog(COLORS.room, 5 * this.scale, 16 * this.scale)
    const pmrem = new THREE.PMREMGenerator(renderer)
    const room = new RoomEnvironment()
    scene.environment = pmrem.fromScene(room, 0.04).texture
    scene.environmentIntensity = this.view.environment
    room.dispose()
    pmrem.dispose()

    const scale = this.scale
    const light = (this.light = new THREE.DirectionalLight(COLORS.light, this.view.light))
    light.target.position.set(0, FLOOR, 0).multiplyScalar(scale)
    light.position.set(...LIGHT_DIRECTION).multiplyScalar(scale).add(light.target.position)
    light.castShadow = this.view.shadows
    light.shadow.mapSize.setScalar(2048)
    const rim = (this.rim = new THREE.DirectionalLight(COLORS.rim))
    rim.target = light.target
    rim.position.set(...RIM_DIRECTION).multiplyScalar(scale).add(light.target.position)
    rim.castShadow = this.view.rimShadows
    // its shadows only hold back the rim's light: a coarser map does
    rim.shadow.mapSize.setScalar(1024)
    for (const { shadow } of [light, rim]) {
      shadow.radius = 3
      shadow.bias = -0.0005
      shadow.normalBias = 0.002 * scale
    }
    scene.add(light, rim, light.target)
    this.#setRim(this.view.rim)

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(40 * scale, 40 * scale).rotateX(-Math.PI / 2),
      new THREE.MeshStandardNodeMaterial({ name: 'floor', color: COLORS.floor, roughness: 0.8 }),
    )
    floor.name = 'floor'
    floor.position.y = FLOOR * scale
    floor.receiveShadow = true
    scene.add(floor)
    this.add(this.#buildBench())

    const camera = (this.camera = new THREE.PerspectiveCamera(35, 1, 0.02 * scale, 60 * scale))
    const controls = (this.controls = new OrbitControls(camera, renderer.domElement))
    controls.target.set(0, 0.02 * scale, 0)
    controls.enableDamping = true
    controls.minDistance = 0.25 * scale
    controls.maxDistance = 6 * scale
    controls.maxPolarAngle = THREE.MathUtils.degToRad(86)
    this.#resize()
    this.#frameBench()
    this.#createPipeline()

    this.gui = new GUI({ title })
    if (window.innerWidth < 600) this.gui.close()
    this.gui.add(this, 'reset').name('Drop again (R)')

    if (hint) {
      const line = document.createElement('p')
      line.className = 'lab-hint'
      line.textContent = hint
      document.body.appendChild(line)
    }

    this.#listen()
    this.timer.connect(document)
    renderer.setAnimationLoop((time) => this.#tick(time))
  }

  #buildBench() {
    const { width, depth, height, thickness } = TABLE
    const bench = new THREE.Group()
    bench.name = 'bench'

    const top = new THREE.Mesh(
      new RoundedBoxGeometry(width, thickness, depth, 2, 0.006),
      new THREE.MeshStandardNodeMaterial({ name: 'bench top', color: COLORS.top, roughness: 0.42 }),
    )
    top.name = 'bench top'
    top.position.y = height - thickness / 2
    bench.add(top)
    this.colliders.push(box([0, height - thickness / 2, 0], [width, thickness, depth]))

    // [size, centre, collides]: under the top, the apron never meets a falling strand.
    const x = width / 2 - INSET
    const z = depth / 2 - INSET
    const legHeight = height - thickness - FOOT
    const apronY = height - thickness - 0.035
    const parts = []
    for (const sx of [-x, x]) for (const sz of [-z, z]) parts.push([[LEG, legHeight, LEG], [sx, FOOT + legHeight / 2, sz], true])
    for (const sz of [-z, z]) parts.push([[2 * x, 0.06, 0.02], [0, apronY, sz], false])
    for (const sx of [-x, x]) parts.push([[0.02, 0.06, 2 * z], [sx, apronY, 0], false])
    for (const sx of [-x, x]) parts.push([[0.03, 0.03, 2 * z], [sx, RAIL_HEIGHT, 0], true])
    parts.push([[2 * x, 0.03, 0.03], [0, RAIL_HEIGHT, -z], true])

    const pieces = parts.map(([size, center, collides]) => {
      if (collides) this.colliders.push(box(center, size))
      return new RoundedBoxGeometry(...size, 2, Math.min(...size) * 0.2).translate(...center)
    })
    const frame = new THREE.Mesh(
      mergeGeometries(pieces),
      new THREE.MeshStandardNodeMaterial({ name: 'steel', color: COLORS.steel, metalness: 1, roughness: 0.3 }),
    )
    frame.name = 'bench frame'
    bench.add(frame)

    const feet = []
    for (const sx of [-x, x]) {
      for (const sz of [-z, z]) feet.push(new THREE.CylinderGeometry(0.02, 0.024, FOOT, 16).translate(sx, FOOT / 2, sz))
    }
    const glides = new THREE.Mesh(
      mergeGeometries(feet),
      new THREE.MeshStandardNodeMaterial({ name: 'rubber', color: COLORS.rubber, roughness: 0.7 }),
    )
    glides.name = 'bench feet'
    bench.add(glides)

    for (const geometry of [...pieces, ...feet]) geometry.dispose()
    // Built up from the floor at a scale of 1, then scaled and lowered so its top sits at y = 0.
    bench.scale.setScalar(this.scale)
    bench.position.y = FLOOR * this.scale
    for (const collider of this.colliders) {
      collider.translate(new THREE.Vector3(0, FLOOR, 0))
      collider.min.multiplyScalar(this.scale)
      collider.max.multiplyScalar(this.scale)
    }
    // The shadow map holds the nearest surface, back faces included.
    bench.traverse((child) => {
      if (child.isMesh) child.material.shadowSide = THREE.DoubleSide
    })
    return bench
  }

  // TAAU over the scene pass, whose environment light XeGTAO occludes from an opaque prepass's depth and geometric
  // normal.
  #createPipeline() {
    const prePass = (this.#prePass = pass(this.scene, this.camera, { samples: 0 }))
    prePass.name = 'lab prepass'
    prePass.transparent = false
    prePass.contextNode = context({ getAO: null })
    prePass.setMRT(mrt({ output: packNormalToRGB(normalViewGeometry) }))
    prePass.getTexture('output').type = THREE.UnsignedByteType
    const normal = sample((uv) => unpackRGBToNormal(prePass.getTextureNode().sample(uv)))
    const occlusion = (this.occlusion = xeGTAO(prePass.getTextureNode('depth'), this.camera, {
      normalNode: normal,
      sliceCount: 1,
      stepsPerSlice: 3,
      radius: this.view.aoRadius,
      intensity: this.view.aoIntensity,
      power: 2,
      thinOccluder: 0.25, // thin strands don't darken what lies behind them
    }))
    const scenePass = (this.#scenePass = pass(this.scene, this.camera, { samples: 0 }))
    scenePass.name = 'lab scene'
    scenePass.setMRT(mrt({ output, velocity }))
    const motion = scenePass.getTexture('velocity')
    motion.type = THREE.HalfFloatType
    motion.format = THREE.RGFormat
    const depth = scenePass.getTextureNode('depth')
    const resolved = taau(scenePass.getTextureNode('output'), depth, scenePass.getTextureNode('velocity'), this.camera, {
      currentFrameWeight: 0.025,
      maxVelocityLength: 32, // output px a frame: faster pixels take the current frame
    })
    this.#aoContext = builtinAOContext(occlusion.getMaterialAONode())
    this.pipeline = new THREE.RenderPipeline(this.renderer)
    this.pipeline.outputColorTransform = false
    this.pipeline.outputNode = renderOutput(resolved.getTextureNode())
    this.#setAO(this.view.ao)
    this.#setSampling()
  }

  #setAO(on) {
    this.#scenePass.contextNode = on ? this.#aoContext : null
    this.#scenePass.needsUpdate = true
  }

  // An unlit rim costs nothing: it leaves the scene's lights, its shadow map with it.
  #setRim(intensity) {
    this.rim.intensity = intensity
    this.rim.visible = intensity > 0
  }

  #addViewFolder() {
    if (this.gui.folders.some((folder) => folder._title === 'View')) return
    const folder = this.gui.addFolder('View').close()
    folder.add(this.view, 'shadows').onChange((value) => (this.light.castShadow = value))
    folder.add(this.view, 'light', 0, 6, 0.1).onChange((value) => (this.light.intensity = value))
    folder.add(this.view, 'rim', 0, 8, 0.1).onChange((value) => this.#setRim(value))
    folder
      .add(this.view, 'rimShadows')
      .name('rim shadows')
      .onChange((value) => (this.rim.castShadow = value))
    folder
      .add(this.view, 'environment', 0, 2, 0.05)
      .name('ambient')
      .onChange((value) => (this.scene.environmentIntensity = value))
    folder.add(this.view, 'ao').name('ambient occlusion').onChange((value) => this.#setAO(value))
    folder
      .add(this.view, 'aoIntensity', 0, 1, 0.05)
      .name('occlusion')
      .onChange((value) => (this.occlusion.intensity = value))
    const scale = this.scale
    folder
      .add(this.view, 'aoRadius', 0.01 * scale, 0.3 * scale, 0.005 * scale)
      .name('occlusion radius (m)')
      .onChange((value) => (this.occlusion.radius = value))
  }

  // Back far enough to see the bench's width, at most 3.6 m × scale (a portrait phone sees the middle).
  #frameBench() {
    const scale = this.scale
    const half = Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * this.camera.aspect)
    const fit = (this.table.width / 2 + 0.15 * scale) / Math.tan(half)
    const distance = THREE.MathUtils.clamp(fit, 1.7 * scale, 3.6 * scale)
    const elevation = THREE.MathUtils.degToRad(34)
    this.camera.position
      .set(0, Math.sin(elevation), Math.cos(elevation))
      .multiplyScalar(distance)
      .add(this.controls.target)
    this.controls.update()
  }

  #resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    // a move to another display changes the device's pixel ratio
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, OUTPUT_PIXEL_RATIO))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    if (this.pipeline) this.#setSampling()
  }

  // The scene and its prepass at SCENE_PIXEL_RATIO, the occlusion at AO_PIXEL_RATIO: shares of the output's.
  #setSampling() {
    const ratio = this.renderer.getPixelRatio()
    const scale = Math.min(1, SCENE_PIXEL_RATIO / ratio)
    this.#scenePass.setResolutionScale(scale)
    this.#prePass.setResolutionScale(scale)
    this.occlusion.resolutionScale = Math.min(1, AO_PIXEL_RATIO / ratio)
  }

  // ---- Input ----

  #listen() {
    const canvas = this.renderer.domElement
    // A second finger zooms and pans: the first lets go before OrbitControls sees it, so it starts both.
    window.addEventListener(
      'pointerdown',
      (event) => {
        if (event.target !== canvas || event.pointerType !== 'touch') return
        this.#touches.add(event.pointerId)
        if (this.#touches.size > 1) this.#endGrab()
      },
      { capture: true },
    )
    canvas.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'touch' && this.#touches.size > 1) return
      if (event.button !== 0 || !this.#grab || this.#gesture) return
      this.#press(event)
    })
    canvas.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch' || this.#gesture) return
      this.#hover.event = event
      this.#testHover()
    })
    canvas.addEventListener('pointerleave', () => {
      this.#hover.event = null
      this.#hover.hit = false
      this.#showCursor()
    })
    window.addEventListener('pointermove', (event) => {
      const gesture = this.#gesture
      if (event.pointerId !== gesture?.pointer) return
      if (gesture.grabbing) this.#grab.move?.(this.#aim(event))
      else if (gesture.testing) gesture.last = event
    })
    const release = (event) => {
      this.#touches.delete(event.pointerId)
      const gesture = this.#gesture
      if (event.pointerId !== gesture?.pointer) return
      // a press still being tested ends once it is answered
      if (gesture.testing) gesture.released = true
      else this.#endGrab()
    }
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    window.addEventListener('keydown', (event) => {
      if (event.key.toLowerCase() !== 'r' || event.repeat || event.metaKey || event.ctrlKey) return
      if (event.target.closest?.('input, textarea, select')) return
      this.reset()
    })
    window.addEventListener('resize', () => this.#resize())
  }

  #aim(event) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.#pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.#raycaster.setFromCamera(this.#pointer, this.camera)
    return this.#raycaster
  }

  // OrbitControls has begun its orbit already: held until the hit test answers, and through the drag on a hit.
  async #press(event) {
    const grab = this.#grab
    const down = this.#copy(this.#aim(event))
    const gesture = { pointer: event.pointerId, testing: true, released: false, grabbing: false, last: null }
    this.#gesture = gesture
    this.#hold(true)
    this.#showCursor()
    let hit = true
    try {
      if (grab.hit) hit = await grab.hit(down)
    } catch (error) {
      console.error(error)
      hit = false
    }
    gesture.testing = false
    if (this.#gesture !== gesture || this.#grab !== grab) return
    if (!hit) {
      // an orbit, to its release
      this.#hold(false)
      if (gesture.released) this.#endGrab()
      return
    }
    gesture.grabbing = true
    this.#showCursor()
    grab.start(down)
    if (gesture.last) grab.move?.(this.#aim(gesture.last))
    if (gesture.released) this.#endGrab()
  }

  #hold(on) {
    this.controls.enableRotate = this.controls.enablePan = !on
  }

  #endGrab() {
    const gesture = this.#gesture
    if (!gesture) return
    this.#gesture = null
    this.#hold(false)
    if (gesture.grabbing) this.#grab?.end?.()
    this.#showCursor()
  }

  // Whether a drag would start on the simulation where the mouse is: one test at a time, on its latest position.
  async #testHover() {
    const hover = this.#hover
    if (hover.testing) return
    hover.testing = true
    while (hover.event) {
      const event = hover.event
      hover.event = null
      const grab = this.#grab
      let hit = false
      try {
        if (grab?.hit && grab.cursors()) hit = await grab.hit(this.#copy(this.#aim(event)))
      } catch {
        hit = false
      }
      hover.hit = hit
      this.#showCursor()
    }
    hover.testing = false
  }

  #showCursor() {
    const gesture = this.#gesture
    const cursors = this.#grab?.cursors() ?? null
    const cursor = gesture ? (gesture.grabbing ? cursors?.drag : null) : this.#hover.hit ? cursors?.hover : null
    this.renderer.domElement.style.cursor = cursor ?? ''
  }

  #copy(raycaster) {
    const copy = new THREE.Raycaster(raycaster.ray.origin.clone(), raycaster.ray.direction.clone())
    copy.near = raycaster.near
    copy.far = raycaster.far
    copy.camera = this.camera
    return copy
  }

  // A light's shadow camera, from the light toward its target, just round shadowBounds and deep enough to reach the
  // floor past them, where a low light throws their shadows.
  #fitShadow(light) {
    const camera = light.shadow.camera
    light.updateWorldMatrix(true, false)
    light.target.updateWorldMatrix(true, false)
    _eye.setFromMatrixPosition(light.matrixWorld)
    _target.setFromMatrixPosition(light.target.matrixWorld)
    _view.lookAt(_eye, _target, camera.up).setPosition(_eye).invert()
    const descent = Math.max(_eye.y - _target.y, 0) / _eye.distanceTo(_target)
    const toFloor = Math.max(this.shadowBounds.max.y + this.ground.constant, 0) / Math.max(descent, 0.05)
    const { min, max } = _box.copy(this.shadowBounds).applyMatrix4(_view)
    camera.left = min.x
    camera.right = max.x
    camera.bottom = min.y
    camera.top = max.y
    camera.near = -max.z
    camera.far = -min.z + toFloor
    camera.updateProjectionMatrix()
  }

  #tick(time) {
    this.timer.update(time)
    const delta = this.timer.getDelta()
    this.controls.update(delta)
    for (const handler of this.#frame) handler(delta)
    this.#fitShadow(this.light)
    this.#fitShadow(this.rim)
    this.pipeline.render()
    this.stats.update()
    this.renderer.resolveTimestampsAsync('render')
    this.renderer.resolveTimestampsAsync('compute')
  }
}

/**
 * Wavy strands at rest above the bench, apart by `gap` × radius, for a strand simulation to drop: each a centripetal
 * Catmull-Rom curve through `points` points along a random direction, tilted at most `tilt` from level, its points
 * pushed sideways by up to `waviness`. Fewer come back when they don't fit.
 *
 * @param {object} options
 * @param {number} options.count
 * @param {number|number[]} options.length - m, or [min, max].
 * @param {number} options.radius - m.
 * @param {THREE.Vector3} options.center - Under the strands' midpoints, on the surface they fall to.
 * @param {number} [options.spread=0.2] - m: the midpoints' horizontal distance from `center`, at most.
 * @param {number[]} [options.height=[0.1, 0.6]] - m above `center`.
 * @param {number} [options.waviness=0.03] - m.
 * @param {number} [options.tilt=0.5] - rad.
 * @param {number} [options.points=6]
 * @param {number} [options.gap=2.6] - × radius, between the strands' axes.
 * @param {number} [options.seed=1]
 * @returns {THREE.CatmullRomCurve3[]}
 */
export function dropStrands(options) {
  const { count, radius, center, spread = 0.2, height = [0.1, 0.6], waviness = 0.03, tilt = 0.5 } = options
  const { points = 6, gap = 2.6, seed = 1 } = options
  const [minLength, maxLength] = Array.isArray(options.length) ? options.length : [options.length, options.length]
  const random = seededRandom(seed)
  // Samples a radius apart: two strands whose samples keep `reach` apart keep `gap` · radius between their axes.
  const reach = gap * radius + radius / 2
  const grid = new PointGrid(reach)
  const curves = []
  const axis = new THREE.Vector3()
  const side = new THREE.Vector3()
  const up = new THREE.Vector3()
  for (let tries = 0; curves.length < count && tries < count * 100; tries++) {
    const length = minLength + (maxLength - minLength) * random()
    const angle = random() * Math.PI * 2
    const distance = spread * Math.sqrt(random())
    const middle = new THREE.Vector3(
      center.x + distance * Math.cos(angle),
      center.y + height[0] + (height[1] - height[0]) * random(),
      center.z + distance * Math.sin(angle),
    )
    const heading = random() * Math.PI * 2
    const pitch = (random() * 2 - 1) * tilt
    axis.set(Math.cos(heading) * Math.cos(pitch), Math.sin(pitch), Math.sin(heading) * Math.cos(pitch))
    side.set(-Math.sin(heading), 0, Math.cos(heading))
    up.crossVectors(side, axis)
    const knots = Array.from({ length: points }, (_, i) => {
      const t = i / (points - 1) - 0.5
      return middle
        .clone()
        .addScaledVector(axis, t * length)
        .addScaledVector(side, (random() * 2 - 1) * waviness)
        .addScaledVector(up, (random() * 2 - 1) * waviness * 0.5)
    })
    const curve = new THREE.CatmullRomCurve3(knots, false, 'centripetal')
    const samples = curve.getSpacedPoints(Math.max(2, Math.ceil(curve.getLength() / radius)))
    if (samples.some((point) => grid.near(point))) continue
    for (const point of samples) grid.add(point)
    curves.push(curve)
  }
  if (curves.length < count) console.warn(`[lab] dropStrands(): ${curves.length} of ${count} strands fit.`)
  return curves
}

/** A seeded random number generator in [0, 1) (mulberry32). */
export function seededRandom(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function box(center, size) {
  return new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(...center), new THREE.Vector3(...size))
}

// Points in cells of `reach`: near() finds any within reach of a point.
class PointGrid {
  #cells = new Map()

  constructor(reach) {
    this.reach = reach
  }

  add(point) {
    const key = this.#key(...this.#cell(point))
    const cell = this.#cells.get(key)
    if (cell) cell.push(point)
    else this.#cells.set(key, [point])
  }

  near(point) {
    const [x, y, z] = this.#cell(point)
    const reachSq = this.reach * this.reach
    for (let i = x - 1; i <= x + 1; i++) {
      for (let j = y - 1; j <= y + 1; j++) {
        for (let k = z - 1; k <= z + 1; k++) {
          const cell = this.#cells.get(this.#key(i, j, k))
          if (cell?.some((other) => other.distanceToSquared(point) < reachSq)) return true
        }
      }
    }
    return false
  }

  #cell(point) {
    return [Math.floor(point.x / this.reach), Math.floor(point.y / this.reach), Math.floor(point.z / this.reach)]
  }

  #key(x, y, z) {
    return `${x},${y},${z}`
  }
}
