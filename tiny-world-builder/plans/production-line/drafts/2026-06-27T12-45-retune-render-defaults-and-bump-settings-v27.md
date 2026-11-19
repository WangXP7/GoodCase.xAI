# DRAFT (review before publishing) — Sat, 27 Jun 2026 12:45:37 GMT

## News draft
**Headline:** Retune render defaults and bump settings v27

Updates shipped render defaults to a brighter, lower-contrast lighting profile (brightness/lighting/fill/saturation/contrast) and increments the render settings version to 27. The voxel-build transform reset path now reads these values from `RENDER_DEFAULTS` instead of hard-coded numbers, keeping reset behavior aligned with shipped defaults. Tests, default settings JSON, and `tools/check.js` assertions were updated to enforce the new v27 baseline.

## Tweet draft
Retune render defaults and bump settings v27 just shipped on TinyWorld. Updates shipped render defaults to a brighter, lower-contrast lighting profile (brightness/lighting/fill/saturation/contrast) and increments the render settings

_Source commit: 3365d55 — Retune render defaults and bump settings v27_
