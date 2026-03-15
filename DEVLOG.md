# ScrollVeil Development Log

> For entries before March 2026, see [DEVLOG-ARCHIVE.md](DEVLOG-ARCHIVE.md).

---

## 2026-03-10 — New Icons & Logos Across All Platforms

### Summary
Deployed new cyberpunk eye+shield logo across the entire ScrollVeil ecosystem: Chrome extension, website, and Android app. Icons extracted from a master icon sheet with two design variants: transparent background (extension toolbar + website) and black background (Android home screen + store listings). The 512x512 and 1024x1024 app logos were regenerated from a separate high-res source to avoid upscaling blur.

### What Changed

**Chrome Extension (8 icons, transparent background):**
- icon16, icon19, icon32, icon38 (retina), icon48, icon64, icon128
- store_icon_128 (black background for Chrome Web Store)

**Website (9 files + HTML updates):**
- favicon.ico, favicon-16/32/48.png, nav-logo-48.png, apple-touch-180.png
- hero-wide-1024.png (natural aspect ratio), hero-banner-with-text.png, hero-512.png
- index.html: Updated favicon links, nav logo, added hero image

**Android App (5 mipmap icons, black background):**
- mdpi (48px), hdpi (72px), xhdpi (96px), xxhdpi (144px), xxxhdpi (192px)

**App Store Logos (19 sizes, black background):**
- Full set from 29x29 to 1024x1024 for Play Store / App Store submissions

### Design Decisions
- Transparent for extension/website (eye floats naturally)
- Black background for Android/stores (launchers apply shaped masks; Play Store rejects transparency)
- "As-is" crop (full eye preserved) over center-crop to keep wing tips visible
- 512/1024 sourced from separate high-res image (1330px wide) to avoid upscaling artifacts

### Files Modified
- `icons/` — 8 extension icon files
- `index.html` — favicon links, nav logo, hero image
- Root website — 9 new icon/logo files
- Android mipmap folders — 5 icons

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

## 2026-03-07 — Default Auto-Unblur Changed to 0% (Manual Only)

### Summary
Changed the default auto-unblur threshold from 20% to 0%, meaning new installs will require users to manually reveal every blurred image unless they change the setting.

### Rationale
The safest default experience is full protection — everything stays blurred until the user actively chooses to reveal it. Users who want automatic unblurring of low-risk content can adjust the slider themselves.

### Changes
- `popup.js` — `SCROLLVEIL_DEFAULTS.autoUnblurThreshold`: 20 → 0
- `popup.html` — Slider default value and display: 20% → 0%
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

---

## 2026-03-07 — Website: Early Access Messaging, My Story, Email Signup + CHANGELOG

### What Changed
Major website update ahead of launch to set honest user expectations and add personal context.

### Early Access Banner
Added a prominent banner at the very top of the page (above nav) clearly stating ScrollVeil is free during early access and that paid plans are coming — with a link to the email signup. Users will never be surprised by a paywall.

### My Story Section
Added a personal testimony section from Michael Arold explaining the real-life experiences that motivated ScrollVeil — growing up with early internet, social media's role in addiction, recovery through faith, and the AI-assisted journey to build this tool. Placed before the CTA section for maximum emotional impact. Signed with name and "Creator of ScrollVeil."

### Email Signup
Added an email capture form to the CTA section with a "Stay in the loop" callout — notifies users when Android launches and before any pricing changes. Currently shows a confirmation message on submit. TODO: wire up to Mailchimp when account is created.

### Navigation
Added "My Story" link to the nav bar.

### CHANGELOG.md
Created `CHANGELOG.md` — user-facing version history using semantic versioning (MAJOR.MINOR.PATCH). v1.0.0 documents all features in the initial release. Upcoming section notes Android, accounts, and paid plans.

### Files Modified
- `index.html` — Early access banner, My Story section, email signup form + handler, nav update, CTA text update
- `CHANGELOG.md` — new file, v1.0.0 initial release
- `DEVLOG.md` — this entry

---

## 2026-03-07 — Feature: Draggable + Resizable Scoring Popup

### What Changed
The scoring/detail popup (`showUnblurPopup`) is now draggable and resizable.

### Drag to Move
- Popup header acts as a drag handle (cursor changes to grab/grabbing)
- On mousedown, popup converts from transform-centered to fixed top/left positioning
- Mouse move tracks offset and repositions popup, clamped within viewport bounds
- Backdrop click-to-close is disabled while dragging to prevent accidental closes
- Small "drag to move" hint text added to header

### Resize
- CSS `resize:both` on popup element enables native browser resize grip (bottom-right corner)
- `min-width:260px`, `min-height:180px` prevent shrinking too small

### Files Modified
- `content.js` — Updated `showUnblurPopup`: backdrop layout, popup positioning, header drag handle, drag event listeners, backdrop click guard
- `DEVLOG.md` — this entry

---

## 2026-03-07 — Fix: Popup Icon + Score Mismatch

### Bug 1 — Wrong icon in popup header
The popup header was showing a 🛡️ emoji instead of the actual ScrollVeil logo. Fixed by embedding the icon32.png as a base64 data URI directly in the popup HTML. This works on any website without path resolution issues.

### Bug 2 — Score mismatch between badge and popup
The reblur badge (shown after revealing an image) was using `result.score` (visual score only) while the popup correctly used `result.displayScore` (combined visual + language score). This caused the badge to show a different number than the popup.

Fixed by updating the reblur badge at line ~1821 to use `displayScore` with a fallback to `result.score`, matching the popup's logic.

### Files Modified
- `content.js` — Embedded base64 icon in popup header; fixed reblur badge to use displayScore
- `DEVLOG.md` — this entry

---

## 2026-03-07 — Fix: Bikini Score Floor

### Problem
A clearly visible bikini image could score as low as 10% when skin detection underperformed on a particular image size or crop. The clothing detection correctly identified bikini at 60-74% confidence but had zero effect on the final score because the `minimal` coverage type intentionally skipped the score cap (skin is real in bikinis). This left the score entirely dependent on skin detection, which is inconsistent across image resolutions.

### Root Cause
The clothing logic had two paths — cap scores DOWN for covering clothing, and do nothing for minimal clothing (bikini/swimwear). The "do nothing" path meant a 74% confidence bikini detection produced no minimum score guarantee.

### Fix
Added a score FLOOR for `minimal` and `minimal_legs` clothing types in `detector.js`:
- Bikini/swimwear ≥ 70% confidence → score floor of **70%**
- Bikini/swimwear ≥ 50% confidence → score floor of **60%**
- Below 50% confidence → no floor (too uncertain to guarantee)

This means a confidently detected bikini can never score below 60-70% regardless of skin detection performance.

### Files Modified
- `detector.js` — Added score floor block after clothing cap logic
- `DEVLOG.md` — this entry


---

## 2026-03-06 — Website Updated: Screenshot Gallery

### What Changed
Added a "See It In Action" section to the ScrollVeil website (scrollveil.com) with 12 screenshots showcasing the extension across multiple platforms.

### Screenshots Added
- 7 Google Images screenshots (bikini detection, tomato safe content, apple modals, settings popup)
- 1 X/Twitter screenshot (real-time analysis on social media)
- 1 Instagram screenshot (detail modal with skin analysis)
- 3 additional detail modal screenshots showing full detection breakdowns

### Features
- Color-coded platform badges (Google Images, X/Twitter, Instagram)
- Click-to-zoom lightbox for full-size viewing
- Descriptive captions for each screenshot
- "Screenshots" link added to navigation bar
- All images at original resolution for sharpness

### Store Screenshots
- 5 screenshots resized to 1280x800 for Chrome Web Store submission
- Mix of platforms: Google Images, X/Twitter, Instagram

### Git
- Initialized git in ScrollVeil folder, connected to github.com/mikearold/ScrollVeil
- Force pushed updated index.html + screenshots/ folder to main branch

### Files Modified
- `index.html` — Added screenshot gallery section with lightbox
- `screenshots/` — New folder with 12 PNG screenshots
- `DEVLOG.md` — this entry

---

## 2026-03-07 — Mailchimp Email Signup Wired (Secure)

### Summary
Email signup form on scrollveil.com is now fully functional and connected to Mailchimp.

### What Was Done
- Created Cloudflare Worker `scrollveil-mailchimp` at `scrollveil-mailchimp.mikearold.workers.dev`
- Worker acts as a secure proxy — Mailchimp API key stored as Cloudflare environment secret, never in public code
- Updated `index.html` `handleEmailSignup()` to POST to Worker URL instead of Mailchimp directly
- Removed previously exposed API key from codebase
- Pushed to GitHub (commit 9f93a31)

### Files Modified
- `index.html` — Replaced direct Mailchimp call with secure Cloudflare Worker call
- `DEVLOG.md` — this entry

---

## 2026-03-07 — ScrollVeil Submitted to Chrome Web Store 🎉

### Summary
ScrollVeil v1.0 has been officially submitted to the Chrome Web Store and is now **Pending Review**.

### Details
- Extension ID: `dmlhjkjiomphagapfjpblbopboohoejl`
- Publisher: mikearold
- Status: Pending compliance review (typically takes a few business days)
- Store listing includes: title, summary, full description, key features, how it works section
- Character count: 1,153 / 16,000

### Launch Checklist Status
- ✅ Website live at scrollveil.com
- ✅ Email signup working → Mailchimp (via Cloudflare Worker)
- ✅ support@scrollveil.com → Gmail forwarding
- ✅ Cloudflare protecting the site
- ✅ Privacy policy published
- ✅ Screenshots processed and uploaded
- ✅ ZIP packaged and uploaded (ScrollVeil_v1.0.zip)
- ✅ **Submitted to Chrome Web Store — Pending Review**
- 📋 Terms of Service + Refund Policy (for future paid version)

### What's Next
- Wait for Chrome Web Store review approval
- Monitor developer dashboard for any review feedback
- Plan post-launch priorities: video frame sampling polish, modular refactor, Android/iOS port research

---

## 2026-03-07 — UI: Compact Popup Layout + Collapsible Video Settings

### Summary
Reduced popup spacing to eliminate the Chrome scrollbar and made the Video Analysis section collapsible (collapsed by default).

### Changes
**Tighter spacing (popup.html CSS):**
- Body padding: 16px → 12px
- Header margin-bottom: 12px → 8px
- Status toggle: padding 8px 12px → 6px 10px, margin-bottom 14px → 10px
- Section margin/padding-bottom: 14px → 10px
- Last section margin-bottom: 10px → 6px

**Collapsible Video Analysis (popup.html + popup.js):**
- Added `.section-toggle`, `.toggle-arrow`, `.collapsible-content` CSS classes
- Wrapped Video Analysis controls in a collapsible container (collapsed by default)
- Clickable header with ▸/▾ arrow toggles visibility
- Added click handler in popup.js

### Files Modified
- `popup.html` — CSS spacing reductions, collapsible section markup and styles
- `popup.js` — Added video toggle click handler
- `DEVLOG.md` — this entry

---

## 2026-03-07 — Website: "On the Horizon" Roadmap Section

### Summary
Added a new roadmap section to scrollveil.com showcasing upcoming features, placed directly after the Features section.

### Features Listed
- **Android App** — native mobile protection
- **iOS Browser** — custom browser since iOS blocks extension-level filtering
- **More Browsers** — Firefox, Edge, and others
- **Accountability Features** — optional trusted-partner reporting tools

### Changes
- Added "Roadmap" link to nav bar
- Added "On the Horizon" section using existing feature-card grid layout
- Section ID: `#roadmap`

### Files Modified
- `index.html` — New nav link + roadmap section
- `DEVLOG.md` — this entry

---

## 2026-03-07 — Website: Combined Legal Page (ToS + Refund + Privacy)

### Summary
Created `legal.html` — a single page containing Terms of Service, Refund Policy, and Privacy Policy. Replaced the full privacy policy on the main page with a short summary and links.

### Terms of Service Highlights
- ScrollVeil provided "as is" with no guarantees of catching all content
- IP and code are property of Michael Arold, all rights reserved
- Users may not reverse engineer, redistribute, or build competing products
- Governing law: United States, disputes resolved by negotiation then arbitration

### Refund Policy Highlights
- 7-day free trial, no payment required
- Monthly ($2.99/mo): full refund within 14 days
- Annual ($30/yr): full refund within 30 days, prorated after
- Cancel anytime, keep access through end of billing period

### Pricing Model
- Free during Early Access
- Paid plans: $2.99/month or $30/year
- 7-day free trial with no paywall

### Changes to index.html
- Nav link changed from "Privacy" → "Legal" (links to legal.html)
- Full privacy policy section replaced with short summary + links to legal.html

### Files Modified
- `legal.html` — New file with all three legal documents
- `index.html` — Updated nav link, replaced privacy section with summary
- `DEVLOG.md` — this entry

---

## 2026-03-07 — Website: Pricing Section

### Summary
Added a pricing section to scrollveil.com with three tiers: Early Access (free), Annual ($30/yr), and Monthly ($2.99/mo). Placed between the Roadmap and How It Works sections.

### Pricing Tiers
- **Early Access** — Free, all features, no account required
- **Annual** — $30/year (16% savings), 7-day free trial, featured card with green border
- **Monthly** — $2.99/month, 7-day free trial
- Reassurance note: Early Access users notified before any pricing changes

### Changes
- Added Pricing CSS (card grid, featured highlight, checkmark feature lists)
- Added mobile responsive rule for pricing grid
- Added "Pricing" nav link
- Added pricing section HTML with 3 cards

### Files Modified
- `index.html` — Pricing CSS, nav link, section HTML
- `DEVLOG.md` — this entry

---

## 2026-03-08 — Android App: First Successful Build + Emulator Launch 🎉

### Milestone
ScrollVeil Android prototype built successfully and launched on Android emulator for the first time.

### Build Details
- **Build result:** BUILD SUCCESSFUL in 25s (31 actionable tasks: 16 executed, 15 up-to-date)
- **Install result:** Install successfully finished in 4s 64ms
- **Emulator:** Medium Phone API 36.1
- **Project location:** `C:\Users\Family\OneDrive\Desktop\Vibe Coding\ScrollVeil Android\`

### App UI Confirmed Working
Screenshot confirmed the MainActivity settings screen displaying correctly:
- 👁 ScrollVeil logo and "Browse with confidence" tagline
- ⚠️ "Step 1: Enable Accessibility Service" warning banner
- ScrollVeil Enabled toggle (ON by default)
- Blur Strength slider at 10px (range 1px–100px)
- "1. ENABLE ACCESSIBILITY SERVICE" button
- "2. GRANT OVERLAY PERMISSION" button
- "How it works" instruction steps at bottom

### Architecture (4 Java files)
| File | Role |
|---|---|
| `MainActivity.java` | Settings screen UI |
| `ScrollVeilAccessibilityService.java` | Watches X app (com.twitter.android) for window/content/scroll events |
| `BlurOverlayManager.java` | Finds media elements in accessibility tree, draws blur patches + eye badges |
| `OverlayService.java` | Foreground service with persistent notification while X is open |

### Detection Method
Accessibility tree parsing — finds `ImageView`, `VideoView`, `SurfaceView`, `TextureView` nodes ≥ 100x80dp. No ML models needed on Android (no NudeNet, no NSFWJS). Stays ethically pure.

### Blur Implementation
- Android 12+: Native `RenderEffect.createBlurEffect()`
- Android 11 fallback: Semi-transparent dark overlay scaled by blur radius

### Next Steps
1. Test accessibility service + overlay permission flow in emulator
2. Open X (Twitter) app in emulator and verify images/videos blur
3. Test reveal badge (eye icon) tap → unblur → re-blur
4. Connect Galaxy A16 5G via wireless debugging for real device test
5. Tune `MIN_WIDTH_DP` / `MIN_HEIGHT_DP` thresholds if needed (currently 100x80dp)

### Known JDK Issue (Recurring)
Android Studio Panda resets JDK to JDK 21 which breaks builds. Fix: `org.gradle.java.home=C:\\Program Files\\Android\\Android Studio\\jbr` in `gradle.properties`. If build fails, click the blue "Apply compatible Gradle JDK configuration and sync" link in the Build panel.

---

## 2026-03-08 — Android Accessibility Overlay Approach Abandoned

### Summary
After multiple iterations, the Accessibility Service + floating overlay approach for the Android app has been abandoned due to fundamental platform limitations. The old project at `C:\Dev\ScrollVeilAndroid` has been deleted.

### What We Tried (3 iterations)
1. **Coordinate-keyed overlays** — Tracked images by screen position. Overlays destroyed/recreated on every scroll, causing severe lag.
2. **Pool-based overlays with 30fps polling** — Reused overlays by index to avoid destroy/recreate. Reduced lag slightly but overlays still trailed scrolling because the Accessibility API only reports positions *after* they change.
3. **Faster polling + blur fixes** — Reduced throttle to 16ms, added `CrossWindowBlurEnabledListener`. Confirmed Samsung Galaxy (Android 16) does NOT support `FLAG_BLUR_BEHIND` on accessibility overlays — system reports `systemBlurSupported = false`.

### Root Causes (Unfixable)
- **Lag:** Accessibility Service events arrive *after* scroll happens. Overlay windows are separate from the app's view hierarchy and cannot scroll in sync. No amount of polling can fix this — it's a fundamental platform limitation.
- **No blur:** `FLAG_BLUR_BEHIND` is disabled by Samsung One UI for accessibility overlay windows. Only dimming (solid dark tint) is possible. `RenderEffect.createBlurEffect()` only works on views you own, not another app's views.

### VPN Approach Also Ruled Out
Researched intercepting X's image traffic via a local VPN (`VpnService`). Blocked by X/Twitter's **certificate pinning** — the app hardcodes its TLS certificate and rejects any custom CA certificate. Would require rooting + Frida (security research tool), which is not viable for a consumer product.

### Competitor Analysis: HaramBlur
HaramBlur (290K downloads, same problem space) takes the **WebView approach** for their Android app — loads social media websites in a built-in browser rather than overlaying native apps. Their Play Store reviews confirm the same lag issues when using accessibility overlays. Their browser extension uses nsfwjs (trained on inappropriate content), which ScrollVeil avoids for ethical reasons.

### Decision: Pivot to WebView Approach
The next Android prototype will use an in-app WebView to load x.com (Twitter's mobile website). JavaScript injection allows reusing the Chrome extension's detection pipeline (content.js + TF.js models). This approach:
- Zero lag — images blur natively inside the page
- Real blur — CSS `filter: blur()` works perfectly in WebView
- Proven pattern — HaramBlur uses the same architecture
- Reuses existing code — same content.js pipeline

### Lessons Learned
1. Android's Accessibility Service is designed for *reading* other apps, not *modifying* their display. Floating overlays will always lag behind the content they try to cover.
2. `FLAG_BLUR_BEHIND` support varies by manufacturer. Samsung One UI disables it for accessibility overlays. Cannot rely on it.
3. Certificate pinning makes VPN-based image interception impossible without rooting.
4. The WebView approach (in-app browser) is the only viable way to blur content on Android without native app cooperation.
5. Always validate platform capabilities with a minimal prototype before building out features.


---

## 2026-03-08 — Android WebView Prototype Working ✅

### Summary
ScrollVeil Android v1.5.0-alpha1 is running on Michael's Samsung Galaxy. The app uses an in-app WebView to load x.com and injects the full Chrome extension detection pipeline via JavaScript. Blur, badges, and scoring all work.

### Architecture
The app is a single-activity Android app with a full-screen WebView that loads x.com's mobile website. On each page load, six files are injected in order via `evaluateJavascript()`:

1. `blur-shield.css` — Instant CSS blur protection (injected as a `<style>` tag)
2. `chrome-shim.js` — Fakes `chrome.storage` and `chrome.runtime` APIs with in-memory defaults
3. `personDetection.js` — Person detection helpers
4. `detector.js` — ScrollVeilDetector class (BlazeFace, COCO-SSD, BlazePose, MobileNet, skin detection)
5. `languageScoring.js` — Text/language analysis
6. `content.js` — Main content script (overlay badges, blur management, video sampling)

### Key Technical Decisions
- **Chrome API Shim:** Created `chrome-shim.js` to fake `chrome.storage.sync.get/set`, `chrome.storage.onChanged`, and `chrome.runtime.onMessage` so content.js runs unmodified in the WebView. Defaults: blur enabled, 30px strength.
- **Google OAuth:** Android WebViews block Google sign-in. Fixed by intercepting `accounts.google.com` URLs and opening them in the phone's real browser via `Intent.ACTION_VIEW`.
- **Gradle/JDK:** Android Studio Panda uses JDK 21 which requires Gradle 8.9+ and AGP 8.7.0. Gradle 8.2 fails with `JdkImageTransform` errors on JDK 21.

### Build Setup
- Project: `C:\Dev\ScrollVeilAndroid`
- Build: `gradlew.bat assembleDebug` with `JAVA_HOME` pointing to Android Studio's bundled JBR
- Install: ADB over WiFi (`adb connect <ip>:<port>`, `adb install -r app-debug.apk`)
- APK: `app\build\outputs\apk\debug\app-debug.apk`

### Files Created
- `build.gradle.kts` (project + app level)
- `settings.gradle.kts`, `gradle.properties`, `gradle-wrapper.properties`
- `AndroidManifest.xml` — Internet permission, dark theme, network security config
- `MainActivity.java` — WebView setup, 6-file injection pipeline, Google OAuth redirect, back navigation
- `chrome-shim.js` — Chrome API compatibility layer
- `activity_main.xml`, `strings.xml`, `styles.xml`, `network_security_config.xml`
- All extension JS/CSS files copied to `app/src/main/assets/`

### What's Next
- Test detection accuracy on mobile (are badges showing correct scores?)
- Add a settings UI for blur strength (currently hardcoded in shim defaults)
- Investigate if TF.js model loading needs optimization for mobile performance
- Consider adding a floating action button for reveal/re-blur all

---

## 2026-03-08 — Android App: Settings UI + Full Browser Mode

### Summary
Added a settings drawer and URL bar to the ScrollVeil Android app, transforming it from an X-only viewer into a full protected browser that works on any website.

### New Features
1. **URL Bar** — Top bar with text input. Type any URL and hit Go. If input has no dot, it does a Google search. Updates automatically as you navigate.
2. **Settings Drawer** — Slides in from the right via a gear icon:
   - **Protection Enabled** toggle — turns ScrollVeil on/off instantly. Off removes all overlays, badges, and CSS blur.
   - **Blur Strength** slider (0–50px) — updates the CSS `--scrollveil-blur` variable live, so existing blurs change in real time.
   - **Auto-Unblur Threshold** slider (0–100%) — pushes value into chrome-shim storage so content.js picks it up.
3. **Quick Links** — One-tap buttons for X, Reddit, YouTube, and Instagram in the settings drawer.
4. **Full Internet Protection** — No longer hardcoded to x.com. ScrollVeil injects its pipeline on every page load.

### Technical Details
- Layout uses `DrawerLayout` with a `LinearLayout` settings panel (gravity=end) for the slide-in drawer.
- Settings changes are pushed into the WebView via `evaluateJavascript()` calling `chrome.storage.sync.set()` on the shim, which fires `onChanged` listeners in content.js.
- CSS blur updates use `document.documentElement.style.setProperty('--scrollveil-blur', ...)` for instant visual feedback.
- URL navigation adds `https://` if missing, or does a Google search for non-URL input.
- Script injection checks for duplicate CSS injection with `getElementById` guard.

### Files Modified
- `activity_main.xml` — Complete rewrite: FrameLayout → DrawerLayout with URL bar, settings panel, sliders, quick links
- `MainActivity.java` — Complete rewrite: Added URL navigation, settings drawer, slider listeners, JS bridge, protection toggle

---

## 2026-03-09 — Website Content Cleanup for Launch

### Summary
Updated scrollveil.com landing page to remove outdated or strategically sensitive content before public launch.

### Changes Made (8 edits to index.html)

**Removed "no account needed" references (accounts coming in v1.1.0):**
- Removed "No account required" from Early Access pricing card
- Changed CTA tagline from "No account needed" → "Runs entirely on your device"
- Removed "No accounts" from Privacy by Design principle

**Fixed auto-unblur messaging (default is manual reveal):**
- Features card: Replaced "auto-reveal threshold" with sensitivity + optional auto-reveal language
- How It Works Step 3: Changed from "blur removed automatically" to "stays blurred until you choose to reveal" with auto-reveal as optional

**Removed specific model names (proprietary protection):**
- Features card: Replaced "person detection, pose estimation, skin analysis, clothing classification" with "proprietary AI detection stack"
- How It Works Step 2: Replaced "COCO-SSD, BlazeFace, BlazePose, MobileNet" with "proprietary multi-layer AI pipeline"
- Transparent scoring principle: Replaced "which models detected what" with "what was detected"

**Bonus: Security fix**
- Created `.gitignore` to prevent `API key.txt` from being pushed to the public repo
- Unstaged the file before committing

### Files Modified
- `index.html` — 8 content edits
- `.gitignore` — Created (excludes API key.txt and .bak files)
- `DEVLOG.md` — this entry


---

## 2026-03-13 — Settings Module Extraction (content.js Modular Refactor Step 1)

### Summary
First step of the content.js modular refactor: extracted all settings, site detection, CSS blur shield, and live update logic into a new `settings.js` module. This is the foundation for the full modular split that will enable a shared core between Chrome extension and Android app.

### What Moved to settings.js
- **Site detection:** `isOnXDomain`, `isOnYouTube` hostname checks
- **Setting variables:** `enabled`, `blurStrength`, `autoUnblurThreshold`, `videoSampling` (interval, duration, early exit)
- **CSS blur shield:** The entire `injectBlurCSS()` function and its enable/disable gating
- **Settings loading:** All three `chrome.storage.sync.get()` calls (enabled, main settings, video sampling)
- **Auto-unblur migration:** The one-time boolean-to-threshold migration logic
- **Live update listener:** The `chrome.storage.onChanged` handler for all settings
- **`updateExistingBlurs()`:** Updates already-blurred elements when blur strength changes

### How It Works
- `settings.js` wraps everything in an IIFE and exposes `window.ScrollVeilSettings` with getter properties
- Getters mean the values are always live — when settings change, any code reading `ScrollVeilSettings.blurStrength` automatically gets the new value
- `VIDEO_SAMPLING_DEFAULTS` in content.js is now a reference to the same object, so mutations from the onChange listener propagate automatically
- Local aliases (`isOnXDomain`, `isOnYouTube`) in content.js maintain backward compatibility

### Files Modified
- **NEW: `settings.js`** — 193 lines, all settings logic
- **`content.js`** — Removed ~170 lines of settings code, added aliases and references to ScrollVeilSettings. Reduced from 3,237 to 3,064 lines
- **`manifest.json`** — Added `settings.js` before `content.js` in content_scripts JS array

### Testing Checklist
- [ ] Extension loads without console errors
- [ ] Images blur on page load (CSS shield working)
- [ ] Score badges appear after analysis
- [ ] Popup blur strength slider updates blur in real-time
- [ ] Auto-unblur threshold works correctly
- [ ] Video frame sampling works with custom settings
- [ ] Enable/disable toggle in popup works
- [ ] Works on X/Twitter, YouTube, and generic sites

### Next Steps
This establishes the module pattern for the full refactor. Planned extraction order:
1. ~~settings.js~~ ✅ (this session)
2. YouTube thumbnail system → `sites/youtube.js`
3. Unblur popup → `ui/unblur-popup.js`
4. Floating overlay system → `ui/overlays.js`
5. Image processing → `pipeline/images.js`
6. Video processing → `pipeline/videos.js`
7. Observer/scanner → `core/observer.js`


### Bug Fix: Live Blur Strength Update
After initial testing, discovered that changing blur strength in the popup required a page refresh. The `onChanged` handler was updating the internal `blurStrength` variable and calling `updateExistingBlurs()` (which updates inline-blurred elements), but was missing the CSS variable update (`--scrollveil-blur`) that controls the blur shield on unanalyzed content. Added `document.documentElement.style.setProperty('--scrollveil-blur', blurStrength + 'px')` to the blur strength change handler. Live updates now work correctly.


---

## 2026-03-13 — YouTube Module Extraction (content.js Modular Refactor Step 2)

### Summary
Extracted the entire YouTube thumbnail system (~420 lines) into a new `youtube.js` module. This is the second module extraction in the content.js refactor, following the settings module earlier today.

### What Moved to youtube.js
- **Cache & tracking:** `ytThumbCache` (Map), `ytObservedThumbs` (WeakSet)
- **Helpers:** `getYTVideoURL`, `createYTBadge`, `ytScoreBadgeHTML`, `getYTBadgeHost`
- **Core functions:** `setupYTThumbnail`, `injectYTBadgeFromCache`, `runYTAnalysis`, `updateYTBadgeAfterAnalysis`
- **Watch page:** `setupWatchPageBadge`, `placeWatchBadge`, `watchPageProcessed` state
- **SPA navigation handler:** The 1-second interval that detects YouTube URL changes and resets video state

### Dependency Pattern
YouTube module loads BEFORE content.js but needs functions defined IN content.js (detector, showUnblurPopup, scoreElementText, etc.). Solved with a `registerDeps()` pattern:
- youtube.js defines a `deps` object with null placeholders
- content.js calls `ScrollVeilYouTube.registerDeps({...})` after detector initializes
- All YouTube functions reference `deps.detector`, `deps.showUnblurPopup`, etc.
- On non-YouTube sites, the module exposes no-op functions (zero overhead)

### Files Modified
- **NEW: `youtube.js`** — 428 lines, full YouTube thumbnail system
- **`content.js`** — Removed ~411 lines, added aliases and registerDeps call. Reduced from 3,064 to 2,662 lines
- **`manifest.json`** — Added `youtube.js` between `settings.js` and `content.js`

### Testing Checklist
- [ ] Extension loads without console errors on non-YouTube sites
- [ ] YouTube thumbnails blur on page load
- [ ] "Detecting..." badge appears, then scored badge after analysis
- [ ] Reveal/Reblur toggle works on YouTube thumbnails
- [ ] YouTube SPA navigation (clicking videos) resets analysis state
- [ ] YouTube hover preview blurs correctly
- [ ] X/Twitter still works (unrelated to this change, but verify no regressions)
- [ ] Generic sites still work

### Running Total
- content.js started at 3,237 lines
- After settings.js extraction: 3,064 lines
- After youtube.js extraction: 2,653 lines
- Total removed: 584 lines (~18% of original)


---

## 2026-03-13 — Unblur Popup Module Extraction (content.js Modular Refactor Step 3)

### Summary
Extracted the unblur confirmation popup and its helper functions (~470 lines) into `unblur-popup.js`. This is the third module extraction today.

### What Moved to unblur-popup.js
- **`showUnblurPopup()`** — the full reveal confirmation dialog (~258 lines): draggable popup, score display, scene summary, reasons list, visual/language score breakdown, reveal/cancel buttons, keyboard escape handler
- **`getHumanReadableReasons()`** — translates technical detection reasons into user-friendly language (~108 lines)
- **`getSceneSummary()`** — generates natural one-line scene descriptions from detection data (~109 lines)

### What Stayed in content.js
- **`getScoreBadgeHTML()`** — used by image/video badge code throughout content.js (7 references)
- **`getScoreColor()`** — used by both the popup module and content.js badge code (shared utility)

### Files Modified
- **NEW: `unblur-popup.js`** — 500 lines, popup + helper functions
- **`content.js`** — Removed ~470 lines, added alias. Reduced from 2,662 to 2,192 lines
- **`manifest.json`** — Added `unblur-popup.js` between `youtube.js` and `content.js`

### Running Total
- content.js started at 3,237 lines
- After settings.js: 3,064 lines
- After youtube.js: 2,653 lines
- After unblur-popup.js: 2,192 lines
- **Total removed: 1,045 lines (32% of original)**


---

## 2026-03-13 — Image & Video Processor Extraction (content.js Modular Refactor Steps 4 & 5)

### Summary
Extracted all image and video processing code into two dedicated modules. content.js is now just the glue — globals, scheduler, detector init, and scanner/observer.

### What Moved to image-processor.js (657 lines)
- `markImageSafe`, `getYTContainer`, `getScoreBadgeHTML`, `getScoreColor`
- `cleanupAllOverlaysForImage`, `addDetectingBadge`, `removeDetectingBadge`, `addSafeBadge`
- `processImage`, `blurImage`

### What Moved to video-processor.js (1,086 lines)
- `getVideoCacheKey`, `cancelVideoFrameSampling`, `startVideoFrameSampling`
- `finalizeVideoAnalysis`, `updateVideoFrameBadge`, `markVideoSafe`
- `processVideo`, `createFloatingOverlay`, `cleanupOverlayElement`, `cleanupVideoOverlays`, `blurVideo`

### Load Order Strategy
Unlike settings/youtube/popup modules which load BEFORE content.js, the processor files load AFTER it. This is because they reference `const` globals (`overlayRegistry`, `processedImages`, `detector`, etc.) defined in content.js. The scanner in content.js calls processor functions (`processImage`, `processVideo`) only asynchronously (inside `waitForDetector` callback), so the processor files are guaranteed to be loaded by the time they're needed.

### Files Modified
- **NEW: `image-processor.js`** — 657 lines
- **NEW: `video-processor.js`** — 1,086 lines
- **`content.js`** — Reduced to 474 lines (globals, scheduler, detector init, scanner/observer)
- **`manifest.json`** — Added both processor files after content.js

### Final Module Architecture
```
Load order:
1. personDetection.js    — ML person detection (offscreen)
2. detector.js           — ML scoring pipeline
3. languageScoring.js    — Text/language analysis
4. settings.js (195)     — Settings, site detection, CSS blur shield
5. youtube.js (428)      — YouTube thumbnail system
6. unblur-popup.js (500) — Reveal confirmation popup
7. content.js (474)      — Globals, scheduler, detector init, scanner
8. image-processor.js (657)  — Image analysis & blur
9. video-processor.js (1086) — Video analysis, frame sampling & blur
```

### Running Total
- content.js started at 3,237 lines → now 474 lines
- **Total removed: 2,763 lines (85% of original)**
- Code is now in 5 focused modules + slim content.js glue


## 2026-03-13 — Android Parity Update: Modular Architecture Sync

### What Was Done
Updated the Android WebView app to use the Chrome extension's new modular architecture. The Android app was running the OLD monolithic content.js (3,237 lines). Now it uses the same 9 modular JS files as the Chrome extension.

### Files Copied to Android Assets (from Chrome extension)
Replaced the old monolithic `content.js` with all new modules:
- `settings.js` (9.5 KB) — Settings, site detection, CSS blur shield
- `youtube.js` (16.7 KB) — YouTube thumbnail system
- `unblur-popup.js` (28.6 KB) — Reveal confirmation popup
- `content.js` (19.8 KB) — Slim glue file (globals, scheduler, detector init, scanner/observer)
- `image-processor.js` (30.7 KB) — Image analysis & blur
- `video-processor.js` (51.8 KB) — Video analysis, frame sampling & blur
- `profanity-list-en.json` (63.4 KB) — Language scoring word list (new for Android)

Also refreshed: `personDetection.js`, `detector.js`, `languageScoring.js`, `blur-shield.css`

### Chrome-Shim Updates (`chrome-shim.js`)
- Added `chrome.runtime.getURL()` shim — creates a blob URL from pre-injected profanity JSON so `languageScoring.js` can `fetch()` it identically to the Chrome extension
- Added `chrome.runtime.id` property
- Profanity list is injected as `window._scrollveilProfanityJSON` by MainActivity before the shim runs

### MainActivity.java Changes
- Added fields for 6 new modules + profanity JSON (12 total assets loaded)
- Updated `injectAllScripts()` injection order to match Chrome manifest:
  1. CSS blur shield (as style tag)
  2. Profanity JSON (as `window._scrollveilProfanityJSON`)
  3. Chrome API shim
  4. personDetection.js
  5. detector.js
  6. languageScoring.js
  7. settings.js
  8. youtube.js
  9. unblur-popup.js
  10. content.js
  11. image-processor.js
  12. video-processor.js

### Build Result
APK builds successfully (BUILD SUCCESSFUL in 14s). Not yet tested on device.

### What's Next
- Test APK on Michael's Galaxy A16
- Settings persistence via SharedPreferences (chrome-shim still uses in-memory storage)
- Android-specific bug fixes (YouTube badges, Instagram, Reddit, pointer-events)
- Establish shared core workflow to prevent future drift between platforms


## 2026-03-13 — Android Parity Update: Modular Architecture Sync

### Problem
The Android app's WebView injection was using the OLD monolithic `content.js` (3,237 lines) while the Chrome extension had been refactored into 9 focused modules. The Android app was missing 5 new module files entirely and had outdated copies of existing files.

### What Changed

#### Chrome Extension Module Load Order (from manifest.json)
```
blur-shield.css → personDetection.js → detector.js → languageScoring.js → settings.js → youtube.js → unblur-popup.js → content.js → image-processor.js → video-processor.js
```

#### Android Assets Updated
Replaced 6 old files and added 6 new ones. Android assets now contain all 12 files:
- `blur-shield.css` (updated)
- `chrome-shim.js` (updated — see below)
- `personDetection.js` (updated)
- `detector.js` (updated)
- `languageScoring.js` (updated)
- `profanity-list-en.json` (NEW — language scoring word list)
- `settings.js` (NEW — centralized settings, site detection, CSS blur shield)
- `youtube.js` (NEW — YouTube thumbnail system)
- `unblur-popup.js` (NEW — reveal confirmation popup)
- `content.js` (REPLACED — slim 474-line glue file, was 3,237-line monolith)
- `image-processor.js` (NEW — image analysis & blur)
- `video-processor.js` (NEW — video analysis, frame sampling & blur)

#### chrome-shim.js Updates
- Added `chrome.runtime.getURL()` shim — returns a blob URL for `profanity-list-en.json` so `languageScoring.js` can `fetch()` the word list just like in the Chrome extension
- Added `chrome.runtime.id` property
- Profanity list is pre-loaded by MainActivity as `window._scrollveilProfanityJSON` before the shim runs, then converted to a blob URL inside the shim

#### MainActivity.java Updates
- Added 6 new field variables: `settingsJs`, `youtubeJs`, `unblurPopupJs`, `imageProcessorJs`, `videoProcessorJs`, `profanityListJson`
- Updated `onCreate()` to load all 12 assets
- Updated `injectAllScripts()` injection order:
  1. CSS blur shield (as style tag)
  2. Profanity JSON (as `window._scrollveilProfanityJSON` global)
  3. Chrome API shim
  4. personDetection.js
  5. detector.js
  6. languageScoring.js
  7. settings.js
  8. youtube.js
  9. unblur-popup.js
  10. content.js
  11. image-processor.js
  12. video-processor.js

### APK Built & Installed
- Build: `assembleDebug` — SUCCESS
- Installed via ADB wireless to Galaxy A16 at `192.168.1.2:44433`

### Still TODO
- **Settings persistence** — chrome-shim still uses in-memory storage; need SharedPreferences bridge so settings survive app restarts
- **Shared core workflow** — establish build-time copy or shared directory so files don't drift again
- **Android-specific bug fixes** — YouTube badges, Instagram timing, Reddit, pointer-events on overlays
- **Test the new modular injection** — verify all modules initialize correctly in WebView

### Files Modified
- `C:\Dev\ScrollVeilAndroid\app\src\main\assets\chrome-shim.js` — rewritten with getURL shim
- `C:\Dev\ScrollVeilAndroid\app\src\main\assets\*` — all JS files replaced with Chrome extension versions
- `C:\Dev\ScrollVeilAndroid\app\src\main\java\com\scrollveil\app\MainActivity.java` — new fields, updated load & inject


### Debugging: WebView Scope Issues (3 iterations)

**Problem 1 — `sendMessage` hanging forever:**
`personDetection.js` calls `chrome.runtime.sendMessage()` with a callback. The shim's `sendMessage` was a no-op that never called the callback, so `detectPeople()` hung forever → `detector.analyzeImage()` hung → badges never created.
**Fix:** Updated shim's `sendMessage` to call callback with `null`. Added `chrome.runtime.lastError = null`.

**Problem 2 — `processImage is not defined`:**
In the Chrome extension, all content scripts share one execution context, so `function processImage()` in `image-processor.js` is visible to `content.js`. In Android WebView, `evaluateJavascript()` runs each script in its own scope. `content.js` was injected BEFORE `image-processor.js` and called `processImage()` immediately via `waitForDetector() → scanImages()`, which resolved synchronously because `ScrollVeilDetector` was already defined.

**Problem 3 — `const` already declared errors:**
`onPageFinished` fires multiple times on SPAs like X. The re-injection guard `if(!window.X){script}` wrapped scripts in `if` blocks, which turned `function` declarations into **block-scoped functions** — invisible outside the block and invisible to other scripts. The `if` blocks themselves caused the `const already declared` errors on the second injection.

**Problem 4 — Shared globals invisible across scripts:**
`const`/`let` at the top level of one `evaluateJavascript()` call are NOT visible in subsequent calls (unlike Chrome extension content scripts which share a lexical scope). Variables like `overlayRegistry`, `processedImages`, `isOnXDomain` defined in `content.js` were invisible to `image-processor.js`.

### Solution: Android Bridge + Injection Order

1. **Changed `const`/`let` to `var`** in the Android copy of `content.js` for all shared globals (`overlayRegistry`, `processedImages`, `isOnXDomain`, `detector`, etc.). `var` declarations at the top level of `evaluateJavascript()` attach to `window`.

2. **Created `android-bridge.js`** — injected AFTER popup module and BEFORE processors. The bridge creates all shared globals on `window` (`overlayRegistry`, `processedImages`, `isOnXDomain`, `showUnblurPopup`, `logDetection`, `getVideoContainer`, scheduler sets, etc.) so they exist before `image-processor.js` and `video-processor.js` load.

3. **Reordered injection:** CSS → profanity JSON → shim → personDetection → detector → languageScoring → settings → youtube → popup → **bridge** → **image-processor** → **video-processor** → **content.js** (LAST, because it calls `processImage`/`processVideo` immediately).

4. **Removed all `if(!window.X){...}` re-injection guards** — they created block scopes that trapped function declarations. Scripts now inject bare, accepting that `onPageFinished` double-fire will cause harmless `already declared` errors on the second attempt.

5. **Android `content.js` references `window.*` globals** instead of creating new ones (e.g., `var overlayRegistry = window.overlayRegistry;` instead of `var overlayRegistry = new Map();`).

### Key Lesson: Chrome Extension vs WebView Scoping
- Chrome extension content scripts: all share one global lexical scope. `const x` in file A is visible in file B.
- WebView `evaluateJavascript()`: each call has its own scope for `const`/`let`. Only `var` and `function` declarations (at top level, NOT inside blocks) land on `window`.
- Wrapping code in `if(){...}` for re-injection guards turns `function` declarations into block-scoped — invisible to other scripts.

### Files Modified
- `android-bridge.js` — new file, creates shared globals on window
- `chrome-shim.js` — sendMessage callback fix, getURL shim, lastError
- `content.js` (Android copy) — const→var, window.* references
- `MainActivity.java` — new injection order, bridge injection, console logging, no block-scope guards


### Settings Persistence via SharedPreferences

**Problem:** Chrome-shim stored settings in-memory only. Every time the app was closed and reopened, blur strength, auto-unblur threshold, and all other settings reset to defaults.

**Solution: Three-layer persistence**

1. **`ScrollVeilStorage` Java class** — inner class in MainActivity with `@JavascriptInterface` annotations. Exposes `get(key)`, `set(key, value)`, and `getAll()` to JavaScript via `ScrollVeilNative` bridge object. Reads/writes Android SharedPreferences (`scrollveil_settings`).

2. **Chrome-shim updated** — on initialization, loads saved settings from `ScrollVeilNative.getAll()` instead of using hardcoded defaults. On `chrome.storage.sync.set()`, persists each key to SharedPreferences via `ScrollVeilNative.set(key, value)`.

3. **MainActivity UI sync** — `onCreate()` reads SharedPreferences and sets slider positions, label text, and toggle state to match saved values. `pushSettingToShim()` now saves to SharedPreferences in addition to pushing to the chrome-shim.

**Data flow:**
- User changes slider → `pushSettingToShim()` → saves to SharedPreferences + pushes to shim → shim fires `onChanged` → settings.js updates live
- App restarts → `onCreate()` reads SharedPreferences → sets slider UI → shim loads from `ScrollVeilNative.getAll()` → settings.js reads from shim → everything matches

### Files Modified
- `MainActivity.java` — added SharedPreferences import, JavascriptInterface, ScrollVeilStorage class, UI init from prefs, persist in pushSettingToShim
- `chrome-shim.js` — load from ScrollVeilNative on init, persist on set


## 2026-03-13 — Shared Core Established via Gradle Sync Task

### Problem
Chrome extension and Android app had separate copies of all JS files. Fixing a bug on one platform required manually copying files to the other, which is error-prone and causes drift.

### Solution: Gradle `syncSharedCore` Task
Added a build task to `app/build.gradle.kts` that automatically syncs files from the Chrome extension directory into Android assets at build time.

**Source of truth:** `C:\Users\Family\OneDrive\Desktop\Vibe Coding\ScrollVeil\`
**Android assets:** `C:\Dev\ScrollVeilAndroid\app\src\main\assets\`

**What it does:**
1. Copies 10 shared files as-is: `blur-shield.css`, `detector.js`, `image-processor.js`, `languageScoring.js`, `personDetection.js`, `profanity-list-en.json`, `settings.js`, `unblur-popup.js`, `video-processor.js`, `youtube.js`
2. Copies `content.js` with automatic `const`/`let` → `var` transform + `window.*` references for WebView scoping
3. Leaves Android-only files untouched: `chrome-shim.js`, `android-bridge.js`
4. Runs automatically before `mergeDebugAssets` and `mergeReleaseAssets`
5. Uses Gradle input/output tracking — only re-copies when source files change

**Workflow going forward:**
- Edit JS files in the Chrome extension directory only
- Build the Android APK — Gradle automatically syncs the latest code
- Android-only files (`chrome-shim.js`, `android-bridge.js`) are edited directly in the Android assets folder
- No manual copying ever needed

### Files Modified
- `C:\Dev\ScrollVeilAndroid\app\build.gradle.kts` — added syncSharedCore task


## 2026-03-13 — File Upload / Gallery Access in WebView

### Problem
WebView doesn't handle `<input type="file">` by default. When X showed the media picker for posting images/videos, nothing happened — the gallery never opened.

### Solution
Implemented `onShowFileChooser` in the WebChromeClient:
1. Added `ValueCallback<Uri[]> fileUploadCallback` field to track the pending file selection
2. Overrode `onShowFileChooser()` — creates an intent from the file chooser params and launches it via `startActivityForResult()`
3. Added `onActivityResult()` — receives the selected file URI and passes it back to the WebView via the callback
4. Handles edge cases: cancels previous callbacks if a new chooser opens, returns null on cancel

### Files Modified
- `MainActivity.java` — added ValueCallback import, fileUploadCallback field, FILE_CHOOSER_REQUEST_CODE constant, onShowFileChooser in WebChromeClient, onActivityResult handler


---

## 2026-03-15 — ScrollVeil Published on Chrome Web Store 🎉🎉🎉

### Milestone
ScrollVeil v1.0 has been **approved and published** on the Chrome Web Store. The extension is now publicly available for anyone to install.

### Details
- Extension ID: `dmlhjkjiomphagapfjpblbopboohoejl`
- Publisher: mikearold
- Status: **Published** (was "Pending Review" since 2026-03-07)
- Review duration: ~8 days

### What This Means
- Anyone can search for "ScrollVeil" on the Chrome Web Store and install it
- The extension auto-updates when new versions are published
- User reviews and ratings are now live

### Launch Checklist — COMPLETE
- ✅ Website live at scrollveil.com
- ✅ Email signup working → Mailchimp (via Cloudflare Worker)
- ✅ support@scrollveil.com → Gmail forwarding
- ✅ Cloudflare protecting the site
- ✅ Privacy policy published
- ✅ Legal page (ToS + Refund + Privacy)
- ✅ Screenshots and store listing
- ✅ **Published on Chrome Web Store**

### What's Next
- Monitor for user feedback and reviews
- Android app stabilization + Google Play Store submission
- content.js modular refactor is complete — shared core established via Gradle sync
- Parental settings lock (v1.0.0 priority — early adoption driver)
- User accounts + Stripe payment (v1.1.0)



---

## 2026-03-15 — Android ML Pipeline: TF.js Models Running In-WebView

### Problem
The Chrome extension runs 4 ML models (COCO-SSD, BlazeFace, BlazePose, MobileNet) in a sandboxed offscreen document. On Android, `personDetection.js` tried to call `chrome.runtime.sendMessage('detectPeople')`, but the chrome-shim returned `null` (no-op). This meant **zero ML intelligence** on Android — no person detection, no face detection, no pose estimation, no clothing classification. The app was scoring images using pixel analysis alone (~20% of the full pipeline).

### Root Cause
Chrome extension architecture: content script → background worker → offscreen document → sandbox iframe (TF.js runs here).
Android has none of that infrastructure. The shim's `sendMessage` just returned `null`.

### Solution
Created `android-ml.js` — a new Android-only file that loads TF.js + all 4 models **directly in the WebView** (no sandbox needed since WebView has no CSP restriction on eval).

### Architecture
**Phase 1 (immediate):** CSS + profanity list + chrome-shim injected. Then 5 TF.js CDN scripts are loaded via chained `<script>` tags.
**Phase 2 (after CDN loads):** JavaScript calls `ScrollVeilNative.onTFReady()` → Java `@JavascriptInterface` triggers `injectPhase2Scripts()` on UI thread → remaining modules injected via `evaluateJavascript()`.
**Timeout fallback:** If CDN takes >15 seconds, Phase 2 fires anyway (pipeline works without ML, same as before).

### CDN Libraries Loaded
1. `@tensorflow/tfjs@4.22.0`
2. `@tensorflow-models/coco-ssd@2.2.3`
3. `@tensorflow-models/blazeface@0.0.7`
4. `@tensorflow-models/pose-detection@2.1.3`
5. `@tensorflow-models/mobilenet@2.1.1`

### Files Created
- `android-ml.js` — ~250 lines. Defines `ScrollVeilPersonDetector.detectPeople()` with same interface as Chrome extension's `personDetection.js`. Runs all 4 models directly in WebView context. Shared promise pattern prevents duplicate model loads.

### Files Modified
- `MainActivity.java` — Two-phase injection architecture. Added `androidMlJs` field, `injectPhase2Scripts()` method, `onTFReady()` @JavascriptInterface callback. Removed `personDetectionJs` references.
- Removed `personDetection.js` from Android assets (replaced by `android-ml.js`)

### Key Design Decisions
1. **CDN over bundled** — Models load from jsdelivr CDN rather than bundling ~10MB of weights in the APK. User is already online (browsing social media). Browser caches the files after first load.
2. **Java callback over eval()** — Phase 2 scripts injected via `evaluateJavascript()` from Java (triggered by JS→Java bridge) rather than risky `eval()` string escaping.
3. **`android-ml.js` is Android-only** — Not part of the shared core. Chrome extension continues using its offscreen/sandbox architecture.
4. **`syncSharedCore` still copies `personDetection.js`** — It sits unused in Android assets. Could be excluded from the Gradle task later.

### Impact
Android app now has access to the **full detection pipeline** — same as Chrome extension:
- COCO-SSD person detection gate (no person = auto-safe)
- Bounding box masking (background pixel elimination)
- BlazeFace face detection (portrait/headshot caps)
- BlazePose skeleton (arm/hand exclusion, body zone measurement, pose analysis)
- MobileNet clothing classification (false positive reduction)

### Status
BUILD SUCCESSFUL — APK compiled. Testing pending.


### Update — Dual WebView Architecture: SUCCESS ✅

After multiple approaches failed due to X.com's strict CSP:
1. ❌ CDN `<script>` tags — blocked by CSP `script-src`
2. ❌ Direct `evaluateJavascript` of TF.js — CSP blocks internal `new Function()` calls
3. ❌ Blob URL iframe sandbox — blocked by CSP `frame-src`
4. ❌ HTTP response CSP header stripping — didn't intercept properly

The working solution: **Dual WebView architecture**
- Main WebView loads X.com normally (CSP intact — we don't fight it)
- Hidden sandbox WebView loads `file:///android_asset/android-sandbox.html` (no CSP)
- TF.js runs freely in the sandbox WebView
- Detection requests: main WebView JS → `@JavascriptInterface` (ScrollVeilNative.detectInSandbox) → Java → sandbox WebView `evaluateJavascript` → TF.js models → results back via `@JavascriptInterface` (SandboxBridge.onDetectResult) → Java → main WebView `evaluateJavascript` callback

This mirrors Chrome extension architecture: content script → background → offscreen → sandbox

### Files Created
- `android-sandbox.html` — standalone HTML page with TF.js libs + model loaders + detection handler, loaded in hidden WebView
- `android-ml.js` — rewritten to use Java bridge (`ScrollVeilNative.detectInSandbox`) instead of running models directly

### Files Modified
- `MainActivity.java` — Added `sandboxWebView` field, `SandboxBridge` inner class with `@JavascriptInterface` methods (`onDetectResult`, `onModelsReady`), `detectInSandbox` method on `ScrollVeilStorage`, sandbox WebView initialization with `file:///` URL

### Confirmed Working (from logcat)
- COCO-SSD: ✅ Person detection + "no people = auto-safe" gate
- BlazeFace: ✅ Face detection + portrait caps
- BlazePose: ✅ Skeleton keypoints (loaded in background)
- MobileNet: ✅ Clothing classification (loaded in background)
- Bounding box masking: ✅ Background pixel elimination
- Face exclusion: ✅ Face regions zeroed from skin detection

### Known Issue (pre-existing, not related)
- SPA navigation re-injection causes `SyntaxError: Identifier already declared` for `ScrollVeilDetector`, `LANGUAGE_WEIGHTS`, `videoViewportObserver`, `observer`. This is the existing `const` re-declaration bug — needs the `const→var` transform in the syncSharedCore task to cover these identifiers.
