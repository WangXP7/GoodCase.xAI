import type {
  BillDefinition,
  HammerDefinition,
  JewelryDefinition,
  PerkDefinition,
  SheepDefinition,
  SkillNodeDefinition
} from "./types";

export const BALANCE_VERSION = "2026.08.12-player-video-fit2";

export const STARTING_MAX_STAMINA = 120;
export const PASSIVE_STAMINA_DRAIN = 0;
export const SHIFT_END_DELAY_MS = 900;

export const COIN_VALUES = {
  silver: 1,
  gold: 5,
  emerald: 25,
  ruby: 100
} as const;

export const SHEEP: SheepDefinition[] = [
  {
    id: "cloud",
    name: "云朵羊",
    subtitle: "普通储蓄罐",
    hp: 24,
    speed: 0.44,
    scale: 1,
    spawnWeight: 64,
    unlockAfterBills: 0,
    staminaRestore: 0,
    color: 0xf2eee1,
    faceColor: 0x4b423d,
    loot: [
      { min: 5, max: 11, chance: 0.72 },
      { min: 12, max: 20, chance: 0.25 },
      { min: 35, max: 55, chance: 0.03 }
    ],
    description: "圆滚滚的基础肥羊。收益稳定，是账单生活的主食。"
  },
  {
    id: "tourist",
    name: "游客羊",
    subtitle: "恢复体力",
    hp: 22,
    speed: 0,
    scale: 1.08,
    spawnWeight: 15,
    unlockAfterBills: 1,
    staminaRestore: 15,
    color: 0xf3d8a5,
    faceColor: 0x604735,
    loot: [
      { min: 8, max: 13, chance: 0.65 },
      { min: 15, max: 21, chance: 0.32 },
      { min: 85, max: 125, chance: 0.03 }
    ],
    description: "懒得挪窝的旅行者。击碎时恢复 15 点体力；掉落档位按公开面板与玩家实机拟合。"
  },
  {
    id: "timber",
    name: "木绒羊",
    subtitle: "厚壳高收益",
    hp: 52,
    speed: 0.3,
    scale: 1.14,
    spawnWeight: 10,
    unlockAfterBills: 3,
    staminaRestore: 0,
    color: 0xa87545,
    faceColor: 0x513925,
    loot: [
      { min: 28, max: 44, chance: 0.7 },
      { min: 48, max: 75, chance: 0.26 },
      { min: 145, max: 190, chance: 0.04 }
    ],
    description: "木壳很硬，适合高伤锤；公开画面中的 +145 奖励被保留为稀有档。"
  },
  {
    id: "pinata",
    name: "彩糖羊",
    subtitle: "高波动掉落",
    hp: 36,
    speed: 0.54,
    scale: 1.02,
    spawnWeight: 6,
    unlockAfterBills: 5,
    staminaRestore: 0,
    color: 0xe35f8c,
    faceColor: 0x7a3763,
    loot: [
      { min: 25, max: 55, chance: 0.56 },
      { min: 90, max: 180, chance: 0.34 },
      { min: 280, max: 480, chance: 0.1 }
    ],
    description: "可能只掉零钱，也可能一次解决半张账单。"
  },
  {
    id: "loco",
    name: "狂奔羊",
    subtitle: "短暂停留",
    hp: 31,
    speed: 1.08,
    scale: 0.9,
    spawnWeight: 4,
    unlockAfterBills: 8,
    staminaRestore: 0,
    color: 0xd95745,
    faceColor: 0x4e302b,
    loot: [
      { min: 42, max: 68, chance: 0.62 },
      { min: 90, max: 145, chance: 0.32 },
      { min: 300, max: 410, chance: 0.06 }
    ],
    description: "移动速度快，离开桌面就会带着钱溜走。"
  },
  {
    id: "golden",
    name: "鎏金羊",
    subtitle: "稀有大奖",
    hp: 88,
    speed: 0.22,
    scale: 1.15,
    spawnWeight: 1,
    unlockAfterBills: 12,
    staminaRestore: 12,
    color: 0xf2b632,
    faceColor: 0x725219,
    loot: [
      { min: 210, max: 320, chance: 0.58 },
      { min: 380, max: 620, chance: 0.34 },
      { min: 900, max: 1300, chance: 0.08 }
    ],
    description: "难得一见的金色肥羊，击碎会触发钱币雨。"
  }
];

export const HAMMERS: HammerDefinition[] = [
  {
    id: "starter",
    name: "旧账锤",
    description: "房东留下的标准木锤，六项公开面板值作为拟合基准。",
    price: 0,
    damage: 6,
    attackSpeed: 1.09,
    critChance: 0.15,
    critDamage: 1.75,
    staminaCost: 6.5,
    hitRadius: 2.2,
    headColor: 0x76503a,
    handleColor: 0xb17a4c
  },
  {
    id: "toy",
    name: "软糖锤",
    description: "快、宽、省一点体力，但单次伤害偏低。",
    price: 500,
    damage: 5,
    attackSpeed: 1.17,
    critChance: 0.1,
    critDamage: 1.75,
    staminaCost: 6.4,
    hitRadius: 2.35,
    headColor: 0xe56a9d,
    handleColor: 0x65c8c2
  },
  {
    id: "efficient",
    name: "节能锤",
    description: "把每一口气都算进成本，适合耐力路线。",
    price: 2500,
    damage: 5.5,
    attackSpeed: 1.05,
    critChance: 0.12,
    critDamage: 1.7,
    staminaCost: 3.9,
    hitRadius: 2.08,
    headColor: 0x80a48a,
    handleColor: 0xc69b65
  },
  {
    id: "heavy",
    name: "催款重锤",
    description: "慢，但能把厚壳羊连同犹豫一起砸碎。",
    price: 12500,
    damage: 14,
    attackSpeed: 0.72,
    critChance: 0.1,
    critDamage: 2.1,
    staminaCost: 9,
    hitRadius: 1.76,
    headColor: 0x45484c,
    handleColor: 0x9a673f
  },
  {
    id: "ultra",
    name: "孤注一掷",
    description: "暴击率和暴击倍率惊人，范围窄且非常费力。",
    price: 150000,
    damage: 7,
    attackSpeed: 0.95,
    critChance: 0.32,
    critDamage: 3.4,
    staminaCost: 7.3,
    hitRadius: 1.85,
    headColor: 0x692f75,
    handleColor: 0xc5a26c
  },
  {
    id: "golden",
    name: "镀金锤",
    description: "昂贵但全面，掉落额外提高 18%。",
    price: 1500000,
    damage: 9,
    attackSpeed: 1,
    critChance: 0.18,
    critDamage: 2,
    staminaCost: 7,
    hitRadius: 2.3,
    headColor: 0xe0aa2d,
    handleColor: 0x8f5633
  }
];

export const BILLS: BillDefinition[] = [
  { name: "手机欠费", icon: "☎", amount: 75, dueDays: 3 },
  { name: "水费", icon: "◒", amount: 160, dueDays: 3 },
  { name: "电费", icon: "ϟ", amount: 320, dueDays: 3 },
  { name: "房租", icon: "⌂", amount: 750, dueDays: 2 },
  { name: "停车罚单", icon: "P", amount: 1500, dueDays: 3 },
  { name: "信用卡", icon: "▣", amount: 3200, dueDays: 3 },
  { name: "拖车费", icon: "⚑", amount: 7500, dueDays: 4 },
  { name: "大托尼借款", icon: "♠", amount: 16000, dueDays: 4 },
  { name: "电费追缴", icon: "ϟ", amount: 40000, dueDays: 4 },
  { name: "季度房租", icon: "⌂", amount: 90000, dueDays: 4 },
  { name: "催收和解", icon: "!", amount: 250000, dueDays: 5 },
  { name: "信用卡清算", icon: "▣", amount: 650000, dueDays: 5 },
  { name: "停车场索赔", icon: "P", amount: 1600000, dueDays: 5 },
  { name: "拖车公司诉状", icon: "⚑", amount: 4000000, dueDays: 5 },
  { name: "大托尼最后通牒", icon: "♠", amount: 16000000, dueDays: 6 },
  { name: "抵押追缴", icon: "⌂", amount: 64000000, dueDays: 6 },
  { name: "终局清算", icon: "◆", amount: 270000000, dueDays: 7 }
];

export function billAt(index: number, cycle: number, issuedDay: number): BillDefinition {
  const boundedIndex = Math.min(index, BILLS.length - 1);
  const base = BILLS[boundedIndex]!;
  const overtime = Math.max(0, index - (BILLS.length - 1));
  const cycleScale = Math.pow(1.28, Math.max(0, cycle - 1));
  const amount = Math.round((base.amount * Math.pow(1.75, overtime) * cycleScale) / 5) * 5;
  const dueDays = base.dueDays + Math.min(2, Math.floor(overtime / 2));
  return { ...base, amount, dueDays };
}

export const ECONOMY_SCALES = [
  1, 1.5, 2.3, 7, 14, 30, 70, 160, 370, 850, 2300, 6500, 18000, 52000, 180000, 560000, 1700000
] as const;

export const PERKS: PerkDefinition[] = [
  { id: "damage", name: "强硬交涉", description: (l) => `锤击伤害 +${15 * l}%`, maxLevel: 5, weight: 10, tags: ["力量"] },
  { id: "speed", name: "赶在月底", description: (l) => `攻击速度 +${9 * l}%`, maxLevel: 5, weight: 10, tags: ["速度"] },
  { id: "crit", name: "精算暴击", description: (l) => `暴击率 +${3 * l}%`, maxLevel: 5, weight: 9, tags: ["幸运"] },
  { id: "critDamage", name: "复利重击", description: (l) => `暴击伤害 +${20 * l}%`, maxLevel: 5, weight: 8, tags: ["幸运"] },
  { id: "stamina", name: "加大杯咖啡", description: (l) => `最大体力 +${14 * l}`, maxLevel: 5, weight: 10, tags: ["耐力"] },
  { id: "efficiency", name: "省力握法", description: (l) => `挥锤消耗 -${7 * l}%`, maxLevel: 4, weight: 9, tags: ["耐力"] },
  { id: "loot", name: "零钱搜刮", description: (l) => `全部掉落 +${10 * l}%`, maxLevel: 5, weight: 9, tags: ["收益"] },
  { id: "magnet", name: "硬币磁铁", description: (l) => `硬币吸附半径 +${(1.15 * l).toFixed(2)} 米`, maxLevel: 3, weight: 10, tags: ["收集", "行为"] },
  { id: "flock", name: "额外存钱罐", description: (l) => `每局桌面额外出现 ${l} 只肥羊`, maxLevel: 3, weight: 8, tags: ["桌面", "行为"] },
  { id: "recoverySmash", name: "恢复重击", description: (l) => `每次击碎额外恢复 ${2 * l} 点体力`, maxLevel: 4, weight: 8, tags: ["耐力", "行为"] },
  { id: "chain", name: "锤头通电", description: (l) => `命中有 ${12 * l}% 概率电弧连锁`, maxLevel: 3, weight: 6, tags: ["范围", "行为"] },
  { id: "rockRain", name: "落石雨", description: (l) => `每 ${8 - l} 秒自动重击一只肥羊`, maxLevel: 3, weight: 5, tags: ["自动", "行为"] },
  { id: "extension", name: "延期申请", description: (l) => `每张账单宽限期 +${l} 天`, maxLevel: 3, weight: 7, tags: ["账单"] },
  { id: "doubleCrit", name: "双重暴击", description: (l) => `命中时有 ${(0.6 * l).toFixed(1)}% 概率追加一次同额暴击`, maxLevel: 5, weight: 5, tags: ["稀有"] },
  { id: "liquidation", name: "精准清算", description: (l) => `每 3 秒有 ${10 * l}% 概率直接清算一只普通羊`, maxLevel: 3, weight: 4, tags: ["稀有"] },
  { id: "interest", name: "活期利息", description: (l) => `每天结算时现金增长 ${5 * l}%`, maxLevel: 3, weight: 3, tags: ["稀有"] },
  { id: "ticket", name: "内部赠票", description: (l) => `立即获得 ${2 * l} 张洗牌券`, maxLevel: 3, weight: 6, tags: ["小游戏"] }
];

const skill = (
  id: string,
  name: string,
  description: string,
  cost: number,
  tier: number,
  branch: SkillNodeDefinition["branch"],
  stat: SkillNodeDefinition["stat"],
  amount: number,
  operation: SkillNodeDefinition["operation"],
  requires?: string
): SkillNodeDefinition => ({ id, name, description, cost, tier, branch, stat, amount, operation, requires });

export const SKILLS: SkillNodeDefinition[] = [
  skill("pow1", "更多存钱罐", "每局开始多出 2 只肥羊", 30, 1, "力量", "spawnCount", 2, "add"),
  skill("pow2", "握力训练", "伤害 +12%", 90, 2, "力量", "damage", 1.12, "multiply", "pow1"),
  skill("pow3", "震桌", "锤击范围 +0.18", 140, 2, "力量", "hitRadius", 0.18, "add", "pow1"),
  skill("pow4", "债怒", "伤害 +18%", 500, 3, "力量", "damage", 1.18, "multiply", "pow2"),
  skill("pow5", "落石雨", "每 7 秒自动重击一只肥羊", 900, 3, "力量", "damage", 1, "multiply", "pow3"),
  skill("pow6", "碎壳专家", "暴击伤害 +0.35", 4000, 4, "力量", "critDamage", 0.35, "add", "pow4"),
  skill("pow7", "最后通牒", "伤害 +25%", 22000, 5, "力量", "damage", 1.25, "multiply", "pow6"),
  skill("pow8", "一锤定音", "暴击伤害 +0.5", 180000, 6, "力量", "critDamage", 0.5, "add", "pow7"),
  skill("end1", "咖啡上瘾", "最大体力 +10", 40, 1, "耐力", "maxStamina", 10, "add"),
  skill("end2", "双份咖啡", "最大体力 +16", 120, 2, "耐力", "maxStamina", 16, "add", "end1"),
  skill("end3", "健身房", "挥锤体力消耗 -7%", 180, 2, "耐力", "staminaCost", 0.93, "multiply", "end1"),
  skill("end4", "核心训练", "最大体力 +24", 650, 3, "耐力", "maxStamina", 24, "add", "end2"),
  skill("end5", "腕部强化", "攻击速度 +9%", 950, 3, "耐力", "attackSpeed", 1.09, "multiply", "end3"),
  skill("end6", "不眠夜", "挥锤体力消耗 -10%", 5200, 4, "耐力", "staminaCost", 0.9, "multiply", "end4"),
  skill("end7", "熟练工", "攻击速度 +14%", 28000, 5, "耐力", "attackSpeed", 1.14, "multiply", "end5"),
  skill("end8", "永动幻觉", "最大体力 +40", 240000, 6, "耐力", "maxStamina", 40, "add", "end7"),
  skill("luck1", "口袋零钱", "掉落 +8%", 50, 1, "幸运", "lootMultiplier", 1.08, "multiply"),
  skill("luck2", "幸运指节", "暴击率 +3%", 150, 2, "幸运", "critChance", 0.03, "add", "luck1"),
  skill("luck3", "硬币磁铁", "硬币吸附半径 +1.40 米", 220, 2, "幸运", "magnetRadius", 1.4, "add", "luck1"),
  skill("luck4", "账外收入", "每日被动收入随进度增长", 750, 3, "幸运", "passiveIncome", 12, "add", "luck2"),
  skill("luck5", "好兆头", "暴击率 +5%", 1100, 3, "幸运", "critChance", 0.05, "add", "luck3"),
  skill("luck6", "锤头通电", "命中有 15% 概率电弧连锁", 6500, 4, "幸运", "chainChance", 0.15, "add", "luck4"),
  skill("luck7", "红色硬币", "每局基础收益进一步提高", 35000, 5, "幸运", "passiveIncome", 35, "add", "luck5"),
  skill("luck8", "财运亨通", "掉落 +30%", 300000, 6, "幸运", "lootMultiplier", 1.3, "multiply", "luck7")
];

export const JEWELRY: JewelryDefinition[] = [
  { id: "ring_force", name: "碎壳戒", description: "永久伤害 +10%", cost: 8, slot: "ring", stat: "damage", amount: 1.1, operation: "multiply" },
  { id: "ring_luck", name: "绿币戒", description: "永久掉落 +12%", cost: 9, slot: "ring", stat: "lootMultiplier", amount: 1.12, operation: "multiply" },
  { id: "ring_crit", name: "红线戒", description: "永久暴击率 +4%", cost: 12, slot: "ring", stat: "critChance", amount: 0.04, operation: "add" },
  { id: "ring_jackpot", name: "头奖戒", description: "永久暴击伤害 +0.3", cost: 25, slot: "ring", stat: "critDamage", amount: 0.3, operation: "add" },
  { id: "brace_stamina", name: "咖啡手环", description: "永久最大体力 +18", cost: 10, slot: "bracelet", stat: "maxStamina", amount: 18, operation: "add" },
  { id: "brace_speed", name: "秒针手环", description: "永久攻速 +10%", cost: 14, slot: "bracelet", stat: "attackSpeed", amount: 1.1, operation: "multiply" },
  { id: "brace_saver", name: "节流手环", description: "永久体力消耗 -9%", cost: 16, slot: "bracelet", stat: "staminaCost", amount: 0.91, operation: "multiply" },
  { id: "brace_magnet", name: "磁吸手环", description: "永久掉落 +20%", cost: 35, slot: "bracelet", stat: "lootMultiplier", amount: 1.2, operation: "multiply" }
];

export const ACHIEVEMENTS = [
  { id: "first_bill", name: "账单必须支付", test: (s: { totalBillsPaid: number }) => s.totalBillsPaid >= 1 },
  { id: "ten_sheep", name: "新手剪羊人", test: (s: { statistics: { sheepSmashed: number } }) => s.statistics.sheepSmashed >= 10 },
  { id: "hundred_cash", name: "第一张百元钞", test: (s: { runCash: number }) => s.runCash >= 100 },
  { id: "thousand_cash", name: "四位数", test: (s: { runCash: number }) => s.runCash >= 1000 },
  { id: "tenk_cash", name: "现金堆", test: (s: { runCash: number }) => s.runCash >= 10000 },
  { id: "five_bills", name: "按时公民", test: (s: { billsPaid: number }) => s.billsPaid >= 5 },
  { id: "bankrupt", name: "又一个轮回", test: (s: { statistics: { bankruptcies: number } }) => s.statistics.bankruptcies >= 1 }
] as const;
