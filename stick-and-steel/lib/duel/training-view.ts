import * as T from 'three';
import type { Fighter } from './physics';

/** Reuses the fighter's physical targets; the dummy recoils where it is struck. */
export function createTrainingYard(scene: T.Scene) {
  const group = new T.Group(); group.visible = false; scene.add(group);
  const dummy = new T.Group(); group.add(dummy);
  const geometries: T.BufferGeometry[] = [], materials: T.Material[] = [];
  const paper = new T.MeshStandardMaterial({ color: '#ded8c7', roughness: 1 });
  const wood = new T.MeshStandardMaterial({ color: '#b6ab8e', roughness: 1 });
  const ink = new T.LineBasicMaterial({ color: '#8a7960' });
  const red = new T.LineBasicMaterial({ color: '#ae3937' }); materials.push(paper, wood, ink, red);
  function block(parent: T.Object3D, size: number[], point: number[], material: T.Material = paper) {
    const g = new T.BoxGeometry(...size as [number, number, number]); geometries.push(g);
    const m = new T.Mesh(g, material); m.position.set(...point as [number, number, number]); m.castShadow = m.receiveShadow = true; parent.add(m);
    const edges = new T.EdgesGeometry(g); geometries.push(edges); m.add(new T.LineSegments(edges, ink)); return m;
  }
  function line(parent: T.Object3D, points: number[][], mat: T.Material = ink) {
    const g = new T.BufferGeometry().setFromPoints(points.map(p => new T.Vector3(...p as [number, number, number]))); geometries.push(g); parent.add(new T.Line(g, mat));
  }
  const torso = new T.Group(), head = new T.Group(); dummy.add(torso, head);
  block(torso, [.34, .43, .20], [0, 0, 0]);
  for (const r of [.07, .12]) line(torso, Array.from({ length: 49 }, (_, i) => [Math.cos(i / 48 * Math.PI * 2) * r, Math.sin(i / 48 * Math.PI * 2) * r, .103]), red);
  for (let y = -.16; y < .2; y += .07) line(torso, [[-.17, y, .102], [-.12, y + .04, .102]]);
  block(head, [.25, .29, .23], [0, 0, 0]);
  for (const x of [-.06, .06]) {
    line(head, [[x - .018, .015, .117], [x + .018, .05, .117]]);
    line(head, [[x + .018, .015, .117], [x - .018, .05, .117]]);
  }
  line(head, [[-.04, -.06, .117], [.04, -.06, .117]]);
  const limbs = ['left upper arm', 'right upper arm', 'left forearm', 'right forearm', 'left thigh', 'right thigh', 'left shin', 'right shin', 'spine', 'pelvis'].map(name => ({ name, mesh: block(dummy, [.055, 1, .055], [0, 0, 0], wood) }));
  // Low benches, rolled mats and racks keep the practice ring clear.
  for (const sign of [-1, 1]) {
    block(group, [1.6, .09, .35], [sign * 2.7, .48, 1.9]);
    for (const x of [-.6, .6]) block(group, [.08, .45, .28], [sign * 2.7 + x, .225, 1.9], wood);
    block(group, [.08, 1.65, .08], [sign * 2.6, .825, -2.65], wood);
    block(group, [.08, 1.65, .08], [sign * 2.6 + .65, .825, -2.65], wood);
    block(group, [.9, .065, .10], [sign * 2.6 + .325, 1.25, -2.65], wood);
    for (let i = 0; i < 3; i++) {
      const blade = block(group, [.028, 1.15, .02], [sign * 2.6 + i * .21 + .1, .81, -2.57]); blade.rotation.z = .1;
      block(group, [.18, .027, .04], [sign * 2.6 + i * .21 + .14, .33, -2.57], wood);
    }
  }
  // Pencil paving marks, separated from the floor to avoid coplanar surfaces.
  for (let i = -3; i <= 3; i++) {
    line(group, [[-3.5, .012, i + .25], [-2, .012, i + .25]]);
    line(group, [[2.05, .012, i + .25], [3.5, .012, i + .25]]);
  }
  return {
    group,
    update(f: Fighter, visible: boolean) {
      dummy.visible = visible;
      if (!visible) return;
      for (const [name, mesh] of [['chest', torso], ['head', head]] as const) {
        const p = f.rig.parts.get(name)!; mesh.position.copy(p.body.translation()); mesh.quaternion.copy(p.body.rotation()).multiply(p.visualRotation);
      }
      for (const { name, mesh } of limbs) {
        const p = f.rig.parts.get(name)!; mesh.position.copy(p.body.translation()); mesh.quaternion.copy(p.body.rotation()).multiply(p.visualRotation); mesh.scale.y = p.length;
      }
    },
    dispose() { scene.remove(group); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); },
  };
}
