/**
 * hud.js — HUD 与反馈层
 * 纯 DOM 操作，和渲染循环解耦。
 */

export class Hud {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      hpNum: $('hpNum'), hpBar: $('hpBar'),
      ammoNum: $('ammoNum'), reloadBar: $('reloadBar').firstElementChild, reloadWrap: $('reloadBar'),
      waveNum: $('waveNum'), enemyNum: $('enemyNum'), revNum: $('revNum'), revTag: $('revTag'),
      scoreNum: $('scoreNum'), fps: $('fps'),
      crosshair: $('crosshair'), vignette: $('vignette'), flash: $('flash'),
      log: $('log'), dot: $('dot'), toasts: $('toasts'),
      start: $('start'), dead: $('dead'),
    };
    this.lastLog = '';
    this.maxLog = 60;
  }

  setVitals(health, max, ammo, mag, reloading, reloadProgress) {
    const hpPct = Math.max(0, health / max);
    this.el.hpNum.innerHTML = `${Math.round(health)}<small>/${Math.round(max)}</small>`;
    this.el.hpBar.style.transform = `scaleX(${hpPct})`;
    this.el.hpBar.style.filter = hpPct < 0.3 ? 'saturate(1.6) brightness(1.2)' : 'none';

    this.el.ammoNum.innerHTML = `${ammo}<small>/${mag}</small>`;
    if (reloading) {
      this.el.reloadWrap.classList.add('on');
      this.el.reloadBar.style.width = `${reloadProgress * 100}%`;
    } else {
      this.el.reloadWrap.classList.remove('on');
    }
  }

  setStatus(wave, enemies, revision, score) {
    this.el.waveNum.textContent = wave;
    this.el.enemyNum.textContent = enemies;
    this.el.revNum.textContent = revision;
    this.el.revTag.textContent = `rev ${revision}`;
    this.el.scoreNum.textContent = score.toLocaleString('en-US');
  }

  setFps(fps) {
    this.el.fps.textContent = `${fps} FPS`;
  }

  hitMarker() {
    this.el.crosshair.classList.add('hit');
    setTimeout(() => this.el.crosshair.classList.remove('hit'), 90);
  }

  damageFlash(intensity = 0.6) {
    this.el.vignette.style.opacity = Math.min(1, intensity);
    clearTimeout(this._vigTimer);
    this._vigTimer = setTimeout(() => { this.el.vignette.style.opacity = 0; }, 420);
    if (intensity > 0.85) {
      this.el.flash.style.opacity = 0.5;
      setTimeout(() => { this.el.flash.style.opacity = 0; }, 60);
    }
  }

  toast(text, kind = '') {
    const d = document.createElement('div');
    d.className = `toast ${kind}`;
    d.textContent = text;
    this.el.toasts.appendChild(d);
    setTimeout(() => {
      d.style.transition = 'opacity .35s, transform .35s';
      d.style.opacity = '0';
      d.style.transform = 'translateY(-8px)';
      setTimeout(() => d.remove(), 350);
    }, 2400);
  }

  /** AI 控制台日志：把 MCP 工具调用可视化出来 */
  log(tool, detail, kind = 'prop') {
    const key = `${tool}|${detail}`;
    if (key === this.lastLog) return;
    this.lastLog = key;

    const d = document.createElement('div');
    d.className = `entry ${kind}`;
    d.innerHTML = `<span class="t">${tool}</span><span class="d">${detail}</span>`;
    this.el.log.appendChild(d);
    while (this.el.log.children.length > this.maxLog) this.el.log.firstChild.remove();
    this.el.log.scrollTop = this.el.log.scrollHeight;
  }

  setConnected(on) {
    this.el.dot.classList.toggle('on', on);
  }

  showDead(stats) {
    const acc = stats.shotsFired > 0 ? Math.round((stats.shotsHit / stats.shotsFired) * 100) : 0;
    document.getElementById('stKills').textContent = stats.kills;
    document.getElementById('stAcc').textContent = `${acc}%`;
    document.getElementById('stHs').textContent = stats.headshots;
    document.getElementById('stDmg').textContent = Math.round(stats.damageDealt);
    this.el.dead.classList.remove('hidden');
    document.exitPointerLock?.();
  }

  hideDead() { this.el.dead.classList.add('hidden'); }
  hideStart() { this.el.start.classList.add('hidden'); }
}
