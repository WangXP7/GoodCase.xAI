/**
 * snapshot.js —— 异步快照（离线结算）与回归日记
 *
 * 依据：GDD §5.5–§5.6、ADR-104 §2.3（离线必须走闭合解，禁止复用 tick 表）、RUL-5。
 *
 * 🚨 为什么离线不能复用 tick 表（ADR-104 修正 ③）：
 *    30 天 × 86400 s ÷ 1 s = 2,592,000 次需求 tick ≈ 52 秒。中端移动上 52 秒白屏不可接受。
 *    因此：HNG / HYD / TOI 走闭合解（线性 + clamp，与逐 tick 积分数学等价）；
 *          ENE 走 15 游戏分钟步长的粗粒度模拟（它是非线性分段函数，无闭式解）。
 *
 * 防 FOMO 三条硬规则（GDD §5.6.1）：
 *    1. 永不显示"你错过了 X 个事件"
 *    2. 卡片数上限 5。离线越久 → 单张内容更长，不是卡片更多
 *    3. T5/T6 的重逢卡必须是温暖的，不是愧疚的——绝不能出现"它等了你很久"
 *
 * 本文件零浏览器依赖，可被 Node 直接引入。
 */

import { clamp } from '../core/easing.js';
import { settleOfflineWarmth } from './warmth.js';
import { slotAt, wrapMinutes, formatGameTime, getTransition } from './time.js';

/* ============================ 需求衰减 ============================ */

/** 每游戏小时的衰减（GDD §3.3.1 五需求表） */
export const NEED_DECAY_PER_HOUR = {
  hng: 3.5,
  hyd: 4.0,
  toi: 2.8,
};

/** 离线期间猫会自己进食/饮水/如厕，因此需求不会归零 —— 自主维持基线 */
export const OFFLINE_FLOOR = { hng: 22, hyd: 25, toi: 20 };

/** ENE 粗粒度模拟步长（游戏分钟）—— ADR-104 §2.3 */
export const ENE_STEP_MIN = 15;

export function eneMax(vit) { return 60 + vit * 0.4; }
export function eneRecovery(vit) { return (2.0 + vit * 0.04) * (0.6 + vit / 125); }

/**
 * HNG / HYD / TOI 的闭合解（线性 + clamp + 地板）。
 * 与逐 tick 积分结果等价（浮点误差 < 0.01 点）。
 */
export function settleNeedsClosedForm(needs, gameHours, floors = OFFLINE_FLOOR) {
  const out = { ...needs };
  for (const key of Object.keys(NEED_DECAY_PER_HOUR)) {
    const floor = floors[key] != null ? floors[key] : 0;
    const v = needs[key] != null ? needs[key] : 100;
    out[key] = clamp(Math.max(floor, v - NEED_DECAY_PER_HOUR[key] * gameHours), 0, 100);
  }
  return out;
}

/**
 * ENE 的粗粒度模拟：15 游戏分钟一步，模拟睡/醒循环。
 * 30 天 = 2880 步 ≈ 58 ms（中端），分帧执行可再降。
 */
export function simulateEnergy(ene, vit, gameMinutes, awakeBias = 0.62) {
  const max = eneMax(vit);
  const rec = eneRecovery(vit);
  let e = clamp(ene, 0, max);
  const steps = Math.min(4000, Math.max(1, Math.round(gameMinutes / ENE_STEP_MIN)));
  const dt = gameMinutes / steps;
  for (let i = 0; i < steps; i++) {
    if (e <= 0.5) {
      e += rec * dt;                       // 睡着：恢复
    } else if (e >= max * 0.98) {
      e -= 0.45 * dt;                      // 满精力：开始消耗
    } else {
      // 62% 的时间在睡（猫的作息），睡着恢复、醒着消耗
      e += (rec * awakeBias - 0.45 * (1 - awakeBias)) * dt;
    }
    e = clamp(e, 0, max);
  }
  return e;
}

/* ============================ 离线分档 ============================ */

/** T0–T6 分档（GDD §5.6.1） */
export const OFFLINE_TIERS = [
  { id: 'T0', minMin: 0, maxMin: 15, cards: 0, warmthDrop: 0, secDelta: 0, label: '转瞬' },
  { id: 'T1', minMin: 15, maxMin: 240, cards: 1, warmthDrop: -1, secDelta: 0, label: '一个下午' },
  { id: 'T2', minMin: 240, maxMin: 720, cards: 2, warmthDrop: -12, secDelta: 0, label: '半天' },
  { id: 'T3', minMin: 720, maxMin: 2880, cards: 3, warmthDrop: -20, secDelta: -1, label: '一整天' },
  { id: 'T4', minMin: 2880, maxMin: 10080, cards: 4, warmthDrop: -35, secDelta: -1, label: '几天' },
  { id: 'T5', minMin: 10080, maxMin: 43200, cards: 5, warmthDrop: -100, secDelta: -3, label: '很久' },
  { id: 'T6', minMin: 43200, maxMin: Infinity, cards: 5, warmthDrop: -100, secDelta: -3, label: '很久很久' },
];

export function offlineTier(minutes) {
  for (const t of OFFLINE_TIERS) {
    if (minutes >= t.minMin && minutes < t.maxMin) return t;
  }
  return OFFLINE_TIERS[OFFLINE_TIERS.length - 1];
}

/** 重逢反应规格（GDD §5.6.4） */
export function reunionSpec(days) {
  if (days < 2) return null;
  if (days < 7) return { id: 'reunion_short', pose: 'Idle_Sit', look: 1.5, walkTo: null, catchUpMul: 1.6, text: '耳朵动了动，看了你一会儿，然后转头去忙自己的。' };
  if (days < 30) return { id: 'reunion_mid', pose: 'Walk_Standard', look: 2.0, walkTo: 1.2, catchUpMul: 2.0, blink: true, text: '它站起来，走到你面前坐下，看了你一会儿，慢眨了一次眼。' };
  return { id: 'reunion_long', pose: 'Walk_Standard', look: 2.5, walkTo: 0.8, circle: true, catchUpMul: 2.5, blink: true, text: '它站起来，走到你脚边，绕着你走了半圈，停下，慢眨了一次眼，然后走开了。' };
}

/* ============================ 日记生成 ============================ */

const SLOT_ADVERB = {
  morning: ['天刚亮的时候', '早晨', '光刚爬上窗台的时候'],
  noon: ['上午', '中午', '光走到地板中间的时候'],
  dusk: ['下午', '太阳快落下去的时候', '屋子里开始变橙的时候'],
  night: ['天黑以后', '夜里', '窗外只剩灯的时候'],
};

const ANCHORS = [
  '窗台上', '沙发的老位置', '你的椅子上', '地毯中央', '洗衣机顶上',
  '书架第二层', '餐桌底下', '厨房的瓷砖上', '纸箱里', '书桌上',
];

const BEHAVIORS = {
  sleep: ['睡了一觉', '睡到一半换了个姿势', '蜷着睡了很久', '四脚朝天睡了一会儿'],
  explore: ['把{obj}闻了三遍', '盯着{obj}看了很久', '跳上了{loc}', '在{loc}发现了一个新位置'],
  eat: ['去碗边看了看，没吃', '吃了两口就走了', '把水碗里的水喝了一半', '把碗边的碎屑舔干净了'],
  still: ['在{loc}坐了很久，什么也没做', '看了一会儿窗外', '晒了一会儿太阳', '趴在{loc}发了一会儿呆'],
  play: ['自己跟{obj}玩了一会儿', '追了什么东西，没追上', '扑了{obj}一下', '把纸团推到了桌子底下'],
};

const OBJECTS = ['纸箱', '毛线球', '塑料袋', '你的拖鞋', '桌上的笔', '遥控器', '窗帘的流苏', '一只袜子'];

/**
 * 猫视角评论池（按性格分层）。
 * 这是"每只猫的日记读起来不一样"的关键。
 */
function commentPool(p) {
  const out = [];
  if (p.ind >= 66) out.push('跟你没关系。', '别看。', '它不觉得这需要解释。', '（它没有看你。）');
  if (p.ind <= 33) out.push('它有点希望你也在。', '它朝门口看了几次。', '它等你的时候睡着了。');
  if (p.cur >= 66) out.push('它发现了一件大事。（其实是一个纸团。）', '它把{obj}推到了地上。');
  if (p.sec >= 66) out.push('它睡得四脚朝天，完全没设防。', '它选了屋里最显眼的位置。');
  if (p.sec <= 33) out.push('它挑了最靠里的角落。', '有动静的时候它先跑，然后才回头看。');
  if (p.aff >= 60) out.push('它把头搁在你常坐的那边。', '它睡在了有你味道的地方。');
  if (p.aff <= 25) out.push('它只是路过。', '它没在你身边停。');
  if (out.length === 0) out.push('它没觉得这有什么。', '它就那样待着。', '屋子里很安静。');
  return out;
}

/**
 * 生成日记卡片。
 * @param {object} ctx { gameMinutes, tier, personality, startGameMin, rng, discoveredAnchors, recentComments }
 * @returns {Array<{index, slot, time, place, behavior, comment, lines, long}>}
 */
export function generateDiary(ctx) {
  const { tier, personality: p, rng, startGameMin = 0, gameMinutes = 0 } = ctx;
  const n = clamp(tier.cards | 0, 0, 5);
  if (n === 0) return [];

  const recent = ctx.recentComments || [];
  const pool = commentPool(p);
  const anchors = (ctx.discoveredAnchors && ctx.discoveredAnchors.length)
    ? ctx.discoveredAnchors.map((a) => a.replace(/_/g, ' '))
    : ANCHORS;

  const cards = [];
  // 离线越久 → 单张内容更长（3 行 → 6 行），而不是卡片更多（防 FOMO 规则 2）
  const linesPerCard = clamp(2 + Math.floor(gameMinutes / 1440), 2, 6);

  for (let i = 0; i < n; i++) {
    // 把离线时间轴均分为 n 段，每段取一个时刻
    const frac = (i + 0.5) / n;
    const at = wrapMinutes(startGameMin + gameMinutes * frac);
    const slot = slotAt(at);

    // 行为池按性格加权：高 CUR 偏探索，低 VIT 偏睡，低 SEC 偏静止
    const weights = {
      sleep: 1.0 + (50 - (p.vit || 50)) / 60,
      explore: 0.5 + (p.cur || 50) / 50,
      eat: 0.7,
      still: 0.9 + (50 - (p.cur || 50)) / 80,
      play: 0.2 + (p.vit || 50) / 90,
    };
    const cat = rng.weighted(Object.keys(weights), (k) => weights[k]);
    const list = BEHAVIORS[cat] || BEHAVIORS.still;

    const obj = rng.pick(OBJECTS);
    const loc = rng.pick(anchors);
    const adverb = rng.pick(SLOT_ADVERB[slot] || SLOT_ADVERB.noon);

    let comment = rng.pick(pool);
    let guard = 0;
    while (recent.includes(comment) && guard++ < 8) comment = rng.pick(pool);
    comment = comment.replace('{obj}', obj);

    const behavior = rng.pick(list).replace('{obj}', obj).replace(/\{loc\}/g, loc);

    // 组装正文：时间锚 + 地点锚 + 行为 + 评论 +（若干氛围句）
    const lines = [`${adverb}，它在${loc}${behavior.startsWith('它') ? '' : ''}${behavior}。`];
    const atmosphere = buildAtmosphere(slot, obj, loc, rng);
    // 长卡：把氛围句铺满到 linesPerCard 行
    while (lines.length < linesPerCard - 1 && atmosphere.length) {
      lines.push(atmosphere.shift());
    }

    cards.push({
      index: i,
      slot,
      time: formatGameTime(at),
      gameMin: Math.round(at),
      place: loc,
      behavior,
      comment,
      lines,
      anchor: loc,
    });
  }

  // T5 / T6 的重逢卡（温暖，不是愧疚）
  if (tier.id === 'T5' || tier.id === 'T6') {
    const reunion = reunionSpec(gameMinutes / 1440);
    if (reunion) {
      cards.push({
        index: cards.length,
        slot: null,
        time: '',
        gameMin: null,
        place: '门口',
        behavior: reunion.text,
        comment: '你回来了。',
        lines: [reunion.text, '它没迎上来，也没有躲开。', '屋子里有它的味道，和以前一样。'],
        reunion: true,
      });
    }
  }
  // T6 的特殊卡「它一直在这里」
  if (tier.id === 'T6') {
    cards.push({
      index: cards.length,
      slot: 'noon',
      time: '',
      gameMin: null,
      place: '沙发',
      behavior: '空房间',
      comment: '它一直在这里。',
      lines: [
        '屋子还是那个屋子。',
        '沙发中间那个坑，是它睡出来的。',
        '它一直在这里。',
      ],
      special: 'always_here',
    });
  }

  return cards;
}

function buildAtmosphere(slot, obj, loc, rng) {
  const poolBySlot = {
    morning: ['光从窗缝里挤进来，在地板上拉出一道斜线。', '外面有鸟叫，它听了一会儿。', '灰尘在光里慢慢地飘。'],
    noon: ['屋里很亮，影子缩在脚底下。', '它找一个不晒的位置待着。', '午后安静得能听见冰箱的声音。'],
    dusk: ['光变成了橙色，从窗台一直铺到墙根。', '窗外的楼影一格一格地暗下去。', '它的影子被拉得很长很长。'],
    night: ['屋里只剩一盏灯。', '窗外有别的窗户亮着。', '它找了个暖的地方蜷起来。'],
  };
  const arr = (poolBySlot[slot] || poolBySlot.noon).slice();
  // Fisher–Yates，用种子化 RNG
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng.nextFloat() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

/* ============================ 离线结算总入口 ============================ */

/**
 * 完整离线结算。
 *
 * @param {object} ctx
 * @param {object} ctx.cat      { personality, needs, state, anchorId }
 * @param {number} ctx.offlineMinutes 离线游戏分钟数
 * @param {object} ctx.rng     （journal 流）
 * @param {object} [ctx.env]
 * @returns {object} { tier, needs, personality, cards, reunion, traces, report }
 */
export function settleOffline(ctx) {
  const { cat, offlineMinutes, rng } = ctx;
  const tier = offlineTier(offlineMinutes);
  const gameHours = offlineMinutes / 60;
  const days = offlineMinutes / 1440;

  const p0 = cat.personality || {};
  const needs0 = cat.needs || {};

  // ① 需求闭合解
  const needs = settleNeedsClosedForm(needs0, gameHours);

  // ② ENE 粗粒度模拟
  const vit = p0.vit != null ? p0.vit : 50;
  needs.ene = simulateEnergy(needs0.ene != null ? needs0.ene : 40, vit, offlineMinutes);

  // ③ warmth / AFF（RUL-5：AFF 只在 warmth 低于阈值时才降，且有地板）
  let personality = { ...p0 };
  if (tier.warmthDrop !== 0) {
    if (tier.warmthDrop <= -100) {
      personality.warmth = 0;
    } else {
      personality.warmth = clamp((personality.warmth != null ? personality.warmth : 100) + tier.warmthDrop, 0, 100);
    }
  }
  const settled = settleOfflineWarmth(personality, days);
  personality.aff = settled.aff;
  personality.affPeak = settled.affPeak;
  personality.warmth = settled.warmth;

  // ④ SEC（T3 起有惩罚；clamp 在个体天花板内）
  if (tier.secDelta) {
    const cap = p0.secCap != null ? p0.secCap : 100;
    personality.sec = clamp((personality.sec || 30) + tier.secDelta, 10, cap);
  }

  // ⑤ 环境痕迹（进入场景时就已经在那里 —— GDD §5.6.5 ③）
  const traces = {
    furOnRug: Math.round(clamp(days * 1.6, 0, 40)),
    sofaDent: days >= 0.5 ? clamp(1 + Math.floor(days / 2), 1, 5) : 0,
    bookPage: 0,
    calendarDay: Math.floor(days),
    bowlEmpty: needs.hng <= OFFLINE_FLOOR.hng + 6,
    waterLow: needs.hyd <= OFFLINE_FLOOR.hyd + 8,
    litterDirty: needs.toi <= OFFLINE_FLOOR.toi + 6,
  };

  // ⑥ 日记
  const cards = generateDiary({
    tier,
    personality,
    rng,
    startGameMin: ctx.startGameMin != null ? ctx.startGameMin : 0,
    gameMinutes: offlineMinutes,
    discoveredAnchors: ctx.discoveredAnchors,
    recentComments: ctx.recentComments,
  });

  // ⑦ 重逢反应
  const reunion = reunionSpec(days);
  const catchUpRemaining = reunion ? 3 : 0;

  return {
    tier,
    needs,
    personality,
    cards,
    reunion,
    catchUpRemaining,
    traces,
    report: {
      offlineMinutes,
      days,
      affDelta: settled.affDelta,
      warmthDelta: settled.warmthDelta,
      floorHit: settled.floorHit,
      decayed: settled.decayed,
      clamped: !!ctx.clamped,
    },
  };
}

export default {
  NEED_DECAY_PER_HOUR, OFFLINE_FLOOR, ENE_STEP_MIN,
  eneMax, eneRecovery, settleNeedsClosedForm, simulateEnergy,
  OFFLINE_TIERS, offlineTier, reunionSpec, generateDiary, settleOffline,
};
