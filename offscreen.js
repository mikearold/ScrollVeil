// ScrollVeil Offscreen Document
// Bridges chrome.runtime messaging (content scripts) ↔ sandbox postMessage (TF.js)
// NO eval, NO inline scripts — strict MV3 CSP compliant

const sandbox = document.getElementById('sandbox');
const pendingRequests = new Map();
let requestCounter = 0;

// Listen for results from the sandbox iframe
window.addEventListener('message', function(event) {
  if (!event.data) return;

  if (event.data.type === 'modelLoaded') {
    console.log('🧠 ScrollVeil Offscreen: Model loaded:', event.data.success);
    return;
  }

  if (event.data.type === 'poseModelReady') {
    console.log('🧠 ScrollVeil Offscreen: BlazePose model ready');
    return;
  }

  if (event.data.type === 'mobilenetModelReady') {
    console.log('🧠 ScrollVeil Offscreen: MobileNet model ready');
    return;
  }

  if (event.data.type === 'detectResult') {
    const callback = pendingRequests.get(event.data.requestId);
    if (callback) {
      pendingRequests.delete(event.data.requestId);
      callback({
        hasPeople: event.data.hasPeople,
        people: event.data.people,
        allDetections: event.data.allDetections,
        faces: event.data.faces || [],
        pose: event.data.pose || null,
        clothing: event.data.clothing || []
      });
    }
    return;
  }
});

// Listen for detection requests from content scripts via chrome.runtime
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action !== 'detectPeople') return false;

  const requestId = ++requestCounter;
  pendingRequests.set(requestId, sendResponse);

  // Forward to sandbox iframe via postMessage
  sandbox.contentWindow.postMessage({
    type: 'detectPeople',
    requestId: requestId,
    imageDataArray: message.imageDataArray,
    width: message.width,
    height: message.height
  }, '*');

  return true; // Keep channel open for async response
});
