/**
 * STARFALL — fully procedural audio.
 *
 * There are no audio files anywhere in the game: every gunshot, hull impact,
 * detonation and the ambient bed is synthesised from oscillators and one shared
 * noise buffer through a small fixed WebAudio graph.
 *
 * ---------------------------------------------------------------------------
 * ARCHITECTURE
 * ---------------------------------------------------------------------------
 *   sources ─► layer gain x3 ─► tone filter ─► voice env ─┬─► distance LPF ─► panner ─┐
 *                                                         │                            ├─► sfx bus ─┐
 *                                                         └─► reverb send ─► convolver ┘             ├─► master ─► comp ─► out
 *   drone oscillators ─► drone LPF ─┐                                                                │
 *   battle swell      ─────────────►├─► music bus ────────────────────────────────────────────────────┘
 *   hull rumble noise ─────────────►┘
 *
 * A *voice* is a preallocated strip of eight nodes. Only the oscillators and
 * buffer sources are created per event; they are stopped, disconnected on
 * `ended`, and the strip is recycled. The pool is hard-capped (`VOICE_CAP`) and
 * the quietest voice is stolen when the pool saturates.
 *
 * Events are not played the instant they arrive on the bus: they are clustered
 * for the duration of the frame and flushed in `update()`. A 60-gun broadside
 * therefore becomes one louder report rather than sixty phase-cancelling copies.
 *
 * Scale note: the battlespace is ~46 km across, so the distance model is a
 * hand-tuned inverse-power curve plus a lowpass that closes with range — far
 * away things are muffled and thin, close things are bright and present.
 *
 * The whole module is defensive: if WebAudio is missing, or the context is
 * suspended by the browser, every entry point degrades to a no-op.
 */

import type { Camera } from 'three';
import { bus } from './bus';
import { Rng } from './rng';
import { SHIP_SPECS } from './registry';
import { HullSize, Team, type GameEvents, type WeaponKind } from './types';
import type { World } from '../sim/world';
import { MusicDirector, type MusicTrack } from './music';
import { SampleBank, type EngineLoop } from './samples';

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** Hard ceiling on simultaneous voices. Beyond this the quietest is stolen. */
const VOICE_CAP = 48;
/** Maximum event clusters flushed in a single frame. */
const MAX_AGG = 24;

/** Distance in metres at which a sound has lost half its amplitude. */
const DIST_REF = 700;
/** Exponent of the inverse-power rolloff. >1 falls off faster than 1/d. */
const DIST_POW = 1.5;
/** Below this post-attenuation amplitude an event is dropped outright. */
const AUDIBLE_FLOOR = 0.0035;
/** e-folding distance of the distance lowpass, metres. */
const MUFFLE_SCALE = 3400;

/** Cluster radii per event family, metres. */
const CLUSTER_FIRE = 900;
const CLUSTER_HIT = 700;
const CLUSTER_DEATH = 260;

/** Seconds of white noise in the shared source buffer. */
const NOISE_SECONDS = 3;
/** Reverb impulse length, seconds. Short — this is hull resonance, not a hall. */
const IR_SECONDS = 1.9;

/**
 * Looping engine voices. Beyond a handful the ear stops resolving individual
 * drives and starts hearing a texture, at which point more voices buy nothing.
 */
const ENGINE_VOICES = 7;

/** Below this fraction of cruise a drive is idling and gets no loop. */
const ENGINE_MIN_THROTTLE = 0.12;

/**
 * Beyond this range a drive is not worth a voice, metres.
 *
 * Generous on purpose. The ranking below already picks the seven loudest
 * candidates and the falloff reference tracks the closest of them, so this is
 * only a sanity bound on the search — not the mix. At the old 7 km the default
 * battle camera (15 km out) had every mover outside the cutoff and the engine
 * bed was silent exactly when the whole fleet was on screen.
 */
const ENGINE_MAX_DIST = 42000;

/** One engine-bed candidate. */
interface EngCand { id: number; d: number; score: number }

/** Engine-bed candidate scratch. Module scope: the scan must not allocate. */
const _engCand: EngCand[] = [];

/** Hoisted comparator — the engine scan runs every world tick. */
const byScore = (a: EngCand, b: EngCand): number => b.score - a.score;

/** How long the combat "heat" accumulator takes to decay by 1/e, seconds. */
const HEAT_TAU = 2.6;
/** Seconds between the periodic world scans (capital proximity, projectiles). */
const SCAN_PERIOD = 0.12;

// ---------------------------------------------------------------------------
// Event / weapon coding — kept numeric so clustering never allocates strings.
// ---------------------------------------------------------------------------

const EV_FIRE = 0;
const EV_HIT = 1;
const EV_DEATH = 2;
const EV_BUILT = 3;
const EV_DELIVERED = 4;
const EV_NOTICE = 5;

/** Map a `WeaponKind` to a dense integer so cluster keys stay numeric. */
function weaponCode(k: WeaponKind): number {
  switch (k) {
    case 'pulse': return 1;
    case 'massdriver': return 2;
    case 'flak': return 3;
    case 'ion': return 4;
    case 'missile': return 5;
    case 'torpedo': return 6;
    case 'plasma': return 7;
    default: return 0;
  }
}

/** Per-weapon base loudness for `fire`. Tuned by ear against the drone bed. */
function fireGain(code: number): number {
  switch (code) {
    case 1: return 0.15; // pulse
    case 2: return 0.32; // massdriver
    case 3: return 0.24; // flak
    case 4: return 0.28; // ion
    case 5: return 0.20; // missile
    case 6: return 0.30; // torpedo
    case 7: return 0.44; // plasma
    default: return 0.16;
  }
}

// ---------------------------------------------------------------------------
// Small AudioParam helpers (module scope — no per-event closures)
// ---------------------------------------------------------------------------

/** Swallow a rejected promise without allocating a closure per call. */
function noop(): void {
  /* intentionally empty */
}

/** Clamp helper. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Percussive envelope: silence -> `peak` over `atk` -> back to silence over
 * `dec`. Exponential ramps need strictly positive endpoints, hence the 1e-4
 * floor followed by a hard zero.
 */
function adsr(p: AudioParam, t: number, peak: number, atk: number, dec: number): void {
  const top = Math.max(peak, 2e-4);
  p.cancelScheduledValues(t);
  p.setValueAtTime(1e-4, t);
  p.exponentialRampToValueAtTime(top, t + atk);
  p.exponentialRampToValueAtTime(1e-4, t + atk + dec);
  p.setValueAtTime(0, t + atk + dec);
}

/** Exponential glide between two positive values. */
function glide(p: AudioParam, t: number, from: number, to: number, dur: number): void {
  p.cancelScheduledValues(t);
  p.setValueAtTime(Math.max(from, 1e-3), t);
  p.exponentialRampToValueAtTime(Math.max(to, 1e-3), t + Math.max(dur, 1e-3));
}

/** Hold a param at a constant from `t`, cancelling anything previously booked. */
function hold(p: AudioParam, t: number, v: number): void {
  p.cancelScheduledValues(t);
  p.setValueAtTime(v, t);
}

/** Position a panner, using AudioParams when available and the legacy call otherwise. */
function setPannerPos(p: PannerNode, x: number, y: number, z: number, t: number): void {
  if (p.positionX) {
    p.positionX.setValueAtTime(x, t);
    p.positionY.setValueAtTime(y, t);
    p.positionZ.setValueAtTime(z, t);
  } else {
    (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(x, y, z);
  }
}

// ---------------------------------------------------------------------------
// Voice — one preallocated processing strip
// ---------------------------------------------------------------------------

/**
 * A recyclable mixer strip. Layers `l0..l2` let a single event carry three
 * independently-enveloped components (e.g. sub impulse + noise burst + body)
 * without allocating gain nodes per event.
 */
class Voice {
  readonly l0: GainNode;
  readonly l1: GainNode;
  readonly l2: GainNode;
  readonly tone: BiquadFilterNode;
  readonly env: GainNode;
  readonly muffle: BiquadFilterNode;
  readonly pan: PannerNode;
  readonly send: GainNode;

  /** Live sources belonging to this activation; disconnected when they end. */
  readonly srcs: AudioScheduledSourceNode[] = [];
  /** Stable `ended` handler — created once, reused for every source. */
  readonly onEnded: (ev: Event) => void;

  active = false;
  /** Context time at which the strip may be recycled. */
  endTime = 0;
  /** Post-attenuation amplitude; the steal heuristic drops the smallest. */
  loud = 0;

  constructor(ctx: AudioContext, dry: AudioNode, verb: AudioNode) {
    this.l0 = ctx.createGain();
    this.l1 = ctx.createGain();
    this.l2 = ctx.createGain();
    this.tone = ctx.createBiquadFilter();
    this.env = ctx.createGain();
    this.muffle = ctx.createBiquadFilter();
    this.pan = ctx.createPanner();
    this.send = ctx.createGain();

    this.l0.gain.value = 0;
    this.l1.gain.value = 0;
    this.l2.gain.value = 0;
    this.env.gain.value = 0;
    this.send.gain.value = 0;

    this.tone.type = 'lowpass';
    this.tone.frequency.value = 20000;
    this.tone.Q.value = 0.0001;

    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.muffle.Q.value = 0.0001;

    // Distance attenuation is computed on the CPU (the built-in models do not
    // behave well over a 46 km battlespace), so the panner only does azimuth.
    this.pan.panningModel = 'equalpower';
    this.pan.distanceModel = 'inverse';
    this.pan.refDistance = 1;
    this.pan.rolloffFactor = 0;
    this.pan.coneInnerAngle = 360;
    this.pan.coneOuterAngle = 360;
    this.pan.coneOuterGain = 1;

    this.l0.connect(this.tone);
    this.l1.connect(this.tone);
    this.l2.connect(this.tone);
    this.tone.connect(this.env);
    this.env.connect(this.muffle);
    this.muffle.connect(this.pan);
    this.pan.connect(dry);
    this.env.connect(this.send);
    this.send.connect(verb);

    this.onEnded = (ev: Event): void => {
      const n = ev.target as AudioNode | null;
      if (!n) return;
      try {
        n.disconnect();
      } catch {
        /* already detached */
      }
    };
  }

  /**
   * Claim the strip for a new event: silence every layer, park the overall
   * amplitude and reset the filters to a transparent state.
   */
  begin(t: number, dur: number, amp: number, loud: number): void {
    this.active = true;
    this.endTime = t + dur + 0.05;
    this.loud = loud;
    this.srcs.length = 0;
    hold(this.l0.gain, t, 0);
    hold(this.l1.gain, t, 0);
    hold(this.l2.gain, t, 0);
    hold(this.env.gain, t, amp);
    hold(this.send.gain, t, 0);
    this.tone.type = 'lowpass';
    hold(this.tone.frequency, t, 20000);
    hold(this.tone.Q, t, 0.0001);
  }

  /** Release the strip: silence it and drop any source still hanging around. */
  free(t: number): void {
    this.active = false;
    this.loud = 0;
    for (let i = 0; i < this.srcs.length; i++) {
      const s = this.srcs[i];
      try {
        s.disconnect();
      } catch {
        /* already detached */
      }
    }
    this.srcs.length = 0;
    hold(this.env.gain, t, 0);
    hold(this.l0.gain, t, 0);
    hold(this.l1.gain, t, 0);
    hold(this.l2.gain, t, 0);
  }

  /** Cut the strip dead so it can be re-triggered immediately (voice stealing). */
  steal(t: number): void {
    hold(this.env.gain, t, 0);
    for (let i = 0; i < this.srcs.length; i++) {
      const s = this.srcs[i];
      try {
        s.stop(t);
      } catch {
        /* never started / already stopped */
      }
    }
    this.free(t);
  }
}

// ---------------------------------------------------------------------------
// Event cluster
// ---------------------------------------------------------------------------

/** One frame's worth of coalesced identical events. */
interface Agg {
  type: number;
  code: number;
  /** Running mean position, world space. */
  x: number;
  y: number;
  z: number;
  /** How many raw events folded in. */
  n: number;
  /** Largest payload magnitude in the cluster (`scale`, or hull radius for deaths). */
  mag: number;
  /** Type-specific boolean (shielded hit, player-team build, ...). */
  flag: boolean;
}

function makeAgg(): Agg {
  return { type: 0, code: 0, x: 0, y: 0, z: 0, n: 0, mag: 0, flag: false };
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

/**
 * The game's audio layer. Construct once, call {@link Audio.start} from a user
 * gesture, then {@link Audio.update} every rendered frame.
 */
export class Audio {
  private ctx: AudioContext | null = null;

  // --- fixed graph ---
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private verbIn: GainNode | null = null;
  private comp: DynamicsCompressorNode | null = null;

  // --- ambient bed ---
  private droneGain: GainNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;
  private swellGain: GainNode | null = null;
  private rumbleGain: GainNode | null = null;
  private rumbleFilter: BiquadFilterNode | null = null;
  private ambientSrcs: AudioScheduledSourceNode[] = [];

  private noiseBuf: AudioBuffer | null = null;

  private voices: Voice[] = [];

  // --- mix levels ---
  private volMaster = 0.85;
  private volSfx = 1.0;
  private volMusic = 0.62;

  // --- clustering ---
  private aggs: Agg[] = [];
  private aggN = 0;

  // --- listener state (world space, updated each frame) ---
  private lx = 0;
  private ly = 0;
  private lz = 0;
  private lfx = 0;
  private lfy = 0;
  private lfz = -1;
  /** Listener right axis (`e[0..2]` of the camera matrix), for sample panning. */
  private lrx = 1;
  private lry = 0;
  private lrz = 0;

  // --- adaptive ambience ---
  /** Decaying accumulator of combat activity, 0..~10. */
  private heat = 0;
  /** Earliest context time at which another acknowledgement may fire. */
  private nextAck = 0;
  /**
   * Notified whenever the score starts a track, so the UI can credit it while
   * it plays. Set by the integrator; the director is private.
   */
  onTrackChange: ((t: MusicTrack) => void) | null = null;

  /**
   * Recorded layers. Both are optional at every point: if WebAudio never
   * starts, or a file 404s, the synthesised graph carries the whole mix on its
   * own exactly as it did before they existed.
   */
  private music: MusicDirector | null = null;
  private samples: SampleBank | null = null;

  /**
   * The engine bed: up to `ENGINE_VOICES` looping drives, assigned each scan to
   * the nearest MOVING hulls.
   *
   * One loop per ship would be hundreds of voices and would sound like a swarm
   * of wasps; one loop for the whole fleet would not pan. A handful of the
   * nearest movers is what the ear actually resolves, and it is the same
   * approach the visual LOD takes for the same reason.
   */
  private engines: Array<{ id: number; loop: EngineLoop; band: string }> = [];
  /** Smoothed 0..1 battle intensity driving the drone filter and swell. */
  private intensity = 0;
  /** Smoothed 0..1 proximity to the nearest capital hull. */
  private capitalNear = 0;
  private scanT = 0;

  // --- misc ---
  private rng = new Rng(0x5747f00d);
  private started = false;
  private resumeAt = 0;
  /** Rate limits for chatty non-combat cues, in context time. */
  private nextBuilt = 0;
  private nextDelivered = 0;
  private nextNotice = 0;

  private offs: Array<() => void> = [];

  constructor() {
    for (let i = 0; i < MAX_AGG; i++) this.aggs.push(makeAgg());
    this.offs.push(bus.on('fire', this.onFire));
    this.offs.push(bus.on('hit', this.onHit));
    this.offs.push(bus.on('death', this.onDeath));
    this.offs.push(bus.on('built', this.onBuilt));
    this.offs.push(bus.on('delivered', this.onDelivered));
    this.offs.push(bus.on('notice', this.onNotice));
    this.offs.push(bus.on('ack', this.onAck));
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Build the graph and start the ambient bed. MUST be called from a user
   * gesture (click/keydown) or the browser will refuse to run the context.
   * Safe to call repeatedly; later calls simply resume a suspended context.
   */
  async start(): Promise<void> {
    if (this.started) {
      await this.tryResume();
      return;
    }
    const Ctor =
      (globalThis as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
      (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return; // WebAudio unavailable — the whole layer stays inert.

    try {
      const ctx = new Ctor({ latencyHint: 'interactive' });
      this.ctx = ctx;
      this.buildGraph(ctx);
      this.started = true;
      await this.tryResume();
    } catch {
      this.ctx = null;
      this.started = false;
    }
  }

  /** Resume the context, tolerating browsers that reject the promise. */
  private async tryResume(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state === 'running') return;
    try {
      await ctx.resume();
    } catch {
      /* user gesture still required — retried from update() */
    }
  }

  /** Tear everything down. The instance is dead afterwards. */
  dispose(): void {
    for (let i = 0; i < this.offs.length; i++) this.offs[i]();
    this.offs.length = 0;
    this.aggN = 0;
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    try {
      for (let i = 0; i < this.ambientSrcs.length; i++) {
        try {
          this.ambientSrcs[i].stop(now);
        } catch {
          /* ignore */
        }
        this.ambientSrcs[i].disconnect();
      }
      this.ambientSrcs.length = 0;
      for (let i = 0; i < this.voices.length; i++) this.voices[i].steal(now);
      this.voices.length = 0;
      for (const e of this.engines) e.loop.stop();
      this.engines.length = 0;
      this.music?.dispose();
      this.music = null;
      this.samples?.dispose();
      this.samples = null;
      this.master?.disconnect();
      this.sfxBus?.disconnect();
      this.musicBus?.disconnect();
      this.verbIn?.disconnect();
      this.comp?.disconnect();
      void ctx.close().catch(noop);
    } catch {
      /* nothing sensible to do while tearing down */
    }
    this.ctx = null;
    this.started = false;
  }

  /** Set the three mix faders. Values are clamped to 0..1 and persist across restarts. */
  /** Current levels, 0..1, for the menu's sliders. */
  getVolume(): { master: number; sfx: number; music: number } {
    return { master: this.volMaster, sfx: this.volSfx, music: this.volMusic };
  }

  setVolume(master: number, sfx: number, music: number): void {
    this.volMaster = clamp(master, 0, 1);
    this.volSfx = clamp(sfx, 0, 1);
    this.volMusic = clamp(music, 0, 1);
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.sfxBus || !this.musicBus) return;
    const t = ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volMaster, t, 0.03);
    this.sfxBus.gain.setTargetAtTime(this.volSfx, t, 0.03);
    this.musicBus.gain.setTargetAtTime(this.volMusic * 0.9, t, 0.05);
    this.music?.setVolume(1);
  }

  // -------------------------------------------------------------------------
  // Graph construction
  // -------------------------------------------------------------------------

  private buildGraph(ctx: AudioContext): void {
    // --- buses ---
    const master = ctx.createGain();
    const sfx = ctx.createGain();
    const music = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    master.gain.value = this.volMaster;
    sfx.gain.value = this.volSfx;
    music.gain.value = this.volMusic * 0.9;
    comp.threshold.value = -13;
    comp.knee.value = 22;
    comp.ratio.value = 6;
    comp.attack.value = 0.004;
    comp.release.value = 0.26;
    sfx.connect(master);
    music.connect(master);
    master.connect(comp);
    comp.connect(ctx.destination);
    this.master = master;
    this.sfxBus = sfx;
    this.musicBus = music;
    this.comp = comp;

    // --- shared noise + procedural impulse response ---
    this.noiseBuf = this.makeNoise(ctx);
    const verbIn = ctx.createGain();
    verbIn.gain.value = 1;
    const conv = ctx.createConvolver();
    conv.normalize = true;
    conv.buffer = this.makeImpulse(ctx);
    const verbOut = ctx.createGain();
    verbOut.gain.value = 0.5;
    verbIn.connect(conv);
    conv.connect(verbOut);
    verbOut.connect(sfx);
    this.verbIn = verbIn;

    this.buildAmbient(ctx, music);

    // --- recorded layers -----------------------------------------------------
    // The score goes on the music bus so the existing music slider still owns
    // it; the samples go on the sfx bus for the same reason. Neither is awaited:
    // the game is playable and audible before a byte of either has arrived.
    //
    // `import.meta.env.BASE_URL` rather than a bare path, so a build served from
    // a sub-directory still resolves its own assets.
    const base = import.meta.env.BASE_URL ?? '/';
    try {
      this.music = new MusicDirector(ctx, music, base);
      this.music.onTrack = (t): void => this.onTrackChange?.(t);
      this.music.setVolume(1);
    } catch {
      this.music = null;
    }
    try {
      this.samples = new SampleBank(ctx, sfx, base);
      void this.samples.load();
    } catch {
      this.samples = null;
    }
  }

  /** One shared buffer of white noise; every noise layer reads it at a random offset. */
  private makeNoise(ctx: AudioContext): AudioBuffer {
    const n = Math.floor(ctx.sampleRate * NOISE_SECONDS);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    const rng = this.rng;
    for (let i = 0; i < n; i++) d[i] = rng.next() * 2 - 1;
    return buf;
  }

  /**
   * Procedural impulse response: decorrelated noise under an exponential decay
   * with a slight build-up, so hits smear into a metallic hull resonance rather
   * than a room. Purely cosmetic — space has no reverb, the ship's frame does.
   */
  private makeImpulse(ctx: AudioContext): AudioBuffer {
    const n = Math.floor(ctx.sampleRate * IR_SECONDS);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    const rng = this.rng;
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      // One-pole lowpass over the noise darkens the tail as it decays.
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const u = i / n;
        const decay = Math.exp(-u * 5.2) * (1 - Math.exp(-u * 90));
        lp += ((rng.next() * 2 - 1) - lp) * (0.42 - 0.3 * u);
        d[i] = lp * decay;
      }
    }
    return buf;
  }

  /** Detuned drone, battle swell and hull rumble — all looping, all procedural. */
  private buildAmbient(ctx: AudioContext, music: GainNode): void {
    const t = ctx.currentTime + 0.05;

    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 140;
    droneFilter.Q.value = 1.1;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.0;
    droneGain.connect(droneFilter);
    droneFilter.connect(music);
    this.droneGain = droneGain;
    this.droneFilter = droneFilter;

    // Four slightly detuned partials around a low A — a bed, not a chord.
    this.ambientOsc(ctx, 'sawtooth', 27.5, -6, droneGain, t, 0.5);
    this.ambientOsc(ctx, 'sawtooth', 41.2, 7, droneGain, t, 0.34);
    this.ambientOsc(ctx, 'triangle', 55.0, -11, droneGain, t, 0.3);
    this.ambientOsc(ctx, 'sine', 18.35, 3, droneGain, t, 0.6);

    // Very slow detune wander so the bed never sits perfectly still.
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.031;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 9; // cents
    lfo.connect(lfoDepth);
    // Re-target the last oscillator created (index 2, the triangle).
    const wander = this.ambientSrcs[2] as OscillatorNode;
    lfoDepth.connect(wander.detune);
    lfo.start(t);
    this.ambientSrcs.push(lfo);

    // Battle swell: a brighter fifth that only exists while shooting happens.
    const swellFilter = ctx.createBiquadFilter();
    swellFilter.type = 'bandpass';
    swellFilter.frequency.value = 210;
    swellFilter.Q.value = 0.8;
    const swellGain = ctx.createGain();
    swellGain.gain.value = 0;
    swellGain.connect(swellFilter);
    swellFilter.connect(music);
    this.swellGain = swellGain;
    this.ambientOsc(ctx, 'sawtooth', 82.4, -5, swellGain, t, 0.5);
    this.ambientOsc(ctx, 'sawtooth', 123.5, 6, swellGain, t, 0.32);

    // Hull rumble: filtered noise that swells when the camera sits on a capital.
    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 92;
    rumbleFilter.Q.value = 3.2;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0;
    rumbleGain.connect(rumbleFilter);
    rumbleFilter.connect(music);
    this.rumbleGain = rumbleGain;
    this.rumbleFilter = rumbleFilter;
    if (this.noiseBuf) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      src.playbackRate.value = 0.55;
      src.connect(rumbleGain);
      src.start(t);
      this.ambientSrcs.push(src);
    }
  }

  /** Helper: one always-on oscillator feeding an ambient sub-mix. */
  private ambientOsc(
    ctx: AudioContext, type: OscillatorType, freq: number, detune: number,
    dest: AudioNode, t: number, level: number,
  ): void {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.value = level;
    o.connect(g);
    g.connect(dest);
    o.start(t);
    this.ambientSrcs.push(o);
  }

  // -------------------------------------------------------------------------
  // Bus handlers — arrow fields so they can be unsubscribed.
  // Payloads are reused by the emitter, so every field is copied immediately.
  // -------------------------------------------------------------------------

  /**
   * Interface acknowledgements. These bypass the aggregator entirely: they are
   * never clustered, never spatialised and never stolen, because they are a
   * direct answer to something the player just did and a delayed or dropped
   * answer is worse than none. The only guard is a short cooldown so holding a
   * key down cannot machine-gun the same click.
   */
  private onAck = (p: GameEvents['ack']): void => {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (now < this.nextAck) return;
    this.nextAck = now + 0.07;
    const n = p.count ?? 1;
    switch (p.kind) {
      case 'select':
        // A bigger selection answers a little louder and a little lower: the
        // fleet bar's "select every interceptor" should not sound identical to
        // clicking one scout.
        this.samples?.play('ackSelect', 0.34, 0, 0, clamp(1.14 - n * 0.012, 0.86, 1.14));
        break;
      case 'order':
        this.samples?.play('ackOrder', 0.40, 0, 0, clamp(1.10 - n * 0.010, 0.88, 1.10));
        break;
      case 'attack':
        this.samples?.play('uiSwitch', 0.42, 0, 0, 0.92);
        break;
      case 'queued': this.samples?.play('queued', 0.30); break;
      case 'research': this.samples?.play('research', 0.34); break;
      case 'dock': this.samples?.play('dock', 0.30); break;
      case 'deny': this.samples?.play('uiError', 0.34); break;
      default: this.samples?.play('uiClick', 0.26); break;
    }
  };

  private onFire = (p: GameEvents['fire']): void => {
    this.push(EV_FIRE, weaponCode(p.kind), p.x, p.y, p.z, p.scale, false, CLUSTER_FIRE);
    this.heat += 0.02;
  };

  private onHit = (p: GameEvents['hit']): void => {
    this.push(EV_HIT, weaponCode(p.kind), p.x, p.y, p.z, p.scale, p.shielded, CLUSTER_HIT);
    this.heat += 0.012;
  };

  private onDeath = (p: GameEvents['death']): void => {
    this.push(EV_DEATH, 0, p.x, p.y, p.z, p.radius, false, CLUSTER_DEATH);
    this.heat += 0.7;
  };

  private onBuilt = (p: GameEvents['built']): void => {
    if (p.team !== Team.Player) return;
    this.push(EV_BUILT, 0, 0, 0, 0, 1, true, Infinity);
  };

  private onDelivered = (p: GameEvents['delivered']): void => {
    if (p.team !== Team.Player) return;
    this.push(EV_DELIVERED, 0, p.x, p.y, p.z, p.amount, true, Infinity);
  };

  private onNotice = (p: GameEvents['notice']): void => {
    const code = p.kind === 'alert' ? 2 : p.kind === 'warn' ? 1 : 0;
    this.push(EV_NOTICE, code, 0, 0, 0, 1, true, Infinity);
  };

  /**
   * Fold one raw event into this frame's clusters. Greedy nearest-match: an
   * event joins the first cluster of the same type/code within `radius`,
   * otherwise it opens a new one (until `MAX_AGG`, after which the closest
   * existing cluster absorbs it).
   */
  private push(
    type: number, code: number, x: number, y: number, z: number,
    mag: number, flag: boolean, radius: number,
  ): void {
    if (!this.started) return;
    const r2 = radius === Infinity ? Infinity : radius * radius;
    let bestIdx = -1;
    let bestD = Infinity;
    for (let i = 0; i < this.aggN; i++) {
      const a = this.aggs[i];
      if (a.type !== type || a.code !== code || a.flag !== flag) continue;
      const dx = a.x - x, dy = a.y - y, dz = a.z - z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) {
        bestD = d;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestD <= r2) {
      const a = this.aggs[bestIdx];
      a.n++;
      // Running mean keeps the cluster centred on its members.
      const inv = 1 / a.n;
      a.x += (x - a.x) * inv;
      a.y += (y - a.y) * inv;
      a.z += (z - a.z) * inv;
      a.mag = Math.max(a.mag, mag);
      return;
    }
    if (this.aggN < MAX_AGG) {
      const a = this.aggs[this.aggN++];
      a.type = type;
      a.code = code;
      a.x = x;
      a.y = y;
      a.z = z;
      a.n = 1;
      a.mag = mag;
      a.flag = flag;
      return;
    }
    // Saturated: dump it into the nearest same-type cluster if there is one.
    if (bestIdx >= 0) this.aggs[bestIdx].n++;
  }

  // -------------------------------------------------------------------------
  // Per-frame update
  // -------------------------------------------------------------------------

  /**
   * Mix one frame: refresh the listener from `camera`, flush the frame's event
   * clusters, drive the adaptive ambience from `world`, and recycle finished
   * voices. Never throws, never allocates.
   */
  update(camera: Camera, dt: number, world: World): void {
    // Combat heat decays whether or not the context runs, so resuming audio
    // mid-battle does not produce a stale swell.
    this.heat *= Math.exp(-dt / HEAT_TAU);
    if (this.heat > 12) this.heat = 12;

    const ctx = this.ctx;
    if (!ctx || !this.started) {
      this.aggN = 0;
      return;
    }
    if (ctx.state !== 'running') {
      // Suspended by the browser (tab hidden, autoplay policy). Drop queued
      // events and poll for a resume at most twice a second.
      this.aggN = 0;
      const now = ctx.currentTime;
      if (now >= this.resumeAt) {
        this.resumeAt = now + 0.5;
        void ctx.resume().catch(noop);
      }
      return;
    }

    const now = ctx.currentTime;
    this.updateListener(camera, now);
    this.flush(now);
    this.reap(now);

    this.scanT += dt;
    if (this.scanT >= SCAN_PERIOD) {
      this.scan(world, this.scanT);
      this.scanT = 0;
    }
    this.updateAmbient(now);
    this.updateEngines(world);
    // The director gets the SMOOTHED intensity, not the raw heat: it has its own
    // hysteresis on top, but feeding it a per-frame spike would make that work
    // harder than it should have to.
    this.music?.update(dt, this.intensity);
  }

  /** Copy the camera basis into the WebAudio listener. */
  private updateListener(camera: Camera, now: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    // three cameras look down local -Z; up is the +Y column.
    const fx = -e[8], fy = -e[9], fz = -e[10];
    const ux = e[4], uy = e[5], uz = e[6];
    const px = e[12], py = e[13], pz = e[14];
    this.lx = px; this.ly = py; this.lz = pz;
    this.lfx = fx; this.lfy = fy; this.lfz = fz;
    this.lrx = e[0]; this.lry = e[1]; this.lrz = e[2];

    const L = ctx.listener;
    if (L.positionX) {
      // Small time constants: smooth enough to kill zipper noise, fast enough
      // that a camera snap does not audibly lag.
      L.positionX.setTargetAtTime(px, now, 0.02);
      L.positionY.setTargetAtTime(py, now, 0.02);
      L.positionZ.setTargetAtTime(pz, now, 0.02);
      L.forwardX.setTargetAtTime(fx, now, 0.03);
      L.forwardY.setTargetAtTime(fy, now, 0.03);
      L.forwardZ.setTargetAtTime(fz, now, 0.03);
      L.upX.setTargetAtTime(ux, now, 0.05);
      L.upY.setTargetAtTime(uy, now, 0.05);
      L.upZ.setTargetAtTime(uz, now, 0.05);
    } else {
      const legacy = L as unknown as {
        setPosition(x: number, y: number, z: number): void;
        setOrientation(fx: number, fy: number, fz: number, ux: number, uy: number, uz: number): void;
      };
      legacy.setPosition(px, py, pz);
      legacy.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  /** Recycle strips whose scheduled tail has run out. */
  private reap(now: number): void {
    const vs = this.voices;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (v.active && now >= v.endTime) v.free(now);
    }
  }

  /** Periodic world sample: projectile pressure and nearest capital hull. */
  private scan(world: World, dt: number): void {
    // Projectiles in flight are a decent proxy for "how loud is this battle".
    let shots = 0;
    const pr = world.projectiles;
    for (let i = 0; i < pr.count; i++) if (pr.items[i].alive) shots++;
    let beams = 0;
    const bm = world.beams;
    for (let i = 0; i < bm.count; i++) if (bm.items[i].alive) beams++;

    // Full intensity needs a genuine fleet engagement (~170 shots/second),
    // otherwise a two-ship skirmish would already max out the swell.
    const raw = clamp(this.heat / 9 + shots / 300 + beams / 26, 0, 1);
    // Fast attack, slow release — the swell arrives with the first salvo and
    // decays with the battle rather than flickering per frame.
    const k = raw > this.intensity ? 1 - Math.exp(-dt / 0.35) : 1 - Math.exp(-dt / 3.2);
    this.intensity += (raw - this.intensity) * k;

    // Nearest capital-sized hull to the listener drives the sub-bass rumble.
    let best = Infinity;
    const sh = world.ships;
    for (let i = 0; i < sh.count; i++) {
      const s = sh.items[i];
      if (!s.alive || s.dockedIn >= 0) continue;
      const size = SHIP_SPECS[s.cls].size;
      if (size !== HullSize.Capital && size !== HullSize.SuperCapital) continue;
      const dx = s.pos.x - this.lx, dy = s.pos.y - this.ly, dz = s.pos.z - this.lz;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < best) best = d;
    }
    const dist = best === Infinity ? Infinity : Math.sqrt(best);
    const near = dist === Infinity ? 0 : clamp(1 - dist / 2600, 0, 1);
    const kn = 1 - Math.exp(-dt / 0.6);
    this.capitalNear += (near - this.capitalNear) * kn;

    this.scanEngines(world);
  }

  /**
   * Reassign the engine bed to the nearest moving hulls.
   *
   * Runs on the world scan, not per frame, because reassigning a loop is the
   * one thing in this module that is genuinely expensive — a new buffer source
   * and four nodes — and a drive that changes owner ten times a second is a
   * stutter, not an engine. Between scans the existing loops are just re-aimed.
   */
  private scanEngines(world: World): void {
    const bank = this.samples;
    if (!bank) return;

    // Pick candidates: moving, undocked, in range. Ranked by how loud they
    // would be, which is throttle over distance rather than distance alone —
    // a mothership burning at 5 km outranks an idling scout at 500 m.
    _engCand.length = 0;
    const sh = world.ships;
    for (let i = 0; i < sh.count; i++) {
      const s = sh.items[i];
      if (!s.alive || s.dockedIn >= 0) continue;
      if (s.throttle < ENGINE_MIN_THROTTLE) continue;
      const dx = s.pos.x - this.lx, dy = s.pos.y - this.ly, dz = s.pos.z - this.lz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > ENGINE_MAX_DIST) continue;
      _engCand.push({ id: s.id, d, score: s.throttle / (1 + d / 900) });
    }
    _engCand.sort(byScore);
    if (_engCand.length > ENGINE_VOICES) _engCand.length = ENGINE_VOICES;

    // Retire voices whose ship is no longer in the running.
    for (let i = this.engines.length - 1; i >= 0; i--) {
      const e = this.engines[i];
      if (!_engCand.some((c: EngCand) => c.id === e.id)) {
        e.loop.stop();
        this.engines.splice(i, 1);
      }
    }
    // Claim voices for newcomers.
    for (const c of _engCand) {
      if (this.engines.some((e) => e.id === c.id)) continue;
      if (this.engines.length >= ENGINE_VOICES) break;
      const s = world.ship(c.id);
      if (!s) continue;
      const size = SHIP_SPECS[s.cls].size;
      const band = size === HullSize.SuperCapital || size === HullSize.Capital
        ? 'engineLarge'
        : size === HullSize.Frigate || size === HullSize.Corvette || size === HullSize.Utility
          ? 'engineMedium'
          : 'engineSmall';
      const loop = bank.loop(band, 0.9 + Math.random() * 0.2);
      if (loop) this.engines.push({ id: c.id, loop, band });
    }
  }

  /** Re-aim every live engine voice at its ship. Cheap; runs every frame. */
  private updateEngines(world: World): void {
    // Falloff reference: the range to the closest drive being tracked. Whatever
    // the player is looking at is audible, and everything further away sits
    // behind it in the mix — which is what "follows the camera" means here.
    let ref = 900;
    for (let i = 0; i < this.engines.length; i++) {
      const s = world.ship(this.engines[i].id);
      if (!s) continue;
      const dx = s.pos.x - this.lx, dy = s.pos.y - this.ly, dz = s.pos.z - this.lz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (i === 0 || d < ref) ref = d;
    }
    ref = Math.max(400, ref);

    for (let i = this.engines.length - 1; i >= 0; i--) {
      const e = this.engines[i];
      const s = world.ship(e.id);
      if (!s || !s.alive || s.dockedIn >= 0) {
        e.loop.stop();
        this.engines.splice(i, 1);
        continue;
      }
      const dx = s.pos.x - this.lx, dy = s.pos.y - this.ly, dz = s.pos.z - this.lz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      // A big drive is louder and pitched lower than a small one, and throttle
      // moves both — which is the cue that says "that ship just burned".
      const heavy = e.band === 'engineLarge' ? 1.7 : e.band === 'engineMedium' ? 1.15 : 0.8;
      const thr = s.throttle < 0 ? 0 : s.throttle > 1 ? 1 : s.throttle;
      e.loop.set(
        0.16 * heavy * (0.35 + 0.65 * thr),
        d,
        ref,
        this.panOf(s.pos.x, s.pos.y, s.pos.z, d),
        (e.band === 'engineLarge' ? 0.72 : 0.92) + 0.28 * thr,
      );
    }
  }

  /** Push the smoothed ambience state onto the graph. */
  private updateAmbient(now: number): void {
    const i = this.intensity;
    if (this.droneGain) {
      // Base bed plus a lift while fighting; the drone is the floor of the mix.
      // Pulled well down now that a real score sits on this bus. The synth bed
      // is no longer the music; it is the sub floor UNDER the music, which is
      // the one thing a streamed stereo track cannot supply at battlespace
      // scale. At the old 0.16-0.30 it fought the recording for the same
      // register and the two together were the reported "mixed bag".
      this.droneGain.gain.setTargetAtTime(0.045 + 0.05 * i, now, 0.8);
    }
    if (this.droneFilter) {
      // Cutoff opens with combat: calm = felt-not-heard, battle = a growl.
      this.droneFilter.frequency.setTargetAtTime(110 + 1250 * i * i, now, 0.9);
    }
    if (this.swellGain) {
      // Likewise: the combat playlist now carries the escalation, so the swell
      // is a reinforcement rather than the whole gesture.
      this.swellGain.gain.setTargetAtTime(0.04 * i * i, now, 1.1);
    }
    if (this.rumbleGain) {
      this.rumbleGain.gain.setTargetAtTime(0.34 * this.capitalNear, now, 0.35);
    }
    if (this.rumbleFilter) {
      this.rumbleFilter.frequency.setTargetAtTime(78 + 46 * this.capitalNear, now, 0.5);
    }
  }

  // -------------------------------------------------------------------------
  // Voice allocation
  // -------------------------------------------------------------------------

  /**
   * Grab a strip for a sound of loudness `loud`. Grows the pool lazily up to
   * `VOICE_CAP`, then steals the quietest active strip if the newcomer is
   * meaningfully louder. Returns null when the request loses.
   */
  private alloc(loud: number, now: number): Voice | null {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || !this.verbIn) return null;
    const vs = this.voices;
    let worst = -1;
    let worstLoud = Infinity;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (!v.active) return v;
      if (v.loud < worstLoud) {
        worstLoud = v.loud;
        worst = i;
      }
    }
    if (vs.length < VOICE_CAP) {
      const v = new Voice(ctx, this.sfxBus, this.verbIn);
      vs.push(v);
      return v;
    }
    if (worst >= 0 && worstLoud < loud * 0.9) {
      const v = vs[worst];
      v.steal(now);
      return v;
    }
    return null;
  }

  /** Create an oscillator wired into `dest`, owned by `v`. */
  private osc(
    v: Voice, dest: AudioNode, type: OscillatorType, freq: number,
    t: number, dur: number, detune = 0,
  ): OscillatorNode | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    o.connect(dest);
    o.onended = v.onEnded;
    o.start(t);
    o.stop(t + dur);
    v.srcs.push(o);
    return o;
  }

  /** Create a one-shot noise source (random offset into the shared buffer). */
  private noise(v: Voice, dest: AudioNode, t: number, dur: number, rate = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuf) return;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.playbackRate.value = rate;
    s.connect(dest);
    s.onended = v.onEnded;
    // `duration` is measured in buffer seconds, so scale by the playback rate.
    // Long tails can outrun the buffer; clamp and let the envelope hide it.
    const need = Math.min(dur * rate + 0.02, NOISE_SECONDS - 0.01);
    // Offset avoids every burst sharing the same noise phase (comb filtering).
    const off = this.rng.next() * Math.max(0, NOISE_SECONDS - need);
    s.start(t, off, need);
    s.stop(t + dur + 0.02);
    v.srcs.push(s);
  }

  // -------------------------------------------------------------------------
  // Flush: turn this frame's clusters into voices
  // -------------------------------------------------------------------------

  private flush(now: number): void {
    // A hair of lookahead so every ramp is scheduled in the future.
    const t = now + 0.012;
    for (let i = 0; i < this.aggN; i++) this.play(this.aggs[i], t, now);
    this.aggN = 0;
  }

  /** Distance attenuation tuned for a 46 km battlespace. */
  private attenuation(d: number): number {
    return 1 / (1 + Math.pow(d / DIST_REF, DIST_POW));
  }

  private play(a: Agg, t: number, now: number): void {
    const positional = a.type === EV_FIRE || a.type === EV_HIT || a.type === EV_DEATH ||
      a.type === EV_DELIVERED;

    let dist = 0;
    let att = 1;
    if (positional) {
      const dx = a.x - this.lx, dy = a.y - this.ly, dz = a.z - this.lz;
      dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      att = this.attenuation(dist);
    }

    // Coalesced stack: log growth, so 60 guns are ~2.5x one gun, not 60x.
    const stack = a.n > 1 ? Math.min(1 + 0.42 * Math.log2(a.n), 2.6) : 1;

    switch (a.type) {
      case EV_FIRE: this.playFire(a, t, now, dist, att, stack); break;
      case EV_HIT: this.playHit(a, t, now, dist, att, stack); break;
      case EV_DEATH: this.playDeath(a, t, now, dist, att); break;
      case EV_BUILT: this.playBuilt(t, now); break;
      case EV_DELIVERED: this.playDelivered(a, t, now, dist, att); break;
      case EV_NOTICE: this.playNotice(a, t, now); break;
      default: break;
    }
  }

  /**
   * Prepare a strip: distance lowpass, panner placement and reverb send.
   * `dist < 0` marks a non-positional (UI) cue, parked just ahead of the
   * listener so the panner keeps it dead centre.
   */
  private prep(v: Voice, t: number, dist: number, x: number, y: number, z: number, send: number): void {
    if (dist < 0) {
      hold(v.muffle.frequency, t, 20000);
      hold(v.muffle.Q, t, 0.0001);
      setPannerPos(v.pan, this.lx + this.lfx, this.ly + this.lfy, this.lz + this.lfz, t);
      hold(v.send.gain, t, send);
      return;
    }
    // Air-less, but distance still eats the top end via geometry and hull mass.
    const cut = clamp(20000 * Math.exp(-dist / MUFFLE_SCALE), 240, 20000);
    hold(v.muffle.frequency, t, cut);
    hold(v.muffle.Q, t, 0.0001);
    setPannerPos(v.pan, x, y, z, t);
    hold(v.send.gain, t, send);
  }

  /**
   * Stereo position of a world point, -1..+1.
   *
   * The synth path spatialises through a PannerNode with the full listener
   * orientation; the sample path uses a StereoPannerNode, which has no notion of
   * a listener, so the azimuth is projected here against the camera's right
   * axis. Normalised by distance so a point directly overhead reads as centre
   * rather than as whichever side rounding put it on.
   */
  private panOf(x: number, y: number, z: number, dist: number): number {
    if (dist < 1) return 0;
    const dx = x - this.lx, dy = y - this.ly, dz = z - this.lz;
    const r = (dx * this.lrx + dy * this.lry + dz * this.lrz) / dist;
    return r < -1 ? -1 : r > 1 ? 1 : r;
  }

  // --- weapons -------------------------------------------------------------

  private playFire(a: Agg, t: number, now: number, dist: number, att: number, stack: number): void {
    const base = fireGain(a.code) * clamp(a.mag > 0 ? a.mag : 1, 0.4, 3);
    const amp = base * att * stack;
    if (amp < AUDIBLE_FLOOR) return;
    // Recorded transient under the synth body. Weapon code 4 is the ion lance
    // and 6 the torpedo — the two heavy mounts — so they take the large report;
    // 2 (mass driver) keeps the retro crack, everything else the small one.
    this.samples?.play(
      a.code === 4 || a.code === 6 ? 'laserLarge' : a.code === 2 ? 'laserRetro' : 'laserSmall',
      amp * 0.55, dist, this.panOf(a.x, a.y, a.z, dist),
      0.86 + this.rng.sign() * 0.10,
    );
    const v = this.alloc(amp, now);
    if (!v) return;
    const j = 1 + this.rng.sign() * 0.06; // one-shot pitch jitter

    switch (a.code) {
      case 1: { // pulse — short filtered zap
        v.begin(t, 0.16, amp, amp);
        this.prep(v, t, dist, a.x, a.y, a.z, 0.10);
        v.tone.type = 'bandpass';
        hold(v.tone.Q, t, 3.4);
        glide(v.tone.frequency, t, 2400 * j, 700 * j, 0.06);
        const o = this.osc(v, v.l0, 'sawtooth', 900 * j, t, 0.13);
        if (o) glide(o.frequency, t, 900 * j, 260 * j, 0.06);
        adsr(v.l0.gain, t, 0.6, 0.003, 0.085);
        this.noise(v, v.l1, t, 0.04);
        adsr(v.l1.gain, t, 0.3, 0.001, 0.03);
        break;
      }
      case 2: { // massdriver — punchy thump with a hard pitch drop
        v.begin(t, 0.45, amp, amp);
        this.prep(v, t, dist, a.x, a.y, a.z, 0.20);
        v.tone.type = 'lowpass';
        hold(v.tone.Q, t, 1.0);
        glide(v.tone.frequency, t, 3200, 900, 0.18);
        const o = this.osc(v, v.l0, 'sine', 190 * j, t, 0.3);
        if (o) glide(o.frequency, t, 190 * j, 46 * j, 0.11);
        adsr(v.l0.gain, t, 1.0, 0.004, 0.2);
        const b = this.osc(v, v.l2, 'triangle', 95 * j, t, 0.4);
        if (b) glide(b.frequency, t, 95 * j, 36 * j, 0.16);
        adsr(v.l2.gain, t, 0.45, 0.006, 0.3);
        this.noise(v, v.l1, t, 0.06);
        adsr(v.l1.gain, t, 0.5, 0.001, 0.05);
        break;
      }
      case 3: { // flak — dirty airburst pop
        v.begin(t, 0.34, amp, amp);
        this.prep(v, t, dist, a.x, a.y, a.z, 0.24);
        v.tone.type = 'bandpass';
        hold(v.tone.Q, t, 1.3);
        glide(v.tone.frequency, t, 1500 * j, 520, 0.16);
        this.noise(v, v.l1, t, 0.18);
        adsr(v.l1.gain, t, 1.0, 0.002, 0.14);
        const o = this.osc(v, v.l0, 'sine', 150 * j, t, 0.28);
        if (o) glide(o.frequency, t, 150 * j, 58, 0.16);
        adsr(v.l0.gain, t, 0.5, 0.004, 0.18);
        break;
      }
      case 4: { // ion — rising resonant hum
        v.begin(t, 0.85, amp, amp);
        this.prep(v, t, dist, a.x, a.y, a.z, 0.30);
        v.tone.type = 'lowpass';
        hold(v.tone.Q, t, 11);
        glide(v.tone.frequency, t, 240, 2000 * j, 0.45);
        const o = this.osc(v, v.l0, 'sawtooth', 110 * j, t, 0.8);
        if (o) glide(o.frequency, t, 110 * j, 330 * j, 0.5);
        adsr(v.l0.gain, t, 0.55, 0.12, 0.55);
        const s = this.osc(v, v.l2, 'sine', 55 * j, t, 0.8);
        if (s) glide(s.frequency, t, 55 * j, 165 * j, 0.5);
        adsr(v.l2.gain, t, 0.4, 0.15, 0.55);
        break;
      }
      case 5: // missile
      case 6: { // torpedo — whoosh, torpedo is bigger and lower
        const big = a.code === 6;
        const dur = big ? 0.78 : 0.6;
        v.begin(t, dur, amp, amp);
        this.prep(v, t, dist, a.x, a.y, a.z, 0.22);
        v.tone.type = 'bandpass';
        hold(v.tone.Q, t, big ? 1.1 : 1.7);
        // Doppler-flavoured sweep up then down through the band.
        const f0 = big ? 240 : 380;
        const f1 = big ? 1500 : 2600;
        v.tone.frequency.cancelScheduledValues(t);
        v.tone.frequency.setValueAtTime(f0, t);
        v.tone.frequency.exponentialRampToValueAtTime(f1 * j, t + dur * 0.3);
        v.tone.frequency.exponentialRampToValueAtTime(f0 * 1.3, t + dur * 0.95);
        this.noise(v, v.l1, t, dur, big ? 0.7 : 1);
        adsr(v.l1.gain, t, 0.95, dur * 0.12, dur * 0.85);
        if (big) {
          const o = this.osc(v, v.l0, 'sine', 120, t, dur);
          if (o) glide(o.frequency, t, 120, 58, dur * 0.7);
          adsr(v.l0.gain, t, 0.5, 0.02, dur * 0.75);
        }
        break;
      }
      case 7: { // plasma — deep detuned boom
        v.begin(t, 0.9, amp, amp);
        this.prep(v, t, dist, a.x, a.y, a.z, 0.35);
        v.tone.type = 'lowpass';
        hold(v.tone.Q, t, 2.4);
        glide(v.tone.frequency, t, 950, 240, 0.4);
        const o1 = this.osc(v, v.l0, 'sawtooth', 84 * j, t, 0.85, -9);
        const o2 = this.osc(v, v.l0, 'sawtooth', 84 * j, t, 0.85, +11);
        if (o1) glide(o1.frequency, t, 84 * j, 38 * j, 0.35);
        if (o2) glide(o2.frequency, t, 84 * j, 39 * j, 0.35);
        adsr(v.l0.gain, t, 0.55, 0.008, 0.5);
        const s = this.osc(v, v.l2, 'sine', 52 * j, t, 0.85);
        if (s) glide(s.frequency, t, 52 * j, 26, 0.5);
        adsr(v.l2.gain, t, 0.9, 0.01, 0.6);
        this.noise(v, v.l1, t, 0.2);
        adsr(v.l1.gain, t, 0.4, 0.005, 0.17);
        break;
      }
      default: { // unknown / 'none' — generic click, keeps the sim honest
        v.begin(t, 0.12, amp, amp);
        this.prep(v, t, dist, a.x, a.y, a.z, 0.1);
        v.tone.type = 'bandpass';
        hold(v.tone.Q, t, 2);
        hold(v.tone.frequency, t, 1200);
        this.noise(v, v.l1, t, 0.05);
        adsr(v.l1.gain, t, 0.6, 0.001, 0.045);
        break;
      }
    }
  }

  // --- impacts -------------------------------------------------------------

  private playHit(a: Agg, t: number, now: number, dist: number, att: number, stack: number): void {
    const amp = 0.26 * clamp(a.mag > 0 ? a.mag : 1, 0.4, 3) * att * stack;
    if (amp < AUDIBLE_FLOOR) return;
    // `a.flag` is a shield hit; the rest are hull strikes.
    this.samples?.play(
      a.flag ? 'shield' : 'hitMetal',
      amp * 0.8, dist, this.panOf(a.x, a.y, a.z, dist),
      0.9 + this.rng.sign() * 0.14,
    );
    const v = this.alloc(amp, now);
    if (!v) return;
    const j = 1 + this.rng.sign() * 0.12;

    if (a.flag) {
      // Shield shimmer: bright inharmonic partials gliding slightly upward.
      v.begin(t, 0.5, amp, amp);
      this.prep(v, t, dist, a.x, a.y, a.z, 0.4);
      v.tone.type = 'highpass';
      hold(v.tone.Q, t, 0.7);
      hold(v.tone.frequency, t, 1100);
      const f = 2100 * j;
      const o1 = this.osc(v, v.l0, 'sine', f, t, 0.42);
      const o2 = this.osc(v, v.l0, 'sine', f * 1.51, t, 0.42);
      const o3 = this.osc(v, v.l0, 'sine', f * 2.24, t, 0.42);
      if (o1) glide(o1.frequency, t, f, f * 1.07, 0.16);
      if (o2) glide(o2.frequency, t, f * 1.51, f * 1.63, 0.16);
      if (o3) glide(o3.frequency, t, f * 2.24, f * 2.44, 0.16);
      adsr(v.l0.gain, t, 0.5, 0.006, 0.3);
      this.noise(v, v.l1, t, 0.09, 1.6);
      adsr(v.l1.gain, t, 0.22, 0.002, 0.07);
    } else {
      // Metallic clank: struck-plate partial series with a transient scrape.
      v.begin(t, 0.32, amp, amp);
      this.prep(v, t, dist, a.x, a.y, a.z, 0.2);
      v.tone.type = 'bandpass';
      hold(v.tone.Q, t, 0.9);
      glide(v.tone.frequency, t, 2600 * j, 1200, 0.12);
      const f = 520 * j;
      this.osc(v, v.l0, 'sine', f, t, 0.25);
      this.osc(v, v.l0, 'sine', f * 1.83, t, 0.22);
      this.osc(v, v.l0, 'sine', f * 2.67, t, 0.18);
      this.osc(v, v.l0, 'sine', f * 3.42, t, 0.14);
      adsr(v.l0.gain, t, 0.55, 0.001, 0.17);
      this.noise(v, v.l1, t, 0.05, 1.3);
      adsr(v.l1.gain, t, 0.5, 0.001, 0.04);
      const s = this.osc(v, v.l2, 'sine', 130 * j, t, 0.2);
      if (s) glide(s.frequency, t, 130 * j, 70, 0.12);
      adsr(v.l2.gain, t, 0.4, 0.003, 0.14);
    }
  }

  // --- deaths --------------------------------------------------------------

  /**
   * Three layers across two strips: sub-bass impulse + noise burst through a
   * resonant lowpass on the first, a long dark tail on the second (skipped if
   * the pool is busy — the tail is the least important part).
   */
  private playDeath(a: Agg, t: number, now: number, dist: number, att: number): void {
    // Bigger hulls: lower, louder, longer.
    const radius = clamp(a.mag > 0 ? a.mag : 20, 6, 400);
    const k = clamp(70 / radius, 0.3, 1.7); // pitch scalar
    const size = clamp(radius / 70, 0.45, 2.2); // loudness / length scalar
    const amp = clamp(0.62 * size, 0.2, 1.25) * att;
    if (amp < AUDIBLE_FLOOR) return;
    // Two samples on a capital kill: the crunch carries the debris, the low
    // frequency layer carries the mass. A fighter only gets the crunch.
    const pan = this.panOf(a.x, a.y, a.z, dist);
    this.samples?.play('explosion', amp * 0.85, dist, pan, clamp(k, 0.55, 1.4));
    if (size > 1.1) this.samples?.play('explosionDeep', amp * 0.7, dist, pan, 1);

    const v = this.alloc(amp * 2, now); // deaths outrank chatter when stealing
    if (!v) return;
    const j = 1 + this.rng.sign() * 0.08;
    const body = 1.1 * size;

    v.begin(t, body + 0.4, amp, amp * 2);
    this.prep(v, t, dist, a.x, a.y, a.z, 0.55);
    v.tone.type = 'lowpass';
    hold(v.tone.Q, t, 6);
    glide(v.tone.frequency, t, 2800, 170, body * 0.8);

    const sub = this.osc(v, v.l2, 'sine', 110 * k * j, t, body + 0.3);
    if (sub) glide(sub.frequency, t, 110 * k * j, 26, body * 0.5);
    adsr(v.l2.gain, t, 1.0, 0.006, body * 0.85);

    this.noise(v, v.l1, t, body, 0.9);
    adsr(v.l1.gain, t, 0.9, 0.004, body * 0.75);

    const rip = this.osc(v, v.l0, 'sawtooth', 180 * k * j, t, body);
    if (rip) glide(rip.frequency, t, 180 * k * j, 40 * k, body * 0.5);
    adsr(v.l0.gain, t, 0.35, 0.01, body * 0.55);

    // --- tail ---
    const tailAmp = amp * 0.55;
    if (tailAmp < AUDIBLE_FLOOR) return;
    const w = this.alloc(tailAmp, now);
    if (!w) return;
    const tail = 2.2 + 1.4 * size;
    w.begin(t, tail, tailAmp, tailAmp);
    this.prep(w, t, dist, a.x, a.y, a.z, 0.7);
    w.tone.type = 'lowpass';
    hold(w.tone.Q, t, 1.6);
    glide(w.tone.frequency, t, 800, 140, tail * 0.7);
    this.noise(w, w.l1, t, tail, 0.55);
    adsr(w.l1.gain, t, 0.45, 0.28, tail * 0.85);
    const drop = this.osc(w, w.l0, 'sine', 60 * k, t, tail);
    if (drop) glide(drop.frequency, t, 60 * k, 28, tail * 0.8);
    adsr(w.l0.gain, t, 0.3, 0.3, tail * 0.8);
  }

  // --- interface cues ------------------------------------------------------

  private playBuilt(t: number, now: number): void {
    if (now < this.nextBuilt) return;
    this.nextBuilt = now + 0.22;
    const amp = 0.2;
    this.samples?.play('built', amp * 1.1);
    const v = this.alloc(amp * 3, now); // UI cues must not be stolen easily
    if (!v) return;
    v.begin(t, 0.42, amp, amp * 3);
    this.prep(v, t, -1, 0, 0, 0, 0.15);
    v.tone.type = 'lowpass';
    hold(v.tone.Q, t, 0.8);
    hold(v.tone.frequency, t, 5200);
    this.osc(v, v.l0, 'sine', 622, t, 0.16);
    adsr(v.l0.gain, t, 0.5, 0.006, 0.12);
    this.osc(v, v.l2, 'sine', 932, t + 0.1, 0.24);
    adsr(v.l2.gain, t + 0.1, 0.42, 0.006, 0.2);
  }

  private playDelivered(a: Agg, t: number, now: number, dist: number, att: number): void {
    if (now < this.nextDelivered) return;
    this.nextDelivered = now + 0.3;
    // Deliveries happen far from the camera constantly, so the distance curve
    // is flattened — this is a soft economy confirmation, not a world sound.
    const amp = 0.14 * clamp(att * 2.2, 0.3, 1);
    this.samples?.play('uiConfirm', amp * 1.2);
    const v = this.alloc(amp * 2, now);
    if (!v) return;
    v.begin(t, 0.4, amp, amp * 2);
    this.prep(v, t, Math.min(dist, 3000), a.x, a.y, a.z, 0.2);
    v.tone.type = 'lowpass';
    hold(v.tone.Q, t, 0.7);
    hold(v.tone.frequency, t, 4200);
    this.osc(v, v.l0, 'triangle', 523, t, 0.14);
    adsr(v.l0.gain, t, 0.45, 0.005, 0.11);
    this.osc(v, v.l2, 'triangle', 784, t + 0.075, 0.22);
    adsr(v.l2.gain, t + 0.075, 0.4, 0.005, 0.17);
  }

  private playNotice(a: Agg, t: number, now: number): void {
    if (now < this.nextNotice) return;
    this.nextNotice = now + 0.15;
    const amp = a.code === 2 ? 0.3 : a.code === 1 ? 0.22 : 0.16;
    this.samples?.play(a.code === 2 ? 'uiError' : a.code === 1 ? 'uiSwitch' : 'notice', amp * 1.1);
    const v = this.alloc(amp * 4, now); // alerts win every steal contest
    if (!v) return;

    if (a.code === 2) {
      // Alert: descending low pair with a noise edge.
      v.begin(t, 0.75, amp, amp * 4);
      this.prep(v, t, -1, 0, 0, 0, 0.3);
      v.tone.type = 'lowpass';
      hold(v.tone.Q, t, 2.2);
      glide(v.tone.frequency, t, 1600, 700, 0.5);
      const o = this.osc(v, v.l0, 'sawtooth', 233, t, 0.3);
      if (o) glide(o.frequency, t, 233, 196, 0.26);
      adsr(v.l0.gain, t, 0.45, 0.01, 0.24);
      const p = this.osc(v, v.l2, 'sawtooth', 196, t + 0.26, 0.4);
      if (p) glide(p.frequency, t + 0.26, 196, 165, 0.3);
      adsr(v.l2.gain, t + 0.26, 0.45, 0.01, 0.3);
      this.noise(v, v.l1, t, 0.07, 0.6);
      adsr(v.l1.gain, t, 0.25, 0.004, 0.06);
    } else if (a.code === 1) {
      // Warn: flat two-tone.
      v.begin(t, 0.44, amp, amp * 4);
      this.prep(v, t, -1, 0, 0, 0, 0.2);
      v.tone.type = 'lowpass';
      hold(v.tone.Q, t, 0.7);
      hold(v.tone.frequency, t, 3600);
      this.osc(v, v.l0, 'square', 466, t, 0.13);
      adsr(v.l0.gain, t, 0.28, 0.005, 0.1);
      this.osc(v, v.l2, 'square', 466, t + 0.15, 0.22);
      adsr(v.l2.gain, t + 0.15, 0.28, 0.005, 0.16);
    } else {
      // Info: a single soft blip.
      v.begin(t, 0.24, amp, amp * 4);
      this.prep(v, t, -1, 0, 0, 0, 0.15);
      v.tone.type = 'lowpass';
      hold(v.tone.Q, t, 0.7);
      hold(v.tone.frequency, t, 5000);
      this.osc(v, v.l0, 'sine', 880, t, 0.2);
      adsr(v.l0.gain, t, 0.35, 0.004, 0.16);
    }
  }
}
