// First look: the title, the landing, the chapel.
export default async function ({ ev, step, shot, log, page }) {
  await step(30);
  await page.waitForTimeout(2600);
  await step(30);
  await shot('g_title');
  await ev(() => TP.play());
  await step(40);
  await page.waitForTimeout(700);
  await shot('g_dock');
  const L = await ev(() => {
    const L = TP.world.layout;
    return { door: L.door, spawn: L.spawn, chapel: L.chapel, pyre: L.pyre, start: L.start };
  });
  await ev((L) => TP.go(L.door.x, L.door.z + 14, 0, 4), L);
  await step(40);
  await page.waitForTimeout(500);
  await shot('g_chapel_out');
  await ev((L) => TP.go(L.spawn.x, L.spawn.z, 0, 0, L.spawn.y + 0.05), L);
  await step(40);
  await page.waitForTimeout(500);
  await shot('g_chapel_in');
  log(JSON.stringify(await ev(() => ({ pos: TP.game.player.pos, region: TP.game.region, stage: TP.game.state.quest.stage, icons: TP.game.icons.cache ? TP.game.icons.cache.size : 0 }))));
}
