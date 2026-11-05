import type { Candidate } from "./candidate";
import { distanceM } from "./geo";
import { nameSim, ownHost, sameStreet } from "./names";

/** Whether two candidates are the same place. */
export function samePlace(a: Candidate, b: Candidate): boolean {
  const sim = nameSim(a.name, b.name);
  const ha = ownHost(a.website), hb = ownHost(b.website);
  const hasPos = a.lat != null && b.lat != null;
  const d = hasPos ? distanceM(a as any, b as any) : Infinity;
  // One website can cover several branches, so a shared host also needs the same address or position.
  if (ha && ha === hb) return (sameStreet(a.street, b.street) || d <= 60) || (!hasPos && !(a.street && b.street));
  if (sameStreet(a.street, b.street) && sim >= 0.5) return true;
  if (hasPos) return (sim >= 0.75 && d <= 150) || (sim >= 0.5 && d <= 50);
  return sim >= 0.9 && !(a.street && b.street && !sameStreet(a.street, b.street));
}

/** Merge b into a: keep a's values, add b's where a has none. */
export function mergeInto(a: Candidate, b: Candidate): Candidate {
  for (const k of ["lat", "lon", "street", "postcode", "website", "instagram", "wikidata", "image", "category", "brand"] as const)
    if ((a as any)[k] == null && (b as any)[k] != null) (a as any)[k] = (b as any)[k];
  if (a.lat == null && b.lat != null) { a.lat = b.lat; a.lon = b.lon; }
  a.overtureIds = [...new Set([...a.overtureIds, ...b.overtureIds])];
  a.overtureCoffee ||= b.overtureCoffee;
  if (a.overtureStatus == null) a.overtureStatus = b.overtureStatus;
  for (const r of b.roasters) if (!a.roasters.some((x) => x.name === r.name)) a.roasters.push(r);
  a.origins.push(...b.origins);
  return a;
}

/** Greedy dedupe; `list` should be ordered best record first (e.g. Overture confidence). */
export function dedupe(list: Candidate[]): Candidate[] {
  const out: Candidate[] = [];
  for (const c of list) {
    const hit = out.find((o) => samePlace(o, c));
    if (hit) mergeInto(hit, c); else out.push(c);
  }
  return out;
}
