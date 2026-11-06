import { payloadParser, stringValue, numberValue } from "./payload";
// Openly licensed images from Wikimedia Commons (via the Wikidata image or files near the place whose title names it).
// We link to the original file; nothing is copied into the repository.
import { USER_AGENT } from "./config";
import { fold, tokens } from "./names";

const API = "https://commons.wikimedia.org/w/api.php";
const SPDX: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^cc0( 1\.0)?$/i, () => "CC0-1.0"],
  [/^cc by-sa (\d\.\d)(?: \w+)?$/i, (m) => `CC-BY-SA-${m[1]}`],
  [/^cc by (\d\.\d)(?: \w+)?$/i, (m) => `CC-BY-${m[1]}`],
  [/^public domain$/i, () => "PDM-1.0"],
];
const strip = (h: string) => h.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

interface CommonsInfo {
  mime: string; url: string; descriptionurl: string; width?: number; height?: number;
  extmetadata?: { LicenseShortName?: { value: string }; Artist?: { value: string }; ObjectName?: { value: string } };
}
interface CommonsReply { query?: { pages?: Record<string, { imageinfo?: CommonsInfo[] }>; geosearch?: { title: string; dist: number }[] } }
const metadata = { type: "object", required: ["value"], properties: { value: stringValue } };
const commonsReply = payloadParser<CommonsReply>({ type: "object", properties: { query: { type: "object", properties: {
  pages: { type: "object", additionalProperties: { type: "object", properties: { imageinfo: { type: "array", items: { type: "object", required: ["mime", "url", "descriptionurl"], properties: { mime: stringValue, url: stringValue, descriptionurl: stringValue, width: numberValue, height: numberValue, extmetadata: { type: "object", properties: { LicenseShortName: metadata, Artist: metadata, ObjectName: metadata } } } } } } } },
  geosearch: { type: "array", items: { type: "object", required: ["title", "dist"], properties: { title: stringValue, dist: numberValue } } },
} } } });

async function api(params: Record<string, string>) {
  const res = await fetch(`${API}?${new URLSearchParams({ format: "json", origin: "*", ...params }).toString()}`, { headers: { "user-agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Commons HTTP ${res.status}`);
  return commonsReply(await res.json());
}

export interface Image { url: string; licence: string; author: string; source_url: string; title?: string; width?: number; height?: number }

async function fileInfo(title: string): Promise<Image | null> {
  const j = await api({ action: "query", titles: title, prop: "imageinfo", iiprop: "url|size|extmetadata|mime", iiurlwidth: "1600" });
  const p = Object.values(j.query?.pages ?? {})[0];
  const ii = p?.imageinfo?.[0];
  if (!ii || !/^image\/(jpeg|png|webp)$/.test(ii.mime)) return null;
  const m = ii.extmetadata ?? {};
  const short = strip(m.LicenseShortName?.value ?? "");
  const rule = SPDX.map(([re, f]) => { const x = short.match(re); return x && f(x); }).find(Boolean);
  const author = strip(m.Artist?.value ?? "");
  if (!rule || !author) return null;
  return { url: ii.url, licence: rule, author: author.slice(0, 200), source_url: ii.descriptionurl, title: strip(m.ObjectName?.value ?? title.replace(/^File:/, "").replace(/\.\w+$/, "")).slice(0, 200), width: ii.width, height: ii.height };
}

export async function findImage(p: { name: string; lat: number; lon: number; wikidataImage?: string }): Promise<{ image: Image; how: string } | null> {
  if (p.wikidataImage) {
    const title = "File:" + decodeURIComponent(p.wikidataImage.split("/").at(-1) ?? "").replace(/_/g, " ");
    const img = await fileInfo(title);
    if (img) return { image: img, how: "Wikidata image (P18)" };
  }
  const j = await api({ action: "query", list: "geosearch", gscoord: `${p.lat}|${p.lon}`, gsradius: "120", gsnamespace: "6", gslimit: "50" });
  // The file title must contain the place's whole name (legal form dropped): a shared word such as a street,
  // market or "Turm" matched unrelated buildings and stalls.
  const full = fold(p.name.replace(/\b(GmbH|UG|AG|KG|GbR|e\.?K\.?)\b.*$/i, ""));
  if (tokens(p.name).join("").length < 5 || full.split(" ").length < 2) return null;
  for (const g of j.query?.geosearch ?? []) {
    const t = fold(g.title);
    if (!t.includes(full)) continue;
    const img = await fileInfo(g.title);
    if (img) return { image: img, how: `Commons file ${Math.round(g.dist)} m away whose title contains the place's full name` };
  }
  return null;
}
