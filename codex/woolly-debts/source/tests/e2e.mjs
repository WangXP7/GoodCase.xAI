import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const cwd = resolve(import.meta.dirname, "..");
const output = resolve(cwd, "test-output");
mkdirSync(output, { recursive: true });

const edgeCandidates = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
];
const executablePath = edgeCandidates.find(existsSync);
if (!executablePath) throw new Error("Microsoft Edge executable not found");

const viteBin = resolve(cwd, "node_modules", "vite", "bin", "vite.js");
const port = 4174;
const server = spawn(process.execPath, [viteBin, "--host", "127.0.0.1", "--port", `${port}`, "--strictPort"], {
  cwd,
  stdio: "ignore",
  windowsHide: true
});

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function waitForServer(url) {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error("Vite server did not start within 15 seconds");
}

let browser;
try {
  const url = `http://127.0.0.1:${port}/`;
  await waitForServer(url);
  browser = await chromium.launch({ executablePath, headless: true, args: ["--use-angle=swiftshader", "--disable-gpu-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });

  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__woollyGame));
  await page.screenshot({ path: resolve(output, "v1.1.0-01-tutorial.png") });
  await page.getByTestId("start-game").click();
  await page.waitForTimeout(250);

  const initial = await page.evaluate(() => ({ snapshot: window.__woollyGame.snapshot(), sheep: window.__woollyGame.sheepCount(), point: window.__woollyGame.firstSheepPoint() }));
  assert(initial.sheep >= 5, `expected at least 5 sheep, got ${initial.sheep}`);
  assert(initial.point, "first sheep screen point missing");
  await page.mouse.move(initial.point.x, initial.point.y);
  await page.waitForTimeout(1350);
  const afterHover = await page.evaluate(() => ({ snapshot: window.__woollyGame.snapshot(), head: window.__woollyGame.firstSheepHeadPoint(), bar: window.__woollyGame.firstSheepBarPoint() }));
  assert(afterHover.snapshot.stamina < initial.snapshot.stamina, "hover auto-attack did not consume stamina");
  assert(afterHover.bar, "health bar screen point missing");
  assert(afterHover.head, "sheep head screen point missing");
  assert(afterHover.bar.y < afterHover.head.y - 18, `health bar is not above the sheep head: ${JSON.stringify({ head: afterHover.head, bar: afterHover.bar })}`);
  assert(Math.abs(afterHover.bar.x - afterHover.head.x) < 8, `health bar is not horizontally anchored to the sheep head: ${JSON.stringify({ head: afterHover.head, bar: afterHover.bar })}`);
  await page.screenshot({ path: resolve(output, "v1.1.0-02-healthbar.png") });

  await page.evaluate(() => window.__woollyGame.grantResources(12000, 20, 60));
  await page.getByTestId("bill-button").click();
  await page.getByTestId("pay-bill").click();
  assert((await page.locator(".perk-card").count()) === 3, "bill payment did not offer three perks");
  await page.getByTestId("perk-0").click();
  const paid = await page.evaluate(() => window.__woollyGame.snapshot());
  assert(paid.billsPaid === 1 && paid.currentBill.amount === 160, "bill progression mismatch");

  await page.getByRole("button", { name: /锤铺/ }).click();
  await page.locator('[data-hammer="toy"]').click();
  const equipped = await page.evaluate(() => window.__woollyGame.snapshot().currentHammer);
  assert(equipped === "toy", "shop did not equip purchased hammer");
  await page.locator("#modal-close").click();

  await page.getByRole("button", { name: /技能树/ }).click();
  await page.locator('[data-skill="pow1"]').click();
  const learned = await page.evaluate(() => window.__woollyGame.snapshot().skills.includes("pow1"));
  assert(learned, "skill purchase did not persist");
  await page.locator("#modal-close").click();

  await page.getByRole("button", { name: /猜肥羊/ }).click();
  await page.locator('[data-shuffle-choice="0"]').click();
  await page.waitForTimeout(1100);
  assert((await page.locator(".shuffle-sheep.winner").count()) === 1, "shuffle did not reveal a winner");
  await page.screenshot({ path: resolve(output, "v1.1.0-03-shuffle.png") });
  await page.locator("#modal-close").click();

  await page.evaluate(() => window.__woollyGame.forceStamina(0));
  await page.getByRole("button", { name: "结算并进入下一天" }).click();
  await page.waitForTimeout(150);
  const nextDay = await page.evaluate(() => window.__woollyGame.snapshot());
  assert(nextDay.day === 2 && nextDay.stamina > 0, "day settlement did not refill stamina");
  assert(nextDay.runCash === 0 && nextDay.runStats.swings === 0, "new run did not reset run-only counters");
  await page.screenshot({ path: resolve(output, "v1.1.0-04-gameplay.png") });

  assert(pageErrors.length === 0, `browser errors: ${pageErrors.join(" | ")}`);
  console.log(JSON.stringify({ ok: true, sheep: initial.sheep, hoverAttack: true, healthBarAnchored: true, billPaid: true, hammer: equipped, skill: learned, nextDay: nextDay.day, screenshots: 4 }, null, 2));
} finally {
  await browser?.close();
  server.kill();
}
