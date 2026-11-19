// Small crypto helpers on Web Crypto (globalThis.crypto), available in Workers and Node 20+.

const enc = new TextEncoder();

export function toHex(bytes) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export function randomHex(nBytes) {
  const b = new Uint8Array(nBytes);
  crypto.getRandomValues(b);
  return toHex(b);
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return toHex(new Uint8Array(digest));
}

// Compares two strings without an early exit on the first differing character.
// Length is not secret here (all inputs are fixed-length hex digests).
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

// ---------------------------------------------------------------- secrets

export const SECRET_BYTES = 32;
export const SECRET_PATTERN = /^[0-9a-f]{64}$/;

export function generateSecret() {
  return randomHex(SECRET_BYTES);
}

// The secret is 256 random bits, so a plain SHA-256 is enough (no salt or stretching needed).
export function hashSecret(secret) {
  return sha256Hex(`secret|${secret}`);
}

// ---------------------------------------------------------------- recovery codes

// No 0/O, 1/I/L: easy to read back from a screenshot or a note.
export const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const RECOVERY_GROUPS = 4;
export const RECOVERY_GROUP_LEN = 4;

export function generateRecovery() {
  const n = RECOVERY_GROUPS * RECOVERY_GROUP_LEN;
  const A = RECOVERY_ALPHABET.length;
  const limit = 256 - (256 % A); // rejection sampling: no modulo bias
  const out = [];
  const buf = new Uint8Array(n * 2);
  while (out.length < n) {
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < limit && out.length < n) out.push(RECOVERY_ALPHABET[b % A]);
    }
  }
  const groups = [];
  for (let i = 0; i < n; i += RECOVERY_GROUP_LEN) groups.push(out.slice(i, i + RECOVERY_GROUP_LEN).join(''));
  return groups.join('-');
}

// Accepts the code typed loosely (lowercase, spaces, missing dashes) and returns the
// canonical form "XXXX-XXXX-XXXX-XXXX", or null if it cannot be a recovery code.
export function normalizeRecovery(input) {
  if (typeof input !== 'string' || input.length > 64) return null;
  const raw = input.toUpperCase().replace(/[\s-]+/g, '');
  const n = RECOVERY_GROUPS * RECOVERY_GROUP_LEN;
  if (raw.length !== n) return null;
  for (const ch of raw) if (!RECOVERY_ALPHABET.includes(ch)) return null;
  const groups = [];
  for (let i = 0; i < n; i += RECOVERY_GROUP_LEN) groups.push(raw.slice(i, i + RECOVERY_GROUP_LEN));
  return groups.join('-');
}

// Bound to the tag key so one hash cannot be reused against another row.
export function hashRecovery(tagKey, canonicalCode) {
  return sha256Hex(`recovery|${tagKey}|${canonicalCode}`);
}

// ---------------------------------------------------------------- IPs

// Only this salted hash of an IP is ever stored.
export function hashIp(ip, salt) {
  return sha256Hex(`ip|${salt}|${ip}`);
}
