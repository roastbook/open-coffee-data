// Filter state, its URL-hash form and the place predicate. Shared by the map and the table so
// both always show the same places. Plain TypeScript (erasable syntax only) so node --test can run it.

export interface Filters {
  q: string;
  city: string;
  tier: string[];
  status: string[];
  serving: string[];
  amenities: string[];
  roasts: boolean;
  equipment: boolean;
  inview: boolean;
}

export interface HashState { filters: Filters; place: string | null; view: "map" | "table" }

export const emptyFilters = (): Filters => ({ q: "", city: "", tier: [], status: [], serving: [], amenities: [], roasts: false, equipment: false, inview: false });

const LISTS = ["tier", "status", "serving", "amenities"] as const;
const FLAGS = ["roasts", "equipment", "inview"] as const;

export function parseHash(hash: string): HashState {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const f = emptyFilters();
  f.q = p.get("q") ?? "";
  f.city = p.get("city") ?? "";
  for (const k of LISTS) f[k] = (p.get(k) ?? "").split(",").filter(Boolean);
  for (const k of FLAGS) f[k] = p.get(k) === "1";
  return { filters: f, place: p.get("place") || null, view: p.get("view") === "table" ? "table" : "map" };
}

export function toHash({ filters: f, place, view }: HashState): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.city) p.set("city", f.city);
  for (const k of LISTS) if (f[k].length) p.set(k, f[k].join(","));
  for (const k of FLAGS) if (f[k]) p.set(k, "1");
  if (view === "table") p.set("view", "table");
  if (place) p.set("place", place);
  return p.toString().replaceAll("%2C", ",");
}

export const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Text the search box looks at. */
export const searchText = (p: any) =>
  fold([p.name, p.address?.street_address, p.address?.postal_code, p.address?.locality, p.operator?.name, ...(p.roasters_served ?? []).map((r: any) => r.name)].filter(Boolean).join(" "));

export interface Bounds { west: number; south: number; east: number; north: number }

export function matches(p: any, f: Filters, bounds: Bounds | null = null): boolean {
  if (f.city && p._city !== f.city) return false;
  if (f.tier.length && !f.tier.includes(p.specialty_tier)) return false;
  if (f.status.length && !f.status.includes(p.status)) return false;
  if (f.roasts && p.roasts_own_beans !== true) return false;
  if (f.equipment && p.sells_equipment !== true) return false;
  if (f.serving.some((k) => p.serving?.[k] !== true)) return false;
  if (f.amenities.some((k) => p.amenities?.[k] !== true)) return false;
  if (f.q) {
    const text = (p._search ??= searchText(p));
    if (!fold(f.q).split(/\s+/).filter(Boolean).every((w) => text.includes(w))) return false;
  }
  if (f.inview && bounds) {
    const { lat, lon } = p.location;
    if (lat < bounds.south || lat > bounds.north || lon < bounds.west || lon > bounds.east) return false;
  }
  return true;
}

export const activeCount = (f: Filters) =>
  (f.q ? 1 : 0) + (f.city ? 1 : 0) + LISTS.reduce((n, k) => n + f[k].length, 0) + FLAGS.filter((k) => f[k]).length;
