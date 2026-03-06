// ScrollVeil Background Service Worker
// Copyright © 2025 Michael Arold. All Rights Reserved.
//
// This software is proprietary and confidential. Unauthorized copying, modification,
// distribution, or use of this software, via any medium, is strictly prohibited.

console.log('ScrollVeil: Background service worker loaded');

// ═══════════════════════════════════════════════════════════════
// OFFSCREEN DOCUMENT — runs TF.js for person detection
// ═══════════════════════════════════════════════════════════════
let offscreenCreated = false;

async function ensureOffscreen() {
  if (offscreenCreated) return;
  try {
    const existing = await chrome.offscreen.hasDocument();
    if (existing) { offscreenCreated = true; return; }
  } catch (e) { /* hasDocument not supported in older Chrome, try creating */ }
  
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DOM_PARSER'],
      justification: 'Run TensorFlow.js person detection for content filtering'
    });
    offscreenCreated = true;
    console.log('✅ ScrollVeil: Offscreen document created for person detection');
  } catch (error) {
    console.warn('⚠️ ScrollVeil: Failed to create offscreen document:', error.message);
  }
}

// Create offscreen document on startup
ensureOffscreen();

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Security: Only accept messages from our own extension's content scripts
  if (!sender.id || sender.id !== chrome.runtime.id) {
    console.warn('ScrollVeil: Rejected message from unauthorized sender:', sender.id);
    sendResponse({ success: false, error: 'Unauthorized sender' });
    return true;
  }

  if (request.action === 'detectPeople') {
    // Ensure offscreen document exists, then let it handle the message
    // We return false so the offscreen document's listener can respond
    ensureOffscreen();
    return false;
  }

  if (request.action === 'fetchImage') {
    // Fetch image using background script privileges (bypasses CORS)
    console.log('🔍 ScrollVeil BG: fetchImage request received for:', request.url?.substring(0, 100));
    fetch(request.url)
      .then(response => {
        if (!response.ok) {
          throw new Error(`Fetch failed: ${response.status}`);
        }
        return response.blob();
      })
      .then(blob => {
        // Convert blob to base64 data URL
        const reader = new FileReader();
        reader.onloadend = () => {
          console.log('✅ ScrollVeil BG: fetchImage SUCCESS — blob size:', blob.size, 'type:', blob.type);
          sendResponse({
            success: true,
            dataUrl: reader.result,
            size: blob.size,
            type: blob.type
          });
        };
        reader.onerror = () => {
          sendResponse({
            success: false,
            error: 'Failed to read blob'
          });
        };
        reader.readAsDataURL(blob);
      })
      .catch(error => {
        console.log('❌ ScrollVeil BG: fetchImage FAILED:', error.message, 'URL:', request.url?.substring(0, 100));
        sendResponse({
          success: false,
          error: error.message
        });
      });

    // Return true to indicate we'll send response asynchronously
    return true;
  }
});
