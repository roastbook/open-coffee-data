import { payloadParser } from "./payload";
export type Ring = [number, number][];
export type Polygon = Ring[]; // outer ring first, then holes
export interface LatLon { lat: number; lon: number }

export function distanceM(a: LatLon, b: LatLon): number {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function inRing(ring: Ring, lon: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function inPolygons(polys: Polygon[], p: LatLon): boolean {
  return polys.some(([outer, ...holes]) => inRing(outer, p.lon, p.lat) && !holes.some((h) => inRing(h, p.lon, p.lat)));
}

export function bbox(polys: Polygon[]) {
  let xmin = 180, ymin = 90, xmax = -180, ymax = -90;
  for (const poly of polys) for (const [x, y] of poly[0]) {
    xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
  }
  return { xmin, ymin, xmax, ymax };
}

const position = { type: "array", items: { type: "number" }, minItems: 2 };
const ring = { type: "array", items: position };
const polygon = { type: "array", items: ring };
const polygons = payloadParser<Polygon[]>({ type: "array", items: polygon });
interface Geometry {
  type: string;
  features?: unknown[];
  geometry?: unknown;
  coordinates?: unknown;
}
const geometry = payloadParser<Geometry>({ type: "object", required: ["type"], properties: { type: { type: "string" }, features: { type: "array" } } });

/** GeoJSON Polygon/MultiPolygon geometry (or Feature/FeatureCollection) to a list of polygons. */
export function toPolygons(value: unknown): Polygon[] {
  if (!value) return [];
  const g = geometry(value);
  switch (g.type) {
    case "FeatureCollection": return (g.features ?? []).flatMap(toPolygons);
    case "Feature": return toPolygons(g.geometry);
    case "Polygon": return polygons([g.coordinates]);
    case "MultiPolygon": return polygons(g.coordinates);
    default: return [];
  }
}
