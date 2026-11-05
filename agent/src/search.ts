// Web search is used for discovery and for finding websites only; every fact is then confirmed on the primary page.
// Providers: a seed file (results of a search done elsewhere, e.g. by a maintainer) and, optionally, the Brave Search API
// (BRAVE_SEARCH_API_KEY; a paid service, so enabling it is a maintainer decision).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CACHE } from "./config";

export type Seed = { name: string; website?: string | null; instagram?: string | null; found_via?: string };

// Guides, review sites and maps never count as a result.
export const BLOCKED_RESULT = /(^|\.)(extract\.coffee|europeancoffeetrip\.com|roasters\.app|caffe-?atlas|google\.|goo\.gl|openstreetmap|osm\.org|yelp\.|tripadvisor\.|happycow\.net|foursquare\.com|wanderlog\.com|mitvergnuegen\.com|mucbook\.de|timeout\.com|facebook\.com|instagram\.com|tiktok\.com|youtube\.com|lieferando|speisekarte|restaurantguru|falstaff|thefork|opentable|quandoo|wikipedia\.org)/i;

export function seedFile(slug: string): Seed[] {
  const f = join(CACHE, "discovery", `${slug}-search.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")).places : [];
}

/** Websites found by a search done elsewhere for existing records: .cache/discovery/<city>-websites.json {"found": [{id, website}]}. */
export function websiteSeeds(slug: string): Map<string, string> {
  const f = join(CACHE, "discovery", `${slug}-websites.json`);
  return new Map(existsSync(f) ? JSON.parse(readFileSync(f, "utf8")).found.filter((x: any) => /^https?:\/\//.test(x.website ?? "")).map((x: any) => [x.id, x.website]) : []);
}

export const searchEnabled = () => !!process.env.BRAVE_SEARCH_API_KEY;
export const searchLog: { query: string; results: number; error?: string }[] = [];

export async function search(query: string): Promise<{ url: string; title: string }[]> {
  if (!searchEnabled()) return [];
  await Bun.sleep(1100);
  try {
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?count=10&q=${encodeURIComponent(query)}`, { headers: { "x-subscription-token": process.env.BRAVE_SEARCH_API_KEY!, accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const out = ((await res.json() as any).web?.results ?? []).map((r: any) => ({ url: r.url, title: r.title })).filter((r: any) => !BLOCKED_RESULT.test(new URL(r.url).hostname));
    searchLog.push({ query, results: out.length });
    return out;
  } catch (e) { searchLog.push({ query, results: 0, error: String(e) }); return []; }
}

/** Up to three queries for a place's own website; candidates are returned for the caller to verify on the page. */
export async function websiteCandidates(name: string, street: string | undefined, city: string): Promise<string[]> {
  const queries = [`"${name}" ${city}`, `${name} ${street ?? ""} ${city}`.trim(), `${name} ${city} café impressum`];
  const seen = new Set<string>();
  for (const q of queries) {
    for (const r of await search(q)) {
      const u = new URL(r.url);
      const home = `${u.protocol}//${u.host}/`;
      if (!seen.has(home)) seen.add(home);
    }
    if (seen.size >= 5) break;
  }
  return [...seen].slice(0, 5);
}
