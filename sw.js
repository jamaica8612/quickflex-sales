const CACHE_NAME = "quickflex-shell-v1.0.102-usage-guide-1";
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
  "./src/lib/motion.js",
  "./src/lib/expenses.js",
  "./src/services/expenses.js",
  "./src/ui/expenses.js",
  "./src/ui/noah.js?v=6",
  "./src/services/noah.js",
  "./src/lib/noah-legacy-storage.js",
  "./src/lib/noah-links.js",
  "./src/lib/noah-brief.js",
  "./src/lib/noah-thinking.js",
  "./src/ui/noah-keyboard.js",
  "./src/ui/noah-refresh-guard.js",
  "./src/ui/native-pull-refresh.js",
  "./assets/noah/noah-avatar-v1.webp",
  "./styles/noah.css?v=6",
  "./src/lib/route-notes.js?v=3",
  "./src/lib/route-note-icons.js?v=3",
  "./src/lib/agricultural-market-route-map.js?v=2",
  "./assets/data/agricultural-market-route-map-cells.json",
  "./assets/data/agricultural-market-annexes.json",
  "./assets/icons/route-notes/phosphor-regular.svg",
  "./assets/icons/route-notes/LICENSE.txt",
  "./src/lib/route-note-rules.js",
  "./src/lib/route-note-map-geometry.js?v=3",
  "./src/lib/route-note-zone-model.js",
  "./src/ui/route-note-zone-editor.js?v=8",
  "./styles/route-note-zone-editor.css?v=3",
  "./styles/route-note-map.css?v=7",
  "./src/lib/route-note-map.js?v=10",
  "./src/services/route-notes.js?v=3",
  "./src/ui/route-notes.js?v=16",
  "./src/services/route-note-share.js",
  "./src/ui/route-note-share.js",
  "./styles/route-notes.css?v=10",
  "./styles/agricultural-market-route-map.css?v=2",
  "./styles/route-note-share.css?v=1",
  "./route-share.html",
  "./route-share.js?v=1.0.102",
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
  "./src/services/admin-insights.js",
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
  "./src/lib/period-fallback.js",
  "./src/lib/revenue.js",
  "./src/lib/format.js",
  "./src/lib/work-date.js?v=1.0.102",
  "./src/lib/measurement-app-launch.js",
  "./manifest.webmanifest?v=1.0.102",
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
