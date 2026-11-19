import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { parseMrt, planTrip, nearestStation, trackPoint, MrtRide } from '../js/mrt.js';

// The MRT (js/mrt.js) on the real network (tiles/singapore/mrt.json, built from OpenStreetMap by tools/city/mrt.mjs)
const net = parseMrt(JSON.parse(fs.readFileSync(new URL('../tiles/singapore/mrt.json', import.meta.url), 'utf8')));
const st = (name) => {
  const s = net.stations.find((x) => x.name === name);
  assert.ok(s, `${name} is a station`);
  return s;
};
const summary = (legs) => legs.map((l) => `${l.track.line.id}:${l.track.stops[l.from].station.name}>${l.track.stops[l.to].station.name}`);

// Ride `legs` to the end in steps of dt; the events in order, and the ride
function ride(legs, dt = 0.1, limit = 3 * 3600) {
  const events = [];
  const r = new MrtRide(net, legs, { onEvent: (kind, d) => events.push({ kind, t: d.ride.time, name: (d.station || d.next || {}).name, v: d.ride.v }) });
  let t = 0, top = 0, maxA = 0, maxJerk = 0, lastA = 0;
  while (!r.done && t < limit) {
    r.update(dt);
    t += dt;
    top = Math.max(top, r.v);
    maxA = Math.max(maxA, Math.abs(r.a));
    // (on the move: the last few cm into the stop settle at once, as a train's brakes do)
    if (r.v > 0.5) maxJerk = Math.max(maxJerk, Math.abs(r.a - lastA) / dt);
    lastA = r.a;
  }
  return { r, events, t, top, maxA, maxJerk };
}

test('the network: the six MRT lines, their stations with codes, both directions of each', () => {
  assert.deepEqual(net.lines.map((l) => l.id), ['NSL', 'EWL', 'NEL', 'CCL', 'DTL', 'TEL']);
  assert.ok(net.stations.length > 130, `${net.stations.length} stations`);
  for (const l of net.lines) {
    const tracks = net.tracks.filter((t) => t.line === l);
    assert.ok(tracks.length >= 2, `${l.id}: both ways`);
    for (const t of tracks) {
      assert.ok(t.stops.length >= 2);
      for (let k = 1; k < t.stops.length; k++) assert.ok(t.stops[k].s > t.stops[k - 1].s, `${l.id} stops in order along it`);
    }
  }
  assert.deepEqual(st('Dhoby Ghaut').codes, ['CC1', 'NE6', 'NS24'], 'an interchange carries each of its lines\' codes');
  assert.deepEqual(net.linesAt(st('Dhoby Ghaut')).map((l) => l.id).sort(), ['CCL', 'NEL', 'NSL']);
  // underground in town, up on the viaduct out of it
  const height = (name, line) => {
    const t = net.tracks.find((tr) => tr.line.id === line && tr.stops.some((s) => s.station.name === name));
    return trackPoint(t, t.stops.find((s) => s.station.name === name).s).y;
  };
  assert.ok(height('Raffles Place', 'EWL') < -10, 'Raffles Place is underground');
  assert.ok(height('Ang Mo Kio', 'NSL') > 6, 'Ang Mo Kio is elevated');
});

test('trips: straight down a line, or changing at an interchange, the right way along each', () => {
  assert.deepEqual(summary(planTrip(net, st('Raffles Place'), st('Jurong East'))), ['EWL:Raffles Place>Jurong East']);
  const b = planTrip(net, st('Bishan'), st('HarbourFront'));
  assert.equal(b.length, 2, summary(b).join(' + '));
  assert.equal(b[0].track.line.id, 'NSL');
  assert.equal(b[1].track.stops[b[1].to].station.name, 'HarbourFront');
  assert.equal(b[0].track.stops[b[0].to].station, b[1].track.stops[b[1].from].station, 'the change is at one station');
  // the airport branch, from Punggol: a couple of changes
  const c = planTrip(net, st('Punggol'), st('Changi Airport'));
  assert.ok(c && c.length >= 2 && c.length <= 4, summary(c).join(' + '));
  assert.equal(planTrip(net, st('Bishan'), st('Bishan')), null, 'nowhere to go');
  assert.equal(nearestStation(net, st('Orchard').x + 30, st('Orchard').z).station.name, 'Orchard');
});

test('a ride: boards, closes its doors, runs at the line\'s speed smoothly, stops at each station, ends at the last', () => {
  const legs = planTrip(net, st('Raffles Place'), st('Outram Park'));
  const { r, events, top, maxA, maxJerk } = ride(legs);
  const kinds = events.map((e) => `${e.kind}:${e.name}`);
  assert.deepEqual(kinds, [
    'board:Raffles Place', 'closing:Raffles Place', 'depart:Tanjong Pagar', 'next:Tanjong Pagar', 'approach:Tanjong Pagar',
    'arrive:Tanjong Pagar', 'closing:Tanjong Pagar', 'depart:Outram Park', 'next:Outram Park', 'approach:Outram Park',
    'arrive:Outram Park', 'end:Outram Park'
  ]);
  assert.ok(r.done);
  assert.ok(top > 15 && top <= net.lines[1].top + 1e-6, `top ${(top * 3.6).toFixed(0)} km/h`);
  assert.ok(maxA < 1.4, `gentle: at most ${maxA.toFixed(2)} m/s²`);
  assert.ok(maxJerk < 2, `no jolts: at most ${maxJerk.toFixed(2)} m/s³`);
  // stopped with the train's middle at the platform's
  for (const e of events.filter((x) => x.kind === 'arrive')) assert.ok(e.v < 0.3, 'stopped');
  const stop = r.track.stops[r.leg.to];
  assert.ok(Math.abs(r.front - r.trainLength / 2 - stop.s) < 0.5, 'the middle of the train at the platform\'s');
});

test('a ride with a change: off one train, walk to the next line\'s platform, on to the end', () => {
  const legs = planTrip(net, st('Bishan'), st('HarbourFront'));
  const { r, events } = ride(legs);
  assert.ok(r.done);
  const change = events.findIndex((e) => e.kind === 'change');
  assert.ok(change > 0, 'a change');
  assert.equal(events[change + 1].kind, 'board', 'then on the next train');
  assert.equal(events[events.length - 1].name, 'HarbourFront');
});

test('skipping ahead and getting off early', () => {
  const legs = planTrip(net, st('Woodlands'), st('Gardens by the Bay'));
  const r = new MrtRide(net, legs, {});
  r.update(20); // (the doors close and it goes)
  assert.equal(r.phase, 'run');
  const at = r.stop;
  r.skip();
  r.update(60);
  assert.ok(r.stop > at || r.phase !== 'run', 'on to the next station');
  r.alightNext();
  for (let i = 0; i < 2000 && !r.done; i++) r.update(0.5);
  assert.ok(r.done, 'off');
  assert.notEqual(r.station.name, 'Gardens by the Bay', 'at a station well before the end');
});
