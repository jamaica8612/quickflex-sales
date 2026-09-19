/* Runs before the app modules: a failed CDN/module must never leave an endless splash. */
(() => {
  const root = document.documentElement;
  const splash = document.getElementById("startupSplash");
  const status = document.getElementById("startupStatus");
  const retry = document.getElementById("startupRetry");
  // One entrance per launch, never the same one twice in a row. Storage may be unavailable; any choice is fine then.
  const motions = ["brake", "arrive", "build", "sheen"];
  const motionKey = "flexnote-startup-motion";
  let lastMotion = null;
  try { lastMotion = window.localStorage.getItem(motionKey); } catch (_) {}
  const motionPool = motions.filter((name) => name !== lastMotion);
  const motion = motionPool[Math.floor(Math.random() * motionPool.length)];
  splash.setAttribute("data-motion", motion);
  try { window.localStorage.setItem(motionKey, motion); } catch (_) {}
  const started = performance.now();
  let settled = false;
  let timeout;
  function fail() {
    if (settled) return false;
    clearTimeout(timeout);
    splash.setAttribute("data-error", "");
    splash.setAttribute("aria-busy", "false");
    status.setAttribute("data-error", "");
    status.textContent = "화면을 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.";
    retry.hidden = false;
    return true;
  }
  function finish() {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTimeout(() => {
      const app = document.getElementById("app");
      root.removeAttribute("data-startup");
      app?.removeAttribute("inert");
      app?.removeAttribute("aria-hidden");
      splash.setAttribute("data-leaving", "");
      splash.setAttribute("aria-hidden", "true");
      splash.setAttribute("inert", "");
      setTimeout(() => { splash.hidden = true; }, reduced ? 0 : 160);
      window.requestAnimationFrame(() => {
        const active = app?.querySelector('.overlay.visible:not([inert])');
        const target = active?.querySelector('input:not([disabled]),button:not([disabled]),[role="dialog"]');
        if (target && !target.closest("[inert]")) target.focus({ preventScroll: true });
      });
    }, reduced ? 0 : Math.max(0, 760 - (performance.now() - started)));
  }
  retry.addEventListener("click", () => window.location.reload());
  retry.hidden = true;
  timeout = setTimeout(fail, 15000);
  window.FlexNoteStartup = Object.freeze({ finish, fail });
})();
