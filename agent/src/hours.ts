import OpeningHours from "opening_hours";
import { norm } from "./evidence";

const NOMINATIM = { lat: 48.14, lon: 11.58, address: { country_code: "de", state: "" } }; // only selects public holidays

/** Clean an LLM-written OSM opening_hours string; returns the library's canonical form, or null if it does not parse. */
export function normaliseHours(raw: string, country = "de"): string | null {
  let s = raw.trim()
    .replace(/[‐-―−]/g, "-")
    .replace(/\s*-\s*/g, "-")
    .replace(/\b(\d{1,2})[.h](\d{2})\b/g, "$1:$2")
    .replace(/\b(\d):(\d{2})\b/g, "0$1:$2")
    .replace(/([A-Za-z]{2}):\s+(?=\d)/g, "$1 ")
    .replace(/\s*;\s*/g, "; ").replace(/;\s*$/, "").replace(/\s+/g, " ")
    .replace(/-00:00\b/g, "-24:00"); // closing at midnight is written 24:00
  if (s.length < 2 || /\b(unknown|n\/a|null)\b/i.test(s)) return null;
  try {
    const oh = new OpeningHours(s, { ...NOMINATIM, address: { country_code: country, state: "" } });
    const pretty = oh.prettifyValue();
    new OpeningHours(pretty, { ...NOMINATIM, address: { country_code: country, state: "" } });
    return pretty.length <= 255 ? pretty : null;
  } catch { return null; }
}

/** Every clock time in the value must appear in the quoted text (8:00, 08.00, 8 Uhr, 8-18, 6 pm). */
export function timesInQuote(value: string, quote: string): boolean {
  const q = norm(quote);
  const times = [...value.matchAll(/(\d{2}):(\d{2})/g)];
  if (!times.length) return /\b(24\/7|off|closed)\b/i.test(value) ? true : false;
  return times.every(([, hh, mm]) => {
    const h = +hh;
    const hs = [String(h), hh, ...(h === 24 ? ["0", "00"] : []), ...(h === 0 ? ["24"] : [])];
    const alts = hs.flatMap((x) => [`${x}:${mm}`, `${x}.${mm}`, ...(mm === "00" ? [`${x}`] : [])]);
    if (h > 12 && h < 24) alts.push(`${h - 12}${mm === "00" ? "" : `:${mm}`} ?pm`);
    if (h === 12) alts.push(`12${mm === "00" ? "" : `:${mm}`} ?pm`);
    return alts.some((a) => new RegExp(`(^|[^\\d:.])${a.replace(/\./g, "\\.")}(?![\\d]|[:.]\\d)`).test(q));
  });
}

/** Whether the place is open at any time on a Sunday in a normal week. */
export function opensOnSunday(value: string): boolean {
  const oh = new OpeningHours(value, NOMINATIM);
  const from = new Date("2026-03-01T00:00:00"), to = new Date("2026-03-02T00:00:00"); // a Sunday that is not a holiday
  return oh.getOpenIntervals(from, to).length > 0;
}
