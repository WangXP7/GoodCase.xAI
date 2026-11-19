import { NYC_LANDMARKS, TELEPORT_LOCATIONS, CITY } from './city-config.js';

// js/navigation-ui.js
// The HUD for js/navigation.js: the ways strip above the travel modes (how to go: drive yourself, self-driving, Crazy
// Taxi or teleport; swiped, scrolled, stepped with [ and ], the one in the middle tapped for where to), the Navigate
// menu (where to), the menu a tap on the full map opens (go there each of those ways), the turn-by-turn card, the Crazy
// Taxi meter and its call-outs, and the route on the radar and the full map. All DOM text through textContent.

// The ways to go: three drivers (navigation.js DRIVERS), teleporting, and the MRT (js/mrt-system.js), where the city
// has one
const HOW = ['you', 'self', 'crazy', 'teleport', 'mrt'];
// (the ways that drive no car: none of the navigator's drivers)
const NOT_DRIVING = new Set(['teleport', 'mrt']);

const ARROWS = { left: 'i-turn-left', right: 'i-turn-right', keepleft: 'i-keep-left', keepright: 'i-keep-right', uturn: 'i-uturn', arrive: 'i-arrive' };
const WORDS = { left: 'Turn left', right: 'Turn right', keepleft: 'Keep left', keepright: 'Keep right', uturn: 'Make a U-turn', arrive: 'Arrive' };

function setupNavigationUI({ navigator, mapSystem, controllerManager, selectMode, closePopovers, teleport = null, mrt = null }) {
  // (no MRT here: no MRT way on the strip or the map's menu)
  const WAYS = mrt ? HOW : HOW.filter((w) => w !== 'mrt');
  if (!mrt && typeof document !== 'undefined') document.querySelectorAll?.('[data-driver="mrt"], [data-go="mrt"]').forEach((b) => b.remove());
  const $ = (id) => document.getElementById(id);
  const panel = $('nav-panel');
  const popover = $('navigate-popover');
  if (!panel || !popover) return { update() {}, toggleMenu() {}, step() {} };
  // the ways to go: the strip at the bottom (or, without one, the menu)
  const ways = $('nav-ways');
  const track = $('nav-ways-track');
  const waysSub = $('nav-ways-sub');
  const whereTitle = $('nav-where-title');
  const wayButtons = () => (track || ways || popover).querySelectorAll('[data-driver]');
  const metric = CITY.units === 'metric';
  const el = {
    arrow: $('nav-arrow')?.querySelector('use'), distance: $('nav-distance'), instruction: $('nav-instruction'),
    driver: $('nav-driver'), eta: $('nav-eta'), status: $('nav-status'), fare: $('nav-fare'), fareTime: $('fare-time'),
    fareTotal: $('fare-total'), fareMisses: $('fare-misses'), fareEarned: $('fare-earned'), toast: $('nav-toast'),
    stop: $('nav-stop')
  };
  let earned = 0; // Crazy Taxi: the shift's takings
  let how = navigator.driver.id; // the way the menu goes: a driver, or 'teleport'
  let toastTimer = 0;

  const formatDistance = (m) => {
    if (metric) return m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${Math.max(0, Math.round(m / 10) * 10)} m`;
    const ft = m * 3.281;
    return ft >= 1000 ? `${(m / 1609).toFixed(1)} mi` : `${Math.round(ft / 50) * 50} ft`;
  };
  const formatTime = (s) => {
    const t = Math.max(0, Math.round(s));
    return t >= 60 ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` : `${t}s`;
  };
  const money = (v) => `$${v.toFixed(2)}`;

  function toast(text, ms = 1400) {
    if (!el.toast) return;
    el.toast.textContent = text;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), ms);
  }

  // Places: the city's destinations, each with its arrival on the street (city-config.js TELEPORT_LOCATIONS)
  const places = $('nav-places');
  for (const loc of Object.values(TELEPORT_LOCATIONS)) {
    const btn = document.createElement('button');
    btn.className = 'pop-item';
    btn.type = 'button';
    const name = document.createElement('span');
    name.className = 'pop-name';
    name.textContent = loc.name;
    const sub = document.createElement('span');
    sub.className = 'pop-sub';
    sub.textContent = loc.sub || '';
    btn.append(name, sub);
    btn.addEventListener('click', () => go(how, loc.x, loc.z, loc.name, loc.heading));
    places?.appendChild(btn);
  }

  /** Go to (x, z) `way`: driving there (yourself, self-driving or Crazy Taxi), or teleporting there */
  function go(way, x, z, name, heading) {
    closePopovers();
    if (way === 'mrt') {
      // by train: from the station nearest you to the one nearest there (the MRT takes it from here)
      if (!mrt) return;
      const p = controllerManager.getActiveEntity().position;
      if (mrt(p.x, p.z, x, z, name) && navigator.active) stop();
      return;
    }
    if (way === 'teleport') {
      if (!teleport) return;
      // (a trip on the go carries on from the new spot)
      teleport(x, z, heading);
      if (navigator.active) navigator.reroute(true);
      toast(name ? `Teleported to ${name}` : 'Teleported', 1400);
      return;
    }
    if (way !== navigator.driver.id) {
      // the autopilots drive the car: hop in
      if (way !== 'you' && controllerManager.activeMode !== 'car') selectMode('car');
      navigator.setDriver(way);
    }
    if (navigator.driver.auto && controllerManager.activeMode !== 'car') selectMode('car');
    if (!navigator.setDestination(x, z, name)) return;
    mapSystem.waypoint = { x, z, name };
    if (navigator.driver.id === 'crazy') toast(`Take me to ${name}!`, 1800);
  }

  // A fare across town: a landmark 400 m - 2.5 km away (or any, if none is)
  function randomTrip() {
    const p = controllerManager.getActiveEntity().position;
    const far = NYC_LANDMARKS.filter((l) => { const d = Math.hypot(l.x - p.x, l.z - p.z); return d > 400 && d < 2500; });
    const list = far.length ? far : NYC_LANDMARKS;
    const lm = list[Math.floor(Math.random() * list.length)];
    if (lm) go(how === 'teleport' ? navigator.driver.id : how, lm.x, lm.z, lm.name);
  }

  /** Go the way `id` from now on: the autopilots take the car; a Crazy Taxi with nowhere to go yet picks up a fare */
  function choose(id) {
    if (!WAYS.includes(id) || id === how) return;
    how = id;
    if (!NOT_DRIVING.has(id)) {
      if (id !== 'you' && controllerManager.activeMode !== 'car') selectMode('car');
      navigator.setDriver(id);
    }
    syncDrivers();
    if (id === 'crazy' && !navigator.active) randomTrip();
  }
  // Moving along the strip only shows a way (`shown`); it is taken once the strip comes to rest, so a swipe or a quick
  // ]] past Crazy Taxi or Self-driving to Teleport neither picks up a fare nor puts you in the car on the way
  let shown = null;
  let settleTimer = 0;
  function settle() {
    clearTimeout(settleTimer);
    const id = shown;
    shown = null;
    if (id && id !== how) choose(id);
    else syncDrivers();
  }
  /** Show the way `n` along from the one shown (stopping at the ends); taken after `ms` of rest (or by settle()) */
  function move(n, ms = 450) {
    const i = Math.max(0, Math.min(WAYS.length - 1, WAYS.indexOf(shown || how) + n));
    shown = WAYS[i];
    syncDrivers();
    clearTimeout(settleTimer);
    if (ms !== null) settleTimer = setTimeout(settle, ms);
  }
  /** The next (+1) or previous (-1) way along the strip */
  const step = (dir) => move(Math.sign(dir));
  // opened from the strip, the menu stands over it (and goes back under the toolbar once closed)
  const menuHome = { anchor: popover.dataset.anchor, side: popover.dataset.side, align: popover.dataset.align };
  popover.addEventListener('toggle', (e) => {
    if (e.newState !== 'closed') return;
    for (const [k, v] of Object.entries(menuHome)) {
      if (v === undefined) delete popover.dataset[k];
      else popover.dataset[k] = v;
    }
  });
  const openMenu = () => {
    if (typeof popover.showPopover !== 'function' || popover.matches?.(':popover-open')) return;
    if (ways) Object.assign(popover.dataset, { anchor: 'nav-ways', side: 'above', align: 'nav-ways' });
    popover.showPopover();
  };

  for (const btn of wayButtons()) {
    // a tap on another way picks it; on the one already chosen, asks where to
    btn.addEventListener('click', () => {
      if (swiped) return;
      clearTimeout(settleTimer);
      shown = null;
      if (btn.dataset.driver === how) openMenu();
      else choose(btn.dataset.driver);
    });
  }
  // the strip: its arrows, a swipe or drag across it, a scroll over it, and the arrow keys while it has focus
  let swiped = false;
  if (ways) {
    for (const b of ways.querySelectorAll('[data-step]')) b.addEventListener('click', () => step(Number(b.dataset.step)));
    let drag = null;
    ways.addEventListener('pointerdown', (e) => {
      if (e.button > 0 || e.target?.closest?.('[data-step]')) return;
      drag = { x: e.clientX, id: e.pointerId, moved: 0 };
      swiped = false;
    });
    ways.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      // a way per 56 px dragged; dragging left brings the next one in
      const n = Math.trunc((drag.x - e.clientX) / 56);
      if (n !== drag.moved) {
        move(n - drag.moved, null);
        drag.moved = n;
        swiped = true;
        if (!ways.hasPointerCapture?.(e.pointerId)) ways.setPointerCapture?.(e.pointerId);
      }
    });
    const end = () => {
      if (!drag) return;
      drag = null;
      if (swiped) settle();
      // (the click after a swipe is not a tap)
      setTimeout(() => { swiped = false; }, 0);
    };
    ways.addEventListener('pointerup', end);
    ways.addEventListener('pointercancel', end);
    let wheelAt = 0;
    let wheelSum = 0;
    ways.addEventListener('wheel', (e) => {
      e.preventDefault?.();
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const now = e.timeStamp || 0;
      if (now - wheelAt > 250) wheelSum = 0;
      wheelAt = now;
      wheelSum += d;
      // one way per notch (or per 60 px of trackpad), not a whole fling
      if (Math.abs(wheelSum) >= 40) {
        step(wheelSum);
        wheelSum = 0;
        wheelAt = now + 200;
      }
    }, { passive: false });
    ways.addEventListener('keydown', (e) => {
      if (e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return;
      e.preventDefault?.();
      e.stopPropagation?.();
      step(e.code === 'ArrowLeft' ? -1 : 1);
      track?.querySelector(`[data-driver="${shown || how}"]`)?.focus?.();
    });
  }
  $('nav-random')?.addEventListener('click', randomTrip);
  $('nav-pick')?.addEventListener('click', () => {
    closePopovers();
    document.body.classList.add('nav-picking');
    mapSystem.pickHandler = (x, z, name) => {
      document.body.classList.remove('nav-picking');
      mapSystem.toggleFullMap(false);
      go(how, x, z, name);
    };
    mapSystem.toggleFullMap(true);
    const hint = $('fullmap-hover-info');
    if (hint) hint.textContent = 'Click where you want to go';
  });
  const stop = () => {
    navigator.clear();
    mapSystem.routeLine = null;
    sync(navigator.state());
  };
  el.stop?.addEventListener('click', () => { stop(); closePopovers(); });
  $('nav-close')?.addEventListener('click', stop);

  // A tap on the full map: a menu at the spot to go there any of the ways
  const pickMenu = $('map-pick-menu');
  const pickTitle = $('map-pick-title');
  let picked = null;
  function closePick() {
    picked = null;
    if (pickMenu) pickMenu.hidden = true;
  }
  if (pickMenu) {
    mapSystem.onPick = (x, z, name, clientX, clientY) => {
      picked = { x, z, name };
      if (pickTitle) pickTitle.textContent = name || 'Here';
      for (const b of pickMenu.querySelectorAll('[data-go]')) b.hidden = (b.dataset.go === 'teleport' && !teleport) || (b.dataset.go === 'mrt' && !mrt);
      pickMenu.hidden = false;
      // beside the tap, kept on screen
      const w = pickMenu.offsetWidth || 220;
      const h = pickMenu.offsetHeight || 200;
      const vw = window.innerWidth || 1024;
      const vh = window.innerHeight || 768;
      const left = Math.max(8, Math.min(vw - w - 8, clientX + 12));
      const top = Math.max(8, Math.min(vh - h - 8, clientY - h * 0.5));
      pickMenu.style.left = `${left}px`;
      pickMenu.style.top = `${top}px`;
      pickMenu.querySelector('[data-go]')?.focus?.();
    };
    for (const b of pickMenu.querySelectorAll('[data-go]')) {
      b.addEventListener('click', () => {
        if (!picked) return;
        const { x, z, name } = picked;
        const way = b.dataset.go;
        closePick();
        // whichever way, the map steps aside to show you going (or arriving)
        mapSystem.toggleFullMap(false);
        go(way, x, z, name);
      });
    }
    $('map-pick-cancel')?.addEventListener('click', closePick);
    // a drag, a zoom, Esc or closing the map puts it away
    mapSystem.fullCanvas?.addEventListener('pointerdown', closePick);
    mapSystem.fullCanvas?.addEventListener('wheel', closePick, { passive: true });
    window.addEventListener('keydown', (e) => { if (e.code === 'Escape') closePick(); });
    const toggle = mapSystem.toggleFullMap.bind(mapSystem);
    mapSystem.toggleFullMap = (open) => {
      if (!open) closePick();
      toggle(open);
    };
  }

  function syncDrivers() {
    let active = null;
    const at = shown || how;
    for (const btn of wayButtons()) {
      const on = btn.dataset.driver === at;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-checked', String(on));
      btn.setAttribute('tabindex', on ? '0' : '-1');
      if (on) active = btn;
    }
    document.body.dataset.driver = navigator.driver.id;
    if (ways) ways.dataset.how = at;
    if (waysSub && active) waysSub.textContent = active.dataset.sub || '';
    if (whereTitle) whereTitle.textContent = active ? `Where to · ${active.textContent}` : 'Where to';
    if (ways) {
      for (const b of ways.querySelectorAll('[data-step]')) {
        const i = WAYS.indexOf(at) + Number(b.dataset.step);
        b.disabled = i < 0 || i >= WAYS.length;
      }
    }
    centreWay(active);
  }
  // the chosen way slides to the middle of the strip
  function centreWay(btn) {
    if (!track || !btn || !btn.offsetWidth) return;
    const view = track.parentElement?.clientWidth || 0;
    if (!view) return;
    const x = view / 2 - (btn.offsetLeft + btn.offsetWidth / 2);
    track.style.transform = `translateX(${Math.round(x)}px)`;
  }

  // The card, the meter and the maps, from navigator.state()
  function sync(st) {
    panel.hidden = !st.active;
    if (el.stop) el.stop.hidden = !st.active;
    mapSystem.routeLine = st.active && !st.arrived ? st.route : null;
    syncDrivers();
    if (!st.active) return;
    const next = st.arrived ? { kind: 'arrive', distance: 0, name: st.destination?.name } : st.next || { kind: 'arrive', distance: st.remaining, name: '' };
    el.arrow?.setAttribute('href', `#${ARROWS[next.kind] || 'i-arrive'}`);
    if (el.distance) el.distance.textContent = st.arrived ? '' : formatDistance(next.distance);
    if (el.instruction) {
      el.instruction.textContent = st.arrived
        ? `Arrived · ${st.destination?.name || ''}`
        : next.kind === 'arrive' ? `${st.destination?.name || 'Destination'}` : `${WORDS[next.kind]}${next.name ? ` onto ${next.name}` : ''}`;
    }
    if (el.driver) el.driver.textContent = st.driverLabel;
    if (el.eta) el.eta.textContent = st.arrived ? '' : `${formatDistance(st.remaining)} · ${formatTime(st.eta)}`;
    if (el.status) el.status.textContent = st.driver !== 'you' && !st.carMode ? 'Switch to the car' : st.status || '';
    const fare = st.fare;
    if (el.fare) el.fare.hidden = !fare;
    if (fare) {
      el.fareTime.textContent = formatTime(fare.timeLeft);
      el.fare.classList.toggle('is-late', fare.timeLeft < 10);
      el.fareTotal.textContent = money(fare.total);
      el.fareMisses.textContent = String(fare.nearMisses);
      el.fareEarned.textContent = money(earned);
    }
  }

  navigator.onChange = (st) => {
    // (a driver change made elsewhere, the controls taken over: the menu follows, unless it is set to teleport)
    if (!NOT_DRIVING.has(how)) how = navigator.driver.id;
    sync(st);
  };
  navigator.onEvent = (kind, d) => {
    if (kind === 'arrived') {
      if (d.fare) {
        earned += d.fare.total;
        toast(d.fare.tip > 0 ? `Drop-off! ${money(d.fare.total)} (tip ${money(d.fare.tip)})` : `Drop-off! ${money(d.fare.total)}`, 2600);
      } else {
        toast(`You have arrived`, 2000);
      }
    } else if (kind === 'nearmiss') toast(d.combo > 1 ? `Near miss x${d.combo}! +${money(d.award)}` : `Near miss! +${money(d.award)}`, 900);
    else if (kind === 'crash') toast('Ouch!', 700);
    else if (kind === 'reroute') toast('Rerouting…', 900);
    else if (kind === 'takeover') toast('You have the wheel', 1200);
    else if (kind === 'noroute') toast('No road goes there', 1500);
    else if (kind === 'nextfare') randomTrip();
  };
  syncDrivers();

  let acc = 0;
  return {
    toast,
    // the card's numbers 5 times a second
    update(dt) {
      acc += dt;
      if (acc < 0.2 || !navigator.active) return;
      acc = 0;
      sync(navigator.state());
    },
    toggleMenu() {
      if (typeof popover.togglePopover === 'function') popover.togglePopover();
    },
    // [ and ]: along the ways strip
    step,
    // the strip re-centres after a resize or once its font has loaded
    layout() { centreWay(track?.querySelector(`[data-driver="${shown || how}"]`)); },
    go,
    get how() { return how; }
  };
}

export { setupNavigationUI };
