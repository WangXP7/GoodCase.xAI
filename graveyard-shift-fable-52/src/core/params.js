// URL harness params. Pure: takes a query string, returns typed values.
const NUM_LIST = { cam: 5 };
const NUMS = ['fov', 'dt', 'seed', 'round', 'spawn', 'adv', 'warp', 'points', 'plates'];
const FLAGS = ['autostart', 'nohud', 'noweapon', 'step', 'god', 'bot', 'crash', 'touch', 'autotier', 'power'];
const STRINGS = ['shot', 'q', 'zone', 'ztype'];
const ENUMS = { gore: ['full', 'reduced'], searched: ['all'] };
const RS_MIN = 0.5; // rs=<RS_MIN..1>: fixed render scale

const list = (s) => s.split(',').map((v) => v.trim()).filter(Boolean);

const num = (s) => {
  if (s === undefined || s === null || s.trim() === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

export function parseParams(search = '') {
  const sp = new URLSearchParams(search);
  const out = {};
  for (const k of STRINGS) if (sp.has(k) && sp.get(k) !== '') out[k] = sp.get(k);
  for (const k of FLAGS) if (sp.has(k)) out[k] = !['0', 'false', 'no'].includes(sp.get(k));
  for (const k of NUMS) {
    const n = num(sp.get(k));
    if (n !== undefined) out[k] = n;
  }
  for (const [k, allowed] of Object.entries(ENUMS)) if (allowed.includes(sp.get(k))) out[k] = sp.get(k);
  const rs = num(sp.get('rs'));
  if (rs !== undefined && rs >= RS_MIN && rs <= 1) out.rs = rs;
  // hints=0 (off), hints=reset (forget what was shown), hints=1 (on)
  if (sp.has('hints')) {
    const v = sp.get('hints');
    if (v === 'reset') out.hints = 'reset';
    else if (v !== '') out.hints = !['0', 'false', 'no'].includes(v);
  }
  // give=smg,pump -> ['smg','pump'];  open=all | open=diner,motel -> 'all' | ['diner','motel']
  if (sp.has('give')) { const g = list(sp.get('give')); if (g.length) out.give = g; }
  if (sp.has('open')) { const o = list(sp.get('open')); if (o.length) out.open = o.includes('all') ? 'all' : o; }
  for (const [k, len] of Object.entries(NUM_LIST)) {
    if (!sp.has(k)) continue;
    const parts = sp.get(k).split(',').map(num);
    if (parts.length === len && parts.every((v) => v !== undefined)) out[k] = parts;
  }
  return out;
}
