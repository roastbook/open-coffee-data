// Web leads for discovery: a search-capable model lists specialty coffee places per district (names and own websites).
// These are leads only: every website is fetched and must name the place and show its address, and the place must
// exist in Overture for coordinates. Districts come from Wikidata (P150), so this works for any city.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CACHE, llm, USER_AGENT } from "../config";
import { searchingModel } from "../llm";
import { isPlatformUrl } from "../rules";
import type { Seed } from "../search";

async function sparql(q: string) {
  const res = await fetch("https://query.wikidata.org/sparql?query=" + encodeURIComponent(q), { headers: { accept: "application/sparql-results+json", "user-agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}`);
  return ((await res.json()) as any).results.bindings as any[];
}

/** Current districts of a city (P150); one level deeper when there are fewer than 20. */
export async function districts(qid: string): Promise<string[]> {
  const q = (id: string) => `SELECT ?d ?dLabel WHERE { wd:${id} wdt:P150 ?d. FILTER NOT EXISTS { ?d wdt:P576 [] } SERVICE wikibase:label { bd:serviceParam wikibase:language "de,en". } }`;
  const top = await sparql(q(qid));
  if (top.length >= 20) return top.map((b) => b.dLabel.value);
  const out: string[] = [];
  for (const b of top) {
    const sub = await sparql(q(b.d.value.split("/").pop()));
    out.push(...(sub.length ? sub.map((s) => s.dLabel.value) : [b.dLabel.value]));
  }
  return [...new Set(out)];
}

const json = (text: string) => { try { return JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "{}"); } catch { return {}; } };
const urlOk = (u: any) => typeof u === "string" && /^https?:\/\//.test(u) && !isPlatformUrl(u);
const clean = (u: string) => u.replace(/[?&]utm_source=openai$/, "");

const PLACES_PROMPT = (city: string, district: string) => `Use web search to find specialty coffee places (cafés and coffee bars that serve specialty coffee, roasteries with a café) in ${district}, ${city}.
Return only places inside ${city}. For each, give its name and its OWN website (not a directory, guide, review site, map, social network or delivery platform); use null if it has none.
Do not state other facts. Answer only with JSON: {"places": [{"name": "...", "website": "https://..." | null}]} (up to 25 places).`;


/** Seeds and roaster pages for a city, cached per city in .cache/discovery so a rerun does not search again. */
export async function webLeads(city: { slug: string; name: string; wikidata?: string }): Promise<{ seeds: Seed[]; districts: number }> {
  const file = join(CACHE, "discovery", `${city.slug}-webleads.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  if (!llm.researchModel || !city.wikidata) return { seeds: [], districts: 0 };
  const ds = await districts(city.wikidata);
  const seeds: Seed[] = [];
  // A few districts at a time; each call runs its own searches at the provider.
  for (let i = 0; i < ds.length; i += 4) {
    const batch = await Promise.all(ds.slice(i, i + 4).map(async (d) => {
      try { return { d, j: json(await searchingModel(PLACES_PROMPT(city.name, d))) }; } catch { return { d, j: {} }; }
    }));
    for (const { d, j } of batch) for (const p of Array.isArray(j.places) ? j.places : [])
      if (typeof p?.name === "string" && p.name.length > 1 && !seeds.some((s) => s.name === p.name))
        seeds.push({ name: p.name.trim(), website: urlOk(p.website) ? clean(p.website) : null, found_via: `web leads: ${d}` });
  }
  const out = { seeds, districts: ds.length };
  mkdirSync(join(CACHE, "discovery"), { recursive: true });
  writeFileSync(file, JSON.stringify(out, null, 1));
  return out;
}
