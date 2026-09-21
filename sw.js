const CACHE_NAME = "quickflex-shell-v1.0.85-native-session-recovery-1-usage-guide-1-route-notes-2";
const SHELL_FILES = [
  "./src/vendor/supabase-2.116.0.js",
  "./",
  "./index.html",
  "./styles/startup.css?v=3",
  "./src/startup.js",
  "./assets/fonts/flexnote-startup-regular.woff",
  "./assets/fonts/flexnote-startup-semibold.woff",
  "./install.html",
  "./guide.html",
  "./assets/usage-guide/flexnote-symbol.svg",
  "./assets/usage-guide/pace.png",
  "./assets/usage-guide/finish.png",
  "./assets/usage-guide/edit.png",
  "./assets/install-a34/accessibility-main.png",
  "./assets/install-a34/accessibility-permission.png",
  "./assets/install-a34/accessibility-service.png",
  "./assets/install-a34/app-info.png",
  "./assets/install-a34/install-complete.png",
  "./assets/install-a34/install-confirm.png",
  "./assets/install-a34/play-protect-confirm.png",
  "./assets/install-a34/play-protect-off.png",
  "./assets/install-a34/play-protect-restored.png",
  "./assets/install-a34/play-protect.png",
  "./assets/install-a34/unknown-source.png",
  "./assets/install-a34/unsafe-app-details.png",
  "./assets/install-a34/unsafe-app.png",
  "./assets/flexnote-android-icon.png",
  "./intro.html",
  "./privacy.html",
  "./account-deletion.html",
  "./styles.css",
  "./assets/fonts/PretendardVariable.woff2",
  "./assets/fonts/WantedSansVariable.woff2",
  "./app.js",
  "./src/main.js",
  "./src/lib/expenses.js",
  "./src/services/expenses.js",
  "./src/ui/expenses.js",
  "./src/lib/route-notes.js",
  "./src/lib/route-note-map.js?v=3",
  "./src/services/route-notes.js",
  "./src/ui/route-notes.js?v=4",
  "./src/services/route-note-share.js",
  "./src/ui/route-note-share.js",
  "./styles/route-notes.css?v=4",
  "./styles/route-note-share.css?v=1",
  "./route-share.html",
  "./route-share.js?v=1.0.85",
  "./src/lib/export-records.js",
  "./src/ui/exports.js",
  "./src/lib/calendar-sync.js",
  "./src/ui/calendar-sync.js",
  "./styles/expenses.css",
  "./styles/exports.css",
  "./styles/calendar-sync.css",
  "./src/config.js",
  "./src/config.js?v=11",
  "./src/state.js",
  "./src/services/auth.js",
  "./src/services/beta-access.js",
  "./src/services/db.js",
  "./src/services/usage.js",
  "./src/ui/calendar.js",
  "./src/ui/inspection.js",
  "./src/ui/record.js",
  "./src/ui/stats.js",
  "./src/ui/settings.js",
  "./src/ui/account-deletion.js",
  "./src/ui/admin.js",
  "./src/ui/ocr.js",
  "./src/lib/date.js",
  "./src/lib/route.js",
  "./src/lib/stats-report.js",
  "./src/lib/stats-insights.js",
  "./src/lib/revenue.js",
  "./src/lib/format.js",
  "./src/lib/work-date.js",
  "./src/lib/measurement-app-launch.js",
  "./manifest.webmanifest?v=1.0.85",
  "./icon-192.png?v=4",
  "./icon-512.png?v=4",
  "./icon-maskable-192.png?v=4",
  "./icon-maskable-512.png?v=4",
  "./apple-touch-icon.png?v=4",
  "./favicon-32.png?v=4",
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
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)));
        }
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true })),
  );
});
