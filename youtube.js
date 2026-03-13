// ScrollVeil YouTube Thumbnail Module
// Copyright © 2025 Michael Arold. All Rights Reserved.
//
// This software is proprietary and confidential. Unauthorized copying, modification,
// distribution, or use of this software, via any medium, is strictly prohibited.
//
// Handles all YouTube-specific thumbnail blurring, badge display, cache management,
// and watch page integration. Loaded BEFORE content.js.
// Exposes window.ScrollVeilYouTube for content.js to call setupYTThumbnail().

(function () {
  'use strict';

  const isOnYouTube = ScrollVeilSettings.isOnYouTube;

  if (!isOnYouTube) {
    // Not on YouTube — expose a no-op API so content.js doesn't need to check
    window.ScrollVeilYouTube = {
      setupYTThumbnail: function () {},
      ytObservedThumbs: new WeakSet(),
      ytThumbCache: new Map(),
      registerDeps: function () {}
    };
    console.log('ScrollVeil: YouTube module loaded (inactive — not on YouTube)');
    return;
  }

  // ═══ Dependencies from content.js ═══
  // These are registered after content.js defines them, via registerDeps().
  // They're only needed at analysis time (not at load time), so this is safe.
  let deps = {
    detector: null,
    processedImages: null,
    processedVideos: null,
    showUnblurPopup: null,
    scoreElementText: null
  };

  // ═══ Cache & Tracking ═══
  const ytThumbCache = new Map();         // videoURL → { score, result, color }
  const ytObservedThumbs = new WeakSet();  // thumbnails we've already set up

  // ═══ Helpers ═══

  function getYTVideoURL(thumb) {
    const link = thumb.closest('a[href]');
    if (!link) return null;
    try {
      const url = new URL(link.href, window.location.origin);
      if (url.pathname === '/watch' && url.searchParams.get('v')) {
        return '/watch?v=' + url.searchParams.get('v');
      }
      if (url.pathname.startsWith('/shorts/')) {
        return url.pathname;
      }
      return url.pathname + url.search;
    } catch (e) { return link.href; }
  }

  function createYTBadge(innerHTML, clickable) {
    const badge = document.createElement('div');
    badge.className = 'scrollveil-yt-badge';
    badge.style.cssText = 'position:absolute!important;top:0!important;left:0!important;right:0!important;bottom:0!important;z-index:99999!important;display:flex!important;justify-content:center!important;align-items:flex-start!important;padding-top:6px!important;pointer-events:none!important;filter:none!important;-webkit-filter:none!important;';
    const inner = document.createElement('div');
    inner.className = 'scrollveil-yt-badge-inner';
    inner.style.cssText = 'display:inline-flex;align-items:center;gap:4px;background:rgba(0,0,0,0.7);border-radius:12px;padding:3px 10px;font-family:Arial,sans-serif;font-size:11px;color:#fff;line-height:1;white-space:nowrap;filter:none!important;' + (clickable ? 'cursor:pointer;pointer-events:auto;' : 'pointer-events:none;');
    inner.innerHTML = innerHTML;
    badge.appendChild(inner);
    return badge;
  }

  function ytScoreBadgeHTML(score) {
    const color = score < 20 ? '#4CAF50' : score < 40 ? '#FFC107' : score < 60 ? '#FF9800' : score < 80 ? '#F44336' : '#212121';
    return '<span style="display:inline-block;width:8px;height:8px;background:' + color + ';border-radius:50%;flex-shrink:0;"></span><span style="color:' + color + ';font-weight:bold;">' + score + '%</span>';
  }

  function getYTBadgeHost(thumb) {
    let el = thumb.parentElement;
    while (el && el.tagName !== 'YTD-RICH-ITEM-RENDERER' && el.tagName !== 'YTM-SHORTS-LOCKUP-VIEW-MODEL-V2') {
      const pos = window.getComputedStyle(el).position;
      if (pos === 'relative' || pos === 'absolute') {
        el.style.zIndex = '2';
        el.style.position = pos;
        return el;
      }
      el = el.parentElement;
    }
    if (el) {
      if (window.getComputedStyle(el).position === 'static') el.style.position = 'relative';
      el.style.zIndex = '2';
      return el;
    }
    const parent = thumb.parentElement;
    if (parent) {
      if (window.getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
      parent.style.zIndex = '2';
      return parent;
    }
    return thumb;
  }

  // ═══ Main Setup Function ═══

  function setupYTThumbnail(thumb) {
    if (!thumb || ytObservedThumbs.has(thumb)) return;
    ytObservedThumbs.add(thumb);

    const badgeHost = getYTBadgeHost(thumb);
    const videoURL = getYTVideoURL(thumb);
    const cached = videoURL ? ytThumbCache.get(videoURL) : null;

    if (cached) {
      injectYTBadgeFromCache(thumb, badgeHost, cached, videoURL);
    } else {
      if (!badgeHost.querySelector('.scrollveil-yt-badge')) {
        const badge = createYTBadge(
          '<span style="display:inline-block;width:8px;height:8px;background:#888;border-radius:50%;flex-shrink:0;animation:scrollveil-pulse 1.5s ease-in-out infinite;"></span><span>Detecting\u2026</span>',
          false
        );
        badgeHost.appendChild(badge);
      }
      runYTAnalysis(thumb, badgeHost, videoURL);
    }
  }

  // ═══ Badge From Cache ═══

  function injectYTBadgeFromCache(thumb, badgeHost, cached, videoURL) {
    const old = badgeHost.querySelector('.scrollveil-yt-badge');
    if (old) old.remove();

    const threshold = window._scrollveilAutoUnblurThreshold ?? 0;
    const score = cached.score;
    const result = cached.result;

    if (score < threshold) {
      thumb.setAttribute('data-scrollveil-revealed', 'true');
      thumb.querySelectorAll('img').forEach(i => i.setAttribute('data-scrollveil-skip', 'true'));
      const badge = createYTBadge(ytScoreBadgeHTML(score) + '<span> | Reblur</span>', true);
      const inner = badge.querySelector('.scrollveil-yt-badge-inner');

      function setBlurredState() {
        inner.innerHTML = ytScoreBadgeHTML(score) + '<span> | Reveal</span>';
        thumb.removeAttribute('data-scrollveil-revealed');
        thumb.querySelectorAll('img').forEach(i => i.removeAttribute('data-scrollveil-skip'));
        const preview = document.querySelector('ytd-video-preview');
        if (preview) preview.removeAttribute('data-scrollveil-revealed');
      }

      function setRevealedState() {
        inner.innerHTML = ytScoreBadgeHTML(score) + '<span> | Reblur</span>';
        thumb.setAttribute('data-scrollveil-revealed', 'true');
        thumb.querySelectorAll('img').forEach(i => i.setAttribute('data-scrollveil-skip', 'true'));
        const preview = document.querySelector('ytd-video-preview');
        if (preview) preview.setAttribute('data-scrollveil-revealed', 'true');
      }

      inner.addEventListener('click', function(e) {
        e.preventDefault(); e.stopImmediatePropagation();
        if (thumb.getAttribute('data-scrollveil-revealed')) {
          setBlurredState();
        } else {
          deps.showUnblurPopup(result, function() {
            setRevealedState();
          });
        }
      }, true);
      badgeHost.appendChild(badge);
    } else {
      const badge = createYTBadge(ytScoreBadgeHTML(score) + '<span> | Reveal</span>', true);
      const inner = badge.querySelector('.scrollveil-yt-badge-inner');

      function setBlurredState() {
        inner.innerHTML = ytScoreBadgeHTML(score) + '<span> | Reveal</span>';
        thumb.removeAttribute('data-scrollveil-revealed');
        thumb.querySelectorAll('img').forEach(i => i.removeAttribute('data-scrollveil-skip'));
        const preview = document.querySelector('ytd-video-preview');
        if (preview) preview.removeAttribute('data-scrollveil-revealed');
      }

      function setRevealedState() {
        inner.innerHTML = ytScoreBadgeHTML(score) + '<span> | Reblur</span>';
        thumb.setAttribute('data-scrollveil-revealed', 'true');
        thumb.querySelectorAll('img').forEach(i => i.setAttribute('data-scrollveil-skip', 'true'));
        const preview = document.querySelector('ytd-video-preview');
        if (preview) preview.setAttribute('data-scrollveil-revealed', 'true');
      }

      inner.addEventListener('click', function(e) {
        e.preventDefault(); e.stopImmediatePropagation();
        if (thumb.getAttribute('data-scrollveil-revealed')) {
          setBlurredState();
        } else {
          deps.showUnblurPopup(result, function() {
            setRevealedState();
          });
        }
      }, true);
      badgeHost.appendChild(badge);
    }
  }

  // ═══ Thumbnail Analysis ═══

  async function runYTAnalysis(thumb, badgeHost, videoURL) {
    let img = thumb.querySelector('img');

    if (!img) {
      await new Promise(resolve => {
        const waitObs = new MutationObserver(() => {
          img = thumb.querySelector('img');
          if (img) { waitObs.disconnect(); resolve(); }
        });
        waitObs.observe(thumb, { childList: true, subtree: true });
        setTimeout(() => { waitObs.disconnect(); resolve(); }, 3000);
      });
    }
    if (!img) {
      ytObservedThumbs.delete(thumb);
      return;
    }

    deps.processedImages.add(img);
    img.dataset.scrollveilProcessed = 'true';

    if (!img.complete || !img.naturalWidth) {
      await new Promise(resolve => {
        const onLoad = () => { img.removeEventListener('load', onLoad); resolve(); };
        img.addEventListener('load', onLoad);
        setTimeout(resolve, 4000);
      });
    }

    if (!img.naturalWidth || img.naturalWidth < 50) {
      const retryImg = thumb.querySelector('img');
      if (retryImg && retryImg !== img && retryImg.naturalWidth >= 50) {
        img = retryImg;
      }
    }

    if (!img.naturalWidth || img.naturalWidth < 50) {
      ytObservedThumbs.delete(thumb);
      return;
    }

    try {
      const result = await deps.detector.analyzeImage(img);

      try {
        const langResult = await deps.scoreElementText(thumb);
        result.languageScore = langResult.scoreResult.score;
        result.languageIsNA = langResult.scoreResult.isNA;
        result.languageMatches = langResult.scoreResult.matches;
        result.languageTagSummary = langResult.scoreResult.tagSummary;
        result.languageWordCount = langResult.scoreResult.wordCount;
        result.languageSources = langResult.sources;
        result.displayScore = Math.max(result.score, langResult.scoreResult.isNA ? 0 : langResult.scoreResult.score);
        console.log('ScrollVeil: YT thumbnail language score: ' + result.languageScore + '% (visual: ' + result.score + '%, display: ' + result.displayScore + '%)');
      } catch (langErr) {
        console.log('ScrollVeil: YT language scoring failed:', langErr);
        result.displayScore = result.score;
      }

      const displayScore = result.displayScore || result.score;
      if (videoURL) ytThumbCache.set(videoURL, { score: displayScore, result });
      updateYTBadgeAfterAnalysis(thumb, badgeHost, displayScore, result, videoURL);
    } catch (err) {
      console.log('ScrollVeil: YT analysis failed:', err.message);
      const fallback = { score: 0, reason: 'Analysis error', action: 'blur', decision: 'FILTERED' };
      if (videoURL) ytThumbCache.set(videoURL, { score: 0, result: fallback });
      updateYTBadgeAfterAnalysis(thumb, badgeHost, 0, fallback, videoURL);
    }
  }

  function updateYTBadgeAfterAnalysis(thumb, badgeHost, score, result, videoURL) {
    const old = badgeHost.querySelector('.scrollveil-yt-badge');
    if (old) old.remove();
    const cached = { score, result };
    injectYTBadgeFromCache(thumb, badgeHost, cached, videoURL);
  }

  // ═══ Watch Page Player Badge ═══

  let watchPageProcessed = false;

  function setupWatchPageBadge() {
    if (!window.location.pathname.startsWith('/watch')) return;

    const player = document.querySelector('#movie_player');
    if (!player) return;
    if (player.querySelector('.scrollveil-yt-badge')) return;
    if (watchPageProcessed) return;
    watchPageProcessed = true;

    const params = new URLSearchParams(window.location.search);
    const videoId = params.get('v');
    if (!videoId) return;

    if (window.getComputedStyle(player).position === 'static') {
      player.style.position = 'relative';
    }

    const thumbURL = 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg';
    const cached = ytThumbCache.get(thumbURL);
    if (cached) {
      placeWatchBadge(player, cached.score, cached.result);
      return;
    }

    const detectBadge = createYTBadge('<span style="animation:scrollveil-pulse 1.5s infinite">Detecting...</span>', false);
    player.appendChild(detectBadge);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = thumbURL;
    img.onload = async function() {
      if (!deps.detector) { watchPageProcessed = false; return; }
      try {
        const result = await deps.detector.analyzeImage(img);
        const score = result.score;
        ytThumbCache.set(thumbURL, { score, result });
        const old = player.querySelector('.scrollveil-yt-badge');
        if (old) old.remove();
        placeWatchBadge(player, score, result);
      } catch (err) {
        console.log('ScrollVeil: Watch page analysis failed:', err.message);
        watchPageProcessed = false;
      }
    };
    img.onerror = function() {
      console.log('ScrollVeil: Could not load watch page thumbnail');
      watchPageProcessed = false;
    };
  }

  function placeWatchBadge(player, score, result) {
    const threshold = window._scrollveilAutoUnblurThreshold ?? 0;
    const startRevealed = score < threshold;

    if (!startRevealed) {
      player.classList.add('scrollveil-watch-blurred');
    }

    const startLabel = startRevealed
      ? ytScoreBadgeHTML(score) + '<span> | Reblur</span>'
      : ytScoreBadgeHTML(score) + '<span> | Reveal</span>';

    const badge = createYTBadge(startLabel, true);
    const inner = badge.querySelector('.scrollveil-yt-badge-inner');

    function setBlurredState() {
      inner.innerHTML = ytScoreBadgeHTML(score) + '<span> | Reveal</span>';
      player.classList.add('scrollveil-watch-blurred');
    }

    function setRevealedState() {
      inner.innerHTML = ytScoreBadgeHTML(score) + '<span> | Reblur</span>';
      player.classList.remove('scrollveil-watch-blurred');
    }

    inner.addEventListener('click', function(e) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (player.classList.contains('scrollveil-watch-blurred')) {
        deps.showUnblurPopup(result, function() {
          setRevealedState();
        });
      } else {
        setBlurredState();
      }
    }, true);

    player.appendChild(badge);
  }

  // ═══ SPA Navigation Handler ═══
  // YouTube is a single-page app — detect URL changes and reset state.
  let lastWatchURL = '';
  setInterval(() => {
    const currentURL = window.location.href;
    if (currentURL !== lastWatchURL) {
      lastWatchURL = currentURL;
      watchPageProcessed = false;

      // Reset video processing state so the new video gets analyzed
      if (window.location.pathname.startsWith('/watch') || window.location.pathname.startsWith('/shorts/')) {
        const mp = document.querySelector('#movie_player') || document.querySelector('#shorts-player');
        if (mp) {
          mp._scrollveilProcessed = false;
          mp.style.removeProperty('filter');
          mp.removeAttribute('data-scrollveil-analyzed');
        }
        const vid = mp ? mp.querySelector('video') : document.querySelector('video');
        if (vid && deps.processedVideos) {
          deps.processedVideos.delete(vid);
          vid.removeAttribute('data-scrollveil-analyzed');
          vid.dataset.scrollveilProcessed = '';
          vid._scrollveilBlurred = false;
          // cleanupVideoOverlays and cancelVideoFrameSampling are called
          // via content.js's own SPA detection — we just reset tracking here
        }
        console.log('ScrollVeil: YouTube SPA navigation detected — reset state for new analysis');
      }
    }
  }, 1000);

  // ═══ Public API ═══
  window.ScrollVeilYouTube = {
    setupYTThumbnail: setupYTThumbnail,
    ytObservedThumbs: ytObservedThumbs,
    ytThumbCache: ytThumbCache,
    registerDeps: function (d) {
      if (d.detector)          deps.detector = d.detector;
      if (d.processedImages)   deps.processedImages = d.processedImages;
      if (d.processedVideos)   deps.processedVideos = d.processedVideos;
      if (d.showUnblurPopup)   deps.showUnblurPopup = d.showUnblurPopup;
      if (d.scoreElementText)  deps.scoreElementText = d.scoreElementText;
      console.log('ScrollVeil: YouTube module dependencies registered');
    }
  };

  console.log('ScrollVeil: YouTube module loaded');
})();
