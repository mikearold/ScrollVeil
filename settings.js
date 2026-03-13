// ScrollVeil Settings Module
// Copyright © 2025 Michael Arold. All Rights Reserved.
//
// This software is proprietary and confidential. Unauthorized copying, modification,
// distribution, or use of this software, via any medium, is strictly prohibited.
//
// Centralizes all user settings, site detection, and the CSS blur shield.
// Loaded BEFORE content.js — exposes everything on window.ScrollVeilSettings.

(function () {
  'use strict';

  // ═══ Site Detection ═══
  const isOnXDomain = ['x.com', 'twitter.com', 'mobile.twitter.com', 'mobile.x.com']
    .includes(window.location.hostname);

  const isOnYouTube = ['www.youtube.com', 'youtube.com', 'm.youtube.com']
    .includes(window.location.hostname);

  // ═══ Setting Defaults ═══
  let enabled = true;
  let blurStrength = 100;
  let autoUnblurThreshold = 0;

  let videoSampling = {
    intervalSeconds: 3,
    durationSeconds: 30,
    earlyExitThreshold: 75
  };

  // ═══ CSS Blur Shield ═══
  // Injects the master CSS that blurs everything by default until analyzed.
  function injectBlurCSS() {
    const style = document.createElement('style');
    style.id = 'scrollveil-blur-shield';

    style.textContent = `
      :root { --scrollveil-blur: 30px; }
      img:not([data-scrollveil-analyzed]):not([data-scrollveil-skip]) {
        filter: blur(var(--scrollveil-blur)) !important;
        -webkit-filter: blur(var(--scrollveil-blur)) !important;
      }
      yt-thumbnail-view-model:not([data-scrollveil-revealed]) img,
      yt-thumbnail-view-model:not([data-scrollveil-revealed]) img:not([data-scrollveil-analyzed]):not([data-scrollveil-skip]),
      yt-thumbnail-view-model:not([data-scrollveil-revealed]) video,
      yt-thumbnail-view-model[data-scrollveil-revealed] img,
      yt-thumbnail-view-model[data-scrollveil-revealed] img:not([data-scrollveil-analyzed]):not([data-scrollveil-skip]),
      yt-thumbnail-view-model[data-scrollveil-revealed] video {
        filter: none !important;
        -webkit-filter: none !important;
      }
      yt-thumbnail-view-model:not([data-scrollveil-revealed]) {
        filter: blur(var(--scrollveil-blur)) !important;
        -webkit-filter: blur(var(--scrollveil-blur)) !important;
        overflow: hidden !important;
      }
      [data-testid="tweetPhoto"]:not([data-scrollveil-analyzed]) {
        filter: blur(var(--scrollveil-blur)) !important;
        -webkit-filter: blur(var(--scrollveil-blur)) !important;
      }
      [data-testid="videoPlayer"]:not([data-scrollveil-analyzed]) {
        filter: blur(var(--scrollveil-blur)) !important;
        -webkit-filter: blur(var(--scrollveil-blur)) !important;
      }
      ytd-video-preview:not([data-scrollveil-revealed]) {
        filter: blur(var(--scrollveil-blur)) !important;
        -webkit-filter: blur(var(--scrollveil-blur)) !important;
      }
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

  // ═══ Update Existing Blurs ═══
  // When user changes blur strength, update all currently-blurred elements.
  function updateExistingBlurs() {
    const blurredImages = document.querySelectorAll('img[data-scrollveil-blurred="true"]');
    blurredImages.forEach(img => {
      img.style.filter = `blur(${blurStrength}px)`;
      img.style.webkitFilter = `blur(${blurStrength}px)`;
    });

    const blurredVideos = document.querySelectorAll('video[data-scrollveil-blurred="true"]');
    blurredVideos.forEach(video => {
      video.style.filter = `blur(${blurStrength}px)`;
      video.style.webkitFilter = `blur(${blurStrength}px)`;
    });

    console.log('ScrollVeil: Updated ' + (blurredImages.length + blurredVideos.length) + ' blurred items');
  }

  // ═══ Load Enable/Disable State ═══
  // Must happen FIRST — controls whether blur shield is even injected.
  chrome.storage.sync.get(['scrollveilEnabled'], (result) => {
    if (result.scrollveilEnabled === false) {
      enabled = false;
      document.documentElement.style.setProperty('--scrollveil-blur', '0px');
      console.log('⏸️ ScrollVeil: Protection is DISABLED — skipping all processing');
      return; // Don't inject dynamic CSS
    }
    // Enabled — inject the blur shield
    injectBlurCSS();
  });

  // ═══ Load Main Settings ═══
  chrome.storage.sync.get(['blurStrength', 'autoUnblurThreshold', 'autoUnblur'], function (result) {
    if (result.blurStrength) {
      blurStrength = result.blurStrength;
    }
    // Update CSS variable (only if enabled — disabled keeps it at 0px)
    if (enabled) {
      document.documentElement.style.setProperty('--scrollveil-blur', blurStrength + 'px');
    }

    // Safe default for auto-unblur threshold
    autoUnblurThreshold = result.autoUnblurThreshold ?? 0;
    window._scrollveilAutoUnblurThreshold = autoUnblurThreshold;

    // One-time migration from old boolean (only runs if needed)
    if (result.autoUnblur !== undefined && result.autoUnblurThreshold === undefined) {
      const migratedThreshold = result.autoUnblur ? 20 : 0;
      autoUnblurThreshold = migratedThreshold;
      window._scrollveilAutoUnblurThreshold = migratedThreshold;

      chrome.storage.sync.set({ autoUnblurThreshold: migratedThreshold }, () => {
        console.log('ScrollVeil: Migrated old auto-unblur setting to threshold ' + migratedThreshold + '%');
      });
    }

    console.log('ScrollVeil: Blur strength set to ' + blurStrength + 'px');
    console.log('ScrollVeil: Auto-unblur threshold: ' + autoUnblurThreshold + '%');
  });

  // ═══ Load Video Sampling Settings ═══
  chrome.storage.sync.get(['videoInterval', 'videoDuration', 'earlyExitThreshold'], function (vs) {
    if (vs.videoInterval !== undefined)      videoSampling.intervalSeconds    = vs.videoInterval;
    if (vs.videoDuration !== undefined)      videoSampling.durationSeconds    = vs.videoDuration;
    if (vs.earlyExitThreshold !== undefined) videoSampling.earlyExitThreshold = vs.earlyExitThreshold;
    console.log('ScrollVeil: Video sampling settings loaded — interval: ' + videoSampling.intervalSeconds + 's, duration: ' + videoSampling.durationSeconds + 's, early exit: ' + videoSampling.earlyExitThreshold + '%');
  });

  // ═══ Listen for Live Setting Changes ═══
  chrome.storage.onChanged.addListener(function (changes, namespace) {
    if (namespace === 'sync') {
      if (changes.blurStrength) {
        const oldBlur = blurStrength;
        blurStrength = changes.blurStrength.newValue;
        // Update the CSS variable so the blur shield matches the new strength
        document.documentElement.style.setProperty('--scrollveil-blur', blurStrength + 'px');
        console.log('ScrollVeil: Blur strength updated from ' + oldBlur + 'px to ' + blurStrength + 'px');
        updateExistingBlurs();
      }

      if (changes.autoUnblurThreshold) {
        autoUnblurThreshold = changes.autoUnblurThreshold.newValue ?? 0;
        window._scrollveilAutoUnblurThreshold = autoUnblurThreshold;
        console.log('ScrollVeil: Auto-unblur threshold updated to ' + autoUnblurThreshold + '%');
      }

      if (changes.videoInterval) {
        videoSampling.intervalSeconds = changes.videoInterval.newValue;
        console.log('ScrollVeil: Video interval updated to ' + videoSampling.intervalSeconds + 's');
      }
      if (changes.videoDuration) {
        videoSampling.durationSeconds = changes.videoDuration.newValue;
        console.log('ScrollVeil: Video duration updated to ' + videoSampling.durationSeconds + 's');
      }
      if (changes.earlyExitThreshold) {
        videoSampling.earlyExitThreshold = changes.earlyExitThreshold.newValue;
        console.log('ScrollVeil: Video early exit updated to ' + videoSampling.earlyExitThreshold + '%');
      }

      // Notify content.js about enable/disable changes
      if (changes.scrollveilEnabled) {
        enabled = changes.scrollveilEnabled.newValue !== false;
        if (!enabled) {
          document.documentElement.style.setProperty('--scrollveil-blur', '0px');
        } else {
          document.documentElement.style.setProperty('--scrollveil-blur', blurStrength + 'px');
        }
        console.log('ScrollVeil: Protection ' + (enabled ? 'ENABLED' : 'DISABLED'));
      }
    }
  });

  // ═══ Public API — exposed on window.ScrollVeilSettings ═══
  // content.js and other modules read from this object.
  // Values are live — they update automatically when settings change.
  window.ScrollVeilSettings = {
    get enabled()            { return enabled; },
    get blurStrength()       { return blurStrength; },
    get autoUnblurThreshold(){ return autoUnblurThreshold; },
    get videoSampling()      { return videoSampling; },
    get isOnXDomain()        { return isOnXDomain; },
    get isOnYouTube()        { return isOnYouTube; },
    updateExistingBlurs: updateExistingBlurs
  };

  console.log('ScrollVeil: Settings module loaded');
})();
