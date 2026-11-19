import * as THREE from 'three/webgpu';
import { parseMrt, planTrip, nearestStation, trackPoint, MrtRide } from './mrt.js';
import { MrtTrain, MrtTunnel, MrtStation, buildViaducts, FLOOR, HALF_W, DOORS } from './mrt-scene.js';
import { MrtAudio } from './mrt-audio.js';
import { mrtDaylight } from './mrt-car.js';

// js/mrt-system.js
// Riding the MRT (js/mrt.js): from the station nearest you to the one nearest where you want to go, changing lines on
// the way where it must, as a passenger. While you ride, the train is the view (standing by a door, seated by a
// window, at the front, or outside following it; drag to look round), its sounds and announcements are what you hear
// (js/mrt-audio.js), and a panel shows the line, the next station, the stops to come and the minutes left, with the
// controls to fast-forward, skip to the next station or get off at it. At the end you step out of the station's exit.
// main.js calls update(dt) after the camera's own update each frame, and leaves the player's controllers be while
// `riding`.

const VIEWS = [
  { id: 'cabin', label: 'Standing' },
  { id: 'window', label: 'Window seat' },
  { id: 'front', label: 'Front window' },
  { id: 'outside', label: 'Outside' }
];
const SPEEDS = [1, 4, 16];

class MrtSystem {
  // `onUnderground(on)`: the camera has gone below the ground (or come back up) on a ride, for what the city doesn't
  // draw from under it
  constructor({ scene, audioSystem, cameraSystem, onEnd = () => {}, onToast = () => {}, onUnderground = () => {} }) {
    this.onUnderground = onUnderground;
    this.below = false;
    // everything of the MRT's in the scene, under one group
    this.root = new THREE.Group();
    this.root.name = 'MRT';
    scene.add(this.root);
    this.scene = this.root;
    this.audioSystem = audioSystem;
    this.cameraSystem = cameraSystem;
    this.onEnd = onEnd;
    this.onToast = onToast;
    this.net = null;
    this.ride = null;
    this.train = null;
    this.tunnel = null;
    this.stations = new Map(); // stop -> MrtStation
    this.view = 0;
    this.speed = 0;
    this.doors = 0;
    this.sound = new MrtAudio(audioSystem);
    this._p = {};
    this._q = {};
    this._v = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._left = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this.hud = null;
    this.onKey = (e) => this.key(e);
  }

  get riding() { return !!this.ride; }

  /** Load the network (tiles/<city>/mrt.json) and stand its viaducts across the island */
  async load(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    this.net = parseMrt(await res.json());
    this.viaducts = buildViaducts(this.scene, this.net);
    this.root.updateMatrixWorld(true);
    console.info(`[mrt] ${this.net.lines.length} lines, ${this.net.stations.length} stations, ${this.viaducts.decks} viaduct spans on ${this.viaducts.piers} piers`);
    return this.net;
  }

  nearest(x, z) { return this.net ? nearestStation(this.net, x, z) : null; }

  /** Ride from the station nearest (x0, z0) to the one nearest (x1, z1); false (and why, as a toast) if it can't */
  rideBetween(x0, z0, x1, z1, name) {
    if (!this.net) { this.onToast('The MRT is still loading'); return false; }
    const a = this.nearest(x0, z0);
    const b = this.nearest(x1, z1);
    if (!a || !b) return false;
    if (a.station === b.station) {
      this.onToast(`${a.station.name} is the nearest station to both: walk it`);
      return false;
    }
    return this.start(a.station, b.station, name);
  }

  start(from, to, name = null) {
    const legs = planTrip(this.net, from, to);
    if (!legs) { this.onToast(`No train from ${from.name} to ${to.name}`); return false; }
    if (this.ride) this.end(false);
    this.ride = new MrtRide(this.net, legs, { onEvent: (kind, d) => this.event(kind, d) });
    this.goal = name;
    this.speed = 0;
    this.cameraSystem.orbitYawOffset = 0;
    this.cameraSystem.orbitPitchOffset = 0;
    this.buildTrain();
    this.tunnel ??= new MrtTunnel(this.scene);
    this.showHud();
    window.addEventListener('keydown', this.onKey, true);
    document.body.classList.add('mrt-riding');
    const changes = legs.length - 1;
    this.onToast(`${from.name} to ${to.name}: ${legs.map((l) => l.track.line.code).join(' > ')}${changes ? `, ${changes} change${changes > 1 ? 's' : ''}` : ''}`);
    this.update(0);
    return true;
  }

  buildTrain() {
    this.train?.dispose();
    this.train = new MrtTrain(this.scene, this.ride.line);
    this.doors = 0;
    for (const st of this.stations.values()) st.dispose();
    this.stations.clear();
  }

  // ------------------------------------------------------------------------------------------------- the ride's events
  event(kind, d) {
    const r = d.ride;
    const line = r.line;
    const s = this.sound;
    const lineName = (l) => l.name.replace(/-/g, ' ');
    if (kind === 'board') {
      if (this.train && this.train.line !== line) this.buildTrain();
      s.opening();
      s.say(d.change ? `This train goes to ${r.track.towards}.` : `This train goes to ${r.track.towards}. Please move in, and stand clear of the doors.`, { delay: 1.2, chime: false });
    } else if (kind === 'closing') {
      s.closing(3.2);
      if (line.driverless) s.say('Doors closing.', { chime: false });
    } else if (kind === 'next') {
      const transfer = d.lines?.length ? ` Transfer to the ${d.lines.map(lineName).join(' and the ')}.` : '';
      s.say(`The next station is ${d.next.name}.${transfer}${d.last && r.legIndex === r.legs.length - 1 ? ' This is your stop.' : ''}`);
    } else if (kind === 'approach') {
      const final = d.last && r.legIndex === r.legs.length - 1;
      s.say(final ? `Arriving at ${d.next.name}. Please mind the platform gap.` : d.last ? `Arriving at ${d.next.name}. Change here for the ${lineName(r.legs[r.legIndex + 1].track.line)}.` : `Arriving at ${d.next.name}.`);
    } else if (kind === 'arrive') {
      s.opening();
      if (d.final) this.onToast(`${d.station.name}: the end of your ride. Doors opening…`);
    } else if (kind === 'change') {
      this.onToast(`Change at ${d.station.name} for the ${d.to.line.name} towards ${d.to.towards}`);
    } else if (kind === 'end') {
      // (off the train, and out of the station after the doors have opened)
      this.endTimer = 2.5;
    }
  }

  // --------------------------------------------------------------------------------------------------------- per frame
  /** Call after the camera's own update: runs the ride, places the train, and points the camera from it */
  update(dt) {
    const r = this.ride;
    if (!r) return;
    if (r.done) {
      this.endTimer -= dt;
      if (this.endTimer <= 0) return this.end(true);
    } else {
      r.update(dt * SPEEDS[this.speed]);
    }
    const t = r.track;
    this.train.place(t, r.front);
    // doors: open at a station (but for the closing chime's last part), shut on the move
    const open = (r.phase === 'doors' || r.phase === 'change' || r.done) ? 1 : r.phase === 'closing' ? Math.max(0, Math.min(1, (r.timer - 0.6) / 1.6)) : 0;
    this.doors += Math.max(-dt * 1.4, Math.min(dt * 1.1, open - this.doors));
    this.train.setDoors(this.doors);
    // the stations near: the one it's at and the next
    const near = new Set();
    for (let k = Math.max(0, r.stop - 1); k <= Math.min(t.stops.length - 1, r.stop + 1); k++) {
      const st = t.stops[k];
      if (Math.abs(st.s - (r.front - r.trainLength / 2)) < 900) near.add(st);
    }
    for (const [st, mod] of this.stations) if (!near.has(st)) { mod.dispose(); this.stations.delete(st); }
    for (const st of near) if (!this.stations.has(st)) this.stations.set(st, new MrtStation(this.scene, this.net, t, st));
    // the tunnel round it (none through an underground station's hall)
    const gaps = [...this.stations.values()].filter((m) => m.underground).map((m) => [m.s0 + 3, m.s1 - 3]);
    this.tunnel.update(t, r.front - r.trainLength / 2, gaps);
    this.root.updateMatrixWorld(true);
    this.place(dt);
    const below = this.cameraSystem.camera.position.y < -1.5;
    // (the cabin's daylight eases in and out at the portals)
    mrtDaylight.value += ((below ? 0 : 1) - mrtDaylight.value) * Math.min(1, dt * 1.5);
    if (below !== this.below) { this.below = below; this.onUnderground(below); }
    // the sounds
    const p = trackPoint(t, r.front - r.trainLength / 2, this._p);
    const q = trackPoint(t, r.front - r.trainLength / 2 + 20, this._q);
    const turn = Math.atan2(q.dx * p.dz - q.dz * p.dx, q.dx * p.dx + q.dz * p.dz);
    // the handles swing with the train (its curve's pull to its left, +x, when turning left)
    this.train.update(dt * SPEEDS[this.speed] > 0.2 ? 0.05 : dt, r.v > 0.01 ? r.a : 0, r.v * r.v * (turn / 20));
    this.train.setRoute(this.net, t, r.stop);
    this.sound.update({
      v: r.v, a: r.a, curve: Math.abs(turn) / 20, underground: p.y < -3, inside: VIEWS[this.view].id !== 'outside',
      doors: this.doors, top: r.line.top
    });
    this.updateHud();
  }

  // The camera, from the car the view is in
  place() {
    const r = this.ride;
    const cam = this.cameraSystem.camera;
    const view = VIEWS[this.view].id;
    const L = r.line.carLength;
    const car = view === 'front' ? this.train.cars[0] : this.train.cars[Math.min(this.train.cars.length - 1, 1)];
    car.updateMatrixWorld();
    const m = car.matrixWorld;
    const fwd = this._fwd.set(0, 0, 1).transformDirection(m);
    const left = this._left.set(1, 0, 0).transformDirection(m);
    const up = this._up.set(0, 1, 0).transformDirection(m);
    const yaw = this.cameraSystem.orbitYawOffset || 0;
    const pitch = Math.max(-0.9, Math.min(0.9, this.cameraSystem.orbitPitchOffset || 0));
    let local, dir;
    if (view === 'cabin') {
      // standing by a doorway on the far side, looking across the car at the platform side's doors and windows
      local = new THREE.Vector3(HALF_W - 0.55, FLOOR + 1.62, DOORS[1] + 0.9);
      dir = new THREE.Vector3(-0.92, -0.08, -0.38);
    } else if (view === 'window') {
      // on the bench, looking out of the window opposite (the platform side, where the stations are)
      local = new THREE.Vector3(HALF_W - 0.45, FLOOR + 1.2, DOORS[2] + 2.2);
      dir = new THREE.Vector3(-1, -0.02, 0.15);
    } else if (view === 'front') {
      local = new THREE.Vector3(0, FLOOR + 1.55, L / 2 - 1.4);
      dir = new THREE.Vector3(0, -0.06, 1);
    } else {
      // outside: behind and above the train, to its left, following it
      local = new THREE.Vector3(9, 6.5, L * 1.6);
      dir = new THREE.Vector3(-0.42, -0.3, -1);
      local.applyMatrix4(this._m.copy(this.train.cars[0].matrixWorld));
      const target = new THREE.Vector3(0, 2, 0).applyMatrix4(this.train.cars[0].matrixWorld);
      this.cameraFrom(local, target, yaw, pitch, up);
      return;
    }
    const pos = local.applyMatrix4(m);
    // the look: the view's own direction, turned by the user's drag
    dir.normalize();
    const d = this._v.set(0, 0, 0).addScaledVector(left, dir.x).addScaledVector(up, dir.y).addScaledVector(fwd, dir.z);
    d.applyAxisAngle(up, -yaw);
    const side = this._look.crossVectors(d, up).normalize();
    d.applyAxisAngle(side, pitch);
    cam.position.copy(pos);
    cam.up.copy(up);
    cam.lookAt(pos.x + d.x, pos.y + d.y, pos.z + d.z);
    cam.up.set(0, 1, 0);
    cam.fov = view === 'front' ? 62 : 70;
    cam.updateProjectionMatrix();
    this.cameraSystem.currentPos.copy(pos);
    this.cameraSystem.currentLookAt.set(pos.x + d.x * 10, pos.y + d.y * 10, pos.z + d.z * 10);
  }

  cameraFrom(pos, target, yaw, pitch, up) {
    const cam = this.cameraSystem.camera;
    const off = pos.clone().sub(target);
    off.applyAxisAngle(up, -yaw);
    cam.position.copy(target).add(off);
    cam.lookAt(target);
    cam.fov = 56;
    cam.updateProjectionMatrix();
    this.cameraSystem.currentPos.copy(cam.position);
    this.cameraSystem.currentLookAt.copy(target);
  }

  // --------------------------------------------------------------------------------------------------------- controls
  cycleView(step = 1) {
    this.view = (this.view + step + VIEWS.length) % VIEWS.length;
    this.cameraSystem.orbitYawOffset = 0;
    this.cameraSystem.orbitPitchOffset = 0;
    this.updateHud(true);
  }

  cycleSpeed() {
    this.speed = (this.speed + 1) % SPEEDS.length;
    if (SPEEDS[this.speed] > 1) this.sound.stopSpeech();
    this.updateHud(true);
  }

  skip() {
    this.ride?.skip();
    this.sound.stopSpeech();
  }

  alight() {
    if (!this.ride) return;
    this.ride.alightNext();
    this.onToast(`Getting off at ${this.ride.station.name}`);
    this.updateHud(true);
  }

  key(e) {
    if (!this.ride || e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(e.target?.tagName)) return;
    const used = { KeyV: () => this.cycleView(e.shiftKey ? -1 : 1), KeyF: () => this.cycleSpeed(), KeyN: null, KeyG: () => this.skip(), Escape: () => this.alight() };
    if (e.code === 'KeyN' || e.code === 'KeyM' || e.code === 'KeyH' || e.code === 'KeyO') return; // (sound, the map, the HUD: as ever)
    const fn = used[e.code];
    // (everything else that would move or switch the player waits until you are off the train)
    e.stopImmediatePropagation();
    e.preventDefault();
    if (fn && !e.repeat) fn();
  }

  /** The ride is over (arrived, or ended early): the train and its stations gone, the player out of the station */
  end(arrived = true) {
    const r = this.ride;
    if (!r) return;
    const station = r.done ? r.station : r.track.stops[Math.min(r.stop, r.track.stops.length - 1)].station;
    this.ride = null;
    this.train?.dispose();
    this.train = null;
    for (const st of this.stations.values()) st.dispose();
    this.stations.clear();
    this.tunnel?.update(null, 0);
    this.sound.stop();
    if (this.below) { this.below = false; this.onUnderground(false); }
    this.hideHud();
    window.removeEventListener('keydown', this.onKey, true);
    document.body.classList.remove('mrt-riding');
    // out at the station's exit nearest where you were going (else its own point)
    const exit = station.exits.length ? station.exits[0] : null;
    this.onEnd({ station, exit, arrived, goal: this.goal });
  }

  // -------------------------------------------------------------------------------------------------------------- HUD
  showHud() {
    if (typeof document === 'undefined') return;
    if (!this.hud) {
      const el = document.createElement('div');
      el.id = 'mrt-panel';
      el.className = 'hud hud-top-center mrt-panel';
      el.innerHTML = `
        <div class="panel mrt-card" aria-live="polite">
          <div class="mrt-row">
            <span class="mrt-badge"></span>
            <div class="mrt-text">
              <div class="mrt-next"><span class="mrt-label">Next</span> <span class="mrt-name"></span></div>
              <div class="mrt-sub"></div>
            </div>
            <button class="icon-btn mrt-close" type="button" title="Get off at the next station [Esc]" aria-label="Get off at the next station"><svg class="icon" aria-hidden="true"><use href="#i-close"/></svg></button>
          </div>
          <ol class="mrt-strip"></ol>
          <div class="mrt-controls">
            <button class="mrt-btn" data-mrt="view" type="button" title="Change the view [V]"></button>
            <button class="mrt-btn" data-mrt="speed" type="button" title="Fast-forward [F]"></button>
            <button class="mrt-btn" data-mrt="skip" type="button" title="On to the next station [G]">Next stop ›</button>
            <button class="mrt-btn" data-mrt="off" type="button" title="Get off at the next station [Esc]">Get off</button>
          </div>
        </div>`;
      document.body.appendChild(el);
      el.querySelector('.mrt-close').addEventListener('click', () => this.alight());
      el.querySelector('[data-mrt="view"]').addEventListener('click', () => this.cycleView());
      el.querySelector('[data-mrt="speed"]').addEventListener('click', () => this.cycleSpeed());
      el.querySelector('[data-mrt="skip"]').addEventListener('click', () => this.skip());
      el.querySelector('[data-mrt="off"]').addEventListener('click', () => this.alight());
      this.hud = {
        el, badge: el.querySelector('.mrt-badge'), label: el.querySelector('.mrt-label'), name: el.querySelector('.mrt-name'),
        sub: el.querySelector('.mrt-sub'), strip: el.querySelector('.mrt-strip'), view: el.querySelector('[data-mrt="view"]'),
        speed: el.querySelector('[data-mrt="speed"]')
      };
    }
    this.hud.el.hidden = false;
    this.hudKey = '';
    this.updateHud(true);
  }

  hideHud() {
    if (this.hud) this.hud.el.hidden = true;
  }

  updateHud(force = false) {
    const h = this.hud;
    const r = this.ride;
    if (!h || !r) return;
    this.hudTimer = (this.hudTimer || 0) - 1;
    if (!force && this.hudTimer > 0) return;
    this.hudTimer = 10;
    const line = r.line;
    h.badge.textContent = line.code;
    h.badge.style.background = line.colour;
    const at = r.phase === 'doors' || r.phase === 'closing' || r.phase === 'change' || r.done;
    h.label.textContent = r.done ? 'Arrived' : r.phase === 'change' ? 'Change' : at ? 'At' : 'Next';
    h.name.textContent = r.station.name;
    // minutes left: this leg's run at the line's pace, the stops on the way, the changes
    let s = Math.max(0, r.stopFront(r.leg.to) - r.front) / 14 + (r.leg.to - r.stop) * 26;
    for (let i = r.legIndex + 1; i < r.legs.length; i++) {
      const l = r.legs[i];
      s += (l.track.stops[l.to].s - l.track.stops[l.from].s) / 14 + (l.to - l.from) * 26 + 180;
    }
    const km = (r.v * 3.6).toFixed(0);
    const legs = r.legs.length > 1 ? ` · ${r.legIndex + 1} of ${r.legs.length} trains` : '';
    h.sub.textContent = `${line.name} to ${r.track.towards} · ${km} km/h · ${Math.max(1, Math.round(s / 60))} min to ${r.destination.name}${legs}`;
    h.view.textContent = VIEWS[this.view].label;
    h.speed.textContent = SPEEDS[this.speed] > 1 ? `Fast ${SPEEDS[this.speed]}×` : 'Real time';
    h.speed.classList.toggle('active', SPEEDS[this.speed] > 1);
    // the stops left on this train
    const key = `${r.legIndex}:${r.stop}:${r.phase === 'run'}`;
    if (key !== this.hudKey) {
      this.hudKey = key;
      h.strip.replaceChildren();
      h.strip.style.setProperty('--line', line.colour);
      const stops = r.track.stops.slice(Math.max(r.leg.from, r.stop - 1), r.leg.to + 1);
      for (const st of stops.slice(0, 9)) {
        const li = document.createElement('li');
        const k = r.track.stops.indexOf(st);
        li.className = k < r.stop || (k === r.stop - 1) ? 'passed' : k === r.stop ? 'current' : '';
        if (k === r.stop - 1 && r.phase === 'run') li.className = 'passed';
        const dot = document.createElement('span');
        dot.className = 'mrt-dot';
        const name = document.createElement('span');
        name.className = 'mrt-stop';
        name.textContent = st.station.name;
        li.append(dot, name);
        // interchanges: the other lines' colours
        const others = this.net.linesAt(st.station).filter((l) => l !== line);
        for (const l of others) {
          const chip = document.createElement('span');
          chip.className = 'mrt-chip';
          chip.style.background = l.colour;
          chip.textContent = l.code;
          li.append(chip);
        }
        h.strip.append(li);
      }
      if (stops.length > 9) {
        const li = document.createElement('li');
        li.className = 'more';
        li.textContent = `+ ${stops.length - 9} more to ${r.track.stops[r.leg.to].station.name}`;
        h.strip.append(li);
      }
    }
  }
}

export { MrtSystem, VIEWS };
