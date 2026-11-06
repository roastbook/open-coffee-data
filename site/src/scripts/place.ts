/** Fields consumed by the Explorer. Dataset validation remains the authoritative schema check. */
export interface SearchablePlace {
  name: string;
  address?: { street_address?: string; postal_code?: string; locality?: string };
  operator?: { name: string; legal_form?: string; register_id?: string };
  roasters_served?: { name: string; url?: string; own?: boolean }[];
}

export interface FilterPlace extends SearchablePlace {
  _city?: string;
  _search?: string;
  specialty_tier: string;
  status: string;
  roasts_own_beans?: boolean;
  sells_equipment?: boolean;
  serving?: Partial<Record<"espresso" | "filter" | "pour_over" | "batch_brew" | "cold_brew" | "decaf" | "plant_milk", boolean>>;
  amenities?: Partial<Record<"wifi" | "laptop_friendly" | "kids_friendly" | "vegan_options" | "dogs_allowed" | "outdoor_seating" | "card_payment" | "cash_only" | "wheelchair_accessible", boolean>>;
  location: { lat: number; lon: number };
}

export interface ExplorerPlace extends FilterPlace {
  id: string;
  _city_name: string;
  _file: string;
  checked_at?: string;
  last_verified_at?: string;
  image?: {
    url: string; title?: string; author: string; licence: string; source_url: string;
    width?: number; height?: number;
  };
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const optionalStrings = (value: Record<string, unknown>, keys: string[]) => {
  const fields = new Map(Object.entries(value));
  return keys.every((key) => fields.get(key) === undefined || typeof fields.get(key) === "string");
};
const optionalBooleans = (value: unknown) => value === undefined ||
  (isObject(value) && Object.values(value).every((v) => typeof v === "boolean"));

function isAddress(value: unknown): boolean {
  return value === undefined || (isObject(value) && optionalStrings(value, ["street_address", "postal_code", "locality"]));
}

function isOperator(value: unknown): boolean {
  return value === undefined || (isObject(value) && typeof value.name === "string" && optionalStrings(value, ["legal_form", "register_id"]));
}

function isRoaster(value: unknown): boolean {
  return isObject(value) && typeof value.name === "string" && optionalStrings(value, ["url"]) &&
    (value.own === undefined || typeof value.own === "boolean");
}

function isSearchablePlace(value: Record<string, unknown>): boolean {
  return isAddress(value.address) && isOperator(value.operator) &&
    (value.roasters_served === undefined || (Array.isArray(value.roasters_served) && value.roasters_served.every(isRoaster)));
}

function isImage(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isObject(value)) return false;
  return [value.url, value.author, value.licence, value.source_url].every((v) => typeof v === "string") &&
    optionalStrings(value, ["title"]) &&
    [value.width, value.height].every((v) => v === undefined || (typeof v === "number" && Number.isFinite(v)));
}

function isExplorerPlace(value: unknown): value is ExplorerPlace {
  if (!isObject(value) || !isObject(value.location)) return false;
  const strings = [value.id, value.name, value.status, value.specialty_tier, value._city_name, value._file];
  return strings.every((v) => typeof v === "string") &&
    [value.location.lat, value.location.lon].every((v) => typeof v === "number" && Number.isFinite(v)) &&
    optionalStrings(value, ["_city", "_search", "checked_at", "last_verified_at"]) &&
    [value.roasts_own_beans, value.sells_equipment].every((v) => v === undefined || typeof v === "boolean") &&
    optionalBooleans(value.serving) && optionalBooleans(value.amenities) && isSearchablePlace(value) && isImage(value.image);
}

export function parsePlacesPayload(value: unknown): ExplorerPlace[] {
  if (!isObject(value) || !Array.isArray(value.places) || !value.places.every(isExplorerPlace)) {
    throw new Error("Invalid Explorer places payload");
  }
  return value.places;
}
