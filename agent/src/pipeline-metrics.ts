import { stats as fetchStats } from "./pages";
import { usage } from "./llm";
import { licenceStats } from "./discovery/overture";
import type { Change, Enriched, ProvenanceMap, Conflict, Unlocated } from "./pipeline-model";
import type { CoffeeRecord } from "./record";
import type { Job } from "./queue";
import type { Research } from "./research";
import { searchLog } from "./search";
interface MetricsInput {
  places: CoffeeRecord[]; written: CoffeeRecord[]; jobs: Job[]; results: Map<string, Enriched>; changes: Change[];
  errors: string[]; timing: Record<string, number>; counts: Record<string, number>; conflicts: Conflict[]; unlocated: Unlocated[];
  runId: string; researchLog: Map<string, Research>;
}
function flatten(o: unknown, prefix = "", out = new Map<string, unknown>()) {
  for (const [k, v] of Object.entries(o ?? {})) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v) && !["location", "operator", "image", "prices"].includes(k)) flatten(v, p, out);
    else out.set(p, v);
  }
  return out;
}

export function diff(old: CoffeeRecord | null, r: CoffeeRecord, prov: ProvenanceMap) {
  const a = flatten(old ?? {}), b = flatten(r);
  const out: Omit<Change, "id" | "name">[] = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    if (["checked_at", "id"].includes(k)) continue;
    if (JSON.stringify(a.get(k)) === JSON.stringify(b.get(k))) continue;
    const pv = prov.get(k) ?? prov.get(k.split(".").slice(0, 2).join(".")) ?? prov.get(k.split(".")[0]);
    out.push({ field: k, old: a.get(k), new: b.get(k), ...provenanceDetails(pv) });
  }
  return out;
}

export const CORE = ["name", "address.street_address", "address.postal_code", "location", "status", "opening_hours", "specialty_tier", "links.website|links.instagram", "serving.espresso", "serving.filter"];
const FILL_FIELDS = ["address.street_address", "address.postal_code", "status=open", "opening_hours", "description", "roasts_own_beans", "roasters_served", "serving.espresso", "serving.filter", "serving.pour_over", "serving.batch_brew", "serving.cold_brew", "serving.decaf", "serving.plant_milk", "amenities.wifi", "amenities.laptop_friendly", "amenities.kids_friendly", "amenities.vegan_options", "amenities.dogs_allowed", "amenities.outdoor_seating", "amenities.card_payment", "amenities.cash_only", "amenities.wheelchair_accessible", "food.focus", "food.breakfast", "food.lunch", "food.cakes_baked_in_house", "sells_beans", "sells_equipment", "offers_courses", "reusable_cup_systems", "prices.cappuccino", "operator", "links.website", "links.instagram", "links.facebook", "image", "xref.overture", "xref.wikidata"];
function get(r: CoffeeRecord, path: string): unknown {
  let value: unknown = r;
  for (const key of path.split(".")) {
    if (typeof value !== "object" || value === null) return undefined;
    value = Object.getOwnPropertyDescriptor(value, key)?.value;
  }
  return value;
}
const filled = (r: CoffeeRecord, f: string) => f.includes("=") ? get(r, f.split("=")[0]) === f.split("=")[1] : f.includes("|") ? f.split("|").some((x) => get(r, x) !== undefined) : get(r, f) !== undefined;
export const coreComplete = (r: CoffeeRecord) => CORE.every((f) => filled(r, f)) && r.specialty_tier !== "unknown";

export function fillRates(places: CoffeeRecord[]) {
  const out: Record<string, string> = {};
  for (const f of FILL_FIELDS) { const n = places.filter((p) => filled(p, f)).length; out[f] = `${n}/${places.length} (${places.length ? Math.round((100 * n) / places.length) : 0}%)`; }
  return out;
}

export function computeMetrics(x: MetricsInput) {
  const live = x.places.filter((p) => !p.merged_into);
  const tiers: Record<string, number> = { A: 0, B: 0, none: 0, unknown: 0 };
  for (const p of live) { const key = p.specialty_tier ?? "unknown"; tiers[key]++; }
  const ab = live.filter((p) => p.specialty_tier === "A" || p.specialty_tier === "B");
  const perField: Record<string, number> = {};
  for (const c of x.changes) perField[c.field] = (perField[c.field] ?? 0) + 1;
  const sites = [...x.results.values()];
  return {
    run_id: x.runId,
    places_touched: x.written.length, places_in_file: live.length, queue: x.jobs.length,
    fields_changed: x.changes.length, fields_changed_by_field: perField,
    tiers, tier_ab_core_complete: ab.filter(coreComplete).length,
    sites: { tried: sites.filter((s) => s.websiteTried.length).length, matched: sites.filter((s) => s.match).length, rendered_pages: fetchStats.rendered, search_found: sites.filter((s) => s.websiteSearch === "found").length, search_failed: sites.filter((s) => s.websiteSearch === "failed").length, injection_lines_removed: sites.reduce((n, s) => n + s.injectionLines, 0) },
    research: { places: x.researchLog.size, new_websites: [...x.researchLog.values()].filter((r) => r.website).length, pages_added: [...x.researchLog.values()].reduce((n, r) => n + r.extraPages.length, 0), searches: searchLog.length, search_errors: searchLog.filter((q) => q.error).length },
    pages: fetchStats, llm: usage, discovery: x.counts, overture_licences: licenceStats,
    conflicts: x.conflicts.length, unlocated: x.unlocated.length,
    errors: x.errors, timing_s: x.timing,
    seconds_per_place: x.written.length ? Math.round((Object.values(x.timing).reduce((a, b) => a + b, 0) / x.written.length) * 10) / 10 : null,
    fill_rate: fillRates(live), fill_rate_ab: fillRates(ab),
  };
}

function provenanceDetails(pv: ReturnType<ProvenanceMap["get"]>) {
  return { url: pv?.url, quote: pv?.quote ?? pv?.via };
}
