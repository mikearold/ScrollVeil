// ScrollVeil Language Scoring Module
// Copyright © 2025 Michael Arold. All Rights Reserved.
//
// This software is proprietary and confidential. Unauthorized copying, modification,
// distribution, or use of this software, via any medium, is strictly prohibited.
//
// Scans text (titles, post text, video captions) for concerning language.
// Produces a separate Language Score alongside the existing Visual Score.
// Base word list: dsojevic/profanity-list (MIT License, 434 entries)
// Supplemental: ScrollVeil suggestive word list

console.log('🛡️ ScrollVeil: Language scoring module loaded');

// ═══════════════════════════════════════════════════════════════
// SECTION 1: SCORING WEIGHT TABLE
// Points per word occurrence, indexed by [tag][severity]
// Sexual content weighted highest. General swears score low
// to avoid inflating scores for casual profanity.
// ═══════════════════════════════════════════════════════════════

const LANGUAGE_WEIGHTS = {
  sexual:   { 1: 8,  2: 18, 3: 30, 4: 50 },
  racial:   { 1: 3,  2: 7,  3: 15, 4: 25 },
  shock:    { 1: 3,  2: 7,  3: 15, 4: 25 },
  lgbtq:    { 1: 3,  2: 7,  3: 15, 4: 25 },
  general:  { 1: 1,  2: 3,  3: 5,  4: 10 },
  religious:{ 1: 1,  2: 3,  3: 5,  4: 10 }
};

// ═══════════════════════════════════════════════════════════════
// SECTION 2: DIMINISHING RETURNS
// Repeated occurrences of the same word stack with less impact.
// ═══════════════════════════════════════════════════════════════

const DIMINISHING_MULTIPLIERS = [1.0, 0.75, 0.50]; // 1st, 2nd, 3rd
const DIMINISHING_FLOOR = 0.25; // 4th+ occurrences

// ═══════════════════════════════════════════════════════════════
// SECTION 3: TEXT LENGTH NORMALIZATION
// One bad word in a 500-word transcript is less concentrated
// than one in a 5-word title.
// ═══════════════════════════════════════════════════════════════

function getLengthMultiplier(wordCount) {
  if (wordCount < 20) return 1.0;   // Short text — no reduction
  if (wordCount < 100) return 0.8;  // Medium text
  return 0.6;                        // Long text (100+ words)
}

// ═══════════════════════════════════════════════════════════════
// SECTION 4: PATTERN CONVERSION HELPERS
// The base profanity list uses a wildcard format:
//   * = zero or more characters (like regex \w*)
// We convert these to proper RegExp objects at load time.
// Multi-word phrases (separated by |) become alternations.
// ═══════════════════════════════════════════════════════════════

/**
 * Convert a single wildcard pattern (e.g. "fu*c*k") into a regex source string.
 * The * in the profanity list means "zero or more word characters".
 * We escape all regex-special chars EXCEPT *, then replace * with \w*.
 */
function wildcardToRegexSource(pattern) {
  // Escape regex-special characters except *
  let src = pattern.replace(/([.+?^${}()|[\]\\])/g, '\\$1');
  // Replace * with \w* (zero or more word chars)
  src = src.replace(/\*/g, '\\w*');
  return src;
}

/**
 * Convert exception patterns (e.g. "*ade", "pea*") into a test function.
 * Returns a function(word) => true if the word matches ANY exception.
 * Exception format: *suffix, prefix*, or full word with * wildcard.
 */
function buildExceptionTester(exceptions) {
  if (!exceptions || exceptions.length === 0) return null;
  
  const regexParts = exceptions.map(exc => {
    let src = exc.replace(/([.+?^${}()|[\]\\])/g, '\\$1');
    src = src.replace(/\*/g, '\\w*');
    return src;
  });
  
  // Build one big alternation: ^(exception1|exception2|...)$
  const combined = new RegExp('^(' + regexParts.join('|') + ')$', 'i');
  return function(word) { return combined.test(word); };
}

/**
 * Build a compiled entry from a raw profanity-list JSON object.
 * The "match" field contains pipe-separated wildcard patterns.
 * We compile them into a single RegExp that matches any variant.
 */
function compileEntry(raw) {
  // Split match field on | to get individual patterns
  const patterns = raw.match.split('|').map(p => p.trim());
  
  // Build regex: word boundary + (pattern1|pattern2|...) + word boundary
  // For multi-word phrases (contain spaces), we can't use \b on both sides
  // because \b doesn't work at spaces. Instead we use lookahead/lookbehind
  // or match with surrounding context.
  const hasMultiWord = patterns.some(p => p.includes(' '));
  
  const regexParts = patterns.map(wildcardToRegexSource);
  const alternation = regexParts.join('|');
  
  let regex;
  if (hasMultiWord) {
    // For entries with multi-word phrases, use (?:^|\s) and (?:\s|$)
    // to match at word boundaries including spaces
    regex = new RegExp('(?:^|\\s|[^\\w])(' + alternation + ')(?:\\s|$|[^\\w])', 'gi');
  } else {
    // For single-word entries, use standard word boundaries
    regex = new RegExp('\\b(' + alternation + ')\\b', 'gi');
  }
  
  return {
    id: raw.id,
    regex: regex,
    tags: raw.tags,
    severity: raw.severity,
    isException: buildExceptionTester(raw.exceptions || null)
  };
}

// ═══════════════════════════════════════════════════════════════
// SECTION 5: WORD LISTS
// Base list loaded from profanity-list-en.json (434 entries)
// plus ScrollVeil supplemental suggestive words.
// Compiled into regex at module load time.
// ═══════════════════════════════════════════════════════════════

// We load the base profanity list from the bundled JSON file.
// In a Chrome extension content script, we use chrome.runtime.getURL
// and fetch. The list is compiled once on first use.

let _compiledBaseList = null;
let _compiledSupplemental = null;
let _compiledFullList = null;
let _listReady = false;
let _listReadyPromise = null;

// ScrollVeil supplemental suggestive word list
// Words that aren't profanity but indicate sexual/suggestive content.
// Format matches base list for uniform processing.
const SUPPLEMENTAL_RAW = [
  // Severity 1 (Mild) — suggestive in context
  { id: "ss-bikini",     match: "bikini",    tags: ["sexual"], severity: 1 },
  { id: "ss-lingerie",   match: "lingerie",  tags: ["sexual"], severity: 1 },
  { id: "ss-swimsuit",   match: "swimsuit",  tags: ["sexual"], severity: 1 },
  { id: "ss-thong",      match: "thong",     tags: ["sexual"], severity: 1 },
  { id: "ss-bra",        match: "bra",       tags: ["sexual"], severity: 1, exceptions: ["*ce","*ced","*ces","*cing","*d","*g","*ggadocio","*ggart","*in","*ins","*iny","*ke","*ked","*ken","*kes","*king","*nd","*nch","*nched","*nches","*nching","*ndish","*nds","*ndy","*ss","*ssard","*sserie","*ssica","*ssy","*t","*te","*ted","*ting","*ts","*tty","*ve","*ved","*vely","*veness","*ver","*veries","*vers","*very","*ves","*ving","*vo","*vos","*vura","*vuras","*wl","*wler","*wls","*wn","*wns","*wy","*y","*yed","*yer","*yers","*ying","*ys","*ze","*zed","*zen","*zenness","*zer","*zers","*zes","*zier","*ziest","*zily","*zing","*zy","al*","am*","cali*te","cande*","cere*","cole*","del*","el*te","ge*","in*","li*ry","lum*","mem*ne","om*","re*nd","salu*","um*","um*ge","verte*","ze*"] },
  { id: "ss-asmr",       match: "asmr",      tags: ["sexual"], severity: 1 },
  { id: "ss-tryon",      match: "try-on|try on|tryon", tags: ["sexual"], severity: 1 },
  { id: "ss-haul",       match: "haul",      tags: ["sexual"], severity: 1 },
  { id: "ss-tease",      match: "tease",     tags: ["sexual"], severity: 1 },
  { id: "ss-thicc",      match: "thicc",     tags: ["sexual"], severity: 1 },
  { id: "ss-baddie",     match: "baddie",    tags: ["sexual"], severity: 1 },
  { id: "ss-booty",      match: "booty",     tags: ["sexual"], severity: 1 },
  { id: "ss-curves",     match: "curves|curvy", tags: ["sexual"], severity: 1 },
  { id: "ss-clean-version", match: "clean version", tags: ["general"], severity: 1 },
  { id: "ss-family-friendly", match: "family friendly", tags: ["general"], severity: 1 },

  // Severity 2 (Medium) — clearly suggestive
  { id: "ss-braless",    match: "braless",   tags: ["sexual"], severity: 2 },
  { id: "ss-cleavage",   match: "cleavage",  tags: ["sexual"], severity: 2 },
  { id: "ss-twerk",      match: "twerk|twerking", tags: ["sexual"], severity: 2 },
  { id: "ss-strip",      match: "strip",     tags: ["sexual"], severity: 2, exceptions: ["*e","*ed","*es","*ing","*ling","*lings","*per","*pers","*ped","air*","comic*","film*","gun*","land*","news*","out*","pin*","power*","racing*","rumble*","weather*"] },
  { id: "ss-fansly",     match: "fansly",    tags: ["sexual"], severity: 2 },
  { id: "ss-thirst-trap", match: "thirst trap|thirsttrap", tags: ["sexual"], severity: 2 },
  { id: "ss-body-count", match: "body count", tags: ["sexual"], severity: 2 },
  { id: "ss-no-bra",     match: "no bra",    tags: ["sexual"], severity: 2 },
  { id: "ss-see-through", match: "see through|see-through|seethrough", tags: ["sexual"], severity: 2 },
  { id: "ss-leaked",     match: "leaked",    tags: ["sexual"], severity: 2 },
  { id: "ss-uncut",      match: "uncut",     tags: ["sexual"], severity: 2 },
  { id: "ss-sugar-daddy", match: "sugar daddy|sugardaddy", tags: ["sexual"], severity: 2 },
  { id: "ss-sugar-baby", match: "sugar baby|sugarbaby", tags: ["sexual"], severity: 2 },
  { id: "ss-hook-up",    match: "hook up|hookup|hooking up", tags: ["sexual"], severity: 2 },
  { id: "ss-fwb",        match: "friends with benefits|fwb", tags: ["sexual"], severity: 2 },
  { id: "ss-netflix-chill", match: "netflix and chill", tags: ["sexual"], severity: 2 },
  { id: "ss-sfw",        match: "sfw|safe for work", tags: ["sexual"], severity: 2 },
  { id: "ss-not-nsfw",   match: "not nsfw",  tags: ["sexual"], severity: 2 },
  { id: "ss-censored",   match: "censored",  tags: ["sexual"], severity: 2 },

  // Severity 3 (Strong) — explicitly sexual
  { id: "ss-striptease", match: "striptease|strip tease", tags: ["sexual"], severity: 3 },
  { id: "ss-lap-dance",  match: "lap dance|lapdance", tags: ["sexual"], severity: 3 },
  { id: "ss-wap",        match: "wap",       tags: ["sexual"], severity: 3 },
  { id: "ss-milf",       match: "milf",      tags: ["sexual"], severity: 3 },
  { id: "ss-18plus",     match: "18\\+|eighteen plus", tags: ["sexual"], severity: 3 },
  { id: "ss-uncensored", match: "uncensored", tags: ["sexual"], severity: 3 },
  { id: "ss-nsfw",       match: "nsfw",      tags: ["sexual"], severity: 3 }
];

/**
 * Initialize the word lists. Loads the base profanity JSON from the
 * extension bundle and compiles all patterns into RegExp objects.
 * Returns a promise that resolves when lists are ready.
 */
function initWordLists() {
  if (_listReadyPromise) return _listReadyPromise;
  
  _listReadyPromise = new Promise(async (resolve) => {
    try {
      // Load the base profanity list JSON from extension assets
      const url = chrome.runtime.getURL('profanity-list-en.json');
      const response = await fetch(url);
      const baseRaw = await response.json();
      
      console.log(`🛡️ ScrollVeil: Loaded ${baseRaw.length} base profanity entries`);
      
      // Compile base list
      _compiledBaseList = baseRaw.map(compileEntry);
      
      // Compile supplemental list
      _compiledSupplemental = SUPPLEMENTAL_RAW.map(compileEntry);
      
      // Merge into one list (supplemental entries have "ss-" prefix IDs
      // so they won't conflict with base list IDs)
      _compiledFullList = [..._compiledBaseList, ..._compiledSupplemental];
      
      _listReady = true;
      console.log(`🛡️ ScrollVeil: Language lists compiled — ${_compiledFullList.length} total entries`);
      resolve(true);
    } catch (err) {
      console.error('🛡️ ScrollVeil: Failed to load profanity list:', err);
      // Still mark as ready with empty list so scoring doesn't hang
      _compiledFullList = SUPPLEMENTAL_RAW.map(compileEntry);
      _listReady = true;
      resolve(false);
    }
  });
  
  return _listReadyPromise;
}

// Start loading immediately when the script is injected
initWordLists();

// ═══════════════════════════════════════════════════════════════
// SECTION 6: scoreText(text) — MAIN SCORING FUNCTION
// Takes a string of text, scans it against all word lists,
// applies weights, diminishing returns, and length normalization.
// Returns a result object with score, matches, and tag summary.
// ═══════════════════════════════════════════════════════════════

/**
 * Score a block of text for concerning language.
 *
 * @param {string} text — The text to scan (title, post, captions, etc.)
 * @returns {object} — {
 *   score: 0-100 (final language score),
 *   isNA: boolean (true if no text was provided at all),
 *   matches: [{id, word, tag, severity, count}],
 *   tagSummary: {sexual: N, general: N, ...},
 *   wordCount: number,
 *   rawScore: number (before normalization/capping)
 * }
 */
async function scoreText(text) {
  // Ensure word lists are loaded
  await initWordLists();
  
  // Handle no-text case
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return {
      score: 0,
      isNA: true,
      matches: [],
      tagSummary: {},
      wordCount: 0,
      rawScore: 0
    };
  }
  
  const normalizedText = text.toLowerCase().trim();
  const wordCount = normalizedText.split(/\s+/).filter(w => w.length > 0).length;
  
  // Track matches: id → { id, word, tag, severity, count, points }
  const matchMap = new Map();
  // Track tag totals: tag → count of matched words
  const tagSummary = {};
  let rawScore = 0;
  
  for (const entry of _compiledFullList) {
    // Reset regex lastIndex (since we reuse the same regex object with /g flag)
    entry.regex.lastIndex = 0;
    
    let match;
    let occurrenceCount = 0;
    
    while ((match = entry.regex.exec(normalizedText)) !== null) {
      // The captured group is the actual matched word/phrase
      const matchedWord = (match[1] || match[0]).trim();
      
      // Check exceptions — if the matched word is an exception, skip it
      if (entry.isException && entry.isException(matchedWord)) {
        continue;
      }
      
      occurrenceCount++;
      
      // Get the primary tag for scoring (first tag in the array)
      const primaryTag = entry.tags[0];
      
      // Look up weight from our table
      const tagWeights = LANGUAGE_WEIGHTS[primaryTag] || LANGUAGE_WEIGHTS.general;
      const baseWeight = tagWeights[entry.severity] || 1;
      
      // Apply diminishing returns for this occurrence
      let multiplier;
      if (occurrenceCount <= DIMINISHING_MULTIPLIERS.length) {
        multiplier = DIMINISHING_MULTIPLIERS[occurrenceCount - 1];
      } else {
        multiplier = DIMINISHING_FLOOR;
      }
      
      const points = baseWeight * multiplier;
      rawScore += points;
      
      // Update match tracking
      const key = entry.id;
      if (matchMap.has(key)) {
        const existing = matchMap.get(key);
        existing.count = occurrenceCount;
        existing.points += points;
      } else {
        matchMap.set(key, {
          id: entry.id,
          word: matchedWord,
          tags: entry.tags,
          severity: entry.severity,
          count: 1,
          points: points
        });
      }
      
      // Update tag summary
      for (const tag of entry.tags) {
        tagSummary[tag] = (tagSummary[tag] || 0) + 1;
      }
    }
  }
  
  // Apply text length normalization
  const lengthFactor = getLengthMultiplier(wordCount);
  const normalizedScore = rawScore * lengthFactor;
  
  // Apply minimum 1% rule: if text exists but nothing flagged, score is 1%
  // If text exists AND things were flagged, cap between 1-100
  let finalScore;
  if (matchMap.size === 0) {
    // Text exists but no matches — minimum 1%
    finalScore = 1;
  } else {
    finalScore = Math.max(1, Math.min(100, Math.round(normalizedScore)));
  }
  
  // Convert match map to sorted array (highest points first)
  const matches = Array.from(matchMap.values())
    .sort((a, b) => b.points - a.points);
  
  return {
    score: finalScore,
    isNA: false,
    matches: matches,
    tagSummary: tagSummary,
    wordCount: wordCount,
    rawScore: Math.round(rawScore * 10) / 10
  };
}

// ═══════════════════════════════════════════════════════════════
// SECTION 7: extractTitleText(element)
// Grabs title/post text from the DOM around a given element.
// Platform-specific selectors for YouTube, X/Twitter, Google
// Images, and a generic fallback.
// ═══════════════════════════════════════════════════════════════

/**
 * Extract title and surrounding text for an image or video element.
 * Checks platform-specific DOM structures first, then falls back
 * to generic selectors (alt text, nearby headings, figure captions).
 *
 * @param {HTMLElement} element — The image or video element
 * @returns {string|null} — Combined text, or null if nothing found
 */
function extractTitleText(element) {
  if (!element) return null;
  
  const parts = [];
  const hostname = window.location.hostname;
  
  // ─── YouTube ─────────────────────────────────────────────
  if (hostname.includes('youtube.com')) {
    // Video title: look in parent renderer for #video-title
    const renderer = element.closest(
      'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ' +
      'ytd-grid-video-renderer, ytd-reel-item-renderer, ytm-shorts-lockup-view-model-v2'
    );
    if (renderer) {
      const titleEl = renderer.querySelector('#video-title, .title, [class*="title"]');
      if (titleEl && titleEl.textContent.trim()) {
        parts.push(titleEl.textContent.trim());
      }
      // Channel name
      const channelEl = renderer.querySelector('#channel-name a, .ytd-channel-name a, [class*="channel"]');
      if (channelEl && channelEl.textContent.trim()) {
        parts.push(channelEl.textContent.trim());
      }
      // Description snippet (if visible)
      const descEl = renderer.querySelector('#description-text, .metadata-snippet-text');
      if (descEl && descEl.textContent.trim()) {
        parts.push(descEl.textContent.trim());
      }
    }
    
    // Also check if we're on a watch page — get the main title
    if (window.location.pathname === '/watch') {
      const watchTitle = document.querySelector(
        'h1.ytd-watch-metadata yt-formatted-string, ' +
        'h1.ytd-video-primary-info-renderer yt-formatted-string, ' +
        '#title h1 yt-formatted-string'
      );
      if (watchTitle && watchTitle.textContent.trim()) {
        parts.push(watchTitle.textContent.trim());
      }
    }
  }
  
  // ─── X / Twitter ─────────────────────────────────────────
  else if (hostname.includes('x.com') || hostname.includes('twitter.com')) {
    // Find the parent tweet article
    const article = element.closest('article[data-testid="tweet"]');
    if (article) {
      // Tweet text
      const tweetText = article.querySelector('[data-testid="tweetText"]');
      if (tweetText && tweetText.textContent.trim()) {
        parts.push(tweetText.textContent.trim());
      }
      // Quoted tweet text (if retweeting)
      const quotedText = article.querySelector('[data-testid="quotedTweetText"]');
      if (quotedText && quotedText.textContent.trim()) {
        parts.push(quotedText.textContent.trim());
      }
    }
  }
  
  // ─── Google Images ───────────────────────────────────────
  else if (hostname.includes('google.com') && window.location.pathname.includes('/search')) {
    // Alt text on the image itself
    if (element.alt && element.alt.trim()) {
      parts.push(element.alt.trim());
    }
    // Title attribute
    if (element.title && element.title.trim()) {
      parts.push(element.title.trim());
    }
    // Nearby caption text in Google Images results
    const container = element.closest('[data-lpage], [data-id], .isv-r');
    if (container) {
      const captionEl = container.querySelector('.WGvvNb, .bytUYc, .mVDMnf');
      if (captionEl && captionEl.textContent.trim()) {
        parts.push(captionEl.textContent.trim());
      }
    }
  }
  
  // ─── Generic fallback (any site) ────────────────────────
  // Always check these regardless of platform
  
  // Alt text
  if (element.alt && element.alt.trim() && !parts.includes(element.alt.trim())) {
    parts.push(element.alt.trim());
  }
  
  // Title attribute
  if (element.title && element.title.trim() && !parts.includes(element.title.trim())) {
    parts.push(element.title.trim());
  }
  
  // aria-label
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) {
    parts.push(ariaLabel.trim());
  }
  
  // Parent <figure> caption
  const figure = element.closest('figure');
  if (figure) {
    const figcaption = figure.querySelector('figcaption');
    if (figcaption && figcaption.textContent.trim()) {
      parts.push(figcaption.textContent.trim());
    }
  }
  
  // Nearby heading (within 2 levels up)
  let parent = element.parentElement;
  for (let i = 0; i < 3 && parent; i++) {
    const heading = parent.querySelector('h1, h2, h3, h4, h5, h6');
    if (heading && heading.textContent.trim()) {
      const headingText = heading.textContent.trim();
      if (!parts.includes(headingText)) {
        parts.push(headingText);
      }
      break;
    }
    parent = parent.parentElement;
  }
  
  // Combine all found text
  const combined = parts.join(' ').trim();
  return combined.length > 0 ? combined : null;
}

// ═══════════════════════════════════════════════════════════════
// SECTION 8: extractCaptionText(video)
// Reads video caption/subtitle tracks via the HTML5 textTracks
// API. Reads all cues without requiring video playback.
// ═══════════════════════════════════════════════════════════════

/**
 * Extract caption/subtitle text from a video element.
 * Uses the HTML5 textTracks API to read WebVTT cue data.
 * Does NOT require the video to be playing.
 *
 * @param {HTMLVideoElement} video — The video element
 * @returns {string|null} — All caption text concatenated, or null if unavailable
 */
function extractCaptionText(video) {
  if (!video || !video.textTracks) return null;
  
  const tracks = video.textTracks;
  if (tracks.length === 0) return null;
  
  // Prefer tracks in this order: captions > subtitles > descriptions
  const preferred = ['captions', 'subtitles', 'descriptions'];
  let bestTrack = null;
  
  for (const kind of preferred) {
    for (let i = 0; i < tracks.length; i++) {
      if (tracks[i].kind === kind && tracks[i].cues && tracks[i].cues.length > 0) {
        bestTrack = tracks[i];
        break;
      }
    }
    if (bestTrack) break;
  }
  
  // If no preferred kind found, try any track with cues
  if (!bestTrack) {
    for (let i = 0; i < tracks.length; i++) {
      if (tracks[i].cues && tracks[i].cues.length > 0) {
        bestTrack = tracks[i];
        break;
      }
    }
  }
  
  if (!bestTrack || !bestTrack.cues || bestTrack.cues.length === 0) {
    // Some tracks need to be set to "showing" or "hidden" to load cues
    // Try activating the first track and checking again
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      const originalMode = track.mode;
      if (track.mode === 'disabled') {
        track.mode = 'hidden'; // Activate without showing on screen
      }
      if (track.cues && track.cues.length > 0) {
        bestTrack = track;
        break;
      }
      // Restore original mode if no cues found
      track.mode = originalMode;
    }
  }
  
  if (!bestTrack || !bestTrack.cues || bestTrack.cues.length === 0) {
    return null;
  }
  
  // Read all cue text
  const cueTexts = [];
  for (let i = 0; i < bestTrack.cues.length; i++) {
    const cue = bestTrack.cues[i];
    if (cue.text && cue.text.trim()) {
      // Strip HTML tags that may be in WebVTT cues
      const cleanText = cue.text.replace(/<[^>]+>/g, '').trim();
      if (cleanText) {
        cueTexts.push(cleanText);
      }
    }
  }
  
  if (cueTexts.length === 0) return null;
  
  // Join with spaces, remove duplicate consecutive lines
  // (captions often repeat for timing overlap)
  const deduped = [];
  let lastLine = '';
  for (const line of cueTexts) {
    if (line !== lastLine) {
      deduped.push(line);
      lastLine = line;
    }
  }
  
  const combined = deduped.join(' ').trim();
  console.log(`🛡️ ScrollVeil: Extracted ${deduped.length} caption cues (${combined.split(/\s+/).length} words)`);
  return combined.length > 0 ? combined : null;
}

// ═══════════════════════════════════════════════════════════════
// SECTION 9: TAG REPORTING & DETAILS POPUP HELPERS
// Functions that format scoring results into human-readable
// text for the details popup.
// ═══════════════════════════════════════════════════════════════

// Human-readable tag names for display
const TAG_DISPLAY_NAMES = {
  sexual: 'Sexual language',
  lgbtq: 'LGBTQ-related language',
  racial: 'Racial language',
  general: 'General profanity',
  shock: 'Shock content',
  religious: 'Religious language'
};

/**
 * Generate a human-readable language score summary for the details popup.
 *
 * @param {object} scoreResult — The result from scoreText()
 * @param {object} sources — { title: boolean, postText: boolean, captions: boolean }
 *                           Which text sources were available and analyzed
 * @returns {string} — Formatted text for display in popup
 */
function formatLanguageDetails(scoreResult, sources) {
  if (scoreResult.isNA) {
    return 'Language Score: N/A 0%\nNo text or captions available for analysis.';
  }
  
  const lines = [];
  lines.push('Language Score: ' + scoreResult.score + '%');
  lines.push('');
  
  // Tag breakdown
  if (scoreResult.matches.length > 0) {
    lines.push('Language Tags Detected:');
    for (const [tag, count] of Object.entries(scoreResult.tagSummary)) {
      const displayName = TAG_DISPLAY_NAMES[tag] || tag;
      lines.push('• ' + displayName + ' (' + count + (count === 1 ? ' match' : ' matches') + ')');
    }
    lines.push('');
  } else {
    lines.push('No concerning language detected.');
    lines.push('');
  }
  
  // Text sources analyzed
  lines.push('Text Sources:');
  if (sources) {
    lines.push('• Title: ' + (sources.title ? 'analyzed ✓' : 'not found'));
    lines.push('• Post text: ' + (sources.postText ? 'analyzed ✓' : 'not found'));
    lines.push('• Captions: ' + (sources.captions ? 'analyzed ✓' : 'not available'));
  }
  
  lines.push('');
  lines.push('Words scanned: ' + scoreResult.wordCount);
  
  return lines.join('\n');
}

/**
 * Get the display color for a language score (matches visual score colors).
 * @param {number} score — 0-100
 * @returns {string} — Hex color
 */
function getLanguageScoreColor(score) {
  if (score < 20) return '#4CAF50';  // Green
  if (score < 40) return '#FFC107';  // Yellow
  if (score < 60) return '#FF9800';  // Orange
  if (score < 80) return '#F44336';  // Red
  return '#212121';                   // Dark (very high)
}

/**
 * Convenience: score an element's surrounding text in one call.
 * Extracts title/post text, scores it, and returns the result
 * along with source info for the details popup.
 *
 * @param {HTMLElement} element — Image or video element
 * @returns {object} — { scoreResult, sources, text }
 */
async function scoreElementText(element) {
  const titleText = extractTitleText(element);
  let captionText = null;
  
  // If it's a video, also try to get captions
  if (element.tagName === 'VIDEO') {
    captionText = extractCaptionText(element);
  }
  
  // Combine all text sources
  const allText = [titleText, captionText].filter(Boolean).join(' ');
  
  const sources = {
    title: !!titleText,
    postText: false, // Will be set by caller if post text was found separately
    captions: !!captionText
  };
  
  // For X/Twitter, post text IS the title text (comes from tweetText)
  const hostname = window.location.hostname;
  if (hostname.includes('x.com') || hostname.includes('twitter.com')) {
    sources.postText = !!titleText;
    sources.title = false; // X doesn't have separate titles
  }
  
  const scoreResult = await scoreText(allText);
  
  return {
    scoreResult: scoreResult,
    sources: sources,
    text: allText || null
  };
}

console.log('🛡️ ScrollVeil: Language scoring module ready');
