// Unit tests for scripts/lib/check.mjs. Needs the schemas: SCHEMA_DIR (set by validate.sh)
// or OPEN_COFFEE_SCHEMA_DIR.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { check, denyMatch } from "../lib/check.mjs";
import { datasetVersion, describeSchemaVersions, schemaVersions } from "../lib/datasets.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name) => JSON.parse(readFileSync(join(here, "fixtures", name), "utf8"));
const denylist = JSON.parse(readFileSync(join(here, "../config/denylist.json"), "utf8"));
const schemaDir = process.env.SCHEMA_DIR ?? process.env.OPEN_COFFEE_SCHEMA_DIR;

/** A valid city file built from the schema repo's valid examples. */
function city() {
  const full = fx("full-record.json");
  full.places.push(...fx("minimal-record.json").places);
  return full;
}

function run({ cityDoc = city(), brew = fx("brew-methods.json"), baseFiles = null, extra = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ocd-check-"));
  const files = {
    "datasets/coffee-places/de/example-city.json": cityDoc,
    "datasets/brew-methods/brew-methods.json": brew,
    ...extra,
  };
  for (const [p, v] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), JSON.stringify(v));
  }
  return check({ datasetsDir: join(dir, "datasets"), schemaDir, denylist, baseFiles });
}
const has = (r, re) => assert.ok(r.errors.some((e) => re.test(e)), `expected an error matching ${re}, got:\n${r.errors.join("\n")}`);

test("valid fixtures pass", { skip: !schemaDir && "no schemas" }, () => {
  const r = run();
  assert.deepEqual(r.errors, []);
  assert.equal(r.stats.records, 5);
});

test("schema errors are reported", { skip: !schemaDir }, () => {
  const c = city();
  c.places[0].specialty_tier = "S";
  has(run({ cityDoc: c }), /schema: \/places\/0\/specialty_tier/);
});

test("duplicate ids", { skip: !schemaDir }, () => {
  const c = city();
  c.places[1].id = c.places[0].id;
  has(run({ cityDoc: c }), /duplicate id/);
});

test("ids never deleted against the base ref", { skip: !schemaDir }, () => {
  const before = city();
  before.places.push({ ...before.places[1], id: "cp-gone000001" });
  const r = run({ baseFiles: new Map([["coffee-places/de/example-city.json", JSON.stringify(before)]]) });
  has(r, /cp-gone000001 exists on the base branch but was deleted/);
});

test("merged_into target must exist", { skip: !schemaDir }, () => {
  const c = city();
  c.places[2].merged_into = "cp-missing0001";
  has(run({ cityDoc: c }), /merged_into cp-missing0001 does not exist/);
});

test("brew-method ranges must be ordered", { skip: !schemaDir }, () => {
  const brew = fx("brew-methods.json");
  const m = brew.brew_methods.find((x) => x.typical_parameters?.brew_ratio);
  m.typical_parameters.brew_ratio = { min: 18, typical: 16, max: 17 };
  has(run({ brew }), /typical_parameters\.brew_ratio: expected min <= typical <= max/);
});

test("deny-listed URLs", { skip: !schemaDir }, () => {
  const c = city();
  c.places[0].links.website = "https://www.google.com/maps/place/x";
  c.places[1].links = { website: "https://extract.coffee/munich/x" };
  c.places[1].image = { url: "https://www.openstreetmap.org/x.jpg", licence: "CC0-1.0", author: "A", source_url: "https://example.com/" };
  c.places[0].external_ratings.push({ source: "yelp", id: "x", url: "https://www.yelp.de/biz/x" });
  const r = run({ cityDoc: c });
  has(r, /google-maps/);
  has(r, /extract-coffee/);
  has(r, /openstreetmap/);
  assert.ok(!r.errors.some((e) => /yelp/.test(e)), "yelp is allowed as an external rating reference");
});

test("denyMatch details", () => {
  assert.equal(denyMatch("https://maps.app.goo.gl/abc", "/links/website", denylist)?.id, "google-maps-short");
  assert.equal(denyMatch("https://www.openstreetmap.org/node/1", "/x", denylist)?.id, "openstreetmap");
  assert.equal(denyMatch("https://www.tripadvisor.de/x", "/links/website", denylist)?.id, "tripadvisor");
  assert.equal(denyMatch("https://www.tripadvisor.de/x", "/external_ratings/0/url", denylist), null);
  assert.equal(denyMatch("https://example.com/maps", "/x", denylist), null);
});

test("image licence", { skip: !schemaDir }, () => {
  const c = city();
  c.places[0].image.licence = "all-rights-reserved";
  has(run({ cityDoc: c }), /not an open licence/);
});

test("opening_hours must parse", { skip: !schemaDir }, () => {
  const c = city();
  c.places[0].opening_hours = "daily from eight";
  has(run({ cityDoc: c }), /opening_hours does not parse/);
});

test("meta must match the path", { skip: !schemaDir }, () => {
  const c = city();
  c.meta.city = "elsewhere";
  c.meta.country_code = "AT";
  const r = run({ cityDoc: c });
  has(r, /meta.city elsewhere must equal the file name/);
  has(r, /meta.country_code AT must equal the folder/);
});

test("a family must not mix schema versions", { skip: !schemaDir }, () => {
  const other = city();
  other.$schema = other.$schema.replace(/v\d+\.\d+\.\d+\.json$/, "v9.0.0.json");
  other.meta.city = "other-city";
  other.places = [];
  const r = run({ extra: { "datasets/coffee-places/de/other-city.json": other } });
  has(r, /coffee-places uses \d+\.\d+\.\d+ and 9\.0\.0/);
  has(r, /other-city\.json: schema .*v9\.0\.0\.json is not in/);
});

test("schema and dataset versions", () => {
  const doc = (family, v) => ({ doc: { $schema: `https://schema.roastbook.coffee/${family}/${family}.schema.v${v}.json` } });
  const same = schemaVersions([doc("coffee-places", "0.1.0"), doc("brew-methods", "0.1.0")]);
  assert.deepEqual(same, { "brew-methods": "0.1.0", "coffee-places": "0.1.0" });
  assert.equal(describeSchemaVersions(same), "0.1.0");
  assert.equal(describeSchemaVersions({ "brew-methods": "0.1.0", "coffee-places": "0.2.0" }), "brew-methods 0.1.0, coffee-places 0.2.0");
  assert.throws(() => schemaVersions([doc("coffee-places", "0.1.0"), doc("coffee-places", "0.2.0")]), /coffee-places uses 0.1.0 and 0.2.0/);
  const saved = process.env.DATASET_VERSION;
  try {
    process.env.DATASET_VERSION = "2026.11.05.2";
    assert.equal(datasetVersion(tmpdir()), "2026.11.05.2");
    delete process.env.DATASET_VERSION;
    assert.equal(datasetVersion(mkdtempSync(join(tmpdir(), "ocd-nogit-"))), "unreleased");
  } finally {
    if (saved === undefined) delete process.env.DATASET_VERSION; else process.env.DATASET_VERSION = saved;
  }
});

test("brew method parents exist and do not loop", { skip: !schemaDir }, () => {
  const b = fx("brew-methods.json");
  b.brew_methods[1].parent = "nope";
  has(run({ brew: b }), /parent nope does not exist/);
  const loop = fx("brew-methods.json");
  loop.brew_methods[0].parent = "example-cone";
  has(run({ brew: loop }), /parent chain loops/);
});
