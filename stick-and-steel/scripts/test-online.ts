// Live relay smoke test: normal, temporary guest identities; never reads the owner's token.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { matchmake } from '@genex-ai/multiplayer';
import { DuelSimulation, initPhysics } from '../lib/duel/physics';
import { createDuelNetwork } from '../lib/duel/network';
import { held } from '../lib/duel/net-state';
const project = JSON.parse(await readFile('.genex/project.json', 'utf8')) as { slug: string; apiUrl: string };
await initPhysics();
const clients: ReturnType<typeof client>[] = [];
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean, description: string, timeout = 18000) {
  const start = Date.now();
  while (!check()) {
    const failure = clients.find(c => c.net.status.mode === 'error');
    if (failure) throw new Error(failure.net.status.label);
    if (Date.now() - start > timeout) throw new Error(`Timed out: ${description}; ${clients.map(c => `${c.net.status.mode}/${c.sim.phase}`).join(', ')}`);
    await delay(50);
  }
}
async function guest() {
  const response = await fetch(`${project.apiUrl}/api/embed/guest-session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: project.slug, playerId: crypto.randomUUID() }) });
  if (!response.ok) throw new Error(`Guest session HTTP ${response.status}; this test needs the published game.`);
  return await response.json() as { embedToken: string; user: { id: string; name: string }; colyseus: { urls: string[] } };
}
function client(identity: Awaited<ReturnType<typeof guest>>, relay: string) {
  const sim = new DuelSimulation({ arena: 'bridge', spares: true });
  let focused = true, physicsSteps = 0, impacts = 0;
  const step = sim.step.bind(sim); sim.step = () => { physicsSteps++; step(); };
  const net = createDuelNetwork(sim, {
    reset: options => sim.reset(options), hit: () => { impacts++; }, changed: () => {}, focused: () => focused,
    join: () => matchmake({ urls: identity.colyseus.urls, url: relay, room: project.slug, name: identity.user.name, auth: () => ({ embedToken: identity.embedToken }) }),
  });
  sim.onHit = hit => { impacts++; net.hit(hit); };
  const render = setInterval(() => net.render(), 16);
  return { sim, net, get steps() { return physicsSteps; }, get impacts() { return impacts; }, focus(value: boolean) { focused = value; }, dispose() { clearInterval(render); net.dispose(); sim.dispose(); } };
}
try {
  const identities = await Promise.all([guest(), guest()]);
  assert.notEqual(identities[0].user.id, identities[1].user.id);
  const relay = identities[0].colyseus.urls[0]; assert.ok(relay);
  clients.push(...identities.map(identity => client(identity, relay)));
  await Promise.all(clients.map(c => c.net.join()));
  await until(() => clients.every(c => c.net.status.mode === 'playing' && c.sim.phase === 'fighting'), 'two players start');
  const host = clients.find(c => c.net.status.host)!, peer = clients.find(c => !c.net.status.host)!;
  assert.ok(host && peer); assert.notEqual(host.sim.localPlayerId, peer.sim.localPlayerId);
  console.log('PASS: distinct guests match, take opposite sides and complete the countdown.');
  const beforeHost = host.steps, beforePeer = peer.steps;
  await delay(600);
  assert.ok(host.steps > beforeHost + 40); assert.equal(peer.steps, beforePeer);
  console.log('PASS: only the host advances physics; the second player renders the snapshot stream.');
  const side = peer.sim.localPlayerId, startX = host.sim.fighters[side].position.x;
  peer.sim.input.move.y = .7; await delay(750); peer.sim.input.move.set(0, 0);
  assert.ok(Math.abs(host.sim.fighters[side].position.x - startX) > .15);
  peer.sim.input.guard = true; peer.sim.input.aim.set(.85, -.55);
  await until(() => host.sim.fighters[side].guard && peer.sim.fighters[side].guard && host.sim.fighters[side].aim.x > .7 && peer.sim.fighters[side].aim.y < -.4, 'remote directional guard and snapshot');
  assert.equal(host.sim.fighters[1 - side].guard, false); peer.sim.input.guard = false;
  peer.net.action('chop'); await until(() => host.sim.fighters[side].lowStrike && host.sim.fighters[side].slashTime > 0, 'remote downward chop action');
  await delay(1500);
  console.log('PASS: directional guard and downward chop control the correct remote fighter.');
  peer.net.action('drop');
  await until(() => !host.sim.fighters[side].grip && !held(peer.sim.fighters[side]), 'remote drop reaches both players');
  assert.ok(host.sim.fighters[1 - side].grip);
  console.log('PASS: remote movement and weapon release affect the correct physical fighter.');
  await delay(1100);
  if (!host.sim.nearbyWeapon(side)) { peer.sim.input.move.set(0, -.65); await until(() => !!host.sim.nearbyWeapon(side), 'walk back within pickup reach', 4000); peer.sim.input.move.set(0, 0); await delay(200); }
  peer.net.action('pickup');
  await until(() => !!host.sim.fighters[side].pickup || !!host.sim.fighters[side].grip, 'remote pickup starts');
  // The explicit press survives the 20 Hz stream without a held interaction flag.
  await until(() => !!host.sim.fighters[side].grip && held(peer.sim.fighters[side]), 'physical pickup and ownership synchronized', 8000);
  assert.equal(peer.sim.fighters[side].weapon.id, host.sim.fighters[side].weapon.id);
  assert.equal(peer.sim.fighters[side].weapon.holder, side);
  console.log('PASS: remote E pickup reaches the handle and synchronizes the held weapon.');
  peer.focus(false); await until(() => host.net.status.mode === 'waiting', 'background pause');
  const pausedAt = host.sim.time; await delay(250); assert.equal(host.sim.time, pausedAt);
  peer.focus(true); await until(() => host.net.status.mode === 'playing', 'foreground resume');
  console.log('PASS: a backgrounded player pauses the shared bout and returns without a reset.');
  peer.sim.input.move.set(1, 0);
  await until(() => !!host.sim.fighters[side].hang || host.sim.fighters[side].down, 'remote player reaches edge', 12000);
  peer.sim.input.move.set(0, 0); peer.net.action('drop');
  await until(() => host.sim.phase === 'finished' && peer.sim.phase === 'finished', 'shared fall result', 12000);
  assert.equal(peer.sim.winner, host.sim.winner); await delay(800);
  assert.ok(peer.impacts > 0);
  console.log('PASS: physical fall, hazard feedback and the winner arrive on both clients.');
  host.net.action('rematch'); peer.net.action('rematch');
  await until(() => host.sim.phase === 'ready' && peer.sim.phase === 'ready', 'rematch reset');
  await until(() => clients.every(c => c.sim.phase === 'fighting'), 'rematch countdown');
  assert.ok(clients.every(c => c.sim.fighters.every(f => f.hp === 100)));
  console.log('PASS: both players request a rematch; health, grips and world reset together.');
  host.dispose(); clients.splice(clients.indexOf(host), 1);
  await until(() => peer.net.status.host && peer.net.status.mode === 'waiting', 'host migration and waiting');
  const replacement = client(await guest(), relay); clients.push(replacement); await replacement.net.join();
  await until(() => clients.every(c => c.net.status.mode === 'playing' && c.sim.phase === 'fighting'), 'vacant seat refill and new bout');
  assert.notEqual(peer.sim.localPlayerId, replacement.sim.localPlayerId);
  console.log('PASS: host departure transfers authority; a new guest fills the vacant seat and starts a fresh bout.');
} finally { clients.forEach(c => c.dispose()); }
