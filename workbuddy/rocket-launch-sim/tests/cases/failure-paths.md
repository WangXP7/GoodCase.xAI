# 用例集 · 失败路径（解体 / 坠海 / 中止逃逸）

> 依据：概念 §6.1 ⑤A 失败演出、S6 §3.1 优先级、S6 A6-1「全部 9 码可触发」、S6 A6-14「ABORT 不计失败」。
> 自动化脚本：`tests/qa/independent-verify.mjs`（V4 可达性普查）、`tests/qa/failure-attribution-check.mjs`。

## 失败码可达性普查（A6-1）

| 失败码 | 期望语义 | 构造路径 | 实测 | 状态 |
|---|---|---|---|---|
| `DESTRUCT_AERO` | 气动解体（q>30kPa） | 早倾俯冲（hTurn≈500m） | T+21.7s 触发 | **PASS** |
| `DESTRUCT_ALPHA` | 箭体折断（大攻角 + 高 q） | 任意 | **永不可达**（见下） | **❌ FAIL** |
| `TUMBLE` | 姿态失控（\|α\|>60° 持续 1s） | 高抛陡倾（hTurn≈6km / p≈0.2） | T+32.8s 触发 | **PASS** |
| `SEP_HIGHQ` | 级间碰撞（q>5kPa 时分离） | T+14（Max-Q 区）按 Shift | T+14.0s 触发 | **PASS** |
| `IMPACT` | 撞地 / 坠海 | 亚轨道回落 | **未观测到可达** | **⚠️ GAP** |
| `INSUFFICIENT_DV` | 入轨失败（近地点不达标） | 晚倾（hTurn≈40km） | T+81.0s 触发 | **PASS** |
| `ESCAPE_TRAJ` | 逃逸弹道（v>逃逸速度） | 不倾 + 自动分离 | T+81.0s 触发 | **PASS** |
| `SEQUENCE_FAULT` | 序列挂起 >3s | 需 T-0 就绪判据失败 | **未观测到可达** | **⚠️ GAP** |
| `ABORT` | 主动中止 | 飞行段按 Esc | **永不可达**（Esc 被吞，见 `verb-normal-paths.md` TC-V5-01） | **❌ FAIL（P0）** |

**普查结论：可达 5 / 9 ⇒ S6 A6-1「全部 9 个失败码可被触发」不成立。**

## ❌ TC-FAIL-01：DESTRUCT_ALPHA 死代码（P1 → 归因降级）

`src/core/failure.js:56-87` 的检测顺序：

```js
if (atmo.q > F.Q_STRUCT) return this._build(DESTRUCT_AERO, ...);         // ①
if (Math.abs(fm.alpha) > F.ALPHA_STRUCT && atmo.q > F.Q_STRUCT) return ...DESTRUCT_ALPHA;  // ②
```

条件 ② 同时要求 `q > Q_STRUCT`，而 ① 已先返回 ⇒ **② 永久不可达**。
后果：大攻角 + 高动压的"箭体折断"永远被报成"气动解体"，P2 归因精度下降，且 S6 A6-1 失败。
修复：把 ② 提到 ① 之前（带 `alpha` 条件优先判定）。

## ⚠️ TC-FAIL-02：IMPACT 被 SECO 判定遮蔽

`IMPACT`（h≤0 && t>1s）需要火箭在上/下落中触地；但一旦二级燃尽即触发 `SECO → judge`，亚轨道态会被 `detectFromJudge` 判为 `INSUFFICIENT_DV`，火箭"还没落地就先结算"。因此 IMPACT 在标称构型下难以观测。需工程确认：这是否是有意的（避免无意义坠海）还是漏判。

## ⚠️ TC-FAIL-03：SEQUENCE_FAULT 需要注入才可达

`HOLD_TIMEOUT=3.0` 的挂起分支在标称流程"永不触发"（S2 §6.3 自述为"纯防御分支"）。要覆盖它必须注入"T-0 就绪判据失败"的状态。当前无任何自动化覆盖。

## TC-FAIL-04 / 05：坠海 与 中止逃逸的演出

| ID | 场景 | 预期 | 状态 |
|---|---|---|---|
| TC-FAIL-04 | 失败面板：标题 + 主因 + 2–4 证据 + 建议 | 全部非空、无 NaN | **PASS**（HUD 渲染在浏览器冒烟中无控制台报错） |
| TC-FAIL-05 | 「减少动效」模式：震屏 ×0、闪白改静态 | 代码分支存在（`world.js:279-282`、`hud.js:313`） | **GAP**（无断言；S6 A6-16 未覆盖） |
| TC-FAIL-06 | 失败期间物理冻结、输入锁定 | `outcome==='FAILURE'` 时 `update` 直接返回 | **PASS**（代码 `simulation.js:94-99`；independent V2 间接验证） |
| TC-FAIL-07 | 光敏合规：闪白 1 帧 / 非红 / 震屏 ≤2Hz | 代码 (`_shake` 12px/0.5s) | **MANUAL**（需录制核查，S6 A6-15） |

## 缺陷汇总

| ID | 严重度 | 摘要 |
|---|---|---|
| TC-V5-01 | **P0 阻断** | 飞行段 Esc 中止无效 ⇒ 失败路径「中止」缺失，A6-14/A8-15/A8-1 不成立 |
| TC-FAIL-01 | **P1 严重** | DESTRUCT_ALPHA 死代码 ⇒ A6-1 失败、P2 归因降级 |
| TC-FAIL-02/03 | P2 一般 | IMPACT / SEQUENCE_FAULT 不可达或无覆盖 |
