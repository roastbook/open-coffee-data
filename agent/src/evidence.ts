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
  return norm(pageText).indexOf(q);
}

export const quoteOccurs = (pageText: string, quote: string) => findQuote(pageText, quote) >= 0;
