// The apprentice's errand, stage by stage, and the quiet hand on the shoulder: where to go next
// (compass and map) and one line of advice when a thing is met for the first time.
import { QUEST_ORDER, PRIME_HUNTS, PRIME_ITEMS, LANTERNS, REGIONS } from './data.js';
import { count, hasAllPrimes } from './state.js';
import { SCAR } from '../world/heightmap.js';

// How long, in all, a line of advice may be on screen before it is taken as understood.
const TIP_SECONDS = 16;

export class Quests {
  constructor(game) {
    this.game = game;
    this._t = 0;
    this.tip = ''; // the line of advice for this moment
    this._tipId = null;
    this._shown = {}; // tip id -> seconds shown so far
    this._walked = 0;
    this._marks = [];
    this._mapMarks = [];
  }

  reset() {
    this._t = 0;
    this.tip = '';
    this._tipId = null;
    this._shown = {};
    this._walked = 0;
    this.check(true);
  }

  // ------------------------------------------------------------------------------ the errand
  setStage(stage, silent) {
    const g = this.game,
      q = g.state.quest;
    if (q.stage === stage) return;
    q.stage = stage;
    if (silent) return;
    g.bus.emit('quest', { stage });
    g.audio.sfx('quest');
    g.save();
  }

  /** Walk the stages forward as far as the world allows. */
  check(silent) {
    const g = this.game,
      st = g.state,
      q = st.quest,
      L = g.world.layout,
      p = g.player.pos;
    const from = q.stage;
    for (let guard = 0; guard < 10; guard++) {
      const s = q.stage;
      let next = null;
      if (s === 'arrive') {
        if (st.known.lore.letter) next = 'letter';
        else if (L.door && Math.hypot(p.x - L.door.x, p.z - L.door.z) < 9) next = 'letter';
        else if (st.known.potions.ember || st.world.athanor > 0) next = 'letter';
      } else if (s === 'letter') {
        if (st.known.lore.letter || st.known.potions.ember || st.world.athanor > 0) next = 'gather';
      } else if (s === 'gather') {
        q.gathered = Math.min(3, count(st.inv.ingredients, 'cinderbloom'));
        if (q.gathered >= 3 || st.known.potions.ember || st.world.athanor > 0) next = 'brew';
      } else if (s === 'brew') {
        if (st.known.potions.ember || st.world.athanor > 0) next = 'kindle';
      } else if (s === 'kindle') {
        if (st.world.athanor >= 1) next = 'primes';
      } else if (s === 'primes') {
        if (hasAllPrimes(st) || st.inv.stone) next = 'opus';
      } else if (s === 'opus') {
        if (st.inv.stone) next = 'stone';
      } else if (s === 'stone') {
        if (st.world.athanor >= 2) next = 'done';
      }
      if (!next) break;
      q.stage = next;
    }
    if (q.stage !== from && !silent) {
      g.bus.emit('quest', { stage: q.stage });
      g.audio.sfx('quest');
      g.save();
    }
  }
  onPick() {
    this.check();
  }
  onRead() {
    this.check();
  }
  onKindle() {
    this.check();
  }
  onAllPrimes() {
    this.check();
  }

  // ------------------------------------------------------------------------------ where to go
  /** Places the errand points at, as { id, x, y, z, name }. */
  targets() {
    const g = this.game,
      st = g.state,
      L = g.world.layout,
      N = g.world.named;
    const s = st.quest.stage;
    const out = [];
    const cauldron = N.cauldron ? { id: 'cauldron', x: N.cauldron.x, y: N.cauldron.y, z: N.cauldron.z, name: 'The cauldron' } : null;
    const athanor = N.athanor ? { id: 'athanor', x: N.athanor.x, y: N.athanor.y, z: N.athanor.z, name: 'The Athanor' } : null;
    if (s === 'arrive') out.push({ id: 'door', x: L.door.x, y: L.door.y, z: L.door.z, name: 'The chapel' });
    else if (s === 'letter') {
      const w = N.workbench;
      out.push(w ? { id: 'letter', x: w.x, y: w.y, z: w.z, name: 'The letter' } : { id: 'door', x: L.door.x, y: L.door.y, z: L.door.z, name: 'The chapel' });
    } else if (s === 'gather') {
      if (L.pyre) out.push({ id: 'pyre', x: L.pyre.x, y: L.pyre.y, z: L.pyre.z, name: 'The scorched ground' });
    } else if (s === 'brew' || s === 'opus') {
      if (cauldron) out.push(cauldron);
    } else if (s === 'kindle' || s === 'stone') {
      if (athanor) out.push(athanor);
    } else if (s === 'primes') {
      const where = { salt: L.primeSalt, mercury: L.primeMercury, sulfur: L.primeSulfur };
      for (const id of ['salt', 'mercury', 'sulfur']) {
        const w = where[id];
        if (!st.inv.primes[id] && w) out.push({ id: 'prime:' + id, x: w.x, y: w.y, z: w.z, name: PRIME_ITEMS[id].name, region: PRIME_HUNTS[id].region });
      }
    }
    return out;
  }

  _buildMarks() {
    const g = this.game,
      st = g.state,
      L = g.world.layout,
      p = g.player.pos;
    const marks = [],
      map = [];
    const bearing = (x, z) => Math.atan2(x - p.x, -(z - p.z));
    const dist = (x, z) => Math.hypot(x - p.x, z - p.z);
    const targets = this.targets();
    let questAtHome = false;
    for (const t of targets) {
      marks.push({ id: t.id, kind: 'quest', bearing: bearing(t.x, t.z), dist: dist(t.x, t.z) });
      map.push({ id: t.id, kind: 'quest', x: t.x, z: t.z, name: t.name });
      if (Math.hypot(t.x - L.chapel.x, t.z - L.chapel.z) < 40) questAtHome = true;
    }
    for (const l of g.ents.lanterns) {
      const lit = !!l.lit;
      const info = LANTERNS[l.id];
      const seen = lit || st.known.regions[info.region];
      if (lit && dist(l.base.x, l.base.z) > 6) marks.push({ id: 'lantern:' + l.id, kind: 'lantern', bearing: bearing(l.base.x, l.base.z), dist: dist(l.base.x, l.base.z) });
      if (seen) map.push({ id: l.id, kind: 'lantern', x: l.base.x, z: l.base.z, name: info.name, lit });
    }
    if (!questAtHome && st.quest.stage !== 'arrive') marks.push({ id: 'home', kind: 'home', bearing: bearing(L.chapel.x, L.chapel.z), dist: dist(L.chapel.x, L.chapel.z) });
    map.push({ id: 'home', kind: 'home', x: L.chapel.x, z: L.chapel.z, name: REGIONS.vale.name });
    this._marks = marks;
    this._mapMarks = map;
  }
  get marks() {
    return this._marks;
  }
  get mapMarks() {
    return this._mapMarks;
  }

  // ------------------------------------------------------------------------------ advice
  /** The first piece of advice that fits this moment, as [id, text], or null. */
  _advice() {
    const g = this.game,
      st = g.state,
      L = g.world.layout,
      E = g.ents,
      pl = g.player,
      p = pl.pos;
    const near = (o, r) => o && Math.hypot(p.x - o.x, p.z - o.z) < r;
    const has = (id) => count(st.inv.potions, id) > 0;
    const region = g.region;
    const F = st.world.flags;

    if (st.player.hp < 45 && has('vitae')) return ['vitae', 'You are bleeding out. F drinks Aqua Vitae when it is in your hand.'];
    if (pl.swimming && pl.cold > 0.4) return ['cold', 'The water is killing cold. Get out of it.'];
    if (g.shades.closeness > 0.35 && !has('ember') && !has('rime')) return ['shade', 'A Shade. It cannot cross the light of a lit lantern. Run.'];
    if (g.shades.closeness > 0.2) return ['shade2', 'Fire unmakes a Shade. Cold holds it still.'];

    if (this._walked < 14 && st.quest.stage === 'arrive') return ['move', 'W A S D to walk. Shift to run. Space to jump.'];
    if (st.inv.selected && st.stats.thrown === 0 && has(st.inv.selected)) return ['throw', 'Hold the left mouse button to take aim. Let go to throw.'];
    if (st.known.lore.letter && !this._shown.book && st.quest.stage === 'gather') return ['book', 'Tab opens your book: the chart, the satchel, the pages you have read.'];

    for (const l of E.lanterns) {
      if (!l.lit && near(l.base, 13)) return has('ember') ? ['lantern2', 'A lantern of the dead. Throw an Ember up into its cage.'] : ['lantern', 'A lantern of the dead, long cold. Fire would wake it.'];
    }
    if (!F.gate && !(E.gate && E.gate.burning) && near(L.gate, 16)) return ['gate', 'Briars have closed the road. Fire would open it.'];
    if (L.vine && !F.vine && near(L.vine, 10)) return ['vine', 'A sleeping seed at the foot of the wall. Verdance would wake it.'];
    if (L.causeway && !st.inv.primes.mercury) {
      const c = L.causeway;
      const last = c.piers[c.piers.length - 3];
      if (last && near(last, 9) && p.y > 0.2) return ['causeway', 'The causeway is broken. Rime closes water for a while.'];
    }
    if (E.lid && !F.lid && near(E.lid, 7)) return ['lid', 'The lid is too heavy for hands. Levity lifts what is heavy.'];
    if (L.rockfall && !F.rockfall && near(L.rockfall, 17)) return ['rockfall', 'The canyon is plugged with fallen stone. Only thunder would move it.'];
    if (region === 'scar' && !st.inv.primes.sulfur && F.rockfall) {
      const d = Math.hypot(p.x - SCAR.x, p.z - SCAR.z);
      if (d > SCAR.lava - 2 && d < SCAR.lava + 14) return ['lava', 'The fire will not bear you. Rime crusts it; a spire of salt makes a step.'];
      if (E.cage && !F.cage && d < 14) return ['braziers', 'Three braziers stand cold around the cage. Light all three.'];
    }
    if (region && st.world.gloom[region] > 0.5 && !this._shown.gloom) return ['gloom', 'The Gloom lies here. What walks in it comes for the living.'];
    if (st.player.levity <= 0 && st.inv.selected === 'levity' && has('levity') && !this._shown.levity) return ['levity', 'Levity: thrown, it lifts what is heavy. Drunk with F, it lifts you.'];
    return null;
  }

  update(dt) {
    const g = this.game,
      st = g.state;
    this._walked += g.player.speed * dt;
    this._t -= dt;
    if (this._t <= 0) {
      this._t = 0.4;
      if (st.mode === 'play') this.check();
      this._buildMarks();
      let a = st.mode === 'play' && g.settings.hints ? this._advice() : null;
      if (a && (this._shown[a[0]] || 0) > TIP_SECONDS) a = null;
      this._tipId = a ? a[0] : null;
      this.tip = a ? a[1] : '';
    }
    if (this._tipId) this._shown[this._tipId] = (this._shown[this._tipId] || 0) + dt;
  }

  /** For the save: which advice has been given in full. */
  save() {
    const out = {};
    for (const k in this._shown) if (this._shown[k] > TIP_SECONDS) out[k] = 1;
    return out;
  }
  load(tips) {
    this._shown = {};
    for (const k in tips || {}) this._shown[k] = TIP_SECONDS + 1;
  }
}

export { QUEST_ORDER };
