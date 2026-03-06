# ScrollVeil — Caption/Text Reading & Language Scoring Feature Spec

## Date: 2026-02-22
## Status: PLANNING COMPLETE — Ready for Implementation

---

## Overview

Add language-based content scoring to complement the existing visual (frame sampling) analysis. ScrollVeil will read available text associated with videos and images — titles, social media post text, and video captions/subtitles — scan for concerning words/phrases, and produce a separate **Language Score** alongside the existing **Visual Score**.

### Core Principle
ScrollVeil informs users, never makes decisions for them. Language scoring provides additional context — the user always decides what to do with that information.

---

## Text Sources (in order of priority)

### Source A: Title & Post Text (instant, all platforms)
- Video/image titles visible on the page
- Social media post text (tweets on X, captions on Instagram, etc.)
- Read directly from the DOM — no special APIs needed
- Available immediately on page load

### Source B: Video Caption/Subtitle Tracks (instant when available)
- HTML5 `<track>` elements with WebVTT caption data
- JavaScript `video.textTracks` API — read all cues at once without playback
- YouTube auto-captions and manual subtitles
- Not all videos have captions — gracefully skip if unavailable

### Source C: On-Screen Rendered Captions (DEFERRED — future phase)
- Some platforms render captions as DOM overlay elements
- Requires video playback to capture — conflicts with analyze-without-playing approach
- Skip for initial launch

---

## Word List Structure

### Base List: dsojevic/profanity-list (MIT License)
- **434 entries** with severity ratings, tags, and exception handling
- Pre-built severity levels: 1 (Mild), 2 (Medium), 3 (Strong), 4 (Severe)
- 6 tags: sexual, lgbtq, racial, general, shock, religious
- 40 entries have built-in exceptions to prevent false positives (Scunthorpe problem)
- File: `profanity-list-en.json` (already downloaded to ScrollVeil folder)

### Tag Distribution (base list):
- sexual: 262 words
- lgbtq: 74 words
- racial: 48 words
- general: 34 words
- shock: 9 words
- religious: 7 words

### Supplemental List: ScrollVeil-specific suggestive words
Words that aren't profanity but are strong indicators of sexual/suggestive content.
All tagged as "sexual" unless noted otherwise.

#### Severity 1 (Mild) — suggestive in context:
- bikini, lingerie, swimsuit, thong, bra, panties
- ASMR, try-on, haul, tease, thicc, baddie, booty, curves
- clean version (tag: general), family friendly (tag: general)

#### Severity 2 (Medium) — clearly suggestive:
- topless, braless, cleavage, twerk, strip
- OnlyFans, Fansly, thirst trap, body count
- no bra, see through, leaked, uncut
- sugar daddy, sugar baby, hook up, friends with benefits, Netflix and chill
- SFW, safe for work, not NSFW, censored

#### Severity 3 (Strong) — explicitly sexual:
- striptease, lap dance, WAP, MILF
- 18+, uncensored, NSFW

### Tag Treatment
- All 6 tags are used and reported neutrally
- "lgbtq" flags the topic/language, not a moral position — ScrollVeil doesn't judge for or against
- Tags are shown in the details popup so users understand WHAT was flagged

---

## Scoring Formula

### Word Weights (points per occurrence)

|  Severity  | Sexual | Racial / Shock / LGBTQ | General / Religious |
|------------|--------|------------------------|---------------------|
| 1 (Mild)   |   8    |          3             |         1           |
| 2 (Medium)  |  18    |          7             |         3           |
| 3 (Strong)  |  30    |         15             |         5           |
| 4 (Severe)  |  50    |         25             |        10           |

Sexual content is weighted highest. General swear words score low to avoid inflating scores for casual profanity.

### Diminishing Returns (per word)
Repeated occurrences of the same word stack but with decreasing impact:
- 1st occurrence: 100% of weight
- 2nd occurrence: 75% of weight
- 3rd occurrence: 50% of weight
- 4th+ occurrences: 25% of weight each

### Text Length Normalization
One bad word in a 500-word transcript is less concentrated than one in a 5-word title:
- Short text (under 20 words): no reduction (1.0x)
- Medium text (20-100 words): 0.8x multiplier
- Long text (100+ words): 0.6x multiplier

### Minimum Score Rule
- If ANY text is found (even completely clean): language score = minimum 1%
- If NO text or captions are available: language score = "N/A 0%"
- Even a single safe word means at least 1% — the system acknowledges text exists

### Final Calculation
```
raw_score = sum of (word_weight × diminishing_multiplier) for all matched words
normalized_score = raw_score × length_factor
final_language_score = max(1, min(100, normalized_score))
```
(If no text found at all: N/A 0%)

---

## Scoring Examples

| Content | Matches | Calculation | Score |
|---------|---------|-------------|-------|
| "Cute puppies playing" | None, but text exists | Minimum rule | 1% |
| "Damn this is hard" | "damn" general sev1 = 1pt | Below minimum | 1% |
| "What the fuck" | "fuck" general sev3 = 5pts | 5 pts | ~5% |
| "Hot sexy bikini haul" | "sexy" sex sev2=18 + "bikini" sex sev1=8 + "haul" sex sev1=8 | 34 pts | ~34% |
| "Sexy bikini try-on haul" | "sexy"=18 + "bikini"=8 + "try-on"=8 + "haul"=8 | 42 pts | ~42% |
| "SFW anime bikini" | "SFW" sex sev2=18 + "bikini" sex sev1=8 | 26 pts | ~26% |
| "Sexy nude girls gone wild" | "sexy"=18 + "nude"=30 + "girls gone wild"=30 | 78 pts | ~78% |
| "Porn" in title | "porn" sex sev4 = 50pts | 50 pts | ~50% |
| Single racial slur | racial sev3 = 15pts | 15 pts | ~15% |
| No captions/text found | N/A | No text available | N/A 0% |

---

## Badge Integration

### Badge Display
- Badge shows: `Math.max(visualScore, languageScore)` as the single number
- Color dot driven by that same max score
- No emoji, no indicators, no extra text — same clean format as current badges
- Badge format unchanged from current implementation

### Details Popup (on click)
Shows full breakdown:
```
Visual Score: 18%
Language Score: 45%

Language Tags Detected:
• Sexual language (3 matches)
• General profanity (1 match)

Text Sources:
• Title: analyzed ✓
• Post text: analyzed ✓
• Captions: not available

Words scanned: 12
```

### Auto-Unblur Logic
- Auto-unblur ONLY when BOTH visual AND language scores are below user-set thresholds
- User settings control the thresholds (sliders in popup/settings)
- All other decisions are left to the user

---

## Integration with Existing Systems

### Analysis Flow (videos)
1. Video enters viewport → blur immediately (existing behavior)
2. **Instantly** grab title/post text from DOM → score it → set initial language score
3. **Instantly** check `video.textTracks` for captions → if found, read all cues → update language score
4. **Meanwhile** frame sampling runs in parallel (existing behavior) → updates visual score
5. Badge shows `Math.max(visual, language)` throughout, updating live
6. Both scores cached in session cache alongside visual results

### Analysis Flow (images)
1. Image detected → blur immediately (existing behavior)
2. **Instantly** grab surrounding title/post text from DOM → score it → set language score
3. Visual analysis runs through existing pipeline → updates visual score
4. Badge shows `Math.max(visual, language)`

### Captions as Early Indicator
- Language score appears almost instantly (~0.2s) from title/post text
- Caption data (if available) adds to language score immediately
- Visual frame sampling builds over 30+ seconds
- User sees language risk FIRST while visual analysis catches up

---

## Files to Create/Modify

### New File: `languageScoring.js`
- Word list data (base + supplemental)
- `scoreText(text)` — main scoring function
- `extractTitleText(element)` — grab title/post text from DOM
- `extractCaptionText(video)` — read caption tracks
- Tag detection and reporting

### Modified: `content.js`
- Integrate language scoring into video analysis flow
- Integrate language scoring into image analysis flow
- Update badge display to use max(visual, language)
- Update details popup to show language breakdown
- Add language score to session cache

### Modified: `popup.html` / `popup.js` (future)
- Add language threshold slider for auto-unblur
- Add toggle for caption scanning

---

## What's NOT in This Spec (Future Phases)

- On-screen rendered caption reading (requires playback)
- Audio transcription (Web Speech API or cloud — expensive)
- AI image model name detection (stable diffusion, midjourney, etc.)
- Violence/drug supplemental word lists
- User-customizable word lists
- Video timeline showing where flagged language occurs
