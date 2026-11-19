import { getSql, isDatabaseUnavailable, isMissingRelations } from './lib/db.mjs';
import { corsResponse, errorResponse, jsonResponse } from './lib/http.mjs';
import { computeWorldPriceBreakdown, deriveResourceStats, perTileRate } from './lib/worlds.mjs';

export const config = { path: '/api/worlds/economy' };

const isMissingWorldSchema = (err) => isMissingRelations(err, ['worlds', 'world_economy_state']);

// Read-only price view. The authoritative price is re-validated server-side
// inside world-claim.mjs at confirm time, so this endpoint is safe to expose.
export default async function worldEconomyFunction(request) {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') return corsResponse(origin);
  if (request.method !== 'GET') return errorResponse('Method not allowed', 405, origin);

  try {
    const sql = getSql();
    const econRows = await sql`SELECT * FROM world_economy_state WHERE id = 1 LIMIT 1`;
    const economy = econRows[0] || {};
    const id = Number(new URL(request.url).searchParams.get('id'));

    const body = {
      claimed: Number(economy.claimed_count) || 0,
      perTileRate: String(Math.round(perTileRate(economy) * 1e6) / 1e6),
      perTileBase: String(economy.per_tile_base || '0'),
      perTileCeiling: String(economy.per_tile_ceiling || '0'),
    };

    if (Number.isInteger(id) && id > 0) {
      const rows = await sql`SELECT id, slug, status, tile_count, grid_size, data FROM worlds WHERE id = ${id} LIMIT 1`;
      if (!rows.length) return errorResponse('World not found', 404, origin);
      const world = rows[0];
      const resourceStats = deriveResourceStats(world.data, world.grid_size);
      const priceBreakdown = computeWorldPriceBreakdown(world.tile_count, economy, resourceStats);
      body.world = {
        id: Number(world.id),
        slug: world.slug,
        status: world.status,
        tileCount: Number(world.tile_count),
        priceUsdc: priceBreakdown.totalUsdc,
        resourceStats,
        priceBreakdown,
        forSale: world.status === 'unclaimed',
      };
    }

    return jsonResponse(body, origin);
  } catch (err) {
    if (isDatabaseUnavailable(err)) {
      return errorResponse('Netlify Database is not available in this local session.', 503, origin);
    }
    if (isMissingWorldSchema(err)) {
      return errorResponse('World database tables are missing. Run the Netlify worlds_economy migration.', 503, origin);
    }
    console.error('[world-economy]', err);
    return errorResponse('Economy request failed', 500, origin);
  }
}
