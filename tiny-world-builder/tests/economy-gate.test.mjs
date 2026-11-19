import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireTinyverseAccess, isTinyverseAccessEmail } from '../netlify/functions/lib/tinyverse-access.mjs';

test('owner emails pass the economy gate (null = allowed)', () => {
  for (const e of ['jason@bouncingfish.com', 'simongarthfarmer@gmail.com', '  SimonGarthFarmer@Gmail.com ']) {
    assert.equal(requireTinyverseAccess({ email: e }, 'https://x'), null);
  }
});

test('non-owner / missing email is blocked with 403', async () => {
  for (const u of [{ email: 'random@user.com' }, { email: '' }, {}, null]) {
    const r = requireTinyverseAccess(u, 'https://x');
    assert.ok(r instanceof Response, 'returns a Response');
    assert.equal(r.status, 403);
    const body = await r.json();
    assert.equal(body.error, 'tinyverse-access-required');
  }
});

test('isTinyverseAccessEmail is not fooled by lookalikes', () => {
  assert.equal(isTinyverseAccessEmail('jason@bouncingfish.com.evil.com'), false);
  assert.equal(isTinyverseAccessEmail('notjason@bouncingfish.com'), false);
});
