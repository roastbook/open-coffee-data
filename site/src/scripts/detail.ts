import { fieldUrl } from "@roastbook/ui/sites";
import { LABELS, STATUS_LABEL, TIER_LABEL } from "./fields";
import { isObject, type ExplorerPlace } from "./place";

const tierLabels = new Map(Object.entries(TIER_LABEL));
const statusLabels = new Map(Object.entries(STATUS_LABEL));
const fieldLabels = new Map(Object.entries(LABELS));

export const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const yesNo = (value: unknown) => value === true ? "Yes" : value === false ? "No" : "—";

/** Attribute escaping does not make a javascript: URL safe. */
export function httpUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? value : "";
  } catch { return ""; }
}

function referenceLink(url: unknown, label: unknown): string {
  const href = httpUrl(url);
  return href ? `<a href="${esc(href)}" rel="nofollow noopener">${esc(label)}</a>` : esc(label);
}

function arrayItem(path: string, value: unknown): string {
  if (!isObject(value)) return esc(String(value).replaceAll("_", " "));
  switch (path) {
    case "roasters_served": return `${referenceLink(value.url, value.name)}${value.own ? " (own roastery)" : ""}`;
    case "awards": return `${referenceLink(value.url, value.name)}${value.year ? ` ${esc(value.year)}` : ""}`;
    case "external_ratings": return `${referenceLink(value.url, value.source)} <span class="muted">(reference only; we store no rating values)</span>`;
    default: return esc(JSON.stringify(value));
  }
}

function cappuccinoPrice(value: Record<string, unknown>): string {
  if (typeof value.amount !== "number") return esc(JSON.stringify(value));
  return `${esc(value.amount.toFixed(2))} ${esc(value.currency)} <span class="muted">(observed ${esc(value.observed_on)}${value.source_url ? `, ${referenceLink(value.source_url, "menu")}` : ""})</span>`;
}

function operatorName(value: Record<string, unknown>): string {
  const legalForm = typeof value.legal_form === "string" && typeof value.name === "string" && !value.name.includes(value.legal_form) ? value.legal_form : "";
  return esc([value.name, legalForm, value.register_id].filter(Boolean).join(", "));
}

function formatText(path: string, value: string): string {
  switch (path) {
    case "specialty_tier": return esc(tierLabels.get(value) ?? value);
    case "status": return esc(statusLabels.get(value) ?? value);
    case "xref.wikidata": return `<a href="https://www.wikidata.org/wiki/${esc(encodeURIComponent(value))}">${esc(value)}</a>`;
    default: return /^https?:\/\//.test(value) ? referenceLink(value, value.replace(/^https?:\/\/(www\.)?/, "")) : objectOrText(path, value);
  }
}

export function formatValue(path: string, value: unknown): string {
  if (typeof value === "boolean") return yesNo(value);
  if (typeof value === "string") return formatText(path, value);
  if (Array.isArray(value)) return `<ul class="plain">${value.map((item: unknown) => `<li>${arrayItem(path, item)}</li>`).join("")}</ul>`;
  return objectOrText(path, value);
}

function objectOrText(path: string, value: unknown): string {
  if (isObject(value)) {
    if (path === "location") return `${esc(value.lat)}, ${esc(value.lon)}`;
    if (path === "prices.cappuccino") return cappuccinoPrice(value);
    if (path === "operator") return operatorName(value);
  }
  return esc(typeof value === "string" ? value.replaceAll("_", " ").replace(/^(coffee|food) led$/, "$1-led") : value);
}

const SKIP = new Set(["id", "name", "image", "checked_at", "last_verified_at"]);

function detailRow(path: string, value: unknown): string {
  const label = fieldLabels.get(path) ?? (path.split(".").pop() ?? path).replaceAll("_", " ");
  return `<div class="kv"><dt><a href="${esc(fieldUrl(path))}" title="Definition of ${esc(path)} in the Schema Explorer">${esc(label)}</a></dt><dd>${formatValue(path, value)}</dd></div>`;
}

export function detailRows(place: ExplorerPlace): string {
  return Object.entries(place).flatMap(([key, value]) => {
    if (key.startsWith("_") || SKIP.has(key) || value === undefined) return [];
    if (isObject(value) && key !== "location" && key !== "operator") {
      return Object.entries(value).map(([childKey, childValue]) => detailRow(`${key}.${childKey}`, childValue));
    }
    return [detailRow(key, value)];
  }).join("");
}
