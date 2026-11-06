// Name and address normalisation for matching. Never used to build ids.
const GENERIC = new Set(["cafe", "caffe", "caffè", "kaffee", "coffee", "coffeeshop", "shop", "bar", "espresso", "espressobar", "rosterei", "roastery", "kaffeerosterei", "roasters", "roaster", "co", "und", "and", "the", "der", "die", "das", "munchen", "muenchen", "munich", "gmbh", "bistro", "haus", "kaffeehaus", "store", "house", "stube", "kaffeebar", "coffeebar", "&"]);

export function fold(s: string) {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, " ").trim();
}
export const tokens = (s: string) => fold(s).split(" ").filter((t) => t && !GENERIC.has(t));

function lev(a: string, b: string) {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return d[b.length];
}

/** 0..1 similarity of two place names, ignoring generic words like "Café" or "Kaffeerösterei". */
export function nameSim(a: string, b: string): number {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.length || !tb.length) return fold(a) === fold(b) ? 1 : 0;
  const ja = ta.join(""), jb = tb.join("");
  if (ja === jb) return 1;
  if (ja.length >= 4 && jb.length >= 4 && (ja.includes(jb) || jb.includes(ja))) return 0.85;
  const sa = new Set(ta), sb = new Set(tb);
  const inter = [...sa].filter((t) => sb.has(t) || [...sb].some((u) => t.length > 4 && u.length > 4 && lev(t, u) <= 1)).length;
  const jac = inter / new Set([...sa, ...sb]).size;
  const ed = 1 - lev(ja, jb) / Math.max(ja.length, jb.length);
  return Math.max(jac, ed);
}

/** "Türkenstraße 52a" -> { street: "turkenstrasse", number: "52a" }. Abbreviations str./straße unified. */
export function parseStreet(s: string | null | undefined) {
  if (!s) return null;
  const f = fold(s.replace(/str\.(?=\s|\d|$)/gi, "straße").replace(/strasse/gi, "straße").replace(/pl\.(?=\s|\d|$)/gi, "platz")).replace(/\bstr\b/g, "strasse");
  const m = f.match(/^(.*?)\s+(\d+\s?[a-z]?)(\s|$)/);
  return m ? { street: m[1].replace(/\s+/g, ""), number: m[2].replace(/\s/g, "") } : { street: f.replace(/\s+/g, ""), number: null };
}
export function sameStreet(a: string | null | undefined, b: string | null | undefined) {
  const pa = parseStreet(a), pb = parseStreet(b);
  return !!pa && !!pb && pa.street === pb.street && (!pa.number || !pb.number || pa.number === pb.number);
}

const SHARED_HOSTS = /(^|\.)(facebook|instagram|linktr|linktree|google|wix|jimdo|squarespace|wordpress|business\.site|lieferando|sun-lieferservice|speisekarte|tripadvisor|yelp|opentable|quandoo|ubereats|wolt|foodora)\./;
/** Registrable host of an own website, or null for shared or platform hosts that do not identify a place. */
export function ownHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return SHARED_HOSTS.test("." + h + ".") ? null : h;
  } catch { return null; }
}
