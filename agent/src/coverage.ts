#!/usr/bin/env bun
// Coverage against a reference list kept only in .cache/coverage/<file>.json ([{name, street?, postcode?}]).
// Reference lists from closed guides are read one page at a time for measuring only; their names never enter the dataset
// or the repository. Prints aggregates; per-name results stay in .cache/coverage/.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { city as cityBySlug } from "./cities";
import { CACHE } from "./config";
import { readCity } from "./dataset";
import { nameSim, sameStreet } from "./names";
import { coreComplete } from "./pipeline";

const [slug, ref] = process.argv.slice(2);
if (!slug || !ref) { console.error("usage: bun src/coverage.ts <city> <reference-name>   (reads .cache/coverage/<reference-name>.json)"); process.exit(1); }
const list: { name: string; street?: string }[] = JSON.parse(readFileSync(join(CACHE, "coverage", `${ref}.json`), "utf8"));
const places = readCity(cityBySlug(slug)).places.filter((p) => !p.merged_into);
const rows = list.map((x) => {
  const hits = places.filter((p) => (x.street && sameStreet(x.street, p.address?.street_address) && nameSim(x.name, p.name) >= 0.4) || nameSim(x.name, p.name) >= 0.85);
  const p = hits.sort((a, b) => nameSim(x.name, b.name) - nameSim(x.name, a.name))[0];
  return { name: x.name, street: x.street, id: p?.id, ours: p?.name, status: p?.status, tier: p?.specialty_tier, core: p ? coreComplete(p) : false };
});
writeFileSync(join(CACHE, "coverage", `${ref}-${slug}-result.json`), JSON.stringify(rows, null, 1));
const closed = rows.filter((r) => r.status === "closed").length;
const stillOpen = rows.length - closed;
const found = rows.filter((r) => r.id && r.status !== "closed");
const count = (f: (r: any) => boolean) => found.filter(f).length;
console.log(JSON.stringify({
  reference: rows.length, closed_per_our_data: closed, still_open: stillOpen, present: found.length,
  coverage: `${((100 * found.length) / Math.max(1, stillOpen)).toFixed(1)}%`,
  present_by_tier: { A: count((r) => r.tier === "A"), B: count((r) => r.tier === "B"), none: count((r) => r.tier === "none"), unknown: count((r) => r.tier === "unknown") },
  present_status_open: count((r) => r.status === "open"), present_core_complete: count((r) => r.core),
}, null, 1));
