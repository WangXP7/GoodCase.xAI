import { ACHIEVEMENTS, COIN_VALUES, HAMMERS, JEWELRY, PERKS, SHEEP, SKILLS } from "./balance";
import type { GameModel } from "./state";
import type { GameState, PerkDefinition } from "./types";
import type { SheepEntity } from "./scene";

const money = (value: number) => `$${Math.floor(value).toLocaleString("zh-CN")}`;
const number = (value: number, digits = 0) => value.toLocaleString("zh-CN", { maximumFractionDigits: digits });
const percent = (value: number, digits = 0) => `${(value * 100).toFixed(digits)}%`;

export interface UiActions {
  advanceDay(): void;
  restartCycle(): void;
  requestFullscreen(): void;
  applySettings(): void;
}

export class GameUI {
  readonly sceneHost: HTMLElement;
  private readonly modalLayer: HTMLElement;
  private readonly modalCard: HTMLElement;
  private readonly toastLayer: HTMLElement;
  private readonly targetCard: HTMLElement;
  private blocking = false;
  private lastAchievements = 0;
  private actions: UiActions | null = null;

  constructor(private readonly root: HTMLElement, private readonly model: GameModel) {
    this.root.innerHTML = `
      <main class="game-shell" data-testid="game-shell">
        <section id="scene-host" class="scene-host" aria-label="游戏桌面"></section>
        <div class="scene-vignette" aria-hidden="true"></div>
        <div class="scene-noise" aria-hidden="true"></div>

        <header class="hud-top">
          <section class="stamina-panel" aria-label="体力">
            <div class="stamina-title"><span>体力</span><strong id="stamina-text">120 / 120</strong></div>
            <div class="meter"><div id="stamina-fill" class="meter-fill"></div></div>
          </section>
          <section id="combo-panel" class="combo-panel" aria-live="polite">
            <span>连碎</span><strong id="combo-text">x1</strong>
          </section>
          <section class="currency-row" aria-label="资源">
            <div class="chip"><span class="chip-icon cash-icon">$</span><strong id="cash-text">0</strong></div>
            <div class="chip"><span class="chip-icon day-icon">日</span><strong id="day-text">1</strong></div>
            <div class="chip"><span class="chip-icon ticket-icon">券</span><strong id="ticket-text">2</strong></div>
          </section>
        </header>

        <button id="bill-button" class="bill-card" type="button" data-testid="bill-button">
          <span id="bill-icon" class="bill-icon">☎</span>
          <span class="bill-copy"><small>本期账单</small><strong id="bill-name">手机欠费</strong><em id="bill-due">3 天后到期</em></span>
          <span id="bill-amount" class="bill-amount">$75</span>
          <span id="bill-status" class="bill-status">查看</span>
        </button>

        <aside id="target-card" class="target-card" aria-live="polite">
          <div class="target-avatar">羊</div>
          <div><strong id="target-name">把鼠标移到肥羊上</strong><small id="target-subtitle">停留即可自动挥锤</small></div>
          <div id="target-hp" class="target-hp">—</div>
        </aside>

        <nav class="bottom-nav" aria-label="游戏功能">
          <button type="button" data-panel="bills"><span>▤</span>账单</button>
          <button type="button" data-panel="skills"><span>⌁</span>技能树</button>
          <button type="button" data-panel="shop"><span>⌕</span>锤铺</button>
          <button type="button" data-panel="collection"><span>◉</span>收藏</button>
          <button type="button" data-panel="shuffle"><span>♣</span>猜肥羊</button>
          <button type="button" data-panel="prestige"><span>◇</span>轮回饰品</button>
          <button type="button" data-panel="settings"><span>⚙</span>设置</button>
        </nav>

        <div id="float-layer" class="float-layer" aria-hidden="true"></div>
        <div id="toast-layer" class="toast-layer" aria-live="polite"></div>
        <div id="modal-layer" class="modal-layer hidden" role="dialog" aria-modal="true">
          <div id="modal-card" class="modal-card"></div>
        </div>
      </main>`;

    this.sceneHost = this.required("scene-host");
    this.modalLayer = this.required("modal-layer");
    this.modalCard = this.required("modal-card");
    this.toastLayer = this.required("toast-layer");
    this.targetCard = this.required("target-card");

    this.required("bill-button").addEventListener("click", () => this.openBills());
    this.root.querySelectorAll<HTMLButtonElement>("[data-panel]").forEach((button) => {
      button.addEventListener("click", () => this.openPanel(button.dataset.panel ?? "bills"));
    });
    this.modalLayer.addEventListener("pointerdown", (event) => {
      if (event.target === this.modalLayer && this.modalLayer.dataset.dismissible === "true") this.closeModal();
    });
  }

  bindActions(actions: UiActions): void {
    this.actions = actions;
  }

  get isBlocking(): boolean {
    return this.blocking;
  }

  render(state: GameState, reason = "render"): void {
    const stats = this.model.stats;
    this.text("cash-text", money(state.cash));
    this.text("day-text", `${state.day}`);
    this.text("ticket-text", `${state.tickets}`);
    this.text("stamina-text", `${Math.ceil(state.stamina)} / ${Math.round(stats.maxStamina)}`);
    const staminaRatio = Math.max(0, Math.min(1, state.stamina / stats.maxStamina));
    const fill = this.required("stamina-fill");
    fill.style.width = `${staminaRatio * 100}%`;
    fill.classList.toggle("danger", staminaRatio < 0.22);

    const bill = state.currentBill;
    const days = bill.dueDay - state.day;
    this.text("bill-icon", bill.icon);
    this.text("bill-name", bill.name);
    this.text("bill-amount", money(bill.amount));
    this.text("bill-due", days > 0 ? `${days} 天后到期` : days === 0 ? "今天到期" : `逾期 ${Math.abs(days)} 天`);
    this.text("bill-status", state.cash >= bill.amount ? "可支付" : `差 ${money(bill.amount - state.cash)}`);
    const billButton = this.required("bill-button");
    billButton.classList.toggle("payable", state.cash >= bill.amount);
    billButton.classList.toggle("overdue", days < 0);

    if (state.achievements.length > this.lastAchievements && reason !== "init") {
      const id = state.achievements[state.achievements.length - 1];
      const found = ACHIEVEMENTS.find((item) => item.id === id);
      if (found) this.toast(`成就解锁：${found.name}`, "achievement");
    }
    this.lastAchievements = state.achievements.length;
  }

  updateStaminaOnly(): void {
    const state = this.model.state;
    const max = this.model.stats.maxStamina;
    this.text("stamina-text", `${Math.ceil(state.stamina)} / ${Math.round(max)}`);
    const ratio = Math.max(0, Math.min(1, state.stamina / max));
    const fill = this.required("stamina-fill");
    fill.style.width = `${ratio * 100}%`;
    fill.classList.toggle("danger", ratio < 0.22);
  }

  setCombo(combo: number): void {
    this.text("combo-text", `x${combo}`);
    const panel = this.required("combo-panel");
    panel.classList.toggle("visible", combo > 1);
    panel.classList.remove("pulse");
    void panel.offsetWidth;
    panel.classList.add("pulse");
  }

  showTarget(entity: SheepEntity | null): void {
    this.targetCard.classList.toggle("visible", Boolean(entity));
    if (!entity) {
      this.text("target-name", "把鼠标移到肥羊上");
      this.text("target-subtitle", "停留即可自动挥锤");
      this.text("target-hp", "—");
      return;
    }
    this.text("target-name", entity.definition.name);
    this.text("target-subtitle", entity.definition.subtitle);
    this.text("target-hp", `${Math.ceil(entity.hp)} / ${entity.maxHp}`);
  }

  updateTarget(entity: SheepEntity): void {
    if (entity.alive) this.text("target-hp", `${Math.ceil(entity.hp)} / ${entity.maxHp}`);
  }

  combatText(x: number, y: number, text: string, kind: "hit" | "crit" | "loot" | "stamina" = "hit"): void {
    const layer = this.required("float-layer");
    const element = document.createElement("span");
    element.className = `combat-text ${kind}`;
    element.textContent = text;
    const rect = this.root.getBoundingClientRect();
    element.style.left = `${x - rect.left}px`;
    element.style.top = `${y - rect.top}px`;
    layer.append(element);
    window.setTimeout(() => element.remove(), 1150);
  }

  toast(message: string, kind: "normal" | "error" | "achievement" = "normal"): void {
    const element = document.createElement("div");
    element.className = `toast ${kind}`;
    element.textContent = message;
    this.toastLayer.append(element);
    requestAnimationFrame(() => element.classList.add("visible"));
    window.setTimeout(() => {
      element.classList.remove("visible");
      window.setTimeout(() => element.remove(), 250);
    }, 2600);
  }

  openPanel(panel: string): void {
    if (panel === "bills") this.openBills();
    else if (panel === "skills") this.openSkills();
    else if (panel === "shop") this.openShop();
    else if (panel === "collection") this.openCollection();
    else if (panel === "shuffle") this.openShuffle();
    else if (panel === "prestige") this.openPrestige();
    else if (panel === "settings") this.openSettings();
  }

  openBills(): void {
    const state = this.model.state;
    const bill = state.currentBill;
    const days = bill.dueDay - state.day;
    const stats = this.model.stats;
    const status = days > 0 ? `还剩 ${days} 天` : days === 0 ? "今天到期" : `已逾期 ${Math.abs(days)} 天`;
    this.openModal(
      "账单必须支付",
      `<div class="bill-detail">
        <div class="paper-bill">
          <div class="paper-pin"></div>
          <small>第 ${state.nextBillIndex} 张 · 轮回 ${state.cycle}</small>
          <div class="paper-icon">${bill.icon}</div>
          <h2>${bill.name}</h2>
          <strong>${money(bill.amount)}</strong>
          <p>${status} · 宽限 ${stats.graceDays} 天</p>
          <div class="dashed"></div>
          <p>现有现金 ${money(state.cash)}</p>
        </div>
        <div class="bill-rules">
          <h3>本轮规则</h3>
          <p>每次挥锤消耗体力；体力耗尽会结束本局并推进一天。没吸到手边的钱币会留在桌上并在结算时损失。</p>
          <p>技能树直接花现金购买。支付账单可获得三选一增益；每付 3 张账单另送 1 张猜羊券。</p>
          <button id="pay-bill" class="primary large" type="button" ${state.cash < bill.amount ? "disabled" : ""} data-testid="pay-bill">
            ${state.cash >= bill.amount ? `支付 ${money(bill.amount)}` : `还差 ${money(bill.amount - state.cash)}`}
          </button>
        </div>
      </div>`,
      true
    );
    this.modalCard.querySelector<HTMLButtonElement>("#pay-bill")?.addEventListener("click", () => {
      const perks = this.model.payBill();
      if (!perks) {
        this.toast("现金还不够，继续砸羊。", "error");
        return;
      }
      this.showPerks(perks);
    });
  }

  showPerks(perks: PerkDefinition[]): void {
    const cards = perks
      .map((perk, index) => {
        const level = (this.model.state.perks[perk.id] ?? 0) + 1;
        return `<button class="perk-card" type="button" data-perk="${perk.id}" data-testid="perk-${index}">
          <div class="perk-glyph">${["◆", "✦", "⬡"][index] ?? "◆"}</div>
          <small>${perk.tags.join(" · ")}</small>
          <h3>${perk.name}</h3>
          <p>${perk.description(level)}</p>
          <span>升级至 Lv.${level}/${perk.maxLevel}</span>
        </button>`;
      })
      .join("");
    this.openModal(
      "账单已付清 · 选择一项增益",
      `<p class="modal-lead">债务暂时退场，挑一项能力带进下一张账单。</p><div class="perk-grid">${cards}</div>`,
      false
    );
    this.modalCard.querySelectorAll<HTMLButtonElement>("[data-perk]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.perk;
        if (id && this.model.choosePerk(id)) {
          this.toast(`已获得：${PERKS.find((item) => item.id === id)?.name ?? id}`);
          this.closeModal();
        }
      });
    });
  }

  openSkills(): void {
    const state = this.model.state;
    const branches = (["力量", "耐力", "幸运"] as const)
      .map((branch) => {
        const nodes = SKILLS.filter((node) => node.branch === branch)
          .map((node) => {
            const owned = state.skills.includes(node.id);
            const prerequisite = !node.requires || state.skills.includes(node.requires);
            const affordable = state.cash >= node.cost;
            return `<button class="skill-node ${owned ? "owned" : ""} ${!prerequisite ? "locked" : ""}" type="button" data-skill="${node.id}" ${owned || !prerequisite ? "disabled" : ""}>
              <span class="skill-tier">T${node.tier}</span><strong>${owned ? "✓ " : ""}${node.name}</strong><small>${node.description}</small><em>${owned ? "已学习" : money(node.cost)}</em>
            </button>`;
          })
          .join("");
        return `<section class="skill-branch ${branch}"><h3>${branch}</h3><div class="skill-path">${nodes}</div></section>`;
      })
      .join("");
    this.openModal("技能树", `<div class="resource-banner">可用现金 <strong>${money(state.cash)}</strong> · 玩家实机锚点：首个“更多存钱罐”节点 ${money(30)}</div><div class="skill-tree">${branches}</div>`, true, "wide");
    this.modalCard.querySelectorAll<HTMLButtonElement>("[data-skill]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.skill && this.model.buySkill(button.dataset.skill)) {
          this.toast("技能已学习");
          this.openSkills();
        } else this.toast("现金不足或前置未解锁", "error");
      });
    });
  }

  openShop(): void {
    const state = this.model.state;
    const current = HAMMERS.find((item) => item.id === state.currentHammer) ?? HAMMERS[0]!;
    const cards = HAMMERS.map((hammer) => {
      const owned = state.ownedHammers.includes(hammer.id);
      const equipped = hammer.id === state.currentHammer;
      const comparison = (value: number, baseline: number, inverse = false) => {
        const better = inverse ? value < baseline : value > baseline;
        const worse = inverse ? value > baseline : value < baseline;
        return better ? "up" : worse ? "down" : "same";
      };
      return `<article class="shop-card ${equipped ? "equipped" : ""}">
        <div class="hammer-art" style="--head:#${hammer.headColor.toString(16).padStart(6, "0")};--handle:#${hammer.handleColor.toString(16).padStart(6, "0")}"><i></i></div>
        <small>${equipped ? "正在使用" : owned ? "已拥有" : "锤具"}</small>
        <h3>${hammer.name}</h3><p>${hammer.description}</p>
        <dl class="stats">
          <div><dt>伤害</dt><dd class="${comparison(hammer.damage, current.damage)}">${number(hammer.damage, 1)}</dd></div>
          <div><dt>攻速</dt><dd class="${comparison(hammer.attackSpeed, current.attackSpeed)}">${number(hammer.attackSpeed, 2)}</dd></div>
          <div><dt>暴击</dt><dd class="${comparison(hammer.critChance, current.critChance)}">${percent(hammer.critChance)}</dd></div>
          <div><dt>暴伤</dt><dd class="${comparison(hammer.critDamage, current.critDamage)}">${percent(hammer.critDamage)}</dd></div>
          <div><dt>体耗</dt><dd class="${comparison(hammer.staminaCost, current.staminaCost, true)}">${number(hammer.staminaCost, 2)}</dd></div>
          <div><dt>范围</dt><dd class="${comparison(hammer.hitRadius, current.hitRadius)}">${number(hammer.hitRadius, 2)}</dd></div>
        </dl>
        <button type="button" data-hammer="${hammer.id}" class="${equipped ? "ghost" : "primary"}" ${equipped ? "disabled" : ""}>
          ${equipped ? "已装备" : owned ? "装备" : `购买 ${money(hammer.price)}`}
        </button>
      </article>`;
    }).join("");
    this.openModal("锤铺", `<div class="resource-banner">现金 <strong>${money(state.cash)}</strong></div><div class="shop-grid">${cards}</div>`, true, "wide");
    this.modalCard.querySelectorAll<HTMLButtonElement>("[data-hammer]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.hammer && this.model.buyHammer(button.dataset.hammer)) {
          this.toast("锤具已装备");
          this.openShop();
        } else this.toast("现金不足", "error");
      });
    });
  }

  openCollection(): void {
    const state = this.model.state;
    const coins = (Object.entries(COIN_VALUES) as [keyof typeof COIN_VALUES, number][])
      .map(([kind, value]) => {
        const names = { silver: "银币", gold: "金币", emerald: "绿宝币", ruby: "红宝币" };
        return `<div class="coin-slot ${kind}"><div class="coin-art">${value}</div><strong>${names[kind]}</strong><span>价值 $${value}</span><em>收集 ${state.collection[kind].toLocaleString("zh-CN")}</em></div>`;
      })
      .join("");
    const sheep = SHEEP.map((item) => {
      const unlocked = state.unlockedSheep.includes(item.id);
      const seen = state.seenSheep.includes(item.id);
      return `<article class="catalog-card ${unlocked ? "" : "locked"}">
        <div class="catalog-sheep" style="--wool:#${item.color.toString(16).padStart(6, "0")}">${unlocked ? "羊" : "?"}</div>
        <div><small>${unlocked ? item.subtitle : `支付 ${item.unlockAfterBills} 张账单解锁`}</small><h3>${unlocked ? item.name : "未发现"}</h3><p>${unlocked ? item.description : "继续偿还账单，提升桌面上的稀有羊种。"}</p><em>${seen ? "图鉴已记录" : unlocked ? "尚未击碎" : "锁定"}</em></div>
      </article>`;
    }).join("");
    this.openModal("收藏与图鉴", `<h3 class="section-label">硬币收藏</h3><div class="coin-collection">${coins}</div><h3 class="section-label">肥羊档案</h3><div class="catalog-grid">${sheep}</div>`, true, "wide");
  }

  openShuffle(): void {
    const state = this.model.state;
    const defaultBet = Math.max(10, Math.min(100, Math.floor(state.cash / 10)));
    this.openModal(
      "猜猜哪只肥羊",
      `<div class="shuffle-intro">
        <p>奖券决定能否入场，赌注从现金扣除。钱袋藏在三只羊中的一只下面，猜中返还 <strong>2 倍</strong>赌注。</p>
        <div class="resource-banner">猜羊券 <strong>${state.tickets}</strong> · 现金 <strong>${money(state.cash)}</strong></div>
        <label class="bet-control">本局赌注 <input id="shuffle-bet" type="number" min="10" step="10" max="${Math.floor(state.cash)}" value="${defaultBet}" /></label>
        <div class="shuffle-stage">
          ${[0, 1, 2].map((index) => `<button class="shuffle-sheep" type="button" data-shuffle-choice="${index}" aria-label="选择第 ${index + 1} 只肥羊"><span>羊</span><i></i><small>${index + 1}</small></button>`).join("")}
        </div>
        <p class="shuffle-tip">选择一只肥羊开始洗牌。</p>
      </div>`,
      true
    );
    this.modalCard.querySelectorAll<HTMLButtonElement>("[data-shuffle-choice]").forEach((button) => {
      button.addEventListener("click", () => {
        const input = this.modalCard.querySelector<HTMLInputElement>("#shuffle-bet");
        const bet = Math.floor(Number(input?.value ?? 0));
        const choice = Number(button.dataset.shuffleChoice);
        const result = this.model.playShuffle(choice, bet);
        if (!result) {
          this.toast(state.tickets < 1 ? "没有猜羊券" : "现金或赌注不符合要求", "error");
          return;
        }
        const buttons = [...this.modalCard.querySelectorAll<HTMLButtonElement>("[data-shuffle-choice]")];
        buttons.forEach((item, index) => {
          item.disabled = true;
          item.classList.add("shuffling");
          item.style.animationDelay = `${index * 90}ms`;
        });
        window.setTimeout(() => {
          buttons[result.winner]?.classList.add("winner");
          buttons[choice]?.classList.add(result.won ? "chosen-win" : "chosen-lose");
          const tip = this.modalCard.querySelector<HTMLElement>(".shuffle-tip");
          if (tip) tip.innerHTML = result.won ? `猜中了！赢得 <strong>${money(result.payout)}</strong>` : `钱袋在第 ${result.winner + 1} 只羊下，本局损失 ${money(bet)}`;
          const replay = document.createElement("button");
          replay.className = "primary replay";
          replay.textContent = "再来一局";
          replay.addEventListener("click", () => this.openShuffle());
          tip?.after(replay);
        }, 900);
      });
    });
  }

  openPrestige(): void {
    const state = this.model.state;
    const cards = JEWELRY.map((item) => {
      const owned = state.jewelry.includes(item.id);
      const equipped = state.equippedJewelry.includes(item.id);
      return `<article class="jewelry-card ${equipped ? "equipped" : ""}">
        <div class="jewel-art ${item.slot}">${item.slot === "ring" ? "◇" : "◫"}</div>
        <small>${item.slot === "ring" ? "戒指" : "手环"}</small><h3>${item.name}</h3><p>${item.description}</p>
        <button type="button" data-jewelry="${item.id}" ${equipped ? "disabled" : ""} class="${owned ? "ghost" : "primary"}">${equipped ? "已装备" : owned ? "装备" : `${item.cost} 轮回点`}</button>
      </article>`;
    }).join("");
    this.openModal(
      "轮回饰品",
      `<div class="prestige-header"><div><small>当前轮回</small><strong>${state.cycle}</strong></div><p>破产会重置现金、锤具、技能和本轮增益；饰品、成就与终生统计保留。轮回点按本轮已付账单数结算。</p><div><small>轮回点</small><strong>${state.prestigePoints}</strong></div></div><div class="jewelry-grid">${cards}</div>`,
      true,
      "wide"
    );
    this.modalCard.querySelectorAll<HTMLButtonElement>("[data-jewelry]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.jewelry;
        if (!id) return;
        const success = state.jewelry.includes(id) ? this.model.equipJewelry(id) : this.model.buyJewelry(id);
        if (success) {
          this.toast("饰品状态已更新");
          this.openPrestige();
        } else this.toast("轮回点不足", "error");
      });
    });
  }

  openSettings(): void {
    const settings = this.model.state.settings;
    this.openModal(
      "设置",
      `<div class="settings-list">
        <label><span><strong>声音</strong><small>程序化锤击与钱币音效</small></span><input type="checkbox" data-setting="sound" ${settings.sound ? "checked" : ""}></label>
        <label><span><strong>屏幕震动</strong><small>暴击时轻微移动镜头</small></span><input type="checkbox" data-setting="screenShake" ${settings.screenShake ? "checked" : ""}></label>
        <label><span><strong>减少动态效果</strong><small>加快或关闭大幅动画</small></span><input type="checkbox" data-setting="reducedMotion" ${settings.reducedMotion ? "checked" : ""}></label>
        <button id="fullscreen" class="secondary" type="button">切换全屏</button>
        <button id="tutorial-again" class="secondary" type="button">重新查看玩法说明</button>
        <button id="hard-reset" class="danger-button" type="button">清空本地存档</button>
      </div>`,
      true
    );
    this.modalCard.querySelectorAll<HTMLInputElement>("[data-setting]").forEach((input) => {
      input.addEventListener("change", () => {
        const key = input.dataset.setting as "sound" | "screenShake" | "reducedMotion";
        this.model.updateSetting(key, input.checked);
        this.actions?.applySettings();
      });
    });
    this.modalCard.querySelector<HTMLButtonElement>("#fullscreen")?.addEventListener("click", () => this.actions?.requestFullscreen());
    this.modalCard.querySelector<HTMLButtonElement>("#tutorial-again")?.addEventListener("click", () => this.showTutorial());
    this.modalCard.querySelector<HTMLButtonElement>("#hard-reset")?.addEventListener("click", () => {
      if (window.confirm("确定清空全部本地进度？此操作不可撤销。")) {
        this.model.hardReset();
        window.location.reload();
      }
    });
  }

  showTutorial(): void {
    this.openModal(
      "月底以前，把羊砸开",
      `<div class="tutorial-grid">
        <div><span>1</span><h3>悬停挥锤</h3><p>把鼠标停在肥羊上，角色会按当前攻速自动挥锤。无需连点。</p></div>
        <div><span>2</span><h3>拾取硬币</h3><p>每次击打都有机会掉币，击碎时会爆出大奖。把鼠标移近散落硬币才能收进现金，磁铁可扩大吸附范围。</p></div>
        <div><span>3</span><h3>账单倒计时</h3><p>体力耗尽推进一天。逾期超过宽限期仍未支付，就会破产并进入下一轮回。</p></div>
        <div><span>4</span><h3>构筑一轮</h3><p>支付账单后三选一增益；剩余现金用于技能树、锤具和猜羊游戏。游客羊击碎时恢复 15 体力。</p></div>
      </div><button id="start-game" class="primary large centered" data-testid="start-game" type="button">开始砸羊</button>`,
      false
    );
    this.modalCard.querySelector<HTMLButtonElement>("#start-game")?.addEventListener("click", () => {
      this.model.completeTutorial();
      this.closeModal();
    });
  }

  showShiftEnd(): void {
    const state = this.model.state;
    const bill = state.currentBill;
    const days = bill.dueDay - state.day;
    this.openModal(
      `第 ${state.day} 天结束`,
      `<div class="shift-summary"><div class="moon">☾</div><h2>手软了！</h2><div class="run-ledger"><div><span>有效挥锤</span><strong>${state.runStats.swings}</strong></div><div><span>击碎肥羊</span><strong>${state.runStats.sheepSmashed}</strong></div><div><span>拾取钱堆</span><strong>${state.runStats.pickupsCollected}</strong></div><div><span>本局现金</span><strong>${money(state.runCash)}</strong></div></div><p>未拾取而损失 <strong>${money(state.runStats.missedCash)}</strong>；当前现金 <strong>${money(state.cash)}</strong>。</p><p>${bill.name} ${money(bill.amount)}：${days > 0 ? `还剩 ${days} 天` : days === 0 ? "今天到期" : `已逾期 ${Math.abs(days)} 天`}。</p><button id="advance-day" class="primary large centered" type="button">结算并进入下一天</button></div>`,
      false
    );
    this.modalCard.querySelector<HTMLButtonElement>("#advance-day")?.addEventListener("click", () => this.actions?.advanceDay());
  }

  showBankruptcy(): void {
    const state = this.model.state;
    const earned = Math.max(1, state.billsPaid);
    this.openModal(
      "破产通知",
      `<div class="bankruptcy"><div class="stamp">无力偿还</div><h2>${state.currentBill.name} 已超过宽限期</h2><p>催收员拿走了本轮现金和临时构筑。你将获得 <strong>${earned} 轮回点</strong>，进入第 ${state.cycle + 1} 次轮回。</p><p>永久饰品、成就、终生收入与总账单数不会丢失。</p><button id="restart-cycle" class="primary large centered" type="button">接受现实，再来一轮</button></div>`,
      false
    );
    this.modalCard.querySelector<HTMLButtonElement>("#restart-cycle")?.addEventListener("click", () => this.actions?.restartCycle());
  }

  closeModal(): void {
    this.blocking = false;
    this.modalLayer.classList.add("hidden");
    this.modalCard.replaceChildren();
  }

  private openModal(title: string, body: string, dismissible: boolean, size = "normal"): void {
    this.blocking = true;
    this.modalLayer.dataset.dismissible = `${dismissible}`;
    this.modalLayer.classList.remove("hidden");
    this.modalCard.className = `modal-card ${size}`;
    this.modalCard.innerHTML = `<header class="modal-header"><div><small>羊债必须清</small><h2>${title}</h2></div>${dismissible ? '<button id="modal-close" class="modal-close" type="button" aria-label="关闭">×</button>' : ""}</header><div class="modal-body">${body}</div>`;
    this.modalCard.querySelector<HTMLButtonElement>("#modal-close")?.addEventListener("click", () => this.closeModal());
  }

  private required<T extends HTMLElement = HTMLElement>(id: string): T {
    const element = this.root.querySelector<T>(`#${id}`);
    if (!element) throw new Error(`Missing UI element #${id}`);
    return element;
  }

  private text(id: string, value: string): void {
    this.required(id).textContent = value;
  }
}
