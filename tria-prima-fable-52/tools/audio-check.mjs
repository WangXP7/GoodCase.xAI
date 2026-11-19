// Checks the sound without ears. Every one-shot, loop, mood and ambience is rendered by the real
// engine on an OfflineAudioContext in headless Chromium, measured, and flagged when it looks wrong;
// spectrograms go to shots/audio_*.png; the real-time path is leaned on once.
//
//   node tools/audio-check.mjs                     everything
//   node tools/audio-check.mjs --only sfx,loops    some of: live master place sfx loops music amb mix shots
//   node tools/audio-check.mjs --calibrate         measure, then rewrite src/audio/levels.js
//   node tools/audio-check.mjs --long vale [--secs 600] [--intensity 0.6]
//   node tools/audio-check.mjs --players vale [--of flute,drum] [--secs 90] [--intensity 1]
//                                                  the players of a mood, each alone: the balance
//   node tools/audio-check.mjs --soak [180]        a long real-time session, looking for leaks
//   node tools/audio-check.mjs --shot sfx:bell,mood:vale:150 spectrograms of your choice (:seconds)
//   node tools/audio-check.mjs --wav mood:title,sfx:bell     the same renders as WAV files in shots/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './dev-server.mjs';
import { launch } from './pw.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name) => argv.includes('--' + name);
const opt = (name) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
};
const calibrate = flag('calibrate');
const extra = opt('long') || opt('shot') || opt('wav') || opt('players') || flag('soak');
const only = opt('only') ? new Set(opt('only').split(',')) : calibrate ? new Set(['sfx', 'loops', 'music']) : extra ? new Set() : null;
const want = (s) => !only || only.has(s);

const problems = [];
const bad = (what, why) => {
  problems.push(`${what}: ${why}`);
  return why;
};
const pad = (v, n) => String(v).padEnd(n);
const num = (v, n, d = 1) => (typeof v === 'number' ? v.toFixed(d) : String(v)).padStart(n);
const head = (title) => console.log(`\n== ${title} ${'='.repeat(Math.max(0, 92 - title.length))}`);
const SPARK = ' .:-=+*#%@';
const spark = (trace, lo, hi) => trace.map((v) => SPARK[Math.max(0, Math.min(SPARK.length - 1, Math.round(((v - lo) / (hi - lo)) * (SPARK.length - 1))))]).join('');

const { server, url } = await startServer(0);
const { browser, page, logs } = await launch({ width: 1280, height: 800 });
const report = {};
let failed = false;
try {
  const open = async () => {
    await page.goto(`${url}/dev/audio.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.AUD && window.AUD.ready === true, null, { timeout: 30000 });
    await page.evaluate(() => (window.AUD_QUIET = true));
  };
  const call = (fn, ...a) => page.evaluate(([f, args]) => window.AUD[f](...args), [fn, a]);
  await open();
  const names = await page.evaluate(() => window.AUD.NAMES);

  // --- the real-time path, first, while every cache is cold -------------------------------------
  if (want('live')) {
    head('real time: unlock, burst of 40, loops on and off, every mood, pause, hidden page, no update(), unknown names');
    const r = (report.live = await call('live'));
    console.log(`before unlock: unlocked=${r.before.unlocked} context=${r.before.context}`);
    console.log(`unlock() took ${r.unlockMs} ms; slowest update() ${r.seen.slowestUpdateMs} ms over ${r.seen.updates} updates`);
    console.log(`most at once: ${r.seen.voices} voices, ${r.seen.loops} loops, ${r.seen.live} sources; highest output peak ${r.seen.peak}`);
    for (const [k, v] of Object.entries(r.log)) console.log(`  ${pad(k, 11)} ${JSON.stringify(v)}`);
    console.log(`warnings (${r.warnings.length}):`);
    for (const w of r.warnings) console.log('  ' + w);
    if (r.before.unlocked || r.before.context) bad('live', 'a context existed before unlock()');
    if (r.errors.length) bad('live', 'page errors: ' + r.errors.join(' | '));
    if (r.log.started.state !== 'running') bad('live', 'context did not run: ' + r.log.started.state);
    if (r.log.paused.state !== 'running' || r.log.paused.played !== 2) bad('live', 'setPaused(true) must leave the context running and still play what is asked for');
    if (r.log.hidden.state !== 'suspended') bad('live', 'a hidden page did not suspend the context');
    if (r.log.hidden.played !== 0) bad('live', 'a one-shot was queued while the context stood still');
    if (r.log.shown.state !== 'running') bad('live', 'showing the page again did not resume the context');
    if (!(r.log.unfed.scheduled > 20) || r.log.unfed.mood !== 'brew' || r.log.unfed.voices !== 0) bad('live', 'without update() the engine does not keep time by itself');
    if (r.seen.voices > 28) bad('live', `voice limit broken: ${r.seen.voices}`);
    if (r.log.loopsOn.loops !== 12) bad('live', `expected 12 loops with nodes (11 near + 1 from before unlock), got ${r.log.loopsOn.loops}`);
    if (r.log.loopsOff.loops !== 0 || r.log.loopsOff.handles !== 0) bad('live', 'loops did not all stop');
    if (r.log.settled.voices !== 0) bad('live', `${r.log.settled.voices} voices never ended`);
    if (r.log.settled.live > r.log.started.live + 4) bad('live', `sources leaked: ${r.log.started.live} at the start, ${r.log.settled.live} at the end`);
    if (r.seen.peak >= 1) bad('live', `output reached full scale: ${r.seen.peak}`);
    if (r.warnings.length !== 6) bad('live', `expected exactly 6 warn-once messages, got ${r.warnings.length}`);
    if (r.warnings.some((w) => /failed/.test(w))) bad('live', 'an engine call threw');
    await open(); // a clean page for the rest
  }

  // --- the master chain -------------------------------------------------------------------------
  if (want('master')) {
    head('master chain');
    const m = (report.master = { makeup: await call('makeup'), chain: await call('chain'), reverb: await call('reverb'), pause: await call('pause') });
    console.log(`compressor make-up: measured ${m.makeup.measured}, engine compensates ${m.makeup.used}`);
    console.log(`quiet signal through the limiter: ${m.chain.gainDb} dB (ceiling is ${m.chain.expectedDb} dB)`);
    console.log(`reverb: ${m.reverb.wetDb} dB below the dry sound at a send of ${m.reverb.send}; ${m.reverb.atSendOneDb} dB at a send of 1`);
    console.log(`paused: score and world ${m.pause.worldDb} -> ${m.pause.worldPausedDb} dB, centroid ${m.pause.centroid} -> ${m.pause.centroidPaused} Hz; a ui click ${m.pause.uiDb} -> ${m.pause.uiPausedDb} dB`);
    if (Math.abs(m.makeup.measured - m.makeup.used) > 0.04) bad('master', 'COMP_MAKEUP in src/audio/index.js should be ' + m.makeup.measured);
    if (Math.abs(m.chain.gainDb - m.chain.expectedDb) > 0.6) bad('master', 'the limiter is not transparent for quiet signals');
    if (!(m.pause.worldPausedDb < m.pause.worldDb - 3) || !(m.pause.centroidPaused < m.pause.centroid * 0.7)) bad('master', 'setPaused(true) does not put the world and the score behind the curtain');
    if (Math.abs(m.pause.uiDb - m.pause.uiPausedDb) > 0.3) bad('master', 'setPaused(true) changes the interface sounds');
  }

  // --- where things are -------------------------------------------------------------------------
  if (want('place')) {
    head('placing (a waterfall, reference distance 10 m; right minus left in dB, and the level of both)');
    const p = (report.place = await call('placing'));
    const row = (label, x, note = '') => console.log(`${pad(label, 34)}${num(x.side, 7)}${num(x.both, 8)}  ${note}`);
    console.log(`${pad('', 34)}${'R - L'.padStart(7)}${'level'.padStart(8)}`);
    row('40 m to the right', p.right);
    row('40 m to the left', p.left);
    row('40 m in front', p.front);
    row('40 m behind', p.behind);
    row('40 m overhead', p.above);
    row('10 m to the right', p.nearRight, 'close, a source is wide: it leans less');
    row('at arm\'s length to the right', p.atHand);
    row('facing east, source to the south', p.turnedRight, 'south is to the right');
    row('facing east, source to the north', p.turnedLeft);
    row('both moved far from the origin', p.moved, 'must match the first row');
    row('20 m in front', p.at20, `${(p.at20.both - p.at10.both).toFixed(1)} dB against 10 m`);
    row('40 m in front', p.at40, `${(p.at40.both - p.at20.both).toFixed(1)} dB against 20 m`);
    row('400 m in front', p.outOfEarshot, 'out of earshot');
    const t = p.turn;
    console.log(`one turn on the spot (source to the right at the start): R - L ${t.start} -> ${t.quarter} -> ${t.half} -> ${t.threeQuarters} -> ${t.end} dB; between ${t.min} and ${t.max}; largest change in 50 ms ${t.jump} dB`);
    console.log(`${p.cost.loops} loops for 6 s: ${p.cost.stillMs} ms with the listener still, ${p.cost.movingMs} ms with it turning (${(p.cost.extraShare * 100).toFixed(1)} % of real time for the moving)`);
    if (!(p.right.side > 8)) bad('place', 'a source to the right is not on the right');
    if (!(p.left.side < -8)) bad('place', 'a source to the left is not on the left');
    if (Math.abs(p.right.side + p.left.side) > 1.5) bad('place', 'left and right are not mirror images');
    for (const k of ['front', 'behind', 'above']) if (Math.abs(p[k].side) > 1.5) bad('place', `a source ${k} leans to one side`);
    if (!(p.nearRight.side > 3 && p.nearRight.side < p.right.side - 3)) bad('place', 'a source at its reference distance should lean, but less than a far one');
    if (!(p.atHand.side > 0.3 && p.atHand.side < p.nearRight.side - 2)) bad('place', 'a source at arm\'s length should lean only a little');
    if (!(p.turnedRight.side > 8) || !(p.turnedLeft.side < -8)) bad('place', 'the heading is not followed');
    if (Math.abs(p.moved.side - p.right.side) > 0.5 || Math.abs(p.moved.both - p.right.both) > 0.5) bad('place', 'the listener position is not followed');
    for (const [a, b] of [['at10', 'at20'], ['at20', 'at40']]) {
      const d = p[b].both - p[a].both;
      if (!(d < -4.5 && d > -9)) bad('place', `doubling the distance (${a} to ${b}) changes the level by ${d.toFixed(1)} dB, not about -6`);
    }
    if (p.outOfEarshot.both > -150) bad('place', 'a source out of earshot is still heard');
    if (!(t.start > 8 && t.half < -8 && t.end > 8 && Math.abs(t.quarter) < 3 && Math.abs(t.threeQuarters) < 3)) bad('place', 'turning around does not carry the sound from ear to ear and back');
    if (t.jump > 3) bad('place', `the sound steps while the listener turns (${t.jump} dB in 50 ms)`);
    if (p.cost.extraShare > 0.04) bad('place', `moving the listener is expensive: ${(p.cost.extraShare * 100).toFixed(1)} % of real time`);
  }

  // --- one-shots --------------------------------------------------------------------------------
  const tune = { sfx: {}, loops: {}, moods: {} };
  if (want('sfx')) {
    head('one-shots (dry, before the limiter)');
    console.log(`${pad('name', 18)}${'want'.padStart(6)}${'loud'.padStart(7)}${'peak'.padStart(7)}${'rms'.padStart(7)}${'len'.padStart(7)}${'said'.padStart(7)}${'centr'.padStart(7)}${'dc'.padStart(8)}  flags`);
    const rows = [];
    for (const name of [...names.sfx, ...names.surfaces.map((s) => 'step_' + s)]) {
      const s = await call('sfxStats', name);
      rows.push(s);
      const f = [];
      if (s.nan) f.push(bad(name, `NaN x${s.nan}`));
      if (s.peak < 0.003) f.push(bad(name, 'SILENT'));
      if (Math.abs(s.dc) > 0.01) f.push(bad(name, `DC ${s.dc}`));
      if (s.end > s.declared + 0.2) f.push(bad(name, `TAIL CUT (sounds for ${s.end} s, recipe says ${s.declared})`));
      if (s.declared > s.end + 2.5) f.push(`declares ${s.declared} s`);
      if (s.onset > 0.08) f.push(`starts late ${s.onset}`);
      if (s.target == null) f.push(bad(name, 'no loudness class in dev/audio.js'));
      else {
        if (!calibrate && Math.abs(s.loudDb - s.target) > 1.5) f.push(bad(name, `LEVEL off by ${(s.loudDb - s.target).toFixed(1)} dB`));
        tune.sfx[name] = Math.min(12, Math.max(0.01, s.k * Math.pow(10, (s.target - s.loudDb) / 20)));
      }
      console.log(`${pad(name, 18)}${num(s.target ?? '-', 6, 0)}${num(s.loudDb, 7)}${num(s.peakDb, 7)}${num(s.rmsDb, 7)}${num(s.end, 7, 2)}${num(s.declared, 7, 2)}${num(s.centroid, 7, 0)}${num(s.dc, 8, 3)}  ${f.join(', ')}`);
    }
    report.sfx = rows.map((r) => ({ ...r, shape: undefined }));
    // look-alikes: the same picture of spectrum over time, and about the same length
    const cos = (a, b) => {
      let ab = 0,
        aa = 0,
        bb = 0;
      for (let i = 0; i < a.length; i++) {
        ab += a[i] * b[i];
        aa += a[i] * a[i];
        bb += b[i] * b[i];
      }
      return ab / Math.sqrt(aa * bb || 1);
    };
    const pairs = [];
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i],
          b = rows[j];
        if (a.peak < 0.003 || b.peak < 0.003) continue;
        const sim = cos(a.shape, b.shape),
          ratio = Math.max(a.end, b.end) / Math.max(0.01, Math.min(a.end, b.end));
        pairs.push({ a: a.name, b: b.name, sim, ratio });
      }
    }
    pairs.sort((x, y) => y.sim - x.sim);
    console.log('\nclosest pairs (1 = the same spectrum over time; flagged above 0.985 when the lengths are also within 1.5x):');
    for (const p of pairs.slice(0, 8)) {
      const alike = p.sim > 0.985 && p.ratio < 1.5 && !(p.a.startsWith('step_') && p.b.startsWith('step_'));
      console.log(`  ${pad(p.a + ' ~ ' + p.b, 40)} ${p.sim.toFixed(3)}  length x${p.ratio.toFixed(2)}${alike ? '  ' + bad(p.a + '/' + p.b, 'ALIKE') : ''}`);
    }
    report.pairs = pairs.slice(0, 20);
  }

  // --- loops ------------------------------------------------------------------------------------
  if (want('loops')) {
    head('loops (3 s low, 3 s high; dry, before the limiter)');
    console.log(`${pad('name', 12)}${'want'.padStart(6)}${'low rms'.padStart(9)}${'centr'.padStart(7)}${'high rms'.padStart(10)}${'centr'.padStart(7)}${'peak'.padStart(7)}${'dc'.padStart(8)}  flags`);
    report.loops = [];
    for (const name of names.loops) {
      const s = await call('loopStats', name);
      report.loops.push({ name, k: s.k, target: s.target, low: { ...s.low, shape: undefined }, high: { ...s.high, shape: undefined } });
      const f = [];
      if (s.low.nan || s.high.nan) f.push(bad(name, 'NaN'));
      if (s.high.peak < 0.003) f.push(bad(name, 'SILENT'));
      if (Math.abs(s.high.dc) > 0.01) f.push(bad(name, `DC ${s.high.dc}`));
      if (s.param && Math.abs(s.high.rmsDb - s.low.rmsDb) < 3 && Math.abs(s.high.centroid - s.low.centroid) < 0.1 * s.low.centroid) f.push(bad(name, 'PARAM changes nothing'));
      if (s.target == null) f.push(bad(name, 'no target level in dev/audio.js'));
      else {
        if (!calibrate && Math.abs(s.high.rmsDb - s.target) > 1.5) f.push(bad(name, `LEVEL off by ${(s.high.rmsDb - s.target).toFixed(1)} dB`));
        tune.loops[name] = Math.min(12, Math.max(0.01, s.k * Math.pow(10, (s.target - s.high.rmsDb) / 20)));
      }
      console.log(`${pad(name, 12)}${num(s.target ?? '-', 6, 0)}${num(s.low.rmsDb, 9)}${num(s.low.centroid, 7, 0)}${num(s.high.rmsDb, 10)}${num(s.high.centroid, 7, 0)}${num(s.high.peakDb, 7)}${num(s.high.dc, 8, 3)}  ${f.join(', ')}`);
    }
  }

  // --- music ------------------------------------------------------------------------------------
  if (want('music')) {
    const moodSecs = await page.evaluate(() => window.AUD.MOOD_SECS);
    head(`music (${moodSecs} s of each mood at intensity 0.7, with reverb, before the limiter)`);
    console.log(`${pad('mood', 10)}${'want'.padStart(6)}${'loud 3s'.padStart(9)}${'rms'.padStart(7)}${'peak'.padStart(7)}${'centr'.padStart(7)}${'dc'.padStart(8)}${'sources'.padStart(9)}${'render'.padStart(9)}  flags`);
    report.music = [];
    for (const mood of names.moods) {
      const s = await call('moodStats', mood, moodSecs, 0.7);
      report.music.push({ ...s, shape: undefined });
      const f = [];
      if (s.nan) f.push(bad(mood, `NaN x${s.nan}`));
      if (mood === 'none') {
        if (s.peak > 0.0005) f.push(bad(mood, 'not silent'));
      } else {
        if (s.peak < 0.003) f.push(bad(mood, 'SILENT'));
        if (s.peak > 0.9) f.push(bad(mood, 'HOT'));
        if (Math.abs(s.dc) > 0.01) f.push(bad(mood, `DC ${s.dc}`));
        if (s.target == null) f.push(bad(mood, 'no target level in dev/audio.js'));
        else {
          if (!calibrate && Math.abs(s.loud3Db - s.target) > 1.5) f.push(bad(mood, `LEVEL off by ${(s.loud3Db - s.target).toFixed(1)} dB`));
          tune.moods[mood] = Math.min(12, Math.max(0.01, s.k * Math.pow(10, (s.target - s.loud3Db) / 20)));
        }
      }
      console.log(`${pad(mood, 10)}${num(s.target ?? '-', 6, 0)}${num(s.loud3Db, 9)}${num(s.rmsDb, 7)}${num(s.peakDb, 7)}${num(s.centroid, 7, 0)}${num(s.dc, 8, 3)}${num(s.sources, 9, 0)}${num(s.ms + ' ms', 9)}  ${f.join(', ')}`);
    }
    // thin and full arrangements of one mood must differ
    const thin = await call('moodStats', 'title', 60, 0.1),
      full = await call('moodStats', 'title', 60, 1);
    console.log(`title over 60 s: intensity 0.1 -> ${thin.rmsDb} dB with ${thin.sources} sources; intensity 1 -> ${full.rmsDb} dB with ${full.sources} sources`);
    if (!(full.sources > thin.sources * 1.3) || !(full.rmsDb > thin.rmsDb + 2)) bad('music', 'intensity does not thin or thicken the arrangement');
  }

  // --- ambience ---------------------------------------------------------------------------------
  if (want('amb')) {
    head('ambience (20 s of each place, before the limiter)');
    console.log(`${pad('place', 12)}${'rms'.padStart(7)}${'>150Hz'.padStart(8)}${'>1kHz'.padStart(7)}${'peak'.padStart(7)}${'centr'.padStart(7)}${'dc'.padStart(8)}  flags`);
    report.amb = [];
    const presets = await page.evaluate(() => Object.keys(window.AUD.AMBIENCES));
    for (const name of presets) {
      const s = await call('ambStats', name);
      report.amb.push({ ...s, shape: undefined });
      const f = [];
      if (s.nan) f.push(bad(name, 'NaN'));
      if (s.peak < 0.001) f.push(bad(name, 'SILENT'));
      if (s.peak > 0.7) f.push(bad(name, 'HOT'));
      if (Math.abs(s.dc) > 0.01) f.push(bad(name, `DC ${s.dc}`));
      // a bed that lives below 150 Hz is nothing at all on a laptop
      if (s.rmsDb - s.above150Db > 12) f.push('nearly all of it is below 150 Hz');
      console.log(`${pad(name, 12)}${num(s.rmsDb, 7)}${num(s.above150Db, 8)}${num(s.above1kDb, 7)}${num(s.peakDb, 7)}${num(s.centroid, 7, 0)}${num(s.dc, 8, 3)}  ${f.join(', ')}`);
    }
  }

  // --- headroom ---------------------------------------------------------------------------------
  if (want('mix')) {
    head('headroom (through the limiter)');
    report.mix = [];
    for (const n of [20, 30, 40]) {
      const s = await call('burst', n);
      report.mix.push({ ...s, shape: undefined });
      console.log(`${pad(s.name, 16)} peak ${num(s.peak, 6, 3)} (${s.peakDb} dBFS)  rms ${s.rmsDb}  voices kept ${s.voices}  7 s rendered in ${s.ms} ms`);
      if (s.nan) bad(s.name, 'NaN');
      if (s.peak >= 0.999) bad(s.name, 'CLIPS');
      if (s.voices > 28) bad(s.name, 'voice limit broken');
      if (s.ms > 7000) bad(s.name, 'renders slower than real time');
    }
    const s = await call('mix');
    report.mix.push({ ...s, shape: undefined });
    console.log(`${pad(s.name, 16)} peak ${num(s.peak, 6, 3)} (${s.peakDb} dBFS)  rms ${s.rmsDb}  ${s.sources} sources  12 s rendered in ${s.ms} ms`);
    if (s.nan) bad(s.name, 'NaN');
    if (s.peak >= 0.999) bad(s.name, 'CLIPS');
    if (s.ms > 12000) bad(s.name, 'renders slower than real time');
  }

  // --- pictures and files -----------------------------------------------------------------------
  const picks = (list) => list.split(',').map((p) => p.split(':'));
  const shots = opt('shot') ? picks(opt('shot')) : want('shots') ? picks('sfx:fulminate_burst,sfx:bell,sfx:shatter,sfx:crow,sfx:rime_burst,sfx:lid_slide,loop:bubble,loop:shade,mood:title,mood:gloom,mood:opus,amb:shore_day,amb:vale_night,mix:worst') : [];
  if (shots.length) {
    head('spectrograms');
    for (const [kind, name, secs] of shots) {
      const s = await call('shot', kind, name, secs ? { secs: Number(secs) } : {});
      console.log(`${pad(kind + ':' + name, 24)} ${path.relative(root, s.file)}  peak ${s.peakDb} dBFS  rms ${s.rmsDb}`);
    }
  }
  if (opt('wav')) {
    head('wav files');
    for (const [kind, name, secs] of picks(opt('wav'))) console.log(path.relative(root, await call('wav', kind, name, secs ? { secs: Number(secs) } : {})));
  }
  if (flag('soak')) {
    const secs = Number(opt('soak') || 180);
    head(`soak: ${secs} s of real time, a new scene every 12 s`);
    await open();
    const s = (report.soak = await call('soak', secs));
    console.log(`${pad('t', 6)}${'sources'.padStart(8)}${'voices'.padStart(8)}${'loops'.padStart(7)}${'dying'.padStart(7)}${'sways'.padStart(7)}${'heap MB'.padStart(9)}`);
    const row = (label, x) => console.log(`${pad(label, 6)}${num(x.live, 8, 0)}${num(x.voices, 8, 0)}${num(x.loops, 7, 0)}${num(x.dying, 7, 0)}${num(x.sways, 7, 0)}${num(x.heapMb ?? '-', 9)}`);
    row('beds', s.base);
    for (let i = 0; i < s.samples.length; i += Math.max(1, Math.round(s.samples.length / 18))) row(s.samples[i].t + ' s', s.samples[i]);
    row('after', s.settled);
    console.log(`update(): mean ${s.seen.meanUpdateMs} ms, slowest ${s.seen.slowestUpdateMs} ms over ${s.seen.updates} calls; most at once ${s.seen.voices} voices, ${s.seen.loops} loops, ${s.seen.live} sources; highest output peak ${s.seen.peak}`);
    console.log(`longest update() calls: ${s.slow.map((x) => `${x.ms} ms at ${x.t} s (${x.mood}${x.scene ? ', new scene' : ''})`).join('; ')}`);
    console.log(`the calls of one frame (a new scene: music, ambience, five loops, six explosions) took at most ${s.seen.slowestCallsMs} ms`);
    console.log(`sources: ${s.liveFirst} on average in the first third, ${s.liveLast} in the last; movements: ${s.swaysFirst} then ${s.swaysLast}`);
    if (s.errors.length) bad('soak', 'page errors: ' + s.errors.join(' | '));
    if (s.warnings.length) bad('soak', 'warnings: ' + s.warnings.join(' | '));
    if (s.settled.state !== 'running') bad('soak', 'the context stopped: ' + s.settled.state);
    if (s.settled.voices !== 0 || s.settled.loops !== 0) bad('soak', 'voices or loops left over at the end');
    if (s.settled.live > s.base.live + 4) bad('soak', `sources leaked: ${s.base.live} before, ${s.settled.live} after`);
    if (s.settled.sways > s.base.sways) bad('soak', `movements leaked: ${s.base.sways} before, ${s.settled.sways} after`);
    if (s.liveLast > s.liveFirst * 1.3 + 20) bad('soak', 'the number of sources grows over time');
    if (s.swaysLast > s.swaysFirst * 1.3 + 10) bad('soak', 'the number of movements grows over time');
    if (s.seen.meanUpdateMs > 2) bad('soak', `update() is slow: ${s.seen.meanUpdateMs} ms on average`);
    if (s.seen.voices > 28) bad('soak', `voice limit broken: ${s.seen.voices}`);
    if (s.seen.peak >= 1) bad('soak', `output reached full scale: ${s.seen.peak}`);
  }
  if (opt('players')) {
    const mood = opt('players'),
      intensity = Number(opt('intensity') || 1);
    head(`${mood}: every player alone at intensity ${intensity}`);
    console.log(`${pad('player', 10)}${'from'.padStart(6)}${'loud 3s'.padStart(9)}${'rms'.padStart(7)}${'peak'.padStart(7)}${'>150Hz'.padStart(8)}${'centr'.padStart(7)}${'sources'.padStart(9)}`);
    const of = opt('of') ? opt('of').split(',') : null;
    for (const s of (report.players = await call('players', mood, Number(opt('secs') || 90), intensity, of))) console.log(`${pad(s.name, 10)}${num(s.from, 6, 2)}${num(s.loud3Db, 9)}${num(s.rmsDb, 7)}${num(s.peakDb, 7)}${num(s.above150Db, 8)}${num(s.centroid, 7, 0)}${num(s.sources, 9, 0)}`);
  }
  if (opt('long')) {
    const secs = Number(opt('secs') || 600);
    head(`${opt('long')}: ${secs} s, level every 5 s`);
    const s = (report.long = await call('long', opt('long'), secs, Number(opt('intensity') || 0.6)));
    const hi = Math.max(...s.trace),
      lo = hi - 36;
    for (let i = 0; i < s.trace.length; i += 60) console.log(`${String(i * 5).padStart(5)} s |${spark(s.trace.slice(i, i + 60), lo, hi)}|`);
    console.log(`rendered in ${s.ms} ms, ${s.sources} sources; peak ${s.peakDb} dBFS, rms ${s.rmsDb}, median ${s.medianDb}`);
    console.log(`the loudest tenth of the time stands ${s.spanDb} dB above the quietest tenth; ${(s.quietShare * 100).toFixed(0)} % is more than 12 dB below the loudest moment; first half ${s.firstHalfDb} dB, second half ${s.secondHalfDb} dB`);
    if (s.nan) bad('long', 'NaN');
    if (Math.abs(s.firstHalfDb - s.secondHalfDb) > 4) bad('long', 'the level drifts over time');
    // A written piece does not fall silent between phrases: it thins to a few players and fills
    // again. So the question is whether it has light and shade, not whether it stops. The Gloom is
    // meant to press on.
    if (s.spanDb < 3 && s.name !== 'gloom') bad('long', 'no light and shade: the level hardly moves');
  }

  // --- calibration ------------------------------------------------------------------------------
  if (calibrate) {
    const table = (o) => `{\n${Object.keys(o).map((k) => `  ${k}: ${Number(o[k].toPrecision(3))},`).join('\n')}\n}`;
    const text = `// Level trims. Written by \`node tools/audio-check.mjs --calibrate\`, which renders every sound,
// measures it and scales it to the loudness its class should have. Do not edit by hand: change the
// class of a sound in dev/audio.js and calibrate again.
export const SFX_K = ${table(tune.sfx)};
export const LOOP_K = ${table(tune.loops)};
export const MOOD_K = ${table(tune.moods)};
`;
    fs.writeFileSync(path.join(root, 'src/audio/levels.js'), text);
    console.log('\nwrote src/audio/levels.js; run the check again to confirm');
    problems.length = 0;
  }

  const pageErrors = logs.filter((l) => /^\[(error|pageerror)\]/.test(l));
  if (pageErrors.length) bad('page', pageErrors.slice(0, 5).join(' | '));
  head(problems.length ? `${problems.length} PROBLEM(S)` : 'ALL CLEAR');
  for (const p of problems) console.log('  ' + p);
  failed = problems.length > 0;
  fs.mkdirSync(path.join(root, 'shots'), { recursive: true });
  fs.writeFileSync(path.join(root, 'shots/audio_report.json'), JSON.stringify({ problems, ...report }, null, 1));
} catch (e) {
  console.log('FAILED: ' + (e.stack || e.message));
  failed = true;
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
