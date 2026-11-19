// Static collision world for the player, thrown bottles and line-of-sight: boxes (yawed), upright
// cylinders and spheres in a uniform grid. Everything dynamic (crates, rubble) lives in cannon-es;
// this is the cheap exact layer that the kinematic player walks on.
const CELL = 8;
const key = (i, j) => (i + 512) * 2048 + (j + 512);

let NEXT = 1;

export class CollisionWorld {
  constructor() {
    this.grid = new Map();
    this.all = new Map();
    this._stamp = 0;
    this._hits = [];
  }

  /**
   * Add a collider. Shapes:
   *  { type:'box', c:[x,y,z], h:[hx,hy,hz], ry }   { type:'cyl', c:[x,y,z], r, h }   { type:'sphere', c, r }
   * Optional: tag (any value handed back by queries), walk (false = cannot be stood on),
   * ghost (true = ignored by the player, still hit by rays).
   */
  add(col) {
    const c = { ...col, id: NEXT++, _s: 0 };
    if (c.type === 'box') {
      c.ry = c.ry || 0;
      c.cos = Math.cos(c.ry);
      c.sin = Math.sin(c.ry);
      const ex = Math.abs(c.cos) * c.h[0] + Math.abs(c.sin) * c.h[2],
        ez = Math.abs(c.sin) * c.h[0] + Math.abs(c.cos) * c.h[2];
      c.x0 = c.c[0] - ex;
      c.x1 = c.c[0] + ex;
      c.z0 = c.c[2] - ez;
      c.z1 = c.c[2] + ez;
      c.y0 = c.c[1] - c.h[1];
      c.y1 = c.c[1] + c.h[1];
    } else if (c.type === 'cyl') {
      c.x0 = c.c[0] - c.r;
      c.x1 = c.c[0] + c.r;
      c.z0 = c.c[2] - c.r;
      c.z1 = c.c[2] + c.r;
      c.y0 = c.c[1] - c.h / 2;
      c.y1 = c.c[1] + c.h / 2;
    } else {
      c.x0 = c.c[0] - c.r;
      c.x1 = c.c[0] + c.r;
      c.z0 = c.c[2] - c.r;
      c.z1 = c.c[2] + c.r;
      c.y0 = c.c[1] - c.r;
      c.y1 = c.c[1] + c.r;
    }
    const i0 = Math.floor(c.x0 / CELL),
      i1 = Math.floor(c.x1 / CELL),
      j0 = Math.floor(c.z0 / CELL),
      j1 = Math.floor(c.z1 / CELL);
    c._cells = [];
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const k = key(i, j);
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(c);
        c._cells.push(k);
      }
    this.all.set(c.id, c);
    return c.id;
  }

  remove(id) {
    const c = this.all.get(id);
    if (!c) return;
    for (const k of c._cells) {
      const list = this.grid.get(k);
      const i = list.indexOf(c);
      if (i >= 0) list.splice(i, 1);
    }
    this.all.delete(id);
  }

  /** Colliders whose box touches the given region (each once). */
  query(x0, x1, z0, z1, out = this._hits) {
    out.length = 0;
    const s = ++this._stamp;
    const i0 = Math.floor(x0 / CELL),
      i1 = Math.floor(x1 / CELL),
      j0 = Math.floor(z0 / CELL),
      j1 = Math.floor(z1 / CELL);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const list = this.grid.get(key(i, j));
        if (!list) continue;
        for (const c of list) {
          if (c._s === s) continue;
          c._s = s;
          if (c.x1 < x0 || c.x0 > x1 || c.z1 < z0 || c.z0 > z1) continue;
          out.push(c);
        }
      }
    return out;
  }

  /**
   * Highest walkable collider top under a disc at (x, z) that lies between yMin and yMax.
   * Returns the y, or -Infinity. `out.col` gets the collider.
   */
  floorAt(x, z, r, yMin, yMax, out = null) {
    let best = -Infinity,
      bc = null;
    const hits = this.query(x - r, x + r, z - r, z + r);
    for (const c of hits) {
      if (c.walk === false || c.ghost) continue;
      if (c.y1 < yMin || c.y1 > yMax || c.y1 <= best) continue;
      if (c.type === 'box') {
        const dx = x - c.c[0],
          dz = z - c.c[2];
        const lx = dx * c.cos - dz * c.sin,
          lz = dx * c.sin + dz * c.cos;
        if (Math.abs(lx) > c.h[0] + r * 0.5 || Math.abs(lz) > c.h[2] + r * 0.5) continue;
      } else if (c.type === 'cyl') {
        if (Math.hypot(x - c.c[0], z - c.c[2]) > c.r + r * 0.5) continue;
      } else continue; // nobody stands on a ball
      best = c.y1;
      bc = c;
    }
    if (out) out.col = bc;
    return best;
  }

  /**
   * Push an upright cylinder (feet at y, radius r, height h) out of everything it overlaps.
   * Colliders whose top is at most `step` above the feet are left alone (the caller steps onto them).
   * Mutates pos {x, z}; returns true if anything was hit. `out.nx/nz` gets the last push direction.
   */
  pushOut(pos, y, r, h, step, out = null) {
    let hit = false;
    const hits = this.query(pos.x - r, pos.x + r, pos.z - r, pos.z + r);
    for (const c of hits) {
      if (c.ghost) continue;
      if (c.y0 >= y + h || c.y1 <= y + 0.02) continue;
      if (c.walk !== false && c.type !== 'sphere' && c.y1 <= y + step) continue;
      let px = 0,
        pz = 0,
        pen = 0;
      if (c.type === 'box') {
        const dx = pos.x - c.c[0],
          dz = pos.z - c.c[2];
        const lx = dx * c.cos - dz * c.sin,
          lz = dx * c.sin + dz * c.cos;
        const qx = Math.max(-c.h[0], Math.min(c.h[0], lx)),
          qz = Math.max(-c.h[2], Math.min(c.h[2], lz));
        let ex = lx - qx,
          ez = lz - qz;
        const d = Math.hypot(ex, ez);
        if (d >= r) continue;
        if (d > 1e-6) {
          pen = r - d;
          ex /= d;
          ez /= d;
        } else {
          // centre inside the box: leave by the nearest face
          const fx = c.h[0] - Math.abs(lx),
            fz = c.h[2] - Math.abs(lz);
          if (fx < fz) {
            ex = lx < 0 ? -1 : 1;
            ez = 0;
            pen = fx + r;
          } else {
            ex = 0;
            ez = lz < 0 ? -1 : 1;
            pen = fz + r;
          }
        }
        px = ex * c.cos + ez * c.sin;
        pz = -ex * c.sin + ez * c.cos;
      } else {
        // cylinder, or a sphere cut at the height of the body
        let cr = c.r;
        if (c.type === 'sphere') {
          const dy = Math.max(c.c[1] - (y + h), 0, y - c.c[1]);
          if (dy >= c.r) continue;
          cr = Math.sqrt(c.r * c.r - dy * dy);
        }
        const dx = pos.x - c.c[0],
          dz = pos.z - c.c[2];
        const d = Math.hypot(dx, dz);
        if (d >= r + cr) continue;
        pen = r + cr - d;
        if (d > 1e-6) {
          px = dx / d;
          pz = dz / d;
        } else px = 1;
      }
      pos.x += px * pen;
      pos.z += pz * pen;
      hit = true;
      if (out) {
        out.nx = px;
        out.nz = pz;
        out.col = c;
      }
    }
    return hit;
  }

  /** Lowest collider underside above a point within a disc (for head bumps). Returns y or Infinity. */
  ceilingAt(x, z, r, yMin, yMax) {
    let best = Infinity;
    const hits = this.query(x - r, x + r, z - r, z + r);
    for (const c of hits) {
      if (c.ghost || c.y0 < yMin || c.y0 > yMax || c.y0 >= best) continue;
      if (c.type === 'box') {
        const dx = x - c.c[0],
          dz = z - c.c[2];
        const lx = dx * c.cos - dz * c.sin,
          lz = dx * c.sin + dz * c.cos;
        if (Math.abs(lx) > c.h[0] + r || Math.abs(lz) > c.h[2] + r) continue;
      } else if (Math.hypot(x - c.c[0], z - c.c[2]) > c.r + r) continue;
      best = c.y0;
    }
    return best;
  }

  /**
   * Ray against every collider. Returns the nearest hit distance (<= maxT) or Infinity;
   * out gets { t, col, nx, ny, nz }.
   */
  raycast(ox, oy, oz, dx, dy, dz, maxT, out = null, filter = null) {
    let best = Infinity;
    // walk the grid coarsely: sample boxes along the ray's footprint
    const ex = ox + dx * maxT,
      ez = oz + dz * maxT;
    const hits = this.query(Math.min(ox, ex), Math.max(ox, ex), Math.min(oz, ez), Math.max(oz, ez), []);
    for (const c of hits) {
      if (filter && !filter(c)) continue;
      let t = Infinity,
        nx = 0,
        ny = 1,
        nz = 0;
      if (c.type === 'box') {
        // into the box's frame
        const px = ox - c.c[0],
          py = oy - c.c[1],
          pz = oz - c.c[2];
        const lx = px * c.cos - pz * c.sin,
          lz = px * c.sin + pz * c.cos;
        const ldx = dx * c.cos - dz * c.sin,
          ldz = dx * c.sin + dz * c.cos;
        let t0 = 0,
          t1 = maxT,
          axis = -1,
          sgn = 0;
        const slab = (p, d, h, a) => {
          if (Math.abs(d) < 1e-9) return Math.abs(p) <= h;
          let a0 = (-h - p) / d,
            a1 = (h - p) / d,
            s = -1;
          if (a0 > a1) {
            const tmp = a0;
            a0 = a1;
            a1 = tmp;
            s = 1;
          }
          if (a0 > t0) {
            t0 = a0;
            axis = a;
            sgn = s;
          }
          if (a1 < t1) t1 = a1;
          return t0 <= t1;
        };
        if (!slab(lx, ldx, c.h[0], 0) || !slab(py, dy, c.h[1], 1) || !slab(lz, ldz, c.h[2], 2)) continue;
        if (axis < 0) continue; // started inside
        t = t0;
        if (axis === 0) {
          nx = sgn * c.cos;
          ny = 0;
          nz = -sgn * c.sin;
        } else if (axis === 1) {
          nx = 0;
          ny = sgn;
          nz = 0;
        } else {
          nx = sgn * c.sin;
          ny = 0;
          nz = sgn * c.cos;
        }
      } else if (c.type === 'cyl') {
        const px = ox - c.c[0],
          pz = oz - c.c[2];
        const a = dx * dx + dz * dz;
        let tc = Infinity;
        if (a > 1e-9) {
          const b = px * dx + pz * dz,
            cc = px * px + pz * pz - c.r * c.r;
          const disc = b * b - a * cc;
          if (disc >= 0) {
            const tt = (-b - Math.sqrt(disc)) / a;
            const yy = oy + dy * tt;
            if (tt >= 0 && yy >= c.y0 && yy <= c.y1) {
              tc = tt;
              nx = (px + dx * tt) / c.r;
              ny = 0;
              nz = (pz + dz * tt) / c.r;
            }
          }
        }
        // caps
        if (Math.abs(dy) > 1e-9) {
          const yc = dy < 0 ? c.y1 : c.y0;
          const tt = (yc - oy) / dy;
          if (tt >= 0 && tt < tc) {
            const hx = px + dx * tt,
              hz = pz + dz * tt;
            if (hx * hx + hz * hz <= c.r * c.r) {
              tc = tt;
              nx = 0;
              ny = dy < 0 ? 1 : -1;
              nz = 0;
            }
          }
        }
        t = tc;
      } else {
        const px = ox - c.c[0],
          py = oy - c.c[1],
          pz = oz - c.c[2];
        const b = px * dx + py * dy + pz * dz,
          cc = px * px + py * py + pz * pz - c.r * c.r;
        const disc = b * b - cc;
        if (disc < 0) continue;
        const tt = -b - Math.sqrt(disc);
        if (tt < 0) continue;
        t = tt;
        nx = (px + dx * tt) / c.r;
        ny = (py + dy * tt) / c.r;
        nz = (pz + dz * tt) / c.r;
      }
      if (t < best && t <= maxT) {
        best = t;
        if (out) {
          out.t = t;
          out.col = c;
          out.nx = nx;
          out.ny = ny;
          out.nz = nz;
        }
      }
    }
    return best;
  }
}

/** Transform a model-space collider (kit format) into the world. */
export function placeCollider(col, x, y, z, ry = 0, s = 1) {
  const cos = Math.cos(ry),
    sin = Math.sin(ry);
  const cx = col.c[0] * s,
    cy = col.c[1] * s,
    cz = col.c[2] * s;
  const wc = [x + cx * cos + cz * sin, y + cy, z - cx * sin + cz * cos];
  if (col.type === 'box') return { type: 'box', c: wc, h: [col.h[0] * s, col.h[1] * s, col.h[2] * s], ry: (col.ry || 0) + ry };
  if (col.type === 'cyl') return { type: 'cyl', c: wc, r: col.r * s, h: col.h * s };
  return { type: 'sphere', c: wc, r: col.r * s };
}
