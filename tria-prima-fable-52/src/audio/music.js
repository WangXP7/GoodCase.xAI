// The score, played. score.js holds what is written; this is the band. It reads a piece a little
// ahead of the clock, hands every line to its instrument, and lets players in and out of the room
// with the intensity the game asks for. Nothing is improvised, and nothing is left to chance but
// the small unevenness of hands: a few milliseconds, a little weight.
import { clamp, mtof } from './dsp.js';
import { padNote, choirNote, chime, bigBell, pluck, drum, scrape, growl, viol, flute, organ, horn, bass, frame, warDrum, rattle, anvil } from './instruments.js';
import { MOOD_K } from './levels.js';
import { PIECES, compile } from './score.js';

export const MOOD_NAMES = [...Object.keys(PIECES), 'none'];
/** For the bench (dev/audio.js): name a player to hear that one alone. */
export const DEV = { solo: null };

const OUT = 2.6; // seconds a piece takes to leave
const GAP = 1.7; // how long after that begins the next piece plays its first note
const IN = 1.3; // and how long it takes to arrive
const AGAIN = 900; // a piece left less than this many seconds ago is taken up where it was
const FROM_THE_TOP = new Set(['title', 'ending']);

const READ = new Map();
function read(name) {
  let p = READ.get(name);
  if (!p) READ.set(name, (p = compile(PIECES[name], name)));
  return p;
}
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// How each kind of player turns a written note into sound: (S, out, time, note, player).
// note: m (MIDI), dur (written length in seconds), vel, join (the next note follows on),
// auto (one voice of a chord), from (the note before, when this one is joined to it).
const PLAYERS = {
  pad: (S, out, t, n, tr) => padNote(S, out, t + S.range(0, 0.03), n.m, n.dur - 0.05, n.vel * 0.18, { a: tr.a ?? 0.55, r: tr.r ?? 1.5, bright: tr.bright ?? 0.5, thin: tr.thin }),
  organ: (S, out, t, n, tr) => organ(S, out, t + S.range(0, 0.02), n.m, n.dur - 0.04, n.vel * 0.2, { full: tr.full }),
  choir(S, out, t, n, tr) {
    const v = tr.v || ['oo', 'ah'];
    if (n.auto) return choirNote(S, out, t + S.range(0, 0.04), n.m, n.dur - 0.1, n.vel * 0.085, { a: tr.a ?? 0.7, r: tr.r ?? 1.6, v0: v[0], v1: v[1] });
    return choirNote(S, out, t, n.m, n.join ? n.dur - 0.02 : n.dur * 0.9, n.vel * 0.4, { a: tr.a ?? 0.22, r: tr.r ?? 0.55, v0: v[0], v1: v[1] });
  },
  viol: (S, out, t, n, tr) => viol(S, out, t, n.m, n.join ? n.dur - 0.02 : n.dur * 0.92, n.vel * 1.0, { bright: tr.bright, from: n.from }),
  flute: (S, out, t, n, tr) => flute(S, out, t, n.m, n.join ? n.dur - 0.02 : n.dur * 0.9, n.vel * 0.85, { breath: tr.breath }),
  horn: (S, out, t, n) => horn(S, out, t, n.m, n.dur * 0.9, n.vel * 0.55),
  bass: (S, out, t, n, tr) => bass(S, out, t, n.m, n.dur * (tr.stac ?? 0.94), n.vel * 0.3, { a: tr.a, r: tr.r, bite: tr.bite }),
  pluck: (S, out, t, n, tr) => pluck(S, out, t, n.m, n.vel * 1.6, { bright: tr.bright ?? 0.5 }),
  chime: (S, out, t, n, tr) => chime(S, out, t, n.m, n.vel * 0.55, { dk: tr.dk ?? 5.5 }),
  toll: (S, out, t, n, tr) => bigBell(S, out, t, mtof(n.m), n.vel * 1.75, tr.ring ?? 7),
};
// The kit: (S, out, time, weight, written length in seconds, the low note of the key).
const KIT = {
  B: (S, out, t, v) => warDrum(S, out, t, v * 0.8),
  b: (S, out, t, v) => warDrum(S, out, t, v * 0.4),
  t: (S, out, t, v) => frame(S, out, t, v * 1.5, true),
  k: (S, out, t, v) => frame(S, out, t, v * 1.0, false),
  s: (S, out, t, v) => rattle(S, out, t, v * 0.5),
  a: (S, out, t, v) => anvil(S, out, t, v * 0.5),
  h: (S, out, t, v) => drum(S, out, t, v * 0.6),
  x: (S, out, t, v, dur) => scrape(S, out, t, dur, v * 0.48, S.pick([310, 420, 505])),
  g: (S, out, t, v, dur, low) => growl(S, out, t, dur, v * 0.18, low),
};
// Players that carry a tune: their notes are shaped into phrases and joined to each other.
const LINES = new Set(['viol', 'flute', 'horn', 'choir']);
// How far from the written moment a hand may land, in seconds either way.
const LOOSE = { pluck: 0.012, chime: 0.012, viol: 0.008, flute: 0.008, horn: 0.008, choir: 0.01, bass: 0.006, toll: 0.004 };

class Band {
  constructor(S, name, dry, wet, t0, intensity, at = 0) {
    this.S = S;
    this.name = name;
    const P = (this.piece = read(name));
    this.k = MOOD_K[name] ?? 1; // level trim of the whole band
    // Two rooms: the hall, and close to the ear for the bass and the drums, which a hall turns to mud.
    this.wires = [];
    const room = (send) => {
      const g = S.gain(0),
        s = S.gain(send);
      g.connect(dry);
      g.connect(s);
      s.connect(wet);
      this.wires.push(g, s);
      return g;
    };
    this.far = room(P.wet);
    this.near = room(P.wet * 0.35);
    this.layers = P.tracks.map((tr) => {
      const g = S.gain(0),
        to = tr.near ? this.near : this.far;
      if (tr.pan) S.chain(g, S.pan(tr.pan), to);
      else g.connect(to);
      return g;
    });
    this.before = P.tracks.map(() => null); // the last note of each player: { m, end }
    const pc = P.key % 12;
    this.low = pc >= 9 ? 24 + pc : 36 + pc;
    this.setIntensity(intensity, t0, 0);
    this.fi = at; // where in the form
    this.sec = P.sections[P.form[at]];
    this.t0 = t0; // when that section began
    this.i = 0; // the next note of it
    this.dead = false;
    this.notes = []; // { end, srcs } of every note scheduled and not yet over
    this.pruned = t0;
  }

  /** Each player has an intensity at which they come in, over a fifth of the range; all play harder as it rises. */
  setIntensity(I, t, tc = 0.6) {
    this.I = I;
    const dyn = 0.8 + 0.2 * I;
    this.piece.tracks.forEach((tr, i) => {
      const v = tr.g * dyn * (tr.from > 0 ? smooth(tr.from - 0.1, tr.from + 0.1, I) : 1);
      if (tc > 0) this.layers[i].gain.setTargetAtTime(v, t, tc);
      else this.layers[i].gain.setValueAtTime(v, t);
    });
  }

  fadeIn(t, secs) {
    for (const g of [this.far, this.near]) {
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(this.k, t + secs);
    }
  }
  /** Fade to nothing and stop for good. Returns the time at which the band can be taken down. */
  fadeOut(t, secs, from = 1) {
    this.dead = true;
    for (const g of [this.far, this.near]) {
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(from * this.k, t);
      g.gain.linearRampToValueAtTime(0, t + secs);
    }
    // every source still running is told to stop while it is still connected, so nothing is orphaned
    for (const n of this.notes) {
      for (const s of n.srcs) {
        try {
          s.stop(t + secs + 0.2);
        } catch (e) {
          /* already stopped */
        }
      }
    }
    this.notes.length = 0;
    return t + secs + 0.4;
  }
  dispose() {
    for (const w of this.wires) w.disconnect();
  }

  play(n, t) {
    const S = this.S,
      P = this.piece,
      tr = P.tracks[n.tr];
    if (tr.from > 0 && this.I <= tr.from - 0.1) return; // that player is not in the room
    if (DEV.solo && DEV.solo !== tr.name) return;
    const out = this.layers[n.tr],
      dur = n.len * P.bar,
      dyn = this.sec.dyn; // the dynamic mark of the section
    const srcs = (S.collect = []);
    let end = t + 1;
    try {
      if (n.k) end = KIT[n.k](S, out, t + S.range(-0.006, 0.006), n.acc * dyn * S.range(0.9, 1.05), dur, this.low);
      else {
        const line = !n.auto && LINES.has(tr.inst);
        // a tune swells toward the middle of each four bars; chords keep level; plucked and struck
        // things follow the weight of the beat
        const shape = line ? (0.88 + 0.12 * n.acc) * (0.88 + 0.12 * Math.sin((Math.PI * (n.at % 4)) / 4)) : n.auto ? 1 : n.acc;
        const was = this.before[n.tr];
        const note = { m: n.m, dur, vel: shape * dyn * S.range(0.93, 1.05), join: n.join, auto: n.auto, from: line && was && Math.abs(was.end - t) < 0.06 ? was.m : null };
        end = PLAYERS[tr.inst](S, out, t + (n.auto ? 0 : S.range(-1, 1) * (LOOSE[tr.inst] ?? 0)), note, tr);
        this.before[n.tr] = { m: n.m, end: t + dur };
      }
    } finally {
      S.collect = null;
    }
    this.notes.push({ end, srcs });
  }

  advance(until, now) {
    if (this.dead) return;
    if (now - this.pruned > 2) {
      this.pruned = now;
      this.notes = this.notes.filter((n) => n.end > now);
    }
    const P = this.piece;
    // the clock ran on without us (a hidden tab): take the bar up from here instead of bursting
    const next = this.t0 + (this.i < this.sec.notes.length ? this.sec.notes[this.i].at : this.sec.bars) * P.bar;
    if (next < now - 0.3) this.t0 += now + 0.1 - next;
    for (;;) {
      const notes = this.sec.notes;
      while (this.i < notes.length) {
        const t = this.t0 + notes[this.i].at * P.bar;
        if (t >= until) return;
        this.play(notes[this.i++], t);
      }
      const end = this.t0 + this.sec.bars * P.bar;
      if (end >= until) return;
      this.t0 = end;
      this.fi = this.fi + 1 < P.form.length ? this.fi + 1 : P.loop;
      this.sec = P.sections[P.form[this.fi]];
      this.i = 0;
    }
  }
}

// The band's own ceiling. Quiet music passes untouched; a drum, a bell and a downbeat landing
// together are rounded off about 5 dB under full scale, so the master limiter is left to the game.
const CEILING = 1.8;

export function createMusic(S, out, wet) {
  const dry = S.gain((Math.tanh(1.6) / 1.6) * CEILING);
  S.chain(dry, S.shaper('soft', '2x'), S.gain(1 / CEILING), out);
  let cur = null,
    mood = 'none',
    intensity = 0.5,
    curFrom = 0, // when the current band began fading in, and for how long
    curFade = 0;
  const queue = [];
  const fading = [];
  const left = new Map(); // mood -> { fi, t }: where a piece was when it was last left

  function change(req, t) {
    if (req.intensity != null) intensity = clamp(req.intensity, 0, 1);
    if (req.mood === mood) {
      if (cur) cur.setIntensity(intensity, t);
      return;
    }
    const had = !!cur;
    if (cur) {
      // if the old piece had not finished arriving, it leaves from where it had got to
      const lvl = curFade > 0 ? clamp((t - curFrom) / curFade, 0, 1) : 1;
      left.set(mood, { fi: cur.fi, t });
      fading.push({ band: cur, at: cur.fadeOut(t, OUT, lvl) });
    }
    mood = req.mood;
    cur = null;
    if (PIECES[mood]) {
      // a piece come back to is taken up at its next section, not from the top: walking in and
      // out of the Gloom does not play the same eight bars every time
      const P = read(mood),
        was = left.get(mood);
      let fi = 0;
      if (was && t - was.t < AGAIN && !FROM_THE_TOP.has(mood)) fi = was.fi + 1 < P.form.length ? was.fi + 1 : P.loop;
      const start = t + (had ? GAP : 0.1);
      cur = new Band(S, mood, dry, wet, start, intensity, fi);
      curFrom = had ? start - 0.3 : t;
      curFade = had ? IN : 0.5;
      cur.fadeIn(curFrom, curFade);
    }
  }

  return {
    /** Ask for a mood. `at` (context time) is only for scripted offline renders. */
    set(m, o = {}, at = null) {
      queue.push({ mood: m, intensity: o.intensity, at });
    },
    advance(until, now = S.now) {
      while (queue.length && (queue[0].at == null || queue[0].at <= until)) {
        const req = queue.shift();
        const t = req.at == null ? now : Math.max(req.at, now);
        if (cur) cur.advance(t, now);
        change(req, t);
      }
      if (cur) cur.advance(until, now);
      for (let i = fading.length - 1; i >= 0; i--) {
        if (now > fading[i].at) {
          fading[i].band.dispose();
          fading.splice(i, 1);
        }
      }
    },
    get mood() {
      return mood;
    },
    get intensity() {
      return intensity;
    },
    /** The section of the piece being played, for looking in. */
    get section() {
      return cur ? cur.piece.form[cur.fi] : null;
    },
  };
}
