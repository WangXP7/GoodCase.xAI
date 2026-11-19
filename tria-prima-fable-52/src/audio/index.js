// The sound of Tria Prima. Everything is synthesised with the Web Audio API: no files.
//
//   const audio = createAudio();
//   audio.unlock();            // from a user gesture; nothing exists before this. Called too
//                              // early, it still works: the next key or click sets it going
//
// The contract is docs/DESIGN.md section 6. Additions to it:
//   audio.setPaused(bool)      world, ambience and score step back (quieter, behind a low-pass);
//                              nothing is stopped or dropped, and ui sounds stay as they are
//   a hidden page              suspends everything by itself until it is shown again
//                              (createAudio({ background: true }) to keep sounding)
//   setAmbience height         metres above the sea
//   audio.update(dt)           call it every frame; when the game does not (a paused loop, a
//                              menu), the engine keeps its own time and the score goes on
//   audio.debug()              { state, voices, loops, live, made, sways, mood, ... }
//   audio.meter()              { peak, rms } of the last ~40 ms on the output
//   audio.names()              every name the engine knows
//   audio.dispose()            close the context
//   positions may be [x, y, z] or anything with .x .y .z
//
// For checking without ears (tools/audio-check.mjs) the same engine runs on an OfflineAudioContext:
//   createAudio({ context, seed, mute: ['amb', 'music', 'reverb', ...], bypassLimiter })
//   audio.sfx(name, { at }), handle.set(o, at), handle.stop(fade, at), audio.setMusic(mood, { at })
//   audio.advance(seconds)     schedule music, ambience events and loops up to that time
//
// For filming (tools/film.mjs) the engine runs as it does in the game, update() and all, on an
// OfflineAudioContext that the tool moves forward one frame at a time:
//   audio.drive(context)       instead of unlock(), before anything has sounded
//
// Signal flow:
//   one-shot / loop -> [air low-pass -> ears] ──> sfx bus ──┐
//   ui sounds ───────────────────────────────> ui bus ──────┤
//   ambience beds and events ────────────────> amb bus ─────┼─> compressor -> soft clip -> master
//   music ensembles ─────────────────────────> music bus ───┤
//   every bus has a send ──> reverb (computed impulse) ─────┘
import { Synth, clamp } from './dsp.js';
import { SFX, SFX_NAMES, SURFACES } from './sfx.js';
import { LOOPS, LOOP_NAMES } from './loops.js';
import { createAmbience } from './ambience.js';
import { createMusic, MOOD_NAMES } from './music.js';

const MAX_VOICES = 28; // one-shots sounding at once; beyond this the least important, oldest one is faded
const MAX_LOOPS = 14; // loops with real nodes behind them; the rest wait until the listener comes near
const REGIONS = ['shore', 'vale', 'saltwood', 'mere', 'scar', 'heights'];

// Mix levels of the buses and of the reverb return (set with tools/audio-check.mjs).
const MIX = { sfx: 1, ui: 0.85, amb: 0.32, music: 1, reverb: 1.3 };
// The limiter: a compressor that only works on the loud moments, then a soft clip as the ceiling.
const COMP = { threshold: -12, knee: 8, ratio: 6, attack: 0.005, release: 0.2 };
// While the game is paused: what is left of each bus, and where the curtain's low-pass closes to.
const PAUSED = { sfx: 0.35, amb: 0.5, music: 0.6, cut: 900 };
const COMP_MAKEUP = 1.648; // gain the compressor node adds by itself below its threshold (measured)
const SOFT_IN = Math.tanh(1.6) / 1.6; // makes the 'soft' curve unity for quiet signals
const CEILING = 0.94;
/** For the checking tools. */
export const MASTER = { MIX, COMP, COMP_MAKEUP, SOFT_IN, CEILING, MAX_VOICES, MAX_LOOPS };

const taper = (v) => v * v; // slider position -> gain
const num = (v, dflt, lo, hi) => {
  v = Number(v);
  return Number.isFinite(v) ? clamp(v, lo, hi) : dflt;
};
function vec(p) {
  if (p == null) return null;
  const a = Array.isArray(p) || ArrayBuffer.isView(p) ? p : [p.x, p.y, p.z];
  const x = +a[0],
    y = +a[1],
    z = +a[2];
  return Number.isFinite(x + y + z) ? [x, y, z] : null;
}
// Air swallows the highs of far sounds.
const airCut = (d) => (d <= 12 ? 20000 : clamp(20000 * Math.exp(-(d - 12) / 45), 900, 20000));
// Placing sounds. Closer than NEAR metres, left and right stop meaning much; EARS_TC is how fast a
// voice follows a turning head (seconds).
const NEAR = 0.6;
const EARS_TC = 0.035;
const GESTURES = ['pointerdown', 'keydown', 'touchend'];
const INERT = { set() {}, stop() {} };

export function createAudio(opts = {}) {
  const warned = new Set();
  const warnOnce = (key, ...msg) => {
    if (warned.has(key)) return;
    warned.add(key);
    console.warn('[audio]', ...msg);
  };
  // Sound must never take the game down with it.
  const guard = (name, fn, fallback) => (...a) => {
    try {
      return fn(...a);
    } catch (e) {
      warnOnce('fail:' + name, name + ' failed:', e);
      return fallback;
    }
  };

  // What the game has asked for. Kept from before unlock, and kept current afterwards.
  const vol = { master: 0.8, music: 0.7, sfx: 0.9 };
  const amb = {};
  const mus = { mood: 'none', intensity: 0.5 };
  const lis = { p: [0, 0, 0], f: [0, 0, -1] };
  const handles = new Set();
  const muted = new Set(opts.mute || []);
  let paused = false;
  let dead = false;
  let E = null; // the running engine

  // --- start -------------------------------------------------------------------------------------
  function start(ctx, offline, driven = false) {
    const seed = offline || driven ? opts.seed ?? 1 : ((Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0) || 1;
    const S = new Synth(ctx, seed);
    const t0 = ctx.currentTime;

    const pre = S.gain(1);
    const master = S.gain(muted.has('master') ? 0 : taper(vol.master));
    if (opts.bypassLimiter) pre.connect(master);
    else {
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = COMP.threshold;
      comp.knee.value = COMP.knee;
      comp.ratio.value = COMP.ratio;
      comp.attack.value = COMP.attack;
      comp.release.value = COMP.release;
      S.chain(pre, comp, S.gain(SOFT_IN / COMP_MAKEUP), S.shaper('soft', '2x'), S.gain(CEILING), master);
    }
    master.connect(ctx.destination);

    const rvIn = S.gain(1);
    const conv = ctx.createConvolver();
    conv.buffer = S.impulse();
    S.chain(rvIn, conv, S.gain(muted.has('reverb') ? 0 : MIX.reverb), pre);

    // Everything except the interface passes through the curtain: a low-pass that stands wide open
    // (at 0.46 of the sample rate it takes nothing audible away) and closes while the game is paused.
    const curtain = [S.bq('lowpass', ctx.sampleRate), S.bq('lowpass', ctx.sampleRate)];
    curtain[0].connect(pre);
    curtain[1].connect(rvIn);
    const bus = {},
      wet = {};
    for (const k of ['sfx', 'ui', 'amb', 'music']) {
      bus[k] = S.gain(0);
      bus[k].connect(k === 'ui' ? pre : curtain[0]);
      wet[k] = S.gain(0);
      wet[k].connect(k === 'ui' ? rvIn : curtain[1]);
    }

    let analyser = null;
    if (!offline && !driven) {
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      master.connect(analyser);
    }

    E = {
      ctx, S, offline, driven, bus, wet, master, analyser, curtain,
      born: Date.now(),
      meterBuf: analyser ? new Float32Array(analyser.fftSize) : null,
      voices: [],
      dying: [],
      lastAt: new Map(),
      loopClock: 1,
      fed: -1e9, // when the game last called update()
      pulsed: 0,
      pulse: 0,
      volSent: '',
      musSent: '',
    };
    applyVolumes(true);
    E.ambience = createAmbience(S, bus.amb, wet.amb, t0);
    E.ambience.set(amb, true);
    E.music = createMusic(S, bus.music, wet.music);
    sendMusic(null);
    if (!offline && !driven) {
      warm();
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', settle);
      // A context made outside a user gesture is refused until there is one. Should unlock() have
      // been called too early, the next key or pointer press sets things going.
      if (typeof window !== 'undefined') for (const ev of GESTURES) window.addEventListener(ev, settle, { capture: true, passive: true });
      // The game drives the clock with update(). When it stops (its loop is paused, a menu is open,
      // nobody wired it) the engine keeps time by itself, further ahead because timers are coarse.
      E.pulse = setInterval(guard('pulse', () => {
        if (!E || dead) return;
        const t = performance.now();
        const dt = clamp((t - (E.pulsed || t)) / 1000, 0.02, 2);
        E.pulsed = t;
        if (t - E.fed > 250) tick(Math.min(dt, 0.25), clamp(dt * 3, 1.5, 5));
      }), 100);
    }
  }

  /**
   * Make the context run when it should and stand still when it should not. A hidden page stops
   * calling update(), and without this the beds and the drones would go on alone in the dark.
   */
  function settle() {
    if (!E || E.offline || E.driven || E.ctx.state === 'closed') return;
    const hidden = typeof document !== 'undefined' && document.hidden && !opts.background;
    if (hidden) {
      if (E.ctx.state === 'running') E.ctx.suspend();
    } else if (E.ctx.state !== 'running') E.ctx.resume().catch(() => {});
  }

  /** Build the computed textures a few at a time, so the first use of one does not stall a frame. */
  function warm() {
    const jobs = E.S.warmJobs();
    let i = 0;
    const step = () => {
      if (!E || i >= jobs.length) return;
      try {
        jobs[i++]();
      } catch (e) {
        /* it will be built on first use instead */
      }
      setTimeout(step, 40);
    };
    setTimeout(step, 250);
  }

  function unlock() {
    if (dead) return false;
    if (!E) {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) {
        warnOnce('none', 'Web Audio is not available; the game will be silent');
        dead = true;
        return false;
      }
      try {
        start(new AC({ latencyHint: 'interactive' }), false);
      } catch (e) {
        warnOnce('start', 'could not start:', e);
        try {
          if (E) E.ctx.close();
        } catch (e2) {
          /* nothing to close */
        }
        E = null;
        dead = true;
        return false;
      }
    }
    settle();
    return true;
  }
  /** Filming: start on a context that a tool renders a frame at a time. Its state is never asked. */
  function drive(context) {
    if (E || dead) return false;
    start(context, false, true);
    return true;
  }

  // --- volumes, and the pause ----------------------------------------------------------------------
  // Paused, the world and the score step back behind the curtain: quieter and muffled, but nothing
  // is stopped or dropped. The interface keeps its voice, so a menu still clicks and a volume
  // slider can still be judged by ear.
  function applyVolumes(immediate) {
    const key = `${vol.master}|${vol.music}|${vol.sfx}|${paused}`;
    if (key === E.volSent) return;
    E.volSent = key;
    const t = E.ctx.currentTime;
    const put = (p, v, tc = 0.04) => {
      if (immediate) p.value = v;
      else p.setTargetAtTime(v, t, tc);
    };
    const fx = taper(vol.sfx),
      mu = taper(vol.music);
    const levels = { sfx: MIX.sfx * fx, ui: MIX.ui * fx, amb: MIX.amb * fx, music: MIX.music * mu };
    for (const k of Object.keys(levels)) {
      const v = muted.has(k) ? 0 : levels[k] * (paused ? PAUSED[k] ?? 1 : 1);
      put(E.bus[k].gain, v);
      put(E.wet[k].gain, v);
    }
    for (const f of E.curtain) put(f.frequency, paused ? PAUSED.cut : E.ctx.sampleRate * 0.46, 0.1);
    put(E.master.gain, muted.has('master') ? 0 : taper(vol.master));
  }
  function setVolumes(v = {}) {
    for (const k of ['master', 'music', 'sfx']) if (v[k] != null) vol[k] = num(v[k], vol[k], 0, 1);
    if (E) applyVolumes(E.offline);
  }

  // --- where things are ----------------------------------------------------------------------------
  // The engine places sounds itself, with plain gains, instead of handing them to PannerNodes. A
  // PannerNode works out its geometry again for every sample for as long as the listener is being
  // moved, and in a game the listener is always being moved: measured in Chromium, forty panners
  // and a walking listener keep the audio thread 40 % busy, and nothing about how the listener is
  // moved (ramps, k-rate, plain values) brings that near what the same voices cost when placed here.
  function setListener(px, py, pz, fx, fy, fz) {
    if (Number.isFinite(px + py + pz)) lis.p = [px, py, pz];
    // only the heading matters for left and right: looking at the ground must not flip the world
    const h = Math.hypot(fx, fz);
    if (h > 1e-3) lis.f = [fx / h, 0, fz / h];
    if (E && E.offline) placeAll(E.ctx.currentTime);
  }

  /** Where a source at `pos` is for the listener: how far, how much of it arrives, how far to the right. */
  function locate(def, pos) {
    const dx = pos[0] - lis.p[0],
      dy = pos[1] - lis.p[1],
      dz = pos[2] - lis.p[2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    // -1 (left) .. 1 (right): the part of its direction that lies along the line through the ears.
    // The right-hand side of a heading (fx, 0, fz) is (-fz, 0, fx). Behind sounds like in front;
    // overhead, underfoot or within arm's reach is in the middle.
    const lat = (dz * lis.f[0] - dx * lis.f[2]) / Math.sqrt(dist * dist + NEAR * NEAR);
    return { dist, att: def.ref / Math.max(def.ref, dist), lat, fade: 1 };
  }
  /** How a source at `pos` reaches the listener, or null when it is out of earshot. */
  function hear(def, pos) {
    const h = locate(def, pos);
    if (!(h.dist < def.range)) return null;
    const u = clamp((def.range - h.dist) / (def.range * 0.25), 0, 1);
    h.fade = u * u * (3 - 2 * u);
    return h;
  }
  /**
   * The gains that put a voice in its place: [left, right, wide]. Left and right are an equal-power
   * pan of the inverse-distance level. `wide` is the voice as it is, in both ears: always a little
   * (one ear in silence is unpleasant on headphones), and more when the source is close, because a
   * fire at arm's length is not a point.
   */
  function ears(h) {
    const x = (Math.asin(clamp(h.lat, -1, 1)) / Math.PI + 0.5) * (Math.PI / 2);
    const near = h.att * h.att;
    const point = h.att * (0.75 - 0.35 * near);
    return [point * Math.cos(x), point * Math.sin(x), h.att * (0.18 + 0.25 * near)];
  }
  /** Move a placed voice to where it is now. Small changes are not worth an event. */
  function place(r, h, t, tc = EARS_TC) {
    const g = ears(h);
    for (let i = 0; i < 3; i++) {
      if (Math.abs(g[i] - r.sent[i]) < 0.001 + 0.004 * r.sent[i]) continue;
      r.sent[i] = g[i];
      r.ears[i].setTargetAtTime(g[i], t, tc);
    }
  }
  /** Once a frame: every voice that has a place is put where it now is for the ears. */
  function placeAll(t) {
    for (const c of E.voices) if (c.r.ears) place(c.r, locate(c.def, c.pos), t);
    for (const h of handles) if (h.r && h.r.ears && h.pos) place(h.r, locate(h.def, h.pos), t);
  }

  /**
   * Connect a voice to its bus. A voice with a place goes through an air filter, then to the ears
   * (see ears()), and its reverb send falls off more slowly than the direct sound, so far things
   * sound far.
   */
  function route(v, def, pos, h, busName, alwaysAir) {
    const S = E.S,
      ctx = E.ctx,
      out = E.bus[busName],
      r = { nodes: [v], air: null, ears: null, sent: null, send: null, spatial: !!pos };
    let tap = v;
    if (pos) {
      // always two channels, so that left and right are there to be weighed (a mono voice is in both)
      v.channelCountMode = 'explicit';
      if (alwaysAir || h.dist > 12) {
        r.air = S.bq('lowpass', airCut(h.dist));
        v.connect(r.air);
        tap = r.air;
        r.nodes.push(r.air);
      }
      const g = ears(h);
      const split = ctx.createChannelSplitter(2),
        join = ctx.createChannelMerger(2);
      const gl = S.gain(g[0]),
        gr = S.gain(g[1]),
        wide = S.gain(g[2]);
      tap.connect(split);
      split.connect(gl, 0);
      split.connect(gr, 1);
      gl.connect(join, 0, 0);
      gr.connect(join, 0, 1);
      join.connect(out);
      S.chain(tap, wide, out);
      r.ears = [gl.gain, gr.gain, wide.gain];
      r.sent = g;
      r.nodes.push(split, gl, gr, join, wide);
    } else v.connect(out);
    if (def.wet > 0) {
      r.send = S.gain(def.wet * (pos ? Math.sqrt(h.att) : 1));
      S.chain(tap, r.send, E.wet[busName]);
      r.nodes.push(r.send);
    }
    return r;
  }
  function drop(nodes) {
    for (const n of nodes) {
      try {
        n.disconnect();
      } catch (e) {
        /* already gone */
      }
    }
  }
  /** Forget voices that have finished. `ref` is the clock: now, or the scheduled time when offline. */
  function sweep(ref) {
    const { voices, dying, offline } = E;
    for (let i = voices.length - 1; i >= 0; i--) {
      const c = voices[i];
      if (c.end > ref) continue;
      voices.splice(i, 1);
      if (offline) continue;
      // stop whatever a recipe may have left running, and disconnect a moment later
      for (const s of c.srcs) {
        try {
          s.stop();
        } catch (e) {
          /* already stopped */
        }
      }
      dying.push({ nodes: c.nodes, at: ref + 0.1 });
    }
    for (let i = dying.length - 1; i >= 0; i--) {
      if (dying[i].at > ref) continue;
      if (!offline) drop(dying[i].nodes);
      dying.splice(i, 1);
    }
  }
  /** Make room for a new voice of priority `prio`. False if everything sounding matters more. */
  function steal(prio, t) {
    const { voices } = E;
    let best = -1;
    for (let i = 0; i < voices.length; i++) {
      const c = voices[i];
      if (c.prio > prio) continue;
      if (best < 0 || c.prio < voices[best].prio || (c.prio === voices[best].prio && c.t < voices[best].t)) best = i;
    }
    if (best < 0) return false;
    const c = voices.splice(best, 1)[0];
    c.v.gain.cancelScheduledValues(t);
    c.v.gain.setValueAtTime(c.g, t);
    c.v.gain.linearRampToValueAtTime(0, t + 0.03);
    for (const s of c.srcs) {
      try {
        s.stop(t + 0.05);
      } catch (e) {
        /* already stopped */
      }
    }
    E.dying.push({ nodes: c.nodes, at: t + 0.3 });
    return true;
  }

  // --- one-shots ---------------------------------------------------------------------------------
  function sfx(name, o = {}) {
    if (!E || dead) return;
    const def = SFX[name];
    if (!def) return warnOnce('sfx:' + name, `unknown sound "${name}"`);
    const { ctx, S, offline } = E;
    const now = ctx.currentTime;
    // nothing is queued while the context stands still: it would all go off at once on resume
    // (the first moments after unlock are the exception: the context is only just starting up)
    if (!offline && !E.driven && ctx.state !== 'running' && (now > 0 || Date.now() - E.born > 700)) return;
    let t = o.at ?? now + (offline ? 0.02 : 0.01);
    let g = num(o.gain, 1, 0, 4) * def.k;
    let pos = null,
      h = null;
    if (o.pos != null && def.bus !== 'ui') {
      pos = vec(o.pos);
      if (!pos) return warnOnce('pos:' + name, `"${name}" was given a position that is not a point`);
      h = hear(def, pos);
      if (!h) return;
      g *= h.fade;
      if (h.dist > 15) t += Math.min(0.45, h.dist / 340); // sound takes its time
    }
    if (g < 0.0005) return;
    const last = E.lastAt.get(name);
    if (last !== undefined && Math.abs(t - last) < def.gap) return;
    sweep(offline ? t : now);
    if (E.voices.length >= MAX_VOICES && !steal(def.prio, t)) return;
    E.lastAt.set(name, t);

    const v = S.gain(g);
    const r = route(v, def, pos, h, def.bus, false);
    let dur = 0.5;
    S.collect = [];
    try {
      dur = def.fn(S, v, t, { ...o, pitch: num(o.pitch, 1, 0.25, 4) }) || 0.5;
    } finally {
      r.srcs = S.collect;
      S.collect = null;
    }
    E.lastDur = dur;
    E.voices.push({ name, def, pos, r, prio: def.prio, t, end: t + dur + 0.25, v, g, nodes: r.nodes, srcs: r.srcs });
  }

  function footstep(surface, speed01 = 0.5) {
    let s = surface;
    if (!SURFACES.includes(s)) {
      warnOnce('surface:' + s, `unknown footstep surface "${s}", using dirt`);
      s = 'dirt';
    }
    const sp = num(speed01, 0.5, 0, 1);
    sfx('step_' + s, { gain: 0.4 + 0.6 * sp, pitch: 0.95 + 0.1 * sp });
  }

  // --- loops -------------------------------------------------------------------------------------
  function realise(h, t) {
    const S = E.S,
      def = h.def;
    const v = S.gain(0);
    const r = route(v, def, h.pos, h, 'sfx', true);
    r.v = v;
    r.inst = def.make(S, v, t);
    r.inst.set(h.param, t);
    if (h.pitch !== 1) r.inst.pitch(h.pitch, t);
    v.gain.setValueAtTime(0, t);
    v.gain.setTargetAtTime(h.gain * def.k * h.fade, t, 0.08);
    h.r = r;
  }
  function release(h, t, fade = 0.4) {
    const r = h.r;
    if (!r) return;
    h.r = null;
    r.v.gain.cancelScheduledValues(t);
    r.v.gain.setTargetAtTime(0, t, fade / 4);
    r.inst.stop(t + fade + 0.1);
    E.dying.push({ nodes: r.nodes, at: t + fade + 0.4 });
  }
  function levelLoop(h, t) {
    const r = h.r;
    r.v.gain.setTargetAtTime(h.gain * h.def.k * h.fade, t, 0.1);
    if (!r.spatial) return;
    r.air.frequency.setTargetAtTime(airCut(h.dist), t, 0.1);
    if (r.send) r.send.gain.setTargetAtTime(h.def.wet * Math.sqrt(h.att), t, 0.1);
  }
  /** Decide which loops deserve nodes: those in earshot, the most audible first. */
  function manageLoops(t) {
    const list = [];
    for (const h of handles) {
      const a = h.pos ? hear(h.def, h.pos) : null;
      if (h.pos) {
        h.dist = a ? a.dist : Infinity;
        h.fade = a ? a.fade : 0;
        h.att = a ? a.att : 0;
        h.lat = a ? a.lat : 0;
      } else {
        h.dist = 0;
        h.fade = 1;
        h.att = 1;
        h.lat = 0;
      }
      // a loop that is already sounding holds on to its place a little
      h.score = h.gain * h.def.k * h.fade * (h.pos ? h.att : 4) * (h.r ? 1.25 : 1);
      list.push(h);
    }
    list.sort((a, b) => b.score - a.score);
    let n = 0;
    for (const h of list) {
      if (h.score > 1e-5 && n < MAX_LOOPS) {
        n++;
        if (h.r && h.r.spatial !== !!h.pos) release(h, t, 0.1);
        if (!h.r) realise(h, t + 0.01);
        else levelLoop(h, t);
      } else if (h.r) release(h, t);
    }
  }

  function loop(name, o = {}) {
    const def = LOOPS[name];
    if (!def) {
      warnOnce('loop:' + name, `unknown loop "${name}"`);
      return INERT;
    }
    const h = { name, def, pos: vec(o.pos), gain: num(o.gain, 1, 0, 4), pitch: num(o.pitch, 1, 0.25, 4), param: num(o.param, 0.5, 0, 1), r: null, stopped: false, dist: 0, fade: 1, att: 1, score: 0 };
    handles.add(h);
    if (E) {
      if (E.offline) manageLoops(o.at ?? E.ctx.currentTime);
      else E.loopClock = 1; // look at the loops on the next update
    }
    return {
      set: guard('loop.set', (c = {}, at) => {
        if (h.stopped) return;
        const p = c.pos != null ? vec(c.pos) : null;
        if (p) h.pos = p;
        if (c.gain != null) h.gain = num(c.gain, h.gain, 0, 4);
        if (c.pitch != null) h.pitch = num(c.pitch, h.pitch, 0.25, 4);
        if (c.param != null) h.param = num(c.param, h.param, 0, 1);
        if (!E) return;
        const r = h.r;
        if (!r) {
          if (h.gain > 0) E.loopClock = 1;
          return;
        }
        const now = E.ctx.currentTime,
          t = at ?? now;
        if (c.param != null) r.inst.set(h.param, t);
        if (c.pitch != null) r.inst.pitch(h.pitch, t);
        if (c.gain != null) r.v.gain.setTargetAtTime(h.gain * def.k * h.fade, t, 0.06);
        // a moved loop is put in its new place on the next update(); offline, here and now
        if (p && r.ears && E.offline) place(r, locate(def, p), t);
      }),
      stop: guard('loop.stop', (fade = 0.3, at) => {
        if (h.stopped) return;
        h.stopped = true;
        handles.delete(h);
        if (E && h.r) release(h, at ?? E.ctx.currentTime, Math.max(0.02, Number(fade) || 0));
      }),
    };
  }

  // --- ambience and music ------------------------------------------------------------------------
  function setAmbience(a = {}) {
    a = { ...a };
    if (a.region != null && !REGIONS.includes(a.region)) {
      warnOnce('region:' + a.region, `unknown region "${a.region}"`);
      delete a.region;
    }
    // height comes in metres above the sea; the beds want how exposed the place is, 0..1
    if (a.height != null) a.height = clamp((Number(a.height) - 15) / 75, 0, 1) || 0;
    for (const k of Object.keys(a)) if (a[k] !== undefined) amb[k] = a[k];
    if (E) E.ambience.set(a, E.offline);
  }
  function sendMusic(at) {
    const key = `${mus.mood}|${mus.intensity.toFixed(2)}`;
    if (at == null && key === E.musSent) return;
    E.musSent = key;
    E.music.set(mus.mood, { intensity: mus.intensity }, at);
  }
  function setMusic(mood, o = {}) {
    if (!MOOD_NAMES.includes(mood)) return warnOnce('mood:' + mood, `unknown music mood "${mood}"`);
    mus.mood = mood;
    if (o.intensity != null) mus.intensity = num(o.intensity, mus.intensity, 0, 1);
    if (E) sendMusic(o.at ?? null);
  }

  // --- the clock ---------------------------------------------------------------------------------
  function update(dt = 1 / 60) {
    if (!E || dead || E.offline) return;
    E.fed = performance.now();
    tick(num(dt, 1 / 60, 0, 0.25), 1);
  }
  /** One step of the engine's clock: `dt` seconds have passed; schedule `ahead` seconds from now. */
  function tick(dt, ahead) {
    const now = E.ctx.currentTime;
    sweep(now);
    if (!E.driven && E.ctx.state !== 'running') return;
    E.ambience.tick(dt, now);
    E.ambience.advance(now + ahead, now);
    E.music.advance(now + ahead + 0.2, now);
    E.loopClock += dt;
    if (E.loopClock >= 0.1) {
      E.loopClock = 0;
      manageLoops(now);
    }
    placeAll(now);
    E.S.pump(now + ahead, now);
  }
  /** Offline only: schedule everything that starts before `until` seconds. */
  function advance(until) {
    if (!E) return;
    const now = E.ctx.currentTime;
    E.ambience.advance(until, now);
    E.music.advance(until, now);
    manageLoops(now);
    E.S.pump(until, now);
  }
  function setPaused(p) {
    paused = !!p;
    if (E) applyVolumes(E.offline);
  }

  // --- looking in --------------------------------------------------------------------------------
  function debug() {
    if (!E) return { unlocked: false, paused, dead, handles: handles.size, mood: mus.mood };
    let loops = 0;
    for (const h of handles) if (h.r) loops++;
    return {
      unlocked: true, paused, dead,
      state: E.ctx.state,
      time: E.ctx.currentTime,
      sampleRate: E.ctx.sampleRate,
      voices: E.voices.length,
      loops,
      handles: handles.size,
      dying: E.dying.length,
      live: E.S.live,
      made: E.S.made,
      sways: E.S.sways.length,
      lastDur: E.lastDur || 0,
      mood: E.music.mood,
      intensity: E.music.intensity,
      ambience: E.ambience.state,
    };
  }
  function meter() {
    if (!E || !E.analyser) return { peak: 0, rms: 0 };
    const d = E.meterBuf;
    E.analyser.getFloatTimeDomainData(d);
    let peak = 0,
      sum = 0;
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
      sum += d[i] * d[i];
    }
    return { peak, rms: Math.sqrt(sum / d.length) };
  }
  function dispose() {
    for (const h of handles) h.stopped = true;
    handles.clear();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', settle);
    if (typeof window !== 'undefined') for (const ev of GESTURES) window.removeEventListener(ev, settle, { capture: true });
    if (E && E.pulse) clearInterval(E.pulse);
    if (E && !E.offline && !E.driven && E.ctx.state !== 'closed') E.ctx.close();
    E = null;
    dead = true;
  }

  if (opts.context) start(opts.context, true);

  return {
    unlock: guard('unlock', unlock, false),
    drive: guard('drive', drive, false),
    setVolumes: guard('setVolumes', setVolumes),
    setListener: guard('setListener', setListener),
    sfx: guard('sfx', sfx),
    loop: guard('loop', loop, INERT),
    footstep: guard('footstep', footstep),
    setAmbience: guard('setAmbience', setAmbience),
    setMusic: guard('setMusic', setMusic),
    update: guard('update', update),
    setPaused: guard('setPaused', setPaused),
    advance,
    debug,
    meter: guard('meter', meter, { peak: 0, rms: 0 }),
    dispose: guard('dispose', dispose),
    names: () => ({ sfx: [...SFX_NAMES], loops: [...LOOP_NAMES], moods: [...MOOD_NAMES], surfaces: [...SURFACES], regions: [...REGIONS] }),
    get unlocked() {
      return !!E;
    },
    get context() {
      return E ? E.ctx : null;
    },
  };
}
