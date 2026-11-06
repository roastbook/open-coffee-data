import { expect, test } from "bun:test";
import { lintCity, lintPlace, mergeDuplicates, repair } from "../src/lint";
import { cleanName, cleanStreet, isPlatformUrl } from "../src/rules";

const place = (x: any = {}) => ({
  id: "cp-0000000001", type: "CafeOrCoffeeShop", name: "Kaffee Beispiel", status: "open", checked_at: "2026-11-05T10:00:00Z",
  address: { street_address: "Türkenstraße 52", postal_code: "80799", locality: "München", country_code: "DE" },
  location: { lat: 48.15, lon: 11.57 }, specialty_tier: "unknown", ...x,
});
const rules = (p: any) => lintPlace(p, "DE", new Date("2026-11-06")).map((f) => `${f.level} ${f.rule}`);

test("platform and directory pages are never a website; own sites and Google Sites are", () => {
  for (const u of ["https://www.gelbeseiten.de/gsbiz/1", "https://www.lieferando.de/x", "https://speisekartenweb.de/x", "https://www.facebook.com/x/", "https://reservierung.gastroguide.de/x", "https://www.muenchen.de/x"])
    expect(isPlatformUrl(u)).toBe(true);
  for (const u of ["https://vits.coffee/", "https://sites.google.com/view/cafe-x/", "https://cafe-muenchen.de/", "https://www.kaffee-muenchen.de/"])
    expect(isPlatformUrl(u)).toBe(false);
});

test("cleaners keep only the sign name and 'street number'", () => {
  expect(cleanName("Picnic On Monday Gmbh")).toBe("Picnic On Monday");
  expect(cleanName("Espressomobil, Das Original In München | Premium Barista Service | Coffee To Go")).toBe("Espressomobil, Das Original In München");
  expect(cleanName("Be Different Coffee Shop Ug")).toBe("Be Different Coffee Shop");
  expect(cleanName("AmRest Coffee Deutschland Sp. z o. o.  & Co.  KG")).toBe("AmRest Coffee Deutschland");
  expect(cleanName("THE BARN")).toBe("THE BARN");
  expect(cleanName("Tara GmbH Pizza Burger Company Inh. Frau Dr. Jane Doe")).toBe("Tara GmbH Pizza Burger Company");
  expect(cleanStreet("casa-bar@gmx.de, Ehrengutstraße 4")).toBe("Ehrengutstraße 4");
  expect(cleanStreet("Eingang Kaulbachstr, Königinstraße 37")).toBe("Königinstraße 37");
  expect(cleanStreet("Balanstraße 73 / Haus 31")).toBe("Balanstraße 73");
  expect(cleanStreet("Speicherstraße 28, Werk 13")).toBe("Speicherstraße 28");
  expect(cleanStreet("Viktualienmarkt 2")).toBe("Viktualienmarkt 2");
  expect(cleanStreet("Eingang über Hohenzollernplatz")).toBeNull();
});

test("errors: platform website, contact data, contradictions, unsupported tier, open without verification", () => {
  expect(rules(place())).toEqual([]);
  expect(rules(place({ links: { website: "https://www.gelbeseiten.de/gsbiz/1" } }))).toContain("error website-platform");
  expect(rules(place({ address: { ...place().address, street_address: "casa@gmx.de, Ehrengutstraße 4" } }))).toContain("error contact-data");
  expect(rules(place({ description: "Call us on 089 123456 for a table at our café." , specialty_tier: "A", roasts_own_beans: true }))).toContain("error contact-data");
  expect(rules(place({ amenities: { cash_only: true, card_payment: true } }))).toContain("error payment");
  expect(rules(place({ serving: { pour_over: true, filter: false } }))).toContain("error serving");
  expect(rules(place({ specialty_tier: "A" }))).toContain("error tier-evidence");
  expect(rules(place({ status: "unverified" }))).toContain("error unverified");
  expect(rules(place({ type: undefined }))).toContain("error type");
  expect(rules(place({ operator: { name: "Max Muster e.K." } }))).toContain("error operator");
  expect(rules(place({ name: "Pizza Company Inh. Max Muster" }))).toContain("error person-name");
  expect(rules(place({ prices: { cappuccino: { amount: 39, currency: "EUR", observed_on: "2026-11-05" } } }))).toContain("error price");
});

test("warnings: names and street strings that need a look", () => {
  expect(rules(place({ name: "Kürnbergstr" }))).toContain("warning name");
  expect(rules(place({ name: "Cabo Cafe GmbH" }))).toContain("warning name");
  expect(rules(place({ address: { ...place().address, street_address: "Pep Einkaufszentrum, Thomas-Dehler-Straße 8" } }))).toContain("warning street");
  expect(rules(place({ name: "Stromboli Heimservice" }))).toContain("warning tier-none");
});

test("duplicates are found and merged into the richer record, ids kept", () => {
  const a = place({ id: "cp-000000000a", name: "Starbucks", status: "unverified" });
  const b = place({ id: "cp-000000000b", name: "Starbucks", opening_hours: "Mo-Fr 08:00-18:00" });
  const other = place({ id: "cp-000000000c", name: "Café Kosmos", location: { lat: 48.16, lon: 11.57 } });
  expect(lintCity([a, b, other], "DE").filter((f) => f.rule === "duplicate")).toHaveLength(1);
  mergeDuplicates([a, b, other]);
  expect(a.merged_into).toBe("cp-000000000b");
  expect(b.merged_into).toBeUndefined();
  expect(lintCity([a, b, other], "DE").filter((f) => f.rule === "duplicate")).toHaveLength(0);
});

test("repair removes what a platform page supported and never adds facts", () => {
  const p = place({ name: "Cabo Cafe GmbH", specialty_tier: "B", roasters_served: [{ name: "X" }], opening_hours: "Mo-Fr 06:00-18:30", links: { website: "https://www.gelbeseiten.de/gsbiz/1" } });
  const notes = repair(p);
  expect(notes.length).toBeGreaterThan(0);
  expect(p).toMatchObject({ name: "Cabo Cafe", status: "unverified", specialty_tier: "unknown" });
  expect(p.opening_hours).toBeUndefined();
  expect(p.links).toBeUndefined();
  expect(rules(p).filter((r) => r.startsWith("error"))).toEqual(["error unverified"]); // nothing left that confirms it: remove the record
  const q = place({ address: { ...place().address, street_address: "casa@gmx.de, Ehrengutstraße 4" } });
  repair(q);
  expect(q.address.street_address).toBe("Ehrengutstraße 4");
});

test("share, dialog and intent links are not profiles", () => {
  expect(rules(place({ links: { facebook: "https://www.facebook.com/sharer.php/" } }))).toContain("error share-link");
  expect(rules(place({ links: { facebook: "https://www.facebook.com/dialog/share?app_id=1" } }))).toContain("error share-link");
  expect(rules(place({ links: { facebook: "https://www.facebook.com/coffeetwins1/" } }))).not.toContain("error share-link");
  const p = place({ links: { facebook: "https://www.facebook.com/sharer.php/", website: "https://cafe.example/" } });
  repair(p);
  expect(p.links).toEqual({ website: "https://cafe.example/" });
});

test("v0.3.0 repairs: open_sunday and last_verified_at go, type and instagram are normalised, tombstones are not open", () => {
  const p = place({ open_sunday: true, last_verified_at: "2026-11-05T10:00:00Z", type: undefined, links: { instagram: "https://instagram.com/Kaffee.Beispiel?igsh=x" } });
  repair(p);
  expect(p.open_sunday).toBeUndefined();
  expect(p.last_verified_at).toBeUndefined();
  expect(p.type).toBe("CafeOrCoffeeShop");
  expect(p.links.instagram).toBe("https://www.instagram.com/kaffee.beispiel/");
  const a = place({ id: "cp-00000000a1", name: "Starbucks" }), b = place({ id: "cp-00000000b1", name: "Starbucks", opening_hours: "Mo-Fr 08:00-18:00" });
  mergeDuplicates([a, b]);
  expect(a.merged_into).toBe("cp-00000000b1");
  expect(a.status).toBe("closed");
});

test("one place under two names (café and operator) at the same address and website is a duplicate", () => {
  const a = place({ id: "cp-0000000c1a", name: "cafe Clara", links: { website: "https://cafe-clara.example/" } });
  const b = place({ id: "cp-0000000c1b", name: "Christoph Jünger Gastronomie", links: { website: "https://cafe-clara.example/" }, location: { lat: 48.15003, lon: 11.57008 } });
  mergeDuplicates([a, b]);
  expect(b.merged_into).toBe("cp-0000000c1a"); // the person-like name is the one dropped
  expect(a.merged_into).toBeUndefined();
});
