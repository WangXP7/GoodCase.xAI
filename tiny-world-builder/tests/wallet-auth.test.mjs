import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWalletLoginChallengeToken,
  createWalletSessionToken,
  getAuthUser,
  verifyWalletLoginChallengeToken,
  walletSessionAuthConfigured,
  walletUserFromPublicKey,
} from '../netlify/functions/lib/auth.mjs';

const TEST_WALLET = '11111111111111111111111111111111';

test('wallet session tokens authenticate as wallet users', async () => {
  process.env.TINYWORLD_WALLET_SESSION_SECRET = 'tinyworld-wallet-test-secret';
  assert.equal(walletSessionAuthConfigured(), true);

  const token = createWalletSessionToken(TEST_WALLET);
  const user = await getAuthUser(new Request('https://example.test/api/profile', {
    headers: { Authorization: 'Bearer ' + token },
  }));

  assert.equal(user.id, 'wallet:' + TEST_WALLET);
  assert.equal(user.userMetadata.wallet_public_key, TEST_WALLET);
});

test('tampered wallet session tokens are rejected', async () => {
  process.env.TINYWORLD_WALLET_SESSION_SECRET = 'tinyworld-wallet-test-secret';
  const token = createWalletSessionToken(TEST_WALLET);
  const tampered = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
  const user = await getAuthUser(new Request('https://example.test/api/profile', {
    headers: { Authorization: 'Bearer ' + tampered },
  }));

  assert.equal(user, null);
});

test('wallet login challenge tokens bind to the same wallet and message', () => {
  process.env.TINYWORLD_WALLET_SESSION_SECRET = 'tinyworld-wallet-test-secret';
  const user = walletUserFromPublicKey(TEST_WALLET);
  const message = 'Tiny World Builder wallet login\nPublic key: ' + TEST_WALLET;
  const token = createWalletLoginChallengeToken(TEST_WALLET, message, 'nonce-1', '2026-06-12T00:00:00.000Z');

  assert.equal(user.id, 'wallet:' + TEST_WALLET);
  assert.equal(verifyWalletLoginChallengeToken(token, TEST_WALLET, message).nonce, 'nonce-1');
  assert.equal(verifyWalletLoginChallengeToken(token, TEST_WALLET, message + '!'), null);
});
