import { getSql, isDatabaseUnavailable, isMissingRelations } from './lib/db.mjs';
import { corsResponse, errorResponse, jsonResponse } from './lib/http.mjs';
import { requireAuthUser } from './lib/auth.mjs';
import { requireTinyverseAccess } from './lib/tinyverse-access.mjs';
import { normalizeWorldSelectionGateData, worldPreview, TINYVERSE_HUB_SLUG } from './lib/worlds.mjs';

export const config = { path: '/api/worlds/featured' };

// Public, unauthenticated discovery feed for the landing-page carousel.
// Returns ONLY published worlds (already public, joinable rooms) and ONLY the
// fields needed to render a preview card — no owner identity, no economy/price
// data, no draft/unclaimed plots. The auth-gated /api/worlds remains the source
// of truth for in-app management; this is a read-only shop window.
//
// ?templates=1 — returns ONLY world_shares listed as remixable templates.
// Safe fields: id, name, gridSize, preview, templatePrice, remixCount, authorName.
// authorName = profiles.display_name of template_author_id. NEVER returns email or other PII.
const isMissingWorldSchema = (err) => isMissingRelations(err, ['worlds']);
const isMissingProfileSchema = (err) => isMissingRelations(err, ['worlds', 'profiles']);
const isMissingShareSchema = (err) => isMissingRelations(err, ['world_shares', 'profiles']);

// Shared cell-slicing constants and preview helper reused for both modes.
const MAX_PREVIEW_CELLS = 1200;

function buildPreviewRow(r) {
  const gridSize = Math.max(1, Math.min(64, Number(r.grid_size) || 8));
  const rawCells = (r.data && Array.isArray(r.data.cells))
    ? r.data.cells.slice(0, MAX_PREVIEW_CELLS)
    : [];
  const previewData = normalizeWorldSelectionGateData({ ...r.data, cells: rawCells }, gridSize);
  return { gridSize, preview: { gridSize, cells: worldPreview(previewData, MAX_PREVIEW_CELLS) } };
}

// Build preview from a row where cells were already sliced in SQL (world_shares templates).
// `r.cells` is the JSON array of up to MAX_PREVIEW_CELLS cells; `r.grid_size` is the
// gridSize value extracted from data->>'gridSize'. We never transfer the full data blob.
function buildPreviewFromSliced(r) {
  const gridSize = Math.max(1, Math.min(64, Number(r.grid_size) || 8));
  const rawCells = Array.isArray(r.cells) ? r.cells.slice(0, MAX_PREVIEW_CELLS) : [];
  const previewData = normalizeWorldSelectionGateData({ v: 4, gridSize, cells: rawCells }, gridSize);
  return { gridSize, preview: { gridSize, cells: worldPreview(previewData, MAX_PREVIEW_CELLS) } };
}

export default async function worldsFeatured(request) {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') return corsResponse(origin);
  if (request.method !== 'GET') return errorResponse('Method not allowed', 405, origin);

  const url = new URL(request.url);
  const isTemplates = url.searchParams.get('templates') === '1';

  // The landing page must never break if the DB is cold — degrade to an empty
  // feed (the carousel hides itself) rather than surfacing a 500.
  try {
    const sql = getSql();

    if (isTemplates) {
      // Template marketplace listing — gated to the tinyverse economy allowlist
      // (dark launch). The public home carousel (non-templates path below) stays open.
      const auth = await requireAuthUser(request, origin);
      if (auth.response) return auth.response;
      const tvGate = requireTinyverseAccess(auth.user, origin);
      if (tvGate) return tvGate;
      // Reads world_shares (user-built worlds) where is_template=TRUE and
      // template_price IS NOT NULL. The profile_id IS NOT NULL guard mirrors the
      // remix predicate (deleted-author templates are never shown or remixable).
      // Cells are sliced in SQL so we never transfer the full data blob over the wire.
      // authorName: only display_name from profiles via template_author_id — never PII.
      const limit = 24;
      const rows = await sql`
        SELECT
          ws.id,
          ws.name,
          (ws.data->>'gridSize') AS grid_size,
          (
            SELECT jsonb_agg(c)
            FROM jsonb_array_elements(ws.data->'cells') WITH ORDINALITY t(c, ord)
            WHERE ord <= ${MAX_PREVIEW_CELLS}
          ) AS cells,
          ws.template_price,
          ws.remix_count,
          p.display_name AS author_name
        FROM world_shares ws
        LEFT JOIN profiles p ON p.id = ws.template_author_id
        WHERE ws.is_template = TRUE
          AND ws.template_price IS NOT NULL
          AND ws.profile_id IS NOT NULL
        ORDER BY ws.remix_count DESC NULLS LAST, ws.updated_at DESC NULLS LAST, ws.id DESC
        LIMIT ${limit}
      `;
      const templates = (rows || []).map((r) => {
        const { gridSize, preview } = buildPreviewFromSliced(r);
        return {
          id: r.id,  // TEXT — the share id
          name: r.name || 'Untitled world',
          gridSize,
          preview,
          templatePrice: Math.max(0, Math.floor(Number(r.template_price) || 0)),
          remixCount: Math.max(0, Number(r.remix_count) || 0),
          authorName: r.author_name || 'Unknown',
        };
      }).filter((w) => Array.isArray(w.preview.cells) && w.preview.cells.length > 0);
      return jsonResponse({ templates }, origin);
    }

    const limit = 12;
    const rows = await sql`
      SELECT id, slug, name, grid_size, data
      FROM worlds
      WHERE status = 'published' AND slug <> ${TINYVERSE_HUB_SLUG}
      ORDER BY published_at DESC NULLS LAST, id DESC
      LIMIT ${limit}
    `;
    // Bound the per-row work BEFORE normalization. A published world's `data` can be
    // up to 20MB; on an unauthenticated route we must not iterate/allocate the whole
    // blob. Clamp gridSize and slice the raw cell list to a small ceiling first — a
    // preview only ever needs the first ~grid^2 cells anyway. (worldPreview also caps,
    // but the cap must come before normalize, not after — Codex review finding.)
    const worlds = (rows || []).map((r) => {
      const { gridSize, preview } = buildPreviewRow(r);
      return {
        id: Number(r.id),
        slug: r.slug,
        name: r.name || 'Untitled world',
        gridSize,
        preview,
      };
    }).filter((w) => Array.isArray(w.preview.cells) && w.preview.cells.length > 0);

    return jsonResponse({ worlds }, origin);
  } catch (err) {
    if (isTemplates) {
      if (isDatabaseUnavailable(err) || isMissingShareSchema(err)) {
        return jsonResponse({ templates: [] }, origin);
      }
    } else {
      if (isDatabaseUnavailable(err) || isMissingWorldSchema(err) || isMissingProfileSchema(err)) {
        return jsonResponse({ worlds: [] }, origin);
      }
    }
    return errorResponse('worlds-featured-failed', 500, origin);
  }
}
