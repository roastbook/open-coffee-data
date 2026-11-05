// The Explorer's filter predicate and hash round trip (site/src/scripts/filter.ts, run via Node type stripping).
import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyFilters, matches, parseHash, toHash } from "../../site/src/scripts/filter.ts";

const place = {
  name: "Café Süß", _city: "munich", specialty_tier: "A", status: "open", roasts_own_beans: true,
  serving: { filter: true, espresso: true }, amenities: { wifi: false }, address: { street_address: "Hauptstraße 1" },
  roasters_served: [{ name: "Vits" }], location: { lat: 48.1, lon: 11.5 },
};

test("hash round trip", () => {
  const state = { filters: { ...emptyFilters(), q: "süß café", city: "munich", tier: ["A", "B"], serving: ["filter"], roasts: true }, place: "cp-0000000001", view: "table" };
  const hash = toHash(state);
  assert.match(hash, /tier=A,B/);
  assert.deepEqual(parseHash(`#${hash}`), state);
  assert.deepEqual(parseHash("#place=cp-x").filters, emptyFilters());
});

test("matches combines every filter", () => {
  const f = emptyFilters();
  assert.ok(matches(place, f));
  assert.ok(matches(place, { ...f, q: "CAFE süß vits" }), "case and accents folded, words in any field");
  assert.ok(!matches(place, { ...f, q: "nowhere" }));
  assert.ok(matches(place, { ...f, tier: ["A"], serving: ["filter", "espresso"], roasts: true }));
  assert.ok(!matches(place, { ...f, tier: ["B"] }));
  assert.ok(!matches(place, { ...f, amenities: ["wifi"] }), "false is not true");
  assert.ok(!matches(place, { ...f, equipment: true }), "absent is unknown, not a match");
  assert.ok(!matches(place, { ...f, city: "berlin" }));
  assert.ok(matches(place, { ...f, inview: true }, { west: 11, east: 12, south: 48, north: 49 }));
  assert.ok(!matches(place, { ...f, inview: true }, { west: 12, east: 13, south: 48, north: 49 }));
});
