import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.NIULAI_TEST_URL || "http://127.0.0.1:4173/";
await mkdir("artifacts", { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.NIULAI_BROWSER || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  args: ["--enable-webgl", "--ignore-gpu-blocklist", "--use-angle=swiftshader"]
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
const failedRequests = [];

page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});
page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`));

try {
  const response = await page.goto(baseUrl, { waitUntil: "networkidle" });
  assert.equal(response?.status(), 200, "首页应正常返回");
  await page.locator("#scene canvas").waitFor({ state: "visible", timeout: 12_000 });

  const readyState = await page.evaluate(() => window.__NIULAI_GAME__?.getState());
  assert.equal(readyState.state, "ready");
  assert.ok(readyState.renderer.width >= 1000, "WebGL 画布宽度异常");
  assert.ok(readyState.renderer.height >= 700, "WebGL 画布高度异常");
  assert.equal(await page.locator("#game-title").isVisible(), true);

  await page.locator("#start-button").click();
  await page.waitForTimeout(900);
  const playingState = await page.evaluate(() => window.__NIULAI_GAME__.getState());
  assert.equal(playingState.state, "playing");
  assert.ok(playingState.distance > 0, "启程后旅程应前进");
  assert.equal(await page.locator("#hud").isVisible(), true);
  assert.equal(await page.locator("#title-screen").isVisible(), false);

  await page.screenshot({ path: "artifacts/module-1-core.png", fullPage: true });
  assert.deepEqual(errors, [], `发现浏览器错误：${errors.join(" | ")}`);
  assert.deepEqual(failedRequests, [], `发现请求失败：${failedRequests.join(" | ")}`);

  console.log(JSON.stringify({ module: "core", status: "passed", readyState, playingState }, null, 2));
} catch (error) {
  await page.screenshot({ path: "artifacts/module-1-failure.png", fullPage: true }).catch(() => {});
  console.error(JSON.stringify({
    module: "core",
    status: "failed",
    error: error.message,
    browserErrors: errors,
    failedRequests,
    url: page.url()
  }, null, 2));
  throw error;
} finally {
  await browser.close();
}
