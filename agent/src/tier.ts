// Deterministic tier rules over verified facts only (see the schema's tier description).
import cfg from "../config/classify.json";
import { fold, tokens } from "./names";

const has = (list: string[], s: string) => { const f = ` ${fold(s)} `; return list.some((w) => f.includes(` ${fold(w)} `)); };
export const isChain = (name: string, brand?: string | null) => has(cfg.chains, name) || (!!brand && has(cfg.chains, brand));
export const isCommodity = (roaster: string) => has(cfg.commodity_roasters, roaster);
export const nonCoffeeName = (name: string) => has(cfg.non_coffee_name, name);

export interface TierInput {
  name: string; brand?: string | null; overtureCategory?: string | null;
  roastsOwn?: boolean; specialtyClaim?: boolean; filter?: boolean;
  /** Roasteries the place's own website names. */
  roasters: { name: string }[];
  business?: string; focus?: string; siteVerified: boolean;
  /** Evidence the place serves visitors: opening hours, a serving fact, a café on a roaster's list, or the site says it is a café. */
  servesPublic: boolean;
  /** status open: confirmed on the place's own site in this run. */
  open: boolean;
}

interface TierResult { tier: "A" | "B" | "none" | "unknown"; why: string }
const foodBusinesses = ["restaurant", "bakery", "bar", "hotel", "ice_cream", "shop"];
function namedRoasters(t: TierInput) {
  const own = fold(t.name);
  return t.roasters.filter((r) => !isCommodity(r.name) && (tokens(r.name).length === 0 || fold(r.name) !== own || t.roastsOwn));
}
function coffeeCore(t: TierInput) {
  if (foodLeads(t)) return false;
  if (["coffee_shop", "coffee_roastery"].includes(t.overtureCategory ?? "")) return true;
  if (coffeeIdentity(t)) return true;
  return t.business === "cafe" && !!(t.filter || t.roastsOwn);
}
function specialtyTier(t: TierInput, roastsSpecialty: boolean): TierResult {
  if (!t.open) return { tier: "unknown", why: "specialty evidence, but not confirmed open in this run" };
  if (!t.servesPublic) return { tier: "unknown", why: "specialty roaster or supplier, but no evidence it serves visitors" };
  if (coffeeCore(t)) return { tier: "A", why: roastsSpecialty ? "roasts own specialty coffee, coffee-led" : "serves a named specialty roaster, coffee-led" };
  return { tier: "B", why: roastsSpecialty ? "roasts specialty coffee, but coffee is not shown to lead" : "serves a named specialty roaster, but coffee is not shown to lead" };
}
function ordinaryTier(t: TierInput): TierResult {
  if (t.roasters.length && t.roasters.every((r) => isCommodity(r.name))) return { tier: "none", why: "serves a commodity brand" };
  // A site that claims specialty coffee without naming a roaster is not "none": the evidence is incomplete, not negative.
  if (foodBusinesses.includes(t.business ?? "") && t.siteVerified && !t.specialtyClaim) return { tier: "none", why: `site shows a ${t.business}` };
  if (nonCoffeeName(t.name)) return { tier: "none", why: "name shows a non-coffee business" };
  return { tier: "unknown", why: "no specialty evidence" };
}
export function tier(t: TierInput): TierResult {
  if (isChain(t.name, t.brand)) return { tier: "none", why: "chain" };
  const roastsSpecialty = !!t.roastsOwn && !!t.specialtyClaim;
  const specialtyRoaster = namedRoasters(t).length > 0 && !!t.specialtyClaim;
  return specialtyRoaster || roastsSpecialty ? specialtyTier(t, roastsSpecialty) : ordinaryTier(t);
}

const coffeeIdentity = (t: TierInput) => t.focus === "coffee_led" || t.business === "roastery";

function foodLeads(t: TierInput): boolean {
  return ["food_led", "balanced"].includes(t.focus ?? "") || foodBusinesses.includes(t.business ?? "");
}
