/* ============================================================
 * 《档案层 B4》 2D 俯视角恐怖逃生游戏
 * config.js —— 全局常量、平衡数值与调色板
 * ============================================================ */
(function () {
  'use strict';
  var B4 = window.B4 = window.B4 || {};

  B4.CFG = {
    /* ---------- 世界 ---------- */
    TILE: 48,                 // 每个基础单元的像素尺寸（要求 ≥32）
    MAP_W: 47,                // 地图网格宽（要求 ≥35）
    MAP_H: 37,                // 地图网格高（要求 ≥35）

    /* ---------- 玩家（速度单位：格/秒） ---------- */
    PLAYER_SPEED: 3.2,        // 普通行走
    SPRINT_MULT: 1.62,        // 冲刺倍率 → 5.18
    PLAYER_RADIUS: 0.34,      // 碰撞半径（格）
    STAMINA_MAX: 100,
    SPRINT_DRAIN: 24,         // 冲刺每秒耗体力
    STAMINA_REGEN: 22,        // 停止冲刺后快速恢复
    SPRINT_RESUME_AT: 30,     // 体力耗尽后需恢复到该值才能再次冲刺

    /* ---------- 理智 ---------- */
    SANITY_MAX: 100,
    DARK_DRAIN: 2.1,          // 停留在黑暗区域
    ENEMY_NEAR_DRAIN: 2.6,    // 距实体过近（<6 格）
    CHASE_DRAIN: 5.5,         // 被实体追赶
    SANITY_REGEN: 3.4,        // 明亮且暂时脱离危险时缓慢恢复
    BENCH_SANITY: 22,         // 安全屋长椅一次恢复量
    BENCH_COOLDOWN: 25,       // 长椅冷却（秒）
    LOW_SANITY_FX: 38,        // 低于该值出现低理智效果

    /* ---------- 敌对实体「巡影」 ---------- */
    ENEMY_VISION: 8.5,        // 视野距离（格）
    ENEMY_SPOT_TIME: 0.38,    // 发现确认时间（秒）
    ENEMY_SPEED_WANDER: 1.7,
    ENEMY_SPEED_SUSPECT: 2.7,
    ENEMY_SPEED_CHASE: 3.9,   // 高于行走 3.2，低于满体力冲刺 5.18
    ENEMY_SPEED_SEARCH: 2.2,
    ENEMY_CATCH: 0.62,        // 接触判定距离（格）
    ENEMY_RADIUS: 0.36,
    CHASE_LOSE_TIME: 2.6,     // 失去视线多久后转入搜索
    SEARCH_TIME: 6.0,         // 搜索持续时间
    REPATH_CHASE: 0.4,        // 追逐时重算路径间隔
    REPATH_IDLE: 1.2,
    ANTI_CAMP_RADIUS: 5,      // 游荡目标避开终端/出口的半径（格）

    /* ---------- 声音传播半径（格） ---------- */
    NOISE_WALK: 3.0,
    NOISE_SPRINT: 8.5,
    NOISE_INTERACT: 5.5,
    NOISE_BUMP: 6.5,

    /* ---------- 光照 ---------- */
    PLAYER_LIGHT_R: 3.1,      // 玩家随身微光半径
    LAMP_ROOM_R: 5.4,         // 房间荧光灯半径
    LAMP_CORR_R: 3.7,         // 走廊灯半径
    LAMP_BROKEN_P: 0.24,      // 灯管损坏概率（形成黑暗区）
    EXPLORED_MIN: 0.085,      // 走过区域的记忆微光（代替完整小地图）
    SAFE_MIN: 0.34,           // 安全屋基础亮度

    /* ---------- 交互 ---------- */
    INTERACT_R: 1.35,         // 交互判定距离（格）

    /* ---------- 画面 ---------- */
    VIEW_TILES_X: 21,         // 视野横向格数（用于缩放）
    GRAIN_ALPHA: 0.055,       // 基础噪点
    GRAIN_ALPHA_LOW: 0.16,    // 低理智噪点上限
    MAX_DT: 0.05,             // 帧间隔上限，防止后台切回穿透

    /* ---------- 调色板（昏黄 / 旧铜 / 灰褐） ---------- */
    PAL: {
      pageBg: '#0b0a08',
      floorA: [122, 106, 79],   // 地砖基色（昏黄）
      floorB: [110, 96, 73],
      corridor: [104, 92, 70],
      damp: [88, 86, 62],       // 潮湿地毯
      stain: [70, 64, 50],      // 污渍
      wall: [36, 31, 25],
      wallTop: [58, 49, 40],
      wallCrack: [22, 19, 15],
      furnitureWood: [76, 63, 48],
      furnitureMetal: [57, 65, 63],
      tape: [40, 36, 32],
      lightWarm: [1.0, 0.84, 0.58],   // 荧光灯暖黄
      lightCool: [0.72, 0.76, 0.86],  // 玩家随身冷光
      lightSafe: [1.0, 0.88, 0.66],   // 安全屋暖光
      lightExit: [0.45, 1.0, 0.62],   // 出口解锁绿光
      dark: [0.012, 0.012, 0.02],     // 全暗底色
      hudText: '#cfc4a8',
      hudDim: '#8a8171',
      hudAccent: '#d8b36a',
      hudDanger: '#b04a38',
      hudOk: '#8fae72'
    },

    /* ---------- 房间类型 ---------- */
    ROOM: {
      NORMAL: 'normal',
      MONITOR: 'monitor',   // 录像室
      TERMINAL: 'terminal', // 密码终端区
      EXIT: 'exit',         // 出口区
      SAFE: 'safe'          // 避难区域（不刷敌人）
    }
  };
})();
