import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const cwd = resolve(import.meta.dirname, "..");
const version = JSON.parse(readFileSync(resolve(cwd, "package.json"), "utf8")).version;
const executable = resolve(cwd, "release", `WoollyDebts-${version}-win32-x64`, "WoollyDebts.exe");
const output = resolve(cwd, "test-output");
const port = 9338;
mkdirSync(output, { recursive: true });
const profile = mkdtempSync(resolve(output, "exe-profile-"));
if (!existsSync(executable)) throw new Error(`Packaged executable missing: ${executable}`);

const child = spawn(executable, [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "--use-angle=swiftshader",
  "--disable-gpu-sandbox",
  "--no-sandbox",
  "--enable-logging=stderr"
], {
  cwd,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"]
});
let diagnostics = "";
child.stdout?.on("data", (chunk) => diagnostics += chunk.toString());
child.stderr?.on("data", (chunk) => diagnostics += chunk.toString());

const endpoint = `http://127.0.0.1:${port}`;
async function waitForDevTools() {
  const started = Date.now();
  while (Date.now() - started < 60000) {
    try {
      const response = await fetch(`${endpoint}/json/version`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error("Packaged EXE did not expose DevTools within 60 seconds");
}

let browser;
try {
  await waitForDevTools();
  browser = await chromium.connectOverCDP(endpoint);
  const pages = browser.contexts().flatMap((context) => context.pages());
  const page = pages.find((candidate) => candidate.url().startsWith("file:")) ?? pages[0];
  if (!page) throw new Error("Packaged EXE opened no renderer page");
  await page.waitForFunction(() => Boolean(window.__woollyGame));
  const runtime = await page.evaluate(() => ({
    title: document.title,
    canvas: document.querySelectorAll("canvas").length,
    sheep: window.__woollyGame.sheepCount(),
    bill: window.__woollyGame.snapshot().currentBill.amount
  }));
  if (runtime.title !== "羊债必须清" || runtime.canvas !== 1 || runtime.sheep < 5 || runtime.bill !== 75) {
    throw new Error(`Unexpected packaged runtime: ${JSON.stringify(runtime)}`);
  }
  await page.screenshot({ path: resolve(output, `v${version}-05-packaged-exe.png`) });
  await page.evaluate(() => window.close());
  console.log(JSON.stringify({ ok: true, executable, ...runtime }, null, 2));
} catch (error) {
  if (diagnostics.trim()) console.error(diagnostics.trim());
  throw error;
} finally {
  await browser?.close();
  await new Promise((resolveWait) => setTimeout(resolveWait, 1200));
  if (child.exitCode === null) spawnSync("taskkill", ["/PID", `${child.pid}`, "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  await new Promise((resolveWait) => setTimeout(resolveWait, 800));
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {}
}
