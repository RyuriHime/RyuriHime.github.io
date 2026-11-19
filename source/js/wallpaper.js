// Rebuild the wallpaper from shuffled byte fragments. The public build never
// ships a viewable image: only randomly named binary pieces plus an ordered
// manifest. Concatenating them yields the exact original WebP, so pixels and
// performance are identical to serving the file directly.
// This is obfuscation, not encryption.
(function () {
  'use strict';

  var BASE = '/assets/wallpaper/';
  var root = document.documentElement;
  var mobileQuery = window.matchMedia('(max-width: 768px)');

  function roles() {
    if (mobileQuery.matches) {
      return [
        ['reading-mobile', '--vtuber-reading-mobile'],
        ['banner-mobile', '--vtuber-banner-mobile'],
      ];
    }
    var fullPage = document.querySelector('#page-header.full_page');
    return [
      ['reading', '--vtuber-reading'],
      [fullPage ? 'banner' : 'banner-alt', fullPage ? '--vtuber-banner' : '--vtuber-banner-alt'],
    ];
  }

  async function compose(entry) {
    var ordered = entry.chunks.slice().sort(function (a, b) { return a.i - b.i; });
    var parts = await Promise.all(ordered.map(function (chunk) {
      return fetch(BASE + 'chunks/' + chunk.f, { cache: 'force-cache' }).then(function (response) {
        if (!response.ok) throw new Error('chunk ' + response.status);
        return response.arrayBuffer();
      });
    }));
    var blob = new Blob(parts, { type: entry.type || 'image/webp' });
    if (entry.size && blob.size !== entry.size) throw new Error('chunk size mismatch');
    return URL.createObjectURL(blob);
  }

  function apply(url, variable) {
    if (url) root.style.setProperty(variable, 'url("' + url + '")');
  }

  async function boot() {
    var response;
    try {
      response = await fetch(BASE + 'manifest.json', { cache: 'force-cache' });
    } catch (error) {
      return;
    }
    if (!response.ok) return;

    var manifest;
    try {
      manifest = await response.json();
    } catch (error) {
      return;
    }
    var table = (manifest && manifest.roles) || {};
    var jobs = roles()
      .filter(function (pair) { return table[pair[0]]; })
      .map(function (pair) {
        return compose(table[pair[0]])
          .then(function (url) { apply(url, pair[1]); })
          .catch(function () { /* keep the public fallback gradient */ });
      });
    if (!jobs.length) return;
    root.classList.add('wp-swapping');
    await Promise.all(jobs);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { root.classList.remove('wp-swapping'); });
    });
    root.dataset.wallpaper = 'ready';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
