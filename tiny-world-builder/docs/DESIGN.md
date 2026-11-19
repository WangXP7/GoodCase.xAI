# TinyWorld UI Design System

The de facto system extracted from `styles/tiny-world.css` (June 2026). This is
descriptive, not aspirational: every value below is what the shipped CSS does.
New controls and panels must reuse these tokens and recipes rather than invent
local values. (PORT-NOTES.md rule: "new components reuse the existing vars".)

## Identity

Warm parchment world, frosted-glass chrome. The 3D diorama is the hero; UI
floats above it as translucent white glass cards with soft warm shadows. One
blue accent. Pixel-game typography only for toolbar labels and deliberate
retro accents — body UI is clean Inter.

## Color tokens (`:root`, tiny-world.css ~28)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#f4ede0` | page fallback, warm parchment |
| `--panel` | `#ffffff` | opaque panel base (rare; most surfaces are glass) |
| `--ink` | `#2a2722` | primary text |
| `--muted` | `#6f695f` | secondary text, labels, hints |
| `--line` | `#ebe3d2` | borders/dividers on opaque surfaces |
| `--line-soft` | `#f3ecdc` | subtle dividers |
| `--accent` | `#3a72c8` | THE blue: active states, focus, links, selection |
| `--shadow` | layered warm shadow | default card shadow (see token) |

Do not introduce new hex colors for chrome. Semantic exceptions that already
exist: success/danger reds-greens inside specific widgets, and the warm
highlight `#ffcf99`-family used by 3D overlays (brush rings etc.), which is a
scene color, not a UI color.

## Radius scale (`:root`, tiny-world.css ~3877)

| Token | Value | Use (from the source comments) |
|---|---|---|
| `--radius-sm` | 6px | tiny chips, swatches |
| `--radius-md` | 10px | buttons, inputs, small controls |
| `--radius-lg` | 14px | cards inside modals, options, panels |
| `--radius-xl` | 20px | main modal cards |

Toolbar tool buttons are the one sanctioned outlier (16px, between lg and xl).

## Typography

- Body/UI: `'Inter', system-ui, -apple-system, sans-serif`, 13px is the
  standard panel/control size; labels often `font-weight: 500`.
- Pixel accents: `'Pixelify Sans'` (toolbar tool labels, 11px) and
  `'Press Start 2P'` via `.tw-pixel-font` (deliberate retro headings only).
  Both are self-hosted `@font-face` at the top of the stylesheet.
- Never mix pixel fonts into body copy or form controls.

## The glass surface recipe

All floating chrome (modals, panels, HUD cards) follows one recipe — copy it,
do not approximate it:

```css
background: rgba(255, 255, 255, 0.45);        /* .45 inputs, .6 modal cards */
border: 1px solid rgba(255, 255, 255, 0.55);
border-radius: var(--radius-lg);               /* or -xl for top-level cards */
backdrop-filter: blur(10px) saturate(180%);    /* 10px controls, 22px cards */
-webkit-backdrop-filter: /* same */;
box-shadow:
  0 1px 0 rgba(255, 255, 255, 0.85) inset,     /* white top highlight */
  0 1px 2px rgba(20, 30, 50, 0.05),            /* contact shadow */
  0 24px 56px -16px rgba(40, 50, 80, 0.30);    /* ambient (cards only) */
```

Notes:
- The inset white top-highlight is what makes it read as glass; do not omit it.
- Backdrop-filter is expensive. Do not add new full-viewport blurred layers;
  the tilt-shift overlay (`body::before`) already exists and is gated off when
  the setting is 0. Keep blur on bounded cards only.

## Controls

- Button (`.btn`): transparent at rest, `padding: 9px 14px`,
  `border-radius: var(--radius-md)`, 13px/500. Hover = `rgba(255,255,255,.55)`
  fill; active = `translateY(1px)`; selected (`.on`) = `.78` white fill +
  white border. Transition `background 0.12s, transform 0.08s`.
- Inputs/selects/textareas: the glass recipe at `.45` alpha, `border-radius:
  10px`, `padding: 8px 10px`, inherit font, `--ink` text on `--muted` labels.
- Toggle switches (checkboxes): 38x22 track, 16px thumb as `::before`,
  checked track = accent blue at `.85`. The thumb animates with
  `transform: translateX(16px)` — never `left` (layout property).
- Toolbar tools (`.tool`): 52x50, radius 16px, Pixelify Sans 11px labels,
  muted `#8d887d` at rest, accent treatment when active.

## Motion

- Standard transition: **0.12s** (hover fills, color shifts) — 60+ uses.
- Press feedback: **0.08s** transform.
- Switches/slides: **0.18s** with `cubic-bezier(0.22, 1, 0.36, 1)`.
- Panel show/hide: 0.28-0.32s transform+opacity with the same spring curve.
- HARD RULE: animate `transform` and `opacity` only. Never animate
  `top/left/width/height` (forces layout per frame — we removed the last
  offenders in June 2026).

## Icons

- Inline SVG glyphs only, `stroke="currentColor"`, typically 16-24px viewBox
  24. NEVER reintroduce the retired PNG baked-icon system.
- No emoji anywhere: UI text, labels, code, comments, commits.

## Dark theme (known gap)

`body.ui-theme-dark` exists but is implemented as per-component overrides
(~tiny-world.css 451+), not via the token block. Until the tokens are themed,
any new component MUST ship its own `body.ui-theme-dark` override pair or it
will render light-on-light. This is the weakest part of the system and the
first candidate for a refactor (swap the `:root` values under the class).

## Layering

Loose convention, low to high: scene canvas at base; scene-coupled DOM
overlays (cloud layer, tilt blur, tint) z-index 7-9; HUD panels/toolbars in
the tens; modal overlays 50; minimap/roster ~70-96; command palette and stats
overlay 9000+. Pick the band that matches the component's role; do not exceed
9100.

## Where things live

- Tokens + all component CSS: `styles/tiny-world.css` (single file, ~8.6k
  lines; sections are dash-labelled comments).
- Markup: `tiny-world-builder.html`; panels are wired in
  `engine/world/30-ui-boot-wiring.js` and `19-tools-toolbar.js`.
- i18n: user-facing strings go through `t()`/`tx()` — see `docs/i18n.md`.
