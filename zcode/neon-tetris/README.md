# NEON TETRIS — 完整规则版

霓虹风格俄罗斯方块，单文件实现，零依赖，零音频资源（Web Audio 全程序化合成）。

## 特性

- **SRS 踢墙**：标准 Super Rotation System，JLSTZ / I 独立踢墙表
- **T-Spin**：3 角规则判定，Full / Mini 区分，第 5 踢升级（TST）
- **DAS / ARR**：150ms 延迟自动横移 + 30ms 重复率
- **程序化音效**：移动、旋转、消行、T-Spin、升级等全套合成音效 + 程序化 Korobeiniki 背景音乐
- 7-Bag 随机、Hold 暂存、5 块 NEXT 预览、幽灵块 + 落点导引
- 500ms 锁定延迟（15 次重置上限）、官方重力公式
- B2B ×1.5、连击加分、Perfect Clear 检测
- 消行闪白、粒子、硬降残影、屏幕震动、堆顶预警
- 最高分本地持久化（localStorage）

## 操作

| 按键 | 功能 |
|---|---|
| ← → | 移动 |
| ↑ / X | 顺时针旋转 |
| Z | 逆时针旋转 |
| ↓ | 软降 |
| SPACE | 硬降 |
| C / Shift | Hold 暂存 |
| P / ESC | 暂停 |
| R | 重开 |
| M | 静音 |

## 运行

直接打开 `index.html`，或任意静态服务器托管即可。
