import { Ajv } from "ajv";
import type { LatLon } from "./geo";
import type { Image } from "./images";

export interface Address {
  country_code?: string; locality?: string; street_address?: string; postal_code?: string;
}
export interface Serving {
  espresso?: boolean; filter?: boolean; pour_over?: boolean; batch_brew?: boolean;
  cold_brew?: boolean; decaf?: boolean; plant_milk?: boolean;
}
export interface Amenities {
  wifi?: boolean; laptop_friendly?: boolean; kids_friendly?: boolean; vegan_options?: boolean;
  dogs_allowed?: boolean; outdoor_seating?: boolean; card_payment?: boolean; cash_only?: boolean;
  wheelchair_accessible?: boolean;
}
export interface Food {
  focus?: string; breakfast?: boolean; lunch?: boolean; cakes_baked_in_house?: boolean;
}
export interface Links { website?: string; instagram?: string; facebook?: string }
export interface Roaster { name: string; own?: boolean; url?: string }
export interface CoffeeRecord {
  id: string; name: string; location: LatLon; status: string; checked_at: string;
  type?: string; merged_into?: string; opened_on?: string; closed_on?: string;
  address?: Address; opening_hours?: string; open_sunday?: boolean; last_verified_at?: string;
  description?: string; specialty_tier?: "A" | "B" | "none" | "unknown";
  roasts_own_beans?: boolean; roasters_served?: Roaster[]; serving?: Serving; amenities?: Amenities; food?: Food;
  sells_beans?: boolean; sells_equipment?: boolean; offers_courses?: boolean;
  reusable_cup_systems?: string[]; good_for?: string[];
  awards?: { name: string; year?: number; url?: string }[];
  prices?: { cappuccino?: { amount: number; currency: string; observed_on: string; source_url?: string } };
  operator?: { name: string; legal_form?: string; register_id?: string };
  links?: Links; image?: Image;
  xref?: { overture?: string; wikidata?: string; google_place_id?: string };
  external_ratings?: { source: string; id?: string; url: string }[];
}
export interface CityDocument {
  $schema: string;
  meta: { licence?: string; country_code?: string; city?: string; city_name?: string };
  places: CoffeeRecord[];
}

// This boundary accepts legacy fields for repair. Full schema validation remains scripts/validate.sh's job.
const str = { type: "string" };
const bool = { type: "boolean" };
const strings = (names: string[]) => Object.fromEntries(names.map((name) => [name, str]));
const object = (properties: object, required: string[] = []) => ({ type: "object", properties, required });
const flags = (names: string[]) => object(Object.fromEntries(names.map((name) => [name, bool])));
const array = (items: object) => ({ type: "array", items });
const recordSchema = object({
  ...strings(["id", "name", "status", "checked_at", "type", "merged_into", "opened_on", "closed_on", "opening_hours", "last_verified_at", "description"]),
  location: object({ lat: { type: "number" }, lon: { type: "number" } }, ["lat", "lon"]),
  address: object(strings(["country_code", "locality", "street_address", "postal_code"])),
  specialty_tier: { enum: ["A", "B", "none", "unknown"] },
  ...Object.fromEntries(["roasts_own_beans", "sells_beans", "sells_equipment", "offers_courses", "open_sunday"].map((name) => [name, bool])),
  serving: flags(["espresso", "filter", "pour_over", "batch_brew", "cold_brew", "decaf", "plant_milk"]),
  amenities: flags(["wifi", "laptop_friendly", "kids_friendly", "vegan_options", "dogs_allowed", "outdoor_seating", "card_payment", "cash_only", "wheelchair_accessible"]),
  food: object({ focus: str, breakfast: bool, lunch: bool, cakes_baked_in_house: bool }),
  links: object(strings(["website", "instagram", "facebook"])),
  xref: object(strings(["overture", "wikidata", "google_place_id"])),
  roasters_served: array(object({ name: str, own: bool, url: str }, ["name"])),
  reusable_cup_systems: array(str), good_for: array(str),
  operator: object(strings(["name", "legal_form", "register_id"]), ["name"]),
  prices: object({ cappuccino: object({ amount: { type: "number" }, ...strings(["currency", "observed_on", "source_url"]) }, ["amount", "currency", "observed_on"]) }),
  image: object({ ...strings(["url", "licence", "author", "source_url", "title"]), width: { type: "number" }, height: { type: "number" } }, ["url", "licence", "author", "source_url"]),
  awards: array(object({ name: str, year: { type: "number" }, url: str }, ["name"])),
  external_ratings: array(object(strings(["source", "id", "url"]), ["source", "url"])),
}, ["id", "name", "location", "status", "checked_at"]);
interface ParsedDocument { $schema?: string; meta?: CityDocument["meta"]; places: CoffeeRecord[] }
const validate = new Ajv({ strict: false }).compile<ParsedDocument>(object({
  $schema: str, meta: object(strings(["licence", "country_code", "city", "city_name"])), places: array(recordSchema),
}, ["places"]));
export function parseCityDocument(text: string): CityDocument {
  const value: unknown = JSON.parse(text);
  if (!validate(value)) throw new Error(`Invalid coffee dataset: ${JSON.stringify(validate.errors)}`);
  return { ...value, $schema: value.$schema ?? "", meta: value.meta ?? {} };
}
