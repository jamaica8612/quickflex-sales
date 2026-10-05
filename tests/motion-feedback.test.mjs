import assert from "node:assert/strict";
import test from "node:test";

import { collapseOut, markSaved } from "../src/lib/motion.js";

test("collapseOut resolves at once when the row cannot animate", async () => {
  let animated = false;
  const row = { animate() { animated = true; } };
  await collapseOut(row, { win: { matchMedia: () => ({ matches: true }), requestAnimationFrame() {} }, doc: { hidden: false } });
  assert.equal(animated, false, "reduced motion removes the row without folding it");
  await collapseOut(null);
});

test("markSaved shows one check beside the button and removes it", async () => {
  const children = [];
  const doc = { createElement: () => ({ className: "", textContent: "", setAttribute() {}, remove() { children.splice(children.indexOf(this), 1); } }) };
  const button = { isConnected: true, append: (node) => children.push(node), querySelector: () => children.find((node) => node.className === "save-tick") || null };
  markSaved(button, { doc, duration: 5 });
  markSaved(button, { doc, duration: 5 });
  assert.equal(children.length, 1, "a second save replaces the check instead of stacking");
  assert.equal(children[0].textContent, "✓");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(children.length, 0);
});
