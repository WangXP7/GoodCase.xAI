# DRAFT (review before publishing) — Fri, 26 Jun 2026 16:56:55 GMT

## News draft
**Headline:** Add line/rectangle brush preview modes

Introduces a new brush-shape toolbar (single, line, rectangle) and wires brush mode state into input handling. Single mode keeps existing live freehand painting, while line/rectangle now use a holographic drag preview and only commit paint on pointer-up via the normal cell-apply path. The mode indicator now shows the active brush shape, and the asset-editing skill guidance was updated to document this preview-first safety contract and shared `window.__tinyworldBrushModes` state.

## Tweet draft
Add line/rectangle brush preview modes just shipped on TinyWorld. Introduces a new brush-shape toolbar (single, line, rectangle) and wires brush mode state into input handling. Single mode keeps existing live freehand painting

_Source commit: 5df8dc4 — Add line/rectangle brush preview modes_
