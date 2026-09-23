import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");

test("bottom navigation exposes the four note screens while More retains statistics and administration", () => {
  const nav = html.match(/<nav class="bottom-nav"[\s\S]*?<\/nav>/)?.[0] || "";
  const tabs = [...nav.matchAll(/data-view="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(tabs, ["home", "measurement", "routes", "more"]);
  assert.match(html, /class="nav-tab" data-view="routes"/);
  assert.match(html, /data-open-expenses/);
  assert.match(html, /data-open-stats/);
  assert.match(html, /id="expensesContent"/);
  assert.match(html, /data-open-settings/);
  assert.match(html, />매출노트</);
  assert.match(html, />배송노트</);
  assert.match(html, />구역노트</);
  assert.match(html, />더보기</);
  assert.match(html, /id="memberSettings"/);
  assert.match(html, /id="bundleSettings"/);
  assert.doesNotMatch(html, /data-view="admin"/);
});

test("finance surface uses the owner-scoped expense service and canonical export snapshot", () => {
  assert.match(main, /import \{ createExpenseService \} from "\.\/services\/expenses\.js"/);
  assert.match(main, /import \{ createExportsController \} from "\.\/ui\/exports\.js"/);
  assert.match(main, /function ownExpenseService\(\)[\s\S]*?requireFinanceAccount\(context\)/);
  assert.match(main, /ownExpenseService\(\)\.list\(\{ from, to, includeDrafts: true \}\)/);
  assert.match(main, /statsDailyRecords\(\)\.filter/);
  assert.match(main, /receiptUrl\(receipt\)/);
});

test("offline shell caches every finance module and stylesheet", () => {
  for (const path of ["./src/services/expenses.js", "./src/lib/expenses.js", "./src/ui/expenses.js", "./src/ui/exports.js", "./styles/expenses.css", "./styles/exports.css"]) {
    assert.match(sw, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${path} must be precached`);
  }
});
