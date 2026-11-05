// Shared helpers for reading the datasets folder. Used by the checker, the artifact build,
// the README stats generator and the Data Explorer build.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const SCHEMA_HOST = "https://schema.roastbook.coffee/";

/** All *.json files below dir, as paths relative to dir with forward slashes, sorted. */
export function listJson(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".json")) out.push(relative(dir, p).split(sep).join("/"));
    }
  };
  try { walk(dir); } catch (e) { if (e.code !== "ENOENT") throw e; }
  return out;
}

/** Family and version named by a $schema URL, e.g. coffee-places / 0.1.0. */
export function parseSchemaUrl(url) {
  const m = /^https:\/\/schema\.roastbook\.coffee\/([a-z0-9-]+)\/\1\.schema\.v(\d+\.\d+\.\d+)\.json$/.exec(url ?? "");
  return m ? { family: m[1], version: m[2] } : null;
}

/** The array of records in a dataset document: the one top-level array besides $schema/meta. */
export function recordsKey(doc) {
  return Object.keys(doc ?? {}).find((k) => k !== "$schema" && k !== "meta" && Array.isArray(doc[k]));
}

/** Files that hold records, parsed. Throws on unreadable JSON. */
export function loadDatasets(datasetsDir) {
  const files = [];
  for (const rel of listJson(datasetsDir)) {
    const doc = JSON.parse(readFileSync(join(datasetsDir, rel), "utf8"));
    const family = rel.split("/")[0];
    const key = recordsKey(doc);
    files.push({ rel, family, doc, records: key ? doc[key] : [] });
  }
  return files;
}

/** Highest meta.version across files (date tags sort as YYYY.MM.DD.N with numeric N). */
export function datasetVersion(files) {
  const key = (v) => v.split(".").map((n) => n.padStart(4, "0")).join(".");
  return files.map((f) => f.doc?.meta?.version).filter(Boolean).sort((a, b) => key(a).localeCompare(key(b))).at(-1) ?? null;
}

/** Coffee places with their file context, for every consumer that needs city/country. */
export function coffeePlaces(files) {
  return files
    .filter((f) => f.family === "coffee-places")
    .flatMap((f) => f.records.map((p) => ({
      ...p,
      _city: f.doc.meta?.city,
      _city_name: f.doc.meta?.city_name ?? f.doc.meta?.city,
      _country_code: f.doc.meta?.country_code,
      _file: `datasets/${f.rel}`,
    })));
}
