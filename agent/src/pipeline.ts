// One data agent run for one city: discover, filter, enrich, find websites, images, write. See docs/agent.md.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Candidate } from "./candidate";
import { type City, cities, cityArea } from "./cities";
import { CACHE } from "./config";
import { closeBrowser, pool, stats as fetchStats } from "./pages";
import { readCity, writeCity } from "./dataset";
import { dedupe, mergeInto, samePlace } from "./dedupe";
import { describe } from "./describe";
import { postcodesOnSite, propose, siteMatches, type Verified, verify } from "./extract";
import { distanceM } from "./geo";
import { opensOnSunday } from "./hours";
import { newId } from "./ids";
import { findImage } from "./images";
import { BudgetExceeded, usage } from "./llm";
import { llm } from "./config";
import { fold, nameSim, ownHost, parseStreet, sameStreet } from "./names";
import { loadState, type Job, queueFor, saveState } from "./queue";
import { search, searchEnabled, searchLog, seedFile, websiteCandidates, websiteSeeds } from "./search";
import { fetchSite, type Site, type SitePage } from "./site";
import { type OvertureRow, licenceStats, overturePlaces } from "./discovery/overture";
import { roasterIsSpecialty, roasterMentions, roasters } from "./discovery/roasters";
import { wikidataCafes } from "./discovery/wikidata";
import { isChain, nonCoffeeName, tier } from "./tier";
import { lintPlace, mergeDuplicates, repair } from "./lint";
import { type Research, research } from "./research";
import { cleanName as signName, cleanStreet, isPlatformUrl } from "./rules";

export type RunOptions = { city: City; limit: number; dryRun: boolean; stages?: string[] };
type Row = OvertureRow & { coffee: boolean };
type Enriched = { site?: Site; match?: string; facts: Verified[]; rejected: any[]; multi: boolean; websiteTried: string[]; websiteSearch?: string; error?: string; injectionLines: number };
export type Change = { id: string; name: string; field: string; old: any; new: any; url?: string; quote?: string };

const iso = (d: Date) => d.toISOString().replace(/\.\d+Z$/, "Z");

export async function run(o: RunOptions) {
  const now = new Date();
  const runId = iso(now).replace(/[:]/g, "");
  const timing: Record<string, number> = {};
  const stage = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const t = Date.now();
    try { return await fn(); } finally { timing[name] = (timing[name] ?? 0) + (Date.now() - t) / 1000; console.error(`[${name}] ${((Date.now() - t) / 1000).toFixed(1)} s`); }
  };
  const want = (s: string) => !o.stages || o.stages.includes(s);
  const errors: string[] = [];
  const country = o.city.country;
  const cityNames = [...new Set([o.city.name, o.city.slug[0].toUpperCase() + o.city.slug.slice(1)])];

  // ---------- 1. Discover ----------
  const area = await cityArea(o.city);
  const counts: Record<string, any> = {};
  const { inside, cands, unlocated } = await stage("discover", async () => {
    const { rows, dropped } = await overturePlaces(o.city.slug, area.bbox);
    const inside = rows.filter((r) => area.contains(r));
    counts.overture_rows_in_city = inside.length;
    counts.overture_dropped_licence = dropped;
    const coffee = inside.filter((r) => r.coffee && r.status !== "permanently_closed").sort((a, b) => b.confidence - a.confidence);
    counts.overture_coffee = coffee.length;
    counts.overture_coffee_closed = inside.filter((r) => r.coffee && r.status === "permanently_closed").length;
    const cands = dedupe(coffee.map(fromOverture));
    counts.overture_coffee_deduped = cands.length;
    const unlocated: any[] = [];

    // Wikidata only attaches ids and images to places we already have.
    try {
      const wd = (await wikidataCafes(area.bbox)).filter((w) => area.contains(w) && !w.closed);
      counts.wikidata = wd.length; counts.wikidata_matched = 0;
      for (const w of wd) {
        const hit = cands.find((c) => c.lat != null && nameSim(c.name, w.name) >= 0.75 && distanceM(c as any, w) <= 150);
        if (hit) { hit.wikidata = w.qid; hit.image ??= w.image; hit.website ??= w.website; hit.origins.push({ via: "wikidata", ref: w.qid }); counts.wikidata_matched++; }
        else unlocated.push({ via: "wikidata", name: w.name, reason: "no matching Overture place" });
      }
    } catch (e) { errors.push(`wikidata: ${e}`); }

    // Roasters' partner and own-café pages.
    counts.roaster_pages = 0; counts.roaster_mentions = 0; counts.roaster_matched = 0; counts.roaster_new = 0; counts.roaster_rejected = 0;
    for (const r of roasters()) {
      try {
        const spec = await roasterIsSpecialty(r);
        const { mentions, rejected, pagesOk } = await roasterMentions(r, cityNames);
        counts.roaster_pages += pagesOk; counts.roaster_rejected += rejected;
        for (const m of mentions) {
          counts.roaster_mentions++;
          const mc: Candidate = { key: `roaster:${r.name}:${m.name}`, name: m.name, street: m.street, postcode: m.postcode, website: m.website, overtureIds: [], roasters: [{ name: r.name, url: m.page, quote: m.quote, specialty: spec.specialty }], origins: [{ via: "roaster-page", url: m.page, quote: m.quote }] };
          (mc as any).roasterOwn = m.own; (mc as any).roasterSpecialty = spec.specialty;
          const placed = locate(mc, cands, inside, area.contains);
          if (placed === "ambiguous" || !placed) { unlocated.push({ via: `roaster:${r.name}`, name: m.name, reason: placed ?? "no Overture place at this name/address" }); continue; }
          if (placed.isNew) { cands.push(placed.c); counts.roaster_new++; } else counts.roaster_matched++;
          const target = placed.c;
          if (target !== mc) mergeRoaster(target, mc);
        }
      } catch (e) { if (e instanceof BudgetExceeded) throw e; errors.push(`roaster ${r.name}: ${e}`); }
    }

    // Web search results (seed file and/or the search provider).
    const seeds = seedFile(o.city.slug);
    if (searchEnabled()) for (const q of [`specialty coffee ${o.city.name}`, `Kaffeerösterei Café ${o.city.name}`, `third wave coffee ${o.city.name}`, `Filterkaffee ${o.city.name}`])
      for (const r of await search(q)) seeds.push({ name: r.title.split(/[|–-]/)[0].trim(), website: new URL(r.url).origin + "/", found_via: q });
    counts.search_seeds = seeds.length; counts.search_matched = 0; counts.search_new = 0;
    const pending: Candidate[] = [];
    for (const s of seeds) {
      const sc: Candidate = { key: `search:${s.name}`, name: s.name, website: s.website ?? undefined, overtureIds: [], roasters: [], origins: [{ via: "web-search", ref: s.found_via }] };
      const host = ownHost(s.website);
      const byHost = host ? cands.filter((c) => ownHost(c.website) === host) : [];
      const byName = cands.filter((c) => nameSim(c.name, s.name) >= 0.85);
      const hit = byHost.length === 1 ? byHost[0] : byHost.length === 0 && byName.length === 1 ? byName[0] : null;
      if (hit) { if (!hit.website && s.website) hit.website = s.website; hit.origins.push(...sc.origins); counts.search_matched++; continue; }
      if (s.website) pending.push(sc);
      else unlocated.push({ via: "web-search", name: s.name, reason: byName.length > 1 ? "ambiguous name" : "no website and no Overture match" });
    }
    // Seeds that match nothing: read their site for the address, then find the Overture place at that address.
    await pool(pending, 8, async (sc) => {
      const e = await enrichSite(sc, sc.website!, cityNames, country);
      if (e.site?.ok && e.match && e.multi) {
        // Several locations on one site: every Overture place in the city whose street appears on the site and whose
        // name or website fits is a branch.
        const host = ownHost(e.site.pages[0].url);
        const siteText = fold(e.site.pages.map((pg) => pg.doc.text).join(" ")).replace(/\s+/g, "");
        const branches = inside.filter((r) => r.status !== "permanently_closed" && r.street && (nameSim(r.name, sc.name) >= 0.5 || (!!host && ownHost(r.websites[0]) === host)) && streetStemIn(r.street, siteText));
        if (!branches.length) { unlocated.push({ via: "web-search", name: sc.name, reason: "several locations on the site, none found in Overture" }); return; }
        for (const b of branches) {
          const bc = fromOverture(b); bc.website = sc.website; bc.origins.push(...sc.origins);
          const hit = cands.find((x) => samePlace(x, bc));
          if (hit) { if (!ownHost(hit.website)) hit.website = sc.website; hit.origins.push(...sc.origins); counts.search_matched++; }
          else { cands.push(bc); counts.search_new++; }
        }
        return;
      }
      const street = e.facts.find((f) => f.field === "street_address")?.value;
      if (!e.site?.ok || !street) { unlocated.push({ via: "web-search", name: sc.name, reason: e.site?.ok ? (e.match ? "no address on site" : `site does not match: ${e.error}`) : `site: ${e.site?.error ?? e.error}` }); return; }
      sc.street = street; sc.postcode = e.facts.find((f) => f.field === "postal_code")?.value;
      const placed = locate(sc, cands, inside, area.contains);
      if (placed === "ambiguous") { unlocated.push({ via: "web-search", name: sc.name, reason: "ambiguous" }); return; }
      if (!placed) {
        // Not in Overture: coordinates published by the place itself (schema.org geo on its own site) still count.
        const geo = siteGeo(e.site.pages);
        if (geo && area.contains(geo)) {
          Object.assign(sc, geo); (sc as any).geoUrl = geo.url; sc.origins.push({ via: "website JSON-LD geo", url: geo.url });
          siteCache.set(`${sc.website}|${sc.street}`, e); cands.push(sc); counts.search_new++; counts.search_geo_from_site = (counts.search_geo_from_site ?? 0) + 1;
        } else unlocated.push({ via: "web-search", name: sc.name, reason: "no Overture place at the site's address and no coordinates on the site" });
        return;
      }
      if (placed.isNew) { cands.push(placed.c); counts.search_new++; placed.c.website = sc.website; } else { counts.search_matched++; if (!ownHost(placed.c.website)) placed.c.website = sc.website; placed.c.origins.push(...sc.origins); }
    });
    counts.candidates = cands.length;
    counts.unlocated = unlocated.length;
    return { inside, cands, unlocated };
  });

  // ---------- existing records, ids and queue ----------
  const doc = readCity(o.city);
  const state = loadState(o.city.slug);
  const taken = new Set(doc.places.map((p) => p.id));
  const byId = new Map(doc.places.map((p) => [p.id, p]));
  const candFor = new Map<string, Candidate>();
  for (const c of cands) {
    const rec = doc.places.find((p) => !p.merged_into && (c.overtureIds.includes(p.xref?.overture) || samePlace(c, { ...p.location, name: p.name, street: p.address?.street_address, website: p.links?.website, overtureIds: [], roasters: [], origins: [], key: "" })));
    const id = rec?.id ?? newId(taken);
    if (!rec) byId.set(id, null);
    if (!candFor.has(id)) candFor.set(id, c); else mergeInto(candFor.get(id)!, c);
  }
  // Websites found by search for places that had none (stage 4 run elsewhere): tried after the known ones.
  const found = websiteSeeds(o.city.slug);
  counts.website_seeds = found.size;
  for (const [id, url] of found) {
    const c = candFor.get(id);
    if (c && url !== c.website) (c as any).altWebsites = [...((c as any).altWebsites ?? []), url];
  }

  // New places first (never enriched), then the ledger-driven queue for existing ones.
  const jobs: Job[] = [
    ...[...candFor.keys()].filter((id) => !byId.get(id)).map((id) => ({ id, reason: "never_enriched" as const, mode: "full" as const })),
    ...queueFor(doc.places, state, now),
  ].filter((j, i, a) => a.findIndex((x) => x.id === j.id) === i).slice(0, o.limit);
  counts.queue = jobs.length;

  // ---------- 2-4. Filter, enrich, find websites ----------
  const results = new Map<string, Enriched>();
  let budgetStop: string | null = null;
  await stage("enrich", async () => {
    await pool(jobs, 12, async (job) => {
      if (budgetStop) return;
      const c = candFor.get(job.id) ?? fromRecord(byId.get(job.id));
      if (!c) return;
      // Filter: chains and clearly non-coffee businesses without a website are not fetched.
      const urls = [c.website, ...(c as any).altWebsites ?? []].filter((u) => u && !isPlatformUrl(u)) as string[]; // never a directory or platform page
      if (!urls.length && (isChain(c.name, c.brand) || nonCoffeeName(c.name))) { results.set(job.id, { facts: [], rejected: [], multi: false, websiteTried: [], injectionLines: 0 }); return; }
      try {
        let e: Enriched | null = null;
        const tried: string[] = [];
        for (const u of urls) {
          tried.push(u);
          const r = siteCache.get(`${u}|${c.street ?? ""}`) ?? await enrichSite(c, u, cityNames, country);
          if (r.site?.ok && r.match) { e = r; break; }
          e ??= r;
        }
        if ((!e || !e.match) && want("websites") && searchEnabled() && !isChain(c.name, c.brand) && !nonCoffeeName(c.name)) {
          const t0 = Date.now();
          for (const u of await websiteCandidates(c.name, c.street, o.city.name)) {
            if (tried.includes(u)) continue;
            tried.push(u);
            const r = await enrichSite(c, u, cityNames, country);
            if (r.site?.ok && r.match) { e = { ...r, websiteSearch: "found" }; break; }
          }
          timing.websites = (timing.websites ?? 0) + (Date.now() - t0) / 1000;
          if (!e?.match) e = { ...(e ?? { facts: [], rejected: [], multi: false, injectionLines: 0 }), websiteSearch: "failed" } as Enriched;
        }
        // Research: search the web for this place and follow leads to its own pages and to roasteries naming it.
        if (want("research") && (searchEnabled() || !!llm.researchModel) && !isChain(c.name, c.brand) && !nonCoffeeName(c.name) && needsResearch(c, e)) {
          const t0 = Date.now();
          const res = await research(c, { cityName: o.city.name, country, site: e?.match ? e.site : undefined });
          researchLog.set(job.id, res);
          if (res.website && !e?.match) {
            tried.push(res.website);
            const r = await enrichSite(c, res.website, cityNames, country);
            if (r.site?.ok && r.match) e = { ...r, websiteSearch: "research" };
          }
          if (e?.match && res.extraPages.length) e = { ...(await enrichSite(c, e.site!.start, cityNames, country, res.extraPages)), websiteSearch: e.websiteSearch };
          for (const rr of res.roasters) if (!c.roasters.some((x) => nameSim(x.name, rr.name) >= 0.85)) { c.roasters.push(rr); c.origins.push({ via: "research: roastery page", url: rr.url, quote: rr.quote }); }
          timing.research = (timing.research ?? 0) + (Date.now() - t0) / 1000;
        }
        results.set(job.id, { ...(e ?? { facts: [], rejected: [], multi: false, injectionLines: 0 }), websiteTried: tried });
      } catch (err) {
        if (err instanceof BudgetExceeded) { budgetStop = err.message; return; }
        errors.push(`${c.name}: ${String(err).slice(0, 200)}`);
      }
    });
  });

  // ---------- build records ----------
  const changes: Change[] = [];
  const runLog: any[] = [];
  const conflicts: { id: string; name: string; reason: string }[] = [];
  const labels = new Set<string>();
  const written: any[] = [];
  await stage("build", async () => {
    for (const job of jobs) {
      const e = results.get(job.id);
      if (!e) continue; // not processed (budget stop or error): stays queued
      const c = candFor.get(job.id) ?? fromRecord(byId.get(job.id))!;
      const old = byId.get(job.id) ?? null;
      const built = buildRecord(job, c, e, old, { now, country, cityName: o.city.name, inside });
      runLog.push({ id: job.id, name: c.name, reason: job.reason, origins: c.origins, site: e.site ? { start: e.site.start, ok: e.site.ok, error: e.site.error, pages: e.site.pages.map((p) => ({ url: p.url, fetchedAt: p.fetchedAt, rendered: p.rendered })) } : null, match: e.match, websiteSearch: e.websiteSearch, values: built.provenance, rejected: e.rejected.map((r: any) => ({ field: r.field, value: r.value, reason: r.reason })), conflict: built.conflict, tierWhy: built.tierWhy, research: researchLog.get(job.id) ? { queries: researchLog.get(job.id)!.queries, opened: researchLog.get(job.id)!.opened } : undefined });
      if (built.conflict) { conflicts.push({ id: job.id, name: c.name, reason: built.conflict }); state.conflicts[job.id] = built.conflict; labels.add("conflict"); }
      else delete state.conflicts[job.id];
      if (!built.record) continue;
      state.enriched[job.id] = iso(now);
      const r = built.record;
      for (const ch of diff(old, r, built.provenance)) changes.push({ id: r.id, name: r.name, ...ch });
      if (old && old.specialty_tier !== r.specialty_tier && old.specialty_tier !== "unknown") labels.add("tier-change");
      if (r.status === "closed" && old?.status !== "closed") labels.add("closure");
      if (old?.links?.website && r.links?.website && ownHost(old.links.website) !== ownHost(r.links.website)) labels.add("new-domain");
      if (!old && r.links?.website) labels.add("new-domain");
      byId.set(r.id, r);
      written.push(r);
    }
  });

  // ---------- 6. Images (tier A) ----------
  await stage("images", async () => {
    if (!want("images")) return;
    await pool(written.filter((r) => r.specialty_tier === "A" && !r.image), 4, async (r) => {
      try {
        const c = candFor.get(r.id);
        const hit = await findImage({ name: r.name, lat: r.location.lat, lon: r.location.lon, wikidataImage: c?.image });
        if (hit) { r.image = hit.image; changes.push({ id: r.id, name: r.name, field: "image", old: undefined, new: hit.image.url, url: hit.image.source_url, quote: hit.how }); labels.add("image"); }
      } catch (e) { errors.push(`image ${r.name}: ${e}`); }
    });
  });

  await closeBrowser();

  // ---------- safeguards before writing ----------
  // Same rules as CI's linter: safe repairs, duplicates become tombstones, and a record that still fails is not written
  // (the previous version stays, or a new place waits for a human).
  const lintRejected: { id: string; name: string; reason: string }[] = [];
  for (const r of written) for (const n of repair(r)) changes.push({ id: r.id, name: r.name, field: "lint repair", old: undefined, new: n });
  for (const n of mergeDuplicates([...byId.values()].filter(Boolean))) { changes.push({ id: n.slice(0, 13), name: "", field: "merged_into", old: undefined, new: n }); labels.add("duplicate"); }
  for (const r of written) {
    const errs = lintPlace(r, country, now).filter((f) => f.level === "error");
    if (!errs.length) continue;
    const old = doc.places.find((p) => p.id === r.id) ?? null;
    byId.set(r.id, old);
    lintRejected.push({ id: r.id, name: r.name, reason: errs.map((f) => `${f.rule}: ${f.message}`).join("; ") });
    labels.add("lint");
  }
  for (const x of lintRejected) conflicts.push({ id: x.id, name: x.name, reason: `not written, lint: ${x.reason}` });
  counts.lint_rejected = lintRejected.length;

  const places = [...byId.values()].filter(Boolean);
  let file: string | null = null;
  if (!o.dryRun && written.length) { file = writeCity(o.city, { places }); saveState(o.city.slug, state); }

  const metrics = computeMetrics({ places, written, jobs, results, changes, errors, timing, counts, conflicts, unlocated, budgetStop, runId });
  const dir = join(CACHE, "runs", runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${o.city.slug}.log.json`), JSON.stringify({ metrics, runLog, unlocated, conflicts, searchLog }, null, 1));
  writeFileSync(join(dir, `${o.city.slug}.metrics.json`), JSON.stringify(metrics, null, 1));
  return { file, metrics, changes, labels: [...labels], conflicts, runLog, dir };
}

// ---------------- helpers ----------------

const researchLog = new Map<string, Research>();

/** Research only where it can add something: no matching website yet, or a core fact or the specialty evidence is missing. */
function needsResearch(c: Candidate, e: Enriched | null) {
  if (!e?.match) return true;
  const has = (f: string) => e.facts.some((x) => x.field === f);
  return !has("opening_hours") || !has("serving.espresso") || !has("serving.filter") || (!has("roasts_own_beans") && !has("roaster") && !c.roasters.length);
}

const siteCache = new Map<string, Enriched>(); // key: url|street, because facts are verified for one location

function streetStemIn(street: string, foldedText: string) {
  const s = parseStreet(street)?.street.replace(/strasse$|platz$|weg$|allee$|ring$|gasse$/, "");
  return !!s && s.length >= 4 && foldedText.includes(s);
}

/** schema.org GeoCoordinates published in the site's own JSON-LD. */
function siteGeo(pages: { url: string; doc: { jsonld: string } }[]) {
  for (const p of pages) {
    const m = p.doc.jsonld.match(/"latitude"\s*:\s*"?(-?\d{1,2}\.\d{3,})"?[\s\S]{0,80}?"longitude"\s*:\s*"?(-?\d{1,3}\.\d{3,})"?/);
    if (m) return { lat: +m[1], lon: +m[2], url: p.url };
  }
  return null;
}

// "THE BARN Coffee Roasters Berlin" in Munich: a trailing name of another configured city is not part of this branch's name.
const OTHER_CITY = new RegExp(`[\\s,–-]+(${cities.map((c) => c.name).concat(["Berlin", "Hamburg", "Munich", "Cologne", "Vienna", "Zurich"]).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`, "i");
export function cleanName(name: string, cityName: string) {
  const m = name.match(OTHER_CITY);
  return m && fold(m[1]) !== fold(cityName) && !(cityName === "München" && /^munich$/i.test(m[1])) ? name.slice(0, m.index).trim() : name;
}

async function enrichSite(c: Candidate, url: string, _cityNames: string[], country: string, extraPages: SitePage[] = []): Promise<Enriched> {
  const site = await fetchSite(url);
  for (const p of extraPages) if (site.ok && !site.pages.some((x) => x.url === p.url)) site.pages.push(p);
  if (!site.ok) return { site, facts: [], rejected: [], multi: false, websiteTried: [url], injectionLines: 0 };
  const host = new URL(site.pages[0].url).hostname.replace(/^www\./, "");
  const m = siteMatches(site.pages, c, host);
  if (!m.ok) return { site, facts: [], rejected: [], multi: false, websiteTried: [url], error: m.reason, injectionLines: 0 };
  const multi = postcodesOnSite(site.pages, country).size > 1;
  const address = [c.street, c.postcode].filter(Boolean).join(", ");
  let p = await propose(c.name, address, site.pages);
  if (p.error) p = await propose(c.name, address, site.pages, llm.escalationModel); // hard case: escalate once
  const v = verify(p.facts, site.pages, { street: c.street, postcode: c.postcode, country, ownName: c.name, multiLocation: multi });
  return { site, match: m.reason, facts: v.kept, rejected: v.rejected, multi, websiteTried: [url], error: p.error ?? undefined, injectionLines: p.removed };
}

function fromOverture(r: Row): Candidate {
  const webs = r.websites.filter((w) => /^https?:\/\//.test(w));
  const c: Candidate = { key: `ov:${r.id}`, name: r.name, lat: r.lat, lon: r.lon, street: r.street ?? undefined, postcode: r.postcode ?? undefined, website: webs[0], overtureIds: [r.id], overtureStatus: r.status, overtureCoffee: r.coffee, category: r.category, brand: r.brand, roasters: [], origins: [{ via: "overture", ref: r.id }] };
  (c as any).altWebsites = webs.slice(1);
  (c as any).socials = r.socials;
  return c;
}

function fromRecord(p: any): Candidate | null {
  if (!p) return null;
  return { key: p.id, name: p.name, lat: p.location.lat, lon: p.location.lon, street: p.address?.street_address, postcode: p.address?.postal_code, website: p.links?.website, overtureIds: p.xref?.overture ? [p.xref.overture] : [], roasters: [], origins: [{ via: "dataset", ref: p.id }] };
}

function mergeRoaster(target: Candidate, m: Candidate) {
  for (const r of m.roasters) if (!target.roasters.some((x) => x.name === r.name)) target.roasters.push(r);
  if ((m as any).roasterOwn) (target as any).roasterOwn = { name: m.roasters[0].name, url: m.roasters[0].url, quote: m.roasters[0].quote };
  (target as any).roasterSpecialty ||= (m as any).roasterSpecialty;
  target.website ??= m.website;
  target.origins.push(...m.origins);
}

/** Find the place a mention (no coordinates) refers to: an existing candidate, or an Overture place in the city at that address. */
function locate(m: Candidate, cands: Candidate[], inside: Row[], contains: (p: any) => boolean): { c: Candidate; isNew: boolean } | "ambiguous" | null {
  const host = ownHost(m.website);
  const fits = (name: string, street?: string | null, website?: string | null) =>
    m.street ? sameStreet(m.street, street) && (nameSim(m.name, name) >= 0.4 || (!!host && host === ownHost(website))) : nameSim(m.name, name) >= 0.85;
  const inCands = cands.filter((c) => fits(c.name, c.street, c.website));
  if (inCands.length === 1) return { c: inCands[0], isNew: false };
  if (inCands.length > 1) return m.street ? { c: inCands.sort((a, b) => nameSim(m.name, b.name) - nameSim(m.name, a.name))[0], isNew: false } : "ambiguous";
  const rows = inside.filter((r) => r.status !== "permanently_closed" && fits(r.name, r.street, r.websites[0]) && contains(r)).sort((a, b) => b.confidence - a.confidence);
  if (!rows.length) return null;
  if (!m.street && rows.length > 1) return "ambiguous";
  const c = fromOverture(rows[0]);
  mergeRoaster(c, m);
  for (const k of ["street", "postcode"] as const) if (m[k]) c[k] ??= m[k];
  return { c, isNew: true };
}

const set = (o: any, path: string, v: any) => { const ks = path.split("."); let t = o; for (const k of ks.slice(0, -1)) t = t[k] ??= {}; t[ks.at(-1)!] = v; };
const LEGAL = /(GmbH & Co\.? KG|gGmbH|GmbH|UG \(haftungsbeschränkt\)|UG|AG|KG|OHG|SE|eG|e\.\s?V\.|Ltd\.?)$/;

function buildRecord(job: Job, c: Candidate, e: Enriched, old: any, ctx: { now: Date; country: string; cityName: string; inside: Row[] }) {
  const prov: Record<string, { value: any; via: string; url?: string; quote?: string }> = {};
  const facts = new Map<string, Verified>();
  for (const f of e.facts) if (f.field !== "roaster" && f.field !== "reusable_cup") facts.set(f.field, f);
  const fact = (k: string) => facts.get(k);
  const ovUrl = (id: string) => `https://explore.overturemaps.org/#id=${id}`;
  // A full refresh rebuilds the record from what is confirmed now, so values that are no longer supported disappear.
  // The old record is kept only for the quarterly refresh and when the site could not be read this time.
  const siteUnreadable = !!e.site && !e.site.ok && !e.site.dead;
  const r: any = old && (job.mode === "refresh" || siteUnreadable) ? structuredClone(old) : { id: job.id, ...(old?.image ? { image: old.image } : {}) };
  const siteOk = !!(e.site?.ok && e.match);
  const page0 = siteOk ? e.site!.pages[0] : null;
  let conflict: string | undefined;

  // Address and coordinates: Overture's position; the site's address wins when it is the same street.
  const siteStreet = cleanStreet(fact("street_address")?.value) ?? undefined; // "street number" only, never extra text
  const sitePc = fact("postal_code")?.value as string | undefined;
  let lat = c.lat, lon = c.lon, overtureId = c.overtureIds[0];
  let street = cleanStreet(c.street) ?? undefined, postcode = c.postcode;
  if (siteStreet && !e.multi && !sameStreet(siteStreet, c.street)) {
    // The site gives another address: maybe the place moved and Overture has it there too.
    const moved = ctx.inside.filter((x) => x.status !== "permanently_closed" && sameStreet(x.street, siteStreet) && (nameSim(x.name, c.name) >= 0.5 || ownHost(x.websites[0]) === ownHost(c.website)));
    if (moved.length) { lat = moved[0].lat; lon = moved[0].lon; overtureId = moved[0].id; street = siteStreet; postcode = sitePc ?? moved[0].postcode ?? undefined; prov.location = { value: [lat, lon], via: "overture (record at the address on the website)", url: ovUrl(moved[0].id) }; }
    else if (c.street) conflict = `website gives ${siteStreet}, Overture ${c.street}`;
    else street = undefined; // no coordinates we can trust for the site's address
  } else if (siteStreet) { street = siteStreet; if (sitePc) postcode = sitePc; }
  if (lat == null || lon == null) return { record: null, provenance: prov, conflict: conflict ?? "no coordinates", tierWhy: "" };
  if (conflict && !old) return { record: null, provenance: prov, conflict, tierWhy: "" };

  const pcOk = (pc?: string) => !!pc && (ctx.country === "DE" ? /^\d{5}$/ : /^\d{4}$/).test(pc) && ctx.inside.some((x) => x.postcode === pc);
  r.name = signName(old?.name ?? cleanName(c.name, ctx.cityName)); prov.name ??= { value: r.name, via: c.overtureIds.length ? "overture" : c.origins[0].via, url: c.overtureIds[0] ? ovUrl(c.overtureIds[0]) : c.origins[0].url };
  r.location = { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 };
  prov.location ??= (c as any).geoUrl && !overtureId ? { value: [r.location.lat, r.location.lon], via: "schema.org geo on the place's own website", url: (c as any).geoUrl } : { value: [r.location.lat, r.location.lon], via: "overture", url: overtureId ? ovUrl(overtureId) : undefined };
  const addr: any = { country_code: ctx.country, locality: ctx.cityName };
  if (street && /\d/.test(street) && !conflict) { addr.street_address = street; prov["address.street_address"] = siteStreet === street ? { value: street, via: "website", url: fact("street_address")!.url, quote: fact("street_address")!.quote } : { value: street, via: "overture", url: ovUrl(overtureId!) }; }
  if (pcOk(postcode) && addr.street_address) { addr.postal_code = postcode; prov["address.postal_code"] = sitePc === postcode ? { value: postcode, via: "website", url: fact("postal_code")!.url, quote: fact("postal_code")!.quote } : { value: postcode, via: "overture", url: ovUrl(overtureId!) }; }
  prov["address.locality"] = { value: ctx.cityName, via: "point inside the official city boundary" };
  r.address = old && conflict ? old.address : { ...(old?.address ?? {}), ...addr };

  // Status.
  const closed = fact("closed_permanently"), temp = fact("temporarily_closed");
  if (closed) { r.status = "closed"; prov.status = { value: "closed", via: "website", url: closed.url, quote: closed.quote }; }
  else if (temp) { r.status = "temporarily_closed"; prov.status = { value: "temporarily_closed", via: "website", url: temp.url, quote: temp.quote }; }
  else if (siteOk) { r.status = "open"; r.last_verified_at = iso(new Date(page0!.fetchedAt)); prov.status = { value: "open", via: "website names the place and its address", url: page0!.url, quote: e.match }; }
  else if (old?.status === "open" && e.site && !e.site.ok && e.site.dead) { r.status = "unverified"; conflict ??= `website dead: ${e.site.error}`; prov.status = { value: "unverified", via: "website unreachable", url: e.site.start }; }
  else r.status = old?.status ?? "unverified";
  if (r.status !== "closed") delete r.closed_on;
  r.checked_at = iso(ctx.now);
  if (job.mode === "refresh") {
    // Quarterly refresh: only hours and status.
    const oh = fact("opening_hours");
    if (oh) { r.opening_hours = oh.value; r.open_sunday = opensOnSunday(oh.value); prov.opening_hours = { value: oh.value, via: "website", url: oh.url, quote: oh.quote }; }
    return { record: r, provenance: prov, conflict, tierWhy: "refresh only" };
  }

  // Facts from the site.
  const oh = fact("opening_hours");
  if (oh) { r.opening_hours = oh.value; r.open_sunday = opensOnSunday(oh.value); prov.opening_hours = { value: oh.value, via: "website", url: oh.url, quote: oh.quote }; prov.open_sunday = { value: r.open_sunday, via: "derived from opening_hours" }; }
  for (const f of facts.values()) {
    if (/^(serving|amenities|food)\.(?!focus)/.test(f.field) || ["roasts_own_beans", "sells_beans", "sells_equipment", "offers_courses"].includes(f.field)) {
      set(r, f.field, f.value); prov[f.field] = { value: f.value, via: "website", url: f.url, quote: f.quote };
    }
  }
  if (r.amenities?.cash_only === true && r.amenities.card_payment === true) { delete r.amenities.cash_only; delete r.amenities.card_payment; }
  const focus = fact("food_focus");
  if (focus) { set(r, "food.focus", focus.value); prov["food.focus"] = { value: focus.value, via: "website", url: focus.url, quote: focus.quote }; }
  const own = (c as any).roasterOwn;
  if (own && r.roasts_own_beans === undefined) { r.roasts_own_beans = true; prov.roasts_own_beans = { value: true, via: "roaster page lists it as the roaster's own café", url: own.url, quote: own.quote }; }

  // Roasters served: named on the site, or listed on a roaster's page.
  const served: any[] = [];
  for (const rr of c.roasters) served.push({ name: rr.name, url: rr.url, ...(own && own.name === rr.name ? { own: true } : {}), _src: { via: "roaster page", url: rr.url, quote: rr.quote } });
  for (const f of e.facts.filter((x) => x.field === "roaster")) {
    if (served.some((s) => nameSim(s.name, f.value) >= 0.85)) continue;
    const isOwn = r.roasts_own_beans === true && nameSim(f.value, c.name) >= 0.75;
    served.push({ name: f.value, ...(isOwn ? { own: true } : {}), _src: { via: "website", url: f.url, quote: f.quote } });
  }
  if (served.length) { r.roasters_served = served.map(({ _src, ...s }) => s); prov.roasters_served = { value: r.roasters_served.map((s: any) => s.name), via: served.map((s) => `${s.name}: ${s._src.via}`).join("; "), url: served[0]._src.url, quote: served[0]._src.quote }; }

  const cups = e.facts.filter((x) => x.field === "reusable_cup").map((x) => x.value);
  if (cups.length) { r.reusable_cup_systems = [...new Set(cups)].sort(); prov.reusable_cup_systems = { value: r.reusable_cup_systems, via: "website", url: e.facts.find((x) => x.field === "reusable_cup")!.url }; }
  const op = fact("operator");
  if (op) {
    const lf = String(op.value).match(LEGAL)?.[1];
    r.operator = { name: op.value, ...(lf ? { legal_form: lf } : {}), ...(fact("register_id") ? { register_id: fact("register_id")!.value } : {}) };
    prov.operator = { value: r.operator, via: "website legal notice", url: op.url, quote: op.quote };
  }
  const price = fact("cappuccino_price");
  if (price) { r.prices = { cappuccino: { amount: price.value, currency: ctx.country === "CH" ? "CHF" : "EUR", observed_on: price.fetchedAt.slice(0, 10), source_url: price.url } }; prov["prices.cappuccino"] = { value: price.value, via: "website", url: price.url, quote: price.quote }; }

  // Links.
  if (siteOk) {
    const u = new URL(page0!.url);
    r.links = { ...(r.links ?? {}), website: u.pathname.length <= 1 ? `${u.origin}/` : u.href };
    prov["links.website"] = { value: r.links.website, via: "fetched and matched (name and address on the site)", url: page0!.url };
    const social = (re: RegExp, bad: RegExp) => {
      const hits = new Set<string>();
      for (const p of e.site!.pages) for (const l of p.doc.links) { const m = l.href.match(re); if (m && !bad.test(m[1])) hits.add(m[1].toLowerCase()); }
      return hits.size === 1 ? [...hits][0] : null;
    };
    const ig = social(/^https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9_.]+)\/?(?:\?.*)?$/, /^(p|reel|reels|explore|stories|accounts|tv)$/);
    if (ig) { r.links.instagram = `https://www.instagram.com/${ig}/`; prov["links.instagram"] = { value: r.links.instagram, via: "linked from the place's website", url: page0!.url }; }
    const fb = social(/^https?:\/\/(?:www\.|m\.)?facebook\.com\/([A-Za-z0-9_.-]{3,})\/?(?:\?.*)?$/, /^(sharer|share|dialog|plugins|tr|profile\.php|events|groups|pages)$/i);
    if (fb) { r.links.facebook = `https://www.facebook.com/${fb}/`; prov["links.facebook"] = { value: r.links.facebook, via: "linked from the place's website", url: page0!.url }; }
  }
  if (!r.links?.instagram) {
    const ig = ((c as any).socials ?? []).map((s: string) => s.match(/^https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9_.]+)\/?$/)?.[1]).filter(Boolean);
    if (ig.length === 1) { r.links = { ...(r.links ?? {}), instagram: `https://www.instagram.com/${ig[0].toLowerCase()}/` }; prov["links.instagram"] = { value: r.links.instagram, via: "overture", url: ovUrl(c.overtureIds[0]) }; }
  }
  if (r.links && !Object.keys(r.links).length) delete r.links;

  r.xref = { ...(r.xref ?? {}), ...(overtureId ? { overture: overtureId } : {}), ...(c.wikidata ? { wikidata: c.wikidata } : {}) };
  if (!Object.keys(r.xref).length) delete r.xref;

  // Tier.
  const t = tier({
    name: r.name, brand: c.brand, overtureCategory: c.category, roastsOwn: r.roasts_own_beans, filter: r.serving?.filter || r.serving?.pour_over,
    specialtyClaim: !!fact("specialty") || !!(c as any).roasterSpecialty && !!own,
    roasters: [...c.roasters.map((x) => ({ name: x.name, fromPartnerPage: x.specialty ?? !!(c as any).roasterSpecialty })), ...e.facts.filter((x) => x.field === "roaster").map((x) => ({ name: x.value, fromPartnerPage: false }))],
    business: fact("primary_business")?.value, focus: focus?.value, siteVerified: siteOk,
    servesPublic: !!r.opening_hours || !!(r.serving?.espresso || r.serving?.filter || r.serving?.pour_over) || c.roasters.length > 0 || ["cafe", "restaurant", "bakery", "bar", "hotel"].includes(fact("primary_business")?.value),
  });
  r.specialty_tier = t.tier;
  prov.specialty_tier = { value: t.tier, via: `rule: ${t.why}`, url: fact("specialty")?.url, quote: fact("specialty")?.quote };
  const d = describe(r);
  if (d) { r.description = d; prov.description = { value: d, via: "generated from the stored fields" }; } else delete r.description;
  return { record: r, provenance: prov, conflict, tierWhy: t.why };
}

function flatten(o: any, prefix = "", out: Record<string, any> = {}) {
  for (const [k, v] of Object.entries(o ?? {})) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v) && !["location", "operator", "image", "prices"].includes(k)) flatten(v, p, out);
    else out[p] = v;
  }
  return out;
}

function diff(old: any, r: any, prov: Record<string, any>) {
  const a = flatten(old ?? {}), b = flatten(r);
  const out: Omit<Change, "id" | "name">[] = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (["checked_at", "last_verified_at", "id"].includes(k)) continue;
    if (JSON.stringify(a[k]) === JSON.stringify(b[k])) continue;
    const pv = prov[k] ?? prov[k.split(".").slice(0, 2).join(".")] ?? prov[k.split(".")[0]];
    out.push({ field: k, old: a[k], new: b[k], url: pv?.url, quote: pv?.quote ?? pv?.via });
  }
  return out;
}

export const CORE = ["name", "address.street_address", "address.postal_code", "location", "status", "opening_hours", "specialty_tier", "links.website|links.instagram", "serving.espresso", "serving.filter"];
const FILL_FIELDS = ["address.street_address", "address.postal_code", "status=open", "opening_hours", "open_sunday", "description", "roasts_own_beans", "roasters_served", "serving.espresso", "serving.filter", "serving.pour_over", "serving.batch_brew", "serving.cold_brew", "serving.decaf", "serving.plant_milk", "amenities.wifi", "amenities.laptop_friendly", "amenities.kids_friendly", "amenities.vegan_options", "amenities.dogs_allowed", "amenities.outdoor_seating", "amenities.card_payment", "amenities.cash_only", "amenities.wheelchair_accessible", "food.focus", "food.breakfast", "food.lunch", "food.cakes_baked_in_house", "sells_beans", "sells_equipment", "offers_courses", "reusable_cup_systems", "prices.cappuccino", "operator", "links.website", "links.instagram", "links.facebook", "image", "xref.overture", "xref.wikidata"];
const get = (r: any, p: string) => p.split(".").reduce((o, k) => o?.[k], r);
const filled = (r: any, f: string) => f.includes("=") ? get(r, f.split("=")[0]) === f.split("=")[1] : f.includes("|") ? f.split("|").some((x) => get(r, x) !== undefined) : get(r, f) !== undefined;
export const coreComplete = (r: any) => CORE.every((f) => filled(r, f)) && r.specialty_tier !== "unknown";

export function fillRates(places: any[]) {
  const out: Record<string, string> = {};
  for (const f of FILL_FIELDS) { const n = places.filter((p) => filled(p, f)).length; out[f] = `${n}/${places.length} (${places.length ? Math.round((100 * n) / places.length) : 0}%)`; }
  return out;
}

function computeMetrics(x: any) {
  const live = x.places.filter((p: any) => !p.merged_into);
  const tiers: Record<string, number> = { A: 0, B: 0, none: 0, unknown: 0 };
  for (const p of live) tiers[p.specialty_tier]++;
  const ab = live.filter((p: any) => p.specialty_tier === "A" || p.specialty_tier === "B");
  const perField: Record<string, number> = {};
  for (const c of x.changes) perField[c.field] = (perField[c.field] ?? 0) + 1;
  const sites = [...x.results.values()];
  return {
    run_id: x.runId, budget_stop: x.budgetStop,
    places_touched: x.written.length, places_in_file: live.length, queue: x.jobs.length,
    fields_changed: x.changes.length, fields_changed_by_field: perField,
    tiers, tier_ab_core_complete: ab.filter(coreComplete).length,
    sites: { tried: sites.filter((s: any) => s.websiteTried?.length).length, matched: sites.filter((s: any) => s.match).length, rendered_pages: fetchStats.rendered, search_found: sites.filter((s: any) => s.websiteSearch === "found").length, search_failed: sites.filter((s: any) => s.websiteSearch === "failed").length, injection_lines_removed: sites.reduce((n: number, s: any) => n + (s.injectionLines ?? 0), 0) },
    research: { places: researchLog.size, new_websites: [...researchLog.values()].filter((r) => r.website).length, pages_added: [...researchLog.values()].reduce((n, r) => n + r.extraPages.length, 0), roaster_pages: [...researchLog.values()].reduce((n, r) => n + r.roasters.length, 0), searches: searchLog.length, search_errors: searchLog.filter((q) => q.error).length },
    pages: fetchStats, llm: usage, discovery: x.counts, overture_licences: licenceStats,
    conflicts: x.conflicts.length, unlocated: x.unlocated.length,
    errors: x.errors, timing_s: x.timing,
    seconds_per_place: x.written.length ? Math.round((Object.values(x.timing as Record<string, number>).reduce((a, b) => a + b, 0) / x.written.length) * 10) / 10 : null,
    fill_rate: fillRates(live), fill_rate_ab: fillRates(ab),
  };
}
