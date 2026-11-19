// The game through real hands: real mouse clicks and key presses, the game's own frame loop.
//   node tools/play.mjs tools/scenarios/hands.mjs --live 1 --q high
export default async function ({ ev, log, page, shot }) {
  const st = () =>
    ev(() => {
      const g = TP.game, p = g.player;
      return { mode: g.state.mode, cut: !!g._cut, locked: g.input.locked, lockFailed: g.input.lockFailed, pos: [p.pos.x, p.pos.y, p.pos.z].map((v) => +v.toFixed(2)), heading: +p.heading.toFixed(3), pitch: +p.pitch.toFixed(3), ground: p.onGround };
    });
  await page.waitForTimeout(3500);
  log('title', JSON.stringify(await st()));
  // A plain lock for this run. With raw movement (which the game asks for first, see raw.mjs) this
  // window hears the real mouse of the machine it runs on, and the angles below are not ours alone.
  await ev(() => {
    TP.game.input.raw = false;
  });

  // the title: move over the entries, click Begin
  const begin = page.getByText('Begin', { exact: true }).first();
  await begin.hover();
  await page.waitForTimeout(200);
  await begin.click();
  await page.waitForTimeout(1500);
  log('after Begin', JSON.stringify(await st()));
  // skip the arrival with a key, as a player would
  await page.waitForTimeout(1500);
  await page.keyboard.press('Space');
  await page.waitForTimeout(2500);
  log('after skip', JSON.stringify(await st()));
  for (let i = 0; i < 20 && (await ev(() => TP.game.state.mode !== 'play' || !!TP.game._cut)); i++) await page.waitForTimeout(1000);
  log('play', JSON.stringify(await st()));

  // click into the world: the pointer lock
  await page.mouse.click(800, 450);
  await page.waitForTimeout(600);
  const a = await st();
  log('clicked', JSON.stringify(a), 'lockElement', await ev(() => (document.pointerLockElement ? document.pointerLockElement.tagName : null)));

  // walk
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyW');
  const b = await st();
  log('W 1.5 s', JSON.stringify(b.pos), 'moved', (Math.hypot(b.pos[0] - a.pos[0], b.pos[2] - a.pos[2])).toFixed(2), 'm');
  // run
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  const c = await st();
  log('Shift+W 1.5 s moved', (Math.hypot(c.pos[0] - b.pos[0], c.pos[2] - b.pos[2])).toFixed(2), 'm');
  // look
  await page.mouse.move(800, 450);
  await page.mouse.move(1000, 420, { steps: 12 });
  await page.waitForTimeout(300);
  const d = await st();
  log('mouse +200,-30', 'heading', c.heading, '->', d.heading, 'pitch', c.pitch, '->', d.pitch);
  // drag-look when the lock is not there
  if (!d.locked) {
    await page.mouse.move(800, 450);
    await page.mouse.down();
    await page.mouse.move(1000, 420, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const d2 = await st();
    log('drag +200,-30', 'heading', d.heading, '->', d2.heading, 'pitch', d.pitch, '->', d2.pitch);
  }
  // jump
  await page.keyboard.press('Space');
  await page.waitForTimeout(220);
  const e = await st();
  log('jump', 'y', d.pos[1], '->', e.pos[1], 'ground', e.ground);
  await page.waitForTimeout(900);

  // gather a plant with E: stand by the nearest one, look at it
  const plant = await ev(() => {
    const g = TP.game, p = g.player.pos;
    let best = null;
    for (const q of g.ents.plants) {
      if (q.taken || q.gone) continue;
      const x = q.x != null ? q.x : q.placed && q.placed.x, z = q.z != null ? q.z : q.placed && q.placed.z;
      if (x == null) continue;
      const dd = Math.hypot(x - p.x, z - p.z);
      if (!best || dd < best.d) best = { d: dd, x, z, id: q.id || q.kind || q.type };
    }
    if (!best) return null;
    const sx = best.x, sz = best.z + 1.3;
    g.player.teleport(sx, null, sz, 0, -0.75);
    return best;
  });
  await page.waitForTimeout(700);
  log('plant', JSON.stringify(plant), 'focus', JSON.stringify(await ev(() => TP.game.hud.focus)));
  const inv0 = await ev(() => JSON.stringify(TP.game.state.inv.ingredients));
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(900);
  log('E:', inv0, '->', await ev(() => JSON.stringify(TP.game.state.inv.ingredients)));
  await shot('h_play');

  // throw a phial with the mouse: hold to aim, release to throw
  await ev(() => {
    TP.give({ potions: { ember: 3 } });
    TP.game.potions.select('ember');
    TP.game.player.pitch = 0.1;
  });
  await page.waitForTimeout(300);
  const n0 = await ev(() => TP.game.state.inv.potions.ember);
  await page.mouse.move(800, 450);
  await page.mouse.down();
  await page.waitForTimeout(500);
  await shot('h_aim');
  await page.mouse.up();
  await page.waitForTimeout(1500);
  log('throw: ember', n0, '->', await ev(() => TP.game.state.inv.potions.ember));

  // the book, the map, the pause, with keys
  await page.keyboard.press('Tab');
  await page.waitForTimeout(700);
  log('Tab ->', (await st()).mode);
  await shot('h_book');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  log('Esc ->', (await st()).mode);
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(700);
  log('M ->', (await st()).mode);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  log('Esc ->', (await st()).mode);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  log('Esc ->', (await st()).mode);
  await shot('h_pause');
  const resume = page.getByText('Resume', { exact: true }).first();
  if (await resume.count()) {
    await resume.click();
    await page.waitForTimeout(700);
    log('Resume ->', JSON.stringify(await st()));
  }
  // sound: is the audio graph running and making signal?
  log('audio', JSON.stringify(await ev(() => {
    const a = TP.game.audio;
    const ctx = a.ctx || a.context || (a.engine && a.engine.ctx);
    return ctx ? { state: ctx.state, rate: ctx.sampleRate, time: +ctx.currentTime.toFixed(1) } : { keys: Object.keys(a).slice(0, 30) };
  })));
}
