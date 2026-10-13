import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("https://game.example/", {
      headers: { accept: "text/html", host: "game.example" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the complete 2066 game shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>2066 决战世界杯｜5v5 足球对战<\/title>/);
  assert.match(html, /决战，从这一脚开始/);
  assert.match(html, /中国 2066/);
  assert.match(html, /世界明星队/);
  assert.match(html, /引擎同步中|进入比赛/);
  assert.match(html, /世界榜/);
  assert.match(html, /本地游客/);
  assert.match(html, /https:\/\/game\.example\/og\.png/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("ships the Three.js, Ammo.js, and PixiJS match engine", async () => {
  const [page, arena, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/game/ThreeArena.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /import[\s\S]*ThreeArena[\s\S]*from\s+["']\.\/game\/ThreeArena["']/);
  assert.match(page, /<ThreeArena\b/);
  assert.match(arena, /from\s+["']three["']/);
  assert.match(arena, /from\s+["']ammojs-typed\/ammo\/ammo\.js\?url["']/);
  assert.doesNotMatch(arena, /import\(["']ammojs-typed/);
  assert.match(arena, /function\s+loadAmmo\s*\(/);
  assert.match(arena, /\.Ammo\.call\(window\)/);
  assert.match(arena, /data-ammo-2066/);
  assert.match(arena, /import\(["']pixi\.js["']\)/);
  assert.match(arena, /WebGLRenderer/);
  assert.match(arena, /btDiscreteDynamicsWorld/);
  assert.match(arena, /stepSimulation/);
  assert.match(arena, /requestAnimationFrame/);
  assert.match(arena, /1\s*\/\s*60|FIXED_(?:TIME_)?STEP/);
  assert.match(packageJson, /"three"\s*:/);
  assert.match(packageJson, /"ammojs-typed"\s*:/);
  assert.match(packageJson, /"pixi\.js"\s*:/);
  const viteConfig = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8");
  assert.match(viteConfig, /include:\s*\[[^\]]*"pixi\.js"[^\]]*"eventemitter3"/);
  assert.doesNotMatch(viteConfig, /include:\s*\[[^\]]*"ammojs-typed"/);

  const assetDirectory = new URL("../dist/client/assets/", import.meta.url);
  const ammoAssetName = (await readdir(assetDirectory)).find((name) => /^ammo-.*\.js$/.test(name));
  assert.ok(ammoAssetName, "build emits the Ammo.js browser asset");
  const ammoAsset = await readFile(new URL(ammoAssetName, assetDirectory), "utf8");
  assert.match(ammoAsset, /var\s+Ammo\s*=/);
  assert.match(ammoAsset, /this\.Ammo=/);
  assert.doesNotMatch(ammoAsset, /export\s+default|rolldown-runtime/);
});

test("keeps the requested match, AI, profile, and responsive systems", async () => {
  const [page, arena, css, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/game/ThreeArena.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /statsRef\.current\.homePossession/);
  assert.match(page, /新秀[\s\S]*职业[\s\S]*传奇/);
  assert.match(page, /2-2[\s\S]*1-2-1[\s\S]*3-1/);
  assert.match(page, /localStorage\.setItem\("wc2066-records"/);
  assert.match(page, /localStorage\.setItem\("wc2066-user"/);
  assert.match(page, /leaderboardBase/);
  assert.match(arena, /2066 决战世界杯 3D 五人制球场/);
  assert.match(arena, /onGoal|scoreGoal/);
  assert.match(arena, /homePossession/);
  assert.match(arena, /difficulty/);
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(layout, /openGraph/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
