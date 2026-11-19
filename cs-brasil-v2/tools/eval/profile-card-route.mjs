// Real route + real astro.config define, fake profile backend: proves the served PNG carries the logo.
import assert from 'node:assert/strict';
import http from 'node:http';
import sharp from 'sharp';
const mutant=process.argv.find(s=>s.startsWith('--mutant='))?.split('=')[1];
const BACKEND_PORT=4574,SITE_PORT=4575;
const profile={source:'server_verified',visibility:'public',nick:'OG Fixture',handle:'og_fixture',level:3,points:248,position:17,kills:180,deaths:92,kd:1.96,play_seconds:7380,last_character:'canarinho'};
const backend=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://x');
 if(url.pathname==='/api/social'&&url.searchParams.get('action')==='profile'&&url.searchParams.get('id')==='og_fixture'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({profile}));}
 else{res.writeHead(404);res.end('{}');}
});
await new Promise(r=>backend.listen(BACKEND_PORT,'127.0.0.1',r));
process.env.PUBLIC_API_BASE=`http://127.0.0.1:${BACKEND_PORT}`;
const plugins=[];
if(mutant==='route-no-logo')plugins.push({name:'mutant',enforce:'pre',transform(code,id){if(!id.includes('profile-card/[key].png.ts'))return;assert(code.includes(',__SOCIAL_LOGO__)'),'Mutation must apply');return code.replace(',__SOCIAL_LOGO__)',')');}});
else if(mutant==='no-define')plugins.push({name:'mutant',config(config){assert(config.define?.__SOCIAL_LOGO__,'Mutation must apply');delete config.define.__SOCIAL_LOGO__;}});
else assert(!mutant,'Unknown mutant');
const {dev}=await import('astro');
const server=await dev({root:process.cwd(),logLevel:'error',server:{host:'127.0.0.1',port:SITE_PORT},vite:{plugins}});
try{
 const started=performance.now();
 const response=await fetch(`http://127.0.0.1:${SITE_PORT}/api/profile-card/og_fixture.png`,{signal:AbortSignal.timeout(60000)});
 assert.equal(response.status,200,'route must serve the card');
 assert.equal(response.headers.get('content-type'),'image/png');
 const {data,info}=await sharp(Buffer.from(await response.arrayBuffer())).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 assert.equal(info.width,1200);assert.equal(info.height,630);
 // The logo's red "TRETA" is the only red inside its box; the text fallback is yellow.
 let red=0;
 for(let y=34;y<184;y++)for(let x=56;x<274;x++){const i=(y*1200+x)*4;if(data[i]>170&&data[i+1]<80&&data[i+2]<80)red++;}
 assert(red>1500,`served card has no logo; ${red} red pixels in the logo box`);
 console.log(`PASS route PNG 200 1200x630 with logo (${red} red px) in ${Math.round(performance.now()-started)} ms`);
}finally{await server.stop();backend.close();}
