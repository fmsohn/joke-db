/**
 * Stagetime PWA – Stale-While-Revalidate service worker (root scope).
 * All precache URLs are absolute from the document origin.
 * Asset v23 / app 23 — bump ASSET_VERSION / CACHE_NAME when changing icons/manifest/CSS/JS.
 */
const ASSET_VERSION = "23";
const CACHE_NAME = "stagetime-v23";

const PRECACHE_URLS = [
  "/?v=" + ASSET_VERSION,
  "/index.html?v=" + ASSET_VERSION,
  "/manifest.json?v=" + ASSET_VERSION,
  "/static/css/variables.css?v=" + ASSET_VERSION,
  "/static/css/layout.css?v=" + ASSET_VERSION,
  "/static/css/components.css?v=" + ASSET_VERSION,
  "/static/css/main.css?v=" + ASSET_VERSION,
  "/static/css/theme-default.css?v=" + ASSET_VERSION,
  "/static/css/workstation.css?v=" + ASSET_VERSION,
  "/static/css/styles.css?v=" + ASSET_VERSION,
  "/static/js/dexie.min.js?v=" + ASSET_VERSION,
  "/static/js/db.js?v=" + ASSET_VERSION,
  "/static/js/app.js?v=" + ASSET_VERSION,
  "/static/icons/icon-192.png?v=" + ASSET_VERSION,
  "/static/icons/icon-512.png?v=" + ASSET_VERSION,
  "/static/icons/logo.png?v=" + ASSET_VERSION,
  "/static/screenshots/desktop.png?v=" + ASSET_VERSION,
  "/static/screenshots/mobile.png?v=" + ASSET_VERSION,
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(PRECACHE_URLS.map(function (u) {
        return new Request(u, { cache: "reload" });
      })).then(function () { return self.skipWaiting(); });
    }).catch(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (k) {
            return k !== CACHE_NAME;
          })
          .map(function (k) {
            return caches.delete(k);
          })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  if (e.request.url.indexOf(self.location.origin) !== 0) return;
  var cacheMatch = caches.match(e.request, { ignoreSearch: true });
  /* Background revalidate when we have a cached response (stale-while-revalidate) */
  var revalidate = cacheMatch.then(function (cached) {
    if (!cached) return Promise.resolve();
    return fetch(e.request).then(function (res) {
      if (res && res.status === 200 && res.type === "basic") {
        return caches.open(CACHE_NAME).then(function (cache) { try { cache.put(e.request, res); } catch (err) {} });
      }
    }).catch(function () {});
  });
  e.waitUntil(revalidate);
  e.respondWith(
    cacheMatch.then(function (cached) {
      if (cached) return cached;
      return fetch(e.request).then(function (res) {
        if (res && res.status === 200 && res.type === "basic") {
          var clone = res.clone();
          caches.open(CACHE_NAME).then(function (cache) { try { cache.put(e.request, clone); } catch (err) {} });
        }
        return res;
      }).catch(function () {
        if (e.request.mode === "navigate") {
          return caches.match("/index.html").then(function (r) { return r || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } }); });
        }
        return new Response("", { status: 503 });
      });
    })
  );
});
