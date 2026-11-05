// Repository checks for open-coffee-data. Pure function over a datasets folder, an assets
// folder, a schemas folder and (optionally) the dataset files at the base ref.
// Rules are documented in docs/validation.md; keep both in sync.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, posix, relative, sep } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import OpeningHours from "opening_hours";
import { listJson, parseSchemaUrl, recordsKey } from "./datasets.mjs";

const addFormats = addFormatsModule.default ?? addFormatsModule;
const DATA_HOST = "https://data.roastbook.coffee/";
// Licences an image may carry. Anything else needs a maintainer to extend this list.
const IMAGE_LICENCE = /^(CC0-1\.0|PDM-1\.0|CC-BY-[1-4]\.0|CC-BY-SA-[1-4]\.0)$/;

export function createAjv(schemaDir) {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  for (const rel of listJson(schemaDir)) {
    const schema = JSON.parse(readFileSync(join(schemaDir, rel), "utf8"));
    if (schema.$id) ajv.addSchema(schema);
  }
  return ajv;
}

const fmtAjvError = (e) => `${e.instancePath || "/"} ${e.message}${e.params?.additionalProperty ? ` (${e.params.additionalProperty})` : ""}${e.params?.allowedValues ? ` (${e.params.allowedValues.join(", ")})` : ""}`;

/** Every http(s) string inside value, with its JSON path. */
function* urlsIn(value, path = "") {
  if (typeof value === "string") { if (/^https?:\/\//i.test(value)) yield { path, url: value }; return; }
  if (Array.isArray(value)) { for (const [i, v] of value.entries()) yield* urlsIn(v, `${path}/${i}`); return; }
  if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) yield* urlsIn(v, `${path}/${k}`);
}

export function denyMatch(url, path, denylist) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const inRatings = /(^|\/)external_ratings\/\d+\/url$/.test(path);
  return denylist.rules.find((r) =>
    new RegExp(r.host).test(host) && (!r.path || new RegExp(r.path).test(u.pathname)) && !(inRatings && r.external_ratings_ok)) ?? null;
}

/** Nearest LICENSE.md for a file under assets, and whether it lists the file in a table row with licence, author and source. */
function assetLicensed(assetsDir, file) {
  for (let d = dirname(file); ; d = dirname(d)) {
    const lic = join(d, "LICENSE.md");
    if (existsSync(lic)) {
      const name = relative(d, file).split(sep).join("/");
      const row = readFileSync(lic, "utf8").split("\n").find((l) => l.trim().startsWith("|") && l.includes(name));
      if (!row) return `not listed in ${relative(assetsDir, lic)}`;
      const cells = row.split("|").slice(1, -1).map((c) => c.trim());
      return cells.length >= 4 && cells.every(Boolean) ? null : `row in ${relative(assetsDir, lic)} needs file, licence, author and source`;
    }
    if (d === assetsDir || d === dirname(d)) return "no LICENSE.md in its folder or a parent folder";
  }
}

function walkFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walkFiles(p) : [p];
  });
}

/**
 * @param {object} o
 * @param {string} o.datasetsDir
 * @param {string} [o.assetsDir]
 * @param {string} o.schemaDir
 * @param {string} o.schemaVersion  pinned version from schema-version.txt
 * @param {{rules: object[]}} o.denylist
 * @param {Map<string,string>|null} [o.baseFiles]  dataset files at BASE_REF (path relative to datasets/ -> text); null skips the check
 */
export function check({ datasetsDir, assetsDir, schemaDir, schemaVersion, denylist, baseFiles = null }) {
  const errors = [];
  const warnings = [];
  const err = (file, message) => errors.push(`${file}: ${message}`);
  const warn = (file, message) => warnings.push(`${file}: ${message}`);
  const ajv = createAjv(schemaDir);

  const docs = [];
  for (const rel of listJson(datasetsDir)) {
    const file = `datasets/${rel}`;
    let doc;
    try { doc = JSON.parse(readFileSync(join(datasetsDir, rel), "utf8")); } catch (e) { err(file, `invalid JSON: ${e.message}`); continue; }
    const named = parseSchemaUrl(doc.$schema);
    if (!named) { err(file, `$schema must be a canonical https://schema.roastbook.coffee/<family>/<family>.schema.vX.Y.Z.json URL, got ${JSON.stringify(doc.$schema)}`); continue; }
    if (named.version !== schemaVersion) err(file, `$schema names v${named.version}; schema-version.txt pins ${schemaVersion}`);
    const validate = ajv.getSchema(doc.$schema);
    if (!validate) { err(file, `schema ${doc.$schema} is not part of the pinned schema release`); continue; }
    if (!validate(doc)) for (const e of validate.errors) err(file, `schema: ${fmtAjvError(e)}`);
    if (doc.meta?.schema_version !== undefined && doc.meta.schema_version !== schemaVersion)
      err(file, `meta.schema_version ${doc.meta.schema_version} differs from schema-version.txt ${schemaVersion}`);
    docs.push({ rel, file, doc, family: named.family });
  }

  // Source allow-list.
  const sourcesDoc = docs.find((d) => d.rel === "sources.json");
  if (!sourcesDoc) err("datasets/sources.json", "missing");
  const allow = new Map((sourcesDoc?.doc.sources ?? []).map((s) => [s.id, s]));

  const recordDocs = docs.filter((d) => d.family !== "sources" && d.family !== "translations");
  const ids = new Map(); // family -> Map(id -> {file, record})
  const stats = { files: docs.length, records: 0, families: {} };

  for (const d of recordDocs) {
    const { rel, file, doc, family } = d;
    const folder = rel.split("/")[0];
    if (folder !== family) err(file, `files in datasets/${folder}/ must use the ${folder} schema, not ${family}`);
    if (family === "coffee-places") {
      const parts = rel.split("/");
      if (parts.length !== 3) err(file, "coffee places live at datasets/coffee-places/<country>/<city>.json");
      else {
        const [, cc, name] = parts;
        if (!/^[a-z]{2}$/.test(cc)) err(file, "country folder must be a lower-case ISO 3166-1 alpha-2 code");
        if (doc.meta?.country_code !== cc.toUpperCase()) err(file, `meta.country_code ${doc.meta?.country_code} must equal the folder (${cc.toUpperCase()})`);
        if (doc.meta?.city !== basename(name, ".json")) err(file, `meta.city ${doc.meta?.city} must equal the file name (${basename(name, ".json")})`);
      }
      if (doc.meta?.schema_version === undefined) err(file, `meta.schema_version is required and must equal schema-version.txt (${schemaVersion})`);
    }
    const records = doc[recordsKey(doc)] ?? [];
    stats.records += records.length;
    stats.families[family] = (stats.families[family] ?? 0) + records.length;
    if (!ids.has(family)) ids.set(family, new Map());
    const famIds = ids.get(family);

    for (const [i, r] of records.entries()) {
      const where = `${file} [${r?.id ?? `#${i}`}]`;
      if (!r || typeof r !== "object") continue;
      if (famIds.has(r.id)) err(where, `duplicate id, also in ${famIds.get(r.id).file}`);
      else famIds.set(r.id, { file, record: r });

      checkSources(r, allow, (m) => err(where, m));
      for (const { path, url } of urlsIn(r)) {
        const rule = denyMatch(url, path, denylist);
        if (rule) err(where, `${path}: ${url} is on the deny-list (${rule.id}: ${rule.reason})`);
      }
      if (r.image) {
        if (!IMAGE_LICENCE.test(r.image.licence ?? "")) err(where, `image.licence ${JSON.stringify(r.image.licence)} is not an open licence we accept (CC0-1.0, PDM-1.0, CC-BY-x.0, CC-BY-SA-x.0)`);
        if (r.image.url?.startsWith(`${DATA_HOST}assets/`) && assetsDir) {
          const local = join(assetsDir, decodeURIComponent(r.image.url.slice(`${DATA_HOST}assets/`.length)));
          if (!existsSync(local)) err(where, `image.url points to assets/${relative(assetsDir, local)}, which does not exist`);
        }
      }
      if (family === "coffee-places" && r.opening_hours) {
        try {
          const oh = new OpeningHours(r.opening_hours, { lat: r.location?.lat, lon: r.location?.lon, address: { country_code: (r.address?.country_code ?? "de").toLowerCase(), state: r.address?.region ?? "" } }, { locale: "en" });
          for (const w of oh.getWarnings()) warn(where, `opening_hours: ${w}`);
        } catch (e) {
          err(where, `opening_hours does not parse: ${String(e).replace(/\s+/g, " ").slice(0, 300)}`);
        }
      }
    }
  }

  // References inside and across families.
  for (const [family, famIds] of ids) {
    for (const [id, { file, record }] of famIds) {
      const where = `${file} [${id}]`;
      if (record.merged_into !== undefined) {
        const target = famIds.get(record.merged_into);
        if (!target) err(where, `merged_into ${record.merged_into} does not exist`);
        else if (record.merged_into === id) err(where, "merged_into points to itself");
        else if (target.record.merged_into) warn(where, `merged_into ${record.merged_into}, which is itself merged; point at the final record`);
      }
      if (family === "brew-methods" && record.parent !== undefined) {
        if (!famIds.has(record.parent)) err(where, `parent ${record.parent} does not exist`);
        const seen = new Set([id]);
        for (let p = record.parent; p && famIds.has(p); p = famIds.get(p).record.parent) {
          if (seen.has(p)) { err(where, `parent chain loops through ${p}`); break; }
          seen.add(p);
        }
      }
      if (family === "equipment") {
        const methods = ids.get("brew-methods") ?? new Map();
        for (const m of record.brew_methods ?? []) if (!methods.has(m)) err(where, `brew_methods: ${m} is not a brew method id`);
      }
    }
  }

  // Translations reference existing records.
  for (const d of docs.filter((x) => x.family === "translations")) {
    if (!d.rel.startsWith("i18n/")) err(d.file, "translations live under datasets/i18n/<locale>/");
    const locale = d.rel.split("/")[1];
    if (d.doc.meta?.locale && d.doc.meta.locale !== locale) err(d.file, `meta.locale ${d.doc.meta.locale} must equal the folder (${locale})`);
    const base = d.doc.meta?.base;
    const baseDoc = recordDocs.find((x) => x.file === base);
    if (!baseDoc) { err(d.file, `meta.base ${base} is not a dataset file`); continue; }
    const baseIds = new Set((baseDoc.doc[recordsKey(baseDoc.doc)] ?? []).map((r) => r.id));
    for (const id of Object.keys(d.doc.entries ?? {})) if (!baseIds.has(id)) err(d.file, `entry ${id} does not exist in ${base}`);
  }

  // Ids never deleted.
  if (baseFiles) {
    for (const [rel, text] of baseFiles) {
      let doc;
      try { doc = JSON.parse(text); } catch { continue; }
      const family = parseSchemaUrl(doc.$schema)?.family ?? rel.split("/")[0];
      for (const r of doc[recordsKey(doc)] ?? []) {
        if (r?.id && !ids.get(family)?.has(r.id))
          err(`datasets/${rel}`, `id ${r.id} exists on the base branch but was deleted; ids are permanent, keep a tombstone (status closed or merged_into) instead`);
      }
    }
  }

  // Assets: every file has a licence row.
  if (assetsDir) {
    for (const f of walkFiles(assetsDir)) {
      if (basename(f) === "LICENSE.md" || basename(f) === ".gitkeep") continue;
      const problem = assetLicensed(assetsDir, f);
      if (problem) err(`assets/${relative(assetsDir, f).split(sep).join(posix.sep)}`, problem);
    }
  }

  return { errors, warnings, stats };
}

/**
 * Source rules (docs/validation.md):
 * - every source_id is on the allow-list and vetted;
 * - record-level sources[] must be allowed for facts or discovery, or for images when the record has an image;
 *   verification-only sources (Google) never appear in sources (store xref.google_place_id only);
 * - at least one record-level source is allowed for facts (discovery alone does not support a published record);
 * - field_provenance for image or image.* needs sources allowed for images; any other field needs facts.
 */
export function checkSources(record, allow, report) {
  const known = (ref, where) => {
    const s = allow.get(ref.source_id);
    if (!s) { report(`${where}: source_id ${ref.source_id} is not on the allow-list (datasets/sources.json)`); return null; }
    if (!s.vetted) report(`${where}: source ${ref.source_id} is not vetted yet`);
    return s;
  };
  let hasFacts = false;
  for (const [i, ref] of (record.sources ?? []).entries()) {
    const s = known(ref, `sources/${i}`);
    if (!s) continue;
    const a = s.allowed_for;
    if (a.includes("facts")) hasFacts = true;
    if (!(a.includes("facts") || a.includes("discovery") || (a.includes("images") && record.image)))
      report(`sources/${i}: ${ref.source_id} is allowed only for ${a.join(", ")} and cannot support this record`);
  }
  if ((record.sources ?? []).length && !hasFacts) report("sources: needs at least one source allowed for facts (discovery-only sources do not support facts)");
  for (const [field, prov] of Object.entries(record.field_provenance ?? {})) {
    const need = field === "image" || field.startsWith("image.") ? "images" : "facts";
    for (const [i, ref] of (prov.sources ?? []).entries()) {
      const s = known(ref, `field_provenance/${field}/sources/${i}`);
      if (s && !s.allowed_for.includes(need)) report(`field_provenance/${field}/sources/${i}: ${ref.source_id} is not allowed for ${need}`);
    }
  }
}
