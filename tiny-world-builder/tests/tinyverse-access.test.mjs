import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isTinyverseAccessEmail,
  tinyverseAccessEmails,
  tinyverseLobbyAccessForEmail,
} from '../netlify/functions/lib/tinyverse-access.mjs';
import { canAccessTinyverse } from '../netlify/functions/admin-users.mjs';

test('Tinyverse access is locked to the dark-launch allowlist', () => {
  const set = tinyverseAccessEmails();
  assert.equal(set.has('jason@bouncingfish.com'), true);
  assert.equal(set.has('simongarthfarmer@gmail.com'), true);
  assert.equal(isTinyverseAccessEmail('  SimonGarthFarmer@Gmail.com  '), true);
  assert.equal(isTinyverseAccessEmail('jason.kneen@gmail.com'), false);
  assert.equal(isTinyverseAccessEmail('someone@example.com'), false);
  assert.equal(isTinyverseAccessEmail(''), false);
});

test('new profile lobby flag defaults to the Tinyverse allowlist only', () => {
  assert.equal(tinyverseLobbyAccessForEmail('simongarthfarmer@gmail.com'), true);
  assert.equal(tinyverseLobbyAccessForEmail('new-user@example.com'), false);
});

test('admin Tinyverse check ignores stale lobby flags for non-allowed users', () => {
  const user = { id: 'user-123', email: 'new-user@example.com' };
  const profile = { email: 'new-user@example.com', lobby_access: true };
  assert.equal(canAccessTinyverse(user, profile), false);
  assert.equal(canAccessTinyverse({ id: 'user-456', email: 'simongarthfarmer@gmail.com' }, null), true);
});

test('Tinyverse access NEVER trusts the user-editable profiles.email (privilege escalation fix)', () => {
  // A wallet user (empty verified email) cannot self-grant access by setting an
  // allowlisted profiles.email, and an attacker with a non-allowlisted verified email
  // cannot escalate via profiles.email either.
  assert.equal(canAccessTinyverse({ id: 'w', email: '' }, { email: 'jason@bouncingfish.com' }), false);
  assert.equal(canAccessTinyverse({ id: 'w', email: 'attacker@example.com' }, { email: 'simongarthfarmer@gmail.com' }), false);
  // The legitimate path still works: a verified allowlisted email grants access.
  assert.equal(canAccessTinyverse({ id: 'w', email: 'jason@bouncingfish.com' }, { email: 'unrelated@example.com' }), true);
});

test('Tinyverse access NEVER trusts the user-editable profiles.email (privilege escalation fix)', () => {
  // A wallet user (empty verified email) cannot self-grant access by setting an
  // allowlisted profiles.email, and an attacker with a non-allowlisted verified email
  // cannot escalate via profiles.email either.
  assert.equal(canAccessTinyverse({ id: 'w', email: '' }, { email: 'jason.kneen@gmail.com' }), false);
  assert.equal(canAccessTinyverse({ id: 'w', email: 'attacker@example.com' }, { email: 'jason.kneen@gmail.com' }), false);
  // The legitimate path still works: a verified allowlisted email grants access.
  assert.equal(canAccessTinyverse({ id: 'w', email: 'jason.kneen@gmail.com' }, { email: 'unrelated@example.com' }), true);
});
