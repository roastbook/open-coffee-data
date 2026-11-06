import { searchReply } from "./network-payloads";
import { payloadParser } from "./payload";
// Web search is used for discovery and for finding websites only; every fact is then confirmed on the primary page.
// Providers: a seed file (results of a search done elsewhere), the Brave Search API (BRAVE_SEARCH_API_KEY, paid) or a
// self-hosted SearXNG metasearch (SEARXNG_URL, free; it queries public search engines, whose terms apply).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CACHE } from "./config";

const websiteSeedPayload = payloadParser<{ found: { id: string; website?: string | null }[] }>({ type: "object", required: ["found"], properties: { found: { type: "array", items: { type: "object", required: ["id"], properties: { id: { type: "string" }, website: { type: ["string", "null"] } } } } } });

export interface Seed { name: string; website?: string | null; instagram?: string | null; found_via?: string }

// Guides, review sites and maps never count as a result.
export const BLOCKED_RESULT = /(^|\.)(extract\.coffee|europeancoffeetrip\.com|roasters\.app|caffe-?atlas|google\.|goo\.gl|openstreetmap|osm\.org|yelp\.|tripadvisor\.|happycow\.net|foursquare\.com|wanderlog\.com|mitvergnuegen\.com|mucbook\.de|timeout\.com|facebook\.com|instagram\.com|tiktok\.com|youtube\.com|lieferando|speisekarte|restaurantguru|falstaff|thefork|opentable|quandoo|wikipedia\.org)/i;

export function seedFile(slug: string): Seed[] {
  const f = join(CACHE, "discovery", `${slug}-search.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")).places : [];
}

/** Websites found by a search done elsewhere for existing records: .cache/discovery/<city>-websites.json {"found": [{id, website}]}. */
export function websiteSeeds(slug: string): Map<string, string> {
  const f = join(CACHE, "discovery", `${slug}-websites.json`);
  return new Map(existsSync(f) ? websiteSeedPayload(JSON.parse(readFileSync(f, "utf8"))).found.filter((x): x is { id: string; website: string } => typeof x.website === "string" && /^https?:\/\//.test(x.website)).map((x) => [x.id, x.website]) : []);
}

export interface Result { url: string; title: string; snippet: string }
export const searchEnabled = () => Boolean(process.env.BRAVE_SEARCH_API_KEY) || Boolean(process.env.SEARXNG_URL);
export const searchLog: { query: string; results: number; error?: string }[] = [];
const searchCache = new Map<string, Result[]>();

/** Web search through Brave (paid key) or a self-hosted SearXNG. Guides, maps and review sites are removed from results. */
let queue: Promise<unknown> = Promise.resolve();
/** Searches run one at a time, whatever the caller's concurrency, so the provider sees a steady low rate. */
export function search(query: string): Promise<Result[]> {
  const run = queue.then(() => searchNow(query));
  queue = run.catch(() => { /* Keep later searches running; the caller still receives the original rejection. */ });
  return run;
}

async function searchNow(query: string): Promise<Result[]> {
  if (!searchEnabled()) return [];
  const hit = searchCache.get(query);
  if (hit) return hit;
  await Bun.sleep(process.env.BRAVE_SEARCH_API_KEY ? 1100 : 2000);
  try {
    let raw: Result[];
    if (process.env.BRAVE_SEARCH_API_KEY) {
      const res = await fetch(`https://api.search.brave.com/res/v1/web/search?count=10&q=${encodeURIComponent(query)}`, { headers: { "x-subscription-token": process.env.BRAVE_SEARCH_API_KEY, accept: "application/json" }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      raw = searchReply(await res.json()).web.results.map((r) => ({ url: r.url, title: r.title ?? "", snippet: r.description ?? "" }));
    } else {
      const baseUrl = process.env.SEARXNG_URL;
      if (!baseUrl) return [];
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/search?format=json&language=de&q=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      raw = searchReply(await res.json()).results.map((r) => ({ url: r.url, title: r.title ?? "", snippet: r.content ?? "" }));
    }
    const out = raw.filter((r) => { try { return !BLOCKED_RESULT.test(new URL(r.url).hostname); } catch { return false; } }).slice(0, 12);
    searchLog.push({ query, results: out.length });
    searchCache.set(query, out);
    return out;
  } catch (e) { searchLog.push({ query, results: 0, error: String(e).slice(0, 120) }); return []; }
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
