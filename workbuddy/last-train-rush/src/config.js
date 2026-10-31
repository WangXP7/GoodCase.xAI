// 全局可调参数 —— 所有手感数值集中在这里
export const CFG = {
  // 赛道
  // 追逐相机在玩家身后看向 +z：此取向下 world +x 出现在屏幕【左】侧
  //（相机 local +x = up × backward = world -x）。故 lane 0 = 屏幕左 = world +2.3，
  // 按左键 → lane 0 → 角色向屏幕左移动。
  lanes: [2.3, 0, -2.3],
  laneSwitchTime: 0.16,      // 换道时长（秒）
  laneTilt: 0.22,            // 换道时身体侧倾（弧度）

  // 速度
  speedStart: 13,            // 初速 m/s
  speedRamp: 0.32,           // 每秒加速
  speedMax: 29,              // 极速
  speedHitFactor: 0.72,      // 被撞后速度保留
  speedRecover: 0.5,         // 速度恢复速率（向目标逼近的系数/秒）

  // 跳跃 / 翻滚
  gravity: 26,
  jumpVel: 9.6,              // 起跳速度 → 高度约1.77m 滞空约0.74s
  rollTime: 0.55,            // 翻滚持续
  playerHeight: 1.72,        // 站立碰撞高度
  playerRollHeight: 0.85,    // 翻滚碰撞高度
  playerHalfW: 0.34,
  playerHalfD: 0.42,

  // 生命
  hearts: 3,
  invincibleTime: 1.6,

  // 目标：末班车距离
  goalDistance: 2600,
  catchWindow: 11,           // 距车尾多少米算「上车」

  // 世界
  segLength: 30,             // 单段轨道长度
  segCount: 9,               // 同时存在的轨道段数
  sideLength: 150,           // 侧景循环长度
  spawnAhead: 190,           // 预生成距离
  despawnBehind: 36,

  // 相机
  camFov: 58,
  camFovPortrait: 73,
  camPos: { x: 0, y: 3.55, z: -6.6 },
  camPosPortrait: { x: 0, y: 3.75, z: -7.6 },
  camLook: { x: 0, y: 1.3, z: 9 },
  camLag: 7.5,               // 跟随阻尼
  fovKick: 7,                // 极速时 FOV 附加

  // 金币
  coinValue: 10,
  nearMissBonus: 25,

  // 计分
  scorePerMeter: 1,
};

export const COLORS = {
  fog: 0x0d1326,
  skyTop: 0x070a16,
  skyBottom: 0x24365e,
  moon: 0xfff3d0,
  ballast: 0x1c1f28,
  sleeper: 0x3a2f26,
  rail: 0xb9c4d8,
  pillar: 0x222736,
  lamp: 0xffd9a0,
  building: 0x0e1322,
  windowWarm: 0xffca7a,
  windowCool: 0x9fd0ff,
  safetyStrip: 0xe8ad45,
  trainBody: 0xdfe8f2,
  trainStripe: 0xf5b83d,
  trainWindow: 0xbfe9ff,
  headlight: 0xfff6d8,
  // 角色
  hoodie: 0x24867a,
  hoodieDark: 0x14524b,
  skin: 0xe8b88a,
  pants: 0x2a2f3d,
  shoe: 0xff8a3d,
  pack: 0x23262d,
  packStripe: 0xf0a83c,
  screen: 0x7fd8ff,
  headphone: 0x1b1e24,
  badge: 0xf5f0e6,
  // 障碍
  barrierLow: 0xd9552f,
  barrierLowDark: 0x8f3418,
  barrierHigh: 0x3f6fb5,
  barrierHighDark: 0x274a80,
  trainSide: 0xb9c6d6,
};
