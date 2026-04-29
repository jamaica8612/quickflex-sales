const CACHE_NAME = "quickflex-shell-v46";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./intro.html",
  "./styles.css",
  "./app.js",
  "./src/main.js",
  "./src/config.js",
  "./src/state.js",
  "./src/services/auth.js",
  "./src/services/db.js",
  "./src/ui/calendar.js",
  "./src/ui/record.js",
  "./src/ui/stats.js",
  "./src/ui/settings.js",
  "./src/ui/admin.js",
  "./src/ui/ocr.js",
  "./src/lib/date.js",
  "./src/lib/route.js",
  "./src/lib/revenue.js",
  "./src/lib/format.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true })),
  );
});
