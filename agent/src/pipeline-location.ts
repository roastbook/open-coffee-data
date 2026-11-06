import type { Candidate } from "./candidate";
import { cities } from "./cities";
import { distanceM, type LatLon } from "./geo";
import { fold, nameSim, ownHost, parseStreet, sameStreet } from "./names";
import type { Row } from "./pipeline-model";
import type { CoffeeRecord } from "./record";
import { nonCoffeeName } from "./tier";
import { SEASONAL } from "./rules";

const HTTP_URL = /^https?:\/\//;
const STREET_HINT = /([A-ZÄÖÜ][\wäöüß.-]{0,120}(?:straße|strasse|str\.|platz|weg|allee|ring|gasse|markt))(?:\s+(\d+\s?[a-z]?))?\b/;

export function streetStemIn(street: string, foldedText: string) {
  const s = parseStreet(street)?.street.replace(/strasse$|platz$|weg$|allee$|ring$|gasse$/, "");
  return !!s && s.length >= 4 && foldedText.includes(s);
}

/** schema.org GeoCoordinates published in the site's own JSON-LD. */
/** Position of the building at a confirmed address: every Overture record there must agree within 30 m. */
export function addressPoint(points: { street: string; postcode: string | null; lat: number; lon: number; id: string }[], street: string, postcode?: string) {
  const s = parseStreet(street);
  if (!s?.number || !postcode) return null;
  const hits = points.filter((p) => p.postcode === postcode && sameStreet(p.street, street));
  if (!hits.length || hits.some((h) => distanceM(h, hits[0]) > 30)) return null;
  return { lat: hits[0].lat, lon: hits[0].lon, url: `https://explore.overturemaps.org/#id=${hits[0].id}` };
}

/** The one location a site publishes for itself (see htmlGeo); none when it shows several places further than 50 m apart. */
export function siteGeo(pages: { url: string; doc: { geo?: { lat: number; lon: number }[] } }[]) {
  const pts = pages.flatMap((p) => (p.doc.geo ?? []).map((g) => ({ ...g, url: p.url })));
  if (!pts.length || pts.some((g) => distanceM(g, pts[0]) > 50)) return null;
  return pts[0];
}

// "THE BARN Coffee Roasters Berlin" in Munich: a trailing name of another configured city is not part of this branch's name.
const OTHER_CITIES = [...cities.map((c) => c.name), "Berlin", "Hamburg", "Munich", "Cologne", "Vienna", "Zurich"];
export function cleanName(name: string, cityName: string) {
  for (const city of OTHER_CITIES) {
    if (!name.toLowerCase().endsWith(city.toLowerCase()) || fold(city) === fold(cityName) || (cityName === "München" && city.toLowerCase() === "munich")) continue;
    const prefix = name.slice(0, -city.length);
    if (/[\s,–-]$/.test(prefix)) return prefix.replace(/[\s,–-]+$/, "").trim();
  }
  return name;
}
export function fromOverture(r: Row): Candidate {
  const webs = r.websites.filter((w) => HTTP_URL.test(w));
  const c: Candidate = { key: `ov:${r.id}`, name: r.name, lat: r.lat, lon: r.lon, street: r.street ?? undefined, postcode: r.postcode ?? undefined, website: webs[0], overtureIds: [r.id], overtureStatus: r.status, overtureCoffee: r.coffee, category: r.category, brand: r.brand, origins: [{ via: "overture", ref: r.id }] };
  c.altWebsites = webs.slice(1);
  c.socials = r.socials;
  return c;
}

export function fromRecord(p: CoffeeRecord | null | undefined): Candidate | null {
  if (!p) return null;
  return { key: p.id, name: p.name, lat: p.location.lat, lon: p.location.lon, street: p.address?.street_address, postcode: p.address?.postal_code, website: p.links?.website, overtureIds: p.xref?.overture ? [p.xref.overture] : [], origins: [{ via: "dataset", ref: p.id }] };
}

function mergeMention(target: Candidate, m: Candidate) {
  target.website ??= m.website;
  target.origins.push(...m.origins);
}

/** Find the place a mention (no coordinates) refers to: an existing candidate, or an Overture place in the city at that address. */
/** A street name in free text ("… Herzogstraße 9, 80803 München" -> "Herzogstraße 9"), or null. */

export function streetHint(text: string): string | null {
  const m = text.match(STREET_HINT);
  return m ? `${m[1]}${m[2] ? ` ${m[2]}` : ""}` : null;
}

export function locate(m: Candidate, cands: Candidate[], inside: Row[], contains: (point: LatLon) => boolean): { c: Candidate; isNew: boolean } | "ambiguous" | null {
  const host = ownHost(m.website);
  // A mention without a parsed street may still name one ("Suuapinga Café Herzogstraße"): then a branch elsewhere is not it.
  const hint = m.street ? null : streetHint(`${m.name} ${m.origins.map((o) => o.quote ?? "").join(" ")}`);
  const fits = (name: string, street?: string | null, website?: string | null) =>
    m.street ? sameStreet(m.street, street) && (nameSim(m.name, name) >= 0.4 || (!!host && host === ownHost(website)))
      : nameSim(m.name, name) >= 0.85 && (!hint || sameStreet(hint, street));
  const inCands = cands.filter((c) => fits(c.name, c.street, c.website));
  if (inCands.length === 1) return { c: inCands[0], isNew: false };
  if (inCands.length > 1) return existingBranch(m, inCands);
  const rows = inside.filter((r) => eligibleRow(r) && fits(r.name, r.street, r.websites[0]) && contains(r)).sort((a, b) => b.confidence - a.confidence);
  if (!rows.length) return null;
  if (ambiguousRows(m, rows)) return "ambiguous";
  const c = fromOverture(rows[0]);
  mergeMention(c, m);
  c.street ??= m.street;
  c.postcode ??= m.postcode;
  return { c, isNew: true };
}

const eligibleRow = (r: Row) => r.status !== "permanently_closed" && !nonCoffeeName(r.name) && !SEASONAL.test(r.name);

const ambiguousRows = (m: Candidate, rows: Row[]) => !m.street && rows.length > 1;

function existingBranch(m: Candidate, matches: Candidate[]): { c: Candidate; isNew: boolean } | "ambiguous" {
  if (!m.street) return "ambiguous";
  return { c: matches.sort((a, b) => nameSim(m.name, b.name) - nameSim(m.name, a.name))[0], isNew: false };
}
