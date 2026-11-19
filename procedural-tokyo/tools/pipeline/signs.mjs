// Signboards from OpenStreetMap's named places: every shop, restaurant, office and named building becomes
// a sign on the facade nearest to it.
//   fascia   a horizontal board over the shopfront, or at the tenant's floor when OSM gives a level
//   blade    a vertical board projecting from the wall (袖看板) — what a facade overflows into
//   title    the building's own name, large, under the roofline
import fs from 'node:fs';

export const SIGN = { FASCIA: 0, BLADE: 1, TITLE: 2, BILLBOARD: 3, SCREEN: 4, ROOFTOP: 5, BANNER: 6 };
const POSTERS = 24, BANNERS = 8; // invented posters in the client's atlas (src/world/ads.js); a sign's colour field picks one

// Colour schemes [background, text]; the index is stored per sign and must match SIGN_COLORS in the client.
export const SIGN_COLORS = [
  ['#c8102e', '#ffffff'], ['#f6c400', '#1a1a1a'], ['#f4f1ea', '#1a1a1a'], ['#151515', '#ffffff'],
  ['#1757a6', '#ffffff'], ['#16794c', '#ffffff'], ['#e8650a', '#ffffff'], ['#d93b7e', '#ffffff'],
  ['#3a2414', '#e9c46a'], ['#14213d', '#ffffff'], ['#ffffff', '#e8650a'], ['#ffffff', '#0a8f4f'],
  ['#0f6fc6', '#ffffff'], ['#5a5d61', '#ffffff'],
];
const BRAND = [
  [/セブン|7-?eleven/i, 10], [/ファミリーマート|familymart/i, 11], [/ローソン|lawson/i, 12],
  [/スターバックス|starbucks/i, 5], [/マクドナルド|mcdonald/i, 0], [/ドトール|doutor/i, 1], [/eneos/i, 6], [/三菱ufj/i, 0], [/みずほ/i, 4],
  [/吉野家/i, 6], [/松屋/i, 1], [/すき家/i, 0], [/タリーズ|tully/i, 8], [/三井住友/i, 5],
];
// Restaurants by cuisine (OSM's cuisine tag); anything else falls back to the palette of its kind.
const CUISINE = [
  [/ramen|chinese|noodle|gyoza/, [0, 1, 6]], [/sushi|japanese|soba|udon|tempura|kaiseki|unagi/, [9, 3, 8]], [/coffee|cafe|tea|cake|dessert/, [8, 5, 2]],
  [/italian|pizza|pasta|french|spanish/, [5, 2, 0]], [/burger|chicken|american|sandwich/, [0, 1]], [/indian|curry|thai|vietnamese|asian|korean/, [6, 1, 0]],
  [/barbecue|yakiniku|steak|beef|yakitori/, [3, 0, 8]],
];
const PALETTE = {
  restaurant: [0, 1, 6, 8, 3], fast_food: [0, 1, 6], cafe: [8, 5, 2, 3], bar: [3, 9, 7], pub: [3, 0, 8],
  nightclub: [3, 7], karaoke_box: [7, 1, 0], pharmacy: [5, 4, 2], doctors: [2, 5, 4], dentist: [2, 4], clinic: [2, 5],
  bank: [4, 5, 9], love_hotel: [7, 9], hotel: [9, 8], office: [13, 9, 2], shop: [2, 3, 4, 9, 5, 7, 1],
};
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; };

// -> [{ name, x, z, kind, level, building }]: kind selects the colours; building: a named building itself
export function readPlaces(file, project) {
  const { elements } = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = [];
  for (const e of elements) {
    const t = e.tags ?? {}, lon = e.lon ?? e.center?.lon, lat = e.lat ?? e.center?.lat;
    if (!t.name || lon == null) continue;
    const kind = t.shop ? 'shop' : t.amenity && PALETTE[t.amenity] ? t.amenity : t.tourism === 'hotel' ? 'hotel' : t.office ? 'office'
      : t.amenity && /restaurant|food|cafe|bar|pub|izakaya|cinema|theatre|clinic|hospital|school|library|post_office|studio/.test(t.amenity) ? 'shop' : null;
    const [x, z] = project(lon, lat);
    const level = Number.parseInt(t.level, 10);
    if (kind) out.push({ name: t.name, x, z, kind, level: Number.isFinite(level) ? level : null, building: false, brand: t.brand ?? '', cuisine: t.cuisine ?? '' });
    else if (t.building && e.type !== 'node') out.push({ name: t.name, x, z, kind: 'office', level: null, building: true });
  }
  return out;
}

// Billboards and LED screens on commercial buildings that face a street — thick around `centre` (the
// Scramble Crossing), thinning out with distance. Call after placeSigns (it prepares the walls).
// buildings: as for placeSigns, plus usage.
export function placeAds(buildings, centre = [0, 0]) {
  const ads = [];
  buildings.forEach((b, bi) => {
    if (!(b.usage >= 401 && b.usage <= 404) && b.usage !== 413 && b.usage !== 414) return;
    if (b.height < 12 || !b.walls) return;
    const walls = b.walls.filter((w) => w.street && w.len >= 4.5).sort((p, q) => q.len - p.len);
    walls.slice(0, 2).forEach((w, wi) => {
      const mx = w.ax + w.dx * w.len / 2, mz = w.az + w.dz * w.len / 2;
      const d = Math.hypot(mx - centre[0], mz - centre[1]);
      const h1 = hash('ad' + bi + ':' + wi), h2 = hash('kind' + bi + ':' + wi), h3 = hash('roof' + bi + ':' + wi);
      const chance = d < 220 ? 0.9 : d < 500 ? 0.5 : d < 900 ? 0.2 : 0.07;
      if (h1 < chance) {
        // on the wall: wide on a long wall, tall on a narrow one
        const tall = w.len < 8, width = tall ? w.len * 0.8 : Math.min(w.len * 0.72, 15);
        const h = tall ? Math.min(b.height * 0.5, width * 2.2, 14) : Math.min(b.height * 0.34, width * 0.62, 9);
        const y = b.base + Math.max(6.5 + h / 2, b.height * 0.62);
        if (h > 2.5 && y + h / 2 < b.base + b.height - 0.8) {
          const screen = h2 < (d < 260 ? 0.45 : d < 600 ? 0.12 : 0.03);
          ads.push({ style: screen ? SIGN.SCREEN : SIGN.BILLBOARD, color: Math.floor(h2 * 997) % POSTERS, x: mx, z: mz, y, nx: w.nx, nz: w.nz, w: width, h, text: '' });
        }
      }
      // down the side of the building: a vertical banner near one end of the wall
      const h4 = hash('banner' + bi + ':' + wi);
      if (w.len >= 6 && b.height >= 15 && h4 < (d < 260 ? 0.7 : d < 600 ? 0.4 : d < 1100 ? 0.2 : 0.08)) {
        const width = 1.6 + 1.2 * hash('bw' + bi + ':' + wi), h = Math.min(b.height * 0.55, width * 6.5, 18), end = h4 * 1000 % 1 < 0.5 ? 0.9 + width / 2 : w.len - 0.9 - width / 2;
        ads.push({ style: SIGN.BANNER, color: POSTERS + (Math.floor(h4 * 9973) % BANNERS), x: w.ax + w.dx * end, z: w.az + w.dz * end,
          y: b.base + Math.max(4.5 + h / 2, b.height * 0.5), nx: w.nx, nz: w.nz, w: width, h, text: '' });
      }
      // on the roof, on a frame
      if (wi === 0 && b.height < 60 && h3 < (d < 450 ? 0.38 : d < 900 ? 0.12 : 0.03)) {
        const width = Math.min(w.len * 0.8, 12), h = Math.min(width * 0.45, 5);
        if (width > 4) ads.push({ style: SIGN.ROOFTOP, color: Math.floor(h3 * 991) % POSTERS, x: mx - w.nx * 0.6, z: mz - w.nz * 0.6, y: b.base + b.height + 1.6 + h / 2, nx: w.nx, nz: w.nz, w: width, h, text: '' });
      }
    });
  });
  return ads;
}

// Width of a string in "ems": full-width characters count 1, Latin ones about half.
const ems = (s) => [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e7f ? 1 : 0.56), 0);

// buildings: [{ ring: [[x, z]], base, height, storeys }]; facesStreet(x, z): true on a road or sidewalk.
// Returns signs: { style, color, x, z, y, nx, nz, w, h, text } — (nx, nz) the wall's outward normal, y the
// sign's centre (absolute height).
export function placeSigns(places, buildings, facesStreet) {
  const cell = 24, grid = new Map();
  buildings.forEach((b) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of b.ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (let i = Math.floor((x0 - 10) / cell); i <= Math.floor((x1 + 10) / cell); i++)
      for (let j = Math.floor((z0 - 10) / cell); j <= Math.floor((z1 + 10) / cell); j++) {
        const k = i + ',' + j;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(b);
      }
    // walls: every edge long enough to carry a sign, with whether it looks onto a street
    b.walls = [];
    for (let i = 0; i < b.ring.length; i++) {
      const [ax, az] = b.ring[i], [bx, bz] = b.ring[(i + 1) % b.ring.length], len = Math.hypot(bx - ax, bz - az);
      if (len < 2.2) continue;
      const dx = (bx - ax) / len, dz = (bz - az) / len, nx = -dz, nz = dx; // outward for a counter-clockwise outline
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      b.walls.push({ ax, az, dx, dz, nx, nz, len, street: [2, 4.5, 8].some((d) => facesStreet(mx + nx * d, mz + nz * d)), taken: [], blades: 0 });
    }
  });

  const signs = [];
  const nearestWall = (b, x, z) => {
    let best = null, score = Infinity;
    for (const w of b.walls) {
      const t = Math.max(0, Math.min(w.len, (x - w.ax) * w.dx + (z - w.az) * w.dz));
      const d = Math.hypot(x - w.ax - w.dx * t, z - w.az - w.dz * t) + (w.street ? 0 : 9);
      if (d < score) { score = d; best = { w, t, d }; }
    }
    return best;
  };
  // free stretch of wall of width `width` in row `row`, as near to t as possible; null if the row is full
  const claim = (w, row, t, width) => {
    const lo = width / 2 + 0.3, hi = w.len - width / 2 - 0.3;
    if (hi < lo) return null;
    const free = (c) => !w.taken.some((o) => o.row === row && Math.abs(o.c - c) < (o.width + width) / 2 + 0.25);
    for (let step = 0; step < 12; step++) for (const s of step ? [1, -1] : [1]) {
      const c = Math.max(lo, Math.min(hi, t + s * step * 0.9));
      if (free(c)) { w.taken.push({ row, c, width }); return c; }
    }
    return null;
  };

  for (const p of places) {
    // the building the place is in, or the nearest one within reach
    let hit = null;
    for (const b of grid.get(Math.floor(p.x / cell) + ',' + Math.floor(p.z / cell)) ?? []) {
      const n = nearestWall(b, p.x, p.z);
      if (n && n.d < (hit?.d ?? 14)) hit = { ...n, b };
    }
    if (!hit) continue;
    const { b, w, t } = hit, floors = Math.max(1, b.storeys || Math.round(b.height / 3.3)), floorH = Math.min(6, Math.max(2.5, b.height / floors));
    const chars = ems(p.name), h01 = hash(p.name + p.x.toFixed(0));
    const brand = BRAND.find(([re]) => re.test(p.name) || re.test(p.brand ?? ''));
    const pal = CUISINE.find(([re]) => re.test(p.cuisine ?? ''))?.[1] ?? PALETTE[p.kind] ?? PALETTE.shop, color = brand ? brand[1] : pal[Math.floor(h01 * pal.length)];
    const at = (c, off) => [w.ax + w.dx * c + w.nx * off, w.az + w.dz * c + w.nz * off];

    if (p.building) {
      if (b.height < 14 || !w.street) continue;
      const main = b.walls.filter((o) => o.street).reduce((m, o) => (o.len > m.len ? o : m), w);
      const width = Math.min(main.len * 0.72, chars * 1.5, 16), h = Math.min(2.2, (width / chars) * 1.15);
      if (width < 2.5) continue;
      const [x, z] = [main.ax + main.dx * main.len / 2 + main.nx * 0.15, main.az + main.dz * main.len / 2 + main.nz * 0.15];
      signs.push({ style: SIGN.TITLE, color: h01 < 0.5 ? 13 : 3, x, z, y: b.base + b.height - h / 2 - 1.3, nx: main.nx, nz: main.nz, w: width, h, text: p.name.slice(0, 24) });
      continue;
    }

    // which floor: OSM's level, else the ground floor
    const floor = p.level != null ? Math.max(0, Math.min(floors - 1, p.level)) : 0;
    const text = p.name.length > 16 ? p.name.slice(0, 15) + '…' : p.name;
    const width = Math.min(6.5, Math.max(1.9, 0.9 + ems(text) * 0.52)), h = floor === 0 ? 0.82 : 0.7;
    const yFascia = b.base + floor * floorH + (floor === 0 ? Math.min(3.05, floorH - 0.45) : floorH - 0.5);
    const wantBlade = floors >= 3 && h01 < (p.kind === 'shop' || p.kind === 'office' ? 0.18 : 0.42);
    const c = wantBlade ? null : claim(w, floor, t, width);
    if (c != null && yFascia + h / 2 < b.base + b.height) {
      const [x, z] = at(c, 0.12);
      signs.push({ style: SIGN.FASCIA, color, x, z, y: yFascia, nx: w.nx, nz: w.nz, w: width, h, text });
      continue;
    }
    // blade sign: stacked up the wall near the place, at most a few columns per wall
    const column = Math.floor(w.blades / 5), slot = w.blades % 5;
    if (column > 2 || floors < 2) continue;
    const bladeH = Math.min(4.2, Math.max(1.6, [...text].length * 0.62)), yBlade = b.base + 3.4 + slot * 4.45 + bladeH / 2; // fixed pitch: signs differ in height
    if (yBlade + bladeH / 2 > b.base + b.height - 0.3) continue;
    w.blades++;
    const cb = Math.max(0.6, Math.min(w.len - 0.6, t + (column - 1) * 2.2));
    const [x, z] = at(cb, 0.1);
    signs.push({ style: SIGN.BLADE, color, x, z, y: yBlade, nx: w.nx, nz: w.nz, w: 0.72, h: bladeH, text: text.slice(0, 7) });
  }
  return signs;
}
