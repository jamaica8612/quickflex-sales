// Lightweight, dependency-free lint: parse every project .js file with
// `node --check` so syntax errors fail CI without pulling in a linter.
import { readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SKIP_DIRS = new Set(["node_modules", ".git", "supabase"]);

function collect(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (entry.endsWith(".js") || entry.endsWith(".mjs")) out.push(full);
  }
  return out;
}

const files = collect(ROOT).sort();
const failures = [];

for (const file of files) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (error) {
    failures.push(`${file}\n${error.stderr?.toString() ?? error.message}`);
  }
}

console.log(`checked ${files.length} files`);
if (failures.length) {
  console.error(`\nsyntax errors in ${failures.length} file(s):\n`);
  console.error(failures.join("\n\n"));
  process.exit(1);
}
console.log("no syntax errors");
