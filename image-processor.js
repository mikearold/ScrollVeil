// ScrollVeil Image Processor Module
// Copyright © 2025 Michael Arold. All Rights Reserved.
//
// This software is proprietary and confidential. Unauthorized copying, modification,
// distribution, or use of this software, via any medium, is strictly prohibited.
//
// Image analysis, blurring, badge display, and safe-marking logic.
// Loaded AFTER content.js — references globals defined there.

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


// showUnblurPopup alias is defined in content.js (loaded before this file)

function getScoreColor(score) {
  if (score < 20) return '#4CAF50';       // green
  if (score < 40) return '#FFC107';       // yellow
  if (score < 60) return '#FF9800';       // orange
  if (score < 80) return '#F44336';       // red
  return '#212121';                        // black/dark
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
    if (!ScrollVeilSettings.enabled) return;
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
        earlyContainer.style.setProperty('filter', `blur(${ScrollVeilSettings.blurStrength}px)`, 'important');
        earlyContainer.style.setProperty('-webkit-filter', `blur(${ScrollVeilSettings.blurStrength}px)`, 'important');
        earlyContainer._scrollveilBlurred = true;
      }
    } else {
      img.style.setProperty('filter', `blur(${ScrollVeilSettings.blurStrength}px)`, 'important');
      img.style.setProperty('-webkit-filter', `blur(${ScrollVeilSettings.blurStrength}px)`, 'important');
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
      xImageContainer.style.setProperty('filter', `blur(${ScrollVeilSettings.blurStrength}px)`, 'important');
      xImageContainer.style.setProperty('-webkit-filter', `blur(${ScrollVeilSettings.blurStrength}px)`, 'important');
      xImageContainer._scrollveilBlurred = true;
      console.log('ScrollVeil: blurImage() X CONTAINER blur applied to tweetPhoto');
    } else {
      // All other sites: blur the image element directly
      img.style.setProperty('filter', `blur(${ScrollVeilSettings.blurStrength}px)`, 'important');
      img.style.setProperty('-webkit-filter', `blur(${ScrollVeilSettings.blurStrength}px)`, 'important');
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
        const reblurBadgeHTML = getScoreBadgeHTML((typeof result.displayScore === 'number' ? result.displayScore : result.score), 'reblur');
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
            xImageContainer.style.setProperty('filter', `blur(${ScrollVeilSettings.blurStrength}px)`, 'important');
            xImageContainer.style.setProperty('-webkit-filter', `blur(${ScrollVeilSettings.blurStrength}px)`, 'important');
            xImageContainer._scrollveilBlurred = true;
          } else {
            img.style.setProperty('filter', `blur(${ScrollVeilSettings.blurStrength}px)`, 'important');
            img.style.setProperty('-webkit-filter', `blur(${ScrollVeilSettings.blurStrength}px)`, 'important');
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

console.log('ScrollVeil: Image processor module loaded');
