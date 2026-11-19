import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMissingRelation, isMissingRelations } from '../netlify/functions/lib/db.mjs';

test('isMissingRelation recognizes Postgres missing-table errors by code and message', () => {
  assert.equal(isMissingRelation({ code: '42P01', message: 'relation "wallet_accounts" does not exist' }, 'wallet_accounts'), true);
  assert.equal(isMissingRelation({ code: '42P01', message: 'relation "wallet_auth_challenges" does not exist' }, 'wallet_accounts'), false);
  assert.equal(isMissingRelation({ code: '23505', message: 'duplicate key value violates unique constraint' }, 'wallet_accounts'), false);
});

test('isMissingRelations matches any expected social schema relation', () => {
  const err = { code: '42P01', message: 'relation "player_presence" does not exist' };
  assert.equal(isMissingRelations(err, ['wallet_accounts', 'player_presence']), true);
  assert.equal(isMissingRelations(err, ['wallet_accounts', 'wallet_auth_challenges']), false);
});
