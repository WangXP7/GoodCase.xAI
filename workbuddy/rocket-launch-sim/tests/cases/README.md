# MVP 测试用例集 · 索引

> 作者：严守真（QA / 测试） · 对应任务 P6-QA-001
> 依据：`design/concept/rocket-launch-concept.md` v0.3、`design/gdd/S1..S8`、`docs/architecture/control-manifest.md`、`docs/architecture/RT-1-recalibration.md`
> 状态标记：**PASS** 实测通过 / **FAIL** 实测失败（缺陷） / **GAP** 无自动化覆盖·待补 / **MANUAL** 需人工或浏览器

## 分层与执行

| 层 | 脚本 | 说明 |
|---|---|---|
| 逻辑（无头） | `tests/prototype/verify-prototype.mjs` | 既有 41 条断言（**存在写松项，见 `tests/verification-report.md`**） |
| 端口一致性 | `tests/prototype/open-loop-port-check.mjs` | src/core 与 RT-1 开环标定逐项对齐 |
| 闭环 | `tests/prototype/run-closed-loop.mjs` | 玩家通道能否复现基准弹道 |
| 独立验证（新增） | `tests/qa/independent-verify.mjs` | 用**不同方法**独立复核，不复用既有断言 |
| 中止探针（新增） | `tests/qa/probe-abort.mjs` | V5 中止分阶段生效性 |
| 浏览器 | `tests/prototype/browser-smoke.mjs` | Phaser 场景 / 键鼠输入 / 同源内核一致 |

```bash
node tests/prototype/open-loop-port-check.mjs
node tests/prototype/run-closed-loop.mjs
node tests/prototype/verify-prototype.mjs
node tests/prototype/browser-smoke.mjs
node --expose-gc tests/qa/independent-verify.mjs
node tests/qa/probe-abort.mjs
```

## 用例文件

| 文件 | 覆盖 |
|---|---|
| [`verb-normal-paths.md`](verb-normal-paths.md) | V1 点火 / V2 节流 / V3 配平 / V4 分离 / V5 中止 的正常路径 |
| [`restart-3s.md`](restart-3s.md) | P3「失败后 3 秒内可重来」硬指标（可精确验证） |
| [`legibility-P2.md`](legibility-P2.md) | P2 可解读性：失败归因是否给出可理解的原因 |
| [`failure-paths.md`](failure-paths.md) | 解体 / 坠海 / 中止逃逸 等失败路径 |
| [`omega-modality.md`](omega-modality.md) | Ω 双模态切换的连续性（切换处不得跳变） |

## 本轮结论速览

- **P0 阻断 1 项**：`TC-V5-01` 飞行段 Esc 中止无效（5 动词之一在其主窗口失效）。
- **P1 严重 1 项**：`TC-FAIL-06` DESTRUCT_ALPHA 死代码 ⇒ A6-1「9 码可触发」不成立。
- **P2 一般**：`TC-P2-…` 归因可用，但部分失败码永不可达；`TC-OMEGA-…` 切换连续性成立但既有断言方法空泛。
- **P3 轻微**：热路径分配、常量重复、成功计数重复累加。
