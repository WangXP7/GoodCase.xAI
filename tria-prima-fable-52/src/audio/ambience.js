// The air of the island. Continuous beds (wind, rain, the Gloom, the Scar) follow the values of
// setAmbience; around them, sparse events are scheduled a second ahead: single waves, the lake
// lapping, a crow far off, a bell from under the water.
import { clamp } from './dsp.js';
import { SFX, clink, blip, creak, flutter } from './sfx.js';

const REGIONS = ['shore', 'vale', 'saltwood', 'mere', 'scar', 'heights'];
const ZERO = { region: null, night: 0, wind: 0.3, rain: 0, gloom: 0, water: 0, height: 0 };
// Level of the wind voices in a gale (wind = 1); it falls with the square of the wind.
const WIND = 2.2;

export function createAmbience(S, bus, wet, t0 = S.now) {
  const target = { ...ZERO };
  const c = { ...ZERO }; // smoothed
  const w = {}; // region weights, each 0..1
  for (const r of REGIONS) w[r] = 0;

  // Everything except the Gloom itself passes through a low-pass that closes as the Gloom deepens.
  const inp = S.gain(1);
  const muffle = S.bq('lowpass', 18000);
  S.chain(inp, muffle, bus);
  const send = S.gain(0.5);
  send.connect(wet);

  const L = {};
  const layer = (name, dest = inp) => {
    const g = S.gain(0);
    g.connect(dest);
    L[name] = g;
    return g;
  };

  // --- wind ----------------------------------------------------------------------------------
  // Wind has no sound of its own: it is heard where it meets something. So there is no steady
  // hiss in this bed. Broad noise that slowly rises and falls is the sound of surf, and that is
  // what it was taken for, all over the island. Instead: three hollow voices that climb as they
  // swell and are gone between their gusts, so that a light wind leaves long stretches with
  // nothing in them but the place and the score.
  const wind = layer('wind');
  for (const [hz, q, side, rate] of [[230, 2.4, -0.6, 0.8], [390, 3, 0.55, 1.05], [610, 3.6, -0.1, 1.3]]) {
    const bp = S.bq('bandpass', hz, q),
      g = S.gain(0);
    // a gust is louder and higher at once
    S.sway([[bp.frequency, hz * 0.8, hz * 0.55, 'pos'], [g.gain, 0, 1, 'crest']], rate, null, t0);
    S.chain(S.noise('pink', t0), bp, S.bq('lowpass', 1300), g, S.pan(side), wind);
  }
  // the top of a strong gust, on open ground only
  const air = layer('air');
  const airG = S.gain(0);
  S.sway([airG.gain, 0, 1, 'crest'], 0.9, null, t0);
  S.chain(S.noise('white', t0), S.bq('bandpass', 2600, 0.7), airG, air);
  const rumble = layer('rumble');
  S.chain(S.noise('brown', t0), S.bq('lowpass', 110), rumble);
  // the whistle only speaks in the gusts
  const whistle = layer('whistle');
  for (const [hz, side] of [[900, -0.4], [1240, 0.5]]) {
    const bp = S.bq('bandpass', hz, 14),
      g = S.gain(0);
    S.sway([[bp.frequency, hz, hz * 0.3], [g.gain, 0, 1, 'crest']], S.range(1.2, 1.8), null, t0);
    S.chain(S.noise('white', t0), bp, g, S.pan(side), whistle);
  }
  // the Saltwood: wind finding the hollows of dead trunks, each with a voice of its own. They are
  // tuned to the fifths its music is written in (B2 E3 B3 E4), and never quite hold the pitch.
  const hollow = layer('hollow');
  [123.5, 164.8, 246.9, 329.6].forEach((hz, i) => {
    const a = S.bq('bandpass', hz, 30),
      b = S.bq('bandpass', hz, 22),
      g = S.gain(0);
    S.sway([[a.frequency, hz, hz * 0.03], [b.frequency, hz, hz * 0.03]], S.range(0.7, 1.5), null, t0);
    S.sway([g.gain, 0, 1], S.range(0.8, 1.6), 'crest', t0);
    S.chain(S.noise('pink', t0), a, b, g, S.pan([-0.7, 0.3, -0.2, 0.7][i]), hollow);
  });
  // the Mere: the weight of still, cold air (far down; nothing that could be taken for water)
  const mist = layer('mist');
  S.chain(S.noise('brown', t0), S.bq('lowpass', 160), mist);

  // --- rain ----------------------------------------------------------------------------------
  const rain = layer('rain');
  S.chain(S.noise('white', t0), S.bq('bandpass', 5200, 0.4), S.gain(0.3), rain);
  S.chain(S.noise('pink', t0), S.bq('lowpass', 900), S.gain(0.35), rain);
  S.chain(S.tex('drops', t0), S.gain(0.5), S.pan(-0.5), rain);
  S.chain(S.tex('drops', t0, null, 0.87), S.gain(0.5), S.pan(0.5), rain);

  // --- the Scar ------------------------------------------------------------------------------
  // Most of a lava field is below what small speakers can play, so the bed is in two parts: the
  // weight underneath, and a furnace roar high enough to be heard on anything.
  const scar = layer('scar');
  const sr = S.gain(0.35);
  S.sway([sr.gain, 0.35, 0.15], 0.7, null, t0);
  S.chain(S.noise('brown', t0), S.bq('lowpass', 95), sr, scar);
  const roar = S.gain(1);
  const roarBp = S.bq('bandpass', 170, 0.9);
  S.sway([[roar.gain, 1, 0.5], [roarBp.frequency, 170, 50]], 0.6, null, t0);
  S.chain(S.noise('pink', t0), roarBp, roar, scar);
  S.chain(S.tex('crackleDense', t0), S.bq('bandpass', 2600, 1), S.gain(0.1), scar);

  // --- the Gloom: a pressure more than a sound ---------------------------------------------------
  // A beating pair far down, and quieter pairs on its harmonics, so that the pressure is still
  // there on speakers that cannot reach the bottom one.
  const gloom = layer('gloom', bus);
  const sub = S.gain(0.5);
  S.sway([sub.gain, 0.5, 0.2], 0.9, null, t0);
  S.osc('sine', 41, t0).connect(sub);
  S.osc('sine', 41.4, t0).connect(sub);
  S.chain(S.noise('brown', t0), S.bq('lowpass', 90), S.gain(0.5), sub);
  sub.connect(gloom);
  for (const [hz, beat, lvl] of [[82, 0.31, 0.2], [123, 0.47, 0.11], [164.5, 0.23, 0.06]]) {
    const g = S.gain(lvl);
    S.sway([g.gain, lvl, lvl * 0.7], S.range(0.6, 1.1), null, t0);
    S.osc('sine', hz, t0).connect(g);
    S.osc('sine', hz + beat, t0).connect(g);
    g.connect(gloom);
  }
  const ring = S.gain(0.006);
  S.sway([ring.gain, 0.006, 0.006], 1.4, null, t0);
  S.osc('sine', 3120, t0).connect(ring);
  S.osc('sine', 3127, t0).connect(ring);
  ring.connect(gloom);

  // --- sparse events -------------------------------------------------------------------------
  const pan = () => S.range(-0.8, 0.8);
  /** A one-shot from the sfx table heard from far away. */
  function distant(name, t, gain, lp, opts = {}) {
    const v = S.gain(gain * SFX[name].k),
      f = S.bq('lowpass', lp);
    S.chain(v, f, S.pan(pan()), inp);
    S.chain(f, S.gain(1.2), send);
    SFX[name].fn(S, v, t, opts);
  }
  const ev = S.gain(1); // events that want a little reverb
  ev.connect(inp);
  S.chain(ev, S.gain(0.5), send);

  const streams = [
    {
      every: () => S.range(6.5, 10.5),
      level: () => c.water * w.shore,
      fire(t, lv) {
        const d = S.range(5.5, 8),
          p = S.range(-0.5, 0.5);
        S.nz(ev, t, { k: 'pink', d: d * 0.55, a: d * 0.3, f: 380, f1: 1500, tf: d * 0.3, ft: 'lowpass', g: 0.5 * lv, pan: p, c: 't' });
        S.nz(ev, t, { k: 'brown', d: d * 0.6, a: d * 0.3, f: 300, ft: 'lowpass', g: 0.22 * lv, pan: p, c: 't' });
        // the water drawing back through the shingle
        const fl = flutter(S, ev, t + d * 0.33, d * 0.67, 0.4, 30);
        S.nz(fl, t + d * 0.33, { k: 'white', d: d * 0.67, a: d * 0.2, f: 3200, f1: 2000, q: 0.5, g: 0.3 * lv, pan: p, c: 't' });
      },
    },
    {
      every: () => S.range(0.7, 2.4),
      level: () => c.water * (1 - w.shore),
      fire(t, lv) {
        const p = pan();
        S.nz(ev, t, { k: 'pink', d: S.range(0.25, 0.45), a: 0.07, f: S.range(500, 1100), q: 1, g: 0.16 * lv, pan: p });
        if (S.chance(0.3)) blip(S, ev, t + 0.05, S.range(180, 300), S.range(300, 450), 0.06, 0.05 * lv, p);
      },
    },
    {
      // night insects: few, thin, cold
      every: () => S.range(1.6, 5.5),
      level: () => c.night * (1 - c.gloom) * (1 - c.rain) * (w.vale + 0.6 * w.shore + 0.7 * w.mere),
      fire(t, lv) {
        const who = S.int(0, 2);
        const f = [4380, 4710, 4920][who],
          p = [-0.6, 0.2, 0.7][who];
        for (let k = 0, n = S.int(3, 5); k < n; k++) S.tn(ev, t + k * 0.043, { f, d: 0.02, a: 0.004, g: 0.03 * lv, pan: p, c: 'l' });
      },
    },
    {
      every: () => S.range(22, 70),
      level: () => (1 - 0.85 * c.night) * (1 - 0.6 * c.rain) * (w.vale + 0.7 * w.shore + 0.5 * w.saltwood + 0.4 * w.heights + 0.3 * w.mere),
      fire: (t, lv) => distant('crow', t, 0.25 + 0.2 * lv, 2400, { pitch: S.jit(0.97, 0.06) }),
    },
    {
      // a bell with nobody to ring it (the level is only how likely it is: a bell is a bell)
      every: () => S.range(70, 160),
      level: () => 0.3 * w.vale + 0.25 * w.shore + 0.3 * c.night * w.vale,
      fire: (t) => distant('bell', t, 0.4, 1400, { pitch: 1 }),
    },
    {
      // the drowned belfry under the Mere
      every: () => S.range(50, 120),
      level: () => w.mere,
      fire: (t) => distant('bell', t, 0.45, 620, { pitch: 0.84 }),
    },
    {
      every: () => S.range(9, 26),
      level: () => w.saltwood * (0.3 + c.wind) + 0.5 * w.shore * c.water,
      fire(t, lv) {
        const f = S.range(90, 140);
        const o = S.pan(pan());
        o.connect(ev);
        creak(S, o, t, f, f * S.range(1.2, 1.5), S.range(0.4, 0.9), 0.08 * lv, S.range(500, 900));
      },
    },
    {
      every: () => S.range(12, 40),
      level: () => w.saltwood * (0.4 + c.wind),
      fire(t, lv) {
        const p = pan();
        for (let k = 0, n = S.int(2, 4); k < n; k++) clink(S, ev, t + k * S.range(0.05, 0.2), S.range(5000, 9000), 0.02 * lv, S.range(0.3, 0.6), p);
      },
    },
    {
      // a vent letting go
      every: () => S.range(7, 19),
      level: () => w.scar,
      fire: (t, lv) => S.nz(ev, t, { k: 'white', d: S.range(2, 4), a: 0.6, h: 0.8, f: S.range(2800, 4200), q: 1.2, g: 0.3 * lv, pan: pan(), c: 't' }),
    },
    {
      // a bubble of lava swelling and bursting
      every: () => S.range(5, 14),
      level: () => w.scar,
      fire(t, lv) {
        const f = S.range(80, 140),
          p = pan();
        blip(S, ev, t, f, f * 1.5, 0.3, 0.1 * lv, p);
        S.nz(ev, t + 0.3, { k: 'pink', d: 0.07, a: 0.002, f: 700, q: 1, g: 0.12 * lv, pan: p });
      },
    },
    {
      // voices passing in the Gloom, never close enough to be words
      every: () => S.range(6, 16),
      level: () => c.gloom,
      fire(t, lv) {
        const d = S.range(1.2, 2.4),
          f = S.range(1200, 2400);
        S.nz(gloomEv, t, { k: 'pink', d, a: d * 0.5, f, f1: f * S.range(0.7, 1.4), q: 5, g: 0.25 * lv, pan: S.pick([-0.9, 0.9]) * S.range(0.6, 1), c: 't' });
      },
    },
    {
      // a gust that stands out from the bed
      every: () => S.range(9, 24),
      level: () => clamp(c.wind * (0.5 + c.height + w.heights), 0, 1),
      fire(t, lv) {
        const d = S.range(4, 7),
          p = pan();
        S.nz(inp, t, { k: 'pink', d, a: d * 0.45, f: 260, f1: 620, tf: d * 0.45, q: 2.2, g: 0.5 * lv, pan: p, c: 't' });
        // dry grass on the moor answers it, and is still again
        if (w.vale > 0.3) S.nz(inp, t + d * 0.2, { k: 'white', d: d * 0.6, a: d * 0.3, f: 3400, q: 0.7, g: 0.035 * lv * w.vale, pan: -p, c: 't' });
        const high = clamp(c.height + w.heights, 0, 1);
        if (high > 0.1) {
          const f = S.range(900, 1300);
          S.nz(inp, t, { k: 'white', d, a: d * 0.5, f, f1: f * 1.15, q: 16, g: 1.2 * lv * high, pan: -p, c: 't' });
        }
      },
    },
  ];
  const gloomEv = S.gain(1);
  gloomEv.connect(bus);
  S.chain(gloomEv, S.gain(0.8), send);
  for (const s of streams) s.next = t0 + s.every() * S.rnd();

  // --- levels --------------------------------------------------------------------------------
  function apply(time, tc) {
    const set = (p, v) => (tc > 0 ? p.setTargetAtTime(v, time, tc) : p.setValueAtTime(v, time));
    const wd = c.wind,
      quiet = 1 - 0.35 * c.gloom;
    // (the narrow voices, whistle and hollow, need large numbers: a band a few hertz wide keeps very
    // little of the noise that goes into it)
    set(wind.gain, WIND * wd * wd * quiet);
    set(air.gain, 0.6 * Math.pow(clamp(wd - 0.45, 0, 1), 1.5) * quiet);
    set(rumble.gain, 0.2 * wd * wd * quiet);
    set(whistle.gain, 2.8 * clamp(wd - 0.3, 0, 1) * clamp(0.35 + c.height + w.heights, 0, 1.4));
    set(hollow.gain, 2 * w.saltwood * (0.3 + 0.7 * wd));
    set(mist.gain, 0.06 * w.mere);
    set(rain.gain, 0.7 * Math.pow(c.rain, 0.8));
    set(scar.gain, 0.4 * w.scar);
    set(gloom.gain, 0.28 * Math.pow(c.gloom, 1.2));
    set(muffle.frequency, 18000 * Math.pow(2600 / 18000, Math.pow(c.gloom, 1.5)));
  }

  let lastApply = -1;
  const api = {
    /** Merge new values into the target. With `immediate` the beds jump there (offline renders). */
    set(a, immediate = false) {
      for (const k of Object.keys(ZERO)) if (a[k] !== undefined && a[k] !== null) target[k] = k === 'region' ? a[k] : clamp(Number(a[k]) || 0, 0, 1);
      if (a.region === null) target.region = null;
      if (immediate) {
        Object.assign(c, target);
        for (const r of REGIONS) w[r] = target.region === r ? 1 : 0;
        apply(S.now, 0);
      }
    },
    /** Ease toward the target; call once a frame. */
    tick(dt, now) {
      const k = 1 - Math.exp(-dt / 1.2),
        kr = 1 - Math.exp(-dt / 2.5);
      for (const key of ['night', 'wind', 'rain', 'gloom', 'water', 'height']) c[key] += (target[key] - c[key]) * k;
      for (const r of REGIONS) w[r] += ((target.region === r ? 1 : 0) - w[r]) * kr;
      c.region = target.region;
      if (now - lastApply > 0.12) {
        lastApply = now;
        apply(now, 0.2);
      }
    },
    /** Schedule every event that starts before `until`. */
    advance(until, now = S.now) {
      for (const s of streams) {
        if (s.next < now - 0.2) s.next = now + s.every() * S.rnd(); // the clock ran on without us: do not catch up
        while (s.next < until) {
          const lv = clamp(s.level(), 0, 1);
          if (lv > 0.05 && S.chance(Math.min(1, lv * 1.3))) s.fire(Math.max(s.next, now), lv);
          s.next += s.every();
        }
      }
    },
    get state() {
      return { ...c, weights: { ...w } };
    },
  };
  apply(t0, 0);
  return api;
}
