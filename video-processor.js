// ScrollVeil Video Processor Module
// Copyright © 2025 Michael Arold. All Rights Reserved.
//
// This software is proprietary and confidential. Unauthorized copying, modification,
// distribution, or use of this software, via any medium, is strictly prohibited.
//
// Video analysis, frame sampling, blurring, floating overlays, and badge display.
// Loaded AFTER content.js — references globals defined there.

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
          const effectiveBlur = ScrollVeilSettings.blurStrength;
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
    if (!ScrollVeilSettings.enabled) return;
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
    const effectiveBlur = ScrollVeilSettings.blurStrength;
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
    const effectiveBlur = ScrollVeilSettings.blurStrength; // Minimum 30px so blur is always visible
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

console.log('ScrollVeil: Video processor module loaded');
