// -------- public collab worlds page --------
(function () {
  'use strict';

  var mount = document.getElementById('collab-worlds-list');
  var summary = document.getElementById('collab-worlds-summary');
  var adminStatus = document.getElementById('collab-worlds-admin-status');
  if (!mount || !summary) return;

  var state = { admin: false, token: '', busy: false };

  function walletToken() {
    try { return localStorage.getItem('tinyworld:auth:wallet-session.v1') || ''; } catch (_) { return ''; }
  }

  function cookieToken() {
    try {
      var match = document.cookie.match(/(?:^|; )nf_jwt=([^;]*)/);
      return match ? decodeURIComponent(match[1]) : '';
    } catch (_) {
      return '';
    }
  }

  function authReady() {
    return Promise.resolve(window.__tinyworldAuthReady).catch(function () { return false; });
  }

  function accessToken() {
    var A = window.TinyWorldAuth;
    if (A && typeof A.getUser === 'function') {
      return Promise.resolve(A.getUser()).then(function (user) {
        if (user && typeof user.jwt === 'function') {
          return Promise.resolve(user.jwt()).catch(function () { return ''; }).then(function (jwt) {
            return jwt || (user.token && user.token.access_token) || walletToken() || cookieToken() || '';
          });
        }
        return (user && user.token && user.token.access_token) || walletToken() || cookieToken() || '';
      }).catch(function () { return walletToken() || cookieToken() || ''; });
    }
    return Promise.resolve(walletToken() || cookieToken() || '');
  }

  function roomHref(room) {
    var href = String((room && room.href) || '').trim();
    if (href && href.charAt(0) === '/') return href;
    var roomId = String((room && room.roomId) || '').trim();
    if (!roomId) return '/tiny-world-builder';
    var params = new URLSearchParams();
    if (room.shareId) params.set('share', room.shareId);
    params.set('party', roomId);
    params.set('observe', '1');
    return '/tiny-world-builder?' + params.toString();
  }

  function qualityLabel(room) {
    var q = String((room && room.networkQuality) || 'unknown').toLowerCase();
    if (q === 'good') return 'Good';
    if (q === 'fair') return 'Fair';
    if (q === 'poor') return 'Poor';
    return 'Unknown';
  }

  function initials(text) {
    var parts = String(text || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'TW';
    if (parts.length > 1) return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  }

  function relativeTime(value) {
    var time = Date.parse(value || '');
    if (!Number.isFinite(time)) return 'just now';
    var seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
    if (seconds < 10) return 'just now';
    if (seconds < 60) return seconds + 's ago';
    var minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + 'm ago';
    var hours = Math.round(minutes / 60);
    return hours + 'h ago';
  }

  function responseJson(res) {
    return res.text().then(function (text) {
      var data = null;
      try { data = text ? JSON.parse(text) : null; } catch (_) {}
      if (!res.ok) throw new Error((data && data.error) || ('Request failed: ' + res.status));
      return data || {};
    });
  }

  function setAdminStatus(text, tone) {
    if (!adminStatus) return;
    adminStatus.hidden = !text;
    adminStatus.textContent = text || '';
    adminStatus.dataset.tone = tone || '';
  }

  function setBusy(value) {
    state.busy = !!value;
    Array.prototype.forEach.call(mount.querySelectorAll('[data-collab-action]'), function (button) {
      button.disabled = state.busy;
    });
  }

  function adminButton(label, action, roomId, roomName) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary-action collab-admin-button' + (action === 'close' ? ' collab-admin-danger' : '');
    button.dataset.collabAction = action;
    button.dataset.roomId = roomId;
    button.dataset.roomName = roomName;
    button.textContent = label;
    button.disabled = state.busy;
    return button;
  }

  function roomCard(room) {
    var name = String(room.name || 'Shared build');
    var host = String(room.host || 'Builder');
    var location = String(room.location || 'Unknown');
    var roomId = String(room.roomId || '');
    var observers = Number(room.observerCount) || 0;
    var players = Number(room.playerCount) || 0;
    var editors = Number(room.editorCount) || 0;
    var total = observers + players + editors;
    var quality = String(room.networkQuality || 'unknown').toLowerCase();

    var article = document.createElement('article');
    article.className = 'collab-world-card';

    var badge = document.createElement('span');
    badge.className = 'collab-world-badge';
    badge.textContent = initials(name);

    var body = document.createElement('div');
    body.className = 'collab-world-body';

    var title = document.createElement('h3');
    title.textContent = name;

    var meta = document.createElement('dl');
    meta.className = 'collab-world-meta';
    [
      ['Location', location],
      ['Host', host],
      ['Viewing', String(total)],
      ['Players', String(players)],
      ['Editors', String(editors)],
      ['Updated', relativeTime(room.lastSeen)],
    ].forEach(function (pair) {
      var dt = document.createElement('dt');
      var dd = document.createElement('dd');
      dt.textContent = pair[0];
      dd.textContent = pair[1];
      meta.appendChild(dt);
      meta.appendChild(dd);
    });

    var actions = document.createElement('div');
    actions.className = 'collab-world-actions';
    var network = document.createElement('span');
    network.className = 'collab-network collab-network-' + (quality === 'good' || quality === 'fair' || quality === 'poor' ? quality : 'unknown');
    network.textContent = qualityLabel(room) + ' network';
    if (Number.isFinite(Number(room.rttMs))) network.textContent += ' - ' + Math.round(Number(room.rttMs)) + 'ms';

    var buttons = document.createElement('div');
    buttons.className = 'collab-world-action-buttons';
    var link = document.createElement('a');
    link.className = 'primary-action collab-world-enter';
    link.href = roomHref(room);
    link.textContent = 'Observe';
    buttons.appendChild(link);
    if (state.admin && roomId) {
      buttons.appendChild(adminButton('Make private', 'hide', roomId, name));
      buttons.appendChild(adminButton('Close', 'close', roomId, name));
    }
    actions.appendChild(network);
    actions.appendChild(buttons);

    body.appendChild(title);
    if (state.admin && roomId) {
      var adminMeta = document.createElement('p');
      adminMeta.className = 'collab-admin-room';
      adminMeta.textContent = 'Room ' + roomId;
      body.appendChild(adminMeta);
    }
    body.appendChild(meta);
    body.appendChild(actions);
    article.appendChild(badge);
    article.appendChild(body);
    return article;
  }

  function render(rooms) {
    mount.textContent = '';
    if (state.admin) {
      setAdminStatus('Admin controls enabled. Hide removes a room from public lists; Close shuts the public room link down.', 'ok');
    } else {
      setAdminStatus('', '');
    }
    if (!rooms || !rooms.length) {
      summary.textContent = 'No public collab rooms are live right now.';
      var empty = document.createElement('div');
      empty.className = 'collab-world-empty';
      empty.textContent = 'Start a shared build from the editor and it will appear here while the host is online.';
      mount.appendChild(empty);
      return;
    }
    summary.textContent = rooms.length + (rooms.length === 1 ? ' public room is live.' : ' public rooms are live.');
    rooms.forEach(function (room) {
      mount.appendChild(roomCard(room));
    });
  }

  function fetchRooms() {
    return authReady().then(accessToken).then(function (token) {
      state.token = token || '';
      var headers = { Accept: 'application/json' };
      var url = '/api/collabs?limit=100';
      if (state.token) {
        headers.Authorization = 'Bearer ' + state.token;
        url += '&admin=1';
      }
      return fetch(url, { headers: headers, credentials: 'same-origin', cache: 'no-store' }).then(responseJson);
    });
  }

  function postAdminAction(action, roomId) {
    return authReady().then(accessToken).then(function (token) {
      if (!token) throw new Error('Sign in as an admin to continue.');
      return fetch('/api/collabs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: 'Bearer ' + token,
        },
        credentials: 'same-origin',
        body: JSON.stringify({ action: action, roomId: roomId }),
      }).then(responseJson);
    });
  }

  function load() {
    return fetchRooms()
      .then(function (data) {
        state.admin = !!(data && data.admin);
        render(data && Array.isArray(data.rooms) ? data.rooms : []);
      })
      .catch(function (err) {
        summary.textContent = 'Could not load public rooms.';
        mount.textContent = '';
        setAdminStatus((err && err.message) || '', 'error');
      });
  }

  function handleAdminAction(action, roomId, roomName) {
    if (!state.admin || state.busy || !roomId) return;
    var label = action === 'close' ? 'Close' : 'Make private';
    var prompt = action === 'close'
      ? 'Close "' + roomName + '" for everyone? The public link will be shut down and the host will disconnect peers on the next registry heartbeat.'
      : 'Hide "' + roomName + '" from the public collab worlds list? People already inside can keep building.';
    if (window.confirm && !window.confirm(prompt)) return;
    setBusy(true);
    setAdminStatus(label + ' request sent...', '');
    postAdminAction(action === 'close' ? 'adminClose' : 'hide', roomId)
      .then(function () { return load(); })
      .catch(function (err) {
        setAdminStatus((err && err.message) || (label + ' failed.'), 'error');
      })
      .finally(function () { setBusy(false); });
  }

  mount.addEventListener('click', function (event) {
    var target = event.target && event.target.closest ? event.target.closest('[data-collab-action]') : null;
    if (!target || !mount.contains(target)) return;
    event.preventDefault();
    handleAdminAction(target.dataset.collabAction, target.dataset.roomId, target.dataset.roomName || 'this room');
  });

  load();
  setInterval(load, 30000);
})();
