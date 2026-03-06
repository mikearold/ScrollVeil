# ScrollVeil - DETECTION SYSTEMS
*Created: February 14, 2026*
*Technical Specifications for AI Detection Pipeline*

## 🧠 DETECTION ARCHITECTURE OVERVIEW

```
ScrollVeil Detection Pipeline
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INPUT: Image or Video Frame
         ↓
    ┌────────────────────────────────────┐
    │   LAYER 1: Person Detection        │
    │   Is there a human? Where?         │
    └────────────────────────────────────┘
         ↓
    ┌────────────────────────────────────┐
    │   LAYER 2: Clothing Detection      │
    │   What are they wearing?           │
    └────────────────────────────────────┘
         ↓
    ┌────────────────────────────────────┐
    │   LAYER 3: Object Detection        │
    │   What's the environment/context?  │
    └────────────────────────────────────┘
         ↓
    ┌────────────────────────────────────┐
    │   LAYER 4: Geometric Analysis      │
    │   Skin clusters, boundaries, etc.  │
    └────────────────────────────────────┘
         ↓
    ┌────────────────────────────────────┐
    │   LAYER 5: Risk Calculation        │
    │   Combine all signals              │
    └────────────────────────────────────┘
         ↓
    OUTPUT: Risk Score + Detailed Assessment
```

**Key Principle:** Each layer provides independent signal. Agreement between layers = high confidence.

---

## 🎯 LAYER 1: PERSON DETECTION

### Purpose:
- Identify if humans are present
- Get bounding boxes (where they are)
- Eliminate false positives (buildings, statues)
- Focus analysis on actual people

### Technology: COCO-SSD (TensorFlow.js)

**Model Details:**
- Name: COCO-SSD (Common Objects in Context - Single Shot Detector)
- Size: ~5MB
- Speed: 100-200ms per image
- Categories: 80 objects including "person"
- Training: Ethical - everyday scenes, sports, activities

**Installation:**
```bash
npm install @tensorflow/tfjs @tensorflow-models/coco-ssd
```

**Implementation:**
```javascript
// personDetection.js

import * as cocoSsd from '@tensorflow-models/coco-ssd';

class PersonDetector {
  constructor() {
    this.model = null;
  }
  
  async initialize() {
    this.model = await cocoSsd.load();
    console.log('Person detection model loaded');
  }
  
  async detectPeople(imageElement) {
    if (!this.model) await this.initialize();
    
    const predictions = await this.model.detect(imageElement);
    const people = predictions.filter(pred => pred.class === 'person');
    
    return people.map(person => ({
      boundingBox: person.bbox, // [x, y, width, height]
      confidence: person.score,  // 0-1
      center: {
        x: person.bbox[0] + person.bbox[2] / 2,
        y: person.bbox[1] + person.bbox[3] / 2
      }
    }));
  }
  
  extractPersonRegion(imageElement, boundingBox) {
    const [x, y, width, height] = boundingBox;
    
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imageElement, x, y, width, height, 0, 0, width, height);
    
    return canvas;
  }
}

export const personDetector = new PersonDetector();
```

**Integration with Existing System:**
```javascript
// detector.js - Modified to use person detection

async function analyzeImage(imageElement) {
  // Step 1: Detect people
  const people = await personDetector.detectPeople(imageElement);
  
  if (people.length === 0) {
    // No people detected - handle non-person content
    return handleNonPersonContent(imageElement);
  }
  
  // Step 2: Analyze each person separately
  const personAnalyses = [];
  
  for (const person of people) {
    const personRegion = personDetector.extractPersonRegion(
      imageElement, 
      person.boundingBox
    );
    
    // Run existing geometric analysis ONLY on person region
    const skinAnalysis = analyzeSkinClusters(personRegion);
    const anatomicalMarkers = detectAnatomicalFeatures(personRegion);
    const riskScore = calculateRisk(skinAnalysis, anatomicalMarkers);
    
    personAnalyses.push({
      person: person,
      skin: skinAnalysis,
      markers: anatomicalMarkers,
      risk: riskScore
    });
  }
  
  // Step 3: Overall assessment
  return {
    people: personAnalyses,
    overallRisk: Math.max(...personAnalyses.map(p => p.risk)),
    count: people.length
  };
}

function handleNonPersonContent(imageElement) {
  // No person detected
  // Check if it's a statue, building, or just no skin tones
  
  const hasSkinTones = quickSkinCheck(imageElement);
  
  if (!hasSkinTones) {
    return { risk: 0, reason: 'No skin tones detected' };
  }
  
  // Has skin tones but no person = probably statue/building
  const hasSharpAngles = detectSharpAngles(imageElement);
  
  if (hasSharpAngles > 0.8) {
    return { risk: 0, reason: 'Building/architecture detected' };
  }
  
  return { risk: 10, reason: 'Possible statue or art' };
}
```

**Expected Results:**
- **Terracotta building:** No person detected → Risk: 0
- **Statue:** No person detected → Risk: 0-10 (possible statue)
- **Beach photo:** 3 people detected → Analyze each person
- **False positive reduction:** 80-90%

---

## 👕 LAYER 2: CLOTHING DETECTION

### Purpose:
- Identify what people are wearing
- Differentiate swimwear from underwear
- Understand context appropriateness
- Adjust risk based on clothing + environment

### Technology: Fashion Classification Models

**Model Options:**

1. **DeepFashion-based (Recommended)**
   - 50+ clothing categories
   - Attributes: sleeve length, neckline, etc.
   - Material detection
   - Size: 20-40MB

2. **Fashion-MNIST Derivative**
   - 10 basic categories
   - Lighter weight (10MB)
   - Faster inference

**Key Categories Needed:**
```javascript
const clothingCategories = {
  // Full coverage
  FORMAL: ['suit', 'dress_shirt', 'long_dress', 'business_attire'],
  CASUAL: ['t_shirt', 'jeans', 'hoodie', 'jacket'],
  
  // Athletic/recreational
  ATHLETIC: ['sports_bra', 'leggings', 'athletic_shorts', 'gym_wear'],
  SWIMWEAR: ['bikini', 'swim_trunks', 'one_piece', 'rash_guard'],
  
  // Minimal/intimate
  UNDERWEAR: ['bra', 'underwear', 'lingerie'],
  
  // Special context
  MEDICAL: ['hospital_gown', 'scrubs'],
  COSTUME: ['halloween', 'cosplay', 'theatrical']
};
```

**Implementation:**
```javascript
// clothingDetection.js

class ClothingDetector {
  constructor() {
    this.model = null;
  }
  
  async initialize() {
    // Load fashion classification model
    // (Specific implementation depends on chosen model)
    this.model = await loadFashionModel();
  }
  
  async detectClothing(personRegionCanvas) {
    if (!this.model) await this.initialize();
    
    const predictions = await this.model.classify(personRegionCanvas);
    
    return {
      items: predictions.map(p => p.className),
      coverage: this.calculateCoverage(predictions),
      style: this.determineStyle(predictions),
      confidence: predictions[0]?.probability || 0
    };
  }
  
  calculateCoverage(predictions) {
    // Estimate body coverage percentage
    const fullCoverageItems = ['suit', 'long_dress', 'jacket', 'jeans'];
    const mediumCoverageItems = ['t_shirt', 'shorts', 'athletic_wear'];
    const minimalCoverageItems = ['bikini', 'underwear', 'swim_trunks'];
    
    if (predictions.some(p => fullCoverageItems.includes(p.className))) {
      return 'full';
    } else if (predictions.some(p => mediumCoverageItems.includes(p.className))) {
      return 'medium';
    } else if (predictions.some(p => minimalCoverageItems.includes(p.className))) {
      return 'minimal';
    }
    
    return 'unknown';
  }
  
  determineStyle(predictions) {
    const topPrediction = predictions[0]?.className;
    
    if (clothingCategories.FORMAL.includes(topPrediction)) return 'formal';
    if (clothingCategories.ATHLETIC.includes(topPrediction)) return 'athletic';
    if (clothingCategories.SWIMWEAR.includes(topPrediction)) return 'swimwear';
    if (clothingCategories.UNDERWEAR.includes(topPrediction)) return 'underwear';
    
    return 'casual';
  }
}

export const clothingDetector = new ClothingDetector();
```

**Risk Adjustment Logic:**
```javascript
function adjustRiskForClothing(baseRisk, clothing, context) {
  let adjustment = 0;
  
  // SWIMWEAR
  if (clothing.style === 'swimwear') {
    if (context.environment === 'beach' || context.environment === 'pool') {
      adjustment = -30; // Appropriate context
    } else if (context.environment === 'indoor') {
      adjustment = +20; // Indoor swimwear unusual
    }
  }
  
  // ATHLETIC WEAR
  if (clothing.style === 'athletic') {
    if (context.objects.includes('gym_equipment')) {
      adjustment = -25; // Gym context appropriate
    }
  }
  
  // UNDERWEAR/LINGERIE
  if (clothing.style === 'underwear') {
    adjustment = +40; // Generally concerning
    if (context.environment === 'fashion_show') {
      adjustment = -20; // Fashion/commercial context
    }
  }
  
  // FULL COVERAGE
  if (clothing.coverage === 'full') {
    adjustment = -30; // Fully clothed = lower risk
  }
  
  return Math.max(0, Math.min(100, baseRisk + adjustment));
}
```

---

## 🏖️ LAYER 3: OBJECT/CONTEXT DETECTION

### Purpose:
- Understand environment and setting
- Detect contextual objects (beach umbrella, gym equipment, etc.)
- Provide "safe indicators" for risk assessment
- Differentiate appropriate from inappropriate contexts

### Technology: COCO-SSD (Same model as person detection)

**Key Object Categories:**
```javascript
const contextObjects = {
  BEACH: ['beach_umbrella', 'surfboard', 'volleyball', 'cooler'],
  POOL: ['swimming_pool', 'pool_float', 'diving_board'],
  GYM: ['dumbbell', 'bench', 'treadmill', 'yoga_mat', 'exercise_equipment'],
  MEDICAL: ['stethoscope', 'hospital_bed', 'wheelchair', 'medical_equipment'],
  OFFICE: ['desk', 'computer', 'office_chair', 'filing_cabinet'],
  HOME: ['couch', 'bed', 'dining_table', 'television'],
  OUTDOOR: ['tree', 'bench', 'bicycle', 'backpack'],
  SPORTS: ['baseball_bat', 'tennis_racket', 'soccer_ball', 'sports_equipment']
};
```

**Implementation:**
```javascript
// contextDetection.js

class ContextDetector {
  async detectContext(imageElement, peopleRegions) {
    // Use same COCO-SSD model
    const allPredictions = await cocoSsd.model.detect(imageElement);
    
    // Filter out people (we already detected them)
    const objects = allPredictions.filter(pred => pred.class !== 'person');
    
    // Identify environment
    const environment = this.identifyEnvironment(objects);
    
    // Calculate context confidence
    const confidence = this.calculateContextConfidence(objects, environment);
    
    return {
      objects: objects.map(obj => obj.class),
      environment: environment,
      confidence: confidence,
      objectCount: objects.length
    };
  }
  
  identifyEnvironment(objects) {
    const objectClasses = objects.map(obj => obj.class);
    
    // Check for beach indicators
    const beachCount = objectClasses.filter(obj => 
      contextObjects.BEACH.includes(obj)
    ).length;
    
    // Check for gym indicators  
    const gymCount = objectClasses.filter(obj =>
      contextObjects.GYM.includes(obj)
    ).length;
    
    // Check for medical indicators
    const medicalCount = objectClasses.filter(obj =>
      contextObjects.MEDICAL.includes(obj)
    ).length;
    
    // Determine primary environment
    if (beachCount >= 2) return 'beach';
    if (gymCount >= 2) return 'gym';
    if (medicalCount >= 1) return 'medical';
    if (objectClasses.includes('bed')) return 'bedroom';
    if (objectClasses.includes('desk')) return 'office';
    
    // Check outdoor indicators
    const outdoorCount = objectClasses.filter(obj =>
      contextObjects.OUTDOOR.includes(obj)
    ).length;
    if (outdoorCount >= 2) return 'outdoor';
    
    return 'indoor/unknown';
  }
  
  calculateContextConfidence(objects, environment) {
    // More objects = higher confidence in context assessment
    if (objects.length === 0) return 0;
    if (objects.length >= 5) return 0.9;
    if (objects.length >= 3) return 0.7;
    if (objects.length >= 1) return 0.5;
    return 0;
  }
}

export const contextDetector = new ContextDetector();
```

**Context-Based Risk Adjustment:**
```javascript
function assessContextRisk(people, clothing, context) {
  let contextModifier = 0;
  
  // BEACH CONTEXT
  if (context.environment === 'beach') {
    if (clothing.style === 'swimwear') {
      contextModifier = -30; // Expected
    }
    if (people.count > 1) {
      contextModifier -= 10; // Social setting
    }
  }
  
  // GYM CONTEXT
  if (context.environment === 'gym') {
    if (clothing.style === 'athletic') {
      contextModifier = -25; // Expected
    }
  }
  
  // MEDICAL CONTEXT
  if (context.environment === 'medical') {
    contextModifier = -40; // Educational/clinical
  }
  
  // BEDROOM WITH NO CONTEXT OBJECTS
  if (context.environment === 'bedroom' && context.objectCount < 2) {
    contextModifier = +30; // Private/intimate setting
  }
  
  // NO CONTEXT (isolated subject)
  if (context.objectCount === 0) {
    contextModifier = +25; // Concerning - no environment
  }
  
  return contextModifier;
}
```

---

## 📐 LAYER 4: GEOMETRIC ANALYSIS (YOUR CURRENT SYSTEM)

### Purpose:
- Detect skin tone regions
- Analyze anatomical features
- Measure composition (centering, framing)
- Provide geometric signals

**Keep your existing geometric detection:**
- Skin cluster analysis (flood-fill)
- Anatomical feature detection (pure geometry)
- Sharp angle detection (buildings vs bodies)
- Boundary smoothness analysis

**Enhancement: Only run on person regions**
```javascript
// Before: Analyzed entire image
const skinAnalysis = analyzeSkinClusters(fullImage);

// After: Only analyze person regions
for (const person of detectedPeople) {
  const personRegion = extractRegion(image, person.bbox);
  const skinAnalysis = analyzeSkinClusters(personRegion);
  // Much more accurate!
}
```

---

## 🎲 LAYER 5: RISK CALCULATION

### Purpose:
- Combine all signals intelligently
- Weight by confidence
- Generate final score
- Provide detailed reasoning

**The Weighted Scoring System:**
```javascript
function calculateFinalRisk(analysis) {
  const weights = {
    geometric: 0.30,    // Your current system
    person: 0.20,       // Is there a person?
    clothing: 0.25,     // What are they wearing?
    context: 0.20,      // What's the environment?
    composition: 0.05   // Framing and centering
  };
  
  let score = 0;
  let confidence = 0;
  
  // Geometric score
  score += analysis.geometric.risk * weights.geometric;
  confidence += analysis.geometric.confidence * weights.geometric;
  
  // Person detection impact
  if (analysis.person.count === 0) {
    // No person = likely statue/building
    score = Math.min(score, 10);
  } else {
    // Multiple people = social context (usually safer)
    if (analysis.person.count > 2) {
      score -= 10;
    }
  }
  
  // Clothing impact
  const clothingRisk = assessClothingRisk(analysis.clothing, analysis.context);
  score += clothingRisk * weights.clothing;
  
  // Context impact
  const contextRisk = assessContextRisk(analysis.person, analysis.clothing, analysis.context);
  score += contextRisk * weights.context;
  
  // Composition impact (centered, fills frame)
  if (analysis.composition.centered && analysis.composition.fillRatio > 0.8) {
    score += 10; // Intimate framing
  }
  
  // Clamp score 0-100
  score = Math.max(0, Math.min(100, score));
  
  return {
    score: Math.round(score),
    confidence: Math.round(confidence * 100),
    breakdown: generateBreakdown(analysis)
  };
}
```

**Breakdown Generation:**
```javascript
function generateBreakdown(analysis) {
  const riskFactors = [];
  const safeIndicators = [];
  
  // Risk factors
  if (analysis.geometric.skinPercent > 60) {
    riskFactors.push(`Large skin region (${analysis.geometric.skinPercent}%)`);
  }
  
  if (analysis.composition.centered) {
    riskFactors.push('Centered intimate framing');
  }
  
  if (analysis.context.objectCount === 0) {
    riskFactors.push('Minimal contextual elements');
  }
  
  if (analysis.clothing.style === 'underwear') {
    riskFactors.push('Intimate apparel detected');
  }
  
  // Safe indicators
  if (analysis.context.environment === 'beach') {
    safeIndicators.push('Beach scene detected');
  }
  
  if (analysis.clothing.style === 'swimwear' && analysis.context.environment === 'beach') {
    safeIndicators.push('Swimwear appropriate for beach context');
  }
  
  if (analysis.person.count > 1) {
    safeIndicators.push(`Multiple people (${analysis.person.count}) - social context`);
  }
  
  if (analysis.context.environment === 'gym') {
    safeIndicators.push('Athletic/fitness context');
  }
  
  return {
    riskFactors: riskFactors,
    safeIndicators: safeIndicators
  };
}
```

---

## 🎬 VIDEO ANALYSIS PIPELINE

### Frame Sampling Strategy:
```javascript
function determineFrameS

ampleRate(videoDuration) {
  if (videoDuration < 60) return 1;     // Every second
  if (videoDuration < 600) return 2;    // Every 2 seconds
  return 5;                              // Every 5 seconds
}

async function analyzeVideo(videoElement) {
  const duration = videoElement.duration;
  const sampleRate = determineFrameSampleRate(duration);
  
  const frames = [];
  
  for (let time = 0; time < duration; time += sampleRate) {
    videoElement.currentTime = time;
    await waitForSeek();
    
    const frame = captureFrame(videoElement);
    const analysis = await analyzeImage(frame);
    
    frames.push({
      timestamp: time,
      analysis: analysis
    });
  }
  
  return {
    frames: frames,
    timeline: generateTimeline(frames),
    overallRisk: calculateOverallVideoRisk(frames),
    summary: generateVideoSummary(frames)
  };
}
```

---

**Continued in next file due to length...**

*Next document: ACCOUNTABILITY_FRAMEWORK.md*
