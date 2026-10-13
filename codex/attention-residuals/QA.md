# 验收报告

## 1. 结论

`index.html` 已通过本地浏览器交互、响应式布局、键盘操作、控制台错误与离线依赖检查。

- 单文件体积：约 76 KB，低于 500 KB 目标；
- 外部运行资源：0；
- `fetch` / XHR / WebSocket：0；
- Playwright 验收中的控制台 error / warning：0；
- Attention Residuals 示意权重：初始化、切换情境、调整层数和手动修改后均精确合计 `100%`；
- `360 × 800`、`390 × 844`、`768 × 1024`、`1440 × 900`：均无横向溢出。

## 2. 研究与 API 核验

### Firecrawl

当前会话未提供可调用的 Firecrawl 连接器。经工具检索确认后，没有伪造 Firecrawl 调用记录，而是改用网页检索直接核对以下一手来源：

- Attention Residuals 原论文：<https://arxiv.org/abs/2603.15031>
- MoonshotAI 官方 Attention-Residuals 仓库：<https://github.com/MoonshotAI/Attention-Residuals>
- Moonshot AI Kimi K3 官方博客：<https://www.kimi.com/blog/kimi-k3>
- MoonshotAI Kimi-K3 官方仓库：<https://github.com/MoonshotAI/Kimi-K3>
- vLLM 与 Moonshot / Inferact 的 K3 实现说明：<https://vllm-project.github.io/2026/07/27/k3.html>

核验后移除了旧版本中“训练提速 25%”“信息不会丢失”等过度表述，改为论文范围内的机制、量级和实验结论。

### Context7

Context7 实际查询了：

- Playwright `/microsoft/playwright@v1.61.0`；
- Node.js `/nodejs/node/v22.17.0`；
- MDN Web APIs `/mdn/content`。

实现与测试据此使用语义定位、视口检查、截图、控制台检查和 Node.js URL 处理原则；产品代码本身没有引入第三方库。

## 3. Playwright 自动验收

浏览器自动化安全策略不允许工具导航到 `file://`。因此：

1. 交互与视觉测试通过仅绑定 `127.0.0.1` 的临时静态地址完成；
2. 另行对 `index.html` 做外部资源与网络 API 静态扫描；
3. 最终产物仍是无需服务器的单个 HTML。

没有绕过浏览器策略，也没有把本地测试地址发布到互联网。

### 功能结果

| 检查项 | 操作 | 结果 |
|---|---|---|
| 情境切换 | `事实召回` → `多步推理` → `回看约束` | 文案与确定性权重同步变化 |
| 固定残差 | 检查左栏 4–8 层 | 每一路始终为 `1×` |
| 归一化 | 切换情境与层数 | 右栏权重始终合计 `100%` |
| 手动权重 | 选择“第 2 层输出”，调整到 `45%` | 得到 `10 + 11 + 45 + 12 + 9 + 13 = 100` |
| 深度范围 | 由 `L6` 调到 `L8` | 两栏均生成 8 路，右栏合计 `100%` |
| 动画 | 播放、暂停、单步 | 状态与进度同步更新 |
| 注意力轴 | token → depth | 标题、方向、节点与问题句同步变化 |
| Block | 1、3、4 层/块 | 分别生成 12、4、3 个块 |
| 键盘 | Enter 切换按钮、方向键调整滑杆 | 状态正确更新 |
| 控制台 | 完成上述操作后检查 | 无 error / warning |

### 响应式结果

| 视口 | 布局结果 | 横向溢出 |
|---|---|---|
| `1440 × 900` | 首屏双栏、实验双栏、导航完整 | 无 |
| `768 × 1024` | 首屏上下、实验双栏、工具栏两列 | 无 |
| `390 × 844` | 单列首屏、实验上下、导航折叠 | 无 |
| `360 × 800` | 主按钮满宽、内容保持单列 | 无 |

### 可访问性结果

- 所有可见按钮、滑杆、链接和摘要控件均有可访问名称；
- `390 × 844` 下 29 个可见交互目标均不小于 `44 × 44px`；
- 按钮支持 `Enter` / `Space`；
- 滑杆支持方向键；
- 焦点轮廓可见；
- 动态变化使用节制的 `aria-live`；
- `prefers-reduced-motion` 下关闭连续运动与滚动缓动。

## 4. 离线静态检查

扫描项均为 0：

- `<script src="…">`
- `<link href="…">`
- `<img src="…">` / `<video>` / `<audio>` / `<source>`
- `fetch()`
- `XMLHttpRequest`
- `WebSocket`
- CSS `@import`
- 远程 `url(http…)`
- 外部 ES Module 导入

页面中的 `https://` 只出现在“资料来源”的普通链接中，仅在用户主动点击后访问。

## 5. 截图

- `artifacts/desktop-1440x900.png`：桌面首屏；
- `artifacts/experiment-manual.png`：手动权重归一化；
- `artifacts/depth-axis.png`：沿深度的注意力；
- `artifacts/block-attnres.png`：Block AttnRes；
- `artifacts/tablet-768x1024.png`：平板首屏；
- `artifacts/tablet-experiment.png`：平板实验区；
- `artifacts/mobile-390x844.png`：手机首屏；
- `artifacts/mobile-experiment.png`：手机实验区。
