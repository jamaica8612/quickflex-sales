// Development-only: bundle the selected official SVG paths into the map icon module.
// The browser never loads this script or the individual source files.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const target = resolve(dir, "../../../../src/lib/route-note-icons.js");
const names = {
  market_map: "building-warehouse", note: "bulb", vehicle_entrance: "car", parking: "parking",
  entrance: "door-enter", elevator: "elevator", stairs: "stairs", restroom: "toilet-paper",
  dog: "dog", cat: "cat", delivery_spot: "package", warning: "alert-triangle",
  construction: "traffic-cone", access_code: "password", security: "shield-check",
  storage: "building-warehouse", walk_in: "walk", unloading: "truck-delivery", locked: "lock",
  quiet: "volume-off", no_entry: "ban", important: "star",
};
const paths = {};
for (const [type, icon] of Object.entries(names)) {
  const svg = await readFile(join(dir, `${icon}.svg`), "utf8");
  const found = [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"[^>]*\/?\s*>/g)].map((match) => match[1]);
  const drawingTags = [...svg.matchAll(/<(path|circle|rect|line|polyline|polygon|ellipse)\b/g)].length;
  if (!found.length || found.length !== drawingTags) throw new Error(`Unsupported source geometry: ${icon}`);
  paths[type] = found;
}
let source = await readFile(target, "utf8");
source = source.replace(/export const MAP_MARKER_ICONS = Object\.freeze\(\{[\s\S]*?\}\);/, `export const MAP_MARKER_ICONS = Object.freeze(${JSON.stringify(names, null, 2)});`);
source = source.replace(/\/\/ (?:Distinct silhouettes|Official Tabler Icons outline paths)[\s\S]*?const MAP_ICON_PATHS = \{[\s\S]*?\n\};/, `// Official Tabler Icons outline paths, bundled for offline map markers. See assets/icons/route-notes/tabler-outline/LICENSE.txt.\nconst MAP_ICON_PATHS = ${JSON.stringify(paths, null, 2)};`);
if (!source.includes('MAP_MARKER_ICONS = Object.freeze({') || !source.includes("Official Tabler Icons outline paths")) throw new Error("Map replacement anchor not found");
await writeFile(target, source, "utf8");
console.log(`Bundled ${Object.keys(names).length} marker types from ${new Set(Object.values(names)).size} official SVGs.`);
