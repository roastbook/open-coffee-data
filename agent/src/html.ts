import { parse } from "node-html-parser";

export type Link = { href: string; text: string };
export type Doc = { title: string; text: string; links: Link[]; jsonld: string; geo?: { lat: number; lon: number }[] };

const BLOCK = /^(p|div|br|li|ul|ol|h[1-6]|tr|td|th|table|section|article|header|footer|nav|aside|main|dd|dt|dl|address|blockquote|figure|figcaption|form|label|option|span)$/i;

/** Visible text (with line breaks between blocks), links and JSON-LD of an HTML page. */
export function htmlToDoc(html: string, baseUrl: string): Doc {
  const root = parse(html.replace(/<!doctype[^>]*>/i, ""), { comment: false, blockTextElements: { script: true, style: true, noscript: false } });
  const jsonld = root.querySelectorAll('script[type="application/ld+json"]').map((s) => s.textContent.trim()).join("\n");
  const links: Link[] = [];
  for (const a of root.querySelectorAll("a[href]")) {
    try { links.push({ href: new URL(a.getAttribute("href")!.trim(), baseUrl).href, text: a.textContent.replace(/\s+/g, " ").trim().slice(0, 80) }); } catch {}
  }
  root.querySelectorAll("script,style,noscript,svg,template,iframe").forEach((n) => n.remove());
  const parts: string[] = [];
  const walk = (n: any) => {
    if (n.nodeType === 3) { parts.push(decode(n.rawText)); return; }
    const tag = n.rawTagName ?? "";
    const block = BLOCK.test(tag) && tag.toLowerCase() !== "span";
    if (block) parts.push("\n");
    for (const c of n.childNodes) walk(c);
    if (block) parts.push("\n");
    else if (tag) parts.push(" ");
  };
  walk(root);
  const text = parts.join("").replace(/[ \t ]+/g, " ").replace(/ *\n[\s]*/g, "\n").trim();
  return { title: root.querySelector("title")?.textContent.trim() ?? "", text, links, jsonld, geo: htmlGeo(html) };
}

function decode(s: string) {
  return s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&ndash;/g, "–").replace(/&mdash;/g, "—")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+)uml;/gi, (_, c) => ({ a: "ä", o: "ö", u: "ü", A: "Ä", O: "Ö", U: "Ü" } as any)[c] ?? _).replace(/&szlig;/g, "ß");
}

const NUM = "(-?\\d{1,3}\\.\\d{4,})";
// Coordinates the site publishes itself: schema.org, geo meta tags, and the marker of an embedded Leaflet or OpenStreetMap
// map. Google Maps embeds are skipped: those coordinates are Google's data.
const GEO_PATTERNS: RegExp[] = [
  new RegExp(`"latitude"\\s*:\\s*"?${NUM}"?[\\s\\S]{0,80}?"longitude"\\s*:\\s*"?${NUM}`, "g"),
  new RegExp(`name=["'](?:geo\\.position|ICBM)["']\\s+content=["']${NUM}\\s*[;,]\\s*${NUM}`, "gi"),
  new RegExp(`property=["']place:location:latitude["']\\s+content=["']${NUM}["'][\\s\\S]{0,200}?place:location:longitude["']\\s+content=["']${NUM}`, "gi"),
  new RegExp(`openstreetmap\\.org/export/embed\\.html[^"']*?marker=${NUM}(?:%2C|,)${NUM}`, "g"),
  new RegExp(`data-lat(?:itude)?=["']${NUM}["'][^>]*?data-(?:lng|lon|longitude)=["']${NUM}`, "gi"),
  new RegExp(`L\\.marker\\(\\s*\\[\\s*${NUM}\\s*,\\s*${NUM}`, "g"),
];

export function htmlGeo(html: string): { lat: number; lon: number }[] {
  const out: { lat: number; lon: number }[] = [];
  for (const re of GEO_PATTERNS) for (const m of html.matchAll(re)) {
    const lat = +m[1], lon = +m[2];
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) out.push({ lat, lon });
  }
  return out;
}
