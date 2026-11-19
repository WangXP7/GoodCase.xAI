import { createIslandRoads } from './island-roads.js';
import { buildPackedIslandNetwork, packedTransferables } from './island-network.js';

// js/island-network-worker.js
// Builds the island's road graph joined to the city's (js/island-network.js) off the main thread, ~1 s of work:
// { id, url (roads.json), topology (cityTopology()), keepLeft, coreRing } in, { id, packed } (its arrays transferred) or
// { id, error } out. It fetches roads.json itself (from the HTTP cache: the page has just loaded it), rather than be
// sent the main thread's copy, which would cost the main thread the copying.

self.onmessage = async ({ data: { id, url, topology, keepLeft, coreRing } }) => {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const packed = buildPackedIslandNetwork(await r.json(), topology, { keepLeft, coreRing, createRoads: createIslandRoads });
    self.postMessage({ id, packed }, packedTransferables(packed));
  } catch (e) {
    self.postMessage({ id, error: e.message || String(e) });
  }
};
