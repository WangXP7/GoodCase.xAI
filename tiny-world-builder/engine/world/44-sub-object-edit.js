  // -------- sub-object editing (reqs 6-9) --------
  // Assisted part editing for the object currently in "edit parts" mode. The
  // edited cell renders un-batched + part-keyed (see makeVoxelBuildStamp and
  // keyed voxel factories); here we raycast child meshes, select parts, expose
  // hierarchy metadata for Layers, and route per-part transforms.

  const subEditHoverGroup = new THREE.Group();
  subEditHoverGroup.name = 'sub-edit-hover';
  if (typeof xrWorldRoot !== 'undefined' && xrWorldRoot) xrWorldRoot.add(subEditHoverGroup);
  else if (typeof scene !== 'undefined' && scene) scene.add(subEditHoverGroup);

  const subEditHoverMat = new THREE.MeshBasicMaterial({
    color: 0x33e0ff, side: THREE.BackSide, transparent: true, opacity: 0.9,
    depthWrite: false, depthTest: true,
  });
  const SUBEDIT_HOVER_SCALE = 1.14;

  const subEditSelGroup = new THREE.Group();
  subEditSelGroup.name = 'sub-edit-selection';
  if (typeof xrWorldRoot !== 'undefined' && xrWorldRoot) xrWorldRoot.add(subEditSelGroup);
  else if (typeof scene !== 'undefined' && scene) scene.add(subEditSelGroup);
  const subEditSelMat = new THREE.MeshBasicMaterial({
    color: 0xff8a3c, side: THREE.BackSide, transparent: true, opacity: 0.95,
    depthWrite: false, depthTest: true,
  });
  const SUBEDIT_SEL_SCALE = 1.18;

  let subEditCellX = null, subEditCellZ = null;     // cell currently in edit mode
  let currentHoverPart = null;                       // { mesh, partKey, voxelCoord }
  let selectedPartKey = null;                        // locked-in selected part key
  let lastSnapLabel = null;
  const _subEditNdc = new THREE.Vector2();

  function subEditActive() {
    return subEditCellX !== null && !(window.__tinyworldIsPlayMode && window.__tinyworldIsPlayMode());
  }

  // The rendered Object3D for the edited cell. Home board lives in cellMeshes;
  // (island support arrives in a later slice).
  function subEditObject() {
    if (subEditCellX === null) return null;
    const key = subEditCellX + ',' + subEditCellZ;
    if (typeof cellMeshes !== 'undefined' && cellMeshes[key] && cellMeshes[key].object) return cellMeshes[key].object;
    return null;
  }

  function clearHoverMeshes() {
    while (subEditHoverGroup.children.length) {
      const m = subEditHoverGroup.children.pop();
      if (m.geometry && m.userData && m.userData.ownGeometry) m.geometry.dispose();
    }
  }
  function clearHoverPart() {
    clearHoverMeshes();
    currentHoverPart = null;
  }

  // Inverted-hull outline of a part, placed in world space from each mesh's
  // world matrix (mirrors addObjectOutline so it works under any parent). The
  // part may be a single voxel mesh OR a group (e.g. a house window = 4 boxes);
  // in the group case we outline every child mesh.
  function addPartHulls(part, group, mat, scale, renderOrder) {
    if (!part) return;
    const meshes = [];
    if (part.isMesh && part.geometry) meshes.push(part);
    else part.traverse(o => { if (o.isMesh && o.geometry) meshes.push(o); });
    for (const m of meshes) {
      m.updateMatrixWorld(true);
      const hull = new THREE.Mesh(m.geometry, mat);
      hull.matrixAutoUpdate = false;
      hull.matrix.copy(m.matrixWorld).multiply(new THREE.Matrix4().makeScale(scale, scale, scale));
      // Scene matrix updates are non-forced; flag the manual matrix so the
      // next traversal computes this hull's matrixWorld.
      hull.matrixWorldNeedsUpdate = true;
      hull.renderOrder = renderOrder;
      group.add(hull);
    }
  }
  // Clears only the overlay meshes — the handler owns currentHoverPart state.
  function highlightPart(part) {
    clearHoverMeshes();
    addPartHulls(part, subEditHoverGroup, subEditHoverMat, SUBEDIT_HOVER_SCALE, 1000);
  }

  // Raycast the edited object's children; return the nearest hit mesh that
  // carries a partKey (skips the inverted-hull overlay + non-part helpers).
  function pickSubPart(clientX, clientY) {
    const obj = subEditObject();
    if (!obj || typeof raycaster === 'undefined' || typeof camera === 'undefined') return null;
    _subEditNdc.x = (clientX / window.innerWidth) * 2 - 1;
    _subEditNdc.y = -(clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(_subEditNdc, camera);
    const hits = raycaster.intersectObject(obj, true);
    for (const h of hits) {
      let n = h.object;
      while (n && (!n.userData || !n.userData.partKey) && n !== obj) n = n.parent;
      if (n && n.userData && n.userData.partKey) return { mesh: n, partKey: n.userData.partKey, voxelCoord: n.userData.voxelCoord || null };
    }
    return null;
  }

  function onSubEditPointerMove(e) {
    if (!subEditActive()) { if (currentHoverPart) clearHoverPart(); return; }
    const hit = pickSubPart(e.clientX, e.clientY);
    if (!hit) { if (currentHoverPart) clearHoverPart(); return; }
    if (currentHoverPart && currentHoverPart.partKey === hit.partKey) return;
    currentHoverPart = hit;
    highlightPart(hit.mesh);
  }

  // --- part selection + transform (req 9) ---
  function clearSelMeshes() {
    while (subEditSelGroup.children.length) subEditSelGroup.children.pop();
  }
  function highlightSelectedMesh(partMesh) {
    clearSelMeshes();
    addPartHulls(partMesh, subEditSelGroup, subEditSelMat, SUBEDIT_SEL_SCALE, 1001);
  }
  function findPartMesh(partKey) {
    const obj = subEditObject();
    if (!obj) return null;
    let found = null;
    obj.traverse(o => { if (!found && o.userData && o.userData.partKey === partKey) found = o; });
    return found;
  }
  function titleCasePart(value) {
    return String(value || '')
      .replace(/^v:/, 'voxel:')
      .replace(/^p:/, '')
      .replace(/[-_:,]+/g, ' ')
      .replace(/\b\w/g, ch => ch.toUpperCase());
  }
  function labelForPartKey(partKey, mesh) {
    if (mesh && mesh.userData && mesh.userData.partLabel) return mesh.userData.partLabel;
    if (/^v:/.test(partKey || '')) return 'Voxel ' + String(partKey).slice(2);
    if (/^window/.test(partKey || '')) return 'Window ' + String(partKey).split(':')[1];
    if (partKey === 'door') return 'Door';
    if (partKey === 'roof') return 'Roof';
    if (partKey === 'wall') return 'Wall';
    if (partKey === 'head') return 'Light head';
    return titleCasePart(partKey);
  }
  function partPathForMesh(mesh) {
    const path = [];
    let n = mesh;
    const obj = subEditObject();
    while (n && n !== obj) {
      if (n.userData && n.userData.partKey) path.push(labelForPartKey(n.userData.partKey, n));
      n = n.parent;
    }
    return path.reverse();
  }
  function selectedPartInfo() {
    if (!selectedPartKey) return null;
    const mesh = findPartMesh(selectedPartKey);
    return {
      partKey: selectedPartKey,
      label: labelForPartKey(selectedPartKey, mesh),
      path: partPathForMesh(mesh),
      snap: lastSnapLabel,
    };
  }
  function collectPartHierarchy() {
    const obj = subEditObject();
    if (!obj) return [];
    const seen = new Set();
    const rows = [];
    obj.traverse(node => {
      const key = node.userData && node.userData.partKey;
      if (!key || seen.has(key)) return;
      seen.add(key);
      rows.push({
        partKey: key,
        label: labelForPartKey(key, node),
        path: partPathForMesh(node),
        selected: key === selectedPartKey,
        hovered: !!(currentHoverPart && currentHoverPart.partKey === key),
      });
    });
    return rows;
  }
  function reHighlightSelection() {
    if (!selectedPartKey) { clearSelMeshes(); return; }
    highlightSelectedMesh(findPartMesh(selectedPartKey));
  }
  function notifySubSelectionChanged() {
    reHighlightSelection();
    if (typeof updateTransformGizmo === 'function') {
      try { updateTransformGizmo(null); } catch (_) {}
    }
    if (typeof renderSelection === 'function') {
      try { renderSelection(); } catch (_) {}
    }
    window.dispatchEvent(new CustomEvent('tinyworld:sub-selection-changed', {
      detail: {
        cell: subEditCellX === null ? null : { x: subEditCellX, z: subEditCellZ },
        selected: selectedPartInfo(),
      },
    }));
  }
  function selectPart(partKey) {
    selectedPartKey = partKey || null;
    lastSnapLabel = null;
    notifySubSelectionChanged();
  }

  // Mutate the selected part's override on the real cell appearance and re-render
  // (which reapplies overrides), then re-acquire + re-highlight the part.
  function localBoxForNode(node, root) {
    if (!node || !root) return null;
    const worldBox = new THREE.Box3().setFromObject(node);
    if (worldBox.isEmpty()) return null;
    const pts = [
      [worldBox.min.x, worldBox.min.y, worldBox.min.z],
      [worldBox.min.x, worldBox.min.y, worldBox.max.z],
      [worldBox.min.x, worldBox.max.y, worldBox.min.z],
      [worldBox.min.x, worldBox.max.y, worldBox.max.z],
      [worldBox.max.x, worldBox.min.y, worldBox.min.z],
      [worldBox.max.x, worldBox.min.y, worldBox.max.z],
      [worldBox.max.x, worldBox.max.y, worldBox.min.z],
      [worldBox.max.x, worldBox.max.y, worldBox.max.z],
    ];
    const box = new THREE.Box3();
    pts.forEach(p => box.expandByPoint(root.worldToLocal(new THREE.Vector3(p[0], p[1], p[2]))));
    return box;
  }

  function snapSelectedPartOverride(partKey, before, cur) {
    if (!partKey || !/(window|door|head|lamp|light)/i.test(partKey)) return null;
    const obj = subEditObject();
    const mesh = findPartMesh(partKey);
    if (!obj || !mesh) return null;
    obj.updateMatrixWorld(true);
    const partBox = localBoxForNode(mesh, obj);
    const objBox = localBoxForNode(obj, obj);
    if (!partBox || !objBox || partBox.isEmpty() || objBox.isEmpty()) return null;
    const partSize = partBox.getSize(new THREE.Vector3());
    const center = partBox.getCenter(new THREE.Vector3());
    center.x += (cur.ox || 0) - (before.ox || 0);
    center.y += (cur.oy || 0) - (before.oy || 0);
    center.z += (cur.oz || 0) - (before.oz || 0);
    const threshold = /head|lamp|light/i.test(partKey) ? 0.08 : 0.16;
    const candidates = [
      { axis: 'x', value: objBox.min.x - partSize.x * 0.5, label: 'left face' },
      { axis: 'x', value: objBox.max.x + partSize.x * 0.5, label: 'right face' },
      { axis: 'z', value: objBox.min.z - partSize.z * 0.5, label: 'back face' },
      { axis: 'z', value: objBox.max.z + partSize.z * 0.5, label: 'front face' },
    ];
    let best = null;
    for (const c of candidates) {
      const d = Math.abs(center[c.axis] - c.value);
      if (d <= threshold && (!best || d < best.d)) best = Object.assign({ d }, c);
    }
    if (!best) return null;
    if (best.axis === 'x') cur.ox += best.value - center.x;
    else cur.oz += best.value - center.z;
    return best.label;
  }

  function mutateSelectedPart(fn, opts = {}) {
    if (selectedPartKey === null || subEditCellX === null) return false;
    if (typeof getWorldCell !== 'function' || typeof setCell !== 'function') return false;
    const cell = getWorldCell(subEditCellX, subEditCellZ);
    if (!cell) return false;
    const appearance = Object.assign({}, (typeof normalizeAppearance === 'function' ? normalizeAppearance(cell.appearance) : cell.appearance) || {});
    const parts = Object.assign({}, appearance.parts || {});
    const cur = Object.assign({ ox: 0, oy: 0, oz: 0, sx: 1, sy: 1, sz: 1, rx: 0, ry: 0, rz: 0 }, parts[selectedPartKey] || {});
    const before = Object.assign({}, cur);
    fn(cur);
    lastSnapLabel = null;
    if (opts.snap !== false) lastSnapLabel = snapSelectedPartOverride(selectedPartKey, before, cur);
    parts[selectedPartKey] = cur;
    appearance.parts = parts;
    setCell(subEditCellX, subEditCellZ, Object.assign({}, cell, { appearance, animate: false, impactDust: false }));
    resyncExplodeAfterRerender();
    notifySubSelectionChanged();
    return true;
  }
  // A part mutation re-renders the object (new meshes), so the explode capture
  // goes stale. Re-capture from the fresh (collapsed) meshes and re-apply the
  // current explode amount so parts stay exploded after a move/scale/recolor.
  function resyncExplodeAfterRerender() {
    if (explodeTarget > 0 || explodeProgress > 0.001) {
      captureExplodeParts();
      applyExplode(explodeProgress);
    }
  }
  function movePart(dx, dy, dz, opts = {}) {
    return mutateSelectedPart(c => { c.ox += dx || 0; c.oy += dy || 0; c.oz += dz || 0; }, opts);
  }
  function scalePart(factor, axis) {
    const f = Number(factor) || 1;
    return mutateSelectedPart(c => {
      if (axis === 'x') c.sx *= f;
      else if (axis === 'y') c.sy *= f;
      else if (axis === 'z') c.sz *= f;
      else { c.sx *= f; c.sy *= f; c.sz *= f; }
    }, { snap: false });
  }
  function rotatePart(axis, amount) {
    const a = Number(amount) || 0;
    const key = axis === 'x' ? 'rx' : axis === 'z' ? 'rz' : 'ry';
    return mutateSelectedPart(c => { c[key] += a; }, { snap: false });
  }
  function selectedGizmoTarget() {
    if (!subEditActive() || !selectedPartKey) return null;
    const mesh = findPartMesh(selectedPartKey);
    if (!mesh) return null;
    const box = new THREE.Box3().setFromObject(mesh);
    if (box.isEmpty()) return null;
    const p = box.getCenter(new THREE.Vector3());
    if (typeof xrWorldRoot !== 'undefined' && xrWorldRoot) xrWorldRoot.worldToLocal(p);
    return {
      partKey: selectedPartKey,
      label: labelForPartKey(selectedPartKey, mesh),
      position: p,
    };
  }

  // --- voxel sculpting (req 8, option a): add / remove / smooth on voxel-builds.
  // push = movePart, burst = scalePart (already implemented above). ---
  function parseVoxelKey(key) {
    const m = /^v:(-?\d+),(-?\d+),(-?\d+)$/.exec(key || '');
    return m ? { x: +m[1], y: +m[2], z: +m[3] } : null;
  }
  // True when the locked-in selected part is a sculptable voxel (key `v:x,y,z`).
  // The voxel remove/smooth/add actions no-op on named (non-voxel) parts, so the
  // panel uses this to disable those chips when they would silently fail.
  function isVoxelPartSelected() {
    return !!parseVoxelKey(selectedPartKey);
  }
  function sculptMutate(fn) {
    if (subEditCellX === null) return false;
    if (typeof getWorldCell !== 'function' || typeof setCell !== 'function') return false;
    const cell = getWorldCell(subEditCellX, subEditCellZ);
    if (!cell) return false;
    const appearance = Object.assign({}, (typeof normalizeAppearance === 'function' ? normalizeAppearance(cell.appearance) : cell.appearance) || {});
    fn(appearance);
    setCell(subEditCellX, subEditCellZ, Object.assign({}, cell, { appearance, animate: false, impactDust: false }));
    resyncExplodeAfterRerender();
    return true;
  }
  function removeSelectedVoxel() {
    const co = parseVoxelKey(selectedPartKey);
    if (!co) return false;
    const ok = sculptMutate(ap => {
      const rm = new Set(ap.voxelsRemoved || []);
      rm.add(co.x + ',' + co.y + ',' + co.z);
      ap.voxelsRemoved = Array.from(rm);
      // dropping a voxel also drops any per-part override for it
      if (ap.parts) { const p = Object.assign({}, ap.parts); delete p[selectedPartKey]; ap.parts = Object.keys(p).length ? p : undefined; }
    });
    selectedPartKey = null; clearSelMeshes();
    notifySubSelectionChanged();
    return ok;
  }
  function addVoxelFromSelected(dx, dy, dz) {
    const co = parseVoxelKey(selectedPartKey);
    if (!co) return false;
    const nc = { x: co.x + (dx || 0), y: co.y + (dy || 0), z: co.z + (dz || 0) };
    const rmKey = nc.x + ',' + nc.y + ',' + nc.z;
    const mesh = findPartMesh(selectedPartKey);
    let color = '#c8c8c8';
    if (mesh && mesh.material && mesh.material.color) color = '#' + mesh.material.color.getHexString();
    const ok = sculptMutate(ap => {
      const rm = new Set(ap.voxelsRemoved || []);
      if (rm.has(rmKey)) { rm.delete(rmKey); ap.voxelsRemoved = rm.size ? Array.from(rm) : undefined; return; }
      const add = (ap.voxelsAdded || []).slice();
      if (!add.some(v => v.x === nc.x && v.y === nc.y && v.z === nc.z)) add.push({ x: nc.x, y: nc.y, z: nc.z, color });
      ap.voxelsAdded = add;
    });
    // select the newly added voxel for chaining
    if (ok) selectPart('v:' + nc.x + ',' + nc.y + ',' + nc.z);
    return ok;
  }
  // Smooth: relax the selected voxel's offset toward the mean of its 6 neighbours'
  // offsets (neighbours without an override count as 0), pulling an out-of-place
  // voxel back into line.
  function smoothSelectedVoxel() {
    const co = parseVoxelKey(selectedPartKey);
    if (!co) return false;
    return mutateSelectedPart(c => {
      const cell = getWorldCell(subEditCellX, subEditCellZ);
      const parts = (normalizeAppearance(cell.appearance) || {}).parts || {};
      const dirs = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
      let ox = 0, oy = 0, oz = 0;
      for (const [dx, dy, dz] of dirs) {
        const nk = 'v:' + (co.x+dx) + ',' + (co.y+dy) + ',' + (co.z+dz);
        const n = parts[nk];
        if (n) { ox += n.ox; oy += n.oy; oz += n.oz; }
      }
      c.ox = ox / 6; c.oy = oy / 6; c.oz = oz / 6;
    });
  }

  // Recolor the selected part. hex null/undefined clears the override.
  function recolorPart(hex) {
    return mutateSelectedPart(c => { if (hex) c.col = hex; else delete c.col; });
  }

  function enterSubEdit(x, z) {
    if (typeof setVoxelSubEditCell !== 'function') return false;
    subEditCellX = x; subEditCellZ = z;
    setVoxelSubEditCell(x, z);
    clearHoverPart(); selectedPartKey = null; clearSelMeshes();
    explodeTarget = 0; explodeProgress = 0; explodeParts = [];
    if (typeof renderCellObject === 'function') renderCellObject(x, z, { animate: false });
    notifySubSelectionChanged();
    return true;
  }

  function exitSubEdit() {
    const hadX = subEditCellX, hadZ = subEditCellZ;
    subEditCellX = null; subEditCellZ = null;
    selectedPartKey = null; clearSelMeshes();
    explodeTarget = 0; explodeProgress = 0; explodeParts = [];
    if (typeof setVoxelSubEditCell === 'function') setVoxelSubEditCell(null, null);
    clearHoverPart();
    if (hadX !== null && typeof renderCellObject === 'function') renderCellObject(hadX, hadZ, { animate: false });
    notifySubSelectionChanged();
  }

  // --- explode view (req 7): push parts radially outward + up into a sphere
  // so every sub-part is visible/editable. Animated each frame; parts stay the
  // same meshes (hover/select/transform still work while exploded). ---
  const EXPLODE_OUT = 1.6;      // radial multiplier at full explode
  const EXPLODE_LIFT = 0.9;     // extra upward lift at full explode
  let explodeTarget = 0;        // 0 = collapsed, 1 = exploded
  let explodeProgress = 0;
  let explodeParts = [];        // [{ node, basePos:Vec3, baseCenter:Vec3 }]

  // A part may be a single voxel mesh OR a group (house window/door/roof = boxes
  // at origin). Pushing on group.position alone is a no-op for origin groups, so
  // we explode by each part's CENTROID (in its parent-local frame): direction
  // from the object centre, scaled by the centroid distance.
  function captureExplodeParts() {
    explodeParts = [];
    const obj = subEditObject();
    if (!obj) return;
    obj.updateMatrixWorld(true);
    obj.traverse(o => {
      if (!(o.userData && o.userData.partKey)) return;
      const box = new THREE.Box3().setFromObject(o);
      if (box.isEmpty()) return;
      const worldCenter = box.getCenter(new THREE.Vector3());
      const parent = o.parent || obj;
      const baseCenter = parent.worldToLocal(worldCenter.clone());
      explodeParts.push({ node: o, basePos: o.position.clone(), baseCenter });
    });
  }
  function applyExplode(amount) {
    for (const p of explodeParts) {
      if (!p.node.parent) continue;
      p.node.position.set(
        p.basePos.x + p.baseCenter.x * EXPLODE_OUT * amount,
        p.basePos.y + p.baseCenter.y * EXPLODE_OUT * amount + EXPLODE_LIFT * amount,
        p.basePos.z + p.baseCenter.z * EXPLODE_OUT * amount
      );
    }
    reHighlightSelection();
  }
  function setExplode(on) {
    // Capture base positions only from a fully-collapsed state, so toggling
    // mid-animation never records exploded coords as the base (avoids drift).
    if (on && explodeProgress < 0.01) captureExplodeParts();
    explodeTarget = on ? 1 : 0;
  }
  function isExploded() { return explodeTarget > 0.5; }
  function tickSubEditExplode(dt) {
    if (!subEditActive()) {
      // Deactivating mid-explode (e.g. entering play mode) must snap the parts
      // home, not just zero the progress — otherwise the exploded layout freezes.
      if (explodeParts.length) applyExplode(0);
      if (explodeProgress > 0 || explodeTarget > 0 || explodeParts.length) {
        explodeProgress = 0; explodeTarget = 0; explodeParts = [];
      }
      return;
    }
    if (Math.abs(explodeProgress - explodeTarget) < 0.001) {
      if (explodeTarget === 0 && explodeParts.length) { applyExplode(0); explodeParts = []; }
      return;
    }
    const step = Math.min(1, (dt || 0.016) * 6);
    explodeProgress += (explodeTarget - explodeProgress) * step;
    if (Math.abs(explodeProgress - explodeTarget) < 0.002) explodeProgress = explodeTarget;
    if (!explodeParts.length && explodeTarget > 0) captureExplodeParts();
    const eased = explodeProgress * explodeProgress * (3 - 2 * explodeProgress); // smoothstep
    applyExplode(eased);
  }

  function subEditKeyTargetBlocked(target) {
    if (!target) return false;
    const tag = target.tagName ? target.tagName.toLowerCase() : '';
    return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
  }

  function onSubEditKeyDown(e) {
    if (!subEditActive() || !selectedPartKey || subEditKeyTargetBlocked(e.target)) return;
    if (e.metaKey || e.ctrlKey) return;
    const fine = e.altKey;
    const moveStep = fine ? 0.025 : 0.08;
    const scaleStep = fine ? 1.035 : 1.10;
    const rotStep = fine ? Math.PI / 90 : Math.PI / 24;
    let handled = true;
    if (e.key === 'ArrowLeft') movePart(-moveStep, 0, 0, { snap: !e.shiftKey });
    else if (e.key === 'ArrowRight') movePart(moveStep, 0, 0, { snap: !e.shiftKey });
    else if (e.key === 'ArrowUp') movePart(0, 0, -moveStep, { snap: !e.shiftKey });
    else if (e.key === 'ArrowDown') movePart(0, 0, moveStep, { snap: !e.shiftKey });
    else if (e.key === 'PageUp') movePart(0, moveStep, 0, { snap: !e.shiftKey });
    else if (e.key === 'PageDown') movePart(0, -moveStep, 0, { snap: !e.shiftKey });
    else if (e.key === '[') scalePart(1 / scaleStep);
    else if (e.key === ']') scalePart(scaleStep);
    else if (e.key === ',') rotatePart(e.shiftKey ? 'x' : 'y', -rotStep);
    else if (e.key === '.') rotatePart(e.shiftKey ? 'x' : 'y', rotStep);
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  if (typeof renderer !== 'undefined' && renderer && renderer.domElement) {
    renderer.domElement.addEventListener('pointermove', onSubEditPointerMove);
    // NOTE: part SELECTION on click is handled in 20-input-place-erase.js's
    // pointerdown (dragMode 'subpart-select') so it isn't clobbered by the
    // pointerup cell-reselect. We only keep the hover listener here.
  }
  window.addEventListener('keydown', onSubEditKeyDown, true);

  window.__tinyworldSubEdit = {
    enter: enterSubEdit,
    exit: exitSubEdit,
    isActive: subEditActive,
    cell: () => subEditCellX === null ? null : { x: subEditCellX, z: subEditCellZ },
    hoverInfo: () => currentHoverPart ? { partKey: currentHoverPart.partKey, voxelCoord: currentHoverPart.voxelCoord } : null,
    selectPart,
    selectedInfo: selectedPartInfo,
    hierarchy: collectPartHierarchy,
    selectedGizmoTarget,
    movePart,
    scalePart,
    rotatePart,
    recolorPart,
    removeVoxel: removeSelectedVoxel,
    addVoxel: addVoxelFromSelected,
    smoothVoxel: smoothSelectedVoxel,
    isVoxelPartSelected,
    setExplode,
    isExploded,
    _tickExplode: tickSubEditExplode,
    _pick: pickSubPart,
    _object: subEditObject,
  };
