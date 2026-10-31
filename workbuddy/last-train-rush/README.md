# 末班快车 · LAST TRAIN RUSH

> **WorkBuddy + Step-5-Preview**

> CASE 02 · 3D 地铁跑酷 —— 赶末班地铁的程序员
> 提示词原文见 [`prompt.md`](./prompt.md)

3D 版地铁跑酷网页游戏。主角是一个背着电脑包赶末班地铁的程序员，在地铁轨道上躲避列车和路障、收集金币，越跑越快，在末班车离站前追上它。**零外部素材**，角色 / 场景 / 音效全部代码生成（Three.js r160 本地 vendor）。

**总耗时约 3 小时。**

## 运行

**方式一：开发版（ES module + importmap，必须走 HTTP）**

```bash
python -m http.server 8777 --bind 127.0.0.1 --directory .
# 打开 http://127.0.0.1:8777/index.html
```

**方式二：独立单文件（双击即开，file:// 兼容）**

`last-train-rush-standalone.html` —— esbuild IIFE 全内联产物，零外部请求。
重新打包：`node build-standalone.mjs`

## 操作

| 操作 | 键盘 | 触屏 |
|---|---|---|
| 换道 | ← → / A D | 左右滑动 / 底部按键 |
| 跳跃 | ↑ / W / 空格 | 上滑 / 跳跃键 |
| 翻滚 | ↓ / S | 下滑 / 翻滚键 |
| 暂停 | P / Esc | 右上角按钮 |
| 静音 | M | 右上角按钮 |
| 重开 | R（结算界面） | 按钮 |

空中按翻滚 = 下压落地接小翻滚。3 颗心，被撞后 1.6s 无敌闪烁。跑完 2600m 追上末班车即胜利。

## 架构

```
index.html                  入口 + HUD DOM + 样式（importmap）
src/
  main.js                   组装 / 游戏循环 / 阶段状态机 / 相机 / 测试钩子
  config.js                 全部手感数值（速度、跳跃、相机、配色）
  state.js                  全局状态 + 事件总线 + localStorage
  input.js                  键盘 / 滑动 / 屏幕按键
  character.js              程序化程序员角色（连帽衫+电脑包+耳机+工牌）与跑/跳/滚动画
  world.js                  夜空、轨道、灯柱、涂鸦墙、楼群、隧道（循环复用）
  train.js                  末班车 + 雾中辉光 + 站台 + 距离提示牌
  spawner.js                障碍/金币模式化生成 + 对象池 + AABB 碰撞
  player.js                 玩家物理：换道/跳跃/翻滚/受击/计分/胜负
  fx.js                     粒子、速度线、相机震动
  audio.js                  WebAudio 程序化音效 + 随速度加快的 BGM
  hud.js                    HUD 刷新与浮层
vendor/                     Three.js r160（本地化，不用 CDN）
tests/                      Playwright 冒烟 / 独立包验收
```

## 验证

```bash
node tests/smoke.mjs            # 双端冒烟：菜单/开局/换道/跳/滚/真碰撞扣血/吃金币/死亡/胜利 + 截图
node tests/standalone-check.mjs # 独立包：file:// 直开、零外部请求、单画布、可玩
```

截图输出到 `.workbuddy/verify/ltr-*.png`。
测试钩子：`window.__game`（snapshot / warp / debugHit / debugObstacle / debugCoins / debugSpeed）。

## 手感调参

所有数值集中在 `src/config.js`：初速/加速度/极速、跳跃重力、翻滚时长、换道时长、
相机位置与 FOV、目标距离、金币分值与擦身奖励。

⚠️ **车道方向约定**：追逐相机在玩家身后看向 +z，此取向下 **world +x 出现在屏幕左侧**
（相机 local +x = up × backward = world -x）。因此 `lanes: [2.3, 0, -2.3]`
即 lane 0 = 屏幕左、lane 2 = 屏幕右，按左键 → lane 0。改动前先用 `window.__game.project()`
投影验证 ndcX 符号，别凭直觉改。

⚠️ **相机侧倾只能用 `camera.rotateZ()`**（lookAt 之后逐帧全量施加）：相机偏航 180° 时
`lookAt` 的 Euler 分解 z=±π，若对 `camera.rotation.z` 做 lerp，会与分解打架把相机持续滚转
约 72°，整个世界在屏幕上歪掉、左右映射也跟着错乱（已踩）。
