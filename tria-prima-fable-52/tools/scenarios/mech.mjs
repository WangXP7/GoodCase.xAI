// Every way a potion changes the island, one after another, with the numbers in the log and a frame
// of each in shots/m_*.jpg. --only a,b runs some of: gate, lantern, vine, mere, lid, rock, scar.
//   node tools/play.mjs tools/scenarios/mech.mjs --q high
export default async function ({ ev, step, shot, log, page, args }) {
  await step(20);
  await page.waitForTimeout(2600);
  await ev(() => TP.play());
  await step(20);
  const only = args.only ? args.only.split(',') : null;
  const want = (n) => !only || only.includes(n);

  await ev(() => {
    TP.give({ potions: { ember: 9, verdance: 9, rime: 9, levity: 9, fulminate: 9, saltspire: 9, vitae: 9 } });
    window.H = {
      // stand `dist` from the target on the side of (fx, fz), facing the target
      face(tx, tz, fx, fz, dist, pitch = 0) {
        const dx = fx - tx,
          dz = fz - tz,
          l = Math.hypot(dx, dz) || 1;
        const x = tx + (dx / l) * dist,
          z = tz + (dz / l) * dist;
        TP.go(x, z, (Math.atan2(tx - x, -(tz - z)) * 180) / Math.PI, pitch);
        return { x, z };
      },
      hp() {
        TP.game.state.player.hp = 100;
      },
      p() {
        const p = TP.game.player.pos;
        return { x: +p.x.toFixed(1), y: +p.y.toFixed(2), z: +p.z.toFixed(1), ground: !!TP.game.player.onGround };
      },
    };
  });
  const frame = async (name, settle = 6) => {
    const r = await ev(([n, s]) => TP.shot(n, s), [name, settle]);
    log('  ' + r.file.split(/[\\/]/).pop());
  };

  // ------------------------------------------------------------------------------ the briar gate
  if (want('gate')) {
    log('GATE', JSON.stringify(await ev(() => {
      const g = TP.game, gt = g.ents.gate, L = TP.world.layout;
      if (!gt) return 'no gate';
      H.face(gt.x, gt.z, L.chapel.x, L.chapel.z, 12, 5);
      return { x: +gt.x.toFixed(1), y: +gt.y.toFixed(1), z: +gt.z.toFixed(1), half: gt.half, gone: !!gt.gone, solid: gt.placed ? gt.placed.colliderIds.length : null };
    })));
    await step(60);
    await frame('m_gate_0');
    // walk into it: it must stop the apprentice
    const blocked = await ev(() => {
      const g = TP.game, gt = g.ents.gate;
      g.input.press('KeyW');
      TP.step(150, 1 / 30);
      g.input.release('KeyW');
      const p = g.player.pos;
      return { dist: +Math.hypot(p.x - gt.x, p.z - gt.z).toFixed(2) };
    });
    log('  walked into it, stopped at', JSON.stringify(blocked));
    await ev(() => {
      const g = TP.game, gt = g.ents.gate, L = TP.world.layout;
      H.face(gt.x, gt.z, L.chapel.x, L.chapel.z, 12, 5);
      g.potions.burst('ember', gt.x, gt.y + 0.4, gt.z, 'ground');
    });
    await step(50);
    await frame('m_gate_1');
    let t = 0;
    for (; t < 40; t++) {
      await step(15);
      if (await ev(() => !!TP.game.ents.gate.gone)) break;
    }
    await step(30);
    await frame('m_gate_2');
    const through = await ev(() => {
      const g = TP.game, gt = g.ents.gate;
      g.input.press('KeyW');
      TP.step(260, 1 / 30);
      g.input.release('KeyW');
      const p = g.player.pos;
      const L = TP.world.layout;
      // signed distance along the way through
      const dx = gt.x - L.chapel.x, dz = gt.z - L.chapel.z, l = Math.hypot(dx, dz);
      return { past: +(((p.x - gt.x) * dx + (p.z - gt.z) * dz) / l).toFixed(1), flag: g.state.world.flags.gate, region: g.region };
    });
    log('  burnt after', (t * 15) / 30, 's; walked on:', JSON.stringify(through));
  }

  // ------------------------------------------------------------------------------ a lantern of the dead
  if (want('lantern')) {
    log('LANTERN', JSON.stringify(await ev(() => {
      const g = TP.game, l = g.ents.lanterns.find((q) => q.id === 'saltwood'), gt = g.ents.gate;
      H.hp();
      H.face(l.flame.x, l.flame.z, gt ? gt.x : 0, gt ? gt.z : 0, 9, 14);
      return { id: l.id, lit: l.lit, gloom: g.state.world.gloom };
    })));
    await step(90);
    await frame('m_lantern_0');
    await ev(() => {
      const g = TP.game, l = g.ents.lanterns.find((q) => q.id === 'saltwood');
      g.potions.burst('ember', l.flame.x, l.flame.y, l.flame.z, 'object');
    });
    await step(120);
    await frame('m_lantern_1');
    log('  ', JSON.stringify(await ev(() => {
      const g = TP.game, l = g.ents.lanterns.find((q) => q.id === 'saltwood');
      return { lit: l.lit, known: g.state.known.lanterns, respawn: g.state.world.respawn, gloom: g.state.world.gloom, focus: g.hud.focus };
    })));
  }

  // ------------------------------------------------------------------------------ the briar ladder
  if (want('vine')) {
    log('VINE', JSON.stringify(await ev(() => {
      const g = TP.game, v = g.ents.vine;
      if (!v) return 'no vine';
      H.hp();
      TP.go(v.spot.x + v.nx * 9, v.spot.z + v.nz * 9, (Math.atan2(-v.nx, v.nz) * 180) / Math.PI, 18);
      return { spot: [v.spot.x, v.spot.y, v.spot.z].map((q) => +q.toFixed(1)), top: +v.spot.top.y.toFixed(1), n: [v.nx, v.nz].map((q) => +q.toFixed(2)), grown: !!v.grown };
    })));
    await step(90);
    await frame('m_vine_0');
    await ev(() => {
      const g = TP.game, v = g.ents.vine;
      g.potions.burst('verdance', v.spot.x + v.nx * 0.6, v.spot.y + 0.2, v.spot.z + v.nz * 0.6, 'ground');
    });
    await step(60);
    await frame('m_vine_1');
    let t = 0;
    for (; t < 40; t++) {
      await step(15);
      if (await ev(() => !!TP.game.ents.vine.grown)) break;
    }
    await step(20);
    await frame('m_vine_2');
    log('  grown after', (60 + t * 15) / 30, 's');
    // climb it
    const climb = await ev(() => {
      const g = TP.game, v = g.ents.vine;
      TP.go(v.spot.x + v.nx * 1.6, v.spot.z + v.nz * 1.6, (Math.atan2(-v.nx, v.nz) * 180) / Math.PI, 20);
      TP.step(10, 1 / 30);
      g.input.press('KeyW');
      const ys = [];
      for (let i = 0; i < 14; i++) {
        TP.step(30, 1 / 30);
        ys.push(+g.player.pos.y.toFixed(1));
      }
      g.input.release('KeyW');
      TP.step(20, 1 / 30);
      return { ys, top: +v.spot.top.y.toFixed(1), end: H.p(), climbing: !!g.player.climbing };
    });
    log('  climb', JSON.stringify(climb));
    await frame('m_vine_top');
    // the Prime of Salt
    log('  prime', JSON.stringify(await ev(() => {
      const g = TP.game, pr = g.ents.primes.salt;
      if (!pr) return 'no prime';
      const p = g.player.pos;
      const d = Math.hypot(pr.at.x - p.x, pr.at.z - p.z);
      g.player.heading = Math.atan2(pr.at.x - p.x, -(pr.at.z - p.z));
      g.player.pitch = Math.atan2(pr.at.y - (p.y + 1.62), d);
      TP.step(20, 1 / 30);
      return { at: [pr.at.x, pr.at.y, pr.at.z].map((q) => +q.toFixed(1)), me: H.p(), focus: g.hud.focus };
    })));
    await frame('m_prime_salt');
    await ev(() => {
      const g = TP.game;
      g.input.press('KeyE');
      TP.step(3, 1 / 30);
      g.input.release('KeyE');
      TP.step(30, 1 / 30);
    });
    log('  taken', JSON.stringify(await ev(() => ({ primes: TP.game.state.inv.primes, stage: TP.game.state.quest.stage, gloom: TP.game.state.world.gloom }))));
  }

  // ------------------------------------------------------------------------------ ice on the Mere
  if (want('mere')) {
    log('MERE', JSON.stringify(await ev(() => {
      const g = TP.game, L = TP.world.layout, lm = g.ents.lanterns.find((q) => q.id === 'mere');
      H.hp();
      // walk from the lantern toward the islet until the water is at the feet
      const dx = L.islet.x - lm.flame.x, dz = L.islet.z - lm.flame.z, l = Math.hypot(dx, dz);
      let s = 0;
      for (; s < l; s += 0.5) if (TP.world.T.heightAt(lm.flame.x + (dx / l) * s, lm.flame.z + (dz / l) * s) < -0.3) break;
      const x = lm.flame.x + (dx / l) * (s - 2.5), z = lm.flame.z + (dz / l) * (s - 2.5);
      TP.go(x, z, (Math.atan2(dx, -dz) * 180) / Math.PI, 8);
      return { shore: [x, z].map((q) => +q.toFixed(1)), toIslet: +(l - s).toFixed(1), region: g.region };
    })));
    await step(90);
    await frame('m_mere_0');
    // one thrown (a throw from a pier may well land on the pier), one put on the water for certain
    await ev(() => {
      const g = TP.game;
      g.potions.select('rime');
      g.player.pitch = 0.5;
      g.potions.throw('rime');
    });
    await step(90);
    await ev(() => {
      const g = TP.game, L = TP.world.layout, lm = g.ents.lanterns.find((q) => q.id === 'mere');
      const dx = L.islet.x - lm.flame.x, dz = L.islet.z - lm.flame.z, l = Math.hypot(dx, dz);
      const p = g.player.pos;
      // off the side of the pier, a few steps out
      const x = p.x + (dx / l) * 5 - (dz / l) * 5, z = p.z + (dz / l) * 5 + (dx / l) * 5;
      window._w = { x, z, bed: +TP.world.T.heightAt(x, z).toFixed(2) };
      g.potions.burst('rime', x, 0, z, 'water');
      g.player.heading = Math.atan2(x - p.x, -(z - p.z));
      g.player.pitch = -0.2;
    });
    await step(70);
    log('  put at', JSON.stringify(await ev(() => window._w)));
    await frame('m_mere_1');
    const fl = await ev(() => TP.game.ents.floes.map((f) => ({ x: +f.x.toFixed(1), y: +f.y.toFixed(2), z: +f.z.toFixed(1), lava: f.lava, life: +f.life.toFixed(0) })));
    log('  floes', JSON.stringify(fl));
    if (fl.length) {
      const st = await ev(() => {
        const g = TP.game, f = g.ents.floes[0];
        g.player.teleport(f.x, f.y + 0.6, f.z, g.player.yaw, -0.3);
        TP.step(60, 1 / 30);
        return H.p();
      });
      log('  standing on the first floe', JSON.stringify(st));
      await frame('m_mere_2');
    }
  }

  // ------------------------------------------------------------------------------ the lid of the drowned shrine
  if (want('lid')) {
    log('LID', JSON.stringify(await ev(() => {
      const g = TP.game, l = g.ents.lid, L = TP.world.layout, lm = g.ents.lanterns.find((q) => q.id === 'mere');
      if (!l) return 'no lid';
      H.hp();
      const p = H.face(l.x, l.z, lm.flame.x, lm.flame.z, 7.5, -8);
      g.player.teleport(p.x, l.y + 0.3, p.z, g.player.yaw, -0.2);
      return { lid: [l.x, l.y, l.z].map((q) => +q.toFixed(1)), open: !!l.open, me: H.p() };
    })));
    await step(60);
    await frame('m_lid_0');
    await ev(() => {
      const g = TP.game, l = g.ents.lid;
      g.potions.burst('levity', l.x, l.y + 0.5, l.z, 'object');
    });
    await step(45);
    await frame('m_lid_1');
    await step(120);
    await frame('m_lid_2');
    log('  ', JSON.stringify(await ev(() => {
      const g = TP.game, l = g.ents.lid;
      return { open: !!l.open, k: +l.k.toFixed(2), flag: g.state.world.flags.lid, canTake: g.ents.primeOpen('mercury'), me: H.p() };
    })));
    await ev(() => {
      const g = TP.game;
      if (g.ents.primeOpen('mercury') && !g.state.inv.primes.mercury) g.ents.takePrime('mercury');
      TP.step(30, 1 / 30);
    });
    log('  taken', JSON.stringify(await ev(() => ({ primes: TP.game.state.inv.primes, gloom: TP.game.state.world.gloom }))));
  }

  // ------------------------------------------------------------------------------ the rockfall
  if (want('rock')) {
    log('ROCKFALL', JSON.stringify(await ev(() => {
      const g = TP.game, r = g.ents.rockfall;
      if (!r) return 'no rockfall';
      H.hp();
      const s = r.spot;
      // from the side the road comes from
      const L = TP.world.layout;
      const side = (L.chapel.x - s.x) * s.tx + (L.chapel.z - s.z) * s.tz > 0 ? 1 : -1;
      H.face(s.x, s.z, s.x + s.tx * side, s.z + s.tz * side, 15, 6);
      return { spot: [s.x, s.y, s.z].map((q) => +q.toFixed(1)), side, broken: !!r.broken, me: H.p(), region: g.region };
    })));
    await step(90);
    await frame('m_rock_0');
    await ev(() => {
      const g = TP.game, s = g.ents.rockfall.spot;
      g.potions.burst('fulminate', s.x, s.y + 1.6, s.z, 'object');
      TP.step(5, 1 / 30);
    });
    await frame('m_rock_1', 2);
    await step(40);
    await frame('m_rock_2', 2);
    await step(150);
    await frame('m_rock_3');
    log('  ', JSON.stringify(await ev(() => {
      const g = TP.game, r = g.ents.rockfall;
      return { broken: r.broken, flag: g.state.world.flags.rockfall, rubble: g.ents.rubble.length, solid: r.placed.colliderIds.length, hp: Math.round(g.state.player.hp) };
    })));
  }

  // ------------------------------------------------------------------------------ the Scar
  if (want('scar')) {
    log('SCAR', JSON.stringify(await ev(() => {
      const g = TP.game, L = TP.world.layout, lc = g.ents.lanterns.find((q) => q.id === 'scar');
      H.hp();
      const c = L.primeSulfur;
      // walk from the lantern toward the shrine until the ground drops to the lava
      const dx = c.x - lc.flame.x, dz = c.z - lc.flame.z, l = Math.hypot(dx, dz);
      const h0 = TP.world.T.heightAt(lc.flame.x, lc.flame.z);
      let s = 0, lava = null;
      // the lake lies in a bowl above the lantern: come at it from the shrine outward, to the first dry ground
      const lavaY = g.potions.liquid(c.x + 9, c.z, -100);
      lava = lavaY;
      let out = 12;
      for (; out < l; out += 0.5) if (TP.world.T.heightAt(c.x - (dx / l) * out, c.z - (dz / l) * out) > lavaY + 0.25) break;
      s = l - out - 1.5;
      const x = c.x - (dx / l) * (out + 1.5), z = c.z - (dz / l) * (out + 1.5);
      TP.go(x, z, (Math.atan2(dx, -dz) * 180) / Math.PI, 6);
      return { shore: [x, z].map((q) => +q.toFixed(1)), lava, toShrine: +(l - s).toFixed(1), h0: +h0.toFixed(1), me: H.p() };
    })));
    await step(90);
    await frame('m_scar_0');
    await ev(() => {
      const g = TP.game;
      g.potions.select('rime');
      g.player.pitch = 0.25;
      g.potions.throw('rime');
    });
    await step(80);
    await frame('m_scar_1');
    log('  crust', JSON.stringify(await ev(() => TP.game.ents.floes.filter((f) => f.lava).map((f) => ({ x: +f.x.toFixed(1), y: +f.y.toFixed(2), z: +f.z.toFixed(1) })))));
    const on = await ev(() => {
      const g = TP.game, f = g.ents.floes.find((q) => q.lava);
      if (!f) return null;
      g.player.teleport(f.x, f.y + 0.6, f.z, g.player.yaw, -0.25);
      TP.step(60, 1 / 30);
      return { me: H.p(), hp: Math.round(g.state.player.hp) };
    });
    log('  standing on crust', JSON.stringify(on));
    await ev(() => {
      const g = TP.game;
      g.potions.select('saltspire');
      g.player.pitch = 0.2;
      TP.step(10, 1 / 30);
      g.potions.throw('saltspire');
    });
    await step(120);
    await frame('m_scar_2');
    log('  pillars', JSON.stringify(await ev(() => TP.game.ents.pillars.map((p) => ({ x: +p.x.toFixed(1), base: +p.base.toFixed(2), h: +p.height.toFixed(2), k: +p.k.toFixed(2), col: !!p.col })))));
    // the three braziers
    log('  braziers', JSON.stringify(await ev(() => {
      const g = TP.game, E = g.ents, L = TP.world.layout;
      H.hp();
      const c = L.primeSulfur;
      const b0 = E.braziers[0];
      if (!b0) return 'none';
      g.player.teleport(b0.flame.x + 2.2, b0.flame.y - 1.0, b0.flame.z + 2.2, Math.atan2(-2.2, 2.2), -0.1);
      TP.step(20, 1 / 30);
      const out = [];
      for (const b of E.braziers) {
        g.potions.burst('ember', b.flame.x, b.flame.y, b.flame.z, 'object');
        TP.step(20, 1 / 30);
        H.hp();
        out.push({ id: b.id, lit: b.lit });
      }
      return { out, cage: E.cage ? { open: E.cage.open, k: +E.cage.k.toFixed(2) } : null, me: H.p() };
    })));
    await frame('m_scar_3');
    await step(110);
    await frame('m_scar_4');
    log('  ', JSON.stringify(await ev(() => {
      const g = TP.game, E = g.ents;
      const r = { cage: E.cage ? { open: E.cage.open, k: +E.cage.k.toFixed(2) } : null, canTake: E.primeOpen('sulfur'), flags: g.state.world.flags };
      if (r.canTake && !g.state.inv.primes.sulfur) E.takePrime('sulfur');
      TP.step(30, 1 / 30);
      r.primes = g.state.inv.primes;
      r.stage = g.state.quest.stage;
      return r;
    })));
  }
}
