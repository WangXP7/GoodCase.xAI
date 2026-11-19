import * as T from 'three';
import { WEAPONS, type WeaponKind } from './weapons';

/** Model coordinates match the Rapier collider/handle coordinates, in metres. */
export function createWeaponModel(kind: WeaponKind) {
  const group = new T.Group(), geometries: T.BufferGeometry[] = [], materials: T.Material[] = [];
  const metal = (color: string, roughness: number) => { const m = new T.MeshStandardMaterial({ color, metalness: .82, roughness }); materials.push(m); return m; };
  const steel = metal('#b2b5b4', .29), edge = metal('#d9d7cc', .21), iron = metal('#55514b', .52), bronze = metal('#8a7150', .48);
  const leather = new T.MeshStandardMaterial({ color: '#3c2920', roughness: .92 }); materials.push(leather);
  const add = (geometry: T.BufferGeometry, material: T.Material, y = 0) => { geometries.push(geometry); const m = new T.Mesh(geometry, material); m.position.y = y; m.castShadow = m.receiveShadow = true; group.add(m); return m; };
  const spec = WEAPONS[kind], handle = -spec.center;
  const gripLength = kind === 'greatsword' ? .34 : .18;
  add(new T.CylinderGeometry(.023, .026, gripLength, 12), leather, handle);
  for (let i = 0; i < Math.floor(gripLength / .018); i++) {
    const wrap = add(new T.TorusGeometry(.025, .0018, 4, 12), iron, handle - gripLength / 2 + i * .018);
    wrap.rotation.x = Math.PI / 2; wrap.rotation.z = .06;
  }
  if (kind === 'mace') {
    add(new T.CylinderGeometry(.021, .024, .56, 12), iron, .06);
    add(new T.CylinderGeometry(.043, .042, .23, 12), steel, .29);
    for (let i = 0; i < 6; i++) {
      const shape = new T.Shape(); shape.moveTo(.025, -.12); shape.lineTo(.082, -.085); shape.lineTo(.107, .035); shape.lineTo(.08, .105); shape.lineTo(.025, .12); shape.closePath();
      const geo = new T.ExtrudeGeometry(shape, { depth: .018, bevelEnabled: true, bevelThickness: .003, bevelSize: .003, bevelSegments: 1, steps: 1 });
      geo.translate(0, .29, -.009); const flange = add(geo, steel); flange.rotation.y = i * Math.PI / 3;
    }
    add(new T.SphereGeometry(.045, 12, 8), iron, .405);
    add(new T.CylinderGeometry(.029, .031, .025, 12), bronze, handle - .085);
  } else {
    const base = kind === 'greatsword' ? -.13 : -.25, tip = spec.tip, halfWidth = kind === 'greatsword' ? .036 : .032;
    // A tapered diamond section catches light along its central ridge and sharpened edges.
    const vertices: number[] = [], indices: number[] = [];
    for (const [y, width] of [[base, halfWidth], [tip - .11, halfWidth * .57], [tip, .0006]]) vertices.push(-width, y, 0, 0, y, .009, width, y, 0, 0, y, -.009);
    for (let row = 0; row < 2; row++) for (let i = 0; i < 4; i++) { const a = row * 4 + i, b = row * 4 + (i + 1) % 4; indices.push(a, b, b + 4, a, b + 4, a + 4); }
    indices.push(0, 2, 1, 0, 3, 2);
    const blade = new T.BufferGeometry(); blade.setAttribute('position', new T.Float32BufferAttribute(vertices, 3)); blade.setIndex(indices); blade.computeVertexNormals(); add(blade, steel);
    const guardY = kind === 'greatsword' ? -.26 : -.22, guardWidth = kind === 'greatsword' ? .32 : .25;
    const guardShape = new T.Shape(); guardShape.moveTo(-guardWidth / 2, -.013); guardShape.lineTo(-guardWidth / 2, .012); guardShape.lineTo(0, .023); guardShape.lineTo(guardWidth / 2, .012); guardShape.lineTo(guardWidth / 2, -.013); guardShape.lineTo(0, -.018); guardShape.closePath();
    const guardGeo = new T.ExtrudeGeometry(guardShape, { depth: .042, bevelEnabled: true, bevelThickness: .006, bevelSize: .004, bevelSegments: 2 }); guardGeo.translate(0, 0, -.021); add(guardGeo, iron, guardY);
    const pommel = add(new T.CylinderGeometry(.041, .041, .033, 12), iron, handle - gripLength / 2); pommel.rotation.x = Math.PI / 2;
    const pin = add(new T.SphereGeometry(.012, 8, 6), bronze, handle - gripLength / 2); pin.position.z = .021;
    for (const x of [-1, 1]) { const line = new T.BufferGeometry().setFromPoints([new T.Vector3(x * halfWidth, base, 0), new T.Vector3(x * halfWidth * .57, tip - .11, 0), new T.Vector3(0, tip, 0)]); geometries.push(line); const ink = new T.LineBasicMaterial({ color: '#dfddd1' }); materials.push(ink); group.add(new T.Line(line, ink)); }
    add(new T.CylinderGeometry(.029, .029, .014, 10), edge, handle + gripLength / 2 - .008);
  }
  return { group, dispose() { geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); } };
}
