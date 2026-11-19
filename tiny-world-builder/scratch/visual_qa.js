const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ARTIFACTS_DIR = '/Users/jkneen/.gemini/antigravity-cli/brain/37f8fccb-ec13-4eb5-af4a-0fdc2f711243';
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const args = [
  '--headless=new',
  '--remote-debugging-port=9222',
  '--mute-audio',
  '--window-size=1200,900',
  '--user-data-dir=/tmp/chrome-visual-qa',
  'http://localhost:3000/tiny-world-builder'
];

console.log('Starting Chrome for Visual QA...');
const chromeProcess = spawn(chromePath, args);

// Log Chrome's internal output for debugging if needed
chromeProcess.stdout.on('data', (data) => {
  console.log(`[Chrome STDOUT] ${data.toString().trim()}`);
});
chromeProcess.stderr.on('data', (data) => {
  console.error(`[Chrome STDERR] ${data.toString().trim()}`);
});
chromeProcess.on('error', (err) => {
  console.error(`[Chrome Process Error] ${err}`);
});

let cmdId = 1;
const pendingCmds = new Map();

function sendCommand(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = cmdId++;
    pendingCmds.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function captureScreenshot(ws, filename) {
  console.log(`Capturing screenshot: ${filename}...`);
  const result = await sendCommand(ws, 'Page.captureScreenshot', { format: 'png' });
  const buffer = Buffer.from(result.data, 'base64');
  const filePath = path.join(ARTIFACTS_DIR, filename);
  fs.writeFileSync(filePath, buffer);
  console.log(`Saved screenshot to: ${filePath}`);
}

async function getPageTargetWithRetry(retries = 15, delayMs = 500) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9222/json/list');
      if (res.ok) {
        const targets = await res.json();
        const pageTarget = targets.find(t => t.url.includes('tiny-world-builder'));
        if (pageTarget) return pageTarget;
      }
    } catch (err) {
      // Ignore and retry
    }
    await delay(delayMs);
  }
  throw new Error('Could not connect to Chrome debugging port or find page target after retries.');
}

(async () => {
  try {
    console.log('Waiting for Chrome debugging port to become active...');
    const pageTarget = await getPageTargetWithRetry();
    console.log(`Connecting to WebSocket: ${pageTarget.webSocketDebuggerUrl}`);
    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);

    ws.onopen = async () => {
      console.log('WebSocket connected. Initializing...');
      ws.send(JSON.stringify({ id: cmdId++, method: 'Runtime.enable' }));
      ws.send(JSON.stringify({ id: cmdId++, method: 'Log.enable' }));
      ws.send(JSON.stringify({ id: cmdId++, method: 'Page.enable' }));

      // Set viewport
      await sendCommand(ws, 'Emulation.setDeviceMetricsOverride', {
        width: 1200,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false
      });

      console.log('Waiting 5 seconds for page load and assets...');
      await delay(5000);

      // Screenshot 1: Default
      await captureScreenshot(ws, 'qa_default.png');

      // Toggle landscape mode on
      console.log('Toggling Landscape Mode ON...');
      await sendCommand(ws, 'Runtime.evaluate', {
        expression: `
          (() => {
            const el = document.getElementById('render-landscape-mesh-mode');
            if (el) {
              el.checked = true;
              el.dispatchEvent(new Event('change'));
              return 'Landscape mode toggled ON';
            }
            return 'Landscape mode checkbox not found';
          })()
        `
      });
      console.log('Waiting for landscape mesh to load...');
      await delay(3000);

      // Screenshot 2: Landscape ON
      await captureScreenshot(ws, 'qa_landscape_on.png');

      // Toggle weather rain
      console.log('Enabling Rain Weather...');
      await sendCommand(ws, 'Runtime.evaluate', {
        expression: `
          (() => {
            document.body.classList.add('weather-rain');
            return 'Rain weather class added';
          })()
        `
      });
      await delay(2000);

      // Screenshot 3: Weather Rain
      await captureScreenshot(ws, 'qa_weather_rain.png');

      // Toggle landscape mode OFF to verify restore
      console.log('Toggling Landscape Mode OFF (verifying ghost boards restoration)...');
      await sendCommand(ws, 'Runtime.evaluate', {
        expression: `
          (() => {
            const el = document.getElementById('render-landscape-mesh-mode');
            if (el) {
              el.checked = false;
              el.dispatchEvent(new Event('change'));
              return 'Landscape mode toggled OFF';
            }
            return 'Landscape mode checkbox not found';
          })()
        `
      });
      await delay(2000);

      // Screenshot 4: Landscape OFF
      await captureScreenshot(ws, 'qa_landscape_off.png');

      console.log('QA script finished successfully. Cleaning up...');
      chromeProcess.kill();
      process.exit(0);
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pendingCmds.has(msg.id)) {
        const { resolve, reject } = pendingCmds.get(msg.id);
        pendingCmds.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method === 'Runtime.consoleAPICalled') {
        const type = msg.params.type;
        const argsText = msg.params.args.map(a => a.value || JSON.stringify(a)).join(' ');
        console.log(`[CONSOLE - ${type}] ${argsText}`);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        console.error('[EXCEPTION]', msg.params.exceptionDetails);
      }
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
      chromeProcess.kill();
      process.exit(1);
    };

  } catch (err) {
    console.error('QA script error:', err);
    chromeProcess.kill();
    process.exit(1);
  }
})();
