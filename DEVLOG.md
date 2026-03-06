# ScrollVeil Development Log

> For entries before March 2026, see [DEVLOG-ARCHIVE.md](DEVLOG-ARCHIVE.md).

---

## 2026-03-06 — Popup: Protection Toggle + Blur Slider Fix

### 1. Protection Active → On/Off Toggle Button
The "Protection Active" status badge in the popup is now a clickable toggle button. Clicking it disables or re-enables ScrollVeil without going to chrome://extensions.

**How it works:**
- Toggle saves `scrollveilEnabled` flag to `chrome.storage.sync`
- After toggling, the active tab is reloaded via `chrome.tabs.reload()`
- On reload, `content.js` checks the flag before doing anything
- If disabled: blur shield is NOT injected, `processImage()` and `processVideo()` exit immediately
- Clean slate on reload — no need to manually undo blurs, overlays, or tracking state
- Popup stays open and shows current state (green active / red disabled)

### 2. Badge Clipping Fix: Hide Badges on Overflow-Hidden Images
Floating "Detecting..." badges were appearing on images that weren't actually visible to the user — images scrolled inside containers with `overflow: hidden` (e.g., carousel/slider widgets on Stockcake). The existing viewport check only checked if the image rect was within the browser viewport, but didn't account for CSS clipping by parent containers.

**Fix:** Added an ancestor walk in `updatePosition()` inside `createFloatingOverlay()`. For each `overflow:hidden` ancestor, checks whether the image's center point falls outside that ancestor's visible bounds. If clipped, the overlay is hidden.

### 3. Blur Strength Slider: Max Reduced from 300 to 100
The slider had `max="300"` which meant 299 discrete values across a ~250px wide slider. This caused the slider thumb to physically skip values (e.g., jumping from 9px to 11px) because each pixel of slider movement covered more than 1 unit. Reduced max to 100 — still very heavy blur at max, and every value from 1-100 is now individually selectable.

### 4. Frame Sampling Race Condition Fix
The `setInterval` calling `sampleOneFrame()` could fire while the previous frame was still being analyzed. Since `setInterval` doesn't wait for async functions to complete, two (or more) frame analyses could run simultaneously, causing unstable scores and extra CPU usage. Added an `isAnalyzingFrame` boolean guard — if the previous frame is still being processed, the interval tick is skipped. A `finally` block ensures the flag is always cleared, even if analysis errors out.

### Known Cosmetic Issues (post-launch)
1. **Badge z-index vs. page headers** — Floating badges use `z-index: 2147483640` which paints above fixed headers and nav bars. Images scrolling behind a sticky header still show their badge above it. Needs a smarter z-index strategy or a different badge anchoring approach.
2. **Blur glow bleeds outside containers** — CSS `filter: blur()` naturally extends beyond the element's bounds. At high blur strengths (40-100px), blurry glow is visible outside image containers. This is standard browser behavior. The fix would require adding `overflow: hidden` to image parents, which risks breaking page layouts.

### Files Modified
- `popup.html` — Status badge → clickable toggle button with enabled/disabled CSS states, blur slider max reduced to 100
- `popup.js` — Toggle click handler saves `scrollveilEnabled` to storage, reloads active tab
- `content.js` — Checks `scrollveilEnabled` flag at startup; skips blur shield + processing if disabled; overflow-hidden clipping check in `createFloatingOverlay()`
- `manifest.json` — No new permissions needed
- `DEVLOG.md` — this entry

---

## 2026-03-06 — CORS Debugging: Diagnosed "CORS BLOCKED" on All Sites

### Problem
All images on X/Twitter (and potentially other cross-origin sites) were showing "CORS blocked - no analysis possible" in the console. Every image scored 0% and got the fallback detection path instead of real ML analysis.

### Investigation
Added debug logging to three files to trace the CORS bypass chain:
1. `personDetection.js` — log when canvas is tainted by CORS
2. `detector.js loadImageWithCORS()` — log each step of the background fetch bypass
3. `background.js fetchImage` — log when the background script receives/completes fetch requests

### Root Cause
The CORS bypass infrastructure (`loadImageWithCORS` → background.js `fetchImage` handler) was **already built and functional**. The issue was that the extension hadn't been reloaded after previous code changes. Once reloaded, the bypass chain works correctly:
1. `personDetection.js` tries canvas → tainted by CORS → returns `hasPeople: null`
2. `detector.js tryAnalyzeImage()` tries canvas → tainted → returns null
3. `detector.js loadImageWithCORS()` sends URL to background.js via `chrome.runtime.sendMessage`
4. `background.js fetchImage` uses `fetch()` with extension's `host_permissions` (bypasses CORS)
5. Background converts blob to base64 data URL → sends back to detector
6. Detector creates `new Image()` from data URL (same-origin) → canvas reads succeed
7. Full skin analysis runs (texture filter, YCrCb + RGB blend, scoring)

### Known Limitation (FIXED — see entry below)
Person detection on CORS-blocked images was fixed by adding a background fetch fallback to `personDetection.js`.

### Files Modified
- `personDetection.js` — added CORS taint debug log
- `detector.js` — added debug logs in `loadImageWithCORS()` (5 locations)
- `background.js` — added debug logs in `fetchImage` handler (3 locations)
- `DEVLOG.md` — this entry

---

## 2026-03-06 — Fix: Person Detection (COCO-SSD) CORS Fallback via Background Script

### Problem
On CORS-blocked sites (X/Twitter, etc.), `personDetection.js` tried to draw the cross-origin image onto a canvas and call `getImageData()`. This threw a "canvas tainted" error, causing the module to return `hasPeople: null` — which skipped the entire ML pipeline (COCO-SSD, BlazeFace, BlazePose, MobileNet). Images were only getting skin analysis without any ML model guidance.

### Fix
Added `getImageDataViaBG()` fallback in `personDetection.js`. When the canvas is tainted by CORS:
1. Sends the image URL to `background.js` via `chrome.runtime.sendMessage({ action: 'fetchImage' })`
2. Background script fetches the image using extension's `host_permissions` (bypasses CORS)
3. Background converts blob to base64 data URL and returns it
4. `personDetection.js` creates a `new Image()` from the data URL (same-origin, no CORS)
5. Draws onto canvas and extracts pixel data normally
6. Sends pixel data to the sandbox for COCO-SSD/BlazeFace/BlazePose/MobileNet as usual

The fallback uses the same `fetchImage` handler that `detector.js loadImageWithCORS()` already uses successfully. Now both person detection AND skin analysis work on CORS-blocked sites.

### Files Modified
- `personDetection.js` — added `getImageDataViaBG()` fallback function, modified `detectPeople()` to use it when `getImageData()` returns null
- `DEVLOG.md` — this entry

---

## 2026-03-06 — Detection Workbench Phase 2 (Session 1): Slider UI + Config System

### What Was Added
Session 1 of Phase 2 adds the complete slider UI infrastructure, config system, and toolbar to the Detection Workbench. The actual configurable analysis functions (re-running pixel analysis with slider values) will be added in Session 2.

### DEFAULT_CONFIG Object (~50 Parameters)
Mirrors every tunable hardcoded value in detector.js:
- **Decision Thresholds** — blur (45), block (80)
- **Skin YCrCb** — Cr/Cb ranges, Y minimum, RGB prefilter minimums (8 params)
- **Skin RGB Realistic** — R/G/B ranges, channel difference ranges, spread (14 params)
- **Texture Variance Filter** — min Cr variance, neighbor radius (2 params)
- **COCO-SSD** — confidence threshold (1 param)
- **Face/Arm Exclusion** — neck/side padding, portrait ratio, arm thickness, hand radius (5 params)
- **Zone Weight Multipliers** — 7 body zones, each 0-3x
- **Score Ladder Thresholds** — 5 skin ratio cutoffs + 7 base scores (12 params)
- **Zone Boost Values** — individual boosts + multi-zone multipliers (13 params)
- **Scene Context** — intimate/domestic/isolated boosts (3 params)

### Slider UI
- 10 collapsible slider groups with arrow toggle headers
- Each slider shows label, range input, and current value
- Gold highlight on any slider modified from its default value
- 150ms debounce on slider input for responsive re-analysis
- All sliders built dynamically from SLIDER_GROUPS definition array

### Toolbar
- **Compare** — toggles side-by-side comparison view (ORIGINAL vs ADJUSTED canvases)
- **Reset All** — resets every slider to DEFAULT_CONFIG values, clears gold highlights
- **Export Config** — copies JSON of only changed values + timestamp to clipboard

### Comparison Mode
- Dual canvas layout below the main canvas
- Left side labeled ORIGINAL with original score overlay
- Right side labeled ADJUSTED with adjusted score overlay
- Both sides show the same image at 400px max width

### Bug Fixes (in Phase 1 code)
- Fixed zone chart using `skinPercent` instead of `skinRatio` (property name mismatch)
- Fixed zone overlay labels using `skinPercent` instead of `skinRatio`
- Fixed pixel inspector using `yCrCb.Y/Cr/Cb` instead of lowercase `y/cr/cb`

### Architecture
- `DEFAULT_CONFIG` — single source of truth for all default values
- `currentConfig` — mutable copy, updated on every slider change
- `cachedModelOutputs` — stored after initial analysis, reused on slider change
- `reanalyzeWithConfig()` — placeholder for Session 2 (logs to console)
- Slider groups defined as data (SLIDER_GROUPS array) and rendered dynamically

### Files Modified
- `workbench.html` — CSS, HTML, and JavaScript additions (~22KB added)
- `DEVLOG.md` — this entry

### What's Next (Session 2)
- `analyzeImageFullConfigurable()` — pixel pipeline that accepts config overrides
- `calculateScoreConfigurable()` — scoring with configurable zone weights and thresholds
- Wire `reanalyzeWithConfig()` to actually re-run analysis with current slider values
- Draw adjusted overlays on comparison canvas

---

## 2026-03-06 — Detection Workbench Phase 2 (Session 2): Configurable Analysis Engine

### What Was Added
Session 2 implements the actual re-analysis engine that makes sliders functional. Moving any slider now instantly re-runs the pixel analysis and scoring pipeline with the adjusted values.

### New Functions
- **`isRealisticSkinCfg(r, g, b, cfg)`** — RGB skin detection using slider values for all thresholds (R/G/B ranges, channel differences, spread)
- **`isYCrCbSkinCfg(r255, g255, b255, cfg)`** — YCrCb skin detection using slider values for Cr/Cb ranges, Y minimum, and RGB prefilters
- **`analyzeCombinedCfg(pixels, w, h, cfg)`** — full pixel analysis loop using configurable skin detectors + configurable texture variance filter. Produces skinMap, skin ratios, cluster analysis, and all metrics identical to detector.js `analyzeCombined()`
- **`calcScoreCfg(analysis, cfg, ...)`** — complete scoring pipeline using configurable ladder thresholds, base scores, zone boost values multiplied by zone weight multipliers, and scene context boosts. Includes all caps (portrait, clothed person, uniform texture, clothing override, face cap)
- **`reanalyzeWithConfig()`** — full orchestration: re-draws image to fresh 299x299 canvas, re-applies BBox masking with configurable COCO-SSD confidence, re-applies face/arm exclusion with configurable padding/thickness, runs configurable skin analysis, applies clothing override, measures body zones, runs configurable scoring, updates score display + overlays + pipeline details + zone chart + compare view. Logs execution time to console.
- **`drawOverlaysOnCanvas(ctx, w, h, od)`** — generic overlay renderer that works on any canvas context. Used by the compare view to draw skin masks, COCO-SSD boxes, BlazePose skeletons, and body zones on both the ORIGINAL and ADJUSTED canvases.

### Compare View
- Left side always shows the ORIGINAL analysis result (saved at initial analysis time as `originalResult`)
- Right side shows the ADJUSTED result (updated on every slider change)
- Both sides render overlays using the same toggle checkboxes
- Score overlays color-coded on both sides

### Performance
- Slider changes skip all ML models (COCO-SSD, BlazeFace, BlazePose, MobileNet) — only re-runs pixel analysis + scoring
- Typical re-analysis time: 10-50ms on a 299x299 canvas (logged to console)
- 150ms debounce prevents rapid-fire re-analysis during slider dragging

### Architecture Notes
- All configurable functions are defined inside the workbench IIFE — detector.js is NOT modified
- `cachedModelOutputs` stores ML model results from initial analysis
- `originalResult` stores the first pipeline result for compare mode
- COCO-SSD confidence slider re-filters the cached detections (can add/remove person detections)
- Face/arm exclusion uses configurable padding values from sliders

### Files Modified
- `workbench.html` — ~350 lines of new configurable analysis code + compare overlay rendering
- `DEVLOG.md` — this entry

---

## 2026-03-06 — Detection Workbench: Complete Rebuild (Phase 1)

### Why Rebuild
The previous workbench (workbench_old.html) accumulated massive technical debt over months of feature additions — anime face detection, edge/Sobel detection, contour detection, geometric zone fallbacks, and hundreds of interconnected references made it unfixable. Multiple cleanup attempts failed. Decision was made to start fresh with a clean architecture matching the simplified pipeline.

### What Was Built
New `workbench.html` — single standalone file, clean architecture, Phase 1 (foundation + overlays + score breakdown):

1. **TF.js Model Loading from CDN** — All 4 models load directly (COCO-SSD, BlazeFace, BlazePose, MobileNet) with status indicators in a top bar showing loading/ready/failed state for each model.

2. **Image Loading** — Drag-and-drop, file browse, and clipboard paste support. Images display on a canvas scaled to max 800px wide.

3. **Full Detection Pipeline** — Workbench runs the complete pipeline matching the live extension:
   - COCO-SSD person detection → bounding box masking
   - BlazeFace face detection → exclusion zones
   - BlazePose pose detection → arm/hand exclusion + body zone measurement
   - MobileNet clothing classification → skin pixel override
   - Skin detection (YCrCb + RGB) via `analyzeCombined()` inherited from detector.js
   - Texture variance filtering
   - Body zone measurement via `measureBodyPartZones()`
   - Score calculation via `calculateScore()`

4. **Toggleable Overlay Layers** (9 layers):
   - Skin Detection Mask (red)
   - COCO-SSD Bounding Boxes (green, with labels)
   - BlazeFace Faces (blue)
   - BlazePose Skeleton (pink, with connections)
   - Body Zones (colored rectangles with skin % labels)
   - Face/Arm Exclusion zones (blue tint)
   - BBox Mask Region (green tint)
   - Body Outline Polygon (dashed green, from pose keypoints)
   - Clothing Override (cyan, showing removed skin pixels)

5. **Score Display** — Large color-coded score with decision (ALLOWED/BLURRED/BLOCKED) and detection reasons.

6. **Pipeline Details Panel** — Full breakdown organized by section: COCO-SSD Detection, Face Detection, Pose Detection, Clothing Classification, Skin Analysis, Scene Context, Final Score.

7. **Body Zone Chart** — Bar chart showing skin % per anatomical zone (shoulders through feet) with exposed/high-exposure summary.

8. **Pixel Inspector** — Hover over any pixel to see RGB, HSL, YCrCb values plus skin detection results (RGB skin ✅/❌, YCrCb skin ✅/❌, in skinMap, in bbox, excluded).

### Architecture
- Single HTML file loads detector.js via `<script src>` and creates a `ScrollVeilDetector` instance
- ML models loaded directly from CDN (not through extension sandbox)
- Workbench owns model execution (COCO-SSD, BlazeFace, BlazePose, MobileNet) and feeds results into detector methods
- All skin detection, scoring, and zone measurement methods inherited from detector.js — no code duplication
- Overlay data captured during pipeline execution and stored for independent toggle rendering
- Press Escape to reset and load a new image

### Key Differences from Old Workbench
- No anime face detection, edge/Sobel, contour detection, or geometric zone fallback (removed systems)
- No slider groups or live adjustment (Phase 2)
- No gallery or batch processing (Phase 3)
- Clean separation: models → pipeline → overlays → results
- ~700 lines vs ~5000+ lines in old workbench

### Files Modified
- `workbench.html` — new file (complete rebuild)
- `DEVLOG.md` — this entry

### Future Phases
- Phase 2: Live adjustment sliders for all thresholds with real-time recalculation
- Phase 3: IndexedDB gallery with categories, expected scores, batch processing, export/import

---

## 2026-03-06 — Devlog Archived

### What Changed
Split `DEVLOG.md` into two files to reduce token usage in AI-assisted development sessions:
- **`DEVLOG-ARCHIVE.md`** — All entries from February 1–24, 2026 (~110KB)
- **`DEVLOG.md`** — March 2026 entries only (current file)

### Why
The full devlog had grown to 120KB (~30,000–35,000 tokens), consuming a significant portion of the context window every time it was read. Archiving older entries saves ~25,000 tokens per session while keeping the full history accessible.

---

## 2026-03-06 — Fix: Video Frame Sampling Breaks When Settings Changed from Defaults

### Problem
Changing video frame sampling settings (interval, duration, early exit threshold) in the popup appeared to completely break frame sampling. Only the default settings (3s interval, 30s duration, 75% early exit) worked.

### Root Cause (Two Bugs)

**Bug 1: No live-update of video settings.**
The `chrome.storage.onChanged` listener in content.js only handled `blurStrength` and `autoUnblurThreshold`. It did NOT update `VIDEO_SAMPLING_DEFAULTS` when video settings changed. Existing tabs kept using whatever was loaded at page start, and if the async `chrome.storage.sync.get()` hadn't completed before video processing began, the hardcoded defaults were used instead.

**Bug 2: `setInterval` overwhelms analysis at fast intervals.**
`setInterval` fires on a fixed clock regardless of whether the previous frame's analysis has completed. Each ML analysis takes 2–5 seconds. Setting interval to 1 second caused `setInterval` to fire while the previous frame was still being analyzed. The `isAnalyzingFrame` guard skipped these overlapping ticks, so most frames were silently dropped — making it appear broken.

### Fix

**Part A — Live settings update:** Added `videoInterval`, `videoDuration`, and `earlyExitThreshold` to the `chrome.storage.onChanged` listener so settings take effect immediately on existing tabs without requiring a page reload.

**Part B — Chained setTimeout replaces setInterval:** Replaced `setInterval(sampleOneFrame, interval)` with a chained `setTimeout` pattern. Each frame now waits for the previous analysis to fully complete before scheduling the next frame after the configured interval. This ensures every frame is actually analyzed regardless of how fast the interval is set. Also changed `clearInterval` → `clearTimeout` in `cancelVideoFrameSampling()`.

### Files Modified
- `content.js` — Added video settings to `chrome.storage.onChanged` listener (~line 780); replaced `setInterval` with chained `setTimeout` in `startVideoFrameSampling()` (~line 2097); changed `clearInterval` → `clearTimeout` in `cancelVideoFrameSampling()` (~line 1924)
- `DEVLOG.md` — this entry

---

## 2026-03-06 — Fix: Early Exit Threshold 0% Instantly Completes Analysis

### Problem
Setting the early exit threshold to 0% in the popup caused frame sampling to complete immediately after the first frame. The popup hint says "0% = never stop early" but the code treated 0 as a valid threshold.

### Root Cause
The early exit check was `if (state.peakScore >= earlyExitThreshold)`. Since any score (even 0%) is `>= 0`, the condition was always true on the very first frame, triggering immediate completion.

### Fix
Added a guard: `if (earlyExitThreshold > 0 && peakScore >= earlyExitThreshold)`. When the threshold is 0, the early exit check is skipped entirely, matching the popup's documented behavior of "never stop early."

### Files Modified
- `content.js` — Added `> 0` guard to early exit check (~line 2034)
- `DEVLOG.md` — this entry


---

## 2026-03-06 — ScrollVeil Website Live at scrollveil.com

### What Happened
Launched the ScrollVeil landing page website using GitHub Pages with a custom domain from GoDaddy.

### Issue Encountered
The site was showing a **"Your connection is not private"** error (NET::ERR_CERT_COMMON_NAME_INVALID) when visiting https://scrollveil.com.

### Root Cause
GoDaddy's DNS had a conflicting **"WebsiteBuilder Site" A record** alongside the four correct GitHub Pages A records (185.199.108-111.153). This extra record caused SSL certificate mismatch errors because traffic was being split between GitHub's servers and GoDaddy's website builder.

### Fix
1. Navigated to GoDaddy DNS Management for scrollveil.com
2. Deleted the "WebsiteBuilder Site" A record
3. Verified DNS resolution via PowerShell `Resolve-DnsName` — all 4 GitHub IPs confirmed, no conflicting records
4. Waited for GitHub's DNS check to pass (took ~15 minutes)
5. GitHub automatically provisioned a TLS certificate (3 of 3 steps completed)
6. Site is now live at scrollveil.com

### DNS Records (Final Correct State)
- **A** @ → 185.199.108.153
- **A** @ → 185.199.109.153
- **A** @ → 185.199.110.153
- **A** @ → 185.199.111.153
- **CNAME** www → mikearold.github.io
- **CNAME** _domainconnect → _domainconnect.gd.domaincontrol.com

### Next Step
- Enable "Enforce HTTPS" checkbox in GitHub Pages settings once available


---

## 2026-03-06 — Fix: Instagram/Google Images Infinite Scroll Detection

### Problem
When scrolling down on Instagram and Google Images, new content loaded via infinite scroll was not being detected and blurred by ScrollVeil. The extension worked on initially loaded content but "struggled" with dynamically loaded containers that appeared as the user scrolled.

### Root Cause
Two gaps in the detection system:

1. **MutationObserver only watched for `src` attribute changes.** Instagram and Google Images use `srcset` for responsive images and `loading="lazy"` attributes that change as images enter the viewport. These changes weren't triggering re-processing.

2. **Periodic rescan too slow.** The existing rescan ran every ~2 seconds via the enforcement scheduler. On fast-scrolling infinite-scroll sites, users could scroll past multiple screens of new content before the rescan triggered, leaving images unblurred for a noticeable period.

### Fix (Three Changes)

**1. Expanded MutationObserver attributeFilter**
Added `srcset` and `loading` to the watched attributes alongside `src`. Now when Instagram/Google Images updates an image's `srcset` or transitions it from `loading="lazy"` to `loading="eager"`, the observer catches it and triggers `processImage()`.

**2. Expanded attribute mutation handler**
The mutation callback's attribute check was hardcoded to only handle `src` changes. Expanded the condition to also process `srcset` and `loading` attribute mutations using the same re-processing logic (clear processed flags, push to newImages array).

**3. Added scroll-triggered rescan**
New `scroll` event listener with 300ms debounce fires an immediate rescan when the user stops scrolling. This catches any new images/videos that slipped through the MutationObserver (e.g., React virtual DOM swaps, container recycling). The debounce prevents excessive CPU usage during fast scrolling. Uses `{ passive: true }` for scroll performance.

### Performance Considerations
- Scroll listener uses `passive: true` — does not block scroll performance
- 300ms debounce prevents rapid-fire rescans
- Rescan checks `processedImages` WeakSet first — already-processed images are skipped in O(1)
- Periodic 2-second rescan remains as a safety net
- Console logs when scroll rescan finds new elements for debugging

### Files Modified
- `content.js` — Added `srcset`/`loading` to attributeFilter (~line 3092), expanded attribute mutation handler (~line 3042), added scroll-triggered rescan with debounce (~line 3157)
- `DEVLOG.md` — this entry
