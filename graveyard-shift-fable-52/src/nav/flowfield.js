// Flow field over a nav grid (grid.js): Dijkstra from one target, 8-connected within a floor layer,
// 4-connected between layers where a stair joins them, no corner cutting, plus the grid's one-way
// links (windows, climbs) while they are open. Pure logic: no three.js, no DOM. Up to 24 agents
// query it every 0.1 s, so queries are O(1)-ish over typed arrays and a solve allocates nothing
// (its queue grows, rarely, the first time a bigger map needs it).
//
// createNav(G) is the module factory: it builds the grid lazily from G.level and keeps G.nav.field
// aimed at G.player.pos, re-solving at most RETARGET_HZ times per second.

import { buildGrid, pointXZ, PX, PZ, PY } from './grid.js';

const ARRIVE = 0.05; // metres: dir() returns [0,0] this close to the target point (on its layer)
const LOOKAHEAD = 6; // cells along the descent chain an agent may aim at directly when the line is clear
const RESCUE_R = 2; // cells searched around an agent standing in a blocked cell (pressed against a wall)
const RETARGET_HZ = 4;
const LINK_PENALTY = 1; // metres added to a link's length: a window is slower than a doorway
const FALLBACK_SLOTS = 2; // gather fields kept for agents cut off from the target (a shut door)
// Boxes no taller than this are ground to walk on, not walls: the level's pavements, kerbs and pump
// islands (0.15 m). It is the step the player (level/collision.js STEP_HEIGHT) and the zombies
// (zombie/ai.js createObstacles) climb; with the grid's own 0.1 m default the whole store pavement
// was unwalkable and a player at the ammo wall could not be reached.
export const WALK_OVER = 0.32;

export function createFlowField(grid) {
  const { nx, nz, nc, cell, blocked, floorY } = grid;
  const NL = grid.layers || 1;
  const maxStep = grid.maxStep ?? 0.45;
  const n = nc * NL;
  const dist = new Float64Array(n).fill(Infinity); // metres, read by queries

  // Solve with Dial's bucket queue on integer costs: straight STEP, diagonal DIAG (99/70 = 1.41429,
  // within 0.01% of sqrt 2), a link its length plus a penalty (capped under NB). Exact Dijkstra for
  // those weights, O(1) push/pop. Stale queue entries are skipped on pop.
  const STEP = 70, DIAG = 99, NB = 1024;
  const UNIT = cell / STEP;
  const INF = 0x7fffffff;
  const du = new Int32Array(n);
  const head = new Int32Array(NB);
  let cap = 4 * n + 1;
  let entCell = new Int32Array(cap), entKey = new Int32Array(cap), entNext = new Int32Array(cap);
  let ents = 0, live = 0;

  // links: by the cell they lead to (the solve runs backwards from the target) and the cell they leave
  const links = grid.links || [];
  const nLinks = links.length;
  const linkTo = new Int32Array(n).fill(-1), linkToNext = new Int32Array(nLinks);
  const linkFrom = new Int32Array(n).fill(-1), linkFromNext = new Int32Array(nLinks);
  const linkCost = new Int32Array(nLinks);
  const linkOpen = new Uint8Array(nLinks);
  links.forEach((l, i) => {
    linkToNext[i] = linkTo[l.toCell]; linkTo[l.toCell] = i;
    linkFromNext[i] = linkFrom[l.fromCell]; linkFrom[l.fromCell] = i;
    linkCost[i] = Math.min(NB - 1, Math.max(STEP, Math.round((l.length + LINK_PENALTY) / UNIT)));
  });

  let targetCell = -1, targetLayer = 0;
  let tx = 0, tz = 0, ty = 0; // point agents converge on inside targetCell

  function relax(k, d) {
    if (d >= du[k]) return;
    du[k] = d;
    if (ents >= cap) { // grow the entry pool (rare: only a map denser than the first estimate)
      const c2 = cap * 2;
      const a = new Int32Array(c2); a.set(entCell); entCell = a;
      const b = new Int32Array(c2); b.set(entKey); entKey = b;
      const c = new Int32Array(c2); c.set(entNext); entNext = c;
      cap = c2;
    }
    const bk = d % NB;
    const e = ents++;
    entCell[e] = k; entKey[e] = d; entNext[e] = head[bk]; head[bk] = e;
    live++;
  }
  // May a body step from a cell at floor height f onto cell c? Within a layer heights differ only on
  // and around stairs (`uneven`), so the height test runs there only; between layers always (okX).
  const uneven = new Uint8Array(n);
  for (let k = 0; k < n; k++) { // from the floors alone, so it holds whatever setBlocked does later
    const f = floorY[k];
    if (!Number.isFinite(f)) continue;
    const r = k % nc, i = r % nx, j = (r - i) / nx;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
      const c = k - r + b * nx + a;
      if (Number.isFinite(floorY[c]) && floorY[c] !== f) { uneven[k] = 1; uneven[c] = 1; }
    }
  }
  const ok = (c, f) => blocked[c] === 0 && (uneven[c] === 0 || Math.abs(floorY[c] - f) <= maxStep);
  const okX = (c, f) => blocked[c] === 0 && Math.abs(floorY[c] - f) <= maxStep;

  function solve(src, out) {
    du.fill(INF);
    head.fill(-1);
    ents = 0; live = 0;
    for (let i = 0; i < nLinks; i++) linkOpen[i] = links[i].open && !links[i].open() ? 0 : 1;
    relax(src, 0);
    for (let cur = 0; live > 0; cur++) {
      const b = cur % NB;
      while (head[b] >= 0) {
        const en = head[b];
        head[b] = entNext[en];
        live--;
        const k = entCell[en];
        const d = entKey[en];
        if (d !== du[k]) continue; // superseded by a shorter route
        const L = (k / nc) | 0, r = k - L * nc;
        const i = r % nx, j = (r - i) / nx;
        const f = floorY[k];
        const w = i > 0 && ok(k - 1, f);
        const e = i < nx - 1 && ok(k + 1, f);
        const s = j > 0 && ok(k - nx, f);
        const nn = j < nz - 1 && ok(k + nx, f);
        const dc = d + STEP, dd = d + DIAG;
        if (w) relax(k - 1, dc);
        if (e) relax(k + 1, dc);
        if (s) relax(k - nx, dc);
        if (nn) relax(k + nx, dc);
        // Diagonals only when both orthogonal neighbours are open: no cutting past a blocked corner.
        if (w && s && ok(k - nx - 1, f)) relax(k - nx - 1, dd);
        if (e && s && ok(k - nx + 1, f)) relax(k - nx + 1, dd);
        if (w && nn && ok(k + nx - 1, f)) relax(k + nx - 1, dd);
        if (e && nn && ok(k + nx + 1, f)) relax(k + nx + 1, dd);
        // onto another layer where a stair meets it: straight moves only
        if (NL > 1 && uneven[k]) for (let M = 0; M < NL; M++) {
          if (M === L) continue;
          const c = M * nc + r;
          if (i > 0 && okX(c - 1, f)) relax(c - 1, dc);
          if (i < nx - 1 && okX(c + 1, f)) relax(c + 1, dc);
          if (j > 0 && okX(c - nx, f)) relax(c - nx, dc);
          if (j < nz - 1 && okX(c + nx, f)) relax(c + nx, dc);
        }
        // links that lead here (the solve runs backwards): their start is reached through them
        if (nLinks) for (let l = linkTo[k]; l >= 0; l = linkToNext[l]) if (linkOpen[l]) relax(links[l].fromCell, d + linkCost[l]);
      }
    }
    for (let k = 0; k < n; k++) out[k] = du[k] === INF ? Infinity : du[k] * UNIT;
  }

  // ---- descent ----------------------------------------------------------------------------------
  // Scratch for next(): best downhill neighbour so far and whether it is reached by a link. Kept
  // outside so queries allocate nothing.
  let best = -1, bestD = Infinity, bestLink = -1;
  function consider(D, c, cost, here, link) {
    if (D[c] >= here) return;
    const v = D[c] + cost;
    if (v < bestD) { bestD = v; best = c; bestLink = link; }
  }
  const chain = new Int32Array(LOOKAHEAD);

  // Next cell downhill from walkable cell k over D (same moves and costs as the solve), or -1.
  // bestLink is the link taken, or -1.
  function next(D, k) {
    const L = (k / nc) | 0, r = k - L * nc;
    const i = r % nx, j = (r - i) / nx;
    const f = floorY[k];
    const w = i > 0 && ok(k - 1, f);
    const e = i < nx - 1 && ok(k + 1, f);
    const s = j > 0 && ok(k - nx, f);
    const nn = j < nz - 1 && ok(k + nx, f);
    const here = D[k];
    const dc = cell * Math.SQRT2;
    best = -1; bestD = Infinity; bestLink = -1;
    if (w) consider(D, k - 1, cell, here, -1);
    if (e) consider(D, k + 1, cell, here, -1);
    if (s) consider(D, k - nx, cell, here, -1);
    if (nn) consider(D, k + nx, cell, here, -1);
    if (w && s && ok(k - nx - 1, f)) consider(D, k - nx - 1, dc, here, -1);
    if (e && s && ok(k - nx + 1, f)) consider(D, k - nx + 1, dc, here, -1);
    if (w && nn && ok(k + nx - 1, f)) consider(D, k + nx - 1, dc, here, -1);
    if (e && nn && ok(k + nx + 1, f)) consider(D, k + nx + 1, dc, here, -1);
    if (NL > 1 && uneven[k]) for (let M = 0; M < NL; M++) {
      if (M === L) continue;
      const c = M * nc + r;
      if (i > 0 && okX(c - 1, f)) consider(D, c - 1, cell, here, -1);
      if (i < nx - 1 && okX(c + 1, f)) consider(D, c + 1, cell, here, -1);
      if (j > 0 && okX(c - nx, f)) consider(D, c - nx, cell, here, -1);
      if (j < nz - 1 && okX(c + nx, f)) consider(D, c + nx, cell, here, -1);
    }
    for (let l = linkFrom[k]; l >= 0; l = linkFromNext[l]) if (linkOpen[l]) consider(D, links[l].toCell, linkCost[l] * UNIT, here, l);
    return best;
  }

  // True when the straight segment (x0,z0)-(x1,z1) touches only walkable cells of layer L at about
  // the same height. Exact grid traversal (Amanatides-Woo); a segment passing exactly through a cell
  // corner checks both sides.
  function clear(x0, z0, x1, z1, L) {
    const base = L * nc;
    const fx0 = (x0 - grid.ox) / cell, fz0 = (z0 - grid.oz) / cell;
    const fx1 = (x1 - grid.ox) / cell, fz1 = (z1 - grid.oz) / cell;
    let i = Math.floor(fx0), j = Math.floor(fz0);
    const iEnd = Math.floor(fx1), jEnd = Math.floor(fz1);
    if (!(i >= 0 && j >= 0 && i < nx && j < nz)) return false;
    let f = floorY[base + j * nx + i];
    const open = (a, b) => {
      if (!(a >= 0 && b >= 0 && a < nx && b < nz)) return false;
      const c = base + b * nx + a;
      if (blocked[c] || Math.abs(floorY[c] - f) > maxStep) return false;
      f = floorY[c];
      return true;
    };
    if (blocked[base + j * nx + i]) return false;
    const dx = fx1 - fx0, dz = fz1 - fz0;
    const si = dx > 0 ? 1 : dx < 0 ? -1 : 0, sj = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const tdx = si !== 0 ? Math.abs(1 / dx) : Infinity, tdz = sj !== 0 ? Math.abs(1 / dz) : Infinity;
    let tmx = si > 0 ? (i + 1 - fx0) * tdx : si < 0 ? (fx0 - i) * tdx : Infinity;
    let tmz = sj > 0 ? (j + 1 - fz0) * tdz : sj < 0 ? (fz0 - j) * tdz : Infinity;
    for (let guard = 0; (i !== iEnd || j !== jEnd) && guard < 4 * (nx + nz); guard++) {
      if (Math.abs(tmx - tmz) < 1e-9) {
        const f0 = f;
        if (!open(i + si, j)) return false;
        f = f0;
        if (!open(i, j + sj)) return false;
        f = f0;
        i += si; j += sj; tmx += tdx; tmz += tdz;
      } else if (tmx < tmz) {
        i += si; tmx += tdx;
      } else {
        j += sj; tmz += tdz;
      }
      if (!open(i, j)) return false;
      // Float drift past the end point: settle on the end cell rather than walking on.
      if (tmx > 1 + 1e-9 && tmz > 1 + 1e-9) return open(iEnd, jEnd);
    }
    return true;
  }

  // For a point in a blocked cell (an agent pressed into the clearance band): the closest nearby
  // open cell of its layer, preferring one reached over D. Closest, not cheapest, so it never pulls
  // across a wall.
  function rescue(D, x, z, L) {
    const base = L * nc;
    const ci = Math.floor((x - grid.ox) / cell), cj = Math.floor((z - grid.oz) / cell);
    let bestR = -1, bestE = Infinity, bestFinite = false;
    for (let j = cj - RESCUE_R; j <= cj + RESCUE_R; j++) {
      if (j < 0 || j >= nz) continue;
      for (let i = ci - RESCUE_R; i <= ci + RESCUE_R; i++) {
        if (i < 0 || i >= nx) continue;
        const k = base + j * nx + i;
        if (blocked[k]) continue;
        const fin = D[k] !== Infinity;
        if (bestFinite && !fin) continue;
        const e = Math.hypot(grid.centerX(k) - x, grid.centerZ(k) - z);
        if ((fin && !bestFinite) || e < bestE - 1e-6 || (e < bestE + 1e-6 && D[k] < D[bestR])) { bestE = e; bestR = k; bestFinite = fin; }
      }
    }
    return bestR;
  }

  // ---- gather fields: where an agent cut off from the target goes ------------------------------------
  // Connected parts of the grid (moves only, no links), labelled lazily after each solve.
  const comp = new Int32Array(n);
  let compValid = false;
  const stack = new Int32Array(n);
  function label() {
    comp.fill(-1);
    let id = 0;
    for (let s0 = 0; s0 < n; s0++) {
      if (blocked[s0] || comp[s0] >= 0) continue;
      let sp = 0;
      stack[sp++] = s0; comp[s0] = id;
      while (sp > 0) {
        const k = stack[--sp];
        const L = (k / nc) | 0, r = k - L * nc;
        const i = r % nx, j = (r - i) / nx;
        const f = floorY[k];
        for (let M = 0; M < NL; M++) {
          const c = M * nc + r;
          if (i > 0 && comp[c - 1] < 0 && okX(c - 1, f)) { comp[c - 1] = id; stack[sp++] = c - 1; }
          if (i < nx - 1 && comp[c + 1] < 0 && okX(c + 1, f)) { comp[c + 1] = id; stack[sp++] = c + 1; }
          if (j > 0 && comp[c - nx] < 0 && okX(c - nx, f)) { comp[c - nx] = id; stack[sp++] = c - nx; }
          if (j < nz - 1 && comp[c + nx] < 0 && okX(c + nx, f)) { comp[c + nx] = id; stack[sp++] = c + nx; }
        }
      }
      id++;
    }
    compValid = true;
  }
  const fb = [];
  for (let s = 0; s < FALLBACK_SLOTS; s++) fb.push({ comp: -1, dist: null, cell: -1, x: 0, z: 0 });
  let fbTurn = 0;
  // the field toward the cell of k's part nearest the target, solved on first need
  function fallbackFor(k) {
    if (targetCell < 0) return null;
    if (!compValid) label();
    const c = comp[k];
    if (c < 0) return null;
    for (const s of fb) if (s.comp === c) return s;
    let g = -1, gd = Infinity;
    for (let q = 0; q < n; q++) {
      if (comp[q] !== c) continue;
      const dx = grid.centerX(q) - tx, dz = grid.centerZ(q) - tz, dy = floorY[q] - ty;
      const d2 = dx * dx + dz * dz + dy * dy;
      if (d2 < gd) { gd = d2; g = q; }
    }
    if (g < 0) return null;
    const s = fb[fbTurn]; fbTurn = (fbTurn + 1) % FALLBACK_SLOTS;
    if (!s.dist) s.dist = new Float64Array(n);
    solve(g, s.dist);
    s.comp = c; s.cell = g; s.x = grid.centerX(g); s.z = grid.centerZ(g);
    return s;
  }
  function resetFallbacks() { compValid = false; for (const s of fb) s.comp = -1; }

  // Steering direction at (x, z) on layer L, written into out[0], out[1]. Allocates nothing.
  function dirInto(x, z, out, layer) {
    out[0] = 0; out[1] = 0;
    if (targetCell < 0 || !Number.isFinite(x) || !Number.isFinite(z)) return out;
    const L = layer > 0 && layer < NL ? layer | 0 : 0;
    const k = grid.index3(x, z, L);
    if (k < 0) return out;
    let D = dist, gk = targetCell, gx = tx, gz = tz;
    let kk = k;
    if (blocked[k]) {
      const r = rescue(D, x, z, L);
      if (r < 0) return out;
      if (D[r] !== Infinity || !fallbackFor(r)) return toward(x, z, grid.centerX(r), grid.centerZ(r), out);
      kk = r;
    }
    if (D[kk] === Infinity) {
      const s = fallbackFor(kk);
      if (!s || s.dist[kk] === Infinity) return out;
      D = s.dist; gk = s.cell; gx = s.x; gz = s.z;
      if (kk !== k) return toward(x, z, grid.centerX(kk), grid.centerZ(kk), out);
      if (Math.hypot(gx - x, gz - z) < ARRIVE && kk === gk) return out;
    } else {
      if (kk !== k) return toward(x, z, grid.centerX(kk), grid.centerZ(kk), out);
      if (L === targetLayer && Math.hypot(tx - x, tz - z) < ARRIVE) return out;
    }
    if (k === gk) return toward(x, z, gx, gz, out);
    // Walk the descent chain and aim at the farthest cell (or the target) in clear line of sight,
    // on this layer; a step onto another layer or through a link ends the chain there.
    let len = 0;
    let c = k;
    let through = -1;
    while (len < LOOKAHEAD) {
      const c2 = next(D, c);
      if (c2 < 0) break;
      if (bestLink >= 0) { through = bestLink; break; }
      chain[len++] = c2;
      c = c2;
      if (c2 === gk || ((c2 / nc) | 0) !== L) break;
    }
    if (len === 0) {
      if (through >= 0) { const l = links[through]; return toward(x, z, l.to[0], l.to[1], out); }
      return out;
    }
    for (let m = len - 1; m > 0; m--) {
      const cm = chain[m];
      if (((cm / nc) | 0) !== L) continue;
      const px = cm === gk ? gx : grid.centerX(cm);
      const pz = cm === gk ? gz : grid.centerZ(cm);
      if (clear(x, z, px, pz, L)) return toward(x, z, px, pz, out);
    }
    const c1 = chain[0];
    return c1 === gk ? toward(x, z, gx, gz, out) : toward(x, z, grid.centerX(c1), grid.centerZ(c1), out);
  }
  function toward(x, z, px, pz, out) {
    const dx = px - x, dz = pz - z;
    const l = Math.hypot(dx, dz);
    if (l >= 1e-6) { out[0] = dx / l; out[1] = dz / l; }
    return out;
  }

  const NEXT = { link: null };
  function solveTarget() { solve(targetCell, dist); resetFallbacks(); }

  return {
    grid,
    // Aim at (x,z) (y, the feet height, picks the layer: default the ground), or at a point
    // ([x,y,z] or {x,y,z}). A non-finite target is ignored and the previous target kept. A target
    // on an unwalkable cell (player on a car roof) snaps to the nearest walkable cell of its layer, so
    // agents gather below it. Re-solves only when the target cell changes.
    setTarget(a, b, y) {
      if (!pointXZ(a, b)) return false;
      const x = PX, z = PZ;
      const yy = Number.isFinite(PY) ? PY : Number.isFinite(y) ? y : 0;
      const L = NL > 1 ? grid.layerAt(x, yy, z) : 0;
      const k = grid.nearestWalkable(x, z, L);
      if (k < 0) { targetCell = -1; dist.fill(Infinity); resetFallbacks(); return true; }
      if (k === grid.index3(x, z, L)) { tx = x; tz = z; } else { tx = grid.centerX(k); tz = grid.centerZ(k); }
      ty = floorY[k];
      targetLayer = L;
      if (k !== targetCell) { targetCell = k; solveTarget(); }
      return true;
    },
    // Re-solve for the same target: after grid.setBlocked (a door opened) or a link's open() changed.
    invalidate() { if (targetCell >= 0) solveTarget(); else resetFallbacks(); },

    // Unit steering direction [dx,dz] at (x,z) on a layer (default 0), or [0,0] when unreachable and
    // with nowhere nearer to gather, outside, or arrived. Returns a new array; per-frame callers use dirInto.
    dir(a, b, layer) {
      const out = [0, 0];
      return pointXZ(a, b) ? dirInto(PX, PZ, out, layer) : out;
    },
    // The same for numeric (x, z), written into `out` (array or typed array): no allocation.
    dirInto,

    // Path distance in metres from (x,z) on a layer to the target, Infinity when unreachable.
    dist(a, b, layer) {
      if (targetCell < 0 || !pointXZ(a, b)) return Infinity;
      const x = PX, z = PZ;
      const L = layer > 0 && layer < NL ? layer | 0 : 0;
      const k = grid.index3(x, z, L);
      if (k < 0) return Infinity;
      if (blocked[k]) {
        const r = rescue(dist, x, z, L);
        return r < 0 || dist[r] === Infinity ? Infinity : dist[r] + Math.hypot(grid.centerX(r) - x, grid.centerZ(r) - z);
      }
      if (k === targetCell) return Math.hypot(tx - x, tz - z);
      return dist[k];
    },
    // The link (window, climb) an agent at (x, z) on a layer is about to take: from its cell or the
    // next one down the field. Returns { link } (one reused object) or null.
    next(x, z, layer) {
      if (targetCell < 0 || !Number.isFinite(x) || !Number.isFinite(z)) return null;
      const L = layer > 0 && layer < NL ? layer | 0 : 0;
      const k = grid.index3(x, z, L);
      if (k < 0 || blocked[k] || dist[k] === Infinity) return null;
      const c = next(dist, k);
      if (bestLink >= 0) { NEXT.link = links[bestLink].link || links[bestLink]; return NEXT; }
      if (c < 0) return null;
      next(dist, c);
      if (bestLink >= 0) { NEXT.link = links[bestLink].link || links[bestLink]; return NEXT; }
      return null;
    },
  };
}

// Module factory (G.nav). Grid and field are built on first use from G.level: colliders, bounds and,
// when the level has floors above the ground, G.level.navOptions = { layers, ramps, links }.
export function createNav(G) {
  let grid = null;
  let inner = null;
  let built = false;
  let lastRetarget = -Infinity;
  let clockAcc = 0;

  // the simulation clock when the loop keeps one (it stops while paused), else the frame clock
  const clock = () => (G.time && typeof G.time.t === 'number' ? G.time.sim ?? G.time.t : clockAcc);

  // Marks the nav built only once a grid exists, so a call before the level is ready retries later.
  function rebuild() {
    built = false;
    grid = null;
    inner = null;
    lastRetarget = -Infinity;
    const level = G.level;
    if (!level || !level.bounds) return;
    grid = buildGrid(level.colliders || [], level.bounds, 0.5, { bandMin: WALK_OVER, ...(level.navOptions || {}) });
    inner = createFlowField(grid);
    built = true;
  }

  function ensure() {
    if (!built) rebuild();
    return inner;
  }

  function retarget(force) {
    const f = ensure();
    const pos = G.player && G.player.pos;
    if (!f || !pos) return;
    const now = clock();
    if (!force && now - lastRetarget < 1 / RETARGET_HZ) return;
    // pos may be [x,y,z] or {x,y,z}; a non-finite one keeps the previous target and retries next call.
    if (f.setTarget(pos)) lastRetarget = now;
  }

  // Stable object: callers may keep a reference across rebuild().
  const field = {
    setTarget(a, b, y) { const f = ensure(); if (f && f.setTarget(a, b, y)) lastRetarget = clock(); },
    dir(a, b, layer) { retarget(false); return inner ? inner.dir(a, b, layer) : [0, 0]; },
    dirInto(x, z, out, layer) { retarget(false); if (inner) return inner.dirInto(x, z, out, layer); out[0] = 0; out[1] = 0; return out; },
    dist(a, b, layer) { retarget(false); return inner ? inner.dist(a, b, layer) : Infinity; },
    next(x, z, layer) { retarget(false); return inner ? inner.next(x, z, layer) : null; },
    invalidate() { if (inner) inner.invalidate(); },
  };

  return {
    buildGrid,
    createFlowField,
    field,
    get grid() { ensure(); return grid; },
    rebuild,
    // close or reopen a doorway's cells and re-solve: the level calls this when a door opens or shuts
    setBlocked(rect, value) { ensure(); if (grid) { grid.setBlocked(rect, value); inner.invalidate(); } },
    update(dt) {
      if (!(G.time && typeof G.time.t === 'number')) clockAcc += dt || 0;
      retarget(false);
    },
  };
}
