// Three.js Texture/Source UUIDs drive serialization caches; isolated allocation must
// preserve gameplay RNG without assigning the same UUID to different surfaces.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const {THREE}=await import('./harness.mjs');
const {registerDetail,detailFor,ajustarAnisotropia}=await import('../../public/js/textures.js');
const surface = await import('../../public/js/map_surface_finish.js');
let draws=0;const original=Math.random;const tracked=()=>{draws++;return .34567;};Math.random=tracked;
try {
  const a=surface.paintedPanel('#ffffff'),b=surface.paintedPanel('#496c7e');
  console.log(JSON.stringify({sameTextureUUID:a.uuid===b.uuid,sameSourceUUID:a.source.uuid===b.source.uuid,globalDraws:draws,restored:Math.random===tracked}));
  assert.notEqual(a.uuid,b.uuid,'Different painted surfaces collide on Texture UUID');
  assert.notEqual(a.source.uuid,b.source.uuid,'Different painted surfaces collide on Source UUID');
  assert.equal(draws,0);assert.equal(Math.random,tracked);
  const root={traverse(fn){fn({material:[{map:a},{map:b}]});}};
  ajustarAnisotropia(root,'low');assert.equal(a.anisotropy,4);assert.equal(b.anisotropy,4);
  ajustarAnisotropia(root,'med');assert.equal(a.anisotropy,8);assert.equal(b.anisotropy,8);
  console.log('Sampler real: LOW4/MED8');
  assert.throws(()=>surface.withSurfaceAllocation(()=>{throw Error('allocation probe');},true),/allocation probe/);
  assert.equal(Math.random,tracked,'Allocation throw must restore global RNG');
  if(process.argv.includes('--self-test')){
    const source=fs.readFileSync(new URL('../../public/js/map_surface_finish.js',import.meta.url),'utf8');
    const mutant=source.replace('Math.random = allocationRandom;','Math.random = localRandom(9271);');
    assert.notEqual(mutant,source,'Allocation mutant did not apply');
    const context=vm.createContext({THREE,Math,document:globalThis.document,registerDetail,detailFor});
    vm.runInContext(mutant.replace(/^import[^\n]*\n/gm,'').replace(/\bexport\s+(?=(?:function|const|let)\b)/g,'')+';globalThis.make=paintedPanel;',context);
    const first=context.make(),second=context.make();
    assert.ok(first.uuid===second.uuid && first.source.uuid===second.source.uuid,'Reset-per-surface mutant escaped real Three.js UUID probe');
    console.log('Mutante morto: duplicate-UUID');
  }
} finally {Math.random=original;}
