// Real relay + Rapier, isolated invite rooms: never enter the public player queue.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createPrivate, joinPrivate, type Matchmaking } from '@genex-ai/multiplayer';
import { DuelSimulation, initPhysics } from '../lib/duel/physics';
import { BOT_WAIT_MS, createDuelNetwork, type Profile } from '../lib/duel/network';

const project = JSON.parse(await readFile('.genex/project.json', 'utf8')) as { slug: string; apiUrl: string };
const matches: Matchmaking<Profile>[] = [], clients: ReturnType<typeof client>[] = [];
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean, label: string, timeout = 30_000) {
  const start = performance.now();
  while (!check()) {
    const error = clients.find(c => c.net.status.mode === 'error');
    if (error) throw new Error(error.net.status.label);
    if (performance.now() - start > timeout) throw new Error(`Timed out: ${label}`);
    await delay(50);
  }
}
async function identity() {
  const r = await fetch(`${project.apiUrl}/api/embed/guest-session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: project.slug, playerId: crypto.randomUUID() }) });
  if (!r.ok) throw new Error(`Guest session HTTP ${r.status}`);
  return await r.json() as { embedToken: string; user: { name: string }; colyseus: { urls: string[] } };
}
function client(match: Matchmaking<Profile>) {
  matches.push(match);
  const sim = new DuelSimulation({ playerWeapon: 'mace' });
  const results: unknown[] = [];
  const net = createDuelNetwork(sim, { join: async () => match, reset: options => sim.reset(options), hit: () => {}, changed: () => {}, finished: r => results.push(r) });
  const render = setInterval(() => net.render(), 16);
  return { sim, net, results, dispose() { clearInterval(render); net.dispose(); sim.dispose(); } };
}
await initPhysics();
try {
  const ids = await Promise.all([identity(), identity()]);
  const options = (i: number) => ({ room: project.slug, urls: ids[i].colyseus.urls, url: ids[0].colyseus.urls[0], name: ids[i].user.name, auth: () => ({ embedToken: ids[i].embedToken }) });
  const soloMatch = await createPrivate<Profile>(options(0));
  const solo = client(soloMatch); clients.push(solo); await solo.net.join();
  await until(() => solo.net.status.botIn !== null, 'solo lobby seated'); const started = performance.now();
  await delay(BOT_WAIT_MS - 1500); assert.equal(solo.net.active, true); assert.equal(solo.sim.phase, 'ready');
  await until(() => solo.net.status.fallbackBot, 'solo fallback');
  assert.ok(performance.now() - started >= BOT_WAIT_MS - 100, 'wait the full window');
  assert.equal(solo.net.active, false); assert.equal(solo.sim.online, false); assert.equal(solo.sim.phase, 'fighting');
  assert.equal(solo.sim.options.playerWeapon, 'mace'); assert.deepEqual(solo.results, []);
  assert.match(solo.net.status.names[1], /^Player [1-9][0-9]$/);
  console.log(`PASS: isolated real lobby waits ${BOT_WAIT_MS / 1000} seconds, leaves the relay, and starts the selected weapon against a named arena rival.`);
  solo.dispose(); clients.splice(clients.indexOf(solo), 1);

  const lobby = await createPrivate<Profile>(options(0));
  const host = client(lobby); clients.push(host); await host.net.join();
  await until(() => host.net.status.botIn !== null && host.net.status.botIn <= 3, 'near-deadline lobby');
  const peer = client(await joinPrivate<Profile>(lobby.code, options(1))); clients.push(peer); await peer.net.join();
  await until(() => clients.every(c => c.net.status.mode === 'playing' && c.sim.phase === 'fighting'), 'late human starts');
  assert.notEqual(host.sim.localPlayerId, peer.sim.localPlayerId);
  assert.ok(clients.every(c => c.sim.online && !c.net.status.fallbackBot && c.net.status.botIn === null));
  await delay(4000);
  assert.ok(clients.every(c => c.net.active && c.sim.fighters.every(f => f.aiTime === 0)));
  console.log('PASS: a late real peer takes priority; both clients share the human duel and neither runs AI.');
  peer.dispose(); clients.splice(clients.indexOf(peer), 1);
  await until(() => host.net.status.mode === 'waiting', 'human departure'); await delay(BOT_WAIT_MS + 1000);
  assert.equal(host.net.active, true); assert.equal(host.net.status.fallbackBot, false); assert.equal(host.sim.online, true);
  console.log('PASS: human departure/reconnect waiting never silently swaps the established duel to a bot.');
} finally {
  clients.forEach(c => c.dispose()); matches.forEach(m => m.cancel());
}
