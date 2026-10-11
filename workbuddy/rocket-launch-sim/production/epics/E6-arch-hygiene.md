# E6 · 架构与规则收敛（技术债）

> **优先级**：P2（**违反 `control-manifest.md` 硬规则**；且 W2 会静默击穿后续调参，建议**先于 E7 执行**）
> **上游**：`control-manifest.md`（Z1–Z3 / S1–S3）、`ADR-003`、`ARCH-1` §5
> **审计条目**：W1, W2, W3, W6
> **风险定级**：W1 低（实测无卡顿，但属明文违反）；**W2 中**（`Q_SEP_SAFE` 硬编码会让 S3 §9-C6 的调参失效）

---

## ST-6.1 · 热路径零分配整改（Z1–Z3）

- **关联**：control-manifest Z1/Z2/Z3（W1）
- **验收标准**：
  1. **Z2**：`simulation.hudModel()` **复用同一缓冲对象**（构造时建一次，之后原地填值），不再每帧 `return {...}`。
  2. **Z3（每步循环内）**：
     - `omega.update` / `judge.update` / `staging.update` 的 `const ev = []` 改为**复用的成员事件数组**（每步 `length = 0` 后填），或返回"无事件"单例。
     - `omega.update` 的 `this._window.push({t,s})` 改为**定长环形缓冲**（预分配 `Float64Array` 或预建对象池），消除每步对象分配。
     - `omega.update` 的 `for (const m of [25,50,75])` 数组字面量改为**模块级冻结常量** `HUD.OMEGA_MILESTONES`（`constants.js` 已有该字段，直接消费）。
  3. **Z1**：`orbit.solve` 已复用 `out` ✅（保持）；`fm.getDerived()`/`fm.interpolated()`/`omega.get()` 属渲染帧（非 120Hz 热路径），可保留但**注释标明非热路径**。
  4. 整改后 **41/41 与 9/9 全部保持**（行为零变化，仅分配消除）。
- **涉及文件**：`src/core/simulation.js`、`src/core/omega.js`、`src/core/judgement.js`、`src/core/staging.js`
- **依赖**：无
- **复杂度**：M
- **测试证据路径**：`verify-prototype.mjs` 41/41 不变 + 新增"热路径分配计数"断言（可选：包一层计数钩子）

## ST-6.2 · 唯一真值源整改（S1）——抽取 magic number

- **关联**：control-manifest S1（W2, W6）
- **验收标准**（将下列字面量抽到 `constants.js`，**禁止散落**）：
  1. `staging.js:61` `q <= 5000` → `FAIL.Q_SEP_SAFE`（**关键**：修好后 S3 §9-C6 的 5000→8000 调参才生效）。
  2. `atmosphere.js:69` `12000` → `FAIL.Q_WARN`；`:70` `1000` → `FAIL.Q_PEAK_MARGIN`；`:78` `12000` → `FAIL.Q_WARN`。
  3. `failure.js:119` `DV=2635` → `ROCKET.DV_TOTAL`；`:124` `30000` → `FAIL.Q_STRUCT`；`:197/:201` `12000` → `WORLD.ATM_TOP`；`:210` `15000` → `WORLD.H`；`:217` `16500` → `FAIL.Q_WARN`（峰值动压参照）。
  4. 新增 `S6 = { T_EXPLOSION:1.70, T_PANEL:1.70, T_RETRY_MAX:3.0, T_SILENCE_FROM:0.50, T_SILENCE_TO:1.10, MAX_EVIDENCE:4 }`；替换 `simulation.js:289` 与 `hud.js:373/374` 的 `1.70`/`1.4`。
  5. `constants.js:18` `VC: Math.sqrt(7.2e11/315000)` → 由 `MU/R_TGT` 派生；`V_ESC: 2138.0` → `Math.SQRT2 * VC`（注意对象字面量自引用需改为构造后 `Object.freeze` 或 getter）。
  6. **改动后必须重跑四项验证**（S2）；数值不得变化。
- **涉及文件**：`src/core/constants.js`、`src/core/staging.js`、`src/core/atmosphere.js`、`src/core/failure.js`、`src/core/simulation.js`、`src/render/hud.js`
- **依赖**：无（与 E3/ST-3.1 的 `S6` 常量块**合并交付**）
- **复杂度**：M
- **测试证据路径**：`verify-prototype.mjs` 41/41 + `open-loop-port-check` 9/9（逐位不变）

## ST-6.3 · ADR-005：冗余/失效常量清理 + Q_SEP_SAFE 归属澄清

- **关联**：ARCH-1 §8 遗留、S3 §2.3/§9-C6、S4 §2.2（W2 衍生）
- **验收标准**：
  1. 清理死代码：`failure.js::_peak()`（未被调用，且含 `dvLoss: this.R_TOTAL ? 0 : 0` 的未定义引用）。删除或修复，二者择一记录在 ADR。
  2. **Q_SEP_SAFE 归属**：S3 GDD 称"阈值由 S3 拥有"，实现放在 `constants.FAIL`。写 ADR-005 记录**实现归属决定**（建议：留在 `constants`，但 `STAGE` 与 `FAIL` 的边界在 ADR 中说明，并让 staging 通过参数注入读取，而非硬编码）。
  3. `SEP_DELAY` 补入常量（见 E3/ST-3.3）。
  4. ADR-005 含：上下文 / 备选 / 决定 / 后果（含 S3 §9-C6 的 5→8 kPa 待裁决项）。
- **涉及文件**：新增 `docs/architecture/ADR/ADR-005-constant-ownership.md`；`src/core/failure.js`、`src/core/constants.js`
- **依赖**：ST-6.2
- **复杂度**：S
- **测试证据路径**：文档评审 + 四项验证全绿

---

## E6 完成判据

- control-manifest §3 零分配规则与 §4 唯一真值源规则**逐条复核通过**（建议在 `verify-prototype.mjs` 增加"常量引用扫描"断言）。
- 四项验证全绿且数值逐位不变（整改不改物理）。
