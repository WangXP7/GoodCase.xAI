/**
 * level.js — Scene Manifest（场景清单）
 *
 * 这是整套架构的核心抽象，对应 UE5 里的 ".umap 关卡资产"。
 * 关键设计原则：Agent 不写代码，只编辑这份 JSON。
 * 游戏端订阅这份 JSON 的变化并热重建 3D 场景。
 *
 * 这样做的好处（也是 UE5 MCP 方案真正的精髓）：
 *   1. 可序列化 —— 关卡能存盘、能 diff、能 undo/redo、能进版本控制
 *   2. 有边界 —— Agent 只能调用我们暴露的字段，不会写出非法状态
 *   3. 可审查 —— 人能一眼看懂 Agent 到底改了什么
 */

export const LEVEL_SCHEMA_VERSION = 1;

/** 环境预设：一句话定调整体美术方向 */
export const ENV_PRESETS = {
  // 两条配色铁律（踩过坑才总结出来的）：
  //   1) fogColor 取「地平线色 与 天顶色 之间的中间调」—— 远处地面淡出时融进天空，
  //      否则会糊出一条和天空色差明显的硬带子。
  //   2) 地表 albedo 必须明显低于道具。地面法线朝上，吃满半球天光；
  //      道具侧面只吃到掠射角的光。两者 albedo 接近时，地面反而比道具亮，
  //      所有箱体塔楼都会退化成黑剪影，整个关卡失去体积感。
  dusk: {
    skyTop: '#0a0e1a', skyHorizon: '#ff8a4c', skyGround: '#12161f',
    groundColor: '#39404f', groundAccent: '#525c70',
    fogColor: '#3a3244', fogDensity: 0.0095,
    sunAzimuth: 135, sunElevation: 20, sunIntensity: 3.1, sunColor: '#ffd7a8',
    ambientColor: '#5b6d94', ambientIntensity: 1.25,
    exposure: 1.15, bloom: 0.5,
  },
  noon: {
    skyTop: '#2f6fd0', skyHorizon: '#bcd8f5', skyGround: '#5c6b57',
    groundColor: '#3b422f', groundAccent: '#4c5540',
    fogColor: '#a8c0d8', fogDensity: 0.0042,
    sunAzimuth: 90, sunElevation: 62, sunIntensity: 2.9, sunColor: '#fff3d8',
    ambientColor: '#8fa5c0', ambientIntensity: 1.1,
    exposure: 0.94, bloom: 0.3,
  },
  // 夜景的关键是"暗但有层次"：环境光必须给够，让轮廓可辨，
  // 否则玩家只能看见灯，看不见掩体在哪，玩法直接崩掉。
  night: {
    skyTop: '#050a18', skyHorizon: '#12233f', skyGround: '#060a14',
    groundColor: '#1c2434', groundAccent: '#2c3648',
    fogColor: '#0e1729', fogDensity: 0.013,
    // sunIntensity 略高是把这盏平行光当"月光"用：背月面若完全没有方向光，
    // 就只剩平光，箱体的体积感全丢了。
    sunAzimuth: 300, sunElevation: 34, sunIntensity: 1.05, sunColor: '#9cc0ff',
    ambientColor: '#425884', ambientIntensity: 1.35,
    exposure: 1.3, bloom: 0.75,
  },
  toxic: {
    skyTop: '#0a1410', skyHorizon: '#4d8a3a', skyGround: '#0d1a12',
    groundColor: '#1b2921', groundAccent: '#293a2e',
    fogColor: '#2b4030', fogDensity: 0.013,
    sunAzimuth: 210, sunElevation: 26, sunIntensity: 1.8, sunColor: '#a8e06a',
    ambientColor: '#2d5238', ambientIntensity: 0.9,
    exposure: 1.05, bloom: 0.8,
  },
  snow: {
    skyTop: '#4a5f7a', skyHorizon: '#d6e4f0', skyGround: '#8b98a8',
    groundColor: '#a9b4c0', groundAccent: '#8d99a8',
    fogColor: '#c3d1e0', fogDensity: 0.011,
    sunAzimuth: 60, sunElevation: 34, sunIntensity: 2.1, sunColor: '#eaf2ff',
    ambientColor: '#93a6bd', ambientIntensity: 1.25,
    exposure: 0.9, bloom: 0.28,
  },
  inferno: {
    skyTop: '#1a0503', skyHorizon: '#ff5a1e', skyGround: '#2a0a04',
    groundColor: '#2a1a15', groundAccent: '#3e2318',
    fogColor: '#4a1a0c', fogDensity: 0.014,
    sunAzimuth: 250, sunElevation: 11, sunIntensity: 2.5, sunColor: '#ff7a33',
    ambientColor: '#5c2415', ambientIntensity: 0.95,
    exposure: 1.1, bloom: 0.85,
  },
};

/** 道具类型：每种是一段程序化几何生成逻辑，零外部资产 */
export const PROP_TYPES = {
  crate:    { label: '货箱',     solid: true,  cover: true,  footprint: [2, 2, 2] },
  container:{ label: '集装箱',   solid: true,  cover: true,  footprint: [6, 2.6, 2.6] },
  wall:     { label: '墙段',     solid: true,  cover: true,  footprint: [8, 3.2, 0.6] },
  pillar:   { label: '立柱',     solid: true,  cover: true,  footprint: [1.2, 6, 1.2] },
  ramp:     { label: '斜坡',     solid: true,  cover: false, footprint: [6, 2, 6] },
  platform: { label: '高台',     solid: true,  cover: false, footprint: [8, 1, 8] },
  barrel:   { label: '油桶',     solid: true,  cover: true,  footprint: [1.1, 1.6, 1.1] },
  tower:    { label: '塔楼',     solid: true,  cover: true,  footprint: [4, 12, 4] },
  antenna:  { label: '天线',     solid: false, cover: false, footprint: [0.6, 14, 0.6] },
  rock:     { label: '岩石',     solid: true,  cover: true,  footprint: [3, 2, 3] },
  tree:     { label: '枯树',     solid: true,  cover: false, footprint: [1, 6, 1] },
  lamp:     { label: '灯柱',     solid: false, cover: false, footprint: [0.4, 5, 0.4] },
};

/** 敌人类别：对应 UE 里的 Pawn 子类 / Blueprint */
export const ENEMY_TYPES = {
  grunt:  { label: '步兵', health: 60,  speed: 3.2, damage: 8,  range: 22,  cooldown: 1.1, accuracy: 0.55, color: '#e0553f', scale: 1.0,  score: 100, ranged: true  },
  rusher: { label: '突击兵', health: 40, speed: 6.4, damage: 20, range: 2.2, cooldown: 0.9, accuracy: 1.0,  color: '#ffb020', scale: 0.9,  score: 150, ranged: false },
  sniper: { label: '狙击手', health: 45, speed: 1.9, damage: 26, range: 70,  cooldown: 2.4, accuracy: 0.92, color: '#9b6bff', scale: 1.05, score: 250, ranged: true  },
  tank:   { label: '重甲兵', health: 190, speed: 2.2, damage: 15, range: 12,  cooldown: 1.6, accuracy: 0.4,  color: '#4a7fbf', scale: 1.45, score: 400, ranged: true  },
};

/** 布局模式：让 Agent 用一句 "ring:8" 就能摆一圈掩体，而不是写 8 次坐标 */
export const PATTERNS = ['ring', 'grid', 'scatter', 'line', 'arc', 'cluster'];

let _idSeq = 0;
export function uid(prefix = 'p') {
  _idSeq += 1;
  return `${prefix}_${Date.now().toString(36).slice(-4)}${_idSeq}`;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, dflt) => (typeof v === 'number' && Number.isFinite(v) ? v : dflt);
const str = (v, dflt) => (typeof v === 'string' && v.length ? v : dflt);
const hex = (v, dflt) => (/^#[0-9a-fA-F]{6}$/.test(str(v, '')) ? v : dflt);
const vec3 = (v, dflt) => (Array.isArray(v) && v.length === 3 && v.every(Number.isFinite) ? v.slice(0, 3) : dflt.slice());

/** 默认关卡：不接 Agent 也能直接玩的黄昏工业竞技场 */
export function defaultLevel() {
  return {
    version: LEVEL_SCHEMA_VERSION,
    meta: { name: 'NEXUS BREACH — 默认竞技场', author: 'system', revision: 1 },
    environment: { ...ENV_PRESETS.dusk, preset: 'dusk', arenaSize: 90 },
    props: [
      { id: 'p_wall_n', type: 'wall', position: [0, 1.6, -44], rotation: [0, 0, 0], scale: [5.2, 1, 1], color: '#39424f' },
      { id: 'p_wall_s', type: 'wall', position: [0, 1.6, 44],  rotation: [0, 0, 0], scale: [5.2, 1, 1], color: '#39424f' },
      { id: 'p_wall_e', type: 'wall', position: [44, 1.6, 0],  rotation: [0, Math.PI / 2, 0], scale: [5.2, 1, 1], color: '#39424f' },
      { id: 'p_wall_w', type: 'wall', position: [-44, 1.6, 0], rotation: [0, Math.PI / 2, 0], scale: [5.2, 1, 1], color: '#39424f' },
      { id: 'p_ctr_1', type: 'container', position: [-14, 1.3, -18], rotation: [0, 0.3, 0], scale: [1, 1, 1], color: '#6b4a2f' },
      { id: 'p_ctr_2', type: 'container', position: [16, 1.3, -12],  rotation: [0, -0.5, 0], scale: [1, 1, 1], color: '#2f5a6b' },
      { id: 'p_ctr_3', type: 'container', position: [-8, 1.3, 20],   rotation: [0, 1.1, 0], scale: [1, 1, 1], color: '#5a2f3f' },
      { id: 'p_ctr_4', type: 'container', position: [22, 1.3, 18],   rotation: [0, -0.2, 0], scale: [1, 1, 1], color: '#3f5a2f' },
      { id: 'p_crate_a', type: 'crate', position: [-24, 1, -6], rotation: [0, 0.4, 0], scale: [1, 1, 1], color: '#5c6675' },
      { id: 'p_crate_b', type: 'crate', position: [-22, 1, -3], rotation: [0, -0.2, 0], scale: [1, 1, 1], color: '#5c6675' },
      { id: 'p_crate_c', type: 'crate', position: [-23, 3, -5], rotation: [0, 0.7, 0], scale: [1, 1, 1], color: '#6b7280' },
      { id: 'p_crate_d', type: 'crate', position: [28, 1, -26], rotation: [0, 0.1, 0], scale: [1, 1, 1], color: '#5c6675' },
      { id: 'p_plat_1', type: 'platform', position: [0, 1.2, -8],  rotation: [0, 0, 0], scale: [1.4, 1, 1.4], color: '#414a58' },
      { id: 'p_ramp_1', type: 'ramp', position: [6.5, 1, -8],   rotation: [0, -Math.PI / 2, 0], scale: [1, 1, 1], color: '#4a5462' },
      { id: 'p_pil_1', type: 'pillar', position: [-30, 3, -30], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#3a4350' },
      { id: 'p_pil_2', type: 'pillar', position: [30, 3, -30],  rotation: [0, 0, 0], scale: [1, 1, 1], color: '#3a4350' },
      { id: 'p_pil_3', type: 'pillar', position: [-30, 3, 30],  rotation: [0, 0, 0], scale: [1, 1, 1], color: '#3a4350' },
      { id: 'p_pil_4', type: 'pillar', position: [30, 3, 30],   rotation: [0, 0, 0], scale: [1, 1, 1], color: '#3a4350' },
      { id: 'p_tow_1', type: 'tower', position: [-38, 6, 8],  rotation: [0, 0.3, 0], scale: [1, 1, 1], color: '#333b47' },
      { id: 'p_tow_2', type: 'tower', position: [38, 6, -8],  rotation: [0, -0.4, 0], scale: [1, 1, 1], color: '#333b47' },
      { id: 'p_bar_1', type: 'barrel', position: [-4, 0.8, -20], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#8a5a2a' },
      { id: 'p_bar_2', type: 'barrel', position: [-1.5, 0.8, -21], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#8a5a2a' },
      { id: 'p_bar_3', type: 'barrel', position: [10, 0.8, 26], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#2a6a8a' },
      { id: 'p_ant_1', type: 'antenna', position: [-38, 7, 8], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#6b7280' },
      { id: 'p_ant_2', type: 'antenna', position: [38, 7, -8], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#6b7280' },
      { id: 'p_lmp_1', type: 'lamp', position: [-18, 2.5, -8], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#ffb765' },
      { id: 'p_lmp_2', type: 'lamp', position: [18, 2.5, 8],   rotation: [0, 0, 0], scale: [1, 1, 1], color: '#ffb765' },
      { id: 'p_lmp_3', type: 'lamp', position: [0, 2.5, -30],  rotation: [0, 0, 0], scale: [1, 1, 1], color: '#ffb765' },
      // 特意避开出生点正前方：灯柱立在 [0,·,30] 时离出生点只有 4 米，
      // 玩家一睁眼就是一根糊在脸上的柱子。
      { id: 'p_lmp_4', type: 'lamp', position: [-13, 2.5, 31], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#ffb765' },

      // --- 中场掩体 ---
      // 一个没有中场掩体的竞技场只会变成"谁先看到谁"的对枪场，没有走位空间。
      // 这里用一圈交错的箱体 + 两段矮墙把场地切成几条可绕行的路线。
      { id: 'p_mid_1', type: 'crate', position: [-12, 1, 12], rotation: [0, 0.35, 0], scale: [1, 1, 1], color: '#5c6675' },
      { id: 'p_mid_2', type: 'crate', position: [-10, 1, 14.4], rotation: [0, -0.2, 0], scale: [1, 1, 1], color: '#5c6675' },
      { id: 'p_mid_3', type: 'crate', position: [-11.2, 3, 13.2], rotation: [0, 0.8, 0], scale: [1, 1, 1], color: '#6b7280' },
      { id: 'p_mid_4', type: 'crate', position: [13, 1, -14], rotation: [0, -0.4, 0], scale: [1, 1, 1], color: '#5c6675' },
      { id: 'p_mid_5', type: 'crate', position: [15.2, 1, -12.6], rotation: [0, 0.15, 0], scale: [1, 1, 1], color: '#5c6675' },
      { id: 'p_mid_6', type: 'crate', position: [14.1, 3, -13.3], rotation: [0, -0.6, 0], scale: [1, 1, 1], color: '#6b7280' },
      { id: 'p_mid_7', type: 'wall', position: [-20, 1.6, -22], rotation: [0, 0.55, 0], scale: [0.5, 0.85, 1], color: '#3d4655' },
      { id: 'p_mid_8', type: 'wall', position: [20, 1.6, 22], rotation: [0, 0.55, 0], scale: [0.5, 0.85, 1], color: '#3d4655' },
      { id: 'p_mid_9', type: 'barrel', position: [-6, 0.8, 6], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#8a5a2a' },
      { id: 'p_mid_10', type: 'barrel', position: [7, 0.8, 5], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#2a6a8a' },
      { id: 'p_mid_11', type: 'rock', position: [-28, 1, 6], rotation: [0, 0.9, 0], scale: [1.1, 0.8, 1.1], color: '#3d4450' },
      { id: 'p_mid_12', type: 'rock', position: [26, 1, -4], rotation: [0, 2.1, 0], scale: [1.3, 0.7, 1.3], color: '#3d4450' },
    ],
    spawns: [
      { id: 'e_1', type: 'grunt',  position: [-30, 0, -34], patrol: null },
      { id: 'e_2', type: 'grunt',  position: [30, 0, -34],  patrol: null },
      { id: 'e_3', type: 'rusher', position: [0, 0, -40],   patrol: null },
      { id: 'e_4', type: 'sniper', position: [-38, 0, 30],  patrol: null },
      { id: 'e_5', type: 'grunt',  position: [24, 0, 34],   patrol: null },
    ],
    gameplay: defaultGameplay(),
    playerStart: [0, 1.7, 34],
    // 出生朝向：0 = 面朝 -Z。出生点在 +Z，所以 0 正好让玩家一睁眼就看着竞技场中心。
    playerYaw: 0,
  };
}

export function defaultGameplay() {
  return {
    player: {
      maxHealth: 100, moveSpeed: 7.2, sprintMultiplier: 1.55, jumpVelocity: 6.4,
      gravity: 22, damage: 34, fireRate: 0.11, magazine: 30, reloadTime: 1.5,
      spread: 0.014, range: 220, headshotMultiplier: 2.2,
    },
    enemies: {
      globalHealthScale: 1.0, globalSpeedScale: 1.0, globalDamageScale: 1.0,
      visionRange: 70, attackRangeFudge: 1.0, aggression: 0.75,
    },
    waves: { enabled: true, count: 4, perWaveBase: 4, perWaveGrowth: 2, healthScalePerWave: 1.18, delay: 4 },
  };
}

/**
 * 清洗 & 校验：Agent 传来的任何东西都要过这一层。
 * 这是"有边界"的保证 —— 非法字段被丢弃而不是让游戏崩掉。
 */
export function sanitizeLevel(raw) {
  const base = defaultLevel();
  if (!raw || typeof raw !== 'object') return base;

  const env = raw.environment && typeof raw.environment === 'object' ? raw.environment : {};
  const preset = ENV_PRESETS[str(env.preset, '')] ? env.preset : 'dusk';
  const merged = { ...ENV_PRESETS[preset], ...env, preset };

  const environment = {
    preset,
    skyTop: hex(merged.skyTop, base.environment.skyTop),
    skyHorizon: hex(merged.skyHorizon, base.environment.skyHorizon),
    skyGround: hex(merged.skyGround, base.environment.skyGround),
    groundColor: hex(merged.groundColor, base.environment.groundColor),
    groundAccent: hex(merged.groundAccent, base.environment.groundAccent),
    fogColor: hex(merged.fogColor, base.environment.fogColor),
    fogDensity: clamp(num(merged.fogDensity, 0.012), 0, 0.08),
    sunAzimuth: clamp(num(merged.sunAzimuth, 135), 0, 360),
    sunElevation: clamp(num(merged.sunElevation, 18), -10, 89),
    sunIntensity: clamp(num(merged.sunIntensity, 2.5), 0, 8),
    sunColor: hex(merged.sunColor, base.environment.sunColor),
    ambientColor: hex(merged.ambientColor, base.environment.ambientColor),
    ambientIntensity: clamp(num(merged.ambientIntensity, 0.8), 0, 4),
    exposure: clamp(num(merged.exposure, 1.0), 0.2, 3),
    bloom: clamp(num(merged.bloom, 0.5), 0, 3),
    arenaSize: clamp(num(merged.arenaSize, 90), 40, 200),
  };

  const half = environment.arenaSize / 2 + 8;
  const clampPos = (p, dflt) => {
    const v = vec3(p, dflt);
    return [clamp(v[0], -half, half), clamp(v[1], -20, 60), clamp(v[2], -half, half)];
  };

  const props = (Array.isArray(raw.props) ? raw.props : []).slice(0, 400).map((p, i) => ({
    id: str(p && p.id, uid('p')) || `p_auto_${i}`,
    type: PROP_TYPES[str(p && p.type, 'crate')] ? p.type : 'crate',
    position: clampPos(p && p.position, [0, 1, 0]),
    rotation: vec3(p && p.rotation, [0, 0, 0]),
    scale: vec3(p && p.scale, [1, 1, 1]).map((s) => clamp(s, 0.1, 12)),
    color: hex(p && p.color, '#5c6675'),
  }));

  const spawns = (Array.isArray(raw.spawns) ? raw.spawns : []).slice(0, 120).map((s, i) => ({
    id: str(s && s.id, uid('e')) || `e_auto_${i}`,
    type: ENEMY_TYPES[str(s && s.type, 'grunt')] ? s.type : 'grunt',
    position: clampPos(s && s.position, [0, 0, 0]),
    patrol: Array.isArray(s && s.patrol) ? s.patrol.slice(0, 8).map((pt) => [clamp(num(pt[0], 0), -half, half), clamp(num(pt[1], 0), -half, half)]) : null,
  }));

  const gp = raw.gameplay && typeof raw.gameplay === 'object' ? raw.gameplay : {};
  const d = defaultGameplay();
  const pp = gp.player && typeof gp.player === 'object' ? gp.player : {};
  const ee = gp.enemies && typeof gp.enemies === 'object' ? gp.enemies : {};
  const ww = gp.waves && typeof gp.waves === 'object' ? gp.waves : {};
  const gameplay = {
    player: {
      maxHealth: clamp(num(pp.maxHealth, d.player.maxHealth), 10, 1000),
      moveSpeed: clamp(num(pp.moveSpeed, d.player.moveSpeed), 1, 25),
      sprintMultiplier: clamp(num(pp.sprintMultiplier, d.player.sprintMultiplier), 1, 3),
      jumpVelocity: clamp(num(pp.jumpVelocity, d.player.jumpVelocity), 0, 20),
      gravity: clamp(num(pp.gravity, d.player.gravity), 5, 60),
      damage: clamp(num(pp.damage, d.player.damage), 1, 500),
      fireRate: clamp(num(pp.fireRate, d.player.fireRate), 0.02, 2),
      magazine: Math.round(clamp(num(pp.magazine, d.player.magazine), 1, 200)),
      reloadTime: clamp(num(pp.reloadTime, d.player.reloadTime), 0.1, 6),
      spread: clamp(num(pp.spread, d.player.spread), 0, 0.3),
      range: clamp(num(pp.range, d.player.range), 10, 500),
      headshotMultiplier: clamp(num(pp.headshotMultiplier, d.player.headshotMultiplier), 1, 10),
    },
    enemies: {
      globalHealthScale: clamp(num(ee.globalHealthScale, 1), 0.1, 10),
      globalSpeedScale: clamp(num(ee.globalSpeedScale, 1), 0.1, 5),
      globalDamageScale: clamp(num(ee.globalDamageScale, 1), 0, 10),
      visionRange: clamp(num(ee.visionRange, 70), 5, 200),
      attackRangeFudge: clamp(num(ee.attackRangeFudge, 1), 0.2, 3),
      aggression: clamp(num(ee.aggression, 0.75), 0, 1),
    },
    waves: {
      enabled: ww.enabled === undefined ? d.waves.enabled : !!ww.enabled,
      count: Math.round(clamp(num(ww.count, d.waves.count), 1, 20)),
      perWaveBase: Math.round(clamp(num(ww.perWaveBase, d.waves.perWaveBase), 1, 40)),
      perWaveGrowth: Math.round(clamp(num(ww.perWaveGrowth, d.waves.perWaveGrowth), 0, 20)),
      healthScalePerWave: clamp(num(ww.healthScalePerWave, 1.18), 1, 3),
      delay: clamp(num(ww.delay, 4), 0.5, 20),
    },
  };

  return {
    version: LEVEL_SCHEMA_VERSION,
    meta: {
      name: str(raw.meta && raw.meta.name, base.meta.name),
      author: str(raw.meta && raw.meta.author, 'agent'),
      revision: Math.round(num(raw.meta && raw.meta.revision, 1)),
    },
    environment, props, spawns, gameplay,
    playerStart: clampPos(raw.playerStart, [0, 1.7, 34]),
    playerYaw: normalizeAngle(num(raw.playerYaw, 0)),
  };
}

/** 归一到 [-PI, PI]，避免 Agent 传进来 720° 这种值 */
export function normalizeAngle(a) {
  const twoPi = Math.PI * 2;
  let x = ((a % twoPi) + twoPi) % twoPi;
  if (x > Math.PI) x -= twoPi;
  return x;
}

/** 把布局模式展开成坐标数组 —— "ring:10" 这类紧凑指令的核心 */
export function expandPattern(pattern, opts = {}) {
  const {
    count = 8, center = [0, 0], radius = 18, spacing = 6,
    width = 40, height = 40, arcStart = 0, arcEnd = Math.PI * 2,
    seed = 1337, jitter = 0,
  } = opts;
  const n = Math.max(1, Math.min(Math.round(count), 200));
  const pts = [];

  // 确定性伪随机：同一 seed 永远得到同一布局，方便复现
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };

  if (pattern === 'ring') {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push([center[0] + Math.cos(a) * radius, center[1] + Math.sin(a) * radius]);
    }
  } else if (pattern === 'arc') {
    const denom = n > 1 ? n - 1 : 1;
    for (let i = 0; i < n; i++) {
      const a = arcStart + ((arcEnd - arcStart) * i) / denom;
      pts.push([center[0] + Math.cos(a) * radius, center[1] + Math.sin(a) * radius]);
    }
  } else if (pattern === 'grid') {
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols && pts.length < n; c++) {
        pts.push([
          center[0] + (c - (cols - 1) / 2) * spacing,
          center[1] + (r - (rows - 1) / 2) * spacing,
        ]);
      }
    }
  } else if (pattern === 'line') {
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) - 0.5 : 0;
      pts.push([center[0] + t * width, center[1]]);
    }
  } else if (pattern === 'cluster') {
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * radius;
      pts.push([center[0] + Math.cos(a) * r, center[1] + Math.sin(a) * r]);
    }
  } else { // scatter
    for (let i = 0; i < n; i++) {
      pts.push([
        center[0] + (rnd() - 0.5) * width,
        center[1] + (rnd() - 0.5) * height,
      ]);
    }
  }

  if (jitter > 0) {
    return pts.map(([x, z]) => [x + (rnd() - 0.5) * jitter, z + (rnd() - 0.5) * jitter]);
  }
  return pts;
}
