// The evidence check: a value proposed by the LLM is kept only if its quoted snippet really occurs in the page text we fetched.

/** Normalise for comparison: Unicode NFKC, lower case, unify dashes, quotes and whitespace, drop soft hyphens and zero-width chars. */
export function norm(s: string): string {
  return s.normalize("NFKC").toLowerCase()
    .replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, "")
    .replace(/[‐-―−]/g, "-")
    .replace(/[‘’‚‛′`´]/g, "'")
    .replace(/[“-‟″«»]/g, '"')
    .replace(/…/g, "...")
    .replace(/\s+/g, " ").trim();
}

/** Position of the quote in the page text, or -1. Quotes shorter than 3 characters never count. */
export function findQuote(pageText: string, quote: string): number {
  const q = norm(quote);
  if (q.length < 3) return -1;
  const t = norm(pageText);
  const at = t.indexOf(q);
  if (at >= 0 || q.length < 12) return at;
  // Models join lines ("geöffnet.Auch" for "geöffnet.\nAuch"): compare without any whitespace, map back to the position.
  const pos: number[] = [];
  let compact = "";
  for (let i = 0; i < t.length; i++) if (t[i] !== " ") { compact += t[i]; pos.push(i); }
  const c = compact.indexOf(q.replace(/ /g, ""));
  return c < 0 ? -1 : pos[c];
}

export const quoteOccurs = (pageText: string, quote: string) => findQuote(pageText, quote) >= 0;
