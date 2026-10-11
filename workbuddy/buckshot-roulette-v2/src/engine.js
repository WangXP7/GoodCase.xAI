// Rules and information model are independent of rendering and wall-clock time.
export const ITEMS = Object.freeze({
  glass: { name: '放大镜', en: 'MAGNIFYING GLASS', description: '查看枪膛内当前一发子弹。', icon: 'glass' },
  beer: { name: '啤酒', en: 'BEER', description: '退掉当前一发子弹，保留你的回合。', icon: 'beer' },
  cuffs: { name: '手铐', en: 'HANDCUFFS', description: '让对方跳过下一次行动。同一回合不能连续束缚。', icon: 'cuffs' },
  saw: { name: '手锯', en: 'HAND SAW', description: '锯短枪管。下一次射击伤害变为 2。', icon: 'saw' },
  cigarettes: { name: '香烟', en: 'CIGARETTES', description: '恢复 1 格电荷，不超过上限。断线后无效。', icon: 'cigarettes' },
  phone: { name: '一次性手机', en: 'BURNER PHONE', description: '获知随机一发后续子弹的位置和类型。', icon: 'phone' },
  inverter: { name: '逆转器', en: 'INVERTER', description: '将当前实弹变为空包弹，或将空包弹变为实弹。', icon: 'inverter' },
  adrenaline: { name: '肾上腺素', en: 'ADRENALINE', description: '偷取对方一件道具并立即使用，不能偷肾上腺素。', icon: 'adrenaline' },
  medicine: { name: '过期药物', en: 'EXPIRED MEDICINE', description: '50% 概率恢复 2 格电荷，否则失去 1 格。', icon: 'medicine' },
});
export const BASIC_ITEMS = ['glass', 'beer', 'cuffs', 'saw', 'cigarettes'];
export const ALL_ITEMS = Object.keys(ITEMS);
export const other = who => who === 'player' ? 'dealer' : 'player';
export const shellName = live => live ? '实弹' : '空包弹';

export function permutations(live, blank) {
  if (!live) return [Array(blank).fill(false)];
  if (!blank) return [Array(live).fill(true)];
  return [...permutations(live - 1, blank).map(s => [true, ...s]), ...permutations(live, blank - 1).map(s => [false, ...s])];
}

export class Roulette {
  constructor(seed = Math.floor(Math.random() * 0xffffffff)) {
    this.seed = seed >>> 0;
    this.state = null;
  }

  random() {
    this.seed = (this.seed + 0x6D2B79F5) >>> 0;
    let t = this.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  integer(a, b) { return a + Math.floor(this.random() * (b - a + 1)); }
  pick(a) { return a[this.integer(0, a.length - 1)]; }

  start(mode = 'story', name = 'YOU') {
    if (!['story', 'endless', 'versus'].includes(mode)) throw new Error('未知模式');
    this.state = {
      version: 1, mode, name: String(name || 'YOU').trim().slice(0, 12) || 'YOU',
      round: 1, cycle: 1, cash: 0, phase: 'loading', turn: 'player',
      player: { hp: 2, max: 2, items: [], cuffed: false, immune: false, cut: false },
      dealer: { hp: 2, max: 2, items: [], cuffed: false, immune: false, cut: false },
      shells: [], beliefs: { player: [], dealer: [] }, load: { live: 0, blank: 0, number: 0 },
      history: [], saw: false, winner: null, stats: { shots: 0, live: 0, items: 0, deaths: 0, rounds: 0 },
    };
    return this.beginRound();
  }

  beginRound(retry = false) {
    const s = this.state;
    const max = ['story', 'versus'].includes(s.mode) ? [2, 4, 6][s.round - 1] : this.integer(2, 4);
    for (const who of ['player', 'dealer']) {
      s[who] = { hp: max, max, items: [], cuffed: false, immune: false, cut: false };
    }
    s.load.number = 0;
    s.winner = null;
    s.saw = false;
    const events = [{ type: retry ? 'revive' : 'round', round: s.round, max, cycle: s.cycle }];
    return [...events, ...this.reload()];
  }

  reload() {
    const s = this.state;
    let total, live;
    if (['story', 'versus'].includes(s.mode) && s.load.number === 0 && s.round < 3) {
      total = s.round === 1 ? 3 : 2;
      live = 1;
    } else {
      total = this.integer(2, 8);
      // Balanced shell distributions, with either extra colour when the count is odd.
      live = Math.floor(total / 2) + (total % 2 ? this.integer(0, 1) : 0);
    }
    const blank = total - live;
    const possibilities = permutations(live, blank);
    s.shells = [...this.pick(possibilities)];
    s.beliefs = { player: structuredClone(possibilities), dealer: structuredClone(possibilities) };
    s.load = { live, blank, number: s.load.number + 1 };
    s.history = [];
    s.saw = false;
    s.turn = 'player';
    s.phase = 'loading';
    for (const who of ['player', 'dealer']) { s[who].cuffed = false; s[who].immune = false; }
    const count = ['story', 'versus'].includes(s.mode) ? [0, 2, 4][s.round - 1] : this.integer(2, 5);
    const pool = s.mode === 'endless' ? ALL_ITEMS : BASIC_ITEMS;
    const dealt = { player: [], dealer: [] };
    for (const who of ['player', 'dealer']) {
      for (let i = 0; i < count && s[who].items.length < 8; i++) {
        const choices = pool.filter(id => id !== 'cigarettes' || s[who].items.filter(x => x === id).length < 2);
        const id = this.pick(choices);
        s[who].items.push(id);
        dealt[who].push(id);
      }
    }
    return [{ type: 'load', live, blank, dealt, count }];
  }

  acknowledgeLoad() {
    if (this.state.phase !== 'loading') throw new Error('现在无需装弹');
    this.state.phase = 'turn';
    return [{ type: 'turn', who: this.state.turn }];
  }

  checkTurn(who) {
    if (this.state.phase !== 'turn' || this.state.turn !== who) throw new Error('还没有轮到你');
  }

  view(who) {
    const s = this.state;
    const seqs = s.beliefs[who];
    const count = s.shells.length;
    const probability = count && seqs.length ? seqs.filter(x => x[0]).length / seqs.length : null;
    const liveCounts = seqs.map(seq => seq.filter(Boolean).length);
    return {
      mode: s.mode, round: s.round, cycle: s.cycle, turn: s.turn, phase: s.phase, cash: s.cash,
      name: s.name, player: structuredClone(s.player), dealer: structuredClone(s.dealer),
      load: { ...s.load }, history: structuredClone(s.history), saw: s.saw,
      remaining: count, probability,
      minLive: liveCounts.length ? Math.min(...liveCounts) : 0,
      maxLive: liveCounts.length ? Math.max(...liveCounts) : 0,
      knowledge: Array.from({ length: count }, (_, index) => {
        if (!seqs.length) return null;
        const live = seqs.filter(seq => seq[index]).length;
        return live === seqs.length ? true : live === 0 ? false : null;
      }),
    };
  }

  canUse(who, id) {
    const s = this.state, p = s[who], foe = s[other(who)];
    if (s.phase !== 'turn' || s.turn !== who) return '等待你的回合';
    if (!s.shells.length) return '等待重新装弹';
    if (id === 'saw' && s.saw) return '枪管已经锯短';
    if (id === 'cuffs' && (foe.cuffed || foe.immune)) return '对方本回合已被束缚过';
    if (id === 'adrenaline' && !foe.items.some(x => x !== 'adrenaline' && !this.canUse(who, x))) return '对方没有可立即使用的道具';
    return '';
  }

  observe(who, index, live) {
    this.state.beliefs[who] = this.state.beliefs[who].filter(seq => seq[index] === live);
  }

  eject(kind) {
    const s = this.state, live = s.shells.shift();
    for (const who of ['player', 'dealer']) {
      s.beliefs[who] = s.beliefs[who].filter(seq => seq[0] === live).map(seq => seq.slice(1));
    }
    s.history.push({ live, kind });
    return live;
  }

  use(who, index, stolenIndex = null) {
    this.checkTurn(who);
    const s = this.state, inv = s[who].items, foe = other(who), id = inv[index];
    if (!id || !ITEMS[id]) throw new Error('道具不存在');
    const reason = this.canUse(who, id);
    if (reason) throw new Error(reason);
    let useId = id;
    const events = [];
    if (id === 'adrenaline') {
      useId = s[foe].items[stolenIndex];
      if (stolenIndex === null || !useId || useId === 'adrenaline') throw new Error('请选择对方的其他道具');
      const reason2 = this.canUse(who, useId);
      if (reason2) throw new Error(reason2);
      s[foe].items.splice(stolenIndex, 1);
      events.push({ type: 'steal', who, id: useId });
    }
    inv.splice(index, 1);
    if (who === 'player') s.stats.items++;
    const event = { type: 'item', who, id: useId };
    switch (useId) {
      case 'glass':
        event.live = s.shells[0];
        this.observe(who, 0, event.live);
        break;
      case 'beer':
        event.live = this.eject('beer');
        break;
      case 'cuffs': s[foe].cuffed = true; break;
      case 'saw': s.saw = true; break;
      case 'cigarettes':
        event.heal = s[who].cut ? 0 : Math.min(1, s[who].max - s[who].hp);
        s[who].hp += event.heal;
        break;
      case 'phone':
        if (s.shells.length < 2) event.index = null;
        else {
          event.index = this.integer(1, s.shells.length - 1);
          event.live = s.shells[event.index];
          this.observe(who, event.index, event.live);
        }
        break;
      case 'inverter':
        s.shells[0] = !s.shells[0];
        // Flip every candidate without leaking the hidden shell through counts.
        for (const actor of ['player', 'dealer']) s.beliefs[actor].forEach(seq => { seq[0] = !seq[0]; });
        break;
      case 'medicine': {
        const good = this.random() < 0.5;
        event.heal = good ? (s[who].cut ? 0 : Math.min(2, s[who].max - s[who].hp)) : -1;
        s[who].hp = Math.max(0, s[who].hp + event.heal);
        break;
      }
    }
    events.push(event);
    this.checkCut(events);
    if (!this.checkEnd(events) && !s.shells.length) events.push(...this.reload());
    return events;
  }

  shoot(who, target) {
    this.checkTurn(who);
    if (!['player', 'dealer'].includes(target)) throw new Error('目标不存在');
    const s = this.state;
    if (!s.shells.length) throw new Error('枪膛为空');
    const live = this.eject('shot');
    const damage = live ? (s[target].cut ? s[target].hp : s.saw ? 2 : 1) : 0;
    const saw = s.saw;
    s.saw = false;
    s[target].hp = Math.max(0, s[target].hp - damage);
    s.stats.shots++;
    if (live) s.stats.live++;
    const events = [{ type: 'shot', who, target, live, damage, saw }];
    this.checkCut(events);
    if (this.checkEnd(events)) return events;
    if (!s.shells.length) return [...events, ...this.reload()];
    if (target === who && !live) events.push({ type: 'retain', who });
    else {
      const next = other(who);
      if (s[next].cuffed) {
        s[next].cuffed = false;
        s[next].immune = true;
        events.push({ type: 'skip', who: next });
      } else {
        s.turn = next;
        // Immunity lasts until the cuffed participant has actually acted again.
        s[who].immune = false;
        events.push({ type: 'turn', who: next });
      }
    }
    return events;
  }

  checkCut(events) {
    const s = this.state;
    if (!['story', 'versus'].includes(s.mode) || s.round !== 3) return;
    for (const who of ['player', 'dealer']) {
      if (s[who].hp > 0 && s[who].hp <= 2 && !s[who].cut) {
        s[who].cut = true;
        events.push({ type: 'cut', who });
      }
    }
  }

  checkEnd(events) {
    const s = this.state;
    const loser = s.player.hp <= 0 ? 'player' : s.dealer.hp <= 0 ? 'dealer' : null;
    if (!loser) return false;
    s.winner = other(loser);
    if (s.mode === 'versus') {
      s.stats.rounds++;
      s.phase = s.round < 3 ? 'roundOver' : 'victory';
    } else if (loser === 'player') {
      s.stats.deaths++;
      s.phase = s.mode === 'story' && s.round < 3 ? 'revive' : 'dead';
    } else {
      s.stats.rounds++;
      if (s.round < 3) s.phase = 'roundOver';
      else {
        s.cash = s.mode === 'endless' ? (s.cash || 35000) : Math.max(10000, 70000 - s.stats.shots * 120 - s.stats.deaths * 2500);
        s.phase = s.mode === 'endless' ? 'offer' : 'victory';
      }
    }
    events.push({ type: 'end', phase: s.phase, winner: s.winner, cash: s.cash });
    return true;
  }

  advance() {
    const s = this.state;
    if (s.phase === 'revive') return this.beginRound(true);
    if (s.phase !== 'roundOver') throw new Error('这一轮尚未结束');
    s.round++;
    return this.beginRound();
  }
  double() {
    const s = this.state;
    if (s.phase !== 'offer') throw new Error('现在无法加倍');
    s.cash *= 2; s.round = 1; s.cycle++;
    return this.beginRound();
  }
  cashOut() {
    if (this.state.phase !== 'offer') throw new Error('现在无法取款');
    this.state.phase = 'victory';
    return [{ type: 'end', phase: 'victory', cash: this.state.cash, winner: 'player' }];
  }

  serialize() { return JSON.stringify({ version: 1, seed: this.seed, state: this.state }); }
  static restore(json) {
    const data = JSON.parse(json), s = data.state;
    if (data.version !== 1 || !s || s.version !== 1 || !['story', 'endless', 'versus'].includes(s.mode)) throw new Error('存档版本不匹配');
    if (!['loading','turn','roundOver','revive','offer','victory','dead'].includes(s.phase)) throw new Error('存档状态无效');
    if (!Number.isInteger(s.round) || s.round < 1 || s.round > 3 || !['player','dealer'].includes(s.turn)) throw new Error('存档轮次无效');
    if (!Array.isArray(s.shells) || s.shells.length > 8 || s.shells.some(x => typeof x !== 'boolean')) throw new Error('存档子弹无效');
    for (const who of ['player', 'dealer']) {
      const p = s[who];
      if (!p || !Number.isInteger(p.hp) || !Number.isInteger(p.max) || p.hp < 0 || p.hp > p.max || p.max < 2 || p.max > 6) throw new Error('存档电荷无效');
      if (!Array.isArray(p.items) || p.items.length > 8 || p.items.some(id => !ITEMS[id])) throw new Error('存档道具无效');
      const beliefs = s.beliefs?.[who];
      if (!Array.isArray(beliefs) || !beliefs.length || beliefs.length > 256 || beliefs.some(seq => !Array.isArray(seq) || seq.length !== s.shells.length || seq.some(x => typeof x !== 'boolean'))) throw new Error('存档信息无效');
      if (!beliefs.some(seq => seq.every((value, i) => value === s.shells[i]))) throw new Error('存档信息不一致');
    }
    const result = new Roulette(data.seed);
    result.state = s;
    return result;
  }
}

// Deliberately consumes ONLY the acting participant's information view.
// No branch in this function can inspect the actual chamber or the player's private knowledge.
export function chooseAction(view, who = 'dealer', random = Math.random) {
  const me = view[who], foe = view[other(who)], p = view.probability ?? 0.5;
  const available = (id) => {
    if (id === 'cuffs') return !foe.cuffed && !foe.immune;
    if (id === 'saw') return !view.saw;
    return true;
  };
  const priority = id => {
    if (!available(id)) return -1;
    switch (id) {
      case 'cigarettes': return !me.cut && me.hp < me.max ? 100 : -1;
      case 'glass': return p > 0 && p < 1 ? 90 : -1;
      case 'phone': return view.remaining > 2 && view.knowledge.slice(1).some(x => x === null) ? 65 : -1;
      case 'cuffs': return view.remaining > 1 && p >= 0.5 ? 75 : -1;
      case 'saw': return p >= 0.65 ? 70 : -1;
      case 'inverter': return p === 0 ? 85 : p < 0.4 ? 50 : -1;
      case 'beer': return p > 0 && p < 0.5 ? 45 : -1;
      case 'medicine': return !me.cut && me.hp <= me.max - 2 ? (me.hp === 1 ? 20 : 80) : -1;
      default: return -1;
    }
  };
  let best = { score: 0 };
  me.items.forEach((id, index) => {
    if (id === 'adrenaline') {
      foe.items.forEach((stolen, stolenIndex) => {
        const score = stolen === 'adrenaline' ? -1 : priority(stolen) + 1;
        if (score > best.score) best = { score, type: 'item', index, stolenIndex };
      });
    } else {
      const score = priority(id);
      if (score > best.score) best = { score, type: 'item', index };
    }
  });
  if (best.score > 0) return { type: 'item', index: best.index, stolenIndex: best.stolenIndex ?? null };
  const target = p === 0 ? who : p === 1 || p > 0.5 || view.saw ? other(who) : p < 0.5 ? who : random() < 0.5 ? who : other(who);
  return { type: 'shot', target };
}
