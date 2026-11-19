// js/street-colliders.js
// Player colliders (js/controllers.js: boxes { minX, maxX, minZ, maxZ, maxY, minY }) for the street's thin solid things:
// tree trunks, traffic light, camera and gantry poles. Only the player bumps into them: the traffic's lanes and the
// pedestrians' sidewalks are built without them (main.js hands them to the controllers, not the road network).

/** A pole `half` metres either side of (x, z), standing from the ground up to `top` */
function poleCollider(x, z, half, top) {
  return { minX: x - half, maxX: x + half, minZ: z - half, maxZ: z + half, maxY: top, kind: 'pole' };
}

/**
 * Tree trunks from planting sites ({ x, y, z, height }): a trunk thickening with the tree, up to where its crown
 * spreads (so a low flight passes through the leaves, not a solid crown)
 */
function treeColliders(sites) {
  const out = [];
  for (const s of sites) {
    const h = s.height || 8;
    const half = Math.min(0.42, Math.max(0.2, 0.12 + h * 0.012));
    out.push({ minX: s.x - half, maxX: s.x + half, minZ: s.z - half, maxZ: s.z + half, maxY: (s.y || 0) + h * 0.55, kind: 'tree' });
  }
  return out;
}

export { poleCollider, treeColliders };
