  // -------- account wallet / players --------
  (function wireAccountWalletAndPlayers() {
    let walletPanelReady = false;
    let playersPanelReady = false;
    let walletState = null;
    let playerSearchTimer = null;
    let playerHeartbeatTimer = null;

    function apiCall(path, method, body) {
      if (typeof window.__tinyworldCloudApiCall !== 'function') {
        return Promise.resolve({ error: 'Account API unavailable' });
      }
      return window.__tinyworldCloudApiCall(path, method || 'GET', body);
    }

    function toast(message, kind) {
      if (typeof twToast === 'function') twToast(message, kind);
      else console.info('[account]', message);
    }

    function isCloudUnavailable(result) {
      return !!(result && result.cloudUnavailable);
    }

    function cloudUnavailableText() {
      return 'Cloud account features are unavailable in this Netlify session.';
    }

    function cloudUnavailableStatus() {
      return 'Account cloud unavailable';
    }

    function cloudUnavailableToast() {
      toast(cloudUnavailableText(), 'warn');
    }

    function byId(id) {
      return document.getElementById(id);
    }

    function setWalletStatus(text, tone) {
      const el = byId('wallet-status');
      if (!el) return;
      el.textContent = text;
      el.className = 'wallet-status' + (tone ? ' ' + tone : '');
    }

    function shortAddress(value) {
      const text = String(value || '');
      if (text.length <= 14) return text || 'Not connected';
      return text.slice(0, 6) + '...' + text.slice(-6);
    }

    function bytesToBase64(bytes) {
      const arr = Array.from(bytes || []);
      let bin = '';
      arr.forEach(b => { bin += String.fromCharCode(Number(b) & 0xff); });
      return btoa(bin);
    }

    function phantomProvider() {
      const provider = window.phantom && window.phantom.solana ? window.phantom.solana : window.solana;
      return provider && provider.isPhantom ? provider : null;
    }

    function renderWalletActivity(items) {
      const list = byId('wallet-activity-list');
      const empty = byId('wallet-activity-empty');
      if (!list) return;
      list.textContent = '';
      const rows = Array.isArray(items) ? items : [];
      if (empty) empty.hidden = rows.length > 0;
      rows.forEach(item => {
        const li = document.createElement('li');
        const main = document.createElement('div');
        main.className = 'activity-main';
        const sig = document.createElement('strong');
        sig.textContent = shortAddress(item.signature);
        const meta = document.createElement('span');
        meta.className = 'activity-meta';
        const when = item.blockTime ? new Date(Number(item.blockTime) * 1000).toLocaleString() : 'pending';
        meta.textContent = when + (item.err ? ' · failed' : '');
        main.appendChild(sig);
        main.appendChild(meta);
        const link = document.createElement('a');
        link.href = 'https://solscan.io/tx/' + encodeURIComponent(item.signature || '');
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.textContent = 'View';
        li.appendChild(main);
        li.appendChild(link);
        list.appendChild(li);
      });
    }

    function renderWallet(data) {
      walletState = data || {};
      const wallet = walletState.wallet;
      const token = walletState.token || {};
      const address = byId('wallet-address');
      const count = byId('wallet-token-count');
      const disconnect = byId('wallet-disconnect');
      const paymentLink = byId('wallet-payment-link');
      if (address) {
        address.textContent = wallet ? shortAddress(wallet.publicKey) : 'Not connected';
        address.title = wallet ? wallet.publicKey : '';
      }
      if (count) {
        const symbol = token.symbol || 'TINYWORLD';
        const value = token.uiAmount || wallet && wallet.tokenBalance || '0';
        count.textContent = symbol + ': ' + value;
      }
      if (disconnect) disconnect.disabled = !wallet;
      if (paymentLink && !paymentLink.href) paymentLink.hidden = true;
      if (wallet) setWalletStatus(token.error ? 'Linked' : 'Linked', token.error ? 'warn' : 'ok');
      else setWalletStatus(phantomProvider() ? 'Ready' : 'No Phantom', phantomProvider() ? '' : 'warn');
      renderWalletActivity(walletState.activity);
    }

    async function refreshWallet() {
      setWalletStatus('Loading...', '');
      const data = await apiCall('/api/wallet', 'GET');
      if (data && data.error) {
        setWalletStatus(isCloudUnavailable(data) ? cloudUnavailableStatus() : 'Error', isCloudUnavailable(data) ? 'warn' : 'err');
        if (!isCloudUnavailable(data)) toast(data.error, 'err');
        return;
      }
      renderWallet(data);
    }

    async function connectWallet() {
      const provider = phantomProvider();
      if (!provider) {
        setWalletStatus('No Phantom', 'err');
        toast('Phantom wallet was not found.', 'err');
        return;
      }
      if (typeof provider.signMessage !== 'function') {
        setWalletStatus('No signer', 'err');
        toast('This Phantom provider cannot sign messages.', 'err');
        return;
      }
      try {
        setWalletStatus('Connecting...', '');
        const connected = await provider.connect();
        const publicKey = connected && connected.publicKey ? connected.publicKey.toString() : (provider.publicKey && provider.publicKey.toString());
        if (!publicKey) throw new Error('Wallet did not return a public key');
        const challenge = await apiCall('/api/wallet', 'POST', { action: 'challenge', publicKey });
        if (isCloudUnavailable(challenge)) {
          setWalletStatus(cloudUnavailableStatus(), 'warn');
          cloudUnavailableToast();
          return;
        }
        if (!challenge || challenge.error) throw new Error((challenge && challenge.error) || 'Could not create wallet challenge');
        const signed = await provider.signMessage(new TextEncoder().encode(challenge.message), 'utf8');
        const signature = bytesToBase64(signed.signature || signed);
        const result = await apiCall('/api/wallet', 'POST', {
          action: 'connect',
          publicKey,
          message: challenge.message,
          signature,
        });
        if (isCloudUnavailable(result)) {
          setWalletStatus(cloudUnavailableStatus(), 'warn');
          cloudUnavailableToast();
          return;
        }
        if (!result || result.error) throw new Error((result && result.error) || 'Wallet link failed');
        renderWallet(result);
        toast('Phantom wallet linked.', 'ok');
      } catch (err) {
        setWalletStatus('Failed', 'err');
        toast((err && err.message) || 'Wallet link failed.', 'err');
      }
    }

    async function disconnectWallet() {
      const provider = phantomProvider();
      try { if (provider && typeof provider.disconnect === 'function') await provider.disconnect(); } catch (_) {}
      const result = await apiCall('/api/wallet', 'POST', { action: 'disconnect' });
      if (result && result.error && !isCloudUnavailable(result)) toast(result.error, 'err');
      renderWallet({ wallet: null, token: { uiAmount: '0', symbol: 'TINYWORLD' }, activity: [] });
    }

    async function createWalletPayment() {
      const amountEl = byId('wallet-payment-amount');
      const link = byId('wallet-payment-link');
      const amount = amountEl ? amountEl.value.trim() : '';
      if (!amount) { toast('Enter a payment amount.', 'err'); return; }
      const payerWallet = walletState && walletState.wallet ? walletState.wallet.publicKey : '';
      const result = await apiCall('/api/wallet/payments', 'POST', {
        action: 'create',
        amount,
        payerWallet,
      });
      if (!result || result.error) {
        if (isCloudUnavailable(result)) cloudUnavailableToast();
        else toast((result && result.error) || 'Payment failed.', 'err');
        return;
      }
      if (link) {
        link.href = result.solanaPayUrl;
        link.textContent = 'Open payment: ' + result.amount;
        link.hidden = false;
      }
      toast('Payment link ready.', 'ok');
    }

    function initWalletPanel() {
      if (walletPanelReady) return;
      walletPanelReady = true;
      const connect = byId('wallet-connect');
      const refresh = byId('wallet-refresh');
      const disconnect = byId('wallet-disconnect');
      const payment = byId('wallet-payment-create');
      if (connect) connect.addEventListener('click', connectWallet);
      if (refresh) refresh.addEventListener('click', refreshWallet);
      if (disconnect) disconnect.addEventListener('click', disconnectWallet);
      if (payment) payment.addEventListener('click', createWalletPayment);
      renderWallet({ wallet: null, token: { uiAmount: '0', symbol: 'TINYWORLD' }, activity: [] });
    }

    function renderStats(stats) {
      const el = byId('players-stats');
      if (!el) return;
      el.textContent = '';
      [
        ['online', 'Online'],
        ['profiles', 'Players'],
        ['tokenHolders', 'Holders'],
        ['parties', 'Parties'],
      ].forEach(([key, label]) => {
        const box = document.createElement('div');
        box.className = 'players-stat';
        const strong = document.createElement('strong');
        strong.textContent = String((stats && stats[key]) || 0);
        const span = document.createElement('span');
        span.textContent = label;
        box.appendChild(strong);
        box.appendChild(span);
        el.appendChild(box);
      });
    }

    async function sendChatRequest(profileId) {
      const result = await apiCall('/api/players', 'POST', {
        action: 'chatRequest',
        recipientProfileId: profileId,
      });
      if (result && result.error) {
        if (isCloudUnavailable(result)) cloudUnavailableToast();
        else toast(result.error, 'err');
      }
      else toast('Chat request sent.', 'ok');
    }

    function renderPlayers(players) {
      const list = byId('players-list');
      if (!list) return;
      list.textContent = '';
      const rows = Array.isArray(players) ? players : [];
      rows.forEach(player => {
        const li = document.createElement('li');
        const main = document.createElement('div');
        main.className = 'player-main';
        const name = document.createElement('strong');
        name.textContent = player.displayName || player.username || 'Player';
        const meta = document.createElement('span');
        meta.className = 'player-meta';
        const bits = [];
        bits.push(player.online ? 'online' : 'offline');
        if (player.username) bits.push('@' + player.username);
        if (player.hasTinyworldTokens) bits.push('TINYWORLD ' + (player.tokenBalance || '0'));
        meta.textContent = bits.join(' · ');
        main.appendChild(name);
        main.appendChild(meta);
        const actions = document.createElement('div');
        actions.className = 'player-actions';
        const chat = document.createElement('button');
        chat.type = 'button';
        chat.textContent = 'Chat';
        chat.addEventListener('click', () => sendChatRequest(player.id));
        actions.appendChild(chat);
        li.appendChild(main);
        li.appendChild(actions);
        list.appendChild(li);
      });
      if (!rows.length) {
        const li = document.createElement('li');
        li.textContent = 'No players found.';
        list.appendChild(li);
      }
    }

    async function loadPlayers() {
      const q = byId('players-search') ? byId('players-search').value.trim() : '';
      const data = await apiCall('/api/players' + (q ? '?q=' + encodeURIComponent(q) : '?online=1'), 'GET');
      if (!data || data.error) {
        if (isCloudUnavailable(data)) {
          renderStats({ online: 0, profiles: 0, tokenHolders: 0, parties: 0 });
          renderPlayers([]);
        } else {
          toast((data && data.error) || 'Player lookup failed.', 'err');
        }
        return;
      }
      renderStats(data.stats);
      renderPlayers(data.players);
    }

    function schedulePlayerSearch() {
      clearTimeout(playerSearchTimer);
      playerSearchTimer = setTimeout(loadPlayers, 260);
    }

    async function heartbeatPlayers() {
      if (!window.__loggedIn) return;
      const mp = window.__tinyworldMultiplayer;
      const roomId = mp && mp.roomId ? mp.roomId : '';
      await apiCall('/api/players', 'POST', { action: 'heartbeat', roomId });
    }

    function startPlayerHeartbeat() {
      if (playerHeartbeatTimer) return;
      heartbeatPlayers().catch(() => {});
      playerHeartbeatTimer = setInterval(() => {
        heartbeatPlayers().catch(() => {});
      }, 60_000);
    }

    async function createParty() {
      const nameEl = byId('party-name');
      const link = byId('party-link');
      const result = await apiCall('/api/players', 'POST', {
        action: 'createParty',
        name: nameEl && nameEl.value.trim() ? nameEl.value.trim() : 'TinyWorld party',
      });
      if (!result || result.error || !result.party) {
        if (isCloudUnavailable(result)) cloudUnavailableToast();
        else toast((result && result.error) || 'Party creation failed.', 'err');
        return;
      }
      if (link) {
        link.href = result.party.absoluteUrl || result.party.url;
        link.textContent = 'Open party room: ' + result.party.roomId;
        link.hidden = false;
      }
      try { await navigator.clipboard.writeText(result.party.absoluteUrl || result.party.url); } catch (_) {}
      toast('Party room ready.', 'ok');
      loadPlayers();
    }

    async function requestVoiceToken() {
      const status = byId('voice-status');
      const voiceRoomEl = byId('voice-room');
      const room = voiceRoomEl && voiceRoomEl.value.trim()
        ? voiceRoomEl.value.trim()
        : (window.__tinyworldMultiplayer && window.__tinyworldMultiplayer.roomId) || 'tinyworld-lobby';
      if (status) status.textContent = 'Preparing voice...';
      const result = await apiCall('/api/livekit/token', 'POST', { room });
      if (!result || result.error) {
        const message = isCloudUnavailable(result) ? cloudUnavailableText() : ((result && result.error) || 'Voice unavailable.');
        if (status) status.textContent = message;
        toast(message, isCloudUnavailable(result) ? 'warn' : 'err');
        return;
      }
      window.__tinyworldLiveKitLastToken = result;
      window.dispatchEvent(new CustomEvent('tinyworld:livekit-token', { detail: result }));
      if (status) status.textContent = 'Voice token ready for ' + result.room + '.';
      toast('Voice token ready.', 'ok');
    }

    function initPlayersPanel() {
      if (playersPanelReady) return;
      playersPanelReady = true;
      const search = byId('players-search');
      const searchBtn = byId('players-search-btn');
      const create = byId('party-create');
      const voice = byId('voice-token');
      if (search) search.addEventListener('input', schedulePlayerSearch);
      if (searchBtn) searchBtn.addEventListener('click', loadPlayers);
      if (create) create.addEventListener('click', createParty);
      if (voice) voice.addEventListener('click', requestVoiceToken);
      startPlayerHeartbeat();
    }

    window.__initWalletPanel = initWalletPanel;
    window.__renderWalletPanel = refreshWallet;
    window.__initPlayersPanel = initPlayersPanel;
    window.__renderPlayersPanel = loadPlayers;
  })();
