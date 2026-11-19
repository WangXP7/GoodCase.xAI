// npm run smoke -- [--round 10] [--seconds 900] [--params "autostart=1&bot=1&god=1&warp=4"]
// npm run smoke -- --playthrough      start -> kill round 1 -> buy ammo -> round 5 -> die -> retry
// npm run smoke -- --playthrough full start -> round 2 -> Hollis 12 -> d1 -> every door -> power ->
//                                     bench -> a machine -> the box (roll and take) -> search a car and
//                                     a locker (a second hold on the car does nothing) -> round 5 and its
//                                     brute (when the zombie types exist) -> die -> the end screen ->
//                                     retry (doors shut, power off, nothing searched)
//
// The bot (src/player/botBrain.js) plays the game. Default run: god mode, until --round is reached
// or --seconds of wall time pass; fails on any __errors entry, on a round that never arrives, on a
// frozen run (no kills for 60 s of game time) or on a zombie stuck-guard loop.
import { parseArgs } from 'node:util';
import { launch, pageUrl, watchPage } from './lib.mjs';

const { values: a, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    seconds: { type: 'string', default: '900' }, round: { type: 'string', default: '10' },
    params: { type: 'string', default: 'autostart=1&bot=1&god=1&warp=4' }, playthrough: { type: 'boolean', default: false },
    size: { type: 'string', default: '1920x1080' },
  },
});
const full = a.playthrough && positionals.includes('full');
const seconds = Number(a.seconds);
const goalRound = Number(a.round);
const [vw, vh] = a.size.split('x').map(Number);
let browser; let code = 0;
const fail = (msg) => {
  console.log(`[smoke] FAIL ${msg}`); code = 1;
  if (a.playthrough) throw new Error('playthrough stopped at its first failure'); // later steps depend on earlier ones
};

// Everything the checks read, in one evaluate.
const probe = (page) => page.evaluate(() => {
  const G = window.__G, s = window.__stats();
  const z = G.zombies && G.zombies.stats ? G.zombies.stats : {};
  const w = G.weapon && G.weapon.ammo ? G.weapon.ammo : {};
  const b = G.player && G.player.bot && G.player.bot.brain ? G.player.bot.brain : {};
  return {
    ...s, errors: (window.__errors || []).length, sim: Math.round((G.time.sim || 0) * 10) / 10,
    kills: G.game ? G.game.kills : 0, stuck: z.stuck || 0, spawned: z.spawned || 0, removed: z.removed || 0,
    mag: w.mag, reserve: w.reserve, health: G.player ? Math.round(G.player.health) : 0,
    mode: b.mode, shots: b.shots, buys: b.buys, botStuck: G.player && G.player.bot ? G.player.bot.stuck : 0,
    pos: G.player && G.player.pos ? G.player.pos.map((v) => Math.round(v * 10) / 10) : null,
    errand: b.errand && b.errand.it ? b.errand.it.id : null, zone: G.level && G.level.zone,
    doors: G.level && G.level.doors ? G.level.doors.filter((d) => d.open).map((d) => d.id) : [],
    power: !!(G.level && G.level.power && G.level.power.on), held: G.weapon && G.weapon.slots ? G.weapon.slots.map((q) => q && (q.upgraded ? `${q.id}+` : q.id)) : [],
    machines: G.game && G.game.machines ? [...G.game.machines.owned] : [], searched: G.game && G.game.loot ? G.game.loot.searched.size : 0,
    box: G.game && G.game.box ? G.game.box.state : null,
  };
});
const line = (tag, p) => console.log(`[smoke] ${tag} ${JSON.stringify(p)}`);

// Poll until cond(p) or the wall-clock limit; watches for errors and a frozen run. Returns the last probe.
async function until(page, what, cond, limit, okDead = false) {
  const t0 = Date.now();
  let next = 15; let last = null; let lastKills = -1; let killSim = 0;
  for (;;) {
    await page.waitForTimeout(500);
    const p = last = await probe(page);
    const el = (Date.now() - t0) / 1000;
    if (p.errors) { fail(`errors while waiting for ${what}`); return p; }
    if (await cond(p)) { line(`${what}: reached at ${el.toFixed(0)}s`, p); return p; }
    if (p.state === 'dead' && !okDead) { line('at', p); fail(`died while waiting for ${what}`); return p; }
    if (p.kills !== lastKills || p.state !== 'playing' || p.alive === 0 || p.errand) { // (an errand walks the map: no kills is no freeze)
      lastKills = p.kills; killSim = p.sim; }
    if (p.sim - killSim > 60) { line('at', p); fail(`no kill for 60 s of game time with ${p.alive} alive while waiting for ${what}`); return p; }
    if (el >= next) { line(`t=${next}s`, p); next += 15; }
    if (el > limit) { line('at', p); fail(`${what} not reached in ${limit}s`); return p; }
  }
}

// The economy playthrough. Points are topped up by the script where a step is about buying, not
// earning; the bot (botBrain.js) does the walking, the presses and the holds.
async function playthroughFull(page) {
  const top = (n) => page.evaluate((v) => { const e = window.__G.game.economy; if (e.points < v) e.points = v; }, n);
  const ev = () => page.evaluate(() => window.__ev);
  await page.evaluate(() => {
    const G = window.__G;
    window.__ev = { take: 0, upgrade: 0, machine: 0, roll: 0, search: {}, starts: {}, brutes: 0, bruteKills: 0 };
    const E = window.__ev;
    // stand-ins for the machine and box-spot objects (the object builders draw them): world.js drives their state
    for (const sp of [...G.level.machineSpots, ...G.level.boxSpots]) {
      if (!G.level.objects[sp.id]) G.level.objects[sp.id] = { state: null, setState(st) { this.state = st; } };
    }
    G.events.on('box:take', () => { E.take++; });
    G.events.on('box:roll', () => { E.roll++; });
    G.events.on('bench:upgrade', () => { E.upgrade++; });
    G.events.on('machine:buy', () => { E.machine++; });
    G.events.on('search:done', (e) => { E.search[e.id] = (E.search[e.id] || 0) + 1; });
    G.events.on('search:start', (e) => { E.starts[e.id] = (E.starts[e.id] || 0) + 1; });
    G.events.on('zombie:spawn', (e) => { if (e && e.type === 'brute') E.brutes++; });
    G.events.on('zombie:die', (e) => {
      const t = e && (e.type || (G.zombies.list.find((z) => z && z.id === e.id) || {}).type);
      if (t === 'brute') E.bruteKills++;
    });
  });
  // 1. the title, then a real click on Play
  let p = await probe(page);
  if (p.state !== 'title') fail(`expected the title screen, got ${p.state}`);
  await page.getByRole('button', { name: /^Play/ }).click();
  p = await until(page, 'round 1 started', (q) => q.state === 'playing' && q.round === 1, 20);
  if (p.points !== 500 || p.doors.length || p.power) fail(`not a fresh game: ${JSON.stringify(p)}`);
  // 2. round 2, by the bot's own aim
  p = await until(page, 'round 2', (q) => q.round >= 2, 300);
  await page.evaluate(() => { window.__G.params.god = true; }); // from here the legs are about the economy
  // 3. the cheapest wall weapon: the Hollis 12 (1000)
  await top(1100);
  p = await until(page, 'Hollis 12 bought', (q) => q.held.includes('pump'), 180);
  // 4. d1 with 500 to spare
  await top(1300);
  p = await until(page, 'd1 open', (q) => q.doors.includes('d1'), 180);
  // 5. every door, in ring order
  for (let i = 0; i < 6; i++) {
    await top(3000);
    p = await until(page, `door ${i + 2}`, (q) => q.doors.length >= Math.min(5, i + 2), 240);
    if (p.doors.length >= 5) break;
  }
  // 6. the power switch, then the bench and a machine (each with 1000 to spare)
  p = await until(page, 'power on', (q) => q.power, 240);
  await top(5200);
  p = await until(page, 'bench upgrade', async () => (await ev()).upgrade >= 1, 240);
  await top(3600);
  p = await until(page, 'a machine', async () => (await ev()).machine >= 1, 240);
  // 7. the box: one roll a round above 3000; wait for the take
  await top(4200);
  p = await until(page, 'box rolled and taken', async () => (await ev()).take >= 1, 300);
  // 8. search a car and a locker; then hold at the car again: nothing
  const ids = await page.evaluate(() => {
    const L = window.__G.level;
    return { car: L.searchables.find((s) => s.kind === 'car' && s.zone === 'forecourt').id, locker: L.searchables.find((s) => s.kind === 'locker').id };
  });
  for (const id of [ids.car, ids.locker]) {
    await page.evaluate((x) => window.__G.player.bot.brain.errandTo(x), id);
    p = await until(page, `searched ${id}`, async () => ((await ev()).search[id] || 0) >= 1, 240);
  }
  await page.evaluate((x) => window.__G.player.bot.brain.errandTo(x, { hold: 3 }), ids.car);
  p = await until(page, 'second hold on the car', async () => !(await page.evaluate(() => window.__G.player.bot.brain.errand)), 180);
  const e1 = await ev();
  if (e1.search[ids.car] !== 1 || e1.starts[ids.car] !== 1) fail(`the car was searched again: ${JSON.stringify(e1)}`);
  if (e1.search[ids.locker] !== 1) fail(`the locker: ${JSON.stringify(e1)}`);
  // 9. round 5 and its brute (the zombie types: skipped when none ever spawns)
  p = await until(page, 'round 5', (q) => q.round >= 5, 900);
  p = await until(page, 'round 5 cleared', (q) => q.round >= 6, 600);
  const e2 = await ev();
  line('brutes', { spawned: e2.brutes, killed: e2.bruteKills });
  if (e2.brutes > 0 && e2.bruteKills < 1) fail('a brute spawned and was never killed');
  // 10. an untaken offer lapses: its spot goes back to idle (world.js binds box:expire)
  const lapse = await page.evaluate(async () => {
    const G = window.__G, box = G.game.box;
    G.player.bot.passive = true; // stand still: the bot would take it
    if (box.state === 'moving') await new Promise((r) => { const t = setInterval(() => { if (box.state === 'idle') { clearInterval(t); r(); } }, 100); });
    G.game.economy.points = Math.max(G.game.economy.points, 5000);
    box.roll();
    const spot = box.spot;
    await new Promise((r) => { const t = setInterval(() => { if (box.state === 'offering') { clearInterval(t); r(); } }, 100); });
    const offering = G.level.objects[spot].state;
    await new Promise((r) => { const t = setInterval(() => { if (box.state !== 'offering') { clearInterval(t); r(); } }, 100); });
    G.player.bot.passive = false;
    return { offering, after: G.level.objects[spot].state, box: box.state };
  });
  line('box lapse', lapse);
  if (lapse.offering !== 'offering' || !['idle', 'moving'].includes(lapse.after)) fail(`an expired offer left the spot ${lapse.after}`);
  // 11. die with the power on, a machine bought and the box rolling: god off, the bot stops fighting
  await page.evaluate(() => { const G = window.__G; G.game.economy.points = Math.max(G.game.economy.points, 2000); if (G.game.box.state === 'idle') G.game.box.roll(); });
  await page.evaluate(() => { const G = window.__G; G.params.god = false; G.player.bot.passive = true; });
  p = await until(page, 'dead', (q) => q.state === 'dead', 240, true);
  const sum = await page.evaluate(() => ({ s: window.__G.game.summary(), r: window.__G.game.runSummary() }));
  line('summary', { ...sum.s, rows: sum.s.rows.map((r) => `${r.label}: ${r.value}`) });
  line('run', sum.r);
  if (sum.s.doors !== 5 || !(sum.s.spent > 0) || !(sum.s.kills > 0) || !(sum.s.accuracy > 0 && sum.s.accuracy <= 1)) fail('summary is off');
  if (sum.r.round !== p.round || sum.r.kills !== sum.s.kills || !(sum.r.timeSec > 0)) fail('run summary is off');
  await page.waitForSelector('.gs-dead', { state: 'visible', timeout: 10000 });
  const deadText = await page.locator('.gs-dead').innerText();
  if (!deadText.includes(String(sum.s.kills))) fail(`the end screen does not show ${sum.s.kills} kills: ${deadText}`);
  // 12. retry: a fresh game
  await page.getByRole('button', { name: /^Retry/ }).click({ timeout: 10000 });
  await page.waitForTimeout(300);
  p = await probe(page);
  line('after retry', p);
  if (p.state !== 'playing' || p.round !== 1 || p.points !== 500 || p.doors.length || p.power || p.searched || p.machines.length || p.box !== 'idle' || p.held.join() !== 'pistol,') fail('retry did not give a fresh game');
  // the art: machines dead, no spot rolling or offering, the box idle at the spot the new game chose
  const art = await page.evaluate(() => {
    const G = window.__G, O = G.level.objects;
    return { machines: G.level.machineSpots.map((m) => O[m.id].state), spots: G.level.boxSpots.map((b) => `${b.id}:${O[b.id].state}`), at: G.game.box.spot };
  });
  line('art after retry', art);
  if (art.machines.some((x) => x !== 'dead')) fail(`machines after retry: ${art.machines}`);
  if (art.spots.some((x) => /rolling|offering|moving/.test(x)) || !art.spots.includes(`${art.at}:idle`)) fail(`box spots after retry: ${art.spots}`);
  const s2 = await page.evaluate(() => window.__G.game.summary());
  if (s2.kills !== 0 || s2.doors !== 0 || s2.spent !== 0) fail(`summary not cleared: ${JSON.stringify(s2)}`);
}

// The vehicle and area-art layers are installed by createLevel (and their own polls are no-ops):
// each is in the scene once, and its per-frame work runs once per simulation step, never twice
// (a second install or a second update would run the barrier and blink animations at double speed).
async function checkLayers(page) {
  await page.evaluate(() => { window.__goreAtBoot = window.__G.gore; });
  const r = await page.evaluate(async () => {
    const G = window.__G, veh = window.__vehicles, art = window.__areaArt;
    let roots = 0, glass = 0;
    G.scene.traverse((o) => { if (o.name === 'vehicles') roots++; if (o.name === 'glass' && art && o === art.glass) glass++; });
    const seen = { art: new Map(), veh: new Map() };
    const count = (m) => { const k = `${G.time.frame}:${G.time.t}`; m.set(k, (m.get(k) || 0) + 1); };
    if (art) art.updaters.push(() => count(seen.art));
    const mu = veh && veh.mats && veh.mats.update;
    if (mu) veh.mats.update = function counted(t) { count(seen.veh); return mu.call(this, t); };
    await new Promise((res) => { let n = 0; const f = () => (++n < 30 ? requestAnimationFrame(f) : res()); requestAnimationFrame(f); });
    if (art) art.updaters.pop();
    if (mu) veh.mats.update = mu;
    const max = (m) => Math.max(0, ...m.values());
    // gore: wired by main.js, one module; the animators' own way in hands back the same one
    const gore = !!G.gore && !G.gore.stub && window.__goreAtBoot === G.gore;
    return { vehicles: !!veh, areaArt: !!art, gore, roots, glass, artSteps: seen.art.size, artMax: max(seen.art), vehSteps: seen.veh.size, vehMax: max(seen.veh) };
  });
  line('layers', r);
  if (!r.vehicles || !r.areaArt || !r.gore) fail(`a layer is not installed (or gore was made twice): ${JSON.stringify(r)}`);
  if (r.roots !== 1) fail(`the vehicle layer is in the scene ${r.roots} times`);
  if (!r.artSteps || r.artMax !== 1) fail(`area-art updaters ran ${r.artMax} times in one step (${r.artSteps} steps)`);
  if (!r.vehSteps || r.vehMax !== 1) fail(`the vehicle layer updated ${r.vehMax} times in one frame (${r.vehSteps} frames)`);
}

try {
  browser = await launch();
  const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
  const extra = watchPage(page);
  const t0 = Date.now();
  await page.goto(pageUrl(a.playthrough ? 'bot=1&warp=4' : a.params));
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  console.log(`[smoke] ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await checkLayers(page);

  if (full) await playthroughFull(page);
  else if (a.playthrough) {
    // 1. the title, then a real click on Play
    let p = await probe(page);
    if (p.state !== 'title') fail(`expected the title screen, got ${p.state}`);
    await page.getByRole('button', { name: /^Play/ }).click();
    p = await until(page, 'round 1 started', (q) => q.state === 'playing' && q.round === 1, 20);
    if (p.reserve !== 48 || p.health !== 100 || p.kills > 2) fail(`not a fresh game: ${JSON.stringify(p)}`);
    // 2. kill round 1 (no god mode: the bot has to survive it)
    p = await until(page, 'round 1 cleared', (q) => q.round >= 2, 240);
    if (p.kills < 10) fail(`round 1 has 10 zombies, kills = ${p.kills}`);
    // 3. buy ammo at the wall (walks there, pays 250)
    p = await until(page, 'ammo bought', (q) => q.buys >= 1, 240);
    // 4. reach round 5 (god mode from here: this leg is about the rounds, not the bot's aim)
    await page.evaluate(() => { window.__G.params.god = true; });
    p = await until(page, 'round 5', (q) => q.round >= 5, 600);
    // 5. die: god off, the bot stops fighting
    await page.evaluate(() => { const G = window.__G; G.params.god = false; G.player.bot.passive = true; });
    p = await until(page, 'dead', (q) => q.state === 'dead', 240, true);
    const best = await page.evaluate(() => window.__G.game.best);
    if (best < 5) fail(`best round should be at least 5 after dying in round ${p.round}: ${best}`);
    // 6. retry: a real click on the death screen's button (it appears after a short delay)
    await page.getByRole('button', { name: /^Retry/ }).click({ timeout: 10000 });
    await page.waitForTimeout(300);
    p = await probe(page);
    line('after retry', p);
    const corpses = await page.evaluate(() => ({ corpses: window.__G.zombies.corpses, decals: window.__G.fx.decalCount }));
    if (p.state !== 'playing' || p.round !== 1 || p.points !== 500 || p.mag !== 12 || p.reserve !== 48 || p.health !== 100 || p.kills !== 0) fail('retry did not give a fresh game');
    if (p.alive > 2 || corpses.corpses !== 0 || corpses.decals !== 0) fail(`leftovers after retry: ${p.alive} alive, ${JSON.stringify(corpses)}`);
    p = await until(page, 'round 1 cleared again', (q) => q.round >= 2, 240);
  } else {
    const p = await until(page, `round ${goalRound}`, (q) => q.round >= goalRound, seconds);
    // a stuck-guard loop: respawns far out of proportion to the zombies that ever existed
    if (p.stuck > Math.max(10, p.spawned * 0.25)) fail(`zombie stuck guard fired ${p.stuck} times for ${p.spawned} spawned`);
  }

  const stats = await probe(page);
  const errors = await page.evaluate(() => window.__errors || []);
  line('end', stats);
  const all = [...errors, ...extra.filter((e) => !errors.some((x) => x.includes(e.slice(15, 60))))];
  if (all.length) fail(`${all.length} error(s):\n  ${all.join('\n  ')}`);
  if (!code) console.log('[smoke] OK no errors');
} catch (e) {
  console.error(`[smoke] failed: ${e.message}`); code = 1;
} finally {
  if (browser) await browser.close();
}
process.exit(code);
