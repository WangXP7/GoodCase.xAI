// Shared Playwright launcher: headless Chromium on the real GPU.
// Usage from other tools:
//   import { launch } from './pw.mjs';
//   const { browser, page } = await launch({ width: 1600, height: 900 });
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

// playwright-core is not a dependency of the game. Point at a copy with the PLAYWRIGHT_CORE
// environment variable or with { "playwrightCore": "<path to playwright-core/index.mjs>" } in
// tools/local.json (not tracked); otherwise an installed `playwright-core` package is used.
function localConfig() {
  try {
    return JSON.parse(fs.readFileSync(new URL('./local.json', import.meta.url), 'utf8'));
  } catch (e) {
    return {};
  }
}
const PW_CORE = process.env.PLAYWRIGHT_CORE || localConfig().playwrightCore || null;

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const base = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local'), 'ms-playwright');
  const dirs = fs
    .readdirSync(base)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const d of dirs) {
    for (const sub of ['chrome-win64', 'chrome-win']) {
      const exe = path.join(base, d, sub, 'chrome.exe');
      if (fs.existsSync(exe)) return exe;
    }
  }
  throw new Error('No Playwright Chromium build found in ' + base);
}

export async function launch({ width = 1600, height = 900, headless = true, args = [] } = {}) {
  const pw = PW_CORE ? await import(pathToFileURL(PW_CORE).href) : await import('playwright-core');
  const chromium = pw.chromium || pw.default.chromium;
  const browser = await chromium.launch({
    executablePath: findChromium(),
    headless,
    args: [
      '--use-angle=d3d11',
      '--use-gl=angle',
      '--enable-gpu',
      '--ignore-gpu-blocklist',
      '--enable-webgl',
      '--force_high_performance_gpu',
      '--disable-gpu-vsync',
      '--disable-frame-rate-limit',
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
      ...args,
    ],
  });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const logs = [];
  page.on('console', (m) => {
    const t = m.type();
    const line = `[${t}] ${m.text()}`;
    logs.push(line);
    if (t === 'error' || t === 'warning' || process.env.PW_VERBOSE) console.log(line);
  });
  page.on('pageerror', (e) => {
    const line = `[pageerror] ${e.message}\n${e.stack || ''}`;
    logs.push(line);
    console.log(line);
  });
  return { browser, context, page, logs };
}
