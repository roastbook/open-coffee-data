import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATASETS, SCHEMA_URL } from "./config";
import type { City } from "./cities";

export const cityFile = (c: City) => join(DATASETS, c.country.toLowerCase(), `${c.slug}.json`);

export function readCity(c: City): { $schema: string; meta: any; places: any[] } {
  const f = cityFile(c);
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  return { $schema: SCHEMA_URL, meta: {}, places: [] };
}

// Stable key order inside a record, so diffs stay small.
const ORDER = ["id", "type", "name", "status", "merged_into", "opened_on", "closed_on", "checked_at", "address", "location", "opening_hours", "open_sunday", "description", "specialty_tier", "roasts_own_beans", "roasters_served", "serving", "amenities", "food", "sells_beans", "sells_equipment", "offers_courses", "reusable_cup_systems", "good_for", "awards", "prices", "operator", "links", "image", "xref", "external_ratings"];
export function orderRecord(r: any) {
  const out: any = {};
  for (const k of ORDER) if (r[k] !== undefined) out[k] = r[k];
  for (const k of Object.keys(r)) if (!(k in out) && r[k] !== undefined) out[k] = r[k];
  return out;
}

// The schema version lives only in $schema and the dataset version only in the release tag, so meta carries neither.
export function writeCity(c: City, doc: { places: any[] }) {
  const f = cityFile(c);
  mkdirSync(join(f, ".."), { recursive: true });
  const meta = { licence: "CDLA-Permissive-2.0", country_code: c.country, city: c.slug, city_name: c.name };
  // Every place is a schema.org CafeOrCoffeeShop (schema v0.3.0); last_verified_at and open_sunday are not written.
  const places = [...doc.places].sort((a, b) => (a.id < b.id ? -1 : 1)).map(({ last_verified_at, open_sunday, ...p }) => orderRecord({ ...p, type: "CafeOrCoffeeShop" }));
  writeFileSync(f, JSON.stringify({ $schema: SCHEMA_URL, meta, places }, null, 2) + "\n");
  return f;
}
