// ScrollVeil Popup Settings
// Copyright © 2025 Michael Arold. All Rights Reserved.
//
// This software is proprietary and confidential. Unauthorized copying, modification,
// distribution, or use of this software, via any medium, is strictly prohibited.

// ═══ DEFAULT SETTINGS ═══
// Single source of truth for all defaults
const SCROLLVEIL_DEFAULTS = {
  blurStrength: 100,
  autoUnblurThreshold: 0,
  videoInterval: 3,
  videoDuration: 30,
  earlyExitThreshold: 75
};

document.addEventListener('DOMContentLoaded', function() {
  // ═══ Element References ═══
  const blurSlider = document.getElementById('blurStrength');
  const blurValueSpan = document.getElementById('blurValue');
  const autoSlider = document.getElementById('autoUnblurSlider');
  const autoValueSpan = document.getElementById('autoValue');
  const saveBtn = document.getElementById('saveBtn');
  const restoreBtn = document.getElementById('restoreBtn');
  const videoIntervalSelect = document.getElementById('videoInterval');
  const videoDurationSelect = document.getElementById('videoDuration');
  const earlyExitSlider = document.getElementById('earlyExitSlider');
  const earlyExitValueSpan = document.getElementById('earlyExitValue');
  const statusToggle = document.getElementById('statusToggle');
  const statusIcon = document.getElementById('statusIcon');
  const statusText = document.getElementById('statusText');

  // Report elements
  const reportToggleBtn = document.getElementById('reportToggleBtn');
  const reportForm = document.getElementById('reportForm');
  const reportCancelBtn = document.getElementById('reportCancelBtn');
  const reportSendBtn = document.getElementById('reportSendBtn');
  const reportUrl = document.getElementById('reportUrl');
  const reportDescription = document.getElementById('reportDescription');
  const reportDetails = document.getElementById('reportDetails');
  const reportTypeBtns = document.querySelectorAll('.report-type-btn');

  let selectedReportType = 'false-positive';

  // ═══ VIDEO ANALYSIS COLLAPSIBLE TOGGLE ═══
  const videoToggle = document.getElementById('videoToggle');
  const videoArrow = document.getElementById('videoArrow');
  const videoContent = document.getElementById('videoContent');
  if (videoToggle) {
    videoToggle.addEventListener('click', function() {
      videoContent.classList.toggle('open');
      videoArrow.classList.toggle('open');
    });
  }

  // ═══ PROTECTION TOGGLE (storage flag + tab reload) ═══
  function updateToggleUI(enabled) {
    if (enabled) {
      statusToggle.classList.remove('disabled');
      statusIcon.textContent = '✓';
      statusText.textContent = 'Protection Active';
    } else {
      statusToggle.classList.add('disabled');
      statusIcon.textContent = '✗';
      statusText.textContent = 'Protection Disabled';
    }
  }

  // Load initial enabled state
  chrome.storage.sync.get(['scrollveilEnabled'], (result) => {
    const enabled = result.scrollveilEnabled !== false;
    updateToggleUI(enabled);
  });

  // Toggle on click — flips the flag and reloads the active tab
  statusToggle.addEventListener('click', function() {
    chrome.storage.sync.get(['scrollveilEnabled'], (result) => {
      const currentlyEnabled = result.scrollveilEnabled !== false;
      const newEnabled = !currentlyEnabled;
      chrome.storage.sync.set({ scrollveilEnabled: newEnabled }, () => {
        updateToggleUI(newEnabled);
        // Reload the active tab so the content script starts fresh
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]?.id) chrome.tabs.reload(tabs[0].id);
        });
      });
    });
  });

  // ═══ HELPER: Apply settings to UI ═══
  function applySettingsToUI(settings) {
    blurSlider.value = settings.blurStrength;
    blurValueSpan.textContent = settings.blurStrength + 'px';

    autoSlider.value = settings.autoUnblurThreshold;
    autoValueSpan.textContent = settings.autoUnblurThreshold + '%';

    videoIntervalSelect.value = settings.videoInterval;
    videoDurationSelect.value = settings.videoDuration;

    earlyExitSlider.value = settings.earlyExitThreshold;
    earlyExitValueSpan.textContent = settings.earlyExitThreshold + '%';
  }

  // ═══ LOAD SAVED SETTINGS ═══
  chrome.storage.sync.get(
    ['blurStrength', 'autoUnblurThreshold', 'autoUnblur', 'videoInterval', 'videoDuration', 'earlyExitThreshold'],
    (result) => {
      // Build merged settings: saved values override defaults
      const settings = { ...SCROLLVEIL_DEFAULTS };

      if (result.blurStrength !== undefined) settings.blurStrength = result.blurStrength;

      // Auto-unblur: handle migration from old boolean
      if (result.autoUnblurThreshold !== undefined) {
        settings.autoUnblurThreshold = result.autoUnblurThreshold;
      } else if (result.autoUnblur !== undefined) {
        // One-time migration from old checkbox
        settings.autoUnblurThreshold = result.autoUnblur ? 20 : 0;
        chrome.storage.sync.set({ autoUnblurThreshold: settings.autoUnblurThreshold }, () => {
          console.log('ScrollVeil: Migrated old auto-unblur to threshold ' + settings.autoUnblurThreshold + '%');
        });
      }

      if (result.videoInterval !== undefined) settings.videoInterval = result.videoInterval;
      if (result.videoDuration !== undefined) settings.videoDuration = result.videoDuration;
      if (result.earlyExitThreshold !== undefined) settings.earlyExitThreshold = result.earlyExitThreshold;

      applySettingsToUI(settings);
    }
  );

  // ═══ LIVE SLIDER UPDATES ═══
  blurSlider.addEventListener('input', function() {
    blurValueSpan.textContent = this.value + 'px';
  });
  autoSlider.addEventListener('input', () => {
    autoValueSpan.textContent = autoSlider.value + '%';
  });
  earlyExitSlider.addEventListener('input', () => {
    earlyExitValueSpan.textContent = earlyExitSlider.value + '%';
  });

  // ═══ SAVE BUTTON ═══
  saveBtn.addEventListener('click', function() {
    chrome.storage.sync.set({
      blurStrength: parseInt(blurSlider.value),
      autoUnblurThreshold: parseInt(autoSlider.value),
      videoInterval: parseInt(videoIntervalSelect.value),
      videoDuration: parseInt(videoDurationSelect.value),
      earlyExitThreshold: parseInt(earlyExitSlider.value)
    }, function() {
      saveBtn.textContent = '✓ Saved!';
      saveBtn.style.background = '#66BB6A';
      setTimeout(() => {
        saveBtn.textContent = 'Save Settings';
        saveBtn.style.background = '';
      }, 1500);
    });
  });

  // ═══ RESTORE DEFAULTS ═══
  restoreBtn.addEventListener('click', function() {
    // Apply defaults to UI immediately
    applySettingsToUI(SCROLLVEIL_DEFAULTS);

    // Save defaults to storage
    chrome.storage.sync.set(SCROLLVEIL_DEFAULTS, function() {
      restoreBtn.textContent = '✓ Defaults Restored!';
      setTimeout(() => {
        restoreBtn.textContent = 'Restore Defaults';
      }, 1500);
    });
  });

  // ═══ REPORT BUG FEATURE ═══

  // Toggle report form open/closed
  reportToggleBtn.addEventListener('click', function() {
    const isOpen = reportForm.classList.toggle('open');
    if (isOpen) {
      // Auto-fill the current tab's URL
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          reportUrl.value = tabs[0].url || '';
        }
      });
      // Try to get detection details from the content script
      fetchDetectionDetails();
    }
  });

  // Report type selection
  reportTypeBtns.forEach(btn => {
    btn.addEventListener('click', function() {
      reportTypeBtns.forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      selectedReportType = this.dataset.type;
    });
  });

  // Cancel report
  reportCancelBtn.addEventListener('click', function() {
    reportForm.classList.remove('open');
    reportDescription.value = '';
  });

  // Fetch detection details from the active tab's content script
  function fetchDetectionDetails() {
    reportDetails.value = 'Gathering detection info...';
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) {
        reportDetails.value = 'Could not access tab.';
        return;
      }
      chrome.tabs.sendMessage(tabs[0].id, { action: 'getDetectionReport' }, (response) => {
        if (chrome.runtime.lastError) {
          reportDetails.value = 'ScrollVeil not active on this page.';
          return;
        }
        if (response && response.report) {
          reportDetails.value = response.report;
        } else {
          reportDetails.value = 'No detection data available for this page.';
        }
      });
    });
  }

  // Send report via mailto
  reportSendBtn.addEventListener('click', function() {
    const reportType = selectedReportType;
    const url = reportUrl.value || '(no URL)';
    const description = reportDescription.value || '(no description)';
    const details = reportDetails.value || '(no detection data)';

    // Build Google Form pre-fill URL
    const reportTypeMap = {
      'false-positive': 'False Positive (safe image marked unsafe)',
      'false-negative': 'False Negative (unsafe image marked safe)',
      'bug': 'Bug'
    };
    const reportTypeValue = reportTypeMap[reportType] || 'Bug';

    // Append environment info to detection details
    const fullDetails = details + '\n\n--- Environment ---\nVersion: 1.0\nBrowser: ' + navigator.userAgent + '\nTimestamp: ' + new Date().toISOString();

    const formUrl = 'https://docs.google.com/forms/d/e/1FAIpQLScR4sdZTa4ohj7Q4af2altwK_LvvMme9kLhWgoSHwojS2sMnQ/viewform'
      + '?usp=pp_url'
      + '&entry.968642065=' + encodeURIComponent(reportTypeValue)
      + '&entry.1045665563=' + encodeURIComponent(url)
      + '&entry.679210149=' + encodeURIComponent(fullDetails);

    chrome.tabs.create({ url: formUrl });

    // Feedback
    reportSendBtn.textContent = '✓ Opening form...';
    setTimeout(() => {
      reportForm.classList.remove('open');
      reportDescription.value = '';
      reportSendBtn.textContent = 'Send Report';
    }, 1500);
  });
});
