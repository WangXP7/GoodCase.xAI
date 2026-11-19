import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Fn, float, vec3, vec4, color, uniform, texture, uv, positionLocal, normalLocal, normalView, abs, max, dot, smoothstep, mrt } from 'three/tsl';

// js/mrt-car.js
// An MRT car (js/mrt-scene.js MrtTrain stands them on the track), modelled on Singapore's trains as photographed
// (Wikimedia Commons: the C151C, R151, C751C, C830, C951 and T251 interiors): a white cabin with longitudinal benches of
// moulded seats in its line's colours (the priority seats at the ends in another), each bench between frosted glass
// draught screens framed by bent stainless tubes, stainless poles at the doors and Y-poles down the aisle, two overhead
// rails hung with triangular grab handles that swing as the train brakes and pulls away, a ceiling of LED strips either
// side of the air-conditioning diffuser, route map stickers and adverts on the coves, a dynamic route map above each
// door, large round-cornered windows, doors with tall windows, black seals and stainless kick plates, speckled grey
// vinyl underfoot with yellow strips at the doors, and a wide gangway through to the next car.
//
// A car's frame: +z forward, +x its left, y up from the rail; the floor FLOOR up. Lit by its own ceiling strips (an
// emissive term from the strips' positions, so it is lit as bright underground as above it) and by the sun where it
// comes in.

const FLOOR = 1.1;
const IN_W = 1.42; // the cabin's half width at its walls
const CEIL = FLOOR + 2.16; // its ceiling
const WALL_TOP = FLOOR + 1.88; // where the walls meet the coves
const HALF_W = 1.6; // outside
const ROOF = FLOOR + 2.62;
const DOORS = [-7.6, -2.55, 2.55, 7.6];
const DOOR_W = 1.42;
const DOOR_H = 1.95;
const WIN = [FLOOR + 0.84, FLOOR + 1.74]; // a window's sill and head
const SEAT_W = 0.46;
const SEAT_GAP = 0.025;
const RAIL_X = 0.84; // the overhead rails, over the seats' front edges
const RAIL_Y = FLOOR + 1.93;
const STRIP_X = 0.66; // the ceiling's light strips

// Each line's cabin, after its trains': seats, priority seats, the seats' shell, grab handles, the screens' kind
const SCHEMES = {
  NSL: { seat: '#16a08c', priority: '#f2c12e', shell: '#16a08c', handle: '#eeeae0', screen: 'glass' }, // C151C
  EWL: { seat: '#47bd44', priority: '#e2463f', shell: '#47bd44', handle: '#3db23c', screen: 'glass' }, // R151
  NEL: { seat: '#5874de', priority: '#b8323d', shell: '#a9adb3', handle: '#3654d2', screen: 'bars' }, // C751C
  CCL: { seat: '#1a9a8f', priority: '#1a9a8f', shell: '#1a9a8f', handle: '#ece6d4', screen: 'bars' }, // C830
  DTL: { seat: '#76b8ec', priority: '#cf3a3c', shell: '#9fa4aa', handle: '#4aa8e2', screen: 'panel' }, // C951
  TEL: { seat: '#d8392f', priority: '#efc21f', shell: '#8c9197', handle: '#d23a2f', screen: 'glass' } // T251
};

function canvasTexture(w, h, draw, { repeat = null, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  return tex;
}

// -------------------------------------------------------------------------------------------------------------------
// Geometry helpers
// -------------------------------------------------------------------------------------------------------------------

// A profile [[x, y], ...] swept along z from z0 to z1: its faces face to the right of the profile's direction in x-y
// ((dy, -dx)); `smooth` averages the normals where segments meet (a curve). UVs: u along the profile (m), v along z (m)
function sweep(profile, z0, z1, { smooth = false } = {}) {
  const n = profile.length;
  const segN = [];
  for (let i = 0; i + 1 < n; i++) {
    const dx = profile[i + 1][0] - profile[i][0], dy = profile[i + 1][1] - profile[i][1];
    const L = Math.hypot(dx, dy) || 1;
    segN.push([dy / L, -dx / L]);
  }
  const vn = profile.map((_, i) => {
    if (!smooth) return null;
    const a = segN[Math.max(0, i - 1)], b = segN[Math.min(segN.length - 1, i)];
    const x = a[0] + b[0], y = a[1] + b[1], L = Math.hypot(x, y) || 1;
    return [x / L, y / L];
  });
  const pos = [], nor = [], uvs = [];
  let u = 0;
  for (let i = 0; i + 1 < n; i++) {
    const [ax, ay] = profile[i], [bx, by] = profile[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    const na = smooth ? vn[i] : segN[i], nb = smooth ? vn[i + 1] : segN[i];
    const quad = [[ax, ay, z0, na, u, z0], [bx, by, z0, nb, u + len, z0], [ax, ay, z1, na, u, z1], [bx, by, z0, nb, u + len, z0], [bx, by, z1, nb, u + len, z1], [ax, ay, z1, na, u, z1]];
    for (const [x, y, z, nn, uu, vv] of quad) {
      pos.push(x, y, z);
      nor.push(nn[0], nn[1], 0);
      uvs.push(uu, vv);
    }
    u += len;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return g;
}

function roundRect(path, x0, y0, x1, y1, r) {
  r = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
  path.moveTo(x0 + r, y0);
  path.lineTo(x1 - r, y0);
  path.quadraticCurveTo(x1, y0, x1, y0 + r);
  path.lineTo(x1, y1 - r);
  path.quadraticCurveTo(x1, y1, x1 - r, y1);
  path.lineTo(x0 + r, y1);
  path.quadraticCurveTo(x0, y1, x0, y1 - r);
  path.lineTo(x0, y0 + r);
  path.quadraticCurveTo(x0, y0, x0 + r, y0);
  return path;
}

// A flat panel in the plane x = x0, facing nx (+1 / -1), spanning z0..z1 and y0..y1, with round-cornered holes
// [{ z0, z1, y0, y1, r }]. UVs: z and y in metres.
function sidePanel(x0, nx, z0, z1, y0, y1, holes = []) {
  // (the shape's u runs so that its +w is the panel's normal: u = -z facing +x, u = z facing -x)
  const s = nx > 0 ? -1 : 1;
  const u = (z) => z * s;
  const shape = new THREE.Shape();
  const [ua, ub] = [u(z0), u(z1)].sort((a, b) => a - b);
  shape.moveTo(ua, y0); shape.lineTo(ub, y0); shape.lineTo(ub, y1); shape.lineTo(ua, y1); shape.lineTo(ua, y0);
  for (const h of holes) {
    const [ha, hb] = [u(h.z0), u(h.z1)].sort((a, b) => a - b);
    shape.holes.push(roundRect(new THREE.Path(), ha, h.y0, hb, h.y1, h.r ?? 0.1));
  }
  const g = new THREE.ShapeGeometry(shape, 6);
  // (u, v, w) -> (x0 + w * nx, v, u * s)
  const m = new THREE.Matrix4().set(0, 0, nx, x0, 0, 1, 0, 0, s, 0, 0, 0, 0, 0, 0, 1);
  g.applyMatrix4(m);
  const p = g.attributes.position, uvA = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uvA.setXY(i, p.getZ(i), p.getY(i));
  return g;
}

// A flat panel in the plane z = z0, facing nz, spanning x0..x1, y0..y1, with holes [{ x0, x1, y0, y1, r }]
function endPanel(z0, nz, x0, x1, y0, y1, holes = []) {
  const shape = new THREE.Shape();
  const [ua, ub] = [x0 * nz, x1 * nz].sort((a, b) => a - b);
  shape.moveTo(ua, y0); shape.lineTo(ub, y0); shape.lineTo(ub, y1); shape.lineTo(ua, y1); shape.lineTo(ua, y0);
  for (const h of holes) {
    const [ha, hb] = [h.x0 * nz, h.x1 * nz].sort((a, b) => a - b);
    shape.holes.push(roundRect(new THREE.Path(), ha, h.y0, hb, h.y1, h.r ?? 0.1));
  }
  const g = new THREE.ShapeGeometry(shape, 6);
  // (u, v, w) -> (u * nz, v, z0 + w * nz)
  g.applyMatrix4(new THREE.Matrix4().set(nz, 0, 0, 0, 0, 1, 0, 0, 0, 0, nz, z0, 0, 0, 0, 1));
  return g;
}

function box(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

// A tube along points [[x, y, z], ...] (rounded at the bends)
function tube(points, r = 0.019, seg = 8) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, 'catmullrom', 0.2);
  const L = curve.getLength();
  return new THREE.TubeGeometry(curve, Math.max(4, Math.round(L * 10)), r, seg, false);
}

// A straight pole from a to b
function pole(a, b, r = 0.019) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const g = new THREE.CylinderGeometry(r, r, va.distanceTo(vb), 10, 1, true);
  g.translate(0, va.distanceTo(vb) / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize()));
  g.translate(...a);
  return g;
}

const merge = (list) => {
  const ok = list.filter(Boolean).map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of ok) {
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  }
  return ok.length ? mergeGeometries(ok, false) : null;
};

// -------------------------------------------------------------------------------------------------------------------
// Materials: lit by the cabin's own strips (an emissive term from where each strip is, in the car's frame), and the sun
// -------------------------------------------------------------------------------------------------------------------
// out of the tunnels (1) or in them (0): set by the ride
const daylight = uniform(1);
const cabinLight = Fn(() => {
  const p = positionLocal;
  const n = normalLocal;
  let sum = float(0.12);
  for (const sx of [STRIP_X, -STRIP_X]) {
    const d = vec3(float(sx).sub(p.x), float(CEIL - 0.02).sub(p.y), 0);
    const r2 = dot(d, d).add(0.04);
    const l = d.div(r2.sqrt());
    sum = sum.add(max(dot(n, l), 0).mul(0.9).div(r2.mul(0.25).add(1)));
  }
  // the light thrown back up off the floor and the seats, onto the ceiling and under things
  sum = sum.add(max(n.y.negate(), 0).mul(0.42));
  // a little daylight through the windows, out of the tunnels
  sum = sum.add(daylight.mul(max(n.y, 0).mul(0.12).add(0.1)));
  // the shade near the floor, and under the benches
  const ax = abs(p.x);
  const low = smoothstep(FLOOR - 0.02, FLOOR + 0.55, p.y).mul(0.32).add(0.68);
  const under = smoothstep(IN_W - 0.56, IN_W - 0.44, ax).mul(float(1).sub(smoothstep(FLOOR + 0.34, FLOOR + 0.41, p.y)));
  return sum.mul(low).mul(float(1).sub(under.mul(0.62)));
});
// (glass leaves the G-buffer's normal and reflectivity to what is behind it: no screen-space reflections off it)
const glassMRT = mrt({ normal: vec4(0, 0, 0, 0), metalRough: vec4(0, 0, 0, 0) });

function cabinMat(hex, { map = null, rough = 0.6, gloss = 0, stainless = false, glow = 1 } = {}) {
  // Lit by the cabin alone: no diffuse light from the scene's sun and sky (a flat wash on a white interior), all of its
  // light the emissive term from the strips; the sky's reflections kept faint, on the glossy ones
  const m = new THREE.MeshStandardNodeMaterial({ roughness: rough, metalness: 0, envMapIntensity: gloss ? 0.35 : 0.12 });
  const base = map ? texture(map).rgb.mul(color(hex)) : color(hex);
  m.colorNode = vec3(0);
  let light = cabinLight().mul(glow);
  // stainless: bright bands down a tube as its surface turns to the view
  if (stainless) light = light.mul(0.55).add(smoothstep(0.45, 0.95, abs(normalView.x)).mul(0.5)).add(smoothstep(0.7, 1.0, normalView.y).mul(0.2));
  if (gloss) light = light.add(smoothstep(0.8, 1.0, normalView.y).mul(gloss)).add(smoothstep(0.88, 1.0, abs(normalView.x)).mul(gloss * 0.5));
  m.emissiveNode = base.mul(light);
  return m;
}

function glassMat({ tint = 0x9fb6c0, opacity = 0.22, map = null } = {}) {
  const m = new THREE.MeshStandardNodeMaterial({ color: tint, roughness: 0.05, metalness: 0, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
  if (map) { m.map = map; m.alphaMap = null; }
  m.mrtNode = glassMRT;
  return m;
}

// -------------------------------------------------------------------------------------------------------------------
// Textures
// -------------------------------------------------------------------------------------------------------------------
let shared = null;
function sharedTextures() {
  if (shared) return shared;
  // speckled grey vinyl
  const floor = canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#9aa1a6';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 26000; i++) {
      const v = Math.random();
      ctx.fillStyle = v < 0.45 ? 'rgba(60,66,72,0.55)' : v < 0.85 ? 'rgba(220,224,226,0.55)' : 'rgba(30,34,38,0.6)';
      const s = Math.random() < 0.9 ? 1.5 : 3;
      ctx.fillRect(Math.random() * w, Math.random() * h, s, s);
    }
  }, { repeat: [1.6, 6] });
  // the air-conditioning diffuser's slots
  const grille = canvasTexture(64, 256, (ctx, w, h) => {
    ctx.fillStyle = '#c9ced2';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#2c3135';
    for (let y = 2; y < h; y += 8) ctx.fillRect(4, y, w - 8, 4);
  }, { repeat: [1, 40] });
  // the gangway's bellows
  const bellows = canvasTexture(64, 64, (ctx, w, h) => {
    ctx.fillStyle = '#2b2e31';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#3b3f43';
    for (let x = 0; x < w; x += 8) ctx.fillRect(x, 0, 4, h);
  }, { repeat: [4, 1] });
  // a draught screen's frosted stripes (the arcs of the NSEWL's screens)
  const frosted = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(235,240,242,0.55)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 14;
    for (let k = 0; k < 5; k++) {
      ctx.beginPath();
      ctx.arc(w * 1.15, h * 1.25, 90 + k * 48, Math.PI * 0.95, Math.PI * 1.45);
      ctx.stroke();
    }
  });
  // a door's sticker over its window
  const sticker = canvasTexture(512, 40, (ctx, w, h) => {
    ctx.fillStyle = '#f5c518';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1b1b1b';
    ctx.font = '700 22px Inter, Arial, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('KEEP CLEAR OF DOORS   不要靠近车门', 14, h / 2 + 1);
  });
  // adverts and notices on the coves (the "Show You Care" priority seat poster among them)
  const ads = ['#b0186b', '#2a7de1', '#e2541b', '#13a26b', '#7d3bd1'].map((bg, i) => canvasTexture(512, 160, (ctx, w, h) => {
    ctx.fillStyle = '#f7f7f5';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(8, 8, w - 16, h - 16, 18);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 54px Inter, Arial, sans-serif';
    ctx.textBaseline = 'middle';
    const text = ['Show You Care', 'Stand Clear', 'Hold the Handrail', 'Move In, Please', 'Mind the Gap'][i];
    ctx.fillText(text, 34, h / 2 - 12);
    ctx.font = '600 24px Inter, Arial, sans-serif';
    ctx.fillText(['Offer your seat to those in need', 'Let others alight first', 'Keep our trains safe', 'Make space for more', 'Please mind the platform gap'][i], 36, h / 2 + 38);
  }));
  shared = { floor, grille, bellows, frosted, sticker, ads };
  return shared;
}

// The line's route, as on the stickers over the windows and the displays over the doors: its stations as dots on its
// colour, the interchanges' codes, the one it is making for lit up (the displays), `upTo` those passed dimmed
function drawRoute(ctx, w, h, line, stops, { at = -1, dark = false, net = null } = {}) {
  ctx.fillStyle = dark ? '#0d1116' : '#f4f4f1';
  ctx.fillRect(0, 0, w, h);
  const n = stops.length;
  const x0 = 40, x1 = w - 40;
  const y = dark ? h * 0.66 : h * 0.62;
  ctx.lineWidth = dark ? 7 : 6;
  ctx.strokeStyle = line.colour;
  ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
  ctx.font = `600 ${dark ? 15 : 13}px Inter, Arial, sans-serif`;
  for (let i = 0; i < n; i++) {
    const x = n > 1 ? x0 + ((x1 - x0) * i) / (n - 1) : (x0 + x1) / 2;
    const passed = at >= 0 && i < at;
    ctx.globalAlpha = passed ? 0.35 : 1;
    ctx.beginPath();
    ctx.arc(x, y, i === at ? 9 : 6, 0, Math.PI * 2);
    ctx.fillStyle = i === at ? (dark ? '#ffffff' : line.colour) : dark ? '#0d1116' : '#ffffff';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = i === at && dark ? line.colour : line.colour;
    ctx.stroke();
    // names slanted up, as on the trains' displays
    ctx.save();
    ctx.translate(x - 2, y - 14);
    ctx.rotate(-Math.PI / 4);
    ctx.fillStyle = dark ? (i === at ? '#ffffff' : '#c9d2da') : '#25292d';
    ctx.fillText(stops[i].station.name, 0, 0);
    ctx.restore();
    // interchanges
    const others = net ? net.linesAt(stops[i].station).filter((l) => l !== line) : [];
    others.forEach((l, k) => {
      ctx.fillStyle = l.colour;
      ctx.beginPath();
      ctx.roundRect(x - 13, y + 12 + k * 15, 26, 13, 6);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '700 9px Inter, Arial, sans-serif';
      ctx.fillText(l.code, x - 8, y + 22 + k * 15);
      ctx.font = `600 ${dark ? 15 : 13}px Inter, Arial, sans-serif`;
    });
  }
  ctx.globalAlpha = 1;
}

// -------------------------------------------------------------------------------------------------------------------
// The car
// -------------------------------------------------------------------------------------------------------------------

// The stretches of the side walls between the openings, each { z0, z1, door: is it a doorway }
function wallSpans(L) {
  const h = L / 2 - 0.5;
  const out = [];
  let at = -h;
  for (const d of DOORS) {
    out.push({ z0: at, z1: d - DOOR_W / 2 });
    out.push({ z0: d - DOOR_W / 2, z1: d + DOOR_W / 2, door: d });
    at = d + DOOR_W / 2;
  }
  out.push({ z0: at, z1: h });
  return out;
}

// The windows of a stretch of wall: two in a long one, one in a short one
function windowsOf(span) {
  const len = span.z1 - span.z0;
  const m = 0.32;
  if (len > 2.6) {
    const mid = (span.z0 + span.z1) / 2;
    return [{ z0: span.z0 + m, z1: mid - 0.13 }, { z0: mid + 0.13, z1: span.z1 - m }];
  }
  return len > 1.2 ? [{ z0: span.z0 + m, z1: span.z1 - m }] : [];
}

// One bucket seat's side profile (x from the wall inwards, y), turned into the cabin on `side`
function seatShape(side) {
  const pts = [
    [0.05, 1.0], [0.065, 0.86], [0.09, 0.70], [0.12, 0.56], [0.16, 0.49], [0.24, 0.462], [0.40, 0.455], [0.47, 0.462],
    [0.505, 0.445], [0.505, 0.415], [0.47, 0.405], [0.24, 0.41], [0.13, 0.43], [0.085, 0.52], [0.05, 0.68], [0.02, 0.86],
    [0.01, 0.99]
  ];
  const shape = new THREE.Shape();
  pts.forEach(([u, y], i) => {
    const x = side * (IN_W - u);
    if (i === 0) shape.moveTo(x, FLOOR + y); else shape.lineTo(x, FLOOR + y);
  });
  shape.closePath();
  return shape;
}

function carGeometry(line, scheme, { front = false, back = false } = {}) {
  const L = line.carLength;
  const hL = L / 2 - 0.5;
  const G = {
    wall: [], cove: [], ceiling: [], strip: [], grille: [], floor: [], yellow: [], seat: [], priority: [], shell: [],
    plinth: [], steel: [], screen: [], glass: [], dark: [], body: [], stripe: [], roof: [], under: [], sticker: [],
    route: [], ad: [], bellows: [], lamp: []
  };
  const spans = wallSpans(L);
  for (const side of [-1, 1]) {
    const xs = side * IN_W;
    // walls, each stretch with its windows; a doorway's frame above and beside it
    for (const sp of spans) {
      if (sp.door !== undefined) {
        G.wall.push(sidePanel(xs, -side, sp.z0, sp.z1, FLOOR + DOOR_H, WALL_TOP));
        // the door's rubber edges and its frame's stainless handrails (recessed either side)
        for (const e of [sp.z0, sp.z1]) {
          G.dark.push(box(0.04, DOOR_H, 0.05, xs - side * 0.01, FLOOR + DOOR_H / 2, e));
          G.steel.push(pole([xs - side * 0.07, FLOOR + 0.82, e + (e === sp.z0 ? -0.09 : 0.09)], [xs - side * 0.07, FLOOR + 1.72, e + (e === sp.z0 ? -0.09 : 0.09)], 0.016));
        }
        G.yellow.push(box(0.14, 0.006, DOOR_W, xs - side * 0.08, FLOOR + 0.004, sp.door));
        G.steel.push(box(0.05, 0.012, DOOR_W, xs - side * 0.015, FLOOR + 0.006, sp.door));
        // the dynamic route map over the door
        G.dark.push(box(0.06, 0.21, DOOR_W, xs - side * 0.11, FLOOR + 2.04, sp.door));
        // (its screen: a plane facing in)
        const scr = new THREE.PlaneGeometry(DOOR_W * 0.92, 0.155);
        scr.rotateY(-side * Math.PI / 2);
        scr.translate(xs - side * 0.145, FLOOR + 2.04, sp.door);
        G.route.push(scr);
        continue;
      }
      const wins = windowsOf(sp);
      G.wall.push(sidePanel(xs, -side, sp.z0, sp.z1, FLOOR, WALL_TOP, wins.map((w) => ({ ...w, y0: WIN[0], y1: WIN[1], r: 0.14 }))));
      for (const w of wins) {
        // the window's black surround and its glass (one pane, seen from both sides)
        G.dark.push(sidePanel(xs - side * 0.005, -side, w.z0 - 0.035, w.z1 + 0.035, WIN[0] - 0.035, WIN[1] + 0.035, [{ ...w, y0: WIN[0], y1: WIN[1], r: 0.14 }]));
        const g = sidePanel(side * (IN_W + 0.06), -side, w.z0, w.z1, WIN[0], WIN[1]);
        G.glass.push(g);
      }
      // the lower wall's stainless kick strip
      G.steel.push(box(0.01, 0.12, sp.z1 - sp.z0, xs - side * 0.004, FLOOR + 0.06, (sp.z0 + sp.z1) / 2));
    }
    // the cove from the wall's top round to the ceiling, the light strip at its edge
    const cove = [];
    for (let k = 0; k <= 8; k++) {
      const a = (k / 8) * (Math.PI / 2);
      cove.push([side * (IN_W - 0.62 + 0.62 * Math.cos(a)), WALL_TOP + (CEIL - WALL_TOP) * Math.sin(a)]);
    }
    // (profile ordered so its faces face into the cabin)
    G.cove.push(sweep(side > 0 ? cove.slice().reverse() : cove, -hL, hL, { smooth: true }));
    // the strip, and a lip either side of it
    // (facing down: the profile runs towards +x)
    G.strip.push(sweep([[side * STRIP_X - 0.1, CEIL - 0.012], [side * STRIP_X + 0.1, CEIL - 0.012]], -hL + 0.2, hL - 0.2));
    // stickers and adverts on the coves over the windows: the line's route over every window bay, an advert at the ends
    spans.filter((sp) => sp.door === undefined && sp.z1 - sp.z0 > 2).forEach((sp, k) => {
      const len = Math.min(2.4, sp.z1 - sp.z0 - 0.4);
      const g = new THREE.PlaneGeometry(len, 0.3);
      // tilted to the cove's slope there
      g.rotateX(0.55);
      g.rotateY(-side * Math.PI / 2);
      g.translate(side * (IN_W - 0.09), WALL_TOP + 0.13, (sp.z0 + sp.z1) / 2);
      (k % 2 === 0 ? G.route : G.ad).push(g);
    });
    // seats: a bench of moulded seats in each stretch between the doors, the end ones priority seats, on a plinth; a
    // draught screen and its bent stainless frame at each end of a bench by a door
    for (const sp of spans) {
      if (sp.door !== undefined) continue;
      const atEnd = sp.z0 < DOORS[0] - 1 || sp.z1 > DOORS[DOORS.length - 1] + 1;
      const za = sp.z0 + (sp.z0 > -hL + 0.1 ? 0.12 : 0.25);
      const zb = sp.z1 - (sp.z1 < hL - 0.1 ? 0.12 : 0.25);
      const n = Math.floor((zb - za + SEAT_GAP) / (SEAT_W + SEAT_GAP));
      if (n < 1) continue;
      const used = n * SEAT_W + (n - 1) * SEAT_GAP;
      const start = (za + zb) / 2 - used / 2;
      const ext = new THREE.ExtrudeGeometry(seatShape(side), { depth: SEAT_W - 0.03, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.012, bevelSegments: 2, curveSegments: 4 });
      for (let i = 0; i < n; i++) {
        const g = ext.clone();
        g.translate(0, 0, start + i * (SEAT_W + SEAT_GAP) + 0.015);
        // the priority seats: the ends' benches, and the end seat of each bench by the doors on the NSEWL's
        (atEnd ? G.priority : G.seat).push(g);
      }
      // the plinth under the bench (set back from its front edge), and its shell
      const mid = (za + zb) / 2;
      G.plinth.push(box(0.36, 0.38, zb - za, side * (IN_W - 0.18), FLOOR + 0.19, mid));
      G.shell.push(box(0.05, 0.08, zb - za, side * (IN_W - 0.49), FLOOR + 0.40, mid));
      // screens at the ends by a door
      for (const [z, toward] of [[sp.z0, 1], [sp.z1, -1]]) {
        const byDoor = DOORS.some((d) => Math.abs(d - z) < DOOR_W);
        if (!byDoor) continue;
        const zs = z + toward * 0.06;
        const xIn = side * (IN_W - 0.64);
        if (scheme.screen === 'panel') {
          G.shell.push(box(0.6, 0.62, 0.04, side * (IN_W - 0.32), FLOOR + 0.78, zs));
        } else if (scheme.screen === 'glass') {
          const shape = new THREE.Shape();
          shape.moveTo(0, FLOOR + 0.48);
          shape.lineTo(0.6, FLOOR + 0.48);
          shape.lineTo(0.6, FLOOR + 1.62);
          shape.quadraticCurveTo(0.6, FLOOR + 1.84, 0.38, FLOOR + 1.84);
          shape.lineTo(0, FLOOR + 1.84);
          shape.lineTo(0, FLOOR + 0.48);
          const g = new THREE.ShapeGeometry(shape, 6);
          // (u inward from the wall -> x, at z = zs)
          g.applyMatrix4(new THREE.Matrix4().set(-side, 0, 0, side * IN_W, 0, 1, 0, 0, 0, 0, 1, zs, 0, 0, 0, 1));
          const uvA = g.attributes.uv, p = g.attributes.position;
          for (let i = 0; i < uvA.count; i++) uvA.setXY(i, (side * IN_W - p.getX(i)) * side / 0.64, (p.getY(i) - FLOOR - 0.48) / 1.36);
          G.screen.push(g);
        } else {
          for (let k = 0; k < 7; k++) G.steel.push(pole([side * (IN_W - 0.02), FLOOR + 0.6 + k * 0.17, zs], [xIn, FLOOR + 0.6 + k * 0.17, zs], 0.009));
        }
        // the frame: up from the floor at the seat's front edge, bent over to the wall above
        G.steel.push(tube([[xIn, FLOOR, zs], [xIn, FLOOR + 0.6, zs], [xIn, FLOOR + 1.62, zs], [xIn + side * 0.08, FLOOR + 1.86, zs], [side * (IN_W - 0.3), FLOOR + 1.95, zs], [side * (IN_W - 0.06), FLOOR + 1.98, zs]]));
      }
    }
    // the overhead rail along the cabin, on hangers from the ceiling
    G.steel.push(pole([side * RAIL_X, RAIL_Y, -hL + 0.4], [side * RAIL_X, RAIL_Y, hL - 0.4], 0.017));
    for (let z = -hL + 1; z < hL - 0.5; z += 2.3) {
      G.steel.push(tube([[side * RAIL_X, RAIL_Y, z], [side * RAIL_X, RAIL_Y + 0.1, z], [side * (RAIL_X - 0.04), CEIL - 0.02, z]], 0.016, 6));
    }
  }
  // poles down the aisle: one at each doorway, a Y-pole at each bench's middle
  for (const d of DOORS) G.steel.push(pole([0, FLOOR, d], [0, CEIL, d], 0.02));
  for (const sp of wallSpans(L)) {
    if (sp.door !== undefined || sp.z1 - sp.z0 < 2.4) continue;
    const z = (sp.z0 + sp.z1) / 2;
    G.steel.push(pole([0, FLOOR, z], [0, FLOOR + 1.55, z], 0.02));
    for (const s of [-1, 1]) G.steel.push(tube([[0, FLOOR + 1.5, z], [0, FLOOR + 1.62, z], [s * 0.18, FLOOR + 1.82, z], [s * 0.42, CEIL - 0.03, z]], 0.018, 8));
  }
  // the ceiling: flat panels, the diffuser down the middle, recessed
  // (facing down: profiles running towards +x)
  G.ceiling.push(sweep([[-(IN_W - 0.62), CEIL], [-0.32, CEIL]], -hL, hL));
  G.ceiling.push(sweep([[0.32, CEIL], [IN_W - 0.62, CEIL]], -hL, hL));
  G.ceiling.push(sweep([[-0.32, CEIL], [-0.3, CEIL + 0.05]], -hL, hL));
  G.ceiling.push(sweep([[0.3, CEIL + 0.05], [0.32, CEIL]], -hL, hL));
  G.grille.push(sweep([[-0.3, CEIL + 0.05], [0.3, CEIL + 0.05]], -hL, hL));
  // the floor, and its yellow strips at the gangways
  // (facing up: running towards -x)
  G.floor.push(sweep([[IN_W, FLOOR], [-IN_W, FLOOR]], -hL - 0.5, hL + 0.5));
  for (const z of [-hL - 0.02, hL + 0.02]) G.yellow.push(box(1.5, 0.006, 0.08, 0, FLOOR + 0.004, z));
  // the ends: a wide gangway through to the next car, or the front, with its window ahead
  for (const [z, nz, isNose] of [[hL, -1, front], [-hL, 1, back]]) {
    if (isNose) {
      G.wall.push(endPanel(z, nz, -IN_W, IN_W, FLOOR, CEIL, [{ x0: -1.05, x1: 1.05, y0: FLOOR + 0.92, y1: FLOOR + 1.98, r: 0.16 }]));
      const gl = endPanel(z + 0.08 * -nz, nz, -1.05, 1.05, FLOOR + 0.92, FLOOR + 1.98);
      G.glass.push(gl);
      G.dark.push(box(2.1, 0.75, 0.5, 0, FLOOR + 0.37, z - nz * 0.25 + 0)); // the console
    } else {
      G.wall.push(endPanel(z, nz, -IN_W, IN_W, FLOOR, CEIL, [{ x0: -0.82, x1: 0.82, y0: FLOOR - 0.01, y1: FLOOR + 2.0, r: 0.12 }]));
      // the bellows round the passage to the next car
      const za = Math.min(z, z - nz * 0.5), zb = Math.max(z, z - nz * 0.5);
      // (facing into the passage: down the +x side, up the -x side)
      G.bellows.push(sweep([[0.84, FLOOR + 2.0], [0.84, FLOOR]], za, zb));
      G.bellows.push(sweep([[-0.84, FLOOR], [-0.84, FLOOR + 2.0]], za, zb));
      G.bellows.push(sweep([[-0.84, FLOOR + 2.0], [0.84, FLOOR + 2.0]], za, zb));
    }
  }

  // --- outside: the body's sides with their windows, the line's stripe, the roof, the skirt, the front -------------
  for (const side of [-1, 1]) {
    const xo = side * HALF_W;
    for (const sp of spans) {
      if (sp.door !== undefined) {
        G.body.push(sidePanel(xo, side, sp.z0, sp.z1, FLOOR + DOOR_H, ROOF - 0.35));
        continue;
      }
      const wins = windowsOf(sp);
      G.body.push(sidePanel(xo, side, sp.z0, sp.z1, FLOOR - 0.15, ROOF - 0.35, wins.map((w) => ({ ...w, y0: WIN[0] - 0.02, y1: WIN[1] + 0.02, r: 0.15 }))));
      // the black band the windows sit in
      G.dark.push(sidePanel(xo + side * 0.004, side, sp.z0, sp.z1, WIN[0] - 0.08, WIN[1] + 0.08, wins.map((w) => ({ ...w, y0: WIN[0] - 0.02, y1: WIN[1] + 0.02, r: 0.15 }))));
      // the stripe of the line's colour along it, below the windows
      G.stripe.push(sidePanel(xo + side * 0.006, side, sp.z0, sp.z1, FLOOR + 0.52, FLOOR + 0.66));
      // the jambs between the inside and outside skins round each window
      for (const w of wins) {
        for (const y of [WIN[0] - 0.02, WIN[1] + 0.02]) G.dark.push(box(HALF_W - IN_W, 0.01, w.z1 - w.z0, side * (IN_W + HALF_W) / 2, y, (w.z0 + w.z1) / 2));
      }
    }
    // the band over the doors' tops, a gutter, the skirt below the floor
    G.under.push(box(0.05, 0.6, L - 1.2, side * (HALF_W - 0.1), FLOOR - 0.45, 0));
  }
  // the roof: rounded over, from the sides' tops
  const roof = [];
  for (let k = 0; k <= 10; k++) {
    const a = Math.PI * (k / 10);
    roof.push([HALF_W * Math.cos(a), ROOF - 0.35 + 0.42 * Math.sin(a)]);
  }
  // (over from +x to -x: facing outwards)
  G.roof.push(sweep(roof, -L / 2 + 0.5, L / 2 - 0.5, { smooth: true }));
  // the ends' outer faces
  for (const [z, nz, isNose] of [[L / 2 - 0.5, 1, front], [-L / 2 + 0.5, -1, back]]) {
    if (isNose) {
      // the front: a raked face with a wide black windscreen band and the line's stripe, headlights low down
      const zf = z + nz * 0.55;
      G.body.push(endPanel(zf, nz, -HALF_W, HALF_W, FLOOR - 0.2, ROOF, [{ x0: -1.2, x1: 1.2, y0: FLOOR + 0.82, y1: FLOOR + 2.15, r: 0.25 }]));
      G.dark.push(endPanel(zf + nz * 0.004, nz, -1.24, 1.24, FLOOR + 0.78, FLOOR + 2.19, [{ x0: -1.05, x1: 1.05, y0: FLOOR + 0.92, y1: FLOOR + 1.98, r: 0.16 }]));
      G.glass.push(endPanel(zf - nz * 0.02, nz, -1.2, 1.2, FLOOR + 0.82, FLOOR + 2.15));
      G.stripe.push(endPanel(zf + nz * 0.006, nz, -HALF_W, HALF_W, FLOOR + 0.52, FLOOR + 0.66));
      for (const s of [-1, 1]) G.lamp.push(endPanel(zf + nz * 0.008, nz, s * 1.05 - 0.2, s * 1.05 + 0.2, FLOOR + 0.25, FLOOR + 0.38));
      // the sides and the roof carried on to the face
      for (const s of [-1, 1]) G.body.push(sidePanel(s * HALF_W, s, Math.min(z, zf), Math.max(z, zf), FLOOR - 0.2, ROOF - 0.35));
      G.roof.push(sweep(roof, Math.min(z, zf), Math.max(z, zf), { smooth: true }));
    } else {
      G.under.push(endPanel(z, nz, -HALF_W, HALF_W, FLOOR - 0.15, ROOF, [{ x0: -0.9, x1: 0.9, y0: FLOOR, y1: FLOOR + 2.0, r: 0.1 }]));
    }
  }
  // bogies and wheels
  for (const b of [-8, 8]) {
    G.under.push(box(2.3, 0.45, 2.8, 0, 0.55, b));
    for (const w of [-0.95, 0.95]) for (const s of [-0.75, 0.75]) {
      const g = new THREE.CylinderGeometry(0.42, 0.42, 0.13, 14);
      g.rotateZ(Math.PI / 2);
      g.translate(s, 0.42, b + w);
      G.under.push(g);
    }
  }
  G.under.push(box(2.6, 0.55, L - 6, 0, FLOOR - 0.38, 0));
  const out = {};
  for (const [k, list] of Object.entries(G)) out[k] = merge(list);
  return out;
}

// The door leaves of one doorway's side: each leaf a white panel with a tall window, a black edge seal, a stainless kick
// plate and the yellow sticker over the window; in the car's frame, shut
function doorLeaf(side, d, half) {
  const zc = d + half * (DOOR_W / 4);
  const x = side * (IN_W + 0.07);
  const w = DOOR_W / 2 - 0.015;
  const z0 = zc - w / 2, z1 = zc + w / 2;
  const win = { z0: z0 + 0.1, z1: z1 - 0.1, y0: FLOOR + 0.98, y1: FLOOR + 1.82, r: 0.06 };
  return {
    panel: merge([sidePanel(x - side * 0.03, -side, z0, z1, FLOOR + 0.02, FLOOR + DOOR_H, [win]), sidePanel(x + side * 0.03, side, z0, z1, FLOOR + 0.02, FLOOR + DOOR_H, [win])]),
    dark: merge([
      sidePanel(x - side * 0.034, -side, win.z0 - 0.025, win.z1 + 0.025, win.y0 - 0.025, win.y1 + 0.025, [win]),
      sidePanel(x + side * 0.034, side, win.z0 - 0.025, win.z1 + 0.025, win.y0 - 0.025, win.y1 + 0.025, [win]),
      box(0.07, DOOR_H, 0.03, x, FLOOR + DOOR_H / 2, half < 0 ? z1 : z0)
    ]),
    steel: merge([sidePanel(x - side * 0.036, -side, z0, z1, FLOOR + 0.02, FLOOR + 0.2), sidePanel(x + side * 0.036, side, z0, z1, FLOOR + 0.02, FLOOR + 0.2)]),
    glass: sidePanel(x, -side, win.z0, win.z1, win.y0, win.y1),
    sticker: merge([sidePanel(x - side * 0.036, -side, win.z0, win.z1, win.y1 - 0.06, win.y1)])
  };
}

// The grab handle: a strap from the rail and a rounded triangle
function handleGeometry() {
  const pts = [[0, 0.115], [0.07, 0.0], [-0.07, 0.0]];
  const v = pts.map(([x, y]) => new THREE.Vector3(x, y, 0));
  const curve = new THREE.CatmullRomCurve3([v[0], v[1], v[2]], true, 'catmullrom', 0.12);
  const loop = new THREE.TubeGeometry(curve, 30, 0.012, 6, true);
  loop.translate(0, -0.33, 0);
  const strap = new THREE.BoxGeometry(0.028, 0.2, 0.008);
  strap.translate(0, -0.11, 0);
  const clip = new THREE.CylinderGeometry(0.024, 0.024, 0.04, 10);
  clip.rotateZ(Math.PI / 2);
  return merge([loop, strap, clip]);
}

class MrtCar {
  constructor(line, { front = false, back = false, routeTexture = null } = {}) {
    const scheme = SCHEMES[line.id] || SCHEMES.NSL;
    const T = sharedTextures();
    this.group = new THREE.Group();
    const geo = carGeometry(line, scheme, { front, back });
    const body = new THREE.MeshStandardNodeMaterial({ color: 0xe4e8ea, roughness: 0.32, metalness: 0.35 });
    const mats = {
      wall: cabinMat('#eceeec', { rough: 0.5 }),
      cove: cabinMat('#f0f1ef', { rough: 0.5 }),
      ceiling: cabinMat('#e6e9ea'),
      strip: new THREE.MeshBasicNodeMaterial({ color: 0xffffff }),
      grille: cabinMat('#ffffff', { map: T.grille }),
      floor: cabinMat('#c4c9cd', { map: T.floor, rough: 0.45, gloss: 0.06 }),
      yellow: cabinMat('#f2c21b'),
      seat: cabinMat(scheme.seat, { rough: 0.25, gloss: 0.18 }),
      priority: cabinMat(scheme.priority, { rough: 0.25, gloss: 0.18 }),
      shell: cabinMat(scheme.shell, { rough: 0.35, gloss: 0.15 }),
      plinth: cabinMat('#b9bec2', { rough: 0.3, stainless: true }),
      steel: cabinMat('#c3c8cc', { rough: 0.2, stainless: true }),
      screen: glassMat({ tint: 0xffffff, opacity: 0.5, map: T.frosted }),
      glass: glassMat(),
      dark: cabinMat('#202427', { rough: 0.4 }),
      body,
      stripe: new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(line.colour), roughness: 0.35, metalness: 0.1 }),
      roof: new THREE.MeshStandardNodeMaterial({ color: 0xc7cbcd, roughness: 0.5, metalness: 0.3 }),
      under: new THREE.MeshStandardNodeMaterial({ color: 0x24272a, roughness: 0.8 }),
      sticker: cabinMat('#ffffff', { map: T.sticker }),
      route: new THREE.MeshBasicNodeMaterial({ map: routeTexture }),
      ad: cabinMat('#ffffff', { map: T.ads[line.index % T.ads.length] }),
      bellows: cabinMat('#ffffff', { map: T.bellows }),
      lamp: new THREE.MeshBasicNodeMaterial({ color: 0xfff6dc })
    };
    mats.screen.map = T.frosted;
    mats.body.side = THREE.FrontSide;
    // (the route stickers over the windows: the same drawing on light card)
    this.stickerRoute = null;
    this.mats = mats;
    for (const [k, g] of Object.entries(geo)) {
      if (!g) continue;
      const mat = mats[k];
      if (k === 'route') {
        // the displays over the doors (the route map lit) and the stickers on the coves share the drawing
        const m = new THREE.Mesh(g, mat);
        this.group.add(m);
        continue;
      }
      const m = new THREE.Mesh(g, mat);
      const outside = k === 'body' || k === 'stripe' || k === 'roof' || k === 'under';
      m.castShadow = outside || k === 'dark';
      m.receiveShadow = !outside || k === 'body';
      if (k === 'glass' || k === 'screen') m.renderOrder = 2;
      this.group.add(m);
    }
    // the doors: on both sides, each leaf a group the train slides
    this.doors = [];
    const doorMats = { panel: cabinMat('#f3f4f2', { rough: 0.4 }), dark: mats.dark, steel: mats.steel, glass: mats.glass, sticker: mats.sticker };
    this.doorMats = doorMats;
    for (const side of [-1, 1]) for (const d of DOORS) for (const half of [-1, 1]) {
      const leaf = new THREE.Group();
      const parts = doorLeaf(side, d, half);
      for (const [k, g] of Object.entries(parts)) {
        if (!g) continue;
        const m = new THREE.Mesh(g, doorMats[k]);
        m.castShadow = k === 'panel';
        m.receiveShadow = true;
        if (k === 'glass') m.renderOrder = 2;
        leaf.add(m);
      }
      leaf.userData = { side, half };
      this.group.add(leaf);
      this.doors.push(leaf);
    }
    // the grab handles, along both rails (but over the doors' middles), each swinging on its strap
    const hz = [];
    const hL = line.carLength / 2 - 0.5;
    for (const side of [-1, 1]) {
      for (let z = -hL + 0.7; z < hL - 0.6; z += 0.36) {
        if (DOORS.some((d) => Math.abs(z - d) < 0.25)) continue;
        hz.push([side * RAIL_X, z]);
      }
    }
    this.handleAt = hz;
    this.handles = new THREE.InstancedMesh(handleGeometry(), new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(scheme.handle), roughness: 0.35 }), hz.length);
    this.handles.material.emissiveNode = color(scheme.handle).mul(0.55);
    this.handles.frustumCulled = false;
    this.swing = { a: 0, v: 0, b: 0, w: 0 };
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this.swingHandles(0, 0, 0);
    this.group.add(this.handles);
  }

  /** Slide the doors on `side` (-1 the right, the platform's) open by k (0..1) */
  setDoors(k, side = -1) {
    for (const leaf of this.doors) {
      const { side: s, half } = leaf.userData;
      const open = s === side ? k : 0;
      // out a little, then along the outside of the wall into its pocket
      leaf.position.set(s * Math.min(1, open * 4) * 0.02, 0, half * open * (DOOR_W / 2 - 0.04));
    }
  }

  /** The handles swing: the train's acceleration `a` (m/s², forward) and its sideways acceleration `lat` */
  swingHandles(dt, a, lat) {
    const s = this.swing;
    if (dt > 0) {
      // a pendulum on a 0.3 m strap, damped
      const k = 9.81 / 0.3;
      const ta = Math.atan2(a, 9.81);
      const tb = Math.atan2(lat, 9.81);
      s.v += (-(s.a - ta) * k - s.v * 2.2) * dt;
      s.a += s.v * dt;
      s.w += (-(s.b - tb) * k - s.w * 2.2) * dt;
      s.b += s.w * dt;
    }
    for (let i = 0; i < this.handleAt.length; i++) {
      const [x, z] = this.handleAt[i];
      const j = Math.sin(i * 12.9898) * 0.04; // (no two quite alike)
      this._e.set(s.a * (1 + j), 0, -s.b * (1 - j));
      this._q.setFromEuler(this._e);
      this._m.compose(this._p.set(x, RAIL_Y - 0.01, z), this._q, this._s);
      this.handles.setMatrixAt(i, this._m);
    }
    this.handles.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.group.removeFromParent();
    const seen = new Set();
    this.group.traverse((o) => { if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); } });
    for (const m of [...Object.values(this.mats), this.doorMats.panel, this.handles.material]) m.dispose();
  }
}

/** The route display: a canvas the train redraws as it goes (the line, its stops, the next one lit) */
class RouteDisplay {
  constructor() {
    this.canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (!this.canvas) return;
    this.canvas.width = 1536;
    this.canvas.height = 200;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.key = '';
  }

  draw(net, track, at) {
    if (!this.canvas) return;
    const key = `${track.index}:${at}`;
    if (key === this.key) return;
    this.key = key;
    const ctx = this.canvas.getContext('2d');
    // (the stops near it: the whole line won't read at this size)
    const k0 = Math.max(0, Math.min(track.stops.length - 12, at - 3));
    const stops = track.stops.slice(k0, k0 + 12);
    drawRoute(ctx, this.canvas.width, this.canvas.height, track.line, stops, { at: at - k0, dark: true, net });
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 22px Inter, Arial, sans-serif';
    ctx.fillText(`${track.line.code}  To ${track.towards}`, 24, 30);
    this.texture.needsUpdate = true;
  }

  dispose() { this.texture?.dispose(); }
}

export { daylight as mrtDaylight, MrtCar, RouteDisplay, SCHEMES, FLOOR, IN_W, HALF_W, DOORS, DOOR_W };
