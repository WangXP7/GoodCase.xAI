#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {extname,join,normalize,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import sharp from 'sharp';

const root=fileURLToPath(new URL('../../',import.meta.url)),publicRoot=join(root,'public'),output=join(root,'tools/eval/asset-evidence/items/fit-matrix');
const reportPath=join(output,'report.json'),evidencePath=join(output,'evidence-manifest.json'),port=Number(process.env.FIT_MATRIX_PORT||9473);
const manifest=JSON.parse(readFileSync(join(publicRoot,'models/items/eyewear-manifest.json'))),landmarks=JSON.parse(readFileSync(join(publicRoot,'models/items/face-landmarks.json')));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),hashFile=path=>sha(readFileSync(path));
const sourceHashes=()=>({
  eyewearManifest:hashFile(join(publicRoot,'models/items/eyewear-manifest.json')),
  faceLandmarks:hashFile(join(publicRoot,'models/items/face-landmarks.json')),
  eyewearRuntime:hashFile(join(publicRoot,'js/eyewear.js')),
  proceduralCap:hashFile(join(publicRoot,'js/procedural-cap.js')),
  scene:hashFile(join(root,'tools/eval/fit-matrix-scene.mjs')),
  captureTool:hashFile(fileURLToPath(import.meta.url)),
});
const mime=path=>({'.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.glb':'model/gltf-binary','.png':'image/png','.webp':'image/webp'}[extname(path)]||'application/octet-stream');
function server(){
  return createServer((request,response)=>{
    const pathname=new URL(request.url,'http://fit.local').pathname;
    if(pathname==='/__fit/'){
      response.setHeader('content-type','text/html');response.end('<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#182131}canvas{display:block;width:360px;height:360px}</style><script type="importmap">{"imports":{"three":"/vendor/three.module.js","three/addons/":"/vendor/addons/"}}</script><canvas width="360" height="360"></canvas><script type="module" src="/__fit/scene.mjs"></script>');return;
    }
    const file=pathname==='/__fit/scene.mjs'?join(root,'tools/eval/fit-matrix-scene.mjs'):join(publicRoot,normalize(pathname).replace(/^[/\\]+/,''));
    if(!relative(pathname==='/__fit/scene.mjs'?root:publicRoot,file).startsWith('..')&&existsSync(file)){response.setHeader('content-type',mime(file));response.end(readFileSync(file));return;}
    response.statusCode=404;response.end('not found');
  });
}
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
async function tile(buffer,label){
  const strip=Buffer.from(`<svg width="360" height="28"><rect width="360" height="28" fill="#0d1422"/><text x="10" y="19" font-family="Arial" font-size="14" font-weight="700" fill="#f3d75b">${escape(label)}</text></svg>`);
  return sharp({create:{width:360,height:388,channels:4,background:'#182131'}}).composite([{input:buffer,top:0,left:0},{input:strip,top:360,left:0}]).png().toBuffer();
}
async function sheet(title,cells,rows,path){
  const header=Buffer.from(`<svg width="1080" height="68"><rect width="1080" height="68" fill="#101827"/><text x="24" y="31" font-family="Arial" font-size="24" font-weight="700" fill="white">${escape(title)}</text><text x="24" y="54" font-family="Arial" font-size="14" fill="#f3d75b">PERFIL EXATO DO CORPO · certified:false · revisão humana pendente</text></svg>`);
  const composites=[{input:header,top:0,left:0}];for(let i=0;i<cells.length;i++)composites.push({input:cells[i],left:(i%3)*360,top:68+Math.floor(i/3)*388});
  await sharp({create:{width:1080,height:68+rows*388,channels:4,background:'#182131'}}).composite(composites).png({compressionLevel:9}).toFile(path);
}
async function comparison(beforePath,afterPath,path){
  const [before,after]=await Promise.all([sharp(beforePath).resize({width:540}).png().toBuffer(),sharp(afterPath).resize({width:540}).png().toBuffer()]);
  const header=Buffer.from('<svg width="1080" height="48"><rect width="1080" height="48" fill="#101827"/><text x="16" y="31" font-family="Arial" font-size="20" font-weight="700" fill="#ff7373">ANTES · relato reproduzido</text><text x="556" y="31" font-family="Arial" font-size="20" font-weight="700" fill="#65e889">DEPOIS · perfil individual, revisão pendente</text></svg>');
  await sharp({create:{width:1080,height:1246,channels:4,background:'#182131'}}).composite([{input:header,top:0,left:0},{input:before,top:48,left:0},{input:after,top:48,left:540}]).png({compressionLevel:9}).toFile(path);
}
async function capture(){
  mkdirSync(output,{recursive:true});const http=server();await new Promise((resolve,reject)=>http.once('error',reject).listen(port,'127.0.0.1',resolve));
  const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--mute-audio','--use-angle=metal']}),page=await browser.newPage({viewport:{width:360,height:360},deviceScaleFactor:1}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  const beforeFile='eyewear-capitao-oval-90-before.png';if(!existsSync(join(output,beforeFile)))throw new Error(`${beforeFile}: missing pre-fix evidence`);
  const report={schemaVersion:'cs-fit-matrix/1',status:'body-specific-study',certifiedPairs:0,summary:{assetAndPipeline:{state:'body-specific-study',versionedEyewearAssets:6,versionedProceduralCaps:1},measuredPairs:{eyewear:8,headwear:0},humanDecision:{state:'pending',certifiedPairs:0,storeEnabled:false}},reportedDefect:'encaixe depende do rosto e da cabeca; oval vermelho ainda estava fora de posicao e escala',sourceHashes:sourceHashes(),views:['front','threeQuarter','profile'],eyewear:[],headwear:[]},files=[beforeFile];
  try{
    await page.goto(`http://127.0.0.1:${port}/__fit/`,{waitUntil:'load'});await page.waitForFunction(()=>window.fitMatrixReady===true);
    const eyewearPoses=[['idle',0],['walk',.25],['run',.18],['crouch',1.5],['shoot',.35],['walkfire',.45]],views=report.views;
    for(const [itemId,entry]of Object.entries(manifest.eyewear))for(const bodyId of Object.keys(entry.profiles||{})){
      if(!['metal-de-rua','ouro-de-quebrada','oval-90','visor-de-pista'].includes(itemId))continue;
      await page.evaluate(([item,body])=>window.fitMatrix.loadEyewear(item,body),[itemId,bodyId]);const cells=[],poses=[];
      for(const [pose,time]of eyewearPoses){let metrics=null;for(const view of views){const frame=await page.evaluate(args=>window.fitMatrix.frame(args),{pose,time,view});if(frame.metrics)metrics=frame.metrics;cells.push(await tile(await page.locator('canvas').screenshot(),`${pose} · ${view}`));}poses.push({pose,time,metrics});}
      const filename=`eyewear-${bodyId}-${itemId}.png`;await sheet(`${bodyId} × ${entry.name}`,cells,eyewearPoses.length,join(output,filename));files.push(filename);
      report.eyewear.push({itemId,bodyId,bodySha256:landmarks.bodies[bodyId].bodySha256,assetSha256:entry.sha256,profileStatus:entry.profiles[bodyId].status,classification:entry.profiles[bodyId].classification,certified:false,poses,sheet:filename});
    }
    const comparisonFile='eyewear-capitao-oval-90-ab.png';await comparison(join(output,beforeFile),join(output,'eyewear-capitao-oval-90.png'),join(output,comparisonFile));files.push(comparisonFile);
    if(errors.length)throw new Error(`browser errors: ${errors.join('; ')}`);
    report.browserVersion=await browser.version();writeFileSync(reportPath,`${JSON.stringify(report)}\n`);
    const evidence={schemaVersion:'cs-fit-evidence/1',sourceHashes:report.sourceHashes,files:Object.fromEntries(files.sort().map(file=>[file,{bytes:readFileSync(join(output,file)).length,sha256:hashFile(join(output,file))}]))};writeFileSync(evidencePath,`${JSON.stringify(evidence,null,2)}\n`);
    console.log(`fit-matrix write: ${report.eyewear.length} eyewear pairs, ${report.headwear.length} cap pairs, ${files.length} real sheets, certified=0`);
  }finally{await browser.close();await new Promise(resolve=>http.close(resolve));}
}
function check(){
  const report=JSON.parse(readFileSync(reportPath)),evidence=JSON.parse(readFileSync(evidencePath)),current=sourceHashes();
  if(JSON.stringify(report.sourceHashes)!==JSON.stringify(current)||JSON.stringify(evidence.sourceHashes)!==JSON.stringify(current))throw new Error('fit matrix inputs are stale; run fit-matrix.mjs --write');
  if(report.certifiedPairs!==0||report.eyewear.length!==8||report.headwear.length!==0||report.reportedDefect!=='encaixe depende do rosto e da cabeca; oval vermelho ainda estava fora de posicao e escala')throw new Error('fit matrix coverage/certification/defect record mismatch');
  for(const [file,record]of Object.entries(evidence.files)){const path=join(output,file),bytes=readFileSync(path);if(bytes.length!==record.bytes||sha(bytes)!==record.sha256)throw new Error(`${file}: evidence hash mismatch`);}
  if(report.eyewear.some(row=>row.certified!==false)||report.headwear.some(row=>row.certified!==false))throw new Error('candidate evidence cannot certify a pair');
  console.log(`fit-matrix check: ${report.eyewear.length} eyewear pairs, ${report.headwear.length} cap pairs, ${Object.keys(evidence.files).length} hash-pinned sheets, certified=0`);
}
const mode=process.argv[2]||'--check';if(mode==='--write'||mode==='--capture')await capture();else if(mode==='--check')check();else throw new Error('usage: fit-matrix.mjs --check|--write');
