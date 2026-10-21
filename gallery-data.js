/* Gallery presentation metadata. gallery.json remains the only case registry. */
(function () {
  'use strict';
  const edits = {};
  function set(key, title, tags, desc) { edits[key] = {title, tags:tags.split('|'), ...(desc ? {desc} : {})}; }
  set('trae/index.html','极光九号 · 轨道发射 LC-12','模拟仿真|航天');
  set('trae/glsl-poster','轨道核心 · 霓虹海报','视觉艺术|WebGL / GLSL');
  set('workbuddy/buckshot-roulette','恶魔轮盘 · 初版','游戏|策略博弈');
  set('workbuddy/buckshot-roulette-v2','恶魔轮盘 · 第二版','游戏|策略博弈');
  set('workbuddy/deepseek-ai-search','灵犀搜索 · AI 搜索引擎','工具面板|文档研究');
  set('workbuddy/eaves','檐下 · UNDER THE EAVES','游戏|经营养成|3D','以微缩小屋和猫咪日常为主题的三维陪伴游戏。等距视角、暖色家居氛围与猫咪角色，配套完整的玩法、美术及技术设计资料。');
  set('workbuddy/diorama-winter','冬日微缩 · 折纸暖屋','建模|3D|Blender|视觉艺术');
  set('workbuddy/emberfall-rpg','余烬深渊 · 球形开放世界','游戏|动作冒险|3D|Three.js');
  set('workbuddy/gummy-bears','软糖熊 · 可抓起软体糖果','游戏|物理实验|3D|Three.js');
  set('workbuddy/hy4-mcp-shooter','裂隙突围 · MCP 射击场','游戏|动作冒险|3D|Three.js');
  set('workbuddy/jarvis-dashboard','贾维斯 · 赛博主控台','工具面板|视觉艺术');
  set('workbuddy/koi-pond','锦鲤池 · 倒影与鱼群','视觉艺术|3D|Three.js|游戏');
  set('workbuddy/lunar-rover','月面运输 · 低重力货运','游戏|模拟仿真|航天|3D|Three.js');
  set('workbuddy/minecraft-clone','方块世界 · 自由探索','游戏|3D|WebGL / GLSL');
  set('workbuddy/minimax-m31-flash-promo','瞬光 · M3.1 Flash 宣传片','视觉艺术','40 秒程序化产品宣传片：单文件 Canvas2D 按确定性时间轴逐帧绘制，六幕结构配程序化合成配乐，零外部素材。制作耗时约 70 分钟。');
  set('workbuddy/pelican-bicycle','鹈鹕骑行 · 动态展示','视觉艺术');
  set('workbuddy/pelican-bicycle-3d','鹈鹕骑行 · 三维版','视觉艺术|3D');
  set('workbuddy/pelican-bicycle-3d-standalone.html','鹈鹕骑行 · 三维独立版','视觉艺术|3D');
  set('workbuddy/procedural-city-cn','3D 程序化城市生成器 · 中国版','工具面板|3D|Three.js|视觉艺术');
  set('workbuddy/penguin-survival','企鹅生存 · 冰原漂流','游戏|动作冒险|3D|Three.js');
  set('workbuddy/rocket-launch-sim','火箭发射 · 模拟原型','模拟仿真|航天');
  set('workbuddy/snake-survivors','蛇人幸存者 · 黑暗废墟','游戏|动作冒险');
  set('workbuddy/solar-system','太阳系 · 八大行星','科普教育|航天|3D|Three.js');
  set('workbuddy/song-courtyard','宋代庭院 · 五路院落','建模|3D|Blender|国风历史');
  set('workbuddy/temple-of-heaven','天坛祈年殿 · 三重檐琉璃大殿','视觉艺术|3D|国风历史');
  set('workbuddy/tideline','潮线 · TIDELINE','游戏|动作冒险|策略博弈','横版鲨鱼街机：冲向海岸、冲浪收集，再带着战利品返回深海。围绕“落袋为安或继续冒险”展开，包含冲刺、搁浅 QTE 与警报系统；测试版 v0.1.0。');
  set('workbuddy/tidewater-fish-site','潮水 · Tidewater 渔业场景','3D|视觉艺术');
  set('workbuddy/token-dashboard','Token 用量 · 分析仪表盘','工具面板|文档研究','WorkBuddy 用量分析工具：Token KPI、日活热力图、模型分布与工作区→会话→请求三级下钻。含 Python 生成脚本和示例图；此入口为说明文档，实际看板需在本机生成。');
  set('workbuddy/train-bridge-collapse','断裂桥梁 · 列车坠水','模拟仿真|物理实验');
  set('workbuddy/vintage-slr-camera','复古单反 · 胶片年代','建模|3D|Blender|视觉艺术');
  set('zcode/aurora-ocean.html','极光海洋 · 原生着色器','视觉艺术|WebGL / GLSL');
  set('zcode/cat-pet-console','猫咪掌机 · NEKO PAL','游戏|工具面板');
  set('zcode/neon-hex-physics','霓虹六边形 · 物理沙盒','模拟仿真|物理实验');
  set('zcode/neon-tetris','霓虹俄罗斯方块','游戏|策略博弈');
  set('zcode/rocket-launch-sim','极光九号 · 轨道发射 LC-17','模拟仿真|航天');
  set('zcode/shark-arcade','大鲨鱼 · 复古街机','游戏|动作冒险');
  set('zcode/T1密室3D游戏开发33m-74m-61m','三重密室 · 立体逃脱','游戏|动作冒险|3D');
  set('zcode/T2最新政策SI京都愿景调查54m-12m-7m17s','京都愿景 · AI 改名 SI 事实核查','文档研究','围绕“AI 改名 SI”与京都愿景相关说法的调查报告。保留原文的资料引用、论证与事实核查，以排版后的文档形式阅读。');
  set('zcode/T3诺奖化学科普GPT5.6Sol-65min-Sonnet5.5-12min-GLM5.3F-55min','诺奖化学 · 手性放大实验台','科普教育|文档研究','手性放大交互实验台，配套资料来源、科普解读、科学家贡献辨析及五页演示提纲。可在案例浏览页切换实验与文档。');
  set('zcode/WebGL2-原生GLSL技术详解.md','WebGL2 与原生 GLSL · 技术详解','文档研究|WebGL / GLSL','原生 WebGL2 与 GLSL 技术说明。以文档阅读模式展示标题、代码、列表和表格，支持打开原始文档。');
  set('zcode/YiQiVibe-WBGL2-GLSL-ocean-ZG5.3F','极光海洋 · 共创版','视觉艺术|WebGL / GLSL');
  set('zcode/YiQiVibe-WBGL2-GLSL-ocean-ZG5.3F-perf','极光海洋 · 性能优化版','视觉艺术|WebGL / GLSL');
  set('zcode/路人甲TM1鹈鹕骑自行车3D版','澳洲鹈鹕 · 海边骑行','视觉艺术|3D|Three.js');
  set('zcode/路人甲TM2星际水族箱','星际水族箱 · 透明生态','模拟仿真|3D');
  set('zcode/路人甲TM3平面后室游戏','档案层 B4 · 后室逃生','游戏|动作冒险');
  set('codex/air-court','空间篮球 · AIR COURT','游戏|体育竞速|3D|Three.js');
  set('codex/2066-world-cup','2066 · 决战世界杯','游戏|体育竞速|3D|Three.js|物理实验');
  set('codex/astra-cockpit-hud','深空驾驶舱 · ASTRA','工具面板|航天|模拟仿真');
  set('codex/attention-residuals','注意力残差 · 深度调音台','科普教育|工具面板');
  set('codex/eggstreme-farming','极蛋农场 · 增量养成','游戏|经营养成|3D');
  set('codex/eve-idle','星门纪元 · 深空放置','游戏|经营养成|航天');
  set('codex/hanmo-qingyun','汉末青云 · 仕途人生','游戏|文字叙事|国风历史');
  set('codex/honghe-qingyun','红河青云 · 人生晋升','游戏|文字叙事');
  set('codex/ink-trace','墨迹 · 汉字书法工作台','工具面板|科普教育|国风历史');
  set('codex/lmcc-2026-round2','LMCC 三题学习站 · 题解与编程速学','科普教育|工具面板');
  set('codex/jarvis','贾维斯 · Windows 动态视觉','工具面板|视觉艺术');
  set('codex/mb-enclosure','MB 围城 · 生存抉择','游戏|文字叙事');
  set('codex/mimic','潜色行动 · 伪装捉迷藏','游戏|动作冒险');
  set('codex/moment-instant-camera','即刻 · 互动拍立得','工具面板|3D|WebGL / GLSL');
  set('codex/night-street','黄金时刻 · 城市漫游','3D|视觉艺术');
  set('codex/niulai-dream-run','牛来 · 梦野逐风','游戏|动作冒险|3D');
  set('codex/pixel-armored-soldier','三灯铆卫 · 像素帧动画','视觉艺术');
  set('codex/serpent-survivor','蛇裔 · 余烬圣所','游戏|动作冒险');
  set('codex/three-kingdoms-gilded','三国人物关系图 · 鎏金长卷','国风历史|知识图谱|视觉艺术');
  set('codex/wallfacer-plan','面壁计划 · 文明抉择','游戏|文字叙事');
  set('codex/wanming-xianzhi','晚明县志 · 叙事治理','游戏|文字叙事|国风历史');
  set('codex/woolly-debts','羊债必须清 · 砸罐还债','游戏|经营养成|3D');
  const covers = {
    'workbuddy/diorama-winter':'shots/iter-13-final.png',
    'workbuddy/gummy-bears':'shots/01-pile.jpg',
    'workbuddy/song-courtyard':'shots/iter-13-final.png',
    'workbuddy/minimax-m31-flash-promo':'shots/02-identity.jpg',
    'workbuddy/tideline':'tests/_shots-public/04-title-final.png'
  };
  const unknown = '模型未记录';
  function normalize(manifest) {
    const seen = new Set();
    return manifest.entries.filter(e=>!e._hidden).map(e=>{
      const key = e.ns+'/'+(e.dir==='.'?e.entry:e.dir);
      const path = e.ns+'/'+(e.dir==='.'?'':e.dir+'/')+e.entry;
      if(seen.has(path)) throw Error('重复案例入口：'+path);
      seen.add(path);
      const agent = (e.agent||e.ns).split(/\s*\+\s*/)[0];
      const recorded = (e.agent||'').split(/\s*\+\s*/).slice(1).join(' + ');
      const models = !recorded || /未记录/.test(recorded) ? [unknown] : [...new Set(recorded.split(/\s*\/\s*/))];
      const meta = edits[key]||{};
      let resources = [{label:/\.md$/i.test(path)?'阅读文档':'打开案例',path}];
      if(key.includes('T3诺奖化学')) resources = [
        {label:'交互实验',path:key+'/手性放大实验台.html'},
        {label:'资料与事实核查',path},
        {label:'科普解读',path:key+'/01-科普解读.md'},
        {label:'贡献辨析',path:key+'/02-Kagan与Soai贡献辨析.md'},
        {label:'演示提纲',path:key+'/04-演示文稿提纲-五页.md'}
      ];
      const tags = [...new Set(meta.tags||e.tags||['其他作品'])];
      return {id:path,key,path,title:meta.title||e.title.replace(/\s*\+\d+ 页$/,''),
        desc:meta.desc||e.desc,agent,models,credit:agent+' + '+models.join(' / '),
        tags,resources,format:resources.some(r=>/\.md$/i.test(r.path))?(resources.length>1?'交互 + 文档':'文档阅读'):'网页体验',
        cover:covers[key]?key+'/'+covers[key]:null,
        combo:agent+' + '+models.join(' / ')};
    });
  }
  function values(e,dim) { return dim==='agent'?[e.agent]:dim==='model'?e.models:dim==='combo'?[e.combo]:dim==='format'?[e.format]:e.tags; }
  function counts(entries,dim){const out={};for(const e of entries)for(const v of new Set(values(e,dim)))out[v]=(out[v]||0)+1;return out;}
  window.GalleryData={normalize,values,counts,unknown};
})();
