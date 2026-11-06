// Work queue, derived from the records plus a small state ledger (SOURCING_STATE_DIR, restored by the workflow cache):
// 1. never enriched, 2. conflicts, 3. not verified for more than 90 days (quarterly hours/status refresh; a full refresh
// after 182 days), then 4. new cities in configured order.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CACHE, FULL_REFRESH_DAYS, REFRESH_DAYS } from "./config";
import { cities, type City } from "./cities";
import { cityFile, readCity } from "./dataset";

export type State = { enriched: Record<string, string>; conflicts: Record<string, string> };
const stateFile = (slug: string) => join(process.env.SOURCING_STATE_DIR ?? join(CACHE, "state"), `${slug}.json`);
export const loadState = (slug: string): State => (existsSync(stateFile(slug)) ? JSON.parse(readFileSync(stateFile(slug), "utf8")) : { enriched: {}, conflicts: {} });
export function saveState(slug: string, s: State) { mkdirSync(join(stateFile(slug), ".."), { recursive: true }); writeFileSync(stateFile(slug), JSON.stringify(s, null, 1)); }

export type Job = { id: string; reason: "never_enriched" | "conflict" | "refresh" | "full_refresh"; mode: "full" | "refresh" };
const days = (iso: string | undefined, now: Date) => (iso ? (now.getTime() - Date.parse(iso)) / 86400000 : Infinity);
const tierRank: Record<string, number> = { A: 0, B: 1, unknown: 2, none: 3 };

export function queueFor(places: any[], state: State, now = new Date()): Job[] {
  const jobs: (Job & { rank: number; age: number })[] = [];
  for (const p of places) {
    if (p.merged_into) continue;
    const t = tierRank[p.specialty_tier] ?? 2;
    const verifiedAge = days(p.checked_at, now);
    if (!state.enriched[p.id]) jobs.push({ id: p.id, reason: "never_enriched", mode: "full", rank: 0 + t / 10, age: verifiedAge });
    else if (state.conflicts[p.id]) jobs.push({ id: p.id, reason: "conflict", mode: "full", rank: 1 + t / 10, age: verifiedAge });
    else if (days(p.checked_at, now) > FULL_REFRESH_DAYS) jobs.push({ id: p.id, reason: "full_refresh", mode: "full", rank: 2 + t / 10, age: verifiedAge });
    else if (p.status !== "closed" && verifiedAge > REFRESH_DAYS) jobs.push({ id: p.id, reason: "refresh", mode: "refresh", rank: 2 + t / 10, age: verifiedAge });
  }
  return jobs.sort((a, b) => a.rank - b.rank || b.age - a.age).map(({ id, reason, mode }) => ({ id, reason, mode }));
}

/** The city to work on: the first configured city with queued work, else the first without a dataset file. */
export function nextCity(now = new Date()): City | null {
  for (const c of cities) if (existsSync(cityFile(c)) && queueFor(readCity(c).places, loadState(c.slug), now).length) return c;
  return cities.find((c) => !existsSync(cityFile(c)) && c.boundary) ?? null;
}
