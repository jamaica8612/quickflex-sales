import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");

test("bottom navigation has four notes around Noah; expenses live in 매출노트 and settings behind the gear", () => {
  const nav = html.match(/<nav class="bottom-nav"[\s\S]*?<\/nav>/)?.[0] || "";
  const tabs = [...nav.matchAll(/data-view="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(tabs, ["home", "measurement", "noah", "routes", "stats"]);
  assert.deepEqual([...nav.matchAll(/<span>([^<]+)<\/span>/g)].map((match) => match[1]), ["매출노트", "배송노트", "노아", "구역노트", "정산노트"]);
  assert.doesNotMatch(html, /more-menu|data-view="more"/);
  for (const view of ["home", "expenses"]) {
    const section = html.slice(html.indexOf(`view-${view}"`), html.indexOf("</header>", html.indexOf(`view-${view}"`)));
    assert.match(section, /data-ledger="home"[^>]*>매출</);
    assert.match(section, /data-ledger="expenses"[^>]*>지출</);
  }
  assert.match(main, /querySelectorAll\("\[data-ledger\]"\)[\s\S]*?showView\(button\.dataset\.ledger\)/);
  assert.equal((html.match(/class="tab-settings"[^>]*data-open-settings/g) || []).length, 5);
  assert.match(html, /id="expensesContent"/);
  assert.match(html, /id="noahAskForm"/);
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
