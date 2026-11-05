import { expect, test } from "bun:test";
import { lintCity, lintPlace, mergeDuplicates, repair } from "../src/lint";
import { cleanName, cleanStreet, isPlatformUrl } from "../src/rules";

const place = (x: any = {}) => ({
  id: "cp-0000000001", name: "Kaffee Beispiel", status: "open", last_verified_at: "2026-11-05T10:00:00Z", checked_at: "2026-11-05T10:00:00Z",
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
  expect(rules(place({ opening_hours: "Mo-Fr 08:00-18:00", open_sunday: true }))).toContain("error open-sunday");
  expect(rules(place({ specialty_tier: "A" }))).toContain("error tier-evidence");
  expect(rules(place({ last_verified_at: undefined }))).toContain("error status-open-unverified");
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
  const b = place({ id: "cp-000000000b", name: "Starbucks", opening_hours: "Mo-Fr 08:00-18:00", open_sunday: false });
  const other = place({ id: "cp-000000000c", name: "Café Kosmos", location: { lat: 48.16, lon: 11.57 } });
  expect(lintCity([a, b, other], "DE").filter((f) => f.rule === "duplicate")).toHaveLength(1);
  mergeDuplicates([a, b, other]);
  expect(a.merged_into).toBe("cp-000000000b");
  expect(b.merged_into).toBeUndefined();
  expect(lintCity([a, b, other], "DE").filter((f) => f.rule === "duplicate")).toHaveLength(0);
});

test("repair removes what a platform page supported and never adds facts", () => {
  const p = place({ name: "Cabo Cafe GmbH", specialty_tier: "B", roasters_served: [{ name: "X" }], opening_hours: "Mo-Fr 06:00-18:30", open_sunday: false, links: { website: "https://www.gelbeseiten.de/gsbiz/1" } });
  const notes = repair(p);
  expect(notes.length).toBeGreaterThan(0);
  expect(p).toMatchObject({ name: "Cabo Cafe", status: "unverified", specialty_tier: "unknown" });
  expect(p.opening_hours).toBeUndefined();
  expect(p.links).toBeUndefined();
  expect(rules(p).filter((r) => r.startsWith("error"))).toEqual([]);
  const q = place({ address: { ...place().address, street_address: "casa@gmx.de, Ehrengutstraße 4" } });
  repair(q);
  expect(q.address.street_address).toBe("Ehrengutstraße 4");
});
