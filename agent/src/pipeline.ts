// One data agent run for one city: discover, filter, enrich, find websites, images, write. See docs/agent.md.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Candidate } from "./candidate";
import { cityArea } from "./cities";
import { CACHE, llm } from "./config";
import { closeBrowser, pool } from "./pages";
import { readCity, writeCity } from "./dataset";
import { mergeInto, samePlace } from "./dedupe";
import { keywordProposals, postcodesOnSite, propose, siteMatches, verify } from "./extract";
import { newId } from "./ids";
import { findImage } from "./images";
import { ownHost } from "./names";
import { loadState, type Job, queueFor, saveState } from "./queue";
import { searchLog, websiteSeeds } from "./search";
import { fetchSite, type SitePage } from "./site";
import { lintPlace, mergeDuplicates, repair } from "./lint";
import type { Research } from "./research";
import { SEASONAL } from "./rules";
import { type RunOptions, type Enriched, type Change, type RunLog, iso } from "./pipeline-model";
import { type CoffeeRecord, parseCityDocument } from "./record";
import { fromRecord } from "./pipeline-location";
import { diff, computeMetrics } from "./pipeline-metrics";
import { enrichJob } from "./pipeline-enrich";
import { discover } from "./pipeline-discovery";
import { buildRecord } from "./pipeline-record";
export type { RunOptions, Change } from "./pipeline-model";
export { addressPoint, siteGeo, cleanName, streetHint } from "./pipeline-location";
export { CORE, coreComplete, fillRates } from "./pipeline-metrics";

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
  const counts: Record<string, number> = {};
  const { inside, cands, unlocated } = await stage("discover", () => discover({ o, area, counts, errors, cityNames, country, placeWords, cityPostcodes, want, siteCache, enrichSite }));

  // ---------- existing records, ids and queue ----------
  const doc = readCity(o.city);
  const state = loadState(o.city.slug);
  const taken = new Set(doc.places.map((p) => p.id));
  const byId = new Map<string, CoffeeRecord | null>(doc.places.map((p) => [p.id, p]));
  const archivedFile = join(CACHE, "removed", `${o.city.slug}.json`);
  const archived = existsSync(archivedFile) ? parseCityDocument(readFileSync(archivedFile, "utf8")).places : [];
  const candFor = new Map<string, Candidate>();
  const assignCandidateIds = () => {
    for (const c of cands) {
      // A tombstone's Overture id still points at its place: follow merged_into, so a merged duplicate never comes back.
      // Merged duplicates live in the local archive; their Overture ids keep pointing at the record that survived.
      const known = [...doc.places, ...archived];
      const rec = existingRecord(c, doc.places, known);
      // A place taken out earlier and confirmed now gets its old id back (local archive, matched by Overture id).
      const back = rec ? undefined : archivedCandidate(c, archived, byId);
      const id = rec?.id ?? back?.id ?? newId(taken);
      taken.add(id);
      if (!rec) byId.set(id, null);
      const previous = candFor.get(id);
      if (previous) mergeInto(previous, c); else candFor.set(id, c);
    }
  };
  assignCandidateIds();
  // Websites found by search for places that had none (stage 4 run elsewhere): tried after the known ones.
  const found = websiteSeeds(o.city.slug);
  counts.website_seeds = found.size;
  for (const [id, url] of found) {
    const c = candFor.get(id);
    if (c && url !== c.website) c.altWebsites = [...(c.altWebsites ?? []), url];
  }

  // New places first (never enriched), then the ledger-driven queue for existing ones.
  const jobs: Job[] = [
    ...[...candFor.keys()].filter((id) => !byId.get(id)).map((id) => ({ id, reason: "never_enriched" as const, mode: "full" as const })),
    ...queueFor(doc.places, state, now),
  ].filter((j, i, a) => a.findIndex((x) => x.id === j.id) === i).slice(0, o.limit);
  counts.queue = jobs.length;

  // ---------- 2-4. Filter, enrich, find websites ----------
  const results = new Map<string, Enriched>();
  await stage("enrich", async () => {
    await pool(jobs, 12, async (job) => {
      const c = candFor.get(job.id) ?? fromRecord(byId.get(job.id));
      if (c) await enrichJob(job, c, { o, cityNames, country, placeWords, timing, want, siteCache, researchLog, results, errors, enrichSite });
    });
  });

  // ---------- build records ----------
  const changes: Change[] = [];
  const runLog: RunLog[] = [];
  const conflicts: { id: string; name: string; reason: string }[] = [];
  const labels = new Set<string>();
  const written: CoffeeRecord[] = [];
  const removed: CoffeeRecord[] = []; // records taken out of the dataset, kept only in .cache/removed/<city>.json
  const candidateForJob = (id: string) => candFor.get(id) ?? fromRecord(byId.get(id));
  const buildJob = (job: Job) => {
    const e = results.get(job.id);
    if (!e) return; // not processed (error): stays queued
    const c = candidateForJob(job.id);
    if (!c) return;
    const old = byId.get(job.id) ?? null;
    const built = buildRecord(job, c, e, old, { now, country, cityName: o.city.name, inside });
    runLog.push(buildLog(job, c, e, built, researchLog.get(job.id)));
    if (built.conflict) { conflicts.push({ id: job.id, name: c.name, reason: built.conflict }); state.conflicts[job.id] = built.conflict; labels.add("conflict"); }
    else Reflect.deleteProperty(state.conflicts, job.id);
    if (!built.record) {
      // Never confirmed: not in the dataset (before the first data release this also removes old unconfirmed records).
      if (!built.keep && old) { byId.set(job.id, null); removed.push(old); }
      return;
    }
    state.enriched[job.id] = iso(now);
    const r = built.record;
    for (const ch of diff(old, r, built.provenance)) changes.push({ id: r.id, name: r.name, ...ch });
    labelRecordChanges(old, r, labels);
    byId.set(r.id, r);
    written.push(r);
  };
  await stage("build", () => {
    for (const job of jobs) buildJob(job);
    return Promise.resolve();
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
  const safeguard = () => {
    // Only confirmed places: drop any leftover unconfirmed record or tombstone from before this policy.
    for (const [id, p] of byId) if (p?.status === "unverified") { byId.set(id, null); removed.push(p); }
    counts.removed_unconfirmed = removed.length;
    const lintRejected: { id: string; name: string; reason: string }[] = [];
    for (const r of written) for (const n of repair(r)) changes.push({ id: r.id, name: r.name, field: "lint repair", old: undefined, new: n });
    // Duplicates are removed (kept locally in .cache/removed), not stored as tombstones.
    removeDuplicates(byId, removed, changes, labels);
    const rejectInvalid = () => {
      for (const r of written) {
        const errs = lintPlace(r, country, now).filter((f) => f.level === "error");
        if (!errs.length) continue;
        const old = doc.places.find((p) => p.id === r.id) ?? null;
        byId.set(r.id, old);
        lintRejected.push({ id: r.id, name: r.name, reason: errs.map((f) => `${f.rule}: ${f.message}`).join("; ") });
        labels.add("lint");
      }
    };
    rejectInvalid();
    // Every record, not only the ones written in this run, gets the safe repairs; anything unconfirmed leaves the dataset.
    repairRemaining(byId, removed);
    for (const x of lintRejected) conflicts.push({ id: x.id, name: x.name, reason: `not written, lint: ${x.reason}` });
    counts.lint_rejected = lintRejected.length;
  };
  safeguard();

  const places = [...byId.values()].filter((p): p is CoffeeRecord => p !== null);
  let file: string | null = null;
  if (!o.dryRun && written.length) { file = writeCity(o.city, { places }); saveState(o.city.slug, state); archiveRemoved(o.city.slug, removed); }

  const metrics = computeMetrics({ places, written, jobs, results, changes, errors, timing, counts, conflicts, unlocated, runId, researchLog });
  const dir = join(CACHE, "runs", runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${o.city.slug}.log.json`), JSON.stringify({ metrics, runLog, unlocated, conflicts, searchLog }, null, 1));
  writeFileSync(join(dir, `${o.city.slug}.metrics.json`), JSON.stringify(metrics, null, 1));
  return { file, metrics, changes, labels: [...labels], conflicts, runLog, dir };
}

// ---------------- helpers ----------------

const researchLog = new Map<string, Research>();

const placeWords = new Set<string>();
const cityPostcodes = new Set<string>(); // postcodes inside the city, for telling branches from an operator's address elsewhere
const siteCache = new Map<string, Enriched>(); // key: url|street, because facts are verified for one location

async function enrichSite(c: Candidate, url: string, _cityNames: string[], country: string, extraPages: SitePage[] = []): Promise<Enriched> {
  const site = await fetchSite(url);
  for (const p of extraPages) if (site.ok && !site.pages.some((x) => x.url === p.url)) site.pages.push(p);
  if (!site.ok) return { site, facts: [], rejected: [], multi: false, websiteTried: [url], injectionLines: 0 };
  const host = new URL(site.pages[0].url).hostname.replace(/^www\./, "");
  const m = siteMatches(site.pages, c, host, placeWords);
  if (!m.ok) return { site, facts: [], rejected: [], multi: false, websiteTried: [url], error: m.reason, injectionLines: 0 };
  const multi = postcodesOnSite(site.pages, country, cityPostcodes).size > 1;
  const address = [c.street, c.postcode].filter(Boolean).join(", ");
  let p = await propose(c.name, address, site.pages);
  if (p.error) p = await propose(c.name, address, site.pages, llm.escalationModel); // hard case: escalate once
  // The model's proposals plus the keyword pass (verify drops failing quotes; conflicting values cancel each other).
  const v = verify([...p.facts, ...keywordProposals(site.pages)], site.pages, { street: c.street, postcode: c.postcode, country, ownName: c.name, multiLocation: multi, cityPostcodes });
  return { site, match: m.reason, facts: v.kept, rejected: v.rejected, multi, websiteTried: [url], error: p.error ?? undefined, injectionLines: p.removed };
}

/** Records that leave the dataset are kept locally (gitignored) so they can be worked on later; never committed. */
function archiveRemoved(slug: string, records: CoffeeRecord[]) {
  if (!records.length) return;
  const file = join(CACHE, "removed", `${slug}.json`);
  const prev = existsSync(file) ? parseCityDocument(readFileSync(file, "utf8")).places : [];
  const byId = new Map(prev.map((p) => [p.id, p]));
  for (const r of records) byId.set(r.id, r);
  mkdirSync(join(CACHE, "removed"), { recursive: true });
  writeFileSync(file, JSON.stringify({ note: "Places taken out of the dataset (not confirmed, or duplicates); local only, never committed.", places: [...byId.values()] }, null, 1));
}

/** Follow merged_into to the record that survives. */
function finalId(places: CoffeeRecord[], id: string): string {
  for (let i = 0; i < 20; i++) { const p = places.find((x) => x.id === id); if (!p?.merged_into) return id; id = p.merged_into; }
  return id;
}

function labelRecordChanges(old: CoffeeRecord | null, r: CoffeeRecord, labels: Set<string>) {
  if (old && old.specialty_tier !== r.specialty_tier && old.specialty_tier !== "unknown") labels.add("tier-change");
  if (r.status === "closed" && old?.status !== "closed") labels.add("closure");
  labelWebsiteChange(old, r, labels);
}

function buildLog(job: Job, c: Candidate, e: Enriched, built: ReturnType<typeof buildRecord>, res?: Research): RunLog {
  return { id: job.id, name: c.name, reason: job.reason, origins: c.origins, site: e.site ? { start: e.site.start, ok: e.site.ok, error: e.site.error, pages: e.site.pages.map((p) => ({ url: p.url, fetchedAt: p.fetchedAt, rendered: p.rendered })) } : null, match: e.match, websiteSearch: e.websiteSearch, values: Object.fromEntries(built.provenance), rejected: e.rejected.map((r) => ({ field: r.field, value: r.value, reason: r.reason })), conflict: built.conflict, tierWhy: built.tierWhy, research: res ? { queries: res.queries, opened: res.opened } : undefined };
}

function existingRecord(c: Candidate, places: CoffeeRecord[], known: CoffeeRecord[]) {
  const tomb = known.find((p) => p.merged_into && !!p.xref?.overture && c.overtureIds.includes(p.xref.overture));
  const rec = (tomb?.merged_into ? places.find((p) => p.id === finalId(known, tomb.merged_into ?? tomb.id)) : undefined) ?? places.find((p) => !p.merged_into && (!!p.xref?.overture && c.overtureIds.includes(p.xref.overture) || samePlace(c, { ...p.location, name: p.name, street: p.address?.street_address, website: p.links?.website, overtureIds: [], origins: [], key: "" })));
  return rec;
}

function repairRemaining(byId: Map<string, CoffeeRecord | null>, removed: CoffeeRecord[]) {
  for (const [id, p] of byId) if (p) { repair(p); if (p.status === "unverified" || SEASONAL.test(p.name)) { byId.set(id, null); removed.push(p); } }
}

function removeDuplicates(byId: Map<string, CoffeeRecord | null>, removed: CoffeeRecord[], changes: Change[], labels: Set<string>) {
  for (const n of mergeDuplicates([...byId.values()].filter((p): p is CoffeeRecord => p !== null))) { changes.push({ id: n.slice(0, 13), name: "", field: "removed duplicate", old: undefined, new: n }); labels.add("duplicate"); }
  for (const [id, p] of byId) if (p?.merged_into) { byId.set(id, null); removed.push(p); }
}

function labelWebsiteChange(old: CoffeeRecord | null, r: CoffeeRecord, labels: Set<string>) {
  if (old?.links?.website && r.links?.website && ownHost(old.links.website) !== ownHost(r.links.website)) labels.add("new-domain");
  if (!old && r.links?.website) labels.add("new-domain");
}

function archivedCandidate(c: Candidate, archived: CoffeeRecord[], byId: Map<string, CoffeeRecord | null>) {
  return archived.find((p) => !!p.xref?.overture && c.overtureIds.includes(p.xref.overture) && !byId.has(p.id));
}
