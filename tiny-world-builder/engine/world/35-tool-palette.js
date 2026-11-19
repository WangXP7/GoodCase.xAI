  // -------- floating block palette (Show groups: off) --------
  // When the "Show groups" setting is off the grouped bottom toolbar keeps its
  // utility buttons, while every placeable block lives in a single floating,
  // resizable panel. The grid uses fixed square cells, so resizing the panel
  // reflows the blocks to the nearest square. Blocks reuse buildToolButton, so
  // they keep their colors and feed the same updateToolActiveStates highlight
  // loop as the toolbar.
  (function setupToolPalette() {
    const SHOW_KEY = 'tinyworld:showGroups';
    const POS_KEY = 'tinyworld:toolPalette.pos';
    const palette = document.getElementById('tool-palette');
    const grid = document.getElementById('tool-palette-grid');
    const head = document.getElementById('tool-palette-head');
    const checkbox = document.getElementById('toolbar-show-groups');
    if (!palette || !grid) return;

    function showGroupsEnabled() {
      // Never ungroup the toolbar on phones/small screens — the floating
      // all-blocks palette is unusable there and eats the whole viewport.
      if (isSmallScreenForGroups()) return true;
      try { return localStorage.getItem(SHOW_KEY) !== '0'; } catch (_) { return true; }
    }

    function isSmallScreenForGroups() {
      try {
        if (window.matchMedia && window.matchMedia('(max-width: 700px)').matches) return true;
      } catch (_) {}
      return (window.innerWidth || 0) <= 700;
    }

    function buildPalette() {
      if (typeof buildToolButton !== 'function' || typeof TOOLS === 'undefined') return;
      grid.innerHTML = '';
      const select = TOOLS.find(t => t.id === 'select');
      if (select) grid.appendChild(buildToolButton(select, { flyout: true }));
      const groups = (typeof TOOL_GROUPS !== 'undefined') ? TOOL_GROUPS : [];
      groups.forEach(group => {
        group.toolIds.forEach(id => {
          const tool = TOOLS.find(t => t.id === id);
          if (!tool || tool.hidden) return;
          if (tool.variants && tool.variants.length && typeof buildVariantToolButton === 'function') {
            tool.variants.forEach(v => grid.appendChild(buildVariantToolButton(tool, v)));
          } else {
            grid.appendChild(buildToolButton(tool, { flyout: true }));
          }
        });
      });
      const erase = TOOLS.find(t => t.id === 'erase');
      if (erase) grid.appendChild(buildToolButton(erase, { flyout: true }));
      if (typeof updateToolActiveStates === 'function') updateToolActiveStates();
    }

    function applyStoredPos() {
      try {
        const raw = localStorage.getItem(POS_KEY);
        if (!raw) return;
        const p = JSON.parse(raw);
        if (Number.isFinite(p.w)) palette.style.width = p.w + 'px';
        if (Number.isFinite(p.h)) palette.style.height = p.h + 'px';
        if (Number.isFinite(p.left) && Number.isFinite(p.top)) {
          const w = p.w || palette.offsetWidth || 320;
          const h = p.h || palette.offsetHeight || 200;
          const left = Math.max(8, Math.min(window.innerWidth - w - 8, p.left));
          const top = Math.max(8, Math.min(window.innerHeight - h - 8, p.top));
          palette.style.left = left + 'px';
          palette.style.top = top + 'px';
          palette.style.bottom = 'auto';
          palette.style.transform = 'none';
        }
      } catch (_) {}
    }
    function savePos() {
      const r = palette.getBoundingClientRect();
      try {
        localStorage.setItem(POS_KEY, JSON.stringify({
          left: Math.round(r.left), top: Math.round(r.top),
          w: Math.round(r.width), h: Math.round(r.height),
        }));
      } catch (_) {}
    }

    function apply() {
      const show = showGroupsEnabled();
      document.body.classList.toggle('hide-groups', !show);
      if (checkbox) {
        checkbox.checked = show;
        // Forced on (and disabled) on small screens, where the floating
        // all-blocks palette is unusable.
        checkbox.disabled = isSmallScreenForGroups();
      }
      if (show) {
        palette.hidden = true;
      } else {
        buildPalette();
        palette.hidden = false;
        applyStoredPos();
      }
    }

    if (checkbox) {
      checkbox.addEventListener('change', () => {
        try { localStorage.setItem(SHOW_KEY, checkbox.checked ? '1' : '0'); } catch (_) {}
        apply();
      });
    }

    // Drag the panel by its header.
    let drag = null;
    head.addEventListener('pointerdown', e => {
      const r = palette.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      palette.classList.add('dragging');
      palette.style.bottom = 'auto';
      palette.style.transform = 'none';
      try { head.setPointerCapture(e.pointerId); } catch (_) {}
    });
    head.addEventListener('pointermove', e => {
      if (!drag) return;
      const w = palette.offsetWidth, h = palette.offsetHeight;
      const left = Math.max(8, Math.min(window.innerWidth - w - 8, e.clientX - drag.dx));
      const top = Math.max(8, Math.min(window.innerHeight - h - 8, e.clientY - drag.dy));
      palette.style.left = left + 'px';
      palette.style.top = top + 'px';
    });
    head.addEventListener('pointerup', e => {
      if (!drag) return;
      drag = null;
      palette.classList.remove('dragging');
      try { head.releasePointerCapture(e.pointerId); } catch (_) {}
      savePos();
    });

    // Persist size when the panel is resized.
    if (typeof ResizeObserver !== 'undefined') {
      let rt = 0;
      const ro = new ResizeObserver(() => {
        if (palette.hidden) return;
        clearTimeout(rt);
        rt = setTimeout(savePos, 150);
      });
      ro.observe(palette);
    }

    // Let the toolbar rebuild (grid/stamp changes) refresh the open palette.
    window.rebuildToolPaletteIfActive = function () {
      if (!showGroupsEnabled() && palette && !palette.hidden) buildPalette();
    };

    // Re-apply when crossing the small-screen breakpoint (rotate / resize) so
    // the toolbar regroups on the way down and restores the user's choice up.
    let _wasSmallGroups = isSmallScreenForGroups();
    window.addEventListener('resize', () => {
      const small = isSmallScreenForGroups();
      if (small !== _wasSmallGroups) { _wasSmallGroups = small; apply(); }
    });

    apply();
  })();
