# ARCH-1 · MVP 架构（Phase 3 技术搭建）

> 状态：已实现并通过验证（core 41/41 · browser 8/8）
> 作者：程基岩（技术方向 / 主程序 / 引擎）
> 唯一真值源：`docs/architecture/RT-1-recalibration.md` + `design/gdd/S1..S7`
> 引擎：**Phaser 3.80.1**（本地 vendor，无后端）
> 基准分辨率：1920×1080，`Scale.FIT` 自适应

---

## 0. 一句话架构

**一份纯 JS 核心（`src/core/`）同时驱动两个宿主**：浏览器里的 Phaser 3 渲染层，与 Node 里的无头验证脚本。核心不含任何 Phaser 依赖，因而是**确定性的、可无头复现的**——这既是本原型"闭环验证"（RT-1 R4）成立的技术前提，也让"手笨玩家 / 新手 / 收油门"等操控画像能用脚本批量跑。

```
                        ┌──────────────────────────────────────────────┐
                        │            src/core/  （纯 JS，零渲染依赖）     │
                        │  constants → flight-model → orbit-solver      │
                        │  atmosphere · omega · launch-sequence         │
                        │  staging · judgement · failure                │
                        │            └──► simulation.js（编排）          │
                        └───────────────┬──────────────┬───────────────┘
                                        │              │
                        浏览器宿主 │        无头宿主 │
                    ┌───────────────────┐  ┌───────────────────┐
                    │ src/main.js       │  │ tests/prototype/  │
                    │  WorldScene       │  │  open-loop-port…  │
                    │  HudScene         │  │  run-closed-loop  │
                    │  game-state(Game) │  │  verify-prototype │
                    │  palette          │  │  browser-smoke    │
                    └───────────────────┘  └───────────────────┘
```

---

## 1. 模块划分

### 1.1 核心层 `src/core/`（纯逻辑，可无头）

| 模块 | 职责 | 对应 GDD |
|---|---|---|
| `constants.js` | **唯一真值源**。RT-1 标定值 + 派生量，全部 `Object.freeze`。改这里会击穿验收基准 | RT-1 / S1–S7 |
| `flight-model.js` | 平动 + 转动积分器（半隐式欧拉），气动力/力矩、节流、配平一阶滞后 | S1 |
| `orbit-solver.js` | 由状态矢量解偏心/半长轴/近远地点/轨道制度（ELLIPTIC/CIRCULAR/ESCAPE/DEGENERATE） | S5 |
| `atmosphere.js` | 指数大气 + 12km 硬截断 + 300m 过渡带抹平阶跃；同帧动压 q | S4 |
| `omega.js` | Ω 复合指标 + 单调闩锁 + 双模态判据 | S7 |
| `launch-sequence.js` | IDLE→CHARGING→COUNTDOWN(CHILL/PRESS/IGNITION)→RELEASE→FLIGHT | S2 |
| `staging.js` | 分离判据（含安全 q 门）、顿帧、残骸生命周期 | S3 |
| `judgement.js` | 关机 → 入轨判定 + 三档评级（近地点迟滞带） | S5 |
| `failure.js` | 失败码 + 主因模板 + 证据选取（2–4 条） | S6 |
| `simulation.js` | **编排层**：固定步长累加器 + 每步系统调用顺序 + 输出 `hudModel()` | 全部 |
| `player-model.js` | 无头"玩家模型"（参考程序追踪 + 可调死区/更新率/收油门画像） | RT-1 R4 |

### 1.2 渲染层 `src/render/`（唯一依赖 Phaser 的地方）

| 模块 | 职责 |
|---|---|
| `palette.js` | 美术圣经配色 HEX + 字体常量（`FONT_MONO`/`FONT_SANS`） |
| `game-state.js` | `Game` 单例容器：持有一份 `Simulation`，跨场景共享 |
| `world.js` | `WorldScene`：天空色带、环境、箭体、火焰、相机轨道（zoom rails）、输入、重开 |
| `hud.js` | `HudScene`：5 读数 + 5 动词 + Ω 双模态 + 结算/失败面板 |
| `main.js` | Phaser `Game` 引导；暴露 `window.__ROCKET_GAME__` 供无头读取 |

### 1.3 边界规则（不可逾越）

1. **core 不 import 任何 render 代码**，也不 import `phaser`。core 里出现的 `Math.*` 之外没有"环境 API"。
2. **render 不写物理**。HUD/世界只读 `sim.hudModel()` 的只读快照，绝不回写 `fm` 状态。
3. **输入单向流动**：`WorldScene` 采集键盘 → `sim.setInput()` → core 消费。core 从不主动读键盘。

---

## 2. 数据流

### 2.1 每帧（渲染宿主）

```
Phaser rAF (≈60Hz, 可漂移)
   │  deltaMs
   ▼
WorldScene.update(time, delta)
   │  ① 采集键盘 → Game.sim.setInput({pitch,throttle,stage,launch,abort})
   │  ② Game.sim.advance(deltaMs/1000)      ← 累加器内部定步推进
   ▼
Simulation.advance(realDt)                    （src/core/simulation.js）
   │  acc += clamp(realDt, 0, MAX_FRAME_DT)
   │  while acc >= DT && steps < MAX_STEPS:   DT = 1/120
   │       _step(DT)                          ← 见 §4 调用顺序
   │       acc -= DT; steps++
   │  renderAlpha = acc / DT                  ← 供插值的 0..1 残量
   ▼
HudScene.update()  → sim.hudModel()          只读快照
WorldScene 绘制    → 用 sim.renderAlpha 在两帧间插值位置/角度
```

### 2.2 每步（`Simulation._step`，对 S1 §7.3 的一处必要调整）

```
① S1  flightModel.step(dt,{pitch,throttle})   ← 内部同帧算阻力 + q
② S4  atmosphere.update(q, h)                 ← 缓存 q 供下游 + 发 MAXQ 事件
③ S3  staging.update(dt, stage, fm, q)        ← 需要本步 q 判"安全分离"
④ S5  orbit.solve(rx,ry,vx,vy)                ← 轨道根数（轻量解析式）
⑤ S7  omega.update(...)                       ← 闩锁 + 模态判据
⑥ S5  judge.update(...)                       ← 关机/入轨判定
⑦ S6  failure.detect(...)                     ← 失败归因
```
> **调整理由**：GDD 名义顺序把 S3 排在 S4 之前，但 S3 的"安全分离"判据需要 q，而 S1 的阻力也需要**同帧** q。故把 S4 的 q 计算提前到 S3 之前。物理结果与 RT-1 开环**逐位一致**（见 §7 证据），属实现顺序澄清而非设计改动，已记入 control-manifest。

---

## 3. 核心循环三分

| 循环 | 频率 | 职责 | 是否状态更新 |
|---|---|---|---|
| **物理步进** | **固定 120 Hz** | 积分、气动、状态机推进、判定 | 是（确定性） |
| **游戏逻辑/渲染** | 跟随 rAF（≈60Hz，可漂移） | 采集输入、读快照、绘制、插值 | 否（只读） |
| **HUD 更新** | 跟随 rAF | 5 读数/5 动词/Ω 双模态 | 否（只读 + 局部补间） |

**关键**：物理与渲染解耦。物理步数只由累计真实时间决定，**与渲染帧率无关**——同一段操控输入在 30fps / 144fps 下产生**逐位相同的弹道**。这是"确定性"的定义，也是无头复现浏览器结果的基础。

---

## 4. 物理积分方案（交付 1 明确要求：确认 GDD S1 的建议）

**结论：确认 S1 的建议——自写半隐式欧拉（semi-implicit Euler），不用 Arcade Physics。** 理由：

1. **精度需求 vs 设计目标错配**。Arcade Physics 为"游戏手感"设计：它默认对速度做位置积分时**不做重力下的解析修正**，并把碰撞用 AABB/分离轴近似——数值目的是"看起来对"，不是"数值上对"。本作要对齐 RT-1 的 `近地点 15.09 km / MaxQ 16.47 kPa / 81.0 s` 三位有效数字，Arcade 的积分误差量级直接击穿基准。
2. **坐标系与力模型完全自定义**。本作在**极坐标式状态矢量** `(rx, ry, vx, vy)` 上做万有引力 + 指数大气阻力 + 攻角气动恢复力矩。Arcade 只理解"对象 + 速度 + 加速度"，且其受力模型不暴露给自定义引力场。用它等于把 90% 的物理自己写，只换来一个反而碍事的步进器。
3. **半隐式欧拉对本问题是"精度/成本最优解"**。无需求解 RK4：本作用户可玩时长 ≤90s、步长 1/120s、力场平滑（无碰撞、无刚性约束），半隐式欧拉的**辛性质**保证能量不系统性发散，误差在此尺度可忽略。RT-1 §7 的开环参考实现即用此方案，端口复现逐位一致，验证成本最低。
4. **确定性 & 可测试**。半隐式欧拉是**无状态两行公式**，纯函数式，无隐藏随机、无自适应步长分支 → 同一输入序列必然同一输出。Arcade 依赖渲染帧与内部 `world.step()` 调度，无法保证。

**备选见 ADR-001**（RK4、Verlet、Arcade）。

---

## 5. 固定时间步长策略

- **物理定步 120 Hz**（`DT = 1/120`，与 RT-1 验证脚本同值，保证口径一致）。
- **累加器（accumulator）模式**：`acc += realDt; while(acc>=DT) step(DT);`
- **夹紧防死亡螺旋**：`realDt` 单帧上限 + `MAX_STEPS=5`/帧 —— 卡顿后不会一次性补跑几百步导致"瞬移"。
- **渲染插值**：保留 `renderAlpha = acc/DT ∈ [0,1)`，渲染时用上一帧与当前帧状态线性插值 → 60fps 屏幕上 120Hz 物理呈现为**平滑运动**，无抖动。
- **顿帧例外（S3）**：分离顿帧（0.35s）期间**不向累加器喂时间**，物理冻结但渲染继续——避免顿帧结束后一次性补跑。
- **焦点丢失**：`BLUR_LOCK=0.2s` 锁定输入，防切窗后的按键毛刺。

---

## 6. 与 Phaser 3 的集成

| 关注点 | 方案 |
|---|---|
| 引擎引入 | **本地 vendor** `src/vendor/phaser.min.js`（3.80.1，1.18 MB），`<script>` 直接引；无打包器、无后端 |
| 画布与自适应 | `Scale.FIT + CENTER_BOTH`，基准 1920×1080；`autoRound` |
| 场景分层 | `WorldScene`（世界，参与 zoom）+ `HudScene`（浮层，恒 zoom=1，`scene.launch` 叠加） |
| 绘制原语 | `Graphics` 程序化图形（色块/线/弧），零外部美术资产——原型验证"好不好玩"非"好不好看" |
| 相机 | 世界用 `zoom rails`：低空近景、高空拉远，营造高度感；HUD 不受影响 |
| 音频 | MVP 关闭（美术可后置） |
| 无头可读 | `window.__ROCKET_GAME__ = game`，CDP 脚本据此读 `Game.sim` 状态 |

### 6.1 性能预算核对（美术圣经红线）

| 指标 | 红线 | 本原型实测/设计 | 结论 |
|---|---|---|---|
| 活跃粒子 ≤ | 420（桌面） | MVP 未上粒子；火焰用 2 个 Graphics 渐变块 + 抖动 | ✅ 远低于 |
| Draw call ≤ | 90 | 静态几何合批；每帧仅 1 个动态 `Graphics`（hud）+ 1（world 火焰） | ✅ 约 20–30 |
| 纹理内存 ≤ | 48 MB | 无位图纹理（全程序化），仅 Phaser 内部白图 | ✅ < 1 MB |
| 首屏包 ≤ | 1.2 MB | phaser.min.js 1.18 MB + 自研源码 ~90 KB(min 前) | ⚠️ **临界**，见下 |

> **首屏包风险**：`phaser.min.js` 单文件 1.18 MB，已逼近 1.2 MB 红线。**MVP 可接受**（本地 vendor 无网损），但**正式版必须换自定义构建**（Phaser 可按需裁剪 renderer/physics 模块，预计压到 ~700 KB）或 gzip/brotli 传输（CDN 侧可压到 ~300 KB）。已列入 §8 遗留项。

---

## 7. 验证证据（闭环）

| 脚本 | 作用 | 结果 |
|---|---|---|
| `tests/prototype/open-loop-port-check.mjs` | 端口一致性：核心 vs RT-1 开环参考 | **逐位一致**：15.09 km / 81.01 s / 2087 m/s / 16.47 kPa |
| `tests/prototype/run-closed-loop.mjs` | **R4 闭环验证**：6 组玩家画像的手动操控 | 基准画像 **81.02 s / 15.03 km**（见报告） |
| `tests/prototype/verify-prototype.mjs` | 验收清单自动化（A6/A7 系列） | **41/41 通过** |
| `tests/prototype/browser-smoke.mjs` | CDP 无头浏览器：场景/输入/内核跑完/一致性/控制台 | **8/8 通过，0 报错** |

---

## 8. 已知缺陷与遗留（诚实清单）

1. **首屏包临界**（见 §6.1）——需裁剪 Phaser 或启用压缩传输。
2. **气动恢复力矩系数 `K_AERO` 为 RT-1 R5 占位值**，未做风洞级标定；影响"手笨玩家"的配平难度手感。
3. **初段视觉为占位程序化图形**，非最终美术；R4 的"好不好玩"结论只对物理闭环成立，不覆盖观感。
4. **无音效**（MVP 关闭）。
5. **无移动端/触屏**——目标平台为 TapTap 桌面网页，键鼠优先，符合范围。
6. **无存档/元系统**（S8）——原型仅验证单局循环。

---

## 9. 参考

- 决策记录：`docs/architecture/ADR/ADR-001..004`
- 程序员一页规则：`docs/architecture/control-manifest.md`
- 标定真值：`docs/architecture/RT-1-recalibration.md`
