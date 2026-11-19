import { createHash, timingSafeEqual } from 'node:crypto';

// Shared TINYWORLD_ADMIN_SECRET gate (features/roadmap/feature-flags/community
// local-dev fallbacks + gold-payout). A secret shorter than this is treated as
// unset so the endpoints fail closed instead of running weakly guarded.
const MIN_ADMIN_SECRET_LENGTH = 16;

function envValue(name) {
  try {
    if (globalThis.Netlify && Netlify.env && typeof Netlify.env.get === 'function') {
      const value = Netlify.env.get(name);
      if (value) return value;
    }
  } catch (_) {}
  return process.env[name] || '';
}

// Hash both sides to a fixed 32 bytes so the compare never leaks length and is
// always constant-time. Fails closed when the secret is unset or too short.
export function adminSecretEquals(provided) {
  const secret = envValue('TINYWORLD_ADMIN_SECRET');
  if (!secret || secret.length < MIN_ADMIN_SECRET_LENGTH) return false;
  const a = createHash('sha256').update(String(provided == null ? '' : provided)).digest();
  const b = createHash('sha256').update(secret).digest();
  return timingSafeEqual(a, b);
}

export function requestHasAdminSecret(request) {
  return adminSecretEquals(request.headers.get('x-admin-secret') || '');
}
