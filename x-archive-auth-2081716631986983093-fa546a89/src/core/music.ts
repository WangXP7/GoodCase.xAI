/**
 * MUSIC — a two-deck streaming score with crossfades and a combat state.
 *
 * WHY THIS IS NOT SYNTHESISED. Everything else the game makes a noise with is
 * generated from oscillators, and for gunfire and hull impacts that is the
 * right call: those are short, need to be spatialised, and there are hundreds
 * of them a second. A SCORE is the opposite of that — one long, slowly evolving
 * stereo bed with real instruments and a composer's arrangement — and a pair of
 * detuned sawtooths standing in for it is exactly the "mixed bag" the score was
 * reported as. It is streamed from disk instead.
 *
 * ARCHITECTURE
 *
 *   <audio> deck A ─► MediaElementSource ─► deck gain A ─┐
 *                                                        ├─► music bus (owned by audio.ts)
 *   <audio> deck B ─► MediaElementSource ─► deck gain B ─┘
 *
 * Two decks, because a crossfade needs both tracks audible at once. Media
 * elements STREAM: nothing is decoded up front, so a 7 MB track costs one HTTP
 * request and no memory spike, which is why the score is `<audio>` and the
 * effects (below, in `samples.ts`) are decoded buffers.
 *
 * STATE. The director is told the combat intensity each frame and picks a
 * playlist from it. Both edges are guarded, because a score that switches on
 * every stray shot is worse than one that never switches:
 *
 *   - hysteresis: entering combat needs a higher intensity than staying in it;
 *   - a minimum dwell time in each state, so a single skirmish cannot start a
 *     fade it immediately has to reverse.
 *
 * Everything degrades to silence. No WebAudio, autoplay refused, a 404 on a
 * track: the game keeps running and this module simply never makes a sound.
 */

/** Crossfade duration between tracks, seconds. */
const FADE = 3.5;

/** Start the crossfade into the next track this long before the current ends. */
const TAIL = 6.0;

/** Intensity at or above which the score switches to the combat playlist. */
const COMBAT_ENTER = 0.55;

/** Intensity at or below which it returns to the calm playlist. */
const COMBAT_LEAVE = 0.28;

/** Minimum seconds in a state before the other one may be entered. */
const DWELL = 24;

/** Gap of silence between tracks in the calm playlist, seconds. */
const CALM_GAP = 6;

export interface MusicTrack {
  /** Path under `public/`. */
  url: string;
  /** Display title, for the credits screen. */
  title: string;
  /** Who made it. CC0 does not require this; it is given anyway. */
  author: string;
  /** Where it came from. */
  source: string;
}

/**
 * The score. Every track is CC0 (public domain); the authors are carried on the
 * records because the credits menu renders straight out of these arrays.
 *
 * TRACKS ARE CHOSEN BY MEASUREMENT, not by title. "The background music sounds
 * like sea waves — this is space." Surf is broadband noise under a slow, deep
 * loudness swell, so both halves of that were measured on every candidate:
 *
 *   - CV of the half-second RMS envelope: how hard the track breathes.
 *   - Mean level above 3.5 kHz relative to the whole band: how much hiss rides
 *     on top of the breathing.
 *
 * The two tracks that were dropped scored worst on exactly those axes —
 * "Observing the Star" at CV 0.67 and "Space Graveyard" at CV 0.68 with only
 * 13.9 dB of high-frequency rolloff, which is a shore. What is here now sits at
 * CV 0.28-0.50 with 22-32 dB of rolloff: steady, dark, tonal.
 */
export const CALM_TRACKS: readonly MusicTrack[] = [
  {
    url: 'audio/music/spacelife-14.ogg', title: 'Spacelife No. 14',
    author: 'yd', source: 'https://opengameart.org/content/spacelife-14',
  },
  {
    url: 'audio/music/galactic-temple.ogg', title: 'Galactic Temple',
    author: 'yd', source: 'https://opengameart.org/content/galactic-temple',
  },
  {
    url: 'audio/music/steller-dreams.ogg', title: 'Stellar Dreams',
    author: 'Synth-thetic', source: 'https://opengameart.org/content/steller-dreams',
  },
  {
    url: 'audio/music/deep-space-array.ogg', title: 'Deep Space Array',
    author: 'Tozan', source: 'https://opengameart.org/content/deep-space-array',
  },
];

export const COMBAT_TRACKS: readonly MusicTrack[] = [
  {
    url: 'audio/music/claimed-by-the-void.ogg', title: 'Claimed by the Void',
    author: 'vitalezzz', source: 'https://opengameart.org/content/claimed-by-the-void',
  },
  {
    url: 'audio/music/exploration-theme.ogg', title: 'Exploration Theme',
    author: 'CleytonKauffman', source: 'https://opengameart.org/content/exploration-theme',
  },
];

interface Deck {
  el: HTMLAudioElement;
  gain: GainNode;
  /** Track index inside its playlist, or -1 when the deck is free. */
  playing: boolean;
}

export class MusicDirector {
  private readonly decks: Deck[] = [];
  /** Index of the deck currently carrying the score. */
  private active = -1;
  private combat = false;
  private stateFor = DWELL;
  private order: number[] = [];
  private orderPos = 0;
  private orderCombat = false;
  private gap = 0;
  private started = false;
  private volume = 1;

  /**
   * @param ctx  the game's AudioContext.
   * @param bus  the music bus; master and music volume are applied there, so
   *             this module only ever touches its own two deck gains.
   */
  /**
   * Called when a track actually starts. The score is streamed and shuffled, so
   * this is the only moment at which anything can know what is playing — which
   * is what the on-screen credit line hangs off.
   */
  onTrack: ((t: MusicTrack) => void) | null = null;

  constructor(
    private readonly ctx: AudioContext,
    private readonly bus: AudioNode,
    private readonly base = '',
  ) {
    for (let i = 0; i < 2; i++) {
      const el = new Audio();
      el.preload = 'none';
      el.crossOrigin = 'anonymous';
      // The director drives the sequence itself; letting the element loop would
      // hide the end of the track from the crossfade scheduler.
      el.loop = false;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      let node: MediaElementAudioSourceNode;
      try {
        node = ctx.createMediaElementSource(el);
      } catch {
        // Some browsers refuse a second source for the same element. Without a
        // route to the bus this deck is useless, so leave it silent.
        continue;
      }
      node.connect(gain);
      gain.connect(bus);
      this.decks.push({ el, gain, playing: false });
    }
  }

  /** Master scalar applied on top of the music bus, 0..1. */
  setVolume(v: number): void {
    this.volume = v < 0 ? 0 : v > 1 ? 1 : v;
    const d = this.decks[this.active];
    if (d && d.playing) this.rampTo(d.gain, this.volume, 0.4);
  }

  /**
   * @param dt         seconds since the last call.
   * @param intensity  combat intensity, 0..1 (audio.ts already smooths it).
   */
  update(dt: number, intensity: number): void {
    if (this.decks.length === 0) return;
    if (this.ctx.state !== 'running') return;

    this.stateFor += dt;

    // -- state, with hysteresis and a dwell floor ----------------------------
    if (this.stateFor >= DWELL) {
      const want = this.combat ? intensity > COMBAT_LEAVE : intensity >= COMBAT_ENTER;
      if (want !== this.combat) {
        this.combat = want;
        this.stateFor = 0;
        // Cut straight to the other playlist: the point of a combat score is
        // that it arrives when the fight does.
        this.advance();
        return;
      }
    }

    if (!this.started) {
      this.started = true;
      this.advance();
      return;
    }

    if (this.gap > 0) {
      this.gap -= dt;
      if (this.gap <= 0) this.advance();
      return;
    }

    // -- schedule the next track before this one runs out ---------------------
    const d = this.decks[this.active];
    if (!d || !d.playing) return;
    const dur = d.el.duration;
    if (!isFinite(dur) || dur <= 0) return;          // still loading its header
    const left = dur - d.el.currentTime;
    if (left <= TAIL) {
      // A calm track ends into a short silence; a combat track runs straight on
      // so the pressure never lets up.
      if (!this.combat) {
        this.fadeOut(d);
        this.active = -1;
        this.gap = Math.max(0.1, left) + CALM_GAP;
      } else {
        this.advance();
      }
    }
  }

  /** Stop everything and release both decks. */
  dispose(): void {
    for (const d of this.decks) {
      d.el.pause();
      d.el.src = '';
      d.gain.disconnect();
      d.playing = false;
    }
    this.decks.length = 0;
    this.active = -1;
  }

  // -------------------------------------------------------------------------

  /** Fade the current track out and bring the next one up on the other deck. */
  private advance(): void {
    const list = this.combat ? COMBAT_TRACKS : CALM_TRACKS;
    if (this.orderCombat !== this.combat || this.orderPos >= this.order.length) {
      this.reshuffle(list.length);
      this.orderCombat = this.combat;
    }
    const track = list[this.order[this.orderPos++] ?? 0];
    if (!track) return;

    const prev = this.decks[this.active];
    const next = this.decks[(this.active + 1) % this.decks.length] ?? this.decks[0];
    if (!next) return;
    if (prev && prev !== next) this.fadeOut(prev);

    next.el.src = this.base + track.url;
    next.gain.gain.cancelScheduledValues(this.ctx.currentTime);
    next.gain.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    // `play` rejects when the user has not interacted with the page yet. That
    // is normal and not an error: the next call picks it up once the context
    // has been resumed by a click.
    const p = next.el.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => { next.playing = false; this.started = false; });
    }
    next.playing = true;
    this.active = this.decks.indexOf(next);
    this.onTrack?.(track);
    this.rampTo(next.gain, this.volume, FADE);
    this.gap = 0;
  }

  private fadeOut(d: Deck): void {
    if (!d.playing) return;
    this.rampTo(d.gain, 0, FADE);
    const el = d.el;
    d.playing = false;
    window.setTimeout(() => { el.pause(); }, FADE * 1000 + 200);
  }

  private rampTo(g: GainNode, v: number, seconds: number): void {
    const t = this.ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t);
    // Exponential, because loudness is perceived logarithmically and a linear
    // fade sounds like it holds level and then drops off a cliff at the end.
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, v), t + seconds);
    if (v <= 0) g.gain.setValueAtTime(0, t + seconds + 0.01);
  }

  /**
   * A fresh play order. Shuffled rather than sequential so two sessions do not
   * open on the same track, and the previous last track is never first, so a
   * playlist that has cycled does not repeat one track back to back.
   */
  private reshuffle(n: number): void {
    const last = this.order.length > 0 ? this.order[this.order.length - 1] : -1;
    this.order = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = this.order[i]; this.order[i] = this.order[j]; this.order[j] = t;
    }
    if (n > 1 && this.order[0] === last) {
      const t = this.order[0]; this.order[0] = this.order[1]; this.order[1] = t;
    }
    this.orderPos = 0;
  }
}
