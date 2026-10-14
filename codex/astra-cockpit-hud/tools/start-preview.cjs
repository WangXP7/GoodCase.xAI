// Detached local preview. Reuses the same project if it is already running.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const url = 'http://127.0.0.1:4187';

function health() {
  return new Promise(resolve => {
    const request = http.get(url + '/__astra_health', { timeout: 1000 }, response => {
      let data = '';
      response.on('data', chunk => { data += chunk; if (data.length > 4096) response.destroy(); });
      response.on('end', () => { try { const result = JSON.parse(data); resolve({ reachable: true, matches: result.app === 'astra-cockpit-hud' && result.root.toLowerCase() === root.toLowerCase(), pid: result.pid }); } catch { resolve({ reachable: true, matches: false }); } });
      response.on('error', () => resolve({ reachable: true, matches: false }));
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve({ reachable: false, matches: false }));
  });
}

(async () => {
  let status = await health();
  if (status.matches) { console.log(`ASTRA preview already running: ${url} (PID ${status.pid})`); return; }
  if (status.reachable) throw new Error('Port 4187 is serving another application. It was not changed.');
  const logDir = path.join(root, '.runtime');
  fs.mkdirSync(logDir, { recursive: true });
  const output = fs.openSync(path.join(logDir, 'preview.log'), 'a');
  let launchError;
  const child = spawn(process.execPath, [path.join(__dirname, 'serve.cjs')], {
    cwd: root,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', output, output],
    env: { ...process.env, ASTRA_PORT: '4187' }
  });
  child.on('error', error => { launchError = error; });
  child.unref();
  fs.closeSync(output);
  for (let i = 0; i < 40; i++) {
    if (launchError) throw launchError;
    await new Promise(resolve => setTimeout(resolve, 200));
    status = await health();
    if (status.matches) { console.log(`ASTRA preview ready: ${url} (PID ${status.pid})`); return; }
    if (status.reachable) throw new Error('Port 4187 belongs to another application. It was not changed.');
  }
  throw new Error('Preview did not become ready. See .runtime/preview.log. Offline index.html is still available.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
