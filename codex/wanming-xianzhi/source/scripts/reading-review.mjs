import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {newWorld,choose,advance} from '../generated/core.mjs';
import {events,chapters} from '../generated/catalog.mjs';
const codeRoot=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.chdir(fs.existsSync(path.join(codeRoot,'剧情源文件'))?codeRoot:path.dirname(codeRoot));
const runs=['E01','E02','E06'].map(id=>{const route=JSON.parse(fs.readFileSync(`验收/见证_${id}.json`,'utf8'));let w=newWorld(route.seed);for(const [,option]of route.decisions)w=advance(choose(w,option));return {id,w};});
for(let chapter=0;chapter<6;chapter++){
 let text=`# 三路径逐事对读 · ${chapters[chapter]}\n\n公共正文见源稿及完整通读稿；这里并列核读每一选择结果与发生变化的正文。\n\n`;
 for(const event of events.filter(e=>e.chapter===chapter)){
  const hs=runs.map(r=>({id:r.id,h:r.w.history.find(h=>h.id===event.id)}));
  text+=`## ${event.id} ${event.title}\n\n`;
  const variants=new Map();for(const r of hs)for(const p of r.h.body){if(!variants.has(p))variants.set(p,[]);variants.get(p).push(r.id);}
  for(const [p,ids]of variants)if(ids.length!==3)text+=`正文变体 ${ids.join('/')}：${p}\n\n`;
  for(const {id,h}of hs)text+=`${id} · ${h.choice}\n\n${h.outcome.join('\n\n')}\n\n`;
 }
 fs.writeFileSync(`验收/合读_卷${chapter+1}.md`,text);
}
console.log('Six chapter comparison files generated from legal runtime outputs.');
