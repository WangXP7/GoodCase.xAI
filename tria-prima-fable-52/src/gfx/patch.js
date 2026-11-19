// Composable onBeforeCompile patches for built-in three.js materials.
// three keys its program cache on onBeforeCompile.toString(), which is identical for every wrapped
// closure, so each patched material also gets an explicit customProgramCacheKey.

/** Append a shader patch: fn(shader, renderer). `key` must uniquely describe what the patch does. */
export function addPatch(material, fn, key) {
  if (!material.userData._patches) {
    material.userData._patches = [];
    material.userData._patchKey = '';
    material.onBeforeCompile = (shader, renderer) => {
      for (const p of material.userData._patches) p(shader, renderer);
    };
    material.customProgramCacheKey = () => material.userData._patchKey;
  }
  material.userData._patches.push(fn);
  material.userData._patchKey += '|' + key;
  material.needsUpdate = true;
  return material;
}

/** Replace `needle` in a shader string, failing loudly if it is missing (catches three.js upgrades). */
export function inject(src, needle, replacement, label = '') {
  if (!src.includes(needle)) {
    console.error(`[patch] could not find "${needle}" ${label}`);
    return src;
  }
  return src.replace(needle, replacement);
}
export const after = (src, needle, code, label) => inject(src, needle, `${needle}\n${code}`, label);
export const before = (src, needle, code, label) => inject(src, needle, `${code}\n${needle}`, label);
