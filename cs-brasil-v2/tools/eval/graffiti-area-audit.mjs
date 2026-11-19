// Keep all measurement dependencies inside this function: the browser receives
// its source, THREE and the paintability predicate, never production coverage.
export async function measureGraffitiArea(root, piece, THREE, predicate) {
  const { x, y, z, ry, w, h } = piece;
  if (![x, y, z, ry, w, h].every(Number.isFinite) || w <= 0 || h <= 0)
    return { supported: false, uncoveredArea: Infinity, reason: 'invalid-piece' };
  // Mesmo orçamento numérico por quad do contrato; o algoritmo de medição continua independente.
  const tolerance = Math.max(1, w * h) * 1e-10;
  const polygonArea = polygon => {
    let sum = 0;
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i], q = polygon[(i + 1) % polygon.length];
      sum += p[0] * q[1] - q[0] * p[1];
    }
    return sum / 2;
  };
  // Split once, retaining both sides. This also interpolates triangle depth.
  const split = (polygon, a, b, c) => {
    const positive = [], negative = [];
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i], q = polygon[(i + 1) % polygon.length];
      const dp = a * p[0] + b * p[1] + c, dq = a * q[0] + b * q[1] + c;
      if (dp >= 0) positive.push(p);
      if (dp <= 0) negative.push(p);
      if (dp * dq < 0) {
        const t = dp / (dp - dq), point = p.map((value, k) => value + t * (q[k] - value));
        positive.push(point); negative.push(point);
      }
    }
    return [positive, negative];
  };
  const halfPlane = (polygon, a, b, c) => split(polygon, a, b, c)[0];
  const rectangle = polygon => {
    for (const [a, b, c] of [[1, 0, w / 2], [-1, 0, w / 2], [0, 1, h / 2], [0, -1, h / 2]])
      polygon = halfPlane(polygon, a, b, c);
    return polygon;
  };
  const meaningful = polygon => polygon.length >= 3 && Math.abs(polygonArea(polygon)) > 0;
  const bounds = polygon => polygon.auditBounds ||= polygon.reduce((box, p) =>
    [Math.min(box[0], p[0]), Math.min(box[1], p[1]), Math.max(box[2], p[0]), Math.max(box[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
  const difference = (subject, cut) => {
    const s = bounds(subject), t = bounds(cut);
    if (s[0] >= t[2] || s[2] <= t[0] || s[1] >= t[3] || s[3] <= t[1]) return [subject];
    const output = [];
    let pending = subject;
    for (let i = 0; i < cut.length && meaningful(pending); i++) {
      const p = cut[i], q = cut[(i + 1) % cut.length];
      if (p[0] === q[0] && p[1] === q[1]) continue;
      const a = p[1] - q[1], b = q[0] - p[0], c = -a * p[0] - b * p[1];
      const [inside, outside] = split(pending, a, b, c);
      if (meaningful(outside)) output.push(outside);
      pending = inside;
    }
    return output;
  };
  const nx = Math.sin(ry), nz = Math.cos(ry), ux = Math.cos(ry), uz = -Math.sin(ry);
  const maximumDepth = .05;
  const query = new THREE.Box3();
  for (const u of [-w / 2, w / 2]) for (const v of [-h / 2, h / 2]) for (const d of [-.02, maximumDepth])
    query.expandByPoint(new THREE.Vector3(x + ux * u - nx * d, y + v, z + uz * u - nz * d));
  query.expandByScalar(1e-9);
  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse(mesh => {
    if (!mesh.isMesh || !mesh.geometry?.attributes?.position || !mesh.material || !(mesh.layers.mask & 1)) return;
    for (let ancestor = mesh; ancestor; ancestor = ancestor.parent)
      if (!ancestor.visible || /^(decal:|mural:)/.test(ancestor.name || '')) return;
    if (new THREE.Box3().setFromObject(mesh).intersectsBox(query)) meshes.push(mesh);
  });
  // Cached local bounds contain no projected or world-space triangle copies.
  const cache = measureGraffitiArea.geometryCache ||= new WeakMap();
  const indexedBounds = geometry => {
    const position = geometry.attributes.position, indices = geometry.index;
    const count = indices?.count ?? position.count, blockSize = 96 * 3;
    const previous = cache.get(geometry);
    if (previous?.position === position && previous.indices === indices && previous.count === count
      && previous.pVersion === position.version && previous.iVersion === indices?.version) return previous;
    const blocks = [];
    const v = new THREE.Vector3();
    for (let start = 0; start < count; start += blockSize) {
      const box = new THREE.Box3(), end = Math.min(count, start + blockSize);
      for (let i = start; i < Math.min(count, end + 2); i++) box.expandByPoint(v.fromBufferAttribute(position, indices ? indices.getX(i) : i));
      blocks.push({ start, end, box });
    }
    const value = { position, indices, count, pVersion: position.version, iVersion: indices?.version, blocks };
    cache.set(geometry, value); return value;
  };
  const supports = [], obstacles = [];
  let penetration = false;
  const transform = new THREE.Matrix4(), instanceTransform = new THREE.Matrix4();
  const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
  const normal = new THREE.Vector3(), edge = new THREE.Vector3(), otherEdge = new THREE.Vector3();
  for (const mesh of meshes) {
    const geometry = mesh.geometry, eligible = predicate(mesh), lookup = indexedBounds(geometry);
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const start = geometry.drawRange.start, end = Math.min(lookup.count, start + geometry.drawRange.count);
    const spans = Array.isArray(mesh.material)
      ? geometry.groups.map(group => ({ start: Math.max(start, group.start), end: Math.min(end, group.start + group.count), material: mesh.material[group.materialIndex] }))
      : [{ start, end, material: mesh.material }];
    for (let instance = 0; instance < (mesh.isInstancedMesh ? mesh.count : 1); instance++) {
      transform.copy(mesh.matrixWorld);
      if (mesh.isInstancedMesh) { mesh.getMatrixAt(instance, instanceTransform); transform.multiply(instanceTransform); }
      if (!geometry.boundingBox.clone().applyMatrix4(transform).intersectsBox(query)) continue;
      const inverse = transform.clone().invert(), localQuery = query.clone().applyMatrix4(inverse);
      const determinantSign = transform.determinant() < 0 ? -1 : 1;
      for (const span of spans) {
        const material = span.material;
        if (!material || material.visible === false || material.colorWrite === false || material.opacity <= 0) continue;
        for (const block of lookup.blocks) {
          if (block.end <= span.start || block.start >= span.end || !block.box.intersectsBox(localQuery)) continue;
          const first = span.start + Math.ceil((Math.max(block.start, span.start) - span.start) / 3) * 3;
          for (let offset = first; offset < block.end && offset + 2 < span.end; offset += 3) {
            const vertex = k => lookup.indices ? lookup.indices.getX(offset + k) : offset + k;
            v0.fromBufferAttribute(lookup.position, vertex(0)).applyMatrix4(transform);
            v1.fromBufferAttribute(lookup.position, vertex(1)).applyMatrix4(transform);
            v2.fromBufferAttribute(lookup.position, vertex(2)).applyMatrix4(transform);
            normal.crossVectors(edge.subVectors(v1, v0), otherEdge.subVectors(v2, v0)).normalize().multiplyScalar(determinantSign);
            const facing = normal.x * nx + normal.z * nz;
            if ((material.side === THREE.FrontSide && facing <= 0) || (material.side === THREE.BackSide && facing >= 0)) continue;
            let polygon = [v0, v1, v2].map(v => [(v.x - x) * ux + (v.z - z) * uz, v.y - y, (x - v.x) * nx + (z - v.z) * nz]);
            const p = polygon[0], q = polygon[1], r = polygon[2];
            const det = (q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1]);
            if (det === 0) continue;
            const du = ((q[2] - p[2]) * (r[1] - p[1]) - (r[2] - p[2]) * (q[1] - p[1])) / det;
            const dv = ((q[0] - p[0]) * (r[2] - p[2]) - (r[0] - p[0]) * (q[2] - p[2])) / det;
            const depth = [du, dv, p[2] - du * p[0] - dv * p[1]];
            polygon = rectangle(polygon);
            if (!meaningful(polygon)) continue;
            if (polygonArea(polygon) < 0) polygon.reverse();
            const inSlab = (poly, minimum, maximum) => halfPlane(halfPlane(poly, du, dv, depth[2] - minimum), -du, -dv, maximum - depth[2]);
            const penetrated = inSlab(polygon, -.02, -1e-9);
            if (meaningful(penetrated)) {
              obstacles.push({ polygon: penetrated, depth }); penetration = true;
            }
            polygon = inSlab(polygon, 0, maximumDepth);
            if (!meaningful(polygon)) continue;
            const entry = { polygon, depth };
            (eligible && facing >= .98 ? supports : obstacles).push(entry);
          }
        }
      }
    }
  }
  let remaining = [[[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]];
  supports.sort((a, b) => Math.abs(polygonArea(b.polygon)) - Math.abs(polygonArea(a.polygon)));
  for (const support of supports) {
    let exposed = [support.polygon];
    for (const obstacle of obstacles) {
      const [a, b, c] = support.depth;
      const [d, e, f] = obstacle.depth;
      const front = halfPlane(obstacle.polygon, a - d, b - e, c - f + 1e-9);
      if (meaningful(front)) exposed = exposed.flatMap(poly => difference(poly, front));
      if (!exposed.length) break;
    }
    for (const poly of exposed) remaining = remaining.flatMap(uncovered => difference(uncovered, poly));
    if (!remaining.length) break;
  }
  const uncoveredArea = remaining.reduce((sum, poly) => sum + Math.abs(polygonArea(poly)), 0);
  return { supported: uncoveredArea <= tolerance, uncoveredArea,
    reason: uncoveredArea <= tolerance ? null : penetration ? 'foreground-penetration' : 'uncovered-or-ineligible-area' };
}

if (typeof process !== 'undefined' && process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const THREE = await import('three');
  const assert = (await import('node:assert/strict')).default;
  const measure = (0, eval)(`(${measureGraffitiArea.toString()})`);
  const predicate = mesh => !mesh.userData.nonSolidSurface && !/plant/.test(mesh.name)
    && !mesh.material.transparent && !mesh.material.alphaTest;
  const piece = { x: 0, y: 2, z: .13, ry: 0, w: 2, h: 2 };
  const panel = (lo, hi, z = 0, name = 'concrete') => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(hi - lo, 4, .2), new THREE.MeshLambertMaterial());
    mesh.position.set((hi + lo) / 2, 2, z); mesh.name = name; return mesh;
  };
  const root = (...meshes) => { const group = new THREE.Group(); group.add(...meshes); return group; };
  let count = 0;
  const check = async (name, scene, art, expected) => {
    const result = await measure(scene, art, THREE, predicate);
    assert.equal(result.supported, expected, `${name}: ${JSON.stringify(result)}`);
    console.log(`PASS ${name} uncovered=${result.uncoveredArea}`); count++;
  };
  await check('plain wall', root(panel(-2, 2)), piece, true);
  await check('joined coplanar wall', root(panel(-2, .2), panel(.2, 2)), piece, true);
  for (const gap of [.1, .000001]) await check(`slit ${gap}m`, root(panel(-2, .2), panel(.2 + gap, 2)), piece, false);
  const plant = z => { const mesh = panel(.2, .3, z, 'plant'); mesh.scale.z = .01; mesh.userData.nonSolidSurface = true; return mesh; };
  await check('narrow foreground plant', root(panel(-2, 2), plant(.11)), piece, false);
  await check('plant behind wall', root(panel(-2, 2), plant(-.1)), piece, true);
  await check('plant behind wall inside support slab', root(panel(-2, 2), plant(.08)), piece, true);
  await check('plant penetrates paint between sample columns', root(panel(-2, 2), plant(.14)), piece, false);
  const invisible = panel(-2, 2); invisible.material.visible = false;
  await check('invisible wall', root(invisible), piece, false);
  const hiddenPlant = plant(.11); hiddenPlant.material.visible = false;
  await check('invisible foreground plant', root(panel(-2, 2), hiddenPlant), piece, true);
  const glass = panel(-2, 2); glass.material.transparent = true; glass.material.opacity = .4;
  await check('transparent wall', root(glass), piece, false);
  await check('edge overhang', root(panel(-.4, .4)), piece, false);
  const oblique = panel(-2, 2); oblique.rotation.y = .25;
  await check('oblique support normal', root(oblique), { ...piece, w: .1, h: .5 }, false);
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(4, 4, .2), new THREE.MeshLambertMaterial(), 1);
  const parent = new THREE.Group(); parent.rotation.y = .7;
  mesh.setMatrixAt(0, new THREE.Matrix4().compose(new THREE.Vector3(2, 2, -1), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), .3), new THREE.Vector3(1.3, 1, .8)));
  parent.add(mesh); parent.updateMatrixWorld(true);
  const center = new THREE.Vector3(2, 2, -1).applyMatrix4(parent.matrixWorld);
  await check('scaled rotated instance', parent, { x: center.x + Math.sin(1) * .11, y: center.y, z: center.z + Math.cos(1) * .11, ry: 1, w: 2, h: 2 }, true);
  const sheared = new THREE.InstancedMesh(new THREE.BoxGeometry(4, 4, .2), new THREE.MeshLambertMaterial(), 1);
  sheared.setMatrixAt(0, new THREE.Matrix4().set(1, 0, .3, 0, 0, 1, 0, 2, 0, 0, 1, 0, 0, 0, 0, 1));
  await check('affine sheared instance', root(sheared), { ...piece, x: .03 }, true);
  const reflected = panel(-2, 2); reflected.scale.x = -1;
  await check('mirrored support winding', root(reflected), piece, true);
  const partialGeometry = new THREE.BufferGeometry();
  partialGeometry.setAttribute('position', new THREE.Float32BufferAttribute([10, 10, .1, -2, 0, .1, 2, 0, .1, 0, 4, .1, 10, 10, .1, 11, 10, .1], 3));
  partialGeometry.setDrawRange(1, 3);
  await check('drawRange starts at actual renderer offset', root(new THREE.Mesh(partialGeometry, new THREE.MeshLambertMaterial())), { ...piece, w: .5, h: 1 }, true);
  const densePlant = new THREE.Mesh(new THREE.PlaneGeometry(.001, .001, 40, 40), new THREE.MeshLambertMaterial());
  densePlant.position.set(.25, 2.25, .115); densePlant.name = 'plant'; densePlant.userData.nonSolidSurface = true;
  await check('tessellated foreground accumulates whole area', root(panel(-2, 2), densePlant), piece, false);
  const narrowWall = new THREE.Mesh(new THREE.BoxGeometry(.4, 2, .2), new THREE.MeshLambertMaterial());
  narrowWall.position.set(40, 1, 0);
  const narrowPiece = { x: 40, y: 1, z: .13, ry: 0, w: .4, h: 2 };
  await check('nominal rectangle before Float32 widening', root(narrowWall), narrowPiece, true);
  const drawnGeometry = new THREE.PlaneGeometry(.4, 2).translate(40, 1, .13);
  const positions = drawnGeometry.attributes.position;
  const left = new THREE.Vector3().fromBufferAttribute(positions, 0);
  const right = new THREE.Vector3().fromBufferAttribute(positions, 1);
  const bottom = new THREE.Vector3().fromBufferAttribute(positions, 3);
  const actual = { x: (left.x + bottom.x) / 2, y: (left.y + bottom.y) / 2,
    z: left.z, ry: 0, w: right.x - left.x, h: left.y - bottom.y };
  assert.ok(actual.w > narrowPiece.w, 'actual vertices reproduce Float32 expansion');
  await check('actual Float32 rectangle overhang is rejected', root(narrowWall), actual, false);
  drawnGeometry.dispose();
  const hiddenBridge = panel(.2, .200001); hiddenBridge.layers.set(1);
  await check('hidden render layer cannot bridge unsampled slit', root(panel(-2, .2), panel(.200001, 2), hiddenBridge), piece, false);
  console.log(`Area audit: ${count} serialized-function fixtures passed`);
}
