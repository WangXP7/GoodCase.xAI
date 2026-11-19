// Blood on the player's screen when a zombie lands a blow: a few drops and a running
// streak at the edge the hit came from, gone in 2.5 s. It sits in the HUD's root under every HUD
// element (the low-health edge is in the post chain, so this is over it), never over the middle
// fifth of the view, fewer and fainter on touch so the controls stay readable. With gore reduced,
// or prefers-reduced-motion, there is no blood: a plain red pulse at the edge instead. A hit the
// armour took whole leaves nothing; a revive wipes the glass.
//
// API (G.gore.screen): hit(angle, hurt) to show one by hand, clear(), plan (the last screenPlan).
import { screenPlan } from '../fx/blood.js';

const LIFE = 2.5, DROPS = 18;
const CSS = `
#gs-blood{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:0;contain:strict}
#gs-blood i{position:absolute;display:block;opacity:0;will-change:transform,opacity}
#gs-blood i.d{border-radius:var(--br,46% 54% 58% 42%/52% 44% 56% 48%);filter:blur(.35px);
 background:radial-gradient(ellipse at 38% 30%,rgba(104,8,6,.93) 0%,rgba(70,2,2,.9) 48%,rgba(42,0,0,.74) 70%,rgba(30,0,0,0) 80%);
 box-shadow:var(--sat,none)}
#gs-blood i.s{border-radius:45% 45% 50% 50%/8% 8% 30% 30%;transform-origin:50% 0;
 background:linear-gradient(180deg,rgba(104,6,5,.9) 0%,rgba(88,3,3,.8) 60%,rgba(70,0,0,.55) 88%,rgba(60,0,0,0) 100%)}
#gs-blood i.on{animation:gs-bl-fade var(--life,2.5s) cubic-bezier(.5,0,.9,.6) forwards}
#gs-blood i.s.on{animation:gs-bl-run var(--life,2.5s) cubic-bezier(.2,.7,.3,1) forwards}
#gs-blood b{position:absolute;inset:0;opacity:0;box-shadow:inset 0 0 18vmin 4vmin rgba(150,0,0,.55)}
#gs-blood b.on{animation:gs-bl-pulse .6s ease-out forwards}
@keyframes gs-bl-fade{0%{opacity:var(--a,.85);transform:translateY(0) scale(.6)}6%{transform:translateY(0) scale(1)}55%{opacity:var(--a,.85)}100%{opacity:0;transform:translateY(var(--run,3vh)) scale(1)}}
@keyframes gs-bl-run{0%{opacity:var(--a,.85);transform:scaleY(.12)}60%{opacity:var(--a,.85)}100%{opacity:0;transform:scaleY(1)}}
@keyframes gs-bl-pulse{0%{opacity:.9}100%{opacity:0}}
@media (prefers-reduced-motion:reduce){#gs-blood i{display:none}}
`;

export function createBloodScreen(G, gore) {
  const root = G.ui && G.ui.root;
  if (!root || typeof document === 'undefined') return null;
  if (!document.getElementById('gs-blood-css')) {
    const st = document.createElement('style');
    st.id = 'gs-blood-css'; st.textContent = CSS;
    document.head.appendChild(st);
  }
  const layer = document.createElement('div');
  layer.id = 'gs-blood';
  layer.setAttribute('aria-hidden', 'true');
  root.insertBefore(layer, root.firstChild);   // under everything else in the HUD's root
  const drops = [], streaks = [];
  for (let i = 0; i < DROPS; i++) {
    const d = document.createElement('i'); d.className = 'd'; layer.appendChild(d); drops.push(d);
    const s = document.createElement('i'); s.className = 's'; layer.appendChild(s); streaks.push(s);
  }
  const pulse = document.createElement('b');
  layer.appendChild(pulse);
  let at = 0, platesBefore = 0, plateFrame = -1;
  const rng = G.rng && typeof G.rng.fork === 'function' ? G.rng.fork('bloodScreen') : { next: () => 0.5 };
  const rnd = () => rng.next();
  const plan = { pulse: false, drops: [] };
  const still = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const replay = (el) => { el.classList.remove('on'); void el.offsetWidth; el.classList.add('on'); };
  // out in the rain the glass clears sooner
  const lifeNow = () => {
    const wet = G.fx && typeof G.fx.wetAt === 'function' && G.player && G.player.pos ? G.fx.wetAt(G.player.pos) : 0.5;
    return LIFE * (1 - 0.25 * wet);
  };

  function hit(angle, hurt) {
    screenPlan(angle, { gore: gore ? gore.level() : 1, touch: !!(G.ui && G.ui.touch), reducedMotion: !!(still && still.matches), hurt, r: rnd }, plan);
    if (plan.pulse) { replay(pulse); return plan; }
    const life = lifeNow();
    for (const d of plan.drops) {
      const el = drops[at], sk = streaks[at];
      at = (at + 1) % DROPS;
      const st = el.style;
      st.left = `${(d.x * 100).toFixed(2)}%`; st.top = `${(d.y * 100).toFixed(2)}%`;
      st.width = `${(d.r * 2 * 100 * (0.8 + 0.5 * rnd())).toFixed(2)}vh`; st.height = `${(d.r * 2 * 100).toFixed(2)}vh`;
      st.marginLeft = `${(-d.r * 100).toFixed(2)}vh`; st.marginTop = `${(-d.r * 100).toFixed(2)}vh`;
      st.setProperty('--a', d.alpha.toFixed(2)); st.setProperty('--life', `${life.toFixed(2)}s`); st.setProperty('--run', `${(1.5 + 4 * rnd()).toFixed(1)}vh`);
      st.rotate = `${Math.round(rnd() * 360)}deg`;
      // an uneven outline and two or three flecks thrown off it
      const q = () => Math.round(34 + 32 * rnd());
      st.setProperty('--br', `${q()}% ${q()}% ${q()}% ${q()}%/${q()}% ${q()}% ${q()}% ${q()}%`);
      const R = d.r * 100, fl = (k) => `${((rnd() - 0.5) * R * 5).toFixed(2)}vh ${((rnd() - 0.5) * R * 5).toFixed(2)}vh 0 ${(-R * k).toFixed(2)}vh rgba(72,3,3,.82)`;
      st.setProperty('--sat', `${fl(0.62)},${fl(0.74)},${fl(0.8)}`);
      replay(el);
      if (d.streak > 0) {
        const ss = sk.style;
        ss.left = st.left; ss.top = st.top;
        ss.width = `${(d.r * 0.9 * 100).toFixed(2)}vh`; ss.height = `${(d.streak * 100).toFixed(2)}vh`; ss.marginLeft = `${(-d.r * 0.45 * 100).toFixed(2)}vh`;
        ss.setProperty('--a', (d.alpha * 0.9).toFixed(2)); ss.setProperty('--life', `${life.toFixed(2)}s`);
        replay(sk);
      } else sk.classList.remove('on');
    }
    return plan;
  }
  function clear() {
    for (const el of drops) el.classList.remove('on');
    for (const el of streaks) el.classList.remove('on');
    pulse.classList.remove('on');
  }

  const on = (name, fn) => { if (G.events && typeof G.events.on === 'function') G.events.on(name, fn); };
  // plates: the controller reports the armour change just before the damage event of the same blow
  on('armor:change', (e) => {
    const n = e && Number.isFinite(e.plates) ? e.plates : 0;
    if (n < platesBefore) plateFrame = G.time ? G.time.frame : 0;
    platesBefore = n;
  });
  on('player:damage', () => {
    const p = G.player;
    if (!p) return;
    // the armour took it: no blood on the glass
    const max = p.maxHealth || 100;
    if (G.time && plateFrame === G.time.frame && (p.health ?? max) >= max - 0.5) return;
    const d = p.lastDamage;
    hit(d && Number.isFinite(d.angle) && d.dir ? d.angle : null, 1 - Math.max(0, p.health ?? max) / max);
  });
  on('revive', clear);
  on('game:state', (e) => { if (e && (e.state === 'title' || e.state === 'playing')) clear(); });

  return { hit, clear, plan, layer };
}
