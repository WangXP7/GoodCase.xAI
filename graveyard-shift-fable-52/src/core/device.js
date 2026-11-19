// G.device: what kind of device and frame this is. Built first; read by input, ui and render.
//   { touch, coarse, phone, ios, inFrame, dpr, portrait, safe:{top,right,bottom,left}, onChange(fn) }
// `touch` is true when ?touch=1, or when the device reports touch points together with a coarse
// primary pointer. A touch laptop (touch points, fine pointer) stays false until its first
// touchstart, which flips it for good and fires onChange. onChange(fn) listeners get the device;
// they run when touch, phone, portrait or ios change (a resize, a rotation, the first touch).
const PHONE_MAX_SHORT_SIDE = 500; // CSS px: a phone's short side; tablets and laptops are above it

// Pure core, for tests. `top` is whether this is the top-level window (false inside a frame).
export function detect({ maxTouchPoints = 0, coarse = false, ua = '', w = 0, h = 0, top = true, params = {} } = {}) {
  const touch = !!params.touch || (maxTouchPoints > 0 && !!coarse);
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1 && !!coarse); // iPadOS says Mac
  return {
    touch, coarse: !!coarse, ios,
    phone: touch && w > 0 && h > 0 && Math.min(w, h) <= PHONE_MAX_SHORT_SIDE,
    inFrame: !top,
    portrait: h > w,
  };
}

const defaultEnv = () => ({
  window: typeof window !== 'undefined' ? window : null,
  document: typeof document !== 'undefined' ? document : null,
  navigator: typeof navigator !== 'undefined' ? navigator : null,
});

export function createDevice(G, env = defaultEnv()) {
  const win = env.window;
  const nav = env.navigator || {};
  const doc = env.document;
  const params = (G && G.params) || {};
  const listeners = [];
  const safe = { top: 0, right: 0, bottom: 0, left: 0 };
  const device = { touch: false, coarse: false, phone: false, ios: false, inFrame: false, dpr: 1, portrait: false, safe, onChange: (fn) => { listeners.push(fn); } };
  let touchSeen = false; // a touchstart arrived on a device that did not report touch up front

  // Safe-area insets come from CSS env(); a hidden probe element turns them into numbers.
  let probe = null;
  try {
    if (doc && doc.body && typeof doc.createElement === 'function') {
      probe = doc.createElement('div');
      probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;'
        + 'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
      doc.body.appendChild(probe);
    }
  } catch { probe = null; }

  const px = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  function readSafe() {
    if (!probe || !win || !win.getComputedStyle) return;
    const cs = win.getComputedStyle(probe);
    safe.top = px(cs.paddingTop); safe.right = px(cs.paddingRight);
    safe.bottom = px(cs.paddingBottom); safe.left = px(cs.paddingLeft);
  }

  function read() {
    let coarse = false;
    try { coarse = !!(win && win.matchMedia && win.matchMedia('(pointer: coarse)').matches); } catch { coarse = false; }
    let top = true;
    try { top = !win || win.top === win; } catch { top = false; } // a cross-origin parent throws: we are framed
    const d = detect({
      maxTouchPoints: nav.maxTouchPoints || 0, coarse, ua: nav.userAgent || '',
      w: win ? win.innerWidth : 0, h: win ? win.innerHeight : 0, top,
      params: touchSeen ? { ...params, touch: true } : params,
    });
    return d;
  }

  function refresh() {
    const before = `${device.touch}${device.phone}${device.portrait}${device.ios}`;
    Object.assign(device, read());
    device.dpr = (win && win.devicePixelRatio) || 1;
    readSafe();
    if (`${device.touch}${device.phone}${device.portrait}${device.ios}` !== before) {
      for (const fn of listeners.slice()) {
        try { fn(device); } catch (e) { console.error(`[device] onChange listener: ${e && e.message}`); }
      }
    }
  }
  Object.assign(device, read());
  device.dpr = (win && win.devicePixelRatio) || 1;
  readSafe();

  if (win && win.addEventListener) {
    win.addEventListener('resize', refresh);
    win.addEventListener('orientationchange', refresh);
    if (!device.touch && (nav.maxTouchPoints || 0) > 0) {
      const onTouch = () => {
        win.removeEventListener('touchstart', onTouch, true);
        touchSeen = true;
        refresh();
      };
      win.addEventListener('touchstart', onTouch, true);
    }
  }
  return device;
}
