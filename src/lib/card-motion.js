import { ENTRY_MOTION } from "./motion.js";

// Presentation only: stage unseen cards before entry; never hide a visible card.
export function createCardMotion({
  win = typeof window === "undefined" ? undefined : window,
  doc = typeof document === "undefined" ? undefined : document,
} = {}) {
  const cards = new Set(), seen = new Set(), running = new Set(), entered = new Set();
  const pending = "ui-card-pending", entering = "ui-card-entering";
  let destroyed = false, observer = null, media = null;
  try { media = win?.matchMedia?.("(prefers-reduced-motion: reduce)"); } catch { /* Static fallback. */ }
  const inViewport = (card, edge = 1) => {
    const r = card.getBoundingClientRect();
    return !card.hidden && r.bottom > r.top && r.bottom > 0 && r.top < (win?.innerHeight || 0) * edge;
  };
  const settle = (card) => {
    running.delete(card); seen.add(card); observer?.unobserve?.(card);
    card.classList.remove(pending, entering);
    if (card.style) card.style.animationDelay = "";
  };
  const release = (card) => {
    observer?.unobserve?.(card);
    card.removeEventListener?.("animationend", finish);
    card.removeEventListener?.("animationcancel", finish);
    running.delete(card); seen.delete(card); cards.delete(card); entered.delete(card);
    card.classList.remove(pending, entering);
    if (card.style) card.style.animationDelay = "";
  };
  const prune = () => {
    for (const card of cards) if (card.isConnected === false) release(card);
  };
  const reveal = (card) => {
    if (!cards.has(card)) return;
    if (card.isConnected === false) return release(card);
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
    if (event.animationName === "ui-card-rise" && running.has(event.target)) settle(event.target);
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
      prune();
      for (const card of elements || []) {
        if (!card || card.isConnected === false || cards.has(card)) continue;
        // display:contents has no observer box; hiding it also hides its
        // children (including fixed actions), so it must never be staged.
        try { if (win?.getComputedStyle?.(card)?.display === "contents") continue; } catch { /* Optional style lookup. */ }
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
    // Explicit navigation enters a visible card the first time only; later visits
    // and refreshes leave it still. Cards entering together are staggered.
    // The visible card goes straight to its spring, without opacity-zero staging.
    enter(elements) {
      if (destroyed) return;
      prune();
      let slot = 0;
      for (const card of elements || []) {
        if (!card || !cards.has(card)) continue;
        if (!observer || media?.matches) { settle(card); continue; }
        if (card.hidden || doc?.hidden) {
          if (running.has(card)) settle(card);
          continue;
        }
        if (!inViewport(card) || running.has(card) || entered.has(card)) continue;
        if (doc?.activeElement && card.contains(doc.activeElement)) { settle(card); continue; }
        entered.add(card);
        seen.add(card);
        if (card.style) card.style.animationDelay = `${Math.min(slot, ENTRY_MOTION.staggerSlots - 1) * ENTRY_MOTION.staggerMs}ms`;
        slot += 1;
        observer.unobserve?.(card);
        card.classList.remove(pending);
        card.classList.add(entering);
        running.add(card);
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cards.forEach((card) => {
        release(card);
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
