// node scripts/perimeter.mjs [--shots none|all|<zone>] [--every 8] [--prefix perim] [--params "<extra query>"]
//
// Walks the whole boundary in the built game (GS_DIST) with every door open and god mode: a body
// 1 m inside the barrier (or the first free spot inward of it where a building is the barrier) is
// walked along the loop with the level's own collision, and every 2 m it turns outward and pushes
// at a sprint with a jump. Fails if G.level.zoneAt(pos) is ever null or pos leaves the perimeter
// polygon. Then saves a shot looking outward at eye height every --every metres of perimeter
// (perim-<zone>-<n>.png) and one from each zone's highest standing points (perim-<zone>-top-<n>.png),
// in $TMPDIR/graveyard-shift/shots/. Re-run it with --shots <zone> after changing an area.
import { parseArgs } from 'node:util';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, pageUrl, watchPage, scratch } from './lib.mjs';

const { values: a } = parseArgs({
  options: {
    shots: { type: 'string', default: 'all' }, every: { type: 'string', default: '8' },
    prefix: { type: 'string', default: 'perim' }, params: { type: 'string', default: '' },
  },
});
const outDir = join(scratch, 'shots');
mkdirSync(outDir, { recursive: true });

// highest places a player can stand in each zone, looking out over the edge: [x, feet y, z, yaw]
const TOPS = {
  forecourt: [[-7.5, 0.18, -0.5, 1.5708], [-19.5, 0.15, -18.5, 0.75]], // a pump island, the store's pavement by the alley
  diner: [[14.0, 1.05, -26.4, 0]], // on the counter
  motel: [[27.4, 3.04, -37.2, 1.5708], [59.2, 3.04, -16.4, -1.5708], [32.4, 3.04, -35.7, 0]], // walkway end, east stair top, west stair top
  garage: [[39.0, 1.4, 7.5, 3.1416], [24.6, 0.89, 22.4, 3.1416]], // the low stack, a barrel by the south fence
};

let browser; let code = 0;
try {
  browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const extra = watchPage(page);
  await page.goto(pageUrl(`shot=wide&step=1&open=all&god=1&nohud=1&noweapon=1${a.params ? `&${a.params}` : ''}`));
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });

  const res = await page.evaluate((every) => {
    const L = window.__G.level;
    const per = L.perimeter, poly = L.polygon;
    const R = 0.35, H = 1.8, G = 15, JUMP = 4.8, SPRINT = 6.5, DT = 1 / 60;
    const area = poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + (p[0] * q[1] - q[0] * p[1]); }, 0);
    const k = area > 0 ? 1 : -1;
    const fails = [];
    const shots = [];
    let walked = 0, hops = 0, pushes = 0, sinceShot = every / 2, sincePush = 0, nullZone = 0;
    const blocked = (x, y, z) => L.colliders.some((b) => b.max[1] > y + 0.32 && b.min[1] < y + H && (x - Math.min(Math.max(x, b.min[0]), b.max[0])) ** 2 + (z - Math.min(Math.max(z, b.min[2]), b.max[2])) ** 2 < (R + 0.05) ** 2);
    const spot = (x, z, n) => {
      for (let d = 1.0; d <= 9; d += 0.25) {
        const px = x + n[0] * d, pz = z + n[1] * d;
        if (!L.insidePolygon(px, pz) || L.heightAt(px, pz, 0) > 0.33 || blocked(px, 0, pz)) continue;
        return [px, L.heightAt(px, pz, 0), pz];
      }
      return null;
    };
    const check = (p, where) => {
      const z = L.zoneAt(p[0], p[2]);
      if (!z) { nullZone++; if (fails.length < 40) fails.push(`${where}: zoneAt null at ${p.map((v) => v.toFixed(2))}`); }
      if (!L.insidePolygon(p[0], p[2])) { if (fails.length < 40) fails.push(`${where}: outside the polygon at ${p.map((v) => v.toFixed(2))}`); return false; }
      return true;
    };
    let p = null;
    for (const s of per) {
      const dx = s.to[0] - s.from[0], dz = s.to[1] - s.from[1], len = Math.hypot(dx, dz);
      const n = [(-dz / len) * k, (dx / len) * k];
      for (let d = 0.125; d < len; d += 0.25) {
        const x = s.from[0] + (dx * d) / len, z = s.from[1] + (dz * d) / len;
        const q = spot(x, z, n);
        if (!q) continue;
        if (!p || Math.hypot(q[0] - p[0], q[2] - p[2]) > 1.5) { p = q.slice(); hops++; } else {
          // walk to it
          for (let i = 0; i < 4; i++) {
            const mx = q[0] - p[0], mz = q[2] - p[2], ml = Math.hypot(mx, mz);
            if (ml < 0.02) break;
            const st = Math.min(ml, 0.1);
            p = L.moveCapsule(p, R, H, [(mx / ml) * st, -0.05, (mz / ml) * st]).pos;
          }
        }
        check(p, `${s.id} walk`);
        walked += 0.25; sincePush += 0.25; sinceShot += 0.25;
        if (sincePush >= 2) {
          sincePush = 0; pushes++;
          let b = p.slice(), vy = 0, ground = true;
          const ox = -n[0], oz = -n[1];
          for (let f = 0; f < 60; f++) {
            if (ground && f === 18) { vy = JUMP; ground = false; }
            vy -= G * DT;
            const r = L.moveCapsule(b, R, H, [ox * SPRINT * DT, vy * DT, oz * SPRINT * DT]);
            if (r.onGround && vy < 0) vy = 0;
            ground = r.onGround;
            b = r.pos;
            if (!check(b, `${s.id} push`)) break;
            if (ground && b[1] > 1.2) { if (fails.length < 40) fails.push(`${s.id} push: standing on the barrier at ${b.map((v) => v.toFixed(2))}`); break; }
          }
        }
        if (sinceShot >= every) {
          sinceShot = 0;
          shots.push({ zone: s.zone, seg: s.id, barrier: s.barrier, cam: [p[0], p[1] + 1.7, p[2], Math.atan2(-(-n[0]), -(-n[1])), 0.04] });
        }
      }
    }
    return { walked, hops, pushes, fails, nullZone, shots, length: per.reduce((s, q) => s + Math.hypot(q.to[0] - q.from[0], q.to[1] - q.from[1]), 0) };
  }, Number(a.every));

  console.log(`[perimeter] loop ${res.length.toFixed(1)} m, walked ${res.walked.toFixed(1)} m in ${res.hops} stretches, ${res.pushes} pushes, ${res.shots.length} shots`);
  if (res.fails.length) { console.log(`[perimeter] FAIL ${res.fails.length} problem(s):\n  ${res.fails.join('\n  ')}`); code = 1; } else console.log('[perimeter] OK: never outside the polygon, never on a barrier, zoneAt never null');

  // ---- shots
  const want = a.shots;
  const shoot = async (name, cam) => {
    await page.evaluate((c) => { window.__setShot({ cam: c, fov: 70 }); window.__step = 3; }, cam);
    await page.waitForFunction(() => window.__step === 0, null, { timeout: 60000 });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.screenshot({ path: join(outDir, `${name}.png`) });
  };
  if (want !== 'none') {
    const n = {};
    for (const s of res.shots) {
      if (want !== 'all' && want !== s.zone) continue;
      n[s.zone] = (n[s.zone] || 0) + 1;
      await shoot(`${a.prefix}-${s.zone}-${n[s.zone]}`, s.cam);
    }
    for (const [zone, list] of Object.entries(TOPS)) {
      if (want !== 'all' && want !== zone) continue;
      let i = 0;
      for (const [x, y, z, yaw] of list) await shoot(`${a.prefix}-${zone}-top-${++i}`, [x, y + 1.7, z, yaw, -0.02]);
    }
    console.log(`[perimeter] shots in ${outDir} (${a.prefix}-<zone>-<n>.png): ${Object.entries(n).map(([z, c]) => `${z} ${c}`).join(', ')}`);
  }
  const errors = await page.evaluate(() => window.__errors || []);
  const all = [...errors, ...extra];
  if (all.length) { console.log(`[perimeter] ${all.length} page error(s):\n  ${all.slice(0, 10).join('\n  ')}`); code = 1; }
} catch (e) {
  console.error(`[perimeter] failed: ${e.message}`);
  code = 1;
} finally {
  if (browser) await browser.close();
}
process.exit(code);
