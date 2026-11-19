// -------- admin user management --------
(function () {
  'use strict';

  var state = { users: [], selected: null, loading: false, total: 0, limit: 250, offset: 0 };
  var els = {};

  function byId(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function setStatus(msg, tone) {
    els.status.textContent = msg || '';
    els.status.dataset.tone = tone || '';
  }
  function setAuthStatus(msg, tone) {
    if (!els.authStatus) return;
    els.authStatus.textContent = msg || '';
    els.authStatus.dataset.tone = tone || '';
  }
  function cleanDate(value) {
    if (!value) return '—';
    var d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  }
  function pageInfoText() {
    if (!state.total) return '0 users';
    var start = state.offset + 1;
    var end = state.offset + state.users.length;
    return start + '-' + end + ' of ' + state.total + ' users';
  }
  function updatePagination() {
    if (els.pageInfo) els.pageInfo.textContent = pageInfoText();
    if (els.prev) els.prev.disabled = state.loading || state.offset <= 0;
    if (els.next) els.next.disabled = state.loading || (state.offset + state.users.length) >= state.total;
  }
  function currentLimit() {
    var n = Number(els.limit && els.limit.value);
    return Number.isFinite(n) ? Math.max(25, Math.min(500, Math.floor(n))) : 250;
  }
  function buildUserQuery() {
    state.limit = currentLimit();
    var params = new URLSearchParams();
    params.set('limit', String(state.limit));
    params.set('offset', String(state.offset));
    if (els.search && els.search.value.trim()) params.set('q', els.search.value.trim());
    if (els.flag && els.flag.value) params.set('flag', els.flag.value);
    if (els.created && els.created.value) params.set('created', els.created.value);
    if (els.seen && els.seen.value) params.set('seen', els.seen.value);
    if (els.sort && els.sort.value) params.set('sort', els.sort.value);
    return params.toString();
  }
  function walletToken() {
    try { return localStorage.getItem('tinyworld:auth:wallet-session.v1') || ''; } catch (_) { return ''; }
  }
  function cookieToken() {
    try { var m = document.cookie.match(/(?:^|; )nf_jwt=([^;]*)/); return m ? decodeURIComponent(m[1]) : ''; } catch (_) { return ''; }
  }
  function accessToken() {
    var A = window.TinyWorldAuth;
    if (A && typeof A.getUser === 'function') {
      return Promise.resolve(A.getUser()).then(function (u) {
        if (u && typeof u.jwt === 'function') {
          return Promise.resolve(u.jwt()).catch(function () { return ''; }).then(function (jwt) {
            return jwt || (u.token && u.token.access_token) || walletToken() || cookieToken() || '';
          });
        }
        return (u && u.token && u.token.access_token) || walletToken() || cookieToken() || '';
      }).catch(function () { return walletToken() || cookieToken() || ''; });
    }
    return Promise.resolve(walletToken() || cookieToken() || '');
  }
  function api(path, method, body) {
    return accessToken().then(function (token) {
      if (!token) throw new Error('Sign in as an admin to continue.');
      var opts = { method: method || 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, credentials: 'same-origin' };
      if (body) opts.body = JSON.stringify(body);
      return fetch(path, opts).then(function (res) {
        return res.text().then(function (text) {
          var data = null;
          try { data = text ? JSON.parse(text) : null; } catch (_) {}
          if (!res.ok) throw new Error((data && data.error) || ('Request failed: ' + res.status));
          return data || {};
        });
      });
    });
  }
  function showAuthPanel(show) {
    if (els.authPanel) els.authPanel.hidden = !show;
  }
  function refreshAuthPanel() {
    return accessToken().then(function (token) {
      showAuthPanel(!token);
      if (els.authLogout) els.authLogout.hidden = !token;
      return !!token;
    }).catch(function () {
      showAuthPanel(true);
      if (els.authLogout) els.authLogout.hidden = true;
      return false;
    });
  }
  function signInAdmin() {
    var A = window.TinyWorldAuth;
    if (!A || typeof A.login !== 'function') {
      setAuthStatus('Auth is still loading. Try again in a moment.', 'error');
      return Promise.resolve(false);
    }
    var email = (els.authEmail && els.authEmail.value || '').trim();
    var password = (els.authPassword && els.authPassword.value || '');
    if (!email || !password) {
      setAuthStatus('Enter your admin email and password.', 'error');
      return Promise.resolve(false);
    }
    els.authLogin.disabled = true;
    setAuthStatus('Signing in...');
    return A.login(email, password).then(function () {
      if (els.authPassword) els.authPassword.value = '';
      setAuthStatus('Signed in.');
      showAuthPanel(false);
      if (els.authLogout) els.authLogout.hidden = false;
      return loadUsers();
    }).catch(function (err) {
      setAuthStatus((err && err.message) || 'Sign in failed.', 'error');
      return false;
    }).finally(function () {
      els.authLogin.disabled = false;
    });
  }
  function signOutAdmin() {
    var A = window.TinyWorldAuth;
    var done = function () {
      state.users = [];
      state.selected = null;
      renderUsers();
      fillEditor(null);
      showAuthPanel(true);
      if (els.authLogout) els.authLogout.hidden = true;
      setStatus('Signed out.');
    };
    if (!A || typeof A.logout !== 'function') { done(); return; }
    A.logout().catch(function () {}).then(done);
  }
  function selectedPayload() {
    return {
      id: Number(els.id.value),
      username: els.username.value,
      email: els.email.value,
      displayName: els.display.value,
      twitter: els.twitter.value,
      github: els.github.value,
      image: els.image.value,
      about: els.about.value,
      lobbyAccess: els.lobby.checked,
    };
  }
  function fillEditor(user) {
    state.selected = user || null;
    els.editor.hidden = !user;
    if (!user) return;
    els.id.value = user.id || '';
    els.idPill.textContent = 'Profile #' + user.id;
    els.username.value = user.username || '';
    els.email.value = user.email || '';
    els.display.value = user.displayName || '';
    els.twitter.value = user.twitter || '';
    els.github.value = user.github || '';
    els.image.value = user.image || '';
    els.about.value = user.about || '';
    els.lobby.checked = !!user.lobbyAccess;
    els.lobby.disabled = !!user.builtInAccess;
    els.resetNote.textContent = user.passwordResetRequestedAt ? ('Last reset requested: ' + new Date(user.passwordResetRequestedAt).toLocaleString()) : '';
  }
  function userFlags(u) {
    var flags = [];
    if (u.builtInAccess) flags.push({ text: 'Tinyverse', cls: 'ok' });
    else if (u.legacyLobbyFlag) flags.push({ text: 'Legacy lobby', cls: 'warn' });
    if (!u.email) flags.push({ text: 'No email', cls: 'warn' });
    if (!u.displayName || !u.twitter || !u.github) flags.push({ text: 'Incomplete', cls: 'warn' });
    if (u.passwordResetRequestedAt) flags.push({ text: 'Reset', cls: '' });
    if (u.archivedAt || u.mergedIntoProfileId) flags.push({ text: 'Archived', cls: '' });
    return flags;
  }
  function flagsHtml(u) {
    var flags = userFlags(u);
    if (!flags.length) return '<span class="admin-badge">Standard</span>';
    return '<span class="admin-users-flags">' + flags.map(function (f) {
      return '<span class="admin-badge ' + esc(f.cls || '') + '">' + esc(f.text) + '</span>';
    }).join('') + '</span>';
  }
  function renderUsers() {
    if (!state.users.length) {
      els.list.innerHTML = '<tr><td colspan="7" class="admin-users-empty">No users found.</td></tr>';
      updatePagination();
      return;
    }
    els.list.innerHTML = state.users.map(function (u) {
      var socials = [];
      if (u.twitter) socials.push('X @' + u.twitter);
      if (u.github) socials.push('GH @' + u.github);
      return '<tr data-id="' + esc(u.id) + '">' +
        '<td><strong>' + esc(u.displayName || u.username) + '</strong><small>' + esc(u.username || '') + '</small></td>' +
        '<td>' + esc(u.email || '—') + '</td>' +
        '<td>' + esc(socials.join(' · ') || '—') + '</td>' +
        '<td>' + flagsHtml(u) + '</td>' +
        '<td class="admin-users-date">' + esc(cleanDate(u.createdAt)) + '</td>' +
        '<td class="admin-users-date">' + esc(cleanDate(u.lastSeenAt || u.updatedAt)) + '</td>' +
        '<td><button type="button" class="secondary-action" data-edit="' + esc(u.id) + '">Edit</button></td>' +
      '</tr>';
    }).join('');
    updatePagination();
  }
  function loadUsers(opts) {
    opts = opts || {};
    if (opts.resetPage) state.offset = 0;
    state.loading = true;
    updatePagination();
    setStatus('Loading users…');
    return api('/api/admin-users?' + buildUserQuery(), 'GET').then(function (data) {
      state.users = data.users || [];
      state.total = Number(data.total) || state.users.length;
      state.limit = Number(data.limit) || state.limit;
      state.offset = Number(data.offset) || 0;
      renderUsers();
      setStatus('Loaded ' + pageInfoText() + '.');
      if (state.selected) {
        var again = state.users.find(function (u) { return Number(u.id) === Number(state.selected.id); });
        if (again) fillEditor(again);
      }
    }).catch(function (err) {
      var message = err.message || 'Unable to load users.';
      setStatus(message, 'error');
      if (/sign in/i.test(message)) {
        showAuthPanel(true);
        setAuthStatus('Sign in to load admin users.');
        els.list.innerHTML = '<tr><td colspan="7" class="admin-users-empty">Sign in with a world-admin account.</td></tr>';
      } else {
        els.list.innerHTML = '<tr><td colspan="7" class="admin-users-empty">Admin access required.</td></tr>';
      }
    }).finally(function () { state.loading = false; updatePagination(); });
  }
  function reloadFromFilters() { return loadUsers({ resetPage: true }); }
  function bind() {
    if (els.authPanel) {
      els.authPanel.addEventListener('submit', function (evt) {
        evt.preventDefault();
        signInAdmin();
      });
    }
    if (els.authLogout) els.authLogout.addEventListener('click', signOutAdmin);
    els.searchBtn.addEventListener('click', reloadFromFilters);
    els.refreshBtn.addEventListener('click', function () { loadUsers(); });
    els.search.addEventListener('keydown', function (evt) { if (evt.key === 'Enter') { evt.preventDefault(); reloadFromFilters(); } });
    [els.flag, els.created, els.seen, els.sort, els.limit].forEach(function (el) {
      if (el) el.addEventListener('change', reloadFromFilters);
    });
    if (els.prev) els.prev.addEventListener('click', function () {
      state.offset = Math.max(0, state.offset - currentLimit());
      loadUsers();
    });
    if (els.next) els.next.addEventListener('click', function () {
      state.offset = state.offset + currentLimit();
      loadUsers();
    });
    els.list.addEventListener('click', function (evt) {
      var btn = evt.target && evt.target.closest && evt.target.closest('[data-edit]');
      if (!btn) return;
      var id = Number(btn.getAttribute('data-edit'));
      fillEditor(state.users.find(function (u) { return Number(u.id) === id; }));
    });
    els.editor.addEventListener('submit', function (evt) {
      evt.preventDefault();
      setStatus('Saving account…');
      api('/api/admin-users', 'PUT', selectedPayload()).then(function (data) {
        var user = data.user;
        state.users = state.users.map(function (u) { return Number(u.id) === Number(user.id) ? user : u; });
        renderUsers();
        fillEditor(user);
        setStatus('Account saved.');
      }).catch(function (err) { setStatus(err.message || 'Save failed.', 'error'); });
    });
    els.reset.addEventListener('click', function () {
      if (!state.selected) return;
      if (!confirm('Send a password reset email to ' + (els.email.value || state.selected.email || 'this user') + '?')) return;
      setStatus('Requesting password reset…');
      api('/api/admin-users', 'POST', { action: 'resetPassword', id: Number(els.id.value) }).then(function (data) {
        var sent = data.reset && data.reset.sent;
        fillEditor(data.user);
        setStatus(sent ? 'Password reset email requested.' : 'Reset recorded. Configure NETLIFY_AUTH_TOKEN + NETLIFY_SITE_ID to send recovery emails.', sent ? '' : 'warn');
      }).catch(function (err) { setStatus(err.message || 'Password reset failed.', 'error'); });
    });
    if (els.confirmEmails) els.confirmEmails.addEventListener('click', function () {
      if (!confirm('Confirm every Netlify Identity user that has an email address?')) return;
      els.confirmEmails.disabled = true;
      setStatus('Confirming Identity email users…');
      api('/api/admin-users', 'POST', { action: 'confirmAllEmails' }).then(function (data) {
        var info = data.confirm || {};
        setStatus('Confirmed ' + (info.confirmed || 0) + ' email users. Scanned ' + (info.scanned || 0) + '.', info.errors && info.errors.length ? 'warn' : '');
      }).catch(function (err) {
        setStatus(err.message || 'Email confirmation failed.', 'error');
      }).finally(function () {
        els.confirmEmails.disabled = false;
      });
    });
  }
  function init() {
    els = {
      authPanel: byId('admin-users-auth'), authEmail: byId('admin-auth-email'), authPassword: byId('admin-auth-password'),
      authLogin: byId('admin-auth-login'), authLogout: byId('admin-auth-logout'), authStatus: byId('admin-auth-status'),
      search: byId('admin-user-search'), searchBtn: byId('admin-user-search-btn'), refreshBtn: byId('admin-user-refresh-btn'),
      confirmEmails: byId('admin-user-confirm-emails'),
      flag: byId('admin-user-flag'), created: byId('admin-user-created'), seen: byId('admin-user-seen'), sort: byId('admin-user-sort'),
      limit: byId('admin-user-limit'), prev: byId('admin-user-prev'), next: byId('admin-user-next'), pageInfo: byId('admin-users-page-info'),
      status: byId('admin-users-status'), list: byId('admin-users-list'), editor: byId('admin-user-editor'), idPill: byId('admin-user-id-pill'),
      id: byId('admin-user-id'), username: byId('admin-user-username'), email: byId('admin-user-email'), display: byId('admin-user-display'),
      twitter: byId('admin-user-twitter'), github: byId('admin-user-github'), image: byId('admin-user-image'), about: byId('admin-user-about'),
      lobby: byId('admin-user-lobby'), reset: byId('admin-user-reset-password'), resetNote: byId('admin-reset-note'),
    };
    bind();
    Promise.resolve(window.__tinyworldAuthReady).catch(function () {}).then(function () {
      refreshAuthPanel().then(loadUsers);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
