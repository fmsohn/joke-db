# PWA Icons

The app uses **icon-192.png** (maskable, 192×192) and **icon-512.png** (any, 512×512) from **`static/icons/`**. Use `?v=6` (or current ASSET_VERSION) for cache-busting.

## Manifest (root manifest.json)

- **192×192** → `/static/icons/icon-192.png?v=6`, **purpose: "maskable"**
- **512×512** → `/static/icons/icon-512.png?v=6`, **purpose: "any"**

## Asset requirements (home screen must be square)

- **icon-192.png** and **icon-512.png** must be square. Full-bleed with opaque background for maskable so the OS does not add white padding.
- Keep important content in the **center ~80%** for maskable cropping; outer area may be cropped to circle/squircle.

## How to crop to a perfect square (edge-to-edge)

1. Open the image in an editor (e.g. Photoshop, GIMP, Figma, or an online "crop to square" tool).
2. **Crop to a square** (e.g. 512×512). Use aspect ratio 1:1.
3. Export at 192×192 as **icon-192.png** and 512×512 as **icon-512.png** in **`static/icons/`**.
4. Bump **ASSET_VERSION** in `sw.js` and the `?v=` query string in manifest and HTML so caches invalidate.

## Cache invalidation (verification after changes)

After changing the icon or `manifest.json`:

1. **Service worker:** Bump **ASSET_VERSION** in `sw.js` so `CACHE_NAME` changes and the SW installs a new cache.
2. **On your phone:** Remove the app from the home screen, then re-add it.
3. **In browser (desktop):** Hard refresh or DevTools → Application → Storage → "Clear site data" before reinstalling the PWA.
