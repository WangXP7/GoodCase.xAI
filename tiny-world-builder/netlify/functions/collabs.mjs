import { getSql, isDatabaseUnavailable } from './lib/db.mjs';
import { getAuthUser } from './lib/auth.mjs';
import { corsResponse, errorResponse, jsonResponse, readJson, sameOriginWriteGuard } from './lib/http.mjs';
import { ensureProfile } from './lib/profiles.mjs';
import { isWorldAdminEmail, signJoinToken } from './lib/worlds.mjs';

export const config = { path: '/api/collabs' };

const ACTIVE_WINDOW_SECONDS = 150;
const CLOSED_ROOM_TTL_DAYS = 30;
const HIDDEN_ROOM_TTL_DAYS = 30;
const MAX_NAME = 100;
const MAX_HOST = 80;
const MAX_LOCATION = 80;
const CONTROL_TOKEN_TTL_MS = 10 * 60 * 1000;

function cleanText(value, max = 80) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanId(value) {
  return String(value == null ? '' : value)
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function cleanQuality(value) {
  const q = String(value || '').trim().toLowerCase();
  return ['good', 'fair', 'poor', 'unknown'].includes(q) ? q : 'unknown';
}

function cleanCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(9999, Math.round(n)));
}

function cleanRtt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(60_000, Math.round(n)));
}

function cleanPartyHost(value) {
  const raw = cleanText(value, 180);
  if (!raw) return '';
  if (!/^(wss?:)?\/\//i.test(raw)) return '';
  try {
    const url = new URL(raw.replace(/^\/\//, 'wss://'));
    if (!/^ws:|^wss:$/.test(url.protocol)) return '';
    return url.href.replace(/\/+$/, '');
  } catch (_) {
    return '';
  }
}

function controlSecret() {
  return process.env.WORLDS_JOIN_SECRET || process.env.WORLDS_SERVICE_TOKEN || '';
}

function observerHref(roomId, shareId, partyHost, request) {
  const params = new URLSearchParams();
  if (shareId) params.set('share', shareId);
  params.set('party', roomId);
  params.set('observe', '1');
  try {
    const reqUrl = new URL(request.url);
    const host = partyHost ? new URL(partyHost.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:')) : null;
    const devCaller = /^localhost$|^127\.0\.0\.1$/.test(reqUrl.hostname);
    if (host && devCaller && /^localhost$|^127\.0\.0\.1$/.test(host.hostname)) {
      params.set('partyHost', partyHost);
    }
  } catch (_) {}
  return '/tiny-world-builder?' + params.toString();
}

async function ensureCollabRooms(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS collab_rooms (
      room_id TEXT PRIMARY KEY,
      share_id TEXT,
      name TEXT NOT NULL DEFAULT 'Shared build',
      host_name TEXT NOT NULL DEFAULT 'Builder',
      location TEXT NOT NULL DEFAULT '',
      party_host TEXT NOT NULL DEFAULT '',
      observer_count INTEGER NOT NULL DEFAULT 0,
      player_count INTEGER NOT NULL DEFAULT 0,
      editor_count INTEGER NOT NULL DEFAULT 0,
      network_quality TEXT NOT NULL DEFAULT 'unknown',
      rtt_ms INTEGER,
      owner_auth_id TEXT NOT NULL DEFAULT '',
      owner_profile_id BIGINT,
      href TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE collab_rooms ADD COLUMN IF NOT EXISTS owner_auth_id TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE collab_rooms ADD COLUMN IF NOT EXISTS owner_profile_id BIGINT`;
  await sql`CREATE INDEX IF NOT EXISTS collab_rooms_last_seen_idx ON collab_rooms (last_seen DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS collab_rooms_owner_profile_idx ON collab_rooms (owner_profile_id, last_seen DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS collab_rooms_owner_auth_idx ON collab_rooms (owner_auth_id, last_seen DESC)`;
  await sql`
    CREATE TABLE IF NOT EXISTS collab_room_closures (
      room_id TEXT PRIMARY KEY,
      closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS collab_room_closures_closed_at_idx ON collab_room_closures (closed_at DESC)`;
  await sql`
    DELETE FROM collab_room_closures
    WHERE closed_at < NOW() - (${CLOSED_ROOM_TTL_DAYS} * INTERVAL '1 day')
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS collab_room_hides (
      room_id TEXT PRIMARY KEY,
      hidden_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      hidden_by TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT ''
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS collab_room_hides_hidden_at_idx ON collab_room_hides (hidden_at DESC)`;
  await sql`
    DELETE FROM collab_room_hides
    WHERE hidden_at < NOW() - (${HIDDEN_ROOM_TTL_DAYS} * INTERVAL '1 day')
  `;
}

function collabDto(row) {
  return {
    roomId: row.room_id,
    shareId: row.share_id || '',
    name: row.name,
    host: row.host_name,
    location: row.location || 'Unknown',
    observerCount: Number(row.observer_count) || 0,
    playerCount: Number(row.player_count) || 0,
    editorCount: Number(row.editor_count) || 0,
    networkQuality: row.network_quality || 'unknown',
    rttMs: row.rtt_ms == null ? null : Number(row.rtt_ms),
    href: row.href,
    lastSeen: row.last_seen,
    hidden: !!row.hidden,
  };
}

async function isRoomClosed(sql, roomId) {
  const rows = await sql`
    SELECT room_id
    FROM collab_room_closures
    WHERE room_id = ${roomId}
      AND closed_at > NOW() - (${CLOSED_ROOM_TTL_DAYS} * INTERVAL '1 day')
    LIMIT 1
  `;
  return rows.length > 0;
}

async function isRoomHidden(sql, roomId) {
  const rows = await sql`
    SELECT room_id
    FROM collab_room_hides
    WHERE room_id = ${roomId}
      AND hidden_at > NOW() - (${HIDDEN_ROOM_TTL_DAYS} * INTERVAL '1 day')
    LIMIT 1
  `;
  return rows.length > 0;
}

async function closeCollabRoom(sql, roomId) {
  await sql`
    INSERT INTO collab_room_closures (room_id, closed_at)
    VALUES (${roomId}, NOW())
    ON CONFLICT (room_id) DO UPDATE SET closed_at = EXCLUDED.closed_at
  `;
  await sql`DELETE FROM collab_rooms WHERE room_id = ${roomId}`;
}

async function unhideCollabRoom(sql, roomId) {
  await sql`DELETE FROM collab_room_hides WHERE room_id = ${roomId}`;
}

async function hideCollabRoom(sql, roomId, hiddenBy, reason) {
  await sql`
    INSERT INTO collab_room_hides (room_id, hidden_at, hidden_by, reason)
    VALUES (${roomId}, NOW(), ${cleanText(hiddenBy, 120)}, ${cleanText(reason, 200)})
    ON CONFLICT (room_id) DO UPDATE SET
      hidden_at = EXCLUDED.hidden_at,
      hidden_by = EXCLUDED.hidden_by,
      reason = EXCLUDED.reason
  `;
}

async function requestContext(request) {
  const user = await getAuthUser(request);
  const email = user && user.email;
  const admin = isWorldAdminEmail(email);
  let profile = null;
  if (user && user.id) {
    try { profile = await ensureProfile(user); } catch (_) {}
  }
  return { user, profile, admin };
}

function canControlRow(row, ctx) {
  if (!row || !ctx || !ctx.user) return false;
  if (ctx.admin) return true;
  const authId = String(row.owner_auth_id || '');
  const profileId = Number(row.owner_profile_id);
  if (authId && authId === String(ctx.user.id || '')) return true;
  return !!(ctx.profile && Number.isFinite(profileId) && Number(profileId) === Number(ctx.profile.id));
}

async function collabRoomControlRow(sql, roomId) {
  const rows = await sql`
    SELECT cr.room_id, cr.share_id, cr.owner_auth_id, cr.owner_profile_id,
           ws.owner_auth_id AS share_owner_auth_id, ws.profile_id AS share_profile_id
    FROM collab_rooms cr
    LEFT JOIN world_shares ws ON ws.id = cr.share_id
    WHERE cr.room_id = ${roomId}
    LIMIT 1
  `;
  if (!rows.length) return null;
  const row = rows[0];
  return {
    room_id: row.room_id,
    share_id: row.share_id,
    owner_auth_id: row.owner_auth_id || row.share_owner_auth_id || '',
    owner_profile_id: row.owner_profile_id || row.share_profile_id || null,
  };
}

async function collabShareOwner(sql, shareId) {
  if (!shareId) return { ownerAuthId: '', ownerProfileId: null };
  const rows = await sql`
    SELECT owner_auth_id, profile_id
    FROM world_shares
    WHERE id = ${shareId}
    LIMIT 1
  `;
  if (!rows.length) return { ownerAuthId: '', ownerProfileId: null };
  return {
    ownerAuthId: rows[0].owner_auth_id || '',
    ownerProfileId: rows[0].profile_id || null,
  };
}

function collabControlToken(roomId, ctx) {
  if (!ctx || !ctx.user || !controlSecret()) return '';
  return signJoinToken({
    typ: 'tinyworld-collab-control',
    roomId,
    auth: ctx.user.id,
    profileId: ctx.profile ? Number(ctx.profile.id) : null,
    admin: !!ctx.admin,
  }, controlSecret(), CONTROL_TOKEN_TTL_MS);
}

export default async function collabsFunction(request) {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') return corsResponse(origin);

  try {
    const sql = getSql();
    await ensureCollabRooms(sql);

    if (request.method === 'GET') {
      const url = new URL(request.url);
      const wantsAdmin = url.searchParams.get('admin') === '1';
      const wantsMine = url.searchParams.get('mine') === '1';
      const wantsControl = url.searchParams.get('control') === '1';
      const ctx = (wantsAdmin || wantsMine || wantsControl) ? await requestContext(request) : null;
      if ((wantsAdmin || wantsMine || wantsControl) && (!ctx || !ctx.user)) return errorResponse('Unauthorized', 401, origin);
      const statusRoomId = cleanId(url.searchParams.get('roomId') || url.searchParams.get('room') || '');
      if (statusRoomId) {
        const controlRow = (wantsControl || wantsMine || wantsAdmin) ? await collabRoomControlRow(sql, statusRoomId) : null;
        const canControl = !!(controlRow && canControlRow(controlRow, ctx));
        return jsonResponse({
          roomId: statusRoomId,
          closed: await isRoomClosed(sql, statusRoomId),
          hidden: await isRoomHidden(sql, statusRoomId),
          admin: !!(ctx && ctx.admin),
          canControl,
          controlToken: canControl ? collabControlToken(statusRoomId, ctx) : '',
          activeWindowSeconds: ACTIVE_WINDOW_SECONDS,
        }, origin, 200, { 'Cache-Control': 'no-store' });
      }
      const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || 50));
      if (wantsMine) {
        const rows = await sql`
          SELECT cr.*, (ch.room_id IS NOT NULL) AS hidden
          FROM collab_rooms cr
          LEFT JOIN collab_room_closures cc ON cc.room_id = cr.room_id
            AND cc.closed_at > NOW() - (${CLOSED_ROOM_TTL_DAYS} * INTERVAL '1 day')
          LEFT JOIN collab_room_hides ch ON ch.room_id = cr.room_id
            AND ch.hidden_at > NOW() - (${HIDDEN_ROOM_TTL_DAYS} * INTERVAL '1 day')
          WHERE cr.last_seen > NOW() - (${ACTIVE_WINDOW_SECONDS} * INTERVAL '1 second')
            AND cc.room_id IS NULL
            AND (
              ${!!(ctx && ctx.admin)} = TRUE
              OR cr.owner_auth_id = ${ctx.user.id}
              OR cr.owner_profile_id = ${ctx.profile ? Number(ctx.profile.id) : -1}
            )
          ORDER BY cr.last_seen DESC
          LIMIT ${limit}
        `;
        return jsonResponse({ rooms: rows.map(collabDto), admin: !!ctx.admin, activeWindowSeconds: ACTIVE_WINDOW_SECONDS }, origin, 200, {
          'Cache-Control': 'no-store',
        });
      }
      const rows = await sql`
        SELECT cr.*, FALSE AS hidden
        FROM collab_rooms cr
        LEFT JOIN collab_room_closures cc ON cc.room_id = cr.room_id
          AND cc.closed_at > NOW() - (${CLOSED_ROOM_TTL_DAYS} * INTERVAL '1 day')
        LEFT JOIN collab_room_hides ch ON ch.room_id = cr.room_id
          AND ch.hidden_at > NOW() - (${HIDDEN_ROOM_TTL_DAYS} * INTERVAL '1 day')
        WHERE cr.last_seen > NOW() - (${ACTIVE_WINDOW_SECONDS} * INTERVAL '1 second')
          AND cc.room_id IS NULL
          AND ch.room_id IS NULL
        ORDER BY cr.last_seen DESC
        LIMIT ${limit}
      `;
      return jsonResponse({ rooms: rows.map(collabDto), admin: !!(ctx && ctx.admin), activeWindowSeconds: ACTIVE_WINDOW_SECONDS }, origin, 200, {
        'Cache-Control': 'no-store',
      });
    }

    if (request.method === 'DELETE') {
      if (!sameOriginWriteGuard(request)) return errorResponse('Forbidden', 403, origin);
      const ctx = await requestContext(request);
      const url = new URL(request.url);
      const roomId = cleanId(url.searchParams.get('roomId') || url.searchParams.get('room') || url.searchParams.get('party') || '');
      if (!roomId) return errorResponse('Missing room id', 400, origin);
      const controlRow = await collabRoomControlRow(sql, roomId);
      if (!canControlRow(controlRow, ctx)) return errorResponse('Room owner or admin required', 403, origin);
      await closeCollabRoom(sql, roomId);
      return jsonResponse({ roomId, closed: true }, origin, 200, { 'Cache-Control': 'no-store' });
    }

    if (request.method === 'POST') {
      if (!sameOriginWriteGuard(request)) return errorResponse('Forbidden', 403, origin);
      const body = await readJson(request, 16_384);
      if (!body || typeof body !== 'object') return errorResponse('Invalid JSON body', 400, origin);

      const roomId = cleanId(body.roomId || body.room || body.party);
      if (!roomId) return errorResponse('Missing room id', 400, origin);
      const action = String(body.action || body.type || '').trim().toLowerCase();
      if (action === 'hide' || action === 'private') {
        const ctx = await requestContext(request);
        const controlRow = await collabRoomControlRow(sql, roomId);
        if (!canControlRow(controlRow, ctx)) return errorResponse('Room owner or admin required', 403, origin);
        await hideCollabRoom(sql, roomId, (ctx.user.email || ctx.user.id || 'admin'), body.reason || '');
        return jsonResponse({ roomId, hidden: true }, origin, 200, { 'Cache-Control': 'no-store' });
      }
      if (action === 'unhide' || action === 'public') {
        const ctx = await requestContext(request);
        const controlRow = await collabRoomControlRow(sql, roomId);
        if (!canControlRow(controlRow, ctx)) return errorResponse('Room owner or admin required', 403, origin);
        await unhideCollabRoom(sql, roomId);
        return jsonResponse({ roomId, hidden: false }, origin, 200, { 'Cache-Control': 'no-store' });
      }
      if (action === 'adminclose' || action === 'ownerclose' || action === 'forceclose') {
        const ctx = await requestContext(request);
        const controlRow = await collabRoomControlRow(sql, roomId);
        if (!canControlRow(controlRow, ctx)) return errorResponse('Room owner or admin required', 403, origin);
        await closeCollabRoom(sql, roomId);
        return jsonResponse({ roomId, closed: true }, origin, 200, { 'Cache-Control': 'no-store' });
      }
      if (action === 'close' || action === 'delete' || action === 'stop') {
        await closeCollabRoom(sql, roomId);
        return jsonResponse({ roomId, closed: true }, origin, 200, { 'Cache-Control': 'no-store' });
      }
      if (await isRoomClosed(sql, roomId)) {
        return jsonResponse({ roomId, closed: true }, origin, 200, { 'Cache-Control': 'no-store' });
      }
      const shareId = cleanId(body.shareId || body.share || '');
      const owner = await collabShareOwner(sql, shareId);
      const partyHost = cleanPartyHost(body.partyHost || '');
      const network = body.network && typeof body.network === 'object' ? body.network : {};
      const quality = cleanQuality(body.networkQuality || network.quality);
      const rttMs = cleanRtt(body.rttMs == null ? network.rttMs : body.rttMs);
      const href = observerHref(roomId, shareId, partyHost, request);
      const name = cleanText(body.name, MAX_NAME) || 'Shared build';
      const hostName = cleanText(body.hostName || body.host, MAX_HOST) || 'Builder';
      const location = cleanText(body.location, MAX_LOCATION);
      const observerCount = cleanCount(body.observerCount || body.observers);
      const playerCount = cleanCount(body.playerCount || body.players);
      const editorCount = cleanCount(body.editorCount || body.editors);

      const rows = await sql`
        INSERT INTO collab_rooms (
          room_id, share_id, name, host_name, location, party_host, owner_auth_id, owner_profile_id,
          observer_count, player_count, editor_count, network_quality, rtt_ms, href,
          created_at, last_seen
        )
        VALUES (
          ${roomId}, ${shareId || null}, ${name}, ${hostName}, ${location}, ${partyHost}, ${owner.ownerAuthId}, ${owner.ownerProfileId},
          ${observerCount}, ${playerCount}, ${editorCount}, ${quality}, ${rttMs}, ${href},
          NOW(), NOW()
        )
        ON CONFLICT (room_id) DO UPDATE SET
          share_id = EXCLUDED.share_id,
          name = EXCLUDED.name,
          host_name = EXCLUDED.host_name,
          location = EXCLUDED.location,
          party_host = EXCLUDED.party_host,
          owner_auth_id = CASE WHEN EXCLUDED.owner_auth_id <> '' THEN EXCLUDED.owner_auth_id ELSE collab_rooms.owner_auth_id END,
          owner_profile_id = COALESCE(EXCLUDED.owner_profile_id, collab_rooms.owner_profile_id),
          observer_count = EXCLUDED.observer_count,
          player_count = EXCLUDED.player_count,
          editor_count = EXCLUDED.editor_count,
          network_quality = EXCLUDED.network_quality,
          rtt_ms = EXCLUDED.rtt_ms,
          href = EXCLUDED.href,
          last_seen = NOW()
        RETURNING *
      `;
      return jsonResponse({ room: collabDto(rows[0]) }, origin, 200, { 'Cache-Control': 'no-store' });
    }

    return errorResponse('Method not allowed', 405, origin);
  } catch (err) {
    if (isDatabaseUnavailable(err)) {
      return errorResponse('Netlify Database is not available in this local session.', 503, origin);
    }
    console.error('[collabs]', err);
    return errorResponse('Collab rooms request failed', 500, origin);
  }
}
