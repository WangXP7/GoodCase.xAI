import * as THREE from 'three/webgpu';
import { createJetModel } from './jet-model.js';
import { attitude } from './jet-flight.js';
import { WingtipTrails, ShockCollar, SmokeTrails } from './jet-effects.js';
import { SoundTrail, SOUND } from './jet-acoustics.js';

// js/air-force.js
// The RSAF's other F-15SGs (js/jet-model.js, without cockpits):
// - A wingman on the player's jet: in right echelon, 16 m off the right wing and 16 m back, a little low; on the runway
//   abreast of it, 2 m of air between the wingtips (so the chase camera sees both). It holds its place in the leader's frame, catching up a little late, so a roll or a pull
//   swings it round and back into position; when the leader crashes it flies on, and rejoins when the leader is back.
// - A flypast ordered for wherever the camera is: four jets in a diamond (lead, left and right wing, slot) running in
//   level from 2.5 km out ahead of the view, straight towards it, 150 m up (clear of the tallest buildings under their
//   track, and over a camera up high), passing right over it, 30 m to one side: at their closest an F-15 is a good
//   tenth of the screen; then, 250 m past it, a bomb burst: all four in afterburner, the lead pulling straight up, the
//   wings peeling left and right, the slot rolling up the middle, vapour off their wingtips; and on over the top. Or
//   another formation and its display (FORMATIONS, chosen or a surprise): a finger four's missing man (#3 pulls up
//   into the sky over you as the others fly on), an echelon's fan break (one by one rolling into a hard turn away), a
//   loop in line abreast in front of you, or a line astern's rolls in turn and climb. Red and white smoke streams from
//   them through the display (SmokeTrails), drifting on the breeze for a quarter of a minute.
//   js/binoculars.js follows it all, zoomed in (focus()). Supersonic, it runs in at Mach 1.14 from twice as far out (the
//   same wait), a vapour cone round each jet: it passes over in silence, and the booms follow as each one's Mach cone
//   sweeps over (js/jet-acoustics.js: every jet's path is kept for its sound, heard from the ground as it arrives).
//   It can be watched from inside it too (ride): a wingman's or the slot's front seat, or a chase plane behind.
// The jets are heard through js/audio-sources.js (`aircraft`) and drawn on the radar and map (`contacts`).
// createAirForce(scene, controllers) returns { group, aircraft (each with its `trail`), contacts, setWingman(on), wingman,
// orderFlypast(camera, { supersonic, formation, smoke }), flypast: { active, id, formation, speed, eta, overhead,
// focus(out), ride(view, camera) }, update(dt, elapsed, camera) }.

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const _look = new THREE.Vector3();
const qArray = [0, 0, 0, 1];

function aiJet(group, { cockpit = false } = {}) {
  const model = createJetModel({ cockpit });
  model.setCockpitView?.(false);
  model.root.traverse((o) => {
    if (o.isMesh && !o.material.transparent && !o.material.isMeshBasicNodeMaterial) o.castShadow = true;
  });
  model.root.visible = false;
  model.setGear(0);
  group.add(model.root);
  return {
    model,
    pos: model.root.position,
    q: model.root.quaternion,
    // what js/audio-sources.js hears
    // (`trail`: where it's been, for its sound to be heard from as it arrives; `direct`: heard as it is, from inside it)
    sound: { active: false, x: 0, y: 0, z: 0, speed: 0, throttle: 0, heading: 0, gain: 1, trail: new SoundTrail(), direct: false },
    contact: { visible: false, x: 0, z: 0, heading: 0 }
  };
}

function syncOutputs(j, speed, throttle, heading) {
  const s = j.sound;
  s.active = j.model.root.visible;
  s.x = j.pos.x; s.y = j.pos.y; s.z = j.pos.z;
  s.speed = speed;
  s.throttle = throttle;
  s.heading = heading;
  const c = j.contact;
  c.visible = s.active;
  c.x = j.pos.x; c.z = j.pos.z;
  c.heading = heading;
}

// ---------------------------------------------------------------------------------------------------------------------
// The wingman
// ---------------------------------------------------------------------------------------------------------------------
const ECHELON = new THREE.Vector3(-16, -2, -16); // (body frame: left +x, so the right wing is -x)
const ON_RUNWAY = new THREE.Vector3(-15, 0, 2);

class Wingman {
  constructor(group) {
    this.jet = aiJet(group);
    this.jet.sound.gain = 0.7;
    this.enabled = false;
    this.fresh = true;
    this.vel = new THREE.Vector3();
    this.lastLead = new THREE.Vector3();
    this.leadVelocity = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.leadQ = new THREE.Quaternion();
    this.offset = new THREE.Vector3();
  }

  setEnabled(on) {
    this.enabled = !!on;
    this.fresh = true;
    this.jet.sound.trail.clear();
    this.jet.model.root.visible = this.enabled;
    if (!this.enabled) syncOutputs(this.jet, 0, 0, 0);
  }

  update(dt, elapsed, lead) {
    const j = this.jet;
    if (!this.enabled || !lead || !(dt > 0)) return;
    const s = lead.flight;
    const L = lead.position;
    // where the leader went this frame (a teleport or a respawn is not a velocity)
    const moved = _v.subVectors(L, this.lastLead).length();
    const jumped = this.fresh || moved > Math.max(60, 400 * dt);
    if (!jumped) this.leadVelocity.copy(_v).divideScalar(dt);
    this.lastLead.copy(L);

    if (lead.crashed > 0) {
      // the leader is down: fly on as we were, levelling off
      j.pos.addScaledVector(this.vel, dt);
      this.vel.y *= Math.exp(-dt);
      j.pos.y = Math.max(j.pos.y, 60);
    } else {
      this.leadQ.set(s.q[0], s.q[1], s.q[2], s.q[3]);
      // in echelon in the air, beside and behind on the runway (the gear's travel blends between the two)
      this.offset.copy(ECHELON).lerp(ON_RUNWAY, s.onGround ? 1 : Math.min(1, s.gear) * 0.6);
      const target = this.target.copy(this.offset).applyQuaternion(this.leadQ).add(L);
      if (jumped && (this.fresh || target.distanceTo(j.pos) > 300)) {
        // a fresh start, or the leader is somewhere else now: in place at once
        j.pos.copy(target);
        j.q.copy(this.leadQ);
        this.vel.set(0, 0, 0);
      } else {
        // carried along with the leader, easing into its place; turning to its attitude a little late
        if (!jumped) {
          this.vel.copy(this.leadVelocity);
          j.pos.addScaledVector(this.vel, dt);
        }
        j.pos.lerp(target, 1 - Math.exp(-dt * 2.2));
        j.q.slerp(this.leadQ, 1 - Math.exp(-dt * 4));
      }
      this.fresh = false;
    }
    j.pos.y = Math.max(j.pos.y, 2.3);
    const m = j.model;
    m.setGear(lead.crashed > 0 ? 0 : s.gear);
    m.setAfterburner(lead.crashed > 0 ? 0.3 : s.afterburner);
    m.setStabilators(lead.stick || 0);
    m.strobe.visible = ((elapsed + 0.45) % 1.3) < 0.07;
    const speed = this.vel.length();
    syncOutputs(j, speed, lead.crashed > 0 ? 0.8 : s.throttle, Math.atan2(this.vel.x, this.vel.z) || lead.heading);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The flypast
// ---------------------------------------------------------------------------------------------------------------------
// The formations, each four jets: where each flies in the lead's frame (left +x, up +y, forward +z) on the run-in,
// where the display starts (`past`: metres past the camera, at the subsonic speed; negative, short of it, in front),
// how long it's watched (s), its smoke (red or white, each jet), which jets the binoculars follow through it
// (`watch`), and each jet's part from then: { delay (s), pitch: the climb it pulls to (rad; 2π a loop), rate: how
// fast (rad/s), pitchDelay (s), bank (rad, + right), turn (rad/s, + left), roll (rad/s) and rolls: aileron rolls,
// ab: afterburner (0..1, 1 unless given) }
const LOOP = 2 * Math.PI;
const FORMATIONS = {
  diamond: {
    name: 'Diamond', manoeuvre: 'bomb burst', past: 250, duration: 18, watch: [0, 3], smoke: ['white', 'red', 'red', 'white'],
    slots: [
      { at: [0, 0, 0], part: { pitch: 1.45, rate: 0.5 } }, // lead: straight up
      { at: [15, -2, -15], part: { pitch: 0.75, rate: 0.5, bank: -1.0, turn: 0.22 } }, // left wing: up and away left
      { at: [-15, -2, -15], part: { pitch: 0.75, rate: 0.5, bank: 1.0, turn: -0.22 } }, // right wing: away right
      { at: [0, -4, -30], part: { pitch: 1.2, rate: 0.5, roll: 2.2, rolls: Infinity } } // slot: rolling up the middle
    ]
  },
  // the fingertips of a right hand; the missing man is #3, who pulls up out of it into the sky as the others fly on
  missingMan: {
    name: 'Finger four', manoeuvre: 'missing man', past: -60, duration: 20, watch: [2], smoke: ['white', 'white', 'red', 'white'],
    slots: [
      { at: [0, 0, 0], part: { ab: 0 } },
      { at: [13, -1, -13], part: { ab: 0 } },
      { at: [-13, -1, -13], part: { pitch: 1.5, rate: 0.35 } },
      { at: [-26, -2, -26], part: { ab: 0 } }
    ]
  },
  // in echelon right, then one by one each rolls left into a hard turn away: the fan break
  echelonBreak: {
    name: 'Echelon right', manoeuvre: 'fan break', past: 80, duration: 18, watch: [0, 1, 2, 3], smoke: ['red', 'white', 'red', 'white'],
    slots: [0, 1, 2, 3].map((k) => ({
      at: [-14 * k, -1.5 * k, -14 * k],
      part: { delay: k * 1.1, bank: -1.25, turn: 0.15, pitch: 0.12, rate: 0.2 }
    }))
  },
  // abreast, a loop together in front of the camera (1.1 km high), then on over it
  abreastLoop: {
    name: 'Line abreast', manoeuvre: 'loop', past: -700, duration: 26, watch: [0, 1, 2, 3], smoke: ['red', 'white', 'white', 'red'],
    slots: [27, 9, -9, -27].map((x) => ({ at: [x, 0, -Math.abs(x) * 0.15], part: { pitch: LOOP, rate: 0.35 } }))
  },
  // in trail, each in turn a pair of aileron rolls, then all four up into the climb
  trailRolls: {
    name: 'Line astern', manoeuvre: 'roll and climb', past: -600, duration: 18, watch: [0, 1, 2, 3], smoke: ['white', 'red', 'white', 'red'],
    slots: [0, 1, 2, 3].map((k) => ({
      at: [0, -3 * k, -28 * k],
      part: { delay: k * 0.7, roll: 3.4, rolls: 2, pitch: 0.9, rate: 0.25, pitchDelay: 3.5 }
    }))
  }
};
const FORMATION_IDS = Object.keys(FORMATIONS);
// the smoke: on this long before the display, and for this long into it (s)
const SMOKE_ON = { before: 3, during: 12 };

// m/s, subsonic and supersonic (Mach 1.14); the run-in's length up to the camera, and how far past it the burst starts
// (m, at the subsonic speed: further in proportion at another); its offset to the side (m); its height (m: at least, and
// over the buildings under it, and the camera); how long the burst is watched (s)
const FLYPAST = { speed: 190, supersonic: 390, approach: 2500, side: 30, height: 150, clear: 60, above: 120 };

// The views from inside the formation (Flypast.ride): which jet's front seat (#2, a wingman; #4, the last), looking
// towards the lead from where its place in the formation puts it (yaw + left, pitch + down, in its frame)
const RIDES = ['wing', 'slot', 'chase'];
const SEATS = { wing: { jet: 1 }, slot: { jet: 3 } };
// (from the front seat's eyes: most of the way round to the lead, a little of the sky ahead kept in view)
function seatLook(at) {
  const dx = -at[0] - EYE[0], dy = -at[1] - EYE[1], dz = -at[2] - EYE[2];
  return { yaw: Math.atan2(dx, Math.max(dz, 1e-3)) * 0.85, pitch: -Math.atan2(dy, Math.hypot(dx, dz)) };
}
const EYE = [0, 1.12, 4.1]; // the front seat's eyes, in the jet's frame

class Flypast {
  constructor(group) {
    this.jets = [0, 1, 2, 3].map(() => {
      const j = { ...aiJet(group, { cockpit: true }), part: {}, at: [0, 0, 0], heading: 0, pitch: 0, bank: 0, rollAngle: 0 };
      j.collar = new ShockCollar(j.model.root);
      return j;
    });
    this.trails = this.jets.map(() => new WingtipTrails(group));
    this.smoke = new SmokeTrails(group, this.jets.length);
    this.smokeOn = true;
    this.smokeAt = this.jets.map(() => new THREE.Vector3());
    this.smoking = this.jets.map(() => false);
    this.formation = FORMATIONS.diamond;
    this.id = null;
    this.speed = FLYPAST.speed;
    this.approach = FLYPAST.approach;
    this.past = FORMATIONS.diamond.past;
    this.rider = null; // the jet whose cockpit is in view
    this.active = false;
    this.t = 0;
    this.start = new THREE.Vector3();
    this.dir = new THREE.Vector3();
    this.tips = [new THREE.Vector3(), new THREE.Vector3()];
    this.up = new THREE.Vector3();
  }

  /** Time until the bomb burst (s) */
  get eta() {
    return this.active ? Math.max(0, this.pullAt - this.t) : 0;
  }

  /** Time until it's over the camera (s) */
  get overhead() {
    return this.active ? Math.max(0, this.approach / this.speed - this.t) : 0;
  }

  get pullAt() { return (this.approach + this.past) / this.speed; }

  /**
   * Put `camera` in the formation (view one of RIDES: a wingman's or the slot's front seat, its cockpit drawn, or a
   * chase plane behind and above the lead, looking past it), or take it out (null). Returns whether it's riding.
   */
  ride(view, camera) {
    const seat = this.active ? SEATS[view] : null;
    const rider = seat ? this.jets[seat.jet] : null;
    if (rider !== this.rider) {
      if (this.rider) { this.rider.model.setCockpitView?.(false); this.rider.collar.hidden = false; }
      if (rider) { rider.model.setCockpitView?.(true); rider.collar.hidden = true; }
      this.rider = rider;
    }
    if (!this.active || !RIDES.includes(view)) return false;
    if (rider) {
      const look = seatLook(rider.at);
      camera.position.set(EYE[0], EYE[1], EYE[2]).applyQuaternion(rider.q).add(rider.pos);
      // the camera looks down its -z: the jet's attitude, the look about its up and across, turned round
      camera.quaternion.copy(rider.q)
        .multiply(_q.setFromAxisAngle(_axis.set(0, 1, 0), look.yaw))
        .multiply(_q2.setFromAxisAngle(_axis.set(1, 0, 0), look.pitch))
        .multiply(_q.setFromAxisAngle(_axis.set(0, 1, 0), Math.PI));
      return true;
    }
    const lead = this.jets[0];
    camera.position.set(0, 9, -62).applyQuaternion(lead.q).add(lead.pos);
    _v.set(0, 1, 0).applyQuaternion(lead.q);
    const upX = camera.up.x, upY = camera.up.y, upZ = camera.up.z;
    camera.up.set(_v.x, _v.y, _v.z);
    camera.lookAt(_look.set(0, -3, 30).applyQuaternion(lead.q).add(lead.pos));
    camera.up.set(upX, upY, upZ);
    return true;
  }

  /**
   * What to watch, for js/binoculars.js: the middle of the formation into `out`, and how far it spreads from it (m,
   * wingtips in), 0 with none; through the display the jets it's about (FORMATIONS' `watch`: in the bomb burst the
   * lead and the slot climbing up the middle together, the wings peeling away out of the frame; the missing man
   * alone), as a camera on the ground follows it
   */
  focus(out) {
    if (!this.active) return 0;
    const watched = this.t < this.pullAt ? this.jets : this.formation.watch.map((k) => this.jets[k]);
    out.set(0, 0, 0);
    for (const j of watched) out.add(j.pos);
    out.set(out.x / watched.length, out.y / watched.length, out.z / watched.length);
    let r = 0;
    for (const j of watched) r = Math.max(r, Math.hypot(j.pos.x - out.x, j.pos.y - out.y, j.pos.z - out.z));
    return r + 10; // (an F-15 is 19.4 m long)
  }

  // run in towards (ox, oz) along the unit direction (dx, dz) at height `altitude` and `speed`, from as far out as
  // FLYPAST.approach takes at FLYPAST.speed, in formation `id` (FORMATIONS)
  begin(ox, oz, dx, dz, altitude, speed = FLYPAST.speed, id = 'diamond') {
    this.id = FORMATIONS[id] ? id : 'diamond';
    this.formation = FORMATIONS[this.id];
    this.active = true;
    this.t = 0;
    this.speed = speed;
    this.approach = (FLYPAST.approach * speed) / FLYPAST.speed;
    this.past = (this.formation.past * speed) / FLYPAST.speed;
    this.dir.set(dx, 0, dz);
    this.start.set(ox - dx * this.approach, altitude, oz - dz * this.approach);
    const heading = Math.atan2(dx, dz);
    this.smoke.clear();
    this.jets.forEach((j, k) => {
      const slot = this.formation.slots[k];
      j.at = slot.at;
      j.part = slot.part;
      this.smoke.setColour(k, this.formation.smoke[k]);
      j.heading = heading;
      j.pitch = j.bank = j.rollAngle = 0;
      j.model.root.visible = true;
      j.model.setGear(0);
      j.sound.trail.clear();
    });
    for (const t of this.trails) t.clear();
  }

  end() {
    this.active = false;
    if (this.rider) { this.rider.model.setCockpitView?.(false); this.rider.collar.hidden = false; }
    this.rider = null;
    for (const j of this.jets) {
      j.model.root.visible = false;
      syncOutputs(j, 0, 0, 0);
    }
    for (const t of this.trails) t.clear();
    // (the smoke stays where it was left, drifting off: SmokeTrails fades it)
    this.smoking.fill(false);
  }

  /** The smoke, every frame while any of it is in the air: facing `eye` (the camera's position) */
  updateSmoke(dt, eye) {
    this.smoke.update(dt, this.smokeAt, this.smoking, eye);
  }

  update(dt, elapsed) {
    if (!this.active || !(dt > 0)) return;
    this.t += dt;
    const pull = this.pullAt;
    const v = this.speed;
    if (this.t >= pull + this.formation.duration) {
      this.end();
      return;
    }
    if (this.t < pull) {
      // in formation: the lead along the run-in line, the others in their places around it
      const lead = _v.copy(this.start).addScaledVector(this.dir, v * this.t);
      attitude(this.jets[0].heading, 0, 0, qArray);
      _q.set(qArray[0], qArray[1], qArray[2], qArray[3]);
      for (const j of this.jets) {
        j.pos.set(...j.at).applyQuaternion(_q).add(lead);
        j.q.copy(_q);
        j.model.setAfterburner(v > SOUND.speed ? 0.6 : 0);
        syncOutputs(j, v, v > SOUND.speed ? 0.92 : 0.8, j.heading);
      }
    } else {
      // the display: each its own part, from its own moment
      const since = this.t - pull;
      this.jets.forEach((j, k) => {
        const b = j.part;
        const into = since - (b.delay || 0);
        let pulling = 0;
        if (into > 0) {
          const rate = b.rate || 0.4;
          const before = j.pitch;
          if (into > (b.pitchDelay || 0)) j.pitch += Math.max(-rate * dt, Math.min(rate * dt, (b.pitch || 0) - j.pitch));
          pulling = Math.abs(j.pitch - before) / dt;
          j.bank += ((b.bank || 0) - j.bank) * (1 - Math.exp(-dt * 2.5));
          j.heading += (b.turn || 0) * Math.min(1, into) * dt;
          if (b.roll) j.rollAngle = Math.min((b.rolls ?? Infinity) * 2 * Math.PI, j.rollAngle + b.roll * dt * Math.min(1, into * 2));
        }
        const cp = Math.cos(j.pitch);
        j.pos.x += Math.sin(j.heading) * cp * v * dt;
        j.pos.y += Math.sin(j.pitch) * v * dt;
        j.pos.z += Math.cos(j.heading) * cp * v * dt;
        attitude(j.heading, j.pitch, j.bank + j.rollAngle, qArray);
        j.q.set(qArray[0], qArray[1], qArray[2], qArray[3]);
        const burner = into > 0 && (b.ab ?? 1) > 0;
        j.model.setAfterburner(burner ? (b.ab ?? 1) * Math.min(1, into * 2) : v > SOUND.speed ? 0.6 : 0);
        j.model.setStabilators(pulling > 0.05 ? 0.8 : 0.1);
        syncOutputs(j, v, burner ? 1 : v > SOUND.speed ? 0.92 : 0.8, j.heading);
        // vapour off the wingtips while it pulls (or turns hard): the g above about 4
        const g = ((pulling + Math.abs(into > 0 ? b.turn || 0 : 0)) * v) / 9.81 + 1;
        this.tips[0].set(6.45, 0.3, -4.4).applyQuaternion(j.q).add(j.pos);
        this.tips[1].set(-6.45, 0.3, -4.4).applyQuaternion(j.q).add(j.pos);
        this.up.set(0, 1, 0).applyQuaternion(j.q);
        this.trails[k].update(dt, this.tips, this.up, Math.max(0, Math.min(0.8, (g - 4) / 2.5)));
      });
    }
    // the smoke: from just behind each jet's nozzles, on from a little before the display to well into it
    const smokeOn = this.smokeOn && this.t > pull - SMOKE_ON.before && this.t < pull + SMOKE_ON.during;
    this.jets.forEach((j, k) => {
      this.smokeAt[k].set(0, 0, -10.5).applyQuaternion(j.q).add(j.pos);
      this.smoking[k] = smokeOn;
      j.model.strobe.visible = ((elapsed + j.at[0] * 0.03) % 1.3) < 0.07;
      j.collar.set(v / SOUND.speed, elapsed);
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
function createAirForce(scene, controllers) {
  const group = new THREE.Group();
  group.name = 'AirForce';
  scene.add(group);
  const wingman = new Wingman(group);
  const flypast = new Flypast(group);
  const all = [wingman.jet, ...flypast.jets];

  /** Clear above the buildings along a line: the tallest under it (within 80 m) + FLYPAST.clear, at least FLYPAST.height */
  function clearAltitude(ox, oz, dx, dz, from, to) {
    let top = 0;
    for (let s = from; s <= to; s += 100) {
      for (const c of controllers.nearColliders(ox + dx * s, oz + dz * s, 80)) top = Math.max(top, c.maxY || 0);
    }
    return Math.min(900, Math.max(FLYPAST.height, top + FLYPAST.clear));
  }

  return {
    group,
    wingman,
    flypast,
    // for js/audio-sources.js and the maps
    aircraft: all.map((j) => j.sound),
    contacts: all.map((j) => j.contact),
    setWingman(on) { wingman.setEnabled(on); },
    /**
     * A flypast for where the camera is: running in from out ahead of it, straight towards it and over it, a little to
     * its right (the camera's right, looking along (fx, fz) with y up, is (-fz, fx)), its display about it.
     * `formation`: one of FORMATIONS, or 'random' for any other than the last one flown (the diamond when left out);
     * `smoke`: red and white smoke through the display (on unless false). Returns the seconds until the display.
     */
    orderFlypast(camera, { supersonic = false, formation = 'diamond', smoke = true } = {}) {
      if (!FORMATIONS[formation]) {
        const others = FORMATION_IDS.filter((f) => f !== flypast.id);
        formation = others[Math.floor(Math.random() * others.length)];
      }
      flypast.smokeOn = smoke !== false;
      const look = camera.getWorldDirection(new THREE.Vector3());
      let fx = look.x, fz = look.z;
      const L = Math.hypot(fx, fz) || 1;
      fx /= L; fz /= L;
      const ox = camera.position.x - fz * FLYPAST.side, oz = camera.position.z + fx * FLYPAST.side;
      const speed = supersonic ? FLYPAST.supersonic : FLYPAST.speed;
      const far = (FLYPAST.approach * speed) / FLYPAST.speed;
      const after = (Math.max(0, FORMATIONS[formation].past) * speed) / FLYPAST.speed + 300;
      const altitude = Math.min(3000, Math.max(clearAltitude(ox, oz, -fx, -fz, -far, after), camera.position.y + FLYPAST.above));
      flypast.begin(ox, oz, -fx, -fz, altitude, speed, formation);
      return flypast.eta;
    },
    update(dt, elapsed, camera = null) {
      wingman.update(dt, elapsed, controllers.entities.jet);
      flypast.update(dt, elapsed);
      if (camera) flypast.updateSmoke(dt, camera.position);
      // where each one is now, for its sound to be heard from
      for (const j of all) if (j.model.root.visible) j.sound.trail.push(elapsed, j.pos.x, j.pos.y, j.pos.z, j.sound.throttle);
    }
  };
}

export { createAirForce, FLYPAST, FORMATIONS, RIDES };
