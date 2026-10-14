import { spawn } from "node:child_process";

const tests = [
  "tests/module1-core.mjs",
  "tests/module2-controls.mjs",
  "tests/module3-gameplay.mjs",
  "tests/module4-progression.mjs",
  "tests/module5-responsive-audio.mjs"
];

for (const test of tests) {
  console.log(`\n## ${test}\n`);
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [test], { stdio: "inherit", env: process.env });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) process.exit(exitCode);
}

console.log("\n# Playwright 回归测试\n\n- 状态：全部通过\n");
