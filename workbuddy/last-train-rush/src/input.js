// 输入：键盘 + 触屏滑动 + 屏幕按钮
import { on } from './state.js';

const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
  ArrowDown: 'roll', KeyS: 'roll',
  KeyP: 'pause', Escape: 'pause',
  KeyM: 'mute',
  KeyR: 'restart',
  Enter: 'start',
};

const SWIPE_MIN = 26;   // px
const TAP_MAX = 14;     // px，小于它算点击
const TAP_MAX_MS = 260;

export class Input {
  constructor() {
    this._emitter = new Set();
    this._touchStart = null;
    this._touchMoved = false;
    this._swipeFired = false;
    this._bindKeyboard();
    this._bindTouch();
    this._bindButtons();
  }

  _fire(action) { this._emitter.forEach(cb => { try { cb(action); } catch (e) { console.error(e); } }); }
  onAction(cb) { this._emitter.add(cb); return () => this._emitter.delete(cb); }

  _bindKeyboard() {
    addEventListener('keydown', (e) => {
      const action = KEYMAP[e.code];
      if (!action) return;
      // 阻止空格/方向键滚动页面
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (e.repeat) return;
      this._fire(action);
    });
    addEventListener('blur', () => this._fire('blur'));
    document.addEventListener('visibilitychange', () => { if (document.hidden) this._fire('blur'); });
  }

  _bindTouch() {
    const app = document.getElementById('app');
    app.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      this._touchStart = { x: t.clientX, y: t.clientY, t: performance.now() };
      this._touchMoved = false;
      this._swipeFired = false;
    }, { passive: true });

    app.addEventListener('touchmove', (e) => {
      if (!this._touchStart || this._swipeFired) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - this._touchStart.x;
      const dy = t.clientY - this._touchStart.y;
      if (Math.abs(dx) < SWIPE_MIN && Math.abs(dy) < SWIPE_MIN) return;
      this._touchMoved = true;
      this._swipeFired = true;
      if (Math.abs(dx) > Math.abs(dy)) this._fire(dx > 0 ? 'right' : 'left');
      else this._fire(dy < 0 ? 'jump' : 'roll');
    }, { passive: true });

    app.addEventListener('touchend', (e) => {
      if (!this._touchStart) return;
      const dt = performance.now() - this._touchStart.t;
      if (!this._touchMoved && dt < 400) {
        const t = e.changedTouches[0];
        const dx = t.clientX - this._touchStart.x;
        const dy = t.clientY - this._touchStart.y;
        if (Math.abs(dx) < TAP_MAX && Math.abs(dy) < TAP_MAX) {
          // 点击屏幕中下部 = 跳跃（底部按钮自己有处理）
          const target = e.target;
          if (!target.closest?.('.tbtn') && !target.closest?.('.btn') && !target.closest?.('button')) {
            this._fire('jump');
          }
        }
      }
      this._touchStart = null;
    }, { passive: true });
  }

  _bindButtons() {
    const bind = (id, action) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); this._fire(action); }, { passive: false });
      el.addEventListener('click', (e) => { e.stopPropagation(); this._fire(action); });
    };
    bind('t-left', 'left');
    bind('t-right', 'right');
    bind('t-jump', 'jump');
    bind('t-roll', 'roll');
  }
}

// 触屏设备显示虚拟按键
export function setupTouchUI() {
  const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  if (isTouch) document.getElementById('touch')?.classList.add('on');
  return isTouch;
}

export { on };
