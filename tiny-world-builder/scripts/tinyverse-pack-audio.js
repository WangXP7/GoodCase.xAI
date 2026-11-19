// -------- Tinyverse pack reveal audio (reuses builder foley in sounds/) --------
(function () {
  'use strict';

  const SOUNDS_BASE = 'sounds/';
  const SFX_GROUPS = {
    rustle: ['foley-rustle-1.mp3', 'foley-rustle-2.mp3', 'foley-rustle-3.mp3'],
    knock: ['foley-knock-jingle-1.mp3', 'foley-knock-jingle-2.mp3'],
    whoosh: ['foley-whoosh-1.mp3', 'foley-whoosh-2.mp3'],
    ripple: ['foley-digital ripple activity.mp3'],
  };
  const SFX_MIN_GAP = { rustle: 70, knock: 90, whoosh: 110, ripple: 240 };
  const AUDIO_LS = {
    sfx: 'tinyworld:audio:sfx',
    sfxMuted: 'tinyworld:audio:sfx-muted',
    music: 'tinyworld:audio:music',
    musicMuted: 'tinyworld:audio:music-muted',
    musicTrack: 'tinyworld:audio:music-track',
    musicMode: 'tinyworld:audio:music-mode',
  };

  function storedVolume(key, fallback) {
    const v = parseFloat(localStorage.getItem(key));
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback;
  }

  let sfxVolume = storedVolume(AUDIO_LS.sfx, 0.7);
  let sfxMuted = localStorage.getItem(AUDIO_LS.sfxMuted) === '1';
  let musicVolume = storedVolume(AUDIO_LS.music, 0.16);
  let musicMuted = localStorage.getItem(AUDIO_LS.musicMuted) === '1';
  let unlocked = false;
  let musicAudio = null;
  const sfxPool = {};
  const sfxLastPlay = {};

  for (const group of Object.keys(SFX_GROUPS)) {
    sfxPool[group] = SFX_GROUPS[group].map(function (name) {
      const node = new Audio(SOUNDS_BASE + encodeURIComponent(name));
      node.preload = 'auto';
      node.crossOrigin = 'anonymous';
      return node;
    });
  }

  function play(group, scale) {
    if (sfxMuted || !unlocked) return;
    const now = performance.now();
    if (now - (sfxLastPlay[group] || 0) < (SFX_MIN_GAP[group] || 80)) return;
    sfxLastPlay[group] = now;
    const pool = sfxPool[group];
    if (!pool || !pool.length) return;
    const base = pool[Math.floor(Math.random() * pool.length)];
    const node = base.cloneNode();
    node.volume = Math.max(0, Math.min(1, sfxVolume * (scale || 1)));
    node.addEventListener('ended', function () { node.src = ''; }, { once: true });
    const p = node.play();
    if (p && typeof p.catch === 'function') p.catch(function () {});
  }

  function pickMusicTrack() {
    const mode = localStorage.getItem(AUDIO_LS.musicMode);
    const saved = localStorage.getItem(AUDIO_LS.musicTrack);
    if (mode === 'manual' && saved) return saved;
    const tracks = [
      'music-horizon-1.mp3',
      'music-horizon-2.mp3',
      'music-horizon-3.mp3',
      'music-horizon-4.mp3',
      'music-horizon-5.mp3',
      'music-horizon-6.mp3',
    ];
    return tracks[Math.floor(Math.random() * tracks.length)];
  }

  function startAmbience() {
    if (musicMuted || !unlocked || musicAudio) return;
    musicAudio = new Audio(SOUNDS_BASE + pickMusicTrack());
    musicAudio.loop = true;
    musicAudio.volume = musicVolume;
    musicAudio.crossOrigin = 'anonymous';
    const p = musicAudio.play();
    if (p && typeof p.catch === 'function') {
      p.catch(function () {
        musicAudio = null;
      });
    }
  }

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    startAmbience();
  }

  function bindUnlockGesture() {
    function once() {
      unlock();
      window.removeEventListener('pointerdown', once);
      window.removeEventListener('keydown', once);
    }
    window.addEventListener('pointerdown', once, { passive: true });
    window.addEventListener('keydown', once);
  }

  bindUnlockGesture();

  window.TinyversePackAudio = {
    unlock,
    play,
    packBuy: function () { play('knock', 0.95); },
    packBurst: function () { play('whoosh', 1); },
    cardFlip: function () { play('rustle', 0.55); },
    cardFocus: function () { play('ripple', 0.32); },
    visitIsland: function () { play('whoosh', 0.72); },
    bonusGold: function () { play('knock', 0.82); },
    uiTap: function () { play('rustle', 0.28); },
    collectionOpen: function () { play('ripple', 0.38); },
  };
})();