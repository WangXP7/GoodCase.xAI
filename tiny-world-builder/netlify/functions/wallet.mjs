import { createPublicKey, randomBytes, verify } from 'node:crypto';
import {
  createWalletLoginChallengeToken,
  createWalletSessionToken,
  requireAuthUser,
  verifyWalletLoginChallengeToken,
  walletSessionAuthConfigured,
  walletUserFromPublicKey,
} from './lib/auth.mjs';
import { getSql, isDatabaseUnavailable, isMissingRelations } from './lib/db.mjs';
import { corsResponse, errorResponse, jsonResponse, readJson, sameOriginWriteGuard } from './lib/http.mjs';
import { ensureProfile, profileDto } from './lib/profiles.mjs';
import {
  activityForWallet,
  base58ToBytes,
  formatAtomicAmount,
  isSolanaPublicKey,
  solanaEnv,
  tokenSummaryForOwner,
} from './lib/solana.mjs';

export const config = { path: '/api/wallet' };

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const WALLET_SCHEMA_RELATIONS = ['wallet_accounts', 'wallet_auth_challenges'];

function isMissingWalletSchema(err) {
  return isMissingRelations(err, WALLET_SCHEMA_RELATIONS);
}

function walletDto(row) {
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    publicKey: row.public_key,
    verifiedAt: row.verified_at,
    tokenBalance: row.token_balance_ui || '0',
    tokenBalanceAtomic: row.token_balance_atomic || '0',
    tokenDecimals: Number(row.token_decimals) || 0,
    updatedAt: row.updated_at,
  };
}

function bytesFromSignature(value) {
  if (Array.isArray(value)) return Buffer.from(value.map(n => Number(n) & 0xff));
  const text = String(value || '').trim();
  if (!text) return null;
  if (/^[0-9a-f]+$/i.test(text) && text.length % 2 === 0) return Buffer.from(text, 'hex');
  try { return Buffer.from(text, 'base64'); } catch (_) {}
  try { return Buffer.from(base58ToBytes(text)); } catch (_) {}
  return null;
}

function verifyWalletSignature(publicKey, message, signature) {
  if (!isSolanaPublicKey(publicKey) || typeof message !== 'string') return false;
  const sig = bytesFromSignature(signature);
  if (!sig || sig.length !== 64) return false;
  const rawPublicKey = Buffer.from(base58ToBytes(publicKey));
  const key = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, rawPublicKey]),
    format: 'der',
    type: 'spki',
  });
  return verify(null, Buffer.from(message, 'utf8'), key, sig);
}

function challengeMessage(publicKey, nonce, issuedAt) {
  return [
    'Tiny World Builder wallet login',
    'Provider: Phantom',
    'Public key: ' + publicKey,
    'Nonce: ' + nonce,
    'Issued at: ' + issuedAt,
  ].join('\n');
}

function walletLoginNotConfiguredResponse(origin) {
  return errorResponse('Wallet login is not configured. Set TINYWORLD_WALLET_SESSION_SECRET.', 503, origin);
}

function walletLoginUserDto(user, publicKey) {
  return {
    id: user.id,
    name: user.name || '',
    walletPublicKey: publicKey,
    provider: 'phantom',
  };
}

// Sentinel thrown when a wallet is already linked to a different non-anonymous
// profile, so the caller can return a 409 instead of silently reassigning
// ownership.
class WalletOwnedByOtherProfile extends Error {}

function walletAuthId(publicKey) {
  return 'wallet:' + publicKey;
}

function sameProfileId(a, b) {
  return String(a) === String(b);
}

async function linkedWalletOwner(sql, publicKey) {
  // public_key is globally unique (migration: wallet_accounts_public_key_unique).
  // Without checking the owner, ON CONFLICT DO UPDATE would flip an existing
  // wallet's owner from another profile to this one, defeating the per-profile
  // payment authorization in world-claim.mjs.
  const rows = await sql`
    SELECT wa.id AS wallet_id, wa.profile_id, p.auth0_id
    FROM wallet_accounts wa
    JOIN profiles p ON p.id = wa.profile_id
    WHERE wa.public_key = ${publicKey}
    LIMIT 1
  `;
  return rows[0] || null;
}

async function archiveAnonymousWalletProfile(sql, anonymousProfileId, targetProfileId) {
  await sql`
    UPDATE profiles
    SET archived_at = COALESCE(archived_at, NOW()),
        merged_into_profile_id = ${targetProfileId},
        merged_reason = 'wallet_account_merge',
        updated_at = NOW()
    WHERE id = ${anonymousProfileId}
      AND auth0_id LIKE 'wallet:%'
  `;
}

async function moveAnonymousWalletToProfile(sql, profile, publicKey, owner) {
  if (!owner || sameProfileId(owner.profile_id, profile.id)) return false;
  if (owner.auth0_id !== walletAuthId(publicKey)) {
    throw new WalletOwnedByOtherProfile('Wallet already linked to another account');
  }
  await sql.begin(async tx => {
    await tx`
      DELETE FROM wallet_accounts
      WHERE profile_id = ${profile.id}
        AND provider = 'phantom'
        AND public_key <> ${publicKey}
    `;
    await tx`
      UPDATE wallet_accounts
      SET profile_id = ${profile.id},
          provider = 'phantom',
          verified_at = NOW(),
          updated_at = NOW()
      WHERE id = ${owner.wallet_id}
    `;
    await archiveAnonymousWalletProfile(tx, owner.profile_id, profile.id);
  });
  return true;
}

async function linkWalletToProfile(sql, profile, publicKey, options = {}) {
  const existingOwner = await linkedWalletOwner(sql, publicKey);
  if (existingOwner && !sameProfileId(existingOwner.profile_id, profile.id)) {
    if (options.mergeAnonymousWalletProfile) {
      const moved = await moveAnonymousWalletToProfile(sql, profile, publicKey, existingOwner);
      if (moved) return { mergedAnonymousProfileId: existingOwner.profile_id };
    }
    throw new WalletOwnedByOtherProfile('Wallet already linked to another account');
  }
  await sql`
    DELETE FROM wallet_accounts
    WHERE profile_id = ${profile.id}
      AND provider = 'phantom'
      AND public_key <> ${publicKey}
  `;
  await sql`
    INSERT INTO wallet_accounts (profile_id, provider, public_key, verified_at)
    VALUES (${profile.id}, 'phantom', ${publicKey}, NOW())
    ON CONFLICT (public_key) DO UPDATE
      SET profile_id = EXCLUDED.profile_id,
          provider = EXCLUDED.provider,
          verified_at = NOW(),
          updated_at = NOW()
  `;
  return { mergedAnonymousProfileId: null };
}

async function walletPayload(sql, profile, options = {}) {
  const rows = await sql`
    SELECT *
    FROM wallet_accounts
    WHERE profile_id = ${profile.id}
    ORDER BY verified_at DESC
    LIMIT 1
  `;
  const wallet = rows[0] || null;
  const mint = solanaEnv('TINYWORLD_TOKEN_MINT', '');
  let token = {
    configured: !!mint,
    mint,
    symbol: solanaEnv('TINYWORLD_TOKEN_SYMBOL', 'TINYWORLD'),
    amount: wallet ? (wallet.token_balance_atomic || '0') : '0',
    decimals: wallet ? (Number(wallet.token_decimals) || 0) : 0,
    uiAmount: wallet ? (wallet.token_balance_ui || '0') : '0',
    accounts: [],
  };
  let activity = [];
  if (wallet && wallet.public_key && (options.refresh !== false)) {
    try {
      token = await tokenSummaryForOwner(wallet.public_key, mint);
      activity = await activityForWallet(wallet.public_key, token.accounts);
      await sql`
        UPDATE wallet_accounts
        SET token_balance_atomic = ${token.amount},
            token_balance_ui = ${token.uiAmount},
            token_decimals = ${token.decimals},
            token_accounts = ${sql.json(token.accounts)},
            last_activity = ${sql.json(activity)},
            updated_at = NOW()
        WHERE id = ${wallet.id}
      `;
      wallet.token_balance_atomic = token.amount;
      wallet.token_balance_ui = token.uiAmount;
      wallet.token_decimals = token.decimals;
      wallet.updated_at = new Date().toISOString();
    } catch (err) {
      token.error = err && err.message ? err.message : 'Token lookup failed';
      activity = Array.isArray(wallet.last_activity) ? wallet.last_activity : [];
    }
  } else if (wallet) {
    activity = Array.isArray(wallet.last_activity) ? wallet.last_activity : [];
  }
  return {
    wallet: walletDto(wallet),
    token: Object.assign({}, token, {
      uiAmount: token.uiAmount || formatAtomicAmount(token.amount, token.decimals),
    }),
    activity,
  };
}

export default async function walletFunction(request) {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') return corsResponse(origin);

  try {
    if (request.method === 'GET') {
      const auth = await requireAuthUser(request, origin);
      if (auth.response) return auth.response;
      const sql = getSql();
      const profile = await ensureProfile(auth.user);
      return jsonResponse(await walletPayload(sql, profile), origin);
    }

    if (request.method !== 'POST') return errorResponse('Method not allowed', 405, origin);
    if (!sameOriginWriteGuard(request)) return errorResponse('Forbidden', 403, origin);

    const body = await readJson(request);
    const action = String((body && body.action) || '').trim();

    if (action === 'loginChallenge') {
      if (!walletSessionAuthConfigured()) return walletLoginNotConfiguredResponse(origin);
      const publicKey = String((body && body.publicKey) || '').trim();
      if (!isSolanaPublicKey(publicKey)) return errorResponse('Invalid Solana public key', 400, origin);
      const nonce = randomBytes(18).toString('base64url');
      const issuedAt = new Date().toISOString();
      const message = challengeMessage(publicKey, nonce, issuedAt);
      const challengeToken = createWalletLoginChallengeToken(publicKey, message, nonce, issuedAt);
      return jsonResponse({
        publicKey,
        nonce,
        message,
        challengeToken,
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      }, origin, 201);
    }

    if (action === 'login') {
      if (!walletSessionAuthConfigured()) return walletLoginNotConfiguredResponse(origin);
      const publicKey = String((body && body.publicKey) || '').trim();
      const message = String((body && body.message) || '');
      const challengeToken = String((body && body.challengeToken) || '');
      if (!isSolanaPublicKey(publicKey) || !message || !challengeToken) {
        return errorResponse('Invalid wallet login payload', 400, origin);
      }
      const challenge = verifyWalletLoginChallengeToken(challengeToken, publicKey, message);
      if (!challenge) return errorResponse('Wallet challenge expired', 401, origin);
      if (!verifyWalletSignature(publicKey, message, body.signature)) {
        return errorResponse('Wallet signature verification failed', 401, origin);
      }
      const user = walletUserFromPublicKey(publicKey);
      if (!user) return errorResponse('Invalid Solana public key', 400, origin);
      const sql = getSql();
      const profile = await ensureProfile(user);
      // Consume the stateless challenge nonce so a captured signature can't be
      // replayed for the rest of the token's 10-minute TTL. The signed token itself
      // is stateless, so consumption is recorded in the same wallet_auth_challenges
      // table the DB-backed connect path consumes via consumed_at: insert a
      // consumed marker row unless one already exists for this (key, nonce).
      // No unique index on (public_key, nonce) exists, so two truly concurrent
      // replays can race past the NOT EXISTS check — but that shrinks the replay
      // window from 10 minutes to same-millisecond timing.
      const consumed = await sql`
        INSERT INTO wallet_auth_challenges (profile_id, public_key, nonce, message, expires_at, consumed_at)
        SELECT ${profile.id}, ${publicKey}, ${challenge.nonce}, ${message}, NOW(), NOW()
        WHERE NOT EXISTS (
          SELECT 1 FROM wallet_auth_challenges
          WHERE public_key = ${publicKey} AND nonce = ${challenge.nonce} AND consumed_at IS NOT NULL
        )
        RETURNING id
      `;
      if (!consumed.length) return errorResponse('Wallet challenge expired', 401, origin);
      await linkWalletToProfile(sql, profile, publicKey);
      const sessionToken = createWalletSessionToken(publicKey);
      const payload = await walletPayload(sql, profile);
      return jsonResponse(Object.assign(payload, {
        sessionToken,
        user: walletLoginUserDto(user, publicKey),
        profile: profileDto(profile),
      }), origin, 201);
    }

    const auth = await requireAuthUser(request, origin);
    if (auth.response) return auth.response;
    const sql = getSql();
    const profile = await ensureProfile(auth.user);

    if (action === 'challenge') {
      const publicKey = String((body && body.publicKey) || '').trim();
      if (!isSolanaPublicKey(publicKey)) return errorResponse('Invalid Solana public key', 400, origin);
      const nonce = randomBytes(18).toString('base64url');
      const issuedAt = new Date().toISOString();
      const message = challengeMessage(publicKey, nonce, issuedAt);
      await sql`
        INSERT INTO wallet_auth_challenges (profile_id, public_key, nonce, message, expires_at)
        VALUES (${profile.id}, ${publicKey}, ${nonce}, ${message}, NOW() + INTERVAL '10 minutes')
      `;
      return jsonResponse({ publicKey, nonce, message, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() }, origin, 201);
    }

    if (action === 'connect') {
      const publicKey = String((body && body.publicKey) || '').trim();
      const message = String((body && body.message) || '');
      if (!isSolanaPublicKey(publicKey) || !message) return errorResponse('Invalid wallet login payload', 400, origin);
      const challenges = await sql`
        SELECT id
        FROM wallet_auth_challenges
        WHERE profile_id = ${profile.id}
          AND public_key = ${publicKey}
          AND message = ${message}
          AND consumed_at IS NULL
          AND expires_at > NOW()
        ORDER BY created_at DESC
        LIMIT 1
      `;
      if (!challenges.length) return errorResponse('Wallet challenge expired', 401, origin);
      if (!verifyWalletSignature(publicKey, message, body.signature)) {
        return errorResponse('Wallet signature verification failed', 401, origin);
      }
      await sql`
        UPDATE wallet_auth_challenges
        SET consumed_at = NOW()
        WHERE id = ${challenges[0].id}
      `;
      const result = await linkWalletToProfile(sql, profile, publicKey, {
        mergeAnonymousWalletProfile: true,
      });
      const payload = await walletPayload(sql, profile);
      return jsonResponse(Object.assign(payload, {
        accountMerge: result.mergedAnonymousProfileId ? {
          archivedProfileId: result.mergedAnonymousProfileId,
          targetProfileId: profile.id,
        } : null,
      }), origin, 201);
    }

    if (action === 'disconnect') {
      await sql`
        DELETE FROM wallet_accounts
        WHERE profile_id = ${profile.id} AND provider = 'phantom'
      `;
      return jsonResponse({ wallet: null, token: { configured: !!solanaEnv('TINYWORLD_TOKEN_MINT', ''), uiAmount: '0' }, activity: [] }, origin);
    }

    if (action === 'refresh') {
      return jsonResponse(await walletPayload(sql, profile), origin);
    }

    return errorResponse('Unknown wallet action', 400, origin);
  } catch (err) {
    if (err instanceof WalletOwnedByOtherProfile) {
      return errorResponse('This wallet is already linked to another account', 409, origin);
    }
    if (isDatabaseUnavailable(err)) {
      return errorResponse('Netlify Database is not available in this local session.', 503, origin);
    }
    if (isMissingWalletSchema(err)) {
      return errorResponse('Wallet database tables are missing. Run the Netlify database migrations for wallet/social features.', 503, origin);
    }
    console.error('[wallet]', err);
    return errorResponse('Wallet request failed', 500, origin);
  }
}
