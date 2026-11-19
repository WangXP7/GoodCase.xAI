import { describe, it, expect } from 'vitest';
import { PerspectiveCamera } from 'three';
import { PRESETS, TIERS, internalSize, createQuality, rainDensityScale, wrapRainDensity } from '../src/render/quality.js';
import { pickTier, median, benchDecision, parseStored, runBenchmark } from '../src/render/autotier.js';
import { createDynRes } from '../src/render/dynres.js';
import { createEvents } from '../src/core/events.js';

const feed = (c, ms, n) => { let last = null; for (let i = 0; i < n; i++) { const s = c.sample(ms); if (s !== null) last = s; } return last; };

// A store, user agent and benchmark the tests control.
function env({ saved, ua = 'UA/1', ms = 5, fail = false, hidden = false } = {}) {
  const data = new Map(saved ? [['graveyard-shift.tier', JSON.stringify(saved)]] : []);
  const e = {
    data, ua, runs: 0, hidden: () => hidden, warn: () => {}, settle: () => {},
    store: { get: (k, f = null) => (data.has(k) ? data.get(k) : f), set: (k, v) => { data.set(k, String(v)); return true; } },
    bench: () => { e.runs++; if (fail) throw new Error('bench broke'); return { ms, frames: 45 }; },
    stored: () => (data.has('graveyard-shift.tier') ? JSON.parse(data.get('graveyard-shift.tier')) : null),
  };
  return e;
}
const makeG = (params = {}, device = { touch: false }) => ({ params, device, events: createEvents() });

describe('PRESETS', () => {
  it('mobile tier values', () => {
    expect(PRESETS.mobile).toMatchObject({
      maxHeight: 648, shadowRes: 1024, volSteps: 8, aoOn: false, msaa: 0, bloomMips: 4, reflection: false, flare: false,
      shadowedSpots: 1, spots: 4, points: 2, moonShadowEvery: 4, rain: 0.35, zombieLodFar: 7, zombieShadowDist: 0,
      charTex: 1024, particles: 1536, decals: 96,
    });
  });
  it('desktop tiers keep their original values', () => {
    expect(PRESETS.high).toMatchObject({ maxHeight: 1080, shadowRes: 2048, volSteps: 32, aoOn: true, msaa: 4, bloomMips: 7 });
    expect(PRESETS.medium).toMatchObject({ maxHeight: 900, shadowRes: 1536, volSteps: 20, aoOn: true, msaa: 2, bloomMips: 6 });
    expect(PRESETS.low).toMatchObject({ maxHeight: 720, shadowRes: 1024, volSteps: 12, aoOn: false, msaa: 0, bloomMips: 5 });
  });
  it('desktop tiers carry the new fields at what the game did before', () => {
    expect([PRESETS.high.reflection, PRESETS.medium.reflection, PRESETS.low.reflection]).toEqual([true, true, false]);
    for (const name of ['high', 'medium', 'low']) {
      expect(PRESETS[name]).toMatchObject({
        flare: true, shadowedSpots: 2, spots: 6, points: 3, moonShadowEvery: 1, rain: 1, zombieLodFar: 12, zombieShadowDist: 14,
        charTex: 2048, particles: 4096, decals: 256, dynLo: 20, dynHi: 12,
      });
    }
    expect([PRESETS.high.volFactor, PRESETS.medium.volFactor, PRESETS.low.volFactor, PRESETS.mobile.volFactor]).toEqual([2, 4, 4, 4]);
    expect([PRESETS.high.reflScale, PRESETS.medium.reflScale, PRESETS.low.reflScale]).toEqual([0.5, 0.4, 0.3]);
    expect(PRESETS.mobile).toMatchObject({ dynLo: 25, dynHi: 18 });
    expect(TIERS.map((t) => PRESETS[t].depthPrepass)).toEqual([true, true, true, false]);
    expect(TIERS.map((t) => PRESETS[t].volLamps)).toEqual([16, 16, 16, 16]);
  });
  it('budget levers for other modules: mobile draws less, desktop tiers change nothing', () => {
    for (const name of ['high', 'medium', 'low']) expect(PRESETS[name]).toMatchObject({ propDensity: 1, zoneDepth: 2 });
    expect(PRESETS.mobile).toMatchObject({ propDensity: 0.5, zoneDepth: 1 });
  });
  it('zombieShadowMax: bodies per shadow map, fewer down the tiers, none on mobile (blob shadows)', () => {
    expect(TIERS.map((t) => PRESETS[t].zombieShadowMax)).toEqual([8, 6, 4, 0]);
  });
  it('fields other modules wait on: viewDetail (weapon view detail) and vehicleNear (vehicle near-LOD metres)', () => {
    expect(TIERS.map((t) => PRESETS[t].viewDetail)).toEqual([1, 1, 0.5, 0]);
    expect(TIERS.map((t) => PRESETS[t].vehicleNear)).toEqual([12, 10, 8, 6]);
  });
  it('every tier has the same fields', () => {
    const keys = Object.keys(PRESETS.high).sort();
    for (const name of TIERS) expect(Object.keys(PRESETS[name]).sort()).toEqual(keys);
    expect(TIERS).toEqual(['high', 'medium', 'low', 'mobile']);
  });
});

describe('internalSize', () => {
  it('a phone at 844x390, DPR 3, 648 lines', () => {
    expect(internalSize(844, 390, 3, 648)).toEqual({ w: 1402, h: 648 });
    expect(internalSize(844, 390, 3, 648, 1)).toEqual({ w: 1402, h: 648 });
    expect(internalSize(844, 390, 3, 648, 0.6)).toEqual({ w: 842, h: 389 });
  });
  it('desktop sizes are what they were', () => {
    expect(internalSize(1920, 1080, 2, 1080)).toEqual({ w: 1920, h: 1080 });
    expect(internalSize(1920, 1080, 1, 900)).toEqual({ w: 1600, h: 900 });
    expect(internalSize(800, 600, 1, 1080)).toEqual({ w: 800, h: 600 }); // never above what the display shows
    expect(internalSize(0, 0, 1, 1080)).toEqual({ w: 2, h: 2 });
  });
});

describe('pickTier', () => {
  const desk = { touch: false }; const touch = { touch: true };
  it('desktop boundaries: 7, 12, 22 ms', () => {
    expect(pickTier(6.99, desk)).toBe('high');
    expect(pickTier(7, desk)).toBe('medium');
    expect(pickTier(11.99, desk)).toBe('medium');
    expect(pickTier(12, desk)).toBe('low');
    expect(pickTier(21.99, desk)).toBe('low');
    expect(pickTier(22, desk)).toBe('mobile');
    expect(pickTier(200, desk)).toBe('mobile');
  });
  it('touch boundaries: 6, 11 ms, and never high', () => {
    expect(pickTier(0.5, touch)).toBe('medium');
    expect(pickTier(5.99, touch)).toBe('medium');
    expect(pickTier(6, touch)).toBe('low');
    expect(pickTier(10.99, touch)).toBe('low');
    expect(pickTier(11, touch)).toBe('mobile');
  });
  it('a missing device counts as desktop; a bad time as the slowest', () => {
    expect(pickTier(3)).toBe('high');
    expect(pickTier(NaN, desk)).toBe('mobile');
  });
  it('median of the samples', () => {
    expect(median([5, 1, 9])).toBe(5);
    expect(median([4, 2, 8, 6])).toBe(5);
    expect(median([])).toBe(Infinity);
  });
});

describe('benchDecision', () => {
  const ua = 'UA/1';
  it('q= wins over everything', () => {
    expect(benchDecision({ params: { q: 'low', autotier: true }, stored: null, ua })).toBe('param');
  });
  it('harness runs skip it unless autotier=1', () => {
    expect(benchDecision({ params: { shot: 'wide' }, stored: null, ua })).toBe('harness');
    expect(benchDecision({ params: { step: true }, stored: null, ua })).toBe('harness');
    expect(benchDecision({ params: { bot: true }, stored: null, ua })).toBe('harness');
    expect(benchDecision({ params: { shot: 'wide', step: true, autotier: true }, stored: null, ua })).toBe('run');
  });
  it('a stored choice from the same browser is kept; another browser measures again', () => {
    expect(benchDecision({ params: {}, stored: { tier: 'low', ua, auto: true }, ua })).toBe('stored');
    expect(benchDecision({ params: {}, stored: { tier: 'low', ua: 'UA/0', auto: true }, ua })).toBe('run');
    expect(benchDecision({ params: {}, stored: null, ua })).toBe('run');
  });
  it('parseStored rejects junk', () => {
    expect(parseStored(null)).toBe(null);
    expect(parseStored('{nope')).toBe(null);
    expect(parseStored(JSON.stringify({ tier: 'ultra', ua }))).toBe(null);
    expect(parseStored(JSON.stringify({ tier: 'mobile', ua, auto: true, benchMs: 30 }))).toEqual({ tier: 'mobile', ua, auto: true, benchMs: 30 });
  });
});

describe('createDynRes', () => {
  const desk = { lo: 20, hi: 12 };
  it('steps down after 30 frames at 30 ms, not after 29', () => {
    const c = createDynRes(desk);
    expect(feed(c, 30, 29)).toBe(null);
    expect(c.scale).toBe(1);
    expect(c.sample(30)).toBe(0.9);
    expect(c.scale).toBe(0.9);
  });
  it('the 30-frame average decides, not one slow frame', () => {
    const c = createDynRes(desk);
    feed(c, 10, 29);
    expect(c.sample(200)).toBe(null); // mean 16.3 ms
    expect(c.scale).toBe(1);
  });
  it('no second change within 2 s', () => {
    const c = createDynRes(desk);
    feed(c, 30, 30); // 0.9 s: down to 0.9
    // the cool-down runs to 2 s after the change: 66 more frames at 30 ms are 1.98 s
    expect(feed(c, 30, 66)).toBe(null);
    expect(c.sample(30)).toBe(0.8);
  });
  it('never below 0.6', () => {
    const c = createDynRes(desk);
    feed(c, 40, 2000);
    expect(c.scale).toBe(0.6);
    expect(feed(c, 40, 500)).toBe(null);
  });
  it('steps up only after 120 good frames, and never above 1', () => {
    const c = createDynRes({ ...desk, scale: 0.8 });
    expect(feed(c, 8, 119)).toBe(null);
    expect(c.sample(8)).toBe(0.9);
    // 2 s must pass (250 frames at 8 ms) before the next one
    expect(feed(c, 8, 249)).toBe(null);
    expect(c.sample(8)).toBe(1);
    expect(feed(c, 8, 5000)).toBe(null);
    expect(c.scale).toBe(1);
  });
  it('one slow frame restarts the count of good frames', () => {
    const c = createDynRes({ ...desk, scale: 0.8 });
    feed(c, 8, 100);
    c.sample(15);
    expect(feed(c, 8, 119)).toBe(null);
    expect(c.sample(8)).toBe(0.9);
  });
  it('between hi and lo nothing changes', () => {
    const c = createDynRes({ ...desk, scale: 0.8 });
    feed(c, 8, 50); // a display that can show 8 ms frames
    expect(feed(c, 16, 3000)).toBe(null);
    expect(c.scale).toBe(0.8);
  });
  it('a 60 Hz display counts as good: frames cannot come faster than the refresh', () => {
    // hi is 12 ms but the display never shows a frame under 16.7: without this the scale could never recover
    const c = createDynRes({ ...desk, scale: 0.8 });
    expect(feed(c, 16.7, 119)).toBe(null);
    expect(c.sample(16.7)).toBe(0.9);
    // but a game stuck at 30 fps from its first frame is never "as fast as the display"
    const slow = createDynRes({ lo: 25, hi: 18, scale: 0.8 });
    feed(slow, 33.3, 600);
    expect(slow.scale).toBe(0.6);
  });
  it('a step up that has to be taken straight back makes the next one wait twice as long', () => {
    const c = createDynRes({ lo: 25, hi: 18, scale: 0.8 });
    expect(feed(c, 16, 120)).toBe(0.9); // up
    expect(feed(c, 34, 80)).toBe(0.8); // too slow there: back down inside 10 s
    expect(feed(c, 16, 239)).toBe(null);
    expect(c.sample(16)).toBe(0.9); // needed 240 this time
  });
  it('a stall (tab switch) is not a slow frame', () => {
    const c = createDynRes(desk);
    feed(c, 30, 29);
    expect(c.sample(4000)).toBe(null);
    expect(feed(c, 30, 29)).toBe(null); // the window started again
    expect(c.sample(30)).toBe(0.9);
  });
  it('warm-up frames are not looked at, after creation and after reset', () => {
    const c = createDynRes({ ...desk, warmup: 50 });
    expect(feed(c, 90, 50)).toBe(null); // boot hitches
    expect(feed(c, 30, 29)).toBe(null);
    expect(c.sample(30)).toBe(0.9);
    c.reset(1);
    expect(feed(c, 90, 79)).toBe(null); // 50 ignored, 29 counted
    expect(c.sample(90)).toBe(0.9);
  });
  it('steps are tenths with no float drift', () => {
    const c = createDynRes(desk);
    feed(c, 40, 5000);
    const seen = [c.scale];
    for (let i = 0; i < 3000; i++) { const s = c.sample(5); if (s !== null) seen.push(s); }
    expect(seen).toEqual([0.6, 0.7, 0.8, 0.9, 1]);
  });
});

describe('createQuality', () => {
  it('q=mobile selects the mobile tier; name stays an original name for code that keys on it', () => {
    const q = createQuality(makeG({ q: 'mobile' }), env());
    expect(q.tier).toBe('mobile');
    expect(q.name).toBe('low');
    expect(q.maxHeight).toBe(648);
    expect(q.zombieShadowDist).toBe(0);
    expect(q.auto).toBe(false);
    expect(q.renderScale).toBe(1);
  });
  it('harness runs start on high with no benchmark', async () => {
    const e = env();
    const q = createQuality(makeG({ shot: 'wide', step: true }), e);
    expect(q.tier).toBe('high');
    expect(q.name).toBe('high');
    expect(await q.autoSelect()).toBe('high');
    expect(e.runs).toBe(0);
    expect(e.stored()).toBe(null);
  });
  it('an unknown q falls back to high', () => {
    expect(createQuality(makeG({ q: 'ultra', shot: 'wide' }), env()).tier).toBe('high');
  });
  it('first run: benchmarks at medium, picks, stores, announces', async () => {
    const e = env({ ms: 5 });
    const G = makeG();
    const seen = [];
    G.events.on('quality:tier', (p) => seen.push(p));
    const q = createQuality(G, e);
    expect(q.tier).toBe('medium'); // what the benchmark draws at
    expect(q.auto).toBe(true);
    expect(await q.autoSelect()).toBe('high');
    expect(e.runs).toBe(1);
    expect(q.tier).toBe('high');
    expect(seen).toEqual([{ name: 'high', auto: true, benchMs: 5 }]);
    expect(e.stored()).toMatchObject({ tier: 'high', ua: 'UA/1', auto: true, benchMs: 5 });
    await q.autoSelect(); // decided: not measured twice
    expect(e.runs).toBe(1);
  });
  it('a software renderer: no benchmark, mobile for this visit, nothing stored', async () => {
    const e = env({ ms: 5 });
    const q = createQuality(makeG(), e);
    expect(await q.autoSelect({ software: true, settle: false })).toBe('mobile');
    expect(e.runs).toBe(0);
    expect(e.stored()).toBe(null);
    expect(q.tier).toBe('mobile');
  });
  it('settle: false leaves the settle frame to the caller', async () => {
    let settled = 0;
    const e = { ...env({ ms: 5 }), settle: () => { settled++; } };
    const q = createQuality(makeG(), e);
    await q.autoSelect({ settle: false });
    expect(settled).toBe(0);
    q.settle();
    expect(settled).toBe(1);
  });
  it('a touch device at 30 ms gets mobile', async () => {
    const e = env({ ms: 30 });
    const q = createQuality(makeG({}, { touch: true }), e);
    expect(await q.autoSelect()).toBe('mobile');
    expect(q.name).toBe('low');
  });
  it('a stored choice from the same browser is used from the first frame, with no benchmark', async () => {
    const e = env({ saved: { tier: 'mobile', ua: 'UA/1', auto: true, benchMs: 31 } });
    const q = createQuality(makeG(), e);
    expect(q.tier).toBe('mobile');
    expect(q.auto).toBe(true);
    expect(await q.autoSelect()).toBe('mobile');
    expect(e.runs).toBe(0);
  });
  it('a stored choice from another browser version is measured again', async () => {
    const e = env({ saved: { tier: 'mobile', ua: 'UA/0', auto: true }, ms: 8 });
    const q = createQuality(makeG(), e);
    expect(await q.autoSelect()).toBe('medium');
    expect(e.runs).toBe(1);
    expect(e.stored().ua).toBe('UA/1');
  });
  it('autotier=1 runs the benchmark in a harness run', async () => {
    const e = env({ ms: 15 });
    const q = createQuality(makeG({ shot: 'wide', step: true, autotier: true }), e);
    expect(await q.autoSelect()).toBe('low');
    expect(e.runs).toBe(1);
  });
  it('a benchmark that throws: low on desktop, mobile on touch, nothing stored', async () => {
    const e = env({ fail: true });
    const q = createQuality(makeG(), e);
    expect(await q.autoSelect()).toBe('low');
    expect(q.auto).toBe(true);
    expect(e.stored()).toBe(null);
    const t = env({ fail: true });
    expect(await createQuality(makeG({}, { touch: true }), t).autoSelect()).toBe('mobile');
    expect(t.stored()).toBe(null);
  });
  it('a hidden tab is not measured', async () => {
    const e = env({ hidden: true });
    const q = createQuality(makeG(), e);
    expect(await q.autoSelect()).toBe('low');
    expect(e.runs).toBe(0);
    expect(e.stored()).toBe(null);
  });
  it('set(name) is a manual choice: auto goes off, it is remembered, listeners run', async () => {
    const e = env();
    const G = makeG();
    const q = createQuality(G, e);
    const seen = []; let changes = 0;
    G.events.on('quality:tier', (p) => seen.push(p));
    q.onChange(() => { changes++; });
    expect(q.set('low')).toBe(true);
    expect(q.set('ultra')).toBe(false);
    expect(q.auto).toBe(false);
    expect(changes).toBe(1);
    expect(seen).toEqual([{ name: 'low', auto: false, benchMs: null }]);
    expect(e.stored()).toMatchObject({ tier: 'low', auto: false });
    expect(await q.autoSelect()).toBe('low');
    expect(e.runs).toBe(0);
    // next visit: still low, still manual
    const q2 = createQuality(makeG(), e);
    expect(q2.tier).toBe('low');
    expect(q2.auto).toBe(false);
  });
  it('setAuto(true) measures again; setAuto(false) keeps the tier', async () => {
    const e = env({ ms: 9 });
    const q = createQuality(makeG(), e);
    q.set('high');
    expect(await q.setAuto(true)).toBe('medium');
    expect(q.auto).toBe(true);
    expect(e.runs).toBe(1);
    expect(await q.setAuto(false)).toBe('medium');
    expect(q.auto).toBe(false);
    expect(e.stored()).toMatchObject({ tier: 'medium', auto: false });
  });
  it('harness and q= runs store nothing', () => {
    const e = env();
    createQuality(makeG({ q: 'low' }), e).set('medium');
    createQuality(makeG({ shot: 'wide' }), e).set('medium');
    expect(e.stored()).toBe(null);
  });
  it('the rs param pins the scale', () => {
    const q = createQuality(makeG({ rs: 0.7, q: 'mobile' }), env());
    expect(q.renderScale).toBe(0.7);
    expect(q.setRenderScale(1)).toBe(false);
    for (let i = 0; i < 400; i++) q.frame(40);
    expect(q.renderScale).toBe(0.7);
    q.set('high');
    expect(q.renderScale).toBe(0.7);
    expect(createQuality(makeG({ rs: 0.5, q: 'mobile' }), env()).renderScale).toBe(0.5);
  });
  it('frame times drive the scale, with the tier’s thresholds, and tell scale listeners', () => {
    const q = createQuality(makeG({ q: 'mobile' }), env());
    const scales = [];
    q.onScale((v) => scales.push(v.renderScale));
    for (let i = 0; i < 120; i++) q.frame(80); // the first 120 frames after boot or a tier change do not count
    expect(q.renderScale).toBe(1);
    for (let i = 0; i < 30; i++) q.frame(22); // under mobile's lo (25): stays
    expect(q.renderScale).toBe(1);
    for (let i = 0; i < 30; i++) q.frame(30);
    expect(q.renderScale).toBe(0.9);
    expect(scales).toEqual([0.9]);
    const d = createQuality(makeG({ q: 'high' }), env());
    for (let i = 0; i < 150; i++) d.frame(22); // over desktop's lo (20)
    expect(d.renderScale).toBe(0.9);
  });
  it('setRenderScale snaps to tenths between 0.6 and 1; a tier change starts again at 1', () => {
    const q = createQuality(makeG({ q: 'high' }), env());
    expect(q.setRenderScale(0.74)).toBe(true);
    expect(q.renderScale).toBe(0.7);
    q.setRenderScale(0.2);
    expect(q.renderScale).toBe(0.6);
    q.setRenderScale(3);
    expect(q.renderScale).toBe(1);
    q.setRenderScale(0.8);
    q.set('medium');
    expect(q.renderScale).toBe(1);
  });
  it('stepped harness runs never change the scale by themselves', () => {
    const q = createQuality(makeG({ q: 'mobile', step: true }), env());
    for (let i = 0; i < 400; i++) q.frame(40);
    expect(q.renderScale).toBe(1);
  });
});

describe('boot tier before the benchmark', () => {
  it('a touch device is never benchmarked: it builds and stays at mobile', async () => {
    const e = env({ ms: 0.5 });
    const G = makeG({}, { touch: true });
    const seen = [];
    G.events.on('quality:tier', (p) => seen.push(p));
    const q = createQuality(G, e);
    expect(q.tier).toBe('mobile'); // build-time reads (charTex, shadow maps) take mobile values
    expect(q.charTex).toBe(1024);
    expect(q.auto).toBe(true);
    expect(await q.autoSelect()).toBe('mobile');
    expect(e.runs).toBe(0);
    expect(seen).toEqual([]); // nothing changed
    // autotier=1 in a harness run: still not measured on touch
    const h = env({ ms: 0.5 });
    expect(await createQuality(makeG({ shot: 'wide', autotier: true }, { touch: true }), h).autoSelect()).toBe('mobile');
    expect(h.runs).toBe(0);
    // "Auto" from the settings after a manual pick: back to mobile, no benchmark
    const m = env({ ms: 0.5 });
    const r = createQuality(makeG({}, { touch: true }), m);
    r.set('high');
    expect(await r.setAuto(true)).toBe('mobile');
    expect(r.auto).toBe(true);
    expect(m.runs).toBe(0);
    expect(m.stored()).toMatchObject({ tier: 'mobile', auto: true });
  });
  it('a desktop still boots at medium, the tier the benchmark draws at', () => {
    expect(createQuality(makeG(), env()).tier).toBe('medium');
  });
  it('a touch device never auto-picks above mobile, however fast it would measure', async () => {
    for (const ms of [0.5, 4, 8, 12]) {
      const e = env({ ms });
      const q = createQuality(makeG({}, { touch: true }), e);
      expect(await q.autoSelect()).toBe('mobile');
      expect(e.runs).toBe(0);
    }
  });
  it('an automatic pick above mobile stored on a touch device by an older build comes back as mobile', () => {
    const e = env({ saved: { tier: 'low', ua: 'UA/1', auto: true, benchMs: 8 } });
    expect(createQuality(makeG({}, { touch: true }), e).tier).toBe('mobile');
  });
  it('a manual choice on a touch device is honoured, above mobile too', async () => {
    const e = env({ saved: { tier: 'medium', ua: 'UA/1', auto: false } });
    const q = createQuality(makeG({}, { touch: true }), e);
    expect(q.tier).toBe('medium');
    expect(q.set('high')).toBe(true);
    expect(q.tier).toBe('high');
  });
});

describe('tier demotion', () => {
  // frames at `ms` for `seconds` of game time
  const run = (q, ms, seconds) => { const n = Math.ceil((seconds * 1000) / ms); for (let i = 0; i < n; i++) q.frame(ms); };
  it('an automatic tier that sits at the scale floor, still slow, for 10 s drops one tier and is stored', async () => {
    const e = env({ ms: 5 });
    const G = makeG();
    const seen = [];
    G.events.on('quality:tier', (p) => seen.push(p));
    const q = createQuality(G, e);
    expect(await q.autoSelect()).toBe('high');
    seen.length = 0;
    run(q, 40, 14); // warm-up, then 1.0 -> 0.6 in four steps two seconds apart
    expect(q.renderScale).toBe(0.6);
    expect(q.tier).toBe('high');
    run(q, 40, 10.5);
    expect(q.tier).toBe('medium');
    expect(q.auto).toBe(true);
    expect(q.renderScale).toBe(1);
    expect(seen).toEqual([{ name: 'medium', auto: true, benchMs: 5 }]);
    expect(e.stored()).toMatchObject({ tier: 'medium', auto: true, benchMs: 5 });
  });
  it('not before the 10 s are up, and not when the floor is fast enough', async () => {
    const q = createQuality(makeG(), env({ ms: 5 }));
    await q.autoSelect();
    run(q, 40, 14);
    expect(q.renderScale).toBe(0.6);
    run(q, 40, 7);
    expect(q.tier).toBe('high');
    // at the floor but under dynLo (20): the scale holds, the tier stays
    const r = createQuality(makeG(), env({ ms: 5 }));
    await r.autoSelect();
    r.setRenderScale(0.6);
    run(r, 19, 30);
    expect(r.renderScale).toBe(0.6);
    expect(r.tier).toBe('high');
  });
  it('leaving the floor starts the 10 s again', async () => {
    const q = createQuality(makeG(), env({ ms: 5 }));
    await q.autoSelect();
    run(q, 40, 14);
    run(q, 40, 6);
    q.setRenderScale(0.7); // off the floor
    q.setRenderScale(0.6);
    run(q, 40, 6);
    expect(q.tier).toBe('high');
    run(q, 40, 5);
    expect(q.tier).toBe('medium');
  });
  it('steps one tier at a time, with a full descent and 10 s between steps, and stops at mobile', async () => {
    const q = createQuality(makeG(), env({ ms: 5 }));
    await q.autoSelect();
    const tiers = [q.tier];
    for (let i = 0; i < 6; i++) { run(q, 40, 25); if (q.tier !== tiers[tiers.length - 1]) tiers.push(q.tier); }
    expect(tiers).toEqual(['high', 'medium', 'low', 'mobile']);
    // right after a demotion the next one is at least a whole descent away
    const r = createQuality(makeG(), env({ ms: 5 }));
    await r.autoSelect();
    run(r, 40, 25);
    expect(r.tier).toBe('medium');
    run(r, 40, 15);
    expect(r.tier).toBe('medium');
  });
  it('never demotes a manual choice: dynamic resolution keeps working on its own', async () => {
    const e = env({ ms: 5 });
    const seen = [];
    const G = makeG();
    G.events.on('quality:tier', (p) => seen.push(p));
    const q = createQuality(G, e);
    q.set('high');
    seen.length = 0;
    run(q, 40, 60);
    expect(q.tier).toBe('high');
    expect(q.renderScale).toBe(0.6);
    expect(seen).toEqual([]);
    expect(e.stored()).toMatchObject({ tier: 'high', auto: false });
  });
  it('never demotes a q= or harness tier, nor with rs= pinned', () => {
    const a = createQuality(makeG({ q: 'high' }), env());
    run(a, 40, 60);
    expect(a.tier).toBe('high');
    const b = createQuality(makeG({ shot: 'wide' }), env());
    run(b, 40, 60);
    expect(b.tier).toBe('high');
    const c = createQuality(makeG({ rs: 0.6 }), env({ ms: 5 }));
    c.autoSelect();
    run(c, 40, 60);
    expect(c.tier).toBe('high');
  });
  it('a tab switch (a stall) restarts the 10 s', async () => {
    const q = createQuality(makeG(), env({ ms: 5 }));
    await q.autoSelect();
    run(q, 40, 14);
    run(q, 40, 6);
    q.frame(5000);
    run(q, 40, 6);
    expect(q.tier).toBe('high');
  });
});

describe('restore and frame times', () => {
  it('resetFrameTimes() ignores the frames after a context restore (shader recompiles)', () => {
    const q = createQuality(makeG({ q: 'mobile' }), env());
    for (let i = 0; i < 120; i++) q.frame(16);
    q.resetFrameTimes();
    for (let i = 0; i < 119; i++) q.frame(200); // recompiling: slow, but not the frame rate
    expect(q.renderScale).toBe(1);
  });
});

describe('rain density on mobile through G.fx.rain', () => {
  // rain.js: density = min(1, intensity / 0.7) * QUALITY_DENSITY[name] with low = 0.4
  const fakeRain = () => {
    const rain = { intensity: 0.7, seen: [] };
    rain.pass = { name: 'rain', render() { rain.seen.push(Math.min(1, rain.intensity / 0.7) * 0.4); } };
    return rain;
  };
  it('mobile draws 35 % of the drops; the rain keeps its own intensity', () => {
    const G = makeG({ q: 'mobile' });
    G.quality = createQuality(G, env());
    const rain = fakeRain();
    G.fx = { rain };
    wrapRainDensity(rain.pass, G);
    rain.pass.render({});
    expect(rain.seen[0]).toBeCloseTo(0.35, 6);
    expect(rain.intensity).toBe(0.7);
    rain.intensity = 1; // heavier than the default: rain.js caps the density at its table's value
    rain.pass.render({});
    expect(rain.seen[1]).toBeCloseTo(0.35, 6);
    rain.intensity = 0.35;
    rain.pass.render({});
    expect(rain.seen[2]).toBeCloseTo(0.175, 6);
  });
  it('desktop tiers are untouched', () => {
    for (const t of ['high', 'medium', 'low']) {
      expect(rainDensityScale(createQuality(makeG({ q: t }), env()))).toBe(1);
    }
    expect(rainDensityScale(createQuality(makeG({ q: 'mobile' }), env()))).toBeCloseTo(0.875, 6);
  });
  it('steps aside once rain.js reads G.quality.rain itself', () => {
    const G = makeG({ q: 'mobile' });
    G.quality = createQuality(G, env());
    const rain = fakeRain();
    rain.readsQualityRain = true;
    G.fx = { rain };
    wrapRainDensity(rain.pass, G);
    rain.pass.render({});
    expect(rain.seen[0]).toBeCloseTo(0.4, 6);
  });
});

describe('runBenchmark time bound', () => {
  // a fake GPU: each frame costs `frameMs`, the first one `firstMs` (shader links)
  function fakeG(frameMs, firstMs = frameMs) {
    const clock = { t: 0 };
    let drawn = 0;
    const gl = { RGBA: 0, UNSIGNED_BYTE: 0, readPixels() {}, isContextLost: () => false };
    const G = {
      time: { frame: 0 },
      post: { render() { clock.t += drawn++ === 0 ? firstMs : frameMs; } },
      renderer: { getContext: () => gl },
      camera: new PerspectiveCamera(),
    };
    return { G, clock };
  }
  for (const [frameMs, firstMs] of [[3, 3], [30, 300], [80, 80], [200, 600], [700, 700], [2000, 2000]]) {
    it(`stays within 1.5 s with ${frameMs} ms frames (first ${firstMs} ms)`, () => {
      const { G, clock } = fakeG(frameMs, firstMs);
      const r = runBenchmark(G, { now: () => clock.t });
      expect(clock.t).toBeLessThanOrEqual(Math.max(1500, firstMs)); // nothing is started that would end past 1.5 s
      if (firstMs < 1500) expect(clock.t).toBeLessThanOrEqual(1500);
      expect(r.ms).toBeGreaterThanOrEqual(frameMs);
      expect(G.time.frame).toBe(0);
    });
  }
  it('a quick device still draws the full 45 frames and reports the frame time', () => {
    const { G, clock } = fakeG(3);
    const r = runBenchmark(G, { now: () => clock.t });
    expect(r.frames).toBe(45);
    expect(r.ms).toBe(3);
  });
});
