/**
 * mcp-server.js — MCP Server（游戏引擎桥）
 *
 * 两条通道：
 *   stdin/stdout  ← MCP 协议（JSON-RPC 2.0），Agent 侧
 *   ws://127.0.0.1:8787  ← WebSocket，浏览器游戏侧
 *
 * 这一层的设计完全对齐 UE5.8 的 UnrealMCP 插件：
 *   - 编辑器进程内起一个本地服务（UE 是 HTTP，我们是 WS）
 *   - 把引擎能力包装成"工具集"（UE 叫 Toolset，我们叫 tools）
 *   - Agent 只调工具，从不直接写代码
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebSocketServer } from 'ws';
import { z } from 'zod';
import { LevelStore, CHANGE } from './level-store.js';
import { ENV_PRESETS, PROP_TYPES, ENEMY_TYPES, PATTERNS } from '../game/src/level.js';

const WS_PORT = Number(process.env.MCP_WS_PORT || 8787);
const store = new LevelStore();

/* ================================================================== *
 *  WebSocket 侧：与浏览器通信
 * ================================================================== */

const wss = new WebSocketServer({ port: WS_PORT, host: '127.0.0.1' });
let gameSocket = null;
const pending = new Map(); // id -> {resolve, reject, timer}

function sendToGame(type, payload, id) {
  if (!gameSocket || gameSocket.readyState !== 1) return false;
  gameSocket.send(JSON.stringify({ type, payload, id, ts: Date.now() }));
  return true;
}

/** 发一个需要浏览器回包的请求 */
function requestGame(type, payload, timeout = 15000) {
  return new Promise((resolve, reject) => {
    if (!gameSocket || gameSocket.readyState !== 1) {
      reject(new Error('浏览器游戏未连接：请先在浏览器打开 http://127.0.0.1:8080 并点击开始'));
      return;
    }
    const id = `${type}#${Date.now()}`;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${type} 超时（${timeout}ms）`));
    }, timeout);
    pending.set(id, { resolve, reject, timer });
    sendToGame(type, payload, id);
  });
}

wss.on('connection', (ws) => {
  gameSocket = ws;
  console.error(`[bridge] 游戏已连接 · 推送当前关卡 rev ${store.level.meta.revision}`);
  sendToGame('level:full', { level: store.level });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const { type, payload, id: msgId } = msg;

    // 回包：浏览器可能把 id 放在顶层，也可能放在 payload 里
    const rid = msgId || (payload && payload.id);
    if (rid && pending.has(rid)) {
      const p = pending.get(rid);
      pending.delete(rid);
      clearTimeout(p.timer);
      p.resolve(payload);
      return;
    }
    if (type === 'hello') console.error('[bridge] 握手完成');
    if (type === 'telemetry') store.setTelemetry(payload);
  });

  ws.on('close', () => {
    if (gameSocket === ws) gameSocket = null;
    console.error('[bridge] 游戏已断开');
  });
});

// 状态变更 → 广播给浏览器
store.subscribe(({ level, kind, tool, detail }) => {
  const type = {
    [CHANGE.ENV]: 'level:env',
    [CHANGE.ACTORS]: 'level:actors',
    [CHANGE.GAMEPLAY]: 'level:gameplay',
    [CHANGE.FULL]: 'level:full',
  }[kind] || 'level:full';
  sendToGame(type, { level, tool, detail });
  console.error(`[tool] ${tool} → ${detail}`);
});

/* ================================================================== *
 *  MCP 侧：工具定义
 * ================================================================== */

const server = new McpServer({
  name: 'nexus-breach-engine',
  version: '1.0.0',
  description: '通过工具调用驱动一个 Three.js 第一人称射击游戏：环境美术 / 关卡搭建 / 玩法调参 / 自动试玩',
});

const ok = (data) => ({ content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] });
const fail = (msg) => ({ content: [{ type: 'text', text: `❌ ${msg}` }], isError: true });

/* ---- 1. 读取当前关卡 ---- */
server.tool(
  'get_level',
  '读取当前关卡清单（Scene Manifest）。返回环境参数、道具数量与明细、敌人配置、玩法数值。做任何修改前先调用它了解现状。',
  { includeProps: z.boolean().optional().describe('是否列出全部道具明细，默认 false 只给摘要') },
  async ({ includeProps }) => {
    const l = store.level;
    const byType = {};
    for (const p of l.props) byType[p.type] = (byType[p.type] || 0) + 1;
    const enemyByType = {};
    for (const s of l.spawns) enemyByType[s.type] = (enemyByType[s.type] || 0) + 1;
    return ok({
      meta: l.meta,
      environment: l.environment,
      actorSummary: { props: l.props.length, byType, enemies: l.spawns.length, enemyByType },
      gameplay: l.gameplay,
      playerStart: l.playerStart,
      props: includeProps ? l.props : undefined,
      connected: !!gameSocket,
    });
  },
);

/* ---- 2. 环境美术 ---- */
server.tool(
  'set_environment',
  `设定环境美术。可用预设：${Object.keys(ENV_PRESETS).join(' / ')}。
   传 preset 会整体套用该预设（天空/地面/雾/光照/曝光/泛光），再叠加你单独指定的字段。
   例：{preset:"night", fogDensity:0.03, sunIntensity:0.6}`,
  {
    preset: z.enum(Object.keys(ENV_PRESETS)).optional().describe('美术预设名，整体套用'),
    sunAzimuth: z.number().min(0).max(360).optional().describe('太阳方位角 0-360'),
    sunElevation: z.number().min(-10).max(89).optional().describe('太阳高度角，越低越像黄昏/日出'),
    sunIntensity: z.number().min(0).max(8).optional(),
    sunColor: z.string().optional().describe('#rrggbb'),
    fogDensity: z.number().min(0).max(0.08).optional().describe('指数雾浓度，0.005 通透 / 0.03 浓雾'),
    fogColor: z.string().optional(),
    skyTop: z.string().optional(),
    skyHorizon: z.string().optional(),
    groundColor: z.string().optional(),
    groundAccent: z.string().optional().describe('地面网格线颜色'),
    ambientIntensity: z.number().min(0).max(4).optional(),
    ambientColor: z.string().optional(),
    exposure: z.number().min(0.2).max(3).optional().describe('色调映射曝光'),
    bloom: z.number().min(0).max(3).optional().describe('泛光强度，夜景/霓虹调高'),
    arenaSize: z.number().min(40).max(200).optional(),
  },
  async (args) => ok(store.setEnvironment(args)),
);

/* ---- 3. 摆放道具 ---- */
server.tool(
  'place_props',
  `摆放场景道具。两种用法：
   A) 精确坐标：{props:[{type:"container", position:[-14,1.3,-18], rotation:[0,0.3,0], color:"#6b4a2f"}]}
   B) 布局模式：{type:"container", pattern:"ring", count:10, radius:24, faceCenter:true}
      可用 pattern: ${PATTERNS.join(' / ')}；faceCenter 让道具朝向场地中心。
   可用道具类型：${Object.keys(PROP_TYPES).join(' / ')}`,
  {
    props: z.array(z.object({
      id: z.string().optional(),
      type: z.string(),
      position: z.array(z.number()).length(3),
      rotation: z.array(z.number()).length(3).optional(),
      scale: z.array(z.number()).length(3).optional(),
      color: z.string().optional(),
    })).optional(),
    type: z.string().optional(),
    pattern: z.enum(PATTERNS).optional(),
    count: z.number().int().min(1).max(200).optional(),
    center: z.array(z.number()).length(2).optional(),
    radius: z.number().optional(),
    spacing: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    arcStart: z.number().optional(),
    arcEnd: z.number().optional(),
    y: z.number().optional(),
    rotationY: z.number().optional(),
    faceCenter: z.boolean().optional(),
    scale: z.array(z.number()).length(3).optional(),
    color: z.string().optional(),
    colors: z.array(z.string()).optional().describe('多种颜色轮流分配'),
    seed: z.number().optional(),
    jitter: z.number().optional().describe('随机抖动量（米），让布局不那么规整'),
  },
  async (args) => ok(store.placeProps(args)),
);

/* ---- 4. 删除道具 ---- */
server.tool(
  'remove_props',
  '删除道具。可按 id 列表精确删除，或按 type 批量删除某类。',
  {
    ids: z.array(z.string()).optional().describe('要删除的道具 id 列表'),
    type: z.string().optional().describe('按类型批量删除，如 "crate"'),
  },
  async (args) => ok(store.removeProps(args)),
);

/* ---- 5. 布置敌人 ---- */
server.tool(
  'spawn_enemies',
  `布置敌人。可用类型：${Object.keys(ENEMY_TYPES).join(' / ')}
   （grunt 步兵 / rusher 近战突击 / sniper 远程高伤 / tank 高血量重甲）
   用法同 place_props：给 enemies 数组指定精确坐标，或用 pattern 批量生成。
   例：{pattern:"ring", count:8, radius:34, types:["grunt","rusher","sniper"]}`,
  {
    enemies: z.array(z.object({
      id: z.string().optional(),
      type: z.string(),
      position: z.array(z.number()).length(3),
      patrol: z.array(z.array(z.number()).length(2)).optional(),
    })).optional(),
    type: z.string().optional(),
    types: z.array(z.string()).optional().describe('多种类型轮流分配'),
    pattern: z.enum(PATTERNS).optional(),
    count: z.number().int().min(1).max(120).optional(),
    center: z.array(z.number()).length(2).optional(),
    radius: z.number().optional(),
    spacing: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    seed: z.number().optional(),
    jitter: z.number().optional(),
  },
  async (args) => ok(store.spawnEnemies(args)),
);

/* ---- 6. 清空 ---- */
server.tool(
  'clear_actors',
  '清空场上所有道具和/或敌人。通常在重新搭建关卡前调用。',
  {
    props: z.boolean().optional().describe('是否清空道具，默认 true'),
    enemies: z.boolean().optional().describe('是否清空敌人，默认 true'),
  },
  async (args) => ok(store.clearActors(args)),
);

/* ---- 7. 玩法数值 ---- */
server.tool(
  'set_gameplay',
  `调整玩法数值 —— 这是"手感调校"的核心工具。
   player: maxHealth / moveSpeed / sprintMultiplier / jumpVelocity / damage / fireRate / magazine / reloadTime / spread / range / headshotMultiplier
   enemies: globalHealthScale / globalSpeedScale / globalDamageScale / visionRange / aggression(0-1)
   waves: enabled / count / perWaveBase / perWaveGrowth / healthScalePerWave / delay`,
  {
    player: z.object({
      maxHealth: z.number().min(10).max(1000).optional(),
      moveSpeed: z.number().min(1).max(25).optional(),
      sprintMultiplier: z.number().min(1).max(3).optional(),
      jumpVelocity: z.number().min(0).max(20).optional(),
      damage: z.number().min(1).max(500).optional(),
      fireRate: z.number().min(0.02).max(2).optional().describe('射击间隔秒数，越小越快'),
      magazine: z.number().int().min(1).max(200).optional(),
      reloadTime: z.number().min(0.1).max(6).optional(),
      spread: z.number().min(0).max(0.3).optional(),
      range: z.number().min(10).max(500).optional(),
      headshotMultiplier: z.number().min(1).max(10).optional(),
    }).optional(),
    enemies: z.object({
      globalHealthScale: z.number().min(0.1).max(10).optional(),
      globalSpeedScale: z.number().min(0.1).max(5).optional(),
      globalDamageScale: z.number().min(0).max(10).optional(),
      visionRange: z.number().min(5).max(200).optional(),
      aggression: z.number().min(0).max(1).optional().describe('越高开火越频繁'),
    }).optional(),
    waves: z.object({
      enabled: z.boolean().optional(),
      count: z.number().int().min(1).max(20).optional(),
      perWaveBase: z.number().int().min(1).max(40).optional(),
      perWaveGrowth: z.number().int().min(0).max(20).optional(),
      healthScalePerWave: z.number().min(1).max(3).optional(),
      delay: z.number().min(0.5).max(20).optional(),
    }).optional(),
  },
  async (args) => ok(store.setGameplay(args)),
);

/* ---- 8. 一句话生成完整关卡 ---- */
server.tool(
  'build_arena',
  `一键生成完整可玩关卡 —— 环境美术 + 掩体布局 + 敌人配置 + 玩法数值，一次调用全部搞定。
   style: industrial 工业港区 / military 军事基地 / ruins 废墟遗迹 / outpost 前哨站 / forest 林地
   preset: ${Object.keys(ENV_PRESETS).join(' / ')}
   density 控制掩体密度(0.4-2.2)，difficulty 控制敌人强度与波次(0.5-3)。`,
  {
    preset: z.enum(Object.keys(ENV_PRESETS)).optional().describe('美术预设，默认 dusk'),
    style: z.enum(['industrial', 'military', 'ruins', 'outpost', 'forest']).optional().describe('关卡风格，默认 industrial'),
    density: z.number().min(0.4).max(2.2).optional().describe('掩体与细节密度，默认 1'),
    difficulty: z.number().min(0.5).max(3).optional().describe('难度，影响敌人数量/配比/数值缩放，默认 1'),
    seed: z.number().optional(),
  },
  async (args) => ok(store.buildArena(args)),
);

/* ---- 9. 截图 ---- */
server.tool(
  'capture_viewport',
  '截取当前游戏画面并返回 JPEG（base64）。用于验证美术效果是否达到预期 —— 相当于给 AI 装上"眼睛"。',
  { quality: z.number().min(0.2).max(0.95).optional().describe('JPEG 质量，默认 0.72') },
  async ({ quality }) => {
    try {
      const r = await requestGame('capture', { quality }, 20000);
      if (!r || r.ok === false) return fail(`浏览器渲染失败：${r?.error || '未知错误'}`);
      if (!r.image) return fail('浏览器返回了空画面');
      return {
        content: [
          { type: 'text', text: JSON.stringify({ width: r.width, height: r.height, capturedAt: new Date().toISOString() }) },
          { type: 'image', data: r.image.split(',')[1], mimeType: 'image/jpeg' },
        ],
      };
    } catch (e) { return fail(e.message); }
  },
);

/* ---- 10. 设定机位 ---- */
server.tool(
  'set_viewpoint',
  `设定观察机位 —— 相当于 UE5 MCP 里的 viewport camera 控制。
   spectate:true 进入自由视角（无重力/无碰撞），可以飞到任意高度取景；false 回到第一人称在地面行走。
   典型用法：先 set_viewpoint 飞到高处俯视，再 capture_viewport 截图检查整体布局是否合理。
   弧度参考：yaw 0=朝 +Z，PI/2=朝 +X，PI=朝 -Z，-PI/2=朝 -X。pitch 正数抬头。
   例：{position:[0,45,60], yaw:3.14, pitch:-0.6, spectate:true, fov:70}`,
  {
    position: z.array(z.number()).length(3).optional().describe('[x,y,z] 机位坐标'),
    yaw: z.number().optional().describe('水平朝向，弧度'),
    pitch: z.number().min(-1.55).max(1.55).optional().describe('俯仰角，弧度，正数抬头'),
    fov: z.number().min(20).max(120).optional().describe('视场角，默认 75；60 更聚焦，90 更广'),
    spectate: z.boolean().optional().describe('true=自由视角（悬浮取景），false=第一人称行走'),
  },
  async (args) => {
    try {
      const r = await requestGame('viewpoint', args);
      if (!r.ok) return fail(r.reason || '设定机位失败');
      return ok(r);
    } catch (e) { return fail(e.message); }
  },
);

/* ---- 11. 启动 / 暂停模拟 ---- */
server.tool(
  'start_simulation',
  `启动游戏模拟（对应 UE5 MCP 的 start_play_in_editor）。只有启动后物理、AI、波次才会推进。
   编辑器打开时默认处于"暂停"状态，所以 Agent 在截图或自动试玩前必须先调用它。`,
  {},
  async () => {
    try {
      const r = await requestGame('sim:start', {});
      return ok({ ...r, note: r.running ? '模拟已运行' : '启动失败' });
    } catch (e) { return fail(e.message); }
  },
);
server.tool(
  'stop_simulation',
  '暂停游戏模拟（对应 UE5 MCP 的 stop_play_in_editor）。暂停后场景保持静止，便于稳定截取美术图。',
  {},
  async () => {
    try {
      const r = await requestGame('sim:stop', {});
      return ok({ ...r, note: r.running ? '仍在运行' : '已暂停' });
    } catch (e) { return fail(e.message); }
  },
);

/* ---- 12. 自动试玩 ---- */
server.tool(
  'run_playtest',
  `让内置机器人自动试玩若干秒并回报指标：平均帧率、击杀数、命中率、造成伤害、承受伤害、剩余血量、是否阵亡。
   这是验证"玩法是否成立"的关键工具 —— 调完数值跑一次，用数据判断难度是否合适。`,
  { seconds: z.number().min(2).max(60).optional().describe('试玩时长秒数，默认 8') },
  async ({ seconds }) => {
    try {
      const r = await requestGame('playtest', { seconds: seconds ?? 8 }, (seconds ?? 8) * 1000 + 15000);
      const verdict = r.playerDied ? '机器人在试玩中阵亡 → 难度偏高' : r.hpRemaining < 40 ? '残血存活 → 难度偏高' : r.accuracy < 25 ? '命中率过低 → 敌人机动性偏高' : '数值健康';
      return ok({ ...r, verdict });
    } catch (e) { return fail(e.message); }
  },
);

/* ---- 13. 遥测 ---- */
server.tool(
  'get_telemetry',
  '读取游戏实时运行状态：帧率、波次、剩余敌人、分数、玩家血量弹药、位置、关卡版本号。',
  {},
  async () => {
    const t = store.getTelemetry();
    if (!t) return ok({ connected: !!gameSocket, message: gameSocket ? '等待首帧遥测（1 秒刷新一次）' : '浏览器未连接' });
    return ok({ ...t, connected: true });
  },
);

/* ---- 14. 撤销 / 重做 ---- */
server.tool('undo', '撤销上一步关卡修改（保留最近 60 步历史）。', {}, async () => ok(store.undo()));
server.tool('redo', '重做被撤销的修改。', {}, async () => ok(store.redo()));

/* ---- 15. 存盘 / 读档 ---- */
server.tool(
  'save_level', '把当前关卡存成 JSON 文件，落盘到 levels/ 目录。',
  { name: z.string().optional().describe('文件名，默认用关卡名') },
  async ({ name }) => ok(store.save(name)),
);
server.tool(
  'load_level', '从 levels/ 目录载入已保存的关卡。',
  { name: z.string() },
  async ({ name }) => ok(store.load(name)),
);

/* ---- 16. 能力自述 ---- */
server.tool(
  'list_capabilities',
  '列出本引擎桥的全部可用参数枚举（预设、道具类型、敌人类型、布局模式），用于确认该填什么值。',
  {},
  async () => ok({
    envPresets: Object.keys(ENV_PRESETS),
    propTypes: Object.fromEntries(Object.entries(PROP_TYPES).map(([k, v]) => [k, `${v.label} · 占地${v.footprint.join('x')}`])),
    enemyTypes: Object.fromEntries(Object.entries(ENEMY_TYPES).map(([k, v]) => [k, `${v.label} · HP${v.health} 速度${v.speed} 伤害${v.damage} 射程${v.range}`])),
    patterns: PATTERNS,
    arenaStyles: ['industrial', 'military', 'ruins', 'outpost', 'forest'],
  }),
);

/* ================================================================== *
 *  启动
 * ================================================================== */

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[mcp] nexus-breach-engine 已启动 · WS 桥 ws://127.0.0.1:${WS_PORT}`);
