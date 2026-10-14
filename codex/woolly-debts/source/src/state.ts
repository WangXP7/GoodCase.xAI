import {
  ACHIEVEMENTS,
  BILLS,
  COIN_VALUES,
  ECONOMY_SCALES,
  HAMMERS,
  JEWELRY,
  PERKS,
  SHEEP,
  SKILLS,
  STARTING_MAX_STAMINA,
  billAt
} from "./balance";
import type {
  CoinKind,
  CurrentBill,
  DerivedStats,
  GameState,
  HammerDefinition,
  PerkDefinition,
  SheepDefinition,
  SheepKind,
  SmashResult,
  StatKey
} from "./types";

const STORAGE_KEY = "woolly-debts-save-v1";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const roundMoney = (value: number) => Math.round(value * 100) / 100;

function currentBill(index: number, cycle: number, issuedDay: number): CurrentBill {
  const bill = billAt(index, cycle, issuedDay);
  return { ...bill, issuedDay, dueDay: issuedDay + bill.dueDays };
}

export function createInitialState(): GameState {
  return {
    schemaVersion: 1,
    cash: 0,
    lifetimeCash: 0,
    stamina: STARTING_MAX_STAMINA,
    day: 1,
    shift: 1,
    cycle: 1,
    currentBill: currentBill(0, 1, 1),
    nextBillIndex: 1,
    billsPaid: 0,
    totalBillsPaid: 0,
    runCash: 0,
    runStats: { swings: 0, sheepSmashed: 0, pickupsCollected: 0, missedCash: 0 },
    skillPoints: 0,
    tickets: 2,
    prestigePoints: 0,
    currentHammer: "starter",
    ownedHammers: ["starter"],
    perks: {},
    skills: [],
    jewelry: [],
    equippedJewelry: [],
    collection: { silver: 0, gold: 0, emerald: 0, ruby: 0 },
    unlockedSheep: ["cloud"],
    seenSheep: [],
    achievements: [],
    statistics: {
      swings: 0,
      criticals: 0,
      sheepSmashed: 0,
      bestCombo: 0,
      bankruptcies: 0,
      shuffleWins: 0,
      pickupsCollected: 0,
      missedCash: 0
    },
    settings: { sound: true, screenShake: true, reducedMotion: false },
    tutorialComplete: false,
    lastSavedAt: Date.now()
  };
}

function sanitizeState(value: unknown): GameState {
  const fresh = createInitialState();
  if (!value || typeof value !== "object") return fresh;
  const saved = value as Partial<GameState>;
  if (saved.schemaVersion !== 1) return fresh;
  const merged: GameState = {
    ...fresh,
    ...saved,
    statistics: { ...fresh.statistics, ...(saved.statistics ?? {}) },
    runStats: { ...fresh.runStats, ...(saved.runStats ?? {}) },
    settings: { ...fresh.settings, ...(saved.settings ?? {}) },
    collection: { ...fresh.collection, ...(saved.collection ?? {}) },
    perks: { ...(saved.perks ?? {}) }
  };
  const validHammerIds = new Set(HAMMERS.map((item) => item.id));
  merged.ownedHammers = merged.ownedHammers.filter((id) => validHammerIds.has(id));
  if (!merged.ownedHammers.includes("starter")) merged.ownedHammers.unshift("starter");
  if (!merged.ownedHammers.includes(merged.currentHammer)) merged.currentHammer = "starter";
  merged.skills = merged.skills.filter((id) => SKILLS.some((item) => item.id === id));
  merged.jewelry = merged.jewelry.filter((id) => JEWELRY.some((item) => item.id === id));
  merged.equippedJewelry = merged.equippedJewelry.filter((id) => merged.jewelry.includes(id)).slice(0, 2);
  merged.unlockedSheep = merged.unlockedSheep.filter((id) => SHEEP.some((item) => item.id === id));
  if (!merged.unlockedSheep.includes("cloud")) merged.unlockedSheep.unshift("cloud");
  merged.stamina = clamp(merged.stamina, 0, 10000);
  return merged;
}

export function loadState(): GameState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeState(JSON.parse(raw)) : createInitialState();
  } catch {
    return createInitialState();
  }
}

export function getHammer(id: string): HammerDefinition {
  return HAMMERS.find((item) => item.id === id) ?? HAMMERS[0]!;
}

function applyStat(
  stats: DerivedStats,
  stat: StatKey,
  amount: number,
  operation: "add" | "multiply"
): void {
  const current = stats[stat];
  stats[stat] = operation === "add" ? current + amount : current * amount;
}

export function deriveStats(state: GameState): DerivedStats {
  const hammer = getHammer(state.currentHammer);
  const stats: DerivedStats = {
    damage: hammer.damage,
    attackSpeed: hammer.attackSpeed,
    critChance: hammer.critChance,
    critDamage: hammer.critDamage,
    staminaCost: hammer.staminaCost,
    hitRadius: hammer.hitRadius,
    maxStamina: STARTING_MAX_STAMINA,
    lootMultiplier: hammer.id === "golden" ? 1.18 : 1,
    moveSlow: 0,
    passiveIncome: 0,
    magnetRadius: 0.68 + 1.15 * (state.perks.magnet ?? 0),
    spawnCount: 5 + (state.perks.flock ?? 0),
    chainChance: 0.12 * (state.perks.chain ?? 0),
    recoveryOnKill: 2 * (state.perks.recoverySmash ?? 0),
    economyScale: economyScaleAt(state.billsPaid, state.cycle),
    graceDays: state.perks.extension ?? 0,
    interestRate: 0.05 * (state.perks.interest ?? 0),
    doubleCritChance: 0.006 * (state.perks.doubleCrit ?? 0),
    liquidationChance: 0.1 * (state.perks.liquidation ?? 0)
  };

  stats.damage *= 1 + 0.15 * (state.perks.damage ?? 0);
  stats.attackSpeed *= 1 + 0.09 * (state.perks.speed ?? 0);
  stats.critChance += 0.03 * (state.perks.crit ?? 0);
  stats.critDamage += 0.2 * (state.perks.critDamage ?? 0);
  stats.maxStamina += 14 * (state.perks.stamina ?? 0);
  stats.staminaCost *= 1 - 0.07 * (state.perks.efficiency ?? 0);
  stats.lootMultiplier *= 1 + 0.1 * (state.perks.loot ?? 0);

  for (const id of state.skills) {
    const definition = SKILLS.find((item) => item.id === id);
    if (definition) applyStat(stats, definition.stat, definition.amount, definition.operation);
  }
  for (const id of state.equippedJewelry) {
    const definition = JEWELRY.find((item) => item.id === id);
    if (definition) applyStat(stats, definition.stat, definition.amount, definition.operation);
  }

  stats.critChance = clamp(stats.critChance, 0, 0.85);
  stats.chainChance = clamp(stats.chainChance, 0, 0.75);
  stats.magnetRadius = clamp(stats.magnetRadius, 0.45, 5.5);
  stats.spawnCount = clamp(Math.round(stats.spawnCount), 4, 14);
  stats.staminaCost = Math.max(0.75, stats.staminaCost);
  return stats;
}

export function economyScaleAt(billsPaid: number, cycle = 1): number {
  const stage = Math.max(0, Math.floor(billsPaid));
  const lastIndex = ECONOMY_SCALES.length - 1;
  const base = stage <= lastIndex
    ? ECONOMY_SCALES[stage]!
    : ECONOMY_SCALES[lastIndex]! * Math.pow(1.75, stage - lastIndex);
  return base * Math.pow(1.18, Math.max(0, cycle - 1));
}

function weightedChoice<T extends { chance: number }>(entries: T[], random = Math.random): T {
  const roll = random();
  let running = 0;
  for (const entry of entries) {
    running += entry.chance;
    if (roll <= running) return entry;
  }
  return entries[entries.length - 1]!;
}

export function rollLoot(definition: SheepDefinition, multiplier: number, random = Math.random): number {
  const tier = weightedChoice(definition.loot, random);
  const value = tier.min + Math.floor(random() * (tier.max - tier.min + 1));
  return Math.max(1, Math.round(value * multiplier));
}

export function splitCoins(value: number): Record<CoinKind, number> {
  let remaining = Math.max(0, Math.floor(value));
  const result: Record<CoinKind, number> = { silver: 0, gold: 0, emerald: 0, ruby: 0 };
  for (const kind of ["ruby", "emerald", "gold", "silver"] as CoinKind[]) {
    const coinValue = COIN_VALUES[kind];
    result[kind] = Math.floor(remaining / coinValue);
    remaining %= coinValue;
  }
  return result;
}

type Listener = (state: GameState, reason: string) => void;

export class GameModel {
  state: GameState;
  private listeners = new Set<Listener>();

  constructor(state = loadState()) {
    this.state = state;
    this.normalizeStamina();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state, "init");
    return () => this.listeners.delete(listener);
  }

  private emit(reason: string): void {
    this.state.lastSavedAt = Date.now();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // The game remains playable when storage is unavailable.
    }
    for (const listener of this.listeners) listener(this.state, reason);
  }

  get stats(): DerivedStats {
    return deriveStats(this.state);
  }

  normalizeStamina(): void {
    const max = deriveStats(this.state).maxStamina;
    this.state.stamina = clamp(this.state.stamina, 0, max);
  }

  consumePassiveStamina(amount: number): boolean {
    if (this.state.stamina <= 0) return false;
    this.state.stamina = Math.max(0, this.state.stamina - amount);
    return this.state.stamina > 0;
  }

  rollSmash(
    kind: SheepKind,
    remainingHp: number,
    random = Math.random,
    options: { consumeStamina?: boolean; damageScale?: number } = {}
  ): SmashResult {
    if (this.state.stamina <= 0 && options.consumeStamina !== false) {
      return { damage: 0, critical: false, doubleCritical: false, killed: false, hitLoot: 0, loot: 0, staminaRestored: 0 };
    }
    const definition = SHEEP.find((item) => item.id === kind) ?? SHEEP[0]!;
    const stats = this.stats;
    const critical = random() < stats.critChance;
    const doubleCritical = critical && random() < stats.doubleCritChance;
    let damage = stats.damage * (critical ? stats.critDamage : 1);
    if (doubleCritical) damage += stats.damage * stats.critDamage;
    damage *= (0.94 + random() * 0.12) * (options.damageScale ?? 1);
    damage = Math.round(damage * 10) / 10;
    const killed = damage >= remainingHp;

    if (options.consumeStamina !== false) {
      this.state.stamina = Math.max(0, this.state.stamina - stats.staminaCost);
      this.state.statistics.swings += 1;
      this.state.runStats.swings += 1;
      if (critical) this.state.statistics.criticals += 1;
    }

    let hitLoot = 0;
    if (random() < 0.31) {
      const denominationRoll = random();
      const denomination = denominationRoll < 0.78 ? 1 : denominationRoll < 0.97 ? 5 : 25;
      hitLoot = Math.max(1, Math.round(denomination * stats.economyScale));
    }
    let loot = 0;
    let staminaRestored = 0;
    if (killed) {
      loot = rollLoot(definition, stats.lootMultiplier * stats.economyScale, random);
      staminaRestored = definition.staminaRestore + stats.recoveryOnKill;
      this.recordKill(kind);
      this.state.stamina = Math.min(stats.maxStamina, this.state.stamina + staminaRestored);
    }
    this.checkAchievements();
    this.emit(killed ? "sheep-killed" : "smash");
    return { damage, critical, doubleCritical, killed, hitLoot, loot, staminaRestored };
  }

  liquidate(kind: SheepKind, remainingHp: number): SmashResult {
    const definition = SHEEP.find((item) => item.id === kind) ?? SHEEP[0]!;
    const loot = rollLoot(definition, this.stats.lootMultiplier * this.stats.economyScale);
    this.recordKill(kind);
    this.checkAchievements();
    this.emit("liquidation");
    return {
      damage: remainingHp,
      critical: true,
      doubleCritical: false,
      killed: true,
      hitLoot: 0,
      loot,
      staminaRestored: 0
    };
  }

  private recordKill(kind: SheepKind): void {
    this.state.statistics.sheepSmashed += 1;
    this.state.runStats.sheepSmashed += 1;
    if (!this.state.seenSheep.includes(kind)) this.state.seenSheep.push(kind);
  }

  collectLoot(value: number): void {
    if (value <= 0) return;
    this.state.cash = roundMoney(this.state.cash + value);
    this.state.lifetimeCash = roundMoney(this.state.lifetimeCash + value);
    this.state.runCash = roundMoney(this.state.runCash + value);
    this.state.statistics.pickupsCollected += 1;
    this.state.runStats.pickupsCollected += 1;
    const coins = splitCoins(value);
    for (const key of Object.keys(coins) as CoinKind[]) this.state.collection[key] += coins[key];
    this.checkAchievements();
    this.emit("loot-collected");
  }

  recordMissedLoot(value: number): void {
    const missed = Math.max(0, Math.round(value));
    if (!missed) return;
    this.state.runStats.missedCash += missed;
    this.state.statistics.missedCash += missed;
    this.emit("loot-missed");
  }

  setBestCombo(combo: number): void {
    if (combo > this.state.statistics.bestCombo) {
      this.state.statistics.bestCombo = combo;
      this.emit("combo");
    }
  }

  canPayBill(): boolean {
    return this.state.cash >= this.state.currentBill.amount;
  }

  payBill(): PerkDefinition[] | null {
    const bill = this.state.currentBill;
    if (!this.canPayBill()) return null;
    this.state.cash = roundMoney(this.state.cash - bill.amount);
    this.state.billsPaid += 1;
    this.state.totalBillsPaid += 1;
    if (this.state.billsPaid % 3 === 0) this.state.tickets += 1;
    const index = this.state.nextBillIndex;
    this.state.nextBillIndex += 1;
    this.state.currentBill = currentBill(index, this.state.cycle, this.state.day);
    this.refreshUnlocks();
    this.checkAchievements();
    const perks = this.pickPerks(3);
    this.emit("bill-paid");
    return perks;
  }

  pickPerks(count: number, random = Math.random): PerkDefinition[] {
    const pool = PERKS.filter((perk) => (this.state.perks[perk.id] ?? 0) < perk.maxLevel);
    const picked: PerkDefinition[] = [];
    while (picked.length < count && pool.length) {
      const totalWeight = pool.reduce((sum, perk) => sum + perk.weight, 0);
      let roll = random() * totalWeight;
      let index = 0;
      for (; index < pool.length; index += 1) {
        roll -= pool[index]!.weight;
        if (roll <= 0) break;
      }
      const [choice] = pool.splice(Math.min(index, pool.length - 1), 1);
      if (choice) picked.push(choice);
    }
    return picked;
  }

  choosePerk(id: string): boolean {
    const perk = PERKS.find((item) => item.id === id);
    if (!perk) return false;
    const next = (this.state.perks[id] ?? 0) + 1;
    if (next > perk.maxLevel) return false;
    this.state.perks[id] = next;
    if (id === "ticket") this.state.tickets += 2;
    this.normalizeStamina();
    this.emit("perk-chosen");
    return true;
  }

  endShift(): { bankrupt: boolean; interest: number; passive: number } {
    this.state.day += 1;
    this.state.shift += 1;
    const stats = this.stats;
    const interest = Math.floor(this.state.cash * stats.interestRate);
    const passive = Math.floor(stats.passiveIncome * stats.economyScale);
    this.state.cash += interest + passive;
    this.state.lifetimeCash += interest + passive;
    this.state.runCash += interest + passive;
    const overdueBy = this.state.day - this.state.currentBill.dueDay;
    const bankrupt = overdueBy > stats.graceDays;
    if (!bankrupt) this.state.stamina = stats.maxStamina;
    this.state.runCash = 0;
    this.state.runStats = { swings: 0, sheepSmashed: 0, pickupsCollected: 0, missedCash: 0 };
    this.emit(bankrupt ? "bankruptcy-due" : "new-shift");
    return { bankrupt, interest, passive };
  }

  declareBankruptcy(): number {
    const earned = Math.max(1, this.state.billsPaid);
    const permanent = {
      cycle: this.state.cycle + 1,
      prestigePoints: this.state.prestigePoints + earned,
      jewelry: [...this.state.jewelry],
      equippedJewelry: [...this.state.equippedJewelry],
      lifetimeCash: this.state.lifetimeCash,
      totalBillsPaid: this.state.totalBillsPaid,
      achievements: [...this.state.achievements],
      settings: { ...this.state.settings },
      bankruptcies: this.state.statistics.bankruptcies + 1
    };
    this.state = createInitialState();
    this.state.cycle = permanent.cycle;
    this.state.prestigePoints = permanent.prestigePoints;
    this.state.jewelry = permanent.jewelry;
    this.state.equippedJewelry = permanent.equippedJewelry;
    this.state.lifetimeCash = permanent.lifetimeCash;
    this.state.totalBillsPaid = permanent.totalBillsPaid;
    this.state.achievements = permanent.achievements;
    this.state.settings = permanent.settings;
    this.state.statistics.bankruptcies = permanent.bankruptcies;
    this.state.currentBill = currentBill(0, this.state.cycle, 1);
    this.state.stamina = this.stats.maxStamina;
    this.checkAchievements();
    this.emit("bankruptcy");
    return earned;
  }

  buyHammer(id: string): boolean {
    const hammer = HAMMERS.find((item) => item.id === id);
    if (!hammer) return false;
    if (this.state.ownedHammers.includes(id)) {
      this.state.currentHammer = id;
      this.emit("hammer-equipped");
      return true;
    }
    if (this.state.cash < hammer.price) return false;
    this.state.cash -= hammer.price;
    this.state.ownedHammers.push(id);
    this.state.currentHammer = id;
    this.emit("hammer-bought");
    return true;
  }

  buySkill(id: string): boolean {
    const node = SKILLS.find((item) => item.id === id);
    if (!node || this.state.skills.includes(id) || this.state.cash < node.cost) return false;
    if (node.requires && !this.state.skills.includes(node.requires)) return false;
    this.state.cash = roundMoney(this.state.cash - node.cost);
    this.state.skills.push(id);
    this.normalizeStamina();
    this.emit("skill-bought");
    return true;
  }

  buyJewelry(id: string): boolean {
    const item = JEWELRY.find((entry) => entry.id === id);
    if (!item || this.state.jewelry.includes(id) || this.state.prestigePoints < item.cost) return false;
    this.state.prestigePoints -= item.cost;
    this.state.jewelry.push(id);
    if (!this.state.equippedJewelry.some((owned) => JEWELRY.find((entry) => entry.id === owned)?.slot === item.slot)) {
      this.state.equippedJewelry.push(id);
    }
    this.normalizeStamina();
    this.emit("jewelry-bought");
    return true;
  }

  equipJewelry(id: string): boolean {
    const item = JEWELRY.find((entry) => entry.id === id);
    if (!item || !this.state.jewelry.includes(id)) return false;
    this.state.equippedJewelry = this.state.equippedJewelry.filter((owned) => {
      const other = JEWELRY.find((entry) => entry.id === owned);
      return other?.slot !== item.slot;
    });
    this.state.equippedJewelry.push(id);
    this.normalizeStamina();
    this.emit("jewelry-equipped");
    return true;
  }

  playShuffle(choice: number, bet: number, forcedWinner?: number): { won: boolean; winner: number; payout: number } | null {
    if (this.state.tickets < 1 || this.state.cash < bet || choice < 0 || choice > 2 || bet <= 0) return null;
    this.state.tickets -= 1;
    this.state.cash -= bet;
    const winner = forcedWinner ?? Math.floor(Math.random() * 3);
    const won = winner === choice;
    const payout = won ? bet * 2 : 0;
    this.state.cash += payout;
    if (won) this.state.statistics.shuffleWins += 1;
    this.emit("shuffle-played");
    return { won, winner, payout };
  }

  updateSetting<K extends keyof GameState["settings"]>(key: K, value: GameState["settings"][K]): void {
    this.state.settings[key] = value;
    this.emit("settings");
  }

  completeTutorial(): void {
    this.state.tutorialComplete = true;
    this.emit("tutorial");
  }

  grantDebug(cash = 5000, skillPoints = 12, prestigePoints = 50): void {
    this.state.cash += cash;
    this.state.skillPoints += skillPoints;
    this.state.prestigePoints += prestigePoints;
    this.state.tutorialComplete = true;
    this.emit("debug-grant");
  }

  hardReset(): void {
    this.state = createInitialState();
    this.emit("hard-reset");
  }

  snapshot(): GameState {
    return clone(this.state);
  }

  getAvailableSheep(): SheepDefinition[] {
    return SHEEP.filter((item) => item.unlockAfterBills <= this.state.billsPaid);
  }

  rollSheep(random = Math.random): SheepDefinition {
    const available = this.getAvailableSheep();
    const total = available.reduce((sum, item) => sum + item.spawnWeight, 0);
    let roll = random() * total;
    for (const item of available) {
      roll -= item.spawnWeight;
      if (roll <= 0) return item;
    }
    return available[available.length - 1] ?? SHEEP[0]!;
  }

  private refreshUnlocks(): void {
    for (const item of SHEEP) {
      if (item.unlockAfterBills <= this.state.billsPaid && !this.state.unlockedSheep.includes(item.id)) {
        this.state.unlockedSheep.push(item.id);
      }
    }
  }

  private checkAchievements(): void {
    for (const achievement of ACHIEVEMENTS) {
      if (!this.state.achievements.includes(achievement.id) && achievement.test(this.state)) {
        this.state.achievements.push(achievement.id);
      }
    }
  }
}

export const gameCatalog = { SHEEP, HAMMERS, BILLS, PERKS, SKILLS, JEWELRY };
