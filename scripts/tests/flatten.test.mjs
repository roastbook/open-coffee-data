import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { csvEscape, flattenPlace } from "../lib/flatten.mjs";

const full = JSON.parse(readFileSync(new URL("./fixtures/full-record.json", import.meta.url), "utf8")).places[0];

test("flattenPlace uses dotted schema paths and drops provenance", () => {
  const row = flattenPlace(full, { city: "example-city", country_code: "DE" });
  assert.equal(row["serving.filter"], true);
  assert.equal(row["address.postal_code"], "80331");
  assert.equal(row["prices.cappuccino.amount"], 3.9);
  assert.equal(row.lat, 48.1371);
  assert.equal(row.sources, "overture-places; place-website");
  assert.equal(row.good_for, "coffee_nerds; quick_espresso");
  assert.ok(!Object.keys(row).some((k) => k.startsWith("field_provenance")));
  for (const v of Object.values(row)) assert.ok(v === null || typeof v !== "object", "values are scalars");
});

test("csvEscape quotes when needed", () => {
  assert.equal(csvEscape('a "b", c'), '"a ""b"", c"');
  assert.equal(csvEscape(undefined), "");
  assert.equal(csvEscape(false), "false");
});
