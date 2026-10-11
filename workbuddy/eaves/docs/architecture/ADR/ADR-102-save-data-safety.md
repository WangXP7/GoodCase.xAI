# ADR-102 · 存档与数据安全：4 层防护（localStorage 紧急槽 + IDB 双槽 + CRC32 + 迁移链）

| 项 | 内容 |
|---|---|
| **编号** | ADR-102 |
| **状态** | 已提议（Proposed）· **含一处对 RUL-8 的加强，需主理人确认** |
| **日期** | 2026-08-30 |
| **决策者** | 程基岩（技术总监 / 主程） |
| **会签** | 游承峰（主理人，RUL-8 裁决人）、文策渊（策划，数据契约） |
| **相关** | ADR-104（确定性 RNG 需持久化）、架构 §4 |
| **上游** | **`PH2-rulings-EAVES.md` RUL-8（🚨 零容忍项）**；GDD §5.5–§5.7、§6.4；风险 S-4 / V3-4 / V-M1 |

---

## 1. 背景

### 1.1 RUL-8 的原文

> **同步写入 + 双槽 + CRC32 校验，三条同时做，不允许为工期削减任何一条。**
>
> 理由：本作是长线养成，**存档是玩家投入的唯一载体**。一个养了 60 天的猫因为切后台丢失，是不可接受的失败——它比任何画面缺陷都更致命，且**不可挽回**。这是本项目**唯一的"零容忍"项**。

### 1.2 一个必须现在说清楚的平台事实

策划与主理人的两条要求——「**同步写入**」与「**IndexedDB 双槽**」——在当前 Web 平台下存在**技术冲突**：

> ⚠️ **IndexedDB 没有任何同步 API。**
> `IDBObjectStore.put()` 只是**同步发起**一个异步事务；事务的 completion 是异步的（`transaction.oncomplete`）。
>
> ✅ **Web 平台唯一真正的同步持久化 API 是 `localStorage.setItem()`**（规范定义为同步，浏览器同步写入磁盘支撑的存储后返回）。

**iOS Safari 的行为分两种，区别至关重要：**

| 场景 | 页面状态 | IDB 事务是否完成 |
|---|---|---|
| **冻结（freeze）** | 切后台 / 锁屏，页面进程存活但 JS 暂停 | ✅ **通常完成**——事务在独立的 IDB 线程执行，页面冻结 ≠ 线程杀死。这是所有 Web 游戏在 iOS 上的标准做法 |
| **终止（kill）** | 内存回收 / 用户上滑清掉 / 系统杀进程 | ❌ **不保证**——队列中的事务可能来不及落盘 |

RUL-8 关注的是"丢档不可挽回"，而**最坏情况恰恰是 kill 而非 freeze**。因此只在 IndexedDB 上做双槽，无法覆盖 RUL-8 想要覆盖的最坏情况。

## 2. 决策

> ## **落地为 4 层防护。RUL-8 的三条全部保留，一条未削减；第 4 层（localStorage 紧急槽）是我新增的加强。**

| # | 层 | API | 同步性 | 覆盖的场景 | RUL-8 对应 |
|---|---|---|---|---|---|
| **1** | **紧急槽** | `localStorage.setItem('eaves:emergency', packed)` | ✅ **真同步**（阻塞至落盘） | **页面被 kill**（IDB 事务来不及完成） | 「同步写入」的**真正兑现** |
| **2** | **主存储双槽** | IndexedDB `save` store，`slotA` / `slotB` 交替 | ⚠️ 同步发起 / 异步完成 | 正常读写、容量大、结构化、可存 Blob | 「双槽」 |
| **3** | **完整性校验** | CRC32（查表法，覆盖存档主体） | ✅ 同步计算 | 位翻转、写入中断、手工篡改 | 「CRC32 校验」 |
| **4** | **迁移函数链** | 纯函数数组 `v(n) → v(n+1)`，同步执行 | ✅ 同步执行 | 版本演进 | GDD E3-8 / §6.4.2 |

### 2.1 写入流程（`visibilitychange → hidden`）

```ts
// platform/lifecycle.ts —— { capture: true }，全程无 await
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden') return;

  // ① 序列化：同步。8 KB JSON + TextEncoder ≈ 0.25 ms
  const body = assembler.serialize();                    // Uint8Array

  // ② CRC32：同步。查表法，8192 次循环 ≈ 0.05 ms
  const crc = crc32(body);

  // ③ 真同步落盘：localStorage（唯一同步持久化 API）
  //    8 KB ≈ 0.15–0.4 ms（Safari 带 fsync 时可能到 1–2 ms）
  try { localStorage.setItem(EMERGENCY_KEY, pack(body, crc)); } catch {}

  // ④ 主存储双槽：同步发起（事务异步完成，但已排入 IDB 队列）
  //    DB 连接常驻打开，此处绝不 await openDB()
  const slot = (lastGoodSeq & 1) ? 'slotA' : 'slotB';     // 交替
  idb.put('save', { slot, seq: lastGoodSeq + 1, body, crc32: crc,
                    schema: TARGET_SCHEMA, writtenAt: Date.now() });

  // ⛔ 本回调内禁止：await / .then() / setTimeout / requestIdleCallback / 任何异步编码
}, { capture: true });
```

**成本合计：中端移动 < 1 ms（Safari 最坏 ~2 ms），在 16.6 ms 帧预算内。**

### 2.2 常驻的 `SnapshotAssembler`（关键前置设计）

```ts
// 每次 tick 结束后增量更新，永不重新装配
class SnapshotAssembler {
  private pending: SaveBody = { /* 初始结构 */ };

  onNeedsUpdated(n: Needs) { this.pending.cat.needs = n; }
  onStateEntered(s: CatState, gameMin: number) {
    this.pending.cat.state = s;
    this.pending.cat.stateEnteredAtGameMin = gameMin;
  }
  // ... 其余 12 个 on* 钩子
  serialize(): Uint8Array { return encoder.encode(JSON.stringify(this.pending)); }
}
```

> 🚨 **没有这个设计，RUL-8 不可能兑现。** 若在 `visibilitychange` 回调里才去各系统搜集状态，光遍历 + 序列化就要 3–8 ms，且极易因某系统处于中间态而写出脏数据。**回调内只允许做 3 件事：序列化、CRC32、发起写。**

### 2.3 四条不可削减的硬规则（CI 可静态检查）

| # | 规则 | enforcement |
|---|---|---|
| **W-1** | `visibilitychange` 回调中**禁止** `await` / `.then()` / `setTimeout` / `requestIdleCallback` | ESLint `no-restricted-syntax` + code review |
| **W-2** | **IndexedDB 连接常驻打开**（进入时 open 一次，永不 close）。回调内禁止 `await openDB()` | 运行时断言 `idb.db !== null` |
| **W-3** | **写入槽位交替**：`slot = (lastGoodSeq & 1) ? A : B`，**绝不覆盖上一次成功写入的槽** | 单元测试 |
| **W-4** | **先写 localStorage 紧急槽，再写 IndexedDB**，顺序不可颠倒 | 单元测试 |

### 2.4 双槽如何防"写一半崩溃"

| 机制 | 说明 |
|---|---|
| 交替写入 | 任何时刻，**至少有一个槽是上一次完整写入的结果** |
| `seq` 单调递增 | 读档时取 `seq` 较大且 CRC 通过的那个 |
| 中断恢复 | 目标槽 `seq` 已占位但 CRC 失败 → 自动回退另一槽 |
| 迁移备份 | 迁移后旧版本存档写入 `slotArchive`，保留 **7 天**（GDD §6.4.2 ④） |

### 2.5 读取校验链

```
① 主槽（seq 较大者）→ CRC 校验
      ├─ 通过 → 迁移 → 进入
      └─ 失败 ↓
② 副槽 → CRC 校验
      ├─ 通过 → 迁移 → 进入（记录 snapshot.corrupted，埋点，不打扰玩家）
      └─ 失败 ↓
③ localStorage 紧急槽 → CRC 校验
      ├─ 通过 → 迁移 → 进入（同上）
      └─ 失败 ↓
④ 异常恢复路径（UX 路径 C）
      → 显示"它记不住事了"，提供导出/导入存档码入口
      → 🚨 绝不静默重置（GDD §6.4.2 ⑤）
```

### 2.6 CRC32 规格

| 项 | 规格 |
|---|---|
| 算法 | CRC-32/ISO-HDLC（多项式 `0xEDB88320`，与 zlib 同），查表法 `Uint32Array(256)` |
| 覆盖范围 | `SaveBody` 除 `crc32` 字段外的紧凑 JSON 的 UTF-8 字节 |
| 成本 | 8 KB → 8192 次查表 ≈ **0.03–0.08 ms**（中端移动） |
| **不覆盖** | **blob store（截图 / 日记快照）**——GDD §6.5 硬规则：一张坏图不得导致整个存档判坏 |

### 2.7 迁移链的五条硬规则

| # | 规则 | enforcement |
|---|---|---|
| **M-1** | 单调递增，命名为 `migrateV{n}toV{n+1}` | 文件命名约定 |
| **M-2** | **只增字段，不删字段**；废弃字段保留满 2 个版本后才可移除 | Code review |
| **M-3** | 迁移前先 CRC 校验；**校验失败的存档不迁移**，保留原样走异常恢复 | 代码断言 |
| **M-4** | 迁移成功后旧版存档写入 `slotArchive`，保留 **7 天** | 单元测试 |
| **M-5** | **★ 5 项情感资产逐字节保留**：`cat.name` / `cat.genes` / `discoveredAnchors` / `cat.repertoire` / blob store 全部截图与日记快照 | **自动化契约测试**：构造 v2 存档 → 迁移 → 断言这 5 项 `JSON.stringify` 完全相等。**CI 阻断** |

> **M-5 的意义**：GDD §6.4.2 写了这条"硬规则"但没有验证手段。我把它变成 CI 会红的断言——**这让"丢猫"从"靠人记住"变成"机器拦住"。**

## 3. 备选方案

### 3.1 备选 A · 严格按 RUL-8 原文只做 3 层（仅 IDB 双槽 + CRC32）

| 维度 | 评价 |
|---|---|
| 优点 | 严格贴合裁决文字；少 0.5 人日；每次写入少 0.15–0.4 ms |
| 缺点 | **"同步写入"这四个字无法真正兑现**（IDB 无同步 API）。最坏情况（页面被 kill）下仍然丢档 |
| 判定 | ⚠️ **不推荐**。若主理人坚持，我接受，但风险 T-1 从 🟠 P1 升回 🔴 P0 |

### 3.2 备选 B · 全部用 localStorage（弃用 IndexedDB）

| 维度 | 评价 |
|---|---|
| 优点 | 真同步、API 极简 |
| 缺点 | 容量 5 MB（存档主体 8 KB 够用，但截图 20 张 2.54 MB + 日记快照 0.85 MB = 3.4 MB，余量仅 1.6 MB）；**只能存字符串，Blob 必须 base64（+33% 体积）**；同步写入阻塞主线程 |
| 判定 | ❌ **否决**。容量与 Blob 支持都不足 |

### 3.3 备选 C · 双槽用两个 IndexedDB object store（`storeA` / `storeB`）

| 维度 | 评价 |
|---|---|
| 优点 | 概念上更"隔离" |
| 缺点 | 两次 `open` 时的 `onupgradeneeded` 要维护两个 store 的 schema；`slotArchive` 需要第三个 store；**同一 store 内两条记录在原子性上完全等价** |
| 判定 | ❌ **否决**。同 store 两条记录更简单，且事务边界一致 |

### 3.4 备选 D · 用 `navigator.locks` 或 `BroadcastChannel` 做多标签页同步

| 维度 | 评价 |
|---|---|
| 优点 | 浏览器原生锁 |
| 缺点 | iOS Safari 对 `Web Locks API` 支持较晚且不稳定；`BroadcastChannel` 在冻结场景下不可靠 |
| 判定 | ❌ **否决**用于数据安全。多标签页仲裁改用 IDB 内的 `sessionLock` + 心跳（GDD §6.7，架构 §12 T-7） |

### 3.5 备选 E · 引入 idb-keyval / Dexie 封装库

| 维度 | 评价 |
|---|---|
| 优点 | 少写 ~120 LOC |
| 缺点 | 增加运行时依赖（idb-keyval ~1 KB，Dexie ~25 KB）；**我们的需求（常驻连接 + 同步发起 put + 双槽）用原生 API 反而更直接**；封装库倾向于 Promise 化，反而诱导 `await` |
| 判定 | ❌ **否决**。手写 120 LOC，避免"await 诱惑" |

## 4. 理由

### 4.1 为什么第 4 层（localStorage）是必要的而非过度设计

| 论据 | 说明 |
|---|---|
| **成本极低** | 8 KB 存档主体，占 localStorage 5 MB 容量的 **0.16%**；写入 0.15–0.4 ms |
| **它是唯一能兑现"同步"二字的 API** | IDB 双槽解决的是"写入中断"，localStorage 解决的是"进程死亡"——**两个不同的失效模式** |
| **它覆盖的正是 RUL-8 描述的场景** | RUL-8 说"iOS Safari 在回调返回后**立即冻结**页面"。冻结场景下 IDB 事务通常能完成；但**用户上滑清掉 App、系统内存回收**是 kill 而非 freeze，这条路径只有 localStorage 能兜住 |
| **裁决的精神优先于文字** | RUL-5 已经确立了这个先例（"按精神执行"）。RUL-8 的精神是"绝不丢档"，第 4 层服务于精神 |

### 4.2 为什么双槽而不是"写前先备份"

| 方案 | 单次写入的 I/O 次数 | 崩溃安全性 |
|---|---|---|
| 写前备份（copy → write） | **2 次**（读旧 + 写备份 + 写主 = 实际 3 次） | 好，但慢 3 倍 |
| **双槽交替** | **1 次** | 同样好（旧槽天然就是备份） |

双槽交替 = **免费的备份**。这是它优于"写前备份"的根本原因。

### 4.3 为什么 CRC32 而不是 SHA-256 / Adler-32

| 算法 | 速度（8 KB） | 检错能力 | 判定 |
|---|---|---|---|
| CRC32 | 0.03–0.08 ms | 检测所有 ≤ 32 bit 突发错误、所有单/双 bit 错误 | ✅ **足够**。我们的威胁模型是"位翻转 / 写入中断"，**不是抗恶意篡改**（GDD §5.7 ⑦ 明确不做防篡改） |
| Adler-32 | ~0.02 ms | 弱于 CRC32（对短消息漏检率高） | ❌ |
| SHA-256 | ~0.5 ms（WebCrypto 异步，无法同步用） | 强 | ❌ **WebCrypto 是异步 API，在 `visibilitychange` 回调内不可用** |

**关键**：CRC32 是唯一能**同步**在 0.1 ms 内算完的校验算法。WebCrypto 的 `subtle.digest` 返回 Promise，直接违反 W-1。

### 4.4 为什么 blob 独立于存档主体

GDD §6.5 明确：「截图**不计入** `integrity` 校验——一张坏图不得导致整个存档判坏」。物理分离（独立 `blobs` store）是最干净的实现，也顺带解决了：

- 存档主体保持 8 KB，localStorage 紧急槽装得下
- 截图删除/添加不触发存档主体重写
- 相册加载可按需、可缓存

## 5. 影响

### 5.1 正面

| 项 | 说明 |
|---|---|
| 数据安全 | 覆盖 freeze 与 kill 两种失效模式；三层回退（主槽 → 副槽 → 紧急槽） |
| 写入成本 | 30 s 增量 < 2 ms；`visibilitychange` 强制写 < 1 ms（Safari 最坏 2 ms） |
| 迁移安全 | 5 项情感资产由 CI 契约测试保护，**丢猫不可能静默发生** |
| 容量 | 90 天 ≈ 3.4 MB / 预算 5 MB（截图 WebP 化后） |

### 5.2 负面 / 代价

| 项 | 说明 | 缓解 |
|---|---|---|
| **每次写入多 0.15–0.4 ms** | localStorage 同步阻塞 | 只在 `visibilitychange` / `pagehide` / 关键事件后写紧急槽；30 s 增量**不写**紧急槽 |
| **多 0.5 人日** | 4.25 → 4.75 人日（含紧急槽的读取回退分支） | 相对 RUL-8 零容忍项的权重，可忽略 |
| **localStorage 在 iOS 无痕模式同样不可用** | 与 IDB 一起失效 | 三级回退全部失败 → 异常恢复路径（GDD E3-4：in-memory + 导出存档码 + 一次性提示"它记不住事了"） |
| **localStorage 是同步的，滥用会卡** | 若误用于大对象 | 代码约束：紧急槽**只存存档主体**（8 KB），绝不存 Blob |

### 5.3 对下游的约束

| 对象 | 约束 |
|---|---|
| 全体 | **任何系统想持久化新字段，必须先加进 `SaveBody` 契约，并写对应的迁移函数** |
| 策划 | 新增"玩家发现记录"类字段（`discovered`/`viewedAt`/`streak`）**一律禁止**（GDD PH2b §1.9） |
| 策划 | 截图与日记快照**不进** `crc32` 校验范围，也不进导出存档码（GDD §6.4.3） |
| QA | V-M1 真机压力测试是**阻断项**：iPhone 13 + SE2 各 100 次"玩 3 分钟 → 切后台 → 杀进程"，丢失 ≤ 30 s |

## 6. 风险

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| **A102-R1** | iOS `visibilitychange` 写入仍不可靠（真机行为是黑盒） | 🔴 **P0** | 4 层防护；**V-M1 真机压力测试是 G-A4 阻断项**；埋点 `snapshot.saved` / `snapshot.corrupted` |
| **A102-R2** | localStorage 5 MB 配额被其他数据挤占 | 🟡 P2 | 紧急槽只存 8 KB 主体；`try/catch` 后静默降级到 IDB 双槽（不打扰玩家） |
| **A102-R3** | 迁移函数写错导致情感资产丢失 | 🟠 P1 | **M-5 CI 契约测试阻断**；`slotArchive` 保留 7 天可回滚 |
| **A102-R4** | `SnapshotAssembler` 漏接某个 `on*` 钩子 → 某字段永远不更新 | 🟠 P1 | 契约测试：跑一局完整模拟，断言 `SaveBody` 每个字段都发生过变化 |
| **A102-R5** | IDB 事务在极端情况下仍不完成 | 🟡 P2 | 最坏丢失 ≤ 30 s（30 s 增量 + 紧急槽）；GDD E3-5 已声明"玩家无感" |
| **A102-R6** | 主理人否决第 4 层 | 🟠 P1 | 已准备备选 A；代价是 T-1 升回 🔴 P0 |

## 7. 验收

| # | 项 | 判定 |
|---|---|---|
| V-102-1 | W-1 ~ W-4 四条硬规则全部满足 | ESLint + 单元测试 |
| V-102-2 | 单槽 CRC 损坏 → 自动回退另一槽 → 回退紧急槽 → 全部失败才进异常恢复 | 单元测试（4 个用例） |
| V-102-3 | 迁移链的 5 项情感资产逐字节保留（M-5） | 契约测试 CI 阻断 |
| V-102-4 | `visibilitychange` 回调内零 `await`（AST 扫描） | CI |
| V-102-5 | **真机压力测试：iPhone 13 + SE2 各 100 次，丢失 ≤ 30 s** | 真机报告（G-A4） |
| V-102-6 | 写入耗时埋点：30 s 增量 < 2 ms，强制写 < 2 ms（中端） | `performance.measure` |

---

*ADR-102 · 程基岩 · 第 4 层需主理人确认 · 待会签*
