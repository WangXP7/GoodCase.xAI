import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.chdir(root);
const contentDir=fs.existsSync('剧情源文件')?'剧情源文件':'../剧情源文件';
const releaseRoot=path.dirname(path.resolve(contentDir));
const require=createRequire(import.meta.url);
const {Compiler}=require('inkjs/full');
fs.mkdirSync('generated',{recursive:true});
await build({entryPoints:['src/catalog.ts'],outfile:'generated/catalog.mjs',bundle:true,platform:'node',format:'esm'});
const {events,endingTitles,statNames,obligations}=await import('../generated/catalog.mjs?'+Date.now());
const source={};
for(const file of fs.readdirSync(contentDir).filter(x=>x.endsWith('.md'))){
 const text=fs.readFileSync(path.join(contentDir,file),'utf8');
 for(const match of text.matchAll(/^# ([MAVRE]\d{2})\r?\n([\s\S]*?)(?=^# [MAVRE]\d{2}\r?$|(?![\s\S]))/gm)){
  if(source[match[1]])throw Error('Duplicate scene '+match[1]);
  const parts=match[2].split(/^## ([a-f])\r?\n/gm); const options={};
  for(let i=1;i<parts.length;i+=2)options[parts[i]]=parts[i+1].trim();
  source[match[1]]={body:parts[0].trim(),options,file};
 }
}
const vars=[...events.map(e=>e.id.toLowerCase()),...Object.keys(statNames),'proof','shadow',...['shen','lu','he','wei','sang','xu','cheng','luo'].map(x=>'rel_'+x),...['ledger','boats','receipt','white','survey','clinic','pact'].map(x=>'has_'+x)];
const preamble='VAR choice_id = ""\n'+vars.map(x=>'VAR '+x+' = 0').join('\n')+'\n';
const condition=r=>r.stat?`${r.stat} >= ${r.min}`:r.item?`has_${r.item} == 1`:r.proof?`proof >= ${r.proof}`:r.shadow?`shadow >= ${r.shadow}`:`${r.flag} == ${r.value}`;
const compiled={}; const counts={};
fs.mkdirSync(path.join(contentDir,'Ink'),{recursive:true});
for(const id of [...events.map(e=>e.id),...Object.keys(endingTitles)]){
 const scene=source[id];
 if(!scene)throw Error('Missing prose '+id);
 const event=events.find(e=>e.id===id);
 let ink=preamble+scene.body+'\n';
 if(event){
  for(const option of event.options){
   if(!scene.options[option.id])throw Error(`Missing outcome ${id}/${option.id}`);
   const conditions=(option.requires||[]).map(condition);
   for(const [stat,delta] of Object.entries(option.effect.stats||{}))if(delta<0&&['silver','grain'].includes(stat))conditions.push(`${stat} >= ${-delta}`);
   for(const debt of obligations[id]||[])for(const [stat,amount]of Object.entries(debt.stats)){const net=(option.effect.stats?.[stat]||0)+amount;if(net<0&&['silver','grain'].includes(stat))conditions.push(`(${debt.flag} != ${debt.equals} || ${stat} >= ${-net})`);}
   ink+=`* ${conditions.length?'{'+conditions.join(' && ')+'} ':''}[${option.label}]\n~ choice_id = "${option.id}"\n${scene.options[option.id]}\n-> END\n`;
  }
 } else ink+='\n-> END\n';
 fs.writeFileSync(path.join(contentDir,`Ink/${id}.ink`),ink);
 const errors=[];
 const compiler=new Compiler(ink,{errorHandler:(message,type)=>errors.push({message,type})});
 const story=compiler.Compile();
 if(errors.length)throw Error(id+': '+JSON.stringify(errors));
 compiled[id]=JSON.parse(story.ToJson());
 counts[id]={han:(scene.body.concat(...Object.values(scene.options),...(event?.options.map(x=>x.label)||[])).match(/\p{Script=Han}/gu)||[]).length,category:event?.category||'结局'};
}
fs.writeFileSync('generated/stories.json',JSON.stringify(compiled));
fs.writeFileSync('generated/prose.json',JSON.stringify(source,null,2));
fs.writeFileSync('generated/counts.json',JSON.stringify(counts,null,2));
await build({entryPoints:['src/core.ts'],outfile:'generated/core.mjs',bundle:true,platform:'node',format:'esm'});
const bundle=await build({entryPoints:['src/app.ts'],bundle:true,write:false,minify:true,target:'es2020',format:'iife',legalComments:'inline'});
const css=fs.readFileSync('src/style.css','utf8');
const script=bundle.outputFiles[0].text.replaceAll('</script','<\\/script');
const license=fs.readFileSync(path.join(path.dirname(path.dirname(require.resolve('inkjs/full'))),'LICENSE.md'),'utf8');
const html=`<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>晚明县志 · 二十四个月</title><style>${css}</style></head><body><div id="app"></div><script>${script}</script><!-- inkjs license\n${license.replaceAll('--','—')} --></body></html>`;
fs.writeFileSync(path.join(releaseRoot,'index.html'),html);
console.log(JSON.stringify({scenes:Object.keys(compiled).length,han:Object.values(counts).reduce((n,x)=>n+x.han,0),bytes:Buffer.byteLength(html)},null,2));
