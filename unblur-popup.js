// ScrollVeil Unblur Popup Module
// Copyright © 2025 Michael Arold. All Rights Reserved.
//
// This software is proprietary and confidential. Unauthorized copying, modification,
// distribution, or use of this software, via any medium, is strictly prohibited.
//
// Handles the reveal confirmation popup, human-readable reason translation,
// and scene summary generation. Loaded BEFORE content.js.
// Exposes window.ScrollVeilPopup for content.js and youtube.js to call showUnblurPopup().

(function () {
  'use strict';

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
      'background:rgba(0,0,0,0.6); z-index:2147483647; ' +
      'font-family:Arial,Helvetica,sans-serif;';
  
    // Create popup — positioned in center initially, freely moveable
    var popup = document.createElement('div');
    popup.style.cssText = 'background:#1a1a2e; border-radius:12px; padding:0; width:320px; ' +
      'min-width:260px; max-width:90vw; min-height:180px; ' +
      'box-shadow:0 8px 32px rgba(0,0,0,0.5); overflow:hidden; ' +
      'position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); ' +
      'z-index:2147483648; resize:both;';
  
    // Header — doubled as drag handle
    var svLogo = 'data:image/png;base64,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';
    var header = '<div class="scrollveil-popup-header" style="display:flex; justify-content:space-between; align-items:center; ' +
      'padding:14px 18px; border-bottom:1px solid rgba(255,255,255,0.08); ' +
      'cursor:grab; user-select:none;">' +
      '<span style="display:flex; align-items:center; gap:8px; color:#fff; font-size:14px; font-weight:600;">' +
      '<img src="' + svLogo + '" style="width:22px; height:22px; border-radius:4px;" alt="ScrollVeil">' +
      'ScrollVeil <span style="color:#555; font-size:11px; font-weight:400; margin-left:2px;">drag to move</span></span>' +
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
  
    // ── Drag to move ──────────────────────────────────────────────
    var dragHandle = popup.querySelector('.scrollveil-popup-header');
    var isDragging = false;
    var dragOffsetX = 0, dragOffsetY = 0;
  
    dragHandle.addEventListener('mousedown', function (e) {
      if (e.target.classList.contains('scrollveil-popup-close')) return;
      isDragging = true;
      // Convert from transform-centered to fixed top/left positioning
      var rect = popup.getBoundingClientRect();
      popup.style.transform = 'none';
      popup.style.top = rect.top + 'px';
      popup.style.left = rect.left + 'px';
      dragOffsetX = e.clientX - rect.left;
      dragOffsetY = e.clientY - rect.top;
      dragHandle.style.cursor = 'grabbing';
      e.preventDefault();
    });
  
    document.addEventListener('mousemove', function (e) {
      if (!isDragging) return;
      var newLeft = e.clientX - dragOffsetX;
      var newTop = e.clientY - dragOffsetY;
      // Keep popup within viewport
      newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - popup.offsetWidth));
      newTop = Math.max(0, Math.min(newTop, window.innerHeight - popup.offsetHeight));
      popup.style.left = newLeft + 'px';
      popup.style.top = newTop + 'px';
    });
  
    document.addEventListener('mouseup', function () {
      if (isDragging) {
        isDragging = false;
        dragHandle.style.cursor = 'grab';
      }
    });
    // ─────────────────────────────────────────────────────────────
  
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
  
    // Click backdrop to close (only if not dragging)
    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop && !isDragging) closePopup();
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

  // ═══ Public API ═══
  window.ScrollVeilPopup = {
    showUnblurPopup: showUnblurPopup,
    getHumanReadableReasons: getHumanReadableReasons,
    getSceneSummary: getSceneSummary
  };

  console.log('ScrollVeil: Unblur popup module loaded');
})();
