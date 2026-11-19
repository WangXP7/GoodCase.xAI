// tests/world-claim.test.mjs
// The confirm-path security invariants of /api/worlds/claim: a payment intent
// is consumed atomically (pending -> paid) as the FIRST statement of the claim
// transaction, so one intent can pay for exactly one world (no replay), and
// any later failure rolls the consumption back. Also: the
// WORLDS_VERIFY_ONCHAIN=0 disable flag must be ignored on production-looking
// hosts. Hermetic — confirmClaim takes an injected sql facade and verification
// deps, so no database or Solana RPC is touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { confirmClaim, ClaimRejection, verificationRequired } =
  await import('../netlify/functions/world-claim.mjs');

const PROFILE = { id: 7 };
const WALLET = 'BuyerWallet1111111111111111111111111111111';

function baseState() {
  return {
    intents: [{
      id: 1, profile_id: PROFILE.id, status: 'pending', amount: '25',
      payer_wallet: WALLET, recipient_wallet: 'SiteWallet', token_mint: 'USDCmint',
      reference_key: 'ref-1', signature: null,
    }],
    worlds: [
      { id: 10, status: 'unclaimed', owner_profile_id: null, price_usdc: null },
      { id: 11, status: 'unclaimed', owner_profile_id: null, price_usdc: null },
    ],
    wallets: [{ profile_id: PROFILE.id, public_key: WALLET }],
    claims: [],
    claimedCount: 0,
  };
}

// Tagged-template sql facade over the in-memory state, routed on query text.
// begin() snapshots the state and restores it when the callback throws, which
// is exactly the rollback contract confirmClaim's atomicity relies on.
function makeSql(state) {
  const run = async (strings, ...vals) => {
    const text = strings.join('$');
    if (text.includes('UPDATE wallet_payment_intents')) {
      const [signature, intentId, profileId] = vals;
      const intent = state.intents.find(i => i.id === intentId && i.profile_id === profileId && i.status === 'pending');
      if (!intent) return [];
      intent.status = 'paid';
      if (signature != null) intent.signature = signature;
      return [{ ...intent }];
    }
    if (text.includes('FROM wallet_payment_intents')) {
      const [intentId, profileId] = vals;
      return state.intents.filter(i => i.id === intentId && i.profile_id === profileId).map(i => ({ ...i }));
    }
    if (text.includes('FROM wallet_accounts')) {
      const [profileId] = vals;
      return state.wallets.filter(w => w.profile_id === profileId).map(w => ({ public_key: w.public_key }));
    }
    if (text.includes('UPDATE worlds')) {
      const [profileId, price, worldId] = vals;
      const world = state.worlds.find(w => w.id === worldId && w.status === 'unclaimed');
      if (!world) return [];
      world.status = 'draft';
      world.owner_profile_id = profileId;
      world.price_usdc = price;
      return [{ ...world }];
    }
    if (text.includes('INSERT INTO world_claims')) {
      const [worldId, profileId, intentId, price, signature, status] = vals;
      state.claims.push({ worldId, profileId, intentId, price, signature, status });
      return [];
    }
    if (text.includes('UPDATE world_economy_state')) {
      state.claimedCount += 1;
      return [];
    }
    if (text.includes('INSERT INTO player_resources')) return [];
    throw new Error('unmocked query: ' + text);
  };
  run.begin = async (fn) => {
    const snapshot = structuredClone(state);
    try {
      return await fn(run);
    } catch (err) {
      for (const key of Object.keys(snapshot)) state[key] = snapshot[key];
      throw err;
    }
  };
  return run;
}

function confirmArgs(overrides = {}) {
  return { profile: PROFILE, worldId: 10, price: 25, paymentIntentId: 1, signature: 'sig-1', ...overrides };
}

const skipVerification = { requireVerification: () => false };

test('confirm with an already-paid intent is rejected with 409 (replay)', async () => {
  const state = baseState();
  state.intents[0].status = 'paid';
  const sql = makeSql(state);
  await assert.rejects(
    confirmClaim(sql, confirmArgs(), skipVerification),
    (err) => err instanceof ClaimRejection && err.status === 409 && err.message === 'Payment intent already used',
  );
  // The replay must not touch the world or the books.
  assert.equal(state.worlds[0].status, 'unclaimed');
  assert.equal(state.claims.length, 0);
  assert.equal(state.claimedCount, 0);
});

test('a consumed intent cannot claim a second world', async () => {
  const state = baseState();
  const sql = makeSql(state);
  const first = await confirmClaim(sql, confirmArgs({ worldId: 10 }), skipVerification);
  assert.equal(first.world.id, 10);
  assert.equal(state.intents[0].status, 'paid');
  // Replaying the same intent + signature against a different world must fail
  // and leave that world for sale.
  await assert.rejects(
    confirmClaim(sql, confirmArgs({ worldId: 11 }), skipVerification),
    (err) => err instanceof ClaimRejection && err.status === 409 && err.message === 'Payment intent already used',
  );
  assert.equal(state.worlds[1].status, 'unclaimed');
  assert.equal(state.claims.length, 1);
  assert.equal(state.claimedCount, 1);
});

test('a failure after consumption rolls the intent back to pending (atomicity)', async () => {
  const state = baseState();
  state.worlds[0].status = 'draft'; // world already claimed: the flip loses
  const sql = makeSql(state);
  await assert.rejects(
    confirmClaim(sql, confirmArgs(), skipVerification),
    (err) => err instanceof ClaimRejection && err.status === 409 && err.message === 'World was just claimed by someone else',
  );
  // The buyer keeps their payment intent for another attempt.
  assert.equal(state.intents[0].status, 'pending');
  assert.equal(state.claims.length, 0);
});

test('WORLDS_VERIFY_ONCHAIN=0 does not skip verification on a production-like host', async (t) => {
  const saved = { WORLDS_VERIFY_ONCHAIN: process.env.WORLDS_VERIFY_ONCHAIN, URL: process.env.URL, SITE_URL: process.env.SITE_URL };
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
  process.env.WORLDS_VERIFY_ONCHAIN = '0';
  delete process.env.SITE_URL;

  process.env.URL = 'https://tinyworld.example.com';
  assert.equal(verificationRequired(), true);

  // And the confirm path really calls the verifier under that gate: an
  // unverifiable payment is a 402 and the intent consumption rolls back.
  const state = baseState();
  const sql = makeSql(state);
  let verifierCalls = 0;
  await assert.rejects(
    confirmClaim(sql, confirmArgs(), { verifyTransfer: async () => { verifierCalls += 1; return { ok: false, reason: 'transaction not found' }; } }),
    (err) => err instanceof ClaimRejection && err.status === 402,
  );
  assert.equal(verifierCalls, 1);
  assert.equal(state.intents[0].status, 'pending');
  assert.equal(state.worlds[0].status, 'unclaimed');

  // On a local host the flag still works as the escape hatch it was meant to be.
  process.env.URL = 'http://localhost:3000';
  assert.equal(verificationRequired(), false);
});

test('happy path claims the world, marks the intent paid, and books the claim', async () => {
  const state = baseState();
  const sql = makeSql(state);
  const result = await confirmClaim(sql, confirmArgs(), { verifyTransfer: async () => ({ ok: true, reason: '' }) });
  assert.equal(result.verified, true);
  assert.equal(result.world.id, 10);
  assert.equal(result.world.status, 'draft');
  assert.equal(result.world.owner_profile_id, PROFILE.id);
  assert.equal(state.intents[0].status, 'paid');
  assert.equal(state.intents[0].signature, 'sig-1');
  assert.deepEqual(state.claims, [{ worldId: 10, profileId: PROFILE.id, intentId: 1, price: 25, signature: 'sig-1', status: 'completed' }]);
  assert.equal(state.claimedCount, 1);
});
