# ScrollVeil Website Cheat Sheet
## How to Update scrollveil.com

Your website lives in your GitHub repo. Any changes you push to GitHub
automatically go live on scrollveil.com within 1-2 minutes.

---

## Quick Reference: Push Any Changes
Open PowerShell and run these 3 commands:

```
cd "C:\Users\Family\OneDrive\Desktop\Vibe Coding\ScrollVeil"
git add -A
git commit -m "Describe what you changed"
git push origin main
```

That's it! Wait 1-2 minutes, then check scrollveil.com.

---

## Common Tasks

### SWAP A SCREENSHOT (same filename)
1. Replace the file in the `screenshots` folder (keep the same name)
2. Run the 3 git commands above

### ADD A NEW SCREENSHOT
1. Save the new image to the `screenshots` folder (e.g. ss_13_reddit.png)
2. Open `index.html` in a text editor (like Notepad or VS Code)
3. Find the screenshots section and copy one of the existing blocks:

```html
<div class="screenshot-item" onclick="openLightbox(this)">
  <img src="screenshots/ss_13_reddit.png" alt="Description here" loading="lazy">
  <div class="screenshot-caption">
    <span class="badge badge-google">Reddit</span> Your caption here
  </div>
</div>
```

4. Paste it where you want it in the gallery
5. Change the filename, alt text, badge, and caption
6. Run the 3 git commands above

### BADGE COLORS AVAILABLE
- badge-google    (blue)
- badge-twitter   (light blue)
- badge-instagram (pink)
To add a new color, add a CSS class in the <style> section like:
  .badge-reddit { background: rgba(255, 69, 0, 0.15); color: #ff4500; }

### REMOVE A SCREENSHOT
1. Delete the image file from the `screenshots` folder
2. Open `index.html` and delete the matching <div class="screenshot-item"> block
3. Run the 3 git commands above

### CHANGE A CAPTION
1. Open `index.html` in a text editor
2. Find the caption text you want to change
3. Edit it and save
4. Run the 3 git commands above

### UPDATE THE "ADD TO CHROME" LINK
Once your extension is published on the Chrome Web Store:
1. Open `index.html`
2. Find all instances of href="#install" and href="#"
3. Replace with your Chrome Web Store URL, like:
   href="https://chrome.google.com/webstore/detail/scrollveil/YOUR_EXTENSION_ID"
4. Run the 3 git commands above

---

## File Structure
```
ScrollVeil/
  index.html          <-- The website (edit this)
  screenshots/        <-- Screenshot images go here
    ss_01_bikini_scores.png
    ss_02_tomato_disabled.png
    ss_03_tomato_detecting.png
    ... etc
```

## Troubleshooting

**"fatal: not a git repository"**
You're not in the right folder. Make sure to run:
  cd "C:\Users\Family\OneDrive\Desktop\Vibe Coding\ScrollVeil"

**Push is rejected**
Try: git push -f origin main
(This force pushes — only use if you're the only person working on it)

**Changes not showing on scrollveil.com**
- Wait 2-3 minutes for GitHub Pages to rebuild
- Try hard refresh: Ctrl+Shift+R in your browser
- Check https://github.com/mikearold/ScrollVeil/actions to see if deploy succeeded
