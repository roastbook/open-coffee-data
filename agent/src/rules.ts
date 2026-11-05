// Data rules shared by the agent (before it writes) and the linter (on every dataset file in CI).
// Dependency-free except opening_hours, which the repository root also installs.

/** Hosts that are never a place's own website: directories, delivery and booking platforms, social networks, guides, maps. */
const PLATFORM = /(^|\.)(gelbeseiten\.de|dasoertliche\.de|11880\.com|cylex\.de|cylex-branchenbuch\.de|golocal\.de|meinestadt\.de|stadtbranchenbuch\.com|branchenbuch\.\w+|werkenntdenbesten\.de|yably\.de|muenchen\.de|speisekarte\.de|speisekartenweb\.de|speisekarte\.menu|lieferando\.\w+|sun-lieferservice\.de|ubereats\.com|wolt\.com|foodora\.\w+|facebook\.com|instagram\.com|tiktok\.com|linktr\.ee|linktree\.com|tripadvisor\.\w+|yelp\.\w+|opentable\.\w+|quandoo\.\w+|thefork\.\w+|restaurantguru\.\w+|wanderlog\.com|happycow\.net|foursquare\.com|google\.\w+|goo\.gl|g\.page|openstreetmap\.org|extract\.coffee|europeancoffeetrip\.com|roasters\.app|falstaff\.\w+|mitvergnuegen\.com|mucbook\.de|gastroguide\.\w+)$/i;

export function isPlatformUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return h !== "sites.google.com" && PLATFORM.test(h); // Google Sites pages are the place's own site
  } catch { return true; }
}

export const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
// German and international phone numbers (+49 89 123456, 089/123456, 0176-1234567); not postcodes or years.
export const PHONE = /(\+\d{2}[\s/-]?\(?0?\)?\d{2,5}[\s/-]?\d{3,}[\s-]?\d*|\b0\d{2,5}[\s/-]\d{3,}[\s-]?\d*)/;

const LEGAL_SUFFIX = /[\s,]+(GmbH\s*&\s*Co\.?\s*KG|gGmbH|GmbH|mbH|UG\s*\(haftungsbeschränkt\)|UG|GbR|OHG|KG|AG|SE|e\.\s?K\.|e\.\s?V\.|Sp\.\s?z\s?o\.\s?o\.(\s*&\s*Co\.?\s*KG)?|Ltd\.?|Inc\.?)\s*$/i;

/** The name on the sign: drop SEO tails ("Name | Premium Barista Service | …") and trailing legal forms ("Picnic On Monday Gmbh"). */
/** "… Inh. Frau Dr. Jane Doe", "… Inhaber Max Muster": an owner's (natural person's) name inside a place name. */
export const OWNER_IN_NAME = /[\s,–-]+(Inh\.|Inhaber(in)?\b|Owner\b|Betreiber(in)?\b)/i;

export function cleanName(name: string): string {
  let n = name.split(/\s+\|\s+/)[0].trim();
  const owner = n.search(OWNER_IN_NAME);
  if (owner > 0) n = n.slice(0, owner).trim();
  for (let i = 0; i < 2; i++) n = n.replace(LEGAL_SUFFIX, "").trim();
  n = n.replace(/[\s,;:–-]+$/, "").trim();
  return n.length >= 2 ? n : name.trim();
}

export const nameProblems = (name: string): string[] => [
  ...(LEGAL_SUFFIX.test(name) ? ["ends with a legal form"] : []),
  ...(/\|/.test(name) || name.length > 60 ? ["looks like an SEO title"] : []),
  ...(/^[\wäöüß.-]+(str(\.|asse|aße)?|platz|weg|allee|ring|gasse)\.?$/i.test(name.trim()) ? ["is a street name"] : []),
  ...(EMAIL.test(name) || /https?:\/\//.test(name) ? ["contains contact data or a URL"] : []),
];

const STREET_WORD = /(straße|strasse|str\.|platz|weg|allee|ring|gasse|markt|ufer|damm|anger|berg|steig|hof|garten|brücke|bogen|zeile|tal\b|graben|lände|anlage)/i;
const STREET_SHAPE = /^[A-Za-zÄÖÜäöüßéè][\wÄÖÜäöüßéè.' -]*?\s\d{1,4}\s?[a-zA-Z]?(\s?[-–/]\s?\d{1,4}\s?[a-zA-Z]?)?$/;

/** "street number" out of a longer address string ("Eingang Kaulbachstr, Königinstraße 37" -> "Königinstraße 37").
 *  The result is always a substring of the input, so a value confirmed on a page stays confirmed. Null if none. */
export function cleanStreet(s: string | undefined | null): string | null {
  if (!s) return null;
  const parts = s.replace(EMAIL, " ").replace(/https?:\/\/\S+/g, " ").split(/\s*[,;|]\s*|\s+\/\s+|\s+[–-]\s+/).map((p) => p.trim()).filter(Boolean);
  const shaped = parts.filter((p) => STREET_SHAPE.test(p));
  return shaped.find((p) => STREET_WORD.test(p)) ?? shaped[0] ?? null;
}

export const streetProblems = (s: string): string[] => [
  ...(EMAIL.test(s) || /https?:\/\/|www\./i.test(s) ? ["contains an email address or URL"] : []),
  ...(PHONE.test(s) ? ["contains a phone number"] : []),
  ...(!STREET_SHAPE.test(s.trim()) ? ["is not 'street number'"] : []),
];

export const POSTCODE: Record<string, RegExp> = { DE: /^\d{5}$/, AT: /^\d{4}$/, CH: /^\d{4}$/ };

/** cash_only needs the page to say cash is the only way to pay, not just that cash is accepted. */
export const CASH_ONLY = /\bnur\b.{0,20}bar|ausschließlich.{0,20}bar|nur cash|cash only|only cash|keine (ec|karten|kartenzahlung)|no cards?\b|kein(e)? kartenzahlung/;

export const LEGAL_FORM = /\b(GmbH & Co\.? KG|gGmbH|GmbH|UG \(haftungsbeschränkt\)|UG|AG|KG|OHG|SE|eG|e\.\s?V\.|Ltd\.?|S\.?r\.?l\.?|SARL|Sàrl)(?![\w])/;
export const NOT_LEGAL_ENTITY = /\be\.\s?K(fm|fr)?\.|\beK\b|\bGbR\b|\bInh(\.|aber)|\bInhaberin\b|\beingetragene[rn]? Kauf/;
