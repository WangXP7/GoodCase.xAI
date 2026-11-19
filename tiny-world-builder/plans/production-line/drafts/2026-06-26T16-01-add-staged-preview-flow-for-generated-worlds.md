# DRAFT (review before publishing) — Fri, 26 Jun 2026 16:01:57 GMT

## News draft
**Headline:** Add staged preview flow for generated worlds

Generation now stages validated JSON as a holographic diff overlay instead of immediately applying it. The panel adds Apply/Regenerate/Discard preview controls, tracks/disposes preview meshes/materials safely, and only calls `applyState()` when the user explicitly applies. Closing the modal or discarding now clears the preview, and regenerate restarts generation from that state. The asset-editing skill guide was updated to document this preview-first generate behavior.

## Tweet draft
Add staged preview flow for generated worlds just shipped on TinyWorld. Generation now stages validated JSON as a holographic diff overlay instead of immediately applying it. The panel adds Apply/Regenerate/Discard preview controls,

_Source commit: 690c2d8 — Add staged preview flow for generated worlds_
