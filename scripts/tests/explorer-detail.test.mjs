import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { formatValue, httpUrl } from "../../site/src/scripts/detail.ts";
import { parsePlacesPayload } from "../../site/src/scripts/place.ts";

const place = {
  id: "cp-example001", name: "Café Example", status: "open", specialty_tier: "A",
  location: { lat: 48, lon: 11 }, _city: "munich", _city_name: "Munich", _file: "datasets/coffee-places/de/munich.json",
};

test("Explorer payload parsing checks the fields consumed by filters, maps and images", () => {
  assert.deepEqual(parsePlacesPayload({ places: [place] }), [place]);
  const dataset = JSON.parse(readFileSync(new URL("../../datasets/coffee-places/de/munich.json", import.meta.url), "utf8"));
  assert.equal(parsePlacesPayload({ places: dataset.places.map((p) => ({ ...p, _city: "munich", _city_name: "Munich", _file: place._file })) }).length, dataset.places.length);
  for (const invalid of [null, {}, { places: [null] }, { places: [{ ...place, location: { lat: "48", lon: 11 } }] },
    { places: [{ ...place, image: { url: "x", author: "a", licence: "CC0-1.0", source_url: "x", width: '\" onerror="alert(1)' } }] },
    { places: [{ ...place, roasters_served: [{ name: 12 }] }] }, { places: [{ ...place, serving: { filter: "yes" } }] },
  ]) assert.throws(() => parsePlacesPayload(invalid), /Invalid Explorer/);
});

test("detail values preserve normal formatting and escape markup in structured fields", () => {
  assert.equal(formatValue("location", { lat: 48, lon: 11 }), "48, 11");
  assert.equal(formatValue("operator", { name: "Coffee GmbH", legal_form: "GmbH", register_id: "HR 1" }), "Coffee GmbH, HR 1");
  assert.match(formatValue("prices.cappuccino", { amount: 3.5, currency: "EUR", observed_on: "2026-11-01", source_url: "https://example.com/menu" }), /3\.50 EUR.*href="https:\/\/example.com\/menu"/);
  const attack = '<img src=x onerror="alert(1)">';
  for (const [path, value] of [["location", { lat: attack, lon: attack }], ["awards", [{ name: attack, year: attack }]]]) {
    const html = formatValue(path, value);
    assert.ok(!html.includes("<img"));
    assert.match(html, /&#60;img/);
  }
});

test("detail reference links reject executable URL protocols", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "\nJaVaScRiPt:alert(1)"]) {
    assert.equal(httpUrl(url), "");
    assert.ok(!formatValue("roasters_served", [{ name: "Roastery", url }]).includes("href="));
    assert.ok(!formatValue("prices.cappuccino", { amount: 3.5, currency: "EUR", source_url: url }).includes("href="));
  }
  assert.match(formatValue("roasters_served", [{ name: "Roastery", url: "https://example.com/?a=1&b=2", own: true }]), /href="https:\/\/example.com\/\?a=1&#38;b=2".*own roastery/);
});
