# 控制清单 · Control Manifest（程序员一页规则）

> 一句话：**core 是纯 JS 的确定性物理核，render 只是它的只读镜子。** 违反此条即破坏闭环验证。
> 配套：ARCH-1 · ADR-001..004 · RT-1

---

## 1. 边界（越界即否决 PR）

| 规则 | ✅ 允许 | ❌ 禁止 |
|---|---|---|
| B1 | `src/core/**` 只 import 其它 core | core import `phaser` / `../render/**` / DOM API |
| B2 | render 读 `sim.hudModel()` 只读快照 | render 直接写 `sim.fm.*` / `sim.outcome` 等物理字段 |
| B3 | 输入经 `sim.setInput({...})` 单向下行 | core 主动读键盘 / 回调 render |
| B4 | 单位一律 **SI**（m·kg·s·rad） | 在 core 里出现"度"；HUD 层才转度 |

## 2. 确定性（弹道必须逐位可复现）

- **D1** 物理锁 **120 Hz**（`CONTROL.DT = 1/120`），累加器驱动，**绝不**用 rAF delta 直接步进。
- **D2** 单帧最多追 `MAX_STEPS=5` 步，多余时间丢弃（防死亡螺旋）。
- **D3** 顿帧期间**不向累加器喂时间**。
- **D4** core 内**禁止**：`Math.random()`、`Date.now()`、`performance.now()`、依赖 `window`。需要一个"随机"就用确定性哈希/常量。
- **D5** 保留 `renderAlpha = acc/DT`，渲染插值用它，不要自己在 render 里重算时间。

## 3. 热路径零分配（120 Hz × N 系统）

- **Z1** 复用输出对象（`orbit.out`、`fm` 状态原地更新），**不要**每步 `return {...}` 新对象。
- **Z2** `hudModel()` 复用同一缓冲对象，每帧原地填值；render 只读、不缓存引用跨越帧去比较。
- **Z3** 每步循环内**禁止** `new`、数组字面量拼接、闭包分配。

## 4. 唯一真值源

- **S1** 所有标定量只在 `src/core/constants.js`（`Object.freeze`）。**任何** magic number 提及 RT-1 的，抽到 constants。禁止在别处硬编码 300000 / 8.0 / 7.2e11 / 15000 等。
- **S2** 改 constants 必须重跑：`open-loop-port-check` → `run-closed-loop` → `verify-prototype`。任一红即回滚。
- **S3** 派生量（推力 T1/T2、Δv、TWR）用 getter 现算，不落库。

## 5. 每步系统调用顺序（不可调换）

```
① S1 flightModel.step   （内部同帧算阻力 + q）
② S4 atmosphere.update(q, h)
③ S3 staging.update(dt, stage, fm, q)     ← 需本步 q 判"安全分离"
④ S5 orbit.solve(rx,ry,vx,vy)
⑤ S7 omega.update
⑥ S5 judge.update
⑦ S6 failure.detect
```
> 与 GDD 名义顺序的唯一差异：**S4 提到 S3 之前**。理由：S3 的安全分离判据与 S1 的阻力都需**同帧 q**。已由 `open-loop-port-check` 证明与 RT-1 逐位一致，属实现澄清。

## 6. 渲染层

- **R1** 静态几何**画一次**（`_buildStatic`）；每帧只更新 1 个动态 `Graphics` + 动态文本。
- **R2** HUD 恒 `zoom=1`，不参与世界 zoom rails；用独立 `HudScene`。
- **R3** 1920×1080 基准 + `Scale.FIT`；坐标写死基准像素，不要读 `window.innerWidth` 去摆布局。
- **R4** 颜色只从 `palette.js` 取（美术圣经 HEX），不散落字面量。
- **R5** 模态 A 的"不撒谎五防线"：**无 km、含 EST 角标、填充用 A2 非绿、成功标记空心灰、过冲是位移非缩放**。

## 7. Ω（生命线，改动需主理人复核）

- **O1** `Ω₀ ← max(Ω₀, Ω₀_prev)` 单调闩锁——**回退量必须为 0**（实测断言在 `verify-prototype`）。
- **O2** 切换判据 `h_p <= h_eq → 模态 A`，否则 B；切换视觉连续，**不得跳变**（实测 `switchJumpPct ≪ 1%`）。
- **O3** 上升段前 87% 真实近地点恒 −300 km 是**物理本质**，不许"修"它——这正是 Ω 存在的理由。

## 8. 提交前自检（跑完贴证据）

```
node tests/prototype/open-loop-port-check.mjs   # 端口一致性（应逐位对齐 RT-1）
node tests/prototype/run-closed-loop.mjs        # 闭环 R4（基准画像应 ≈81s/15km）
node tests/prototype/verify-prototype.mjs       # 验收清单 41/41
node tests/prototype/browser-smoke.mjs          # 浏览器 8/8 + 0 控制台报错
```
四项全绿才可提交。**不要为"做完"而改断言/写假数据。**
