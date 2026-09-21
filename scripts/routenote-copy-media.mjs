// Run only from a trusted operator terminal. Never place credentials or reports in the web root.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const [planFile, reportDirectory, mode] = process.argv.slice(2);
if (!planFile || !reportDirectory || mode !== '--apply') throw new Error('Usage: node scripts/routenote-copy-media.mjs <private plan.json> <private report directory> --apply');
const outputRelative = relative(fileURLToPath(new URL('../', import.meta.url)), resolve(reportDirectory));
if (outputRelative !== '..' && !outputRelative.startsWith(`..${sep}`) && !isAbsolute(outputRelative)) throw new Error('Media report must stay outside the web repository');
const plan = JSON.parse(readFileSync(planFile, 'utf8'));
const key = process.env.QF_IMPORT_SERVICE_KEY;
const source = 'https://dewusorjwzhsdhrsrvbg.supabase.co';
const target = 'https://xrrdokcjhjqdfvwtbenl.supabase.co';
if (!key || plan.source_project !== 'dewusorjwzhsdhrsrvbg' || plan.target_project !== 'xrrdokcjhjqdfvwtbenl') throw new Error('Import identity/credential unavailable');
const headers = { apikey: key, Authorization: `Bearer ${key}` };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { source_project: plan.source_project, target_project: plan.target_project, started_at: new Date().toISOString(), files: [] };
const reportPath = resolve(reportDirectory, 'media-report.json');
function save() { writeFileSync(reportPath, JSON.stringify(report, null, 2)); }
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(45000) });
  return response;
}
for (const media of plan.media) {
  const input = new URL(media.source_url);
  if (input.origin !== source || !input.pathname.startsWith('/storage/v1/object/public/tip-photos/')) throw new Error('Unexpected media source');
  const zone = media.bucket === 'quickflex-route-note-zone-photos';
  if (!zone && media.bucket !== 'quickflex-route-notes-photos') throw new Error('Unexpected media destination');
  const expectedPrefix = `${zone ? 'zones/' : ''}${plan.company_id}/`;
  if (!media.path.startsWith(expectedPrefix) || !/^(zones\/)?[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg|jpeg|webp)$/.test(media.path)) throw new Error('Invalid media destination path');
  const originalResponse = await request(input);
  if (!originalResponse.ok) throw new Error(`Source photo ${media.id}: HTTP ${originalResponse.status}`);
  const original = Buffer.from(await originalResponse.arrayBuffer());
  if (original.length !== media.expected_size || originalResponse.headers.get('content-type')?.split(';')[0] !== media.content_type) throw new Error(`Source photo changed: ${media.id}`);
  const digest = hash(original);
  const objectUrl = `${target}/storage/v1/object/${media.bucket}/${media.path}`;
  let existing = await request(objectUrl, { headers });
  let copied = false;
  if (!existing.ok) {
    const body = await existing.json().catch(() => ({}));
    if (![400,404].includes(existing.status) || !/not found/i.test(`${body.message || ''} ${body.error || ''}`)) throw new Error(`Destination read failed for ${media.id}: HTTP ${existing.status}`);
    const uploaded = await request(objectUrl, { method: 'POST', headers: { ...headers, 'Content-Type': media.content_type, 'x-upsert': 'false', 'Cache-Control': 'max-age=3600' }, body: original });
    if (!uploaded.ok) throw new Error(`Upload failed for ${media.id}: HTTP ${uploaded.status}`);
    copied = true;
    existing = await request(objectUrl, { headers });
  }
  if (!existing.ok) throw new Error(`Verification read failed for ${media.id}: HTTP ${existing.status}`);
  const destination = Buffer.from(await existing.arrayBuffer());
  if (destination.length !== original.length || hash(destination) !== digest) throw new Error(`Destination content mismatch: ${media.id}`);
  report.files.push({ id: media.id, bucket: media.bucket, path: media.path, bytes: original.length, sha256: digest, copied, verified_at: new Date().toISOString() });
  save();
  if (report.files.length % 10 === 0) console.log(JSON.stringify({ verified: report.files.length, total: plan.media.length }));
}
for (const bucket of new Set(plan.media.map(m=>m.bucket))) {
  const media = plan.media.find(m => m.bucket === bucket);
  const publicResponse = await request(`${target}/storage/v1/object/public/${bucket}/${media.path}`);
  if (publicResponse.ok) throw new Error(`Destination bucket unexpectedly public: ${bucket}`);
  await publicResponse.body?.cancel();
}
report.finished_at = new Date().toISOString(); report.total_bytes = report.files.reduce((s,f)=>s+f.bytes,0); save();
console.log(JSON.stringify({ verified_files: report.files.length, bytes: report.total_bytes, public_access: 'denied' }));
