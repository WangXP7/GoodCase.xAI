// Unit tests for the PartyKit plane entity relay (party/index.js) — world-room path.
// The real flight-sim (34-flight-sim.js) calls broadcastFlight which sends
// { type:'entity', kind:'plane', ... } through the world-room WS path. The
// handler MUST live in onWorldMessage (not onMessage), because world rooms
// early-return to onWorldMessage before the onMessage entity branch can fire.
// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import TinyWorldParty from '../party/index.js';

function makeRoom() {
  const conns = new Map();
  return {
    id: 'world-meadow',
    conns,
    getConnection: (id) => conns.get(id) || null,
    broadcast: () => {},
    addConn(id) {
      const c = { id, received: [], closed: false,
        send(raw) { c.received.push(JSON.parse(raw)); }, close() { c.closed = true; } };
      conns.set(id, c); return c;
    },
  };
}

function worldSetup() {
  const room = makeRoom();
  const party = new TinyWorldParty(room);
  party.setWorldStateFromData(
    { v: 4, gridSize: 8, cells: [{ x: 5, z: 5, terrain: 'stone' }] },
    { id: 42, taxPercent: 10, ownerProfileId: 99 },
  );
  // onConnect auto-admits as observer in a world room
  const connect = (id) => { const c = room.addConn(id); party.onConnect(c); return c; };
  return { room, party, connect };
}

test('plane entity relays to peers via world path, stamped from sender', () => {
  const { party, connect } = worldSetup();
  const a = connect('a');
  const b = connect('b');
  a.received.length = 0; b.received.length = 0;

  party.onWorldMessage({
    type: 'entity', kind: 'plane',
    active: true,
    p: { x: 1, y: 2, z: 3 },
    r: { x: 0.1, y: 0.2, z: 0.3 },
    id: 'spoofed',  // client-supplied — must be replaced with sender.id
  }, a);

  const msgB = b.received.find(m => m.type === 'entity');
  assert.ok(msgB, 'peer b receives the entity message');
  assert.equal(msgB.id, 'a', 'id is stamped from sender.id, not the client-supplied value');
  assert.equal(msgB.kind, 'plane');
  assert.equal(msgB.active, true);
  assert.ok(msgB.p && typeof msgB.p.x === 'number', 'position present');
  assert.ok(msgB.r && typeof msgB.r.x === 'number', 'rotation present');

  // Sender does NOT receive their own broadcast.
  const msgA = a.received.find(m => m.type === 'entity');
  assert.equal(msgA, undefined, 'sender does not receive their own flight message');
});

test('plane entity: active=false (land) relays to peers', () => {
  const { party, connect } = worldSetup();
  const a = connect('a');
  const b = connect('b');
  b.received.length = 0;

  party.onWorldMessage({
    type: 'entity', kind: 'plane',
    active: false,
    p: { x: 0, y: 0, z: 0 }, r: { x: 0, y: 0, z: 0 },
  }, a);

  const msgB = b.received.find(m => m.type === 'entity');
  assert.ok(msgB, 'landing signal relays to peer');
  assert.equal(msgB.active, false);
  assert.equal(msgB.id, 'a');
});

test('entity with non-plane kind is rejected', () => {
  const { party, connect } = worldSetup();
  const a = connect('a');
  const b = connect('b');
  b.received.length = 0;

  party.onWorldMessage({
    type: 'entity', kind: 'projectile',
    active: true, p: { x: 1, y: 2, z: 3 }, r: { x: 0, y: 0, z: 0 },
  }, a);

  const msgB = b.received.find(m => m.type === 'entity');
  assert.equal(msgB, undefined, 'non-plane entity kind is not relayed');
});

test('non-admitted sender entity is ignored', () => {
  const { party, connect } = worldSetup();
  const b = connect('b');
  b.received.length = 0;

  const fakeSender = { id: 'never-connected', received: [], send(raw) { this.received.push(JSON.parse(raw)); } };
  party.onWorldMessage({
    type: 'entity', kind: 'plane',
    active: true, p: { x: 1, y: 2, z: 3 }, r: { x: 0, y: 0, z: 0 },
  }, fakeSender);

  assert.equal(b.received.find(m => m.type === 'entity'), undefined, 'non-admitted sender produces no relay');
});

// The tests above call onWorldMessage() directly. These two drive the FULL onMessage
// entry instead, locking in the two things that path actually does and that the original
// bug got wrong: (1) a world room early-returns the entity into onWorldMessage (the relay
// was dead because the handler had lived only in onMessage), and (2) the 'entity' bucket
// is rate-limited BEFORE that early-return.
test('entity sent through onMessage routes into the world relay (regression: handler must be reachable)', () => {
  const { party, connect } = worldSetup();
  const a = connect('a');
  const b = connect('b');
  a.received.length = 0; b.received.length = 0;

  party.onMessage(JSON.stringify({
    type: 'entity', kind: 'plane', active: true,
    p: { x: 4, y: 5, z: 6 }, r: { x: 0, y: 0, z: 0 },
  }), a);

  const msgB = b.received.find(m => m.type === 'entity');
  assert.ok(msgB, 'onMessage routes the world-room entity into onWorldMessage and relays it');
  assert.equal(msgB.id, 'a', 'still server-stamped through the full path');
  assert.equal(msgB.active, true);
});

test('entity flood through onMessage is rate-limited on the world path', () => {
  const { party, connect } = worldSetup();
  const a = connect('a');
  const b = connect('b');
  a.received.length = 0; b.received.length = 0;

  const N = 100;
  for (let i = 0; i < N; i++) {
    party.onMessage(JSON.stringify({
      type: 'entity', kind: 'plane', active: true,
      p: { x: i, y: 0, z: 0 }, r: { x: 0, y: 0, z: 0 },
    }), a);
  }

  const got = b.received.filter(m => m.type === 'entity').length;
  assert.ok(got < N, `rate limit drops part of a flood on the world path (got ${got}/${N})`);
  assert.ok(got >= 1, 'but legitimate flight traffic still gets through');
});
