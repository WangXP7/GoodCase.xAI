// Boards on a window: six planks nailed across the opening from outside, each hidden as a
// zombie tears it off and shown again as the player rebuilds (window.boards, read every frame).
// buildBoards(A, window) records the window while the area is built; the planks themselves are one
// instanced mesh a zone, made when the art layer installs, and they replace the plain ones world.js
// draws.
import { InstancedMesh, Matrix4, Vector3, Quaternion, Euler, Color } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { interiorAttributes, onInstall } from '../../mats/interior.js';

const PLANKS = 6;
const TONES = [0x6b5236, 0x7a6040, 0x54412c, 0x86704e, 0x4a3a28, 0x705a3c];

export function buildBoards(A, window) { A.boards.push(window); return window; }
export const boardWindow = buildBoards;

const _m = new Matrix4(), _p = new Vector3(), _q = new Quaternion(), _e = new Euler(), _s = new Vector3(), _c = new Color();

onInstall((G, layer) => {
  const level = G.level;
  const recs = layer.recs.filter((rec) => rec.boards.length && level.groups[rec.zone]);
  if (!recs.length) return;
  for (const rec of recs) {
    // the plain planks world.js made for this zone (world.js should tag its mesh `userData.boards =
    // true`; until it does it is known by being the zone's one instanced unit box with an instance
    // for every plank of every window)
    const planks = level.windows.filter((q) => q.zone === rec.zone).reduce((n, q) => n + (q.max || PLANKS), 0);
    for (const c of level.groups[rec.zone].children) {
      if (!c.isInstancedMesh || c.material === layer.mats.shared) continue;
      if (c.userData.boards || (c.geometry && c.geometry.type === 'BoxGeometry' && c.count === planks && c.geometry.parameters.width === 1)) { c.visible = false; c.userData.boardsHidden = true; }
    }
  }
  // one instanced mesh for every boarded window of every zone: one draw call, no shadow pass (the
  // wall behind them is the caster), hidden while none of those zones is drawn
  const wins = [], groups = [];
  for (const rec of recs) { groups.push(level.groups[rec.zone]); for (const w of rec.boards) { const q = level.windows.find((x) => x.id === w.id); if (q) wins.push(q); } }
  const geo = interiorAttributes(new RoundedBoxGeometry(1, 0.17, 0.032, 1, 0.006), 'wood', 0);
  const mesh = new InstancedMesh(geo, layer.mats.shared, wins.length * PLANKS);
  mesh.name = 'boards';
  mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.castShadow = false; mesh.userData.noReflect = true;
  const shown = wins.map(() => -1);
  const place = (wi, w) => {
    for (let i = 0; i < PLANKS; i++) {
      const on = i < w.boards;
      const k = (wi * 7 + i * 13) % 11;
      const t = (i + 0.5) / PLANKS;
      const y = w.sill + 0.06 + t * (w.head - w.sill - 0.12) + ((k % 3) - 1) * 0.012;
      const out = 0.17 + (i % 2) * 0.03;
      _p.set(w.pos[0] + w.normal[0] * out + (w.normal[0] ? 0 : ((k % 5) - 2) * 0.03), y, w.pos[2] + w.normal[2] * out + (w.normal[2] ? 0 : ((k % 5) - 2) * 0.03));
      _e.set(0, w.normal[0] !== 0 ? Math.PI / 2 : 0, (k - 5) * 0.022, 'YXZ');
      _s.set(on ? w.w + 0.34 + (k % 4) * 0.06 : 1e-4, on ? 1 : 1e-4, on ? 1 : 1e-4);
      mesh.setMatrixAt(wi * PLANKS + i, _m.compose(_p, _q.setFromEuler(_e), _s));
      mesh.setColorAt(wi * PLANKS + i, _c.setHex(TONES[k % TONES.length]).multiplyScalar(0.8));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };
  wins.forEach((w, i) => { place(i, w); shown[i] = w.boards; });
  level.root.add(mesh);
  layer.boards = mesh;
  layer.updaters.push(() => {
    let vis = false;
    for (let i = 0; i < groups.length; i++) if (groups[i].visible) vis = true;
    mesh.visible = vis;
    for (let i = 0; i < wins.length; i++) if (wins[i].boards !== shown[i]) { shown[i] = wins[i].boards; place(i, wins[i]); }
  });
});
