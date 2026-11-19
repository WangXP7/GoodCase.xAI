  // -------- voxel stamp renderer --------
  // The main builder still owns intent, placement, repeat-click levels, save/load
  // and animations. This layer replaces the visual stamp factories with chunky
  // box-built assets so the board and tools read as one voxel system.
  const voxelBuildMaterialCache = new Map();

  function makeVoxelBuildStampLibrary() {
    const C = {
      ink: '#2C2F32',
      roof: '#3F494D',
      roofD: '#283135',
      roofEdge: '#536166',
      wood: '#7B5A35',
      woodD: '#473320',
      wall: '#ECE4D2',
      wallD: '#D6CFBE',
      stone: '#B9B6A6',
      stoneD: '#8D8A7E',
      paper: '#F6F1E2',
      gold: '#C7A858',
      red: '#A04030',
      green: '#8FAE5D',
      greenD: '#6E8848',
      bamboo: '#789C65',
      bambooD: '#5D7448',
      pink: '#DDB8BE',
      pinkD: '#C99EA7',
      water: '#8DB8C5',
      dirt: '#8B6F4A',
    };
    function vox(x, y, z, color) { return { x, y, z, color }; }
    function fill(out, x1, x2, y1, y2, z1, z2, color) {
      for (let x = x1; x <= x2; x++) {
        for (let y = y1; y <= y2; y++) {
          for (let z = z1; z <= z2; z++) out.push(vox(x, y, z, color));
        }
      }
    }
    function slab(out, y, halfX, halfZ, color) {
      fill(out, -halfX, halfX, y, y, -halfZ, halfZ, color);
    }
    function roof(out, y, halfX, halfZ) {
      slab(out, y, halfX + 1, halfZ + 1, C.roofEdge);
      slab(out, y + 1, halfX, halfZ, C.roof);
      slab(out, y + 2, Math.max(0, halfX - 1), Math.max(0, halfZ - 1), C.roof);
      slab(out, y + 3, Math.max(0, halfX - 2), Math.max(0, halfZ - 2), C.roofD);
      for (const sx of [-halfX - 1, halfX + 1]) {
        for (const sz of [-halfZ - 1, halfZ + 1]) out.push(vox(sx, y + 1, sz, C.roofD));
      }
    }
    function pagoda() {
      const out = [];
      fill(out, -4, 4, 0, 0, -4, 4, C.stone);
      fill(out, -3, 3, 1, 1, -3, 3, C.stoneD);
      for (let tier = 0; tier < 3; tier++) {
        const y = 2 + tier * 6;
        const half = 3 - Math.min(tier, 1);
        for (const x of [-half, half]) fill(out, x, x, y, y + 3, -half, half, C.woodD);
        for (const z of [-half, half]) fill(out, -half, half, y, y + 3, z, z, C.woodD);
        fill(out, -half + 1, half - 1, y, y + 2, -half + 1, half - 1, C.paper);
        fill(out, -half, half, y + 4, y + 4, -half, half, C.wood);
        roof(out, y + 5, half + 1, half + 1);
      }
      fill(out, -1, 1, 20, 20, -1, 1, C.roofD);
      fill(out, 0, 0, 21, 23, 0, 0, C.gold);
      out.push(vox(0, 24, 0, C.gold));
      return out;
    }
    function gate() {
      const out = [];
      fill(out, -5, 5, 0, 0, -2, 2, C.stone);
      for (const x of [-3, 3]) {
        fill(out, x - 1, x + 1, 1, 1, -1, 1, C.stoneD);
        fill(out, x, x, 2, 7, 0, 0, C.wood);
        fill(out, x - 1, x + 1, 2, 2, 0, 0, C.woodD);
      }
      fill(out, -4, 4, 6, 6, 0, 0, C.wood);
      fill(out, -5, 5, 7, 7, -1, 1, C.woodD);
      roof(out, 8, 5, 2);
      fill(out, -1, 1, 4, 5, 0, 0, C.gold);
      return out;
    }
    function watchtower() {
      const out = [];
      fill(out, -2, 2, 0, 0, -2, 2, C.stone);
      for (const x of [-2, 2]) for (const z of [-2, 2]) fill(out, x, x, 1, 10, z, z, C.woodD);
      for (let y = 2; y <= 9; y += 3) {
        fill(out, -2, 2, y, y, -2, -2, C.wood);
        fill(out, -2, 2, y, y, 2, 2, C.wood);
        fill(out, -2, -2, y, y, -2, 2, C.wood);
        fill(out, 2, 2, y, y, -2, 2, C.wood);
      }
      fill(out, -2, 2, 11, 12, -2, 2, C.wall);
      fill(out, -1, 1, 13, 13, -1, 1, C.woodD);
      fill(out, -3, 3, 14, 14, -3, 3, C.wood);
      for (const z of [-3, 3]) fill(out, -3, 3, 15, 15, z, z, C.wood);
      for (const x of [-3, 3]) fill(out, x, x, 15, 15, -3, 3, C.wood);
      roof(out, 16, 4, 4);
      fill(out, 0, 0, 22, 24, 0, 0, C.gold);
      return out;
    }
    function machiya() {
      const out = [];
      fill(out, -4, 4, 0, 0, -3, 3, C.stone);
      fill(out, -3, 3, 1, 3, -2, 2, C.wall);
      fill(out, -3, 3, 1, 1, -2, 2, C.wallD);
      for (const x of [-3, 3]) fill(out, x, x, 1, 4, -2, 2, C.woodD);
      for (const z of [-2, 2]) fill(out, -3, 3, 1, 4, z, z, C.woodD);
      fill(out, -1, 0, 1, 2, 3, 3, C.woodD);
      for (const x of [-2, 2]) fill(out, x, x, 2, 2, 3, 3, C.paper);
      roof(out, 4, 4, 3);
      fill(out, -4, 4, 3, 3, 0, 0, C.wood);
      return out;
    }
    function cherry() {
      const out = [];
      fill(out, 0, 0, 0, 4, 0, 0, C.woodD);
      fill(out, -1, 1, 3, 5, -1, 1, C.pink);
      fill(out, -2, 2, 5, 7, -2, 2, C.pink);
      fill(out, -1, 1, 7, 8, -1, 1, C.pinkD);
      for (const p of [[-3, 0, 0], [3, 0, 0], [0, 0, -3], [0, 0, 3], [-2, 1, -2], [2, 1, 2]]) {
        out.push(vox(p[0], 5 + p[1], p[2], C.pink));
      }
      fill(out, -2, 2, 0, 0, -2, 2, C.dirt);
      return out;
    }
    function oakGrove() {
      const out = [];
      fill(out, -5, 5, 0, 0, -4, 4, C.greenD);
      const trees = [[-3, 0, -1, 5], [1, 0, 1, 6], [4, 0, -2, 4]];
      trees.forEach(([cx, , cz, h], index) => {
        fill(out, cx, cx, 1, h, cz, cz, C.woodD);
        fill(out, cx - 1, cx + 1, h - 1, h + 1, cz - 1, cz + 1, index === 1 ? C.green : C.greenD);
        fill(out, cx - 2, cx + 2, h + 1, h + 2, cz - 2, cz + 2, C.green);
        fill(out, cx - 1, cx + 1, h + 3, h + 3, cz - 1, cz + 1, C.greenD);
      });
      return out;
    }
    function pineCluster() {
      const out = [];
      fill(out, -4, 4, 0, 0, -4, 4, C.dirt);
      const trees = [[-2, -1, 7], [2, 1, 6], [0, 3, 5]];
      trees.forEach(([cx, cz, h]) => {
        fill(out, cx, cx, 1, h, cz, cz, C.woodD);
        for (let y = 3; y <= h + 2; y += 2) {
          const spread = Math.max(1, h + 3 - y);
          fill(out, cx - spread, cx + spread, y, y, cz - spread, cz + spread, C.greenD);
          fill(out, cx - Math.max(0, spread - 1), cx + Math.max(0, spread - 1), y + 1, y + 1, cz - Math.max(0, spread - 1), cz + Math.max(0, spread - 1), C.green);
        }
      });
      return out;
    }
    function garden() {
      const out = [];
      fill(out, -4, 4, 0, 0, -4, 4, C.greenD);
      fill(out, -2, 2, 0, 0, -1, 1, C.water);
      for (const x of [-4, -2, 0, 2, 4]) {
        const h = 4 + ((x + 4) % 3);
        fill(out, x, x, 1, h, 3, 3, C.bamboo);
        if (h > 4) fill(out, x + 1, x + 1, h - 1, h - 1, 3, 3, C.bambooD);
      }
      for (const z of [-4, 4]) {
        fill(out, -4, 4, 1, 1, z, z, C.wood);
        for (const x of [-4, -2, 0, 2, 4]) fill(out, x, x, 1, 2, z, z, C.woodD);
      }
      return out;
    }
    function rockOutcrop() {
      const out = [];
      fill(out, -3, 3, 0, 0, -3, 3, C.dirt);
      fill(out, -2, 1, 1, 2, -1, 1, C.stone);
      fill(out, 0, 3, 1, 2, -2, 0, C.stoneD);
      fill(out, -3, -1, 1, 1, 0, 2, C.stone);
      fill(out, -1, 1, 3, 3, -1, 0, C.stoneD);
      fill(out, 1, 2, 3, 4, -1, -1, C.stone);
      fill(out, -2, -2, 2, 3, 1, 1, C.stoneD);
      for (const p of [[-3, 1, -2], [2, 1, 2], [3, 1, 1], [-1, 4, 0], [0, 2, 2]]) {
        out.push(vox(p[0], p[1], p[2], p[1] > 2 ? C.stone : C.stoneD));
      }
      for (const p of [[-2, 3, -1], [1, 3, 0], [2, 2, -2], [-1, 1, 2]]) {
        out.push(vox(p[0], p[1], p[2], C.greenD));
      }
      return out;
    }
    function lantern() {
      const out = [];
      fill(out, -2, 2, 0, 0, -2, 2, C.stoneD);
      fill(out, 0, 0, 1, 5, 0, 0, C.stone);
      fill(out, -1, 1, 3, 3, -1, 1, C.stoneD);
      fill(out, -1, 1, 4, 5, -1, 1, C.gold);
      fill(out, -2, 2, 6, 6, -2, 2, C.roofEdge);
      fill(out, -1, 1, 7, 7, -1, 1, C.roof);
      return out;
    }
    function voxelFence() {
      const out = [];
      for (const x of [-5, -2, 1, 4]) {
        fill(out, x, x, 0, 4, 0, 0, C.woodD);
        out.push(vox(x, 5, 0, C.wood));
      }
      fill(out, -5, 5, 2, 2, 0, 0, C.wood);
      fill(out, -5, 5, 4, 4, 0, 0, C.wood);
      return out;
    }
    function cropPatch() {
      const out = [];
      fill(out, -5, 5, 0, 0, -4, 4, C.dirt);
      for (const x of [-4, -2, 0, 2, 4]) {
        fill(out, x, x, 1, 2, -3, 3, C.greenD);
        for (const z of [-3, -1, 1, 3]) out.push(vox(x, 3, z, C.gold));
      }
      return out;
    }
    function stairs() {
      const out = [];
      for (let i = 0; i < 5; i++) {
        fill(out, -3, 3, i, i, -4 + i, -4 + i, C.stone);
        fill(out, -3, 3, 0, i, -3 + i, -3 + i, C.stoneD);
      }
      return out;
    }
    function well() {
      const out = [];
      fill(out, -2, 2, 0, 0, -2, 2, C.stoneD);
      for (const x of [-2, 2]) fill(out, x, x, 1, 3, -2, 2, C.stone);
      for (const z of [-2, 2]) fill(out, -2, 2, 1, 3, z, z, C.stone);
      fill(out, -1, 1, 1, 1, -1, 1, C.water);
      for (const x of [-2, 2]) fill(out, x, x, 4, 7, 0, 0, C.woodD);
      fill(out, -3, 3, 7, 7, 0, 0, C.wood);
      roof(out, 8, 3, 2);
      return out;
    }
    return [
      { id: 'pagoda-large', name: 'Voxel Pagoda', voxels: pagoda(), footprint: 2.8 },
      { id: 'temple-gate', name: 'Temple Gate', voxels: gate(), footprint: 2.4 },
      { id: 'watchtower', name: 'Watchtower', voxels: watchtower(), footprint: 1.9 },
      { id: 'machiya-house', name: 'Machiya House', voxels: machiya(), footprint: 2.0 },
      { id: 'cherry-tree-build', name: 'Cherry Build', voxels: cherry(), footprint: 1.45 },
      { id: 'oak-grove-build', name: 'Oak Grove', voxels: oakGrove(), footprint: 2.2 },
      { id: 'pine-cluster-build', name: 'Pine Cluster', voxels: pineCluster(), footprint: 2.1 },
      { id: 'bamboo-garden', name: 'Bamboo Garden', voxels: garden(), footprint: 1.7 },
      { id: 'rock-outcrop-build', name: 'Rock Outcrop', voxels: rockOutcrop(), footprint: 1.35 },
      { id: 'lantern-build', name: 'Stone Lantern', voxels: lantern(), footprint: 1.0 },
      { id: 'fence-build', name: 'Voxel Fence', voxels: voxelFence(), footprint: 1.7 },
      { id: 'crop-patch-build', name: 'Crop Patch', voxels: cropPatch(), footprint: 1.9 },
      { id: 'stairs-build', name: 'Stone Stairs', voxels: stairs(), footprint: 1.5 },
      { id: 'well-build', name: 'Village Well', voxels: well(), footprint: 1.5 },
    ];
  }

  const VOXEL_BUILD_CUSTOM_LS = 'tinyworld:voxel-build-stamps.v1';
  const VOXEL_BUILD_STAMPS = makeVoxelBuildStampLibrary();
  const VOXEL_PART_COLORS = {
    black: '#2C2F32',
    charcoal: '#1D252B',
    gray: '#8D8A7E',
    grey: '#8D8A7E',
    silver: '#C9D0D3',
    steel: '#7E8A91',
    metal: '#8A8F8F',
    grass: '#8FAE5D',
    grass2: '#6E8848',
    dirt: '#8B6F4A',
    dirtDark: '#5F4630',
    path: '#CDB98A',
    pathDark: '#A58E64',
    water: '#8DB8C5',
    waterDark: '#5C91A6',
    stone: '#B9B6A6',
    stoneDark: '#8D8A7E',
    wood: '#7B5A35',
    woodDark: '#473320',
    woodLight: '#B88B52',
    leather: '#8A542E',
    rope: '#5A422A',
    ropeLight: '#8F6A3B',
    cable: '#24282C',
    cream: '#ECE4D2',
    white: '#F6F1E2',
    glass: '#AEEAF2',
    glassBlue: '#8DB8C5',
    glassGreen: '#B9E6C0',
    roof: '#3F494D',
    roofEdge: '#536166',
    slate: '#536166',
    gold: '#C7A858',
    brass: '#C7A858',
    brassDark: '#8D6A24',
    copper: '#B86B3D',
    bronze: '#8E5A2B',
    red: '#A04030',
    orange: '#E78224',
    yellow: '#E8C84C',
    blue: '#3F64B7',
    teal: '#3B9C9C',
    purple: '#6A3FB7',
    pink: '#DDB8BE',
    green: '#8FAE5D',
    fabric: '#C9553C',
    canvas: '#D7CC9E',
    fabricRed: '#A04030',
    fabricOrange: '#E78224',
    fabricYellow: '#E8C84C',
    fabricBlue: '#3F64B7',
    fabricPurple: '#6A3FB7',
    fabricGreen: '#5C9A4B',
    crop: '#E6A440',
  };

  function voxelCustomPartVector(value, fallback = null) {
    const source = Array.isArray(value) ? value.map(Number) : fallback;
    if (!Array.isArray(source) || source.length !== 3 || !source.every(Number.isFinite)) return null;
    return source.map(v => Math.max(-12, Math.min(36, v)));
  }

  function voxelCustomPartDistance(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return 0;
    return Math.hypot((a[0] || 0) - (b[0] || 0), (a[1] || 0) - (b[1] || 0), (a[2] || 0) - (b[2] || 0));
  }

  function voxelCustomPartAngle(value, fallback, min, max) {
    const n = Number(value);
    const base = Number.isFinite(n) ? n : fallback;
    return Math.max(min, Math.min(max, base));
  }

  function normalizeVoxelCustomParts(parts) {
    if (!Array.isArray(parts)) return [];
    const out = [];
    for (let i = 0; i < parts.length && out.length < 180; i++) {
      const part = parts[i] || {};
      const rawKind = String(part.kind || '').toLowerCase();
      const kind = ['box', 'cylinder', 'cone', 'sphere', 'ellipsoid', 'cable'].includes(rawKind) ? rawKind : 'box';
      const fallbackMaterial = kind === 'cable' ? 'rope' : 'stone';
      const material = String(part.material || fallbackMaterial).replace(/[^a-zA-Z0-9_-]/g, '') || fallbackMaterial;
      if (kind === 'cable') {
        const from = voxelCustomPartVector(part.from);
        const to = voxelCustomPartVector(part.to);
        if (!from || !to || voxelCustomPartDistance(from, to) < 0.02) continue;
        const mid = [
          (from[0] + to[0]) * 0.5,
          (from[1] + to[1]) * 0.5,
          (from[2] + to[2]) * 0.5,
        ];
        const size = voxelCustomPartVector(part.size, [0.08, Math.max(0.08, voxelCustomPartDistance(from, to)), 0.08]);
        const pos = voxelCustomPartVector(part.pos, mid);
        const scale = voxelCustomPartVector(part.scale, [1, 1, 1]);
        if (!size || !pos || !scale) continue;
        const radius = Math.max(0.006, Math.min(0.3, Math.abs(Number(part.radius) || Math.min(size[0], size[2]) * 0.5 || 0.035)));
        const sag = Math.max(-8, Math.min(8, Number(part.sag) || 0));
        out.push({
          id: String(part.id || 'part-' + i).slice(0, 80),
          kind,
          material,
          size: size.map(v => Math.max(0.01, Math.min(8, Math.abs(v)))),
          pos,
          scale: scale.map(v => Math.max(0.05, Math.min(8, Math.abs(v)))),
          segments: Math.max(6, Math.min(64, Math.round(part.segments || 24))),
          from,
          to,
          radius,
          sag,
        });
        continue;
      }
      const size = Array.isArray(part.size) ? part.size.map(Number) : [0.25, 0.25, 0.25];
      const pos = Array.isArray(part.pos) ? part.pos.map(Number) : [0, 0, 0];
      const scale = Array.isArray(part.scale) ? part.scale.map(Number) : [1, 1, 1];
      if (size.length !== 3 || pos.length !== 3 || scale.length !== 3) continue;
      if (![...size, ...pos, ...scale].every(Number.isFinite)) continue;
      const cleanSize = size.map(v => Math.max(0.01, Math.min(8, Math.abs(v))));
      const cleanScale = scale.map(v => Math.max(0.05, Math.min(8, Math.abs(v))));
      out.push({
        id: String(part.id || 'part-' + i).slice(0, 80),
        kind,
        material,
        size: cleanSize,
        pos: pos.map(v => Math.max(-12, Math.min(36, v))),
        scale: cleanScale,
        segments: Math.max(4, Math.min(24, Math.round(part.segments || (kind === 'cone' ? 4 : (kind === 'sphere' || kind === 'ellipsoid' ? 12 : 8))))),
        verticalSegments: Math.max(3, Math.min(16, Math.round(part.verticalSegments || 8))),
        phiStart: voxelCustomPartAngle(part.phiStart, 0, 0, Math.PI * 2),
        phiLength: voxelCustomPartAngle(part.phiLength, Math.PI * 2, 0.05, Math.PI * 2),
        thetaStart: voxelCustomPartAngle(part.thetaStart, 0, 0, Math.PI),
        thetaLength: voxelCustomPartAngle(part.thetaLength, Math.PI, 0.05, Math.PI),
      });
    }
    return out;
  }

  function isVoxelCustomPartList(parts) {
    return Array.isArray(parts) && parts.some(part =>
      part && typeof part === 'object' &&
      (Array.isArray(part.size) || Array.isArray(part.pos) || Array.isArray(part.from) || Array.isArray(part.to) || ['box', 'cylinder', 'cone', 'sphere', 'ellipsoid', 'cable'].includes(part.kind))
    );
  }

  function normalizeVoxelBuildStamp(value, fallbackName = 'Voxel Build') {
    if (!value || typeof value !== 'object') return null;
    const rawCustomParts = value.customParts || (isVoxelCustomPartList(value.parts) ? value.parts : null);
    const customParts = normalizeVoxelCustomParts(rawCustomParts);
    const voxels = Array.isArray(value.voxels)
      ? value.voxels
      : Array.isArray(value.parts) && !customParts.length
        ? value.parts
      : Array.isArray(value) && !customParts.length
          ? value
          : null;
    if ((!voxels || !voxels.length) && !customParts.length) return null;
    const out = [];
    const seen = new Set();
    for (const v of (voxels || [])) {
      const x = Math.round(Number(v.x));
      const y = Math.round(Number(v.y));
      const z = Math.round(Number(v.z));
      const color = normalizeHexColor(v.color || v.hex || v.materialColor || v.c || '#ffffff');
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !color) continue;
      const key = x + ',' + y + ',' + z;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ x, y, z, color });
    }
    if (!out.length && !customParts.length) return null;
    const rawName = String(value.name || value.label || fallbackName || 'Voxel Build').trim().slice(0, 48);
    const baseId = String(value.id || rawName || 'voxel-build').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'voxel-build';
    let id = baseId;
    let suffix = 2;
    while (getVoxelBuildStamp(id)) id = baseId + '-' + suffix++;
    return {
      id,
      name: rawName || 'Voxel Build',
      voxels: out,
      customParts,
      footprint: Number.isFinite(value.footprint) ? Math.max(0.6, Math.min(4, value.footprint)) : undefined,
      custom: !!value.custom || !getVoxelBuildStamp(baseId),
    };
  }

  function loadCustomVoxelBuildStamps() {
    try {
      const list = JSON.parse(localStorage.getItem(VOXEL_BUILD_CUSTOM_LS) || '[]');
      if (!Array.isArray(list)) return;
      for (const item of list) {
        const rawId = item && typeof item.id === 'string' ? item.id : null;
        if (rawId && getVoxelBuildStamp(rawId)) continue;
        const stamp = normalizeVoxelBuildStamp(Object.assign({}, item, { custom: true }), item && item.name);
        if (stamp && !getVoxelBuildStamp(stamp.id)) VOXEL_BUILD_STAMPS.push(stamp);
      }
    } catch (_) {}
  }

  function saveCustomVoxelBuildStamps() {
    let payload;
    try {
      payload = JSON.stringify(VOXEL_BUILD_STAMPS.filter(s => s.custom).map(s => ({
        id: s.id,
        name: s.name,
        voxels: s.voxels,
        customParts: s.customParts,
        footprint: s.footprint,
        custom: true,
      })));
    } catch (_) { return; }
    twSafeSetItem(VOXEL_BUILD_CUSTOM_LS, payload, 'Custom voxel build');
    if (typeof window.__tinyworldSyncAssetsToCloud === 'function') window.__tinyworldSyncAssetsToCloud();
    // Mirror each custom stamp as its own asset-store row (behind the
    // 'dbAssets' flag), on top of the legacy whole-library sync above.
    try {
      if (window.TWAssetStore && TWAssetStore.enabled()) {
        VOXEL_BUILD_STAMPS.filter(s => s.custom).forEach((s) => {
          TWAssetStore.put('stamp-' + s.id, {
            class: 'stamp',
            name: s.name,
            format: 'voxel-build-stamp/1',
            data: { id: s.id, name: s.name, voxels: s.voxels, customParts: s.customParts, footprint: s.footprint },
          });
        });
      }
    } catch (_) {}
  }

  function deleteCustomVoxelBuildStamp(id) {
    const stampId = String(id || '');
    const index = VOXEL_BUILD_STAMPS.findIndex(s => s && s.id === stampId);
    if (index < 0 || !VOXEL_BUILD_STAMPS[index].custom) return false;
    VOXEL_BUILD_STAMPS.splice(index, 1);
    saveCustomVoxelBuildStamps();
    try {
      if (window.TWAssetStore && TWAssetStore.enabled()) TWAssetStore.remove('stamp-' + stampId);
    } catch (_) {}
    try { window.dispatchEvent(new CustomEvent('tinyworld:voxel-build-stamps-changed', { detail: { id: stampId, deleted: true } })); } catch (_) {}
    return true;
  }

  function importVoxelBuildPayload(payload, fallbackName = 'Imported Build') {
    const candidates = Array.isArray(payload)
      ? (payload.length && payload[0] && payload[0].voxels ? payload : [{ name: fallbackName, voxels: payload }])
      : payload && Array.isArray(payload.stamps)
        ? payload.stamps
        : payload && Array.isArray(payload.builds)
          ? payload.builds
          : payload && Array.isArray(payload.voxelBuilds)
            ? payload.voxelBuilds
            : [payload];
    const imported = [];
    for (const item of candidates) {
      const stamp = normalizeVoxelBuildStamp(Object.assign({}, item, { custom: true }), fallbackName);
      if (!stamp) continue;
      VOXEL_BUILD_STAMPS.push(stamp);
      imported.push(stamp);
    }
    if (imported.length) saveCustomVoxelBuildStamps();
    return imported;
  }

  loadCustomVoxelBuildStamps();

  function getVoxelBuildStamp(id) {
    return VOXEL_BUILD_STAMPS.find(s => s.id === id) || null;
  }
  window.__tinyworldDeleteCustomVoxelBuildStamp = deleteCustomVoxelBuildStamp;

  // Pulls custom voxel stamps that exist as user_assets rows (synced from
  // another device, or lazily backfilled server-side from the legacy blob)
  // but aren't yet in this session's in-memory VOXEL_BUILD_STAMPS/localStorage
  // copy. Additive only — never removes or overwrites an existing stamp.
  let twHydratingStampsFromAssetRows = false;
  async function twHydrateStampsFromAssetRows() {
    if (!window.TWAssetStore || !TWAssetStore.enabled()) return;
    if (twHydratingStampsFromAssetRows) return;
    twHydratingStampsFromAssetRows = true;
    try {
      const items = await TWAssetStore.list('stamp');
      if (!Array.isArray(items) || !items.length) return;
      let added = false;
      for (const item of items) {
        if (!item) continue;
        // TWAssetStore.list() returns metadata-only rows {id,...} when served
        // from the network, but full {data,...} records (no top-level id)
        // when it falls back to the local cache — handle both shapes.
        const inlineData = item.data && typeof item.data === 'object' ? item.data : null;
        const stampId = inlineData && inlineData.id
          ? String(inlineData.id)
          : (item.id ? String(item.id).replace(/^stamp-/, '') : '');
        if (!stampId || getVoxelBuildStamp(stampId)) continue;

        let data = inlineData;
        if (!data && item.id) {
          // fetchFresh awaits the network on a cold cache (first hydration
          // after a server-side backfill); plain get() would return null and
          // only revalidate in the background.
          let record = null;
          try { record = await TWAssetStore.fetchFresh(item.id); } catch (_) { record = null; }
          if (record && record.data && typeof record.data === 'object') data = record.data;
        }
        if (!data) continue;
        if (getVoxelBuildStamp(stampId)) continue; // re-check: awaits above may race a concurrent add

        const stamp = normalizeVoxelBuildStamp(Object.assign({}, data, { id: stampId, custom: true }), data.name || item.name);
        if (!stamp || getVoxelBuildStamp(stamp.id)) continue;
        VOXEL_BUILD_STAMPS.push(stamp);
        added = true;
      }
      if (added) {
        saveCustomVoxelBuildStamps();
        try { window.dispatchEvent(new CustomEvent('tinyworld:voxel-build-stamps-changed', { detail: { hydrated: true } })); } catch (_) {}
      }
    } catch (_) {
      // best effort — hydration failure should never block boot
    } finally {
      twHydratingStampsFromAssetRows = false;
    }
  }
  window.__tinyworldHydrateStampsFromAssetRows = twHydrateStampsFromAssetRows;
