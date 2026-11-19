import * as THREE from 'three/webgpu';
import { bryantParkLawn } from './landmarks.js';

// js/cameras.js
// Multi-camera system supporting Third-Person Chase (with mouse/touch orbit + zoom),
// Low-Angle Action Cam, POV/Cockpit Cam, 7 Iconic NYC Architectural Cameras, and Auto-Director Drone.

const CAMERA_PRESETS = [
  { id: 'chase',       name: '3rd-Person Chase',         short: 'Chase',       category: 'follow', fov: 56 },
  { id: 'action',      name: 'Low-Angle Action',         short: 'Action',      category: 'follow', fov: 60 },
  { id: 'pov',         name: 'First-Person / Cockpit',   short: 'POV / Dash',  category: 'follow', fov: 68 },
  { id: 'taxi',        name: 'Crazy Taxi Cam',           short: 'Taxi Cam',    category: 'follow', fov: 72 },
  { id: 'centralPark', name: 'Central Park Oasis',       short: 'Central Pk',  category: 'scenic', fov: 52 },
  { id: 'fifthAve',    name: '5th Ave & Empire State',   short: '5th Ave',     category: 'scenic', fov: 48 },
  { id: 'timesSquare', name: 'Times Square Crossroads',  short: 'Times Sq',    category: 'scenic', fov: 58 },
  { id: 'chryslerGCT', name: '42nd St · Chrysler & GCT', short: 'Chrysler',    category: 'scenic', fov: 50 },
  { id: 'observatory', name: 'Empire State 86th Deck',   short: '86th Deck',   category: 'scenic', fov: 52 },
  { id: 'bryantPark',  name: 'Bryant Park & NYPL',       short: 'Bryant Pk',   category: 'scenic', fov: 52 },
  { id: 'waterfront',  name: 'East River & Skyline',     short: 'Skyline',     category: 'scenic', fov: 46 },
  { id: 'drone',       name: 'Auto-Director Aerial',     short: 'Director',    category: 'scenic', fov: 50 }
];

// The head in the jet's cockpit and the Crazy Taxi cam, aimed by where the mouse is (no click): the middle of the screen is straight
// ahead, a quiet zone around it, then further out the head turns further, to 130° either side at the screen's edges
// (over the shoulder, down the wing) and 60° up / 32° down at its top and bottom. Returns { yaw (+ left), pitch (+ up) }
// for a pointer at (nx, ny), each -1..1 from the screen's centre (ny down).
const HEAD = { quiet: 0.14, yaw: 2.27, up: 1.05, down: 0.56, curve: 1.35, omega: 8.5 };
function headTarget(nx, ny, out = { yaw: 0, pitch: 0 }) {
  const shape = (t) => Math.sign(t) * Math.min(1, Math.max(0, (Math.abs(t) - HEAD.quiet) / (1 - HEAD.quiet - 0.04))) ** HEAD.curve;
  out.yaw = -shape(nx) * HEAD.yaw;
  const v = shape(ny);
  out.pitch = -v * (v < 0 ? HEAD.up : HEAD.down);
  return out;
}

class CameraSystem {
  constructor(domElement, controllerManager) {
    this.domElement = domElement;
    this.controllerManager = controllerManager;

    this.camera = new THREE.PerspectiveCamera(
      56,
      window.innerWidth / window.innerHeight,
      0.35,
      60000 // at 1:1 the boroughs & harbor run out ~20-40 km to the fogged horizon (reversed float depth keeps precision)
    );

    this.activePresetId = 'chase';
    this.orbitYawOffset = 0.0;
    this.orbitPitchOffset = 0.09;
    this.zoomMultiplier = 1.0;
    this.isDragging = false;
    this.userOrbitTimer = 0;

    this.currentPos = new THREE.Vector3(0, 10, 380);
    this.currentLookAt = new THREE.Vector3(0, 8, 440);
    this.initialized = false;

    // Follow cameras (chase / action) are smoothed relative to the followed entity, see update()
    this.followEntity = null;
    this.followOffset = new THREE.Vector3();
    this.followLookOffset = new THREE.Vector3();
    this.followBaseY = 0;
    this.smoothedSpeed = 0;
    this._desiredPos = new THREE.Vector3();
    this._desiredLook = new THREE.Vector3();

    // The Crazy Taxi cockpit (taxi preset): the driver's side of the cab (+1 right, -1 left: a city driving on the
    // left drives from the right), and the motion it feels — heading rate, speed change, a jolt on impact
    this.driverSide = 1;
    this.taxi = { heading: null, yawRate: 0, speed: 0, accel: 0, jolt: 0, roll: 0, look: 0, pitch: 0, fov: 72, time: 0 };

    // The pilot's head (updateJetView): where it's aimed (headTarget, from the mouse), where it is, how fast it turns
    this.head = { yaw: 0, pitch: 0, vyaw: 0, vpitch: 0, target: { yaw: 0, pitch: 0 }, active: false, fresh: true };

    this.bindPointerControls();
  }

  /** Aim the pilot's head at the mouse at client (x, y) (only while looking from the cockpit: see updateJetView) */
  aimHead(x, y) {
    const w = window.innerWidth || 1, h = window.innerHeight || 1;
    headTarget((x / w) * 2 - 1, (y / h) * 2 - 1, this.head.target);
  }

  // the head turning towards where it's aimed as a head does: speeding up, then easing into place (a critically
  // damped spring); `snap`: there at once
  stepHead(dt, snap = false) {
    const head = this.head;
    if (snap) {
      head.yaw = head.target.yaw; head.pitch = head.target.pitch; head.vyaw = head.vpitch = 0;
      return;
    }
    const h = Math.min(dt, 0.05), w = HEAD.omega;
    head.vyaw += (w * w * (head.target.yaw - head.yaw) - 2 * w * head.vyaw) * h;
    head.vpitch += (w * w * (head.target.pitch - head.pitch) - 2 * w * head.vpitch) * h;
    head.yaw += head.vyaw * h;
    head.pitch += head.vpitch * h;
  }

  /** Eyes front: the mouse left the window, or the view changed */
  centreHead() {
    this.head.target.yaw = this.head.target.pitch = 0;
  }

  bindPointerControls() {
    const canvas = this.domElement;
    const pointers = new Map();
    canvas.style.touchAction = 'none';

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || pointers.size >= 2) return;
      // Only two touch pointers may share a gesture; mouse and pen drags stay independent.
      if (pointers.size && (e.pointerType !== 'touch' || pointers.values().next().value.type !== 'touch')) return;
      e.preventDefault();
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
      canvas.setPointerCapture(e.pointerId);
      this.isDragging = true;
      this.userOrbitTimer = 4.0;
    });

    canvas.addEventListener('pointermove', (e) => {
      // in the cockpit the mouse aims the pilot's head just by moving (dragging too, rather than orbiting)
      const headLook = this.head.active && e.pointerType === 'mouse';
      if (headLook) this.aimHead(e.clientX, e.clientY);
      const pointer = pointers.get(e.pointerId);
      if (!pointer) return;
      e.preventDefault();
      if (headLook) {
        pointer.x = e.clientX;
        pointer.y = e.clientY;
        return;
      }
      const dx = e.clientX - pointer.x;
      const dy = e.clientY - pointer.y;
      const pair = pointers.size === 2 ? [...pointers.values()] : null;
      const previousDistance = pair ? Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y) : 0;
      pointer.x = e.clientX;
      pointer.y = e.clientY;

      if (pair) {
        const distance = Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y);
        if (previousDistance > 1 && distance > 1) {
          this.zoomMultiplier = Math.max(0.45, Math.min(2.4, this.zoomMultiplier * previousDistance / distance));
        }
      } else {
        this.orbitYawOffset -= dx * 0.0065;
        this.orbitPitchOffset = Math.max(-0.32, Math.min(0.68, this.orbitPitchOffset + dy * 0.005));
      }
      this.userOrbitTimer = 4.0;
    });

    const releasePointer = (id) => {
      if (!pointers.delete(id)) return;
      this.isDragging = pointers.size > 0;
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      canvas.addEventListener(type, (e) => releasePointer(e.pointerId));
    }
    const clearPointers = () => {
      for (const id of pointers.keys()) releasePointer(id);
    };
    this._clearPointers = clearPointers;
    window.addEventListener('blur', clearPointers);
    // the mouse off the page (or the page in the background): the head comes back to eyes front
    document.addEventListener('mouseout', (e) => { if (!e.relatedTarget) this.centreHead(); });
    window.addEventListener('blur', () => this.centreHead());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) clearPointers();
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomMultiplier = Math.max(0.45, Math.min(2.4, this.zoomMultiplier + e.deltaY * 0.001));
    }, { passive: false });
  }

  setCameraPreset(presetId, snapImmediately = false) {
    const preset = CAMERA_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    this.activePresetId = preset.id;
    this.camera.fov = preset.fov;
    if (preset.id === 'taxi') this.taxi.heading = null;
    this.camera.updateProjectionMatrix();
    if (snapImmediately) {
      this.initialized = false;
    }
  }

  applyGamepadInput(lookX, lookY, zoom, dt) {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    if (this.activePresetId !== 'chase' && this.activePresetId !== 'pov' && this.activePresetId !== 'taxi') return;
    // POV uses the orbit angles, but only chase renders a zoomed camera distance.
    if (this.activePresetId !== 'chase') zoom = 0;
    if (!lookX && !lookY && !zoom) return;
    this.orbitYawOffset -= lookX * 2.0 * dt;
    this.orbitPitchOffset = Math.max(-0.32, Math.min(0.68, this.orbitPitchOffset + lookY * 1.25 * dt));
    this.zoomMultiplier = Math.max(0.45, Math.min(2.4, this.zoomMultiplier + zoom * 0.9 * dt));
    this.userOrbitTimer = 4.0;
  }

  resetOrbit() {
    this.orbitYawOffset = 0;
    this.orbitPitchOffset = 0.09;
    this.zoomMultiplier = 1;
    this.userOrbitTimer = 0;
  }

  resetForTeleport() {
    // Arrive with a fresh chase view, without carrying a previous drive or gesture into the destination.
    this._clearPointers();
    this.isDragging = false;
    this.resetOrbit();
    this.smoothedSpeed = 0;
    this.followEntity = null;
    this.followOffset.set(0, 0, 0);
    this.followLookOffset.set(0, 0, 0);
    this.followBaseY = 0;
    this.taxi.heading = null;
    this.setCameraPreset('chase', true);
  }

  getActivePreset() {
    return CAMERA_PRESETS.find((p) => p.id === this.activePresetId) || CAMERA_PRESETS[0];
  }

  onResize(width, height) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  update(dt, elapsed) {
    const entity = this.controllerManager.getActiveEntity();
    const desiredPos = this._desiredPos;
    const desiredLook = this._desiredLook;

    if (this.userOrbitTimer > 0 && !this.isDragging) {
      this.userOrbitTimer = Math.max(0, this.userOrbitTimer - dt);
    }

    if (!this.isDragging && this.userOrbitTimer <= 0 && Math.abs(entity.speed) > 0.5) {
      this.orbitYawOffset -= Math.round(this.orbitYawOffset / (Math.PI * 2)) * (Math.PI * 2);
      this.orbitYawOffset += (0.0 - this.orbitYawOffset) * (1 - Math.exp(-dt * 2.2));
    }

    // The follow cameras pull back with speed, eased so that they drift back as the entity speeds up (and in as it
    // slows down); speedLag is about how far their former world-space smoothing left them trailing at 60 FPS
    this.smoothedSpeed += (Math.abs(entity.speed) - this.smoothedSpeed) * (1 - Math.exp(-dt * 3.0));
    const speedLag = this.smoothedSpeed * 0.1;

    const totalYaw = entity.heading + this.orbitYawOffset;

    // The jet flies any attitude: its follow cameras ride in its frame (updateJetView)
    if (entity.type === 'jet' && this.getActivePreset().category === 'follow') {
      this.updateJetView(entity, dt);
      return;
    }
    if (this._jetView) {
      // back from the jet: upright again, at the preset's lens, the head no longer following the mouse
      this._jetView = false;
      this.head.active = false;
      this.centreHead();
      this.head.yaw = this.head.pitch = 0;
      this.camera.up.set(0, 1, 0);
      this.camera.fov = this.getActivePreset().fov;
      this.camera.updateProjectionMatrix();
      this.initialized = false;
    }
    // the Crazy Taxi cam is a head too: the mouse turns it as in the jet's cockpit
    const taxiHead = this.activePresetId === 'taxi';
    if (taxiHead !== this.head.active) {
      this.head.active = taxiHead;
      this.centreHead();
      this.head.fresh = true;
    }
    if (taxiHead) this.stepHead(dt, this.head.fresh || !(dt > 0));
    this.head.fresh = false;

    switch (this.activePresetId) {
      case 'chase': {
        const dist = entity.chaseDistance * this.zoomMultiplier * (1 + Math.min(0.25, this.smoothedSpeed * 0.01));
        const height = entity.chaseHeight * this.zoomMultiplier + Math.sin(this.orbitPitchOffset) * dist * 0.85;
        const horizDist = Math.cos(this.orbitPitchOffset) * dist + speedLag;

        desiredPos.set(
          entity.position.x - Math.sin(totalYaw) * horizDist,
          Math.max(0.65, entity.position.y + height),
          entity.position.z - Math.cos(totalYaw) * horizDist
        );

        const lookUpBias = entity.type === 'helicopter' ? 0.2 : (entity.type === 'car' ? 0.52 : 1.55);
        desiredLook.set(
          entity.position.x + Math.sin(entity.heading) * 5.2,
          entity.position.y + entity.cameraTargetOffset.y + lookUpBias,
          entity.position.z + Math.cos(entity.heading) * 5.2
        );
        break;
      }

      case 'action': {
        const sideOffset = entity.type === 'car' ? 2.65 : (entity.type === 'helicopter' ? 4.2 : 0.95);
        const backDist = (entity.type === 'car' ? 3.6 : (entity.type === 'helicopter' ? 8.5 : 2.8)) + speedLag;
        const lowY = entity.type === 'helicopter' ? entity.position.y + 1.2 : entity.position.y + 0.92;

        desiredPos.set(
          entity.position.x - Math.sin(entity.heading) * backDist + Math.cos(entity.heading) * sideOffset,
          Math.max(0.55, lowY),
          entity.position.z - Math.cos(entity.heading) * backDist - Math.sin(entity.heading) * sideOffset
        );
        desiredLook.set(
          entity.position.x + Math.sin(entity.heading) * 3.2,
          entity.position.y + 1.05,
          entity.position.z + Math.cos(entity.heading) * 3.2
        );
        break;
      }

      case 'pov': {
        let fwdOffset = 0.35;
        let eyeY = 1.68;
        if (entity.type === 'car') {
          fwdOffset = 0.55;
          eyeY = 1.52;
        } else if (entity.type === 'cyclist') {
          fwdOffset = 0.35;
          eyeY = 1.55;
        } else if (entity.type === 'helicopter') {
          fwdOffset = 1.65;
          eyeY = 1.65;
        }

        desiredPos.set(
          entity.position.x + Math.sin(entity.heading) * fwdOffset,
          entity.position.y + eyeY,
          entity.position.z + Math.cos(entity.heading) * fwdOffset
        );
        desiredLook.set(
          entity.position.x + Math.sin(totalYaw) * 40.0,
          entity.position.y + eyeY + Math.sin(-this.orbitPitchOffset) * 18.0 + 1.5,
          entity.position.z + Math.cos(totalYaw) * 40.0
        );
        break;
      }

      case 'taxi': {
        // From the driver's seat, behind the wheel, feeling the drive: the view swings into a turn ahead of the cab, the
        // horizon leans and the head is thrown back on the throttle and forward on the brakes, the lens widens with
        // speed, and the road buzzes under it and a hit jolts it
        const t = this.taxi;
        const car = entity.type === 'car';
        if (t.heading === null || !(dt > 0)) {
          t.heading = entity.heading;
          t.speed = entity.speed;
          t.yawRate = t.accel = t.jolt = t.roll = t.look = t.pitch = 0;
        }
        const k = 1 - Math.exp(-dt * 6);
        const yawRate = dt > 0 ? Math.atan2(Math.sin(entity.heading - t.heading), Math.cos(entity.heading - t.heading)) / dt : 0;
        const accel = dt > 0 ? (entity.speed - t.speed) / dt : 0;
        t.heading = entity.heading;
        // a sudden loss of speed no brake gives (> 12 m/s²): a crash
        if (accel < -12 && Math.abs(t.speed) > 4) t.jolt = Math.min(1, t.jolt + Math.min(1, -accel / 60));
        t.speed = entity.speed;
        t.yawRate += (yawRate - t.yawRate) * k;
        t.accel += (Math.max(-12, Math.min(12, accel)) - t.accel) * (1 - Math.exp(-dt * 4));
        t.jolt *= Math.exp(-dt * 5);
        t.time += dt;
        const v = Math.abs(entity.speed);
        // look into the turn, lean out of it, nod with the pedals
        t.look += (Math.max(-0.45, Math.min(0.45, t.yawRate * 0.32)) - t.look) * k;
        t.roll += (Math.max(-0.14, Math.min(0.14, -t.yawRate * v * 0.006)) - t.roll) * k;
        t.pitch += (Math.max(-0.06, Math.min(0.06, t.accel * 0.006)) - t.pitch) * k;
        // wider at speed, for the rush
        const fovTarget = 72 + Math.min(1, v / 34) * 24;
        t.fov += (fovTarget - t.fov) * (1 - Math.exp(-dt * 3));
        if (Math.abs(this.camera.fov - t.fov) > 0.05) {
          this.camera.fov = t.fov;
          this.camera.updateProjectionMatrix();
        }

        // the driver's head, turned about the neck: leaning a little out the way it looks
        const head = this.head;
        const side = (car ? 0.36 * this.driverSide : 0) - Math.sin(head.yaw) * 0.09;
        const fwd = car ? 0.05 : 0.35;
        const eyeY = car ? 1.32 : 1.6;
        const fx = Math.sin(entity.heading);
        const fz = Math.cos(entity.heading);
        // right of the heading: (-cos h, sin h)
        const rx = -fz;
        const rz = fx;
        // road buzz with speed, the jolt on top
        const buzz = Math.min(1, v / 30) * 0.012 + t.jolt * 0.09;
        const nx = (Math.sin(t.time * 37.1) + Math.sin(t.time * 23.7 + 1.3)) * 0.5 * buzz;
        const ny = (Math.sin(t.time * 41.3 + 0.7) + Math.sin(t.time * 29.9 + 2.1)) * 0.5 * buzz;
        // thrown back on the throttle, forward on the brakes
        const surge = -t.accel * 0.012;
        desiredPos.set(
          entity.position.x + fx * (fwd + surge) + rx * side + rx * nx,
          entity.position.y + eyeY + ny,
          entity.position.z + fz * (fwd + surge) + rz * side + rz * nx
        );
        // (looking well round, the turn into the bend fades: the head is busy elsewhere)
        const yaw = totalYaw + head.yaw + t.look * Math.max(0, 1 - Math.abs(head.yaw));
        const reach = 40.0 * Math.cos(head.pitch);
        desiredLook.set(
          desiredPos.x + Math.sin(yaw) * reach,
          desiredPos.y - 0.6 + Math.sin(-this.orbitPitchOffset + 0.09 + t.pitch + head.pitch) * 40.0,
          desiredPos.z + Math.cos(yaw) * reach
        );
        break;
      }

      case 'centralPark': {
        // Inside Central Park South looking across The Pond, Gapstow Bridge, The Mall, Sheep Meadow & UWS/UES Skylines
        const sway = Math.sin(elapsed * 0.22) * 3.5;
        desiredPos.set(-70.0 + sway, 14.0, -1425.0);
        desiredLook.set(-250.0, 6.5, -1690.0);
        break;
      }

      case 'fifthAve': {
        // 5th Avenue & 42nd St looking South down the 5th Ave canyon toward the Empire State Building
        const sway = Math.sin(elapsed * 0.25) * 1.8;
        desiredPos.set(0.0 + sway, 6.5, -20.0);
        desiredLook.set(-60.0, 150.0, 686.0);
        break;
      }

      case 'timesSquare': {
        // Times Square & Broadway looking across Duffy Square red steps and One Times Square billboards
        const sway = Math.sin(elapsed * 0.3) * 3.0;
        desiredPos.set(-603.0 + sway, 5.5, -290.0);
        desiredLook.set(-566.0, 40.0, -40.0);
        break;
      }

      case 'chryslerGCT': {
        // Park Ave & 42nd St intersection looking straight at Grand Central, MetLife, and Chrysler Building Crown
        const sway = Math.cos(elapsed * 0.22) * 2.5;
        desiredPos.set(300.0 + sway, 9.5, 95.0);
        desiredLook.set(470.0, 120.0, -50.0);
        break;
      }

      case 'observatory': {
        // Empire State Building 86th Floor Deck looking North-East across Midtown skyline
        const pan = Math.sin(elapsed * 0.18) * 80.0;
        desiredPos.set(-58.0, 322.0, 660.0);
        desiredLook.set(420.0 + pan, 150.0, -200.0);
        break;
      }

      case 'bryantPark': {
        // Inside Bryant Park Great Lawn looking East toward NYPL portico, One Vanderbilt & Chrysler Building
        const sway = Math.sin(elapsed * 0.25) * 1.5;
        const lawn = bryantParkLawn || { minX: -260, maxX: -150, minZ: 40, maxZ: 120, top: 1.3 };
        const lz = (lawn.minZ + lawn.maxZ) * 0.5;
        desiredPos.set(lawn.minX + 18.0, lawn.top + 1.7, lz + sway);
        desiredLook.set(lawn.maxX + 260.0, 70.0, lz - 60.0);
        break;
      }

      case 'waterfront': {
        // Over the shimmering East River looking across the FDR Drive, Queensboro Bridge & Midtown Skyline
        const drift = Math.sin(elapsed * 0.15) * 40.0;
        desiredPos.set(1640.0, 60.0, 60.0 + drift);
        desiredLook.set(150.0, 150.0, -150.0);
        break;
      }

      case 'drone': {
        const angle = elapsed * 0.07 + 0.65;
        const radius = 720.0 + Math.sin(elapsed * 0.23) * 140.0;
        const alt = 330.0 + Math.cos(elapsed * 0.19) * 90.0;
        desiredPos.set(
          Math.cos(angle) * radius + 60.0,
          alt,
          Math.sin(angle) * radius + 250.0
        );
        desiredLook.set(60.0, 160.0, 250.0);
        break;
      }
    }

    if (!this.initialized || this.activePresetId === 'pov' || this.activePresetId === 'taxi') {
      this.currentPos.copy(desiredPos);
      this.currentLookAt.copy(desiredLook);
      this.initialized = true;
      this.followEntity = null; // the follow cameras re-anchor from here
    } else if (this.activePresetId === 'chase' || this.activePresetId === 'action') {
      // Smoothed in the followed entity's frame rather than in world space. A world-space follower trails a moving
      // target by a distance that depends on the frame time (about speed x dt), so with uneven frame times the camera
      // surged back and forth behind an accelerating or fast car. Relative to the entity a steady drive keeps the
      // camera steady, while turns, orbit drags, zoom & the speed pull-back are still eased. The entity's height is
      // eased in world space (curbs, park lawns, jumps, the helicopter climbing).
      if (this.followEntity !== entity) {
        // preset or mode switch: start from where the camera is and glide over to the new framing
        this.followEntity = entity;
        this.followBaseY = entity.position.y;
        this.followOffset.subVectors(this.currentPos, entity.position);
        this.followLookOffset.subVectors(this.currentLookAt, entity.position);
      }
      const k = 1 - Math.exp(-dt * 8.5);
      this.followBaseY += (entity.position.y - this.followBaseY) * k;
      this.followOffset.lerp(desiredPos.sub(entity.position), k);
      this.followLookOffset.lerp(desiredLook.sub(entity.position), k);
      this.currentPos.set(entity.position.x, this.followBaseY, entity.position.z).add(this.followOffset);
      this.currentLookAt.set(entity.position.x, this.followBaseY, entity.position.z).add(this.followLookOffset);
      this.currentPos.y = Math.max(0.55, this.currentPos.y);
    } else {
      this.followEntity = null;
      const k = 1 - Math.exp(-dt * 8.5);
      this.currentPos.lerp(desiredPos, k);
      this.currentLookAt.lerp(desiredLook, k);
    }

    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLookAt);
    // the cockpit's lean (rolled about the view axis)
    if (this.activePresetId === 'taxi' && this.taxi.roll && this.camera.rotateZ) this.camera.rotateZ(this.taxi.roll);
  }

  // The jet's cameras, in its frame (body: forward +z, up +y, left +x; js/jet-flight.js):
  // - chase: behind and above it, the frame following its attitude a little late, so a roll or a pull swings the view
  //   and the horizon tilts most of the way with it; the lens widens with speed
  // - action: the wingman's view, off its left wing, a little behind
  // - pov / taxi: the front seat, under the canopy, looking where it points (the HUD, js/jet-hud.js, over it)
  updateJetView(entity, dt) {
    const s = entity.flight;
    const cam = this.camera;
    const q = this._jq ??= new THREE.Quaternion();
    const qs = this._jqs ??= new THREE.Quaternion();
    const look = this._jlook ??= new THREE.Quaternion();
    const axis = this._jaxis ??= new THREE.Vector3();
    const v = this._jv ??= new THREE.Vector3();
    const up = this._jup ??= new THREE.Vector3();
    q.set(s.q[0], s.q[1], s.q[2], s.q[3]);
    const fresh = !this._jetView || this.followEntity !== entity || !this.initialized || !(dt > 0);
    this._jetView = true;
    this.followEntity = entity;
    this.initialized = true;
    if (fresh) qs.copy(q);
    else qs.slerp(q, 1 - Math.exp(-dt * 3.2));
    const p = entity.position;
    const preset = this.activePresetId;
    const cockpit = preset === 'pov' || preset === 'taxi';
    const head = this.head;
    if (cockpit !== head.active) {
      head.active = cockpit;
      if (!cockpit) this.centreHead();
    }
    // the pilot's head, turning towards where it's aimed (stepHead)
    let yaw = 0, pitch = 0;
    if (cockpit) {
      this.stepHead(dt, fresh);
      // pulling g sags the head a little
      yaw = head.yaw;
      pitch = head.pitch - Math.max(-0.03, Math.min(0.06, ((s.g || 1) - 1) * 0.008));
    }
    // the look: the head (cockpit), and the user's orbit (drag, right stick) on top: about the jet's up, then across
    look.setFromAxisAngle(axis.set(0, 1, 0), this.orbitYawOffset + yaw);
    look.multiply((this._jpitch ??= new THREE.Quaternion()).setFromAxisAngle(axis.set(1, 0, 0), this.orbitPitchOffset - 0.09 - pitch));

    let fov = this.getActivePreset().fov;
    if (cockpit) {
      // the front seat: the eyes turn about the neck (8 cm under and 9 cm behind them), over the glareshield and
      // level with the HUD's combiner looking ahead; looking well round, the shoulders turn and lean that way too
      const neck = this._jneck ??= new THREE.Vector3();
      neck.set(0, 1.06, 4.06);
      const sy = Math.sin(yaw);
      neck.x += sy * 0.11 * Math.min(1, Math.abs(yaw) / 1.2);
      neck.z -= Math.abs(sy) * 0.04;
      neck.y -= Math.max(0, Math.min(0.05, ((s.g || 1) - 1) * 0.006));
      v.set(0, 0.08, 0.09).applyQuaternion(look).add(neck);
      this.currentPos.copy(v).applyQuaternion(q).add(p);
      cam.position.copy(this.currentPos);
      // the camera looks down its -z: turned round to the jet's +z, then the look about
      cam.quaternion.copy(q).multiply(look).multiply(this._jflip ??= new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
      this.currentLookAt.set(0, 1.14, 60).applyQuaternion(q).add(p);
      fov = 74;
    } else {
      const frame = this._jframe ??= new THREE.Quaternion();
      frame.copy(qs).multiply(look);
      if (preset === 'action') {
        v.set(15, 1.2, -12);
      } else {
        const dist = entity.chaseDistance * this.zoomMultiplier + Math.min(10, this.smoothedSpeed * 0.02);
        v.set(0, entity.chaseHeight * this.zoomMultiplier, -dist);
      }
      this.currentPos.copy(v.applyQuaternion(frame)).add(p);
      // (looking past the jet, from wherever the orbit has put the camera)
      this.currentLookAt.set(0, 1.6, preset === 'action' ? 6 : 20).applyQuaternion(frame).add(p);
      // never under the ground (on the runway: the camera rides up instead)
      this.currentPos.y = Math.max(1.2, this.currentPos.y);
      // the horizon leans most of the way with the jet's bank
      up.set(0, 1, 0).applyQuaternion(qs).lerp(axis.set(0, 1, 0), 0.25).normalize();
      cam.up.copy(up);
      cam.position.copy(this.currentPos);
      cam.lookAt(this.currentLookAt);
      fov += Math.min(16, Math.max(0, (Math.abs(entity.speed) - 60) * 0.05));
    }
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * (fresh ? 1 : 1 - Math.exp(-dt * 3));
      cam.updateProjectionMatrix();
    }
  }
}

export { CAMERA_PRESETS, CameraSystem, headTarget, HEAD };
