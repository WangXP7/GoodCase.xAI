# OWB → TinyWorld port notes (`feat/owb-port`)

Tracks what landed from `open-world-builder` and what was deliberately
deferred. Each landed item is a separate commit on this branch.

## Shipped

| # | Item                                | Status   | Where                       |
| - | ----------------------------------- | -------- | --------------------------- |
| 1 | Palette / design tokens             | shipped  | new components reuse the    |
|   |                                     |          | existing `--bg`/`--panel`/  |
|   |                                     |          | `--ink`/`--muted`/`--line`/ |
|   |                                     |          | `--accent` vars             |
| 8 | First-person + top-down view popup  | shipped  | `#view-modes` button → 3-   |
|   |                                     |          | option popup bound to       |
|   |                                     |          | `setCameraMode`             |
| 9 | Time / season / weather drawer      | shipped  | `#time-weather` button →    |
|   |                                     |          | `#time-popup`. CSS-only via |
|   |                                     |          | `body.tod-*`/`weather-*`    |
|   |                                     |          | + `#tod-tint` overlay       |
| 10| Developer / showcase mode           | shipped  | `#dev-mode` button reuses   |
|   |                                     |          | the existing stats overlay  |
|   |                                     |          | (backtick toggle)           |
| 11| Command palette (⌘K)                | shipped  | `#palette-overlay` indexes  |
|   |                                     |          | TOOLS + top-bar + settings  |
|   |                                     |          | tabs + raise/lower          |
| 12| World-name popup menu               | shipped  | brand title → `#world-menu` |
|   |                                     |          | with multi-slot local store |
|   |                                     |          | (`tinyworld:worlds.v1`)     |
| 13| AI generate panel (seed + biomes +  | shipped  | `#gen-modal` extended with  |
|   | elevation + gpt-image-1 plan)       |          | seed input, biome composition|
|   |                                     |          | sliders (auto-sum 100%),    |
|   |                                     |          | elevation sliders, "sketch  |
|   |                                     |          | plan first" calling         |
|   |                                     |          | gpt-image-1                 |
| 7 | Raise / lower controls              | shipped  | `R` / `F` shortcuts +       |
|   |                                     |          | palette entries; clamped    |
|   |                                     |          | 1..8 on `terrainFloors`     |

## Items 4, 5, 6 — second pass

All three originally-deferred items now ship as additive code on this
branch:

| # | Item                                | Status   | Where                       |
| - | ----------------------------------- | -------- | --------------------------- |
| 4 | Map / terrain generation            | ✅ shipped| `generateProceduralWorld()` |
|   |                                     |          | emits v=4 cells directly    |
|   |                                     |          | from seed + biome % +       |
|   |                                     |          | elevation %.  "Procedural   |
|   |                                     |          | (offline)" toggle in the    |
|   |                                     |          | generate panel bypasses the |
|   |                                     |          | LLM entirely.               |
| 5 | Performance optimisations           | ✅ shipped| Page Visibility pause in    |
|   |                                     |          | animate(); low-fps DPR      |
|   |                                     |          | backoff (28ms threshold →   |
|   |                                     |          | 0.15 step down, restores    |
|   |                                     |          | when avg frame ≤ 19ms).     |
| 6 | New objects (plants / animals)      | ✅ shipped| Adds 4 new kinds:           |
|   |                                     |          | flower / bush / cow / sheep |
|   |                                     |          | wired through every         |
|   |                                     |          | dispatch site, the schema,  |
|   |                                     |          | and TOOLS (new 'Animals'    |
|   |                                     |          | group).                     |

## Architecture honoured

The branch never touches the existing render pipeline, animation system
(voxel clouds, chimney smoke, crop duster, banner streamer, ghost
boards), audio panel, auth flow, account modal, or render-settings
panel. All additions are overlays / popups / shortcuts that route
through existing public functions (`setCameraMode`, `applyState`,
`setCell`, `toggleStatsOverlay`, etc.). No CSS rules override the live
`#cloud-layer` keyframes — the time-of-day tint uses a separate
`#tod-tint` element.
