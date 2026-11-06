#!/usr/bin/env bun
// Data linter for datasets/coffee-places: catches values that pass the schema but are wrong or suspicious
// (platform sites as websites, contact data in addresses, duplicates, contradictions, unsupported tiers).
// Errors fail CI (scripts/validate.sh); warnings are printed for review. The agent runs the same checks before writing.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe } from "./describe";
import { distanceM } from "./geo";
import { nameSim, ownHost, sameStreet } from "./names";
import { cleanName, cleanStreet, EMAIL, isShareLink, OWNER_IN_NAME, SEASONAL, isPlatformUrl, LEGAL_FORM, nameProblems, NOT_LEGAL_ENTITY, PHONE, POSTCODE, streetProblems } from "./rules";

export type Finding = { level: "error" | "warning"; rule: string; id: string; message: string };

const NON_COFFEE = /heimservice|lieferservice|pizza|sushi|döner|kebab|burger|wok\b|curry|ems\b|fitness|training|\bgym\b|friseur|tankstelle|spielhalle|wettbüro|shisha|asian goods|supermarkt|metzgerei/i;
const SKIP_PII = /^(links|image|xref|external_ratings|roasters_served\.\d+\.url|prices\.cappuccino\.source_url)/;

function* strings(v: any, path = ""): Generator<[string, string]> {
  if (typeof v === "string") yield [path, v];
  else if (Array.isArray(v)) for (const [i, x] of v.entries()) yield* strings(x, `${path}.${i}`);
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) yield* strings(x, path ? `${path}.${k}` : k);
}

/** Checks for one record on its own. */
export function lintPlace(p: any, country: string, now = new Date()): Finding[] {
  const out: Finding[] = [];
  const err = (rule: string, message: string) => out.push({ level: "error", rule, id: p.id, message });
  const warn = (rule: string, message: string) => out.push({ level: "warning", rule, id: p.id, message });
  if (p.merged_into) {
    if (p.status === "open") err("merged-open", `merged into ${p.merged_into} but still status open`);
    return out;
  }

  // Websites must be the place's own.
  for (const k of ["facebook", "instagram"]) if (isShareLink(p.links?.[k])) err("share-link", `links.${k} ${p.links[k]} is a share or dialog link, not the place's profile`);
  if (isPlatformUrl(p.links?.website)) err("website-platform", `links.website ${p.links.website} is a directory, platform or social site, not the place's own website`);
  if (p.prices?.cappuccino?.source_url && isPlatformUrl(p.prices.cappuccino.source_url)) err("price-platform", "price observed on a platform site");

  // No contact data outside links (people's emails and phone numbers are personal data).
  for (const [path, s] of strings(p)) {
    if (SKIP_PII.test(path)) continue;
    if (EMAIL.test(s)) err("contact-data", `${path} contains an email address`);
    else if (PHONE.test(s) && path !== "opening_hours" && !/register_id/.test(path)) err("contact-data", `${path} contains a phone number`);
  }

  for (const prob of nameProblems(p.name)) warn("name", `name "${p.name}" ${prob}`);
  // "Christoph Jünger Gastronomie": a first and last name as the business name is likely a sole trader (a person).
  if (PERSONLIKE.test(p.name)) warn("person-name", `name "${p.name}" may be a person's name; use the name on the sign`);
  if (OWNER_IN_NAME.test(p.name)) err("person-name", `name "${p.name}" names an owner; people's names are personal data`);
  const st = p.address?.street_address;
  if (st) for (const prob of streetProblems(st)) (/email|phone/.test(prob) ? err : warn)("street", `street_address "${st}" ${prob}`);
  const pc = p.address?.postal_code;
  if (pc && POSTCODE[country] && !POSTCODE[country].test(pc)) err("postcode", `postal_code ${pc} is not a ${country} postcode`);
  if (pc && !st) warn("address", "postal_code without street_address");

  // Status and dates.
  // Only places confirmed on their own website are in the dataset.
  if (p.status === "unverified") err("unverified", "unconfirmed places are not stored; confirm the place or remove the record");
  if ((now.getTime() - Date.parse(p.checked_at)) / 86400000 > 182 && p.status === "open") warn("stale", `open but last checked ${p.checked_at.slice(0, 10)}`);
  if (p.type !== "CafeOrCoffeeShop") err("type", `type must be CafeOrCoffeeShop, got ${JSON.stringify(p.type)}`);

  // Contradictions.
  const a = p.amenities ?? {}, s = p.serving ?? {};
  if (a.cash_only === true && a.card_payment === true) err("payment", "cash_only and card_payment are both true");
  if ((s.pour_over === true || s.batch_brew === true) && s.filter === false) err("serving", "pour_over or batch_brew true but filter false");
  const ig = p.links?.instagram?.match(/^https:\/\/www\.instagram\.com\/([^/]+)\/$/)?.[1];
  if (p.links?.instagram && (!ig || !/^(?!\.)(?!.*\.\.)[A-Za-z0-9._]{1,30}(?<!\.)$/.test(ig))) err("instagram", `links.instagram ${p.links.instagram} is not a valid profile URL`);
  if (s.filter === false && s.pour_over === undefined && s.batch_brew === undefined) warn("serving", "filter false is a strong claim; check the quote");
  const price = p.prices?.cappuccino?.amount;
  if (price !== undefined && (price < 1.5 || price > 9)) err("price", `cappuccino price ${price} is implausible`);

  // Operator must be a legal entity.
  if (p.operator && (!LEGAL_FORM.test(p.operator.name) || NOT_LEGAL_ENTITY.test(p.operator.name))) err("operator", `operator "${p.operator.name}" is not a legal entity`);

  // Tier needs its evidence in the record.
  if ((p.specialty_tier === "A" || p.specialty_tier === "B") && p.roasts_own_beans !== true && !(p.roasters_served ?? []).length)
    err("tier-evidence", `tier ${p.specialty_tier} without roasts_own_beans or roasters_served`);
  if (p.description && p.specialty_tier !== "A" && p.specialty_tier !== "B") warn("description", "description on a place that is not tier A or B");
  if (SEASONAL.test(p.name) && p.status === "open") err("seasonal", `"${p.name}" is a seasonal venue; it cannot be open all year (temporarily_closed outside its season)`);
  if (p.specialty_tier === "unknown" && NON_COFFEE.test(p.name)) warn("tier-none", `"${p.name}" looks like a non-coffee business; tier none?`);
  if (p.image && !/^https:\/\/upload\.wikimedia\.org\//.test(p.image.url) && !/^https:\/\/(images\.)?(mapillary|panoramax)/.test(p.image.url)) warn("image", `image.url ${p.image.url} is not from an open image repository`);
  return out;
}

/** Pairs of live records that are the same place: very similar names at (nearly) the same spot. */
export function duplicatePairs(places: any[]): [any, any, number][] {
  const live = places.filter((p) => !p.merged_into);
  const out: [any, any, number][] = [];
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const a = live[i], b = live[j];
    const d = distanceM(a.location, b.location);
    if (d > 60) continue;
    const sim = nameSim(a.name, b.name);
    // Or one place under two names (e.g. the café and its operator): same street and number, same own website.
    const sameSite = !!a.links?.website && ownHost(a.links.website) === ownHost(b.links?.website) && sameStreet(a.address?.street_address, b.address?.street_address);
    if ((sim >= 0.85 && d <= 40) || (sim >= 0.99 && d <= 60) || (sameSite && d <= 60)) out.push([a, b, d]);
  }
  return out;
}

/** Checks across records of one file: duplicates and shared websites. */
export function lintCity(places: any[], country: string, now = new Date()): Finding[] {
  const live = places.filter((p) => !p.merged_into);
  const out = live.flatMap((p) => lintPlace(p, country, now));
  for (const [a, b, d] of duplicatePairs(live))
    out.push({ level: "error", rule: "duplicate", id: b.id, message: `same place as ${a.id} "${a.name}" (${Math.round(d)} m); set merged_into` });
  // One website for places with different names is how a district or street word once matched the wrong site.
  const byHost = new Map<string, any[]>();
  for (const p of live) if (p.links?.website) {
    const u = new URL(p.links.website);
    const h = u.hostname === "sites.google.com" ? `sites.google.com${u.pathname.split("/").slice(0, 3).join("/")}` : u.hostname.replace(/^www\./, ""); // each Google Site is its own
    byHost.set(h, [...(byHost.get(h) ?? []), p]);
  }
  for (const [host, ps] of byHost) for (const p of ps) {
    const others = ps.filter((q) => q !== p && nameSim(q.name, p.name) < 0.6);
    if (others.length) out.push({ level: "warning", rule: "shared-website", id: p.id, message: `"${p.name}" shares ${host} with ${others.length} place(s) of another name (${others.slice(0, 3).map((q) => `"${q.name}"`).join(", ")}); check the site really is this place's` });
  }
  return out;
}

const SITE_FIELDS = ["opening_hours", "description", "roasts_own_beans", "roasters_served", "serving", "amenities", "food", "sells_beans", "sells_equipment", "offers_courses", "reusable_cup_systems", "prices", "operator", "last_verified_at"];

/**
 * Repairs that only remove doubtful values or derive values from other stored fields; they never add a fact.
 * Returns what was changed. Used by the agent before writing and by `lint.ts --fix`.
 */
export function repair(p: any): string[] {
  const done: string[] = [];
  if (p.merged_into) {
    if (p.status === "open") { p.status = "closed"; done.push("tombstone status open -> closed"); }
    return done;
  }
  if (isPlatformUrl(p.links?.website)) {
    // Everything read from that page is unsupported: back to the open-data basics.
    for (const k of SITE_FIELDS) delete p[k];
    delete p.links.website;
    if (!Object.keys(p.links).length) delete p.links;
    if (p.status === "open") { p.status = "unverified"; done.push("no longer confirmed: the page that confirmed it was a platform page (remove the record)"); }
    if (p.specialty_tier === "A" || p.specialty_tier === "B") p.specialty_tier = "unknown";
    done.push("removed a platform page used as website and every value read from it");
  }
  for (const k of ["facebook", "instagram"]) if (isShareLink(p.links?.[k])) { done.push(`removed share link ${p.links[k]}`); delete p.links[k]; }
  if (p.links && !Object.keys(p.links).length) delete p.links;
  const name = cleanName(p.name);
  if (name !== p.name) {
    done.push(`name "${p.name}" -> "${name}"`);
    p.name = name;
    if (p.description) p.description = describe(p); // generated from the fields, so it follows the name
  }
  const st = p.address?.street_address;
  if (st && streetProblems(st).length) {
    const c = cleanStreet(st);
    if (c && c !== st) { p.address.street_address = c; done.push(`street "${st}" -> "${c}"`); }
    else if (!c || EMAIL.test(st) || PHONE.test(st)) { delete p.address.street_address; delete p.address.postal_code; done.push(`removed street "${st}"`); }
  }
  if (p.open_sunday !== undefined) { delete p.open_sunday; done.push("removed open_sunday (derived from opening_hours since schema v0.3.0)"); }
  if (p.type !== "CafeOrCoffeeShop") { p.type = "CafeOrCoffeeShop"; done.push("type CafeOrCoffeeShop"); }
  if (p.last_verified_at !== undefined) { delete p.last_verified_at; done.push("removed last_verified_at (records in the repository are confirmed)"); }
  const igm = p.links?.instagram?.match(/^https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9_.]+)\/?(?:\?.*)?$/);
  if (igm && p.links.instagram !== `https://www.instagram.com/${igm[1].toLowerCase()}/`) { p.links.instagram = `https://www.instagram.com/${igm[1].toLowerCase()}/`; done.push("instagram normalised"); }
  if (p.amenities?.cash_only === true && p.amenities.card_payment === true) { delete p.amenities.cash_only; delete p.amenities.card_payment; done.push("removed contradicting payment values"); }
  const s = p.serving;
  if (s && (s.pour_over === true || s.batch_brew === true) && s.filter === false) { delete s.filter; delete s.pour_over; delete s.batch_brew; done.push("removed contradicting filter values"); }
  if (s && (s.pour_over === true || s.batch_brew === true) && s.filter === undefined) { s.filter = true; done.push("filter derived from pour_over or batch_brew"); }
  const ig = p.links?.instagram?.match(/^https:\/\/www\.instagram\.com\/([^/]+)\/$/)?.[1];
  if (p.links?.instagram && (!ig || !/^(?!\.)(?!.*\.\.)[A-Za-z0-9._]{1,30}(?<!\.)$/.test(ig))) { done.push(`removed invalid instagram ${p.links.instagram}`); delete p.links.instagram; }
  const price = p.prices?.cappuccino?.amount;
  if (price !== undefined && (price < 1.5 || price > 9)) { delete p.prices; done.push("removed implausible price"); }
  if (p.operator && (!LEGAL_FORM.test(p.operator.name) || NOT_LEGAL_ENTITY.test(p.operator.name))) { delete p.operator; done.push("removed operator that is not a legal entity"); }
  if (SEASONAL.test(p.name) && p.status === "open") { p.status = "temporarily_closed"; done.push("seasonal venue -> temporarily_closed"); }
  if ((p.specialty_tier === "A" || p.specialty_tier === "B") && p.roasts_own_beans !== true && !(p.roasters_served ?? []).length) { p.specialty_tier = "unknown"; done.push("tier without evidence -> unknown"); }
  if (p.description && p.specialty_tier !== "A" && p.specialty_tier !== "B") { delete p.description; done.push("removed description of a place that is not tier A or B"); }
  for (const k of ["amenities", "serving", "food", "links"]) if (p[k] && !Object.keys(p[k]).length) delete p[k];
  // Contact data outside the street is never repaired automatically: the record fails and needs a human.
  return done;
}

/** Score for keeping one of two duplicates: confirmed, richer, older id. */
const PERSONLIKE = /^[A-ZÄÖÜ][a-zäöüß]+ [A-ZÄÖÜ][a-zäöüß-]+ (Gastronomie|Gastro|Catering)$/;
const keepScore = (p: any) => (p.status === "open" ? 1000 : 0) - (PERSONLIKE.test(p.name) ? 500 : 0) + Object.keys(p).length * 10 + JSON.stringify(p).length / 1000;

/** Turn duplicates into tombstones pointing at the record we keep. Ids are never deleted. */
export function mergeDuplicates(places: any[]): string[] {
  const done: string[] = [];
  for (const [a, b] of duplicatePairs(places)) {
    if (a.merged_into || b.merged_into) continue;
    const [keep, drop] = keepScore(a) > keepScore(b) || (keepScore(a) === keepScore(b) && a.id < b.id) ? [a, b] : [b, a];
    drop.merged_into = keep.id;
    if (drop.status === "open") drop.status = "closed"; // a tombstone is never open (schema v0.3.0); it is closed in favour of keep
    done.push(`${drop.id} "${drop.name}" merged into ${keep.id}`);
  }
  return done;
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : p.endsWith(".json") ? [p] : []; });
}

if (import.meta.main) {
  const root = join(import.meta.dir, "../..");
  const dir = process.env.DATASETS_DIR ? join(process.env.DATASETS_DIR, "coffee-places") : join(root, "datasets/coffee-places");
  const strict = process.argv.includes("--strict"); // warnings fail too
  const fix = process.argv.includes("--fix"); // apply the safe repairs and merge duplicates, then lint
  let errors = 0, warnings = 0;
  const counts: Record<string, number> = {};
  for (const f of files(dir)) {
    const doc = JSON.parse(readFileSync(f, "utf8"));
    if (fix) {
      const notes = [...(doc.places ?? []).flatMap((p: any) => repair(p).map((n) => `${p.id}: ${n}`)), ...mergeDuplicates(doc.places ?? [])];
      for (const n of notes) console.log(`fixed ${relative(root, f)} ${n}`);
      if (notes.length) writeFileSync(f, JSON.stringify(doc, null, 2) + "\n");
    }
    for (const x of lintCity(doc.places ?? [], doc.meta?.country_code ?? "DE")) {
      counts[`${x.level} ${x.rule}`] = (counts[`${x.level} ${x.rule}`] ?? 0) + 1;
      if (x.level === "error") errors++; else warnings++;
      console.log(`::${x.level}::${relative(root, f)} [${x.id}]: ${x.rule}: ${x.message}`);
    }
  }
  console.log(`linted coffee places: ${errors} errors, ${warnings} warnings`);
  for (const [k, n] of Object.entries(counts).sort()) console.log(`  ${k}: ${n}`);
  process.exit(errors || (strict && warnings) ? 1 : 0);
}
