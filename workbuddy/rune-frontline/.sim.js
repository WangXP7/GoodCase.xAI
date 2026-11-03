// 无头模拟：验证一局能打完、时长/碎格数是否合理
const fs = require('fs');
const vm = require('vm');

const ctxMock = new Proxy({}, {
  get(t, k) {
    if (k === 'measureText') return () => ({ width: 10 });
    if (k === 'createLinearGradient') return () => ({ addColorStop() {} });
    if (k === 'canvas') return { width: 750, height: 1334 };
    if (k === 'setTransform') return () => {};
    return () => {};
  },
  set() { return true; }
});

const wrapEl = { clientWidth: 420, clientHeight: 747 };
const canvasEl = {
  width: 750, height: 1334, style: {},
  getContext: () => ctxMock,
  addEventListener() {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 750, height: 1334 }),
};

globalThis.document = {
  getElementById: (id) => id === 'c' ? canvasEl : wrapEl,
  createElement: () => ({ width: 0, height: 0, getContext: () => ctxMock }),
};
globalThis.window = {
  devicePixelRatio: 2, addEventListener() {},
  innerWidth: 420, innerHeight: 747,
};
globalThis.devicePixelRatio = 2;
globalThis.performance = { now: () => Date.now() };
globalThis.requestAnimationFrame = () => 0;

let code = fs.readFileSync('.check.js', 'utf8');
code += '\nglobalThis.__T = { G, update, initGame, chooseHex, CFG, SLOTS, ACTIVE_SLOTS, openHexPick, buyItem };\n';
vm.runInThisContext(code, { filename: 'game.js' });

const T = globalThis.__T;
const STEP = 1 / 60;

function runOnce(verbose) {
  T.initGame();
  T.G.phase = 'battle';
  let steps = 0;
  let hexCount = 0;
  const laneAt = {};
  while (T.G.phase !== 'result' && steps < 130 * 60) {
    if (T.G.phase === 'hex') {
      T.chooseHex(T.G.pick.cards[0]);
      hexCount++;
      continue;
    }
    T.update(STEP);
    steps++;
    if (steps % 180 === 0) { for (const it of T.G.shop.slice()) if (T.G.gold >= it.cost) T.buyItem(it); }
  }
  const g = T.G;
  return {
    t: +g.t.toFixed(1),
    level: g.level,
    hex: g.hexTaken,
    kills: g.kills,
    gold: Math.floor(g.gold),
    result: g.result ? g.result.kind : 'timeout', ult: g.ultCount || 0,
    lane: g.result ? g.result.lane : -1,
    enemyCells: g.lanes.map(l => l.enemyCount),
    allyCells: g.lanes.map(l => l.allyCount),
    cores: g.lanes.map(l => Math.round(l.enemyCore.hp) + '/' + l.enemyCore.max),
    myCores: g.lanes.map(l => Math.round(l.allyCore.hp)),
  };
}

const runs = [];
for (let i = 0; i < 8; i++) runs.push(runOnce());
console.log('run  time  lv hex kills gold  result lane  enemyCells  enemyCores / myCores');
runs.forEach((r, i) => {
  console.log(String(i).padStart(2), String(r.t).padStart(6), String(r.level).padStart(3),
    String(r.hex).padStart(3), String(r.kills).padStart(5), String(r.gold).padStart(5),
    r.result.padEnd(6), String(r.lane).padStart(3), String(r.ult).padStart(3),
    JSON.stringify(r.enemyCells).padEnd(12),
    JSON.stringify(r.cores).padEnd(22),
    JSON.stringify(r.myCores));
});
const times = runs.map(r => r.t);
const wins = runs.filter(r => r.result === 'win').length;
console.log('---');
console.log('avg time', (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1),
  '| win', wins + '/' + runs.length,
  '| avg kills', Math.round(runs.reduce((a, b) => a + b.kills, 0) / runs.length));
