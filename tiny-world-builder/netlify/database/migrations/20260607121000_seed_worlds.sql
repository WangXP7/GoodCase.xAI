-- Seed the first universe: a FIXED supply of worlds.
--   * 5 official starter worlds (kind='starter'), pre-published with a small real
--     layout (a pond for fishing, a stone outcrop for mining, crops to gather,
--     open grass for animals) so the harvest loop works the moment you join.
--   * 80 purchasable plots (kind='purchasable', status='unclaimed'). First come,
--     first served. Once claimed, the only way to get one is the secondary market.
--
-- The claim flow never INSERTs purchasable worlds, so supply stays fixed at the
-- rows seeded here. Tile/terrain counts are recomputed server-side whenever an
-- owner saves a draft; the values below just prime pricing and the starter sim.

-- 5 starter worlds share a compact 8x8 layout (object-form v4 cells). owner is
-- NULL: official worlds have no owner, so visitors keep the full gross (no tax
-- sink). They are already published and not for sale.
INSERT INTO worlds (slug, kind, status, name, tax_percent, grid_size, tile_count,
                    stone_tile_count, grass_tile_count, water_tile_count, price_usdc, data, published_at)
SELECT
  s.slug, 'starter', 'published', s.name, 10, 8, 64,
  3, 55, 4, 0,
  jsonb_build_object(
    'v', 4,
    'gridSize', 8,
    'cells', jsonb_build_array(
      jsonb_build_object('x', 1, 'z', 1, 'terrain', 'water'),
      jsonb_build_object('x', 2, 'z', 1, 'terrain', 'water'),
      jsonb_build_object('x', 1, 'z', 2, 'terrain', 'water'),
      jsonb_build_object('x', 2, 'z', 2, 'terrain', 'water'),
      jsonb_build_object('x', 5, 'z', 5, 'terrain', 'stone'),
      jsonb_build_object('x', 6, 'z', 5, 'terrain', 'stone'),
      jsonb_build_object('x', 6, 'z', 6, 'terrain', 'stone'),
      jsonb_build_object('x', 4, 'z', 2, 'terrain', 'dirt', 'kind', 'corn'),
      jsonb_build_object('x', 5, 'z', 2, 'terrain', 'dirt', 'kind', 'wheat'),
      jsonb_build_object('x', 3, 'z', 6, 'terrain', 'grass', 'kind', 'tree')
    )
  ),
  NOW()
FROM (VALUES
  ('starter-meadow',   'Meadow Commons'),
  ('starter-harbor',   'Harbor Reach'),
  ('starter-quarry',   'Quarry Hollow'),
  ('starter-orchard',  'Orchard Vale'),
  ('starter-springs',  'Whisper Springs')
) AS s(slug, name)
ON CONFLICT (slug) DO NOTHING;

-- 80 purchasable plots, sizes cycling 8/12/16/20. Seed price = base per-tile rate
-- x tile_count; the live quote recomputes from world_economy_state at buy time.
INSERT INTO worlds (slug, kind, status, grid_size, tile_count, price_usdc)
SELECT
  'plot-' || lpad(q.n::text, 3, '0'),
  'purchasable', 'unclaimed',
  q.sz, q.sz * q.sz,
  round((0.010000 * q.sz * q.sz)::numeric, 6)
FROM (
  SELECT n, (ARRAY[8, 12, 16, 20])[1 + (n % 4)] AS sz
  FROM generate_series(1, 80) AS n
) AS q
ON CONFLICT (slug) DO NOTHING;
