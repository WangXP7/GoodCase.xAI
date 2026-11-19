// The last checks: Shades against cold and fire, the save across a reload, the title and the arrival.
//   node tools/play.mjs tools/scenarios/misc.mjs --q high [--only shade,save,title,props]
export default async function ({ ev, step, shot, log, page, args }) {
  const only = args.only ? args.only.split(',') : null;
  const want = (n) => !only || only.includes(n);
  const ui = async (name) => {
    await page.waitForTimeout(700);
    await shot(name);
  };
  const frame = async (name, settle = 6) => {
    const r = await ev(([n, s]) => TP.shot(n, s), [name, settle]);
    log('  ' + r.file.split(/[\\/]/).pop());
  };
  await step(30);
  await page.waitForTimeout(2600);

  if (want('title')) {
    log('TITLE');
    await step(60);
    await ui('x_title');
    log('  ', JSON.stringify(await ev(() => ({ mode: TP.game.state.mode, hasSave: TP.game.actions.hasSave(), hour: +TP.game.state.time.hour.toFixed(2) }))));
    // the arrival as a new player gets it
    await ev(() => TP.game.actions.newGame());
    for (let i = 0; i < 8; i++) {
      await step(60);
      const s = await ev(() => ({ mode: TP.game.state.mode, cut: TP.game._cut ? TP.game._cut.phase || true : null, stage: TP.game.state.quest.stage, pos: [TP.game.player.pos.x, TP.game.player.pos.y, TP.game.player.pos.z].map((v) => +v.toFixed(1)) }));
      log('  t=' + (i + 1) * 2 + ' s', JSON.stringify(s));
      if (i === 0 || i === 2 || i === 5) await ui('x_arrive_' + i);
      if (s.mode === 'play' && !s.cut && i > 1) break;
    }
    await ui('x_arrived');
  }

  if (want('shade')) {
    log('SHADES');
    await ev(() => TP.play());
    await step(20);
    const s0 = await ev(() => {
      const g = TP.game, L = TP.world.layout;
      TP.give({ potions: { ember: 5, rime: 5, fulminate: 3 } });
      const sp = g.shades.list.find((s) => s.region === 'saltwood') || g.shades.list[0];
      // stand a little way off the spot, looking at it
      const x = sp.spot.x + 9, z = sp.spot.z + 9;
      TP.go(x, z, (Math.atan2(sp.spot.x - x, -(sp.spot.z - z)) * 180) / Math.PI, -2);
      return { n: g.shades.list.length, regions: [...new Set(g.shades.list.map((s) => s.region))], spot: [sp.spot.x, sp.spot.z].map((v) => +v.toFixed(1)) };
    });
    log('  ', JSON.stringify(s0));
    let seen = null;
    for (let i = 0; i < 40; i++) {
      await step(15);
      seen = await ev(() => {
        const g = TP.game, p = g.player.pos;
        let best = null;
        for (const s of g.shades.list) {
          if (s.state === 'gone' || s.state === 'dying') continue;
          const d = Math.hypot(s.x - p.x, s.z - p.z);
          if (!best || d < best.d) best = { i: g.shades.list.indexOf(s), d: +d.toFixed(1), state: s.state, fade: +s.fade.toFixed(2) };
        }
        return best;
      });
      if (seen && seen.d < 7 && seen.fade < 0.3) break;
    }
    log('  nearest', JSON.stringify(seen), 'hp', await ev(() => Math.round(TP.game.state.player.hp)));
    if (seen) {
      // turn to it, freeze it
      await ev((i) => {
        const g = TP.game, s = g.shades.list[i], p = g.player.pos;
        g.player.heading = Math.atan2(s.x - p.x, -(s.z - p.z));
        g.player.pitch = 0.05;
        g.state.player.hp = 100;
        g.potions.burst('rime', s.x, s.y + 0.2, s.z, 'ground');
      }, seen.i);
      await step(20);
      log('  frozen', JSON.stringify(await ev((i) => ({ frozen: +TP.game.shades.list[i].frozen.toFixed(1), state: TP.game.shades.list[i].state }), seen.i)));
      await frame('x_shade_frozen', 4);
      const hp0 = await ev(() => TP.game.state.player.hp);
      await step(60);
      log('  hp held while frozen', hp0, '->', await ev(() => TP.game.state.player.hp));
      await ev((i) => {
        const g = TP.game, s = g.shades.list[i];
        g.potions.burst('ember', s.x, s.y + 0.2, s.z, 'ground');
      }, seen.i);
      await step(8);
      log('  burned', JSON.stringify(await ev((i) => ({ state: TP.game.shades.list[i].state, wait: +TP.game.shades.list[i].wait.toFixed(0) }), seen.i)));
      await frame('x_shade_burn', 2);
      await step(60);
      log('  after', JSON.stringify(await ev((i) => ({ state: TP.game.shades.list[i].state }), seen.i)));
    }
    // a thrown phial through the air: the real throw, not the burst
    const thr = await ev(() => {
      const g = TP.game;
      g.potions.select('ember');
      const n0 = g.state.inv.potions.ember;
      g.player.pitch = 0.1;
      g.potions.throw('ember');
      TP.step(90, 1 / 30);
      return { before: n0, after: g.state.inv.potions.ember };
    });
    log('  thrown', JSON.stringify(thr));
  }

  if (want('props')) {
    log('PROPS');
    await ev(() => TP.play());
    await step(20);
    const pr = await ev(() => {
      const g = TP.game, L = TP.world.layout;
      const out = { pages: 0, bodies: 0, crows: 0 };
      if (g.ents.pages) out.pages = g.ents.pages.length;
      if (g.ents.loose) out.bodies = g.ents.loose.length;
      if (g.ambient && g.ambient.crows) out.crows = g.ambient.crows.length;
      out.keys = Object.keys(g.ents).filter((k) => Array.isArray(g.ents[k])).map((k) => k + ':' + g.ents[k].length);
      return out;
    });
    log('  ', JSON.stringify(pr));
  }

  if (want('save')) {
    log('SAVE');
    await ev(() => TP.play());
    await step(20);
    const before = await ev(() => {
      const g = TP.game, st = g.state, L = TP.world.layout;
      TP.give({ potions: { ember: 3, vitae: 2 }, ingredients: { ashcap: 4 }, primes: { salt: true } });
      if (st.world.athanor < 1) g.ents.kindle();
      g.ents.lightLantern(g.ents.lanterns[0]);
      TP.go(L.door.x + 2, L.door.z + 9, 20, 3);
      TP.hour(9.5);
      TP.step(30, 1 / 30);
      g.save(true);
      const p = g.player.pos;
      return { stage: st.quest.stage, potions: st.inv.potions, primes: st.inv.primes, lanterns: st.known.lanterns, athanor: st.world.athanor, hour: +st.time.hour.toFixed(2), pos: [p.x, p.y, p.z].map((v) => +v.toFixed(1)) };
    });
    log('  before', JSON.stringify(before));
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.TP && window.DONE, null, { timeout: 180000 });
    await step(40);
    await page.waitForTimeout(2600);
    await step(30);
    log('  reloaded', JSON.stringify(await ev(() => ({ mode: TP.game.state.mode, hasSave: TP.game.actions.hasSave() }))));
    await ui('x_title_continue');
    await ev(() => TP.game.actions.continueGame());
    await step(90);
    await page.waitForTimeout(1500);
    await step(60);
    const after = await ev(() => {
      const g = TP.game, st = g.state, p = g.player.pos;
      return { mode: st.mode, stage: st.quest.stage, potions: st.inv.potions, primes: st.inv.primes, lanterns: st.known.lanterns, athanor: st.world.athanor, hour: +st.time.hour.toFixed(2), pos: [p.x, p.y, p.z].map((v) => +v.toFixed(1)), lit: g.ents.lanterns.filter((l) => l.lit).length, fire: g.ents.athanorLit != null ? g.ents.athanorLit : null };
    });
    log('  after ', JSON.stringify(after));
    await ui('x_continued');
  }
}
