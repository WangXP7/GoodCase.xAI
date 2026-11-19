// Real frame times: the game runs its own loop (no stepping), vsync off.
//   node tools/play.mjs tools/scenarios/perf.mjs --live 1 --q high [--w 1920 --h 1080]
export default async function ({ ev, log, page, args }) {
  await page.waitForTimeout(3000);
  await ev(() => {
    TP.game.settings.autoQuality = false;
    TP.play();
  });
  await page.waitForTimeout(2500);
  const views = await ev(() => {
    const L = TP.world.layout;
    const lan = (id) => L.lanterns.find((l) => l.id === id);
    const v = [
      { name: 'dock', x: L.start.x, z: L.start.z, heading: 0, pitch: 2 },
      { name: 'road', x: -3, z: 215, heading: 0, pitch: 4 },
      { name: 'chapel', x: L.door.x + 3, z: L.door.z + 22, heading: -6, pitch: 7 },
      { name: 'inside', x: L.spawn.x, z: L.spawn.z, heading: 0, pitch: 3, y: L.spawn.y + 0.05 },
    ];
    const ls = lan('saltwood'), lm = lan('mere'), lc = lan('scar');
    if (ls) v.push({ name: 'saltwood', x: ls.x + 6, z: ls.z + 6, heading: -60, pitch: 2 });
    if (lm) v.push({ name: 'mere', x: lm.x + 4, z: lm.z + 4, heading: 140, pitch: 0 });
    if (lc) v.push({ name: 'scar', x: lc.x + 3, z: lc.z + 3, heading: 200, pitch: 0 });
    if (L.peak) v.push({ name: 'peak', x: L.peak.x, z: L.peak.z + 4, heading: 170, pitch: -8 });
    return v;
  });
  const res = [];
  for (const v of views) {
    await ev((v) => {
      TP.game.state.player.hp = 100;
      TP.go(v.x, v.z, v.heading, v.pitch || 0, v.y != null ? v.y : null);
    }, v);
    await page.waitForTimeout(1500);
    const r = await ev(
      () =>
        new Promise((done) => {
          const t = [];
          let last = performance.now();
          const t0 = last;
          function f(now) {
            t.push(now - last);
            last = now;
            if (now - t0 < 3000) requestAnimationFrame(f);
            else {
              t.sort((a, b) => a - b);
              const mean = t.reduce((a, b) => a + b, 0) / t.length;
              done({ frames: t.length, fps: +(1000 / mean).toFixed(0), p95: +t[Math.floor(t.length * 0.95)].toFixed(1), worst: +t[t.length - 1].toFixed(1), calls: TP.engine.stats.calls, tris: TP.engine.stats.tris });
            }
          }
          requestAnimationFrame(f);
        })
    );
    res.push({ view: v.name, ...r });
    log(v.name.padEnd(9), JSON.stringify(r));
  }
  log('quality', await ev(() => TP.engine.quality), 'size', await ev(() => [TP.engine.w, TP.engine.h]));
}
