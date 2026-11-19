(function tinyworldDriverOnboarding() {
  const TOUR_KEY = 'tinyworld:onboarding:driver.v1';
  const TOUR_QUERY_KEYS = ['tour', 'onboarding', 'guide'];

  function queryValue() {
    try {
      const params = new URLSearchParams(window.location.search);
      for (const key of TOUR_QUERY_KEYS) {
        if (params.has(key)) return params.get(key) || '1';
      }
    } catch (_) {}
    return '';
  }

  function localDone() {
    try { return localStorage.getItem(TOUR_KEY) === 'done'; }
    catch (_) { return false; }
  }

  function markDone() {
    try { localStorage.setItem(TOUR_KEY, 'done'); } catch (_) {}
  }

  function resetDone() {
    try { localStorage.removeItem(TOUR_KEY); } catch (_) {}
  }

  function isElementUsable(selector) {
    const el = document.querySelector(selector);
    if (!el || el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
    const rects = el.getClientRects();
    if (!rects || !rects.length) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0;
  }

  function visibleModalOpen() {
    return !!document.querySelector('.modal:not([hidden]):not(#welcome-modal)');
  }

  function welcomeOpen() {
    const modal = document.getElementById('welcome-modal');
    return document.body.classList.contains('welcome-launch-open')
      || !!(modal && !modal.hidden && modal.getAttribute('aria-hidden') !== 'true');
  }

  function inUnsupportedMode(force) {
    if (force) return false;
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('randomIslandPreview') === '1') return true;
      if (params.get('planetProof') === '1') return true;
      if (params.get('party') || params.get('room') || params.get('collab')) return true;
    } catch (_) {}
    if (document.body.classList.contains('tw-play-mode')) return true;
    if (window.__tinyworldInWorldRoom) return true;
    return false;
  }

  function driverFactory() {
    return window.driver && window.driver.js && typeof window.driver.js.driver === 'function'
      ? window.driver.js.driver
      : null;
  }

  function step(selector, side, align, title, description) {
    return {
      element: selector,
      popover: { title, description, side, align },
    };
  }

  function buildSteps() {
    const raw = [
      step('#app', 'bottom', 'center', 'Your TinyWorld canvas', 'Orbit with left-drag, pan with right-drag or Space-drag, and zoom with the wheel or pinch. The home island is where building happens.'),
      step('#world-menu-btn', 'bottom', 'center', 'World menu', 'Open saved worlds, switch worlds, and manage the current build from here.'),
      step('#toolbar-build-play-mode', 'top', 'center', 'Build or play', 'Build mode edits the island. Play mode hides build controls so you can explore what you made.'),
      step('#unpack-prompt', 'top', 'start', 'Claim free worlds', 'Open a free pack to reveal and collect your very first tiny island — yours to keep.'),
      step('.tool-group-btn[data-group="terrain"]', 'top', 'center', 'Terrain tools', 'Paint grass, paths, water, stone, dirt, snow, sand, lava, rocks, and mesh terrain from one grouped menu.'),
      step('.tool-group-btn[data-group="build"]', 'top', 'center', 'Buildings', 'Drop houses, towers, bridges, fences, roofs, and city pieces, then use Select to edit details.'),
      step('#toolbar-view-modes', 'top', 'center', 'Camera views', 'Switch between perspective, walk modes, and overhead views when you need a different angle.'),
      step('#toolbar-layers', 'top', 'center', 'World items', 'Open the scene list and properties panel to find, select, and tune placed objects.'),
      step('#minimap-wrap', 'left', 'center', 'Minimap', 'Use the minimap to keep your bearings and jump around larger boards.'),
      step('#toolbar-settings', 'top', 'center', 'Settings', 'Tune workspace size, rendering quality, materials, environment, controls, and other app defaults.'),
      step('#sound-icon', 'top', 'center', 'Sound', 'Toggle music and effects and tune the volume to taste.'),
      step('#toolbar-guide', 'top', 'center', 'Replay this guide', 'Use this Guide button whenever you want to run the onboarding again.'),
    ];
    return raw.filter(item => isElementUsable(item.element));
  }

  let activeTour = null;
  function start(options = {}) {
    const force = !!options.force;
    if (activeTour && activeTour.isActive && activeTour.isActive()) activeTour.destroy();
    if (!force && localDone()) return false;
    if (welcomeOpen() || visibleModalOpen() || inUnsupportedMode(force)) return false;
    const factory = driverFactory();
    if (!factory) return false;
    const steps = buildSteps();
    if (steps.length < 3) return false;
    activeTour = factory({
      steps,
      animate: true,
      allowClose: true,
      allowKeyboardControl: true,
      overlayOpacity: 0.58,
      overlayColor: '#020509',
      stagePadding: 8,
      stageRadius: 12,
      popoverOffset: 12,
      showProgress: true,
      nextBtnText: 'Next',
      prevBtnText: 'Back',
      doneBtnText: 'Done',
      popoverClass: 'tinyworld-driver-popover',
      onPopoverRender: (popover) => {
        try {
          const wrap = popover && popover.wrapper;
          if (!wrap || wrap.querySelector('.tw-tour-binky')) return;
          const img = document.createElement('img');
          img.className = 'tw-tour-binky';
          img.src = 'assets/binky_thumbs.png';
          img.alt = '';
          img.setAttribute('aria-hidden', 'true');
          wrap.appendChild(img);
        } catch (_) {}
      },
      onDestroyed: () => {
        activeTour = null;
        if (!force) markDone();
      },
    });
    activeTour.drive();
    return true;
  }

  function waitAndStart(options = {}) {
    const force = !!options.force;
    let attempts = 0;
    const tick = () => {
      attempts += 1;
      if (start(options)) return;
      if (attempts < 90 && (!localDone() || force)) window.setTimeout(tick, 250);
    };
    window.setTimeout(tick, options.delay || 700);
  }

  window.__tinyworldOnboarding = {
    start,
    waitAndStart,
    reset: resetDone,
    isDone: localDone,
    key: TOUR_KEY,
  };

  const requested = queryValue();
  if (requested === 'reset') resetDone();
  if (requested === '0' || requested === 'off') return;
  if (requested) waitAndStart({ force: true, delay: 500 });
  else waitAndStart({ force: false, delay: 1200 });
}());
