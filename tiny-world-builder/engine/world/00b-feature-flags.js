  // -------- feature flags (global rollout + admin preview) --------
  const TW_FEATURE_FLAG_IDS = [
    'ai',
    'settings',
    'meshBuilding',
    'stamps',
    'movableMap',
    'buildBrush',
    'sunSlider',
    'weather',
    'elapsingTime',
    'generatePrompt',
    'spotlights',
    'connections',
    'lamps',
    'lava',
    'developerSettings',
    'playersMenu',
    'partyCreation',
    'playerSearch',
    'settingsWorkspace',
    'settingsRendering',
    'settingsWorld',
    'settingsMaterials',
    'settingsEnvironment',
    'settingsCrowd',
    'settingsAi',
    'thirdPersonView',
    'dbAssets',
    'buildV2',
  ];

  const TW_FEATURE_FLAG_META = {
    ai: { label: 'AI', hint: 'Agent chat, AI settings tab, and AI-backed tools' },
    settings: { label: 'Settings', hint: 'Settings modal and toolbar button' },
    meshBuilding: { label: 'Mesh Building', hint: 'Mesh terrain sculptor tool' },
    stamps: { label: 'Stamps', hint: 'Stamp browser and toolbar button' },
    movableMap: { label: 'Movable Map', hint: 'Draggable minimap under top nav' },
    buildBrush: { label: 'Build Brush', hint: 'Brush shape dock and toolbar' },
    sunSlider: { label: 'Sun Setting Slider', hint: 'Directional sun strength control during sunrise (06:00–08:00)' },
    weather: { label: 'Weather', hint: 'Weather controls in time popup' },
    elapsingTime: { label: 'Elapsing Time', hint: 'Live UK/BST time progression' },
    generatePrompt: { label: 'Generate from Prompt', hint: 'Separate AI world generator menu' },
    spotlights: { label: 'Spotlights', hint: 'Spotlight placement tool' },
    connections: { label: 'Connections', hint: 'Mooring / connect tool' },
    lamps: { label: 'Lamps', hint: 'Lamp-post placement tool' },
    lava: { label: 'Lava', hint: 'Lava terrain tool' },
    developerSettings: { label: 'Developer Settings', hint: 'Account → Developer tab' },
    playersMenu: { label: 'Players Menu', hint: 'Account → Players tab' },
    partyCreation: { label: 'Party Creation', hint: 'Create party in Players tab' },
    playerSearch: { label: 'Player Search', hint: 'Find players in Players tab' },
    settingsWorkspace: { label: 'Settings · Workspace', hint: 'Workspace tab inside Settings' },
    settingsRendering: { label: 'Settings · Rendering', hint: 'Rendering tab inside Settings' },
    settingsWorld: { label: 'Settings · World', hint: 'World tab inside Settings' },
    settingsMaterials: { label: 'Settings · Materials', hint: 'Materials tab inside Settings' },
    settingsEnvironment: { label: 'Settings · Environment', hint: 'Environment tab inside Settings' },
    settingsCrowd: { label: 'Settings · Crowd', hint: 'Crowd tab inside Settings' },
    settingsAi: { label: 'Settings · AI', hint: 'AI config tab inside Settings' },
    thirdPersonView: { label: 'Third-person View', hint: 'Third-person walk camera option in the view picker' },
    dbAssets: { label: 'DB asset store', hint: 'Per-asset cloud persistence (e.g. custom voxel stamps) via /api/assets' },
    buildV2: { label: 'Build v2', hint: 'Overhauled build UX: capability-accurate menus, contextual suggestions, pen tools' },
  };

  const TW_SETTINGS_SECTION_FLAG_IDS = {
    app: 'settingsWorkspace',
    rendering: 'settingsRendering',
    world: 'settingsWorld',
    materials: 'settingsMaterials',
    environment: 'settingsEnvironment',
    crowd: 'settingsCrowd',
    ai: 'settingsAi',
  };

  const TW_DEFAULT_FEATURE_FLAGS = {
    ai: { everyone: false, admin: false },
    settings: { everyone: false, admin: true },
    meshBuilding: { everyone: false, admin: false },
    stamps: { everyone: false, admin: false },
    movableMap: { everyone: false, admin: false },
    buildBrush: { everyone: false, admin: false },
    sunSlider: { everyone: false, admin: false },
    weather: { everyone: false, admin: false },
    elapsingTime: { everyone: false, admin: false },
    generatePrompt: { everyone: false, admin: false },
    spotlights: { everyone: false, admin: false },
    connections: { everyone: false, admin: false },
    lamps: { everyone: false, admin: false },
    lava: { everyone: false, admin: false },
    developerSettings: { everyone: false, admin: false },
    playersMenu: { everyone: false, admin: false },
    partyCreation: { everyone: false, admin: false },
    playerSearch: { everyone: false, admin: false },
    settingsWorkspace: { everyone: false, admin: false },
    settingsRendering: { everyone: false, admin: false },
    settingsWorld: { everyone: false, admin: false },
    settingsMaterials: { everyone: false, admin: false },
    settingsEnvironment: { everyone: false, admin: false },
    settingsCrowd: { everyone: false, admin: false },
    settingsAi: { everyone: false, admin: false },
    thirdPersonView: { everyone: false, admin: false },
    dbAssets: { everyone: false, admin: true },
    buildV2: { everyone: false, admin: true },
  };

  const TW_FEATURE_FLAG_TOOL_IDS = {
    meshBuilding: 'mesh-terrain',
    spotlights: 'spotlight',
    connections: 'mooring',
    lamps: 'lamp-post',
    lava: 'lava',
    // Build v2 slice 4 (plans/build-v2/04-PLAN.md): the pen tool exists in
    // TOOLS (19-tools-toolbar.js) but is hidden whenever `buildV2` is off.
    buildV2: 'pen',
  };

  const TW_WORLD_ADMIN_EMAILS = [
    'jason@bouncingfish.com',
    'jason.kneen@bouncingfish.com',
    'jason.kneen@gmail.com',
    'simongarthfarmer@gmail.com',
  ];

  function twCleanFeatureFlagEntry(raw, fallback) {
    const base = fallback && typeof fallback === 'object' ? fallback : { everyone: true, admin: true };
    const src = raw && typeof raw === 'object' ? raw : {};
    return {
      everyone: Object.prototype.hasOwnProperty.call(src, 'everyone') ? src.everyone === true : base.everyone === true,
      admin: Object.prototype.hasOwnProperty.call(src, 'admin') ? src.admin === true : base.admin === true,
    };
  }

  function twSanitizeFeatureFlags(input) {
    const source = input && typeof input === 'object' ? input : {};
    const rawFlags = source.flags && typeof source.flags === 'object' ? source.flags : source;
    const flags = {};
    TW_FEATURE_FLAG_IDS.forEach((id) => {
      flags[id] = twCleanFeatureFlagEntry(rawFlags[id], TW_DEFAULT_FEATURE_FLAGS[id]);
    });
    return {
      version: 1,
      updatedAt: source.updatedAt || new Date().toISOString(),
      flags,
    };
  }

  function twIsLocalFeatureHost() {
    try {
      const host = window.location.hostname;
      return window.location.protocol === 'file:'
        || host === 'localhost'
        || host === '127.0.0.1'
        || host === '[::1]'
        || host.endsWith('.local');
    } catch (_) {
      return false;
    }
  }

  function twFeatureFlagEnabled(flags, id, isAdmin) {
    const bag = flags && typeof flags === 'object' ? flags : {};
    const entry = bag[id] || TW_DEFAULT_FEATURE_FLAGS[id];
    if (!entry) return true;
    return !!(entry.everyone || (entry.admin && isAdmin));
  }

  function twApplyLocalFeatureOverrides(doc) {
    const clean = twSanitizeFeatureFlags(doc || {});
    try {
      const qs = new URLSearchParams(window.location.search || '');
      if (qs.get('ai') === '0') clean.flags.ai = { everyone: false, admin: false };
      else if (qs.get('ai') === '1') clean.flags.ai = { everyone: true, admin: true };
    } catch (_) {}
    return clean;
  }

  function twWorldAdminEmailAllowed(email) {
    const clean = String(email || '').trim().toLowerCase();
    return !!clean && TW_WORLD_ADMIN_EMAILS.indexOf(clean) !== -1;
  }

  let twFeatureFlagsDoc = twApplyLocalFeatureOverrides(window.__tinyworldFeatureFlagsBootstrap || {});
  let twFeatureFlagsAdmin = false;
  let twFeatureFlagsApplied = false;


  function twFeatureFlagsState() {
    const enabled = {};
    TW_FEATURE_FLAG_IDS.forEach((id) => {
      enabled[id] = twFeatureFlagEnabled(twFeatureFlagsDoc.flags, id, twFeatureFlagsAdmin);
    });
    return {
      flags: twFeatureFlagsDoc.flags,
      enabled,
      admin: twFeatureFlagsAdmin,
      meta: TW_FEATURE_FLAG_META,
      ids: TW_FEATURE_FLAG_IDS,
    };
  }

  function twSetElementsHidden(selectors, hidden) {
    (selectors || []).forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        el.hidden = !!hidden;
        el.setAttribute('aria-hidden', hidden ? 'true' : 'false');
      });
    });
  }

  // Never set hidden=false on a modal — that opens it. Only force-close when gated off.
  function twGateFeatureModal(triggerSelectors, modalSelector, enabled) {
    twSetElementsHidden(triggerSelectors, !enabled);
    if (!enabled) {
      document.querySelectorAll(modalSelector).forEach((modal) => {
        modal.hidden = true;
        modal.setAttribute('aria-hidden', 'true');
        if (typeof window.__closeTinyModal === 'function') window.__closeTinyModal(modal);
      });
    }
  }

  function twSettingsSectionEnabled(enabled, tabName) {
    if (tabName === 'feature-flags') return !!twFeatureFlagsAdmin;
    const flagId = TW_SETTINGS_SECTION_FLAG_IDS[tabName];
    return !!flagId && !!enabled[flagId];
  }

  function twApplySettingsSectionFlags(enabled) {
    if (!enabled.settings) return;
    document.querySelectorAll('[data-settings-tab]').forEach((tab) => {
      const name = tab.dataset.settingsTab;
      const visible = twSettingsSectionEnabled(enabled, name);
      tab.hidden = !visible;
      tab.setAttribute('aria-hidden', visible ? 'false' : 'true');
    });
    document.querySelectorAll('[data-settings-panel]').forEach((panel) => {
      const name = panel.dataset.settingsPanel;
      const visible = twSettingsSectionEnabled(enabled, name);
      if (!visible) {
        panel.hidden = true;
        panel.setAttribute('aria-hidden', 'true');
        panel.classList.remove('active');
      }
    });
    const adminSection = document.getElementById('feature-flags-admin-section');
    if (adminSection) adminSection.hidden = !twFeatureFlagsAdmin;
    if (typeof window.__twSelectFirstVisibleSettingsTab === 'function') {
      try { window.__twSelectFirstVisibleSettingsTab(); } catch (_) {}
    }
  }

  function twApplyFeatureFlagTools(enabled) {
    if (typeof TOOLS === 'undefined' || !Array.isArray(TOOLS)) return;
    Object.keys(TW_FEATURE_FLAG_TOOL_IDS).forEach((flagId) => {
      const toolId = TW_FEATURE_FLAG_TOOL_IDS[flagId];
      const tool = TOOLS.find(t => t && t.id === toolId);
      if (!tool) return;
      tool.hidden = !enabled[flagId];
      if (tool.hidden && typeof selectedTool !== 'undefined' && selectedTool && selectedTool.id === tool.id && typeof selectTool === 'function') {
        try { selectTool((TOOLS.find(t => t && t.select) || TOOLS[0])); } catch (_) {}
      }
    });
    if (typeof buildToolbar === 'function') {
      try { buildToolbar(); } catch (_) {}
    }
  }

  function twApplyFeatureFlags() {
    const state = twFeatureFlagsState();
    const enabled = state.enabled;
    window.__tinyworldFeatureFlags = state;
    window.__tinyworldFlags = window.__tinyworldFlags || {};
    window.__tinyworldFlags.feature = enabled;

    const root = document.documentElement;
    TW_FEATURE_FLAG_IDS.forEach((id) => {
      root.classList.toggle('ff-off-' + id, !enabled[id]);
    });

    const aiOn = !!enabled.ai;
    window.__TWB_AI_INTERFACES_ENABLED__ = aiOn;
    root.classList.toggle('ai-disabled', !aiOn);

    twGateFeatureModal(['#render-settings'], '#render-modal', enabled.settings);
    twSetElementsHidden(['#stamp-builder', '#stamp-builder-panel', '#toolbar-stamps'], !enabled.stamps);
    twSetElementsHidden(['#brush-mode-dock', '#brush-mode-toolbar'], !enabled.buildBrush);
    if (typeof window.__tinyworldSyncSunStrengthControl === 'function') {
      window.__tinyworldSyncSunStrengthControl();
    } else {
      twSetElementsHidden(['.sun-strength-control'], !enabled.sunSlider);
    }
    twSetElementsHidden(['#minimap-wrap'], !enabled.movableMap);
    twSetElementsHidden(['.view-option[data-view="tp"]'], !enabled.thirdPersonView);
    // If third-person is gated off but the active camera is third-person
    // (e.g. restored from a saved world or set before flags resolved),
    // drop back to first-person.
    if (!enabled.thirdPersonView
      && typeof cameraMode !== 'undefined' && cameraMode === 'tp'
      && typeof setCameraMode === 'function') {
      try { setCameraMode('fp'); } catch (_) {}
    }
    twGateFeatureModal(
      ['[data-feature-flag="generate-prompt"]', '#generate', '.world-menu-item[data-action="generate"]', '#toolbar-generate'],
      '#gen-modal',
      enabled.generatePrompt,
    );
    twSetElementsHidden(['#time-weather'], !enabled.weather && !enabled.elapsingTime);

    const timePopup = document.getElementById('time-popup');
    if (timePopup) {
      timePopup.querySelectorAll('[data-feature-weather]').forEach((el) => {
        el.hidden = !enabled.weather;
        el.setAttribute('aria-hidden', enabled.weather ? 'false' : 'true');
      });
    }

    const accountModal = document.getElementById('account-modal');
    if (accountModal) {
      const tabPlayers = document.getElementById('tab-players');
      const panelPlayers = document.getElementById('panel-players');
      const tabApi = document.getElementById('tab-api');
      const panelApi = document.getElementById('panel-api');
      if (tabPlayers) tabPlayers.hidden = !enabled.playersMenu;
      if (panelPlayers && !enabled.playersMenu) panelPlayers.hidden = true;
      if (tabApi) tabApi.hidden = !enabled.developerSettings;
      if (panelApi && !enabled.developerSettings) panelApi.hidden = true;
      const searchSection = document.querySelector('[data-feature-flag="player-search"]');
      const partySection = document.querySelector('[data-feature-flag="party-creation"]');
      if (searchSection) {
        searchSection.hidden = !enabled.playerSearch || !enabled.playersMenu;
      }
      if (partySection) {
        partySection.hidden = !enabled.partyCreation || !enabled.playersMenu;
      }
    }

    twApplyFeatureFlagTools(enabled);
    twApplySettingsSectionFlags(enabled);
    window.__tinyworldElapsingTimeEnabled = !!enabled.elapsingTime;
    if (typeof window.__tinyworldSyncLiveTimeClock === 'function') {
      try { window.__tinyworldSyncLiveTimeClock(); } catch (_) {}
    }

    if (enabled.movableMap) {
      const wrap = document.getElementById('minimap-wrap');
      if (wrap && !wrap.style.top && !wrap.style.left) {
        wrap.style.top = '90px';
        wrap.style.right = '12px';
        wrap.style.left = 'auto';
      }
    }

    twFeatureFlagsApplied = true;
    try {
      window.dispatchEvent(new CustomEvent('tinyworld:feature-flags', { detail: state }));
    } catch (_) {}
    return state;
  }

  async function twRefreshFeatureFlagsAdmin() {
    const test = typeof getTestUser === 'function' ? getTestUser() : null;
    if (test && test.loggedIn && (test.isAdmin || twWorldAdminEmailAllowed(test.email))) {
      twFeatureFlagsAdmin = true;
      return twApplyFeatureFlags();
    }
    const A = window.TinyWorldAuth;
    if (!A || typeof A.getUser !== 'function') {
      twFeatureFlagsAdmin = false;
      return twApplyFeatureFlags();
    }
    try {
      const u = await A.getUser();
      const email = ((u && u.email) || '').trim().toLowerCase();
      twFeatureFlagsAdmin = twWorldAdminEmailAllowed(email);
    } catch (_) {
      twFeatureFlagsAdmin = false;
    }
    return twApplyFeatureFlags();
  }

  async function twFeatureFlagsAuthToken() {
    const A = window.TinyWorldAuth;
    if (A && typeof A.getUser === 'function') {
      try {
        const u = await A.getUser();
        if (u) {
          if (typeof u.jwt === 'function') { try { return await u.jwt(); } catch (_) {} }
          if (u.token && u.token.access_token) return u.token.access_token;
        }
      } catch (_) {}
    }
    try {
      const m = document.cookie.match(/(?:^|; )nf_jwt=([^;]*)/);
      if (m) return decodeURIComponent(m[1]);
    } catch (_) {}
    try { return localStorage.getItem('tinyworld:auth:wallet-session.v1') || ''; } catch (_) {}
    return '';
  }

  async function twFeatureFlagsFetchInit() {
    const token = await twFeatureFlagsAuthToken();
    const headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    return { credentials: 'same-origin', headers };
  }

  async function twLoadFeatureFlagsFromApi() {
    try {
      const init = await twFeatureFlagsFetchInit();
      const res = await fetch('/api/feature-flags', init);
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || !data.flags) return null;
      twFeatureFlagsDoc = twApplyLocalFeatureOverrides(data);
      if (data.admin === true) twFeatureFlagsAdmin = true;
      return data;
    } catch (_) {
      return null;
    }
  }

  async function twSaveFeatureFlags(flags) {
    const body = twSanitizeFeatureFlags({ flags });
    const init = await twFeatureFlagsFetchInit();
    init.method = 'POST';
    init.headers = Object.assign({}, init.headers, { 'Content-Type': 'application/json' });
    init.body = JSON.stringify(body);
    const res = await fetch('/api/feature-flags', init);
    const raw = await res.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch (_) {}
    if (!res.ok) {
      const detail = (data && (data.error || data.message)) || (raw && !/^</.test(raw) ? raw.slice(0, 240) : '');
      throw new Error(detail || ('HTTP ' + res.status));
    }
    twFeatureFlagsDoc = twApplyLocalFeatureOverrides(data);
    twFeatureFlagsAdmin = true;
    return twApplyFeatureFlags();
  }

  function twMountFeatureFlagsAdminUI() {
    const host = document.getElementById('feature-flags-admin-grid');
    const section = document.getElementById('feature-flags-admin-section');
    if (!host || !section) return;
    if (!twFeatureFlagsAdmin) {
      section.hidden = true;
      const ffTab = document.getElementById('settings-tab-feature-flags');
      if (ffTab) ffTab.hidden = true;
      return;
    }
    section.hidden = false;
    const ffTab = document.getElementById('settings-tab-feature-flags');
    if (ffTab) {
      ffTab.hidden = false;
      ffTab.setAttribute('aria-hidden', 'false');
    }
    const state = twFeatureFlagsState();
    const help = document.getElementById('feature-flags-admin-help');
    if (help) {
      help.textContent = 'Toggle rollout per feature (' + TW_FEATURE_FLAG_IDS.length + ' total). Everyone ships to all signed-in users. Admins keeps it visible for world-admin accounts only. Scroll the list — save applies every row.';
    }
    host.innerHTML = '';
    TW_FEATURE_FLAG_IDS.forEach((id) => {
      const meta = TW_FEATURE_FLAG_META[id] || { label: id, hint: '' };
      const entry = state.flags[id] || TW_DEFAULT_FEATURE_FLAGS[id];
      const row = document.createElement('div');
      row.className = 'feature-flag-row';
      row.dataset.flagId = id;
      row.innerHTML =
        '<div class="feature-flag-copy">'
        + '<strong>' + meta.label + '</strong>'
        + (meta.hint ? '<em>' + meta.hint + '</em>' : '')
        + '</div>'
        + '<label class="feature-flag-toggle"><input type="checkbox" data-flag-everyone="' + id + '" ' + (entry.everyone ? 'checked' : '') + ' /><span>Everyone</span></label>'
        + '<label class="feature-flag-toggle"><input type="checkbox" data-flag-admin="' + id + '" ' + (entry.admin ? 'checked' : '') + ' /><span>Admins</span></label>';
      host.appendChild(row);
    });
    host.scrollTop = 0;
    const status = document.getElementById('feature-flags-admin-status');
    const saveBtn = document.getElementById('feature-flags-admin-save');
    if (saveBtn && !saveBtn.dataset.wired) {
      saveBtn.dataset.wired = '1';
      saveBtn.addEventListener('click', async () => {
        const next = {};
        TW_FEATURE_FLAG_IDS.forEach((id) => {
          const everyone = !!host.querySelector('[data-flag-everyone="' + id + '"]')?.checked;
          const admin = !!host.querySelector('[data-flag-admin="' + id + '"]')?.checked;
          next[id] = { everyone, admin };
        });
        if (status) status.textContent = 'Saving…';
        try {
          await twSaveFeatureFlags(next);
          if (status) status.textContent = 'Saved to server — other sessions pick this up on reload.';
          if (typeof twToast === 'function') twToast('Feature flags saved', 'ok');
        } catch (err) {
          if (status) status.textContent = String(err && err.message ? err.message : err);
          if (typeof twToast === 'function') twToast('Could not save feature flags', 'err');
        }
      });
    }
  }

  window.__tinyworldFeatureFlagsApi = {
    state: twFeatureFlagsState,
    apply: twApplyFeatureFlags,
    refreshAdmin: twRefreshFeatureFlagsAdmin,
    load: twLoadFeatureFlagsFromApi,
    save: twSaveFeatureFlags,
    mountAdminUI: twMountFeatureFlagsAdminUI,
    isEnabled(id) {
      const state = twFeatureFlagsState();
      return !!state.enabled[id];
    },
  };

  twFeatureFlagsDoc = twApplyLocalFeatureOverrides(window.__tinyworldFeatureFlagsBootstrap || twFeatureFlagsDoc);
  twApplyFeatureFlags();
  twLoadFeatureFlagsFromApi().then(() => {
    twRefreshFeatureFlagsAdmin().then(() => {
    twMountFeatureFlagsAdminUI();
    twApplySettingsSectionFlags(twFeatureFlagsState().enabled);
  });
});