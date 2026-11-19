/* top-holders.js — Fetches /api/holders/top and renders the overlay card.
 *
 * Depends on window.TinyWorldAchievements (scripts/achievements.js loaded first).
 * The overlay (#top-holders) is hidden by default; revealed only when at least
 * one holder is returned. Stays hidden on empty list or any fetch error.
 */
(function () {
  'use strict';

  var ENDPOINT = '/api/holders/top';

  /* Build one <li> row: rank number + name + world-count badges */
  function buildRow(holder) {
    var li = document.createElement('li');
    li.className = 'top-holders-row';

    var rankEl = document.createElement('span');
    rankEl.className = 'top-holders-rank';
    rankEl.textContent = '#' + holder.rank;

    var nameEl = document.createElement('span');
    nameEl.className = 'top-holders-name';
    nameEl.textContent = holder.name;

    var badgesEl = document.createElement('span');
    badgesEl.className = 'top-holders-badges';

    /* Earn badges by worlds published only — pass null for rank so
       rank-based badges (Pioneer, Trailblazer) are excluded. */
    var achievements = window.TinyWorldAchievements;
    if (achievements) {
      var earnedIds = achievements.earnedBadges(holder.worldsPublished, null);
      var catalog = achievements.catalog;
      for (var i = 0; i < earnedIds.length; i++) {
        var id = earnedIds[i];
        for (var j = 0; j < catalog.length; j++) {
          if (catalog[j].id === id) {
            var wrap = document.createElement('span');
            wrap.className = 'top-holders-badge';
            wrap.title = catalog[j].name;
            /* catalog SVG is static developer markup — safe to set as innerHTML */
            wrap.innerHTML = catalog[j].svg;
            badgesEl.appendChild(wrap);
            break;
          }
        }
      }
    }

    li.appendChild(rankEl);
    li.appendChild(nameEl);
    li.appendChild(badgesEl);
    return li;
  }

  /* Fetch and render. Exposed as window.loadTopHolders so the browser
     verify step can re-run it after installing a fetch mock. */
  function loadTopHolders() {
    var el = document.getElementById('top-holders');
    var list = document.getElementById('top-holders-list');
    if (!el || !list) return;

    /* Reset state before re-loading */
    list.innerHTML = '';
    el.setAttribute('hidden', '');

    fetch(ENDPOINT)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var holders = (data && Array.isArray(data.holders)) ? data.holders : [];
        if (holders.length === 0) return; /* stay hidden */
        for (var i = 0; i < holders.length; i++) {
          list.appendChild(buildRow(holders[i]));
        }
        el.removeAttribute('hidden');
      })
      .catch(function () {
        /* Network/parse error — overlay stays hidden */
      });
  }

  window.loadTopHolders = loadTopHolders;

  /* Auto-run on DOMContentLoaded (or immediately if already loaded) */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadTopHolders);
  } else {
    loadTopHolders();
  }
}());
