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

// ═══ Settings Module Reference ═══
// Settings, site detection, CSS blur shield, and live updates are handled by settings.js
// which loads BEFORE this file and exposes window.ScrollVeilSettings.
// Local aliases for readability and backward compatibility:
const isOnXDomain = ScrollVeilSettings.isOnXDomain;
const isOnYouTube = ScrollVeilSettings.isOnYouTube;

// ═══ YouTube Module Reference ═══
// YouTube thumbnail system is now in youtube.js (loaded before this file).
// Access via window.ScrollVeilYouTube.setupYTThumbnail() etc.
// Local aliases for backward compatibility:
const setupYTThumbnail = ScrollVeilYouTube.setupYTThumbnail;
const ytObservedThumbs = ScrollVeilYouTube.ytObservedThumbs;
const ytThumbCache = ScrollVeilYouTube.ytThumbCache;

// ═══ Unblur Popup Module Reference ═══
const showUnblurPopup = ScrollVeilPopup.showUnblurPopup;




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

// Video sampling settings — now managed by settings.js
// Access via ScrollVeilSettings.videoSampling
const VIDEO_SAMPLING_DEFAULTS = ScrollVeilSettings.videoSampling;

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
// blurStrength is now managed by settings.js — access via ScrollVeilSettings.blurStrength

// Function to wait for ScrollVeilDetector to be available
function waitForDetector(callback) {
  if (typeof ScrollVeilDetector !== 'undefined') {
    callback();
  } else {
    console.log('ScrollVeil: Waiting for detector class to load...');
    setTimeout(() => waitForDetector(callback), 50);
  }
}

// Initialize detector (settings are loaded by settings.js before this file runs)
waitForDetector(() => {
  detector = new ScrollVeilDetector();
  console.log('ScrollVeil: AI detector initialized');

  // Register dependencies with the YouTube module now that everything is defined
  ScrollVeilYouTube.registerDeps({
    detector: detector,
    processedImages: processedImages,
    processedVideos: processedVideos,
    showUnblurPopup: showUnblurPopup,
    scoreElementText: scoreElementText
  });

  scanImages();
  scanVideos();

  // On YouTube: directly set up all visible thumbnail containers
  if (isOnYouTube) {
    document.querySelectorAll('yt-thumbnail-view-model').forEach(t => setupYTThumbnail(t));
  }
});


// Settings change listener is now in settings.js — values update automatically
// via ScrollVeilSettings getters and the shared videoSampling object reference.

// updateExistingBlurs() is now in settings.js — called automatically on blur strength change


// ═══ Processing functions are in image-processor.js and video-processor.js ═══
// They load AFTER this file and reference the globals above.

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
    if (!detector || !ScrollVeilSettings.enabled) return;
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
