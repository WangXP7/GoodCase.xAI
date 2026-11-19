/* PRÓXIMO MAPA NO PLACAR (backend `proximo`): o que pré-carregar e o que escrever na tela.
   Funções puras; o main.js liga na sessão e nos carregadores. */

// Plano de preload do anúncio. Mapa que este cliente não conhece = nada a fazer.
export function planoPreload(anuncio, { maps, glbChars, weaponIds }) {
  const mapa = anuncio && maps[anuncio.map];
  if (!mapa) return null;
  const lista = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  return {
    mapId: anuncio.map,
    seed: Number.isInteger(anuncio.mapSeed) ? anuncio.mapSeed : null,
    chars: [...new Set(lista(anuncio.chars).filter((id) => glbChars.has(id)))],
    weapons: [...new Set(lista(anuncio.weapons).filter((id) => weaponIds.includes(id)))],
    props: mapa.props || [],
    ambience: mapa.ambience || [],
  };
}

// Segundos inteiros até a virada, contados de quando o anúncio chegou.
export function segundosAteVirada(anuncio, agora = Date.now()) {
  const fim = (anuncio?.recebidoEm || agora) + Math.max(0, Number(anuncio?.trocaEmMs) || 0);
  return Math.max(0, Math.ceil((fim - agora) / 1000));
}

/* Texto do aviso na tela de fim. Fica aqui e não no i18n.js: o i18n.js entra no SIM_HASH
   (o Game importa), e um rótulo de menu não pode exigir imagem nova do nó. */
export function textoProximo(nome, segundos, lang = 'pt') {
  if (lang === 'en') return segundos > 0 ? `NEXT MAP: ${nome} · ${segundos}s` : `NEXT MAP: ${nome} · LOADING…`;
  return segundos > 0 ? `PRÓXIMO MAPA: ${nome} · ${segundos}s` : `PRÓXIMO MAPA: ${nome} · CARREGANDO…`;
}
