// The UI's whole stylesheet, shipped as a string and injected by createUI().
// No @font-face and no url(): the host page declares the faces and the two variables
// --font-display and --font-ui (dev/fonts.css in development, inlined in the release build).
// Sizes hang off one unit, --u (1 % of the short side of the view, clamped), never off vh.
export const CSS = /* css */ `
#ui.tp {
  position: fixed; inset: 0; overflow: hidden; pointer-events: none;
  user-select: none; -webkit-user-select: none; cursor: default;
  --u: clamp(6px, 1vmin, 14.4px);
  --tp-display: var(--font-display, 'Cormorant Garamond', 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif);
  --tp-sans: var(--font-ui, -apple-system, 'SF Pro Text', 'Inter', system-ui, sans-serif);
  --tp-ink: #060608;
  --tp-veil: rgba(5, 5, 8, 0.8);
  --tp-veil-deep: rgba(4, 4, 6, 0.94);
  --tp-bone: #ddd5c4;
  --tp-bone-2: rgba(221, 213, 196, 0.68);
  --tp-bone-3: rgba(221, 213, 196, 0.4);
  --tp-line: rgba(221, 213, 196, 0.2);
  --tp-line-2: rgba(221, 213, 196, 0.1);
  --tp-ember: #e2702c;
  --tp-ember-hot: #ffb373;
  --tp-blood: #a02320;
  --tp-gloom: #7a4fd0;
  --tp-cold: #8fb3c9;
  --tp-shadow: 0 0 0.5em rgba(0, 0, 0, 0.9), 0 0.06em 0.14em rgba(0, 0, 0, 0.95);
  --hud-m: calc(var(--u) * 4.2);
  --fs-micro: clamp(9.5px, calc(var(--u) * 1.08), 15px);
  --fs-small: clamp(11.5px, calc(var(--u) * 1.36), 18px);
  --fs-body: clamp(13px, calc(var(--u) * 1.56), 21px);
  --fs-lead: clamp(15.5px, calc(var(--u) * 2.05), 29px);
  --fs-h3: clamp(18px, calc(var(--u) * 2.6), 37px);
  --fs-h2: clamp(22px, calc(var(--u) * 3.5), 50px);
  --fs-h1: clamp(30px, calc(var(--u) * 5.4), 78px);
  --fs-mark: clamp(40px, calc(var(--u) * 8.6), 124px);
  font-family: var(--tp-sans); font-size: var(--fs-body); line-height: 1.4; color: var(--tp-bone);
  -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; font-kerning: normal;
}
#ui.tp *, #ui.tp *::before, #ui.tp *::after { box-sizing: border-box; }
#ui.tp [hidden] { display: none !important; }
/* resets carry no specificity (:where), so every class below wins without a fight */
:where(#ui.tp) button { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0; cursor: pointer; text-align: inherit; border-radius: 0; -webkit-tap-highlight-color: transparent; }
:where(#ui.tp) button:disabled { cursor: default; }
:where(#ui.tp) button:focus { outline: none; }
:where(#ui.tp) button:focus-visible { outline: 1px solid var(--tp-bone-3); outline-offset: 0.3em; }
:where(#ui.tp) p, :where(#ui.tp) h1 { margin: 0; font-weight: inherit; }
:where(#ui.tp) i, :where(#ui.tp) b { font-style: normal; font-weight: inherit; display: block; }

/* ---- layers ------------------------------------------------------------------------------ */
.tp-layer { position: absolute; inset: 0; opacity: 0; visibility: hidden; transition: opacity 0.45s ease, visibility 0s linear 0.45s; }
.tp-layer.is-on { opacity: 1; visibility: visible; transition: opacity 0.45s ease; }

/* ---- small parts ------------------------------------------------------------------------- */
.tp-label { font-family: var(--tp-sans); font-size: var(--fs-micro); font-weight: 500; letter-spacing: 0.18em; text-transform: uppercase; color: var(--tp-bone-2); line-height: 1.25; }
.tp-key { display: inline-flex; align-items: center; justify-content: center; min-width: 1.95em; height: 1.95em; padding: 0 0.5em; border: 1px solid var(--tp-bone-3); background: rgba(5, 5, 8, 0.4); font-family: var(--tp-sans); font-size: var(--fs-micro); font-weight: 600; letter-spacing: 0.06em; line-height: 1; color: var(--tp-bone); text-transform: uppercase; white-space: nowrap; border-radius: 1px; flex: none; }
.tp-rule { display: flex; align-items: center; gap: 0.7em; color: var(--tp-bone-3); }
.tp-rule i { flex: 1; height: 1px; background: currentColor; }
.tp-rule b, .tp-loz { width: 0.44em; height: 0.44em; border: 1px solid currentColor; transform: rotate(45deg); flex: none; }
.tp-loz { display: inline-block; }
.tp-loz.is-full { background: currentColor; }
.tp-num { font-variant-numeric: tabular-nums lining-nums; }
.tp-h1, .tp-h2, .tp-h3 { font-family: var(--tp-display); font-weight: 500; letter-spacing: 0.015em; }
.tp-h1 { font-size: var(--fs-h1); line-height: 1.04; }
.tp-h2 { font-size: var(--fs-h2); line-height: 1.1; }
.tp-h3 { font-size: var(--fs-h3); line-height: 1.16; }
.tp-lead { font-family: var(--tp-display); font-size: var(--fs-lead); line-height: 1.36; }
#ui.tp p.tp-lead { margin-top: 0.5em; }
.tp-it { font-style: italic; }
.tp-dim { color: var(--tp-bone-2); }
.tp-body { font-family: var(--tp-display); font-size: var(--fs-lead); line-height: 1.4; color: var(--tp-bone-2); max-width: 30em; text-wrap: pretty; }
#ui.tp p.tp-body { margin-top: 0.9em; }
.tp-small { font-family: var(--tp-display); font-size: calc(var(--fs-lead) * 0.9); line-height: 1.4; text-wrap: pretty; }

.tp-glyph { width: 100%; height: 100%; display: block; overflow: visible; }
.tp-glyph-line { fill: none; stroke: currentColor; stroke-width: 1.15px; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
.tp-glyph-faint { fill: none; stroke: currentColor; stroke-opacity: 0.32; stroke-width: 1px; vector-effect: non-scaling-stroke; }
.tp-glyph-live { fill: currentColor; fill-opacity: 0.92; stroke: currentColor; stroke-width: 1px; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
.tp-icon { display: inline-flex; width: 3em; height: 3em; flex: none; color: var(--tp-bone); }
.tp-icon canvas { width: 100%; height: 100%; display: block; }
.tp-icon > .tp-glyph { width: 86%; height: 86%; margin: auto; }
.tp-glyph-stone .tp-glyph-live { fill-opacity: 0.3; }

/* ---- vignettes --------------------------------------------------------------------------- */
.tp-vig { position: absolute; inset: 0; opacity: 0; }
#ui.tp:not(.is-world) .tp-vig { opacity: 0 !important; transition: opacity 0.6s; }
.tp-vig-gloom { background: radial-gradient(ellipse at 50% 46%, rgba(30, 12, 60, 0) 30%, rgba(34, 14, 66, 0.5) 72%, rgba(9, 3, 20, 0.95) 100%); transition: opacity 0.7s linear; }
.tp-vig-gloom i { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 50%, rgba(122, 79, 208, 0) 52%, rgba(122, 79, 208, 0.2) 100%); animation: tp-breathe 6.5s ease-in-out infinite; }
.tp-vig-hurt { background: radial-gradient(ellipse at center, rgba(90, 0, 0, 0) 38%, rgba(124, 10, 8, 0.5) 80%, rgba(46, 0, 0, 0.88) 100%); }
.tp-vig-low { background: radial-gradient(ellipse at center, rgba(60, 0, 0, 0) 52%, rgba(86, 6, 6, 0.45) 100%); transition: opacity 0.5s; }
@keyframes tp-breathe { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }

/* ---- HUD --------------------------------------------------------------------------------- */
.tp-hud { text-shadow: var(--tp-shadow); }
/* small capitals over the open world: they must hold on a noon sky as well as at night */
.tp-hud .tp-label { color: rgba(221, 213, 196, 0.88); text-shadow: 0 0 0.35em rgba(0, 0, 0, 0.95), 0 0 0.9em rgba(0, 0, 0, 0.8), 0 0.06em 0.14em #000; }
.tp-obj { position: absolute; left: var(--hud-m); top: calc(var(--hud-m) * 0.86); max-width: calc(var(--u) * 46); }
.tp-obj-text { font-family: var(--tp-display); font-size: var(--fs-lead); line-height: 1.24; margin-top: 0.3em; }
.tp-obj.is-new .tp-obj-text { animation: tp-new 3s ease both; }
@keyframes tp-new { 0% { color: var(--tp-ember-hot); opacity: 0; transform: translateY(0.3em); } 18% { opacity: 1; transform: none; } 60% { color: var(--tp-ember-hot); } 100% { color: var(--tp-bone); } }
.tp-obj-primes { display: flex; gap: calc(var(--u) * 1.4); margin-top: calc(var(--u) * 1.1); }
.tp-obj-prime { width: calc(var(--u) * 2.5); height: calc(var(--u) * 2.5); color: var(--tp-bone-3); filter: drop-shadow(0 0 3px rgba(0, 0, 0, 0.9)); }
.tp-obj-prime.is-got { color: var(--tp-ember-hot); }

.tp-compass { position: absolute; top: calc(var(--hud-m) * 0.7); left: 50%; transform: translateX(-50%); width: clamp(260px, calc(var(--u) * 52), 760px); height: clamp(32px, calc(var(--u) * 4.8), 68px); }
.tp-compass canvas { width: 100%; height: 100%; display: block; }

.tp-cross { position: absolute; left: 50%; top: 50%; width: 0; height: 0; --aim: var(--tp-ember); }
.tp-cross i { position: absolute; left: 0; top: 0; transform: translate(-50%, -50%); }
.tp-cross-dot { width: 3.5px; height: 3.5px; border-radius: 50%; background: var(--tp-bone); box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5); transition: opacity 0.15s; }
.tp-cross-ring { width: calc(var(--u) * 1.9); height: calc(var(--u) * 1.9); border-radius: 50%; border: 1px solid var(--tp-bone); box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.3), inset 0 0 0 1px rgba(0, 0, 0, 0.3); opacity: 0; transform: translate(-50%, -50%) scale(0.35) !important; transition: opacity 0.18s, transform 0.22s ease, border-color 0.2s; }
.tp-cross-ticks { width: calc(var(--u) * 5.6); height: calc(var(--u) * 5.6); opacity: 0; transition: opacity 0.18s, transform 0.25s ease; transform: translate(-50%, -50%) scale(1.5) rotate(45deg) !important; }
.tp-cross-ticks::before, .tp-cross-ticks::after { content: ''; position: absolute; background: linear-gradient(90deg, var(--aim) 0 18%, transparent 18% 82%, var(--aim) 82% 100%); }
.tp-cross-ticks::before { left: 0; right: 0; top: 50%; height: 1px; }
.tp-cross-ticks::after { top: 0; bottom: 0; left: 50%; width: 1px; background: linear-gradient(180deg, var(--aim) 0 18%, transparent 18% 82%, var(--aim) 82% 100%); }
.tp-cross[data-s='none'] .tp-cross-dot { opacity: 0; }
.tp-cross[data-s='ring'] .tp-cross-ring { opacity: 0.95; transform: translate(-50%, -50%) scale(1) !important; }
.tp-cross[data-s='aim'] .tp-cross-ring { opacity: 1; border-color: var(--aim); transform: translate(-50%, -50%) scale(1.5) !important; }
.tp-cross[data-s='aim'] .tp-cross-ticks { opacity: 0.9; transform: translate(-50%, -50%) scale(1) rotate(45deg) !important; }

.tp-focus { position: absolute; left: 50%; top: 50%; transform: translate(-50%, calc(var(--u) * 3.8)); display: flex; align-items: center; gap: calc(var(--u) * 1.1); white-space: nowrap; opacity: 0; transition: opacity 0.16s; }
.tp-focus.is-on { opacity: 1; }
.tp-focus-keywrap { position: relative; display: inline-flex; }
.tp-hud .tp-focus-verb { color: var(--tp-bone); }
.tp-focus-name { font-family: var(--tp-display); font-size: var(--fs-lead); font-weight: 500; letter-spacing: 0.02em; line-height: 1; }
.tp-focus-name:empty { display: none; }
.tp-hold { position: absolute; left: 50%; top: 50%; width: calc(var(--fs-micro) * 3.5); height: calc(var(--fs-micro) * 3.5); transform: translate(-50%, -50%) rotate(-90deg); opacity: 0; transition: opacity 0.15s; overflow: visible; }
.tp-focus.is-hold .tp-hold { opacity: 1; }
.tp-focus.is-hold .tp-key { border-color: transparent; background: none; }
.tp-hold circle { fill: none; }
.tp-hold-track { stroke: var(--tp-bone-3); stroke-width: 1; }
.tp-hold-fill { stroke: var(--tp-ember-hot); stroke-width: 2; stroke-dasharray: 1; stroke-dashoffset: 1; }

.tp-hint { position: absolute; left: 50%; bottom: calc(var(--u) * 15); transform: translateX(-50%); max-width: calc(var(--u) * 70); text-align: center; font-family: var(--tp-display); font-style: italic; font-size: var(--fs-lead); line-height: 1.3; opacity: 0; transition: opacity 0.5s; }
.tp-hint.is-on { opacity: 1; }

.tp-belt { position: absolute; left: 50%; bottom: calc(var(--u) * 4.4); transform: translateX(-50%); display: flex; gap: calc(var(--u) * 1.5); align-items: flex-end; }
.tp-slot { position: relative; width: calc(var(--u) * 5.8); height: calc(var(--u) * 5.8); opacity: 0.56; transition: opacity 0.2s, transform 0.25s ease; }
.tp-slot .tp-icon { width: 100%; height: 100%; filter: drop-shadow(0 0.12em 0.35em rgba(0, 0, 0, 0.85)); }
.tp-slot.is-held { opacity: 1; transform: translateY(calc(var(--u) * -0.7)); }
.tp-slot::after { content: ''; position: absolute; left: 14%; right: 14%; bottom: calc(var(--u) * -0.9); height: 1px; background: var(--tp-ember); transform: scaleX(0); transition: transform 0.25s ease; }
.tp-slot.is-held::after { transform: scaleX(1); }
.tp-slot.is-bump { animation: tp-bump 0.5s ease; }
@keyframes tp-bump { 0% { filter: brightness(2.2); } 100% { filter: none; } }
.tp-slot-key { position: absolute; left: -0.15em; top: -0.35em; font-size: var(--fs-micro); font-weight: 600; color: var(--tp-bone-2); line-height: 1; }
.tp-slot-n { position: absolute; right: -0.1em; bottom: -0.1em; font-size: var(--fs-small); font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1; }
.tp-belt-name { position: absolute; left: 50%; bottom: calc(var(--u) * 11.6); transform: translateX(-50%); font-family: var(--tp-display); font-size: var(--fs-lead); letter-spacing: 0.03em; white-space: nowrap; opacity: 0; transition: opacity 0.5s; }
.tp-belt-name.is-on { opacity: 1; }

.tp-health { position: absolute; left: 50%; bottom: calc(var(--u) * 2.1); transform: translateX(-50%); width: calc(var(--u) * 27); height: 2px; background: rgba(221, 213, 196, 0.16); box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4); opacity: 0; transition: opacity 0.7s; }
.tp-health.is-on { opacity: 1; }
.tp-health i, .tp-health b { position: absolute; inset: 0; transform-origin: left center; }
.tp-health i { background: var(--tp-bone); transition: transform 0.25s ease, background 0.3s; }
.tp-health b { background: var(--tp-blood); transition: transform 1s ease 0.3s; }
.tp-health.is-low i { background: #d5564b; }
.tp-health.is-heal i { animation: tp-heal 0.9s ease; }
@keyframes tp-heal { 0% { background: #ffe9ae; box-shadow: 0 0 8px #ffe9ae; } 100% { box-shadow: none; } }

.tp-statuses { position: absolute; left: var(--hud-m); bottom: calc(var(--hud-m) * 0.9); display: flex; flex-direction: column; gap: calc(var(--u) * 0.8); }
.tp-status { display: flex; align-items: center; gap: calc(var(--u) * 1.2); }
.tp-status .tp-label { width: calc(var(--u) * 8.5); }
.tp-status-bar { position: relative; width: calc(var(--u) * 12); height: 2px; background: rgba(221, 213, 196, 0.16); box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4); display: block; }
.tp-status-bar i { position: absolute; inset: 0; transform-origin: left center; }

.tp-save { position: absolute; right: var(--hud-m); bottom: var(--hud-m); opacity: 0; }
.tp-save i { width: calc(var(--u) * 0.9); height: calc(var(--u) * 0.9); background: var(--tp-ember); transform: rotate(45deg); box-shadow: 0 0 calc(var(--u) * 1.2) var(--tp-ember); }
.tp-save.is-on { animation: tp-save 2.2s ease both; }
@keyframes tp-save { 0% { opacity: 0; } 15%, 55% { opacity: 1; } 100% { opacity: 0; } }

/* ---- cards and toasts -------------------------------------------------------------------- */
.tp-cards, .tp-toasts { transition: opacity 0.3s; }
.tp-cards.is-off, .tp-toasts.is-off { opacity: 0; visibility: hidden; }
.tp-cards { position: absolute; inset: 0; text-shadow: var(--tp-shadow); }
.tp-card { position: absolute; left: 50%; top: 21%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; text-align: center; white-space: nowrap; animation: tp-card var(--life, 5.4s) ease both; }
@keyframes tp-card { 0% { opacity: 0; } 14% { opacity: 1; } 78% { opacity: 1; } 100% { opacity: 0; } }
.tp-card-icon { width: calc(var(--u) * 10); height: calc(var(--u) * 10); margin-bottom: calc(var(--u) * 1.2); filter: drop-shadow(0 0 0.8em rgba(0, 0, 0, 0.8)); }
.tp-card-icon .tp-icon { width: 100%; height: 100%; }
.tp-card-sign { width: calc(var(--u) * 7.4); height: calc(var(--u) * 7.4); color: var(--tp-bone); }
.tp-card-over { letter-spacing: 0.3em; margin-bottom: calc(var(--u) * 1); color: var(--tp-bone-2); }
.tp-card-name { font-family: var(--tp-display); font-weight: 500; font-size: var(--fs-h1); line-height: 1; letter-spacing: 0.16em; margin-right: -0.16em; text-transform: uppercase; animation: tp-card-name var(--life, 5.4s) ease-out both; }
@keyframes tp-card-name { 0% { letter-spacing: 0.26em; margin-right: -0.26em; } 40%, 100% { letter-spacing: 0.16em; margin-right: -0.16em; } }
.tp-card-rule { width: calc(var(--u) * 26); margin-top: calc(var(--u) * 1.5); color: var(--tp-bone-2); }
.tp-card-sub { font-family: var(--tp-display); font-style: italic; font-size: var(--fs-lead); margin-top: calc(var(--u) * 1.1); color: var(--tp-bone); white-space: normal; max-width: calc(var(--u) * 64); }
.tp-card[data-tone='discover'] .tp-card-name, .tp-card[data-tone='lantern'] .tp-card-name, .tp-card[data-tone='opus'] .tp-card-name { font-size: var(--fs-h2); }
.tp-card[data-tone='discover'] { top: 15%; }
.tp-card[data-tone='prime'] { top: 15%; }
.tp-card[data-tone='prime'] .tp-card-over, .tp-card[data-tone='lantern'] .tp-card-over, .tp-card[data-tone='opus'] .tp-card-over { color: var(--tp-ember-hot); }
.tp-card[data-tone='gloom'] .tp-card-over { color: #b9a3ee; }

.tp-toasts { position: absolute; left: var(--hud-m); bottom: calc(var(--u) * 10.5); display: flex; flex-direction: column; justify-content: flex-end; align-items: flex-start; gap: calc(var(--u) * 0.9); text-shadow: var(--tp-shadow); }
.tp-toast { display: flex; align-items: center; gap: calc(var(--u) * 1.2); padding: calc(var(--u) * 0.6) calc(var(--u) * 5) calc(var(--u) * 0.6) calc(var(--u) * 1.3); border-left: 1px solid var(--tp-bone-3); background: linear-gradient(90deg, rgba(4, 4, 6, 0.66), rgba(4, 4, 6, 0.3) 62%, rgba(4, 4, 6, 0)); animation: tp-toast-in 0.4s ease both; }
.tp-toast.is-out { animation: tp-toast-out 0.5s ease both; }
.tp-toast.is-bump .tp-toast-text { animation: tp-bump 0.5s ease; }
.tp-toast[data-kind='quest'], .tp-toast[data-kind='lore'] { border-left-color: var(--tp-ember); }
.tp-toast[data-kind='warn'] { border-left-color: #c9423c; }
.tp-toast-icon { width: calc(var(--u) * 4.2); height: calc(var(--u) * 4.2); }
.tp-toast-title { font-family: var(--tp-display); font-size: var(--fs-lead); font-weight: 500; line-height: 1.15; }
.tp-toast-text { font-size: var(--fs-small); color: var(--tp-bone-2); line-height: 1.35; max-width: calc(var(--u) * 46); }
.tp-toast-text:empty { display: none; }
@keyframes tp-toast-in { from { opacity: 0; transform: translateX(-1em); } to { opacity: 1; transform: none; } }
@keyframes tp-toast-out { from { opacity: 1; } to { opacity: 0; transform: translateX(-0.6em); } }

/* ---- cutscene bars, photo mode ----------------------------------------------------------- */
.tp-bars i { position: absolute; left: 0; right: 0; height: 9.5%; background: #000; transition: transform 0.9s ease; }
.tp-bars i:first-child { top: 0; transform: translateY(-101%); }
.tp-bars i:last-child { bottom: 0; transform: translateY(101%); }
.tp-bars.is-on i { transform: none; }
.tp-photo-bar { position: absolute; left: 50%; bottom: calc(var(--u) * 3.2); transform: translateX(-50%); display: flex; align-items: center; gap: calc(var(--u) * 3); white-space: nowrap; text-shadow: var(--tp-shadow); }
.tp-photo.is-on .tp-photo-bar { animation: tp-photo 8s ease both; }
@keyframes tp-photo { 0%, 70% { opacity: 1; } 100% { opacity: 0.3; } }
.tp-photo-name { color: var(--tp-bone); letter-spacing: 0.3em; }
.tp-foot-item { display: inline-flex; align-items: center; gap: 0.5em; }
.tp-foot-item .tp-label { margin-left: 0.35em; }

/* ---- the cauldron ------------------------------------------------------------------------ */
.tp-brew-veil { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(4, 4, 6, 0) 36%, rgba(4, 4, 6, 0.74) 57%, rgba(4, 4, 6, 0.92) 100%); }
.tp-brew-panel { position: absolute; right: 0; top: 0; bottom: 0; width: 42%; padding: calc(var(--u) * 3.2) calc(var(--u) * 4.4) calc(var(--u) * 2.8) calc(var(--u) * 1.6); display: flex; flex-direction: column; }
.tp-brew.is-on .tp-brew-panel { pointer-events: auto; }
.tp-brew-head { display: flex; align-items: center; justify-content: space-between; flex: none; }
.tp-pips { display: flex; gap: calc(var(--u) * 0.75); }
.tp-pips i { width: calc(var(--u) * 0.72); height: calc(var(--u) * 0.72); border: 1px solid var(--tp-bone-3); transform: rotate(45deg); transition: background 0.25s, border-color 0.25s; }
.tp-pips i.is-on { background: var(--tp-bone); border-color: var(--tp-bone); }
.tp-chart { position: relative; flex: 1 1 auto; min-height: 0; min-width: 0; }
.tp-chart-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.tp-brew-status { flex: none; text-align: center; min-height: calc(var(--fs-h3) * 1.2 + var(--fs-lead) * 1.5); display: flex; flex-direction: column; justify-content: flex-end; margin-top: calc(var(--u) * 0.4); }
.tp-brew-nameline { display: flex; align-items: center; justify-content: center; gap: calc(var(--u) * 1.6); }
.tp-brew-name { font-family: var(--tp-display); font-weight: 500; font-size: var(--fs-h3); letter-spacing: 0.04em; line-height: 1.15; }
.tp-marks { display: flex; gap: calc(var(--u) * 0.7); }
.tp-marks i { width: calc(var(--u) * 0.95); height: calc(var(--u) * 0.95); border: 1px solid var(--tp-bone-3); transform: rotate(45deg); }
.tp-marks i.is-on { background: var(--tp-bone); border-color: var(--tp-bone); }
.tp-brew-sub { font-family: var(--tp-display); font-style: italic; font-size: var(--fs-lead); color: var(--tp-bone-2); line-height: 1.3; margin-top: 0.15em; }
.tp-brew-status.is-ready .tp-brew-sub { color: var(--tp-bone); }

.tp-stages { flex: none; display: flex; justify-content: center; gap: calc(var(--u) * 2.4); margin-top: calc(var(--u) * 1.4); }
.tp-stage { display: flex; align-items: center; gap: calc(var(--u) * 0.8); opacity: 0.45; transition: opacity 0.3s; }
.tp-stage i { width: calc(var(--u) * 1.05); height: calc(var(--u) * 1.05); border-radius: 50%; border: 1px solid var(--c); transition: background 0.3s; }
.tp-stage.is-done { opacity: 0.8; }
.tp-stage.is-done i, .tp-stage.is-now i { background: var(--c); }
.tp-stage.is-now { opacity: 1; }
.tp-stage.is-now .tp-label { color: var(--tp-bone); }

.tp-gauge { flex: none; position: relative; margin: calc(var(--u) * 3.6) 5% 0; }
.tp-gauge-rail { position: relative; height: calc(var(--u) * 2.4); }
.tp-gauge-line { position: absolute; left: 0; right: 0; top: 50%; height: 1px; background: var(--tp-bone-3); }
.tp-gauge-ticks i { position: absolute; top: calc(50% - var(--u) * 0.3); width: 1px; height: calc(var(--u) * 0.6); background: var(--tp-bone-3); }
.tp-gauge-ticks i:first-child, .tp-gauge-ticks i:last-child { top: calc(50% - var(--u) * 0.6); height: calc(var(--u) * 1.2); }
.tp-gauge-band { position: absolute; top: calc(50% - var(--u) * 0.95); height: calc(var(--u) * 0.95); border: 1px solid var(--tp-ember); border-bottom: 0; background: rgba(226, 112, 44, 0.16); transition: left 0.5s ease, width 0.5s ease; }
.tp-gauge-word { position: absolute; bottom: calc(100% - var(--u) * 0.1); transform: translateX(-50%); font-family: var(--tp-display); font-style: italic; font-size: var(--fs-body); color: var(--tp-ember-hot); white-space: nowrap; line-height: 1; transition: left 0.5s ease; }
.tp-gauge-heat, .tp-gauge-key-heat { width: calc(var(--u) * 1.15); height: calc(var(--u) * 1.15); background: var(--tp-bone); transform: rotate(45deg); box-shadow: 0 0 0 1.5px var(--tp-ink); }
.tp-gauge-heat { position: absolute; top: 50%; margin: calc(var(--u) * -0.575) 0 0 calc(var(--u) * -0.575); transition: background 0.3s, box-shadow 0.3s; }
.tp-gauge-fire, .tp-gauge-key-fire { width: calc(var(--u) * 1.1); height: calc(var(--u) * 0.85); background: var(--tp-bone-2); clip-path: polygon(50% 0, 100% 100%, 0 100%); }
.tp-gauge-fire { position: absolute; top: calc(50% + var(--u) * 0.55); margin-left: calc(var(--u) * -0.55); }
.tp-gauge.is-in .tp-gauge-heat { background: var(--tp-ember-hot); box-shadow: 0 0 0 1.5px var(--tp-ink), 0 0 calc(var(--u) * 1.2) var(--tp-ember); }
.tp-gauge.is-cold .tp-gauge-heat { background: var(--tp-cold); }
.tp-gauge.is-hot .tp-gauge-heat { background: #e5503f; }
.tp-gauge-ends { display: flex; justify-content: space-between; align-items: center; margin-top: calc(var(--u) * 0.5); }
.tp-gauge-ends > .tp-label { color: var(--tp-bone-3); }
.tp-gauge-legend { display: flex; align-items: center; gap: calc(var(--u) * 0.8); }
.tp-gauge-legend .tp-label { color: var(--tp-bone-3); margin-right: calc(var(--u) * 1); }
.tp-gauge-legend i { transform: scale(0.72) rotate(45deg); box-shadow: none; }
.tp-gauge-legend i.tp-gauge-key-fire { transform: scale(0.8); }

.tp-shelf { flex: none; display: flex; flex-wrap: wrap; justify-content: center; gap: calc(var(--u) * 0.5) calc(var(--u) * 1.1); margin-top: calc(var(--u) * 2.6); min-height: calc(var(--u) * 5.6); }
.tp-shelf-item { position: relative; width: calc(var(--u) * 5.4); height: calc(var(--u) * 5.6); opacity: 0.8; transition: opacity 0.15s, transform 0.2s ease; }
.tp-shelf-item .tp-icon { width: calc(var(--u) * 5.4); height: calc(var(--u) * 5.4); }
.tp-shelf-item:hover:not(:disabled), .tp-shelf-item:focus-visible { opacity: 1; transform: translateY(calc(var(--u) * -0.5)); }
.tp-shelf-item:disabled { opacity: 0.3; }
.tp-shelf-item.is-prime .tp-icon { color: var(--tp-ember-hot); }
.tp-shelf-n { position: absolute; right: -0.1em; bottom: 0; font-size: var(--fs-small); font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1; text-shadow: var(--tp-shadow); }
.tp-shelf-empty { font-family: var(--tp-display); font-style: italic; font-size: var(--fs-lead); color: var(--tp-bone-3); align-self: center; }
.tp-shelf-info { flex: none; height: calc(var(--fs-lead) * 1.5); margin-top: calc(var(--u) * 0.5); display: flex; justify-content: center; align-items: baseline; gap: 0.8em; white-space: nowrap; overflow: hidden; }
.tp-shelf-info-name { font-family: var(--tp-display); font-size: var(--fs-lead); font-weight: 500; }
.tp-shelf-info-text { font-family: var(--tp-display); font-style: italic; font-size: var(--fs-body); color: var(--tp-bone-2); overflow: hidden; text-overflow: ellipsis; }

.tp-keys { flex: none; display: flex; flex-wrap: wrap; justify-content: center; gap: calc(var(--u) * 0.9) calc(var(--u) * 2.2); margin-top: calc(var(--u) * 1.4); padding-top: calc(var(--u) * 1.6); border-top: 1px solid var(--tp-line-2); }
.tp-keybtn { display: inline-flex; align-items: center; gap: 0.65em; transition: opacity 0.2s; }
.tp-keybtn .tp-label { transition: color 0.15s; }
.tp-keybtn:hover:not(:disabled) .tp-label, .tp-keybtn.is-down .tp-label { color: var(--tp-bone); }
.tp-keybtn.is-down .tp-key { background: var(--tp-bone); color: var(--tp-ink); }
.tp-keybtn:disabled { opacity: 0.32; }
.tp-keybtn.is-call .tp-key { border-color: var(--tp-ember); color: var(--tp-ember-hot); }
.tp-keybtn.is-call .tp-label { color: var(--tp-bone); }
.tp-brew-stir { position: absolute; left: 29%; bottom: 9%; transform: translateX(-50%); font-family: var(--tp-display); font-style: italic; font-size: var(--fs-lead); text-shadow: var(--tp-shadow); white-space: nowrap; opacity: 0; transition: opacity 0.6s; }
.tp-brew-stir.is-on { opacity: 0.92; }

/* ---- the book ---------------------------------------------------------------------------- */
.tp-book { background: var(--tp-veil-deep); display: flex; flex-direction: column; align-items: center; padding: calc(var(--u) * 4.4) calc(var(--u) * 6) calc(var(--u) * 2.8); }
.tp-book.is-on, .tp-reader.is-on, .tp-menuscreen.is-on, .tp-dead.is-on, .tp-loading.is-on { pointer-events: auto; }
.tp-tabs { flex: none; display: flex; align-items: center; gap: calc(var(--u) * 2.4); }
.tp-tab { position: relative; font-family: var(--tp-display); font-weight: 500; font-size: var(--fs-h3); letter-spacing: 0.05em; line-height: 1.1; color: var(--tp-bone-3); padding: 0.1em 0 0.34em; transition: color 0.2s; }
.tp-tab:hover { color: var(--tp-bone-2); }
.tp-tab.is-sel { color: var(--tp-bone); }
.tp-tab::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 1px; background: var(--tp-ember); transform: scaleX(0); transition: transform 0.3s ease; }
.tp-tab.is-sel::after { transform: scaleX(1); }
.tp-tab-sep { color: var(--tp-line); font-size: var(--fs-body); }
.tp-spread { position: relative; flex: 1 1 auto; min-height: 0; width: min(100%, calc(var(--u) * 150)); display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); column-gap: calc(var(--u) * 10); margin: calc(var(--u) * 4) 0 calc(var(--u) * 2.4); }
.tp-spread::before { content: ''; position: absolute; left: 50%; top: 1%; bottom: 1%; width: 1px; background: var(--tp-line-2); }
.tp-spread[data-tab='map'] { grid-template-columns: minmax(0, 1.22fr) minmax(0, 0.78fr); }
.tp-spread[data-tab='map']::before { left: 61%; }
.tp-page { min-width: 0; min-height: 0; overflow: hidden auto; scrollbar-width: thin; scrollbar-color: var(--tp-line) transparent; padding-right: 0.5em; }
.tp-spread.is-turn .tp-page { animation: tp-turn 0.45s ease both; }
.tp-spread.is-turn .tp-page-r { animation-delay: 0.06s; }
@keyframes tp-turn { from { opacity: 0; transform: translateY(0.5em); } to { opacity: 1; transform: none; } }
.tp-page-label { margin: 2.4em 0 0.8em; }
.tp-page-label:first-child { margin-top: 0; }
.tp-page-chart, .tp-page-map { overflow: hidden; display: flex; padding-right: 0; }
.tp-page-chart .tp-chart { flex: 1 1 auto; }
.tp-book-foot { flex: none; display: flex; gap: calc(var(--u) * 3.4); }

.tp-hunts { margin-top: calc(var(--u) * 3.6); display: flex; flex-direction: column; gap: calc(var(--u) * 2); }
.tp-hunt { display: flex; align-items: flex-start; gap: calc(var(--u) * 1.8); }
.tp-hunt .tp-sign { width: calc(var(--u) * 4.2); height: calc(var(--u) * 4.2); flex: none; color: var(--tp-bone-2); margin-top: 0.2em; }
.tp-hunt .tp-small { color: var(--tp-bone-2); margin-top: 0.2em; max-width: 30em; }
.tp-hunt.is-got .tp-sign { color: var(--tp-ember-hot); }
.tp-hunt.is-got .tp-h3 { color: var(--tp-bone-2); }
.tp-hunt .tp-sign .tp-icon { width: 100%; height: 100%; }
.tp-done { display: flex; flex-direction: column; gap: 0.3em; max-width: 34em; }
.tp-done-row { display: flex; align-items: baseline; gap: 0.9em; font-family: var(--tp-display); font-size: calc(var(--fs-lead) * 0.9); line-height: 1.3; color: var(--tp-bone-3); }
.tp-done-row .tp-loz { font-size: 0.72em; flex: none; transform: translateY(-0.2em) rotate(45deg); color: var(--tp-bone-3); }
.tp-known { display: flex; flex-direction: column; max-width: 26em; }
.tp-known-row { display: flex; align-items: baseline; gap: 0.7em; font-family: var(--tp-display); font-size: var(--fs-lead); padding: 0.14em 0; }
.tp-known-row i { flex: 1; border-bottom: 1px dotted var(--tp-bone-3); transform: translateY(-0.28em); }
.tp-known-row .tp-num { font-family: var(--tp-sans); font-size: var(--fs-small); color: var(--tp-bone-2); }

.tp-list { display: flex; flex-direction: column; }
.tp-row { position: relative; display: flex; align-items: baseline; gap: 0.9em; width: 100%; padding: 0.36em 0.3em 0.36em 1.25em; font-family: var(--tp-display); font-size: var(--fs-lead); line-height: 1.2; color: var(--tp-bone-2); border-bottom: 1px solid var(--tp-line-2); transition: color 0.15s; }
.tp-row::before, .tp-set-row::before, .tp-menu-item::before { content: ''; position: absolute; left: 0.2em; top: 50%; width: 0.34em; height: 0.34em; background: var(--tp-ember); transform: translateY(-50%) rotate(45deg) scale(0); transition: transform 0.22s ease; }
.tp-row.is-sel { color: var(--tp-bone); }
.tp-row.is-sel::before, .tp-set-row.is-sel::before, .tp-menu-item.is-sel::before { transform: translateY(-50%) rotate(45deg) scale(1); }
.tp-row.is-unknown { color: rgba(221, 213, 196, 0.26); font-style: italic; }
.tp-row-key { font-family: var(--tp-sans); font-size: var(--fs-micro); color: var(--tp-bone-3); width: 1em; flex: none; }
.tp-row-name { flex: 1 1 auto; min-width: 0; }
.tp-row-n { font-family: var(--tp-sans); font-size: var(--fs-small); color: var(--tp-bone-2); flex: none; }
.tp-row-n.tp-label { font-size: var(--fs-micro); color: var(--tp-bone-3); }
.tp-row-lantern { align-items: center; }
.tp-row-lantern.is-lit .tp-row-n { color: var(--tp-ember-hot); }
.tp-row-glyph { width: 1.5em; height: 1.5em; flex: none; }
.tp-row-lantern:not(.is-lit) { color: var(--tp-bone-3); }
.tp-row-lantern:not(.is-lit).is-sel { color: var(--tp-bone-2); }
.tp-detail { margin-top: calc(var(--u) * 3); }
.tp-detail-top { display: flex; align-items: center; gap: calc(var(--u) * 2.4); }
.tp-detail-icon { width: calc(var(--u) * 11); height: calc(var(--u) * 11); }
.tp-facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1.2em; margin-top: 1.7em; }
.tp-facts .tp-page-label { margin: 0 0 0.45em; }
.tp-facts-ing { grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); }
.tp-facts-ing .tp-fact + .tp-page-label { margin-top: 1.4em; }
.tp-fact { font-family: var(--tp-display); font-size: var(--fs-lead); line-height: 1.25; }
.tp-mini { width: 100%; max-width: calc(var(--u) * 17); display: block; }
.tp-mini path { fill: none; vector-effect: non-scaling-stroke; }
.tp-mini-tri { stroke: var(--tp-bone-2); stroke-width: 1px; }
.tp-mini-sign { stroke: var(--tp-bone-3); stroke-width: 1px; stroke-linecap: round; stroke-linejoin: round; }
#ui.tp .tp-mini-mark { fill: var(--tp-ember-hot); stroke: var(--tp-ink); stroke-width: 1px; }

.tp-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: calc(var(--u) * 0.8); }
.tp-cell { position: relative; display: flex; flex-direction: column; align-items: center; gap: calc(var(--u) * 0.5); padding: calc(var(--u) * 1.5) 0.3em calc(var(--u) * 1.2); color: var(--tp-bone-2); box-shadow: inset 0 0 0 1px transparent; transition: color 0.15s, box-shadow 0.2s; }
.tp-cell .tp-icon { width: calc(var(--u) * 8.4); height: calc(var(--u) * 8.4); transition: transform 0.25s ease; }
.tp-cell-name { font-family: var(--tp-display); font-size: var(--fs-lead); line-height: 1.1; text-align: center; }
.tp-cell-n { position: absolute; right: calc(var(--u) * 1.2); top: calc(var(--u) * 1); font-size: var(--fs-small); font-weight: 600; color: var(--tp-bone-2); }
.tp-cell.is-sel { color: var(--tp-bone); box-shadow: inset 0 0 0 1px var(--tp-line); }
.tp-cell.is-sel .tp-icon { transform: scale(1.06); }
.tp-cell.is-unknown { color: rgba(221, 213, 196, 0.24); font-style: italic; }
.tp-cell.is-unknown .tp-icon { align-items: center; justify-content: center; font-size: var(--fs-h3); }

.tp-lore { max-width: 32em; font-family: var(--tp-display); font-size: var(--fs-lead); }
.tp-lore-title { font-size: var(--fs-h2); font-weight: 500; line-height: 1.12; letter-spacing: 0.01em; text-wrap: balance; }
.tp-lore-rule { width: 9em; margin: 1em 0 1.2em; }
#ui.tp .tp-lore-body p { margin: 0 0 0.8em; font-style: italic; line-height: 1.44; text-wrap: pretty; }
.tp-lore-sign { text-align: right; font-style: italic; font-size: 1.2em; margin-top: 1em; padding-right: 1.4em; }
.tp-lore-reveal { display: flex; align-items: center; gap: 0.9em; margin-top: 1.8em; color: var(--tp-ember); font-size: var(--fs-micro); }
.tp-lore-reveal .tp-label { color: var(--tp-ember-hot); }
.tp-list-lore .tp-row { font-style: italic; }

.tp-map { flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; align-items: center; justify-content: center; }
.tp-map-canvas { display: block; }
.tp-map-act { margin-top: 1.6em; min-height: 2.6em; }
.tp-act { display: inline-flex; align-items: center; gap: 0.9em; }
.tp-act-text { font-family: var(--tp-display); font-size: var(--fs-lead); }
.tp-act:hover .tp-key { border-color: var(--tp-ember); color: var(--tp-ember-hot); }
.tp-map-note { margin-top: 2em; max-width: 26em; }

/* ---- the lore reader --------------------------------------------------------------------- */
.tp-reader { background: var(--tp-veil-deep); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: calc(var(--u) * 3); padding: calc(var(--u) * 5); }
.tp-reader-sheet { max-height: 80%; overflow: hidden auto; scrollbar-width: thin; scrollbar-color: var(--tp-line) transparent; padding: calc(var(--u) * 5) calc(var(--u) * 7) calc(var(--u) * 4.4); border: 1px solid var(--tp-line-2); background: #0b0b0d; }
.tp-reader.is-on .tp-reader-sheet { animation: tp-turn 0.6s ease both; }
.tp-reader-done, .tp-dead-rise, .tp-credits-go { display: inline-flex; align-items: center; gap: 0.8em; }
.tp-reader-done:hover .tp-label, .tp-dead-rise:hover .tp-label, .tp-credits-go:hover .tp-label { color: var(--tp-bone); }

/* ---- menu screens: title, pause ---------------------------------------------------------- */
.tp-title::before { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, rgba(4, 4, 6, 0.84) 0%, rgba(4, 4, 6, 0.6) 28%, rgba(4, 4, 6, 0) 62%), linear-gradient(0deg, rgba(4, 4, 6, 0.6), rgba(4, 4, 6, 0) 42%); }
.tp-title.has-pane::before { background: linear-gradient(90deg, rgba(4, 4, 6, 0.9), rgba(4, 4, 6, 0.82)); }
.tp-pause { background: var(--tp-veil); }
.tp-menu-col { position: absolute; left: calc(var(--u) * 9); bottom: calc(var(--u) * 9.5); display: flex; flex-direction: column; align-items: flex-start; transition: opacity 0.3s; }
.tp-pause .tp-menu-col { bottom: auto; top: 50%; transform: translateY(-50%); }
.tp-menuscreen.has-pane .tp-menu-col { opacity: 0.3; }
.tp-title-head, .tp-pause-head { display: flex; flex-direction: column; align-items: flex-start; }
.tp-title-over { letter-spacing: 0.36em; margin-bottom: calc(var(--u) * 1.3); }
.tp-wordmark { font-family: var(--tp-display); font-weight: 500; font-size: var(--fs-mark); line-height: 0.95; letter-spacing: 0.2em; text-transform: uppercase; white-space: nowrap; text-shadow: 0 0 1.4em rgba(0, 0, 0, 0.7); }
.tp-wordmark-s { font-size: var(--fs-h2); letter-spacing: 0.36em; margin-right: -0.36em; }
.tp-title-rule { width: calc(var(--u) * 28); margin-top: calc(var(--u) * 2.6); }
.tp-pause-head .tp-h1 { margin-top: 0.2em; letter-spacing: 0.06em; }
.tp-menu { margin-top: calc(var(--u) * 3.4); display: flex; flex-direction: column; align-items: flex-start; gap: calc(var(--u) * 0.45); }
.tp-menu-item { position: relative; font-family: var(--tp-display); font-size: var(--fs-h3); font-weight: 500; letter-spacing: 0.04em; line-height: 1.3; color: var(--tp-bone-2); padding: 0 0.6em 0 0; transition: color 0.2s, padding 0.25s ease; text-shadow: var(--tp-shadow); }
.tp-menu-item::before { left: 0.05em; }
.tp-menu-item.is-sel { color: var(--tp-bone); padding-left: 0.95em; padding-right: 0; }
.tp-menu-item:disabled { color: var(--tp-bone-3); }
.tp-title-ver { position: absolute; right: calc(var(--u) * 3.4); bottom: calc(var(--u) * 2.8); color: var(--tp-bone-3); }

.tp-sigil { display: block; overflow: visible; }
.tp-sigil path { fill: none; stroke-linecap: round; stroke-linejoin: round; }
.tp-sigil-track { stroke: var(--tp-line); stroke-width: 0.7; }
.tp-sigil-ink { stroke: var(--tp-bone); stroke-width: 0.9; stroke-dasharray: 1; stroke-dashoffset: 1; transition: stroke-dashoffset 0.7s ease; }
.tp-sigil-sign { stroke: rgba(221, 213, 196, 0.26); stroke-width: 1.15; transition: stroke 0.7s ease; }
.tp-sigil-sign.is-on, .tp-sigil.is-full .tp-sigil-sign { stroke: var(--tp-bone); }
.tp-sigil-heart { stroke: var(--tp-bone-3); stroke-width: 0.7; transition: fill 0.7s ease, stroke 0.7s ease; }
#ui.tp .tp-sigil-heart.is-on, #ui.tp .tp-sigil.is-full .tp-sigil-heart { fill: var(--tp-ember); stroke: var(--tp-ember); }
.tp-sigil.is-full .tp-sigil-ink { stroke-dashoffset: 0; }
.tp-sigil-title { width: calc(var(--u) * 14.5); margin: 0 0 calc(var(--u) * 2.6) calc(var(--u) * -1.2); }
.tp-sigil-title .tp-sigil-ink { stroke-width: 1.5; }
.tp-sigil-title .tp-sigil-sign { stroke-width: 1.9; }
.tp-sigil-title .tp-sigil-track { stroke: none; }

.tp-pane-host { position: absolute; left: 47%; right: calc(var(--u) * 7); top: 0; bottom: 0; display: flex; align-items: center; pointer-events: none; }
.tp-menuscreen.is-on .tp-pane { pointer-events: auto; }
.tp-pane { width: 100%; max-width: calc(var(--u) * 72); max-height: 90%; display: flex; flex-direction: column; animation: tp-turn 0.35s ease both; text-shadow: var(--tp-shadow); }
.tp-pane-title { flex: none; margin-bottom: 0.5em; }
.tp-pane-foot { flex: none; display: flex; align-items: center; gap: 0.8em; margin-top: calc(var(--u) * 2.2); }
.tp-set-body { min-height: 0; overflow: hidden auto; scrollbar-width: thin; scrollbar-color: var(--tp-line) transparent; padding-right: 0.6em; }
.tp-set-group { margin: 1.5em 0 0.45em; color: var(--tp-bone-3); }
.tp-set-group:first-child { margin-top: 0; }
.tp-set-row { position: relative; display: grid; grid-template-columns: minmax(0, 0.82fr) minmax(0, 1.18fr); align-items: center; column-gap: 1.4em; padding: 0.2em 0 0.2em 1.2em; color: var(--tp-bone-2); transition: color 0.15s; }
.tp-set-row.is-sel { color: var(--tp-bone); }
.tp-set-label { font-family: var(--tp-display); font-size: var(--fs-lead); line-height: 1.25; }
.tp-set-ctl { display: flex; align-items: center; gap: 1.1em; min-width: 0; }
.tp-range { flex: 1 1 auto; height: 1.9em; display: flex; align-items: center; cursor: pointer; touch-action: none; }
.tp-range-track { position: relative; width: 100%; height: 1px; background: var(--tp-line); }
.tp-range-track i { position: absolute; inset: 0; background: var(--tp-bone-2); transform-origin: left center; }
.tp-range-track b { position: absolute; top: 50%; width: 0.64em; height: 0.64em; margin: -0.32em 0 0 -0.32em; background: var(--tp-ink); border: 1px solid var(--tp-bone); transform: rotate(45deg); transition: background 0.15s, border-color 0.15s; }
.tp-set-row.is-sel .tp-range-track b { background: var(--tp-ember); border-color: var(--tp-ember); }
.tp-set-val { flex: none; width: 3.8em; text-align: right; font-size: var(--fs-small); color: var(--tp-bone-2); }
.tp-choice { gap: 1.5em; }
.tp-opt { font-size: var(--fs-small); letter-spacing: 0.08em; color: var(--tp-bone-3); padding: 0.3em 0 0.22em; border-bottom: 1px solid transparent; transition: color 0.15s, border-color 0.15s; }
.tp-opt:hover { color: var(--tp-bone-2); }
.tp-opt.is-on { color: var(--tp-bone); border-bottom-color: var(--tp-ember); }
.tp-ctl-cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); column-gap: calc(var(--u) * 5); min-height: 0; overflow: hidden auto; }
.tp-ctl-row { display: flex; align-items: center; gap: 1em; padding: 0.24em 0; }
.tp-ctl-keys { display: inline-flex; align-items: center; gap: 0.3em; flex: none; min-width: calc(var(--fs-micro) * 9.6); }
.tp-ctl-join { color: var(--tp-bone-3); font-size: var(--fs-small); }
.tp-ctl-what { font-family: var(--tp-display); font-size: var(--fs-lead); line-height: 1.2; color: var(--tp-bone-2); }
.tp-confirm-text { font-family: var(--tp-display); font-style: italic; font-size: var(--fs-h3); line-height: 1.3; max-width: 20em; }
.tp-confirm .tp-menu { margin-top: calc(var(--u) * 2.4); }

/* ---- loading ----------------------------------------------------------------------------- */
.tp-loading { background: var(--tp-ink); }
.tp-loading-inner { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.tp-sigil-load { width: clamp(130px, calc(var(--u) * 25), 330px); }
.tp-loading .tp-wordmark-s { margin-top: calc(var(--u) * 3); }
.tp-loading-label { margin-top: calc(var(--u) * 1.6); color: var(--tp-bone-3); letter-spacing: 0.3em; }

/* ---- death ------------------------------------------------------------------------------- */
.tp-dead { background: radial-gradient(ellipse at center, rgba(12, 6, 22, 0.74) 0%, rgba(4, 2, 8, 0.97) 76%); display: flex; align-items: center; justify-content: center; }
.tp-dead.is-on { transition-duration: 1.6s; }
.tp-dead-inner { display: flex; flex-direction: column; align-items: center; gap: calc(var(--u) * 2.6); }
.tp-dead-line { font-family: var(--tp-display); font-weight: 500; font-size: var(--fs-h1); letter-spacing: 0.08em; line-height: 1; text-align: center; }
.tp-dead.is-on .tp-dead-line { animation: tp-dead-in 3s ease both; }
@keyframes tp-dead-in { 0% { opacity: 0; letter-spacing: 0.2em; } 100% { opacity: 1; letter-spacing: 0.08em; } }
.tp-dead-rule { width: calc(var(--u) * 26); }
.tp-dead-rise { opacity: 0; }
.tp-dead.is-on .tp-dead-rise { animation: tp-fade 1s ease 1.5s both; }
.tp-dead.is-on .tp-dead-rule { animation: tp-fade 1.4s ease 0.8s both; }
@keyframes tp-fade { from { opacity: 0; } to { opacity: 1; } }

/* ---- ending ------------------------------------------------------------------------------ */
.tp-ending { display: flex; align-items: center; justify-content: center; }
.tp-ending[data-phase='credits'] { background: var(--tp-veil-deep); }
.tp-ending[data-phase='credits'].is-on { pointer-events: auto; }
.tp-ending-text { position: absolute; left: 8%; right: 8%; bottom: 17%; display: grid; justify-items: center; text-align: center; text-shadow: var(--tp-shadow); }
.tp-ending-text:empty, .tp-credits:empty { display: none; }
#ui.tp .tp-ending-text p { grid-area: 1 / 1; font-family: var(--tp-display); font-size: var(--fs-h3); font-style: italic; line-height: 1.3; max-width: 30em; opacity: 0; animation: tp-line 3.4s ease both; }
#ui.tp .tp-ending-text p:last-child { animation-name: tp-line-stay; font-style: normal; font-size: var(--fs-h2); letter-spacing: 0.04em; }
@keyframes tp-line { 0% { opacity: 0; } 22% { opacity: 1; } 80% { opacity: 1; } 100% { opacity: 0; } }
@keyframes tp-line-stay { 0% { opacity: 0; } 30%, 100% { opacity: 1; } }
.tp-credits { display: flex; flex-direction: column; align-items: center; text-align: center; max-width: calc(var(--u) * 62); animation: tp-turn 1.2s ease both; }
.tp-credits .tp-sigil-title { margin-left: 0; }
.tp-credits .tp-wordmark { font-size: var(--fs-h1); margin-right: -0.2em; }
.tp-credits .tp-title-rule { margin-bottom: calc(var(--u) * 1.4); }
.tp-credits-label { margin: calc(var(--u) * 3) 0 calc(var(--u) * 0.9); color: var(--tp-bone-3); }
.tp-credits-stats { width: calc(var(--u) * 40); max-width: 100%; text-align: left; }
.tp-credits-go { margin-top: calc(var(--u) * 3.4); }

/* ---- small and narrow views -------------------------------------------------------------- */
/* 900 x 600: type has hit its floor, so the pages keep a tighter rhythm to stay on one sheet */
@media (max-height: 690px) {
  .tp-book { padding-top: calc(var(--u) * 3.4); }
  .tp-spread { margin-top: calc(var(--u) * 3); column-gap: calc(var(--u) * 8); }
  .tp-row { padding-top: 0.2em; padding-bottom: 0.2em; }
  .tp-detail { margin-top: calc(var(--u) * 1.8); }
  #ui.tp p.tp-body { margin-top: 0.5em; }
  .tp-facts { margin-top: 1em; }
  .tp-page-label { margin-top: 1.5em; }
  .tp-hunts { margin-top: calc(var(--u) * 2.6); gap: calc(var(--u) * 1.5); }
}
/* narrower than 16:10 the wordmark would run under an open pane: it steps away while one is up */
.tp-title-head { transition: opacity 0.3s; }
@media (max-aspect-ratio: 8/5) {
  .tp-title.has-pane .tp-title-head { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .tp-layer, .tp-layer.is-on { transition-duration: 0.01s; }
  .tp-card, .tp-card-name, .tp-toast, .tp-spread.is-turn .tp-page, .tp-pane, .tp-credits, .tp-vig-gloom i, .tp-obj.is-new .tp-obj-text, .tp-slot.is-bump, .tp-reader.is-on .tp-reader-sheet, .tp-photo.is-on .tp-photo-bar { animation: none !important; }
  #ui.tp .tp-ending-text p { animation: none; opacity: 0; }
  #ui.tp .tp-ending-text p:last-child { opacity: 1; }
  .tp-dead.is-on .tp-dead-line, .tp-dead.is-on .tp-dead-rise, .tp-dead.is-on .tp-dead-rule { animation: none; opacity: 1; }
  .tp-bars i, .tp-menu-item, .tp-slot { transition: none; }
}
`;
