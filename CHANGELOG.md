# ScrollVeil Changelog

All notable changes to ScrollVeil are documented here.

Version format: MAJOR.MINOR.PATCH
- MAJOR — significant overhaul or breaking change
- MINOR — new feature added
- PATCH — bug fix or small improvement

---

## [1.0.0] — 2026-03-07 — Initial Release

### What's New
First public release of ScrollVeil for Chrome.

### Features
- **Instant blur protection** — CSS shield blurs all images and videos before they render
- **AI detection pipeline** — COCO-SSD, BlazeFace, BlazePose, and MobileNet work together locally in your browser
- **Skin detection** — YCrCb + RGB color analysis measures exposed skin across body zones
- **Language scoring** — titles, captions, and surrounding text are analyzed alongside images
- **Video frame sampling** — videos are sampled frame-by-frame with live score updates
- **Detail modal** — click any badge for a full breakdown of what was detected and why
- **Adjustable sensitivity** — set your own blur strength and auto-reveal threshold
- **Video analysis controls** — configure sample rate, frame limit, and early exit threshold
- **Platform support** — YouTube, X/Twitter, Google Images, Instagram, and all general websites
- **Infinite scroll detection** — MutationObserver + scroll-triggered rescan catches dynamically loaded content
- **Privacy first** — 100% local processing, no data ever leaves your device

### Principles
- No NudeNet, no NSFW datasets — models trained on clean data only
- No accounts, no tracking, no analytics
- User always has the option to reveal blurred content

---

## Upcoming

### Planned for v1.1.0
- Android app
- Email list / account system
- Paid subscription plans (free early access period ends — users will be notified in advance)
- Lifetime access for early supporters

---

*ScrollVeil is built by Michael Arold. For support or feedback, contact support@scrollveil.com*
