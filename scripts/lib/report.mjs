// Merges a patch into .ci/report.json (CONTRACT "CI summary"); each script adds its part.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function mergeReport(root, patch) {
  const file = join(root, ".ci", "report.json");
  let report = {};
  try { report = JSON.parse(readFileSync(file, "utf8")); } catch { /* first writer */ }
  for (const [k, v] of Object.entries(patch)) {
    if (k === "warnings") report.warnings = [...new Set([...(report.warnings ?? []), ...v])];
    else if (v && typeof v === "object" && !Array.isArray(v)) report[k] = { ...report[k], ...v };
    else report[k] = v;
  }
  mkdirSync(join(root, ".ci"), { recursive: true });
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
