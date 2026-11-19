// Scratch scenario: numbers behind a view. Edit freely.
export default async function ({ ev, step, log, page, args }) {
  await step(20);
  await page.waitForTimeout(2600);
  await ev(() => TP.play());
  await step(20);
  const at = args.at ? args.at.split(',').map(Number) : null;
  if (at) await ev((a) => TP.go(a[0], a[1], a[2] || 0, a[3] || 0), at);
  else
    await ev(() => {
      const r = TP.world.layout.rockfall;
      TP.go(r.x + r.tx * 16, r.z + r.tz * 16, 0, 4);
    });
  if (args.hour != null) await ev((h) => TP.hour(h), Number(args.hour));
  await step(150, 1 / 30);
  const r = await ev(() => {
    const g = TP.game,
      e = g.engine;
    return {
      hour: +g.state.time.hour.toFixed(2),
      region: g.region,
      gloomHere: +g._gloomHere.toFixed(2),
      night: +(e.sky.night || 0).toFixed(2),
      atmo: { overcast: +e.atmo.overcast.toFixed(2), fog: +e.atmo.fog.toFixed(2), dim: +e.atmo.dim.toFixed(2) },
      pool: e.lighting.pool.map((l) => +l.intensity.toFixed(1)),
      amb: e.sky.ambient ? e.sky.ambient.toArray().map((v) => +v.toFixed(3)) : null,
      sun: +(e.sky.lightIntensity || 0).toFixed(2),
      hemi: +e.hemi.intensity.toFixed(2),
      grade: { gloom: +e.post.grade.gloom.toFixed(2), hurt: +e.post.grade.hurt.toFixed(2) },
      pos: [g.player.pos.x, g.player.pos.y, g.player.pos.z].map((v) => +v.toFixed(1)),
    };
  });
  log(JSON.stringify(r, null, 1));
  const s = await ev((n) => TP.shot(n, 6), args.name || 'dbg');
  log(s.file);
}
