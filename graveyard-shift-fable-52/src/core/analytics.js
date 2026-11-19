// Vercel Web Analytics custom events. window.va exists only in builds made on Vercel (the build
// script adds the queue and the insights script); everywhere else (file://, the artifact frame, tests)
// this is a no-op. Never throws. Props are flat primitives only: no tags, no secrets, nothing personal.
const MAX_STR = 255;

export function cleanProps(props) {
  if (!props || typeof props !== 'object') return undefined;
  const out = {};
  for (const [k, v] of Object.entries(props)) {
    if (typeof v === 'string') out[k] = v.slice(0, MAX_STR);
    else if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

export function track(name, props) {
  try {
    const w = typeof window !== 'undefined' ? window : null;
    if (!w || typeof w.va !== 'function') return;
    const data = cleanProps(props);
    w.va('event', data ? { name: String(name), data } : { name: String(name) });
  } catch { /* analytics must never break the game */ }
}
