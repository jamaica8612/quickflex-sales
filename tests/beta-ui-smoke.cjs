// Isolated UI smoke test: all requests fulfilled from this checkout, no Supabase/production traffic.
const { readFileSync, existsSync, mkdirSync } = require('node:fs');
const { resolve, extname } = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(__dirname, '..');
const main = readFileSync(resolve(root, 'src/main.js'), 'utf8');
const adminFunction = main.slice(main.indexOf('async function renderAdminProfiles()'), main.indexOf('async function saveAdminProfile('));
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const extractElement = (id) => {
  const match = html.match(new RegExp(`<[^>]+id="${id}"[^>]*>[^<]*</[^>]+>`));
  assert.ok(match, id); return match[0];
};
const output = process.env.BETA_UI_OUTPUT;
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.BETA_BROWSER_CHANNEL ? { channel: process.env.BETA_BROWSER_CHANNEL } : {}) });
  try {
    for (const colorScheme of ['light', 'dark']) {
      for (const width of [360, 768]) {
        const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme });
        await page.route('**/*', async (route) => {
          const url = new URL(route.request().url());
          if (url.origin !== 'http://beta.test') return route.abort();
          const path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
          if (!path.startsWith(root + require('node:path').sep) || !existsSync(path)) return route.fulfill({ status: 404, body: '' });
          const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[extname(path)] || 'application/octet-stream';
          return route.fulfill({ status: 200, contentType: type, body: readFileSync(path) });
        });
        await page.goto('http://beta.test/account-deletion.html');
        await page.getByRole('heading', { level: 1, name: '계정 및 데이터 삭제' }).waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
        assert.equal(await page.getByRole('link', { name: 'flexnote2026@gmail.com', exact: true }).count(), 1);
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.tagName), 'A');
        const focus = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
        assert.notEqual(focus, 'none');
        if (output && width === 360) {
          mkdirSync(output, { recursive: true });
          await page.screenshot({ path: resolve(output, `deletion-${colorScheme}.png`), fullPage: true });
        }
        await page.setContent(`<html lang="ko" data-theme="${colorScheme}"><head><link rel="stylesheet" href="http://beta.test/styles.css"></head><body><main style="max-width:700px;padding:16px"><div id="adminProfiles" class="admin-list"></div>${extractElement('requestAccountDelete')}<div id="status" role="status"></div></main></body></html>`);
        await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--panel').trim() !== '');
        await page.evaluate(async ({ adminFunction }) => {
          const el = { adminProfiles: document.querySelector('#adminProfiles') };
          const state = { profile: { role: 'admin' }, db: { rpc: async () => ({ data: [{ id: 'beta-a', display_name: '베타 사용자', status: 'approved', driver_type: 'fixed', fixed_routes: ['232C'], beta_enabled: false }] }) } };
          const captureAccountContext = () => ({ userId: 'admin' });
          const isAccountContextCurrent = () => true;
          const escapeAttr = (s) => String(s).replace(/[&<>"']/g, '');
          const profileNameForDisplay = (profile) => profile.display_name;
          const statusLabel = (status) => status === 'approved' ? '승인' : status;
          await eval(`(${adminFunction})`)();
          const { bindAccountDeletion } = await import('http://beta.test/src/ui/account-deletion.js');
          bindAccountDeletion({ button: document.querySelector('#requestAccountDelete'), state: { profile: { id: 'demo' }, db: { rpc: async () => ({ data: '2026-09-13T12:00:00Z' }) } }, captureAccountContext: () => ({ userId: 'demo' }), isAccountContextCurrent: () => true, ensurePendingSavesFlushed: async () => {}, confirm: () => true, toast: (text) => { document.querySelector('#status').textContent = text; } });
        }, { adminFunction });
        const checkbox = page.getByRole('checkbox', { name: /베타 측정 허용/ });
        await checkbox.check(); assert.equal(await checkbox.isChecked(), true);
        await checkbox.focus(); await page.keyboard.press('Space'); assert.equal(await checkbox.isChecked(), false);
        await page.getByRole('button', { name: '탈퇴 요청', exact: true }).click();
        await page.getByRole('status').filter({ hasText: '아직 삭제된 기록은 없으며' }).waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
        if (output && width === 360) await page.screenshot({ path: resolve(output, `beta-admin-${colorScheme}.png`), fullPage: true });
        await page.close();
        console.log(`PASS beta UI ${width}px ${colorScheme}: public deletion, focus, admin checkbox, request feedback`);
      }
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
