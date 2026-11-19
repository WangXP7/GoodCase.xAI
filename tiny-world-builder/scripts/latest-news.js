// -------- home page "latest news" auto-reader --------
// Fetches /news and replaces the hardcoded home-page teaser with the NEWEST
// entry, so every story published to the news timeline shows on the home screen
// automatically (no manual edit of index.html per post). Degrades silently to
// the hardcoded fallback markup if /news can't be read or parsed.
(function () {
  'use strict';

  var link = document.querySelector('.top-story[data-latest-news]');
  if (!link) return;
  var headlineEl = link.querySelector('.top-story-headline');
  var summaryEl = link.querySelector('.top-story-summary');
  if (!headlineEl || !summaryEl) return;

  function text(node) {
    return node ? String(node.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  function apply(headline, summary, tag) {
    if (!headline) return;
    headlineEl.textContent = headline;
    if (summary) summaryEl.textContent = summary;
    link.setAttribute('aria-label', 'Latest news: ' + headline);
    if (tag) {
      var flag = link.querySelector('.top-story-flag');
      // Keep "Latest" as the flag; the category tag rides along in the title.
      if (flag) flag.title = tag;
    }
  }

  fetch('/news.html', { headers: { Accept: 'text/html' } })
    .then(function (res) { return res && res.ok ? res.text() : null; })
    .then(function (html) {
      if (!html) return;
      var doc = new DOMParser().parseFromString(html, 'text/html');
      // Newest entry is the first .news-entry inside the timeline.
      var entry = doc.querySelector('.news-timeline .news-entry') || doc.querySelector('.news-entry');
      if (!entry) return;
      var headline = text(entry.querySelector('h2'));
      var summary = text(entry.querySelector('p'));
      var tag = text(entry.querySelector('.news-tag'));
      if (summary.length > 180) summary = summary.slice(0, 177).replace(/\s+\S*$/, '') + '…';
      apply(headline, summary, tag);
    })
    .catch(function () { /* keep the fallback markup */ });
})();
