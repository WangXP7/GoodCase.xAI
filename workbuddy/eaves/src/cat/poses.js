/**
 * poses.js —— MVP 12 姿态数据（GDD 附录 C 行 1513–1548 / 美术圣经 §4.6.1 行 851–868）
 *
 * 12 个姿态覆盖 15 个状态机状态 + 6 级拒绝 + 重逢反应（缺口用"参数化 + 变体"补齐，零缺口）。
 *
 * ┌─ 坐标 / 角度约定（与 model.js 的 rig、animator.js 的驱动一一对应）──────────────┐
 * │ 单位：米 / 弧度。欧拉 XYZ。模型建于"站立中立姿"，所有关节旋转 = 0。              │
 * │ 姿态数据是**相对站立中立姿的绝对目标**（不是增量），由 animator 做姿态间插值。    │
 * │                                                                                │
 * │   root   pos[3] 整体升降/平移；rot[3] 整体旋转（躺倒、转身）                     │
 * │   body   rot[3] 躯干俯仰：+x = 胸口下沉（趴/够食），−x = 胸口抬起（坐）           │
 * │   chest  scale[3] 呼吸（由 animator 叠加，姿态里一般不动）                        │
 * │   neck   rot[3] 颈椎：+x = 低头，−x = 抬头                                        │
 * │   head   rot[3] 头：+x = 低头，+y = 向左转头，+z = 歪头                            │
 * │   earL/R rot[3] +x = 向后压（飞机耳方向），±z = 外展/内收，+y = 转动                │
 * │   jay    rot[3] +x = 张嘴                                                         │
 * │   legFL/FR/BL/BR  rot[3] 髋/肩：−x = 爪向前摆，+x = 爪向后摆，±z = 外八/内八          │
 * │   kneeFL/FR/BL/BR rot[3] 膝/肘：+x = 小腿向后折（下蹲/坐）                          │
 * │   tailSegments[0..7] rot[3] 由 tailCurve() 展开：段 0 为基准角，其后每段累加 bend   │
 * │      +x = 尾尖向上卷（越正越上翘），−x = 尾尖向下/向后                              │
 * │   eyeL/R  lid（0=闭，1=睁）                                                        │
 * │   pupilL/R scale[x,y] 瞳孔缩放：约 [0.55,1.0] 为竖瞳，[1.3,1.3] 为扩张              │
 * └────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ 角度值是按猫的解剖常识 + 美术圣经描述给出的**首版手调值**，供渲染后在浏览器里
 *    微调（用户为资深 Three.js 开发者，可由 Performance/Inspector 直接调到满意）。
 *    结构与语义已冻结，调数值不影响任何接口。
 */

/* ============================================================================
 * 尾巴曲线展开
 * ========================================================================== */

export const TAIL_SEGMENTS = 8;

/**
 * 把"尾曲线参数"展开成 8 段骨骼的**局部**欧拉角。
 *
 * ⚠️ 关键：8 段是**链式**父子关系，每段的局部旋转会沿链累加。
 *   因此"每段弯 bend"必须表达为 `seg[i] = bend`（i≥1），而不是 `base + bend*i` ——
 *   后者会让世界角按二次方增长（尾巴瞬间打结）。
 *   世界角 = base + bend × i（roll 同理按段累加）。
 *
 * @param {number} base  段 0 的局部 X 角（尾根朝向）：−1.45 ≈ 水平向后；−0.15 ≈ 竖直向上
 * @param {number} bend  段 1..7 的局部 X 角（正 = 逐段上卷成问号/环抱；负 = 逐段下垂）
 * @param {number} roll  每段局部 Y 角（侧向甩动/绕身）
 * @param {number} scaleXZ 尾径缩放（炸毛 → 1.6；正常 1.0）
 * @returns {{segs:number[][], scaleXZ:number}}
 */
export function tailCurve(base = -1.45, bend = 0, roll = 0, scaleXZ = 1) {
  const segs = [];
  for (let i = 0; i < TAIL_SEGMENTS; i++) {
    segs.push(i === 0 ? [base, roll, 0] : [bend, roll, 0]);
  }
  return { segs, scaleXZ };
}

/** 尾曲线在"世界角"意义上的第 i 段朝向（供调试/断言） */
export function tailWorldAngle(base, bend, i) { return base + bend * i; }

/* ============================================================================
 * 12 个 MVP 姿态
 * ========================================================================== */

/* --- 1. 蜷成一团睡（深睡主力） --- */
const Sleep_Curl_Ball = {
  label: '蜷成一团睡',
  states: ['SLEEP_DEEP'],
  dwellMin: 45,
  loop: true,
  joints: {
    root: { pos: [0, -0.060, 0.010] },
    body: { rot: [0.18, 0, 0] },                 // 收腹蜷起
    neck: { rot: [0.28, 0.18, 0] },
    head: { rot: [0.50, 0.28, 0.12] },           // 头埋向身体
    earL: { rot: [0.10, 0, 0.30] },              // 松弛下垂
    earR: { rot: [0.10, 0, -0.30] },
    legFL: { rot: [-0.30, 0, 0.28] }, kneeFL: { rot: [1.85, 0, 0] },
    legFR: { rot: [-0.30, 0, -0.28] }, kneeFR: { rot: [1.85, 0, 0] },
    legBL: { rot: [0.40, 0, 0.34] }, kneeBL: { rot: [2.00, 0, 0] },
    legBR: { rot: [0.40, 0, -0.34] }, kneeBR: { rot: [2.00, 0, 0] },
  },
  tail: { base: -1.15, bend: 0.30, roll: 0.05, scaleXZ: 1 },
  eyes: { lid: 0.05, pupilX: 0.45, pupilY: 0.80 },
  mouth: { open: 0, flehmen: 0 },
  secondary: { breathAmp: 1.50, breathRate: 0.32, tailWaveAmp: 0.08, tailWaveFreq: 0.12, earTwitch: 0.02, jawIdle: 0 },
};

/* --- 2. 四脚朝天睡（高 SEC 变体 · 截图种子） --- */
const Sleep_BellyUp = {
  label: '四脚朝天睡',
  states: ['SLEEP_DEEP'],
  dwellMin: 45,
  loop: true,
  joints: {
    // 绕前向轴（Z）翻转 ≈ 165°：背部贴地、四爪朝天、头仍朝 +Z
    root: { pos: [0, 0.155, 0], rot: [0, 0, Math.PI * 0.92] },
    body: { rot: [0.05, 0, 0] },
    neck: { rot: [-0.20, 0.10, 0] },
    head: { rot: [-0.10, 0.20, -0.10] },
    earL: { rot: [0.05, 0, 0.35] },
    earR: { rot: [0.05, 0, -0.35] },
    legFL: { rot: [0.20, 0, 0.35] }, kneeFL: { rot: [0.70, 0, 0] },
    legFR: { rot: [0.20, 0, -0.35] }, kneeFR: { rot: [0.70, 0, 0] },
    legBL: { rot: [0.35, 0, 0.45] }, kneeBL: { rot: [0.90, 0, 0] },
    legBR: { rot: [0.35, 0, -0.45] }, kneeBR: { rot: [0.90, 0, 0] },
  },
  tail: { base: -1.60, bend: 0.04, roll: 0.28, scaleXZ: 1 },
  eyes: { lid: 0.05, pupilX: 0.40, pupilY: 0.75 },
  mouth: { open: 0.05, flehmen: 0 },
  secondary: { breathAmp: 1.35, breathRate: 0.34, tailWaveAmp: 0.10, tailWaveFreq: 0.15, earTwitch: 0.02, jawIdle: 0 },
};

/* --- 3. 坐姿（REST 枢纽 · 最重要） --- */
const Idle_Sit = {
  label: '坐姿',
  states: ['REST'],
  dwellMin: 8,
  loop: true,
  joints: {
    root: { pos: [0, -0.032, 0] },
    body: { rot: [-0.30, 0, 0] },                // 胸口抬起、臀部下沉
    neck: { rot: [0.12, 0, 0] },
    head: { rot: [-0.04, 0, 0] },
    earL: { rot: [0, 0, 0.10] },
    earR: { rot: [0, 0, -0.10] },
    legFL: { rot: [-0.10, 0, 0.05] }, kneeFL: { rot: [0.10, 0, 0] },
    legFR: { rot: [-0.10, 0, -0.05] }, kneeFR: { rot: [0.10, 0, 0] },
    legBL: { rot: [-0.55, 0, 0.15] }, kneeBL: { rot: [1.55, 0, 0] },   // 后腿折于体侧
    legBR: { rot: [-0.55, 0, -0.15] }, kneeBR: { rot: [1.55, 0, 0] },
  },
  tail: { base: -1.36, bend: 0.06, roll: 0, scaleXZ: 1 },
  eyes: { lid: 1.0, pupilX: 0.60, pupilY: 1.0 },
  mouth: { open: 0, flehmen: 0 },
  secondary: { breathAmp: 1.0, breathRate: 0.50, tailWaveAmp: 0.35, tailWaveFreq: 0.35, earTwitch: 0.06, jawIdle: 0 },
};

/* --- 4. 漫步（TRANSIT / 探索 · 1.0s 循环） --- */
const Walk_Standard = {
  label: '漫步',
  states: ['TRANSIT', 'EXPLORE', 'WARMUP'],
  dwellMin: 0.6,
  loop: true,
  joints: {
    root: { pos: [0, 0.004, 0] },
    body: { rot: [-0.02, 0, 0] },
    neck: { rot: [0.02, 0, 0] },
    head: { rot: [-0.02, 0, 0] },
    earL: { rot: [0, 0, 0.08] }, earR: { rot: [0, 0, -0.08] },
    // 四足对角步态的一帧（对角支撑）：FL/BR 前摆，FR/BL 后撑
    legFL: { rot: [-0.38, 0, 0.05] }, kneeFL: { rot: [0.30, 0, 0] },
    legFR: { rot: [0.34, 0, -0.05] }, kneeFR: { rot: [0.48, 0, 0] },
    legBL: { rot: [0.30, 0, 0.08] }, kneeBL: { rot: [0.42, 0, 0] },
    legBR: { rot: [-0.30, 0, -0.08] }, kneeBR: { rot: [0.30, 0, 0] },
  },
  tail: { base: -1.18, bend: 0.09, roll: 0, scaleXZ: 1 },
  eyes: { lid: 1.0, pupilX: 0.62, pupilY: 1.0 },
  mouth: { open: 0, flehmen: 0 },
  secondary: { breathAmp: 1.10, breathRate: 0.85, tailWaveAmp: 0.60, tailWaveFreq: 0.80, earTwitch: 0.05, jawIdle: 0, walkCycle: true },
};

/* --- 5. 抬头看玩家（求关注 / 警觉片段） --- */
const Look_Up_At_Player = {
  label: '抬头看玩家',
  states: ['SEEK_ATTENTION', 'ALERT'],
  dwellMin: 0.5,
  loop: true,
  joints: {
    root: { pos: [0, -0.032, 0] },
    body: { rot: [-0.30, 0, 0] },
    neck: { rot: [-0.32, 0, 0] },                 // 颈上抬
    head: { rot: [-0.55, 0, 0] },                 // 头仰起看玩家
    earL: { rot: [-0.25, 0, 0.12] },              // 耳前倾
    earR: { rot: [-0.25, 0, -0.12] },
    legFL: { rot: [-0.10, 0, 0.05] }, kneeFL: { rot: [0.10, 0, 0] },
    legFR: { rot: [-0.10, 0, -0.05] }, kneeFR: { rot: [0.10, 0, 0] },
    legBL: { rot: [-0.55, 0, 0.15] }, kneeBL: { rot: [1.55, 0, 0] },
    legBR: { rot: [-0.55, 0, -0.15] }, kneeBR: { rot: [1.55, 0, 0] },
  },
  tail: { base: -0.88, bend: 0.16, roll: 0, scaleXZ: 1 },   // 问号尾（友好）
  eyes: { lid: 0.92, pupilX: 0.85, pupilY: 1.05 },
  mouth: { open: 0.12, flehmen: 0 },                         // 可能喵一声
  secondary: { breathAmp: 1.05, breathRate: 0.70, tailWaveAmp: 0.75, tailWaveFreq: 0.90, earTwitch: 0.08, jawIdle: 0 },
};

/* --- 6. 蹭手 Headbonk（AFF≥60 稀有变体 · 情感锚点 B） --- */
const Headbonk = {
  label: '蹭手',
  states: ['SEEK_ATTENTION'],
  dwellMin: 1.2,
  loop: false,
  joints: {
    root: { pos: [0, -0.028, 0.022] },
    body: { rot: [-0.26, 0.06, 0] },
    neck: { rot: [-0.10, 0.12, 0.10] },
    head: { rot: [-0.16, 0.18, 0.18] },          // 头侧偏去顶/蹭
    earL: { rot: [-0.30, 0, 0.10] },
    earR: { rot: [-0.30, 0, -0.10] },
    legFL: { rot: [-0.14, 0, 0.05] }, kneeFL: { rot: [0.12, 0, 0] },
    legFR: { rot: [-0.14, 0, -0.05] }, kneeFR: { rot: [0.12, 0, 0] },
    legBL: { rot: [-0.55, 0, 0.15] }, kneeBL: { rot: [1.55, 0, 0] },
    legBR: { rot: [-0.55, 0, -0.15] }, kneeBR: { rot: [1.55, 0, 0] },
  },
  tail: { base: -0.52, bend: 0.22, roll: 0, scaleXZ: 1 },    // 高扬问号尾
  eyes: { lid: 0.55, pupilX: 0.80, pupilY: 1.00 },           // 半闭眼 = 信任
  mouth: { open: 0.10, flehmen: 0 },
  secondary: { breathAmp: 1.10, breathRate: 0.55, tailWaveAmp: 0.85, tailWaveFreq: 0.55, earTwitch: 0.05, jawIdle: 0 },
};

/* --- 7. 转身走开（REJECT R3/R6） --- */
const Reject_WalkAway = {
  label: '转身走开',
  states: ['REJECT'],
  dwellMin: 0.6,
  loop: false,
  joints: {
    root: { pos: [0, 0.004, 0], rot: [0, -0.60, 0] },        // 整个身体转开
    body: { rot: [0.08, -0.24, 0] },
    neck: { rot: [0.06, -0.20, 0] },
    head: { rot: [0.04, -0.50, 0] },                          // 头扭开、不看你
    earL: { rot: [0.55, 0, 0.30] },                           // 耳后压（Pinned）
    earR: { rot: [0.55, 0, -0.30] },
    legFL: { rot: [-0.34, 0, 0.05] }, kneeFL: { rot: [0.30, 0, 0] },
    legFR: { rot: [0.30, 0, -0.05] }, kneeFR: { rot: [0.48, 0, 0] },
    legBL: { rot: [0.28, 0, 0.08] }, kneeBL: { rot: [0.42, 0, 0] },
    legBR: { rot: [-0.28, 0, -0.08] }, kneeBR: { rot: [0.30, 0, 0] },
  },
  tail: { base: -1.05, bend: -0.06, roll: 0, scaleXZ: 1 },   // 低垂 + 急甩（animator 叠加）
  eyes: { lid: 0.72, pupilX: 0.50, pupilY: 0.90 },
  mouth: { open: 0, flehmen: 0 },
  secondary: { breathAmp: 1.0, breathRate: 1.0, tailWaveAmp: 1.0, tailWaveFreq: 1.8, earTwitch: 0.03, jawIdle: 0, walkCycle: true },

  /** R5「拍击」是 Play_BatToy 帧 2–4 的派生片段（美术圣经 §4.6.1.1，不占新编号） */
  derived: {
    R5_Swat: {
      fromPose: 'Play_BatToy',
      armMask: ['legFL', 'legFR', 'kneeFL', 'kneeFR', 'neck', 'head'],
      lockLowerBody: true,
      redirect: 'playerHandAnchor',
      tailOverride: { base: -1.10, bend: -0.08, roll: 0.0, scaleXZ: 1 },
      earOverride: { earL: [0.60, 0, 0.32], earR: [0.60, 0, -0.32] },
    },
  },
};

/* --- 8. 继续做原来的事（NoResponse_Continue） --- */
const NoResponse_Continue = {
  label: '继续做原来的事',
  states: [],
  dwellMin: 0,
  loop: true,
  /** 透传姿态：不改变当前姿态，仅叠加 Ear-ack（GDD §4.4.1 / RUL-6 ③） */
  passthrough: true,
  joints: {},
  tail: {},
  eyes: { lid: 1.0, pupilX: 0.60, pupilY: 1.0 },
  mouth: { open: 0, flehmen: 0 },
  secondary: { breathAmp: 1.0, breathRate: 0.50, tailWaveAmp: 0.35, tailWaveFreq: 0.35, earTwitch: 0.30, jawIdle: 0 },
};

/* --- 9. 埋头吃 --- */
const Eat_FromBowl = {
  label: '埋头吃',
  states: ['EAT'],
  dwellMin: 2.5,
  loop: true,
  joints: {
    root: { pos: [0, -0.045, 0.020] },
    body: { rot: [0.22, 0, 0] },                 // 胸口下沉
    neck: { rot: [0.42, 0, 0] },
    head: { rot: [0.55, 0, 0] },                 // 鼻尖埋向碗
    earL: { rot: [0.06, 0, 0.12] },
    earR: { rot: [0.06, 0, -0.12] },
    legFL: { rot: [-0.14, 0, 0.05] }, kneeFL: { rot: [0.16, 0, 0] },
    legFR: { rot: [-0.14, 0, -0.05] }, kneeFR: { rot: [0.16, 0, 0] },
    legBL: { rot: [-0.50, 0, 0.15] }, kneeBL: { rot: [1.42, 0, 0] },
    legBR: { rot: [-0.50, 0, -0.15] }, kneeBR: { rot: [1.42, 0, 0] },
  },
  tail: { base: -1.30, bend: 0.05, roll: 0, scaleXZ: 1 },
  eyes: { lid: 0.50, pupilX: 0.62, pupilY: 1.00 },
  mouth: { open: 0.20, flehmen: 0 },
  secondary: { breathAmp: 0.85, breathRate: 0.80, tailWaveAmp: 0.25, tailWaveFreq: 0.25, earTwitch: 0.03, jawIdle: 3.2 },
};

/* --- 10. 舔水 --- */
const Drink_Water = {
  label: '舔水',
  states: ['DRINK'],
  dwellMin: 1.5,
  loop: true,
  joints: {
    root: { pos: [0, -0.048, 0.020] },
    body: { rot: [0.24, 0, 0] },
    neck: { rot: [0.48, 0, 0] },
    head: { rot: [0.60, 0, 0] },
    earL: { rot: [0.04, 0, 0.12] }, earR: { rot: [0.04, 0, -0.12] },
    legFL: { rot: [-0.14, 0, 0.05] }, kneeFL: { rot: [0.16, 0, 0] },
    legFR: { rot: [-0.14, 0, -0.05] }, kneeFR: { rot: [0.16, 0, 0] },
    legBL: { rot: [-0.50, 0, 0.15] }, kneeBL: { rot: [1.42, 0, 0] },
    legBR: { rot: [-0.50, 0, -0.15] }, kneeBR: { rot: [1.42, 0, 0] },
  },
  tail: { base: -1.28, bend: 0.05, roll: 0, scaleXZ: 1 },
  eyes: { lid: 0.45, pupilX: 0.55, pupilY: 0.95 },
  mouth: { open: 0.08, flehmen: 0 },
  secondary: { breathAmp: 0.85, breathRate: 0.90, tailWaveAmp: 0.20, tailWaveFreq: 0.25, earTwitch: 0.03, jawIdle: 5.0 },
};

/* --- 11. 拍打玩具 --- */
const Play_BatToy = {
  label: '拍打玩具',
  states: ['PLAY'],
  dwellMin: 2.5,
  loop: true,
  joints: {
    root: { pos: [0, -0.018, 0.006] },
    body: { rot: [-0.10, 0.04, 0] },
    neck: { rot: [0.16, 0, 0] },
    head: { rot: [0.14, 0.04, 0] },
    earL: { rot: [-0.18, 0, 0.14] }, earR: { rot: [-0.18, 0, -0.14] },
    // 前肢抬起拍打（R5 复用此段）
    legFL: { rot: [-0.95, 0.10, 0.18] }, kneeFL: { rot: [0.70, 0, 0] },
    legFR: { rot: [-0.58, -0.10, -0.18] }, kneeFR: { rot: [0.48, 0, 0] },
    legBL: { rot: [-0.34, 0, 0.16] }, kneeBL: { rot: [1.10, 0, 0] },
    legBR: { rot: [-0.34, 0, -0.16] }, kneeBR: { rot: [1.10, 0, 0] },
  },
  tail: { base: -0.74, bend: 0.13, roll: 0.02, scaleXZ: 1 },
  eyes: { lid: 0.90, pupilX: 1.05, pupilY: 1.05 },   // 瞳孔扩张 = 狩猎专注
  mouth: { open: 0.08, flehmen: 0 },
  secondary: { breathAmp: 1.20, breathRate: 1.00, tailWaveAmp: 0.90, tailWaveFreq: 1.30, earTwitch: 0.06, jawIdle: 0 },
};

/* --- 12. 舔爪 --- */
const Groom_Paw = {
  label: '舔爪',
  states: ['GROOM'],
  dwellMin: 4,
  loop: true,
  joints: {
    root: { pos: [0, -0.034, 0] },
    body: { rot: [-0.20, -0.06, 0] },
    neck: { rot: [0.22, 0.16, 0] },
    head: { rot: [0.38, 0.22, -0.12] },          // 歪头舔前爪
    earL: { rot: [0.05, 0, 0.14] }, earR: { rot: [0.05, 0, -0.14] },
    // 抬起一只前爪来舔
    legFL: { rot: [-1.15, 0.12, 0.14] }, kneeFL: { rot: [1.50, 0, 0] },
    legFR: { rot: [-0.12, 0, -0.05] }, kneeFR: { rot: [0.14, 0, 0] },
    legBL: { rot: [-0.54, 0, 0.15] }, kneeBL: { rot: [1.52, 0, 0] },
    legBR: { rot: [-0.54, 0, -0.15] }, kneeBR: { rot: [1.52, 0, 0] },
  },
  tail: { base: -1.24, bend: 0.06, roll: 0.04, scaleXZ: 1 },
  eyes: { lid: 0.35, pupilX: 0.50, pupilY: 0.90 },   // 半闭，满足
  mouth: { open: 0.15, flehmen: 0 },
  secondary: { breathAmp: 0.90, breathRate: 0.70, tailWaveAmp: 0.20, tailWaveFreq: 0.30, earTwitch: 0.04, jawIdle: 4.0 },
};

/* ============================================================================
 * 姿态表
 * ========================================================================== */

export const POSES = Object.freeze({
  Sleep_Curl_Ball,  // 1
  Sleep_BellyUp,    // 2
  Idle_Sit,         // 3
  Walk_Standard,    // 4
  Look_Up_At_Player,// 5
  Headbonk,         // 6
  Reject_WalkAway,  // 7
  NoResponse_Continue, // 8
  Eat_FromBowl,     // 9
  Drink_Water,      // 10
  Play_BatToy,      // 11
  Groom_Paw,        // 12
});

/** 12 个 MVP 姿态名（按美术圣经 §4.6.1 编号顺序） */
export const POSE_NAMES = Object.freeze([
  'Sleep_Curl_Ball', 'Sleep_BellyUp', 'Idle_Sit', 'Walk_Standard',
  'Look_Up_At_Player', 'Headbonk', 'Reject_WalkAway', 'NoResponse_Continue',
  'Eat_FromBowl', 'Drink_Water', 'Play_BatToy', 'Groom_Paw',
]);

/* ============================================================================
 * 状态 → 姿态映射（GDD 附录 C 行 1513–1548，含"参数化复用"的 6 个缺口）
 * ========================================================================== */

/** 基础映射：状态机 16 个状态全部有落点（零缺口） */
export const POSE_FOR_STATE = Object.freeze({
  SLEEP_DEEP: 'Sleep_Curl_Ball',
  SLEEP_LIGHT: 'Sleep_Curl_Ball',        // 复用 + 参数：耳朵警觉、身体蜷曲度 −20%
  REST: 'Idle_Sit',
  GROOM: 'Groom_Paw',
  EAT: 'Eat_FromBowl',
  DRINK: 'Drink_Water',
  EXPLORE: 'Walk_Standard',
  PLAY: 'Play_BatToy',
  WATCH_WINDOW: 'Idle_Sit',              // 复用 + 参数：朝窗、尾慢摆、瞳孔专注
  HIDE: 'Idle_Sit',                      // 复用 + 参数：身体缩紧 15%、耳后压 0.6
  SEEK_ATTENTION: 'Look_Up_At_Player',
  PETTED: 'Idle_Sit',                    // 复用 + 参数：眯眼渐入 + 尾 Hook
  ALERT: 'Look_Up_At_Player',
  REJECT: 'Reject_WalkAway',
  TRANSIT: 'Walk_Standard',
  WARMUP: 'Walk_Standard',
});

/**
 * 状态专属的"参数化"覆写（附录 C 的"参数化手段"列）。
 * 深拷贝合并到基础姿态上，由 resolvePose() 执行。
 */
export const STATE_VARIANTS = Object.freeze({
  // 浅眠：复用蜷缩，但耳朵保持警觉、蜷曲度 −20%
  SLEEP_LIGHT: {
    joints: {
      body: { rot: [0.10, 0, 0] },
      neck: { rot: [0.18, 0.06, 0] },
      head: { rot: [0.34, 0.14, 0.06] },
      earL: { rot: [-0.10, 0, 0.18] }, earR: { rot: [-0.10, 0, -0.18] },
      legFL: { rot: [-0.18, 0, 0.20] }, kneeFL: { rot: [1.45, 0, 0] },
      legFR: { rot: [-0.18, 0, -0.20] }, kneeFR: { rot: [1.45, 0, 0] },
    },
    tail: { base: -1.28, bend: 0.20, roll: 0.05, scaleXZ: 1 },
    eyes: { lid: 0.22, pupilX: 0.42, pupilY: 0.80 },
    secondary: { breathAmp: 1.25, breathRate: 0.42, earTwitch: 0.35, tailWaveAmp: 0.16, tailWaveFreq: 0.18 },
  },
  // 望窗：Idle_Sit 朝窗 + 尾慢摆 + 瞳孔专注
  WATCH_WINDOW: {
    joints: {
      neck: { rot: [0.05, 0.22, 0] },
      head: { rot: [0.06, 0.34, 0] },
      earL: { rot: [-0.14, 0, 0.10] }, earR: { rot: [-0.14, 0, -0.10] },
    },
    tail: { base: -1.30, bend: 0.14, roll: 0.03, scaleXZ: 1 },
    eyes: { lid: 0.72, pupilX: 0.78, pupilY: 1.02 },
    secondary: { tailWaveAmp: 0.30, tailWaveFreq: 0.22, breathAmp: 0.92, breathRate: 0.48, earTwitch: 0.10 },
  },
  // 躲避：身体缩紧 15%、耳压平 0.6、低位
  HIDE: {
    joints: {
      root: { pos: [0, -0.055, -0.010] },
      body: { rot: [0.16, 0, 0] },
      neck: { rot: [0.30, 0, 0] },
      head: { rot: [0.34, 0, 0] },
      earL: { rot: [0.70, 0, 0.34] }, earR: { rot: [0.70, 0, -0.34] },
    },
    scale: { root: [1, 0.88, 1] },
    tail: { base: -1.62, bend: -0.08, roll: 0, scaleXZ: 1 },   // 夹腿低垂
    eyes: { lid: 0.85, pupilX: 0.95, pupilY: 1.10 },           // 瞳孔放大（害怕）
    secondary: { breathAmp: 0.70, breathRate: 0.95, tailWaveAmp: 0.10, tailWaveFreq: 0.20, earTwitch: 0.12 },
  },
  // 被抚摸：眯眼渐入 + 尾 Hook（AFF 越高越享受）
  PETTED: {
    tail: { base: -0.62, bend: 0.20, roll: 0, scaleXZ: 1 },
    eyes: { lid: 0.30, pupilX: 0.72, pupilY: 1.00 },
    secondary: { breathAmp: 1.05, breathRate: 0.45, tailWaveAmp: 0.50, tailWaveFreq: 0.35, earTwitch: 0.05 },
  },
  // 警觉：Look_Up 片段的 0.4s 版本 + 瞪大
  ALERT: {
    joints: {
      earL: { rot: [-0.40, 0.30, 0.10] }, earR: { rot: [-0.40, -0.30, -0.10] },
      neck: { rot: [-0.28, 0, 0] },
      head: { rot: [-0.42, 0, 0] },
    },
    eyes: { lid: 1.0, pupilX: 1.10, pupilY: 1.15 },
    secondary: { breathAmp: 1.15, breathRate: 1.10, tailWaveAmp: 0.90, tailWaveFreq: 1.60, earTwitch: 0.0 },
  },
  // 重逢：Walk_Standard 走向玩家 + 抬头
  WARMUP: {
    joints: {
      neck: { rot: [-0.12, 0, 0] },
      head: { rot: [-0.22, 0, 0] },
      earL: { rot: [-0.25, 0, 0.12] },
      earR: { rot: [-0.25, 0, -0.12] },
    },
    tail: { base: -0.70, bend: 0.18, roll: 0, scaleXZ: 1 },
    eyes: { lid: 0.85, pupilX: 0.85, pupilY: 1.05 },
  },
});

/* ============================================================================
 * 解析：状态 + 性格 → 具体姿态
 * ========================================================================== */

/**
 * @param {string} state  状态机状态（含 'REJECT'）
 * @param {object} [personality] { aff, ind, cur, sec, vit }
 * @param {object} [opts] { previousState, pettedFromSleep, forceRejectLevel }
 * @returns {string} 姿态名
 */
export function resolvePose(state, personality = {}, opts = {}) {
  const p = personality;
  switch (state) {
    case 'SLEEP_DEEP':
      // 高 SEC → 四脚朝天（美术 §4.7：Sleep_BellyUp 概率 +200%）
      return (p.sec != null && p.sec >= 70) ? 'Sleep_BellyUp' : 'Sleep_Curl_Ball';
    case 'SEEK_ATTENTION':
      // AFF≥60 → 稀有变体「蹭手」
      return (p.aff != null && p.aff >= 60) ? 'Headbonk' : 'Look_Up_At_Player';
    case 'PETTED':
      // 抚摸前若在睡 → 沿用蜷缩；否则坐姿
      return (opts.pettedFromSleep ? 'Sleep_Curl_Ball' : 'Idle_Sit');
    case 'REST':
      return 'Idle_Sit';
    case 'TRANSIT':
    case 'EXPLORE':
    case 'WARMUP':
      return 'Walk_Standard';
    case 'REJECT':
      return 'Reject_WalkAway';
    default:
      return POSE_FOR_STATE[state] || 'Idle_Sit';
  }
}

/**
 * 组合出"姿态 + 该状态的参数化覆写"的最终姿态对象（浅复制，不改动 POSES 原表）。
 * @returns {object} 合并后的姿态数据
 */
export function composePose(poseName, state) {
  const base = POSES[poseName] || POSES.Idle_Sit;
  const variant = STATE_VARIANTS[state];
  const out = {
    name: poseName,
    state,
    label: (variant && variant.label) || base.label,
    loop: base.loop !== false,
    passthrough: !!base.passthrough,
    dwellMin: base.dwellMin,
    joints: { ...(base.joints || {}) },
    scale: { ...(base.scale || {}) },
    tail: { ...(base.tail || {}) },
    eyes: { ...(base.eyes || {}) },
    mouth: { ...(base.mouth || {}) },
    secondary: { ...(base.secondary || {}) },
    derived: base.derived || null,
  };
  if (!variant) return out;
  if (variant.joints) for (const k of Object.keys(variant.joints)) out.joints[k] = variant.joints[k];
  if (variant.scale) for (const k of Object.keys(variant.scale)) out.scale[k] = variant.scale[k];
  if (variant.tail) out.tail = { ...out.tail, ...variant.tail };
  if (variant.eyes) out.eyes = { ...out.eyes, ...variant.eyes };
  if (variant.mouth) out.mouth = { ...out.mouth, ...variant.mouth };
  if (variant.secondary) out.secondary = { ...out.secondary, ...variant.secondary };
  return out;
}

/** 站立中立姿（首次混合的 from 状态） */
export function neutralPose() {
  return composePose('Idle_Sit', null);
}

export default { POSES, POSE_NAMES, POSE_FOR_STATE, STATE_VARIANTS, tailCurve, resolvePose, composePose, neutralPose, TAIL_SEGMENTS };
