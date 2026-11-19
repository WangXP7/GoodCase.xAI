// tools/city/graph.mjs — a street centreline graph: nodes at intersections, dead ends and attribute changes, links between
// them with a name, curb-to-curb width, travel lanes, direction of travel and the shape points in between.
// Output (as js/*-geodata.js roadGraph): nodes [x, z, ...], links [node a, node b, name index, width, lanes,
// direction (1: a -> b, -1: b -> a, 0: both), inner shape points [x, z, ...], ...extra], names [...]

const q = (v) => Math.round(v * 10) / 10;

// `merge`: piece ends this close (m) are the same node
export function createGraph({ merge = 1.0 } = {}) {
  const nodes = [];
  const cells = new Map();
  const cellKey = (ix, iz) => ix * 100003 + iz;
  function nodeAt(x, z) {
    const ix = Math.floor(x / merge), iz = Math.floor(z / merge);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const id of cells.get(cellKey(ix + dx, iz + dz)) || []) {
          if (Math.hypot(nodes[id][0] - x, nodes[id][1] - z) <= merge) return id;
        }
      }
    }
    const id = nodes.length;
    nodes.push([x, z]);
    const k = cellKey(ix, iz);
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(id);
    return id;
  }
  // A node by its source id (an OSM node): topology from the data instead of proximity
  const byKey = new Map();
  function nodeByKey(key, x, z) {
    if (!byKey.has(key)) { byKey.set(key, nodes.length); nodes.push([x, z]); }
    return byKey.get(key);
  }
  const names = [];
  const nameIds = new Map();
  const nameId = (n) => {
    if (!nameIds.has(n)) { nameIds.set(n, names.length); names.push(n); }
    return nameIds.get(n);
  };
  const links = [];
  // `line`: the link's full polyline (its ends are the nodes); `extra`: attributes appended to the output link
  const addLink = (a, b, name, w, lanes, dir, line, extra = []) => links.push([a, b, nameId(name), q(w), lanes, dir, line, extra]);
  // Only the nodes the links use, renumbered in link order
  function build() {
    const used = new Map();
    const outNodes = [];
    const idOf = (i) => {
      if (!used.has(i)) { used.set(i, outNodes.length / 2); outNodes.push(q(nodes[i][0]), q(nodes[i][1])); }
      return used.get(i);
    };
    const outLinks = links.map(([a, b, n, w, lanes, dir, line, extra]) => {
      const ia = idOf(a), ib = idOf(b);
      // inner shape points only (the ends are the nodes)
      const inner = line.slice(1, -1).flatMap(([x, z]) => [q(x), q(z)]);
      return [ia, ib, n, w, lanes, dir, inner, ...extra];
    });
    return { nodes: outNodes, links: outLinks, names };
  }
  return { nodeAt, nodeByKey, nameId, addLink, build, links };
}
