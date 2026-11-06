import { parse, HTMLElement, type Node } from "node-html-parser";

export interface Link { href: string; text: string }
export interface Doc { title: string; text: string; links: Link[]; jsonld: string; images?: Link[]; geo?: { lat: number; lon: number }[] }

const BLOCK = /^(p|div|br|li|ul|ol|h[1-6]|tr|td|th|table|section|article|header|footer|nav|aside|main|dd|dt|dl|address|blockquote|figure|figcaption|form|label|option|span)$/i;

/** Visible text (with line breaks between blocks), links and JSON-LD of an HTML page. */
export function htmlToDoc(html: string, baseUrl: string): Doc {
  const root = parse(html.replace(/<!doctype[^>]*>/i, ""), { comment: false, blockTextElements: { script: true, style: true, noscript: false } });
  const jsonld = root.querySelectorAll('script[type="application/ld+json"]').map((s) => s.textContent.trim()).join("\n");
  // Facts that some sites keep only in page data (JSON-LD hours, Next.js page props): their text values join the page text.
  const dataText = [jsonld, ...root.querySelectorAll('script#__NEXT_DATA__, script[type="application/json"]').map((s) => s.textContent)]
    .flatMap((j) => { try { return jsonStrings(JSON.parse(j)); } catch { return []; } }).join("\n").slice(0, 30000);
  const links = collectLinks(root, baseUrl);
  const images = collectImages(root, baseUrl);
  root.querySelectorAll("script,style,noscript,svg,template,iframe").forEach((n) => n.remove());
  const text = visibleText(root, dataText);
  return { title: root.querySelector("title")?.textContent.trim() ?? "", text, links, jsonld, images, geo: htmlGeo(html) };
}


// Coordinates the site publishes itself: schema.org, geo meta tags, and the marker of an embedded Leaflet or OpenStreetMap
// map. Google Maps embeds are skipped: those coordinates are Google's data.
const GEO_PATTERNS: RegExp[] = [
  /"latitude"\s*:\s*"?(-?\d{1,3}\.\d{4,})"?[\s\S]{0,80}?"longitude"\s*:\s*"?(-?\d{1,3}\.\d{4,})/g,
  /name=["'](?:geo\.position|ICBM)["']\s+content=["'](-?\d{1,3}\.\d{4,})\s*[;,]\s*(-?\d{1,3}\.\d{4,})/gi,
  /property=["']place:location:latitude["']\s+content=["'](-?\d{1,3}\.\d{4,})["'][\s\S]{0,200}?place:location:longitude["']\s+content=["'](-?\d{1,3}\.\d{4,})/gi,
  /openstreetmap\.org\/export\/embed\.html[^"']*?marker=(-?\d{1,3}\.\d{4,})(?:%2C|,)(-?\d{1,3}\.\d{4,})/g,
  /data-lat(?:itude)?=["'](-?\d{1,3}\.\d{4,})["'][^>]*?data-(?:lng|lon|longitude)=["'](-?\d{1,3}\.\d{4,})/gi,
  /L\.marker\(\s*\[\s*(-?\d{1,3}\.\d{4,})\s*,\s*(-?\d{1,3}\.\d{4,})/g,
];

export function htmlGeo(html: string): { lat: number; lon: number }[] {
  const out: { lat: number; lon: number }[] = [];
  for (const re of GEO_PATTERNS) for (const m of html.matchAll(re)) {
    const lat = +m[1], lon = +m[2];
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) out.push({ lat, lon });
  }
  return out;
}

/** Readable text values of a JSON document (no keys, no URLs, no ids). */
function jsonStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") {
    const text = readableJsonString(v);
    if (text) out.push(text);
    return out;
  }
  if (v && typeof v === "object") for (const x of Object.values(v)) jsonStrings(x, out);
  return out;
}

function collectLinks(root: HTMLElement, baseUrl: string): Link[] {
  const links: Link[] = [];
  for (const a of root.querySelectorAll("a[href]")) {
    const href = absoluteUrl(a.getAttribute("href"), baseUrl);
    if (href) links.push({ href, text: a.textContent.replace(/\s+/g, " ").trim().slice(0, 80) });
  }
  return links;
}

function collectImages(root: HTMLElement, baseUrl: string): Link[] {
  // Images with their alt text: menus are often only photos (read in site.ts).
  const images: Link[] = [];
  for (const img of root.querySelectorAll("img")) {
    const src = imageSource(img);
    const href = src && !src.startsWith("data:") ? absoluteUrl(src, baseUrl) : null;
    if (href) images.push({ href, text: (img.getAttribute("alt") ?? "").trim().slice(0, 80) });
  }
  return images;
}

function absoluteUrl(value: string | undefined, baseUrl: string): string | null {
  if (value === undefined) return null;
  try { return new URL(value.trim(), baseUrl).href; } catch { return null; }
}

function visibleText(root: HTMLElement, dataText: string): string {
  const parts: string[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === 3) { parts.push(n.text); return; } // decoded entities
    const tag = n instanceof HTMLElement ? n.rawTagName ?? "" : "";
    const block = BLOCK.test(tag) && tag.toLowerCase() !== "span";
    if (block) parts.push("\n");
    for (const c of n.childNodes) walk(c);
    if (block) parts.push("\n");
    else if (tag) parts.push(" ");
  };
  walk(root);
  // Zero-width characters and soft hyphens are dropped, so quotes match what a reader sees.
  const text = (parts.join("") + (dataText ? `\n${dataText}` : "")).replace(/[\u200b-\u200d\u2060\ufeff\u00ad]/g, "").replace(/[ \t\u00a0]+/g, " ").replace(/ *\n[\s]*/g, "\n").trim();
  return text;
}


function readableJsonString(value: string): string | null {
  const text = value.replace(/<[^>]+>/g, " ").trim();
  if (text.length < 3 || !/[a-zäöüß]{3}/i.test(text)) return null;
  return /^(https?:|\/|[\w-]+\.(jpe?g|png|webp|svg|js|css))/.test(text) ? null : text;
}

function imageSource(image: HTMLElement): string | undefined {
  return image.getAttribute("data-src") ?? image.getAttribute("src") ?? image.getAttribute("srcset")?.split(",").pop()?.trim().split(/\s+/)[0];
}
