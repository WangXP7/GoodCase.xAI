export type SheepKind = "cloud" | "tourist" | "timber" | "pinata" | "loco" | "golden";
export type CoinKind = "silver" | "gold" | "emerald" | "ruby";
export type StatKey =
  | "damage"
  | "attackSpeed"
  | "critChance"
  | "critDamage"
  | "staminaCost"
  | "hitRadius"
  | "maxStamina"
  | "lootMultiplier"
  | "moveSlow"
  | "passiveIncome"
  | "magnetRadius"
  | "spawnCount"
  | "chainChance"
  | "recoveryOnKill";

export interface WeightedLoot {
  min: number;
  max: number;
  chance: number;
}

export interface SheepDefinition {
  id: SheepKind;
  name: string;
  subtitle: string;
  hp: number;
  speed: number;
  scale: number;
  spawnWeight: number;
  unlockAfterBills: number;
  staminaRestore: number;
  color: number;
  faceColor: number;
  loot: WeightedLoot[];
  description: string;
}

export interface HammerDefinition {
  id: string;
  name: string;
  description: string;
  price: number;
  damage: number;
  attackSpeed: number;
  critChance: number;
  critDamage: number;
  staminaCost: number;
  hitRadius: number;
  headColor: number;
  handleColor: number;
}

export interface PerkDefinition {
  id: string;
  name: string;
  description: (level: number) => string;
  maxLevel: number;
  weight: number;
  tags: string[];
}

export interface SkillNodeDefinition {
  id: string;
  name: string;
  description: string;
  cost: number;
  tier: number;
  branch: "力量" | "耐力" | "幸运";
  requires?: string;
  stat: StatKey;
  amount: number;
  operation: "add" | "multiply";
}

export interface JewelryDefinition {
  id: string;
  name: string;
  description: string;
  cost: number;
  slot: "ring" | "bracelet";
  stat: StatKey;
  amount: number;
  operation: "add" | "multiply";
}

export interface BillDefinition {
  name: string;
  icon: string;
  amount: number;
  dueDays: number;
}

export interface CurrentBill extends BillDefinition {
  issuedDay: number;
  dueDay: number;
}

export interface DerivedStats {
  damage: number;
  attackSpeed: number;
  critChance: number;
  critDamage: number;
  staminaCost: number;
  hitRadius: number;
  maxStamina: number;
  lootMultiplier: number;
  moveSlow: number;
  passiveIncome: number;
  magnetRadius: number;
  spawnCount: number;
  chainChance: number;
  recoveryOnKill: number;
  economyScale: number;
  graceDays: number;
  interestRate: number;
  doubleCritChance: number;
  liquidationChance: number;
}

export interface GameState {
  schemaVersion: 1;
  cash: number;
  lifetimeCash: number;
  stamina: number;
  day: number;
  shift: number;
  cycle: number;
  currentBill: CurrentBill;
  nextBillIndex: number;
  billsPaid: number;
  totalBillsPaid: number;
  runCash: number;
  runStats: {
    swings: number;
    sheepSmashed: number;
    pickupsCollected: number;
    missedCash: number;
  };
  skillPoints: number;
  tickets: number;
  prestigePoints: number;
  currentHammer: string;
  ownedHammers: string[];
  perks: Record<string, number>;
  skills: string[];
  jewelry: string[];
  equippedJewelry: string[];
  collection: Record<CoinKind, number>;
  unlockedSheep: SheepKind[];
  seenSheep: SheepKind[];
  achievements: string[];
  statistics: {
    swings: number;
    criticals: number;
    sheepSmashed: number;
    bestCombo: number;
    bankruptcies: number;
    shuffleWins: number;
    pickupsCollected: number;
    missedCash: number;
  };
  settings: {
    sound: boolean;
    screenShake: boolean;
    reducedMotion: boolean;
  };
  tutorialComplete: boolean;
  lastSavedAt: number;
}

export interface SmashResult {
  damage: number;
  critical: boolean;
  doubleCritical: boolean;
  killed: boolean;
  hitLoot: number;
  loot: number;
  staminaRestored: number;
}
