/**
 * GPUTierDetector - picks a quality tier for the device at load: a classification from the adapter's static signals
 * (vendor, architecture, limits, navigator.userAgentData), then optionally a short GPU benchmark. Plain WebGPU, no
 * three.js needed: it runs before any renderer exists, or reads one's.
 *
 *   import { GPUTierDetector } from 'three-advanced-techniques/utils/GPUTierDetector.js'
 *
 *   const detector = new GPUTierDetector(['Low', 'Medium', 'High'], { caps: { mobile: 'Low', desktop: 'Medium' } })
 *   const found = await detector.detect() // an adapter of its own, a few ms
 *   // { tier: 'Low', level: 0, deviceClass: 'mobile', mobile: true, reasons: ['apple GPU on a mobile device'], … }
 *   // or detect(renderer) after `await renderer.init()`, detect(device) or detect(adapter)
 *
 *   // optionally, time one unit of the app's GPU work (or omit it for a built-in reference set)
 *   const timed = await detector.benchmark(renderer, () => app.simulate(renderer, 1 / 60))
 *   // { tier: 'Medium', level: 1, ms: 11.4, samples: [11.2, 11.4, 11.9], roundTrip: 0.04, warmups: 3, … }
 *   const capped = detector.tiers[Math.min(found.level, timed.level)]
 *
 * detect() sorts the device into a class, `fallback`, `weak`, `mobile` or `desktop`, and caps the tier at the
 * class's highest (`caps`); its `mobile` is true for a phone or a tablet by `navigator.userAgentData` (`mobile`, or a
 * `formFactors` hint of Mobile, Tablet, XR or Watch), else by the user-agent string and touch points (Safari,
 * Firefox), or for a mobile vendor's GPU outside Windows (an Android tablet asking for desktop sites, a Chromebook),
 * whatever the class.
 *
 * benchmark() times `workload` as wall time from the call to `device.queue.onSubmittedWorkDone()`, minus an empty
 * submit's round trip, and picks the highest tier whose threshold the median meets. Pass-timestamp sums are never
 * used: on Vulkan a pass's begin stamp can absorb the wait for earlier work. Compile the workload's pipelines before
 * benchmark(), or the warm-up run carries the compile. It times the whole device queue: stop anything else that
 * submits while it runs (renderer.setAnimationLoop(null), or skip the loop's render), or its frames land in the
 * samples. Without `workload` it times a built-in reference set of compute dispatches, on the given device or, with
 * none, on a device of its own.
 *
 * Options and properties:
 *   tiers - the tier names, lowest first (positional).
 *   thresholds - ms of one workload unit at most for each tier above the lowest, in tier order (tiers.length − 1
 *     values). Default: provisional values for the built-in workload.
 *   caps - { fallback, weak, mobile, desktop }: the highest tier of each device class, as names or levels. Default
 *     { fallback: lowest, weak: lowest, mobile: tiers.length − 2, desktop: highest }.
 *   warmups - untimed runs before the samples, at least.
 *   warmupTime - ms: the warm-up runs on until this much has passed (GPU clocks ramp up under load), within half
 *     the budget.
 *   samples - timed runs; the result is their median.
 *   abortTime - ms: a sample over it ends the benchmark at the lowest tier.
 *   budget - ms for the whole benchmark; once spent, it stops after the current sample (one sample at least).
 *   penalties - deviceMemory ≤ 4 GB and hardwareConcurrency ≤ 4 (not on WebKit) each move the class one down.
 */

const DETECTOR_OPTIONS = ['thresholds', 'caps', 'warmups', 'warmupTime', 'samples', 'abortTime', 'budget', 'penalties']
const DEVICE_CLASSES = ['fallback', 'weak', 'mobile', 'desktop']
// penalties step down this ladder, never below its first rung
const PENALTY_LADDER = ['weak', 'mobile', 'desktop']

// Dawn's architecture names (src/dawn/gpu_info.json), lowercased and hyphenated as GPUAdapterInfo reports them.
const MOBILE_VENDORS = ['arm', 'img-tec', 'qualcomm', 'samsung', 'huawei', 'broadcom']
// navigator.userAgentData's formFactors that run on a mobile GPU
const MOBILE_FORM_FACTORS = ['Mobile', 'Tablet', 'XR', 'Watch']
const WEAK_ARM = ['midgard', 'bifrost']
const WEAK_QUALCOMM = ['adreno-4xx', 'adreno-5xx', 'adreno-6xx']
const SOFTWARE_ARCHITECTURES = ['swiftshader', 'software']
// Integrated Intel before Lunar Lake's Xe2 (gen-12-hp is the discrete Arc A-series)
const OLD_INTEL = ['gen-7', 'gen-8', 'gen-9', 'gen-11', 'gen-12-lp', 'xe-lpg']
const WEAK_INVOCATIONS = 1024
const PENALTY_MEMORY = 4 // GB
const PENALTY_CORES = 4

// Built-in workload thresholds, ms: the top tier at most TOP, the tier above the lowest at most NEXT.
const BUILT_IN_TOP = 6
const BUILT_IN_NEXT = 15

const ROUND_TRIPS = 3

const hundredths = (value) => Math.round(value * 100) / 100
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
const formatMs = (value) => `${value.toFixed(value < 10 ? 2 : 1)} ms`

class GPUTierDetector {
  isGPUTierDetector = true
  type = 'GPUTierDetector'

  tiers
  thresholds
  caps
  warmups = 1
  warmupTime = 60
  samples = 3
  abortTime = 60
  budget = 500
  penalties = true

  /**
   * @param {string[]} tiers - tier names, lowest first
   * @param {object} [options]
   * @param {number[]} [options.thresholds]
   * @param {object} [options.caps]
   * @param {number} [options.warmups=1]
   * @param {number} [options.warmupTime=60]
   * @param {number} [options.samples=3]
   * @param {number} [options.abortTime=60]
   * @param {number} [options.budget=500]
   * @param {boolean} [options.penalties=true]
   */
  constructor(tiers, options = {}) {
    if (!Array.isArray(tiers) || tiers.length === 0) throw new Error('GPUTierDetector: tiers needs at least one name.')
    this.tiers = [...tiers]
    for (const key of Object.keys(options)) {
      if (!DETECTOR_OPTIONS.includes(key)) console.warn(`GPUTierDetector: unknown option "${key}".`)
      else if (options[key] !== undefined) this[key] = options[key]
    }
    const n = this.tiers.length
    this.thresholds ??= GPUTierDetector.builtInThresholds(n)
    if (this.thresholds.length !== n - 1) {
      throw new Error(`GPUTierDetector: thresholds needs ${n - 1} values (one per tier above the lowest).`)
    }
    if (this.thresholds.some((value, i) => i > 0 && value > this.thresholds[i - 1])) {
      console.warn('GPUTierDetector: thresholds should not grow with the tier (a higher tier allows fewer ms).')
    }
    for (const key of Object.keys(this.caps ?? {})) {
      if (!DEVICE_CLASSES.includes(key)) console.warn(`GPUTierDetector: unknown device class "${key}" in caps.`)
    }
    this.caps = {
      fallback: 0,
      weak: 0,
      mobile: Math.max(0, n - 2),
      desktop: n - 1,
      ...this.caps,
    }
  }

  /**
   * The built-in workload's thresholds for `count` tiers: geometric from BUILT_IN_NEXT ms (the tier above the
   * lowest) to BUILT_IN_TOP ms (the highest).
   */
  static builtInThresholds(count) {
    if (count < 2) return []
    if (count === 2) return [Math.sqrt(BUILT_IN_TOP * BUILT_IN_NEXT)]
    const ratio = BUILT_IN_TOP / BUILT_IN_NEXT
    return Array.from({ length: count - 1 }, (_, i) => BUILT_IN_NEXT * ratio ** (i / (count - 2)))
  }

  /**
   * Classifies the device from its static signals.
   * @param {object} [source] - a three.js renderer (after `await renderer.init()`), a GPUDevice, a GPUAdapter, or
   *   nothing for an adapter of its own
   * @returns {Promise<{ tier: string, level: number, deviceClass: string, mobile: boolean, reasons: string[],
   *   signals: object }>}
   */
  async detect(source = null) {
    return this.classify(await GPUTierDetector.readSignals(source))
  }

  /**
   * The device class and capped tier for a set of signals (readSignals()'s shape; missing fields count as unknown).
   * @returns {{ tier: string, level: number, deviceClass: string, mobile: boolean, reasons: string[],
   *   signals: object }}
   */
  classify(signals = {}) {
    const reasons = []
    let deviceClass = baseClass(signals, reasons)
    if (deviceClass !== 'fallback' && this.penalties) {
      const { deviceMemory, hardwareConcurrency, webkit } = signals
      const down = (reason) => {
        const rung = PENALTY_LADDER.indexOf(deviceClass)
        if (rung > 0) {
          deviceClass = PENALTY_LADDER[rung - 1]
          reasons.push(`${reason} (one class down)`)
        }
      }
      if (typeof deviceMemory === 'number' && deviceMemory <= PENALTY_MEMORY) {
        down(`deviceMemory ${deviceMemory} GB ≤ ${PENALTY_MEMORY}`)
      }
      if (typeof hardwareConcurrency === 'number' && hardwareConcurrency <= PENALTY_CORES && webkit !== true) {
        down(`hardwareConcurrency ${hardwareConcurrency} ≤ ${PENALTY_CORES}`)
      }
    }
    const level = this.#levelOf(this.caps[deviceClass])
    const mobile = signals.mobile === true || mobileGPU(signals)
    return { tier: this.tiers[level], level, deviceClass, mobile, reasons, signals }
  }

  /**
   * Times one unit of GPU work: untimed warm-up runs (`warmups`, and on for `warmupTime`), then `samples` timed
   * ones, each the wall ms from the workload call to `onSubmittedWorkDone()` minus an empty submit's round trip.
   * Omit `workload` for the built-in reference set (its pipelines and buffers, and a device when `source` has none,
   * are created here and destroyed before it returns).
   * @param {object} [source] - the device `workload` submits to: a three.js renderer (after `await renderer.init()`)
   *   or a GPUDevice; nothing, or a GPUAdapter, for the built-in set only
   * @param {Function} [workload] - submits one unit of GPU work; may return a promise
   * @returns {Promise<{ tier: string, level: number, ms: number|null, samples: number[], roundTrip: number|null,
   *   warmups: number, aborted: boolean, reasons: string[], time: number }>}
   */
  async benchmark(source = null, workload = null) {
    const start = performance.now()
    const samples = []
    const reasons = []
    let roundTrip = null
    let aborted = false
    let warmups = 0
    let device = sourceOf(source).device
    let own = null
    if (device === null && !workload) {
      // a fresh adapter: a device made from the caller's would expire it
      try {
        own = (await (await globalThis.navigator?.gpu?.requestAdapter())?.requestDevice()) ?? null
      } catch {
        own = null
      }
      device = own
    }
    if (device === null) {
      reasons.push('no WebGPU device to time')
      aborted = true
    } else {
      let reference = null
      try {
        if (!workload) {
          reference = await ReferenceWorkload.create(device)
          workload = () => reference.submit()
        }
        const queue = device.queue
        await queue.onSubmittedWorkDone() // earlier work, out of the first sample
        const trips = []
        for (let i = 0; i < ROUND_TRIPS; i++) {
          const t = performance.now()
          queue.submit([])
          await queue.onSubmittedWorkDone()
          trips.push(performance.now() - t)
        }
        roundTrip = median(trips)
        const run = async () => {
          const t = performance.now()
          await workload()
          await queue.onSubmittedWorkDone()
          return Math.max(0, performance.now() - t - roundTrip)
        }
        // GPU clocks ramp up under load and drop within ms of idling: warm up for time, not only runs
        const warmStart = performance.now()
        while (warmups < this.warmups || performance.now() - warmStart < this.warmupTime) {
          if (warmups >= this.warmups && performance.now() - start >= this.budget / 2) break
          await run()
          warmups++
        }
        while (samples.length < this.samples) {
          if (samples.length > 0 && performance.now() - start >= this.budget) {
            reasons.push(`budget ${this.budget} ms spent after ${samples.length} of ${this.samples} samples`)
            break
          }
          const sample = await run()
          samples.push(sample)
          if (sample > this.abortTime) {
            reasons.push(`a sample took ${formatMs(sample)} > abortTime ${this.abortTime} ms`)
            aborted = true
            break
          }
        }
      } catch (error) {
        console.warn('GPUTierDetector: the benchmark workload failed.', error)
        reasons.push(`workload failed: ${error?.message ?? error}`)
        aborted = true
      } finally {
        reference?.destroy()
        own?.destroy()
      }
    }
    const unit = samples.length > 0 ? median(samples) : null
    const top = this.tiers.length - 1
    let level = 0
    if (!aborted && unit !== null && top > 0) {
      level = this.#levelForTime(unit)
      reasons.unshift(
        level === top
          ? `${formatMs(unit)} ≤ ${hundredths(this.thresholds[top - 1])} ms (${this.tiers[top]})`
          : `${formatMs(unit)} > ${hundredths(this.thresholds[level])} ms (${this.tiers[level + 1]})`,
      )
    }
    return {
      tier: this.tiers[level],
      level,
      ms: unit,
      samples,
      roundTrip,
      warmups,
      aborted,
      reasons,
      time: performance.now() - start,
    }
  }

  /**
   * The signals detect() classifies by, from `source` (detect()'s). A device's limits are the ones it was created
   * with, not the GPU's, so unless `source` is an adapter they come from an adapter request (Chrome: a few ms).
   */
  static async readSignals(source = null) {
    const start = performance.now()
    const { webgpu, device, compatibilityMode, powerPreference } = sourceOf(source)
    const nav = globalThis.navigator ?? {}
    let adapter = isAdapter(source) ? source : null
    if (adapter === null && webgpu !== false && nav.gpu) {
      try {
        adapter = await nav.gpu.requestAdapter({ featureLevel: 'compatibility', powerPreference })
      } catch {
        adapter = null
      }
    }
    // User-Agent Client Hints (Chromium): `mobile` is false on a tablet, its `formFactors` hint names it
    const uaData = nav.userAgentData ?? null
    let formFactors = []
    try {
      const values = await uaData?.getHighEntropyValues?.(['formFactors'])
      if (Array.isArray(values?.formFactors)) formFactors = values.formFactors
    } catch {
      formFactors = []
    }
    const info = device?.adapterInfo ?? adapter?.info ?? {}
    const limits = adapter?.limits ?? {}
    const userAgent = nav.userAgent ?? ''
    const touch = nav.maxTouchPoints > 1
    const appleTouch = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touch)
    const dpr = globalThis.devicePixelRatio ?? 1
    const handheld = /Android|iPhone|iPad|iPod/.test(userAgent) || appleTouch
    return {
      webgpu: webgpu ?? (device !== null || adapter !== null),
      compatibilityMode,
      vendor: info.vendor ?? '',
      architecture: info.architecture ?? '',
      device: info.device ?? '',
      description: info.description ?? '',
      subgroupMinSize: info.subgroupMinSize,
      subgroupMaxSize: info.subgroupMaxSize,
      isFallbackAdapter: info.isFallbackAdapter ?? adapter?.isFallbackAdapter ?? false,
      maxComputeInvocationsPerWorkgroup: limits.maxComputeInvocationsPerWorkgroup,
      maxComputeWorkgroupStorageSize: limits.maxComputeWorkgroupStorageSize,
      maxStorageBuffersPerShaderStage: limits.maxStorageBuffersPerShaderStage,
      features: [...(adapter?.features ?? device?.features ?? [])].sort(),
      mobile: uaData?.mobile === true || mobileFormFactor(formFactors) || handheld,
      formFactors,
      platform: platformOf(nav, userAgent, appleTouch),
      webkit: appleTouch || (/AppleWebKit/.test(userAgent) && !/Chrome\/|Chromium\/|Edg\//.test(userAgent)),
      deviceMemory: nav.deviceMemory,
      hardwareConcurrency: nav.hardwareConcurrency,
      userAgent,
      screenPixels: Math.round((globalThis.innerWidth ?? 0) * dpr) * Math.round((globalThis.innerHeight ?? 0) * dpr),
      time: performance.now() - start,
    }
  }

  #levelOf(cap) {
    const n = this.tiers.length
    if (typeof cap === 'string') {
      const index = this.tiers.indexOf(cap)
      if (index >= 0) return index
      console.warn(`GPUTierDetector: unknown tier "${cap}" in caps; using the lowest.`)
      return 0
    }
    return Math.min(n - 1, Math.max(0, Math.round(cap ?? 0)))
  }

  #levelForTime(value) {
    for (let level = this.tiers.length - 1; level > 0; level--) {
      if (value <= this.thresholds[level - 1]) return level
    }
    return 0
  }
}

function baseClass(signals, reasons) {
  const vendor = (signals.vendor ?? '').toLowerCase()
  const architecture = (signals.architecture ?? '').toLowerCase()
  const gpu = `${vendor || 'unknown'}${architecture ? ` ${architecture}` : ''} GPU`

  if (signals.webgpu === false) return fallback(reasons, 'no WebGPU backend')
  if (signals.isFallbackAdapter === true) return fallback(reasons, 'a fallback adapter')
  if (SOFTWARE_ARCHITECTURES.includes(architecture)) return fallback(reasons, `${gpu} (software rendering)`)
  if (vendor === 'microsoft') return fallback(reasons, `${gpu} (WARP, software rendering)`)
  if (signals.compatibilityMode === true) return fallback(reasons, 'compatibility mode (no core features)')

  if (signals.mobile === true || mobileGPU(signals)) {
    const where =
      signals.mobile === true ? 'on a mobile device' : `(a mobile GPU) on ${signals.platform || 'a desktop UA'}`
    const invocations = signals.maxComputeInvocationsPerWorkgroup
    if (
      vendor === 'img-tec' ||
      vendor === 'broadcom' ||
      (vendor === 'arm' && WEAK_ARM.includes(architecture)) ||
      (vendor === 'qualcomm' && WEAK_QUALCOMM.includes(architecture))
    ) {
      reasons.push(`${gpu} ${where}`)
      return 'weak'
    }
    if (typeof invocations === 'number' && invocations < WEAK_INVOCATIONS) {
      reasons.push(`${gpu} ${where}, maxComputeInvocationsPerWorkgroup ${invocations} < ${WEAK_INVOCATIONS}`)
      return 'weak'
    }
    reasons.push(`${gpu} ${where}`)
    return 'mobile'
  }
  if (vendor === 'intel' && OLD_INTEL.includes(architecture)) {
    reasons.push(`${gpu} (integrated, before Xe2)`)
    return 'mobile'
  }
  reasons.push(`${gpu} on a desktop`)
  return 'desktop'
}

// A mobile vendor's GPU outside Windows, where Snapdragon laptops run desktop drivers.
function mobileGPU(signals) {
  return MOBILE_VENDORS.includes((signals.vendor ?? '').toLowerCase()) && signals.platform !== 'windows'
}

// What `source` says of the WebGPU device: a three.js renderer's backend, a GPUDevice, or nothing known (an adapter,
// none). `webgpu` is null while unknown: the adapter request decides.
function sourceOf(source) {
  const backend = source?.backend
  if (backend) {
    if (backend.isWebGPUBackend !== true) return { webgpu: false, device: null, compatibilityMode: null }
    const device = backend.device ?? null
    return {
      webgpu: device !== null ? true : null,
      device,
      compatibilityMode: backend.compatibilityMode ?? null,
      powerPreference: backend.parameters?.powerPreference,
    }
  }
  if (isDevice(source)) return { webgpu: true, device: source, compatibilityMode: null }
  return { webgpu: null, device: null, compatibilityMode: null }
}

const isDevice = (value) => typeof value?.createCommandEncoder === 'function' && value.queue != null
const isAdapter = (value) => typeof value?.requestDevice === 'function'

// A handheld or worn form factor, unless the device also reports Desktop (a 2-in-1).
function mobileFormFactor(formFactors) {
  return formFactors.some((f) => MOBILE_FORM_FACTORS.includes(f)) && !formFactors.includes('Desktop')
}

function fallback(reasons, reason) {
  reasons.push(reason)
  return 'fallback'
}

function platformOf(nav, userAgent, appleTouch) {
  // userAgentData.platform: Android, Chrome OS, Chromium OS, iOS, Linux, macOS, Windows or Unknown
  const platform = (nav.userAgentData?.platform ?? '').toLowerCase()
  if (/^chrom(e|ium) os$/.test(platform)) return 'chromeos'
  if (platform && platform !== 'unknown') return platform
  if (/Android/.test(userAgent)) return 'android'
  if (appleTouch) return 'ios'
  if (/Windows/.test(userAgent)) return 'windows'
  if (/CrOS/.test(userAgent)) return 'chromeos'
  if (/Macintosh|Mac OS X/.test(userAgent)) return 'macos'
  if (/Linux/.test(userAgent)) return 'linux'
  return ''
}

// The device probe's quick set: 64 dependent dispatches of 2,048 threads (dispatch and barrier cost), then 8
// dependent dispatches of 262,144 threads × 256 vec4 multiply-adds (ALU throughput), in one submit.
const CHAIN_WGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> data: array<vec4f>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= arrayLength(&data)) { return; }
  data[id.x] = data[id.x] * 0.999 + vec4f(1.0);
}`

const ALU_WGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> data: array<vec4f>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= arrayLength(&data)) { return; }
  var v = data[id.x];
  for (var k = 0u; k < 256u; k++) { v = v * 0.9999 + vec4f(0.0001); }
  data[id.x] = v;
}`

const STORAGE = 0x80 // GPUBufferUsage.STORAGE
const CHAIN_THREADS = 2048
const CHAIN_DISPATCHES = 64
const ALU_THREADS = 262144
const ALU_DISPATCHES = 8

class ReferenceWorkload {
  #device
  #buffers
  #chain
  #alu

  static async create(device) {
    const pipeline = (code, label) =>
      device.createComputePipelineAsync({
        label,
        layout: 'auto',
        compute: { module: device.createShaderModule({ label, code }), entryPoint: 'main' },
      })
    const [chain, alu] = await Promise.all([
      pipeline(CHAIN_WGSL, 'GPUTierDetector.chain'),
      pipeline(ALU_WGSL, 'GPUTierDetector.alu'),
    ])
    return new ReferenceWorkload(device, chain, alu)
  }

  constructor(device, chain, alu) {
    this.#device = device
    const small = device.createBuffer({ label: 'GPUTierDetector.chain', size: CHAIN_THREADS * 16, usage: STORAGE })
    const big = device.createBuffer({ label: 'GPUTierDetector.alu', size: ALU_THREADS * 16, usage: STORAGE })
    this.#buffers = [small, big]
    const bind = (pipeline, buffer) =>
      device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer } }],
      })
    this.#chain = { pipeline: chain, bindGroup: bind(chain, small), workgroups: CHAIN_THREADS / 64 }
    this.#alu = { pipeline: alu, bindGroup: bind(alu, big), workgroups: ALU_THREADS / 64 }
  }

  submit() {
    const encoder = this.#device.createCommandEncoder({ label: 'GPUTierDetector' })
    for (const [{ pipeline, bindGroup, workgroups }, count] of [
      [this.#chain, CHAIN_DISPATCHES],
      [this.#alu, ALU_DISPATCHES],
    ]) {
      const pass = encoder.beginComputePass()
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, bindGroup)
      for (let i = 0; i < count; i++) pass.dispatchWorkgroups(workgroups)
      pass.end()
    }
    this.#device.queue.submit([encoder.finish()])
  }

  destroy() {
    for (const buffer of this.#buffers) buffer.destroy()
  }
}

export { GPUTierDetector }
