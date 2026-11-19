  // -------- island placement: 4-side holograms --------
  // When the Island tool is active, hovering over an island shows a blank-island
  // hologram on each of its 4 free cardinal sides at once. Hovering a hologram
  // highlights it; clicking a hologram places the island there.
  (function setupIslandPlacementHolos() {
    if (typeof xrWorldRoot === 'undefined') return;
    const group = new THREE.Group();
    group.name = 'island-placement-holos';
    group.visible = false;
    xrWorldRoot.add(group);

    let holos = [];          // { mesh, holoMat, outlineMat, slot }
    let anchorKey = null;
    let hoveredSlot = null;
    const _ndc = new THREE.Vector2();
    const _ray = new THREE.Raycaster();

    function anchorKeyFor(a) {
      return a ? (a.id || 'home') + ':' + (a.positionX || 0) + ',' + (a.positionZ || 0) : '';
    }
    function clearHolos() {
      for (const h of holos) {
        if (h.mesh.parent) h.mesh.parent.remove(h.mesh);
        if (typeof disposeGroup === 'function') disposeGroup(h.mesh);
      }
      holos = [];
    }
    function buildHolo(slot) {
      const mesh = makeBlankIsland();
      const holoMat = makeGhostHoloMaterial();
      const outlineMat = makeGhostOutlineMaterial();
      // Collect first, then mutate — adding the hull during traverse would
      // recurse into it forever.
      const nodes = [];
      mesh.traverse(o => { if (o.isMesh) nodes.push(o); });
      nodes.forEach(o => {
        o.material = holoMat;
        o.castShadow = false;
        o.receiveShadow = false;
        o.renderOrder = 3;
        if (o.geometry) {
          const hull = new THREE.Mesh(o.geometry, outlineMat);
          hull.userData.sharedGeometry = true;
          hull.scale.setScalar(typeof GHOST_OUTLINE_SCALE !== 'undefined' ? GHOST_OUTLINE_SCALE : 1.12);
          hull.castShadow = false;
          hull.receiveShadow = false;
          hull.renderOrder = 4;
          o.add(hull);
        }
      });
      mesh.position.set(slot.positionX, slot.positionY, slot.positionZ);
      mesh.userData.islandHoloSlot = slot;
      group.add(mesh);
      return { mesh, holoMat, outlineMat, slot };
    }
    function refresh(anchor) {
      const key = anchorKeyFor(anchor);
      if (key === anchorKey) return;
      anchorKey = key;
      clearHolos();
      if (!anchor || typeof islandPlacementSlots !== 'function') { group.visible = false; return; }
      const gap = (typeof GRID !== 'undefined' ? GRID + 1 : 9) * 0.5;
      const slots = islandPlacementSlots(anchor)
        .slice(0, 4) // cardinal sides only (S, N, E, W)
        .filter(s => s.free
          && !(Math.abs(s.positionX) < gap && Math.abs(s.positionZ) < gap)); // not over home origin
      for (const s of slots) holos.push(buildHolo(s));
      group.visible = holos.length > 0;
    }
    function setHovered(slot) {
      hoveredSlot = slot;
      for (const h of holos) {
        const on = !!slot && h.slot.positionX === slot.positionX && h.slot.positionZ === slot.positionZ;
        if (h.holoMat.uniforms) {
          h.holoMat.uniforms.uBase.value = on ? 0.36 : 0.10;
          h.holoMat.uniforms.uColor.value.setHex(on ? 0x2f86f5 : 0x6fb6ff);
        }
        h.outlineMat.opacity = on ? 1.0 : 0.82;
        h.outlineMat.color.setHex(on ? 0x1668e6 : 0x2f8fff);
        h.mesh.scale.setScalar(on ? 1.05 : 1.0);
      }
    }
    function pickHolo(x, y) {
      if (!holos.length || typeof camera === 'undefined') return null;
      _ndc.x = (x / window.innerWidth) * 2 - 1;
      _ndc.y = -(y / window.innerHeight) * 2 + 1;
      _ray.setFromCamera(_ndc, camera);
      const hits = _ray.intersectObjects(group.children, true);
      for (const hit of hits) {
        let n = hit.object;
        while (n) { if (n.userData && n.userData.islandHoloSlot) return n.userData.islandHoloSlot; n = n.parent; }
      }
      return null;
    }
    function anchorFromCell(cell) {
      if (!cell) return null;
      if (cell.editableIslandId && typeof editableIslandById !== 'undefined') {
        return editableIslandById.get(cell.editableIslandId) || null;
      }
      if (typeof editableIslandForBoard === 'function') {
        const isl = editableIslandForBoard(cell.boardX || 0, cell.boardZ || 0);
        if (isl) return isl;
      }
      if ((cell.boardX || 0) === 0 && (cell.boardZ || 0) === 0 && typeof ensureHomeIslandObject === 'function') {
        return ensureHomeIslandObject();
      }
      return null;
    }

    window.updateIslandPlacementHolos = function (x, y) {
      if (!(selectedTool && selectedTool.island)) { window.clearIslandPlacementHolos(); return; }
      if (typeof ghostPreview !== 'undefined' && ghostPreview) ghostPreview.visible = false;
      // 1) Hovering a hologram wins — keep the current holos/anchor stable so the
      //    one under the cursor stays put and clickable. (pickTile ignores the
      //    holos, so recomputing the anchor here would flip it to whatever sits
      //    behind the hologram and rebuild the holos out from under the cursor.)
      const slot = pickHolo(x, y);
      if (slot) {
        setHovered(slot);
        if (typeof islandSlotHoverCell === 'function') {
          currentHover = islandSlotHoverCell(slot);
          if (typeof hoverMesh !== 'undefined' && hoverMesh) hoverMesh.visible = false;
        }
        return;
      }
      // 2) Not over a hologram — anchor on the island under the cursor (if any);
      //    over empty space, keep the existing holos rather than clearing them.
      const cell = (typeof pickTile === 'function') ? pickTile(x, y) : null;
      const islandUnder = anchorFromCell(cell);
      if (islandUnder) refresh(islandUnder);
      else if (!holos.length && typeof islandPlacementAnchor === 'function') refresh(islandPlacementAnchor());
      setHovered(null);
      currentHover = null;
    };
    window.refreshIslandPlacementHolos = function () {
      if (!(selectedTool && selectedTool.island)) { window.clearIslandPlacementHolos(); return; }
      anchorKey = null;
      refresh((typeof islandPlacementAnchor === 'function') ? islandPlacementAnchor() : null);
      setHovered(null);
    };
    window.clearIslandPlacementHolos = function () {
      anchorKey = null; hoveredSlot = null; clearHolos(); group.visible = false;
    };
    window.islandPlacementHoloHoveredSlot = function () { return hoveredSlot; };
    window.tickIslandPlacementHolos = function (t) {
      for (const h of holos) { if (h.holoMat.uniforms && h.holoMat.uniforms.uTime) h.holoMat.uniforms.uTime.value = t; }
    };
  })();
