import { expect, test } from "bun:test";
import type { Candidate } from "../src/candidate";
import { dedupe, samePlace } from "../src/dedupe";
import { nameSim, parseStreet, sameStreet } from "../src/names";

const c = (name: string, extra: Partial<Candidate> = {}): Candidate => ({ key: name, name, overtureIds: [], origins: [], ...extra });

test("name similarity ignores generic words", () => {
  expect(nameSim("Man Versus Machine Coffee Roasters", "Man Versus Machine")).toBe(1);
  expect(nameSim("Café Frischhut", "Schmalznudel Cafe Frischhut")).toBeGreaterThanOrEqual(0.85);
  expect(nameSim("Café Luitpold", "Café Stefanie")).toBeLessThan(0.5);
});

test("streets compare across spellings and abbreviations", () => {
  expect(sameStreet("Müllerstr. 23", "Müllerstraße 23")).toBe(true);
  expect(sameStreet("Müllerstrasse 23", "Müllerstraße 23")).toBe(true);
  expect(sameStreet("Müllerstraße 23", "Müllerstraße 25")).toBe(false);
  expect(parseStreet("Türkenstraße 52a")).toEqual({ street: "turkenstrasse", number: "52a" });
});

test("same place: close and similar, same address, or same site at the same spot", () => {
  const a = c("Vits der Kaffee", { lat: 48.1500, lon: 11.5800, street: "Rumfordstraße 49" });
  expect(samePlace(a, c("VITS Kaffee", { lat: 48.1503, lon: 11.5801 }))).toBe(true);
  expect(samePlace(a, c("Vits der Kaffee", { lat: 48.1600, lon: 11.5800 }))).toBe(false); // 1.1 km away
  expect(samePlace(a, c("Vits", { street: "Rumfordstr. 49" }))).toBe(true);
  // One website, two branches at different addresses: not the same place.
  const b1 = c("The Barn Altstadt", { lat: 48.137, lon: 11.575, street: "Sendlinger Str. 1", website: "https://thebarn.de/" });
  const b2 = c("The Barn Glockenbach", { lat: 48.130, lon: 11.570, street: "Müllerstraße 2", website: "https://thebarn.de/" });
  expect(samePlace(b1, b2)).toBe(false);
});

test("dedupe merges duplicates and keeps the first record's values", () => {
  const out = dedupe([
    c("Café Kosmos", { lat: 48.14, lon: 11.56, overtureIds: ["a"], website: "https://kosmos.example/" }),
    c("Kosmos Cafe", { lat: 48.1401, lon: 11.5601, overtureIds: ["b"], instagram: "https://www.instagram.com/kosmos/" }),
    c("Bäckerei Kosmos", { lat: 48.15, lon: 11.56, overtureIds: ["c"] }),
  ]);
  expect(out).toHaveLength(2);
  expect(out[0].overtureIds).toEqual(["a", "b"]);
  expect(out[0].website).toBe("https://kosmos.example/");
  expect(out[0].instagram).toBe("https://www.instagram.com/kosmos/");
});

import { streetHint } from "../src/pipeline";
test("street hints from roaster mentions keep branches apart", () => {
  expect(streetHint("Suuapinga Café Herzogstraße")).toBe("Herzogstraße");
  expect(streetHint("Besuche uns: Blutenburgstr. 93, 80636 München")).toBe("Blutenburgstr. 93");
  expect(streetHint("Suuapinga Café")).toBeNull();
  expect(sameStreet(streetHint("Suuapinga Café Herzogstraße")!, "Blutenburgstraße 93")).toBe(false);
});

test("near, similar names at different house numbers are different places", () => {
  const a = { key: "a", name: "Cafe Amalien", lat: 48.1525, lon: 11.5795, street: "Amalienstraße 87", overtureIds: ["1"], origins: [] };
  const b = { key: "b", name: "Dinatale Café Amalienstrasse", lat: 48.1515, lon: 11.5790, street: "Amalienstraße 71", overtureIds: ["2"], origins: [] };
  expect(samePlace(a, b)).toBe(false);
  expect(samePlace(a, { ...b, street: "Amalienstraße 87" })).toBe(true);
  expect(samePlace({ ...a, name: "Mackgorilla", street: "12 Marsstraße" }, { ...b, name: "MackGorilla", street: "Marsstraße 13" })).toBe(true);
});
