import { payloadParser } from "./payload";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CACHE, USER_AGENT } from "./config";
import { bbox, inPolygons, type LatLon, type Polygon, toPolygons } from "./geo";

interface BoundaryPayload { type?: string; feature?: unknown; features?: { geometry?: unknown; properties?: Record<string, unknown> }[]; coordinates?: unknown; geometry?: unknown }
const boundaryPayload = payloadParser<BoundaryPayload>({ type: "object", properties: { type: { type: "string" }, features: { type: "array", items: { type: "object", properties: { properties: { type: "object" } } } } } });

export interface City {
  slug: string; name: string; country: string; wikidata?: string;
  boundary: { type: "bkg-vg250"; ags: string } | { type: "swisstopo"; bfs: number } | { type: "geojson"; url: string; property?: string; value?: string } | null;
}

export const cities: City[] = JSON.parse(readFileSync(join(import.meta.dir, "../config/cities.json"), "utf8")).cities;
export const city = (slug: string) => {
  const c = cities.find((x) => x.slug === slug);
  if (!c) throw new Error(`unknown city ${slug}; add it to agent/config/cities.json`);
  return c;
}

function boundaryUrl(c: City): string {
  const b = c.boundary;
  if (!b) throw new Error(`${c.slug}: no open boundary configured in agent/config/cities.json`);
  if (b.type === "bkg-vg250") {
    const filter = `<Filter><PropertyIsEqualTo><ValueReference>ags</ValueReference><Literal>${b.ags}</Literal></PropertyIsEqualTo></Filter>`;
    return `https://sgx.geodatenzentrum.de/wfs_vg250?service=WFS&version=2.0.0&request=GetFeature&typeNames=vg250:vg250_gem&outputFormat=application/json&srsName=EPSG:4326&filter=${encodeURIComponent(filter)}`;
  }
  if (b.type === "swisstopo") return `https://api3.geo.admin.ch/rest/services/api/MapServer/ch.swisstopo.swissboundaries3d-gemeinde-flaeche.fill/${b.bfs}?geometryFormat=geojson&sr=4326`;
  return b.url;
}

/** City limits as polygons (cached). Used only to filter points; never stored in the dataset. */
export async function boundary(c: City): Promise<Polygon[]> {
  const file = join(CACHE, "boundaries", `${c.slug}.json`);
  if (!existsSync(file)) {
    const res = await fetch(boundaryUrl(c), { headers: { "user-agent": USER_AGENT } });
    if (!res.ok) throw new Error(`${c.slug}: boundary HTTP ${res.status}`);
    let g = boundaryPayload(await res.json());
    if (g.feature) g = boundaryPayload(g.feature); // swisstopo
    const b = c.boundary;
    if (!b) throw new Error(`${c.slug}: no boundary configured`);
    if (b.type === "bkg-vg250") g = { type: "FeatureCollection", features: (g.features ?? []).filter((f) => f.properties?.gf === 4 || f.properties?.gf === undefined) };
    if (b.type === "geojson" && b.property) {
      const property = b.property;
      g = { type: "FeatureCollection", features: (g.features ?? []).filter((f) => String(f.properties?.[property]) === b.value) };
    }
    mkdirSync(join(CACHE, "boundaries"), { recursive: true });
    writeFileSync(file, JSON.stringify(g));
  }
  const polys = toPolygons(JSON.parse(readFileSync(file, "utf8")));
  if (!polys.length) throw new Error(`${c.slug}: boundary is empty`);
  return polys;
}

export async function cityArea(c: City) {
  const polys = await boundary(c);
  return { polys, bbox: bbox(polys), contains: (p: LatLon) => inPolygons(polys, p) };
}
