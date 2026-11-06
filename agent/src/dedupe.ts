import type { Candidate } from "./candidate";
import { distanceM } from "./geo";
import { nameSim, ownHost, sameStreet } from "./names";

/** Whether two candidates are the same place. */
export function samePlace(a: Candidate, b: Candidate): boolean {
  const sim = nameSim(a.name, b.name);
  const ha = ownHost(a.website), hb = ownHost(b.website);
  const d = candidateDistance(a, b);
  const hasPos = Number.isFinite(d);
  // One website can cover several branches, so a shared host also needs the same address or position.
  if (ha && ha === hb) return sharedHostBranch(a, b, d);
  if (sameStreet(a.street, b.street) && sim >= 0.5) return true;
  // Different house numbers on known streets are different places unless the names are the same (Cafe Amalien at No. 87 is not Dinatale at No. 71; Overture's "Mackgorilla" at No. 12 is the MackGorilla at No. 13).
  if (hasPos) return nearbyName(sim, d) && (sim >= 0.9 || compatibleStreet(a, b));
  return sim >= 0.9 && compatibleStreet(a, b);
}

/** Merge b into a: keep a's values, add b's where a has none. */
export function mergeInto(a: Candidate, b: Candidate): Candidate {
  mergeCandidateDetails(a, b);
  a.category ??= b.category;
  a.brand ??= b.brand;
  a.overtureIds = [...new Set([...a.overtureIds, ...b.overtureIds])];
  a.overtureCoffee ||= b.overtureCoffee;
  if (a.overtureStatus == null) a.overtureStatus = b.overtureStatus;
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

export function candidateDistance(a: Candidate, b: Candidate): number {
  if (a.lat == null || a.lon == null || b.lat == null || b.lon == null) return Infinity;
  return distanceM({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon });
}

function sharedHostBranch(a: Candidate, b: Candidate, distance: number): boolean {
  if (sameStreet(a.street, b.street) || distance <= 60) return true;
  return !Number.isFinite(distance) && !(a.street && b.street);
}

const nearbyName = (similarity: number, distance: number) => (similarity >= 0.75 && distance <= 150) || (similarity >= 0.5 && distance <= 50);
const compatibleStreet = (a: Candidate, b: Candidate) => !(a.street && b.street && !sameStreet(a.street, b.street));

function mergeCandidateDetails(a: Candidate, b: Candidate) {
  a.lat ??= b.lat;
  a.lon ??= b.lon;
  a.street ??= b.street;
  a.postcode ??= b.postcode;
  mergeCandidateLinks(a, b);
}

function mergeCandidateLinks(a: Candidate, b: Candidate) {
  a.website ??= b.website;
  a.instagram ??= b.instagram;
  a.wikidata ??= b.wikidata;
  a.image ??= b.image;
}
