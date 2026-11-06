// Deterministic tier rules over verified facts only (see the schema's tier description).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fold, tokens } from "./names";

const cfg = JSON.parse(readFileSync(join(import.meta.dir, "../config/classify.json"), "utf8"));
const has = (list: string[], s: string) => { const f = ` ${fold(s)} `; return list.some((w) => f.includes(` ${fold(w)} `)); };
export const isChain = (name: string, brand?: string | null) => has(cfg.chains, name) || (!!brand && has(cfg.chains, brand));
export const isCommodity = (roaster: string) => has(cfg.commodity_roasters, roaster);
export const nonCoffeeName = (name: string) => has(cfg.non_coffee_name, name);

export type TierInput = {
  name: string; brand?: string | null; overtureCategory?: string | null;
  roastsOwn?: boolean; specialtyClaim?: boolean; filter?: boolean;
  /** Roasteries the place's own website names. */
  roasters: { name: string }[];
  business?: string; focus?: string; siteVerified: boolean;
  /** Evidence the place serves visitors: opening hours, a serving fact, a café on a roaster's list, or the site says it is a café. */
  servesPublic: boolean;
  /** status open: confirmed on the place's own site in this run. */
  open: boolean;
};

export function tier(t: TierInput): { tier: "A" | "B" | "none" | "unknown"; why: string } {
  const own = fold(t.name);
  const named = t.roasters.filter((r) => !isCommodity(r.name) && (tokens(r.name).length === 0 || fold(r.name) !== own || t.roastsOwn));
  // A roaster named on the place's own site counts with a specialty claim on that site.
  const specialtyRoaster = named.length > 0 && !!t.specialtyClaim;
  const roastsSpecialty = !!t.roastsOwn && !!t.specialtyClaim;
  const specialty = specialtyRoaster || roastsSpecialty;
  const foodLeads = t.focus === "food_led" || t.focus === "balanced" || ["restaurant", "bakery", "bar", "hotel", "ice_cream", "shop"].includes(t.business ?? "");
  const coffeeCore = !foodLeads && (t.focus === "coffee_led" || t.business === "roastery" || t.business === "cafe" && (t.filter || t.roastsOwn) || ["coffee_shop", "coffee_roastery"].includes(t.overtureCategory ?? ""));
  if (isChain(t.name, t.brand)) return { tier: "none", why: "chain" };
  if (specialty && !t.open) return { tier: "unknown", why: "specialty evidence, but not confirmed open in this run" };
  if (specialty && !t.servesPublic) return { tier: "unknown", why: "specialty roaster or supplier, but no evidence it serves visitors" };
  if (specialty && coffeeCore) return { tier: "A", why: roastsSpecialty ? "roasts own specialty coffee, coffee-led" : "serves a named specialty roaster, coffee-led" };
  if (specialty) return { tier: "B", why: roastsSpecialty ? "roasts specialty coffee, but coffee is not shown to lead" : "serves a named specialty roaster, but coffee is not shown to lead" };
  if (t.roasters.length && t.roasters.every((r) => isCommodity(r.name))) return { tier: "none", why: "serves a commodity brand" };
  if (["restaurant", "bakery", "bar", "hotel", "ice_cream", "shop"].includes(t.business ?? "") && t.siteVerified) return { tier: "none", why: `site shows a ${t.business}` };
  if (nonCoffeeName(t.name)) return { tier: "none", why: "name shows a non-coffee business" };
  return { tier: "unknown", why: "no specialty evidence" };
}
