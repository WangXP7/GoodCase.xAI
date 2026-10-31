// HUD：DOM 刷新 + 浮层管理 + 提示气泡
import { State, on, emit } from './state.js';
import { CFG } from './config.js';
import { audio } from './audio.js';

const $ = id => document.getElementById(id);

const HEART_FULL = '♥';
const HEART_EMPTY = '♥';

export class HUD {
  constructor() {
    this.el = {
      hud: $('hud'), menu: $('menu'), pause: $('pause'), dead: $('dead'), win: $('win'),
      hearts: $('hearts'), coins: $('coins'), score: $('score'), best: $('best'),
      menuBest: $('menu-best'),
      trainDist: $('train-dist'), trainBar: $('train-bar'), speed: $('speed'),
      toasts: $('toasts'),
      sysbtns: $('sysbtns'),
      dDist: $('d-dist'), dCoins: $('d-coins'), dScore: $('d-score'),
      wDist: $('w-dist'), wCoins: $('w-coins'), wScore: $('w-score'), wHearts: $('w-hearts'),
    };
    this._lastScore = -1;
    this._bindButtons();
    this._bindEvents();
  }

  _bindButtons() {
    const fire = a => () => { audio.ui(); emit('ui-action', a); };
    $('start').addEventListener('click', fire('start'));
    $('retry').addEventListener('click', fire('restart'));
    $('d-quit').addEventListener('click', fire('menu'));
    $('w-again').addEventListener('click', fire('restart'));
    $('w-quit').addEventListener('click', fire('menu'));
    $('resume').addEventListener('click', fire('resume'));
    $('quit').addEventListener('click', fire('menu'));
    $('btn-pause').addEventListener('click', fire('pause'));
    $('btn-mute').addEventListener('click', fire('mute'));
  }

  _bindEvents() {
    on('phase', p => this._syncPhase(p));
    on('coin', e => this._coinPop(e));
    on('near-miss', () => this.toast('好险！', true));
    on('milestone', m => this.toast(m, m.includes('进站') || m.includes('前方')));
  }

  _syncPhase(p) {
    const show = (el, on) => el.classList.toggle('hidden', !on);
    show(this.el.menu, p === 'menu');
    show(this.el.pause, p === 'paused');
    show(this.el.dead, p === 'dead');
    show(this.el.win, p === 'win');
    show(this.el.hud, p === 'playing' || p === 'paused');
    show(this.el.sysbtns, p === 'playing' || p === 'paused');
    if (p === 'menu') this.el.menuBest.textContent = State.best;
    if (p === 'dead') {
      this.el.dDist.textContent = `${Math.round(State.distance)} m`;
      this.el.dCoins.textContent = State.coins;
      this.el.dScore.textContent = Math.round(State.score);
    }
    if (p === 'win') {
      this.el.wDist.textContent = `${Math.round(State.distance)} m`;
      this.el.wCoins.textContent = State.coins;
      this.el.wScore.textContent = Math.round(State.score);
      this.el.wHearts.textContent = State.hearts;
    }
    this._lastScore = -1;
  }

  _coinPop(e) {
    // 屏幕上方金币数弹跳
    this.el.coins.classList.remove('pop');
    void this.el.coins.offsetWidth;
    this.el.coins.classList.add('pop');
  }

  toast(text, teal = false) {
    const d = document.createElement('div');
    d.className = 'toast' + (teal ? ' teal' : '');
    d.textContent = text;
    this.el.toasts.appendChild(d);
    setTimeout(() => d.remove(), 1200);
  }

  update() {
    // 心
    let hearts = '';
    for (let i = 0; i < CFG.hearts; i++) {
      hearts += `<span class="${i < State.hearts ? '' : 'off'}">${HEART_FULL}</span>`;
    }
    if (this._heartsCache !== hearts) {
      this.el.hearts.innerHTML = hearts;
      this._heartsCache = hearts;
    }
    // 金币 / 分数
    this.el.coins.textContent = State.coins;
    const sc = Math.round(State.score);
    if (sc !== this._lastScore) {
      this.el.score.textContent = sc;
      this._lastScore = sc;
    }
    this.el.best.innerHTML = '最佳 <b>' + Math.round(State.best) + '</b>';
    // 距离进度
    const remaining = Math.max(0, CFG.goalDistance - State.distance);
    const pct = Math.min(100, (State.distance / CFG.goalDistance) * 100);
    this.el.trainDist.innerHTML = remaining > 0 ? `<b>${remaining >= 1000 ? (remaining / 1000).toFixed(2) + ' km' : Math.round(remaining) + ' m'}</b>` : '<b>已上车!</b>';
    this.el.trainBar.style.width = pct + '%';
    this.el.speed.innerHTML = `速度 <b>${Math.round(State.speed * 3.6)}</b> km/h`;
  }
}
