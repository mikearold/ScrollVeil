# ScrollVeil Development Log — Archive (Feb 2026)

> This file contains development log entries from February 1–24, 2026.
> For current entries, see [DEVLOG.md](DEVLOG.md).

---

## 2026-02-24 — Workbench Cleanup: Removed Anime/Edge/Contour/Geometric Systems

### What Was Removed
Comprehensive cleanup of `workbench.html` to match the live extension cleanup (detector.js, content.js already cleaned earlier today). Removed all references to systems that were causing false positives and are no longer in the detection pipeline.

### Systems Removed from Workbench
1. **Edge/Sobel detection** — PASS 2 in `analyzeCombined()`, edge overlay drawing in both `drawOverlays()` and `drawOverlaysOnCanvas()`, `edgeMap` from all overlayData objects and snapshot storage
2. **Contour detection** — Entire contour overlay drawing block (all contours, body contours, best body, Sobel edge map), contourData references, CONTOUR DETECTION pipeline details section
3. **Anime face detection** — `isAnimeSkin()` calls in pixel loop, anime face fallback in cache reconstruction, `animeFaces` from overlayData, `isAnimeFallback` guard, anime reason color coding
4. **Geometric zone fallback** — Removed from both main analysis path and `analyzeImageFullConfigurable()`, including config-aware proportions
5. **Body shape/edge analysis** — `analyzeBodyShapeFromEdgeMap()`, `analyzeAnatomicalFeatures()`, `analyzeSkinClusters(edgeMap)` calls, BODY SHAPE & EDGE pipeline details section
6. **`isAnimeStyle` variable** — Removed from `analyzeCombined()`
7. **`analyzeCombinedConfigurable()`** — Simplified to passthrough (no longer needs edge threshold handling)

### What Was Kept
- `analyzeCombined()` core pixel loop (skin detection with YCrCb + RGB + texture variance filter)
- `analyzeSkinClusters()` call without edgeMap parameter (kept in detector.js methods)
- `drawOverlays()` layers: Skin mask, COCO-SSD boxes, BlazeFace faces, BlazePose skeleton, Body zones, BBox mask, Exclusion mask, Body outline polygon, Clothing override
- All slider groups except Edge Detection, Contour Detection, Geometric Zone Proportions, Anime HSL
- Instrument toggles: COCO-SSD, BlazeFace, BlazePose, Skin YCrCb, Skin RGB, Face/Arm Exclusion, BBox Masking, Clothing Override

### Line Count
- Before: 3827 lines
- After: 3582 lines (245 lines removed)
- Zero remaining references to removed systems

### Files Modified
- `workbench.html` — comprehensive cleanup (74 individual references removed)
- `DEVLOG.md` — this entry

---

## 2026-02-24 — Fix: Workbench Clothing Override Not Running

### Problem
MobileNet clothing classification ran correctly in the workbench (showing predictions like "trench coat 59.9%"), but the Pipeline Details showed "Clothing Type: None detected" and no clothing override was applied to the skin map or score.

### Root Cause
The `analyzeImageFull()` method in the workbench's `ScrollVeilDetectorWorkbench` class did not accept `clothingData` as a parameter. A comment at line 2794 explicitly stated: "Clothing override: skipped in non-configurable analyzeImageFull (clothingData not a parameter)." Only the `analyzeImageFullConfigurable()` path (used by live slider re-analysis) handled clothing override. Both call sites in the initial analysis passed only 6 parameters, omitting `clothingData`.

### Fix
1. Added `clothingData` as 7th parameter to `analyzeImageFull()` method signature
2. Replaced the "skipped" comment with full clothing override logic (identical to `analyzeImageFullConfigurable`): calls `applyClothingOverride()`, stores type/confidence/pixelsRemoved on combined analysis, recalculates skin ratio, updates skinMap snapshot for overlay
3. Updated both call sites (gallery batch analysis + main analysis) to pass `clothingData`
4. Added `clothingType`, `clothingConfidence`, `clothingPixelsRemoved` to the return object
5. Passed `clothingData` to `calculateScore()` for complete scoring cap integration

### Files Modified
- `workbench.html` — `analyzeImageFull()` signature + clothing override logic + return object + 2 call sites + `calculateScore` call
- `DEVLOG.md`

---

## 2026-02-24 — Clothing Detection in Popup Details

### Problem
MobileNet clothing classification was running and affecting scores (capping and skin map override), but users had no visibility into what clothing was detected. The details popup showed visual score, detection reasons, and language score — but nothing about clothing.

### Fix
Added clothing detection info to two places in `content.js`:

1. **Scene summary** (`getSceneSummary()`) — When clothing is detected, appends "[clothing type] ([confidence]%) detected" to the one-line summary shown at the top of the popup.

2. **Popup details section** (`showUnblurPopup()`) — New "Clothing Detection" section between Visual Score and Language Score, showing clothing type with confidence percentage and a 👕 icon. Uses light blue (#4fc3f7) color for the clothing line.

### Files Modified
- `content.js` — `getSceneSummary()` clothing extras, `showUnblurPopup()` clothing section + innerHTML assembly
- `DEVLOG.md`

---

## 2026-02-24 — Workbench Instrument Toggles

### Feature
Added "Instrument Toggles" panel to the Detection Workbench. Each detection instrument can be individually disabled to see how it affects the final score — useful for understanding which layers are contributing to or reducing scores.

### Instruments Available
1. **COCO-SSD** — Person detection (nulls personBboxes and personCount when off)
2. **BlazeFace** — Face detection (nulls BlazeFace faceData when off)
3. **BlazePose** — Skeleton detection (nulls poseData when off, forces geometric zone fallback)
4. **Anime Face** — Pixel-based anime face detection (skips anime face fallback when off)
5. **Skin YCrCb** — YCrCb color space skin detection (returns false always when off)
6. **Skin RGB** — RGB skin detection (returns false always when off)
7. **Skin Anime HSL** — Anime HSL skin detection (returns false always when off)
8. **Face/Arm Exclusion** — Exclusion zones (skips exclusion mask when off)
9. **BBox Masking** — Background pixel masking (skips background zeroing when off)
10. **Clothing Override** — MobileNet clothing classification (skips skin removal in clothed areas when off)

### Implementation
- Toggles read at the start of `reanalyzeWithConfig()` and passed as `inst` object
- Disabled AI models have their data nulled before passing to `analyzeImageFullConfigurable()`
- Disabled skin detectors have their override functions return `false` unconditionally
- Disabled pipeline steps (exclusion, bbox mask, clothing) are skipped via `inst.*` guards in `analyzeImageFullConfigurable()`
- `clothingData` now cached in `cachedModelOutputs` and passed through to configurable analysis
- Toggling any instrument triggers instant re-analysis (same 150ms debounce as sliders)

### Files Modified
- `workbench.html` — new HTML panel, event listeners, `getInstrumentToggles()` helper, guards in `reanalyzeWithConfig()` and `analyzeImageFullConfigurable()`
- `DEVLOG.md`

---

## 2026-02-24 — MobileNet Clothing Classification Integration

### Problem
Skin detection (YCrCb + RGB + Anime) was flagging warm-toned clothing (red, brown, dark fabric) as skin. Texture variance filter (see below) helped but was insufficient. Needed a model that could identify *what* a person is wearing to override false-positive skin pixels.

### Solution: MobileNet V2 (ImageNet 1000 classes)
Selected MobileNet V2 as clothing classifier — already TF.js-ready, ~7MB weights loaded from CDN, trained on ImageNet (web photos of clothed people, no nudity). Ethically clean training data.

### Architecture
MobileNet is a **classification** model (not detection). It analyzes the whole cropped person image and returns "this contains: suit 72%, jersey 15%, bikini 3%". Complements existing pipeline:
- COCO-SSD → person bounding box (detection)
- BlazePose → skeleton keypoints (pose)
- MobileNet → clothing classification (what they're wearing)
- 7-zone system → anatomical skin measurement

### Pipeline Integration (6-step flow)
1. COCO-SSD detects person → bounding box
2. BlazePose detects pose → skeleton keypoints
3. MobileNet classifies clothing type on cropped person
4. Skin detection runs → builds skinMap (YCrCb + RGB + Anime)
5. **Clothing override**: Map clothing class + BlazePose keypoints → coverage regions → zero out false-positive skin pixels in covered areas
6. Body zone measurement runs on cleaned skinMap → accurate scoring

### Automatic 0% Rule
If COCO-SSD finds no person → immediate 0% score, skip entire pipeline. No person = no pose = no clothing = nothing to score.

### Clothing Coverage Map (42 ImageNet classes mapped)
- **Full body** (torso+legs): suit, gown, cloak, lab coat, trench coat, kimono, etc.
- **Torso only**: jersey, T-shirt, sweatshirt, cardigan, apron, etc.
- **Torso + legs**: jeans
- **Legs only**: sarong, overskirt
- **Minimal** (bikini/swimwear — skin is real, no override): bikini, maillot, brassiere, swimming trunks
- **None** (accessories, ignored): hats, sunglasses, shoes, bags, watches

### Scoring Caps (in calculateScore)
- Full body clothing (suit, gown) → cap score at 15%
- Torso clothing (jersey, T-shirt) → cap score at 30%
- Leg clothing (sarong) → cap score at 40%
- Minimal/swimwear → no cap (skin is genuine)

### Confidence Gates
- MobileNet must be >30% confident about a clothing class before override applies
- BlazePose keypoints must have >0.3 score for shoulders/hips before defining coverage regions
- If MobileNet returns only generic classes (person, stage), skip override entirely

### Files Modified
- `sandbox.html` — added MobileNet library script tag
- `lib/mobilenet.min.js` — downloaded @tensorflow-models/mobilenet v2.1.1 (~33KB library, weights loaded from CDN at runtime)
- `sandbox.js` — MobileNet model loading (loadMobilenet function), classification in detection handler (crops each person bbox, classifies top 10), sends clothing data in detectResult
- `offscreen.js` — passes clothing data through to content scripts, handles mobilenetModelReady event
- `detector.js` — clothingData variable, applyClothingOverride method (BlazePose keypoints → coverage rectangles → skinMap zeroing), CLOTHING_COVERAGE_MAP static property (42 classes), calculateScore clothing caps, tryAnalyzeImage parameter threading

### Key Decisions
1. MobileNet V2 alpha 1.0 for best accuracy (vs alpha 0.25 for speed)
2. Model weights loaded from tfhub.dev CDN (not bundled — too large at ~7MB)
3. Library JS bundled locally (33KB) like other TF.js model libraries
4. Top 10 predictions requested (not just top 3) for better clothing class coverage
5. Coverage rectangles use 5px padding for torso, 30% horizontal padding for legs

## 2026-02-24 — Texture Variance Filter (Clothing False Positive Fix)

### Problem
Skin detection was flagging warm-toned clothing (red, brown, dark fabric) as skin. In the workbench pixel inspector, dark clothing pixels (e.g., RGB 48,32,22 → Cr=137, Cb=120) were passing YCrCb skin checks because their chrominance fell within skin ranges. This inflated skin ratios and caused false positives on clothed characters.

### Solution: Texture Variance Post-Filter
Added a second pass after the skin map is built that checks the **local texture** around each skin pixel. Real skin has subtle pixel-to-pixel variation (pores, gradients, subsurface scattering). Flat-shaded clothing and uniform fabric have near-zero chrominance variance.

**How it works:**
1. For each pixel marked as skin in the skinMap, sample a 7×7 neighborhood (every 2nd pixel for speed)
2. Calculate the standard deviation of Cr (red chrominance) values in that neighborhood
3. If Cr std dev < threshold (default 3.0) → pixel is too uniform → remove from skinMap
4. After removals, recount all skin statistics (skinPixels, zone counts, color sums)

### Parameters (Tunable via Workbench)
- **Min Cr Variance** (default 3.0): Minimum Cr standard deviation to keep a skin pixel. Lower = more aggressive filtering. Range 0–15.
- **Neighbor Radius** (default 3): Half-size of check window. 3 = 7×7 neighborhood. Range 1–6.

### Files Modified
- `detector.js` — Added `filterSkinMapByTexture()` method + call after main pixel loop with recount
- `workbench.html` — Added config defaults, slider group "Texture Variance Filter", and texture filter in workbench analysis code

### Testing
1. Open workbench, load an image with warm-toned clothing
2. Enable "Skin Detection Mask" overlay
3. Adjust "Min Cr Variance" slider — higher values remove more uniform areas
4. Watch red skin mask shrink on clothing while remaining on actual skin
5. Console will log how many pixels were removed

### Key Insight
Color-only skin detection has an inherent limitation: some fabrics match skin chrominance ranges. The texture check adds a second dimension (spatial variance) that color checks alone can't provide. Real skin is never perfectly uniform at the pixel level.

## 2026-02-24 — Fix: Double Badges on Grok Imagine (Image + Video Overlap)

### Problem
On grok.com/imagine, each content card contains both an `<img>` and a `<video>` element in the same parent `<div>`. ScrollVeil's image pipeline AND video pipeline both fired on the same visual content, creating stacked duplicate badges (e.g., "Analyzing 0% | Reveal" from images on top of "60% | Reveal" from video frame sampling).

### Root Cause
Grok Imagine uses `<video>` elements for animated previews with `<img>` fallbacks in the same container. Both `processImage()` and `processVideo()` independently detected and badged the same content area.

### Root Cause
Grok Imagine uses `<video>` elements for animated previews with `<img>` fallbacks in the same container. Both pipelines detected the same content area. Additionally, both images AND videos are served from `imagine-public.x.ai` (cross-origin), causing canvas tainting — `toDataURL()` throws DOMException, making analysis return 0%.

### Fix (Final — Video Pipeline Owns Grok)
The image pipeline's reveal broke on Grok because React swaps `<img>` DOM nodes, making closure references stale. The video pipeline's reveal works because `<video>` elements are stable.

1. **Skip ALL images on Grok**: `processImage()` returns immediately on `grok.com`, marking images as safe/processed so the CSS shield doesn't blur them.
2. **Video pipeline handles everything**: Videos process normally with frame sampling. Cross-origin canvas tainting triggers the thumbnail fallback.
3. **Cross-origin thumbnail fallback**: When `sampleOneFrame()` hits DOMException, it CORS re-fetches the sibling `<img>` thumbnail and runs `analyzeImage()` on it. Sets both `state.visualScore` and `state.peakScore` so badges display real scores.
4. **Sibling image skip guarded**: The video pipeline's "skip if sibling image processed" check is bypassed on Grok so videos always process.

### Files Modified
- `content.js` — added img+video sibling check, registry sweep in cleanup and detecting badge

---

## 2026-02-24 — Launch Prep: Report Bug, Restore Defaults, Dark/Light Mode

### Features Added

#### 1. Report Bug / False Positive / False Negative (popup)
- New collapsible report form in the popup with three report types: False Positive, False Negative, Bug
- Auto-captures the current tab's URL
- Pulls detection details from content script via `chrome.runtime.onMessage` listener
- User can add an optional description
- Sends report via `mailto:` link (opens default email client with pre-filled subject, body, and environment info)
- Rolling detection log buffer in content.js (last 50 detections) feeds the report details

#### 2. Restore Defaults Button
- Defined `SCROLLVEIL_DEFAULTS` object as single source of truth for all default settings:
  - `blurStrength: 100`, `autoUnblurThreshold: 20`, `videoInterval: 3`, `videoDuration: 30`, `earlyExitThreshold: 75`
- "Restore Defaults" button resets UI sliders/dropdowns AND saves to chrome.storage.sync
- Confirmation feedback on button after reset

#### 3. Dark/Light Mode Support
- Complete CSS overhaul using CSS custom properties (variables) for all colors
- `@media (prefers-color-scheme: dark)` media query auto-switches between themes
- Dark theme: deep navy background (#1a1a2e), light text, muted borders
- Light theme: white background, dark text (existing look preserved)
- All form elements (sliders, selects, textareas, buttons) respect the theme
- Report form has its own themed background section

#### 4. UI Polish
- Cleaner layout with section dividers and consistent spacing
- System font stack for better native appearance
- Slider values displayed inline with their sliders
- Button styles: primary (green), secondary (outlined), report (orange)
- Version badge in header

### Files Modified
- `popup.html` — complete rewrite with CSS variables and new UI sections
- `popup.js` — complete rewrite with defaults object, restore button, report form logic
- `content.js` — added detection log buffer + `chrome.runtime.onMessage` listener for report data
- `DEVLOG.md` — this entry

### Technical Notes
- Report uses `mailto:` protocol — no server/API needed, works offline, user controls sending
- Detection log is in-memory only (privacy-respecting), limited to 50 entries, resets on page navigation
- Dark mode detection is automatic via CSS media query — no toggle needed, follows system setting
- `SCROLLVEIL_DEFAULTS` object makes it easy to add new settings with defaults in one place

---

## 2026-02-24 — Removed Contour Detection Fallback from Live Extension

### Problem
Massive false positives on normal content — vegetables, text screenshots, social media posts, and fully clothed people in suits scoring 100%. Root cause identified on a video of a man in a business suit: COCO-SSD correctly detected 1 person, but the skin-density anchoring collapsed the body region to just his face area (159x100px). The geometric zone measurement then treated his face as the entire body, reporting 100% skin in shoulders, chest, waist, hips, thighs, calves, and feet. The contour body detection path applied a +100 score boost for "7 exposed zones."

### Root Cause
The contour detection + skin-density anchoring + geometric zone fallback pipeline created cascading false positives:
1. Contour fallback created synthetic person bboxes when COCO-SSD found nothing (flagging vegetables, screenshots)
2. Skin-density anchoring collapsed body regions to tiny areas where skin was concentrated (faces)
3. Geometric zones within those tiny areas showed near-100% skin in every zone
4. Score boosts treated this as full body exposure

### Fix (Option C — Full Rollback)
Removed three components from `detector.js`:
1. **Contour fallback in `analyzeImage()`** — When COCO-SSD finds no people, now returns "no people detected" immediately instead of running contour detection and creating synthetic bboxes
2. **Geometric zone fallback** — Removed the path that created geometric body zones from contour bounding boxes
3. **`looksLikeContourBody` scoring** — Removed the contour body detection flag, its score floor (35), and all references in early-exit checks and uniform texture caps

### What Was Preserved
- All contour detection functions remain in detector.js (used by workbench for research)
- Core pipeline intact: COCO-SSD → BlazeFace → BlazePose → skin analysis → scoring
- `looksLikeHumanBodySkin`, `looksLikeHumanBodyShape`, `hasSkinEdgeCorrelation`, `looksLikeAnimeBody` all unchanged
- Pose-based zone measurement unchanged

### Trade-off
Anime/illustrated content detection is reduced (back to "best effort"). This was the agreed plan for launch — real photos with COCO-SSD + BlazePose cover 95%+ of web content. Custom anime detection model planned for post-launch.

### Files Modified
- `detector.js` — removed contour fallback, geometric zone fallback, contourBody scoring

---

## 2026-02-24 — YouTube Shorts Watch Page Support

### Problem
YouTube Shorts at `/shorts/` URLs were getting blurred (via CSS shield or YouTube's own styles) but had no ScrollVeil badge or overlay — no way to reveal them.

### Root Cause
`processVideo()` only allowed videos on `/watch` pages. Shorts use `/shorts/` URLs, so they were skipped entirely — the video was added to `processedVideos` WeakSet and ignored. The container detection (`getVideoContainer`) already supported `#shorts-player`, but the gatekeeper check blocked Shorts videos from ever reaching it.

### Fix
1. **`processVideo()`** — Added `/shorts/` as an allowed path alongside `/watch`
2. **SPA navigation handler** — Extended to also detect `#shorts-player` and reset state on `/shorts/` URL changes

### Technical Notes
- Shorts player (`#shorts-player`) positions video at `top: 0px` (IN viewport), unlike watch page (`#movie_player`) which positions video at `top: -483px` (off-screen)
- Container blur works for both since `getVideoContainer` already matches `#shorts-player` as `isYTPlayer: true`
- Shorts SPA navigation reuses the same player container, same as watch pages

### Files Modified
- `content.js` — processVideo() YouTube gate, SPA navigation handler

---

## 2026-02-24 — YouTube SPA Navigation Fix

### Problem
YouTube watch page videos worked inconsistently — sometimes blurred correctly, sometimes no blur at all. The pattern: navigating between videos within YouTube (SPA navigation) failed, but a full page refresh always worked.

### Root Cause
YouTube is a Single Page Application — clicking a video link doesn't reload the page, it just swaps the video content. The `#movie_player` container and `<video>` element are **reused** across navigations. Our dedup system (`processedVideos` WeakSet + `container._scrollveilProcessed`) saw the container as "already processed" and skipped it entirely for the new video.

### Fix
Added YouTube SPA navigation detection to the existing URL-change interval. When a YouTube watch page URL changes:
1. Reset `_scrollveilProcessed` on `#movie_player`
2. Remove video from `processedVideos` WeakSet
3. Clear all attributes and blur state
4. Clean up old overlays and cancel old frame sampling
5. Clear video session cache

This lets the periodic video scanner re-detect and re-process the video with fresh analysis.

### Files Modified
- `content.js` — URL change interval handler

---

## 2026-02-24 — X/Twitter Video Reveal Fix (tweetPhoto CSS Shield)

### Problem
On X/Twitter, revealing a video after analysis completed would show "Reblur" badge but the video stayed visually blurred. Reveal during analysis worked fine.

### Root Cause
X wraps videos in a nested hierarchy: `tweetPhoto` > `videoPlayer` > `videoComponent` > `video`. The CSS shield rule `[data-testid="tweetPhoto"]:not([data-scrollveil-analyzed])` applies blur to `tweetPhoto`. Our code was marking `videoPlayer` as analyzed but never touching `tweetPhoto`, so the CSS shield kept blurring the outer container even after reveal cleared the inner one.

### Fix
Added `tweetPhoto` handling in 4 locations:
1. **`markVideoSafe()`** — marks tweetPhoto as `safe` and clears its filter
2. **`blurVideo()` blur branch** — marks tweetPhoto as `filtered` to disable CSS shield (JS handles blur)
3. **`blurVideo()` reveal handler** — clears tweetPhoto on reveal
4. **`blurVideo()` reblur handler** — re-marks tweetPhoto as `filtered`

### Files Modified
- `content.js` — markVideoSafe(), blurVideo() blur/reveal/reblur branches

---

## 2026-02-24 — YouTube Watch Page Video Fix

### Problem
YouTube watch page videos had no blur or badge visible. The `<video>` element technically had `blur(30px)` applied, but YouTube positions it at `top: -483px` and clips it with `overflow: hidden` on `#movie_player`. The blur was on an invisible element. Additionally, the IntersectionObserver (threshold 0.5) never fired because the `<video>` element never reached 50% visible area due to the CSS clipping.

### Root Cause
The frame sampling system (added Feb 22) observes the `<video>` element for viewport visibility. On YouTube, the `<video>` is positioned off-screen by the player — `#movie_player` is the visible container. The 0.5 threshold IntersectionObserver never triggered, so frame sampling never started and no badge was created.

### Fix
On YouTube watch pages, observe the **container** (`#movie_player`) instead of the `<video>` element for the IntersectionObserver. Store a `_scrollveilVideo` reference on the container so the observer callback can find the actual video element for frame analysis.

### Files Modified
- `content.js` — `processVideo()` observe target + IntersectionObserver callback

---

## 2026-02-24 — Video Re-blur Double Blur Fix (X/Twitter)

### Problem
On X/Twitter, clicking Reblur on a video added a second layer of blur on top of the existing one. Clicking Reveal didn't fully unblur the video either — the top/first video was especially affected.

### Root Cause
The re-blur click handler was calling `xContainer.removeAttribute('data-scrollveil-analyzed')` and `video.removeAttribute('data-scrollveil-analyzed')`. This caused the **CSS shield** rule `[data-testid="videoPlayer"]:not([data-scrollveil-analyzed]) { filter: blur() }` to re-activate, stacking on top of the JS inline blur that the handler also applied. Two blurs = double blur.

### Fix
Changed re-blur handler to **keep** `data-scrollveil-analyzed="filtered"` on both the container and video element instead of removing it. This keeps the CSS shield turned off and lets only the JS enforcement tracker manage the blur — single source of truth, no stacking.

### Files Modified
- `content.js` — re-blur click handler in `blurVideo()`

---

## 2026-02-23 — Detection Workbench: Video Frame Analysis Mode

### What It Does
Added video support to the Detection Workbench (workbench.html). You can now drop a video file into the same workbench used for images, and it will:
1. Play the video in an embedded player
2. Sample frames at a configurable interval (1s, 2s, 3s, 5s, 10s)
3. Run the **full detection pipeline** (COCO-SSD → BlazeFace → BlazePose → contour fallback → skin analysis → scoring) on each sampled frame
4. Display a **filmstrip** of thumbnail frames with color-coded score badges
5. Show a **score timeline bar** visualizing score over time
6. Click any thumbnail or timeline bar to load that frame into the main canvas with **full overlay visualization** (bounding boxes, pose skeleton, skin mask, body zones, etc.)
7. "Stop" button to cancel mid-analysis

### Architecture
- Same file, two modes: image vs. video, determined by file type at drop/browse
- `handleFileInput()` routes to `loadImageFile()` or `loadVideoFile()`
- `startVideoAnalysis()` seeks video to each sample point, captures frame to canvas, converts to Image, runs `analyzeVideoFrame()` (full pipeline)
- Each frame's overlay data is snapshotted so clicking a thumbnail restores all overlay layers
- Score timeline uses absolute-positioned bars with color matching the score thresholds

### Files Modified
- `workbench.html` — ~420 lines added (HTML, CSS, JavaScript)
- `DEVLOG.md` — this entry

---

## 2026-02-23 — X/Twitter Video Reveal Fix (First Video Only)

### Problem
On X/Twitter, the first video on the page (or first video when opening a post) would not unblur after clicking Reveal in the popup. Subsequent videos worked fine.

### Root Cause (Suspected)
The `blurVideo()` function captures `xContainer` in a closure when the video is first blurred. On X, React's initial hydration pass can replace the DOM container after we blur it. By the time the user clicks Reveal, the closed-over `xContainer` reference points to an orphaned DOM node — the blur gets removed from the old container, but the visible (new) container stays blurred. Subsequent videos don't undergo hydration so their container references stay valid.

### Fix
Modified the onReveal handler inside `blurVideo()` to:
1. **Re-lookup the container fresh** via `getVideoContainer(video)` at reveal time
2. Remove blur from the **fresh** container
3. Also clear the **original** closed-over container (in case it's a different DOM node)

Reverted the CSS shield exemption for X videos (from earlier attempt) since that wasn't the root cause and the CSS shield is needed for initial protection.

### Fix (Attempt 2 — Unblur Enforcement Tracker)
The fresh container lookup wasn't sufficient. The real issue is the **CSS blur shield**: `video:not([data-scrollveil-analyzed]) { filter: blur() !important }`. React strips both `data-scrollveil-analyzed` AND inline styles from `<video>` elements, so the CSS rule immediately re-blurs the video after reveal.

Solution: Register an **unblur enforcement tracker** on the video element after reveal. This runs on every animation frame and re-applies `filter: none !important` + `data-scrollveil-analyzed="safe"` whenever React strips them. The tracker auto-unregisters when `video._scrollveilBlurred` is set to `true` (i.e., when user clicks Re-blur).

Also added explicit cleanup of the unblur enforcement tracker in the re-blur click handler.

### Files Modified
- `content.js` — Fresh container lookup in onReveal + unblur enforcement tracker + re-blur cleanup

## 2026-02-23 — Video Popup Detection Details

### Problem
Video popups (both the reveal confirmation and the details-only popup) were not showing detection details like image popups do. Instead of showing reasons like "1 person detected", "Moderate skin visible", "Outdoor/recreation setting", etc., video popups showed a raw technical string like "Visual: 12% (Peak: 18%)" with no scene summary, no person count, and no detection reasons.

### Root Cause
During frame sampling, only `result.score` was stored in `state.frameScores`. The full detection result from `detector.analyzeImage()` (which includes `reason`, `personCount`, `sceneObjects`) was discarded. When result objects were later built for the popup, the `reason` field was a manually constructed string instead of the actual detection reasons from the peak frame.

### Fix
1. **Store peak frame's full result** — When a new peak score is found during frame sampling, now also stores `state.peakResult = result` (the complete detector output).
2. **Updated all 5 result-building locations** to pull `reason`, `personCount`, and `sceneObjects` from `state.peakResult`:
   - Reveal click during analysis
   - Details click on badge during analysis
   - Final blurred video result in `finalizeVideoAnalysis()`
   - Safe video auto-unblur result
   - All fall back gracefully if `peakResult` isn't available yet

### Result
Video popups now show the same rich detection details as image popups: person count, translated detection reasons, scene summary, plus the existing language analysis section.

### Files Modified
- `content.js` — 5 edits: peakResult storage, 4 result object updates

## 2026-02-23 — Anime Face False Positive Filter

### Problem
The anime face detector was misidentifying body/torso regions as faces (e.g. chest area detected as "Anime 40%"). This caused two cascading issues:
1. Body zone boxes anchored to the wrong position (placed relative to the false "face")
2. Skin exclusion masking actual exposed skin (face regions get excluded from skin detection)

### Cause
`detectAnimeFaces()` returns faces with a confidence score based on skin ratio in the candidate region. Low-confidence detections (like 40%) were being accepted without any threshold check. Body areas with some skin, dark spots, and bright highlights could trigger false eye-pair detection.

### Fix
Added a minimum 50% confidence filter on anime face results before they're used. Legitimate anime faces typically score 70%+ so this rejects false positives without affecting real detections.

### Files Modified
- `detector.js` — added `.filter(f => f.probability >= 0.50)` to anime face acceptance (line ~225)
- `DEVLOG.md` — this entry

---

## 2026-02-23 — Workbench: Zone Box Coordinate Fix

### Problem
Body zone overlay boxes in the Detection Workbench were misaligned — squished into a small area instead of covering the actual body. Only "head" and "feet" would sometimes appear, offset to the top-right corner.

### Cause
When the workbench ran BlazePose and BlazeFace, it set `poseData.imageWidth/imageHeight` and `faceData.imageWidth/imageHeight` to the **original image dimensions** (e.g., 1920×1080). But the keypoint coordinates returned by the models were in the **detection canvas** coordinate space (max 300×300, aspect-ratio-correct, e.g., 300×169). 

In `measureBodyPartZones()`, the scale factors `scaleX = 299 / poseW` were dividing by the original image width instead of the detection canvas width, shrinking all zone coordinates by a factor of ~6x. Same issue affected face exclusion zones.

The extension's `sandbox.js` didn't have this bug because it didn't pass `imageWidth/imageHeight` at all, so the detector defaulted to 299 (close enough to the ~300px detection canvas).

### Fix
Changed `imageWidth`/`imageHeight` for both BlazePose and BlazeFace data to use the actual detection canvas dimensions (`poseCanvas.width/height` and `faceCanvas.width/height`) instead of `img.naturalWidth/naturalHeight`.

### Files Modified
- `workbench.html` — 2 lines changed (poseData and faceData imageWidth/Height)
- `DEVLOG.md` — this entry

---

## 2026-02-23 — Contour-Based Body Detection (New Fallback Layer)

### Problem
COCO-SSD fails to detect people in anime/drawn content, causing the entire pipeline to auto-safe. This means suggestive anime characters score 0% even when they clearly show body exposure. The "person detection gate" at the top of `analyzeImage()` would immediately return score 0, and no further analysis (skin, pose, zones) would run.

Example: Anime character with significant skin exposure — COCO-SSD found 0 persons, BlazeFace found 0 faces, anime face detection missed (possibly due to dark/stylized art), BlazePose found no pose. Complete pipeline failure → score 10, ALLOWED.

### Solution
Implemented a **contour-based body detection** system as a fallback layer. When COCO-SSD says "no people," the system now runs pure pixel analysis to detect humanoid body shapes regardless of art style, color grading, or rendering technique.

### How It Works (7-Step Pipeline)
1. **Grayscale conversion** — standard luminance formula
2. **Gaussian blur** (3×3 kernel) — reduces noise
3. **Sobel edge detection** — finds edges by measuring gradient changes (color-independent)
4. **Binary threshold** — adaptive, 20% of max gradient (min 30)
5. **Dilation** (3×3) — connects nearby edge fragments into continuous contours
6. **Flood-fill contour tracing** — groups connected edge pixels into regions, tracks bounding boxes
7. **Humanoid shape filter** — selects contours matching body proportions:
   - Aspect ratio 0.7–6.0 (allows seated to standing)
   - Covers ≥3% of image area
   - Minimum dimensions 30×40 pixels

### Integration
Modified the `hasPeople === false` gate in `analyzeImage()`:
- **Before**: Immediately returned score 0 (auto-safe)
- **After**: Runs contour detection first. If a body shape is found, creates a synthetic bounding box and continues to full geometric analysis (skin detection, zone measurement, etc.)

### Key Design Decisions
- Pure JavaScript, no libraries — consistent with anime face detector approach
- Runs ONLY when COCO-SSD fails (no performance impact on images that already work)
- Works at 299×299 analysis resolution (same as existing pipeline)
- Returns edge data and contour data for workbench visualization
- Contour results include all properties needed for debugging: aspect ratio, fill ratio, image extent

### Files Modified
- `detector.js` — added `detectBodyContours()` method (~200 lines), modified person detection gate (~30 lines)
- `detector.js` — added `measureBodyPartZonesGeometric()` method (~90 lines), integrated geometric zone fallback into pipeline
- `workbench.html` — added contour overlay visualization (checkbox, drawing code, pipeline details section)
- `workbench.html` — added contour fallback in workbench analysis path (Step 4), geometric zone fallback
- `workbench.html` — added `detectBodyContours` and `measureBodyPartZonesGeometric` to method inheritance list
- `DEVLOG.md`

### Workbench Contour Visualization
- New "Contour Detection (Body Shape)" checkbox in Overlay Layers panel
- Draws all detected contours as faint orange outlines
- Body-filtered contours shown as brighter dashed orange boxes with aspect ratio + extent labels
- Best body match highlighted with thick red/orange border and "★ BEST BODY" label
- Binary edge map shown as faint orange pixel overlay
- New "CONTOUR DETECTION" section in Pipeline Details with: body found, contour counts, aspect ratio, extent, fill ratio, threshold

### Geometric Zone Measurement
When BlazePose is unavailable but a contour/person bbox exists, the system now divides the bounding box into 7 anatomical zones using standard body proportions:
- Head: 0-12%, Shoulders: 12-20%, Chest: 20-35%, Waist: 35-45%
- Hips: 45-55%, Thighs: 55-75%, Calves: 75-90%, Feet: 90-100%
Measures skin within each zone and produces the same `_summary` structure as pose-based zones.
Added in both `detector.js` and `workbench.html` for consistency.

### Status
TESTING IN PROGRESS — contour detection and workbench visualization confirmed working. Geometric zones added and visible in overlay. Score fixed from 20→35 by exempting contour bodies from uniform texture cap.

### Bug Fixes
- **Score capped at 20 instead of 35**: The "Uniform texture (no body shape)" final cap was firing because `hasBodyShape === false` (edge-based geometry failed). Fixed by adding `!looksLikeContourBody` exception — contour detection IS body shape detection.
- **Also exempt contour body from early exit cap**: The `noBodyShapeGeometry` early exit now also checks `!looksLikeContourBody`.
- **Zone overlay invisible**: Geometric zones used `{y0, y1, x0, x1}` format but overlay drawing expected `{bounds: {left, top, right, bottom}}`. Fixed to match pose-based zone format.

### Workbench Adjustments Added
- **Contour Detection** slider group: Min/Max Aspect Ratio, Min Extent (%), Min Width/Height (px), Score Floor, Min Zones w/ Skin
- **Geometric Zone Proportions** slider group: Shoulders Start/End, Chest End, Waist End, Hips End, Thighs End, Calves End
- Config-aware `measureBodyPartZonesGeometricConfig()` method for re-analysis with adjusted proportions

### Anime Skin Detection Fix
Using the new Pixel Inspector tool, discovered that anime character skin with pale/yellow-green tones (G > R pixel values, Hue ~0.22) was invisible to all three skin detectors. Only pink hair (H=0.05) and red bra (H=0.089) were being detected.

**Fix — Anime skin detector range expansion** (`detector.js isAnimeSkin()`):
- Hue Max: 0.12 → **0.25** (catches yellow-green pale anime skin)
- Saturation Min: 0.2 → **0.1** (catches very desaturated anime skin)
- Lightness Min: 0.55 → **0.50** (catches slightly darker tones)

### Workbench Pixel Inspector
New diagnostic tool: click any pixel to see RGB/HSL/YCrCb values and ✅/❌ per detector with failure reasons. Essential for debugging skin detection misses.

### Skin-Density Anchored Body Zones
Zone placement was failing because zones covered the full contour bbox (including hair/background above body). Zones were shifted up — "shoulders" at hair level, "hips" at chest level.

**Fix — Skin density profiling** (`detector.js measureBodyPartZonesGeometric()`):
1. Scan each row in contour bbox, count skin pixel density per row
2. Find bodyTop (first row with ≥3% skin) and bodyBottom (last row with ≥3% skin)
3. Scan columns to find bodyLeft/bodyRight edges (≥2% skin density)
4. Apply zone proportions to the skin-anchored body region, not the full bbox
5. Added "head" zone from bbox top to bodyTop (where skin starts)

**Updated zone proportions** (now relative to body region, not bbox):
- Shoulders: 0.00–0.10, Chest: 0.10–0.28, Waist: 0.28–0.38
- Hips: 0.38–0.50, Thighs: 0.50–0.72, Calves: 0.72–0.90, Feet: 0.90–1.00

## 2026-02-23 — Workbench Phase 3: Gallery & Testing System

### Feature
Added persistent test image gallery with batch processing to the Detection Workbench. This completes the three-phase workbench build (Phase 1: overlays/scoring, Phase 2: live adjustment sliders, Phase 3: gallery/testing). The gallery doubles as a future training dataset foundation for custom detection models.

### What Was Added

#### IndexedDB Storage
- `ScrollVeilGallery` database with `images` object store
- Full CRUD operations (add, get, getAll, update, delete)
- Stores full-resolution images as data URLs + 150px JPEG thumbnails
- Indexes on `category` and `dateAdded` for efficient querying

#### Save-to-Gallery Form
- Appears automatically after each image analysis
- Category dropdown with 8 defaults + custom category option
- Expected score range (min/max) — pre-filled ±15 from actual score
- Notes textarea for documenting edge cases
- Stores detection metadata for future model training

#### Gallery View
- Toggle button swaps between Analysis and Gallery views
- Thumbnail grid organized by category with collapsible sections
- Color-coded pass/fail indicators based on expected score range
- Click thumbnail to load into analysis view and re-run pipeline
- Delete button with confirmation dialog

#### Batch Processing ("Run All")
- Full pipeline re-analysis of every gallery image
- Progress bar with cancel button
- Results table: thumbnail, category, expected range, actual score, pass/fail
- setTimeout chunking for UI responsiveness
- Summary stats on completion

#### Export/Import
- Export Gallery: JSON file with images, categories, notes, detection metadata
- Import Gallery: additive restore from JSON
- Export CSV: batch results for spreadsheet analysis
- Format designed for future model training dataset

### Architecture Decisions
- IndexedDB over localStorage (gigabytes vs 5-10MB)
- No Web Workers (TF.js models can't be serialized); setTimeout chunking instead
- Separate thumbnails (150px JPEG 70%) for fast gallery rendering
- Monkey-patched loadImageFile and hideProcessing for Phase 1/2 integration

### Files Modified
- `workbench.html` — all changes
- `DEVLOG.md` — this entry

---

## 2026-02-23 — Video Analysis Settings UI (Phase 3 of Frame Sampling)

### Feature
Added user-configurable video analysis controls to the popup settings panel, replacing the previously hardcoded defaults (3s interval, 30s duration, 75% early exit).

### Changes Made

#### popup.html
- Added "🎬 Video Analysis" section with visual separator
- **Frame interval** dropdown: 1s / 2s / 3s (default) / 5s
- **Analysis duration** dropdown: Quick 10s / Standard 30s (default) / Thorough 60s / Full video
- **Early exit threshold** slider: 0–100%, default 75%, with explanatory help text

#### popup.js
- Added element references for the 3 new controls
- Extended `chrome.storage.sync.get()` to load `videoInterval`, `videoDuration`, `earlyExitThreshold`
- Added live % display update for the early exit slider
- Extended save handler to persist all 3 new settings

#### content.js
- Changed `VIDEO_SAMPLING_DEFAULTS` from `const` to `let` (mutable)
- Added `chrome.storage.sync.get()` call at startup to override defaults with user settings
- Added "Full video" handling: when duration = 0, uses `video.duration` (fallback 60s)
- Added `Math.max(1, ...)` guard to prevent zero-frame edge case
- Logs loaded settings to console for debugging

### Key Decisions
- Settings use `chrome.storage.sync` (same as blur/auto-unblur) — syncs across devices
- Defaults remain safe (3s/30s/75%) if user never touches settings
- "Full video" option caps at actual video duration, with 60s fallback if duration unknown

### Files Modified
- `popup.html`
- `popup.js`
- `content.js`
- `DEVLOG.md`

## 2026-02-22 — Workbench: Expanded Pipeline Details (Full Detection Readout)

### Feature
Expanded the Pipeline Details panel to show everything the detection system processes, organized into clear sections with headers.

### Sections Added
- **COCO-SSD Detection** — Person count, all COCO objects with class and confidence (e.g., "apple 72%, orange 65%"), scene objects (non-person detections)
- **Face Detection** — BlazeFace count and confidence per face, anime face count and confidence, anime classification flag
- **Pose Detection** — Number of keypoints above 30% confidence, individual joint confidence for key joints (shoulders, hips, knees)
- **Skin Analysis** — All skin ratios (total, upper, middle, lower), cluster metrics (count, largest, smoothness, uniformity)
- **Body Shape & Edge** — Body shape detection, shape score, edge ratio, sharp angles, symmetry score

### Why This Matters
When debugging false positives like tomatoes scoring 100%, the old panel only showed "Person Count: 0" with no way to see what COCO actually detected. Now every COCO detection is listed, making it immediately clear whether the system recognized the content or was flying blind.

### Files Modified
- `workbench.html` — Rewrote pipeline details rendering with section headers and expanded data fields

## 2026-02-22 — Workbench: Body Outline Polygon (BlazePose Keypoint Silhouette)

### Feature
Added a new "Body Outline (Pose Polygon)" overlay option to the workbench that draws a body-shaped polygon using BlazePose keypoints instead of the standard COCO-SSD rectangular bounding box.

### How It Works
- Traces down the right side of the body (ear → shoulder → elbow/wrist → hip → knee → ankle), then back up the left side
- Uses proportional padding based on shoulder width to create a body-like shape wider than the skeleton
- Arms are only included in the outline if they extend significantly beyond the torso
- Estimates head top position from nose keypoint
- Falls back to the standard rectangle if BlazePose data is unavailable or insufficient (requires at least both shoulders and both hips)
- Includes a subtle green fill (6% opacity) for visibility

### UI Changes
- New "Body Outline (Pose Polygon)" checkbox in overlay layers panel, indented under COCO-SSD
- Works in both main view and comparison view
- Toggle is independent — COCO-SSD must also be checked for it to display

### Files Modified
- `workbench.html` — Added `drawBodyOutlinePolygon()` function, modified both overlay drawing functions, added UI checkbox

## 2026-02-22 — Workbench: Slider Groups Invisible After Image Load (Fixed)

### Problem
After loading an image in the workbench, the Live Adjustment slider group headers (Decision Thresholds, Skin — YCrCb, etc.) disappeared completely. Only the Compare/Reset/Export buttons remained visible.

### Cause
The `.controls-panel` uses `display: flex; flex-direction: column`. The `.slider-group` elements had `overflow: hidden` but no `flex-shrink: 0`. The flex layout was shrinking the slider groups to height 0, and `overflow: hidden` clipped the 33px-tall headers completely. The elements existed in the DOM but were invisible.

### Fix
Added `flex-shrink: 0` to `.slider-group` CSS rule in `workbench.html`. This prevents the flex container from collapsing the accordion headers.

### Files Modified
- `workbench.html` — one CSS property added

---

## 2026-02-22 — Detection Workbench Phase 2: Live Adjustment Sliders

### Summary
Added live adjustment capability to the Detection Workbench. Users can tweak every detection threshold and scoring parameter in real-time, see overlays update instantly, compare original vs adjusted results side-by-side, and export changed configs.

### What Was Added

#### Slider Groups (10 collapsible sections, ~50 individual sliders)
1. **Decision Thresholds** — Blur (45) and Block (80) score thresholds
2. **Skin — YCrCb** — Cr min/max, Cb min/max, Y min, RGB channel minimums
3. **Skin — RGB Realistic** — R/G/B ranges, R-B/R-G/G-B difference ranges (12 params)
4. **Skin — Anime** — HSL ranges: Hue, Saturation min, Lightness range
5. **COCO-SSD** — Confidence threshold
6. **Face Exclusion** — Width/height multipliers, portrait face ratio
7. **Edge Detection** — Sobel magnitude threshold
8. **Zone Weight Multipliers** — 7 body zones each 0-3x
9. **Score Ladder Thresholds** — Skin ratio cutoffs + base scores
10. **Zone Boost Values** — Individual boost amounts + multi-zone multipliers

#### Side-by-Side Comparison Mode
- Left canvas: ORIGINAL detection, Right canvas: ADJUSTED detection
- Score overlays on both sides with color-coded numbers
- All overlay layer toggles update both sides

#### Real-Time Recalculation
- 150ms debounce on slider changes
- Caches expensive model outputs (COCO-SSD, BlazeFace, BlazePose) — only re-runs pixel analysis + scoring
- Modified sliders get gold highlight

#### Export Config
- Generates JSON with only changed values + timestamp
- Copy-to-clipboard for pasting into detector.js

### Architecture
- `DEFAULT_CONFIG` mirrors all detector.js hardcoded values
- `analyzeImageFullConfigurable()` — full pixel pipeline with config overrides
- `analyzeCombinedConfigurable()` — handles edge threshold recalculation
- `calculateScoreConfigurable()` — applies zone weight multipliers before scoring
- Generic `drawOverlaysOnCanvas()` renders on any canvas

### Files Modified
- `workbench.html` — CSS + HTML + JavaScript additions
- `DEVLOG.md` — this entry

---

## 2026-02-22 — Detection Workbench (Phase 1)

### Purpose
Standalone HTML tool for visualizing and calibrating the full detection pipeline. Drop an image, see exactly what every layer detects with toggleable overlays, score breakdown, and body zone analysis.

### Architecture
- `workbench.html` — Single standalone file (no extension dependencies except detector.js)
- Loads TF.js + COCO-SSD + BlazeFace + BlazePose from CDN
- `ScrollVeilDetectorWorkbench` class ports the analysis pipeline, adds overlay data collection
- Heavy methods (calculateScore, analyzeBodyShape, skinClusters, etc.) inherited from `ScrollVeilDetector` via prototype copy — avoids duplicating 1500+ lines
- Full IndexedDB gallery system planned for Phase 3

### Overlay Layers (toggleable)
1. COCO-SSD bounding boxes (green) — object labels + confidence
2. BlazeFace / Anime face boxes (blue/orange)
3. BlazePose skeleton (pink) — keypoints + connections
4. Skin detection mask (red) — union of RGB + YCrCb + anime skin
5. Body zones (7 colored zones) — skin % per anatomical region
6. Face/arm exclusion zones (blue) — areas zeroed before skin analysis
7. Edge detection / Sobel (yellow)
8. Person bounding box mask region (green tint)

### Launch Fix
- BlazeFace CDN version 0.1.0 was incompatible with TF.js 4.x (`blazeface is not defined`). Fixed by downgrading to 0.0.7.
- Created `start-workbench.bat` — one-click launcher that starts a local Python HTTP server and opens the workbench in Chrome. Required because workbench.html loads detector.js via `<script src>`, which browsers block on file:// protocol.
- All 4 models now load successfully: TF.js ✅, COCO-SSD ✅, BlazeFace ✅, BlazePose ✅
- Detection pipeline fully functional — tested with logo image, all overlays rendering correctly

### Results Panel
- Final score with color-coded ALLOWED/BLURRED/BLOCKED decision
- Detection reasons list (color-coded by type)
- Pipeline details grid (skin ratios, edge ratios, symmetry, clusters, etc.)
- Body zone bar chart (per-zone skin %)
- Scene context analysis (object types, intimate/isolated flags)

### Files
- `workbench.html` — New file (Phase 1: foundation + overlays + score breakdown)

### Future Phases
- Phase 2: Live adjustment sliders for thresholds with real-time recalculation
- Phase 3: IndexedDB gallery with categories, expected scores, batch testing
- Phase 4: Before/after comparison, regression detection, config export

---

## 2026-02-22 — Model Loading: Shared Promise Pattern (All 3 Models)

### Problem
When multiple images arrived while COCO-SSD (or BlazeFace/BlazePose) was still loading, only the first image triggered the load. All subsequent images got `null` back because `if (cocoModelLoading) return null;` — they didn't wait for loading to finish. This meant those images bypassed the COCO-SSD person detection gate entirely (`hasPeople === null`), running the full scoring pipeline without the critical "no person = auto-safe" check.

### Fix
Replaced the boolean `Loading` flags with shared promises for all three models in `sandbox.js`:
- `cocoModelLoading` → `cocoModelPromise`
- `faceModelLoading` → `faceModelPromise`
- `poseDetectorLoading` → `poseDetectorPromise`

Now when a model is mid-load, subsequent callers `await` the same promise instead of getting `null`. Every image waits for COCO-SSD to be ready before analysis begins.

### Files Modified
- `sandbox.js` — `loadCocoModel()`, `loadFaceModel()`, `loadPoseDetector()` all use shared promise pattern

---

## 2026-02-22 — YouTube Double Badge Fix

### Problem
YouTube homepage thumbnails were getting double badges — one from the thumbnail image analysis (`runYTAnalysis`) and one from `processVideo()` picking up hover preview `<video>` elements inside the thumbnail containers. The old skip logic checked `yt-thumbnail-view-model` but hover preview videos could exist outside that container.

### Fix
Changed `processVideo()` YouTube guard to only process videos on watch pages (`/watch`) AND only if they're inside the main player (`#movie_player` or `.html5-video-player`). All other YouTube videos (homepage hover previews, Shorts previews, etc.) are now skipped — the thumbnail badge system handles those.

Also disabled `setupWatchPageBadge()` (old thumbnail-based system redundant with frame sampling) and added `cleanupVideoOverlays()` before `addSafeBadge()` in `finalizeVideoAnalysis`.

## 2026-02-22 — Video Badge Overhaul: Status Text + Independent Controls

### Problems Fixed
1. Badge was missing "Analyzing" status text — users couldn't tell analysis was running
2. Two overlapping badges appeared after reveal (frame badge + separate reblur badge)
3. Reveal/Reblur/Pause were tangled together — revealing paused analysis, reblurring messed with analysis

### Design Principle
**Analysis, Reveal, and Blur are independent.** Revealing does not pause analysis. Pausing does not reveal. Reblurring does not affect analysis. Each state tracks separately.

### Badge Format
- Analyzing: `[pulsing dot] Analyzing 45% | Reveal` (or `| Reblur` if revealed)
- Paused: `[static dot] Paused 45% | Reveal` (or `| Reblur` if revealed)
- Complete: `[static dot] 45% | Reveal` (or `| Reblur` if revealed)

### Changes

**`updateVideoFrameBadge()`** — Rewrote badge HTML to include status text. Checks `state.paused`, `state.complete`, and `state.userRevealed` to determine both the status label and the action button label. Single badge handles all states — no separate reblur overlay.

**Badge action button (Reveal/Reblur)** — Now handles reveal and reblur directly:
- **Reveal**: Opens unblur popup → on confirm, removes blur, sets `state.userRevealed = true`, refreshes badge (action swaps to "Reblur"). Analysis untouched.
- **Reblur**: Immediately re-applies blur CSS, sets `state.userRevealed = false`, refreshes badge (action swaps to "Reveal"). Analysis untouched.

**Badge dot/score click** — Opens details popup (no Reveal button). Shows Pause/Resume button when analysis is active or paused.

**Removed** — Entire separate reblur overlay creation from onReveal (was lines 2022-2078). This was the source of the double-badge bug.

### Interaction Model
| Action | Blur State | Analysis State |
|--------|-----------|---------------|
| Click "Reveal" | Unblurs | Unchanged |
| Click "Reblur" | Re-blurs | Unchanged |
| Click "Pause Analysis" | Unchanged | Pauses |
| Click "Resume Analysis" | Unchanged | Resumes |
| Analysis completes | Unchanged | Marks complete |

## 2026-02-22 — Pause/Resume Analysis + Badge Fix

### Problems Fixed
1. Video analysis badge was using verbose format ("High Risk Visual: 29% (Peak: 87%)") instead of the simple dot + score% format used everywhere else.
2. "Stop Analysis" permanently killed analysis with no way to restart.
3. Revealing a video killed all analysis — user lost the running score.

### Changes

**Badge fix**: `updateVideoFrameBadge()` now uses `getScoreBadgeHTML()` directly — same simple `[dot] 29% | Reveal` format as all other badges. During analysis, the dot pulses. After completion, it's static. Removed the duplicate `badgeWrapper` div that was double-wrapping the badge.

**Pause/Resume**: Renamed "Stop Analysis" → "Pause Analysis" / "Resume Analysis". Clicking Pause calls `cancelVideoFrameSampling()` but does NOT set `state.complete = true` — only sets `state.paused = true`. Clicking Resume clears the paused flag and calls `startVideoFrameSampling()` which picks up from the cached partial progress. The button label toggles based on current state.

**Continue after reveal**: Analysis continues running after reveal (removed `cancelVideoFrameSampling` from onReveal). Frame badge stays visible on the revealed video, updating in real time. When analysis finishes naturally on a revealed video, `finalizeVideoAnalysis` updates the badge to "Complete" without re-blurring.

### Button Layout
- During analysis: `[Go Back] [Pause Analysis] [Reveal]`
- While paused: `[Go Back] [Resume Analysis] [Reveal]`  
- After reveal + still analyzing: `[Pause Analysis] [Close]`
- After reveal + paused: `[Resume Analysis] [Close]`
- After complete: `[Close]` (no pause button)

## 2026-02-22 — Continue Analysis After Reveal + Stop Analysis Button

### Problem
Previously, clicking "Reveal" on a video during analysis would immediately cancel frame sampling. The user lost the score and couldn't see if the content became worse later. Also, there was no way to manually stop a long-running analysis without revealing the content.

### Changes Made (5 edits to `content.js`)

1. **`sampleOneFrame`** — Removed the `state.userRevealed` early return. Frame sampling now continues running even after the user reveals a video.

2. **`onReveal` callback** — No longer calls `cancelVideoFrameSampling()`. Instead, sets `state.userRevealed = true` and only removes the blur overlay — the live "Analyzing X%" frame badge stays visible on the revealed video, updating in real time as frames are scored.

3. **`finalizeVideoAnalysis`** — When `state.userRevealed` is true, the function updates the frame badge to show "Complete" with the final score (instead of returning early and doing nothing). It will NOT re-blur a revealed video.

4. **Frame badge click handler** — Now passes `isAnalyzing: true`, `_video`, and `_state` on the result object so the popup knows whether analysis is active.

5. **`showUnblurPopup`** — New "Stop Analysis" button appears when `result.isAnalyzing` is true:
   - In 3-button mode: "Go Back" | "**Stop Analysis**" (orange outline) | "Reveal"
   - In details-only mode: "**Stop Analysis**" | "Close"
   - Clicking it calls `cancelVideoFrameSampling()`, marks `state.complete = true`, and updates the badge to show the final score.

### User Experience
- **Before**: Reveal → analysis stops → score frozen → no further updates
- **After**: Reveal → video plays unblurred → badge keeps updating "Analyzing 34%... 41%... 52%..." → completes naturally showing "Complete Visual: 52% (Peak: 67%)"
- At any point, user can click the badge and hit "Stop Analysis" to freeze the score early

## 2026-02-22 — Language Scoring Integration (Step 2 Complete)

### What Changed
Integrated `languageScoring.js` into the content.js analysis pipeline. All images, YouTube thumbnails, and videos now receive both a Visual Score and a Language Score.

### Integration Points Modified in `content.js`

1. **Image analysis (`processImage`)** — After `detector.analyzeImage()` returns, calls `scoreElementText(img)` to scan surrounding title/post/alt text. Attaches `languageScore`, `languageTagSummary`, `languageSources`, and `displayScore` (= max of visual + language) to the result object. Auto-unblur now requires BOTH visual AND language scores to be below threshold.

2. **YouTube thumbnails (`runYTAnalysis`)** — After visual analysis, calls `scoreElementText(thumb)` to scan video title and description. Caches the displayScore so badges use the higher of the two scores.

3. **Video frame sampling (`finalizeVideoAnalysis`)** — Calls `scoreElementText(video)` to read title/post text and video captions. Skips re-scoring if state already has `languageScore` (from session cache). Auto-unblur requires both scores below threshold.

4. **Badge display (`blurImage`, `blurVideo`, `addSafeBadge`)** — Badge percentage now shows `displayScore` (= `Math.max(visual, language)`) instead of just `result.score`. Badge format unchanged.

5. **Details popup (`showUnblurPopup`)** — Now shows two sections: "Visual Score: X%" with existing detection reasons, then "Language Score: Y%" with tag breakdown (e.g., "Sexual language (3 matches)"), text sources analyzed (Title ✓, Post ✓, Captions ✓), and word count.

### Behavior Changes
- Badge dot color and percentage = `Math.max(visualScore, languageScore)`
- Auto-unblur only triggers when BOTH scores are below user threshold
- Language score appears in the unblur confirmation popup alongside visual reasons
- Session cache stores language scores so re-encountered content isn't re-scanned
- If language scoring fails (e.g., module not loaded), gracefully falls back to visual-only

### What's Next (Step 3)
- Test on YouTube, X/Twitter, Google Images
- Verify console logs show language scores
- Check popup displays language section correctly
- Fine-tune any edge cases with exception patterns

## 2026-02-22 — Language Scoring Module Created (Step 1 Complete)

### What Was Built
Created `languageScoring.js` — a standalone module that scans text for concerning language and produces a separate Language Score alongside the existing Visual Score.

### New File: `languageScoring.js` (729 lines)
Contains 9 sections:

1. **Scoring Weight Table** — Points per word by tag×severity (sexual highest: 8/18/30/50, general lowest: 1/3/5/10)
2. **Diminishing Returns** — Repeated same-word occurrences: 100%, 75%, 50%, 25%+
3. **Text Length Normalization** — Short text 1.0x, medium 0.8x, long 0.6x
4. **Pattern Conversion Helpers** — Converts wildcard patterns (e.g. `fu*c*k`) to proper RegExp. Builds exception testers from exception lists (e.g. "cock" → peacock, cockroach excluded)
5. **Word Lists** — Loads 434-entry base profanity list from `profanity-list-en.json` via `chrome.runtime.getURL` + fetch. Includes 38-entry ScrollVeil supplemental suggestive word list (bikini, ASMR, OnlyFans, NSFW, etc.)
6. **`scoreText(text)`** — Main scoring function. Returns `{score, isNA, matches, tagSummary, wordCount, rawScore}`. Implements minimum 1% rule, 1-100 capping, and all spec formulas.
7. **`extractTitleText(element)`** — Platform-specific DOM text extraction for YouTube (video title, channel, description), X/Twitter (tweet text, quoted tweets), Google Images (alt, caption), and generic fallback (alt, aria-label, figure captions, nearby headings)
8. **`extractCaptionText(video)`** — Reads HTML5 `video.textTracks` API for WebVTT caption data. Prefers captions > subtitles > descriptions. Deduplicates overlapping cue text. Does NOT require video playback.
9. **Tag Reporting** — `formatLanguageDetails()` generates popup text. `getLanguageScoreColor()` matches visual score color scheme. `scoreElementText()` convenience wrapper scores an element in one call.

### Manifest Changes (`manifest.json`)
- Added `languageScoring.js` to content_scripts js array (loads before content.js)
- Added `web_accessible_resources` for `profanity-list-en.json` so the content script can fetch it

### Key Design Decisions
- **Async initialization** — Word list loads via fetch() on script injection, compiles all regex patterns once. `scoreText()` awaits readiness automatically.
- **Exception handling** — The "bra" entry has 60+ exceptions (brace, brain, brave, etc.) compiled into a single RegExp tester for fast matching.
- **Multi-word phrase matching** — Phrases like "barely legal" use `(?:^|\s)` boundaries instead of `\b` since word boundaries don't work at spaces.
- **No external dependencies** — Pure JS, Chrome MV3 compatible, all client-side.

### What's Next (Step 2)
- Integrate `scoreElementText()` into the image/video analysis flows in content.js
- Update badge display to show `Math.max(visual, language)`
- Update details popup to show language breakdown
- Add language score to session cache

## 2026-02-22 — Language Scoring Feature Spec (Planning Complete)

### What Was Decided
Completed full feature specification for caption/text reading and language scoring system. This adds a Language Score alongside the existing Visual Score to give users a more complete picture of content risk.

### Key Design Decisions
- **Badge shows `Math.max(visual, language)`** — single clean number, no clutter
- **Details popup shows full breakdown** — Visual score, Language score, detected tags
- **Separate scoring** — visual and language are independent assessments, never combined/averaged
- **Sexual content weighted highest** in language scoring (8/18/30/50 points by severity)
- **General swear words scored low** (1/3/5/10 points) to avoid inflating scores for casual profanity
- **Minimum 1% rule** — if any text exists, language score is at least 1%. No text = "N/A 0%"
- **All 6 tags used neutrally** — sexual, lgbtq, racial, general, shock, religious
- **"SFW" flagged as suggestive** — labeling content "safe for work" implies it's near the line

### Word List
- **Base:** dsojevic/profanity-list (434 words, MIT license) with severity ratings, tags, and false-positive exceptions
- **Supplemental:** ScrollVeil-specific suggestive words (~40 words) like bikini, OnlyFans, SFW, NSFW, twerk, etc.
- Downloaded `profanity-list-en.json` to project folder

### Text Sources (in priority order)
1. Title & post text (instant, all platforms, read from DOM)
2. Video caption/subtitle tracks (instant when available, via textTracks API)
3. On-screen rendered captions (deferred to future phase)

### Files
- Created: `LANGUAGE-SCORING-SPEC.md` — full feature specification
- Downloaded: `profanity-list-en.json` — base word list data

## 2026-02-22 — Video Frame Sampling System (Phase 1)

### What Changed
Replaced the old single-frame video analysis with a progressive frame sampling system. Videos are now analyzed frame-by-frame over time with live-updating badges showing analysis progress.

### Architecture
- **IntersectionObserver** watches videos for viewport visibility (50% threshold)
- When a video becomes visible, `startVideoFrameSampling()` begins capturing frames at 3-second intervals
- Each frame goes through the existing `detector.analyzeImage()` pipeline (COCO-SSD → BlazeFace → BlazePose → skin detection)
- A **live badge** with pulse animation shows "Analyzing X% — Visual: Y%" during sampling
- When analysis completes (or early-exits), `finalizeVideoAnalysis()` decides blur/reveal based on user's auto-reveal threshold
- Scrolling away cancels analysis to save CPU; scrolling back resumes from cache
- **Session cache** (`videoSessionCache` Map) stores results in memory — cleared on refresh

### Key Design Decisions
- **Separate visual scoring** — language scoring will be added later via caption reading
- **No instant blocking** — ScrollVeil informs users, never makes decisions for them
- **Auto-reveal only by user setting** — both visual AND language must be below user thresholds
- **YouTube watch page support** — main player videos now get frame sampling; thumbnail containers still use the separate CSS blur system
- **Hardcoded defaults** for now (3s interval, 30s duration, 75% early exit) — settings UI coming later

### Defaults (Placeholder)
- Frame interval: 3 seconds (1 frame every 3 seconds)
- Duration: 30 seconds (10 total frames)
- Early exit: 75% peak score threshold

### Bug Fixes (same session)
1. **Badge position** — moved from top-left to top-center (matches all other badges using `flex-start` + `center`)
2. **Badge clickable** — inner badge div has `pointer-events: auto` + click handler showing score details popup with Reveal option
3. **Center-center badge eliminated** — `blurVideo()` overlay now uses `flex-start` + `center` positioning with 6px padding-top
4. **Video clickable during analysis** — removed `pointer-events: none` from initial blur in `processVideo()`; blur CSS hides content, badge handles reveal interaction

### Badge Language
- "Reveal" to show content, "Reblur" to re-hide — consistent across images and videos
- Fixed video reblur button text from "Blur" to "Reblur"

### Files Modified
- `content.js` — new frame sampling system, modified processVideo(), cleanupVideoOverlays(), badge text fix
- `DEVLOG.md` — this entry

### Next Steps
- Test on YouTube watch pages, X/Twitter, and generic sites
- Add caption/subtitle reading for language scoring
- Add video analysis settings to popup UI
- YouTube homepage autoplay investigation (separate task)

---

## 2026-02-21 — YouTube Badge System Stabilization

### Problems
1. Badges flickering/blinking on hover — MutationObserver on each thumbnail firing constantly as YouTube mutated DOM
2. Reveal not working — CSS specificity: global `img:not([data-scrollveil-analyzed])` rule beating YouTube img exemption
3. Center "phantom" badges — standard `processImage()`/`processVideo()` pipeline creating floating overlays on YouTube-served images/videos outside `yt-thumbnail-view-model`
4. Badge text inconsistency — "Blur" vs "Reveal" terminology

### Fixes Applied
1. **Removed per-thumbnail MutationObserver** — badge lives on `badgeHost` (parent above blur container), YouTube child swaps don't affect it. Periodic rescan handles edge cases.
2. **CSS specificity fix** — `yt-thumbnail-view-model[data-scrollveil-revealed] img:not(...)` now beats the global blur rule. Also mark imgs with `data-scrollveil-skip` on reveal for belt-and-suspenders.
3. **Broad YouTube skip in processImage()** — skip ALL `ytimg.com` and `ggpht.com` images on YouTube, not just those inside `yt-thumbnail-view-model`. Prevents phantom center badges from the standard pipeline.
4. **Skip ALL videos on YouTube in processVideo()** — thumbnail blur handled by CSS container, no floating overlays needed.
5. **Badge toggle system** — Blurred: "10% | Reveal" → click → popup → unblur. Revealed: "10% | Reblur" → click → re-blur immediately. Both safe (auto-revealed) and unsafe paths have full toggle.
6. **Consistent terminology** — "Reveal" / "Reblur" across entire extension (YouTube badges + standard badges).
7. **blur-shield.css unified to CSS variable** — removed hardcoded `blur(30px)` values, now uses `var(--scrollveil-blur)` everywhere so blur matches user settings.
8. **YouTube child element blur exemptions** — imgs/videos inside `yt-thumbnail-view-model` exempted from individual blur in both `blur-shield.css` and dynamic shield. Container handles all blurring.
9. **ytd-video-preview blur** — YouTube's hover preview overlay (injected at `ytd-app` level) now blurred by CSS, exempt when thumbnail is revealed.
10. **z-index stacking fix** — `ytd-app > #content { position: relative; z-index: 2 }` ensures badges paint above YouTube's hover preview overlay (z-index: 1). Also prevents hover autoplay as a side benefit.
11. **Auto-unblur defaults to 0 (safety-first)** — all fallback values changed from 20 to 0 across every threshold reference. Threshold comparison changed from `<=` to `<` so 0% threshold means nothing auto-reveals.
12. **Lazy-loaded image fix** — images below the viewport that haven't loaded no longer get cached as false 0% "Image not loaded" results. Instead, the thumbnail is removed from the processed set and the periodic rescan retries when the image is actually loaded.
13. **Watch page player badge** — `/watch` pages now get a badge on `#movie_player` by analyzing the video thumbnail (`hqdefault.jpg`). Player starts blurred with Reveal/Reblur toggle, respects auto-unblur threshold. SPA navigation detection resets state when user navigates between videos. Foundation for future frame sampling and caption analysis.

### Current State — WORKING ✅
YouTube home page fully functional: thumbnails blurred on load, badges stable, reveal/reblur toggle working, Shorts badges persist on hover, blur strength follows settings, auto-unblur threshold respected, lazy-loaded images analyzed correctly on scroll.

### Known Minor Issues
- **Ad thumbnails have no badge** — ads are blurred by global CSS but use different container structures than `yt-thumbnail-view-model`, so the YouTube badge system doesn't detect them. Low priority since ads are still blurred.

### Files Modified
- `content.js` — YouTube thumbnail system, watch page badge, threshold defaults, lazy-load retry
- `blur-shield.css` — unified to CSS variable, YouTube exemptions, preview blur, z-index stacking, watch page blur toggle

### Key Insight
YouTube has multiple image containers — `yt-thumbnail-view-model` for thumbnails, `YT-IMAGE` for ads/other content. Images from `ytimg.com` can exist outside `yt-thumbnail-view-model`, so filtering by DOM ancestry alone is insufficient. Domain-based filtering (`ytimg.com`, `ggpht.com`) provides comprehensive coverage.

### Files Modified
- `content.js` — all changes

## 2026-02-21 — Unified Blur Strength via CSS Variable

### Problem
CSS blur shield was hardcoded to `blur(30px)` regardless of the user's blur strength setting. The `blurStrength` variable (loaded from `chrome.storage.sync`) was only used by inline JS styles, but the CSS rules injected by `injectBlurCSS()` always used 30px. This meant the initial blur on all images, YouTube thumbnails, and X/Twitter containers ignored the user's preference.

### Fix
Replaced all hardcoded `blur(30px)` in the CSS shield with `blur(var(--scrollveil-blur))` using a CSS custom property. The variable defaults to `30px` on injection (before settings load), then gets updated to the user's setting via `document.documentElement.style.setProperty('--scrollveil-blur', blurStrength + 'px')` once `chrome.storage.sync.get()` returns.

This ensures every blur across the entire extension — CSS shield rules, inline JS styles, YouTube containers, X/Twitter containers — all obey the user's blur strength setting.

### Files Modified
- `content.js` — CSS variable in `injectBlurCSS()`, update call after settings load

## 2026-02-21 — YouTube Thumbnail System v3: Observer + Cache Architecture

### Problem
YouTube thumbnail system was completely broken. Three overlapping systems were fighting:
1. CSS card-level blur (blurring entire `ytd-rich-item-renderer` including titles)
2. YouTube card badge system (injecting badges on cards)
3. Standard floating "Detecting..." overlays (orphaned on `document.body`, never resolving)

Additionally, YouTube's hover behavior swaps `<img>` elements for `<video>` elements inside `yt-thumbnail-view-model`, destroying any badges attached to the image and preventing click interception.

### Root Causes Identified
- `addDetectingBadge()` was called BEFORE the YouTube card check in `processImage()`, creating orphaned floating overlays
- Card-level blur covered titles and metadata below thumbnails
- Old stable-ancestor functions (`processYTThumbnail`, `getYTStableAncestor`, `ytIsDone`, etc.) were referenced in MutationObserver but never defined — causing silent errors
- Badges attached to child elements were destroyed by YouTube's img↔video hover swap

### Solution: Observer + Cache Architecture
New system targets `yt-thumbnail-view-model` (just the thumbnail, not the whole card):

1. **CSS blur on `yt-thumbnail-view-model`** — blurs only the thumbnail area, titles remain visible
2. **Per-thumbnail MutationObserver** — watches each `yt-thumbnail-view-model` for child changes. When YouTube swaps img↔video on hover, the observer detects the badge was destroyed and re-injects it from cache
3. **URL-keyed cache** (`ytThumbCache` Map) — stores analysis results keyed by video URL. Instant badge restoration after any DOM swap
4. **`setupYTThumbnail()`** — single entry point that handles badge injection, observer setup, analysis, and caching
5. **Immediate "Detecting..." badge** — shown on the thumbnail container instantly, before image loads or analysis runs

### Key Design Decisions
- Badge lives on `yt-thumbnail-view-model` (survives longer than child elements)
- MutationObserver per thumbnail is lightweight (only fires on actual changes, not polling)
- Cache keyed by normalized video URL (`/watch?v=xxx`) so same video in different cards shares results
- `WeakSet` (`ytObservedThumbs`) prevents double-setup if thumbnail is re-discovered
- All old undefined function references removed from MutationObserver and periodic rescan

### Files Modified
- `content.js` — new YouTube thumbnail system, cleaned up old code
- `DEVLOG.md` — this entry

## 2026-02-20 — YouTube Thumbnail System v2: Stable-Ancestor Rewrite

### Problem
YouTube thumbnails had persistent issues: duplicate badges (multiple scores on same thumbnail), blinking detecting badges, and "Reveal" not working (blur re-applied immediately). Multiple incremental patches failed because the root architecture was wrong.

### Root Cause
The old system targeted `yt-thumbnail-view-model` elements, which YouTube replaces entirely (new DOM object for the same video). This caused:
- Floating overlays losing their target → orphan sweep killing badges
- New replacement elements not in WeakSet → re-processed → duplicate badges
- No "revealed" state surviving element replacement → reveal immediately undone
- `src` attribute changes on hover triggering full re-analysis → blinking

### Fix: Complete rewrite of YouTube thumbnail handling
Replaced `processYTContainer` / `blurYTContainer` / `markYTContainerSafe` / `addSafeBadgeToEl` / `addDetectingBadgeToEl` / `cleanupAllOverlaysForEl` with a new stable-ancestor system:

1. **Stable ancestor targeting** — instead of `yt-thumbnail-view-model` (swapped by YouTube), target the parent `<a>` link or renderer element which is NOT replaced
2. **Injected child badges** — badges are `position:absolute` child elements inside the stable ancestor, not `position:fixed` floating overlays in `document.body`. No orphan sweep needed.
3. **Results cache** — `ytResultsCache` Map stores analysis results by video URL. When YouTube replaces the inner element, we re-apply from cache instantly (no re-analysis).
4. **Blur targets the current inner element** — `applyYTBlur()` / `clearYTBlur()` always queries the current `yt-thumbnail-view-model` inside the stable ancestor, so it works even after YouTube swaps it.
5. **Periodic refresh** — instead of re-processing, the periodic scan calls `refreshYTAncestor()` which just re-applies blur state from cache to whatever inner element currently exists.
6. **Src changes handled gracefully** — if already processed, just refresh blur state; if not yet processed, trigger first analysis.

### What was removed
- `processYTContainer()`, `blurYTContainer()`, `markYTContainerSafe()`
- `addDetectingBadgeToEl()`, `removeDetectingBadgeFromEl()`, `addSafeBadgeToEl()`, `cleanupAllOverlaysForEl()`
- `getYTContainerKey()` (replaced by `getYTKey()`)
- `processedYTContainers`, `processingYTContainers`, `processingYTKeys`, `processedYTKeys` tracking sets

### What was added
- `getYTStableAncestor()`, `getYTKey()`, `processYTThumbnail()`, `applyYTResult()`
- `applyYTBlurOverlay()`, `refreshYTAncestor()`
- `injectYTBadge()`, `removeYTBadge()`, `applyYTBlur()`, `clearYTBlur()`
- `ytResultsCache`, `ytProcessingAnchors`, `ytDoneAnchors`, `ytRevealedAnchors`

### Files Modified
- `content.js` — complete rewrite of YouTube thumbnail handling (~265 lines replaced)

---

## 2026-02-20 — YouTube Duplicate Badges & Reveal-Not-Working Fix

### Problem
YouTube homepage Shorts thumbnails showed multiple overlapping score badges (e.g. 20% at top and 0% at bottom on same thumbnail). Badges blinked as detecting/safe animations competed. Clicking "Reveal" on blurred content did nothing — blur immediately re-applied.

### Root Cause
Three overlapping triggers all re-processing the same container:
1. **MutationObserver `src` change handler** — YouTube changes thumbnail `<img>` src on hover (lazy load → animated preview → back). The handler was nuking ALL tracking (deleting from `processedYTKeys`, `processedYTContainers`, `processingYTKeys`) and re-calling `processYTContainer()`, creating a second badge.
2. **Periodic re-scan (every ~2s)** — After the src-change handler deleted the container from tracking sets, the periodic scan found it as "unprocessed" and fired `processYTContainer()` a third time.
3. **Reveal broken** — User clicks reveal → blur removed → but no "revealed" flag existed, so next src-change or periodic scan saw container as unprocessed and re-blurred it.

### Fix
1. **Stopped src-change re-processing for already-analyzed YT containers** — if container is already in `processedYTKeys` or `processedYTContainers`, skip. Only process on first real src (lazy load).
2. **Added `_scrollveilRevealed` flag** — set when user clicks reveal in `blurYTContainer()`. Checked in `processYTContainer()` gate and periodic re-scan to prevent re-processing.
3. **No more gate-nuking** — removed the aggressive `delete` calls that cleared all tracking sets on every src change.

### Result
- One badge per thumbnail
- No blinking
- Reveal works and stays revealed
- Hover previews don't trigger re-analysis

### Files Modified
- `content.js` — src mutation handler, `processYTContainer()` gate, `blurYTContainer()` reveal callback, periodic re-scan

---

## 2026-02-20 — Orphaned Overlay Sweep (Fix for YouTube Blinking/Double Overlays)

### Problem
YouTube thumbnails had multiple overlays and blinking badges. DOM inspection showed 48 overlays for 46 containers, with all container JS properties (`_scrollveilFloatingOverlay`, `_scrollveilSafeBadge`, etc.) showing `false` — meaning overlays existed in the DOM but were orphaned (no container held a reference to them).

### Root Cause
YouTube replaces `yt-thumbnail-view-model` elements entirely during navigation/lazy-load (same pattern as X replacing `<video>` nodes). When the container element is replaced:
- New container object = no JS properties = `_scrollveilFloatingOverlay` is `undefined`
- Old floating overlay still exists in `document.body`, still running its `requestAnimationFrame` position tracker
- 44 of 48 overlays were hidden (viewport check fires) but still accumulating
- On scroll, old overlay coordinates would briefly match visible positions → flash visible → blinking

### Fix
1. **Global `overlayRegistry` Map** — every `createFloatingOverlay()` call registers `overlay → targetElement`. Deregistered in `_scrollveilCleanup()`.
2. **Orphan sweep in enforcement loop** — every 500ms, checks `document.contains(target)` for every registered overlay. If target is no longer in the DOM, the overlay is destroyed immediately.

### Result
- No more orphaned overlays accumulating
- Blinking eliminated
- Memory-safe (cleanup deregisters from map)

### Files Modified
- `content.js` — `overlayRegistry` Map, `createFloatingOverlay()` registration, `_scrollveilCleanup()` deregistration, orphan sweep in enforcement interval

---

## 2026-02-20 — YouTube Container-Level Thumbnail Processing

### Problem
YouTube thumbnail filtering had multiple cascading bugs:
1. **Badges only visible on hover** — YouTube lazy-loads `img.src` on hover. ScrollVeil processed empty `<img>` elements (src="", naturalWidth=0), marked them safe, added to WeakSet. Real src loaded on hover but image was already processed — never re-analyzed.
2. **Blinking/flickering** — With auto-blur threshold at 0%, overlay intercepted mouse events → YouTube hover state changed → re-scan triggered → overlay destroyed/recreated → loop.
3. **Multiple badges per thumbnail** — YouTube recycles `<img>` DOM nodes, swapping `src`. Old overlay still tracked the recycled node. New overlay created for new thumbnail. Both fought to update position.
4. **Overlays not showing past first rows** — `position:fixed` overlays rendered at off-screen coordinates for thumbnails outside the viewport.
5. **Async race condition** — `processYTContainer()` was async. Multiple callers (MutationObserver, periodic rescan, scanImages) could all pass the WeakSet check before the first call reached its first `await`, creating duplicate in-flight analysis runs.

### Solution: Container-Level Tracking
Mirroring the X/Twitter `tweetPhoto` approach:
- Target `yt-thumbnail-view-model` as the stable container (YouTube never swaps it, only the `<img>` inside)
- Track with `processedYTContainers` WeakSet (fully done) + `processingYTContainers` Set (in-flight async lock)
- The in-flight Set is checked and set **synchronously before the first `await`** — closes the race condition
- `finally` block always releases the lock and marks the container fully processed
- CSS blur shield targets `yt-thumbnail-view-model:not([data-scrollveil-analyzed])` for instant blur on page load
- Container processor waits up to 4 seconds for a real `img.src` to appear before analyzing
- All entry points (scanImages, periodic rescan, MutationObserver childList + src) check both gates

### Pointer Events Fix
- Overlay container changed to `pointer-events:none`
- Inner badge div set to `pointer-events:auto`
- Prevents overlay from intercepting YouTube hover events (which caused the flicker loop)

### Viewport Visibility Check
- Added `inViewport` check in `updatePosition()` — overlay hidden when target is outside viewport bounds
- Prevents off-screen positioning and snap-in flashing on scroll

### Nuclear Cleanup
- `cleanupAllOverlaysForEl(el)` helper destroys all overlay types on any element
- Called at start of every overlay-creating function
- Guarantees one overlay per container regardless of timing

### Key Lessons
1. YouTube replaces `yt-thumbnail-view-model` elements entirely — same problem as X replacing `<video>` nodes. Container-level JS properties don't survive element replacement.
2. Async functions need a synchronous lock (plain `Set`, not `WeakSet`) to prevent race conditions across `await` boundaries.
3. The global `overlayRegistry` orphan sweep is the safety net for any future cases of element replacement we haven't anticipated yet.

### Files Modified
- `content.js` — `processedYTContainers`, `processingYTContainers`, `overlayRegistry`, CSS shield update, `processYTContainer()`, `markYTContainerSafe()`, `blurYTContainer()`, `addDetectingBadgeToEl()`, `removeDetectingBadgeToEl()`, `addSafeBadgeToEl()`, `cleanupAllOverlaysForEl()`, `processImage()` YouTube routing, MutationObserver updates, `scanImages()` update, periodic rescan update

---

## 2026-02-15 — Body-Part Zone Measurement System

### Problem
Bikini images on Google Images were scoring 0-15% (green, unblurred) despite showing significant skin exposure on chest, midriff, hips, and thighs. Root cause: the clothed person cap was firing because the overall `skinRatio` (after face/arm/hand exclusion) fell below 20-28%, even though the remaining skin was in anatomically concerning areas. The crude upper/middle/lower thirds couldn't distinguish "low skin because wearing clothes" from "low skin because small body parts are exposed."

### Solution
Added a precise body-part zone measurement system using BlazePose keypoints:

1. **Zone rectangles from keypoints** — Instead of dividing the image into simple thirds, we now define rectangles for each body part using BlazePose's 33 landmarks:
   - Shoulders (shoulder band), Chest (shoulders → mid-torso), Waist/midriff (mid-torso → hips)
   - Hips (hip band), Thighs (hips → knees), Calves (knees → ankles), Feet (ankle/heel/toe area)

2. **Per-zone skin measurement** — Each zone gets its own skin percentage measured from the existing skinMap. A zone with >25% skin = "exposed", >50% = "high exposure."

3. **Clothed person cap exemption** — The cap checks body zones before firing. If ANY zone shows significant skin (chest, waist, hips, or thighs >25%, or 2+ zones exposed), the cap does NOT fire.

4. **Zone-based scoring boosts** — Chest/thighs >40%: +20, >25%: +10. Waist/hips >40%: +15, >25%: +8. Multi-zone and high-exposure multipliers.

5. **Zone-based score floors** — 2+ exposed zones = minimum 35, 2+ high-exposure zones = minimum 50.

6. **Scene summary enhancement** — Popup now shows specific exposed body parts.

### Also Removed: Landscape/Nature Scene Cap
Landscape detector was capping scores on beach bikini photos. Removed entirely — location doesn't determine whether content is concerning.

### Also Fixed: Portrait Caps Overriding Body Zone Data
All four portrait detection mechanisms now check two conditions before allowing the portrait cap: `bodyZones.exposedZoneCount >= 1` AND COCO-SSD person bounding box height > 50% of image.

### Files Modified
- `detector.js` — `measureBodyPartZones()`, skinMap return, zone measurement, clothed person cap update, zone-based scoring
- `content.js` — New body-zone reason translations, zone info in scene summary

---

## 2026-02-15 — Google Images Preview Panel Double Badge Fix

### Problem
When clicking a Google Images thumbnail, two score badges appeared — one from the thumbnail's floating overlay tracking into the preview area, and one from `processImage()` firing on the enlarged `<img>`.

### Cause
`addSafeBadge()` had a skip for `#islsp` (stale selector — Google changed to `#sZmt3b` in 2025+ layout). Google stacks TWO `<img>` elements in the preview panel — one visible and one `visibility:hidden` placeholder. Both had valid dimensions so both got processed.

### Fix
Removed all stale `#islsp` skips. Added a `visibility:hidden` skip in `processImage()` that catches the hidden placeholder.

### Files Modified
- `content.js` — removed stale `#islsp` skips, added `visibility:hidden` image skip

---

## 2026-02-15 — Portrait/Clothed Person Scoring Overhaul

### Problem
Portrait photos scoring 90-100% — completely wrong. A Black man's close-up portrait scored 100%, a pencil sketch collage scored 90%.

### Root Causes
1. BlazeFace face coverage threshold too high (25%) — many portraits fall below
2. YCrCb skin detection working too well — face/neck skin pushing scores into danger zones
3. No "clothed person" logic
4. Moderate face cap range too narrow

### Fixes
1. Lowered BlazeFace early return from 25% → 15%
2. Added "clothed person" cap — person + face detected + skinRatio < 20% → cap at 10
3. Expanded moderate face cap to 10-15% range
4. Added `personCount` to analysis object
5. Removed anatomical feature detection from scoring (eyes/nostrils misread as anatomical features)
6. Widened "mostly clothed" cap threshold from 25% to 28%
7. Fixed auto-unblur at 0% threshold — changed `<=` to `<`
8. Face/arm/hand exclusion from skin detection
9. Added "Detecting…" pulsing badge on every image during analysis
10. Anime face detector — heuristic pixel-based, no ML models, ethically clean

### Files Modified
- `detector.js` — BlazeFace thresholds, clothed person cap, personCount threading
- `content.js` — New reason translations, reason deduplication

---

## 2026-02-15 — False Positive Scoring Fix (Suited Man / Portrait Bodies)

### Problem
Professional headshot of a man in a dark suit scoring 20% with misleading reasons: "Revealing clothing detected," "Explicit content indicators" (twice), "Body contours visible."

### Root Causes
1. Face/neck skin within COCO-SSD bounding box pushing `middleRatio` above 0.25
2. Eyes/nostrils triggering dark circle anatomical detection
3. Two different internal reasons both translating to "Explicit content indicators"

### Fixes
1. Face-gated scoring ladder — `middleRatio > 0.25` no longer triggers "Revealing clothing" when face covers 15%+
2. Face-gated anatomical detection — entire block skipped when `faceRatio >= 0.15`
3. Reason deduplication in `getHumanReadableReasons()`

### Files Modified
- `detector.js` — `faceRatio` scoping, scoring ladder face gates, anatomical detection face gate
- `content.js` — new "Face/neck skin visible" translation, reason deduplication

---

## 2026-02-14 — Clickable Badge Score Details

### What Changed
Made colored dot and score percentage on safe badges clickable — opens details-only popup (score, scene summary, reasons, Close button only — no Reveal button).

### Files Modified
- `content.js` — details-only button mode, guarded Reveal listener, clickable badge area with hover, clickable re-blur badge with hover

---

## 2026-02-14 — Phase 2: YCrCb Weighted Blend (Active Scoring)

### What Changed
Activated YCrCb as part of actual scoring by blending both detectors. `skinRatio` is now `0.6 × YCrCb + 0.4 × RGB`. `skinMap` uses union of all detectors.

### Files Modified
- `detector.js` — modified pixel loop, skinRatio calculation, logging

---

## 2026-02-14 — Phase 1: YCrCb Parallel Skin Detection (Observation Mode)

### Purpose
Added YCrCb color space skin detection running alongside existing RGB detection in observation-only mode (logged to console, did not affect scoring). Phase 1 data justified Phase 2 activation.

### Files Modified
- `detector.js` — added `rgbToYCrCb()`, `isRealisticSkinYCrCb()`, parallel counter, logging

---

## 2026-02-14 — BlazePose Body Shape Override (Scoring Leniency Fix)

### Problem
Instagram Fashion Nova images scoring only 10-20% and auto-unblurring. BlazePose found 33 landmarks with 0.80-1.00 confidence but scores were crushed by safety caps because geometric `hasBodyShape` detection failed on dark clothing against dark backgrounds.

### Fix
When BlazePose returns high-confidence pose data (score > 0.7, 17+ landmarks), sets `analysis.hasBodyShape = true` regardless of geometric detection. Prevents all downstream caps from firing on confirmed human photos.

### Files Modified
- `detector.js` — ~15 lines in `calculateScore()` after scene context setup

---

## 2026-02-14 — Startpage Image Search Fix (aria-hidden skip bug)

### Problem
On Startpage.com, all images immediately unblurred with no badges. Startpage sets `aria-hidden="true"` on all search result images — our filter was treating them all as decorative.

### Fix
Changed `aria-hidden` skip to only apply to small images (under 100px).

### Files Modified
- `content.js` — `isUIImage` check in `processImage()`

---

## 2026-02-14 — BlazePose Scoring Integration

### What Was Done
Connected BlazePose pose landmark data to `calculateScore()`. Added landmark visibility analysis, pose headshot detection, skeleton height ratio, leg spread ratio, hand-to-pelvis proximity boost, and full-body + high-skin combo boost.

### Files Modified
- `detector.js` — calculateScore() signature fix + 173 lines of pose analysis logic

---

## 2026-02-14 — Google Images Batch Processing Stall Fix

### Problem
ScrollVeil stopped processing images around row 8 on Google Images. Google uses 1×1 transparent GIF placeholders displayed at full size — naturalWidth=1 caused them to be permanently skipped.

### Fix
Placeholder detection: if naturalWidth < 100 but displayed >= 100px, remove processed flags and return so it gets re-processed when real src loads. MutationObserver src handler also clears `data-scrollveil-skip`.

### Files Modified
- `content.js` — processImage() placeholder detection, MutationObserver src handler

---

## 2026-02-14 — BlazeFace Portrait Detection Integration

### Problem
Face/portrait images scoring 95-100% — geometric analysis interpreted face skin as body skin.

### Solution
Integrated TensorFlow.js BlazeFace. Score caps: face 50%+ → cap 5, face 25-50% → cap 10, face 15-25% → cap 20.

### Files Modified
- `lib/blazeface.min.js` (new), `sandbox.html`, `sandbox.js`, `offscreen.js`, `detector.js`

---

## 2026-02-14 — Descriptive Scene Summaries in Unblur Popup

Added `getSceneSummary()` generating natural one-line descriptions shown in the unblur popup (e.g. "1 person — significant skin exposure — outdoor/recreation (surfboard)").

### Files Modified
- `content.js` — `getSceneSummary()`, wired into `showUnblurPopup()`

---

## 2026-02-14 — Custom Unblur Popup & Human-Readable Scoring

Replaced plain `confirm()` dialog with custom styled popup. Added `getHumanReadableReasons()`, `getScoreColor()`, `showUnblurPopup()`. Added `personCount` threading through detector pipeline.

### Files Modified
- `detector.js` — personCount threading
- `content.js` — popup functions

---

## 2026-02-14 — Object Detection & Scene Context Expansion

Expanded COCO-SSD from person-only to full scene context. Added `evaluateSceneContext()` mapping objects to scene types (intimate, domestic, isolated, outdoor recreation, etc.). Context used to boost scores in concerning settings and describe scenes in popup.

### Files Modified
- `detector.js` — `evaluateSceneContext()`, `calculateScore()`, `analyzeImage()`, `tryAnalyzeImage()`

---

## 2026-02-14 — Removed Sensitivity Level Selector (Obsolete)

Replaced 3-bucket sensitivity selector with two clean sliders: Blur Strength and Auto-unblur threshold.

### Files Modified
- `popup.html`, `popup.js`, `content.js`, `detector.js`

---

## 2026-02-14 — Auto-Unblur Slider + Code Review Fixes

Added auto-unblur slider (0-100%, step 5). Fixed three bugs: threshold listener nested inside blur strength listener, videos not respecting auto-unblur threshold, orphaned comment.

### Files Modified
- `content.js` — fixed listener nesting, added video auto-unblur, removed orphan comment

---

## 2026-02-13 — Bounding Box Integration + Unified Scoring (Images & Videos)

### Problem
COCO-SSD bounding boxes were discarded — all pixels scanned including background. Videos had separate simplified scoring path.

### Solution
Bounding box masking: pixels outside person bounding boxes zeroed out before analysis. Removed separate `isVideo` scoring path — videos now use full pipeline identical to images.

### Files Modified
- `detector.js` — bbox masking in `tryAnalyzeImage()`, unified scoring in `calculateScore()`
- `content.js` — updated video analysis comment

---

## 2026-02-13 — Universal Score Badge (UI Unification)

Created shared `getScoreBadgeHTML(score)` helper. Color-coded: green (<20%), yellow (20-39%), orange (40-59%), red (60-79%), dark (80%+). Replaced all old overlay HTML with universal badge.

### Files Modified
- `content.js` — `getScoreBadgeHTML()`, `addSafeBadge()`, `blurImage()`, `blurVideo()`

---

## 2026-02-13 — Person Detection WORKING + Safe Badge UI

COCO-SSD integration complete via sandbox iframe architecture. Sandbox gets `unsafe-eval` permission, communicates via `postMessage`. Added safe badge UI and auto-unblur toggle.

### Key Lessons
1. MV3 sandbox pages are the ONLY place `eval()` works
2. Sandbox communicates via `postMessage` only — no `chrome.*` APIs
3. TF.js needs `eval` for WebGL shader compilation

### Files Modified
- `manifest.json`, `sandbox.html`, `sandbox.js`, `offscreen.html`, `offscreen.js`, `background.js`, `content.js`, `popup.html`, `popup.js`

---

## 2026-02-13 — Re-blur Button Repositioned and Simplified

Changed text from "🔒 Re-blur" to "Blur", moved from top-right to top-center.

### Files Modified
- `content.js` — image and video re-blur buttons

---

## 2026-02-13 — Score Overlay Sizing Fix

Added `overflow: hidden` to floating overlay and responsive font scaling in `updatePosition()`.

### Files Modified
- `content.js` — `createFloatingOverlay()`

---

## 2026-02-13 — X/Twitter Video Blur Not Applying

Container-level blur fix for videos on X — same root cause as image blur stripping. CSS shield for `[data-testid="videoPlayer"]`. Fixed double blur stacking (videoPlayer + videoComponent nested), CSS shield fighting JS unblur, first video double-blurred.

### Files Modified
- `content.js` — `injectBlurCSS()`, `processVideo()`, `blurVideo()`, unblur/re-blur handlers, `markVideoSafe()`

---

## 2026-02-08 — X/Twitter Image Blur Not Applying (React Stripping Inline Styles)

React strips inline `filter: blur()` from `<img>` elements. Fix: blur `[data-testid="tweetPhoto"]` container instead. Added CSS shield for tweetPhoto containers. Added early container blur in `processImage()`.

### Files Modified
- `content.js` — `blurImage()`, `markImageSafe()`, `processImage()`, `injectBlurCSS()`

---

## 2026-02-08 — Fixed Images Being Marked Safe After Blurring (Enforcement Tracker Bug)

`markImageSafe()` had an enforcement tracker that kept forcing images back to "safe" even after they were re-analyzed and blurred. Removed the tracker entirely.

### Files Modified
- `content.js` — `markImageSafe()`

---

## 2026-02-08 — Fixed Dark Dimming Overlay (Made Transparent)

Changed overlay background from `rgba(0,0,0,0.85)` to transparent. Badge now self-contained with its own background.

### Files Modified
- `content.js` — `createFloatingOverlay()` and all overlay HTML

---

## 2026-02-01 — X/Twitter Video Handling Overhaul (FAILED — In Progress)

### Problem
Video filtering on X/Twitter unreliable. X's React reconciler aggressively strips custom DOM attributes and removes injected child nodes.

### Approaches Tried and Failed
- Attempt 1: WeakSet + Scoped CSS Shield — orphaned floating overlays blocking controls
- Attempt 2: Floating Overlay Cleanup — videos started unblurring
- Attempt 3: WeakSet Delete Before Re-processing — still unblurring
- Attempt 4: Replace data-* with JS Properties — fixed attribute stripping, but X calls `.play()` programmatically
- Attempt 5: Content Script Prototype Override — isolated world, doesn't affect page JS
- Attempt 6: Main World Script Injection — chaos: double overlays, React replacing `<video>` nodes, `autoplay` attribute bypass
- Attempt 7: Container-Level Blur — CURRENT APPROACH (testing in progress at time of entry)

### Key Lessons
1. Content scripts run in isolated world — prototype overrides don't affect page JS
2. X's React reconciler strips `data-*` attributes and can replace entire `<video>` DOM elements
3. JS properties on DOM elements survive React re-renders but NOT element replacement
4. Container-level operations are more robust than element-level on React sites
5. Fighting autoplay is a losing battle on X

### Files Modified
- `content.js`
