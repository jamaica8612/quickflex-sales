import { enterElement, ENTRY_MOTION } from "./motion.js";
import { createCardMotion } from "./card-motion.js";

// Presentation roles share runners across screens; data and focus update first.
const CARDS = [
  ".stats-driver-report > :is(.stats-report-hero, .stats-report-section, .stats-sparkline-card)",
  ".view-home .summary-card", ".view-home .calendar-panel",
  ".view-home .home-day-overview", ".view-home .selected-date-breakdown", ".view-home .home-route-notes",
  ".measurement-bridge-body > .settings-section",
  ".record-body > :is(.entry-card, .total-card)",
  ".settings-index > .settings-panel > .settings-group",
  ".inspection-body > .inspection-signature-confirm",
].join(",");

export function createViewMotion({
  win = typeof window === "undefined" ? undefined : window,
  doc = typeof document === "undefined" ? undefined : document,
  enter = enterElement,
  cards = createCardMotion({ win, doc }),
} = {}) {
  let screenEffects = [], destroyed = false;
  const overlays = new Map(), disclosures = new Map();
  const run = (node, distance = ENTRY_MOTION.elementDistance) => node ? enter(node, { distance, win, doc }) : () => {};
  const cancelScreen = () => { screenEffects.forEach(cancel => cancel()); screenEffects = []; };
  const cancelFor = (map, key) => { map.get(key)?.(); map.delete(key); };
  const prepare = (view) => {
    const nodes = view?.querySelectorAll(CARDS) || [];
    if (!destroyed) cards.prepare(nodes);
    return nodes;
  };
  const toggle = (event) => {
    const details = event.target;
    if (destroyed || !details?.matches?.(".settings-group")) return;
    cancelFor(disclosures, details);
    // Drop detached detail nodes retained from a previous dynamic render.
    for (const [node] of disclosures) if (node.isConnected === false) cancelFor(disclosures, node);
    if (details.open) disclosures.set(details, run(details.querySelector(":scope > .settings-group-content"), ENTRY_MOTION.disclosureDistance));
  };
  doc?.addEventListener?.("toggle", toggle, true);
  return {
    prepare,
    show(view, previousView) {
      if (destroyed || !view || view === previousView) return;
      cancelScreen();
      const cardNodes = prepare(view);
      cards.enter(cardNodes);
      const header = view.querySelector(":scope > header");
      const heading = header?.querySelector?.(":scope > .tab-head") || header;
      screenEffects.push(run(heading, ENTRY_MOTION.headerDistance));
      // Never move a card and its parent together. Map positioning and chat
      // scrolling keep their own coordinate systems as well.
      if (!cardNodes.length && !view.matches(".view-stats, .view-routes, .view-noah")) {
        screenEffects.push(run(view.querySelector(":scope > main")));
      }
    },
    modal(layer, open) {
      if (destroyed || !layer) return;
      if (open && overlays.has(layer)) return;
      cancelFor(overlays, layer);
      if (open) overlays.set(layer, run(layer.querySelector(".modal-card")));
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelScreen();
      for (const [layer] of overlays) cancelFor(overlays, layer);
      for (const [details] of disclosures) cancelFor(disclosures, details);
      cards.destroy();
      doc?.removeEventListener?.("toggle", toggle, true);
    },
  };
}
