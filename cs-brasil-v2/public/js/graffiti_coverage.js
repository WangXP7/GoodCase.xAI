import * as THREE from 'three';

// Índice esparso da geometria evita manter uma segunda cópia do mapa.
// Só os blocos consultados produzem triângulos temporários no espaço global.
const BLOCK = 128, geometryIndices = new WeakMap();
const EPS = 1e-10;
const area = poly => Math.abs(poly.reduce((sum, a, i) => {
  const b = poly[(i + 1) % poly.length]; return sum + a[0] * b[1] - b[0] * a[1];
}, 0)) / 2;
const signedArea = poly => poly.reduce((sum, a, i) => {
  const b = poly[(i + 1) % poly.length]; return sum + a[0] * b[1] - b[0] * a[1];
}, 0);
function normalizarPoligono(poly) {
  const coincidem = (a, b) => [0, 1].every(i =>
    Math.abs(a[i] - b[i]) <= 8 * Number.EPSILON * Math.max(1, Math.abs(a[i]), Math.abs(b[i])));
  const out = [];
  for (const point of poly) {
    if (!out.length || !coincidem(out[out.length - 1], point)) out.push(point);
  }
  if (out.length > 1 && coincidem(out[0], out[out.length - 1])) out.pop();
  return out;
}
function clip(poly, distance) {
  const out = [];
  if (!poly.length) return out;
  let a = poly[poly.length - 1], da = distance(a);
  for (const b of poly) {
    const db = distance(b), aInside = da >= 0, bInside = db >= 0;
    if (aInside !== bInside) {
      const t = da / (da - db);
      out.push(a.map((v, i) => v + (b[i] - v) * t));
    }
    if (bInside) out.push(b);
    a = b; da = db;
  }
  // Interpolação pode criar arestas invertidas de poucos ULPs; elas não
  // representam um semiplano. O orçamento de área do quad continua intacto.
  return normalizarPoligono(out);
}
function rectangleClip(poly, w, h) {
  return clip(clip(clip(clip(poly, p => p[0] + w / 2), p => w / 2 - p[0]), p => p[1] + h / 2), p => h / 2 - p[1]);
}
// Diferença de polígonos convexos gera fragmentos disjuntos. A repetição
// calcula o retângulo menos a união dos triângulos realmente desenhados.
function subtract(subject, cutter) {
  if (!overlaps(boundsOf(subject), boundsOf(cutter))) return [subject];
  const out = []; let inside = subject;
  for (let i = 0; i < cutter.length && inside.length >= 3; i++) {
    const a = cutter[i], b = cutter[(i + 1) % cutter.length];
    if (a[0] === b[0] && a[1] === b[1]) continue;
    const edge = p => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const outside = clip(inside, p => -edge(p));
    if (outside.length >= 3 && area(outside) > 0) out.push(outside);
    inside = clip(inside, edge);
  }
  return out;
}
function indexGeometry(geometry) {
  const position = geometry.attributes.position, index = geometry.index;
  const count = index?.count ?? position.count;
  const old = geometryIndices.get(geometry);
  if (old?.position === position && old.index === index && old.pVersion === position.version && old.iVersion === index?.version && old.count === count) return old;
  const bounds = new Float64Array(Math.ceil(count / (BLOCK * 3)) * 6);
  for (let block = 0; block * BLOCK * 3 < count; block++) {
    const offset = block * 6;
    bounds[offset] = bounds[offset + 1] = bounds[offset + 2] = Infinity;
    bounds[offset + 3] = bounds[offset + 4] = bounds[offset + 5] = -Infinity;
    for (let k = block * BLOCK * 3; k < Math.min(count, (block + 1) * BLOCK * 3 + 2); k++) {
      const vertex = index ? index.getX(k) : k;
      const x = position.getX(vertex), y = position.getY(vertex), z = position.getZ(vertex);
      bounds[offset] = Math.min(bounds[offset], x); bounds[offset + 3] = Math.max(bounds[offset + 3], x);
      bounds[offset + 1] = Math.min(bounds[offset + 1], y); bounds[offset + 4] = Math.max(bounds[offset + 4], y);
      bounds[offset + 2] = Math.min(bounds[offset + 2], z); bounds[offset + 5] = Math.max(bounds[offset + 5], z);
    }
  }
  const cached = { position, index, pVersion: position.version, iVersion: index?.version, count, bounds };
  geometryIndices.set(geometry, cached); return cached;
}
const boundsOf = poly => poly.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
const overlaps = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
const quadOf = b => [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]];
const clipBounds = (poly, b) => clip(clip(clip(clip(poly, p => p[0] - b[0]), p => b[2] - p[0]), p => p[1] - b[1]), p => b[3] - p[1]);
// Células adaptativas limitam fragmentação; cada célula exige cobertura inteira.
// Subdividir não troca a união de triângulos por amostras pontuais.
function coveredRectangle(w, h, supports, blockers, epsilon) {
  const stack = [{ bounds: [-w / 2, -h / 2, w / 2, h / 2], supports, blockers, depth: 0 }];
  let missingArea = 0;
  while (stack.length) {
    const node = stack.pop(), bounds = node.bounds;
    if (!node.supports.length) return false;
    if (node.supports.length + node.blockers.length > 32 && node.depth < 20) {
      const axis = bounds[2] - bounds[0] >= bounds[3] - bounds[1] ? 0 : 1;
      const mid = (bounds[axis] + bounds[axis + 2]) / 2;
      const left = bounds.slice(), right = bounds.slice(); left[axis + 2] = mid; right[axis] = mid;
      for (const child of [left, right]) {
        stack.push({ bounds: child, depth: node.depth + 1,
          supports: node.supports.filter(s => overlaps(child, s.bounds)),
          blockers: node.blockers.filter(s => overlaps(child, s.bounds)) });
      }
      continue;
    }
    // A tolerância numérica vale uma vez para a soma do quad inteiro.
    let uncovered = [quadOf(bounds)];
    for (const support of node.supports) {
      const clippedSupport = clipBounds(support.poly, bounds);
      if (clippedSupport.length < 3 || area(clippedSupport) <= 0) continue;
      let fragments = [clippedSupport];
      for (const blocker of node.blockers) {
        if (!overlaps(support.bounds, blocker.bounds)) continue;
        const inFront = clip(clipBounds(blocker.poly, bounds), p => support.depth[0] * p[0] + support.depth[1] * p[1] + support.depth[2] - p[2] + 1e-9);
        if (inFront.length >= 3 && area(inFront) > 0) fragments = fragments.flatMap(poly => subtract(poly, inFront));
        if (!fragments.length) break;
      }
      for (const fragment of fragments) {
        uncovered = uncovered.flatMap(poly => subtract(poly, fragment));
        if (!uncovered.length) break;
      }
      if (!uncovered.length) break;
    }
    missingArea += uncovered.reduce((sum, poly) => sum + area(poly), 0);
    if (missingArea > epsilon) return false;
  }
  return true;
}
const rendered = material => material && material.visible !== false && material.colorWrite !== false && material.opacity > 0;

// Cobertura projetada usa triângulos visíveis e profundidades da superfície.
// A tolerância pertence ao quad inteiro, inclusive nos triângulos minúsculos.
export function criarCoberturaGrafite(superficieGrafitavel, maxDepth) {
  const meshBounds = new WeakMap(), world = new THREE.Matrix4(), local = new THREE.Matrix4(), inverse = new THREE.Matrix4();
  const query = new THREE.Box3(), localQuery = new THREE.Box3(), blockBox = new THREE.Box3(), instanceBox = new THREE.Box3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), ab = new THREE.Vector3(), ac = new THREE.Vector3();
  const geometricNormal = new THREE.Vector3(), normalMatrix = new THREE.Matrix3();
  return (piece, meshes) => {
    const { x, y, z, ry, w, h } = piece;
    const nx = Math.sin(ry), nz = Math.cos(ry), ux = Math.cos(ry), uz = -Math.sin(ry);
    const epsilon = EPS * Math.max(1, w * h), supports = [], blockers = [];
    query.makeEmpty();
    for (const u of [-w / 2, w / 2]) for (const v of [-h / 2, h / 2]) for (const d of [-.02, maxDepth]) {
      query.expandByPoint(a.set(x + ux * u - nx * d, y + v, z + uz * u - nz * d));
    }
    query.expandByScalar(1e-8);
    for (const mesh of meshes) {
      let bounds = meshBounds.get(mesh);
      if (!bounds) { bounds = new THREE.Box3().setFromObject(mesh); meshBounds.set(mesh, bounds); }
      if (!bounds.intersectsBox(query)) continue;
      const geometry = mesh.geometry, position = geometry.attributes.position;
      if (!position) continue;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      const eligible = superficieGrafitavel(mesh), materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const drawStart = geometry.drawRange.start, drawEnd = Math.min(geometry.index?.count ?? position.count, drawStart + geometry.drawRange.count);
      const spans = Array.isArray(mesh.material) ? geometry.groups.map(g => ({ start: Math.max(drawStart, g.start), end: Math.min(drawEnd, g.start + g.count), material: materials[g.materialIndex] }))
        : [{ start: drawStart, end: drawEnd, material: materials[0] }];
      const visibleSpans = spans.filter(s => rendered(s.material) && s.end > s.start);
      if (!visibleSpans.length) continue;
      for (let instance = 0; instance < (mesh.isInstancedMesh ? mesh.count : 1); instance++) {
        world.copy(mesh.matrixWorld);
        if (mesh.isInstancedMesh) { mesh.getMatrixAt(instance, local); world.multiply(local); }
        instanceBox.copy(geometry.boundingBox).applyMatrix4(world);
        if (!instanceBox.intersectsBox(query)) continue;
        inverse.copy(world).invert(); localQuery.copy(query).applyMatrix4(inverse);
        const indexed = indexGeometry(geometry), index = geometry.index;
        normalMatrix.getNormalMatrix(world);
        for (const span of visibleSpans) {
          const first = span.start, last = span.end;
          for (let block = Math.floor(first / (BLOCK * 3)); block * BLOCK * 3 + 2 < last; block++) {
            const offset = block * 6, bs = indexed.bounds;
            blockBox.min.set(bs[offset], bs[offset + 1], bs[offset + 2]); blockBox.max.set(bs[offset + 3], bs[offset + 4], bs[offset + 5]);
            if (!blockBox.intersectsBox(localQuery)) continue;
            const blockStart = Math.max(first, block * BLOCK * 3);
            const start = first + Math.ceil((blockStart - first) / 3) * 3;
            for (let offset = start; offset + 2 < last && offset < (block + 1) * BLOCK * 3; offset += 3) {
              const ai = index ? index.getX(offset) : offset, bi = index ? index.getX(offset + 1) : offset + 1, ci = index ? index.getX(offset + 2) : offset + 2;
              a.fromBufferAttribute(position, ai); b.fromBufferAttribute(position, bi); c.fromBufferAttribute(position, ci);
              geometricNormal.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a)).applyMatrix3(normalMatrix).normalize();
              const facing = geometricNormal.x * nx + geometricNormal.z * nz;
              if (span.material.side === THREE.FrontSide && facing <= 0 || span.material.side === THREE.BackSide && facing >= 0) continue;
              a.applyMatrix4(world); b.applyMatrix4(world); c.applyMatrix4(world);
              let poly = [a, b, c].map(p => [(p.x - x) * ux + (p.z - z) * uz, p.y - y, (x - p.x) * nx + (z - p.z) * nz]);
              const p0 = poly[0], p1 = poly[1], p2 = poly[2];
              const det = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
              if (det === 0) continue;
              const du = ((p1[2] - p0[2]) * (p2[1] - p0[1]) - (p2[2] - p0[2]) * (p1[1] - p0[1])) / det;
              const dv = ((p1[0] - p0[0]) * (p2[2] - p0[2]) - (p2[0] - p0[0]) * (p1[2] - p0[2])) / det;
              const depth = [du, dv, p0[2] - du * p0[0] - dv * p0[1]];
              poly = rectangleClip(poly, w, h);
              if (poly.length < 3 || area(poly) <= 0) continue;
              if (signedArea(poly) < 0) poly.reverse();
              // Superfície à frente da tinta reprova mesmo quando sua área
              // pequena fica estritamente entre os 25 raios amostrados.
              const penetrated = clip(clip(poly, p => p[2] + .02), p => -1e-9 - p[2]);
              if (penetrated.length >= 3 && area(penetrated) > 0) return false;
              poly = clip(clip(poly, p => p[2]), p => maxDepth - p[2]);
              if (poly.length < 3 || area(poly) <= 0) continue;
              const entry = { poly, depth, area: area(poly), bounds: boundsOf(poly) };
              if (eligible && facing >= .98) supports.push(entry); else blockers.push(entry);
            }
          }
        }
      }
    }
    supports.sort((a, b) => b.area - a.area);
    return coveredRectangle(w, h, supports, blockers, epsilon);
  };
}
