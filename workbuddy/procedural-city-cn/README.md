# 3D 程序化城市生成器 · 中国版

> **WorkBuddy + Step-5-Preview**

对标 OpenAI 官方 Showcase Procedural City Generator 的中国版程序化 3D 城市生成器：
六座城市实时切换——南京（重点，27 处地标全落地）、8D 魔幻重庆、上海陆家嘴、古都西安、
赛博深圳、江南水乡。切换风格后建筑形态、色调与地形差异一眼可辨；全部几何体与贴图
（Canvas 程序化绘制）均在运行时生成，零外部素材，Three.js 本地 vendor 离线可用。

**总耗时约 1 小时 30 分钟。**

## 城市预设

| 城市 | 识别符号 |
| --- | --- |
| 南京（默认） | 紫峰大厦、明城墙与中华门瓮城、中山陵 392 级台阶、夫子庙与秦淮画舫、玄武湖五洲、鸡鸣寺金顶、阅江楼、南京长江大桥、南京眼、新街口、金陵饭店、大报恩寺琉璃塔、牛首山佛顶宫、梧桐大道 |
| 重庆 | 叠叠立高差、轻轨穿楼、依山而建 |
| 上海 | 陆家嘴天际线、玻璃幕墙金融城 |
| 西安 | 古都格局、灰砖城墙与钟楼气质 |
| 深圳 | 赛博霓虹、密集塔楼群 |
| 江南水乡 | 小桥流水、粉墙黛瓦、密布水网 |

## 交互

| 操作 | 方式 |
| --- | --- |
| 旋转 / 缩放 | 拖拽 / 滚轮 · 触屏双指 |
| 城市切换 | 左侧城市页签（六城） |
| 种子 | 输入框 + 随机按钮，同种子同城形 |
| 时段 | 晨 / 午 / 昏 / 夜四档光照实时切换 |
| 密度 | 滑杆 60–150 实时重建 |
| 街景交通 / 烟雨迷雾 / 自动巡游 | 开关实时生效 |

右上角实时显示 FPS、楼宇、地标、植被计数。桌面 / 移动端（390px 起）自适应。

## 运行方式

单页应用 + importmap 加载本地 vendor Three.js r172，双击 `index.html` 或任意静态
服务器均可；亦可从画廊案例查看器（`case.html`）进入，iframe 内完整运行。

## 验证

`node --check` 全量 JS 通过；Playwright 冒烟（`.workbuddy/verify/citygen-smoke.mjs`）：
逐城切换、种子、时段、移动端视口全绿，无 pageerror / console error，画布按视口尺寸，
南京 / 重庆 / 上海 / 西安 / 深圳 / 江南 + 移动端共 10 张截图人工判读。

## 文件结构

```
procedural-city-cn/
├── index.html            页面骨架 + UI + importmap
├── prompt.md             提示词原文（截图转录）
├── src/
│   ├── engine.js         CityBuilder：合并几何 / 实例化 / 地面画布 / 水天 shader / 时段光照
│   ├── main.js           启动、城市页签、参数绑定
│   ├── lib/              roofs / towers / heritage / infra 参数化地标库
│   └── cities/           六城合成（nanjing / chongqing / shanghai / xian / shenzhen / jiangnan）
└── vendor/three/         Three.js r172 本地副本（离线可用）
```
