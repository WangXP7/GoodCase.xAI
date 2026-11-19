// Lists every registered model with what the game relies on: size, triangles, parts, anchors.
//   node tools/page-run.mjs dev/probe.html            (add ?m=name1,name2 for full detail)
import { listModels, modelMeta, buildModel } from '../src/models/index.js';

const want = new URLSearchParams(location.search).get('m');
const names = want ? want.split(',') : listModels();
const out = {};
const r2 = (v) => Math.round(v * 100) / 100;
for (const name of names) {
  const meta = modelMeta(name) || {};
  try {
    const t0 = performance.now();
    const m = buildModel(name, 1);
    const tris = (g) => (g ? (g.index ? g.index.count : g.attributes.position.count) / 3 : 0);
    let t = tris(m.opaque) + tris(m.glass) + tris(m.liquid);
    for (const g of Object.values(m.parts || {})) t += tris(g);
    const row = {
      kind: meta.kind,
      v: meta.variants || 1,
      lods: meta.lods || 1,
      tris: Math.round(t),
      size: m.size.map(r2),
      min: m.min.map(r2),
      parts: Object.keys(m.parts || {}),
      anchors: Object.keys(m.anchors || {}),
      col: (m.colliders || []).length,
      em: (m.emitters || []).map((e) => e.type),
      lights: (m.lights || []).length,
      ms: Math.round(performance.now() - t0),
    };
    if (want) {
      row.anchorsAt = Object.fromEntries(Object.entries(m.anchors || {}).map(([k, a]) => [k, a.map(r2)]));
      row.colliders = m.colliders;
      row.meta = meta;
      row.emitters = m.emitters;
      row.lightsAt = m.lights;
    }
    out[name] = row;
  } catch (e) {
    out[name] = { error: String(e.message || e) };
  }
}
window.RESULT = out;
window.DONE = true;
