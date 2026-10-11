# 用例集 · P3「失败后 3 秒内可重来」硬指标

> 判据来源：概念 §6.2 / §4.3、S6 A6-7（≤3.00s）、S6 A6-8（0→1.70s 按 R 无效）、S8 A8-1（失败/成功/中止三路径 ≤3.00s）。
> 自动化脚本：`tests/qa/independent-verify.mjs`（V2）、`tests/prototype/verify-prototype.mjs`（A6-7）。

## 用例

| ID | 前置 | 步骤 | 预期 | 自动化 | 状态 |
|---|---|---|---|---|---|
| TC-P3-01 | 任意失败态 | 以 **1/60s 真实渲染帧**推进，记录 `canRestart` 首次为 true 的时刻 | ≤ 3.00s | independent V2-b：**1.72s（第 103 帧）** | **PASS** |
| TC-P3-02 | 失败后 0→1.70s | 每帧检查 `canRestart` | **恒为 false**（演出锁定，R 无效） | independent V2-c | **PASS** |
| TC-P3-03 | 失败态 | 用不同 `frameDt`（巨帧 / 正常帧）复测门限 | 门限不随帧率漂移 | independent V2（1.72s）；门限为**仿真时间累加**，与真实帧率无关 | **PASS** |
| TC-P3-04 | 失败态、已解锁 | `sim.reset()` / R 键 | 回 `IDLE`：`t=0`、`Ω=0`、`outcome=null`、燃料满 | independent V2-e | **PASS** |
| TC-P3-05 | 失败→重开 | 第二局与第一局同输入 | 末状态**逐位一致** | independent V2-f（rx/ry/vx/vy/m/t 全等） | **PASS** |
| TC-P3-06 | 连续重开 20 次 | 每次检查 T+0 读数 | Ω=0、q=0、fuel=18900/4500、h=0 | verify-prototype A7-8（仅 Ω=0 被断言，其余 GAP） | **部分 PASS / GAP** |
| TC-P3-07 | **成功**结算后 | 按 R | 可重开（无需等 3s） | 代码 `world.js:245`；GAP | **GAP** |
| TC-P3-08 | **中止**后 | 按 R | ≤3.00s 可重开 | **无法验证**（中止在飞行段失效，见 `verb-normal-paths.md` TC-V5-01） | **BLOCKED** |
| TC-P3-09 | 成功计数 | 完成 2 次成功入轨后查看 `stats.successes` | 应为 2；`skippable` 需 ≥3 才 true | 代码 `game-state.js:29-37` 双计，见下 | **❌ FAIL（P3）** |

## 现状评估

### ✅ 硬指标成立，但既有断言是「写松」的

`verify-prototype.mjs` 中：

```js
ok('失败后 ≤3.0s 可重开', rt !== null && rt <= 3.0, ...);   // 真实断言，实测 1.71s ✅
ok('演出期间不可跳过 (<1.7s 锁定)', true, '由 canRestart 门控');  // ← 硬编码 true，无效断言
```

第 2 条**无论如何都会通过**，等于没有测试「演出不可跳过」（S6 A6-8）。本次已用 `independent-verify.mjs` V2-c 补齐：**独立确认 0→1.72s 期间 `canRestart` 恒 false**。

### ⚠️ 门限 1.70s 无单一真值源

`1.70` 同时硬编码在 `src/core/simulation.js:289`（门控）与 `src/render/hud.js:374`（面板显示）。两处任改其一会使「门控」与「面板」失同步——且 P3 红线（3s）本身未进 `constants.js`。建议抽 `CONTROL.RESTART_GATE = 1.70` 与 `CONTROL.RESTART_MAX = 3.0`。

### ❌ TC-P3-09 成功计数重复累加（P3 轻微，非阻断）

`Game.recordOutcome()` 在 **同一次成功**里被调用两次：

1. 帧内首次 `outcome!==null` 时（`world.js:255-258`）→ `successes++`
2. 玩家按 R 重开时（`world.js:238/248`）又调一次 → 再次 `successes++`

⇒ 完成 2 次成功即满足 `successes>=3` 的跳过倒计时条件（S8 A8-12）提前一局。失败路径不增计数，故仅影响成功侧。建议改用 `_outcomeRecorded` 守卫第二次调用。
