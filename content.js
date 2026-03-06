// ScrollVeil Content Script
// Copyright Â© 2025 Michael Arold. All Rights Reserved.
//
// This software is proprietary and confidential. Unauthorized copying, modification,
// distribution, or use of this software, via any medium, is strictly prohibited.

console.log('🛡️ ScrollVeil: Content filter activated');

// ═══ Detection Log Buffer (for bug reports) ═══
// Keeps the last 50 detection results so the popup can pull them into reports
const _scrollveilDetectionLog = [];
function logDetection(entry) {
  _scrollveilDetectionLog.push({
    time: new Date().toISOString(),
    ...entry
  });
  // Keep only the last 50 entries
  if (_scrollveilDetectionLog.length > 50) _scrollveilDetectionLog.shift();
}

// ═══ Message Listener (for popup communication) ═══
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getDetectionReport') {
    // Build a text summary of recent detections
    const lines = [];
    lines.push('Page: ' + location.href);
    lines.push('Total detections logged: ' + _scrollveilDetectionLog.length);
    lines.push('');

    if (_scrollveilDetectionLog.length === 0) {
      lines.push('No images/videos analyzed on this page yet.');
    } else {
      // Show the last 10 detections
      const recent = _scrollveilDetectionLog.slice(-10);
      recent.forEach((entry, i) => {
        lines.push('--- Detection ' + (i + 1) + ' ---');
        lines.push('Time: ' + entry.time);
        if (entry.type) lines.push('Type: ' + entry.type);
        if (entry.score !== undefined) lines.push('Score: ' + entry.score + '%');
        if (entry.action) lines.push('Action: ' + entry.action);
        if (entry.reason) lines.push('Reason: ' + entry.reason);
        if (entry.reasons && entry.reasons.length) lines.push('Details: ' + entry.reasons.join(', '));
        if (entry.src) lines.push('Source: ' + entry.src.substring(0, 120));
        lines.push('');
      });
    }

    sendResponse({ report: lines.join('\n') });
    return true; // async response
  }
});

// Nuke all overlays from any previous extension session before doing anything else.
// When the extension reloads, old overlays persist in document.body but the new
// overlayRegistry starts empty — the orphan sweep never knows about them.
document.querySelectorAll('[data-scrollveil-overlay], .scrollveil-yt-overlay').forEach(o => o.remove());

// CRITICAL: Inject CSS to blur ALL images and videos by default (all sites).
function injectBlurCSS() {
  const style = document.createElement('style');
  style.id = 'scrollveil-blur-shield';

  // ALWAYS apply blur to both images and videos via CSS (all sites including X/YouTube)
  // Uses CSS variable --scrollveil-blur so it can be updated when settings load
  style.textContent = `
    :root { --scrollveil-blur: 30px; }
    img:not([data-scrollveil-analyzed]):not([data-scrollveil-skip]) {
      filter: blur(var(--scrollveil-blur)) !important;
      -webkit-filter: blur(var(--scrollveil-blur)) !important;
    }
    /* YouTube: imgs/videos inside BLURRED thumbnail containers should NOT be individually blurred.
       The container itself handles the blur — children must not double-blur.
       For REVEALED containers, also exempt so reveal actually works.
       Specificity must beat img:not([data-scrollveil-analyzed]):not([data-scrollveil-skip]) */
    yt-thumbnail-view-model:not([data-scrollveil-revealed]) img,
    yt-thumbnail-view-model:not([data-scrollveil-revealed]) img:not([data-scrollveil-analyzed]):not([data-scrollveil-skip]),
    yt-thumbnail-view-model:not([data-scrollveil-revealed]) video,
    yt-thumbnail-view-model[data-scrollveil-revealed] img,
    yt-thumbnail-view-model[data-scrollveil-revealed] img:not([data-scrollveil-analyzed]):not([data-scrollveil-skip]),
    yt-thumbnail-view-model[data-scrollveil-revealed] video {
      filter: none !important;
      -webkit-filter: none !important;
    }
    /* YouTube thumbnails: blur just the thumbnail container, not the whole card */
    yt-thumbnail-view-model:not([data-scrollveil-revealed]) {
      filter: blur(var(--scrollveil-blur)) !important;
      -webkit-filter: blur(var(--scrollveil-blur)) !important;
      overflow: hidden !important;
    }
    /* X/Twitter: blur the tweetPhoto CONTAINER via CSS — React strips img styles but not container styles */
    [data-testid="tweetPhoto"]:not([data-scrollveil-analyzed]) {
      filter: blur(var(--scrollveil-blur)) !important;
      -webkit-filter: blur(var(--scrollveil-blur)) !important;
    }
    /* X/Twitter: blur videoPlayer CONTAINER via CSS — same reason as tweetPhoto */
    [data-testid="videoPlayer"]:not([data-scrollveil-analyzed]) {
      filter: blur(var(--scrollveil-blur)) !important;
      -webkit-filter: blur(var(--scrollveil-blur)) !important;
    }
    /* YouTube hover preview — blur by default, exempt when revealed */
    ytd-video-preview:not([data-scrollveil-revealed]) {
      filter: blur(var(--scrollveil-blur)) !important;
      -webkit-filter: blur(var(--scrollveil-blur)) !important;
    }
    /* Detecting badge pulse animation */
    @keyframes scrollveil-pulse {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 1; }
    }
  `;

  if (document.head) {
    document.head.appendChild(style);
    console.log('✅ ScrollVeil: CSS BLUR SHIELD ACTIVATED - All images and videos will start blurred');
  } else if (document.documentElement) {
    document.documentElement.appendChild(style);
    console.log('✅ ScrollVeil: CSS BLUR SHIELD ACTIVATED (documentElement) - All images and videos will start blurred');
  } else {
    console.log('⏳ ScrollVeil: Waiting for DOM to inject CSS');
    setTimeout(injectBlurCSS, 10);
    return;
  }
}

// ═══ Global Enable/Disable Flag ═══
let scrollveilEnabled = true; // Default to enabled; checked from storage below

// Check if disabled BEFORE injecting blur shield
chrome.storage.sync.get(['scrollveilEnabled'], (result) => {
  if (result.scrollveilEnabled === false) {
    scrollveilEnabled = false;
    // Override the CSS variable in blur-shield.css to 0px so nothing is blurred
    document.documentElement.style.setProperty('--scrollveil-blur', '0px');
    console.log('⏸️ ScrollVeil: Protection is DISABLED — skipping all processing');
    return; // Don't inject dynamic CSS
  }
  // Enabled — inject the blur shield
  injectBlurCSS();
});

// Detect if we're on X/Twitter by hostname
const isOnXDomain = ['x.com', 'twitter.com', 'mobile.twitter.com', 'mobile.x.com']
  .includes(window.location.hostname);

// Detect if we're on YouTube (all thumbnails stay blurred until user clicks)
const isOnYouTube = ['www.youtube.com', 'youtube.com', 'm.youtube.com']
  .includes(window.location.hostname);

// ═══════════════════════════════════════════════════════════════
// YOUTUBE THUMBNAIL SYSTEM
// Blurs yt-thumbnail-view-model containers via CSS. Uses a
// MutationObserver on each container to survive YouTube's
// img↔video swaps on hover. Analysis results are cached by
// video URL so badges are instantly restored after swaps.
// ═══════════════════════════════════════════════════════════════

// Cache: videoURL → { score, result, color }
const ytThumbCache = new Map();

// Track which yt-thumbnail-view-model elements already have our observer
const ytObservedThumbs = new WeakSet();

// Helper: extract the video URL from a thumbnail's parent link
function getYTVideoURL(thumb) {
  const link = thumb.closest('a[href]');
  if (!link) return null;
  try {
    const url = new URL(link.href, window.location.origin);
    // Normalize: just keep /watch?v=xxx or /shorts/xxx
    if (url.pathname === '/watch' && url.searchParams.get('v')) {
      return '/watch?v=' + url.searchParams.get('v');
    }
    if (url.pathname.startsWith('/shorts/')) {
      return url.pathname;
    }
    return url.pathname + url.search;
  } catch (e) { return link.href; }
}

// Helper: create a badge element for a YouTube thumbnail
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

// Helper: get badge HTML for a score
function ytScoreBadgeHTML(score) {
  const color = score < 20 ? '#4CAF50' : score < 40 ? '#FFC107' : score < 60 ? '#FF9800' : score < 80 ? '#F44336' : '#212121';
  return '<span style="display:inline-block;width:8px;height:8px;background:' + color + ';border-radius:50%;flex-shrink:0;"></span><span style="color:' + color + ';font-weight:bold;">' + score + '%</span>';
}

// Helper: find the best parent to host the badge (outside the blurred thumbnail)
function getYTBadgeHost(thumb) {
  // Walk up from yt-thumbnail-view-model to find first positioned ancestor
  // that is NOT the thumbnail itself (so badge isn't blurred)
  let el = thumb.parentElement;
  while (el && el.tagName !== 'YTD-RICH-ITEM-RENDERER' && el.tagName !== 'YTM-SHORTS-LOCKUP-VIEW-MODEL-V2') {
    const pos = window.getComputedStyle(el).position;
    if (pos === 'relative' || pos === 'absolute') {
      // Ensure host paints above YouTube's hover preview (ytd-video-preview z-index:1)
      el.style.zIndex = '2';
      el.style.position = pos;
      return el;
    }
    el = el.parentElement;
  }
  // Fallback: use the card itself
  if (el) {
    if (window.getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.style.zIndex = '2';
    return el;
  }
  // Last resort: use thumb's direct parent and make it relative
  const parent = thumb.parentElement;
  if (parent) {
    if (window.getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    parent.style.zIndex = '2';
    return parent;
  }
  return thumb; // absolute last resort
}

// Main function: set up a YouTube thumbnail with blur, badge, observer, and analysis
function setupYTThumbnail(thumb) {
  if (!thumb || ytObservedThumbs.has(thumb)) return;
  ytObservedThumbs.add(thumb);

  // Badge goes on a PARENT of the blurred thumbnail so it isn't blurred
  const badgeHost = getYTBadgeHost(thumb);

  // Check cache first
  const videoURL = getYTVideoURL(thumb);
  const cached = videoURL ? ytThumbCache.get(videoURL) : null;

  if (cached) {
    injectYTBadgeFromCache(thumb, badgeHost, cached, videoURL);
  } else {
    // Inject "Detecting..." badge immediately on the host
    if (!badgeHost.querySelector('.scrollveil-yt-badge')) {
      const badge = createYTBadge(
        '<span style="display:inline-block;width:8px;height:8px;background:#888;border-radius:50%;flex-shrink:0;animation:scrollveil-pulse 1.5s ease-in-out infinite;"></span><span>Detecting\u2026</span>',
        false
      );
      badgeHost.appendChild(badge);
    }
    runYTAnalysis(thumb, badgeHost, videoURL);
  }

  // No per-thumbnail MutationObserver needed — badge lives on badgeHost
  // (above yt-thumbnail-view-model), so YouTube's child swaps don't affect it.
  // Periodic rescan handles any edge cases.
}

// Helper: inject a scored badge from cache
function injectYTBadgeFromCache(thumb, badgeHost, cached, videoURL) {
  // Remove any existing badge first
  const old = badgeHost.querySelector('.scrollveil-yt-badge');
  if (old) old.remove();

  const threshold = window._scrollveilAutoUnblurThreshold ?? 0;
  const score = cached.score;
  const result = cached.result;

  if (score < threshold) {
    // Safe — auto-reveal, but still allow re-blur toggle
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
        showUnblurPopup(result, function() {
          setRevealedState();
        });
      }
    }, true);
    badgeHost.appendChild(badge);
  } else {
    // Not safe — keep blurred, click to reveal
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
        // Currently revealed — re-blur immediately
        setBlurredState();
      } else {
        // Currently blurred — show popup, reveal on confirm
        showUnblurPopup(result, function() {
          setRevealedState();
        });
      }
    }, true);
    badgeHost.appendChild(badge);
  }
}

// Helper: find a usable img inside a thumbnail and run analysis
async function runYTAnalysis(thumb, badgeHost, videoURL) {
  // Find the first img inside the thumbnail
  let img = thumb.querySelector('img');

  // Wait for an img to appear if there isn't one yet
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
    // No image found yet — don't cache, let rescan retry
    ytObservedThumbs.delete(thumb);
    return;
  }

  // Mark img as processed so standard pipeline skips it
  processedImages.add(img);
  img.dataset.scrollveilProcessed = 'true';

  // Wait for the image to load
  if (!img.complete || !img.naturalWidth) {
    await new Promise(resolve => {
      const onLoad = () => { img.removeEventListener('load', onLoad); resolve(); };
      img.addEventListener('load', onLoad);
      setTimeout(resolve, 4000);
    });
  }

  // If still no pixel data, try to find another img (YouTube may have swapped)
  if (!img.naturalWidth || img.naturalWidth < 50) {
    const retryImg = thumb.querySelector('img');
    if (retryImg && retryImg !== img && retryImg.naturalWidth >= 50) {
      img = retryImg;
    }
  }

  if (!img.naturalWidth || img.naturalWidth < 50) {
    // Image not loaded yet — DON'T cache, DON'T finalize badge.
    // Remove from processed set so periodic rescan retries when image is loaded.
    ytObservedThumbs.delete(thumb);
    return;
  }

  // Run detection
  try {
    const result = await detector.analyzeImage(img);

    // ── Language scoring: scan video title/description from DOM ──
    try {
      const langResult = await scoreElementText(thumb);
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

// Helper: update the badge after analysis completes
function updateYTBadgeAfterAnalysis(thumb, badgeHost, score, result, videoURL) {
  const old = badgeHost.querySelector('.scrollveil-yt-badge');
  if (old) old.remove();
  const cached = { score, result };
  injectYTBadgeFromCache(thumb, badgeHost, cached, videoURL);
}
// ── YouTube Watch Page Player Badge ──────────────────────────────────
// Detects /watch pages, analyzes the video thumbnail, and places a badge
// on the main player. This is the foundation for future frame sampling.
let watchPageProcessed = false;

function setupWatchPageBadge() {
  if (!isOnYouTube) return;
  if (!window.location.pathname.startsWith('/watch')) return;

  const player = document.querySelector('#movie_player');
  if (!player) return;

  // Don't double-process
  if (player.querySelector('.scrollveil-yt-badge')) return;
  if (watchPageProcessed) return;
  watchPageProcessed = true;

  // Extract video ID from URL
  const params = new URLSearchParams(window.location.search);
  const videoId = params.get('v');
  if (!videoId) return;

  // Ensure player is positioned for badge placement
  if (window.getComputedStyle(player).position === 'static') {
    player.style.position = 'relative';
  }

  // Check cache first
  const thumbURL = 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg';
  const cached = ytThumbCache.get(thumbURL);
  if (cached) {
    placeWatchBadge(player, cached.score, cached.result);
    return;
  }

  // Show "Detecting..." badge while analyzing
  const detectBadge = createYTBadge('<span style="animation:scrollveil-pulse 1.5s infinite">Detecting...</span>', false);
  player.appendChild(detectBadge);

  // Load and analyze the thumbnail
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = thumbURL;
  img.onload = async function() {
    if (!detector) { watchPageProcessed = false; return; }
    try {
      const result = await detector.analyzeImage(img);
      const score = result.score;
      ytThumbCache.set(thumbURL, { score, result });
      // Remove detecting badge and place real one
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

  // Start blurred or revealed based on threshold (same as thumbnails)
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
      showUnblurPopup(result, function() {
        setRevealedState();
      });
    } else {
      setBlurredState();
    }
  }, true);

  player.appendChild(badge);
}

// Reset watch page state on navigation (YouTube is SPA)
let lastWatchURL = '';
setInterval(() => {
  const currentURL = window.location.href;
  if (currentURL !== lastWatchURL) {
    lastWatchURL = currentURL;
    watchPageProcessed = false;

    // YouTube SPA navigation: reset video processing state so the new video gets analyzed.
    // YouTube reuses the same <video> element and player container across navigations.
    if (isOnYouTube && (window.location.pathname.startsWith('/watch') || window.location.pathname.startsWith('/shorts/'))) {
      const mp = document.querySelector('#movie_player') || document.querySelector('#shorts-player');
      if (mp) {
        mp._scrollveilProcessed = false;
        mp.style.removeProperty('filter');
        mp.removeAttribute('data-scrollveil-analyzed');
      }
      const vid = mp ? mp.querySelector('video') : document.querySelector('video');
      if (vid) {
        processedVideos.delete(vid);
        vid.removeAttribute('data-scrollveil-analyzed');
        vid.dataset.scrollveilProcessed = '';
        vid._scrollveilBlurred = false;
        cleanupVideoOverlays(vid);
        // Cancel any active frame sampling from the previous video
        cancelVideoFrameSampling(vid);
      }
      // Clear session cache so the new video gets fresh analysis
      videoSessionCache.clear();
      console.log('ScrollVeil: YouTube SPA navigation detected — reset video state for new analysis');
    }
  }
}, 1000);

// ═══════════════════════════════════════════════════════════════

// Global registry of all live overlays → target element.
// Used by the orphan sweep to destroy overlays whose target was replaced by YouTube/React.
const overlayRegistry = new Map();
const processedVideos = new WeakSet();
const processedImages = new WeakSet();
// (Old YT tracking removed — replaced by stable-ancestor system in v2: ytDoneAnchors, ytProcessingAnchors, etc.)

// ═══════════════════════════════════════════════════════════════
// VIDEO FRAME SAMPLING — session cache + active analysis tracking
// Analyzes visible videos frame-by-frame with live badge updates.
// Cache is in-memory only (cleared on refresh/tab close).
// ═══════════════════════════════════════════════════════════════
const videoSessionCache = new Map();  // videoSrc → { visualScore, peakScore, frameScores[], framesAnalyzed, totalFrames, complete }
const activeVideoAnalyses = new Map(); // video element → { intervalId, observer, cancelled }

// Video sampling settings — loaded from chrome.storage.sync, with safe defaults
let VIDEO_SAMPLING_DEFAULTS = {
  intervalSeconds: 3,       // One frame every 3 seconds
  durationSeconds: 30,      // Analyze for 30 seconds total
  earlyExitThreshold: 75    // Stop if score exceeds this %
};

// Load user's video analysis settings from storage
chrome.storage.sync.get(['videoInterval', 'videoDuration', 'earlyExitThreshold'], function (vs) {
  if (vs.videoInterval !== undefined)      VIDEO_SAMPLING_DEFAULTS.intervalSeconds    = vs.videoInterval;
  if (vs.videoDuration !== undefined)      VIDEO_SAMPLING_DEFAULTS.durationSeconds    = vs.videoDuration;
  if (vs.earlyExitThreshold !== undefined) VIDEO_SAMPLING_DEFAULTS.earlyExitThreshold = vs.earlyExitThreshold;
  console.log('ScrollVeil: Video sampling settings loaded — interval: ' + VIDEO_SAMPLING_DEFAULTS.intervalSeconds + 's, duration: ' + VIDEO_SAMPLING_DEFAULTS.durationSeconds + 's, early exit: ' + VIDEO_SAMPLING_DEFAULTS.earlyExitThreshold + '%');
});

// ═══════════════════════════════════════════════════════════════
// GLOBAL SCHEDULER — replaces dozens of per-element setIntervals
// with two unified loops for massive CPU savings.
// ═══════════════════════════════════════════════════════════════

// Visual position trackers (overlays, re-blur buttons) — runs via requestAnimationFrame
// Only fires when tab is visible, syncs with browser render cycle
const visualTrackers = new Set();

// Enforcement/maintenance tasks (blur re-apply, attribute checks, global rescan)
// Runs via a single setInterval at 500ms
const enforcementTrackers = new Set();

// Start the visual tracking loop (requestAnimationFrame)
function runVisualTrackers() {
  visualTrackers.forEach(fn => {
    try { fn(); } catch (e) { /* prevent one bad tracker from breaking others */ }
  });
  requestAnimationFrame(runVisualTrackers);
}
requestAnimationFrame(runVisualTrackers);

// Start the enforcement loop (single 500ms interval)
setInterval(() => {
  enforcementTrackers.forEach(fn => {
    try { fn(); } catch (e) { /* prevent one bad tracker from breaking others */ }
  });

  // Orphan sweep — kill any overlay whose target element is no longer in the DOM.
  // This handles YouTube/React replacing container elements entirely (new object = lost JS props).
  overlayRegistry.forEach((target, overlay) => {
    if (!document.contains(target)) {
      if (overlay._scrollveilCleanup) overlay._scrollveilCleanup();
      else { overlayRegistry.delete(overlay); overlay.remove(); }
    }
  });
}, 500);

// Helper: Register a visual position tracker. Returns an unregister function.
function registerVisualTracker(fn) {
  visualTrackers.add(fn);
  return () => visualTrackers.delete(fn);
}

// Helper: Register an enforcement tracker. Returns an unregister function.
function registerEnforcementTracker(fn) {
  enforcementTrackers.add(fn);
  return () => enforcementTrackers.delete(fn);
}

// ═══════════════════════════════════════════════════════════════

// Helper: Detect X/Twitter or YouTube video container
function getVideoContainer(video) {
  // Try multiple selectors X has used for their video player
  const xContainer = video.closest('[data-testid="videoPlayer"]')
    || video.closest('[data-testid="videoComponent"]');

  if (xContainer) return { container: xContainer, isXPlayer: true, isYTPlayer: false };

  // If we're on X but couldn't find a known container, still flag as X
  // so we use floating overlays (React will strip any wrapper we inject)
  if (isOnXDomain) {
    // Walk up to find the nearest positioned ancestor as a tracking target
    let ancestor = video.parentElement;
    while (ancestor && ancestor !== document.body) {
      const pos = window.getComputedStyle(ancestor).position;
      if (pos === 'relative' || pos === 'absolute' || pos === 'fixed') {
        return { container: ancestor, isXPlayer: true, isYTPlayer: false };
      }
      ancestor = ancestor.parentElement;
    }
    // Last resort: use the video's direct parent
    return { container: video.parentElement || video, isXPlayer: true, isYTPlayer: false };
  }

  // YouTube: find the player container so overlays live inside the same stacking context
  if (isOnYouTube) {
    // Try YouTube's known player container selectors
    const ytContainer = video.closest('#movie_player')
      || video.closest('.html5-video-player')
      || video.closest('ytd-player')
      || video.closest('#player-container-inner')
      || video.closest('#shorts-player');

    if (ytContainer) return { container: ytContainer, isXPlayer: false, isYTPlayer: true };

    // Fallback: walk up to a positioned ancestor
    let ancestor = video.parentElement;
    while (ancestor && ancestor !== document.body) {
      const pos = window.getComputedStyle(ancestor).position;
      if (pos === 'relative' || pos === 'absolute' || pos === 'fixed') {
        return { container: ancestor, isXPlayer: false, isYTPlayer: true };
      }
      ancestor = ancestor.parentElement;
    }
    return { container: video.parentElement || video, isXPlayer: false, isYTPlayer: true };
  }

  return { container: null, isXPlayer: false, isYTPlayer: false };
}

// Initialize detector
let detector = null;
let blurStrength = 100; // Default blur strength in pixels

// Function to wait for ScrollVeilDetector to be available
function waitForDetector(callback) {
  if (typeof ScrollVeilDetector !== 'undefined') {
    callback();
  } else {
    console.log('ScrollVeil: Waiting for detector class to load...');
    setTimeout(() => waitForDetector(callback), 50);
  }
}

// Load settings and initialize
chrome.storage.sync.get(['blurStrength', 'autoUnblurThreshold', 'autoUnblur'], function (result) {
  if (result.blurStrength) {
    blurStrength = result.blurStrength;
  }
  // Update the CSS variable so all CSS blur rules match the user's setting
  // BUT only if protection is enabled — when disabled, we need it to stay at 0px
    if (scrollveilEnabled) {
      document.documentElement.style.setProperty('--scrollveil-blur', blurStrength + 'px');
    }

  // IMMEDIATE safe default — guarantees threshold exists even before migration
  window._scrollveilAutoUnblurThreshold = result.autoUnblurThreshold ?? 0;

  // One-time migration from old boolean (only runs if needed)
  if (result.autoUnblur !== undefined && result.autoUnblurThreshold === undefined) {
    const migratedThreshold = result.autoUnblur ? 20 : 0;
    window._scrollveilAutoUnblurThreshold = migratedThreshold;

    // Permanently save the migrated value so this never runs again
    chrome.storage.sync.set({ autoUnblurThreshold: migratedThreshold }, () => {
      console.log('ScrollVeil: Migrated old auto-unblur setting to threshold ' + migratedThreshold + '%');
    });
  }

  waitForDetector(() => {
    detector = new ScrollVeilDetector();
    console.log('ScrollVeil: Blur strength set to ' + blurStrength + 'px');
    console.log('ScrollVeil: Auto-unblur threshold: ' + window._scrollveilAutoUnblurThreshold + '%');
    console.log('ScrollVeil: AI detector initialized');

    scanImages();
    scanVideos();

    // On YouTube: directly set up all visible thumbnail containers
    if (isOnYouTube) {
      document.querySelectorAll('yt-thumbnail-view-model').forEach(t => setupYTThumbnail(t));
      // setupWatchPageBadge() — DISABLED: frame sampling system now handles watch pages
      // The old system analyzed the thumbnail image only. Frame sampling analyzes live video.
    }
  });
});


// Listen for settings changes
chrome.storage.onChanged.addListener(function (changes, namespace) {
  if (namespace === 'sync') {
    // Update blur strength if changed
    if (changes.blurStrength) {
      const oldBlur = blurStrength;
      blurStrength = changes.blurStrength.newValue;
      console.log('ScrollVeil: Blur strength updated from ' + oldBlur + 'px to ' + blurStrength + 'px');
      updateExistingBlurs();
    }

    // Update auto-unblur threshold if changed (independent of blur strength)
    if (changes.autoUnblurThreshold) {
      window._scrollveilAutoUnblurThreshold =
        changes.autoUnblurThreshold.newValue ?? 0;
      console.log('ScrollVeil: Auto-unblur threshold updated to ' +
        window._scrollveilAutoUnblurThreshold + '%');
    }

    // Update video sampling settings live (no page reload needed)
    if (changes.videoInterval) {
      VIDEO_SAMPLING_DEFAULTS.intervalSeconds = changes.videoInterval.newValue;
      console.log('ScrollVeil: Video interval updated to ' + VIDEO_SAMPLING_DEFAULTS.intervalSeconds + 's');
    }
    if (changes.videoDuration) {
      VIDEO_SAMPLING_DEFAULTS.durationSeconds = changes.videoDuration.newValue;
      console.log('ScrollVeil: Video duration updated to ' + VIDEO_SAMPLING_DEFAULTS.durationSeconds + 's');
    }
    if (changes.earlyExitThreshold) {
      VIDEO_SAMPLING_DEFAULTS.earlyExitThreshold = changes.earlyExitThreshold.newValue;
      console.log('ScrollVeil: Video early exit updated to ' + VIDEO_SAMPLING_DEFAULTS.earlyExitThreshold + '%');
    }
  }
});

// Function to update blur on already-blurred content
function updateExistingBlurs() {
  // Update all blurred images
  const blurredImages = document.querySelectorAll('img[data-scrollveil-blurred="true"]');
  blurredImages.forEach(img => {
    img.style.filter = `blur(${blurStrength}px)`;
    img.style.webkitFilter = `blur(${blurStrength}px)`;
  });

  // Update all blurred videos
  const blurredVideos = document.querySelectorAll('video[data-scrollveil-blurred="true"]');
  blurredVideos.forEach(video => {
    video.style.filter = `blur(${blurStrength}px)`;
    video.style.webkitFilter = `blur(${blurStrength}px)`;
  });

  console.log('ScrollVeil: Updated ' + (blurredImages.length + blurredVideos.length) + ' blurred items');
}

// Helper: Mark an image as safe (clears CSS blur shield)
function markImageSafe(img) {
  removeDetectingBadge(img);
  img.setAttribute('data-scrollveil-analyzed', 'safe');

  // Force-clear any inline blur that might have been applied
  img.style.setProperty('filter', 'none', 'important');
  img.style.setProperty('-webkit-filter', 'none', 'important');

  // On X, also clear the container blur if it was applied
  if (isOnXDomain) {
    const xImageContainer = img.closest('[data-testid="tweetPhoto"]');
    if (xImageContainer) {
      xImageContainer.style.setProperty('filter', 'none', 'important');
      xImageContainer.style.setProperty('-webkit-filter', 'none', 'important');
      xImageContainer.setAttribute('data-scrollveil-analyzed', 'safe');
      xImageContainer._scrollveilBlurred = false;
    }
  }
}

// Helper: Get the stable YouTube thumbnail container for a given img (or null)
function getYTContainer(img) {
  if (!isOnYouTube) return null;
  return img ? img.closest('yt-thumbnail-view-model') : null;
}


// Helper: Generate universal badge HTML.
// mode: 'reveal' = "score% | Reveal", 'reblur' = "score% | Reblur", 'none' = just "score%" (no button)
// Options: { pulse: true } adds pulse animation to the dot (used during video analysis)
function getScoreBadgeHTML(score, mode, options) {
  var color = getScoreColor(score);
  var pulseCSS = (options && options.pulse) ? ' animation: scrollveil-pulse 1.5s ease-in-out infinite;' : '';

  var html = '<div style="' +
    'display:inline-flex; align-items:center; gap:4px; ' +
    'background:rgba(0,0,0,0.6); border-radius:12px; padding:3px 8px; ' +
    'font-family:Arial,sans-serif; font-size:11px; color:#fff; ' +
    'pointer-events:auto; line-height:1; white-space:nowrap;' +
    '">' +
    '<span style="display:inline-block; width:8px; height:8px; ' +
    'background:' + color + '; border-radius:50%; flex-shrink:0;' + pulseCSS + '"></span>' +
    '<span style="color:' + color + '; font-weight:bold;">' + score + '%</span>';

  if (mode === 'reveal') {
    html += '<span style="color:rgba(255,255,255,0.4); margin:0 1px;">|</span>' +
      '<span class="scrollveil-action-btn" style="cursor:pointer; color:#aaa; font-size:10px;">Reveal</span>';
  } else if (mode === 'reblur') {
    html += '<span style="color:rgba(255,255,255,0.4); margin:0 1px;">|</span>' +
      '<span class="scrollveil-action-btn" style="cursor:pointer; color:#aaa; font-size:10px;">Reblur</span>';
  }

  html += '</div>';
  return html;
}

// Translate technical detection reasons into user-friendly language
function getHumanReadableReasons(result) {
  var reasons = (result.reason || '').split(', ');
  var humanReasons = [];

  // Technical term → User-friendly description mapping
  var translations = {
    // HIGH SCORE (why it's flagged)
    'High skin exposure': 'Significant skin exposure detected',
    'High skin ratio': 'High amount of visible skin',
    'Exposed legs/thighs': 'Lower body exposure',
    'Revealing clothing': 'Revealing clothing detected',
    'Moderate skin': 'Moderate skin visible',
    'Some skin visible': 'Small amount of skin visible',
    'Explicit anatomical features': 'Explicit content indicators',
    'Possible anatomical features': 'Possible explicit indicators',
    'Paired dark circles in skin': 'Explicit content indicators',
    'Lower body concentration': 'Skin concentrated in lower body',
    'High regional concentration': 'High skin concentration in one area',
    'Large smooth skin region': 'Large area of exposed skin',
    'Smooth skin concentration': 'Concentrated area of smooth skin',
    'Body-sized skin region': 'Body-sized area of exposed skin',
    'Exposed midriff/torso': 'Exposed torso area',
    'High torso emphasis': 'Torso prominently displayed',
    'Anatomical features without body shape': 'Explicit indicators detected',
    // INTIMATE / CONTEXT (from scene detection)
    'Isolated subject (no context objects)': 'No surrounding context detected',
    // LOW SCORE (why it's probably safe)
    'Minimal skin': 'Very little skin visible',
    'Face/neck skin visible': 'Face and neck skin visible',
    'Face closeup': 'Face/portrait only',
    'Portrait / face close-up': 'Close-up portrait detected',
    'Clothed person (face visible)': 'Person wearing clothes — face visible',
    'Mostly clothed person': 'Person mostly clothed',
    'No human body shape detected': 'No human figure detected',
    'Landscape/nature scene': 'Landscape or scenery',
    'Structure/architecture detected': 'Building or structure',
    'Uniform texture (no body shape)': 'Uniform surface (sand, wall, etc.)',
    'Scattered skin (likely safe)': 'Multiple small figures (group photo)',
    'No people detected': 'No people found in image',
    'Safe content': 'No concerning content detected',
    // BODY-PART ZONE REASONS
    'Partial chest exposure': 'Some chest skin visible',
    'Partial midriff exposure': 'Some midriff skin visible',
    'Partial hip exposure': 'Some hip area skin visible',
    'Partial thigh exposure': 'Some thigh skin visible',
    'Two zones exposed': 'Skin visible in multiple body areas',
    'Body zone exposure floor': 'Multiple body areas with skin',
    'High body exposure floor': 'Significant body exposure detected'
  };

  for (var i = 0; i < reasons.length; i++) {
    var reason = reasons[i].trim();
    if (!reason) continue;

    // Check for exact translation
    if (translations[reason]) {
      humanReasons.push(translations[reason]);
    }
    // Check for scene context descriptions (passed through from evaluateSceneContext)
    else if (reason.startsWith('Intimate setting') || reason.startsWith('Indoor') ||
             reason.startsWith('Outdoor') || reason.startsWith('Animal') ||
             reason.startsWith('Food') || reason.startsWith('Professional') ||
             reason.startsWith('Travel') || reason.startsWith('Objects detected') ||
             reason.startsWith('Indoor/domestic')) {
      humanReasons.push(reason); // Scene descriptions are already user-friendly
    }
    // Check for "No people detected (found: X, Y)" pattern
    else if (reason.startsWith('No people detected')) {
      var foundMatch = reason.match(/\(found: (.+)\)/);
      if (foundMatch) {
        humanReasons.push('Objects in scene: ' + foundMatch[1]);
      } else {
        humanReasons.push('No people found in image');
      }
    }
    // Check for body zone reasons with percentages (e.g., "Exposed chest (65%)")
    else if (reason.startsWith('Exposed chest') || reason.startsWith('Exposed midriff') ||
             reason.startsWith('Exposed hips') || reason.startsWith('Exposed thighs') ||
             reason.startsWith('Extensive body exposure') || reason.startsWith('Multiple zones exposed') ||
             reason.startsWith('Very high exposure') || reason.startsWith('High exposure in')) {
      humanReasons.push(reason); // Already human-readable
    }
    // Fallback: pass through as-is
    else {
      humanReasons.push(reason);
    }
  }

  // Add person count if available
  if (result.personCount && result.personCount > 0) {
    var personLabel = result.personCount === 1 ? '1 person detected' : result.personCount + ' people detected';
    humanReasons.unshift(personLabel); // Add at the beginning
  }

  // Deduplicate: remove duplicate translated reasons (e.g., multiple reasons mapping to same text)
  var seen = {};
  var uniqueReasons = [];
  for (var d = 0; d < humanReasons.length; d++) {
    if (!seen[humanReasons[d]]) {
      seen[humanReasons[d]] = true;
      uniqueReasons.push(humanReasons[d]);
    }
  }

  return uniqueReasons;
}

// Get the score color for the custom popup (matches badge colors)
function getScoreColor(score) {
  if (score < 20) return '#4CAF50';       // green
  if (score < 40) return '#FFC107';       // yellow
  if (score < 60) return '#FF9800';       // orange
  if (score < 80) return '#F44336';       // red
  return '#212121';                        // black/dark
}

// Generate a natural one-line scene summary from combined detection data
function getSceneSummary(result) {
  var score = result.score || 0;
  var personCount = result.personCount || 0;
  var reason = result.reason || '';
  var sceneObjects = result.sceneObjects || [];
  var reasons = reason.split(', ');

  // Determine skin level from reasons
  var skinLevel = 'unknown';
  if (reasons.indexOf('High skin exposure') >= 0 || reasons.indexOf('High skin ratio') >= 0) skinLevel = 'high';
  else if (reasons.indexOf('Moderate skin') >= 0) skinLevel = 'moderate';
  else if (reasons.indexOf('Revealing clothing') >= 0 || reasons.indexOf('Exposed legs/thighs') >= 0) skinLevel = 'moderate';
  else if (reasons.indexOf('Some skin visible') >= 0) skinLevel = 'some';
  else if (reasons.indexOf('Minimal skin') >= 0) skinLevel = 'minimal';

  // Determine style
  var isPortrait = reasons.indexOf('Face closeup') >= 0 || reasons.indexOf('Portrait / face close-up') >= 0;
  var isLandscape = reasons.indexOf('Landscape/nature scene') >= 0;
  var isStructure = reasons.indexOf('Structure/architecture detected') >= 0;
  var hasAnatomical = reasons.indexOf('Explicit anatomical features') >= 0 || reasons.indexOf('Possible anatomical features') >= 0;
  var isIsolated = reasons.indexOf('Isolated subject (no context objects)') >= 0;

  // Determine scene context
  var sceneDesc = '';
  for (var i = 0; i < reasons.length; i++) {
    var r = reasons[i].trim();
    if (r.startsWith('Intimate setting') || r.startsWith('Indoor/domestic') ||
        r.startsWith('Outdoor/recreation') || r.startsWith('Animal/pet') ||
        r.startsWith('Food/dining') || r.startsWith('Professional/work') ||
        r.startsWith('Travel/vehicle') || r.startsWith('Objects detected')) {
      sceneDesc = r;
      break;
    }
  }

  // === BUILD SUMMARY ===

  // NO PEOPLE cases
  if (personCount === 0 && score < 20) {
    if (reason.startsWith('No people detected (found:')) {
      var found = reason.match(/found: (.+)\)/);
      return 'No people found — ' + (found ? found[1] + ' detected' : 'scene appears safe');
    }
    if (isLandscape) return 'Landscape or natural scenery — no people detected';
    if (isStructure) return 'Building or structure — no people detected';
    if (reason === 'No people detected') return 'No people detected in image';
    return 'No concerning content detected';
  }

  // PORTRAIT / FACE
  if (isPortrait && personCount <= 1) {
    if (sceneDesc) return 'Close-up portrait — ' + sceneDesc.toLowerCase();
    return 'Close-up portrait — face only';
  }

  // EXPLICIT
  if (hasAnatomical) {
    var explicitPeople = personCount === 1 ? '1 person' : personCount + ' people';
    return explicitPeople + ' — explicit content indicators detected';
  }

  // PEOPLE WITH SKIN EXPOSURE (main cases)
  if (personCount > 0) {
    var peopleStr = personCount === 1 ? '1 person' : personCount + ' people';

    var skinStr = '';
    if (skinLevel === 'high') skinStr = 'significant skin exposure';
    else if (skinLevel === 'moderate') skinStr = 'moderate skin visible';
    else if (skinLevel === 'some') skinStr = 'some skin visible';
    else if (skinLevel === 'minimal') skinStr = 'minimal skin visible';
    else skinStr = '';

    var extras = [];
    if (isIsolated) extras.push('no surrounding context');

    // Add body zone info if available (from BlazePose zone measurement)
    var bodyZoneExposed = [];
    for (var bzi = 0; bzi < reasons.length; bzi++) {
      var bzr = reasons[bzi].trim();
      if (bzr.startsWith('Exposed chest')) bodyZoneExposed.push('chest');
      else if (bzr.startsWith('Exposed midriff')) bodyZoneExposed.push('midriff');
      else if (bzr.startsWith('Exposed hips')) bodyZoneExposed.push('hips');
      else if (bzr.startsWith('Exposed thighs')) bodyZoneExposed.push('thighs');
    }
    if (bodyZoneExposed.length > 0) {
      skinStr = bodyZoneExposed.join(', ') + ' exposed';
    }

    // Add clothing detection info if available
    if (result.clothingType) {
      var clothingConf = result.clothingConfidence ? ' (' + Math.round(result.clothingConfidence * 100) + '%)' : '';
      extras.push(result.clothingType + clothingConf + ' detected');
    }

    var parts = [peopleStr];
    if (skinStr) parts.push(skinStr);
    if (sceneDesc) parts.push(sceneDesc.toLowerCase());
    if (extras.length > 0) parts.push(extras.join(', '));

    return parts.join(' — ');
  }

  // FALLBACK
  if (score < 20) return 'Content appears safe';
  if (score < 50) return 'Some potentially sensitive content detected';
  return 'Potentially sensitive content detected';
}

// Custom unblur confirmation popup (replaces browser confirm() dialog)
function showUnblurPopup(result, onReveal, onCancel) {
  var score = (typeof result.displayScore === 'number') ? result.displayScore : (result.score || 0);
  var visualScore = result.score || 0;
  var color = getScoreColor(score);
  var reasons = getHumanReadableReasons(result);

  // Build reasons list HTML
  var reasonsHTML = '';
  for (var i = 0; i < reasons.length; i++) {
    reasonsHTML += '<div style="padding:4px 0; color:#ddd; font-size:13px;">• ' + reasons[i] + '</div>';
  }

  // Create backdrop
  var backdrop = document.createElement('div');
  backdrop.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; ' +
    'background:rgba(0,0,0,0.6); z-index:2147483647; display:flex; align-items:center; ' +
    'justify-content:center; font-family:Arial,Helvetica,sans-serif;';

  // Create popup
  var popup = document.createElement('div');
  popup.style.cssText = 'background:#1a1a2e; border-radius:12px; padding:0; width:320px; ' +
    'max-width:90vw; box-shadow:0 8px 32px rgba(0,0,0,0.5); overflow:hidden;';

  // Header
  var header = '<div style="display:flex; justify-content:space-between; align-items:center; ' +
    'padding:14px 18px; border-bottom:1px solid rgba(255,255,255,0.08);">' +
    '<span style="color:#fff; font-size:14px; font-weight:600;">ScrollVeil</span>' +
    '<span class="scrollveil-popup-close" style="color:#888; cursor:pointer; font-size:18px; ' +
    'line-height:1; padding:2px 6px;">✕</span></div>';

  // Score display
  var summary = getSceneSummary(result);
  var scoreDisplay = '<div style="text-align:center; padding:20px 18px 8px;">' +
    '<div style="display:inline-flex; align-items:center; gap:10px;">' +
    '<span style="display:inline-block; width:16px; height:16px; background:' + color + '; ' +
    'border-radius:50%;"></span>' +
    '<span style="color:' + color + '; font-size:32px; font-weight:700;">' + score + '%</span>' +
    '</div>' +
    '<div style="color:#aaa; font-size:13px; margin-top:8px; line-height:1.4;">' + summary + '</div>' +
    '</div>';

  // Reasons section (visual)
  var reasonsSection = '<div style="padding:4px 18px 12px;">' +
    '<div style="color:#999; font-size:11px; text-transform:uppercase; letter-spacing:0.5px; ' +
    'margin-bottom:6px;">Visual Score: ' + visualScore + '%</div>' +
    reasonsHTML + '</div>';

  // Clothing detection section
  var clothingSection = '';
  if (result.clothingType) {
    var clothingConf = result.clothingConfidence ? Math.round(result.clothingConfidence * 100) + '%' : 'N/A';
    var clothingName = result.clothingType.charAt(0).toUpperCase() + result.clothingType.slice(1);
    var clothingColor = '#4fc3f7'; // light blue for clothing info
    clothingSection = '<div style="padding:4px 18px 12px; border-top:1px solid rgba(255,255,255,0.06);">' +
      '<div style="color:#999; font-size:11px; text-transform:uppercase; letter-spacing:0.5px; ' +
      'margin-bottom:6px;">Clothing Detection</div>' +
      '<div style="padding:3px 0; color:' + clothingColor + '; font-size:13px;">👕 ' + clothingName + ' (' + clothingConf + ' confidence)</div>' +
      '</div>';
  }

  // Language score section
  var languageSection = '';
  if (typeof result.languageScore === 'number') {
    var langScore = result.languageScore;
    var langColor = getLanguageScoreColor(langScore);
    var langNA = result.languageIsNA;
    
    languageSection = '<div style="padding:4px 18px 16px; border-top:1px solid rgba(255,255,255,0.06);">' +
      '<div style="color:#999; font-size:11px; text-transform:uppercase; letter-spacing:0.5px; ' +
      'margin-bottom:6px;">Language Score: ' + (langNA ? 'N/A 0%' : langScore + '%') + '</div>';
    
    if (!langNA && result.languageTagSummary && Object.keys(result.languageTagSummary).length > 0) {
      var tagNames = { sexual: 'Sexual language', lgbtq: 'LGBTQ-related language', racial: 'Racial language', general: 'General profanity', shock: 'Shock content', religious: 'Religious language' };
      for (var tag in result.languageTagSummary) {
        var count = result.languageTagSummary[tag];
        var displayName = tagNames[tag] || tag;
        languageSection += '<div style="padding:3px 0; color:#ddd; font-size:13px;">• ' + displayName + ' (' + count + (count === 1 ? ' match' : ' matches') + ')</div>';
      }
    } else if (langNA) {
      languageSection += '<div style="padding:3px 0; color:#888; font-size:12px;">No text or captions available</div>';
    } else {
      languageSection += '<div style="padding:3px 0; color:#888; font-size:12px;">No concerning language detected</div>';
    }
    
    // Text sources
    if (result.languageSources) {
      languageSection += '<div style="padding:6px 0 0; color:#666; font-size:11px;">';
      var src = result.languageSources;
      languageSection += 'Sources: ' +
        (src.title ? 'Title ✓' : '') +
        (src.postText ? ' Post ✓' : '') +
        (src.captions ? ' Captions ✓' : '') +
        (!src.title && !src.postText && !src.captions ? 'None found' : '');
      if (result.languageWordCount) languageSection += ' (' + result.languageWordCount + ' words)';
      languageSection += '</div>';
    }
    languageSection += '</div>';
  }

  // Buttons — if no onReveal callback, show "Close" only (details-only mode)
  var buttons;
  var isPaused = result._state && result._state.paused;
  var hasAnalysisControl = (result.isAnalyzing || isPaused) && result._video;
  var analysisButtonLabel = isPaused ? 'Resume Analysis' : 'Pause Analysis';
  if (!onReveal) {
    buttons = '<div style="display:flex; gap:10px; padding:14px 18px; ' +
      'border-top:1px solid rgba(255,255,255,0.08);">';
    if (hasAnalysisControl) {
      buttons += '<button class="scrollveil-popup-stop" style="flex:1; padding:10px; border:1px solid rgba(255,255,255,0.15); ' +
        'background:transparent; color:#ccc; border-radius:8px; font-size:13px; cursor:pointer; ' +
        'font-family:inherit;">' + analysisButtonLabel + '</button>';
    }
    buttons += '<button class="scrollveil-popup-cancel" style="flex:1; padding:10px; border:none; ' +
      'background:' + color + '; color:#fff; border-radius:8px; font-size:14px; font-weight:600; ' +
      'cursor:pointer; font-family:inherit;">Close</button></div>';
  } else {
    buttons = '<div style="display:flex; gap:10px; padding:14px 18px; ' +
      'border-top:1px solid rgba(255,255,255,0.08);">' +
      '<button class="scrollveil-popup-cancel" style="flex:1; padding:10px; border:1px solid rgba(255,255,255,0.15); ' +
      'background:transparent; color:#ccc; border-radius:8px; font-size:14px; cursor:pointer; ' +
      'font-family:inherit;">Go Back</button>';
    if (hasAnalysisControl) {
      buttons += '<button class="scrollveil-popup-stop" style="flex:1; padding:10px; border:1px solid #FF9800; ' +
        'background:transparent; color:#FF9800; border-radius:8px; font-size:13px; cursor:pointer; ' +
        'font-family:inherit;">' + analysisButtonLabel + '</button>';
    }
    buttons += '<button class="scrollveil-popup-reveal" style="flex:1; padding:10px; border:none; ' +
      'background:' + color + '; color:#fff; border-radius:8px; font-size:14px; font-weight:600; ' +
      'cursor:pointer; font-family:inherit;">Reveal</button></div>';
  }

  // Report link — opens Google Form pre-filled with detection data
  var reportLink = '<div style="padding:0 18px 12px; text-align:center;">' +
    '<a class="scrollveil-popup-report" href="#" style="color:#FF9800; font-size:11px; ' +
    'text-decoration:none; opacity:0.7; cursor:pointer;">Report this result</a></div>';

  popup.innerHTML = header + scoreDisplay + reasonsSection + clothingSection + languageSection + buttons + reportLink;
  backdrop.appendChild(popup);
  document.body.appendChild(backdrop);

  // Event handlers
  var closePopup = function () {
    backdrop.remove();
    if (onCancel) onCancel();
  };

  backdrop.querySelector('.scrollveil-popup-close').addEventListener('click', closePopup);
  backdrop.querySelector('.scrollveil-popup-cancel').addEventListener('click', closePopup);
  var revealBtn = backdrop.querySelector('.scrollveil-popup-reveal');
  if (revealBtn) {
    revealBtn.addEventListener('click', function () {
      backdrop.remove();
      if (onReveal) onReveal();
    });
  }

  // Pause/Resume Analysis button — toggles frame sampling
  var stopBtn = backdrop.querySelector('.scrollveil-popup-stop');
  if (stopBtn && result._video) {
    stopBtn.addEventListener('click', function () {
      var video = result._video;
      var videoState = result._state;
      if (videoState && videoState.paused) {
        // RESUME: restart frame sampling from where we left off
        videoState.paused = false;
        console.log('ScrollVeil: User resumed analysis at frame ' + videoState.framesAnalyzed + '/' + videoState.totalFrames);
        startVideoFrameSampling(video);
      } else {
        // PAUSE: cancel interval but preserve state
        cancelVideoFrameSampling(video);
        if (videoState) {
          videoState.paused = true;
          console.log('ScrollVeil: User paused analysis at frame ' + videoState.framesAnalyzed + '/' + videoState.totalFrames + ' — visual score: ' + videoState.visualScore + '%');
          updateVideoFrameBadge(video, videoState, false);
        }
      }
      backdrop.remove();
    });
  }

  // Report link handler
  var reportBtn = backdrop.querySelector('.scrollveil-popup-report');
  if (reportBtn) {
    reportBtn.addEventListener('click', function (e) {
      e.preventDefault();
      var pageUrl = window.location.href;
      var details = 'Visual Score: ' + visualScore + '%';
      if (reasons.length > 0) details += '\nReasons: ' + reasons.join(', ');
      if (result.languageScore) details += '\nLanguage Score: ' + result.languageScore + '%';
      details += '\n\n--- Environment ---\nVersion: 1.0\nBrowser: ' + navigator.userAgent + '\nTimestamp: ' + new Date().toISOString();
      var formUrl = 'https://docs.google.com/forms/d/e/1FAIpQLScR4sdZTa4ohj7Q4af2altwK_LvvMme9kLhWgoSHwojS2sMnQ/viewform'
        + '?usp=pp_url'
        + '&entry.1045665563=' + encodeURIComponent(pageUrl)
        + '&entry.679210149=' + encodeURIComponent(details);
      window.open(formUrl, '_blank');
      backdrop.remove();
    });
  }

  // Click backdrop to close
  backdrop.addEventListener('click', function (e) {
    if (e.target === backdrop) closePopup();
  });

  // Escape key to close
  var escHandler = function (e) {
    if (e.key === 'Escape') {
      closePopup();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

// Helper: Destroy ALL overlays attached to an image in one shot.
// Call this before creating any new overlay to prevent doubles/blinking.
function cleanupAllOverlaysForImage(img) {
  // First sweep the global registry for ANY overlays tracking this element
  // (catches cases where JS property references were lost but overlays still exist)
  overlayRegistry.forEach((target, overlay) => {
    if (target === img) {
      if (overlay._scrollveilCleanup) overlay._scrollveilCleanup();
      else { overlayRegistry.delete(overlay); overlay.remove(); }
    }
  });
  if (img._scrollveilDetectingBadge) {
    if (img._scrollveilDetectingBadge._scrollveilCleanup) img._scrollveilDetectingBadge._scrollveilCleanup();
    else img._scrollveilDetectingBadge.remove();
    img._scrollveilDetectingBadge = null;
  }
  if (img._scrollveilFloatingOverlay) {
    if (img._scrollveilFloatingOverlay._scrollveilCleanup) img._scrollveilFloatingOverlay._scrollveilCleanup();
    else img._scrollveilFloatingOverlay.remove();
    img._scrollveilFloatingOverlay = null;
  }
  if (img._scrollveilSafeBadge) {
    if (img._scrollveilSafeBadge._scrollveilCleanup) img._scrollveilSafeBadge._scrollveilCleanup();
    else img._scrollveilSafeBadge.remove();
    img._scrollveilSafeBadge = null;
  }
  if (img._scrollveilFloatingReblur) {
    if (img._scrollveilFloatingReblur._scrollveilCleanup) img._scrollveilFloatingReblur._scrollveilCleanup();
    else img._scrollveilFloatingReblur.remove();
    img._scrollveilFloatingReblur = null;
  }
}

// Helper: Add "detecting..." badge to a blurred image while analysis runs
function addDetectingBadge(img) {
  // Always clean up any existing overlays first — prevents doubles when YouTube recycles <img> nodes
  cleanupAllOverlaysForImage(img);
  if (img._scrollveilDetectingBadge) return;

  var badgeHTML = '<div style="' +
    'display:inline-flex; align-items:center; gap:4px; ' +
    'background:rgba(0,0,0,0.6); border-radius:12px; padding:3px 8px; ' +
    'font-family:Arial,sans-serif; font-size:11px; color:#aaa; ' +
    'pointer-events:none; line-height:1; white-space:nowrap;' +
    '">' +
    '<span style="display:inline-block; width:8px; height:8px; ' +
    'background:#888; border-radius:50%; flex-shrink:0; ' +
    'animation:scrollveil-pulse 1.5s ease-in-out infinite;"></span>' +
    '<span>Detecting\u2026</span>' +
    '</div>';

  var overlay = createFloatingOverlay(img, badgeHTML, 'transparent');
  overlay.style.setProperty('pointer-events', 'none', 'important');
  overlay.style.setProperty('align-items', 'flex-start', 'important');
  overlay.style.setProperty('justify-content', 'center', 'important');
  overlay.dataset.scrollveilDetecting = 'true';
  img._scrollveilDetectingBadge = overlay;
}

// Helper: Remove the "detecting..." badge (called when score badge replaces it)
function removeDetectingBadge(img) {
  if (img._scrollveilDetectingBadge) {
    img._scrollveilDetectingBadge.remove();
    img._scrollveilDetectingBadge = null;
  }
}

// Helper: Add green safe badge + blur button to an auto-safe image
function addSafeBadge(img, result) {
  // Always clean up all existing overlays first — prevents doubles on recycled nodes
  cleanupAllOverlaysForImage(img);
  // Google Images: skip badge if already exists (prevents duplicates between thumbnail and preview)
  // The preview panel image gets its own badge; the thumbnail's floating overlay doesn't follow it

  // Badge HTML: "score% | Reblur" (content is already revealed/safe)
  var score = (result && typeof result.displayScore === 'number') ? result.displayScore : ((result && result.score) ? result.score : 0);
  var badgeHTML = getScoreBadgeHTML(score, 'reblur');

  // Use the same floating overlay system as blur overlays (works everywhere including X)
  var overlay = createFloatingOverlay(img, badgeHTML, 'transparent');
  // Make the overlay NOT cover the image — just the badge area at the top
  overlay.style.setProperty('pointer-events', 'none', 'important');
  overlay.style.setProperty('align-items', 'flex-start', 'important');
  overlay.style.setProperty('justify-content', 'center', 'important');

  // Make the Reblur button clickable
  var blurBtn = overlay.querySelector('.scrollveil-action-btn');
  if (blurBtn) {
    blurBtn.style.pointerEvents = 'auto';
    blurBtn.addEventListener('mouseenter', function () { blurBtn.style.color = '#fff'; });
    blurBtn.addEventListener('mouseleave', function () { blurBtn.style.color = '#aaa'; });
    blurBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      // Remove badge overlay and blur the image
      overlay.remove();
      img._scrollveilSafeBadge = null;
      img.setAttribute('data-scrollveil-analyzed', 'filtered');
      blurImage(img, { score: score, decision: 'FILTERED', action: 'blur', reason: result.reason || 'Manually blurred by user', sceneObjects: result.sceneObjects || [] });
    });
  }

  // Make dot+score and Blur button light up SEPARATELY on hover
  var scoreSpans = overlay.querySelectorAll('span');
  var scoreSpan = null;
  var dotSpan = null;
  for (var s = 0; s < scoreSpans.length; s++) {
    if (scoreSpans[s].style.fontWeight === 'bold') scoreSpan = scoreSpans[s];
    if (scoreSpans[s].style.borderRadius === '50%') dotSpan = scoreSpans[s];
  }

  // Give the dot and score their own hover by making them pointer-events:auto individually
  if (dotSpan) {
    dotSpan.style.pointerEvents = 'auto';
    dotSpan.style.cursor = 'pointer';
  }
  if (scoreSpan) {
    scoreSpan.style.pointerEvents = 'auto';
    scoreSpan.style.cursor = 'pointer';
    var originalScoreColor = scoreSpan.style.color;
  }

  // Hover: brighten dot+score in their own color
  var scoreHoverOn = function () {
    if (dotSpan) dotSpan.style.filter = 'brightness(1.5)';
    if (scoreSpan) scoreSpan.style.filter = 'brightness(1.5)';
  };
  var scoreHoverOff = function () {
    if (dotSpan) dotSpan.style.filter = '';
    if (scoreSpan) scoreSpan.style.filter = '';
  };
  if (dotSpan) {
    dotSpan.addEventListener('mouseenter', scoreHoverOn);
    dotSpan.addEventListener('mouseleave', scoreHoverOff);
  }
  if (scoreSpan) {
    scoreSpan.addEventListener('mouseenter', scoreHoverOn);
    scoreSpan.addEventListener('mouseleave', scoreHoverOff);
  }

  // Click: dot or score opens details popup
  var scoreClickHandler = function (e) {
    e.stopPropagation();
    e.preventDefault();
    showUnblurPopup(result, null, null);
  };
  if (dotSpan) dotSpan.addEventListener('click', scoreClickHandler);
  if (scoreSpan) scoreSpan.addEventListener('click', scoreClickHandler);

  img._scrollveilSafeBadge = overlay;
}

// Function to analyze and blur an image
async function processImage(img) {
    // Skip if extension is disabled
    if (!scrollveilEnabled) return;
    // Skip if already processed
  if (processedImages.has(img) || img.dataset.scrollveilProcessed) {
    return;
  }

  // ── Grok: skip ALL images — video pipeline handles everything ──────
  // Grok cards have both <img> and <video>. The image pipeline's reveal breaks
  // because React swaps <img> nodes (stale closure). The video pipeline's reveal
  // works because <video> elements are stable. Cross-origin thumbnail fallback
  // in sampleOneFrame gives real detection scores.
  if (window.location.hostname === 'grok.com') {
    processedImages.add(img);
    img.dataset.scrollveilProcessed = 'true';
    img.setAttribute('data-scrollveil-analyzed', 'safe');
    return;
  }

  // ── YouTube: skip ALL YouTube-served images ─────────────────────────
  // On YouTube, our dedicated thumbnail system handles all thumbnails.
  // Skip any image served from YouTube's own domains to prevent the
  // standard pipeline from creating duplicate floating overlays.
  if (isOnYouTube) {
    const src = img.src || '';
    if (src.includes('ytimg.com') || src.includes('ggpht.com') || img.closest('yt-thumbnail-view-model')) {
      processedImages.add(img);
      img.dataset.scrollveilProcessed = 'true';
      // Route to thumbnail system if inside a thumbnail container
      if (img.closest('yt-thumbnail-view-model')) {
        const thumb = img.closest('yt-thumbnail-view-model');
        setupYTThumbnail(thumb);
      }
      return;
    }
  }
  // ── End YouTube skip ───────────────────────────────────────────────

  // Skip images that share a DIRECT parent with a <video> element.
  // Mark the sibling video as processed so the video pipeline doesn't also badge it.
  if (img.parentElement && img.parentElement.querySelector('video')) {
    const siblingVideo = img.parentElement.querySelector('video');
    if (!processedVideos.has(siblingVideo)) {
      processedVideos.add(siblingVideo);
      siblingVideo.dataset.scrollveilProcessed = 'true';
    }
  }

  // Apply initial blur immediately
  if (!img.hasAttribute('data-scrollveil-analyzed')) {
    if (isOnXDomain) {
      const earlyContainer = img.closest('[data-testid="tweetPhoto"]');
      if (earlyContainer) {
        earlyContainer.style.setProperty('filter', `blur(${blurStrength}px)`, 'important');
        earlyContainer.style.setProperty('-webkit-filter', `blur(${blurStrength}px)`, 'important');
        earlyContainer._scrollveilBlurred = true;
      }
    } else {
      img.style.setProperty('filter', `blur(${blurStrength}px)`, 'important');
      img.style.setProperty('-webkit-filter', `blur(${blurStrength}px)`, 'important');
    }

    // Add "detecting..." badge so user knows ScrollVeil is actively working
    // First, sweep for any existing overlays tracking this same element (prevents doubles
    // when sites like Grok Imagine trigger re-processing of the same img)
    overlayRegistry.forEach((target, overlay) => {
      if (target === img) {
        if (overlay._scrollveilCleanup) overlay._scrollveilCleanup();
        else { overlayRegistry.delete(overlay); overlay.remove(); }
      }
    });
    addDetectingBadge(img);
  }

  // Skip hidden images (e.g. Google Images stacks a visibility:hidden placeholder behind the preview)
  if (window.getComputedStyle(img).visibility === 'hidden') {
    markImageSafe(img);
    processedImages.add(img);
    img.dataset.scrollveilProcessed = 'true';
    return;
  }

  // Skip images inside video containers
  if (img.closest('#movie_player, .html5-video-player, [data-testid="videoPlayer"]')) {
    markImageSafe(img);
    processedImages.add(img);
    img.dataset.scrollveilProcessed = 'true';
    return;
  }

  // Skip UI/decorative images
  const insideButton = img.closest('button, [role="button"], label, [role="tab"], [role="tablist"]');
  const isSmallButtonIcon = insideButton && (img.offsetWidth < 100 || img.offsetHeight < 100 || (!img.offsetWidth && !img.offsetHeight));

  const isUIImage = (
    img.closest('[role="search"], [role="navigation"], [role="banner"], [role="menubar"], [role="menu"], [role="toolbar"], [role="complementary"]') ||
    img.closest('nav, header:not(article header)') ||
    isSmallButtonIcon ||
    img.getAttribute('role') === 'presentation' ||
    (img.getAttribute('aria-hidden') === 'true' && (img.offsetWidth < 100 || img.offsetHeight < 100)) ||
    (img.src && img.src.endsWith('.svg')) ||
    img.closest('[class*="logo"], [class*="favicon"], [id*="logo"], [id*="favicon"]') ||
    img.closest('#hdtb, #footcnt, #searchform')
  );

  if (isUIImage) {
    markImageSafe(img);
    img.setAttribute('data-scrollveil-skip', 'true');
    processedImages.add(img);
    img.dataset.scrollveilProcessed = 'true';
    return;
  }

  // Mark as processed
  processedImages.add(img);
  img.dataset.scrollveilProcessed = 'true';

  // (YouTube card system is handled above — this point is only reached for non-YouTube images)

  // Wait for image to load
  if (!img.complete) {
    await new Promise(resolve => {
      img.onload = resolve;
      img.onerror = resolve;
    });
  }

  // Skip tiny images (but not placeholders displayed large — Google Images uses 1x1 GIFs)
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (width < 100 || height < 100) {
    // Check if this is a placeholder displayed larger than its natural size
    const displayW = img.offsetWidth || img.clientWidth || 0;
    const displayH = img.offsetHeight || img.clientHeight || 0;
    if (displayW >= 100 && displayH >= 100) {
      // Placeholder image (tiny natural size, large display) — don't skip, wait for real src
      // Remove processed flags so the src MutationObserver can re-trigger when real image loads
      processedImages.delete(img);
      delete img.dataset.scrollveilProcessed;
      return;
    }
    img.setAttribute('data-scrollveil-skip', 'true');
    markImageSafe(img);
    return;
  }

  // Analyze the image
  try {
    // For cross-origin images, re-fetch with CORS to avoid canvas tainting.
    // Without this, drawImage+toDataURL fails silently and analysis returns 0%.
    let analyzeTarget = img;
    try {
      const imgUrl = new URL(img.src, location.href);
      if (imgUrl.origin !== location.origin && !img.crossOrigin) {
        const corsImg = new Image();
        corsImg.crossOrigin = 'anonymous';
        // Add cache-buster: browser may have cached without CORS headers
        const bustUrl = img.src + (img.src.includes('?') ? '&' : '?') + '_cors=1';
        await new Promise((resolve, reject) => {
          let done = false;
          corsImg.onload = () => { if (!done) { done = true; resolve(); } };
          corsImg.onerror = () => { if (!done) { done = true; reject(); } };
          setTimeout(() => { if (!done) { done = true; reject('timeout'); } }, 8000);
          corsImg.src = bustUrl;
        });
        analyzeTarget = corsImg;
      }
    } catch (corsErr) {
      // CORS re-fetch failed — continue with original img (may score 0%)
      console.log('ScrollVeil: CORS re-fetch failed, using original image');
    }

    const result = await detector.analyzeImage(analyzeTarget);

    // ── Language scoring: scan surrounding title/post text ──
    try {
      const langResult = await scoreElementText(img);
      result.languageScore = langResult.scoreResult.score;
      result.languageIsNA = langResult.scoreResult.isNA;
      result.languageMatches = langResult.scoreResult.matches;
      result.languageTagSummary = langResult.scoreResult.tagSummary;
      result.languageWordCount = langResult.scoreResult.wordCount;
      result.languageSources = langResult.sources;
      result.languageText = langResult.text;
      // Badge displays whichever score is higher
      result.displayScore = Math.max(result.score, langResult.scoreResult.isNA ? 0 : langResult.scoreResult.score);
      console.log('ScrollVeil: Language score for image: ' + result.languageScore + '% (visual: ' + result.score + '%, display: ' + result.displayScore + '%)');
    } catch (langErr) {
      console.log('ScrollVeil: Language scoring failed for image:', langErr);
      result.languageScore = 0;
      result.languageIsNA = true;
      result.displayScore = result.score;
    }

    const autoThreshold = (typeof window._scrollveilAutoUnblurThreshold === 'number')
      ? window._scrollveilAutoUnblurThreshold
      : 0;

    if (result.action === 'allow') {
      console.log('ScrollVeil: Image SAFE (visual) - ' + result.reason);
      logDetection({ type: 'image', score: result.score, action: result.action, reason: result.reason, reasons: result.reasons, src: img.src?.substring(0, 200) });

      // Auto-unblur only when BOTH visual AND language are below threshold
      const langBelowThreshold = result.languageIsNA || result.languageScore < autoThreshold;
      if (result.score < autoThreshold && langBelowThreshold) {
        markImageSafe(img);
        addSafeBadge(img, result);
        console.log(`ScrollVeil: Auto-unblurred image (visual ${result.score}%, language ${result.languageScore}% — both < ${autoThreshold}% threshold)`);
      } else {
        blurImage(img, result);
        console.log(`ScrollVeil: Blurred image (visual ${result.score}%, language ${result.languageScore}% — at least one >= ${autoThreshold}% threshold)`);
      }

      img.setAttribute('data-scrollveil-analyzed', 'safe');
      return;
    }

    // Filtered content
    if (result.action === 'block' || result.action === 'blur') {
      console.log('ScrollVeil: Image FILTERED - Score: ' + result.score + '%');
      logDetection({ type: 'image', score: result.score, action: result.action, reason: result.reason, reasons: result.reasons, src: img.src?.substring(0, 200) });
      img.setAttribute('data-scrollveil-analyzed', 'filtered');
      blurImage(img, result);
    } else {
      console.log('ScrollVeil: Image blurred for user review (Score: ' + result.score + '%)');
      logDetection({ type: 'image', score: result.score, action: 'blur-review', reason: result.reason, reasons: result.reasons, src: img.src?.substring(0, 200) });
      img.setAttribute('data-scrollveil-analyzed', 'filtered');
      blurImage(img, {
        score: result.score,
        decision: 'FILTERED',
        action: 'blur',
        reason: 'Content filtered (click to reveal)'
      });
    }

  } catch (err) {
    console.log('ScrollVeil: Image analysis error - blurring for user review', err);
    img.setAttribute('data-scrollveil-analyzed', 'filtered');
    blurImage(img, {
      score: 0,
      decision: 'FILTERED',
      action: 'blur',
      reason: 'Could not analyze image (click to reveal)'
    });
  }
}


  // Function to blur an image (uses floating overlay — works on all sites)
  function blurImage(img, result) {
    // Always clean up all existing overlays first — prevents doubles on recycled nodes
    cleanupAllOverlaysForImage(img);
    removeDetectingBadge(img);
    console.log('ScrollVeil: blurImage() START - current analyzed attr:', img.getAttribute('data-scrollveil-analyzed'));

    // On X/Twitter, blur the CONTAINER (data-testid="tweetPhoto") instead of the <img>.
    // React aggressively strips inline styles from <img> elements on re-render,
    // but the tweetPhoto container persists. Same approach we use for video containers.
    const xImageContainer = isOnXDomain ? img.closest('[data-testid="tweetPhoto"]') : null;
    const useContainerBlur = !!xImageContainer;

    if (useContainerBlur) {
      // X/Twitter: blur the container — React won't strip styles from this element
      xImageContainer.style.setProperty('filter', `blur(${blurStrength}px)`, 'important');
      xImageContainer.style.setProperty('-webkit-filter', `blur(${blurStrength}px)`, 'important');
      xImageContainer._scrollveilBlurred = true;
      console.log('ScrollVeil: blurImage() X CONTAINER blur applied to tweetPhoto');
    } else {
      // All other sites: blur the image element directly
      img.style.setProperty('filter', `blur(${blurStrength}px)`, 'important');
      img.style.setProperty('-webkit-filter', `blur(${blurStrength}px)`, 'important');
    }
    img.dataset.scrollveilBlurred = 'true';

    // Overlay content - "score% | Reveal" badge (content is blurred)
    // Use displayScore (max of visual + language) when available
    const badgeScore = (typeof result.displayScore === 'number') ? result.displayScore : result.score;
    const overlayHTML = getScoreBadgeHTML(badgeScore, 'reveal');

    // Create floating overlay that tracks the image position (works on ALL sites)
    const overlay = createFloatingOverlay(img, overlayHTML, 'transparent');
    img._scrollveilFloatingOverlay = overlay;

    // innerBadge reference — click listener attached below after unblurHandler is defined
    const innerBadge = overlay.querySelector('div');

    // Click handler to unblur
    const unblurHandler = function (e) {
      e.preventDefault();
      e.stopPropagation();

      showUnblurPopup(result, function onReveal() {
        // Remove blur from the correct target
        if (useContainerBlur && xImageContainer) {
          xImageContainer.style.setProperty('filter', 'none', 'important');
          xImageContainer.style.setProperty('-webkit-filter', 'none', 'important');
          xImageContainer._scrollveilBlurred = false;
        } else {
          img.style.setProperty('filter', 'none', 'important');
          img.style.setProperty('-webkit-filter', 'none', 'important');
        }
        img.setAttribute('data-scrollveil-analyzed', 'safe');
        delete img.dataset.scrollveilBlurred;

        // Clean up ALL overlays via live reference (prevents stacking on re-blur cycles)
        if (img._scrollveilFloatingOverlay) {
          if (img._scrollveilFloatingOverlay._scrollveilCleanup) img._scrollveilFloatingOverlay._scrollveilCleanup();
          else img._scrollveilFloatingOverlay.remove();
          delete img._scrollveilFloatingOverlay;
        }

        // Add floating re-blur badge: "score% | Reblur"
        const reblurBadgeHTML = getScoreBadgeHTML(result.score, 'reblur');
        const reblurButton = document.createElement('div');
        reblurButton.innerHTML = reblurBadgeHTML;

        // Add hover effect to the Reblur button
        var reblurBlurBtn = reblurButton.querySelector('.scrollveil-action-btn');
        if (reblurBlurBtn) {
          reblurBlurBtn.addEventListener('mouseenter', function () { reblurBlurBtn.style.color = '#fff'; });
          reblurBlurBtn.addEventListener('mouseleave', function () { reblurBlurBtn.style.color = '#aaa'; });
        }
        reblurButton.style.cssText = `
        position: fixed !important;
        cursor: pointer !important;
        z-index: 2147483640 !important;
        pointer-events: auto !important;
      `;
        document.body.appendChild(reblurButton);

        // Make dot+score on re-blur badge light up separately (in their own color)
        var reblurScoreSpans = reblurButton.querySelectorAll('span');
        var reblurScoreSpan = null;
        var reblurDotSpan = null;
        for (var rs = 0; rs < reblurScoreSpans.length; rs++) {
          if (reblurScoreSpans[rs].style.fontWeight === 'bold') reblurScoreSpan = reblurScoreSpans[rs];
          if (reblurScoreSpans[rs].style.borderRadius === '50%') reblurDotSpan = reblurScoreSpans[rs];
        }
        if (reblurDotSpan) { reblurDotSpan.style.pointerEvents = 'auto'; reblurDotSpan.style.cursor = 'pointer'; }
        if (reblurScoreSpan) { reblurScoreSpan.style.pointerEvents = 'auto'; reblurScoreSpan.style.cursor = 'pointer'; }
        var reblurScoreHoverOn = function () {
          if (reblurDotSpan) reblurDotSpan.style.filter = 'brightness(1.5)';
          if (reblurScoreSpan) reblurScoreSpan.style.filter = 'brightness(1.5)';
        };
        var reblurScoreHoverOff = function () {
          if (reblurDotSpan) reblurDotSpan.style.filter = '';
          if (reblurScoreSpan) reblurScoreSpan.style.filter = '';
        };
        if (reblurDotSpan) { reblurDotSpan.addEventListener('mouseenter', reblurScoreHoverOn); reblurDotSpan.addEventListener('mouseleave', reblurScoreHoverOff); }
        if (reblurScoreSpan) { reblurScoreSpan.addEventListener('mouseenter', reblurScoreHoverOn); reblurScoreSpan.addEventListener('mouseleave', reblurScoreHoverOff); }
        var reblurScoreClick = function (e) { e.stopPropagation(); e.preventDefault(); showUnblurPopup(result, null, null); };
        if (reblurDotSpan) reblurDotSpan.addEventListener('click', reblurScoreClick);
        if (reblurScoreSpan) reblurScoreSpan.addEventListener('click', reblurScoreClick);

        const positionReblur = function () {
          const rect = img.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) { reblurButton.style.display = 'none'; return; }
          reblurButton.style.display = 'block';
          reblurButton.style.top = (rect.top + 5) + 'px';
          reblurButton.style.left = (rect.left + (rect.width / 2) - (reblurButton.offsetWidth / 2)) + 'px';
        };
        positionReblur();
        const unregisterReblur = registerVisualTracker(positionReblur);
        reblurButton._scrollveilCleanup = function () { unregisterReblur(); reblurButton.remove(); };
        img._scrollveilFloatingReblur = reblurButton;

        reblurButton.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();

          // Re-apply blur to the correct target
          if (useContainerBlur && xImageContainer) {
            xImageContainer.style.setProperty('filter', `blur(${blurStrength}px)`, 'important');
            xImageContainer.style.setProperty('-webkit-filter', `blur(${blurStrength}px)`, 'important');
            xImageContainer._scrollveilBlurred = true;
          } else {
            img.style.setProperty('filter', `blur(${blurStrength}px)`, 'important');
            img.style.setProperty('-webkit-filter', `blur(${blurStrength}px)`, 'important');
          }
          img.dataset.scrollveilBlurred = 'true';
          img.removeAttribute('data-scrollveil-analyzed');

          // Remove re-blur button
          if (reblurButton._scrollveilCleanup) reblurButton._scrollveilCleanup();
          else reblurButton.remove();
          delete img._scrollveilFloatingReblur;

          // Re-create floating overlay
          const newOverlay = createFloatingOverlay(img, overlayHTML, 'transparent');
          const newInnerBadge = newOverlay.querySelector('div');
          if (newInnerBadge) { newInnerBadge.style.pointerEvents = 'auto'; newInnerBadge.style.cursor = 'pointer'; newInnerBadge.addEventListener('click', unblurHandler); }
          img._scrollveilFloatingOverlay = newOverlay;

          console.log('ScrollVeil: Image re-blurred');
        });

        console.log('ScrollVeil: Image unblurred - use corner button to re-blur');
      }); // end showUnblurPopup
    };

    if (innerBadge) {
      innerBadge.style.pointerEvents = 'auto';
      innerBadge.style.cursor = 'pointer';
      innerBadge.addEventListener('click', unblurHandler);
    } else {
      // Fallback: if no inner div found, make overlay itself clickable
      overlay.style.setProperty('pointer-events', 'auto', 'important');
      overlay.addEventListener('click', unblurHandler);
    }

    console.log('ScrollVeil: Image blurred - ' + result.reason + (useContainerBlur ? ' (X container blur)' : ''));
  }

  // ═══════════════════════════════════════════════════════════════
  // VIDEO FRAME SAMPLING SYSTEM
  // Analyzes video frames at regular intervals with live badge updates.
  // Uses IntersectionObserver for viewport-only analysis.
  // ═══════════════════════════════════════════════════════════════

  // Get a stable cache key for a video element
  function getVideoCacheKey(video) {
    // Prefer currentSrc (actual playing source), then src, then a fallback
    return video.currentSrc || video.src || null;
  }

  // IntersectionObserver: start/stop frame sampling based on viewport visibility
  const videoViewportObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      // entry.target may be the video OR a container (YouTube uses container observation)
      const video = entry.target._scrollveilVideo || entry.target;
      if (entry.isIntersecting) {
        // Video entered viewport — start or resume analysis
        const cacheKey = getVideoCacheKey(video);
        if (cacheKey && videoSessionCache.has(cacheKey)) {
          const cached = videoSessionCache.get(cacheKey);
          if (cached.complete) {
            // Already fully analyzed — just show cached badge
            console.log('ScrollVeil: Video already analyzed (cached) - Score: ' + cached.visualScore + '%');
            updateVideoFrameBadge(video, cached, false);
            return;
          }
        }
        // Start or resume frame sampling
        if (!activeVideoAnalyses.has(video)) {
          startVideoFrameSampling(video);
        }
      } else {
        // Video left viewport — cancel active analysis to save CPU
        cancelVideoFrameSampling(video);
      }
    });
  }, { threshold: 0.5 }); // Trigger when 50% of the video is visible

  // Cancel an active frame sampling session for a video
  function cancelVideoFrameSampling(video) {
    const analysis = activeVideoAnalyses.get(video);
    if (analysis) {
      analysis.cancelled = true;
      if (analysis.intervalId) clearTimeout(analysis.intervalId);
      activeVideoAnalyses.delete(video);
      console.log('ScrollVeil: Frame sampling cancelled (video left viewport)');
    }
  }

  // Start frame-by-frame analysis on a video element
  async function startVideoFrameSampling(video) {
    const cacheKey = getVideoCacheKey(video);

    // Restore partial progress from cache if we paused earlier
    let state;
    if (cacheKey && videoSessionCache.has(cacheKey)) {
      state = videoSessionCache.get(cacheKey);
      if (state.complete) return; // Already done
      state.paused = false; // Clear paused flag on resume
    } else {
      // Duration 0 = "Full video" — use video's actual duration (fallback to 60s if unknown)
      const analysisDuration = VIDEO_SAMPLING_DEFAULTS.durationSeconds > 0
        ? VIDEO_SAMPLING_DEFAULTS.durationSeconds
        : (isFinite(video.duration) ? video.duration : 60);
      const totalFrames = Math.max(1, Math.floor(analysisDuration / VIDEO_SAMPLING_DEFAULTS.intervalSeconds));
      state = {
        visualScore: 0,
        peakScore: 0,
        frameScores: [],
        framesAnalyzed: 0,
        totalFrames: totalFrames,
        complete: false,
        earlyExitTriggered: false
      };
      if (cacheKey) videoSessionCache.set(cacheKey, state);
    }

    // Track this as an active analysis
    const analysisEntry = { intervalId: null, cancelled: false };
    activeVideoAnalyses.set(video, analysisEntry);

    // Show initial "Analyzing..." badge
    updateVideoFrameBadge(video, state, true);

    console.log('ScrollVeil: Starting frame sampling - ' + state.totalFrames + ' frames at ' + VIDEO_SAMPLING_DEFAULTS.intervalSeconds + 's intervals');

    // Create reusable canvas for frame capture
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 299;
    canvas.height = 299;

    // Sample frames at the configured interval
    let isAnalyzingFrame = false; // Prevents overlapping frame analysis
    const sampleOneFrame = async function () {
      // Safety checks
      if (analysisEntry.cancelled) return;
      if (isAnalyzingFrame) return; // Previous frame still being analyzed — skip this interval
      // Note: we do NOT check state.userRevealed here — analysis continues after reveal
      if (!document.contains(video)) {
        cancelVideoFrameSampling(video);
        return;
      }
      if (state.complete) return;

      // Wait for video to have enough data to draw a frame
      if (video.readyState < 2) {
        console.log('ScrollVeil: Video not ready yet (readyState=' + video.readyState + ') - waiting...');
        return; // Skip this interval, try next one
      }

      isAnalyzingFrame = true;
      try {
        // Draw current video frame to canvas
        // drawImage succeeds for cross-origin videos, but toDataURL() will throw
        // DOMException because the canvas becomes "tainted" (security restriction).
        ctx.drawImage(video, 0, 0, 299, 299);

        // Create temporary image for analysis
        // THIS is where the DOMException fires for cross-origin videos
        const tempImg = new Image();
        tempImg.src = canvas.toDataURL();
        await new Promise(function (resolve) { tempImg.onload = resolve; });

        // Analyze through existing pipeline (person detection + geometric analysis)
        const result = await detector.analyzeImage(tempImg, true); // true = isVideo flag

        if (analysisEntry.cancelled) return; // Check again after async work

        // Update state with this frame's score
        state.frameScores.push(result.score);
        state.framesAnalyzed++;

        // Update visual score (running average)
        const sum = state.frameScores.reduce(function (a, b) { return a + b; }, 0);
        state.visualScore = Math.round(sum / state.frameScores.length);

        // Track peak score AND store full detection result for popup details
        if (result.score > state.peakScore) {
          state.peakScore = result.score;
          state.peakResult = result; // Full detector result (reasons, personCount, sceneObjects, etc.)
        }

        console.log('ScrollVeil: Frame ' + state.framesAnalyzed + '/' + state.totalFrames +
          ' - Score: ' + result.score + '% (avg: ' + state.visualScore + '%, peak: ' + state.peakScore + '%)');

        // Update the live badge
        updateVideoFrameBadge(video, state, true);

        // Save to session cache
        if (cacheKey) videoSessionCache.set(cacheKey, state);

        // Early exit check (0 = disabled — "never stop early")
        if (VIDEO_SAMPLING_DEFAULTS.earlyExitThreshold > 0 && state.peakScore >= VIDEO_SAMPLING_DEFAULTS.earlyExitThreshold) {
          state.earlyExitTriggered = true;
          state.complete = true;
          console.log('ScrollVeil: Early exit triggered - peak score ' + state.peakScore + '% >= ' + VIDEO_SAMPLING_DEFAULTS.earlyExitThreshold + '%');
        }

        // Check if all frames are done
        if (state.framesAnalyzed >= state.totalFrames) {
          state.complete = true;
          console.log('ScrollVeil: Frame sampling complete - Final avg: ' + state.visualScore + '%, Peak: ' + state.peakScore + '%');
        }

        // If complete, finalize
        if (state.complete) {
          cancelVideoFrameSampling(video);
          updateVideoFrameBadge(video, state, false);
          finalizeVideoAnalysis(video, state);
        }

      } catch (error) {
        // Cross-origin videos taint the canvas — toDataURL() throws DOMException.
        // Detect this and stop sampling permanently (every frame will fail the same way).
        if (error.name === 'SecurityError' || (error instanceof DOMException)) {
          console.log('ScrollVeil: Cross-origin video — canvas tainted, stopping frame analysis');
          state.complete = true;
          state.crossOriginBlocked = true;
          cancelVideoFrameSampling(video);

          // Fallback: try analyzing sibling <img> thumbnail via CORS re-fetch
          if (video.parentElement) {
            const siblingImg = video.parentElement.querySelector('img');
            if (siblingImg && siblingImg.src) {
              try {
                const corsImg = new Image();
                corsImg.crossOrigin = 'anonymous';
                corsImg.src = siblingImg.src;
                await new Promise((resolve, reject) => {
                  corsImg.onload = resolve;
                  corsImg.onerror = reject;
                  setTimeout(reject, 5000);
                });
                const fallbackResult = await detector.analyzeImage(corsImg);
                state.peakScore = fallbackResult.score;
                state.visualScore = fallbackResult.score;
                state.peakReasons = fallbackResult.reasons || [];
                state.peakZoneScores = fallbackResult.zoneScores || {};
                console.log('ScrollVeil: Cross-origin fallback — analyzed sibling thumbnail, score:', fallbackResult.score);
              } catch (fallbackErr) {
                console.log('ScrollVeil: Sibling thumbnail fallback failed:', fallbackErr);
              }
            }
          }

          updateVideoFrameBadge(video, state, false);
          return;
        }
        console.error('ScrollVeil: Frame sampling error:', error);
        // Don't stop sampling on a single frame error — skip and continue
      } finally {
        isAnalyzingFrame = false;
      }
    };

    // Take first frame immediately, then chain subsequent frames with setTimeout.
    // Using setTimeout instead of setInterval ensures each frame waits for the
    // previous analysis to complete + the configured interval before starting.
    // setInterval could fire while analysis is still running, causing skipped frames.
    await sampleOneFrame();
    if (!analysisEntry.cancelled && !state.complete) {
      function scheduleNextFrame() {
        if (analysisEntry.cancelled || state.complete) return;
        analysisEntry.intervalId = setTimeout(async function () {
          await sampleOneFrame();
          scheduleNextFrame(); // Chain the next frame after this one completes
        }, VIDEO_SAMPLING_DEFAULTS.intervalSeconds * 1000);
      }
      scheduleNextFrame();
    }
  }

  // Finalize video analysis: decide blur/reveal based on score and user threshold
  async function finalizeVideoAnalysis(video, state) {
    // If user already manually revealed, update the reblur badge with final score but don't re-blur
    if (state.userRevealed) {
      console.log('ScrollVeil: Analysis complete on revealed video — updating badge (visual: ' + state.visualScore + '%, peak: ' + state.peakScore + '%)');
      // Update the frame badge to show "Complete" instead of "Analyzing"
      updateVideoFrameBadge(video, state, false);
      return;
    }

    // ── Language scoring: scan title/post text and captions ──
    // Skip if already scored (e.g. loaded from session cache)
    let langScore = state.languageScore || 0;
    let langIsNA = (typeof state.languageIsNA === 'boolean') ? state.languageIsNA : true;
    let langResult = state.languageResult || null;
    if (typeof state.languageScore !== 'number') {
      try {
        langResult = await scoreElementText(video);
        langScore = langResult.scoreResult.score;
        langIsNA = langResult.scoreResult.isNA;
        state.languageScore = langScore;
        state.languageIsNA = langIsNA;
        state.languageResult = langResult;
        console.log('ScrollVeil: Video language score: ' + langScore + '% (visual: ' + state.visualScore + '%)');
      } catch (langErr) {
        console.log('ScrollVeil: Video language scoring failed:', langErr);
      }
    }

    const displayScore = Math.max(state.visualScore, langIsNA ? 0 : langScore);
    state.displayScore = displayScore;

    const autoThreshold = (typeof window._scrollveilAutoUnblurThreshold === 'number')
      ? window._scrollveilAutoUnblurThreshold
      : 0;

    // Auto-unblur only when BOTH visual AND language are below threshold
    const visualBelow = state.visualScore < autoThreshold;
    const langBelow = langIsNA || langScore < autoThreshold;

    if (visualBelow && langBelow) {
      // Both below auto-unblur threshold — mark safe
      console.log('ScrollVeil: Video auto-revealed (visual ' + state.visualScore + '%, language ' + langScore + '% — both < ' + autoThreshold + '%)');
      // Clean up frame sampling badge before placing safe badge
      cleanupVideoOverlays(video);
      markVideoSafe(video);
      const result = { score: state.visualScore, displayScore: displayScore, decision: 'ALLOWED', action: 'allow',
        reason: state.peakResult ? state.peakResult.reason : 'Video analyzed - safe',
        personCount: state.peakResult ? state.peakResult.personCount : 0,
        sceneObjects: state.peakResult ? state.peakResult.sceneObjects : [],
        languageScore: langScore, languageIsNA: langIsNA,
        languageMatches: langResult ? langResult.scoreResult.matches : [],
        languageTagSummary: langResult ? langResult.scoreResult.tagSummary : {},
        languageWordCount: langResult ? langResult.scoreResult.wordCount : 0,
        languageSources: langResult ? langResult.sources : {} };
      addSafeBadge(video, result);
    } else {
      // At least one score above threshold — keep blurred, user decides
      console.log('ScrollVeil: Video stays blurred (visual ' + state.visualScore + '%, language ' + langScore + '% — at least one >= ' + autoThreshold + '%)');
      const result = {
        score: state.visualScore, displayScore: displayScore,
        decision: displayScore >= 80 ? 'BLOCKED' : 'FILTERED',
        action: displayScore >= 80 ? 'block' : 'blur',
        reason: state.peakResult ? state.peakResult.reason : ('Video filtered — Visual: ' + state.visualScore + '%'),
        personCount: state.peakResult ? state.peakResult.personCount : 0,
        sceneObjects: state.peakResult ? state.peakResult.sceneObjects : [],
        languageScore: langScore, languageIsNA: langIsNA,
        languageMatches: langResult ? langResult.scoreResult.matches : [],
        languageTagSummary: langResult ? langResult.scoreResult.tagSummary : {},
        languageWordCount: langResult ? langResult.scoreResult.wordCount : 0,
        languageSources: langResult ? langResult.sources : {} };
      blurVideo(video, result);
    }
  }

  // Create/update the live analysis badge on a video
  function updateVideoFrameBadge(video, state, isAnalyzing) {
    const { container: xContainer, isXPlayer, isYTPlayer } = getVideoContainer(video);
    const trackTarget = (isXPlayer || isYTPlayer) ? (xContainer || video) : video;

    // Remove any existing frame-sampling badge
    if (video._scrollveilFrameBadge) {
      video._scrollveilFrameBadge.remove();
      overlayRegistry.delete(video._scrollveilFrameBadge);
      video._scrollveilFrameBadge = null;
    }

    const progress = state.totalFrames > 0
      ? Math.round((state.framesAnalyzed / state.totalFrames) * 100)
      : 0;
    const score = state.visualScore;
    const color = getScoreColor(score);
    const isRevealed = state.userRevealed;
    const actionLabel = isRevealed ? 'Reblur' : 'Reveal';

    let badgeInnerHTML;
    if (state.paused) {
      // Paused — static dot + "Paused" + score + action
      badgeInnerHTML =
        '<div style="display:inline-flex; align-items:center; gap:4px; ' +
        'background:rgba(0,0,0,0.6); border-radius:12px; padding:3px 8px; ' +
        'font-family:Arial,sans-serif; font-size:11px; color:#fff; ' +
        'pointer-events:auto; line-height:1; white-space:nowrap;">' +
        '<span style="display:inline-block; width:8px; height:8px; background:' + color + '; border-radius:50%; flex-shrink:0;"></span>' +
        '<span style="color:#FF9800; font-size:10px;">Paused</span>' +
        '<span style="color:' + color + '; font-weight:bold;">' + score + '%</span>' +
        '<span style="color:rgba(255,255,255,0.4); margin:0 1px;">|</span>' +
        '<span class="scrollveil-action-btn" style="cursor:pointer; color:#aaa; font-size:10px;">' + actionLabel + '</span>' +
        '</div>';
    } else if (!state.complete) {
      // Analyzing — pulsing dot + "Analyzing" + score + action
      badgeInnerHTML =
        '<div style="display:inline-flex; align-items:center; gap:4px; ' +
        'background:rgba(0,0,0,0.6); border-radius:12px; padding:3px 8px; ' +
        'font-family:Arial,sans-serif; font-size:11px; color:#fff; ' +
        'pointer-events:auto; line-height:1; white-space:nowrap;">' +
        '<span style="display:inline-block; width:8px; height:8px; background:' + color + '; border-radius:50%; flex-shrink:0; animation: scrollveil-pulse 1.5s ease-in-out infinite;"></span>' +
        '<span style="color:#fff; font-size:10px;">Analyzing</span>' +
        '<span style="color:' + color + '; font-weight:bold;">' + score + '%</span>' +
        '<span style="color:rgba(255,255,255,0.4); margin:0 1px;">|</span>' +
        '<span class="scrollveil-action-btn" style="cursor:pointer; color:#aaa; font-size:10px;">' + actionLabel + '</span>' +
        '</div>';
    } else {
      // Complete — static dot + score + action (no status text, matches image badges)
      badgeInnerHTML = getScoreBadgeHTML(score, isRevealed ? 'reblur' : 'reveal');
    }

    // Build the badge using createFloatingOverlay (consistent with all other badges)
    // getScoreBadgeHTML already returns a complete styled <div>, so use directly
    const overlay = createFloatingOverlay(trackTarget, badgeInnerHTML, 'transparent');
    // Position at TOP CENTER (not center-center)
    overlay.style.setProperty('align-items', 'flex-start', 'important');
    overlay.style.setProperty('justify-content', 'center', 'important');
    overlay.style.setProperty('padding-top', '6px', 'important');
    // Overlay itself doesn't block clicks — only the inner badge div is clickable
    overlay.style.setProperty('pointer-events', 'none', 'important');

    // Make the inner badge div clickable — shows score details popup
    const innerBadge = overlay.querySelector('div');
    const actionBtn = overlay.querySelector('.scrollveil-action-btn');
    if (actionBtn) {
      actionBtn.style.pointerEvents = 'auto';
      actionBtn.addEventListener('mouseenter', function () { actionBtn.style.color = '#fff'; });
      actionBtn.addEventListener('mouseleave', function () { actionBtn.style.color = '#aaa'; });

      // Action button: Reveal or Reblur — does NOT affect analysis
      actionBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (state.userRevealed) {
          // REBLUR — re-apply blur, analysis keeps running
          state.userRevealed = false;
          const cacheKey = getVideoCacheKey(video);
          if (cacheKey && videoSessionCache.has(cacheKey)) {
            videoSessionCache.get(cacheKey).userRevealed = false;
          }
          // Apply blur
          const effectiveBlur = blurStrength;
          const { container: blurContainer, isXPlayer: blurIsX } = getVideoContainer(video);
          if (blurIsX && blurContainer) {
            blurContainer.style.setProperty('filter', 'blur(' + effectiveBlur + 'px)', 'important');
            blurContainer.style.setProperty('-webkit-filter', 'blur(' + effectiveBlur + 'px)', 'important');
            blurContainer._scrollveilBlurred = true;
          } else {
            video.style.setProperty('filter', 'blur(' + effectiveBlur + 'px)', 'important');
            video.style.setProperty('-webkit-filter', 'blur(' + effectiveBlur + 'px)', 'important');
          }
          video.dataset.scrollveilBlurred = 'true';
          // Update badge to show "Reveal" instead of "Reblur"
          updateVideoFrameBadge(video, state, !state.complete && !state.paused);
          console.log('ScrollVeil: Video reblurred by user — analysis unaffected');
        } else {
          // REVEAL — show unblur popup, analysis keeps running
          const currentResult = {
            score: state.visualScore,
            decision: state.complete ? (state.visualScore >= 80 ? 'BLOCKED' : 'FILTERED') : 'ANALYZING',
            action: 'blur',
            isAnalyzing: !state.complete || state.paused,
            _video: video,
            _state: state,
            reason: state.peakResult ? state.peakResult.reason : ('Visual: ' + state.visualScore + '% (Peak: ' + state.peakScore + '%)'),
            personCount: state.peakResult ? state.peakResult.personCount : 0,
            sceneObjects: state.peakResult ? state.peakResult.sceneObjects : []
          };
          showUnblurPopup(currentResult, function onReveal() {
            state.userRevealed = true;
            const cacheKey = getVideoCacheKey(video);
            if (cacheKey && videoSessionCache.has(cacheKey)) {
              videoSessionCache.get(cacheKey).userRevealed = true;
            }
            // Remove blur
            markVideoSafe(video);
            // Update badge to show "Reblur" instead of "Reveal"
            updateVideoFrameBadge(video, state, !state.complete && !state.paused);
            console.log('ScrollVeil: Video revealed by user — analysis unaffected');
          }, null);
        }
      });
    }

    // Make dot and score text clickable — opens details popup (with Pause/Resume)
    if (innerBadge) {
      innerBadge.style.pointerEvents = 'auto';
      innerBadge.style.cursor = 'pointer';
      innerBadge.addEventListener('click', function (e) {
        // Only trigger on the dot/score area, not the action button
        if (e.target.classList && e.target.classList.contains('scrollveil-action-btn')) return;
        e.preventDefault();
        e.stopPropagation();
        const currentResult = {
          score: state.visualScore,
          decision: state.complete ? (state.visualScore >= 80 ? 'BLOCKED' : 'FILTERED') : 'ANALYZING',
          action: 'blur',
          isAnalyzing: !state.complete || state.paused,
          _video: video,
          _state: state,
          reason: state.peakResult ? state.peakResult.reason : ('Visual: ' + state.visualScore + '% (Peak: ' + state.peakScore + '%)'),
          personCount: state.peakResult ? state.peakResult.personCount : 0,
          sceneObjects: state.peakResult ? state.peakResult.sceneObjects : []
        };
        // Details-only popup (no reveal button — use the badge action button for that)
        showUnblurPopup(currentResult, null, null);
      });
    }

    // Register in overlay registry for orphan sweep
    overlayRegistry.set(overlay, trackTarget);
    video._scrollveilFrameBadge = overlay;
  }


  // Function to mark a video (and its X container) as safe
  function markVideoSafe(video) {
    video.setAttribute('data-scrollveil-analyzed', 'safe');

    // Force-clear inline blur on the video element
    video.style.setProperty('filter', 'none', 'important');
    video.style.setProperty('-webkit-filter', 'none', 'important');
    video.style.setProperty('pointer-events', 'auto', 'important');
    video._scrollveilBlurred = false;

    // On X/YouTube: also clear the CONTAINER blur and mark it safe so CSS shield doesn't re-apply
    const { container: xContainer, isXPlayer, isYTPlayer } = getVideoContainer(video);
    if ((isXPlayer || isYTPlayer) && xContainer) {
      xContainer.style.setProperty('filter', 'none', 'important');
      xContainer.setAttribute('data-scrollveil-analyzed', 'safe');
      xContainer._scrollveilBlurred = false;
      if (xContainer._scrollveilEnforceBlur) {
        xContainer._scrollveilEnforceBlur();
        delete xContainer._scrollveilEnforceBlur;
      }
    }

    // On X: tweetPhoto wraps videoPlayer and has its own CSS shield rule.
    // Must mark it analyzed too or it keeps blurring via CSS.
    if (isXPlayer) {
      const tweetPhoto = video.closest('[data-testid="tweetPhoto"]');
      if (tweetPhoto) {
        tweetPhoto.setAttribute('data-scrollveil-analyzed', 'safe');
        tweetPhoto.style.setProperty('filter', 'none', 'important');
      }
    }

    // Remove blur enforcement if active
    if (video._scrollveilEnforceBlur) {
      video._scrollveilEnforceBlur(); // Call unregister function
      delete video._scrollveilEnforceBlur;
    }

    // Remove any leftover floating overlay
    cleanupVideoOverlays(video);

    // Restore native controls only on sites without their own player UI
    // X and YouTube both use custom player controls — enabling native controls causes duplicates
    if (!isOnXDomain && !isOnYouTube) {
      video.controls = true;
    }
  }

  // Function to process video elements — applies initial blur and registers for frame sampling
  async function processVideo(video) {
    // Skip if extension is disabled
    if (!scrollveilEnabled) return;
    // Skip if already processed (check WeakSet first — immune to React attribute stripping)
    if (processedVideos.has(video) || video.dataset.scrollveilProcessed) {
      return;
    }

    // Skip if this video shares a parent with an already-processed image.
    // But NOT on Grok — video pipeline owns everything there.
    if (window.location.hostname !== 'grok.com' && video.parentElement) {
      const siblingImg = video.parentElement.querySelector('img');
      if (siblingImg && (processedImages.has(siblingImg) || siblingImg.dataset.scrollveilProcessed)) {
        processedVideos.add(video);
        video.dataset.scrollveilProcessed = 'true';
        return;
      }
    }

    // On YouTube: only process the main player video on watch/shorts pages.
    // Homepage/browse thumbnail videos (hover previews) are handled by the thumbnail badge system.
    if (isOnYouTube) {
      const isWatchPage = window.location.pathname.startsWith('/watch');
      const isShortsPage = window.location.pathname.startsWith('/shorts/');
      const isMainPlayer = video.closest('#movie_player') || video.closest('.html5-video-player');
      if ((!isWatchPage && !isShortsPage) || !isMainPlayer) {
        processedVideos.add(video);
        return;
      }
    }

    // On X/YouTube: check container-level dedup (React may swap <video> elements inside the same container)
    const { container: xContainer, isXPlayer, isYTPlayer } = getVideoContainer(video);
    if ((isXPlayer || isYTPlayer) && xContainer && xContainer._scrollveilProcessed) {
      processedVideos.add(video); // Mark this video instance so we don't check again
      return;
    }

    // YouTube hover preview debounce: YouTube creates ephemeral <video> elements
    // on thumbnail hover that get rapidly added/removed. Wait 300ms to confirm
    // the video element is still in the DOM before processing.
    if (isOnYouTube && !video._scrollveilDebounced) {
      video._scrollveilDebounced = true;
      await new Promise(resolve => setTimeout(resolve, 300));
      // Check if video was removed from DOM during the wait
      if (!document.contains(video)) {
        console.log('ScrollVeil: YouTube ephemeral video removed during debounce - skipping');
        return;
      }
    }

    console.log('ScrollVeil: processVideo() called - src:', (video.src || video.currentSrc || 'none').substring(0, 60));

    // Mark as processed (both WeakSet and data attribute)
    processedVideos.add(video);
    video.dataset.scrollveilProcessed = 'true';
    if ((isXPlayer || isYTPlayer) && xContainer) {
      xContainer._scrollveilProcessed = true;
    }

    // Apply initial blur while analysis runs
    const effectiveBlur = blurStrength;
    // On X: CSS shield already blurs the videoPlayer container — skip JS initial blur to avoid stacking
    // On YouTube watch pages: blur the CONTAINER (#movie_player) — YouTube positions <video> off-screen
    if (!video.hasAttribute('data-scrollveil-analyzed') && !(isXPlayer && xContainer)) {
      if (isYTPlayer && xContainer) {
        // YouTube: blur the container (video element is off-screen)
        xContainer.style.setProperty('filter', `blur(${effectiveBlur}px)`, 'important');
        xContainer.style.setProperty('overflow', 'hidden', 'important');
        console.log('🔒 ScrollVeil: YT CONTAINER BLUR applied - ' + effectiveBlur + 'px');
      } else {
        // Other sites: blur the video element directly
        video.style.setProperty('filter', `blur(${effectiveBlur}px)`, 'important');
        video.style.setProperty('-webkit-filter', `blur(${effectiveBlur}px)`, 'important');
        console.log('🔒 ScrollVeil: VIDEO BLUR applied - ' + effectiveBlur + 'px');
      }
    }

    // Skip very small videos (likely icons/buttons)
    // But on X, videoWidth/Height can be 0 before metadata loads - don't skip those
    const width = video.videoWidth || video.offsetWidth || video.width;
    const height = video.videoHeight || video.offsetHeight || video.height;

    if (width > 0 && height > 0 && width < 100 && height < 100) {
      console.log('ScrollVeil: Skipping tiny video (' + width + 'x' + height + ')');
      markVideoSafe(video);
      return;
    }

    console.log('ScrollVeil: Processing video - dimensions: ' + width + 'x' + height + (isOnXDomain ? ' (X domain)' : ''));

    // Check session cache — if this video URL was already fully analyzed, use cached results
    const cacheKey = getVideoCacheKey(video);
    if (cacheKey && videoSessionCache.has(cacheKey)) {
      const cached = videoSessionCache.get(cacheKey);
      if (cached.complete) {
        console.log('ScrollVeil: Using cached video analysis - Score: ' + cached.visualScore + '%');
        finalizeVideoAnalysis(video, cached);
        return;
      }
    }

    // Register with IntersectionObserver for viewport-based frame sampling.
    // Analysis starts when the video is 50% visible and pauses when scrolled away.
    // On YouTube: observe the CONTAINER (#movie_player) instead of the <video> element,
    // because YouTube positions the <video> off-screen and clips it via overflow:hidden.
    // The container is what's actually visible in the viewport.
    const observeTarget = (isYTPlayer && xContainer) ? xContainer : video;
    videoViewportObserver.observe(observeTarget);
    // Store reference so startVideoFrameSampling can find the actual video element
    if (observeTarget !== video) observeTarget._scrollveilVideo = video;
    console.log('🎬 ScrollVeil: Video registered for frame sampling' + (observeTarget !== video ? ' (observing container)' : ''));
  }

  // Helper: Create a floating overlay attached to document.body that tracks a target element's position.
  // This is used on X/Twitter because React strips child nodes from its managed containers.
  function createFloatingOverlay(targetElement, innerHTML, bgColor) {
    const overlay = document.createElement('div');
    overlay.dataset.scrollveilOverlay = 'true';
    overlay.style.cssText = `
    position: fixed !important;
    padding: 6px 0 0 0 !important;
    background: ${bgColor || 'transparent'} !important;
    color: white !important;
    font-size: 14px !important;
    font-family: Arial, sans-serif !important;
    cursor: pointer !important;
    z-index: 2147483640 !important;
    display: flex !important;
    align-items: flex-start !important;
    justify-content: center !important;
    text-align: center !important;
    filter: none !important;
    -webkit-filter: none !important;
    pointer-events: none !important;
    box-sizing: border-box !important;
    overflow: hidden !important;
  `;
    overlay.innerHTML = innerHTML;
    document.body.appendChild(overlay);

    // Register in global registry for orphan sweep
    overlayRegistry.set(overlay, targetElement);

    // Position update function
    function updatePosition() {
      const rect = targetElement.getBoundingClientRect();
      // Hide if element is zero-sized (removed) or fully outside the viewport
      if (rect.width === 0 && rect.height === 0) {
        overlay.style.display = 'none';
        return;
      }
      const inViewport = rect.bottom > 0 && rect.top < window.innerHeight &&
                         rect.right > 0 && rect.left < window.innerWidth;
      if (!inViewport) {
        overlay.style.display = 'none';
        return;
      }
      // Check if the element is clipped by an overflow:hidden ancestor
      // This prevents badges from appearing on images that are scrolled inside containers
      let clipped = false;
      let parent = targetElement.parentElement;
      while (parent && parent !== document.body) {
        const pStyle = getComputedStyle(parent);
        if (pStyle.overflow === 'hidden' || pStyle.overflowX === 'hidden' || pStyle.overflowY === 'hidden') {
          const pRect = parent.getBoundingClientRect();
          // Calculate how much of the image is visible inside this container
          const visibleLeft = Math.max(rect.left, pRect.left);
          const visibleRight = Math.min(rect.right, pRect.right);
          const visibleTop = Math.max(rect.top, pRect.top);
          const visibleBottom = Math.min(rect.bottom, pRect.bottom);
          const visibleWidth = Math.max(0, visibleRight - visibleLeft);
          const visibleHeight = Math.max(0, visibleBottom - visibleTop);
          const visibleArea = visibleWidth * visibleHeight;
          const totalArea = rect.width * rect.height;
          // Hide badge if less than 40% of the image is visible
          if (totalArea > 0 && visibleArea / totalArea < 0.4) {
            clipped = true;
            break;
          }
        }
        parent = parent.parentElement;
      }
      if (clipped) {
        overlay.style.display = 'none';
        return;
      }
      overlay.style.display = 'flex';
      overlay.style.top = rect.top + 'px';
      overlay.style.left = rect.left + 'px';
      overlay.style.width = rect.width + 'px';
      overlay.style.height = rect.height + 'px';

      // Scale badge text for small containers
      const minDim = Math.min(rect.width, rect.height);
      if (minDim < 80) {
        overlay.style.fontSize = '8px';
      } else if (minDim < 150) {
        overlay.style.fontSize = '10px';
      } else {
        overlay.style.fontSize = '14px';
      }
    }

    // Initial position
    updatePosition();

    // Track position changes (scroll, resize, layout shifts)
    const unregisterPosition = registerVisualTracker(updatePosition);
    window.addEventListener('scroll', updatePosition, { passive: true });
    window.addEventListener('resize', updatePosition, { passive: true });

    // Cleanup function
    overlay._scrollveilCleanup = function () {
      unregisterPosition();
      window.removeEventListener('scroll', updatePosition);
      window.removeEventListener('resize', updatePosition);
      overlayRegistry.delete(overlay);
      overlay.remove();
    };

    overlay._scrollveilUpdatePosition = updatePosition;

    return overlay;
  }

  // Helper: Clean up a single overlay or button element
  function cleanupOverlayElement(el, propName, owner) {
    if (!el) return;
    if (el._scrollveilCleanup) {
      el._scrollveilCleanup();
    } else {
      el.remove();
    }
    if (owner && propName) delete owner[propName];
  }

  // Helper: Clean up any existing floating overlay stored on a video element.
  // Prevents duplicate overlays and ensures safe videos have no leftover overlays.
  // Also cleans container-level references (handles YouTube swapping <video> elements).
  function cleanupVideoOverlays(video) {
    // Clean video-level references
    cleanupOverlayElement(video._scrollveilFloatingOverlay, '_scrollveilFloatingOverlay', video);
    cleanupOverlayElement(video._scrollveilFloatingReblur, '_scrollveilFloatingReblur', video);

    // Clean frame sampling badge
    if (video._scrollveilFrameBadge) {
      overlayRegistry.delete(video._scrollveilFrameBadge);
      video._scrollveilFrameBadge.remove();
      video._scrollveilFrameBadge = null;
    }

    // Clean CONTAINER-level references (catches orphans from swapped <video> elements)
    const { container } = getVideoContainer(video);
    if (container) {
      cleanupOverlayElement(container._scrollveilFloatingOverlay, '_scrollveilFloatingOverlay', container);
      cleanupOverlayElement(container._scrollveilFloatingReblur, '_scrollveilFloatingReblur', container);

      if (container._scrollveilEnforceBlur) {
        container._scrollveilEnforceBlur(); // Call unregister function
        delete container._scrollveilEnforceBlur;
      }
    }

    console.log('ScrollVeil: Cleaned up overlays (video + container)');
  }

  // Function to blur a video
  function blurVideo(video, result) {
    // Clean up any existing overlay for this video first (prevents duplicates)
    cleanupVideoOverlays(video);

    const { container: xContainer, isXPlayer, isYTPlayer } = getVideoContainer(video);
    const effectiveBlur = blurStrength; // Minimum 30px so blur is always visible
    const useContainerBlur = (isXPlayer || isYTPlayer) && xContainer;

    console.log('ScrollVeil: blurVideo() called - isXPlayer:', isXPlayer, 'isYTPlayer:', isYTPlayer, 'blur:', effectiveBlur + 'px');

    // Mark analyzed so CSS shield stops applying to this video
    video.setAttribute('data-scrollveil-analyzed', 'filtered');

    let overlay;

    // BLUR: On X/YouTube, blur the CONTAINER (React strips inline styles from <video>,
    // YouTube positions <video> off-screen). On other sites, blur the video element directly.
    if (useContainerBlur) {
      xContainer.setAttribute('data-scrollveil-analyzed', 'filtered');
      xContainer.style.setProperty('filter', `blur(${effectiveBlur}px)`, 'important');
      xContainer.style.setProperty('overflow', 'hidden', 'important');
      xContainer._scrollveilBlurred = true;
      video._scrollveilBlurred = true;

      // On X: mark tweetPhoto as filtered too so its CSS shield doesn't double-blur
      if (isXPlayer) {
        const tweetPhoto = video.closest('[data-testid="tweetPhoto"]');
        if (tweetPhoto) tweetPhoto.setAttribute('data-scrollveil-analyzed', 'filtered');
      }

      // Register enforcement tracker to re-apply CONTAINER blur if React strips it
      const enforceFn = () => {
        if (!xContainer._scrollveilBlurred) {
          unregisterEnforce();
          return;
        }
        const f = window.getComputedStyle(xContainer).filter;
        if (!f || f === 'none') {
          xContainer.style.setProperty('filter', `blur(${effectiveBlur}px)`, 'important');
        }
      };
      const unregisterEnforce = registerEnforcementTracker(enforceFn);
      xContainer._scrollveilEnforceBlur = unregisterEnforce;
      video._scrollveilEnforceBlur = unregisterEnforce;
    } else {
      video.style.setProperty('filter', `blur(${effectiveBlur}px)`, 'important');
      video.style.setProperty('-webkit-filter', `blur(${effectiveBlur}px)`, 'important');
      video.style.setProperty('pointer-events', 'none', 'important');
      video._scrollveilBlurred = true;

      // Register enforcement tracker to re-apply video blur if the platform strips it
      const enforceFn = () => {
        if (!video._scrollveilBlurred) {
          unregisterEnforce();
          return;
        }
        const f = window.getComputedStyle(video).filter;
        if (!f || f === 'none') {
          video.style.setProperty('filter', `blur(${effectiveBlur}px)`, 'important');
          video.style.setProperty('-webkit-filter', `blur(${effectiveBlur}px)`, 'important');
        }
      };
      const unregisterEnforce = registerEnforcementTracker(enforceFn);
      video._scrollveilEnforceBlur = unregisterEnforce;
    }

    // Overlay content - "score% | Reveal" badge (content is blurred)
    // Use displayScore (max of visual + language) when available
    const badgeScore = (typeof result.displayScore === 'number') ? result.displayScore : result.score;
    const overlayHTML = getScoreBadgeHTML(badgeScore, 'reveal');

    // Create floating overlay that tracks the video's position (all sites)
    const trackTarget = useContainerBlur ? xContainer : video;
    overlay = createFloatingOverlay(trackTarget, overlayHTML, 'transparent');
    // Position at TOP CENTER (not center-center)
    overlay.style.setProperty('align-items', 'flex-start', 'important');
    overlay.style.setProperty('justify-content', 'center', 'important');
    overlay.style.setProperty('padding-top', '6px', 'important');
    // Make whole overlay clickable — some sites use isolation:isolate which blocks
    // pointer-events on inner children from receiving mouse clicks
    overlay.style.setProperty('pointer-events', 'none', 'important');
    video._scrollveilFloatingOverlay = overlay;
    if (useContainerBlur && xContainer) xContainer._scrollveilFloatingOverlay = overlay;

    // Click handler to unblur
    const unblurVideoHandler = function (e) {
      e.preventDefault();
      e.stopPropagation();

      showUnblurPopup(result, function onReveal() {
        // Clean up ALL overlays via live reference (prevents stacking on re-blur cycles)
        cleanupVideoOverlays(video);

        // Re-lookup container FRESH (React may have swapped the container since blurVideo was called)
        const { container: freshContainer, isXPlayer: freshIsX, isYTPlayer: freshIsYT } = getVideoContainer(video);

        // Remove blur — from CONTAINER on X/YouTube, from VIDEO on other sites
        if ((freshIsX || freshIsYT) && freshContainer) {
          freshContainer.style.setProperty('filter', 'none', 'important');
          freshContainer._scrollveilBlurred = false;
          freshContainer.setAttribute('data-scrollveil-analyzed', 'safe');
          if (freshContainer._scrollveilEnforceBlur) {
            freshContainer._scrollveilEnforceBlur();
            delete freshContainer._scrollveilEnforceBlur;
          }
        }
        // Also clear the original closed-over container in case it's different
        if (isXPlayer && xContainer && xContainer !== freshContainer) {
          xContainer.style.setProperty('filter', 'none', 'important');
          xContainer._scrollveilBlurred = false;
          if (xContainer._scrollveilEnforceBlur) {
            xContainer._scrollveilEnforceBlur();
            delete xContainer._scrollveilEnforceBlur;
          }
        }
        video.style.setProperty('filter', 'none', 'important');
        video.style.setProperty('-webkit-filter', 'none', 'important');
        video.style.setProperty('pointer-events', 'auto', 'important');
        video._scrollveilBlurred = false;

        // On X: clear tweetPhoto CSS shield blur too
        if (freshIsX || isXPlayer) {
          const tweetPhoto = video.closest('[data-testid="tweetPhoto"]');
          if (tweetPhoto) {
            tweetPhoto.setAttribute('data-scrollveil-analyzed', 'safe');
            tweetPhoto.style.setProperty('filter', 'none', 'important');
          }
        }
        if (video._scrollveilEnforceBlur) {
          video._scrollveilEnforceBlur(); // Call unregister function
          delete video._scrollveilEnforceBlur;
        }

        markVideoSafe(video);

        // On X/YouTube: the platform may strip inline styles or re-render,
        // which lets the CSS shield re-blur. Register an enforcement tracker
        // to keep the video unblurred until re-blur is clicked.
        if (freshIsX || freshIsYT || isXPlayer) {
          const enforceUnblurFn = () => {
            if (video._scrollveilBlurred) {
              unregisterUnblurEnforce();
              return;
            }
            const f = window.getComputedStyle(video).filter;
            if (f && f !== 'none') {
              video.style.setProperty('filter', 'none', 'important');
              video.style.setProperty('-webkit-filter', 'none', 'important');
              video.setAttribute('data-scrollveil-analyzed', 'safe');
            }
          };
          const unregisterUnblurEnforce = registerEnforcementTracker(enforceUnblurFn);
          video._scrollveilEnforceUnblur = unregisterUnblurEnforce;
        }

        // Add floating re-blur badge: "score% | Reblur"
        const reblurHTML = getScoreBadgeHTML(result.score, 'reblur');
        const reblurButton = document.createElement('div');
        reblurButton.innerHTML = reblurHTML;

        // Add hover effect to the Reblur button on video re-blur badge
        var vidReblurBlurBtn = reblurButton.querySelector('.scrollveil-action-btn');
        if (vidReblurBlurBtn) {
          vidReblurBlurBtn.addEventListener('mouseenter', function () { vidReblurBlurBtn.style.color = '#fff'; });
          vidReblurBlurBtn.addEventListener('mouseleave', function () { vidReblurBlurBtn.style.color = '#aaa'; });
        }
        reblurButton.style.cssText = `
        position: fixed !important;
        cursor: pointer !important;
        z-index: 2147483640 !important;
        pointer-events: auto !important;
      `;
        document.body.appendChild(reblurButton);

        // Make dot+score on video re-blur badge light up separately
        var vidReblurScoreSpans = reblurButton.querySelectorAll('span');
        var vidReblurScoreSpan = null;
        var vidReblurDotSpan = null;
        for (var vrs = 0; vrs < vidReblurScoreSpans.length; vrs++) {
          if (vidReblurScoreSpans[vrs].style.fontWeight === 'bold') vidReblurScoreSpan = vidReblurScoreSpans[vrs];
          if (vidReblurScoreSpans[vrs].style.borderRadius === '50%') vidReblurDotSpan = vidReblurScoreSpans[vrs];
        }
        if (vidReblurDotSpan) { vidReblurDotSpan.style.pointerEvents = 'auto'; vidReblurDotSpan.style.cursor = 'pointer'; }
        if (vidReblurScoreSpan) { vidReblurScoreSpan.style.pointerEvents = 'auto'; vidReblurScoreSpan.style.cursor = 'pointer'; }
        var vidScoreHoverOn = function () {
          if (vidReblurDotSpan) vidReblurDotSpan.style.filter = 'brightness(1.5)';
          if (vidReblurScoreSpan) vidReblurScoreSpan.style.filter = 'brightness(1.5)';
        };
        var vidScoreHoverOff = function () {
          if (vidReblurDotSpan) vidReblurDotSpan.style.filter = '';
          if (vidReblurScoreSpan) vidReblurScoreSpan.style.filter = '';
        };
        if (vidReblurDotSpan) { vidReblurDotSpan.addEventListener('mouseenter', vidScoreHoverOn); vidReblurDotSpan.addEventListener('mouseleave', vidScoreHoverOff); }
        if (vidReblurScoreSpan) { vidReblurScoreSpan.addEventListener('mouseenter', vidScoreHoverOn); vidReblurScoreSpan.addEventListener('mouseleave', vidScoreHoverOff); }
        var vidScoreClick = function (e) { e.stopPropagation(); e.preventDefault(); showUnblurPopup(result, null, null); };
        if (vidReblurDotSpan) vidReblurDotSpan.addEventListener('click', vidScoreClick);
        if (vidReblurScoreSpan) vidReblurScoreSpan.addEventListener('click', vidScoreClick);

        // Position at top-center of the video
        const positionReblur = function () {
          const rect = trackTarget.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) {
            reblurButton.style.display = 'none';
            return;
          }
          reblurButton.style.display = 'block';
          reblurButton.style.top = (rect.top + 5) + 'px';
          reblurButton.style.left = (rect.left + (rect.width / 2) - (reblurButton.offsetWidth / 2)) + 'px';
        };
        positionReblur();
        const unregisterReblurPos = registerVisualTracker(positionReblur);
        reblurButton._scrollveilCleanup = function () {
          unregisterReblurPos();
          reblurButton.remove();
        };
        video._scrollveilFloatingReblur = reblurButton;
        if (useContainerBlur && xContainer) xContainer._scrollveilFloatingReblur = reblurButton;

        reblurButton.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();

          // Stop unblur enforcement before re-blurring
          if (video._scrollveilEnforceUnblur) {
            video._scrollveilEnforceUnblur();
            delete video._scrollveilEnforceUnblur;
          }

          // Re-apply blur — CONTAINER on X/YouTube, VIDEO on other sites
          if (useContainerBlur) {
            xContainer.style.setProperty('filter', `blur(${effectiveBlur}px)`, 'important');
            xContainer.style.setProperty('overflow', 'hidden', 'important');
            xContainer._scrollveilBlurred = true;
            // Keep data-scrollveil-analyzed="filtered" so CSS shield stays OFF
            // (only JS inline blur handles it — prevents double blur stacking)
            xContainer.setAttribute('data-scrollveil-analyzed', 'filtered');
            // On X: re-mark tweetPhoto as filtered too
            if (isXPlayer) {
              const tweetPhoto = video.closest('[data-testid="tweetPhoto"]');
              if (tweetPhoto) tweetPhoto.setAttribute('data-scrollveil-analyzed', 'filtered');
            }

            const reEnforceFn = () => {
              if (!xContainer._scrollveilBlurred) { unregisterReEnforce(); return; }
              const f = window.getComputedStyle(xContainer).filter;
              if (!f || f === 'none') {
                xContainer.style.setProperty('filter', `blur(${effectiveBlur}px)`, 'important');
              }
            };
            const unregisterReEnforce = registerEnforcementTracker(reEnforceFn);
            xContainer._scrollveilEnforceBlur = unregisterReEnforce;
            video._scrollveilEnforceBlur = unregisterReEnforce;
          } else {
            video.style.setProperty('filter', `blur(${effectiveBlur}px)`, 'important');
            video.style.setProperty('-webkit-filter', `blur(${effectiveBlur}px)`, 'important');
            video.style.setProperty('pointer-events', 'none', 'important');

            const reEnforceFn = () => {
              if (!video._scrollveilBlurred) { unregisterReEnforce(); return; }
              const f = window.getComputedStyle(video).filter;
              if (!f || f === 'none') {
                video.style.setProperty('filter', `blur(${effectiveBlur}px)`, 'important');
                video.style.setProperty('-webkit-filter', `blur(${effectiveBlur}px)`, 'important');
              }
            };
            const unregisterReEnforce = registerEnforcementTracker(reEnforceFn);
            video._scrollveilEnforceBlur = unregisterReEnforce;
          }
          video._scrollveilBlurred = true;
          // Keep "filtered" so CSS shield stays off — JS enforcement handles the blur
          video.setAttribute('data-scrollveil-analyzed', 'filtered');

          // Remove re-blur button
          if (reblurButton._scrollveilCleanup) {
            reblurButton._scrollveilCleanup();
          } else {
            reblurButton.remove();
          }
          delete video._scrollveilFloatingReblur;

          // Re-create the floating overlay
          const newOverlay = createFloatingOverlay(trackTarget, overlayHTML, 'transparent');
          newOverlay.addEventListener('click', unblurVideoHandler);
          video._scrollveilFloatingOverlay = newOverlay;

          console.log('ScrollVeil: Video re-blurred');
        });

        console.log('ScrollVeil: Video unblurred - use corner button to re-blur');
      }); // end showUnblurPopup
    };

    overlay.addEventListener('click', unblurVideoHandler);

    console.log('ScrollVeil: Video blurred - ' + result.reason + (isXPlayer ? ' (X player)' : ''));
  }


  // Function to scan all images on the page
  function scanImages() {
    if (!detector) {
      return;
    }

    const allImages = document.querySelectorAll('img');
    // On YouTube: filter out thumbnail imgs — setupYTThumbnail handles them
    const images = isOnYouTube
      ? Array.from(allImages).filter(img => !img.closest('yt-thumbnail-view-model'))
      : allImages;

    // Process images concurrently in batches of 5
    // This prevents blocking the main thread while still being faster than sequential
    const BATCH_SIZE = 5;
    let index = 0;

    function processBatch() {
      const batch = [];
      while (index < images.length && batch.length < BATCH_SIZE) {
        batch.push(processImage(images[index]));
        index++;
      }

      if (batch.length > 0) {
        Promise.all(batch).then(() => {
          if (index < images.length) {
            // Use requestAnimationFrame to yield to the browser between batches
            requestAnimationFrame(processBatch);
          }
        });
      }
    }

    processBatch();
  }

  // Function to scan all videos on the page
  function scanVideos() {
    if (!detector) {
      console.log('ScrollVeil: Detector not ready yet');
      return;
    }

    const videos = document.querySelectorAll('video');

    console.log('ScrollVeil: Found ' + videos.length + ' videos');

    videos.forEach(function (video) {
      // On YouTube: skip thumbnail hover preview videos
      if (isOnYouTube && video.closest('yt-thumbnail-view-model')) return;
      processVideo(video);
    });
  }

  // Watch for new images and videos added dynamically
  const observer = new MutationObserver(function (mutations) {
    if (!detector) return;

    const newImages = [];
    const newVideos = [];

    mutations.forEach(function (mutation) {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach(function (node) {
          if (node.nodeName === 'IMG') {
            newImages.push(node);
          } else if (node.nodeName === 'VIDEO') {
            newVideos.push(node);
          }
          if (node.querySelectorAll) {
            // On YouTube, directly set up any new thumbnail containers
            if (isOnYouTube) {
              node.querySelectorAll('yt-thumbnail-view-model').forEach(t => setupYTThumbnail(t));
              if (node.tagName && node.tagName.toLowerCase() === 'yt-thumbnail-view-model') {
                setupYTThumbnail(node);
              }
            }
            node.querySelectorAll('img').forEach(img => newImages.push(img));
            node.querySelectorAll('video').forEach(video => newVideos.push(video));
          }
        });
      } else if (mutation.type === 'attributes' && (mutation.attributeName === 'src' || mutation.attributeName === 'srcset' || mutation.attributeName === 'loading')) {
        const target = mutation.target;
        if (target.nodeName === 'IMG') {
          // On YouTube, src changes are normal (hover previews, lazy load).
          // The card-level CSS blur handles visibility. Just let processImage
          // pick it up if it hasn't been processed yet.
          if (isOnYouTube && target.closest('yt-thumbnail-view-model')) {
            // The per-thumbnail MutationObserver handles swaps. Just ensure
            // the thumbnail is set up and skip standard re-processing.
            const thumb = target.closest('yt-thumbnail-view-model');
            if (thumb && !ytObservedThumbs.has(thumb)) setupYTThumbnail(thumb);
            return;
          }
          // Image src changed (lazy loading, Google Images, etc.) — re-process it
          processedImages.delete(target);
          delete target.dataset.scrollveilProcessed;
          target.removeAttribute('data-scrollveil-analyzed');
          target.removeAttribute('data-scrollveil-skip');
          newImages.push(target);
        } else if (target.nodeName === 'VIDEO') {
          delete target.dataset.scrollveilProcessed;
          newVideos.push(target);
        }
      }
    });

    // Process all new images concurrently (they're already CSS-blurred)
    // On YouTube: filter out thumbnail imgs — setupYTThumbnail handles them exclusively
    if (newImages.length > 0) {
      newImages.forEach(img => {
        if (isOnYouTube && img.closest('yt-thumbnail-view-model')) return;
        processImage(img);
      });
    }

    // Process videos
    // On YouTube: filter out thumbnail hover preview videos — CSS container blur handles them
    newVideos.forEach(video => {
      if (isOnYouTube && video.closest('yt-thumbnail-view-model')) return;
      processVideo(video);
    });
  });

  // Start observing once detector is ready
  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'srcset', 'loading']
    });
    console.log('ScrollVeil: Monitoring for new images and videos');
  }

  // Helper: Find all videos including inside shadow DOM trees
  function findAllVideos(root) {
    const videos = Array.from(root.querySelectorAll('video'));
    // Also search inside shadow DOM hosts
    const allElements = root.querySelectorAll('*');
    for (const el of allElements) {
      if (el.shadowRoot) {
        videos.push(...findAllVideos(el.shadowRoot));
      }
    }
    return videos;
  }

  // Periodic re-scan to catch images/videos that might have been re-rendered by dynamic sites (Twitter, Google Images, etc.)
  // Runs every ~2s via the global enforcement scheduler (every 4th tick of the 500ms loop)
  let rescanTickCount = 0;
  registerEnforcementTracker(() => {
    rescanTickCount++;
    if (rescanTickCount < 4) return; // Only run every 4th tick (~2 seconds)
    rescanTickCount = 0;

    if (!detector) return;

    // Check for images that lost their scrollveil markers
    const allImages = document.querySelectorAll('img');
    allImages.forEach(img => {
      // On YouTube: route to thumbnail system (handles its own badge + cache)
      if (isOnYouTube && img.closest('yt-thumbnail-view-model')) {
        const thumb = img.closest('yt-thumbnail-view-model');
        if (thumb && !ytObservedThumbs.has(thumb)) {
          setupYTThumbnail(thumb);
        }
        processedImages.add(img);
        return;
      }
      if (!processedImages.has(img) && !img.dataset.scrollveilProcessed) {
        processImage(img);
      }
    });

    // Check for videos that lost their scrollveil markers (re-rendered by Twitter)
    const allVideos = findAllVideos(document);
    if (isOnXDomain && allVideos.length > 0) {
      console.log('ScrollVeil: Periodic scan found ' + allVideos.length + ' video(s) on X');
    }
    allVideos.forEach(video => {
      // Check WeakSet first (immune to React stripping data attributes), then data attribute
      if (!processedVideos.has(video) && !video.dataset.scrollveilProcessed) {
        // On X: skip if the container is already processed (React swapped the <video> but container is handled)
        if (isOnXDomain) {
          const { container } = getVideoContainer(video);
          if (container && container._scrollveilProcessed) {
            processedVideos.add(video); // Mark so we don't check again
            return;
          }
        }
        processVideo(video);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // SCROLL-TRIGGERED RESCAN — catches lazy-loaded content on
  // infinite-scroll sites like Instagram and Google Images faster
  // than the 2-second periodic rescan.
  // ═══════════════════════════════════════════════════════════════
  let scrollRescanTimer = null;
  window.addEventListener('scroll', () => {
    if (!detector || !scrollveilEnabled) return;
    // Debounce: run 300ms after scrolling stops
    if (scrollRescanTimer) clearTimeout(scrollRescanTimer);
    scrollRescanTimer = setTimeout(() => {
      const allImages = document.querySelectorAll('img');
      let newCount = 0;
      allImages.forEach(img => {
        if (isOnYouTube && img.closest('yt-thumbnail-view-model')) return;
        if (!processedImages.has(img) && !img.dataset.scrollveilProcessed) {
          newCount++;
          processImage(img);
        }
      });
      const allVideos = findAllVideos(document);
      allVideos.forEach(video => {
        if (isOnYouTube && video.closest('yt-thumbnail-view-model')) return;
        if (!processedVideos.has(video) && !video.dataset.scrollveilProcessed) {
          newCount++;
          processVideo(video);
        }
      });
      if (newCount > 0) {
        console.log('ScrollVeil: Scroll rescan found ' + newCount + ' new element(s)');
      }
    }, 300);
  }, { passive: true });

  console.log('ScrollVeil: Content script loaded');
