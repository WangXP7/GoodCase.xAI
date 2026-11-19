  // -------- object capability registry (build v2) --------
  // Single lookup for "what does this cell.kind actually support" — assembled
  // from the existing per-feature constants at call time (not duplicated),
  // so the ring (33-radial-menu.js) and the properties panel
  // (28a-floating-agent.js) can gate Style/Color/etc without re-deriving the
  // dead-option matrix documented in plans/build-v2/01-ux-capability-audit.md.
  // Loads after 09b/16/17 (owns the source constants) and before 19/28a/33
  // (both consumers). Everything below is read lazily inside capsForKind, so
  // load order only needs the globals to exist by menu-open time, not here.
  const TWObjectCaps = (() => {
    function houseBuildingTypes() {
      if (typeof TOOLS !== 'undefined' && Array.isArray(TOOLS)) {
        const houseTool = TOOLS.find(t => t && t.id === 'house' && Array.isArray(t.variants));
        if (houseTool) {
          const types = houseTool.variants.map(v => v.buildingType).filter(Boolean);
          if (types.length) return types;
        }
      }
      // Fallback only if TOOLS/house variants aren't reachable yet — mirrors
      // engine/world/19-tools-toolbar.js:15-20.
      return ['cottage', 'manor', 'tower', 'turret', 'skyscraper'];
    }

    function fenceStyleVariants() {
      if (typeof FENCE_STYLES !== 'undefined' && FENCE_STYLES instanceof Set) {
        return Array.from(FENCE_STYLES);
      }
      // Fallback only if FENCE_STYLES isn't reachable yet — mirrors
      // engine/world/16-drop-anim-adjacency.js:662.
      return ['wood', 'garden', 'gate'];
    }

    function capsForKind(kind) {
      const k = String(kind || '');
      if (!k) {
        return { style: false, color: false, colorRows: null, fenceStyle: false, buildingType: false, rotate: true, size: true, subEdit: false };
      }
      // style + subEdit both mirror TW_VOXEL_SUBEDIT_BUILTIN_KINDS membership
      // (engine/world/09b-voxel-build-factories.js:2742-2758) — the same set
      // makeVoxelRenderForCell branches on, so it's exactly the "has both a
      // normal and a voxel render path" capability.
      const style = (typeof isVoxelSubEditableKind === 'function') ? !!isVoxelSubEditableKind(k) : false;
      const color = (typeof SELECTION_COLOR_EDITABLE_KINDS !== 'undefined') ? SELECTION_COLOR_EDITABLE_KINDS.has(k) : false;
      const colorRows = (color && typeof selectionColorConfig === 'function') ? (selectionColorConfig(k) || null) : null;
      const fenceStyle = (k === 'fence') ? fenceStyleVariants() : false;
      const buildingType = (k === 'house') ? houseBuildingTypes() : false;
      return {
        style,
        color,
        colorRows,
        fenceStyle,
        buildingType,
        rotate: true,
        size: true,
        subEdit: style,
      };
    }

    return { capsForKind };
  })();
  window.TWObjectCaps = TWObjectCaps;
