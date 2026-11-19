// Look-dev: the same viewpoints round the isle every time, canvas only (no HUD), so changes to
// light, materials and weather can be compared. --only a,b limits the set, --hour h overrides.
//   node tools/play.mjs tools/scenarios/look.mjs --q high --only dock,chapel
export default async function ({ ev, step, log, page, args }) {
  await step(20);
  await page.waitForTimeout(2600);
  await ev(() => TP.play());
  await step(20);
  const only = args.only ? args.only.split(',') : null;
  const hour = args.hour != null ? Number(args.hour) : null;

  const views = await ev(() => {
    const L = TP.world.layout,
      T = TP.world.T;
    const lan = (id) => L.lanterns.find((l) => l.id === id);
    const toward = (tx, tz, fx, fz, dist) => {
      // stand `dist` from the target on the side of (fx, fz), facing the target
      const dx = fx - tx,
        dz = fz - tz,
        l = Math.hypot(dx, dz) || 1;
      const x = tx + (dx / l) * dist,
        z = tz + (dz / l) * dist;
      return { x, z, heading: (Math.atan2(tx - x, -(tz - z)) * 180) / Math.PI };
    };
    const v = [];
    v.push({ name: 'dock', x: L.start.x, z: L.start.z, heading: 0, pitch: 2, y: L.start.y });
    v.push({ name: 'road', x: -3, z: 215, heading: 0, pitch: 4 });
    v.push({ name: 'chapel', x: L.door.x + 3, z: L.door.z + 22, heading: -6, pitch: 7 });
    v.push({ name: 'inside', x: L.spawn.x, z: L.spawn.z, heading: 0, pitch: 3, y: L.spawn.y + 0.05 });
    v.push({ name: 'bench', x: L.chapel.x - 0.5, z: L.chapel.z - 3.2, heading: -78, pitch: -8, y: L.chapel.y + 0.35 });
    v.push({ name: 'pyre', ...toward(L.pyre.x, L.pyre.z, L.door.x, L.door.z, 9), pitch: -6 });
    if (L.gate) v.push({ name: 'gate', ...toward(L.gate.x, L.gate.z, L.chapel.x, L.chapel.z, 13), pitch: 3 });
    const ls = lan('saltwood');
    if (ls) v.push({ name: 'saltwood', ...toward(ls.x, ls.z, L.gate ? L.gate.x : 0, L.gate ? L.gate.z : 0, 16), pitch: 6 });
    if (L.vine) v.push({ name: 'hollow', ...toward(L.vine.x, L.vine.z, ls ? ls.x : 0, ls ? ls.z : 0, 22), pitch: 10 });
    const lm = lan('mere');
    if (lm) v.push({ name: 'mere', ...toward(L.islet.x, L.islet.z, lm.x, lm.z, Math.hypot(L.islet.x - lm.x, L.islet.z - lm.z) + 6), pitch: 0 });
    if (L.rockfall) v.push({ name: 'rockfall', x: L.rockfall.x - L.rockfall.tx * -16, z: L.rockfall.z - L.rockfall.tz * -16, heading: 0, pitch: 4, face: [L.rockfall.x, L.rockfall.z] });
    const lc = lan('scar');
    if (lc) v.push({ name: 'scar', ...toward(L.primeSulfur.x, L.primeSulfur.z, lc.x, lc.z, 30), pitch: -2 });
    if (L.peak) v.push({ name: 'peak', x: L.peak.x, z: L.peak.z + 4, heading: 170, pitch: -8 });
    for (const q of v) {
      if (q.face) q.heading = (Math.atan2(q.face[0] - q.x, -(q.face[1] - q.z)) * 180) / Math.PI;
      q.ground = T.heightAt(q.x, q.z);
    }
    return v;
  });

  for (const v of views) {
    if (only && !only.includes(v.name)) continue;
    await ev(
      ([v, hour]) => {
        TP.game.state.player.hp = 100;
        TP.go(v.x, v.z, v.heading, v.pitch || 0, v.y != null ? v.y : null);
        if (hour != null) TP.hour(hour);
      },
      [v, hour]
    );
    // let the weather of the place settle, then hold the hour again
    await step(150, 1 / 30);
    if (hour != null) await ev((h) => TP.hour(h), hour);
    await step(20, 1 / 30);
    const tag = hour != null ? `_h${String(hour).replace('.', '')}` : '';
    const r = await ev((n) => TP.shot(n, 6), `l_${v.name}${tag}`);
    log(r.file, JSON.stringify({ x: +v.x.toFixed(1), z: +v.z.toFixed(1), g: +v.ground.toFixed(1), region: await ev(() => TP.game.region), hp: await ev(() => Math.round(TP.game.state.player.hp)) }));
  }
}
