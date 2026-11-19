import * as T from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { handPaths, handlePaths } from '../rig/hand';
import { vec } from '../rig/ik';
import { held, supported, hangingHand } from './net-state';
import type { Fighter } from './physics';

export function createAvatar(scene: T.Scene, fighter: Fighter, color: string) {
  const geometries: T.BufferGeometry[] = [], materials: T.Material[] = [];
  const ink = new LineMaterial({ color, linewidth: .014, worldUnits: true, alphaToCoverage: false, toneMapped: false, depthWrite: true, transparent: false });
  const dark = new T.MeshBasicMaterial({ color: '#252734' });
  const face = new T.MeshStandardMaterial({ color: '#fffdf5', roughness: .92 });
  const outline = new T.MeshBasicMaterial({ color, side: T.BackSide, toneMapped: false });
  const woundInk = new T.MeshStandardMaterial({ color: '#7b1020', roughness: .28 });
  materials.push(ink, dark, face, outline, woundInk);
  const sphereGeo = new T.SphereGeometry(1, 24, 16), cylinderGeo = new T.CylinderGeometry(1, 1, 1, 10); geometries.push(sphereGeo, cylinderGeo);
  const parts = new Map<string, T.Group>();
  function sphere(parent: T.Object3D, radius: number, material: T.Material, p = new T.Vector3()) {
    const m = new T.Mesh(sphereGeo, material); m.position.copy(p); m.scale.setScalar(radius); m.castShadow = true; parent.add(m); return m;
  }
  function mark(parent: T.Object3D, a: T.Vector3, b: T.Vector3, radius: number) {
    const mesh = new T.Mesh(cylinderGeo, dark); mesh.position.copy(a).add(b).multiplyScalar(.5); mesh.scale.set(radius, a.distanceTo(b), radius); mesh.quaternion.setFromUnitVectors(vec([0, 1, 0]), b.clone().sub(a).normalize()); parent.add(mesh);
    sphere(parent, radius, dark, a); sphere(parent, radius, dark, b); return mesh;
  }
  function stroke(parent: T.Object3D, points: number[][]) {
    const geometry = new LineGeometry().setPositions(points.flat()); geometries.push(geometry);
    const line = new Line2(geometry, ink); line.renderOrder = 1; parent.add(line); return line;
  }
  let mouth: T.Mesh | undefined;
  const gripLines: Record<'left' | 'right', Line2[]> = { left: [], right: [] };
  for (const part of fighter.rig.parts.values()) {
    const group = new T.Group(); parts.set(part.name, group); scene.add(group);
    if (part.shape === 'head') {
      sphere(group, .237, outline).castShadow = false; sphere(group, .225, face);
      for (const sign of [-1, 1]) {
        sphere(group, .014, dark, vec([sign * .076, .021, .208])).scale.y = .021;
        mark(group, vec([sign * .042, .077, .207]), vec([sign * .112, .093, .185]), .009);
      }
      mouth = mark(group, vec([-.026, -.07, .212]), vec([.026, -.07, .212]), .007);
      stroke(group, Array.from({ length: 65 }, (_, i) => { const a = i / 64 * Math.PI * 2; return [Math.cos(a) * .191, .121, Math.sin(a) * .191]; }));
      stroke(group, [[-.075, .13, -.18], [-.094, .075, -.24], [-.12, .02, -.27]]);
    } else if (part.shape === 'hand') {
      const side = part.name.startsWith('right') ? 'right' : 'left';
      const drawingSide = fighter.rig.handDrawingSide(side);
      const paths = side === 'right' ? handlePaths(drawingSide) : handPaths(.25, drawingSide);
      stroke(group, paths.stem.map(p => p.toArray()));
      const lines = paths.fingers.map(points => stroke(group, points.map(p => p.toArray())));
      gripLines[side].push(...lines);
    } else if (part.shape === 'foot') {
      stroke(group, [[0, 0, -.08], [0, -.032, -.08], [0, -.04, -.025], [0, -.04, .10]]);
    } else {
      stroke(group, [[0, -part.length / 2, 0], [0, part.length / 2, 0]]);
      if (part.name === 'chest') {
        stroke(group, [[-.21, part.length / 2, 0], [.21, part.length / 2, 0]]);
        stroke(group, [[0, part.length / 2, 0], [0, part.length / 2 + .11, 0]]);
      }
    }
  }
  const trailGeo = new T.BufferGeometry().setFromPoints(Array.from({ length: 12 }, () => new T.Vector3())); geometries.push(trailGeo);
  const trailMat = new T.LineBasicMaterial({ color, transparent: true, opacity: .20, depthWrite: false }); materials.push(trailMat);
  const trail = new T.Line(trailGeo, trailMat); scene.add(trail); const history: T.Vector3[] = [];
  const wasHolding = { left: false, right: true };
  const woundCaps: T.Mesh[] = [];
  return {
    update(f: Fighter) {
      for (const [name, mesh] of parts) { const p = f.rig.parts.get(name)!; mesh.position.copy(p.body.translation()); mesh.quaternion.copy(p.body.rotation()).multiply(p.visualRotation); }
      if (mouth) mouth.scale.x = .007 * (1 + f.stagger * 2);
      for (const side of ['left', 'right'] as const) {
        const holding = (held(f) && (f.mainHand === side || supported(f))) || hangingHand(f) === side;
        if (holding !== wasHolding[side]) {
          const drawingSide = f.rig.handDrawingSide(side);
          (holding ? handlePaths(drawingSide) : handPaths(.12, drawingSide)).fingers.forEach((p, i) => gripLines[side][i].geometry.setPositions(p.flatMap(v => v.toArray())));
          wasHolding[side] = holding;
        }
      }
      while (woundCaps.length > f.wounds.length * 2) scene.remove(woundCaps.pop()!);
      for (let i = 0; i < f.wounds.length * 2; i++) {
        const wound = f.wounds[Math.floor(i / 2)], parent = i % 2 === 0;
        const body = f.rig.parts.get(parent ? wound.parent : wound.part)!.body;
        if (!woundCaps[i]) woundCaps[i] = sphere(scene, .012, woundInk);
        woundCaps[i].position.copy(parent ? wound.parentAnchor : wound.childAnchor).applyQuaternion(new T.Quaternion().copy(body.rotation())).add(vec(body.translation()));
      }
      history.unshift(vec([0, f.weapon.spec.tip, 0]).applyQuaternion(new T.Quaternion().copy(f.sword.rotation())).add(vec(f.sword.translation()))); if (history.length > 12) history.pop();
      trail.visible = f.attack && held(f) && !f.down && vec(f.sword.angvel()).length() > 2 && history.length > 2;
      if (trail.visible) trail.geometry.setFromPoints(history);
    },
    setVisible(v: boolean) { parts.forEach(p => { p.visible = v; }); if (!v) trail.visible = false; },
    resetTrail() { history.length = 0; },
    dispose() { parts.forEach(p => scene.remove(p)); woundCaps.forEach(p => scene.remove(p)); scene.remove(trail); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); },
  };
}
