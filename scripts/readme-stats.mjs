#!/usr/bin/env node
// Rewrites the <!-- stats:start --> ... <!-- stats:end --> block in README.md from the datasets.
// --check: exit 1 when the block is stale (validate.sh). Nobody edits the numbers by hand.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { coffeePlaces, datasetVersion, loadDatasets } from "./lib/datasets.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const START = "<!-- stats:start -->";
const END = "<!-- stats:end -->";

export function statsBlock(files, schemaVersion) {
  const places = coffeePlaces(files).filter((p) => !p.merged_into);
  const tiers = { A: 0, B: 0, none: 0, unknown: 0 };
  for (const p of places) tiers[p.specialty_tier] = (tiers[p.specialty_tier] ?? 0) + 1;
  const cities = [...new Set(places.map((p) => `${p._country_code}/${p._city}`))];
  const brew = files.filter((f) => f.family === "brew-methods").reduce((n, f) => n + f.records.length, 0);
  const rows = [
    ["Coffee places", places.length],
    ["Tier A (specialty-focused)", tiers.A],
    ["Tier B (serves specialty)", tiers.B],
    ["Not specialty", tiers.none],
    ["Not yet assessed", tiers.unknown],
    ["Cities", cities.length],
    ...(brew ? [["Brew methods", brew]] : []),
    ["Dataset version", `\`${datasetVersion(files) ?? "unreleased"}\``],
    ["Schema version", `\`${schemaVersion}\``],
  ];
  return [START, "", "| | |", "|---|---:|", ...rows.map(([k, v]) => `| ${k} | ${v} |`), "", END].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const readmePath = join(root, "README.md");
  const readme = readFileSync(readmePath, "utf8");
  const a = readme.indexOf(START);
  const b = readme.indexOf(END);
  if (a < 0 || b < a) { console.log(`::error::README.md has no ${START} ... ${END} block`); process.exit(1); }
  const files = loadDatasets(resolve(process.env.DATASETS_DIR ?? join(root, "datasets")));
  const next = readme.slice(0, a) + statsBlock(files, readFileSync(join(root, "schema-version.txt"), "utf8").trim()) + readme.slice(b + END.length);
  if (process.argv.includes("--check")) {
    if (next !== readme) { console.log("::error::README.md stats are stale; run node scripts/readme-stats.mjs and commit the result"); process.exit(1); }
    console.log("README stats are current");
  } else if (next !== readme) {
    writeFileSync(readmePath, next);
    console.log("README stats updated");
  }
}
