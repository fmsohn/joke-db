# PWA Screenshots

Chrome and other browsers use these images in the install prompt ("mini-app store" preview).

- **desktop.png** – 1280×720, wide form factor. Desktop view of Stagetime.
- **mobile.png** – 390×844, narrow form factor. Mobile view of Stagetime.

Add these files to this folder. The manifest references them as `/static/screenshots/desktop.png?v=6` and `/static/screenshots/mobile.png?v=6`. They are precached in `sw.js` so the install UI can show them offline.
