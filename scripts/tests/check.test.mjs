// Unit tests for scripts/lib/check.mjs. Needs the schemas: SCHEMA_DIR (set by validate.sh)
// or OPEN_COFFEE_SCHEMA_DIR.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { check, denyMatch } from "../lib/check.mjs";

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

function run({ cityDoc = city(), brew = fx("brew-methods.json"), extra = {}, assets = {}, baseFiles = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ocd-check-"));
  const files = {
    "datasets/sources.json": fx("sources.json"),
    "datasets/coffee-places/de/example-city.json": cityDoc,
    "datasets/brew-methods/brew-methods.json": brew,
    ...extra,
  };
  for (const [p, v] of Object.entries({ ...files, ...assets })) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), typeof v === "string" ? v : JSON.stringify(v));
  }
  return check({ datasetsDir: join(dir, "datasets"), assetsDir: join(dir, "assets"), schemaDir, schemaVersion: "0.1.0", denylist, baseFiles });
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

test("unknown and wrongly used sources", { skip: !schemaDir }, () => {
  const c = city();
  c.places[1].sources = [{ source_id: "made-up", retrieved_at: "2026-11-05T12:00:00Z" }];
  c.places[2].sources = [{ source_id: "web-search", retrieved_at: "2026-11-05T12:00:00Z" }];
  c.places[0].field_provenance.image = { sources: [{ source_id: "place-website", retrieved_at: "2026-11-05T12:00:00Z" }] };
  c.places[0].field_provenance.opening_hours.sources = [{ source_id: "wikimedia-commons", retrieved_at: "2026-11-05T12:00:00Z" }];
  const r = run({ cityDoc: c });
  has(r, /made-up is not on the allow-list/);
  has(r, /needs at least one source allowed for facts/);
  has(r, /field_provenance\/image\/sources\/0: place-website is not allowed for images/);
  has(r, /field_provenance\/opening_hours\/sources\/0: wikimedia-commons is not allowed for facts/);
});

test("verification-only source cannot back a record", { skip: !schemaDir }, () => {
  const c = city();
  c.places[1].sources.push({ source_id: "google-places-verification", retrieved_at: "2026-11-05T12:00:00Z" });
  has(run({ cityDoc: c }), /google-places-verification is allowed only for verification/);
});

test("deny-listed URLs", { skip: !schemaDir }, () => {
  const c = city();
  c.places[0].links.website = "https://www.google.com/maps/place/x";
  c.places[0].specialty_evidence[0].url = "https://extract.coffee/munich/x";
  c.places[0].external_ratings.push({ source: "yelp", id: "x", url: "https://www.yelp.de/biz/x" });
  const r = run({ cityDoc: c });
  has(r, /google-maps/);
  has(r, /extract-coffee/);
  assert.ok(!r.errors.some((e) => /yelp/.test(e)), "yelp is allowed as an external rating reference");
});

test("denyMatch details", () => {
  assert.equal(denyMatch("https://maps.app.goo.gl/abc", "/links/website", denylist)?.id, "google-maps-short");
  assert.equal(denyMatch("https://www.openstreetmap.org/node/1", "/x", denylist)?.id, "openstreetmap");
  assert.equal(denyMatch("https://www.tripadvisor.de/x", "/links/website", denylist)?.id, "tripadvisor");
  assert.equal(denyMatch("https://www.tripadvisor.de/x", "/external_ratings/0/url", denylist), null);
  assert.equal(denyMatch("https://example.com/maps", "/x", denylist), null);
});

test("image licence and local assets", { skip: !schemaDir }, () => {
  const c = city();
  c.places[0].image.licence = "all-rights-reserved";
  c.places[1].image = { url: "https://data.roastbook.coffee/assets/coffee-places/missing.jpg", licence: "CC-BY-4.0", author: "A", source_url: "https://example.com/" };
  const r = run({
    cityDoc: c,
    assets: {
      "assets/coffee-places/LICENSE.md": "| File | Licence | Author | Source |\n|---|---|---|---|\n| `ok.jpg` | CC-BY-4.0 | A | https://example.com/ |\n",
      "assets/coffee-places/ok.jpg": "x",
      "assets/coffee-places/unlisted.jpg": "x",
    },
  });
  has(r, /not an open licence/);
  has(r, /missing\.jpg, which does not exist/);
  has(r, /unlisted\.jpg: not listed in coffee-places\/LICENSE\.md/);
  assert.ok(!r.errors.some((e) => /ok\.jpg/.test(e)));
});

test("opening_hours must parse", { skip: !schemaDir }, () => {
  const c = city();
  c.places[0].opening_hours = "daily from eight";
  has(run({ cityDoc: c }), /opening_hours does not parse/);
});

test("meta must match path and pin", { skip: !schemaDir }, () => {
  const c = city();
  c.meta.city = "elsewhere";
  c.meta.country_code = "AT";
  c.meta.schema_version = "1.1.0";
  const r = run({ cityDoc: c });
  has(r, /meta.city elsewhere must equal the file name/);
  has(r, /meta.country_code AT must equal the folder/);
  has(r, /meta.schema_version 1.1.0 differs/);
});

test("translations reference existing ids", { skip: !schemaDir }, () => {
  const tr = {
    $schema: "https://schema.roastbook.coffee/translations/translations.schema.v0.1.0.json",
    meta: { version: "2026.11.05.1", generated_at: "2026-11-05T12:00:00Z", locale: "de", base: "datasets/coffee-places/de/example-city.json" },
    entries: { "cp-example0001": { name: "Beispiel" }, "cp-nothere0001": { name: "Fehlt" } },
  };
  const r = run({ extra: { "datasets/i18n/de/coffee-places/de/example-city.json": tr } });
  has(r, /entry cp-nothere0001 does not exist/);
  assert.ok(!r.errors.some((e) => /cp-example0001/.test(e)));
});

test("brew method parents exist and do not loop", { skip: !schemaDir }, () => {
  const b = fx("brew-methods.json");
  b.brew_methods[1].parent = "nope";
  has(run({ brew: b }), /parent nope does not exist/);
  const loop = fx("brew-methods.json");
  loop.brew_methods[0].parent = "v60";
  has(run({ brew: loop }), /parent chain loops/);
});
