import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.NIULAI_BROWSER || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  args: ["--enable-webgl", "--ignore-gpu-blocklist", "--use-angle=swiftshader", "--autoplay-policy=no-user-gesture-required"]
});
const baseUrl = process.env.NIULAI_TEST_URL || "http://127.0.0.1:4173/";
const errors = [];
const failedRequests = [];
const externalRequests = [];

function observe(page) {
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => message.type() === "error" && errors.push(`console: ${message.text()}`));
  page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith("http") && url.origin !== new URL(baseUrl).origin) externalRequests.push(request.url());
  });
}

try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  observe(desktop);
  await desktop.goto(`${baseUrl}?test=1`, { waitUntil: "networkidle" });
  await desktop.screenshot({ path: "artifacts/module-5-title.png", fullPage: true });
  assert.equal(await desktop.locator("#game-title").isVisible(), true);
  await desktop.locator("#start-button").click();
  await desktop.waitForFunction(() => window.__NIULAI_GAME__?.getState().state === "playing");
  await desktop.waitForTimeout(150);
  const audioState = await desktop.evaluate(() => ({
    supported: window.__NIULAI_GAME__.sound.supported,
    created: Boolean(window.__NIULAI_GAME__.sound.context),
    state: window.__NIULAI_GAME__.sound.context?.state || "none"
  }));
  assert.equal(audioState.supported, true);
  assert.equal(audioState.created, true, "启程后应初始化本地合成音景");
  assert.equal(await desktop.locator("#touch-controls").isVisible(), false, "桌面端不应遮挡触控键");

  await desktop.locator("#audio-button").click();
  assert.equal(await desktop.locator("#audio-button").getAttribute("aria-pressed"), "true");
  await desktop.locator("#audio-button").click();
  assert.equal(await desktop.locator("#audio-button").getAttribute("aria-pressed"), "false");
  await desktop.close();

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  });
  observe(mobile);
  await mobile.goto(`${baseUrl}?test=1`, { waitUntil: "networkidle" });
  await mobile.locator("#start-button").click();
  await mobile.waitForFunction(() => window.__NIULAI_GAME__?.getState().state === "playing");
  assert.equal(await mobile.locator("#touch-controls").isVisible(), true, "移动端应显示触控键");

  await mobile.locator('[data-action="right"]').tap();
  await mobile.waitForFunction(() => window.__NIULAI_GAME__.getState().lane === 1);
  await mobile.locator('[data-action="jump"]').tap();
  await mobile.waitForFunction(() => window.__NIULAI_GAME__.getState().airborne === true);
  const layout = await mobile.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    canvasWidth: document.querySelector("#scene canvas")?.getBoundingClientRect().width || 0,
    heroScreenX: window.__NIULAI_GAME__.getState().hero.screenX
  }));
  assert.ok(layout.scrollWidth <= layout.width, "移动端不应横向溢出");
  assert.equal(Math.round(layout.canvasWidth), layout.width, "移动端画布应填满视口");
  assert.ok(Math.abs(layout.heroScreenX) < 0.9, "移动端最外侧跑道上的角色也应保持在画面内");
  await mobile.screenshot({ path: "artifacts/module-5-mobile.png", fullPage: true });

  await mobile.locator("#pause-button").tap();
  await mobile.waitForFunction(() => window.__NIULAI_GAME__.getState().state === "paused");
  assert.equal(await mobile.locator("#pause-screen").isVisible(), true);
  await mobile.close();

  assert.deepEqual(errors, [], `发现浏览器错误：${errors.join(" | ")}`);
  assert.deepEqual(failedRequests, [], `发现请求失败：${failedRequests.join(" | ")}`);
  assert.deepEqual(externalRequests, [], `运行时不应联网：${externalRequests.join(" | ")}`);
  console.log(JSON.stringify({ module: "responsive-audio", status: "passed", audioState, layout }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ module: "responsive-audio", status: "failed", error: error.message, errors, failedRequests, externalRequests }, null, 2));
  throw error;
} finally {
  await browser.close();
}
