# Stagetime PWA – Cache & manifest checklist

Use this when you change icons or the manifest so installs get the new assets.

---

## Cache-busting strategy (current setup)

- **Single version:** `sw.js` defines `ASSET_VERSION` (e.g. `"6"`). Bump it when you change icons or manifest. Icons are **icon-192.png** (maskable) and **icon-512.png** (any) in `static/icons/`. Cache-bust with `?v=6` (ASSET_VERSION in sw.js).
- **Manifest:** Linked as `/manifest.json?v=<version>` in `index.html` and precached the same way in `sw.js`, so the browser treats it as a new URL and re-fetches.
- **Icons:** All icon URLs in `manifest.json` and `index.html` use `?v=<version>`. Same version as in `sw.js`.
- **Service worker:** `CACHE_NAME` is `stagetime-root-v` + version. Bumping the version installs a new SW and deletes the old cache, so all precached assets are re-fetched with `cache: "reload"`.

**When you change icons or manifest:**  
1. Bump `ASSET_VERSION` in `sw.js`.  
2. Update the query string in the `<link rel="manifest">` in `index.html` to match.  
3. Update all icon `?v=` query strings in `manifest.json` and `index.html` to match.

---

## Manifest.json checklist (no conflicting purposes)

- [ ] **One purpose per icon entry** – Each object in `icons` has a single `purpose`: `"any"`, `"maskable"`, or `"any maskable"`. No duplicate entries that mix purposes for the same asset in a way that could confuse the browser.
- [ ] **Distinct roles** – 192×192 uses `purpose: "maskable"` (icon-192.png); 512×512 uses `purpose: "any"` (icon-512.png). No stale AppIcon paths. You have separate entries for “any” (e.g. `AppIcon.png`) and “maskable” (e.g. `AppIconSafe.png`). Do not reuse the same `src` for both unless the image is safe for both; otherwise the browser may fall back to the wrong one.
- [ ] **Sizes match the files** – Each entry’s `sizes` (e.g. `192x192`, `512x512`) matches the actual image dimensions.
- [ ] **Icon URLs are versioned** – Every icon `src` includes `?v=<version>` so caches and installs pick up new files.
- [ ] **No stray or old entries** – Remove any legacy icon entries that point to old paths or old filenames.

---

## index.html audit (manifest & icons)

- [ ] **Manifest link is versioned** – `<link rel="manifest" href="/manifest.json?v=...">` has a query string; no plain `/manifest.json` so the browser can re-fetch.
- [ ] **No cached manifest URL** – The `href` does not point to an old path (e.g. `/static/manifest.json` or a different origin) that might be cached elsewhere.
- [ ] **Favicon / apple-touch-icon** – `<link rel="icon">` and `<link rel="apple-touch-icon">` use the same versioned icon URL as in the manifest (e.g. `?v=4`).
- [ ] **In-page images** – Any `<img>` that uses app icons (e.g. header logo) uses the same `?v=` so they don’t stay stale.

---

## Service worker: manifest won't block icon updates

- The manifest is precached as **`/manifest.json?v=<version>`** (versioned URL). When you bump `ASSET_VERSION`, the **cache name** changes, so the old cache is deleted on activate and the new SW precaches the new URL.
- Install uses **`cache: "reload"`** for precache requests, so the SW gets a fresh manifest from the network (bypasses HTTP cache).
- The fetch handler serves by request URL; the versioned manifest URL ensures the cached response is the one precached for that version. No stale manifest once the new SW is active.
- **To guarantee propagation:** Bump `ASSET_VERSION`, deploy, then have users refresh (or close/reopen the app) so the new SW installs and activates; then re-add to home screen so the OS fetches the new manifest and icons.

---

## Android Adaptive Icons gotchas

- **Transparency → white:** If the manifest icon has transparency, Android may composite it on a white (or default) background and create a white border. Use an **opaque background** (e.g. your `background_color` / theme color) in the icon image.
- **Single icon with `"any maskable"`:** Using one full-bleed, opaque icon with `purpose: "any maskable"` lets the OS use it everywhere and apply the adaptive mask on the home screen without adding extra padding.
- **Safe zone:** For maskable, important content can sit in the center ~80%; outer area may be cropped to circle/squircle. Full-bleed is fine; edges may be clipped.
- **Sizes:** Keep 192×192 and 512×512; Android uses both (e.g. 192 for launcher, 512 for splash/install).
- **Reinstall:** After changing the icon or manifest, remove the app from the home screen and add again; some launchers cache the icon aggressively.

---

## After deploying

1. **Unregister old SW (optional but recommended for testing):** DevTools → Application → Service Workers → Unregister. Or use “Update on reload” while developing.
2. **Hard reload** the app (or close all tabs and reopen).
3. **Remove the app from the home screen** if it was already installed, then **Add to Home Screen** again so the browser fetches the new manifest and icons.
