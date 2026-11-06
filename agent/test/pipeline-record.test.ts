import { expect, test } from "bun:test";
import type { Candidate } from "../src/candidate";
import { BOOL_FIELDS, FIELDS, type Verified, verify } from "../src/extract";
import { buildRecord } from "../src/pipeline-record";
import type { Enriched, Row } from "../src/pipeline-model";
import { orderRecord } from "../src/dataset";
import { parseCityDocument, type CoffeeRecord } from "../src/record";
import type { SitePage } from "../src/site";

const candidate: Candidate = {
  key: "ov:test", name: "Example Coffee", lat: 48.15, lon: 11.57, street: "Türkenstraße 52", postcode: "80799",
  website: "https://coffee.example/", overtureIds: ["test"], origins: [{ via: "overture", ref: "test" }],
};
const page: SitePage = { url: "https://coffee.example/", fetchedAt: "2026-11-06T12:00:00Z", rendered: false, doc: { title: "Example Coffee", text: "Example Coffee Türkenstraße 52 80799", links: [], geo: [], jsonld: "" } };
const enriched = (facts: Verified[] = []): Enriched => ({ site: { start: page.url, ok: true, dead: false, pages: [page] }, match: "name and address", facts, rejected: [], multi: false, websiteTried: [page.url], injectionLines: 0 });
const row: Row = { id: "test", name: candidate.name, lat: 48.15, lon: 11.57, street: candidate.street ?? null, postcode: "80799", websites: [page.url], socials: [], brand: null, category: "coffee_shop", hierarchy: [], alternates: [], locality: "München", country: "DE", status: null, confidence: 1, datasets: [], licences: [], coffee: true };
const context = { now: new Date(page.fetchedAt), country: "DE", cityName: "München", inside: [row] };
const job = { id: "cp-0000000001", reason: "never_enriched", mode: "full" } as const;
const fact = (field: Verified["field"], value: Verified["value"]): Verified => ({ field, value, url: page.url, quote: "evidence", fetchedAt: page.fetchedAt });

function record(): CoffeeRecord {
  return { id: job.id, name: candidate.name, status: "open", type: "CafeOrCoffeeShop", checked_at: page.fetchedAt, location: { lat: 48.15, lon: 11.57 } };
}

test("full records retain verified flags, commerce, evidence and false values", () => {
  const built = buildRecord(job, candidate, enriched([
    fact("serving.espresso", true), fact("serving.pour_over", true), fact("amenities.wifi", false), fact("food.breakfast", true),
    fact("food_focus", "coffee_led"), fact("roasts_own_beans", true), fact("specialty", true), fact("primary_business", "cafe"),
    fact("opening_hours", "Mo-Fr 08:00-18:00"), fact("roaster", "Example Coffee"), fact("reusable_cup", "recup"),
    fact("operator", "Example GmbH"), fact("register_id", "HRB 12345"), fact("cappuccino_price", 3.9),
  ]), null, context);
  expect(built.record).toMatchObject({
    status: "open", specialty_tier: "A", roasts_own_beans: true,
    serving: { espresso: true, pour_over: true }, amenities: { wifi: false }, food: { breakfast: true, focus: "coffee_led" },
    roasters_served: [{ name: candidate.name, own: true }], reusable_cup_systems: ["recup"], operator: { name: "Example GmbH", register_id: "HRB 12345" },
    prices: { cappuccino: { amount: 3.9 } }, links: { website: page.url },
  });
  expect(built.provenance.get("amenities.wifi")).toMatchObject({ value: false, url: page.url });
});

test("every verified boolean field can reach a stored record", () => {
  for (const field of FIELDS) {
    if (!Object.hasOwn(BOOL_FIELDS, field)) continue;
    const facts = [fact(field, false)];
    const built = buildRecord(job, candidate, enriched(facts), null, context);
    let value: unknown = built.record;
    for (const key of field.split(".")) value = value && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
    expect(value).toBe(false);
  }
});

test("refresh keeps existing facts, full enrichment removes stale facts, unreadable sites retain old records", () => {
  const old = { ...record(), serving: { espresso: true }, opening_hours: "Mo-Fr 09:00-18:00" };
  const e = enriched([fact("opening_hours", "Mo-Fr 08:00-18:00")]);
  expect(buildRecord({ ...job, mode: "refresh" }, candidate, e, old, context).record?.serving).toEqual(old.serving);
  expect(buildRecord(job, candidate, e, old, context).record?.serving).toBeUndefined();
  expect(buildRecord(job, candidate, { ...e, match: undefined, site: { start: page.url, ok: false, dead: false, error: "blocked", pages: [] } }, old, context)).toMatchObject({ record: null, keep: true });
  expect(old.opening_hours).toBe("Mo-Fr 09:00-18:00");
});

test("unknown enum and inherited property names are rejected, never used as matchers", () => {
  const p = { ...page, doc: { ...page.doc, text: "constructor __proto__ toString coffee" } };
  const proposals = ["constructor", "__proto__", "toString"].map((value) => ({ field: "primary_business" as const, value, page: 1, quote: p.doc.text }));
  expect(verify(proposals, [p], { country: "DE", ownName: candidate.name, multiLocation: false }).kept).toEqual([]);
});

test("dataset parsing checks consumed field shapes and ordering preserves extra own keys safely", () => {
  expect(() => parseCityDocument(JSON.stringify({ places: [{ ...record(), amenities: { wifi: "yes" } }] }))).toThrow("Invalid coffee dataset");
  const parsed = parseCityDocument(JSON.stringify({ places: [{ ...record(), ...JSON.parse('{"__proto__":{"polluted":true}}') }] }));
  const ordered = orderRecord(parsed.places[0]);
  expect(Object.getPrototypeOf(ordered)).toBe(Object.prototype);
  expect(Object.hasOwn(ordered, "__proto__")).toBe(true);
  expect(Object.getOwnPropertyDescriptor(Object.prototype, "polluted")).toBeUndefined();
});

test("contact data cannot hide behind a name that starts like an exempt URL group", async () => {
  const { lintPlace } = await import("../src/lint");
  const p = Object.assign(record(), { links_note: "Contact Jane at jane@example.com" });
  expect(lintPlace(p, "DE", context.now).some((finding) => finding.rule === "contact-data")).toBe(true);
});
