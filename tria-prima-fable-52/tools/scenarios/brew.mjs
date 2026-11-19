// The first loop of the game without hands: read the letter, gather, brew Ember, kindle the Athanor.
export default async function ({ ev, step, shot, log, page }) {
  await step(20);
  await page.waitForTimeout(2600);
  await ev(() => TP.play());
  await step(10);

  // read the letter through the interaction list
  const r1 = await ev(() => {
    const g = TP.game;
    const it = g.ents.list.find((i) => i.verb === 'Read' && i.name === g.data.LORE.letter.title);
    if (!it) return 'no letter';
    g.player.teleport(it.pos.x, it.pos.y - 1.0, it.pos.z + 1.4, 0, -0.5);
    return { pos: { x: it.pos.x, y: it.pos.y, z: it.pos.z } };
  });
  log('letter', JSON.stringify(r1));
  await step(20);
  log('focus', JSON.stringify(await ev(() => TP.game.hud.focus)));
  await ev(() => TP.game.input.press('KeyE'));
  await step(2);
  await ev(() => TP.game.input.release('KeyE'));
  await step(10);
  await page.waitForTimeout(900);
  await shot('g_reader');
  log('reading', await ev(() => TP.game.reading));
  await page.keyboard.press('Enter');
  await step(10);
  log('after read', JSON.stringify(await ev(() => ({ reading: TP.game.reading, stage: TP.game.state.quest.stage, lore: TP.game.state.known.lore }))));

  // gather cinderblooms by walking the interaction list
  const picked = await ev(() => {
    const g = TP.game;
    const blooms = g.ents.plants.filter((p) => p.id === 'cinderbloom').slice(0, 4);
    for (const p of blooms) g.ents.pick(p);
    return { n: blooms.length, inv: g.state.inv.ingredients, kinds: [...new Set(g.ents.plants.map((p) => p.id))], total: g.ents.plants.length };
  });
  log('picked', JSON.stringify(picked));
  await step(20);
  log('stage', await ev(() => TP.game.state.quest.stage));

  // to the cauldron
  await ev(() => {
    const g = TP.game;
    const c = g.world.named.cauldron;
    g.player.teleport(c.x, c.y + 0.1, c.z + 2.2, 0, -0.3);
  });
  await step(20);
  await page.waitForTimeout(600);
  await shot('g_cauldron');
  log('focus', JSON.stringify(await ev(() => TP.game.hud.focus)));
  await ev(() => TP.game.input.press('KeyE'));
  await step(2);
  await ev(() => TP.game.input.release('KeyE'));
  await step(40);
  await page.waitForTimeout(900);
  await shot('g_brew_0');
  log('mode', await ev(() => TP.game.state.mode));

  // three blooms, bellows, stir
  await ev(() => {
    const g = TP.game;
    for (let i = 0; i < 3; i++) g.actions.brewAdd('cinderbloom');
    return g.brew.contents;
  });
  await step(10);
  log('brew', JSON.stringify(await ev(() => ({ c: TP.game.brew.contents, region: TP.game.brew.region, band: TP.game.brew.band, mix: TP.game.brew.mix }))));
  await ev(() => {
    TP.game.brewing.autoStir = 0.9;
    TP.game.actions.brewPump(true);
  });
  let last = null;
  for (let i = 0; i < 60; i++) {
    await step(15);
    last = await ev(() => {
      const b = TP.game.brew;
      // hold the heat inside the band
      if (b.band) {
        const mid = (b.band[0] + b.band[1]) / 2;
        TP.game.actions.brewPump(b.heat < mid);
        TP.game.actions.brewDamp(b.heat > b.band[1]);
      }
      return { fire: +b.fire.toFixed(2), heat: +b.heat.toFixed(2), fit: b.fit, prog: +b.progress.toFixed(2), ready: b.ready, hint: b.hint };
    });
    if (i === 12) {
      await page.waitForTimeout(400);
      await shot('g_brew_1');
    }
    if (last.ready) break;
  }
  log('brew end', JSON.stringify(last));
  await page.waitForTimeout(500);
  await shot('g_brew_ready');
  await ev(() => TP.game.actions.brewBottle());
  await step(20);
  log('potions', JSON.stringify(await ev(() => ({ p: TP.game.state.inv.potions, sel: TP.game.state.inv.selected, stage: TP.game.state.quest.stage, known: TP.game.state.known.potions }))));
  await ev(() => {
    TP.game.brewing.autoStir = 0;
    TP.game.actions.brewPump(false);
    TP.game.actions.brewLeave();
  });
  await step(40);
  await page.waitForTimeout(600);
  await shot('g_after_brew');

  // throw Ember into the Athanor
  await ev(() => {
    const g = TP.game;
    const a = g.world.named.athanor;
    const f = a.anchor('front');
    const m = a.anchor('mouth');
    g.player.teleport(f.x, f.y + 0.1, f.z + 2.5, Math.atan2(m.x - f.x, -(m.z - (f.z + 2.5))), 0.02);
  });
  await step(20);
  await page.waitForTimeout(400);
  await shot('g_athanor_cold');
  await ev(() => TP.game.potions.throw('ember'));
  for (let i = 0; i < 6; i++) {
    await step(8);
    if (i === 2) await shot('g_ember_flight');
  }
  await step(40);
  await page.waitForTimeout(600);
  await shot('g_athanor_lit');
  log('end', JSON.stringify(await ev(() => ({ athanor: TP.game.state.world.athanor, stage: TP.game.state.quest.stage, potions: TP.game.state.inv.potions, thrown: TP.game.state.stats.thrown }))));
}
