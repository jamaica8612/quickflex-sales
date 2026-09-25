// Android 앱은 PWA를 당겨서 새로고침(SwipeRefreshLayout) 안에 띄운다. 예전에는 어느 화면에서든
// 페이지를 통째로 다시 열어 입력 중인 내용, 열린 팝업, 노아 대화가 사라졌다.
// 이제 PWA가 "지금 당겨도 되는지"를 알려 주고, 당기면 지금 화면의 데이터만 새로 받는다.
// Android Beta 1.26 이상이 set_pull_refresh / pull_refresh_done을 이해한다. 그보다 오래된 앱은
// 이 메시지를 무시하고 기존처럼 설정의 앱 새로고침 버튼을 누른다.

/** 밖에서 바뀌는 숫자를 보여 주는 화면만 당겨서 새로고침한다. */
export const PULL_REFRESH_VIEWS = Object.freeze(["home", "stats", "measurement"]);

const NON_TEXT_INPUTS = new Set([
  "button", "submit", "reset", "checkbox", "radio", "range", "color", "file", "image", "hidden",
]);

/** 글자를 입력 중인 요소인가. 버튼·체크박스에 초점이 있는 것은 입력 중이 아니다. */
export function isEditingElement(node) {
  if (!node || node.nodeType !== 1) return false;
  if (node.isContentEditable) return true;
  const tag = String(node.tagName || "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  return !NON_TEXT_INPUTS.has(String(node.getAttribute?.("type") || "text").toLowerCase());
}

export function pullRefreshAllowed({ view, signedIn, modalOpen, editing }) {
  return Boolean(signedIn) && PULL_REFRESH_VIEWS.includes(view) && !modalOpen && !editing;
}

export function createNativePullRefresh({
  win = window,
  doc = document,
  getView,
  isSignedIn,
  isModalOpen,
  refresh,
  post,
  notify = () => {},
}) {
  let reported = null;
  let scheduled = false;
  let running = false;

  const allowedNow = () => pullRefreshAllowed({
    view: getView(),
    signedIn: isSignedIn(),
    modalOpen: Boolean(isModalOpen()) || Boolean(doc.querySelector?.("dialog[open]")),
    editing: isEditingElement(doc.activeElement),
  });

  function report() {
    scheduled = false;
    const allowed = allowedNow();
    if (allowed === reported) return;
    reported = allowed;
    post({ type: "set_pull_refresh", enabled: allowed });
  }

  function sync() {
    if (scheduled) return;
    scheduled = true;
    (win.requestAnimationFrame || ((fn) => win.setTimeout(fn, 0)))(report);
  }

  /** The native shell may have reloaded or resumed; send the state again. */
  function reset() {
    reported = null;
    sync();
  }

  // Called by the Android app when the user pulls. Must answer synchronously.
  function handleNativeRefresh() {
    if (!allowedNow()) {
      reset();
      return "blocked";
    }
    if (running) return "handled";
    running = true;
    Promise.resolve()
      .then(refresh)
      .then((ok) => notify(ok !== false), () => notify(false))
      .finally(() => {
        running = false;
        post({ type: "pull_refresh_done" });
      });
    return "handled";
  }

  doc.addEventListener?.("focusin", sync);
  doc.addEventListener?.("focusout", sync);
  // Screen changes set #app[data-view]; popups set <dialog open> or make the page inert/hidden.
  if (typeof win.MutationObserver === "function" && doc.body) {
    new win.MutationObserver(sync).observe(doc.body, {
      subtree: true, attributes: true, attributeFilter: ["open", "data-view", "inert", "hidden"],
    });
  }
  win.quickflexHandleNativeRefresh = handleNativeRefresh;
  sync();

  return { sync, reset, handleNativeRefresh };
}
