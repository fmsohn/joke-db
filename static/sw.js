// Stagetime PWA Service Worker – works at root or subpath (e.g. GitHub Pages)
var CACHE_NAME = "stagetime-v2";
var BASE = self.location.pathname.replace(/\/[^/]*$/, "/") || "/";

function fullUrl(path) {
  var p = path ? (path.indexOf("/") === 0 ? path.slice(1) : path) : "";
  return self.location.origin + (BASE + p).replace(/\/+/g, "/");
}

var SHELL = [
  "",
  "index.html",
  "css/style.css",
  "js/local-db.js",
  "js/data-layer.js",
  "js/app.js",
  "manifest.json",
  "logo.png"
].map(function (path) {
  return fullUrl(path);
});

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return Promise.allSettled(SHELL.map(function (url) {
        return cache.add(new Request(url, { cache: "reload" }));
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isAppRequest(pathname) {
  if (pathname === "/" || pathname === BASE || pathname === BASE.replace(/\/$/, "")) return true;
  if (pathname === "/index.html" || pathname === BASE + "index.html") return true;
  if (pathname.indexOf("/css/") === 0 || pathname.indexOf(BASE + "css/") === 0) return true;
  if (pathname.indexOf("/js/") === 0 || pathname.indexOf(BASE + "js/") === 0) return true;
  if (pathname === "/manifest.json" || pathname === BASE + "manifest.json") return true;
  if (pathname.indexOf("/icons/") === 0 || pathname.indexOf(BASE + "icons/") === 0) return true;
  if (pathname === "/logo.png" || pathname === BASE + "logo.png") return true;
  return false;
}

function getAppShellResponse(cache) {
  return cache.match(fullUrl("index.html"))
    .then(function (r) { return r || cache.match(fullUrl("")); });
}

self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  var u = new URL(e.request.url);
  if (u.origin !== self.location.origin) return;
  if (!isAppRequest(u.pathname)) return;

  e.respondWith(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.match(e.request, { ignoreSearch: true }).then(function (cached) {
        if (cached) return cached;
        if (e.request.mode === "navigate") {
          return getAppShellResponse(cache).then(function (shell) {
            if (shell) return shell;
            return fetch(e.request).then(function (res) {
              if (res && res.ok && res.type === "basic") {
                try { cache.put(e.request, res.clone()); } catch (err) {}
              }
              return res;
            });
          });
        }
        return fetch(e.request).then(function (res) {
          if (res && res.status === 200 && res.type === "basic") {
            try { cache.put(e.request, res.clone()); } catch (err) {}
          }
          return res;
        }).catch(function () {
          return cache.match(e.request, { ignoreSearch: true }).then(function (c2) {
            if (c2) return c2;
            if (e.request.mode === "navigate") return getAppShellResponse(cache);
            return new Response("Offline", { status: 503, statusText: "Service Unavailable", headers: new Headers({ "Content-Type": "text/plain" }) });
          });
        });
      });
    })
  );
});
