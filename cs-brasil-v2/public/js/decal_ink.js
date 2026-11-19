// Recortes de tinta preta com papel quadriculado nos vazios; régua: decal-ink-check.mjs.
const RECORTES_PRETOS = new Set(['tag-larga.png', 'folha-pixaca-03.png', 'folha-pixaca-04.png']);
const RECORTADOS = new WeakSet();

export function aplicarTintaRecortada(material, arquivo) {
  if (!RECORTES_PRETOS.has(arquivo) || RECORTADOS.has(material)) return false;
  const before = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.onBeforeCompile = function (shader, renderer) {
    before.call(this, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
#ifdef USE_MAP
  float inkLight = min(sampledDiffuseColor.r, min(sampledDiffuseColor.g, sampledDiffuseColor.b));
  diffuseColor.a *= 1.0 - smoothstep( 0.155, 0.180, inkLight );
#endif`);
  };
  material.customProgramCacheKey = () => key + ':black-ink-v3';
  material.userData.tintaRecortada = arquivo;
  RECORTADOS.add(material);
  material.needsUpdate = true;
  return true;
}
