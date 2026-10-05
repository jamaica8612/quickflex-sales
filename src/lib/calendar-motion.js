import { createAnimationGroup, SPRING_FADE, shouldAnimate, cancelFade } from "./motion.js";

const clamp = (value) => Math.max(0, Math.min(1, value));
const selectionPanels = new WeakMap();

/** Logical period direction, including a December/January boundary. */
export function calendarPeriodDirection(previous, next) {
  const ordinal = (key) => {
    const match = /^(\d{4})-(\d{1,2})$/.exec(String(key || ""));
    const month = Number(match?.[2]);
    return match && month >= 1 && month <= 12 ? Number(match[1]) * 12 + month : null;
  };
  const before = ordinal(previous), after = ordinal(next);
  return before === null || after === null ? 0 : Math.sign(after - before);
}

/** Row delay lives inside one spring, so no delayed callback can outlive a render. */
export function calendarRowProgress(progress, row, rowCount) {
  const delay = Math.max(0, row) * 0.045;
  const totalDelay = Math.max(0, rowCount - 1) * 0.045;
  return clamp(progress * (1 + totalDelay) - delay);
}

function environment(node, options) {
  const doc = options.doc ?? node?.ownerDocument ?? globalThis.document;
  const win = options.win ?? doc?.defaultView ?? globalThis.window;
  return { win, doc };
}

/**
 * Paint every selected-date field synchronously. Only presentation follows
 * afterward; a interrupted fade never owns an old date's paint callback.
 */
export function paintCalendarSelection(elements, key, paint, options = {}) {
  const nodes = (elements || []).filter(Boolean);
  // On phones homeDayPanel is display:contents. Animate the dock's actual
  // box there, while the wide layout can move its whole selected-day panel.
  const panel = nodes.find((node) => {
    try { return node.ownerDocument?.defaultView?.getComputedStyle(node)?.display !== "contents"; }
    catch { return true; }
  }) || nodes[0];
  nodes.forEach(cancelFade);
  paint();
  if (!panel) return;
  const { win, doc } = environment(panel, options);
  let entry = selectionPanels.get(panel);
  if (!entry) {
    entry = { key, progress: 1, group: createAnimationGroup() };
    selectionPanels.set(panel, entry);
    return;
  }
  const changed = entry.key !== key;
  // A later date slides in from the right, an earlier one from the left; other changes rise.
  const dateOf = (value) => /^(d{4}-d{2}-d{2})(?::|$)/.exec(String(value || ""))?.[1] || "";
  const before = dateOf(entry.key), after = dateOf(key);
  const direction = before && after && before !== after ? (after > before ? 1 : -1) : 0;
  entry.key = key;
  const finish = () => {
    panel.style.transform = "";
    panel.style.opacity = "";
    panel.classList.remove("is-calendar-selection-moving");
    entry.progress = 1;
  };
  if (!changed || !shouldAnimate({ win, doc })) {
    entry.group.cancelAll();
    finish();
    return;
  }
  if (!entry.group.isRunning("selection")) entry.progress = 0;
  panel.classList.add("is-calendar-selection-moving");
  const place = (progress) => {
    entry.progress = progress;
    panel.style.transform = direction
      ? `translateX(${(direction * (1 - progress) * 10).toFixed(2)}px)`
      : `translateY(${(1 - progress) * 6}px)`;
    panel.style.opacity = String(0.86 + progress * 0.14);
  };
  place(entry.progress);
  entry.group.run("selection", entry.progress, 1, {
    ...SPRING_FADE, stiffness: 760, win, doc, onUpdate: place, onDone: finish,
  });
}

/** Thin presentation controller; records, quantities and selected dates stay in main.js. */
export function createCalendarMotion(container, options = {}) {
  const { win, doc } = environment(container, options);
  const ringGroup = createAnimationGroup();
  const entryGroup = createAnimationGroup();
  const ring = doc.createElement("div");
  ring.className = "day-selection-ring";
  ring.setAttribute("aria-hidden", "true");
  ring.setAttribute("inert", "");
  const position = { x: 0, y: 0 };
  let ringPlaced = false;
  let lastPeriod = null;
  let lastMode = null;
  let focusedDate = null;
  let pressed = null;
  let cells = [];
  let direction = 0;

  const clearPress = () => {
    pressed?.classList.remove("is-calendar-pressed");
    pressed = null;
  };
  const press = (event) => {
    if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
    const cell = event.target?.closest?.(".day-cell");
    if (!cell || !container.contains(cell)) return;
    clearPress();
    pressed = cell;
    cell.classList.add("is-calendar-pressed");
  };
  container.addEventListener("pointerdown", press);
  container.addEventListener("keydown", press);
  container.addEventListener("keyup", clearPress);
  container.addEventListener("focusout", clearPress);
  doc.addEventListener("pointerup", clearPress);
  doc.addEventListener("pointercancel", clearPress);

  const clearEntry = () => {
    container.style.transform = "";
    container.style.opacity = "";
    container.classList.remove("is-calendar-entering");
    cells.forEach((cell) => {
      cell.style.removeProperty("--calendar-row-y");
      cell.style.removeProperty("--calendar-row-opacity");
    });
  };
  const placeRing = () => {
    ring.style.transform = `translate(${position.x}px, ${position.y}px)`;
  };
  const syncRing = (animate) => {
    const cell = container.querySelector(".day-cell.selected");
    if (!cell) {
      ringGroup.cancelAll();
      ring.style.opacity = "0";
      ringPlaced = false;
      return;
    }
    const bounds = container.getBoundingClientRect();
    const selected = cell.getBoundingClientRect();
    if (bounds.width <= 0 || selected.width <= 0 || selected.height <= 0) {
      ringGroup.cancelAll();
      ring.style.opacity = "0";
      ringPlaced = false;
      return;
    }
    const target = { x: selected.left - bounds.left, y: selected.top - bounds.top };
    ring.style.width = `${selected.width}px`;
    ring.style.height = `${selected.height}px`;
    ring.style.opacity = "1";
    if (!animate || !ringPlaced || !shouldAnimate({ win, doc })) {
      ringGroup.cancelAll();
      Object.assign(position, target);
      ringPlaced = true;
      placeRing();
      return;
    }
    // createAnimationGroup retargets the live x/y springs in place, keeping
    // both their presentation positions and velocity on a rapid new choice.
    for (const axis of ["x", "y"]) {
      if (Math.abs(position[axis] - target[axis]) < 0.01 && !ringGroup.isRunning(axis)) continue;
      ringGroup.run(axis, position[axis], target[axis], {
        ...SPRING_FADE, stiffness: 620, win, doc, priority: 2,
        onUpdate: (value) => { position[axis] = value; placeRing(); },
      });
    }
  };

  function beforeRender() {
    focusedDate = container.contains(doc.activeElement)
      ? doc.activeElement?.getAttribute?.("data-calendar-date") : null;
    entryGroup.cancelAll();
    clearEntry();
    clearPress();
  }

  function afterRender({ periodKey, mode } = {}) {
    const samePeriod = lastPeriod === periodKey;
    const modeChanged = lastMode !== null && lastMode !== mode;
    const shouldEnter = lastPeriod === null || !samePeriod || modeChanged;
    direction = calendarPeriodDirection(lastPeriod, periodKey);
    lastPeriod = periodKey;
    lastMode = mode;
    cells = [...container.querySelectorAll(".day-cell")];
    container.appendChild(ring);
    syncRing(samePeriod);
    if (focusedDate) {
      const focus = cells.find((cell) => cell.getAttribute("data-calendar-date") === focusedDate)
        || container.querySelector(".day-cell.selected");
      focus?.focus?.({ preventScroll: true });
      focusedDate = null;
    }
    if (modeChanged) options.onModeChange?.();
    if (!shouldEnter || container.getBoundingClientRect().width <= 0 || !shouldAnimate({ win, doc })) {
      clearEntry();
      return;
    }
    container.classList.add("is-calendar-entering");
    const rows = Math.ceil(cells.length / 7);
    const distance = direction ? 38 : 0;
    const place = (progress) => {
      container.style.transform = `translateX(${direction * distance * (1 - progress)}px)`;
      cells.forEach((cell, index) => {
        const phase = calendarRowProgress(progress, Math.floor(index / 7), rows);
        cell.style.setProperty("--calendar-row-y", `${(1 - phase) * (modeChanged ? 4 : 9)}px`);
        cell.style.setProperty("--calendar-row-opacity", String(0.2 + 0.8 * phase));
      });
    };
    place(0);
    entryGroup.run("entry", 0, 1, {
      ...SPRING_FADE, stiffness: 500, win, doc, onUpdate: place, onDone: clearEntry,
    });
  }

  const resize = () => syncRing(false);
  win?.addEventListener?.("resize", resize);
  const resizeObserver = typeof win?.ResizeObserver === "function" ? new win.ResizeObserver(resize) : null;
  resizeObserver?.observe(container);
  return {
    beforeRender, afterRender,
    dispose() {
      ringGroup.cancelAll(); entryGroup.cancelAll(); clearEntry(); clearPress(); ring.remove();
      container.removeEventListener("pointerdown", press);
      container.removeEventListener("keydown", press);
      container.removeEventListener("keyup", clearPress);
      container.removeEventListener("focusout", clearPress);
      doc.removeEventListener("pointerup", clearPress);
      doc.removeEventListener("pointercancel", clearPress);
      win?.removeEventListener?.("resize", resize);
      resizeObserver?.disconnect();
    },
  };
}
