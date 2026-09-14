// Browser fixture uses production HTML/CSS but never executes account/API modules.
// Tests the actual guide, normal link navigation and real service-worker precaching.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/jamai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'artifacts/usage-guide');
mkdirSync(out, { recursive: true });
const appHtml = readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
const worker = readFileSync(path.join(root, 'sw.js'), 'utf8');
const shell = vm.runInNewContext(worker.match(/const SHELL_FILES = (\[[\s\S]*?\]);/)[1]);
const allowed = new Set(shell.map(file => new URL(file, 'http://localhost/quickflex-sales/').pathname));
allowed.add('/quickflex-sales/sw.js');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET' || !allowed.has(url.pathname)) { res.writeHead(404); res.end(); return; }
  const name = url.pathname.slice('/quickflex-sales/'.length) || 'index.html';
  const body = name === 'index.html' ? appHtml : readFileSync(path.join(root, name));
  res.writeHead(200, { 'Content-Type': mime[path.extname(name)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const base = origin + '/quickflex-sales/';
let browser;
const checks = [], errors = [];
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  // App stylesheet has remote font imports. Fulfill only those with empty CSS;
  // any other non-local request is rejected, so no production data is accessed.
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' });
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  const reveal = async (view, theme) => page.evaluate(({ view, theme }) => {
    document.documentElement.dataset.theme = theme;
    document.body.dataset.theme = theme;
    const app = document.getElementById('app');
    app.dataset.view = view;
    document.querySelectorAll('.overlay').forEach(el => { el.classList.remove('visible'); el.setAttribute('inert', ''); });
    document.getElementById('measurementRouteText').textContent = '316C · 316D';
    document.getElementById('measurementWorkDate').value = '2026-09-14';
  }, { view, theme });
  for (const theme of ['light', 'dark']) {
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      for (const view of ['measurement', 'settings']) {
        await reveal(view, theme);
        const link = page.locator(`.view-${view} a[href="./guide.html"]`);
        assert.equal(await link.evaluate(el => el.closest('details')), null, 'Guide entry should not be hidden in a collapsed group');
        await link.scrollIntoViewIfNeeded();
        const box = await link.boundingBox();
        assert(box && box.height >= 44, `${view} target at ${width}/${theme}`);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `overflow ${view}/${width}/${theme}`);
        await link.focus();
        assert.equal(await link.evaluate(el => el === document.activeElement), true);
        checks.push(`${view} ${width}px ${theme}: visible, >=44px, focusable, no overflow`);
        if (width === 390) await page.screenshot({ path: path.join(out, `${view}-${theme}-390.png`) });
      }
    }
  }
  for (const view of ['measurement', 'settings']) {
    await reveal(view, 'light');
    const popupPromise = page.waitForEvent('popup');
    await page.locator(`.view-${view} a[href="./guide.html"]`).click();
    const guidePage = await popupPromise;
    await guidePage.waitForLoadState();
    assert.equal(new URL(guidePage.url()).pathname, '/quickflex-sales/guide.html');
    assert.equal(await guidePage.title(), '플렉스노트 사용법');
    assert.equal(await guidePage.evaluate(() => window.opener), null);
    assert.equal(await page.locator('#app').getAttribute('data-view'), view);
    assert.equal(await page.locator('#measurementWorkDate').inputValue(), '2026-09-14');
    await guidePage.close();
  }
  // Register production SW on isolated local fixture and await the actual precache.
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('./sw.js');
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  });
  await page.evaluate(async () => {
    const cached = await caches.match('./guide.html');
    if (!cached || !cached.ok) throw new Error('guide not in cache');
  });
  // Disable networking before opening the guide: this also tests cold guide assets.
  await context.setOffline(true);
  await page.goto(base + 'guide.html');
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `guide overflow ${width}`);
    for (const name of ['pace', 'finish', 'edit']) {
      await page.locator(`[data-image="${name}"]`).click();
      await page.locator('#viewer-image').evaluate(img => img.decode());
      assert.equal(await page.locator('#viewer-image').evaluate(img => img.naturalWidth), 1008);
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => document.activeElement.dataset.image), name);
    }
    checks.push(`guide ${width}px: offline render, all 3 zoom images, Escape/focus return`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.toc a[href="#delivery-list"]').click();
  await page.screenshot({ path: path.join(out, 'guide-offline-390.png') });
  const relativeLinks = await page.locator('.back-link, a[href="./install.html"]').evaluateAll(elements => elements.map(el => el.href));
  assert(relativeLinks.every(url => url.startsWith(base)));
  assert.deepEqual(errors, []);
  writeFileSync(path.join(out, 'checks.json'), JSON.stringify({ checks, errors, scope: 'Isolated HTML/CSS app fixture; real guide/SW. No account, DB or installed-phone test.' }, null, 2));
  console.log(`PASS: ${checks.length} browser checks; source tabs preserved; offline guide and all images loaded.`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
