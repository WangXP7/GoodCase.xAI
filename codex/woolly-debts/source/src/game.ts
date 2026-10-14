import { GameAudio } from "./audio";
import { GameScene, type SheepEntity } from "./scene";
import { GameModel, getHammer } from "./state";
import { GameUI } from "./ui";
import type { GameState, SmashResult } from "./types";

export interface DebugGameApi {
  snapshot(): GameState;
  grantResources(cash?: number, skillPoints?: number, prestigePoints?: number): GameState;
  smashFirst(): boolean;
  openPanel(name: string): void;
  forceStamina(value: number): void;
  firstSheepPoint(): { x: number; y: number } | null;
  firstSheepHeadPoint(): { x: number; y: number } | null;
  firstSheepBarPoint(): { x: number; y: number } | null;
  sheepCount(): number;
  pendingLoot(): number;
  payBill(): boolean;
  reset(): void;
}

export class WoollyGame {
  readonly model = new GameModel();
  readonly ui: GameUI;
  readonly scene: GameScene;
  readonly audio = new GameAudio();

  private animationFrame = 0;
  private lastFrame = performance.now();
  private lastUiTick = 0;
  private lastAttack = 0;
  private lastSpawn = 0;
  private lastLiquidation = 0;
  private lastRockRain = 0;
  private lastKill = 0;
  private combo = 1;
  private shiftEnding = false;
  private exhaustionStartedAt = 0;
  private disposed = false;

  constructor(root: HTMLElement) {
    this.ui = new GameUI(root, this.model);
    this.scene = new GameScene(this.ui.sceneHost);
    this.ui.bindActions({
      advanceDay: () => this.advanceDay(),
      restartCycle: () => this.restartCycle(),
      requestFullscreen: () => void this.toggleFullscreen(),
      applySettings: () => this.applySettings()
    });
    this.scene.onHoverChange = (entity) => {
      this.lastAttack = 0;
      this.ui.showTarget(entity);
    };
    this.scene.onPointerDown = () => this.audio.unlock();

    this.model.subscribe((state, reason) => {
      this.ui.render(state, reason);
      this.scene.setHammer(getHammer(state.currentHammer));
      this.applySettings();
    });

    this.seedDesk();
    if (!this.model.state.tutorialComplete) window.setTimeout(() => this.ui.showTutorial(), 250);
    this.animationFrame = requestAnimationFrame(this.tick);

    window.__woollyGame = this.createDebugApi();
  }

  private seedDesk(): void {
    const positions = [
      { x: -3.35, z: 0.2 },
      { x: -1.1, z: 2.05 },
      { x: 1.35, z: 0.6 },
      { x: 3.65, z: 2.15 },
      { x: 0.2, z: -0.9 }
    ];
    for (const position of positions) this.scene.spawn(this.model.rollSheep(), position);
  }

  private tick = (now: number): void => {
    if (this.disposed) return;
    const delta = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const active = !this.ui.isBlocking && !this.shiftEnding;
    if (active) {
      this.collectLooseCoins(delta);
      this.updateStamina(now);
      this.updateSpawning(now);
      this.updateAutoAttack(now);
      this.updateLiquidation(now);
      this.updateRockRain(now);
    }
    if (now - this.lastKill > 2600 && this.combo !== 1) {
      this.combo = 1;
      this.ui.setCombo(1);
    }
    if (now - this.lastUiTick > 100) {
      this.lastUiTick = now;
      this.ui.updateStaminaOnly();
    }
    this.animationFrame = requestAnimationFrame(this.tick);
  };

  private updateStamina(now: number): void {
    if (this.model.state.stamina <= 0) {
      if (!this.exhaustionStartedAt) this.exhaustionStartedAt = now;
      if (now - this.exhaustionStartedAt >= 800) this.finishShift();
      return;
    }
    this.exhaustionStartedAt = 0;
  }

  private updateSpawning(now: number): void {
    const target = Math.min(14, this.model.stats.spawnCount + Math.floor(this.model.state.billsPaid / 4));
    if (this.scene.sheep.length >= target || now - this.lastSpawn < 1200) return;
    this.lastSpawn = now;
    this.scene.spawn(this.model.rollSheep());
  }

  private updateAutoAttack(now: number): void {
    const target = this.scene.hovered;
    if (!target?.alive || this.model.state.stamina <= 0) return;
    const cooldown = 1000 / this.model.stats.attackSpeed;
    if (this.lastAttack && now - this.lastAttack < cooldown) return;
    this.lastAttack = now;
    this.smash(target);
  }

  private smash(target: SheepEntity): void {
    if (!target.alive || this.model.state.stamina <= 0 || this.ui.isBlocking) return;
    const stats = this.model.stats;
    const result = this.model.rollSmash(target.definition.id, target.hp);
    this.dropResultLoot(target, result);
    this.scene.hit(target, result, true);
    this.audio.hit(result.critical);
    const point = this.scene.worldToScreen(target.group.position.clone().setY(1.36));
    this.ui.combatText(point.x, point.y, result.critical ? `暴击 ${numberText(result.damage)}` : `-${numberText(result.damage)}`, result.critical ? "crit" : "hit");
    this.ui.updateTarget(target);
    if (result.killed) this.handleKill(target, result.loot, result.staminaRestored);

    const splashRadius = Math.max(0.55, stats.hitRadius * 0.72);
    const splash = this.scene.getNearby(target, splashRadius).filter((entity) => entity !== target).slice(0, 2);
    for (const secondary of splash) {
      this.secondaryHit(secondary, 0.42);
    }
    if (Math.random() < stats.chainChance) {
      const chained = this.scene
        .getNearby(target, Math.max(2.2, stats.hitRadius * 1.45))
        .filter((entity) => entity !== target && !splash.includes(entity))
        .slice(0, 2);
      for (const secondary of chained) this.secondaryHit(secondary, 0.55, "电弧");
      if (chained.length) this.ui.toast("锤头通电：电弧连锁");
    }
  }

  private handleKill(entity: SheepEntity, loot: number, stamina: number): void {
    const now = performance.now();
    this.combo = now - this.lastKill < 2400 ? this.combo + 1 : 1;
    this.lastKill = now;
    this.model.setBestCombo(this.combo);
    this.ui.setCombo(this.combo);
    const point = this.scene.worldToScreen(entity.group.position.clone().setY(2.7));
    this.ui.combatText(point.x, point.y, `掉落 ${moneyText(loot)}${this.combo > 1 ? `  x${this.combo}` : ""}`, "loot");
    if (stamina > 0) this.ui.combatText(point.x + 50, point.y + 22, `体力 +${stamina}`, "stamina");
    this.audio.coin(loot >= 100);
  }

  private updateLiquidation(now: number): void {
    const chance = this.model.stats.liquidationChance;
    if (chance <= 0 || now - this.lastLiquidation < 3000) return;
    this.lastLiquidation = now;
    if (Math.random() >= chance) return;
    const candidates = this.scene.sheep.filter((entity) => entity.alive && entity.definition.id === "cloud");
    const target = candidates[Math.floor(Math.random() * candidates.length)];
    if (!target) return;
    const result = this.model.liquidate(target.definition.id, target.hp);
    this.dropResultLoot(target, result);
    this.scene.hit(target, result, false);
    this.handleKill(target, result.loot, 0);
    this.ui.toast("精准清算触发");
  }

  private updateRockRain(now: number): void {
    const perkLevel = this.model.state.perks.rockRain ?? 0;
    const skillEnabled = this.model.state.skills.includes("pow5");
    if (!perkLevel && !skillEnabled) return;
    const interval = (skillEnabled ? 7000 : 9000) - perkLevel * 1000;
    if (now - this.lastRockRain < Math.max(4200, interval)) return;
    this.lastRockRain = now;
    const candidates = this.scene.sheep.filter((entity) => entity.alive);
    const target = candidates[Math.floor(Math.random() * candidates.length)];
    if (!target) return;
    const result = this.model.rollSmash(target.definition.id, target.hp, Math.random, {
      consumeStamina: false,
      damageScale: 1.1 + perkLevel * 0.18
    });
    this.dropResultLoot(target, result);
    this.scene.hit(target, result, false);
    const point = this.scene.worldToScreen(target.group.position.clone().setY(2));
    this.ui.combatText(point.x, point.y, `落石 -${numberText(result.damage)}`, "crit");
    if (result.killed) this.handleKill(target, result.loot, result.staminaRestored);
  }

  private secondaryHit(entity: SheepEntity, damageScale: number, label = ""): void {
    if (!entity.alive) return;
    const result = this.model.rollSmash(entity.definition.id, entity.hp, Math.random, {
      consumeStamina: false,
      damageScale
    });
    this.dropResultLoot(entity, result);
    this.scene.hit(entity, result, false);
    const point = this.scene.worldToScreen(entity.group.position.clone().setY(1.32));
    this.ui.combatText(point.x, point.y, `${label ? `${label} ` : ""}-${numberText(result.damage)}`, label ? "crit" : "hit");
    if (result.killed) this.handleKill(entity, result.loot, result.staminaRestored);
  }

  private dropResultLoot(entity: SheepEntity, result: SmashResult): void {
    const position = entity.group.position.clone();
    if (result.hitLoot > 0) this.scene.dropLoot(position, result.hitLoot);
    if (result.killed && result.loot > 0) this.scene.dropLoot(position, result.loot);
  }

  private collectLooseCoins(delta: number): void {
    const collected = this.scene.collectPickups(this.model.stats.magnetRadius, delta);
    if (collected <= 0) return;
    this.model.collectLoot(collected);
    const point = this.scene.pointerScreenPoint();
    this.ui.combatText(point.x, point.y, `+${moneyText(collected)}`, "loot");
    this.audio.coin(collected >= 100);
  }

  private finishShift(): void {
    if (this.shiftEnding) return;
    this.shiftEnding = true;
    const missed = this.scene.clearPickups();
    this.model.recordMissedLoot(missed);
    window.setTimeout(() => this.ui.showShiftEnd(), 500);
  }

  private advanceDay(): void {
    const result = this.model.endShift();
    if (result.interest > 0) this.ui.toast(`活期利息 +${moneyText(result.interest)}`);
    if (result.passive > 0) this.ui.toast(`账外收入 +${moneyText(result.passive)}`);
    if (result.bankrupt) {
      this.ui.showBankruptcy();
      return;
    }
    this.scene.clearSheep();
    this.seedDesk();
    this.shiftEnding = false;
    this.exhaustionStartedAt = 0;
    this.lastSpawn = performance.now();
    this.lastAttack = performance.now();
    this.ui.closeModal();
  }

  private restartCycle(): void {
    const earned = this.model.declareBankruptcy();
    this.scene.clearPickups();
    this.scene.clearSheep();
    this.seedDesk();
    this.shiftEnding = false;
    this.exhaustionStartedAt = 0;
    this.lastAttack = performance.now();
    this.ui.closeModal();
    this.ui.toast(`新轮回开始，获得 ${earned} 轮回点`, "achievement");
  }

  private applySettings(): void {
    const settings = this.model.state.settings;
    this.audio.setEnabled(settings.sound);
    this.scene.setMotionPreferences(settings.reducedMotion, settings.screenShake);
    document.documentElement.classList.toggle("reduce-motion", settings.reducedMotion);
  }

  private async toggleFullscreen(): Promise<void> {
    if (window.desktop) {
      await window.desktop.setFullscreen(true);
      return;
    }
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  }

  private createDebugApi(): DebugGameApi {
    return {
      snapshot: () => this.model.snapshot(),
      grantResources: (cash = 5000, skillPoints = 12, prestigePoints = 50) => {
        this.model.grantDebug(cash, skillPoints, prestigePoints);
        return this.model.snapshot();
      },
      smashFirst: () => {
        const target = this.scene.sheep.find((entity) => entity.alive);
        if (!target) return false;
        this.smash(target);
        return true;
      },
      openPanel: (name) => this.ui.openPanel(name),
      forceStamina: (value) => {
        this.model.state.stamina = Math.max(0, value);
        this.ui.updateStaminaOnly();
        if (value <= 0) this.finishShift();
      },
      firstSheepPoint: () => {
        const target = this.scene.sheep.find((entity) => entity.alive);
        return target ? this.scene.worldToScreen(target.group.position.clone().setY(1.05)) : null;
      },
      firstSheepBarPoint: () => {
        const target = this.scene.sheep.find((entity) => entity.alive);
        return target ? this.scene.healthBarScreenPoint(target) : null;
      },
      firstSheepHeadPoint: () => {
        const target = this.scene.sheep.find((entity) => entity.alive);
        return target ? this.scene.headScreenPoint(target) : null;
      },
      sheepCount: () => this.scene.sheep.filter((entity) => entity.alive).length,
      pendingLoot: () => this.scene.pendingLootValue(),
      payBill: () => {
        const perks = this.model.payBill();
        if (!perks) return false;
        this.ui.showPerks(perks);
        return true;
      },
      reset: () => this.model.hardReset()
    };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    this.scene.dispose();
    delete window.__woollyGame;
  }
}

function numberText(value: number): string {
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 1 });
}

function moneyText(value: number): string {
  return `$${Math.floor(value).toLocaleString("zh-CN")}`;
}
