/* =====================================================================
 * TIDELINE · constants.js
 * 全项目唯一真源。禁止在别处硬编码任何数值。
 *
 * 单位约定（ADR-002 三层空间模型）：
 *   DESIGN px : 设计空间 1440x864，所有游戏逻辑数值的单位
 *   ART px    : 艺术网格 720x432(=RT_WORLD)，1 art px = 2 design px
 * 本文件所有数值除非注明，均为 DESIGN px / 秒 / 弧度制外的角度。
 * ===================================================================== */
(function () {
  var TL = (window.TL = window.TL || {});

  /* ---------- L0/L1/L2 空间（ADR-002 §6 常量表） ---------- */
  var DESIGN_W = 1440, DESIGN_H = 864, ART_SCALE = 2;

  var C = {
    VERSION: '0.1.0',
    RUN_SECONDS: 120,
    COLLECT: { COUNT: 8, RADIUS: 46, SCORE: [10, 20, 30] },
    FLASH_GAP: 0.51,
    FLASH_DUR: 0.45,
    DESIGN_W: DESIGN_W,
    DESIGN_H: DESIGN_H,
    ART_SCALE: ART_SCALE,
    RT_W: DESIGN_W / ART_SCALE,   // 720
    RT_H: DESIGN_H / ART_SCALE,   // 432
    SAFE_MARGIN: 48,
    LETTERBOX: '#0A0E17',

    /* ---------- 世界（GDD-01 §4.1） ---------- */
    WORLD_W: 3000,                // 航道总长 L_lane（沙盘校准：3000/(300*0.7)=14.3s）
    WORLD_TOP_SKY: -420,          // 相机可上探到世界顶部之上（搁浅构图用）
    WORLD_BOTTOM: 1100,           // 世界底部（沙层截面延伸到 864 之下）

    WATER_BASE: 105,              // GDD-01 §4.1 水面线 y=104 → 取 105（ADR-003）
    WAVE_AMP: 6,
    WAVE_LEN: 180,
    WAVE_SPEED: 40,

    /* 海床控制点（ADR-003 §2.2 形式的 11 点表，数值为适配 GDD 的 3000/750 重新推导）
     * 约束：depth = seabedY - WATER_BASE
     *   x=750  → depth 400（DEEP|SHALLOW 边界，= GDD 深海 x<750）
     *   x=1650 → depth 120（SHALLOW|SURF 边界）
     *   x=2550 → depth 0  （潮线 shoreX，SURF|BEACH 边界）
     */
    SEABED_PTS: [
      [0, 864], [450, 864], [650, 852], [750, 505], [900, 450],
      [1150, 390], [1400, 315], [1650, 225], [1950, 168], [2250, 128],
      [2550, 105], [2750, 88], [3000, 78]
    ],
    ZONE_DEPTH_DEEP: 400,         // depth >= 400 → DEEP
    ZONE_DEPTH_SHALLOW: 120,      // depth >= 120 → SHALLOW；否则 SURF / BEACH
    ZONE_HYST: 8,                 // 区域迟滞（design px）

    /* ---------- 鲨鱼（GDD-01 §4.1/§4.2） ---------- */
    SHARK: {
      LEN: 168, HALF_W: 74, HALF_H: 44,      // 碰撞盒 148x88
      DRAW_HALF_W: 42, DRAW_HALF_H: 20,      // 视觉 84x40 art px
      DRAW_PAD: 8,                           // 图集外扩留白（art px）：容纳 3px 描边 + 鳍尖溢出
      MOUTH_OFF: 62, MOUTH_W: 56, MOUTH_H: 40,
      SINK: 12                                // 允许陷入沙中的深度（搁浅触地判定留量）
    },

    V_CRUISE: 300,
    DASH: {
      WINDUP: 0.08, CRUISE_END: 0.65, TOTAL: 0.80,
      V_START: 300, V_PEAK: 700, V_END: 300,
      CD: 1.2, OMEGA: 90, CONE_DEG: 25
    },
    OMEGA_CRUISE: 360,

    /* 携带惩罚曲线（GDD-01 §4.2） */
    CARRY_V: function (k) { return k <= 0 ? 1.0 : (0.94 - 0.12 * k); },
    CARRY_W: function (k) { return k <= 0 ? 1.0 : Math.max(0.25, 1.0 - 0.20 * k); },
    CARRY_MAX: 4,

    /* 体力（GDD-01 §4.3） */
    STAMINA_MAX: 3,
    DASH_COST_EMPTY: 1,
    DASH_COST_CARRY: 2,
    REGEN: { SURF: 0.6, DEEP: 0.4, SHALLOW: 0.2, BEACH: 0 },
    REGEN_CARRY_MULT: 0.5,

    /* 冲浪模式（GDD-01 §3.5） */
    SURF: {
      RATE_MULT: 1.25,
      OMEGA_MULT: 1.10,
      BAND: 40,          // |centerY - waterLineY| <= 40 design px（取 GDD 的 40，ADR-003 给 24）
      SPEED_FRAC: 0.8    // |v| >= 0.8 * v_cruise(k)  ← 见 README「已知冲突 S1」
    },

    /* 强制打断态 */
    SLOWED: { DUR: 0.6, RATE_MULT: 0.40, OMEGA_MULT: 0.70, REGEN_MULT: 0.5 },
    STUN_DUR: 1.5,
    SNARE_DUR: 1.5,
    IFRAME_AFTER_CC: 0.6,

    /* 搁浅（GDD-01 §3.6 + ADR-003 §2.4 的连续速率版） */
    BEACH: {
      V_TH: 210,       // 0.7 * v_cruise（GDD-01 §4.4）
      T_STRAND: 1.2,
      T_WARN: 0.72,    // 60% * T_STRAND
      REC_IN: 2.0,
      REC_OUT: 4.0
    },

    /* QTE（ADR-003 §2.6） */
    QTE: {
      WINDOW: 2.5, NEED: 6, MIN_INTERVAL: 0.1,
      RING_OUTER: 140, RING_INNER: 80,
      ALARM_RATE: 8.0,
      FREEZE: 0.08, SHAKE: 6
    },
    QTE_ASSIST: { WINDOW: 3.5, NEED: 3 },

    /* ALARM（GDD-02 §3.1/§3.2） */
    ALARM: {
      MAX: 100,
      GRAB: 20, DECOY: 8, JETSKI: 5, CC_HIT: 3,
      SLOPE: {
        DEEP_MOVING: -2.0, DEEP_STILL: -4.0,
        SHALLOW: 2.0, SURF: 0.5, BEACH: 4.0, AIRBORNE: 3.0,
        BEACHED: 8.0
      },
      STILL_SPEED: 60,     // |v| < 此值视为「静止」（深海衰减取 -4.0）
      UP: [25, 50, 75],    // 上升阈值（🔒）
      DOWN: [22, 46, 70],  // 下降阈值（3 点迟滞带，安全要求）
      MAX_EVENT_REARM: 90  // 「通缉令拉满」事件重复触发锁（跌破 90 才重触发）
    },

    /* 系绳（GDD-02 §3.5） */
    TETHER: {
      LOCK: 3.0,          // 锁定致死
      BREAK: 1.5,         // 脱离观测断线所需（硬约束 < LOCK）
      SEARCH: 4.0,        // `?` 搜索态持续
      DEEP_X: 750,        // 深海 = 敌人禁区
      DEEP_DEPTH: 240     // 水面下深度 > 240 且 x<750 → 不可观测
    },

    /* DECOY BREACH（GDD-03 §3.4） */
    DECOY: { RADIUS: 160, MAX_TARGETS: 2, STALL: 2.5, MIN_X: 750, COST: 1 },

    /* 咬合（GDD-03 §3.1） */
    BITE: { DUR: 0.25, FREEZE: 0.08, SHAKE: 6, SHAKE_CD: 0.5 },

    /* Bank（GDD-03 §3.6） */
    BANK: { DIGEST: 0.8, DEEP_X: 750 },

    /* 战利品（GDD-03 §3.1） */
    PREY: {
      SWIMMER: { score: 100, danger: 1.0, name: '泳客' },
      SURFER: { score: 150, danger: 1.0, name: '冲浪者' },
      SUNBATHER: { score: 100, danger: 1.0, name: '日光浴者' },
      LIFEGUARD: { score: 300, danger: 2.0, name: '救生员' }
    },

    /* COMBO（GDD-03 §3.3，MVP 简化） */
    COMBO: { PER_GRAB: 1, PER_COLLECT: 1, M_CAP: 3.0, STEP: 0.2 },
    BANK_B: function () { return 1.0; },   // MVP：B(k) ≡ 1（线性，🔒 沙盘结论）

    /* 敌人（GDD-02 §3.3/§3.4，MVP 简化版） */
    ENEMY: {
      WARN_LEAD: 0.8,
      T1: { SPEED: 30, DUR: 0.6 },
      T2A: { TELEGRAPH: 0.5, FLIGHT: 0.4, RANGE: 400, INTERVAL: 2.5 },
      T2B: { SPEED: 340, KNOCK: 0.3, IFRAME: 0.5 },
      T3B: { SPEED: 260, ALT: 44 },
      CAPS: { T1: 3, T2A: 2, T2B: 2, T3B: 1 },
      HARD_CAP: 7,
      MIN_LIFE: 1.5
    },

    /* 相机 */
    CAM: { LERP: 6.0, FOCUS_X: 0.62, FOCUS_Y: 0.46, Y_MIN: -320, BEACH_PAN: 0.35 },

    /* 光敏性癫痫安全（硬红线①）：所有呼吸式脉动走 breath()，f 恒 <= 2Hz */
    MAX_FLASH_HZ: 2.0,

    /* 模拟（ADR-006 / GDD-01 E8） */
    FIXED_DT: 1 / 60,
    DT_CLAMP: 0.05,
    MAX_SUBSTEP_PX: 40,
    MAX_STEPS: 5
  };

  /* ---------- MVP 调色板 ----------
   * 美术圣经 §2.3 定义了 13 色索引表，MVP 只取其中 10 色（灰调为主）。
   * v0.1.0 补入 STEEL/ASH 两色：美术圣经 §4.1.3 明确规定鲨鱼**背侧主体**为
   *   `#4A5A6E` 雾灰 → `#6E7C8C` 中灰（上深下浅的反遮蔽配色）
   * 此前实现误用 DEEP2/SLATE（深藏青），导致鲨鱼在深海区（底色 ≈ #111F36）
   * 的亮度比仅约 1.5:1 —— 玩家角色在 Bank 结算区**几乎不可见**。
   * 这不是审美取舍，是资产没有执行已锁定的美术规范。
   */
  C.PAL = {
    BLACK: '#0A0E17',
    DEEP: '#16213A',
    DEEP2: '#1B2E52',
    SLATE: '#2E3E54',
    STEEL: '#4A5A6E',      // 美术圣经 04 雾灰：鲨鱼背侧（上）
    ASH: '#6E7C8C',        // 美术圣经 05 中灰：鲨鱼背侧（中）
    MIST: '#8A97A8',       // 美术圣经 06 亮灰：鲨鱼受光边
    PALE: '#C7CFD8',
    WHITE: '#F2F5F8',
    AMBER: '#FF8A3D',
    BLOOD: '#FF3B3B',
    MAGENTA: '#FF2E88',
    CYAN: '#00C2FF'
  };
  /* 辅助色（非主调色板，仅用于占位素材内部） */
  C.XPAL = {
    SKIN: '#F0C89A',
    HAIR: '#2A1E18',
    SAND: '#E8C56A',
    SAND_DK: '#A8813C',
    WOOD: '#7A5A34',
    GOLD: '#FFD23F',
    TEAL: '#1E5F74'
  };

  /* 色盲模式映射（GDD-02 §5.4）：两条路径灰度化后均为单调亮度序列 */
  C.PAL_CB = { BLOOD: '#00C2FF', AMBER: '#FFD23F' };

  C.ZONE = { DEEP: 0, SHALLOW: 1, SURF: 2, BEACH: 3 };
  C.ZONE_NAME = ['深海', '浅滩', '冲浪区', '沙滩'];
  C.TIER_NAME = ['平静', '警戒', '追捕', '围剿'];

  TL.C = C;
})();
