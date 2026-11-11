// Repository checks for open-coffee-data. Pure function over a datasets folder, a schemas folder and (optionally) the dataset files at the base ref.
// Rules are documented in docs/validation.md; keep both in sync.
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import OpeningHours from "opening_hours";
import { listJson, parseSchemaUrl, recordsKey, schemaVersions } from "./datasets.mjs";

const addFormats = addFormatsModule.default ?? addFormatsModule;
// Licences an image may carry. Anything else needs a maintainer to extend this list.
const IMAGE_LICENCE = /^(CC0-1\.0|PDM-1\.0|CC-BY-[1-4]\.0|CC-BY-SA-[1-4]\.0)$/;

// format "iri" (schemas v0.3.0+), same rule as isIri in open-coffee-schema/lib/formats.ts.
// shortcut: copied instead of depending on @roastbook/open-coffee-schema; switch when that package is a dependency here.
const isIri = (v) => {
  if (typeof v !== "string" || !/^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}|\\^`\u0000-\u001f\u007f]+$/.test(v)) return false;
  try { return Boolean(new URL(v)); } catch { return false; }
};

export function createAjv(schemaDir) {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  ajv.addFormat("iri", isIri);
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

function loadDocument(rel, { datasetsDir, schemaDir, ajv, named, err }) {
  const file = `datasets/${rel}`;
  let doc;
  try { doc = JSON.parse(readFileSync(join(datasetsDir, rel), "utf8")); }
  catch (e) { err(file, `invalid JSON: ${e.message}`); return null; }
  const schema = parseSchemaUrl(doc.$schema);
  if (!schema) {
    err(file, `$schema must be a canonical https://schema.roastbook.coffee/<family>/<family>.schema.vX.Y.Z.json URL, got ${JSON.stringify(doc.$schema)}`);
    return null;
  }
  named.push({ doc });
  const validate = ajv.getSchema(doc.$schema);
  if (!validate) { err(file, `schema ${doc.$schema} is not in ${schemaDir} (is v${schema.version} released?)`); return null; }
  if (!validate(doc)) for (const error of validate.errors) err(file, `schema: ${fmtAjvError(error)}`);
  return { rel, file, doc, family: schema.family };
}

function checkCityLayout({ rel, file, doc }, err) {
  const parts = rel.split("/");
  if (parts.length !== 3) err(file, "coffee places live at datasets/coffee-places/<country>/<city>.json");
  else {
    const [, cc, name] = parts;
    if (!/^[a-z]{2}$/.test(cc)) err(file, "country folder must be a lower-case ISO 3166-1 alpha-2 code");
    if (doc.meta?.country_code !== cc.toUpperCase()) err(file, `meta.country_code ${doc.meta?.country_code} must equal the folder (${cc.toUpperCase()})`);
    if (doc.meta?.city !== basename(name, ".json")) err(file, `meta.city ${doc.meta?.city} must equal the file name (${basename(name, ".json")})`);
  }
}

function checkLayout(dataset, err) {
  const { rel, file, family } = dataset;
  const folder = rel.split("/")[0];
  if (folder !== family) err(file, `files in datasets/${folder}/ must use the ${folder} schema, not ${family}`);
  if (family === "coffee-places") checkCityLayout(dataset, err);
}

function checkRecordUrls(r, where, denylist, err) {
  for (const { path, url } of urlsIn(r)) {
    const rule = denyMatch(url, path, denylist);
    if (rule) err(where, `${path}: ${url} is on the deny-list (${rule.id}: ${rule.reason})`);
  }
}

function checkImage(r, where, err) {
  if (!r.image) return;
  if (!IMAGE_LICENCE.test(r.image.licence ?? "")) err(where, `image.licence ${JSON.stringify(r.image.licence)} is not an open licence we accept (CC0-1.0, PDM-1.0, CC-BY-x.0, CC-BY-SA-x.0)`);
}

function checkHours(r, where, err, warn) {
  try {
    const oh = new OpeningHours(r.opening_hours, { lat: r.location?.lat, lon: r.location?.lon, address: { country_code: (r.address?.country_code ?? "de").toLowerCase(), state: r.address?.region ?? "" } }, { locale: "en" });
    for (const w of oh.getWarnings()) warn(where, `opening_hours: ${w}`);
  } catch (e) {
    err(where, `opening_hours does not parse: ${String(e).replace(/\s+/g, " ").slice(0, 300)}`);
  }
}

function indexRecords(dataset, { ids, stats, denylist, err, warn }) {
  const { file, doc, family } = dataset;
  const records = doc[recordsKey(doc)] ?? [];
  stats.records += records.length;
  stats.families[family] = (stats.families[family] ?? 0) + records.length;
  if (!ids.has(family)) ids.set(family, new Map());
  const famIds = ids.get(family);
  for (const [i, record] of records.entries()) {
    checkAndIndexRecord(record, i, { file, family, famIds, denylist, err, warn });
  }
}

function checkAndIndexRecord(record, index, { file, family, famIds, denylist, err, warn }) {
  const where = `${file} [${record?.id ?? `#${index}`}]`;
  if (!record || typeof record !== "object") return;
  if (famIds.has(record.id)) err(where, `duplicate id, also in ${famIds.get(record.id).file}`);
  else famIds.set(record.id, { file, record });
  checkRecordUrls(record, where, denylist, err);
  checkImage(record, where, err);
  if (family === "coffee-places" && record.opening_hours) checkHours(record, where, err, warn);
}

function checkMerge(record, id, famIds, where, err, warn) {
  if (record.merged_into === undefined) return;
  const target = famIds.get(record.merged_into);
  if (!target) err(where, `merged_into ${record.merged_into} does not exist`);
  else if (record.merged_into === id) err(where, "merged_into points to itself");
  else if (target.record.merged_into) warn(where, `merged_into ${record.merged_into}, which is itself merged; point at the final record`);
}

function checkRanges(record, where, err) {
  // JSON Schema cannot compare two numbers, so the range order lives here.
  for (const [k, r] of Object.entries(record.typical_parameters ?? {})) {
    if (!r || typeof r !== "object" || Array.isArray(r)) continue;
    const nums = [r.min, r.typical, r.max].filter((n) => typeof n === "number");
    if (nums.some((n, i) => i > 0 && n < nums[i - 1])) err(where, `typical_parameters.${k}: expected min <= typical <= max`);
  }
}

function checkParent(record, id, famIds, where, err) {
  if (record.parent === undefined) return;
  if (!famIds.has(record.parent)) err(where, `parent ${record.parent} does not exist`);
  const seen = new Set([id]);
  for (let p = record.parent; p && famIds.has(p); p = famIds.get(p).record.parent) {
    if (seen.has(p)) { err(where, `parent chain loops through ${p}`); break; }
    seen.add(p);
  }
}

function checkEquipment(record, ids, where, err) {
  const methods = ids.get("brew-methods") ?? new Map();
  for (const method of record.brew_methods ?? []) if (!methods.has(method)) err(where, `brew_methods: ${method} is not a brew method id`);
}

function checkPourPattern(record, ids, where, err) {
  const own = ids.get("pour-patterns");
  const kindOf = (id) => own.get(id)?.record.kind;
  const methods = ids.get("brew-methods") ?? new Map();
  for (const m of record.brew_methods ?? []) if (!methods.has(m)) err(where, `brew_methods: ${m} is not a brew method id`);
  for (const p of record.flow_patterns ?? []) if (kindOf(p) !== "flow") err(where, `flow_patterns: ${p} is not a flow pattern id`);
  const d = record.defaults;
  if (d && Math.abs(d.dose_g * d.brew_ratio - d.brew_water_g) > d.brew_water_g * 0.01) err(where, `defaults: dose_g × brew_ratio is ${Math.round(d.dose_g * d.brew_ratio)} g, expected brew_water_g ${d.brew_water_g} within 1%`);
  const t = d?.temperature;
  for (const [k, r] of [["celsius", t?.celsius], ...(t?.by_roast ?? []).map((b, i) => [`by_roast.${i}.celsius`, b.celsius])]) {
    const nums = [r?.min, r?.typical, r?.max].filter((n) => typeof n === "number");
    if (nums.some((n, i) => i > 0 && n < nums[i - 1])) err(where, `defaults.temperature.${k}: expected min <= typical <= max`);
  }
  if (!record.phases) return;
  const phaseIds = new Set();
  let water = 0;
  for (const phase of record.phases) {
    if (phaseIds.has(phase.id)) err(where, `phases: duplicate phase id ${phase.id}`);
    phaseIds.add(phase.id);
    if (phase.movement && kindOf(phase.movement) !== "movement") err(where, `phases.${phase.id}.movement: ${phase.movement} is not a kettle movement id`);
    water += phase.water_fraction ?? 0;
    const at = (phase.flow_curve ?? []).map((pt) => pt.at_seconds);
    if (at.some((t, i) => (i > 0 && t <= at[i - 1]) || t > phase.duration_seconds)) err(where, `phases.${phase.id}.flow_curve: at_seconds must increase and stay within duration_seconds`);
  }
  if (Math.abs(water - 1) > 0.005) err(where, `phases: water_fraction of the pour phases adds up to ${Math.round(water * 1000) / 1000}, expected 1`);
}

function checkReferences(ids, err, warn) {
  for (const [family, famIds] of ids) {
    for (const [id, { file, record }] of famIds) {
      const where = `${file} [${id}]`;
      checkMerge(record, id, famIds, where, err, warn);
      if (family === "brew-methods") {
        checkRanges(record, where, err);
        checkParent(record, id, famIds, where, err);
      }
      if (family === "equipment" || family === "distribution-methods") checkEquipment(record, ids, where, err);
      if (family === "pour-patterns") checkPourPattern(record, ids, where, err);
    }
  }
}

// Coffee place removals are warnings; other families must retain permanent ids.
function checkRemovals(baseFiles, ids, err, warn) {
  for (const [rel, text] of baseFiles) {
    let doc;
    try { doc = JSON.parse(text); } catch { continue; }
    const family = parseSchemaUrl(doc.$schema)?.family ?? rel.split("/")[0];
    for (const r of doc[recordsKey(doc)] ?? []) {
      if (r?.id && !ids.get(family)?.has(r.id)) {
        if (family === "coffee-places") warn(`datasets/${rel}`, `id ${r.id} (${r.name}) was removed; check that it was unconfirmed or a duplicate`);
        else err(`datasets/${rel}`, `id ${r.id} exists on the base branch but was deleted; ids are permanent, keep a tombstone (merged_into) instead`);
      }
    }
  }
}

/** Validate datasets, their cross-record references and optional base-branch ids. */
export function check({ datasetsDir, schemaDir, denylist, baseFiles = null }) {
  const errors = [];
  const warnings = [];
  const err = (file, message) => errors.push(`${file}: ${message}`);
  const warn = (file, message) => warnings.push(`${file}: ${message}`);
  const ajv = createAjv(schemaDir);
  const named = [];
  const docs = listJson(datasetsDir)
    .map((rel) => loadDocument(rel, { datasetsDir, schemaDir, ajv, named, err }))
    .filter(Boolean);
  let versions = {};
  try { versions = schemaVersions(named); } catch (e) { err("datasets", e.message); }
  const ids = new Map();
  const stats = { files: docs.length, records: 0, families: {}, schemaVersions: versions };
  for (const dataset of docs) {
    checkLayout(dataset, err);
    indexRecords(dataset, { ids, stats, denylist, err, warn });
  }
  checkReferences(ids, err, warn);
  if (baseFiles) checkRemovals(baseFiles, ids, err, warn);
  return { errors, warnings, stats };
}
