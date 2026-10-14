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

const state = () => page.evaluate(() => window.__NIULAI_GAME__.getState());
const advance = (distance) => page.evaluate((value) => window.__NIULAI_GAME__.game.debugAdvanceTo(value), distance);

try {
  await page.goto(`${process.env.NIULAI_TEST_URL || "http://127.0.0.1:4173/"}?test=1`, { waitUntil: "networkidle" });
  await page.locator("#start-button").click();
  await page.waitForFunction(() => window.__NIULAI_GAME__?.getState().state === "playing");

  await advance(240);
  await page.waitForFunction(() => window.__NIULAI_GAME__.getState().state === "dialog");
  let snapshot = await state();
  assert.equal(snapshot.chapter, 1);
  assert.equal(snapshot.chapterName, "荒漠问心");
  assert.equal(await page.locator("#dialog-screen").isVisible(), true);
  assert.equal(await page.locator("#dialog-title").textContent(), "荒漠问心");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "artifacts/module-4-chapter2.png", fullPage: true });
  await page.locator("#dialog-button").click();
  await page.waitForFunction(() => window.__NIULAI_GAME__.getState().state === "playing");

  await advance(520);
  await page.waitForFunction(() => window.__NIULAI_GAME__.getState().state === "dialog");
  snapshot = await state();
  assert.equal(snapshot.chapter, 2);
  assert.equal(snapshot.chapterName, "墨云天关");
  assert.equal(await page.locator("#mission-text").textContent(), "以踏风击碎暗影，抵达天光");
  await page.locator("#dialog-button").click();
  await page.waitForFunction(() => window.__NIULAI_GAME__.getState().state === "playing");

  await advance(819.95);
  await page.waitForFunction(() => window.__NIULAI_GAME__.getState().state === "complete");
  snapshot = await state();
  assert.equal(snapshot.distance, 820);
  assert.ok(snapshot.score >= 9400, "通关应包含旅程分与完成奖励");
  assert.equal(await page.locator("#result-screen").isVisible(), true);
  assert.equal(await page.locator("#result-title").textContent(), "你已成为自己的勇士");
  await page.screenshot({ path: "artifacts/module-4-complete.png", fullPage: true });

  await page.locator("#restart-button").click();
  await page.waitForFunction(() => window.__NIULAI_GAME__.getState().state === "playing");
  await page.locator("#pause-button").click();
  await page.waitForFunction(() => window.__NIULAI_GAME__.getState().state === "paused");
  await page.locator("#restart-from-pause").click();
  await page.waitForFunction(() => window.__NIULAI_GAME__.getState().state === "playing");
  snapshot = await state();
  assert.equal(snapshot.chapter, 0, "暂停页重新入梦应重置章节");
  assert.ok(snapshot.distance < 3, "重新入梦应重置旅程");
  assert.equal(snapshot.health, 3);

  assert.deepEqual(errors, [], `发现浏览器错误：${errors.join(" | ")}`);
  assert.deepEqual(failedRequests, [], `发现请求失败：${failedRequests.join(" | ")}`);
  console.log(JSON.stringify({ module: "progression", status: "passed", snapshot }, null, 2));
} catch (error) {
  await page.screenshot({ path: "artifacts/module-4-failure.png", fullPage: true }).catch(() => {});
  console.error(JSON.stringify({ module: "progression", status: "failed", error: error.message, errors, failedRequests, snapshot: await state().catch(() => null) }, null, 2));
  throw error;
} finally {
  await browser.close();
}
