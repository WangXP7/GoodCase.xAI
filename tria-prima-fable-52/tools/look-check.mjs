// The mouse-look filter against made-up hands and made-up browsers.
//   node tools/look-check.mjs
// It must drop the reports that are the browser moving its hidden cursor (src/game/look.js) and
// must not eat anything a hand can do: flicks of every size and length, at every frame rate.
import { LookFilter } from '../src/game/look.js';

const W = 1920,
  H = 1080;
let bad = 0;
const out = [0, 0];

function run(events, { reset = false, w = W, h = H, hz = 60 } = {}) {
  const f = new LookFilter();
  f.reset(-5000);
  f.settle = 0;
  let t = 0,
    x = 0,
    y = 0,
    late = 0;
  // the hand has been moving for a while: the filter knows how often reports come
  for (let i = 0; i < 60; i++) f.feed(1, 0, (t += 1000 / hz), w, h, out);
  t += 400;
  if (reset) f.reset(t);
  for (const e of events) {
    t += e.dt ?? 1000 / hz;
    f.feed(e.x || 0, e.y || 0, t, w, h, out);
    x += out[0];
    y += out[1];
    if (f.held) late++;
  }
  return { x: Math.round(x), y: Math.round(y), dropped: f.dropped + (f.held ? 1 : 0), late };
}
const rep = (n, e) => Array.from({ length: n }, () => ({ ...e }));
function expect(name, got, want) {
  const ok = got.x === want.x && got.y === want.y && (want.dropped == null || got.dropped === want.dropped);
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}  ->  x ${got.x}, y ${got.y}, dropped ${got.dropped}${ok ? '' : `   (wanted x ${want.x}, y ${want.y}, dropped ${want.dropped})`}`);
}

console.log('the browser moving its cursor:');
expect('looking down, one report thrown up', run([...rep(30, { y: 12 }), { y: -366 }, ...rep(10, { y: 12 })]), { x: 0, y: 480, dropped: 1 });
expect('looking down, one report thrown further down', run([...rep(30, { y: 12 }), { y: 390 }, ...rep(10, { y: 12 })]), { x: 0, y: 480, dropped: 1 });
expect('out and back in two reports', run([...rep(30, { y: 12 }), { y: 390 }, { y: -366 }, ...rep(10, { y: 12 })]), { x: 0, y: 480, dropped: 2 });
expect('turning, thrown sideways', run([...rep(30, { x: 10 }), { x: -662 }, ...rep(10, { x: 10 })]), { x: 400, y: 0, dropped: 1 });
expect('a corner: both axes at once', run([...rep(30, { x: 8, y: 8 }), { x: -664, y: -370 }, ...rep(10, { x: 8, y: 8 })]), { x: 320, y: 320, dropped: 1 });
expect('after the hand rested', run([...rep(5, { y: 6 }), { y: -378, dt: 600 }, ...rep(10, { y: 6 })]), { x: 0, y: 90, dropped: 1 });
expect('and nothing after it', run([...rep(5, { y: 6 }), { y: -378 }]), { x: 0, y: 30, dropped: 1 });
expect('at 144 Hz', run([...rep(60, { y: 5 }), { y: -372 }, ...rep(20, { y: 5 })], { hz: 144 }), { x: 0, y: 400, dropped: 1 });
expect('at 50 Hz', run([...rep(30, { y: 14 }), { y: -364 }, ...rep(10, { y: 14 })], { hz: 50 }), { x: 0, y: 560, dropped: 1 });
expect('in a small window (1280 x 720)', run([...rep(30, { y: 12 }), { y: -252 }, ...rep(10, { y: 12 })], { w: 1280, h: 720 }), { x: 0, y: 480, dropped: 1 });
expect('as the lock engages (a click low on the screen)', run([{ x: 2, y: 1 }, { y: -216 }, ...rep(10, { x: 3, y: 2 })], { reset: true }), { x: 32, y: 21, dropped: 1 });
expect('as the lock engages, first report', run([{ y: -160, dt: 400 }, ...rep(10, { x: 3, y: 2 })], { reset: true }), { x: 30, y: 20, dropped: 1 });

console.log('a hand:');
expect('30 frames a second: a whole flick in one report is kept', run([...rep(10, { y: 4 }), { y: 420 }, ...rep(10, { y: 4 })], { hz: 30 }), { x: 0, y: 500, dropped: 0 });
expect('a gentle start after the lock', run([{ x: 6 }, { x: 20 }, { x: 45 }, { x: 80 }, { x: 90 }, { x: 40 }, { x: 8 }], { reset: true }), { x: 289, y: 0, dropped: 0 });
expect('a frame hitch while turning (90 ms in one report)', run([...rep(20, { x: 100 }), { x: 540, dt: 90 }, ...rep(20, { x: 100 })]), { x: 4540, y: 0, dropped: 0 });
expect('a stop and a start the other way', run([...rep(10, { x: 60 }), ...rep(3, { x: 0 }), ...rep(10, { x: -60 })]), { x: 0, y: 0, dropped: 0 });

// Flicks: the smooth bell of speed a hand makes (minimum jerk), of every size, length and
// direction, cut into frames at every rate and phase.
const sCurve = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * u * (10 - 15 * u + 6 * u * u));
let flicks = 0,
  eaten = 0,
  held = 0,
  worst = null;
for (const hz of [15, 20, 30, 40, 45, 50, 60, 75, 120, 144, 240])
  for (const dist of [60, 150, 300, 600, 1000, 1600, 2500, 4000, 8000])
    for (const ms of [60, 70, 100, 150, 220, 320, 450])
      for (const ang of [0, 90, 45, 200, 270, 315])
        for (const phase of [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]) {
          const dt = 1000 / hz,
            ca = Math.cos((ang * Math.PI) / 180),
            sa = Math.sin((ang * Math.PI) / 180);
          const ev = rep(6, { x: 0, y: 0, dt });
          let px = 0,
            py = 0;
          // integer reports, like a mouse: carry the fraction
          for (let t = -phase * dt; t < ms + dt; t += dt) {
            const d = dist * sCurve((t + dt) / ms);
            const nx = Math.round(d * ca),
              ny = Math.round(d * sa);
            ev.push({ x: nx - px, y: ny - py, dt });
            px = nx;
            py = ny;
          }
          ev.push(...rep(4, { x: 0, y: 0, dt }));
          const r = run(ev, { hz });
          flicks++;
          held += r.late;
          if (r.x !== px || r.y !== py) {
            eaten++;
            if (!worst) worst = { hz, dist, ms, ang, phase, got: [r.x, r.y], want: [px, py] };
          }
        }
console.log(`  ${eaten ? 'FAIL' : 'ok  '}  ${flicks} flicks, 60 to 8000 px in 60 to 450 ms, at 15 to 240 reports a second: ${eaten} lost movement, ${held} reports used one report late`);
if (eaten) {
  bad++;
  console.log('        first:', JSON.stringify(worst));
}

console.log(bad ? `${bad} FAILED` : 'the look filter is sound');
process.exit(bad ? 1 : 0);
