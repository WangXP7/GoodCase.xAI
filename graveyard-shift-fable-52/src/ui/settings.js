// Settings persistence and application. Everything goes through the scaffold's store helper, which
// never throws (a sandboxed frame has no localStorage: the settings then live for this visit only).
//
// Keys: quality (auto|mobile|low|medium|high), resolution ('auto' | 0.6..1), gore (full|reduced),
// sens, fov, volume (desktop), touchSens 0.5..2, autoFire (the auto-fire assist, off by default),
// assist 0..2 (friction / magnetism), lefty (touch). Keys no longer used (an old look/tiltSens)
// are dropped by sanitizeSettings when read.
// Changing one calls its apply branch and the onChange listeners; nothing goes on G.events.
import { store } from '../core/store.js';
import { SETTING_RANGES, GORE_LEVEL, sanitizeSettings } from './format.js';

const KEY = 'graveyard-shift.settings';

export function createSettings(G) {
  let saved = {};
  try { saved = sanitizeSettings(JSON.parse(store.get(KEY, '{}'))); } catch { saved = {}; }
  const baseSens = (G.input && G.input.sensitivity) || 0.0022;
  const params = G.params || {};
  const listeners = [];
  let autoPending = false; // "Auto" was picked mid-round: it runs on the next title or death screen

  const goreParam = params.gore === 'full' || params.gore === 'reduced' ? params.gore : null;
  const idle = () => { const st = G.game && G.game.state; return !st || st === 'title' || st === 'dead'; };

  const s = {
    // Current values. quality/volume follow the live modules when nothing was saved.
    get quality() { return saved.quality || (G.quality && G.quality.auto ? 'auto' : (G.quality && (G.quality.tier || G.quality.name)) || 'high'); },
    get resolution() { return saved.resolution ?? 'auto'; },
    get gore() { return goreParam || saved.gore || 'full'; },
    get sens() { return saved.sens ?? SETTING_RANGES.sens.def; },
    get fov() { return saved.fov ?? params.fov ?? SETTING_RANGES.fov.def; },
    get volume() { return saved.volume ?? (G.audio && Number.isFinite(G.audio.master) ? G.audio.master : SETTING_RANGES.volume.def); },
    get touchSens() { return saved.touchSens ?? SETTING_RANGES.touchSens.def; },
    get autoFire() { return saved.autoFire ?? (G.input && G.input.touch ? G.input.touch.autoFire : false) ?? false; },
    get assist() { return saved.assist ?? (G.input && G.input.touch && Number.isFinite(G.input.touch.assist) ? G.input.touch.assist : 2); },
    get lefty() { return saved.lefty ?? false; },
    get autoPending() { return autoPending; },
    onChange(fn) { listeners.push(fn); },
    set(key, value) {
      const clean = sanitizeSettings({ [key]: value });
      if (!(key in clean)) return false;
      saved[key] = clean[key];
      store.set(KEY, JSON.stringify(saved));
      s.apply(key);
      notify(key);
      return true;
    },
    apply(key) {
      if (key === 'quality') {
        if (s.quality === 'auto') {
          // The benchmark is a hitch: not mid-round. Picked from the pause screen it waits for the next idle screen.
          if (G.quality && G.quality.auto) autoPending = false;
          else if (idle()) { autoPending = false; G.quality?.setAuto?.(true); } else autoPending = true;
        } else { autoPending = false; G.quality?.set?.(s.quality); }
      } else if (key === 'resolution') {
        if (typeof s.resolution === 'number') G.quality?.setRenderScale?.(s.resolution);
      } else if (key === 'gore') { if (G.fx) G.fx.gore = GORE_LEVEL[s.gore] ?? 1; }
      else if (key === 'sens') { if (G.input) G.input.sensitivity = baseSens * s.sens; }
      else if (key === 'fov') { if (G.player) G.player.baseFov = s.fov; }
      else if (key === 'volume') {
        if (G.audio && 'master' in G.audio) G.audio.master = s.volume;
        else G.audio?.setVolume?.(s.volume); // requested API if the audio module exposes a setter instead
      } else if (key === 'touchSens') { if (G.input && G.input.touch) G.input.touch.sensitivity = s.touchSens; }
      else if (key === 'autoFire') { if (G.input && G.input.touch) G.input.touch.autoFire = s.autoFire; }
      else if (key === 'assist') { if (G.input && G.input.touch) G.input.touch.assist = s.assist; }
      else if (key === 'lefty') { if (G.input && G.input.touch) G.input.touch.lefty = s.lefty; }
    },
    // Called by the HUD on a game:state change: the deferred "Auto" runs once nothing is in progress.
    onState() { if (autoPending && idle()) { autoPending = false; G.quality?.setAuto?.(true); } },
    // At boot: apply only what the user saved. A ?q= or ?fov= harness param wins over saved quality / FOV.
    applyAll() {
      if (saved.quality && saved.quality !== 'auto' && !params.q) s.apply('quality');
      if (typeof saved.resolution === 'number' && params.rs === undefined) s.apply('resolution');
      s.apply('gore'); // always: G.fx.gore is 1 or 0.3, whatever else is going on
      if (saved.sens !== undefined) s.apply('sens');
      if (params.fov === undefined) { if (G.player) G.player.baseFov = s.fov; }
      if (saved.volume !== undefined) s.apply('volume');
      for (const k of ['touchSens', 'autoFire', 'assist', 'lefty']) if (saved[k] !== undefined) s.apply(k);
    },
  };
  function notify(key) {
    for (const fn of listeners.slice()) { try { fn(key, s[key]); } catch { /* a listener must not break the setting */ } }
  }
  return s;
}
