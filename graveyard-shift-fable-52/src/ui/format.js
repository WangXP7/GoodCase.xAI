// Pure helpers for the HUD and menus: number and prompt formatting, setting limits. No DOM.
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// 4350 -> "4 350" (no-break space), the way a price board groups digits.
export function formatPoints(n) {
  const v = Math.round(Number(n) || 0);
  return String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ').replace(/^/, v < 0 ? '-' : '');
}

const DENY = { points: 'Not enough points', full: 'Ammo full', locked: 'Locked', power: 'Needs power', owned: 'Already have it', busy: 'Wait a moment' };
export const denyText = (reason) => DENY[reason] || 'Unavailable';

// The interact prompt, as parts so the HUD can set the key in a cap. Keyboard (unchanged since the
// slice): "Press F — Ammo · 250". Touch names the on-screen button: "Tap BUY: Ammo — 250". A hold
// (searching, boards) says Hold instead. A door that cannot be opened offers no key and no price:
// "Diner — Locked". Price is omitted for free interactables.
export function interactVerb(focus) {
  if (!focus) return 'USE';
  if (focus.kind === 'search') return 'SEARCH';
  if (focus.kind === 'boards') return 'REPAIR';
  if (Number(focus.cost) > 0) return 'BUY';
  if (focus.kind === 'door') return 'OPEN';
  return 'USE';
}
export function promptParts(focus, mode = 'keyboard') {
  if (!focus) return null;
  const label = focus.label || focus.kind || 'Use';
  if (focus.kind === 'lockedDoor') return { key: null, label, cost: null, note: denyText('locked') };
  const cost = Number(focus.cost) > 0 ? formatPoints(focus.cost) : null;
  const hold = Number(focus.hold) > 0;
  if (mode === 'touch') return { pre: hold ? 'Hold ' : 'Tap ', key: interactVerb(focus), sep: ': ', label, costSep: ' — ', cost };
  return { pre: hold ? 'Hold ' : 'Press ', key: 'F', sep: ' — ', label, costSep: ' · ', cost };
}
export function promptString(focus, mode = 'keyboard') {
  const p = promptParts(focus, mode);
  if (!p) return '';
  if (!p.key) return `${p.label} — ${p.note}`;
  return `${p.pre}${p.key}${p.sep}${p.label}${p.cost ? `${p.costSep}${p.cost}` : ''}`;
}

// What an action is called on screen: the key on a keyboard, the button on touch.
const KEYS = {
  move: 'WASD', look: 'Mouse', fire: 'Click', ads: 'Right click', reload: 'R', interact: 'F', jump: 'Space', sprint: 'Shift',
  swap: 'Q', melee: 'V', throw: 'G', pause: 'Esc', hint: 'H',
};
const BUTTONS = {
  move: 'Stick', look: 'Drag', fire: 'FIRE', ads: 'AIM', reload: 'RELOAD', interact: 'USE', jump: 'JUMP', sprint: 'SPRINT',
  swap: 'SWAP', melee: 'MELEE', throw: 'THROW', pause: 'PAUSE', hint: 'HINT',
};
export function keyLabel(action, touch = false, focus = null) {
  if (touch) return action === 'interact' && focus ? interactVerb(focus) : BUTTONS[action] || String(action).toUpperCase();
  return KEYS[action] || String(action).toUpperCase();
}

// The controls card, one row per action. `key` is the keyboard column, `touch` the touch column.
export const CONTROLS = [
  { id: 'move', name: 'Move', key: 'W A S D', touch: 'Left thumb' },
  { id: 'look', name: 'Look', key: 'Mouse', touch: 'Drag right side' },
  { id: 'fire', name: 'Fire', key: 'Left click', touch: 'Tap; hold for automatics' },
  { id: 'ads', name: 'Aim', key: 'Right click', touch: 'Sight button (tap)' },
  { id: 'reload', name: 'Reload', key: 'R', touch: 'Round-arrow button' },
  { id: 'interact', name: 'Use / buy', key: 'F or E', touch: 'BUY / SEARCH' },
  { id: 'jump', name: 'Jump', key: 'Space', touch: 'Tap left side, or up-arrows' },
  { id: 'sprint', name: 'Sprint', key: 'Shift', touch: 'Stick all the way' },
  { id: 'swap', name: 'Swap gun', key: 'Q, wheel, 1 / 2', touch: '⇄ by the ammo' },
  { id: 'melee', name: 'Melee', key: 'V', touch: 'Blade button' },
  { id: 'throw', name: 'Throw', key: 'G (3 changes it)', touch: 'Grenade button' },
  { id: 'pause', name: 'Pause', key: 'Esc or P', touch: '‖ top corner' },
  { id: 'hint', name: 'Hide a hint', key: 'H', touch: 'Tap its ✕' },
];

// The name for a tight space: an upgraded gun's quoted nickname alone ('Ostrander 308 "Iron Vigil"' -> 'Iron Vigil').
export function shortWeaponName(name) {
  const m = /"([^"]+)"/.exec(String(name || ''));
  return m ? m[1] : String(name || '');
}
// True where the readouts should use short names: a touch layout, or a window narrower than 720 px.
export const narrowScreen = (touch) => !!touch || (typeof window !== 'undefined' && window.innerWidth < 720);

// Ammo as shown: numbers, or null for "—" when the weapon module has nothing yet.
export function ammoView(weapon) {
  const a = weapon && weapon.ammo;
  const num = (v) => (Number.isFinite(v) ? v : null);
  return { mag: a ? num(a.mag) : null, reserve: a ? num(a.reserve) : null, name: (weapon && weapon.name) || 'Pistol' };
}

// Rounds left to kill this round (spawned-but-alive plus not yet spawned), or null.
export function remaining(director) {
  if (!director || !Number.isFinite(director.total) || !Number.isFinite(director.spawned)) return null;
  return Math.max(0, director.total - director.spawned + (director.alive || 0));
}

export const SETTING_RANGES = {
  sens: { min: 0.3, max: 2.5, step: 0.05, def: 1 }, // multiplier on the input module's default sensitivity
  fov: { min: 70, max: 100, step: 1, def: 80 },
  volume: { min: 0, max: 1, step: 0.05, def: 1 },
  touchSens: { min: 0.5, max: 2, step: 0.05, def: 1 }, // multiplier on tuning.touch.look
};
export const QUALITIES = ['auto', 'mobile', 'low', 'medium', 'high'];
export const QUALITY_LABELS = { auto: 'Auto', mobile: 'Phone', low: 'Low', medium: 'Medium', high: 'High' };
// The tier in effect, as shown: "Auto (Phone)" when the benchmark picked it, "Phone" when chosen by hand.
// `tier` is G.quality.tier (never G.quality.name, which reads 'low' on the phone tier).
export const qualityLabel = (tier, auto) => (auto ? `Auto (${QUALITY_LABELS[tier] || tier})` : QUALITY_LABELS[tier] || String(tier));
// A phone on Auto or Phone must tap a heavier tier twice: Low, Medium and High are the desktop tiers.
export const needsQualityConfirm = (current, next, touch) => !!touch && (current === 'auto' || current === 'mobile') && (next === 'low' || next === 'medium' || next === 'high');
export const RESOLUTIONS = ['auto', 0.6, 0.8, 1]; // dynamic, or a render scale to start from
export const GORE = ['full', 'reduced'];
export const GORE_LEVEL = { full: 1, reduced: 0.3 }; // what G.fx.gore holds
export const ASSIST_NAMES = ['Off', 'Light', 'Strong'];
export const RES_RANGE = { min: 0.6, max: 1 };

// Anything stored or typed goes through here: unknown keys and bad values are dropped, numbers clamped.
export function sanitizeSettings(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  if (QUALITIES.includes(o.quality)) out.quality = o.quality;
  if (GORE.includes(o.gore)) out.gore = o.gore;
  if (typeof o.autoFire === 'boolean') out.autoFire = o.autoFire;
  if (typeof o.lefty === 'boolean') out.lefty = o.lefty;
  const num = (v) => (v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
  for (const k of Object.keys(SETTING_RANGES)) {
    const n = num(o[k]);
    if (n !== null) out[k] = clamp(n, SETTING_RANGES[k].min, SETTING_RANGES[k].max);
  }
  const a = num(o.assist);
  if (a !== null) out.assist = clamp(Math.round(a), 0, 2);
  if (o.resolution === 'auto') out.resolution = 'auto';
  else { const r = num(o.resolution); if (r !== null) out.resolution = clamp(r, RES_RANGE.min, RES_RANGE.max); }
  return out;
}
