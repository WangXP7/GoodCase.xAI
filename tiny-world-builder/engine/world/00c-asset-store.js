  // -------- durable per-asset store (DB-backed asset persistence) --------
  // Single choke point for syncing individual "assets" (e.g. custom voxel
  // stamps) to /api/assets as separate rows, mirrored to localStorage so
  // offline / signed-out / flag-off usage keeps working unattended. This is
  // a parallel per-row path behind the 'dbAssets' feature flag — it does
  // NOT replace the whole-library cloud sync in 30-ui-boot-wiring.js
  // (twCloudCollectAssetLibrary / window.__tinyworldSyncAssetsToCloud).
  //
  // Server contract (GET/PUT/DELETE /api/assets):
  //   GET  ?list=1[&class=]  -> {version, items:[{id,class,name,format,version,visibility,updatedAt,bytes}]}
  //   GET  ?id=              -> full row with data
  //   PUT  ?id=  body {data,class,name,format,version,visibility} -> meta
  //   DELETE ?id=            -> {ok:true}
  //
  // window.__tinyworldCloudApiCall only exists once module 30 has booted
  // (and only succeeds signed in), so it is never referenced at load time —
  // only looked up, via typeof, inside the functions below at call time.
  const TWAssetStore = (() => {
    const CACHE_PREFIX = 'tinyworld:asset-cache.v1:';
    const DIRTY_KEY = 'tinyworld:asset-dirty.v1';
    const ID_RE = /^[a-z0-9][a-z0-9_-]{0,79}$/;
    const FLUSH_DEBOUNCE_MS = 1500;

    let flushTimer = null;
    let flushing = false;
    let lastFlushAt = 0;
    let lastError = null;

    function enabled() {
      try {
        const api = window.__tinyworldFeatureFlagsApi;
        return !!(api && typeof api.isEnabled === 'function' && api.isEnabled('dbAssets'));
      } catch (_) {
        return false;
      }
    }

    function cleanId(id) {
      const lower = String(id || '').toLowerCase();
      return ID_RE.test(lower) ? lower : null;
    }

    function cacheKey(id) { return CACHE_PREFIX + id; }

    function readCache(id) {
      try {
        const raw = localStorage.getItem(cacheKey(id));
        return raw ? JSON.parse(raw) : null;
      } catch (_) {
        return null;
      }
    }

    function writeCache(id, entry) {
      try { twSafeSetItem(cacheKey(id), JSON.stringify(entry), 'Asset'); } catch (_) {}
    }

    function readDirty() {
      try {
        const list = JSON.parse(localStorage.getItem(DIRTY_KEY) || '[]');
        return Array.isArray(list) ? list : [];
      } catch (_) {
        return [];
      }
    }

    function writeDirty(list) {
      try { twSafeSetItem(DIRTY_KEY, JSON.stringify(list), 'Asset sync queue'); } catch (_) {}
    }

    function markDirty(id, tombstone) {
      const list = readDirty();
      const idx = list.findIndex(e => e && e.id === id);
      const entry = tombstone ? { id, deleted: true } : { id };
      if (idx >= 0) list[idx] = entry; else list.push(entry);
      writeDirty(list);
      queueFlush();
      ensureRetryLoop();
    }

    // A dirty queue left over from a previous session (or a flush that failed
    // mid-drain) has no put()/online event to re-trigger it — retry on a slow
    // timer until drained, then stop the timer.
    let retryTimer = null;
    function ensureRetryLoop() {
      if (retryTimer) return;
      retryTimer = setInterval(() => {
        if (!readDirty().length) { clearInterval(retryTimer); retryTimer = null; return; }
        flush().catch(() => {});
      }, 60000);
    }

    function clearDirty(id) {
      writeDirty(readDirty().filter(e => e && e.id !== id));
    }

    function queueFlush() {
      clearTimeout(flushTimer);
      flushTimer = setTimeout(() => {
        flush().catch((err) => { lastError = err && err.message ? err.message : String(err); });
      }, FLUSH_DEBOUNCE_MS);
    }

    // Never call window.__tinyworldCloudApiCall until we're inside a
    // function invoked at runtime — module 30 may not have booted yet.
    function apiCall(path, method, body) {
      if (typeof window.__tinyworldCloudApiCall !== 'function') return Promise.resolve({ error: 'offline' });
      try {
        return window.__tinyworldCloudApiCall(path, method, body);
      } catch (err) {
        return Promise.resolve({ error: err && err.message ? err.message : 'call failed' });
      }
    }

    async function put(id, record) {
      const clean = cleanId(id);
      if (!clean) return { error: 'invalid id' };
      writeCache(clean, { record, updatedAt: null, dirty: true });
      markDirty(clean, false);
      return { ok: true, queued: true };
    }

    async function revalidate(id, cached) {
      if (!enabled()) return;
      try {
        const res = await apiCall('/api/assets?id=' + encodeURIComponent(id), 'GET');
        if (!res || res.error) return;
        const fresh = readCache(id); // re-read: put()/remove() may have run while we awaited
        if (fresh && fresh.dirty) return; // local wins until flushed
        if (!fresh || fresh.updatedAt !== res.updatedAt) {
          writeCache(id, {
            record: { class: res.class, name: res.name, format: res.format, data: res.data, version: res.version, visibility: res.visibility },
            updatedAt: res.updatedAt || null,
            dirty: false,
          });
        }
      } catch (_) { /* background revalidate — best effort only */ }
    }

    async function get(id) {
      const clean = cleanId(id);
      if (!clean) return null;
      const cached = readCache(clean);
      revalidate(clean, cached); // fire-and-forget; updates cache for next read
      return cached ? cached.record : null;
    }

    // Awaitable network-first read for cold-cache consumers (e.g. hydrating
    // server-side backfilled rows that this device has never cached). An
    // unflushed local edit still wins; otherwise the server response is
    // cached and returned, with the stale cache as offline fallback.
    async function fetchFresh(id) {
      const clean = cleanId(id);
      if (!clean) return null;
      const cached = readCache(clean);
      if (cached && cached.dirty) return cached.record;
      const res = await apiCall('/api/assets?id=' + encodeURIComponent(clean), 'GET');
      if (res && !res.error) {
        const record = { class: res.class, name: res.name, format: res.format, data: res.data, version: res.version, visibility: res.visibility };
        writeCache(clean, { record, updatedAt: res.updatedAt || null, dirty: false });
        return record;
      }
      return cached ? cached.record : null;
    }

    async function list(cls) {
      if (enabled()) {
        try {
          const q = '/api/assets?list=1' + (cls ? '&class=' + encodeURIComponent(cls) : '');
          const res = await apiCall(q, 'GET');
          if (res && !res.error && Array.isArray(res.items)) return res.items;
        } catch (_) {}
      }
      const out = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key || key.indexOf(CACHE_PREFIX) !== 0) continue;
          const entry = readCache(key.slice(CACHE_PREFIX.length));
          if (entry && entry.record && (!cls || entry.record.class === cls)) out.push(entry.record);
        }
      } catch (_) {}
      return out;
    }

    async function remove(id) {
      const clean = cleanId(id);
      if (!clean) return { error: 'invalid id' };
      try { localStorage.removeItem(cacheKey(clean)); } catch (_) {}
      markDirty(clean, true);
      return { ok: true, queued: true };
    }

    async function flush() {
      if (flushing || !enabled()) return;
      flushing = true;
      try {
        let queue = readDirty();
        while (queue.length) {
          const entry = queue[0];
          const id = entry.id;
          let res;
          if (entry.deleted) {
            res = await apiCall('/api/assets?id=' + encodeURIComponent(id), 'DELETE');
          } else {
            const cached = readCache(id);
            if (!cached) { clearDirty(id); queue = readDirty(); continue; }
            res = await apiCall('/api/assets?id=' + encodeURIComponent(id), 'PUT', cached.record);
          }
          if (res && res.error) {
            lastError = res.error;
            break; // stop the drain on failure — retry later, keep this and the rest queued
          }
          if (!entry.deleted) {
            const cached = readCache(id);
            if (cached) writeCache(id, { record: cached.record, updatedAt: (res && res.updatedAt) || new Date().toISOString(), dirty: false });
          }
          clearDirty(id);
          queue = readDirty();
        }
        lastFlushAt = Date.now();
      } finally {
        flushing = false;
      }
    }

    function status() {
      return { dirtyCount: readDirty().length, lastFlushAt, lastError };
    }

    try {
      window.addEventListener('online', () => queueFlush());
      if (readDirty().length) ensureRetryLoop();
    } catch (_) {}

    return { enabled, put, get, fetchFresh, list, remove, flush, status };
  })();
  window.TWAssetStore = TWAssetStore;
