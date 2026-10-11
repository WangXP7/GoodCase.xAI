# E2 · 可访问性与输入（键位 / 设置 / 失焦）

> **优先级**：P1（合规项，非玩法特性——见 S8 §9-C14 裁决建议：可访问性/安全项豁免支柱闸门）
> **上游**：`design/gdd/S8-meta.md` §3.5/§3.6、`design/gdd/S1-flight-physics.md` §4.1-3、美术圣经 §9.3/§9.4
> **审计条目**：U6, U11, U17, U18
> **约束**：R4（配色集中）；`src/core/` 不得 import DOM/`window`（输入抽象量在 core，键码映射在 render 侧）

---

## ST-2.1 · 键位重映射

- **关联**：S8 §3.5（U17）；S1 §4.1-2
- **验收标准**：
  1. 7 个动作（`launch/throttleUp/throttleDown/pitchUp/pitchDown/stage/abort/restart/pause`）可重映射，持久化到 `MetaSave.settings.keybinds`（A8-18）。
  2. 冲突检测：新键位已被占用 ⇒ 提示并拒绝（A8-16）。
  3. `Esc` **始终保留**为"打开暂停菜单"兜底，即使 `abort` 被重映射（A8-17）。
  4. `src/core` 仍只读抽象量（`input_pitch`/`input_throttle`/…），键码表只在 `src/render`（S1 §4.1-2：S1 不直接读键码）。
- **涉及文件**：新增 `src/render/keybinds.js`；改 `src/render/world.js`（用映射表取键）、`src/render/session.js`、`src/render/storage.js`
- **依赖**：E1/ST-1.2（存档）
- **复杂度**：M
- **测试证据路径**：新增 `tests/prototype/keybind-smoke.mjs`（A8-16/A8-17）

## ST-2.2 · 设置项（8 项）

- **关联**：S8 §3.6（U18）；美术 §9.3（光敏三独立开关）
- **验收标准**：
  1. 实现 `colorblind / reduceMotion / shake / flash / scanline(默认关) / textScale(100/125/150) / highContrast / showGuidance`，全部持久化（A8-18）。
  2. 色盲模式切换为 §2.7 色盲色板（橙/亮黄/天蓝/近白），且**颜色永不作为唯一通道**（图案+图标仍在）。
  3. 减少动效：震屏×0（改 1px 位移）、粒子×0.3、闪烁改静态高亮。
  4. 文本缩放用**容器自适应**（不用固定 px 高度），100/125/150% 三档不破版。
  5. 设置界面：`Esc`（非 LAUNCH）进入，直角矩形 + 1px 描边（美术 §5.3）。
- **涉及文件**：新增 `src/render/settings.js`；改 `src/render/palette.js`（加色盲色板）、`world.js`/`hud.js`/`archive.js`（消费设置）
- **依赖**：E1/ST-1.1（会话）、E1/ST-1.2（存档）
- **复杂度**：L（色盲色板 × 全 HUD 元素是主要工作量）
- **测试证据路径**：`settings-smoke.mjs`（A8-18）+ 灰度截图对比（A7-18）

## ST-2.3 · 焦点丢失输入锁定（BLUR_LOCK）

- **关联**：S1 §4.1-3（U6）
- **验收标准**：
  1. `window.blur` 时 `input_pitch`/`input_throttle` 强制归零并**锁定 `CONTROL.BLUR_LOCK`(0.2s)**。
  2. 锁定期间不接受新配平/节流输入，防"切窗回来火箭已翻"。
  3. 实际消费 `constants.js` 中已定义但**零引用**的 `CONTROL.BLUR_LOCK`（当前是死常量）。
- **涉及文件**：`src/render/world.js`（`blur`/`focus` 事件 → `sim.setInput`）、`src/core/simulation.js`（可选：锁定计数在 core，键事件在 render）
- **依赖**：无
- **复杂度**：S
- **测试证据路径**：`keybind-smoke.mjs` 内注入 blur 事件断言

---

## E2 完成判据

- A8-16/17/18 全通过；A7-20「可访问性分级 = Standard」逐项自查通过。
- 四项验证全绿（键位/设置改动不得影响物理与 HUD 数值）。
