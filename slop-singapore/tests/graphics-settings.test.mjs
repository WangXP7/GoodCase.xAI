import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { TREE_LEVELS, TREE_CHOICES, TREE_KEY, initialTreeDetail, bindTreeDetail, createAutoTreeDetail } from '../js/graphics-settings.js';

const memory = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
};
function button(level) {
  const attrs = {}, classes = new Set(), listeners = [];
  return {
    dataset: { trees: level },
    setAttribute: (k, v) => (attrs[k] = v),
    getAttribute: (k) => attrs[k],
    classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) },
    addEventListener: (t, f) => listeners.push(f),
    click() { listeners.forEach((f) => f()); }
  };
}

test('tree detail starts at the URL\'s choice, else the saved one, else auto', () => {
  assert.deepEqual(TREE_LEVELS, ['off', 'low', 'medium', 'high']);
  assert.deepEqual(TREE_CHOICES, ['auto', 'off', 'low', 'medium', 'high']);
  assert.equal(initialTreeDetail(), 'auto');
  assert.equal(initialTreeDetail({ search: '?trees=auto', storage: memory({ [TREE_KEY]: 'low' }) }), 'auto');
  assert.equal(initialTreeDetail({ storage: memory({ [TREE_KEY]: 'low' }) }), 'low');
  assert.equal(initialTreeDetail({ search: '?trees=high', storage: memory({ [TREE_KEY]: 'low' }) }), 'high');
  assert.equal(initialTreeDetail({ search: '?trees=ultra', storage: memory({ [TREE_KEY]: 'nonsense' }) }), 'auto');
  const broken = { getItem() { throw new Error('denied'); } };
  assert.equal(initialTreeDetail({ storage: broken }), 'auto');
});

test('the tree-detail menu applies, marks and saves the level picked', () => {
  const buttons = TREE_CHOICES.map(button);
  const applied = [];
  const storage = memory();
  const s = bindTreeDetail({ buttons, apply: (l) => applied.push(l), storage, level: 'low' });
  assert.deepEqual(applied, ['low'], 'the starting level applied');
  assert.equal(storage.m.size, 0, 'and not saved (only a pick is)');
  const checked = () => buttons.filter((b) => b.getAttribute('aria-checked') === 'true').map((b) => b.dataset.trees);
  assert.deepEqual(checked(), ['low']);
  assert.ok(buttons[2].classList.contains('active'));
  buttons[4].click();
  assert.equal(s.get(), 'high');
  assert.deepEqual(applied, ['low', 'high']);
  assert.deepEqual(checked(), ['high']);
  assert.ok(!buttons[2].classList.contains('active'));
  assert.equal(storage.getItem(TREE_KEY), 'high');
  assert.equal(s.set('ultra'), false);
  assert.equal(s.get(), 'high');
  // a storage that refuses: still applied
  const t = bindTreeDetail({ buttons: TREE_CHOICES.map(button), apply: () => {}, storage: { setItem() { throw new Error('full'); } } });
  assert.equal(t.set('off'), true);
});

test('the menu: a button opening it, and a choice for every level', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="btn-graphics"[^>]*popovertarget="graphics-popover"/);
  const pop = html.slice(html.indexOf('id="graphics-popover"'), html.indexOf('<!-- Navigation'));
  for (const level of TREE_CHOICES) assert.match(pop, new RegExp(`data-trees="${level}"[^>]*role="radio"`));
  assert.match(pop, /role="radiogroup"/);
});

// Frames at `fps` for `seconds`
const run = (auto, fps, seconds) => { for (let k = 0; k < Math.round(fps * seconds); k++) auto.update(1 / fps); };

test('auto tree detail: down a level when the frame rate stays short, up after a long run at the display\'s', () => {
  const changes = [];
  const auto = createAutoTreeDetail({ start: 'medium', apply: (l, why) => changes.push([l, why]) });
  run(auto, 60, 10); // (learns a 60 Hz display; not yet on)
  assert.deepEqual(changes, []);
  auto.enable();
  assert.deepEqual(changes, [['medium', 'auto']], 'on: the level applied');
  assert.ok(Math.abs(auto.state().goal - 54) < 1, '90% of 60 fps');
  run(auto, 52, 20); // short of the goal but within 8% of it: left alone
  assert.equal(auto.level, 'medium');
  run(auto, 35, 3.5); // slow, past the settling time
  assert.equal(auto.level, 'low');
  assert.deepEqual(changes.at(-1), ['low', 'slow']);
  run(auto, 35, 1.5); // just after a change: settling, not counted
  assert.equal(auto.level, 'low');
  run(auto, 35, 4);
  assert.equal(auto.level, 'off', 'and again while still slow');
  run(auto, 25, 10);
  assert.equal(auto.level, 'off', 'none lower');
  // fast again: low and medium were both too slow, so each is barred for 90 s from when it failed
  const bars = auto.state().barredUntil;
  assert.ok(bars.low > bars.medium);
  const until = (t) => { while (auto.state().clock < t) run(auto, 60, 1); };
  until(bars.low - 1);
  assert.equal(auto.level, 'off', 'low barred');
  until(bars.low + 1.5);
  assert.equal(auto.level, 'low', 'tried again as soon as its bar is over (it had been fast all along)');
  until(bars.low + 10);
  assert.equal(auto.level, 'low', 'a step at a time');
  until(bars.low + 20);
  assert.equal(auto.level, 'medium', '(medium\'s bar ended first)');
  // fails again: barred twice as long
  run(auto, 30, 4);
  assert.equal(auto.level, 'low');
  const { barredUntil, clock } = auto.state();
  assert.ok(barredUntil.medium - clock > 170 && barredUntil.medium - clock <= 180, `${barredUntil.medium - clock} s`);
});

test('auto tree detail: a fast display isn\'t held to its rate, stalls and other load are ignored, off when picked', () => {
  const changes = [];
  let trees = 0;
  const auto = createAutoTreeDetail({ start: 'medium', apply: (l) => changes.push(l), load: () => trees });
  auto.enable();
  run(auto, 144, 6);
  assert.ok(Math.abs(auto.state().goal - 54) < 1, 'a 144 Hz display: still 54 fps');
  run(auto, 80, 20);
  assert.equal(auto.level, 'high', '80 fps on 144 Hz is plenty');
  // slow, but hardly any trees drawn (the city centre): not the trees' doing
  run(auto, 30, 10);
  assert.equal(auto.level, 'high');
  trees = 2e6;
  run(auto, 30, 4);
  assert.equal(auto.level, 'medium');
  // a stall (a hidden tab, a long load) doesn't count as slow, nor does a single hitch
  for (let k = 0; k < 20; k++) auto.update(2);
  run(auto, 60, 2);
  for (let k = 0; k < 3; k++) { auto.update(0.4); run(auto, 60, 3); }
  run(auto, 60, 2);
  assert.equal(auto.level, 'medium');
  // picked by hand: auto stops
  auto.disable();
  const n = changes.length;
  run(auto, 20, 30);
  assert.equal(changes.length, n);
  assert.equal(auto.level, 'medium');
});
