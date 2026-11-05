// Fetch a place's own website: the homepage plus up to 7 linked pages that usually carry facts (at most 2 of them menu PDFs).
import { DEAD, get, render, type Page } from "./pages";
import { type Doc, htmlToDoc } from "./html";

export type SitePage = { url: string; fetchedAt: string; doc: Doc; rendered: boolean };
export type Site = { start: string; ok: boolean; dead: boolean; error?: string; pages: SitePage[] };

const KEYWORDS: [RegExp, number][] = [
  [/impressum|imprint|legal|rechtlich/i, 10],
  [/öffnungszeit|oeffnungszeit|opening|hours|zeiten/i, 9],
  [/kontakt|contact|anfahrt|standort|location|find.?us|visit|besuch|filiale|cafés?$|cafes?\b|stores?\b/i, 8],
  [/speisekarte|menu|menü|karte|getränke|drinks|kaffee|coffee|angebot/i, 7],
  [/über.?uns|ueber.?uns|about|story|philosoph|wir\b|team/i, 6],
  [/rösterei|roastery|röst|bohnen|beans|shop/i, 5],
  [/kurs|course|workshop|seminar|barista|cupping|schulung/i, 4],
];

function pickLinks(doc: Doc, base: URL): string[] {
  const host = base.hostname.replace(/^www\./, "");
  const scored = new Map<string, number>();
  for (const l of doc.links) {
    let u: URL;
    try { u = new URL(l.href); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, "") !== host) continue;
    const pdf = /\.pdf$/i.test(u.pathname);
    if (pdf && !/karte|menu|menü|speise|getränk|drink|kaffee|coffee|preis|fr(ü|ue)hst|lunch|mittag/i.test(`${decodeURIComponent(u.pathname)} ${l.text}`)) continue;
    if (/\.(jpe?g|png|gif|webp|zip|mp4|svg)$/i.test(u.pathname) || (!pdf && /\/(wp-content)\//i.test(u.pathname)) || /\/(cart|warenkorb|checkout|account|login|tag|category|blog\/page)\//i.test(u.pathname)) continue;
    u.hash = ""; u.search = "";
    const href = u.href;
    if (href === base.href) continue;
    const hay = `${decodeURIComponent(u.pathname)} ${l.text}`;
    const score = Math.max(0, ...KEYWORDS.map(([re, s]) => (re.test(hay) ? s : 0)));
    if (score && score > (scored.get(href) ?? 0)) scored.set(href, score);
  }
  // Up to 6 HTML pages plus up to 2 menu PDFs.
  const ranked = [...scored.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h);
  const pdfs = ranked.filter((h) => /\.pdf$/i.test(new URL(h).pathname)).slice(0, 2);
  return [...ranked.filter((h) => !/\.pdf$/i.test(new URL(h).pathname)).slice(0, 7 - pdfs.length), ...pdfs];
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
  return { start, ok: true, dead: false, pages };
}
