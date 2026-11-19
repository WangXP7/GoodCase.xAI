// Offline audio render and measurement. Bundles src/audio, runs it in headless Chromium (real Web Audio:
// convolvers, compressor, HRTF panners) via OfflineAudioContext, writes WAVs and prints measurements.
//
//   npm run audio -- --name pistol        dry buffers of every variant -> WAV + metrics + per-second table
//   npm run audio -- --name pistol --wet  same sound through the full graph (reverb, master chain)
//   npm run audio -- --name mix           the 20 s scripted sequence through the full graph
//   npm run audio -- --name ambience [--area canopy]   10 s of beds only
//   npm run audio -- --all                metrics table for every buffer, WAV per sound
//   npm run audio -- --check              every check below; exit 1 on fail
//   npm run audio -- --weapons            each weapon's shot (dry buffer and through the graph, open and
//                                         room), the distinctness table and pairwise check
//   npm run audio -- --busy               the 30 s busy round (SMG fire, a frag, 12 zombies, rain, a purchase)
//   npm run audio -- --stress [--cap 24]  24 zombies, 8 s of LMG fire, a frag: clipping and the voice cap
//   npm run audio -- --buffers            every buffer: DC offset, first/last sample, loop seams
//   options: --seed <n>, --out <dir>  (default $TMPDIR/graveyard-shift/audio)
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root, scratch, launch } from './lib.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const flag = (k) => argv.includes(`--${k}`);
const SEED = Number(arg('seed', 1));
const OUT = arg('out', join(scratch, 'audio'));
mkdirSync(OUT, { recursive: true });

// ------------------------------------------------------------ analysis (Node side)

const dB = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '-inf');

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

// Power spectrum summed over Hann frames of `x` (mono). Returns Float64Array of bin powers.
function spectrum(x, sr, N = 4096) {
  const P = new Float64Array(N / 2);
  const hop = N / 2;
  const frames = Math.max(1, Math.ceil((x.length - N) / hop) + 1);
  for (let f = 0; f < frames; f++) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const v = x[f * hop + i] ?? 0;
      re[i] = v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
    }
    fft(re, im);
    for (let k = 0; k < N / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k];
  }
  return { P, binHz: sr / N };
}

const BANDS = [['sub', 0, 150], ['low', 150, 500], ['mid', 500, 2000], ['high', 2000, 6000], ['air', 6000, 24000]];
function spectralStats(x, sr) {
  const { P, binHz } = spectrum(x, sr);
  let tot = 0, wsum = 0, bodyHz = 0, bodyP = 0;
  const bands = Object.fromEntries(BANDS.map(([n]) => [n, 0]));
  for (let k = 1; k < P.length; k++) {
    const f = k * binHz;
    tot += P[k]; wsum += P[k] * f;
    for (const [n, lo, hi] of BANDS) if (f >= lo && f < hi) bands[n] += P[k];
    if (f >= 80 && f <= 800 && P[k] > bodyP) { bodyP = P[k]; bodyHz = f; }
  }
  for (const k of Object.keys(bands)) bands[k] = tot > 0 ? (100 * bands[k]) / tot : 0;
  return { centroid: tot > 0 ? wsum / tot : 0, bands, bodyHz };
}

const monoOf = (chans) => {
  if (chans.length === 1) return chans[0];
  const m = new Float32Array(chans[0].length);
  for (let i = 0; i < m.length; i++) m[i] = 0.5 * (chans[0][i] + chans[1][i]);
  return m;
};

// Envelope in `win`-second RMS windows, max over channels.
function envelope(chans, sr, win) {
  const w = Math.max(1, Math.round(win * sr)), n = Math.ceil(chans[0].length / w);
  const e = new Float64Array(n);
  for (const c of chans) {
    for (let j = 0; j < n; j++) {
      let s = 0;
      const a = j * w, b = Math.min(c.length, a + w);
      for (let i = a; i < b; i++) s += c[i] * c[i];
      e[j] = Math.max(e[j], Math.sqrt(s / Math.max(1, b - a)));
    }
  }
  return { e, dt: w / sr };
}

function metrics(chans, sr) {
  let peak = 0, ss = 0, cnt = 0;
  for (const c of chans) for (let i = 0; i < c.length; i++) { const v = Math.abs(c[i]); if (v > peak) peak = v; ss += c[i] * c[i]; cnt++; }
  const fine = envelope(chans, sr, 0.0005);
  let emax = 0, imax = 0;
  fine.e.forEach((v, i) => { if (v > emax) { emax = v; imax = i; } });
  let onset = 0;
  while (onset < fine.e.length && fine.e[onset] < emax * 0.01) onset++;
  const coarse = envelope(chans, sr, 0.005);
  let cmax = 0, cimax = 0;
  coarse.e.forEach((v, i) => { if (v > cmax) { cmax = v; cimax = i; } });
  const lastAbove = (r) => { for (let i = coarse.e.length - 1; i >= 0; i--) if (coarse.e[i] >= cmax * r) return i; return cimax; };
  const mono = monoOf(chans);
  const sp = spectralStats(mono, sr);
  const head = mono.subarray(Math.round(onset * fine.dt * sr), Math.round(onset * fine.dt * sr) + Math.round(0.004 * sr));
  const crack = spectralStats(head, sr);
  return {
    dur: chans[0].length / sr, peakDb: dB(peak), rmsDb: dB(Math.sqrt(ss / cnt)),
    attackMs: (imax - onset) * fine.dt * 1000,
    t20: (lastAbove(0.1) - cimax) * coarse.dt, t40: (lastAbove(0.01) - cimax) * coarse.dt,
    audible: (lastAbove(0.001) + 1) * coarse.dt,
    centroid: sp.centroid, bands: sp.bands, bodyHz: sp.bodyHz, crackCentroid: crack.centroid,
  };
}

function perSecond(chans, sr) {
  const rows = [];
  const n = Math.ceil(chans[0].length / sr);
  for (let s = 0; s < n; s++) {
    const seg = chans.map((c) => c.subarray(s * sr, Math.min(c.length, (s + 1) * sr)));
    let peak = 0, ss = 0, cnt = 0;
    for (const c of seg) for (let i = 0; i < c.length; i++) { const v = Math.abs(c[i]); if (v > peak) peak = v; ss += c[i] * c[i]; cnt++; }
    rows.push({ s, peakDb: dB(peak), rmsDb: dB(Math.sqrt(ss / Math.max(1, cnt))), centroid: spectralStats(monoOf(seg), sr).centroid });
  }
  return rows;
}

function printPerSecond(rows) {
  console.log('  sec   peak dBFS   RMS dBFS   centroid Hz');
  for (const r of rows) console.log(`  ${String(r.s).padStart(3)}   ${f1(r.peakDb).padStart(9)}   ${f1(r.rmsDb).padStart(8)}   ${Math.round(r.centroid).toString().padStart(11)}`);
}

const HDR = 'name               dur s  peak  RMS dB  atk ms  T20 s  T40 s  audbl s  centroid  body Hz  crack Hz   sub/low/mid/high/air %';
function metricRow(name, m) {
  const b = m.bands;
  return `${name.padEnd(18)} ${m.dur.toFixed(2).padStart(5)}  ${f1(m.peakDb).padStart(5)}  ${f1(m.rmsDb).padStart(6)}  ${m.attackMs.toFixed(1).padStart(6)}  ${m.t20.toFixed(2).padStart(5)}  ${m.t40.toFixed(2).padStart(5)}  ${m.audible.toFixed(2).padStart(7)}  ${Math.round(m.centroid).toString().padStart(8)}  ${Math.round(m.bodyHz).toString().padStart(7)}  ${Math.round(m.crackCentroid).toString().padStart(8)}   ${[b.sub, b.low, b.mid, b.high, b.air].map((v) => v.toFixed(0)).join('/')}`;
}

function writeWav(path, chans, sr) {
  const n = chans[0].length, C = chans.length;
  const buf = Buffer.alloc(44 + n * C * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * C * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(C, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * C * 2, 28); buf.writeUInt16LE(C * 2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * C * 2, 40);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < C; c++) {
    const v = Math.max(-1, Math.min(1, chans[c][i]));
    buf.writeInt16LE(Math.round(v * 32767), o); o += 2;
  }
  writeFileSync(path, buf);
}

// Concatenate variants (mono upmixed when mixed with stereo) with gaps.
function concat(list, sr, gap = 0.4) {
  const C = Math.max(...list.map((l) => l.length));
  const n = list.reduce((a, l) => a + l[0].length + Math.round(gap * sr), 0);
  const out = Array.from({ length: C }, () => new Float32Array(n));
  let o = 0;
  for (const l of list) {
    for (let c = 0; c < C; c++) out[c].set(l[Math.min(c, l.length - 1)], o);
    o += l[0].length + Math.round(gap * sr);
  }
  return out;
}

// ------------------------------------------------------------ browser side

async function bundle() {
  const r = await build({
    stdin: {
      contents: `import { createAudio, TEST_SCRIPT, DEFS } from './src/audio/engine.js';
        import { createRng } from './src/core/rng.js';
        import { WEAPON_IDS } from './src/audio/weapons.js';
        window.__A = { createAudio, TEST_SCRIPT, DEFS, createRng, WEAPON_IDS };`,
      resolveDir: root, loader: 'js',
    },
    bundle: true, write: false, format: 'iife', target: 'es2022',
  });
  return r.outputFiles[0].text;
}

const PAGE_HELPERS = `
  window.__b64 = (f) => { const u = new Uint8Array(f.buffer, f.byteOffset, f.byteLength); let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  window.__boot = (seed) => { window.__a = window.__A.createAudio({ rng: window.__A.createRng(seed) });
    const t0 = performance.now(); const st = window.__a.synth.synthAll(); return { ...st, wallMs: performance.now() - t0 }; };
  // Same synthesis as the game does it: 8 ms slices. Reports the longest slice (worst frame hitch).
  window.__progressive = (seed) => { const a = window.__A.createAudio({ rng: window.__A.createRng(seed) });
    let maxSlice = 0, slices = 0; const t0 = performance.now();
    while (a.synth.pending() > 0) { const s = performance.now(); a.synth.run(8); maxSlice = Math.max(maxSlice, performance.now() - s); slices++; }
    return { maxSlice, slices, wallMs: performance.now() - t0, key: a.synth.stats.maxSliceKey }; };`;

const decode = (chans) => chans.map((b) => { const B = Buffer.from(b, 'base64'); return new Float32Array(B.buffer, B.byteOffset, B.byteLength / 4); });

async function main() {
  const code = await bundle();
  const browser = await launch();
  try {
    // Never wait unbounded: every render runs under a 60 s limit; a page that misses it is closed and a
    // fresh one booted (the sound is reported unmeasured). The whole run has a hard cap too.
    const errs = [];
    let page = null;
    async function openPage() {
      if (page) await page.close().catch(() => {});
      page = await browser.newPage();
      page.on('pageerror', (e) => errs.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
      await page.setContent('<!doctype html><html><body></body></html>');
      await page.addScriptTag({ content: code });
      await page.addScriptTag({ content: PAGE_HELPERS });
    }
    async function freshPage() { await openPage(); await page.evaluate((s) => window.__boot(s), SEED); }
    const LIMIT_MS = Number(arg('limit', 60)) * 1000;
    async function guarded(fn) {
      let timer;
      const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`render exceeded ${LIMIT_MS / 1000} s`)), LIMIT_MS); });
      try { return await Promise.race([fn(), timeout]); } catch (e) { await freshPage(); throw e; } finally { clearTimeout(timer); }
    }
    const watchdog = setTimeout(() => { console.error(`audio-render: hard cap of ${arg('cap-min', 20)} min reached, closing the browser`); browser.close().finally(() => process.exit(1)); }, Number(arg('cap-min', 20)) * 60000);
    watchdog.unref();
    await openPage();
    const prog = await page.evaluate((s) => window.__progressive(s), SEED);
    console.log(`progressive synthesis (8 ms slices): ${prog.slices} slices, longest slice ${prog.maxSlice.toFixed(1)} ms (${prog.key}), ${prog.wallMs.toFixed(0)} ms CPU in total`);
    const synth = await page.evaluate((s) => window.__boot(s), SEED);
    const slow = Object.entries(synth.jobs).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ');
    console.log(`synthesis: ${synth.count} buffers, ${synth.totalMs.toFixed(0)} ms total CPU (${synth.wallMs.toFixed(0)} ms wall); slowest jobs ms: ${slow}`);
    const SRATE = 48000;
    const defs = await page.evaluate(() => Object.fromEntries(Object.entries(window.__A.DEFS).map(([k, v]) => [k, v.variants])));
    const rates = await page.evaluate(() => Object.fromEntries(Object.entries(window.__A.DEFS).map(([k, v]) => [k, v.sr || 48000])));
    const getRaw = (name, i) => guarded(() => page.evaluate(([n, v]) => window.__a.synth.get(`${n}.${v}`).map(window.__b64), [name, i])).then(decode);
    const renderOffline = (opts) => guarded(() => page.evaluate(async (o) => (await window.__a.renderOffline(o)).map(window.__b64), opts)).then(decode);
    const testScript = await page.evaluate(() => window.__A.TEST_SCRIPT);

    const name = arg('name');
    if (flag('list')) {
      for (const [k, v] of Object.entries(defs)) console.log(`${k} x${v}`);
    }

    if (flag('all')) {
      console.log(HDR);
      for (const [k, v] of Object.entries(defs)) {
        const list = [];
        for (let i = 0; i < v; i++) {
          const ch = await getRaw(k, i);
          list.push(ch);
          console.log(metricRow(`${k}.${i}`, metrics(ch, rates[k])));
        }
        writeWav(join(OUT, `${k}.wav`), concat(list, rates[k]), rates[k]);
      }
      console.log(`WAVs in ${OUT}`);
    }

    if (name && name !== 'mix' && name !== 'ambience') {
      if (!defs[name]) throw new Error(`unknown sound "${name}" (use --list)`);
      const list = [];
      console.log(HDR);
      for (let i = 0; i < defs[name]; i++) {
        let ch;
        if (flag('wet')) {
          // Through the full graph. --ev <event> fires a game event instead (e.g. weapon:fire adds the
          // area tail and casing); --area canopy switches the space; --dist d places it d metres ahead.
          const dist = Number(arg('dist', 0)), ev = arg('ev');
          const opts = dist ? { pos: [0, 1.6, -dist], variant: i } : { variant: i };
          const script = [{ t: 0, area: arg('area', 'open') }, ev ? { t: 0.05, ev, p: { pos: [0, 1.6, 0], dir: [0, 0, -1] } } : { t: 0.05, sound: name, opts }];
          ch = await renderOffline({ seconds: 4, ambience: false, script });
        } else ch = await getRaw(name, i);
        list.push(ch);
        console.log(metricRow(`${name}.${i}`, metrics(ch, flag('wet') ? SRATE : rates[name])));
      }
      const R = flag('wet') ? SRATE : rates[name];
      const all = concat(list, R);
      const file = join(OUT, `${name}${flag('wet') ? '-wet' : ''}.wav`);
      writeWav(file, all, R);
      printPerSecond(perSecond(all, R));
      console.log(`wrote ${file}`);
    }

    if (name === 'ambience') {
      const area = arg('area', 'open');
      const ch = await renderOffline({ seconds: 10, script: [{ t: 0, area }] });
      const file = join(OUT, `ambience-${area}.wav`);
      writeWav(file, ch, SRATE);
      console.log(HDR); console.log(metricRow(`ambience-${area}`, metrics(ch, SRATE)));
      printPerSecond(perSecond(ch, SRATE));
      console.log(`wrote ${file}`);
    }

    if (flag('events')) {
      // Each scripted event rendered alone through the full graph (no rain): its own output level.
      console.log('isolated event levels (full graph, no ambience):');
      console.log('     t  event            peak dBFS  RMS(2 s) dBFS');
      for (const e of testScript) {
        if (e.area) continue;
        const ch = await renderOffline({ seconds: 2, ambience: false, script: [{ ...e, t: 0.05 }] });
        const m = metrics(ch, SRATE);
        console.log(`  ${e.t.toFixed(2).padStart(5)}  ${(e.ev || e.sound).padEnd(15)} ${f1(m.peakDb).padStart(9)}  ${f1(m.rmsDb).padStart(9)}`);
      }
    }

    let failed = false;
    if (name === 'mix' || flag('check')) {
      const ch = await renderOffline({ seconds: 20, script: testScript });
      const file = join(OUT, 'mix.wav');
      writeWav(file, ch, SRATE);
      const rows = perSecond(ch, SRATE);
      printPerSecond(rows);
      console.log(`wrote ${file}`);
      const win = (a, b) => ch.map((c) => c.subarray(Math.round(a * SRATE), Math.round(b * SRATE)));
      const pk = (w) => Math.max(...w.map((c) => c.reduce((m, v) => Math.max(m, Math.abs(v)), 0)));
      const rms = (w) => Math.sqrt(w.reduce((s, c) => s + c.reduce((a, v) => a + v * v, 0), 0) / w.reduce((a, c) => a + c.length, 0));
      const peak = pk(ch);
      const rain = win(0.5, 2.3), rainPeak = pk(rain), rainRms = rms(rain);
      const gunPeak = pk(win(8.5, 8.8));
      console.log('\nevents (peak in [t, t+0.5] vs rain-only peak):');
      for (const e of testScript) {
        const label = e.ev || e.sound || `area:${e.area}`;
        if (e.area) continue;
        console.log(`  ${e.t.toFixed(2).padStart(6)}  ${label.padEnd(14)} ${f1(dB(pk(win(e.t, e.t + 0.5)))).padStart(6)} dBFS  (+${f1(dB(pk(win(e.t, e.t + 0.5))) - dB(rainPeak))} dB)`);
      }
      const checks = [
        [`no clipping: peak ${peak.toFixed(3)} < 0.98`, peak < 0.98],
        [`gunshot peak ${f1(dB(gunPeak))} dBFS is ${f1(dB(gunPeak) - dB(rainPeak))} dB over rain-bed peak ${f1(dB(rainPeak))} dBFS (RMS ${f1(dB(rainRms))}); need >= 12`, dB(gunPeak) - dB(rainPeak) >= 12],
        [`nothing silent: quietest second RMS ${f1(Math.min(...rows.map((r) => r.rmsDb)))} dBFS > -50`, rows.every((r) => r.rmsDb > -50)],
      ];
      // Every buffer must carry signal.
      let quiet = [];
      for (const [k, v] of Object.entries(defs)) for (let i = 0; i < v; i++) {
        const m = metrics(await getRaw(k, i), rates[k]);
        if (!(m.peakDb > -12 && m.rmsDb > -45)) quiet.push(`${k}.${i} (${f1(m.peakDb)}/${f1(m.rmsDb)})`);
      }
      checks.push([`every buffer non-silent (peak > -12 dBFS, RMS > -45 dBFS)${quiet.length ? ': FAIL ' + quiet.join(', ') : ''}`, quiet.length === 0]);
      console.log('\nchecks:');
      for (const [label, ok] of checks) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failed = true; }
    }
    // ---------------------------------------------------------------- weapons
    const WIDS = await page.evaluate(() => window.__A.WEAPON_IDS);
    const shotOf = (id) => (id === 'pistol' ? 'pistol' : `shot_${id}`);
    const fireAt = (id, area, extra = {}) => [{ t: 0, area }, { t: 0.05, ev: 'weapon:fire', p: { pos: [0, 1.6, 0], dir: [0, 0, -1], weapon: id, ...extra } }];
    if (flag('weapons') || flag('check')) {
      console.log('\nweapon shots: raw = the shot buffer alone; open/diner = weapon:fire through the full graph (shot + tail + casing + reverb), no rain');
      console.log('id            dur s  peak dB  RMS dB  centroid  body Hz  crack Hz  low% (sub+low)  bright% (high+air)  audible raw s | open: T40 s  audible s  peak dB | diner: audible s  centroid');
      const rows = [];
      for (const id of WIDS) {
        const raw = await getRaw(shotOf(id), 0), R = rates[shotOf(id)];
        const m = metrics(raw, R);
        const open = await renderOffline({ seconds: 3.5, ambience: false, script: fireAt(id, 'open') });
        const mo = metrics(open, SRATE);
        const room = await renderOffline({ seconds: 3.5, ambience: false, script: fireAt(id, 'diner') });
        const mr = metrics(room, SRATE);
        writeWav(join(OUT, `weapon-${id}-raw.wav`), raw, R);
        writeWav(join(OUT, `weapon-${id}-open.wav`), open, SRATE);
        writeWav(join(OUT, `weapon-${id}-diner.wav`), room, SRATE);
        const low = m.bands.sub + m.bands.low, bright = m.bands.high + m.bands.air;
        rows.push({ id, m, mo, mr, low, bright });
        console.log(`${id.padEnd(12)} ${m.dur.toFixed(2).padStart(6)}  ${f1(m.peakDb).padStart(7)}  ${f1(m.rmsDb).padStart(6)}  ${Math.round(m.centroid).toString().padStart(8)}  ${Math.round(m.bodyHz).toString().padStart(7)}  ${Math.round(m.crackCentroid).toString().padStart(8)}  ${low.toFixed(0).padStart(14)}  ${bright.toFixed(0).padStart(18)}  ${m.audible.toFixed(2).padStart(12)} | ${mo.t40.toFixed(2).padStart(10)}  ${mo.audible.toFixed(2).padStart(9)}  ${f1(mo.peakDb).padStart(7)} | ${mr.audible.toFixed(2).padStart(16)}  ${Math.round(mr.centroid).toString().padStart(8)}`);
      }
      // upgraded and suppressed variants of two weapons, to show they differ from the plain shot
      for (const [id, extra] of [['rifle', { upgraded: true }], ['rifle', { suppressed: true }], ['smg', { suppressed: true }]]) {
        const ch = await renderOffline({ seconds: 3.5, ambience: false, script: fireAt(id, 'open', extra) });
        const mm = metrics(ch, SRATE);
        console.log(`  ${id} ${Object.keys(extra)[0]}: peak ${f1(mm.peakDb)} dBFS, centroid ${Math.round(mm.centroid)} Hz, audible ${mm.audible.toFixed(2)} s`);
        writeWav(join(OUT, `weapon-${id}-${Object.keys(extra)[0]}.wav`), ch, SRATE);
      }
      const bad = [];
      for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i], b = rows[j];
        const dc = Math.abs(a.m.centroid - b.m.centroid) / Math.min(a.m.centroid, b.m.centroid);
        const dl = Math.abs(a.m.audible - b.m.audible) / Math.min(a.m.audible, b.m.audible);
        if (dc < 0.08 && dl < 0.2) bad.push(`${a.id}/${b.id} (centroid ${(dc * 100).toFixed(1)} %, length ${(dl * 100).toFixed(1)} %)`);
      }
      const ok = bad.length === 0;
      console.log(`  ${ok ? 'PASS' : 'FAIL'}  ten shots pairwise: centroids >= 8 % apart or audible lengths >= 20 % apart${ok ? '' : ': ' + bad.join(', ')}`);
      if (!ok) failed = true;
    }

    // ---------------------------------------------------------------- busy round, stress
    const ring = (n, r0, r1, seed) => { const out = []; let s = seed; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
      for (let i = 0; i < n; i++) { const a = rnd() * Math.PI * 2, r = r0 + rnd() * (r1 - r0); out.push({ id: 100 + i, pos: { x: Math.cos(a) * r, y: 0, z: Math.sin(a) * r }, type: ['walker', 'walker', 'runner', 'armoured', 'walker', 'bloater'][i % 6], state: 'walk', alive: true }); }
      return out; };
    const pv = (z) => [z.pos.x, 1.4, z.pos.z];
    async function mixRun(label, { seconds, script, zombies, cap, shots }) {
      const ch = await renderOffline({ seconds, script, zombies, cap, ambience: true });
      const st = await page.evaluate(() => window.__a.lastOffline);
      writeWav(join(OUT, `${label}.wav`), ch, SRATE);
      const win = (a, b) => ch.map((c) => c.subarray(Math.round(a * SRATE), Math.round(b * SRATE)));
      const pk = (w) => Math.max(...w.map((c) => c.reduce((m, v) => Math.max(m, Math.abs(v)), 0)));
      const peak = pk(ch), rainPeak = pk(win(0.1, 0.9));
      const rows = perSecond(ch, SRATE);
      let minShot = Infinity;
      for (const t of shots) minShot = Math.min(minShot, dB(pk(win(t, t + 0.05))) - dB(rainPeak));
      let dc = 0; for (const c of ch) { let m = 0; for (let i = 0; i < c.length; i++) m += c[i]; dc = Math.max(dc, Math.abs(m / c.length)); }
      console.log(`\n${label}: ${seconds} s, ${zombies.length} zombies, ${shots.length} shots, cap ${cap ?? 32}; voices peak ${st.peak}, stolen ${st.stolen}, dropped ${st.dropped} (of them priority 2-3: ${st.droppedTop})`);
      printPerSecond(rows);
      const checks = [
        [`${label}: peak ${peak.toFixed(3)} < 0.98 (no clipping at the limiter)`, peak < 0.98],
        [`${label}: quietest shot ${f1(minShot)} dB over the rain-bed peak ${f1(dB(rainPeak))} dBFS; need >= 12`, !shots.length || minShot >= 12],
        [`${label}: nothing silent: quietest second RMS ${f1(Math.min(...rows.map((r) => r.rmsDb)))} dBFS > -50`, rows.every((r) => r.rmsDb > -50)],
        [`${label}: DC offset ${dc.toExponential(1)} < 1e-3`, dc < 1e-3],
        [`${label}: voices peak ${st.peak} <= cap ${cap ?? 32}`, st.peak <= (cap ?? 32)],
        [`${label}: no priority-2/3 voice (the player's weapon, near threats) dropped by the cap: ${st.droppedTop}`, st.droppedTop === 0],
      ];
      for (const [l, ok] of checks) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}`); if (!ok) failed = true; }
    }
    if (flag('busy') || flag('check')) {
      const zs = ring(12, 4, 20, 7);
      const script = [{ t: 0.95, ev: 'round:start', p: { n: 3, total: 18 } }];
      zs.forEach((z, i) => script.push({ t: 1 + i * 0.4, ev: 'zombie:spawn', p: { id: z.id, pos: pv(z), type: z.type } }));
      const shots = [];
      for (const [t0, n] of [[8, 18], [12.5, 12], [21, 20]]) for (let k = 0; k < n; k++) {
        const t = t0 + k * (60 / 780);
        shots.push(t);
        script.push({ t, ev: 'weapon:fire', p: { pos: [0, 1.6, 0], dir: [0, 0, -1], weapon: 'smg' } });
        if (k % 3 === 0) { const z = zs[k % zs.length]; script.push({ t: t + 0.02, ev: 'hit:zombie', p: { id: z.id, pos: pv(z), part: 'torso', damage: 32, killed: false, source: 'bullet' } }); }
        else script.push({ t: t + 0.03, ev: 'hit:world', p: { pos: [k % 5 - 2, 0.5, -12], surface: k % 4 ? 'asphalt' : 'metal' } });
      }
      script.push({ t: 14.2, ev: 'weapon:reload', p: { weapon: 'smg' } });
      script.push({ t: 16, ev: 'throw', p: { kind: 'frag' } });
      script.push({ t: 18.4, ev: 'explosion', p: { pos: [3, 0.2, -10], kind: 'frag', radius: 6 } });
      script.push({ t: 18.45, ev: 'zombie:die', p: { id: zs[0].id, pos: pv(zs[0]), type: zs[0].type } });
      script.push({ t: 19.5, ev: 'zombie:attack', p: { id: zs[1].id, pos: [0.5, 1.4, -1.5], type: zs[1].type, kind: 'swing' } });
      script.push({ t: 20, ev: 'player:damage', p: { amount: 34 } });
      script.push({ t: 25, ev: 'buy', p: { item: 'wallAmmo', cost: 250 } });
      script.push({ t: 26, ev: 'step', p: { pos: [0, 0, 0], surface: 'asphalt' } });
      await mixRun('busy-round', { seconds: 30, script, zombies: zs, shots });
    }
    if (flag('stress') || flag('check')) {
      for (const cap of flag('check') ? [32, 24] : [Number(arg('cap', 32))]) {
        const zs = ring(24, 2.5, 15, 3);
        zs[5].type = 'brute'; zs[11].type = 'brute';
        const script = [{ t: 0.95, ev: 'round:start', p: { n: 10, total: 30, boss: true } }];
        zs.forEach((z, i) => script.push({ t: 1 + i * 0.05, ev: 'zombie:spawn', p: { id: z.id, pos: pv(z), type: z.type } }));
        const shots = [];
        for (let k = 0, t = 2; t < 10; k++, t += 60 / 560) {
          shots.push(t);
          script.push({ t, ev: 'weapon:fire', p: { pos: [0, 1.6, 0], dir: [0, 0, -1], weapon: 'lmg' } });
          const z = zs[k % zs.length];
          script.push({ t: t + 0.02, ev: 'hit:zombie', p: { id: z.id, pos: pv(z), part: k % 7 ? 'torso' : 'head', damage: 62, killed: false, source: 'bullet' } });
          if (k % 4 === 0) script.push({ t: t + 0.05, ev: 'zombie:attack', p: { id: zs[(k + 3) % 24].id, pos: pv(zs[(k + 3) % 24]), type: zs[(k + 3) % 24].type, kind: 'swing' } });
        }
        script.push({ t: 6, ev: 'explosion', p: { pos: [2, 0.2, -6], kind: 'frag', radius: 6 } });
        script.push({ t: 6.3, ev: 'zombie:attack', p: { id: zs[5].id, pos: pv(zs[5]), type: 'brute', kind: 'slam' } });
        // the rain-only window must stay rain only: the stress run's own shots are checked against it too
        await mixRun(`stress-cap${cap}`, { seconds: 12, script, zombies: zs, cap, shots });
      }
    }

    // ---------------------------------------------------------------- catalog
    // Each event alone through the full graph (no rain), the pistol in every space, the beds by space.
    if (flag('catalog')) {
      const Z = (x, z) => [x, 1.4, z];
      const cat = [
        ['melee knife swing + stab', [{ t: 0, ev: 'weapon:melee', p: { kind: 'knife' } }, { t: 0.12, ev: 'hit:zombie', p: { id: 1, pos: Z(0, -1.2), source: 'melee', weapon: 'knife', killed: true } }]],
        ['melee axe swing + chop', [{ t: 0, ev: 'weapon:melee', p: { kind: 'axe' } }, { t: 0.18, ev: 'hit:zombie', p: { id: 1, pos: Z(0, -1.3), source: 'melee', weapon: 'axe', killed: true } }]],
        ['throw frag', [{ t: 0, ev: 'throw', p: { kind: 'frag' } }]],
        ['frag at 8 m', [{ t: 0, ev: 'explosion', p: { pos: [2, 0.2, -8], kind: 'frag' } }]],
        ['frag at 30 m', [{ t: 0, ev: 'explosion', p: { pos: [10, 0.2, -28], kind: 'frag' } }]],
        ['decoy burst at 10 m', [{ t: 0, ev: 'explosion', p: { pos: [3, 0.2, -10], kind: 'decoy' } }]],
        ['molotov pool at 6 m (5 s)', [{ t: 0, ev: 'fire:pool', p: { pos: [1, 0, -6], seconds: 5, kind: 'molotov' } }]],
        ['flare launch + burst', [{ t: 0, ev: 'weapon:fire', p: { weapon: 'flare', pos: [0, 1.6, 0], dir: [0, 0, -1] } }, { t: 0.01, ev: 'flare:launch', p: { id: 1, pos: [0, 1.6, -0.5], vel: [0, 1.5, -45], gravity: 3 } }, { t: 0.6, ev: 'flare:burst', p: { id: 1, pos: [0, 1, -27] } }]],
        ['jumper + arc to 3 bodies', [{ t: 0, ev: 'weapon:fire', p: { weapon: 'jumper', pos: [0, 1.6, 0], dir: [0, 0, -1] } }, { t: 0.08, ev: 'weapon:arc', p: { points: [[0, 1.5, -0.5], Z(0, -6), Z(2, -8), Z(-1, -10)] } }]],
        ['pistol reload (1.6 s)', [{ t: 0, ev: 'weapon:reload', p: { weapon: 'pistol' } }]],
        ['lmg belt reload (4.6 s)', [{ t: 0, ev: 'weapon:reload', p: { weapon: 'lmg' } }]],
        ['pump reload, 4 shells', [{ t: 0, ev: 'weapon:reload', p: { weapon: 'pump' } }]],
        ['reload cancelled by a switch at 0.6 s', [{ t: 0, ev: 'weapon:reload', p: { weapon: 'rifle' } }, { t: 0.6, ev: 'weapon:switch', p: {} }]],
        ['runner spawn at 8 m', [{ t: 0, ev: 'zombie:spawn', p: { id: 1, pos: Z(3, -8), type: 'runner' } }]],
        ['armoured attack at 1.5 m', [{ t: 0, ev: 'zombie:attack', p: { id: 1, pos: Z(0.5, -1.5), type: 'armoured' } }]],
        ['bloater burst at 4 m', [{ t: 0, ev: 'zombie:burst', p: { id: 1, pos: Z(1, -4) } }]],
        ['brute roar at 6 m', [{ t: 0, ev: 'zombie:spawn', p: { id: 1, pos: Z(0, -6), type: 'brute' } }]],
        ['brute slam at 2 m', [{ t: 0, ev: 'zombie:attack', p: { id: 1, pos: Z(0, -2), type: 'brute', kind: 'slam' } }]],
        ['sever at 3 m', [{ t: 0, ev: 'zombie:sever', p: { id: 1, pos: Z(1, -3), part: 'armL' } }]],
        ['headshot kill at 5 m', [{ t: 0, ev: 'hit:zombie', p: { id: 1, pos: Z(0, -5), part: 'head', headshot: true, killed: true } }]],
        ['board torn at 3 m', [{ t: 0, sound: 'board_break', opts: { pos: Z(1, -3) } }]],
        ['board hammered at 1 m', [{ t: 0, sound: 'board_hammer', opts: { pos: Z(0, -1) } }]],
        ['window climb at 4 m', [{ t: 0, sound: 'window_climb', opts: { pos: Z(0, -4) } }]],
        ['steps: tile, wood, carpet, metal, dirt', ['tile', 'wood', 'carpet', 'metal', 'dirt'].map((f, i) => ({ t: i * 0.4, ev: 'step', p: { pos: [0, 0, 0], surface: f } }))],
        ['power on (switch at 3 m)', [{ t: 0, sound: 'knife_switch', opts: { pos: Z(2, -2) } }, { t: 0.3, sound: 'power_hum', opts: {} }]],
        ['door: boarded / sheet / roller', [{ t: 0, sound: 'door_boarded', opts: { pos: Z(0, -3) } }, { t: 1.6, sound: 'door_sheet', opts: { pos: Z(0, -3) } }, { t: 3.5, sound: 'door_roller', opts: { pos: Z(0, -3) } }]],
        ['search car: rummage, cancel at 0.8 s', [{ t: 0, sound: 'rummage_car', opts: { pos: Z(0, -1), loop: true, seconds: 0.8 } }]],
        ['search done: drawer, ammo', [{ t: 0, sound: 'open_drawer', opts: { pos: Z(0, -1) } }, { t: 0.3, ev: 'search:done', p: { id: 'x', reward: { kind: 'ammo' } } }]],
        ['search done: nothing', [{ t: 0.3, ev: 'search:done', p: { id: 'x', reward: { kind: 'nothing' } } }]],
        ['box roll + reveal', [{ t: 0, sound: 'box_roll', opts: { pos: Z(0, -2) } }, { t: 3.5, sound: 'box_reveal', opts: { pos: Z(0, -2) } }]],
        ['machine buy', [{ t: 0, ev: 'machine:buy', p: { kind: 'jumpStart' } }]],
        ['bench grind', [{ t: 0, ev: 'bench:upgrade', p: {} }]],
        ['purchase / denied', [{ t: 0, ev: 'buy', p: { item: 'wallAmmo' } }, { t: 0.8, ev: 'buy:denied', p: { reason: 'points' } }]],
        ['power-ups: resupply, oneTap, doubleTime, flashover', ['resupply', 'oneTap', 'doubleTime', 'flashover'].map((k, i) => ({ t: i * 1.5, ev: 'powerup:take', p: { kind: k } }))],
        ['boss round sting', [{ t: 0, ev: 'round:start', p: { n: 5, boss: true } }]],
        ['hint blip', [{ t: 0, ev: 'hint:show', p: { id: 'x' } }]],
      ];
      console.log('\ncatalog: each alone through the full graph, open lot, no rain');
      console.log('  event                                              peak dBFS  RMS(sound) dBFS  audible s  centroid Hz');
      const unmeasured = [];
      for (let ci = 0; ci < cat.length; ci++) {
        const [label, script] = cat[ci];
        if (ci > 0 && ci % 10 === 0) await freshPage(); // batches of 10 per page
        let ch;
        try { ch = await renderOffline({ seconds: 6, ambience: false, script: [{ t: 0, area: 'open' }, ...script.map((e) => ({ ...e, t: e.t + 0.05 }))] }); } catch (e) { unmeasured.push(`${label} (${e.message})`); console.log(`  ${label.padEnd(50)} UNMEASURED: ${e.message}`); continue; }
        const m = metrics(ch, SRATE);
        // RMS over the sound's own audible span, not the 6 s window
        const n = Math.max(1, Math.round(m.audible * SRATE));
        let ss = 0; for (const c of ch) for (let i = 0; i < n && i < c.length; i++) ss += c[i] * c[i];
        console.log(`  ${label.padEnd(50)} ${f1(m.peakDb).padStart(9)}  ${f1(dB(Math.sqrt(ss / (2 * n)))).padStart(15)}  ${m.audible.toFixed(2).padStart(9)}  ${Math.round(m.centroid).toString().padStart(11)}`);
        writeWav(join(OUT, `cat-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.wav`), ch, SRATE);
      }
      if (unmeasured.length) console.log(`  unmeasured: ${unmeasured.join('; ')}`);
      await freshPage();
      console.log('\nthe pistol through weapon:fire in each space (no rain)');
      console.log('  space        peak dBFS  T40 s  audible s  centroid Hz');
      for (const a of ['open', 'canopy', 'diner', 'kitchen', 'motelRoom', 'walkway', 'garage', 'scrapyard']) {
        const ch = await renderOffline({ seconds: 3.5, ambience: false, script: fireAt('pistol', a) });
        const m = metrics(ch, SRATE);
        console.log(`  ${a.padEnd(11)} ${f1(m.peakDb).padStart(9)}  ${m.t40.toFixed(2).padStart(5)}  ${m.audible.toFixed(2).padStart(9)}  ${Math.round(m.centroid).toString().padStart(11)}`);
        writeWav(join(OUT, `space-pistol-${a}.wav`), ch, SRATE);
      }
      await freshPage();
      console.log('\nbeds by space (8 s, power on)');
      console.log('  space        RMS dBFS  peak dBFS  centroid Hz  sub/low/mid/high/air %');
      for (const a of ['open', 'canopy', 'diner', 'kitchen', 'motelRoom', 'walkway', 'garage', 'scrapyard']) {
        const ch = await renderOffline({ seconds: 8, script: [{ t: 0, area: a }, { t: 0, power: true }] });
        const tail = ch.map((c) => c.subarray(2 * SRATE));
        const m = metrics(tail, SRATE);
        console.log(`  ${a.padEnd(11)} ${f1(m.rmsDb).padStart(8)}  ${f1(m.peakDb).padStart(9)}  ${Math.round(m.centroid).toString().padStart(11)}  ${[m.bands.sub, m.bands.low, m.bands.mid, m.bands.high, m.bands.air].map((v) => v.toFixed(0)).join('/')}`);
        writeWav(join(OUT, `beds-${a}.wav`), ch, SRATE);
      }
      console.log('\nmusic bed at intensity 0.2, 0.6, 1 (10 s, no rain)');
      for (const mus of [0.2, 0.6, 1]) {
        const ch = await renderOffline({ seconds: 10, script: [], ambience: false, music: mus });
        const m = metrics(ch.map((c) => c.subarray(4 * SRATE)), SRATE);
        console.log(`  intensity ${mus}: RMS ${f1(m.rmsDb)} dBFS, peak ${f1(m.peakDb)} dBFS, centroid ${Math.round(m.centroid)} Hz`);
        writeWav(join(OUT, `music-${mus}.wav`), ch, SRATE);
      }
    }

    // ---------------------------------------------------------------- buffer hygiene
    if (flag('buffers') || flag('check')) {
      const LOOPS = /^(rain_|lamp_buzz|neon_buzz|fire_loop|flare_whoosh|decoy_chatter|gas_hiss|rummage_|music_)/;
      const bad = [];
      let worstDc = 0, worstFirst = 0, worstLast = 0, n = 0;
      for (const [k, v] of Object.entries(defs)) {
        if (k.startsWith('ir_')) continue; // impulse responses start with their direct sound by design
        for (let i = 0; i < v; i++) {
          const ch = await getRaw(k, i);
          for (const c of ch) {
            n++;
            let m = 0, pkv = 0; for (let j = 0; j < c.length; j++) { m += c[j]; pkv = Math.max(pkv, Math.abs(c[j])); }
            const dc = Math.abs(m / c.length), first = Math.abs(c[0]), last = Math.abs(c[c.length - 1]);
            worstDc = Math.max(worstDc, dc);
            if (LOOPS.test(k)) {
              const steps = []; for (let j = 1; j < c.length; j += 7) steps.push(Math.abs(c[j] - c[j - 1]));
              steps.sort((a, b) => a - b);
              const p999 = steps[Math.floor(steps.length * 0.999)], seam = Math.abs(c[c.length - 1] - c[0]);
              if (seam > Math.max(0.02, p999)) bad.push(`${k}.${i} loop seam ${seam.toFixed(4)} vs 99.9th-percentile step ${p999.toFixed(4)}`);
            } else {
              worstFirst = Math.max(worstFirst, first); worstLast = Math.max(worstLast, last);
              if (first > 0.02) bad.push(`${k}.${i} first sample ${first.toFixed(3)}`);
              if (last > 0.005) bad.push(`${k}.${i} last sample ${last.toFixed(4)}`);
            }
            if (dc > 0.005) bad.push(`${k}.${i} DC ${dc.toFixed(4)}`);
          }
        }
      }
      const ok = bad.length === 0;
      console.log(`\nbuffers: ${n} channels; worst DC ${worstDc.toExponential(1)}, worst first sample ${worstFirst.toFixed(4)}, worst last sample ${worstLast.toFixed(5)} (one-shots); loop seams checked`);
      console.log(`  ${ok ? 'PASS' : 'FAIL'}  no DC (< 0.005), no click at start (< 0.02) or end (< 0.005), seamless loops${ok ? '' : ': ' + bad.slice(0, 30).join('; ')}`);
      if (!ok) failed = true;
    }

    if (errs.length) { console.log('\npage errors/warnings:'); for (const e of errs) console.log('  ' + e); failed = true; }
    if (failed) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
