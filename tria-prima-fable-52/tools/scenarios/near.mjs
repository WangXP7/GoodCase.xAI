// What stands near a point: names and distances of the placed props. --at x,z  --r radius
export default async function ({ ev, step, log, page, args }) {
  await step(20);
  await page.waitForTimeout(2600);
  await ev(() => TP.play());
  await step(10);
  const at = args.at ? args.at.split(',').map(Number) : null;
  const r = Number(args.r || 4);
  const out = await ev(
    ([at, r]) => {
      const L = TP.world.layout;
      const x = at ? at[0] : L.spawn.x,
        z = at ? at[1] : L.spawn.z;
      const res = [];
      for (const p of TP.world.placed) {
        const px = p.x != null ? p.x : p.position ? p.position.x : null,
          pz = p.z != null ? p.z : p.position ? p.position.z : null;
        if (px == null) continue;
        const d = Math.hypot(px - x, pz - z);
        if (d < r) res.push({ m: p.name, d: +d.toFixed(2), x: +px.toFixed(1), y: p.y != null ? +p.y.toFixed(2) : null, z: +pz.toFixed(1), s: p.scale != null ? +(+p.scale).toFixed(2) : null });
      }
      res.sort((a, b) => a.d - b.d);
      return { at: [x, z], n: TP.world.placed.length, res, mask: TP.world.T.mask(x, z), h: TP.world.T.heightAt(x, z), region: TP.world.T.regionAt(x, z) };
    },
    [at, r]
  );
  log(JSON.stringify(out.at), 'placed', out.n, 'height', out.h.toFixed(2), out.region, JSON.stringify(out.mask));
  for (const q of out.res) log(JSON.stringify(q));
}
