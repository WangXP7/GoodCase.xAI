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
const spawnObstacle = (lane, type, ahead) => page.evaluate(
  ({ lane, type, ahead }) => {
    window.__NIULAI_GAME__.game.debugSpawnObstacle(lane, type, ahead);
    return true;
  },
  { lane, type, ahead }
);
const spawnFeather = (lane, ahead, height = 1.15) => page.evaluate(
  ({ lane, ahead, height }) => {
    window.__NIULAI_GAME__.game.debugSpawnFeather(lane, ahead, height);
    return true;
  },
  { lane, ahead, height }
);

try {
  await page.goto(`${process.env.NIULAI_TEST_URL || "http://127.0.0.1:4173/"}?test=1`, { waitUntil: "networkidle" });
  await page.locator("#start-button").click();
  await page.waitForFunction(() => window.__NIULAI_GAME__?.getState().state === "playing");

  await spawnObstacle(-1, "stone", 13);
  await spawnObstacle(0, "log", 19);
  await spawnObstacle(1, "shadow", 25);
  for (let index = 0; index < 5; index += 1) await spawnFeather(-1, 17 + index * 2, 1.2 + (index % 2) * 0.45);
  await page.waitForTimeout(120);
  await page.screenshot({ path: "artifacts/module-3-gameplay.png", fullPage: true });
  await page.evaluate(() => window.__NIULAI_GAME__.game.debugClearGameplay());

  await spawnFeather(0, 2.2);
  await page.waitForFunction(() => window.__NIULAI_GAME__.getState().feathers === 1);
  let snapshot = await state();
  assert.equal(snapshot.feathers, 1, "接触云羽后计数应增加");
  assert.ok(snapshot.score >= 100, "云羽应增加印记分数");

  await spawnObstacle(0, "stone", 2.2);
  await page.waitForFunction(() => window.__NIULAI_GAME__.getState().health === 2);
  snapshot = await state();
  assert.equal(snapshot.health, 2, "撞击山石应损失一点勇气");

  await page.waitForFunction(() => {
    const current = window.__NIULAI_GAME__.getState();
    return !current.dash.active && current.invulnerability === 0;
  });
  await spawnObstacle(0, "log", 5);
  await page.keyboard.press("Space");
  await page.waitForFunction(() => window.__NIULAI_GAME__.getState().objects.obstacles === 0);
  snapshot = await state();
  assert.equal(snapshot.health, 2, "正确跳跃应越过朽木而不受伤");

  await page.waitForFunction(() => window.__NIULAI_GAME__.getState().airborne === false);
  await page.keyboard.down("Shift");
  await page.keyboard.up("Shift");
  await spawnObstacle(0, "shadow", 2.6);
  await page.waitForFunction(() => window.__NIULAI_GAME__.getState().objects.obstacles === 0);
  snapshot = await state();
  assert.equal(snapshot.health, 2, "踏风应击碎暗影而不受伤");
  assert.ok(snapshot.dash.cooldown > 0, "踏风应进入冷却");

  await page.waitForFunction(() => {
    const current = window.__NIULAI_GAME__.getState();
    return !current.dash.active && current.invulnerability === 0;
  });
  await spawnObstacle(0, "stone", 2.2);
  await page.waitForFunction(() => window.__NIULAI_GAME__.getState().health === 1);
  await page.waitForFunction(() => window.__NIULAI_GAME__.getState().invulnerability === 0);
  await spawnObstacle(0, "shadow", 2.2);
  await page.waitForFunction(() => window.__NIULAI_GAME__.getState().state === "gameover");
  snapshot = await state();
  assert.equal(snapshot.health, 0);
  assert.equal(await page.locator("#result-screen").isVisible(), true, "勇气耗尽后应显示结算层");
  await page.screenshot({ path: "artifacts/module-3-result.png", fullPage: true });

  assert.deepEqual(errors, [], `发现浏览器错误：${errors.join(" | ")}`);
  assert.deepEqual(failedRequests, [], `发现请求失败：${failedRequests.join(" | ")}`);
  console.log(JSON.stringify({ module: "gameplay", status: "passed", snapshot }, null, 2));
} catch (error) {
  await page.screenshot({ path: "artifacts/module-3-failure.png", fullPage: true }).catch(() => {});
  console.error(JSON.stringify({ module: "gameplay", status: "failed", error: error.message, errors, failedRequests, snapshot: await state().catch(() => null) }, null, 2));
  throw error;
} finally {
  await browser.close();
}
