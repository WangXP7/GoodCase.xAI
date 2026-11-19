// Regression tests for world-room state integrity (party/index.js):
//  - B4: the room's slug (not a client-supplied worldId) resolves the durable
//    world, so the first joiner can never bind another world's owner/tax here.
//  - M1: a fresh joiner's world.state snapshot carries FULL peer presence
//    (name/color/hearts/avatar), not bare {id,x,z} entries.
//  - M3: flushPending snapshots-and-clears before the POST so overlapping
//    alarms cannot double-send, and restores the batch on failure.
// Run with: npm run test:unit   (node --test, zero extra deps)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import TinyWorldParty from '../party/index.js';

// ---- mock PartyKit room + connections (see tests/party.test.mjs) --------
function makeRoom(env = {}) {
  const conns = new Map();
  return {
    id: 'room-test',
    env,
    conns,
    getConnection: (id) => conns.get(id) || null,
    broadcast: () => {},
    addConn(id) {
      const c = {
        id,
        uri: '',
        received: [],
        closed: false,
        send(raw) { c.received.push(JSON.parse(raw)); },
        close() { c.closed = true; },
      };
      conns.set(id, c);
      return c;
    },
  };
}

test('a second joiner receives full peer presence (name/color/hearts/avatar) in world.state', async () => {
  const room = makeRoom();
  room.id = 'world-meadow';
  const party = new TinyWorldParty(room);
  party.setWorldStateFromData({ v: 4, gridSize: 8, cells: [] }, { id: 42, taxPercent: 10 });
  const p1 = room.addConn('p1'); party.onConnect(p1);
  const p2 = room.addConn('p2'); party.onConnect(p2);
  await party.onWorldMessage({
    type: 'world.join', role: 'play', profileId: 7, name: 'Aria', color: '#aa11bb',
    avatar: { kind: 'voxel', seed: 11, fit: 'Scout', gear: 'Sword' },
  }, p1);
  await party.onWorldMessage({ type: 'world.join', role: 'play', profileId: 8, name: 'Brim' }, p2);
  const state = p2.received.find(m => m.type === 'world.state');
  assert.ok(state, 'second joiner received a world.state snapshot');
  const peer = (state.peers || []).find(pr => pr.id === 'p1');
  assert.ok(peer, 'first peer is present in the join snapshot');
  assert.equal(peer.name, 'Aria', 'peer name replicated');
  assert.equal(peer.color, '#aa11bb', 'peer color replicated');
  assert.equal(typeof peer.hearts, 'number', 'peer hearts replicated');
  assert.ok(peer.avatar && peer.avatar.kind === 'voxel', 'peer avatar replicated');
});

test('world load resolves by room slug and ignores a client-supplied worldId', async () => {
  // No WORLDS_JOIN_SECRET / WORLDS_SERVICE_TOKEN => open mode, the path where a
  // client-supplied worldId used to be trusted for the load-once durable lookup.
  const room = makeRoom({ URL: 'https://tinyworld.test' });
  room.id = 'world-meadow';
  const party = new TinyWorldParty(room);
  const p1 = room.addConn('p1'); party.onConnect(p1);
  const oldFetch = globalThis.fetch;
  let fetched = null;
  globalThis.fetch = async (url) => {
    fetched = String(url);
    return new Response(JSON.stringify({
      world: {
        id: 42, slug: 'meadow', status: 'published', gridSize: 8,
        taxPercent: 10, ownerProfileId: 99,
        data: { v: 4, gridSize: 8, cells: [[5, 5, 'stone']] },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    // Open mode (no join secret): the joiner claims worldId 666, which must NOT
    // reach the durable lookup — the room slug wins.
    await party.onWorldMessage({ type: 'world.join', role: 'play', profileId: 7, worldId: 666 }, p1);
    assert.equal(fetched, 'https://tinyworld.test/api/worlds?slug=meadow', 'lookup keyed by room slug');
    assert.equal(party.world.id, 42, 'room simulates the world its slug names');
    assert.equal(party.world.ownerProfileId, 99, 'owner comes from the slug-resolved world');
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('a fetched world whose slug does not match the room is refused', async () => {
  const room = makeRoom({ URL: 'https://tinyworld.test' });
  room.id = 'world-meadow';
  const party = new TinyWorldParty(room);
  const p1 = room.addConn('p1'); party.onConnect(p1);
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    world: { id: 13, slug: 'other-world', status: 'published', gridSize: 8, taxPercent: 50, ownerProfileId: 1, data: { v: 4, cells: [] } },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    await party.onWorldMessage({ type: 'world.join', role: 'play', profileId: 7, gridSize: 8, cells: [[5, 5, 'stone']] }, p1);
    assert.equal(party.world && party.world.ownerProfileId, null, 'mismatched world meta not adopted');
    // Open mode falls back to the client-seeded board (the local-dev trust model).
    assert.ok(party.worldState, 'room still gets a playable world state');
    assert.ok(party.worldState.cellIndex['5,5'], 'client-seeded ore node present after refusal');
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('flushPending never double-sends a batch across overlapping alarms and restores on failure', async () => {
  const room = makeRoom({ URL: 'https://tinyworld.test', WORLDS_SERVICE_TOKEN: 'service-token' });
  room.id = 'world-meadow';
  const party = new TinyWorldParty(room);
  party.pendingResources.set('7', { fish: 0, meat: 0, plants: 0, ore: 3 });
  party.pendingGold = new Map([['profile:7', [{ type: 'ALLOWANCE_RECALCULATED', amount: 10 }]]]);

  const bodies = [];
  const oldFetch = globalThis.fetch;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  globalThis.fetch = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    await gate;    // hold the first POST open so the second flush overlaps it
    return new Response('{"ok":true}', { status: 200 });
  };
  try {
    const first = party.flushPending();
    // Overlapping alarm: the batch was already snapshotted and cleared, so this
    // flush sees nothing pending and must not POST the same grants again.
    const second = party.flushPending();
    release();
    await Promise.all([first, second]);
    assert.equal(bodies.length, 1, 'one POST for one batch');
    assert.equal(bodies[0].resources['7'].ore, 3);
    assert.equal(party.pendingResources.size, 0, 'batch cleared after 2xx');
    assert.equal(party.pendingGold.size, 0, 'gold batch cleared after 2xx');

    // Failure path: the batch must come back so grants are never lost.
    party.pendingResources.set('7', { fish: 1, meat: 0, plants: 0, ore: 0 });
    globalThis.fetch = async () => new Response('nope', { status: 500 });
    await party.flushPending();
    assert.equal(party.pendingResources.get('7').fish, 1, 'failed batch restored');
  } finally {
    globalThis.fetch = oldFetch;
  }
});
