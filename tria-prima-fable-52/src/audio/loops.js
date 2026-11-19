// Sustained sounds. make(S, out, t) builds the generator and returns
//   { set(param 0..1, time), pitch(ratio, time), stop(time) }
// The engine wraps it with level, position and fades. `param` means what the contract says for
// each loop (heat, speed, closeness); for the others it is simply how strong the source is.
import { clamp } from './dsp.js';
import { LOOP_K } from './levels.js';

const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const bump = (x, a, b, c) => smooth(a, b, x) * (1 - 0.75 * smooth(b, c, x));

/** Collects the endless sources of one loop so they can be re-tuned and stopped together. */
function rig(S) {
  const srcs = [],
    sways = [];
  const keep = (s, lfo = false) => {
    s._lfo = lfo;
    s._r0 = s.playbackRate ? s.playbackRate.value : 1;
    srcs.push(s);
    return s;
  };
  const R = {
    noise: (k, t, rate) => keep(S.noise(k, t, null, rate)),
    tex: (n, t, rate) => keep(S.tex(n, t, null, rate)),
    osc: (type, f, t, det, lfo = false) => keep(S.osc(type, f, t, null, det), lfo),
    /** Slow random movement of params: see Synth.sway. */
    sway(targets, rate, t, shape = null) {
      const m = S.sway(targets, rate, shape, t);
      sways.push(m);
      return m;
    },
    /** A gain that shivers between 1 - depth and 1. */
    flick(depth, rate, t) {
      const g = S.gain(1 - depth);
      R.sway([g.gain, 1 - depth, depth], rate, t, 'pos');
      return g;
    },
    pitch(p, time) {
      for (const s of srcs) {
        if (s._lfo) continue;
        if (s.playbackRate) s.playbackRate.setTargetAtTime(s._r0 * p, time, 0.08);
        else s.detune.setTargetAtTime(1200 * Math.log2(p), time, 0.08);
      }
    },
    stop(time) {
      for (const m of sways) m.until = time;
      for (const s of srcs) {
        try {
          s.stop(time);
        } catch (e) {
          /* already stopped */
        }
      }
    },
  };
  return R;
}
const to = (p, v, time, tc = 0.12) => p.setTargetAtTime(v, time, tc);

export const LOOPS = {
  // A wood fire. param = heat: embers and a tick now and then, up to a roaring blaze.
  fire: {
    wet: 0.1, ref: 2.5, range: 45, k: 1,
    make(S, out, t) {
      const R = rig(S);
      const roarLp = S.bq('lowpass', 200), roarG = S.gain(0), bodyG = S.gain(0), crkG = S.gain(0), crk2G = S.gain(0), hissG = S.gain(0);
      S.chain(R.noise('brown', t), roarLp, roarG, R.flick(0.35, 9, t), out);
      S.chain(R.noise('pink', t), S.bq('bandpass', 620, 0.7), bodyG, R.flick(0.5, 14, t), out);
      S.chain(R.tex('crackle', t), S.bq('highpass', 800), crkG, out);
      S.chain(R.tex('crackleDense', t), S.bq('highpass', 1600), crk2G, out);
      S.chain(R.noise('white', t), S.bq('highpass', 4200), hissG, out);
      return {
        set(h, time) {
          to(roarLp.frequency, 160 + 520 * h, time);
          to(roarG.gain, 0.12 + 0.75 * h, time);
          to(bodyG.gain, 0.1 + 0.4 * h, time);
          to(crkG.gain, 0.35 + 0.35 * h, time);
          to(crk2G.gain, 0.25 * h * h, time);
          to(hissG.gain, 0.02 + 0.07 * h, time);
        },
        pitch: R.pitch,
        stop: R.stop,
      };
    },
  },
  // The cauldron. param = heat: still, then a slow simmer, then a rolling boil.
  bubble: {
    wet: 0.12, ref: 2, range: 30, k: 1,
    make(S, out, t) {
      const R = rig(S);
      const lo = S.gain(0), mid = S.gain(0), hi = S.gain(0), hiss = S.gain(0);
      // heard through the iron: muffled, with the ring of the pot
      const inp = S.bq('lowpass', 2400);
      S.chain(inp, S.bq('peaking', 420, 2, 5), out);
      S.chain(R.tex('bubLo', t), lo, inp);
      S.chain(R.tex('bubMid', t), mid, inp);
      S.chain(R.tex('bubHi', t), hi, inp);
      S.chain(R.noise('white', t), S.bq('bandpass', 5200, 0.8), hiss, out);
      return {
        set(h, time) {
          to(lo.gain, 0.9 * bump(h, 0.05, 0.3, 0.65), time, 0.25);
          to(mid.gain, 0.8 * bump(h, 0.3, 0.6, 1.0), time, 0.25);
          to(hi.gain, 0.9 * smooth(0.55, 0.95, h), time, 0.25);
          to(hiss.gain, 0.1 * smooth(0.6, 1, h), time, 0.25);
        },
        pitch: R.pitch,
        stop: R.stop,
      };
    },
  },
  // Stirring. param = speed of the paddle.
  stir: {
    wet: 0.1, ref: 2, range: 25, k: 1,
    make(S, out, t) {
      const R = rig(S);
      const swirl = R.osc('sine', 1, t, 0, true);
      const bodyBp = S.bq('bandpass', 700, 1.2), bodyG = S.gain(0), gurG = S.gain(0), scrG = S.gain(0);
      const sw1 = S.gain(0.55), sw2 = S.gain(0.5);
      S.chain(swirl, S.gain(0.45)).connect(sw1.gain);
      S.chain(swirl, S.gain(0.5)).connect(sw2.gain);
      S.chain(R.noise('pink', t), bodyBp, bodyG, sw1, out);
      S.chain(R.tex('gurgle', t), gurG, out);
      const white = R.noise('white', t);
      S.chain(white, S.bq('bandpass', 2100, 14), scrG);
      S.chain(white, S.bq('bandpass', 3300, 14), scrG);
      S.chain(scrG, sw2, out);
      return {
        set(v, time) {
          to(bodyG.gain, 0.6 * v, time);
          to(bodyBp.frequency, 500 + 900 * v, time);
          to(gurG.gain, 0.5 * v, time);
          to(scrG.gain, 0.5 * v * v, time);
          to(swirl.frequency, 0.6 + 2.4 * v, time);
        },
        pitch: R.pitch,
        stop: R.stop,
      };
    },
  },
  // A brook: heard from its banks and a little way off, not from across the vale.
  river: {
    wet: 0.1, ref: 5, range: 34, k: 1,
    make(S, out, t) {
      const R = rig(S);
      const m = S.gain(1);
      m.connect(out);
      S.chain(R.noise('pink', t), S.bq('bandpass', 720, 0.5), S.gain(0.5), m);
      const shim = S.gain(0.1);
      R.sway([shim.gain, 0.1, 0.05], 3, t);
      S.chain(R.noise('white', t), S.bq('highpass', 2800), S.bq('lowpass', 9000), shim, m);
      S.chain(R.noise('brown', t), S.bq('lowpass', 230), S.gain(0.45), m);
      S.chain(R.tex('gurgle', t), S.bq('bandpass', 950, 0.6), S.gain(0.6), m);
      return { set: (v, time) => to(m.gain, 0.5 + v, time, 0.3), pitch: R.pitch, stop: R.stop };
    },
  },
  waterfall: {
    wet: 0.2, ref: 10, range: 130, k: 1,
    make(S, out, t) {
      const R = rig(S);
      const m = S.gain(1);
      m.connect(out);
      const a = S.gain(0.9), b = S.gain(0.9);
      R.sway([a.gain, 0.9, 0.1], 2, t);
      R.sway([b.gain, 0.9, 0.12], 1.3, t);
      S.chain(R.noise('pink', t), S.bq('lowpass', 3200), a, m);
      S.chain(R.noise('brown', t), S.bq('lowpass', 260), b, m);
      S.chain(R.noise('white', t), S.bq('highpass', 3500), S.gain(0.25), m);
      return { set: (v, time) => to(m.gain, 0.5 + v, time, 0.3), pitch: R.pitch, stop: R.stop };
    },
  },
  lava: {
    wet: 0.25, ref: 8, range: 90, k: 1,
    make(S, out, t) {
      const R = rig(S);
      const m = S.gain(1);
      m.connect(out);
      const rum = S.gain(0.75);
      R.sway([rum.gain, 0.75, 0.25], 0.8, t);
      S.chain(R.noise('brown', t), S.bq('lowpass', 110), rum, m);
      S.chain(R.tex('glop', t), S.bq('lowpass', 500), S.gain(0.9), m);
      S.chain(R.tex('crackleDense', t), S.bq('bandpass', 2500, 1), S.gain(0.08), m);
      S.chain(R.noise('pink', t), S.bq('bandpass', 300, 1), S.gain(0.15), m);
      return { set: (v, time) => to(m.gain, 0.5 + v, time, 0.3), pitch: R.pitch, stop: R.stop };
    },
  },
  // A fumarole: steam forced through a crack, puffing unevenly.
  vent: {
    wet: 0.2, ref: 4, range: 70, k: 1,
    make(S, out, t) {
      const R = rig(S);
      const m = S.gain(1);
      m.connect(out);
      const puff = S.gain(0.5), whistle = S.gain(0.05);
      R.sway([[puff.gain, 0.5, 0.5], [whistle.gain, 0.05, 0.3]], 2.6, t, 'rect');
      const white = R.noise('white', t);
      S.chain(white, S.bq('bandpass', 4200, 0.9), puff, m);
      S.chain(white, S.bq('bandpass', 1250, 16), whistle, m);
      S.chain(R.noise('brown', t), S.bq('lowpass', 140), S.gain(0.3), m);
      return { set: (v, time) => to(m.gain, 0.5 + v, time, 0.3), pitch: R.pitch, stop: R.stop };
    },
  },
  // The Athanor. param: 0 a cold draught in the flue, 0.3 a pilot flame, 1 a roaring furnace.
  athanor: {
    wet: 0.3, ref: 6, range: 120, k: 1,
    make(S, out, t) {
      const R = rig(S);
      const draught = S.gain(0.03), roarG = S.gain(0), fluG = S.gain(0), rushG = S.gain(0), tickG = S.gain(0);
      const roarLp = S.bq('lowpass', 300);
      R.sway([draught.gain, 0.03, 0.03], 1.2, t);
      S.chain(R.noise('pink', t), S.bq('bandpass', 140, 12), draught, out);
      const brown = R.noise('brown', t);
      S.chain(brown, roarLp, roarG, R.flick(0.4, 11, t), out);
      // the flue sings like an organ pipe
      for (const hz of [62, 124, 186]) S.chain(brown, S.bq('bandpass', hz, 8), fluG);
      S.chain(fluG, out);
      S.chain(R.noise('white', t), S.bq('bandpass', 800, 0.5), rushG, R.flick(0.3, 7, t), out);
      S.chain(R.tex('crackle', t), S.bq('bandpass', 2600, 6), tickG, out);
      return {
        set(v, time) {
          to(roarLp.frequency, 220 + 700 * v, time, 0.4);
          to(roarG.gain, 1.0 * Math.pow(v, 1.3), time, 0.4);
          to(fluG.gain, 2.4 * v * v, time, 0.4);
          to(rushG.gain, 0.22 * Math.pow(v, 1.5), time, 0.4);
          to(tickG.gain, 0.35 * smooth(0.05, 0.4, v), time, 0.4);
        },
        pitch: R.pitch,
        stop: R.stop,
      };
    },
  },
  // A Shade near you: slow breath through an empty hood, something whispering under it.
  // param = closeness.
  shade: {
    wet: 0.5, ref: 5, range: 40, k: 1,
    make(S, out, t) {
      const R = rig(S);
      const m = S.gain(0.3);
      m.connect(out);
      const breath = R.osc('sine', 0.14, t, 0, true);
      const f1 = S.bq('bandpass', 700, 4), f2 = S.bq('bandpass', 1900, 5);
      S.chain(breath, S.gain(330)).connect(f1.frequency);
      S.chain(breath, S.gain(480)).connect(f2.frequency);
      const bg = S.gain(0);
      S.chain(breath, S.shaper('abs'), S.gain(1)).connect(bg.gain);
      const pink = R.noise('pink', t);
      S.chain(pink, f1, bg);
      S.chain(pink, f2, S.gain(0.6), bg);
      S.chain(bg, S.gain(2.2), m);
      const wh = S.gain(0);
      R.sway([wh.gain, 0, 0.5], 9, t, 'rect');
      S.chain(R.noise('white', t), S.bq('bandpass', 3200, 2), wh, S.gain(0.35), m);
      const sub = S.gain(0);
      S.chain(R.osc('sine', 46, t), sub);
      S.chain(R.osc('sine', 49, t), sub);
      sub.connect(m);
      const ring = S.gain(0),
        waver = S.gain(1);
      R.sway([waver.gain, 0.9, 0.5], 2, t);
      S.chain(R.osc('sine', 1870, t), ring);
      S.chain(R.osc('sine', 2530, t), S.gain(0.6), ring);
      S.chain(ring, waver, m);
      return {
        set(c, time) {
          to(m.gain, 0.3 + 0.7 * c, time, 0.3);
          to(breath.frequency, 0.14 * (1 + 0.7 * c), time, 0.5);
          to(sub.gain, 0.25 * c, time, 0.3);
          to(ring.gain, 0.02 * c * c, time, 0.3);
        },
        pitch: R.pitch,
        stop: R.stop,
      };
    },
  },
  rain: {
    wet: 0.1, ref: 6, range: 80, k: 1,
    make(S, out, t) {
      const R = rig(S);
      const m = S.gain(1);
      m.connect(out);
      S.chain(R.noise('white', t), S.bq('bandpass', 5200, 0.4), S.gain(0.3), m);
      S.chain(R.noise('pink', t), S.bq('lowpass', 900), S.gain(0.35), m);
      S.chain(R.tex('drops', t), S.gain(0.5), S.pan(-0.5), m);
      S.chain(R.tex('drops', t, 0.87), S.gain(0.5), S.pan(0.5), m);
      return { set: (v, time) => to(m.gain, 0.5 + v, time, 0.4), pitch: R.pitch, stop: R.stop };
    },
  },
  // Something held up by Levity: a tone that never stops rising.
  levity: {
    wet: 0.5, ref: 3, range: 40, k: 1,
    make(S, out, t) {
      const R = rig(S);
      const m = S.gain(1);
      m.connect(out);
      const trem = S.gain(0.75);
      S.chain(R.osc('sine', 5.5, t, 0, true), S.gain(0.25)).connect(trem.gain);
      S.chain(R.tex('shepard', t), S.bq('bandpass', 1800, 0.4), trem, S.gain(0.5), m);
      const air = S.gain(0.03);
      R.sway([air.gain, 0.03, 0.03], 4, t);
      S.chain(R.noise('white', t), S.bq('bandpass', 6000, 2), air, m);
      return { set: (v, time) => to(m.gain, 0.5 + v, time, 0.3), pitch: R.pitch, stop: R.stop };
    },
  },
};
export const LOOP_NAMES = Object.keys(LOOPS);
for (const name of LOOP_NAMES) LOOPS[name].k = LOOP_K[name] ?? 1;
