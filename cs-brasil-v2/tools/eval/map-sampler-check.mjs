/* Samplers das oito fábricas locais: runtime, MED8/LOW4/OFF1, sem bitmap/GPU.
   TEXEL4 continua em texel-check.mjs; aqui só se observam as fábricas corrigidas.
   --source=/espelho aceita fonte independente; --out=/fora/git salva provas.
   --self-test remove a chamada de canvasTex numa cópia temporária e exige RED. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const file = fileURLToPath(import.meta.url);
const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const source = path.resolve(arg('source') || path.join(path.dirname(file), '../..'));
const targets = {
  loja_h: { file: 'map_havan.js', factories: ['tileTex', 'tintaTex', 'oil'], horizontal: 6, lowHorizontal: 5 },
  ferro_velho: { file: 'map_ferrovelho.js', factories: ['blobTex', 'bladeTex', 'puddleTex'], horizontal: 79 },
  obras_prefeitura: { file: 'map_obras.js', factories: ['hazardTex'], horizontal: 1 },
  atacadao_treta: { file: 'map_atacadao.js', factories: ['canvasTex'], horizontal: 3 },
};
const modes = {
  med: { quality: 'med', query: '', expected: 8 },
  'low-query': { quality: 'low', query: '?q=low', expected: 4 },
  'low-storage': { quality: 'low', query: '', expected: 4 },
  off: { quality: 'low', query: '?q=low&texel=0', expected: 1 },
};
const id = arg('mapa'), mode = arg('mode');
if (!id) {
  const selected = (arg('modes') || Object.keys(modes).join(',')).split(',');
  if (selected.some(m => !modes[m])) throw Error('Modo desconhecido');
  if (arg('out')) fs.mkdirSync(arg('out'), { recursive: true });
  let failures = 0;
  for (const map of Object.keys(targets)) for (const m of selected) {
    const run = spawnSync(process.execPath, [file, `--source=${source}`, `--mapa=${map}`, `--mode=${m}`,
      ...(arg('out') ? [`--json=${path.resolve(arg('out'), `${map}-${m}.json`)}`] : [])], { encoding: 'utf8', timeout: 60000 });
    process.stdout.write(run.stdout); if (run.status !== 0) { failures++; process.stderr.write(run.stderr.slice(-1200)); }
  }
  if (process.argv.includes('--self-test') && !failures) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'csbrasil-sampler-mutant-'));
    try {
      fs.mkdirSync(path.join(tmp, 'public'), { recursive: true });
      fs.cpSync(path.join(source, 'public/js'), path.join(tmp, 'public/js'), { recursive: true });
      for (const dir of ['vendor', 'models', 'img']) fs.symlinkSync(path.join(source, 'public', dir), path.join(tmp, 'public', dir), 'dir');
      fs.mkdirSync(path.join(tmp, 'tools/eval'), { recursive: true });
      fs.copyFileSync(path.join(source, 'tools/eval/harness.mjs'), path.join(tmp, 'tools/eval/harness.mjs'));
      fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module","private":true}');
      const p = path.join(tmp, 'public/js/map_atacadao.js'); let s = fs.readFileSync(p, 'utf8');
      const start = s.indexOf('function canvasTex('), end = s.indexOf('return t;', start);
      const body = s.slice(start, end), call = 'detailFor(t);';
      if (start < 0 || end < 0 || body.split(call).length !== 2) throw Error('Mutante não pode remover exatamente uma chamada');
      s = s.slice(0, start) + body.replace(call, '') + s.slice(end); fs.writeFileSync(p, s);
      const run = spawnSync(process.execPath, [file, `--source=${tmp}`, '--mapa=atacadao_treta', '--mode=med'], { encoding: 'utf8', timeout: 60000 });
      const killed = run.status === 1 && /SAMPLER.*canvasTex.*anisotropy=1 esperado=8/.test(run.stderr);
      console.log(`${killed ? '✓' : '✗'} MUTANTE canvasTex sem detailFor aplicado em cópia: ${killed ? 'RED específico' : run.stderr.slice(-1000)}`);
      if (!killed) failures++;
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  console.log(`Samplers: ${Object.keys(targets).length} mapas × ${selected.length} modos; ${failures} falha(s). Pixel/GPU exigem navegador.`);
  process.exit(failures ? 1 : 0);
}
if (!targets[id] || !modes[mode]) throw Error('Mapa/modo desconhecido');
process.env.SIM_QS = modes[mode].query;
globalThis.localStorage = { getItem: k => k === 'awpbr_settings' ? JSON.stringify({ quality: modes[mode].quality }) : null, setItem() {} };
const { THREE, MAPS, initTextures, seedRandom } = await import(pathToFileURL(path.join(source, 'tools/eval/harness.mjs')));
console.warn = () => {};
const cfg = targets[id], values = new WeakMap(), origins = new Map();
const src = fs.readFileSync(path.join(source, 'public/js', cfg.file), 'utf8');
const oilBefore = src.slice(0, src.indexOf('const oilMat ='));
const oilLine = oilBefore.slice(0, oilBefore.lastIndexOf('const t = new THREE.CanvasTexture(c)')).split('\n').length;
/* Texture atribui anisotropy no construtor. Observar essa atribuição captura a fábrica
   sem tags no jogo e sem criar textura, geometria, normal ou chamada RNG adicional. */
Object.defineProperty(THREE.Texture.prototype, 'anisotropy', { configurable: true,
  get() { return values.get(this); },
  set(v) {
    values.set(this, v);
    if (origins.has(this)) return;
    const stack = new Error().stack || '';
    const named = cfg.factories.find(n => n !== 'oil' && new RegExp(`at ${n} \\([^\\n]*${cfg.file}:`).test(stack));
    if (named) origins.set(this, named);
    else if (cfg.factories.includes('oil') && stack.includes(`${cfg.file}:${oilLine}:`)) origins.set(this, 'oil');
  },
});
const textures = initTextures(); seedRandom(12345);
const scene = new THREE.Scene(), world = MAPS[id].build(scene, textures); scene.updateMatrixWorld(true);
const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), cross = new THREE.Vector3();
function horizontal(o) {
  const p = o.geometry?.attributes?.position, idx = o.geometry?.index;
  if (!p || !o.geometry.attributes.uv) return false;
  const n = (idx ? idx.count : p.count) / 3, step = Math.max(1, Math.ceil(n / 400)); let area = 0, y = 0;
  for (let t = 0; t < n; t += step) {
    const a = idx ? idx.getX(t * 3) : t * 3, b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    v0.fromBufferAttribute(p, a).applyMatrix4(o.matrixWorld); v1.fromBufferAttribute(p, b).applyMatrix4(o.matrixWorld); v2.fromBufferAttribute(p, c).applyMatrix4(o.matrixWorld);
    cross.crossVectors(e1.subVectors(v1, v0), e2.subVectors(v2, v0)); const half = cross.length() / 2;
    if (half > 1e-9) { area += half; y += Math.abs(cross.y) / 2; }
  }
  return area > 0 && y / area > .7;
}
const bySource = new WeakMap([...origins].map(([t, factory]) => [t.source, factory]));
const seen = new Map(), surfaces = [];
world.root.traverse(o => {
  if (!o.isMesh || o.visible === false) return;
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  const m = mats.find(x => x?.map) || mats[0], t = m?.map, factory = t && (origins.get(t) || bySource.get(t.source));
  if (!factory) return;
  seen.set(t, factory); surfaces.push({ factory, name: o.name || o.geometry.type, horizontal: horizontal(o), anisotropy: t.anisotropy });
});
let failures = 0;
for (const factory of cfg.factories) {
  const ts = [...seen].filter(([, f]) => f === factory);
  if (!ts.length) { console.error(`✗ SAMPLER ${id} ${factory}: fábrica sem textura observada`); failures++; }
  for (const [t] of ts) if (t.anisotropy !== modes[mode].expected) { console.error(`✗ SAMPLER ${id} ${factory}: anisotropy=${t.anisotropy} esperado=${modes[mode].expected}`); failures++; }
}
const count = surfaces.filter(s => s.horizontal).length;
// Loja H já omite um lote de tinta no LOW (DECO_HI); baseline LOW confirma cinco.
const expectedCount = modes[mode].quality === 'low' ? (cfg.lowHorizontal ?? cfg.horizontal) : cfg.horizontal;
if (count !== expectedCount) { console.error(`✗ SAMPLER ${id}: horizontais=${count} esperado=${expectedCount}`); failures++; }
const result = { id, mode, quality: modes[mode].quality, query: modes[mode].query, expected: modes[mode].expected, horizontal: count, textures: seen.size, factories: cfg.factories, failures, surfaces };
if (arg('json')) fs.writeFileSync(arg('json'), JSON.stringify(result, null, 2));
console.log(`${failures ? '✗' : '✓'} SAMPLER ${id} ${mode}: ${seen.size} texturas / ${count} horizontais; anisotropy=${modes[mode].expected}`);
process.exit(failures ? 1 : 0);
