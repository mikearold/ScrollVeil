// ScrollVeil Sandbox — Person Detection + Face Detection + Pose Detection + Clothing Classification with TF.js
// This runs in a SANDBOXED page where eval() is permitted (required by TF.js)
// No chrome.* API access. Communicates via postMessage only.

let cocoModel = null;
let cocoModelPromise = null; // Shared promise so all callers wait for the same load
let faceModel = null;
let faceModelPromise = null; // Shared promise so all callers wait for the same load
let poseDetector = null;
let poseDetectorPromise = null; // Shared promise so all callers wait for the same load
let mobilenetModel = null;
let mobilenetModelPromise = null; // Shared promise so all callers wait for the same load

async function loadCocoModel() {
  if (cocoModel) return cocoModel;
  if (cocoModelPromise) return cocoModelPromise; // Wait for in-progress load instead of returning null
  cocoModelPromise = (async () => {
    try {
      cocoModel = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
      console.log('ScrollVeil Sandbox: COCO-SSD model loaded');
      return cocoModel;
    } catch (error) {
      console.error('ScrollVeil Sandbox: COCO-SSD load error:', error.message);
      return null;
    } finally {
      cocoModelPromise = null;
    }
  })();
  return cocoModelPromise;
}

async function loadFaceModel() {
  if (faceModel) return faceModel;
  if (faceModelPromise) return faceModelPromise;
  faceModelPromise = (async () => {
    try {
      faceModel = await blazeface.load();
      console.log('ScrollVeil Sandbox: BlazeFace model loaded');
      return faceModel;
    } catch (error) {
      console.error('ScrollVeil Sandbox: BlazeFace load error:', error.message);
      return null;
    } finally {
      faceModelPromise = null;
    }
  })();
  return faceModelPromise;
}

async function loadPoseDetector() {
  if (poseDetector) return poseDetector;
  if (poseDetectorPromise) return poseDetectorPromise;
  poseDetectorPromise = (async () => {
    try {
      poseDetector = await poseDetection.createDetector(
        poseDetection.SupportedModels.BlazePose,
        {
          runtime: 'tfjs',
          modelType: 'lite',
          enableSmoothing: false  // Static images, no temporal smoothing needed
        }
      );
      console.log('ScrollVeil Sandbox: BlazePose pose detector loaded');
      return poseDetector;
    } catch (error) {
      console.error('ScrollVeil Sandbox: BlazePose load error:', error.message);
      return null;
    } finally {
      poseDetectorPromise = null;
    }
  })();
  return poseDetectorPromise;
}

async function loadMobilenet() {
  if (mobilenetModel) return mobilenetModel;
  if (mobilenetModelPromise) return mobilenetModelPromise;
  mobilenetModelPromise = (async () => {
    try {
      // MobileNet V2, alpha 1.0 — best accuracy, ~7MB model weights
      // Weights are downloaded from tfhub.dev on first load, then cached by browser
      mobilenetModel = await mobilenet.load({ version: 2, alpha: 1.0 });
      console.log('ScrollVeil Sandbox: MobileNet model loaded');
      return mobilenetModel;
    } catch (error) {
      console.error('ScrollVeil Sandbox: MobileNet load error:', error.message);
      return null;
    } finally {
      mobilenetModelPromise = null;
    }
  })();
  return mobilenetModelPromise;
}

async function loadModels() {
  // Load COCO-SSD and BlazeFace in parallel (fast, critical models)
  // Load BlazePose separately — it's larger and optional
  var results = await Promise.all([loadCocoModel(), loadFaceModel()]);
  var cocoReady = !!results[0];
  var faceReady = !!results[1];

  // Start loading pose detector in background (don't block initial readiness)
  loadPoseDetector().then(function(detector) {
    if (detector) {
      console.log('ScrollVeil Sandbox: BlazePose ready (loaded in background)');
      window.parent.postMessage({
        type: 'poseModelReady',
        success: true
      }, '*');
    }
  });

  // Start loading MobileNet in background (clothing classification)
  loadMobilenet().then(function(model) {
    if (model) {
      console.log('ScrollVeil Sandbox: MobileNet ready (loaded in background)');
      window.parent.postMessage({
        type: 'mobilenetModelReady',
        success: true
      }, '*');
    }
  });

  window.parent.postMessage({
    type: 'modelLoaded',
    success: cocoReady,
    faceModelReady: faceReady
  }, '*');
  return { coco: results[0], face: results[1] };
}

// Listen for detection requests from offscreen document (parent iframe)
window.addEventListener('message', async function(event) {
  if (!event.data || event.data.type !== 'detectPeople') return;

  var requestId = event.data.requestId;
  var models = await loadModels();

  if (!models.coco) {
    event.source.postMessage({
      type: 'detectResult', requestId: requestId,
      hasPeople: null, people: [], allDetections: [], faces: [], pose: null, clothing: []
    }, event.origin);
    return;
  }

  try {
    var imageDataArray = event.data.imageDataArray;
    var width = event.data.width;
    var height = event.data.height;
    var canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext('2d');
    var imageData = new ImageData(
      new Uint8ClampedArray(imageDataArray), width, height
    );
    ctx.putImageData(imageData, 0, 0);

    // Run COCO-SSD (person + object detection)
    var predictions = await models.coco.detect(canvas, 20, 0.3);
    var people = predictions.filter(function(p) { return p.class === 'person'; });

    // Run BlazeFace (face detection) if model is loaded
    var faces = [];
    if (models.face) {
      try {
        var faceDetections = await models.face.estimateFaces(canvas, false);
        faces = faceDetections.map(function(f) {
          var tl = f.topLeft;
          var br = f.bottomRight;
          var faceW = br[0] - tl[0];
          var faceH = br[1] - tl[1];
          return {
            topLeft: [tl[0], tl[1]],
            bottomRight: [br[0], br[1]],
            width: faceW,
            height: faceH,
            probability: f.probability ? f.probability[0] : 0
          };
        });
        console.log('ScrollVeil Sandbox: BlazeFace detected ' + faces.length + ' face(s)');
      } catch (faceErr) {
        console.error('ScrollVeil Sandbox: BlazeFace error:', faceErr.message);
      }
    }

    // Run BlazePose (pose landmark detection) if detector is loaded
    var poseData = null;
    if (poseDetector && people.length > 0) {
      try {
        var poses = await poseDetector.estimatePoses(canvas);
        if (poses && poses.length > 0) {
          var pose = poses[0];
          // Extract the 33 keypoints with scores
          var keypoints = pose.keypoints.map(function(kp) {
            return {
              name: kp.name,
              x: kp.x,
              y: kp.y,
              score: kp.score
            };
          });
          poseData = {
            score: pose.score,
            keypoints: keypoints
          };
          console.log('ScrollVeil Sandbox: BlazePose detected pose, score=' + 
            (pose.score ? pose.score.toFixed(2) : 'N/A') + 
            ', keypoints=' + keypoints.length);
        }
      } catch (poseErr) {
        console.error('ScrollVeil Sandbox: BlazePose error:', poseErr.message);
      }
    }

    // Run MobileNet (clothing classification) on each detected person
    var clothingData = [];
    if (mobilenetModel && people.length > 0) {
      try {
        for (var pi = 0; pi < people.length; pi++) {
          var person = people[pi];
          var bx = Math.max(0, Math.floor(person.bbox[0]));
          var by = Math.max(0, Math.floor(person.bbox[1]));
          var bw = Math.floor(person.bbox[2]);
          var bh = Math.floor(person.bbox[3]);
          // Clamp to canvas bounds
          if (bx + bw > width) bw = width - bx;
          if (by + bh > height) bh = height - by;
          if (bw < 10 || bh < 10) continue; // Too small to classify

          // Crop the person region to a temporary canvas
          var cropCanvas = document.createElement('canvas');
          cropCanvas.width = bw;
          cropCanvas.height = bh;
          var cropCtx = cropCanvas.getContext('2d');
          cropCtx.drawImage(canvas, bx, by, bw, bh, 0, 0, bw, bh);

          // Classify the cropped person image — top 10 predictions
          var predictions10 = await mobilenetModel.classify(cropCanvas, 10);
          clothingData.push({
            personIndex: pi,
            bbox: [bx, by, bw, bh],
            predictions: predictions10.map(function(pred) {
              return { className: pred.className, probability: pred.probability };
            })
          });
          console.log('ScrollVeil Sandbox: MobileNet person ' + pi + ': ' +
            predictions10.slice(0, 3).map(function(p) {
              return p.className.split(',')[0] + ' ' + (p.probability * 100).toFixed(1) + '%';
            }).join(', '));
        }
      } catch (mnErr) {
        console.error('ScrollVeil Sandbox: MobileNet error:', mnErr.message);
      }
    }

    event.source.postMessage({
      type: 'detectResult',
      requestId: requestId,
      hasPeople: people.length > 0,
      people: people.map(function(p) {
        return {
          class: p.class,
          score: p.score,
          bbox: p.bbox
        };
      }),
      allDetections: predictions.map(function(p) {
        return {
          class: p.class,
          score: p.score,
          bbox: p.bbox
        };
      }),
      faces: faces,
      pose: poseData,
      clothing: clothingData
    }, event.origin);

  } catch (error) {
    console.error('ScrollVeil Sandbox: Detection error:', error.message);
    event.source.postMessage({
      type: 'detectResult', requestId: requestId,
      hasPeople: null, people: [], allDetections: [], faces: [], pose: null, clothing: []
    }, event.origin);
  }
});

// Auto-load models when sandbox iframe loads
loadModels();
