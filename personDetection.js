// ScrollVeil Person Detection Module (Content Script Side)
// Copyright © 2025 Michael Arold. All Rights Reserved.
//
// Sends image data to the offscreen document (via background service worker)
// where TF.js + COCO-SSD runs with proper CSP permissions.
//
// Rule: If no people are detected in an image, score = 0 (auto-safe).

console.log('🧠 ScrollVeil: Person Detection module loading...');

const ScrollVeilPersonDetector = (function() {

  // Extract pixel data from an image element using canvas
  function getImageData(imageElement) {
    try {
      const canvas = document.createElement('canvas');
      // Scale down for performance — 300x300 is what COCO-SSD uses internally
      const maxSize = 300;
      const scale = Math.min(maxSize / imageElement.naturalWidth, maxSize / imageElement.naturalHeight, 1);
      canvas.width = Math.round(imageElement.naturalWidth * scale);
      canvas.height = Math.round(imageElement.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(imageElement, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return {
        imageDataArray: Array.from(imageData.data), // Convert to regular array for messaging
        width: canvas.width,
        height: canvas.height
      };
    } catch (e) {
      // Canvas tainted by CORS
      console.log('❌ ScrollVeil: PersonDetection canvas tainted (CORS) for:', imageElement.src?.substring(0, 100), 'Error:', e.message);
      return null;
    }
  }

  // Fallback: fetch image via background script (bypasses CORS), then extract pixel data
  async function getImageDataViaBG(imageElement) {
    try {
      const src = imageElement.src;
      if (!src || src.startsWith('data:')) return null;

      console.log('🧠 ScrollVeil: PersonDetection CORS fallback — fetching via background:', src.substring(0, 80));

      // Ask background script to fetch the image (it has host_permissions)
      const response = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('BG fetch timeout')), 8000);
        chrome.runtime.sendMessage({ action: 'fetchImage', url: src }, (resp) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(resp);
        });
      });

      if (!response || !response.success || !response.dataUrl) {
        console.log('❌ ScrollVeil: PersonDetection BG fetch failed:', response?.error);
        return null;
      }

      // Load the data URL into an Image element (same-origin, no CORS issues)
      const img = new Image();
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('img load timeout')), 5000);
        img.onload = () => { clearTimeout(t); resolve(); };
        img.onerror = () => { clearTimeout(t); reject(new Error('img load error')); };
        img.src = response.dataUrl;
      });

      // Now extract pixel data — canvas won't be tainted
      const canvas = document.createElement('canvas');
      const maxSize = 300;
      const scale = Math.min(maxSize / img.naturalWidth, maxSize / img.naturalHeight, 1);
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      console.log('✅ ScrollVeil: PersonDetection CORS fallback succeeded —', canvas.width + 'x' + canvas.height);
      return {
        imageDataArray: Array.from(imageData.data),
        width: canvas.width,
        height: canvas.height
      };
    } catch (e) {
      console.log('❌ ScrollVeil: PersonDetection CORS fallback failed:', e.message);
      return null;
    }
  }

  // Detect people by sending image data to offscreen document via background
  async function detectPeople(imageElement) {
    try {
      let data = getImageData(imageElement);

      // CORS fallback: if canvas was tainted, fetch via background script
      if (!data) {
        data = await getImageDataViaBG(imageElement);
      }

      if (!data) {
        return { hasPeople: null, people: [], allDetections: [] };
      }

      const response = await chrome.runtime.sendMessage({
        action: 'detectPeople',
        imageDataArray: data.imageDataArray,
        width: data.width,
        height: data.height
      });

      return response || { hasPeople: null, people: [], allDetections: [] };
    } catch (error) {
      console.warn('⚠️ ScrollVeil: Person detection messaging failed:', error.message);
      return { hasPeople: null, people: [], allDetections: [] };
    }
  }

  return {
    detectPeople: detectPeople,
    isModelLoaded: () => true // Model loads in offscreen doc, we just send messages
  };
})();

console.log('🧠 ScrollVeil: Person Detection module ready (uses offscreen document)');
