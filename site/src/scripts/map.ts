// MapLibre map with clustering and tier markers that differ by colour (Okabe-Ito tokens),
// shape and size: tier A large circle, tier B diamond, other small square.
import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import type { FeatureCollection } from "geojson";
import type { ExplorerPlace } from "./place";
import type { Bounds } from "./filter";

// MapLibre 6 runs its tile worker as an ES module; let Vite bundle it and tell MapLibre where it is.
maplibregl.setWorkerUrl(workerUrl);

// OpenFreeMap: free vector tiles, no API key. Display only; the dataset holds no OSM data.
const STYLE = { light: "https://tiles.openfreemap.org/styles/positron", dark: "https://tiles.openfreemap.org/styles/dark" };
const theme = () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function icon(shape: "circle" | "diamond" | "square", size: number, fill: string, stroke: string) {
  const ratio = 2;
  const c = document.createElement("canvas");
  c.width = c.height = size * ratio;
  const g = c.getContext("2d");
  if (!g) throw new Error("Canvas 2D context is unavailable");
  g.scale(ratio, ratio);
  const m = size / 2;
  const r = m - 2;
  g.beginPath();
  if (shape === "circle") g.arc(m, m, r, 0, Math.PI * 2);
  else if (shape === "diamond") { g.moveTo(m, 1.5); g.lineTo(size - 1.5, m); g.lineTo(m, size - 1.5); g.lineTo(1.5, m); g.closePath(); }
  else g.rect(m - r * 0.8, m - r * 0.8, r * 1.6, r * 1.6);
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = stroke;
  g.stroke();
  return { width: size * ratio, height: size * ratio, data: new Uint8Array(g.getImageData(0, 0, size * ratio, size * ratio).data.buffer) };
}

export interface PlaceMap {
  setData(places: ExplorerPlace[]): void;
  focus(place: ExplorerPlace): void;
  bounds(): Bounds | null;
  resize(): void;
}

export function createMap(el: HTMLElement, places: ExplorerPlace[], onSelect: (id: string) => void, onMove: () => void): PlaceMap {
  let data: FeatureCollection = { type: "FeatureCollection", features: [] };
  const map = new maplibregl.Map({ container: el, style: STYLE[theme()], center: [11.575, 48.137], zoom: 11, attributionControl: { compact: true } });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.addControl(new maplibregl.FullscreenControl(), "top-right");
  if (places.length) {
    const b = new maplibregl.LngLatBounds();
    for (const p of places) b.extend([p.location.lon, p.location.lat]);
    map.fitBounds(b, { padding: 40, duration: 0, maxZoom: 14 });
  }

  const addLayers = () => {
    const stroke = theme() === "dark" ? "#241b17" : "#ffffff";
    const images = { "tier-A": icon("circle", 22, css("--tier-a"), stroke), "tier-B": icon("diamond", 20, css("--tier-b"), stroke), "tier-other": icon("square", 14, css("--tier-other"), stroke) };
    for (const [id, img] of Object.entries(images)) { if (map.hasImage(id)) map.removeImage(id); map.addImage(id, img, { pixelRatio: 2 }); }
    if (map.getSource("places")) return;
    map.addSource("places", { type: "geojson", data, cluster: true, clusterMaxZoom: 14, clusterRadius: 44 });
    map.addLayer({ id: "clusters", type: "circle", source: "places", filter: ["has", "point_count"],
      paint: { "circle-color": css("--coffee"), "circle-stroke-color": stroke, "circle-stroke-width": 2, "circle-radius": ["step", ["get", "point_count"], 14, 10, 18, 50, 24] } });
    map.addLayer({ id: "cluster-count", type: "symbol", source: "places", filter: ["has", "point_count"],
      layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": ["Noto Sans Bold"], "text-size": 13 }, paint: { "text-color": "#ffffff" } });
    map.addLayer({ id: "points", type: "symbol", source: "places", filter: ["!", ["has", "point_count"]],
      layout: {
        "icon-image": ["match", ["get", "tier"], "A", "tier-A", "B", "tier-B", "tier-other"],
        "icon-allow-overlap": true,
        "symbol-sort-key": ["match", ["get", "tier"], "A", 2, "B", 1, 0],
      } });
  };
  map.on("style.load", addLayers);

  map.on("click", "clusters", (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const source = map.getSource("places");
    if (!(source instanceof maplibregl.GeoJSONSource) || f.geometry.type !== "Point") return;
    const [lon, lat] = f.geometry.coordinates;
    if (lon === undefined || lat === undefined || typeof f.properties.cluster_id !== "number") return;
    source.getClusterExpansionZoom(f.properties.cluster_id).then((zoom) => {
      map.easeTo({ center: [lon, lat], zoom });
    }).catch((error: unknown) => { console.error("Could not expand map cluster", error); });
  });
  map.on("click", "points", (e) => { const id = e.features?.[0]?.properties?.id; if (typeof id === "string" && id) onSelect(id); });
  for (const layer of ["clusters", "points"]) {
    map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
  }
  map.on("moveend", onMove);
  new MutationObserver(() => map.setStyle(STYLE[theme()], { diff: false })).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  return {
    setData(list) {
      data = { type: "FeatureCollection", features: list.map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: [p.location.lon, p.location.lat] }, properties: { id: p.id, tier: p.specialty_tier } })) };
      const source = map.getSource("places");
      if (source instanceof maplibregl.GeoJSONSource) source.setData(data);
    },
    focus(p) {
      map.easeTo({ center: [p.location.lon, p.location.lat], zoom: Math.max(map.getZoom(), 15) });
    },
    bounds() {
      const b = map.getBounds();
      return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
    },
    resize: () => map.resize(),
  };
}
