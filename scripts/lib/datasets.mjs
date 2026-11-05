// Shared helpers for reading the datasets folder. Used by the checker, the artifact build,
// the README stats generator and the Data Explorer build.
import { execFileSync } from "node:child_process";
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

/**
 * Dataset version: the release tag. DATASET_VERSION wins (set by a workflow), else `git describe` against
 * the newest CalVer tag (YYYY.MM.DD.N, or YYYY.MM.DD.N-<commits>-g<sha> after it), else "unreleased".
 */
export function datasetVersion(root) {
  if (process.env.DATASET_VERSION) return process.env.DATASET_VERSION;
  try {
    return execFileSync("git", ["-C", root, "describe", "--tags", "--match", "[0-9]*"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || "unreleased";
  } catch {
    return "unreleased";
  }
}

/** Schema version per family, read from the files' $schema URLs. Throws when a family uses more than one version. */
export function schemaVersions(files) {
  const seen = {};
  for (const f of files) {
    const s = parseSchemaUrl(f.doc?.$schema);
    if (s) (seen[s.family] ??= new Set()).add(s.version);
  }
  const mixed = Object.entries(seen).filter(([, v]) => v.size > 1);
  if (mixed.length) throw new Error(`all files of a family must use the same schema version: ${mixed.map(([f, v]) => `${f} uses ${[...v].sort().join(" and ")}`).join("; ")}`);
  return Object.fromEntries(Object.entries(seen).sort(([a], [b]) => a.localeCompare(b)).map(([f, v]) => [f, [...v][0]]));
}

/** "0.1.0" when every family uses the same schema version, else "brew-methods 0.1.0, coffee-places 0.2.0". */
export function describeSchemaVersions(versions) {
  const distinct = new Set(Object.values(versions));
  if (distinct.size <= 1) return [...distinct][0] ?? "none";
  return Object.entries(versions).map(([f, v]) => `${f} ${v}`).join(", ");
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
