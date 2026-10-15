# 贾维斯 · 赛博朋克 HUD 控制台

> **WorkBuddy + DeepSeek-V4.1-Flash**

一块**纯前端单文件**的科幻主控界面：青蓝荧光配色的全屏 HUD，含系统状态、核心智能矩阵、
神经网络接口与终端日志四个面板，全部数据由 `requestAnimationFrame` 实时驱动，
零依赖、零外部资源，双击 `index.html` 即可运行。

## 界面构成

| 面板 | 内容 |
|---|---|
| System Status | 系统负载、能量、温度的实时仪表与波形 |
| Core Intelligence Matrix | 中央能量核心，环形脉冲与多层旋转刻环 |
| Neural Interface | 神经网络节点连线与同步率指示 |
| System Terminal | `root@jarvis:~` 终端，滚动输出模拟日志 |

外框为 16:9 自适应视口，适合大屏或副屏常驻展示。

## 实现要点

- **单文件零依赖**：CSS 变量集中管理全部配色（`--cyan` / `--danger` / `--success` 等），
  无 CDN、无字体、无图片；所有图形由 CSS 与 Canvas 现场绘制。
- **7 组 `@keyframes` + 2 处 `requestAnimationFrame`**：环形扫描、脉冲呼吸、数据滚动三类节奏分开跑，
  互不阻塞。
- 视口按 `16:9` 约束并居中黑边，避免不同屏幕比例下拉伸出错。

## 目录

```
jarvis-dashboard/
└── index.html          ← 交付物：单文件完整界面（约 44 KB）
```

## 运行

直接用浏览器打开 `index.html` 即可（`file://` 也能跑，无 ES Module 依赖）。

## 已知限制

- 数据为本地模拟，不接入任何真实系统状态。
- 未做移动端竖屏适配，面向大屏横屏场景。
