import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { signalPhase } from './city-config.js';
import { GEO } from './geodata.js';
import { poleCollider } from './street-colliders.js';

// js/open-city-enforcement.js
// A city's road pricing gantries and traffic cameras (GEO.enforcement, from OpenStreetMap: tools/city/build.mjs), for
// open-city-details.js: Singapore's ERP gantries across their carriageways (steel frame, blue ERP boards, the charge
// lit on an LED board), speed cameras on their kerbside poles, red light cameras at the junctions they watch with the
// signal heads of those junctions (road-network.js signalises them). Driving the player's car under a gantry charges
// it (the in-car unit's double beep), past a speed camera over the limit or into a junction on red flashes it and
// issues the fine. All static meshes are merged per material; the lamps are instanced per signal group.

const STEEL = 0x8f969c;
const SIGN_BLUE = '#1f5aa6';
const RATES = ['$0.50', '$1.00', '$2.00', '$3.00'];

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// The at-grade street segment nearest (x, z) within `reach`: { ux, uz, w } (its direction a -> b, curb-to-curb width)
function streetIndex() {
  const RG = GEO.roadGraph;
  const CELL = 64;
  const cells = new Map();
  for (const l of RG.links) {
    if (l[8] !== 0) continue;
    const pts = [l[0] * 2, ...Array.from({ length: l[6].length / 2 }, (_, k) => -1 - k), l[1] * 2];
    const P = pts.map((p) => (p >= 0 ? [RG.nodes[p], RG.nodes[p + 1]] : [l[6][(-1 - p) * 2], l[6][(-1 - p) * 2 + 1]]));
    for (let k = 0; k + 1 < P.length; k++) {
      const seg = { ax: P[k][0], az: P[k][1], bx: P[k + 1][0], bz: P[k + 1][1], w: l[3] || 7, dir: l[5] };
      for (let i = Math.floor(Math.min(seg.ax, seg.bx) / CELL); i <= Math.floor(Math.max(seg.ax, seg.bx) / CELL); i++) {
        for (let j = Math.floor(Math.min(seg.az, seg.bz) / CELL); j <= Math.floor(Math.max(seg.az, seg.bz) / CELL); j++) {
          const key = i * 100000 + j;
          if (!cells.has(key)) cells.set(key, []);
          cells.get(key).push(seg);
        }
      }
    }
  }
  return (x, z, reach = 20) => {
    let best = null;
    let bd = reach;
    for (const s of cells.get(Math.floor(x / CELL) * 100000 + Math.floor(z / CELL)) || []) {
      const dx = s.bx - s.ax, dz = s.bz - s.az;
      const L2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / L2));
      const d = Math.hypot(s.ax + dx * t - x, s.az + dz * t - z);
      if (d < bd) {
        bd = d;
        const L = Math.sqrt(L2);
        const back = s.dir < 0 ? -1 : 1; // the way its traffic goes
        best = { ux: (dx / L) * back, uz: (dz / L) * back, w: s.w, oneWay: s.dir !== 0 };
      }
    }
    return best;
  };
}

function buildEnforcement(group, { keepLeft }) {
  const E = GEO.enforcement;
  if (!E) return null;
  const street = streetIndex();
  const kerb = keepLeft ? -1 : 1; // the side traffic keeps to, as a multiple of the right normal
  const pieces = { steel: [], dark: [], sign: [], housing: [], led: RATES.map(() => []) };
  const colliders = []; // the columns & poles, for the player
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  // a box w x h x d at (x, y, z), its x across and z along a street running (ux, uz)
  const box = (list, w, h, d, x, y, z, ux, uz) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.applyMatrix4(m.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(up, Math.atan2(ux, uz)), new THREE.Vector3(1, 1, 1)));
    list.push(g);
  };

  // ERP gantries: two columns either side of the carriageway, a beam across it, blue ERP boards and an LED board both
  // ways
  const gantries = [];
  for (let i = 0; i < E.gantries.length; i += 2) {
    const x = E.gantries[i] / 10, z = E.gantries[i + 1] / 10;
    const s = street(x, z, 15);
    if (!s) continue;
    const { ux, uz } = s;
    const rx = -uz, rz = ux; // across the street
    const half = s.w / 2 + 0.9;
    for (const side of [-1, 1]) {
      box(pieces.steel, 0.4, 6.4, 0.4, x + rx * half * side, 3.2, z + rz * half * side, ux, uz);
      colliders.push(poleCollider(x + rx * half * side, z + rz * half * side, 0.25, 6.4));
    }
    box(pieces.steel, half * 2 + 0.4, 0.55, 0.55, x, 6.1, z, ux, uz);
    const rate = Math.floor(Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % RATES.length);
    for (const face of [-1, 1]) {
      box(pieces.sign, 2.4, 1.0, 0.06, x - rx * 1.4 + face * 0.31 * ux, 6.1, z - rz * 1.4 + face * 0.31 * uz, ux, uz);
      box(pieces.led[rate], 1.5, 0.55, 0.06, x + rx * 1.3 + face * 0.31 * ux, 6.1, z + rz * 1.3 + face * 0.31 * uz, ux, uz);
    }
    gantries.push({ x, z, ux, uz, half, rate: RATES[rate], prev: null, last: -1e9 });
  }

  // Speed cameras: a grey housing on a kerbside pole, its lens facing the oncoming traffic
  const speedCams = [];
  for (let i = 0; i < E.speed.length; i += 3) {
    const x = E.speed[i] / 10, z = E.speed[i + 1] / 10;
    const s = street(x, z, 25);
    if (!s) continue;
    const off = (s.w / 2 + 1.2) * kerb;
    const px = x - s.uz * off, pz = z + s.ux * off;
    box(pieces.steel, 0.16, 3.4, 0.16, px, 1.7, pz, s.ux, s.uz);
    colliders.push(poleCollider(px, pz, 0.14, 3.9));
    box(pieces.housing, 0.55, 0.62, 0.85, px, 3.6, pz, s.ux, s.uz);
    box(pieces.dark, 0.36, 0.3, 0.05, px - s.ux * 0.44, 3.62, pz - s.uz * 0.44, s.ux, s.uz); // facing the traffic coming
    speedCams.push({ x: px, z: pz, limit: E.speed[i + 2], last: -1e9 });
  }

  // Red light cameras: a housing on a pole by the junction, looking down the approach it watches
  const redCams = [];
  for (let i = 0; i < E.redLight.length; i += 4) {
    const x = E.redLight[i] / 10, z = E.redLight[i + 1] / 10;
    const ax = E.redLight[i + 2] / 100, az = E.redLight[i + 3] / 100;
    const s = street(x, z, 25) || { w: 10 };
    const off = (s.w / 2 + 1.5) * kerb;
    const px = x - az * off + ax * 4, pz = z + ax * off + az * 4;
    box(pieces.steel, 0.16, 5.2, 0.16, px, 2.6, pz, ax, az);
    colliders.push(poleCollider(px, pz, 0.14, 5.5));
    box(pieces.housing, 0.5, 0.5, 0.75, px, 5.3, pz, ax, az);
    box(pieces.dark, 0.3, 0.26, 0.05, px - ax * 0.39, 5.3, pz - az * 0.39, ax, az);
    redCams.push({ x, z, ax, az, node: null, group: 0, last: -1e9 });
  }

  // Merged meshes, one per material
  const signTex = canvasTexture(256, 112, (ctx) => {
    ctx.fillStyle = SIGN_BLUE;
    ctx.fillRect(0, 0, 256, 112);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 5;
    ctx.strokeRect(8, 8, 240, 96);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 54px Inter, Arial, sans-serif';
    ctx.fillText('ERP', 128, 50);
    ctx.font = '700 13px Inter, Arial, sans-serif';
    ctx.fillText('ELECTRONIC ROAD PRICING', 128, 88);
  });
  const add = (geos, mat) => {
    if (!geos.length) return;
    const mesh = new THREE.Mesh(mergeGeometries(geos, false), mat);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  };
  add(pieces.steel, new THREE.MeshStandardNodeMaterial({ color: STEEL, roughness: 0.55, metalness: 0.6 }));
  add(pieces.dark, new THREE.MeshStandardNodeMaterial({ color: 0x0c0e10, roughness: 0.2, metalness: 0.4 }));
  add(pieces.housing, new THREE.MeshStandardNodeMaterial({ color: 0xd8dbdd, roughness: 0.5, metalness: 0.2 }));
  add(pieces.sign, new THREE.MeshStandardNodeMaterial({ map: signTex, roughness: 0.45, emissiveMap: signTex, emissive: 0x333333 }));
  RATES.forEach((rate, k) => {
    const tex = canvasTexture(128, 48, (ctx) => {
      ctx.fillStyle = '#050505';
      ctx.fillRect(0, 0, 128, 48);
      ctx.fillStyle = '#ffb21e';
      ctx.font = '700 34px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(rate, 64, 26);
    });
    add(pieces.led[k], new THREE.MeshStandardNodeMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 1.6, roughness: 0.3 }));
  });

  return { gantries, speedCams, redCams, colliders };
}

// Signal heads at the network's signalised junctions (in an open city: those its red light cameras watch), on the kerb
// at every approach's stop line, lit by their group's phase (traffic.js: group 0 runs on the avenue phase)
function buildSignalHeads(group, network) {
  const heads = [];
  const kerb = network.keepLeft ? -1 : 1;
  for (const n of network.nodes) {
    if (!n.signal) continue;
    for (const e of n.in || []) {
      if (!e.len) continue;
      const sx = e.sx + e.dx * e.len, sz = e.sz + e.dz * e.len;
      const off = (e.half + 0.7) * kerb;
      heads.push({ x: sx + e.rx * off, z: sz + e.rz * off, dx: e.dx, dz: e.dz, group: e.axisIndex === 0 ? 0 : 1 });
    }
  }
  if (!heads.length) return null;
  const geos = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const colliders = heads.map((h) => poleCollider(h.x, h.z, 0.13, 4.3));
  for (const h of heads) {
    q.setFromAxisAngle(up, Math.atan2(h.dx, h.dz));
    const pole = new THREE.CylinderGeometry(0.08, 0.1, 3.3, 6);
    pole.applyMatrix4(m.compose(new THREE.Vector3(h.x, 1.65, h.z), q, new THREE.Vector3(1, 1, 1)));
    const head = new THREE.BoxGeometry(0.34, 1.0, 0.26);
    head.applyMatrix4(m.compose(new THREE.Vector3(h.x, 3.75, h.z), q, new THREE.Vector3(1, 1, 1)));
    geos.push(pole, head);
  }
  const body = new THREE.Mesh(mergeGeometries(geos, false), new THREE.MeshStandardNodeMaterial({ color: 0x1b1f22, roughness: 0.6 }));
  body.castShadow = true;
  group.add(body);
  // lamps: [group][red, amber, green], facing the approaching traffic
  const COLORS = [0xff2a1a, 0xffa31a, 0x2cff6a];
  const lampGeo = new THREE.CircleGeometry(0.12, 12);
  const lamps = [0, 1].map((g) => COLORS.map((c, k) => {
    const list = heads.filter((h) => h.group === g);
    const mat = new THREE.MeshStandardNodeMaterial({ color: 0x111111, emissive: c, emissiveIntensity: 0 });
    const mesh = new THREE.InstancedMesh(lampGeo, mat, Math.max(1, list.length));
    mesh.count = list.length;
    list.forEach((h, i) => {
      q.setFromAxisAngle(up, Math.atan2(-h.dx, -h.dz));
      mesh.setMatrixAt(i, m.compose(new THREE.Vector3(h.x - h.dx * 0.135, 4.07 - k * 0.32, h.z - h.dz * 0.135), q, new THREE.Vector3(1, 1, 1)));
    });
    group.add(mesh);
    return mat;
  }));
  const updateLamps = (time) => {
    for (let g = 0; g < 2; g++) {
      const phase = signalPhase(time, g === 0);
      lamps[g][0].emissiveIntensity = phase === 'red' ? 3 : 0.02;
      lamps[g][1].emissiveIntensity = phase === 'amber' ? 3 : 0.02;
      lamps[g][2].emissiveIntensity = phase === 'green' ? 3 : 0.02;
    }
  };
  updateLamps.colliders = colliders;
  return updateLamps;
}

// The fine notices & flash: a panel at the top of the screen and a white flash over everything
function createNotices() {
  const flash = document.createElement('div');
  Object.assign(flash.style, { position: 'fixed', inset: '0', background: '#fff', opacity: '0', pointerEvents: 'none', transition: 'opacity 0.35s ease-out', zIndex: '40' });
  const panel = document.createElement('div');
  panel.className = 'panel';
  Object.assign(panel.style, {
    position: 'fixed', top: '86px', left: '50%', transform: 'translateX(-50%)', padding: '10px 18px', borderRadius: '12px',
    font: '600 14px Inter, Arial, sans-serif', color: '#fff', textAlign: 'center', opacity: '0', pointerEvents: 'none',
    transition: 'opacity 0.3s', zIndex: '41', whiteSpace: 'nowrap'
  });
  const title = document.createElement('div');
  title.style.font = '800 15px Inter, Arial, sans-serif';
  title.style.letterSpacing = '0.04em';
  const detail = document.createElement('div');
  detail.style.opacity = '0.85';
  detail.style.marginTop = '2px';
  panel.append(title, detail);
  document.body.append(flash, panel);
  let timer = 0;
  return (head, body, withFlash) => {
    title.textContent = head;
    detail.textContent = body;
    panel.style.opacity = '1';
    clearTimeout(timer);
    timer = setTimeout(() => (panel.style.opacity = '0'), 3800);
    if (withFlash) {
      flash.style.transition = 'none';
      flash.style.opacity = '0.9';
      requestAnimationFrame(() => {
        flash.style.transition = 'opacity 0.35s ease-out';
        flash.style.opacity = '0';
      });
    }
  };
}

// Running a red light in Singapore: a $400 composition fine and 12 demerit points (the detailed city's red light
// cameras and the island's lights, js/island-signals.js)
const RED_LIGHT_FINE = ['RED LIGHT CAMERA', 'You ran a red light · $400 fine & 12 demerit points', true, 'camera'];

// Singapore's penalties for speeding (composition fine & demerit points by how far over the limit)
function speedingFine(over) {
  if (over <= 20) return ['$150', 4];
  if (over <= 30) return ['$200', 6];
  if (over <= 40) return ['$300', 8];
  return ['a court summons', 24];
}

function createEnforcement(group, network) {
  const built = buildEnforcement(group, network);
  if (!built) return null;
  const { gantries, speedCams, redCams, colliders } = built;
  let lightSignals = null;
  let notify = null;
  let audio = null;
  const say = (head, body, withFlash, chime) => {
    if (!notify && typeof document !== 'undefined') notify = createNotices();
    if (notify) notify(head, body, withFlash);
    if (audio && audio.chime) audio.chime(chime);
  };
  console.info(`[enforcement] ${gantries.length} ERP gantries, ${speedCams.length} speed cameras, ${redCams.length} red light cameras`);

  return {
    // a fine notice (& its flash and chime) from elsewhere: the island's red light cameras (js/island-signals.js)
    notice: say,
    // the gantries' columns and the cameras' poles; the signal heads' poles once attached (js/street-colliders.js)
    colliders,
    signalColliders: () => lightSignals?.colliders || [],
    // the traffic network (its signalised junctions & approach groups) and the audio, once they exist
    attach(net, audioSystem) {
      audio = audioSystem;
      lightSignals = buildSignalHeads(group, net);
      const signals = net.nodes.filter((n) => n.signal);
      for (const c of redCams) {
        let best = null;
        let bd = 40;
        for (const n of signals) {
          const d = Math.hypot(n.x - c.x, n.z - c.z);
          if (d < bd) { bd = d; best = n; }
        }
        if (!best) continue;
        c.node = best;
        // the approach it watches: the edge into the junction running most nearly its way
        let be = null;
        for (const e of best.in || []) if (!be || e.dx * c.ax + e.dz * c.az > be.dx * c.ax + be.dz * c.az) be = e;
        c.group = be && be.axisIndex !== 0 ? 1 : 0;
      }
    },
    update(time, player) {
      if (lightSignals) lightSignals(time);
      if (!player || player.type !== 'car') return;
      const p = player.position;
      const v = player.speed || 0;
      const hx = Math.sin(player.heading), hz = Math.cos(player.heading);
      for (const g of gantries) {
        const dx = p.x - g.x, dz = p.z - g.z;
        if (Math.abs(dx) > 40 || Math.abs(dz) > 40) { g.prev = null; continue; }
        const along = dx * g.ux + dz * g.uz;
        const across = -dx * g.uz + dz * g.ux;
        if (g.prev !== null && Math.sign(along) !== Math.sign(g.prev) && Math.abs(across) < g.half && time - g.last > 6) {
          g.last = time;
          say('ERP', `${g.rate} deducted from your CashCard`, false, 'erp');
        }
        g.prev = along;
      }
      const kmh = Math.abs(v) * 3.6;
      for (const c of speedCams) {
        if (Math.hypot(p.x - c.x, p.z - c.z) > 14 || time - c.last < 12) continue;
        const over = Math.round(kmh - c.limit);
        if (over < 5) continue;
        c.last = time;
        const [fine, points] = speedingFine(over);
        say('SPEED CAMERA', `${Math.round(kmh)} km/h in a ${c.limit} km/h zone · ${fine} fine & ${points} demerit points`, true, 'camera');
      }
      for (const c of redCams) {
        if (!c.node || time - c.last < 15 || Math.abs(v) < 3) continue;
        if (Math.hypot(p.x - c.node.x, p.z - c.node.z) > 9) continue;
        if (hx * c.ax + hz * c.az < 0.6 * Math.sign(v)) continue; // not coming in down its approach
        if (signalPhase(time, c.group === 0) !== 'red') continue;
        c.last = time;
        say(...RED_LIGHT_FINE);
      }
    }
  };
}

export { createEnforcement, RED_LIGHT_FINE };
