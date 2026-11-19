// The landscape suggestion. A touch device held upright still plays (nothing pauses and nothing is
// blocked); it is only told that sideways gives a bigger view:
//  - on the title screen: a small line with a turning-phone glyph, for as long as the phone is upright;
//  - in play: the same line as a toast for TOAST_MS at the first upright moment of each run, then just
//    the glyph near the top until the phone turns sideways.
// A tap on it hides it for the rest of the session (sessionStorage, so a new visit shows it again).
// Nothing here locks the orientation (screen.orientation.lock is not used anywhere). It sits at the top
// centre, under the safe-area inset: away from the crosshair, the stick zone and the buttons.
// mode() is pure, for tests.
export const TOAST_MS = 5000;
export const TURN_TEXT = 'Turn your phone sideways for a bigger view';
const KEY = 'graveyard-shift.turnHint';

// What to show: 'off' | 'line' (glyph and words) | 'glyph' (glyph alone).
export function mode({ touch, portrait, state, dismissed, toasting }) {
  if (!touch || !portrait || dismissed) return 'off';
  if (state === 'title') return 'line';
  if (state === 'playing') return toasting ? 'line' : 'glyph';
  return 'off';
}

const readDismissed = () => { try { return window.sessionStorage.getItem(KEY) === '1'; } catch { return false; } };
const saveDismissed = () => { try { window.sessionStorage.setItem(KEY, '1'); } catch { /* this page only */ } };

export function createOrient(G, host, { enabled = true } = {}) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'gs-turn';
  el.setAttribute('aria-label', `${TURN_TEXT}. Tap to hide`);
  el.hidden = true;
  const NS = 'http://www.w3.org/2000/svg';
  const art = document.createElementNS(NS, 'svg');
  art.setAttribute('class', 'gs-turn-art'); art.setAttribute('viewBox', '0 0 32 32'); art.setAttribute('aria-hidden', 'true');
  art.innerHTML = '<g class="ph"><rect x="10.5" y="4" width="11" height="20" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14.5 6.5h3" stroke="currentColor" stroke-width="1.6"/></g>'
    + '<path d="M25 9.5a11 11 0 0 1 2.6 8.5M27.6 18l-2.9-2M27.6 18l1.4-3.2" fill="none" stroke="currentColor" stroke-width="2"/>';
  const words = document.createElement('span');
  words.className = 'gs-turn-t';
  words.textContent = TURN_TEXT;
  const x = document.createElement('span');
  x.className = 'gs-turn-x'; x.setAttribute('aria-hidden', 'true'); x.textContent = '✕';
  el.append(art, words, x);
  host.appendChild(el);

  let dismissed = readDismissed();
  let toastDone = false; // this run's toast has been shown
  let toastTimer = null;
  let toasting = false;
  let shown = 'off';
  let inPlay = false;
  let lastState = null;
  const stateNow = () => (G.game && G.game.state) || 'title';
  const clearTimer = () => { if (toastTimer !== null) { clearTimeout(toastTimer); toastTimer = null; } };

  const api = {
    el,
    // Kept for callers that hid things behind the old full-screen card: nothing blocks now.
    get visible() { return false; },
    get mode() { return shown; },
    get dismissed() { return dismissed; },
    // Re-evaluate on a device change, a resize or a state change. Cheap; no layout reads.
    sync() {
      const state = stateNow();
      if (state !== lastState) {
        // a new run (from the title or a death screen): its toast may show again
        if (state === 'playing' && (lastState === 'title' || lastState === 'dead' || lastState === null)) toastDone = false;
        lastState = state;
      }
      const d = G.device || {};
      const touch = enabled && !!d.touch;
      if (touch && d.portrait && state === 'playing' && !toastDone && !dismissed) {
        toastDone = true; toasting = true;
        clearTimer();
        toastTimer = setTimeout(() => { toastTimer = null; toasting = false; api.sync(); }, TOAST_MS);
      }
      if (!d.portrait && toasting) { toasting = false; clearTimer(); }
      const m = mode({ touch, portrait: !!d.portrait, state, dismissed, toasting });
      const play = state === 'playing';
      if (m === shown && play === inPlay) return;
      shown = m; inPlay = play;
      el.hidden = m === 'off';
      el.classList.toggle('mini', m === 'glyph');
      el.classList.toggle('play', play); // in play the toast sits under the top corners (mobile.css)
    },
    dismiss() { dismissed = true; toasting = false; clearTimer(); saveDismissed(); api.sync(); },
  };
  el.addEventListener('click', (e) => { e.stopPropagation(); api.dismiss(); });
  if (G.device && typeof G.device.onChange === 'function') G.device.onChange(() => api.sync());
  window.addEventListener('resize', () => api.sync());
  G.events?.on?.('game:state', () => api.sync());
  api.sync();
  return api;
}
