// Also writes the scene programs (alive at __ready) and their loop-rolled versions to a second file.
// Writes every shader program the boot compiles and throws away (before window.__ready, or just after
// it, as the zombie bakes finish behind the title screen: the effects
// atlases, the zombie skin and cloth bakes, the noise volumes, anything else drawn once at load), with
// the full sources exactly as handed to the driver, to a JSON file for a compile benchmark:
//   { "tier": "high", "programs": [{ "name": "...", "vs": "...", "fs": "..." }] }
//   node scripts/dump-boot-shaders.mjs [--out scripts/shaders-boot.json] [--scene scripts/shaders-scene.json] [--all]
// --all also lists the programs still alive at __ready. Uses $GS_DIST (default dist), Metal.
import { writeFileSync } from 'node:fs';
import { launch, pageUrl } from './lib.mjs';

const argv = process.argv.slice(2);
const out = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : 'scripts/shaders-boot.json';
const all = argv.includes('--all');

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript(() => {
  const C = self.WebGL2RenderingContext;
  const src = new Map(); // shader -> source
  const attached = new Map(); // program -> [sources]
  const rec = (window.__progRec = []); // { vs, fs, deleted, deletedBeforeReady }
  const byProgram = new Map();
  const ss = C.prototype.shaderSource;
  C.prototype.shaderSource = function (sh, s) { src.set(sh, s); return ss.call(this, sh, s); };
  const at = C.prototype.attachShader;
  C.prototype.attachShader = function (p, sh) { if (!attached.has(p)) attached.set(p, []); attached.get(p).push({ sh, type: this.getShaderParameter(sh, this.SHADER_TYPE) }); return at.call(this, p, sh); };
  const lp = C.prototype.linkProgram;
  C.prototype.linkProgram = function (p) {
    const list = attached.get(p) || [];
    const vs = list.find((x) => x.type === this.VERTEX_SHADER); const fs = list.find((x) => x.type === this.FRAGMENT_SHADER);
    const r = { vs: vs ? src.get(vs.sh) : '', fs: fs ? src.get(fs.sh) : '', deleted: false, deletedBeforeReady: false, program: p };
    rec.push(r); byProgram.set(p, r);
    return lp.call(this, p);
  };
  const dp = C.prototype.deleteProgram;
  C.prototype.deleteProgram = function (p) { const r = byProgram.get(p); if (r) { r.deleted = true; r.deletedBeforeReady = window.__ready !== true; } return dp.call(this, p); };
});
await page.goto(pageUrl('q=high'));
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
// the character bakes run on behind the title screen: wait for them to finish and dispose
await page.waitForFunction(() => window.__zstats && window.__zstats.bakeMs > 0, null, { timeout: 300000 }).catch(() => {});
await page.waitForTimeout(500);
const progs = await page.evaluate((wantAll) => {
  const live = new Map(window.__G.renderer.info.programs.map((p) => [p.program, `${p.name || p.type}`]));
  // the programs drawn once at load have no material left to name them: named by what they contain
  const guess = (fs) => (fs.includes('smoke flipbook') ? 'particleAtlas'
    : fs.includes('vec2 g = vUv * 4.0;') && fs.includes('craterF') ? 'decalAtlas'
      : fs.includes('sdFigure') ? 'zombieSkinBake'
        : fs.includes('uKind') && fs.includes('uStyle') ? 'zombieClothBake'
          : fs.includes('uniform sampler2D tM;') ? 'zombieBakeDilate'
            : fs.includes('uMode') && fs.includes('uZ') ? 'noiseVolumes'
              : 'boot');
  const seen = new Map();
  const outList = [];
  for (const r of window.__progRec) {
    if (!r.vs || !r.fs) continue;
    const keep = r.deleted || wantAll;
    if (!keep) continue;
    let name = live.get(r.program) || guess(r.fs);
    const n = (seen.get(name) || 0) + 1; seen.set(name, n);
    if (n > 1) name = `${name}#${n}`;
    outList.push({ name, vs: r.vs, fs: r.fs });
  }
  return outList;
}, all);
const check = async (list) => page.evaluate((items) => {
  const gl = document.createElement('canvas').getContext('webgl2');
  return items.map(({ vs, fs }) => {
    const mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); return sh; };
    const p = gl.createProgram(); const v = mk(gl.VERTEX_SHADER, vs); const f = mk(gl.FRAGMENT_SHADER, fs);
    gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
    return gl.getProgramParameter(p, gl.LINK_STATUS) ? '' : (gl.getShaderInfoLog(f) || gl.getProgramInfoLog(p) || 'link failed').slice(0, 200);
  });
}, list);

// ---- the scene programs, before and after rolling their loops ---------------------------------------
// The programs alive at __ready (what the game draws with), and for each whose fragment shader has
// loops render/rollLoops.js would roll, that version too, named "<name>:v2-rolled".
const sceneOut = argv.includes('--scene') ? argv[argv.indexOf('--scene') + 1] : 'scripts/shaders-scene.json';
const scene = await page.evaluate(() => {
  const live = window.__G.renderer.info.programs;
  return window.__progRec.filter((r) => !r.deleted && r.vs && r.fs).map((r) => {
    const p = live.find((x) => x.program === r.program);
    return { name: p ? `${p.name || p.type}#${p.id}` : 'unnamed', vs: r.vs, fs: r.fs };
  });
});
const { rollLoops } = await import('../src/render/rollLoops.js');
const sceneExtra = [];
for (const p of scene) {
  const r = rollLoops(p.fs);
  if (r.count) sceneExtra.push({ name: `${p.name}:v2-rolled`, vs: p.vs, fs: r.src, rolled: r.count, kept: r.kept });
}
const extra = sceneExtra;
const bad = (await check(extra)).map((e, i) => (e ? `${extra[i].name}: ${e}` : '')).filter(Boolean);
await browser.close();
if (bad.length) { console.error(`[dump] candidates that do not compile:\n${bad.join('\n')}`); process.exit(1); }

// the atlases are one program per kind of cell (fx/atlas.js): named by their K
for (const p of progs) { const k = /#define K (-?\d+)/.exec(p.fs); if (k && /Atlas/.test(p.name)) p.name = `${p.name.replace(/#\d+$/, '')}:k${k[1]}`; }
const doc = { tier: 'high', note: 'Programs the load compiles and throws away (before __ready, and the zombie bakes just after), from a Metal load (scripts/dump-boot-shaders.mjs).', programs: progs };
writeFileSync(out, `${JSON.stringify(doc, null, 1)}\n`);
const sceneDoc = { tier: 'high', note: 'The programs alive at __ready, from a Metal load, and for each with loops to roll, the version with its loops rolled (render/rollLoops.js), named <name>:v2-rolled.', programs: [...scene, ...sceneExtra.map(({ name, vs, fs }) => ({ name, vs, fs }))] };
writeFileSync(sceneOut, `${JSON.stringify(sceneDoc, null, 1)}\n`);
console.log(`[dump] ${progs.length} load-time programs -> ${out}; ${scene.length} scene programs + ${sceneExtra.length} rolled -> ${sceneOut}`);
for (const p of doc.programs) console.log(`  ${p.name.padEnd(28)} vs ${String(p.vs.length).padStart(6)}  fs ${String(p.fs.length).padStart(6)}`);
for (const p of sceneExtra) console.log(`  ${p.name.padEnd(44)} fs ${String(p.fs.length).padStart(7)}  loops rolled ${p.rolled}, left ${p.kept}`);
