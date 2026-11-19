// Collision against axis-aligned boxes plus a ground plane. Pure logic: no three.js, no DOM.
// A box may carry `obb` ({ c, ax, ay, az, half, surface }): it is then one slice of a rotated prop.
// Movement uses the slice; rays use the oriented box, for an exact hit point and the true normal.
//   raycast(origin, dir, maxDist) -> { dist, pos, normal, surface } | null
//   moveCapsule(pos, radius, height, delta) -> { pos, onGround }     (feet origin, inputs untouched)
// A box may carry `slip` ({ c: [x, z], side: [x, z] unit, fixed? }): nothing can stand on it. Whatever
// lands on it is slid off along +-side (away from c; always +side when `fixed`, as on a perimeter
// barrier, whose top always sheds a body back into the map) and is never on the ground while it is
// there. Nor can it be stepped up onto from the side: a slip box is a wall to anything whose feet
// are below its top (so a run of rail sections, each a step higher, is not a ladder).
// A box with `off` set (an opened door) is ignored by everything until it is cleared again.
//   heightAt(x, z, y) -> the floor a body with its feet at y stands on at (x, z): the highest box top
//   no more than a step above y (so 3.04 on the motel walkway, 0 under it), or the ground.
// Positions and directions may be [x, y, z] arrays or { x, y, z } objects; results are arrays.

export const STEP_HEIGHT = 0.32; // ledges up to this height are walked onto (kerbs, pump islands)
const CELL = 4; // broadphase cell size, metres
const SKIN = 1e-4;
const SLIP_STEP = 0.05; // metres a body slides per movement step on a surface with no footing (about 3 m/s)

const arr = (v) => (Array.isArray(v) || ArrayBuffer.isView(v) ? [Number(v[0]), Number(v[1]), Number(v[2])] : [Number(v.x), Number(v.y), Number(v.z)]);

// The ground is the plane y = 0; surfaceAt(x, z) names what it is made of there.
export function createCollision(colliders, { surfaceAt = () => 'asphalt' } = {}) {

  // ---- broadphase: uniform grid over XZ ------------------------------------------------------
  const cells = new Map();
  const key = (i, j) => (i + 4096) * 8192 + (j + 4096);
  colliders.forEach((b, n) => {
    const i0 = Math.floor(b.min[0] / CELL), i1 = Math.floor(b.max[0] / CELL);
    const j0 = Math.floor(b.min[2] / CELL), j1 = Math.floor(b.max[2] / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = key(i, j);
      let list = cells.get(k);
      if (!list) { list = []; cells.set(k, list); }
      list.push(n);
    }
  });
  const stamp = new Uint32Array(colliders.length);
  let tick = 0;
  const found = [];
  const foundN = []; // index of each found box in `colliders`
  // Slices cut from one rotated prop share an `obb` object. Number the distinct ones here, so the
  // "already tested for this ray" marker lives in this instance and nothing is written onto the
  // colliders, which other collision instances (and the level contract) share.
  const obbIds = new Map();
  const obbOf = new Int32Array(colliders.length).fill(-1);
  colliders.forEach((b, n) => {
    if (!b.obb) return;
    if (!obbIds.has(b.obb)) obbIds.set(b.obb, obbIds.size);
    obbOf[n] = obbIds.get(b.obb);
  });
  const obbStamp = new Uint32Array(obbIds.size);
  function query(x0, z0, x1, z1) {
    found.length = 0; foundN.length = 0;
    tick++;
    const i0 = Math.floor(x0 / CELL), i1 = Math.floor(x1 / CELL), j0 = Math.floor(z0 / CELL), j1 = Math.floor(z1 / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const list = cells.get(key(i, j));
      if (!list) continue;
      for (const n of list) if (stamp[n] !== tick) { stamp[n] = tick; if (!colliders[n].off) { found.push(colliders[n]); foundN.push(n); } }
    }
    return found;
  }

  // ---- raycast ---------------------------------------------------------------------------------
  // Slab test of a ray against the box [mn, mx] in the box's own frame. Returns the entry distance,
  // or -1 for a miss; a ray that starts inside the box (or on a face, pointing out) misses it. The
  // face entered is left in sAxis / sSign. A ray starting exactly on a face and pointing inward
  // enters at distance 0.
  let sAxis = 0, sSign = 0;
  const EPS = 1e-9;
  function slab(o, d, mn, mx, best) {
    let t0 = -Infinity, t1 = best, axis = -1, sign = 0;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-12) {
        if (o[a] < mn[a] || o[a] > mx[a]) return -1;
        continue;
      }
      let ta = (mn[a] - o[a]) / d[a], tb = (mx[a] - o[a]) / d[a];
      let s = -1;
      if (ta > tb) { const t = ta; ta = tb; tb = t; s = 1; }
      if (ta > t0) { t0 = ta; axis = a; sign = s; }
      if (tb < t1) t1 = tb;
      if (t0 > t1) return -1;
    }
    if (axis < 0 || t0 < -EPS) return -1; // started inside
    sAxis = axis; sSign = sign;
    return t0 > 0 ? t0 : 0;
  }

  let rayTick = 0;
  const lo = [0, 0, 0], ld = [0, 0, 0], lmn = [0, 0, 0], lmx = [0, 0, 0];
  function raycast(origin, dir, maxDist = 100) {
    const o = arr(origin);
    const d = arr(dir);
    const len = Math.hypot(d[0], d[1], d[2]);
    if (!(len > 0) || !o.every(Number.isFinite)) return null;
    d[0] /= len; d[1] /= len; d[2] /= len;
    let best = maxDist;
    let hit = null;
    let normal = null;
    rayTick++;

    const ex = o[0] + d[0] * maxDist, ez = o[2] + d[2] * maxDist;
    const boxes = query(Math.min(o[0], ex), Math.min(o[2], ez), Math.max(o[0], ex), Math.max(o[2], ez));
    for (let k = 0; k < boxes.length; k++) {
      const b = boxes[k];
      const ob = b.obb;
      if (!ob) {
        const t = slab(o, d, b.min, b.max, best);
        if (t >= 0 && t < best) { best = t; hit = b; normal = [0, 0, 0]; normal[sAxis] = sSign; }
        continue;
      }
      // a slice of a rotated prop: test the oriented box it was cut from, once per ray
      const id = obbOf[foundN[k]];
      if (obbStamp[id] === rayTick) continue;
      obbStamp[id] = rayTick;
      const rx = o[0] - ob.c[0], ry = o[1] - ob.c[1], rz = o[2] - ob.c[2];
      const axes = [ob.ax, ob.ay, ob.az];
      for (let a = 0; a < 3; a++) {
        const u = axes[a];
        lo[a] = rx * u[0] + ry * u[1] + rz * u[2];
        ld[a] = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
        lmn[a] = -ob.half[a]; lmx[a] = ob.half[a];
      }
      const t = slab(lo, ld, lmn, lmx, best);
      if (t >= 0 && t < best) { best = t; hit = ob; const u = axes[sAxis]; normal = [u[0] * sSign, u[1] * sSign, u[2] * sSign]; }
    }

    let ground = null;
    if (d[1] < 0 && o[1] >= 0) {
      const t = -o[1] / d[1];
      if (t <= best) ground = { t, surface: surfaceAt(o[0] + d[0] * t, o[2] + d[2] * t) };
    }
    if (ground && ground.t <= best) {
      return { dist: ground.t, pos: [o[0] + d[0] * ground.t, o[1] + d[1] * ground.t, o[2] + d[2] * ground.t], normal: [0, 1, 0], surface: ground.surface };
    }
    if (!hit) return null;
    return { dist: best, pos: [o[0] + d[0] * best, o[1] + d[1] * best, o[2] + d[2] * best], normal, surface: hit.surface };
  }

  // ---- capsule (treated as an upright cylinder: radius r, feet at pos.y, crown at pos.y + h) ---
  // Highest surface under the cylinder's footprint that the feet can rest on from height y.
  function floorUnder(x, y, z, r, boxes) {
    let top = 0;
    const rr = r * 0.85; // a little inside the rim, so brushing a ledge does not lift the player
    for (const b of boxes) {
      if (b.slip || b.max[1] > y + STEP_HEIGHT + SKIN || b.max[1] <= top) continue;
      const dx = x < b.min[0] ? b.min[0] - x : x > b.max[0] ? x - b.max[0] : 0;
      const dz = z < b.min[2] ? b.min[2] - z : z > b.max[2] ? z - b.max[2] : 0;
      if (dx * dx + dz * dz < rr * rr) top = b.max[1];
    }
    return top;
  }
  // The highest box under the footprint that cannot be stood on (`slip`: a vehicle's bonnet, roof or
  // boot) and that the feet have come down onto from height y. Null when there is none.
  function slipUnder(x, y, z, r, boxes, above) {
    let found = null;
    const rr = r * 0.85;
    for (const b of boxes) {
      if (!b.slip || b.max[1] > y + STEP_HEIGHT + SKIN || b.max[1] <= above || (found && b.max[1] <= found.max[1])) continue;
      const dx = x < b.min[0] ? b.min[0] - x : x > b.max[0] ? x - b.max[0] : 0;
      const dz = z < b.min[2] ? b.min[2] - z : z > b.max[2] ? z - b.max[2] : 0;
      if (dx * dx + dz * dz < rr * rr) found = b;
    }
    return found;
  }

  function moveCapsule(pos, radius, height, delta) {
    const p = arr(pos);
    const d = arr(delta);
    const r = radius;
    const horiz = Math.hypot(d[0], d[2]);
    const steps = Math.max(1, Math.ceil(Math.max(horiz / (r * 0.5), Math.abs(d[1]) / 0.25)));
    const sx = d[0] / steps, sy = d[1] / steps, sz = d[2] / steps;
    const reach = r + horiz + 0.5;
    const boxes = query(p[0] - reach, p[2] - reach, p[0] + reach, p[2] + reach).slice();
    let onGround = false;

    for (let s = 0; s < steps; s++) {
      // -- vertical
      const y0 = p[1];
      p[1] += sy;
      if (sy > 0) {
        for (const b of boxes) { // head against an underside
          if (b.min[1] < y0 + height - SKIN || b.min[1] >= p[1] + height) continue;
          if (p[0] + r * 0.85 > b.min[0] && p[0] - r * 0.85 < b.max[0] && p[2] + r * 0.85 > b.min[2] && p[2] - r * 0.85 < b.max[2]) p[1] = b.min[1] - height;
        }
      }
      // -- horizontal, then push out of anything too tall to step onto
      p[0] += sx; p[2] += sz;
      for (let iter = 0; iter < 4; iter++) {
        let moved = false;
        for (const b of boxes) {
          if (b.max[1] <= (b.slip ? Math.max(p[1], y0) + SKIN : p[1] + STEP_HEIGHT) || b.min[1] >= p[1] + height) continue;
          const cx = Math.min(Math.max(p[0], b.min[0]), b.max[0]);
          const cz = Math.min(Math.max(p[2], b.min[2]), b.max[2]);
          let dx = p[0] - cx, dz = p[2] - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= r * r) continue;
          if (d2 > 1e-12) {
            const dist = Math.sqrt(d2);
            const push = r - dist + SKIN;
            p[0] += (dx / dist) * push; p[2] += (dz / dist) * push;
          } else {
            // centre inside the box: leave by the nearest face
            const l = p[0] - b.min[0], rt = b.max[0] - p[0], n = p[2] - b.min[2], f = b.max[2] - p[2];
            const m = Math.min(l, rt, n, f);
            if (m === l) p[0] = b.min[0] - r - SKIN; else if (m === rt) p[0] = b.max[0] + r + SKIN;
            else if (m === n) p[2] = b.min[2] - r - SKIN; else p[2] = b.max[2] + r + SKIN;
          }
          moved = true;
        }
        if (!moved) break;
      }
      // -- feet: land on, or step up to, whatever is underfoot
      const floor = floorUnder(p[0], Math.max(p[1], y0), p[2], r, boxes);
      if (p[1] <= floor + SKIN) { p[1] = floor; onGround = true; } else onGround = false;
      // -- a surface that gives no footing (a wet car body): the feet are carried on it but never
      // planted, so there is no jumping from it, and the body is slid off sideways, toward the
      // nearer flank of the vehicle, until it drops to the ground.
      const slick = slipUnder(p[0], Math.max(p[1], y0), p[2], r, boxes, floor);
      if (slick && p[1] <= slick.max[1] + SKIN) {
        const sl = slick.slip;
        const side = sl.fixed || (p[0] - sl.c[0]) * sl.side[0] + (p[2] - sl.c[1]) * sl.side[1] >= 0 ? 1 : -1;
        p[1] = slick.max[1];
        p[0] += sl.side[0] * side * SLIP_STEP; p[2] += sl.side[1] * side * SLIP_STEP;
        onGround = false;
      }
    }
    return { pos: p, onGround };
  }

  function heightAt(x, z, y = 0) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
    const boxes = query(x, z, x, z);
    let top = 0;
    const yy = Number.isFinite(y) ? y : 0;
    for (let k = 0; k < boxes.length; k++) {
      const b = boxes[k];
      if (b.slip || b.max[1] > yy + STEP_HEIGHT + SKIN || b.max[1] <= top) continue;
      if (x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2]) top = b.max[1];
    }
    return top;
  }

  return { raycast, moveCapsule, heightAt, colliders };
}
