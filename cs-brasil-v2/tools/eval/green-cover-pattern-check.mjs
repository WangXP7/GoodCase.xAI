// R2 bd7ec163: Posto MED/LOW mostra bandas novas; crops em r2-regpixel-clean/.
// Mede desenho real: green sem macro, preserva grão/lâminas e desenho brown exato.
// Não aprova pixel, distância, contraste de personagem ou gameplay.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const file=new URL('../../public/js/map_surface_finish.js',import.meta.url);
const source=fs.readFileSync(file,'utf8');
const baselineRef='bd7ec16336204211b2a18c31ddc3eef95b1b2c19';
const baseline=execFileSync('git',['show',`${baselineRef}:public/js/map_surface_finish.js`],{encoding:'utf8'});
function measure(src,green){
  const counts={radials:0,macroFills:0,grain:0,blades:0};
  const signature=createHash('sha256'),microSignature=createHash('sha256');const state={};
  const ctx=new Proxy(state,{get(o,k){
    if(k==='createRadialGradient')return(...args)=>{counts.radials++;return{radial:true,args,stops:[],addColorStop(p,c){this.stops.push([p,c]);}};};
    if(k==='fillRect')return(...args)=>{if(o.fillStyle?.radial)counts.macroFills++;if(args[2]<3 && args[3]<3){counts.grain++;microSignature.update(JSON.stringify([k,args,o]));}signature.update(JSON.stringify([k,args,o]));};
    if(k==='stroke')return(...args)=>{counts.blades++;microSignature.update(JSON.stringify([k,args,o]));signature.update(JSON.stringify([k,args,o]));};
    return o[k]??((...args)=>{microSignature.update(JSON.stringify([k,args,o]));signature.update(JSON.stringify([k,args,o]));});
  },set(o,k,v){o[k]=v;return true;}});
  class Texture{constructor(image){this.image=image;this.repeat={set(x,y){this.x=x;this.y=y;}};}}
  const math=Object.create(Math);math.random=()=>.5;
  const context=vm.createContext({THREE:{CanvasTexture:Texture,RepeatWrapping:1,SRGBColorSpace:'srgb'},Math:math,document:{createElement:()=>({getContext:()=>ctx})},registerDetail:t=>t,detailFor(){}});
  vm.runInContext(src.replace(/^import[^\n]*\n/gm,'').replace(/\bexport\s+(?=(?:function|const|let)\b)/g,'')+';globalThis.run=soilSurface;',context);
  const texture=context.run(1,1,green);
  return{...counts,signature:signature.digest('hex'),microSignature:microSignature.digest('hex'),size:[texture.image.width,texture.image.height],repeat:[texture.repeat.x,texture.repeat.y]};
}
const baseBrown=measure(baseline,false),baseGreen=measure(baseline,true);
function evaluate(src){
  const green=measure(src,true),brown=measure(src,false);
  const pass=green.radials===0 && green.macroFills===0 && green.grain===2800 && green.blades===260 && brown.radials===72 && brown.macroFills===72 && brown.grain===2800 && brown.blades===0 && brown.signature===baseBrown.signature && green.microSignature===baseGreen.microSignature && green.size.every(v=>v===256) && green.repeat.every(v=>v===1);
  return{pass,green,brown,brownMatchesR2:brown.signature===baseBrown.signature,greenMicroMatchesR2:green.microSignature===baseGreen.microSignature};
}
const actual=evaluate(source);console.log(JSON.stringify(actual));
assert.ok(actual.pass,'Posto green must lose macro bands only; retain 2800 grain calls/260 blades and exact R2 brown rendering.');
if(process.argv.includes('--self-test')){
  const mutants=[['green-macro-on',source.replace('if (green) continue;','if (false) continue;')],['grain-off',source.replace('for (let i = 0; i < 2800; i++)','for (let i = 0; i < 0; i++)')]];
  for(const[name,mutant]of mutants){assert.notEqual(mutant,source,`Mutante não aplicou: ${name}`);const result=evaluate(mutant);assert.ok(!result.pass,`Mutante cego: ${name}`);console.log(JSON.stringify({mutant:name,killed:true,greenRadials:result.green.radials,greenGrain:result.green.grain}));}
}
