// The page's half of tools/film.mjs. It is put into the page before the game loads, and gives the
// tool one clock for everything that moves: the game (stepped by hand), timers, the animations of
// the interface, and the sound, so that a frame of film is exactly a sixtieth of a second of all four.
(() => {
  const real = {
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
    now: performance.now.bind(performance),
    date: Date.now.bind(Date),
    random: Math.random,
  };

  // --- timers ------------------------------------------------------------------------------------
  // Until the film starts they are the browser's own. From then on they wait for advance().
  const timers = new Map(); // id -> { id, fn, args, at, every, real }
  let seq = 1 << 24; // ids of our own, far from the browser's
  let frozen = false;
  let vnow = 0; // performance.now() once frozen
  let skew = 0; // Date.now() - performance.now()

  function arm(t) {
    t.real = real.setTimeout(() => fire(t), Math.max(0, t.at - real.now()));
  }
  function fire(t) {
    if (!timers.has(t.id)) return;
    if (t.every != null) {
      t.at += t.every;
      if (!frozen) arm(t);
    } else timers.delete(t.id);
    t.fn(...t.args);
  }
  function add(fn, delay, args, every) {
    if (typeof fn !== 'function') return 0;
    const d = Math.max(0, Number(delay) || 0);
    const t = { id: seq++, fn, args, at: (frozen ? vnow : real.now()) + d, every: every ? Math.max(1, d) : null, real: 0 };
    timers.set(t.id, t);
    if (!frozen) arm(t);
    return t.id;
  }
  const clear = (id) => {
    const t = timers.get(id);
    if (!t) return real.clearTimeout(id);
    real.clearTimeout(t.real);
    timers.delete(id);
  };
  window.setTimeout = (fn, d, ...a) => add(fn, d, a, false);
  window.setInterval = (fn, d, ...a) => add(fn, d, a, true);
  window.clearTimeout = window.clearInterval = clear;
  performance.now = () => (frozen ? vnow : real.now());
  Date.now = () => (frozen ? Math.round(vnow + skew) : real.date());

  /** Fire, in order, every timer that falls due in the next `ms`. */
  function advance(ms) {
    const until = vnow + ms;
    for (let n = 0; n < 100000; n++) {
      let next = null;
      for (const t of timers.values()) if (t.at <= until && (!next || t.at < next.at || (t.at === next.at && t.id < next.id))) next = t;
      if (!next) break;
      vnow = Math.max(vnow, next.at);
      try {
        fire(next);
      } catch (e) {
        console.error(e);
      }
    }
    vnow = until;
  }

  // --- the interface's animations ------------------------------------------------------------------
  // Every transition and keyframe animation is held still and moved by hand, a frame at a time.
  const anims = new Map(); // Animation -> its own time in ms
  function stepAnimations(ms) {
    const live = new Set(document.getAnimations());
    for (const a of anims.keys()) if (!live.has(a)) anims.delete(a);
    for (const a of live) {
      let t = anims.get(a);
      try {
        if (t === undefined) {
          // made during this frame: this frame is its first moment
          t = frozenAt.has(a) ? frozenAt.get(a) : 0;
          a.pause();
        } else t += ms;
        const end = a.effect ? a.effect.getComputedTiming().endTime : Infinity;
        if (t >= end) {
          a.finish();
          anims.delete(a);
          continue;
        }
        a.currentTime = t;
        anims.set(a, t);
      } catch (e) {
        anims.delete(a);
      }
    }
  }
  const frozenAt = new Map();

  // --- chance -------------------------------------------------------------------------------------
  function seeded(seed) {
    let s = seed >>> 0 || 1;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // --- the pointer: a headless page has no cursor to photograph, so one is drawn -------------------
  let cursor = null;
  function pointer(on) {
    if (!cursor) {
      cursor = document.createElement('div');
      cursor.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:30px;z-index:2147483647;pointer-events:none;will-change:transform;display:none';
      cursor.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="30" viewBox="0 0 22 30"><path d="M2 1.5v22.4l5.6-5.2 3.9 8.9 3.7-1.6-3.9-8.8h7.9z" fill="#fff" stroke="#000" stroke-width="1.6" stroke-linejoin="round"/></svg>';
      document.documentElement.append(cursor);
      addEventListener(
        'mousemove',
        (e) => {
          cursor.style.transform = `translate(${e.clientX - 2}px, ${e.clientY - 1.5}px)`;
        },
        true
      );
    }
    cursor.style.display = on ? 'block' : 'none';
  }

  // --- the sound ----------------------------------------------------------------------------------
  let actx = null,
    rendering = null,
    started = false,
    T = 0; // seconds of film so far
  const RATE = 48000;

  /** Start the film's clock. Everything from here on is counted in frames. */
  function begin(seconds, seed = 1) {
    if (frozen) throw new Error('the film has begun already');
    const g = window.TP.game;
    actx = new OfflineAudioContext(2, Math.ceil(RATE * (seconds + 1)), RATE);
    if (!g.audio.drive(actx)) throw new Error('the sound was running before the film began');
    vnow = real.now();
    skew = real.date() - vnow;
    frozen = true;
    for (const t of timers.values()) real.clearTimeout(t.real);
    for (const a of document.getAnimations()) frozenAt.set(a, Number(a.currentTime) || 0);
    stepAnimations(0);
    Math.random = seeded(seed);
    T = 0;
  }

  async function soundTo(t) {
    const p = actx.suspend(t);
    if (!started) {
      started = true;
      rendering = actx.startRendering();
    } else actx.resume();
    await p;
  }

  // Between two takes the world is stepped without being filmed (things settle, a fire catches).
  // That time is not in the film, so nothing may sound in it: one-shots are dropped and the sound's
  // clock stands still, while what is merely kept up to date (the place, the loops, the listener)
  // goes on being told.
  let kept = null;
  function hush(on) {
    const A = window.TP.game.audio;
    if (on && !kept) {
      kept = { sfx: A.sfx, footstep: A.footstep, update: A.update };
      A.sfx = A.footstep = A.update = () => {};
    } else if (!on && kept) {
      Object.assign(A, kept);
      kept = null;
    }
  }

  /**
   * One frame. cmd: { dt, quiet (not filmed: see hush), down: [codes], up: [codes], dx, dy (look,
   * in mouse pixels), aim: { x, y, z, k } (turn the share k of the way to a point of the world) }.
   */
  async function frame(cmd) {
    const g = window.TP.game,
      dt = cmd.dt,
      inp = g.input,
      pl = g.player;
    advance(dt * 1000);
    for (const k of cmd.up || []) inp.release(k);
    for (const k of cmd.down || []) inp.press(k);
    let dx = cmd.dx || 0,
      dy = cmd.dy || 0;
    const kk = 0.0021 * g.settings.sensitivity;
    if (cmd.aim) {
      const c = g.engine.camera.position;
      const ax = cmd.aim.x - c.x,
        ay = cmd.aim.y - c.y,
        az = cmd.aim.z - c.z;
      let dh = Math.atan2(ax, -az) - pl.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      const dp = Math.atan2(ay, Math.hypot(ax, az)) - pl.pitch;
      dx += (dh * cmd.aim.k) / kk;
      dy -= (dp * cmd.aim.k) / kk;
    }
    inp.dx += dx;
    inp.dy += dy;
    if (cmd.quiet) hush(true);
    try {
      g.frame(dt);
    } finally {
      hush(false);
    }
    stepAnimations(dt * 1000);
    if (!cmd.quiet) {
      T += dt;
      await soundTo(T);
    }
    return state();
  }

  function state() {
    const g = window.TP.game,
      p = g.player,
      b = g.brew;
    return {
      t: T,
      mode: g.state.mode,
      x: p.pos.x, y: p.pos.y, z: p.pos.z,
      heading: p.heading, pitch: p.pitch, ground: p.onGround, speed: p.speed,
      hp: g.state.player.hp,
      focus: g.hud.focus ? g.hud.focus.verb + ' ' + g.hud.focus.name : null,
      region: g.region,
      mood: g._mood,
      aiming: !!g.potions.isAiming,
      shots: g.potions.shots.length,
      brew: b ? { fire: b.fire, heat: b.heat, fit: b.fit, progress: b.progress, ready: !!b.ready, stir: b.stir, band: b.band, n: b.contents.length, region: b.region ? b.region.id : null } : null,
    };
  }

  /** The sound of the whole film as 16-bit stereo WAV, base64, in pieces. */
  async function sound(seconds) {
    actx.resume();
    const buf = await rendering;
    const n = Math.min(buf.length, Math.round(seconds * RATE));
    const L = buf.getChannelData(0),
      R = buf.getChannelData(1);
    let peak = 0,
      sum = 0;
    const pcm = new Int16Array(n * 2);
    for (let i = 0; i < n; i++) {
      const l = L[i],
        r = R[i];
      peak = Math.max(peak, Math.abs(l), Math.abs(r));
      sum += l * l + r * r;
      pcm[2 * i] = Math.max(-32768, Math.min(32767, Math.round(l * 32767)));
      pcm[2 * i + 1] = Math.max(-32768, Math.min(32767, Math.round(r * 32767)));
    }
    const bytes = new Uint8Array(pcm.buffer);
    const parts = [];
    const CH = 3 * 256 * 1024;
    for (let o = 0; o < bytes.length; o += CH) {
      let s = '';
      const part = bytes.subarray(o, o + CH);
      for (let i = 0; i < part.length; i += 0x8000) s += String.fromCharCode.apply(null, part.subarray(i, i + 0x8000));
      parts.push(btoa(s));
    }
    window.__filmSound = parts;
    return { parts: parts.length, frames: n, rate: RATE, peak, rms: Math.sqrt(sum / (2 * n || 1)) };
  }

  window.__film = { begin, frame, state, sound, pointer, advance, real, get t() { return T; } };
})();
