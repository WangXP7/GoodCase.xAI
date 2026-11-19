// BAR-CONSISTENCIA §2.1/§3.1: macro legível sem emenda; RNG, escala e arte preservados.
// Executa o fonte real. A sonda numérica mede só a camada radial, não aprova gameplay.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const option = (name) => process.argv.find((x) => x.startsWith(`--${name}=`))?.slice(name.length + 3);
const sourcePath = option('source') || path.join(ROOT, 'public/js/textures.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const baselinePath = option('baseline');
const baseline = baselinePath ? fs.readFileSync(baselinePath, 'utf8') : null;
const mutableImages = new Set(['ground', 'concrete', 'concreteDark', 'asphalt', 'dirt', 'grass', 'metal']);

function evaluate(src, search = '') {
  // Contrato do albedo usa sampler MED explícito; perfil LOW tem régua causal própria.
  const query = new URLSearchParams(search);
  if (!query.has('q')) query.set('q', 'med');
  search = '?' + query.toString();
  let state = 123456789, randomCalls = 0;
  const math = Object.create(Math);
  math.random = () => { randomCalls++; state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
  const canvases = [];
  const makeCanvas = () => {
    const image = { width: 1, height: 1, radialStamps: [] };
    const hash = createHash('sha256'), styles = {}, stack = [];
    const context = new Proxy(styles, {
      get(t, key) {
        if (key === 'canvas') return image;
        if (key === 'measureText') return () => ({ width: 10 });
        if (key === 'createRadialGradient' || key === 'createLinearGradient') return (...args) => {
          const gradient = { kind: key, args, stops: [] };
          gradient.addColorStop = (p, color) => gradient.stops.push([p, color]);
          return gradient;
        };
        if (key === 'save') return () => { stack.push({ ...styles }); hash.update('save'); };
        if (key === 'restore') return () => { const old = stack.pop() || {}; for (const k of Object.keys(styles)) delete styles[k]; Object.assign(styles, old); hash.update('restore'); };
        if (key in t) return t[key];
        if (key === 'fillRect') return (...args) => {
          hash.update(JSON.stringify([key, args, styles]));
          if (styles.fillStyle?.kind === 'createRadialGradient') image.radialStamps.push({ gradient: { geometry: styles.fillStyle.args, stops: styles.fillStyle.stops }, rect: args });
        };
        return (...args) => hash.update(JSON.stringify([key, args, styles]));
      },
      set(t, key, value) { t[key] = value; return true; },
    });
    image.getContext = () => context;
    image.signature = () => hash.digest('hex');
    canvases.push(image);
    return image;
  };
  const vector = (x = 1, y = 1) => ({ x, y, set(a, b) { this.x = a; this.y = b; }, copy(v) { this.set(v.x, v.y); } });
  class Texture {
    constructor(image) { this.image = image; this.userData = {}; this.source = {}; this.repeat = vector(); this.offset = vector(0, 0); this.anisotropy = 1; }
  }
  const THREE = { CanvasTexture: Texture, TextureLoader: class { load(url) { const t = new Texture(null); t.url = url; return t; } }, SRGBColorSpace: 'srgb', NoColorSpace: '', NearestFilter: 'nearest', LinearFilter: 'linear', LinearMipmapLinearFilter: 'mipmap', RepeatWrapping: 'repeat', ClampToEdgeWrapping: 'clamp' };
  const context = vm.createContext({ THREE, Math: math, location: { search }, localStorage: { getItem: () => '{"quality":"low"}' }, URLSearchParams, document: { createElement: makeCanvas }, console });
  const executable = src.replace(/^import[^\n]*\n/gm, '').replace(/\bexport\s+(?=(?:function|const|let)\b)/g, '');
  vm.runInContext(executable + '\n;globalThis.result = initTextures(); globalThis.probeMacro = macro; globalThis.probeStains = stains;', context, { timeout: 60000 });
  const textures = {};
  for (const [name, t] of Object.entries(context.result)) {
    const items = Array.isArray(t) ? t : [t];
    if (!items.length || !items.some((item) => item instanceof Texture)) continue;
    textures[name] = items.map((item) => item instanceof Texture ? {
      size: item.image ? [item.image.width, item.image.height] : null,
      repeat: [item.repeat.x, item.repeat.y], colorSpace: item.colorSpace,
      mag: item.magFilter, min: item.minFilter, anisotropy: item.anisotropy,
      wrap: [item.wrapS, item.wrapT], url: item.url || null,
      imageHash: item.image?.signature() || null,
    } : null);
  }
  return { context, randomCalls, canvases: canvases.length, textures };
}

function radialProbe(context, fn, args, width = 256, height = 256) {
  const stamps = [];
  let fillStyle;
  const ctx = {
    createRadialGradient(...geometry) { return { geometry, stops: [], addColorStop(p, color) { this.stops.push([p, color]); } }; },
    set fillStyle(v) { fillStyle = v; },
    fillRect(x, y, w, h) { stamps.push({ gradient: fillStyle, rect: [x, y, w, h] }); },
  };
  context[fn](ctx, width, height, ...args);
  return radialStats(stamps, width, height);
}

function radialStats(stamps, width, height) {
  const at = (x, y) => {
    let alpha = 0;
    for (const s of stamps) {
      const [rx, ry, rw, rh] = s.rect;
      if (x < rx || x > rx + rw || y < ry || y > ry + rh) continue;
      const [cx, cy, inner, , , outer] = s.gradient.geometry;
      const d = Math.hypot(x - cx, y - cy);
      if (d >= outer) continue;
      const rgba = s.gradient.stops[0][1].match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/);
      if (!rgba) throw new Error('A sonda exige cor radial RGBA explícita');
      const a = Number(rgba[1]) * Math.max(0, Math.min(1, (outer - d) / (outer - inner)));
      alpha = a + alpha * (1 - a);
    }
    return alpha;
  };
  let seam = 0;
  for (let i = 0; i <= 64; i++) {
    seam = Math.max(seam, Math.abs(at(0, i * height / 64) - at(width, i * height / 64)), Math.abs(at(i * width / 64, 0) - at(i * width / 64, height)));
  }
  const radii = stamps.map((x) => x.gradient.geometry[5]);
  return { seamAlpha: seam, stamps: stamps.length, largestRadius: radii.length ? Math.max(...radii) : 0, smallestRadius: radii.length ? Math.min(...radii) : 0 };
}


const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function textureContract(evaluation) {
  return { randomCalls: evaluation.randomCalls, canvases: evaluation.canvases,
    keys: Object.keys(evaluation.textures),
    metadata: Object.fromEntries(Object.entries(evaluation.textures).map(([name, items]) => [name, digest(items.map(({ imageHash, ...x }) => x))])),
    content: Object.fromEntries(Object.entries(evaluation.textures).map(([name, items]) => [name, digest(items)])),
    texturesDigest: digest(evaluation.textures) };
}
const base = baseline ? textureContract(evaluate(baseline)) : JSON.parse(fs.readFileSync(new URL('./fixtures/map-texture-upgrade-baseline.json', import.meta.url)));
const legacyStainReference = baseline ? radialProbe(evaluate(baseline).context, 'probeStains', [5, 'rgba(60,50,40,0.20)', false]) : base.legacyStains;
function checks(src) {
  const candidate = evaluate(src);
  const failures = [];
  const check = (ok, code) => { if (!ok) failures.push(code); };
  check(candidate.randomCalls === base.randomCalls, 'TXUP_RNG');
  check(candidate.canvases === base.canvases, 'TXUP_CANVAS_COUNT');
  check(JSON.stringify(Object.keys(candidate.textures)) === JSON.stringify(base.keys), 'TXUP_TEXTURE_KEYS');
  const contract = textureContract(candidate);
  for (const name of base.keys) {
    check(contract.metadata[name] === base.metadata[name], `TXUP_SCALE_${name}`);
    if (!mutableImages.has(name)) check(contract.content[name] === base.content[name], `TXUP_ART_${name}`);
  }
  const macro = radialProbe(candidate.context, 'probeMacro', [5, ['rgba(70,64,56,0.16)'], true]);
  const stains = radialProbe(candidate.context, 'probeStains', [5, 'rgba(60,50,40,0.20)', true]);
  // Periodicidade é identidade matemática; epsilon cobre apenas arredondamento Float64.
  check(macro.seamAlpha < 1e-12, 'TXUP_MACRO_SEAM');
  check(stains.seamAlpha < 1e-12, 'TXUP_STAIN_SEAM');
  const legacyStains = legacyStainReference;
  check(stains.smallestRadius > legacyStains.largestRadius, 'TXUP_STAIN_MACRO');
  const surfaces = {};
  for (const name of mutableImages) {
    const image = candidate.context.result[name]?.image;
    if (!image) { check(false, `TXUP_SURFACE_${name}`); continue; }
    const broad = image.radialStamps.filter((s) => s.gradient.geometry[5] >= image.width * 0.25);
    surfaces[name] = radialStats(broad, image.width, image.height);
    check(broad.length > 0 && surfaces[name].seamAlpha < 1e-12, `TXUP_USAGE_${name}`);
  }
  return { pass: failures.length === 0, failures, rngCalls: candidate.randomCalls, canvases: candidate.canvases, macro, stains, legacyStains, surfaces, sourcePath, baselinePath: baselinePath || 'fixtures/map-texture-upgrade-baseline.json@' + base.ref, limitation: 'Sonda de desenho radial; qualidade visual e leitura a 10m exigem captura WebGL do root.' };
}

let report = checks(source);
const baseRollback = baseline ? textureContract(evaluate(baseline, '?surfacemacro=0')) : base;
function rollbackCheck(src) {
  const disabled = evaluate(src, '?surfacemacro=0');
  return disabled.randomCalls === baseRollback.randomCalls && disabled.canvases === baseRollback.canvases && digest(disabled.textures) === baseRollback.texturesDigest;
}
report.rollback = rollbackCheck(source);
if (!report.rollback) { report.failures.push('TXUP_ROLLBACK'); report.pass = false; }
if (process.argv.includes('--mutantes')) {
  const mutants = [
    ['emenda', (s) => s.replace('const offsetsX = periodic ?', 'const offsetsX = false && periodic ?'), 'TXUP_MACRO_SEAM'],
    ['micro', (s) => s.replace('periodic ? w * (0.25 + scale * 0.25)', 'periodic ? 12 + scale * 42'), 'TXUP_STAIN_MACRO'],
    ['rng', (s) => s.replace('function macro(ctx, w, h, n, cols, periodic = false) {', 'function macro(ctx, w, h, n, cols, periodic = false) { Math.random();'), 'TXUP_RNG'],
    ['resolucao', (s) => s.replace('const CHAO_PX = 512;', 'const CHAO_PX = 256;'), 'TXUP_SCALE_asphalt'],
    ['uso-asfalto', (s) => s.replace("macro(x, P, P, 5, ['rgba(150,148,146,0.13)', 'rgba(25,24,23,0.16)'], true);", "macro(x, P, P, 5, ['rgba(150,148,146,0.13)', 'rgba(25,24,23,0.16)'], false);"), 'TXUP_USAGE_asphalt'],
  ];
  report.mutants = mutants.map(([name, edit, expected]) => {
    const modified = edit(source);
    if (modified === source) throw new Error(`MUTANTE NÃO APLICOU: ${name}`);
    const result = checks(modified);
    return { name, killed: result.failures.includes(expected), expected, failures: result.failures };
  });
  const noRollback = source.replace("_texQS.get('surfacemacro') !== '0'", 'true');
  if (noRollback === source) throw new Error('MUTANTE NÃO APLICOU: rollback');
  report.mutants.push({ name: 'rollback', killed: !rollbackCheck(noRollback), expected: 'TXUP_ROLLBACK' });
  if (report.mutants.some((x) => !x.killed)) report.pass = false;
}
if (option('output')) fs.writeFileSync(option('output'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
process.exitCode = report.pass ? 0 : 1;
