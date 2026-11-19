// -------- Tinyverse store catalog (release preview) --------
(function () {
  'use strict';

  const CATALOG = {
    featuredPackId: 'island-pack',
    packs: [
      {
        id: 'island-pack',
        name: 'Island Pack',
        subtitle: '1 procedural island',
        description: 'Open a free island pack tonight. Each pack reveals one collectible island you can visit in play mode.',
        cost: 0,
        badge: 'Free',
        accent: '#7fd34f',
        rim: '#3a6b22',
        cardsLabel: '1 Island',
        featured: true,
      },
    ],
  };

  function getPack(id) {
    const key = String(id || CATALOG.featuredPackId);
    return CATALOG.packs.find(p => p.id === key) || CATALOG.packs[0];
  }

  window.TinyverseStoreCatalog = {
    CATALOG,
    getPack,
    getPacks: () => CATALOG.packs.slice(),
    getFeaturedPack: () => getPack(CATALOG.featuredPackId),
  };
})();