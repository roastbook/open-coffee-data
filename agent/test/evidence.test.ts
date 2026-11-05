import { expect, test } from "bun:test";
import { findQuote, norm } from "../src/evidence";
import { verify, type Proposal } from "../src/extract";
import type { SitePage } from "../src/site";

const page = (text: string, url = "https://cafe.example/"): SitePage => ({ url, fetchedAt: "2026-11-05T10:00:00Z", rendered: false, doc: { title: "", text, links: [], jsonld: "" } });

test("quotes match across whitespace, dashes and case, but not when altered", () => {
  const text = "Öffnungszeiten\nMo – Fr 8–18 Uhr\nWir rösten   selbst.";
  expect(findQuote(text, "Mo - Fr 8-18 Uhr")).toBeGreaterThanOrEqual(0);
  expect(findQuote(text, "wir rösten selbst")).toBeGreaterThanOrEqual(0);
  expect(findQuote(text, "Mo – Fr 8–19 Uhr")).toBe(-1);
  expect(findQuote(text, "ok")).toBe(-1); // too short to count
  expect(norm("A­B​C")).toBe("abc");
});

test("verify keeps only quoted, field-relevant values", () => {
  const p = [page("Öffnungszeiten: Mo–Fr 8–18 Uhr\nFilterkaffee aus der V60\nKein WLAN\nWir lieben Kuchen.\nImpressum: Bohne & Co. GmbH, HRB 123456\nInhaber Max Muster e.K.", "https://cafe.example/impressum")];
  const props: Proposal[] = [
    { field: "opening_hours", value: "Mo-Fr 08:00-18:00", page: 1, quote: "Mo–Fr 8–18 Uhr" },
    { field: "serving.filter", value: true, page: 1, quote: "Filterkaffee aus der V60" },
    { field: "serving.pour_over", value: true, page: 1, quote: "Filterkaffee aus der V60" },
    { field: "amenities.wifi", value: false, page: 1, quote: "Kein WLAN" },
    { field: "serving.espresso", value: true, page: 1, quote: "Wir lieben Kuchen." }, // quote does not mention espresso
    { field: "food.cakes_baked_in_house", value: true, page: 1, quote: "Wir lieben Kuchen." }, // no "baked in house"
    { field: "serving.cold_brew", value: true, page: 1, quote: "Cold Brew jeden Tag" }, // not on the page
    { field: "amenities.dogs_allowed", value: false, page: 1, quote: "Filterkaffee aus der V60" }, // false without negation
    { field: "operator", value: "Bohne & Co. GmbH", page: 1, quote: "Bohne & Co. GmbH" },
    { field: "operator", value: "Max Muster e.K.", page: 1, quote: "Max Muster e.K." }, // natural person
    { field: "register_id", value: "HRB 123456", page: 1, quote: "HRB 123456" },
    { field: "opening_hours", value: "Mo-Fr 08:00-20:00", page: 2, quote: "Mo–Fr 8–18 Uhr" }, // no page 2
  ];
  const { kept, rejected } = verify(props, p, { country: "DE", ownName: "Bohne", multiLocation: false });
  const got = Object.fromEntries(kept.map((k) => [k.field, k.value]));
  expect(got).toEqual({ opening_hours: "Mo-Fr 08:00-18:00", "serving.filter": true, "serving.pour_over": true, "amenities.wifi": false, operator: "Bohne & Co. GmbH", register_id: "HRB 123456" });
  expect(rejected.map((r) => r.reason)).toContain("quote not on page");
  expect(rejected.map((r) => r.reason)).toContain("not a legal entity");
});

test("contradicting values for one field cancel out", () => {
  const p = [page("Espresso to go. Wir haben keinen Espresso mehr.")];
  const { kept } = verify([
    { field: "serving.espresso", value: true, page: 1, quote: "Espresso to go" },
    { field: "serving.espresso", value: false, page: 1, quote: "keinen Espresso" },
  ], p, { country: "DE", ownName: "x", multiLocation: false });
  expect(kept).toHaveLength(0);
});

test("on multi-location sites, hours must sit near this location's street", () => {
  const filler = "x ".repeat(800);
  const p = [page(`Schwabing: Leopoldstraße 10, 80802 München. Mo–Fr 7–19 Uhr. ${filler} Maxvorstadt: Türkenstraße 5, 80799 München. Mo–Fr 9–17 Uhr.`)];
  const prop: Proposal[] = [{ field: "opening_hours", value: "Mo-Fr 07:00-19:00", page: 1, quote: "Mo–Fr 7–19 Uhr" }];
  expect(verify(prop, p, { street: "Leopoldstraße 10", country: "DE", ownName: "x", multiLocation: true }).kept).toHaveLength(1);
  expect(verify(prop, p, { street: "Türkenstraße 5", country: "DE", ownName: "x", multiLocation: true }).kept).toHaveLength(0);
});
