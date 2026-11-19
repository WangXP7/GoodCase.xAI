# Builder Mode — Game-Designer Feedback: Root Causes & Plan

Source: playtest feedback from a game designer (learning game design). Scope: **builder mode** only.
Investigation: read-only audit of the builder UI (2 parallel agents). Every claim below is backed by file:line evidence.

---

## TL;DR

| # | Feedback | Verdict | Root cause | Effort |
|---|----------|---------|------------|--------|
| 1 | No tutorial / "what am I supposed to do?" | **Accurate, structural** | No onboarding subsystem exists at all | Medium |
| 2 | Materials need icons | **Accurate** | Materials render as text-only chips; no icon metadata | Small |
| 3 | "Layers" is confusing | **Accurate (mislabel)** | It's a scene outliner/inventory wearing a Photoshop name | Small |
| 4 | Size only grows, can't shrink | **Half-true** | Shrink *exists* but is undiscoverable; repeat-click only grows | Small–Medium |
| 5 | Some buttons don't work | **Accurate** | Buttons shown in contexts where they silently no-op; no feedback | Small–Medium |

Builder entry: Welcome modal → **Build** → `chooseWelcomeMode('build')` → `setPlayModeActive(false)` toggles `body.tw-play-mode` off, revealing builder chrome.
- `engine/world/30-ui-boot-wiring.js:55-72`, `:2982-3013`
- Launcher markup: `tiny-world-builder.html:791-807`

---

## 1. Tutorial / Onboarding — *none exists*

**What happens to a new Build user, in order:**
1. Welcome modal: logo + four mode buttons + author credit. Explains nothing. `tiny-world-builder.html:791-807`
2. A **keyboard/camera controls** cheat-sheet (Orbit/Pan/Zoom/Select/Tools 1–9/Reset) — the *only* first-run help, and it's controls, not gameplay. `engine/world/24-crop-duster-banners.js:222-288` (rows at `:246-253`, shown-once logic `:281-283`)
3. An effectively empty grass world (empty-state copy "Default grass — place terrain or objects." `engine/world/32-layers-panel.js:370`)

**Root cause:** there is no tutorial code anywhere. A repo-wide search for `tutorial|onboarding|first-run|how to play|getting started` returns one hit — the unimplemented label `'worlds.help': 'How to play'` at `engine/i18n/en.js:74`. The concept was named, never built.

**Plan:**
- **1a (quick win):** Replace the controls-only tips card with a 3–4 step "core loop" coach card: *Pick a tool → place terrain/objects → select to edit → switch to Play to walk your world.* Reuse the existing dismiss-once banner mechanism in `24-crop-duster-banners.js` so there's no new subsystem.
- **1b (fuller):** A skippable first-run overlay sequence (objective + one guided placement). Larger; do after 1a validates the framing.
- i18n: all new strings must go through `engine/i18n/*` (see the tinyworld-i18n skill; run `npm run i18n:check`).

---

## 2. Material icons

**Current state:** material set `Default, Brick, Stone, Rock, Slate, Wood, Grass, Dirt, Sand` defined at `engine/world/28-generate-panel-agent.js:1311` (used by `objectMaterial`/`bodyMaterial`/`topMaterial` rows at `:2171`). They render as **text-only chips** — the chip renderer only draws a swatch when both `row.color && opt.color` exist (`:2493`), and material rows supply neither; `optionGlyph()` falls back to the text label (`:2371`). The Settings material `<select>` is also plain text (`tiny-world-builder.html:1190`, options filled at `engine/world/21-object-transform-voxel-build.js:169`).

**Feasibility:** there is already an SVG-glyph icon system — `toolbarIconSvg()` / `TOOL_GLYPH_SVG` at `engine/world/19-tools-toolbar.js:1208`. Use that, **not** PNG (project rule: main uses SVG glyphs, never baked PNG icons).

**Plan (Small):** add a `swatch`/`glyph` field to each material option in `SELECTION_MATERIAL_OPTIONS` (e.g. a representative color swatch + small SVG texture glyph), then extend the chip renderer at `28-generate-panel-agent.js:2493` to render it. Mirror the same for the Settings `<select>` (or convert it to a chip row for consistency).

---

## 3. "Layers" → it's an inventory, not Photoshop layers

**What it actually is:** a **scene outliner / searchable inventory** of everything placed in the world. `engine/world/32-layers-panel.js` (markup `tiny-world-builder.html:496-513`):
- Walks every island grid cell and emits a node per occupied cell — hierarchy is **terrain → object → sub-parts**, NOT z-order/opacity/visibility. `collectIslandCells()` `:181-243`; intent comment `:168-170` ("Grass > Fence / Cottage hierarchy").
- Each row is navigate-and-select: click → `sel.replaceWorldCoords()` + camera fly-to + switches to the Properties tab. `:420-437`, `:495-535`
- It **hosts the property inspector** (relocates `#agent-selection-properties` into the panel `:26-33`) and has a **search box** over the tree (`filterRows` `:248-256`).

**Root cause of confusion:** image-editor label, none of the image-editor semantics, and zero explanatory copy — i18n only has `'layers.toggle':'Layers'` / `'layers.tabLayers':'Layers'` at `engine/i18n/en.js:212-219`.

**Plan (Small, no behavior change):** rename to **"World Items" / "Contents" / "Inventory"** and add one line of helper copy ("Everything you've placed — click to find and edit it"). Pure label/i18n change across `en.js:212-219` + the toggle/markup; the tree, search, selection, and property-host code stay as-is. The designer's own reframe ("blueprint/inventory of things in your world") is exactly correct.

---

## 4. "Size only grows" — a shrink path exists in code but appears unreachable to the user

**Important nuance (needs in-app confirmation — claim is from static code reading only):** a shrink code path **exists**; the open question is whether it's *reachable* in the context the designer was in. Do NOT tell the designer "it works, you missed it" until verified in the real app — undiscoverable and not-actually-present look identical to a playtester, and project rule is "verify in real app, never guess."
- The **Scale** control sends `down = 0.85` (`28-generate-panel-agent.js:1773`) and object scale clamps down to **0.25**, not 1.0 (`engine/world/21-object-transform-voxel-build.js:1085`). **Open question:** is that Scale control actually *visible/enabled* for the object type the designer was resizing? (gap between "exists in code" and "user can do it").
- The **Size** property row is discrete small/medium/large → floors 1/2/4 and can move down (`28-generate-panel-agent.js:1993`); terrain height clamps down to min 1 (`:2010`).

**Where the "only grows" perception comes from:** repeat-clicking the same tool on an existing object only **increments** floors — `Math.min(stackMax, level + 1)` at `engine/world/20-input-place-erase.js:325`, with **no decrement path**. So the most discoverable size interaction (click again) only ever grows.

**Plan (Small–Medium):** — the dual-track below is robust either way; even if Scale-down is reachable, 4a still fixes the most discoverable interaction.
- **4a:** add a shrink affordance to the repeat-click path in `20-input-place-erase.js:325` — e.g. Alt/right-click decrements floors (mirror of the `Math.min` grow with a `Math.max(1, level-1)`).
- **4b:** surface the existing scale-down / Size controls more prominently in the Properties panel (clear − / + pairing, label "Scale" and "Size" distinctly so they're not confused).

---

## 5. Buttons that "don't work"

**Scope caveat:** this no-op audit covered the **Properties panel** only. The toolbar (`engine/world/19-tools-toolbar.js`), tool palette (`35-tool-palette.js`), and radial menu (`33-radial-menu.js`) were located but NOT swept for dead controls — "some buttons" is vague, so the exact buttons the designer hit may live there. Fire a quick follow-up explore across those three surfaces before closing #5.

These are shown unconditionally but **silently no-op** in the wrong context (the UI ignores the `false` return), so they look broken:
- **Apply tool** — shown at `28-generate-panel-agent.js:2105`; returns `false` for Select/Auto/island/mooring/no-selection/play-mode at `engine/world/20-input-place-erase.js:114`; result ignored at `:1748`.
- **Paste** — shown at `:2109`; returns `false` with no clipboard payload (`20-input-place-erase.js:1439`).
- **Paste latest** — shown at `:2115`; returns `false` when no saved template (`20-input-place-erase.js:1579`).
- **Voxel sculpt** (remove/add/smooth) — shown for any sub-part at `:2241`, but the handlers only act on `v:x,y,z` voxel keys and return `false` for non-voxel parts (`engine/world/44-sub-object-edit.js:337/351/373`).
- **Undo/Redo** — *not* stubbed; deliberately disabled with empty history stacks (`28-generate-panel-agent.js:2100`, disabled-chip bind `:2490`). A real undo-history feature is a separate, larger effort.

**Root cause:** buttons are rendered without gating on whether the action is currently valid, andthe dispatcher discards the `false` result, so the user gets zero feedback.

**Plan (Small–Medium):**
- **5a:** Context-gate the chips — hide or `disabled` them when their action would return `false` (reuse the existing disabled-chip styling at `:2490`), and add a tooltip explaining the precondition ("Select an object first", "Nothing copied yet", "Voxel parts only").
- **5b:** Make the dispatcher surface failures (toast/no-op feedback) instead of silently swallowing `false` at `28-generate-panel-agent.js:1748`.
- **5c (separate track):** Undo/Redo needs an actual edit-history stack — scope as its own task, not part of this cleanup.

---

## Suggested sequencing (all changes delegated to coding agents + cross-reviewed; PRs land, human merges)

**Wave 1 — quick, high-impact, low-risk (independent → can fan out in parallel):**
- #3 rename Layers → Inventory (+ helper copy)
- #2 material swatches/glyphs
- #5a/5b context-gate dead buttons + feedback
- #1a core-loop coach card

**Wave 2 — needs a little design:**
- #4a/4b shrink affordance + Scale/Size clarity

**Wave 3 — separate features:**
- #1b guided first-run overlay
- #5c real Undo/Redo history

Each item is independently shippable. Items in Wave 1 touch mostly disjoint files, so they parallelize cleanly. i18n is a cross-cutting constraint on #1 and #3 — route any user-facing string through `engine/i18n/*` and gate on `npm run i18n:check`.
