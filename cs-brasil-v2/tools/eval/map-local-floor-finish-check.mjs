// R1 MED32 loja_h d: 84 closed oval stamps; atacadao piso: 30 closed circles.
// Instrument real canvas draw calls/material use. Zero closed stains encodes removal of
// that specific defect; it does not score pixels, hotspots or approve gameplay.
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root = new URL('../../public/js/', import.meta.url);
const ref=process.argv.find(a=>a.startsWith('--ref='))?.slice(6);
const read = name => ref ? execFileSync('git',['show',`${ref}:public/js/${name}`],{encoding:'utf8'}) : fs.readFileSync(new URL(name, root), 'utf8');
const clean = s => s.replace(/^import[^\n]*\n/gm, '').replace(/\bexport\s+(?=(?:function|const|let)\b)/g, '');
function probe(havan, atacadao, helper) {
  const metrics = { ellipses: 0, circles: 0, joints: 0, globalRandom: 0 };
  const draw = new Proxy({}, { get(o,k) {
    if (k === 'ellipse') return () => metrics.ellipses++;
    if (k === 'arc') return () => metrics.circles++;
    if (k === 'stroke') return () => metrics.joints++;
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
    return o[k] || (() => {});
  }, set(o,k,v) { o[k]=v; return true; } });
  const math = Object.create(Math); math.random = () => { metrics.globalRandom++; return .5; };
  class Texture { constructor(image) { this.image=image; this.userData={}; this.repeat={ set() {} }; } }
  const base = { THREE:{CanvasTexture:Texture,RepeatWrapping:1,SRGBColorSpace:'srgb'}, document:{createElement:()=>({getContext:()=>draw})}, Math:math, registerDetail:t=>t, detailFor() {}, lam:o=>o, URLSearchParams,location:{search:''},localStorage:{getItem:()=>'{"quality":"med"}'} };
  const ctx = vm.createContext(base);
  vm.runInContext(clean(helper), ctx);
  const noise = havan.slice(havan.indexOf('function noiseTex('), havan.indexOf('// painel ACM'));
  const floor = havan.split('\n').find(l => /^\s+floor: lam\(/.test(l))?.trim().replace(/^floor: /,'').replace(/,$/,'');
  if (!floor) throw Error('Actual Havan floor binding unavailable');
  vm.runInContext(noise+'\nglobalThis.havan = '+floor, ctx);
  const hv={...metrics,roughness:ctx.havan.roughness,metalness:ctx.havan.metalness};
  metrics.ellipses=metrics.circles=metrics.joints=0;
  const textureFns = atacadao.slice(atacadao.indexOf('const rng ='), atacadao.indexOf('/* Parede interna'));
  vm.runInContext(textureFns+'\npisoLojaTex(13,12);',ctx);
  const at={...metrics};
  return {havan:hv,atacadao:at};
}
const havan=read('map_havan.js'), atacadao=read('map_atacadao.js');
const helper=fs.existsSync(new URL('map_surface_finish.js',root))?fs.readFileSync(new URL('map_surface_finish.js',root),'utf8'):'';
const passes = r => r.havan.ellipses===0 && r.havan.circles===0 && r.havan.joints>0 && r.havan.roughness===.52 && r.havan.metalness===0 && r.atacadao.circles===0 && r.atacadao.joints>0 && r.atacadao.globalRandom===0;
const actual=probe(havan,atacadao,helper);
console.log(JSON.stringify(actual));
assert.ok(passes(actual),'Remove closed oval/circle stains in actual floor bindings; commercial floor retains slab joints and roughness .52 dielectric finish.');
if (process.argv.includes('--self-test')) {
  const mutants=[
    ['havan-oval-binding',havan.replace(/floor: lam\(.*$/m,"floor: lam({map: noiseTex('#c9cfd6', [['#b2b9c0',40,8,22,.45]],16,16),roughness:.52,metalness:0}),"),atacadao],
    ['havan-hotspot-finish',havan.replace('roughness: 0.52, metalness: 0,','roughness: 0.22, metalness: 0.10,'),atacadao],
    ['atacadao-circle-use',havan,atacadao.replace('x.globalAlpha = 1;\n  x.strokeStyle',"x.beginPath(); x.arc(128,128,25,0,6.2832); x.fill();\n  x.globalAlpha = 1;\n  x.strokeStyle")],
  ];
  for(const [name,h,a] of mutants){ assert.ok(h!==havan || a!==atacadao,`Mutante não aplicou: ${name}`); assert.ok(!passes(probe(h,a,helper)),`Mutante cego: ${name}`); console.log('Mutante morto: '+name); }
}
