// Perfil real salvo no menu: LOW usa 4, MED 8; política textures.js e kill-switch texel=0.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../public/js/textures.js', import.meta.url), 'utf8');
const gameSource = fs.readFileSync(new URL('../../public/js/game.js', import.meta.url), 'utf8');
const mainSource = fs.readFileSync(new URL('../../public/js/main.js', import.meta.url), 'utf8');
function runtime(src, search, storage) {
  class Texture {
    constructor() { this.anisotropy = 1; this.source = {}; this.repeat = { set() {} }; }
  }
  const THREE = { CanvasTexture: Texture, SRGBColorSpace: 'srgb', NearestFilter: 'nearest', LinearMipmapLinearFilter: 'mipmap', RepeatWrapping: 'repeat' };
  const ctx = vm.createContext({ THREE, URLSearchParams, location: { search }, localStorage: { getItem: () => storage } });
  vm.runInContext(src.replace(/^import[^\n]*\n/gm, '').replace(/\bexport\s+(?=(?:function|const|let)\b)/g, '') + '\n;globalThis.probe = { tex, detailFor, ajustarAnisotropia: typeof ajustarAnisotropia === "function" ? ajustarAnisotropia : () => {} };', ctx);
  return { ctx, Texture };
}
function probe(src, search, storage) {
  const { ctx, Texture } = runtime(src, search, storage);
  const own = ctx.probe.tex({}), local = new Texture();
  ctx.probe.detailFor(local);
  return [own.anisotropy, local.anisotropy, own.magFilter];
}
const cases = [
  ['menu-low', '', '{"quality":"low"}', 4],
  ['menu-med', '', '{"quality":"med"}', 8],
  ['query-low', '?q=low', '{"quality":"med"}', 4],
  ['query-med', '?q=med', '{"quality":"low"}', 8],
  ['off', '?q=low&texel=0', '{"quality":"low"}', 1],
  ['invalid-storage', '', '{', 8],
];
function evaluate(src) {
  return cases.map(([name, search, storage, expected]) => {
    const actual = probe(src, search, storage);
    return { name, expected, actual, pass: actual[0] === expected && actual[1] === expected && actual[2] === 'nearest' };
  });
}
const rows = evaluate(source);
console.log(JSON.stringify({ rows }));
assert.ok(rows.every(r => r.pass), 'LOW do menu precisa usar 4 em tex() e detailFor(); preserve Nearest e texel=0');
function transitions(src, gameSrc = gameSource, mainSrc = mainSource) {
  const { ctx, Texture } = runtime(src, '', '{"quality":"med"}');
  const own = ctx.probe.tex({}), clone = new Texture(), unrelated = new Texture();
  clone.source = own.source; clone.anisotropy = own.anisotropy;
  unrelated.anisotropy = 16;
  const material = { map: clone }, root = { userData: {}, traverse(fn) { fn({ material }); fn({ material: [{ map: unrelated }, material] }); } };
  const method = gameSrc.slice(gameSrc.indexOf('  _applyQuality() {'), gameSrc.indexOf('\n  onResize() {'));
  vm.runInContext('globalThis.applyGame = ({' + method + '})._applyQuality;', ctx);
  const game = { settings: { quality: 'low' }, scene: root, world: { sun: {} }, renderer: { shadowMap: {}, setPixelRatio() {} } };
  ctx.applyGame.call(game);
  const low = clone.anisotropy, lowNew = ctx.probe.tex({}).anisotropy;
  game.settings.quality = 'med'; ctx.applyGame.call(game);
  const med = clone.anisotropy, medNew = ctx.probe.tex({}).anisotropy;
  const boot = mainSrc.includes('ajustarAnisotropia(null, settings.quality);') && mainSrc.indexOf('ajustarAnisotropia(null, settings.quality);') < mainSrc.indexOf('const textures = initTextures();');
  const menuTexture = ctx.probe.tex({}), menuClone = new Texture();
  menuClone.source = menuTexture.source; menuClone.anisotropy = menuTexture.anisotropy;
  ctx.menuScene = { traverse(fn) { fn({ material: { map: menuClone } }); } };
  ctx.qualEl = { value: 'low' }; ctx.settings = { quality: 'med' }; ctx.game = null; ctx.saveSettings = () => {};
  vm.runInContext(mainSrc.split('\n').find(l => l.startsWith('qualEl.onchange = ')), ctx);
  ctx.qualEl.onchange(); const menuLow = menuClone.anisotropy;
  ctx.THREE.Scene = class { traverse(fn) { fn({ material: { map: menuClone } }); } };
  ctx.MAPS = { test: { build() { menuClone.anisotropy = menuTexture.anisotropy; } } }; ctx.currentMap = 'test'; ctx.textures = {}; ctx.renderer = { liberaPosDaCena() {} };
  const rebuild = mainSrc.slice(mainSrc.indexOf('function rebuildMenuBackdrop('), mainSrc.indexOf('\nfunction menuProps('));
  vm.runInContext(rebuild + '\nrebuildMenuBackdrop(MAPS.test);', ctx);
  const rebuiltLow = menuClone.anisotropy;
  return { low, lowNew, med, medNew, unrelated: unrelated.anisotropy, boot, menuLow, rebuiltLow, pass: low === 4 && lowNew === 4 && med === 8 && medNew === 8 && unrelated.anisotropy === 16 && boot && menuLow === 4 && rebuiltLow === 4 };
}
const dynamic = transitions(source);
console.log(JSON.stringify({ dynamic }));
assert.ok(dynamic.pass, 'LOW automático/ao vivo precisa atualizar clones e novas texturas; GLB externo preservado');
if (process.argv.includes('--self-test')) {
  const mutants = [
    ['ignore-menu', source.replace("quality = JSON.parse(localStorage.getItem('awpbr_settings') || '{}').quality || quality;", '')],
    ['ignore-off', source.replace("_texQS.get('texel') !== '0'", 'true')],
  ];
  for (const [name, mutated] of mutants) {
    assert.notEqual(mutated, source, 'mutante não aplicou: ' + name);
    assert.ok(evaluate(mutated).some(r => !r.pass), 'mutante cego: ' + name);
  }
  const disconnected = gameSource.replace('ajustarAnisotropia(this.scene, q);', '');
  assert.notEqual(disconnected, gameSource); assert.ok(!transitions(source, disconnected).pass, 'chamada Game perdida precisa reprovar');
  const disconnectedBoot = mainSource.replace('ajustarAnisotropia(null, settings.quality);', '');
  assert.notEqual(disconnectedBoot, mainSource); assert.ok(!transitions(source, gameSource, disconnectedBoot).pass, 'chamada boot perdida precisa reprovar');
  const disconnectedMenu = mainSource.replaceAll('ajustarAnisotropia(menuScene, settings.quality);', '');
  assert.notEqual(disconnectedMenu, mainSource); assert.ok(!transitions(source, gameSource, disconnectedMenu).pass, 'chamadas menu perdidas precisam reprovar');
  console.log(JSON.stringify({ detected: [...mutants.map(m => m[0]), 'live-call', 'boot-call', 'menu-call'] }));
}
