# ScrollVeil - TECHNICAL ROADMAP
*Created: February 14, 2026*
*Vision: Universal Content Intelligence Platform*

## 🎯 MISSION STATEMENT

ScrollVeil creates a safer, more accessible internet through:
- Ethical AI-powered content analysis
- User-controlled filtering and accountability
- Privacy-respecting transparency
- Community support systems

**Core Principles:**
1. User autonomy always (never auto-unblur)
2. Ethical training data only (no exploitation)
3. Transparency in decision-making
4. Privacy by design
5. One size does NOT fit all

---

## 📅 PHASE 1: FOUNDATION (Months 1-2) - IN PROGRESS

### Goals:
- Stable content blurring across platforms
- Basic geometric detection working
- User can always reveal content
- Initial scoring system

### Completed Features:
✅ Media blurring (images, videos)
✅ User-controlled reveal
✅ Blur strength settings
✅ Platform-specific handling (X, YouTube, Google Images)
✅ Container-level blur for React sites
✅ Scoring system foundation

### Current Issues (Being Fixed):
- Fast scroll exposure on X
- Score overlay sizing
- Re-blur button positioning

### Technical Stack:
- Vanilla JavaScript
- Chrome Extension APIs
- Geometric analysis (pure math, no ML)
- Synthetic test suite (120+ cases)

---

## 📅 PHASE 2: INTELLIGENCE (Months 3-4)

### Goal: True Content Understanding

### 2.1 Person Detection (Week 1-2)
**Why:** Eliminates 80-90% false positives

**Implementation:**
```javascript
// Use COCO-SSD or PoseNet
Model: TensorFlow.js COCO-SSD (5MB)
Speed: ~150ms per image
Output: Bounding boxes for people detected

Integration Points:
- Only analyze skin within person boxes
- Ignore skin-tones outside person regions
- Differentiates humans from statues/buildings
```

**Expected Results:**
- Terracotta building false positives: ELIMINATED
- Statue false positives: ELIMINATED
- Sand/beach false positives: ELIMINATED
- True positive rate: MAINTAINED

**Files to Create:**
- `personDetection.js` - Person detection module
- `boundingBox.js` - Bounding box utilities
- Update `detector.js` - Integrate with existing analysis

---

### 2.2 Object Detection (Week 3-4)
**Why:** Provides environmental context

**Implementation:**
```javascript
Model: COCO-SSD (same model, 80 object categories)
Categories: beach umbrella, gym equipment, medical items, etc.

Context Mapping:
- Beach: umbrella, surfboard, volleyball, sand → LOW RISK
- Gym: weights, equipment, mats → LOW RISK
- Medical: stethoscope, hospital bed → EDUCATIONAL
- Bedroom: bed, minimal objects → CONTEXT DEPENDENT
```

**Expected Results:**
- Beach scene accuracy: 95%+
- Athletic context recognition: 90%+
- Medical content identification: 85%+
- Context-based risk adjustment working

---

### 2.3 Clothing Detection (Week 5-6)
**Why:** Differentiates swimwear from underwear, context-appropriate attire

**Implementation:**
```javascript
Model: DeepFashion or Fashion-MNIST derivative
Categories:
- Swimwear (bikini, trunks)
- Athletic wear (sports bra, leggings)
- Casual clothing (jeans, t-shirt)
- Formal wear
- Underwear/lingerie
- No clothing detected

Context Rules:
Swimwear + beach = LOW RISK
Swimwear + bedroom = MODERATE RISK
Underwear + any context = HIGH RISK (unless fashion show)
Athletic wear + gym = LOW RISK
```

**Expected Results:**
- Clothing classification: 80%+ accuracy
- Context-aware risk adjustment
- Fewer false positives on beach/athletic content

---

### 2.4 Enhanced Scoring System (Week 7-8)
**Why:** Multi-signal intelligence, not just geometry

**The New Assessment:**
```javascript
Risk Calculation:
1. Geometric analysis (your current system) - 30% weight
2. Person detection (present/absent, count) - 20% weight
3. Clothing analysis (appropriate for context) - 25% weight
4. Object/context detection (environmental) - 20% weight
5. Composition analysis (framing, centering) - 5% weight

Final Score: Weighted combination
Confidence: Based on agreement between signals
```

**UI Enhancement:**
```
🟢 12% Risk
Content Type: Real Photo
Subjects: 2 people
Context: Beach/recreational

Risk Factors:
! Moderate skin region (40%)

Safe Indicators:
✓ Beach equipment detected
✓ Swimwear appropriate for context
✓ Multiple people (social setting)
✓ Active poses (recreational)
```

---

## 📅 PHASE 3: VIDEO INTELLIGENCE (Months 5-6)

### Goal: Comprehensive Video Analysis

### 3.1 Frame Sampling System
**Implementation:**
```javascript
Sampling Strategy:
- Short video (<60s): Sample every 1 second
- Medium video (60-600s): Sample every 2 seconds
- Long video (600s+): Sample every 5 seconds

Per-Frame Analysis:
- Person detection
- Clothing detection
- Object detection
- Geometric analysis
- Risk scoring

Output:
- Timeline of risk scores
- Scene change detection
- Overall video assessment
```

### 3.2 Audio Transcription
**Implementation:**
```javascript
Technology Options:
1. Web Speech API (free, browser-based, moderate accuracy)
2. OpenAI Whisper (best accuracy, $0.006/minute)
3. Google Cloud Speech-to-Text ($0.024/minute)

Recommended: Start with Web Speech API, upgrade to Whisper for premium

Features:
- Full transcript generation
- Keyword detection (profanity, topics)
- Speaker identification (who's talking)
- Sentiment analysis
```

### 3.3 Caption/Subtitle Reading (OCR)
**Implementation:**
```javascript
Technology: Tesseract.js (free, browser-based)

Detection:
- Bottom-centered text = likely captions
- Read text overlays
- Combine with audio transcript
- Generate searchable content summary

Use Cases:
- Videos without audio
- Accessibility (deaf users)
- Content understanding without watching
```

### 3.4 Video Summary Generation
**Output:**
```
Video Summary:
━━━━━━━━━━━━━━━━━━━━━━━━
Duration: 8:47
Overall Risk: 🟢 12%

Content: Fitness tutorial demonstrating proper
squat form. Athletic wear throughout. Gym setting.

Timeline:
0:00-2:30 🟢 Introduction/setup
2:30-6:15 🟢 Exercise demonstration
6:15-8:47 🟢 Cool-down/summary

Detected Throughout:
• 1 person (instructor)
• Athletic wear (sports bra, leggings)
• Gym equipment (weights, mat)
• Instructional audio

Key Phrases:
"Keep your core engaged"
"Common mistakes to avoid"

[ Watch Video ] [ Skip ]
```

---

## 📅 PHASE 4: ACCOUNTABILITY (Months 7-8)

### Goal: Opt-in Support Systems

### 4.1 Personal Accountability
**Levels:**
1. Self-accountability (just user + pause/reflect)
2. Pattern sharing (general categories only)
3. Full transparency (specific sites, Ever Accountable style)
4. Active intervention (partner can lock settings)

**Key Features:**
- 30-second pause + reflection before override
- Weekly summary reports
- Pattern analysis (timing, triggers)
- Emotional check-ins
- Privacy-preserving by default
- Full transparency opt-in

### 4.2 Community Accountability
**Use Cases:**
- Church youth groups
- Small accountability groups
- Recovery communities (AA/NA)
- Men's/women's groups

**Features:**
- Anonymous group reports (no individual names)
- Pastor/leader private alerts (struggling members)
- Peer encouragement system
- Crisis button integration
- Resource sharing

### 4.3 Workplace Implementation
**Features:**
- Company-wide aggregate data only
- NO individual employee tracking
- Privacy-first architecture
- Security threat detection
- Productivity insights (optional)
- GDPR/CCPA compliant

---

## 📅 PHASE 5: ACCESSIBILITY (Months 9-10)

### Goal: Universal Access

### 5.1 Image Descriptions for Blind Users
**Why:** Leverage existing AI for accessibility
**Implementation:**
```javascript
// You already have this data from safety analysis:
const analysis = {
  people: 2,
  clothing: ['casual', 'jeans'],
  objects: ['coffee cup', 'laptop'],
  setting: 'cafe',
  text: 'Monday mood'
};

// Just convert to natural language:
const description = 
  "Two people in casual clothing at a cafe with " +
  "coffee and laptops. Text overlay: Monday mood";

// Add to image for screen readers:
image.setAttribute('aria-label', description);
image.setAttribute('alt', description);
```

**Impact:**
- 7.6 million blind/visually impaired in US
- Social media becomes accessible
- Free (using existing analysis)
- Differentiates ScrollVeil

### 5.2 Auto-Captions for Deaf Users
**Why:** Most videos lack captions
**Implementation:**
- Use existing transcription system
- Generate WebVTT caption files
- Add sound effect descriptions
- Speaker identification

**Impact:**
- 11 million deaf/hard-of-hearing in US
- 70%+ watch videos without sound
- Helps everyone, not just deaf users

---

## 📅 PHASE 6: ADVANCED FILTERING (Months 11-12)

### Goal: Comprehensive Content Categories

### 6.1 Violence Detection
**Visual Indicators:**
- Blood/red splatter patterns
- Weapons (object detection)
- Fighting poses (pose analysis)
- Injury patterns

**Audio Indicators:**
- Gunshots, screaming
- Violent keywords
- Distressed vocalizations

### 6.2 Profanity Filtering
**Implementation:**
- Real-time audio transcription
- Profanity word lists (severe, moderate, mild)
- Timeline markers
- Auto-mute option
- Skip section option

### 6.3 Self-Harm Content Detection
**Sensitive Handling:**
- Visual: Scar patterns, wounds
- Textual: Method discussion, suicidal language
- Context: Recovery content vs. triggering content
- Resources: Crisis hotlines always displayed

### 6.4 Eating Disorder Triggers
**Detection:**
- Before/after photos
- Weight/measurement discussion
- Calorie counting
- Body-focused content
- Diet culture language

**Resources:**
- NEDA Helpline integration
- Recovery-positive alternatives

### 6.5 Other Categories
- Animal distress
- Jump scares / flashing lights (epilepsy warning)
- Substance use
- Medical content (phobias)
- Political content (optional filtering)

### Settings UI:
```
Content Filtering Settings
━━━━━━━━━━━━━━━━━━━━━━━━━━━

[x] Explicit/Sexual Content
[x] Violence/Gore  
[x] Profanity
[ ] Self-Harm Discussion
[ ] Body Image Content
[ ] Animal Distress
[ ] Jump Scares
[ ] Substance Use
[ ] Medical Content
[ ] Political Content

Each category has:
- Sensitivity slider
- Action choice (block, warn, mute, skip)
- Context exceptions
- Custom keywords
```

---

## 📅 PHASE 7: POLISH & LAUNCH (Month 13+)

### Goal: Production-Ready Product

### 7.1 Performance Optimization
- Frame analysis parallelization
- Model caching
- Lazy loading
- Web Workers for heavy computation
- Memory management

### 7.2 Settings & Customization
- Profile system (presets + custom)
- Import/export settings
- Quick-switch profiles
- Per-site overrides

### 7.3 Mobile Support
- Mobile browser compatibility
- Touch interactions
- Performance on mobile hardware
- Battery optimization

### 7.4 Documentation
- User guide
- FAQ
- Video tutorials
- API documentation (for developers)
- Privacy policy
- Terms of service

### 7.5 Launch Strategy
- Chrome Web Store submission
- Firefox Add-ons submission
- Website + marketing
- Community building
- Press outreach

---

## 🔮 FUTURE VISION (Year 2+)

### Potential Expansions:
- **Mobile Apps:** Native iOS/Android
- **API Platform:** Let others integrate ScrollVeil
- **Browser Integration:** Partner with browsers
- **Education Platform:** Curriculum for schools/churches
- **Enterprise Features:** Advanced workplace tools
- **Multi-Language:** Global accessibility
- **AI Improvements:** Better detection, fewer false positives

### Business Model Options:
- **Free Tier:** Basic filtering, limited categories
- **Premium Tier:** Full features, video analysis, accountability
- **Enterprise:** Workplace solutions, priority support
- **Non-Profit Grants:** Accessibility funding
- **Partnerships:** Churches, schools, recovery organizations

---

## 📊 SUCCESS METRICS

### Technical Metrics:
- False positive rate: <5%
- False negative rate: <2%
- Blur application speed: <100ms
- Analysis accuracy: >90% per category
- Platform coverage: 95%+ of major sites

### User Metrics:
- User retention: >60% after 30 days
- Daily active users growth
- Average time protected per day
- User satisfaction (surveys)
- Support ticket volume (lower = better)

### Impact Metrics:
- People in recovery supported
- Families protected
- Communities strengthened
- Accessibility improved

---

## 🚧 KNOWN CHALLENGES

### Technical:
- React sites fighting DOM manipulation
- Performance on low-end devices
- Cross-browser compatibility
- Video analysis compute costs

### Product:
- Balancing safety with autonomy
- Avoiding over-filtering
- Cultural sensitivity (global users)
- Content moderation ethics

### Business:
- Chrome Web Store approval
- Monetization without compromising mission
- Competition from free alternatives
- Scaling infrastructure costs

---

## 🎯 NORTH STAR

**What makes ScrollVeil unique:**
1. Ethical AI (no exploitative training data)
2. User control (always)
3. Multi-category filtering (not just explicit content)
4. Video intelligence (unique capability)
5. Accountability with privacy
6. Accessibility built-in
7. Community-focused

**We're not building another content filter.**
**We're building the content intelligence platform for digital wellbeing.**

---

*Next document: DETECTION_SYSTEMS.md - Technical specifications for all AI detection*
