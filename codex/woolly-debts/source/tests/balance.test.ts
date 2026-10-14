import { describe, expect, it } from "vitest";
import { HAMMERS, SHEEP, billAt } from "../src/balance";
import { GameModel, createInitialState, deriveStats, economyScaleAt, rollLoot, splitCoins } from "../src/state";

describe("公开面板拟合", () => {
  it("保留基准锤与软糖锤六项公开值", () => {
    const starter = HAMMERS.find((item) => item.id === "starter")!;
    const toy = HAMMERS.find((item) => item.id === "toy")!;
    expect(starter).toMatchObject({ damage: 6, attackSpeed: 1.09, critChance: 0.15, critDamage: 1.75, staminaCost: 6.5, hitRadius: 2.2 });
    expect(toy).toMatchObject({ damage: 5, attackSpeed: 1.17, critChance: 0.1, critDamage: 1.75, staminaCost: 6.4, hitRadius: 2.35 });
  });

  it("游客羊使用 65/32/3 三档掉落", () => {
    const tourist = SHEEP.find((item) => item.id === "tourist")!;
    expect(tourist.hp).toBe(22);
    expect(tourist.staminaRestore).toBe(15);
    expect(tourist.loot).toEqual([
      { min: 8, max: 13, chance: 0.65 },
      { min: 15, max: 21, chance: 0.32 },
      { min: 85, max: 125, chance: 0.03 }
    ]);
    const randomValues = [0.99, 0.5];
    expect(rollLoot(tourist, 1, () => randomValues.shift() ?? 0)).toBe(105);
  });

  it("硬币拆分保持公开面值并守恒", () => {
    const coins = splitCoins(186);
    expect(coins).toEqual({ ruby: 1, emerald: 3, gold: 2, silver: 1 });
  });

  it("命中先把硬币掉到桌上，拾取后才进入现金", () => {
    const model = new GameModel(createInitialState());
    const rolls = [0.9, 0.5, 0.1, 0.5];
    const result = model.rollSmash("cloud", 24, () => rolls.shift() ?? 0.5);
    expect(result.killed).toBe(false);
    expect(result.hitLoot).toBe(1);
    expect(model.state.cash).toBe(0);
    model.collectLoot(result.hitLoot);
    expect(model.state.cash).toBe(1);
    expect(model.state.runStats.pickupsCollected).toBe(1);
  });
});

describe("账单、构筑与轮回", () => {
  it("账单从 75/160/320/750 延伸到 25 万、1600 万和 2.7 亿", () => {
    expect([0, 1, 2, 3].map((index) => billAt(index, 1, 1).amount)).toEqual([75, 160, 320, 750]);
    expect(billAt(10, 1, 1).amount).toBe(250000);
    expect(billAt(14, 1, 1).amount).toBe(16000000);
    expect(billAt(16, 1, 1).amount).toBe(270000000);
    expect(billAt(17, 1, 1).amount).toBeGreaterThan(270000000);
    expect(billAt(0, 2, 1).amount).toBeGreaterThan(75);
    expect(economyScaleAt(14)).toBe(180000);
  });

  it("付款推进账单并给出三选一，技能树不再使用技能点", () => {
    const state = createInitialState();
    state.cash = 1000;
    const model = new GameModel(state);
    const choices = model.payBill();
    expect(choices).toHaveLength(3);
    expect(model.state.cash).toBe(925);
    expect(model.state.skillPoints).toBe(0);
    expect(model.state.billsPaid).toBe(1);
    expect(model.state.currentBill.amount).toBe(160);
  });

  it("增益按公开概率与延期值进入派生属性", () => {
    const state = createInitialState();
    state.perks.doubleCrit = 2;
    state.perks.liquidation = 1;
    state.perks.extension = 3;
    state.perks.interest = 1;
    const stats = deriveStats(state);
    expect(stats.doubleCritChance).toBeCloseTo(0.012);
    expect(stats.liquidationChance).toBeCloseTo(0.1);
    expect(stats.graceDays).toBe(3);
    expect(stats.interestRate).toBeCloseTo(0.05);
  });

  it("猜肥羊强制命中时返还两倍赌注", () => {
    const state = createInitialState();
    state.cash = 500;
    const model = new GameModel(state);
    const result = model.playShuffle(1, 100, 1);
    expect(result).toEqual({ won: true, winner: 1, payout: 200 });
    expect(model.state.cash).toBe(600);
    expect(model.state.tickets).toBe(1);
  });

  it("技能树使用现金并让首个节点增加两只肥羊", () => {
    const state = createInitialState();
    state.cash = 100;
    const model = new GameModel(state);
    expect(model.buySkill("pow1")).toBe(true);
    expect(model.state.cash).toBe(70);
    expect(model.stats.spawnCount).toBe(7);
  });

  it("破产保留永久层并重置本轮层", () => {
    const state = createInitialState();
    state.billsPaid = 5;
    state.cash = 8888;
    state.prestigePoints = 4;
    state.jewelry = ["ring_force"];
    state.equippedJewelry = ["ring_force"];
    const model = new GameModel(state);
    const earned = model.declareBankruptcy();
    expect(earned).toBe(5);
    expect(model.state.cycle).toBe(2);
    expect(model.state.prestigePoints).toBe(9);
    expect(model.state.jewelry).toContain("ring_force");
    expect(model.state.cash).toBe(0);
    expect(model.state.billsPaid).toBe(0);
  });
});
