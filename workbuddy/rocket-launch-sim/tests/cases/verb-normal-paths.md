# 用例集 · 5 个动词的正常路径

> 动词定义见概念 §4.1；键位映射见 `src/render/world.js:264`。
> 自动化脚本：`tests/prototype/verify-prototype.mjs`、`tests/prototype/run-closed-loop.mjs`、`tests/qa/independent-verify.mjs`、`tests/qa/probe-abort.mjs`。

## V1 点火 Ignite（Space 按住）

| ID | 前置 | 步骤 | 预期 | 自动化 | 状态 |
|---|---|---|---|---|---|
| TC-V1-01 | IDLE 场景 | 按住 Space | 进入 `CHARGING`，充能条 0→0.6s | browser-smoke「进入倒计时/充能」 | **PASS** |
| TC-V1-02 | CHARGING | 持续按住 | 0.6s 后 `COUNTDOWN`，`elapsed` 从 0 起算，10.0s | verify-prototype A2-5/6 | **PASS** |
| TC-V1-03 | CHARGING | 松手 | 回落 `IDLE`（点数=永不发出）| seq.update `CHARGING_ABORT`；GAP（无断言） | **GAP** |
| TC-V1-04 | COUNTDOWN（预冷/增压子阶段） | 松手 | 回 `IDLE`，**不计失败** | verify-prototype A2-8 | **PASS** |
| TC-V1-05 | COUNTDOWN（IGNITE 子阶段 T-1.6→T-0） | 松手 | **不中止**，继续到 T-0（设计如此） | 代码审查 `launch-sequence.js:103` | **GAP** |
| TC-V1-06 | T-0 就绪 | 通过 | `RELEASE` 0.4s → `FLIGHT`，`t=0` | verify-prototype A2-5/6（10.40s） | **PASS** |
| TC-V1-07 | 序列未就绪 | 到 T-0 时预冷/增压/爬推未满 | 挂起 ≤3.0s → `SEQUENCE_FAULT` | code path 存在；无断言 | **GAP** |
| TC-V1-08 | COUNTDOWN（skippable） | 按住 Space | 倒计时压到 3.0s，三子阶段按比例压 | GAP（无断言，闭环节未覆盖跳过分支） | **GAP** |

## V2 节流 Throttle（W/S）

| ID | 前置 | 步骤 | 预期 | 自动化 | 状态 |
|---|---|---|---|---|---|
| TC-V2-01 | FLIGHT | 按 W | `throttle` 升，上限 1.00 | 代码 clamp `flight-model.js:83` | **GAP** |
| TC-V2-02 | FLIGHT | 按 S | `throttle` 降，下限 0.30（防熄火） | 代码 clamp `flight-model.js:84`；GAP | **GAP** |
| TC-V2-03 | FLIGHT、q>11kPa、h<6km | 收油门到 0.60 | 峰值动压显著下降（≤12.5kPa，S4 A4-15） | run-closed-loop `E-throttle`：**16.5→11.3 kPa** | **PASS**（门槛 12.5 略偏宽，实测 11.3 达标） |
| TC-V2-04 | FLIGHT | 二级段收油门到底并保持 1.0s | 触发主动关机判定（S5 A5-8） | verify-prototype A5-10（T+78 → ORBITAL） | **PASS** |
| TC-V2-05 | 一级段（stage=1） | 收油门到底 | **不**触发判定（S5 A5-9） | GAP | **GAP** |
| TC-V2-06 | 二级段 | 收油门后中途回升 | `shutdownHold` 清零，不判定 | GAP | **GAP** |

## V3 配平 Pitch（A/D）

| ID | 前置 | 步骤 | 预期 | 自动化 | 状态 |
|---|---|---|---|---|---|
| TC-V3-01 | FLIGHT、t>0.5s | 按 A/D | `thetaCmd` 以 15°/s 移动，限幅 [−20°, 90°] | 代码 `flight-model.js:77` | **GAP** |
| TC-V3-02 | FLIGHT、t<0.5s | 按 A/D | **首帧防抖**：配平被忽略（S1 §4.1-4） | 代码 `simulation.js:153`；GAP | **GAP** |
| TC-V3-03 | FLIGHT | 早倾（hTurn 6km）/ 晚倾（10.5km） | **两条路都能入轨**（防主导策略） | run-closed-loop B-low / C-high；independent V6 | **PASS** |
| TC-V3-04 | FLIGHT | 手笨玩家（死区 2.5° / 12Hz） | 仍能入轨（容错） | run-closed-loop `D-sloppy` ORBITAL | **PASS** |
| TC-V3-05 | FLIGHT | 全程不倾 | 垂直硬顶 → 逃逸弹道失败 | run-closed-loop `F-novice` | **PASS**（但失败码与其自述预期不符，见下） |

> **观察（非缺陷但需记录）**：`run-closed-loop` 的 `F-novice` 自述预期为「IMPACT/INSUFFICIENT_DV」，实测为 **ESCAPE_TRAJ**。物理上成立（垂直满推 → 超逃逸速度），但**用例预期文本与实际不符**，属用例维护漂移。

## V4 分离 Stage（Shift）

| ID | 前置 | 步骤 | 预期 | 自动化 | 状态 |
|---|---|---|---|---|---|
| TC-V4-01 | FLIGHT、一级段、q≤5kPa | 按 Shift | 分离，质量恒为 **16500 kg** | verify-prototype A3-1b（T+40/50/55/60 全部 16500.0） | **PASS** |
| TC-V4-02 | 同上 | 观察 | 0.35s 顿帧，其间物理冻结、残骸继续运动 | 代码 `staging.js`；GAP | **GAP** |
| TC-V4-03 | 一级燃尽后 | 按 Shift | 正常二级点火，`stage=2` | 闭环节全流程 | **PASS** |
| TC-V4-04 | 提前分离（T+40/50/55） | 按 Shift | `dvWasted ≈ {689,365,188}`，Δv 余量不虚高 ≤2635 | verify-prototype A3-1b/3 | **PASS** |
| TC-V4-05 | 高动压分离（T+14，q≈16.5kPa） | 按 Shift | `SEP_HIGHQ` 失败（级间碰撞） | independent V4（T+14.0s） | **PASS** |
| TC-V4-06 | `ARMED_1` | 连按 Shift | 200ms 去抖，只分离一次 | 代码 `SEP_DEBOUNCE`；GAP | **GAP** |

## V5 中止 Abort（Esc）

| ID | 前置 | 步骤 | 预期 | 自动化 | 状态 |
|---|---|---|---|---|---|
| TC-V5-01 | **FLIGHT** | 按 Esc | 进入 `ABORTED`，逃逸塔点火，失败码 `ABORT` | `tests/qa/probe-abort.mjs` | **❌ FAIL（P0）** |
| TC-V5-02 | RELEASE | 按 Esc | `ABORTED` | probe-abort | **PASS** |
| TC-V5-03 | COUNTDOWN | 按 Esc | 回 `IDLE`，不计失败 | probe-abort / independent V8-c | **PASS** |
| TC-V5-04 | FLIGHT | 按 Esc 后观察 5s | 应进 `ABORTED` | probe-abort ④ | **❌ FAIL：从未进入** |

### ❌ TC-V5-01 / TC-V5-04 缺陷记录（P0 阻断）

- **现象**：`FLIGHT` 阶段按 Esc，`phase` 恒为 `FLIGHT`、`outcome=null`、`sim._abortPulse` 残留 `true` 从未被消费；持续推进 5s 也永不进入 `ABORTED`。
- **根因**：`src/core/simulation.js:102-121` 中 `seq.update()` 仅在 `phase !== FLIGHT/FAILED/ABORTED && !failure.failed` 时调用。一旦进入 `FLIGHT`，该分支被整体跳过，而 abort 的处理逻辑位于 `launch-sequence.js:139-152`（`seq.update` 内部）⇒ **飞行段的 Esc 永远不会被处理**。
- **影响**：5 个 MVP 动词之一在其**唯一主要使用窗口**内失效；HUD 在飞行段会把 `ABORT [ESC]` 高亮（`hud.js:315 canAbort`），即**界面在撒谎**（违反 P2 精神）。直接违反验收 A7-12「5 动词齐备」、A8-15「LAUNCH 下 Esc = ABORT」、A6-14 与 A8-1（中止路径的 3s 重开无法验证）。
- **证据**：`tests/qa/evidence/probe-abort.txt`
- **复现**：`node tests/qa/probe-abort.mjs`
- **建议**：把 abort 边沿检测提到 `Simulation.update()` 顶层（不依赖 `seq.update` 是否被调用），或在 `FLIGHT` 分支内显式消费 `_abortPulse` 并转 `ABORTED`。/ 交 engineering-lead 修复，QA 补回归用例 TC-V5-01。
