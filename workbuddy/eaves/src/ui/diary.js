/**
 * diary.js —— 回归日记
 *
 * 依据：GDD §5.6 / snapshot.js 的 generateDiary()
 * 玩家离开一段时间后回来，看到的是"它不在的这段时间里，它自己做了些什么"。
 *
 * ⚠️ 文案铁律（RUL-5 影响面）：禁止出现"等了你很久"这类把回归框定为
 *    补偿行为的表述。日记的语气是"它自己过得挺好的"，不是"它想你"。
 *
 * @see src/systems/snapshot.js  generateDiary() 返回
 *      Array<{index, slot, time, place, behavior, comment, lines, long}>
 */

const SLOT_LABEL = { morning: '清晨', noon: '正午', dusk: '黄昏', night: '夜里' };

export class Diary {
  /**
   * @param {HTMLElement} root
   * @param {object} [opts]
   * @param {Function} [opts.onClose]
   */
  constructor(root, opts = {}) {
    this.root = root;
    this.opts = opts;
    this.isOpen = false;
    this.cards = [];
    this.index = 0;

    this.el = document.createElement('div');
    this.el.className = 'diary';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="diary-scrim"></div>
      <div class="diary-sheet" role="dialog" aria-label="回归日记">
        <div class="diary-head">
          <span class="diary-title">你不在的这段时间</span>
          <span class="diary-sub"></span>
        </div>
        <div class="diary-body"></div>
        <div class="diary-foot">
          <button class="diary-nav" data-dir="-1" type="button">←</button>
          <span class="diary-pos"></span>
          <button class="diary-nav" data-dir="1" type="button">→</button>
          <button class="diary-close" type="button">知道了</button>
        </div>
      </div>
    `;
    root.appendChild(this.el);

    this.bodyEl = this.el.querySelector('.diary-body');
    this.subEl = this.el.querySelector('.diary-sub');
    this.posEl = this.el.querySelector('.diary-pos');

    this.el.querySelector('.diary-close').addEventListener('click', () => this.hide());
    this.el.querySelectorAll('.diary-nav').forEach((b) => {
      b.addEventListener('click', () => this.step(Number(b.dataset.dir)));
    });
    this.el.querySelector('.diary-scrim').addEventListener('click', () => this.hide());
  }

  /**
   * 打开日记。
   * @param {Array} cards generateDiary() 的产物
   * @param {object} [meta] { offlineMinutes, tier }
   */
  show(cards, meta = {}) {
    this.cards = Array.isArray(cards) ? cards : [];
    if (this.cards.length === 0) return false;

    this.index = 0;
    this.el.hidden = false;
    requestAnimationFrame(() => this.el.classList.add('is-in'));
    this.isOpen = true;

    const mins = meta.offlineMinutes ?? 0;
    if (mins < 90) this.subEl.textContent = '刚离开一小会儿';
    else if (mins < 60 * 24) this.subEl.textContent = `离开了约 ${Math.round(mins / 60)} 小时`;
    else this.subEl.textContent = `离开了约 ${Math.round(mins / (60 * 24))} 天`;

    this._render();
    return true;
  }

  step(dir) {
    if (!this.isOpen || this.cards.length === 0) return;
    this.index = (this.index + dir + this.cards.length) % this.cards.length;
    this._render();
  }

  _render() {
    const c = this.cards[this.index];
    if (!c) return;
    const slot = SLOT_LABEL[c.slot] ?? '';
    const lines = Array.isArray(c.lines) ? c.lines : [c.comment].filter(Boolean);

    this.bodyEl.innerHTML = `
      <div class="diary-card">
        <div class="diary-meta">
          <span class="diary-slot">${slot}</span>
          <span class="diary-time">${c.time ?? ''}</span>
          ${c.place ? `<span class="diary-place">${c.place}</span>` : ''}
        </div>
        <div class="diary-behavior">${c.behavior ?? ''}</div>
        <div class="diary-lines">${lines.map((l) => `<p>${l}</p>`).join('')}</div>
      </div>
    `;
    this.posEl.textContent = `${this.index + 1} / ${this.cards.length}`;
  }

  hide() {
    if (!this.isOpen) return;
    this.el.classList.remove('is-in');
    this.isOpen = false;
    setTimeout(() => (this.el.hidden = true), 320);
    this.opts.onClose?.();
  }

  dispose() {
    this.el.remove();
  }
}

export default Diary;
