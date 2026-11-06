// Fetch a place's own website: the homepage plus up to 10 linked pages that usually carry facts (at most 3 of them PDFs).
import { DEAD, get, render, type Page } from "./pages";
import { type Doc, htmlToDoc } from "./html";

export type SitePage = { url: string; fetchedAt: string; doc: Doc; rendered: boolean };
export type Site = { start: string; ok: boolean; dead: boolean; error?: string; pages: SitePage[] };

const KEYWORDS: [RegExp, number][] = [
  [/impressum|imprint|legal|rechtlich/i, 10],
  [/öffnungszeit|oeffnungszeit|opening|hours|zeiten/i, 9],
  [/kontakt|contact|anfahrt|standort|location|find.?us|visit|besuch|filiale|cafés?$|cafes?\b|stores?\b/i, 8],
  [/speisekarte|speisen|essen|food|menu|menü|karte|getränke|drinks|kaffee|coffee|angebot|frühstück|breakfast|lunch|mittag/i, 7],
  [/über.?uns|ueber.?uns|about|story|philosoph|wir\b|team/i, 6],
  [/rösterei|roastery|röst|bohnen|beans|shop|produkte|products|zubehör|equipment|sortiment/i, 5],
  [/kurs|course|workshop|seminar|barista|cupping|schulung/i, 4],
];

function pickLinks(doc: Doc, base: URL): string[] {
  const host = base.hostname.replace(/^www\./, "");
  const scored = new Map<string, number>();
  for (const l of doc.links) {
    let u: URL;
    try { u = new URL(l.href); } catch { continue; }
    const pdf = /\.pdf$/i.test(u.pathname);
    // A PDF linked from the site is the site's own document even on a file server (site builders host files elsewhere).
    if (!/^https?:$/.test(u.protocol) || (!pdf && u.hostname.replace(/^www\./, "") !== host)) continue;
    if (pdf && /agb|datenschutz|privacy|terms|widerruf|bewerbung|jobs?\b/i.test(`${decodeURIComponent(u.pathname)} ${l.text}`)) continue;
    if (/\.(jpe?g|png|gif|webp|zip|mp4|svg)$/i.test(u.pathname) || (!pdf && /\/(wp-content)\//i.test(u.pathname)) || /\/(cart|warenkorb|checkout|account|login|tag|category|blog\/page)\//i.test(u.pathname)) continue;
    u.hash = ""; u.search = "";
    const href = u.href;
    if (href === base.href) continue;
    const hay = `${decodeURIComponent(u.pathname)} ${l.text}`;
    // A menu PDF is often linked only through an image (no link text); any other PDF still gets a low score.
    const score = Math.max(pdf ? 3 : 0, ...KEYWORDS.map(([re, s]) => (re.test(hay) ? s : 0)));
    if (score && score > (scored.get(href) ?? 0)) scored.set(href, score);
  }
  // Up to 10 pages, at most 3 of them PDFs.
  const ranked = [...scored.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h);
  const pdfs = ranked.filter((h) => /\.pdf$/i.test(new URL(h).pathname)).slice(0, 3);
  return [...ranked.filter((h) => !/\.pdf$/i.test(new URL(h).pathname)).slice(0, 10 - pdfs.length), ...pdfs];
}

const MENU = /speisekarte|karte|menu|menü|getränke|drinks|kaffee|coffee|frühstück|breakfast|preis|price/i;
const NOT_MENU = /logo|icon|favicon|avatar|banner|sprite|\.svg$/i;
/** Up to 4 menu photos: images named as a menu, or on a menu page. Any host (site builders serve media from a CDN). */
export function pickImages(pages: SitePage[]): string[] {
  const named: string[] = [], onMenuPage: string[] = [];
  for (const p of pages) for (const i of p.doc.images ?? []) {
    if (!/^https?:/.test(i.href) || NOT_MENU.test(i.href) || named.includes(i.href) || onMenuPage.includes(i.href)) continue;
    if (MENU.test(`${i.href.split("/").pop()} ${i.text}`)) named.push(i.href);
    else if (MENU.test(new URL(p.url).pathname)) onMenuPage.push(i.href);
  }
  return [...named, ...onMenuPage].slice(0, 4);
}

const toSitePage = (p: Page): SitePage => ({ url: p.finalUrl, fetchedAt: p.fetchedAt, doc: htmlToDoc(p.html, p.finalUrl), rendered: !!p.rendered });
const thin = (d: Doc) => d.text.length < 400;

async function fetchPage(url: string): Promise<SitePage | null> {
  const p = await get(url);
  if (p.status < 200 || p.status >= 300 || !p.html) return null;
  let sp = toSitePage(p);
  if (thin(sp.doc)) {
    const r = await render(url);
    if (r.html) { const rp = toSitePage(r); if (rp.doc.text.length > sp.doc.text.length) sp = rp; }
  }
  return sp;
}

export async function fetchSite(start: string): Promise<Site> {
  const first = await get(start);
  if (first.error === "site rules disallow") return { start, ok: false, dead: false, error: first.error, pages: [] };
  let home: SitePage | null;
  if (!first.html || first.status >= 400 || first.status === 0) {
    // Retry once rendered before calling a site dead: some hosts block plain clients but serve browsers.
    const r = first.status === 403 || (first.status === 0 && !DEAD.test(first.error ?? "") && !/site rules/.test(first.error ?? "")) ? await render(start) : null;
    if (!r?.html || r.status >= 400) return { start, ok: false, dead: first.status === 404 || first.status === 410 || DEAD.test(first.error ?? ""), error: first.error ?? `HTTP ${first.status}`, pages: [] };
    home = toSitePage(r);
  } else home = await fetchPage(start);
  if (!home) return { start, ok: false, dead: false, error: "no content", pages: [] };
  const pages = [home];
  for (const href of pickLinks(home.doc, new URL(home.url))) {
    const sp = await fetchPage(href);
    if (sp && sp.doc.text.length > 50) pages.push(sp);
  }
  for (const src of pickImages(pages)) {
    const p = await get(src);
    if (p.status >= 200 && p.status < 300 && p.html) pages.push(toSitePage(p));
  }
  return { start, ok: true, dead: false, pages };
}
