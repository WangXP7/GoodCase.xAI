import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { THREE } from './harness.mjs';
const moduleURL = new URL('../../public/js/decal_ink.js', import.meta.url);
const baseline = process.argv.includes('--baseline');
const originalSHA = { 'tag-larga.png': '778f365a50cbb6c04c9384ed9a22af8a29518b7ab3e581801a0c2e2870f6b3a2', 'folha-pixaca-03.png': 'b0c1f15217dc0411cacec87ac7894091155193285731c1a609c1f177657c75f5', 'folha-pixaca-04.png': 'f3a65a41e03cb8a794a8e27c4d05e2256b86565e90e0ab740ab186f50119b12e' };
const api = !baseline && existsSync(moduleURL) ? await import(moduleURL.href) : { aplicarTintaRecortada: () => false };
const names = ['tag-larga.png', 'folha-pixaca-03.png', 'folha-pixaca-04.png'];
// Os vazios claros medidos no recorte original são papel quadriculado, não tinta branca.
const sample = { 'tag-larga.png': [76, 23, 213], 'folha-pixaca-03.png': [192, 33, 117], 'folha-pixaca-04.png': null };
const linear = v => (v / 255 <= .04045 ? v / 255 / 12.92 : ((v / 255 + .055) / 1.055) ** 2.4);
const smooth = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
async function suite(candidate, soft = false) {
  const rows = [], failures = [];
  for (const name of names) {
    const path = new URL('../../public/img/decals/' + name, import.meta.url);
    assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), originalSHA[name], 'original artwork bytes preserved');
    const { data, info } = await sharp(path.pathname).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const mat = new THREE.MeshLambertMaterial({ transparent: true, alphaTest: .24, opacity: .88 });
    const before = { map: mat.map, transparent: mat.transparent, alphaTest: mat.alphaTest, depthWrite: mat.depthWrite, opacity: mat.opacity };
    let previousCalls = 0; mat.onBeforeCompile = shader => { previousCalls++; shader.fragmentShader += '\n// previous-hook'; };
    const applied = candidate.aplicarTintaRecortada(mat, name), shader = { fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
    mat.onBeforeCompile(shader, null);
    const code = shader.fragmentShader, ranges = code.match(/smoothstep\( ([\d.]+), ([\d.]+), inkLight \)/), chroma = code.match(/smoothstep\( ([\d.]+), ([\d.]+), inkChroma \)/);
    const maskLinear = rgb => ranges ? smooth(+ranges[1], +ranges[2], Math.min(...rgb)) * (chroma ? 1 - smooth(+chroma[1], +chroma[2], Math.max(...rgb) - Math.min(...rgb)) : 1) : 0;
    const mask = rgb => maskLinear(rgb.map(linear));
    let checker = 0, stillVisible = 0, halo = 0, visibleHalo = 0, ink = 0, damagedInk = 0;
    for (let i = 0; i < data.length; i += 4) {
      const rgb = [...data.subarray(i, i + 3)], alpha = data[i + 3] / 255;
      const after = code.includes('diffuseColor.a +=') ? alpha + 1 - mask(rgb) : alpha * (1 - mask(rgb));
      if (alpha > .95 && Math.min(...rgb) >= 200 && Math.max(...rgb) - Math.min(...rgb) <= 4) { checker++; if (after >= .24) stillVisible++; }
      // R1 deixou contornos claros no O/S; pixel REINOS (192,33)=117 e tinta escura <110.
      if (alpha > .95 && Math.min(...rgb) >= 116 && Math.min(...rgb) < 200 && Math.max(...rgb) - Math.min(...rgb) <= 4) { halo++; if (after >= .24) visibleHalo++; }
      if (alpha > 0 && Math.max(...rgb) < 110) { ink++; if (after !== alpha) damagedInk++; }
    }
    if (sample[name]) { const [x, y, v] = sample[name], n = (y * info.width + x) * 4; assert.equal(data[n], v); assert.equal(data[n + 3], 255); }
    // Fios R2: LinearFilter mistura papel claro opaco (>=200) com RGB azul transparente.
    let filtered = 0, visibleFiltered = 0;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4, rgb = [...data.subarray(i, i + 3)];
      if (data[i + 3] < 243 || Math.min(...rgb) < 200 || Math.max(...rgb) - Math.min(...rgb) > 4) continue;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= info.width || ny >= info.height) continue;
        const j = (ny * info.width + nx) * 4;
        if (data[j + 3] !== 0) continue;
        for (const w of [.25, .5, .75]) {
          const sampleRGB = rgb.map((v, k) => linear(v) * w + linear(data[j + k]) * (1 - w));
          const alpha = data[i + 3] / 255 * w;
          filtered++; if (alpha * (1 - maskLinear(sampleRGB)) >= .24) visibleFiltered++;
        }
      }
    }
    if (!applied || stillVisible || visibleHalo || visibleFiltered || damagedInk || !checker || previousCalls !== 1 || !code.includes('// previous-hook') || code.indexOf('inkLight') > code.indexOf('#include <alphatest_fragment>')) failures.push(name);
    assert.deepEqual(before, { map: mat.map, transparent: mat.transparent, alphaTest: mat.alphaTest, depthWrite: mat.depthWrite, opacity: mat.opacity });
    rows.push({ name, size: [info.width, info.height], sha256: createHash('sha256').update(readFileSync(path)).digest('hex'), checker, stillVisible, halo, visibleHalo, filtered, visibleFiltered, ink, damagedInk });
  }
  for (const name of ['pixo-lajes-01.png', 'or-pixo-sp-001.png', 'tag-larga.png.jpg', 'poster:tag-larga.png']) {
    const mat = new THREE.MeshBasicMaterial(); const before = mat.onBeforeCompile;
    if (candidate.aplicarTintaRecortada(mat, name) || mat.onBeforeCompile !== before) failures.push('other:' + name);
  }
  if (!soft && failures.length) console.log(JSON.stringify({ rows, failures }));
  if (!soft) assert.equal(failures.length, 0, 'shader must discard real checker pixels, preserve dark ink, existing hooks and other artwork: ' + failures.join(','));
  return { rows, failures };
}
if (!baseline) {
  const { esconderSeFaltar } = await import('../../public/js/graffiti_pass.js');
  for (const name of names) {
    const tex = new THREE.Texture(); tex.userData.decalArquivo = name;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: .24 }));
    esconderSeFaltar(mesh, tex); const shader = { fragmentShader: THREE.ShaderLib.basic.fragmentShader }; mesh.material.onBeforeCompile(shader);
    assert.equal(mesh.material.userData.tintaRecortada, name, 'shared production mounting path reaches the shader');
    assert.ok(shader.fragmentShader.includes('inkLight'));
    const clone = mesh.material.clone(); assert.equal(api.aplicarTintaRecortada(clone, name), true, 'a cloned material must regain its shader hook');
    assert.equal(api.aplicarTintaRecortada(clone, name), false, 'same instance is patched only once');
    tex.userData.aoFaltar(); assert.equal(mesh.visible, false, 'missing-image guard still works');
  }
  assert.ok(readFileSync(new URL('../../public/js/textures.js', import.meta.url), 'utf8').includes('t.userData.decalArquivo = f;'), 'texture producer identifies original artwork by exact filename');
}
const result = await suite(api, baseline);
console.log(JSON.stringify(result));
if (baseline) { assert.equal(result.failures.length, 3); process.exitCode = 1; }
else if (process.argv.includes('--self-test')) {
  const source = readFileSync(moduleURL, 'utf8');
  const mutations = [
    ['mask-off', source.replace('diffuseColor.a *=', 'diffuseColor.a +=')],
    ['missing-art', source.replace("'folha-pixaca-03.png'", "'missing.png'")],
    ['wrong-range', source.replace('0.155, 0.180', '0.90, 1.00')],
    ['legacy-halo', source.replace('0.155, 0.180', '0.35, 0.50')],
    ['filtered-paper', source.replace('diffuseColor.a *=', 'float inkChroma = max(sampledDiffuseColor.r, max(sampledDiffuseColor.g, sampledDiffuseColor.b)) - inkLight;\n  diffuseColor.a *= ').replace('smoothstep( 0.155, 0.180, inkLight );', 'smoothstep( 0.155, 0.180, inkLight ) * (1.0 - smoothstep( 0.015, 0.025, inkChroma ));')],
    ['lost-hook', source.replace('before.call(this, shader, renderer);', '')],
    ['wrong-art', source.replace('!RECORTES_PRETOS.has(arquivo) || ', '')],
  ];
  const detected = [];
  for (const [name, src] of mutations) {
    assert.notEqual(src, source); const m = await import('data:text/javascript,' + encodeURIComponent(src));
    const r = await suite(m, true); assert.ok(r.failures.length > 0, name); detected.push(name);
  }
  console.log(JSON.stringify({ detected }));
}
