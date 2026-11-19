import test from 'node:test';
import assert from 'node:assert/strict';
import { addResult, persistResult, readRecord, recordCacheKey, recordScore, scoreRecord, type RecordPort } from '../lib/duel/records';

await test('wins/losses remain exact and repeat delivery of a round is idempotent', () => {
  let record = readRecord(null);
  record = addResult(record, { roundId: 'a', won: true });
  record = addResult(record, { roundId: 'b', won: false });
  record = addResult(record, { roundId: 'a', won: true });
  assert.deepEqual(scoreRecord(recordScore(record)), { wins: 1, losses: 1 });
  assert.ok(recordScore(addResult(record, { roundId: 'c', won: false })) > recordScore(record));
  assert.ok(recordScore({ wins: 2, losses: 0, rounds: [] }) > recordScore({ wins: 1, losses: 999, rounds: [] }));
});

await test('save conflicts merge another device’s round and preserve other player progress', async () => {
  let data = { inventory: ['sword'], onlineRecord: readRecord(null) }, version = 0, raced = false, score = 0;
  const port: RecordPort = {
    async load() { return { data: structuredClone(data), version }; },
    async save(next, expected) {
      if (!raced) { raced = true; data.onlineRecord = addResult(data.onlineRecord, { roundId: 'other-device', won: false }); version++; }
      if (expected !== version) return { saved: false, conflict: true };
      data = next as typeof data; version++; return { saved: true };
    },
    async submit(next) { score = next; },
  };
  await persistResult(port, { roundId: 'this-device', won: true });
  await persistResult(port, { roundId: 'this-device', won: true });
  assert.deepEqual(data.inventory, ['sword']);
  assert.deepEqual(scoreRecord(score), { wins: 1, losses: 1 });
  assert.deepEqual(data.onlineRecord.rounds, ['other-device', 'this-device']);
});

await test('a failed account score submit can retry without adding another win', async () => {
  let record: unknown = null, fail = true;
  const port: RecordPort = {
    async load() { return { data: record, version: 0 }; },
    async save(data) { record = data; return { saved: true }; },
    async submit() { if (fail) { fail = false; throw new Error('offline'); } },
  };
  await assert.rejects(persistResult(port, { roundId: 'a', won: true }));
  const result = await persistResult(port, { roundId: 'a', won: true });
  assert.equal(result.wins, 1); assert.equal(result.losses, 0);
});

await test('rotating guest identities share a device record but cannot replace an account save', async () => {
  assert.equal(recordCacheKey('guest:first',true),recordCacheKey('guest:second',true));
  assert.notEqual(recordCacheKey('account-one',false),recordCacheKey('account-two',false));
  assert.notEqual(recordCacheKey('account-one',false),recordCacheKey('guest:first',true));
  let writes=0;
  const port: RecordPort={async load(){return {data:null,version:0,guest:true};},async save(){writes++;return {saved:false,queued:true};},async submit(){writes++;}};
  await assert.rejects(persistResult(port,{roundId:'guest-round',won:true}));assert.equal(writes,0);
});
