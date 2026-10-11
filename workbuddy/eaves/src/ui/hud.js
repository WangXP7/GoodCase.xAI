/**
 * hud.js —— 召唤式 HUD
 *
 * 设计约束（策划锁定，美术圣经 §6）：
 *   · HUD **默认全隐**。猫的状态靠姿态 / 耳朵 / 尾巴 / 瞳孔表达，不靠 UI 数字。
 *   · 玩家主动召唤才出现，且出现后会在数秒后自动淡出。
 *   · 视觉语言 = 温 · 软 · 慢。无震屏、无色闪、无顿帧。
 *
 * 因此本模块只做四件事：
 *   ① 召唤按钮（常驻，极低存在感）
 *   ② 状态面板（召唤后浮现：时刻 / 时段 / 亲密度 / 记忆温度）
 *   ③ 设置（时间流速、画面档位、重置存档）
 *   ④ 轻提示（首次进入的一次性引导）
 */

import { formatGameTime, slotAt, SLOT_ORDER } from '../systems/time.js';
import { SLOT_LIGHTING } from '../render/lighting.js';

const SLOT_LABEL = { morning: '清晨', noon: '正午', dusk: '黄昏', night: '夜里' };

/** 亲密度 → 中文描述（避免裸露数字，保持"软"的语感） */
function affectionWord(aff) {
  if (aff >= 85) return '很黏你';
  if (aff >= 68) return '亲近';
  if (aff >= 50) return '习惯你了';
  if (aff >= 32) return '还在观察';
  return '保持距离';
}

/** 记忆温度 → 描述（RUL-5 的 warmth，语义是"暖机"而非"扣分"） */
function warmthWord(warmth) {
  if (warmth >= 80) return '正暖着';
  if (warmth >= 55) return '还热乎';
  if (warmth >= 30) return '温着';
  if (warmth >= 12) return '有点凉了';
  return '凉了，需要重新暖起来';
}

export class Hud {
  /**
   * @param {HTMLElement} root 挂载容器（一般是 #ui）
   * @param {object} [opts]
   * @param {Function} [opts.onTimeScaleChange] (mode:'accelerated'|'real') => void
   * @param {Function} [opts.onResetSave] () => void
   */
  constructor(root, opts = {}) {
    this.root = root;
    this.opts = opts;
    this.visible = false;
    this._autoHideTimer = 0;
    this._firstRun = true;

    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <button class="hud-summon" type="button" title="查看状态（或按 H）" aria-label="查看状态">
        <span class="hud-summon-dot"></span>
      </button>

      <div class="hud-panel" hidden>
        <div class="hud-time">
          <span class="hud-clock">--:--</span>
          <span class="hud-slot">—</span>
        </div>
        <div class="hud-cat">
          <div class="hud-row"><span class="hud-k">它对你</span><span class="hud-v hud-aff">—</span></div>
          <div class="hud-row"><span class="hud-k">现在</span><span class="hud-v hud-warmth">—</span></div>
          <div class="hud-row"><span class="hud-k">正在</span><span class="hud-v hud-state">—</span></div>
        </div>
        <div class="hud-actions">
          <button class="hud-btn" data-act="settings" type="button">设置</button>
          <button class="hud-btn" data-act="hide" type="button">收起</button>
        </div>
      </div>

      <div class="hud-settings" hidden>
        <div class="hud-srow">
          <span class="hud-k">时间流速</span>
          <div class="hud-seg" data-group="timescale">
            <button class="hud-segbtn is-on" data-val="accelerated" type="button">加速 ×12</button>
            <button class="hud-segbtn" data-val="real" type="button">真实</button>
          </div>
        </div>
        <div class="hud-srow">
          <span class="hud-k">画面档位</span>
          <span class="hud-v hud-tier">—</span>
        </div>
        <div class="hud-srow">
          <span class="hud-k">帧率</span>
          <span class="hud-v hud-fps">—</span>
        </div>
        <div class="hud-actions">
          <button class="hud-btn hud-danger" data-act="reset" type="button">重置存档</button>
          <button class="hud-btn" data-act="close-settings" type="button">关闭</button>
        </div>
      </div>

      <div class="hud-toast" hidden></div>
    `;
    root.appendChild(this.el);

    this.panel = this.el.querySelector('.hud-panel');
    this.settings = this.el.querySelector('.hud-settings');
    this.toast = this.el.querySelector('.hud-toast');
    this.clock = this.el.querySelector('.hud-clock');
    this.slotEl = this.el.querySelector('.hud-slot');
    this.affEl = this.el.querySelector('.hud-aff');
    this.warmthEl = this.el.querySelector('.hud-warmth');
    this.stateEl = this.el.querySelector('.hud-state');
    this.tierEl = this.el.querySelector('.hud-tier');
    this.fpsEl = this.el.querySelector('.hud-fps');

    this._bind();
  }

  _bind() {
    this.el.querySelector('.hud-summon').addEventListener('click', () => this.toggle());

    this.el.querySelector('[data-act="hide"]').addEventListener('click', () => this.hide());
    this.el.querySelector('[data-act="settings"]').addEventListener('click', () => {
      this.settings.hidden = false;
      this.panel.hidden = true;
    });
    this.el.querySelector('[data-act="close-settings"]').addEventListener('click', () => {
      this.settings.hidden = true;
      this.panel.hidden = false;
    });
    this.el.querySelector('[data-act="reset"]').addEventListener('click', () => {
      // 二次确认：存档是玩家唯一不可再生的投入
      if (this.el.querySelector('[data-act="reset"]').dataset.armed === '1') {
        this.opts.onResetSave?.();
        this._disarmReset();
      } else {
        const b = this.el.querySelector('[data-act="reset"]');
        b.dataset.armed = '1';
        b.textContent = '真的要重置？再点一次';
        clearTimeout(this._resetTimer);
        this._resetTimer = setTimeout(() => this._disarmReset(), 4000);
      }
    });

    this.el.querySelectorAll('[data-group="timescale"] .hud-segbtn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.el.querySelectorAll('[data-group="timescale"] .hud-segbtn').forEach((b) => b.classList.remove('is-on'));
        btn.classList.add('is-on');
        this.opts.onTimeScaleChange?.(btn.dataset.val);
      });
    });
  }

  _disarmReset() {
    const b = this.el.querySelector('[data-act="reset"]');
    if (!b) return;
    b.dataset.armed = '0';
    b.textContent = '重置存档';
  }

  /** 键盘/触摸召唤 */
  toggle() {
    this.visible ? this.hide() : this.show();
  }

  show() {
    this.visible = true;
    this.panel.hidden = false;
    this.el.classList.add('is-open');
    this._autoHideTimer = 6; // 秒后自动淡出，回到"全隐"
  }

  hide() {
    this.visible = false;
    this.panel.hidden = true;
    this.settings.hidden = true;
    this.el.classList.remove('is-open');
  }

  /**
   * 每帧更新。
   * @param {number} dt 真实秒
   * @param {object} ctx { gameMinutes, catState, tierName, fps }
   */
  update(dt, ctx = {}) {
    if (this.visible) {
      this._autoHideTimer -= dt;
      if (this._autoHideTimer <= 0 && this.settings.hidden) this.hide();
    }

    const gm = ctx.gameMinutes ?? 0;
    if (this.clock) this.clock.textContent = formatGameTime(gm);
    if (this.slotEl) this.slotEl.textContent = SLOT_LABEL[slotAt(gm)] ?? '';

    const cs = ctx.catState;
    if (cs) {
      if (this.affEl) this.affEl.textContent = affectionWord(cs.personality?.aff ?? 0);
      if (this.warmthEl) this.warmthEl.textContent = warmthWord(cs.warmth ?? 0);
      if (this.stateEl) this.stateEl.textContent = this._stateWord(cs.state);
    }
    if (this.tierEl && ctx.tierName) this.tierEl.textContent = `${ctx.tierName} 档`;
    if (this.fpsEl && ctx.fps != null) this.fpsEl.textContent = `${Math.round(ctx.fps)} fps`;
  }

  _stateWord(state) {
    const map = {
      idle: '发呆',
      rest: '打盹',
      sleep: '睡着',
      play: '玩',
      eat: '吃东西',
      drink: '喝水',
      groom: '舔毛',
      explore: '巡视',
      alert: '竖起耳朵',
      stretch: '伸懒腰',
      walk: '走动',
      sit: '坐着',
    };
    return map[state] || state || '—';
  }

  /** 轻提示（自动消失） */
  say(text, seconds = 3.2) {
    if (!this.toast) return;
    this.toast.textContent = text;
    this.toast.hidden = false;
    this.toast.classList.add('is-in');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      this.toast.classList.remove('is-in');
      setTimeout(() => (this.toast.hidden = true), 400);
    }, seconds * 1000);
  }

  /** 首次进入的引导（只显示一次） */
  firstRunHint() {
    if (!this._firstRun) return;
    this._firstRun = false;
    this.say('点它，看看它愿不愿意', 4.5);
  }

  dispose() {
    clearTimeout(this._toastTimer);
    clearTimeout(this._resetTimer);
    this.el.remove();
  }
}

export default Hud;
