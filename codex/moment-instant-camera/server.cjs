// Optional local server. The camera also runs by opening index.html directly.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.md':'text/markdown; charset=utf-8'};
const port = Number(process.argv[2] || process.env.PORT || 4178);
const server = http.createServer((req,res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname); }
  catch { res.writeHead(400); res.end('Bad request'); return; }
  if(pathname==='/__moment_health'){
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
    res.end(JSON.stringify({app:'moment-instant-camera',version:'1.0.0'}));return;
  }
  const file = path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  const relative = path.relative(root,file);
  if(relative.startsWith('..') || path.isAbsolute(relative)){res.writeHead(403);res.end('Forbidden');return;}
  fs.stat(file,(error,stat)=>{
    if(error||!stat.isFile()){res.writeHead(404);res.end('Not found');return;}
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
    fs.createReadStream(file).pipe(res);
  });
});
server.on('error',error=>{console.error(error.message);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`MOMENT camera: http://127.0.0.1:${port}`));
