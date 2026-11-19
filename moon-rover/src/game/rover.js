/* ============================================================
   MU-7 "CASSIOPEIA" — survey rover
   ------------------------------------------------------------
   900 kg, six-wheel drive, rocker-bogie suspension, 1.62 m/s².
   Physics: a proper rigid body (quaternion + inertia tensor) with a
   raycast wheel at each corner, slip-based tyre forces inside a
   friction circle, and sinkage-dependent rolling resistance because
   regolith is not asphalt — it is 40 % void, and it eats momentum.
   ============================================================ */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, sstep, lerp, makeRNG } from '../core/rng.js';
import { MOON_G } from '../world/terrain.js';

/* ---------------- chassis constants ---------------- */
const MASS = 900;
const WHEEL_R = 0.335, WHEEL_W = 0.30;
const HALF_TRACK = 0.80;                    // lateral wheel offset
const AXLE_Z = [1.24, 0.0, -1.20];          // fore / mid / aft
const SUSP_REST = 0.46, SUSP_TRAVEL = 0.36;
// Sized for lunar weight: 1458 N total, 243 N per corner, ~0.09 m static sag.
// Earth-car spring rates here would make the suspension act like a steel bar.
const SUSP_K = 2700, SUSP_C = 1250;
const MOTOR_TORQUE = 118;                   // N·m at the hub — just past the traction limit
/* Hub authority as a function of pack charge: full torque above 25 %, then a
   linear fade to 0.18 at empty.

   The knee has to sit well above the point where you would *think* it should.
   MOTOR_TORQUE is deliberately just past the traction limit — 6 x 118/0.335 =
   2113 N of hub force against a ~1250 N friction ceiling — so scaling torque
   changes nothing on the flat until it drops below ~0.59. Anything gentler than
   this and a flat pack is invisible on level ground; the effect shows up on
   grades first, which is the right order.

   The floor exists so a dead pack never strands you: 0.18 still crawls, which
   is enough to reach sunlight and let the array recover. */
export const POWER_FLOOR = 0.18, POWER_KNEE = 25;
const BRAKE_TORQUE = 300;
/* The drive envelope. Mutable, because REALISTIC MODE swaps maxSpeed for a real
   rover's — and because every speed threshold below is written as a FRACTION of
   it rather than an absolute m/s. That matters: those thresholds used to be
   literals tuned to 8.4, so halving the top speed silently stopped the steering
   from loading up, the camera from dollying and the motor from ever sounding
   worked. Nothing errored; the rover just felt dead. */
export const DRIVE = {
  maxSpeed: 8.4,      // m/s ≈ 30 km/h — recklessly fast for a rover
  commsDelay: 0,      // s, round trip. 0 = local control, 2.56 = driven from Earth
};

/* Earth–Moon round trip at the mean distance: 2 × 384 400 km / c = 2.564 s.
   It swings 2.42–2.71 s over a month; the mean is close enough that modelling
   the libration would be precision nobody can feel. */
export const EARTH_RTT = 2.564;
const WHEEL_I = 1.2;                        // kg·m² per wheel
const MU_BASE = 0.88;                       // grousers bite; still well under asphalt
const K_SLIP = 5200, K_LAT = 6400;          // tyre stiffnesses, N per m/s of slip
const YAW_ASSIST = 2600;                    // N*m of steering authority from the CMGs
/* arm: shoulder->elbow, elbow->bit tip, and the reach envelope it can service */
const ARM_L1 = 0.72, ARM_L2 = 1.115;
const ARM_REACH_MIN = 0.55, ARM_REACH_MAX = 1.62;
const ARM_YAW_MAX = 0.95;                   // ±54° of swing about the shoulder
const ARM_BASE = { x: 0, y: 0.36, z: 1.02 };

/* ============================================================
   procedural materials
   ============================================================ */
function crinkleNormal(size = 256, scale = 9, strength = 1.0) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const h = new Float32Array(size * size);
  const rng = makeRNG(7717);
  const grid = [];
  for (let i = 0; i < (scale + 1) * (scale + 1); i++) grid.push(rng());
  const at = (x, y) => grid[(((y % scale) + scale) % scale) * (scale + 1) + (((x % scale) + scale) % scale)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size * scale, v = y / size * scale;
    const ix = Math.floor(u), iy = Math.floor(v);
    let fx = u - ix, fy = v - iy;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = at(ix, iy), b = at(ix + 1, iy), cc = at(ix, iy + 1), d = at(ix + 1, iy + 1);
    let n = a + (b - a) * fx + (cc - a) * fy + (a - b - cc + d) * fx * fy;
    // sharp creases: fold the field so the foil reads as crumpled, not lumpy
    n = Math.abs(n * 2 - 1);
    n += 0.35 * Math.abs(Math.sin(x * 0.42 + n * 6.0) * Math.sin(y * 0.31 + n * 5.0));
    h[y * size + x] = n;
  }
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const hl = h[y * size + ((x - 1 + size) % size)], hr = h[y * size + ((x + 1) % size)];
    const hu = h[((y - 1 + size) % size) * size + x], hd = h[((y + 1) % size) * size + x];
    const nx = (hl - hr) * strength, ny = (hu - hd) * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz);
    const o = i * 4;
    img.data[o] = (nx / l * 0.5 + 0.5) * 255;
    img.data[o + 1] = (ny / l * 0.5 + 0.5) * 255;
    img.data[o + 2] = (nz / l * 0.5 + 0.5) * 255;
    img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function solarCellTexture(size = 512) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#0a1230'; g.fillRect(0, 0, size, size);
  const cols = 8, rows = 12;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = i / cols * size, y = j / rows * size;
    const w = size / cols, h = size / rows;
    g.fillStyle = '#12275c'; g.fillRect(x + 1.5, y + 1.5, w - 3, h - 3);
    g.fillStyle = 'rgba(90,150,255,.10)';
    g.fillRect(x + 1.5, y + 1.5, w - 3, (h - 3) * 0.42);
    // bus bars
    g.strokeStyle = 'rgba(190,205,230,.45)'; g.lineWidth = 1.1;
    for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(x + w * k / 4, y + 2); g.lineTo(x + w * k / 4, y + h - 2); g.stroke(); }
  }
  g.strokeStyle = 'rgba(150,170,200,.30)'; g.lineWidth = 2;
  g.strokeRect(1, 1, size - 2, size - 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function panelTexture(size = 512) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#d9d5cb'; g.fillRect(0, 0, size, size);
  // subtle dirt / regolith staining
  const rng = makeRNG(4242);
  for (let i = 0; i < 900; i++) {
    const x = rng() * size, y = rng() * size, r = 2 + rng() * 26;
    g.fillStyle = `rgba(120,110,96,${0.012 + rng() * 0.035})`;
    g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
  }
  // panel seams + fasteners
  g.strokeStyle = 'rgba(60,58,54,.32)'; g.lineWidth = 2;
  for (let i = 1; i < 4; i++) {
    g.beginPath(); g.moveTo(0, i * size / 4); g.lineTo(size, i * size / 4); g.stroke();
    g.beginPath(); g.moveTo(i * size / 4, 0); g.lineTo(i * size / 4, size); g.stroke();
  }
  g.fillStyle = 'rgba(50,48,44,.45)';
  for (let j = 0; j <= 4; j++) for (let i = 0; i <= 4; i++) {
    g.beginPath(); g.arc(i * size / 4, j * size / 4, 3.2, 0, 6.2832); g.fill();
  }
  // markings
  g.fillStyle = '#2a2824';
  g.font = `600 ${Math.round(size * 0.052)}px ui-monospace, monospace`;
  g.fillText('MU-7 · CASSIOPEIA', size * 0.06, size * 0.16);
  g.font = `500 ${Math.round(size * 0.034)}px ui-monospace, monospace`;
  g.fillStyle = '#5a564e';
  g.fillText('SELENE DIRECTORATE', size * 0.06, size * 0.235);
  g.fillText('FAR-SIDE SURVEY DIV.', size * 0.06, size * 0.29);
  g.strokeStyle = '#b4472a'; g.lineWidth = 4;
  g.strokeRect(size * 0.06, size * 0.66, size * 0.30, size * 0.16);
  g.fillStyle = '#b4472a';
  g.font = `700 ${Math.round(size * 0.045)}px ui-monospace, monospace`;
  g.fillText('NO STEP', size * 0.085, size * 0.765);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/* rounded box via SDF projection — soft industrial edges catch the sun */
function roundedBox(sx, sy, sz, r, seg = 5) {
  const g = new THREE.BoxGeometry(sx, sy, sz, seg, seg, seg);
  const p = g.attributes.position;
  const hx = sx / 2 - r, hy = sy / 2 - r, hz = sz / 2 - r;
  const v = new THREE.Vector3(), q = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    q.set(clamp(v.x, -hx, hx), clamp(v.y, -hy, hy), clamp(v.z, -hz, hz));
    const d = v.clone().sub(q);
    if (d.lengthSq() > 1e-9) d.normalize().multiplyScalar(r); else d.set(0, 0, 0);
    p.setXYZ(i, q.x + d.x, q.y + d.y, q.z + d.z);
  }
  g.computeVertexNormals();
  return g;
}

function buildWheelGeometry() {
  const parts = [];
  const rim = new THREE.CylinderGeometry(WHEEL_R * 0.985, WHEEL_R * 0.985, WHEEL_W, 30, 1, true);
  rim.rotateZ(Math.PI / 2); parts.push(rim);
  for (const s of [-1, 1]) {
    const disc = new THREE.CircleGeometry(WHEEL_R * 0.985, 30);
    disc.rotateY(s * Math.PI / 2);
    disc.translate(s * WHEEL_W / 2, 0, 0);
    parts.push(disc);
    const hub = new THREE.CylinderGeometry(0.085, 0.085, 0.10, 14);
    hub.rotateZ(Math.PI / 2); hub.translate(s * (WHEEL_W / 2 + 0.03), 0, 0);
    parts.push(hub);
  }
  // grousers: chevron cleats, the reason a rover moves at all in loose regolith
  const N = 22;
  for (let i = 0; i < N; i++) {
    const a = i / N * Math.PI * 2;
    for (const half of [-1, 1]) {
      const cleat = new THREE.BoxGeometry(WHEEL_W * 0.44, 0.034, 0.072);
      cleat.translate(0, WHEEL_R + 0.010, 0);
      cleat.applyMatrix4(new THREE.Matrix4().makeRotationY(half * 0.34));   // the chevron half-angle
      cleat.applyMatrix4(new THREE.Matrix4().makeTranslation(half * WHEEL_W * 0.25, 0, 0));
      cleat.applyMatrix4(new THREE.Matrix4().makeRotationX(a + half * 0.07));
      parts.push(cleat);
    }
  }
  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  return g;
}

/* ============================================================
   ROVER
   ============================================================ */
export class Rover {
  constructor(terrain, scene) {
    this.terrain = terrain;
    this.root = new THREE.Group();
    scene.add(this.root);

    /* ---- rigid body state ---- */
    this.pos = new THREE.Vector3(0, 0, 0);
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.omega = new THREE.Vector3();
    this.mass = MASS;
    // box inertia, 1.7 × 0.8 × 2.7 m
    const Ix = MASS / 12 * (0.8 * 0.8 + 2.7 * 2.7);
    const Iy = MASS / 12 * (1.7 * 1.7 + 2.7 * 2.7);
    const Iz = MASS / 12 * (1.7 * 1.7 + 0.8 * 0.8);
    this.Ibody = new THREE.Vector3(Ix, Iy, Iz);

    /* ---- wheels ---- */
    this.wheels = [];
    for (let a = 0; a < 3; a++) for (const s of [-1, 1]) {
      this.wheels.push({
        mount: new THREE.Vector3(s * HALF_TRACK, 0.10, AXLE_Z[a]),
        side: s, axle: a,
        steer: 0, targetSteer: 0,
        spin: 0, spinVel: 0,
        comp: 0, compVel: 0,
        contact: false, normal: new THREE.Vector3(0, 1, 0),
        worldPos: new THREE.Vector3(), lastGround: new THREE.Vector3(),
        slipLong: 0, slipLat: 0, load: 0, sink: 0,
        obj: null, hub: null
      });
    }

    /* ---- control state ---- */
    this.throttle = 0; this.brake = 0; this.steerInput = 0;
    this.headlights = false; this.lampPower = 0;
    this.powerScale = 1;                     // set from gameplay each frame
    this.mastYaw = 0; this.mastPitch = 0;
    this.armDeploy = 0; this.drillSpin = 0; this.drilling = false;
    // operator-aimed arm: swing about the shoulder, reach along it, and the drop
    // to the ground solved every frame from the terrain under the aim point
    this.armOut = 0; this.armYaw = 0; this.armReach = 1.15; this.armDrop = -0.95;
    this.armTarget = new THREE.Vector3();
    this.panelDeploy = 0; this.panelTarget = 0;
    this.airborne = false; this.airTime = 0;
    this.hardHit = 0;
    this.odo = 0;
    this.motorLoad = 0;
    this.sunVis = 1;

    this.build();
  }

  /* ============================================================
     the machine
     ============================================================ */
  build() {
    const foilNormal = crinkleNormal(256, 8, 2.4);
    foilNormal.repeat.set(2, 2);
    this.tex = { foilNormal, solar: solarCellTexture(), panel: panelTexture() };

    const M = this.mats = {
      gold: new THREE.MeshPhysicalMaterial({
        color: 0xffc36b, metalness: 1.0, roughness: 0.34, envMapIntensity: 1.35,
        normalMap: foilNormal, normalScale: new THREE.Vector2(1.5, 1.5),
        clearcoat: 0.25, clearcoatRoughness: 0.5
      }),
      white: new THREE.MeshStandardMaterial({
        color: 0xb6b1a6, metalness: 0.05, roughness: 0.82, envMapIntensity: 0.8
      }),
      plate: new THREE.MeshStandardMaterial({
        map: this.tex.panel, color: 0xa9a49a, metalness: 0.08, roughness: 0.78, envMapIntensity: 0.7
      }),
      alu: new THREE.MeshStandardMaterial({ color: 0x8b8982, metalness: 0.88, roughness: 0.46, envMapIntensity: 1.0 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x25262a, metalness: 0.55, roughness: 0.62 }),
      black: new THREE.MeshStandardMaterial({ color: 0x111114, metalness: 0.30, roughness: 0.85 }),
      tyre: new THREE.MeshStandardMaterial({ color: 0x5c5a55, metalness: 0.72, roughness: 0.58, envMapIntensity: 0.75 }),
      solar: new THREE.MeshPhysicalMaterial({
        map: this.tex.solar, metalness: 0.42, roughness: 0.16, envMapIntensity: 1.6,
        clearcoat: 1.0, clearcoatRoughness: 0.06, color: 0xffffff
      }),
      glass: new THREE.MeshPhysicalMaterial({
        color: 0x0c1418, metalness: 0.1, roughness: 0.05, transmission: 0.0,
        clearcoat: 1.0, clearcoatRoughness: 0.02, envMapIntensity: 2.4
      }),
      emitC: new THREE.MeshBasicMaterial({ color: 0x66e6ff }),
      emitA: new THREE.MeshBasicMaterial({ color: 0xffa33a }),
      emitG: new THREE.MeshBasicMaterial({ color: 0x7dff92 }),
      emitR: new THREE.MeshBasicMaterial({ color: 0xff4436 }),
      lamp: new THREE.MeshBasicMaterial({ color: 0xfff2e0 })
    };

    const body = this.body = new THREE.Group();
    this.root.add(body);

    /* ---- warm electronics box ---- */
    const web = new THREE.Mesh(roundedBox(1.34, 0.62, 2.02, 0.075), M.gold);
    web.position.set(0, 0.50, 0.03);
    web.castShadow = web.receiveShadow = true;
    body.add(web);

    // radiator deck
    const deck = new THREE.Mesh(roundedBox(1.16, 0.07, 1.72, 0.02), M.white);
    deck.position.set(0, 0.835, 0.03);
    deck.castShadow = deck.receiveShadow = true;
    body.add(deck);
    for (let i = 0; i < 11; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(1.10, 0.028, 0.035), M.alu);
      fin.position.set(0, 0.872, -0.78 + i * 0.156);
      fin.castShadow = true; body.add(fin);
    }

    // identity plate on each flank — the only place the name is written
    for (const s of [-1, 1]) {
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.28, 0.42), M.plate);
      plate.position.set(s * 0.681, 0.52, 0.03);
      plate.rotation.y = s * Math.PI / 2;
      body.add(plate);
    }

    // belly frame
    const frame = new THREE.Mesh(roundedBox(1.18, 0.10, 2.20, 0.03), M.dark);
    frame.position.set(0, 0.175, 0.0); body.add(frame);
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.30, 2.30), M.alu);
      rail.position.set(s * 0.60, 0.32, 0.0); rail.castShadow = true; body.add(rail);
    }

    /* ---- GPR array slung under the belly ---- */
    const gpr = new THREE.Group(); gpr.position.set(0, 0.115, 0.30);
    const gprBox = new THREE.Mesh(roundedBox(0.92, 0.09, 0.62, 0.02), M.black);
    gpr.add(gprBox);
    for (let i = 0; i < 4; i++) {
      const el = new THREE.Mesh(new THREE.BoxGeometry(0.80, 0.012, 0.045), M.alu);
      el.position.set(0, -0.055, -0.20 + i * 0.135); gpr.add(el);
    }
    this.gprGlow = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), new THREE.MeshBasicMaterial({
      color: 0x39d0ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    this.gprGlow.rotation.x = -Math.PI / 2; this.gprGlow.position.y = -0.062;
    gpr.add(this.gprGlow);
    body.add(gpr);

    /* ---- RTG: the thing that keeps it alive through the night ---- */
    const rtg = new THREE.Group(); rtg.position.set(0, 0.72, -1.14); rtg.rotation.x = -0.34;
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.145, 0.62, 20), M.alu);
    core.rotation.x = Math.PI / 2; core.castShadow = true; rtg.add(core);
    for (let i = 0; i < 8; i++) {
      const holder = new THREE.Group(); holder.rotation.z = i / 8 * Math.PI * 2;
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.19, 0.58), M.alu);
      fin.position.y = 0.235; fin.castShadow = true; holder.add(fin); rtg.add(holder);
    }
    const rtgGlow = new THREE.Mesh(new THREE.CylinderGeometry(0.152, 0.152, 0.50, 20),
      new THREE.MeshBasicMaterial({ color: 0xff5a1e, transparent: true, opacity: 0.10, blending: THREE.AdditiveBlending, depthWrite: false }));
    rtgGlow.rotation.x = Math.PI / 2; rtg.add(rtgGlow);
    this.rtgGlow = rtgGlow;
    body.add(rtg);

    /* ---- deployable solar wing: stows upright over the tail, folds down aft ---- */
    this.panelPivot = new THREE.Group();
    this.panelPivot.position.set(0, 0.90, -0.96);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(2.30, 0.020, 1.20), M.solar);
    wing.position.set(0, 0, -0.64); wing.castShadow = wing.receiveShadow = true;
    this.panelPivot.add(wing);
    const wingFrame = new THREE.Mesh(roundedBox(2.36, 0.034, 1.26, 0.012), M.alu);
    wingFrame.position.set(0, -0.016, -0.64); this.panelPivot.add(wingFrame);
    const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 2.3, 8), M.alu);
    hinge.rotation.z = Math.PI / 2; this.panelPivot.add(hinge);
    body.add(this.panelPivot);

    /* ---- mast + camera head ---- */
    this.mast = new THREE.Group(); this.mast.position.set(0.38, 0.83, 0.72);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 1.16, 12), M.alu);
    post.position.y = 0.58; post.castShadow = true; this.mast.add(post);
    this.head = new THREE.Group(); this.head.position.y = 1.20;
    const headBox = new THREE.Mesh(roundedBox(0.44, 0.17, 0.20, 0.035), M.white);
    headBox.castShadow = true; this.head.add(headBox);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.052, 0.085, 16), M.dark);
      eye.rotation.x = Math.PI / 2; eye.position.set(s * 0.135, 0.005, 0.13); this.head.add(eye);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.040, 20), M.glass);
      lens.position.set(s * 0.135, 0.005, 0.174); this.head.add(lens);
    }
    const spectro = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.075, 0.13), M.black);
    spectro.position.set(0, 0.005, 0.115); this.head.add(spectro);
    this.mast.add(this.head);
    body.add(this.mast);

    /* ---- high-gain antenna ---- */
    this.antenna = new THREE.Group(); this.antenna.position.set(-0.44, 0.86, -0.42);
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.032, 0.34, 10), M.alu);
    stalk.position.y = 0.17; this.antenna.add(stalk);
    const dishPts = [];
    for (let i = 0; i <= 14; i++) { const t = i / 14, r = t * 0.34; dishPts.push(new THREE.Vector2(r, r * r * 2.1)); }
    dishPts.push(new THREE.Vector2(0.34, 0.34 * 0.34 * 2.1 + 0.035));   // a real rim lip
    const dish = new THREE.Mesh(new THREE.LatheGeometry(dishPts, 30), new THREE.MeshStandardMaterial({
      color: 0xa8a49a, metalness: 0.18, roughness: 0.66, side: THREE.DoubleSide, envMapIntensity: 0.55
    }));
    this.dish = new THREE.Group(); this.dish.position.y = 0.36; this.dish.rotation.x = -0.9;
    dish.castShadow = true; this.dish.add(dish);
    const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.16, 8), M.dark);
    feed.position.y = 0.13; this.dish.add(feed);
    this.antenna.add(this.dish);
    body.add(this.antenna);

    // whip antenna
    const whip = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.004, 0.95, 6), M.alu);
    whip.position.set(0.52, 1.28, -0.86); whip.rotation.z = 0.14; body.add(whip);
    const whipTip = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), M.emitR);
    whipTip.position.set(0.59, 1.76, -0.86); body.add(whipTip);
    this.beacon = whipTip;

    /* ---- robotic arm + drill turret ---- */
    this.arm = new THREE.Group(); this.arm.position.set(0, 0.36, 1.02);
    const shoulder = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.20, 14), M.alu);
    shoulder.rotation.z = Math.PI / 2; this.arm.add(shoulder);
    this.armA = new THREE.Group(); this.arm.add(this.armA);
    const seg1 = new THREE.Mesh(roundedBox(0.11, 0.11, 0.72, 0.028), M.white);
    seg1.position.z = 0.36; seg1.castShadow = true; this.armA.add(seg1);
    this.armB = new THREE.Group(); this.armB.position.z = 0.72; this.armA.add(this.armB);
    const elbow = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.16, 12), M.alu);
    elbow.rotation.z = Math.PI / 2; this.armB.add(elbow);
    const seg2 = new THREE.Mesh(roundedBox(0.09, 0.09, 0.60, 0.024), M.white);
    seg2.position.z = 0.30; seg2.castShadow = true; this.armB.add(seg2);
    this.turret = new THREE.Group(); this.turret.position.z = 0.62; this.armB.add(this.turret);
    const turretBody = new THREE.Mesh(roundedBox(0.20, 0.20, 0.22, 0.04), M.dark);
    turretBody.castShadow = true; this.turret.add(turretBody);
    this.drill = new THREE.Group(); this.drill.position.z = 0.12; this.turret.add(this.drill);
    const bit = new THREE.Mesh(new THREE.CylinderGeometry(0.030, 0.042, 0.34, 10), M.alu);
    bit.rotation.x = Math.PI / 2; bit.position.z = 0.17; this.drill.add(bit);
    for (let i = 0; i < 3; i++) {
      const hold = new THREE.Group(); hold.rotation.z = i / 3 * Math.PI * 2;
      const fl = new THREE.Mesh(new THREE.BoxGeometry(0.010, 0.055, 0.28), M.alu);
      fl.position.set(0, 0.042, 0.17); hold.add(fl); this.drill.add(hold);
    }
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.030, 0.09, 10), M.emitA);
    tip.rotation.x = Math.PI / 2; tip.position.z = 0.375; this.drill.add(tip);
    this.drillTip = tip;
    body.add(this.arm);

    /* ---- headlamps ---- */
    this.lamps = [];
    for (const s of [-1, 1]) {
      const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.09, 14), M.dark);
      housing.rotation.x = Math.PI / 2; housing.position.set(s * 0.46, 0.62, 1.05); body.add(housing);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.050, 18), M.lamp);
      lens.position.set(s * 0.46, 0.62, 1.098); body.add(lens);
      this.lamps.push(lens);
    }
    // status LEDs
    this.leds = [];
    for (let i = 0; i < 4; i++) {
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6),
        [M.emitG, M.emitC, M.emitA, M.emitC][i]);
      led.position.set(-0.30 + i * 0.20, 0.845, 0.96); body.add(led); this.leds.push(led);
    }

    /* ---- rocker-bogie linkage + wheels ---- */
    const wheelGeo = buildWheelGeometry();
    for (const w of this.wheels) {
      const g = new THREE.Group();
      const mesh = new THREE.Mesh(wheelGeo, M.tyre);
      mesh.castShadow = true; mesh.receiveShadow = true;
      g.add(mesh);
      w.obj = g; w.hub = mesh;
      body.add(g);
      const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.14, 12), M.dark);
      motor.rotation.z = Math.PI / 2;
      w.motor = motor; g.add(motor);
    }

    /* ---- the linkage that actually holds the wheels on ----
       A rocker per side pinned to the chassis at the differential, carrying the
       front wheel on one arm and a bogie on the other; the bogie carries the
       middle and rear wheels. Every member is re-drawn each frame between the
       real joint positions, so the wheels stay visibly attached however far the
       suspension travels — which is the whole point of drawing it at all. */
    this.links = [];
    const member = (thick) => {
      const m = new THREE.Mesh(roundedBox(thick, thick, 1.0, thick * 0.4), M.alu);
      m.castShadow = true; body.add(m); return m;
    };
    for (const side of [-1, 1]) {
      const pivot = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.16, 14), M.dark);
      pivot.rotation.z = Math.PI / 2;
      pivot.position.set(side * 0.615, 0.44, 0.16);
      body.add(pivot);
      const bogiePin = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.14, 12), M.dark);
      bogiePin.rotation.z = Math.PI / 2;
      body.add(bogiePin);
      this.links.push({
        side,
        anchor: new THREE.Vector3(side * 0.70, 0.44, 0.16),
        pivot, bogiePin,
        rocker: member(0.085),      // differential pivot -> front wheel
        strut: member(0.075),       // differential pivot -> bogie pin
        bogieF: member(0.065),      // bogie pin -> middle wheel
        bogieR: member(0.065),      // bogie pin -> rear wheel
        stub: member(0.070)         // chassis flank -> differential pivot
      });
    }

    /* ---- aiming reticle, parented to the scene so it lies flat on the ground ---- */
    const ret = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.30, 0.36, 32),
      new THREE.MeshBasicMaterial({ color: 0x6fe3f5, transparent: true, opacity: 0.85,
        side: THREE.DoubleSide, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
    ring.rotation.x = -Math.PI / 2; ret.add(ring);
    for (let i = 0; i < 4; i++) {
      const tick = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.035),
        new THREE.MeshBasicMaterial({ color: 0x6fe3f5, transparent: true, opacity: 0.9,
          depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
      tick.rotation.x = -Math.PI / 2; tick.rotation.z = i * Math.PI / 2;
      tick.position.set(Math.cos(i * Math.PI / 2) * 0.50, 0, Math.sin(i * Math.PI / 2) * 0.50);
      ret.add(tick);
    }
    ret.renderOrder = 30; ret.visible = false;
    this.reticle = ret;
    this.root.parent.add(ret);

    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.gprGlow.castShadow = false; this.gprGlow.receiveShadow = false;
    this.reticle.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  }

  /* ============================================================
     placement helpers
     ============================================================ */
  placeAt(x, z, yaw = 0) {
    const h = this.terrain.heightAt(x, z);
    this.pos.set(x, h + 0.95, z);
    this.quat.setFromAxisAngle(_up, yaw);
    this.vel.set(0, 0, 0); this.omega.set(0, 0, 0);
    for (const w of this.wheels) { w.comp = SUSP_REST * 0.5; w.spinVel = 0; w.lastGround.set(x, h, z); }
    this.sync();
  }

  sync() {
    this.root.position.copy(this.pos);
    this.root.quaternion.copy(this.quat);
  }

  get forward() { return _fwd.set(0, 0, 1).applyQuaternion(this.quat); }
  // Right-handed, Y up, forward +Z  =>  right is MINUS X. Getting this backwards
  // is what made the steering answer the wrong key.
  get right() { return _rgt.set(-1, 0, 0).applyQuaternion(this.quat); }
  get up() { return _upv.set(0, 1, 0).applyQuaternion(this.quat); }

  /** Where the drill bit would touch down, in world space. Also refreshes
      armDrop, which the IK needs, from the terrain under that point. */
  aimPoint(out = this.armTarget) {
    const c = Math.cos(this.armYaw), s = Math.sin(this.armYaw);
    // arm-local (x,z) offset, rotated by the arm yaw, then into world space
    _p1.set(ARM_BASE.x + s * this.armReach, ARM_BASE.y, ARM_BASE.z + c * this.armReach);
    out.copy(_p1).applyQuaternion(this.quat).add(this.pos);
    const gh = this.terrain.heightAt(out.x, out.z);
    out.y = gh;
    // vertical offset from the shoulder, measured along the chassis's own up
    _p2.set(ARM_BASE.x, ARM_BASE.y, ARM_BASE.z).applyQuaternion(this.quat).add(this.pos);
    this.armDrop = out.y - _p2.y;
    return out;
  }

  /** signed speed along the heading */
  get speed() { return this.vel.dot(this.forward); }
  get flipped() { return this.up.y < 0.18; }
  /** Hub speed of a wheel rolling at top speed — the reference the motor
      timbre is normalised against, so it follows the drive envelope. */
  get spinRef() { return DRIVE.maxSpeed / WHEEL_R; }

  /* ============================================================
     physics
     ============================================================ */
  step(dt, ctl, terrain) {
    const SUB = 6, h = Math.min(dt, 0.05) / SUB;
    for (let s = 0; s < SUB; s++) this._substep(h, ctl, terrain);
    this.sync();
  }

  _substep(dt, ctl, terrain) {
    const q = this.quat;
    const up = _u1.set(0, 1, 0).applyQuaternion(q);
    const fwd = _u2.set(0, 0, 1).applyQuaternion(q);
    const rgt = _u3.set(1, 0, 0).applyQuaternion(q);

    /* ---- steering: front pair leads, rear pair counter-steers ---- */
    const speedAbs = Math.abs(this.vel.dot(fwd));
    const steerLimit = lerp(0.72, 0.30, sstep(DRIVE.maxSpeed * 0.18, DRIVE.maxSpeed * 0.95, speedAbs));
    for (const w of this.wheels) {
      // Negative: a positive steer input must swing the wheels toward −X, which
      // is the chassis's right-hand side.
      let t = 0;
      if (w.axle === 0) t = -ctl.steer * steerLimit;
      else if (w.axle === 2) t = ctl.steer * steerLimit * 0.62;
      w.targetSteer = t;
      w.steer += (t - w.steer) * Math.min(1, dt * 12.0);
    }

    const force = _f.set(0, 0, 0);
    const torque = _t.set(0, 0, 0);
    let contacts = 0, loadSum = 0;
    this.motorLoad = 0;

    for (const w of this.wheels) {
      // wheel mount in world space
      const mount = _p1.copy(w.mount).applyQuaternion(q).add(this.pos);
      // suspension travels along the chassis's own down axis
      const down = _p2.copy(up).multiplyScalar(-1);

      // vertical probe: where the wheel centre would sit at full extension
      const probe = _p3.copy(mount).addScaledVector(down, SUSP_REST);
      const gh = terrain.heightAt(probe.x, probe.z);
      terrain.normalAt(probe.x, probe.z, 0.30, w.normal);

      // compression = how far the ground pushes the wheel up the strut
      const bottom = probe.y - WHEEL_R;
      let comp = (gh - bottom);
      comp = clamp(comp, -0.02, SUSP_TRAVEL + 0.30);
      const wasContact = w.contact;
      w.contact = comp > 0;

      // wheel centre for rendering
      const centreY = w.contact ? gh + WHEEL_R : probe.y;
      w.worldPos.set(probe.x, centreY, probe.z);

      const compVel = (comp - w.comp) / dt;
      w.compVel = compVel; w.comp = comp;

      if (!w.contact) { w.load = 0; w.slipLat = 0; w.slipLong = 0; w.sink = 0;
        // free wheel spins down slowly
        w.spinVel -= Math.sign(w.spinVel) * Math.min(Math.abs(w.spinVel), 0.7 * dt);
        w.spin += w.spinVel * dt;
        continue;
      }
      contacts++;

      /* ---- suspension ---- */
      const over = Math.max(0, comp - SUSP_TRAVEL);            // bump stop
      let fs = SUSP_K * comp + SUSP_C * clamp(compVel, -6, 6) + over * over * 400000;
      fs = clamp(fs, 0, 40000);
      const fN = _p4.copy(up).multiplyScalar(fs);
      force.add(fN);
      const rArm = _p5.copy(w.mount).applyQuaternion(q);
      torque.add(_p6.crossVectors(rArm, fN));
      w.load = fs; loadSum += fs;

      /* ---- tyre frame ---- */
      const steerQ = _q1.setFromAxisAngle(up, w.steer);
      const wf = _p7.copy(fwd).applyQuaternion(steerQ);
      // project onto the contact plane
      wf.addScaledVector(w.normal, -wf.dot(w.normal)).normalize();
      const wr = _p8.crossVectors(w.normal, wf).normalize();

      // contact point velocity = v + ω × r
      const cp = _p9.copy(rArm).addScaledVector(up, -(SUSP_REST - comp));
      const cv = _p10.copy(this.vel).add(_p11.crossVectors(this.omega, cp));
      const vLong = cv.dot(wf), vLat = cv.dot(wr);

      /* ---- sinkage ----
         Contact pressure over the bearing strength of the top few centimetres
         of regolith (~12 kPa). Apollo's rover sank one to two centimetres and
         paid about 5 % of its weight in rolling resistance for it; anything
         deeper and the machine simply would not have moved. */
      const pressure = fs / (WHEEL_W * 0.42);                  // N/m² of contact patch
      w.sink = 0.10 * clamp(pressure / 12000, 0, 1);
      const rr = (0.045 + w.sink * 1.2) * fs;

      /* ---- drive / brake torque ---- */
      const mu = MU_BASE * (1 - 0.30 * sstep(0.0, 0.09, w.sink));
      const maxF = mu * fs;
      let throttleT = ctl.throttle * MOTOR_TORQUE * this.powerScale *
        (1 - sstep(DRIVE.maxSpeed * 0.82, DRIVE.maxSpeed, Math.abs(vLong)));
      /* ---- point turn ----
         Six independently driven hubs can spin one side against the other and
         pivot on the spot. Without it, a rover that stops facing the wrong way
         has to drive off and come back, which is exactly as tedious as it
         sounds. Authority fades out as soon as you are actually rolling. */
      const pivot = Math.abs(ctl.steer) * (1 - sstep(DRIVE.maxSpeed * 0.048, DRIVE.maxSpeed * 0.214, speedAbs)) *
                    (1 - Math.min(1, Math.abs(ctl.throttle) * 1.6));
      if (pivot > 0.01) throttleT += w.side * Math.sign(ctl.steer) * MOTOR_TORQUE * this.powerScale * 0.78 * pivot;
      // traction control: back off the hub before it digs itself in
      if (ctl.tc) {
        const excess = Math.abs(w.spinVel * WHEEL_R - vLong) - DRIVE.maxSpeed * 0.107;
        if (excess > 0) throttleT *= Math.max(0.15, 1 - excess * 0.85);
      }
      /* ---- hill hold ----
         A harmonic-drive hub does not back-drive, so a rover with nothing
         commanded holds its ground rather than freewheeling down a slope. It
         also means you cannot creep away from the drill site you just parked
         at — which is the whole reason this exists. Fades out with speed so
         there is still some coast in it. */
      const holding = Math.abs(ctl.throttle) < 0.05 && pivot < 0.01;
      const brakeCmd = Math.max(ctl.brake, holding ? 0.6 * (1 - sstep(DRIVE.maxSpeed * 0.06, DRIVE.maxSpeed * 0.357, speedAbs)) : 0);
      const brakeT = brakeCmd * BRAKE_TORQUE * Math.sign(w.spinVel || 1e-6);

      /* ---- tyre longitudinal force, solved SEMI-IMPLICITLY ----
         The wheel's inertia is tiny and the slip stiffness is large, so an
         explicit step oscillates and then explodes. Solving for the new spin
         rate directly is unconditionally stable at any timestep. */
      const aT = (throttleT - brakeT) / WHEEL_I;
      const denom = 1 + dt * K_SLIP * WHEEL_R * WHEEL_R / WHEEL_I;
      let spinNew = (w.spinVel + dt * aT + dt * K_SLIP * WHEEL_R * vLong / WHEEL_I) / denom;
      let slipV = spinNew * WHEEL_R - vLong;
      let fx = K_SLIP * slipV;
      let fy = clamp(-vLat * K_LAT, -maxF * 1.2, maxF * 1.2);

      // friction circle — the tyre has one budget to spend on both axes
      const fmag = Math.hypot(fx, fy);
      if (fmag > maxF) {
        const k = maxF / fmag; fx *= k; fy *= k;
        // force was capped, so the wheel is now free to spin up: re-integrate
        spinNew = w.spinVel + dt * (aT - fx * WHEEL_R / WHEEL_I);
        slipV = spinNew * WHEEL_R - vLong;
      }
      if (brakeCmd > 0.5 && Math.abs(spinNew) < 0.7) spinNew *= 0.5;
      w.spinVel = clamp(spinNew, -DRIVE.maxSpeed / WHEEL_R * 1.6, DRIVE.maxSpeed / WHEEL_R * 1.6);
      w.spin += w.spinVel * dt;

      // rolling resistance always opposes motion
      const fRoll = -Math.sign(vLong) * Math.min(rr, Math.abs(vLong) * 700);

      const ftotal = _p12.copy(wf).multiplyScalar(fx + fRoll).addScaledVector(wr, fy);
      force.add(ftotal);
      torque.add(_p13.crossVectors(cp, ftotal));

      w.slipLong = clamp(Math.abs(slipV) / 3.2, 0, 1);
      w.slipLat = clamp(Math.abs(vLat) / 3.0, 0, 1);
      this.motorLoad += Math.abs(throttleT) / MOTOR_TORQUE / 6;
    }

    /* ---- gravity ---- */
    force.y -= this.mass * MOON_G;

    /* ---- attitude control moment gyros: keep air time survivable ---- */
    if (contacts <= 1) {
      const lev = _p1.set(0, 1, 0);
      const axis = _p2.crossVectors(up, lev);
      torque.addScaledVector(axis, 5200);
      torque.addScaledVector(this.omega, -2600);
      this.airTime += dt;
    } else {
      this.airTime = 0;
      torque.addScaledVector(this.omega, -900);              // chassis damping
    }
    this.airborne = contacts === 0;

    /* ---- integrate linear ---- */
    this.vel.addScaledVector(force, dt / this.mass);
    // never let it creep on a slope with the brake on
    if (ctl.brake > 0.7 && contacts >= 3 && this.vel.lengthSq() < 0.05) this.vel.multiplyScalar(0.5);
    this.pos.addScaledVector(this.vel, dt);

    /* ---- integrate angular (body-frame inertia) ---- */
    const qi = _q2.copy(this.quat).invert();
    const tb = _p3.copy(torque).applyQuaternion(qi);
    const wb = _p4.copy(this.omega).applyQuaternion(qi);
    // ω̇ = I⁻¹ (τ − ω × Iω)
    const Iw = _p5.set(wb.x * this.Ibody.x, wb.y * this.Ibody.y, wb.z * this.Ibody.z);
    const gyro = _p6.crossVectors(wb, Iw);
    const dw = _p7.set((tb.x - gyro.x) / this.Ibody.x, (tb.y - gyro.y) / this.Ibody.y, (tb.z - gyro.z) / this.Ibody.z);
    wb.addScaledVector(dw, dt);
    this.omega.copy(wb).applyQuaternion(this.quat);
    const wlen = this.omega.length();
    if (wlen > 1e-6) {
      _q1.setFromAxisAngle(_p8.copy(this.omega).divideScalar(wlen), wlen * dt);
      this.quat.premultiply(_q1).normalize();
    }

    /* ---- hard floor: never let the body sink through the regolith ---- */
    const bh = terrain.heightAt(this.pos.x, this.pos.z);
    const minY = bh + 0.30;
    if (this.pos.y < minY) {
      const pen = minY - this.pos.y;
      this.pos.y = minY;
      if (this.vel.y < 0) {
        this.hardHit = Math.max(this.hardHit, -this.vel.y);
        this.vel.y *= -0.12;
      }
      this.vel.x *= 0.90; this.vel.z *= 0.90;
      void pen;
    }
    // soft mission fence — the rim wall is unclimbable, but be explicit about it
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > 560) {
      const k = (r - 560) * 0.06;
      this.vel.x -= this.pos.x / r * k; this.vel.z -= this.pos.z / r * k;
    }

    this.odo += Math.hypot(this.vel.x, this.vel.z) * dt;
  }

  /* ============================================================
     visual update
     ============================================================ */
  updateVisuals(dt, ctl) {
    const q = this.quat;
    this.armDeploy += ((this.armOut ? 1 : 0) - this.armDeploy) * Math.min(1, dt * 3.0);
    if (this.armDeploy > 0.02) this.aimPoint();
    for (const w of this.wheels) {
      // wheel position, expressed back in body space
      const local = _p1.copy(w.worldPos).sub(this.pos).applyQuaternion(_q1.copy(q).invert());
      w.obj.position.copy(local);
      w.obj.rotation.set(0, 0, 0);
      w.obj.rotateY(w.steer);
      w.obj.rotateX(w.spin);
      w.motor.rotation.set(0, 0, Math.PI / 2);
      w.local = (w.local || new THREE.Vector3()).copy(local);
    }

    /* ---- draw the linkage between the real joints ---- */
    for (const L of this.links) {
      const wf = this.wheels.find(w => w.side === L.side && w.axle === 0).local;
      const wm = this.wheels.find(w => w.side === L.side && w.axle === 1).local;
      const wr = this.wheels.find(w => w.side === L.side && w.axle === 2).local;
      // the bogie pin floats above the midpoint of the two rear wheels
      _bog.copy(wm).add(wr).multiplyScalar(0.5); _bog.y += 0.30;
      L.bogiePin.position.copy(_bog);
      span(L.stub, _tmpA.set(L.side * 0.58, 0.44, 0.16), L.anchor);
      span(L.rocker, L.anchor, wf);
      span(L.strut, L.anchor, _bog);
      span(L.bogieF, _bog, wm);
      span(L.bogieR, _bog, wr);
    }

    // mast tracks where the operator is looking
    this.mast.rotation.y = this.mastYaw;
    this.head.rotation.x = this.mastPitch;

    // the dish keeps hunting for a carrier that is not coming back
    this.dish.rotation.y += dt * 0.22;

    /* ---- arm: two-link IK onto the aim point, blended out of the stow pose ----
       rotation.x tilts a +Z member DOWNWARD, so the natural 2D frame here is
       (forward, downward) and the target's vertical term flips sign. Solved for
       the elbow-up branch, which is the pose every real sampling arm holds. */
    const d = this.armDeploy;
    this.arm.rotation.y = this.armYaw * d;
    const L1 = ARM_L1, L2 = ARM_L2;
    const reach = clamp(this.armReach, ARM_REACH_MIN, ARM_REACH_MAX);
    const yp = clamp(-this.armDrop, -0.35, L1 + L2 - 0.06);   // downward to target
    let D = Math.hypot(reach, yp);
    D = clamp(D, Math.abs(L1 - L2) + 0.03, L1 + L2 - 0.03);
    const elbowInt = Math.acos(clamp((L1 * L1 + L2 * L2 - D * D) / (2 * L1 * L2), -1, 1));
    const gamma = Math.acos(clamp((D * D + L1 * L1 - L2 * L2) / (2 * D * L1), -1, 1));
    const phi1 = Math.atan2(yp, reach) - gamma;
    const phi2 = phi1 + (Math.PI - elbowInt);
    this.armA.rotation.x = lerp(-2.55, phi1, d);
    this.armB.rotation.x = lerp(2.40, phi2 - phi1, d);
    this.turret.rotation.x = 0;
    if (this.drilling) { this.drillSpin += dt * 26; this.drill.rotation.z = this.drillSpin; }

    // stowed = the wing stands vertically over the tail; deployed = level, aft
    this.panelPivot.rotation.x = lerp(Math.PI / 2, -0.06, this.panelDeploy);

    // aiming reticle sits on the terrain wherever the bit would come down
    this.reticle.visible = this.armDeploy > 0.35;
    if (this.reticle.visible) {
      this.reticle.position.copy(this.armTarget);
      this.reticle.position.y += 0.06;
      this.reticle.rotation.y += dt * 0.5;
      const k = 0.55 + 0.45 * Math.sin(performance.now() * 0.005);
      this.reticle.children[0].material.opacity = (this.drilling ? 0.95 : 0.45 + 0.35 * k);
    }

    // lights
    const lp = this.lampPower;
    this.mats.lamp.color.setRGB(lp * 3.4, lp * 3.2, lp * 2.9);
    this.rtgGlow.material.opacity = 0.075 + 0.035 * Math.sin(performance.now() * 0.0013);
    this.beacon.visible = (performance.now() % 1400) < 130;
    void ctl;
  }
}

/* scratch */
const _up = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3(), _rgt = new THREE.Vector3(), _upv = new THREE.Vector3();
const _u1 = new THREE.Vector3(), _u2 = new THREE.Vector3(), _u3 = new THREE.Vector3();
const _f = new THREE.Vector3(), _t = new THREE.Vector3();
const _p1 = new THREE.Vector3(), _p2 = new THREE.Vector3(), _p3 = new THREE.Vector3();
const _p4 = new THREE.Vector3(), _p5 = new THREE.Vector3(), _p6 = new THREE.Vector3();
const _p7 = new THREE.Vector3(), _p8 = new THREE.Vector3(), _p9 = new THREE.Vector3();
const _p10 = new THREE.Vector3(), _p11 = new THREE.Vector3(), _p12 = new THREE.Vector3();
const _p13 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _bog = new THREE.Vector3(), _tmpA = new THREE.Vector3(), _tmpB = new THREE.Vector3();
const _zAxisU = new THREE.Vector3(0, 0, 1);

/** Stretch a unit-length +Z member so it spans exactly from a to b. */
function span(mesh, a, b) {
  mesh.position.set((a.x + b.x) * 0.5, (a.y + b.y) * 0.5, (a.z + b.z) * 0.5);
  _tmpB.subVectors(b, a);
  const len = _tmpB.length();
  mesh.scale.set(1, 1, Math.max(len, 0.02));
  if (len > 1e-5) mesh.quaternion.setFromUnitVectors(_zAxisU, _tmpB.divideScalar(len));
}
