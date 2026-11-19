/**
 * SAMPLES — recorded one-shots, layered on top of the synthesised effects.
 *
 * WHY BOTH. The synthesised layer in `audio.ts` does things a sample cannot:
 * it clusters a sixty-gun broadside into one report instead of sixty phase-
 * cancelling copies, it scales the envelope with the calibre of the weapon, and
 * it costs nothing to have four hundred of them a minute. What it cannot do is
 * sound like a RECORDING — the transient of a real impact, the grit in an
 * explosion tail. So the sample is a layer under the synth voice, not a
 * replacement for it: the synth keeps supplying the body and the spatialisation
 * budget, the sample supplies the attack and the texture.
 *
 * Every file here is CC0. The sources are in `SFX_PACKS` below, which is also
 * what the in-game credits screen renders from — there is no separate document
 * to keep in step.
 *
 * GRAPH. One shared chain per one-shot, built and thrown away per play:
 *
 *   BufferSource ─► gain ─► lowpass ─► panner ─► sfx bus
 *
 * The lowpass closes with distance for the same reason the synth path does: the
 * battlespace is tens of kilometres across and a distant event must read as
 * distant, which is a spectral cue long before it is a level cue.
 *
 * LOADING is lazy, parallel and entirely optional. Nothing waits on it, nothing
 * fails if a file is missing, and until a buffer has arrived its `play` is a
 * no-op — the synth layer is already carrying the event on its own.
 */

/** Ceiling on simultaneous sample voices. Past this, new plays are dropped. */
const VOICE_CAP = 24;

/** Distance at which a sample is fully muffled, metres. */
const FAR = 9000;

/** Lowpass cutoff at zero distance and at `FAR`, Hz. */
const LPF_NEAR = 20000;
const LPF_FAR = 620;

/**
 * The bank. Keys are what the game asks for; values are the files that may
 * answer, picked at random so a repeated event is never literally the same
 * recording twice in a row.
 */
export const BANK: Record<string, readonly string[]> = {
  laserSmall: ['laserSmall_000', 'laserSmall_002', 'laserSmall_004'],
  laserLarge: ['laserLarge_000', 'laserLarge_002', 'laserLarge_003'],
  laserRetro: ['laserRetro_001', 'laserRetro_003'],
  explosion: ['explosionCrunch_000', 'explosionCrunch_002', 'explosionCrunch_004'],
  explosionDeep: ['lowFrequency_explosion_000', 'lowFrequency_explosion_001'],
  shield: ['forceField_000', 'forceField_003'],
  hitMetal: ['impactMetal_000', 'impactMetal_002', 'impactMetal_004'],
  hitHeavy: ['impactMetal_heavy_001', 'impactPlate_heavy_002'],
  hitMedium: ['impactMetal_medium_003'],
  // --- acknowledgements: the sound the interface makes back at the player ---
  // These were the whole gap. The game answered gunfire and deaths and said
  // nothing at all when you selected a ship, gave it an order, or pressed a
  // button — so half of every interaction was silent and the half that was not
  // was all somebody else's guns.
  uiClick: ['click_001', 'click_002', 'click_004'],
  uiSelect: ['select_001', 'select_002', 'select_003'],
  uiConfirm: ['confirmation_001', 'confirmation_002', 'confirmation_004'],
  uiSwitch: ['switch_002', 'switch_004'],
  uiError: ['error_003'],
  uiBack: ['back_002', 'close_002'],
  /** Unit acknowledges a move / attack order. */
  ackOrder: ['drop_002', 'tick_002'],
  /** Unit acknowledges selection. */
  ackSelect: ['glass_002', 'question_002'],
  /** Production queued. */
  queued: ['bong_001'],
  built: ['doorOpen_002'],
  research: ['confirmation_004'],
  /**
   * INFO notices, and they are frequent — every log line the game writes.
   *
   * This was Kenney's `computerNoise`, a half-second burst of modem chatter.
   * Fired on an ordinary notice it is the "random dodododdo beepbeepbeep at
   * times" the player could not place: it sounds like a machine reporting a
   * fault, at moments when nothing was wrong, with no visible cause. An
   * acknowledgement for a routine event has to be SHORT and boring, or the
   * player starts hunting for what they broke. Both computerNoise files are
   * gone from the build so they cannot come back by accident.
   */
  notice: ['back_002'],
  dock: ['doorClose_001'],

  // --- engine beds: looped, one voice per class band ------------------------
  engineSmall: ['spaceEngine_001'],
  engineMedium: ['spaceEngineLow_002'],
  engineLarge: ['spaceEngineLarge_001'],
  thruster: ['thrusterFire_002'],
};

/**
 * Where the recordings came from. The credits menu reads this, so the list
 * lives next to the bank it describes rather than in the UI layer, where it
 * would drift the first time a pack changed.
 */
export const SFX_PACKS: readonly { title: string; author: string; source: string; use: string }[] = [
  {
    title: 'Sci-Fi Sounds', author: 'Kenney', source: 'https://kenney.nl/assets/sci-fi-sounds',
    use: 'lasers, explosions, force fields, metal impacts',
  },
  {
    title: 'Impact Sounds', author: 'Kenney', source: 'https://kenney.nl/assets/impact-sounds',
    use: 'heavy plate and metal strikes',
  },
  {
    title: 'Interface Sounds', author: 'Kenney', source: 'https://kenney.nl/assets/interface-sounds',
    use: 'clicks, confirmations, alerts',
  },
];

export class SampleBank {
  private readonly buffers = new Map<string, AudioBuffer>();
  private live = 0;
  private ready = false;

  constructor(
    private readonly ctx: AudioContext,
    private readonly dest: AudioNode,
    private readonly base = '',
  ) {}

  /**
   * Fetch and decode every file in the bank. Safe to call once; failures are
   * swallowed per file so one missing asset cannot take the rest down.
   */
  async load(): Promise<void> {
    if (this.ready) return;
    this.ready = true;
    const names = new Set<string>();
    for (const list of Object.values(BANK)) for (const n of list) names.add(n);
    await Promise.all([...names].map(async (name) => {
      try {
        const res = await fetch(`${this.base}audio/sfx/${name}.ogg`);
        if (!res.ok) return;
        const raw = await res.arrayBuffer();
        this.buffers.set(name, await this.ctx.decodeAudioData(raw));
      } catch {
        /* a missing or undecodable sample simply never plays */
      }
    }));
  }

  /** True once at least one buffer has arrived. */
  get loaded(): boolean {
    return this.buffers.size > 0;
  }

  /**
   * Play one shot from `key`.
   *
   * @param gain      linear level before distance attenuation.
   * @param dist      distance from the listener, metres. 0 for UI sounds.
   * @param pan       -1 hard left .. +1 hard right. 0 for UI sounds.
   * @param rate      playback rate; also shifts pitch, so it doubles as the
   *                  "this is a bigger gun" control.
   */
  play(key: string, gain: number, dist = 0, pan = 0, rate = 1): void {
    if (this.live >= VOICE_CAP) return;
    const list = BANK[key];
    if (!list || list.length === 0) return;
    const buf = this.buffers.get(list[(Math.random() * list.length) | 0]);
    if (!buf) return;
    const ctx = this.ctx;
    if (ctx.state !== 'running') return;

    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;

    const g = ctx.createGain();
    // Inverse-square would take a 9 km event to nothing; the game needs the far
    // field audible-but-distant, so the curve is deliberately shallower.
    const att = 1 / (1 + (dist / 900) ** 1.35);
    g.gain.value = Math.max(0, gain) * att;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    const k = Math.min(1, dist / FAR);
    lp.frequency.value = LPF_NEAR + (LPF_FAR - LPF_NEAR) * k;

    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    src.connect(g);
    g.connect(lp);
    if (p) {
      p.pan.value = pan < -1 ? -1 : pan > 1 ? 1 : pan;
      lp.connect(p);
      p.connect(this.dest);
    } else {
      lp.connect(this.dest);
    }

    this.live++;
    src.onended = (): void => {
      this.live--;
      src.disconnect();
      g.disconnect();
      lp.disconnect();
      p?.disconnect();
    };
    src.start(t);
  }

  /**
   * A looping voice, for the engine bed.
   *
   * Distinct from `play` because a loop is not fire-and-forget: the caller has
   * to be able to keep changing its level and pitch as the ship it belongs to
   * throttles up, turns and flies away. Returns null if the buffer has not
   * arrived, so the caller must handle "no loop yet" rather than assume one.
   */
  loop(key: string, rate = 1): EngineLoop | null {
    const list = BANK[key];
    if (!list || list.length === 0) return null;
    const buf = this.buffers.get(list[0]);
    if (!buf) return null;
    const ctx = this.ctx;
    if (ctx.state !== 'running') return null;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = rate;
    // Start at a random offset so two ships of the same class are never in
    // phase — identical loops in lockstep is the single most obvious way for a
    // fleet to sound synthetic.
    const g = ctx.createGain();
    g.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = LPF_NEAR;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    src.connect(g);
    g.connect(lp);
    if (p) { lp.connect(p); p.connect(this.dest); } else { lp.connect(this.dest); }
    src.start(ctx.currentTime, Math.random() * buf.duration);
    return new EngineLoop(ctx, src, g, lp, p);
  }

  dispose(): void {
    this.buffers.clear();
    this.live = 0;
  }
}

/** Handle on one looping engine voice. */
export class EngineLoop {
  constructor(
    private readonly ctx: AudioContext,
    private readonly src: AudioBufferSourceNode,
    private readonly gain: GainNode,
    private readonly lp: BiquadFilterNode,
    private readonly pan: StereoPannerNode | null,
  ) {}

  /**
   * @param level  linear gain BEFORE distance attenuation.
   * @param dist   metres from the listener.
   * @param ref    the range at which a drive should still be clearly audible.
   *               NOT a constant: an RTS camera legitimately sits anywhere from
   *               400 m to 40 km out, and a fixed falloff means the engine bed
   *               is either deafening when zoomed in or silent when zoomed out.
   *               The caller passes the range to the closest drive it is
   *               tracking, so the mix follows the camera the way the visual LOD
   *               already does.
   * @param pan    -1..+1.
   * @param rate   playback rate; throttle raises the pitch of a drive.
   */
  set(level: number, dist: number, ref: number, pan: number, rate: number): void {
    const t = this.ctx.currentTime;
    const att = 1 / (1 + (dist / Math.max(200, ref)) ** 1.5);
    // setTargetAtTime, not a step: an engine that jumps level every frame
    // crackles, and the whole point of the bed is that it is continuous.
    this.gain.gain.setTargetAtTime(Math.max(0, level) * att, t, 0.12);
    const k = Math.min(1, dist / Math.max(FAR, ref * 6));
    this.lp.frequency.setTargetAtTime(LPF_NEAR + (LPF_FAR - LPF_NEAR) * k, t, 0.2);
    if (this.pan) this.pan.pan.setTargetAtTime(pan < -1 ? -1 : pan > 1 ? 1 : pan, t, 0.15);
    this.src.playbackRate.setTargetAtTime(rate, t, 0.25);
  }

  stop(): void {
    const t = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setTargetAtTime(0, t, 0.15);
    try {
      this.src.stop(t + 0.6);
    } catch {
      /* already stopped */
    }
    window.setTimeout(() => {
      this.src.disconnect();
      this.gain.disconnect();
      this.lp.disconnect();
      this.pan?.disconnect();
    }, 900);
  }
}
