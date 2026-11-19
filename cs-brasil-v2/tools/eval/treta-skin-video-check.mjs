// Vídeos de hover das skins (tools/gen-skin-video.mjs): toda skin aprovada no manifesto
// tem webm VP9 + mp4 H.264 + poster webp, cada vídeo com no máximo 400 KB, loop de 2 a 4 s.
// Lê os bytes reais; não precisa de ffmpeg. Mutantes alteram cópias em memória.
//   node tools/eval/treta-skin-video-check.mjs
//   node tools/eval/treta-skin-video-check.mjs --mutations
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import sharp from 'sharp';

const MAX=400*1024;
if(process.argv.includes('--mutations')){
  for(const [id,message] of [['sem-mp4','mp4 ausente'],['pesado','acima de 400 KB'],['codec','webm sem VP9'],['longo','loop fora de 2 a 4 s']]){
    const r=spawnSync(process.execPath,[new URL(import.meta.url).pathname,`--mutante=${id}`],{encoding:'utf8'});
    assert(r.status!==0 && r.stderr.includes(message),`Mutante ${id} não foi detectado (${r.stderr.slice(-300)})`);
  }
  console.log('PASS: 4/4 mutações dos vídeos de skin detectadas');process.exit(0);
}
const mutant=process.argv.find(a=>a.startsWith('--mutante='))?.split('=')[1];
const manifest=JSON.parse(fs.readFileSync('public/models/skins/manifest.json','utf8'));
const approved=Object.entries(manifest.skins).filter(([,e])=>e.approved===true);
assert(approved.length>0,'nenhuma skin aprovada no manifesto');
const read=p=>fs.readFileSync('public'+p);
let total=0,mutated=false;
for(const [id,entry] of approved){
  const v={...entry.video};
  if(!mutated && mutant==='sem-mp4'){delete v.mp4;mutated=true;}
  if(!mutated && mutant==='longo'){v.seconds=6;mutated=true;}
  for(const kind of ['webm','mp4','poster'])assert.match(v[kind] || '',new RegExp(`^/video/skins/${id}\\.(webm|mp4|webp)$`),`${id}: ${kind} ausente no manifesto`);
  assert(v.seconds>=2 && v.seconds<=4,`${id}: loop fora de 2 a 4 s (${v.seconds})`);
  let webm=read(v.webm),mp4=read(v.mp4);
  if(!mutated && mutant==='pesado'){mp4=Buffer.concat([mp4,Buffer.alloc(MAX)]);mutated=true;}
  if(!mutated && mutant==='codec'){webm=Buffer.from(webm.toString('latin1').replace('V_VP9','V_VP8'),'latin1');mutated=true;}
  for(const [kind,buf] of [['webm',webm],['mp4',mp4]])assert(buf.length<=MAX,`${id}: ${kind} acima de 400 KB (${buf.length})`);
  assert(webm.readUInt32BE(0)===0x1a45dfa3 && webm.includes('webm') && webm.includes('V_VP9'),`${id}: webm sem VP9`);
  assert(mp4.subarray(4,8).toString()==='ftyp' && mp4.includes('avc1'),`${id}: mp4 sem H.264`);
  const moov=mp4.indexOf('moov'),mdat=mp4.indexOf('mdat');
  assert(moov>0 && moov<mdat,`${id}: mp4 sem faststart (moov depois do mdat)`);
  const poster=await sharp(read(v.poster)).metadata();
  assert(poster.format==='webp' && poster.width===v.width && poster.height===v.height,`${id}: poster não bate com o vídeo`);
  total+=webm.length+mp4.length+read(v.poster).length;
}
assert(!mutant || mutated,'MUTANTE NÃO APLICOU');
console.log(`PASS: ${approved.length} skins aprovadas com webm VP9 + mp4 H.264 + poster, todos ≤ 400 KB (${(total/1024/1024).toFixed(1)} MB no total)`);
