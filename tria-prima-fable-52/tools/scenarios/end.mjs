// The end of the game without hands: the three Primes into the pot, the four colours of the Work,
// the Stone into the Athanor, the ending; then dying, coming back, travelling, saving, the menus.
//   node tools/play.mjs tools/scenarios/end.mjs --q high [--only opus,death,travel,menus]
export default async function ({ ev, step, shot, log, page, args }) {
  await step(20);
  await page.waitForTimeout(2600);
  await ev(() => TP.play());
  await step(20);
  const only = args.only ? args.only.split(',') : null;
  const want = (n) => !only || only.includes(n);
  const frame = async (name, settle = 6) => {
    const r = await ev(([n, s]) => TP.shot(n, s), [name, settle]);
    log('  ' + r.file.split(/[\\/]/).pop());
  };
  const page_ = async (name) => {
    await page.waitForTimeout(700);
    await shot(name);
    log('  ' + name + '.jpg (with the interface)');
  };

  // a game well under way: the fire lit, the lanterns known, the three Primes in the satchel
  log('SETUP', JSON.stringify(await ev(() => {
    const g = TP.game, st = g.state;
    TP.give({ potions: { ember: 5, vitae: 3, rime: 4 }, primes: { salt: true, mercury: true, sulfur: true } });
    if (st.world.athanor < 1) g.ents.kindle();
    for (const l of g.ents.lanterns) g.ents.lightLantern(l);
    g.quests.check(true);
    TP.step(30, 1 / 30);
    return { stage: st.quest.stage, athanor: st.world.athanor, lanterns: st.known.lanterns, primes: st.inv.primes };
  })));

  if (want('opus')) {
    await ev(() => {
      const g = TP.game, c = g.world.named.cauldron;
      g.player.teleport(c.x, c.y + 0.1, c.z + 2.2, 0, -0.3);
      if (window.TP_FAST) g.state.inv.stone = true;
    });
    await step(30);
    log('OPUS focus', JSON.stringify(await ev(() => TP.game.hud.focus)));
    await ev(() => {
      const g = TP.game;
      g.input.press('KeyE');
      TP.step(3, 1 / 30);
      g.input.release('KeyE');
      TP.step(40, 1 / 30);
    });
    log('  mode', await ev(() => TP.game.state.mode));
    await page_('e_opus_0');
    await ev(() => {
      const g = TP.game;
      for (const p of ['salt', 'mercury', 'sulfur']) g.actions.brewAdd('prime:' + p);
      g.brewing.autoStir = 0.9;
    });
    await step(20);
    log('  in the pot', JSON.stringify(await ev(() => ({ c: TP.game.brew.contents, opus: TP.game.brew.opus, band: TP.game.brew.band }))));
    let stage = -1,
      last = null;
    for (let i = 0; i < 400; i++) {
      await step(10);
      last = await ev(() => {
        const g = TP.game, b = g.brew;
        if (!b.opus) return { gone: true };
        if (b.band) {
          const mid = (b.band[0] + b.band[1]) / 2;
          g.actions.brewPump(b.heat < mid - 0.02);
          g.actions.brewDamp(b.heat > mid + 0.05);
        }
        return { stage: b.opus.stage, prog: +b.opus.progress.toFixed(2), heat: +b.heat.toFixed(2), fire: +b.fire.toFixed(2), fit: b.fit, done: b.opus.done, hint: b.hint };
      });
      if (last.gone || last.done) break;
      if (last.stage !== stage && last.prog > 0.45) {
        stage = last.stage;
        log('  stage', JSON.stringify(last), 'at', ((i * 10) / 30).toFixed(0), 's');
        await page_('e_opus_' + (stage + 1));
      }
    }
    log('  end', JSON.stringify(last));
    await ev(() => {
      TP.game.actions.brewPump(false);
      TP.game.actions.brewDamp(false);
      TP.game.brewing.autoStir = 0;
    });
    await step(40);
    await page_('e_opus_stone');
    await step(160);
    log('  after', JSON.stringify(await ev(() => ({ mode: TP.game.state.mode, stone: TP.game.state.inv.stone, stage: TP.game.state.quest.stage, brewActive: TP.game.brew.active }))));
    await ev(() => {
      if (TP.game.state.mode === 'brew') TP.game.actions.brewLeave();
      TP.step(40, 1 / 30);
    });
    // the Stone into the Athanor
    await ev(() => {
      const g = TP.game, a = g.world.named.athanor;
      const f = a.anchor('front'), s = a.anchor('socket');
      const d = Math.hypot(s.x - f.x, s.z - (f.z + 0.6));
      g.player.teleport(f.x, f.y + 0.1, f.z + 0.6, Math.atan2(s.x - f.x, -(s.z - (f.z + 0.6))), Math.atan2(s.y - (f.y + 1.72), d));
      TP.step(30, 1 / 30);
      window._a = { front: [f.x, f.y, f.z].map((q) => +q.toFixed(2)), socket: [s.x, s.y, s.z].map((q) => +q.toFixed(2)), d: +d.toFixed(2) };
    });
    log('  athanor', JSON.stringify(await ev(() => window._a)));
    log('ENDING focus', JSON.stringify(await ev(() => ({ focus: TP.game.hud.focus, stage: TP.game.state.quest.stage, objective: TP.game.hud.objective || null }))));
    await page_('e_athanor_stone');
    await ev(() => {
      const g = TP.game;
      g.input.press('KeyE');
      TP.step(3, 1 / 30);
      g.input.release('KeyE');
    });
    const marks = [40, 120, 240, 420, 640, 900, 1200, 1500, 1800, 2100, 2400];
    let done = 0;
    for (let i = 0; i < marks.length; i++) {
      await step(marks[i] - done);
      done = marks[i];
      const s = await ev(() => ({ mode: TP.game.state.mode, phase: TP.game._cut ? TP.game._cut.phase : null, hour: +TP.game.state.time.hour.toFixed(1), athanor: TP.game.state.world.athanor }));
      log('  t=' + (marks[i] / 30).toFixed(0) + ' s', JSON.stringify(s));
      await page_('e_ending_' + i);
      if (s.phase === 'credits') break;
    }
    // leave the credits
    await ev(() => TP.game.actions.resume());
    await page.waitForTimeout(1200);
    await step(120);
    log('  back', JSON.stringify(await ev(() => ({ mode: TP.game.state.mode, stage: TP.game.state.quest.stage, cut: !!TP.game._cut }))));
    await page_('e_after');
  }

  if (want('death')) {
    log('DEATH');
    await ev(() => {
      const g = TP.game, L = TP.world.layout;
      if (g.state.mode !== 'play') return;
      TP.go(L.pyre.x, L.pyre.z, 0, 0);
      TP.step(20, 1 / 30);
      g.hurt(500, 'fire');
      TP.step(60, 1 / 30);
    });
    log('  ', JSON.stringify(await ev(() => ({ mode: TP.game.state.mode, hp: TP.game.state.player.hp, deaths: TP.game.state.stats.deaths }))));
    await page_('e_dead');
    await ev(() => TP.game.actions.respawn());
    await page.waitForTimeout(1500);
    await step(150);
    log('  ', JSON.stringify(await ev(() => {
      const g = TP.game, p = g.player.pos;
      return { mode: g.state.mode, hp: g.state.player.hp, at: [p.x, p.y, p.z].map((q) => +q.toFixed(1)), respawn: g.state.world.respawn, region: g.region };
    })));
    await page_('e_respawn');
  }

  if (want('travel')) {
    log('TRAVEL');
    await ev(() => TP.game.actions.travel('mere'));
    for (let i = 0; i < 6; i++) {
      await step(40);
      if (i === 1) await page_('e_travel');
      if (await ev(() => TP.game.state.mode === 'play' && !TP.game._cut)) break;
    }
    await page.waitForTimeout(1200);
    await step(60);
    log('  ', JSON.stringify(await ev(() => {
      const g = TP.game, p = g.player.pos;
      return { mode: g.state.mode, at: [p.x, p.y, p.z].map((q) => +q.toFixed(1)), region: g.region };
    })));
    await page_('e_travelled');
  }

  if (want('menus')) {
    log('MENUS');
    await ev(() => TP.game.actions.openBook());
    await page_('e_book');
    for (const tab of ['chart', 'herbal', 'pages', 'map']) {
      const ok = await ev((t) => {
        TP.game.actions.closeBook();
        TP.game.actions.openBook(t);
        return TP.game.state.mode;
      }, tab);
      await step(10);
      log('  book ' + tab + ': ' + ok);
      await page_('e_book_' + tab);
    }
    await ev(() => TP.game.actions.closeBook());
    await step(10);
    await ev(() => TP.game.actions.pause());
    await step(10);
    log('  pause: ' + (await ev(() => TP.game.state.mode)));
    await page_('e_pause');
    await ev(() => TP.game.actions.resume());
    await step(10);
    await ev(() => TP.game.actions.photo(true));
    await step(10);
    log('  photo: ' + (await ev(() => TP.game.state.mode)));
    await page_('e_photo');
    await ev(() => TP.game.actions.photo(false));
    await step(10);
    // the save: write, read back, compare the things that matter
    log('  save', JSON.stringify(await ev(() => {
      const g = TP.game;
      g.save(true);
      const s = g._readSave();
      return s ? { stage: s.quest && s.quest.stage, primes: s.inv && s.inv.primes, lanterns: s.known && s.known.lanterns, athanor: s.world && s.world.athanor, hasSave: g.actions.hasSave() } : null;
    })));
  }
}
