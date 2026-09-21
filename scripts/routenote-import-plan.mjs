// Operator-only import planner. Source exports and generated SQL stay outside the web root.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { normalizeRouteNotePolygon, isRouteNoteUuid } from '../src/lib/route-notes.js';

const SOURCE = 'dewusorjwzhsdhrsrvbg';
const TARGET = 'xrrdokcjhjqdfvwtbenl';
const COMPANY = 'a97aa223-25ba-461c-a5b3-a96b8bf5c604';
const TABLES = { zones: 'quickflex_note_zones', tips: 'quickflex_note_tips', tip_photos: 'quickflex_note_photos', zone_photos: 'quickflex_note_zone_photos' };
const SOURCE_TABLES = { zones: 'rn_route_zones', tips: 'rn_route_tips', tip_photos: 'rn_route_tip_photos', zone_photos: 'rn_route_zone_photos', paths: 'rn_route_paths', path_points: 'rn_route_path_points' };
const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
function requireValue(ok, message) { if (!ok) throw new Error(message); }
function stableUuid(text) {
  const bytes = createHash('sha256').update(text).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128;
  const h = bytes.toString('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

export function createImportPlan(snapshot) {
  requireValue(snapshot.source_project === SOURCE && snapshot.target_project === TARGET, 'Unexpected source/target project');
  const authors = new Map(snapshot.author_mapping.map(a => [a.source_id, a]));
  for (const a of authors.values()) requireValue(!a.target_id || isRouteNoteUuid(a.target_id), 'Invalid mapped author');
  const user = id => authors.get(id)?.target_id || null;
  const provenance = r => ({ source_project: SOURCE, source_id: r.id, source_record: {} });
  const created = r => ({ created_by: user(r.created_by), updated_by: user(r.updated_by), created_at: r.created_at || snapshot.exported_at, updated_at: r.updated_at || r.created_at || snapshot.exported_at });
  const records = Object.fromEntries(Object.entries(SOURCE_TABLES).map(([type, table]) => [type, snapshot.tables[table].filter(r => r.is_deleted !== true)]));
  const zoneIds = new Set(records.zones.map(z => z.id));
  const tipIds = new Set(records.tips.map(t => t.id));
  const unassignedId = stableUuid(`${SOURCE}/unassigned-route-tips`);
  const plan = { source_project: SOURCE, target_project: TARGET, company_id: COMPANY, exported_at: snapshot.exported_at, zones: [], tips: [], tip_photos: [], zone_photos: [], media: [], archive: [] };
  for (const z of records.zones) {
    normalizeRouteNotePolygon(z.polygon);
    requireValue(isRouteNoteUuid(z.id) && z.name?.trim() && z.name.length <= 80, 'Invalid zone');
    plan.zones.push({ id: z.id, company_id: COMPANY, name: z.name, memo: z.memo || '', polygon: z.polygon, color: z.color, ...created(z), ...provenance(z) });
  }
  if (records.tips.some(t => !t.zone_id)) plan.zones.push({ id: unassignedId, company_id: COMPANY, name: '미지정 구역', memo: '기존 RouteNote에서 구역이 연결되지 않았던 팁입니다.', polygon: null, color: null, created_by: null, updated_by: null, created_at: snapshot.exported_at, updated_at: snapshot.exported_at, source_project: SOURCE, source_id: unassignedId, source_record: { generated: 'unassigned_tips' } });
  for (const t of records.tips) {
    requireValue(isRouteNoteUuid(t.id) && (!t.zone_id || zoneIds.has(t.zone_id)), 'Tip references a missing/deleted zone');
    plan.tips.push({ id: t.id, company_id: COMPANY, zone_id: t.zone_id || unassignedId, title: t.title, marker_type: t.marker_type, memo: t.memo || '', lat: t.lat, lng: t.lng, tags: t.tags || [], last_verified_at: t.last_verified_at, last_verified_by: user(t.last_verified_by), ...created(t), author_name: authors.get(t.created_by)?.source_name?.trim() || '기존 작성자', ...provenance(t) });
  }
  for (const type of ['tip_photos', 'zone_photos']) for (const p of records[type]) {
    const isZone = type === 'zone_photos', parent = isZone ? p.zone_id : p.tip_id;
    requireValue((isZone ? zoneIds : tipIds).has(parent), 'Photo references a missing/deleted parent');
    const url = new URL(p.storage_path);
    const prefix = '/storage/v1/object/public/tip-photos/';
    requireValue(url.origin === `https://${SOURCE}.supabase.co` && url.pathname.startsWith(prefix) && !url.search, 'Unexpected source media URL');
    const sourcePath = decodeURIComponent(url.pathname.slice(prefix.length));
    requireValue(!sourcePath.split('/').includes('..'), 'Invalid source media path');
    const object = snapshot.storage.find(o => o.name === sourcePath);
    const mime = object?.metadata?.mimetype, size = Number(object?.metadata?.size);
    requireValue(EXTENSIONS[mime] && size > 0 && size <= 5 * 1024 * 1024, 'Missing or unsupported source photo');
    const path = `${isZone ? 'zones/' : ''}${COMPANY}/${parent}/${p.id}.${EXTENSIONS[mime]}`;
    const bucket = isZone ? 'quickflex-route-note-zone-photos' : 'quickflex-route-notes-photos';
    plan[type].push({ id: p.id, company_id: COMPANY, [isZone ? 'zone_id' : 'tip_id']: parent, path, created_by: user(p.uploaded_by), created_at: p.created_at || snapshot.exported_at, ...provenance(p) });
    plan.media.push({ id: p.id, source_url: url.href, source_path: sourcePath, bucket, path, expected_size: size, content_type: mime });
  }
  for (const z of records.zones) requireValue(!z.image_url || records.zone_photos.some(p => p.zone_id === z.id && p.storage_path === z.image_url), 'Zone cover is missing from its photo records');
  for (const [type, table] of Object.entries(SOURCE_TABLES)) for (const r of snapshot.tables[table]) plan.archive.push({ company_id: COMPANY, entity_type: type, entity_id: r.id, source_project: SOURCE, source_id: r.id, source_record: r });
  requireValue(new Set(plan.zones.map(z => z.name)).size === plan.zones.length, 'Duplicate zone names');
  plan.summary = { zones: records.zones.length, unassigned_zones: plan.zones.length - records.zones.length, tips: plan.tips.length, unassigned_tips: records.tips.filter(t => !t.zone_id).length, tip_photos: plan.tip_photos.length, zone_photos: plan.zone_photos.length, linked_tips: plan.tips.filter(t => t.created_by).length, unlinked_tips: plan.tips.filter(t => !t.created_by).length, media_bytes: plan.media.reduce((s,p) => s+p.expected_size,0), archived_records: plan.archive.length };
  return plan;
}

function literal(value) { return `'${String(value).replaceAll("'", "''")}'`; }
export function createImportSql(plan) {
  requireValue(plan.source_project === SOURCE && plan.target_project === TARGET && plan.company_id === COMPANY, 'Unexpected import plan');
  const sql = ['begin;'];
  // Never overwrite destination changes on a repeated import. A mismatch rolls back the whole batch.
  for (const [type, table] of Object.entries(TABLES)) {
    const rows = plan[type]; if (!rows.length) continue;
    const cols = Object.keys(rows[0]);
    const json = `${literal(JSON.stringify(rows))}::jsonb`;
    sql.push(`insert into public.${table} (${cols.join(',')}) select ${cols.join(',')} from jsonb_populate_recordset(null::public.${table},${json}) on conflict(id) do nothing;`);
    sql.push(`do $verify$ begin if exists(select 1 from jsonb_populate_recordset(null::public.${table},${json}) expected left join public.${table} actual on actual.id=expected.id where actual.id is null or row(${cols.map(c=>`actual.${c}`).join(',')}) is distinct from row(${cols.map(c=>`expected.${c}`).join(',')})) then raise exception 'Import content mismatch: ${type}'; end if; end $verify$;`);
  }
  const cols = ['company_id','entity_type','entity_id','source_project','source_id','source_record'];
  const archiveJson = `${literal(JSON.stringify(plan.archive))}::jsonb`;
  sql.push(`insert into quickflex_notes_private.import_records (${cols.join(',')}) select ${cols.join(',')} from jsonb_populate_recordset(null::quickflex_notes_private.import_records,${archiveJson}) on conflict do nothing;`);
  sql.push(`do $verify$ begin if exists(select 1 from jsonb_populate_recordset(null::quickflex_notes_private.import_records,${archiveJson}) expected left join quickflex_notes_private.import_records actual on actual.entity_type=expected.entity_type and actual.entity_id=expected.entity_id where actual.entity_id is null or row(${cols.map(c=>`actual.${c}`).join(',')}) is distinct from row(${cols.map(c=>`expected.${c}`).join(',')})) then raise exception 'Import archive mismatch'; end if; end $verify$;`);
  sql.push('commit;'); return sql.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [snapshotPath, outputDirectory] = process.argv.slice(2);
  requireValue(snapshotPath && outputDirectory, 'Usage: node scripts/routenote-import-plan.mjs <private snapshot.json> <private output directory>');
  const outputRelative = relative(fileURLToPath(new URL('../', import.meta.url)), resolve(outputDirectory));
  requireValue(outputRelative === '..' || outputRelative.startsWith(`..${sep}`) || isAbsolute(outputRelative), 'Import output must stay outside the web repository');
  const plan = createImportPlan(JSON.parse(readFileSync(snapshotPath, 'utf8')));
  writeFileSync(resolve(outputDirectory, 'import-plan.json'), JSON.stringify(plan));
  writeFileSync(resolve(outputDirectory, 'import-data.sql'), createImportSql(plan));
  console.log(JSON.stringify(plan.summary));
}
