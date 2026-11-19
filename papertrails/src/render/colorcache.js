// integration (perf): Color.set('#hex') parses the string with a regex on every call (allocates). The render
// modules re-apply their config colours every frame so live edits of CONFIG keep working; this keeps that
// behaviour but only re-parses when the config string actually changed.
const last = new WeakMap();
/** @returns {boolean} true when the colour was (re)parsed */
export function setColorCached(color, style) {
  if (last.get(color) === style) return false;
  color.set(style);
  last.set(color, style);
  return true;
}
