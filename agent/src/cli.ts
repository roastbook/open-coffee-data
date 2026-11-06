#!/usr/bin/env bun
// Data agent entry point (scripts/agent.sh). Usage: see docs/agent.md.
import { parseArgs } from "node:util";
import { appendFileSync } from "node:fs";
import { city as cityBySlug } from "./cities";
import { prBody, openPr } from "./pr";
import { run } from "./pipeline";
import { nextCity } from "./queue";

const { values } = parseArgs({ options: {
  city: { type: "string" }, limit: { type: "string", default: "50" }, "dry-run": { type: "boolean", default: false },
  "no-pr": { type: "boolean", default: false }, stages: { type: "string" }, help: { type: "boolean", default: false },
} });
if (values.help) {
  console.log("scripts/agent.sh [--city <slug>] [--limit N] [--dry-run] [--no-pr] [--stages discover,enrich,websites,images]");
  process.exit(0);
}
const c = values.city ? cityBySlug(values.city) : nextCity();
if (!c) { console.log("Nothing queued and no new city with a configured boundary."); process.exit(0); }
const limit = Number(values.limit);
console.error(`Data agent: ${c.name} (${c.slug}), limit ${limit}${values["dry-run"] ? ", dry run" : ""}`);

const r = await run({ city: c, limit, dryRun: values["dry-run"] ?? false, stages: values.stages?.split(",") });
const m = r.metrics;
const summary = [
  `## Data agent: ${c.name}`, "",
  `- places touched: ${m.places_touched} (file: ${m.places_in_file}); fields changed: ${m.fields_changed}`,
  `- tiers: A ${m.tiers.A}, B ${m.tiers.B}, none ${m.tiers.none}, unknown ${m.tiers.unknown}; A/B with complete core fields: ${m.tier_ab_core_complete}`,
  `- LLM: ${m.llm.calls} calls, ${m.llm.inputTokens} in / ${m.llm.outputTokens} out tokens, $${m.llm.usd.toFixed(3)}`,
  `- pages: ${m.pages.requests} requests, ${m.pages.cacheHits} from the page cache, ${m.pages.disallowed} not fetched because of site rules, ${m.pages.rendered} rendered`,
  `- errors: ${m.errors.length}; conflicts: ${m.conflicts}; time: ${Object.entries(m.timing_s).map(([k, v]) => `${k} ${v.toFixed(0)} s`).join(", ")}; ${m.seconds_per_place ?? "–"} s per place`,
  `- run log: ${r.dir}`,
].filter(Boolean).join("\n");
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
if (process.env.SOURCING_METRICS_PATH) await Bun.write(process.env.SOURCING_METRICS_PATH, JSON.stringify(m, null, 1));

if (!values["dry-run"] && !values["no-pr"] && r.file && m.places_touched) {
  const url = await openPr(c.slug, [r.file], `feat(data): update ${c.name} coffee places`, prBody(c.name, r.changes, m, r.conflicts, r.labels), r.labels);
  console.log(`Opened ${url}`);
}
