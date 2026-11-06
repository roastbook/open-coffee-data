#!/usr/bin/env bun
// Compiles download artifacts from datasets/ into <out>/ (CONTRACT "URLs"):
//   coffee-places/<cc>/<city>.ndjson   one full record per line
//   coffee-places/<cc>/<city>.geojson  Point features, flat properties
//   coffee-places.geoparquet           all places, GeoParquet 1.x via DuckDB spatial
//   coffee-places.csv                  all places, flat columns
//   index.json                         manifest: dataset version (release tag), schema version per family
//                                      (from $schema), build time, sizes and record counts (all families)
// Usage: bun scripts/build-artifacts.mjs <out> ; env DATASETS_DIR overrides datasets/.
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";
import { coffeePlaces, datasetVersion, loadDatasets, schemaVersions } from "./lib/datasets.mjs";
import { csvEscape, flattenPlace } from "./lib/flatten.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(process.argv[2] ?? join(root, ".cache/artifacts"));
const datasetsDir = resolve(process.env.DATASETS_DIR ?? join(root, "datasets"));
const DATA = "https://data.roastbook.coffee/";

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const files = loadDatasets(datasetsDir);
const artifacts = [];
const write = (rel, text, extra) => {
  const p = join(out, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
  artifacts.push({ path: `artifacts/${rel}`, url: `${DATA}artifacts/${rel}`, bytes: statSync(p).size, ...extra });
};

for (const f of files.filter((x) => x.family === "coffee-places")) {
  const { country_code: cc, city } = f.doc.meta;
  const base = `coffee-places/${cc.toLowerCase()}/${city}`;
  const ctx = { city, country_code: cc };
  write(`${base}.ndjson`, f.records.map((r) => JSON.stringify(r)).join("\n") + (f.records.length ? "\n" : ""), { format: "ndjson", family: "coffee-places", city, country_code: cc, records: f.records.length });
  const geojson = {
    type: "FeatureCollection",
    features: f.records.map((r) => ({ type: "Feature", id: r.id, geometry: { type: "Point", coordinates: [r.location.lon, r.location.lat] }, properties: flattenPlace(r, ctx) })),
  };
  write(`${base}.geojson`, JSON.stringify(geojson), { format: "geojson", family: "coffee-places", city, country_code: cc, records: f.records.length });
}

const all = coffeePlaces(files);
const rows = all.map((p) => flattenPlace(p, { city: p._city, country_code: p._country_code }));
const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
const types = Object.fromEntries(columns.map((c) => {
  const seen = new Set(rows.map((r) => r[c]).filter((v) => v !== undefined && v !== null).map((v) => typeof v));
  return [c, seen.size === 1 && seen.has("boolean") ? "BOOLEAN" : seen.size === 1 && seen.has("number") ? "DOUBLE" : "VARCHAR"];
}));
write("coffee-places.csv", [columns.map(csvEscape).join(","), ...rows.map((r) => columns.map((c) => csvEscape(r[c])).join(","))].join("\n") + "\n", { format: "csv", family: "coffee-places", records: rows.length });

if (rows.length) {
  // GeoParquet: DuckDB reads the flat rows with explicit types and writes a WKB point column; COPY adds the "geo" metadata.
  const tmp = join(out, ".rows.ndjson");
  writeFileSync(tmp, rows.map((r) => JSON.stringify(Object.fromEntries(columns.map((c) => [c, r[c] ?? null])))).join("\n") + "\n");
  const db = await DuckDBInstance.create(":memory:");
  const con = await db.connect();
  await con.run("INSTALL spatial; LOAD spatial;");
  const sqlStr = (s) => `'${s.replaceAll("'", "''")}'`;
  const colSpec = `{${columns.map((c) => `${sqlStr(c)}: ${sqlStr(types[c])}`).join(", ")}}`;
  const parquet = join(out, "coffee-places.geoparquet");
  await con.run(`COPY (SELECT *, ST_Point("lon", "lat") AS geometry FROM read_json(${sqlStr(tmp)}, format = 'newline_delimited', columns = ${colSpec}) ORDER BY id) TO ${sqlStr(parquet)} (FORMAT parquet, COMPRESSION zstd)`);
  const geo = (await con.runAndReadAll(`SELECT value::VARCHAR AS v FROM parquet_kv_metadata(${sqlStr(parquet)}) WHERE key::VARCHAR = 'geo'`)).getRowObjects();
  if (!geo.length) throw new Error("coffee-places.geoparquet has no GeoParquet 'geo' metadata");
  const count = Number((await con.runAndReadAll(`SELECT count(*) AS n FROM read_parquet(${sqlStr(parquet)})`)).getRowObjects()[0].n);
  if (count !== rows.length) throw new Error(`GeoParquet has ${count} rows, expected ${rows.length}`);
  con.closeSync?.();
  rmSync(tmp);
  artifacts.push({ path: "artifacts/coffee-places.geoparquet", url: `${DATA}artifacts/coffee-places.geoparquet`, bytes: statSync(parquet).size, format: "geoparquet", family: "coffee-places", records: count });

} else console.log("::warning::no coffee places; skipped coffee-places.geoparquet")

const index = {
  dataset_version: datasetVersion(root),
  schema_version: schemaVersions(files),
  built_at: new Date().toISOString(),
  licence: "CDLA-Permissive-2.0",
  datasets: files.map((f) => ({ path: `datasets/${f.rel}`, url: `${DATA}datasets/${f.rel}`, family: f.family, bytes: statSync(join(datasetsDir, f.rel)).size, records: f.records.length, ...(f.family === "coffee-places" ? { city: f.doc.meta.city, country_code: f.doc.meta.country_code } : {}) })),
  artifacts,
};
writeFileSync(join(out, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
console.log(`artifacts: ${artifacts.length} files, ${rows.length} places, ${files.length} dataset files -> ${out}`);
