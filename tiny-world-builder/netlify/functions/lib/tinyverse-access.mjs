import { errorResponse } from './http.mjs';

const TINYVERSE_ACCESS_DEFAULT_EMAILS = [
  'jason@bouncingfish.com',
  'simongarthfarmer@gmail.com',
];

function cleanTinyverseEmail(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

export function tinyverseAccessEmails() {
  // The hard-coded owner accounts, plus any added via the TINYVERSE_ACCESS_EMAILS env
  // (comma-separated) — lets the owner widen the dark-launch allowlist without a deploy.
  const set = new Set(TINYVERSE_ACCESS_DEFAULT_EMAILS);
  const extra = String(process.env.TINYVERSE_ACCESS_EMAILS || '');
  for (const e of extra.split(',')) {
    const c = cleanTinyverseEmail(e);
    if (c) set.add(c);
  }
  return set;
}

export function isTinyverseAccessEmail(email) {
  const e = cleanTinyverseEmail(email);
  if (!e) return false;
  return tinyverseAccessEmails().has(e);
}

export function tinyverseLobbyAccessForEmail(email) {
  return isTinyverseAccessEmail(email);
}

// Dark-launch gate for the economy: the whole tinyverse economy (GOLD, coins,
// marketplace, referrals, paid AI, Stripe) is live on prod but reachable only by
// allowlisted (verified) accounts. Call AFTER requireAuthUser succeeds, passing the
// verified auth.user. Returns a 403 Response to return, or null if access is allowed.
export function requireTinyverseAccess(user, origin) {
  if (isTinyverseAccessEmail(user && user.email)) return null;
  // Shared CORS allowlist (no Allow-Credentials): reflecting any origin with
  // credentials enabled would let arbitrary sites read authenticated responses.
  return errorResponse('tinyverse-access-required', 403, origin);
}
