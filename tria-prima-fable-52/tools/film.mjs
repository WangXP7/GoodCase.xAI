// Film the game: a scripted play-through on the real GPU, taken frame by frame with the game's own
// sound, so that the result is exact whatever the speed of the machine.
//   node tools/film.mjs tools/films/letsplay.mjs [--w 1920] [--h 1080] [--fps 60] [--q ultra]
//                       [--out shots/film/letsplay.mp4] [--crf 16] [--sheet 0.5] [--novideo 1]
// The game is stepped by hand (a frame of film is 1/fps of a second of the game, of its timers, of
// the animations of its interface and of its sound: tools/film-page.js), each frame is photographed
// through the browser (canvas and interface together) and piped to ffmpeg; the sound is rendered by
// the same engine on an OfflineAudioContext, in step, and joined at the end.
//   --sheet 0.5    also keep a still every half second in shots/film/<name>/ (for looking through)
//   --novideo 1    stills only: nothing is encoded
//   --shot jpeg    photograph as JPEG (--jq 98), several times faster than the exact PNG
//   --fade 0.5     seconds of fade to black and to silence at the end
//   --lufs -16     the loudness the sound is brought to, under a limiter
// A film exports `default async function (f)`; f is the Film below. ffmpeg must be on the PATH.
import path from 'node:path';
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from './dev-server.mjs';
import { launch } from './pw.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = { _: [] };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args[a.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : '1';
  else args._.push(a);
}
const script = args._[0];
if (!script) {
  console.log('usage: node tools/film.mjs <film.mjs> [--w 1920 --h 1080 --fps 60 --q ultra --out file.mp4]');
  process.exit(1);
}
const W = Number(args.w || 1920),
  H = Number(args.h || 1080),
  FPS = Number(args.fps || 60),
  DT = 1 / FPS;
const name = path.basename(script).replace(/\.m?js$/, '');
const outFile = path.resolve(args.out || path.join(root, 'shots', 'film', name + '.mp4'));
const workDir = path.join(path.dirname(outFile), name);
fs.mkdirSync(workDir, { recursive: true });
const SHEET = args.sheet ? Number(args.sheet) : 0;
const VIDEO = args.novideo !== '1';
// pictures leave the browser as PNG (exact) or, several times faster, as JPEG of the highest quality
const JPEG = args.shot === 'jpeg';
const SHOT = JPEG ? { format: 'jpeg', quality: Number(args.jq || 98) } : { format: 'png', optimizeForSpeed: true };
const EXT = JPEG ? '.jpg' : '.png';

const minJerk = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * u * (10 - 15 * u + 6 * u * u));
const rad = (d) => (d * Math.PI) / 180;

class Film {
  constructor(page, cdp) {
    this.page = page;
    this.cdp = cdp;
    this.args = args;
    this.W = W;
    this.H = H;
    this.fps = FPS;
    this.t = 0; // seconds of film
    this.sim = 0; // seconds of game stepped since begin(), filmed or not
    this.n = 0; // frames of film
    this.state = null;
    this.cuts = [];
    this._down = [];
    this._up = [];
    this._turns = [];
    this._aim = null;
    this._mouse = null; // { path: [(u) => [x, y]], t0, t1 } the pointer being moved
    this._mx = W / 2;
    this._my = H / 2;
    this._k = 0.0021; // radians per mouse pixel
    this._ff = null;
    this._shots = 0;
    this._began = false;
    this._nextStill = 0;
    this._times = { step: 0, shot: 0 };
  }
  log(...a) {
    console.log(`[${this.t.toFixed(2).padStart(6)}]`, ...a);
  }
  ev(fn, arg) {
    return this.page.evaluate(fn, arg);
  }

  /** Start the clock. `seconds` is the length of the film (the sound is rendered that long). */
  async begin(seconds, seed = 1) {
    this.seconds = seconds;
    this._k = await this.ev(([s, seed]) => {
      window.__film.begin(s, seed);
      return 0.0021 * window.TP.game.settings.sensitivity;
    }, [seconds + 2, seed]);
    this._began = true;
    if (VIDEO) this._ffmpeg();
  }

  // --- hands ---------------------------------------------------------------------------------------
  down(...codes) {
    this._down.push(...codes);
  }
  up(...codes) {
    this._up.push(...codes);
  }
  /** Press and let go: the key is down for `frames` frames, starting with the next one. */
  async tap(code, frames = 4) {
    this.down(code);
    await this.frames(frames);
    this.up(code);
  }
  /** Turn the head by yaw and pitch (degrees; right and up are positive) over `secs`, eased. */
  turn(yaw, pitch, secs, delay = 0) {
    this._turns.push({ t0: this.sim + delay, t1: this.sim + delay + Math.max(DT, secs), dx: rad(yaw) / this._k, dy: -rad(pitch) / this._k });
  }
  /**
   * Bring the eye onto a point of the world over `secs`, wherever the feet go meanwhile. With
   * `hold` (seconds) it then stays on the point that long.
   */
  aimAt(p, secs, { delay = 0, hold = 0 } = {}) {
    this._aim = { p, t0: this.sim + delay, t1: this.sim + delay + Math.max(DT, secs), until: this.sim + delay + Math.max(DT, secs) + hold };
  }
  noAim() {
    this._aim = null;
  }
  /** Move the real pointer to (x, y) over `secs`, eased, along a slightly bowed path. */
  glide(x, y, secs, bow = 0.08) {
    const x0 = this._mouseEnd ? this._mouseEnd[0] : this._mx,
      y0 = this._mouseEnd ? this._mouseEnd[1] : this._my;
    const nx = -(y - y0) * bow,
      ny = (x - x0) * bow;
    const t0 = this._mouse ? this._mouse.t1 : this.sim;
    const seg = { t0, t1: t0 + Math.max(DT, secs), at: (u) => [x0 + (x - x0) * u + nx * Math.sin(Math.PI * u), y0 + (y - y0) * u + ny * Math.sin(Math.PI * u)], ease: true };
    this._queueMouse(seg, [x, y]);
  }
  /** Circle the real pointer round (cx, cy): `turns` times (negative: the other way) over `secs`. */
  circle(cx, cy, r, turns, secs, squash = 0.62) {
    const x0 = this._mouseEnd ? this._mouseEnd[0] : this._mx,
      y0 = this._mouseEnd ? this._mouseEnd[1] : this._my;
    const a0 = Math.atan2((y0 - cy) / squash, x0 - cx);
    const t0 = this._mouse ? this._mouse.t1 : this.sim;
    const at = (u) => {
      const a = a0 + u * turns * Math.PI * 2;
      // a hand does not draw a perfect ring: it breathes a little
      const rr = r * (1 + 0.06 * Math.sin(u * turns * 5.1 + 1));
      return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * squash];
    };
    this._queueMouse({ t0, t1: t0 + Math.max(DT, secs), at, ease: false }, at(1));
  }
  /** The hand leaves the pointer where it is: whatever was still queued for it is dropped. */
  rest() {
    this._mouse = null;
    this._mouseEnd = null;
  }
  _queueMouse(seg, end) {
    if (!this._mouse) this._mouse = { segs: [], t1: seg.t1 };
    this._mouse.segs.push(seg);
    this._mouse.t1 = seg.t1;
    this._mouseEnd = end;
  }
  /** Seconds until everything queued for the pointer has been done. */
  get pointerBusy() {
    return this._mouse ? Math.max(0, this._mouse.t1 - this.sim) : 0;
  }
  async click() {
    await this.page.mouse.down();
    await this.frames(4);
    await this.page.mouse.up();
  }

  // --- time ----------------------------------------------------------------------------------------
  async wait(secs) {
    await this.frames(Math.round(secs * FPS));
  }
  /** Run until the film is `t` seconds long. */
  async until(t) {
    await this.frames(Math.max(0, Math.round(t * FPS) - this.n));
  }
  /** Frames that are stepped but not filmed, and make no sound: the world settling before a cut. */
  async preroll(secs) {
    await this.frames(Math.round(secs * FPS), true);
  }
  cut(label) {
    this.cuts.push({ t: this.t, label });
    console.log(`\n--- ${this.t.toFixed(2)} s  ${label}`);
  }
  async frames(n, quiet = false) {
    for (let i = 0; i < n; i++) await this._frame(quiet);
  }

  async _frame(quiet) {
    if (!this._began) throw new Error('begin() first');
    const now = this.sim,
      next = now + DT;
    const cmd = { dt: DT, quiet, down: this._down, up: this._up, dx: 0, dy: 0 };
    this._down = [];
    this._up = [];
    // the head
    for (let i = this._turns.length - 1; i >= 0; i--) {
      const tw = this._turns[i];
      const d = minJerk((next - tw.t0) / (tw.t1 - tw.t0)) - minJerk((now - tw.t0) / (tw.t1 - tw.t0));
      cmd.dx += tw.dx * d;
      cmd.dy += tw.dy * d;
      if (next >= tw.t1) this._turns.splice(i, 1);
    }
    const a = this._aim;
    if (a && next > a.t0) {
      const u0 = minJerk((now - a.t0) / (a.t1 - a.t0)),
        u1 = minJerk((next - a.t0) / (a.t1 - a.t0));
      const k = u0 >= 1 ? 1 - Math.exp(-DT * 14) : (u1 - u0) / (1 - u0);
      cmd.aim = { x: a.p.x, y: a.p.y, z: a.p.z, k: Math.min(1, Math.max(0, k)) };
      if (next >= a.until) this._aim = null;
    }
    // the pointer
    const m = this._mouse;
    if (m) {
      const seg = m.segs.find((s) => next <= s.t1) || m.segs[m.segs.length - 1];
      let u = Math.min(1, Math.max(0, (next - seg.t0) / (seg.t1 - seg.t0)));
      if (seg.ease) u = minJerk(u);
      const [x, y] = seg.at(u);
      this._mx = x;
      this._my = y;
      await this.page.mouse.move(x, y);
      if (next >= m.t1) {
        this._mouse = null;
        this._mouseEnd = null;
      }
    }
    let t0 = performance.now();
    this.state = await this.page.evaluate((c) => window.__film.frame(c), cmd);
    this._times.step += performance.now() - t0;
    this.sim = next;
    if (quiet) return;
    this.t = this.state.t;
    this.n++;
    const still = SHEET > 0 && this.t + 1e-6 >= this._nextStill;
    if (VIDEO || still) {
      t0 = performance.now();
      const r = await this.cdp.send('Page.captureScreenshot', SHOT);
      const png = Buffer.from(r.data, 'base64');
      this._times.shot += performance.now() - t0;
      if (still) {
        fs.writeFileSync(path.join(workDir, `t${this.t.toFixed(2).padStart(6, '0')}${EXT}`), png);
        this._nextStill += SHEET;
      }
      if (VIDEO) {
        if (!this._ff.stdin.write(png)) await new Promise((res) => this._ff.stdin.once('drain', res));
      }
    }
    if (this.n % (FPS * 2) === 0) process.stdout.write(`  ${this.t.toFixed(1)} s filmed (${(this._times.step / this.n).toFixed(0)} ms a step, ${(this._times.shot / this.n).toFixed(0)} ms a picture)\n`);
  }
  /** A still of this moment, whatever the settings: shots/film/<name>/<label>.png */
  async still(label) {
    const r = await this.cdp.send('Page.captureScreenshot', SHOT);
    const file = path.join(workDir, label + EXT);
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    console.log('  still ' + file);
    return file;
  }

  // --- the film ------------------------------------------------------------------------------------
  _ffmpeg() {
    this.videoFile = path.join(workDir, 'picture.mp4');
    const fadeOut = Number(args.fade ?? 0.5);
    const vf = [`scale=in_range=full:out_range=tv:out_color_matrix=bt709:flags=accurate_rnd+full_chroma_int`];
    if (fadeOut > 0 && this.seconds) vf.push(`fade=t=out:st=${(this.seconds - fadeOut).toFixed(3)}:d=${fadeOut}`);
    vf.push('format=yuv420p');
    const a = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', JPEG ? 'mjpeg' : 'png', '-i', 'pipe:0', '-an', '-vf', vf.join(','), '-c:v', 'libx264', '-preset', 'slow', '-crf', String(args.crf || 16), '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-movflags', '+faststart', this.videoFile];
    this._ff = spawn('ffmpeg', a, { stdio: ['pipe', 'inherit', 'inherit'] });
    this._ffDone = new Promise((res, rej) => {
      this._ff.on('error', rej);
      this._ff.on('close', (code) => (code === 0 ? res() : rej(new Error('ffmpeg left with ' + code))));
    });
  }

  async finish() {
    console.log(`\n${this.n} frames, ${this.t.toFixed(2)} s; cuts at ${this.cuts.map((c) => c.t.toFixed(2)).join(', ')}`);
    if (!this.n) {
      // stills only: there is no film and no sound to finish
      if (this._ff) this._ff.stdin.end();
      return;
    }
    const meta = await this.ev((s) => window.__film.sound(s), this.t);
    const parts = [];
    for (let i = 0; i < meta.parts; i++) parts.push(Buffer.from(await this.ev((i) => window.__filmSound[i], i), 'base64'));
    const pcm = Buffer.concat(parts);
    const wav = Buffer.alloc(44);
    wav.write('RIFF', 0);
    wav.writeUInt32LE(36 + pcm.length, 4);
    wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(2, 22);
    wav.writeUInt32LE(meta.rate, 24);
    wav.writeUInt32LE(meta.rate * 4, 28);
    wav.writeUInt16LE(4, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(pcm.length, 40);
    this.soundFile = path.join(workDir, 'sound.wav');
    fs.writeFileSync(this.soundFile, Buffer.concat([wav, pcm]));
    const db = (v) => (20 * Math.log10(Math.max(1e-9, v))).toFixed(1);
    console.log(`sound: ${(meta.frames / meta.rate).toFixed(2)} s, peak ${db(meta.peak)} dBFS, rms ${db(meta.rms)} dB  ${this.soundFile}`);
    if (!VIDEO) return;
    this._ff.stdin.end();
    await this._ffDone;

    // how loud it is, and the gain that brings it to where films on the web sit
    const want = Number(args.lufs ?? -16);
    const m = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', this.soundFile, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
    const txt = m.stderr || '';
    const I = Number((/I:\s+(-?[\d.]+) LUFS/g.exec(txt.slice(txt.lastIndexOf('Summary'))) || [])[1]);
    const TP = Number((/Peak:\s+(-?[\d.]+) dBFS/g.exec(txt.slice(txt.lastIndexOf('Summary'))) || [])[1]);
    let af = [];
    if (Number.isFinite(I)) {
      const gain = want - I;
      af.push(`volume=${gain.toFixed(2)}dB`);
      if (TP + gain > -1.5) af.push('alimiter=limit=0.84:attack=3:release=80:level=false');
      console.log(`loudness ${I} LUFS, true peak ${TP} dBFS: ${gain >= 0 ? '+' : ''}${gain.toFixed(1)} dB to ${want} LUFS${TP + gain > -1.5 ? ', under a limiter' : ''}`);
    }
    const fadeOut = Number(args.fade ?? 0.5);
    if (fadeOut > 0) af.push(`afade=t=out:st=${(this.t - fadeOut).toFixed(3)}:d=${fadeOut}`);
    const mux = ['-y', '-loglevel', 'error', '-i', this.videoFile, '-i', this.soundFile, '-c:v', 'copy'];
    if (af.length) mux.push('-af', af.join(','));
    mux.push('-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-shortest', '-movflags', '+faststart', outFile);
    const r = spawnSync('ffmpeg', mux, { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('the sound could not be joined to the picture');
    console.log(`film: ${outFile}  ${(fs.statSync(outFile).size / 1048576).toFixed(1)} MB`);
  }
}

const mod = await import(pathToFileURL(path.resolve(script)).href);
const { server, url } = await startServer(0);
const { browser, page, logs } = await launch({ width: W, height: H });
let failed = false;
const t0 = Date.now();
try {
  await page.addInitScript({ path: path.join(root, 'tools', 'film-page.js') });
  const q = new URLSearchParams({ still: '1', q: args.q || 'ultra' });
  await page.goto(`${url}/dev/game.html?${q}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.TP && window.DONE, null, { timeout: 180000 });
  console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const cdp = await page.context().newCDPSession(page);
  const film = new Film(page, cdp);
  await mod.default(film);
  if (film._began) await film.finish();
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
} catch (e) {
  failed = true;
  console.log('FAILED: ' + (e && e.stack ? e.stack : e));
} finally {
  const bad = (logs || []).filter((l) => /error|warn|failed/i.test(l));
  if (bad.length) {
    console.log('PAGE LOG:');
    for (const l of bad.slice(0, 40)) console.log('  ' + l.slice(0, 1800));
  }
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
