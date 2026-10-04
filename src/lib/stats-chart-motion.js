import { shouldAnimate } from "./motion.js";

const active = new WeakMap();
const SVG_NS = "http://www.w3.org/2000/svg";
let gradientId = 0;

export function cancelStatsChartDraw(canvas) {
  active.get(canvas)?.();
}

// Geometry is supplied by the existing renderer; this layer never computes
// revenue, filters work records, or changes the chart's accessible summary.
export function chartPaths({ points, baseline }) {
  if (!points?.length) return null;
  let line = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1], b = points[i], middle = (a.x + b.x) / 2;
    line += `C${middle},${a.y} ${middle},${b.y} ${b.x},${b.y}`;
  }
  if (points.length === 1) line += `L${points[0].x + 0.1},${points[0].y}`;
  return { line, area: `${line}L${points.at(-1).x},${baseline}L${points[0].x},${baseline}Z` };
}

export function drawStatsChart(canvas, {
  win = typeof window === "undefined" ? undefined : window,
  doc = typeof document === "undefined" ? undefined : document,
} = {}) {
  cancelStatsChartDraw(canvas);
  const plot = canvas?.__moPlot;
  const paths = plot && chartPaths(plot);
  if (!paths || !canvas.parentNode || !doc?.createElementNS || !shouldAnimate({ win, doc })) return;
  const parent = canvas.parentNode;
  const originalOpacity = canvas.style.opacity;
  let svg = null;
  let media = null;
  let raf = null;
  const animations = [];
  let cleaned = false;
  const safely = (fn) => { try { fn(); } catch { /* A failed effect must not hide the canvas. */ } };
  const finish = () => {
    if (cleaned) return;
    cleaned = true;
    if (raf !== null) safely(() => win.cancelAnimationFrame?.(raf));
    raf = null;
    animations.forEach((animation) => safely(() => animation?.cancel?.()));
    safely(() => svg?.remove());
    if (svg?.parentNode) safely(() => svg.parentNode.removeChild(svg));
    safely(() => { if (canvas.style.opacity === "0") canvas.style.opacity = originalOpacity; });
    if (media?.removeEventListener) safely(() => media.removeEventListener("change", preferenceChanged));
    else safely(() => media?.removeListener?.(preferenceChanged));
    safely(() => doc.removeEventListener?.("visibilitychange", visibilityChanged));
    if (active.get(canvas) === finish) active.delete(canvas);
  };
  const preferenceChanged = () => { if (media?.matches) finish(); };
  const visibilityChanged = () => { if (doc.hidden) finish(); };
  active.set(canvas, finish);
  try {
    svg = doc.createElementNS(SVG_NS, "svg");
    if (typeof svg.animate !== "function") { finish(); return; }
    svg.setAttribute("viewBox", `0 0 ${plot.width} ${plot.height}`);
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.classList.add("stats-chart-trace");
    const id = `stats-trace-${++gradientId}`;
    svg.innerHTML = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${plot.color}" stop-opacity=".14"/><stop offset="1" stop-color="${plot.color}" stop-opacity="0"/></linearGradient></defs><path class="stats-chart-area" d="${paths.area}" fill="url(#${id})"/><path class="stats-chart-line" d="${paths.line}" fill="none" stroke="${plot.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    parent.appendChild(svg);
    const line = svg.querySelector(".stats-chart-line");
    const area = svg.querySelector(".stats-chart-area");
    const length = line.getTotalLength();
    if (!Number.isFinite(length) || length <= 0) { finish(); return; }
    line.style.strokeDasharray = String(length);
    line.style.strokeDashoffset = String(length);
    area.style.opacity = "0";
    media = win.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (media?.addEventListener) media.addEventListener("change", preferenceChanged);
    else media?.addListener?.(preferenceChanged);
    doc.addEventListener?.("visibilitychange", visibilityChanged);
    canvas.style.opacity = "0";
    let completed = 0;
    const track = (animation) => {
      animations.push(animation);
      if (typeof animation?.finished?.then !== "function") throw new Error("Animation completion unavailable");
      // Attach rejection handling immediately: the second animate() call may
      // fail, and cancelling the first then rejects its finished promise.
      animation.finished.then(() => { if (++completed === 2) finish(); }, finish);
    };
    const easing = "cubic-bezier(.2,.8,.2,1)";
    track(line.animate([{ strokeDashoffset: String(length) }, { strokeDashoffset: "0" }], { duration: 900, easing, fill: "both" }));
    track(area.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 600, delay: 350, easing: "ease", fill: "both" }));
    const startedAt = win.performance?.now?.() ?? Date.now();
    const monitor = (now) => {
      raf = null;
      if (cleaned) return;
      if (!shouldAnimate({ win, doc }) || canvas.isConnected === false || canvas.parentNode !== parent
          || svg.parentNode !== parent || now - startedAt >= 950) {
        finish();
        return;
      }
      try { raf = win.requestAnimationFrame(monitor); } catch { finish(); }
    };
    raf = win.requestAnimationFrame(monitor);
  } catch {
    finish();
  }
}
