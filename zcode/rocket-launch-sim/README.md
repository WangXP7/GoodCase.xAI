# AURORA-9 · Rocket Launch Simulator

复刻自「给 AI 一段火箭发射模拟器视频，要求：帮我复刻这个项目」案例中的 **AURORA-9 轨道插入模拟器**（见对比图右侧视频）。

单个 `index.html`，Three.js（CDN）+ WebGL，无构建步骤。

## 运行

- 直接双击 `index.html`（需联网加载 three.js CDN）；或
- 本地服务：`cd rocket-launch-sim && python -m http.server 8000`，打开 <http://localhost:8000>

## 流程

`INITIATE LAUNCH` → T-10 倒计时（T-3 塔架摆臂展开、T-2.8 点火）→ 升空 / LIFTOFF（清塔播报）→ MAX-Q → 一级关机 + 级间分离（助推器坠落回收画面）→ 二级点火 → ORBITAL INSERTION（入轨确认）。

## 操作

| 操作 | 说明 |
| --- | --- |
| 鼠标拖拽 | 环绕相机 |
| 滚轮 | 缩放 |
| 空闲 7 秒 | 自动环绕运镜 |
| `Space` / `R` | 发射 / 复位 |
| `?speed=3` | URL 参数加速任务流程（演示/调试用） |

声音为 WebAudio 合成（倒计时哔声 + 发动机低频轰鸣），`SND ON/OFF` 可静音。
