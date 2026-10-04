// Presentation only: stage unseen cards before entry; never hide a visible card.
export function createStatsCardMotion({
  win = typeof window === "undefined" ? undefined : window,
  doc = typeof document === "undefined" ? undefined : document,
} = {}) {
  const cards = new Set(), seen = new Set(), running = new Set();
  const pending = "stats-card-pending", entering = "stats-card-entering";
  let destroyed = false, observer = null, media = null;
  try { media = win?.matchMedia?.("(prefers-reduced-motion: reduce)"); } catch { /* Static fallback. */ }
  const inViewport = (card, edge = 1) => {
    const r = card.getBoundingClientRect();
    return !card.hidden && r.bottom > r.top && r.bottom > 0 && r.top < (win?.innerHeight || 0) * edge;
  };
  const settle = (card) => {
    running.delete(card); seen.add(card); observer?.unobserve?.(card);
    card.classList.remove(pending, entering);
  };
  const reveal = (card) => {
    if (destroyed || seen.has(card) || card.hidden || doc?.hidden) return;
    seen.add(card); observer?.unobserve?.(card);
    if (media?.matches || !card.classList.contains(pending)) return settle(card);
    card.classList.add(entering);
    card.classList.remove(pending);
    running.add(card);
  };
  try {
    if (typeof win?.IntersectionObserver === "function") observer = new win.IntersectionObserver((entries) => {
      if (!destroyed) entries.forEach((entry) => { if (entry.isIntersecting) reveal(entry.target); });
    }, { threshold: .01, rootMargin: "0px 0px -4% 0px" });
  } catch { /* A missing observer must never leave content hidden. */ }
  const finish = (event) => {
    if (event.animationName === "stats-card-rise" && running.has(event.target)) settle(event.target);
  };
  const visibilityChanged = () => {
    if (doc?.hidden) [...running].forEach(settle);
    else cards.forEach((card) => { if (!seen.has(card) && inViewport(card, .96)) reveal(card); });
  };
  const preferenceChanged = () => { if (media?.matches) cards.forEach(settle); };
  const focused = (event) => {
    for (const card of cards) if (card.contains(event.target)) { settle(card); break; }
  };
  doc?.addEventListener?.("visibilitychange", visibilityChanged);
  doc?.addEventListener?.("focusin", focused);
  if (media?.addEventListener) media.addEventListener("change", preferenceChanged);
  else media?.addListener?.(preferenceChanged);
  return {
    prepare(elements) {
      if (destroyed) return;
      for (const card of elements || []) {
        if (!card || cards.has(card)) continue;
        cards.add(card);
        card.addEventListener?.("animationend", finish);
        card.addEventListener?.("animationcancel", finish);
        if (!observer || media?.matches || card.hidden || inViewport(card)) settle(card);
        else {
          card.classList.add(pending);
          try { observer.observe(card); } catch { settle(card); }
        }
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cards.forEach((card) => {
        settle(card);
        card.removeEventListener?.("animationend", finish);
        card.removeEventListener?.("animationcancel", finish);
      });
      observer?.disconnect?.();
      doc?.removeEventListener?.("visibilitychange", visibilityChanged);
      doc?.removeEventListener?.("focusin", focused);
      if (media?.removeEventListener) media.removeEventListener("change", preferenceChanged);
      else media?.removeListener?.(preferenceChanged);
      cards.clear(); seen.clear(); running.clear();
    },
  };
}
