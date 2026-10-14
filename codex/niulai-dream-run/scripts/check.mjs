import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";

const requiredFiles = [
  "index.html",
  "src/main.js",
  "src/game.js",
  "src/audio.js",
  "src/styles.css",
  "vendor/three.module.min.js",
  "vendor/three.core.min.js",
  "vendor/THREE-LICENSE.txt",
  "assets/favicon.svg",
  "scripts/serve.mjs"
];

for (const file of requiredFiles) {
  await access(file);
  assert.ok((await stat(file)).size > 0, `${file} 不应为空`);
}

const runtimeFiles = ["index.html", "src/main.js", "src/game.js", "src/audio.js", "src/styles.css"];
for (const file of runtimeFiles) {
  const source = await readFile(file, "utf8");
  assert.equal(/(?:src|href|url\()\s*=??\s*["']?https?:\/\//i.test(source), false, `${file} 不应依赖远程运行资源`);
}

const html = await readFile("index.html", "utf8");
for (const id of ["game-shell", "scene", "start-button", "hud", "result-screen", "touch-controls"]) {
  assert.ok(html.includes(`id="${id}"`), `缺少界面节点 #${id}`);
}

console.log("# 本地完整性检查\n\n- 状态：通过\n- 运行资源：全部存在\n- 外部运行依赖：0\n- Three.js：已随项目本地化\n");
