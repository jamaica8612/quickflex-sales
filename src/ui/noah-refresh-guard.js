// 안드로이드 앱의 "당겨서 새로고침"은 웹 페이지가 맨 위에 있을 때만 시작한다.
// 노아 화면은 대화창 안쪽만 스크롤하므로 페이지가 늘 맨 위라서, 대화를 올리려다
// 새로고침되어 메모리에만 있는 대화가 사라진다. 노아 화면에서는 페이지를 1px 내려 둔다.
const GUARD_CLASS = "noah-refresh-guard";
const GUARD_OFFSET = 1;

export function isNativeShell(win) {
  return typeof win?.QuickFlexNative?.postMessage === "function"
    || /QuickFlexMerged\//.test(String(win?.navigator?.userAgent || ""));
}

export function bindNoahRefreshGuard({ app, win }) {
  if (!app || !win || !isNativeShell(win)) return () => {};
  const root = win.document?.documentElement;
  if (!root) return () => {};
  let active = false;
  const keepOffset = () => {
    if (active && win.scrollY < GUARD_OFFSET) win.scrollTo(0, GUARD_OFFSET);
  };
  function sync() {
    const next = app.dataset.view === "noah";
    if (next === active) return;
    active = next;
    root.classList.toggle(GUARD_CLASS, active);
    if (active) win.requestAnimationFrame(keepOffset);
    else if (win.scrollY <= GUARD_OFFSET) win.scrollTo(0, 0);
  }
  const observer = new win.MutationObserver(sync);
  observer.observe(app, { attributes: true, attributeFilter: ["data-view"] });
  win.addEventListener("scroll", keepOffset, { passive: true });
  sync();
  return () => {
    observer.disconnect();
    win.removeEventListener("scroll", keepOffset);
    root.classList.remove(GUARD_CLASS);
    active = false;
  };
}

export const NOAH_REFRESH_GUARD_OFFSET = GUARD_OFFSET;
