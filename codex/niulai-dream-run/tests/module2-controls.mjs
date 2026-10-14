import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.NIULAI_BROWSER || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  args: ["--enable-webgl", "--ignore-gpu-blocklist", "--use-angle=swiftshader"]
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
const failedRequests = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => message.type() === "error" && errors.push(`console: ${message.text()}`));
page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`));

try {
  await page.goto(process.env.NIULAI_TEST_URL || "http://127.0.0.1:4173/", { waitUntil: "networkidle" });
  await page.locator("#start-button").click();
  await page.waitForFunction(() => window.__NIULAI_GAME__?.getState().state === "playing");

  await page.keyboard.press("KeyD");
  await page.waitForFunction(() => window.__NIULAI_GAME__.getState().hero.x > 2.25);
  let snapshot = await page.evaluate(() => window.__NIULAI_GAME__.getState());
  assert.equal(snapshot.lane, 1, "D 应切换至右道");

  await page.keyboard.press("KeyA");
  await page.keyboard.press("KeyA");
  await page.waitForFunction(() => window.__NIULAI_GAME__.getState().hero.x < -2.25);
  snapshot = await page.evaluate(() => window.__NIULAI_GAME__.getState());
  assert.equal(snapshot.lane, -1, "连续按 A 应切换至左道");

  await page.keyboard.press("Space");
  await page.waitForFunction(() => window.__NIULAI_GAME__.getState().hero.y > 0.55);
  snapshot = await page.evaluate(() => window.__NIULAI_GAME__.getState());
  assert.equal(snapshot.airborne, true, "空格应触发跳跃");

  await page.waitForFunction(() => window.__NIULAI_GAME__.getState().airborne === false);
  await page.keyboard.down("Shift");
  await page.keyboard.up("Shift");
  await page.waitForFunction(() => window.__NIULAI_GAME__.getState().dash.active === true);
  snapshot = await page.evaluate(() => window.__NIULAI_GAME__.getState());
  assert.ok(snapshot.dash.cooldown > 3.5, "冲刺后应进入冷却");

  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.__NIULAI_GAME__.getState().state === "paused");
  assert.equal(await page.locator("#pause-screen").isVisible(), true, "暂停层应显示");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.__NIULAI_GAME__.getState().state === "playing");

  await page.screenshot({ path: "artifacts/module-2-controls.png", fullPage: true });
  assert.deepEqual(errors, [], `发现浏览器错误：${errors.join(" | ")}`);
  assert.deepEqual(failedRequests, [], `发现请求失败：${failedRequests.join(" | ")}`);
  console.log(JSON.stringify({ module: "controls", status: "passed", snapshot }, null, 2));
} catch (error) {
  await page.screenshot({ path: "artifacts/module-2-failure.png", fullPage: true }).catch(() => {});
  console.error(JSON.stringify({ module: "controls", status: "failed", error: error.message, errors, failedRequests }, null, 2));
  throw error;
} finally {
  await browser.close();
}
