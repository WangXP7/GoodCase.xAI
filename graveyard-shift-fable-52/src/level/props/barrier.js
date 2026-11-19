// What stands in a doorway until the door is bought, in three looks: a boarded doorway
// (planks over a shut door), a sheet gate (corrugated sheet in a welded frame, chained) and a roller
// door. buildBarrier(A, door) records the door while the area is built; the barrier is one mesh made
// when the art layer installs, replacing the plain one world.js draws, and it opens on `door:open`
// with a short move: the boards drop away, the gate slides, the roller winds up.
import { BoxGeometry, CylinderGeometry, Group, Matrix4, Mesh } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BufferAttribute } from 'three';
import { interiorAttributes, onInstall, KIND } from '../../mats/interior.js';
import { M, rgb } from '../build.js';

export function buildBarrier(A, door) { A.barriers.push(door); return door; }

const OPEN_TIME = { boarded: 0.55, sheet: 0.9, roller: 1.2 };

function piece(list, kind, par, geo, m, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.applyMatrix4(m);
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set(color, i * 3);
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  interiorAttributes(g, kind, par);
  list.push(g);
}

// geometry of a barrier in the door's frame: x along the opening (centred), y up, z through it
function barrierGeometry(d, w) {
  const h = d.h, L = [];
  const bx = (kind, par, sx, sy, sz, x, y, z, color, rz = 0) => piece(L, kind, par, new BoxGeometry(sx, sy, sz), M(x, y, z, 0, 0, rz), color);
  if (d.look === 'boarded') {
    bx('paint', 1, w, h, 0.05, 0, h / 2, 0, rgb(0x2a3230)); // the door behind
    bx('metal', 0, 0.04, 0.18, 0.05, w / 2 - 0.12, 1.05, 0.05, rgb(0xb9bec2));
    const tones = [0x6b5236, 0x7a6040, 0x54412c, 0x86704e];
    for (const s of [1, -1]) for (let i = 0; i < 6; i++) bx('wood', 0, w + 0.3 + (i % 3) * 0.08, 0.17, 0.03, ((i * 5) % 3 - 1) * 0.04, 0.22 + i * (h - 0.4) / 5, s * (0.05 + (i % 2) * 0.012), rgb(tones[(i + (s > 0 ? 0 : 2)) % 4], 0.8), ((i * 7) % 5 - 2) * 0.03);
    for (const s of [1, -1]) bx('wood', 0, Math.hypot(w, h) * 0.9, 0.16, 0.03, 0, h / 2, s * 0.085, rgb(0x5a4630, 0.8), Math.atan2(h, w) * s);
  } else if (d.look === 'sheet') {
    bx('metal', 0.7, w, h, 0.012, 0, h / 2, 0, rgb(0x6a6e6c));
    for (let x = -w / 2 + 0.06; x < w / 2; x += 0.15) piece(L, 'metal', 0.6, new CylinderGeometry(0.038, 0.038, h - 0.1, 6, 1, true), M(x, h / 2, 0), rgb(0x7a7e7c));
    for (const [sx, sy, x, y] of [[w, 0.07, 0, 0.035], [w, 0.07, 0, h - 0.035], [0.07, h, -w / 2 + 0.035, h / 2], [0.07, h, w / 2 - 0.035, h / 2]]) bx('paint', 0, sx, sy, 0.1, x, y, 0, rgb(0x2a2c2a));
    bx('paint', 0, Math.hypot(w, h), 0.06, 0.09, 0, h / 2, 0, rgb(0x2a2c2a), Math.atan2(h, w));
    for (let i = 0; i < 9; i++) piece(L, 'metal', 0, new CylinderGeometry(0.03, 0.03, 0.012, 8), M(w / 2 - 0.16 - Math.sin((i / 8) * Math.PI) * 0.06, 1.3 - i * 0.045, 0.07, (i % 2) * 1.57, 0, 1.57), rgb(0x9a9ea2));
    bx('metal', 0, 0.07, 0.09, 0.03, w / 2 - 0.16, 0.86, 0.07, rgb(0xb89a48));
  } else {
    for (let y = 0.02; y < h; y += 0.11) piece(L, 'metal', 0.5, new CylinderGeometry(0.06, 0.06, w, 6, 1, true, 0, Math.PI), M(0, y + 0.055, 0, 0, 0, Math.PI / 2).multiply(M(0, 0, 0, 0, Math.PI / 2, 0)), rgb(0x767a78));
    bx('metal', 0.5, w, h, 0.02, 0, h / 2, 0, rgb(0x5a5e5c));
    bx('paint', 0, w, 0.09, 0.09, 0, 0.045, 0, rgb(0xc9a416));
    bx('metal', 0, 0.18, 0.06, 0.05, 0, 0.12, 0.06, rgb(0x9a9ea2));
  }
  const g = mergeGeometries(L, false);
  for (const p of L) p.dispose();
  return g;
}

onInstall((G, layer) => {
  const level = G.level;
  const doors = [];
  for (const rec of layer.recs) for (const d of rec.barriers) if (!doors.some((q) => q.id === d.id)) doors.push(d);
  const root = new Group();
  root.name = 'barriers';
  level.root.add(root);
  const items = [];
  for (const d of doors) {
    const state = level.doors.find((q) => q.id === d.id), wg = level.groups[`door:${d.id}`];
    if (!state || !wg) continue;
    for (const c of wg.children) c.visible = false; // the plain barrier: its group's own flag still says when a barrier shows
    const r = d.rect, alongX = r.x1 - r.x0 > r.z1 - r.z0;
    const w = alongX ? r.x1 - r.x0 : r.z1 - r.z0;
    const mesh = new Mesh(barrierGeometry(d, w), layer.mats.shared);
    mesh.receiveShadow = true; mesh.castShadow = false; mesh.userData.noReflect = true; // they stand in a wall that already casts
    const g = new Group();
    g.position.set((r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2);
    g.rotation.y = alongX ? 0 : Math.PI / 2;
    g.add(mesh);
    root.add(g);
    items.push({ d, state, wg, g, mesh, t: state.open ? 1 : 0, w });
  }
  // the shared material reads world position from the vertex: these meshes move, so their pattern
  // swims a little while they do; they are still again within the second it takes
  layer.updaters.push((dt) => {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const target = it.state.open ? 1 : 0;
      if (it.t !== target) it.t = target ? Math.min(1, it.t + dt / OPEN_TIME[it.d.look]) : 0;
      const moving = it.t > 0 && it.t < 1;
      it.g.visible = it.t < 1 && (moving || it.wg.visible);
      if (!it.g.visible) continue;
      const e = it.t * it.t * (3 - 2 * it.t);
      const m = it.mesh;
      if (it.d.look === 'boarded') { m.rotation.x = e * 1.5; m.position.y = -e * 0.3; }
      else if (it.d.look === 'sheet') m.position.x = e * (it.w + 0.1);
      else { m.scale.y = 1 - e * 0.97; m.position.y = e * it.d.h * 0.97; }
    }
  });
});
export { KIND, Matrix4 };
