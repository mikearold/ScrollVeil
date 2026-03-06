# ScrollVeil - UI/UX DESIGN SPECIFICATIONS
*Created: February 14, 2026*
*User Interface Design Decisions*

## 🎨 DESIGN PHILOSOPHY

**Core Principles:**
1. **User Control First:** Never auto-unblur, user always chooses
2. **Minimal Intrusion:** Clean, professional, unobtrusive
3. **Transparency:** Show reasoning, not just scores
4. **Progressive Disclosure:** Quick glance → detailed info on demand
5. **Accessibility:** Keyboard navigation, screen reader support

---

## 🖼️ BLUR OVERLAY SYSTEM

### Current Design (To Be Improved):

**Problems:**
1. Score overlay sometimes bigger than image
2. Re-blur button overlaps platform UI
3. Not visually consistent across platforms

### New Design:

```
┌─────────────────────────────────┐
│                                 │
│      [blurred content]          │
│                                 │
│        🟢 10% Risk              │  ← Centered badge
│                                 │
│                                 │
└─────────────────────────────────┘

Properties:
• Transparent overlay (no background)
• Badge only (colored text + emoji)
• Always fits container
• Centered
• Click anywhere to see details
```

### After Reveal:

```
┌─────────────────────────────────┐
│  [↻ Re-blur]                    │  ← Top-right corner
│                                 │    Small, unobtrusive
│                                 │
│      [revealed content]         │
│                                 │
│                                 │
└─────────────────────────────────┘
```

### Badge Design:

```css
.scrollveil-risk-badge {
  /* No overlay background - transparent */
  background: rgba(0, 0, 0, 0.75);
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  color: white;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  cursor: pointer;
  transition: transform 0.2s;
}

.scrollveil-risk-badge:hover {
  transform: scale(1.05);
}

/* Color based on risk */
.risk-green { border-left: 4px solid #4CAF50; }
.risk-yellow { border-left: 4px solid #FFC107; }
.risk-orange { border-left: 4px solid #FF9800; }
.risk-red { border-left: 4px solid #F44336; }
.risk-black { border-left: 4px solid #212121; }
```

### Re-blur Button:

```css
.scrollveil-reblur {
  position: absolute;
  top: 8px;
  right: 8px;
  background: rgba(0, 0, 0, 0.6);
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 12px;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  transition: background 0.2s;
  z-index: 999999;
}

.scrollveil-reblur:hover {
  background: rgba(0, 0, 0, 0.8);
}

/* Smart positioning */
.scrollveil-reblur.avoid-corner {
  /* If platform has UI in top-right */
  top: auto;
  bottom: 8px;
  /* Or */
  right: auto;
  left: 8px;
}
```

---

## 📋 RISK ASSESSMENT DIALOG

### User Clicks Badge to See Details:

```
┌────────────────────────────────────┐
│  Content Assessment                │
├────────────────────────────────────┤
│  Overall Risk: 🟢 12%              │
│  Content Type: Real Photo          │
│  Subjects: 2 people detected       │
│  Context: Beach/recreational       │
├────────────────────────────────────┤
│  Risk Factors:                     │
│  ! Moderate skin region (40%)      │
│                                    │
│  Safe Indicators:                  │
│  ✓ Beach equipment detected        │
│  ✓ Swimwear appropriate for beach  │
│  ✓ Multiple people (social)        │
│  ✓ Active poses (recreational)     │
│                                    │
│  This appears to be recreational   │
│  beach activity with appropriate   │
│  swimwear in context.              │
│                                    │
│  [ Cancel ]         [ Reveal ]     │
└────────────────────────────────────┘
```

### Design Specs:

```css
.scrollveil-dialog {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 90%;
  max-width: 500px;
  max-height: 80vh;
  background: white;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.3);
  overflow-y: auto;
  z-index: 999999;
}

.scrollveil-dialog-header {
  padding: 20px;
  border-bottom: 1px solid #e0e0e0;
  font-weight: 600;
  font-size: 18px;
}

.scrollveil-dialog-content {
  padding: 20px;
  line-height: 1.6;
}

.scrollveil-risk-indicator {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 24px;
  margin-bottom: 20px;
}

.scrollveil-factors {
  margin: 20px 0;
}

.scrollveil-factor-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 8px 0;
  padding: 8px;
  border-radius: 6px;
}

.risk-factor {
  background: #fff3e0;
  color: #e65100;
}

.safe-indicator {
  background: #e8f5e9;
  color: #2e7d32;
}

.scrollveil-dialog-footer {
  padding: 20px;
  border-top: 1px solid #e0e0e0;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.scrollveil-button {
  padding: 10px 24px;
  border-radius: 6px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  border: none;
}

.scrollveil-button-cancel {
  background: #f5f5f5;
  color: #666;
}

.scrollveil-button-reveal {
  background: #2196F3;
  color: white;
}

.scrollveil-button:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0,0,0,0.2);
}
```

---

## 🎥 VIDEO TIMELINE INTERFACE

### Video Player Overlay:

```
Video Player with ScrollVeil
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[========================================]
 🟢🟢🟢🟢🟡🟡🟢🟢🟢🔴🔴🟢🟢🟢🟢
 0:00                              10:00

Hover over timeline:
┌──────────────────────────┐
│ 2:30-3:45: 🟡 Moderate   │
│ Closer camera angle      │
└──────────────────────────┘

Current Video Summary:
━━━━━━━━━━━━━━━━━━━━━━━━━
Duration: 8:47
Overall Risk: 🟢 12%

Timeline:
0:00-2:30 🟢 Introduction
2:30-6:15 🟢 Main content
6:15-8:47 🟢 Conclusion

[ View Full Analysis ]
[ Watch Now ] [ Skip ]
```

### CSS:

```css
.scrollveil-video-timeline {
  position: absolute;
  bottom: 60px; /* Above native controls */
  left: 0;
  right: 0;
  height: 8px;
  background: rgba(0,0,0,0.5);
  display: flex;
}

.scrollveil-timeline-segment {
  height: 100%;
  transition: height 0.2s;
}

.scrollveil-timeline-segment:hover {
  height: 16px;
  cursor: pointer;
}

.timeline-green { background: #4CAF50; }
.timeline-yellow { background: #FFC107; }
.timeline-orange { background: #FF9800; }
.timeline-red { background: #F44336; }

.scrollveil-video-summary {
  position: absolute;
  top: 20px;
  right: 20px;
  background: rgba(0, 0, 0, 0.9);
  color: white;
  padding: 16px;
  border-radius: 8px;
  max-width: 300px;
  font-size: 14px;
}
```

---

## ⚙️ SETTINGS PANEL

### Main Settings UI:

```
ScrollVeil Settings
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📸 CONTENT FILTERING

Explicit/Sexual Content:
[x] Enable filtering
Auto-reveal: 🟢 0-20%
Confirm: 🟡🟠 21-60%
Block: 🔴⚫ 61-100%

Violence/Gore:
[x] Enable filtering  
Sensitivity: ███████░░░ High

Profanity:
[x] Enable filtering
Action: [Mute audio ▾]

More categories...
[Add custom filter]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎨 APPEARANCE

Blur Strength:
░░░░░███░░ 50px

Risk Badge:
Position: [Center ▾]
Size: [Standard ▾]
Style: [Emoji + Text ▾]

Re-blur Button:
Position: [Smart (auto) ▾]
Size: [Small ▾]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

👥 ACCOUNTABILITY

Level: [None ▾]
       - Self-accountability
       - Pattern sharing
       - Full transparency
       - Active intervention

Partner: [Not set]
[Add accountability partner]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

♿ ACCESSIBILITY

[x] Image descriptions
[x] Video captions
[ ] High contrast mode
[ ] Larger text

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💾 DATA & PRIVACY

[Export settings]
[Import settings]
[Clear all data]
[View privacy policy]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 📱 MOBILE OPTIMIZATIONS

### Mobile-Specific Adjustments:

```css
@media (max-width: 768px) {
  /* Larger tap targets */
  .scrollveil-risk-badge {
    padding: 12px 20px;
    font-size: 16px;
    min-height: 44px; /* iOS guideline */
  }
  
  /* Full-screen dialog on mobile */
  .scrollveil-dialog {
    width: 100%;
    height: 100%;
    max-width: none;
    max-height: none;
    border-radius: 0;
    top: 0;
    left: 0;
    transform: none;
  }
  
  /* Bottom sheet style */
  .scrollveil-dialog-enter {
    animation: slideUp 0.3s ease-out;
  }
  
  @keyframes slideUp {
    from {
      transform: translateY(100%);
    }
    to {
      transform: translateY(0);
    }
  }
}
```

---

## ⌨️ KEYBOARD NAVIGATION

### Keyboard Shortcuts:

```
Keyboard Navigation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

When blur overlay focused:
• ENTER/SPACE: Show assessment dialog
• ESC: Cancel
• TAB: Move to next overlay

In assessment dialog:
• TAB: Navigate buttons
• ENTER: Activate button
• ESC: Close dialog

Video timeline:
• LEFT/RIGHT: Navigate timeline
• UP/DOWN: Adjust playback speed
• SPACE: Play/pause
```

### Implementation:

```javascript
// keyboardNavigation.js

class KeyboardNavigation {
  setupKeyboardControls(overlay) {
    overlay.setAttribute('tabindex', '0');
    overlay.setAttribute('role', 'button');
    overlay.setAttribute('aria-label', 'View content assessment');
    
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.showAssessmentDialog(overlay);
      }
      
      if (e.key === 'Escape') {
        this.closeDialog();
      }
    });
  }
  
  setupDialogControls(dialog) {
    // Focus trap within dialog
    const focusableElements = dialog.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    
    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
      
      if (e.key === 'Escape') {
        this.closeDialog();
      }
    });
    
    // Focus first element when dialog opens
    firstElement.focus();
  }
}
```

---

## 🎯 ANIMATION & TRANSITIONS

### Smooth Transitions:

```css
/* Blur application */
.scrollveil-blur {
  filter: blur(0px);
  transition: filter 0.3s ease-out;
}

.scrollveil-blur.blurred {
  filter: blur(var(--blur-strength, 30px));
}

/* Badge appearance */
.scrollveil-risk-badge {
  opacity: 0;
  transform: scale(0.8);
  animation: fadeInScale 0.3s ease-out forwards;
}

@keyframes fadeInScale {
  to {
    opacity: 1;
    transform: scale(1);
  }
}

/* Dialog transitions */
.scrollveil-dialog-backdrop {
  opacity: 0;
  transition: opacity 0.2s ease-out;
}

.scrollveil-dialog-backdrop.show {
  opacity: 1;
}

.scrollveil-dialog {
  opacity: 0;
  transform: translate(-50%, -45%);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.scrollveil-dialog.show {
  opacity: 1;
  transform: translate(-50%, -50%);
}

/* Re-blur button */
.scrollveil-reblur {
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease-out;
}

.scrollveil-reblur.visible {
  opacity: 1;
  pointer-events: auto;
}
```

---

## 🌈 COLOR SYSTEM

### Risk Level Colors:

```css
:root {
  /* Risk levels */
  --risk-green: #4CAF50;    /* 0-20% */
  --risk-yellow: #FFC107;   /* 21-40% */
  --risk-orange: #FF9800;   /* 41-60% */
  --risk-red: #F44336;      /* 61-80% */
  --risk-black: #212121;    /* 81-100% */
  
  /* Neutrals */
  --bg-primary: #ffffff;
  --bg-secondary: #f5f5f5;
  --text-primary: #212121;
  --text-secondary: #666666;
  --border: #e0e0e0;
  
  /* Semantic */
  --success: #4CAF50;
  --warning: #FF9800;
  --error: #F44336;
  --info: #2196F3;
  
  /* Overlays */
  --overlay-light: rgba(0, 0, 0, 0.5);
  --overlay-dark: rgba(0, 0, 0, 0.9);
}

/* Dark mode support */
@media (prefers-color-scheme: dark) {
  :root {
    --bg-primary: #121212;
    --bg-secondary: #1e1e1e;
    --text-primary: #ffffff;
    --text-secondary: #b0b0b0;
    --border: #333333;
  }
}
```

---

## 🔔 NOTIFICATION SYSTEM

### Toast Notifications:

```
┌────────────────────────────────┐
│ ✓ Content revealed             │
│ [Re-blur] [Dismiss]            │
└────────────────────────────────┘

Position: Bottom-right
Duration: 4 seconds (auto-dismiss)
Actions: Optional buttons
```

```css
.scrollveil-toast {
  position: fixed;
  bottom: 20px;
  right: 20px;
  background: white;
  padding: 16px 20px;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.2);
  display: flex;
  align-items: center;
  gap: 12px;
  z-index: 999999;
  animation: slideInRight 0.3s ease-out;
}

@keyframes slideInRight {
  from {
    transform: translateX(400px);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

.scrollveil-toast.hiding {
  animation: slideOutRight 0.3s ease-out forwards;
}

@keyframes slideOutRight {
  to {
    transform: translateX(400px);
    opacity: 0;
  }
}
```

---

## 🎨 PLATFORM-SPECIFIC ADAPTATIONS

### X/Twitter:

```css
/* Avoid X's close button (top-right) */
.scrollveil-on-twitter .scrollveil-reblur {
  top: auto;
  bottom: 8px;
}

/* Match X's design language */
.scrollveil-on-twitter .scrollveil-dialog {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto;
}
```

### YouTube:

```css
/* Position above YouTube controls */
.scrollveil-on-youtube .scrollveil-video-timeline {
  bottom: 52px;
}

/* Match YouTube red */
.scrollveil-on-youtube .scrollveil-button-reveal {
  background: #ff0000;
}
```

### Google Images:

```css
/* Smaller overlays for thumbnails */
.scrollveil-on-google-images .scrollveil-risk-badge {
  padding: 4px 8px;
  font-size: 11px;
}
```

---

## 📐 RESPONSIVE BREAKPOINTS

```css
/* Mobile */
@media (max-width: 480px) {
  .scrollveil-risk-badge {
    font-size: 12px;
  }
}

/* Tablet */
@media (min-width: 481px) and (max-width: 1024px) {
  .scrollveil-dialog {
    max-width: 600px;
  }
}

/* Desktop */
@media (min-width: 1025px) {
  .scrollveil-dialog {
    max-width: 700px;
  }
}

/* Large screens */
@media (min-width: 1920px) {
  .scrollveil-risk-badge {
    font-size: 16px;
  }
}
```

---

## ✨ LOADING STATES

```css
.scrollveil-analyzing {
  position: relative;
}

.scrollveil-analyzing::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 40px;
  height: 40px;
  border: 3px solid rgba(255,255,255,0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: translate(-50%, -50%) rotate(360deg); }
}

.scrollveil-analyzing-text {
  position: absolute;
  top: calc(50% + 30px);
  left: 50%;
  transform: translateX(-50%);
  color: white;
  font-size: 12px;
  text-shadow: 0 1px 3px rgba(0,0,0,0.5);
}
```

---

**These specs provide:**
- ✅ Clean, professional UI
- ✅ Accessible (keyboard, screen readers)
- ✅ Responsive (mobile → desktop)
- ✅ Platform-specific adaptations
- ✅ Smooth animations
- ✅ Consistent design system

**Ready to implement!** 🎨✨
