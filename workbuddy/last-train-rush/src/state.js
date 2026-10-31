// 极简事件总线 + 全局状态
const listeners = new Map();

export const State = {
  phase: 'boot',        // boot | menu | playing | paused | dead | win
  score: 0,
  coins: 0,
  hearts: 3,
  distance: 0,          // 已跑距离（米）
  speed: 13,
  best: 0,
  muted: false,
  stats: { jumps: 0, rolls: 0, nearMiss: 0, hits: 0, time: 0 },
};

export function on(evt, cb) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(cb);
}
export function off(evt, cb) { listeners.get(evt)?.delete(cb); }
export function emit(evt, data) { listeners.get(evt)?.forEach(cb => { try { cb(data); } catch (e) { console.error(e); } }); }

export function resetRun() {
  State.score = 0;
  State.coins = 0;
  State.hearts = 3;
  State.distance = 0;
  State.speed = 13;
  State.stats = { jumps: 0, rolls: 0, nearMiss: 0, hits: 0, time: 0 };
}

export function setPhase(p) {
  if (State.phase === p) return;
  State.phase = p;
  emit('phase', p);
}

export function setMuted(m) {
  State.muted = m;
  saveMuted();
  emit('mute', m);
}

const BEST_KEY = 'ltr-best-v1';
export function loadBest() {
  try { State.best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0; } catch { State.best = 0; }
  return State.best;
}
export function saveBest(score) {
  const s = Math.round(score);
  if (s > State.best) {
    State.best = s;
    try { localStorage.setItem(BEST_KEY, String(s)); } catch { /* 隐私模式 */ }
  }
}

const MUTE_KEY = 'ltr-muted-v1';
export function loadMuted() {
  try { State.muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* ignore */ }
  return State.muted;
}
export function saveMuted() {
  try { localStorage.setItem(MUTE_KEY, State.muted ? '1' : '0'); } catch { /* ignore */ }
}
