// HUD + UI root. Contract: G.ui { update(dt), show(screen|null), prompt(text|null), setVisible(b) }.
// The HUD sits on the frame edges, never boxes the play view, and is pointer-events:none throughout;
// only real menu buttons and form controls take clicks (so the canvas still gets the mouse capture).
import { tuning } from '../game/tuning.js';
import { createSettings } from './settings.js';
import { createMenus } from './menu.js';
import { createTitleCam } from './titlecam.js';
import { createTouchHud, layoutTouch, clearToggles, watchInsets } from './touchHud.js';
import { createOrient } from './orient.js';
import { loadFonts } from './wordmark.js';
import { formatPoints, denyText, promptParts, ammoView, remaining, clamp, keyLabel, interactVerb, shortWeaponName, narrowScreen } from './format.js';

const STAGES = ['title', 'hud', 'paused', 'dead', 'settings', 'controls'];
const CORNERS = ['tl', 'tr', 'tc', 'bl', 'br', 'bc'];
const TOUCH_CORNER = { bl: 'tl', br: 'tr', bc: 'tc' }; // nothing stacks under a thumb
const POP_LIFE = 1.15;
const MAX_POPS = 6;
const STAGE_SAMPLE = {
  round: 7, points: 4350, mag: 9, reserve: 48, health: 0.68, remaining: 14, kills: 61, earned: 5620, best: 9,
};

const STAGE_BUY = { id: 'stage', kind: 'wallAmmo', label: 'Ammo', cost: 250 };
const STAGE_HOLD = { id: 'stage', kind: 'search', label: 'Crate', cost: 0, hold: 2 };

const h = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const kids = (p, ...els) => { for (const e of els) p.appendChild(e); return p; };
// one media query object for the life of the page (it was looked up twice a frame)
const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const reduced = () => !!reducedQuery && reducedQuery.matches;

export function createUi(G) {
  const query = new URLSearchParams(window.location.search);
  const uiParam = query.get('ui');
  const staged = STAGES.includes(uiParam) ? uiParam : null;
  const holdStage = query.get('hold') === '1'; // ui=hud&hold=1: the use button as a search hold, ring part full
  const hideAll = !!G.params.shot && !uiParam;
  const S = staged ? STAGE_SAMPLE : null;

  loadFonts();
  const settings = createSettings(G);
  settings.applyAll();

  // ---------------------------------------------------------------- DOM
  const root = h('div');
  root.id = 'gs-ui';
  root.dataset.stage = staged || '';
  const hud = h('div', 'gs-hud');
  root.appendChild(hud);

  const live = h('div', 'gs-sr');
  live.setAttribute('aria-live', 'polite');

  // damage direction arc (SVG, 200-unit box, arc centred at the top, rotated by the hit angle)
  const NS = 'http://www.w3.org/2000/svg';
  const dmg = document.createElementNS(NS, 'svg');
  dmg.setAttribute('class', 'gs-dmg'); dmg.setAttribute('viewBox', '-100 -100 200 200');
  const arc = document.createElementNS(NS, 'path');
  const R = 92; const half = (28 * Math.PI) / 180;
  arc.setAttribute('d', `M ${-R * Math.sin(half)} ${-R * Math.cos(half)} A ${R} ${R} 0 0 1 ${R * Math.sin(half)} ${-R * Math.cos(half)}`);
  arc.setAttribute('class', 'arc');
  dmg.appendChild(arc);

  const cross = h('div', 'gs-cross');
  for (const d of ['t', 'r', 'b', 'l']) cross.appendChild(h('i', d));
  const hit = h('div', 'gs-hit');
  for (const d of ['a', 'b', 'c', 'd']) hit.appendChild(h('i', d));

  const prompt = h('div', 'gs-prompt');
  const pPre = h('span', 'pre', 'Press ');
  const pKey = h('kbd', 'key', 'F');
  const pLabel = h('span', 'lab');
  const pCost = h('span', 'cost');
  kids(prompt, pPre, pKey, pLabel, pCost);

  // round (hero, bottom-left)
  const round = h('div', 'gs-round');
  const rLabel = h('p', 'lbl', 'Round');
  const rNum = h('div', 'num');
  const rOld = h('span', 'old'); const rCur = h('span', 'cur', '1');
  kids(rNum, rOld, rCur);
  const rSub = h('p', 'sub');
  kids(round, rLabel, rNum, rSub);

  // points + ammo (bottom-right)
  const stats = h('div', 'gs-stats');
  const pts = h('div', 'gs-pts');
  const pops = h('div', 'pops');
  const ptsNum = h('b', null, '0');
  kids(pts, pops, ptsNum, h('small', null, 'PTS'));
  const ammo = h('div', 'gs-ammo');
  const aName = h('p', 'wname', 'Pistol');
  const aMag = h('div', 'mag');
  const mag = h('b', null, '—'); const reserve = h('em', null, '—');
  kids(aMag, mag, h('i', null, '/'), reserve);
  const pips = h('div', 'pips');
  const magSize = tuning.pistol.mag;
  for (let i = 0; i < magSize; i++) pips.appendChild(h('span'));
  const aHint = h('p', 'hint');
  kids(ammo, aName, aMag, pips, aHint);
  kids(stats, pts, ammo);

  const health = h('div', 'gs-health');
  const healthFill = h('i');
  health.appendChild(healthFill);

  // Panels other modules add (weapon slots, plates, objective ...). On touch the bottom corners fold up.
  const corners = {};
  for (const c of CORNERS) { corners[c] = h('div', `gs-corner c-${c}`); hud.appendChild(corners[c]); }
  const panels = [];
  const cornerFor = (c) => (ui.touch && TOUCH_CORNER[c]) || c;
  kids(hud, dmg, cross, hit, prompt, round, stats, health, live);

  const menusHost = h('div', 'gs-menus');
  root.appendChild(menusHost);
  document.body.appendChild(root);

  // ---------------------------------------------------------------- menus
  const actions = {
    play() { G.game?.start?.(); G.input?.requestLock?.(); G.audio?.unlock?.(); },
    resume() { G.game?.resume?.(); G.input?.requestLock?.(); },
    retry() { G.game?.restart?.(); G.input?.requestLock?.(); },
  };
  const menus = createMenus(G, menusHost, { settings, actions, sample: S });
  const touchHud = createTouchHud(G, root);
  const orient = createOrient(G, root, { enabled: !hideAll });

  // ---------------------------------------------------------------- state
  const st = {
    visible: true, state: staged ? { title: 'title', hud: 'playing', paused: 'paused', dead: 'dead', settings: 'paused', controls: 'paused' }[staged] : (G.game?.state || 'title'),
    forced: null, // show() override
    promptOverride: null, denied: null, deniedT: 0,
    round: null, shownPts: S ? S.points : 0, targetPts: S ? S.points : 0,
    pops: [], hitT: 0, hitKill: false, hitHead: false, dmgT: 0, dmgAngle: 0, damage: 0,
    deadDelay: 0, hudOn: true, titleCam: null, lastRemaining: undefined, buyT: 0,
    touchOn: false, tf: { on: false, id: null, label: null, cost: null, hold: null },
  };
  const titleCam = createTitleCam(G);
  const cache = {};
  const setStyle = (key, el, prop, v) => { const k = `${key}:${prop}`; if (cache[k] !== v) { cache[k] = v; el.style[prop] = v; } };
  let uiScale = Math.min(window.innerHeight / 1080, window.innerWidth / 1920);
  window.addEventListener('resize', () => { uiScale = Math.min(window.innerHeight / 1080, window.innerWidth / 1920); });
  const setText = (key, el, v) => { if (cache[key] !== v) { cache[key] = v; el.textContent = v; } };
  const setClass = (key, el, cls, on) => { const k = `${key}:${cls}`; if (cache[k] !== on) { cache[k] = on; el.classList.toggle(cls, on); } };

  function screenFor(state) {
    return { title: 'title', paused: 'paused', dead: 'dead' }[state] || null;
  }

  function applyState(state) {
    st.state = state;
    if (state === 'dead') { st.deadDelay = staged ? 0 : 0.9; }
    titleCam.sync(state); // title shot behind the title menu; released on any other state
    if (state !== 'dead' || st.deadDelay <= 0) menus.show(st.forced !== null ? st.forced : screenFor(state));
    if (state === 'playing') { st.denied = null; }
  }

  // ---------------------------------------------------------------- events
  const on = (name, fn) => G.events.on(name, fn);
  on('game:state', ({ state }) => { settings.onState(); if (!staged) { st.forced = null; applyState(state); } relayout(); });
  on('input:mode', () => relayout());
  on('points:add', ({ amount }) => {
    if (staged || !amount) return;
    st.targetPts = G.game ? G.game.points : st.targetPts + amount;
    spawnPop(`+${formatPoints(amount)}`, false);
  });
  on('buy', ({ cost }) => {
    if (staged) return;
    st.targetPts = G.game ? G.game.points : st.targetPts - cost;
    if (cost) spawnPop(`−${formatPoints(cost)}`, true);
  });
  on('buy:denied', ({ reason }) => { st.denied = denyText(reason); st.deniedT = 1.3; replay(prompt, 'nudge'); });
  on('hit:zombie', (e) => {
    if (!e) return;
    st.hitKill = !!e.killed; st.hitHead = e.part === 'head';
    st.hitT = e.killed ? 0.32 : 0.14;
  });
  on('player:damage', () => {
    const d = G.player && G.player.lastDamage;
    st.dmgT = 1;
    st.dmgAngle = d && Number.isFinite(d.angle) && d.dir ? d.angle : null;
  });
  on('round:start', ({ n }) => { live.textContent = `Round ${n}`; });

  function replay(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

  function spawnPop(text, spend, frozenAge) {
    const el = h('span', `pop${spend ? ' spend' : ''}`, text);
    pops.appendChild(el);
    const pop = { el, age: frozenAge ?? 0, frozen: frozenAge !== undefined, lane: st.popLane = ((st.popLane || 0) + 1) % 3 };
    st.pops.push(pop);
    while (st.pops.length > MAX_POPS) st.pops.shift().el.remove();
  }

  // ---------------------------------------------------------------- per-frame
  function setRound(n) {
    if (st.round === n) return;
    const first = st.round === null;
    rOld.textContent = st.round === null ? '' : String(st.round);
    rCur.textContent = String(n);
    st.round = n;
    if (!first && !reduced()) replay(rNum, 'roll');
  }

  function update(dt) {
    const game = G.game || {};
    const playing = st.state === 'playing';
    menus.update(dt);

    // delayed death screen
    if (st.state === 'dead' && st.deadDelay > 0) {
      st.deadDelay -= dt;
      if (st.deadDelay <= 0) menus.show(st.forced !== null ? st.forced : 'dead');
    }

    const hudOn = st.visible && !hideAll && !G.params.nohud && (staged ? staged === 'hud' : st.state === 'playing');
    if (hudOn !== st.hudOn || cache.init === undefined) { st.hudOn = hudOn; cache.init = 1; hud.classList.toggle('off', !hudOn); }

    // ---- round
    const rn = S ? S.round : Math.max(1, game.round || 1);
    setRound(rn);
    const rem = S ? S.remaining : remaining(game.director);
    const phase = game.director && game.director.phase;
    if (!S && phase === 'lull') setText('sub', rSub, `Clear · next in ${Math.max(0, Math.ceil(game.director.timer))}`);
    else setText('sub', rSub, rem === null ? '' : `${rem} remaining`);

    // ---- points (count toward the true value)
    if (!S) st.targetPts = Number.isFinite(game.points) ? game.points : st.targetPts;
    if (reduced() || Math.abs(st.targetPts - st.shownPts) < 1) st.shownPts = st.targetPts;
    else st.shownPts += (st.targetPts - st.shownPts) * Math.min(1, dt * 11);
    setText('pts', ptsNum, formatPoints(st.shownPts));

    // ---- ammo
    const av = S ? { mag: S.mag, reserve: S.reserve, name: 'Pistol' } : ammoView(G.weapon);
    setText('wname', aName, narrowScreen(ui.touch) ? shortWeaponName(av.name) : av.name);
    setText('mag', mag, av.mag === null ? '—' : String(av.mag));
    setText('res', reserve, av.reserve === null ? '—' : String(av.reserve));
    const lowMag = av.mag !== null && av.mag <= Math.ceil(magSize * 0.25);
    setClass('mag', aMag, 'low', lowMag);
    setText('ahint', aHint, !S && G.weapon && G.weapon.reloading ? 'Reloading' : av.mag === 0 ? (ui.touch ? 'Tap RELOAD' : 'Press R to reload') : av.mag !== null && lowMag && av.reserve ? 'Low' : '');
    for (let i = 0; i < pips.children.length; i++) {
      const k = `pip${i}`; const onNow = av.mag !== null && i < av.mag;
      if (cache[k] !== onNow) { cache[k] = onNow; pips.children[i].classList.toggle('on', onNow); }
    }

    // ---- health hairline + post damage
    const p = G.player || {};
    const max = p.maxHealth || tuning.player.health;
    const frac = S ? S.health : clamp((Number.isFinite(p.health) ? p.health : max) / max, 0, 1);
    setStyle('hf', healthFill, 'transform', `scaleX(${frac.toFixed(2)})`);
    setClass('hlow', health, 'low', frac < 0.35);
    setClass('hshow', health, 'show', frac < 0.999);
    st.dmgT = Math.max(0, st.dmgT - dt / 1.0);
    const lowAmt = frac < 0.5 && st.state !== 'title' ? (1 - frac / 0.5) * 0.7 * (0.88 + 0.12 * Math.sin(G.time.t * 4.2)) : 0;
    const pulse = st.dmgT * st.dmgT * 0.5;
    const dTarget = staged ? 0 : Math.max(lowAmt, pulse);
    st.damage += (dTarget - st.damage) * Math.min(1, dt * 14);
    if (!staged && G.post && G.post.uniforms && (st.damage > 0.002 || cache.dwrote)) {
      G.post.uniforms.damage = st.damage < 0.002 ? 0 : st.damage;
      cache.dwrote = st.damage >= 0.002;
    }
    // damage direction arc
    if (S) { setStyle('da', dmg, 'opacity', '0.4'); setStyle('dr', dmg, 'transform', 'rotate(0.9rad)'); }
    else if (st.dmgAngle !== null && st.dmgT > 0) { setStyle('da', dmg, 'opacity', (Math.min(1, st.dmgT * 1.3) * 0.55).toFixed(2)); setStyle('dr', dmg, 'transform', `rotate(${st.dmgAngle}rad)`); }
    else setStyle('da', dmg, 'opacity', '0');

    // ---- hit marker
    st.hitT = Math.max(0, st.hitT - dt);
    const hv = st.hitT / (st.hitKill ? 0.32 : 0.14);
    setStyle('ho', hit, 'opacity', hv > 0 ? Math.min(1, hv * 1.6).toFixed(2) : '0');
    setStyle('ht', hit, 'transform', hv > 0 ? `translate(-50%,-50%) scale(${(1 + (1 - hv) * (st.hitKill ? 0.5 : 0.25)).toFixed(2)})` : 'translate(-50%,-50%)');
    setClass('hk', hit, 'kill', st.hitKill);
    setClass('hh', hit, 'head', st.hitHead && st.hitKill);

    // ---- prompt (touch: names the button; top-centre on a phone)
    st.deniedT = Math.max(0, st.deniedT - dt);
    const touch = ui.touch;
    const focus = S ? (holdStage ? STAGE_HOLD : STAGE_BUY) : playing ? game.focus : null;
    // pmode: 0 none, 1 override text, 2 refusal flash, 3 the focus. Fields are compared, not strings built, each frame.
    const pmode = st.promptOverride ? 1 : st.deniedT > 0 && playing ? 2 : focus ? 3 : 0;
    const flash = pmode === 2;
    const showPrompt = pmode !== 0 && (staged ? true : st.state === 'playing');
    setClass('prompt', prompt, 'on', showPrompt);
    setClass('promptf', prompt, 'flash', flash);
    const pc = cache.pc || (cache.pc = {});
    if (showPrompt && (pc.mode !== pmode || pc.touch !== touch || pc.over !== st.promptOverride || pc.den !== st.denied
      || pc.id !== (focus && focus.id) || pc.label !== (focus && focus.label) || pc.cost !== (focus && focus.cost) || pc.hold !== (focus && focus.hold) || pc.kind !== (focus && focus.kind))) {
      pc.mode = pmode; pc.touch = touch; pc.over = st.promptOverride; pc.den = st.denied;
      pc.id = focus && focus.id; pc.label = focus && focus.label; pc.cost = focus && focus.cost; pc.hold = focus && focus.hold; pc.kind = focus && focus.kind;
      if (pmode === 1 || pmode === 2) { pPre.textContent = ''; pKey.hidden = true; pLabel.textContent = pmode === 1 ? st.promptOverride : st.denied; pCost.textContent = ''; }
      else {
        const pp = promptParts(focus, touch ? 'touch' : 'keyboard');
        if (!pp.key) { pPre.textContent = ''; pKey.hidden = true; pLabel.textContent = `${pp.label} — ${pp.note}`; pCost.textContent = ''; }
        else { pPre.textContent = pp.pre; pKey.hidden = false; pKey.textContent = pp.key; pLabel.textContent = `${pp.sep}${pp.label}`; pCost.textContent = pp.cost ? `${pp.costSep}${pp.cost}` : ''; }
      }
    }
    // ---- touch controls: the use button follows the focus; the layer shows only while playing
    const wantTouch = touch && !hideAll && (staged ? staged === 'hud' : st.state === 'playing');
    const useOn = wantTouch && !!focus && focus.kind !== 'lockedDoor';
    const tf = st.tf;
    if (wantTouch !== st.touchOn || useOn !== tf.on || (useOn && (tf.id !== focus.id || tf.label !== focus.label || tf.cost !== focus.cost || tf.hold !== focus.hold))) {
      // leaving the controls (pause, death): no ADS toggle or finger carries over
      if (st.touchOn && !wantTouch && G.input && G.input.touch) clearToggles(G.input.touch);
      st.touchOn = wantTouch; tf.on = useOn;
      tf.id = useOn ? focus.id : null; tf.label = useOn ? focus.label : null; tf.cost = useOn ? focus.cost : null; tf.hold = useOn ? focus.hold : null;
      if (useOn) touchHud.setFocus(interactVerb(focus), Number(focus.cost) > 0 ? formatPoints(focus.cost) : '', Number(focus.hold) > 0);
      relayout();
    }
    if (S && holdStage) touchHud.setProgress(0.6);
    touchHud.update();
    setClass('crossoff', cross, 'off', st.state !== 'playing' && !staged);

    // ---- pop-ups
    const still = reduced();
    const scale = uiScale;
    for (let i = st.pops.length - 1; i >= 0; i--) {
      const pop = st.pops[i];
      if (!pop.frozen) pop.age += dt;
      const t = pop.age / POP_LIFE;
      if (t >= 1) { pop.el.remove(); st.pops.splice(i, 1); continue; }
      const rise = still ? 0 : (1 - (1 - t) * (1 - t)) * 64 * scale;
      const op = t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45;
      pop.el.style.transform = `translate(${-pop.lane * 6 * scale}px, ${-(rise + 10 * scale)}px)`;
      pop.el.style.opacity = op.toFixed(3);
    }
  }

  // Staged sample content: a frozen +100 pop-up.
  if (S) { spawnPop('+100', false, 0.32); }

  // ---------------------------------------------------------------- touch layout
  // Computed on a resize, a handedness change, a mode change or a use-button change. Never per frame.
  let vw = window.innerWidth, vh = window.innerHeight;
  function relayout() {
    const touch = ui.touch;
    root.classList.toggle('gs-touch', touch);
    root.classList.toggle('gs-lefty', touch && settings.lefty);
    if (!touch) { touchHud.setShown(false); return; }
    const L = layoutTouch({ w: vw, h: vh, safe: G.device ? G.device.safe : undefined, lefty: settings.lefty, interact: st.tf.on });
    touchHud.paint(L);
    touchHud.setShown(st.touchOn);
    root.style.setProperty('--s', String(L.scale));
    const tl = G.input && G.input.touch;
    // The machine takes the layout only while the controls are up (a paused or title screen has no thumbs to track).
    if (tl && tl.setLayout && !staged) tl.setLayout(st.touchOn ? L : null);
    reparent();
  }
  function reparent() { for (const p of panels) { const c = corners[cornerFor(p.corner)]; if (p.el.parentNode !== c) c.appendChild(p.el); } }
  window.addEventListener('resize', () => { vw = window.innerWidth; vh = window.innerHeight; relayout(); });
  if (G.device && G.device.onChange) G.device.onChange(() => relayout());
  settings.onChange((k) => { if (k === 'lefty') relayout(); });
  // A 180 degree turn changes the insets without a resize: re-read them a frame later and relay out.
  if (G.device && G.device.safe) {
    watchInsets({
      win: window, screen: window.screen, device: G.device,
      raf: (f) => requestAnimationFrame(f),
      refresh: () => window.dispatchEvent(new Event('resize')), // the device module re-reads env() on resize
      relayout,
    });
  }

  // ---------------------------------------------------------------- API
  const ui = {
    update,
    root,
    // True while the on-screen controls are the input (a phone, or a touch laptop in touch mode).
    get touch() { return G.input && G.input.mode ? G.input.mode === 'touch' : !!(G.device && G.device.touch); },
    // addPanel('plates', el, {corner:'tl'|'tr'|'bl'|'br'|'tc'|'bc', order}) -> remove(). Panels live inside the HUD
    // (hidden with it) and stack by `order` (lower first). On touch the bottom corners fold up to the top ones.
    addPanel(name, el, { corner = 'tl', order = 0 } = {}) {
      const p = { name, el, corner: CORNERS.includes(corner) ? corner : 'tl' };
      el.dataset.panel = name; el.style.order = String(order);
      panels.push(p);
      corners[cornerFor(p.corner)].appendChild(el);
      return () => { const i = panels.indexOf(p); if (i >= 0) panels.splice(i, 1); el.remove(); };
    },
    // The key on a keyboard, the button's name on touch: keyLabel('reload') -> 'R' or 'RELOAD'.
    keyLabel(action) { return keyLabel(action, ui.touch, G.game && G.game.focus); },
    // show('title'|'paused'|'dead') or null to hide every menu. The next game:state event wins again.
    show(name) { st.deadDelay = 0; menus.show(name || null); },
    prompt(text) { st.promptOverride = text || null; },
    setVisible(b) { st.visible = !!b; root.classList.toggle('hidden', !b); },
    // The hold ring on the use button: 0..1, or null to follow G.game.loot.progress again.
    holdProgress(p) { touchHud.setProgress(p === null || p === undefined ? null : clamp(Number(p) || 0, 0, 1)); },
    menus,
    settings,
    touchHud,
    orient,
  };

  if (hideAll) root.classList.add('hidden');
  if (G.params.nohud) hud.classList.add('off');
  // initial screen
  if (staged) { st.forced = staged === 'settings' || staged === 'controls' ? staged : screenFor(st.state); applyState(st.state); }
  else applyState(st.state);
  relayout();
  return ui;
}
