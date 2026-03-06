// ScrollVeil Image Detector
// Copyright Â© 2025 Michael Arold. All Rights Reserved.
//
// This software is proprietary and confidential. Unauthorized copying, modification,
// distribution, or use of this software, via any medium, is strictly prohibited.

class ScrollVeilDetector {
  constructor() {
    // Fixed thresholds — user controls filtering via the auto-unblur threshold slider
    this.thresholds = { blur: 45, block: 80 };
  }
  
  async analyzeImage(img, isVideo = false) {
    if (!img.src || img.src === '') {
      return { score: 0, decision: 'ALLOWED', action: 'allow', reason: 'No source' };
    }

    // PERSON DETECTION GATE: If no people in the image, score = 0 automatically.
    // This eliminates false positives on buildings, landscapes, food, products, etc.
    // When people ARE detected, their bounding boxes are passed to geometric analysis
    // so skin detection only happens within person regions.
    let personBboxes = null; // Will hold scaled bounding boxes if people detected
    let sceneObjects = null; // Will hold all COCO-SSD detections (objects, animals, etc.)
    let personCount = 0; // Number of people detected by COCO-SSD
    let faceData = null; // Will hold BlazeFace face detection results
    let poseData = null; // Will hold BlazePose pose landmark results
    let clothingData = null; // Will hold MobileNet clothing classification results
    if (typeof ScrollVeilPersonDetector !== 'undefined' && img.complete && img.naturalWidth > 0) {
      try {
        const personResult = await ScrollVeilPersonDetector.detectPeople(img);
        if (personResult.hasPeople === false) {
          // COCO-SSD found no people — auto-safe
          const objectNames = personResult.allDetections.map(d => d.class);
          const uniqueObjects = [...new Set(objectNames)];
          const reasonDetail = uniqueObjects.length > 0
            ? 'No people detected (found: ' + uniqueObjects.join(', ') + ')'
            : 'No people detected';
          console.log('🧠 ScrollVeil: ' + reasonDetail + ' — auto-safe');
          return { score: 0, decision: 'ALLOWED', action: 'allow', reason: reasonDetail };
        }
        // hasPeople === true → store bounding boxes for geometric analysis
        // hasPeople === null → model not loaded yet, continue without bbox constraint
        if (personResult.hasPeople === true) {
          personCount = personResult.people.length;
          console.log('🧠 ScrollVeil: ' + personCount + ' person(s) detected — running geometric analysis within bounding boxes');
          // COCO-SSD bbox format: [x, y, width, height] in the detection canvas coordinates
          // personDetection.js scales to max 300x300, our analysis canvas is 299x299
          // Store the bboxes and the detection canvas size so tryAnalyzeImage can scale them
          const detectionScale = Math.min(300 / img.naturalWidth, 300 / img.naturalHeight, 1);
          const detectionW = Math.round(img.naturalWidth * detectionScale);
          const detectionH = Math.round(img.naturalHeight * detectionScale);
          personBboxes = {
            boxes: personResult.people.map(p => p.bbox), // Each is [x, y, w, h]
            sourceWidth: detectionW,
            sourceHeight: detectionH
          };
          // Store all non-person detections for scene context analysis
          sceneObjects = personResult.allDetections
            .filter(d => d.class !== 'person')
            .map(d => ({ class: d.class, score: d.score }));
        }
        // Store BlazeFace face detection results (available regardless of hasPeople)
        if (personResult.faces && personResult.faces.length > 0) {
          faceData = {
            faces: personResult.faces,
            imageWidth: img.naturalWidth,
            imageHeight: img.naturalHeight
          };
          console.log('🧠 ScrollVeil: BlazeFace detected ' + faceData.faces.length + ' face(s)');
        }
        // Store BlazePose pose landmark results
        if (personResult.pose && personResult.pose.keypoints) {
          poseData = {
            keypoints: personResult.pose.keypoints,
            score: personResult.pose.score,
            imageWidth: img.naturalWidth,
            imageHeight: img.naturalHeight
          };
          console.log('🧠 ScrollVeil: BlazePose detected ' + poseData.keypoints.length + ' landmarks, pose score=' + (poseData.score ? poseData.score.toFixed(2) : 'N/A'));
        }
        // Store MobileNet clothing classification results
        if (personResult.clothing && personResult.clothing.length > 0) {
          clothingData = personResult.clothing;
          for (const cd of clothingData) {
            const top3 = cd.predictions.slice(0, 3).map(p => p.className.split(',')[0] + ' ' + (p.probability * 100).toFixed(1) + '%').join(', ');
            console.log('🧠 ScrollVeil: MobileNet clothing (person ' + cd.personIndex + '): ' + top3);
          }
        }
      } catch (e) {
        console.warn('⚠️ ScrollVeil: Person detection error, falling back to geometric analysis:', e.message);
      }
    }

    // Try to analyze the existing image element first (fastest path - no network)
    if (img.complete && img.naturalWidth > 0) {
      const result = await this.tryAnalyzeImage(img, isVideo, personBboxes, sceneObjects, personCount, faceData, poseData, clothingData);
      if (result) {
        return result;
      }
    }

    // If image isn't loaded yet, wait for it (it's already loading via the page)
    if (!img.complete) {
      await new Promise((resolve) => {
        img.onload = resolve;
        img.onerror = resolve;
        setTimeout(resolve, 3000); // 3s max wait
      });

      // Try again with the now-loaded image
      if (img.complete && img.naturalWidth > 0) {
        const result = await this.tryAnalyzeImage(img, isVideo, personBboxes, sceneObjects, personCount, faceData, poseData, clothingData);
        if (result) {
          return result;
        }
      }
    }

    // Only try CORS/background fetch if direct analysis failed (canvas tainted)
    const loadedImage = await this.loadImageWithCORS(img.src);
    if (loadedImage) {
      const result = await this.tryAnalyzeImage(loadedImage, isVideo, personBboxes, sceneObjects, personCount, faceData, poseData, clothingData);
      if (result) {
        return result;
      }
    }

    // Fallback
    return this.fallbackDetection(img, 'cors-blocked');
  }

  async tryAnalyzeImage(imageElement, isVideo = false, personBboxes = null, sceneObjects = null, personCount = 0, faceData = null, poseData = null, clothingData = null) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 299;
    canvas.height = 299;

    try {
      ctx.drawImage(imageElement, 0, 0, 299, 299);

      let imageData;
      try {
        imageData = ctx.getImageData(0, 0, 299, 299);
      } catch (e) {
        return null;
      }

      // BOUNDING BOX MASKING: If person detection provided bounding boxes,
      // zero out all pixels OUTSIDE person regions. This means skin detection,
      // cluster analysis, edge detection etc. only find skin inside person areas.
      // Background terracotta, sand, wood etc. becomes black (no false positives).
      if (personBboxes && personBboxes.boxes.length > 0) {
        const pixels = imageData.data;
        const scaleX = 299 / personBboxes.sourceWidth;
        const scaleY = 299 / personBboxes.sourceHeight;

        // Scale bounding boxes from detection coordinates to 299x299 analysis canvas
        const scaledBoxes = personBboxes.boxes.map(bbox => {
          const bx = Math.max(0, Math.floor(bbox[0] * scaleX));
          const by = Math.max(0, Math.floor(bbox[1] * scaleY));
          const bw = Math.min(299 - bx, Math.ceil(bbox[2] * scaleX));
          const bh = Math.min(299 - by, Math.ceil(bbox[3] * scaleY));
          return { x: bx, y: by, w: bw, h: bh };
        });

        console.log('🧠 ScrollVeil: Masking pixels outside ' + scaledBoxes.length + ' person bounding box(es)');

        // Build a mask: 1 = inside a person box, 0 = background (to be zeroed)
        const mask = new Uint8Array(299 * 299);
        for (const box of scaledBoxes) {
          for (let y = box.y; y < box.y + box.h && y < 299; y++) {
            for (let x = box.x; x < box.x + box.w && x < 299; x++) {
              mask[y * 299 + x] = 1;
            }
          }
        }

        // Zero out pixels not inside any person bounding box
        let maskedCount = 0;
        for (let i = 0; i < 299 * 299; i++) {
          if (mask[i] === 0) {
            const pi = i * 4;
            pixels[pi] = 0;     // R
            pixels[pi + 1] = 0; // G
            pixels[pi + 2] = 0; // B
            // Keep alpha as-is
            maskedCount++;
          }
        }
        console.log('🧠 ScrollVeil: Masked ' + maskedCount + ' background pixels (' +
                    ((maskedCount / (299 * 299)) * 100).toFixed(1) + '% of image)');
      }

      const pixels = imageData.data;

      // FACE + ARM + HAND EXCLUSION: Zero out pixels in face, arm, and hand regions
      // so skin detection only counts torso/leg exposure (the parts that matter for filtering).
      // Face skin (detected by BlazeFace) and arm/hand skin (detected by BlazePose) are
      // normal in any photo and shouldn't inflate the risk score.
      if (faceData || poseData) {
        // Determine scale from detection canvas (max 300x300) to analysis canvas (299x299)
        const faceScaleX = faceData ? 299 / (Math.round(Math.min(300 / faceData.imageWidth, 1) * faceData.imageWidth)) : 1;
        const faceScaleY = faceData ? 299 / (Math.round(Math.min(300 / faceData.imageHeight, 1) * faceData.imageHeight)) : 1;
        const poseW = poseData ? (poseData.imageWidth || 299) : 299;
        const poseH = poseData ? (poseData.imageHeight || 299) : 299;
        const poseScaleX = 299 / poseW;
        const poseScaleY = 299 / poseH;

        // Build exclusion mask: 1 = exclude from skin detection
        const excludeMask = new Uint8Array(299 * 299);
        let excludedCount = 0;

        // Helper: fill a rectangle in the exclusion mask
        function excludeRect(x, y, w, h) {
          const x0 = Math.max(0, Math.floor(x));
          const y0 = Math.max(0, Math.floor(y));
          const x1 = Math.min(299, Math.ceil(x + w));
          const y1 = Math.min(299, Math.ceil(y + h));
          for (let ey = y0; ey < y1; ey++) {
            for (let ex = x0; ex < x1; ex++) {
              excludeMask[ey * 299 + ex] = 1;
            }
          }
        }

        // Helper: fill a circle in the exclusion mask
        function excludeCircle(cx, cy, radius) {
          const r2 = radius * radius;
          const x0 = Math.max(0, Math.floor(cx - radius));
          const y0 = Math.max(0, Math.floor(cy - radius));
          const x1 = Math.min(299, Math.ceil(cx + radius));
          const y1 = Math.min(299, Math.ceil(cy + radius));
          for (let ey = y0; ey < y1; ey++) {
            for (let ex = x0; ex < x1; ex++) {
              if ((ex - cx) * (ex - cx) + (ey - cy) * (ey - cy) <= r2) {
                excludeMask[ey * 299 + ex] = 1;
              }
            }
          }
        }

        // Helper: exclude a thick line between two points (for arm segments)
        function excludeThickLine(x1, y1, x2, y2, thickness) {
          // Use a rectangle rotated along the line direction
          // Simplified: use the bounding box of the two points, expanded by thickness
          const minX = Math.min(x1, x2) - thickness;
          const minY = Math.min(y1, y2) - thickness;
          const maxX = Math.max(x1, x2) + thickness;
          const maxY = Math.max(y1, y2) + thickness;
          // For each pixel in the bounding box, check distance to the line segment
          const dx = x2 - x1;
          const dy = y2 - y1;
          const lenSq = dx * dx + dy * dy;
          const ex0 = Math.max(0, Math.floor(minX));
          const ey0 = Math.max(0, Math.floor(minY));
          const ex1 = Math.min(299, Math.ceil(maxX));
          const ey1 = Math.min(299, Math.ceil(maxY));
          for (let ey = ey0; ey < ey1; ey++) {
            for (let ex = ex0; ex < ex1; ex++) {
              // Distance from point to line segment
              let dist;
              if (lenSq === 0) {
                dist = Math.sqrt((ex - x1) * (ex - x1) + (ey - y1) * (ey - y1));
              } else {
                let t = ((ex - x1) * dx + (ey - y1) * dy) / lenSq;
                t = Math.max(0, Math.min(1, t));
                const projX = x1 + t * dx;
                const projY = y1 + t * dy;
                dist = Math.sqrt((ex - projX) * (ex - projX) + (ey - projY) * (ey - projY));
              }
              if (dist <= thickness) {
                excludeMask[ey * 299 + ex] = 1;
              }
            }
          }
        }

        // 1. FACE EXCLUSION — black out BlazeFace bounding boxes (with padding for neck)
        if (faceData && faceData.faces && faceData.faces.length > 0) {
          for (let fi = 0; fi < faceData.faces.length; fi++) {
            const face = faceData.faces[fi];
            // Scale to analysis canvas
            const fx = face.topLeft[0] * faceScaleX;
            const fy = face.topLeft[1] * faceScaleY;
            const fw = face.width * faceScaleX;
            const fh = face.height * faceScaleY;
            // Add 30% padding below for neck/chin area
            const neckPadding = fh * 0.3;
            // Add 10% padding on sides for ears/hair
            const sidePadding = fw * 0.1;
            excludeRect(fx - sidePadding, fy, fw + sidePadding * 2, fh + neckPadding);
          }
          console.log('ScrollVeil: Excluding ' + faceData.faces.length + ' face region(s) from skin detection');
        }

        // 2. ARM + HAND EXCLUSION — use BlazePose shoulder→elbow→wrist keypoints
        if (poseData && poseData.keypoints && poseData.keypoints.length >= 33) {
          const kp = {};
          for (let ki = 0; ki < poseData.keypoints.length; ki++) {
            kp[poseData.keypoints[ki].name] = poseData.keypoints[ki];
          }
          const CONF = 0.5;
          // Arm thickness: roughly 8% of image width (generous to catch full arm)
          const armThickness = 299 * 0.08;
          // Hand radius: roughly 5% of image width
          const handRadius = 299 * 0.05;

          // Left arm: shoulder → elbow → wrist
          const lShoulder = kp['left_shoulder'];
          const lElbow = kp['left_elbow'];
          const lWrist = kp['left_wrist'];
          if (lShoulder && lElbow && lShoulder.score >= CONF && lElbow.score >= CONF) {
            excludeThickLine(
              lShoulder.x * poseScaleX, lShoulder.y * poseScaleY,
              lElbow.x * poseScaleX, lElbow.y * poseScaleY,
              armThickness
            );
          }
          if (lElbow && lWrist && lElbow.score >= CONF && lWrist.score >= CONF) {
            excludeThickLine(
              lElbow.x * poseScaleX, lElbow.y * poseScaleY,
              lWrist.x * poseScaleX, lWrist.y * poseScaleY,
              armThickness
            );
          }
          if (lWrist && lWrist.score >= CONF) {
            excludeCircle(lWrist.x * poseScaleX, lWrist.y * poseScaleY, handRadius);
          }

          // Right arm: shoulder → elbow → wrist
          const rShoulder = kp['right_shoulder'];
          const rElbow = kp['right_elbow'];
          const rWrist = kp['right_wrist'];
          if (rShoulder && rElbow && rShoulder.score >= CONF && rElbow.score >= CONF) {
            excludeThickLine(
              rShoulder.x * poseScaleX, rShoulder.y * poseScaleY,
              rElbow.x * poseScaleX, rElbow.y * poseScaleY,
              armThickness
            );
          }
          if (rElbow && rWrist && rElbow.score >= CONF && rWrist.score >= CONF) {
            excludeThickLine(
              rElbow.x * poseScaleX, rElbow.y * poseScaleY,
              rWrist.x * poseScaleX, rWrist.y * poseScaleY,
              armThickness
            );
          }
          if (rWrist && rWrist.score >= CONF) {
            excludeCircle(rWrist.x * poseScaleX, rWrist.y * poseScaleY, handRadius);
          }

          console.log('ScrollVeil: Excluding arm/hand regions from skin detection');
        }

        // Apply exclusion: zero out excluded pixels
        for (let i = 0; i < 299 * 299; i++) {
          if (excludeMask[i] === 1) {
            const pi = i * 4;
            pixels[pi] = 0;
            pixels[pi + 1] = 0;
            pixels[pi + 2] = 0;
            excludedCount++;
          }
        }
        if (excludedCount > 0) {
          console.log('ScrollVeil: Excluded ' + excludedCount + ' face/arm/hand pixels (' +
                      ((excludedCount / (299 * 299)) * 100).toFixed(1) + '% of image)');
        }
      }

      // Run combined analysis (single pass where possible)
      const combinedAnalysis = this.analyzeCombined(pixels, 299, 299);
      combinedAnalysis.personCount = personCount; // Store for clothed-person cap in calculateScore

      // CLOTHING OVERRIDE: Use MobileNet classification to remove false-positive skin
      // pixels in areas where clothing is detected. Must run BEFORE body zone measurement
      // so the zones get accurate (post-clothing-override) skin counts.
      if (combinedAnalysis._skinMap && clothingData && clothingData.length > 0 && poseData) {
        const clothingOverride = this.applyClothingOverride(
          combinedAnalysis._skinMap, combinedAnalysis._skinMapWidth, combinedAnalysis._skinMapHeight,
          clothingData, poseData, personBboxes
        );
        if (clothingOverride) {
          combinedAnalysis.clothingType = clothingOverride.clothingType;
          combinedAnalysis.clothingConfidence = clothingOverride.confidence;
          combinedAnalysis.clothingPixelsRemoved = clothingOverride.pixelsRemoved;
          // Recalculate skin ratio after override
          if (clothingOverride.pixelsRemoved > 0) {
            const mapSize = combinedAnalysis._skinMapWidth * combinedAnalysis._skinMapHeight;
            let newSkinCount = 0;
            for (let i = 0; i < combinedAnalysis._skinMap.length; i++) {
              if (combinedAnalysis._skinMap[i]) newSkinCount++;
            }
            combinedAnalysis.skinRatio = newSkinCount / mapSize;
            console.log('🧠 ScrollVeil: Clothing override removed ' + clothingOverride.pixelsRemoved +
              ' skin pixels (' + clothingOverride.clothingType + ' ' + (clothingOverride.confidence * 100).toFixed(0) +
              '%), new skin ratio: ' + (combinedAnalysis.skinRatio * 100).toFixed(1) + '%');
          }
        }
      }

      // BODY-PART ZONE MEASUREMENT: Use BlazePose keypoints to measure skin in
      // precise anatomical zones (shoulders, chest, waist, hips, thighs, calves, feet).
      // This replaces the crude upper/middle/lower thirds with accurate body-part data.
      // Works for both images and videos through the unified pipeline.
      if (combinedAnalysis._skinMap && poseData) {
        const bodyZones = this.measureBodyPartZones(
          combinedAnalysis._skinMap, combinedAnalysis._skinMapWidth, combinedAnalysis._skinMapHeight, poseData
        );
        if (bodyZones) {
          combinedAnalysis.bodyZones = bodyZones;
        }
      }

      // Clean up skinMap reference (large array, not needed after zone measurement)
      delete combinedAnalysis._skinMap;
      delete combinedAnalysis._skinMapWidth;
      delete combinedAnalysis._skinMapHeight;

      // Calculate final score
      const score = this.calculateScore(combinedAnalysis, isVideo, sceneObjects, faceData, poseData, clothingData);
      const threshold = this.thresholds;

      let decision, action;
      if (score >= threshold.block) {
        decision = 'BLOCKED';
        action = 'block';
      } else if (score >= threshold.blur) {
        decision = 'BLURRED';
        action = 'blur';
      } else {
        decision = 'ALLOWED';
        action = 'allow';
      }

      return { score: score, decision: decision, action: action, reason: combinedAnalysis.reason, sceneObjects: sceneObjects || [], personCount: personCount, faceData: faceData, poseData: poseData, clothingData: clothingData || [], clothingType: combinedAnalysis.clothingType || null, clothingConfidence: combinedAnalysis.clothingConfidence || 0 };
    } catch (error) {
      return null;
    }
  }

  // Combined analysis - reduces 5 separate pixel loops to 2
  analyzeCombined(pixels, width, height) {
    const totalPixels = width * height;
    const upperEnd = Math.floor(height / 3);
    const middleEnd = Math.floor(2 * height / 3);

    // === PASS 1: Skin, Color Profile, and Texture in one loop ===
    let skinPixels = 0;
    let skinPixelsYCrCb = 0;  // PHASE 2: YCrCb counter — contributes to blended skinRatio (60% weight)
    let upperSkin = 0, middleSkin = 0, lowerSkin = 0;
    let skinSumR = 0, skinSumG = 0, skinSumB = 0;
    let skinSumR2 = 0, skinSumG2 = 0, skinSumB2 = 0;

    // Color profile
    let totalSaturation = 0;
    let highSaturationPixels = 0;
    let flatColorRuns = 0;
    let prevQR = -1, prevQG = -1, prevQB = -1, runLength = 0;

    // Texture (block-based)
    const blockSize = 20;
    const blocksX = Math.floor(width / blockSize);
    const blocksY = Math.floor(height / blockSize);
    const blockSumR = new Float32Array(blocksX * blocksY);
    const blockSumG = new Float32Array(blocksX * blocksY);
    const blockSumB = new Float32Array(blocksX * blocksY);
    const blockSumR2 = new Float32Array(blocksX * blocksY);
    const blockSumG2 = new Float32Array(blocksX * blocksY);
    const blockSumB2 = new Float32Array(blocksX * blocksY);

    // Grayscale array (needed for Pass 2)
    const grayscale = new Float32Array(totalPixels);

    // Skin map for cluster analysis (Pass 3)
    const skinMap = new Uint8Array(totalPixels);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const r255 = pixels[i];
        const g255 = pixels[i + 1];
        const b255 = pixels[i + 2];
        const r = r255 / 255;
        const g = g255 / 255;
        const b = b255 / 255;

        // Grayscale for edge detection (Pass 2)
        grayscale[y * width + x] = 0.299 * r255 + 0.587 * g255 + 0.114 * b255;

        // --- Skin detection ---
        const isRealistic = this.isRealisticSkin(r, g, b);

        // PHASE 2: YCrCb detection runs alongside RGB
        const isYCrCbSkin = this.isRealisticSkinYCrCb(r255, g255, b255);

        // skinMap uses UNION: pixel is skin if ANY detector says yes
        // This feeds cluster analysis and flood-fill with the broadest skin mask
        if (isRealistic || isYCrCbSkin) {
          skinMap[y * width + x] = 1;
        }

        // Track RGB-only and YCrCb-only counts separately for blending
        if (isRealistic) {
          skinPixels++;
          skinSumR += r255; skinSumG += g255; skinSumB += b255;
          skinSumR2 += r255 * r255; skinSumG2 += g255 * g255; skinSumB2 += b255 * b255;

          if (y < upperEnd) upperSkin++;
          else if (y < middleEnd) middleSkin++;
          else lowerSkin++;
        }

        if (isYCrCbSkin) {
          skinPixelsYCrCb++;
        }

        // --- Color profile ---
        const hsl = this.rgbToHsl(r, g, b);
        totalSaturation += hsl.s;
        if (hsl.s > 0.6) highSaturationPixels++;

        // Flat color runs
        const qr = Math.round(r * 15);
        const qg = Math.round(g * 15);
        const qb = Math.round(b * 15);
        if (qr === prevQR && qg === prevQG && qb === prevQB) {
          runLength++;
          if (runLength === 5) flatColorRuns++;
        } else {
          runLength = 0;
        }
        prevQR = qr; prevQG = qg; prevQB = qb;

        // --- Texture block accumulation ---
        const bx = Math.floor(x / blockSize);
        const by = Math.floor(y / blockSize);
        if (bx < blocksX && by < blocksY) {
          const bi = by * blocksX + bx;
          blockSumR[bi] += r255;
          blockSumG[bi] += g255;
          blockSumB[bi] += b255;
          blockSumR2[bi] += r255 * r255;
          blockSumG2[bi] += g255 * g255;
          blockSumB2[bi] += b255 * b255;
        }
      }
    }

    // TEXTURE VARIANCE FILTER: Remove skin pixels that are too uniform (likely clothing)
    // Must run BEFORE skin ratio calculation so clothing pixels don't inflate the score.
    // Recounts skinPixels and skinPixelsYCrCb after filtering.
    const textureRemoved = this.filterSkinMapByTexture(skinMap, pixels, width, height, 3.0, 3);
    if (textureRemoved > 0) {
      // Recount skin pixels from the filtered skinMap
      // We need to recount because the texture filter may have removed pixels
      // that were counted by RGB, YCrCb, or both detectors
      skinPixels = 0;
      skinPixelsYCrCb = 0;
      upperSkin = 0; middleSkin = 0; lowerSkin = 0;
      skinSumR = 0; skinSumG = 0; skinSumB = 0;
      skinSumR2 = 0; skinSumG2 = 0; skinSumB2 = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (skinMap[y * width + x]) {
            const i = (y * width + x) * 4;
            const r255 = pixels[i], g255 = pixels[i+1], b255 = pixels[i+2];
            skinPixels++;
            skinSumR += r255; skinSumG += g255; skinSumB += b255;
            skinSumR2 += r255*r255; skinSumG2 += g255*g255; skinSumB2 += b255*b255;
            if (y < upperEnd) upperSkin++;
            else if (y < middleEnd) middleSkin++;
            else lowerSkin++;
            // Recheck YCrCb for this surviving pixel
            if (this.isRealisticSkinYCrCb(r255, g255, b255)) skinPixelsYCrCb++;
          }
        }
      }
    }

    // Finish texture calculation
    const blockPixels = blockSize * blockSize;
    let uniformBlocks = 0, totalBlocks = 0;
    for (let bi = 0; bi < blocksX * blocksY; bi++) {
      const varR = (blockSumR2[bi] / blockPixels) - Math.pow(blockSumR[bi] / blockPixels, 2);
      const varG = (blockSumG2[bi] / blockPixels) - Math.pow(blockSumG[bi] / blockPixels, 2);
      const varB = (blockSumB2[bi] / blockPixels) - Math.pow(blockSumB[bi] / blockPixels, 2);
      const avgVar = (varR + varG + varB) / 3;
      totalBlocks++;
      if (avgVar < 100) uniformBlocks++;
    }

    // Skin color variance
    let skinColorStdDev = 0;
    if (skinPixels > 1) {
      const varR = (skinSumR2 / skinPixels) - Math.pow(skinSumR / skinPixels, 2);
      const varG = (skinSumG2 / skinPixels) - Math.pow(skinSumG / skinPixels, 2);
      const varB = (skinSumB2 / skinPixels) - Math.pow(skinSumB / skinPixels, 2);
      skinColorStdDev = Math.sqrt((varR + varG + varB) / 3);
    }

    let skinRatioRgb = skinPixels / totalPixels;
    const skinRatioYCrCb = skinPixelsYCrCb / totalPixels;
    const lowVarianceSkin = skinColorStdDev < 15 && skinPixels > 100;
    if (lowVarianceSkin) {
      skinRatioRgb = skinRatioRgb * 0.5;
    }

    // PHASE 2: Weighted blend — YCrCb primary (60%), RGB secondary (40%)
    // YCrCb is more robust to lighting and skin tone variation.
    // RGB provides a safety net for edge cases where YCrCb might miss.
    let skinRatio = 0.6 * skinRatioYCrCb + 0.4 * skinRatioRgb;

    // Log comparison: RGB, YCrCb, and blended
    const rgbPct = (skinRatioRgb * 100).toFixed(1);
    const ycrcbPct = (skinRatioYCrCb * 100).toFixed(1);
    const blendedPct = (skinRatio * 100).toFixed(1);
    console.log('🔬 ScrollVeil Phase2: RGB=' + rgbPct + '% | YCrCb=' + ycrcbPct +
                '% | Blended=' + blendedPct + '% | Pixels: RGB=' +
                skinPixels + ' YCrCb=' + skinPixelsYCrCb + ' of ' + totalPixels);

    const upperRatio = upperSkin / (width * upperEnd);
    const middleRatio = middleSkin / (width * (middleEnd - upperEnd));
    const lowerRatio = lowerSkin / (width * (height - middleEnd));

    // Color profile results
    const avgSaturation = totalSaturation / totalPixels;
    const highSaturationRatio = highSaturationPixels / totalPixels;
    const flatColorRatio = flatColorRuns / totalPixels;

    let reason = 'Safe content';
    if (skinRatio > 0.50) reason = 'High skin exposure';
    else if (middleRatio > 0.30 && lowerRatio > 0.30) reason = 'Exposed legs/thighs';
    else if (middleRatio > 0.28) reason = 'Revealing clothing';

    // === PASS 2: Skin cluster analysis (uses skinMap from Pass 1) ===
    const skinClusters = this.analyzeSkinClusters(skinMap, width, height);

    return {
      skinRatio, upperRatio, middleRatio, lowerRatio,
      skinColorStdDev, lowVarianceSkin, reason,
      avgSaturation, highSaturationRatio, flatColorRatio,
      uniformRatio: totalBlocks > 0 ? uniformBlocks / totalBlocks : 0,
      _skinMap: skinMap,       // Exposed for body-part zone measurement
      _skinMapWidth: width,
      _skinMapHeight: height,
      ...skinClusters
    };
  }

  // Skin Cluster Analysis - finds connected blobs of skin pixels
  // Large single blobs indicate bare body parts; scattered small blobs are safer
  analyzeSkinClusters(skinMap, width, height) {
    const totalPixels = width * height;
    const visited = new Uint8Array(totalPixels);
    const clusters = []; // Array of { size, minX, maxX, minY, maxY }

    // Flood-fill to find connected skin regions
    // Uses a stack instead of recursion to avoid stack overflow on large regions
    for (let startY = 0; startY < height; startY++) {
      for (let startX = 0; startX < width; startX++) {
        const startIdx = startY * width + startX;
        if (visited[startIdx] || !skinMap[startIdx]) continue;

        // Found an unvisited skin pixel — flood fill to find the full cluster
        let clusterSize = 0;
        let minX = startX, maxX = startX, minY = startY, maxY = startY;

        const stack = [startIdx];
        visited[startIdx] = 1;

        while (stack.length > 0) {
          const idx = stack.pop();
          const x = idx % width;
          const y = Math.floor(idx / width);

          clusterSize++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;

          // Check 4 neighbors (up, down, left, right)
          const neighbors = [
            y > 0 ? idx - width : -1,            // up
            y < height - 1 ? idx + width : -1,    // down
            x > 0 ? idx - 1 : -1,                 // left
            x < width - 1 ? idx + 1 : -1          // right
          ];

          for (const nIdx of neighbors) {
            if (nIdx >= 0 && !visited[nIdx] && skinMap[nIdx]) {
              visited[nIdx] = 1;
              stack.push(nIdx);
            }
          }
        }

        // Only track clusters larger than 50 pixels (ignore tiny noise)
        if (clusterSize > 50) {
          clusters.push({
            size: clusterSize,
            minX, maxX, minY, maxY,
            widthPx: maxX - minX + 1,
            heightPx: maxY - minY + 1
          });
        }
      }
    }

    // Sort clusters by size (largest first)
    clusters.sort((a, b) => b.size - a.size);

    // Calculate key metrics
    const largestCluster = clusters.length > 0 ? clusters[0] : null;
    const largestClusterRatio = largestCluster ? largestCluster.size / totalPixels : 0;

    // How much of all skin is in the single largest cluster?
    // High concentration = one big bare area. Low = scattered (safer).
    const totalSkinInClusters = clusters.reduce((sum, c) => sum + c.size, 0);
    const largestClusterSkinShare = totalSkinInClusters > 0 && largestCluster
      ? largestCluster.size / totalSkinInClusters : 0;

    // Check if largest cluster is body-proportioned
    let isBodyProportioned = false;
    if (largestCluster) {
      const clusterWidthRatio = largestCluster.widthPx / width;
      const clusterHeightRatio = largestCluster.heightPx / height;
      isBodyProportioned = (
        clusterWidthRatio >= 0.15 && clusterWidthRatio <= 0.70 &&
        clusterHeightRatio >= 0.25 && clusterHeightRatio <= 0.85
      );
    }

    return {
      skinClusterCount: clusters.length,
      largestClusterRatio,           // How much of the IMAGE is the biggest skin blob
      largestClusterSkinShare,       // How much of ALL SKIN is in the biggest blob
      isBodyProportioned,            // Largest cluster matches body-part dimensions
      clusters                       // Full cluster data (for debugging)
    };
  }

  async loadImageWithCORS(src) {
    console.log('🔍 ScrollVeil: loadImageWithCORS called for:', src?.substring(0, 100));
    // First attempt: Use background script to fetch (bypasses CORS completely)
    try {
      const response = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          console.log('⏰ ScrollVeil: loadImageWithCORS TIMEOUT (5s) for:', src?.substring(0, 80));
          reject(new Error('Background fetch timeout'));
        }, 5000); // Reduced from 15s to 5s for faster fallback

        chrome.runtime.sendMessage(
          { action: 'fetchImage', url: src },
          (response) => {
            clearTimeout(timeout);
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(response);
            }
          }
        );
      });

      if (response.success) {
        console.log('✅ ScrollVeil: loadImageWithCORS got data URL, size:', response.size, 'type:', response.type);
        // Load image from data URL (same-origin, no CORS issues)
        const img = new Image();

        const loaded = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Image load timeout'));
          }, 3000); // Reduced from 10s to 3s

          img.onload = () => {
            clearTimeout(timeout);
            resolve(true);
          };
          img.onerror = (e) => {
            clearTimeout(timeout);
            reject(e);
          };

          img.src = response.dataUrl;
        });

        return loaded ? img : null;
      } else {
        console.log('❌ ScrollVeil: loadImageWithCORS background fetch returned error:', response.error);
        throw new Error(response.error);
      }
    } catch (bgError) {
      console.log('❌ ScrollVeil: loadImageWithCORS background attempt failed:', bgError.message, '— trying traditional CORS');
      // Second attempt: Try traditional CORS loading
      try {
        const img = new Image();
        img.crossOrigin = 'anonymous';

        const loaded = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Image load timeout'));
          }, 3000); // Reduced from 10s to 3s

          img.onload = () => {
            clearTimeout(timeout);
            resolve(true);
          };
          img.onerror = (e) => {
            clearTimeout(timeout);
            reject(e);
          };

          img.src = src;
        });

        return loaded ? img : null;
      } catch (e) {
        return null;
      }
    }
  }

  async loadImageWithoutCORS(src) {
    try {
      const img = new Image();
      // Don't set crossOrigin - this allows the image to load but taints the canvas

      const loaded = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Image load timeout'));
        }, 10000);

        img.onload = () => {
          clearTimeout(timeout);
          resolve(true);
        };
        img.onerror = (e) => {
          clearTimeout(timeout);
          reject(e);
        };

        img.src = src;
      });

      return loaded ? img : null;
    } catch (e) {
      return null;
    }
  }
  
  fallbackDetection(img, errorType = 'unknown') {
    console.log('ScrollVeil: Using fallback detection, error type:', errorType);

    const url = img.src.toLowerCase();
    const alt = (img.alt || '').toLowerCase();
    const title = (img.title || '').toLowerCase();

    // Check for suspicious keywords in various attributes
    const keywords = ['nsfw', 'explicit', 'adult', 'sexy', 'nude', 'porn', 'xxx', 'bikini', 'lingerie', 'onlyfans', 'hot', 'sexy'];

    for (let keyword of keywords) {
      if (url.includes(keyword) || alt.includes(keyword) || title.includes(keyword)) {
        return { score: 70, decision: 'BLURRED', action: 'blur', reason: 'Suspicious keyword: ' + keyword };
      }
    }

    // Check image dimensions - very large images might be more likely to be inappropriate
    if (img.naturalWidth && img.naturalHeight) {
      const aspectRatio = img.naturalWidth / img.naturalHeight;
      // Portrait images with certain aspect ratios
      if (aspectRatio > 0.5 && aspectRatio < 0.8 && img.naturalHeight > 800) {
        console.log('ScrollVeil: Suspicious aspect ratio detected');
      }
    }

    // Different default actions based on error type
    if (errorType === 'load-failed') {
      return { score: 0, decision: 'ALLOWED', action: 'allow', reason: 'Image failed to load' };
    } else if (errorType === 'cors-blocked') {
      // CORS blocked - can't analyze, so be cautious
      return { score: 0, decision: 'ALLOWED', action: 'allow', reason: 'CORS blocked - no analysis possible' };
    } else if (errorType === 'canvas-tainted') {
      return { score: 0, decision: 'ALLOWED', action: 'allow', reason: 'Canvas tainted by CORS' };
    }

    return { score: 0, decision: 'ALLOWED', action: 'allow', reason: 'Fallback: no red flags' };
  }

  // Helper function: Convert RGB to HSL
  rgbToHsl(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max === min) {
      h = s = 0; // achromatic
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }

    return { h: h, s: s, l: l };
  }

  // Helper function: Check if pixel is realistic skin tone (RGB-based)
  isRealisticSkin(r, g, b) {
    // Basic range check
    if (!(r > 0.35 && r < 0.95 && g > 0.25 && g < 0.85 && b > 0.15 && b < 0.75)) return false;

    // Skin MUST have r > g > b ordering (wood/sand often have g ≈ b)
    if (!(r > g && g > b)) return false;

    // SAND REJECTION: Sand typically has g ≈ b (very close green and blue values)
    // Human skin has a warmer undertone with more separation between g and b
    if (Math.abs(g - b) < 0.04) return false;

    // Minimum red-blue separation (skin is distinctly warm, not grayish-brown)
    const rb = r - b;
    if (rb < 0.05 || rb > 0.45) return false;

    // Red-green gap must be moderate (not too close = gray, not too far = pure red)
    const rg = r - g;
    if (rg < 0.02 || rg > 0.25) return false;

    // Green-blue gap check (skin has distinct warm undertone)
    const gb = g - b;
    if (gb < 0.02 || gb > 0.25) return false;

    // Reject very uniform tones (wood/sand have low channel spread)
    const maxChannel = Math.max(r, g, b);
    const minChannel = Math.min(r, g, b);
    if (maxChannel - minChannel < 0.05) return false;

    return true;
  }

  // Helper function: Convert RGB (0-255) to YCrCb color space
  // YCrCb separates brightness (Y) from color (Cr=red warmth, Cb=blue coolness).
  // This makes skin detection more robust because skin tones cluster tightly
  // in Cr/Cb space regardless of lighting brightness.
  rgbToYCrCb(r255, g255, b255) {
    const y  = Math.round(0.299 * r255 + 0.587 * g255 + 0.114 * b255);
    const cr = Math.round((r255 - y) * 0.713 + 128);
    const cb = Math.round((b255 - y) * 0.564 + 128);
    return { y, cr, cb };
  }

  // PHASE 1 (parallel scoring): YCrCb-based skin detection
  // Runs alongside existing RGB detection — results logged but NOT used for decisions yet.
  // Benefits: better coverage of darker skin tones, more resilient to lighting changes,
  // fewer false positives on wood/sand/terracotta backgrounds.
  // Takes raw 0-255 RGB values (not normalized 0-1).
  isRealisticSkinYCrCb(r255, g255, b255) {
    // Fast RGB prefilter: reject pixels that can't possibly be skin
    // This skips ~60% of pixels before the more expensive YCrCb conversion
    if (r255 < 40 || g255 < 20 || b255 < 20) return false;  // Too dark
    if (r255 < g255) return false;  // Skin always has more red than green

    // Convert to YCrCb
    const { y, cr, cb } = this.rgbToYCrCb(r255, g255, b255);

    // Conservative Cr/Cb thresholds (based on Chai & Ngan research)
    // Cr (red chrominance): skin ranges ~133-173
    // Cb (blue chrominance): skin ranges ~77-127
    // These thresholds prioritize precision over recall to minimize false positives
    if (cr < 133 || cr > 173) return false;
    if (cb < 77  || cb > 127) return false;

    // Minimum brightness filter — very dark pixels (Y < 30) are unreliable
    // even in YCrCb space due to quantization noise
    if (y < 30) return false;

    return true;
  }

  // TEXTURE VARIANCE FILTER — removes "skin" pixels that are actually flat-shaded clothing
  // Real skin always has subtle pixel-to-pixel variation (pores, blood flow, lighting gradients).
  // Clothing fabric tends to have very uniform color (flat shading).
  // For each skin pixel, we check a neighborhood and measure Cr channel variance.
  // If variance is below threshold → too uniform → likely clothing → remove from skinMap.
  //
  // Parameters:
  //   skinMap: Uint8Array (1=skin, 0=not skin) — MODIFIED IN PLACE
  //   pixels: Uint8ClampedArray from getImageData (RGBA)
  //   width, height: image dimensions
  //   minVariance: minimum Cr standard deviation to keep a skin pixel (default 3.0)
  //   neighborRadius: half-size of neighborhood to check (default 3 → 7×7 window)
  //
  // Performance: Only examines pixels already marked as skin, and samples every 2nd pixel
  // in the neighborhood for speed. Typical cost: 1-3ms on a 300×300 image.
  filterSkinMapByTexture(skinMap, pixels, width, height, minVariance = 3.0, neighborRadius = 3) {
    const removals = [];
    const r = neighborRadius;

    for (let y = r; y < height - r; y++) {
      for (let x = r; x < width - r; x++) {
        const idx = y * width + x;
        if (!skinMap[idx]) continue; // Skip non-skin pixels

        // Collect Cr values in the neighborhood (sample every 2nd pixel for speed)
        let sumCr = 0, sumCr2 = 0, count = 0;
        for (let dy = -r; dy <= r; dy += 2) {
          for (let dx = -r; dx <= r; dx += 2) {
            const ni = ((y + dy) * width + (x + dx)) * 4;
            const nr = pixels[ni], ng = pixels[ni + 1], nb = pixels[ni + 2];
            // Fast Cr calculation: Cr = 0.5*R - 0.419*G - 0.081*B + 128
            const cr = 0.5 * nr - 0.419 * ng - 0.081 * nb + 128;
            sumCr += cr;
            sumCr2 += cr * cr;
            count++;
          }
        }

        if (count < 4) continue; // Not enough samples
        const meanCr = sumCr / count;
        const varianceCr = (sumCr2 / count) - (meanCr * meanCr);
        const stdDevCr = Math.sqrt(Math.max(0, varianceCr));

        if (stdDevCr < minVariance) {
          removals.push(idx); // Mark for removal (too uniform = likely clothing)
        }
      }
    }

    // Apply removals
    let removed = 0;
    for (const idx of removals) {
      skinMap[idx] = 0;
      removed++;
    }

    if (removed > 0) {
      console.log(`ScrollVeil: Texture filter removed ${removed} uniform skin pixels (threshold: ${minVariance.toFixed(1)})`);
    }

    return removed;
  }

  analyzePixels(pixels, width, height) {
    let skinPixels = 0;
    let totalPixels = width * height;
    let upperSkin = 0;
    let middleSkin = 0;
    let lowerSkin = 0;
    const upperEnd = Math.floor(height / 3);
    const middleEnd = Math.floor(2 * height / 3);

    // Color variance tracking for skin pixels (to detect uniform surfaces like sand)
    let skinSumR = 0, skinSumG = 0, skinSumB = 0;
    let skinSumR2 = 0, skinSumG2 = 0, skinSumB2 = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const r = pixels[i] / 255;
        const g = pixels[i + 1] / 255;
        const b = pixels[i + 2] / 255;

        // Check realistic skin detection
        const isRealistic = this.isRealisticSkin(r, g, b);

        if (isRealistic) {
          skinPixels++;

          // Track color variance (using 0-255 scale for std dev calculation)
          const r255 = pixels[i];
          const g255 = pixels[i + 1];
          const b255 = pixels[i + 2];
          skinSumR += r255; skinSumG += g255; skinSumB += b255;
          skinSumR2 += r255 * r255; skinSumG2 += g255 * g255; skinSumB2 += b255 * b255;

          if (y < upperEnd) {
            upperSkin++;
          } else if (y < middleEnd) {
            middleSkin++;
          } else {
            lowerSkin++;
          }
        }
      }
    }

    // Calculate color variance (standard deviation) of skin pixels
    let skinColorStdDev = 0;
    if (skinPixels > 1) {
      const varR = (skinSumR2 / skinPixels) - Math.pow(skinSumR / skinPixels, 2);
      const varG = (skinSumG2 / skinPixels) - Math.pow(skinSumG / skinPixels, 2);
      const varB = (skinSumB2 / skinPixels) - Math.pow(skinSumB / skinPixels, 2);
      skinColorStdDev = Math.sqrt((varR + varG + varB) / 3);
    }

    let skinRatio = skinPixels / totalPixels;

    // If skin pixels have very low color variance (std dev < 15), this is likely
    // a uniform surface (sand, building, etc.) rather than actual skin
    // Reduce effective skinRatio by 50%
    const lowVarianceSkin = skinColorStdDev < 15 && skinPixels > 100;
    if (lowVarianceSkin) {
      console.log('ScrollVeil: Low skin color variance detected (stdDev: ' + skinColorStdDev.toFixed(2) +
                  ') - reducing skinRatio from ' + (skinRatio * 100).toFixed(1) + '% to ' +
                  (skinRatio * 50).toFixed(1) + '%');
      skinRatio = skinRatio * 0.5;
    }
    const upperRatio = upperSkin / (width * upperEnd);
    const middleRatio = middleSkin / (width * (middleEnd - upperEnd));
    const lowerRatio = lowerSkin / (width * (height - middleEnd));
    let reason = 'Safe content';
    if (skinRatio > 0.50) {
      reason = 'High skin exposure';
    } else if (middleRatio > 0.30 && lowerRatio > 0.30) {
      reason = 'Exposed legs/thighs';
    } else if (middleRatio > 0.28) {
      reason = 'Revealing clothing';
    }
    return {
      skinRatio: skinRatio,
      upperRatio: upperRatio,
      middleRatio: middleRatio,
      lowerRatio: lowerRatio,
      skinColorStdDev: skinColorStdDev,
      lowVarianceSkin: lowVarianceSkin,
      reason: reason
    };
  }

  // Analyze texture uniformity to distinguish flat surfaces (sand, walls) from skin
  analyzeTexture(pixels, width, height) {
    const blockSize = 20;
    let uniformBlocks = 0;
    let totalBlocks = 0;

    for (let by = 0; by < height - blockSize; by += blockSize) {
      for (let bx = 0; bx < width - blockSize; bx += blockSize) {
        let sumR = 0, sumG = 0, sumB = 0;
        let sumR2 = 0, sumG2 = 0, sumB2 = 0;
        const count = blockSize * blockSize;

        for (let y = by; y < by + blockSize; y++) {
          for (let x = bx; x < bx + blockSize; x++) {
            const i = (y * width + x) * 4;
            const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
            sumR += r; sumG += g; sumB += b;
            sumR2 += r * r; sumG2 += g * g; sumB2 += b * b;
          }
        }

        // Calculate variance per channel
        const varR = (sumR2 / count) - Math.pow(sumR / count, 2);
        const varG = (sumG2 / count) - Math.pow(sumG / count, 2);
        const varB = (sumB2 / count) - Math.pow(sumB / count, 2);
        const avgVar = (varR + varG + varB) / 3;

        totalBlocks++;
        if (avgVar < 100) uniformBlocks++; // Very low variance = flat/uniform surface
      }
    }

    return {
      uniformRatio: totalBlocks > 0 ? uniformBlocks / totalBlocks : 0
    };
  }

  // SCENE CONTEXT EVALUATION
  // Uses COCO-SSD object detections (non-person) to understand the environment.
  // IMPORTANT: Context does NOT reduce risk when people are present with high skin.
  // A beach with a surfboard is STILL risky if there's a person in a swimsuit.
  // Context is used to:
  //   1. BOOST score in intimate/isolated settings (bed + person + skin = higher risk)
  //   2. DESCRIBE the scene for the user (informational, shown in unblur popup)
  //   3. Provide additional flags when no mitigating context exists
  evaluateSceneContext(sceneObjects) {
    if (!sceneObjects || sceneObjects.length === 0) {
      return {
        sceneType: 'unknown',
        description: 'No context objects detected',
        scoreModifier: 0,
        intimate: false,
        isolated: true,
        objects: []
      };
    }

    const objectNames = sceneObjects.map(d => d.class);
    const uniqueObjects = [...new Set(objectNames)];

    // Categorize detected objects
    const intimateObjects = ['bed', 'couch', 'sofa'];
    const outdoorRecreation = ['surfboard', 'sports ball', 'kite', 'skateboard', 'snowboard', 'skis', 'tennis racket', 'frisbee', 'baseball bat', 'baseball glove'];
    const waterRelated = ['boat', 'surfboard'];
    const vehicles = ['car', 'truck', 'bus', 'train', 'airplane', 'motorcycle', 'bicycle'];
    const foodDining = ['bowl', 'cup', 'fork', 'knife', 'spoon', 'bottle', 'wine glass', 'dining table'];
    const electronics = ['laptop', 'tv', 'cell phone', 'remote', 'keyboard', 'mouse'];
    const animals = ['dog', 'cat', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'bird'];
    const professionalItems = ['book', 'clock', 'scissors', 'backpack', 'umbrella', 'handbag', 'suitcase', 'tie'];

    // Check which categories are present
    const hasIntimate = uniqueObjects.some(o => intimateObjects.includes(o));
    const hasOutdoor = uniqueObjects.some(o => outdoorRecreation.includes(o));
    const hasVehicle = uniqueObjects.some(o => vehicles.includes(o));
    const hasFood = uniqueObjects.some(o => foodDining.includes(o));
    const hasElectronics = uniqueObjects.some(o => electronics.includes(o));
    const hasAnimals = uniqueObjects.some(o => animals.includes(o));
    const hasProfessional = uniqueObjects.some(o => professionalItems.includes(o));

    let sceneType = 'general';
    let description = '';
    let scoreModifier = 0;

    // INTIMATE SETTING: bed/couch with minimal other context = higher risk
    if (hasIntimate && !hasFood && !hasElectronics && !hasAnimals && !hasProfessional) {
      sceneType = 'intimate';
      const intimateFound = uniqueObjects.filter(o => intimateObjects.includes(o));
      description = 'Intimate setting (' + intimateFound.join(', ') + ')';
      scoreModifier = +15; // BOOST — intimate context with person = more concerning
      console.log('🧠 ScrollVeil Context: Intimate setting detected — ' + intimateFound.join(', '));
    }
    // INTIMATE + OTHER CONTEXT: bed/couch but also has normal objects = less concerning
    else if (hasIntimate) {
      sceneType = 'domestic';
      description = 'Indoor/domestic setting';
      scoreModifier = +5;
      console.log('🧠 ScrollVeil Context: Domestic setting with mixed objects');
    }
    // OUTDOOR RECREATION: beach/sports items present
    else if (hasOutdoor) {
      sceneType = 'outdoor_recreation';
      const outdoorFound = uniqueObjects.filter(o => outdoorRecreation.includes(o));
      description = 'Outdoor/recreation (' + outdoorFound.join(', ') + ')';
      scoreModifier = 0; // NO reduction — people at beach/sports still wear less clothing
      console.log('🧠 ScrollVeil Context: Outdoor recreation — ' + outdoorFound.join(', ') + ' (no score change)');
    }
    // ANIMALS: pet photos, wildlife
    else if (hasAnimals && !hasIntimate) {
      sceneType = 'animals';
      const animalFound = uniqueObjects.filter(o => animals.includes(o));
      description = 'Animal/pet scene (' + animalFound.join(', ') + ')';
      scoreModifier = 0;
      console.log('🧠 ScrollVeil Context: Animal scene — ' + animalFound.join(', '));
    }
    // FOOD/DINING: restaurant, cooking
    else if (hasFood) {
      sceneType = 'dining';
      description = 'Food/dining scene';
      scoreModifier = 0;
      console.log('🧠 ScrollVeil Context: Dining scene');
    }
    // PROFESSIONAL/WORK: office, desk setup
    else if (hasElectronics || hasProfessional) {
      sceneType = 'professional';
      description = 'Professional/work setting';
      scoreModifier = 0;
      console.log('🧠 ScrollVeil Context: Professional setting');
    }
    // VEHICLE/TRAVEL
    else if (hasVehicle) {
      sceneType = 'travel';
      const vehicleFound = uniqueObjects.filter(o => vehicles.includes(o));
      description = 'Travel/vehicle scene (' + vehicleFound.join(', ') + ')';
      scoreModifier = 0;
      console.log('🧠 ScrollVeil Context: Travel scene — ' + vehicleFound.join(', '));
    }
    // GENERAL: objects detected but no clear scene type
    else {
      sceneType = 'general';
      description = 'Objects detected: ' + uniqueObjects.join(', ');
      scoreModifier = 0;
    }

    return {
      sceneType: sceneType,
      description: description,
      scoreModifier: scoreModifier,
      intimate: hasIntimate,
      isolated: false,
      objects: uniqueObjects
    };
  }

  // ===== CLOTHING DETECTION OVERRIDE =====
  // Uses MobileNet classification results to identify what clothing a person is wearing,
  // then maps that clothing type to body regions using BlazePose keypoints.
  // Skin pixels in covered regions are zeroed out of the skinMap to prevent
  // false positives from warm-toned clothing being detected as skin.

  // MobileNet ImageNet clothing class → coverage type mapping
  // Coverage types: 'full' (torso+legs), 'torso' (shoulders to hips), 'legs' (hips to ankles),
  // 'minimal' (bikini/swimwear — mostly exposed), 'none' (not clothing-related)
  static CLOTHING_COVERAGE_MAP = {
    // Full body coverage (torso + legs)
    'suit': 'full', 'suit of clothes': 'full',
    'academic gown': 'full', 'gown': 'full',
    'cloak': 'full', 'poncho': 'full',
    'lab coat': 'full', 'trench coat': 'full',
    'fur coat': 'full', 'overcoat': 'full',
    'military uniform': 'full', 'uniform': 'full',
    'pajama': 'full', 'kimono': 'full',
    'abaya': 'full', 'vestment': 'full',

    // Torso coverage (shoulders to hips)
    'jersey': 'torso', 'T-shirt': 'torso', 'tee shirt': 'torso',
    'sweatshirt': 'torso', 'cardigan': 'torso',
    'bulletproof vest': 'torso', 'chest protector': 'torso',
    'cuirass': 'torso', 'breastplate': 'torso',
    'apron': 'torso', 'bib': 'torso',
    'jean': 'torso_and_legs', 'jeans': 'torso_and_legs',
    'Windsor tie': 'torso', 'bow tie': 'torso',
    'stole': 'torso', 'feather boa': 'torso',

    // Leg coverage (hips to ankles)
    'sarong': 'legs', 'overskirt': 'legs',

    // Minimal coverage (bikini/swimwear — skin around is real)
    'bikini': 'minimal', 'two-piece': 'minimal',
    'maillot': 'minimal', 'tank suit': 'minimal',
    'swimming trunks': 'minimal',
    'brassiere': 'minimal', 'bra': 'minimal',
    'miniskirt': 'minimal_legs', 'mini skirt': 'minimal_legs',

    // Head/accessories (not body coverage, ignore)
    'bonnet': 'none', 'cowboy hat': 'none', 'sombrero': 'none',
    'shower cap': 'none', 'bathing cap': 'none',
    'sunglasses': 'none', 'sunglass': 'none',
    'mask': 'none', 'gasmask': 'none',
    'necklace': 'none', 'neck brace': 'none',
    'wig': 'none', 'hair slide': 'none',
    'shoe': 'none', 'running shoe': 'none', 'sandal': 'none',
    'clog': 'none', 'boot': 'none', 'cowboy boot': 'none',
    'sock': 'none', 'stocking': 'none',
    'mitten': 'none', 'glove': 'none',
    'backpack': 'none', 'purse': 'none', 'handbag': 'none',
    'wallet': 'none', 'mailbag': 'none',
    'umbrella': 'none', 'watch': 'none',
  };

  applyClothingOverride(skinMap, mapWidth, mapHeight, clothingData, poseData, personBboxes) {
    if (!clothingData || clothingData.length === 0 || !poseData || !poseData.keypoints) {
      return null;
    }

    // Find the best clothing prediction across all detected people
    let bestClothing = null;
    let bestConfidence = 0;
    let bestCoverage = 'none';

    for (const person of clothingData) {
      for (const pred of person.predictions) {
        // Check each word in the className against our mapping
        // MobileNet returns comma-separated synonyms like "suit, suit of clothes"
        const classNames = pred.className.split(',').map(s => s.trim().toLowerCase());
        for (const name of classNames) {
          const coverage = ScrollVeilDetector.CLOTHING_COVERAGE_MAP[name];
          if (coverage && coverage !== 'none' && pred.probability > bestConfidence) {
            bestClothing = name;
            bestConfidence = pred.probability;
            bestCoverage = coverage;
          }
        }
      }
    }

    // Confidence gate: only apply if MobileNet is >30% sure about clothing
    if (!bestClothing || bestConfidence < 0.30) {
      return null;
      return null;
    }

    // Don't override for minimal coverage (bikini/swimwear) — skin there is real
    if (bestCoverage === 'minimal' || bestCoverage === 'minimal_legs') {
      return {
        clothingType: bestClothing,
        confidence: bestConfidence,
        coverageType: bestCoverage,
        pixelsRemoved: 0
      };
    }

    // Use BlazePose keypoints to define coverage regions
    // Keypoint indices: 11=left_shoulder, 12=right_shoulder, 23=left_hip, 24=right_hip,
    // 25=left_knee, 26=right_knee, 27=left_ankle, 28=right_ankle
    const kp = poseData.keypoints;
    const lShoulder = kp.find(k => k.name === 'left_shoulder');
    const rShoulder = kp.find(k => k.name === 'right_shoulder');
    const lHip = kp.find(k => k.name === 'left_hip');
    const rHip = kp.find(k => k.name === 'right_hip');
    const lKnee = kp.find(k => k.name === 'left_knee');
    const rKnee = kp.find(k => k.name === 'right_knee');
    const lAnkle = kp.find(k => k.name === 'left_ankle');
    const rAnkle = kp.find(k => k.name === 'right_ankle');

    // Need at least shoulders and hips with decent confidence
    const minScore = 0.3;
    if (!lShoulder || !rShoulder || !lHip || !rHip) return null;
    if (lShoulder.score < minScore || rShoulder.score < minScore) return null;
    if (lHip.score < minScore || rHip.score < minScore) return null;

    // Scale keypoints from image coordinates to skinMap coordinates (299x299)
    const imgW = poseData.imageWidth || 299;
    const imgH = poseData.imageHeight || 299;
    const scaleX = mapWidth / imgW;
    const scaleY = mapHeight / imgH;

    // Define coverage rectangles based on clothing type
    const coverageRects = [];

    if (bestCoverage === 'torso' || bestCoverage === 'full' || bestCoverage === 'torso_and_legs') {
      // Torso: from shoulders to hips, with some padding
      const torsoLeft = Math.min(lShoulder.x, rShoulder.x, lHip.x, rHip.x) * scaleX;
      const torsoRight = Math.max(lShoulder.x, rShoulder.x, lHip.x, rHip.x) * scaleX;
      const torsoTop = Math.min(lShoulder.y, rShoulder.y) * scaleY;
      const torsoBottom = Math.max(lHip.y, rHip.y) * scaleY;
      coverageRects.push({
        x: Math.max(0, Math.floor(torsoLeft - 5)),
        y: Math.max(0, Math.floor(torsoTop - 5)),
        w: Math.min(mapWidth, Math.ceil(torsoRight - torsoLeft + 10)),
        h: Math.min(mapHeight, Math.ceil(torsoBottom - torsoTop + 10))
      });
    }

    if (bestCoverage === 'legs' || bestCoverage === 'full' || bestCoverage === 'torso_and_legs') {
      // Legs: from hips to ankles (or knees if ankles not visible)
      const legBottom = (lAnkle && rAnkle && lAnkle.score > minScore && rAnkle.score > minScore)
        ? Math.max(lAnkle.y, rAnkle.y)
        : (lKnee && rKnee && lKnee.score > minScore && rKnee.score > minScore)
          ? Math.max(lKnee.y, rKnee.y)
          : Math.max(lHip.y, rHip.y) + (Math.max(lHip.y, rHip.y) - Math.min(lShoulder.y, rShoulder.y));

      const legLeft = Math.min(lHip.x, rHip.x) * scaleX;
      const legRight = Math.max(lHip.x, rHip.x) * scaleX;
      const legTop = Math.max(lHip.y, rHip.y) * scaleY;
      const legBot = legBottom * scaleY;
      // Legs are wider than hip points — add more horizontal padding
      const legPadX = (legRight - legLeft) * 0.3;
      coverageRects.push({
        x: Math.max(0, Math.floor(legLeft - legPadX)),
        y: Math.max(0, Math.floor(legTop)),
        w: Math.min(mapWidth, Math.ceil(legRight - legLeft + legPadX * 2)),
        h: Math.min(mapHeight, Math.ceil(legBot - legTop + 5))
      });
    }

    // Zero out skin pixels within coverage rectangles
    let pixelsRemoved = 0;
    for (const rect of coverageRects) {
      for (let y = rect.y; y < Math.min(rect.y + rect.h, mapHeight); y++) {
        for (let x = rect.x; x < Math.min(rect.x + rect.w, mapWidth); x++) {
          const idx = y * mapWidth + x;
          if (skinMap[idx]) {
            skinMap[idx] = 0;
            pixelsRemoved++;
          }
        }
      }
    }

    return {
      clothingType: bestClothing,
      confidence: bestConfidence,
      coverageType: bestCoverage,
      pixelsRemoved: pixelsRemoved,
      coverageRects: coverageRects
    };
  }

  // ===== BODY-PART ZONE MEASUREMENT =====
  // Uses BlazePose keypoints to define precise body-part rectangles,
  // then measures skin percentage within each zone using the skinMap.
  // This replaces crude image-thirds (upper/middle/lower) with anatomically
  // accurate zones: shoulders, chest, waist, hips, thighs, calves, feet.
  // Face, arms, and hands are excluded (already masked out of skin detection).
  // Works for both images and videos through the unified scoring pipeline.
  measureBodyPartZones(skinMap, mapWidth, mapHeight, poseData) {
    if (!poseData || !poseData.keypoints || poseData.keypoints.length < 33) {
      return null; // No pose data — fallback to crude thirds in calculateScore
    }

    // Build keypoint lookup
    const kp = {};
    for (let i = 0; i < poseData.keypoints.length; i++) {
      kp[poseData.keypoints[i].name] = poseData.keypoints[i];
    }

    const CONF = 0.4; // Slightly lower confidence threshold for zone building
    const imgW = mapWidth;
    const imgH = mapHeight;

    // Scale from pose detection canvas to skinMap (299x299)
    const poseW = poseData.imageWidth || 299;
    const poseH = poseData.imageHeight || 299;
    const scaleX = imgW / poseW;
    const scaleY = imgH / poseH;

    // Helper: get scaled keypoint position, or null if below confidence
    function getKP(name) {
      const p = kp[name];
      if (!p || p.score < CONF) return null;
      return { x: p.x * scaleX, y: p.y * scaleY };
    }

    // Helper: measure skin % within a rectangular zone
    function measureZone(x1, y1, x2, y2) {
      const left = Math.max(0, Math.floor(Math.min(x1, x2)));
      const top = Math.max(0, Math.floor(Math.min(y1, y2)));
      const right = Math.min(imgW, Math.ceil(Math.max(x1, x2)));
      const bottom = Math.min(imgH, Math.ceil(Math.max(y1, y2)));
      const zoneWidth = right - left;
      const zoneHeight = bottom - top;
      if (zoneWidth <= 0 || zoneHeight <= 0) return { skinRatio: 0, pixelCount: 0, skinCount: 0 };

      let skinCount = 0;
      let pixelCount = 0;
      for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) {
          pixelCount++;
          if (skinMap[y * imgW + x] === 1) {
            skinCount++;
          }
        }
      }
      return {
        skinRatio: pixelCount > 0 ? skinCount / pixelCount : 0,
        pixelCount: pixelCount,
        skinCount: skinCount,
        bounds: { left: left, top: top, right: right, bottom: bottom }
      };
    }

    // Get key landmark positions
    const lShoulder = getKP('left_shoulder');
    const rShoulder = getKP('right_shoulder');
    const lHip = getKP('left_hip');
    const rHip = getKP('right_hip');
    const lKnee = getKP('left_knee');
    const rKnee = getKP('right_knee');
    const lAnkle = getKP('left_ankle');
    const rAnkle = getKP('right_ankle');
    const lHeel = getKP('left_heel');
    const rHeel = getKP('right_heel');
    const lFoot = getKP('left_foot_index');
    const rFoot = getKP('right_foot_index');
    const nose = getKP('nose');

    // We need at least shoulders and hips to define the core zones
    if (!lShoulder && !rShoulder) return null;
    if (!lHip && !rHip) return null;

    // Calculate midpoints for missing landmarks
    const shoulderLeft = lShoulder || rShoulder;
    const shoulderRight = rShoulder || lShoulder;
    const hipLeft = lHip || rHip;
    const hipRight = rHip || lHip;

    // Body width with padding (shoulders define max torso width)
    const bodyLeft = Math.min(shoulderLeft.x, hipLeft.x);
    const bodyRight = Math.max(shoulderRight.x, hipRight.x);
    const bodyWidth = bodyRight - bodyLeft;
    const padding = bodyWidth * 0.15; // 15% padding on each side

    // Key Y positions
    const shoulderY = (shoulderLeft.y + shoulderRight.y) / 2;
    const hipY = (hipLeft.y + hipRight.y) / 2;
    const torsoHeight = hipY - shoulderY;

    // Define zone boundaries
    const zones = {};

    // SHOULDERS: Band from top of shoulders to slightly below (15% of torso height)
    const shoulderBandHeight = torsoHeight * 0.15;
    zones.shoulders = measureZone(
      bodyLeft - padding, shoulderY - shoulderBandHeight * 0.5,
      bodyRight + padding, shoulderY + shoulderBandHeight * 0.5
    );

    // CHEST: From below shoulder band to midpoint of torso
    const chestTop = shoulderY + shoulderBandHeight * 0.5;
    const chestBottom = shoulderY + torsoHeight * 0.45; // 45% down the torso
    zones.chest = measureZone(
      bodyLeft - padding, chestTop,
      bodyRight + padding, chestBottom
    );

    // WAIST/MIDRIFF: From chest bottom to just above hips
    const waistTop = chestBottom;
    const waistBottom = hipY - torsoHeight * 0.05; // Stop just above hip line
    zones.waist = measureZone(
      bodyLeft - padding, waistTop,
      bodyRight + padding, waistBottom
    );

    // HIPS: Band around the hip line (20% of torso height)
    const hipBandHeight = torsoHeight * 0.20;
    zones.hips = measureZone(
      bodyLeft - padding * 1.2, hipY - hipBandHeight * 0.3,
      bodyRight + padding * 1.2, hipY + hipBandHeight * 0.7
    );

    // THIGHS: From below hips to knees (or estimated if knees not visible)
    const thighTop = hipY + hipBandHeight * 0.7;
    let thighBottom;
    if (lKnee || rKnee) {
      const kneeY = lKnee && rKnee ? (lKnee.y + rKnee.y) / 2 :
                     (lKnee || rKnee).y;
      thighBottom = kneeY;
    } else {
      // Estimate: thighs are roughly same length as torso
      thighBottom = thighTop + torsoHeight;
    }
    // Thighs are wider than torso — use hip width with extra padding
    const hipWidth = Math.abs(hipRight.x - hipLeft.x);
    const thighPadding = hipWidth * 0.3;
    zones.thighs = measureZone(
      hipLeft.x - thighPadding, thighTop,
      hipRight.x + thighPadding, thighBottom
    );

    // CALVES: From knees to ankles (only if knees visible)
    if (lKnee || rKnee) {
      const kneeLeft = lKnee || rKnee;
      const kneeRight = rKnee || lKnee;
      const kneeY = (kneeLeft.y + kneeRight.y) / 2;
      let calfBottom;
      if (lAnkle || rAnkle) {
        const ankleY = lAnkle && rAnkle ? (lAnkle.y + rAnkle.y) / 2 :
                       (lAnkle || rAnkle).y;
        calfBottom = ankleY;
      } else {
        // Estimate: calves slightly shorter than thighs
        calfBottom = kneeY + (thighBottom - thighTop) * 0.9;
      }
      const calfPadding = hipWidth * 0.2;
      zones.calves = measureZone(
        Math.min(kneeLeft.x, hipLeft.x) - calfPadding, kneeY,
        Math.max(kneeRight.x, hipRight.x) + calfPadding, calfBottom
      );
    }

    // FEET: Small zones around ankle/heel/toe points
    if (lAnkle || rAnkle || lHeel || rHeel || lFoot || rFoot) {
      const footPoints = [lAnkle, rAnkle, lHeel, rHeel, lFoot, rFoot].filter(p => p !== null);
      if (footPoints.length > 0) {
        let minX = imgW, maxX = 0, minY = imgH, maxY = 0;
        for (let i = 0; i < footPoints.length; i++) {
          if (footPoints[i].x < minX) minX = footPoints[i].x;
          if (footPoints[i].x > maxX) maxX = footPoints[i].x;
          if (footPoints[i].y < minY) minY = footPoints[i].y;
          if (footPoints[i].y > maxY) maxY = footPoints[i].y;
        }
        const footPad = bodyWidth * 0.1;
        zones.feet = measureZone(
          minX - footPad, minY - footPad,
          maxX + footPad, maxY + footPad
        );
      }
    }

    // Calculate summary stats
    let totalZoneSkin = 0;
    let totalZonePixels = 0;
    let exposedZones = []; // Zones with significant skin (> 25%)
    let highExposureZones = []; // Zones with very high skin (> 50%)
    const zoneNames = ['shoulders', 'chest', 'waist', 'hips', 'thighs', 'calves', 'feet'];

    for (let i = 0; i < zoneNames.length; i++) {
      const name = zoneNames[i];
      if (zones[name]) {
        totalZoneSkin += zones[name].skinCount;
        totalZonePixels += zones[name].pixelCount;
        if (zones[name].skinRatio > 0.25) {
          exposedZones.push(name);
        }
        if (zones[name].skinRatio > 0.50) {
          highExposureZones.push(name);
        }
      }
    }

    zones._summary = {
      overallSkinRatio: totalZonePixels > 0 ? totalZoneSkin / totalZonePixels : 0,
      exposedZones: exposedZones,
      exposedZoneCount: exposedZones.length,
      highExposureZones: highExposureZones,
      highExposureCount: highExposureZones.length,
      hasChestExposure: zones.chest ? zones.chest.skinRatio > 0.25 : false,
      hasWaistExposure: zones.waist ? zones.waist.skinRatio > 0.25 : false,
      hasHipExposure: zones.hips ? zones.hips.skinRatio > 0.25 : false,
      hasThighExposure: zones.thighs ? zones.thighs.skinRatio > 0.25 : false,
      hasCalfExposure: zones.calves ? zones.calves.skinRatio > 0.25 : false
    };

    // Log zone measurements
    console.log('ScrollVeil: Body-part zone skin measurement:');
    for (let i = 0; i < zoneNames.length; i++) {
      const name = zoneNames[i];
      if (zones[name]) {
        console.log('  ' + name + ': ' + (zones[name].skinRatio * 100).toFixed(1) + '% skin' +
                    (zones[name].skinRatio > 0.50 ? ' ⚠️ HIGH' : zones[name].skinRatio > 0.25 ? ' ⚡ exposed' : ''));
      }
    }
    console.log('  Summary: ' + zones._summary.exposedZoneCount + ' exposed zones, ' +
                zones._summary.highExposureCount + ' high-exposure zones');
    if (zones._summary.exposedZones.length > 0) {
      console.log('  Exposed: ' + zones._summary.exposedZones.join(', '));
    }

    return zones;
  }

  calculateScore(analysis, isVideo = false, sceneObjects = null, faceData = null, poseData = null, clothingData = null) {
    let score = 0;
    let reasons = [];

    // SCENE CONTEXT: Evaluate what objects are in the scene
    const sceneContext = this.evaluateSceneContext(sceneObjects);
    // Store on analysis object so it's available in the return value
    analysis.sceneContext = sceneContext;

    // BLAZEPOSE BODY SHAPE CONFIRMATION: When BlazePose has high-confidence landmarks,
    // we KNOW there's a human body. This prevents safety caps from crushing
    // scores on real photos.
    if (poseData && poseData.score > 0.7 && poseData.keypoints && poseData.keypoints.length >= 17) {
      if (analysis.hasBodyShape === false || analysis.hasBodyShape === undefined) {
        console.log('ScrollVeil: BlazePose confirms human body — pose score ' + poseData.score.toFixed(2) +
                    ' with ' + poseData.keypoints.length + ' landmarks');
        analysis.hasBodyShape = true;
      }
    }

    // Videos now use the same full scoring pipeline as images.
    // Person detection + bounding box masking handles false positive elimination.
    // The isVideo flag is logged for debugging but does not change scoring logic.
    if (isVideo) {
      console.log('ScrollVeil: Analyzing video frame with full scoring pipeline (same as images)');
    }
    // ===== PIXEL-BASED ANALYSIS =====

    // BLAZEFACE PORTRAIT DETECTION — Uses actual face detection AI
    // If faces are detected and cover a significant portion of the image, it's a portrait
    let faceRatio = 0; // Persisted for use in scoring ladder below
    if (faceData && faceData.faces.length > 0) {
      // BlazeFace coordinates are in the detection canvas space (max 300x300)
      // Calculate what percentage of the image is covered by faces
      const detectionScale = Math.min(300 / faceData.imageWidth, 300 / faceData.imageHeight, 1);
      const canvasW = Math.round(faceData.imageWidth * detectionScale);
      const canvasH = Math.round(faceData.imageHeight * detectionScale);
      const imageArea = canvasW * canvasH;

      let totalFaceArea = 0;
      for (let i = 0; i < faceData.faces.length; i++) {
        const face = faceData.faces[i];
        totalFaceArea += face.width * face.height;
      }

      faceRatio = totalFaceArea / imageArea;
      console.log('ScrollVeil: BlazeFace face coverage:', (faceRatio * 100).toFixed(1) + '% of image (' + faceData.faces.length + ' face(s))');

      // Portrait cap: if face(s) cover 15%+ of the image, it's a portrait
      // Lowered from 25% — many portrait thumbnails have faces at 15-25% of the frame
      // BUT: only early-return if skin is low (< 30%), so revealing images with a face still score
      // ALSO: skip if body zones show exposed skin (bikini with face visible is NOT a portrait)
      const hasExposedBodyZones = analysis.bodyZones && analysis.bodyZones._summary &&
                                   analysis.bodyZones._summary.exposedZoneCount >= 1;
      // ALSO: skip if COCO-SSD person bbox covers >50% of image height (full/half body, not headshot)
      let isFullBodyShot = false;
      if (analysis.personBboxes && analysis.personBboxes.length > 0) {
        for (let pbi = 0; pbi < analysis.personBboxes.length; pbi++) {
          const bbox = analysis.personBboxes[pbi];
          // bbox format: [x, y, width, height] scaled to 299x299
          if (bbox[3] > 299 * 0.50) {
            isFullBodyShot = true;
            break;
          }
        }
      }
      if (faceRatio > 0.15 && analysis.skinRatio < 0.30 && !hasExposedBodyZones && !isFullBodyShot) {
        const capScore = faceRatio > 0.50 ? 5 : 10;
        console.log('ScrollVeil: Portrait detected (face covers ' + (faceRatio * 100).toFixed(1) + '%, skinRatio ' + (analysis.skinRatio * 100).toFixed(1) + '%) — capping score at ' + capScore);
        reasons.push('Portrait / face close-up');
        analysis.reason = reasons.join(', ');
        return capScore;
      }
      if (faceRatio > 0.15 && analysis.skinRatio < 0.30 && (hasExposedBodyZones || isFullBodyShot)) {
        console.log('ScrollVeil: Face prominent but NOT a portrait — ' +
                    (hasExposedBodyZones ? 'body zones show exposure (' + analysis.bodyZones._summary.exposedZones.join(', ') + ')' : '') +
                    (isFullBodyShot ? ' person bbox covers >50% of image height' : '') +
                    ' — skipping portrait cap');
      }

      // Face visible but high skin — don't early-return, but set a cap for later
      if (faceRatio > 0.15 && analysis.skinRatio >= 0.30) {
        console.log('ScrollVeil: Face prominent (' + (faceRatio * 100).toFixed(1) + '%) but high skin (' + (analysis.skinRatio * 100).toFixed(1) + '%) — will cap at 20 if needed');
        analysis._faceScoreCap = 20;
        analysis._faceRatio = faceRatio;
      }

      // Small but definite face (10-15%): set moderate cap
      if (faceRatio > 0.10 && faceRatio <= 0.15) {
        console.log('ScrollVeil: Face detected (' + (faceRatio * 100).toFixed(1) + '%) — will cap at 15 if skin is low');
        analysis._faceScoreCap = analysis.skinRatio < 0.25 ? 15 : 25;
        analysis._faceRatio = faceRatio;
      }
    }

    // ===== BLAZEPOSE LANDMARK ANALYSIS =====
    // Uses 33 body keypoints from MediaPipe BlazePose to understand body posture.
    // Fills the gap between "person detected" (COCO-SSD) and "face detected" (BlazeFace).
    // Provides: headshot detection, body exposure estimation, suggestive pose detection.
    let poseHeadshotDetected = false;
    let poseLegSpreadRatio = 0;
    let poseHandNearPelvis = false;
    let poseSkeletonHeightRatio = 0;
    let poseLowerBodyVisible = false;
    let poseUpperOnlyVisible = false;

    if (poseData && poseData.keypoints && poseData.keypoints.length >= 33) {
      const kp = {};
      // Build a lookup map: name → {x, y, score}
      for (let i = 0; i < poseData.keypoints.length; i++) {
        kp[poseData.keypoints[i].name] = poseData.keypoints[i];
      }

      const imgW = poseData.imageWidth || 299;
      const imgH = poseData.imageHeight || 299;
      const CONF = 0.5; // Minimum confidence to consider a landmark "visible"

      // --- Landmark visibility by body region ---
      const upperLandmarks = ['nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear',
                              'left_shoulder', 'right_shoulder'];
      const midLandmarks = ['left_elbow', 'right_elbow', 'left_wrist', 'right_wrist',
                            'left_hip', 'right_hip'];
      const lowerLandmarks = ['left_knee', 'right_knee', 'left_ankle', 'right_ankle',
                              'left_heel', 'right_heel', 'left_foot_index', 'right_foot_index'];

      let upperVisible = 0, midVisible = 0, lowerVisible = 0;
      for (let i = 0; i < upperLandmarks.length; i++) {
        if (kp[upperLandmarks[i]] && kp[upperLandmarks[i]].score >= CONF) upperVisible++;
      }
      for (let i = 0; i < midLandmarks.length; i++) {
        if (kp[midLandmarks[i]] && kp[midLandmarks[i]].score >= CONF) midVisible++;
      }
      for (let i = 0; i < lowerLandmarks.length; i++) {
        if (kp[lowerLandmarks[i]] && kp[lowerLandmarks[i]].score >= CONF) lowerVisible++;
      }

      const upperPct = upperVisible / upperLandmarks.length;
      const midPct = midVisible / midLandmarks.length;
      const lowerPct = lowerVisible / lowerLandmarks.length;

      console.log('ScrollVeil: BlazePose visibility — upper: ' + (upperPct * 100).toFixed(0) +
                  '%, mid: ' + (midPct * 100).toFixed(0) +
                  '%, lower: ' + (lowerPct * 100).toFixed(0) + '%');

      // HEADSHOT DETECTION: Only upper body landmarks visible
      // If upper landmarks are strong but mid/lower are weak, it's a tight headshot
      if (upperPct >= 0.6 && midPct < 0.35 && lowerPct < 0.2) {
        poseHeadshotDetected = true;
        poseUpperOnlyVisible = true;
        console.log('ScrollVeil: BlazePose headshot detected — upper-only landmarks');
      }

      // LOWER BODY VISIBLE: knees/ankles/hips detected with confidence
      if (lowerPct >= 0.4 && midPct >= 0.3) {
        poseLowerBodyVisible = true;
      }

      // --- Skeleton height ratio ---
      // How much vertical space the detected body occupies in the image
      let minY = imgH, maxY = 0;
      for (let i = 0; i < poseData.keypoints.length; i++) {
        const pt = poseData.keypoints[i];
        if (pt.score >= CONF) {
          if (pt.y < minY) minY = pt.y;
          if (pt.y > maxY) maxY = pt.y;
        }
      }
      poseSkeletonHeightRatio = (maxY - minY) / imgH;
      console.log('ScrollVeil: BlazePose skeleton height ratio: ' + (poseSkeletonHeightRatio * 100).toFixed(1) + '%');

      // --- Leg spread ratio ---
      // Normalized by torso height (shoulder-to-hip distance)
      const lShoulder = kp['left_shoulder'];
      const rShoulder = kp['right_shoulder'];
      const lHip = kp['left_hip'];
      const rHip = kp['right_hip'];
      const lAnkle = kp['left_ankle'];
      const rAnkle = kp['right_ankle'];

      if (lShoulder && rShoulder && lHip && rHip &&
          lShoulder.score >= CONF && rShoulder.score >= CONF &&
          lHip.score >= CONF && rHip.score >= CONF) {
        // Torso height = average of left/right shoulder-to-hip distance
        const torsoH = ((lHip.y - lShoulder.y) + (rHip.y - rShoulder.y)) / 2;

        if (torsoH > 10 && lAnkle && rAnkle && lAnkle.score >= CONF && rAnkle.score >= CONF) {
          const ankleSpread = Math.abs(lAnkle.x - rAnkle.x);
          poseLegSpreadRatio = ankleSpread / torsoH;
          console.log('ScrollVeil: BlazePose leg spread ratio: ' + poseLegSpreadRatio.toFixed(2) +
                      ' (ankle spread: ' + ankleSpread.toFixed(0) + 'px, torso: ' + torsoH.toFixed(0) + 'px)');
        }

        // --- Hand-to-pelvis proximity ---
        const lWrist = kp['left_wrist'];
        const rWrist = kp['right_wrist'];
        // Pelvis center = midpoint of hips
        const pelvisX = (lHip.x + rHip.x) / 2;
        const pelvisY = (lHip.y + rHip.y) / 2;

        if (lWrist && lWrist.score >= CONF) {
          const distL = Math.sqrt(Math.pow(lWrist.x - pelvisX, 2) + Math.pow(lWrist.y - pelvisY, 2));
          if (distL < torsoH * 0.4) {
            poseHandNearPelvis = true;
            console.log('ScrollVeil: BlazePose left hand near pelvis (dist: ' + distL.toFixed(0) + 'px)');
          }
        }
        if (!poseHandNearPelvis && rWrist && rWrist.score >= CONF) {
          const distR = Math.sqrt(Math.pow(rWrist.x - pelvisX, 2) + Math.pow(rWrist.y - pelvisY, 2));
          if (distR < torsoH * 0.4) {
            poseHandNearPelvis = true;
            console.log('ScrollVeil: BlazePose right hand near pelvis (dist: ' + distR.toFixed(0) + 'px)');
          }
        }
      }

      // Store pose analysis on the analysis object for debugging
      analysis.poseAnalysis = {
        upperPct: upperPct,
        midPct: midPct,
        lowerPct: lowerPct,
        skeletonHeightRatio: poseSkeletonHeightRatio,
        legSpreadRatio: poseLegSpreadRatio,
        handNearPelvis: poseHandNearPelvis,
        headshotDetected: poseHeadshotDetected,
        lowerBodyVisible: poseLowerBodyVisible
      };
    }

    // BLAZEPOSE HEADSHOT CAP — if pose confirms it's just a head/shoulders shot, cap low
    // This supplements BlazeFace (works even when face is partially occluded)
    // Skip if body zones show exposed skin or COCO-SSD shows full body
    const hasExposedZonesForPose = analysis.bodyZones && analysis.bodyZones._summary &&
                                    analysis.bodyZones._summary.exposedZoneCount >= 1;
    let isFullBodyForPose = false;
    if (analysis.personBboxes && analysis.personBboxes.length > 0) {
      for (let pbi = 0; pbi < analysis.personBboxes.length; pbi++) {
        if (analysis.personBboxes[pbi][3] > 299 * 0.50) { isFullBodyForPose = true; break; }
      }
    }
    if (poseHeadshotDetected && !poseLowerBodyVisible && !hasExposedZonesForPose && !isFullBodyForPose) {
      const poseCap = 10;
      console.log('ScrollVeil: BlazePose headshot cap — upper-only pose detected, capping at ' + poseCap);
      reasons.push('Headshot (pose landmarks)');
      analysis.reason = reasons.join(', ');
      return poseCap;
    }

    // FACE/PORTRAIT DETECTION - Geometric fallback (for when BlazeFace model hasn't loaded)
    // Must meet ALL conditions to be considered a safe portrait
    // Skip if body zones show exposed skin or COCO-SSD shows full body
    const hasExposedZonesGeometric = analysis.bodyZones && analysis.bodyZones._summary &&
                                      analysis.bodyZones._summary.exposedZoneCount >= 1;
    let isFullBodyGeometric = false;
    if (analysis.personBboxes && analysis.personBboxes.length > 0) {
      for (let pbi = 0; pbi < analysis.personBboxes.length; pbi++) {
        if (analysis.personBboxes[pbi][3] > 299 * 0.50) { isFullBodyGeometric = true; break; }
      }
    }
    const isFaceCloseup = (
      !hasExposedZonesGeometric &&
      !isFullBodyGeometric &&
      analysis.upperRatio > 0.30 &&
      analysis.middleRatio < 0.08 &&
      analysis.lowerRatio < 0.05 &&
      analysis.skinRatio < 0.45 &&
      analysis.skinRatio > 0.15 &&
      (analysis.upperRatio > analysis.middleRatio * 3)
    );

    if (isFaceCloseup) {
      console.log('ScrollVeil: Face closeup detected - allowing content');
      console.log('  Upper ratio:', analysis.upperRatio.toFixed(3),
                  'Middle:', analysis.middleRatio.toFixed(3),
                  'Lower:', analysis.lowerRatio.toFixed(3));
      reasons.push('Face closeup');
      analysis.reason = reasons.join(', ');
      return 0; // Don't filter true headshots only
    }

    // Very high skin ratio - likely inappropriate
    if (analysis.skinRatio > 0.50) {
      score = 85;
      reasons.push('High skin exposure');
    }
    // High overall skin with concentration in body areas
    else if (analysis.skinRatio > 0.35) {
      score = 70;
      reasons.push('High skin ratio');
    }
    // Significant skin in middle and lower (revealing clothing/poses)
    // BUT: skip if face is prominent — middle skin is likely face, not body exposure
    else if (analysis.middleRatio > 0.25 && analysis.lowerRatio > 0.25 && faceRatio < 0.15) {
      score = 65;
      reasons.push('Exposed legs/thighs');
    }
    // Significant skin in torso area
    // BUT: if a face is prominent (15%+), middle-region skin is likely face/neck, not torso exposure
    else if (analysis.middleRatio > 0.25 && faceRatio < 0.15) {
      score = 55;
      reasons.push('Revealing clothing');
    }
    else if (analysis.middleRatio > 0.25 && faceRatio >= 0.15) {
      score = 15;
      reasons.push('Face/neck skin visible');
    }
    // Moderate overall skin exposure
    else if (analysis.skinRatio > 0.25) {
      score = 50;
      reasons.push('Moderate skin');
    }
    // Some skin showing but likely safe
    else if (analysis.skinRatio > 0.15) {
      score = 30;
      reasons.push('Some skin visible');
    }
    // Minimal skin
    else {
      score = 10;
      reasons.push('Minimal skin');
    }

    // Boost score if there's concentration in lower body
    if (analysis.lowerRatio > 0.30) {
      score += 10;
      reasons.push('Lower body concentration');
    }

    // Boost score if there's very high concentration in any region
    if (analysis.upperRatio > 0.40 || analysis.middleRatio > 0.40 || analysis.lowerRatio > 0.40) {
      score += 15;
      reasons.push('High regional concentration');
    }

    // HUMAN BODY SHAPE DETECTION
    // Check if skin distribution pattern matches a human body (not scattered game pixels or small cartoons)
    const looksLikeHumanBodySkin = (
      analysis.skinRatio > 0.20 &&                           // At least 20% skin
      analysis.upperRatio > 0.08 &&                          // Has face/head region with skin
      (analysis.middleRatio > 0.12 || analysis.lowerRatio > 0.12) && // Has visible torso OR legs
      (analysis.upperRatio + analysis.middleRatio) > 0.20 && // Combined upper+middle is significant
      analysis.lowerRatio < 0.80 &&                          // Sanity checks
      analysis.middleRatio < 0.75 &&
      analysis.upperRatio < 0.70
    );




    // Human body detection based on skin distribution
    const looksLikeHumanBody = looksLikeHumanBodySkin;



    if (looksLikeHumanBody) {
      console.log('ScrollVeil: Human body shape detected - applying body-specific checks');
      console.log('  Skin distribution - Upper:', analysis.upperRatio.toFixed(3),
                  'Middle:', analysis.middleRatio.toFixed(3),
                  'Lower:', analysis.lowerRatio.toFixed(3));



      // SKIN CLUSTER ANALYSIS BOOST
      // Large connected skin blob + smooth texture = likely bare skin
      if (analysis.largestClusterRatio !== undefined && !analysis.lowVarianceSkin) {
        const hasLargeCluster = analysis.largestClusterRatio > 0.12;   // >12% of image is one skin blob
        const isDominantCluster = analysis.largestClusterSkinShare > 0.6; // >60% of skin in one blob
        const isSmooth = analysis.largestClusterSmoothness > 0.65;      // Low internal edge density
        const isBodySized = analysis.isBodyProportioned === true;

        // Large smooth skin blob that's body-proportioned = very likely nudity
        if (hasLargeCluster && isSmooth && isBodySized) {
          score += 25;
          reasons.push('Large smooth skin region');
          console.log('ScrollVeil: Large smooth skin cluster detected - ratio:',
                      (analysis.largestClusterRatio * 100).toFixed(1) + '%',
                      'smoothness:', analysis.largestClusterSmoothness.toFixed(2),
                      'body-proportioned:', isBodySized);
        }
        // Large smooth cluster but not perfectly body-proportioned
        else if (hasLargeCluster && isSmooth && isDominantCluster) {
          score += 15;
          reasons.push('Smooth skin concentration');
          console.log('ScrollVeil: Smooth skin cluster - ratio:',
                      (analysis.largestClusterRatio * 100).toFixed(1) + '%',
                      'smoothness:', analysis.largestClusterSmoothness.toFixed(2));
        }
        // Large cluster that's dominant (even if not super smooth) + body proportioned
        else if (hasLargeCluster && isDominantCluster && isBodySized) {
          score += 10;
          reasons.push('Body-sized skin region');
        }

        // IMPORTANT: If skin is scattered across many small clusters (no dominant blob),
        // this is likely a group photo, game screenshot, or false positive.
        // In this case, REDUCE the score slightly.
        if (analysis.skinClusterCount > 5 && analysis.largestClusterSkinShare < 0.3 && score > 30) {
          score -= 10;
          reasons.push('Scattered skin (likely safe)');
          console.log('ScrollVeil: Scattered skin across', analysis.skinClusterCount,
                      'clusters - reducing score');
        }
      }

      // BLAZEPOSE POSE-BASED BOOSTS (only when body landmarks are available)
      // These use skeletal data to detect suggestive posture that pixel analysis alone might miss
      if (poseData && poseLowerBodyVisible) {
        // LEG SPREAD: Wide leg spread relative to torso is a strong suggestive pose signal
        if (poseLegSpreadRatio > 1.5) {
          score += 25;
          reasons.push('Wide leg spread (pose)');
          console.log('ScrollVeil: BlazePose leg spread boost +25 (ratio: ' + poseLegSpreadRatio.toFixed(2) + ')');
        } else if (poseLegSpreadRatio > 1.0) {
          score += 15;
          reasons.push('Moderate leg spread (pose)');
          console.log('ScrollVeil: BlazePose leg spread boost +15 (ratio: ' + poseLegSpreadRatio.toFixed(2) + ')');
        }

        // HAND NEAR PELVIS: Hand positioned near groin/hip area
        if (poseHandNearPelvis) {
          score += 15;
          reasons.push('Hand near pelvis (pose)');
          console.log('ScrollVeil: BlazePose hand-near-pelvis boost +15');
        }

        // FULL BODY + HIGH SKIN: Body fills most of frame AND significant skin detected
        // This combination is high-risk — full nude or lingerie pose
        if (poseSkeletonHeightRatio > 0.7 && analysis.skinRatio > 0.30) {
          score += 10;
          reasons.push('Full body + high skin (pose)');
          console.log('ScrollVeil: BlazePose full-body + high skin boost +10');
        }
      }

    }
  // ===== NEW: PORTRAIT / FACE CLOSE-UP CAP =====
  // If almost all detected skin is in the upper third (face/neck) with negligible skin
  // in middle/lower thirds, this is almost certainly a safe portrait, selfie, or talking-head.
  // We cap aggressively to prevent false positives from blurring it.
  // Skip if body zones show exposed skin or COCO-SSD shows full body
  const hasExposedZonesPortrait = analysis.bodyZones && analysis.bodyZones._summary &&
                                    analysis.bodyZones._summary.exposedZoneCount >= 1;
  let isFullBodyPortrait = false;
  if (analysis.personBboxes && analysis.personBboxes.length > 0) {
    for (let pbi = 0; pbi < analysis.personBboxes.length; pbi++) {
      if (analysis.personBboxes[pbi][3] > 299 * 0.50) { isFullBodyPortrait = true; break; }
    }
  }
  const isPortrait = 
    !hasExposedZonesPortrait &&
    !isFullBodyPortrait &&
    analysis.upperRatio > 0.28 &&
    analysis.middleRatio < 0.16 &&
    analysis.lowerRatio < 0.06 &&
    analysis.skinRatio > 0.12 &&
    true; // Simplified — edge-based body shape detection removed

  if (isPortrait) {
    const portraitCap = 10;  // Very low → always auto-safe in all modes
    if (score > portraitCap) {
      console.log(`ScrollVeil: Portrait/face close-up CAP applied — capping score from ${score} to ${portraitCap} ` +
                  `(upperRatio: ${(analysis.upperRatio * 100).toFixed(1)}%, ` +
                  `middleRatio: ${(analysis.middleRatio * 100).toFixed(1)}%, ` +
                  `lowerRatio: ${(analysis.lowerRatio * 100).toFixed(1)}%)`);
      score = portraitCap;
      reasons.push('Portrait / face close-up');
    }
  }
  
  // ===== END NEW CAP =====

    // ===== CLOTHED PERSON CAP =====
    // If COCO-SSD detected a person, BlazeFace detected a face, but skin is very low,
    // the person is clearly wearing clothes (only face/hands/neck skin visible).
    // Cap aggressively — a clothed person with a visible face is safe content.
    // EXCEPTION: If body-part zones show skin in chest/waist/hips/thighs, do NOT cap —
    // that means revealing clothing (bikini, crop top, shorts, etc.)
    const personDetected = analysis.personCount > 0 || (analysis.personBboxes && analysis.personBboxes.length > 0);
    const faceDetected = faceData && faceData.faces && faceData.faces.length > 0;

    // Check body-part zones for skin in concerning areas
    // If ANY body zone shows significant skin, the person is NOT fully clothed
    let hasBodyZoneSkin = false;
    if (analysis.bodyZones && analysis.bodyZones._summary) {
      const zs = analysis.bodyZones._summary;
      hasBodyZoneSkin = zs.hasChestExposure || zs.hasWaistExposure ||
                        zs.hasHipExposure || zs.hasThighExposure ||
                        zs.exposedZoneCount >= 2;
      if (hasBodyZoneSkin) {
        console.log('ScrollVeil: Body zone skin detected (' + zs.exposedZones.join(', ') +
                    ') — clothed person cap will NOT fire');
      }
    }
    // Fallback when body zones aren't available: check crude thirds for body skin
    if (!analysis.bodyZones) {
      const hasTorsoSkin = analysis.middleRatio > 0.06;
      const hasLegSkin = analysis.lowerRatio > 0.06;
      const hasUpperBodySkin = analysis.upperRatio > 0.15;
      const exposedZoneCount = (hasTorsoSkin ? 1 : 0) + (hasLegSkin ? 1 : 0) + (hasUpperBodySkin ? 1 : 0);
      hasBodyZoneSkin = hasTorsoSkin || hasLegSkin || exposedZoneCount >= 2;
    }
    
    if (personDetected && faceDetected && analysis.skinRatio < 0.20 && score > 10 && !hasBodyZoneSkin) {
      console.log('ScrollVeil: Clothed person cap — person + face detected but skinRatio only ' +
                  (analysis.skinRatio * 100).toFixed(1) + '% (wearing clothes). Capping from ' + score + ' to 10');
      score = 10;
      reasons.push('Clothed person (face visible)');
    }
    // Slightly more lenient for moderate skin (20-28%) — could be short sleeves, V-neck, or face makeup
    else if (personDetected && faceDetected && analysis.skinRatio < 0.28 && score > 15 && !hasBodyZoneSkin) {
      console.log('ScrollVeil: Mostly-clothed person cap — person + face + skinRatio ' +
                  (analysis.skinRatio * 100).toFixed(1) + '%. Capping from ' + score + ' to 15');
      score = 15;
      reasons.push('Mostly clothed person');
    }

    // ===== BODY-PART ZONE SCORING BOOSTS =====
    // When precise body zones are available, boost score based on which specific
    // body parts have exposed skin. This catches bikinis, crop tops, short shorts, etc.
    // that the crude skin-ratio scoring ladder might undercount.
    if (analysis.bodyZones && analysis.bodyZones._summary) {
      const bz = analysis.bodyZones;
      const bzs = bz._summary;
      let zoneBoost = 0;
      let zoneReasons = [];

      // Chest exposure (cleavage, low-cut tops, bikini tops)
      if (bz.chest && bz.chest.skinRatio > 0.40) {
        zoneBoost += 20;
        zoneReasons.push('Exposed chest (' + (bz.chest.skinRatio * 100).toFixed(0) + '%)');
      } else if (bz.chest && bz.chest.skinRatio > 0.25) {
        zoneBoost += 10;
        zoneReasons.push('Partial chest exposure');
      }

      // Waist/midriff exposure (crop tops, bikinis)
      if (bz.waist && bz.waist.skinRatio > 0.40) {
        zoneBoost += 15;
        zoneReasons.push('Exposed midriff (' + (bz.waist.skinRatio * 100).toFixed(0) + '%)');
      } else if (bz.waist && bz.waist.skinRatio > 0.25) {
        zoneBoost += 8;
        zoneReasons.push('Partial midriff exposure');
      }

      // Hip exposure (bikini bottoms, low-rise pants)
      if (bz.hips && bz.hips.skinRatio > 0.40) {
        zoneBoost += 15;
        zoneReasons.push('Exposed hips (' + (bz.hips.skinRatio * 100).toFixed(0) + '%)');
      } else if (bz.hips && bz.hips.skinRatio > 0.25) {
        zoneBoost += 8;
        zoneReasons.push('Partial hip exposure');
      }

      // Thigh exposure (short shorts, bikini bottoms, mini skirts)
      if (bz.thighs && bz.thighs.skinRatio > 0.40) {
        zoneBoost += 20;
        zoneReasons.push('Exposed thighs (' + (bz.thighs.skinRatio * 100).toFixed(0) + '%)');
      } else if (bz.thighs && bz.thighs.skinRatio > 0.25) {
        zoneBoost += 10;
        zoneReasons.push('Partial thigh exposure');
      }

      // Multi-zone exposure multiplier: multiple exposed body parts = more concerning
      if (bzs.exposedZoneCount >= 4) {
        zoneBoost += 15;
        zoneReasons.push('Extensive body exposure (' + bzs.exposedZoneCount + ' zones)');
      } else if (bzs.exposedZoneCount >= 3) {
        zoneBoost += 10;
        zoneReasons.push('Multiple zones exposed (' + bzs.exposedZoneCount + ')');
      } else if (bzs.exposedZoneCount >= 2) {
        zoneBoost += 5;
        zoneReasons.push('Two zones exposed');
      }

      // High exposure zones multiplier (>50% skin = very revealing)
      if (bzs.highExposureCount >= 3) {
        zoneBoost += 15;
        zoneReasons.push('Very high exposure (' + bzs.highExposureZones.join(', ') + ')');
      } else if (bzs.highExposureCount >= 2) {
        zoneBoost += 10;
        zoneReasons.push('High exposure in ' + bzs.highExposureZones.join(', '));
      }

      if (zoneBoost > 0) {
        score += zoneBoost;
        for (let i = 0; i < zoneReasons.length; i++) {
          reasons.push(zoneReasons[i]);
        }
        console.log('ScrollVeil: Body zone boost +' + zoneBoost + ' (' + zoneReasons.join('; ') + ')');
      }

      // ZONE-BASED FLOOR: If we have precise zone data showing real body exposure,
      // ensure the score doesn't stay too low from the crude scoring ladder
      if (bzs.exposedZoneCount >= 2 && score < 35) {
        console.log('ScrollVeil: Zone floor — ' + bzs.exposedZoneCount + ' exposed zones, raising score from ' + score + ' to 35');
        score = 35;
        reasons.push('Body zone exposure floor');
      }
      if (bzs.highExposureCount >= 2 && score < 50) {
        console.log('ScrollVeil: High zone floor — ' + bzs.highExposureCount + ' high-exposure zones, raising score from ' + score + ' to 50');
        score = 50;
        reasons.push('High body exposure floor');
      }
    }

    // ===== END CLOTHED PERSON CAP =====

    // ===== FINAL CAPS (applied AFTER all boosts) =====

    // LANDSCAPE/NATURE SCENE DETECTOR — REMOVED
    // Previously capped scores when skin-colored pixels were concentrated in the lower half
    // (like sand on a beach). Removed because it suppressed scores on beach bikini photos
    // and other outdoor scenes. Location doesn't determine whether content is concerning —
    // a person in a bikini on a beach is the same as in a studio.

    // FINAL UNIFORM TEXTURE CAP (runs after ALL boosts)
    // If uniformRatio > 0.35 AND hasBodyShape === false, cap at 20
    if (analysis.uniformRatio !== undefined && analysis.uniformRatio > 0.35 &&
        analysis.hasBodyShape === false) {
      const uniformCap = 20;
      if (score > uniformCap) {
        console.log('ScrollVeil: Final uniform texture cap - uniformRatio: ' +
                    (analysis.uniformRatio * 100).toFixed(1) + '%, no body shape. Capping score from ' + score + ' to ' + uniformCap);
        score = uniformCap;
        reasons.push('Uniform texture (no body shape)');
      }
    }

    // ===== SCENE CONTEXT MODIFIER =====
    // Apply score adjustments based on detected objects in the scene.
    // Only intimate settings BOOST the score. Other contexts are informational only.
    if (sceneContext.scoreModifier !== 0 && score > 15) {
      score += sceneContext.scoreModifier;
      reasons.push(sceneContext.description);
      console.log('ScrollVeil: Scene context modifier applied: ' + (sceneContext.scoreModifier > 0 ? '+' : '') + sceneContext.scoreModifier + ' (' + sceneContext.description + ')');
    }
    // Even if no score change, note the scene type in reasons for the description system
    else if (sceneContext.sceneType !== 'unknown' && sceneContext.description) {
      reasons.push(sceneContext.description);
    }
    // If NO objects detected AND person present with significant skin, note isolation
    if (sceneContext.isolated && score > 30) {
      score += 10;
      reasons.push('Isolated subject (no context objects)');
      console.log('ScrollVeil: No context objects detected with person — +10 isolation boost');
    }

    // Update the reason in the analysis object
    const finalReason = reasons.length > 0 ? reasons.join(', ') : 'Safe content';
    analysis.reason = finalReason;

    // Apply BlazeFace portrait cap if face was prominent but not dominant enough for early return
    if (analysis._faceScoreCap && score > analysis._faceScoreCap) {
      console.log('ScrollVeil: Face score cap applied — score ' + score + ' → ' + analysis._faceScoreCap + ' (face covers ' + (analysis._faceRatio * 100).toFixed(1) + '%)');
      score = analysis._faceScoreCap;
      if (reasons.indexOf('Portrait / face close-up') < 0) {
        reasons.push('Portrait / face close-up');
        analysis.reason = reasons.join(', ');
      }
    }

    // CLOTHING DETECTION SCORE REDUCTION
    // When MobileNet detects covering clothing (suit, jersey, jeans, etc.) with good confidence,
    // reduce the score because the skin detection was likely picking up warm-toned fabric.
    // The skinMap was already adjusted by applyClothingOverride, but this provides an additional
    // scoring cap for cases where some false skin pixels survived the override.
    if (analysis.clothingType && analysis.clothingConfidence > 0) {
      const coverageType = ScrollVeilDetector.CLOTHING_COVERAGE_MAP[analysis.clothingType] || 'none';
      if (coverageType === 'full' || coverageType === 'torso_and_legs') {
        // Full body clothing detected — person is dressed, cap score low
        const cappedScore = Math.min(score, 15);
        if (cappedScore < score) {
          console.log('ScrollVeil: Clothing override cap — ' + analysis.clothingType +
            ' (' + (analysis.clothingConfidence * 100).toFixed(0) + '%) → capping ' + score + ' → ' + cappedScore);
          score = cappedScore;
          reasons.push('Clothing detected: ' + analysis.clothingType);
        }
      } else if (coverageType === 'torso') {
        // Upper body covered — cap score moderately
        const cappedScore = Math.min(score, 30);
        if (cappedScore < score) {
          console.log('ScrollVeil: Clothing override cap — ' + analysis.clothingType +
            ' (torso) (' + (analysis.clothingConfidence * 100).toFixed(0) + '%) → capping ' + score + ' → ' + cappedScore);
          score = cappedScore;
          reasons.push('Clothing detected: ' + analysis.clothingType);
        }
      } else if (coverageType === 'legs') {
        // Legs covered — reduce score somewhat
        const cappedScore = Math.min(score, 40);
        if (cappedScore < score) {
          console.log('ScrollVeil: Clothing override cap — ' + analysis.clothingType +
            ' (legs) (' + (analysis.clothingConfidence * 100).toFixed(0) + '%) → capping ' + score + ' → ' + cappedScore);
          score = cappedScore;
          reasons.push('Clothing detected: ' + analysis.clothingType);
        }
      }
      // 'minimal' and 'minimal_legs' (bikini/swimwear) → no reduction, skin is real
    }

    // Update analysis.reason with final reasons list (including any clothing additions)
    analysis.reason = reasons.join(', ');

    return Math.min(score, 100);
  }
}

window.ScrollVeilDetector = ScrollVeilDetector;
console.log('ScrollVeil: Detector class loaded');