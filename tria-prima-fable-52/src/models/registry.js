// Registry of hand-built models. Model files call register() at import time; the game and the
// model viewer ask for buildModel(name, seed).
const REG = new Map();
const CACHE = new Map();

/**
 * register('cinderbloom', (seed, opts) => builder.build(), { kind: 'ingredient', variants: 3 })
 * meta.kind: 'ingredient' | 'prime' | 'bottle' | 'obstacle' | 'prop' | 'structure'
 */
export function register(name, build, meta = {}) {
  if (REG.has(name)) console.warn(`[models] "${name}" registered twice`);
  REG.set(name, { name, build, meta });
}
export function hasModel(name) {
  return REG.has(name);
}
export function modelMeta(name) {
  return REG.get(name)?.meta || null;
}
export function listModels(kind = null) {
  return [...REG.values()].filter((m) => !kind || m.meta.kind === kind).map((m) => m.name);
}
/** Build (and cache) a model. The returned object is shared: do not mutate its geometries. */
export function buildModel(name, seed = 1, opts = null) {
  const entry = REG.get(name);
  if (!entry) throw new Error(`[models] unknown model "${name}"`);
  const key = opts ? null : `${name}#${seed}`;
  if (key && CACHE.has(key)) return CACHE.get(key);
  const model = entry.build(seed, opts || {});
  model.name = name;
  model.seed = seed;
  if (key) CACHE.set(key, model);
  return model;
}
