import { randomBytes } from 'node:crypto';
import { requireAuthUser } from './lib/auth.mjs';
import { getSql, isDatabaseUnavailable, isMissingRelations } from './lib/db.mjs';
import { corsResponse, errorResponse, jsonResponse, readJson, sameOriginWriteGuard } from './lib/http.mjs';
import { ensureProfile, profileDto } from './lib/profiles.mjs';

export const config = { path: '/api/players' };

function cleanText(value, limit) {
  return String(value || '').trim().slice(0, limit);
}

function cleanProfileId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function partyId() {
  return randomBytes(9).toString('base64url');
}

const PLAYER_SCHEMA_RELATIONS = [
  'player_presence',
  'player_chat_requests',
  'player_parties',
  'player_party_members',
  'wallet_accounts',
];

function isMissingPlayerSchema(err) {
  return isMissingRelations(err, PLAYER_SCHEMA_RELATIONS);
}

function roomIdForParty(id) {
  return 'party-' + String(id || '').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 40);
}

function playerDto(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    about: row.about || '',
    image: row.image || '',
    online: !!row.online,
    lastSeenAt: row.last_seen_at || null,
    status: row.status || 'offline',
    roomId: row.room_id || '',
    walletPublicKey: row.public_key || '',
    tokenBalance: row.token_balance_ui || '0',
    hasTinyworldTokens: String(row.token_balance_atomic || '0') !== '0',
  };
}

function chatRequestDto(row, selfId) {
  return {
    id: row.id,
    status: row.status,
    direction: Number(row.requester_profile_id) === Number(selfId) ? 'outgoing' : 'incoming',
    requester: {
      id: row.requester_profile_id,
      username: row.requester_username,
      displayName: row.requester_display_name,
      image: row.requester_image || '',
    },
    recipient: {
      id: row.recipient_profile_id,
      username: row.recipient_username,
      displayName: row.recipient_display_name,
      image: row.recipient_image || '',
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function partyDto(row, origin) {
  const url = '/tiny-world-builder?party=' + encodeURIComponent(row.room_id);
  return {
    id: row.id,
    name: row.name,
    roomId: row.room_id,
    voiceRoom: row.voice_room || row.room_id,
    role: row.member_role || row.owner_role || 'member',
    url,
    absoluteUrl: origin ? new URL(url, origin).href : url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function touchPresence(sql, profile, body = {}) {
  const status = cleanText(body.status || 'online', 24) || 'online';
  const roomId = cleanText(body.roomId, 120);
  const party = cleanText(body.partyId, 120);
  await sql`
    INSERT INTO player_presence (profile_id, status, room_id, party_id, last_seen_at)
    VALUES (${profile.id}, ${status}, ${roomId || null}, ${party || null}, NOW())
    ON CONFLICT (profile_id) DO UPDATE
      SET status = EXCLUDED.status,
          room_id = EXCLUDED.room_id,
          party_id = EXCLUDED.party_id,
          last_seen_at = NOW(),
          updated_at = NOW()
  `;
}

async function playerStats(sql) {
  const rows = await sql`
    SELECT
      (SELECT count(*) FROM player_presence WHERE last_seen_at > NOW() - INTERVAL '5 minutes') AS online,
      (SELECT count(*) FROM profiles) AS profiles,
      (SELECT count(*) FROM wallet_accounts) AS wallets,
      (SELECT count(*) FROM wallet_accounts WHERE COALESCE(token_balance_atomic, '0') <> '0') AS holders,
      (SELECT count(*) FROM player_parties) AS parties
  `;
  const row = rows[0] || {};
  return {
    online: Number(row.online) || 0,
    profiles: Number(row.profiles) || 0,
    wallets: Number(row.wallets) || 0,
    tokenHolders: Number(row.holders) || 0,
    parties: Number(row.parties) || 0,
  };
}

async function listPlayers(sql, selfId, options = {}) {
  const q = cleanText(options.q, 48);
  const onlineOnly = !!options.onlineOnly;
  const like = '%' + q.replace(/[%_]/g, '') + '%';
  const rows = await sql`
    SELECT p.id, p.username, p.display_name, p.about, p.image,
           pr.status, pr.room_id, pr.last_seen_at,
           (pr.last_seen_at > NOW() - INTERVAL '5 minutes') AS online,
           wa.public_key, wa.token_balance_ui, wa.token_balance_atomic
    FROM profiles p
    LEFT JOIN player_presence pr ON pr.profile_id = p.id
    LEFT JOIN wallet_accounts wa ON wa.profile_id = p.id AND wa.provider = 'phantom'
    WHERE p.id <> ${selfId}
      AND (${q ? sql`(p.username ILIKE ${like} OR p.display_name ILIKE ${like})` : sql`TRUE`})
      AND (${onlineOnly ? sql`pr.last_seen_at > NOW() - INTERVAL '5 minutes'` : sql`TRUE`})
    ORDER BY (pr.last_seen_at > NOW() - INTERVAL '5 minutes') DESC,
             pr.last_seen_at DESC NULLS LAST,
             p.display_name ASC
    LIMIT 30
  `;
  return rows.map(playerDto);
}

async function listRequests(sql, profileId) {
  const rows = await sql`
    SELECT r.*,
           rp.username AS requester_username, rp.display_name AS requester_display_name, rp.image AS requester_image,
           tp.username AS recipient_username, tp.display_name AS recipient_display_name, tp.image AS recipient_image
    FROM player_chat_requests r
    JOIN profiles rp ON rp.id = r.requester_profile_id
    JOIN profiles tp ON tp.id = r.recipient_profile_id
    WHERE r.requester_profile_id = ${profileId} OR r.recipient_profile_id = ${profileId}
    ORDER BY r.updated_at DESC
    LIMIT 30
  `;
  return rows.map(row => chatRequestDto(row, profileId));
}

async function listParties(sql, profileId, origin) {
  const rows = await sql`
    SELECT pp.*, pm.role AS member_role
    FROM player_parties pp
    JOIN player_party_members pm ON pm.party_id = pp.id
    WHERE pm.profile_id = ${profileId}
    ORDER BY pp.updated_at DESC
    LIMIT 30
  `;
  return rows.map(row => partyDto(row, origin));
}

export default async function playersFunction(request) {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') return corsResponse(origin);

  const auth = await requireAuthUser(request, origin);
  if (auth.response) return auth.response;

  try {
    const sql = getSql();
    const profile = await ensureProfile(auth.user);
    const url = new URL(request.url);

    if (request.method === 'GET') {
      await touchPresence(sql, profile, {
        roomId: url.searchParams.get('roomId') || '',
        partyId: url.searchParams.get('partyId') || '',
      });
      const q = url.searchParams.get('q') || '';
      const onlineOnly = url.searchParams.get('online') === '1';
      const [stats, players, requests, parties] = await Promise.all([
        playerStats(sql),
        listPlayers(sql, profile.id, { q, onlineOnly }),
        listRequests(sql, profile.id),
        listParties(sql, profile.id, origin || new URL(request.url).origin),
      ]);
      return jsonResponse({
        me: profileDto(profile),
        stats,
        players,
        requests,
        parties,
      }, origin);
    }

    if (request.method !== 'POST') return errorResponse('Method not allowed', 405, origin);
    if (!sameOriginWriteGuard(request)) return errorResponse('Forbidden', 403, origin);
    const body = await readJson(request);
    const action = cleanText(body && body.action, 32);

    if (action === 'heartbeat') {
      await touchPresence(sql, profile, body || {});
      return jsonResponse({ ok: true }, origin);
    }

    if (action === 'chatRequest') {
      const recipientId = cleanProfileId(body && body.recipientProfileId);
      if (!recipientId || recipientId === Number(profile.id)) return errorResponse('Invalid chat recipient', 400, origin);
      const exists = await sql`SELECT id FROM profiles WHERE id = ${recipientId} LIMIT 1`;
      if (!exists.length) return errorResponse('Player not found', 404, origin);
      const rows = await sql`
        INSERT INTO player_chat_requests (requester_profile_id, recipient_profile_id, status)
        VALUES (${profile.id}, ${recipientId}, 'pending')
        ON CONFLICT (requester_profile_id, recipient_profile_id) DO UPDATE
          SET status = 'pending',
              updated_at = NOW()
        RETURNING id, requester_profile_id, recipient_profile_id, status, created_at, updated_at
      `;
      return jsonResponse({ request: rows[0] }, origin, 201);
    }

    if (action === 'respondChatRequest') {
      const requestId = cleanProfileId(body && body.requestId);
      const status = cleanText(body && body.status, 16);
      if (!requestId || !['accepted', 'declined'].includes(status)) return errorResponse('Invalid chat response', 400, origin);
      const rows = await sql`
        UPDATE player_chat_requests
        SET status = ${status},
            updated_at = NOW()
        WHERE id = ${requestId} AND recipient_profile_id = ${profile.id}
        RETURNING id, requester_profile_id, recipient_profile_id, status, created_at, updated_at
      `;
      if (!rows.length) return errorResponse('Chat request not found', 404, origin);
      return jsonResponse({ request: rows[0] }, origin);
    }

    if (action === 'createParty') {
      const id = partyId();
      const roomId = roomIdForParty(id);
      const name = cleanText(body && body.name, 80) || 'TinyWorld party';
      const memberIds = Array.isArray(body && body.memberProfileIds)
        ? body.memberProfileIds.map(cleanProfileId).filter(Boolean).filter(n => n !== Number(profile.id)).slice(0, 12)
        : [];
      const rows = await sql`
        INSERT INTO player_parties (id, owner_profile_id, name, room_id, voice_room)
        VALUES (${id}, ${profile.id}, ${name}, ${roomId}, ${roomId})
        RETURNING *
      `;
      await sql`
        INSERT INTO player_party_members (party_id, profile_id, role)
        VALUES (${id}, ${profile.id}, 'owner')
        ON CONFLICT (party_id, profile_id) DO NOTHING
      `;
      for (const memberId of memberIds) {
        await sql`
          INSERT INTO player_party_members (party_id, profile_id, role)
          VALUES (${id}, ${memberId}, 'member')
          ON CONFLICT (party_id, profile_id) DO NOTHING
        `;
      }
      return jsonResponse({ party: partyDto(Object.assign({}, rows[0], { member_role: 'owner' }), origin || new URL(request.url).origin) }, origin, 201);
    }

    if (action === 'joinParty') {
      const id = cleanText(body && body.partyId, 80);
      if (!id) return errorResponse('Missing party id', 400, origin);
      const partyRows = await sql`SELECT * FROM player_parties WHERE id = ${id} LIMIT 1`;
      if (!partyRows.length) return errorResponse('Party not found', 404, origin);
      await sql`
        INSERT INTO player_party_members (party_id, profile_id, role)
        VALUES (${id}, ${profile.id}, 'member')
        ON CONFLICT (party_id, profile_id) DO NOTHING
      `;
      return jsonResponse({ party: partyDto(Object.assign({}, partyRows[0], { member_role: 'member' }), origin || new URL(request.url).origin) }, origin);
    }

    return errorResponse('Unknown player action', 400, origin);
  } catch (err) {
    if (isDatabaseUnavailable(err)) {
      return errorResponse('Netlify Database is not available in this local session.', 503, origin);
    }
    if (isMissingPlayerSchema(err)) {
      return errorResponse('Player database tables are missing. Run the Netlify database migrations for wallet/player social features.', 503, origin);
    }
    console.error('[players]', err);
    return errorResponse('Player request failed', 500, origin);
  }
}
