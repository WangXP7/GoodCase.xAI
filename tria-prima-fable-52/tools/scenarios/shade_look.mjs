// The Shade in play, and the crows. Goes to a Shade's spot in the Saltwood at dusk, lets it wake
// and come, and takes
//   g_shade_0  coming, through the player's eye
//   g_shade_1  close, through the player's eye
//   g_shade_2  close, from its side (a free eye)
// then stands three perched crows in a row in the open, 0.7 m up as if on posts: A with its wings
// folded the way the game folds them (x - 0.4), B with the fold tried here (FOLD, x + 0.4), C with
// the plain version of that fold (FOLD_PLAIN, x + 1.2), and takes
//   g_crow_0   A and B from the front and above (A on the left)
//   g_crow_1   A and B from behind, level (A on the right)
//   g_crow_2   A and B from behind and above (A on the right)
//   g_crow_4   B and C close, from behind and above (B on the right)
//   g_crow_5   B and C close, from the front and above (B on the left)
//   g_crow_3   A leaving, wings beating
//   node tools/play.mjs tools/scenarios/shade_look.mjs --q high [--hour 19.5] [--crowhour 12]

// The fold tried on the crow: the wing rolled a little about its span, swept back along the body,
// dropped to the line of the back, and drawn in (a spread wing is longer and wider than a folded
// one). Rotation order YZX: roll about the span first, then the drop, then the sweep.
const FOLD = { roll: 0.45, sweep: 1.62, droop: 0.33, sx: 0.68, sz: 0.5 };
// The plain version: no roll, the chord left as it is (the same as the default order with x = 0).
const FOLD_PLAIN = { roll: 0, sweep: 1.55, droop: 0.35, sx: 0.7, sz: 1 };

export default async function ({ ev, step, log, page, args }) {
  await step(20);
  await page.waitForTimeout(2600);
  await ev(() => TP.play());
  await step(20);
  const hour = args.hour != null ? Number(args.hour) : 19.5;
  const crowHour = args.crowhour != null ? Number(args.crowhour) : 12;

  // ------------------------------------------------------------------ the Shade
  const info = await ev(() => {
    const list = TP.game.shades.list;
    const inWood = list.filter((q) => q.region === 'saltwood');
    const s = inWood.find((q) => !String(q.spot.id).includes('keeper')) || inWood[0] || list[0];
    if (!s) return null;
    window.__shade = s;
    const m = s.placed.model;
    return {
      shades: list.length,
      spot: { id: s.spot.id, region: s.region, x: s.spot.x, z: s.spot.z },
      gloom: { ...TP.game.state.world.gloom },
      size: m.size,
      anchors: m.anchors,
      parts: Object.keys(s.placed.parts || {}),
      arms: s.arms ? s.arms.length : 0,
      eyes: !!s.eyes,
      height: s.height,
    };
  });
  log('shade', JSON.stringify(info));

  if (info) {
    const stand = await ev((hour) => {
      const s = window.__shade,
        L = TP.world.layout;
      const ln = (L.lanterns || []).find((l) => l.id === 'saltwood');
      let dx = ln ? ln.x - s.spot.x : 0,
        dz = ln ? ln.z - s.spot.z : 1;
      const l = Math.hypot(dx, dz) || 1;
      const x = s.spot.x + (dx / l) * 19,
        z = s.spot.z + (dz / l) * 19;
      const heading = (Math.atan2(s.spot.x - x, -(s.spot.z - z)) * 180) / Math.PI;
      TP.hour(hour);
      TP.game.state.player.hp = 100;
      TP.go(x, z, heading, 2);
      return { x: +x.toFixed(1), z: +z.toFixed(1), heading: +heading.toFixed(0) };
    }, hour);
    log('stand', JSON.stringify(stand));

    // face it, looking at a point `up` metres above its base
    const aim = (up) =>
      ev((up) => {
        const s = window.__shade,
          p = TP.game.player.pos;
        const d = Math.hypot(s.x - p.x, s.z - p.z);
        const heading = (Math.atan2(s.x - p.x, -(s.z - p.z)) * 180) / Math.PI;
        const pitch = (Math.atan2(s.y + up - (p.y + 1.65), d) * 180) / Math.PI;
        TP.go(p.x, p.z, heading, pitch);
      }, up);
    const state = () =>
      ev((hour) => {
        const s = window.__shade,
          p = TP.game.player.pos,
          st = TP.game.state;
        st.player.hp = 100;
        TP.hour(hour);
        return {
          state: s.state,
          d: +Math.hypot(s.x - p.x, s.z - p.z).toFixed(2),
          fade: +s.fade.toFixed(2),
          reach: +(s.reach || 0).toFixed(2),
          over: +(s.y - TP.world.T.heightAt(s.x, s.z)).toFixed(2),
          gloom: st.world.gloom[s.region],
          mode: st.mode,
          eyes: s.eyes ? s.eyes.visible : null,
          armX: s.arms && s.arms[0] ? +s.arms[0].rotation.x.toFixed(2) : null,
        };
      }, hour);

    let got0 = false,
      got1 = false,
      forced = false,
      last = null;
    for (let i = 0; i < 300 && !got1; i++) {
      await step(2, 1 / 30);
      last = await state();
      if (i === 45 && last.state === 'gone' && !forced) {
        // it did not wake by itself: say so, then make the wood dark enough and try again
        log('shade did not wake by itself', JSON.stringify(last));
        forced = true;
        await ev(() => {
          const s = window.__shade;
          TP.game.state.world.gloom[s.region] = 1;
          s.wait = 0;
        });
      }
      if (!got0 && last.state === 'chase' && last.d < 7.2) {
        await aim(1.25);
        const r = await ev(() => TP.shot('g_shade_0', 2));
        log(r.file, JSON.stringify(await state()));
        got0 = true;
      }
      if (got0 && !got1 && last.d < 3.0) {
        await aim(1.7);
        const r = await ev(() => TP.shot('g_shade_1', 1));
        log(r.file, JSON.stringify(await state()));
        got1 = true;
      }
    }
    if (!got1) log('the Shade never came close', JSON.stringify(last), 'forced gloom:', forced);

    if (got1) {
      await ev(() => {
        const s = window.__shade,
          p = TP.game.player.pos;
        const dx = p.x - s.x,
          dz = p.z - s.z,
          l = Math.hypot(dx, dz) || 1;
        // 2.7 m off to one side, a little ahead of it, level with its chest
        const cx = s.x + (dx / l) * 1.0 + (dz / l) * 2.7,
          cz = s.z + (dz / l) * 1.0 - (dx / l) * 2.7;
        const tx = s.x + (dx / l) * 0.45,
          tz = s.z + (dz / l) * 0.45;
        const heading = (Math.atan2(tx - cx, -(tz - cz)) * 180) / Math.PI;
        TP.game.state.player.hp = 100;
        TP.cam(cx, s.y + 1.35, cz, heading, 0);
      });
      const r = await ev(() => TP.shot('g_shade_2', 2));
      log(r.file, JSON.stringify(await state()));
      await ev(() => TP.cam(null));
    }
  }

  // ------------------------------------------------------------------ three crows in a row
  const crow = await ev((crowHour) => {
    const sh = TP.game.shades;
    for (const q of sh.list) {
      if (q.state !== 'gone') sh.kill(q, 1e9);
      q.wait = 1e9;
    }
    const T = TP.world.T;
    const all = TP.game.ambient.crows;
    const perched = all.filter((c) => c.state === 'perch');
    if (perched.length < 3) return { crows: all.length, perched: perched.length };
    const X = -3,
      Z = 211;
    const put = (c, x, z) => {
      const y = T.heightAt(x, z) + 0.7;
      c.x = c.home.x = x;
      c.y = c.home.y = y;
      c.z = c.home.z = z;
      c.home.ry = 0;
      c.placed.x = x;
      c.placed.y = y;
      c.placed.z = z;
      c.placed.object.position.set(x, y, z);
      return y;
    };
    const [A, B, C] = perched;
    const y = put(A, X - 0.4, Z);
    put(B, X + 0.4, Z);
    put(C, X + 1.2, Z);
    window.__crows = [A, B, C];
    window.__crowAt = { x: X, y, z: Z };
    TP.hour(crowHour);
    TP.game.state.player.hp = 100;
    TP.go(X, Z + 14, 0, 0);
    const m = A.placed.model;
    return { crows: all.length, perched: perched.length, y: +y.toFixed(2), wings: A.wings.length, anchors: m.anchors, size: m.size, opaque: !!m.opaque, parts: Object.keys(A.placed.parts || {}) };
  }, crowHour);
  log('crow', JSON.stringify(crow));

  if (crow && crow.perched >= 3) {
    await step(40, 1 / 30);
    await ev(
      ([h, folds]) => {
        TP.hour(h);
        folds.forEach((fold, i) => {
          for (const w of window.__crows[i + 1].wings) {
            w.pivot.rotation.order = 'YZX';
            w.pivot.rotation.set(fold.roll, -w.sign * fold.sweep, w.sign * fold.droop);
            w.pivot.scale.set(fold.sx, 1, fold.sz);
          }
        });
      },
      [crowHour, [FOLD, FOLD_PLAIN]]
    );
    // the eye stands (dx, dy, dz) from a point `ox` along the row and looks at that point
    const view = (name, dx, dy, dz, pitch, ox = 0) =>
      ev(
        ([name, dx, dy, dz, pitch, ox]) => {
          const p = window.__crowAt;
          const cx = p.x + ox + dx,
            cz = p.z + dz;
          const heading = (Math.atan2(p.x + ox - cx, -(p.z - cz)) * 180) / Math.PI;
          TP.cam(cx, p.y + dy, cz, heading, pitch);
          return TP.shot(name, 2);
        },
        [name, dx, dy, dz, pitch, ox]
      );
    log((await view('g_crow_0', 0.75, 0.45, 1.35, -13)).file, 'A, B from the front and above: the fold of the game on the left', JSON.stringify(FOLD));
    log((await view('g_crow_1', 0, 0.12, -1.5, 0)).file, 'A, B from behind, level: the fold of the game on the right');
    log((await view('g_crow_2', -0.9, 0.5, -1.2, -15)).file, 'A, B from behind and above: the fold of the game on the right');
    log((await view('g_crow_4', 0, 0.5, -0.95, -24, 0.8)).file, 'B, C close from behind and above: B on the right', JSON.stringify(FOLD_PLAIN));
    log((await view('g_crow_5', 0, 0.45, 0.95, -22, 0.8)).file, 'B, C close from the front and above: B on the left');

    // leaving: the player steps in and they go (the tried folds are undone first, as the game would have to)
    await ev(() => {
      const [A, B, C] = window.__crows;
      for (const c of [B, C])
        for (const w of c.wings) {
          w.pivot.rotation.order = 'XYZ';
          w.pivot.rotation.set(0, 0, 0);
          w.pivot.scale.set(1, 1, 1);
        }
      TP.game.state.player.hp = 100;
      TP.go(A.x + 5, A.z + 5, 0, 0);
    });
    await step(11, 1 / 30);
    const fl = await ev(() => {
      const c = window.__crows[0];
      const v = Math.hypot(c.vx, c.vz) || 1;
      // abeam of where it will be one frame on, a little ahead and above
      const ax = c.x + c.vx / 30,
        az = c.z + c.vz / 30,
        ay = c.y + c.vy / 30;
      const cx = ax + (c.vz / v) * 1.5 + (c.vx / v) * 0.5,
        cz = az - (c.vx / v) * 1.5 + (c.vz / v) * 0.5;
      const heading = (Math.atan2(ax - cx, -(az - cz)) * 180) / Math.PI;
      TP.cam(cx, ay + 0.35, cz, heading, -12);
      return { state: c.state, v: [+c.vx.toFixed(1), +c.vy.toFixed(1), +c.vz.toFixed(1)] };
    });
    const r = await ev(() => TP.shot('g_crow_3', 1));
    log(r.file, JSON.stringify(fl));
    await ev(() => TP.cam(null));
  }
}
