import type { Candidate } from "./candidate";
import { describe } from "./describe";
import { type Verified } from "./extract";
import { cleanName } from "./pipeline-location";
import { nameSim, ownHost, sameStreet } from "./names";
import { type Enriched, type ProvenanceMap, type Row, iso, overtureUrl, stringFact } from "./pipeline-model";
import type { Job } from "./queue";
import type { Address, CoffeeRecord, Roaster } from "./record";
import { cleanName as signName, cleanStreet, SEASONAL } from "./rules";
import type { SitePage } from "./site";
import { tier } from "./tier";

interface BuildContext { now: Date; country: string; cityName: string; inside: Row[] }
interface Built { record: CoffeeRecord | null; keep?: boolean; provenance: ProvenanceMap; conflict?: string; tierWhy: string }
interface Position { lat: number; lon: number; overtureId?: string; street?: string; postcode?: string; conflict?: string }
const source = (f: Verified) => ({ value: f.value, via: "website", url: f.url, quote: f.quote });

function position(c: Candidate, e: Enriched, ctx: BuildContext, prov: ProvenanceMap): Position | { missing: true; conflict?: string } {
  const { siteStreet, sitePc } = siteAddress(e);
  let lat = c.lat, lon = c.lon, overtureId = c.overtureIds[0];
  let street = cleanStreet(c.street) ?? undefined, postcode = c.postcode, conflict: string | undefined;
  if (siteStreet && possibleMove(e, siteStreet, c.street)) {
    const moved = movedPosition(c, siteStreet, sitePc, ctx, prov);
    if (moved) return moved;
    if (c.street) conflict = `website gives ${siteStreet}, Overture ${c.street}`;
    else street = undefined;
  } else if (siteStreet) { street = siteStreet; if (sitePc) postcode = sitePc; }
  const coordinates = coordinatePair(lat, lon);
  return coordinates ? { ...coordinates, overtureId, street, postcode, conflict } : { missing: true, conflict };
}
function applyAddress(r: CoffeeRecord, c: Candidate, old: CoffeeRecord | null, e: Enriched, pos: Position, ctx: BuildContext, prov: ProvenanceMap) {
  applyIdentity(r, c, old, pos, ctx, prov);
  const addr: Address = { country_code: ctx.country, locality: ctx.cityName };
  applyStreet(addr, e, pos, prov);
  applyPostcode(addr, e, pos, ctx, prov);
  prov.set("address.locality", { value: ctx.cityName, via: "point inside the official city boundary" });
  r.address = old && pos.conflict ? old.address : { ...old?.address, ...addr };
}
function applyStatus(r: CoffeeRecord, e: Enriched, old: CoffeeRecord | null, prov: ProvenanceMap): Built | null {
  const closed = e.facts.find((f) => f.field === "closed_permanently"), temp = e.facts.find((f) => f.field === "temporarily_closed");
  const page = e.match && e.site?.ok ? e.site.pages[0] : undefined;
  if (closed) { r.status = "closed"; prov.set("status", { ...source(closed), value: "closed" }); }
  else if (temp) { r.status = "temporarily_closed"; prov.set("status", { ...source(temp), value: "temporarily_closed" }); }
  else if (page) { r.status = "open"; prov.set("status", { value: "open", via: "website names the place and its address", url: page.url, quote: e.match }); }
  else {
    return unconfirmedResult(e, old, prov);
  }
  if (isSeasonal(r, temp)) return { record: null, keep: false, provenance: prov, tierWhy: "" };
  if (r.status !== "closed") delete r.closed_on;
  return null;
}

// The field names are a closed whitelist, never object paths supplied by a page or a model.
const booleanSetters = new Map<string, (record: CoffeeRecord, value: boolean) => void>([
  ["serving.espresso", (r, value) => { (r.serving ??= {}).espresso = value; }],
  ["serving.filter", (r, value) => { (r.serving ??= {}).filter = value; }],
  ["serving.pour_over", (r, value) => { (r.serving ??= {}).pour_over = value; }],
  ["serving.batch_brew", (r, value) => { (r.serving ??= {}).batch_brew = value; }],
  ["serving.cold_brew", (r, value) => { (r.serving ??= {}).cold_brew = value; }],
  ["serving.decaf", (r, value) => { (r.serving ??= {}).decaf = value; }],
  ["serving.plant_milk", (r, value) => { (r.serving ??= {}).plant_milk = value; }],
  ["amenities.wifi", (r, value) => { (r.amenities ??= {}).wifi = value; }],
  ["amenities.laptop_friendly", (r, value) => { (r.amenities ??= {}).laptop_friendly = value; }],
  ["amenities.kids_friendly", (r, value) => { (r.amenities ??= {}).kids_friendly = value; }],
  ["amenities.vegan_options", (r, value) => { (r.amenities ??= {}).vegan_options = value; }],
  ["amenities.dogs_allowed", (r, value) => { (r.amenities ??= {}).dogs_allowed = value; }],
  ["amenities.outdoor_seating", (r, value) => { (r.amenities ??= {}).outdoor_seating = value; }],
  ["amenities.card_payment", (r, value) => { (r.amenities ??= {}).card_payment = value; }],
  ["amenities.cash_only", (r, value) => { (r.amenities ??= {}).cash_only = value; }],
  ["amenities.wheelchair_accessible", (r, value) => { (r.amenities ??= {}).wheelchair_accessible = value; }],
  ["food.breakfast", (r, value) => { (r.food ??= {}).breakfast = value; }],
  ["food.lunch", (r, value) => { (r.food ??= {}).lunch = value; }],
  ["food.cakes_baked_in_house", (r, value) => { (r.food ??= {}).cakes_baked_in_house = value; }],
  ["roasts_own_beans", (r, value) => { r.roasts_own_beans = value; }],
  ["sells_beans", (r, value) => { r.sells_beans = value; }],
  ["sells_equipment", (r, value) => { r.sells_equipment = value; }],
  ["offers_courses", (r, value) => { r.offers_courses = value; }],
]);
function setBoolean(r: CoffeeRecord, field: string, value: boolean): boolean {
  const setter = booleanSetters.get(field);
  if (!setter) return false;
  setter(r, value);
  return true;
}

function applyServing(r: CoffeeRecord, e: Enriched, prov: ProvenanceMap) {
  for (const f of e.facts) if (typeof f.value === "boolean" && setBoolean(r, f.field, f.value)) prov.set(f.field, source(f));
  if (r.amenities?.cash_only === true && r.amenities.card_payment === true) { delete r.amenities.cash_only; delete r.amenities.card_payment; }
  const focus = stringFact(e.facts, "food_focus");
  if (focus) { (r.food ??= {}).focus = focus.value; prov.set("food.focus", source(focus)); }
}
function applyRoasters(r: CoffeeRecord, c: Candidate, e: Enriched, prov: ProvenanceMap) {
  const served: (Roaster & { evidence: Verified })[] = [];
  for (const f of e.facts) {
    if (f.field !== "roaster" || typeof f.value !== "string" || served.some((s) => nameSim(s.name, String(f.value)) >= 0.85)) continue;
    const own = r.roasts_own_beans === true && nameSim(f.value, c.name) >= 0.75;
    served.push({ name: f.value, ...(own ? { own: true } : {}), evidence: f });
  }
  const first = served.at(0);
  if (!first) return;
  r.roasters_served = served.map((s) => ({ name: s.name, ...(s.own ? { own: true } : {}) }));
  prov.set("roasters_served", { value: served.map((s) => s.name), via: served.map((s) => `${s.name}: website`).join("; "), url: first.evidence.url, quote: first.evidence.quote });
}
function applyCommerce(r: CoffeeRecord, e: Enriched, ctx: BuildContext, prov: ProvenanceMap) {
  const cups = e.facts.filter((f): f is Verified & { value: string } => f.field === "reusable_cup" && typeof f.value === "string");
  if (cups[0]) { r.reusable_cup_systems = [...new Set(cups.map((f) => f.value))].sort(); prov.set("reusable_cup_systems", { value: r.reusable_cup_systems, via: "website", url: cups[0].url }); }
  const op = stringFact(e.facts, "operator"), register = stringFact(e.facts, "register_id");
  if (op) {
    const lf = op.value.match(/(GmbH & Co\.? KG|gGmbH|GmbH|UG \(haftungsbeschränkt\)|UG|AG|KG|OHG|SE|eG|e\.\s?V\.|Ltd\.?)$/)?.[1];
    r.operator = { name: op.value, ...(lf ? { legal_form: lf } : {}), ...(register ? { register_id: register.value } : {}) };
    prov.set("operator", { ...source(op), value: r.operator, via: "website legal notice" });
  }
  const price = e.facts.find((f) => f.field === "cappuccino_price");
  if (price && typeof price.value === "number") {
    r.prices = { cappuccino: { amount: price.value, currency: ctx.country === "CH" ? "CHF" : "EUR", observed_on: price.fetchedAt.slice(0, 10), source_url: price.url } };
    prov.set("prices.cappuccino", source(price));
  }
}
function social(pages: SitePage[], re: RegExp, bad: RegExp): string | null {
  const hits = new Set<string>();
  for (const p of pages) for (const l of p.doc.links) { const m = l.href.match(re); if (m && !bad.test(m[1])) hits.add(m[1].toLowerCase()); }
  return hits.size === 1 ? [...hits][0] : null;
}
function applyLinks(r: CoffeeRecord, c: Candidate, e: Enriched, prov: ProvenanceMap) {
  const pages = e.match && e.site?.ok ? e.site.pages : [], page = pages.at(0);
  if (page) {
    const u = new URL(page.url);
    r.links = { ...r.links, website: u.pathname.length <= 1 ? `${u.origin}/` : u.href };
    prov.set("links.website", { value: r.links.website, via: "fetched and matched (name and address on the site)", url: page.url });
    applySiteSocials(r, pages, page, prov);
  }
  applyOvertureInstagram(r, c, prov);
  if (r.links && !Object.keys(r.links).length) delete r.links;
}

const IG_PROFILE = /^https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9_.]+)\/?(?:\?.*)?$/;
const IG_NON_PROFILE = /^(p|reel|reels|explore|stories|accounts|tv|share)$/;

const FB_PROFILE = /^https?:\/\/(?:www\.|m\.)?facebook\.com\/([A-Za-z0-9_.-]{3,})\/?(?:\?.*)?$/;
const FB_NON_PROFILE = /^(sharer|share|dialog|plugins|intent|tr|login|home|profile|events|groups|pages)(\.php)?$/i;

function applySiteSocials(r: CoffeeRecord, pages: SitePage[], page: SitePage, prov: ProvenanceMap) {
    r.links ??= {};
  const ig = social(pages, IG_PROFILE, IG_NON_PROFILE);
    if (ig) { r.links.instagram = `https://www.instagram.com/${ig}/`; prov.set("links.instagram", { value: r.links.instagram, via: "linked from the place's website", url: page.url }); }
  const fb = social(pages, FB_PROFILE, FB_NON_PROFILE);
    if (fb) { r.links.facebook = `https://www.facebook.com/${fb}/`; prov.set("links.facebook", { value: r.links.facebook, via: "linked from the place's website", url: page.url }); }
}
function notPublic(r: CoffeeRecord, business = ""): boolean {
  const cafeService = !!(r.serving?.espresso || r.serving?.filter) && !!r.opening_hours;
  return ["office_service", "staff_canteen"].includes(business) || (["online_shop", "school", "manufacturer", "play_area", "youth_or_community_centre"].includes(business) && !cafeService);
}
function applyTier(r: CoffeeRecord, c: Candidate, e: Enriched, prov: ProvenanceMap): string {
  const business = stringFact(e.facts, "primary_business")?.value, focus = stringFact(e.facts, "food_focus")?.value;
  const specialty = e.facts.find((f) => f.field === "specialty");
  const t = tier({
    name: r.name, brand: c.brand, overtureCategory: c.category, roastsOwn: r.roasts_own_beans, filter: r.serving?.filter || r.serving?.pour_over,
    specialtyClaim: !!specialty || /specialty|speciality|spezialitäten/i.test(r.name),
    roasters: e.facts.flatMap((f) => f.field === "roaster" && typeof f.value === "string" ? [{ name: f.value }] : []),
    business, focus, siteVerified: !!(e.site?.ok && e.match), open: r.status === "open", servesPublic: servesPublic(r, business),
  });
  r.specialty_tier = t.tier;
  prov.set("specialty_tier", { value: t.tier, via: `rule: ${t.why}`, url: specialty?.url, quote: specialty?.quote });
  const description = describe(r);
  if (description) { r.description = description; prov.set("description", { value: description, via: "generated from the stored fields" }); } else delete r.description;
  return t.why;
}
function servesPublic(r: CoffeeRecord, business = ""): boolean {
  return !!r.opening_hours || !!(r.serving?.espresso || r.serving?.filter || r.serving?.pour_over) || ["cafe", "restaurant", "bakery", "bar", "hotel"].includes(business);
}
export function buildRecord(job: Job, c: Candidate, e: Enriched, old: CoffeeRecord | null, ctx: BuildContext): Built {
  const prov: ProvenanceMap = new Map();
  const pos = position(c, e, ctx, prov);
  if ("missing" in pos) return { record: null, provenance: prov, conflict: pos.conflict ?? "no coordinates", tierWhy: "" };
  if (pos.conflict && !old) return { record: null, provenance: prov, conflict: pos.conflict, tierWhy: "" };
  const r = initialRecord(job, c, e, old, ctx, pos);
  applyAddress(r, c, old, e, pos, ctx, prov);
  const statusResult = applyStatus(r, e, old, prov);
  if (statusResult) return statusResult;
  r.checked_at = iso(ctx.now);
  const oh = stringFact(e.facts, "opening_hours");
  if (oh) { r.opening_hours = oh.value; prov.set("opening_hours", source(oh)); }
  if (job.mode === "refresh") return { record: r, provenance: prov, conflict: pos.conflict, tierWhy: "refresh only" };
  applyServing(r, e, prov);
  applyRoasters(r, c, e, prov);
  applyCommerce(r, e, ctx, prov);
  applyLinks(r, c, e, prov);
  applyCrossReferences(r, c, pos);
  const business = primaryBusiness(e);
  if (notPublic(r, business)) return { record: null, keep: false, provenance: prov, tierWhy: `not a public coffee place (${business})` };
  const tierWhy = applyTier(r, c, e, prov);
  return { record: r, provenance: prov, conflict: pos.conflict, tierWhy };
}

function initialRecord(job: Job, c: Candidate, e: Enriched, old: CoffeeRecord | null, ctx: BuildContext, pos: Position): CoffeeRecord {
  const siteUnreadable = !!e.site && !e.site.ok && !e.site.dead;
  return old && (job.mode === "refresh" || siteUnreadable) ? structuredClone(old) : {
    id: job.id, name: c.name, status: "unverified", checked_at: iso(ctx.now), location: { lat: pos.lat, lon: pos.lon }, ...(old?.image ? { image: old.image } : {}),
  };
}

function applyCrossReferences(r: CoffeeRecord, c: Candidate, pos: Position) {
  r.xref = { ...r.xref, ...(pos.overtureId ? { overture: pos.overtureId } : {}), ...(c.wikidata ? { wikidata: c.wikidata } : {}) };
  if (!Object.keys(r.xref).length) delete r.xref;
}

function movedPosition(c: Candidate, siteStreet: string, sitePc: string | undefined, ctx: BuildContext, prov: ProvenanceMap): Position | null {
  const moved = ctx.inside.find((x) => x.status !== "permanently_closed" && sameStreet(x.street, siteStreet) && (nameSim(x.name, c.name) >= 0.5 || ownHost(x.websites[0]) === ownHost(c.website)));
  if (!moved) return null;
  prov.set("location", { value: [moved.lat, moved.lon], via: "overture (record at the address on the website)", url: overtureUrl(moved.id) });
  return { lat: moved.lat, lon: moved.lon, overtureId: moved.id, street: siteStreet, postcode: sitePc ?? moved.postcode ?? undefined };
}

function applyIdentity(r: CoffeeRecord, c: Candidate, old: CoffeeRecord | null, pos: Position, ctx: BuildContext, prov: ProvenanceMap) {
  const origin = c.origins.at(0);
  r.name = signName(old?.name ?? cleanName(c.name, ctx.cityName));
  prov.set("name", { value: r.name, via: c.overtureIds.length ? "overture" : origin?.via ?? "unknown", url: c.overtureIds[0] ? overtureUrl(c.overtureIds[0]) : origin?.url });
  r.location = { lat: Math.round(pos.lat * 1e6) / 1e6, lon: Math.round(pos.lon * 1e6) / 1e6 };
  if (!prov.has("location")) prov.set("location", locationSource(r, c, pos));
}

function locationSource(r: CoffeeRecord, c: Candidate, pos: Position) {
  const value = [r.location.lat, r.location.lon];
  if (c.geoUrl && !pos.overtureId) return { value, via: c.geoVia ?? "website", url: c.geoUrl };
  return { value, via: "overture", url: pos.overtureId ? overtureUrl(pos.overtureId) : undefined };
}

function applyStreet(addr: Address, e: Enriched, pos: Position, prov: ProvenanceMap) {
  const streetFact = stringFact(e.facts, "street_address");
  if (pos.street && /\d/.test(pos.street) && !pos.conflict) {
    addr.street_address = pos.street;
    prov.set("address.street_address", streetFact && cleanStreet(streetFact.value) === pos.street ? { ...source(streetFact), value: pos.street } : { value: pos.street, via: "overture", url: overtureUrl(pos.overtureId) });
  }
}

function applyPostcode(addr: Address, e: Enriched, pos: Position, ctx: BuildContext, prov: ProvenanceMap) {
  const pcFact = stringFact(e.facts, "postal_code");
  const postcode = pos.postcode;
  if (postcode && addr.street_address && (ctx.country === "DE" ? /^\d{5}$/ : /^\d{4}$/).test(postcode) && ctx.inside.some((x) => x.postcode === postcode)) {
    addr.postal_code = postcode;
    prov.set("address.postal_code", pcFact?.value === postcode ? source(pcFact) : { value: postcode, via: "overture", url: overtureUrl(pos.overtureId) });
  }
}

function unconfirmedResult(e: Enriched, old: CoffeeRecord | null, prov: ProvenanceMap): Built {
  const known = !!old && old.status !== "unverified" && !old.merged_into && !!e.site && !e.site.ok;
  const why = e.site?.dead ? `website dead: ${e.site.error}` : e.site && !e.site.ok ? `website not readable: ${e.site.error}` : "not confirmed on its own website in this run";
  return { record: null, keep: known, provenance: prov, conflict: known ? why : undefined, tierWhy: "" };
}

function isSeasonal(r: CoffeeRecord, temp?: Verified) {
  return SEASONAL.test(r.name) || !!temp && /winter|saison|season/i.test(temp.quote);
}

const possibleMove = (e: Enriched, street: string, previous?: string) => !e.multi && !sameStreet(street, previous);

function applyOvertureInstagram(r: CoffeeRecord, c: Candidate, prov: ProvenanceMap) {
  if (!r.links?.instagram) {
    const ig = (c.socials ?? []).flatMap((s) => { const match = s.match(/^https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9_.]+)\/?$/); return match ? [match[1]] : []; });
    if (ig.length === 1) { r.links = { ...r.links, instagram: `https://www.instagram.com/${ig[0].toLowerCase()}/` }; prov.set("links.instagram", { value: r.links.instagram, via: "overture", url: overtureUrl(c.overtureIds[0]) }); }
  }
}

function coordinatePair(lat?: number, lon?: number) {
  return lat == null || lon == null ? null : { lat, lon };
}

function siteAddress(e: Enriched) {
  return { siteStreet: cleanStreet(stringFact(e.facts, "street_address")?.value) ?? undefined,
    sitePc: stringFact(e.facts, "postal_code")?.value };
}

function primaryBusiness(e: Enriched) {
  return stringFact(e.facts, "primary_business")?.value;
}
