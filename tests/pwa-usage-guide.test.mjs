import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { Script } from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const guide = readFileSync(new URL('../guide.html', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('settings and measurement open one guide without unloading the PWA', () => {
  const links = [...html.matchAll(/<a\b[^>]*href="\.\/guide\.html"[^>]*>[\s\S]*?<\/a>/g)].map(match => match[0]);
  assert.equal(links.length, 2);
  for (const link of links) {
    assert.match(link, /target="_blank"/);
    assert.match(link, /rel="[^"]*noopener/);
    assert.match(link, /rel="[^"]*noreferrer/);
    assert.match(link, /새 창/);
  }
  const settings = html.slice(html.indexOf('view-settings'), html.indexOf('view-expenses'));
  const measurement = html.slice(html.indexOf('view-measurement'), html.indexOf('view-stats'));
  assert.match(settings, /href="\.\/guide\.html"/);
  assert.match(measurement, /href="\.\/guide\.html"/);
  assert.match(measurement, /id="openMeasurementGuide"[\s\S]*?설치 안내/);
  assert.match(html, /id="measurementGuideDialog"[^>]*role="dialog"/);
  assert.match(html, /id="measurementGuideTitle">설치 안내/);
  assert.doesNotMatch(html, /설치·사용 안내/);
});

test('the guide is a small source-backed page with relative assets and no account data', () => {
  assert(Buffer.byteLength(guide) < 100_000);
  assert.doesNotMatch(guide, /__[A-Z_]+__|data:image|data:font/);
  assert.match(guide, /쿠팡플렉스 배송목록 화면을 열어주세요/);
  assert.match(guide, /설명용 가상 데이터/);
  assert.match(guide, /‘측정 종료’만 눌렀다고 하루 매출 기록이 끝난 것은 아니에요/);
  assert.match(guide, /href="\.\/install\.html"/);
  assert.match(guide, /class="back-link" href="\.\/"/);
  assert.doesNotMatch(guide, /https:\/\/jamaica8612\.github\.io|access_token|refresh_token|supabase|\.codex-remote-attachments/);
  for (const match of guide.matchAll(/(?:src|href)="(\.\/[^"?#]*)"/g)) {
    assert(existsSync(new URL(`../${match[1]}`, import.meta.url)), `Missing relative resource ${match[1]}`);
  }
  for (const match of guide.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Script(match[1]);
});

test('offline shell includes the guide and all zoomable images', () => {
  assert.match(worker, /const CACHE_NAME = "[^"]*usage-guide-1"/);
  const files = ['./guide.html', './assets/usage-guide/flexnote-symbol.svg', './assets/fonts/PretendardVariable.woff2'];
  const images = JSON.parse(guide.match(/id="guide-images">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(Object.keys(images), ['pace', 'finish', 'edit']);
  for (const entry of Object.values(images)) files.push(entry.src);
  for (const file of files) {
    assert(worker.includes(`"${file}"`), `Not precached: ${file}`);
    assert(existsSync(new URL(`../${file}`, import.meta.url)), `Missing shell resource: ${file}`);
  }
});
