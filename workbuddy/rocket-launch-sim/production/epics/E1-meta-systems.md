# E1 · S8 元系统（会话 / 存档 / 档案室 / 解锁）

> **优先级**：**P0**（阻塞"可反复游玩"与"第 47 次发射"的跨局意义）
> **上游**：`design/gdd/S8-meta.md`（8.1–8.3 判「进 MVP」）
> **审计条目**：U10, U11, U12, U13, U14
> **约束**：R3（1920×1080 基准）、R4（配色集中）、美术 §9.4（Standard 可访问性）
> **边界**：新增文件全部在 `src/render/`（会话/存档/档案室是**渲染宿主侧**能力，**不得进 `src/core/`**，core 必须保持无 DOM/无 localStorage）

---

## 目标

把"单局循环"升级为"**跨局会话**"：玩家能看到"这是第 N 次发射"、暂停、查看历史成绩与失败分布，并让解锁在刷新后仍在。

---

## ST-1.1 · 会话状态机 + 暂停

- **关联**：S8 §2.1 / §3.1.1 / §3.1.4（U10, U11）
- **验收标准**：
  1. 实现 `SessionState ∈ {BOOT, BRIEFING, LAUNCH, DEBRIEF, ARCHIVE, SETTINGS, PAUSED}`，状态转移按 S8 §3.1.1 图。
  2. `P` 键在 `LAUNCH` 下暂停/继续：暂停时**物理冻结且累加器不累积**，恢复后火箭不瞬移（对齐 A8-14）。
  3. `Esc` 语义分离：`LAUNCH` 下 = ABORT（S6）；非 `LAUNCH` 下 = 返回/暂停菜单（A8-15）。
  4. 状态转移在 `Debug` 钩子可读（供 browser-smoke 断言）。
- **涉及文件**：新增 `src/render/session.js`；改 `src/render/world.js`（接管 update 分流）、`src/render/hud.js`（按会话态切换显示）
- **依赖**：无（E1 内部为首发）
- **复杂度**：M
- **测试证据路径**：新增 `tests/prototype/session-smoke.mjs`（暂停 10s 后恢复，`fm.t` 不跳变）；扩充 `browser-smoke.mjs`

## ST-1.2 · 存档与持久化（MetaSave v1）

- **关联**：S8 §2.2 / §6.1 / §6.2 / §6.3 / §6.6（U13 前置）
- **验收标准**：
  1. `MetaSave`（version 1）含 `missionNo/successCount/abortCount/best/failureCounts/history/unlocks/settings`，单一 key `rls_meta_v1`。
  2. `safeStorage` 包裹：`localStorage` 不可用（隐私模式/配额满）⇒ 内存态运行，**不报错、不阻塞**（A8-4）。
  3. 字段缺失/版本不符 ⇒ **逐字段 fallback**，不整份丢弃（A8-5/A8-6）。
  4. 首局 `best` 用 `b === null || |a| < |b|` 比较，避免 `undefined` 比较失败（A8-7）。
  5. `history` 环形缓冲上限 30（`HISTORY_MAX`）；`apoapsisM = Infinity` 持久化前转 `null`，显示走 `renderAs:'INFINITY'`（A8-10）。
  6. 常量 `SAVE_KEY/HISTORY_MAX/UNLOCK_*` 入 `constants.js`（或在 `src/render` 侧集中一个 `meta-config.js`，**不得散落字面量**）。
- **涉及文件**：新增 `src/render/storage.js`；`src/core/constants.js`（仅新增只读配置，不改任何物理量）
- **依赖**：无
- **复杂度**：M
- **测试证据路径**：新增 `tests/prototype/meta-store.mjs`（A8-4/5/6/7/10 全部单测）

## ST-1.3 · 发射档案室（三块）

- **关联**：S8 §3.2.1（U13）
- **验收标准**：
  1. ① 生涯概览（`第 N 次 · 入轨 X 次 · 中止 Y 次`）、② 最佳成绩（评级/精度/最短局时/最小 Δv 损失）、③ 近 30 局列表（局号/时长/评级/失败码/精度/Δv 损失）。
  2. `A` 键（在 `DEBRIEF`/非 LAUNCH）打开/关闭。
  3. **打开时 Graphics 重绘次数 = 1**（A8-11），非每帧。
  4. 数字用等宽 + `tabular-nums`；面板 `P3 α0.78` + 1px `A2` 内描边 + 四角角标（美术 §5.1.2）。
- **涉及文件**：新增 `src/render/archive.js`；改 `src/render/session.js`
- **依赖**：ST-1.1、ST-1.2
- **复杂度**：M
- **测试证据路径**：截图 `tests/prototype/shot-archive.png` + `archive-smoke.mjs`（重绘计数）

## ST-1.4 · 失败码分布图 + 三项趋势曲线

- **关联**：S8 §3.2.2 / §3.2.3（U13）
- **验收标准**：
  1. 失败码分布：横向条形图，填充 `A2`，**禁用 `A1`**（A8-19），静态绘制。
  2. 三项趋势（精度/Δv 损失/局时）用静态 polyline；`n===1` 时不除零（`x=0.5`，A8-8）；`span = (max−min)||1`（A8-9）；失败局跳过该点、折线断开。
  3. 仅在打开档案室时绘制一次（与 ST-1.3 同一约束）。
- **涉及文件**：`src/render/archive.js`
- **依赖**：ST-1.3
- **复杂度**：M
- **测试证据路径**：`archive-smoke.mjs`（A8-8/A8-9 边界注入）

## ST-1.5 · 解锁：跳过倒计时（持久化 + 一次性提示）

- **关联**：S8 §3.3 / §5.3（U14）
- **验收标准**：
  1. `skipCountdown = (successCount ≥ 3) || (missionNo ≥ 10)`，写入存档（A8-12）。
  2. 解锁瞬间在结算面板追加一行 `已解锁 UNLOCKED · 按住 SPACE 加速倒计时`，用 `A1`，**只出现一次**（存档后不再提示）。
  3. 复用现有 `Game.skippable()` 逻辑，改为读存档而非内存统计。
- **涉及文件**：`src/render/storage.js`、`src/render/game-state.js`、`src/render/hud.js`
- **依赖**：ST-1.2
- **复杂度**：S
- **测试证据路径**：`meta-store.mjs`（A8-12 行为测试）

---

## E1 完成判据

- 连续重开 20 次，每局 T+0：`Ω=0`、`q=0`、`fuel=18900/4500`、`h=0`、活跃粒子=0、残骸=0、无告警（A8-2）。
- 全部 `reset()` 在同一同步块内（A8-3）。
- 四项验证全绿。
