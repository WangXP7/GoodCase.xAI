# E7 · GDD / 标定对齐

> **优先级**：P2（文档-实现一致性 + 手感标定）
> **上游**：`RT-1-recalibration.md` §7（残余风险 R2/R3/R5）、`S1` §9、`S2` §9、`S4` §9
> **审计条目**：W4, W5, W7（已并入 E4/ST-4.5）, W12
> **注意**：本 Epic 涉及 `K_AERO`（W12）**必须先完成 E6**（magic number 收敛），否则调参会被硬编码击穿。

---

## ST-7.1 · 口径裁决与文档同步（S2 时钟 / 相位命名）

- **关联**：S2 §6.1 / §2.1、control-manifest D4（W4, W5）
- **验收标准**：
  1. **S2 时钟口径**：S2 §6.1 建议 `performance.now()`，但 D4 禁 core 使用。当前实现用 `elapsed += dt` 累加。**写一份 ADR-006（或 RT 补注）记录裁决**：core 内一律用固定步累加，`performance.now()` 只允许出现在 `src/render` 输入层。同步修订 S2 §6.1 措辞。
  2. **相位命名**：S2 §2.1 枚举与实现（`CHARGING` 新增、`IGNITION` 折叠为子阶段）不一致。修订 S2 GDD §2.1 枚举，或在 `launch-sequence.js` 头部澄清块与 GDD 双向引用。
  3. `RT-1` §5 表头"Δv 余量"→"**Δv 损失**"（S5 §9-C5 已指出同名不同义，会在实现阶段误读）。
  4. 概念 §5.2 时长表述按 S5 §9-C2 改为 **78 / 81 / 90 s**。
- **涉及文件**：`docs/architecture/ADR/ADR-006-*.md`（新增）、`design/gdd/S2-launch-sequence.md`（修订）、`design/gdd/S5-orbit-insertion.md`、`docs/architecture/RT-1-recalibration.md`
- **依赖**：无
- **复杂度**：S–M（主要是文档）
- **测试证据路径**：文档评审记录；代码注释双向引用检查

## ST-7.2 · `K_AERO` 标定（RT-1 R5）

- **关联**：RT-1 §7 R5、S1 §9-C7（W12）
- **验收标准**（按 S1 §9-C7 的方法执行）：
  1. 固定 `theta_cmd` 阶跃（90°→45°），在 `h=2km`（q≈16kPa）测 `theta` 收敛时间 `t_63`。
  2. 目标手感：`t_63 ∈ [0.25, 0.40] s`。
  3. 由 `1/t_63 ≈ 1/TAU_PITCH + K_AERO·q` 反解 `K_AERO`。
  4. 在 `q=0`（真空）复测，`t_63` 回到 `0.30s ± 10%`。
  5. 新值写回 `constants.CONTROL.K_AERO`（**具名常量**，保持），并**重跑四项验证**（基准弹道不受影响：全程 `|α|<0.05rad`，力矩项≈0）。
  6. **手笨玩家画像回归**：闭环 profile D（死区 2.5°/12Hz）仍入轨；记录 `maxAlphaDeg` 变化。
- **涉及文件**：`src/core/constants.js`、新增 `tests/c1/k-aero-calib.mjs`
- **依赖**：**E6/ST-6.2**（先收敛常量）
- **复杂度**：M
- **测试证据路径**：`tests/c1/k-aero-calib.mjs` 输出 + `run-closed-loop.mjs` 9/9 不退化

## ST-7.3 · Max-Q 定位的文档同步（RT-1 R3）

- **关联**：RT-1 §7 R3、S4 §9-C4（W11）
- **验收标准**：
  1. 概念 §3.2-2「Max-Q 的窒息时刻」文案改为 S4 §5.2 方案 A 的"早期小坎"定位。
  2. 概念 §5.2 阶段表按实测重排：垂直上升 0→T+4.7s / 重力转弯 T+4.7→T+60 / 分离 T+60 / 上级收敛 T+60→T+81（对齐 S1 §9-C3）。
  3. 中段情绪峰值明确归给**大气顶事件（T+47.6s）**与**近地点爬升（T+61.7→T+81）**。
- **涉及文件**：`design/concept/rocket-launch-concept.md`
- **依赖**：无
- **复杂度**：S
- **测试证据路径**：文档评审

---

## E7 完成判据

- 五份文档（S2/S5/RT-1/概念/ADR）与实现口径一致；新增 ADR-005/006 落盘。
- `K_AERO` 标定完成且基准弹道逐位不变、手笨画像不退化。
- 四项验证全绿。
