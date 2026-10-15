# 太阳系八大行星 · 3D 交互模型

> **WorkBuddy + DeepSeek-V4.1-Flash**

一套 **9 个页面的太阳系三维交互模型**：一个总览页 + 八颗行星各自的详情页。
每页独立可开，`index.html` 是入口。

## 页面

| 文件 | 内容 |
|---|---|
| `index.html` | 总览：太阳系全景、轨道示意与八颗行星的入口 |
| `mercury.html` | 水星 |
| `venus.html` | 金星 |
| `earth.html` | 地球 |
| `mars.html` | 火星 |
| `jupiter.html` | 木星 |
| `saturn.html` | 土星 |
| `uranus.html` | 天王星 |
| `neptune.html` | 海王星 |

各行星页之间通过顶部/底部导航互相跳转，也可一键返回总览。

## 实现要点

- **Three.js r160**，通过 importmap 从 `cdn.jsdelivr.net` 加载 `three` 与 `three/addons/`。
- **全程序化几何**：球体、光环与轨道线均由代码生成，不依赖任何贴图或模型文件。
- 每页自包含（HTML + CSS + 内联 ES Module），可单独复制走使用。

## 目录

```
solar-system/
├── index.html          ← 入口：太阳系总览
├── mercury.html  venus.html  earth.html  mars.html
├── jupiter.html  saturn.html  uranus.html  neptune.html
└── README.md
```

## 运行

需要经 HTTP 打开（ES Module + importmap 在 `file://` 下会被 CORS 拦截）：

```bash
cd solar-system
python -m http.server 8000     # 浏览器访问 http://127.0.0.1:8000/
```

## 已知限制

- 依赖 jsDelivr CDN 拉取 Three.js，首次打开需要联网。
- 行星自转/公转比例经过视觉化压缩，不是真实天文比例。
