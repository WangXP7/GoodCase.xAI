// The HUD: everything on screen while walking the isle. Nothing here needs the mouse.
// update() reads game.state and game.hud and writes to the DOM only what changed.
import { h, s, setText, setClass, setAttr, setStyle, setShown, clamp01, rgba } from './dom.js';
import { signGlyph, MARK } from './glyphs.js';

const BONE = '#ddd5c4';
const EMBER = '#e2702c';
const TAU = Math.PI * 2;
const wrapPi = (a) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};

/** `onRegion(id)` is called when game.hud.region names a place the HUD has not announced yet. */
export function createHud(game, icons, onRegion) {
  const D = game.data;
  const el = h('div', { class: 'tp-layer tp-hud' });

  // ---- objective ------------------------------------------------------------------------------
  const objTitle = h('div', { class: 'tp-label tp-obj-title' });
  const objText = h('div', { class: 'tp-obj-text' });
  const primeEls = {};
  const objPrimes = h('div', { class: 'tp-obj-primes' });
  for (const id of ['salt', 'mercury', 'sulfur']) {
    primeEls[id] = h('span', { class: 'tp-obj-prime' }, signGlyph(id));
    objPrimes.append(primeEls[id]);
  }
  const obj = h('div', { class: 'tp-obj' }, objTitle, objText, objPrimes);

  // ---- compass --------------------------------------------------------------------------------
  const cvs = h('canvas');
  const compass = h('div', { class: 'tp-compass' }, cvs);
  const cctx = cvs.getContext('2d');
  const markPaths = { lantern: new Path2D(MARK.lantern), home: new Path2D(MARK.home) };
  const flamePath = new Path2D(MARK.flame);
  let cW = 0,
    cH = 0,
    cDpr = 1,
    cDirty = true,
    cKey = '',
    cFonts = 0,
    sans = '',
    disp = '';
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => (cDirty = true)).observe(compass);
  if (document.fonts) {
    const bump = () => {
      cFonts++;
      cDirty = true;
    };
    if (document.fonts.ready) document.fonts.ready.then(bump);
    if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', bump);
  }

  // ---- crosshair and focus prompt -------------------------------------------------------------
  const cross = h('div', { class: 'tp-cross', data: { s: 'dot' } }, h('i', { class: 'tp-cross-dot' }), h('i', { class: 'tp-cross-ring' }), h('i', { class: 'tp-cross-ticks' }));
  const holdFill = s('circle', { class: 'tp-hold-fill', cx: 18, cy: 18, r: 16, pathLength: 1 });
  const hold = s('svg', { class: 'tp-hold', viewBox: '0 0 36 36' }, s('circle', { class: 'tp-hold-track', cx: 18, cy: 18, r: 16 }), holdFill);
  const focusKey = h('span', { class: 'tp-key' });
  const focusVerb = h('span', { class: 'tp-label tp-focus-verb' });
  const focusName = h('span', { class: 'tp-focus-name' });
  const focus = h('div', { class: 'tp-focus' }, h('span', { class: 'tp-focus-keywrap' }, focusKey, hold), focusVerb, focusName);

  // ---- hint, belt, health ---------------------------------------------------------------------
  const hint = h('div', { class: 'tp-hint' });
  const belt = h('div', { class: 'tp-belt' });
  const beltName = h('div', { class: 'tp-belt-name' });
  const healthFill = h('i');
  const healthGhost = h('b');
  const health = h('div', { class: 'tp-health' }, healthGhost, healthFill);
  const statuses = h('div', { class: 'tp-statuses' });
  const saveMark = h('div', { class: 'tp-save' }, h('i'));

  el.append(obj, compass, cross, focus, hint, statuses, beltName, belt, health, saveMark);

  // ---- vignettes live outside the HUD layer so they also tint cutscenes -----------------------
  const vigGloom = h('div', { class: 'tp-vig tp-vig-gloom' }, h('i'));
  const vigHurt = h('div', { class: 'tp-vig tp-vig-hurt' });
  const vigLow = h('div', { class: 'tp-vig tp-vig-low' });

  let beltKey = '',
    slots = {},
    heldPrev = null,
    beltNameT = 0;
  let hpShown = 1,
    hpT = 0,
    hurtT = 0,
    hurtAmp = 0,
    objKey = '',
    regionSeen = null;
  const status = {}; // id -> { el, fill, peak }

  function buildBelt(ids) {
    slots = {};
    belt.replaceChildren(
      ...ids.map((id) => {
        const p = D.POTIONS[id];
        const n = h('span', { class: 'tp-slot-n' });
        const slot = h('div', { class: 'tp-slot', style: { '--c': p.color } }, h('span', { class: 'tp-slot-key', text: String(p.key) }), icons.make('potion', id), n);
        slots[id] = { el: slot, n };
        return slot;
      })
    );
  }

  function statusLine(id, label, color) {
    const fill = h('i', { style: { background: color } });
    const node = h('div', { class: 'tp-status' }, h('span', { class: 'tp-label', text: label }), h('span', { class: 'tp-status-bar' }, fill));
    statuses.append(node);
    return (status[id] = { el: node, fill, peak: 0, on: false });
  }
  statusLine('levity', D.POTIONS.levity.name, D.POTIONS.levity.color);
  statusLine('regen', 'Mending', D.POTIONS.vitae.color);
  for (const k in status) setShown(status[k].el, false);

  function updateStatus(id, seconds) {
    const st = status[id];
    if (seconds > 0.05) {
      if (!st.on || seconds > st.peak) st.peak = Math.max(seconds, 1);
      st.on = true;
      setShown(st.el, true);
      setStyle(st.fill, 'transform', `scaleX(${(Math.round(clamp01(seconds / st.peak) * 200) / 200).toFixed(3)})`);
    } else if (st.on) {
      st.on = false;
      st.peak = 0;
      setShown(st.el, false);
    }
  }

  // ---- compass drawing ------------------------------------------------------------------------
  function drawCompass(c) {
    if (cDirty) {
      cDirty = false;
      const d = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.round(compass.clientWidth * d),
        hh = Math.round(compass.clientHeight * d);
      if (w !== cW || hh !== cH) {
        cW = cvs.width = Math.max(1, w);
        cH = cvs.height = Math.max(1, hh);
        cDpr = d;
        cKey = '';
      }
      const cs = getComputedStyle(compass);
      sans = cs.getPropertyValue('--tp-sans').trim() || 'system-ui, sans-serif';
      disp = cs.getPropertyValue('--tp-display').trim() || 'Georgia, serif';
    }
    if (cW < 8) return;
    const heading = (c && c.heading) || 0;
    const marks = (c && c.marks) || [];
    let key = (Math.round(heading * 700) | 0) + '|' + cFonts;
    for (const m of marks) key += '|' + m.kind + (Math.round(m.bearing * 400) | 0) + ':' + (Math.round(m.dist) | 0);
    if (key === cKey) return;
    cKey = key;

    const x = cctx;
    x.clearRect(0, 0, cW, cH);
    const cx = cW / 2;
    const span = Math.PI / 3; // 60 degrees to either side
    const ppr = (cW / 2) / span;
    const yLine = Math.round(cH * 0.36) + 0.5;
    const fade = (d) => clamp01(1.35 - (Math.abs(d) / span) * 1.35);
    const shadow = (on) => {
      x.shadowColor = on ? 'rgba(0,0,0,0.95)' : 'transparent';
      x.shadowBlur = on ? 5 * cDpr : 0;
    };
    shadow(true);
    x.lineCap = 'butt';

    // the rule the bearings hang from, fading out at both ends
    const rule = x.createLinearGradient(0, 0, cW, 0);
    rule.addColorStop(0, rgba(BONE, 0));
    rule.addColorStop(0.22, rgba(BONE, 0.34));
    rule.addColorStop(0.78, rgba(BONE, 0.34));
    rule.addColorStop(1, rgba(BONE, 0));
    x.strokeStyle = rule;
    x.lineWidth = 1 * cDpr;
    x.beginPath();
    x.moveTo(0, yLine);
    x.lineTo(cW, yLine);
    x.stroke();

    // where the quest lies, if it is ahead: its distance takes the place of a letter
    let questPx = null;
    for (const m of marks) {
      const d = wrapPi(m.bearing - heading);
      if (m.kind === 'quest' && Math.abs(d) < 0.2 && m.dist != null) questPx = cx + d * ppr;
    }

    const letters = { 0: 'N', 6: 'E', 12: 'S', 18: 'W' };
    const fs = Math.max(10 * cDpr, cH * 0.36);
    const yText = yLine + cH * 0.2;
    x.font = `600 ${fs}px ${disp}`;
    x.textAlign = 'center';
    x.textBaseline = 'top';
    for (let k = 0; k < 24; k++) {
      const d = wrapPi((k * Math.PI) / 12 - heading);
      if (Math.abs(d) > span) continue;
      const px = Math.round(cx + d * ppr) + 0.5;
      const a = fade(d);
      const card = k % 6 === 0,
        inter = k % 3 === 0;
      const len = cH * (card ? 0.15 : inter ? 0.11 : 0.06);
      x.strokeStyle = rgba(BONE, a * (card ? 1 : inter ? 0.7 : 0.45));
      x.beginPath();
      x.moveTo(px, yLine);
      x.lineTo(px, yLine + len);
      x.stroke();
      if (card && !(questPx != null && Math.abs(questPx - px) < fs * 2.4)) {
        x.fillStyle = rgba(BONE, a * (k === 0 ? 1 : 0.78));
        x.fillText(letters[k], px, yText);
      }
    }
    // marks ride on the rule
    for (const m of marks) {
      let d = wrapPi(m.bearing - heading);
      let a = 1;
      if (Math.abs(d) > span * 0.94) {
        d = Math.sign(d) * span * 0.94;
        a = 0.55;
      }
      const px = cx + d * ppr;
      if (m.kind === 'quest') {
        const r = cH * 0.2;
        x.fillStyle = rgba(EMBER, a);
        x.beginPath();
        x.moveTo(px, yLine - r);
        x.lineTo(px + r * 0.74, yLine);
        x.lineTo(px, yLine + r);
        x.lineTo(px - r * 0.74, yLine);
        x.closePath();
        x.fill();
        if (questPx != null) {
          x.font = `500 ${fs * 0.72}px ${sans}`;
          x.fillStyle = rgba(BONE, 0.9);
          x.fillText(Math.round(m.dist) + ' m', px, yText + fs * 0.12);
          x.font = `600 ${fs}px ${disp}`;
        }
      } else {
        const p = markPaths[m.kind] || markPaths.lantern;
        const size = cH * 0.62;
        const k = size / 24;
        x.save();
        x.translate(px - size / 2, yLine - size * 0.62);
        x.scale(k, k);
        x.lineWidth = (1.2 * cDpr) / k;
        x.strokeStyle = rgba(BONE, a);
        x.lineJoin = 'round';
        // clear the rule behind the mark so it reads as a sign, not as noise
        x.shadowBlur = 0;
        x.fillStyle = 'rgba(5,5,7,0.7)';
        x.fill(p);
        x.stroke(p);
        if (m.kind === 'lantern') {
          x.fillStyle = rgba(EMBER, a);
          x.fill(flamePath);
        }
        x.restore();
        shadow(true);
      }
    }
    // the notch that marks straight ahead
    x.fillStyle = rgba(BONE, 1);
    x.beginPath();
    const n = cH * 0.085;
    x.moveTo(cx - n, yLine - n * 3.1);
    x.lineTo(cx + n, yLine - n * 3.1);
    x.lineTo(cx, yLine - n * 1.3);
    x.closePath();
    x.fill();
    shadow(false);
  }

  // ---- per-frame ------------------------------------------------------------------------------
  function update(dt) {
    const st = game.state,
      hud = game.hud || {};

    // objective
    const stage = st.quest.stage;
    const pr = st.inv.primes;
    const k = stage + (pr.salt ? 1 : 0) + (pr.mercury ? 2 : 0) + (pr.sulfur ? 4 : 0);
    if (k !== objKey) {
      objKey = k;
      const q = D.QUEST[stage] || { title: '', text: '' };
      setText(objTitle, q.title);
      setText(objText, q.text);
      const hunting = stage === 'primes';
      setShown(objPrimes, hunting);
      for (const id in primeEls) setClass(primeEls[id], 'is-got', !!pr[id]);
    }

    // the place: the game may name it here without sending a region event. Only while walking:
    // a cutscene that crosses the isle announces nothing.
    const place = hud.region;
    if (place && place !== regionSeen && st.mode === 'play') {
      regionSeen = place;
      if (onRegion) onRegion(place);
    }

    drawCompass(hud.compass);

    // crosshair
    const held = hud.held !== undefined ? hud.held : st.inv.selected;
    setAttr(cross, 'data-s', hud.crosshair || 'dot');
    if (held && D.POTIONS[held]) setStyle(cross, '--aim', D.POTIONS[held].color);

    // focus prompt
    const f = hud.focus;
    setClass(focus, 'is-on', !!f);
    if (f) {
      setText(focusKey, f.key || 'E');
      setText(focusVerb, f.verb || '');
      setText(focusName, f.name || '');
      const holding = f.hold != null;
      setClass(focus, 'is-hold', holding);
      // a style, not an attribute: the stylesheet sets the resting offset and would win over an attribute
      if (holding) setStyle(holdFill, 'stroke-dashoffset', (1 - clamp01(f.hold)).toFixed(3));
    }

    // hint
    const hintText = game.settings && game.settings.hints === false ? '' : hud.hint || '';
    setClass(hint, 'is-on', !!hintText);
    if (hintText) setText(hint, hintText);

    // belt
    let key = '';
    const ids = [];
    for (const id of D.POTION_ORDER) {
      if ((st.inv.potions[id] || 0) > 0) {
        ids.push(id);
        key += id + ',';
      }
    }
    if (key !== beltKey) {
      beltKey = key;
      buildBelt(ids);
    }
    for (const id of ids) {
      setText(slots[id].n, st.inv.potions[id]);
      setClass(slots[id].el, 'is-held', id === held);
    }
    if (held !== heldPrev) {
      heldPrev = held;
      if (held && D.POTIONS[held]) {
        setText(beltName, D.POTIONS[held].full);
        beltNameT = 2.6;
      } else beltNameT = 0;
    }
    if (beltNameT > 0) beltNameT -= dt;
    setClass(beltName, 'is-on', beltNameT > 0 && ids.length > 0);

    // health: one thin line, only while it matters
    const hp = clamp01(st.player.hp / (st.player.hpMax || 100));
    if (Math.abs(hp - hpShown) > 0.0005) {
      hpShown = hp;
      hpT = 4;
      const sc = `scaleX(${hp.toFixed(3)})`;
      setStyle(healthFill, 'transform', sc);
      setStyle(healthGhost, 'transform', sc);
    }
    if (hp >= 0.999) hpT = Math.max(0, hpT - dt);
    else hpT = 4;
    setClass(health, 'is-on', hpT > 0);
    setClass(health, 'is-low', hp < 0.3);
    setStyle(vigLow, 'opacity', hp < 0.3 && st.mode !== 'dead' ? (0.25 + (0.3 - hp) * 1.8).toFixed(2) : '0');

    updateStatus('levity', st.player.levity || 0);
    updateStatus('regen', st.player.regen || 0);

    // vignettes
    setStyle(vigGloom, 'opacity', (Math.round(clamp01(hud.gloom || 0) * 50) / 50).toFixed(2));
    if (hurtT > 0) {
      hurtT = Math.max(0, hurtT - dt);
      setStyle(vigHurt, 'opacity', (hurtAmp * (hurtT / 0.9) * (hurtT / 0.9)).toFixed(2));
    }
  }

  return {
    el,
    vignettes: [vigGloom, vigLow, vigHurt],
    update,
    hurt(amount) {
      hurtT = 0.9;
      hurtAmp = Math.min(1, 0.45 + (amount || 0) / 40);
      hpT = 4;
    },
    heal() {
      hpT = 4;
      health.classList.remove('is-heal');
      void health.offsetWidth;
      health.classList.add('is-heal');
    },
    questChanged() {
      obj.classList.remove('is-new');
      void obj.offsetWidth;
      obj.classList.add('is-new');
    },
    saved() {
      saveMark.classList.remove('is-on');
      void saveMark.offsetWidth;
      saveMark.classList.add('is-on');
    },
    beltPulse(id) {
      const sl = slots[id];
      if (!sl) return;
      sl.el.classList.remove('is-bump');
      void sl.el.offsetWidth;
      sl.el.classList.add('is-bump');
    },
    /** A region event has announced this place: game.hud.region need not announce it again. */
    sawRegion(id) {
      regionSeen = id;
    },
    /** Clear the hurt flash; with `all`, every vignette and the place last announced (back at the title). */
    reset(all) {
      hurtT = 0;
      setStyle(vigHurt, 'opacity', '0');
      if (all) {
        setStyle(vigGloom, 'opacity', '0');
        setStyle(vigLow, 'opacity', '0');
        regionSeen = null;
      }
    },
  };
}
