#!/usr/bin/env node
// CLI for scripts/lib/check.mjs; called by scripts/validate.sh with SCHEMA_DIR set.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { check } from "./lib/check.mjs";
import { datasetVersion, loadDatasets } from "./lib/datasets.mjs";
import { mergeReport } from "./lib/report.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const datasetsDir = resolve(process.env.DATASETS_DIR ?? join(root, "datasets"));
const assetsDir = resolve(process.env.ASSETS_DIR ?? join(root, "assets"));
const schemaVersion = readFileSync(join(root, "schema-version.txt"), "utf8").trim();
const schemaDir = process.env.SCHEMA_DIR;
const baseRef = process.env.BASE_REF || "origin/main";
if (!schemaDir) throw new Error("SCHEMA_DIR is not set; run scripts/validate.sh");

const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] });
let baseFiles = null;
const warnings = [];
if (process.env.DATASETS_DIR) {
  warnings.push(`DATASETS_DIR is set (${datasetsDir}); skipped the deleted-id check against ${baseRef}`);
} else {
  try {
    git("rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`);
    baseFiles = new Map();
    for (const path of git("ls-tree", "-r", "--name-only", baseRef, "--", "datasets").split("\n")) {
      if (!path.endsWith(".json") || path === "datasets/sources.json" || path.startsWith("datasets/i18n/")) continue;
      baseFiles.set(path.slice("datasets/".length), git("show", `${baseRef}:${path}`));
    }
  } catch {
    warnings.push(`base ref ${baseRef} does not exist; skipped the deleted-id check`);
  }
}

const result = check({
  datasetsDir,
  assetsDir,
  schemaDir,
  schemaVersion,
  denylist: JSON.parse(readFileSync(join(root, "scripts/config/denylist.json"), "utf8")),
  baseFiles,
});
result.warnings.unshift(...warnings);

for (const w of result.warnings) console.log(`::warning::${w}`);
for (const e of result.errors) console.log(`::error::${e}`);
let version = null;
try { version = datasetVersion(loadDatasets(datasetsDir)); } catch { /* reported above */ }
mergeReport(root, {
  records_validated: result.stats.records,
  files_validated: result.stats.files,
  versions: { schema: schemaVersion, dataset: version },
  warnings: result.warnings,
});
console.log(`checked ${result.stats.files} files, ${result.stats.records} records (${Object.entries(result.stats.families).map(([f, n]) => `${f}: ${n}`).join(", ") || "none"}); ${result.errors.length} errors, ${result.warnings.length} warnings`);
process.exit(result.errors.length ? 1 : 0);
