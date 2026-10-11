# E5 · 首屏包体治理

> **优先级**：P2（**ADR-002 的触发条件**：包体成为发布阻塞；当前已裁决 raw 非阻塞，见 `MVP-audit.md` §6）
> **上游**：`ADR-002-render-layer.md`、美术圣经 §9「首屏包 ≤ 1.2 MB」、`docs/architecture/MVP-audit.md` §6
> **审计条目**：包体裁决 §6（U-包体）
> **当前状态**：wire（brotli 274.5 KB / gzip 341.9 KB）**已通过**；raw 1.233 MB 为非阻塞观测。本 Epic 目标是**真实的体积收益**（解析成本 + 首屏体验），非合规救火。

---

## 背景（来自 MVP-audit §6，已核实）

本项目对 Phaser 的全部用点（源码 grep 实证）：
`Phaser.{Game, Scene, Scale.FIT/CENTER_BOTH, Math.Clamp, Input.Keyboard.JustDown}` + 场景内 `add.{graphics,text,rectangle,container,tweens}` / `cameras.main.shake` / `input.keyboard.addKeys`。
**完全未用**：Physics(Arcade/Matter)、Particles、Sound/WebAudio、Tilemaps、DOM Elements、Loaders、Animation/SpriteSheet、Spine、BitmapText/Video/NineSlice/Group。
→ 全量 `phaser.min.js` 1,181,917 B 中**绝大多数是死代码**。

---

## ST-5.1 · Phaser 自定义构建（核心收益）

- **验收标准**：
  1. 用 Phaser 源码 + rollup 构建**仅含已用子系统**的自定义包，产出 `src/vendor/phaser.custom.min.js`（或同义路径）。
  2. 构建配置**显式列举**保留模块（上述用点）并在仓库内留配置文件（可复现）。
  3. 替换 `src/index.html` 的 `<script src>`；`browser-smoke` 8/8 + 0 报错**必须仍通过**。
  4. **体积目标**：raw ≤ 800 KB（预计 ~600–750 KB）；brotli ≤ 200 KB。若达不到，在 PR 中记录实测与差距。
  5. 保留 `Phaser` 全局名（`window.Phaser`）与 `Phaser.AUTO` 行为不变。
- **涉及文件**：新增 `build/phaser-custom.config.js`（或 `rollup.config.mjs`）、`src/vendor/phaser.custom.min.js`、改 `src/index.html`
- **依赖**：需 **npm + 网络**（当前离线环境不可执行——**标记为需环境解锁**）
- **复杂度**：L
- **测试证据路径**：`measure-budget.mjs` 前后对比；`browser-smoke.mjs` 8/8

## ST-5.2 · 压缩传输管线（预生成 .br/.gz + 服务器协商说明）

- **验收标准**：
  1. 提供构建后处理脚本，为 `src/**` 的 `.js/.html` 预生成 `.br` 与 `.gz`。
  2. `production/` 下给出静态服务器的 `Content-Encoding` 协商说明（TapTap 网页版托管侧的配置要求）。
  3. 说明为何**不选** CDN 分离（不改变总传输、破坏离线/无头前提——见 `MVP-audit.md` §6.3）。
- **涉及文件**：新增 `build/precompress.mjs`、`production/deploy-notes.md`
- **依赖**：无
- **复杂度**：S
- **测试证据路径**：`measure-budget.mjs` wire 口径复核

## ST-5.3 · 包体预算门禁（CI 化）

- **验收标准**：
  1. 把 `tests/prototype/measure-budget.mjs`（已改为 **wire 阻塞 + raw 观测**）接入 CI / pre-release 检查，**exit code 由 wire 决定**。
  2. 定义回归阈值：wire 增长 > 5% 时告警。
  3. 报告落盘（沿用 `_budget.txt`）。
- **涉及文件**：`tests/prototype/measure-budget.mjs`（已更新）、CI 配置（若引入）
- **依赖**：无
- **复杂度**：S
- **测试证据路径**：`measure-budget.mjs` 输出（当前 `①brotli ✅4.5× · ②gzip ✅3.6× · ③raw soft ✅`）

---

## E5 完成判据

- `phaser.custom.min.js` 就位且 `browser-smoke` 8/8；raw 与 brotli 均较当前下降，实测值记录在案。
- `measure-budget.mjs` 以 wire 为准返回 0。
