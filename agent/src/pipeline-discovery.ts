import type { Candidate } from "./candidate";
import { cityArea } from "./cities";
import { dedupe, samePlace } from "./dedupe";
import { placeWordsFrom } from "./extract";
import { distanceM } from "./geo";
import { fold, nameSim, ownHost } from "./names";
import { pool } from "./pages";
import { addressPoint, siteGeo, fromOverture, locate, streetStemIn } from "./pipeline-location";
import { type RunOptions, type Row, type Enriched, type Unlocated, stringFact } from "./pipeline-model";
import { search, searchEnabled, seedFile } from "./search";
import { overtureAddressPoints, overturePlaces } from "./discovery/overture";
import { wikidataCafes } from "./discovery/wikidata";
import { districts, webLeads } from "./discovery/webleads";
import { nonCoffeeName } from "./tier";
import { SEASONAL } from "./rules";
import type { Site } from "./site";
interface DiscoveryContext {
  o: RunOptions; area: Awaited<ReturnType<typeof cityArea>>; counts: Record<string, number>; errors: string[];
  cityNames: string[]; country: string; placeWords: Set<string>; cityPostcodes: Set<string>;
  want: (stage: string) => boolean; siteCache: Map<string, Enriched>;
  enrichSite: (c: Candidate, url: string, cityNames: string[], country: string) => Promise<Enriched>;
  points?: Awaited<ReturnType<typeof overtureAddressPoints>>;
}

export async function discover(ctx: DiscoveryContext) {
  const { o, area, counts, errors, cityNames, placeWords, cityPostcodes, want } = ctx;
  const { rows, dropped } = await overturePlaces(o.city.slug, area.bbox);
  const inside = rows.filter((r) => area.contains(r));
  counts.overture_rows_in_city = inside.length;
  // District, street and city names never identify a place on a website (siteMatches).
  const ds = o.city.wikidata ? await districts(o.city.wikidata).catch((): string[] => []) : [];
  for (const w of placeWordsFrom([...cityNames, ...ds, ...inside.map((r) => r.street)])) placeWords.add(w);
  for (const r of inside) if (r.postcode) cityPostcodes.add(r.postcode);
  counts.place_words = placeWords.size;
  counts.overture_dropped_licence = dropped;
  // New places only from coffee categories, never clearly non-coffee businesses or seasonal venues.
  const excluded = (r: Row) => nonCoffeeName(r.name) || SEASONAL.test(r.name);
  const coffee = inside.filter((r) => r.coffee && r.status !== "permanently_closed" && !excluded(r)).sort((a, b) => b.confidence - a.confidence);
  counts.excluded_non_coffee_or_seasonal = inside.filter((r) => r.coffee && r.status !== "permanently_closed" && excluded(r)).length;
  counts.overture_coffee = coffee.length;
  counts.overture_coffee_closed = inside.filter((r) => r.coffee && r.status === "permanently_closed").length;
  const cands = dedupe(coffee.map(fromOverture));
  counts.overture_coffee_deduped = cands.length;
  const unlocated: Unlocated[] = [];

  await attachWikidata(ctx, cands, unlocated);

  // Web leads: places per district from a search-capable model (leads only, checked below).
  const leads = want("research") ? await webLeads(o.city).catch((e: unknown) => { errors.push(`web leads: ${String(e)}`); return { seeds: [], districts: 0 }; }) : { seeds: [], districts: 0 };
  counts.web_lead_districts = leads.districts; counts.web_lead_places = leads.seeds.length;

  // Web search results (seed file and/or the search provider).
  const seeds = [...seedFile(o.city.slug), ...leads.seeds];
  await appendSearchSeeds(seeds, o.city.name);
  counts.search_seeds = seeds.length; counts.search_matched = 0; counts.search_new = 0;
  const pending = seedCandidates(seeds, cands, ctx, unlocated);
  // Seeds that match nothing: read their site for the address, then find the Overture place at that address.
  await pool(pending, 8, (sc) => locatePending(sc, cands, inside, ctx, unlocated));
  counts.candidates = cands.length;
  counts.unlocated = unlocated.length;
  return { inside, cands, unlocated };
}

async function appendSearchSeeds(seeds: ReturnType<typeof seedFile>, cityName: string) {
  if (searchEnabled()) for (const q of [`specialty coffee ${cityName}`, `Kaffeerösterei Café ${cityName}`, `third wave coffee ${cityName}`, `Filterkaffee ${cityName}`])
    for (const r of await search(q)) seeds.push({ name: r.title.split(/[|–-]/)[0].trim(), website: new URL(r.url).origin + "/", found_via: q });
}

async function attachWikidata(ctx: DiscoveryContext, cands: Candidate[], unlocated: Unlocated[]) {
  const { area, counts, errors } = ctx;
  // Wikidata only attaches ids and images to places we already have.
  try {
    const wd = (await wikidataCafes(area.bbox)).filter((w) => area.contains(w) && !w.closed);
    counts.wikidata = wd.length; counts.wikidata_matched = 0;
    for (const w of wd) {
      const hit = cands.find((c) => c.lat !== undefined && c.lon !== undefined && nameSim(c.name, w.name) >= 0.75 && distanceM({ lat: c.lat, lon: c.lon }, w) <= 150);
      if (hit) { hit.wikidata = w.qid; hit.image ??= w.image; hit.website ??= w.website; hit.origins.push({ via: "wikidata", ref: w.qid }); counts.wikidata_matched++; }
      else unlocated.push({ via: "wikidata", name: w.name, reason: "no matching Overture place" });
    }
  } catch (e) { errors.push(`wikidata: ${e}`); }

}

function seedCandidates(seeds: ReturnType<typeof seedFile>, cands: Candidate[], ctx: DiscoveryContext, unlocated: Unlocated[]) {
  const { counts } = ctx;
  const pending: Candidate[] = [];
  for (const s of seeds) {
    const sc: Candidate = { key: `search:${s.name}`, name: s.name, website: s.website ?? undefined, overtureIds: [], origins: [{ via: "web-search", ref: s.found_via }] };
    const { hit, byName } = seedMatch(s, cands);
    if (hit) { attachSeed(hit, sc, counts); continue; }
    if (nonCoffeeName(s.name) || SEASONAL.test(s.name)) { unlocated.push({ via: "web-search", name: s.name, reason: "not a coffee place (name)" }); continue; }
    if (s.website) pending.push(sc);
    else unlocated.push({ via: "web-search", name: s.name, reason: byName.length > 1 ? "ambiguous name" : "no website and no Overture match" });
  }
  return pending;
}

function attachBranches(sc: Candidate, site: Site, cands: Candidate[], inside: Row[], ctx: DiscoveryContext, unlocated: Unlocated[]) {
  const { counts } = ctx;
  // Several locations on one site: every Overture place in the city whose street appears on the site and whose
  // name or website fits is a branch.
  const host = ownHost(site.pages[0].url);
  const siteText = fold(site.pages.map((pg) => pg.doc.text).join(" ")).replace(/\s+/g, "");
  const branches = inside.filter((r) => r.status !== "permanently_closed" && r.street && (nameSim(r.name, sc.name) >= 0.5 || (!!host && ownHost(r.websites[0]) === host)) && streetStemIn(r.street, siteText));
  if (!branches.length) { unlocated.push({ via: "web-search", name: sc.name, reason: "several locations on the site, none found in Overture" }); return; }
  for (const b of branches) {
    const bc = fromOverture(b); bc.website = sc.website; bc.origins.push(...sc.origins);
    const hit = cands.find((x) => samePlace(x, bc));
    if (hit) { if (!ownHost(hit.website)) hit.website = sc.website; hit.origins.push(...sc.origins); counts.search_matched++; }
    else { cands.push(bc); counts.search_new++; }
  }
}

async function locatePending(sc: Candidate, cands: Candidate[], inside: Row[], ctx: DiscoveryContext, unlocated: Unlocated[]) {
  const { area, counts, cityNames, country, enrichSite } = ctx;
  const e = await enrichSite(sc, sc.website ?? "", cityNames, country);
  if (e.site && multiSite(e)) { attachBranches(sc, e.site, cands, inside, ctx, unlocated); return; }
  const street = candidateStreet(e);
  if (!siteReady(e) || !street) { unlocated.push({ via: "web-search", name: sc.name, reason: missingAddressReason(e) }); return; }
  sc.street = street; sc.postcode = candidatePostcode(e);
  const placed = locate(sc, cands, inside, area.contains);
  if (placed === "ambiguous") { unlocated.push({ via: "web-search", name: sc.name, reason: "ambiguous" }); return; }
  if (!placed) { await attachCoordinates(sc, e, cands, ctx, unlocated); return; }
  attachLocated(sc, placed, cands, counts);
}

function seedMatch(s: ReturnType<typeof seedFile>[number], cands: Candidate[]) {
  const host = ownHost(s.website);
  const byHost = host ? cands.filter((c) => ownHost(c.website) === host) : [];
  const byName = cands.filter((c) => nameSim(c.name, s.name) >= 0.85);
  const hit = byHost.length === 1 ? byHost[0] : byHost.length === 0 && byName.length === 1 ? byName[0] : null;
  return { hit, byName };
}

async function attachCoordinates(sc: Candidate, e: Enriched, cands: Candidate[], ctx: DiscoveryContext, unlocated: Unlocated[]) {
  const { area, counts, siteCache } = ctx;
  // Not in Overture: coordinates the place publishes on its own site, else the position of another Overture record
  // with exactly the confirmed street, house number and postcode (the same building).
  const geo = await seedCoordinates(sc, e, ctx);
  if (geo && area.contains(geo)) {
    Object.assign(sc, geo); sc.geoUrl = geo.url; sc.geoVia = geo.url.includes("overturemaps") ? "Overture record at the same street, number and postcode" : "coordinates published on the place's own website"; sc.origins.push({ via: "website JSON-LD geo", url: geo.url });
    siteCache.set(`${sc.website}|${sc.street}`, e); cands.push(sc); counts.search_new++; counts.search_geo_from_site = (counts.search_geo_from_site ?? 0) + 1;
  } else unlocated.push({ via: "web-search", name: sc.name, reason: "no Overture place at the site's address and no coordinates on the site" });
}

function missingAddressReason(e: Enriched): string {
  if (!e.site?.ok) return `site: ${e.site?.error ?? e.error}`;
  return e.match ? "no address on site" : `site does not match: ${e.error}`;
}

const multiSite = (e: Enriched) => !!e.site?.ok && !!e.match && e.multi;

function attachSeed(hit: Candidate, seed: Candidate, counts: Record<string, number>) {
  if (!hit.website && seed.website) hit.website = seed.website;
  hit.origins.push(...seed.origins); counts.search_matched++;
}

function candidateStreet(e: Enriched) { return stringFact(e.facts, "street_address")?.value; }
function candidatePostcode(e: Enriched) { return stringFact(e.facts, "postal_code")?.value; }

async function seedCoordinates(sc: Candidate, e: Enriched, ctx: DiscoveryContext) {
  return siteGeo(e.site?.pages ?? []) ?? addressPoint(ctx.points ??= await overtureAddressPoints(ctx.o.city.slug), sc.street ?? "", sc.postcode);
}

function siteReady(e: Enriched) { return !!e.site?.ok; }

function attachLocated(sc: Candidate, placed: { c: Candidate; isNew: boolean }, cands: Candidate[], counts: Record<string, number>) {
  if (placed.isNew) { cands.push(placed.c); counts.search_new++; placed.c.website = sc.website; }
  else { counts.search_matched++; if (!ownHost(placed.c.website)) placed.c.website = sc.website; placed.c.origins.push(...sc.origins); }
}
