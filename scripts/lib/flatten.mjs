// One flat row per place for CSV, GeoJSON properties and GeoParquet. Column names are the
// dotted field paths of the schema (address.locality, serving.filter) so they match the
// Schema Explorer anchors.
const join = (a) => (a.length ? a.join("; ") : undefined);

export function flattenPlace(p, { city, country_code }) {
  const row = { id: p.id, name: p.name, city, country_code };
  const put = (prefix, v) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) { row[prefix] = join(v.map(String)); return; }
    if (typeof v === "object") { for (const [k, x] of Object.entries(v)) put(`${prefix}.${k}`, x); return; }
    row[prefix] = v;
  };
  for (const [k, v] of Object.entries(p)) {
    if (k.startsWith("_") || k === "id" || k === "name") continue;
    if (k === "location") { row.lat = v.lat; row.lon = v.lon; continue; }
    if (k === "roasters_served") { row.roasters_served = join(v.map((r) => r.name)); continue; }
    if (k === "awards") { row.awards = join(v.map((a) => (a.year ? `${a.name} (${a.year})` : a.name))); continue; }
    if (k === "external_ratings") { row.external_ratings = join(v.map((e) => e.url ?? `${e.source}:${e.id}`)); continue; }
    put(k, v);
  }
  return row;
}

export const csvEscape = (v) => {
  if (v === undefined || v === null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
