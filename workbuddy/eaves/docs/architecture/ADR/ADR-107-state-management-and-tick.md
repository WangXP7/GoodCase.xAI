# ADR-107 · 状态管理与分层 tick：单向数据流 + `simulation/` 零渲染依赖 + 固定步长之上的 tick 调度

| 项 | 内容 |
|---|---|
| **编号** | ADR-107 |
| **状态** | 已提议（Proposed） |
| **日期** | 2026-08-30 |
| **决策者** | 程基岩（技术总监 / 主程） |
| **会签** | 游承峰（主理人）、文策渊（策划） |
| **相关** | ADR-104（固定步长与 RNG）、ADR-102（存档契约） |
| **上游** | GDD §5.3.1（分层 tick）、§3.5（数值规格表）、§3.7（系统接口）；GDD PH2b §9 R-8；`PH1-3d-feasibility.md` Q4 |

---

## 1. 背景

本作的状态管理与《潮线》有本质区别：

| | 《潮线》 | 《檐下》 |
|---|---|---|
| 状态规模 | `World` + 场景状态机 + `RunState`，~20 个字段 | **一个 `SaveBody` 对象，~80 个字段，跨 5 个系统** |
| 持久化 | localStorage，无长期状态 | **IndexedDB + 双槽 + CRC32，是 RUL-8 零容忍项** |
| 时间跨度 | 单局 5–15 分钟 | **长线养成，D1 → D365+** |
| 逻辑复杂度 | 物理 + 碰撞 + 状态机 | **5 维性格 × 15 状态 HFSM × 11 行为仲裁 × 三态判定 × 7 档离线回填** |
| 确定性要求 | 无 | **RUL-9：RNG 种子化 + 固定步长** |

同时 GDD 给了两套 tick 表（§3.5 与 §5.3.1，R-8 已识别需合并），且"光照色温"这一项在两个表里不一致。

**关键问题**：状态这么多、跨度这么长、要求确定性，还要求"改一行数值不影响其他系统"——用什么架构承接？

---

## 2. 决策

### 2.1 单向数据流

```
      ┌──────────────────────────────────────────────┐
      │                                              │
      ▼                                              │
  Intent（意图）                                     │
      │                                              │
      ├──► simulation/ ──► 修改 SaveBody 风格的内存态 ──┘
      │         │
      │         ├──► 发出状态变更事件（cat.state.entered 等）
      │         │
      │         └──► SnapshotAssembler.on*() 增量更新（ADR-102）
      │
      ├──► presentation/（只读内存态 → Three.js 对象）
      │
      └──► ui/（只读 + 发 Intent，不持有状态）
```

**三条铁律**

| # | 规则 |
|---|---|
| **S-1** | **只有 `simulation/` 能写状态**，且只能通过处理 Intent 来写 |
| **S-2** | `presentation/` 与 `ui/` **只读**，写必须经 Intent |
| **S-3** | 层间通信**只允许**经 `core/event-bus.ts` 或显式 Intent 对象；禁止直接函数调用穿透两层以上 |

### 2.2 `simulation/` 零渲染依赖（RUL-9 的前提）

> 🚨 **ESLint CI 阻断**：`src/simulation/**` 禁止出现 `import ... from 'three'`（架构 D-1）。

**为什么这是硬约束而非洁癖**：

| 理由 | 说明 |
|---|---|
| **确定性可测** | 只有逻辑层零渲染依赖，才能在 Vitest 里 headless 跑确定性测试。ADR-104 的"相同 dt 序列 → 相同终态"才有意义 |
| **回放可行性** | RUL-9 要求预留回放。若逻辑层依赖 Three.js 对象树，回放要连渲染状态一起序列化，成本爆炸 |
| **策划沙盘可直接移植** | 文策渊的 Python 沙盘可以 1:1 翻译成 TS，成为 CI 里的数值回归测试 |
| **离线结算可独立跑** | 离线结算（架构 §9.2）不需要渲染，独立跑得快 |

### 2.3 分层 tick 在固定步长之上调度（**TECH-1**）

```ts
// core/tick-scheduler.ts
interface TickLayer {
  name: string;
  period: number;        // 秒
  nextDueAt: number;     // 相对 simTime
  run: () => void;
}

class TickScheduler {
  private simTime = 0;
  private layers: TickLayer[] = [];

  register(name: string, period: number, run: () => void) {
    this.layers.push({ name, period, nextDueAt: period, run });  // 首次在 period 后触发
  }

  advance(dt: number) {                    // dt 恒 = STEP_SECONDS (1/30)
    this.simTime += dt;
    for (const layer of this.layers) {
      while (layer.nextDueAt <= this.simTime) {
        layer.run();
        layer.nextDueAt += layer.period;   // ★ 累加式，防漂移
      }
    }
  }
}
```

**权威 tick 表**（合并 GDD §3.5 与 §5.3.1，落实 R-8）

| 层 | 常量名 | 周期 | 频率 | 单次核算 | **每帧摊销 @60fps** |
|---|---|---|---|---|---|
| 微表情 | `MICRO_PERIOD_S` | 0.25 s | 4 Hz | 0.10 ms | 0.0067 ms |
| 生理需求 | `NEEDS_PERIOD_S` | 1.0 s | 1 Hz | 0.02 ms | 0.0003 ms |
| 行为决策 | `BEHAVIOR_PERIOD_S` | 2.0 s | 0.5 Hz | 0.60 ms | 0.0050 ms |
| 性格结算 | **`PERSONALITY_PERIOD_S = 60`** | **60 s** | 1/60 Hz | 0.05 ms | 0.000014 ms |
| 自动存档 | `AUTOSAVE_PERIOD_S` | 30 s | 1/30 Hz | 0.60 ms | 0.0003 ms |
| | | | | **合计** | **≈ 0.012 ms/帧** |
| | | | | 对照：全部每帧 | **0.77 ms/帧（4.64%）** |

> **分层 tick 相比"全部每帧"节省 98.4% 的模拟层 CPU 开销。占 16.6 ms 帧预算的 0.07%。**

### 2.4 我对 GDD tick 表的 3 处修正

| # | GDD 原方案 | 修正 | 理由 |
|---|---|---|---|
| **①** | 「性格 **1/60 Hz**」 | 常量命名 `PERSONALITY_PERIOD_S = 60`，文档双写「周期 60 s（= 1/60 Hz）」 | `1/60 Hz` 极易被误读为 **60 Hz**（每帧跑一次）。**这是最危险的一类歧义** |
| **②** | 「光照色温 每 5 游戏分钟」占一个 tick 层 | **移出 tick 表**，改为游戏分钟整数边界**事件**驱动 | 它本来就是 `time` 模块的派生行为；占一个 tick 槽会引入"两层调度器对不齐"的隐患 |
| **③** | tick 表用于在线推进 | **离线结算禁止复用 tick 表** | 30 天 × 86400 s ÷ 1 s = **260 万次**需求 tick ≈ 52 秒。必须走闭合解（ADR-104 §2.3） |

### 2.5 为什么要 `nextDueAt += period` 而非 `= simTime + period`

后者会**漂移**——每次执行都丢失 `(simTime − nextDueAt)` 的余量，长时间运行后 4 Hz 的 tick 会变成 3.9 Hz。累加式保持长期频率精确，这是确定性模拟的必要条件。

**验证**：单元测试跑 1 小时模拟，断言 4 Hz 层执行次数 = 14400 ± 1。

### 2.6 状态容器：`SaveBody` 即内存态

> **决策：内存态与持久态是同一个对象，不做 ORM 式的双向映射。**

```
内存中的 SaveBody  ──serialize──►  Uint8Array ──► IndexedDB
                                              └─► localStorage 紧急槽
```

| 优点 | 说明 |
|---|---|
| 零映射 bug | 不存在"内存字段改了但忘记同步到存档" |
| ADR-102 的前提 | `SnapshotAssembler` 才能做到"常驻待写入对象 + 回调内只序列化" |
| 迁移链简单 | 迁移函数直接作用于 JSON 对象 |

| 代价 | 缓解 |
|---|---|
| 内存态结构受持久化约束（不能存类实例、Map、函数） | 约定：`SaveBody` 只允许 JSON 可序列化的原始类型与数组/纯对象 |
| 派生量（如 `ENE_max`）不能存 | 约定：派生量每次读取时计算，不进 `SaveBody`（架构 §5.1） |

### 2.7 事件总线（类型安全）

```ts
// core/event-bus.ts
interface EventMap {
  'time.slotChanged':      { from: TimeSlot; to: TimeSlot; progress: number };
  'cat.state.entered':     { state: CatState; prevState: CatState; anchorId: string };
  'cat.personality.updated': { aff: number; ind: number; cur: number; sec: number; vit: number; warmth: number };
  'cat.expression.target': CatExpressionTarget;
  'interaction.result':    { verb: Verb; outcome: 'accept'|'reject'|'none'; level?: number; deltas: Deltas; streak: number };
  'interaction.blocked':   { reason: string };
  'time.offlineSettled':   { days: number; tier: 0|1|2|3|4|5|6; entries: JournalEntry[] };
  'snapshot.saved':        { atBytes: number };
  'snapshot.corrupted':    { reason: string };
  'env.objectPlaced':      { objectId: string; position: [number, number, number] };
  // ...
}

const bus = createEventBus<EventMap>();
```

| 约束 | 说明 |
|---|---|
| **事件对象必须可池化 / 零分配** | 高频事件（`cat.expression.target` 4 Hz）复用同一对象实例 |
| **`ui/` 禁止订阅 `interaction.result`** | A2-2 硬约束：6 级拒绝**不使用任何 UI 反馈**（架构 G-A10） |
| **事件是"已发生的事实"**，不是"命令" | 命名用过去式（`entered` / `result` / `saved`），不用祈使句 |

---

## 3. 备选方案

### 3.1 备选 A · 引入状态管理库（Redux / Zustand / Valtio）

| 维度 | 评价 |
|---|---|
| 优点 | 有成熟的时间旅行 / 中间件生态 |
| 缺点 | 本作状态是一个 `SaveBody` 对象 + 单向 Intent 流，**引入库只会增加"绕过它"的诱惑**；Zustand ~1 KB / Redux ~15 KB 的体积虽小，但它们的不可变更新模式与 ADR-102 的"常驻可变对象 + 增量序列化"直接冲突 |
| 判定 | ❌ **否决** |

### 3.2 备选 B · ECS 架构（bitECS / miniplex）

| 维度 | 评价 |
|---|---|
| 优点 | 数据与逻辑分离，扩展性好 |
| 缺点 | **实体 ≤ 50、组件固定**。ECS 的收益在实体上千、组件动态增删时才显现。本作引入 ECS 反而让"5 维性格 + 15 状态机"这类强内聚逻辑被拆散 |
| 判定 | ❌ **否决** |

### 3.3 备选 C · XState（Phase 1 Q4 已评估）

| 维度 | 评价 |
|---|---|
| 优点 | 可视化、层次状态机原生支持、Actor 模型 |
| 缺点 | **bundle 大（~50 KB）、Actor 模型过重**；本作状态机只需 currentState + 加权转移，约 500 LOC；且 XState 的状态不可直接 JSON 序列化（需额外适配 ADR-102） |
| 判定 | ❌ **否决**。自写轻量 HFSM（Phase 1 Q4 结论保持） |

### 3.4 备选 D · 全部每帧执行（不分层 tick）

| 维度 | 评价 |
|---|---|
| 优点 | 实现最简，无调度器 |
| 缺点 | **0.77 ms/帧（帧预算 4.64%）**，比分层贵 64 倍；且行为决策每帧跑会导致猫高频抖动（GDD §5.3.1 原文："会让猫看起来像每帧在掷骰子"） |
| 判定 | ❌ **否决** |

### 3.5 备选 E · 每个 tick 层用独立的 `setInterval` / `setTimeout`

| 维度 | 评价 |
|---|---|
| 优点 | 浏览器原生调度 |
| 缺点 | **定时器精度不可控**（后台节流、最小 4 ms clamp、累积漂移）；**破坏确定性**（不同帧率下 tick 与 step 的相对顺序不一致，RNG 抽取顺序会变） |
| 判定 | ❌ **否决**。必须与固定步长共用一条时间轴 |

### 3.6 备选 F · 内存态与持久态分离（ORM 式双向映射）

| 维度 | 评价 |
|---|---|
| 优点 | 内存态可以用类实例、Map、Set，表达力更强 |
| 缺点 | **映射层是 bug 温床**——"改了内存字段但忘记同步到存档"是长线养成游戏最致命的一类 bug，且它违反 RUL-8 的精神。ADR-102 的 `SnapshotAssembler` 也依赖"内存态即待写入态" |
| 判定 | ❌ **否决** |

---

## 4. 理由

### 4.1 为什么"分层 tick 开销可接受"（TECH-1 的直接回答）

| 论据 | 数字 |
|---|---|
| 每帧摊销 | **0.012 ms / 16.6 ms = 0.072%** |
| 相比全部每帧 | 省 **98.4%**（0.77 → 0.012 ms） |
| 最重的一层 | 行为决策 0.5 Hz × 0.60 ms = 0.005 ms/帧 |
| 结论 | **策划对开销的担忧不成立。** 真正的成本在别处（离线结算、渲染、存档），不在 tick 频率 |

**但与渲染帧率的解耦不是靠 tick 频率实现的，是靠 ADR-104 的固定步长。** tick 层叠加在固定步长时间轴之上，所以 60 / 30 / 20 fps 下逻辑结果完全一致。

### 4.2 为什么"离线结算禁止复用 tick"（修正 ③）

```
30 天 × 86400 s ÷ 1 s = 2,592,000 次需求 tick
每次 0.02 ms → 51,840 ms ≈ 52 秒（中端移动）
```

52 秒白屏不可接受。而 `HNG`/`HYD`/`TOI`/`warmth`/`AFF`/`CUR` 的衰减规则**都是线性 + clamp**，有闭式解。

**这不只是性能优化，是可行性问题。** 唯一必须模拟的是 `ENE`（非线性分段），用 15 游戏分钟步长 → 2880 步 ≈ 58 ms，分 4 帧。

### 4.3 为什么状态容器必须是"可 JSON 序列化的纯数据"

ADR-102 的 RUL-8 落地要求：**`visibilitychange` 回调内禁止 `await`，只允许"序列化 + CRC32 + 发起写"**。

若内存态包含类实例 / Map / Set / 循环引用，序列化就不是 0.25 ms 而是 3–8 ms，且可能因某个系统处于中间态而写出脏数据。

**"内存态即待写入态"是 RUL-8 能兑现的前提，而"纯 JSON 数据"是"内存态即待写入态"的前提。**

### 4.4 为什么"光照色温"要移出 tick 表

它本质是 `time` 模块的派生行为——`gameMinutes` 变化时检查是否跨 5 分钟边界。占一个 tick 槽会引入两个调度器（`TickScheduler` 与 `GameClock`）对不齐的隐患：

- tick 层在 `simTime` 上跑
- 游戏分钟在 `gameMinutes` 上跑（受 ×12 影响）

**两者时基不同，不能混。** 改为事件驱动后，`GameClock` 在跨越 5 游戏分钟边界时直接发 `time.lightParamsStale` 事件，成本降到 ~0。

---

## 5. 影响

### 5.1 正面

| 项 | 说明 |
|---|---|
| 确定性 | 逻辑层零渲染依赖 + 固定步长 + 种子化 RNG → 可 headless 测 |
| RUL-8 | "内存态即待写入态"让 `visibilitychange` 同步写入成为可能 |
| 可测试 | 策划的 Python 沙盘可直接移植为 TS 回归测试 |
| tick 开销 | 0.012 ms/帧（0.07% 帧预算） |
| 离线结算 | 从 52 秒降到 < 110 ms |

### 5.2 负面 / 代价

| 项 | 说明 | 缓解 |
|---|---|---|
| **`SaveBody` 只能用 JSON 可序列化类型** | 不能用 Map / Set / 类实例 / 循环引用 | 约定 + code review；派生量每次计算不存储 |
| **分层 tick 增加一层间接** | 开发者要理解"固定步长 + tick 调度"两层 | 本文档 + 代码注释 |
| **离线结算需要额外一套闭合解** | 不能复用 tick 逻辑 | 契约测试：闭合解 vs 逐 tick 误差 < 0.01 点 |
| **单向数据流增加样板代码** | 每个写操作都要定义 Intent 对象 | Intent 定义约 15 个（对应 15 个动词），可接受 |

### 5.3 对下游的约束

| 对象 | 约束 |
|---|---|
| **全体** | `src/simulation/**` 禁止 `import three`（ESLint CI 阻断） |
| **全体** | 新增持久化字段必须加进 `SaveBody` 契约 + 写迁移函数 |
| **策划** | 离线回填的数值规则必须是**线性 + clamp**，否则无法闭式求解 |
| **策划** | 新增"玩家发现记录"类字段（`discovered`/`viewedAt`/`streak`）**一律禁止**（GDD PH2b §1.9，可静态检查） |
| **UI** | 禁止订阅 `interaction.result`（A2-2：拒绝零 UI 反馈） |
| **UI** | 禁止持有游戏状态（只允许"当前翻到第几张卡片"这类纯 UI 本地态） |

## 6. 风险

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| **A107-R1** | 开发者为图方便在 `simulation/` 里 import three | 🟠 P1 | ESLint `no-restricted-imports` **CI 阻断**（架构 D-1） |
| **A107-R2** | `SaveBody` 混入不可序列化字段（Map / 类实例）导致序列化失败 | 🟠 P1 | 契约测试：`JSON.stringify(SaveBody)` 可往返 + 字段类型快照 |
| **A107-R3** | 闭合解与逐 tick 积分漂移（策划后期加入非线性规则） | 🟠 P1 | 契约测试误差 < 0.01 点；策划改动非线性规则须提前告知程序 |
| **A107-R4** | tick 层漂移（`nextDueAt = simTime + period` 的写法被误用） | 🟠 P1 | 单元测试：跑 1 小时模拟，断言 4 Hz 层执行 14400 ± 1 次 |
| **A107-R5** | 事件对象在热路径分配导致 GC 抖动 | 🟡 P2 | 高频事件（`cat.expression.target`）复用同一实例；`behavior-arbiter` 用预分配 `Float32Array(16)` |
| **A107-R6** | 单向数据流被绕过（表现层直接改状态） | 🟠 P1 | `presentation/` 接收 `Readonly<T>`；code review |
| **A107-R7** | 两个枚举 `timeSlot` / `circadianBand` 被混用 | 🟠 P1 | TypeScript 独立类型 + ESLint；GDD R-3 |

## 7. 验收

| # | 项 | 判定 |
|---|---|---|
| V-107-1 | **`simulation/` 零 `import three`** | ESLint CI（G-A5） |
| V-107-2 | 固定步长 + tick 调度：60 fps 与 30 fps 的 dt 序列 → 相同终态 | 单元测试 |
| V-107-3 | tick 频率精度：1 小时模拟，4 Hz 层执行 14400 ± 1 次 | 单元测试 |
| V-107-4 | tick 表常量名与架构 §3.2.1 一致（含 `PERSONALITY_PERIOD_S = 60`） | 代码审查 |
| V-107-5 | `SaveBody` 可 JSON 往返 + 字段类型快照 | 契约测试 |
| V-107-6 | **状态机强连通、无吸收态、无终止态** | 属性测试 10⁴ 步（G-A8） |
| V-107-7 | 依赖方向 D-1 ~ D-8 全部满足 | ESLint + code review |
| V-107-8 | `ui/` 不订阅 `interaction.result` | 静态审查（G-A10） |
| V-107-9 | 事件对象在热路径零分配（`behavior-arbiter` 用预分配数组） | 代码审查 + GC profile |

---

*ADR-107 · 程基岩 · 待会签*
