-- Remove the confusing nexus hub and any physical stargate cells from stored worlds.
-- World selection now lives in UI chrome, not on a playable island board.

DELETE FROM worlds WHERE slug = 'tinyverse-nexus';

WITH cleaned AS (
  SELECT
    w.id,
    COALESCE(
      jsonb_agg(c.cell ORDER BY c.ord) FILTER (
        WHERE NOT (
          (jsonb_typeof(c.cell) = 'object' AND c.cell->>'kind' = 'stargate')
          OR (jsonb_typeof(c.cell) = 'array' AND c.cell->>3 = 'stargate')
        )
      ),
      '[]'::jsonb
    ) AS cells
  FROM worlds w
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.data->'cells', '[]'::jsonb)) WITH ORDINALITY AS c(cell, ord)
  GROUP BY w.id
)
UPDATE worlds w
SET
  data = jsonb_set(COALESCE(w.data, '{"v":4,"cells":[]}'::jsonb), '{cells}', cleaned.cells, true),
  updated_at = NOW()
FROM cleaned
WHERE w.id = cleaned.id
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(w.data->'cells', '[]'::jsonb)) AS existing(cell)
    WHERE (jsonb_typeof(existing.cell) = 'object' AND existing.cell->>'kind' = 'stargate')
       OR (jsonb_typeof(existing.cell) = 'array' AND existing.cell->>3 = 'stargate')
  );
