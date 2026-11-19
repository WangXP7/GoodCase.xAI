import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { Matchmaking, Session } from '@genex-ai/multiplayer';
import { DuelSimulation, initPhysics } from '../lib/duel/physics';
import { BOT_WAIT_MS, createDuelNetwork, type Profile } from '../lib/duel/network';

await initPhysics();

function lobby(t: TestContext) {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let now = 0, cancellations = 0, focused = true, available = true;
  const events = new Map<string, Set<(value: unknown) => void>>();
  const on = (event: string, fn: (value: unknown) => void) => {
    if (!events.has(event)) events.set(event, new Set());
    events.get(event)!.add(fn); return () => { events.get(event)!.delete(fn); };
  };
  const profile: Profile = { weapon: 'mace', arena: 'bridge', ready: true, focused: true };
  const players = new Map([['local', { name: 'You', connected: true, stateRaw: { ...profile } }]]);
  const shared = new Map<string, unknown>();
  const room = {
    id: 'local', host: 'local', isHost: true, players,
    get activePlayers() { return new Map([...players].filter(([, p]) => p.connected)); },
    me: { set: () => {} }, shared, on, inputs: { on: () => () => {} }, onHostTick: () => () => {},
    objects: { claimConfirmed: async () => ({ accepted: true }), get: () => ({ isMine: true }), snap: () => {}, set: () => {} },
    setRoomOpen: () => {},
  } as unknown as Session<Profile>;
  let session: Session<Profile> | null = room;
  const match = { get session() { return session; }, cancel: () => { cancellations++; }, on } as Matchmaking<Profile>;
  let join = async () => match;
  const sim = new DuelSimulation({ playerWeapon: 'mace', arena: 'bridge' });
  const results: unknown[] = [];
  const net = createDuelNetwork(sim, { reset: opts => sim.reset(opts), hit: () => {}, changed: () => {},
    finished: r => results.push(r), join: () => join(), now: () => now, focused: () => focused, canStartBot: () => available });
  t.after(() => { net.dispose(); sim.dispose(); });
  async function advance(ms: number) {
    for (let elapsed = 0; elapsed < ms; elapsed += 50) { now += 50; t.mock.timers.tick(50); await Promise.resolve(); }
  }
  return { net, sim, match, results, players, shared, advance,
    get cancellations() { return cancellations; },
    addPeer(ready = true, connected = true) { players.set('peer', { name: 'Human', connected, stateRaw: { ...profile, ready } }); },
    emit(event: string, value?: unknown) { events.get(event)?.forEach(fn => fn(value)); },
    focus(value: boolean) { focused = value; }, available(value: boolean) { available = value; },
    stall(ms: number) { now += ms; t.mock.timers.tick(50); },
    setJoin(fn: () => Promise<Matchmaking<Profile>>) { join = fn; },
    setSeated(value: boolean) { session = value ? room : null; },
    async ready() { await net.join(); await advance(500); assert.equal(net.status.botIn, BOT_WAIT_MS / 1000); },
  };
}

await test('an empty seated lobby waits, then leaves matchmaking and starts real solo AI without online records', async t => {
  const f = lobby(t); await f.ready(); await f.advance(BOT_WAIT_MS - 600);
  assert.equal(f.net.active, true); assert.equal(f.sim.phase, 'ready'); assert.equal(f.cancellations, 0);
  await f.advance(1000);
  assert.equal(f.cancellations, 1); assert.equal(f.net.active, false); assert.equal(f.net.status.fallbackBot, true);
  assert.equal(f.net.status.mode, 'offline'); assert.equal(f.net.status.botIn, null);
  assert.equal(f.sim.online, false); assert.equal(f.sim.localPlayerId, 0); assert.equal(f.sim.phase, 'fighting');
  assert.equal(f.sim.options.playerWeapon, 'mace');
  const rivalName = f.net.status.names[1];
  assert.match(rivalName, /^Player [1-9][0-9]$/);
  for (let i = 0; i < 120; i++) f.sim.step();
  f.net.render(); assert.equal(f.net.status.names[1], rivalName, 'the name stays fixed throughout the duel');
  assert.ok(f.sim.fighters[1].aiTime > 0, 'the existing AI actually runs');
  f.sim.phase = 'finished'; f.sim.winner = 0; f.sim.endedAt = f.sim.time;
  await f.advance(30_000); f.net.render(); assert.deepEqual(f.results, []);
  assert.equal(f.cancellations, 1, 'the old queue cannot fire a second fallback');
  await f.ready();
  assert.equal(f.sim.phase, 'ready', 'searching from a finished bot duel resets the world and reveals the queue UI');
  assert.equal(f.sim.online, true); assert.equal(f.net.status.fallbackBot, false);
});

await test('human arrival on the last timer tick wins; a later departure never swaps the established duel for a bot', async t => {
  const f = lobby(t); await f.ready();
  while (f.net.status.botIn! > 1) await f.advance(50);
  await f.advance(950); assert.equal(f.cancellations, 0);
  f.addPeer(); await f.advance(50);
  assert.equal(f.net.status.mode, 'countdown'); assert.equal(f.net.status.botIn, null);
  assert.equal(f.cancellations, 0); assert.equal(f.sim.online, true);
  f.players.delete('peer'); await f.advance(60_000);
  assert.equal(f.net.active, true); assert.equal(f.net.status.mode, 'waiting'); assert.equal(f.cancellations, 0);
});

await test('loading and reconnecting peer seats block fallback even when only one transport is active', async t => {
  const f = lobby(t); await f.ready(); f.addPeer(false, false); await f.advance(60_000);
  assert.equal(f.net.status.botIn, null); assert.equal(f.cancellations, 0);
  f.players.delete('peer'); await f.advance(500);
  assert.equal(f.net.status.botIn, BOT_WAIT_MS / 1000, 'a departed loading peer starts a fresh search window');
});

await test('auth/queue delays, connection errors and reconnects are not interpreted as an empty arena', async t => {
  const f = lobby(t); f.setSeated(false); await f.net.join(); await f.advance(60_000);
  assert.equal(f.net.status.mode, 'queue'); assert.equal(f.net.status.botIn, null); assert.equal(f.cancellations, 0);
  f.net.leave(); f.setSeated(true); await f.ready(); f.emit('reconnecting'); await f.advance(60_000);
  assert.equal(f.net.active, true); assert.equal(f.net.status.botIn, null);
  f.emit('reconnected'); await f.advance(500); assert.equal(f.net.status.botIn, BOT_WAIT_MS / 1000);
  f.emit('error', new Error('Relay unavailable')); await f.advance(60_000);
  assert.equal(f.net.status.mode, 'error'); assert.equal(f.net.status.botIn, null); assert.equal(f.cancellations, 1);
});

await test('background, menu and throttled-tab return each get a fresh full wait', async t => {
  const f = lobby(t); await f.ready(); await f.advance(3000);
  f.focus(false); await f.advance(60_000); assert.equal(f.net.status.botIn, null);
  f.focus(true); await f.advance(500); assert.equal(f.net.status.botIn, BOT_WAIT_MS / 1000);
  f.available(false); await f.advance(60_000); assert.equal(f.net.status.botIn, null);
  f.available(true); await f.advance(500); assert.equal(f.net.status.botIn, BOT_WAIT_MS / 1000);
  f.stall(60_000); assert.equal(f.net.status.botIn, BOT_WAIT_MS / 1000); assert.equal(f.cancellations, 0);
});

await test('leaving a search cancels the timer, and retrying starts a fresh wait', async t => {
  const f = lobby(t); await f.ready(); await f.advance(3000);
  f.net.leave(); await f.advance(30_000);
  assert.equal(f.sim.phase, 'ready'); assert.equal(f.cancellations, 1);
  await f.ready(); await f.advance(BOT_WAIT_MS);
  assert.equal(f.net.status.fallbackBot, true); assert.equal(f.cancellations, 2);
  f.net.leave(); await f.ready(); assert.equal(f.net.status.fallbackBot, false);
});

await test('cancelling or disposing during an asynchronous join cancels the stale handle and cannot start a bot later', async t => {
  const f = lobby(t);
  let resolve!: (m: Matchmaking<Profile>) => void;
  f.setJoin(() => new Promise(r => { resolve = r; }));
  const pending = f.net.join(); f.net.leave(); resolve(f.match); await pending; await f.advance(60_000);
  assert.equal(f.cancellations, 1); assert.equal(f.net.active, false); assert.equal(f.sim.phase, 'ready');
  f.setJoin(async () => f.match); await f.ready(); f.net.dispose(); await f.advance(60_000);
  assert.equal(f.cancellations, 2); assert.equal(f.sim.phase, 'ready');
});


await test('public matchmaking waits without a session, then starts a bot on fresh solo queue reports', async t => {
  const f = lobby(t); f.setSeated(false); await f.net.join();
  assert.equal(BOT_WAIT_MS, 5000);
  for (let i = 0; i < BOT_WAIT_MS / 1000; i++) { f.emit('queue', { position: 1, size: 1 }); await f.advance(1000); }
  assert.equal(f.cancellations, 0);
  f.emit('queue', { position: 1, size: 1 });
  assert.equal(f.net.status.fallbackBot, true); assert.equal(f.sim.phase, 'fighting');
  assert.equal(f.cancellations, 1); assert.deepEqual(f.results, []);
});

await test('silent public queues, multiple searchers and reconnecting queues cannot trigger bots', async t => {
  const f = lobby(t); f.setSeated(false); await f.net.join();
  f.emit('queue', { position: 1, size: 1 }); await f.advance(60_000);
  assert.equal(f.cancellations, 0, 'a stale last report is not a live queue');
  for (let i = 0; i < 10; i++) { f.emit('queue', { position: 1, size: 2 }); await f.advance(1000); }
  assert.equal(f.cancellations, 0);
  for (let i = 0; i < 5; i++) { f.emit('queue', { position: 1, size: 1 }); await f.advance(1000); }
  f.emit('searching');
  for (let i = 0; i < 4; i++) { f.emit('queue', { position: 1, size: 1 }); await f.advance(1000); }
  assert.equal(f.cancellations, 0, 'rejoining restarts the full wait');
});

await test('a human session arriving at the public queue deadline wins over a stale queue report', async t => {
  const f = lobby(t); f.setSeated(false); await f.net.join();
  for (let i = 0; i < BOT_WAIT_MS / 1000; i++) { f.emit('queue', { position: 1, size: 1 }); await f.advance(1000); }
  f.addPeer(); f.setSeated(true); f.emit('queue', { position: 1, size: 1 }); await f.advance(500);
  assert.equal(f.cancellations, 0); assert.equal(f.net.status.mode, 'countdown');
});
