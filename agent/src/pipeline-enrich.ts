import type { Candidate } from "./candidate";
import { llm } from "./config";
import type { Job } from "./queue";
import { type Enriched, type RunOptions } from "./pipeline-model";
import { isPlatformUrl } from "./rules";
import { isChain, nonCoffeeName } from "./tier";
import { searchEnabled, websiteCandidates } from "./search";
import { research, type Research } from "./research";
import type { SitePage } from "./site";
interface EnrichmentContext {
  o: RunOptions; cityNames: string[]; country: string; placeWords: Set<string>; timing: Record<string, number>;
  want: (stage: string) => boolean; siteCache: Map<string, Enriched>; researchLog: Map<string, Research>;
  results: Map<string, Enriched>; errors: string[];
  enrichSite: (c: Candidate, url: string, cityNames: string[], country: string, extraPages?: SitePage[]) => Promise<Enriched>;
}
const researchable = (c: Candidate) => !isChain(c.name, c.brand) && !nonCoffeeName(c.name);
function shouldSearch(c: Candidate, e: Enriched | null, ctx: EnrichmentContext) {
  return !e?.match && ctx.want("websites") && searchEnabled() && researchable(c);
}
function shouldResearch(c: Candidate, e: Enriched | null, ctx: EnrichmentContext) {
  return ctx.want("research") && (searchEnabled() || !!llm.researchModel) && researchable(c) && needsResearch(e);
}
function needsResearch(e: Enriched | null) {
  if (!e?.match) return true;
  const has = (f: string) => e.facts.some((x) => x.field === f);
  return !has("opening_hours") || !has("serving.espresso") || !has("serving.filter") || (!has("roasts_own_beans") && !has("roaster"));
}

export async function enrichJob(job: Job, candidate: Candidate, ctx: EnrichmentContext) {
  const { results, errors } = ctx;
  const c = candidate;
  // Filter: chains and clearly non-coffee businesses without a website are not fetched.
  const urls = [c.website, ...c.altWebsites ?? []].filter((u): u is string => !!u && !isPlatformUrl(u)); // never a directory or platform page
  if (!urls.length && (isChain(c.name, c.brand) || nonCoffeeName(c.name))) { results.set(job.id, { facts: [], rejected: [], multi: false, websiteTried: [], injectionLines: 0 }); return; }
  try {
    const tried: string[] = [];
    let e = await tryKnownWebsites(c, urls, tried, ctx);
    if (shouldSearch(c, e, ctx)) e = await findWebsite(c, e, tried, ctx);
    // Research: search the web for this place and follow leads to its own website.
    if (shouldResearch(c, e, ctx)) e = await researchPlace(job.id, c, e, tried, ctx);
    results.set(job.id, { ...(e ?? { facts: [], rejected: [], multi: false, injectionLines: 0, websiteTried: [] }), websiteTried: tried });
  } catch (err) {
    errors.push(`${c.name}: ${String(err).slice(0, 200)}`);
  }
}

async function findWebsite(c: Candidate, e: Enriched | null, tried: string[], ctx: EnrichmentContext) {
  const { o, cityNames, country, timing, enrichSite } = ctx;
  const t0 = Date.now();
  for (const u of await websiteCandidates(c.name, c.street, o.city.name)) {
    if (tried.includes(u)) continue;
    tried.push(u);
    const r = await enrichSite(c, u, cityNames, country);
    if (r.site?.ok && r.match) { e = { ...r, websiteSearch: "found" }; break; }
  }
  timing.websites = (timing.websites ?? 0) + (Date.now() - t0) / 1000;
  if (!e?.match) e = { ...(e ?? { facts: [], rejected: [], multi: false, injectionLines: 0, websiteTried: [] }), websiteSearch: "failed" };
  return e;
}

async function researchPlace(id: string, c: Candidate, e: Enriched | null, tried: string[], ctx: EnrichmentContext) {
  const { o, cityNames, country, placeWords, timing, researchLog, enrichSite } = ctx;
  const t0 = Date.now();
  const res = await research(c, { cityName: o.city.name, country, site: e?.match ? e.site : undefined, placeWords });
  researchLog.set(id, res);
  if (res.website && !e?.match) {
    tried.push(res.website);
    const r = await enrichSite(c, res.website, cityNames, country);
    if (r.site?.ok && r.match) e = { ...r, websiteSearch: "research" };
  }
  if (hasExtraPages(e, res)) e = { ...(await enrichSite(c, e.site.start, cityNames, country, res.extraPages)), websiteSearch: e.websiteSearch };
  timing.research = (timing.research ?? 0) + (Date.now() - t0) / 1000;
  return e;
}

async function tryKnownWebsites(c: Candidate, urls: string[], tried: string[], ctx: EnrichmentContext) {
  const { siteCache, enrichSite, cityNames, country } = ctx;
  let e: Enriched | null = null;
  for (const u of urls) {
    tried.push(u);
    const r = siteCache.get(`${u}|${c.street ?? ""}`) ?? await enrichSite(c, u, cityNames, country);
    if (r.site?.ok && r.match) { e = r; break; }
    e ??= r;
  }
  return e;
}

function hasExtraPages(e: Enriched | null, res: Research): e is Enriched & { site: NonNullable<Enriched["site"]> } {
  return !!e?.match && !!e.site && res.extraPages.length > 0;
}
