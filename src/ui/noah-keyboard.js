// 키보드가 올라오면 노아 화면 높이를 보이는 영역에 맞추고 하단 메뉴를 잠깐 숨겨요.
const KEYBOARD_MIN_PX = 120;

export function bindNoahKeyboard({ view, input, win }) {
  const viewport = win?.visualViewport;
  if (!view || !input || !viewport) return () => {};
  const app = view.closest?.(".app") || null;
  const doc = view.ownerDocument;
  let frame = 0;
  function apply() {
    frame = 0;
    const covered = win.innerHeight - viewport.height;
    const open = doc.activeElement === input && covered > KEYBOARD_MIN_PX;
    if (open) {
      view.style.setProperty("--noah-vh", `${Math.round(viewport.height)}px`);
      app?.setAttribute("data-keyboard", "open");
      if (win.scrollY) win.scrollTo(0, 0);
    } else {
      view.style.removeProperty("--noah-vh");
      app?.removeAttribute("data-keyboard");
    }
  }
  function schedule() {
    if (!frame) frame = win.requestAnimationFrame(apply);
  }
  const blur = () => setTimeout(schedule, 60);
  viewport.addEventListener("resize", schedule);
  viewport.addEventListener("scroll", schedule);
  input.addEventListener("focus", schedule);
  input.addEventListener("blur", blur);
  return () => {
    if (frame) win.cancelAnimationFrame(frame);
    viewport.removeEventListener("resize", schedule);
    viewport.removeEventListener("scroll", schedule);
    input.removeEventListener("focus", schedule);
    input.removeEventListener("blur", blur);
    view.style.removeProperty("--noah-vh");
    app?.removeAttribute("data-keyboard");
  };
}
