// Unit tests for the PartyKit emote relay (party/index.js) — world-room path.
// The real game client connects to a world-<slug> room (47-worlds-room.js:161),
// so the server handler must live inside onWorldMessage. These tests exercise
// that path directly.
// Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import TinyWorldParty, { EMOTE_CMDS } from '../party/index.js';

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
  party.setWorldStateFromData({
    v: 4, gridSize: 8,
    cells: [{ x: 5, z: 5, terrain: 'stone' }],
  }, { id: 42, taxPercent: 10, ownerProfileId: 99 });
  // connect auto-admits as observer in a world room
  const connect = (id) => { const c = room.addConn(id); party.onConnect(c); return c; };
  return { room, party, connect };
}

test('emote command set has the six v1 commands', () => {
  assert.deepEqual([...EMOTE_CMDS].sort(),
    ['attack', 'crouch', 'dance', 'jump', 'sit', 'wave']);
});

test('admitted peer emote broadcasts to all admitted via world path, stamped from sender', () => {
  const { party, connect } = worldSetup();
  const a = connect('a');
  const b = connect('b');
  // world room auto-admits on connect, so both are already admitted
  a.received.length = 0; b.received.length = 0;
  // Drive through onWorldMessage — the path real clients use.
  // id:'spoofed' and name:'Mallory' are client-supplied values that must be ignored.
  party.onWorldMessage({ type: 'emote', cmd: 'wave', id: 'spoofed', name: 'Mallory' }, a);
  const msgA = a.received.find(m => m.type === 'emote');
  const msgB = b.received.find(m => m.type === 'emote');
  assert.ok(msgA && msgB, 'both admitted peers receive the emote');
  assert.equal(msgB.id, 'a', 'id is stamped from sender.id, not the client-supplied value');
  // name comes from getPlayer(sender.id).name — default is 'Builder' for a freshly
  // connected peer that has not sent a world.join yet.
  const trustedName = party.getPlayer('a').name;
  assert.equal(msgB.name, trustedName, 'name comes from the server player record, not the client value');
  assert.notEqual(msgB.name, 'Mallory', 'client-supplied name is not used');
  assert.equal(msgB.cmd, 'wave');
  assert.ok(typeof msgB.ts === 'number', 'ts is present');
});

test('unknown emote command is rejected (no broadcast) via world path', () => {
  const { party, connect } = worldSetup();
  const a = connect('a');
  a.received.length = 0;
  party.onWorldMessage({ type: 'emote', cmd: 'explode' }, a);
  assert.equal(a.received.find(m => m.type === 'emote'), undefined);
});

test('non-admitted sender emote is ignored via world path', () => {
  // Create a sender object whose id was never connected/admitted.
  // We inject a fake conn directly without going through onConnect so
  // admitted.has(id) is false for this id.
  const { party, connect } = worldSetup();
  const b = connect('b'); // admitted observer — would receive any broadcast
  b.received.length = 0;
  const fakeSender = { id: 'never-connected', received: [], send(raw) { this.received.push(JSON.parse(raw)); } };
  party.onWorldMessage({ type: 'emote', cmd: 'wave' }, fakeSender);
  assert.equal(b.received.find(m => m.type === 'emote'), undefined, 'non-admitted sender produces no broadcast');
  assert.equal(fakeSender.received.find(m => m.type === 'emote'), undefined);
});
