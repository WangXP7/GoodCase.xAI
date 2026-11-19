# Build UX Capability Audit

Scope: read-only trace of what the radial (ring) menu and the selection properties panel
surface as options, versus what those options actually do per object kind. Written to
support Build v2's goal of making every surfaced option capability-accurate. No code was
changed for this audit.

Files read in full: `engine/world/33-radial-menu.js` (527 lines), `engine/world/12-selection-tool.js`,
`engine/world/35-tool-palette.js`. Files read in relevant part: `engine/world/19-tools-toolbar.js`,
`engine/world/44-sub-object-edit.js` (referenced, not exhaustively walked — see Follow-ups),
`engine/world/04-textures.js`, `engine/world/17-tile-renderers.js`, `engine/world/09b-voxel-build-factories.js`,
`engine/world/28a-floating-agent.js`, `engine/world/16-drop-anim-adjacency.js`, `engine/world/10-world-data.js`.

---

## 1. Inventory: what the radial menu can show

The ring menu (`engine/world/33-radial-menu.js`) is a single DOM overlay (`root`, line 120-123)
with a small state machine (`currentLevel`, line 69) over six possible levels: `root`, `edit`,
`edit-move`, `edit-scale`, `edit-color`, `size`, `color`. Levels are rendered by one dispatcher,
`renderLevel()` (line 159-299).

### Root level (`ROOT` array, lines 32-42)

| id | label key | icon | action / submenu | posType |
|---|---|---|---|---|
| size | radial.size | size | submenu: size | primary |
| rotate | radial.rotate | rotate | action: rotate | primary |
| more | radial.more | more | action: more | primary |
| move | radial.move | move | action: move | primary |
| duplicate | radial.duplicate | copy | action: duplicate | primary |
| delete | radial.delete | trash | action: delete | danger |
| color | radial.color | palette | submenu: color | primary |
| generate | radial.generate | wand | action: generate | tertiary |
| style | radial.style | sparkles | action: style | primary |

Visibility conditions at root (`renderLevel`, lines 179-200):
- **Island selected** (`selectedRadialIsland()`, line 64-67, backed by `selectedTransformGizmoIsland`
  set in `engine/world/12-selection-tool.js:141-199`): the item list is filtered to
  `ISLAND_ACTIONS = {'move','rotate'}` (line 63) — every other root item is hidden. This is the
  one place in the ring where visibility is genuinely gated by what the selection supports (an
  island transform gizmo has no per-object color/style/duplicate).
- **Object selected, sub-edit supported** (`subEditSupported()`, lines 104-110, mirrors the
  inspector's home-grid + `isVoxelSubEditableKind` gate): the `more` slot's icon/label/id is
  swapped for `edit` (lines 184-188), which drills into the sub-object ring. This swap is
  presentation-only — `more` and `style` both still resolve to the same handler
  (`openSelectionPanel()`, see below) when *not* replaced.
- **Everything else** (`size`, `rotate`, `move`, `duplicate`, `delete`, `color`, `generate`,
  `style`): shown unconditionally for any non-island object selection, regardless of `cell.kind`.
  There is no per-kind filter at root level at all — this is the seam the capability registry
  needs to close.

### `runAction()` dispatch (lines 390-416)

- `duplicate` → `duplicateActiveCellIntent()`
- `rotate` → island rotation OR `rotateActiveCellIntent(Math.PI/2)` OR selection `.rotate()`
- `delete` → `deleteActiveCellIntent()`
- `generate` → `openContextualGenerateModal()` (builds an AI-generate prompt from the selection)
- **`more` and `style` both call `openSelectionPanel()`** (line 410-411) — i.e. **the `style`
  ring button does not itself change anything**. It just opens the same properties panel as
  `more`. Any actual style change happens later, inside that panel, via a completely separate
  code path (`28a-floating-agent.js`, section 3 below).
- `move` also calls `openSelectionPanel()` (line 412-413), with a comment admitting this is a
  stand-in ("until a dedicated move sub-ring lands").

### `size` submenu (lines 263-282)

Two buttons, Shrink (`0.87`) / Grow (`1.15`), calling `scaleSelectedBoardObject(it.factor)`
(line 279). Comment at lines 264-267 states this is intentionally universal — reuses one scale
path for "basic kinds, buildings, voxel/asset-templates." Confirmed universal: the gate function
`isObjectScaleEditableCell` (`engine/world/21-object-transform-voxel-build.js:1133-1135`) is
`return !!(cell && cell.kind)` — true for literally any placed kind. **Size is the one root
option with no dead cells at all.**

### `color` submenu (lines 283-298, `COLORS` array lines 43-52)

Eight swatches + a "default/reset" option. Clicking calls `setSelectedColor(hex)` (line 307-319),
which writes `appearance.bodyColor` directly via `updateSelectedBoardObjects`, with **no kind
check**. See section 2 for why this is dead for a large set of kinds.

### Sub-object `edit` ring (lines 201-226) and its children (`edit-move`/`edit-scale`/`edit-color`)

This is the one part of the menu that does per-item conditional gating correctly: each child
action (`Move`/`Scale`/`Recolor`) is disabled (`it.need && !hasPart`, line 214) until the user has
tapped an actual voxel part inside the sub-edit view (`hasPart` from `se.selectedInfo()`, line
203). Disabled buttons are dimmed and show a "tap a part" tooltip (line 216-217). This is a good
existing pattern for what a capability-aware root ring should also do (dim/hide vs. silently
no-op).

### Reactivity (`tickRadialMenu()`, lines 469-524)

The menu rebuilds `root` when selection flips between island/object mode (lines 512-516), and
rebuilds the `edit` ring when the tapped sub-part changes (lines 517-523). It does **not**
rebuild when the *kind* of a plain object selection changes (e.g., selecting a stargate right
after a tree) — because nothing in the root list depends on kind today. Once a capability
registry exists, this tick function is the natural place to also gate root-level buttons per
`cell.kind`.

---

## 2. The dead-option matrix

"REAL" = the action changes rendered output or persisted state for that kind. "DEAD" = the UI
accepts the action (button is enabled, appearance data is written) but nothing downstream reads
or renders it, so it is a silent no-op. "CONDITIONAL" = real only for some sub-cases (terrain,
variant, cluster shape, etc). "N/A" = the option is not shown for that kind by the surfacing UI
in question, so there's nothing to be dead.

Kind universe used below is the full set of `cell.kind` literals actually branched on across the
renderers (`grep -oh "kind === '...'" engine/world/17-tile-renderers.js engine/world/09b-voxel-build-factories.js
engine/world/18-scene-pick-xr.js engine/world/16-drop-anim-adjacency.js`), cross-checked against
the toolbar's placeable list (`engine/world/19-tools-toolbar.js:14-49`) and the island generator's
object catalogue (`engine/world/26a-island-generator.js:2469-2501`).

### Style (`appearance.objectStyle`, normal | voxel) — the reported smoking gun

Trace of the full pipe:

1. **Where it's written**: the properties panel's Style row handler,
   `engine/world/28a-floating-agent.js:1235-1243`. The only guard is
   `if (!target.cell || target.cell.kind === 'voxel-build') return null;` — i.e. it writes
   `appearance.objectStyle` for **every kind except `voxel-build`**, no matter whether that kind
   has a voxel rendering path.
2. **Where it's shown**: same file, line 1484 —
   `if (selectedTargets.some(t => t.cell && t.cell.kind !== 'voxel-build'))` — same overly broad
   condition, so the Style row appears for any selection that isn't purely `voxel-build`.
3. **Where it's read**: `engine/world/17-tile-renderers.js:272-281`. `renderStyle =
   appearanceForRender.objectStyle`; `useVoxelRender = kind==='voxel-build' || kind==='model-stamp'
   || renderStyle==='voxel' || (renderVoxelTerrain && renderStyle!=='normal')`.
4. **What actually consumes `useVoxelRender`**: `makeVoxelRenderForCell(kind, x, z, cell, level)`
   (`engine/world/09b-voxel-build-factories.js:2760-2850`). It only has branches for:
   `voxel-build, model-stamp, tree, rock, bridge, tuft, flower, bush, crop, corn, wheat, carrot,
   sunflower, pumpkin, cow, sheep, pig, lamp-post, spotlight, chimney, ripple, shrub, stone, pebble,
   bridge-rail, fence, house`. For any other kind it returns `null`.
5. **The fallthrough**: back in `renderCellObjectImpl` (`17-tile-renderers.js:294-299`), if
   `voxelRender` is `null` the code falls straight through to the ordinary simple-factory /
   explicit-branch rendering (`SIMPLE_OBJECT_FACTORIES` lookup, or the explicit `stargate` /
   `crystal|relic|totem|ruins|artifact` branches at lines 306-365) — **which never look at
   `appearance.objectStyle` at all.**

Net effect: for kinds outside the `makeVoxelRenderForCell` branch list — **stargate, crystal,
relic, totem, ruins, artifact** (and the generic `asset-template` kind) — toggling Style in the
properties panel writes data, the row shows a selected state, and the object visually does not
change. This is exactly the owner's complaint ("the ring menu shows style which does nothing most
of the time").

| kind | Style shown? | Style real? |
|---|---|---|
| house, tree, rock, bridge, fence, lamp-post, spotlight, tuft, flower, bush, crop, corn, wheat, carrot, sunflower, pumpkin, cow, sheep, pig, chimney, ripple, shrub, stone, pebble, bridge-rail | yes | **REAL** |
| voxel-build | no (explicitly excluded) | N/A |
| stargate, crystal, relic, totem, ruins, artifact, asset-template, model-stamp | yes | **DEAD** |

Notably, the REAL set above (24 kinds) is *exactly* the union of `SIMPLE_OBJECT_FACTORIES`
(`17-tile-renderers.js:161-177`) plus the explicit `fence`/`house`/`lamp-post` branches, and it is
**identical** to `TW_VOXEL_SUBEDIT_BUILTIN_KINDS`
(`engine/world/09b-voxel-build-factories.js:2742-2747`, reproduced in section 3) — that constant
is effectively "kinds with both a normal and a voxel renderer," which is precisely the Style
capability. It already exists; nothing needs to be reverse-engineered.

### Color (`appearance.bodyColor` / `topColor`) — a second, larger dead zone in the ring specifically

The ring's root-level `color` submenu (section 1) calls `setSelectedColor()`
(`33-radial-menu.js:307-319`), which sets `appearance.bodyColor` **unconditionally for any
selected kind**. Compare to the properties panel, which gates color rows correctly via
`SELECTION_COLOR_EDITABLE_KINDS` (`28a-floating-agent.js:577-581`):

```
new Set(['house','voxel-build','tree','rock','bridge','fence','crop','corn','wheat',
         'pumpkin','carrot','sunflower','flower','bush','cow','sheep','pig'])
```

Whether a color actually renders is decided by `applyAppearanceToObject`
(`engine/world/04-textures.js:2724-2765`): it only remaps materials that are members of four
explicit material-identity sets (`topBase`, `topDark`, `bodyBase`, `bodyDark`, lines 2727-2748) —
essentially the named "wall/roof/trunk/leaves/rock/fence/crop/animal" material slots for the same
17 kinds above. Any kind whose meshes use materials outside those four sets is untouched by a
color change.

So: **lamp-post, spotlight, tuft, chimney, ripple, shrub, stone, pebble, bridge-rail, stargate,
crystal, relic, totem, ruins, artifact, model-stamp, asset-template** all get a fully enabled
Color submenu from the *ring* (no kind check exists there at all) that is a silent no-op for all
of them — a **larger dead set than Style**, and one the properties panel already avoids by using
`SELECTION_COLOR_EDITABLE_KINDS`. The ring simply doesn't consult that set.

| kind | Color shown (ring)? | Color real? | Color shown (panel)? |
|---|---|---|---|
| house, voxel-build, tree, rock, bridge, fence, crop, corn, wheat, pumpkin, carrot, sunflower, flower, bush, cow, sheep, pig | yes | **REAL** | yes |
| lamp-post, spotlight, tuft, chimney, ripple, shrub, stone, pebble, bridge-rail, stargate, crystal, relic, totem, ruins, artifact, model-stamp, asset-template | yes | **DEAD** | correctly hidden |

### Rotate

Real for any selected object (`rotateActiveCellIntent` / selection `.rotate()`, both just spin
`cell.rotationY`, which every renderer applies at `17-tile-renderers.js:469-473` /
`09b-voxel-build-factories.js` mesh placement uniformly) — **REAL for all kinds**, including
islands (island rotation is a separate `island.rotationY` path, also real). No dead cells found.

### Size (grow/shrink)

**REAL for all kinds** — see section 1 (`isObjectScaleEditableCell` is `!!cell.kind`).

### Duplicate / Delete / Generate / Move(→panel)

Not kind-gated and not kind-sensitive in their effect (they operate on the cell/selection as a
whole, not on kind-specific sub-state), so there's no dead-option risk from these the way there is
for Style/Color. Not included as separate matrix rows.

### buildingType ("Shape": Cottage/Manor/Tower/Castle/High-rise)

**CONDITIONAL by construction, correctly gated** — both the toolbar's placement flyout
(`19-tools-toolbar.js:15-20`) and the panel's post-placement row
(`28a-floating-agent.js:1621-1630`) only ever apply to `kind === 'house'`, and the row is only
added `if (primary === 'house')`. No dead cells; this is the pattern to imitate.

### fenceStyle (wood / garden / gate)

**CONDITIONAL, mostly correct**. `wood`/`garden` are user-selectable at placement
(`19-tools-toolbar.js:26-27`, variants array) and consumed by every fence renderer (classic
`17-tile-renderers.js:368`, voxel `09b-voxel-build-factories.js:2780`, ghost preview
`15-ghost-generation-fade.js:572`, XR pick `18-scene-pick-xr.js:365`) — real. `gate` is a valid
value accepted by `normalizeFenceStyle` (`16-drop-anim-adjacency.js:664-666`, backed by a
`FENCE_STYLES` set) and is auto-selected server-side when `cell.terrain === 'path'` (route-gate
logic in the fence render branches), but **it is not offered as a placement variant or a
post-placement option anywhere in the toolbar or properties panel** — it's reachable only as an
automatic terrain-driven side effect, not a user choice. Worth flagging as a hidden capability, not
a dead one.

---

## 3. Capability registry proposal

### Shape

```js
// engine/world/xx-object-capabilities.js — new module, loaded after 09b/16/17 (needs their
// helper functions) and before 33-radial-menu.js / 28a-floating-agent.js (both consume it).
const OBJECT_CAPS = {
  house:       { style: true, color: ['topColor','bodyColor'], buildingType: ['cottage','manor','tower','turret','skyscraper'], rotate: true, size: true, subEdit: true },
  tree:        { style: true, color: ['topColor','bodyColor'], rotate: true, size: true, subEdit: true },
  rock:        { style: true, color: ['topColor','bodyColor'], rotate: true, size: true, subEdit: true },
  bridge:      { style: true, color: ['bodyColor','topColor'], rotate: true, size: true, subEdit: true },
  fence:       { style: true, color: ['bodyColor','topColor'], fenceStyle: ['wood','garden','gate'], rotate: true, size: true, subEdit: true },
  'lamp-post': { style: true, color: false, rotate: true, size: true, subEdit: true },
  spotlight:   { style: true, color: false, rotate: true, size: true, subEdit: true },
  crop: {}, corn: {}, wheat: {}, carrot: {}, sunflower: {}, pumpkin: {}, // share the crop shape below
  cow:  {}, sheep: {}, pig: {},                                          // share the animal shape below
  tuft:        { style: true, color: false, rotate: true, size: true, subEdit: true },
  flower:      { style: true, color: ['topColor','bodyColor'], rotate: true, size: true, subEdit: true },
  bush:        { style: true, color: ['topColor','bodyColor'], rotate: true, size: true, subEdit: true },
  chimney: {}, ripple: {}, shrub: {}, stone: {}, pebble: {}, 'bridge-rail': {}, // style/rotate/size real, no color
  stargate:      { style: false, color: false, rotate: true, size: true, subEdit: false },
  crystal:       { style: false, color: false, rotate: true, size: true, subEdit: false },
  relic:         { style: false, color: false, rotate: true, size: true, subEdit: false },
  totem:         { style: false, color: false, rotate: true, size: true, subEdit: false },
  ruins:         { style: false, color: false, rotate: true, size: true, subEdit: false },
  artifact:      { style: false, color: false, rotate: true, size: true, subEdit: false },
  'voxel-build': { style: false /* always voxel */, color: false, rotate: true, size: true, subEdit: 'conditional' },
  'model-stamp': { style: false, color: false, rotate: true, size: true, subEdit: false },
};
```

The point isn't the exact literal object above — it's that **every field in it already exists as
a scattered constant** and the registry should be assembled from those, not hand-authored twice:

- `style` (voxel/normal toggle) ⇐ membership in `TW_VOXEL_SUBEDIT_BUILTIN_KINDS`
  (`09b-voxel-build-factories.js:2742-2747`), which is the same list `makeVoxelRenderForCell`
  branches on and the same list used to gate sub-object part editing
  (`isVoxelSubEditableKind`, `09b-voxel-build-factories.js:2748-2758`). One set, three consumers
  (Style toggle, sub-edit gate, and — currently missing — the ring/panel visibility check).
- `color` (which rows, if any) ⇐ `SELECTION_COLOR_EDITABLE_KINDS` +
  `selectionColorConfig(kind)` (`28a-floating-agent.js:577-641`), which already encodes both
  "does this kind get color at all" and "what are the two rows called" (e.g. tree → Leaves/Trunk,
  cow → Coat/Markings). This is the richest existing table and should become the color half of
  the registry directly, not be re-derived.
- `buildingType` variants ⇐ `19-tools-toolbar.js:15-20` (placement flyout) — already exists,
  just needs to be read by the panel/ring instead of the panel hard-coding its own copy at
  `28a-floating-agent.js:1623-1629` (two literal copies of the same 5 options today).
- `fenceStyle` variants ⇐ `19-tools-toolbar.js:26-27` (toolbar) + `FENCE_STYLES` /
  `normalizeFenceStyle` (`16-drop-anim-adjacency.js:664-666`) — toolbar only lists `wood`/`garden`
  today; `gate` exists in the normalizer but isn't in any picker (see fenceStyle note above).
  Building the registry from `FENCE_STYLES` (not the toolbar list) would surface `gate` for free.
- `subEdit` ⇐ `isVoxelSubEditableKind` (same set as `style`).
- `rotate`/`size` are universal (no table needed — every kind gets `true`).
- Crop-family and animal-family color row shapes ⇐ `SELECTION_CROP_COLOR_KINDS`
  (`28a-floating-agent.js:585`) and the `cow|sheep|pig` branch (`638-639`) — already grouped,
  just needs the *presence* boolean, not just the label text, pulled up to registry level.

### Where it should live (load-order constraint)

Load order today (see numeric filename prefixes, `docs/` and `netlify` build lists) puts
`04-textures.js` (has `normalizeAppearance`), `09b-voxel-build-factories.js` (has
`TW_VOXEL_SUBEDIT_BUILTIN_KINDS`/`isVoxelSubEditableKind`), `16-drop-anim-adjacency.js` (has
`fenceStyleForCell`/`FENCE_STYLES`), and `17-tile-renderers.js` (has `SIMPLE_OBJECT_FACTORIES`)
all before `19-tools-toolbar.js`, `28a-floating-agent.js` (properties panel), and
`33-radial-menu.js` (ring). A capability module needs to run **after** 09b/16/17 (to read their
sets, not duplicate them) and **before** 19/28a/33 (so both consumers can query it). A new file
numbered in the `17.5`–`18.x` range (or simply appended to the end of `09b`, since it's already
the capability home for sub-edit) would satisfy that without renumbering anything. Concretely: add
one function, e.g. `capsForKind(kind)`, exported on `window`, that both `28a-floating-agent.js`'s
row-builder and `33-radial-menu.js`'s `renderLevel('root')` / `renderLevel('color')` /
`runAction('style')` call before deciding whether to show or enable a button — mirroring the
disabled-button pattern the `edit` sub-ring already uses (`33-radial-menu.js:213-217`) instead of
hiding the row from the panel and doing nothing in the ring.

---

## 4. Selection-surface assessment (facts, not aesthetics)

- **Depth**: root → up to 2 levels deep (`root → color/size` is 1 hop; `root → edit → edit-move/
  edit-scale/edit-color` is 2 hops). Every leaf submenu's only way back is the single center
  Back/Close button (`renderLevel`, lines 163-176) — there is no breadcrumb, so a user who drills
  `edit → edit-color` and wants `edit-scale` must go Back twice then forward again.
- **Button count per level**: root shows up to 9 buttons (island mode drops to 2: move+rotate);
  `edit` shows 4 (explode/collapse + 3 need-a-part actions); `edit-move` shows 6 (X−/X+/Y−/Y+/
  Z−/Z+); `edit-color` and root `color` both show 8 swatches + reset; `size` shows 2.
  `arcAngles()` (lines 128-136) spaces `edit-color`'s 9 items across a full circle at 40°
  increments, versus root's hand-placed angles (0°, 40°, 80°, 120°, 160°, 200°, 240°, 280°, 320° —
  also 40° increments, so root is visually already at the same density ceiling `arcAngles` uses
  for "this many items, use the whole circle").
  Root is at that same 9-button density permanently, for every object, whether or not the kind
  supports all 9 actions — this is the direct UX cost of the missing kind gate: a stargate
  selection shows the identical 9-button ring as a house selection, and 2 of those 9 (Color,
  Style) do nothing.
- **Discoverability of dead options**: nothing in the button itself (icon, label, disabled state,
  tooltip) distinguishes a REAL action from a DEAD one at root level. The `edit` sub-ring already
  has a working disabled/dim/tooltip convention (`is-disabled` class + `opacity:0.4` + a "tap a
  part" title, lines 214-217) that root does not use at all for Style/Color.
  For **CONDITIONAL** capability (e.g. fenceStyle's hidden `gate` variant, or buildingType only
  for houses), the current UI's answer is simply "don't show it" (correct for buildingType) or
  "never expose it" (fenceStyle's `gate`) — there's no example anywhere of a *disabled-with-reason*
  treatment for a capability that's conditionally available, only for the sub-part editing
  need-a-selected-part case.
- **Interaction cost of the freeze/reposition system**: `RADIAL_FREEZE_MS = 1400` (line 80) holds
  the ring's screen position for 1.4s after any pointer interaction so resizing/duplicating
  doesn't slide the ring away from the cursor (comment, lines 73-79). This is orthogonal to the
  capability question but is a real interaction-timing constant worth knowing if Build v2 changes
  how many buttons appear per level (fewer buttons after gating shrinks the object's screen
  footprint less per tap, which may let this window shrink).

---

## Summary for the team

**Worst dead-option offenders**, most to least severe:

1. **Ring "Color"** — enabled for every kind, real for 17 kinds, silently dead for 17 others
   (lamp-post, spotlight, tuft, chimney, ripple, shrub, stone, pebble, bridge-rail, stargate,
   crystal, relic, totem, ruins, artifact, model-stamp, asset-template). The properties panel
   already avoids this via `SELECTION_COLOR_EDITABLE_KINDS`
   (`engine/world/28a-floating-agent.js:577-581`) — the ring just never checks it.
2. **Properties-panel "Style"** — the reported bug. Shown/writable for every kind except
   `voxel-build`; real only for the 24 kinds `makeVoxelRenderForCell`
   (`engine/world/09b-voxel-build-factories.js:2760-2850`) has a branch for; silently dead for
   stargate, crystal, relic, totem, ruins, artifact, asset-template. The ring's own "Style" button
   doesn't even set the flag — it just opens this same panel (`33-radial-menu.js:410-411`).
3. **fenceStyle "gate"** — not dead, but invisible: a real, working style
   (`normalizeFenceStyle`/`FENCE_STYLES`, `engine/world/16-drop-anim-adjacency.js:664-666`) that
   no picker anywhere lets a user choose; it only appears as an automatic side effect of placing a
   fence on path terrain.

**Proposed fix shape**: one `capsForKind(kind)` lookup built by combining the capability facts
that already exist as separate constants — `TW_VOXEL_SUBEDIT_BUILTIN_KINDS` (style + sub-edit),
`SELECTION_COLOR_EDITABLE_KINDS` + `selectionColorConfig()` (color), the toolbar's `buildingType`
variant list, and `FENCE_STYLES` (fenceStyle) — rather than inventing a new table from scratch.
Both the ring (`engine/world/33-radial-menu.js`) and the properties panel
(`engine/world/28a-floating-agent.js`) would query it before showing or enabling Style/Color, the
same way the sub-object `edit` ring already dims buttons it can't fulfill
(`33-radial-menu.js:213-217`).

Report written to: `plans/build-v2/01-ux-capability-audit.md`.
