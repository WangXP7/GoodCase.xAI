// Upload bookkeeping for ring buffers of instance records. Slots are written in ring order, so the
// records written since the last upload are one run per ring, or two when its cursor wrapped. Only
// those are sent to the GPU, through reused range objects (no per-frame garbage).
// One instance buffer may hold several rings side by side: regions = [[firstSlot, capacity], ...].
export function createRingUploader(buffer, stride, regions) {
  const rings = regions.map(([start, capacity]) => ({ start, capacity, first: -1, n: 0, r0: { start: 0, count: 0 }, r1: { start: 0, count: 0 } }));
  const whole = { start: 0, count: 0 };
  let total = 0;
  for (const r of rings) total = Math.max(total, r.start + r.capacity);
  let dirty = false;

  return {
    // absolute slot i of ring `ring` was written (call in ring order)
    mark(i, ring = 0) { const r = rings[ring]; if (r.first < 0) r.first = i - r.start; r.n++; dirty = true; },
    markAll() { for (const r of rings) { r.first = 0; r.n = r.capacity; } dirty = true; },
    // also send k more slots after the run (records ahead of the cursor that were touched)
    extend(k, ring = 0) { const r = rings[ring]; if (r.first >= 0) r.n += k; },
    // True while a range handed to three has not been uploaded yet (three empties the list when it
    // uploads, which only happens when the mesh is drawn).
    get pending() { return buffer.updateRanges.length > 0; },
    flush() {
      if (!dirty) return;
      const ranges = buffer.updateRanges;
      const stale = ranges.length > 0; // earlier ranges never reached the GPU: send everything
      ranges.length = 0;
      if (stale) {
        whole.start = 0; whole.count = total * stride;
        ranges.push(whole);
      } else {
        for (const r of rings) {
          if (r.n === 0) continue;
          if (r.n >= r.capacity) {
            r.r0.start = r.start * stride; r.r0.count = r.capacity * stride;
            ranges.push(r.r0);
          } else if (r.first + r.n <= r.capacity) {
            r.r0.start = (r.start + r.first) * stride; r.r0.count = r.n * stride;
            ranges.push(r.r0);
          } else {
            r.r0.start = (r.start + r.first) * stride; r.r0.count = (r.capacity - r.first) * stride;
            r.r1.start = r.start * stride; r.r1.count = (r.first + r.n - r.capacity) * stride;
            ranges.push(r.r0, r.r1);
          }
        }
      }
      for (const r of rings) { r.first = -1; r.n = 0; }
      buffer.needsUpdate = true;
      dirty = false;
    },
  };
}
